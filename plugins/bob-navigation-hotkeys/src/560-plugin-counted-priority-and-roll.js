class BobNavigationHotkeysCountedRollMixin {

  async setCountedBulletPriorityValue(
    cm,
    cursor,
    filePath,
    session,
    property,
    level,
    options = {},
  ) {
    if (!property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }

    const baseDate =
      options.baseDate instanceof Date
        ? getLocalDateStart(options.baseDate)
        : getLocalDateStart(new Date());
    const random =
      typeof options.random === "function" ? options.random : Math.random;
    const precomputedRollByLine =
      options.precomputedRollByLine instanceof Map
        ? options.precomputedRollByLine
        : options.rollByLine instanceof Map
          ? options.rollByLine
          : null;
    const precomputedScheduledValueByLine =
      options.precomputedScheduledValueByLine instanceof Map
        ? options.precomputedScheduledValueByLine
        : options.scheduledValueByLine instanceof Map
          ? options.scheduledValueByLine
          : null;
    const rollByLine =
      precomputedRollByLine ||
      new Map(
        session.targets.map((target) => [
          target.line,
          rollPriorityScheduledDateWithOffset(level, baseDate, random),
        ]),
      );
    const scheduledValueByLine =
      precomputedScheduledValueByLine ||
      new Map(
        Array.from(rollByLine, ([line, roll]) => [
          line,
          formatBulletPropertyDate(roll.date),
        ]),
      );
    const includesDueDate = Array.from(scheduledValueByLine.values()).some(
      (scheduledValue) =>
        isDueInlineScheduledValue(scheduledValue, baseDate),
    );
    let recoveryByLine = null;
    if (includesDueDate) {
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
        baseDate,
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
        return false;
      }
    }

    // `target.rawLine` is guaranteed to equal the live line here —
    // getCountedTaskWriteContext ran validateCountedTaskSession above — so the
    // previous priority can be read straight off it.
    const scheduleLogReasonByLine = new Map(
      session.targets.map((target) => [
        target.line,
        formatPriorityRollScheduleReason({
          source: "priority",
          level,
          rolledDays: (rollByLine.get(target.line) || {}).offset,
          fromLevelLabel: getPriorityRollFromLevelLabel(
            property,
            (findBulletPropertyField(target.rawLine, property.name) || {}).value || "",
          ),
        }),
      ]),
    );

    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      property.name,
      null,
      {
        operation: "set-priority",
        priorityValue: level.value,
        scheduledPropertyName: property.schedules,
        scheduledValueByLine,
        today: baseDate,
        recoveryByLine,
        scheduleLog: { automatic: true, reasonByLine: scheduleLogReasonByLine },
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

    let finalContent = plan.content;
    let finalCursorLine = plan.cursorLine;
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.futureScheduledTaskLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today: baseDate,
      });
      const guarded = this.getCountedTaskWriteContext(cm, filePath, session);
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
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

    const finalLine =
      splitMarkdownContent(finalContent).lines[finalCursorLine] || "";
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
        throw new Error("Editor cannot apply a counted priority transaction");
      }
    } catch (error) {
      new Notice("Could not update counted task priorities; no tasks were updated");
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

    showPriorityNotice(
      buildPriorityNoticeModel({
        property,
        level,
        levelIndex: normalizePriorityLevelIndex(property, level),
        baseDate,
        scheduledValues: Array.from(scheduledValueByLine.values()),
        taskCount: plan.changedTaskCount,
        scope: "counted",
        outcome: {
          blockedTaskCount: plan.blockedTaskCount,
          propagatedScheduleTaskCount: plan.propagatedScheduleTaskCount,
          removedHideTaskCount: plan.removedHideTaskCount,
          ambiguousTaskCount: plan.ambiguousProjectTaskCount,
          unchangedTaskCount: plan.unchangedTaskCount,
          session,
          recoveredReadyTaskCount: plan.recoveredReadyTaskCount,
          recoveredNextTaskCount: plan.recoveredNextTaskCount,
          recoveredInProgressTaskCount: plan.recoveredInProgressTaskCount,
          stillBlockedTaskCount: plan.stillBlockedTaskCount,
          deferredRecoveryTaskCount: plan.deferredRecoveryTaskCount,
          scheduleLoggedTaskCount: plan.scheduleLoggedTaskCount,
          schedulingWorkLogWrittenCount: plan.schedulingWorkLogWrittenCount,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        },
      }),
      options,
    );
    return true;
  }

  // Compose the counted recommended roll into one undoable editor transaction:
  // cancel targets first (each with its own streak reason), then roll/decay
  // targets through set-priority, pruning today's open Pomodoro links in one
  // pass. Mirrors setCountedBulletPriorityValue and applyTaskCancelFromEditor
  // guards (write context, stale-session refusal) plus task-status-cycler
  // recovery for cancelled identities.
  async applyCountedRecommendedRoll(picker, options = {}) {
    const editor = picker.editor;
    const cursor = picker.cursor;
    const filePath = picker.filePath;
    const session = picker.taskSession;
    const cached = picker.countedRollBatch;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !cursor ||
      !session ||
      !cached
    ) {
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
    const writeContext = this.getCountedTaskWriteContext(
      editor,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const fresh = picker.computeCountedRollBatch
      ? picker.computeCountedRollBatch()
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
        picker.countedRollBatch = fresh;
        picker.countedRollBatchReady = true;
        picker.returnHome({ rebuild: true });
      }
      return false;
    }
    const baseDate =
      picker.valueBaseDate instanceof Date
        ? getLocalDateStart(picker.valueBaseDate)
        : getLocalDateStart(new Date());
    const dateText = formatBulletPropertyDate(baseDate);
    const recommendationsByLine = new Map(
      fresh.entries
        .filter((entry) => entry.recommendation)
        .map((entry) => [entry.line, entry.recommendation]),
    );
    const updateLines = fresh.entries
      .filter(
        (entry) =>
          entry.recommendation &&
          (entry.recommendation.kind === "roll" ||
            entry.recommendation.kind === "decay"),
      )
      .map((entry) => entry.line);
    let recoveryByLine = null;
    if (updateLines.length > 0) {
      const includesProjectSchedule = session.targets.some((target) =>
        isProjectLifecycleTaskAtLine(writeContext.content, target.line),
      );
      const recoveryLines = includesProjectSchedule
        ? getProjectScheduleRecoveryTargetLines(writeContext.content)
        : updateLines;
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        recoveryLines,
        baseDate,
      );
      const guarded = this.getCountedTaskWriteContext(
        editor,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
    }
    const plan = planRecommendedRollBatch(
      writeContext.content,
      session,
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
    let finalContent = plan.content;
    let finalCursorLine = cursor.line;
    try {
      const shift = plan.cursorLineShift || ((line) => line);
      finalCursorLine = shift(cursor.line);
    } catch (error) {
      finalCursorLine = cursor.line;
    }
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    const pruneTargets = [];
    for (const entry of plan.cancelledEntries || []) {
      if (entry.blockId) {
        pruneTargets.push(
          Object.freeze({ path: filePath, blockId: entry.blockId }),
        );
      }
    }
    const futureLines = Array.from(plan.futureScheduledTaskLines || []);
    if (pruneTargets.length > 0 || futureLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today: baseDate,
      });
      const guarded = this.getCountedTaskWriteContext(
        editor,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        const deferredTargets = [];
        if (pruneTargets.length > 0) {
          deferredTargets.push(...pruneTargets);
        }
        if (futureLines.length > 0) {
          deferredTargets.push(
            ...deferredPomodoroTargetsFromLines(
              filePath,
              splitMarkdownContent(writeContext.content).lines,
              futureLines,
            ),
          );
        }
        if (deferredTargets.length > 0) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              deferredTargets,
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
              deferredTargets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
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
        throw new Error("Editor cannot apply a counted roll transaction");
      }
    } catch (error) {
      new Notice("Could not update counted task priorities; no tasks were updated");
      return false;
    }
    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    let postPruneDailyContent = null;
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
        postPruneDailyContent = dailyCleanupPlan.content;
      }
    }
    const cancelledIdentities = (plan.cancelledEntries || []).map((entry) =>
      Object.freeze({
        path: filePath,
        blockId: entry.blockId,
        taskId: entry.taskId,
      }),
    );
    let reopened = 0;
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
          const result = await api.recoverBlockedDependents(
            cancelledIdentities,
            { activePath: filePath, editor },
          );
          reopened = Math.max(
            0,
            Math.floor(numericOrDefault(result && result.reopened, 0)),
          );
        }
      } catch (error) {
        reopened = 0;
      }
    }
    const priorityPlan = plan.priorityPlan;
    const cancelPlan = plan.cancelPlan;
    const scheduledValues = [];
    if (priorityPlan && priorityPlan.content !== undefined) {
      for (const entry of fresh.entries) {
        if (
          entry.recommendation &&
          (entry.recommendation.kind === "roll" ||
            entry.recommendation.kind === "decay")
        ) {
          scheduledValues.push(entry.recommendation.date);
        }
      }
    }
    scheduledValues.sort();
    showPriorityNotice(
      buildBatchPriorityRollNoticeModel(fresh, {
        baseDate,
        scheduledValues,
        outcome: {
          blockedTaskCount: priorityPlan ? priorityPlan.blockedTaskCount : 0,
          propagatedScheduleTaskCount: priorityPlan
            ? priorityPlan.propagatedScheduleTaskCount
            : 0,
          removedHideTaskCount: priorityPlan
            ? priorityPlan.removedHideTaskCount
            : 0,
          ambiguousTaskCount: priorityPlan
            ? priorityPlan.ambiguousProjectTaskCount
            : 0,
          unchangedTaskCount: priorityPlan
            ? priorityPlan.unchangedTaskCount
            : 0,
          session,
          recoveredReadyTaskCount: priorityPlan
            ? priorityPlan.recoveredReadyTaskCount
            : 0,
          recoveredNextTaskCount: priorityPlan
            ? priorityPlan.recoveredNextTaskCount
            : 0,
          recoveredInProgressTaskCount: priorityPlan
            ? priorityPlan.recoveredInProgressTaskCount
            : 0,
          stillBlockedTaskCount: priorityPlan
            ? priorityPlan.stillBlockedTaskCount
            : 0,
          deferredRecoveryTaskCount: priorityPlan
            ? priorityPlan.deferredRecoveryTaskCount
            : 0,
          scheduleLoggedTaskCount:
            (priorityPlan ? priorityPlan.scheduleLoggedTaskCount : 0) +
            (cancelPlan ? cancelPlan.loggedCount : 0),
          schedulingWorkLogWrittenCount: priorityPlan
            ? priorityPlan.schedulingWorkLogWrittenCount || 0
            : 0,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
          skippedCount: fresh.skippedCount,
          skippedClosedCount: cancelPlan ? cancelPlan.skippedClosedCount : 0,
        },
      }),
      options,
    );
    if (postPruneDailyContent !== null) {
      try {
        const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
        const holder = plugins && plugins["task-status-cycler"];
        const api = holder && holder.api;
        if (api && typeof api.recoverBlockedDependents === "function") {
          await api.recoverBlockedDependents(cancelledIdentities, {
            activePath: filePath,
            editor,
          });
        }
      } catch (error) {
        // Recovery already attempted above; ignore a second failure.
      }
    }
    void reopened;
    return true;
  }
}
