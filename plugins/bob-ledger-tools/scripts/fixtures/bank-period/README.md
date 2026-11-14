# Bank Period Charts JSON fixtures

These captures exercise the real `bob bank report -p … -s -c -f json` contract. They
were generated from a scratch vault with an account tracked since 2026-11-01, the
November bank note, and `BOB_NOW=2026-11-14`, using bob-cli commit `b3dc64a0`.

- `week-2026-W46.json`: current week with counted rows and an unacknowledged row.
- `quarter-2026-Q4.json`: quarter aggregate.
- `iso-year-2026.json`: ISO year with week buckets and quarter groups.
- `all-time.json`: bank-history all-time range.
- `future-week-2026-W48.json`: a future-only range with no bank rows.
