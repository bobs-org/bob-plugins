---
title: "Plugin architecture"
description: "Understand plugin layout, generated JavaScript bundles, and the documentation inventory."
---

This repository is the source tree for ten Bob Obsidian plugins. Each
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

## Prose fields

Text controls declare their role in a `// bob-text: <role> <reason>` comment within
three lines above the creation site. Use `prose S<n>` for a vault-writing Markdown
field that attaches `api.proseField` with its `sourcePath`; use `literal` for identifiers
and filters, `mixed` for shared controls with both kinds of stages, and `none` for
non-text input types. Keep the S1–S15 allowlist and creation/wiring paths in
`scripts/fixtures/prose-fields.json`; `npm test` checks that every control is declared
and each allowlisted surface remains wired. Each surface also declares `subjects`:
`wired` surfaces pass the task or tasks they write to as a `subjects` option, so `((`
shows those rows disabled, and `none` surfaces write no task.

Obsidian runs a modal scope's handlers in registration order, and `Modal` binds Escape
to `onEscapeKey` first, so an input listener never sees a real Escape. A host that
passes `ownKeys` and its `scope` gets a front catch-all from the controller that backs
the band out first. A card that routes keys itself backs out in `onEscapeKey` before
closing.

## Property-card extension API

Bob Ledger Tools keeps the property-card `==` dispatcher open to registered
card editors. Each plugin instance owns its registry. `registerPropertyCard`
accepts `{ kind, match({ path, frontmatter }), open({ path, frontmatter }) }`;
it returns `false` for an invalid or duplicate kind. `unregisterPropertyCard`
removes a kind, and plugin unload clears the registry. The built-ins are kept
in bank → album → record order, with extension kinds after them. Matching
continues until a matcher returns exactly `true`; a thrown matcher is skipped,
so an extension failure leaves the key with Vim. The `==` gate still enforces
the existing normal-mode, Live Preview, and pending-equals checks. The
compatibility helper `schemaDoubleEqualsTargetKind` resolves through this
same registry.

The three panels share `createPropertyCardHost(options)`, which returns a
controller with `setup`, `dispose`, `refresh`, `scheduleRefresh`, Reading
mounting, and CodeMirror extension hooks. An adapter supplies its `plugin`,
`kind`, `readingPriority`, state `fields`, `pathOf`, Reading root/scope and
acceptance functions, `paintReading`/`removeReading`, Live Preview path and
decoration builder, editor cleanup, and `ownKeys`/`releaseKeys`. Optional
hooks cover binding cleanup, refresh effects, timers, workspace events,
embed display eligibility, and adapter setup/disposal. [Validation](validation.md)
describes the acceptance gates; the source comment above
`createPropertyCardHost` lists the full options and their meanings.

`ownKeys(scope, path)` must acquire ownership only after a card mounted
successfully. The host releases that mount's handle when it is replaced,
removed, or fails, and disposal releases every remaining mount. A failed or
throwing builder must leave native Properties available. Shared ownership is
limited to the note's own native Properties in Reading or Live Preview;
Source, embeds, hover popovers, and failed mounts never hide fields.
`allowEmbedDisplay` controls whether an adapter may render its panel in an
embed; it never enables property ownership there.

The rendered panel element carries `.bob-property-card` plus its existing
species class. Editors, bank fence cards, and category cards do not use the
shared class. Common chrome uses `--bob-property-card-accent`; the hue ladder
reads `data-root-hue`, while each species maps its existing accent variable to
that shared value. Adapters retain fallback accent, tint, padding, font-size,
and wrapping through `--bob-property-card-fallback-accent`,
`--bob-property-card-tint`, `--bob-property-card-padding`,
`--bob-property-card-font-size`, and
`--bob-property-card-overflow-wrap`. Keep the album/bank 8% tint, record 4%
tint, record padding, bank font size and wrapping, and the record rail's
radius overrides unchanged.

The intention-card adapter can register a fourth kind with
`registerPropertyCard` and provide its own host adapter. The registry places
it after bank, album, and record; no gate changes or edits to those three
hosts are needed. Core unit entry points are
`scripts/test-ledger-tools-schema-double-equals.cjs`,
`scripts/test-ledger-tools-property-card-ownership.cjs`, and
`scripts/test-ledger-tools-property-card-host.cjs`.

