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

The offline wrapper `scripts/test-obsidian-frontmatter-ownership-spike.cjs`
is part of `npm test`. It checks fixtures, the S1 verdict, and page-source
syntax without launching Obsidian. Run the real go/no-go probe with
`xvfb-run -a node scripts/obsidian-frontmatter-ownership-spike.cjs`. The
report records the Add file property command id for `takeover`.

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

## Command chip preview and e2e

`scripts/preview-command-chips.cjs` renders every command-chip face from
the built `plugins/bob-chips/main.js` and `styles.css` in headless Chromium.
It uses the real scanner, builders, run store, paint model, and painter
under the shared Obsidian baseline in
`scripts/preview-obsidian-baseline.cjs` (the same 2.1.2 button rules and
default light/dark palettes as the copy-chip preview, including
`--color-blue` and `--text-on-accent`). Command Mode's own resolver
produces the verdicts from
`scripts/fixtures/command-mode-resolve-vectors.json`. The page puts chips
on plain, Blocked, Next, and WIP rows beside cyan inline code and accent
links, and captures light, dark, a 390 px viewport, dark with reduced
motion, print, and the cards in light and dark. It fails when a Live
Preview span and a Reading button compute a different fill, border,
shadow, ink, padding, font, or outline in any state; when a state changes
the chip's or the well's size; when a sweep of 7,272 layouts per surface
(widths 120–420 px, 0–11 lead words, six faces) strands the well, wraps
an end cap alone, overshoots by more than the end padding, or shifts when
the tooltip shows; when face ink falls under 4.5:1 or the glyph under 3:1
on its fill; when the progress bar is not on the face; when a payload
appears in an attribute or the ARIA names are wrong; when a card's Run
button changes width between Run and Output, or a copy-only card's Copy
button changes width between Copy, Copied ✓, and Copy failed; when reduced
motion still animates; or when any state prints as more than plain inline
code. Set `CHROMIUM_PATH` when no Chrome is on `PATH`:

```bash
node scripts/preview-command-chips.cjs --out /tmp/command-chips-preview
```

`scripts/obsidian-command-chips-e2e.cjs` drives chips in a real Obsidian
with trusted CDP mouse input. The profile, home, XDG tree, and vault live
under one `/tmp` run root. Command Mode's `bobPath` names a stub `bob`
that serves a fixture catalog, logs every invocation, and writes only its
own scratch note. The stub is also first on `PATH`, and no other `bob`
candidate exists. The runner refuses to launch if any of that isolation
fails. Tasks and Dataview are copied from `--query-plugins DIR` (default
`~/bob/.obsidian/plugins`), and the cases need them. The wrappers
`scripts/test-obsidian-command-chips-e2e.cjs` and
`scripts/test-command-chips-preview.cjs` run in `npm test`. They check the
fixture, the stub, the isolation boundaries, and the preview matrix
offline; they are not acceptance. Run the real check on athena, whose
Node 20 needs `--experimental-websocket`:

```bash
xvfb-run -a node --experimental-websocket scripts/obsidian-command-chips-e2e.cjs \
  --out /tmp/command-chips-e2e
```

Its `report.json` records each case, the stub's full invocation log,
and the Tasks, Dataview, Bob Chips, and Command Mode versions.
`scripts/obsidian-command-chips-look-e2e.cjs` adds the look cases: a labeled
ready chip as a Live Preview span and a Reading button computes one look
at rest and under a trusted CDP hover, the tooltip shows about 0.4 s after
the hover, a trusted click turns the well green, and a `ref/` chip wears
the copy well. Hover captures force `:hover` through DevTools.
`scripts/test-command-chips-look.cjs` statically checks the run styles.

## Copy chip preview and e2e

