---
title: "Block ID defaults"
description: "Learn how Bob suggests a missing task block ID and handles collisions."
---

When a prompt needs to assign a missing block ID, it starts with a selected,
valid suggestion derived from the task headline. The suggestion is collision
aware, so it can be accepted immediately or replaced by typing.

| Task text | Suggested ID |
| --- | --- |
| `Fix flaky sync test` | `fix-flaky-sync` |
| `Add support for new %hold directive` | `hold` |
| `Review [[project-notes#^fix-apollo|apollo fix]] notes` | `apollo-fix` |
| `Réparer café` | `reparer-cafe` |

Press Enter to accept the suggestion. Typing replaces it; cancelling does
not write. An explicit rename prompt keeps the task's current ID as its
starting value.

The `＋ id` dependency prompt reuses a valid, unused `[id::]`
value such as `flights`. A path-qualified value such as
`Tasks__target` is not reused; the prompt generates an ID from the
task text instead.

If the suggested stem is already in use, Bob tries `stem-2`,
`stem-3`, and so on, including after `stem-9`. IDs stay
within 32 characters; for example, `book-flights-10` remains
available after the first nine candidates collide.

## Related

- [Block ID Prompt](block-id-prompt.md) — task linking, ID assignment, and guards.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the Depends-On line that the dependency prompt edits.
