---
title: "Bob Navigation Hotkeys"
description: "Navigate and edit Bob notes with keyboard commands."
---

Bob Navigation Hotkeys adds keyboard commands for navigating and editing Bob notes.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Navigation Hotkeys |
| ID | `bob-navigation-hotkeys` |
| Version | 2.46.1 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Ctrl+Shift+P always opens the Task Card, a focused first screen with exact P-level previews. Ctrl+Shift+B is Ctrl+Shift+P then `b`: it opens the Task Card's Depends on stage for the task, a Task Link's linked task, or a counted `N<Ctrl+Shift+B>` batch; Esc, q, or Ctrl+[ close it without writing, and its More section opens a property's value stage. Ctrl+Shift+Alt+B is Ctrl+Shift+P then `⇧B`: it opens the Blocks stage for a task or Task Link, supports counted `N<Ctrl+Shift+Alt+B>`, and works from Depends-On and BLOCKS lines, where Ctrl+Shift+P on a BLOCKS line also opens the owner’s stage directly. On an inbox task every non-closing answer asks where it goes before writing and moves there. Open and manage related notes, tabs, and task properties, including priority levels that roll scheduled dates. Ctrl+Enter on the card takes the recommended roll, decay, or cancel from the previewed ladder, including counted and Task Link batches. Scheduling a date opens one combined Reason and Work summary review; a Pending or Next task can record an optional Work Log summary as a dated entry under a WORK LOG child. A Cancel action closes tasks as Cancelled with an optional reason kept in a first-child Cancel Log. Alt+F and Ctrl+Alt+F ask for an optional Work Log summary before refreshing Pending tasks. On a landed RECURRING row both write nothing, show the recurring-tier notice, and stay. Ctrl+Enter on the PRE/POST row the review walk just landed on completes it and advances within the group when another live row remains (nav api v3). `]s` / `[s` away from the current review task first return to it. The Task Card level strip and priority notices render the shared signal-bar priority mark through the bob-ledger-tools api.priorityMarks v1 namespace, falling back to the Lucide signal icons without it. Alt+[ / Alt+] on a Pomodoro Task Link toggles the linked task between Next and In Progress — asking once for an optional Work Log summary when moving back to Next — through the nav api.taskLinkLane v1 namespace. Closing a planned task opens one grouped successor picker when offers exist; nothing starts selected, and the cycler applies only chosen links. The pulled-in summary is shown through nav api.notice v1. Review-row closes append the cycler's additive `successorNotice` line to the walk toast. Journals each counted ]s answer, with its outcome, through the bob-ledger-tools api.stats namespace. Depends-On writes now mirror open dependents into generated 🧱 BLOCKS lines, in the same-note transaction or a checked cross-note follow-up, including counted, marked, Ctrl+D, hand-edit (and undo), conversion, and Ctrl+Shift+M paths. Adding an open prerequisite from Ctrl+Shift+P also removes the newly Blocked task's live links from today's open Pomodoros, deleting an emptied entry. Cmd+Enter on a reading task, Task Link, or managed embed opens its source_pdf in Highlights without vault writes, while other targets retain Obsidian’s new-tab behavior. Turns on Templater's device-local "Trigger on file creation" when it is unset, so Cmd+N and other new notes get the vault's folder template (_templates/new_note.md). Only the BLOCKS chips in bob-ledger-tools use nav `api.blocks` v1, for ＋ and hover ×. The nav api gains an additive `openReferencePdf(path)` member (Promise of `{ok, reason?}`; the api `version` is unchanged) so the bob-ledger-tools Reading Board can hand a reference PDF to Highlights without vault writes. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Close other tabs | `close-other-tabs` | — |
| Close tabs to the left | `close-tabs-left` | — |
| Close tabs to the right | `close-tabs-right` | — |
| Commit to Next / release to Ready | `toggle-task-lane` | Alt+N |
| Copy active file path | `copy-active-file-path` | Mod+Y |
| Create project note | `create-project-note` | — |
| Create project note from task | `create-project-note-from-task` | — |
| Delete current file | `delete-current-file` | — |
| Duplicate current tab | `duplicate-current-tab` | — |
| Edit task dependencies | `edit-task-dependencies` | — |
| Insert blank line above | `insert-blank-line-above` | — |
| Insert blank line below | `insert-blank-line-below` | — |
| Jump to first task due for freshness review | `jump-to-first-due-task` | — |
| Jump to last task due for freshness review | `jump-to-last-due-task` | — |
| Jump to next open task or move a Pomodoro down | `jump-to-next-open-task` | — |
| Jump to next section header | `jump-to-next-section-header` | — |
| Jump to next task due for freshness review | `jump-to-next-due-task` | Ctrl+Alt+J |
| Jump to previous open task or move a Pomodoro up | `jump-to-prev-open-task` | — |
| Jump to previous section header | `jump-to-prev-section-header` | — |
| Jump to previous task due for freshness review | `jump-to-prev-due-task` | Ctrl+Alt+K |
| Move tab left | `move-tab-left` | — |
| Move tab right | `move-tab-right` | — |
| Move tasks to note | `move-tasks-to-note` | Ctrl+Shift+M |
| Open alt file note | `open-alt-file-note` | — |
| Open alternate file | `open-alternate-file` | — |
| Open child note | `open-child-note` | — |
| Open dash Tasks section | `open-dash-tasks` | Ctrl+0 |
| Open next link | `open-next-link` | — |
| Open parent note | `open-parent-note` | — |
| Open previous link | `open-prev-link` | — |
| Open reference PDF in Highlights (or link in new tab) | `open-reference-pdf-in-highlights` | — |
| Open template note | `open-template-note` | — |
| Refresh task freshness (confirm it still looks right) | `refresh-task-freshness` | Alt+F |
| Refresh task freshness and jump to the next due task | `refresh-task-freshness-and-advance` | Ctrl+Alt+F |
| Rename current file | `rename-current-file` | — |
| Task card (set properties) | `set-bullet-property` | — |
| Task card: Blocked by (Depends on) | `task-card-depends-on` | Ctrl+Shift+B |
| Task card: Blocks (reverse Depends on) | `task-card-blocks` | Ctrl+Shift+Alt+B |
| Toggle current tab pin | `toggle-current-tab-pin` | — |
| Toggle line transclusions | `toggle-line-transclusions` | — |
| Yank absolute path | `yank-absolute-path` | — |
| Yank absolute path with tilde | `yank-absolute-path-tilde` | — |
| Yank basename | `yank-basename` | — |
| Yank basename without extension | `yank-basename-without-extension` | — |
| Yank parent directory | `yank-parent-directory` | — |
| Yank relative path | `yank-relative-path` | — |
<!-- END GENERATED: commands -->
