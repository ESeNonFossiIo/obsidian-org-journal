// Pure logic for the date-tree journal: no Obsidian or CodeMirror imports,
// so it can be unit-tested with plain node.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday"];
export const ENTRY_LEVEL = 4;

export const pad = (n) => String(n).padStart(2, "0");


export function dayKeys(d) {
  const y = String(d.getFullYear());
  const m = `${y}-${pad(d.getMonth() + 1)}`;
  const day = `${m}-${pad(d.getDate())}`;
  return [
    [1, y, y],
    [2, m, `${m} ${MONTHS[d.getMonth()]}`],
    [3, day, `${day} ${DAYS[d.getDay()]}`],
  ];
}

/** Index of the first line after the subtree of the heading at `idx`. */
export function subtreeEnd(lines, idx, level) {
  for (let i = idx + 1; i < lines.length; i++) {
    const m = /^(\*+) /.exec(lines[i]);
    if (m && m[1].length <= level) return i;
  }
  return lines.length;
}

/**
 * Find the heading `key` at `level` inside lines[from, to), creating it in
 * sorted position if missing. Mutates `lines`. Returns {idx, end}.
 */
export function findOrCreate(lines, from, to, level, key, text) {
  const re = new RegExp(`^\\*{${level}} (\\S+)`);
  let before = -1;
  for (let i = from; i < to; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    if (m[1] === key) return { idx: i, end: subtreeEnd(lines, i, level) };
    if (m[1] > key && before < 0) before = i;
  }
  let at = before;
  if (at < 0) {
    at = to;
    while (at > from && lines[at - 1].trim() === "") at--;
  }
  const block = [];
  const prev = at > 0 ? lines[at - 1] : "";
  if (prev.trim() !== "" && !/^\*+ /.test(prev)) block.push("");
  block.push("*".repeat(level) + " " + text);
  if (level === 3) block.push("");
  lines.splice(at, 0, ...block);
  const idx = at + block.indexOf("*".repeat(level) + " " + text);
  return { idx, end: subtreeEnd(lines, idx, level) };
}

export function formatHeading(time, title, tags, column) {
  let h = "*".repeat(ENTRY_LEVEL) + " " + time + (title ? " " + title : "");
  if (tags.length) {
    const t = ":" + tags.join(":") + ":";
    h += " ".repeat(Math.max(2, column - h.length - t.length)) + t;
  }
  return h;
}

/**
 * Add an entry for `date` to `text`. Returns {text, line} where `line` is
 * the (0-based) empty body line to put the cursor on.
 */
export function addEntry(text, date, title, tags, column) {
  const lines = text.split("\n");
  let from = 0, to = lines.length, found;
  for (const [level, key, label] of dayKeys(date)) {
    found = findOrCreate(lines, from, to, level, key, label);
    from = found.idx + 1;
    to = found.end;
  }
  const dayIdx = found.idx;
  let e = found.end;
  let removed = 0;
  while (e > dayIdx + 1 && lines[e - 1].trim() === "") { e--; removed++; }
  lines.splice(e, removed);
  const heading = formatHeading(`${pad(date.getHours())}:${pad(date.getMinutes())}`,
    title, tags, column);
  const block = ["", heading, ""];
  if (e < lines.length) block.push("");
  lines.splice(e, 0, ...block);
  if (lines[lines.length - 1] !== "") lines.push("");
  return { text: lines.join("\n"), line: e + 2 };
}

/**
 * Blocks of lines to hide so that only the path to the entry at `line`
 * (its year, month and day headings) and the entry itself stay visible.
 * Returns [first, last] 0-based inclusive line ranges.
 */
export function hiddenBlocks(text, line) {
  const lines = text.split("\n");
  const keep = new Set();
  const end = subtreeEnd(lines, line, ENTRY_LEVEL);
  for (let i = line; i < end; i++) keep.add(i);
  let level = ENTRY_LEVEL;
  for (let i = line - 1; i >= 0 && level > 1; i--) {
    const m = /^(\*+) /.exec(lines[i]);
    if (m && m[1].length < level) { keep.add(i); level = m[1].length; }
  }
  // a trailing "" is just the file's final newline, not a line to hide
  const last = lines[lines.length - 1] === "" ? lines.length - 2 : lines.length - 1;
  const out = [];
  for (let i = 0; i <= last; i++) {
    if (keep.has(i)) continue;
    if (out.length && out[out.length - 1][1] === i - 1) out[out.length - 1][1] = i;
    else out.push([i, i]);
  }
  return out;
}

/** Line of today's day heading, or -1. */
export function findDay(text, date) {
  const key = dayKeys(date)[2][1];
  const re = new RegExp(`^\\*{3} ${key}(\\s|$)`);
  return text.split("\n").findIndex((l) => re.test(l));
}

/** Split "title   :a:b:" into {title, tags}. */
export function splitHeadingTags(rest) {
  const tm = /^(.*?)\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(rest);
  return {
    title: (tm ? tm[1] : rest).trim(),
    tags: tm ? tm[2].split(":").filter(Boolean) : [],
  };
}

