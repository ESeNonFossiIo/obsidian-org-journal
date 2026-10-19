// "Hide other entries": block-replace decorations that remove line ranges from the
// journal editor without touching the text. Used right after "New entry" so only
// today's path and the new entry are visible; reopening the file shows all again.
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/**
 * Block-replace decorations ("hidden" line ranges) kept in a state field that
 * is added to the journal's editor the first time it is needed. `cm` is the
 * EditorView. Returns the effect that sets the hidden ranges: dispatch
 * `hideEffect(cm).of([{from, to}, ...])` (document offsets) to hide those
 * ranges, or `.of([])` to show everything again. The ranges follow edits.
 * Block decorations must come from a state field, not a view plugin, hence
 * the field; the effect and field are created once and shared.
 */
let hideState = null;
/**
 * Get the effect that sets the hidden line ranges of an editor, installing the field the
 * first time. Dispatch `hideEffect(cm).of([{from, to}, ...])` (document offsets) to hide
 * ranges, or `.of([])` to show everything again; the ranges follow edits.
 * Block decorations must come from a state field, not a view plugin, hence the field;
 * the effect and field are created once and shared.
 * @param {import("@codemirror/view").EditorView} cm the journal's editor
 * @returns {import("@codemirror/state").StateEffectType<Array<{from: number, to: number}>>}
 */
export function hideEffect(cm) {
  if (!hideState) {
    const effect = StateEffect.define();
    const field = StateField.define({
      create: () => Decoration.none,
      update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const e of tr.effects) {
          if (e.is(effect)) {
            deco = Decoration.set(e.value.filter((r) => r.to > r.from)
              .map((r) => Decoration.replace({ block: true }).range(r.from, r.to)));
          }
        }
        return deco;
      },
      provide: (f) => EditorView.decorations.from(f),
    });
    hideState = { effect, field };
  }
  if (!cm.state.field(hideState.field, false)) {
    cm.dispatch({ effects: StateEffect.appendConfig.of(hideState.field) });
  }
  return hideState.effect;
}
