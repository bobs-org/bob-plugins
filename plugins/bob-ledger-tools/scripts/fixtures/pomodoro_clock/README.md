# Pomodoro clock vectors

`vectors.json` is copied byte-for-byte from bob-cli commit
`ecc3d32d27d199f962d37d89bf954e6b7efa8168` (`feat(clock): add clock-type
filter with strict offclock_types reader`), at
`tests/fixtures/pomodoro_clock/vectors.json`. bob-cli is the source of truth;
its Rust test (`tests/cli/capture/pomodoro_clock.rs`) runs every case through
`bob capture -f json`.

The vectors cover the counted-links rule and the effective clock of each
linked task. After clock tags, the nearest area or project declaration wins:
`offclock_types` off-clocks only tasks whose effective type is listed; an
invalid list stays worked. A valid list takes precedence over a same-note
`offclock` key. The task type comes from its own field, reading-task rule,
nearest task-type note default, then `plan.default_type`; the vector's
`config.plan` block is passed into the plugin caps by the harness.

Each case gives the daily note (`day`), optional other notes (`notes`), the
clock (`now`), capture token, expected note (`expected_day`), the expected
clock, and an optional warning. The ledger-tools harness drives starts (`=`)
as `se<X>` + Tab; close cases belong to task-status-cycler. Capture-only
gestures are documented in each harness's exclusions.

Pin: copy this file from the bob-cli commit that adds or changes the shared
clock contract. Keep both plugin fixture copies byte-identical to that file.
