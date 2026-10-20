/*
 * Org Journal -- journal helpers for a date-tree Org file.
 *
 * File layout (same as the Emacs capture template `file+olp+datetree'):
 *
 *   * 2026
 *   ** 2026-08 August
 *   *** 2026-08-29 Saturday
 *   **** 23:02 Title                                         :tag1:tag2:
 *   Free-form text...
 *
 * Works alongside the Org Reader plugin, which provides the `.org` editor
 * view (view type "org-reader", whose `codeMirror` property is the CodeMirror
 * EditorView). If the journal is open in that view, edits go through its
 * CodeMirror so nothing is clobbered by a background file write; otherwise the
 * file is changed through the vault. No Node APIs, so it runs on mobile too.
 *
 * This file is the plugin entry point: commands, ribbon icons, settings and the
 * glue between Obsidian and the pure logic in core.js. Other modules:
 *   core.js      date-tree parsing/editing, no Obsidian imports (unit-tested)
 *   style.js     "journal look" CodeMirror decorations + preamble hiding
 *   hide.js      "hide other entries" CodeMirror field
 *   calendar.js  sidebar month view     tree.js  sidebar year/month/day tree
 *   modals.js    new-entry dialog and search pickers
 *   settings.js  settings tab (defaults in settings-defaults.js)
 */
import { Plugin, Notice, TFile, normalizePath } from "obsidian";
import { unfoldAll } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { addEntry, findDay, parseEntries, hiddenBlocks, dayCounts, lineOffset } from "./core.js";
import { CalendarView, CAL_VIEW } from "./calendar.js";
import { EntryModal, EntrySearchModal, TagModal } from "./modals.js";
import { hideEffect } from "./hide.js";
import { TreeView, TREE_VIEW } from "./tree.js";
import { installStyle, refreshStyle, applyPreamble } from "./style.js";
import { OrgJournalSettings } from "./settings.js";
import { DEFAULTS } from "./settings-defaults.js";

/**
 * What `openJournal()` returns and most methods below take as `ctx`.
 * @typedef {Object} JournalContext
 * @property {import("obsidian").TFile} file the journal file
 * @property {import("@codemirror/view").EditorView} [cm] Org Reader's editor, if the
 *   file is open in that view
 */

/** @typedef {import("./core.js").Entry} Entry */

/** View type of Org Reader's `.org` view. */
const ORG_VIEW = "org-reader";

