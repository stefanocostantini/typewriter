// Markdown → HTML rendering, used for the style preview and PDF export.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(src) {
  return DOMPurify.sanitize(marked.parse(src));
}

/** Suggested PDF filename, taken from the first "# Heading". */
export function documentTitle(src) {
  const m = src.match(/^#\s+(.+)$/m);
  const raw = m ? m[1] : 'document';
  return raw
    .replace(/[\\/:*?"<>|#`*_~[\]]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .trim() || 'document';
}

// Screen-only "sheet of paper" look for the preview. Never affects the PDF.
const PAPER_CHROME = `
  @media screen {
    html { background: transparent; }
    body { margin: 0; padding: 28px clamp(8px, 3vw, 32px) 80px; }
    .doc {
      box-sizing: border-box;
      background: #fff;
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: clamp(18px, 6vw, 22mm) clamp(16px, 5vw, 20mm);
      border-radius: 3px;
      box-shadow: 0 1px 2px rgba(0,0,0,.18), 0 18px 44px -14px rgba(0,0,0,.45);
    }
  }
  @media print { html, body { margin: 0; padding: 0; background: #fff; } }
`;

export function documentHtml({ title = 'Document', css = '', body = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<base target="_blank">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${PAPER_CHROME}</style>
<style id="user-style">${css}</style>
</head><body><article id="doc" class="doc">${body}</article></body></html>`;
}

/** Live preview in an iframe that can be updated without reloading. */
export function createPreview(iframe) {
  let doc = null;
  const ready = new Promise((resolve) => {
    iframe.addEventListener('load', () => { doc = iframe.contentDocument; resolve(); }, { once: true });
    iframe.srcdoc = documentHtml({});
  });
  return {
    async update({ css, markdown }) {
      await ready;
      doc.getElementById('user-style').textContent = css;
      doc.getElementById('doc').innerHTML = renderMarkdown(markdown);
    },
  };
}

/** Render into a hidden iframe and open the print dialog (→ "Save as PDF"). */
export function printPdf(iframe, { css, markdown }) {
  const title = documentTitle(markdown);
  return new Promise((resolve) => {
    iframe.addEventListener('load', () => {
      const win = iframe.contentWindow;
      const prevTitle = document.title;
      document.title = title; // some browsers take the filename from the top-level title
      const done = () => { document.title = prevTitle; resolve(); };
      win.addEventListener('afterprint', done, { once: true });
      setTimeout(done, 4000);
      // Give web fonts / images a moment to load before printing.
      (win.document.fonts?.ready ?? Promise.resolve()).then(() => {
        win.focus();
        win.print();
      });
    }, { once: true });
    iframe.srcdoc = documentHtml({ title, css, body: renderMarkdown(markdown) });
  });
}
