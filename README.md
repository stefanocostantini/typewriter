# Typewriter ✍️

A distraction-free, single-window Markdown writing PWA with live inline styling (iA Writer style) and custom CSS-driven PDF export.

## Features

- **Single-Window Editor**: Markdown formatting marks (`#`, `*`, `_`, `~`, `` ` ``, `>`) remain visible but subdued, while headings, bold, italics, strikethrough, inline code, and code blocks render live in-place.
- **Hanging Headings**: `#` marks hang subtly in the left margin for a clean reading line.
- **Focus Mode (⌘⇧F)**: Dims everything except the current active paragraph, with typewriter-style centered scrolling.
- **PDF Style View**: Full-screen split view with an editable stylesheet on the left and a live paper preview on the right.
- **Print to PDF (⌘P)**: Generates selectable, searchable vector PDFs using `@page` rules and standard browser print engines.
- **Offline / PWA Ready**: Bundled IBM Plex Mono & Inter fonts, Service Worker offline caching, and PWA manifest.
- **Local Persistence**: Drafts and custom styles save continuously to `localStorage`.
- **File Management**: Open (`⌘O`) or drag-and-drop `.md` and `.css` files; download (`⌘S`) at any time.

## Quick Start

### Development Server
```bash
# Ensure Node 20+ is in your PATH (e.g., via nvm)
npm install
npm run dev
```
Open [http://localhost:5180](http://localhost:5180).

### Production Build & Preview
```bash
npm run build
npm run preview
```

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘ B` | Toggle **bold** |
| `⌘ I` | Toggle *italic* |
| `⌘ K` | Insert link |
| `⌘ ⇧ F` | Toggle Focus mode |
| `⌘ 1` | Switch to **Write** view |
| `⌘ 2` | Switch to **PDF Style** view |
| `⌘ P` | Export as PDF |
| `⌘ S` | Save Markdown / CSS file |
| `⌘ O` | Open file |

## Project Structure

```
typewriter/
├── public/               # Static assets & icons
│   ├── icons/
│   └── manifest.webmanifest
├── src/
│   ├── default-style.css # Base CSS for preview & PDF export
│   ├── editor.js         # CodeMirror 6 setup (inline syntax styling & focus mode)
│   ├── main.js           # App orchestration & event listeners
│   ├── render.js         # Marked + DOMPurify & iframe print bridge
│   └── styles.css        # App shell UI styling (light / dark)
├── index.html            # Main entry shell
├── vite.config.js        # Vite config with offline service worker generator
└── package.json
```
