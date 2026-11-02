# MEET event-run vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`a4044f40164ce1c89ab1c19b75c2ecd71c1e37e5`, at
`tests/fixtures/meet_event_run/vectors.json`. bob-cli is the source of
truth. This plugin drives each `=`, `=meet`, and `=5#meet` case as an
`se<X>` + Tab inside the target `()` (a restart replaces the running
range with `(se)`); the `~K` drop and kept-ledger swap cases are
capture-only gestures.

Each case gives the whole daily note (`day`, path `2026/20261101.md`), the
clock (`now`), the capture `token`, and the expected note after the start
(`expected_day`), whether the written session is tracked (`expected_tracked`,
false means the ledger has no `[t::]`), and the written span (`expected_span`).
`expected_source` is the `pomodoro_start.event_run.source` the JSON reports
(`calendar` when the span follows the run, `explicit` when a counted suffix or a
kept ledger set it, absent when the MEET has no run). `expected_warning` is a
structured warning `code` the start raises.

Pin: the buffered cases (ids containing `buffer` or `lead-out`) were added with
the `[buffer::]` field in bob-cli (`event_buffer/vectors.json` is the field and
conflict contract). A buffered event runs on its buffered span (`start - before`
through `end + after`): candidates, sorting, clustering, the written span, the
early start, and the far-run warning all use it, while a run never bridges
trackedness.

The vectors use only hand-written Event Tasks; no Google Calendar account or
generated sync state is needed.
