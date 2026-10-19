import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/**
 * Block-replace decorations ("hidden" line ranges) kept in a state field that
 * is added to the journal's editor the first time it is needed. Returns the
 * effect that sets the hidden ranges; `.of([])` shows everything again.
 */
let hideState = null;
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
