// CodeMirror setup: an iA Writer-style Markdown editor and a CSS editor.
import { EditorState, EditorSelection, Compartment, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView, keymap, placeholder, drawSelection, ViewPlugin, Decoration,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, syntaxTree, indentOnInput, bracketMatching,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

/* ------------------------------------------------------------------
   Markdown token styling. Classes are styled in styles.css (.md-*),
   so light/dark themes are just CSS variables.
   ------------------------------------------------------------------ */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, class: 'md-heading' },
  { tag: t.strong, class: 'md-strong' },
  { tag: t.emphasis, class: 'md-em' },
  { tag: t.strikethrough, class: 'md-strike' },
  { tag: t.link, class: 'md-link' },
  { tag: t.url, class: 'md-url' },
  { tag: t.monospace, class: 'md-code' },
  { tag: t.quote, class: 'md-quote' },
  // #, **, _, `, >, -, [, ](, table pipes … all the Markdown syntax
  { tag: [t.processingInstruction, t.escape], class: 'md-mark' },
  { tag: t.contentSeparator, class: 'md-hr' },
  { tag: t.labelName, class: 'md-label' },
  { tag: t.atom, class: 'md-task' },
  { tag: t.comment, class: 'md-comment' },
  { tag: [t.angleBracket, t.tagName, t.attributeName, t.attributeValue], class: 'md-html' },
]);

/* ------------------------------------------------------------------
   Line-level decorations: heading sizes (with the # marks hanging in
   the left margin, like iA Writer), code blocks and blockquotes.
   ------------------------------------------------------------------ */
function buildLineDecorations(view) {
  const { state } = view;
  const { doc } = state;
  const lines = new Map(); // line.from -> { cls:Set, style }

  const tag = (pos, cls, style) => {
    const line = doc.lineAt(pos);
    let entry = lines.get(line.from);
    if (!entry) lines.set(line.from, (entry = { cls: new Set(), style: '' }));
    cls.split(' ').forEach((c) => entry.cls.add(c));
    if (style) entry.style = style;
  };
  const tagRange = (from, to, cls) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      let extra = '';
      if (n === first) extra += ' is-first';
      if (n === last) extra += ' is-last';
      tag(doc.line(n).from, cls + extra);
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        let m;
        if ((m = /^ATXHeading(\d)$/.exec(name))) {
          const text = doc.lineAt(node.from).text;
          const hashes = /^(#{1,6})\s/.exec(text);
          // Hang "## " into the margin: indent by exactly its width (monospace font).
          const style = hashes ? `--hang: ${hashes[1].length + 1}ch` : '';
          tag(node.from, `cm-h cm-h${m[1]}${hashes ? ' cm-hang' : ''}`, style);
        } else if ((m = /^SetextHeading(\d)$/.exec(name))) {
          tag(node.from, `cm-h cm-h${m[1]}`);
        } else if (name === 'FencedCode' || name === 'CodeBlock') {
          tagRange(node.from, node.to, 'cm-codeblock');
          return false;
        } else if (name === 'Blockquote') {
          tagRange(node.from, node.to, 'cm-quote');
        } else if (name === 'HorizontalRule') {
          tag(node.from, 'cm-hr');
        }
        return undefined;
      },
    });
  }

  const builder = new RangeSetBuilder();
  [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([pos, { cls, style }]) => {
      const spec = { class: [...cls].join(' ') };
      if (style) spec.attributes = { style };
      builder.add(pos, pos, Decoration.line(spec));
    });
  return builder.finish();
}

const lineDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = buildLineDecorations(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildLineDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/* ------------------------------------------------------------------
   Focus mode: dim everything outside the current paragraph and keep
   the cursor vertically centred (typewriter scrolling).
   ------------------------------------------------------------------ */
function paragraphAround(state) {
  const { doc } = state;
  const head = doc.lineAt(state.selection.main.head);
  if (!head.text.trim()) return { from: head.number, to: head.number };
  let from = head.number;
  let to = head.number;
  while (from > 1 && doc.line(from - 1).text.trim()) from--;
  while (to < doc.lines && doc.line(to + 1).text.trim()) to++;
  return { from, to };
}

const dimDecoration = Decoration.line({ class: 'cm-dim' });

const focusDim = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      const { from, to } = paragraphAround(view.state);
      const builder = new RangeSetBuilder();
      for (const range of view.visibleRanges) {
        let pos = range.from;
        while (pos <= range.to) {
          const line = view.state.doc.lineAt(pos);
          if (line.number < from || line.number > to) builder.add(line.from, line.from, dimDecoration);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations }
);

const typewriterScroll = EditorState.transactionExtender.of((tr) =>
  tr.docChanged || tr.selection
    ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
    : null
);

/* ------------------------------------------------------------------
   Formatting shortcuts: ⌘B bold, ⌘I italic, ⌘K link
   ------------------------------------------------------------------ */
function toggleWrap(marker) {
  return (view) => {
    const len = marker.length;
    view.dispatch(
      view.state.changeByRange((range) => {
        const { from, to } = range;
        const doc = view.state.doc;
        const wrapped = doc.sliceString(from - len, from) === marker && doc.sliceString(to, to + len) === marker;
        if (wrapped) {
          return {
            changes: [{ from: from - len, to: from }, { from: to, to: to + len }],
            range: EditorSelection.range(from - len, to - len),
          };
        }
        return {
          changes: [{ from, insert: marker }, { from: to, insert: marker }],
          range: EditorSelection.range(from + len, to + len),
        };
      }),
      { userEvent: 'input.format' }
    );
    return true;
  };
}

function insertLink(view) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to) || 'link';
      const insert = `[${text}](https://)`;
      const urlStart = range.from + text.length + 3;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlStart, urlStart + 8),
      };
    })
  );
  return true;
}

/* ------------------------------------------------------------------
   Shared editor chrome (fonts and colours come from CSS variables)
   ------------------------------------------------------------------ */
const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-write)', lineHeight: '1.75' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'italic' },
  '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--ink)', borderColor: 'var(--line)' },
});

/* ------------------------------------------------------------------
   Public API
   ------------------------------------------------------------------ */
export function createMarkdownEditor(parent, { doc, onChange }) {
  const focusCompartment = new Compartment();

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage }), // GFM: tables, task lists, strikethrough, autolinks
        syntaxHighlighting(markdownHighlight),
        lineDecorations,
        highlightSelectionMatches(),
        placeholder('Start writing…'),
        focusCompartment.of([]),
        keymap.of([
          { key: 'Mod-b', run: toggleWrap('**') },
          { key: 'Mod-i', run: toggleWrap('*') },
          { key: 'Mod-k', run: insertLink },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        baseTheme,
        EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    },
    setFocusMode(on) {
      view.dispatch({ effects: focusCompartment.reconfigure(on ? [focusDim, typewriterScroll] : []) });
      if (on) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
    },
    focus: () => view.focus(),
  };
}

const cssHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.propertyName], color: 'var(--syn-prop)' },
  { tag: [t.className, t.tagName, t.labelName], color: 'var(--syn-selector)' },
  { tag: [t.number, t.unit, t.color], color: 'var(--syn-number)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.variableName, t.atom], color: 'var(--syn-atom)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--faint)' },
]);

export function createCssEditor(parent, { doc, onChange }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        indentOnInput(),
        bracketMatching(),
        css(),
        syntaxHighlighting(cssHighlight),
        highlightSelectionMatches(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        baseTheme,
        EditorView.theme({ '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6' } }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    focus: () => view.focus(),
  };
}
