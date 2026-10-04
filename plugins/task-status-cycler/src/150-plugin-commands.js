class TaskStatusCyclerCommandsMixin {
  handleCycleCommand(checking, editor, view, direction) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const taskStatus = this.getActiveTaskStatus(editor);
    if (taskStatus) {
      const nextSymbol = this.getAdjacentSymbol(taskStatus.symbol, direction);
      if (!nextSymbol) {
        return false;
      }

      if (checking) {
        return true;
      }

      const wrote = this.setActiveCheckboxStatus(editor, taskStatus, nextSymbol);
      if (wrote && taskStatus.symbol === BLOCKED_TASK_STATUS_SYMBOL) {
        this.applyBlockedStatusRetirementInEditor(editor, taskStatus.line);
      }
      return true;
    }

    const activeFile =
      view.file ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const activePath = activeFile && activeFile.path;
    // Depends-On lines cycle the prerequisite under the cursor (the plain-link
    // analogue of the transcluded path below) and never reformat the bullet.
    if (this.isActiveTaskDependencyLine(editor)) {
      if (checking) {
        return true;
      }

      const dependencyCandidate =
        this.getActiveTaskDependencyLinkTarget(editor, activePath);
      if (!dependencyCandidate) {
        new Notice("⛓ Put the cursor on a dependency link to cycle it");
        return true;
      }

      const context = {
        editor,
        activePath,
        originPath: activePath,
      };
      void this.cycleResolvedTranscludedTaskLink(
        dependencyCandidate,
        context,
        direction,
      ).catch(() => false);
      return true;
    }
    const candidate = this.getActiveLineTranscludedTaskTarget(editor, activePath);
    if (candidate) {
      if (checking) {
        return true;
      }

      const context = {
        editor,
        activePath,
        originPath: activePath,
      };
      void this.cycleResolvedTranscludedTaskLink(
        candidate,
        context,
        direction,
      ).catch(() => false);
      return true;
    }

    // Fall back to whole-bullet formatting on non-checkbox list items.
    const bulletToggle = this.getActivePlainBulletFormatToggle(editor, direction);
    if (!bulletToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActivePlainBulletFormat(editor, bulletToggle);
  }

  handleOpenChildBulletLineCommand(checking, editor, view, direction) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(editor, view);
    if (!cm) {
      return false;
    }

    if (checking) {
      return true;
    }

    if (direction === "above") {
      this.handleVimOpenChildBulletLineAbove(cm);
    } else {
      this.handleVimOpenChildBulletLineBelow(cm);
    }
    return true;
  }

  handlePomodoroBulletToggleCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const activeFile =
      view.file ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    if (!isDailyNotePath(activeFile && activeFile.path)) {
      return false;
    }

    const toggle = this.getActivePomodoroBulletToggle(editor);
    if (!toggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.applyPomodoroBulletToggle(editor, toggle);
  }

  registerChildBulletInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-insert when both fire for the same keydown.
    this.handledChildBulletEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleChildBulletPhysicalKeydown(event);

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

  handleChildBulletPhysicalKeydown(event) {
    const direction = this.getChildBulletKeydownDirection(event);
    if (!direction) {
      return false;
    }
    return this.dispatchChildBulletEvent(event, direction);
  }

  dispatchChildBulletEvent(event, direction) {
    if (this.handledChildBulletEvents && this.handledChildBulletEvents.has(event)) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(view.editor, view);
    if (!cm) {
      return false;
    }

    if (this.handledChildBulletEvents) {
      this.handledChildBulletEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    if (direction === "above") {
      this.handleVimOpenChildBulletLineAbove(cm);
    } else {
      this.handleVimOpenChildBulletLineBelow(cm);
    }
    return true;
  }

  getChildBulletKeydownDirection(event) {
    // Narrow capture-phase fallback matching the official hotkey binding:
    // exactly Ctrl+Shift+o. Alt/Option and Meta combinations are never ours.
    if (
      !event ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return null;
    }

    const isChildBulletKey =
      event.code === "KeyO" || ["o", "O"].includes(event.key);
    if (!isChildBulletKey) {
      return null;
    }

    // Ctrl+Shift+o opens a child bullet below; there is no shifted "above"
    // variant.
    return "below";
  }

  registerPomodoroBulletToggleInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-toggle when both fire for the same keydown.
    this.handledPomodoroBulletToggleEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handlePomodoroBulletTogglePhysicalKeydown(event);

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

  handlePomodoroBulletTogglePhysicalKeydown(event) {
    if (!getPomodoroBulletToggleKeydown(event)) {
      return false;
    }
    return this.dispatchPomodoroBulletToggleEvent(event);
  }

  dispatchPomodoroBulletToggleEvent(event) {
    if (
      this.handledPomodoroBulletToggleEvents &&
      this.handledPomodoroBulletToggleEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.resolveNormalModeVimCm(view.editor, view)) {
      return false;
    }

    const activeFile =
      view.file ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    if (!isDailyNotePath(activeFile && activeFile.path)) {
      return false;
    }

    const toggle = this.getActivePomodoroBulletToggle(view.editor);
    if (!toggle) {
      return false;
    }

    if (this.handledPomodoroBulletToggleEvents) {
      this.handledPomodoroBulletToggleEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    return this.applyPomodoroBulletToggle(view.editor, toggle);
  }

  registerCountedTaskCycleInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-cycle when both fire for the same keydown.
    this.handledCountedTaskCycleEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleCountedTaskCyclePhysicalKeydown(event);

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

  handleCountedTaskCyclePhysicalKeydown(event) {
    const direction = this.getCountedTaskCycleKeydownDirection(event);
    if (!direction) {
      return false;
    }

    return this.dispatchCountedTaskCycleEvent(event, direction);
  }

  dispatchCountedTaskCycleEvent(event, direction) {
    if (
      this.handledCountedTaskCycleEvents &&
      this.handledCountedTaskCycleEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(view.editor, view);
    if (!cm) {
      return false;
    }

    const pendingRepeat = getPendingVimRepeat(cm);
    if (!pendingRepeat.explicit) {
      return false;
    }

    const activeFile =
      view.file ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const activePath = activeFile && activeFile.path;
    const taskStatus = this.getActiveTaskStatus(view.editor);
    if (taskStatus) {
      if (!isCyclableTaskStatus(taskStatus)) {
        return false;
      }
    } else if (
      !this.isActiveTaskDependencyLine(view.editor) &&
      !this.getActiveLineTranscludedTaskTarget(view.editor, activePath)
    ) {
      return false;
    }

    if (this.handledCountedTaskCycleEvents) {
      this.handledCountedTaskCycleEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    resetPendingVimInputState(cm, "counted-cycle-task-status");
    void this.cycleTaskStatusRange(
      view.editor,
      activeFile,
      direction,
      pendingRepeat.repeat,
    ).catch(() => false);
    return true;
  }

  getCountedTaskCycleKeydownDirection(event) {
    return getOptionBracketTaskCycleDirection(event);
  }

  async cycleTaskStatusRange(editor, activeFile, direction, repeat) {
    if (!editor || typeof editor.getCursor !== "function") {
      return false;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return false;
    }

    const lines = this.getEditorLineTexts(editor);
    const startLine = Math.max(0, Math.floor(Number(cursor.line) || 0));
    const lineCount = this.getEditorLineCount(editor);
    if (lineCount <= 0 || startLine >= lineCount) {
      return false;
    }

    const lastLine = Math.max(0, lineCount - 1);
    const endLine = Math.min(
      startLine + Math.max(0, Math.floor(Number(repeat) || 0)),
      lastLine,
    );
    const activePath = activeFile && activeFile.path;
    const context = activePath
      ? {
          editor,
          activePath,
          originPath: activePath,
        }
      : null;
    const seenResolvedTargets = new Set();
    let changed = false;
    let startDepLineUntargeted = false;

    // Predict, from the pre-write snapshot, every line where cycling out of
    // Blocked will insert a Schedule Log entry. Recorded in snapshot
    // coordinates so editor writes for later lines in the range can be
    // mapped through the resulting offset before any of those insertions
    // actually happen: a task's own entry lands inside its child block,
    // which can sit below a nested child task the loop has not visited yet.
    const todayDateString = this.getScheduleLogDateString();
    const insertionPositions = [];
    for (let line = startLine; line <= endLine; line += 1) {
      const snapshotTaskStatus = getTaskStatusForLine(String(lines[line] || ""), line);
      if (snapshotTaskStatus && snapshotTaskStatus.symbol === BLOCKED_TASK_STATUS_SYMBOL) {
        const plan = planBlockedStatusRetirement(lines, line, todayDateString);
        if (plan && plan.insertion) {
          insertionPositions.push(plan.insertion.line);
        }
      }
    }

    const editorLineFor = (snapshotLine) => {
      let offset = 0;
      for (const position of insertionPositions) {
        if (position <= snapshotLine) {
          offset += 1;
        }
      }
      return snapshotLine + offset;
    };

    for (let line = startLine; line <= endLine; line += 1) {
      const lineText = String(lines[line] || "");
      const taskStatus = getTaskStatusForLine(lineText, line);
      if (taskStatus) {
        if (!isCyclableTaskStatus(taskStatus)) {
          continue;
        }

        const nextSymbol = this.getAdjacentSymbol(taskStatus.symbol, direction);
        if (!nextSymbol) {
          continue;
        }

        let wrote;
        if (line === startLine) {
          const lineCountBeforeWrite = this.getEditorLineCount(editor);
          wrote = this.setActiveCheckboxStatus(editor, taskStatus, nextSymbol);
          const addedLines = Math.max(
            0,
            this.getEditorLineCount(editor) - lineCountBeforeWrite,
          );
          for (let extra = 0; extra < addedLines; extra += 1) {
            insertionPositions.push(startLine + 1);
          }
        } else {
          const mappedTaskStatus = { ...taskStatus, line: editorLineFor(line) };
          wrote = this.setCheckboxStatusLocalForLine(editor, mappedTaskStatus, nextSymbol);
        }

        if (wrote) {
          changed = true;
          if (taskStatus.symbol === BLOCKED_TASK_STATUS_SYMBOL) {
            this.applyBlockedStatusRetirementInEditor(editor, editorLineFor(line));
          }
        }
        continue;
      }

      if (!context) {
        continue;
      }

      // Depends-On lines cycle the prerequisite under the cursor (cursor-ch
      // only on the start line; a lone link is unambiguous elsewhere), with
      // the same resolve-and-cycle worker as transcluded targets.
      const target = isTaskDependencyLine(lineText)
        ? getTaskBlockLinkTargetFromLine(
            lineText,
            activePath,
            editorLineFor(line),
            line === startLine ? cursor.ch : null,
          )
        : getTranscludedTaskTargetFromLine(
            lineText,
            activePath,
            editorLineFor(line),
            line === startLine ? cursor.ch : null,
          );
      if (!target) {
        // As in the single form, a Depends-On start line with the cursor
        // off every link reports instead of silently doing nothing.
        if (line === startLine && isTaskDependencyLine(lineText)) {
          startDepLineUntargeted = true;
        }
        continue;
      }

      let resolvedTarget;
      try {
        resolvedTarget = await this.resolveTranscludedBlockTarget(
          target,
          context,
          {
            taskStatusPredicate: isCyclableTaskStatus,
          },
        );
      } catch (error) {
        continue;
      }
      if (!resolvedTarget || !resolvedTarget.file) {
        continue;
      }

      const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
      if (seenResolvedTargets.has(seenKey)) {
        continue;
      }
      seenResolvedTargets.add(seenKey);

      const wrote = await this.cycleResolvedTranscludedTaskTarget(
        resolvedTarget,
        context,
        direction,
      );
      if (wrote) {
        changed = true;
      }
    }

    if (typeof editor.setCursor === "function") {
      const mappedStartLine = editorLineFor(startLine);
      const cursorLineText =
        typeof editor.getLine === "function" ? editor.getLine(mappedStartLine) || "" : "";
      editor.setCursor({
        line: mappedStartLine,
        ch: Math.max(0, Math.min(cursor.ch || 0, cursorLineText.length)),
      });
    }

    if (!changed && startDepLineUntargeted) {
      new Notice("⛓ Put the cursor on a dependency link to cycle it");
    }

    return changed;
  }

  getFocusedMarkdownEditorView(event) {
    const workspace = this.app && this.app.workspace;
    const view =
      workspace && typeof workspace.getActiveViewOfType === "function"
        ? workspace.getActiveViewOfType(MarkdownView)
        : null;
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

  resolveNormalModeVimCm(editor, view) {
    const editorCm = editor && editor.cm && editor.cm.cm;
    const viewCm =
      view &&
      view.editMode &&
      view.editMode.editor &&
      view.editMode.editor.cm &&
      view.editMode.editor.cm.cm;
    const cm = editorCm || viewCm;
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return null;
    }

    const mode = this.getCurrentVimMode(cm);
    if (["insert", "visual", "visual-block", "visual-line", "replace"].includes(mode)) {
      return null;
    }

    return cm;
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
