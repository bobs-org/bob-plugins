# MEET event-run vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`beae4dc79a0593d14d7ce775d1e1702bbbe0e588` (`feat(pomodoro-clock): stamp the
effective clock on capture writers`), at `tests/fixtures/meet_event_run/vectors.json`.
bob-cli is the source of truth. This plugin drives each `=`, `=meet`, and
`=5#meet` case as an `se<X>` + Tab inside the target `()` (a restart replaces
the running range with `(se)`); the `~K` drop and kept-ledger swap cases are
capture-only gestures.

Each case gives the whole daily note (`day`, path `2026/20261101.md`), the
clock (`now`), the capture `token`, and the expected note after the start
(`expected_day`), whether the written session is off-clock
(`expected_off_clock`), and the written span (`expected_span`). Off-clock spans
carry `[off:: Nm]`; worked spans carry `[t:: Nm]`. A non-MEET start whose
counted lineup is all `#offclock` (or an alias) writes `[off::]` too; only a
MEET with a non-empty event run classifies from the run instead of the whole
lineup (see `pomodoro_clock/` for the lineup rule). `expected_source` is the
`pomodoro_start.event_run.source` the JSON reports (`calendar` when the span
follows the run, `explicit` when a counted suffix or a kept ledger set it,
absent when the MEET has no run). `expected_warning` is a structured warning
`code` the start raises.

Pin: the buffered cases (ids containing `buffer` or `lead-out`) were added with
the `[buffer::]` field in bob-cli (`event_buffer/vectors.json` is the field and
conflict contract). A buffered event runs on its buffered span (`start - before`
through `end + after`): candidates, sorting, clustering, the written span, the
early start, and the far-run warning all use it, while a run never bridges
clocks. A copy that predates the `expected_off_clock` key (it carried
`expected_tracked`) is stale.

The vectors use only hand-written Event Tasks; no Google Calendar account or
generated sync state is needed.
