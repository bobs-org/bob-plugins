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
If a vault plugin file has uncommitted changes in the vault's Git repository,
sync leaves it alone and warns; review local changes before deciding whether
to overwrite them.

The command normally refreshes its plugin repository with a non-interactive
`git pull` before analysis. To deploy the checkout open for local
development, pass its root explicitly and skip that pull:

```bash
bob plugins sync --repo "$PWD" --no-pull
```

`--repo` selects a plugin checkout and `--no-pull` skips
updating that checkout first. `--dry-run` previews without writing.
`--force` permits overwriting vault plugin files with uncommitted
changes; ordinary development syncs should omit it.

## Distribution scope

This monorepo is a development source and vault sync target, not a package
for direct installation from the Obsidian community registry or BRAT. Each
plugin has its own ID and manifest version, while the repository contains
eight plugins. If one is published separately, split it into its own public
repository with the standard root plugin files and a release tag matching
its manifest version.

The repository is MIT licensed; see [LICENSE](https://github.com/bobs-org/bob-plugins/blob/master/LICENSE).
