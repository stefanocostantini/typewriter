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

/* ---------- Client-side PDF (iOS standalone PWA) ----------
   iOS home-screen apps can't reliably use window.print(), so there we build the PDF
   ourselves. jsPDF's doc.html() redraws the DOM through its own vector canvas, which
   only knows the 14 built-in PDF fonts and drops most CSS — hence "unstyled" PDFs.
   Instead we lay the document out in an isolated iframe (exactly like the preview),
   rasterise it page by page with html2canvas, and place each page image into jsPDF.
   Page breaks are chosen between lines / blocks so text is never sliced in half. */

const PX_PER_MM = 96 / 25.4;
const PAGE = { w: 794, h: 1123 }; // A4 in CSS px at 96 dpi
const MARGIN = { top: 22 * PX_PER_MM, right: 20 * PX_PER_MM, bottom: 24 * PX_PER_MM, left: 20 * PX_PER_MM };
const PT_PER_PX = 72 / 96;

// Applied after the user's stylesheet: fixes the page geometry, leaves typography alone.
const RASTER_CHROME = `
  html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
  body { width: ${PAGE.w}px; }
  .doc {
    box-sizing: border-box !important;
    width: ${PAGE.w}px !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 ${MARGIN.right}px 0 ${MARGIN.left}px !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }
  .pdf-header, .pdf-footer { display: none !important; }
`;

function rasterHtml({ title, css, body }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${title.replace(/</g, '&lt;')}</title>
<style>html { background: #fff; }</style>
<style>${css}</style>
<style>${RASTER_CHROME}</style>
</head><body><article id="doc" class="doc">${body}</article></body></html>`;
}

function loadFrame(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: 'fixed', left: '-10000px', top: '0',
    width: `${PAGE.w}px`, height: `${PAGE.h}px`, border: '0',
  });
  return new Promise((resolve) => {
    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

/** Sorted, merged list of [top, bottom] ranges that a page break must not cut through. */
function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] < last[1] - 0.5) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Work out where each page starts/ends (in px, relative to the top of .doc). */
function paginate(docEl, pageH) {
  const doc = docEl.ownerDocument;
  const win = doc.defaultView;
  const origin = docEl.getBoundingClientRect().top;
  const total = Math.ceil(docEl.getBoundingClientRect().height);
  if (total <= 0) return [];

  const candidates = [total];
  const forced = [];
  const blockers = [];
  const rel = (r) => [r.top - origin, r.bottom - origin];

  // Every rendered line of text: a break may fall below it, never through it.
  const walker = doc.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.height <= 0) continue;
      const [t, b] = rel(r);
      blockers.push([t, b]);
      candidates.push(b);
    }
  }

  for (const el of docEl.querySelectorAll('*')) {
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none') continue;
    const [t, b] = rel(el.getBoundingClientRect());
    const h = b - t;

    if (/^(block|list-item|table|table-row|flex|grid|flow-root)$/.test(cs.display)) {
      candidates.push(t, b);
    }
    // Images, rules, SVGs etc. are never split (unless taller than a page).
    if (/^(IMG|SVG|HR|VIDEO|CANVAS|INPUT)$/i.test(el.tagName) && h < pageH) blockers.push([t, b]);
    // Honour `break-inside: avoid` (code blocks, tables, quotes in the default style).
    if (cs.breakInside === 'avoid' && h < pageH) blockers.push([t, b]);
    // Honour `break-after: avoid` (headings): keep them with the start of what follows.
    if (cs.breakAfter === 'avoid') {
      const next = el.nextElementSibling;
      const end = next ? rel(next.getBoundingClientRect())[0] + 1 : b + 1;
      if (end - t < pageH / 2) blockers.push([t, end]);
    }
    // Forced breaks: `.page-break`, `break-before/after: page`.
    if (el.classList.contains('page-break') || /^(page|always|left|right)$/.test(cs.breakAfter)) forced.push(b);
    if (/^(page|always|left|right)$/.test(cs.breakBefore)) forced.push(t);
  }

  const merged = mergeRanges(blockers);
  const isClear = (c) => {
    // Binary search the last blocker starting above c.
    let lo = 0, hi = merged.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (merged[mid][0] < c - 0.5) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx < 0 || merged[idx][1] <= c + 0.5;
  };

  const breaks = [...new Set(candidates.map((c) => Math.round(c * 2) / 2))]
    .filter((c) => c > 0 && c <= total && isClear(c))
    .sort((a, b) => a - b);
  forced.sort((a, b) => a - b);

  const pages = [];
  let y = 0;
  while (y < total - 1) {
    const limit = y + pageH;
    let end = forced.find((f) => f > y + 1 && f <= limit);
    if (end === undefined) {
      if (limit >= total) end = total;
      else {
        // Furthest clean break that still fills at least 20% of the page; else hard cut.
        end = limit;
        for (let i = breaks.length - 1; i >= 0; i--) {
          if (breaks[i] > limit) continue;
          if (breaks[i] > y + pageH * 0.2) end = breaks[i];
          break;
        }
      }
    }
    pages.push([y, end]);
    y = end;
  }
  return pages;
}

/** Render to a PDF Blob that keeps the full stylesheet (used by the iOS home-screen app). */
export async function generatePdfBlob({ title = 'Document', css = '', markdown = '' }) {
  const iframe = await loadFrame(rasterHtml({ title, css, body: renderMarkdown(markdown) }));
  try {
    const fdoc = iframe.contentDocument;
    await (fdoc.fonts?.ready ?? Promise.resolve());
    await Promise.all([...fdoc.images].map((img) => img.decode?.().catch(() => {})));

    const docEl = fdoc.getElementById('doc');
    const contentH = PAGE.h - MARGIN.top - MARGIN.bottom;
    const pages = paginate(docEl, contentH);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    pdf.setProperties({ title: title.replace(/\.pdf$/i, '') });

    // 2× gives crisp text; each page canvas stays well under iOS's canvas size limit.
    const scale = 2;
    for (let i = 0; i < pages.length; i++) {
      const [y0, y1] = pages[i];
      const height = Math.ceil(y1 - y0);
      if (height <= 0) continue;
      const canvas = await html2canvas(docEl, {
        scale,
        x: 0,
        y: y0,
        width: PAGE.w,
        height,
        windowWidth: PAGE.w,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas, 'JPEG', 0, MARGIN.top * PT_PER_PX, PAGE.w * PT_PER_PX, height * PT_PER_PX, undefined, 'FAST');
      canvas.width = canvas.height = 0; // free memory right away (iOS is strict)
    }

    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}
