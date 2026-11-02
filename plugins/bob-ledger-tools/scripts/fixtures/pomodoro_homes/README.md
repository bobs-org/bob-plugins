# Pomodoro home vectors

`vectors.json` was copied byte-for-byte from bob-cli's
`feat(off-clock): add off-clock Pomodoro ledger support` commit
(`8a9ec685ed9c727a0d7338c9c7072b7e285c975e`), at
`tests/fixtures/pomodoro_homes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every `cases` entry that is not marked
`rust_only`. `test-ledger-tools-plan-today-roots.cjs` runs every `today_roots`
case through `planTodayRoots`. The node test's fake `metadataCache` produces
Obsidian's frontmatter shapes: unquoted scalar `parent: [[x]]` is a nested
array, quoted scalar wikilinks remain strings, YAML list parents remain flat
arrays, `type` may be a string or a list, and keys keep their case.

The label, chip, and hue in the vectors name root parents (R2, R7) while `parts`
and `lead_home` stay per nearest home. The `chips, forecast shares, ...` and
`root-parent-chips` cases pin chip suppression by the root-label set and the
lead-root hue.

An Off-Clock Pomodoro (a timed row with `[off:: Nm]`, or an older bare timed
span) is attributed with its **real minutes** and `off_clock: true`; bob keeps
the deprecated `untracked: true` beside it, which this mirror does not emit (the
test re-adds it when comparing). A row holding both keys reads as worked. The
`off-clock-real-minutes`, `off-clock-bare-span`, and `clock-conflict-worked`
cases pin these.
