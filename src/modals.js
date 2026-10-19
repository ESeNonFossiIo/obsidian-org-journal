import { Modal, Setting, FuzzySuggestModal, SuggestModal } from "obsidian";
import { parseTags } from "./core.js";

export class EntryModal extends Modal {
  constructor(app, onSubmit, name = "Journal") {
    super(app);
    this.name = name;
    this.onSubmit = onSubmit;
    this.entryTitle = "";
    this.tags = "";
  }
  onOpen() {
    this.titleEl.setText(`New ${this.name.toLowerCase()} entry`);
    const submit = () => { this.close(); this.onSubmit(this.entryTitle.trim(), parseTags(this.tags)); };
    const onEnter = (el) => el.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    new Setting(this.contentEl).setName("Title").setDesc("Optional")
      .addText((t) => { t.onChange((v) => (this.entryTitle = v)); onEnter(t); setTimeout(() => t.inputEl.focus(), 0); });
    new Setting(this.contentEl).setName("Tags").setDesc("Optional, separated by spaces or commas")
      .addText((t) => { t.onChange((v) => (this.tags = v)); onEnter(t); });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(submit));
  }
  onClose() { this.contentEl.empty(); }
}

export class EntrySearchModal extends FuzzySuggestModal {
  constructor(app, entries, onChoose, placeholder) {
    super(app);
    this.entries = entries;
    this.chosen = onChoose;
    this.setPlaceholder(placeholder || "Search entries (text, tags, date)");
  }
  getItems() { return this.entries; }
  getItemText(e) {
    return `${e.day} ${e.heading} ${e.tags.map((t) => ":" + t).join(" ")} ${e.body.join(" ").slice(0, 400)}`;
  }
  renderSuggestion(match, el) {
    const e = match.item;
    el.createDiv({ text: `${e.day}  ${e.heading}` });
    if (e.tags.length) el.createDiv({ cls: "org-journal-tags org-journal-sub", text: e.tags.map((t) => ":" + t + ":").join("") });
    if (e.body.length) el.createDiv({ cls: "org-journal-sub", text: e.body.join(" ").slice(0, 120) });
  }
  onChooseItem(e) { this.chosen(e); }
}

export class TagModal extends SuggestModal {
  constructor(app, tags, onChoose) {
    super(app);
    this.tags = tags;
    this.chosen = onChoose;
    this.setPlaceholder("Pick a tag");
  }
  getSuggestions(q) {
    q = q.toLowerCase().replace(/^[#:]/, "");
    return this.tags.filter(([t]) => t.toLowerCase().includes(q));
  }
  renderSuggestion([tag, n], el) { el.setText(`:${tag}:  (${n})`); }
  onChooseSuggestion([tag]) { this.chosen(tag); }
}
