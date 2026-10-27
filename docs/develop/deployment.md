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
while the stamp still matches the vault. After an uncommitted fix is committed
and present in a clean checkout of the same bytes, a real sync reconciles the
stamp without `--force`; a later descendant can then update normally.

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

## Distribution scope

This monorepo is a development source and vault sync target, not a package
for direct installation from the Obsidian community registry or BRAT. Each
plugin has its own ID and manifest version, while the repository contains
eight plugins. If one is published separately, split it into its own public
repository with the standard root plugin files and a release tag matching
its manifest version.

The repository is MIT licensed; see [LICENSE](https://github.com/bobs-org/bob-plugins/blob/master/LICENSE).
