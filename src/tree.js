// Sidebar tree of the journal, like the file explorer: years and months are
// folders, then days, then entries. Click to expand/collapse or jump to an entry.
import { ItemView, normalizePath, setIcon } from "obsidian";
import { buildTree } from "./core.js";

/** Obsidian view type id for the tree. */
export const TREE_VIEW = "org-journal-tree";

/**
 * The tree view. `expanded` is the set of node keys (see `buildTree`) that are
 * open; it starts with the current year and month and lives as long as the view.
 * Do not name fields after View members: `open`, `leaf`, ... belong to Obsidian.
 */
export class TreeView extends ItemView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings, `journalText` and `goToLine`
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const n = new Date();
    const y = String(n.getFullYear());
    const m = `${y}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    // current year and month start expanded
    this.expanded = new Set([y, `${y}/${m}`]);
  }
  /**
   * @returns {string} the view type id
   */
  getViewType() { return TREE_VIEW; }
  /**
   * @returns {string} the tab title, using the configured journal name
   */
  getDisplayText() { return `${this.plugin.settings.journalName} tree`; }
  /**
   * @returns {string} the tab icon
   */
  getIcon() { return "folder-tree"; }
  /**
   * Redraw when the journal is saved or the workspace changes, then draw for the first time.
   * @returns {Promise<void>}
   */
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f.path === normalizePath(this.plugin.settings.file)) this.render();
    }));
    // The journal may not be loaded yet when this view is restored at startup.
    const again = () => this.render();
    this.registerEvent(this.app.workspace.on("file-open", again));
    this.registerEvent(this.app.workspace.on("layout-change", again));
    await this.render();
  }

  /**
   * Redraw the tree; any error is shown in the pane instead of leaving it blank.
   * @returns {Promise<void>}
   */
  async render() {
    const token = (this.token = (this.token || 0) + 1);
    try {
      await this.draw(token);
    } catch (err) {
      // show the problem in the pane: easier to report than a console error
      console.error("Org Journal tree:", err);
      const el = this.contentEl;
      el.empty();
      el.createDiv({ cls: "org-journal-tree-empty", text: `Tree error: ${err && err.stack ? err.stack : err}` });
    }
  }

  /**
   * Read the journal and build the DOM.
   * @param {number} token identifies this render; if a newer one started while the file was
   *   being read, this one stops without drawing
   * @returns {Promise<void>}
   */
  async draw(token) {
    const el = this.contentEl;
    el.addClass("org-journal-tree");
    if (!el.childElementCount) el.createDiv({ cls: "org-journal-tree-empty", text: `Loading ${this.plugin.settings.journalName.toLowerCase()} tree…` });
    const text = await this.plugin.journalText();
    if (token !== this.token) return;   // a newer render is already running
    el.empty();
    if (text === null) { el.createDiv({ cls: "org-journal-tree-empty", text: `${this.plugin.settings.journalName} file "${this.plugin.settings.file}" not found.` }); return; }
    const years = buildTree(text);
    if (!years.length) { el.createDiv({ cls: "org-journal-tree-empty", text: `No entries found in ${this.plugin.settings.file} (${text.split("\n").length} lines read).` }); return; }
    for (const y of years) this.folder(el, y, "folder", y.months, (box, m) =>
      this.folder(box, m, "folder", m.days, (box2, d) =>
        this.folder(box2, d, "calendar", d.entries, (box3, e) => this.entryRow(box3, e))));
  }

  /**
   * A collapsible row for a node, with its children when it is expanded. Clicking toggles it.
   * @param {HTMLElement} parent where to add the row
   * @param {{key: string, label: string, line: number}} node a year, month or day
   * @param {string} icon Obsidian icon id ("folder", or "calendar" for days)
   * @param {Array} children the node's children
   * @param {(box: HTMLElement, child: any) => void} renderChild draws one child into `box`
   * @returns {void}
   */
  folder(parent, node, icon, children, renderChild) {
    const open = this.expanded.has(node.key);
    const wrap = parent.createDiv({ cls: "org-journal-tree-node" });
    const row = wrap.createDiv({ cls: "org-journal-tree-row is-folder" });
    setIcon(row.createSpan({ cls: "org-journal-tree-chevron" }), open ? "chevron-down" : "chevron-right");
    setIcon(row.createSpan({ cls: "org-journal-tree-icon" }), open && icon === "folder" ? "folder-open" : icon);
    row.createSpan({ cls: "org-journal-tree-label", text: node.label });
    row.createSpan({ cls: "org-journal-tree-count", text: String(this.count(node)) });
    row.onclick = () => {
      if (this.expanded.has(node.key)) this.expanded.delete(node.key); else this.expanded.add(node.key);
      this.render();
    };
    // a day row also jumps to the day's heading
    if (icon === "calendar") {
      row.addEventListener("dblclick", () => this.plugin.goToLine(node.line));
      row.setAttr("title", "Double-click to jump to this day");
    }
    if (open) {
      const box = wrap.createDiv({ cls: "org-journal-tree-children" });
      children.forEach((c) => renderChild(box, c));
    }
  }

  /**
   * A leaf row for an entry: its title and tags; click jumps to it in the journal.
   * @param {HTMLElement} parent where to add the row
   * @param {import("./core.js").TreeEntry} e
   * @returns {void}
   */
  entryRow(parent, e) {
    const row = parent.createDiv({ cls: "org-journal-tree-row is-entry" });
    setIcon(row.createSpan({ cls: "org-journal-tree-icon" }), "file-text");
    row.createSpan({ cls: "org-journal-tree-label", text: e.label });
    e.tags.forEach((t) => row.createSpan({ cls: "org-journal-tree-tag", text: t }));
    row.onclick = () => this.plugin.goToLine(e.line);
  }

  /**
   * Number of entries under a node.
   * @param {import("./core.js").TreeYear|import("./core.js").TreeMonth|import("./core.js").TreeDay} node
   * @returns {number}
   */
  count(node) {
    if (node.entries) return node.entries.length;
    if (node.days) return node.days.reduce((n, d) => n + d.entries.length, 0);
    return node.months.reduce((n, m) => n + this.count(m), 0);
  }
}
