/**
 * Core HTML → Markdown conversion engine (Node.js)
 * Shared logic used by both Electron main process and CLI
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
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

// --- GFM Table Rule ---
function collectTrNodes(node) {
  const result = [];
  function walk(n) {
    if (!n || !n.childNodes) return;
    for (let i = 0; i < n.childNodes.length; i++) {
      const child = n.childNodes[i];
      const name = (child.nodeName || "").toUpperCase();
      if (name === "TR") result.push(child);
      else if (name === "THEAD" || name === "TBODY" || name === "TFOOT") walk(child);
    }
  }
  walk(node);
  return result;
}

function getNodeText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || node.textContent || "";
  let text = "";
  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      text += getNodeText(node.childNodes[i]);
    }
  }
  return text;
}

turndown.addRule("table", {
  filter: ["table"],
  replacement: function (content, node) {
    const trEls = collectTrNodes(node);
    if (trEls.length === 0) return content;

    const rows = [];
    for (const tr of trEls) {
      const cells = [];
      if (tr.childNodes) {
        for (let i = 0; i < tr.childNodes.length; i++) {
          const cell = tr.childNodes[i];
          const tag = (cell.nodeName || "").toUpperCase();
          if (tag === "TD" || tag === "TH") {
            const text = getNodeText(cell).trim().replace(/\|/g, "\\|").replace(/\n/g, " ");
            cells.push(text);
          }
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

// Strikethrough support
turndown.addRule("strikethrough", {
  filter: ["del", "s", "strike"],
  replacement: function (content) {
    return "~~" + content + "~~";
  },
});

// Task list support
turndown.addRule("taskListItems", {
  filter: function (node) {
    return node.nodeName === "LI" && node.querySelector('input[type="checkbox"]');
  },
  replacement: function (content, node) {
    const checkbox = node.querySelector('input[type="checkbox"]');
    const checked = checkbox && checkbox.checked;
    return "- [" + (checked ? "x" : " ") + "] " + content.replace(/^\s+/, "");
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

/**
 * Download a remote image with retry and exponential backoff.
 * Borrowed from wechat-article-exporter's BaseDownloader pattern.
 */
function downloadRemoteImage(url, assetsDir, maxRetries = 3) {
  return new Promise((resolve) => {
    const attempt = (retriesLeft) => {
      const proto = url.startsWith("https") ? https : http;
      const req = proto.get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: new URL(url).origin + "/",
          },
          timeout: 20000,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirects (up to 5)
            const redirectUrl = new URL(res.headers.location, url).href;
            if (maxRetries > 5) {
              res.resume();
              resolve(null);
              return;
            }
            res.resume();
            downloadRemoteImage(redirectUrl, assetsDir, maxRetries).then(resolve);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            if (retriesLeft > 0) {
              const delay = Math.pow(2, 3 - retriesLeft) * 1000;
              setTimeout(() => attempt(retriesLeft - 1), delay);
            } else {
              resolve(null);
            }
            return;
          }

          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (buf.length < 200) {
              resolve(null);
              return;
            }

            // Detect extension from content-type or URL
            const ct = (res.headers["content-type"] || "").toLowerCase();
            let ext = "png";
            if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
            else if (ct.includes("webp")) ext = "webp";
            else if (ct.includes("gif")) ext = "gif";
            else if (ct.includes("svg")) ext = "svg";
            else {
              const urlExt = url.match(/\.(png|jpg|jpeg|gif|webp|svg)(?:\?|$)/i);
              if (urlExt) ext = urlExt[1].toLowerCase().replace("jpeg", "jpg");
            }

            const h = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
            const fname = `img_${h}.${ext}`;
            const fpath = path.join(assetsDir, fname);

            if (!fs.existsSync(fpath)) {
              fs.mkdirSync(assetsDir, { recursive: true });
              fs.writeFileSync(fpath, buf);
            }
            resolve(`./assets/${fname}`);
          });
          res.on("error", () => {
            if (retriesLeft > 0) {
              const delay = Math.pow(2, 3 - retriesLeft) * 1000;
              setTimeout(() => attempt(retriesLeft - 1), delay);
            } else {
              resolve(null);
            }
          });
        }
      );

      req.on("error", () => {
        if (retriesLeft > 0) {
          const delay = Math.pow(2, 3 - retriesLeft) * 1000;
          setTimeout(() => attempt(retriesLeft - 1), delay);
        } else {
          resolve(null);
        }
      });

      req.on("timeout", () => {
        req.destroy();
        if (retriesLeft > 0) {
          const delay = Math.pow(2, 3 - retriesLeft) * 1000;
          setTimeout(() => attempt(retriesLeft - 1), delay);
        } else {
          resolve(null);
        }
      });
    };

    attempt(maxRetries);
  });
}

/**
 * Extract CSS background images from inline styles.
 * Borrowed from wechat-article-exporter's Exporter.ts regex pattern.
 */
function extractBackgroundImages($, contentEl, assetsDir) {
  let count = 0;
  const bgRegex = /(?:background|background-image)\s*:\s*url\(["']?((?:https?:)?\/\/[^"')]+)["']?\)/gi;

  contentEl.find("[style]").each(function () {
    const el = $(this);
    const style = el.attr("style") || "";
    let match;
    while ((match = bgRegex.exec(style)) !== null) {
      let url = match[1];
      if (url.startsWith("//")) url = "https:" + url;
      if (!url.startsWith("http")) continue;

      // Create an <img> tag so Turndown can convert it
      const img = $(`<img src="${url}" alt="">`);
      el.append(img);
      count++;
    }
  });

  return count;
}

