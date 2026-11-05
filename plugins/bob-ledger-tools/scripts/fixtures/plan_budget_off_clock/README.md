# Plan budget off-clock vectors

`vectors.json` was copied byte-for-byte from bob-cli
`tests/fixtures/plan_budget_off_clock/vectors.json`. bob-cli is the
source of truth; its Rust test (`tests/cli/plan_off_clock.rs`) runs
every case through `bob plan -f json`.

The vectors are the shared contract for the off-clock-links-are-uncapped
rule: a Task Link whose target task resolves off-clock never counts
toward `plan.max_links`, never makes the status `over`, and never raises
`plan_link_cap_exceeded`. Off-clock tasks stay Today tasks.

Pin: copy this file from the bob-cli commit that adds it. A bob-plugins
copy that predates those cases is stale.
