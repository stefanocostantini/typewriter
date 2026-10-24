// Typewriter — single-window Markdown writing app with PDF export.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/ibm-plex-mono/700-italic.css';
import '@fontsource-variable/inter';
import './styles.css';

import defaultCss from './default-style.css?raw';
import { createMarkdownEditor, createCssEditor } from './editor.js';
import { createPreview, printPdf, documentTitle } from './render.js';

const $ = (sel) => document.querySelector(sel);

const STORE = { md: 'typewriter.markdown', css: 'typewriter.css', focus: 'typewriter.focus' };

const SAMPLE = `# Hello, Typewriter

This is a *single-window* writing space. The Markdown stays right where you type it, styled as you go: **bold** is bold, _italic_ is italic, \`code\` looks like code and ~~mistakes~~ get struck through.

## Things to try

- [x] Write GitHub-flavored Markdown
- [ ] Press **Focus** to dim everything but the paragraph you're writing
- [ ] Switch to **PDF Style** to tweak how the export looks
- [ ] Hit ⌘P to export a PDF

> The first draft of anything is rubbish. Just keep typing.

### Shortcuts

| Action        | Keys  |
| ------------- | ----- |
| Bold / Italic | ⌘B ⌘I |
| Link          | ⌘K    |
| Export PDF    | ⌘P    |
| Save .md      | ⌘S    |

\`\`\`js
const draft = write();
export(draft, 'pdf');
\`\`\`

Read more about GFM at https://github.github.com/gfm/
`;

const els = {
  segs: [...document.querySelectorAll('.seg')],
  indicator: $('.seg-indicator'),
  writeView: $('#write-view'),
  styleView: $('#style-view'),
  btnFocus: $('#btn-focus'),
  btnReset: $('#btn-reset-style'),
  btnOpen: $('#btn-open'),
  btnSave: $('#btn-save'),
  btnPdf: $('#btn-pdf'),
  fileInput: $('#file-input'),
  count: $('#status-count'),
  saved: $('#status-saved'),
  printFrame: $('#print-frame'),
  drop: $('#drop-overlay'),
  toast: $('#toast'),
};

/* ---------- State ---------- */

let view = 'write';
let focusMode = localStorage.getItem(STORE.focus) === '1';

const mdEditor = createMarkdownEditor($('#md-editor'), {
  doc: localStorage.getItem(STORE.md) ?? SAMPLE,
  onChange: () => { scheduleSave(); updateCount(); markTyping(); },
});

const cssEditor = createCssEditor($('#css-editor'), {
  doc: localStorage.getItem(STORE.css) ?? defaultCss,
  onChange: () => { scheduleSave(); schedulePreview(); updateCount(); },
});

const preview = createPreview($('#style-preview'));

/* ---------- Views ---------- */

function setView(next) {
  view = next;
  document.body.dataset.view = next;
  els.segs.forEach((s) => {
    const on = s.dataset.view === next;
    s.classList.toggle('is-active', on);
    s.setAttribute('aria-selected', String(on));
  });
  els.writeView.hidden = next !== 'write';
  els.styleView.hidden = next !== 'style';
  moveIndicator();
  updateCount();
  if (next === 'style') {
    schedulePreview();
    cssEditor.view.requestMeasure();
    cssEditor.focus();
  } else {
    mdEditor.view.requestMeasure();
    mdEditor.focus();
  }
}

function moveIndicator() {
  const active = els.segs.find((s) => s.classList.contains('is-active'));
  els.indicator.style.width = `${active.offsetWidth}px`;
  els.indicator.style.transform = `translateX(${active.offsetLeft - 3}px)`;
}

let previewRaf = 0;
function schedulePreview() {
  if (view !== 'style') return;
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(() =>
    preview.update({ css: cssEditor.getValue(), markdown: mdEditor.getValue() })
  );
}

function setFocusMode(on) {
  focusMode = on;
  els.btnFocus.setAttribute('aria-pressed', String(on));
  mdEditor.setFocusMode(on);
  localStorage.setItem(STORE.focus, on ? '1' : '0');
}

/* ---------- Status ---------- */

function updateCount() {
  if (view === 'write') {
    const text = mdEditor.getValue().trim();
    const words = text ? text.split(/\s+/).length : 0;
    els.count.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`;
  } else {
    els.count.textContent = `${cssEditor.view.state.doc.lines} lines of CSS`;
  }
}

let saveTimer = 0;
function scheduleSave() {
  els.saved.textContent = 'Editing…';
  els.saved.classList.add('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE.md, mdEditor.getValue());
      localStorage.setItem(STORE.css, cssEditor.getValue());
      els.saved.textContent = 'Saved locally';
      els.saved.classList.remove('dirty');
    } catch {
      els.saved.textContent = 'Could not save';
    }
  }, 400);
}

// Hide the toolbar while typing, like iA Writer; it returns on mouse move.
function markTyping() {
  if (view === 'write') document.body.classList.add('is-typing');
}
window.addEventListener('mousemove', (e) => {
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) document.body.classList.remove('is-typing');
});

/* ---------- Files ---------- */

function download(filename, text, type) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type })),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function save() {
  if (view === 'style') download('typewriter-style.css', cssEditor.getValue(), 'text/css');
  else download(`${documentTitle(mdEditor.getValue())}.md`, mdEditor.getValue(), 'text/markdown');
}

async function openFile(file) {
  if (!file) return;
  const text = await file.text();
  const isCss = /\.css$/i.test(file.name) || file.type === 'text/css';
  (isCss ? cssEditor : mdEditor).setValue(text);
  setView(isCss ? 'style' : 'write');
  toast(`Opened ${file.name}`);
}

async function exportPdf() {
  toast('Choose “Save as PDF” in the print dialog');
  await printPdf(els.printFrame, { css: cssEditor.getValue(), markdown: mdEditor.getValue() });
}

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

/* ---------- Wiring ---------- */

els.segs.forEach((s) => s.addEventListener('click', () => setView(s.dataset.view)));
window.addEventListener('resize', moveIndicator);

els.btnFocus.addEventListener('click', () => { setFocusMode(!focusMode); mdEditor.focus(); });
els.btnPdf.addEventListener('click', exportPdf);
els.btnSave.addEventListener('click', save);
els.btnOpen.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => { openFile(els.fileInput.files[0]); els.fileInput.value = ''; });
els.btnReset.addEventListener('click', () => {
  if (!confirm('Replace your stylesheet with the default one?')) return;
  cssEditor.setValue(defaultCss);
  toast('Default style restored');
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'p') { e.preventDefault(); exportPdf(); }
  else if (k === 's') { e.preventDefault(); save(); }
  else if (k === 'o') { e.preventDefault(); els.fileInput.click(); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); setFocusMode(!focusMode); }
  else if (k === '1') { e.preventDefault(); setView('write'); }
  else if (k === '2') { e.preventDefault(); setView('style'); }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  openFile(e.dataTransfer.files[0]);
});

/* ---------- Boot ---------- */

setView('write');
setFocusMode(focusMode);
document.fonts.ready.then(() => { moveIndicator(); mdEditor.view.requestMeasure(); });

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  } else {
    // In development, make sure no service worker serves stale files.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  }
}
