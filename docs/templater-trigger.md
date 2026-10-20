---
title: "Templater new-note trigger"
description: "How Bob keeps Templater's folder template active for new notes."
---

Templater 2.25 moved `trigger_on_file_creation` into per-device
localStorage, where it defaults to off, and removed it from the synced
`data.json`. At layout-ready, Bob Navigation Hotkeys enables the
trigger only when it is unset. Cmd+N and other new notes can then use the
vault's folder template at `_templates/new_note.md`.

An explicit off choice in Templater settings is respected. Navigation
Hotkeys does not change `enable_system_commands` or
`enable_startup_templates`; editing `data.json` cannot
restore the device-local trigger.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the plugin that manages this trigger.
