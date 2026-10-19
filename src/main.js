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
 * Works alongside the `orgmode-cm6' plugin: if the journal is open in its
 * view, edits go through that view's CodeMirror so nothing is clobbered by
 * a background file write. No Node APIs, so it runs on mobile too.
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

export default class OrgJournalPlugin extends Plugin {
  /** Apply the configured journal name to ribbon tooltips and open view tabs. */
  applyNames() {
    const n = this.settings.journalName;
    const tip = { tree: `${n} tree`, calendar: `${n} calendar`, entry: `New ${n.toLowerCase()} entry` };
    for (const [k, el] of Object.entries(this.ribbon || {})) {
      el.setAttr("aria-label", tip[k]);
      el.setAttr("data-tooltip-position", "right");
    }
    for (const type of [CAL_VIEW, TREE_VIEW]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) if (leaf.updateHeader) leaf.updateHeader();
    }
  }

  /** True if the orgmode-cm6 plugin (which provides the .org editor view) is enabled. */
  hasOrgmode() {
    const p = this.app.plugins;
    return !p || !p.enabledPlugins || p.enabledPlugins.has("orgmode-cm6");
  }

  async onload() {
    await this.loadSettings();
    this.registerView(CAL_VIEW, (leaf) => new CalendarView(leaf, this));
    this.registerView(TREE_VIEW, (leaf) => new TreeView(leaf, this));
    this.ribbon = {
      tree: this.addRibbonIcon("folder-tree", "", () => this.openTree()),
      calendar: this.addRibbonIcon("calendar", "", () => this.openCalendar()),
      entry: this.addRibbonIcon("pencil", "", () => this.newEntry()),
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
      if (!this.hasOrgmode()) {
        new Notice("Org Journal needs the Orgmode (cm6) community plugin. Install and enable it, then reload.", 10000);
      }
      restyle();
    });
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  saveSettings() { return this.saveData(this.settings); }

  onunload() {
    this.styleLeaves(true);
  }

  /**
   * Turn the journal look on for open journal views (and off for the rest).
   * orgmode-cm6 rebuilds the editor state when it loads a file, which drops
   * our extension, so this re-installs it whenever it is missing.
   */
  styleLeaves(unload = false) {
    const path = normalizePath(this.settings.file);
    for (const leaf of this.app.workspace.getLeavesOfType("orgmode")) {
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

  /** Open the journal in a leaf; returns {file, cm} (cm = orgmode-cm6's EditorView, if any). */
  async openJournal() {
    if (!this.hasOrgmode()) {
      new Notice("Org Journal needs the Orgmode (cm6) community plugin to open .org files.");
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.file));
    if (!(file instanceof TFile)) {
      new Notice(`Org Journal: file "${this.settings.file}" not found (see plugin settings).`);
      return null;
    }
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType("orgmode").find((l) => l.view.file && l.view.file.path === file.path);
    if (leaf) await ws.revealLeaf(leaf);
    else { leaf = ws.getLeaf(false); await leaf.openFile(file); }
    return { file, cm: leaf.view && leaf.view.codeMirror };
  }

  async readText(ctx) {
    return ctx.cm ? ctx.cm.state.doc.toString() : this.app.vault.read(ctx.file);
  }

  /** Replace the document (minimal diff) and put the cursor on `line`. */
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

  /** Hide everything except the path to the entry at `line` (orgmode-cm6 view only). */
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

  showAll() {
    const leaf = this.app.workspace.getLeavesOfType("orgmode")[0];
    const cm = leaf && leaf.view.codeMirror;
    if (!cm) { new Notice("Open the journal first."); return; }
    cm.dispatch({ effects: [hideEffect(cm).of([])] });
  }

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

  newEntry() {
    new EntryModal(this.app, async (title, tags) => {
      const ctx = await this.openJournal();
      if (!ctx) return;
      const r = addEntry(await this.readText(ctx), new Date(), title, tags, this.settings.tagsColumn);
      await this.applyText(ctx, r.text, r.line);
      if (this.settings.focusNewEntry) this.focusEntry(ctx, r.line - 1);
    }, this.settings.journalName).open();
  }

  async openCalendar() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(CAL_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      await leaf.setViewState({ type: CAL_VIEW, active: true });
    }
    await ws.revealLeaf(leaf);
  }

  async openTree() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(TREE_VIEW)[0];
    if (!leaf) {
      leaf = ws.getLeftLeaf(false);
      await leaf.setViewState({ type: TREE_VIEW, active: true });
    }
    await ws.revealLeaf(leaf);
  }

  /** Text of the journal file (from the open editor if any), or null if missing. */
  async journalText() {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.file));
    if (!(file instanceof TFile)) return null;
    const open = this.app.workspace.getLeavesOfType("orgmode")
      .find((l) => l.view.file && l.view.file.path === file.path);
    // The editor's doc is empty until orgmode-cm6 has loaded the file (e.g.
    // right after startup), so only trust it when it has content.
    const live = open && open.view.codeMirror && open.view.codeMirror.state.doc.toString();
    return live || this.app.vault.cachedRead(file);
  }

  async goToLine(line) {
    const ctx = await this.openJournal();
    if (ctx) this.goTo(ctx, line);
  }

  /** Day -> entry count, from the open editor if the journal is open, else from disk. */
  async journalDayCounts() {
    const text = await this.journalText();
    return text === null ? new Map() : dayCounts(text);
  }

  async goToDay(date) {
    const ctx = await this.openJournal();
    if (!ctx) return;
    const line = findDay(await this.readText(ctx), date);
    if (line < 0) new Notice("No journal entry for that day.");
    else this.goTo(ctx, line);
  }

  async openToday() {
    const ctx = await this.openJournal();
    if (!ctx) return;
    const line = findDay(await this.readText(ctx), new Date());
    if (line < 0) new Notice("No journal entry for today yet.");
    else this.goTo(ctx, line);
  }

  async entries() {
    const ctx = await this.openJournal();
    if (!ctx) return null;
    return { ctx, list: parseEntries(await this.readText(ctx)) };
  }

  async search(entries) {
    const r = await this.entries();
    if (!r) return;
    new EntrySearchModal(this.app, entries ? entries(r.list) : r.list,
      (e) => this.goTo(r.ctx, e.line)).open();
  }

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
