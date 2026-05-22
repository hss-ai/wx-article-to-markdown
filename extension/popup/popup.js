/**
 * popup.js — Extension popup logic
 * Uses Turndown loaded via <script> in index.html
 */

// ---- UI elements ----
const pageTitle = document.getElementById("pageTitle");
const pageMeta = document.getElementById("pageMeta");
const convertBtn = document.getElementById("convertBtn");
const statusEl = document.getElementById("status");
const optImages = document.getElementById("optImages");
const optScreenshot = document.getElementById("optScreenshot");
const convertedBadge = document.getElementById("convertedBadge");

// History UI elements
const historyCountEl = document.getElementById("historyCount");
const historyListEl = document.getElementById("historyList");
const historySearchEl = document.getElementById("historySearch");
const clearAllBtn = document.getElementById("clearAllBtn");
const historyStatsEl = document.getElementById("historyStats");

// ---- Turndown instance ----
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// --- GFM Table Rule ---
turndown.addRule("table", {
  filter: ["table"],
  replacement: function (content, node) {
    const rows = [];
    const trEls = node.querySelectorAll("tr");
    if (!trEls || trEls.length === 0) return content;

    for (const tr of trEls) {
      const cells = [];
      for (const cell of tr.children) {
        const tag = cell.tagName.toUpperCase();
        if (tag === "TD" || tag === "TH") {
          const text = (cell.textContent || "").trim().replace(/\|/g, "\\|").replace(/\n/g, " ");
          cells.push(text);
        }
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return content;

    // Normalize column count
    const colCount = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => {
      while (r.length < colCount) r.push("");
      return r;
    });

    // Build markdown table
    const header = "| " + normalized[0].join(" | ") + " |";
    const separator = "| " + normalized[0].map(() => "---").join(" | ") + " |";
    const body = normalized
      .slice(1)
      .map((r) => "| " + r.join(" | ") + " |")
      .join("\n");

    return "\n\n" + header + "\n" + separator + "\n" + body + "\n\n";
  },
});

// Keep td/th from being processed individually
turndown.addRule("tableCell", {
  filter: ["td", "th"],
  replacement: function (content) {
    return content;
  },
});

turndown.addRule("tableRow", {
  filter: ["tr", "thead", "tbody", "tfoot"],
  replacement: function (content) {
    return content;
  },
});

// ---- Get current tab info ----

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getCurrentTab();
  pageTitle.textContent = tab.title || "Unknown page";
  try {
    pageMeta.textContent = new URL(tab.url).hostname;
  } catch {
    pageMeta.textContent = "";
  }
  // Check if current page was already converted
  await checkCurrentPage(tab.url);
  // Update history badge count
  await updateHistoryBadge();
}

init();

// ---- Tab switching ----

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    const tabId = "tab-" + btn.dataset.tab;
    document.getElementById(tabId).classList.add("active");
    if (btn.dataset.tab === "history") {
      loadHistory();
    }
  });
});

// ---- Convert ----

