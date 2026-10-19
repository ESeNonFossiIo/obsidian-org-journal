import { PluginSettingTab, Setting } from "obsidian";
import { DEFAULTS } from "./settings-defaults.js";

export class OrgJournalSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Journal name")
      .setDesc("Shown in the calendar and tree tabs, the ribbon tooltips and the new-entry dialog.")
      .addText((t) => t.setValue(this.plugin.settings.journalName).onChange(async (v) => {
        this.plugin.settings.journalName = v.trim() || DEFAULTS.journalName;
        await this.plugin.saveSettings();
        this.plugin.applyNames();
      }));
    new Setting(containerEl).setName("Journal file").setDesc("Path inside the vault.")
      .addText((t) => t.setValue(this.plugin.settings.file).onChange(async (v) => {
        this.plugin.settings.file = v.trim() || DEFAULTS.file;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Week starts on Monday")
      .addToggle((t) => t.setValue(this.plugin.settings.mondayFirst).onChange(async (v) => {
        this.plugin.settings.mondayFirst = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Hide other entries on new entry")
      .setDesc("After creating an entry, hide everything except today's path and the new entry. Run 'Show all entries' to bring it back.")
      .addToggle((t) => t.setValue(this.plugin.settings.focusNewEntry).onChange(async (v) => {
        this.plugin.settings.focusNewEntry = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Journal look")
      .setDesc("Style the journal file: heading hierarchy, time and tag badges, readable width, dimmed #+ lines.")
      .addToggle((t) => t.setValue(this.plugin.settings.styleJournal).onChange(async (v) => {
        this.plugin.settings.styleJournal = v;
        await this.plugin.saveSettings();
        this.plugin.styleLeaves();
      }));
    new Setting(containerEl).setName("Hide preamble")
      .setDesc("Hide the #+TITLE / #+STARTUP lines before the first heading (part of the journal look).")
      .addToggle((t) => t.setValue(this.plugin.settings.hidePreamble).onChange(async (v) => {
        this.plugin.settings.hidePreamble = v;
        await this.plugin.saveSettings();
        this.plugin.styleLeaves();
      }));
    new Setting(containerEl).setName("Tags column").setDesc("Right edge for :tags: on entry headings (Emacs default 77).")
      .addText((t) => t.setValue(String(this.plugin.settings.tagsColumn)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (n > 0) { this.plugin.settings.tagsColumn = n; await this.plugin.saveSettings(); }
      }));
  }
}
