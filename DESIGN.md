# Design System Spec — HTML2MD

## 1. Design Tokens

### Color Palette

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg-primary` | `#ffffff` | `#18181b` | 页面背景 |
| `--bg-secondary` | `#f4f4f5` | `#27272a` | 卡片、输入框背景 |
| `--bg-tertiary` | `#e4e4e7` | `#3f3f46` | hover、active 状态 |
| `--border` | `#e4e4e7` | `#3f3f46` | 边框 |
| `--text-primary` | `#18181b` | `#fafafa` | 标题、正文 |
| `--text-secondary` | `#71717a` | `#a1a1aa` | 次要文字、label |
| `--text-muted` | `#a1a1aa` | `#71717a` | hint、placeholder |
| `--accent` | `#2563eb` | `#3b82f6` | 强调色（按钮、链接） |
| `--accent-hover` | `#1d4ed8` | `#60a5fa` | 强调色 hover |
| `--success` | `#16a34a` | `#22c55e` | 成功状态 |
| `--error` | `#dc2626` | `#ef4444` | 错误状态 |

### Typography

| Token | Value |
|-------|-------|
| `--font` | `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` |
| `--font-mono` | `"SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace` |
| `--text-xs` | `11px` |
| `--text-sm` | `13px` |
| `--text-base` | `14px` |
| `--text-lg` | `18px` |
| `--text-xl` | `24px` |

### Spacing (4px grid)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | 紧凑间距 |
| `--space-2` | `8px` | 小间距 |
| `--space-3` | `12px` | 标准间距 |
| `--space-4` | `16px` | 卡片内边距 |
| `--space-5` | `20px` | 区块间距 |
| `--space-6` | `24px` | 大间距 |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | 小元素（badge、tag） |
| `--radius-md` | `6px` | 输入框、按钮 |
| `--radius-lg` | `8px` | 卡片 |
| `--radius-xl` | `12px` | 大卡片 |

### Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `none` |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.08)` | `0 2px 8px rgba(0,0,0,0.3)` |

## 2. Layout

- 单栏居中布局，最大宽度 `640px`
- 卡片式分组，每组为一个白色圆角卡片
- 卡片间距 `--space-3`
- 无侧边栏、无三栏布局

## 3. Components

### Button
- Primary: 填充强调色，白色文字，`--radius-md`
- Secondary: 透明背景，强调色边框和文字
- Ghost: 无边框无背景，hover 出现背景色

### Input
- `--bg-secondary` 背景，`--radius-md` 圆角
- 焦点时 `--accent` 边框 + subtle shadow
- 高度 `36px`

### Card
- `--bg-primary` 背景，`--radius-lg` 圆角
- `--shadow-sm` 阴影
- padding `--space-4`

### Log Panel
- `--bg-secondary` 背景，`--radius-lg` 圆角
- `--font-mono` 字体
- light mode: 深色文字 on 浅灰背景
- dark mode: 浅色文字 on 深灰背景

### Progress Bar
- 高度 `4px`，圆角 `2px`
- 轨道: `--bg-tertiary`
- 填充: `--accent`

## 4. Dark Mode

通过 `@media (prefers-color-scheme: dark)` 自动检测系统主题。
同时在 `:root` 上提供 `data-theme="dark"` 手动切换能力。
