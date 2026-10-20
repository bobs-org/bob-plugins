---
title: "Bob Project Tasks"
description: "Synchronize project task sections across notes."
---

Bob Project Tasks keeps project task sections in sync across notes.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Project Tasks |
| ID | `bob-project-tasks` |
| Version | 1.0.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Keep project task counts materialized in frontmatter. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Recount all project tasks | `recount-all-project-tasks` | — |
| Snapshot note to Highlights | `snapshot-note-to-highlights` | — |
| Snapshot note to Highlights (with closed tasks) | `snapshot-note-to-highlights-with-closed-tasks` | — |
<!-- END GENERATED: commands -->

## Project task counts

Bob Project Tasks keeps project task counts materialized in frontmatter. On
project-type notes it maintains the `task_count` and `open_task_count` fields,
so project progress is visible without counting Tasks sections by hand. The
**Recount all project tasks** command recomputes those fields across the
vault.

## Snapshots to Highlights

The two snapshot commands send the active Markdown note to Highlights through
`bob ref create`: **Snapshot note to Highlights** for open tasks, and
**Snapshot note to Highlights (with closed tasks)** (`-C`) when the closed
history should travel with it. Both commands are available only on Markdown
notes.

None of the three commands has a registered default hotkey; run them from the
command palette or bind them in Obsidian's hotkey settings.

## Settings

This plugin adds no settings tab and reads no per-plugin settings. Project
membership comes from the note's own frontmatter.

## Related

- [Projects](https://bobs-org.github.io/projects/) — the project model these
  counts summarize.
- [Reference notes](https://bobs-org.github.io/ref/) — what a snapshot
  becomes.
