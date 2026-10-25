// Typewriter — single-window Markdown writing app with PDF export.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/ibm-plex-mono/700-italic.css';
import '@fontsource-variable/inter';
import './styles.css';

import defaultCss from './default-style.css?raw';
import { createMarkdownEditor, createCssEditor } from './editor.js';
import { createPreview, printPdf, generatePdfBlob, documentTitle } from './render.js';

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

function getInitialCss() {
  const saved = localStorage.getItem(STORE.css);
  if (!saved) return defaultCss;
  if (saved.includes('margin: 22mm 20mm 24mm;')) {
    const updated = saved.replace('margin: 22mm 20mm 24mm;', 'margin: 0;');
    try { localStorage.setItem(STORE.css, updated); } catch {}
    return updated;
  }
  return saved;
}

const cssEditor = createCssEditor($('#css-editor'), {
  doc: getInitialCss(),
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

/* ---------- IndexedDB File Handle Storage ---------- */

const DB_NAME = 'typewriter_db';
const DB_STORE = 'handles';
const HANDLE_KEY = 'active_file_handle';

function openDatabase() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function storeFileHandle(handle) {
  try {
    const db = await openDatabase();
    if (!db) return;
    const tx = db.transaction(DB_STORE, 'readwrite');
    if (handle) {
      tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
    } else {
      tx.objectStore(DB_STORE).delete(HANDLE_KEY);
    }
  } catch (err) {
    console.warn('Could not store file handle in IndexedDB', err);
  }
}

async function getStoredFileHandle() {
  try {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

/* ---------- Permission Helpers ---------- */

async function verifyPermission(handle, readWrite = true) {
  if (!handle || typeof handle.queryPermission !== 'function') return false;
  const options = readWrite ? { mode: 'readwrite' } : { mode: 'read' };
  try {
    if ((await handle.queryPermission(options)) === 'granted') {
      return true;
    }
    if (typeof handle.requestPermission === 'function') {
      if ((await handle.requestPermission(options)) === 'granted') {
        return true;
      }
    }
  } catch (err) {
    console.warn('Permission query/request failed', err);
  }
  return false;
}

/* ---------- Save & Auto-Save ---------- */

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

  // 1. Always keep browser storage (localStorage) in sync as a fallback
  try {
    localStorage.setItem(STORE.md, mdText);
    localStorage.setItem(STORE.css, cssText);
  } catch (err) {
    console.warn('localStorage save failed', err);
  }

  // 2. If a local file is linked via File System Access API, write straight to it
  if (fileHandle) {
    try {
      // In background timers, Chrome requires permission to already be granted (cannot prompt without user gesture)
      let hasWritePerm = false;
      if (typeof fileHandle.queryPermission === 'function') {
        hasWritePerm = (await fileHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
      } else {
        hasWritePerm = true;
      }

      if (hasWritePerm) {
        const writable = await fileHandle.createWritable();
        await writable.write(mdText);
        await writable.close();
        isDirty = false;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        els.saved.textContent = `Auto-saved to ${fileHandle.name} (${timeStr})`;
        els.saved.classList.remove('dirty');
        return;
      } else {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        els.saved.textContent = `Saved in browser (${timeStr}) · Press ⌘S to sync ${fileHandle.name}`;
        return;
      }
    } catch (err) {
      console.warn('File handle auto-save failed', err);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      els.saved.textContent = `Saved in browser (${timeStr}) · Press ⌘S to sync`;
      return;
    }
  }

  // If no file handle is linked yet, it is saved in browser storage
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  els.saved.textContent = `Saved in browser (${timeStr})`;
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

async function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });

  // On iOS / iPadOS and mobile standalone PWAs, <a download> is ignored by WebKit.
  // navigator.share opens the native iOS Share Sheet ("Save to Files").
  const isMobileOrStandalone =
    /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    ('standalone' in navigator && navigator.standalone) ||
    window.matchMedia('(display-mode: standalone)').matches;

  if (isMobileOrStandalone && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User closed the share sheet
      console.warn('navigator.share failed, falling back to download link', err);
    }
  }

  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function newDocument() {
  const currentText = mdEditor.getValue().trim();
  if (currentText.length > 0 && isDirty) {
    const ok = window.confirm('You have unsaved changes. Discard them and start a new document?');
    if (!ok) return;
  }
  fileHandle = null;
  await storeFileHandle(null);
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

async function save(options = {}) {
  const forceSaveAs = options.saveAs === true;

  if (view === 'style') {
    const cssText = cssEditor.getValue();
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'typewriter-style.css',
          types: [{
            description: 'CSS Stylesheet',
            accept: { 'text/css': ['.css'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(cssText);
        await writable.close();
        toast(`Saved to ${handle.name}`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    await download('typewriter-style.css', cssText, 'text/css');
    toast('Saved style');
    return;
  }

  const text = mdEditor.getValue();

  // If we already have a linked file and not forcing Save As, write to it
  if (fileHandle && !forceSaveAs) {
    try {
      const hasPerm = await verifyPermission(fileHandle, true);
      if (hasPerm) {
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        isDirty = false;
        toast(`Saved to ${fileHandle.name}`);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        els.saved.textContent = `Saved to ${fileHandle.name} (${timeStr})`;
        els.saved.classList.remove('dirty');
        return;
      }
    } catch (err) {
      console.warn('Saving to existing handle failed, falling back to picker', err);
    }
  }

  // Modern File System Access API (Chrome, Edge, Opera)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${documentTitle(text)}.md`,
        types: [{
          description: 'Markdown File',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        }],
      });
      fileHandle = handle;
      await storeFileHandle(handle);
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      isDirty = false;
      toast(`Saved to ${fileHandle.name}`);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      els.saved.textContent = `Saved to ${fileHandle.name} (${timeStr})`;
      els.saved.classList.remove('dirty');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User canceled the picker
      console.warn('showSaveFilePicker failed, falling back to download', err);
    }
  }

  // Fallback download / share (iOS PWA, Safari, Firefox, or unsupported contexts)
  await download(`${documentTitle(text)}.md`, text, 'text/markdown');
  isDirty = false;
  toast('Saved .md');
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  els.saved.textContent = `Downloaded .md (${timeStr})`;
  els.saved.classList.remove('dirty');
}

async function loadFromHandle(handle) {
  if (!handle) return;
  try {
    const file = await handle.getFile();
    const text = await file.text();
    const isCss = /\.css$/i.test(file.name);

    if (isCss) {
      cssEditor.setValue(text);
      setView('style');
      toast(`Opened ${file.name}`);
      els.saved.textContent = `Loaded ${file.name} (style)`;
      els.saved.classList.remove('dirty');
    } else {
      if (isDirty && mdEditor.getValue().trim().length > 0) {
        const ok = window.confirm('You have unsaved changes. Discard them and open this file?');
        if (!ok) return;
      }
      fileHandle = handle;
      await storeFileHandle(handle);
      mdEditor.setValue(text);
      isDirty = false;
      setView('write');

      // Request write permission during this user gesture so autosave can write directly to disk
      const canWrite = await verifyPermission(handle, true);
      toast(`Opened ${file.name}`);
      els.saved.textContent = canWrite
        ? `Linked to ${file.name}`
        : `Opened ${file.name} (read-only · ⌘S to sync)`;
      els.saved.classList.remove('dirty');
    }
  } catch (err) {
    console.error('Failed to load file handle', err);
    toast('Failed to open file');
  }
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
      await loadFromHandle(handle);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User canceled picker
      console.warn('showOpenFilePicker failed, falling back to input', err);
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
    await storeFileHandle(null);
    mdEditor.setValue(text);
    isDirty = false;
    setView('write');
  }
  toast(`Opened ${file.name}`);
  els.saved.textContent = `Opened ${file.name}`;
  els.saved.classList.remove('dirty');
}

async function exportPdf() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone =
    ('standalone' in navigator && navigator.standalone) ||
    window.matchMedia('(display-mode: standalone)').matches;

  // On iOS (both Safari and installed standalone PWA), open the native iOS Share Sheet
  // or generate client-side PDF directly ("Save to Files" / "Print" / "Share")
  if (isIOS || isStandalone) {
    try {
      toast('Generating PDF…');
      const filename = `${documentTitle(mdEditor.getValue())}.pdf`;
      const pdfBlob = await generatePdfBlob({
        title: filename,
        css: cssEditor.getValue(),
        markdown: mdEditor.getValue(),
      });
      const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            files: [pdfFile],
            title: filename,
          });
          toast('PDF ready');
          return;
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return; // User closed share sheet
          console.warn('navigator.share failed, trying fallback download/view', shareErr);
        }
      }

      // Fallback: download or view the generated PDF blob
      const blobUrl = URL.createObjectURL(pdfBlob);
      if (isStandalone) {
        // In iOS standalone PWA, <a download> is ignored by WebKit.
        // Opening the blob URL displays it in the viewer sheet
        window.open(blobUrl, '_blank') || (window.location.href = blobUrl);
        toast('PDF opened');
      } else {
        const a = Object.assign(document.createElement('a'), {
          href: blobUrl,
          download: filename,
        });
        a.click();
        toast('Downloaded PDF');
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Client-side PDF generation failed, falling back to print dialog', err);
      toast('PDF generation failed, opening print dialog…');
    }
  }

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
els.btnSave.addEventListener('click', () => save());
els.btnOpen.addEventListener('click', openFile);
els.fileInput.addEventListener('change', () => { loadFromFileInput(els.fileInput.files[0]); els.fileInput.value = ''; });
els.btnReset.addEventListener('click', () => {
  if (!confirm('Replace your stylesheet with the default one?')) return;
  cssEditor.setValue(defaultCss);
  toast('Default style restored');
});

