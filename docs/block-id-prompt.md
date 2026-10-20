---
title: "Block ID Prompt"
description: "Create and manage block IDs and task links in Bob's Obsidian workflow."
---

Block ID Prompt helps create and manage stable block identifiers and task links in Obsidian.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Block ID Prompt |
| ID | `block-id-prompt` |
| Version | 1.33.2 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Prompt for custom block IDs and complete wiki block links to open tasks, with a plan-budget suffix. Ctrl+Shift+Enter refuses Depends-On ⛓️ **DEPENDS ON:** dependency lines. On inbox notes, Ctrl+Shift+Enter asks where the task goes before linking or unlinking, then moves it with the toggle applied (nav inboxRoute v1). Ctrl+Shift+Enter asks which of today's Pomodoros to link into (↵ = current/next, type to filter or name a new one). Project Schedule comes from the ^prj task; a future-scheduled ^prj link is refused only when its date is the sole remaining reason, dependency reasons are reported first, and a direct link raises a Ready ^prj to Next. A tagged #prj_is_blocked ^prj is refused as blocked by its parent project without raising prerequisites. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Rename selected block ID | `rename-selected-block-id` | Ctrl+6 |
| Toggle task Pomodoro link | `link-task-to-pomodoro` | Ctrl+Shift+Enter |
<!-- END GENERATED: commands -->
