# Pomodoro home vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`511c7ad7b9e2a9d418b15ba5522d483c948a46f1`, at `tests/fixtures/pomodoro_homes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. The
node test's fake `metadataCache` produces Obsidian's frontmatter shapes:
unquoted scalar `parent: [[x]]` is a nested array, quoted scalar wikilinks remain
strings, YAML list parents remain flat arrays, `type` may be a string or a list, and
keys keep their case.
