// Close-settle helpers (bob-cli-q4.9.1.2 close-settle).
// Integrates tier-1 settle into Ctrl+Enter, completeTaskAtCursor, and
// transcluded completion while preserving recurrence, verification,
// successor focus, and walk behavior. Common low-level setters accept a
// deferred policy from cycling so a cycle that reaches Done never takes
// the immediate-close path and counted loops never regroup mid-range.

function closeSettleNormalizePolicyForWrite(requested, nextSymbol) {
  const policy = normalizeTaskSettleWritePolicy(requested);
  if (policy !== TASK_SETTLE_WRITE_POLICY.immediate) return policy;
  if (nextSymbol === "x") return TASK_SETTLE_WRITE_POLICY.immediate;
  return TASK_SETTLE_WRITE_POLICY.none;
}

class TaskStatusCyclerCloseSettleMixin {
  // Moved from the editor-edits mixin so that fragment stays under the
  // 1000-line cap: the post-Tasks close probe used before settle.
  closedTaskLineAfterTasksWrite(editor, originalLine, lineDelta) {
    if (!editor || typeof editor.getLine !== "function") {
      return null;
    }
    const candidates = [originalLine];
    if (lineDelta) {
      const offsetLine = originalLine + lineDelta;
      if (offsetLine !== originalLine) {
        candidates.push(offsetLine);
      }
    }
    for (const line of candidates) {
      if (typeof line !== "number" || line < 0) {
        continue;
      }
      const status = getTaskStatusForLine(editor.getLine(line), line);
      if (status && status.symbol === "x") {
        return line;
      }
    }
    return null;
  }

  closeSettleSnapshotForTaskStatus(taskStatus) {
    if (!taskStatus) return null;
    try {
      return this.snapshotTaskSettleIdentity(taskStatus.lineText, taskStatus.line);
    } catch (_error) {
      return null;
    }
  }

  // Verify the Tasks write closed a row, returning its line and exact
  // post-Tasks text. Checks the original line first, then the
  // original-plus-delta line for recurrence inserts. Recurring spawns keep
  // their open symbol so they never match the closed check below,
  // including idless rows where the closed text differs only by `[x]`.
  verifyClosedTaskAfterTasksWrite(editor, originalLine, lineDelta) {
    const line = this.closedTaskLineAfterTasksWrite(editor, originalLine, lineDelta);
    if (line == null) return null;
    let text = null;
    try {
      text = typeof editor.getLine === "function" ? editor.getLine(line) : null;
    } catch (_error) {
      text = null;
    }
    if (typeof text !== "string") return null;
    let status = null;
    try {
      status = getTaskStatusForLine(text, line);
    } catch (_error) {
      status = null;
    }
    if (!status || status.symbol !== "x") return null;
    return { line, text };
  }