/**
 * Detect code block language from class names.
 * e.g. class="language-python", class="hljs python", class="brush:python"
 */
function detectCodeLanguage(el) {
  const cls = el.attr("class") || "";
  // language-xxx
  let m = cls.match(/(?:language|lang|highlight)\s*-\s*(\w+)/);
  if (m) return m[1];
  // hljs xxx or code-block xxx
  m = cls.match(/(?:hljs|code-block|code_block)\s+(\w+)/);
  if (m) return m[1];
  // brush:xxx
  m = cls.match(/brush\s*:\s*(\w+)/);
  if (m) return m[1];
  return "";
}

function processImages($, contentEl, assetsDir, download) {
  let count = 0;

  // First extract CSS background images as <img> tags
  if (download) {
    count += extractBackgroundImages($, contentEl, assetsDir);
  }

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

    // Remote URL — handled synchronously placeholder; async path used in main process
    if (src.startsWith("http")) {
      // Mark for async download; don't remove
      return;
    }
    if (dataSrc && dataSrc.startsWith("http")) {
      img.attr("src", dataSrc);
      return;
    }

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
 * @returns {Promise<{ outputPath: string, title: string, images: number, error: string|null }>}
 */
async function convertFile(htmlPath, options = {}) {
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

  // Process images (base64 + background image extraction)
  let imgCount = processImages($, contentEl, assetsDir, download);

  // Download remote images asynchronously with retry
  if (download) {
    const remoteImgs = [];
    contentEl.find("img").each(function () {
      const img = $(this);
      const src = img.attr("src") || "";
      if (src.startsWith("http")) {
        remoteImgs.push({ el: img, url: src });
      }
    });

    // Concurrent download with limit (borrowed from wechat-article-exporter's Promise.race pattern)
    const concurrency = 5;
    const active = new Set();
    for (const item of remoteImgs) {
      const p = downloadRemoteImage(item.url, assetsDir).then((result) => {
        if (result) {
          item.el.attr("src", result);
          imgCount++;
        } else {
          item.el.remove();
        }
      });
      active.add(p);
      p.finally(() => active.delete(p));
      if (active.size >= concurrency) {
        await Promise.race(active);
      }
    }
    if (active.size > 0) await Promise.all(active);
  } else {
    // Remove remote images when download disabled
    contentEl.find("img").each(function () {
      const src = $(this).attr("src") || "";
      if (src.startsWith("http")) $(this).remove();
    });
  }

  // Convert section-based tables (WeChat style) to <table>
  contentEl.find("section").each(function () {
    const el = $(this);
    const style = (el.attr("style") || "").replace(/\s/g, "");
    if (!style.includes("display:flex") && !style.includes("display:grid")) return;

    const children = el.children("section, p").toArray();
    if (children.length < 2) return;

    let colCount = 0;
    let isGrid = true;

    for (let i = 0; i < children.length; i++) {
      const subChildren = $(children[i]).children("section, p, span").toArray();
      if (subChildren.length === 0) { isGrid = false; break; }
      if (i === 0) colCount = subChildren.length;
      else if (subChildren.length !== colCount) { isGrid = false; break; }
    }

    if (!isGrid || colCount < 2 || children.length < 2) return;

    let tableHtml = "<table><tbody>";
    for (let r = 0; r < children.length; r++) {
      tableHtml += "<tr>";
      const cells = $(children[r]).children("section, p, span").toArray();
      for (let c = 0; c < cells.length; c++) {
        const tag = r === 0 ? "th" : "td";
        tableHtml += `<${tag}>${$(cells[c]).html().trim()}</${tag}>`;
      }
      tableHtml += "</tr>";
    }
    tableHtml += "</tbody></table>";
    el.replaceWith(tableHtml);
  });

  // Pre-process code blocks: fix line breaks, detect language, remove "Code" labels
  contentEl.find("pre code").each(function () {
    const code = $(this);
    // Detect language from class
    const lang = detectCodeLanguage(code);
    if (lang) {
      code.attr("data-language", lang);
    }
    // Replace <br> with newline text nodes
    code.find("br").each(function () {
      $(this).replaceWith("\n");
    });
    // Unwrap <p> inside code (keep content, remove wrapper)
    code.find("p").each(function () {
      $(this).replaceWith($(this).html());
    });
  });

  // Add fenced code block with language support
  turndown.addRule("fencedCodeBlock", {
    filter: function (node) {
      return node.nodeName === "CODE" && node.parentNode && node.parentNode.nodeName === "PRE";
    },
    replacement: function (content, node) {
      const lang = node.getAttribute("data-language") || "";
      const langPrefix = lang ? lang : "";
      return "\n\n```" + langPrefix + "\n" + content.replace(/^\n+/, "").replace(/\n+$/, "") + "\n```\n\n";
    },
  });

  // Remove "Code" labels near <pre> elements
  contentEl.find("pre").each(function () {
    const pre = $(this);
    const prev = pre.prev();
    if (prev.length && prev.text().trim() === "Code") {
      prev.remove();
    }
    // Also check if "Code" label is a sibling inside parent
    const parent = pre.parent();
    if (parent.length) {
      parent.children("p, span").each(function () {
        if ($(this).text().trim() === "Code" && $(this).find("pre").length === 0) {
          $(this).remove();
        }
      });
    }
  });

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
  let md = mdRaw
    .replace(/\n{3,}/g, "\n\n")
    .replace(/!\[\]\(\s*\)/g, "")
    .replace(/ /g, " ")
    .trim();

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
