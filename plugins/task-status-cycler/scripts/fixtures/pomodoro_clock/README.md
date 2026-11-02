# Pomodoro clock vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`71a65dad49413ba3662098834f01fbecda70fdd9` (`feat(capture): stamp session clock
from counted Task Links`), at `tests/fixtures/pomodoro_clock/vectors.json`.
bob-cli is the source of truth. The Obsidian start mirror lives at
`plugins/bob-ledger-tools/scripts/fixtures/pomodoro_clock/` in this repo, a
byte-identical copy of the same file.

This plugin drives the close cases (token `x`) through `Ctrl+Enter`
(`scripts/test-task-status-cycler-pomodoro-clock.cjs`): the closed headline must
match `expected_day`'s closed row byte for byte, and `[off:: Nm]` appears
exactly when `expected_off_clock` is true. Starts belong to bob-ledger-tools; a
close with a `~K` drop, kept-ledger swaps, and link starts are capture-only
gestures. One deliberate difference: a close whose every kept link is deferred
deletes the emptied row in this plugin (the documented emptied-Pomodoro rule),
where bob keeps it, so `close-defers-not-started-off-clock` asserts the deferral
and the worked verdict rather than a closed headline.

Each case gives the whole daily note (`day`, path `2026/20261101.md`), optional
other notes (`notes`, path → contents), the clock (`now`), the capture `token`,
the expected note after the write (`expected_day`), whether the written session
is off-clock (`expected_off_clock`), and an optional structured warning `code`
(`expected_warning`).

Pin: copy this file from the bob-cli commit that adds it. A bob-plugins copy
that predates those cases is stale.
