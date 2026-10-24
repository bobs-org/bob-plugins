// Line-level diff for whole-note editor writes. A write that changes the line
// count used to replace the whole document, which CodeMirror maps to the top of
// the file (cursor and scroll anchor both land at offset 0). Aligning old and
// new lines lets the write touch only the lines that changed, so the cursor and
// viewport stay where they were.

// Past this many edits the middle of a diff stops aligning and becomes one
// unaligned gap; that is still far smaller than a whole-document replacement.
const EDITOR_LINE_DIFF_MAX_EDITS = 2000;

// A line's identity for alignment only: it drops the edits the dependency
// writers make to a task line (Dataview inline fields, the trailing block id,
// the checkbox status character), so a stamped or relinked task still lines up
// with its old self. The key is never written anywhere.
function editorLineAlignmentKey(line) {
  let key = String(line === null || line === undefined ? "" : line);
  key = key.replace(/\s*\[[A-Za-z][\w-]*::[^\]]*\]/g, "").replace(/\s+$/, "");
  key = key.replace(/\s+\^[A-Za-z0-9-]+$/, "");
  return key.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[^\]](\])/, "$1 $2");
}

// Myers' greedy O((N+M)·D) diff over line keys. Returns the matched
// `[oldIndex, newIndex]` pairs, or null when more than `maxEdits` edits are
// needed (the caller then treats the range as one unaligned gap).
function editorLineMyersPairs(oldKeys, newKeys, maxEdits) {
  const oldCount = oldKeys.length;
  const newCount = newKeys.length;
  if (oldCount === 0 || newCount === 0) {
    return [];
  }
  const limit = Math.min(oldCount + newCount, maxEdits);
  const mid = limit + 1;
  const furthest = new Array(2 * limit + 3).fill(0);
  // snapshots[d][k + d] is the furthest x on diagonal k after d edits.
  const snapshots = [];
  let edits = -1;
  for (let d = 0; d <= limit && edits < 0; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && furthest[mid + k - 1] < furthest[mid + k + 1])) {
        x = furthest[mid + k + 1];
      } else {
        x = furthest[mid + k - 1] + 1;
      }
      let y = x - k;
      while (x < oldCount && y < newCount && oldKeys[x] === newKeys[y]) {
        x += 1;
        y += 1;
      }
      furthest[mid + k] = x;
      if (x >= oldCount && y >= newCount) {
        edits = d;
      }
    }
    snapshots.push(furthest.slice(mid - d, mid + d + 1));
  }
  if (edits < 0) {
    return null;
  }

  const pairs = [];
  let x = oldCount;
  let y = newCount;
  for (let d = edits; d > 0; d -= 1) {
    const previous = snapshots[d - 1];
    const k = x - y;
    const previousK =
      k === -d || (k !== d && previous[k - 1 + d - 1] < previous[k + 1 + d - 1])
        ? k + 1
        : k - 1;
    const previousX = previous[previousK + d - 1];
    const previousY = previousX - previousK;
    // The edit step moves one line, then a diagonal snake follows it.
    const snakeX = previousK === k + 1 ? previousX : previousX + 1;
    while (x > snakeX) {
      x -= 1;
      y -= 1;
      pairs.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0) {
    x -= 1;
    y -= 1;
    pairs.push([x, y]);
  }
  return pairs.reverse();
}

// Strictly increasing `[oldIndex, newIndex]` pairs of key-equal lines. The
// common raw prefix and suffix pair off first; Myers aligns the middle.
function alignEditorLines(oldLines, newLines) {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const shared = Math.min(oldCount, newCount);
  let prefix = 0;
  while (prefix < shared && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shared - prefix &&
    oldLines[oldCount - 1 - suffix] === newLines[newCount - 1 - suffix]
  ) {
    suffix += 1;
  }

  const pairs = [];
  for (let index = 0; index < prefix; index += 1) {
    pairs.push([index, index]);
  }
  const oldKeys = oldLines.slice(prefix, oldCount - suffix).map(editorLineAlignmentKey);
  const newKeys = newLines.slice(prefix, newCount - suffix).map(editorLineAlignmentKey);
  const middle = editorLineMyersPairs(oldKeys, newKeys, EDITOR_LINE_DIFF_MAX_EDITS);
  for (const [oldIndex, newIndex] of middle || []) {
    pairs.push([prefix + oldIndex, prefix + newIndex]);
  }
  for (let index = suffix; index > 0; index -= 1) {
    pairs.push([oldCount - index, newCount - index]);
  }
  return pairs;
}