The capture-phase gate splits by key. `=` still uses the pending-`indentAuto`
operator arm, the species registry, and an `<Esc>` injection to cancel the
pending operator. `-` and `+` use bare arms: they act only in Live Preview Vim
normal mode when the event targets the editor's `contentDOM` (or a descendant
that is not an `input`, `textarea`, or `select` and whose closest
`[contenteditable]` is that same `contentDOM`), with no pending operator, no
count, no register, and an empty key buffer. `-` calls
`propertyCardToggleProperties(view)` only when the current view contains a live
foot for its current note. `+` runs the registered Property Editor arm on any
Markdown note. Counts, registers, operator-pending keys (including a pending
`=`), Source mode, insert and visual modes, views without a mounted foot or
registered editor, and focus outside the editor content keep Vim's `-`/`+`
motions. Extensions may register the `+` arm on the Bob Ledger Tools plugin
instance with
`registerPropertyCardSecondKeyArm({ key: "+", canAct(context), run(context) })`;
the method name is historical. It returns `false` for invalid or duplicate
registrations, and `unregisterPropertyCardSecondKeyArm("+")` removes it. The
context carries `plugin`, `view`, `cm`, `path`, `frontmatter`, `entry`, and
`event`. The gate falls through when an arm is absent or cannot act.

The foot kit's editor hook is `propertyCardFootSetEditorHook(handler)`. A
registered handler receives `(path, { key, mode })` from the drawer's
`onOpenEditor` action. It remains unset until the property editor registers;
this API contract does not make `+` available by itself.

Property Editor setting stages share that modal and the guarded props
session. `propertyEditorResolveSettingStage(entry)` is the replacement
seam: it returns `{ ok, stage?, toggle?, message? }` from the handler
registered for `entry.row.settingId`. Simple stages live in
`298x`/`298y` (summary, ready cap, review, capture names, stats-root
toggle, and temporary generic parent/color/type/clock). Hue, default
type, clock-policy, and Lives-under phases replace only their own
handler through `propertyEditorRegisterSettingStageHandler(id, handler)`
and keep this dispatch, the `setting.set`/`setting.clear` ops, and
confirmed-contract adoption. A dry-run `contract` is preview copy only
and never becomes the modal report, overlay, or card cache.

Settings entry points live in `298z`: area and project register through the
existing `registerPropertyCard` lifecycle after the bank/album/record
builtins and the intentions (temporal) extension, with bank precedence and
teardown intact. `openPropertyEditor` accepts `setting` (a setting id, with
`theme`/`offclock`/`offclock_types` aliases mapped through
`propertyEditorSettingIdForKey`) and `focusSettings`; the modal keeps the
request in `requestedSetting`/`focusSettings` and consumes it once in
reconcile (`propertyEditorSettingsConsumeFocus`), selecting the settings row
even for ghosts and the corresponding real property on degraded reports.
`==`, card Settings, and policy chips all route through that request, and
browse `=` inside an area/project editor focuses the settings group instead
of reopening. Project task rows hand off through
`propertyEditorProjectTaskHandoff(modal, line, taskLine)`: it navigates to
the note, validates the exact contract line text against current source,
then calls the navigation-hotkeys Task Card
(`openBulletPropertyPicker(editor, {})`) at that line, falling back to the
cursor when the plugin is unavailable. Later hue/type/clock/parent phases
extend the stage handlers and this entry seam without another modal fork.

The shared foot kit exposes `propertyCardFormatCreatedStamp(input = {})`,
returning `{ text, tooltip, state, dateOnly }`, and
`propertyCardInventory(input = {})`, returning
`{ state, reason, rows, groups, count, issues, recovery }`. The DOM builder is
`propertyCardFootBuildEl(doc, spec = {})`. Session state and subscriptions use
`propertyCardFootIsOpen(path)`, `propertyCardFootToggle(path)`, and
`propertyCardFootOnToggle(listener)`; the mount registry tracks each live foot
per view. `propertyCardToggleProperties(view)` and
`propertyCardCanToggleProperties(view)` implement the guarded `-` action. The
`240r` adapter helpers `propertyCardFootAdapterSpec(options = {})`,
`propertyCardFootAdapterAppend(card, path, doc, spec, handlers, pendingScroll)`,
`propertyCardFootAdapterTrack(container, path, card, tracked)`,
`propertyCardFootAdapterBind(plugin, options = {})`, and
`propertyCardFootAdapterUnbind(plugin, options = {})` share this kit across
card hosts.

