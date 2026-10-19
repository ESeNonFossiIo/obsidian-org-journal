// Tests for the journal look (src/style.js) against real CodeMirror state, using a
// minimal fake view. Set JOURNAL=/path/to/journal.org to also run it on a real file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import { buildDecorations } from "../src/style.js";

const fakeView = (doc, pos = 0) => ({
  state: EditorState.create({ doc, selection: { anchor: pos } }),
  dom: { closest: () => ({}) },
});
const count = (set) => { let n = 0; set.between(0, 1e9, () => { n++; }); return n; };

test("builds decorations for a journal with #+ header lines without throwing", () => {
  const doc = "#+TITLE: Journal\n#+STARTUP: overview\n* 2026\n** 2026-10 October\n*** 2026-10-03 Saturday\n\n**** 17:54 Title      :a:b:\nbody\n";
  assert.ok(count(buildDecorations(fakeView(doc))) > 0);
});

test("works on the real journal if present", { skip: !process.env.JOURNAL }, () => {
  const doc = readFileSync(process.env.JOURNAL, "utf8");
  assert.ok(count(buildDecorations(fakeView(doc))) > 0);
});

test("does nothing outside a styled container", () => {
  const v = fakeView("* 2026\n");
  v.dom.closest = () => null;
  assert.equal(count(buildDecorations(v)), 0);
});

import { preambleField, setPreamble } from "../src/style.js";

test("preamble field hides only the lines before the first heading", () => {
  const doc = "#+TITLE: J\n#+STARTUP: o\n* 2026\ntext\n";
  let st = EditorState.create({ doc, extensions: [preambleField] });
  let ranges = [];
  const collect = (s) => { ranges = []; s.field(preambleField).deco.between(0, 1e9, (f, t) => { ranges.push([f, t]); }); return ranges; };
  assert.deepEqual(collect(st), []);                       // off by default
  st = st.update({ effects: setPreamble.of(true) }).state;
  assert.deepEqual(collect(st), [[0, doc.indexOf("* 2026")]]);
  st = st.update({ changes: { from: doc.length, insert: "more\n" } }).state;   // stays correct after edits
  assert.deepEqual(collect(st), [[0, doc.indexOf("* 2026")]]);
  st = st.update({ effects: setPreamble.of(false) }).state;
  assert.deepEqual(collect(st), []);
});
