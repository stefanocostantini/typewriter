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

## Hosting on GitHub Pages

Because [`vite.config.js`](./vite.config.js) uses relative paths (`base: './'`), the built app runs out-of-the-box on GitHub Pages without any path configuration changes.

### Automated Deployment (GitHub Actions)

An automated deployment workflow is preconfigured in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml).

1. Go to your repository on GitHub: **[stefanocostantini/typewriter](https://github.com/stefanocostantini/typewriter)**.
2. Click **Settings** → **Pages** (in the left sidebar).
3. Under **Build and deployment** → **Source**, select **GitHub Actions**.
4. Every time you push to the `main` branch, GitHub Actions will automatically build the app and deploy it to:
   ```
   https://stefanocostantini.github.io/typewriter/
   ```

### Manual Deployment via Branch (`gh-pages`)

If you prefer deploying via a branch:

```bash
# Install gh-pages tool (one-time)
npm install -D gh-pages

# Build and push the dist directory to the gh-pages branch
npm run build
npx gh-pages -d dist
```

Then in GitHub **Settings** → **Pages**, select **Deploy from a branch** and choose the `gh-pages` branch.

> [!TIP]
> Because GitHub Pages is served over HTTPS, the Service Worker activates automatically. You can install Typewriter as an offline PWA on any desktop (Chrome/Safari) or mobile device (iOS/Android).


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
