// Sidebar tag filter: the tags of the journal with their counts; click tags to select them
// and the entries that have all the selected tags are listed below. Click an entry to jump
// to it. Redraws when the journal file is saved.
import { ItemView, normalizePath, setIcon } from "obsidian";
import { parseEntries, tagCounts, filterByTags } from "./core.js";

/** Obsidian view type id for the tag filter. */
export const TAGS_VIEW = "org-journal-tags";

/**
 * The tag filter view. `selected` is the set of tags currently chosen; it lives as long as
 * the view. Do not name fields after View members (`open`, `leaf`, ...): they belong to Obsidian.
 */
export class TagsView extends ItemView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings, `journalText` and `goToLine`
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selected = new Set();
  }
  /** @returns {string} the view type id */
  getViewType() { return TAGS_VIEW; }
  /** @returns {string} the tab title, using the configured journal name */
  getDisplayText() { return `${this.plugin.settings.journalName} tags`; }
  /** @returns {string} the tab icon */
  getIcon() { return "tags"; }

  /**
   * Redraw when the journal is saved or the workspace changes, then draw for the first time.
   * @returns {Promise<void>}
   */
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f.path === normalizePath(this.plugin.settings.file)) this.render();
    }));
    const again = () => this.render();
    this.registerEvent(this.app.workspace.on("file-open", again));
    this.registerEvent(this.app.workspace.on("layout-change", again));
    await this.render();
  }

  /**
   * Redraw; any error is shown in the pane instead of leaving it blank.
   * @returns {Promise<void>}
   */
  async render() {
    const token = (this.token = (this.token || 0) + 1);
    try {
      await this.draw(token);
    } catch (err) {
      console.error("Org Journal tags:", err);
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "org-journal-tags-empty", text: `Tags error: ${err && err.stack ? err.stack : err}` });
    }
  }

  /**
   * Read the journal and build the DOM.
   * @param {number} token identifies this render; a newer one makes this one stop
   * @returns {Promise<void>}
   */
  async draw(token) {
    const el = this.contentEl;
    el.addClass("org-journal-tags");
    const text = await this.plugin.journalText();
    if (token !== this.token) return;
    el.empty();
    if (text === null) { el.createDiv({ cls: "org-journal-tags-empty", text: `${this.plugin.settings.journalName} file "${this.plugin.settings.file}" not found.` }); return; }
    const entries = parseEntries(text);
    const counts = tagCounts(entries);
    if (!counts.length) { el.createDiv({ cls: "org-journal-tags-empty", text: "No tagged entries yet." }); return; }
    for (const t of [...this.selected]) if (!counts.some(([name]) => name === t)) this.selected.delete(t);

    const bar = el.createDiv({ cls: "org-journal-tags-bar" });
    const list = bar.createDiv({ cls: "org-journal-tags-list" });
    for (const [tag, n] of counts) {
      const chip = list.createEl("button", { cls: "org-journal-tags-chip" + (this.selected.has(tag) ? " is-selected" : "") });
      chip.createSpan({ text: tag });
      chip.createSpan({ cls: "org-journal-tags-count", text: String(n) });
      chip.onclick = () => {
        if (this.selected.has(tag)) this.selected.delete(tag); else this.selected.add(tag);
        this.render();
      };
    }

    const chosen = [...this.selected];
    const head = el.createDiv({ cls: "org-journal-tags-head" });
    if (!chosen.length) {
      head.createSpan({ text: "Select tags to filter the entries" });
      return;
    }
    const found = filterByTags(entries, chosen);
    head.createSpan({ text: `${found.length} ${found.length === 1 ? "entry" : "entries"} tagged ${chosen.map((t) => `:${t}:`).join("")}` });
    const clear = head.createEl("button", { cls: "org-journal-tags-clear clickable-icon", attr: { "aria-label": "Clear selection" } });
    setIcon(clear, "x");
    clear.onclick = () => { this.selected.clear(); this.render(); };
    const rows = el.createDiv({ cls: "org-journal-tags-entries" });
    for (const e of found) {
      const row = rows.createDiv({ cls: "org-journal-tags-entry" });
      row.createDiv({ cls: "org-journal-tags-date", text: e.day });
      row.createDiv({ cls: "org-journal-tags-title", text: e.heading });
      const tags = row.createDiv({ cls: "org-journal-tags-entry-tags" });
      e.tags.forEach((t) => tags.createSpan({ cls: "org-journal-tree-tag", text: t }));
      row.onclick = () => this.plugin.goToLine(e.line);
    }
  }
}
