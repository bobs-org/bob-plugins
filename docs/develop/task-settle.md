---
title: "Task settle v1"
description: "Frozen bob-ledger-tools.api.taskSettle contract: pure settle, guarded editor apply, and the pending scheduler."
---

The frozen `taskSettle` namespace is version 1 at
`app.plugins.plugins["bob-ledger-tools"]?.api?.taskSettle`. Look it up at
each call. Missing, older, or throwing providers leave the existing gesture
write in place; [task-status-hooks](https://bobs-org.github.io/task-status-hooks/)
is the authoritative status contract. Parent consumer phases own keymap
wiring; publication here does not mean every task-changing keymap already
settles.

```js
const settle = app.plugins.plugins["bob-ledger-tools"]?.api?.taskSettle;
if (settle?.version === 1 && typeof settle.applyToEditor === "function") {
  try {
    const result = settle.applyToEditor(editor, path, options);
    if (result?.applied) return result;
  } catch (_error) {
    // Fall through to the consumer's existing gesture write.
  }
}
return applyExistingGestureWrite();
```

## Methods

```ts
settleNote(request: {
  path: string;
  contents: string;
  today: string;                 // local YYYY-MM-DD, explicit for pure calls
  dailyPath?: string;
  tasksSettings?: object;
}): { contents: string; changed: boolean; lineMap: Record<string, number>; warnings: string[] }

applyToEditor(editor, path: string, options?: {
  expected?: string;             // required preimage for a staged write
  contents?: string;             // staged post-gesture text; omitted means current buffer
  identity?: { blockId?: string; line?: number; text?: string };
  cursor?: { line: number; ch: number };
  selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
  joinHistory?: boolean;
  today?: string;
  dailyPath?: string;
  tasksSettings?: object;
}): {
  contents: string; changed: boolean; applied: boolean;
  lineMap: Record<string, number>; jumpTarget: object | null;
  cursor: { line: number; ch: number } | null; reason: string | null;
  warnings: string[]; historyJoined: boolean | null;
}

schedulePending(request: {
  editor; path: string; identity: { blockId?: string; line?: number; text?: string };
  onSettled?: (delivery: {
    path: string; generation: number; result: object
  }) => void;
}): { scheduled: boolean; reset?: boolean; generation?: number; pending?: number; reason?: string }

flushPending(): Array<{ path: string; generation: number; result: object }>
```

`settleNote` is the no-I/O transform. `today` is explicit in pure calls;
editor and scheduler calls take one local-date and Tasks-settings snapshot at
apply time. The transform applies the local future-schedule Blocked rule,
eligible status groups, and badges. It does not tidy children, unblock tasks,
resolve dependencies, complete requirements, or perform vault-wide or
clock-driven reconciliation.

## Coordinates

All line indexes are zero-based. `ch` is a zero-based UTF-16 column, matching
Obsidian's editor positions. `lineMap` maps surviving input lines to their
output lines after semantic moves; removed lines are omitted. It is a plain
object, so its numeric input keys appear as strings. The optional cursor is in
current-editor coordinates and is mapped into staged contents before the
settle map is applied. Selection positions are in the settle-input
coordinates. The identity is resolved against the staged settle input.

## Identity

Identity is `{blockId, line, text}`. `line` is a zero-based hint, never
identity by itself. A supplied non-empty `blockId` is authoritative: a unique
match wins, and an absent or duplicate ID is unresolved even when fallback
text matches elsewhere or a stale hint still names a live row. A unique ID
still resolves after the row moves. With no block ID, exact `text` at the
hinted line wins, else an unambiguous exact-text match in the same path.
Missing or ambiguous identities drop pending work. Settling never creates a
block ID. Rapid taps rearm with the newest identity snapshot, including
refreshed text.

## Staged apply and preimage

For an already-written gesture, call `applyToEditor(editor, path, { identity })`
to settle the current buffer; that path works without `expected`. For a staged
gesture, pass `expected` as the editor's current preimage and `contents` as
the complete post-gesture buffer; the provider applies gesture plus settle as
one guarded transaction. A missing or mismatched `expected` when `contents`
is supplied returns a non-writing outcome with no cursor, scroll, or history
change. A stale preimage, missing Markdown view, path mismatch, or
unavailable editor also returns a non-writing outcome; the consumer should
then perform its existing gesture write. The provider never switches to
another editor or writes the vault.

## Cursor stay and jump

When the affected task's block moves, the approved stay policy keeps a cursor
inside that task at its physical line (clamped to the document) and returns a
`jumpTarget` for the task's new line. A cursor elsewhere follows its surviving
content through `lineMap`. The provider does not record a navigation jump; the
consumer owns its focus contract and records the returned target once.

## Scheduler

`schedulePending` resets the 500 ms timer when the same task is scheduled
again, using the newest identity snapshot. It retains no document text and
settles the live buffer at fire time. It keeps a short content fingerprint to
decide whether the buffer changed after the last scheduled tap; a changed
buffer disables history joining so later typing is not swallowed into the
gesture's undo event. Work flushes when the cursor leaves the pending task
line, on `active-leaf-change`, `file-open`, editor blur, and before each
Ledger Tools command. `flushPending()` is synchronous. Consumers that read
task positions at command entry must call it first. Two editor instances for
one path are treated as an unsafe shared-buffer conflict and their delayed
writes are dropped. Unload cancels every timer and listener owned by the
provider.

The optional `onSettled` callback is an additive v1 request field, not a new
method or namespace. After a successful apply it runs once with the final
path, generation, and apply result, for the idle timer and for
explicit or lifecycle flushes alike. Rearming a burst replaces it with the
newest gesture's callback. Cancel, a stale identity or path, provider unload,
and shared-buffer conflicts never report a successful movement. Observer
exceptions are caught after the write: they never replay it or change its
result. The callback is an observer, not a second writer; the provider still
owns cursor and scroll mapping. Older v1 providers that ignore the field keep
settling without throwing. Updated ledger-tools supplies this pending-jump
delivery so a consumer can record `jumpTarget` onto navigation `recordJump`
exactly once.

## Undo

Staged apply is one editor transaction and one undo step. For an
already-applied gesture, a consumer can pass `joinHistory: true` only when its
gesture is the preceding editor change. The scheduler makes that request only
when the buffer still matches its last scheduled tap. It reports
`historyJoined: true` only when CM6 `undoDepth()` confirms the settle joined an
existing event, `false` when a separate event is observed, and `null` when
history depth is unavailable. The tested `editor.transaction` fallback is a
separate event: undo settle regrouping first, then undo the original gesture.
Consumers must not assume a join when the result reports `false` or `null`.
The scratch-vault Obsidian check observed that same two-step order through CM6
when `historyJoined` was `false`: undo restores the post-gesture text first,
then the original text; redo reapplies the gesture, then the settle.