`scripts/preview-copy-chips.cjs` renders copy chips and `bob-copy` cards
from the built `plugins/bob-chips/main.js` and `styles.css` in headless
Chromium, using the real scanner, builders, and feedback under Obsidian
2.1.2's own button rules and default light and dark palettes. The page
puts chips on plain, Blocked, Next, and WIP rows beside cyan inline code
and accent links, and captures light, dark, a 390 px viewport, dark with
reduced motion, print, and the cards in light and dark. It fails when a
Live Preview span and a Reading button compute a different fill, border,
shadow, ink, padding, font, or outline in any state (rest, hover, pressed,
keyboard focus, copied, failed); when a state changes the chip's or the
well's size; when a sweep of 3,636 layouts per surface (widths 120–420 px,
0–11 lead words, three faces) strands the glyph, wraps an end cap alone,
overshoots by more than the end padding, or shifts when the tooltip shows;
when face ink falls under 4.5:1 or the glyph under 3:1 on its fill; when
the tooltip is not hidden at rest, not delayed 0.4 s, or not shown above
the chip with the builder's text; when any state prints as more than plain
inline code or a card prints chrome; when reduced motion still animates;
when a payload appears in an attribute or the ARIA names and descriptions
are wrong; or when a card's Copy button takes Obsidian's button look or
changes width between Copy, Copied ✓, and Copy failed. Set `CHROMIUM_PATH`
when no Chrome is on `PATH`:

```bash
node scripts/preview-copy-chips.cjs --out /tmp/copy-chips-preview
```

`scripts/obsidian-copy-chips-e2e.cjs` checks one labeled chip in a real
Obsidian scratch vault: the Live Preview span and the Reading button
compute one look at rest and under a trusted CDP mouse hover, the tooltip
shows about 0.4 s after the hover, and a trusted click turns the well
green and copies byte-exact. It saves `copy-chip-{live,reading}-{rest,hover,copied}.png`
to `--out`. A clipped screenshot drops a trusted hover in Electron, so the
hover captures force `:hover` through DevTools. `scripts/test-copy-chips-look.cjs`
statically checks the copy styles, and `scripts/test-copy-chips-preview.cjs`
and `scripts/test-obsidian-copy-chips-e2e.cjs` run the offline self-tests
in `npm test`; they are not acceptance. Run the real check on athena from a
fresh `/tmp` copy of the working tree, never from `~/bob`:

```bash
xvfb-run -a node --experimental-websocket scripts/obsidian-copy-chips-e2e.cjs \
  --out /tmp/copy-chips-e2e
```

## Prose-field walkthrough

`scripts/obsidian-prose-field-e2e.cjs` drives `[[` completion through the real
Work summary (S1), Task Card review and scheduled reason (S10, S11), Intention Card
reflection (S14), and Record Card text and link stages (S15). It uses trusted CDP keys
in one owned Obsidian on a scratch Git vault. On each surface it filters, drills `#`,
accepts with Enter and a held Enter, undoes once with Ctrl+Z, closes the band with
Escape, submits, and checks the written note text. `BOB_BIN` is the bob the plugins
spawn. Run it on athena from a fresh `/tmp` copy of the working tree:

```bash
BOB_BIN=$HOME/.cargo/bin/bob xvfb-run -a node --experimental-websocket \
  scripts/obsidian-prose-field-e2e.cjs -r /tmp/prose-walk.json -o /tmp/prose-walk-shots
```

## Prose-task walkthrough

`scripts/obsidian-prose-task-e2e.cjs` drives `((` completion through the real
Work summary (S1), dense successor cancel reason (S6), Task Card review and
scheduled reason (S10, S11), Intention Card reflection (S14), and Record Card
text and link stages (S15). On each surface it accepts an identified task,
names an ID-less task, undoes once, checks Enter safety and the Esc ladder,
submits, and confirms `[[target#^id]]` in the written note. It then runs
`bob task reconcile` and checks the target's `🪢 LINKED FROM` row for a `💬`
mention chip with no Task Link or relation. `BOB_BIN` is the bob the plugins
spawn. Run it on athena from a fresh `/tmp` copy of the working tree:

