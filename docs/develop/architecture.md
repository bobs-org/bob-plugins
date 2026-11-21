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
and each allowlisted surface remains wired.

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

### Title block kit

`propertyCardSpecies(kind)` names seven species: album, record, day, week,
quarter, year, and bank. Each has a word, tile form, fallback icon, and leaf
band. `propertyCardApplyIdentity` stamps `data-card-kind` and an accessible
name that starts with the species word. `propertyCardBuildGlyphTile`,
`propertyCardBuildTitleBlock`, and `propertyCardBuildRail` return plain DOM
or `null`. Links call the injected `onLink` or `onNavigate`, so adapters
keep modifier keys and jump history. Kit CSS applies only under
`data-card-kind`. Cards that opt in must be block-width, because the card is
the narrow-width container. Days and periods use `--bob-day-accent`, never
an area hue. `propertyCardBuildIdentityBadge(doc, { kind, emoji, icon })`
returns the glyph tile plus the species word for surfaces that name a species
without owning the title: the bank card's head row and the card editors'
modal headers. It is never a heading, and outside a card it falls back to
neutral ink.

`propertyCardOwnTitle(scope, { path, recognizer, view })` hides the view's
inline title and the recognized source title range. In Live Preview, one
`StateField` hides it until a selection touches the range. Reading tags only
the matching `h1` and `p` elements. A host registers the field with
`titleOwnership: true`. Ownership is released by the handle, a newer owner,
Source mode, a file change, or host disposal. Title ownership is separate
from Properties row ownership. The unit entry points are
`scripts/test-ledger-tools-property-card-identity.cjs` and
`scripts/test-ledger-tools-property-card-title-ownership.cjs`.
`scripts/preview-title-block.cjs` renders the preview matrix.

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
above the visible area changes height, the text on screen stays still.
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
