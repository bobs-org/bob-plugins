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
| Bob: Command mode | `open` | — |
| Bob: Rerun last command | `rerun-last` | — |
| Bob: Show last output | `show-last-output` | — |
<!-- END GENERATED: commands -->

## Run commands

Every catalog entry whose positionals are all optional and whose policy is
`run` also appears as a command palette command named `Bob: <title>` with id
`run-<entry-id>` (for example `Bob: Today's plan` as `run-plan`). These ids
are generated from the cached catalog at load, so the inventory scanner does
not list them here. Each one runs its entry through the same run engine and
finishes with an outcome toast. `Bob: Rerun last command` repeats the newest
recorded command with its original arguments and preview setting, or the whole
sequence when that newest run was a sequence step; a replay of an applied run
does not ask for its preview or confirmation again.
`Bob: Show last output` opens the output pager on the newest run.

## Keyboard and Vim

With Vim mode enabled, `:` in normal mode opens the sheet. `Escape` (or
`Ctrl+[` everywhere in command mode) closes it unless marks are pending, in
which case the first press clears the marks and a second press closes the
sheet. In the list, `↑` / `↓` and `Ctrl+P` / `Ctrl+N` (any letter case or
layout) move between rows and keep the highlight in view with the cursor in
the query; `Enter` runs, `Tab` opens argument mode, `Ctrl+M` (any letter case
or layout, Ctrl alone) marks a bob command as the next sequence step,
`Shift+Enter` previews, `Ctrl+Enter` runs without preview, and `?` after a
query opens `bob <command> --help`. Typing `::` opens Vim's ex line. Vim
commands such as `:%s/foo/bar/` and `:42` are routed to Vim, and matching
`exmap` commands can be selected from suggestions. The catalog also includes
named Pomodoro session actions to start, stop, extend, and shorten a
session. Free-text `bob capture TEXT` is not accepted in command mode; use
the dedicated capture workflow for free-text capture.

In argument mode, `Tab` accepts the selected completion, arrows or
`Ctrl+P` / `Ctrl+N` move through completions in the order shown with the
selected completion kept in view, and `Enter` accepts a completion.
`Shift+Enter` previews and `Ctrl+Enter` runs the typed command; `Ctrl+M`
marks the completed command. With marks pending, `Enter` adds the completed
command and runs the sequence, `Ctrl+Enter` does the same without the review
card, and `Shift+Enter` warns instead of previewing. `Escape` (or `Ctrl+[`)
returns to the list. A preview is applied with `Ctrl+Enter`. A writer without
a preview requires `Ctrl+Enter` or the Run button on its confirmation card.
In Vim mode, `Ctrl+N` / `Ctrl+P` move through mappings and `Ctrl+[` returns
to the list; the confirm card and both output views use `Ctrl+[` exactly like
`Escape`.

In the pager, `j` / `k` scroll a line and `d` / `u` scroll half a page;
`g` / `G` go to the start or end. `/` starts search, `n` / `N` move between
matches, and `w` toggles wrapping. `y` copies output, `Y` copies the
shell-quoted command, `r` reruns, and `[` / `]` move through history.
On a sequence step the pager shows `step i of n` after the argv; `r` and `Y`
still apply to that single step. `:` returns to the list, `Escape` returns to
the prior stage, and `q` closes the sheet.

Bind Vim's keys with non-recursive mappings so replaying `:` cannot reopen
the sheet recursively:

```vim
exmap bob_command obcommand bob-command-mode:open
nnoremap : :bob_command<CR>
nnoremap g: :
```

Insert-mode `:` remains text, visual-mode `:` remains native, and `g:` opens
Vim's native ex line even if the plugin is disabled. The plugin warns if a
recursive map replays `:`. If `:` does nothing, run `bob plugins sync` on that
host, confirm `bob plugins list` shows it enabled, then reload Obsidian.

## Feedback

Finished runs use toast cards for completed, needs-attention, failed, unknown,
and stopped outcomes. Cards show a short summary, elapsed time, and the command
line; their actions can open a note or conflict log, scan queued intake, reload
deployed plugins, retry, copy the command, or open the saved output. Failed and
unknown cards remain until dismissed. The status-bar chip appears after a run
has lasted 400 ms. It shows a spinning ring, `bob`, and the longest run's
clock (with `×N` when several runs are active); a queued-only indicator shows a
dashed ring, an overdue writer turns amber and slows its spin, and a finished
run briefly shows its outcome glyph before fading. A running sequence replaces
that anatomy with `N/M`, the current step title, and the sequence wall clock.
Hovering lists each run with
its command, progress, and queued, overdue, or adopted state; clicking (or
`Enter`/`Space`) opens the output. Runs adopted after a reload appear with an
adopted mark. Every run the command-mode engine owns lights the indicator:
sheet, palette, toast-action, and sibling-plugin API runs. A finished sequence
shows one summary card with Output, Copy (the steps joined by `&&`), Rerun or
Rerun all, and Resume from k when it halted.

The `gcal-sync` outcome adapter summarizes added calendar rows and links, for
example `Calendar · +2 tasks, +1 context, MEET +2 links`. A no-op sync reports
`Calendar unchanged`, and a sync waiting for the daily note reports that state.

When a run takes more than 15 seconds and Obsidian is unfocused, the enabled OS
notification opens that run's pager when clicked. The `OS notifications`
setting controls this behavior.

## Output pager

