class TaskStatusCyclerVimMixin {
  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
    if (!vim) {
      return false;
    }

    vim.defineAction("taskStatusCyclerOpenNextLineLink", (cm, actionArgs) =>
      this.handleVimEnterLinkOrFallthrough(cm, actionArgs),
    );
    vim.defineAction("taskStatusCyclerToggleTaskOpenDone", (cm) =>
      this.handleVimTaskToggleOpenDone(cm),
    );
    vim.defineAction("taskStatusCyclerToggleOpenDone", (cm) =>
      this.handleVimTaskToggleOpenDone(cm),
    );
    vim.defineAction("taskStatusCyclerToggleCheckboxMarker", () =>
      this.handleVimToggleCheckboxMarker(),
    );
    vim.defineAction("taskStatusCyclerToggleObsidianTask", () =>
      this.handleVimToggleObsidianTask(),
    );
    vim.defineAction("taskStatusCyclerOpenLineBelow", (cm) =>
      this.handleVimOpenLineBelow(cm),
    );
    vim.defineAction("taskStatusCyclerOpenLineAbove", (cm) =>
      this.handleVimOpenLineAbove(cm),
    );
    vim.defineAction("taskStatusCyclerOpenPreviousLineLink", (cm, actionArgs) =>
      this.handleVimBackspaceLinkOrFallthrough(cm, actionArgs),
    );
    vim.defineAction("taskStatusCyclerTogglePomodoroMoveOnly", (cm, actionArgs) =>
      this.handleVimTogglePomodoroMoveOnly(cm, actionArgs),
    );
    vim.mapCommand("<CR>", "action", "taskStatusCyclerOpenNextLineLink", {}, {
      context: "normal",
    });
    for (const key of ["<C-CR>", "<C-Enter>"]) {
      vim.mapCommand(key, "action", "taskStatusCyclerToggleTaskOpenDone", {}, {
        context: "normal",
      });
    }
    vim.mapCommand("<C-]>", "action", "taskStatusCyclerToggleCheckboxMarker", {}, {
      context: "normal",
    });
    for (const key of ["<C-}>", "<C-S-]>"]) {
      vim.mapCommand(key, "action", "taskStatusCyclerToggleObsidianTask", {}, {
        context: "normal",
      });
    }
    vim.mapCommand(
      "<BS>",
      "action",
      "taskStatusCyclerOpenPreviousLineLink",
      {},
      { context: "normal" },
    );
    vim.mapCommand("o", "action", "taskStatusCyclerOpenLineBelow", {}, {
      context: "normal",
    });
    vim.mapCommand("O", "action", "taskStatusCyclerOpenLineAbove", {}, {
      context: "normal",
    });
    vim.mapCommand("#", "action", "taskStatusCyclerTogglePomodoroMoveOnly", {}, {
      context: "normal",
    });
    this.registerVimNavigationMappings(vim);

