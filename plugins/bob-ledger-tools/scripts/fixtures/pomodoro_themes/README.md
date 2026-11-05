# Pomodoro theme vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`1f2b28b03b514a4d72ed313c146a78ef51bd271e`, at
`tests/fixtures/pomodoro_themes/vectors.json`. The Rust suite in bob-cli is the
source of truth; this test runs every case that is not marked `rust_only`. Cases
carry `components`, `hue` (with an explicit `areas` input under
`area_hues = area`), `fold`, `rank`, `similar`, `menu`, `literal`, `suggest`,
`task_field`, `preselect`, `agree`, `agree_entry`, `land`, `merge`, `narrow`,
`settle`, `shed`, `split`, `place`, `relocate`, and `select` sections. The
preselect cases synchronize fixture data only; picker implementation belongs to
a later phase. The `agree`, `agree_entry`, `land`, `merge`, `narrow`, `settle`,
`shed`, `split`, `place`, and `relocate` sections are the routing contract shared with
`src/279-plugin-task-type-routing.js`.