// Click statusbar indicator to save/sync
els.saved.style.cursor = 'pointer';
els.saved.title = 'Click to save or sync';
els.saved.addEventListener('click', () => save());

// Warn on browser tab close/reload if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (isDirty && mdEditor.getValue().trim().length > 0) {
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
  else if (k === 's') {
    e.preventDefault();
    if (e.shiftKey) {
      save({ saveAs: true });
    } else {
      save();
    }
  }
  else if (k === 'o') { e.preventDefault(); openFile(); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); setFocusMode(!focusMode); }
  else if (k === '1') { e.preventDefault(); setView('write'); }
  else if (k === '2') { e.preventDefault(); setView('style'); }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;

  // Modern browsers support getting a FileSystemFileHandle directly from drag-and-drop
  const item = e.dataTransfer.items?.[0];
  if (item && 'getAsFileSystemHandle' in item) {
    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle && handle.kind === 'file') {
        await loadFromHandle(handle);
        return;
      }
    } catch (err) {
      console.warn('getAsFileSystemHandle failed, falling back to file input', err);
    }
  }

  const file = e.dataTransfer.files?.[0];
  if (file) {
    await loadFromFileInput(file);
  }
});

/* ---------- Boot ---------- */

setView('write');
setFocusMode(focusMode);
document.fonts.ready.then(() => { moveIndicator(); mdEditor.view.requestMeasure(); });

// Restore linked file handle from IndexedDB if available
getStoredFileHandle().then(async (handle) => {
  if (!handle) return;
  try {
    await handle.getFile();
    fileHandle = handle;
    const perm = typeof handle.queryPermission === 'function'
      ? await handle.queryPermission({ mode: 'readwrite' })
      : 'prompt';
    if (perm === 'granted') {
      els.saved.textContent = `Linked to ${handle.name}`;
    } else {
      els.saved.textContent = `Linked to ${handle.name} (⌘S to sync)`;
    }
  } catch (err) {
    console.warn('Stored file handle is no longer accessible', err);
    fileHandle = null;
    await storeFileHandle(null);
  }
});

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  } else {
    // In development, make sure no service worker serves stale files.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  }
}