/** All entries (level-4 headings under a day heading), newest first. */
export function parseEntries(text) {
  const out = [];
  let day = null, cur = null;
  text.split("\n").forEach((ln, i) => {
    const m = /^(\*+) (.*)$/.exec(ln);
    if (m) {
      const level = m[1].length;
      if (level < ENTRY_LEVEL) {
        cur = null;
        const dm = level === 3 && /^(\d{4}-\d{2}-\d{2})\b/.exec(m[2]);
        day = dm ? dm[1] : null;
        return;
      }
      if (level === ENTRY_LEVEL && day) {
        const { title, tags } = splitHeadingTags(m[2]);
        cur = { line: i, day, heading: title, tags, body: [] };
        out.push(cur);
        return;
      }
    }
    if (cur && ln.trim() !== "") cur.body.push(ln);
  });
  return out.reverse();
}

export function parseTags(s) {
  return s.split(/[\s,:]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
}

/** Weeks of a month as arrays of 7 day numbers (null = outside the month). */
export function monthGrid(year, month, mondayFirst) {
  const first = new Date(year, month, 1).getDay();
  const lead = mondayFirst ? (first + 6) % 7 : first;
  const n = new Date(year, month + 1, 0).getDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= n; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Map "YYYY-MM-DD" -> number of entries, for every day heading in the file. */
export function dayCounts(text) {
  const counts = new Map();
  for (const l of text.split("\n")) {
    const m = /^\*{3} (\d{4}-\d{2}-\d{2})\b/.exec(l);
    if (m) counts.set(m[1], 0);
  }
  for (const e of parseEntries(text)) counts.set(e.day, (counts.get(e.day) || 0) + 1);
  return counts;
}

export function lineOffset(text, line) {
  let off = 0;
  for (let i = 0; i < line; i++) off = text.indexOf("\n", off) + 1;
  return off;
}

/** Classify a journal line for styling: year/month/day/entry heading, #+ meta line, or text. */
export function lineKind(text) {
  const m = /^(\*+) /.exec(text);
  if (m && m[1].length <= ENTRY_LEVEL) return ["year", "month", "day", "entry"][m[1].length - 1];
  if (/^#\+/.test(text)) return "meta";
  return "text";
}

/**
 * Character offsets (within the line) of the pieces of an entry heading
 * `**** HH:MM title   :tag1:tag2:`. Returns null if it isn't one.
 * `pad` is the whitespace before the tags, `colons` the ':' characters.
 */
export function entryHeadingParts(text) {
  if (!/^\*{4} \d{2}:\d{2}(\s|$)/.test(text)) return null;
  const out = { time: { from: 5, to: 10 }, pad: null, tags: [], colons: [] };
  const m = /^(.*?)(\s+)(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(text);
  if (!m || m[1].length < 10) return out;
  const start = m[1].length + m[2].length;
  out.pad = { from: m[1].length, to: start };
  for (const t of m[3].matchAll(/[^:]+/g)) {
    out.tags.push({ from: start + t.index, to: start + t.index + t[0].length });
  }
  for (let i = 0; i < m[3].length; i++) if (m[3][i] === ":") out.colons.push(start + i);
  return out;
}

/**
 * The journal as a tree, in file (chronological) order: years > months > days > entries.
 * Every node has `line` (0-based) and a short `label`; `key` is a stable id
 * like "2026/2026-10/2026-10-19" for remembering expanded folders.
 */
export function buildTree(text) {
  const years = [];
  let y, m, d;
  text.split("\n").forEach((ln, i) => {
    const h = /^(\*+) (.*)$/.exec(ln);
    if (!h) return;
    const raw = h[2].trim();
    const level = h[1].length;
    if (level === 1) {
      y = { key: raw, label: raw, line: i, months: [] };
      years.push(y); m = d = null;
    } else if (level === 2 && y) {
      const id = raw.split(/\s/)[0];
      m = { key: `${y.key}/${id}`, label: raw.replace(/^\d{4}-\d{2}\s*/, "") || raw, line: i, days: [] };
      y.months.push(m); d = null;
    } else if (level === 3 && m) {
      const id = raw.split(/\s/)[0];
      d = { key: `${m.key}/${id}`, label: raw.replace(/^\d{4}-\d{2}-/, ""), line: i, entries: [] };
      m.days.push(d);
    } else if (level === 4 && d) {
      const { title, tags } = splitHeadingTags(raw);
      d.entries.push({ label: title, tags, line: i });
    }
  });
  return years;
}

/** Length of the leading "**** " (stars + space) of a heading line, 0 if it isn't one. */
export function starsLength(text) {
  const m = /^\*+ /.exec(text);
  return m ? m[0].length : 0;
}

/** Index of the first heading line (the preamble is everything before it); -1 if none. */
export function firstHeadingLine(text) {
  return text.split("\n").findIndex((l) => /^\*+ /.test(l));
}