### Title block kit

`propertyCardSpecies(kind)` names twelve species: album, record, day, week,
quarter, year, bank, area, project, notebook, prose, and ref. Each has a word,
tile form, fallback icon, and leaf band. Area uses the `field` tile and Project
the `pennant` tile. `propertyCardApplyIdentity` stamps `data-card-kind` and an accessible
name that starts with the species word. `propertyCardBuildGlyphTile`,
`propertyCardBuildTitleBlock`, and `propertyCardBuildRail` return plain DOM
or `null`. Links call the injected `onLink` or `onNavigate`, so adapters
keep modifier keys and jump history. Kit CSS applies only under
`data-card-kind`. Cards that opt in must be block-width, because the card is
the narrow-width container. Days and periods use `--bob-day-accent`, never
an area hue. `propertyCardBuildIdentityBadge(doc, { kind, emoji, icon })`
returns the glyph tile plus the species word for surfaces that name a species
without owning the title: the card editors' modal headers. (The bank card
owned its title in bank-title and no longer uses the badge.) It is never a
heading, and outside a card it falls back to neutral ink.
`propertyCardNoteSpecies` resolves note ownership in Bob's order: bank path,
album, record, Area or Project, day/week/quarter/year, notebook, prose, ref,
then none. Notebook, Prose, and Ref use `props_v1` alone and do not require
`props_contract_v1`. The Prose Card owns only its inline title; body headings
remain visible. Ref, the last species in precedence, registers `==` as an
extension: the Reference editor under `props_ref_contract_v1`, else
focus-or-add on `title`. It hides a matching first H1 like the other
title-owning cards. Notebook and Prose shipped behind the `cardPreviewKinds`
preview gate and Ref behind its own `refCardPreview` gate; both gates and
their keys were deleted at go-live, so stale keys in plugin data are ignored.
The Area and Project hosts own one title and one shared Properties foot when
`props_v1`, `props_contract_v1`, source/cache evidence, and editor routing are confirmed.
They keep the Project's `^prj` line as its editable control. `bank.md` is
excluded from those hosts by path because it is the taskless Bank hub, never
an Area; its one Bank Card uses the `props_v1` gate. The card keys stay `-`
(Properties drawer), `_` (own fold), `==` (species editor), and `+` (generic
Property Editor). See [Area and Project Cards](https://bobs-org.github.io/reference/plugins/area-and-project-cards/).

`propertyCardOwnTitle(scope, { path, recognizer, view })` hides the view's
inline title and the recognized source title range. In Live Preview, one
`StateField` hides it until a selection touches the range. Reading tags only
the matching `h1` and `p` elements. A host registers the field with
`titleOwnership: true`. Ownership is released by the handle, a newer owner,
Source mode, a file change, or host disposal. Title ownership, individual
Properties-row ownership, and whole-frontmatter ownership are independent
bits. The unit entry points are
`scripts/test-ledger-tools-property-card-identity.cjs` and
`scripts/test-ledger-tools-property-card-title-ownership.cjs`.
`scripts/preview-title-block.cjs` renders the preview matrix.

### Frontmatter ownership

Album, record, day/week/quarter/year, and bank adapters use
`propertyCardFrontmatterOwnMounted` to acquire whole-container ownership
only after their card and foot mount. Identity-only temporal cards qualify;
bank ownership applies to `bank.md` by path and requires `props_v1`. Area and
Project ownership uses `props_contract_v1` for the typed home-card contract.
The coordinator checks the current path and mount generation,
desktop Live Preview or Reading scope, a closed valid frontmatter mapping
whose parsed values agree with the cache, confirmed `props_v1` for the
current bob path, and working property-editor/native-command routing.
Duplicate keys, invalid or unclosed YAML, stale cache/source evidence,
detached mounts, and optimistic values without confirmed source fail open.
Source, embeds, hover popovers, canvas, print, mobile, and non-card notes
never acquire whole ownership. A metadata `changed` event re-checks
evidence and releases only mounts whose source no longer matches the new
cache. During Obsidian's post-save re-parse, card painters and the gate
read the last confirmed cache for at most 2 s.

The underlying `propertyCardOwnFrontmatter(scope, { path, view })` adds
`bob-property-card-owns-frontmatter` to the view scope. Live Preview uses
one kit `StateField` plus `editorAttributes`; Reading uses a
generation-bound class. Kit CSS sets Obsidian's
`--metadata-display-editing` / `--metadata-display-reading` to `none` and
hides the exact native paths `propertyCardNativeContainer` uses. The
container stays in the DOM as the title-slot anchor, with `inert` plus
`aria-hidden` and a `focusin` guard that returns focus to the editor.
CSS stays local to owned document scopes; it never hides the File Properties
sidebar. The foot/drawer retains the complete inventory, including loose,
identity, legacy, and managed keys.

The coordinator releases before painting invalid state, on card loss or
failure, source/cache invalidation, unconfirmed capability after a bob-path
change, denied context, navigation, and disable/unload. Source and file
changes release in the same CodeMirror transaction. Generation-bound
handles prevent an older callback from releasing a newer owner, including
two panes of one note. Container observers reapply ownership only while the
same valid mount survives. Reading mounts get a guarded attachment recheck;
title-slot insertion/restoration and header reattachment notify adapters to
recheck the full gate. These checks handle cached detached Reading previews
without polling or relaxing eligibility. Teardown releases all handles,
attributes, listeners, observers, and late callbacks through
`propertyCardFrontmatterReleaseAll()`.

Adapters release only their own mounted kinds with `kind` or `kinds` filters.
Only coordinator path-wide rename/delete handling and newer-owner replacement
release across card species.

Loss of whole ownership restores the preexisting per-row hiding; loss of
the card or entry into a denied context restores native rendering entirely.
Painting reads local metadata and confirmed source, never starts bob, and
never writes vault bytes. Edits still use the existing `bob props` or
species-editor writers. See [native access](https://bobs-org.github.io/reference/plugins/property-editor/#native-properties-and-recovery).

### Capability cache and native entry routing

`298v-plugin-property-capability-routing.js` caches confirmed, absent, and
unconfirmed capability outcomes per plugin session and resolved bob path.
Setup, workspace, and configuration events schedule read-only `props show`
probes against an existing Markdown note, with in-flight deduplication and
bounded transient retries on later events. A missing note waits for a usable
one; no probe comes from paint or build functions. Unknown subcommands or a
successful report without `props_v1` mean absent. Malformed reports and
transient note/I/O failures stay unconfirmed; an incidental per-note failure
does not revoke a confirmed path. Path/lifecycle generation checks discard
obsolete replies, and confirmed results refresh cards.

`propertyCardActualOwnership` queries active ownership for the originating
view/scope and current path, rather than eligibility or a stale CSS class.
The registered **Add file property** command
(`markdown:add-metadata-property`, observed on Obsidian 1.15.1) routes an
owned scope to `openPropertyEditor({ filePath, mode: "add" })`. Default and
custom shortcuts and the palette therefore agree. Untouched scopes retain
the original callback context, arguments, check semantics, and return value.
Unavailable routing prevents acquisition; a failed opener releases ownership
before native fallback. `notebookFocusSummaryProperty` uses the same opener
with `key: "summary"` only for an actually owned scope. Ordinary notebook
focus and File Properties sidebar actions remain native. Unload restores
only Bob's own wrapper, preserving any later wrapper installed by another
plugin.

Focused coverage lives in
`scripts/test-ledger-tools-property-card-frontmatter-ownership.cjs` and
`scripts/test-ledger-tools-property-capability-routing.cjs`. The S1 probe is
`scripts/obsidian-frontmatter-ownership-spike.cjs`; production-adapter
acceptance uses `scripts/obsidian-frontmatter-takeover-e2e.cjs`, each with an
offline wrapper. See [the verified matrix](validation.md#frontmatter-takeover).

### Title slot

`propertyCardMountInTitleSlot(scope, node, { path, kind, view, currentPath,
onLost })` mounts a card in Obsidian's own header slot, after the inline title
and before native Properties. In Live Preview the slot is the
`.cm-editor > .cm-scroller > .cm-sizer` of the note's editor, and in Reading
it is the `.markdown-preview-view > .markdown-preview-sizer > .mod-header`.
`propertyCardTitleSlotFor(scope)` resolves the slot, and only direct children
count. Pass the CodeMirror `EditorView` as `view` in Live Preview and
`previewMode.renderer` in Reading, so that each insertion and resize
re-measures the host.

In Live Preview, each title-slot insertion and measured height change also
queues codemirror-vim's block-cursor redraw. The card sits outside
`.cm-content`, so it can move editor text without changing CodeMirror
geometry; without the redraw, the painted cursor can remain at its previous
screen position. Reading mode does not request this editor redraw.

The mount returns `null` on mobile, in Source mode, in embeds, hover popovers,
canvas nodes, and print, and when the slot is missing or insertion throws.
`null` means the adapter falls back to the body. Otherwise the mount returns a
generation-bound release handle. Calling it twice is harmless, and an old
handle never clears a newer mount. Observers watch only the slot's own child
lists. When Obsidian re-renders the header, they re-insert the card. In
Reading, a header that is virtualized out of view stays parked with its card.

If the slot is lost, `onLost(reason)` fires once. The reason is `denied`,
`path-changed`, `disconnected`, `unstable`, or `insert-failed`. The adapter
then remounts or falls back. Explicit releases never call `onLost`.

In Live Preview, an editor update listener stops CodeMirror from dropping a
scroll target while the card pushes the text below the pane. When a card
above the visible area changes height, the text on screen stays still. Each
Live Preview insertion and resize also queues codemirror-vim's block-cursor
redraw: the title-slot card is outside `.cm-content`, so moving its height can
move the text without a CodeMirror geometry change that would repaint the
cursor. The redraw does not change the selection or create an undo entry.
Plugin teardown calls `propertyCardTitleSlotReleaseAll()`, which leaves no
slot node or observer behind.

Unit tests live in `scripts/test-ledger-tools-property-card-title-slot.cjs`.
`scripts/obsidian-title-slot-spike.cjs` is the real-Obsidian proof, and its
offline wrapper is `scripts/test-obsidian-title-slot-spike.cjs`.

### Adopting the title block

Collection-card adapters do not call the slot and ownership primitives directly.
`propertyCardAdoptTitle(scope, node, { path, kind, view, recognizer,
currentPath, onLost })` mounts the card in the title slot and owns the title.
It returns `{ mode, release }`: mode `"slot"` means the card is (or is about
to be) in the slot, and `"fallback"` means the adapter keeps its body
placement. Reading mounts at once. Live Preview returns `"slot"` at once and
mounts and owns in a microtask, because nothing may touch the DOM or dispatch
inside a CodeMirror update. When a deferred mount fails, `onLost` receives
`insert-failed`, and the adapter's refresh switches to its fallback widget.

When the slot is lost, ownership drops in the same frame, so the inline title
and H1 return at once. The adapter's `onLost(reason)` then runs deferred and
remounts through its refresh. A path that came back `unstable` or
`insert-failed` stays in the fallback until the scope sees a new path or an
explicit `propertyCardAdoptRelease(scope, path?)`. Routine cleanup passes
`{ preserveFallback: true }`, which keeps that memory only while the pane's
`currentPath` still reports the failed path. Plugin teardown calls
`propertyCardAdoptReleaseAll()`. Re-adopting the same node for the same path
never remounts and re-owns only when the recognizer key changes. To update a
mounted card, build a fresh node and pass it to `propertyCardAdoptPatch(target,
fresh)`. That swaps children and attributes in place and keeps the slot's
class and `data-title-slot-*` attributes, so a report body joins inside the
same node.

The kit heading carries `role="heading"` and `aria-level="1"` only while the
card owns the title. Fallback cards and failed ownership demote it, so a pane
never has two level-one headings. `propertyCardReadingViewFor(app, scope)`
and `propertyCardLiveCurrentPath(view)` supply `view` and `currentPath`. The
album card is the first adopter. The record card reuses the glue unchanged
with its own recognizer, which also hides a first-body walk line. Unit tests live in
`scripts/test-ledger-tools-property-card-title-adopt.cjs`.

The shared title range includes trailing blank lines after a recognized title and its
nav or child-link lines. The first unrelated non-blank body line stays outside the
range, so selecting a consumed blank reveals the source without revealing the body.
The day and period controller manages its own render-component lifecycle.

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
