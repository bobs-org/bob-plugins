# Pomodoro theme vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`fc594281b1f623738b6ee0f71c8ff86df0285246`, at
`tests/fixtures/pomodoro_themes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. Cases
carry `components`, `hue` (with an explicit `areas` input under
`area_hues = area`), `fold`, `rank`, `similar`, `menu`, `literal`, `suggest`,
`task_field`, and `write_rule` sections.