export default class OrgJournalPlugin extends Plugin {
  /**
   * Apply the configured journal name to the ribbon tooltips and open view tabs.
   * @returns {void}
   */
  applyNames() {
    const tip = this.ribbonTitles();
    for (const [k, el] of Object.entries(this.ribbon || {})) {
      el.setAttr("aria-label", tip[k]);
      el.setAttr("data-tooltip-position", "right");
    }
    for (const type of [CAL_VIEW, TREE_VIEW]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) if (leaf.updateHeader) leaf.updateHeader();
    }
  }

  /**
   * Ribbon labels built from the journal name. They are also given when the icons are
   * created: mobile builds its ribbon menu from them.
   * @returns {{tree: string, calendar: string, entry: string}}
   */
  ribbonTitles() {
    const n = this.settings.journalName;
    return { tree: `${n} tree`, calendar: `${n} calendar`, entry: `New ${n.toLowerCase()} entry` };
  }

  /**
   * Whether the Org Reader plugin (which provides the .org editor view) is enabled.
   * Assumes yes if Obsidian's internal plugin list is not available.
   * @returns {boolean}
   */
  hasOrgReader() {
    const p = this.app.plugins;
    return !p || !p.enabledPlugins || p.enabledPlugins.has("org-reader");
  }

  /**
   * Register views, ribbon icons, commands, the settings tab and the workspace listeners.
   * @returns {Promise<void>}
   */
  async onload() {
    await this.loadSettings();
    this.registerView(CAL_VIEW, (leaf) => new CalendarView(leaf, this));
    this.registerView(TREE_VIEW, (leaf) => new TreeView(leaf, this));
    const title = this.ribbonTitles();
    this.ribbon = {
      tree: this.addRibbonIcon("folder-tree", title.tree, () => this.openTree()),
      calendar: this.addRibbonIcon("calendar", title.calendar, () => this.openCalendar()),
      entry: this.addRibbonIcon("pencil", title.entry, () => this.newEntry()),
    };
    this.applyNames();
    this.addCommand({ id: "tree", name: "Open tree", callback: () => this.openTree() });
    this.addCommand({ id: "calendar", name: "Open calendar", callback: () => this.openCalendar() });
    this.addCommand({ id: "new-entry", name: "New entry", callback: () => this.newEntry() });
    this.addCommand({ id: "open-today", name: "Open today", callback: () => this.openToday() });
    this.addCommand({ id: "show-all", name: "Show all entries", callback: () => this.showAll() });
    this.addCommand({ id: "search", name: "Search entries", callback: () => this.search() });
    this.addCommand({ id: "filter-tag", name: "Filter entries by tag", callback: () => this.filterByTag() });
    this.addSettingTab(new OrgJournalSettings(this.app, this));
    const restyle = () => this.styleLeaves();
    this.registerEvent(this.app.workspace.on("file-open", restyle));
    this.registerEvent(this.app.workspace.on("active-leaf-change", restyle));
    this.registerEvent(this.app.workspace.on("layout-change", restyle));
    this.app.workspace.onLayoutReady(() => {
      if (!this.hasOrgReader()) {
        new Notice("Org Journal needs the Org Reader community plugin. Install and enable it, then reload.", 10000);
      }
      restyle();
    });
  }

  /**
   * Load saved settings over the defaults.
   * @returns {Promise<void>}
   */
  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  /**
   * Persist `this.settings` to the plugin's data.json.
   * @returns {Promise<void>}
   */
  saveSettings() { return this.saveData(this.settings); }

  /**
   * Take the journal look off open views; Obsidian removes the commands and views itself.
   * @returns {void}
   */
  onunload() {
    this.styleLeaves(true);
  }

  /**
   * Turn the journal look on for open journal views and off for the rest. The extension is
   * re-installed whenever it is missing (e.g. after the editor was recreated).
   * @param {boolean} [unload=false] remove the look from every view (used on unload)
   * @returns {void}
   */
  styleLeaves(unload = false) {
    const path = normalizePath(this.settings.file);
    for (const leaf of this.app.workspace.getLeavesOfType(ORG_VIEW)) {
      const view = leaf.view;
      const on = !unload && this.settings.styleJournal && view.file && view.file.path === path;
      view.contentEl.toggleClass("org-journal-styled", !!on);
      const cm = view.codeMirror;
      if (!cm) continue;
      if (on) installStyle(cm);
      cm.dispatch({ effects: [refreshStyle.of(null)] });
      applyPreamble(cm, !!on && this.settings.hidePreamble);
    }
  }

  /**
   * Open the journal in a leaf, reusing one that already shows it.
   * @returns {Promise<?JournalContext>} null (after a notice) if Org Reader is missing or
   *   the journal file does not exist
   */
  async openJournal() {
    if (!this.hasOrgReader()) {
      new Notice("Org Journal needs the Org Reader community plugin to open .org files.");
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.file));
    if (!(file instanceof TFile)) {
      new Notice(`Org Journal: file "${this.settings.file}" not found (see plugin settings).`);
      return null;
    }
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(ORG_VIEW).find((l) => l.view.file && l.view.file.path === file.path);
    if (leaf) await ws.revealLeaf(leaf);
    else { leaf = ws.getLeaf(false); await leaf.openFile(file); }
    // the journal look and the editing commands live in the editor, not in the reading view
    if (leaf.view && leaf.view.readerMode === "read") leaf.view.setReaderMode("edit");
    return { file, cm: leaf.view && leaf.view.codeMirror };
  }

  /**
   * Current text of the journal: from the live editor if there is one, else from the vault.
   * @param {JournalContext} ctx
   * @returns {Promise<string>}
   */
  async readText(ctx) {
    return ctx.cm ? ctx.cm.state.doc.toString() : this.app.vault.read(ctx.file);
  }

  /**
   * Replace the document with `newText` and put the cursor on a line. In the editor only
   * the changed middle part is dispatched (the common prefix and suffix are kept), so folds,
   * scroll position and undo history survive; without an editor it writes through
   * `vault.process`.
   * @param {JournalContext} ctx
   * @param {string} newText the full new document
   * @param {number} line 0-based line for the cursor
   * @returns {Promise<void>}
   */
  async applyText(ctx, newText, line) {
    const cm = ctx.cm;
    if (!cm) { await this.app.vault.process(ctx.file, () => newText); return; }
    const old = cm.state.doc.toString();
    let p = 0;
    while (p < old.length && p < newText.length && old[p] === newText[p]) p++;
    let s = 0;
    while (s < old.length - p && s < newText.length - p &&
           old[old.length - 1 - s] === newText[newText.length - 1 - s]) s++;
    const offs = lineOffset(newText, line);
    cm.dispatch({
      changes: { from: p, to: old.length - s, insert: newText.slice(p, newText.length - s) },
      selection: { anchor: offs },
      scrollIntoView: true,
    });
    cm.focus();
  }

  /**
   * Hide everything except the path to an entry (editing mode only).
   * @param {JournalContext} ctx
   * @param {number} line 0-based line of the entry heading to keep visible
   * @returns {void}
   */
  focusEntry(ctx, line) {
    const cm = ctx.cm;
    if (!cm) return;
    const doc = cm.state.doc;
    const ranges = hiddenBlocks(doc.toString(), line).map(([a, b]) => ({
      from: doc.line(a + 1).from,
      to: Math.min(doc.line(b + 1).to + 1, doc.length),
    }));
    unfoldAll(cm);
    cm.dispatch({ effects: [hideEffect(cm).of(ranges)] });
    cm.dispatch({ scrollIntoView: true });
  }

  /**
   * "Show all entries": clear the hiding done by `focusEntry`.
   * @returns {void}
   */
  showAll() {
    const leaf = this.app.workspace.getLeavesOfType(ORG_VIEW)[0];
    const cm = leaf && leaf.view.codeMirror;
    if (!cm) { new Notice("Open the journal first."); return; }
    cm.dispatch({ effects: [hideEffect(cm).of([])] });
  }

  /**
   * Move the cursor to a line and scroll so that line is at the top of the pane.
   * @param {JournalContext} ctx
   * @param {number} line 0-based line (clamped to the document)
   * @returns {void}
   */
  goTo(ctx, line) {
    if (!ctx.cm) return;
    const doc = ctx.cm.state.doc;
    const pos = doc.line(Math.min(line + 1, doc.lines)).from;
    // put the heading on the first visible line (not just "somewhere in view")
    ctx.cm.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 8 }),
    });
    ctx.cm.focus();
  }

  /**
   * "New entry": ask for a title and tags, add the entry for now, then optionally hide the rest.
   * @returns {void}
   */
  newEntry() {
    new EntryModal(this.app, async (title, tags) => {
      const ctx = await this.openJournal();
      if (!ctx) return;
      const r = addEntry(await this.readText(ctx), new Date(), title, tags, this.settings.tagsColumn);
      await this.applyText(ctx, r.text, r.line);
      if (this.settings.focusNewEntry) this.focusEntry(ctx, r.line - 1);
    }, this.settings.journalName).open();
  }

  /**
   * Show a view of the given type in a sidebar, creating it if needed. Falls back to a
   * normal tab when the workspace has no sidebar leaf to give (seen on some mobile layouts).
   * @param {string} type view type id
   * @param {"left"|"right"} side which sidebar
   * @returns {Promise<void>}
   */
  async openInSidebar(type, side) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf = (side === "left" ? ws.getLeftLeaf(false) : ws.getRightLeaf(false)) || ws.getLeaf("tab");
      await leaf.setViewState({ type, active: true });
    }
    await ws.revealLeaf(leaf);
  }

  /**
   * Show the calendar view in the right sidebar, creating it if needed.
   * @returns {Promise<void>}
   */
  async openCalendar() {
    await this.openInSidebar(CAL_VIEW, "right");
  }

  /**
   * Show the tree view in the left sidebar, creating it if needed.
   * @returns {Promise<void>}
   */
  async openTree() {
    await this.openInSidebar(TREE_VIEW, "left");
  }

  /**
   * Text of the journal file, from the open editor if there is one (and it has loaded).
   * @returns {Promise<?string>} null if the file does not exist
   */
  async journalText() {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.file));
    if (!(file instanceof TFile)) return null;
    const open = this.app.workspace.getLeavesOfType(ORG_VIEW)
      .find((l) => l.view.file && l.view.file.path === file.path);
    // The editor's doc is empty until Org Reader has loaded the file (e.g.
    // right after startup), so only trust it when it has content.
    const live = open && open.view.codeMirror && open.view.codeMirror.state.doc.toString();
    return live || this.app.vault.cachedRead(file);
  }

  /**
   * Open the journal and jump to a line (used by the tree and the calendar).
   * @param {number} line 0-based
   * @returns {Promise<void>}
   */
  async goToLine(line) {
    const ctx = await this.openJournal();
    if (ctx) this.goTo(ctx, line);
  }

  /**
   * Entries per day, for the calendar.
   * @returns {Promise<Map<string, number>>} "YYYY-MM-DD" -> entries; empty if there is no file
   */
  async journalDayCounts() {
    const text = await this.journalText();
    return text === null ? new Map() : dayCounts(text);
  }

  /**
   * Open the journal and jump to a day's heading, or say there is none.
   * @param {Date} date
   * @returns {Promise<void>}
   */
  async goToDay(date) {
    const ctx = await this.openJournal();
    if (!ctx) return;
    const line = findDay(await this.readText(ctx), date);
    if (line < 0) new Notice("No journal entry for that day.");
    else this.goTo(ctx, line);
  }

  /**
   * "Open today": jump to today's day heading, or say there is none yet.
   * @returns {Promise<void>}
   */
  async openToday() {
    const ctx = await this.openJournal();
    if (!ctx) return;
    const line = findDay(await this.readText(ctx), new Date());
    if (line < 0) new Notice("No journal entry for today yet.");
    else this.goTo(ctx, line);
  }

  /**
   * Open the journal and parse its entries.
   * @returns {Promise<?{ctx: JournalContext, list: Entry[]}>} list is newest first; null if the
   *   journal could not be opened
   */
  async entries() {
    const ctx = await this.openJournal();
    if (!ctx) return null;
    return { ctx, list: parseEntries(await this.readText(ctx)) };
  }

  /**
   * "Search entries": fuzzy picker over all entries; choosing one jumps to it.
   * @param {(list: Entry[]) => Entry[]} [entries] maps the full list to the subset to offer
   * @returns {Promise<void>}
   */
  async search(entries) {
    const r = await this.entries();
    if (!r) return;
    new EntrySearchModal(this.app, entries ? entries(r.list) : r.list,
      (e) => this.goTo(r.ctx, e.line)).open();
  }

  /**
   * "Filter entries by tag": pick a tag (with counts), then pick among its entries.
   * @returns {Promise<void>}
   */
  async filterByTag() {
    const r = await this.entries();
    if (!r) return;
    const counts = new Map();
    r.list.forEach((e) => e.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    if (!counts.size) { new Notice("No tagged entries yet."); return; }
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    new TagModal(this.app, tags, (tag) => {
      new EntrySearchModal(this.app, r.list.filter((e) => e.tags.includes(tag)),
        (e) => this.goTo(r.ctx, e.line), `Entries tagged :${tag}:`).open();
    }).open();
  }
}
