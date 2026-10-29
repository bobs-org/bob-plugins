# Pomodoro theme vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`511c7ad7b9e2a9d418b15ba5522d483c948a46f1`, at
`tests/fixtures/pomodoro_themes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. Cases
carry `components`, `hue` (with an explicit `areas` input under
`area_hues = area`), `fold`, `rank`, `similar`, `menu`, `literal`, `suggest`,
`task_field`, `write_rule`, and `preselect` sections. The preselect cases
synchronize fixture data only; picker implementation belongs to a later phase.
