// --- Task block layout twin (RL), part 2: edits, tidy, NOTES filing ---------
// Twin of bob-cli `src/native/task_block_layout/{edit,tidy}.rs`: the
// line-preserving edit helpers, `plan_tidy`, the first-req scoop, and filing
// into `NOTES`. Every edit works on physical lines with their own endings, so
// a mixed LF/CRLF note keeps the endings of every line it does not touch and
// a note without a final newline keeps that state. Plugin-agnostic and copied
// byte for byte; update bob-cli first, then this file, then its copies.
// Reads the RQ twin and `task-block-layout-twin.js`.

// --- Line-preserving edits (`edit.rs`) --------------------------------------

// The physical lines of a note, each with its own ending.
function taskBlockPhysicalLines(contents) {
  const text = String(contents);
  const lines = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push(text.slice(start, end));
    start = end;
  }
  return lines;
}

// `line` with a line ending, adding `ending` when it has none.
function taskBlockWithEnding(line, ending) {
  return line.endsWith("\n") ? line : `${line}${ending}`;
}

// A physical line's text without its ending.
function taskBlockBare(line) {
  let text = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (text.endsWith("\r")) text = text.slice(0, -1);
  return text;
}

// Undo a final newline an edit added to a note that had none.
function taskBlockRestoreFinalNewline(original, updated) {
  if (original === "" || original.endsWith("\n")) return updated;
  if (updated.endsWith("\r\n")) return updated.slice(0, -2);
  if (updated.endsWith("\n")) return updated.slice(0, -1);
  return updated;
}

// Replace a physical line's leading `oldIndent` with `newIndent`. Blank
// lines and lines shallower than `oldIndent` stay as they are.
function taskBlockRebaseIndent(line, oldIndent, newIndent) {
  if (taskReqIsBlank(taskBlockBare(line)) || taskReqIndentLength(line) < oldIndent.length) return line;
  return `${newIndent}${line.slice(oldIndent.length)}`;
}

// Insert whole physical lines at `offset` (a line start or the end of the
// note). A note without a final newline gains one first, so lines never join.
function taskBlockInsertLines(contents, offset, lines) {
  const ending = taskBlockDocumentLineEnding(contents);
  let text = offset > 0 && contents[offset - 1] !== "\n" ? ending : "";
  for (const line of lines) text += taskBlockWithEnding(line, ending);
  return `${contents.slice(0, offset)}${text}${contents.slice(offset)}`;
}

// Cut inclusive 0-based line ranges (sorted, non-overlapping) out of a note:
// `{remaining, pulled: [{lines, indent}]}` with each cut line keeping its
// own ending and `indent` the first cut line's spaces and tabs.
function taskBlockPullRanges(contents, ranges) {
  const physical = taskBlockPhysicalLines(contents);
  let remaining = "";
  const pulled = [];
  let next = 0;
  for (const [start, end] of ranges) {
    remaining += physical.slice(next, start).join("");
    const cut = physical.slice(start, end + 1);
    pulled.push({ lines: cut, indent: cut[0].slice(0, taskReqIndentLength(cut[0])) });
    next = end + 1;
  }
  remaining += physical.slice(next).join("");
  return { remaining, pulled };
}

// The pulled lines re-indented under `newIndent`.
function taskBlockRebased(pulled, newIndent) {
  return pulled.lines.map((line) => taskBlockRebaseIndent(line, pulled.indent, newIndent));
}

// --- Tidy (`tidy.rs`) ------------------------------------------------------

function taskBlockLongestIncreasingRun(values) {
  const best = values.map(() => 1);
  let longest = 0;
  for (let index = 0; index < values.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (values[earlier] < values[index]) best[index] = Math.max(best[index], best[earlier] + 1);
    }
    longest = Math.max(longest, best[index]);
  }
  return longest;
}

// Reorder the children into canonical order: `{updated, moves}` or null
// when already canonical. `moves` counts whole subtrees off the longest
// increasing run.
function taskBlockReorder(contents, task, options) {
  const doc = taskReqDocument(contents);
  const block = taskBlockReadIn(doc, task, options.globalFilter);
  const order = taskBlockDesiredOrder(block);
  if (order.every((index, slot) => index === slot)) return null;
  if (!block.children.length) return null;
  const position = new Array(order.length).fill(0);
  order.forEach((index, slot) => {
    position[index] = slot;
  });
  const moves = order.length - taskBlockLongestIncreasingRun(position);
  const physical = taskBlockPhysicalLines(contents);
  const ending = taskBlockDocumentLineEnding(contents);
  let out = physical.slice(0, block.children[0].lineIndex).join("");
  for (const index of order) {
    const child = block.children[index];
    for (const line of physical.slice(child.lineIndex, child.endIndex + 1)) out += taskBlockWithEnding(line, ending);
  }
  out += physical.slice(block.lastLineIndex + 1).join("");
  return { updated: out, moves };
}

