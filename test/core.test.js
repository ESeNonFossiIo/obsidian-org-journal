// Unit tests for src/core.js (pure journal logic). Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { addEntry, findDay, parseEntries, parseTags, hiddenBlocks, monthGrid, dayCounts, lineOffset } from "../src/core.js";

const SAMPLE = `#+TITLE: Journal
* 2026
** 2026-08 August
*** 2026-08-29 Saturday

**** 23:02 Sample
Text.

** 2026-10 October
*** 2026-10-03 Saturday

**** 17:54 Another                                             :work:
More text.
`;
const headings = (t) => t.split("\n").filter((l) => /^\*+ /.test(l));

test("adds an entry under an existing day", () => {
  const r = addEntry(SAMPLE, new Date(2026, 9, 3, 18, 5), "Test", ["a", "b"], 77);
  assert.ok(r.text.includes("**** 18:05 Test"));
  assert.match(r.text.split("\n")[r.line - 1], /^\*{4} 18:05 Test\s+:a:b:$/);
  assert.equal(r.text.split("\n")[r.line], "");
});

test("creates missing month/day/year in sorted position", () => {
  let t = addEntry(SAMPLE, new Date(2026, 8, 20, 9, 0), "mid", [], 77).text;
  t = addEntry(t, new Date(2027, 0, 1, 9, 0), "ny", [], 77).text;
  assert.deepEqual(headings(t).filter((h) => !h.startsWith("**** ")), [
    "* 2026", "** 2026-08 August", "*** 2026-08-29 Saturday",
    "** 2026-09 September", "*** 2026-09-20 Sunday",
    "** 2026-10 October", "*** 2026-10-03 Saturday",
    "* 2027", "** 2027-01 January", "*** 2027-01-01 Friday",
  ]);
});

test("works on an empty file", () => {
  const r = addEntry("", new Date(2026, 0, 2, 3, 4), "x", [], 77);
  assert.equal(r.text, "* 2026\n** 2026-01 January\n*** 2026-01-02 Friday\n\n**** 03:04 x\n");
});

test("findDay", () => {
  assert.equal(findDay(SAMPLE, new Date(2026, 9, 3)), 9);
  assert.equal(findDay(SAMPLE, new Date(2026, 9, 4)), -1);
});

test("parseEntries: newest first, tags and body", () => {
  const e = parseEntries(SAMPLE);
  assert.deepEqual(e.map((x) => [x.day, x.heading, x.tags]), [
    ["2026-10-03", "17:54 Another", ["work"]],
    ["2026-08-29", "23:02 Sample", []],
  ]);
  assert.deepEqual(e[0].body, ["More text."]);
});

test("parseTags", () => {
  assert.deepEqual(parseTags("a, #b  c:d"), ["a", "b", "c", "d"]);
});

test("hiddenBlocks keeps only the path and the entry", () => {
  const r = addEntry(SAMPLE, new Date(2026, 9, 3, 18, 5), "New", [], 77);
  const lines = r.text.split("\n");
  const hidden = new Set();
  hiddenBlocks(r.text, r.line - 1).forEach(([a, b]) => { for (let i = a; i <= b; i++) hidden.add(i); });
  const visible = lines.filter((_, i) => !hidden.has(i) && i < lines.length - 1 && lines[i] !== "");
  assert.deepEqual(visible.filter((l) => /^\*+ /.test(l)), ["* 2026", "** 2026-10 October", "*** 2026-10-03 Saturday", "**** 18:05 New"]);
});

test("monthGrid: October 2026 starts on Thursday (Monday-first)", () => {
  const w = monthGrid(2026, 9, true);
  assert.deepEqual(w[0], [null, null, null, 1, 2, 3, 4]);
  assert.equal(w.at(-1).filter(Boolean).at(-1), 31);
});

test("dayCounts", () => {
  assert.deepEqual([...dayCounts(SAMPLE)], [["2026-08-29", 1], ["2026-10-03", 1]]);
});

test("lineOffset", () => assert.equal(lineOffset("a\nbb\nc", 2), 5));

import { lineKind, entryHeadingParts } from "../src/core.js";

test("lineKind", () => {
  assert.deepEqual(["* 2026", "** m", "*** d", "**** e", "***** sub", "#+TITLE: x", "text"].map(lineKind),
    ["year", "month", "day", "entry", "text", "meta", "text"]);
});

test("entryHeadingParts: time, padding and tags", () => {
  const t = "**** 21:55 Title      :a:bc:";
  const p = entryHeadingParts(t);
  assert.equal(t.slice(p.time.from, p.time.to), "21:55");
  assert.equal(t.slice(p.pad.from, p.pad.to), "      ");
  assert.deepEqual(p.tags.map((x) => t.slice(x.from, x.to)), ["a", "bc"]);
  assert.deepEqual(p.colons.map((i) => t[i]), [":", ":", ":"]);
});

test("entryHeadingParts: no tags / not an entry", () => {
  assert.equal(entryHeadingParts("**** 09:00").pad, null);
  assert.equal(entryHeadingParts("**** 09:00 x:y:").tags.length, 0);
  assert.equal(entryHeadingParts("*** 2026-10-03 Saturday"), null);
  assert.equal(entryHeadingParts("**** :a:"), null);
});

import { buildTree } from "../src/core.js";

test("buildTree: nested, chronological, short labels", () => {
  const t = buildTree(SAMPLE);
  assert.equal(t.length, 1);
  const y = t[0];
  assert.equal(y.label, "2026");
  assert.deepEqual(y.months.map((m) => [m.key, m.label]), [["2026/2026-08", "August"], ["2026/2026-10", "October"]]);
  const d = y.months[1].days[0];
  assert.deepEqual([d.key, d.label, d.line], ["2026/2026-10/2026-10-03", "03 Saturday", 9]);
  assert.deepEqual(d.entries.map((e) => [e.label, e.tags, e.line]), [["17:54 Another", ["work"], 11]]);
});

test("buildTree: empty and header-only files", () => {
  assert.deepEqual(buildTree(""), []);
  assert.deepEqual(buildTree("#+TITLE: x\n"), []);
});

import { starsLength } from "../src/core.js";

test("starsLength: headings only, never crashes on #+ or text lines", () => {
  assert.deepEqual(["* a", "**** b", "#+TITLE: x", "plain", "", "***no space"].map(starsLength), [2, 5, 0, 0, 0, 0]);
});

import { firstHeadingLine } from "../src/core.js";
test("firstHeadingLine", () => {
  assert.equal(firstHeadingLine("#+TITLE: x\n#+STARTUP: y\n* 2026\n"), 2);
  assert.equal(firstHeadingLine("* a"), 0);
  assert.equal(firstHeadingLine("no headings"), -1);
});
