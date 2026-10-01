# bob-plugins

Source-of-truth monorepo for Bryan's custom [Obsidian](https://obsidian.md) plugins, used in the **Bob** vault.

These six plugins used to live only inside the vault under `~/bob/.obsidian/plugins/<id>/`, mixed in with third-party
community plugins and personal notes. This repo extracts the Bryan-authored plugins into one place so they can be
versioned, validated, and reviewed independently of the vault. The plugins are deployed back into the vault with
[`bob plugins sync`](#deploying-to-the-vault).

## Plugins

| Plugin                  | id                       | Version | Description                                                            |
| ----------------------- | ------------------------ | ------: | --------------------------------------------------------------------- |
| Block ID Prompt         | `block-id-prompt`        |  1.17.0 | Prompt for custom block IDs, complete wiki block links to open tasks (skipping `#hide` tasks and listing Blocked `[?]` tasks in a separate group beneath unblocked tasks), prune duplicate links from future open Pomodoros, mark dependency-blocked tasks, and — when a `^^` task-picker link is the sole content of an open Pomodoro sub-bullet — pull a uniquely future-scheduled target into today by removing its `scheduled` date, promoting Blocked/Ready to Next, and prepending a dated entry to an existing Schedule Log (never creating one for a task that keeps none); `Ctrl+Shift+Enter` toggles the open task under the cursor (including a `#hide` task) on link presence: an unlinked task links to today's current/next Pomodoro — prompting for a block ID first if needed — with Ready and Blocked becoming Next, Next and In Progress staying unchanged, and the same future-schedule/Schedule Log pull-forward as the `^^` flow; a linked task unlinks, removing its links under today's open Pomodoros without changing closed history and never writing the checkbox, and unlinking an In Progress task first opens an optional work-summary prompt titled `Unlink task` that records nonblank summaries as locally dated entries such as `*2026-08-15* — Added coverage` under a tab-indented managed `🛠️ **WORK LOG**` child bullet.; `Ctrl+Shift+Enter` on a selected Task Link (a plain or embedded wiki block link to a task, including 🍅-marked, `#` move-only, and struck `~~[[…]]~~` forms; one link per line is selected from anywhere on the line, several by cursor) deletes the link (the whole bullet and its children when the link is the bullet's only content) and today's other open-Pomodoro duplicates without ever changing the lane: Next, In Progress, Ready, and Blocked all stay as they are, with an In Progress target going through the same optional `Unlink task` Work Log prompt. Closed targets and sub-task dependency transclusions are refused. Link, unlink, and Task Link Notices append the live plan budget (`· plan T/3 · L/10`, with 🔴 when over the cap) from bob-ledger-tools. `Ctrl+Shift+Enter` and `^^` stamp the target task's freshness (`[fresh:: today]`) through bob-ledger-tools when they rewrite its line. |
| Bob Ledger Tools        | `bob-ledger-tools`       |  1.15.0 | Expand Bob daily-note snippets and ledger time ranges, navigate and adjust Pomodoro entries, render the live plan-budget `bob-plan` block (TODAY/PENDING/NEXT/READY chips, themes, lints), track task freshness (freshness-gated READY, NEW/ROTTEN review models and chips, review queue, counts, lints, status bar), render dashboard PENDING/NEXT section badges as section/cap that agree with their Tasks sections (whole-lane pressure in the tooltip), and render `[fresh::]` stamps as compact freshness marks with a versioned `api` (`caps`, `planBudget`, `todayKeys`, `isToday`, `todayRank`, `nextBudget`, `pendingBudget`, `dashboardLaneBudget`, `renderDashboardLaneBadge`, `readyBudget`, `renderReadyBadge`, `renderReviewChip`, `freshness` namespace v3, `noteReady` namespace v1) for the dash and the other plugins. |
| Bob Navigation Hotkeys  | `bob-navigation-hotkeys` |  1.49.0 | Open and manage related notes and tabs, including pinned-tab-preserving sibling closes; `Ctrl+Shift+J/K` navigates Ready, In Progress, and Next `#task` lines while skipping Blocked `[?]` tasks, except that on an open current or future Pomodoro entry the same chord instead moves that Pomodoro and everything it owns down/up among adjacent future Pomodoros, keeping the current slot's time range with whichever entry is promoted there and refusing (with a notice, without jumping) to cross the current/history boundary or the last future Pomodoro; `N<Ctrl+Shift+J/K>` moves a current/future Pomodoro exactly N positions atomically or jumps to the Nth circular navigation target elsewhere; project schedules propagate to task-level `scheduled` properties and Blocked status, `Ctrl+Shift+P` edits scheduled, dependency, and priority task properties with priority levels that roll scheduled dates, report the exact rolled ISO date/span and its distance from today, and offer date-picker re-roll suggestions, prompts for an optional reason after a `scheduled` date is chosen and records it as a nested entry under a `🗓️ **SCHEDULE LOG**` child bullet — an empty reason on a task that already keeps a log records `🤷 no reason given` rather than nothing, while a task with no log yet is left untouched — while choosing a priority level or the pinned roll suggestion instead writes immediately with its own deterministic reason that records the exact chosen relative day and configured priority window, giving a task a strictly future `scheduled` date also removes its live links from today's open Pomodoro entries, `N<Ctrl+Shift+P>` edits the current task plus the next N real tasks with independent schedule-log roll choices; on a dedicated Task Link bullet the same bare or counted keymap instead edits the linked task in its own note (hiding the `dependsOn` row), covering the link plus the next N sibling links and clamping at the Pomodoro end, with future-date picks marking the targets Blocked and pruning their links from today's open Pomodoros, bare `Ctrl+Shift+M` moves the current task and focuses the destination note on the moved task, `N<Ctrl+Shift+M>` moves it plus the next N movable tasks and focuses the destination note on the first of them, while the same bare or counted keymap on a Pomodoro sub-bullet instead moves that bullet plus the next N siblings, each carrying its descendants, into another open Pomodoro in the same note or into a new `- [ ] () — NAME` Pomodoro created directly below the current one from a typed, uppercased, em-dash-stripped picker name; typing `=` creates a fresh destination with the source Pomodoro's normalized name when the source is named, typing `=NAME` peels every matching `NAME` component from a merged source into a new placeholder containing the selected bullet subtrees while the source keeps the remaining name or becomes unnamed when no components remain, and unnamed sources or names that are not part of the source require typing a new name instead; exact duplicate destination bullets merge away, moving out a source's last owned content deletes that Pomodoro entry instead of leaving it behind, and nested `#task` lines under Pomodoro entries route to the Pomodoro move; the same keymap on a Pomodoro **entry** line itself instead opens a picker where Enter on another open Pomodoro keeps the existing whole-entry move/delete behavior, typing a name that is not an existing open Pomodoro's name renames the entry in place without moving or creating anything, and Ctrl+X on a highlighted open current/future Pomodoro merges entries in one undoable edit: a current timed entry survives and absorbs the selected future one, otherwise the highlighted entry survives, survivor bullets stay first, absorbed bullets append without duplicate suppression, names combine survivor-first with ` + ` up to the 48-character limit, and invalid or over-length names are refused without changing the note; any count is accepted but ignored since the operation is whole-entry; bare and counted `!` are captured directly in Vim normal mode to synchronize visible task dependencies while marking parents Blocked for open targets, and `Ctrl+Shift+Alt+N` creates a project note from a task whose checkbox-less, ALL-CAPS direct child bullets with their own sub-bullets (e.g. `REQUIREMENTS`, `FUTURE WORK`) become title-cased `##` sections — reusing a matching existing header case-insensitively or appending a new one at the end of the note — with their descendants copied in verbatim as notes rather than converted into `#task` lines, while a source task's managed schedule and work logs, in source order, move under the new project's `^prj` task, and promoting a task with real project tasks expands each live dedicated Pomodoro Task Link to the source (today/future open entries) into one sibling link per new project task in document order — preserving embed, 🍅 markers, checkbox, move-only `#`, and the first link's subtree, dropping the old alias — while history, past dates, struck/closed links, prose, fenced examples, Markdown links, and zero-task projects still rewrite one-to-one to `^prj` (e.g. `[[Work_ship#^ship]]` becomes `[[Work_ship#^design]]` + `[[Work_ship#^test]]` live and `[[Work_ship#^prj]]` in history), and the same hotkey on a project note's `^prj` task converts that note back into a parent-task block in the parent's `## Tasks` section — carrying tasks, uppercased section bullets, and the `^prj` subtree back as children, repointing `#^prj` links, and trashing the note; Alt+N commits Ready to Next or releases Next/In Progress to Ready on the current task plus the next N tasks (or the linked task plus the next N sibling Task Links, clamped at the Pomodoro end), unlinking released tasks from today and reporting the NEXT/PENDING counts with the weekly-review hint when over the cap, with the same lane toggle as a pinned lane row in the Ctrl+Shift+P picker that asks for an optional Work Log summary when releasing In Progress; a pinned Cancel row closes the task as Cancelled with an optional reason kept in a first-child ❌ **CANCEL LOG**, pruning its links from today's open Pomodoros; `Ctrl+Alt+J/K` jumps to the next/previous task due for freshness review vault-wide from bob-ledger-tools' review queue (wrapping with a notice), `Alt+F` stamps the cursor task — or a dedicated Task Link's target — plus the next N tasks when counted through `api.freshness.stampLine` and nothing else, and `Alt+Shift+F` stamps then advances to the next due task; all four require ledger-tools api v3; `Alt+N`, the `Ctrl+Shift+P` priority/scheduled/dependsOn/delete-property/lane rows, `Ctrl+Shift+M` moves, and the `!` dependency toggle stamp every rewritten open task through `api.freshness.stampLine`, and a pinned refresh row sets or clears `[refresh:: N]` through `api.freshness.setRefreshLine` (which also stamps); `Ctrl+Enter` on `scheduled` takes the previewed recommended roll, decay, or cancel from the decay ladder, including one composed batch write for counted and Task Link sessions. |
| Bob Project Tasks       | `bob-project-tasks`      |   1.0.0 | Keep project task counts materialized in frontmatter.                 |
| Bob Vim Surround        | `bob-vim-surround`       |   1.5.2 | Add vim-surround `ys` motions, `cs` changes, `ds` deletes, and dot-repeat to Obsidian Vim mode. |
| Task Status Cycler      | `task-status-cycler`     |  1.19.0 | Complete Pomodoros (carrying worked-on links above deferred `#`-marked links, each in source order, copying a closed named Pomodoro's name onto the Pomodoro that completion creates, and copying each Task Link sub-bullet's sub-sub-bullets as locally dated entries such as `*2026-08-26* — Read \`research.15\`!` into that link's task, under a tab-indented managed `🛠️ **WORK LOG**` child bullet created when the task has none), toggle empty Pomodoro placeholders/sub-bullets with `Ctrl+Alt+]` including named empty placeholders, toggle an Obsidian task to or from a normal bullet with `<Ctrl+Shift+]>` / `<Ctrl+}>` — routing every eligible plain-bullet promotion in a note with exact `Tasks` through a section picker (blank Enter chooses `Tasks` and converts once to checkbox/`#task`/`created`, including in-place conversion when the bullet is already in that `Tasks` section; existing or typed non-`Tasks` destinations keep the bullet plain and create a bottom-level `##` heading when the title is novel; emptied non-`Tasks` source sections are removed), prompting for an existing or new destination when demoting from `Tasks` (blank Enter chooses the first real destination when sections exist and creates `## Requirements` only for a Tasks-only note), and routing other demotions into the next Markdown section — cycle a Blocked `[?]` task to Ready/Cancelled with `<option+]>`/`<option+[>` — retiring its own uniquely future `scheduled` date and prepending a `🔓 unblocked by hand` entry to an existing Schedule Log without ever creating one — recover affected Blocked dependents, preserve embedded-task behavior, and propagate `Ctrl+Enter` on a task line wrapping an embedded block transclusion to close/reopen the transcluded source task too (retirement still only touches indented references). `Ctrl+Enter` on a selected Task Link, embedded or plain and including inside an open Pomodoro, closes the linked task and strikes the link through as `~~[[…]]~~`, and pressing it again reopens both. Plain links close root-only, embedded links close their transcluded tree, and only links that do not resolve to a task fall back to completing the Pomodoro; Ctrl+Enter on a Task Link to a Cancelled task instead shows a notice and leaves the Pomodoro open, Blocked dependents with a strictly future `scheduled` date stay Blocked, and a versioned `api.recoverBlockedDependents` lets other plugins recover Blocked dependents without retiring references. `Alt+[`/`Alt+]` cycling to an open status (including leaving Blocked, counted lines, and transcluded targets) and `Ctrl+Enter` reopening stamp the task's freshness (`[fresh:: today]`) through bob-ledger-tools. |

Versions are tracked **per plugin** — there is no lockstep release. Each plugin's authoritative version lives in its own
`plugins/<id>/manifest.json` (e.g. `bob-navigation-hotkeys` is ahead of the others at `1.41.0`).

Bob Ledger Tools expands editor snippets with Tab or the **Expand Bob snippet** command.
Date calculation uses local calendar days: `d[-]<N>` (e.g. `d0` -> `2026-08-16`, `d1` ->
`2026-08-17`, `d-1` -> `2026-08-15`) expands to the bare ISO date, while `D[-]<N>` (e.g.
`D0` -> `_2026-08-16_ — `, `D1` -> `_2026-08-17_ — `, `D-1` -> `_2026-08-15_ — `)
expands to the emphasized local date, an em dash, a trailing space, and places the cursor
immediately after that trailing space. One isolated `-` immediately before the cursor
(e.g. `left-right` with the cursor after the hyphen) expands exactly that hyphen to an
em dash followed by a trailing space (`— `, U+2014 U+0020), producing `left— right` and
placing the cursor right after the inserted space. Existing suffix whitespace is left
alone, so `- suffix` becomes `—  suffix`. `--`, `---`, and longer adjacent-hyphen runs
are left untouched so Markdown thematic breaks, YAML frontmatter delimiters, and other
multi-hyphen text keep Obsidian's normal Tab behavior.

Bob Ledger Tools also renders a live ` ```bob-plan ` block: a `TODAY 3/3 · 7/10` chip (the theme/link budget, whose tooltip lists each theme
with its link count), `PENDING n/10`, `NEXT n/15`, and `READY n/100` chips that open the matching `dash` sections, the
`★ GOALS · DECKS · BOB` theme line with the highlight starred, and one muted line per lint. READY is the shared live
current backlog (Today excluded, `dash#READY Tasks` destination, red only when over its soft `max_ready` cap) and never
changes the PLAN status. READY over its cap adds a `ready_cap_exceeded` lint line. Today is read from the
ledger at render time (the open tasks with a dedicated Task Link under today's open Pomodoros, per `docs/plan.md`
in bob-cli) and kept in a synchronous cache that rebuilds on layout ready, on daily-note change/create/delete/rename,
and at local-midnight rollover; when the key set changes, every open Tasks query re-reads via the
`obsidian-tasks-plugin:reload-open-search-results` event. Caps come from the `plan:` block in
`~/.config/bob/config.yml` (`max_next`, `max_pending`, `max_ready`, `max_ready_per_note`; a legacy `max_now` loads without error) with built-in
defaults when the file, the block, or a value is missing or invalid; the block re-renders live when the daily note
or the Tasks cache changes and shows `–` placeholders, never an error, when there is no daily note, no Pomodoros
section, or no Tasks plugin. Its supported interface for the dash and the other plugins (which never import one
another's `main.js`) is `app.plugins.plugins["bob-ledger-tools"].api`: `{ version: 3, caps(), planBudget({path?,
content?}), todayKeys(), isToday(task), todayRank(task), nextBudget(), pendingBudget(), dashboardLaneBudget(lane), renderDashboardLaneBadge(parent, {lane?, sourcePath?, component?}), readyBudget(), renderReadyBadge(parent, {sourcePath?, component?}), renderReviewChip(parent, {kind?, sourcePath?, component?}), freshness, noteReady }`, where
`freshness` is `{ version: 3, config(), stampLine(line, dateText?), setRefreshLine(line, days, dateText?),
state(task), bucket(task), reviewModel(), isDue(task), tier(task), rank(task), intervalFor(task), queue(), counts(), lints() }` computed from
`[fresh:: YYYY-MM-DD]` / `[refresh:: N]` per `docs/freshness.md` in bob-cli (config from the `freshness:` block,
note overrides from `task_refresh` frontmatter). READY counts gate on the read-time bucket (NEW and ROTTEN review
stay out of READY); `reviewModel()` shares the NEW/ROTTEN counts, meter, tooltip, and severity behind both chips.
Every `freshness` member is synchronous and never throws. `noteReady` is `{ version: 1, snapshot(now?), forNote(path), counted(task), inCrowdedNote(task), groupLabel(task) }`,
the read-only per-note Ready cap (`docs/plan.md`, "Ready cap per note" in bob-cli): each area/project note's
Ready lane against `plan.max_ready_per_note` (default 5) with per-note `ready_cap` overrides, crowded/full/room
states, freshness make-up, and lints, memoized in one O(tasks) pass with live invalidation. Every `noteReady`
member is synchronous and never throws.
Placement is the exception to the copy-small-helpers rule: nav, task-status-cycler, and block-id-prompt call
`api?.freshness?.stampLine?.(line, dateText) ?? line` (api `version >= 3`) instead of placing `fresh` themselves.
The plugin also shows a desktop status bar counter (`⟳ N new · N rotten · ✓ N today`, `⟳ –` without Tasks) that
clicks through to nav's next-due-task jump, falling back to `rotten`.

The freshness mark renders each canonical `[fresh:: YYYY-MM-DD]` stamp as a compact mark (`✓ today`, a draining lease ring with its age, `⟳ Nd` when due) in Live Preview and rendered views (reading view, Tasks query results, embeds, hover previews). Resolution is exact or neutral: an exact memo match or unanimous consensus drives the tone, otherwise the mark shows only the neutral lease and never a guessed due. Leftover Dataview pills in Live Preview are non-canonical stamps flagged for repair, and the "Toggle task freshness marks" command (session only, default on) restores the old pills. The mark is display-only: nothing writes it and the `freshness` api is unchanged.
`planBudget({content})` budgets post-write text synchronously (handy for Notices); without `content` it reads the
target note and returns a Promise. `isToday` uses the task's path plus its Tasks `blockLink` (` ^id`) and returns
`false` before the first cache build or when fields are missing; `todayRank` is the ledger index or
`Number.MAX_SAFE_INTEGER`. `readyBudget()` is synchronous and guarded, returning `{ count, cap, over }` with
`count: null` (and `over: false`) when Tasks data, a non-`Warm` cache, the initial Today build, or the evaluation is
unavailable; `renderReadyBadge(parent, { sourcePath, component })` renders the shared READY badge (daily and dash use
the same element, classes, fraction, tooltip, and `dash#READY Tasks` destination; each host styles it in its own chip
style: two-tone label/value on the dash, single-tone inside the daily `bob-plan` block) with lifecycle-owned live updates.
`dashboardLaneBudget(lane)` is the additive dashboard contract (`pending` uses `IN_PROGRESS`, `next` uses symbol `*`):
it returns `{ section, lane, cap, over, today }` with `section`/`lane` null when unavailable (never a silent zero)
while no-argument `pendingBudget()`/`nextBudget()` keep whole-lane semantics for non-dashboard callers;
`renderDashboardLaneBadge(parent, { lane, sourcePath, component })` renders the section count over the whole-lane cap (`PENDING 49/10`, red when the whole lane exceeds the cap) with whole-lane
pressure (`49 in this section; whole lane 50/10; 1 in TODAY`) in the tooltip and lifecycle-owned live updates.

Task Status Cycler exposes a versioned cross-plugin surface the same way (plugins never import one another's `main.js`): `app.plugins.plugins["task-status-cycler"].api` is `{ version: 1, recoverBlockedDependents(identities, context?) }`. Each identity is `{ path, blockId, taskId }` with at least one of `blockId`/`taskId`; it runs the same Blocked-dependent recovery Ctrl+Enter uses — including the strictly-future-`scheduled` guard — without retiring references, and resolves to `{ reopened, failures }` without ever throwing.

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
    bob-ledger-tools/{manifest.json,main.js,styles.css}
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
Pomodoro rank snapshots, named-Pomodoro parsing, Pomodoro bullet-move
and named-component peel/split planner coverage, Pomodoro entry move/rename/merge planner coverage,
Ctrl+X Pomodoro entry picker coverage,
guarded counted writes, deletion behavior,
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
