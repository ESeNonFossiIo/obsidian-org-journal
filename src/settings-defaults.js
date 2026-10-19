/**
 * Default plugin settings:
 *   journalName    display name used in tab titles, tooltips and dialogs
 *   file           path of the journal file inside the vault
 *   tagsColumn     column where an entry heading's :tags: end (Org's default is 77)
 *   mondayFirst    calendar weeks start on Monday
 *   focusNewEntry  after "New entry", hide everything except today's path and the entry
 *   styleJournal   apply the journal look to the journal file
 *   hidePreamble   hide the #+ lines before the first heading (part of the look)
 */
export const DEFAULTS = { journalName: "Journal", file: "journal.org", tagsColumn: 77, mondayFirst: true, focusNewEntry: true, styleJournal: true, hidePreamble: true };