convertBtn.addEventListener("click", async () => {
  convertBtn.disabled = true;
  statusEl.textContent = "Extracting content...";
  statusEl.className = "status";

  try {
    const tab = await getCurrentTab();

    // Capture full-page screenshot BEFORE extract (extract scrolls and modifies page)
    let screenshotData = null;
    if (optScreenshot.checked) {
      statusEl.textContent = "Capturing full-page screenshot...";
      screenshotData = await captureFullPage(tab.id);
    }

    statusEl.textContent = "Extracting content...";

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: "extract" }, (result) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(result || { ok: false, error: "No response from content script" });
        }
      });
    });

    if (!response.ok) {
      throw new Error(response.error || "Extraction failed");
    }

    const { title, author, date, html, images } = response.data;

    statusEl.textContent = "Converting to Markdown...";

    const mdRaw = turndown.turndown(html);
    let md = mdRaw.replace(/\n{3,}/g, "\n\n").trim();

    // Assemble
    let parts = [];
    if (title) parts.push(`# ${title}\n`);
    const meta = [];
    if (author) meta.push(`Source: ${author}`);
    if (date) meta.push(`Date: ${date}`);
    if (meta.length) parts.push(`> ${meta.join(" | ")}\n`);
    parts.push(md);
    const finalMd = parts.join("\n");

    statusEl.textContent = "Packaging...";

    const includeImages = optImages.checked;
    const blob = await createDownloadBlob(finalMd, includeImages ? images : [], screenshotData);

    const safeName = (title || "article").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${safeName}.zip`,
      saveAs: true,
    });

    const screenshotInfo = screenshotData ? " + screenshot" : "";
    statusEl.textContent = `Done! ${images.length} image(s)${screenshotInfo} extracted.`;
    statusEl.className = "status ok";

    // Save to conversion history
    await saveHistory({
      title: title || tab.title || "Untitled",
      url: tab.url,
      images: images.length,
    });
    convertedBadge.classList.add("show");
    await updateHistoryBadge();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = "status err";
  } finally {
    convertBtn.disabled = false;
  }
});

// ---- Package as ZIP ----

async function createDownloadBlob(markdown, images, screenshotData) {
  const files = [];
  files.push({ path: "article.md", data: new TextEncoder().encode(markdown) });

  // Add screenshot if available
  if (screenshotData) {
    files.push({ path: "screenshot.png", data: screenshotData });
  }

  for (const img of images) {
    const binary = dataUrlToUint8Array(img.dataUrl);
    if (binary.length < 100) continue; // skip invalid/empty images
    files.push({ path: `assets/${img.filename}`, data: binary });
  }

  return createZip(files);
}

function dataUrlToUint8Array(dataUrl) {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return new Uint8Array(0);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

// Minimal ZIP creator
function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const pathBytes = new TextEncoder().encode(file.path);
    const data = file.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + pathBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, pathBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(pathBytes, 30);
    local.set(data, 30 + pathBytes.length);
    localHeaders.push(local);

    const central = new Uint8Array(46 + pathBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, pathBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(pathBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const totalSize = offset + centralSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const l of localHeaders) { result.set(l, pos); pos += l.length; }
  for (const c of centralHeaders) { result.set(c, pos); pos += c.length; }
  result.set(end, pos);
  return new Blob([result], { type: "application/zip" });
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- Full-page Screenshot ----

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(result);
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureFullPage(tabId) {
  // 1. Get initial page dimensions to calculate optimal zoom
  const initDims = await sendTabMessage(tabId, { action: "getPageDimensions" });
  if (!initDims) throw new Error("Cannot get page dimensions");

  const { viewportWidth, contentWidth } = initDims;

  // 2. Zoom page so content fills viewport width (max 3x to limit file size)
  const originalZoom = await new Promise((resolve) =>
    chrome.tabs.getZoom(tabId, (z) => resolve(z))
  );
  const idealZoom = contentWidth > 0 ? viewportWidth / contentWidth : 1;
  const zoomFactor = Math.min(idealZoom, 3) * originalZoom;
  await new Promise((resolve) =>
    chrome.tabs.setZoom(tabId, zoomFactor, () => resolve())
  );
  await delay(600); // wait for reflow + lazy reload after zoom

  // 3. Re-measure dimensions after zoom (layout AND devicePixelRatio change)
  const dims = await sendTabMessage(tabId, { action: "getPageDimensions" });
  if (!dims) throw new Error("Cannot get page dimensions after zoom");

  const {
    totalHeight,
    viewportHeight,
    contentLeft: zoomedContentLeft,
    contentWidth: zoomedContentWidth,
  } = dims;
  const zoomedViewportWidth = dims.viewportWidth;
  const captures = [];
  const scrollPositions = []; // record actual scrollY for accurate stitching
  const numCaptures = Math.max(1, Math.ceil(totalHeight / viewportHeight));

  // 4. Scroll and capture each viewport.
  // chrome.tabs.captureVisibleTab is rate-limited to ~2/sec by Chrome
  // (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND); use >=600ms gap to avoid
  // throttled / duplicated frames.
  for (let i = 0; i < numCaptures; i++) {
    const scrollY = i * viewportHeight;
    const scrollResp = await sendTabMessage(tabId, {
      action: "scrollTo",
      y: scrollY,
      hideFixed: i > 0,
    });

    await delay(600); // wait for rendering and respect capture quota

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    captures.push(dataUrl);
    // Use the actual scrollY reported by the page (it may clamp at bottom)
    scrollPositions.push(
      scrollResp && typeof scrollResp.actualY === "number" ? scrollResp.actualY : scrollY
    );
  }

  // 5. Restore page: unhide fixed elements, restore zoom
  await sendTabMessage(tabId, { action: "restorePage" });
  await new Promise((resolve) =>
    chrome.tabs.setZoom(tabId, originalZoom, () => resolve())
  );

  // 6. Derive effective DPR from the ACTUAL captured image width.
  // captureVisibleTab returns physical pixels; CSS viewport width is
  // post-zoom. Their ratio is the only reliable scale factor — using
  // the pre-zoom devicePixelRatio here was the cause of right-side cropping.
  const firstImg = await loadImage(captures[0]);
  if (!firstImg.width || !firstImg.height) {
    throw new Error("Screenshot capture returned an empty image. Please try again.");
  }
  const physicalViewportWidth = firstImg.width;
  const physicalViewportHeight = firstImg.height;
  const effectiveDpr = zoomedViewportWidth > 0
    ? physicalViewportWidth / zoomedViewportWidth
    : 1;

  const fullCanvasWidth = physicalViewportWidth;
  // Guarantee a non-zero canvas height even if totalHeight reads as 0.
  const canvasHeight = Math.max(
    physicalViewportHeight,
    Math.round((totalHeight || viewportHeight) * effectiveDpr)
  );
  const fullCanvas = new OffscreenCanvas(fullCanvasWidth, canvasHeight);
  const fullCtx = fullCanvas.getContext("2d");

  // 7. Stitch using actual scroll positions to avoid bottom-frame overlap
  for (let i = 0; i < captures.length; i++) {
    const img = i === 0 ? firstImg : await loadImage(captures[i]);
    if (!img.width || !img.height) continue;
    const drawY = Math.round(scrollPositions[i] * effectiveDpr);
    const remainingHeight = canvasHeight - drawY;
    if (remainingHeight <= 0) continue;
    const drawHeight = Math.min(img.height, remainingHeight);

    fullCtx.drawImage(
      img,
      0, 0, img.width, drawHeight,
      0, drawY, img.width, drawHeight
    );
  }

  // 8. Crop to content area (remove any remaining side margins).
  // Clamp every dimension to keep the OffscreenCanvas size strictly > 0.
  const cropX = Math.round((zoomedContentLeft || 0) * effectiveDpr);
  const cropW = Math.round((zoomedContentWidth || zoomedViewportWidth) * effectiveDpr);
  const padding = Math.round(16 * effectiveDpr);
  const finalX = Math.max(0, Math.min(fullCanvasWidth - 1, cropX - padding));
  const desiredW = (cropW > 0 ? cropW : fullCanvasWidth) + padding * 2;
  const finalW = Math.max(1, Math.min(fullCanvasWidth - finalX, desiredW));

  let outputCanvas = fullCanvas;
  // Skip cropping if it would not actually change anything
  if (finalX > 0 || finalW < fullCanvasWidth) {
    const croppedCanvas = new OffscreenCanvas(finalW, canvasHeight);
    const croppedCtx = croppedCanvas.getContext("2d");
    croppedCtx.drawImage(
      fullCanvas,
      finalX, 0, finalW, canvasHeight,
      0, 0, finalW, canvasHeight
    );
    outputCanvas = croppedCanvas;
  }

  // 9. Export as PNG blob -> Uint8Array
  const blob = await outputCanvas.convertToBlob({ type: "image/png" });
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ---- History Management ----

const HISTORY_KEY = "html2md_history";
const MAX_HISTORY = 200;

async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

async function saveHistory(record) {
  const history = await getHistory();
  const entry = {
    id: Date.now(),
    title: record.title,
    url: record.url,
    date: new Date().toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }),
    images: record.images || 0,
  };
  history.unshift(entry);
  // Limit history size
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function deleteHistory(id) {
  let history = await getHistory();
  history = history.filter((h) => h.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  await loadHistory();
  await updateHistoryBadge();
}

async function clearAllHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  await loadHistory();
  await updateHistoryBadge();
}

async function checkCurrentPage(url) {
  const history = await getHistory();
  const found = history.find((h) => h.url === url);
  if (found) {
    convertedBadge.classList.add("show");
  }
}

async function updateHistoryBadge() {
  const history = await getHistory();
  const count = history.length;
  if (count > 0) {
    historyCountEl.textContent = count;
    historyCountEl.style.display = "inline-block";
  } else {
    historyCountEl.style.display = "none";
  }
}

async function loadHistory(filter = "") {
  let history = await getHistory();
  if (filter) {
    const q = filter.toLowerCase();
    history = history.filter(
      (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
    );
  }

  if (history.length === 0) {
    historyListEl.innerHTML = '<div class="history-empty">' +
      (filter ? "No matching results." : "No conversion history yet.") + '</div>';
    historyStatsEl.textContent = "";
    return;
  }

  let html = "";
  for (const item of history) {
    const escapedTitle = escapeHtml(item.title);
    const domain = getDomain(item.url);
    html += '<div class="history-item" data-id="' + item.id + '">' +
      '<div class="history-item-title" data-url="' + escapeHtml(item.url) + '" title="' + escapedTitle + '">' +
      escapedTitle + '</div>' +
      '<div class="history-item-meta">' +
      '<span class="history-item-info">' + domain + ' | ' + item.date + ' | ' + item.images + ' img</span>' +
      '<button class="history-item-delete" data-id="' + item.id + '" title="Delete">&times;</button>' +
      '</div></div>';
  }
  historyListEl.innerHTML = html;

  const allHistory = await getHistory();
  historyStatsEl.textContent = "Total: " + allHistory.length + " article(s)";

  // Event delegation for clicks
  historyListEl.querySelectorAll(".history-item-title").forEach((el) => {
    el.addEventListener("click", () => {
      chrome.tabs.create({ url: el.dataset.url });
    });
  });
  historyListEl.querySelectorAll(".history-item-delete").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistory(parseInt(el.dataset.id));
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// ---- History event listeners ----

historySearchEl.addEventListener("input", () => {
  loadHistory(historySearchEl.value.trim());
});

clearAllBtn.addEventListener("click", () => {
  if (confirm("Clear all conversion history?")) {
    clearAllHistory();
  }
});
