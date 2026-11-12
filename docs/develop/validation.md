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

The offline wrapper `scripts/test-obsidian-album-ui-e2e.cjs` is part of `npm test`;
run the real CDP walkthrough with `xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs`.

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
