/**
 * Core HTML → Markdown conversion engine (Node.js)
 * Shared logic used by both Electron main process and CLI
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

// ---------------------------------------------------------------------------
// Turndown config
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// ---------------------------------------------------------------------------
// Site selectors
// ---------------------------------------------------------------------------

const CONTENT_SELECTORS = [
  { id: "js_content" },
  { class: "rich_media_content" },
  { class: "Post-RichTextContainer" },
  { class: "article-content" },
  { class: "article__detail" },
  { class: "meteredContent" },
  { class: "page-body" },
  { tag: "article" },
  { tag: "body" },
];

const TITLE_SELECTORS = [
  { id: "activity-name" },
  { class: "rich_media_title" },
  { tag: "h1" },
];

const AUTHOR_SELECTORS = [
  { id: "js_name" },
  { class: "rich_media_meta_nickname" },
];

const DATE_SELECTORS = [{ id: "publish_time" }];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBySelectors($, selectors) {
  for (const sel of selectors) {
    let el;
    if (sel.id) el = $(`#${sel.id}`);
    else if (sel.class) el = $(`.${sel.class}`);
    else if (sel.tag) el = $(sel.tag);
    if (el && el.length) return el.first();
  }
  return null;
}

function cleanStem(stem) {
  return stem.replace(/\s*\(\d{4}[_/]\d{1,2}[_/]\d{1,2}\s+.*?\)$/, "").trim() || stem;
}

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------

function saveBase64Image(dataUri, assetsDir) {
  const m = dataUri.match(/^data:image\/([\w+]+);base64,(.+)$/s);
  if (!m) return null;

  let ext = m[1].replace("jpeg", "jpg").split("+")[0];
  const b64 = m[2];

  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 100) return null;

    const h = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
    const fname = `img_${h}.${ext}`;
    const fpath = path.join(assetsDir, fname);

    if (!fs.existsSync(fpath)) {
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(fpath, buf);
    }
    return `./assets/${fname}`;
  } catch {
    return null;
  }
}

function processImages($, contentEl, assetsDir, download) {
  let count = 0;

  contentEl.find("img").each(function () {
    const img = $(this);
    const src = img.attr("src") || "";
    const dataSrc = img.attr("data-src") || "";

    // Prefer base64 (SingleFile inlined)
    if (src.startsWith("data:image/")) {
      const result = saveBase64Image(src, assetsDir);
      if (result) {
        img.attr("src", result);
        count++;
        return;
      }
    }

    if (dataSrc.startsWith("data:image/")) {
      const result = saveBase64Image(dataSrc, assetsDir);
      if (result) {
        img.attr("src", result);
        count++;
        return;
      }
    }

    // Remote URL (note: in Electron, downloads are async; skip for now in sync path)
    // The main process handles async downloads separately if needed

    // Remove unprocessable base64 to prevent pollution
    if (src.startsWith("data:")) {
      img.remove();
    }
  });

  return count;
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

/**
 * Convert an HTML file to Markdown.
 * @param {string} htmlPath - Path to the HTML file
 * @param {object} options
 * @param {string|null} options.outputDir - Output directory (default: same as input)
 * @param {boolean} options.download - Whether to download remote images
 * @returns {{ outputPath: string, title: string, images: number, error: string|null }}
 */
function convertFile(htmlPath, options = {}) {
  const { outputDir = null, download = true } = options;

  const absPath = path.resolve(htmlPath);
  if (!fs.existsSync(absPath)) {
    return { outputPath: null, title: "", images: 0, error: `File not found: ${absPath}` };
  }

  const baseDir = path.dirname(absPath);
  const stem = cleanStem(path.basename(absPath, path.extname(absPath)));
  const outDir = outputDir ? path.resolve(outputDir) : baseDir;
  const outFile = path.join(outDir, `${stem}.md`);
  const assetsDir = path.join(outDir, "assets");

  // Read HTML
  const html = fs.readFileSync(absPath, "utf-8");
  const $ = cheerio.load(html);

  // Remove noise
  $("style, script, noscript, iframe, svg").remove();

  // Extract metadata
  const titleEl = findBySelectors($, TITLE_SELECTORS);
  const title = titleEl ? titleEl.text().trim() : $('meta[property="og:title"]').attr("content") || "";

  const authorEl = findBySelectors($, AUTHOR_SELECTORS);
  const author = authorEl
    ? authorEl.text().trim()
    : $('meta[property="og:article:author"]').attr("content") ||
      $('meta[name="author"]').attr("content") ||
      "";

  const dateEl = findBySelectors($, DATE_SELECTORS);
  const date = dateEl
    ? dateEl.text().trim()
    : ($('meta[property="article:published_time"]').attr("content") || "").slice(0, 10);

  // Extract content
  let contentEl = findBySelectors($, CONTENT_SELECTORS);
  if (!contentEl) contentEl = $("body");

  // Process images
  const imgCount = processImages($, contentEl, assetsDir, download);

  // Strip all attributes except essential ones
  contentEl.find("*").each(function () {
    const el = $(this);
    const src = el.attr("src");
    const href = el.attr("href");
    const alt = el.attr("alt");
    el.removeAttr("*");
    if (src) el.attr("src", src);
    if (href) el.attr("href", href);
    if (alt) el.attr("alt", alt);
  });

  // Convert to markdown
  const mdRaw = turndown.turndown(contentEl.html() || "");

  // Clean up
  let md = mdRaw.replace(/\n{3,}/g, "\n\n").replace(/!\[\]\(\s*\)/g, "").trim();

  // Assemble
  let parts = [];
  if (title) parts.push(`# ${title}\n`);
  const meta = [];
  if (author) meta.push(`Source: ${author}`);
  if (date) meta.push(`Date: ${date}`);
  if (meta.length) parts.push(`> ${meta.join(" | ")}\n`);
  parts.push(md);
  const final = parts.join("\n");

  // Write
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, final, "utf-8");

  return { outputPath: outFile, title, images: imgCount, error: null };
}

module.exports = { convertFile };
