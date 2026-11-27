---
title: "Bob Prose"
description: "Format prose notes, extract and inline sections, and toggle section numbers with Bob Prose."
---

Bob Prose keeps Bob prose notes formatted in Obsidian. A prose note is a note
whose body is free-form authored Markdown typed `type: "[[prose]]"`; notes
typed with the legacy `[[article]]` spelling count too. Bob Prose formats each
note's layout and section numbers with `bob prose`, gives it a reading look,
and previews adoption before converting a note.

The plugin id stays `bob-articles`, as do its existing command ids, settings
keys, and `.bob-article` CSS class. The section gesture is **Ctrl+Shift+E**.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Prose |
| ID | `bob-articles` |
| Version | 0.5.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Format Bob prose notes, preview section extraction and inline, toggle section numbers, and adopt notes as prose. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Convert note to prose note… | `convert-to-article` | — |
| Extract or inline prose section | `toggle-prose-section` | Ctrl+Shift+E |
| Extract section to prose note | `extract-prose-section` | — |
| Format prose note | `format-article` | — |
| Inline prose note into parent | `inline-prose-note` | — |
| Toggle section numbers | `toggle-section-numbers` | — |
<!-- END GENERATED: commands -->

## Formatting prose notes

Bob Prose keeps prose notes formatted with `bob prose format`. Formatting runs
on save, when leaving the note, or on command:

- **Format prose note** formats the active prose note immediately.
- **Toggle section numbers** turns the active prose note's heading numbers off
  or on. It reads `section_numbers` from the note's frontmatter: `false` turns
  numbering on, and anything else turns it off. bob writes the new
  `section_numbers` value and renumbers or strips the headings in one plan,
  which the plugin applies as one undoable edit. If the installed bob does not
  support `--section-numbers`, the command shows bob's error and changes
  nothing.
- **Convert note to prose note…** previews adopting the active note as a prose
  note and converts it after you confirm.
- **Extract section to prose note** previews moving the heading section under
  the cursor from an area, project, or prose note into a new prose note.
- **Inline prose note into parent** previews folding the active prose note back
  into its parent section.
- **Extract or inline prose section** runs the extraction preview at the cursor.
  If bob reports that the cursor is on a prose link stub, it previews inlining
  that note instead. The preview shows bob's summary, counts, findings, and each
  changed file's diff; the host diff starts open. Extraction includes an editable
  note name and refreshes the preview as it changes. Press **Enter** to confirm;
  **Esc**, **q**, or **Ctrl+[** closes the preview. Bob remains responsible for
  deciding eligibility and for writing the conversion.
- The commands need the Obsidian desktop app. If the installed `bob` predates
  `prose extract` and `prose inline`, Bob Prose shows **Update bob to extract
  prose sections** once per session.
- The save and leave triggers run the same formatter automatically when their
  settings are on.

## Settings

Bob Prose is the only plugin in this repo with a settings tab. All five
settings live under **Settings → Bob Prose**:

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Format on save | `formatOnSave` | On | Ask `bob` to format a prose note before saving it. |
| Format when leaving the note | `formatOnLeave` | On | Format the saved prose note after it stops being active. |
| Prose typeface | `articleTypeface` | Serif | Serif body text with the theme's heading face, or keep the theme typeface. |
| Show stale-number hints | `staleNumberHints` | On | After a typing pause, underline section numbers that will change on save. |
| bob path | `bobPath` | Auto (blank) | Find `bob` in its usual install locations or on `PATH`; set an explicit path to override. |

The **Extract or inline prose section** command defaults to **Ctrl+Shift+E**;
the other commands have no default hotkey. Run commands from the palette or
change the binding in Obsidian's hotkey settings.

## Read-only Prose snapshot API

The plugin exposes the cached Bob Prose plan at
`app.plugins.getPlugin("bob-articles")?.api?.prose`, namespace version 1.
Feature-detect `version === 1` before using it. `snapshot(path)` returns
`null` until Bob has remembered a plan for that vault-relative path; reading
the snapshot never starts Bob. A snapshot is frozen and contains `path`, a
monotonic `generation`, `status` (`ready` or `refused`), Bob's `outline` and
`findings`, `refusal` (`{ code, message }` or `null`), and `numbering`.
Refused plans preserve Bob's message and findings, and can have a null outline.

`subscribe(fn)` calls `fn(path)` after each remembered plan or forgotten path
and returns an unsubscribe function. Read the snapshot again inside the callback.
Late plans do not replace a newer cached generation. The Prose Card consumes this
API without spawning Bob or writing the note.

## Related

- [Prose notes](https://bobs-org.github.io/prose/) — the prose-note format
  this plugin maintains.
- [Prose Card](prose-card.md) — the property card that reads this plugin's
  snapshot API.
