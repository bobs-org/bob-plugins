---
title: "Go to task URI"
description: "Open a note and land the caret near a task with a read-only Obsidian URI."
---

Bob Navigation Hotkeys registers the read-only `obsidian://bob-goto-task`
handler. Bob Mac Capture uses it for its Go To picker and its Control-\ landing
on today's Pomodoro. The target may be any line, including a Pomodoro entry;
it need not be a `#task` line. The handler does not write block IDs,
stamps, lanes, ledger rows, or review state, and it does not open the Task Card
or complete a task.

## URI v1

```text
obsidian://bob-goto-task?path=<absolute>&line=<1-based>&ref=<LINE:digest>[&block=<id>]
```

| Parameter | Rule |
| --- | --- |
| `path` | Required absolute filesystem path of the note. |
| `line` | Required positive, 1-based integer. |
| `ref` | Optional for hand-typed links; when present, match `^[1-9][0-9]*:[0-9a-f]{8}$`. |
| `block` | Optional; match `^[A-Za-z0-9-]+$`. |
| Other parameters | Ignored; reserved for the future `pane=tab` option. |

Values use RFC 3986 percent encoding. Unreserved characters and `/`
stay literal. Encode other bytes, including spaces, `+`,
`&`, `=`, `#`, `%`, and `:`.

## Re-finding the line

After mapping the path into the vault, the handler reads the open editor
buffer if the note is already open; otherwise it reads Obsidian's cached
text. It tries these locations in order:

1. The planned line (`line − 1`) when it is in range and its digest
   matches `ref`.
2. The task line carrying `^block`, when `block` is supplied.
3. The only task line whose digest matches `ref`.
4. The planned line clamped to the file, with a notice that the note changed.

Without `ref`, steps 1 and 3 are skipped. A clamped landing
without `ref` shows no notice. If multiple lines have the digest,
step 3 does not apply.

The caret lands at column 0, the line is centered, and the editor receives
focus. If a Markdown editor was active, the handler records a `<C-o>`
jump from that cursor. It reuses a leaf already showing the note and switches
a Reading-view leaf to editing before landing.

| Notice | When |
| --- | --- |
| `Bob Go To: invalid task link` | A required or optional parameter is missing or malformed. |
| `Bob Go To: <path> is outside this vault` | The absolute path does not map inside the vault. |
| `Bob Go To: <vault path> not found` | The mapped path is missing or is not Markdown. |
| `Bob Go To: could not open <name>` | Obsidian could not open the note. |
| `Task changed since search — landed near line N` | Re-finding fell back to a clamped line when `ref` was supplied. |

URI activation is a manual GUI check. For a synthetic vault note on a Mac:

```bash
open 'obsidian://bob-goto-task?path=%2Fvault%2Fprojects%2Fsample.md&line=42&ref=42%3A35a733bd'
```

## Related

- [Open notes URI](open-notes-uri.md) — open a batch of notes.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the URI handler's plugin.
