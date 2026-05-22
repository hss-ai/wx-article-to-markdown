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
  // Scroll page to trigger lazy loading
  // ---------------------------------------------------------------------------

  function scrollPageToLoadAll() {
    return new Promise((resolve) => {
      let scrolled = 0;
      const step = 800;
      const maxScroll = document.documentElement.scrollHeight;
      const interval = setInterval(() => {
        scrolled += step;
        window.scrollTo(0, scrolled);
        if (scrolled >= maxScroll) {
          clearInterval(interval);
          window.scrollTo(0, 0);
          // Wait for images to load after scrolling
          setTimeout(resolve, 1000);
        }
      }, 100);
    });
  }

  // ---------------------------------------------------------------------------
  // Image extraction
  // ---------------------------------------------------------------------------

  async function extractImage(imgEl) {
    // Read from the ORIGINAL element (not a clone), which has real src after lazy load
    const src = imgEl.getAttribute("src") || "";
    const dataSrc = imgEl.getAttribute("data-src") || "";
    const dataOriginal = imgEl.getAttribute("data-original") || "";
    const lazySrc = imgEl.getAttribute("data-lazy-src") || "";

    // Prefer base64 from src
    if (src.startsWith("data:image/") && src.length > 100) {
      return { dataUrl: src, ext: getImageExt(src) };
    }

    // Try data-src base64
    if (dataSrc.startsWith("data:image/") && dataSrc.length > 100) {
      return { dataUrl: dataSrc, ext: getImageExt(dataSrc) };
    }

    // Try URL — check multiple attributes in priority order
    const urlCandidates = [dataSrc, dataOriginal, lazySrc, src].filter(
      (u) => u && u.startsWith("http")
    );

    for (const url of urlCandidates) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        if (!blob.type.startsWith("image/") || blob.size < 200) continue;
        const dataUrl = await blobToDataUrl(blob);
        const ext = blob.type.split("/")[1] || "png";
        return { dataUrl, ext };
      } catch {
        continue;
      }
    }

    // Try drawing to canvas as last resort (for canvas-rendered images)
    if (imgEl.naturalWidth && imgEl.naturalHeight && imgEl.complete) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgEl, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl && dataUrl.length > 100 && !dataUrl.endsWith("data:,")) {
          return { dataUrl, ext: "png" };
        }
      } catch {
        // CORS or tainted canvas — skip
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
    // 1. Scroll page to trigger lazy loading
    await scrollPageToLoadAll();

    // 2. Metadata
    const titleEl = findBySelectors(TITLE_SELECTORS);
    let title = titleEl ? titleEl.textContent.trim() : getMeta("og:title") || document.title;

    const authorEl = findBySelectors(AUTHOR_SELECTORS);
    const author = authorEl
      ? authorEl.textContent.trim()
      : getMeta("og:article:author") || getMeta("author") || "";

    const dateEl = findBySelectors(DATE_SELECTORS);
    const date = dateEl ? dateEl.textContent.trim() : (getMeta("article:published_time") || "").slice(0, 10);

    // 3. Content
    let contentEl = findBySelectors(CONTENT_SELECTORS);
    if (!contentEl) contentEl = document.body;

    // Get original images BEFORE cloning (they have real src after scroll)
    const originalImgs = contentEl.querySelectorAll("img");

    // Clone to avoid modifying the page
    const clone = contentEl.cloneNode(true);

    // Remove noise
    clone.querySelectorAll("style, script, noscript, iframe, svg").forEach((el) => el.remove());

    // 4. Extract images from ORIGINAL elements, update clone references
    const images = [];
    const cloneImgs = clone.querySelectorAll("img");

    for (let i = 0; i < Math.min(originalImgs.length, cloneImgs.length); i++) {
      const result = await extractImage(originalImgs[i]);
      if (result && result.dataUrl && result.dataUrl.length > 100) {
        const filename = `img_${i}.${result.ext}`;
        images.push({ filename, dataUrl: result.dataUrl });
        cloneImgs[i].setAttribute("src", `./assets/${filename}`);
      } else {
        cloneImgs[i].remove();
      }
    }

    // Handle case where clone has more/less imgs than original
    for (let i = originalImgs.length; i < cloneImgs.length; i++) {
      cloneImgs[i].remove();
    }

    // 5. Strip all attributes except essential
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
