/**
 * content.js — Runs in the page context to extract article content and images.
 * Uses the same site selector strategy as the desktop app.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Site selectors (same as desktop app)
  // ---------------------------------------------------------------------------

  const CONTENT_SELECTORS = [
    { id: "js_content" },
    { cls: "rich_media_content" },
    { cls: "Post-RichTextContainer" },
    { cls: "article-content" },
    { cls: "article__detail" },
    { cls: "meteredContent" },
    { cls: "page-body" },
    { tag: "article" },
    { tag: "body" },
  ];

  const TITLE_SELECTORS = [
    { id: "activity-name" },
    { cls: "rich_media_title" },
    { tag: "h1" },
  ];

  const AUTHOR_SELECTORS = [
    { id: "js_name" },
    { cls: "rich_media_meta_nickname" },
  ];

  const DATE_SELECTORS = [{ id: "publish_time" }];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function findBySelectors(selectors) {
    for (const sel of selectors) {
      let el;
      if (sel.id) el = document.getElementById(sel.id);
      else if (sel.cls) el = document.querySelector("." + sel.cls);
      else if (sel.tag) el = document.querySelector(sel.tag);
      if (el) return el;
    }
    return null;
  }

  function getMeta(name) {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute("content") || "" : "";
  }

  // ---------------------------------------------------------------------------
  // Image extraction
  // ---------------------------------------------------------------------------

  async function extractImage(img) {
    const src = img.getAttribute("src") || "";
    const dataSrc = img.getAttribute("data-src") || "";

    // Prefer base64
    if (src.startsWith("data:image/")) {
      return { dataUrl: src, ext: getImageExt(src) };
    }
    if (dataSrc.startsWith("data:image/")) {
      return { dataUrl: dataSrc, ext: getImageExt(dataSrc) };
    }

    // Try URL
    const url = dataSrc.startsWith("http") ? dataSrc : src.startsWith("http") ? src : "";
    if (url) {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        const ext = blob.type.split("/")[1] || "png";
        return { dataUrl, ext };
      } catch {
        return null;
      }
    }
    return null;
  }

  function getImageExt(dataUrl) {
    const m = dataUrl.match(/^data:image\/([\w+]+)/);
    if (!m) return "png";
    return m[1].replace("jpeg", "jpg").split("+")[0];
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------------------
  // Main extraction
  // ---------------------------------------------------------------------------

  async function extractPage() {
    // Title
    const titleEl = findBySelectors(TITLE_SELECTORS);
    let title = titleEl ? titleEl.textContent.trim() : getMeta("og:title") || document.title;

    // Author
    const authorEl = findBySelectors(AUTHOR_SELECTORS);
    const author = authorEl
      ? authorEl.textContent.trim()
      : getMeta("og:article:author") || getMeta("author") || "";

    // Date
    const dateEl = findBySelectors(DATE_SELECTORS);
    const date = dateEl ? dateEl.textContent.trim() : getMeta("article:published_time").slice(0, 10);

    // Content
    let contentEl = findBySelectors(CONTENT_SELECTORS);
    if (!contentEl) contentEl = document.body;

    // Clone to avoid modifying the page
    const clone = contentEl.cloneNode(true);

    // Remove noise
    clone.querySelectorAll("style, script, noscript, iframe, svg").forEach((el) => el.remove());

    // Extract images
    const images = [];
    const imgEls = clone.querySelectorAll("img");
    for (let i = 0; i < imgEls.length; i++) {
      const img = imgEls[i];
      const result = await extractImage(imgEls[i]); // use original, not clone
      if (result) {
        const filename = `img_${i}.${result.ext}`;
        images.push({ filename, dataUrl: result.dataUrl });
        img.setAttribute("src", `./assets/${filename}`);
      } else {
        img.remove();
      }
    }

    // Strip all attributes except essential
    clone.querySelectorAll("*").forEach((el) => {
      const src = el.getAttribute("src");
      const href = el.getAttribute("href");
      const alt = el.getAttribute("alt");
      while (el.attributes.length > 0) {
        el.removeAttribute(el.attributes[0].name);
      }
      if (src) el.setAttribute("src", src);
      if (href) el.setAttribute("href", href);
      if (alt) el.setAttribute("alt", alt);
    });

    return {
      title,
      author,
      date,
      html: clone.innerHTML,
      images,
    };
  }

  // ---------------------------------------------------------------------------
  // Listen for messages from popup
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "extract") {
      extractPage()
        .then((result) => sendResponse({ ok: true, data: result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }
  });
})();
