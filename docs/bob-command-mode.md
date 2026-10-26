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

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bob: Rerun last command | `rerun-last` | — |
<!-- END GENERATED: commands -->

## Run commands

Every catalog entry whose positionals are all optional and whose policy is
`run` also appears as a command palette command named `Bob: <title>` with id
`run-<entry-id>` (for example `Bob: Today's plan` as `run-plan`). These ids
are generated from the cached catalog at load, so the inventory scanner does
not list them here. Each one runs its entry through the same run engine and
finishes with an outcome toast. `Bob: Rerun last command` repeats the newest
recorded command with its original arguments and preview setting.

## Feedback

Finished runs use toast cards for completed, needs-attention, failed, unknown,
and stopped outcomes. Cards show a short summary, elapsed time, and the command
line; their actions can open a note or conflict log, scan queued intake, reload
deployed plugins, retry, copy the command, or open the saved output. Failed and
unknown cards remain until dismissed. The status-bar chip appears after a run
has lasted 400 ms, shows active run counts and elapsed time, and turns amber
when a writer passes its budget. Clicking it opens the active run's output.

When a run takes more than 15 seconds and Obsidian is unfocused, the enabled OS
notification opens that run's output when clicked. The `OS notifications`
setting controls this behavior.

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