// `tidy::file_into_notes`: append pulled ranges to the end of the task's
// `NOTES` entries (before the drawer's own managed logs), creating `NOTES`
// first among the drawers when the task has none. On a `^prj` owner the home
// is the note's `## Notes` section: bullets land at column zero, each pulled
// line dedented by the task's child indent unit. `{updated, created,
// firstLine}` (0-based line of the first filed line) or null.
function taskBlockFileIntoNotes(contents, taskLine, pulled, options) {
  const resolved = taskReqOptions(options);
  const task = taskBlockFindTask(contents, taskLine, resolved);
  if (!task) return null;
  const project = taskBlockIsPrjParent(contents, task);
  const existing = taskBlockNotesDrawer(contents, task);
  let staged = String(contents);
  let drawer = existing || null;
  let created = false;
  if (!drawer) {
    const ensured = taskBlockEnsureNotesDrawer(contents, task);
    if (!ensured) return null;
    staged = ensured.updated;
    drawer = ensured.drawer;
    created = ensured.created;
  }
  if (project) {
    const insertion = taskBlockH2InsertPosition(staged, drawer);
    const entries = [];
    for (const range of pulled) entries.push(...taskBlockRebased(range, ""));
    if (insertion.empty) entries.unshift("");
    const before = staged.slice(0, insertion.offset);
    const firstLine = (before.match(/\n/g) || []).length
      + (before !== "" && !before.endsWith("\n") ? 1 : 0)
      + (insertion.empty ? 1 : 0);
    return { updated: taskBlockInsertLines(staged, insertion.offset, entries), created, firstLine };
  }
  const insertion = taskBlockDrawerInsertion(staged, drawer);
  const entries = [];
  for (const range of pulled) entries.push(...taskBlockRebased(range, insertion.indentation));
  const before = staged.slice(0, insertion.offset);
  const firstLine = (before.match(/\n/g) || []).length + (before !== "" && !before.endsWith("\n") ? 1 : 0);
  return { updated: taskBlockInsertLines(staged, insertion.offset, entries), created, firstLine };
}

// `tidy::scoop_loose_notes` (the first-req scoop): file every loose direct
// note of the task at `taskLine` into `NOTES`. Only the task's own notes
// move, never notes attached to reqs, and nested `#task` subtasks stay put.
// `{updated, filed, created}` or null when nothing moves.
function taskBlockScoopLooseNotes(contents, taskLine, options) {
  const resolved = taskReqOptions(options);
  const task = taskBlockFindTask(contents, taskLine, resolved);
  if (!task) return null;
  const doc = taskReqDocument(contents);
  const block = taskBlockReadIn(doc, task, resolved.globalFilter);
  const ranges = block.children
    .filter((child) => taskBlockIsLooseNote(child))
    .map((child) => [child.lineIndex, taskBlockContentEnd(doc, child)]);
  if (!ranges.length) return null;
  const { remaining, pulled } = taskBlockPullRanges(contents, ranges);
  const filed = taskBlockFileIntoNotes(remaining, taskLine, pulled, resolved);
  if (!filed) return null;
  return { updated: filed.updated, filed: pulled.length, created: filed.created };
}

// `tidy::plan_tidy`: the canonical order for one open task block, moving
// whole subtrees into their zones and, for a req owner, filing loose notes
// into `NOTES`. Returns `{updated, moves, notesFiled, notesCreated}`, or
// null when the block is canonical or the task is not open (history is
// never rewritten). Apply one task at a time and rescan.
function taskBlockPlanTidy(contents, task, options) {
  if (!task || !task.open) return null;
  const resolved = taskReqOptions(options);
  const original = String(contents);
  let updated = original;
  let notesFiled = 0;
  let notesCreated = false;
  const block = taskBlockRead(original, task, resolved);
  if (taskBlockOwnsReqs(block)) {
    const scoop = taskBlockScoopLooseNotes(updated, task.lineIndex, resolved);
    if (scoop) {
      notesFiled = scoop.filed;
      notesCreated = scoop.created;
      updated = scoop.updated;
    }
  }
  const refreshed = taskBlockFindTask(updated, task.lineIndex, resolved);
  if (!refreshed) return null;
  let moves = 0;
  const reordered = taskBlockReorder(updated, refreshed, resolved);
  if (reordered) {
    updated = reordered.updated;
    moves = reordered.moves;
  }
  updated = taskBlockRestoreFinalNewline(original, updated);
  return updated !== original ? { updated, moves, notesFiled, notesCreated } : null;
}