    this.vimMappingsRegistered = true;
    return true;
  }

  registerVimNavigationMappings(vim) {
    vim.defineAction("taskStatusCyclerHalfPageDownSkipQueries", (cm) =>
      this.handleVimHalfPageSkipQueries(cm, 1),
    );
    vim.defineAction("taskStatusCyclerHalfPageUpSkipQueries", (cm) =>
      this.handleVimHalfPageSkipQueries(cm, -1),
    );

    vim.mapCommand(
      "<C-d>",
      "action",
      "taskStatusCyclerHalfPageDownSkipQueries",
      {},
      { context: "normal" },
    );
    vim.mapCommand(
      "<C-u>",
      "action",
      "taskStatusCyclerHalfPageUpSkipQueries",
      {},
      { context: "normal" },
    );
  }

  handleVimEnterLinkOrFallthrough(cm, actionArgs) {
    const repeat = getVimRepeat(actionArgs);
    if (this.handleVimEnterLinkAction(cm, actionArgs)) {
      return;
    }

    this.vimEnterFallthrough(cm, repeat);
  }

  handleVimTogglePomodoroMoveOnly(_cm, actionArgs) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    const activeFile = view.file || this.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }

    const additionalLines = getPomodoroMoveOnlyAdditionalLines(actionArgs);
    void this.togglePomodoroMoveOnlyRange(
      view.editor,
      activeFile,
      additionalLines,
    ).catch(() => false);
  }

  handleVimTaskToggleOpenDone() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    if (this.claimReviewWalkCtrlEnter(view.editor)) {
      return;
    }

    // Nav api v3 review-walk auto-advance: after the checklist claim
    // declines, capture before the ordinary close. A busy origin swallows
    // the key with no write (double-press safety); a null origin behaves
    // exactly as today.
    const walk = this.getReviewWalkApi();
    let reviewOrigin = null;
    if (walk) {
      try {
        reviewOrigin = walk.capture(view.editor);
      } catch (error) {
        reviewOrigin = null;
      }
      if (reviewOrigin && reviewOrigin.busy) {
        return;
      }
    }
    const settleReviewOrigin = (outcome) => {
      this.continueReviewWalkSilently(walk, reviewOrigin, outcome);
    };

    const taskStatus = this.getActiveTaskStatus(view.editor);
    const activeFile = view.file || this.app.workspace.getActiveFile();
    const openPomodoroContext =
      activeFile && taskStatus && taskStatus.symbol === " "
        ? this.getActivePomodoroTaskContext(view.editor, taskStatus)
        : null;
    if (openPomodoroContext) {
      settleReviewOrigin(null);
      void this.completeActivePomodoroTask(
        view.editor,
        activeFile,
        openPomodoroContext,
        view,
      ).catch(() => false);
      return;
    }

    const donePomodoroContext =
      activeFile && taskStatus && isTranscludedReopenableStatus(taskStatus)
        ? this.getActivePomodoroTaskContext(view.editor, taskStatus, "x")
        : null;
    if (donePomodoroContext) {
      settleReviewOrigin(null);
      void this.reopenActivePomodoroTask(
        view.editor,
        activeFile,
        donePomodoroContext,
      ).catch(() => false);
      return;
    }

    const owningPomodoroContext = activeFile
      ? this.getActivePomodoroChildContext(view.editor)
      : null;
    if (
      owningPomodoroContext &&
      owningPomodoroContext.taskStatus.symbol === " "
    ) {
      const selectedBlockLink = this.getActiveLineTaskBlockLinkTarget(
        view.editor,
        activeFile.path,
      );
      if (selectedBlockLink) {
        // A selected Task Link that resolves to an Open/Next/In Progress/Done
        // task is handled as a Task Link and never completes the owning
        // Pomodoro: embedded targets close recursively, plain targets close
        // root-only, and Done targets reopen root-only. A plain link that does
        // not resolve to a task falls back to Pomodoro completion; an embedded
        // link that does not resolve keeps the keypress consumed as a no-op.
        settleReviewOrigin(null);
        void this.handleActiveTaskBlockLinkOpenDone(view.editor, activeFile)
          .then((result) => {
            if (result && result.resolved) return true;
            if (selectedBlockLink.embedded) return false;
            const context = this.getActivePomodoroChildContext(view.editor);
            return context && context.taskStatus.symbol === " "
              ? this.completeActivePomodoroTask(view.editor, activeFile, context, view)
              : false;
          })
          .catch(() => false);
        return;
      }

      settleReviewOrigin(null);
      void this.completeActivePomodoroTask(
        view.editor,
        activeFile,
        owningPomodoroContext,
        view,
      ).catch(() => false);
      return;
    }

    if (this.isOpenDoneTaskStatus(taskStatus)) {
      if (reviewOrigin) {
        // `closing` is read before the write; the chained toggle already
        // awaits transclusion propagation and finalizeClosedTasks, so the
        // walk continues only after both ran. A rejected toggle settles
        // with null so the gesture lock is always released. The successor
        // text composes into `outcome.notice` after the Done line and no
        // card is shown, keeping the gesture's single walk toast.
        const closing = isTranscludedCompletionClosableStatus(taskStatus);
        const successorNoticeBox = {};
        void this.toggleActiveCheckboxOpenDoneAndPropagate(
          view.editor,
          activeFile,
          taskStatus,
          { successorNoticeTarget: "return", successorNoticeBox },
        ).then(
          (wrote) =>
            settleReviewOrigin(
              wrote === true && closing
                ? {
                  kind: "complete",
                  ...(successorNoticeBox.text
                    ? { notice: successorNoticeBox.text }
                    : {}),
                }
                : null,
            ),
          () => settleReviewOrigin(null),
        );
        return;
      }
      void this.toggleActiveCheckboxOpenDoneAndPropagate(
        view.editor,
        activeFile,
        taskStatus,
      ).catch(() => false);
      return;
    }

    // Outside an open Pomodoro's child range, resolve a selected task block
    // link once and choose the established reopen or close path from its status.
    settleReviewOrigin(null);
    void this.handleActiveTaskBlockLinkOpenDone(
      view.editor,
      activeFile,
    ).then(() => false).catch(() => false);
  }

  handleVimToggleCheckboxMarker() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    this.toggleActiveCheckboxMarker(view.editor);
  }

  handleVimToggleObsidianTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    this.toggleActiveObsidianTask(view.editor, undefined, view);
  }

  handleVimBackspaceLinkOrFallthrough(cm, actionArgs) {
    const repeat = getVimRepeat(actionArgs);
    if (this.handleVimBackspaceLinkAction(cm, actionArgs)) {
      return;
    }

    this.vimBackspaceFallthrough(cm, repeat);
  }

  handleVimEnterLinkAction(cm, actionArgs) {
    const navigationPlugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["bob-navigation-hotkeys"];
    if (
      !navigationPlugin ||
      typeof navigationPlugin.handleVimEnterLinkAction !== "function"
    ) {
      return false;
    }

    try {
      return navigationPlugin.handleVimEnterLinkAction(cm, actionArgs) === true;
    } catch (error) {
      return false;
    }
  }

  handleVimBackspaceLinkAction(cm, actionArgs) {
    const navigationPlugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["bob-navigation-hotkeys"];
    if (
      !navigationPlugin ||
      typeof navigationPlugin.handleVimBackspaceLinkAction !== "function"
    ) {
      return false;
    }

    try {
      return (
        navigationPlugin.handleVimBackspaceLinkAction(cm, actionArgs) === true
      );
    } catch (error) {
      return false;
    }
  }

  handleVimHalfPageSkipQueries(cm, direction) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    const lineCount = this.getHalfPageLineCount(cm);
    const rawTargetLine = this.clampLine(
      cursor.line + direction * lineCount,
      firstLine,
      lastLine,
    );
    const queryBlocks = this.findQueryCodeBlocks(cm);
    if (
      this.handleRenderedTasksQueryHalfPageScroll(cm, direction, {
        cursor,
        firstLine,
        lastLine,
        queryBlocks,
        rawTargetLine,
      })
    ) {
      return;
    }

    const targetLine = this.findNearestNonQueryLine(
      queryBlocks,
      rawTargetLine,
      direction,
      firstLine,
      lastLine,
    );
    const lineText =
      typeof cm.getLine === "function" ? cm.getLine(targetLine) || "" : "";
    const targetCh = Math.min(Math.max(cursor.ch || 0, 0), lineText.length);

    cm.setCursor(targetLine, targetCh);
    if (typeof cm.scrollIntoView === "function") {
      cm.scrollIntoView({ line: targetLine, ch: targetCh });
    }
  }

  handleRenderedTasksQueryHalfPageScroll(cm, direction, context) {
    const editorView = getEditorViewFromEditor(cm);
    const scrollDOM = editorView && editorView.scrollDOM;
    if (!editorView || !scrollDOM) {
      return false;
    }

    const renderedQuery = this.findActiveRenderedTasksQuery(
      editorView,
      scrollDOM,
      direction,
    );
    if (!renderedQuery) {
      return false;
    }

    const sourceCrossesQuery = this.sourceMovementCrossesQueryBlock(
      context.queryBlocks,
      context.cursor.line,
      context.rawTargetLine,
    );
    const nearDistance =
      finiteNumberOrNull(scrollDOM.clientHeight) || DEFAULT_HALF_PAGE_LINES;
    const renderedQueryIsNear =
      renderedQuery.intersectionHeight > 0 ||
      renderedQuery.distance <= nearDistance ||
      sourceCrossesQuery;
    if (!renderedQueryIsNear) {
      return false;
    }

    const scrollPlan = getRenderedTasksQueryScrollPlan(
      scrollDOM,
      renderedQuery.rect,
      renderedQuery.viewportRect,
      direction,
    );
    if (!scrollPlan) {
      return false;
    }

    this.repairCursorOutsideQueryFence(
      cm,
      context.queryBlocks,
      context.cursor,
      direction,
      context.firstLine,
      context.lastLine,
    );
    this.applyRenderedTasksQueryScroll(scrollDOM, scrollPlan.targetScrollTop);
    return true;
  }

  findActiveRenderedTasksQuery(editorView, scrollDOM, direction) {
    const viewportRect = getElementRect(scrollDOM);
    if (!viewportRect) {
      return null;
    }

    const contexts = this.findRenderedTasksQueryContexts(
      editorView,
      viewportRect,
    );
    if (contexts.length === 0) {
      return null;
    }

    const normalizedDirection = direction >= 0 ? 1 : -1;
    const visible = [];
    let nearest = null;

    for (const context of contexts) {
      const intersectionHeight = getVerticalIntersectionHeight(
        context.rect,
        viewportRect,
      );
      if (intersectionHeight > 0) {
        visible.push({ ...context, intersectionHeight, distance: 0 });
        continue;
      }

      let distance = null;
      if (normalizedDirection > 0 && context.rect.top >= viewportRect.bottom) {
        distance = context.rect.top - viewportRect.bottom;
      } else if (
        normalizedDirection < 0 &&
        context.rect.bottom <= viewportRect.top
      ) {
        distance = viewportRect.top - context.rect.bottom;
      }

      if (distance === null) {
        continue;
      }

      const candidate = { ...context, intersectionHeight: 0, distance };
      if (!nearest || candidate.distance < nearest.distance) {
        nearest = candidate;
      }
    }

    if (visible.length > 0) {
      visible.sort((left, right) => {
        const intersectionDelta =
          right.intersectionHeight - left.intersectionHeight;
        if (intersectionDelta !== 0) {
          return intersectionDelta;
        }

        return normalizedDirection > 0
          ? left.rect.top - right.rect.top
          : right.rect.bottom - left.rect.bottom;
      });
      return visible[0];
    }

    return nearest;
  }

  findRenderedTasksQueryContexts(editorView, viewportRect) {
    const root = editorView && editorView.dom;
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    let resultLists;
    try {
      resultLists = Array.from(root.querySelectorAll(TASKS_QUERY_RESULT_SELECTOR));
    } catch (error) {
      return [];
    }

    const seenContainers = new Set();
    const contexts = [];
    for (const resultList of resultLists) {
      let container = resultList;
      try {
        if (resultList && typeof resultList.closest === "function") {
          container = resultList.closest(TASKS_BLOCK_SELECTOR) || resultList;
        }
      } catch (error) {
        container = resultList;
      }

      if (!container || seenContainers.has(container)) {
        continue;
      }
      seenContainers.add(container);

      const rect = getElementRect(container);
      if (!rect) {
        continue;
      }

      contexts.push({
        element: container,
        resultList,
        rect,
        viewportRect,
      });
    }

    return contexts;
  }

  sourceMovementCrossesQueryBlock(blocks, startLine, endLine) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return false;
    }

    const fromLine = Math.min(startLine, endLine);
    const toLine = Math.max(startLine, endLine);
    return blocks.some(
      (block) => block.endLine >= fromLine && block.startLine <= toLine,
    );
  }

  repairCursorOutsideQueryFence(
    cm,
    blocks,
    cursor,
    direction,
    firstLine,
    lastLine,
  ) {
    if (!cursor || typeof cursor.line !== "number") {
      return false;
    }

    const block = this.findQueryCodeBlockAtLine(blocks, cursor.line);
    if (!block) {
      return false;
    }

    const targetLine = this.getQueryFenceParkingLine(
      blocks,
      block,
      direction,
      firstLine,
      lastLine,
    );
    if (targetLine === null) {
      return false;
    }

    const targetCh = this.getCodeMirrorLineClampedCh(cm, targetLine, cursor.ch);
    return this.setCodeMirrorCursor(cm, targetLine, targetCh);
  }

  getQueryFenceParkingLine(blocks, block, direction, firstLine, lastLine) {
    const candidates =
      direction >= 0
        ? [block.startLine - 1, block.endLine + 1]
        : [block.endLine + 1, block.startLine - 1];

    for (const candidate of candidates) {
      if (
        candidate >= firstLine &&
        candidate <= lastLine &&
        !this.lineIsInsideAnyQueryCodeBlock(blocks, candidate)
      ) {
        return candidate;
      }
    }

    const fallback = this.findNearestNonQueryLine(
      blocks,
      direction >= 0 ? block.startLine : block.endLine,
      direction,
      firstLine,
      lastLine,
    );
    if (
      fallback === null ||
      this.lineIsInsideAnyQueryCodeBlock(blocks, fallback)
    ) {
      return null;
    }

    return fallback;
  }

  getCodeMirrorLineClampedCh(cm, line, ch) {
    const lineText =
      cm && typeof cm.getLine === "function" ? cm.getLine(line) || "" : "";
    return Math.min(Math.max(Math.floor(Number(ch) || 0), 0), lineText.length);
  }

  setCodeMirrorCursor(cm, line, ch) {
    if (!cm || typeof cm.setCursor !== "function") {
      return false;
    }

    try {
      cm.setCursor(line, ch);
      return true;
    } catch (error) {
      // Fall through to the object-shaped Obsidian editor API below.
    }

    try {
      cm.setCursor({ line, ch });
      return true;
    } catch (error) {
      return false;
    }
  }

  applyRenderedTasksQueryScroll(scrollDOM, scrollTop) {
    cancelDeferred(this.pendingRenderedTasksScrollDeferred);
    this.setScrollDOMScrollTop(scrollDOM, scrollTop);
    this.pendingRenderedTasksScrollDeferred = deferToNextFrame(() => {
      this.pendingRenderedTasksScrollDeferred = null;
      this.setScrollDOMScrollTop(scrollDOM, scrollTop);
    });
  }

  setScrollDOMScrollTop(scrollDOM, scrollTop) {
    if (!scrollDOM) {
      return false;
    }

    const targetScrollTop = clampNumber(
      scrollTop,
      0,
      getScrollDOMMaxScrollTop(scrollDOM),
    );
    const scrollLeft = finiteNumberOrNull(scrollDOM.scrollLeft) || 0;

    if (typeof scrollDOM.scrollTo === "function") {
      try {
        scrollDOM.scrollTo({ top: targetScrollTop, left: scrollLeft });
        return true;
      } catch (error) {
        // Fall through to direct assignment.
      }
    }

    try {
      scrollDOM.scrollTop = targetScrollTop;
      return true;
    } catch (error) {
      return false;
    }
  }

  handleVimOpenLineBelow(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const continuationPrefix = getOpenLineBelowPrefix(lineText);
    const targetLine = cursor.line + 1;
    const targetCh = continuationPrefix.length;

    cm.replaceRange("\n" + continuationPrefix, {
      line: cursor.line,
      ch: lineText.length,
    });
    cm.setCursor(targetLine, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenLineAbove(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const continuationPrefix = getOpenLineBelowPrefix(lineText);
    const targetCh = continuationPrefix.length;

    cm.replaceRange(continuationPrefix + "\n", {
      line: cursor.line,
      ch: 0,
    });
    cm.setCursor(cursor.line, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenChildBulletLineBelow(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const childPrefix = getChildBulletOpenLinePrefix(lineText);
    const targetLine = cursor.line + 1;
    const targetCh = childPrefix.length;

    cm.replaceRange("\n" + childPrefix, {
      line: cursor.line,
      ch: lineText.length,
    });
    cm.setCursor(targetLine, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenChildBulletLineAbove(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const childPrefix = getChildBulletOpenLinePrefix(lineText);
    const targetCh = childPrefix.length;

    cm.replaceRange(childPrefix + "\n", {
      line: cursor.line,
      ch: 0,
    });
    cm.setCursor(cursor.line, targetCh);
    this.enterVimInsertMode(cm);
  }

  enterVimInsertMode(cm) {
    const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
    if (vim && typeof vim.handleKey === "function") {
      vim.handleKey(cm, "i", "mapping");
    }
  }

  vimEnterFallthrough(cm, repeat = 1) {
    this.vimLineOffsetFallthrough(cm, 1, repeat);
  }

  vimBackspaceFallthrough(cm, repeat = 1) {
    this.vimLineOffsetFallthrough(cm, -1, repeat);
  }

  vimLineOffsetFallthrough(cm, direction, repeat = 1) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    const repeatCount = normalizeVimRepeat(repeat);
    const offsetDirection = direction < 0 ? -1 : 1;
    const targetLine = this.clampLine(
      cursor.line + offsetDirection * repeatCount,
      firstLine,
      lastLine,
    );
    const lineText =
      typeof cm.getLine === "function" ? cm.getLine(targetLine) || "" : "";
    const firstNonBlank = lineText.search(/\S/);
    const col = firstNonBlank === -1 ? 0 : firstNonBlank;
    cm.setCursor(targetLine, col);
  }

}
