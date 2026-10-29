---
title: "Task relations"
description: "How 🪢 LINKS and LINKED FROM rows render as live chips, and how the Task Card links tasks."
---

A task relates to another task with an entry on its `🪢 **LINKS:**` line. The
reverse `🪢 **LINKED FROM:**` line is generated output: reconcile rebuilds it
from other tasks' LINKS lines, so edit the source side and let the mirror
converge. Relations never block, promote, consume, schedule, stamp, or route
anything. The two status exceptions are both commit-time and both close the
source: an explicit commit with a configured cancel label cancels it, as
described in
[bob's cancel-label contract](https://bobs-org.github.io/task-relations/#17-cancel-labels),
and an explicit commit with a configured complete label (such as
`implemented by`) marks it Done, as described in
[bob's complete-label contract](https://bobs-org.github.io/task-relations/#18-complete-labels).

Both rows render as live chips in Live Preview and Reading view from the
relation index (`api.relationIndex`), never the stored mirror:

- Labels show as muted small-caps pills on the arrow side: `‹label› → (chip)`
  on LINKS, and the inverse phrase (`merged into` reads `merged from`) on
  LINKED FROM, otherwise `(chip) · ‹label› → this`.
- A stored entry that is no longer live is dashed with the tooltip
  `No longer links here · refreshes on the next reconcile`. A live edge
  missing from the text is appended in canonical order. A target that cannot
  be resolved is a dashed `⚠ ^id not found`.
- Three or more closed chips collapse to `✓×N`, which expands on click.
- Closed and archived targets are dimmed and never struck; `#hide` tasks are
  muted. Colour carries status, never direction.
- With nav `api.relations` v1 present, a trailing ＋ opens the Links /
  Linked-from stage and a hover × on each live chip removes the link
  (`Unlink ‹name›` on LINKS, `Remove the link from ‹name›` on LINKED FROM).
  Without it the rows stay navigation-only.
- The shared `toggle-dependency-chips` command covers both rows.

Without this plugin, both lines still read as English.

## Text mentions

A block link inside a task's own text (`[[note#^id]]`, embedded or struck
too) derives an inert `[[S]] (💬 mentions)` entry on the target's LINKED
FROM line, reading "S mentions this". The full contract — vocabulary, M1–M8,
projection, storage and the reserved `💬` label, identity, minting,
lifecycle, uncertainty, inertness, the kill switch, and the visual design —
lives in [bob's task-relations §19](https://bobs-org.github.io/task-relations/#19-text-mentions);
this plugin implements the live side of it.

- The live index (`api.relationIndex` v2) scans task text under M1–M6 from
  the shared MN vectors, resolves targets exactly as relations do, and
  applies M7 precedence: a dependency joining the pair drops the mention
  row, while a LINKS entry for the pair keeps the relation row and marks it
  `alsoMentioned`.
- `incoming()` and `outgoing()` keep returning relations only, so no v1
  consumer can offer a removal it cannot perform. New in v2:
  `linkedFrom(path, blockId)` returns typed rows — `{kind: "relation",
  source, label, alsoMentioned, …}` and `{kind: "mention", source, display:
  "mention"|"embed", count, occurrences: [{line, ch, site, excerpt}]}` —
  and pure `scanMentions(content, path)` returns that note's resolved
  `(S, T)` pairs with their occurrences for nav's courtesy write.
- `labelSuggestions` never includes the reserved `💬 mentions` spelling.
  On LINKS any `💬…` label is malformed; on LINKED FROM exactly `💬 mentions`
  is a typed mention entry and any other `💬…` label is malformed.
- `relations.linked_from_mentions` (default `false` in
  `~/.config/bob/config.yml`) gates everything: when off, no mention rows
  are published and `scanMentions` returns `[]`. Chips for mentions render
  in the next phase; this phase only indexes.

Nav writes and shows mentions once the index is live. When the cursor
leaves an edited line and the note's mention pairs changed, nav converges
each changed target's LINKED FROM the same way reconcile does (M7, minting,
uncertainty, both switches): same-note targets join one annotated
transaction, cross-note targets go through checked follow-ups, and nothing
is ever announced — reconcile heals what the burst misses. A `💬`-first
label is refused everywhere a label can be typed (Links and Linked-from
stages, label management, rename) with `💬 is reserved for text mentions`.
The generated-line notice now reads `🪢 LINKED FROM is generated from other
tasks' LINKS lines and text · change it with Ctrl+Shift+Alt+L`.

In the Linked-from stage, mention rows carry the `💬 mentioned in` /
`💬 embedded in` pill, the quoted excerpt subtitle, and the source note.
`↵` opens the source at the first occurrence; toggling or removing a
mention row is refused with `💬 This comes from a link in ‹S›'s text · edit
it there (↵ opens it)`. Footer hints follow the selected row's kind, and
`⇧↵` on a mention row adds a relation for that source, which replaces the
mention entry by identity. Removing a relation whose source still mentions
the target — `removeLink`, the chip `×`, or Links-to `Ctrl+D` — downgrades
the entry to `(💬 mentions)` instead of deleting it, with
`Unlinked ‹S› · it still mentions this task in its text`. The Task Card's
`Linked from…` count reads `N · ‹first name›` for relations only,
`M 💬 · ‹first name›` for mentions only, and
`N · R relation(s) · M 💬` for both.

## Linking from the Task Card

The Task Card's `Links to…` row (`l`, after `Blocks…`) shows
`N · <first label> <first target> +K` from the owner's LINKS line. Its
`Linked from…` row (`⇧L`) shows the counted source tasks from the live
relation index when ready; its detail stays empty while unavailable. Both
actions work on open and closed tasks. `Ctrl+Shift+L` (command
`bob-navigation-hotkeys:task-card-links`) opens Links to, and
`Ctrl+Shift+Alt+L` (command
`bob-navigation-hotkeys:task-card-linked-from`) opens Linked from. On
either relation line, `Ctrl+Shift+P` opens the owner's matching stage.
On a dedicated Task Link, the L chords open the linked task's matching stage
after focusing its note; read-only linked tasks are refused before focus.
`N<Ctrl+Shift+L>` on Task Links opens the first resolved linked task's Links
stage and reports that it opened the first of N linked tasks. The Task Card's
Links to and Linked from rows on a Task Link use the same focus-and-open path.

The Links stage title reads `🪢 Links · <task>` with the subtitle
`Links to K · searching P tasks · ⇥ to mark several · does not block`.
CURRENT holds the outgoing links with label pills in authored order,
RESULTS holds open tasks, and CLOSED holds closed tasks then `done/`
archives. RESULTS ranks open tasks of every status by match score, so Blocked
`[?]` tasks are never set apart in their own section; exact-score ties put In
Progress and Next first, then Ready and Blocked together. `↵` links (or unlinks on CURRENT), `⇧↵` opens the relation field
(or relabels on CURRENT), `⇥` marks several, and id-less targets run the
block-ID prompt once on apply. Typing `~` anywhere in the Links /
Linked-from filter flips the stage in place, keeping the filter text and
caret while clearing Tab marks; counted sessions refuse the flip to Linked
from with `Linked from needs a single task`. The relation field offers suggestions from
the live index with a live `S — ‹label› → T` sentence; an empty field
commits a plain link. Same-note writes share one undo entry; cross-note
mirrors follow best-effort with a `· 🪢 LINKED FROM not updated` suffix when
they cannot.

Linked from lists incoming sources in CURRENT from `api.relationIndex`, or
from a generation-guarded vault scan while that index is unavailable.
Sources of every task status count, including Next `[*]` and Blocked `[?]`.
Its RESULTS are editable source tasks that can link here; Enter applies or
removes the selected source, and `Shift+Enter` adds or changes the relation
label. `Shift+Enter` labels the selected source's LINKS line, and the
relation field's live sentence reads `‹source› — ‹label› → this`. Built-in
labels use their inverse phrase in CURRENT. `N<Ctrl+Shift+L>`
applies one Links-to target and label to each of N+1 source tasks;
`N<Ctrl+Shift+Alt+L>` is refused because one target cannot be chosen for a
reverse batch. `Ctrl+D` on Links to removes every outgoing relation and
updates generated mirrors; Linked from refuses `Ctrl+D` because its row is
generated. Hand edits to LINKS update LINKED FROM with the same-note undo
transaction or checked cross-note mirrors; `Ctrl+Z` runs the mirror again.
Editing LINKED FROM shows the generated-line notice and does not change an
edge.

When `relations.cancel_labels` is configured, those labels appear in the
relation-label suggestions even before they have been used. They stay in the
zero-use tier and carry `⊘ cancels`; hiding a suggestion does not disable its
effect. Selecting one shows `⊘ {S} — {label} → {T}` with the source dimmed,
names the cancelled source in the consequence strip, and changes Return to
`↵ link & cancel`. A remote source includes its note stem. Recurring-source
rows are disabled with `“{S}” repeats — cancel it with Obsidian Tasks first`.
Typing an inverse phrase shows that it never cancels and points to `⇧L` for
the source direction that does. A counted label commit that cancels two or
more tasks shows `⊘ Cancels {N} tasks — ↵ again to confirm` before writing.

When `relations.complete_labels` is configured, those labels overlay the same
way and carry `✓ completes` (with `used N× · ✓ completes` when the catalog
already has uses). Selecting one shows `✓ {S} — {label} → {T}` with the source
dimmed, names the completed source in the consequence strip
(`✓ Completes “{S}” · unblocks dependents · offers successors`), and changes
Return to `↵ link & complete`. A Cancelled target adds the amber caveat
`“{T}” is Cancelled`. Recurring-source rows are disabled with
`“{S}” repeats — complete it in Obsidian so Tasks writes the next one`; an old
Task Status Cycler disables them with
`Update Task Status Cycler to complete from a link`. Already-closed sources
link only (`Already Done · link only`). Typing `implements` or `verifies`
shows that those labels never complete and points to `⇧L` / `l` with
`implemented by` / `verified by`. A counted label commit that completes two or
more tasks shows `✓ Completes {N} tasks — ↵ again to confirm`; a mixed
cancel-and-complete selection shows
`Closes {N} tasks · ✓ {a} · ⊘ {b} — ↵ again to confirm` and Return reads
`↵ link & close`.

Hand-editing a configured cancel or complete label into LINKS leaves an open
task open and shows a hint to use the Links stage or capture. Unlinking a
cancel-label edge or relabelling it away never reopens a cancelled task; the
stage and result notice say `⊘ Stays Cancelled · reopen with Alt+]`. Unlinking
or relabelling a complete-label edge away never reopens a Done task; the stage
and result notice say `stays Done · reopen with Alt+[`.

In the relation-label stage, row zero is the typed label (or plain link), so
`Tab` accepts the top visible match while `Enter` uses the typed value. Arrow
keys and `Ctrl+N` / `Ctrl+P` move the highlight. `Ctrl+D` on a label row hides
or unhides that label from suggestions and leaves a ghost row for undo; on row
zero it toggles one-off for the next relation. Typing `|` also turns one-off
on. `Ctrl+H` opens or closes the Hidden section. A one-off relation is written
first, then bob hides its label; if that hide fails, the relation remains and
the notice gives the retry command. Hiding changes suggestions only: existing
links and typed use remain unchanged.

`Ctrl+R` on an existing label opens a separate rename mode. The preview lists
the affected notes, LINKS entries, generated mirrors, and `done/` history.
Obsidian saves the active editor before previewing and refuses to continue when
another affected open editor has unsaved text. Apply refreshes the preview and
rechecks open editors; if the plan changed, review the new preview before
confirming again. A merge requires its own confirmation. Bob performs the
one-commit rename, including label spans in `done/`.

The **Bob: Relation labels** command opens a manager for hiding, unhiding, and
renaming labels without starting a link gesture. Hidden labels remain in the
manager, including labels with no current links.

The read-only `api.relationLabels` v1 exposes catalog rows and hidden state on
desktop and mobile. Its desktop `hide`, `unhide`, and `rename` methods delegate
writes to `bob relations`; `rename(from, to, { dryRun, merge, via })` returns
Bob's preview report for dry runs and refreshes the journal mirror after a
successful write.

## Related

- [BLOCKS dependency mirrors](blocks-mirrors.md) — the reverse-dependency
  precedent for generated mirror rows.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — relation stages and
  gestures.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) —
  dependency storage and behavior.
- [Task relations](https://bobs-org.github.io/task-relations/) — relation
  storage and behavior.
