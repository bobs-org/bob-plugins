class BobNavigationHotkeysLinkCommitLaneMixin {

  // Shared preimage, write, rollback and prune core for link-picker commits.
  // Every preimage is re-verified before the first write; any mismatch refuses
  // the whole operation with `{ ok: false }`. Write order is targets, then
  // the daily note; target writes roll back when one fails. A prune failure
  // after durable target writes is reported via `pomodoroPruneFailed` and
  // dropped — like writeDeferredPomodoroCleanup — never rolled back. Callers
  // own the notices. `planned` entries carry `{ group, plan }` where `plan`
  // has the postimage in `plan.content`.
  async commitLinkPickerNoteWrites(
    planned,
    options = {},
  ) {
    const pomodoroSnapshot = options.pomodoroSnapshot || null;
    const dailyCleanupPlan = options.dailyCleanupPlan || null;
    const foldedDailyPath = options.foldedDailyPath || null;
    const failed = (reason) =>
      Object.freeze({ ok: false, reason, pomodoroPruneFailed: false });

    // Re-verify every preimage before writing anything.
    for (const { group } of planned) {
      const live = await this.readLinkPickerNoteContent(
        group.path,
        group.file,
      );
      if (live !== group.content) {
        return failed("preimage");
      }
    }
    if (
      pomodoroSnapshot &&
      !foldedDailyPath &&
      dailyCleanupPlan &&
      dailyCleanupPlan.changed
    ) {
      const liveDaily = await this.readLinkPickerNoteContent(
        pomodoroSnapshot.dailyPath,
        pomodoroSnapshot.file,
      );
      if (liveDaily !== pomodoroSnapshot.content) {
        return failed("preimage");
      }
    }

    // Write order is targets, then the daily note.
    const written = [];
    try {
      for (const { group, plan } of planned) {
        let after = plan.content;
        if (
          foldedDailyPath &&
          group.path === foldedDailyPath &&
          dailyCleanupPlan &&
          dailyCleanupPlan.changed
        ) {
          after = dailyCleanupPlan.content;
        }
        if (after !== group.content) {
          await this.writeLinkPickerNoteChange(
            group.path,
            group.file,
            group.content,
            after,
          );
          written.push({
            path: group.path,
            file: group.file,
            before: group.content,
            after,
          });
        }
      }
    } catch (error) {
      for (const entry of written.slice().reverse()) {
        try {
          await this.writeLinkPickerNoteChange(
            entry.path,
            entry.file,
            entry.after,
            entry.before,
          );
        } catch (rollbackError) {
          // Best effort: the original error stays authoritative.
        }
      }
      return failed("write");
    }

    let pomodoroPruneFailed = false;
    if (
      pomodoroSnapshot &&
      !foldedDailyPath &&
      dailyCleanupPlan &&
      dailyCleanupPlan.changed
    ) {
      const applied = await this.writeDeferredPomodoroCleanup(
        pomodoroSnapshot,
        dailyCleanupPlan,
      );
      pomodoroPruneFailed = !applied;
    }
    return Object.freeze({ ok: true, reason: null, pomodoroPruneFailed });
  }

  // Commit planned link-picker note writes plus the deferred-Pomodoro prune.
  // Every preimage is re-verified before the first write; any mismatch refuses
  // the whole operation. Write order is targets, then the daily note. A prune
  // failure after durable target writes is reported and dropped — like
  // writeDeferredPomodoroCleanup — never rolled back. On success the priority
  // notice card reports the cross-note outcome with a via-Task-Links count.
  async commitLinkPickerPlans(
    picker,
    linkSession,
    planned,
    baseDate,
    notice = {},
  ) {
    const pruneTargets = [];
    for (const { group, plan } of planned) {
      if (plan.futureScheduledTaskLines.length === 0) {
        continue;
      }
      const lines = splitMarkdownContent(group.content).lines;
      for (const target of deferredPomodoroTargetsFromLines(
        group.path,
        lines,
        plan.futureScheduledTaskLines,
      )) {
        pruneTargets.push(target);
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
        today: baseDate,
      });
      if (pomodoroSnapshot) {
        // When the daily note is one of the edited target notes, the prune
        // folds into that note's own write instead of racing it.
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

    // Shared preimage, write, rollback and prune core below, so scheduled,
    // priority and cancel commits share one implementation.
    const commit = await this.commitLinkPickerNoteWrites(planned, {
      pomodoroSnapshot,
      dailyCleanupPlan,
      foldedDailyPath,
    });
    if (!commit.ok) {
      new Notice("A linked note changed; no tasks were updated");
      return false;
    }
    const pomodoroPruneFailed = commit.pomodoroPruneFailed;

    const totals = {
      changedTaskCount: 0,
      unchangedTaskCount: 0,
      propagatedScheduleTaskCount: 0,
      removedHideTaskCount: 0,
      ambiguousProjectTaskCount: 0,
      blockedTaskCount: 0,
      recoveredReadyTaskCount: 0,
      recoveredNextTaskCount: 0,
      recoveredInProgressTaskCount: 0,
      stillBlockedTaskCount: 0,
      deferredRecoveryTaskCount: 0,
      scheduleLoggedTaskCount: 0,
      schedulingWorkLogWrittenCount: 0,
    };
    for (const { plan } of planned) {
      totals.changedTaskCount += plan.changedTaskCount;
      totals.unchangedTaskCount += plan.unchangedTaskCount;
      totals.propagatedScheduleTaskCount += plan.propagatedScheduleTaskCount;
      totals.removedHideTaskCount += plan.removedHideTaskCount;
      totals.ambiguousProjectTaskCount += plan.ambiguousProjectTaskCount;
      totals.blockedTaskCount += plan.blockedTaskCount;
      totals.recoveredReadyTaskCount += plan.recoveredReadyTaskCount;
      totals.recoveredNextTaskCount += plan.recoveredNextTaskCount;
      totals.recoveredInProgressTaskCount += plan.recoveredInProgressTaskCount;
      totals.stillBlockedTaskCount += plan.stillBlockedTaskCount;
      totals.deferredRecoveryTaskCount += plan.deferredRecoveryTaskCount;
      totals.scheduleLoggedTaskCount += plan.scheduleLoggedTaskCount;
      totals.schedulingWorkLogWrittenCount +=
        plan.schedulingWorkLogWrittenCount || 0;
    }
    const removedPomodoroLinkCount = dailyCleanupPlan && dailyCleanupPlan.changed && !pomodoroPruneFailed
      ? dailyCleanupPlan.removedLinkCount
      : 0;
    const taskNoun = formatCountLabel(totals.changedTaskCount, "task");
    const viaLinks = totals.changedTaskCount === 1
      ? "via Task Link"
      : "via Task Links";

    if (notice.priority) {
      const model = buildPriorityNoticeModel({
        property: notice.priority.property,
        level: notice.priority.level,
        levelIndex: normalizePriorityLevelIndex(
          notice.priority.property,
          notice.priority.level,
        ),
        baseDate,
        scheduledValues: notice.rolledDates || [],
        taskCount: Math.max(1, totals.changedTaskCount),
        scope: "counted",
        outcome: {
          ...totals,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        },
      });
      showPriorityNotice({
        ...model,
        text: `${model.text} · ${viaLinks}`,
        countPill: model.countPill
          ? `${model.countPill} ${viaLinks}`
          : viaLinks,
      });
      return true;
    }

    const propagationSuffix = totals.propagatedScheduleTaskCount > 0
      ? `; scheduled ${formatCountLabel(totals.propagatedScheduleTaskCount, "task")}`
      : "";
    const hideSuffix = totals.removedHideTaskCount > 0
      ? `; removed #hide from ${formatCountLabel(totals.removedHideTaskCount, "task")}`
      : "";
    const blockedSuffix = totals.blockedTaskCount > 0
      ? `; marked ${formatCountLabel(totals.blockedTaskCount, "task")} Blocked`
      : "";
    const ambiguitySuffix = totals.ambiguousProjectTaskCount > 0
      ? `; ${formatCountLabel(totals.ambiguousProjectTaskCount, "task")} with multiple scheduled fields unchanged`
      : "";
    const recoverySuffix = scheduledRecoveryNoticeSuffix({
      ready: totals.recoveredReadyTaskCount,
      next: totals.recoveredNextTaskCount,
      inProgress: totals.recoveredInProgressTaskCount,
      stillBlocked: totals.stillBlockedTaskCount,
      deferred: totals.deferredRecoveryTaskCount,
    });
    const scheduleLogSuffix = totals.scheduleLoggedTaskCount > 0
      ? `; logged reason on ${formatCountLabel(totals.scheduleLoggedTaskCount, "task")}`
      : "";
    const workLogSuffix = totals.schedulingWorkLogWrittenCount > 0
      ? `; ${formatCountLabel(totals.schedulingWorkLogWrittenCount, "Work Log")}`
      : "";
    const pomodoroPruneSuffix = removedPomodoroLinkCount > 0
      ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
      : pomodoroPruneFailed
        ? "; Pomodoro links not removed"
        : "";
    new Notice(
      `${notice.header} · ${taskNoun} ${viaLinks}${propagationSuffix}${hideSuffix}${blockedSuffix}${ambiguitySuffix}${recoverySuffix}${scheduleLogSuffix}${workLogSuffix}${pomodoroPruneSuffix}`,
    );
    return true;
  }

  // task-lane: Commit Ready to Next, or release Next/In Progress to Ready.
  // On a #task line the current task plus the next N real tasks are covered;
  // on a dedicated Task Link the resolved task plus the next N sibling links
  // are covered in their own notes. reusing the counted task and
  // Task Link target discovery. Commit writes no link; release also removes each released
  // task's live links under today's open Pomodoros. Writes follow
  // link-picker's cross-note rules: any stale preimage refuses the whole
  // operation, targets write first, then the daily note.
  async toggleTaskLane(cm, options = {}) {
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
    const content =
      cm && typeof cm.getValue === "function"
        ? String(cm.getValue() || "")
        : "";
    let countExplicit = options.countExplicit === true;
    let additionalTaskCount = Math.max(
      0,
      Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
    );
    if (!countExplicit) {
      const view = this.getActiveMarkdownView();
      const editorForVim =
        view && view.editor === cm ? view.editor : cm;
      if (this.isVimNormalModeEditor(editorForVim, view)) {
        const vimCm = this.resolveVimCodeMirror(editorForVim, view);
        const pending = getPendingVimRepeat(vimCm);
        if (pending.explicit) {
          countExplicit = true;
          additionalTaskCount = Math.max(
            0,
            Math.floor(numericOrDefault(pending.repeat, 0)),
          );
          resetPendingVimInputState(vimCm, "counted-lane-toggle");
        }
      }
    }
    // Review-walk auto-advance (nav-gestures): capture after the pending
    // Vim count is consumed and before dispatch. While the gesture lock is
    // held the key is swallowed with no write.
    let reviewOrigin = null;
    try {
      if (typeof this.captureReviewGesture === "function") {
        const captured = this.captureReviewGesture(cm);
        if (captured && captured.busy === true) {
          return false;
        }
        reviewOrigin = captured || null;
      }
    } catch (error) {
      reviewOrigin = null;
    }
    const settleLaneReview = (outcome) => {
      if (!reviewOrigin) {
        return;
      }
      const origin = reviewOrigin;
      reviewOrigin = null;
      try {
        void this.continueReviewWalkAfter(origin, outcome);
      } catch (error) {
        // `continueReviewWalkAfter` never throws; best effort only.
      }
    };
    const onTask = isObsidianTaskAtLine(content, cursor.line);
    if (onTask) {
      const origin = reviewOrigin;
      reviewOrigin = null;
      return await this.toggleTaskLaneOnTasks(cm, cursor, content, {
        countExplicit,
        additionalTaskCount,
        summary: options.summary,
        dateText: options.dateText,
        skipReleasePrompt: options.skipReleasePrompt,
        reviewOrigin: origin,
      });
    }
    if (parseLinkPickerTaskLink(lineText)) {
      // Task Link mode never matches a landing: settle without advancing
      // before going there.
      settleLaneReview(null);
      return await this.toggleTaskLaneOnLinks(cm, cursor, content, {
        countExplicit,
        additionalTaskCount,
        linkDiscovery: options.linkDiscovery || null,
        summary: options.summary,
        dateText: options.dateText,
        skipReleasePrompt: options.skipReleasePrompt,
      });
    }
    settleLaneReview(null);
    new Notice("Cursor is not on a task or Task Link");
    return false;
  }

  async requestLaneReleaseSummary(options = {}) {
    if (options.skipReleasePrompt === true) {
      return { cancelled: false, summary: "" };
    }
    if (typeof options.summary === "string") {
      return { cancelled: false, summary: options.summary };
    }
    return await new Promise((resolve) => {
      const modal = new LaneReleaseSummaryModal(this.app, (result) => {
        if (result === null) {
          resolve({ cancelled: true, summary: "" });
        } else {
          resolve({ cancelled: false, summary: String(result || "") });
        }
      });
      try {
        modal.open();
      } catch (error) {
        resolve({ cancelled: false, summary: "" });
      }
    });
  }

  laneReleaseDateText(options = {}) {
    if (typeof options.dateText === "string" && options.dateText) {
      return String(options.dateText);
    }
    return formatBulletPropertyDate(getLocalDateStart(new Date()));
  }

  // Task freshness stampers from bob-ledger-tools (api `version >= 3`).
  // Placement lives in ledger-tools; this plugin only calls
  // `api?.freshness?.stampLine?.(line, dateText) ?? line` and
  // `api?.freshness?.setRefreshLine?.(line, days, dateText) ?? line`.
  // Returns undefined when ledger-tools is absent or old, in which case
  // gestures simply don't stamp.
  getFreshnessApi() {
    try {
      return getReviewFreshnessApi(this.app);
    } catch (error) {
      return null;
    }
  }

  getFreshnessStampLine() {
    try {
      const api = this.getFreshnessApi();
      if (!api || typeof api.stampLine !== "function") {
        return undefined;
      }
      return api.stampLine.bind(api);
    } catch (error) {
      return undefined;
    }
  }

  getFreshnessRefreshLine() {
    try {
      const api = this.getFreshnessApi();
      if (!api || typeof api.setRefreshLine !== "function") {
        return undefined;
      }
      return api.setRefreshLine.bind(api);
    } catch (error) {
      return undefined;
    }
  }

  getFreshnessDateText() {
    try {
      return formatBulletPropertyDate(getLocalDateStart(new Date()));
    } catch (error) {
      return undefined;
    }
  }

  // Refresh interval commit (nav-stamps): writes through
  // `api.freshness.setRefreshLine`, which also stamps. `days` is an integer
  // 1-365, or null for "use default" (clears `[refresh:: N]`). Without the
  // api the row stays hidden, so this refuses with a notice. Handles single,
  // counted and Task Link sessions.
  async applyRefreshIntervalFromPicker(picker, item, options = {}) {
    const days =
      item && item.refreshDays !== undefined
        ? item.refreshDays
        : item && item.value !== undefined
          ? item.value
          : null;
    const normalized =
      days === null || days === undefined
        ? null
        : Number.isSafeInteger(days) && days >= 1 && days <= 365
          ? days
          : parseRefreshCustomValue(days);
    if (normalized !== null && !(Number.isSafeInteger(normalized) && normalized >= 1 && normalized <= 365)) {
      new Notice("Refresh interval must be 1-365 days");
      return false;
    }
    const refresher = this.getFreshnessRefreshLine();
    const dateText = this.getFreshnessDateText();
    if (typeof refresher !== "function") {
      new Notice("Bob Ledger Tools api v3 required");
      return false;
    }
    if (picker.isLinkSession && picker.isLinkSession()) {
      return await this.applyRefreshIntervalToLinks(picker, normalized, { refresher, dateText });
    }
    if (picker.isCountedSession && picker.isCountedSession()) {
      return await this.applyRefreshIntervalToCounted(picker, normalized, { refresher, dateText });
    }
    return await this.applyRefreshIntervalToSingle(picker, normalized, { refresher, dateText });
  }

  async applyRefreshIntervalToSingle(picker, days, ctx = {}) {
    const editor = picker.editor;
    const cursor = picker.cursor;
    const refresher = ctx.refresher;
    const dateText = ctx.dateText;
    if (!editor || !cursor) {
      new Notice("No active markdown editor");
      return false;
    }
    const content = String(editor.getValue ? editor.getValue() : picker.getEditorContent ? picker.getEditorContent() : "");
    const line = getEditorLine(editor, cursor.line);
    if (line === null || !isObsidianTaskLine(line)) {
      new Notice("Cursor is not on a task");
      return false;
    }
    const status = getObsidianTaskCheckboxStatus(line);
    if (status === null || !OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      new Notice("Task is closed · not updated");
      return false;
    }
    if (isRecurringTaskLine(line)) {
      new Notice("recurring · not updated");
      return false;
    }
    const nextLine = applyFreshRefreshLine(line, refresher, days, dateText);
    if (nextLine === line) {
      new Notice(days === null ? "Already using default" : "Refresh unchanged");
      return true;
    }
    if (!replaceEditorLine(editor, cursor.line, line, nextLine)) {
      new Notice("Could not update refresh interval");
      return false;
    }
    setEditorCursorSafely(editor, cursor.line, Math.min(Math.max(cursor.ch, 0), nextLine.length));
    new Notice(days === null ? "Refresh cleared · using default" : `Refresh every ${days} d`);
    return true;
  }

  async applyRefreshIntervalToCounted(picker, days, ctx = {}) {
    const editor = picker.editor;
    const cursor = picker.cursor;
    const session = picker.taskSession;
    const refresher = ctx.refresher;
    const dateText = ctx.dateText;
    if (!editor || !cursor || !session) {
      new Notice("No active markdown editor");
      return false;
    }
    const writeContext = this.getCountedTaskWriteContext(editor, picker.filePath, session);
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const source = splitMarkdownContent(writeContext.content);
    let changed = 0;
    let skipped = 0;
    for (const target of session.targets) {
      const live = String(source.lines[target.line] || "");
      if (live !== target.rawLine || !isObsidianTaskLine(live)) {
        new Notice("A counted task changed while the picker was open");
        return false;
      }
      const status = getObsidianTaskCheckboxStatus(live);
      if (status === null || !OPEN_OBSIDIAN_TASK_STATUSES.has(status) || isRecurringTaskLine(live)) {
        skipped += 1;
        continue;
      }
      const nextLine = applyFreshRefreshLine(live, refresher, days, dateText);
      if (nextLine !== live) {
        source.lines[target.line] = nextLine;
        changed += 1;
      }
    }
    if (changed === 0) {
      new Notice(skipped > 0 ? "No open tasks to update" : "Refresh unchanged");
      return skipped === 0;
    }
    const finalContent = source.lines.join(source.lineEnding);
    const finalLine = splitMarkdownContent(finalContent).lines[cursor.line] || "";
    if (!applyEditorContentTransaction(editor, writeContext.content, finalContent, {
      line: cursor.line,
      ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
    })) {
      new Notice("Could not update refresh interval");
      return false;
    }
    new Notice(days === null
      ? `Refresh cleared · using default · ${formatCountLabel(changed, "task")}`
      : `Refresh every ${days} d · ${formatCountLabel(changed, "task")}`);
    return true;
  }

  async applyRefreshIntervalToLinks(picker, days, ctx = {}) {
    const linkSession = picker.linkSession;
    const refresher = ctx.refresher;
    const dateText = ctx.dateText;
    if (!linkSession || !Array.isArray(linkSession.resolved) || linkSession.resolved.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const groups = groupLinkPickerTargetsByNote(linkSession.resolved);
    const planned = [];
    for (const group of groups) {
      const source = splitMarkdownContent(group.content);
      let changed = 0;
      for (const target of group.session.targets) {
        const live = String(source.lines[target.line] || "");
        if (live !== target.rawLine || !isObsidianTaskLine(live)) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
        const status = getObsidianTaskCheckboxStatus(live);
        if (status === null || !OPEN_OBSIDIAN_TASK_STATUSES.has(status) || isRecurringTaskLine(live)) {
          continue;
        }
        const nextLine = applyFreshRefreshLine(live, refresher, days, dateText);
        if (nextLine !== live) {
          source.lines[target.line] = nextLine;
          changed += 1;
        }
      }
      planned.push({ group, content: source.lines.join(source.lineEnding), changed });
    }
    const commit = await this.commitLinkPickerNoteWrites(
      planned.map(({ group, content }) => ({
        group,
        plan: Object.freeze({
          content,
          futureScheduledTaskLines: Object.freeze([]),
          changedTaskCount: 0,
          unchangedTaskCount: 0,
          propagatedScheduleTaskCount: 0,
          removedHideTaskCount: 0,
          ambiguousProjectTaskCount: 0,
          blockedTaskCount: 0,
          recoveredReadyTaskCount: 0,
          recoveredNextTaskCount: 0,
          recoveredInProgressTaskCount: 0,
          stillBlockedTaskCount: 0,
          deferredRecoveryTaskCount: 0,
          scheduleLoggedTaskCount: 0,
        }),
      })),
      {},
    );
    // `commitLinkPickerNoteWrites` expects `plan.content`; our synthetic plans
    // carry it, so a failed preimage still refuses. Fall back to direct writes
    // when the shared core rejects the synthetic shape.
    if (!commit.ok) {
      new Notice("A linked note changed; no tasks were updated");
      return false;
    }
    const total = planned.reduce((sum, entry) => sum + entry.changed, 0);
    new Notice(days === null
      ? `Refresh cleared · using default · ${formatCountLabel(total, "task")} via Task Links`
      : `Refresh every ${days} d · ${formatCountLabel(total, "task")} via Task Links`);
    return true;
  }

  // Review-walk auto-advance (nav-gestures): the origin rides in on
  // `options.reviewOrigin` and is settled exactly once — `null` on every
  // refusal, cancel, or failure, and the lane outcome on success.
  async toggleTaskLaneOnTasks(cm, cursor, content, options = {}) {
    const reviewOrigin =
      options && options.reviewOrigin ? options.reviewOrigin : null;
    let reviewSettled = false;
    const settleTaskLaneReview = (outcome) => {
      if (reviewSettled || !reviewOrigin) {
        return;
      }
      reviewSettled = true;
      try {
        void this.continueReviewWalkAfter(reviewOrigin, outcome);
      } catch (error) {
        // `continueReviewWalkAfter` never throws; best effort only.
      }
    };
    try {
      return await this.toggleTaskLaneOnTasksWrite(cm, cursor, content, {
        ...options,
        reviewSettle: settleTaskLaneReview,
        reviewOrigin,
      });
    } finally {
      settleTaskLaneReview(null);
    }
  }

  async toggleTaskLaneOnTasksWrite(cm, cursor, content, options = {}) {
    const settleTaskLaneReview =
      options && typeof options.reviewSettle === "function"
        ? options.reviewSettle
        : null;
    const reviewOrigin =
      options && options.reviewOrigin ? options.reviewOrigin : null;
    const session = discoverCountedObsidianTaskTargets(
      content,
      cursor.line,
      options.countExplicit ? options.additionalTaskCount : 0,
    );
    if (!session.valid) {
      new Notice(session.error);
      return false;
    }
    const activeView = this.getActiveMarkdownView();
    const filePath =
      activeView && activeView.file ? activeView.file.path : null;
    const laneBudgets = readLaneBudgets(this.app);
    // Decide commit vs release from statuses before any prompt.
    const probe = planTaskLaneBatch(content, session, {});
    if (!probe.valid) {
      new Notice(
        probe.stale ? `${probe.error}; no tasks were updated` : probe.error,
      );
      return false;
    }
    let summary = "";
    const dateText = this.laneReleaseDateText(options);
    if (probe.mode === "release") {
      const needsReason = probe.released.some(
        (entry) => entry.fromStatus === "/",
      );
      if (needsReason) {
        const answer = await this.requestLaneReleaseSummary(options);
        if (answer.cancelled) {
          return false;
        }
        summary = answer.summary;
      }
    }
    const plan = planTaskLaneBatch(content, session, {
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
    if (
      cm &&
      typeof cm.getValue === "function" &&
      String(cm.getValue() || "") !== content
    ) {
      new Notice("Current note changed; no tasks were updated");
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
      if (pruneTargets.length > 0 && filePath) {
        pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
          sourcePath: filePath,
          sourceContent: content,
          today: new Date(),
        });
        const guarded = this.getCountedTaskWriteContext(cm, filePath, session);
        if (!guarded.valid || guarded.content !== content) {
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
    const applied = applyEditorContentTransaction(cm, content, finalContent, {
      line: finalCursorLine,
      ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
    });
    if (!applied) {
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
    if (pomodoroPruneFailed) {
      new Notice("Lane updated; Pomodoro links not removed");
    }
    const releasedNextCount = plan.released.filter(
      (entry) => entry.fromStatus === "*",
    ).length;
    const releasedPendingCount = plan.released.filter(
      (entry) => entry.fromStatus === "/",
    ).length;
    const laneNoticeText = buildLaneToggleNotice({
      mode: plan.mode,
      changedTaskCount: plan.changedTaskCount,
      blockedSkipped: plan.blockedSkipped,
      unlinkedFromToday: removedPomodoroLinkCount,
      releasedNextCount,
      releasedPendingCount,
      laneBudgets,
    });
    if (settleTaskLaneReview && reviewOrigin) {
      // The separate Pomodoro-prune warning stays its own notice; the lane
      // text becomes the advance preamble.
      const sourceLines = String(content || "").split(/\r?\n/);
      settleTaskLaneReview({
        kind: "lane",
        handledRefs: session.targets
          .filter((target) => target && Number.isInteger(target.line))
          .map((target) =>
            Object.freeze({
              path: filePath,
              line: target.line,
              raw: String(sourceLines[target.line] ?? target.rawLine ?? ""),
            }),
          ),
        notice: laneNoticeText,
      });
    } else {
      new Notice(laneNoticeText);
    }
    return true;
  }
}
