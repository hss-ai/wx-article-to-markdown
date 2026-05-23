"""Core conversion engine — shared by CLI and GUI."""

import base64
import glob
import hashlib
import os
import re
import time
import urllib.request

from bs4 import BeautifulSoup
import markdownify

__all__ = ["convert_file", "convert_batch"]


# ---------------------------------------------------------------------------
# Image handling
# ---------------------------------------------------------------------------

def _save_base64_image(data_uri: str, assets_dir: str) -> str | None:
    m = re.match(r"data:image/([\w+]+);base64,(.*)", data_uri, re.DOTALL)
    if not m:
        return None
    ext = m.group(1).replace("jpeg", "jpg").split("+")[0]
    try:
        img_bytes = base64.b64decode(m.group(2))
    except Exception:
        return None
    if len(img_bytes) < 100:
        return None
    h = hashlib.md5(img_bytes).hexdigest()[:12]
    fname = f"img_{h}.{ext}"
    fpath = os.path.join(assets_dir, fname)
    if not os.path.exists(fpath):
        os.makedirs(assets_dir, exist_ok=True)
        with open(fpath, "wb") as f:
            f.write(img_bytes)
    return f"./assets/{fname}"


def _download_image(url: str, assets_dir: str, max_retries: int = 3) -> str | None:
    ext_match = re.search(r"\.(png|jpg|jpeg|gif|webp|svg)(?:\?|$)", url, re.IGNORECASE)
    ext = ext_match.group(1).lower() if ext_match else "png"
    if ext == "jpeg":
        ext = "jpg"
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    fname = f"img_{h}.{ext}"
    fpath = os.path.join(assets_dir, fname)
    if os.path.exists(fpath):
        return f"./assets/{fname}"

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://mp.weixin.qq.com/",
            })
            resp = urllib.request.urlopen(req, timeout=20)
            img_bytes = resp.read()
            if len(img_bytes) < 200:
                return None
            os.makedirs(assets_dir, exist_ok=True)
            with open(fpath, "wb") as f:
                f.write(img_bytes)
            return f"./assets/{fname}"
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            continue
    return None


def _extract_background_images(content, assets_dir: str, download: bool = True) -> int:
    """Extract CSS background images from inline styles as <img> tags."""
    if not download:
        return 0

    bg_regex = re.compile(
        r'(?:background|background-image)\s*:\s*url\(["\']?((?:https?:)?//[^"\']+)["\']?\)',
        re.IGNORECASE,
    )
    count = 0
    for el in content.find_all(attrs={"style": True}):
        style = el.get("style", "")
        for match in bg_regex.finditer(style):
            url = match.group(1)
            if url.startswith("//"):
                url = "https:" + url
            if not url.startswith("http"):
                continue
            img = content.new_tag("img", src=url, alt="")
            el.append(img)
            count += 1
    return count


def _process_images(content, assets_dir: str, download: bool = True) -> int:
    """Process all img tags. Returns count of images saved."""
    count = 0
    for img in content.find_all("img"):
        src = img.get("src") or ""
        data_src = img.get("data-src") or ""

        # Prefer base64 (SingleFile inlined)
        if src.startswith("data:image/"):
            result = _save_base64_image(src, assets_dir)
            if result:
                img["src"] = result
                count += 1
                continue

        if data_src.startswith("data:image/"):
            result = _save_base64_image(data_src, assets_dir)
            if result:
                img["src"] = result
                count += 1
                continue

        # Try URL download: prefer data-src (original), then src
        url = data_src if data_src.startswith("http") else (src if src.startswith("http") else "")
        if url and download:
            result = _download_image(url, assets_dir)
            if result:
                img["src"] = result
                count += 1
                continue

        # Remove unprocessable base64 to prevent pollution
        if src.startswith("data:"):
            img.decompose()

    return count


# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------

_CONTENT_SELECTORS = [
    {"id": "js_content"},                          # WeChat
    {"class_": "rich_media_content"},              # WeChat fallback
    {"class_": "Post-RichTextContainer"},          # Zhihu
    {"class_": "article-content"},                 # SSPai / Juejin
    {"class_": "article__detail"},                 # InfoQ
    {"class_": "meteredContent"},                  # Medium
    {"class_": "page-body"},                       # Notion export
    {"name": "article"},                           # Generic
    {"name": "body"},                              # Fallback
]

_TITLE_SELECTORS = [
    {"id": "activity-name"},                       # WeChat
    {"class_": "rich_media_title"},                # WeChat
    {"name": "h1"},
]

