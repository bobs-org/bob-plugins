# Pomodoro clock vectors

`vectors.json` is copied byte-for-byte from bob-cli commit
`ecc3d32d27d199f962d37d89bf954e6b7efa8168` (`feat(clock): add clock-type
filter with strict offclock_types reader`), at
`tests/fixtures/pomodoro_clock/vectors.json`. bob-cli is the source of truth.

The vectors cover the counted-links rule and the effective clock of each
linked task. After clock tags, the nearest area or project declaration wins:
`offclock_types` off-clocks only tasks whose effective type is listed; an
invalid list stays worked. A valid list takes precedence over a same-note
`offclock` key. Task types follow the task field, reading-task rule, nearest
task-type note default, then `plan.default_type`. The harness maps each
vector's `config.plan` block into plan caps before resolving the task clock.

This plugin drives close cases (`x`) through Ctrl+Enter
(`scripts/test-task-status-cycler-pomodoro-clock.cjs`). Starts belong to
bob-ledger-tools; capture-only gestures are documented in the harness.

Pin: copy this file from the bob-cli commit that adds or changes the shared
clock contract. Keep both plugin fixture copies byte-identical to that file.
