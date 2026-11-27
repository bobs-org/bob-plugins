# Attempt 7 check review

Attempt 7 is NO-GO: 72 of 95 checks passed and 23 failed. Obsidian startup succeeded; the process remained alive and produced all 58 screenshots.

## Failed checks and diagnosis

| Check | Classification | Diagnosis |
|---|---|---|
| `render-empty-album-reading` | Runner timing/fixture | The live view rendered the empty album, but Reading view still had no card after the 5-second settle and used a valid album fixture. This is unresolved pending a repeat with the complete attempt-8 data; classify as runner/product until reproduced. |
| `area-content-parity-gate-closed` | Runner fixture | All three non-album providers were unavailable because the shim only returned Album and Bank config reports. |
| `keys-zero-extra-underscore-details-fallback` | Runner assertion | The check assumed the leaf started collapsed; the initial state is expanded, so verify a state transition instead. |
| `keys-zero-extra-fallback-day/week/quarter/year` | Runner assertion | Period cards have no compact details fold; the generic loop incorrectly tested them. |
| Remaining failed `keys-*` checks | Runner fixture cascade | Cabinets were unavailable, so their actions could not expand or be selected. |
| `fail-open-reading-hides-managed-headings-and-callouts`, `fail-open-heading-navigation-reveals-cabinet`, `fail-open-forced-mount-error-reveals-native-section` | Runner fixture cascade | Missing provider reports prevented valid mounts and suppressed the stored content checks. |
| `fail-open-embed-shows-stored-catalog`, `fail-open-hover-shows-stored-catalog` | Runner fixture | The ordinary note lacked a standalone `[[cash]]` link for the hover target; the embed result also needs confirmation with settled fixtures. |
| `fail-open-print-pdf-shows-stored-catalog` | Needs recheck | The retained check says the Projects callout was not visible under print media; re-evaluate after valid providers restore the catalog baseline. |
| `passive-actions-zero-bob-spawns` | Runner evidence | The detail recorded all background spawns instead of an action-window delta; several unrelated read-only commands were also intentionally unimplemented. |
| `scratch-markdown-unchanged` | Runner interaction | The unsupported printable `x` key used by the modifier/other-key check was inserted into the note. Attempt 8 uses F12. |

The separate visual check found a product layout defect in both bank live narrow captures: the title wraps one character per line and Setup is clipped. Attempt 8 carries a CSS fix for the bank title block at narrow card widths.

## Every report check

| Check | Status |
|---|---|
| `plugins-loaded` | pass |
| `render-area-live` | pass |
| `render-area-reading` | pass |
| `render-project-live` | pass |
| `render-project-reading` | pass |
| `render-leaf-live` | pass |
| `render-leaf-reading` | pass |
| `render-single-area-live` | pass |
| `render-single-area-reading` | pass |
| `render-album-live` | pass |
| `render-album-reading` | pass |
| `render-empty-album-live` | pass |
| `render-empty-album-reading` | fail |
| `render-subscriptions-live` | pass |
| `render-subscriptions-reading` | pass |
| `render-bank-live` | pass |
| `render-bank-reading` | pass |
| `render-prose-live` | pass |
| `render-prose-reading` | pass |
| `render-notebook-live` | pass |
| `render-notebook-reading` | pass |
| `render-record-live` | pass |
| `render-record-reading` | pass |
| `render-ref-live` | pass |
| `render-ref-reading` | pass |
| `render-day-live` | pass |
| `render-day-reading` | pass |
| `render-week-live` | pass |
| `render-week-reading` | pass |
| `render-quarter-live` | pass |
| `render-quarter-reading` | pass |
| `render-year-live` | pass |
| `render-year-reading` | pass |
| `untyped-area-fails-open` | pass |
| `album-records-open-schema-closed` | pass |
| `bank-setup-default-closed` | pass |
| `outline-default-closed` | pass |
| `area-summaries-visible` | pass |
| `project-64-line-summary-and-attention` | pass |
| `gate-closed-inline-baseline` | pass |
| `area-content-parity-gate-closed` | fail |
| `keys-zero-extra-underscore-details-fallback` | fail |
| `keys-zero-extra-fallback-leaf` | pass |
| `keys-zero-extra-fallback-notebook` | pass |
| `keys-zero-extra-fallback-record` | pass |
| `keys-zero-extra-fallback-ref` | pass |
| `keys-zero-extra-fallback-day` | fail |
| `keys-zero-extra-fallback-week` | fail |
| `keys-zero-extra-fallback-quarter` | fail |
| `keys-zero-extra-fallback-year` | fail |
| `keys-one-extra-area-underscore-direct-toggle` | fail |
| `keys-one-extra-underscore-toggles-setup` | pass |
| `keys-multi-extra-underscore-arms` | pass |
| `keys-pick-overlay-after-150ms` | pass |
| `keys-digit-1-toggles-albums-and-disarms` | fail |
| `keys-digit-2-toggles-notebooks-and-disarms` | fail |
| `keys-digit-3-toggles-projects-and-disarms` | fail |
| `keys-digit-4-toggles-areas-and-disarms` | fail |
| `keys-out-of-range-0-stays-armed` | pass |
| `keys-out-of-range-9-stays-armed` | pass |
| `keys-double-underscore-toggles-number-one` | fail |
| `keys-armed-minus-toggles-properties` | pass |
| `keys-cancel-escape` | pass |
| `keys-cancel-q` | pass |
| `keys-cancel-Q` | pass |
| `keys-cancel-ctrl-bracket` | pass |
| `keys-cancel-alt` | pass |
| `keys-cancel-meta` | pass |
| `keys-cancel-ctrl` | pass |
| `keys-cancel-other-key` | pass |
| `keys-fast-underscore-one-no-overlay-flash` | pass |
| `keys-reading-palette-arms-pick` | pass |
| `keys-reading-pick-overlay-lists-numbered-kinds` | pass |
| `keys-reading-palette-number-picks-and-disarms` | fail |
| `keys-hidden-status-bar-uses-fallback-strip` | fail |
| `keys-file-change-disarms` | pass |
| `keys-mode-change-disarms` | pass |
| `keys-window-blur-disarms` | pass |
| `fail-open-reading-hides-managed-headings-and-callouts` | fail |
| `fail-open-source-shows-stored-section` | pass |
| `fail-open-embed-shows-stored-catalog` | fail |
| `fail-open-hover-shows-stored-catalog` | fail |
| `fail-open-heading-navigation-reveals-cabinet` | fail |
| `fail-open-print-pdf-shows-stored-catalog` | fail |
| `fail-open-malformed-ambiguous-region-stays-visible` | pass |
| `fail-open-duplicate-ambiguous-region-stays-visible` | pass |
| `fail-open-forced-mount-error-reveals-native-section` | fail |
| `fail-open-plugin-disable-restores-stored-section` | pass |
| `vim-motions-and-arrows-no-invisible-cursor` | pass |
| `offscreen-toggle-keeps-viewport` | pass |
| `passive-actions-zero-bob-spawns` | fail |
| `passive-actions-zero-markdown-writes` | pass |
| `screenshot-matrix-captured` | pass |
| `no-runtime-exceptions` | pass |
| `scratch-markdown-unchanged` | fail |

The complete assertion details and source head are preserved in the annotated `report.json`.
