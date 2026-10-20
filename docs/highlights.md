---
title: "Open a reference PDF in Highlights"
description: "Open a reading task's managed PDF without changing the vault or reading state."
---

In source or Live Preview mode, `Cmd+Enter` on a `#task #ref`
reading task opens the first linked PDF. If the task links to a managed
reference note, the command can use that note's `source_pdf`. A v1
tracker may link directly to its PDF; a tracker inside its own managed
reference note may fall back to that note's `source_pdf`. A dedicated
Task Link or managed embed also works when it points to the reading task.

The command opens the library PDF without writing the vault or changing
reading state. A missing, unsafe, or unsynced PDF produces a notice.
Highlights is macOS-only; on other systems the command reports that
limitation. For other targets, including ordinary links, it delegates to
Obsidian's **Open link under cursor in new tab** command.

The `Meta+Enter` binding for
`bob-navigation-hotkeys:open-reference-pdf-in-highlights` is custom
vault configuration in `.obsidian/hotkeys.json`, not a registered
plugin default. That custom binding runs before Obsidian's built-in
`Mod+Enter`; delegation preserves the built-in action for other
targets. Do not re-record it in Obsidian Settings on a Mac: Obsidian may save
`Mod`, which would claim `Ctrl+Enter` on other platforms.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation and keyboard layers.
- [Bob Ledger Tools](bob-ledger-tools.md) — the Reading Board's optional PDF handoff.
- [Reference notes](https://bobs-org.github.io/ref/) — the managed reference-note model.