```bash
BOB_BIN=$HOME/.cargo/bin/bob xvfb-run -a node --experimental-websocket \
  scripts/obsidian-prose-task-e2e.cjs -r /tmp/prose-task-walk.json -o /tmp/prose-task-shots
```

## Group-jump walkthrough

`scripts/obsidian-group-jump-e2e.cjs` proves `[N` / `]N` in one owned Obsidian.
Real bob scaffolds the period notes and syncs a `walk_by` album in a scratch Git
vault. A logging shim lets the plugins reach only the period, album, and record
commands. The run covers weeks, quarters, years, dailies, and authored `«` / `»`
nav lines. It also covers grouped records, creatable and ghost stops, `]}`, and
rail and footer clicks with `<C-o>`. It needs Templater and a bob that reports
`record_walk_groups_v1`:

```bash
BOB_BIN=$HOME/.cargo/bin/bob xvfb-run -a node \
  scripts/obsidian-group-jump-e2e.cjs -r /tmp/group-jump.json -o /tmp/group-jump-shots
```

## Card foot walkthrough

`scripts/obsidian-card-foot-e2e.cjs` proves the shared property-card foot and
drawer in an isolated Obsidian vault with a real bob. It covers album, record,
day, week, quarter, year, and bank setup feet in Reading and Live Preview,
including identity-only notes and collapsed record/bank states. It proves the
disclosure and `-` toggle the same drawer, normal `==` still opens the
appropriate editor, palette/Command Mode work without a Vim prefix, cursor and
selection stay unchanged on `-`, typing `a-b` in Vim's `/` search prompt leaves
the drawer unchanged, opening an off-screen foot scrolls it into
view while collapse does not scroll, `y` rows carry source lines (including
duplicate and invalid-YAML recovery), nested schema/setup links reach existing
editors, per-note session survives walk-away and two panes share state with
unique disclosure IDs, and paint/fold/toggle/collapse write no Markdown and
spawn no bob. The offline wrapper `scripts/test-obsidian-card-foot-e2e.cjs`
is part of `npm test`; it checks fixtures, probe syntax, keys, and the runner
file without launching Obsidian or bob, and is not acceptance. Run the real
walkthrough on athena from a fresh `/tmp` copy of the working tree under an
independent Xvfb display:

```bash
BOB_BIN=<bob-cli-cargo-target>/debug/bob \
BOB_CLI_DIR=<bob-cli-checkout> \
xvfb-run -a node scripts/obsidian-card-foot-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/card-foot-e2e.json -o /tmp/card-foot-e2e-shots
```

It seeds a scratch Git vault with album, record, temporal, bank, duplicate,
invalid, unclosed, identity-only, and missing-created fixtures, copies the
built ledger-tools (plus hotkeys and Command Mode for `--scope full`),
verifies the explicit current bob binary with the same clean-tree or pinned
provenance gate as the record-card runner, and records the bob-cli source SHA,
binary SHA256, version, plugin hashes, every writer invocation, note-byte
hashes, console exceptions, and the full screenshot matrix. Coverage limits:
`--scope full` requires every species, both modes, the drawer/entry-point
matrix, and the no-write/no-spawn gates; `--scope foot` proves rendering only
and its result cannot stand for full acceptance. Review every PNG and the
report's checks, note-byte hashes, and logged bob invocations. Copy the report
and screenshots back from athena and retain them through `/sase_artifact`.

## Property Editor walkthrough

