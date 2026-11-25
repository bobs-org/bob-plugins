// Minimal editor edits for task settle (bob-cli-q4.8.1.2 editor-apply).
//
// Navigation's `181-editor-line-diff.js` is the reference for preserving
// stable content and viewport. Settle's semantic `lineMap` stays separate:
// these helpers align raw lines so the transaction touches only changed
// hunks and never replaces the whole document with setValue.

const TASK_SETTLE_EDITOR_DIFF_MAX_EDITS = 2000;

function taskSettleSplitEditorText(content) {
  const text = String(content == null ? "" : content);
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), lineEnding };
}

function taskSettleEditorMyersPairs(oldKeys, newKeys, maxEdits) {
  const oldCount = oldKeys.length;
  const newCount = newKeys.length;
  if (oldCount === 0 || newCount === 0) return [];
  const limit = Math.min(oldCount + newCount, maxEdits);
  const mid = limit + 1;
  const furthest = new Array(2 * limit + 3).fill(0);
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
      if (x >= oldCount && y >= newCount) edits = d;
    }
    snapshots.push(furthest.slice(mid - d, mid + d + 1));
  }
  if (edits < 0) return null;

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

function taskSettleAlignEditorLines(oldLines, newLines) {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const shared = Math.min(oldCount, newCount);
  let prefix = 0;
  while (prefix < shared && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shared - prefix &&
    oldLines[oldCount - 1 - suffix] === newLines[newCount - 1 - suffix]
  ) {
    suffix += 1;
  }

  const pairs = [];
  for (let index = 0; index < prefix; index += 1) pairs.push([index, index]);
  const oldKeys = oldLines.slice(prefix, oldCount - suffix);
  const newKeys = newLines.slice(prefix, newCount - suffix);
  const middle = taskSettleEditorMyersPairs(
    oldKeys,
    newKeys,
    TASK_SETTLE_EDITOR_DIFF_MAX_EDITS,
  );
  for (const [oldIndex, newIndex] of middle || []) {
    pairs.push([prefix + oldIndex, prefix + newIndex]);
  }
  for (let index = suffix; index > 0; index -= 1) {
    pairs.push([oldCount - index, newCount - index]);
  }
  return pairs;
}

function taskSettlePlanEditorChanges(oldLines, newLines, pairs, lineEnding = "\n") {
  const changes = [];
  const endOfLine = (line) => ({ line, ch: String(oldLines[line]).length });
  const pushGap = (oldStart, oldEnd, newStart, newEnd) => {
    const text = newLines.slice(newStart, newEnd).join(lineEnding);
    if (oldStart < oldEnd && newStart < newEnd) {
      changes.push({ from: { line: oldStart, ch: 0 }, to: endOfLine(oldEnd - 1), text });
    } else if (newStart < newEnd) {
      if (oldStart > 0) {
        changes.push({
          from: endOfLine(oldStart - 1),
          to: endOfLine(oldStart - 1),
          text: `${lineEnding}${text}`,
        });
      } else {
        changes.push({
          from: { line: 0, ch: 0 },
          to: { line: 0, ch: 0 },
          text: `${text}${lineEnding}`,
        });
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

function taskSettleMapPositionThroughAlignment(position, oldLines, newLines, pairs) {
  const lastNewLine = Math.max(newLines.length - 1, 0);
  const clampCh = (line, ch) => Math.min(Math.max(0, ch), String(newLines[line] || "").length);
  const oldLine = Math.max(0, Math.min(position.line, Math.max(oldLines.length - 1, 0)));
  const ch = position.ch;

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

function taskSettleIsWholeDocumentReplacement(changes, oldLines) {
  if (!Array.isArray(changes) || changes.length !== 1 || !Array.isArray(oldLines)) {
    return false;
  }
  if (oldLines.length <= 1) return false;
  const change = changes[0];
  const last = oldLines.length - 1;
  return (
    change.from &&
    change.to &&
    change.from.line === 0 &&
    change.from.ch === 0 &&
    change.to.line === last &&
    change.to.ch === String(oldLines[last]).length
  );
}

function taskSettlePlanContentEdits(oldText, newText) {
  const original = taskSettleSplitEditorText(oldText);
  const next = taskSettleSplitEditorText(newText);
  if (original.lines.join("\n") === next.lines.join("\n") && String(oldText) === String(newText)) {
    return { changes: [], pairs: [], oldLines: original.lines, newLines: next.lines, lineEnding: next.lineEnding };
  }
  const pairs = taskSettleAlignEditorLines(original.lines, next.lines);
  const changes = taskSettlePlanEditorChanges(
    original.lines,
    next.lines,
    pairs,
    next.lineEnding,
  );
  return {
    changes,
    pairs,
    oldLines: original.lines,
    newLines: next.lines,
    lineEnding: next.lineEnding,
  };
}