  // Locate the confirmed closed row after settle. Prefers a unique block-ID
  // match whose current line still reads `[x]`; falls back to an unambiguous
  // exact-text match, then to the verified hint line when it still reads
  // `[x]`. A recurring next occurrence keeps its open symbol (or its own
  // repeat text) so it is never mistaken for the closed original. Returns
  // the settled line number or null.
  locateSettledClosedTask(editor, settled) {
    if (!editor || typeof editor.getLine !== "function" || !settled) return null;
    const hintLine = Number.isInteger(settled.hintLine) ? settled.hintLine : null;
    const blockId = typeof settled.blockId === "string" && settled.blockId.trim()
      ? settled.blockId.trim()
      : null;
    const closedText = typeof settled.closedText === "string" ? settled.closedText : null;
    const count = typeof this.getEditorLineCount === "function"
      ? this.getEditorLineCount(editor)
      : null;
    const total = Number.isInteger(count) ? count : null;
    const readLine = (line) => {
      try {
        return editor.getLine(line);
      } catch (_error) {
        return null;
      }
    };
    const isClosedLine = (lineText, line) => {
      if (typeof lineText !== "string") return false;
      let status = null;
      try {
        status = getTaskStatusForLine(lineText, line);
      } catch (_error) {
        status = null;
      }
      return !!status && status.symbol === "x";
    };
    if (blockId && typeof lineContainsStandaloneBlockId === "function") {
      const matches = [];
      if (total != null) {
        for (let line = 0; line < total; line += 1) {
          const lineText = readLine(line);
          if (typeof lineText !== "string") continue;
          let holds = false;
          try {
            holds = lineContainsStandaloneBlockId(lineText, blockId);
          } catch (_error) {
            holds = false;
          }
          if (holds) matches.push({ line, lineText });
        }
      }
      if (matches.length === 1 && isClosedLine(matches[0].lineText, matches[0].line)) {
        return matches[0].line;
      }
    }
    if (closedText != null && total != null) {
      const matches = [];
      for (let line = 0; line < total; line += 1) {
        if (readLine(line) === closedText) matches.push(line);
      }
      if (matches.length === 1 && isClosedLine(readLine(matches[0]), matches[0])) {
        return matches[0];
      }
      if (matches.length > 1 && hintLine != null && matches.includes(hintLine)) {
        if (isClosedLine(readLine(hintLine), hintLine)) return hintLine;
      }
    }
    if (hintLine != null && (total == null || (hintLine >= 0 && hintLine < total))) {
      const lineText = readLine(hintLine);
      if (isClosedLine(lineText, hintLine)) return hintLine;
    }
    return null;
  }

  // Live settle of the active note after a Tasks-backed close. The Tasks
  // write is the preceding editor edit, so joinHistory requests one undo
  // event; the provider reports historyJoined (true only through CM6
  // dispatch, false through the editor.transaction fallback). Missing,
  // stale, or throwing providers leave the Tasks write in place.
  settleCloseInActiveEditor(editor, activePath, settleIdentity) {
    if (!editor || !activePath || !settleIdentity) {
      return { applied: false, changed: false, reason: "skip" };
    }
    try {
      return this.applyTaskSettleToEditor(editor, activePath, {
        identity: settleIdentity,
        joinHistory: true,
      });
    } catch (_error) {
      return { applied: false, changed: false, reason: "error" };
    }
  }

  // Pure settle composition for vault-written transclusion targets. Runs
  // inside the same vault.process callback as the status flip so the
  // target note is written once. Falls back to the un-settled bytes when
  // the provider is missing or refuses.
  settleComposedTargetContents(targetPath, plannedContents) {
    const planned = plannedContents == null ? "" : String(plannedContents);
    let settled = null;
    try {
      settled = this.settleTargetContents(targetPath, planned);
    } catch (_error) {
      settled = null;
    }
    if (!settled || typeof settled.contents !== "string") return planned;
    if (settled.reason === "missing" || settled.reason === "error") return planned;
    return settled.contents;
  }

  // Re-resolve a transcluded close line against live target text. The
  // cached/scanned line may be stale after async confirmation; a unique
  // standalone block-ID match wins, otherwise the stale line is kept only
  // when it still holds the block ID. Returns the live line or null.
  resolveLiveTranscludedCloseLine(sourceText, blockId, staleLine) {
    if (typeof sourceText !== "string") return null;
    const id = typeof blockId === "string" && blockId.trim() ? blockId.trim() : null;
    if (!id || typeof lineContainsStandaloneBlockId !== "function") {
      return Number.isInteger(staleLine) ? staleLine : null;
    }
    const holdsAt = (line) => {
      if (!Number.isInteger(line)) return false;
      const lineText = getLineTextFromSourceText(sourceText, line);
      if (typeof lineText !== "string") return false;
      try {
        return lineContainsStandaloneBlockId(lineText, id);
      } catch (_error) {
        return false;
      }
    };
    if (holdsAt(staleLine)) return staleLine;
    const lines = sourceText.split(/\r?\n/);
    const matches = [];
    for (let line = 0; line < lines.length; line += 1) {
      let holds = false;
      try {
        holds = lineContainsStandaloneBlockId(lines[line] || "", id);
      } catch (_error) {
        holds = false;
      }
      if (holds) matches.push(line);
    }
    if (matches.length === 1) return matches[0];
    return null;
  }
}
