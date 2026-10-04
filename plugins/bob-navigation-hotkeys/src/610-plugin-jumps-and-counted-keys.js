class BobNavigationHotkeysJumpKeyMixin {


  async deleteBulletPropertyValue(cm, cursor, name, options = {}) {
    const writeContext = this.getInlinePropertyWriteContext(
      cm,
      cursor,
      options,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    const lineText = writeContext.line;
    const propertyName = normalizeBulletPropertyName(name);
    if (propertyName === "dependsOn") {
      return this.deleteDependencyLineAndField(cm, cursor, options, writeContext);
    }
    const shouldRecover =
      propertyName === "scheduled" &&
      !isProjectLifecycleTaskLine(lineText);
    let recovery = null;
    if (shouldRecover) {
      const recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        writeContext.filePath,
        writeContext.content,
        [cursor.line],
        new Date(),
      );
      recovery = recoveryByLine.get(cursor.line);
      const guarded = this.getInlinePropertyWriteContext(cm, cursor, options);
      if (
        !guarded.valid ||
        guarded.content !== writeContext.content ||
        guarded.line !== lineText
      ) {
        new Notice(
          guarded.valid
            ? "Current task changed; bullet property was not deleted"
            : guarded.error.replace("updated", "deleted"),
        );
        return null;
      }
    }

    const result = deleteBulletProperty(lineText, name);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return null;
    }

    if (result.reason === "not-found") {
      new Notice(`${name} is not set on this bullet`);
      setEditorCursorSafely(
        cm,
        cursor.line,
        Math.min(Math.max(cursor.ch, 0), lineText.length),
      );
      return { deleted: false, line: lineText };
    }

    let nextLine = result.line;
    let recoveryOutcome = null;
    if (shouldRecover) {
      const reconciliation = reconcileBlockedScheduledTaskLine(
        nextLine,
        recovery,
      );
      nextLine = reconciliation.line;
      recoveryOutcome = reconciliation.outcome;
    }

    // Freshness is the last transformation of the task line (nav-stamps).
    if (nextLine !== lineText) {
      const deleteStamper = this.getFreshnessStampLine();
      if (typeof deleteStamper === "function") {
        nextLine = applyFreshStampLine(nextLine, deleteStamper, this.getFreshnessDateText());
      }
    }

    if (
      nextLine !== lineText &&
      !replaceEditorLine(cm, cursor.line, lineText, nextLine)
    ) {
      new Notice("Could not delete bullet property");
      return null;
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), nextLine.length),
    );
    new Notice(
      `${name} ✗ removed${scheduledRecoveryNoticeSuffix({
        ready: recoveryOutcome === "ready" ? 1 : 0,
        next: recoveryOutcome === "next" ? 1 : 0,
        inProgress: recoveryOutcome === "in-progress" ? 1 : 0,
        stillBlocked: recoveryOutcome === "still-blocked" ? 1 : 0,
        deferred: recoveryOutcome === "deferred" ? 1 : 0,
      })}`,
    );
    return { deleted: true, line: nextLine };
  }

  insertBlankLine(cm, direction) {
    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }

    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const insertAbove = direction === "above";
    const replacementText = insertAbove ? `\n${lineText}` : `${lineText}\n`;
    if (!replaceEditorLine(cm, cursor.line, lineText, replacementText)) {
      return false;
    }

    setEditorCursorSafely(
      cm,
      insertAbove ? cursor.line + 1 : cursor.line,
      cursor.ch,
    );

    return true;
  }

  jumpToSectionHeader(editor, direction) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const targetLine = getSectionHeaderJumpLine(
      String(editor.getValue()).split(/\r?\n/),
      cursor.line,
      direction,
    );

    if (targetLine === null) {
      new Notice(
        direction < 0 ? "No previous section header" : "No next section header",
      );
      return false;
    }

    if (!setEditorCursor(editor, { line: targetLine, ch: 0 })) {
      new Notice("No active markdown editor");
      return false;
    }

    scrollEditorLineToTop(editor, targetLine);
    return true;
  }

  // Reorder an open Pomodoro entry under the cursor in place of a jump. Future
  // placeholders can reorder among one another, and the current timed entry can
  // swap with future placeholders while keeping the time range in the current
  // slot. `repeat` is an exact Vim count (default 1): N positions in one
  // transaction, or a refusal with no mutation. Returns `false` when the cursor
  // is not on a reorderable entry, so the caller falls through to the jump;
  // returns `true` when handled (moved, or refused with a notice) so the caller
  // must not jump.
  movePomodoroEntry(editor, direction, repeat = 1) {
    if (!editor || typeof editor.getValue !== "function") {
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      return false;
    }

    const sourceContent = String(editor.getValue() || "");
    const context = findPomodoroEntryContext(sourceContent, cursor.line);
    if (!isMovablePomodoroEntryContext(context)) {
      return false;
    }

    const sourceRawLine = splitMarkdownContent(sourceContent).lines[cursor.line];
    const plan = planPomodoroEntryReorder(sourceContent, {
      sourceEntryLine: cursor.line,
      sourceRawLine,
      direction,
      repeat: normalizeVimRepeat(repeat),
    });

    if (!plan.valid) {
      new Notice(plan.error);
      return true;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const finalCursor = {
      line: plan.movedEntryLine,
      ch: Math.min(cursor.ch, String(afterLines[plan.movedEntryLine] || "").length),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        editor,
        sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(editor.getValue() || "") === plan.after;
    }
    if (!applied || String(editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro move failed; nothing was moved");
      return true;
    }

    const label = getPomodoroBulletMoveDestinationLabel(plan.entry);
    const directionWord = direction < 0 ? "up" : "down";
    new Notice(
      plan.repeat > 1
        ? `Moved ${label} ${directionWord} ${plan.repeat} positions`
        : `Moved ${label} ${directionWord}`,
    );
    return true;
  }

  jumpToOpenObsidianTask(editor, direction, repeat) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    // A single physical Ctrl+Shift+J/K can reach this method twice in the same
    // dispatch turn: once via the Obsidian hotkeys.json command and once via the
    // Vim-normal capture fallback. Suppress the duplicate so a no-target press
    // shows only one notice or move (a successful jump never moves twice, and a
    // Pomodoro entry reorder never reorders twice). Count resolution happens
    // after this mark so a suppressed duplicate never consumes Vim input state.
    // The mark is keyed by editor and direction, not repeat, and clears on the
    // next macrotask so deliberate repeats and key repeat still work.
    if (this.isOpenTaskJumpDispatchPending(editor, direction)) {
      return false;
    }
    this.markOpenTaskJumpDispatch(editor, direction);

    const normalizedRepeat =
      repeat === undefined || repeat === null
        ? this.consumePendingOpenTaskJumpRepeat(editor)
        : normalizeVimRepeat(repeat);

    if (this.movePomodoroEntry(editor, direction, normalizedRepeat)) {
      return true;
    }

    const targetLine = getOpenObsidianTaskJumpLine(
      String(editor.getValue()).split(/\r?\n/),
      cursor.line,
      direction,
      normalizedRepeat,
    );

    if (targetLine === null) {
      new Notice(direction < 0 ? "No previous open task" : "No next open task");
      return false;
    }

    if (!setEditorCursor(editor, { line: targetLine, ch: 0 })) {
      new Notice("No active markdown editor");
      return false;
    }

    // Vim `zz`-style: center the jumped-to task line instead of top-aligning it.
    // Deferred one frame so it survives any trailing Vim cursor-visibility
    // scroll in the same keydown turn.
    scheduleOpenTaskJumpCenter(this, editor, targetLine, 0);
    return true;
  }

  // The Obsidian hotkeys.json command route reaches jumpToOpenObsidianTask
  // without a repeat and, in the live app, wins the race against the
  // capture-phase fallback, so reading the count only in the fallback loses
  // it. Resolve and consume it here so whichever route arrives first sees the
  // still-pending count.
  consumePendingOpenTaskJumpRepeat(editor) {
    const activeView =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.getActiveMarkdownView()
        : null;
    const view = activeView && activeView.editor === editor ? activeView : null;

    if (!this.isVimNormalModeEditor(editor, view)) {
      return 1;
    }

    const cm = this.resolveVimCodeMirror(editor, view);
    const pending = getPendingVimRepeat(cm);
    if (!pending.explicit) {
      return 1;
    }
    resetPendingVimInputState(cm, "counted-open-task-jump");
    return normalizeVimRepeat(pending.repeat);
  }

  // Lazily-created WeakMap from editor object to the set of jump directions
  // already dispatched in the current macrotask. Keyed by editor so distinct
  // panes never deduplicate against each other, and weak so closed editors are
  // collected without manual cleanup.
  getOpenTaskJumpDispatchGuard() {
    if (!this.openTaskJumpDispatchGuard) {
      this.openTaskJumpDispatchGuard = new WeakMap();
    }
    return this.openTaskJumpDispatchGuard;
  }

  isOpenTaskJumpDispatchPending(editor, direction) {
    if (!editor || typeof editor !== "object") {
      return false;
    }
    const directions = this.getOpenTaskJumpDispatchGuard().get(editor);
    return !!directions && directions.has(direction);
  }

  markOpenTaskJumpDispatch(editor, direction) {
    if (!editor || typeof editor !== "object") {
      return;
    }
    const guard = this.getOpenTaskJumpDispatchGuard();
    let directions = guard.get(editor);
    if (!directions) {
      directions = new Set();
      guard.set(editor, directions);
    }
    directions.add(direction);
    const timeoutId = setTimeout(() => {
      const current = guard.get(editor);
      if (!current) {
        return;
      }
      current.delete(direction);
      if (current.size === 0) {
        guard.delete(editor);
      }
    }, 0);
    this.register(() => clearTimeout(timeoutId));
  }

  // Capture-phase fallback so Ctrl+Shift+J/K reach the counted open-task jump
  // / Pomodoro entry move route while Vim normal mode is active. CodeMirror
  // Vim swallows these chords before Obsidian's hotkey dispatcher runs, so the
  // hotkeys.json bindings only cover insert mode and non-Vim editing. A pending
  // numeric Vim prefix is an ordinary repeat (N positions / Nth target), not
  // "N additional items". The shared jump route also resolves a count when the
  // Obsidian command path arrives with no repeat (and in the live app wins this
  // race), so this fallback's reset is sometimes redundant and still correct
  // when it wins or when Obsidian's binding is absent. This mirrors
  // task-status-cycler's Ctrl+Shift+O handling and intentionally avoids a
  // `<C-S-j>`/`<C-S-k>` vim nmap, which could collapse onto and overwrite the
  // existing `<C-j>`/`<C-k>` section-header maps.
  registerOpenTaskJumpInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-fire when both run for the same keydown.
    this.handledOpenTaskJumpEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleOpenTaskJumpPhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerClearSearchHighlightInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-run nohlsearch for the same keydown.
    this.handledClearSearchHighlightEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleClearSearchHighlightKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerCountedTransclusionToggleInputListeners() {
    this.handledCountedTransclusionToggleEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleCountedTransclusionTogglePhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerCountedBulletPropertyInputListeners() {
    this.handledCountedBulletPropertyEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleCountedBulletPropertyPhysicalKeydown(event);
    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerCountedTaskMoveInputListeners() {
    this.handledCountedTaskMoveEvents = new WeakSet();
    const keydownHandler = (event) =>
      this.handleCountedTaskMovePhysicalKeydown(event);
    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleCountedTaskMovePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedTaskMoveKeydown(event)) {
      return false;
    }
    if (
      this.handledCountedTaskMoveEvents &&
      this.handledCountedTaskMoveEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledCountedTaskMoveEvents) {
      this.handledCountedTaskMoveEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-task-move");
    this.openTaskMoveOrPomodoroBulletPicker(view.editor, view, {
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    });
    return true;
  }

  isCountedTaskMoveKeydown(event) {
    return Boolean(
      event &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "KeyM" || event.key === "m" || event.key === "M"),
    );
  }

  handleCountedBulletPropertyPhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedBulletPropertyKeydown(event)) {
      return false;
    }
    if (
      this.handledCountedBulletPropertyEvents &&
      this.handledCountedBulletPropertyEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (!pendingRepeat.explicit) {
      return false;
    }

    if (this.handledCountedBulletPropertyEvents) {
      this.handledCountedBulletPropertyEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-bullet-property");
    return this.openBulletPropertyPicker(view.editor, {
      countExplicit: true,
      additionalTaskCount: pendingRepeat.repeat,
    });
  }

  isCountedBulletPropertyKeydown(event) {
    return Boolean(
      event &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "KeyP" || event.key === "p" || event.key === "P"),
    );
  }

  // Capture-phase fallback so counted N<Alt+N> reaches the lane toggle while
  // Vim normal mode is active. CodeMirror Vim swallows Alt chords before
  // Obsidian's hotkey dispatcher runs, so the hotkeys.json binding only
  // covers insert mode and non-Vim editing. Follows the Ctrl+Shift+M pattern:
  // a pending numeric prefix becomes N additional tasks, and the Vim input
  // state is reset before toggling.
  registerCountedLaneToggleInputListeners() {
    this.handledCountedLaneToggleEvents = new WeakSet();
    const keydownHandler = (event) =>
      this.handleCountedLaneTogglePhysicalKeydown(event);
    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleCountedLaneTogglePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedLaneToggleKeydown(event)) {
      return false;
    }
    if (
      this.handledCountedLaneToggleEvents &&
      this.handledCountedLaneToggleEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledCountedLaneToggleEvents) {
      this.handledCountedLaneToggleEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-lane-toggle");
    void this.toggleTaskLane(view.editor, {
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    }).catch(() => false);
    return true;
  }

  isCountedLaneToggleKeydown(event) {
    return Boolean(
      event &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.altKey &&
      !event.metaKey &&
      (event.code === "KeyN" || event.key === "n" || event.key === "N"),
    );
  }

  handleCountedTransclusionTogglePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedTransclusionToggleKeydown(event)) {
      return false;
    }

    if (
      this.handledCountedTransclusionToggleEvents &&
      this.handledCountedTransclusionToggleEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);

    const cursor = getEditorCursor(view.editor);
    if (!cursor) {
      return false;
    }

    const activeLineText = getEditorLine(view.editor, cursor.line);
    if (
      activeLineText === null ||
      findTransclusionToggleTargets(activeLineText).length === 0
    ) {
      return false;
    }

    if (this.handledCountedTransclusionToggleEvents) {
      this.handledCountedTransclusionToggleEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    resetPendingVimInputState(
      cm,
      pendingRepeat.explicit
        ? "counted-transclusion-toggle"
        : "transclusion-toggle",
    );
    return pendingRepeat.explicit
      ? this.toggleCountedLineTransclusions(
          view.editor,
          cursor,
          pendingRepeat.repeat,
        )
      : this.toggleCurrentLineTransclusions(view.editor);
  }

  isCountedTransclusionToggleKeydown(event) {
    return (
      !!event &&
      event.key === "!" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    );
  }

  handleClearSearchHighlightKeydown(event) {
    if (!this.isClearSearchHighlightEscapeKeydown(event)) {
      return false;
    }

    if (
      this.handledClearSearchHighlightEvents &&
      this.handledClearSearchHighlightEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    const vim =
      typeof window !== "undefined" &&
      window.CodeMirrorAdapter &&
      window.CodeMirrorAdapter.Vim;
    if (!cm || !vim || typeof vim.handleEx !== "function") {
      return false;
    }

    if (this.handledClearSearchHighlightEvents) {
      this.handledClearSearchHighlightEvents.add(event);
    }

    vim.handleEx(cm, "nohlsearch");
    return false;
  }

  handleOpenTaskJumpPhysicalKeydown(event) {
    const direction = this.getOpenTaskJumpKeydownDirection(event);
    if (!direction) {
      return false;
    }

    if (
      this.handledOpenTaskJumpEvents &&
      this.handledOpenTaskJumpEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    // Only intercept in Vim normal mode. Insert/visual/replace mode and a
    // disabled Vim setting fall through so Obsidian's hotkeys.json bindings
    // handle the chord instead, without consuming a pending Vim count.
    if (!this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    // Still read, reset, and pass an explicit repeat. The shared route also
    // resolves a count for the command path; this reset is then a no-op on
    // already-cleared state, and is still required when this fallback wins.
    const pendingRepeat = getPendingVimRepeat(cm);

    if (this.handledOpenTaskJumpEvents) {
      this.handledOpenTaskJumpEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    resetPendingVimInputState(
      cm,
      pendingRepeat.explicit ? "counted-open-task-jump" : "open-task-jump",
    );
    this.jumpToOpenObsidianTask(
      view.editor,
      direction,
      pendingRepeat.repeat,
    );
    return true;
  }

  isClearSearchHighlightEscapeKeydown(event) {
    if (!event) {
      return false;
    }

    if (event.key === "Escape" || event.key === "Esc") {
      return true;
    }

    // CodeMirror Vim treats Ctrl+[ as <Esc>, but Chromium reports the raw
    // bracket chord to this capture-phase listener before Vim translates it.
    return (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "BracketLeft" || event.key === "[")
    );
  }

  getOpenTaskJumpKeydownDirection(event) {
    // Narrow capture-phase fallback matching the hotkeys.json bindings: exactly
    // Ctrl+Shift+J/K. Alt/Option and Meta combinations are never ours.
    if (
      !event ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return null;
    }

    if (event.code === "KeyJ" || ["j", "J"].includes(event.key)) {
      return 1;
    }

    if (event.code === "KeyK" || ["k", "K"].includes(event.key)) {
      return -1;
    }

    return null;
  }

  getFocusedMarkdownEditorView(event) {
    const view = this.getActiveMarkdownView();
    if (!(view instanceof MarkdownView) || !this.isEditorEventTarget(event, view)) {
      return null;
    }

    return view;
  }

  isEditorEventTarget(event, view) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    const editorEl = target.closest(".cm-editor");
    if (!editorEl) {
      return false;
    }

    const containerEl = view && view.containerEl;
    return (
      !containerEl ||
      typeof containerEl.contains !== "function" ||
      containerEl.contains(editorEl)
    );
  }

  isVimNormalModeEditor(editor, view) {
    const cm = this.resolveVimCodeMirror(editor, view);
    if (!cm || typeof cm.getCursor !== "function") {
      return false;
    }

    const mode = this.getCurrentVimMode(cm);
    if (!(cm.state && cm.state.vim) && mode === null) {
      return false;
    }
    return !["insert", "visual", "visual-block", "visual-line", "replace"].includes(
      mode,
    );
  }

  resolveVimCodeMirror(editor, view) {
    const cm =
      (editor && editor.cm && editor.cm.cm) ||
      (view &&
        view.editMode &&
        view.editMode.editor &&
        view.editMode.editor.cm &&
        view.editMode.editor.cm.cm);
    return cm && typeof cm.getCursor === "function" ? cm : null;
  }

  getCurrentVimMode(cm) {
    const vimState = cm && cm.state && cm.state.vim;
    if (vimState) {
      if (vimState.insertMode === true) {
        return "insert";
      }
      if (vimState.visualMode === true) {
        return "visual";
      }
      if (vimState.replaceMode === true) {
        return "replace";
      }
      if (typeof vimState.mode === "string") {
        return vimState.mode;
      }
    }

    const vimrcSupport =
      this.app &&
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["obsidian-vimrc-support"];
    return vimrcSupport && typeof vimrcSupport.currentVimStatus === "string"
      ? vimrcSupport.currentVimStatus
      : null;
  }
}