_AUTHOR_SELECTORS = [
    {"id": "js_name"},
    {"class_": "rich_media_meta_nickname"},
]

_DATE_SELECTORS = [
    {"id": "publish_time"},
]


def _find_by_selectors(soup, selectors):
    for sel in selectors:
        attrs = {k: v for k, v in sel.items() if k != "name"}
        tag = None
        if "name" in sel:
            tag = soup.find(sel["name"], attrs or None)
        else:
            tag = soup.find(attrs=attrs)
        if tag:
            return tag
    return None


def _extract(soup):
    """Returns (content_element, title, author, date)."""
    title_tag = _find_by_selectors(soup, _TITLE_SELECTORS)
    title = title_tag.get_text(strip=True) if title_tag else ""
    if not title:
        meta = soup.find("meta", property="og:title")
        if meta:
            title = meta.get("content", "")

    author_tag = _find_by_selectors(soup, _AUTHOR_SELECTORS)
    author = author_tag.get_text(strip=True) if author_tag else ""
    if not author:
        meta = soup.find("meta", property="og:article:author") or soup.find("meta", attrs={"name": "author"})
        if meta:
            author = meta.get("content", "")

    date_tag = _find_by_selectors(soup, _DATE_SELECTORS)
    date = date_tag.get_text(strip=True) if date_tag else ""
    if not date:
        meta = soup.find("meta", property="article:published_time")
        if meta:
            date = meta.get("content", "")[:10]

    content = _find_by_selectors(soup, _CONTENT_SELECTORS)
    if not content:
        content = soup.find("body") or soup

    return content, title, author, date


# ---------------------------------------------------------------------------
# Code block language detection
# ---------------------------------------------------------------------------

def _detect_code_language(cls: str) -> str:
    """Detect language from class names like 'language-python', 'hljs python'."""
    m = re.search(r"(?:language|lang|highlight)\s*-\s*(\w+)", cls)
    if m:
        return m.group(1)
    m = re.search(r"(?:hljs|code-block|code_block)\s+(\w+)", cls)
    if m:
        return m.group(1)
    m = re.search(r"brush\s*:\s*(\w+)", cls)
    if m:
        return m.group(1)
    return ""


# ---------------------------------------------------------------------------
# Section-based table detection (WeChat style)
# ---------------------------------------------------------------------------

def _convert_section_tables(content) -> None:
    """Convert flex/grid section layouts to <table> elements."""
    for section in content.find_all("section"):
        style = (section.get("style") or "").replace(" ", "")
        if "display:flex" not in style and "display:grid" not in style:
            continue

        children = [c for c in section.children
                    if hasattr(c, "name") and c.name in ("section", "p")]
        if len(children) < 2:
            continue

        col_count = 0
        is_grid = True

        for i, child in enumerate(children):
            sub = [c for c in child.children
                   if hasattr(c, "name") and c.name in ("section", "p", "span")]
            if not sub:
                is_grid = False
                break
            if i == 0:
                col_count = len(sub)
            elif len(sub) != col_count:
                is_grid = False
                break

        if not is_grid or col_count < 2 or len(children) < 2:
            continue

        table = BeautifulSoup("<table><tbody></tbody></table>", "html.parser")
        tbody = table.find("tbody")

        for r, row_el in enumerate(children):
            tr = table.new_tag("tr")
            cells = [c for c in row_el.children
                     if hasattr(c, "name") and c.name in ("section", "p", "span")]
            for cell_el in cells:
                tag_name = "th" if r == 0 else "td"
                cell = table.new_tag(tag_name)
                cell.append(BeautifulSoup(cell_el.decode_contents(), "html.parser"))
                tr.append(cell)
            tbody.append(tr)

        section.replace_with(table)


# ---------------------------------------------------------------------------
# Markdown conversion
# ---------------------------------------------------------------------------

def _clean_markdown(md: str) -> str:
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"!\[\]\(\s*\)", "", md)
    md = md.replace(" ", " ")
    return md.strip()


def _clean_stem(stem: str) -> str:
    """Remove SingleFile timestamp suffix like ' (2026_5_22 09：36：58)'."""
    return re.sub(r"\s*\(\d{4}[_/]\d{1,2}[_/]\d{1,2}\s+.*?\)$", "", stem).strip() or stem


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class ConvertResult:
    __slots__ = ("input_path", "output_path", "title", "images", "error")

    def __init__(self, input_path, output_path=None, title="", images=0, error=None):
        self.input_path = input_path
        self.output_path = output_path
        self.title = title
        self.images = images
        self.error = error


