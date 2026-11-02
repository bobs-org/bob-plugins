# Event buffer vectors

`vectors.json` was copied byte-for-byte from bob-cli commit
`2e49a561d08777b6ee8a130202f1bd0621670ef4`, at
`tests/fixtures/event_buffer/vectors.json`. bob-cli is the source of truth;
this plugin consumes the `row` and `conflict` sections. The `description`
section is Google HTML directive-line parsing and lives in bob-cli.

Three sections:

- `description`: raw Google description (including HTML) → `route`,
  `untracked`, `before`, `after`.
- `row`: vault Event Task line → `buffer`, buffered span, clean `title`,
  canonical `field`, and human `label`.
- `conflict`: session `new`/`old` spans plus a day's Events → crossed
  block id, `overlap_minutes`, `buffer_part`, and `fit`.

The vectors use only description strings and hand-written Event Tasks;
no Google Calendar account or generated sync state is needed.
