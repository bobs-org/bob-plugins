// Synchronous editor application for task settle (bob-cli-q4.8.1.2).
//
// Cursor policy is stay: when the cursor sits in the affected task's block
// and that block moves, the caret keeps its physical line index and the
// return value carries a jump target for the task's new location. Other
// carets follow settle's semantic lineMap. Selections and removed lines
// clamp into the document.
//
// History: staged gesture+settle is one editor.transaction. An already-
// applied write joins through editor.cm.dispatch with userEvent "input"
// and no isolateHistory so CM6 can merge within the history delay. When
// editor.cm is missing, editor.transaction is a separate undo event
// (regroup, then the original write); that fallback is the observed
// behavior, not a join via annotations.

function taskSettleNormalizePos(position) {
  if (!position || typeof position !== "object") return null;
  const line = Math.floor(Number(position.line));
  const ch = Math.floor(Number(position.ch));
  if (!Number.isInteger(line) || !Number.isInteger(ch)) return null;
  return { line: Math.max(0, line), ch: Math.max(0, ch) };
}

function taskSettleClampPos(position, lines) {
  const last = Math.max((lines && lines.length ? lines.length : 1) - 1, 0);
  const line = Math.max(0, Math.min(position.line, last));
  const ch = Math.max(0, Math.min(position.ch, String(lines[line] || "").length));
  return { line, ch };
}

function taskSettleLineIndent(line) {
  const text = String(line);
  let index = 0;
  while (text[index] === " " || text[index] === "\t") index += 1;
  return index;
}

function taskSettleTaskBlockRange(lines, headlineIndex) {
  if (!Array.isArray(lines) || headlineIndex < 0 || headlineIndex >= lines.length) {
    return null;
  }
  const indent = taskSettleLineIndent(lines[headlineIndex]);
  let end = headlineIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (String(line).trim() === "") {
      let look = end + 1;
      while (look < lines.length && String(lines[look]).trim() === "") look += 1;
      if (look < lines.length && taskSettleLineIndent(lines[look]) > indent) {
        end = look;
        continue;
      }
      break;
    }
    if (taskSettleLineIndent(line) > indent) {
      end += 1;
      continue;
    }
    break;
  }
  return { start: headlineIndex, end };
}

function taskSettleLineBlockId(line) {
  let leading = 0;
  const text = String(line);
  while (text[leading] === " " || text[leading] === "\t") leading += 1;
  const markerEnd = tsAfterListMarker(text, leading);
  if (markerEnd == null) return tsTrailingBlockId(text);
  let checkboxStart = markerEnd;
  while (text[checkboxStart] === " " || text[checkboxStart] === "\t") checkboxStart += 1;
  if (text[checkboxStart] !== "[") return tsTrailingBlockId(text);
  const close = text.indexOf("]", checkboxStart + 1);
  if (close === -1) return tsTrailingBlockId(text);
  return tsTrailingBlockId(text.slice(close + 1));
}

function taskSettleFindIdentityLine(lines, identity) {
  if (!identity || typeof identity !== "object" || !Array.isArray(lines)) return null;
  const blockId = typeof identity.blockId === "string" ? identity.blockId.trim() : "";
  const text = identity.text == null ? null : String(identity.text);
  // A supplied block ID is authoritative: unique match wins, absent or
  // duplicate means unresolved. Never fall through to a line hint or text.
  if (blockId) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (taskSettleLineBlockId(lines[index]) === blockId) matches.push(index);
    }
    return matches.length === 1 ? matches[0] : null;
  }
  // A line number alone is never identity. Exact text at the hinted line,
  // else an unambiguous exact-text match in the same path.
  const hinted = Number.isInteger(identity.line) ? identity.line : Math.floor(Number(identity.line));
  if (text != null && Number.isInteger(hinted) && hinted >= 0 && hinted < lines.length) {
    if (lines[hinted] === text) return hinted;
  }
  if (text == null) return null;
  const textMatches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === text) textMatches.push(index);
  }
  return textMatches.length === 1 ? textMatches[0] : null;
}

function taskSettleLookupLineMap(lineMap, oldLine) {
  if (!lineMap || typeof lineMap !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(lineMap, oldLine)) {
    const mapped = lineMap[oldLine];
    return Number.isInteger(mapped) ? mapped : null;
  }
  const asString = String(oldLine);
  if (Object.prototype.hasOwnProperty.call(lineMap, asString)) {
    const mapped = lineMap[asString];
    return Number.isInteger(mapped) ? mapped : null;
  }
  return null;
}

