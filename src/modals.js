// Dialogs: the new-entry form and the two pickers (entry search, tag filter).
import { Modal, Setting, FuzzySuggestModal, SuggestModal } from "obsidian";
import { parseTags } from "./core.js";

/**
 * "New entry" form with optional title and tags. Enter in either field (or the
 * button) closes it and calls `onSubmit(title, tags)`; `name` is the journal's
 * display name for the dialog heading.
 */
export class EntryModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {(title: string, tags: string[]) => void} onSubmit called when the form is submitted
   * @param {string} [name="Journal"] the journal's display name, for the dialog heading
   */
  constructor(app, onSubmit, name = "Journal") {
    super(app);
    this.name = name;
    this.onSubmit = onSubmit;
    this.entryTitle = "";
    this.tags = "";
  }
  /**
   * Build the form: title and tags fields (Enter submits in either) and a Create button.
   * @returns {void}
   */
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
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}

/**
 * Fuzzy picker over journal entries (as returned by `parseEntries`). It matches
 * on date, title, tags and the start of the body; `onChoose(entry)` gets the pick.
 */
export class EntrySearchModal extends FuzzySuggestModal {
  /**
   * @param {import("obsidian").App} app
   * @param {import("./core.js").Entry[]} entries what to pick from
   * @param {(entry: import("./core.js").Entry) => void} onChoose called with the picked entry
   * @param {string} [placeholder] hint text for the search box
   */
  constructor(app, entries, onChoose, placeholder) {
    super(app);
    this.entries = entries;
    this.chosen = onChoose;
    this.setPlaceholder(placeholder || "Search entries (text, tags, date)");
  }
  /**
   * @returns {import("./core.js").Entry[]} the entries to pick from
   */
  getItems() { return this.entries; }
  /**
   * The text the fuzzy matcher searches: date, title, tags and the start of the body.
   * @param {import("./core.js").Entry} e
   * @returns {string}
   */
  getItemText(e) {
    return `${e.day} ${e.heading} ${e.tags.map((t) => ":" + t).join(" ")} ${e.body.join(" ").slice(0, 400)}`;
  }
  /**
   * Draw one result: date and title, then the tags and a snippet of the body.
   * @param {{item: import("./core.js").Entry}} match
   * @param {HTMLElement} el
   * @returns {void}
   */
  renderSuggestion(match, el) {
    const e = match.item;
    el.createDiv({ text: `${e.day}  ${e.heading}` });
    if (e.tags.length) el.createDiv({ cls: "org-journal-tags org-journal-sub", text: e.tags.map((t) => ":" + t + ":").join("") });
    if (e.body.length) el.createDiv({ cls: "org-journal-sub", text: e.body.join(" ").slice(0, 120) });
  }
  /**
   * @param {import("./core.js").Entry} e the picked entry
   * @returns {void}
   */
  onChooseItem(e) { this.chosen(e); }
}

/**
 * Picker over tags. `tags` is a list of [tag, count] pairs (most used first);
 * `onChoose(tag)` gets the pick.
 */
export class TagModal extends SuggestModal {
  /**
   * @param {import("obsidian").App} app
   * @param {Array<[string, number]>} tags [tag, count] pairs, most used first
   * @param {(tag: string) => void} onChoose called with the picked tag
   */
  constructor(app, tags, onChoose) {
    super(app);
    this.tags = tags;
    this.chosen = onChoose;
    this.setPlaceholder("Pick a tag");
  }
  /**
   * Tags that contain the typed text (a leading `#` or `:` is ignored).
   * @param {string} q
   * @returns {Array<[string, number]>}
   */
  getSuggestions(q) {
    q = q.toLowerCase().replace(/^[#:]/, "");
    return this.tags.filter(([t]) => t.toLowerCase().includes(q));
  }
  /**
   * Draw one tag as `:tag:  (count)`.
   * @param {[string, number]} suggestion
   * @param {HTMLElement} el
   * @returns {void}
   */
  renderSuggestion([tag, n], el) { el.setText(`:${tag}:  (${n})`); }
  /**
   * @param {[string, number]} suggestion the picked [tag, count]
   * @returns {void}
   */
  onChooseSuggestion([tag]) { this.chosen(tag); }
}
