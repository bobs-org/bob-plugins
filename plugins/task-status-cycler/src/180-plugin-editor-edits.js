class TaskStatusCyclerEditorEditsMixin {
  toggleActiveCheckboxMarker(
    editor,
    checkboxToggle = this.getActiveTaskCheckboxMarkerToggle(editor),
  ) {
    if (!checkboxToggle) {
      return false;
    }

    editor.replaceRange(
      checkboxToggle.lineText,
      { line: checkboxToggle.line, ch: 0 },
      { line: checkboxToggle.line, ch: checkboxToggle.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: checkboxToggle.line,
        ch: getTaskCheckboxMarkerCursorCh(checkboxToggle.cursorCh, checkboxToggle),
      });
    }

    return true;
  }

  toggleActiveObsidianTask(
    editor,
    plan = this.getActiveObsidianTaskToggle(editor),
    view = null,
  ) {
    if (!plan) {
      return false;
    }

    if (plan.mode === "prompt") {
      return this.openDemotionSectionPicker(editor, view, plan);
    }

    if (plan.mode === "move") {
      return this.applyObsidianTaskMovePlan(editor, plan, view);
    }

    return this.applyObsidianTaskReplacePlan(editor, plan);
  }

  getEditorSnapshotText(editor) {
    if (editor && typeof editor.getValue === "function") {
      return editor.getValue();
    }

    return this.getEditorLineArray(editor).join("\n");
  }

  captureDemotionPickerSnapshot(editor, view, plan) {
    const file = (view && view.file) || null;
    return {
      editor,
      view,
      file,
      filePath: file && file.path ? file.path : null,
      documentText: this.getEditorSnapshotText(editor),
      plan,
    };
  }

  isDemotionPickerSnapshotFresh(snapshot) {
    if (!snapshot || !snapshot.editor) {
      return false;
    }

    const { editor, view, file, filePath, documentText } = snapshot;
    if (view) {
      if (view.editor && view.editor !== editor) {
        return false;
      }
      const viewFile = view.file;
      if (file && viewFile && viewFile !== file) {
        return false;
      }
      const viewPath = viewFile && viewFile.path;
      if (filePath && viewPath && viewPath !== filePath) {
        return false;
      }
    }

    return this.getEditorSnapshotText(editor) === documentText;
  }

  openDemotionSectionPicker(editor, view, plan) {
    if (this.demotionSectionPicker) {
      return true;
    }

    if (!editor || !plan || plan.mode !== "prompt") {
      return false;
    }

    const snapshot = this.captureDemotionPickerSnapshot(editor, view, plan);
    const modal = new DemotionSectionPickerModal(this.app, this, snapshot);
    this.demotionSectionPicker = modal;
    modal.open();
    return true;
  }

  clearDemotionSectionPicker(modal) {
    if (!modal || this.demotionSectionPicker === modal) {
      this.demotionSectionPicker = null;
    }
  }

  submitDemotionSectionPicker(modal, destination) {
    if (!modal || modal.completed || modal.submitting) {
      return false;
    }

    modal.submitting = true;
    try {
      const snapshot = modal.snapshot;
      if (!this.isDemotionPickerSnapshotFresh(snapshot)) {
        new Notice(DEMOTION_STALE_NOTICE);
        modal.close();
        return false;
      }

      const movePlan = resolveObsidianTaskPromptDestination(
        snapshot.plan,
        destination,
      );
      if (!movePlan || movePlan.mode !== "move") {
        new Notice(DEMOTION_MISSING_SECTION_NOTICE);
        modal.close();
        return false;
      }

      const applied = this.applyObsidianTaskMovePlan(
        snapshot.editor,
        movePlan,
        snapshot.view,
      );
      if (applied) {
        modal.completed = true;
        modal.close();
      }
      return applied;
    } finally {
      modal.submitting = false;
    }
  }

  applyObsidianTaskReplacePlan(editor, plan) {
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

  applyObsidianTaskMovePlan(editor, plan, view = null) {
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

  centerEditorLineInView(editor, line, ch, markdownView = null) {
    const editorView =
      getEditorViewFromEditor(editor) ||
      (markdownView ? getEditorViewFromEditor(markdownView.editor) : null);
    if (centerEditorViewOnPosition(editorView, line, ch)) {
      return true;
    }

    if (!editor || typeof editor.scrollIntoView !== "function") {
      return false;
    }

    // Fall back to Obsidian's editor-level reveal, preferring the two-argument
    // centered shape before the plain one-argument reveal.
    const position = { line, ch };
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
      return true;
    } catch (error) {
      // Fall through to the one-argument reveal shape below.
    }

    try {
      editor.scrollIntoView({ from: position, to: position });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Defer a `zz`-style center of `line`/`ch` past the current Vim command turn
  // so it is the final scroll instruction, then keep it the last word: a
  // successful CM6 center never falls through to a later nearest-scroll. The
  // bounded retry only waits for the target editor view to attach; it never
  // re-fires against the user once a center has landed.
  scheduleCenterEditorLineInView(editor, line, ch, markdownView = null, options = {}) {
    cancelDeferred(this.pendingPomodoroCenterDeferred);

    const requestedAttempts = Math.floor(Number(options.attempts));
    const attempts = Math.max(
      1,
      Number.isFinite(requestedAttempts)
        ? requestedAttempts
        : CENTER_ON_LINE_ATTEMPTS,
    );

    const runAttempt = (attempt) => {
      this.pendingPomodoroCenterDeferred = null;

      // Prefer the editor that actually received the cursor move. Its CM6 view
      // may lag by a frame right after the completion edits are applied.
      const targetEditorView = getEditorViewFromEditor(editor);
      if (centerEditorViewOnPosition(targetEditorView, line, ch)) {
        return;
      }

      // Give the edited editor a bounded number of frames to attach its view
      // before consulting the passed Markdown view or the editor-level reveal.
      if (!targetEditorView && attempt + 1 < attempts) {
        this.pendingPomodoroCenterDeferred = deferToNextFrame(() =>
          runAttempt(attempt + 1),
        );
        return;
      }

      const viewEditorView = markdownView
        ? getEditorViewFromEditor(markdownView.editor)
        : null;
      if (centerEditorViewOnPosition(viewEditorView, line, ch)) {
        return;
      }

      // Final fallback: the existing editor-level reveal, which prefers the
      // two-argument centered shape before the plain one-argument reveal.
      this.centerEditorLineInView(editor, line, ch, markdownView);
    };

    this.pendingPomodoroCenterDeferred = deferToNextFrame(() => runAttempt(0));
  }

  applyDocumentLineReplacement(editor, oldLines, newLines) {
    if (!editor || typeof editor.replaceRange !== "function") {
      return false;
    }

    const replacement = getLineArrayReplacement(oldLines, newLines);
    if (!replacement) {
      return false;
    }

    const { startLine, removedEndExclusive, lines } = replacement;
    const oldCount = Array.isArray(oldLines) ? oldLines.length : 0;
    const text = lines.join("\n");

    if (removedEndExclusive > startLine) {
      const lastRemoved = removedEndExclusive - 1;
      const lastRemovedText = String(oldLines[lastRemoved] || "");

      if (lines.length > 0) {
        editor.replaceRange(
          text,
          { line: startLine, ch: 0 },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      } else if (removedEndExclusive < oldCount) {
        editor.replaceRange(
          "",
          { line: startLine, ch: 0 },
          { line: removedEndExclusive, ch: 0 },
        );
      } else if (startLine > 0) {
        const previous = startLine - 1;
        editor.replaceRange(
          "",
          { line: previous, ch: String(oldLines[previous] || "").length },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      } else {
        editor.replaceRange(
          "",
          { line: 0, ch: 0 },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      }

      return true;
    }

    if (startLine >= oldCount) {
      if (oldCount === 0) {
        editor.replaceRange(text, { line: 0, ch: 0 });
      } else {
        const last = oldCount - 1;
        editor.replaceRange(`\n${text}`, {
          line: last,
          ch: String(oldLines[last] || "").length,
        });
      }
    } else {
      editor.replaceRange(`${text}\n`, { line: startLine, ch: 0 });
    }

    return true;
  }

  getEditorLineArray(editor) {
    const count = this.getEditorLineCount(editor);
    const lines = [];
    for (let line = 0; line < count; line += 1) {
      lines.push(
        typeof editor.getLine === "function" ? editor.getLine(line) || "" : "",
      );
    }
    return lines;
  }

  setActiveCheckboxStatusLocal(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    editor.replaceRange(
      nextSymbol,
      { line: taskStatus.line, ch: taskStatus.statusStart },
      { line: taskStatus.line, ch: taskStatus.statusEnd },
    );
    return true;
  }

  // Shared Tasks-command write used by Ctrl+Enter (stamp follow-up) and
  // completeTaskAtCursor (never stamps). Returns whether the command ran.
  applyTasksCommandAndMaybeStamp(editor, taskStatus, nextSymbol, options = {}) {
    const stamp = options.stamp !== false;
    const commandId = this.commandIdForSymbol(nextSymbol);
    const beforeLineCount =
      editor && typeof editor.lineCount === "function"
        ? editor.lineCount()
        : null;
    if (
      this.lineMatchesTasksGlobalFilter(taskStatus.lineText) &&
      this.tryExecuteTasksCommand(commandId)
    ) {
      // Plan option (b): the Tasks plugin rewrote the line; stamp freshness
      // in a follow-up edit only when the line still holds the same task
      // with the expected new status. Placement lives in ledger-tools (see
      // above); the stamper refuses closed and recurring lines, so closing
      // never stamps. A recurrence insert or an onCompletion delete changes
      // the line count, so those never stamp a different task.
      if (
        stamp &&
        beforeLineCount !== null &&
        typeof editor.lineCount === "function" &&
        editor.lineCount() === beforeLineCount &&
        getTaskStatusForLine(editor.getLine(taskStatus.line), taskStatus.line)
          ?.symbol === nextSymbol
      ) {
        this.stampFreshnessOnEditorLine(editor, taskStatus.line);
      }
      return true;
    }
    return false;
  }

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

  setActiveCheckboxStatus(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    if (this.applyTasksCommandAndMaybeStamp(editor, taskStatus, nextSymbol)) {
      return true;
    }

    if (this.lineMatchesTasksGlobalFilter(taskStatus.lineText)) {
      return this.setActiveCheckboxStatusLocalWithTaskMetadata(
        editor,
        taskStatus,
        nextSymbol,
      );
    }

    const wrote = this.setActiveCheckboxStatusLocal(
      editor,
      taskStatus,
      nextSymbol,
    );
    if (wrote) {
      this.stampFreshnessOnEditorLine(editor, taskStatus.line);
    }
    return wrote;
  }

  setCheckboxStatusLocalForLine(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    if (this.lineMatchesTasksGlobalFilter(taskStatus.lineText)) {
      return this.setActiveCheckboxStatusLocalWithTaskMetadata(
        editor,
        taskStatus,
        nextSymbol,
      );
    }

    const wrote = this.setActiveCheckboxStatusLocal(
      editor,
      taskStatus,
      nextSymbol,
    );
    if (wrote) {
      this.stampFreshnessOnEditorLine(editor, taskStatus.line);
    }
    return wrote;
  }

  setActiveCheckboxStatusLocalWithTaskMetadata(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    const nextLineText = rewriteTaskLineForLocalFallback(
      taskStatus.lineText,
      nextSymbol,
      this.getCompletionDateString(),
      {
        stampLine: this.getFreshnessStampLine(),
        freshDateText: formatLocalDate(),
      },
    );
    editor.replaceRange(
      nextLineText,
      { line: taskStatus.line, ch: 0 },
      { line: taskStatus.line, ch: taskStatus.lineText.length },
    );
    return true;
  }

  getActiveTaskCheckboxMarkerToggle(editor) {
    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText = editor.getLine(cursor.line);
    const checkboxToggle = getTaskCheckboxMarkerToggle(lineText);
    if (!checkboxToggle) {
      return null;
    }

    return {
      ...checkboxToggle,
      line: cursor.line,
      cursorCh: cursor.ch,
      sourceLineText: lineText,
    };
  }

  getActivePomodoroBulletToggle(editor) {
    if (!editor || typeof editor.getCursor !== "function") {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    return getPomodoroBulletToggle(
      this.getEditorLineArray(editor),
      cursor.line,
    );
  }

  getActiveObsidianTaskToggle(editor) {
    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lines = this.getEditorLineArray(editor);
    return getObsidianTaskToggleDocumentPlan(
      lines,
      cursor.line,
      cursor.ch,
      this.getCreatedDateString(),
    );
  }

  getActivePlainBulletFormatToggle(editor, direction) {
    if (!editor || typeof editor.getCursor !== "function") {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText =
      typeof editor.getLine === "function" ? editor.getLine(cursor.line) : "";
    const toggle = getPlainBulletFormatToggle(lineText, direction);
    if (!toggle) {
      return null;
    }

    return {
      ...toggle,
      line: cursor.line,
      cursorCh: cursor.ch,
    };
  }

  toggleActivePlainBulletFormat(editor, toggle) {
    if (!toggle || !editor || typeof editor.replaceRange !== "function") {
      return false;
    }

    editor.replaceRange(
      toggle.lineText,
      { line: toggle.line, ch: 0 },
      { line: toggle.line, ch: toggle.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: toggle.line,
        ch: getCursorChAfterTextEdits(
          toggle.cursorCh,
          toggle.lineText,
          toggle.edits,
        ),
      });
    }

    return true;
  }

  applyPomodoroBulletToggle(
    editor,
    toggle = this.getActivePomodoroBulletToggle(editor),
  ) {
    if (
      !toggle ||
      !editor ||
      typeof editor.getLine !== "function" ||
      editor.getLine(toggle.line) !== toggle.sourceLineText
    ) {
      return false;
    }

    if (!this.replaceEditorLine(toggle.line, toggle.lineText, editor)) {
      return false;
    }

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: toggle.line,
        ch: toggle.cursorCh,
      });
    }

    return true;
  }

  getActivePomodoroTaskContext(
    editor,
    taskStatus = this.getActiveTaskStatus(editor),
    expectedSymbol = " ",
  ) {
    if (!taskStatus || taskStatus.symbol !== expectedSymbol) {
      return null;
    }

    const lines = this.getEditorLineTexts(editor);
    const section = findPomodorosSectionInLines(lines);
    if (!isPomodoroTaskLine(lines, section, taskStatus.line)) {
      return null;
    }

    return {
      lines,
      section,
      pomodoroLine: taskStatus.line,
      taskStatus,
    };
  }

  getActivePomodoroChildContext(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) {
      return null;
    }

    return getOwningPomodoroContextForLine(
      this.getEditorLineTexts(editor),
      cursor.line,
    );
  }

  async togglePomodoroMoveOnlyRange(editor, activeFile, additionalLines = 0) {
    if (
      !editor ||
      !activeFile ||
      !activeFile.path ||
      typeof editor.getCursor !== "function"
    ) {
      return false;
    }

    const cursor = editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) {
      return false;
    }

    const plan = buildPomodoroMoveOnlyTogglePlan(
      this.getEditorLineTexts(editor),
      cursor.line,
      additionalLines,
    );
    if (!plan.eligible) {
      return false;
    }

    const context = {
      editor,
      activePath: activeFile.path,
      originPath: activeFile.path,
    };
    const acceptedEdits = [];
    for (const edit of plan.edits) {
      if (edit.type === "remove") {
        acceptedEdits.push(edit);
        continue;
      }

      try {
        const resolvedTarget = await this.resolveTranscludedBlockTarget(
          edit.target,
          context,
          {
            linePredicate: isProperObsidianTaskLine,
            taskStatusPredicate: (taskStatus) => !!taskStatus,
          },
        );
        if (resolvedTarget) {
          acceptedEdits.push(edit);
        }
      } catch (error) {
        // Best effort: one stale or unreadable target must not block other
        // eligible lines in the counted range.
      }
    }

    let changed = false;
    try {
      for (const edit of acceptedEdits) {
        if (
          typeof editor.getLine !== "function" ||
          typeof editor.replaceRange !== "function" ||
          editor.getLine(edit.line) !== edit.sourceLineText
        ) {
          continue;
        }
        editor.replaceRange(
          edit.lineText,
          { line: edit.line, ch: 0 },
          { line: edit.line, ch: edit.sourceLineText.length },
        );
        changed = true;
      }
    } finally {
      if (typeof editor.setCursor === "function") {
        editor.setCursor(cursor);
      }
    }

    return changed;
  }

  applyPomodoroCompletionPlan(editor, plan, cursor, markdownView = null) {
    if (!editor || !plan || !Array.isArray(plan.edits)) {
      return false;
    }

    const sortedEdits = plan.edits
      .slice()
      .sort((left, right) => right.line - left.line);

    for (const edit of sortedEdits) {
      if (edit.type === "insertLines") {
        this.insertEditorLines(edit.line, edit.lines, editor);
      } else if (edit.type === "removeLine") {
        this.removeEditorLine(edit.line, editor);
      } else if (edit.type === "replaceLine") {
        this.replaceEditorLine(edit.line, edit.lineText, editor);
      }
    }

    if (cursor && typeof editor.setCursor === "function") {
      const targetLine = Number.isInteger(plan.cursorTargetLine)
        ? plan.cursorTargetLine
        : plan.pomodoroLine;
      const lineText =
        typeof editor.getLine === "function"
          ? editor.getLine(targetLine) || ""
          : "";
      const targetCh = Number.isInteger(plan.cursorTargetLine)
        ? getPomodoroCursorTargetCh(lineText)
        : cursor.ch || 0;
      const clampedTargetCh = Math.min(Math.max(targetCh, 0), lineText.length);
      editor.setCursor({
        line: targetLine,
        ch: clampedTargetCh,
      });
      // Center the cursor target line: the newly created Pomodoro placeholder
      // when one was inserted, otherwise the pre-existing next Pomodoro the
      // cursor jumped to. The center is deferred so it lands after Vim's and
      // Obsidian's trailing cursor-visibility scrolls instead of being clobbered
      // by them. Other toggle paths keep their existing scrolling behavior.
      if (Number.isInteger(plan.cursorTargetLine)) {
        this.scheduleCenterEditorLineInView(
          editor,
          targetLine,
          clampedTargetCh,
          markdownView,
        );
      }
    }

    return true;
  }

  replaceEditorLine(line, lineText, editor) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const currentLineText = editor.getLine(line) || "";
    editor.replaceRange(
      String(lineText || ""),
      { line, ch: 0 },
      { line, ch: currentLineText.length },
    );
    return true;
  }

  removeEditorLine(line, editor) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const lineCount = this.getEditorLineCount(editor);
    if (line < 0 || line >= lineCount) {
      return false;
    }

    if (line < lineCount - 1) {
      editor.replaceRange("", { line, ch: 0 }, { line: line + 1, ch: 0 });
      return true;
    }

    const currentLineText = editor.getLine(line) || "";
    if (line === 0) {
      editor.replaceRange(
        "",
        { line, ch: 0 },
        { line, ch: currentLineText.length },
      );
      return true;
    }

    const previousLineText = editor.getLine(line - 1) || "";
    editor.replaceRange(
      "",
      { line: line - 1, ch: previousLineText.length },
      { line, ch: currentLineText.length },
    );
    return true;
  }

  insertEditorLines(line, lines, editor) {
    const insertedLines = Array.isArray(lines)
      ? lines.map((insertedLine) => String(insertedLine || ""))
      : [];
    if (
      insertedLines.length === 0 ||
      !editor ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const insertText = insertedLines.join("\n");
    const lineCount = this.getEditorLineCount(editor);
    if (lineCount <= 0) {
      editor.replaceRange(insertText, { line: 0, ch: 0 });
      return true;
    }

    if (line >= lineCount) {
      const lastLine = lineCount - 1;
      const lastLineText =
        typeof editor.getLine === "function" ? editor.getLine(lastLine) || "" : "";
      editor.replaceRange(`\n${insertText}`, {
        line: lastLine,
        ch: lastLineText.length,
      });
      return true;
    }

    editor.replaceRange(`${insertText}\n`, { line, ch: 0 });
    return true;
  }

  // Re-derives Blocked-status retirement from the live editor buffer (never
  // from stale coordinates): re-reads `taskLine`, re-runs the single-future-
  // field search, and only then removes the span and, when the task already
  // owns a Schedule Log, inserts the roll-forward entry.
  applyBlockedStatusRetirementInEditor(editor, taskLine) {
    if (!editor) {
      return false;
    }

    const lines = this.getEditorLineTexts(editor);
    const plan = planBlockedStatusRetirement(
      lines,
      taskLine,
      this.getScheduleLogDateString(),
    );
    if (!plan) {
      return false;
    }

    this.replaceEditorLine(taskLine, plan.lineText, editor);
    if (plan.insertion) {
      this.insertEditorLines(plan.insertion.line, [plan.insertion.text], editor);
    }
    return true;
  }

}