def convert_file(
    html_path: str,
    output_dir: str | None = None,
    download: bool = True,
    on_progress=None,
) -> ConvertResult:
    """Convert a single HTML file to Markdown.

    Args:
        html_path: Path to the HTML file.
        output_dir: Directory for the output .md file (defaults to same dir as input).
        download: Whether to download remote images.
        on_progress: Optional callback(status_text) for progress updates.

    Returns:
        ConvertResult with details.
    """
    html_path = os.path.abspath(html_path)
    if not os.path.isfile(html_path):
        return ConvertResult(html_path, error=f"File not found: {html_path}")

    base_dir = os.path.dirname(html_path)
    stem = _clean_stem(os.path.splitext(os.path.basename(html_path))[0])

    out_dir = os.path.abspath(output_dir) if output_dir else base_dir
    out_file = os.path.join(out_dir, f"{stem}.md")
    assets_dir = os.path.join(out_dir, "assets")

    if on_progress:
        on_progress(f"Reading {os.path.basename(html_path)}...")

    with open(html_path, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()

    soup = BeautifulSoup(html, "html.parser")

    # Remove noise
    for tag in soup.find_all(["style", "script", "noscript", "iframe", "svg"]):
        tag.decompose()

    content, title, author, date = _extract(soup)

    if on_progress:
        on_progress("Extracting images...")

    img_count = _process_images(content, assets_dir, download=download)

    # Extract CSS background images
    img_count += _extract_background_images(content, assets_dir, download=download)

    # Convert section-based tables (WeChat style) to <table>
    _convert_section_tables(content)

    # Detect code block languages before stripping attributes
    code_langs = []
    for code in content.find_all("code"):
        parent = code.parent
        if parent and parent.name == "pre":
            cls = code.get("class", [])
            cls_str = " ".join(cls) if isinstance(cls, list) else str(cls)
            lang = _detect_code_language(cls_str)
            code_langs.append(lang)

    # Strip all attributes except essential ones
    for tag in content.find_all(True):
        tag.attrs = {k: v for k, v in tag.attrs.items() if k in ("src", "href", "alt")}

    if on_progress:
        on_progress("Converting to Markdown...")

    md_raw = markdownify.markdownify(
        str(content),
        heading_style="ATX",
        bullets="-",
        convert=[
            "p", "h1", "h2", "h3", "h4", "h5", "h6",
            "img", "ul", "ol", "li",
            "strong", "em", "b", "i", "del", "s", "strike",
            "blockquote", "br", "hr",
            "a", "table", "tr", "td", "th",
            "pre", "code",
            "span", "div", "section",
        ],
    )

    # Inject detected languages into fenced code blocks
    if code_langs:
        fence_idx = 0
        def _inject_lang(match):
            nonlocal fence_idx
            lang = code_langs[fence_idx] if fence_idx < len(code_langs) else ""
            fence_idx += 1
            if lang:
                return f"```{lang}"
            return match.group(0)
        md_raw = re.sub(r"^```\s*$", _inject_lang, md_raw, flags=re.MULTILINE)

    md = _clean_markdown(md_raw)

    # Assemble
    parts = []
    if title:
        parts.append(f"# {title}\n")
    meta = []
    if author:
        meta.append(f"Source: {author}")
    if date:
        meta.append(f"Date: {date}")
    if meta:
        parts.append("> " + " | ".join(meta) + "\n")
    parts.append(md)
    final = "\n".join(parts)

    os.makedirs(out_dir, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(final)

    if on_progress:
        on_progress("Done!")

    return ConvertResult(html_path, out_file, title, img_count)


def convert_batch(
    paths: list[str],
    output_dir: str | None = None,
    download: bool = True,
    on_progress=None,
) -> list[ConvertResult]:
    """Convert multiple HTML files. Returns list of results."""
    files = []
    for p in paths:
        p = os.path.abspath(p)
        if os.path.isfile(p):
            files.append(p)
        elif os.path.isdir(p):
            files.extend(sorted(glob.glob(os.path.join(p, "*.html"))))
            files.extend(sorted(glob.glob(os.path.join(p, "*.htm"))))
        else:
            matched = sorted(glob.glob(p))
            files.extend(matched)

    results = []
    for i, f in enumerate(files, 1):
        if on_progress:
            on_progress(f"[{i}/{len(files)}] {os.path.basename(f)}")
        r = convert_file(f, output_dir=output_dir, download=download)
        results.append(r)
    return results