`scripts/obsidian-property-editor-e2e.cjs` proves the generic `+` Property
Editor in an isolated Obsidian vault with a real bob. Write-path coverage
includes project, day, plain, and record notes: exact disk bytes after edit,
add, delete, undo, and redo; Tab completion and Shift+Enter literal names;
checkbox, datetime, tags, ordered list, and null versus empty-string
preservation; derived and identity refusals with YAML targets; invalid,
unclosed, and duplicate YAML recovery; old-bob read-only; and record-field
handoff. Parity coverage on a dedicated fixture note adds keyboard rename
(including duplicate and protected-destination refusals) with undo and redo;
source-order reorder with traveling comments, boundary no-ops, the filter
lockout, and reduced-motion moves; mark and visual-range batch delete with
undo plus mixed-protected refusal; incremental filtering with focus return,
empty results, Esc layering, and marks reset; source-exact copy (comments
included) with protected-row and opaque cases; overwrite paste with
New/Replace/Skipped review, stale-preview invalidation, malformed and
all-skipped blocking, and one undoable batch; the multiline YAML value stage
(save, malformed drafts, and opaque refusals); local kind conversion with the
`created`-to-datetime warning and undo; and the separately confirmed vault
property-type change confined to the scratch vault. Interaction coverage adds
the menu/stage/filter/modal close ladder, native clipboard inside text
inputs, two-pane unsaved renames, and unload during paste reads and previews.
Surface coverage includes two panes of one note with unsaved editor
text, a stale draft that keeps its preview, history across close and reopen,
`y` then Done restoring Live Preview and the same key, duplicate occurrence, or
nearest surviving row, the Esc / `q` / Ctrl+[ close ladder (`q` types in a
field; Ctrl+[ never does), plugin unload with no late reopen, and every entry
point (`+` and Shift+`=` in Live Preview Vim normal, with `=+` falling
through, palette **Edit note properties**, Command Mode, drawer key-label /
Add property / Edit all, and
`openPropertyEditor`) on ordinary and invalid-YAML notes. Screenshot coverage
adds light/dark and narrow/wide views of the marked rows, filter, rename,
YAML, paste-preview, and conversion/global-warning states, each with layout
probes for clipping, overlap, overflow, focus, and selected-versus-marked
contrast.

The offline wrapper `scripts/test-obsidian-property-editor-e2e.cjs` is part of
`npm test`. It checks fixtures, fake-bob JSON, probes, coverage mapping, and
the runner file without launching Obsidian or bob, and is not acceptance.
`--self-test` on the runner is the same offline gate.

For real acceptance, use athena's Obsidian Electron binary and a clean copy of
the current bob-cli checkout and bob-plugins source under a disposable
directory. Build `bob` from that checkout and place the exact binary at its
`target/debug/bob`. Then run:

```bash
BOB_CLI_DIR=<disposable-bob-cli-checkout> \
BOB_BIN=<disposable-bob-cli-checkout>/target/debug/bob \
xvfb-run -a node scripts/obsidian-property-editor-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/property-editor-e2e.json -o /tmp/property-editor-e2e-shots
```

The runner refuses a missing or incompatible supplied binary and records the
bob-cli source SHA, binary SHA256, version, plugin hashes, and the real
`props_v1` capability from `bob props show`. If a build coordinator transports
uncommitted CLI changes, it must also provide `BOB_CLI_PROVENANCE` and
`BOB_CLI_PROVENANCE_SHA256` as the record-card runner does. Without a manifest
the checkout must be clean.

It seeds a unique scratch Git vault, copies built ledger-tools plus
navigation-hotkeys and Command Mode, enables Vim mode and a Ctrl+P command
palette binding, and never opens the live vault. The report retains pass, skip,
and fail assertions, console exceptions, Bob invocations, light/dark
narrow/wide screenshots, and per-image layout metrics (clipping, key/value
overlap, adjacent-row overlap, value overflow, selected-row contrast,
locked-row contrast, focus ring). The runner's layout probes are automated
geometry checks (`visualVerdict: layout-probed`); they do not inspect the PNG
pixels. Open and review every PNG, record per-image hashes and verdicts on the
report, and only then claim visual acceptance. The offline self-test is not
real-Obsidian acceptance. Copy the report and screenshots back from athena and
retain them through `/sase_artifact`.

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