// Ascending, non-overlapping Obsidian EditorChanges in original-document
// coordinates; applying them to the original text yields exactly the new text.
function planAlignedEditorChanges(oldLines, newLines, pairs, lineEnding = "\n") {
  const changes = [];
  const endOfLine = (line) => ({ line, ch: String(oldLines[line]).length });
  const pushGap = (oldStart, oldEnd, newStart, newEnd) => {
    const text = newLines.slice(newStart, newEnd).join(lineEnding);
    if (oldStart < oldEnd && newStart < newEnd) {
      changes.push({ from: { line: oldStart, ch: 0 }, to: endOfLine(oldEnd - 1), text });
    } else if (newStart < newEnd) {
      // Insert after the previous line's end so a scroll anchor at a line start
      // stays on its old line; only an insertion at the very top uses {0, 0}.
      if (oldStart > 0) {
        changes.push({
          from: endOfLine(oldStart - 1),
          to: endOfLine(oldStart - 1),
          text: `${lineEnding}${text}`,
        });
      } else {
        changes.push({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text: `${text}${lineEnding}` });
      }
    } else if (oldStart < oldEnd) {
      if (oldEnd < oldLines.length) {
        changes.push({ from: { line: oldStart, ch: 0 }, to: { line: oldEnd, ch: 0 }, text: "" });
      } else if (oldStart > 0) {
        changes.push({ from: endOfLine(oldStart - 1), to: endOfLine(oldEnd - 1), text: "" });
      } else {
        changes.push({ from: { line: 0, ch: 0 }, to: endOfLine(oldEnd - 1), text: "" });
      }
    }
  };

  let oldNext = 0;
  let newNext = 0;
  for (const [oldIndex, newIndex] of [...pairs, [oldLines.length, newLines.length]]) {
    if (
      oldIndex === 0 &&
      newIndex > 0 &&
      oldIndex < oldLines.length &&
      oldLines[0] !== newLines[newIndex]
    ) {
      // A top insertion and a replacement of the first line would both start
      // at {0, 0}; one replacement of that line carries both.
      changes.push({
        from: { line: 0, ch: 0 },
        to: endOfLine(0),
        text: newLines.slice(0, newIndex + 1).join(lineEnding),
      });
      oldNext = 1;
      newNext = newIndex + 1;
      continue;
    }
    pushGap(oldNext, oldIndex, newNext, newIndex);
    if (oldIndex < oldLines.length && oldLines[oldIndex] !== newLines[newIndex]) {
      changes.push({
        from: { line: oldIndex, ch: 0 },
        to: endOfLine(oldIndex),
        text: newLines[newIndex],
      });
    }
    oldNext = oldIndex + 1;
    newNext = newIndex + 1;
  }
  return changes;
}

// Map a `{line, ch}` in the old document to the new one through the alignment.
function mapEditorPositionThroughLineAlignment(position, oldLines, newLines, pairs) {
  const lastNewLine = Math.max(newLines.length - 1, 0);
  const clampCh = (line, ch) => Math.min(ch, String(newLines[line] || "").length);
  const oldLine = Math.max(0, Math.min(position.line, Math.max(oldLines.length - 1, 0)));
  const ch = position.ch;

  // The first pair at or after oldLine; pairs are strictly increasing in old.
  let low = 0;
  let high = pairs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (pairs[middle][0] < oldLine) low = middle + 1;
    else high = middle;
  }
  const next = low < pairs.length ? pairs[low] : null;
  if (next && next[0] === oldLine) {
    const before = String(oldLines[oldLine]);
    const after = String(newLines[next[1]]);
    if (before === after) {
      return { line: next[1], ch: Math.min(ch, after.length) };
    }
    const shared = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < shared && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < shared - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    let mapped = Math.min(ch, after.length);
    if (ch <= prefix) mapped = ch;
    else if (ch >= before.length - suffix) mapped = ch + (after.length - before.length);
    return { line: next[1], ch: Math.max(0, Math.min(mapped, after.length)) };
  }

  const previous = low > 0 ? pairs[low - 1] : [-1, -1];
  const newStart = previous[1] + 1;
  const newEnd = next ? next[1] : newLines.length;
  if (newStart < newEnd) {
    const line = newStart + Math.min(oldLine - (previous[0] + 1), newEnd - newStart - 1);
    return { line, ch: clampCh(line, ch) };
  }
  return { line: Math.min(newEnd, lastNewLine), ch: 0 };
}

// Fold a Pomodoro cleanup into a counted plan while keeping the cursor on
// the first source. Maps the pre-cleanup cursor through the final content
// alignment so it never parks on a generated BLOCKS line.
function withCountedPomodoroCursorMapped(plan, preCleanupContent, commitContent) {
  if (!plan || !Number.isInteger(plan.cursorLine)) return plan;
  if (commitContent === preCleanupContent) return { ...plan, content: commitContent };
  try {
    return {
      ...plan,
      content: commitContent,
      cursorLine: mapCountedLineThroughCleanup(plan.cursorLine, preCleanupContent, commitContent),
    };
  } catch (_error) {
    return { ...plan, content: commitContent };
  }
}

// Follow a pre-cleanup line through the final committed content. Uses the
// same alignment as the editor write (dependency fields, freshness fields,
// checkbox changes, and added block ids are ignored), so a counted cursor on
// a task survives a same-file Pomodoro fold. Returns the matched new line,
// or the input line clamped into range when the row cannot be identified.
function mapCountedLineThroughCleanup(oldLine, beforeContent, afterContent) {
  const at = Math.floor(Number(oldLine));
  if (!Number.isInteger(at)) return oldLine;
  const beforeLines = String(beforeContent ?? "").split(/\r?\n/);
  const afterLines = String(afterContent ?? "").split(/\r?\n/);
  if (beforeLines.length === 0 || afterLines.length === 0) return at;
  if (at < 0 || at >= beforeLines.length) {
    return Math.max(0, Math.min(at, afterLines.length - 1));
  }
  let pairs = null;
  try {
    pairs = alignEditorLines(beforeLines, afterLines);
  } catch (_error) {
    return Math.max(0, Math.min(at, afterLines.length - 1));
  }
  for (const [oldIndex, newIndex] of Array.isArray(pairs) ? pairs : []) {
    if (oldIndex === at) return newIndex;
  }
  return Math.max(0, Math.min(at, afterLines.length - 1));
}
