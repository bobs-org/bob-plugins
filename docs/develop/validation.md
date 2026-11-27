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

## Real Obsidian runner scratch

Home Cards, Cabinets, Card Foot, Property Editor, Intention Card, Record Card,
Title Block, and Snooze Card use a shared scratch lifecycle. By default, the
live vault, profile, report, and screenshots stay in the run directory under
Node's `os.tmpdir()` (usually `/tmp`). A failed run prints its retained path and
keeps only the newest helper-managed failure run per runner. A successful run
removes its scratch directory. The Snooze Card runner uses the repo's
`.tmp-sn-e2e/snooze-card` as its short, runner-owned root instead.

Only directories with that runner's prefix, created by the shared helper, and
owned by the current user are eligible for pruning. Older scratch directories
that predate the helper are left alone. Default reports and screenshots follow
the run directory; explicit `--out` and `--report` paths remain at the paths
chosen by the caller.

Set `BOB_E2E_KEEP_SCRATCH=1` to retain successful runs too and disable pruning
for deliberate debugging. For cargo targets and ad hoc harnesses, set `TMPDIR`
to a disk-backed directory to keep large builds and harness data off the `/tmp`
tmpfs. Keep Snap Obsidian's temporary socket path short when running the real
acceptance flows; this change does not move their live vaults off the existing
temporary root.

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

