---
title: "Open in Highlights"
description: "Open a reading task or highlight at its page without changing the vault or reading state."
---

In source or Live Preview mode, `Cmd+Enter` opens the source of whatever the
cursor is on. One rule covers the old cases and the new ones:

- A `#task #ref` reading task, or a Task Link / managed embed pointing at
  one, opens the PDF; Highlights resumes where you left off.
- A line with a `[[…#^h-…|🔖]]` bookmark (task or bullet, any note,
  including `done/`) opens the PDF at that highlight's page.
- A Task Link pointing at a 🔖 task opens that highlight's page.
- Inside a managed `^h-` annotation block in a ref note (`ref/` or
  `ref_history/`) the command opens the PDF at that block's (or piece's)
  page. A cursor on a page caption heading (`### Page 12`) opens that page.
- A tombstone (`Removed highlight`) explains; nothing launches.
- Anything else (section cards, outside the region, ordinary links) keeps
  Obsidian's **Open link under cursor in new tab** behavior.

The column never matters. A link inside a quote does not change the target.
Opening is read-only for the vault and for task, lane, freshness, and
review state. A missing, unsafe, or unsynced PDF produces a notice.
Highlights is macOS-only; on other systems the command reports that
limitation.

The command shows a single Highlights card before opening. It includes the
reference title, page receipt when known, and a short quote or context line.
Archived references show their replacement date. If the page handoff is
unavailable or the launch fails, the card updates with the result; Hammerspoon
confirms a successful page landing separately.

## Page behavior

The resolver follows bookmark hops, Task Link hops, and managed-block
stubs (at most 3 hops, cycle-checked). A dangling same-note bookmark falls
back to the unique `h-…` block id across `ref/` and `ref_history/`; zero or
several matches report `Can't find highlight h-…`, and an unresolvable stub
reports `Can't follow highlight h-…`. A tombstone reports
`This highlight was removed in Highlights — no page to open`.

A `ref/…` note opens its `source_pdf`. A `ref_history/…` archive opens its
`annotated_pdf` wikilink (resolved with `getFirstLinkpathDest`, falling back
to the normalized literal) and never falls back to the live PDF. Any other
note holding the block is an error naming the note.

The plugin opens the exact path (`open -b net.highlightsapp.universal`),
then sends `hammerspoon://bob-highlights-page?path=<encodeURIComponent>`
`&page=<N>` with `open -g`. `N` is 1–999999, 1-based and physical. The
Hammerspoon handler never opens files; it acts only on the document already
in front, so a missing handler never stops the PDF from opening. Reading
tasks send no page request. A failed page request reports
`Opened <title> — jumping to p. N needs Hammerspoon`. A double press never
sends two page requests (re-entry lock, 400 ms).

`api.openReferencePdf(path, { page })` passes `page` through when it is a
positive integer; the api `version` is unchanged. The Reading Board needs no
change.

The `Meta+Enter` binding for
`bob-navigation-hotkeys:open-reference-pdf-in-highlights` is custom
vault configuration in `.obsidian/hotkeys.json`, not a registered
plugin default. That custom binding runs before Obsidian's built-in
`Mod+Enter`; delegation preserves the built-in action for other
targets. Do not re-record it in Obsidian Settings on a Mac: Obsidian may save
`Mod`, which would claim `Ctrl+Enter` on other platforms.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation and keyboard layers.
- [Bob Ledger Tools](bob-ledger-tools.md) — the Reading Board's optional PDF handoff.
- [Reference notes](https://bobs-org.github.io/ref/) — the managed reference-note model.