The output pager is a bottom sheet that streams a run's stdout and stderr,
replays finished runs in arrival order, and doubles as run history. It renders
ANSI color against theme variables, ticks stderr with a faint red gutter,
pretty-prints a body that is a single JSON document, and turns vault paths and
`[[wikilinks]]` that resolve into note links. Vim-style keys scroll, search,
wrap, copy (ANSI-stripped output with `y`, the shell-quoted command with `Y`),
rerun, stop, and step through history newest-first. Toast **Output**, the
status chip, OS notification clicks, and `api.commandMode.openOutput` all open
this view. A run whose pager is open and focused at finish updates the status
pill and skips the toast.

## Command sheet

`Bob: Command mode` opens a bottom sheet with a fuzzy finder over every catalog
entry, ranked by path, alias, title, and keywords with frecency tie-breaks. An
empty query shows RECENT runs, FOR THIS NOTE rows filled from the active note
(ref, area, project, and article notes each get their own rows), FROM CLIPBOARD
rows for an http(s) URL, and one section per catalog section plus surface rows
that run existing Obsidian commands (daily note, task types manager, stats, tasks,
relation labels, reading board, article formatting). RECENT rows show the
command without the bob path; Enter reruns it under the command's preview or
confirm guard, Ctrl+Enter reruns it now, and a recorded preview reruns as a
preview. Unavailable rows stay visible and dimmed with their reason. `Enter`
runs, `Tab` names argument mode
(it lands with the args-vim phase), `Shift+Enter` dry-runs a preview into the
sheet, `Ctrl+Enter` runs now, and a trailing `?` shows `bob <path> --help` for
the selected row. Preview-first rows stream their preview in place and apply
with `Ctrl+Enter`; writers without a dry run ask once on an amber confirm card
that only `Ctrl+Enter` or Run confirms. Reports grow the sheet into the output
pager in place, and `Esc` returns to the list with the query intact. While a
report, preview, or help run is in flight, the sheet footer shows a running line
until its output opens.

Click a row to run it. `Ctrl`/`Cmd`+click marks it instead. With marks
pending, a click toggles that row's mark and never runs it.

## Sequences

`Ctrl+M` marks the selected bob command as the next step. The highlight stays
on the row so its number badge is visible, and the query is selected so the
next search can replace it. Marked rows show a filled accent badge and a faint
tint. A tray under the input lists the steps in order with a **Run N ↵**
button. `Ctrl+M` on a marked row unmarks it and renumbers the rest. Only bob
command rows can join a sequence (catalog, FOR THIS NOTE, FROM CLIPBOARD, typed
`bob` commands, and non-preview RECENT runs). Surface, Vim, unavailable, and
preview rows refuse with a hint.

A row that still needs positionals opens argument mode. There, `Ctrl+M` marks
the typed command once it is complete (`Needs NAME` otherwise). With marks
pending, `Enter` with no highlighted completion adds the command if it is
complete and runs the sequence; `Ctrl+Enter` does the same without the review
card, and also adds a highlighted completion's command if it is missing.
`Shift+Enter` warns and runs nothing. Incomplete arguments leave the marks
intact.

One mark runs exactly like activating that row: reports stay in the sheet,
preview-first commands preview, and confirm commands show their card. Nothing
is stamped as a sequence. Two or more marks start a sequence. `Enter` shows
one review card if any step is `confirm` or `preview-first`; `Ctrl+Enter` or
**Run all** starts immediately. `Esc` or **Back** returns to the list with the
marks intact. Starting closes the sheet and runs steps in order, including
reads. The sequence halts at the first failed, unknown, or stopped result;
needs-attention continues and the summary takes the attention tone. Resume
from k skips completed steps; Rerun all starts a new id; Copy joins the
commands with `&&`; Output focuses the relevant run. If that sequence is
already running, the sheet stays open with "That sequence is already running".

`Ctrl+M` on a RECENT sequence row loads its steps (or unloads them if they are
already marked). RECENT folds each sequence into one row, occupying a single
slot of the four, with `›` separators and a wall-duration chip. A running
sequence shows `⟳`; after a reload an incomplete sequence with no live id
shows interrupted (`◌`). Marks last only while the sheet is open.

## Run engine

Runs are detached, file-backed children: `spawn(bobPath, argv)` with output
to per-run files under `command-mode/runs/` in the host state directory, an
exit receipt when the catalog advertises `run-receipt`, and a JSON run record
per run. Writers run one at a time behind a save-every-open-note guard; ordinary reads
run in parallel. Steps inside a sequence, including reads, run one at a time.
Each sequence step's record may carry an optional `sequence` stamp
(`id`, `index`, `total`, `started_at`, `steps`) with schema 1 unchanged.
Read budgets kill the child, writer budgets mark the run
overdue, and stop is offered only for runs this instance spawned. A plugin
reload adopts unfinished records from their receipts, or reports unknown when
no receipt arrives in time.

Run records and stdout/stderr files live under
`${XDG_STATE_HOME:-~/.local/state}/bob-cli/command-mode/runs/`. They are
host-local rather than vault data.

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
rejects, `openOutput(runId)` opens that run in the output pager,
`onRunFinished(cb)` subscribes to finishes, and `catalog()` and
`lastRun()` read the cached catalog and newest record. Every finish also fires
`bob-command-mode:run-finished` on the workspace with `{runId, argv, entryId,
outcome, effect, invalidates}`.
