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

  // ---------------------------------------------------------------------------
  // WeChat section-based table detection & conversion
  // Works on the ORIGINAL DOM to access computed styles.
  // ---------------------------------------------------------------------------

  function convertSectionTables(originalRoot) {
    // Strategy: walk all <section> elements, detect table patterns using
    // computed styles AND structural heuristics.

    const candidates = originalRoot.querySelectorAll("section");

    for (const section of candidates) {
      // Skip if already small or has no children
      const childSections = Array.from(section.children).filter(
        (c) => c.tagName === "SECTION" || c.tagName === "P"
      );
      if (childSections.length < 4) continue;

      // --- Pattern 1: Row-based grid ---
      // Children are rows, each containing same number of cell children
      let detected = tryConvertRowBasedGrid(section, childSections);
      if (detected) continue;

      // --- Pattern 2: Flat cells with consistent width ---
      // All children are cells (not rows), detect by width style
      detected = tryConvertFlatGrid(section, childSections);
      if (detected) continue;

      // --- Pattern 3: Pure structural flat cells (no CSS hints) ---
      detected = tryConvertFlatTextCells(section, childSections);
      if (detected) continue;
    }

    // --- Pattern 4: Feishu/Lark nested <th>/<td> table ---
    convertNestedThTdTables(originalRoot);
  }

  function convertNestedThTdTables(root) {
    const allThs = root.querySelectorAll("th");
    if (allThs.length === 0) return;

    for (const th of allThs) {
      if (th.closest("table")) continue;
      const nestedThs = th.querySelectorAll("th");
      if (nestedThs.length === 0) continue;

      // Collect header texts from nested <th> chain
      const headerTexts = [];
      let cur = th;
      while (cur && cur.tagName === "TH") {
        const span = cur.querySelector("span[leaf], span");
        const txt = span ? span.textContent.trim() : "";
        if (txt) headerTexts.push(txt);
        const next = cur.querySelector("th");
        cur = (next && next !== cur) ? next : null;
      }
      if (headerTexts.length < 2) continue;

      // Find <tbody> with rows
      const tbody = th.querySelector("tbody");
      if (!tbody) continue;

      const rows = [];
      for (const tr of tbody.querySelectorAll("tr")) {
        const cells = [];
        for (const td of tr.querySelectorAll("td")) {
          const span = td.querySelector("span[leaf], span");
          cells.push(span ? span.textContent.trim() : "");
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length === 0) continue;

      // Build <table>
      const table = document.createElement("table");
      const newTbody = document.createElement("tbody");

      const htr = document.createElement("tr");
      for (const h of headerTexts) {
        const th2 = document.createElement("th");
        th2.textContent = h;
        htr.appendChild(th2);
      }
      newTbody.appendChild(htr);

      for (const row of rows) {
        const tr2 = document.createElement("tr");
        for (const cell of row) {
          const td2 = document.createElement("td");
          td2.textContent = cell;
          tr2.appendChild(td2);
        }
        newTbody.appendChild(tr2);
      }

      table.appendChild(newTbody);
      th.replaceWith(table);
      return;
    }
  }

  function tryConvertRowBasedGrid(section, children) {
    // Check if children are rows, each with same number of sub-children
    let colCount = 0;
    let isGrid = true;

    for (let i = 0; i < children.length; i++) {
      const subChildren = Array.from(children[i].children).filter(
        (c) => c.tagName === "SECTION" || c.tagName === "P" || c.tagName === "SPAN"
      );
      if (subChildren.length === 0) { isGrid = false; break; }
      if (i === 0) colCount = subChildren.length;
      else if (subChildren.length !== colCount) { isGrid = false; break; }
    }

    if (!isGrid || colCount < 2 || children.length < 2) return false;

    // Verify with computed style: parent or children should be flex/grid
    const parentStyle = getComputedStyle(section);
    const childStyle = getComputedStyle(children[0]);
    const isTableLayout =
      parentStyle.display === "flex" ||
      parentStyle.display === "grid" ||
      childStyle.display === "flex" ||
      childStyle.display === "grid" ||
      // Also check inline style as fallback
      (section.getAttribute("style") || "").includes("display");

    // If not flex/grid but structural pattern matches, still convert
    // (some WeChat tables use borders/floats instead)

    // Additional check: all cells should have short-ish text (table cells, not paragraphs)
    let allShort = true;
    for (const child of children) {
      const text = child.textContent.trim();
      if (text.length > 200) { allShort = false; break; }
    }
    if (!allShort) return false;

    // Convert
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");

    for (let r = 0; r < children.length; r++) {
      const tr = document.createElement("tr");
      const cells = Array.from(children[r].children).filter(
        (c) => c.tagName === "SECTION" || c.tagName === "P" || c.tagName === "SPAN"
      );
      for (let c = 0; c < cells.length; c++) {
        const tag = r === 0 ? "th" : "td";
        const cell = document.createElement(tag);
        cell.innerHTML = cells[c].innerHTML.trim();
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    section.replaceWith(table);
    return true;
  }

  function tryConvertFlatGrid(section, children) {
    // All children are cells, not rows. Detect by:
    // 1. Children have consistent width style (e.g., all width:25%)
    // 2. Total children count is divisible by a reasonable column count

    // Check for consistent width percentage in styles
    const widths = [];
    for (const child of children) {
      const style = child.getAttribute("style") || "";
      const widthMatch = style.match(/width\s*:\s*(\d+\.?\d*)\s*%/);
      if (widthMatch) {
        widths.push(parseFloat(widthMatch[1]));
      }
    }

    if (widths.length === children.length && widths.length >= 4) {
      // All children have width percentages
      // Check if they're all the same (or very close)
      const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
      const allSameWidth = widths.every((w) => Math.abs(w - avgWidth) < 2);

      if (allSameWidth && avgWidth >= 10 && avgWidth <= 50) {
        // This looks like a flat grid table
        const colCount = Math.round(100 / avgWidth);
        const rowCount = children.length / colCount;

        if (rowCount >= 2 && rowCount === Math.floor(rowCount)) {
          // Convert
          const table = document.createElement("table");
          const tbody = document.createElement("tbody");

          for (let r = 0; r < rowCount; r++) {
            const tr = document.createElement("tr");
            for (let c = 0; c < colCount; c++) {
              const idx = r * colCount + c;
              const tag = r === 0 ? "th" : "td";
              const cell = document.createElement(tag);
              cell.innerHTML = children[idx].innerHTML.trim();
              tr.appendChild(cell);
            }
            tbody.appendChild(tr);
          }

          table.appendChild(tbody);
          section.replaceWith(table);
          return true;
        }
      }
    }

    // Fallback: check computed style for flex-wrap pattern
    const computedStyle = getComputedStyle(section);
    if (computedStyle.display === "flex" && computedStyle.flexWrap === "wrap") {
      // Check if children have consistent flex-basis or width
      const childComputed = getComputedStyle(children[0]);
      const flexBasis = childComputed.flexBasis;
      if (flexBasis && flexBasis !== "auto") {
        // Parse percentage from flex-basis
        const match = flexBasis.match(/(\d+\.?\d*)%/);
        if (match) {
          const pct = parseFloat(match[1]);
          const colCount = Math.round(100 / pct);
          const rowCount = children.length / colCount;
          if (rowCount >= 2 && rowCount === Math.floor(rowCount) && colCount >= 2) {
            const table = document.createElement("table");
            const tbody = document.createElement("tbody");
            for (let r = 0; r < rowCount; r++) {
              const tr = document.createElement("tr");
              for (let c = 0; c < colCount; c++) {
                const idx = r * colCount + c;
                const tag = r === 0 ? "th" : "td";
                const cell = document.createElement(tag);
                cell.innerHTML = children[idx].innerHTML.trim();
                tr.appendChild(cell);
              }
              tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            section.replaceWith(table);
            return true;
          }
        }
      }
    }

    return false;
  }

  function tryConvertFlatTextCells(section, children) {
    // Pure structural detection: N child sections, each with only short text,
    // no sub-sections. Try to find a column count that makes a reasonable table.
    if (children.length < 6) return false;

    // Verify all children are leaf nodes with short text
    for (const child of children) {
      const subSections = child.querySelectorAll("section, p");
      if (subSections.length > 0) return false; // has nested elements, not a leaf cell
      const text = child.textContent.trim();
      if (text.length > 200) return false; // too long for a table cell
      if (text.length === 0) return false; // empty cell
    }

    // Try column counts from 2 to 6, pick the best one
    for (let colCount = 2; colCount <= 6; colCount++) {
      if (children.length % colCount !== 0) continue;
      const rowCount = children.length / colCount;
      if (rowCount < 2) continue;

      // Heuristic: first row (header) should have short text
      let headerShort = true;
      for (let c = 0; c < colCount; c++) {
        if (children[c].textContent.trim().length > 30) {
          headerShort = false;
          break;
        }
      }
      if (!headerShort) continue;

      // Heuristic: prefer the smallest column count that gives >= 2 rows
      // and where header text is notably shorter than data text on average
      const headerAvgLen =
        Array.from({ length: colCount }, (_, i) => children[i].textContent.trim().length)
          .reduce((a, b) => a + b, 0) / colCount;

      // Check if subsequent rows have similar structure
      let rowsConsistent = true;
      for (let r = 1; r < rowCount; r++) {
        const rowAvgLen =
          Array.from({ length: colCount }, (_, i) => children[r * colCount + i].textContent.trim().length)
            .reduce((a, b) => a + b, 0) / colCount;
        // If any row has a very different average length, might not be a table
        if (rowAvgLen > headerAvgLen * 5) {
          rowsConsistent = false;
          break;
        }
      }

      if (!rowsConsistent) continue;

      // Found a valid table structure!
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");

      for (let r = 0; r < rowCount; r++) {
        const tr = document.createElement("tr");
        for (let c = 0; c < colCount; c++) {
          const idx = r * colCount + c;
          const tag = r === 0 ? "th" : "td";
          const cell = document.createElement(tag);
          cell.innerHTML = children[idx].innerHTML.trim();
          tr.appendChild(cell);
        }
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      section.replaceWith(table);
      return true;
    }

    return false;
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

    // 3.5 Convert section-based tables on ORIGINAL DOM (needs computed styles)
    convertSectionTables(contentEl);

    // Get original images BEFORE cloning (they have real src after scroll)
    const originalImgs = contentEl.querySelectorAll("img");

    // Clone to avoid modifying the page
    const clone = contentEl.cloneNode(true);

    // Remove noise
    clone.querySelectorAll("style, script, noscript, iframe, svg").forEach((el) => el.remove());

    // Extract images from ORIGINAL elements, update clone references
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

    // 5. Pre-process code blocks: fix line breaks and remove "Code" labels
    clone.querySelectorAll("pre code").forEach((code) => {
      // Replace <br> with newline text nodes
      code.querySelectorAll("br").forEach((br) => {
        br.replaceWith("\n");
      });
      // Unwrap <p> inside code
      code.querySelectorAll("p").forEach((p) => {
        while (p.firstChild) {
          p.parentNode.insertBefore(p.firstChild, p);
        }
        p.remove();
      });
    });
    // Remove "Code" labels near <pre> elements
    clone.querySelectorAll("pre").forEach((pre) => {
      const prev = pre.previousElementSibling;
      if (prev && prev.textContent.trim() === "Code") {
        prev.remove();
      }
      // Also check parent's child elements
      const parent = pre.parentElement;
      if (parent) {
        Array.from(parent.children).forEach((child) => {
          if (
            child !== pre &&
            (child.tagName === "P" || child.tagName === "SPAN") &&
            child.textContent.trim() === "Code" &&
            child.querySelector("pre") === null
          ) {
            child.remove();
          }
        });
      }
    });

    // 6. Strip all attributes except essential
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

    if (msg.action === "getPageDimensions") {
      // Find content element to determine crop bounds
      let contentEl = findBySelectors(CONTENT_SELECTORS);
      if (!contentEl) contentEl = document.body;
      const rect = contentEl.getBoundingClientRect();
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      const contentLeft = rect.left + scrollLeft;
      const contentWidth = rect.width;

      sendResponse({
        totalHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio || 1,
        contentLeft: contentLeft,
        contentWidth: contentWidth,
      });
      return false;
    }

    if (msg.action === "scrollTo") {
      // Hide fixed/sticky elements to avoid duplication in captures (except first screen)
      if (msg.hideFixed) {
        document.querySelectorAll("*").forEach((el) => {
          if (el.dataset.html2mdOrigDisplay !== undefined) return;
          const pos = getComputedStyle(el).position;
          if (pos === "fixed" || pos === "sticky") {
            el.dataset.html2mdOrigDisplay = el.style.display;
            el.style.display = "none";
          }
        });
      }
      window.scrollTo(0, msg.y);
      // Report the actual scroll position — the browser clamps it to
      // [0, scrollHeight - innerHeight], so the requested y may differ.
      const actualY = window.pageYOffset || document.documentElement.scrollTop || 0;
      sendResponse({ ok: true, actualY: actualY });
      return false;
    }

    if (msg.action === "restorePage") {
      // Restore hidden fixed elements and scroll to top
      document.querySelectorAll("[data-html2md-orig-display]").forEach((el) => {
        el.style.display = el.dataset.html2mdOrigDisplay || "";
        delete el.dataset.html2mdOrigDisplay;
      });
      window.scrollTo(0, 0);
      sendResponse({ ok: true });
      return false;
    }
  });
})();
