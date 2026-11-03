# Pomodoro clock vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`beae4dc79a0593d14d7ce775d1e1702bbbe0e588` (`feat(pomodoro-clock): stamp the
effective clock on capture writers`), at `tests/fixtures/pomodoro_clock/vectors.json`.
bob-cli is the source of truth; its Rust test
(`tests/cli/capture/pomodoro_clock.rs`) runs every case through
`bob capture -f json`.

The vectors are the shared contract for the counted-links clock rule: a session
is off the clock iff it keeps at least one Task Link and every kept link
resolves to a task whose own line has a standalone `#offclock` tag
(`#off-clock` and `#untracked` are aliases). Mixed, unresolved, and unlinked
lineups stay on the work clock. Off-clock spans carry `[off:: Nm]`; worked
spans carry `[t:: Nm]`.

Each case gives the whole daily note (`day`, path `2026/20261101.md`), optional
other notes (`notes`, path → contents), the clock (`now`), the capture `token`,
the expected note after the write (`expected_day`), whether the written session
is off-clock (`expected_off_clock`), and an optional structured warning `code`
(`expected_warning`).

This plugin drives the start cases (`=`) as an `se<X>` + Tab inside the target
`()`, resolving other-note links from the vector's `notes`
(`scripts/test-ledger-tools-pomodoro-clock.cjs`). The close cases (`x`) belong
to task-status-cycler, which keeps its own byte-identical copy of this file; the
`~K` drop, kept-ledger swap, and link-start cases are capture-only gestures.

Pin: copy this file from the bob-cli commit that adds it. A bob-plugins copy
that predates those cases is stale.

The vectors were refreshed from bob-cli's `feat(capture): place MEET
continuation after last open Pomodoro` change; carried MEET continuations now
follow the last open Pomodoro.
