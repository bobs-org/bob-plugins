---
title: "Build and validate plugins"
description: "Run deterministic bundle, documentation, test, and manifest checks."
---

Run the source build after editing fragments, then check generated output and
the documentation inventory before committing:

```bash
npm run build
npm run build:check
npm run docs:gen
npm run docs:inventory:check
npm test
npm run validate
```

`npm test` first checks bundle freshness and generated documentation,
then runs the explicit Node test list in `package.json` (`test:unit`),
then runs CPU-budget files serially (`test:perf`). Both stages always
run after the freshness checks; the combined exit status is nonzero if
either stage fails. The unit list includes inventory scanner tests;
keeping membership explicit makes the suite reviewable. Each test file
belongs to exactly one stage. The serial stage is
`scripts/test-block-id-prompt-task-wikilink-index-performance.cjs`,
because `process.cpuUsage` charges V8 helper threads that inflate under
parallel allocation-heavy siblings. It also runs focused tests for plugin
behavior, source builds, API boundaries, and navigation and picker
workflows.

`npm run validate` exits non-zero if any plugin's bundle, inventory, or
manifest validation fails, so it is safe to use in CI or a pre-commit
hook. It checks bundle and inventory drift, then runs
`scripts/validate-manifests.mjs` across every plugin. It verifies
required manifest fields, the folder/ID match, semantic version format, and
`main.js` syntax with `node --check`; it does not execute
plugin code.

Preview the mounted plugin docs through bob-cli. This does not run as
part of `npm test` and does not call npm:

```bash
BOB_CLI_DIR=<bob-cli-checkout> npm run docs:check
```

`docs:check` resolves bob-cli from `BOB_CLI_DIR`, then `../bob-cli`,
then a managed cache clone of bob-cli origin `master`. It runs
`just docs-check` with `BOB_DOCS_BOB_PLUGINS_DIR` set to this
repository. Set `BOB_CLI_DIR` to the checkout you are working in.

