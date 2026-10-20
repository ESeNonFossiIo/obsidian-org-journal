// Pure logic for the date-tree journal: no Obsidian or CodeMirror imports,
// so it can be unit-tested with plain node (`npm test`).
//
// The journal is one Org file laid out as a date tree, the same shape the
// Emacs `file+olp+datetree' capture template produces:
//
//   #+TITLE: Journal                       <- preamble (before the first heading)
//   * 2026                                 <- level 1: year
//   ** 2026-10 October                     <- level 2: month
//   *** 2026-10-19 Monday                  <- level 3: day
//   **** 23:02 Title              :a:b:    <- level 4: entry (time, title, tags)
//   Free-form text...
//
// All line numbers in this module are 0-based. Functions take and return plain
// strings/arrays; none of them touch the editor or the vault.

/**
 * @typedef {Object} Entry
 * @property {number} line 0-based line of the entry heading
 * @property {string} day "YYYY-MM-DD" of the day it is under
 * @property {string} heading "HH:MM title", without the tags
 * @property {string[]} tags
 * @property {string[]} body the non-empty text lines up to the next heading
 */

/**
 * @typedef {Object} TreeEntry
 * @property {string} label "HH:MM title"
 * @property {string[]} tags
 * @property {number} line 0-based line of the entry heading
 */

/**
 * @typedef {Object} TreeDay
 * @property {string} key stable id, e.g. "2026/2026-10/2026-10-19"
 * @property {string} label e.g. "19 Monday"
 * @property {number} line 0-based line of the day heading
 * @property {TreeEntry[]} entries
 */

/**
 * @typedef {Object} TreeMonth
 * @property {string} key e.g. "2026/2026-10"
 * @property {string} label e.g. "October"
 * @property {number} line
 * @property {TreeDay[]} days
 */

/**
 * @typedef {Object} TreeYear
 * @property {string} key e.g. "2026"
 * @property {string} label e.g. "2026"
 * @property {number} line
 * @property {TreeMonth[]} months
 */

/** English month names, used in month headings ("2026-10 October"). */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
/** English weekday names (Sunday first, like Date#getDay), used in day headings. */
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday"];
/** Heading level of a journal entry (`****`). */
export const ENTRY_LEVEL = 4;

/**
 * Zero-pad a number to two digits.
 * @param {number} n
 * @returns {string} e.g. 7 -> "07"
 */
export const pad = (n) => String(n).padStart(2, "0");

/**
 * The year/month/day headings that contain a date, outermost first.
 * @param {Date} d
 * @returns {Array<[number, string, string]>} three [level, key, text] triples: `key`
 *   is what sorts and matches ("2026-10"), `text` the full heading text ("2026-10 October").
 */
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

/**
 * Index of the first line after a heading's subtree, i.e. the next heading of the
 * same or a higher level (or the end of the file).
 * @param {string[]} lines the file, one string per line
 * @param {number} idx line of the heading
 * @param {number} level the heading's level (number of stars)
 * @returns {number}
 */
export function subtreeEnd(lines, idx, level) {
  for (let i = idx + 1; i < lines.length; i++) {
    const m = /^(\*+) /.exec(lines[i]);
    if (m && m[1].length <= level) return i;
  }
  return lines.length;
}

/**
 * Find the heading `key` at `level` inside lines[from, to), creating it in sorted
 * position if missing. Mutates `lines`.
 * @param {string[]} lines the file, one string per line (modified in place)
 * @param {number} from first line of the search range
 * @param {number} to line after the search range
 * @param {number} level heading level (number of stars)
 * @param {string} key sortable id that identifies the heading ("2026-10")
 * @param {string} text full heading text used when creating it ("2026-10 October")
 * @returns {{idx: number, end: number}} line of the heading and the line after its subtree
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

/**
 * Build an entry heading line: `**** HH:MM title`, plus `:a:b:` right-aligned when
 * there are tags (at least two spaces are always kept before the tags).
 * @param {string} time "HH:MM"
 * @param {string} title may be empty
 * @param {string[]} tags
 * @param {number} column where the tags end (Org's default is 77)
 * @returns {string}
 */
export function formatHeading(time, title, tags, column) {
  let h = "*".repeat(ENTRY_LEVEL) + " " + time + (title ? " " + title : "");
  if (tags.length) {
    const t = ":" + tags.join(":") + ":";
    h += " ".repeat(Math.max(2, column - h.length - t.length)) + t;
  }
  return h;
}

/**
 * Add an entry for a date to the journal text, creating any missing year, month
 * and day heading in sorted position.
 * @param {string} text the whole journal
 * @param {Date} date decides the headings and the HH:MM of the entry
 * @param {string} title may be empty
 * @param {string[]} tags
 * @param {number} column where the tags end
 * @returns {{text: string, line: number}} the new text and the 0-based empty body
 *   line to put the cursor on
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
 * Blocks of lines to hide so that only the path to an entry (its year, month and
 * day headings) and the entry itself stay visible.
 * @param {string} text the whole journal
 * @param {number} line 0-based line of the entry heading to keep
 * @returns {Array<[number, number]>} [first, last] 0-based inclusive line ranges
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

/**
 * Line of the day heading for a date (`*** 2026-10-19 Monday`).
 * @param {string} text the whole journal
 * @param {Date} date
 * @returns {number} 0-based line, or -1 if there is no heading for that day
 */
