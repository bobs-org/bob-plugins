---
title: "Bob Prose"
description: "Format prose notes and toggle their section numbers with Bob Prose."
---

Bob Prose keeps Bob prose notes formatted in Obsidian. A prose note is a note
whose body is free-form authored Markdown typed `type: "[[prose]]"`; notes
typed with the legacy `[[article]]` spelling count too. Bob Prose formats each
note's layout and section numbers with `bob prose`, gives it a reading look,
and previews adoption before converting a note.

The plugin id stays `bob-articles`, and so do its command ids, settings keys,
and the `.bob-article` CSS class, so hotkeys and settings carry over.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Prose |
| ID | `bob-articles` |
| Version | 0.4.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Format Bob prose notes with bob on save, when leaving, or on command, toggle their section numbers, and preview prose-note adoption. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Convert note to prose note… | `convert-to-article` | — |
| Format prose note | `format-article` | — |
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

No registered command has a default hotkey; run them from the command palette
or bind them in Obsidian's hotkey settings.

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
