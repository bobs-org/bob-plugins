class BobLedgerToolsVimSnippetsMixin {
  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    const vim = codeMirrorAdapter && codeMirrorAdapter.Vim;
    if (!vim) {
      return false;
    }

    vim.defineAction("bobLedgerJumpToCurrentPomodoro", (cm) =>
      this.jumpToCurrentPomodoro(cm),
    );
    vim.defineAction("bobLedgerAddPomodoroUnit", (cm, actionArgs) =>
      this.changePomodoroUnits(cm, this.getVimRepeat(actionArgs)),
    );
    vim.defineAction("bobLedgerSubtractPomodoroUnit", (cm, actionArgs) =>
      this.changePomodoroUnits(cm, -this.getVimRepeat(actionArgs)),
    );
    vim.defineAction("bobLedgerMovePomodoroLater", (cm, actionArgs) =>
      this.offsetPomodoroRange(cm, this.getVimRepeat(actionArgs) * STEP_MINUTES),
    );
    vim.defineAction("bobLedgerMovePomodoroEarlier", (cm, actionArgs) =>
      this.offsetPomodoroRange(cm, -this.getVimRepeat(actionArgs) * STEP_MINUTES),
    );

    vim.mapCommand("\\p", "action", "bobLedgerAddPomodoroUnit", {}, {
      context: "normal",
    });
    vim.mapCommand("\\P", "action", "bobLedgerSubtractPomodoroUnit", {}, {
      context: "normal",
    });
    vim.mapCommand("\\o", "action", "bobLedgerMovePomodoroLater", {}, {
      context: "normal",
    });
    vim.mapCommand("\\O", "action", "bobLedgerMovePomodoroEarlier", {}, {
      context: "normal",
    });

    this.vimMappingsRegistered = true;
    return true;
  }

  getVimRepeat(actionArgs) {
    const repeat = actionArgs && actionArgs.repeat;
    const parsedRepeat = Number(repeat);

    if (!Number.isFinite(parsedRepeat) || parsedRepeat < 1) {
      return 1;
    }

    return Math.floor(parsedRepeat);
  }

  jumpToCurrentPomodoro(cm) {
    this.dailyNavigationActionId =
      Math.floor(numericOrDefault(this.dailyNavigationActionId, 0)) + 1;
    const actionId = this.dailyNavigationActionId;
    const lines = getEditorLines(cm);
    if (!lines) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getJumpPomodoroTarget(lines);
    if (!target) {
      return this.openDailyFallbackOnly(error, actionId);
    }

    return this.jumpToPomodoroTarget(cm, target);
  }

  jumpToPomodoroTarget(cm, target) {
    this.cancelPendingDailyLocationRestore();
    if (!setEditorCursor(cm, target.line, 0, { scroll: false })) {
      return false;
    }
    focusEditor(cm);

    // Center *after* the Vim command cycle finishes. codemirror-vim dispatches
    // its own "nearest" cursor-visibility scroll as it finalizes the keystroke;
    // centering synchronously here would be clobbered by that trailing scroll.
    // Deferring one frame lets our centered scroll be the last word.
    this.scheduleCenterOnLine(cm, target.line);

    return true;
  }

  async openDailyFallbackOnly(error, actionId) {
    if (isTodayDailyFile(this.app, getActiveFile(this.app))) {
      new Notice(error || "No active Pomodoro line found");
      return false;
    }

    const dailyPath = this.currentDailyPath();
    // Snapshot before opening: activating a fresh daily editor can emit capture
    // events for its initial top-of-file state before the open promise resolves.
    const rememberedLocation = this.getRememberedDailyLocation(dailyPath);
    const result = await openTodayDailyNoteWithState(this.app);
    if (actionId !== this.dailyNavigationActionId) {
      return !!result;
    }
    if (!result || !result.view || !result.view.editor) {
      new Notice("Could not open daily note");
      return false;
    }

    if (!sameVaultPath(result.path, dailyPath)) {
      new Notice("Could not open daily note");
      return false;
    }

    focusEditor(result.view.editor);
    this.refreshDailyScrollCaptureTarget(result.view);
    if (!result.reusedOpenLeaf && rememberedLocation) {
      this.restoreOrDeferDailyLocation(dailyPath, rememberedLocation);
    } else {
      this.captureDailyLocationFromView(result.view);
    }
    return true;
  }

  scheduleCenterOnLine(cm, line, options = {}) {
    cancelDeferred(this.pendingCenterDeferred);
    const attempts = Math.max(
      1,
      Math.floor(numericOrDefault(options.attempts, CENTER_ON_LINE_ATTEMPTS)),
    );

    const runAttempt = (attempt) => {
      this.pendingCenterDeferred = null;

      // Prefer the editor that actually received the cursor move (vim adapter for
      // local jumps, the daily Editor for the fallback). Its CM6 view may lag by
      // a frame right after a daily tab is activated.
      const targetEditorView = getEditorViewFromEditor(cm);
      if (centerEditorViewOnPosition(targetEditorView, line, 0)) {
        return;
      }

      // Give the jumped editor a bounded number of frames to attach its view
      // before consulting the (possibly stale) active Markdown view.
      if (!targetEditorView && attempt + 1 < attempts) {
        this.pendingCenterDeferred = deferToNextFrame(() =>
          runAttempt(attempt + 1),
        );
        return;
      }

      // Fallback: center the active Markdown view if reachable; only if no view
      // can be centered do we issue the CM5 "nearest" scroll on the handed
      // editor. A successful center is always the last word — never clobbered.
      if (centerEditorViewOnPosition(getActiveEditorView(this.app), line, 0)) {
        return;
      }
      scrollEditorIntoView(cm, line, 0);
    };

    this.pendingCenterDeferred = deferToNextFrame(() => runAttempt(0));
  }

  changePomodoroUnits(cm, units) {
    const lines = getEditorLines(cm);
    const cursorLine = getEditorCursorLine(cm);
    if (!lines || cursorLine === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getEditPomodoroTarget(lines, cursorLine, true);
    if (!target || !target.entry.range) {
      new Notice(error || "No Pomodoro line with a time range found");
      return false;
    }

    const newLineText = changePomodoroLineUnits(target.lineText, units);
    if (newLineText === null) {
      new Notice("No Pomodoro line with a time range found");
      return false;
    }

    return replaceEditorLine(cm, target.line, target.lineText, newLineText);
  }

  offsetPomodoroRange(cm, minutes) {
    return this.rewritePomodoroRange(cm, (range) => ({
      startMinutes: addMinutes(range.startMinutes, minutes),
      endMinutes: addMinutes(range.endMinutes, minutes),
    }));
  }

  rewritePomodoroRange(cm, buildRange) {
    const lines = getEditorLines(cm);
    const cursorLine = getEditorCursorLine(cm);
    if (!lines || cursorLine === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getEditPomodoroTarget(lines, cursorLine, true);
    if (!target || !target.entry.range) {
      new Notice(error || "No Pomodoro line with a time range found");
      return false;
    }

    const nextRange = buildRange(target.entry.range);
    const newLineText = replaceTimeRange(
      target.lineText,
      target.entry.range,
      nextRange.startMinutes,
      nextRange.endMinutes,
    );

    if (newLineText === null) {
      new Notice("No Pomodoro line with a time range found");
      return false;
    }

    return replaceEditorLine(cm, target.line, target.lineText, newLineText);
  }

  expandFromActiveEditor(cmView) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!(view instanceof MarkdownView) || !view.editor) {
      return false;
    }

    return this.expandFromEditor(view.editor, cmView);
  }

  expandFromEditor(editor, cmView = null) {
    if (!this.hasSingleCursor(editor, cmView)) {
      return false;
    }

    const expansion = this.findEditorExpansion(editor);
    if (!expansion) {
      return false;
    }

    editor.replaceRange(
      expansion.replacement,
      { line: expansion.line, ch: expansion.fromCh },
      { line: expansion.line, ch: expansion.toCh },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: expansion.line,
        ch: expansionCursorCh(expansion),
      });
    }

    return true;
  }

  hasSingleCursor(editor, cmView) {
    if (editor && typeof editor.listSelections === "function") {
      const selections = editor.listSelections();

      if (!Array.isArray(selections) || selections.length !== 1) {
        return false;
      }

      const selection = selections[0];
      return sameEditorPosition(selection.anchor, selection.head);
    }

    return isCollapsedCodeMirrorSelection(cmView);
  }

  findEditorExpansion(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (
      !cursor ||
      !Number.isInteger(cursor.line) ||
      !Number.isInteger(cursor.ch)
    ) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const expansion = findExpansion(line, cursor.ch);

    return expansion ? { ...expansion, line: cursor.line } : null;
  }
}
