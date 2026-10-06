class BobNavigationHotkeysLinkRollScheduleMixin {

  // Commit one composed recommended-roll write across every note behind the
  // picker's Task Links: each note group is planned with
  // `planRecommendedRollBatch` (cancel first, then set-priority), the union
  // of cancelled block IDs and future-scheduled lines is pruned from today's
  // open Pomodoros in one pass, and cancelled identities run dependent
  // recovery. Every preimage is re-verified before the first write; any
  // mismatch refuses the whole operation.
  async applyLinkRecommendedRoll(picker, options = {}) {
    const linkSession = picker.linkSession;
    const cached = picker.linkRollBatch;
    if (!linkSession || !cached) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    if (cached.unavailableReason) {
      new Notice(cached.unavailableReason);
      return false;
    }
    const property = picker.findPriorityPropertyByName
      ? picker.findPriorityPropertyByName(cached.priorityName)
      : (this.config &&
          this.config.properties &&
          this.config.properties.find(
            (candidate) =>
              candidate &&
              candidate.values === "priority" &&
              normalizeBulletPropertyName(candidate.name) ===
                normalizeBulletPropertyName(cached.priorityName),
          )) ||
        null;
    if (!property) {
      new Notice("Task changed while the picker was open; nothing was written");
      return false;
    }
    const fresh = picker.computeLinkRollBatch
      ? picker.computeLinkRollBatch()
      : null;
    if (
      !fresh ||
      fresh.actionableCount !== cached.actionableCount ||
      fresh.counts.roll !== cached.counts.roll ||
      fresh.counts.decay !== cached.counts.decay ||
      fresh.counts.cancel !== cached.counts.cancel ||
      Boolean(fresh.unavailableReason) !== Boolean(cached.unavailableReason)
    ) {
      new Notice("Task changed while the picker was open; nothing was written");
      if (picker.returnHome) {
        picker.linkRollBatch = fresh;
        picker.linkRollBatchReady = true;
        picker.returnHome({ rebuild: true });
      }
      return false;
    }
    const baseDate =
      picker.valueBaseDate instanceof Date
        ? getLocalDateStart(picker.valueBaseDate)
        : getLocalDateStart(new Date());
    const dateText = formatBulletPropertyDate(baseDate);
    const groups = groupLinkPickerTargetsByNote(linkSession.resolved);
    if (groups.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    // Any changed preimage refuses the whole operation before planning.
    for (const group of groups) {
      const live = await this.readLinkPickerNoteContent(
        group.path,
        group.file,
      );
      if (live !== group.content) {
        new Notice("A linked note changed; no tasks were updated");
        return false;
      }
    }
    const planned = [];
    for (const group of groups) {
      const summary = planPriorityRollRecommendationsForTargets(
        group.content,
        group.session.targets,
        property,
        {
          baseDate: picker.valueBaseDate,
          random:
            typeof picker.priorityRandom === "function"
              ? picker.priorityRandom
              : Math.random,
        },
      );
      const recommendationsByLine = new Map(
        summary.entries
          .filter((entry) => entry.recommendation)
          .map((entry) => [entry.line, entry.recommendation]),
      );
      if (recommendationsByLine.size === 0) {
        continue;
      }
      const updateEntries = summary.entries.filter(
        (entry) =>
          entry.recommendation &&
          (entry.recommendation.kind === "roll" ||
            entry.recommendation.kind === "decay"),
      );
      let recoveryByLine = null;
      if (
        updateEntries.some((entry) =>
          isDueInlineScheduledValue(entry.recommendation.date, baseDate),
        )
      ) {
        recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          group.path,
          group.content,
          updateEntries.map((entry) => entry.line),
          baseDate,
        );
        const guarded = await this.readLinkPickerNoteContent(
          group.path,
          group.file,
        );
        if (guarded !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
      }
      const plan = planRecommendedRollBatch(
        group.content,
        group.session,
        recommendationsByLine,
        {
          property,
          dateText,
          baseDate,
          recoveryByLine,
          schedulingWorkLog: options.schedulingWorkLog || options.workLog,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        },
      );
      if (!plan.valid) {
        new Notice(
          plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
        );
        return false;
      }
      planned.push({ group, plan });
    }
    if (planned.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }

    const pruneTargets = [];
    for (const { group, plan } of planned) {
      for (const entry of plan.cancelledEntries || []) {
        if (entry.blockId) {
          pruneTargets.push(
            Object.freeze({ path: group.path, blockId: entry.blockId }),
          );
        }
      }
      const futureLines = Array.from(plan.futureScheduledTaskLines || []);
      if (futureLines.length > 0) {
        pruneTargets.push(
          ...deferredPomodoroTargetsFromLines(
            group.path,
            splitMarkdownContent(group.content).lines,
            futureLines,
          ),
        );
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
      for (const group of groups) {
        const live = await this.readLinkPickerNoteContent(
          group.path,
          group.file,
        );
        if (live !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
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
    const removedPomodoroLinkCount =
      dailyCleanupPlan && dailyCleanupPlan.changed && !commit.pomodoroPruneFailed
        ? dailyCleanupPlan.removedLinkCount
        : 0;

    const cancelledIdentities = [];
    for (const { group, plan } of planned) {
      for (const entry of plan.cancelledEntries || []) {
        cancelledIdentities.push(
          Object.freeze({
            path: group.path,
            blockId: entry.blockId,
            taskId: entry.taskId,
          }),
        );
      }
    }
    if (cancelledIdentities.length > 0) {
      try {
        const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
        const holder = plugins && plugins["task-status-cycler"];
        const api = holder && holder.api;
        if (
          api &&
          typeof api.recoverBlockedDependents === "function" &&
          Number(api.version) >= 1
        ) {
          await api.recoverBlockedDependents(cancelledIdentities, {
            activePath: picker.filePath,
            editor: picker.editor,
          });
        }
      } catch (error) {
        // The hooks recover them later.
      }
    }

    const scheduledValues = [];
    for (const entry of fresh.entries) {
      if (
        entry.recommendation &&
        (entry.recommendation.kind === "roll" ||
          entry.recommendation.kind === "decay")
      ) {
        scheduledValues.push(entry.recommendation.date);
      }
    }
    scheduledValues.sort();
    const outcome = {
      blockedTaskCount: 0,
      propagatedScheduleTaskCount: 0,
      removedHideTaskCount: 0,
      ambiguousTaskCount: 0,
      unchangedTaskCount: 0,
      recoveredReadyTaskCount: 0,
      recoveredNextTaskCount: 0,
      recoveredInProgressTaskCount: 0,
      stillBlockedTaskCount: 0,
      deferredRecoveryTaskCount: 0,
      scheduleLoggedTaskCount: 0,
      schedulingWorkLogWrittenCount: 0,
      skippedCount: fresh.skippedCount,
      skippedClosedCount: 0,
      removedPomodoroLinkCount,
      pomodoroPruneFailed: commit.pomodoroPruneFailed,
    };
    for (const { plan } of planned) {
      const priorityPlan = plan.priorityPlan;
      const cancelPlan = plan.cancelPlan;
      if (priorityPlan) {
        outcome.blockedTaskCount += priorityPlan.blockedTaskCount || 0;
        outcome.propagatedScheduleTaskCount +=
          priorityPlan.propagatedScheduleTaskCount || 0;
        outcome.removedHideTaskCount += priorityPlan.removedHideTaskCount || 0;
        outcome.ambiguousTaskCount +=
          priorityPlan.ambiguousProjectTaskCount || 0;
        outcome.unchangedTaskCount += priorityPlan.unchangedTaskCount || 0;
        outcome.recoveredReadyTaskCount +=
          priorityPlan.recoveredReadyTaskCount || 0;
        outcome.recoveredNextTaskCount +=
          priorityPlan.recoveredNextTaskCount || 0;
        outcome.recoveredInProgressTaskCount +=
          priorityPlan.recoveredInProgressTaskCount || 0;
        outcome.stillBlockedTaskCount +=
          priorityPlan.stillBlockedTaskCount || 0;
        outcome.deferredRecoveryTaskCount +=
          priorityPlan.deferredRecoveryTaskCount || 0;
        outcome.scheduleLoggedTaskCount +=
          priorityPlan.scheduleLoggedTaskCount || 0;
        outcome.schedulingWorkLogWrittenCount +=
          priorityPlan.schedulingWorkLogWrittenCount || 0;
      }
      if (cancelPlan) {
        outcome.scheduleLoggedTaskCount += cancelPlan.loggedCount || 0;
        outcome.skippedClosedCount += cancelPlan.skippedClosedCount || 0;
      }
    }
    showPriorityNotice(
      buildBatchPriorityRollNoticeModel(fresh, {
        baseDate,
        scheduledValues,
        outcome,
      }),
      { ...(options || {}), app: this.app },
    );
    return true;
  }

  async deleteCountedBulletPropertyValue(
    cm,
    cursor,
    filePath,
    session,
    name,
  ) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    if (normalizeBulletPropertyName(name) === "dependsOn") {
      return this.deleteCountedDependencyLinesAndFields(
        cm,
        cursor,
        filePath,
        session,
      );
    }
    let recoveryByLine = null;
    if (normalizeBulletPropertyName(name) === "scheduled") {
      const includesProjectSchedule = session.targets.some((target) =>
        isProjectLifecycleTaskAtLine(writeContext.content, target.line),
      );
      const recoveryLines = includesProjectSchedule
        ? getProjectScheduleRecoveryTargetLines(writeContext.content)
        : session.targets.map((target) => target.line);
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        recoveryLines,
        new Date(),
      );
      const guarded = this.getCountedTaskWriteContext(
        cm,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return null;
      }
    }
    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      name,
      null,
      {
        operation: "delete",
        recoveryByLine,
        stampLine: this.getFreshnessStampLine(),
        freshDateText: this.getFreshnessDateText(),
      },
    );
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return null;
    }
    const finalLine = splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
    try {
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          plan.content,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted property transaction");
      }
    } catch (error) {
      new Notice("Could not delete counted task properties; no tasks were updated");
      return null;
    }
    new Notice(
      `${name} ✗ removed from ${formatCountLabel(
        plan.changedTaskCount,
        "task",
      )}${this.getCountedTaskNoticeSuffix(
        session,
        plan.unchangedTaskCount,
      )}${
        plan.removedProjectScheduleTaskCount > 0
          ? `; removed propagated schedule from ${formatCountLabel(
              plan.removedProjectScheduleTaskCount,
              "task",
            )}`
          : ""
      }${scheduledRecoveryNoticeSuffix({
        ready: plan.recoveredReadyTaskCount,
        next: plan.recoveredNextTaskCount,
        inProgress: plan.recoveredInProgressTaskCount,
        stillBlocked: plan.stillBlockedTaskCount,
        deferred: plan.deferredRecoveryTaskCount,
      })}`,
    );
    return { deleted: true, line: finalLine };
  }

  async applyCountedLocalTaskDependency(
    cm,
    cursor,
    filePath,
    session,
    dependencyTask,
    options = {},
  ) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const normalizedPath = normalizeVaultRelativePath(filePath);
    const hasQuestionSource = String(writeContext.content || "")
      .split(/\r?\n/)
      .some((line, index) => {
        if (!(session.targets || []).some((target) => target.line === index)) {
          return false;
        }
        return getObsidianTaskCheckboxStatus(String(line || "")) === "?";
      });
    const countedRecoveryBase = {
      registry: await readTasksStatusRegistry(this.app),
      today: new Date(),
      vaultContents: null,
    };
    const countedOptions = {
      ...options,
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
      vaultFiles: this.readDependencyVaultFileList(),
      resolveLinkpath: this.dependencyLinkpathResolver(),
    };
    // The toggle direction comes from the pure planner: adds never recover
    // (contract), so the vault snapshot is only read when the toggle will
    // remove from a `[?]` source. The preview below is valid exactly when
    // the final plan is (recovery never changes validity or direction), so
    // an invalid toggle reads nothing.
    const preview = planCountedLocalTaskDependency(
      writeContext.content,
      session,
      dependencyTask,
      filePath,
      { ...countedOptions, recovery: countedRecoveryBase },
    );
    if (!preview.valid) {
      const suffix = preview.stale ? "; no tasks were updated" : "";
      new Notice(`${preview.error}${suffix}`);
      return false;
    }
    let plan = preview;
    if (preview.operation === "remove" && hasQuestionSource) {
      plan = planCountedLocalTaskDependency(
        writeContext.content,
        session,
        dependencyTask,
        filePath,
        {
          ...countedOptions,
          recovery: {
            ...countedRecoveryBase,
            vaultContents: await this.readDependencyRecoveryVaultContents(
              normalizedPath,
              writeContext.content,
            ),
          },
        },
      );
    }
    if (!plan.valid) {
      const suffix = plan.stale ? "; no tasks were updated" : "";
      new Notice(`${plan.error}${suffix}`);
      return false;
    }
    const finalLine = splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
    try {
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          plan.content,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted dependency transaction");
      }
    } catch (error) {
      new Notice("Could not update counted dependencies; no tasks were updated");
      return false;
    }
    const verb = plan.operation === "remove" ? "Removed" : "Added";
    const identity = plan.targetIdentityChanged
      ? `; prepared ^${plan.linkBlockId}`
      : "";
    new Notice(
      `${verb} ${plan.dependencyValue} ${
        plan.operation === "remove" ? "from" : "to"
      } ${formatCountLabel(plan.targetCount, "task")}${identity}${
        this.getCountedTaskNoticeSuffix(session, plan.unchangedTaskCount)
      }`,
    );
    return true;
  }

  getProjectScheduledWriteContext(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
    operation = "updated",
  ) {
    const activeView = this.getActiveMarkdownView();
    if (
      !activeView ||
      activeView.editor !== cm ||
      !activeView.file ||
      activeView.file.path !== filePath
    ) {
      return Object.freeze({
        valid: false,
        error: `Active project note changed; scheduled was not ${operation}`,
      });
    }
    if (!cm || typeof cm.getValue !== "function") {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }

    const content = String(cm.getValue() || "");
    const liveCursor = getEditorCursor(cm);
    if (!liveCursor || liveCursor.line !== cursor.line) {
      return Object.freeze({
        valid: false,
        error: `Cursor moved from the ^prj task; scheduled was not ${operation}`,
      });
    }
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText !== expectedLine) {
      return Object.freeze({
        valid: false,
        error: `The ^prj task changed; scheduled was not ${operation}`,
      });
    }

    const propertyContext = getProjectNotePropertyContext(content, cursor.line);
    if (!propertyContext.valid || !propertyContext.isProjectTask) {
      return Object.freeze({
        valid: false,
        error:
          propertyContext.error ||
          "Cursor is no longer on a valid ^prj task",
      });
    }
    const currentValue = propertyContext.frontmatter.scheduledDefined
      ? propertyContext.frontmatter.scheduledValue
      : "";
    if (currentValue !== normalizeBulletPropertyValue(expectedValue)) {
      return Object.freeze({
        valid: false,
        error: `Project scheduled changed while the picker was open; it was not ${operation}`,
      });
    }

    return Object.freeze({
      valid: true,
      content,
      propertyContext,
    });
  }

  async setProjectNoteScheduledValue(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
    value,
    options = {},
  ) {
    const writeContext = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }

    const today =
      options.today instanceof Date ? getLocalDateStart(options.today) : new Date();
    let recoveryByLine = null;
    if (isDueInlineScheduledValue(value, today)) {
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        getProjectScheduleRecoveryTargetLines(writeContext.content),
        today,
      );
      const guarded = this.getProjectScheduledWriteContext(
        cm,
        cursor,
        filePath,
        expectedLine,
        expectedValue,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active project note changed; scheduled was not updated"
            : guarded.error,
        );
        return false;
      }
    }
    const plan = planProjectScheduledUpdate(
      writeContext.content,
      cursor.line,
      value,
      today,
      { recoveryByLine },
    );
    if (!plan.valid) {
      new Notice(plan.error);
      return false;
    }

    const plannedSource = splitMarkdownContent(plan.content);
    let finalLine = plannedSource.lines[plan.cursorLine] || "";
    const inlineResult = applyBulletPropertyEdits(
      finalLine,
      options.inlineEdits,
    );
    if (inlineResult.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }
    finalLine = inlineResult.line;
    plannedSource.lines[plan.cursorLine] = finalLine;

    let scheduleLogOutcome = null;
    if (hasScheduleLogReasonInput(options.scheduleLog)) {
      const scheduleLogPlan = planScheduleLogEntry(
        plannedSource.lines.join(plannedSource.lineEnding),
        plan.cursorLine,
        options.scheduleLog,
      );
      scheduleLogOutcome = getScheduleLogWriteOutcome(
        scheduleLogPlan,
        scheduleLogPlan.valid && applyScheduleLogEntryToLines(plannedSource.lines, scheduleLogPlan) > 0,
      );
    }

    const projectSchedulingWorkLogInput =
      options.schedulingWorkLog && typeof options.schedulingWorkLog === "object"
        ? options.schedulingWorkLog
        : options.workLog && typeof options.workLog === "object"
          ? options.workLog
          : null;
    let projectWorkLogWritten = false;
    if (hasSchedulingWorkLogInput(projectSchedulingWorkLogInput)) {
      const eligibilityLine = String(expectedLine ?? lineText ?? "");
      if (isSchedulingWorkLogRawLine(eligibilityLine)) {
        const summary = normalizeSchedulingWorkSummary(
          projectSchedulingWorkLogInput.summary,
        );
        if (summary) {
          const dateText = resolveSchedulingWorkLogDateText(
            projectSchedulingWorkLogInput,
            undefined,
          );
          if (
            insertLaneWorkLogEntry(
              plannedSource.lines,
              plan.cursorLine,
              summary,
              dateText,
            )
          ) {
            projectWorkLogWritten = true;
          }
        }
      }
    }

    let finalContent = plannedSource.lines.join(plannedSource.lineEnding);
    let finalCursorLine = plan.cursorLine;

    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.futureScheduledTaskLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today,
      });
      const guarded = this.getProjectScheduledWriteContext(
        cm,
        cursor,
        filePath,
        expectedLine,
        expectedValue,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active project note changed; scheduled was not updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        const targets = deferredPomodoroTargetsFromLines(
          filePath,
          splitMarkdownContent(writeContext.content).lines,
          plan.futureScheduledTaskLines,
        );
        if (targets.length > 0) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (dailyCleanupPlan.changed) {
              const linesRemovedBeforeCursor =
                dailyCleanupPlan.removedLineRanges.reduce(
                  (total, range) =>
                    range.endLineExclusive <= plan.cursorLine
                      ? total + (range.endLineExclusive - range.startLine)
                      : total,
                  0,
                );
              finalContent = dailyCleanupPlan.content;
              finalCursorLine = plan.cursorLine - linesRemovedBeforeCursor;
            }
          } else {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              pomodoroSnapshot.content,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
        }
      }
    }

    try {
      if (
        finalContent !== writeContext.content &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          finalContent,
          {
            line: finalCursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot replace note content");
      }
    } catch (error) {
      new Notice("Could not update project scheduled");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (
      dailyCleanupPlan &&
      dailyCleanupPlan.changed &&
      pomodoroSnapshot &&
      !pomodoroSnapshot.sameFile
    ) {
      const written = await this.writeDeferredPomodoroCleanup(
        pomodoroSnapshot,
        dailyCleanupPlan,
      );
      if (written) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        pomodoroPruneFailed = true;
      }
    } else if (
      dailyCleanupPlan &&
      dailyCleanupPlan.changed &&
      pomodoroSnapshot &&
      pomodoroSnapshot.sameFile
    ) {
      removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
    }

    const parts = [`scheduled → ${plan.scheduled}`];
    if (plan.scheduledTaskCount > 0) {
      parts.push(
        `scheduled ${formatCountLabel(plan.scheduledTaskCount, "task")}`,
      );
    }
    if (plan.removedHideTaskCount > 0) {
      parts.push(
        `removed #hide from ${formatCountLabel(
          plan.removedHideTaskCount,
          "task",
        )}`,
      );
    }
    if (plan.blockedTaskCount > 0) {
      parts.push(
        `marked ${formatCountLabel(plan.blockedTaskCount, "task")} Blocked`,
      );
    }
    if (plan.ambiguousTaskLines.length > 0) {
      parts.push(
        `${formatCountLabel(
          plan.ambiguousTaskLines.length,
          "task",
        )} with multiple scheduled fields unchanged`,
      );
    }
    if (scheduleLogOutcome === "created" || scheduleLogOutcome === "added") {
      parts.push("logged reason");
    } else if (scheduleLogOutcome === "added-fallback") {
      parts.push("logged without a reason");
    } else if (scheduleLogOutcome === "guard-failed") {
      parts.push("schedule log not written");
    }
    if (projectWorkLogWritten) {
      parts.push("1 Work Log");
    }
    const recoveryCounts = {
      ready: plan.recoveredReadyTaskCount,
      next: plan.recoveredNextTaskCount,
      inProgress: plan.recoveredInProgressTaskCount,
      stillBlocked: plan.stillBlockedTaskCount,
      deferred: plan.deferredRecoveryTaskCount,
    };
    if (typeof options.buildNotice === "function") {
      showPriorityNotice(
        options.buildNotice({
          scheduled: plan.scheduled,
          scheduledTaskCount: plan.scheduledTaskCount,
          removedHideTaskCount: plan.removedHideTaskCount,
          blockedTaskCount: plan.blockedTaskCount,
          ambiguousTaskCount: plan.ambiguousTaskLines.length,
          recoveryCounts,
          scheduleLogOutcome,
          schedulingWorkLogWrittenCount: projectWorkLogWritten ? 1 : 0,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        }),
        { ...(options || {}), app: this.app },
      );
    } else {
      const pomodoroPruneSuffix =
        removedPomodoroLinkCount > 0
          ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
          : pomodoroPruneFailed
            ? "; Pomodoro links not removed"
            : "";
      new Notice(
        `${parts.join("; ")}${scheduledRecoveryNoticeSuffix(recoveryCounts)}${pomodoroPruneSuffix}`,
      );
    }
    return true;
  }
}
