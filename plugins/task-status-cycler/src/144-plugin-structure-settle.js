// Structure-settle (bob-cli-q4.9.1.3): compose promote/demote plans with
// settle in one staged editor transaction. Missing or throwing providers
// fall back to the existing writer; stale preimage, path, or view mismatches
// abandon instead of writing an old plan into a reused editor.

function structureSettleJoinLines(lines, expected) {
  const source = expected == null ? "" : String(expected);
  const ending = source.includes("\r\n") ? "\r\n" : "\n";
  const text = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line ?? ""))
    .join(ending);
  if (source.endsWith(ending) && text !== "" && !text.endsWith(ending)) {
    return `${text}${ending}`;
  }
  return text;
}

function structureSettleAbandonReason(reason) {
  return (
    reason === "preimage" ||
    reason === "path" ||
    reason === "view" ||
    reason === "editor"
  );
}

class TaskStatusCyclerStructureSettleMixin {
  structureSettleEditorPath(editor, view) {
    const livePath = this.taskSettleLiveEditorPath(editor);
    if (livePath) return livePath;
    const file = view && view.file;
    return file && typeof file.path === "string" ? file.path : null;
  }

  plannedObsidianTaskContents(editor, plan) {
    const expected = editor && typeof editor.getValue === "function"
      ? String(editor.getValue())
      : this.getEditorSnapshotText(editor);
    const liveCursor = editor && typeof editor.getCursor === "function"
      ? editor.getCursor()
      : null;
    if (!plan) {
      return { expected, contents: expected, identity: null, cursor: liveCursor };
    }
    let nextLines = null;
    let identityLine = Number.isInteger(plan.cursorLine) ? plan.cursorLine : plan.line;
    let identityText = null;
    if (plan.mode === "replace") {
      const oldLines = this.getEditorLineArray(editor);
      nextLines = oldLines.slice();
      if (Number.isInteger(plan.line) && plan.line >= 0 && plan.line < nextLines.length) {
        nextLines[plan.line] = plan.lineText;
      }
      identityText = plan.lineText;
    } else if (plan.mode === "replaceLines" || plan.mode === "move") {
      nextLines = Array.isArray(plan.nextLines) ? plan.nextLines.slice() : null;
      identityText = nextLines && Number.isInteger(identityLine) &&
        identityLine >= 0 && identityLine < nextLines.length
        ? nextLines[identityLine]
        : null;
    }
    if (!nextLines) {
      return { expected, contents: expected, identity: null, cursor: liveCursor };
    }
    const contents = structureSettleJoinLines(nextLines, expected);
    const cursor = {
      line: Number.isInteger(plan.cursorLine)
        ? plan.cursorLine
        : (liveCursor && Number.isInteger(liveCursor.line) ? liveCursor.line : 0),
      ch: Number.isInteger(plan.cursorCh)
        ? plan.cursorCh
        : (liveCursor && Number.isInteger(liveCursor.ch) ? liveCursor.ch : 0),
    };
    const identity = identityText != null
      ? this.snapshotTaskSettleIdentity(identityText, identityLine)
      : null;
    return { expected, contents, identity, cursor, liveCursor };
  }

  applySettledObsidianTaskPlan(editor, plan, view = null) {
    if (!plan || !editor) return false;
    const path = this.structureSettleEditorPath(editor, view);
    if (path && this.resolveTaskSettleApi()) {
      const planned = this.plannedObsidianTaskContents(editor, plan);
      const dest = planned.cursor;
      let result;
      try {
        result = this.applyTaskSettleToEditor(editor, path, {
          expected: planned.expected,
          contents: planned.contents,
          identity: planned.identity,
          cursor: planned.liveCursor || dest,
          selection: dest ? { from: dest, to: dest } : undefined,
          today: typeof this.getCreatedDateString === "function"
            ? this.getCreatedDateString()
            : undefined,
        });
      } catch (_error) {
        result = { applied: false, changed: false, reason: "error" };
      }
      if (result && result.applied === true) {
        return true;
      }
      if (result && structureSettleAbandonReason(result.reason)) {
        return false;
      }
    }
    return this.applyObsidianTaskPlanFallback(editor, plan, view);
  }

  applyObsidianTaskPlanFallback(editor, plan, view = null) {
    if (plan.mode === "move") {
      return this.applyObsidianTaskMovePlanUnsettled(editor, plan, view);
    }
    if (plan.mode === "replaceLines") {
      return this.applyObsidianTaskReplaceLinesPlanUnsettled(editor, plan);
    }
    return this.applyObsidianTaskReplacePlanUnsettled(editor, plan);
  }

  applyObsidianTaskReplacePlan(editor, plan, view = null) {
    return this.applySettledObsidianTaskPlan(editor, plan, view);
  }

  applyObsidianTaskMovePlan(editor, plan, view = null) {
    return this.applySettledObsidianTaskPlan(editor, plan, view);
  }

  applyObsidianTaskReplaceLinesPlan(editor, plan, view = null) {
    return this.applySettledObsidianTaskPlan(editor, plan, view);
  }

  applyObsidianTaskReplacePlanUnsettled(editor, plan) {
    editor.replaceRange(
      plan.lineText,
      { line: plan.line, ch: 0 },
      { line: plan.line, ch: plan.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({ line: plan.cursorLine, ch: plan.cursorCh });
    }

    return true;
  }

  applyObsidianTaskMovePlanUnsettled(editor, plan, view = null) {
    const oldLines = this.getEditorLineArray(editor);
    this.applyDocumentLineReplacement(editor, oldLines, plan.nextLines);

    if (typeof editor.setCursor === "function") {
      const targetLine = plan.cursorLine;
      const lineText =
        typeof editor.getLine === "function"
          ? editor.getLine(targetLine) || ""
          : "";
      const targetCh = Math.max(0, Math.min(plan.cursorCh, lineText.length));
      editor.setCursor({ line: targetLine, ch: targetCh });

      this.centerEditorLineInView(editor, targetLine, targetCh, view);
    }

    return true;
  }

  applyObsidianTaskReplaceLinesPlanUnsettled(editor, plan) {
    this.applyDocumentLineReplacement(
      editor, this.getEditorLineArray(editor), plan.nextLines,
    );
    if (typeof editor.setCursor === "function") {
      const line = Math.max(0, Math.min(plan.cursorLine, plan.nextLines.length - 1));
      const ch = Math.max(0, Math.min(plan.cursorCh, plan.nextLines[line].length));
      editor.setCursor({ line, ch });
    }
    return true;
  }
}
