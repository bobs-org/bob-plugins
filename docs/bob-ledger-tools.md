---
title: "Bob Ledger Tools"
description: "Inspect task lanes, Pomodoros, freshness, and planning marks."
---

Bob Ledger Tools renders task, Pomodoro, freshness, and planning information from Bob notes.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Ledger Tools |
| ID | `bob-ledger-tools` |
| Version | 1.59.1 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Expand Bob daily-note snippets and ledger time ranges, navigate and adjust Pomodoro entries, render the live plan-budget bob-plan block, track task freshness including [unblocked::] TICKLERs, render [priority::] fields as signal-bar priority marks, render created/scheduled/completion/cancelled dates as compact date marks (including in Tasks query results), render `#task` tags as a teal hash task-tag mark (hidden in Tasks query results) and `#task #ref` pairs as an open-book ref mark, and render Depends-On lines as live dependency chips plus generated BLOCKS rows with live dependents, last-blocker keys, stale-entry styling, and frees-N summaries. Open BLOCKS rows add ＋ / hover × through nav api.blocks when present. Render Task Links under today's open Pomodoros with In Progress half-ring marks and read-time unblocked hand-off glyphs. Fetch `bob stats` JSON with stale-while-revalidate caching and render the responsive Stats page `bob-stats` block with metric-family context, accessible daily drill-down, definition disclosures, tiles, and table. Fetch `bob ref list` JSON with a bounded stale-while-revalidate cache, decode audio paths, and provide pure Reading Board lane, card, Snoozed group, ordering, and validated fence models. Render the read-only `bob-reading-board` code block, a Reading / Next / Ready / Snoozed kanban of the reading queue drawn entirely from `bob ref list` JSON (wake dates and waiting-on reasons from bob, never from vault text), with keyed background refresh errors, repaint-safe navigation, roving keyboard focus, click and modifier routing to Obsidian navigation, the optional Highlights PDF hand-off through nav `openReferencePdf`, and the Open Reading Board command. Derive quiet lowercase Pomodoro home chips from linked task notes in Live Preview and Reading view, with area-hue dots, a tooltip, and a toggle. Show a display-only 🍅 Today mark on open task lines linked under today's open Pomodoros in Live Preview and Reading view, with a session toggle and jumps to the Task Link. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Expand Bob snippet | `expand-ledger-time-range-snippet` | — |
| Go to today's Task Link | `go-to-today-task-link` | — |
| Jump to current Pomodoro line | `jump-to-current-pomodoro` | Ctrl+9 |
| Open Reading Board | `open-reading-board` | — |
| Open Stats | `open-stats` | — |
| Open today's daily note | `open-today-daily-note` | — |
| Toggle Pomodoro home chips | `toggle-pomodoro-home-chips` | — |
| Toggle Task Link In Progress marks | `toggle-progress-marks` | — |
| Toggle Today marks | `toggle-today-marks` | — |
| Toggle dependency chips | `toggle-dependency-chips` | — |
| Toggle task date marks | `toggle-date-marks` | — |
| Toggle task freshness marks | `toggle-freshness-marks` | — |
| Toggle task priority marks | `toggle-priority-marks` | — |
| Toggle task tag marks | `toggle-task-tag-marks` | — |
| Toggle unblocked hand-off glyph | `toggle-unblocked-glyph` | — |
<!-- END GENERATED: commands -->