The offline wrapper `scripts/test-obsidian-vim-yank-flash-e2e.cjs` is part of
`npm test`. It checks the scratch-vault fixture without launching Obsidian;
run the real CDP check on athena after an Obsidian upgrade, as described in
[Bob Vim Yank Flash](https://bobs-org.github.io/reference/plugins/bob-vim-yank-flash/#verification).

The offline wrapper `scripts/test-obsidian-bank-ui-e2e.cjs` is part of `npm test`;
run the real CDP walkthrough with `xvfb-run -a node scripts/obsidian-bank-ui-e2e.cjs`.

The album UI and schema-writer wrappers are part of `npm test`; their real-Bob
checks are reported as skipped when `BOB_BIN` is absent. For acceptance, set
`BOB_BIN` to the verified current checkout binary. Run the isolated real-CDP
walkthrough with `BOB_BIN=/path/to/bob xvfb-run -a node
scripts/obsidian-album-ui-e2e.cjs -e /snap/bin/obsidian -r /tmp/album-schema.json
-o /tmp/album-schema-shots`; its JSON report records the binary path and version.
Run the writer matrix with `BOB_BIN=/path/to/bob node
scripts/obsidian-album-schema-writer-e2e.cjs --self-test`.

The Projects UI offline wrapper is part of `npm test`; it validates the fixture
and probes without launching Obsidian. For acceptance, build Bob from the
current bob-cli checkout and provide both `BOB_BIN` and `BOB_CLI_DIR` so the
runner can verify and record the binary's source checkout. It seeds an isolated
Git vault, invokes real projects JSON commands, opens only that vault in an
owned Obsidian process/profile, and records a JSON report and screenshots. Run
the real walkthrough under an independent Xvfb display:

```bash
BOB_BIN=<bob-cli-cargo-target>/debug/bob \
BOB_CLI_DIR=<bob-cli-checkout> \
xvfb-run -a node scripts/obsidian-projects-ui-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/projects-ui-e2e.json -o /tmp/projects-ui-e2e-shots
```

Review every screenshot and the report's checks, note-byte hashes, and logged
Bob sync/list calls. The offline self-test is fixture coverage only; it does
not count as real Obsidian acceptance.

The Record Card wrapper in `npm test` checks fixtures, selective Properties hiding,
byte boundaries, freshness assertions, and the stdin-forwarding writer recorder
without Obsidian or Bob. This is offline coverage only.

For real acceptance, use athena's Obsidian Electron binary and a clean copy
of the current bob-cli checkout and bob-plugins source under a disposable
directory. Build `bob` from that checkout and place the exact binary at its
`target/debug/bob`. Then run:

```bash
BOB_CLI_DIR=<disposable-bob-cli-checkout> \
BOB_BIN=<disposable-bob-cli-checkout>/target/debug/bob \
xvfb-run -a node scripts/obsidian-record-card-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/record-card-e2e.json -o /tmp/record-card-e2e-shots
```

The runner refuses a missing or incompatible supplied binary; it records the
bob-cli source SHA, binary SHA256, version, and the real `record_values_v1`
capability from `bob albums list`. If a build coordinator transports uncommitted
CLI changes, it must also provide `BOB_CLI_PROVENANCE` (a JSON file) and
`BOB_CLI_PROVENANCE_SHA256` (that file's SHA256). The version-1 manifest contains
`schema_version: 1`, `sourceSha` (base commit), `sourcePatchSha256` (SHA256 of
`git diff --binary --no-color --no-ext-diff --no-textconv --no-renames HEAD`), and
`binarySha256`. Freeze the source before building and check it again afterward;
transport the base, exact patch, manifest and resulting binary together. The runner
checks all four against the transported checkout, refuses untracked source inputs,
and records the manifest and patch hashes. Without a manifest the checkout must be
clean. This provenance check does not replace the build and test gates.

It creates a unique scratch Git vault with a
local bare remote, an owned Obsidian profile/process/debug port, and explicit
`BOB_DIR` plus a missing test-config path. The scratch app starts with native
Properties and the inline title enabled. Per-key probes require title/schema rows
hidden and other metadata visible, including after file/mode changes. Cursor checks
reach the body boundary in Live Preview and the YAML closing delimiter in Source,
where the native Properties widget does not replace YAML. Hover checks use an
authored body link, independently of the record walk rail. It preserves a failure
report and screenshots for diagnosis, records pass/fail/skipped assertions and console
exceptions, and never opens the live vault. Copy the report and screenshots back
from athena and inspect every PNG; `--self-test` is not real-Obsidian acceptance.

The default `--scope full` requires every sheet and interaction assertion. It loads
ledger-tools, navigation-hotkeys and Command Mode, exercises real controls and keyboard
input, and records writer stdin/results separately from previews. It verifies seven
typed stages, Undo, refusal drafts, YAML return, Schema Card navigation and Markdown
byte boundaries. Failed workflows retain keyboard focus and subprocess evidence,
including each focus target's layout boxes and computed display. The row keyboard
check captures the focused row before Enter opens its card.
Within the card, field selection clicks the label, then requires native focus on
that row and an unchanged active note before typing. A populated value may be a
navigable link, so clicking the row's centre is not a field-selection gesture.
The YAML check waits for raw Source mode and the selected field's line, captures
that view, then verifies Done restores Live Preview and the same Record Card field.
The Schema Card handoff checks both the selected field and keyboard focus, and
captures the Claim row before exercising its unchanged Ctrl+J/K navigation.
The invalid-number check presses Enter, Tab, and Shift+Tab after bob refuses the
preview, requiring the refusal, draft, field, and native focus to remain intact
with no writer call before capturing the settled refusal.
The stale-edit check waits for a current draft preview, changes the record in a
second real Source pane, and requires a persistent stale warning with no writer
call and unchanged Markdown after that external edit. It then uses Enter to
preview the retained draft and a second Enter to save it. The report retains
both fingerprints, draft operations and the refusal/retry states; screenshots
capture the refusal and completed retry separately.
Missing workflows fail the run. `--scope sheet` explicitly skips
interactions and proves rendering only; its result cannot stand for full acceptance.

The intention card wrapper in `npm test` checks fixtures, clocks, byte
boundaries, keys, and probe syntax only. For real acceptance, build Bob from the
current bob-cli checkout and run the isolated walkthrough under Xvfb:

```bash
BOB_BIN=<bob-cli-cargo-target>/debug/bob \
BOB_CLI_DIR=<bob-cli-checkout> \
xvfb-run -a node scripts/obsidian-intention-card-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/intention-card-e2e.json -o /tmp/intention-card-e2e-shots
```

It seeds day, week, and quarter notes relative to the run's local date (plus
fixed ISO year-boundary notes), records the test clock, bob provenance, plugin
hashes, every writer call with stdin, and screenshots. The run proves Reading
and Live Preview placement and seven-key ownership, fail-open cases, `==`,
`[n==r`, `==[r`, guarded edits with Undo, navigation, entry points, the YAML
excursion, a two-pane stale draft, body-edit survival, and an emulated old bob.
Its landing checks hold metadataCache back to prove the applied-write overlay
(first add, Reading, settlement, last remove), retry a stale remove by its
target, slow the writer to race keys and clicks against Undo, and capture the
Reflection summary context, auto-growth, and Alt+J animation in light, dark,
and narrow views. Any unrun check fails the run. Inspect every PNG before
claiming acceptance.

The live-vault coverage audit requires Python 3 with PyYAML (also used by the docs
tooling). It is independent of the scratch UI walkthrough and never repairs the vault:

```bash
python3 scripts/record-card-vault-coverage.py --vault ~/bob \
  --bob /absolute/path/to/bob --report /tmp/record-coverage.json
```

It discovers canonical records across non-hidden Markdown and cross-checks album
folders against `bob albums list`, then calls only `bob records show`. Each authored
YAML key must have exactly one home in properties, identity or other. Absent schema
rows are counted separately. Duplicate YAML keys, malformed inputs, misplaced records,
failed reads and unexpected findings fail explicitly. Reports retain paths, keys,
hashes and finding codes, without publishing values. `--expected-findings` accepts a
JSON array of exact `path`, `code`, `field` (or null), and nonempty `reason` entries;
unused entries fail, so a blanket warning allowlist cannot hide new findings.
Rejected reads retain Bob's error code and remain failures; their authored keys do not
contribute to the covered-key count. An expected warning cannot excuse a rejected read.

Up to eight independent read-only Bob processes run concurrently (`--workers`, 1–8)
to shorten the live audit window. Each has a 30-second timeout (`--timeout`), and the
audit hashes all inspected Markdown before and after. Results remain ordered by path;
each discovered record is checked even when multiple paths resolve to the same route.
Concurrent changes are recorded as unstable reads
and trigger at most two snapshot retries (`--retries`). Successful record reads can be
reused within a run only when all paths, all frontmatter, and complete album and record
bytes remain unchanged. Ordinary-note body activity therefore triggers a fresh scan
without repeating every successful subprocess. Rejections and timeouts are always
retried. The report records executed/reused reads per attempt, and the final full
snapshot must settle; a settled retry never claims the original run was byte-neutral.
The report must live outside the vault. Symlinks are reported without following them.
The registered offline test exercises positive
coverage and deliberate omissions, duplicates, read failures and concurrent changes.

## Focused suites

Navigation Hotkeys, Task Status Cycler, and Block ID Prompt tests are
organized by behavior area and share their corresponding harness:

```bash
node --test scripts/test-navigation-hotkeys-*.cjs
node --test scripts/test-task-status-cycler-*.cjs
node --test scripts/test-block-id-prompt-*.cjs
```

Ledger Tools freshness has six focused files and shares
`scripts/ledger-tools-harness.cjs`. Keep their filenames explicit
because a `freshness-*.cjs` glob also selects other related suites:

```bash
node --test scripts/test-ledger-tools-freshness-placement.cjs scripts/test-ledger-tools-freshness-states.cjs scripts/test-ledger-tools-freshness-namespace.cjs scripts/test-ledger-tools-freshness-review-model.cjs scripts/test-ledger-tools-freshness-queue.cjs scripts/test-ledger-tools-freshness-tracking.cjs
```

The dependency-stage tests share
`scripts/navigation-dependencies-stage-harness.cjs`:

```bash
node --test scripts/test-navigation-dependencies-stage-ranker-and-pool.cjs scripts/test-navigation-dependencies-stage-entry-and-view.cjs scripts/test-navigation-dependencies-stage-writes.cjs scripts/test-navigation-dependencies-stage-mirror-and-badge.cjs scripts/test-navigation-dependencies-stage-stale-guards.cjs scripts/test-navigation-dependencies-stage-performance.cjs
```

The source-build suite is `scripts/test-plugin-build.cjs`. It
covers fragment manifests, deterministic output, read-only freshness checks,
and parity comparison. The full test command also checks that Ledger Tools
owns the `\p` Pomodoro-increment mapping and Navigation Hotkeys
owns `\s` for tab pinning.

## Related

- [Plugin architecture](architecture.md) — generated bundles and inventory files.
- [Deployment](deployment.md) — sync validated source into a vault.
