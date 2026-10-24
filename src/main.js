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
  btnNew: $('#btn-new'),
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
const AUTOSAVE_INACTIVITY_MS = 2000; // 2 seconds of inactivity
let fileHandle = null;
let isDirty = false;

function scheduleSave() {
  isDirty = true;
  els.saved.textContent = fileHandle ? `Editing ${fileHandle.name}…` : 'Editing…';
  els.saved.classList.add('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(performAutoSave, AUTOSAVE_INACTIVITY_MS);
}

async function performAutoSave() {
  document.body.classList.remove('is-typing');
  const mdText = mdEditor.getValue();
  const cssText = cssEditor.getValue();

  // 1. Always keep localStorage in sync
  try {
    localStorage.setItem(STORE.md, mdText);
    localStorage.setItem(STORE.css, cssText);
  } catch (err) {
    console.warn('localStorage save failed', err);
  }

  // 2. If a local file is linked (via File System Access API), write straight to it
  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(mdText);
      await writable.close();
      isDirty = false;
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      els.saved.textContent = `Auto-saved to ${fileHandle.name} (${timeStr})`;
      els.saved.classList.remove('dirty');
      return;
    } catch (err) {
      console.warn('File handle auto-save failed', err);
    }
  }

  // If no file handle is linked yet, it is auto-saved locally in browser storage
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  els.saved.textContent = `Saved locally (${timeStr})`;
  els.saved.classList.remove('dirty');
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

function newDocument() {
  const currentText = mdEditor.getValue().trim();
  if (currentText.length > 0 && isDirty) {
    const ok = window.confirm('You have unsaved changes. Discard them and start a new document?');
    if (!ok) return;
  }
  fileHandle = null;
  mdEditor.setValue('');
  isDirty = false;
  try {
    localStorage.setItem(STORE.md, '');
  } catch {}
  updateCount();
  els.saved.textContent = 'New document';
  els.saved.classList.remove('dirty');
  toast('New document created');
  mdEditor.focus();
}

async function save() {
  if (view === 'style') {
    download('typewriter-style.css', cssEditor.getValue(), 'text/css');
    toast('Saved style');
    return;
  }

  const text = mdEditor.getValue();

  // Modern File System Access API (Chrome, Edge, Opera)
  if ('showSaveFilePicker' in window) {
    try {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `${documentTitle(text)}.md`,
          types: [{
            description: 'Markdown File',
            accept: { 'text/markdown': ['.md', '.markdown'] },
          }],
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      isDirty = false;
      toast(`Saved to ${fileHandle.name}`);
      els.saved.textContent = `Saved to ${fileHandle.name}`;
      els.saved.classList.remove('dirty');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User canceled the picker
      console.warn('showSaveFilePicker failed, falling back to download', err);
    }
  }

  // Fallback download (Safari, Firefox)
  download(`${documentTitle(text)}.md`, text, 'text/markdown');
  isDirty = false;
  toast('Downloaded .md');
  els.saved.textContent = 'Downloaded .md';
  els.saved.classList.remove('dirty');
}

async function openFile() {
  // Try modern File System Access API first
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Markdown or CSS Files',
          accept: {
            'text/markdown': ['.md', '.markdown'],
            'text/plain': ['.txt'],
            'text/css': ['.css'],
          },
        }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const isCss = /\.css$/i.test(file.name);

      if (isCss) {
        cssEditor.setValue(text);
        setView('style');
      } else {
        if (isDirty && mdEditor.getValue().trim().length > 0) {
          const ok = window.confirm('You have unsaved changes. Discard them and open this file?');
          if (!ok) return;
        }
        fileHandle = handle;
        mdEditor.setValue(text);
        isDirty = false;
        setView('write');
      }
      toast(`Opened ${file.name}`);
      els.saved.textContent = isCss ? 'Saved locally' : `Linked to ${file.name}`;
      els.saved.classList.remove('dirty');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User canceled picker
    }
  }

  // Fallback to hidden file input
  els.fileInput.click();
}

async function loadFromFileInput(file) {
  if (!file) return;
  const text = await file.text();
  const isCss = /\.css$/i.test(file.name) || file.type === 'text/css';
  if (isCss) {
    cssEditor.setValue(text);
    setView('style');
  } else {
    if (isDirty && mdEditor.getValue().trim().length > 0) {
      const ok = window.confirm('You have unsaved changes. Discard them and open this file?');
      if (!ok) return;
    }
    fileHandle = null;
    mdEditor.setValue(text);
    isDirty = false;
    setView('write');
  }
  toast(`Opened ${file.name}`);
  els.saved.textContent = `Opened ${file.name}`;
  els.saved.classList.remove('dirty');
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

els.btnNew.addEventListener('click', newDocument);
els.btnFocus.addEventListener('click', () => { setFocusMode(!focusMode); mdEditor.focus(); });
els.btnPdf.addEventListener('click', exportPdf);
els.btnSave.addEventListener('click', save);
els.btnOpen.addEventListener('click', openFile);
els.fileInput.addEventListener('change', () => { loadFromFileInput(els.fileInput.files[0]); els.fileInput.value = ''; });
els.btnReset.addEventListener('click', () => {
  if (!confirm('Replace your stylesheet with the default one?')) return;
  cssEditor.setValue(defaultCss);
  toast('Default style restored');
});

// Warn on browser tab close/reload if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (isDirty && mdEditor.getValue().trim().length > 0 && !fileHandle) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'n' && !e.shiftKey && !e.altKey) { e.preventDefault(); newDocument(); }
  else if (k === 'p') { e.preventDefault(); exportPdf(); }
  else if (k === 's') { e.preventDefault(); save(); }
  else if (k === 'o') { e.preventDefault(); openFile(); }
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
