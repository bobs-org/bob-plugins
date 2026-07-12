# bob-plugins

Source-of-truth monorepo for Bryan's custom [Obsidian](https://obsidian.md) plugins, used in the **Bob** vault.

These six plugins used to live only inside the vault under `~/bob/.obsidian/plugins/<id>/`, mixed in with third-party
community plugins and personal notes. This repo extracts the Bryan-authored plugins into one place so they can be
versioned, validated, and reviewed independently of the vault. The plugins are deployed back into the vault with
[`bob plugins sync`](#deploying-to-the-vault).

## Plugins

| Plugin                  | id                       | Version | Description                                                            |
| ----------------------- | ------------------------ | ------: | --------------------------------------------------------------------- |
| Block ID Prompt         | `block-id-prompt`        |   1.3.0 | Prompt for custom block IDs, complete wiki block links to open tasks (skipping `#hide` tasks), and mark dependency-blocked tasks. |
| Bob Ledger Tools        | `bob-ledger-tools`       |   1.1.1 | Expand Bob daily-note snippets and ledger time ranges, and navigate and adjust Pomodoro entries. |
| Bob Navigation Hotkeys  | `bob-navigation-hotkeys` |  1.13.1 | Open and manage related notes and tabs, including toggling the current tab pin. |
| Bob Project Tasks       | `bob-project-tasks`      |   1.0.0 | Keep project task counts materialized in frontmatter.                 |
| Bob Vim Surround        | `bob-vim-surround`       |   1.5.0 | Add vim-surround `ys` motions, `cs` changes, `ds` deletes, and dot-repeat to Obsidian Vim mode. |
| Task Status Cycler      | `task-status-cycler`     |   1.3.2 | Toggle tasks and Pomodoros open or done with recursive close and root-only reopen, retire completed references, and reconcile Tasks dependency IDs. |

Versions are tracked **per plugin** — there is no lockstep release. Each plugin's authoritative version lives in its own
`plugins/<id>/manifest.json` (e.g. `bob-vim-surround` is ahead of the others at `1.5.0`).

Bob Vim Surround accepts every visible, single-UTF-16-code-unit letter, number,
punctuation character, or symbol as a surround key. The standard bracket aliases
retain vim-surround padding behavior; all other accepted characters are symmetric
delimiters. Whitespace, controls and navigation keys, modifier chords, composition
and dead keys, combining marks, and multi-code-unit characters such as emoji are
not accepted. Symmetric delimiters are discovered as sequential same-line pairs around
the cursor, so delimiter characters inside the content can make letter-based pairs
ambiguous; this intentionally does not attempt nested parsing.

## Layout

```text
bob-plugins/
  README.md
  LICENSE
  .gitignore
  package.json                  # repo tooling only (not a bundler)
  scripts/
    validate-manifests.mjs      # manifest + main.js sanity checks
    migrate-task-dependency-identities.mjs # dry-run-first identity migration
  plugins/
    block-id-prompt/{manifest.json,main.js,styles.css}
    bob-ledger-tools/{manifest.json,main.js}
    bob-navigation-hotkeys/{manifest.json,main.js,styles.css}
    bob-project-tasks/{manifest.json,main.js}
    bob-vim-surround/{manifest.json,main.js}
    task-status-cycler/{manifest.json,main.js}
```

Each `plugins/<id>/` folder is exactly the shape Obsidian loads from `<vault>/.obsidian/plugins/<id>/`.

## Development model

These are **plain CommonJS** Obsidian plugins. There is intentionally no TypeScript, no bundler, and no build step:
`main.js` is the source, not a generated artifact. Edit `main.js` directly.

Each plugin folder contains the files Obsidian reads when loading a plugin:

- **`manifest.json`** — plugin metadata. Obsidian loads a plugin from
  `<vault>/.obsidian/plugins/<id>/manifest.json` + `main.js`, so the manifest `id` must match the folder name. Shape:

  ```json
  {
    "id": "bob-project-tasks",
    "name": "Bob Project Tasks",
    "version": "1.0.0",
    "minAppVersion": "1.8.7",
    "description": "Keep project task counts materialized in frontmatter.",
    "author": "Bryan",
    "isDesktopOnly": false
  }
  ```

- **`main.js`** — the plugin code (CommonJS: `require(...)` / `module.exports`).
- **`styles.css`** — optional plugin CSS (currently `block-id-prompt` and `bob-navigation-hotkeys` ship one).

### Validation

```bash
npm test
npm run validate
```

`npm test` runs the focused pure-helper coverage for Bob Navigation Hotkeys,
including scheduled-project task extraction, frontmatter handoff, date
boundaries, project-property target resolution, scheduled task-visibility
reconciliation, deletion behavior, child-picker presentation metadata, and the
tab-pin Vim mapping. It also guards the distinct Vim mapping ownership: Bob
Ledger Tools uses `\p` for Pomodoro increments, while Bob Navigation Hotkeys
uses `\s` for toggling the current tab pin.

It also runs focused Bob Vim Surround coverage for accepted and rejected
delimiter keys, `ys`/`cs`/`ds` edits, bracket padding, event handling, and
dot-repeat.

`scripts/validate-manifests.mjs` checks every plugin under `plugins/`:

- `manifest.json` parses as JSON and has the required fields (`id`, `name`, `version`, `minAppVersion`, `description`,
  `author`);
- the manifest `id` matches its folder name;
- `version` is a valid `x.y.z` semver;
- `main.js` parses under Node (a syntax check via `node --check`; the code is never executed).

It exits non-zero if any plugin fails, so it is safe to run in CI or a pre-commit hook.

### Dependency identity migration

Obsidian block fragments remain file-scoped, but Tasks metadata is vault-wide.
The plugins encode `projects/Shared.md#^review` as
`projects__Shared__review` in `[id::]` and `[dependsOn::]`, while navigation
continues to use `[[projects/Shared#^review]]`.

Preview or apply the idempotent migration with:

```bash
node scripts/migrate-task-dependency-identities.mjs --vault ~/bob
node scripts/migrate-task-dependency-identities.mjs --vault ~/bob --write
```

Write mode refuses encoding collisions, ambiguous legacy IDs, and unsupported
path characters. `_generated`, `_templates`, `.git`, and `.obsidian` are not
scanned.

## Deploying to the vault

This repo is the source of truth; the vault's `.obsidian/plugins/<id>/` folders are deploy targets. Deploy with
[bob-cli](https://github.com/bbugyi200/bob-cli):

```bash
bob plugins list                 # show repo plugins + their vault install/sync state
bob plugins sync                 # copy all six plugins repo -> vault
bob plugins sync -p bob-project-tasks   # sync a single plugin
bob plugins sync --dry-run       # preview without writing
```

`bob plugins sync` copies only `manifest.json`, `main.js`, and `styles.css` (when present). It never touches a plugin's
`data.json` or other runtime/settings files, and it refuses to overwrite vault plugin files that are dirty in the vault's
git repo unless `--force` is passed.

> During the migration the vault keeps its own working copies of these folders; `bob plugins sync` is the deploy path.
> Making this repo the *sole* source of truth (e.g. `git rm --cached` of the folders from the vault) is a deliberate
> later decision.

## Scope

This is a **private personal monorepo** for developing the Bob plugins, not a distribution channel. The Obsidian
community-plugin registry and BRAT both map one plugin id to one repository with one release stream, so a multi-plugin
monorepo is a poor fit for direct official publishing. If a plugin (e.g. `bob-vim-surround` or `block-id-prompt`) is ever
published, it should be split into its own public repo following the standard Obsidian layout (root `manifest.json`,
`README.md`, `LICENSE`, and releases tagged to match the manifest version).

## License

[MIT](./LICENSE)
