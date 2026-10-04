class TaskStatusCyclerCompletionMixin {
  handleToggleOpenDoneCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

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
    ).catch(() => false);
    return true;
  }

  handleToggleCheckboxMarkerCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

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

    const obsidianTaskToggle = this.getActiveObsidianTaskToggle(editor);
    if (!obsidianTaskToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActiveObsidianTask(editor, obsidianTaskToggle, view);
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

  // Cross-plugin close for checklist rows (API v2). Always goes through the
  // Tasks `set-status-symbol-to-x` command so recurrence fires; never stamps
  // and never falls back to writing `[x]` raw. Callers await the result.
  async completeTaskAtCursor(editor) {
    const taskStatus =
      editor && typeof editor.getCursor === "function"
        ? this.getActiveTaskStatus(editor)
        : null;
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
    const beforeLineCount = this.getEditorLineCount(editor);

    if (
      !this.applyTasksCommandAndMaybeStamp(editor, taskStatus, "x", {
        stamp: false,
      })
    ) {
      return { ok: false, reason: "not-closed" };
    }

    const lineDelta = this.getEditorLineCount(editor) - beforeLineCount;
    if (this.closedTaskLineAfterTasksWrite(editor, taskStatus.line, lineDelta) === null) {
      return { ok: false, reason: "not-closed" };
    }

    if (identity) {
      await this.finalizeClosedTasks([identity], { editor, activePath });
    }
    return { ok: true, lineDelta };
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

    if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      const result = await this.reopenResolvedTranscludedTaskTarget(
        resolvedTarget,
        context,
      );
      return result.changed;
    }

    const closing = isTranscludedCompletionClosableStatus(
      resolvedTarget.taskStatus,
    );
    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
    );
    if (wrote && closing) {
      const identity = closedTaskIdentity(
        resolvedTarget.file.path,
        resolvedTarget.taskStatus.lineText,
      ) || { path: resolvedTarget.file.path, blockId: resolvedTarget.blockId };
      await this.finalizeClosedTasks([identity], context);
    }
    return wrote;
  }

  // Shared body for the Vim Ctrl+Enter dispatch and the non-Vim open/done
  // command: toggle the local checkbox, then propagate the same open/done
  // transition to an embedded block transclusion on the active line (if any),
  // and finalize both identities together in one batch. The candidate embed
  // is captured before the local write so a Tasks-plugin recurrence insertion
  // above the active line cannot shift which line's transclusion is selected.
  async toggleActiveCheckboxOpenDoneAndPropagate(editor, activeFile, taskStatus) {
    const activePath = activeFile && activeFile.path;
    const cursor =
      typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const isFenced =
      cursor && typeof cursor.line === "number"
        ? getFencedLineNumbers(this.getEditorLineTexts(editor)).has(cursor.line)
        : false;
    const transclusionCandidate = isFenced
      ? null
      : this.getActiveLineTranscludedTaskTarget(editor, activePath);

    const wrote = this.toggleActiveCheckboxOpenDone(editor, taskStatus);
    if (!wrote) {
      return false;
    }

    const localIdentity = closedTaskIdentity(activePath, taskStatus.lineText);
    const closing = isTranscludedCompletionClosableStatus(taskStatus);
    const targetIdentity = await this.closeOrReopenTranscludedTaskLine(
      transclusionCandidate,
      editor,
      activePath,
      closing,
    );
    const identities = [localIdentity, targetIdentity].filter(Boolean);
    if (identities.length) {
      const context = { editor, activePath };
      if (closing) {
        await this.finalizeClosedTasks(identities, context);
      } else {
        await this.restoreReopenedTaskReferences(identities, context);
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
  async closeOrReopenTranscludedTaskLine(candidate, editor, activePath, closing) {
    if (!candidate) {
      return null;
    }

    const context = { editor, activePath, originPath: activePath };
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
        wrote = await this.replaceResolvedTranscludedTaskLine(
          resolvedTarget,
          context,
          "x",
        );
      }
    } else if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        " ",
        { forcedStatusPredicate: isTranscludedReopenableStatus },
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

  async handleActiveTaskBlockLinkOpenDone(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    const candidate = this.getActiveLineTaskBlockLinkTarget(editor, activePath);
    if (!candidate) {
      return { resolved: false, changed: false };
    }

    // A link on a Depends-On line closes or reopens its prerequisite target
    // root-only: the Blocked-dependent recovery in finalizeClosedTasks still
    // runs, but nothing is ever struck, restored, or embedded on the line and
    // no transcluded tree is closed.
    const onDependencyLine = isTaskDependencyLine(candidate.activeLineText);

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget = null;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        candidate,
        context,
        { taskStatusPredicate: isOpenDoneTaskStatus },
      );
    } catch (error) {
      resolvedTarget = null;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      // A Task Link to a Cancelled task consumes the key with a notice: it
      // must never fall back to completing the owning Pomodoro. Links that
      // resolve to no task at all keep their current fallback.
      let cancelledTarget = null;
      try {
        cancelledTarget = await this.resolveTranscludedBlockTarget(
          candidate,
          context,
          { taskStatusPredicate: isCancelledTaskStatus },
        );
      } catch (error) {
        cancelledTarget = null;
      }
      if (cancelledTarget && cancelledTarget.file) {
        new Notice("Task is cancelled; reopen it with ⌥] first");
        return { resolved: true, changed: false };
      }
      return { resolved: false, changed: false };
    }

    // Reopen always wins after resolution and is deliberately root-only, even
    // for an embedded child beneath a Pomodoro.
    if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      const reopenResult = await this.reopenResolvedTranscludedTaskTarget(
        resolvedTarget,
        context,
      );
      if (reopenResult.changed && !onDependencyLine) {
        try {
          await this.unstrikeActiveSelectedTaskBlockLink(
            editor,
            activePath,
            candidate,
          );
        } catch (error) {
          // Best effort: the reopen already landed; a missed unstrike is cosmetic.
        }
      }
      return { resolved: true, changed: reopenResult.changed };
    }

    const pomodoroTransclusion = candidate.embedded && !onDependencyLine
      ? this.getActivePomodoroTranscludedTaskLineTarget(editor, activePath)
      : null;
    if (pomodoroTransclusion) {
      try {
        const result = await this.completeResolvedTranscludedTaskTargetTree(
          resolvedTarget,
          context,
          new Set(),
        );
        await this.finalizeClosedTasks(result.closed, context);
        const rootKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
        const rootClosed = Array.isArray(result.closed) && result.closed.some(
          (identity) =>
            identity &&
            `${identity.path}#^${identity.blockId}` === rootKey,
        );
        if (rootClosed) {
          try {
            await this.strikeActiveSelectedTaskBlockLink(
              editor,
              activePath,
              candidate,
            );
          } catch (error) {
            // Best effort: the close already landed; a missed strike is cosmetic.
          }
        }
        return { resolved: true, changed: !!result.changed };
      } catch (error) {
        // Once the eligible root resolved, a partial recursive close remains a
        // handled best-effort action.
        return { resolved: true, changed: false };
      }
    }

    const closing = isTranscludedCompletionClosableStatus(
      resolvedTarget.taskStatus,
    );
    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
    );
    if (wrote && closing) {
      const identity = closedTaskIdentity(
        resolvedTarget.file.path,
        resolvedTarget.taskStatus.lineText,
      ) || { path: resolvedTarget.file.path, blockId: resolvedTarget.blockId };
      await this.finalizeClosedTasks([identity], context);
      if (!onDependencyLine) {
        try {
          await this.strikeActiveSelectedTaskBlockLink(
            editor,
            activePath,
            candidate,
          );
        } catch (error) {
          // Best effort: the close already landed; a missed strike is cosmetic.
        }
      }
    }
    return { resolved: true, changed: !!wrote };
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

  async cycleResolvedTranscludedTaskTarget(resolvedTarget, context, direction) {
    if (!resolvedTarget || !isCyclableTaskStatus(resolvedTarget.taskStatus)) {
      return false;
    }

    const sourceSymbol = resolvedTarget.taskStatus.symbol;
    const nextSymbol = this.getAdjacentSymbol(sourceSymbol, direction);
    if (!nextSymbol) {
      return false;
    }

    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
      nextSymbol,
      { allowAnyStatus: true },
    );

    if (wrote && sourceSymbol === BLOCKED_TASK_STATUS_SYMBOL) {
      await this.applyBlockedStatusRetirementToTranscludedTarget(resolvedTarget, context);
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
