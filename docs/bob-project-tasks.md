---
title: "Bob Project Tasks"
description: "Snapshot Markdown notes to Highlights."
---

Bob Project Tasks snapshots Markdown notes to Highlights.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Project Tasks |
| ID | `bob-project-tasks` |
| Version | 1.2.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Snapshot notes to Highlights. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Snapshot note to Highlights | `snapshot-note-to-highlights` | — |
| Snapshot note to Highlights (with closed tasks) | `snapshot-note-to-highlights-with-closed-tasks` | — |
<!-- END GENERATED: commands -->

## Retired project task counts

`task_count`, `open_task_count`, and **Recount all project tasks** are retired.
The plugin no longer listens for metadata changes or writes frontmatter. This
keeps a single property writer and preserves the note's YAML bytes. Bob computes
live counts for `bob projects list`; the Project Card uses those readouts.

Remove legacy counts from every Markdown note, including `done/`, with the
repo's guarded cleanup script:

```sh
node scripts/retire-project-count-keys.cjs --dry-run
node scripts/retire-project-count-keys.cjs --apply
```

Dry-run is the default. `BOB_DIR` (or `--bob-dir DIR`) selects the vault;
`BOB_BIN` selects a current bob build supporting `props_v1` with the retired
counts unlocked; earlier builds protect those keys and refuse cleanup. Each candidate is read
with `bob props show`, then receives one fingerprint-guarded `props update`
batch that unsets only the retired keys present on that note. Stale, damaged,
or refused notes are reported and skipped; exit 1 means at least one skip.
The script never commits or syncs. Re-running it is safe.

Run `bob plugins sync` on every host before cleanup: a host with the old
plugin can recreate the keys. If it does, update that host and rerun the script.

### Frontmatter writer audit

The project-count retirement removes every `processFrontMatter` call across
the plugin source and generated bundles. The remaining paths that can touch
area/project frontmatter are:

| Path | Write boundary |
| --- | --- |
| Navigation `660-plugin-project-notes.js` and `682-plugin-parent-change.js` | The existing `211-parent-frontmatter-plan.js` replaces only `parent`; editor transactions or `vault.process` preserve the rest. Templater owns creation defaults. |
| Navigation rename, link replacement, and project promotion/reversal; block-ID rename | Guarded text/link replacements can update a linked frontmatter value, but do not serialize YAML or maintain count keys. Task, dependency, relation, and successor writers edit body spans. |
| Articles `030-plugin.js` | Applies Bob's planned text edits and preimage-checked inbound link replacements; formatting is article-gated. |
| Ledger Property Editor | Sends guarded operations to `bob props`; its YAML fragment parser is read-only. Other card writers call their Bob commands. |
| Ledger `241d-plugin-notebook-catalog.js` | `metadataEditor` is used only to focus native Properties; it never assigns a property. The Area/Project home-card ownership gate reroutes this fallback only while `props_v1`, `props_contract_v1`, source/cache evidence, and editor routing are confirmed. |
| Ledger stats journal | Writes `.bob` journal data, not note frontmatter. |

No automatic count writer remains. The native Properties UI remains available until
the Area/Project home-card ownership gate confirms matching source, cache, both Bob
capabilities, and editor routing. That gate is separate from whether a typed Settings
editor can open a particular setting.

## Snapshots to Highlights

The two snapshot commands send the active Markdown note to Highlights through
`bob ref create`: **Snapshot note to Highlights** for open tasks, and
**Snapshot note to Highlights (with closed tasks)** (`-C`) when the closed
history should travel with it. Both commands are available only on Markdown
notes.

When Bob Command Mode is enabled (its `api.commandMode` is version 1 or
newer), the snapshot runs through its runner as `ref create <note>` with the
same save-before-write and single-writer guards as the command sheet, and the
run's toast carries the result. Otherwise the plugin spawns `bob ref create`
directly, exactly as before.

Neither snapshot command has a registered default hotkey; run them from the
command palette or bind them in Obsidian's hotkey settings.

## Settings

This plugin adds no settings tab and reads no per-plugin settings.

## Related

- [Projects](https://bobs-org.github.io/projects/) — the project model these
  notes follow.
- [Reference notes](https://bobs-org.github.io/ref/) — what a snapshot
  becomes.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — versioned runtime interfaces.