function taskSettleFallbackMappedLine(lineMap, oldLine, newLineCount) {
  const last = Math.max(newLineCount - 1, 0);
  let bestOld = -1;
  let bestNew = null;
  for (const [rawOld, rawNew] of Object.entries(lineMap || {})) {
    const from = Number(rawOld);
    const to = Number(rawNew);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > oldLine) continue;
    if (from > bestOld) {
      bestOld = from;
      bestNew = to;
    }
  }
  if (bestNew == null) return 0;
  return Math.max(0, Math.min(bestNew, last));
}

function taskSettleMapFollowPos(position, lineMap, oldLines, newLines) {
  const clamped = taskSettleClampPos(position, oldLines);
  const mapped = taskSettleLookupLineMap(lineMap, clamped.line);
  if (mapped != null) {
    const line = Math.max(0, Math.min(mapped, Math.max(newLines.length - 1, 0)));
    const oldText = String(oldLines[clamped.line] || "");
    const newText = String(newLines[line] || "");
    let ch = clamped.ch;
    if (oldText === newText) {
      ch = Math.min(ch, newText.length);
    } else {
      const shared = Math.min(oldText.length, newText.length);
      let prefix = 0;
      while (prefix < shared && oldText[prefix] === newText[prefix]) prefix += 1;
      if (ch <= prefix) ch = Math.min(ch, newText.length);
      else ch = Math.min(newText.length, prefix);
    }
    return { line, ch: Math.max(0, ch) };
  }
  const line = taskSettleFallbackMappedLine(lineMap, clamped.line, newLines.length);
  return { line, ch: 0 };
}

function taskSettleMapStayPos(position, newLines) {
  return taskSettleClampPos(position, newLines);
}

function taskSettleCursorBelongsToBlock(cursorLine, block) {
  return Boolean(block && cursorLine >= block.start && cursorLine < block.end);
}

function taskSettlePlanCursor(options) {
  const {
    cursor,
    selection,
    identity,
    lineMap,
    inputLines,
    outputLines,
    path,
  } = options;
  const lastOut = Math.max(outputLines.length - 1, 0);
  const identityLine = taskSettleFindIdentityLine(inputLines, identity);
  const block = identityLine != null ? taskSettleTaskBlockRange(inputLines, identityLine) : null;
  const mappedIdentityLine =
    identityLine != null ? taskSettleLookupLineMap(lineMap, identityLine) : null;
  const blockMoved =
    identityLine != null && mappedIdentityLine != null && mappedIdentityLine !== identityLine;

  const from = taskSettleNormalizePos(selection && selection.from) || taskSettleNormalizePos(cursor);
  const to = taskSettleNormalizePos(selection && selection.to) || from;
  if (!from) {
    return {
      cursor: { line: 0, ch: 0 },
      selection: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
      jumpTarget: null,
    };
  }

  const collapsed = from.line === to.line && from.ch === to.ch;
  const stay =
    collapsed &&
    blockMoved &&
    taskSettleCursorBelongsToBlock(from.line, block);

  const mappedFrom = stay
    ? taskSettleMapStayPos(from, outputLines)
    : taskSettleMapFollowPos(from, lineMap, inputLines, outputLines);
  const mappedTo = stay
    ? mappedFrom
    : taskSettleMapFollowPos(to, lineMap, inputLines, outputLines);

  let jumpTarget = null;
  if (stay && mappedIdentityLine != null) {
    const jumpLine = Math.max(0, Math.min(mappedIdentityLine, lastOut));
    const jumpText = String(outputLines[jumpLine] || "");
    jumpTarget = {
      path: String(path || ""),
      line: jumpLine,
      ch: Math.min(from.ch, jumpText.length),
      blockId: identity && typeof identity.blockId === "string" ? identity.blockId : taskSettleLineBlockId(jumpText),
      text: jumpText,
    };
  }

  return {
    cursor: mappedFrom,
    selection: { from: mappedFrom, to: mappedTo },
    jumpTarget,
  };
}

function taskSettleOffsetOf(position, lines, lineEnding) {
  let offset = 0;
  const line = Math.max(0, Math.min(position.line, Math.max(lines.length - 1, 0)));
  for (let index = 0; index < line; index += 1) {
    offset += String(lines[index]).length + lineEnding.length;
  }
  return offset + Math.max(0, Math.min(position.ch, String(lines[line] || "").length));
}