Unit and perf processes load `scripts/hermetic-bob-env.cjs` first
(`node --test --require`, and every plugin-booting `scripts/*harness*.cjs`).
On load it overwrites `BOB_DIR` with a sentinel path that never exists
(`/definitely/missing/bob-plugins-test-vault`), points `XDG_STATE_HOME` and
`BOB_VAULT_SYNC_LOCK_FILE` at a writable directory under `os.tmpdir()`, and
sets `BOB_VAULT_SYNC_NOTIFY=0`. A test that needs a vault sets `BOB_DIR`,
`-b`, or the adapter `basePath` to its fixture after that. Electron e2e
launchers (`scripts/obsidian-*-e2e.cjs`) keep their own explicit env.

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
report records the actual Add file property command, its callback shape,
effective hotkeys, and observed dispatch. On Obsidian 1.15.1 the command is
`markdown:add-metadata-property`; another metadata command is not a substitute.
The [takeover matrix](#frontmatter-takeover) verifies production adapters.

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
and Live Preview placement and seven-key ownership, fail-open cases, `=`,
`[n=r`, `=[r`, guarded edits with Undo, navigation, entry points, the YAML
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

## Section Map preview

`scripts/preview-section-map.cjs` renders the production Section Map painter
(`createSectionMapHost` from `src/474-section-map-view.js`) plus
`plugins/bob-navigation-hotkeys/styles.css` in headless Chromium. Models come
from the built bundle's `buildSectionMapModel`, and placement comes from the
production `computeSectionMapPlacement` over the fixture pane's measured
rects, so the PNGs show what the shipped code paints. The page captures nine
scenes in light and dark: margin mode with the from-ring and both chips, a
windowed 42-heading note in overlay mode, a wrap on a 3-heading daily note,
the compact strip, the only-section state, odd and untitled labels, a
two-press mid-slide (re-measured after the 140 ms pill slide settles), a
Notice nudging the overlay card, and reduced motion. It fails when the card
does not paint, escapes the pane, clips a row, misses the current row with
the pill, shows the wrong mode, renders the only-section counter wrong, lets
the compact strip exceed one line, or when body ink falls under 4.5:1 on the
surface in either theme. Set `CHROMIUM_PATH` when no Chrome is on `PATH`:

```bash
node scripts/preview-section-map.cjs --out /tmp/section-map-preview
```

`scripts/test-navigation-section-map-view.cjs` covers the same painter and
placement in a fake DOM (mode boundaries, keyed reconciliation, slide versus
crossfade, chips, ring, gaps, compact content, entrance replay, hostile
labels, malformed models) and runs in `npm test`; it is not acceptance.

Real-Obsidian acceptance lives in `scripts/obsidian-section-map-e2e.cjs`: it
drives real Ctrl+J / Ctrl+K keys over CDP in an owned scratch vault, both the
insert / non-Vim `hotkeys.json` route and the Vim normal-mode route (the
vault's exmap+nnoremap pair emulated with the CodeMirror Vim API, recorded in
the report), then checks the linger lifecycle and every dismissal reason, the
wrap pill, chip-target parity, 42-heading windowing with exact gap counts, the
compact strip in a narrow split, margin mode with readable line length, the
pinned peek, unchanged note hashes, and a clean console, with light and dark
screenshots. `scripts/test-obsidian-section-map-e2e.cjs` runs its offline
self-test in `npm test`:

```bash
xvfb-run -a node scripts/obsidian-section-map-e2e.cjs \
  -e /snap/bin/obsidian -r /tmp/section-map/report.json -o /tmp/section-map/shots
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

## Area and Project card walkthrough

The offline wrapper `scripts/test-obsidian-home-cards-e2e.cjs` is part of `npm test`.
It checks the synthetic fixtures, screenshot inventory, probe syntax, and acceptance
rules without launching Obsidian, and is not real-app acceptance. Run the real
walkthrough on athena from a fresh `/tmp` copy of the working tree under an
independent Xvfb display:

```bash
xvfb-run -a node scripts/obsidian-home-cards-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/home-cards-e2e.json -o /tmp/home-cards-e2e-shots
```

It seeds an isolated Git vault with synthetic Area and Project notes only, copies the
built ledger-tools plus navigation-hotkeys, task-status-cycler, and Tasks, pins
`2026-11-24` through `BOB_NOW` and an in-page `Date` override, and owns the Obsidian
process/profile/CDP target. A `bob` shim on `PATH` records every subprocess. The run
proves both species in Live Preview and Reading, extra fixtures (archived terminal,
late H1, deep ancestry, long summary, shadowed/invalid clock, cap-off, created
stamps, nested inbox, nested `^prj`, untyped control), collapse and `-` drawer in both
modes, Settings/chip handoff to the browse editor, missing-editor inert rendering,
modifier crumbs, Source/eligibility/rename/delete, injected mount failure with native
title restore, denied embed/print/mobile contexts, native Properties hidden only while
the ownership gate is valid and restored on failure, Task Card open/close on `^prj`
with `Esc`/`q`/`Ctrl+[`, and Ctrl+Enter on a separate completion fixture. Screenshots
cover light/dark × wide/narrow (narrow card
containers at or below the 420 px breakpoint), collapsed, open-drawer, and reduced
motion, with recorded container geometry and visual verdicts. Review every PNG and
the report's checks, note-byte hashes, and bob invocation log. Copy the report and
screenshots back from athena and retain them through `/sase_artifact`.

The cursor walkthrough puts Vim on body text below an Area card and a Project card.
After each Live Preview `-` drawer open/close and `_` collapse/expand, it checks that
the editor head is unchanged, the card height changed, and the painted block cursor is
within 2 px of `coordsAtPos(head, 1)`. The report records the checks
`minus-open-cursor-tracks-text`, `minus-close-cursor-tracks-text`,
`underscore-collapse-cursor-tracks-text`, `underscore-expand-cursor-tracks-text`, and
`underscore-project-cursor-tracks-text` and `underscore-project-expand-cursor-tracks-text`.
It also checks Project `_` collapse/expand. Each step keeps the same editor head,
changes card height, and leaves the drawn block cursor within 2 px of the text.

## Bank and home-card takeover evidence

The production-adapter runner, `scripts/obsidian-frontmatter-takeover-e2e.cjs`, opens
synthetic notes in an isolated vault. Area, sub-area, inbox (INBOX pill), active
Project, terminal Project, and Bank each show one card, one title, and one Properties
foot, with native Properties hidden, in Live Preview and Reading. Untyped `area.md` and
`project.md`, and Area notes under `_templates/`, `done/`, and `_conflicts/`, stay
native. A `props_v1`-only bob keeps Area and Project native (fail open) while Bank stays
owned. Bank never takes Area ownership.

On Area and Project in Live Preview, `-` toggles the drawer and `_` folds the details.
`=` opens species Settings, bare `+` opens the generic editor, and Esc, `q`, and
Ctrl+`[` close it. Vim `k`/`gg` and Up land on visible body text. The active `^prj` line
keeps its byte hash through selection and adjacent typing. CDP IME composition does not
compose on that line, so IME is not covered. Shared checks cover capability,
source/cache, context, mount, path, and unload recovery.

The 2026-11-27 runs at bob-plugins `0ffb4511` with bob `dc96ef4c` are GO 76/76 twice:
38/38 Live Preview, 14/14 Reading, and 24/24 shared. Each run has 78 screenshots and no
console exceptions. All 32 Area, inbox, and Project PNGs pass review and are identical
across runs. Evidence: `file:explicit:dc34d1462acc604726734526`. The three earlier
GO 63/63 runs, before the Area and Project fixtures, are report
`file:explicit:660cabc9cf32530dcf480887` and bundle
`file:explicit:d254ed707483200bbaaca14f`.

## Card foot walkthrough

`scripts/obsidian-card-foot-e2e.cjs` proves the shared property-card foot and
drawer in an isolated Obsidian vault with a real bob. It covers album, record,
day, week, quarter, year, and bank setup feet in Reading and Live Preview,
including identity-only notes and collapsed record/bank states. It proves the
disclosure and `-` toggle the same drawer, normal `=` still opens the
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

Area/project settings have a separate scenario module,
`scripts/obsidian-property-editor-e2e-settings.cjs`, called by the same real
Obsidian runner. It uses contract-shaped area, project, and top-level project
fixtures. It checks Settings and chip focus, `+`/`=` routing, ready-cap ghost
→ override → clear with exact undo/redo bytes, Summary and Review stages,
Stats root set/clear and top-level refusal,
project-task navigation without scheduling writes, managed/loose-row parity,
and independent old-Bob and missing-contract fallbacks. Warning cases save
and undo long summaries and colliding Capture names; copy cases preserve
legacy theme and both clock keys, while a ghost leaves the clipboard alone.
The run also deletes and restores retired counts, exercises IME Enter on a
Summary draft, and visits every rendered policy chip.

The area and project fixtures live at the vault root with unique stems
(`settings-acceptance-area.md`, `settings-acceptance-project.md`), because
Capture names only collide between routable capture targets. Before
launching Obsidian, the supplied Bob must recognize the fixture's exact
`#task … ^prj` line and its nested/top-level Stats root distinction, and a
dry run of `Garden` on the project must return
`project_name_aliases_conflict` without writing. Bank routing probes the
setup modal separately from the persistent inline bank panel. Consecutive
Stats root toggles await the confirmed contract and completed save, since
file replacement precedes that response.

Warnings are read only after Bob's guarded preview is ready for exactly the
draft the stage currently builds. The local `Preview ·` line paints before
Bob answers, so it is never treated as Bob's verdict.

Screenshots cover populated area and project settings, plus all four simple
stages (Summary, Ready cap, Review, Capture names), in light/dark and
wide/narrow layouts. Each stage is captured holding a valid changed draft
with its Bob preview settled. Esc then cancels it, and the note bytes must
be unchanged. Header probes require the badge, titles, and actions not to
overlap or leave the header, and the title column to stay readable. Narrow
modals wrap the actions onto their own row. Stage screenshots require
visible controls and the preview inside an uncompressed stage, and long
settings values must wrap inside their rows. Controls are scrolled into
view after each resize; an offscreen stage is not visual acceptance.

The offline wrapper verifies these fixtures and registers all settings
coverage in the report. It does not replace the real application run or
screenshot inspection.

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

## Frontmatter takeover

`scripts/obsidian-frontmatter-takeover-e2e.cjs` tests production album,
record, and temporal adapters in a disposable Git vault and owned Obsidian
profile/process. It never opens the live vault or manually claims ownership.
Build bob from the current primary checkout and supply it explicitly:

```bash
BOB_CLI_DIR=<disposable-bob-cli-checkout> \
BOB_BIN=<disposable-bob-cli-checkout>/target/debug/bob \
xvfb-run -a node scripts/obsidian-frontmatter-takeover-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/frontmatter-takeover.json -o /tmp/frontmatter-takeover-shots
```

Use athena's existing isolated execution route when the current host lacks
Obsidian/Xvfb. Transported CLI builds use the same `BOB_CLI_PROVENANCE` and
`BOB_CLI_PROVENANCE_SHA256` contract as the property-editor runner above.
The report records source SHAs, binary and plugin hashes, capability,
Obsidian version, command invocations, skips, console exceptions, and
per-image hashes. Its offline wrapper,
`scripts/test-obsidian-frontmatter-takeover-e2e.cjs`, belongs to `npm test`;
an offline pass is not real-app acceptance.

The required matrix covers automatic ownership in Live Preview and Reading
for day, week, record, and album, plus quarter/year and identity-only days.
The full profile also runs `foreign-refresh-keeps-ownership`: after one write
to an unrelated scratch note, day Live Preview and Reading, album Live Preview,
and record Live Preview must stay owned through 1.5 seconds without pane input.
It checks Source, navigation, malformed/unclosed YAML, cache skew, denied
contexts (embeds, hover, canvas, print, mobile), failed mounts, container
replacement, and disable/unload. Capability cases cover pending, absent,
failed probes, configured bob-path switches, and late replies after unload.
Focus checks exercise Vim `k`/`gg`, Up at line zero, Tab/Shift+Tab, and body
typing after navigation. Live Preview body typing across autosave and a
150 ms simulated re-parse must keep ownership on a record and a day note
(`live-autosave-keeps-ownership`, `live-slow-reparse-keeps-card`). Mod+`;`, a custom shortcut, and command dispatch
must open Add mode on an owned document; ordinary/bank notes and the File
Properties sidebar stay native. Helper focus and failed-opener fallback are
also required. Container/attribute restoration is probed at the transaction
or frame boundary so settling waits cannot hide stale ownership.

Protected fixture hashes must remain unchanged during passive rendering;
invocation logs check for unexpected paint subprocesses. Native fallback
actions that may write use a separate disposable note. Screenshot capture
first dismisses every editor layer and resets scroll/drawer state, then
checks actual ownership, native visibility, and a single metadata container.
DOM-injection probes run in their own disposable leaf and detach it afterward.
Capture light/dark × narrow/wide card views in both modes, bank's native
controls, the ordinary-note Add editor, Source, and malformed fallback.
Open every PNG, verify its digest/size, and record an individual visual
verdict. Retain the raw and inspected reports, all images, logs, and exact
source/bundle/runner provenance through `/sase_artifact`.

The 2026-11-24 acceptance on Obsidian 1.15.1 passed 51/51 checks
(22 Live Preview, 8 Reading, 21 shared) and all 46 individually reviewed
captures, with no capture failures or console exceptions. Both desktop
modes support takeover; no mode-specific per-row-only restriction remains.
Bank and the denied contexts above retain native access. The tested plugin
commit is `3824ce558a08174d74addcc6f14687303dfd635a`; CLI source is
`8d82c621b25d1595ec8a495c30f6087fbc87f524`. The complete retained acceptance
archive is `file:explicit:85b3b710894edb85fafa6063`; phase `bob-cli-pf.6.1.4`
records exact binary/bundle hashes and the separate, reproduced baseline
aggregate-suite exceptions (`bob-cli-n0` and `bob-cli-km`). Those exceptions
do not represent failures in the real-app takeover matrix.

## Real-Obsidian Cabinets acceptance

`scripts/test-obsidian-cabinets-e2e.cjs` validates the synthetic fixture set,
probe syntax, and screenshot inventory without launching Obsidian. That offline
check is not real acceptance. Run the full walkthrough on athena against the
current source build:

```bash
xvfb-run -a node scripts/obsidian-cabinets-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian \
  -r /tmp/cabinets-e2e.json -o /tmp/cabinets-e2e-shots
```

The runner creates a scratch Git vault and owned Obsidian profile with synthetic
area, project, album, bank, prose, notebook, record, ref, and period notes.
Cabinets are always on, so the runner is gate-free: it seeds no plugin data,
never opens the live vault, and puts a refusing `bob` shim first on `PATH`. The
report records every Live Preview and Reading species, keyboard and fail-open
checks (Source mode, embeds, hover, print, a forced mount error, and plugin
disable), content parity of each cabinet body against the stored callout rows
in the note's bytes, cabinet paint timings, markdown hashes, unexpected Bob
spawns, and each captured screenshot's hash and dimensions. The
cabinet-vs-inline perf budget needed the closed preview gate, so it retired at
go-live; the acceptance GO evidence on `bob-cli-qq.8` holds it.

Inspect every PNG in the screenshot directory, including the light/dark,
narrow/wide, Live Preview/Reading, reduced-motion, forced-colors, and
Source-mode captures.
Record a visual verdict for each image before calling the bead GO. Retain the
report and all screenshots with `/sase_artifact`. A runner error, failed check,
missing screenshot, or unreviewed capture is NO-GO; fix it in scope or record
the follow-up on the phase bead.

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

The tie suites cover the §22 twins and absorption, plus stage copy, guarded
chord hints, live footer refresh, release alternatives, and kept-relation
notices:
`scripts/test-navigation-plain-link-ties.cjs` (mirrored PT vectors plus the
PT22+ planner vectors), with DW20–DW22 in
`scripts/test-navigation-dependencies-writer.cjs` and RBP12–RBP13 in
`scripts/test-navigation-blocks-edit.cjs`; `scripts/test-navigation-tie-chords.cjs`,
`scripts/test-navigation-tie-change-writer.cjs`,
`scripts/test-navigation-counted-tie-absorption.cjs`, and
`scripts/test-navigation-dependency-link-consumption.cjs` and
`scripts/test-navigation-tie-stage-copy.cjs` cover navigation tie dispatch,
combined writes, counted absorption through the counted entrypoints, Pomodoro
consumption, and stage copy.

The source-build suite is `scripts/test-plugin-build.cjs`. It
covers fragment manifests, deterministic output, read-only freshness checks,
and parity comparison. The full test command also checks that Ledger Tools
owns the `\p` Pomodoro-increment mapping and Navigation Hotkeys
owns `\s` for tab pinning.

## Related

- [Plugin architecture](architecture.md) — generated bundles and inventory files.
- [Deployment](deployment.md) — sync validated source into a vault.
