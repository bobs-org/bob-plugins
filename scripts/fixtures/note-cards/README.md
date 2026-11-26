# Note-card fixtures (bob-cli-qm kit)

Synthetic notes shaped like the live vault shapes the research report
measured (39 notebooks, one `[[article]]` prose note). Unit and e2e suites
share them; no fixture is read from the live vault.

## Notebooks

- `notebook-zorg.md` — zorg-imported: seven provenance keys, no `created:`.
- `notebook-about-abby.md` — sections plus `created:`.
- `notebook-no-summary.md` — missing `summary:` (the Add-summary ghost).
- `notebook-duplicate-sections.md` — two `##` sections share a title.
- `notebook-parent.md` + `notebook-child.md` — a parent/child pair.
- `notebook-with-checkbox.md` — a task checkbox (a notebook_shape error).
- `notebook-many-sections.md` — nine `##` sections (past the `+N` cutoff).

## Prose notes

- `prose-article-legacy.md` — legacy `[[article]]` spelling, umbrella
  section with TODO subsections, mostly TODO leaves.
- `prose-with-title.md` — `[[prose]]` with `title:` and `summary:`.
- `prose-unnumbered.md` — `section_numbers: false`.
- `prose-invalid-numbering.md` — invalid `section_numbers:` value.
- `prose-dual-spelling.md` — a list holding both spellings.
- `prose-mixed-type.md` — mixed `[prose, area]` (mounts neither new card).
- `prose-no-headings.md` — no headings at all.
- `prose-emoji-title.md` — an emoji-leading title.
- `prose-with-prj.md` — holds a `^prj` anchor (bob refuses it).

## Reports

- `notebook-report.json` — one `bob notebooks list -f json` envelope shaped
  per `docs/notebooks.md` §JSON, covering the zorg, child, and error rows.
