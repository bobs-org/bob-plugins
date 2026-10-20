---
title: "Open notes URI"
description: "Open a bounded batch of notes and optionally land the caret with a read-only URI."
---

Bob Navigation Hotkeys registers the read-only `obsidian://bob-open-notes`
handler for a batch of notes. It processes entries serially and never writes
the vault.

An already open note is reused in any window, including a background tab
Obsidian has not loaded yet. Main-area tabs take precedence over sidebar tabs.
If the first entry is not open and the active leaf is empty, it opens there.
Otherwise, the handler appends a new tab at the far right of the active tab
group. Entry 1 is primary; secondary notes open in the background, and the
primary tab ends active. A supplied line receives a caret at column 0 and a
brief accent highlight. The handler waits up to two seconds for Bob's writes
to appear in Obsidian.

## URI v1

```text
obsidian://bob-open-notes?count=<1..8>&path1=<absolute>[&line1=<n>][&ref1=<LINE:digest>][&block1=<id>]…[&total=<n>]
```

| Parameter | Rule |
| --- | --- |
| `count` | Required integer from 1 through 8. |
| `pathK` | Required for every entry; absolute filesystem path. |
| `lineK` | Optional positive, 1-based line. |
| `refK` | Optional only with `lineK`; match `^[1-9][0-9]*:[0-9a-f]{8}$`. |
| `blockK` | Optional; match `^[A-Za-z0-9-]+$`. |
| `total` | Optional original note count, at least `count`; used when the client truncates to eight entries. |
| Other parameters | Ignored. |

Indexed keys avoid relying on how Obsidian handles repeated query keys.
Values use RFC 3986 encoding: unreserved characters and `/` stay
literal; encode other bytes, including `+`, `&`,
`=`, `#`, `%`, `:`, and spaces.

## Re-finding lines and failures

For each entry, the handler maps the absolute path into the vault and waits
for the file to resolve. When `ref` is present, it reads the open
editor buffer or Obsidian's cached text, then re-finds the line by planned
position, optional block ID, and unique line digest. If the digest is not
visible by the shared two-second deadline, it opens near the clamped planned
line and shows a changed-capture notice.

A missing path or a path outside the vault fails independently; the other
entries continue.

| Notice | When |
| --- | --- |
| `Bob Open: invalid link` | A required or optional URI parameter is malformed. |
| `Bob Open: <path> is outside this vault` | The absolute path does not map inside the vault. |
| `Bob Open: <vault path> not found` | The path did not resolve to a file by the deadline. |
| `Bob Open: could not open <name>` | Obsidian could not open a resolved file. |
| `Bob Open: opened N of M notes` | `total` was supplied because the client truncated a longer list. |
| `Task changed since capture — landed near line N` | A line digest was not visible by the deadline. |

URI activation is a manual GUI check. For synthetic notes on a Mac:

```bash
open 'obsidian://bob-open-notes?count=2&path1=%2Fvault%2Fprojects%2Fsample.md&line1=42&ref1=42%3A35a733bd&path2=%2Fvault%2Fdaily%2Fsample.md&line2=18'
```

## Related

- [Go to task URI](goto-task-uri.md) — open one note and land on a line.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the URI handler's plugin.
