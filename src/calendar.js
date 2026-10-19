// Sidebar month calendar: days that have a journal entry get a dot, and clicking
// one jumps to that day in the journal. Redraws when the journal file is saved.
import { ItemView, normalizePath } from "obsidian";
import { MONTHS, pad, monthGrid } from "./core.js";

/** Obsidian view type id for the calendar. */
export const CAL_VIEW = "org-journal-calendar";

/**
 * The calendar view. `year`/`month` (0-based) are the month being shown;
 * `plugin` supplies settings, the journal's day counts and `goToDay`.
 */
export class CalendarView extends ItemView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings, the journal's day counts
   *   and `goToDay`
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }
  /**
   * @returns {string} the view type id
   */
  getViewType() { return CAL_VIEW; }
  /**
   * @returns {string} the tab title, using the configured journal name
   */
  getDisplayText() { return `${this.plugin.settings.journalName} calendar`; }
  /**
   * @returns {string} the tab icon
   */
  getIcon() { return "calendar"; }
  /**
   * Redraw when the journal file is saved, then draw for the first time.
   * @returns {Promise<void>}
   */
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f.path === normalizePath(this.plugin.settings.file)) this.render();
    }));
    await this.render();
  }
  /**
   * Show the month `delta` months away from the current one.
   * @param {number} delta e.g. -1 for the previous month
   * @returns {void}
   */
  shift(delta) {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }
  /**
   * Rebuild the pane: header with navigation, weekday names, then the day grid.
   * @returns {Promise<void>}
   */
  async render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("org-journal-cal");
    const counts = await this.plugin.journalDayCounts();
    const head = el.createDiv({ cls: "org-journal-cal-head" });
    head.createEl("button", { text: "‹" }).onclick = () => this.shift(-1);
    head.createSpan({ cls: "org-journal-cal-title", text: `${MONTHS[this.month]} ${this.year}` });
    head.createEl("button", { text: "›" }).onclick = () => this.shift(1);
    head.createEl("button", { text: "Today" }).onclick = () => {
      const n = new Date();
      this.year = n.getFullYear();
      this.month = n.getMonth();
      this.render();
    };
    const grid = el.createDiv({ cls: "org-journal-cal-grid" });
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    if (!this.plugin.settings.mondayFirst) names.unshift(names.pop());
    names.forEach((n) => grid.createDiv({ cls: "org-journal-cal-dow", text: n }));
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    for (const week of monthGrid(this.year, this.month, this.plugin.settings.mondayFirst)) {
      for (const d of week) {
        if (d === null) { grid.createDiv({ cls: "org-journal-cal-day is-empty" }); continue; }
        const key = `${this.year}-${pad(this.month + 1)}-${pad(d)}`;
        const cell = grid.createDiv({ cls: "org-journal-cal-day", text: String(d) });
        if (key === todayKey) cell.addClass("is-today");
        if (counts.has(key)) {
          cell.addClass("has-entry");
          const n = counts.get(key);
          cell.setAttr("title", n === 1 ? "1 entry" : `${n} entries`);
          cell.createDiv({ cls: "org-journal-cal-dot" });
          cell.onclick = () => this.plugin.goToDay(new Date(this.year, this.month, d));
        }
      }
    }
  }
}
