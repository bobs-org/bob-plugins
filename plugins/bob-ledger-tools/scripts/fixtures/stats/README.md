# Stats browser-preview fixtures

`canonical.json` is the schema-1 `bob stats show` report captured from bob-cli's
`tests/fixtures/stats/homes_vault`, with an isolated config and a pinned clock. It is
real golden-vault output with derived area/project parts and session facts. Regenerate
it from the bob-cli checkout that owns that fixture;
set `BOB_PLUGINS_CHECKOUT` to the path printed by `sase repo open bob-plugins`:

```sh
cd /path/to/bob-cli
BOB_CONFIG_FILE=/dev/null \
BOB_DIR="$PWD/tests/fixtures/stats/homes_vault" \
BOB_NOW='2026-10-18 12:00:00' \
cargo run --locked --quiet -- stats show -a -f json -r 4w \
  > "$BOB_PLUGINS_CHECKOUT/plugins/bob-ledger-tools/scripts/fixtures/stats/canonical.json"
```

The captured report has `schema_version: 1`. `canonical.meta.json` pins its fixture
version, bob-cli version/revision, clock, and requested range; its source is the
committed golden vault. The renderer is `bob-ledger-tools@1.88.0`. The canonical
golden has no off-clock adoption evidence, so it also checks the new renderer's
clockless compatibility path. `synthetic-clocks.json` contains consistent
Worked, Off-clock, and Total reports plus empty Off-clock, pre-adoption
`not_tracked`, count-Total, and pinned `family_time` cases;
`stats-clock-fixtures.cjs` is the reusable constructor for later Stats
rendering tests.

The `synthetic-*.json` files are explicitly synthetic **presentation** fixtures. They
cover week/month groups, signed values, populated rolling medians and prior ticks, long
theme/chore names, grouped daily drill-down, and empty/all-null states. Except for
`synthetic-clocks.json`, synthetic report values and summaries are intentionally not
internally consistent and must never be treated as tests of Stats metric semantics. The
`synthetic-homes.json` fixture adds the long `job_2026_apply_29` stem, many area hues,
an all-bucket split, and expandable project groups. `synthetic-lanes.json` is a
presentation-only 4W-shaped report for the Stats window bars: about 13 roots
including `@unlinked` and `@unfiled`, and about 22 themes with
config, pin, exempt, unconfigured, and `(unnamed)` hues plus long hour
displays. These synthetic fixtures must never be treated as vault results.
`synthetic-clocks.json` is the internally consistent exception: its Worked,
Off-clock, and Total reports keep every point and part split aligned, and their
summary totals exclude the provisional day. Extra keys (`emptyOffClock`,
`adoptionGap`, `countTotal`, `pinnedOffClock`) reuse that constructor for
empty-window, adoption-gap, count, and pinned-metric preview cases.

Generate the standalone browser page and screenshot matrix from the linked bob-plugins
checkout with:

```sh
npm run build
node scripts/preview-stats-block.cjs --out /tmp/bob-stats-preview
```

The preview script embeds the built `main.js`, `styles.css`, and these fixtures in a
self-contained HTML file. It discovers an installed headless Chromium and keeps its
screenshots and `matrix-report.md` under the chosen output directory. The preview is
dev-only and is not included in `npm test` or `npm run validate`.

`day-strip-fixtures.cjs` exports synthetic presentation reports for the Day strip:
today in progress, a past day, no Pomodoros, all-unlinked time, not-tracked and missing
points, seven areas, an old-bob report without `root_parent`, same-area roots get distinct hues, grey-slot
(`hue_source: muted`) gtd roots that stay gray, seven
roots with `+N`, a redefined `worked`, long labels (with a long `job_2026_apply_29`
root), wide values (`10h 05m`, three-digit counts, `not yet`), a week-grouped daily
series, a canonical-shaped default `4w` report, an explicit eight-day `-g day`
report, and off-clock hint cases (supplied display, raw numeric fallback, zero, and redefined worked). Every report carries `root_parent` parts, displays, and catalog entries
except `areaOnly` (the old-bob fallback) and `redefinedWorked`. These
reports exist only to exercise the view and are not captured vault data or tests of
`bob stats` calculations.

`period-parts-fixtures.cjs` builds presentation examples for the current and closed
quarter, the 53-week year, and all time. The period strip preview renders each at narrow
and wide widths in light and dark themes; the narrow year checks the quarter fallback.
These are UI fixtures, not period totals from a vault.
