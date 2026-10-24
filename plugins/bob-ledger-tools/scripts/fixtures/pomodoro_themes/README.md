# Pomodoro theme vectors

`vectors.json` was copied byte-for-byte from the bob-cli working tree based on
`94591ea`, at `tests/fixtures/pomodoro_themes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. Cases
carry `components`, `hue` (with an explicit `areas` input under
`area_hues = area`), `fold`, `rank`, `similar`, `menu`, and `literal` sections.
