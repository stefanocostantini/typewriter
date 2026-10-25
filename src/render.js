import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
  @media print {
    @page { margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;

export function documentHtml({ title = 'Document', css = '', body = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<base target="_blank">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${PAPER_CHROME}</style>
<style id="user-style">${css}</style>
</head><body><header class="pdf-header" id="pdf-header"></header><article id="doc" class="doc">${body}</article><footer class="pdf-footer" id="pdf-footer"></footer></body></html>`;
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
      setTimeout(done, 5000);
      // Give web fonts / images a moment to load before printing.
      (win.document.fonts?.ready ?? Promise.resolve()).then(() => {
        setTimeout(() => {
          win.focus();
          win.print();
        }, 200);
      });
    }, { once: true });
    iframe.srcdoc = documentHtml({ title, css, body: renderMarkdown(markdown) });
  });
}

/** Render directly to a PDF Blob using jsPDF and html2canvas (used on mobile / iOS standalone PWA). */
export async function generatePdfBlob({ title = 'Document', css = '', markdown = '' }) {
  const container = document.createElement('div');
  container.className = 'doc';
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '794px'; // 210mm in standard 96 DPI CSS pixels (A4 width)
  container.style.boxSizing = 'border-box';
  container.style.background = '#ffffff';
  container.style.color = '#111111';
  container.style.padding = '22mm 20mm 24mm';
  container.style.zIndex = '-9999';
  container.style.pointerEvents = 'none';

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  container.appendChild(styleEl);

  const headerEl = document.createElement('header');
  headerEl.className = 'pdf-header';
  container.appendChild(headerEl);

  const bodyEl = document.createElement('div');
  bodyEl.innerHTML = renderMarkdown(markdown);
  container.appendChild(bodyEl);

  const footerEl = document.createElement('footer');
  footerEl.className = 'pdf-footer';
  container.appendChild(footerEl);

  document.body.appendChild(container);

  // Give web fonts a moment to ensure custom typography renders properly
  await (document.fonts?.ready ?? Promise.resolve());

  if (typeof window !== 'undefined') {
    window.html2canvas = html2canvas;
  }

  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('PDF generation timed out'));
      }, 15000);

      doc.html(container, {
        callback: () => {
          clearTimeout(timeout);
          resolve();
        },
        html2canvas: {
          scale: 1.5, // 1.5 provides crisp Retina rendering while avoiding mobile iOS WebKit canvas memory crash
          useCORS: true,
          logging: false,
        },
        x: 0,
        y: 0,
        width: 595.28,
        windowWidth: 794,
        autoPaging: 'text',
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return doc.output('blob');
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

