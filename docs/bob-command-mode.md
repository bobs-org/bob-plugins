---
title: "Bob Command Mode"
description: "Run bob commands from Obsidian with guards, history, and an automation API."
---

Bob Command Mode runs bob commands from Obsidian with safe-write guards and run history.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Command Mode |
| ID | `bob-command-mode` |
| Version | 0.1.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | Yes |
| Description | Run bob commands from Obsidian with safe-write guards, run history, and an automation API. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

This plugin registers no command palette commands.
<!-- END GENERATED: commands -->

## Run commands

Every catalog entry whose positionals are all optional and whose policy is
`run` also appears as a command palette command named `Bob: <title>` with id
`run-<entry-id>` (for example `Bob: Today's plan` as `run-plan`). These ids
are generated from the cached catalog at load, so the inventory scanner does
not list them here. Each one runs its entry through the same run engine and
reports through the plain notifier until the toast cards land.

## Run engine

Runs are detached, file-backed children: `spawn(bobPath, argv)` with output
to per-run files under `command-mode/runs/` in the host state directory, an
exit receipt when the catalog advertises `run-receipt`, and a JSON run record
per run. Writers run one at a time behind a save-every-open-note guard; reads
run in parallel. Read budgets kill the child, writer budgets mark the run
overdue, and stop is offered only for runs this instance spawned. A plugin
reload adopts unfinished records from their receipts, or reports unknown when
no receipt arrives in time.

## Settings

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| bob path | `bobPath` | Auto (blank) | Find `bob` in its usual install locations or on `PATH`; set an explicit path to override. |
| OS notifications | `osNotifications` | On | Notify on long finished runs while Obsidian is unfocused. |
| Keep runs | `keepRuns` | 50 | Retain at most this many runs in history. |
| Keep days | `keepDays` | 14 | Retain runs younger than this many days. |

## Automation API

Other plugins reach the engine through
`app.plugins.plugins["bob-command-mode"].api.commandMode` (version 1):
`run(argv, opts)` settles `{ok, runId, outcome, exitCode, reason?}` and never
rejects, `openOutput(runId)` opens the run's `.out` file until the pager
lands, `onRunFinished(cb)` subscribes to finishes, and `catalog()` and
`lastRun()` read the cached catalog and newest record. Every finish also fires
`bob-command-mode:run-finished` on the workspace with `{runId, argv, entryId,
outcome, effect, invalidates}`.
