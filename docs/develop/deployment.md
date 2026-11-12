---
title: "Deploy plugins to a vault"
description: "Build and sync the source repository's plugin files without overwriting vault state."
---

This repository is the source tree for Bob's plugins. Build source-fragment
plugins before syncing so committed `main.js` files are current.
The sync command copies managed plugin files into the vault's
`.obsidian/plugins/<id>/` directories.

```bash
bob plugins list
bob plugins sync --dry-run
bob plugins sync
bob plugins sync -p bob-project-tasks
```

Sync copies `manifest.json`, `main.js`, and
`styles.css` when present. It never touches `data.json`
or other runtime/settings files. Files already matching the source are
reported as unchanged. Changed vault files are backed up before replacement.
Each real deploy writes a `.bob-deploy.json` provenance stamp beside the
plugin. In a Git vault that stamp must be ignored, for example by adding
`.obsidian/plugins/*/.bob-deploy.json` to the vault `.gitignore`; `--force`
does not bypass a tracked or unignored stamp. Do not commit the stamp.

If a vault plugin file has uncommitted changes in the vault's Git repository,
sync leaves it alone and warns; review local changes before deciding whether
to overwrite them. Sync also refuses to overwrite another checkout's
uncommitted or non-ancestor deploy. Same-checkout dirty iteration is allowed
while the stamp still matches the vault. Any clean checkout whose HEAD reaches
a commit holding the deployed bundle byte for byte syncs without `--force`,
and the sync names that proving commit; a later descendant can then update
normally.

### When sync refuses an overwrite

If `bob plugins sync` refuses to overwrite another checkout's deploy, never
pass `-F` on your own and do not ask Bryan yet. Run `git fetch` and
`git log --oneline HEAD..@{upstream} -- plugins/<id>`.

- Landed: the refusal names the commit when it is already fetched. Follow the
  recipe below. No `-F`, no question.
- Author still running: the build has not landed and the agent named in the
  refusal is still running (`sase agent list`). Wait for it to land instead of
  forcing.
- Unlanded and abandoned: ask Bryan. The question must name what `-F` would
  remove from the vault: the deployed plugin version and the features or APIs
  it carries.

```bash
git fetch
git log --oneline HEAD..@{upstream} -- plugins/<id>
git stash push -u
git merge --ff-only @{upstream}   # rebase instead if you have local commits
bob plugins sync --repo "$PWD" --no-pull -p <id>
git stash pop
npm run build                     # source-fragment plugins
bob plugins sync --repo "$PWD" --no-pull -p <id>
```

The clean sync rewrites the stamp to the landed commit, so the second sync is
a descendant deploy and the vault keeps both changes. `-F` is appropriate only
when Bryan approved dropping the deployed build, or when the deployed bytes are
in no commit (for example after an earlier force) and you are deploying a clean
commit that contains the work they carried.

In a Git vault, sync and list also warn when a plugin's whole vault folder
(`.obsidian/plugins/<id>/`) is not ignored or holds tracked files. The warning
prints under the plugin row and appears as `vault_ignore` in JSON output,
including `--dry-run` previews, without blocking the copy. Add
`.obsidian/plugins/<id>/` to the vault `.gitignore` yourself: sync never edits
it and never untracks files, because untracking on one host deletes the files
on the others at their next pull.

The command normally refreshes its plugin repository with a non-interactive
`git pull` before analysis. To deploy the checkout open for local
development, pass its root explicitly and skip that pull:

```bash
bob plugins sync --repo "$PWD" --no-pull
```

`--repo` selects a plugin checkout and `--no-pull` skips
updating that checkout first. `--dry-run` previews without writing vault
files, stamps, backups, or lock files. `--force` overwrites a protected
plugin deploy or vault files with uncommitted Git changes; ordinary
development syncs should omit it. Existing `bob` binaries that do not
understand stamps cannot enforce the guard.

## Rollout smoke check

Plugin rollouts run the packaged Obsidian startup smoke check in an isolated
scratch vault and profile. It never opens the live vault in Obsidian. The
fixture verifies the managed Bob plugin build, not the user's full
third-party plugin/settings combination.

Prerequisites: the Obsidian Electron app (for example `/snap/bin/obsidian`),
`xvfb-run` on Linux, and Node 22. On Linux use an independent Xvfb display,
never the inherited desktop display.

```bash
npm run build:check
node --test scripts/test-obsidian-startup-smoke.cjs
npm test
npm run smoke:obsidian -- --help
```

The offline self-test is an offline check only, never an Obsidian pass:

```bash
npm run smoke:obsidian -- --self-test
```

Run the real isolated check under Xvfb, then build, preview, sync, and run
the mandatory post-sync gate:

```bash
xvfb-run -a npm run smoke:obsidian -- --report /tmp/obsidian-smoke.json
bob plugins sync --repo "$PWD" --no-pull --dry-run
bob plugins sync --repo "$PWD" --no-pull
npm run smoke:obsidian -- --deployed-vault /path/to/vault --report /tmp/obsidian-smoke.json
```

The post-sync command verifies every expected repository plugin is present in
the deployed vault at the expected version with `sync: synced`, then repeats
the check after the smoke run and rejects source changes during the run.
`bob plugins list` exits 0 on drift, so the gate reads the JSON rows itself;
a passing exit code alone is not a pass.

Acceptance uses fixed defaults: layout-ready within 30 seconds of
instrumented startup, and sampled peak JS heap below 1.5 GiB throughout the
run. The gate also requires the ledger relation index ready with zero
non-Markdown keys and the fixture relation indexed, all four editor cases
(canonical daily note plus one ordinary task note, each in Live Preview and
Source mode) mounting a connected CodeMirror editor with the expected text,
and no renderer crash artifacts/events, plugin-load failures, or uncaught
exceptions/rejections. The structured report records the source SHA, plugin
ids/versions and managed-file hashes, executable/app version, durations,
counters, heap peak, each editor result, crash/exception evidence, the
deployment match, and the exact failed checks.

On a skipped, unrun, or failing check, do not claim rollout success. Record
the exact command, the report path, and the verdict; a missing host or
missing prerequisite stays visible as a limitation and never converts into a
pass.

### Obsidian upgrade check

Bob Vim Yank Flash wraps undocumented Vim adapter internals. After every
Obsidian upgrade, run its real-Obsidian CDP check on athena so a changed hook
or selection contract fails visibly instead of silently stopping the flash:

```bash
xvfb-run -a node scripts/obsidian-vim-yank-flash-e2e.cjs \
  -e /snap/bin/obsidian \
  -r /tmp/bob-yank-flash-e2e.json \
  -o /tmp/bob-yank-flash-e2e-shots
```

The check launches an owned scratch vault and profile, installs all repo
plugins, and never opens the live vault. Review the report's per-case verdicts
and screenshots; a skipped pop-out case remains explicitly skipped.

## Distribution scope

This monorepo is a development source and vault sync target, not a package
for direct installation from the Obsidian community registry or BRAT. Each
plugin has its own ID and manifest version, while the repository contains
ten plugins. If one is published separately, split it into its own public
repository with the standard root plugin files and a release tag matching
its manifest version.

The repository is MIT licensed; see [LICENSE](https://github.com/bobs-org/bob-plugins/blob/master/LICENSE).
