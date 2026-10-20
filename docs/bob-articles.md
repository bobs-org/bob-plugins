---
title: "Bob Articles"
description: "Format and adopt article notes with Bob Articles."
---

Bob Articles formats reading notes and presents article metadata in Obsidian.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Articles |
| ID | `bob-articles` |
| Version | 0.2.1 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Format Bob article notes with bob on save, when leaving, or on command, and preview article adoption. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Convert note to article… | `convert-to-article` | — |
| Format article | `format-article` | — |
<!-- END GENERATED: commands -->

## Formatting articles

Bob Articles keeps article notes formatted with `bob`. Formatting runs on
save, when leaving the note, or on command:

- **Format article** formats the active article note immediately.
- **Convert note to article…** converts the active note into an article note.
- The save and leave triggers run the same formatter automatically when their
  settings are on.

Before applying changes, the plugin previews article adoption so the outcome is
visible before the note is rewritten.

## Settings

Bob Articles is the only plugin in this repo with a settings tab. All five
settings live under **Settings → Bob Articles**:

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Format on save | `formatOnSave` | On | Ask `bob` to format an article before saving it. |
| Format when leaving the note | `formatOnLeave` | On | Format the saved article after it stops being active. |
| Article typeface | `articleTypeface` | Serif | Serif body text with the theme's heading face, or keep the theme typeface. |
| Show stale-number hints | `staleNumberHints` | On | After a typing pause, underline section numbers that will change on save. |
| bob path | `bobPath` | Auto (blank) | Find `bob` in its usual install locations or on `PATH`; set an explicit path to override. |

Neither registered command has a default hotkey; run them from the command
palette or bind them in Obsidian's hotkey settings.

## Related

- [Articles](https://bobs-org.github.io/articles/) — the article format this
  plugin maintains.
- [Reference notes](https://bobs-org.github.io/ref/) — the reading workflow
  articles belong to.
