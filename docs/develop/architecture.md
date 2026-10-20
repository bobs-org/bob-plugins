---
title: "Plugin architecture"
description: "Understand plugin layout, generated JavaScript bundles, and the documentation inventory."
---

This repository is the source tree for seven Bob Obsidian plugins. Each
plugin has its own manifest version; releases are not lockstep. A
`plugins/<id>/` directory uses Obsidian's plugin layout: a
`manifest.json`, a loadable `main.js`, and optional
`styles.css`. A plugin that opts into source fragments also has
`src/fragments.json` and the ordered files it names.

## Generated source bundles

Plugins with `src/fragments.json` use plain CommonJS source
fragments. The JSON array is authoritative: the build concatenates those
files in order into the committed `main.js`. Fragments share one
script scope; they are not independent CommonJS modules. The build rejects
missing, duplicate, escaping, malformed, or omitted fragments, checks the
syntax of each fragment and assembled bundle, and limits hand-edited
fragments to 1,000 lines.

Plugins without that manifest keep `main.js` as hand-edited source.
Do not add a fragment manifest merely to make folder shapes uniform.

Several larger plugins group methods into ordered plain mixin classes.
Navigation Hotkeys' picker mixins extend `FilteredPickerModal` so
`super` continues to resolve. Duplicate-safe installers copy each
mixin's own method descriptors onto the plugin prototype in source order,
preserving the Obsidian plugin class interface.

After editing a fragment, run `npm run build` and commit both the
source and generated entrypoint. Never hand-edit a generated `main.js`.
`npm run build:check` is read-only and reports stale or missing bundles.

The split-parity checker can compare a source split with its recorded Git
base:

```bash
node scripts/check-split-parity.mjs --plugin task-status-cycler --base <git-sha>
node scripts/check-split-parity.mjs --plugin bob-ledger-tools --base <git-sha>
node scripts/check-split-parity.mjs --plugin block-id-prompt --base <git-sha>
node scripts/check-split-parity.mjs --plugin bob-navigation-hotkeys --base <git-sha> --split-helper BulletPropertyPickerModal
```

Repeat `--split-helper <name>` for each exported helper class
intentionally spread across fragments. The checker compares exported
helpers, plugin prototype methods and descriptors, and module-load dependency
calls. Split helpers must keep their name, superclass, and own prototype
methods; the checker does not compare the whole class source text.

## Plugin files

| Path | Role |
| --- | --- |
| `plugins/` | Plugin manifests, runtime bundles, source fragments, and styles. |
| `scripts/` | Bundle generation, inventory generation, validation, migration, and test harnesses. |
| `docs/` | Source-owned plugin reference pages and the generated inventory. |
| `docs/develop/` | Contributor and maintenance documentation. |
| `README.md` | Install and documentation front door. |

```text
plugins/<plugin-id>/
├── manifest.json
├── main.js
├── styles.css                 # optional
└── src/
    ├── fragments.json         # source-build plugins only
    └── *.js                   # ordered source fragments
```

`manifest.json` records the plugin's Obsidian ID, name, version,
minimum Obsidian version, description, author, and desktop declaration. The
ID must match the folder name. Obsidian loads the manifest and
`main.js` from the matching vault plugin directory; it also loads
`styles.css` when present.

## Documentation inventory

The plugin reference lives next to the source in `docs/`. The
dependency-free `scripts/docs-inventory.mjs` reads manifests and
registered commands, then updates marked generated regions in
`docs/index.md`, each plugin page, and the README's minimum-version
requirements. Preserve handwritten prose outside those regions.

Generate facts with `npm run docs:gen` and check drift with
`npm run docs:inventory:check`. Check mode reports missing or stale
output without writing. The full npm gates include this drift check.
Run `npm run docs:check` from this plugin checkout against a resolved
bob-cli checkout; see [Validation](validation.md). See
[the plugin index](https://bobs-org.github.io/reference/plugins/) for the generated inventory.
