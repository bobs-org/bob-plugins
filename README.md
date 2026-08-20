# bob-plugins

Source-of-truth monorepo for Bryan's custom [Obsidian](https://obsidian.md) plugins, used in the **Bob** vault.

These six plugins used to live only inside the vault under `~/bob/.obsidian/plugins/<id>/`, mixed in with third-party
community plugins and personal notes. This repo extracts the Bryan-authored plugins into one place so they can be
versioned, validated, and reviewed independently of the vault. The plugins are deployed back into the vault with
[`bob plugins sync`](#deploying-to-the-vault).

## Plugins

| Plugin                  | id                       | Version | Description                                                            |
| ----------------------- | ------------------------ | ------: | --------------------------------------------------------------------- |
| Block ID Prompt         | `block-id-prompt`        |  1.10.0 | Prompt for custom block IDs, complete wiki block links to open tasks (skipping `#hide` tasks and listing Blocked `[?]` tasks in a separate group beneath unblocked tasks), prune duplicate links from future open Pomodoros, mark dependency-blocked tasks, and — when a `^^` task-picker link is the sole content of an open Pomodoro sub-bullet — pull a uniquely future-scheduled target into today by removing its `scheduled` date, promoting Blocked/Ready to Next, and prepending a dated entry to an existing Schedule Log (never creating one for a task that keeps none); `Ctrl+Shift+Enter` toggles the open task under the cursor (including a `#hide` task): Ready and Blocked tasks link to today's current/next Pomodoro, prompt for a block ID first if needed, become Next, and apply the same future-schedule/Schedule Log pull-forward as the `^^` flow, Next tasks become Open and are removed from today's current/future open Pomodoros without changing closed history, and In Progress tasks open an optional work-summary prompt that sets them Open, removes current/future Pomodoro links when a unique block ID is available, and records nonblank summaries as locally dated entries such as `*2026-08-15* — Added coverage` under a managed `🛠️ **WORK LOG**` child bullet. |
| Bob Ledger Tools        | `bob-ledger-tools`       |   1.2.0 | Expand Bob daily-note snippets and ledger time ranges, and navigate and adjust Pomodoro entries. |
| Bob Navigation Hotkeys  | `bob-navigation-hotkeys` |  1.27.0 | Open and manage related notes and tabs, including pinned-tab-preserving sibling closes; `Ctrl+Shift+J/K` navigates Ready, In Progress, and Next `#task` lines while skipping Blocked `[?]` tasks; project schedules propagate to task-level `scheduled` properties and Blocked status, `Ctrl+Shift+P` edits scheduled, dependency, and priority task properties with priority levels that roll scheduled dates, report the exact rolled ISO date/span and its distance from today, and offer date-picker re-roll suggestions, prompts for an optional reason after a `scheduled` date is chosen and records it as a nested entry under a `🗓️ **SCHEDULE LOG**` child bullet — an empty reason on a task that already keeps a log records `🤷 no reason given` rather than nothing, while a task with no log yet is left untouched — while choosing a priority level or the pinned roll suggestion instead writes immediately with its own deterministic reason that records the exact chosen relative day and configured priority window, giving a task a strictly future `scheduled` date also removes its live links from today's open Pomodoro entries, `N<Ctrl+Shift+P>` edits the current task plus the next N real tasks with independent schedule-log roll choices, bare `Ctrl+Shift+M` moves the current task and focuses the destination note on the moved task, `N<Ctrl+Shift+M>` moves it plus the next N movable tasks and focuses the destination note on the first of them, `!` synchronizes visible task dependencies while marking parents Blocked for open targets, and `Ctrl+Shift+Alt+N` creates a project note from a task whose checkbox-less, ALL-CAPS direct child bullets with their own sub-bullets (e.g. `REQUIREMENTS`, `FUTURE WORK`) become title-cased `##` sections — reusing a matching existing header case-insensitively or appending a new one at the end of the note — with their descendants copied in verbatim as notes rather than converted into `#task` lines, while a source task's managed schedule log moves under the new project's `^prj` task, and the same hotkey on a project note's `^prj` task converts that note back into a parent-task block in the parent's `## Tasks` section — carrying tasks, uppercased section bullets, and the `^prj` subtree back as children, repointing `#^prj` links, and trashing the note. |
| Bob Project Tasks       | `bob-project-tasks`      |   1.0.0 | Keep project task counts materialized in frontmatter.                 |
| Bob Vim Surround        | `bob-vim-surround`       |   1.5.2 | Add vim-surround `ys` motions, `cs` changes, `ds` deletes, and dot-repeat to Obsidian Vim mode. |
| Task Status Cycler      | `task-status-cycler`     |  1.11.0 | Complete Pomodoros (carrying worked-on links above deferred `#`-marked links, each in source order), toggle empty Pomodoro placeholders/sub-bullets with `Ctrl+Alt+]`, toggle an Obsidian task to or from a normal bullet with `<Ctrl+Shift+]>` / `<Ctrl+}>` — routing promotions into `## Tasks`, prompting for an existing or new destination when demoting from `Tasks` (blank Enter defaults to `Requirements`), and routing other demotions into the next Markdown section — cycle a Blocked `[?]` task to Ready/Cancelled with `<option+]>`/`<option+[>` — retiring its own uniquely future `scheduled` date and prepending a `🔓 unblocked by hand` entry to an existing Schedule Log without ever creating one — recover affected Blocked dependents, preserve embedded-task behavior, and propagate `Ctrl+Enter` on a task line wrapping an embedded block transclusion to close/reopen the transcluded source task too (retirement still only touches indented references). |

Versions are tracked **per plugin** — there is no lockstep release. Each plugin's authoritative version lives in its own
`plugins/<id>/manifest.json` (e.g. `bob-navigation-hotkeys` is ahead of the others at `1.27.0`).

Bob Ledger Tools expands editor snippets with Tab or the **Expand Bob snippet** command.
Date calculation uses local calendar days: `d[-]<N>` (e.g. `d0` -> `2026-08-16`, `d1` ->
`2026-08-17`, `d-1` -> `2026-08-15`) expands to the bare ISO date, while `D[-]<N>` (e.g.
`D0` -> `_2026-08-16_ — `, `D1` -> `_2026-08-17_ — `, `D-1` -> `_2026-08-15_ — `)
expands to the emphasized local date, an em dash, a trailing space, and places the cursor
immediately after that trailing space.

Bob Vim Surround accepts every visible, single-UTF-16-code-unit letter, number,
punctuation character, or symbol as a surround key. The standard bracket aliases
retain vim-surround padding behavior; all other accepted characters are symmetric
delimiters. Whitespace, controls and navigation keys, modifier chords, composition
and dead keys, combining marks, and multi-code-unit characters such as emoji are
not accepted. Symmetric delimiters are discovered as sequential pairs of maximal
same-line runs around the cursor, and paired runs must have equal lengths. Delimiter
runs inside the content can therefore make pairs ambiguous; this intentionally does
not attempt nested parsing. `cs` replaces both complete matched runs with the
requested pair, while each `ds` removes one delimiter from each side.

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
    task-status-cycler/{manifest.json,main.js,styles.css}
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
- **`styles.css`** — optional plugin CSS (currently `block-id-prompt`, `bob-navigation-hotkeys`, and `task-status-cycler` ship one).

### Validation

```bash
npm test
npm run validate
```

`npm test` runs the focused pure-helper coverage for Bob Navigation Hotkeys,
including scheduled-project task extraction, frontmatter handoff, date
boundaries, project-property target resolution, scheduled task-visibility
reconciliation, due/deleted inline-schedule recovery, current/previous
Pomodoro rank snapshots, guarded counted writes, deletion behavior,
child-picker presentation metadata, the tab-pin Vim mapping, and
pinned-tab-preserving sibling closes. It also
guards the distinct Vim mapping ownership: Bob
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