function taskSettleViewportWouldHide(editor, cursor, scroll) {
  if (!scroll || typeof scroll.top !== "number") return false;
  const lineHeight =
    typeof editor.getLineHeight === "function"
      ? Number(editor.getLineHeight()) || 20
      : 20;
  const height = typeof scroll.clientHeight === "number" ? scroll.clientHeight : 400;
  const first = Math.floor(scroll.top / lineHeight);
  const last = first + Math.max(1, Math.floor(height / lineHeight));
  return cursor.line < first || cursor.line > last;
}

function taskSettleDispatchApply(editor, plan, options = {}) {
  const joinHistory = options.joinHistory === true;
  const changes = plan.changes || [];
  const selection = plan.selection;
  const oldLines = plan.oldLines || [];
  const lineEnding = plan.lineEnding || "\n";

  const cm = editor.cm;
  if (cm && typeof cm.dispatch === "function" && changes.length > 0) {
    const cmChanges = changes.map((change) => ({
      from: taskSettleOffsetOf(change.from, oldLines, lineEnding),
      to: taskSettleOffsetOf(change.to || change.from, oldLines, lineEnding),
      insert: String(change.text == null ? "" : change.text),
    }));
    const spec = {
      changes: cmChanges,
      userEvent: joinHistory ? "input" : "bob.taskSettle",
    };
    if (selection) {
      spec.selection = {
        anchor: taskSettleOffsetOf(selection.from, plan.newLines, lineEnding),
        head: taskSettleOffsetOf(selection.to || selection.from, plan.newLines, lineEnding),
      };
    }
    const historyDepthBefore = joinHistory ? taskSettleHistoryDepth(cm) : null;
    cm.dispatch(spec);
    const historyDepthAfter = joinHistory ? taskSettleHistoryDepth(cm) : null;
    const historyJoined = !joinHistory
      ? false
      : historyDepthBefore == null || historyDepthAfter == null
        ? null
        : historyDepthBefore > 0 && historyDepthAfter === historyDepthBefore;
    return { historyJoined, via: "cm.dispatch" };
  }

  if (typeof editor.transaction === "function") {
    const transaction = { changes };
    if (selection) transaction.selection = { from: selection.from, to: selection.to };
    editor.transaction(transaction);
    return {
      historyJoined: false,
      via: "editor.transaction",
    };
  }

  if (typeof editor.replaceRange !== "function") {
    return { historyJoined: false, via: null };
  }
  const descending = [...changes].sort(
    (left, right) => right.from.line - left.from.line || right.from.ch - left.from.ch,
  );
  for (const change of descending) {
    editor.replaceRange(change.text, change.from, change.to || change.from);
  }
  if (selection && typeof editor.setCursor === "function") {
    editor.setCursor(selection.from.line, selection.from.ch);
  }
  return { historyJoined: false, via: "replaceRange" };
}

function taskSettleIdleOutcome(fields) {
  return {
    contents: fields.contents,
    changed: false,
    applied: false,
    lineMap: fields.lineMap || {},
    jumpTarget: null,
    cursor: fields.cursor || null,
    reason: fields.reason,
    warnings: fields.warnings || [],
    historyJoined: null,
  };
}

