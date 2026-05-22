# wx-article-to-markdown

将 SingleFile 保存的网页（微信公众号、知乎、掘金、少数派等）一键转换为 Markdown，自动提取图片到 `assets/` 目录。

## Features

- **智能内容提取** — 自动适配微信公众号、知乎、掘金、少数派、Medium、Notion 导出等主流站点
- **图片自动处理** — 优先提取 SingleFile 内联的 base64 图片，其次下载远程 URL
- **两种使用方式** — 交互式命令行 + 图形界面（GUI）
- **跨平台** — Windows / macOS / Linux，GUI 使用 tkinter（Python 内置，无需额外安装）
- **Windows 绿色版** — 可打包为单个 exe，免安装双击即用
- **批量处理** — 支持整个目录一键转换

## Quick Start

### 安装依赖

```bash
pip install -r requirements.txt
```

### 方式一：GUI 图形界面

```bash
python gui.py
```

选择文件或文件夹 → 设置输出目录 → 点击 Convert。

### 方式二：命令行

```bash
# 交互模式（直接运行，按提示操作）
python html2md.py

# 单文件转换
python html2md.py article.html

# 批量转换
python html2md.py *.html
python html2md.py ./saved_pages/

# 指定输出目录
python html2md.py article.html -o ./output/

# 跳过远程图片下载（仅提取 SingleFile 内联图片）
python html2md.py article.html --no-download
```

## Windows 绿色免安装版

```bash
# 打包 GUI 为单个 exe
python build.py

# 打包 CLI 为单个 exe
python build.py --cli

# 两者都打包
python build.py --all
```

生成的 exe 在 `dist/` 目录，双击即可运行，无需安装 Python。

## 支持的网站

| 网站 | 选择器策略 | 备注 |
|------|-----------|------|
| 微信公众号 | `#js_content` | 完整支持 |
| 知乎专栏 | `.Post-RichTextContainer` | 完整支持 |
| 掘金 | `.article-content` | 完整支持 |
| 少数派 | `.article-content` | 完整支持 |
| Medium | `.meteredContent` | 完整支持 |
| InfoQ | `.article__detail` | 完整支持 |
| Notion 导出 | `.page-body` | 完整支持 |
| 通用 | `<article>` 标签 | 尽力提取 |

其他网站通常也能正常工作 — 工具会依次尝试多种选择器，最终 fallback 到 `<body>`。

## 项目结构

```
├── core.py              # 核心转换引擎（CLI/GUI 共用）
├── html2md.py           # CLI 入口（交互式 + 参数模式）
├── gui.py               # GUI 入口（tkinter，跨平台）
├── build.py             # PyInstaller 打包脚本
├── requirements.txt     # Python 依赖
└── README.md
```

## 转换示例

输入 SingleFile 保存的微信文章：

```
文章.html  (2MB, 含内联图片)
```

输出：

```
文章.md           (10KB, 干净的 Markdown)
assets/
  img_xxxx.webp   (53KB)
  img_yyyy.webp   (51KB)
```

## License

MIT
