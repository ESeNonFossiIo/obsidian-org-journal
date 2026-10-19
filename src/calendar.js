import { ItemView, normalizePath } from "obsidian";
import { MONTHS, pad, monthGrid } from "./core.js";

export const CAL_VIEW = "org-journal-calendar";

export class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }
  getViewType() { return CAL_VIEW; }
  getDisplayText() { return `${this.plugin.settings.journalName} calendar`; }
  getIcon() { return "calendar"; }
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f.path === normalizePath(this.plugin.settings.file)) this.render();
    }));
    await this.render();
  }
  shift(delta) {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }
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
