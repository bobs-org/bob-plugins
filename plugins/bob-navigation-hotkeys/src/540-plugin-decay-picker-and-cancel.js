class BobNavigationHotkeysDecayCancelMixin {

  // Less often at 90+: the existing custom refresh picker, constrained to
  // a longer value ≤365. The picker only selects; the commit revalidates
  // and writes through the same single-transaction path as presets. A
  // dismissed picker stays due and never advances.
  openFreshnessDecayLessOftenPicker(cardCtx) {
    try {
      const lessOften = cardCtx.plan.lessOften;
      if (!lessOften || lessOften.mode !== "picker") {
        return false;
      }
      const liveLine = getEditorLine(cardCtx.cm, cardCtx.line);
      if (liveLine === null || liveLine !== cardCtx.rawLine) {
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        return false;
      }
      const picker = new BulletPropertyPickerModal(
        this.app,
        this,
        cardCtx.cm,
        { line: cardCtx.line, ch: 0 },
        liveLine,
        this.config,
        {
          filePath: cardCtx.filePath,
          baseDate: getLocalDateStart(new Date()),
          directStage: true,
        },
      );
      picker.showRefreshValueStage({
        days: lessOften.beforeDays,
        mixed: false,
        property: { values: "number" },
      });
      const constrained = createRefreshValueItems(lessOften.beforeDays).filter(
        (item) =>
          Number.isInteger(item.refreshDays) &&
          item.refreshDays >= lessOften.minDays &&
          item.refreshDays <= lessOften.maxDays,
      );
      picker.applyOptions({
        items: constrained,
        title: `Refresh every · longer than ${lessOften.beforeDays} d`,
        emptyText: `No longer preset · type ${lessOften.minDays}–${lessOften.maxDays}`,
        getSubtitle: () =>
          `Choose days · current: every ${lessOften.beforeDays} d · longer only`,
        openItem: (item) => picker.applySelectedValue(item),
      });
      const plugin = this;
      picker.applySelectedValue = async (item) => {
        try {
          const days =
            item && Number.isInteger(item.refreshDays)
              ? item.refreshDays
              : item && Number.isInteger(item.value)
                ? item.value
                : null;
          if (
            !Number.isInteger(days) ||
            days < lessOften.minDays ||
            days > lessOften.maxDays
          ) {
            new Notice(
              `Choose every ${lessOften.minDays}–${lessOften.maxDays} days`,
            );
            return false;
          }
          picker.close();
          const check = plugin.revalidateFreshnessDecayCard(cardCtx);
          if (!check.ok) {
            new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
            await plugin.reopenFreshnessDecayCard(cardCtx);
            return false;
          }
          return await plugin.applyFreshnessDecayLessOftenDays(
            cardCtx,
            check.live,
            lessOften.beforeDays,
            days,
          );
        } catch (error) {
          new Notice("Could not update task; no tasks were updated");
          return false;
        }
      };
      picker.applyRefreshCustomFromQuery = (query) => {
        try {
          const custom = parseRefreshCustomValue(query);
          if (custom === null) {
            return false;
          }
          void picker.applySelectedValue({
            refreshDays: custom,
            value: custom,
          });
          return true;
        } catch (error) {
          return false;
        }
      };
      picker.open();
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Reword (E): stamp and clear, then put the cursor at the end of the
  // task body before metadata for editing. Stays on this task even for
  // Alt+Shift+F — no walk advance.
  async applyFreshnessDecayCardReword(cardCtx, live) {
    try {
      const stamper = this.getFreshnessStampLine();
      if (typeof stamper !== "function") {
        new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
        return false;
      }
      const nextLine = applyFreshStampLine(
        live.lineText,
        stamper,
        cardCtx.dateText,
      );
      const reason = formatFreshnessDecisionRewordReason({
        keeps: cardCtx.keeps,
      });
      if (reason !== cardCtx.plan.reword.reason) {
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        return false;
      }
      const logPlan = planScheduleLogEntry(live.content, cardCtx.line, {
        from: cardCtx.currentScheduled,
        to: cardCtx.currentScheduled,
        reason,
      });
      const split = splitMarkdownContent(live.content);
      const lines = split.lines.slice();
      lines[cardCtx.line] = nextLine;
      applyScheduleLogEntryToLines(lines, logPlan);
      const applied = applyEditorContentTransaction(
        cardCtx.cm,
        live.content,
        lines.join(split.lineEnding),
        {
          line: cardCtx.line,
          ch: freshnessDecayRewordCursorCh(nextLine),
        },
      );
      if (!applied) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      try {
        if (cardCtx.cm && typeof cardCtx.cm.focus === "function") {
          cardCtx.cm.focus();
        }
      } catch (error) {
        // Best effort: the cursor is already placed for editing.
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      new Notice("Reword · count restarted — edit the task");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Drop (D): the existing guarded cancel writer and side effects, with
  // the dated `dropped after N keeps` Cancel Log reason. History stays
  // on the closed line; no stamp runs on a cancel row.
  async applyFreshnessDecayCardDrop(cardCtx, live) {
    try {
      const reason = cardCtx.plan.drop ? cardCtx.plan.drop.reason : "";
      if (!reason) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      const ok = await this.applyTaskCancelFromPicker(
        {
          editor: cardCtx.cm,
          cursor: { line: cardCtx.line, ch: 0 },
          filePath: cardCtx.filePath,
          lineText: cardCtx.rawLine,
          valueBaseDate: getLocalDateStart(new Date()),
        },
        { reason },
      );
      if (!ok) {
        return false;
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, "drop");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Keep (Alt+F): a counted keep with saturation — stamp, do not reset.
  // The next due review asks again.
  async applyFreshnessDecayCardKeep(cardCtx, live) {
    try {
      const api = getReviewFreshnessApi(this.app);
      if (!freshnessSupportsKeeps(api)) {
        new Notice(REVIEW_FRESHNESS_KEEP_REQUIRED_NOTICE);
        return false;
      }
      if (getEditorLine(cardCtx.cm, cardCtx.line) !== live.lineText) {
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        return false;
      }
      let nextLine = null;
      try {
        nextLine = String(
          api.keepLine(live.lineText, cardCtx.dateText, { counted: true }) ??
            live.lineText,
        );
      } catch (error) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      if (!replaceEditorLine(cardCtx.cm, cardCtx.line, live.lineText, nextLine)) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      const nextKeeps = Math.min(999, cardCtx.keeps + 1);
      new Notice(`Kept ${nextKeeps}× · next review asks`);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, "keep");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Capture-phase fallback so Alt+F / Alt+Shift+F reach the counted refresh
  // route while Vim normal mode is active. CodeMirror Vim swallows Alt
  // chords before Obsidian's hotkey dispatcher runs, so the hotkeys below
  // only cover insert mode and non-Vim editing. A pending numeric Vim prefix
  // is "N additional tasks", mirroring the counted Alt+N route, and the
  // Shift of the chord selects refresh-and-advance.
  registerReviewRefreshInputListeners() {
    this.handledReviewRefreshEvents = new WeakSet();
    const keydownHandler = (event) =>
      this.handleReviewRefreshPhysicalKeydown(event);
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

  handleReviewRefreshPhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (
      !isReviewRefreshKeydown(event, false) &&
      !isReviewRefreshKeydown(event, true)
    ) {
      return false;
    }
    if (
      this.handledReviewRefreshEvents &&
      this.handledReviewRefreshEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledReviewRefreshEvents) {
      this.handledReviewRefreshEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "review-freshness-refresh");
    void this.refreshTaskFreshness(view.editor, {
      advance: event.shiftKey === true,
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    }).catch(() => false);
    return true;
  }

  async applyLaneToggleFromPicker(picker, options = {}) {
    if (!picker) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const summary =
      typeof options.summary === "string" ? options.summary : "";
    const dateText =
      typeof options.dateText === "string" && options.dateText
        ? String(options.dateText)
        : formatBulletPropertyDate(getLocalDateStart(new Date()));
    if (picker.linkSession) {
      const resolved = Array.isArray(picker.linkSession.resolved)
        ? picker.linkSession.resolved
        : [];
      if (resolved.length === 0) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      const laneBudgets = readLaneBudgets(this.app);
      const groups = groupLinkPickerTargetsByNote(resolved);
      const planned = [];
      for (const group of groups) {
        const plan = planTaskLaneBatch(group.content, group.session, {
          summary,
          dateText,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        });
        if (!plan.valid) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
        planned.push({ group, plan });
      }
      const pruneTargets = [];
      for (const { group, plan } of planned) {
        if (plan.mode !== "release") {
          continue;
        }
        for (const entry of plan.released) {
          if (entry.blockId) {
            pruneTargets.push(
              Object.freeze({ path: group.path, blockId: entry.blockId }),
            );
          }
        }
      }
      let pomodoroSnapshot = null;
      let dailyCleanupPlan = null;
      let foldedDailyPath = null;
      if (pruneTargets.length > 0) {
        const sourcePaths = planned.map(({ group }) => group.path);
        pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
          sourcePath: sourcePaths.length === 1 ? sourcePaths[0] : "",
          sourceContent: planned.length === 1 ? planned[0].plan.content : "",
          today: new Date(),
        });
        if (pomodoroSnapshot) {
          const folded = planned.find(
            ({ group }) => group.path === pomodoroSnapshot.dailyPath,
          );
          const dailyBase = folded
            ? folded.plan.content
            : pomodoroSnapshot.content;
          if (dailyBase !== null) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              dailyBase,
              pruneTargets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (folded && dailyCleanupPlan.changed) {
              foldedDailyPath = folded.group.path;
            }
          }
        }
      }
      const commit = await this.commitLinkPickerNoteWrites(planned, {
        pomodoroSnapshot,
        dailyCleanupPlan,
        foldedDailyPath,
      });
      if (!commit.ok) {
        new Notice("A linked note changed; no tasks were updated");
        return false;
      }
      let changedTaskCount = 0;
      let blockedSkipped = 0;
      let releasedNextCount = 0;
      let releasedPendingCount = 0;
      let mode = "commit";
      for (const { plan } of planned) {
        changedTaskCount += plan.changedTaskCount;
        blockedSkipped += plan.blockedSkipped;
        if (plan.mode === "release") {
          mode = "release";
        }
        for (const entry of plan.released || []) {
          if (entry.fromStatus === "*") {
            releasedNextCount += 1;
          } else if (entry.fromStatus === "/") {
            releasedPendingCount += 1;
          }
        }
      }
      const removedPomodoroLinkCount =
        dailyCleanupPlan &&
        dailyCleanupPlan.changed &&
        !commit.pomodoroPruneFailed
          ? dailyCleanupPlan.removedLinkCount
          : 0;
      new Notice(
        buildLaneToggleNotice({
          mode,
          changedTaskCount,
          blockedSkipped,
          unlinkedFromToday: removedPomodoroLinkCount,
          releasedNextCount,
          releasedPendingCount,
          laneBudgets,
        }),
      );
      return true;
    }
    const editor = picker.editor;
    const cursor = picker.cursor;
    const filePath = picker.filePath;
    if (!editor || typeof editor.getValue !== "function" || !cursor) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    let session = null;
    if (
      picker.taskSession &&
      picker.taskSession.explicit &&
      Array.isArray(picker.taskSession.targets) &&
      picker.taskSession.targets.length > 0
    ) {
      session = picker.taskSession;
    } else {
      const content = String(editor.getValue() || "");
      if (!isObsidianTaskAtLine(content, cursor.line)) {
        new Notice("Cursor is not on a task or Task Link");
        return false;
      }
      const line = getEditorLine(editor, cursor.line);
      session = Object.freeze({
        valid: true,
        error: null,
        explicit: false,
        startLine: cursor.line,
        requestedAdditionalCount: 0,
        requestedCount: 1,
        actualCount: 1,
        clamped: false,
        targets: Object.freeze([{ line: cursor.line, rawLine: line }]),
      });
    }
    const writeContext = this.getCountedTaskWriteContext(
      editor,
      filePath,
      session.explicit ? session : session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const laneBudgets = readLaneBudgets(this.app);
    const plan = planTaskLaneBatch(writeContext.content, session, {
      summary,
      dateText,
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return false;
    }
    let finalContent = plan.content;
    let finalCursorLine = cursor.line;
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.mode === "release") {
      const pruneTargets = plan.released
        .filter((entry) => entry.blockId)
        .map((entry) =>
          Object.freeze({ path: filePath, blockId: entry.blockId }),
        )
        .filter((entry) => entry.path);
      if (pruneTargets.length > 0) {
        pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
          sourcePath: filePath,
          sourceContent: writeContext.content,
          today: new Date(),
        });
        const guarded = this.getCountedTaskWriteContext(editor, filePath, session);
        if (!guarded.valid || guarded.content !== writeContext.content) {
          new Notice(
            guarded.valid
              ? "Active note changed; no tasks were updated"
              : guarded.error,
          );
          return false;
        }
        if (pomodoroSnapshot) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              pruneTargets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (dailyCleanupPlan.changed) {
              const removedBefore = dailyCleanupPlan.removedLineRanges.reduce(
                (total, range) =>
                  range.endLineExclusive <= finalCursorLine
                    ? total + (range.endLineExclusive - range.startLine)
                    : total,
                0,
              );
              finalContent = dailyCleanupPlan.content;
              finalCursorLine = finalCursorLine - removedBefore;
            }
          } else {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              pomodoroSnapshot.content,
              pruneTargets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
        }
      }
    }
    const lines = splitMarkdownContent(finalContent).lines;
    const finalLine = String(lines[finalCursorLine] || "");
    const applied = applyEditorContentTransaction(
      editor,
      writeContext.content,
      finalContent,
      {
        line: finalCursorLine,
        ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
      },
    );
    if (!applied) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    let removedPomodoroLinkCount = 0;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot) {
      if (pomodoroSnapshot.sameFile) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        const written = await this.writeDeferredPomodoroCleanup(
          pomodoroSnapshot,
          dailyCleanupPlan,
        );
        removedPomodoroLinkCount = written
          ? dailyCleanupPlan.removedLinkCount
          : 0;
      }
    }
    const releasedNextCount = plan.released.filter(
      (entry) => entry.fromStatus === "*",
    ).length;
    const releasedPendingCount = plan.released.filter(
      (entry) => entry.fromStatus === "/",
    ).length;
    new Notice(
      buildLaneToggleNotice({
        mode: plan.mode,
        changedTaskCount: plan.changedTaskCount,
        blockedSkipped: plan.blockedSkipped,
        unlinkedFromToday: removedPomodoroLinkCount,
        releasedNextCount,
        releasedPendingCount,
        laneBudgets,
      }),
    );
    return true;
  }

  // Apply the picker's pinned Cancel row: write `[-]`, upsert
  // `[cancelled:: date]`, and record the reason in a first-child
  // `❌ **CANCEL LOG**`, then prune the cancelled tasks' links from today's
  // open Pomodoros, recover Blocked dependents through Task Status Cycler's
  // versioned API, and show one Cancelled notice card. Nothing is written
  // until this runs; every refusal ends with `…; no tasks were updated`.
  async applyTaskCancelFromPicker(picker, options = {}) {
    if (!picker) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const reason = String(options.reason || "");
    const fallbackReason = String(options.fallbackReason || "");
    const baseDate =
      picker.valueBaseDate instanceof Date
        ? picker.valueBaseDate
        : getLocalDateStart(new Date());
    const dateText = formatBulletPropertyDate(baseDate);
    const cancel = { reason, fallbackReason, baseDate, dateText };
    if (
      picker.linkSession &&
      picker.linkSession.kind === "task-link" &&
      Array.isArray(picker.linkSession.targets) &&
      picker.linkSession.targets.length > 0
    ) {
      return await this.applyTaskCancelFromLinkPicker(picker, cancel);
    }
    return await this.applyTaskCancelFromEditor(picker, cancel);
  }

  // Single and counted cancel sessions write through the open editor in one
  // `applyEditorContentTransaction` (one undo step, cursor clamped onto the
  // post-image line). When today's daily note is the active note the prune
  // folds into the same transaction; otherwise the daily note is pruned
  // afterwards through the deferred snapshot, and a failed prune is reported
  // but never rolled back.
  async applyTaskCancelFromEditor(picker, cancel) {
    const editor = picker.editor;
    const cursor = picker.cursor;
    const filePath = picker.filePath;
    if (!editor || typeof editor.getValue !== "function" || !cursor) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    let session = null;
    if (
      picker.taskSession &&
      picker.taskSession.explicit &&
      Array.isArray(picker.taskSession.targets) &&
      picker.taskSession.targets.length > 0
    ) {
      session = picker.taskSession;
    } else {
      const content = String(editor.getValue() || "");
      const liveLine = getEditorLine(editor, cursor.line);
      if (liveLine === null || liveLine !== picker.lineText) {
        new Notice("Current task changed while the picker was open; no tasks were updated");
        return false;
      }
      if (!isObsidianTaskAtLine(content, cursor.line)) {
        new Notice("Task is no longer open; no tasks were updated");
        return false;
      }
      const status = getObsidianTaskCheckboxStatus(liveLine);
      if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
        new Notice("Task is no longer open; no tasks were updated");
        return false;
      }
      if (isRecurringTaskLine(liveLine)) {
        new Notice(
          "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
        );
        return false;
      }
      session = Object.freeze({
        valid: true,
        error: null,
        explicit: false,
        startLine: cursor.line,
        requestedAdditionalCount: 0,
        requestedCount: 1,
        actualCount: 1,
        clamped: false,
        targets: Object.freeze([{ line: cursor.line, rawLine: liveLine }]),
      });
    }
    const writeContext = this.getCountedTaskWriteContext(
      editor,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const plan = planTaskCancelBatch(writeContext.content, session, {
      date: cancel.dateText,
      reason: cancel.reason,
      fallbackReason: cancel.fallbackReason,
    });
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return false;
    }

    let finalContent = plan.content;
    let finalCursorLine = plan.cursorLineShift(cursor.line);
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    const pruneTargets = [];
    for (const entry of plan.cancelled) {
      if (entry.blockId) {
        pruneTargets.push(
          Object.freeze({ path: filePath, blockId: entry.blockId }),
        );
      }
    }
    if (pruneTargets.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today: cancel.baseDate,
      });
      const guarded = this.getCountedTaskWriteContext(editor, filePath, session);
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        if (pomodoroSnapshot.sameFile) {
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            finalContent,
            pruneTargets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
          if (dailyCleanupPlan.changed) {
            const linesRemovedBeforeCursor =
              dailyCleanupPlan.removedLineRanges.reduce(
                (total, range) =>
                  range.endLineExclusive <= finalCursorLine
                    ? total + (range.endLineExclusive - range.startLine)
                    : total,
                0,
              );
            finalContent = dailyCleanupPlan.content;
            finalCursorLine = finalCursorLine - linesRemovedBeforeCursor;
          }
        } else {
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            pomodoroSnapshot.content,
            pruneTargets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
        }
      }
    }

    const finalLine =
      splitMarkdownContent(finalContent).lines[finalCursorLine] || "";
    try {
      if (
        finalContent !== writeContext.content &&
        !applyEditorContentTransaction(editor, writeContext.content, finalContent, {
          line: finalCursorLine,
          ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
        })
      ) {
        throw new Error("Editor cannot apply a cancel transaction");
      }
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot) {
      if (pomodoroSnapshot.sameFile) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        const written = await this.writeDeferredPomodoroCleanup(
          pomodoroSnapshot,
          dailyCleanupPlan,
        );
        if (written) {
          removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
        } else {
          pomodoroPruneFailed = true;
        }
      }
    }

    const identities = plan.cancelled.map((entry) =>
      Object.freeze({
        path: filePath,
        blockId: entry.blockId,
        taskId: entry.taskId,
      }),
    );
    const postPruneDailyContent =
      dailyCleanupPlan && dailyCleanupPlan.changed
        ? dailyCleanupPlan.content
        : null;
    return await this.finishTaskCancelNotice(picker, {
      identities,
      activePath: filePath,
      editor,
      count: Math.max(1, plan.cancelledCount),
      viaLinks: false,
      dateText: cancel.dateText,
      reason: cancel.reason,
      fallbackUsed: plan.fallbackLoggedCount > 0,
      skippedClosedCount: plan.skippedClosedCount,
      removedPomodoroLinkCount,
      pomodoroPruneFailed,
      postPruneDailyContent,
    });
  }
}