export function findDay(text, date) {
  const key = dayKeys(date)[2][1];
  const re = new RegExp(`^\\*{3} ${key}(\\s|$)`);
  return text.split("\n").findIndex((l) => re.test(l));
}

/**
 * Split "title   :a:b:" into a title and its tags.
 * @param {string} rest heading text after the stars
 * @returns {{title: string, tags: string[]}}
 */
export function splitHeadingTags(rest) {
  const tm = /^(.*?)\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(rest);
  return {
    title: (tm ? tm[1] : rest).trim(),
    tags: tm ? tm[2].split(":").filter(Boolean) : [],
  };
}

/**
 * All entries (level-4 headings under a day heading), newest first.
 * @param {string} text the whole journal
 * @returns {Entry[]}
 */
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

/**
 * Tags used by the entries, with how many entries use each.
 * @param {Entry[]} entries
 * @returns {Array<[string, number]>} `[tag, count]`, most used first, then alphabetical
 */
export function tagCounts(entries) {
  const counts = new Map();
  for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * The entries that have all the given tags.
 * @param {Entry[]} entries
 * @param {string[]} tags no tags selects every entry
 * @returns {Entry[]} in the original order
 */
export function filterByTags(entries, tags) {
  return entries.filter((e) => tags.every((t) => e.tags.includes(t)));
}

/**
 * Parse user-typed tags ("work, #idea  home") into a clean list: split on spaces,
 * commas and colons, drop any `#`.
 * @param {string} s
 * @returns {string[]} e.g. ["work", "idea", "home"]
 */
export function parseTags(s) {
  return s.split(/[\s,:]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
}

/**
 * Weeks of a month, for drawing a calendar.
 * @param {number} year
 * @param {number} month 0-based (0 = January)
 * @param {boolean} mondayFirst weeks start on Monday (else Sunday)
 * @returns {Array<Array<number|null>>} rows of 7 day numbers; null = outside the month
 */
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

/**
 * Number of entries per day, for every day heading in the file (days with a
 * heading but no entry count 0).
 * @param {string} text the whole journal
 * @returns {Map<string, number>} "YYYY-MM-DD" -> entries
 */
export function dayCounts(text) {
  const counts = new Map();
  for (const l of text.split("\n")) {
    const m = /^\*{3} (\d{4}-\d{2}-\d{2})\b/.exec(l);
    if (m) counts.set(m[1], 0);
  }
  for (const e of parseEntries(text)) counts.set(e.day, (counts.get(e.day) || 0) + 1);
  return counts;
}

/**
 * Character offset of the start of a line.
 * @param {string} text
 * @param {number} line 0-based line number
 * @returns {number}
 */
export function lineOffset(text, line) {
  let off = 0;
  for (let i = 0; i < line; i++) off = text.indexOf("\n", off) + 1;
  return off;
}

/**
 * Classify a line for styling.
 * @param {string} text one line
 * @returns {"year"|"month"|"day"|"entry"|"meta"|"text"} heading level, `#+` line, or anything else
 */
export function lineKind(text) {
  const m = /^(\*+) /.exec(text);
  if (m && m[1].length <= ENTRY_LEVEL) return ["year", "month", "day", "entry"][m[1].length - 1];
  if (/^#\+/.test(text)) return "meta";
  return "text";
}

/**
 * Character offsets (within the line) of the pieces of an entry heading
 * `**** HH:MM title   :tag1:tag2:`.
 * @param {string} text one line
 * @returns {?{time: {from: number, to: number}, pad: ?{from: number, to: number},
 *   tags: Array<{from: number, to: number}>, colons: number[]}} null if the line is not an
 *   entry heading; `pad` is the whitespace before the tags (null without tags), `tags`
 *   the tag names without colons, `colons` the offset of each ':'.
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
 * The journal as a tree in file (chronological) order. Every node has `line`
 * (0-based) and a short `label`; `key` is a stable id like "2026/2026-10/2026-10-19"
 * for remembering which folders are expanded.
 * @param {string} text the whole journal
 * @returns {TreeYear[]}
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

/**
 * Length of the leading "**** " (stars plus space) of a heading line.
 * @param {string} text one line
 * @returns {number} 0 if the line is not a heading
 */
export function starsLength(text) {
  const m = /^\*+ /.exec(text);
  return m ? m[0].length : 0;
}

/**
 * Length of the date prefix of a month or day heading that repeats what the headings above
 * already say: `YYYY-MM ` in `** 2026-08 August`, `YYYY-MM-` in `*** 2026-08-29 Saturday`.
 * @param {string} text one line
 * @returns {{from: number, to: number}|null} offsets within the line; null if there is
 *   nothing redundant to hide (other levels, or a heading that is not date-shaped)
 */
export function redundantDatePrefix(text) {
  const kind = lineKind(text);
  const stars = starsLength(text);
  if (kind === "month" && /^\d{4}-\d{2} \S/.test(text.slice(stars))) return { from: stars, to: stars + 8 };
  if (kind === "day" && /^\d{4}-\d{2}-\d{2}(\s|$)/.test(text.slice(stars))) return { from: stars, to: stars + 8 };
  return null;
}

/**
 * Where the preamble (everything before the first heading) ends.
 * @param {string} text the whole journal
 * @returns {number} 0-based line of the first heading, or -1 if there is none
 */
export function firstHeadingLine(text) {
  return text.split("\n").findIndex((l) => /^\*+ /.test(l));
}
