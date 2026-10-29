# Pomodoro theme vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`74874cb52b0245341fab83360439a7b9929d1bfd`, at
`tests/fixtures/pomodoro_themes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. Cases
carry `components`, `hue` (with an explicit `areas` input under
`area_hues = area`), `fold`, `rank`, `similar`, `menu`, `literal`, `suggest`,
`task_field`, `write_rule`, and `preselect` sections. The preselect cases
synchronize fixture data only; picker implementation belongs to a later phase.
