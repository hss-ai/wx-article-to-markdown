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
}

init();

// ---- Convert ----

convertBtn.addEventListener("click", async () => {
  convertBtn.disabled = true;
  statusEl.textContent = "Extracting content...";
  statusEl.className = "status";

  try {
    const tab = await getCurrentTab();

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
    const blob = await createDownloadBlob(finalMd, includeImages ? images : []);

    const safeName = (title || "article").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${safeName}.zip`,
      saveAs: true,
    });

    statusEl.textContent = `Done! ${images.length} image(s) extracted.`;
    statusEl.className = "status ok";
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = "status err";
  } finally {
    convertBtn.disabled = false;
  }
});

// ---- Package as ZIP ----

async function createDownloadBlob(markdown, images) {
  const files = [];
  files.push({ path: "article.md", data: new TextEncoder().encode(markdown) });

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