function taskSettleApplyToEditor(editor, path, options = {}, host = null) {
  const opts = options && typeof options === "object" ? options : {};
  const app = opts.app || (host && host.app) || null;
  if (!editor || typeof editor.getValue !== "function") {
    return taskSettleIdleOutcome({ contents: "", reason: "editor" });
  }

  const live = String(editor.getValue());
  const stagedContentsSupplied = Object.prototype.hasOwnProperty.call(opts, "contents")
    && opts.contents != null;
  // Staged contents require an explicit matching preimage. Current-buffer
  // calls omit `contents` and keep working without `expected`.
  if (stagedContentsSupplied && opts.expected == null) {
    return taskSettleIdleOutcome({
      contents: live,
      cursor: typeof editor.getCursor === "function" ? editor.getCursor() : null,
      reason: "preimage",
    });
  }
  const expected = opts.expected != null ? String(opts.expected) : live;
  if (live !== expected) {
    return taskSettleIdleOutcome({
      contents: live,
      cursor: typeof editor.getCursor === "function" ? editor.getCursor() : null,
      reason: "preimage",
    });
  }

  const guard = taskSettleGuardEditorPath(app, editor, path);
  if (!guard.ok) {
    return taskSettleIdleOutcome({
      contents: live,
      cursor: typeof editor.getCursor === "function" ? editor.getCursor() : null,
      reason: guard.reason,
    });
  }

  const context = opts.context || taskSettleCaptureContext(app, opts);
  const settleInput = opts.contents != null ? String(opts.contents) : live;
  const settled = taskSettleNote(
    normalizeVaultPath(path),
    settleInput,
    context.today,
    context.classification,
    context.dailyPath,
  );

  const inputSplit = taskSettleSplitEditorText(settleInput);
  const outputSplit = taskSettleSplitEditorText(settled.contents);
  const liveSplit = taskSettleSplitEditorText(live);

  let cursor = taskSettleNormalizePos(opts.cursor);
  if (!cursor && typeof editor.getCursor === "function") {
    cursor = taskSettleNormalizePos(editor.getCursor());
  }
  if (!cursor) cursor = { line: 0, ch: 0 };

  let identity = opts.identity && typeof opts.identity === "object" ? { ...opts.identity } : null;
  if (settleInput !== live && cursor) {
    const livePairs = taskSettleAlignEditorLines(liveSplit.lines, inputSplit.lines);
    cursor = taskSettleMapPositionThroughAlignment(
      cursor,
      liveSplit.lines,
      inputSplit.lines,
      livePairs,
    );
    if (identity && Number.isInteger(identity.line)) {
      const mappedIdentity = taskSettleMapPositionThroughAlignment(
        { line: identity.line, ch: 0 },
        liveSplit.lines,
        inputSplit.lines,
        livePairs,
      );
      identity = { ...identity, line: mappedIdentity.line };
    }
  }

  const selection = opts.selection && typeof opts.selection === "object"
    ? {
        from: taskSettleNormalizePos(opts.selection.from) || cursor,
        to: taskSettleNormalizePos(opts.selection.to) || cursor,
      }
    : { from: cursor, to: cursor };

  const plannedCursor = taskSettlePlanCursor({
    cursor,
    selection,
    identity,
    lineMap: settled.lineMap,
    inputLines: inputSplit.lines,
    outputLines: outputSplit.lines,
    path: normalizeVaultPath(path),
  });

  if (!settled.changed && settleInput === live) {
    return {
      contents: live,
      changed: false,
      applied: false,
      lineMap: settled.lineMap,
      jumpTarget: null,
      cursor: taskSettleClampPos(cursor, liveSplit.lines),
      reason: "noop",
      warnings: settled.warnings || [],
      historyJoined: null,
    };
  }

  if (live === settled.contents) {
    return {
      contents: live,
      changed: false,
      applied: false,
      lineMap: settled.lineMap,
      jumpTarget: null,
      cursor: taskSettleClampPos(cursor, liveSplit.lines),
      reason: "noop",
      warnings: settled.warnings || [],
      historyJoined: null,
    };
  }

  const edits = taskSettlePlanContentEdits(live, settled.contents);
  const scroll =
    typeof editor.getScrollInfo === "function" ? editor.getScrollInfo() : null;
  const joinHistory = opts.joinHistory === true;

  const dispatched = taskSettleDispatchApply(
    editor,
    {
      changes: edits.changes,
      selection: plannedCursor.selection,
      oldLines: edits.oldLines,
      newLines: edits.newLines,
      lineEnding: edits.lineEnding,
    },
    { joinHistory },
  );

  if (dispatched.via == null) {
    return taskSettleIdleOutcome({
      contents: live,
      cursor: typeof editor.getCursor === "function" ? editor.getCursor() : null,
      reason: "editor",
      warnings: settled.warnings || [],
      lineMap: settled.lineMap,
    });
  }

  if (
    scroll &&
    typeof editor.scrollTo === "function" &&
    !taskSettleViewportWouldHide(editor, plannedCursor.cursor, scroll)
  ) {
    try {
      editor.scrollTo(scroll.left, scroll.top);
    } catch (_error) {
      // Viewport restoration is best-effort.
    }
  }

  return {
    contents: typeof editor.getValue === "function" ? String(editor.getValue()) : settled.contents,
    changed: settled.changed || settleInput !== live,
    applied: true,
    lineMap: settled.lineMap,
    jumpTarget: plannedCursor.jumpTarget,
    cursor: plannedCursor.cursor,
    reason: null,
    warnings: settled.warnings || [],
    historyJoined: dispatched.historyJoined,
  };
}
