---
title: "Obsidian plugins"
description: "Browse Bob’s Obsidian plugins and their generated command references."
---

Browse Bob's Obsidian plugins and their current versions and command defaults.

## Install

Deploy the plugins into a Bob vault with Bob CLI:

```bash
bob plugins sync
```

See [plugin deployment](https://bobs-org.github.io/develop/plugins/deployment/) for
`--repo` and `--no-pull` when working from this checkout.

<!-- BEGIN GENERATED: inventory -->
| Plugin | Version | Minimum Obsidian version | Desktop only |
| --- | ---: | ---: | --- |
| [Block ID Prompt](block-id-prompt.md) | 1.33.3 | 1.8.7 | No |
| [Bob Articles](bob-articles.md) | 0.2.1 | 1.8.7 | No |
| [Bob Ledger Tools](bob-ledger-tools.md) | 1.60.2 | 1.8.7 | No |
| [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) | 2.50.2 | 1.8.7 | No |
| [Bob Project Tasks](bob-project-tasks.md) | 1.0.0 | 1.8.7 | No |
| [Bob Vim Surround](bob-vim-surround.md) | 1.5.2 | 1.8.7 | No |
| [Task Status Cycler](task-status-cycler.md) | 1.42.2 | 1.8.7 | No |
<!-- END GENERATED: inventory -->

## Shared reference topics

- [Block ID prompt defaults](block-id-defaults.md) — how suggested IDs are formed and accepted.
- [BLOCKS dependency mirrors](blocks-mirrors.md) — when Navigation Hotkeys writes the reverse dependency line.
- [Task Card](task-card.md) — property editing, previews, scheduling input, and key behavior.
- [Go to task URI](goto-task-uri.md) and [Open notes URI](open-notes-uri.md) — read-only links for opening notes and landing the caret.
- [Open a reference PDF in Highlights](highlights.md) — reading-task PDF handoff.
- [Templater new-note trigger](templater-trigger.md) — how new notes receive the folder template.
