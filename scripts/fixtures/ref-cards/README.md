# Ref-card fixtures (bob-cli-qp ref-kit)

Synthetic notes shaped like the live vault shapes the research report
measured (1,377 indexed references; statuses, kinds, and populated row
fields per the plan). Unit and e2e suites share them; no fixture is read
from the live vault.

- `ref-finished-blog.md` — annotated finished blog (author, published,
  `source_url`, audio, created, matching H1, managed embed).
- `ref-next-chat.md` — open Next chat report with `agent:` and a priority.
- `ref-blocked-chat.md` — blocked chat report (local dependency).
- `ref-blocked-paper.md` — scheduled-blocked paper.
- `ref-arxiv-paper.md` — arXiv paper with identity.
- `ref-reread-v1.md` + `ref-reread-v2.md` — reread pair (`x`, `x__v2`).
- `ref-earlier-replaced.md` — `earlier` replaced capture.
- `ref-v1-tracker.md` — v1 tracker.
- `ref-legacy-book.md` — legacy zorg book (provenance keys, `legacy_status`).
- `ref-legacy-ai.md` — legacy url-only `ai` ref.
- `ref-title-mismatch.md` — H1 differs from `title:` (stays visible).
- `ref-no-title.md` — no `title:` (stem fallback).
- `ref-missing-pdf.md` — declared-but-missing PDF.
- `ref-meeting.md` — meeting ref.
- Non-claims: `sase_ref.md` (root hub), `ref-mixed-type.md`
  (`[ref, project]`), `ref-sample.assets/note.md`, `ref_history/old-capture.md`.

## Reports

- `ref-list.json` — one trimmed `bob ref list -A -R all -f json` envelope
  shaped per the plan, covering the finished, Next, blocked, arXiv, and
  legacy rows.
