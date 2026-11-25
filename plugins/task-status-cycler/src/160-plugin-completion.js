class TaskStatusCyclerCompletionMixin {
  // Nav `api.taskLinkLane` v1 for the Pomodoro Task Link lane toggle (plan
  // 202610/in_progress_task_link_marks.md §7): the frozen
  // `{ matches, toggle }` pair, or null when nav is missing, old, or
  // malformed. Never throws.
  getTaskLinkLaneApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-navigation-hotkeys"];
      const api = holder && holder.api;
      if (!api) {
        return null;
      }
      const lane = api.taskLinkLane;
      if (!lane || !(Number(lane.version) >= 1)) {
        return null;
      }
      if (
        typeof lane.matches !== "function" ||
        typeof lane.toggle !== "function"
      ) {
        return null;
      }
      return lane;
    } catch (error) {
      return null;
    }
  }
  // True when the cursor line is a Pomodoro Task Link line per nav's
  // `api.taskLinkLane.matches`, the single definition both plugins share.
  // Never throws; false when the api is missing or the editor has no cursor.
  isTaskLinkLaneLine(editor, activePath) {
    try {
      const lane = this.getTaskLinkLaneApi();
      if (!lane) {
        return false;
      }
      if (
        !editor ||
        typeof editor.getValue !== "function" ||
        typeof editor.getCursor !== "function"
      ) {
        return false;
      }
      const cursor = editor.getCursor();
      if (!cursor || typeof cursor.line !== "number") {
        return false;
      }
      return lane.matches({
        content: String(editor.getValue() || ""),
        line: cursor.line,
        path: activePath,
      }) === true;
    } catch (error) {
      return false;
    }
  }

  // Nav api v3 `reviewWalk` for the review-walk auto-advance: the frozen
  // `{ capture, continue }` pair, or null when nav is missing, old, or
  // malformed. Never throws.
  getReviewWalkApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-navigation-hotkeys"];
      const api = holder && holder.api;
      if (!api || !(Number(api.version) >= 3)) {
        return null;
      }
      const walk = api.reviewWalk;
      if (!walk || !(Number(walk.version) >= 1)) {
        return null;
      }
      if (
        typeof walk.capture !== "function" ||
        typeof walk.continue !== "function"
      ) {
        return null;
      }
      return walk;
    } catch (error) {
      return null;
    }
  }

  // Settle one captured walk origin without ever throwing. `capture` and
  // `continue` never throw per the nav api v3 contract, but a stale mock
  // must not break the toggle.
  continueReviewWalkSilently(walk, origin, outcome) {
    try {
      if (!walk || !origin) {
        return;
      }
      const result = walk.continue(origin, outcome);
      if (result && typeof result.catch === "function") {
        result.catch(() => undefined);
      }
    } catch (error) {
      // Best effort: the toggle already landed.
    }
  }

  // Nav api v2 may claim Ctrl+Enter only on the current PRE/POST walk
  // landing (D2); ordinary task toggles remain owned by this plugin.
  claimReviewWalkCtrlEnter(editor) {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-navigation-hotkeys"];
      const api = holder && holder.api;
      if (
        !api ||
        !(Number(api.version) >= 2) ||
        typeof api.claimReviewWalkCompletion !== "function"
      ) {
        return false;
      }
      const result = api.claimReviewWalkCompletion(editor);
      if (!result || typeof result.then !== "function") {
        return false;
      }
      void result.catch(() => false);
      return true;
    } catch (error) {
      return false;
    }
  }

  handleToggleOpenDoneCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    // Bank rows: waiting Ctrl+Enter claims the Category card; otherwise
    // the only write is a space/x flip with no task metadata.
    const openDoneFile = view.file ||
      (this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const openDoneBank = this.cyclerBankInfoAtCursor(editor, openDoneFile && openDoneFile.path);
    if (openDoneBank) {
      if (checking) {
        return true;
      }
      this.cyclerBankHandleOpenDone(editor, view, openDoneBank);
      return true;
    }
    if (this.cyclerReqGuardRefuse(editor, "ctrl-enter", checking)) return true;
    const taskStatus = this.getActiveTaskStatus(editor);
    if (!this.isOpenDoneTaskStatus(taskStatus)) {
      return false;
    }

    if (checking) {
      return true;
    }

    const activeFile = view.file || this.app.workspace.getActiveFile();
    void this.toggleActiveCheckboxOpenDoneAndPropagate(
      editor,
      activeFile,
      taskStatus,
      { openingKeys: ["Control", "Enter"] },
    ).catch(() => false);
    return true;
  }

  handleToggleCheckboxMarkerCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    if (this.cyclerBankInfoAtCursor(editor, (view.file && view.file.path) || this.cyclerBankActivePath())) {
      if (!checking) {
        new Notice(CYCLER_BANK_ROW_NOTICE);
      }
      return true;
    }
    if (this.cyclerReqToggleRoute(editor, checking)) return true;
    const checkboxToggle = this.getActiveTaskCheckboxMarkerToggle(editor);
    if (!checkboxToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActiveCheckboxMarker(editor, checkboxToggle);
  }

  handleToggleObsidianTaskCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    if (this.cyclerBankInfoAtCursor(editor, (view.file && view.file.path) || this.cyclerBankActivePath())) {
      if (!checking) {
        new Notice(CYCLER_BANK_ROW_NOTICE);
      }
      return true;
    }
    if (this.cyclerReqGuardRefuse(editor, "lane", checking)) return true;
    const obsidianTaskToggle = this.getActiveObsidianTaskToggle(editor);
    if (!obsidianTaskToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    const additional = this.consumePendingObsidianTaskToggleCount(editor, view);
    return this.toggleActiveObsidianTask(
      editor,
      this.getActiveObsidianTaskToggle(editor, additional),
      view,
    );
  }

  consumePendingObsidianTaskToggleCount(editor, view) {
    // A hotkeys.json binding wins the keydown before CodeMirror Vim sees the
    // chord. Consume its pending count here so it is neither dropped nor
    // leaked into the next Vim command (as with nav's Ctrl+Shift+J/K).
    const cm = this.resolveNormalModeVimCm(editor, view);
    if (!cm) {
      return 0;
    }
    const pending = getPendingVimRepeat(cm);
    if (!pending.explicit) {
      return 0;
    }
    resetPendingVimInputState(cm, "counted-toggle-obsidian-task");
    return pending.repeat;
  }

  // Cross-plugin Done line rewrite (api v3): return a guarded result so
  // complete-label writers cannot turn a closed or recurring task into Done.
  completeTaskLineText(lineText, options = {}) {
    const line = String(lineText || "");
    try {
      // Bank rows never become Done through the completion path: the
      // open/done toggle owns the only bank-row write.
      const completionPath = (options && typeof options.path === "string" && options.path) ||
        this.cyclerBankActivePath();
      if (cyclerBankLineKind(completionPath, line) !== null) {
        return Object.freeze({ ok: false, reason: "bank-row", lineText: line });
      }
      const status = getTaskStatusForLine(line, 0);
      if (!status) {
        return Object.freeze({ ok: false, reason: "not_completable", lineText: line });
      }
      if (![" ", "*", "/", "?"].includes(status.symbol)) {
        return Object.freeze({ ok: true, unchanged: true, lineText: line });
      }
      if (isRecurringTaskLine(line)) {
        return Object.freeze({ ok: false, reason: "recurring", lineText: line });
      }
      const date =
        options && typeof options.date === "string" && options.date
          ? options.date
          : this.getCompletionDateString();
      return Object.freeze({
        ok: true,
        unchanged: false,
        lineText: rewriteTaskLineAsDone(line, date),
      });
    } catch (error) {
      return Object.freeze({ ok: false, reason: "not_completable", lineText: line });
    }
  }
  toggleActiveCheckboxOpenDone(editor, taskStatus = this.getActiveTaskStatus(editor)) {
    if (!this.isOpenDoneTaskStatus(taskStatus)) {
      return false;
    }

    return this.setActiveCheckboxStatus(
      editor,
      taskStatus,
      getNextOpenDoneSymbol(taskStatus),
    );
  }

  // Cross-plugin close for checklist rows always goes through Tasks so recurrence fires.
  async completeTaskAtCursor(editor, options = {}) {
    const taskStatus =
      editor && typeof editor.getCursor === "function"
        ? this.getActiveTaskStatus(editor)
        : null;
    if (taskStatus && this.cyclerBankInfoAtCursor(editor)) {
      return { ok: false, reason: "bank-row" };
    }
    if (taskStatus && this.cyclerReqInfoAtCursor(editor)) return { ok: false, reason: "requirement" };
    if (
      !taskStatus ||
      !this.lineMatchesTasksGlobalFilter(taskStatus.lineText)
    ) {
      return { ok: false, reason: "not-task" };
    }
    if (!COMPLETE_AT_CURSOR_OPEN_SYMBOLS.has(taskStatus.symbol)) {
      return { ok: false, reason: "not-open" };
    }

    const commandId = this.commandIdForSymbol("x");
    if (
      !this.app ||
      !this.app.commands ||
      !this.app.commands.commands ||
      !this.app.commands.commands[commandId]
    ) {
      return { ok: false, reason: "tasks-command-missing" };
    }

    const activeFile =
      this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null;
    const activePath = activeFile && activeFile.path;
    const identity = closedTaskIdentity(activePath, taskStatus.lineText);
    const reqCloseOwners = this.captureReqCloseOwnersAtEditorLine(
      editor, activePath, taskStatus.line, taskStatus.lineText,
    );
    const mail = await this.confirmCyclerMailCloseForEditorClose(
      editor, activePath, taskStatus, "x", options,
    );
    if (!mail || mail.confirmed !== true) {
      return { ok: false, reason: "mail-close-kept" };
    }
    const closeSettleIdentity = this.closeSettleSnapshotForTaskStatus(taskStatus);
    const beforeLineCount = this.getEditorLineCount(editor);

    if (
      !this.applyTasksCommandAndMaybeStamp(editor, taskStatus, "x", {
        stamp: false,
        settlePolicy: "immediate",
      })
    ) {
      return { ok: false, reason: "not-closed" };
    }

    const lineDelta = this.getEditorLineCount(editor) - beforeLineCount;
    const verifiedClose = this.verifyClosedTaskAfterTasksWrite(
      editor,
      taskStatus.line,
      lineDelta,
    );
    if (!verifiedClose) {
      return { ok: false, reason: "not-closed" };
    }

    // Full-note settle before successor finalization: future recurring
    // spawns and group/badge moves land in one post-Tasks apply. The
    // reported lineDelta stays about the Tasks rewrite itself.
    if (closeSettleIdentity) {
      const closeSettleResult = this.settleCloseInActiveEditor(
        editor,
        activePath,
        closeSettleIdentity,
      );
      if (closeSettleResult && closeSettleResult.applied) {
        this.locateSettledClosedTask(editor, {
          blockId: closeSettleIdentity.blockId || null,
          closedText: verifiedClose.text,
          hintLine: verifiedClose.line,
        });
      }
    }

    // Successor notice is returned, never shown here: nav's walk caller
    // appends it to the walk toast it already shows.
    if (identity || reqCloseOwners.length > 0) {
      const active = options && typeof options === "object" ? options : {};
      const finalizeContext = { editor, activePath, successorNoticeTarget: "return" };
      if (active.successorJumpTarget === "return") {
        finalizeContext.successorJumpTarget = "return";
        if (active.successorJumpBox && typeof active.successorJumpBox === "object") {
          finalizeContext.successorJumpBox = active.successorJumpBox;
        }
      }
      const finalized = await this.finalizeClosedTasks(identity ? [identity] : [], {
        ...finalizeContext,
        reqCloseOwners,
      });
      return {
        ok: true,
        lineDelta,
        successorNotice: finalized && finalized.successorNotice
          ? String(finalized.successorNotice)
          : null,
        ...(finalized && finalized.jump ? { jump: finalized.jump } : {}),
      };
    }
    return { ok: true, lineDelta, successorNotice: null };
  }

  async toggleActiveTranscludedTaskOpenDone(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    const candidate = this.getActiveLineTranscludedTaskTarget(editor, activePath);
    if (!candidate) {
      return false;
    }

    // Direct single-line toggle: the active note is both the link-resolution
    // origin and the active editor buffer, and this path stays non-recursive.
    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    const resolvedTarget = await this.resolveTranscludedBlockTarget(
      candidate,
      context,
    );
    if (!resolvedTarget) {
      return false;
    }

    const closing = isTranscludedCompletionClosableStatus(
      resolvedTarget.taskStatus,
    );
    if (closing) {
      const mail = await this.confirmCyclerMailCloseForResolvedClose(resolvedTarget, context, "x");
      if (!mail || mail.confirmed !== true) return false;
    }

    if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      const result = await this.reopenResolvedTranscludedTaskTarget(
        resolvedTarget,
        context,
      );
      if (result.changed) {
        // `cycler_polish`: a Ctrl+Enter reopen takes back this pass's
        // untouched successor links.
        try {
          await this.consumeSuccessorReopenReceipt(
            [{
              path: resolvedTarget.file.path,
              blockId: resolvedTarget.blockId,
            }],
            context,
          );
        } catch (error) {
          // Best effort: the reopen already landed.
        }
      }
      return result.changed;
    }

    const identity = this.reqCloseIdentityForResolvedTarget(resolvedTarget);
    const reqCloseOwners = closing
      ? this.captureReqCloseOwnersForResolvedTarget(resolvedTarget, context)
      : [];
    const singleSettleIdentity = closing
      ? this.snapshotTaskSettleIdentity(
        resolvedTarget.taskStatus.lineText,
        resolvedTarget.line,
        { blockId: resolvedTarget.blockId },
      )
      : null;
    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
      null,
      { settlePolicy: closing ? "immediate" : "none" },
    );
    if (wrote && closing) {
      if (
        singleSettleIdentity &&
        this.fileMatchesPath(resolvedTarget.file, activePath)
      ) {
        this.settleCloseInActiveEditor(editor, activePath, singleSettleIdentity);
      }
      await this.finalizeClosedTasks([identity], { ...context, reqCloseOwners });
    }
    return wrote;
  }

  // Toggle the local checkbox, propagate to an embedded block transclusion, and
  // finalize both identities in one batch. Capture the embed before the write.
  async toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    activeFile,
    taskStatus,
    options = {},
  ) {
    const activePath = activeFile && activeFile.path;
    // Bank rows close and reopen as plain checkbox bytes only: no
    // transclusion resolution, successor pass, or reference recovery.
    const propagateBank = this.cyclerBankInfoAtCursor(editor, activePath);
    if (propagateBank) {
      return this.cyclerBankLocalFlip(editor, propagateBank);
    }
    if (this.cyclerReqInfoAtCursor(editor)) return false;
    const cursor =
      typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const isFenced =
      cursor && typeof cursor.line === "number"
        ? getFencedLineNumbers(this.getEditorLineTexts(editor)).has(cursor.line)
        : false;
    const transclusionCandidate = isFenced
      ? null
      : this.getActiveLineTranscludedTaskTarget(editor, activePath);

    const closing = isTranscludedCompletionClosableStatus(taskStatus);
    const localIdentity = closedTaskIdentity(activePath, taskStatus.lineText);
    const reqCloseOwners = closing
      ? this.captureReqCloseOwnersAtEditorLine(editor, activePath, taskStatus.line, taskStatus.lineText)
      : [];

    if (closing) {
      const localTarget = this.cyclerMailCloseTargetFromEditor(
        editor, activePath, taskStatus, getNextOpenDoneSymbol(taskStatus),
      );
      const decision = cyclerMailCloseSyncDecision(this, localTarget ? [localTarget] : []);
      if (decision.kind === "block") {
        cyclerMailCloseNoticeFail();
        return false;
      }
      if (decision.kind === "ask" || decision.kind === "classify" || transclusionCandidate) {
        const mail = await this.confirmCyclerMailCloseForCheckbox(
          editor, activePath, taskStatus, transclusionCandidate, options,
        );
        if (!mail || mail.confirmed !== true) return false;
      }
    }

    const propagateSettleIdentity = closing
      ? this.closeSettleSnapshotForTaskStatus(taskStatus)
      : null;
    const wrote = this.toggleActiveCheckboxOpenDone(editor, taskStatus);
    if (!wrote) {
      return false;
    }

    const targetIdentity = await this.closeOrReopenTranscludedTaskLine(
      transclusionCandidate,
      editor,
      activePath,
      closing,
      reqCloseOwners,
      options,
    );
    // Settle the active note after local and same-note transcluded writes,
    // before successor finalization and walk continuation. Successor and
    // walk focus resolve last and win over the generic settle cursor.
    if (closing && wrote && editor && activePath && propagateSettleIdentity) {
      this.settleCloseInActiveEditor(editor, activePath, propagateSettleIdentity);
    }
    const identities = [localIdentity, targetIdentity].filter(Boolean);
    if (identities.length || (closing && reqCloseOwners.length > 0)) {
      // Walk landings pass `successorNoticeTarget: "return"` with a
      // `successorNoticeBox`: the text is composed into `outcome.notice`
      // and no card is shown, keeping the gesture's single walk toast.
      const context = { editor, activePath, reqCloseOwners };
      if (
        options && options.successorNoticeTarget === "return"
      ) {
        context.successorNoticeTarget = "return";
        if (options.successorNoticeBox && typeof options.successorNoticeBox === "object") {
          context.successorNoticeBox = options.successorNoticeBox;
        }
      }
      if (options && options.successorJumpTarget === "return") {
        context.successorJumpTarget = "return";
        if (options.successorJumpBox && typeof options.successorJumpBox === "object") {
          context.successorJumpBox = options.successorJumpBox;
        }
      }
      if (closing) {
        const finalized = await this.finalizeClosedTasks(identities, context);
        if (
          options && options.successorNoticeBox &&
          typeof options.successorNoticeBox === "object" &&
          finalized && finalized.successors && Array.isArray(finalized.successors.resolved)
        ) {
          options.successorNoticeBox.excludeRefs = finalized.successors.resolved.slice();
        }
        if (
          options && options.successorNoticeBox &&
          typeof options.successorNoticeBox === "object" &&
          finalized && finalized.successorNotice
        ) {
          options.successorNoticeBox.text = String(finalized.successorNotice);
        }
      } else {
        await this.restoreReopenedTaskReferences(identities, context);
        // `cycler_polish`: `[x]` → open on the task line takes back this
        // pass's untouched successor links the same day.
        if (identities.length > 0) {
          try {
            await this.consumeSuccessorReopenReceipt(identities, context);
          } catch (error) {
            // Best effort: the reopen already landed.
          }
        }
      }
    }
    return true;
  }

  // Force-close or force-reopen an already-selected embedded block
  // transclusion candidate against the local line's own open/done direction
  // (`closing`), independent of the target's current status beyond whether
  // that status is eligible to be forced. Returns the target's closed-task
  // identity when a write actually landed, `null` otherwise (no candidate,
  // unresolvable target, or target ineligible for the forced direction).
  async closeOrReopenTranscludedTaskLine(candidate, editor, activePath, closing, reqCloseOwners = [], options = {}) {
    if (!candidate) {
      return null;
    }

    const context = {
      editor,
      activePath,
      originPath: activePath,
      ...(options && typeof options.mailCloseConfirmed === "string"
        ? { mailCloseConfirmed: options.mailCloseConfirmed }
        : {}),
    };
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(candidate, context, {
        taskStatusPredicate: isOpenDoneTaskStatus,
      });
    } catch (error) {
      return null;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return null;
    }

    let wrote = false;
    if (closing) {
      if (isTranscludedCompletionClosableStatus(resolvedTarget.taskStatus)) {
        reqCloseOwners.push(...this.captureReqCloseOwnersForResolvedTarget(resolvedTarget, context));
        wrote = await this.replaceResolvedTranscludedTaskLine(
          resolvedTarget,
          context,
          "x",
          { settlePolicy: "immediate" },
        );
      }
    } else if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        " ",
        { forcedStatusPredicate: isTranscludedReopenableStatus, settlePolicy: "none" },
      );
    }
    if (!wrote) {
      return null;
    }

    return (
      closedTaskIdentity(resolvedTarget.file.path, resolvedTarget.taskStatus.lineText) ||
      { path: resolvedTarget.file.path, blockId: resolvedTarget.blockId }
    );
  }

  async reopenTranscludedTaskTarget(candidate, context) {
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        candidate,
        context,
        { taskStatusPredicate: isTranscludedReopenableStatus },
      );
    } catch (error) {
      return { resolved: false, changed: false };
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return { resolved: false, changed: false };
    }

    return this.reopenResolvedTranscludedTaskTarget(resolvedTarget, context);
  }

  async reopenResolvedTranscludedTaskTarget(resolvedTarget, context) {
    if (!resolvedTarget || !resolvedTarget.file) {
      return { resolved: false, changed: false };
    }
    if (!isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      return { resolved: true, changed: false };
    }
    if (isDoneArchivePath(resolvedTarget.file.path)) {
      return this.reopenArchivedTranscludedTaskTarget(resolvedTarget, context);
    }

    const changed = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
      " ",
      { forcedStatusPredicate: isTranscludedReopenableStatus },
    );
    if (changed) {
      await this.restoreReopenedTaskReferences(
        [{ path: resolvedTarget.file.path, blockId: resolvedTarget.blockId }],
        context,
      );
    }
    return { resolved: true, changed };
  }

  async cycleResolvedTranscludedTaskLink(candidate, context, direction) {
    if (!candidate || !context || !context.activePath) {
      return false;
    }

    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        candidate,
        context,
        {
          taskStatusPredicate: isCyclableTaskStatus,
        },
      );
    } catch (error) {
      return false;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return false;
    }

    return this.cycleResolvedTranscludedTaskTarget(
      resolvedTarget,
      context,
      direction,
    );
  }

  async cycleResolvedTranscludedTaskTarget(
    resolvedTarget,
    context,
    direction,
    options = {},
  ) {
    if (!resolvedTarget || !isCyclableTaskStatus(resolvedTarget.taskStatus)) {
      return false;
    }

    if (this.cyclerBankTransclusionIsBank(resolvedTarget)) {
      return false;
    }
    if (this.cyclerReqGuardRefuseTarget(resolvedTarget.sourceText, resolvedTarget.line, "transclusion", false)) return false;
    const sourceSymbol = resolvedTarget.taskStatus.symbol;
    if (
      sourceSymbol === BLOCKED_TASK_STATUS_SYMBOL &&
      isProjectBlockedResidentTaskInDocument(
        resolvedTarget.sourceText,
        resolvedTarget.file && resolvedTarget.file.path,
        resolvedTarget.line,
      )
    ) {
      new Notice(
        projectBlockedResidentNotice(
          resolvedTarget.sourceText,
          resolvedTarget.file.path,
          resolvedTarget.line,
        ) || `Project blocked · resolve the ^prj reason in ${resolvedTarget.file.path}`,
      );
      return false;
    }
    const nextSymbol = this.getAdjacentSymbol(sourceSymbol, direction);
    if (!nextSymbol) {
      return false;
    }

    if (cyclerMailCloseIsClose(sourceSymbol, nextSymbol)) {
      const mail = await this.confirmCyclerMailCloseForResolvedClose(
        resolvedTarget, context, nextSymbol,
      );
      if (!mail || mail.confirmed !== true) return false;
    }

    const identity = nextSymbol === "x"
      ? this.reqCloseIdentityForResolvedTarget(resolvedTarget)
      : null;
    const reqCloseOwners = identity
      ? this.captureReqCloseOwnersForResolvedTarget(resolvedTarget, context)
      : [];

    const sameNote = this.fileMatchesPath(
      resolvedTarget.file,
      context && context.activePath,
    );
    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
      nextSymbol,
      {
        allowAnyStatus: true,
        settlePolicy: TASK_SETTLE_WRITE_POLICY.deferred,
        settleNonEditor: true,
      },
    );

    if (wrote && sourceSymbol === BLOCKED_TASK_STATUS_SYMBOL) {
      await this.applyBlockedStatusRetirementToTranscludedTarget(resolvedTarget, context);
      const targetPath = resolvedTarget.file && resolvedTarget.file.path;
      if (targetPath) {
        const sameNote = this.fileMatchesPath(
          resolvedTarget.file,
          context && context.activePath,
        );
        await this.recoverProjectResidentsAfterPrjUnblock(
          sameNote ? context && context.editor : null,
          targetPath,
        );
      }
    }

    if (wrote && sameNote && context && context.editor) {
      const settleIdentity = this.snapshotTaskSettleIdentity(null, resolvedTarget.line, {
        blockId: resolvedTarget.blockId,
      });
      if (options && options.deferSettleSchedule) {
        if (Array.isArray(options.settleIdentities)) {
          options.settleIdentities.push(settleIdentity);
        }
      } else {
        this.scheduleTaskCycleSettle(
          context.editor,
          resolvedTarget.file.path,
          settleIdentity,
        );
      }
    }

    if (wrote && options && options.deferFinalize && nextSymbol === "x" &&
        context && Array.isArray(context.reqCloseOwners)) {
      context.reqCloseOwners.push(...reqCloseOwners);
    }
    if (
      wrote && !(options && options.deferFinalize) &&
      (nextSymbol === "x" || nextSymbol === "-")
    ) {
      const targetPath = resolvedTarget.file && resolvedTarget.file.path;
      if (targetPath) {
        if (identity) {
          void this.finalizeCycledClosedTasks(
            [{ identity, symbol: nextSymbol }],
            { ...context, reqCloseOwners },
          );
        }
      }
    }

    return wrote;
  }

  // Blocked-retirement for a resolved transcluded target: write through the
  // editor when it lives in the active note, else through the vault. Two
  // sequential writes to the same file (the status write, then this one) are
  // acceptable; each re-reads live content, so both are independently
  // idempotent.
  async applyBlockedStatusRetirementToTranscludedTarget(resolvedTarget, context) {
    if (this.fileMatchesPath(resolvedTarget.file, context && context.activePath)) {
      if (
        this.applyBlockedStatusRetirementInEditor(
          context && context.editor,
          resolvedTarget.line,
        )
      ) {
        return true;
      }
    }

    return this.applyBlockedStatusRetirementInVault(
      resolvedTarget.file,
      resolvedTarget.line,
    );
  }

  async applyBlockedStatusRetirementInVault(file, taskLine) {
    if (!this.app.vault) {
      return false;
    }

    const todayDateString = this.getScheduleLogDateString();
    let changed = false;
    const updateSourceText = (sourceText) => {
      const applied = applyBlockedStatusRetirementToSourceText(
        sourceText,
        taskLine,
        todayDateString,
      );
      if (!applied) {
        return sourceText;
      }

      changed = true;
      return applied.text;
    };

    try {
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(file, updateSourceText);
        return changed;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return false;
      }

      const sourceText = await this.app.vault.read(file);
      const nextSourceText = updateSourceText(sourceText);
      if (!changed) {
        return false;
      }

      await this.app.vault.modify(file, nextSourceText);
      return true;
    } catch (error) {
      return false;
    }
  }

}

function isRecurringTaskLine(lineText) {
  const line = String(lineText || "");
  return /\[repeat\s*::/i.test(line) || /\(repeat\s*::/i.test(line) || line.includes("🔁");
}

function rewriteTaskLineAsDone(lineText, date) {
  const line = String(lineText || "");
  try {
    return rewriteTaskLineForLocalFallback(line, "x", date);
  } catch (_error) {
    return line;
  }
}
