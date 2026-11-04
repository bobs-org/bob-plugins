# Task-split vectors

`vectors.json` is a byte-for-byte copy of bob-cli's
`tests/fixtures/task_split/vectors.json` at bob-cli commit
`734214e92c5495fa34a9d02818b9e820d21f004f`.

It pins the `planSplitBullets` JS twin
(`plugins/bob-navigation-hotkeys/src/256-task-split-plan.js`) against the
Rust `plan_task_split` (`src/native/task_split/plan.rs`), which is the
source of truth. Never hand-edit this copy: change bob-cli first, then
re-copy the file and update the commit pin above.

Run: `node scripts/test-navigation-task-split-vectors.cjs`
