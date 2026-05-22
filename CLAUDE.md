# CLAUDE.md — Project Context

## Project Overview

**wx-article-to-markdown** — SingleFile 保存的网页（微信公众号、知乎等）一键转换为 Markdown，自动提取图片。

Repo: https://github.com/hss-ai/wx-article-to-markdown

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop App | Electron 35+ | Cross-platform (Win/Mac/Linux) |
| HTML Parsing | cheerio | Equivalent to Python BeautifulSoup |
| MD Conversion | turndown | Equivalent to Python markdownify |
| Packaging | electron-builder | Win: portable+NSIS, Mac: DMG, Linux: AppImage |
| CLI Alternative | Python 3.14 + BeautifulSoup + markdownify | See core.py / html2md.py / gui.py |

## Project Structure

```
├── main.js                  # Electron main process (IPC, file dialogs)
├── preload.js               # Context bridge (exposes API to renderer)
├── src/
│   └── converter.js         # Core JS conversion engine (cheerio + turndown)
├── renderer/
│   ├── index.html           # GUI layout
│   ├── styles.css           # Styles
│   └── renderer.js          # GUI logic
├── build/                   # Build resources (icons)
├── .github/workflows/
│   └── build.yml            # CI: auto-build on tag push
├── core.py                  # Python conversion engine (shared with CLI)
├── html2md.py               # Python CLI (interactive + args)
├── gui.py                   # Python tkinter GUI
├── build.py                 # PyInstaller build script
├── package.json             # Node deps + electron-builder config
└── requirements.txt         # Python deps
```

## Versioning Rules (Semantic Versioning)

Tag format: `v1.0.0`

| Type | Format | Example | When |
|------|--------|---------|------|
| Patch | v1.0.X | v1.0.1 | Bug fixes |
| Minor | v1.X.0 | v1.1.0 | New features, backward compatible |
| Major | vX.0.0 | v2.0.0 | Breaking changes |

## Release Process

1. Update `version` in `package.json`
2. Commit, tag, push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions auto-builds for Win/Mac/Linux
4. Artifacts published to GitHub Releases

## Site Selectors (Content Extraction Priority)

Content selectors are tried in order; first match wins:
1. `#js_content` — WeChat (微信公众号)
2. `.rich_media_content` — WeChat fallback
3. `.Post-RichTextContainer` — Zhihu (知乎)
4. `.article-content` — SSPai (少数派) / Juejin (掘金)
5. `.article__detail` — InfoQ
6. `.meteredContent` — Medium
7. `.page-body` — Notion export
8. `<article>` — Generic
9. `<body>` — Fallback

## Image Handling Strategy

SingleFile saves pages with images inlined as base64 in `src`, original URLs in `data-src`.

Priority:
1. `src` base64 data URI → extract and save to `assets/` (always works, no network)
2. `data-src` base64 → fallback
3. `data-src` or `src` remote URL → download (optional)
4. Unprocessable base64 → remove tag (prevent pollution)

## Key Design Decisions

- **Electron + Python dual approach**: Electron for cross-platform GUI, Python scripts as lightweight CLI alternative
- **No remote image download by default**: SingleFile already has images; avoid network dependency
- **MD5-based filenames**: Images get unique filenames based on content hash, avoiding duplicates
- **SingleFile timestamp cleanup**: Auto-remove timestamp like `(2026_5_22 09：36：58)` from output filenames

## Development

```bash
# Install dependencies
npm install

# Run in dev mode
npm start

# Build for current platform
npm run build

# Build for specific platform
npm run build:win    # Windows: portable exe + NSIS installer
npm run build:mac    # macOS: DMG
npm run build:linux  # Linux: AppImage
```

## Python CLI (alternative)

```bash
pip install -r requirements.txt

# Interactive mode
python html2md.py

# Direct
python html2md.py article.html --no-download
```
