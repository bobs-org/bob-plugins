---
title: "Copy Card"
description: "Reference for the Cmd+Y Copy card: keys, task rows, template grammar, and copy.templates."
---

`Cmd+Y` (command `bob-navigation-hotkeys:copy-active-file-path`) opens the
Copy card: a compact, filter-less card where every row copies with one key.
`P` stays the `↵` default. The cursor's task contributes an `I` Block ID
row, and `copy.templates` in `~/.config/bob/config.yml` adds rows such as
`the ^{block_id} task in the {path} file`. Preview and clipboard never disagree,
and copying never writes the vault.

## Keys

| Key | Row | Copies (cursor on `^bank-records` in `bob.md`) |
| --- | --- | --- |
| `P` · `↵` | Path | `~/bob/bob.md` (`~` only at a real home-directory boundary; a vault outside home gets the absolute path) |
| `A` | Absolute path | `/home/alex/bob/bob.md` |
| `F` | File name | `bob.md` |
| `N` | Note name | `bob` |
| `I` | Block ID (task group) | `^bank-records` |
| `key:` or `1`–`9` | Each `copy.templates` entry | `the ^bank-records task in the ~/bob/bob.md file` |

`P A F N I` are reserved even when their row is hidden, so a key never
changes meaning. Letters are case-insensitive. `Shift+letter` is ignored.
Row order is fixed: file rows, then file-only templates, then the `TASK`
group (`I`, then templates that use `{block_id}`). Templates keep the order
they have in `copy.templates`. The highlight starts on Path, or on the
first copyable row when Path is unavailable. `↵` copies the highlighted
row. `↑` / `↓` and `Ctrl+P` / `Ctrl+N` move the highlight among copyable
rows and wrap. A fresh second `Cmd+Y` on the open card copies the
highlighted row (Ctrl+Y on Linux, Cmd+Y on macOS). Other modified chords
are ignored except exact `Ctrl+N` / `Ctrl+P`; `Alt+Escape` does not close.
Pressing the key of a dimmed row moves the highlight there, nudges the
row, and announces the reason instead of copying. Keyboard selection and
refused keys scroll the row nearest into view, and a failed clipboard
write keeps its status visible above an overflowing list.

The palette `yank-*` commands (`yank-absolute-path-tilde`,
`yank-absolute-path`, `yank-basename`, `yank-basename-without-extension`,
plus the kept `yank-parent-directory` and `yank-relative-path`) report the
copied value, and `yank-block-id` (command
`bob-navigation-hotkeys:yank-block-id`, no hotkey) copies `^id` for the
cursor's owning task.

## Which task

The resolver runs once, before the card opens, against the live editor
buffer, not the metadata cache. It uses the active `MarkdownView` only in
an editing mode with one selection; reading view, multiple cursors, or no
editor mean no task. The owner covers the task line, its child notes, and
its Depends-On, BLOCKS, LINKS, and LINKED FROM lines, and skips fences,
including list-nested backtick and tilde fences and a four-space fence
under a child bullet. A cursor inside a fence is no task; it never falls
back to the surrounding parent. A checkbox without `#task` is no task. A
non-empty selection needs equal owners at both ends, or there is no task.
Any checkbox status is accepted. Pomodoro rows are not `#task` lines, so
they have no owner. The same-file invariant holds: a `[[other#^id]]` link
or Task Link under the cursor never supplies the block ID.

The result has three states: `none` (no group), `no-id` (dimmed group with
`none yet · Ctrl+6 on the task line names one`), and `ready` (live group).

## Variables

| Variable | Value |
| --- | --- |
| `{path}` | `~/…` path, or the absolute path outside home |
| `{absolute_path}` | Absolute filesystem path |
| `{file_name}` | `bob.md` |
| `{note_name}` | `bob` |
| `{block_id}` | Bare block ID (`bank-records`, so write `^{block_id}`) |

## Template grammar and errors

`copy.templates` lives in `~/.config/bob/config.yml`:

```yaml
copy:
  templates:
    - label: Task ref # required
      key: t # optional: one letter or digit
      template: "the ^{block_id} task in the {path} file" # always quote templates
```

`{name}` substitutes one variable (`[a-z_]+`). `{{` and `}}` are literal
braces. Values insert in one pass and are never re-scanned. Output is plain
text; newlines stay on the clipboard and preview as `⏎`. Errors appear on
the card, never on the clipboard: unknown variables (with a
`did you mean …?` hint), unbalanced braces (`unmatched { at column N`),
empty or non-string templates (`quote the template`), blank labels
(`add a label`), non-mapping entries (`expected label and template`),
missing values (`needs a block ID`, `needs an absolute vault path`), and
collisions (`key p is Path's`) which stay copyable by `↑↓ ↵` or click.
An explicit `key:` must be one letter or digit after lowercasing, with no
trimming: blank, whitespace, padded, and null keys are invalid. Only an
omitted `key` gets the positional `1`–`9` default. Entries past the ninth
need `key:` or they stay keyless and still show `add key: to bind` without
disabling the row or changing the clipboard payload. A present `copy:` that
is not a mapping — including YAML `null`, `~`, or a blank value — diagnoses
`copy must be a mapping`. A broken `copy` block adds one diagnostic row; the
built-in rows always work.
