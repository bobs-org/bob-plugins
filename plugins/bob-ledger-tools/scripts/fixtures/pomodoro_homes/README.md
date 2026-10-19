# Pomodoro home vectors

`vectors.json` is copied verbatim from bob-cli revision `77c77410` at
`tests/fixtures/pomodoro_homes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. The
node test's fake `metadataCache` produces Obsidian's frontmatter shapes:
unquoted `parent: [[x]]` is a nested array, `type` may be a string or a list,
and keys keep their case.
