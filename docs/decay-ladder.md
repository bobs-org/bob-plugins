---
title: "Decay ladder live verification"
description: "Real-Obsidian verification of the task-decay ladder."
---

The task-decay ladder moves through WIP → Next → Ready → P1 … P4. Each rung
allows its configured number of due keeps; the next due keep opens a card.
Enter steps one rung, Alt+F stays and restarts the count, and D drops. P4
Enter rolls again at P4. Each keep and card decision writes one rung-qualified
Rotten Log entry. These answers are explicit; freshness never demotes a task
on a timer.

## Live verification

The real-Obsidian e2e passed twice on Athena on 2026-11-03 with Obsidian
1.15.0 and Tasks 8.6.0. Each run passed all 48 checks with no skips. It
verified WIP keep, step, undo, and drop; Next keep and stay; Ready keep and
step to P1 with an in-window schedule; P4 keep and re-roll; and counted batch
skip without task writes. It captured WIP, Ready, and P4 cards in light and
dark themes.

For both runs, the working bob-plugins tree and Tasks plugin source were
copied to a fresh Athena `/tmp` directory. The e2e used an isolated scratch
vault and did not touch Athena's repository checkout or live vault. The
command inside each copy was:

```text
BOB_E2E_TASKS_PLUGIN_DIR=<isolated Tasks plugin> xvfb-run -a node scripts/obsidian-decay-ladder-e2e.cjs --out <results/run-N> --report <results/report-N.json>
```

The harness pins the freshness and lane-release dates together, waits for
Tasks cache and task writes, and tolerates duplicate copies of a deduplicated
batch notice. Its card input targets the focused control, and it asserts that
the modal belongs to Obsidian's app document. The configured P-level label
is used in Rotten Log entries; the configured `[priority::]` value is only
the stored property value.

Review of the six WIP, Ready, and P4 screenshots confirmed the recommended
Enter row, rung title, Stay and Drop actions, and readable contrast in both
themes. Run two matched run one byte-for-byte for WIP, Ready, and P4 dark;
P4 light had a small capture-level pixel difference with no visible content
or layout change. Both reports and the six reviewed screenshots are
registered as SASE artifacts on `bob-cli-g9`.
