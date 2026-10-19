import { ViewPlugin, Decoration, WidgetType, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { lineKind, entryHeadingParts, starsLength, firstHeadingLine } from "./core.js";

/** Dispatch this to make the style plugin rebuild its decorations. */
export const refreshStyle = StateEffect.define();

class Spacer extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "oj-spacer";
    return s;
  }
}

const line = (cls) => Decoration.line({ class: `oj-line ${cls}` });

/**
 * Decorations that restyle the journal: a class per heading level, entry
 * bodies, dimmed #+ lines, the time as a badge and tags as pills (with the
 * alignment padding and colons hidden unless the cursor is on that line).
 * The leading stars are hidden on every heading except the one being edited.
 * Only active inside a `.org-journal-styled` container.
 */
function build(view) {
  try {
    return buildDecorations(view);
  } catch (err) {
    // an exception here makes CodeMirror switch the whole plugin off
    console.error("Org Journal style:", err);
    return Decoration.none;
  }
}

export function buildDecorations(view) {
  if (!view.dom.closest(".org-journal-styled")) return Decoration.none;
  const { doc, selection } = view.state;
  const out = [];
  let inEntry = false;
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    const kind = lineKind(l.text);
    if (kind === "text") {
      if (inEntry && l.text.trim() !== "") out.push(line("oj-body").range(l.from));
      continue;
    }
    inEntry = kind === "entry";
    out.push(line(`oj-${kind}`).range(l.from));
    const active = selection.ranges.some((r) => r.from <= l.to && r.to >= l.from);
    const stars = starsLength(l.text);   // 0 for "#+" meta lines
    if (!active && stars) out.push(Decoration.replace({}).range(l.from, l.from + stars));
    if (kind !== "entry") continue;
    const p = entryHeadingParts(l.text);
    if (!p) continue;
    out.push(Decoration.mark({ class: "oj-time" }).range(l.from + p.time.from, l.from + p.time.to));
    if (!p.tags.length) continue;
    for (const t of p.tags) out.push(Decoration.mark({ class: "oj-tag" }).range(l.from + t.from, l.from + t.to));
    if (active) continue;
    out.push(Decoration.replace({ widget: new Spacer() }).range(l.from + p.pad.from, l.from + p.pad.to));
    for (const c of p.colons) out.push(Decoration.replace({}).range(l.from + c, l.from + c + 1));
  }
  return Decoration.set(out, true);
}

export const stylePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) {
    if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(refreshStyle)))) {
      this.decorations = build(u.view);
    }
  }
}, { decorations: (v) => v.decorations });

/** Turn hiding of the preamble (the #+ lines before the first heading) on or off. */
export const setPreamble = StateEffect.define();

function preambleDeco(doc) {
  let end = 0;
  for (let n = 1; n <= doc.lines; n++) {
    if (/^\*+ /.test(doc.line(n).text)) { end = doc.line(n).from; break; }
  }
  return end > 0 ? Decoration.set([Decoration.replace({ block: true }).range(0, end)]) : Decoration.none;
}

export const preambleField = StateField.define({
  create: () => ({ on: false, deco: Decoration.none }),
  update(v, tr) {
    let on = v.on;
    for (const e of tr.effects) if (e.is(setPreamble)) on = e.value;
    if (on === v.on && !tr.docChanged) return v;
    return { on, deco: on ? preambleDeco(tr.state.doc) : Decoration.none };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Add the journal look to an editor if it doesn't have it yet. Returns true if added. */
export function installStyle(cm) {
  if (cm.plugin(stylePlugin)) return false;
  cm.dispatch({ effects: StateEffect.appendConfig.of([stylePlugin, preambleField]) });
  return true;
}

/** Hide/show the preamble, moving the cursor out of it when hiding. */
export function applyPreamble(cm, on) {
  if (!cm.state.field(preambleField, false)) return;
  if (cm.state.field(preambleField).on === on) return;
  cm.dispatch({ effects: setPreamble.of(on) });
  if (on) {
    const text = cm.state.doc.toString();
    const idx = firstHeadingLine(text);
    if (idx > 0) {
      const end = cm.state.doc.line(idx + 1).from;
      if (cm.state.selection.main.head < end) cm.dispatch({ selection: { anchor: end } });
    }
  }
}
