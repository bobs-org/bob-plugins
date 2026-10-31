# Pomodoro home vectors

`vectors.json` was copied byte-for-byte from bob-cli's
`feat(pomodoro-homes): label home chips by root parent` commit, at
`tests/fixtures/pomodoro_homes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. The
node test's fake `metadataCache` produces Obsidian's frontmatter shapes:
unquoted scalar `parent: [[x]]` is a nested array, quoted scalar wikilinks remain
strings, YAML list parents remain flat arrays, `type` may be a string or a list, and
keys keep their case.

The label, chip, and hue in the vectors name root parents (R2, R7) while `parts`
and `lead_home` stay per nearest home. The `chips, forecast shares, ...` and
`root-parent-chips` cases pin chip suppression by the root-label set and the
lead-root hue.
