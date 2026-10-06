class BobNavigationHotkeysCancelPropertyMixin {

  // Link-session cancels plan every target note with the pure planner and
  // commit through the shared `commitLinkPickerNoteWrites` core: every
  // preimage is re-verified before the first write, targets write first, the
  // daily-note prune folds into the daily note's own write when it is a
  // target note, target writes roll back when one fails, and a failed prune
  // is reported but never rolled back.
  async applyTaskCancelFromLinkPicker(picker, cancel) {
    const linkSession = picker.linkSession;
    const resolved = Array.isArray(linkSession.resolved)
      ? linkSession.resolved
      : [];
    if (resolved.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const groups = groupLinkPickerTargetsByNote(resolved);
    if (groups.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const planned = [];
    for (const group of groups) {
      const plan = planTaskCancelBatch(group.content, group.session, {
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
      planned.push({ group, plan });
    }

    const pruneTargets = [];
    for (const { group, plan } of planned) {
      for (const entry of plan.cancelled) {
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
        today: cancel.baseDate,
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
    const identities = [];
    let cancelledCount = 0;
    let skippedClosedCount = 0;
    let fallbackLoggedCount = 0;
    for (const { group, plan } of planned) {
      cancelledCount += plan.cancelledCount;
      skippedClosedCount += plan.skippedClosedCount;
      fallbackLoggedCount += plan.fallbackLoggedCount;
      for (const entry of plan.cancelled) {
        identities.push(
          Object.freeze({
            path: group.path,
            blockId: entry.blockId,
            taskId: entry.taskId,
          }),
        );
      }
    }
    const postPruneDailyContent =
      dailyCleanupPlan && dailyCleanupPlan.changed
        ? dailyCleanupPlan.content
        : null;
    return await this.finishTaskCancelNotice(picker, {
      identities,
      activePath: picker.filePath,
      editor: picker.editor,
      count: Math.max(1, cancelledCount),
      viaLinks: true,
      dateText: cancel.dateText,
      reason: cancel.reason,
      fallbackUsed: fallbackLoggedCount > 0,
      skippedClosedCount,
      removedPomodoroLinkCount,
      pomodoroPruneFailed: commit.pomodoroPruneFailed,
      postPruneDailyContent,
    });
  }

  // Shared cancel completion: close the modal as soon as the writes land,
  // recover Blocked dependents through Task Status Cycler's versioned API
  // (skipped silently when missing, throwing, or rejecting — the hooks
  // recover them later), then show exactly one Cancelled notice card after
  // recovery settles.
  async finishTaskCancelNotice(picker, details = {}) {
    // Review-walk auto-advance (nav-gestures): the cancel card must precede
    // the landing toast, but this route closes the picker before its notice.
    // Defer the modal's own settle and settle after the notice instead.
    if (picker) {
      try {
        picker.reviewSettleDeferred = true;
      } catch (error) {
        // A picker without review state simply has nothing to defer.
      }
    }
    if (picker && typeof picker.close === "function") {
      try {
        picker.close();
      } catch (error) {
        // The outer openItemAtIndex closes the modal anyway.
      }
    }
    const identities = Array.isArray(details.identities)
      ? details.identities
      : [];
    let reopened = 0;
    let recoveryRan = false;
    if (identities.length > 0) {
      try {
        const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
        const holder = plugins && plugins["task-status-cycler"];
        const api = holder && holder.api;
        if (
          api &&
          typeof api.recoverBlockedDependents === "function" &&
          Number(api.version) >= 1
        ) {
          recoveryRan = true;
          const result = await api.recoverBlockedDependents(identities, {
            activePath: details.activePath,
            editor: details.editor,
          });
          reopened = Math.max(
            0,
            Math.floor(numericOrDefault(result && result.reopened, 0)),
          );
        }
      } catch (error) {
        recoveryRan = false;
        reopened = 0;
      }
    }
    // The plan chip covers the prune only: it needs the post-prune daily
    // note text, and is omitted when nothing was pruned or the API is
    // unavailable.
    const planChip =
      details.postPruneDailyContent !== null &&
      details.postPruneDailyContent !== undefined
        ? getCancelPlanBudgetChip(this.app, details.postPruneDailyContent)
        : "";
    showCancelNotice(
      buildCancelNoticeModel({
        count: details.count,
        viaLinks: details.viaLinks,
        date: details.dateText,
        reason: details.reason,
        fallbackUsed: details.fallbackUsed,
        removedPomodoroLinkCount: details.removedPomodoroLinkCount,
        reopenedDependents: reopened,
        recoveryRan,
        planChip,
        skippedClosedCount: details.skippedClosedCount,
        pomodoroPruneFailed: details.pomodoroPruneFailed,
      }),
    );
    // The deferred review settle runs after the cancel card, so the landing
    // toast follows it. Pickers without review state no-op here.
    try {
      if (picker && typeof picker.settleReviewOrigin === "function") {
        picker.settleReviewOrigin();
      }
    } catch (error) {
      // Settle is best effort after the notice.
    }
    return true;
  }

  openBulletPropertyPicker(cm, options = {}) {
    const activePicker = this.activeBulletPropertyPicker;
    const hadActivePicker = Boolean(activePicker);
    if (activePicker) {
      const incomingCountExplicit = Boolean(
        options.countExplicit === true ||
          (options.taskSession && options.taskSession.explicit),
      );
      const activeCountExplicit = Boolean(
        activePicker.taskSession && activePicker.taskSession.explicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

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
    // Anywhere on a Depends-On line opens the owning task's Depends on
    // stage, skipping the property step — never the link under the cursor
    // (`docs/task-dependencies.md` §6.1).
    if (!options.taskSession && !options.initialProperty) {
      const entry = resolveDependencyStageEntry(content, cursor.line);
      if (entry.ok && entry.skipPropertyStep) {
        setEditorCursorSafely(cm, entry.parentLine, 0);
        return this.openBulletPropertyPicker(cm, {
          ...options,
          initialProperty: "dependsOn",
        });
      }
    }
    if (!options.taskSession && editorSelectionSpansTasks(cm, content)) {
      new Notice("Selection spans several tasks; put the cursor on one task");
      return false;
    }
    // On a dedicated Task Link bullet, the picker targets the linked task in
    // its own note. On a #task line the existing behavior is unchanged.
    if (
      !options.taskSession &&
      !isObsidianTaskAtLine(content, cursor.line) &&
      parseLinkPickerTaskLink(lineText)
    ) {
      void this.openLinkPicker(cm, options).catch(() => false);
      return true;
    }
    let taskSession = options.taskSession || null;
    if (options.countExplicit && !taskSession) {
      taskSession = discoverCountedObsidianTaskTargets(
        content,
        cursor.line,
        options.additionalTaskCount,
      );
    }
    if (taskSession && taskSession.explicit) {
      if (!taskSession.valid) {
        new Notice(taskSession.error);
        return false;
      }
    } else if (!isBulletLine(lineText)) {
      // Prose with several links is refused with a short reason; a single
      // dedicated Task Link routed to the link picker above.
      if ((lineText.match(/\[\[/g) || []).length >= 2) {
        new Notice("Several links here — put the cursor on one Task Link");
        return false;
      }
      new Notice("Cursor is not on a bullet");
      return false;
    }

    const config = options.config || loadBulletPropertyConfig();
    if (!config) {
      return false;
    }
    if (taskSession && taskSession.explicit) {
      const aggregate = createCountedBulletPropertyItems(
        config,
        content,
        taskSession,
      );
      if (!aggregate.valid) {
        new Notice(aggregate.error);
        return false;
      }
    }

    const basePropertyContext = getProjectNotePropertyContext(
      content,
      cursor.line,
    );
    if (!basePropertyContext.valid) {
      new Notice(basePropertyContext.error);
      return false;
    }
    const propertyContext = {
      ...basePropertyContext,
      isObsidianTask: isObsidianTaskAtLine(content, cursor.line),
    };

    const activeView = this.getActiveMarkdownView();
    if (!activeView || activeView.editor !== cm || !activeView.file) {
      new Notice("No active markdown note");
      return false;
    }
    const filePath = activeView.file.path;

    // Review-walk auto-advance (nav-gestures): capture on the plain
    // task-line path only — not the Depends-On redirect's outer call or a
    // direct stage (`initialProperty`), not Task Link bullets (routed to the
    // link picker above), and not when a picker was already open. While the
    // gesture lock is held the key is swallowed with no write.
    let reviewOrigin = null;
    if (
      !options.initialProperty &&
      !hadActivePicker &&
      typeof this.captureReviewGesture === "function"
    ) {
      try {
        const captured = this.captureReviewGesture(cm);
        if (captured && captured.busy === true) {
          return true;
        }
        reviewOrigin = captured || null;
      } catch (error) {
        reviewOrigin = null;
      }
    }
    const picker = new BulletPropertyPickerModal(
      this.app,
      this,
      cm,
      cursor,
      lineText,
      config,
      {
        filePath,
        propertyContext,
        taskSession,
        initialProperty: options.initialProperty || null,
        random: options.random,
        baseDate: options.baseDate,
        reviewOrigin,
        reviewLineIndex: cursor.line,
        reviewBeforeLine: lineText,
      },
    );
    this.activeBulletPropertyPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeBulletPropertyPicker === picker) {
        this.activeBulletPropertyPicker = null;
      }
      throw error;
    }
    // `initialProperty: "dependsOn"` skips the property step: the Depends
    // on value stage opens straight away (`docs/task-dependencies.md` §6.1).
    if (options.initialProperty) {
      const wanted = (picker.propertyItems || []).find(
        (item) =>
          item &&
          item.kind === "property" &&
          item.property &&
          item.property.name === options.initialProperty,
      );
      if (!wanted) {
        // A direct stage has no card or list to fall back on.
        picker.close();
        new Notice(`${options.initialProperty} is not configured`);
        return false;
      }
      picker.showValueStage(wanted);
    }
    return true;
  }

  getCountedTaskWriteContext(cm, filePath, session) {
    const activeView = this.getActiveMarkdownView();
    if (
      !activeView ||
      activeView.editor !== cm ||
      !activeView.file ||
      activeView.file.path !== filePath
    ) {
      return Object.freeze({
        valid: false,
        error: "Active note changed; no tasks were updated",
      });
    }
    if (!cm || typeof cm.getValue !== "function") {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    const content = String(cm.getValue() || "");
    const validation = validateCountedTaskSession(content, session);
    if (!validation.valid) {
      return Object.freeze({
        valid: false,
        error: `${validation.error}; no tasks were updated`,
      });
    }
    return Object.freeze({ valid: true, error: null, content });
  }

  getInlinePropertyWriteContext(cm, cursor, options = {}) {
    if (
      !cm ||
      typeof cm.getValue !== "function" ||
      !cursor ||
      !Number.isInteger(cursor.line)
    ) {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    const filePath = normalizeVaultRelativePath(options.filePath);
    if (filePath) {
      const activeView = this.getActiveMarkdownView();
      if (
        !activeView ||
        activeView.editor !== cm ||
        !activeView.file ||
        normalizeVaultRelativePath(activeView.file.path) !== filePath
      ) {
        return Object.freeze({
          valid: false,
          error: "Active note changed; bullet property was not updated",
        });
      }
    }
    const content = String(cm.getValue() || "");
    const line = getEditorLine(cm, cursor.line);
    if (line === null) {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    if (
      options.expectedLine !== undefined &&
      options.expectedLine !== null &&
      line !== options.expectedLine
    ) {
      return Object.freeze({
        valid: false,
        error: "Current task changed; bullet property was not updated",
      });
    }
    return Object.freeze({
      valid: true,
      error: null,
      filePath,
      content,
      line,
    });
  }

  getCountedTaskNoticeSuffix(session, unchangedTaskCount = 0) {
    return getCountedTaskNoticeSuffix(session, unchangedTaskCount);
  }

  async setCountedBulletPropertyValue(
    cm,
    cursor,
    filePath,
    session,
    name,
    value,
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
    const today = new Date();
    let recoveryByLine = null;
    if (
      normalizeBulletPropertyName(name) === "scheduled" &&
      isDueInlineScheduledValue(value, today)
    ) {
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
        today,
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
    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      name,
      value,
      {
        operation: "set",
        today,
        recoveryByLine,
        scheduleLog: options.scheduleLog,
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
        today,
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

    const finalLine = splitMarkdownContent(finalContent).lines[finalCursorLine] || "";
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
        throw new Error("Editor cannot apply a counted property transaction");
      }
    } catch (error) {
      new Notice("Could not update counted task properties; no tasks were updated");
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

    const propagationSuffix =
      plan.propagatedScheduleTaskCount > 0
        ? `; scheduled ${formatCountLabel(
            plan.propagatedScheduleTaskCount,
            "task",
          )}`
        : "";
    const hideSuffix =
      plan.removedHideTaskCount > 0
        ? `; removed #hide from ${formatCountLabel(
            plan.removedHideTaskCount,
            "task",
          )}`
        : "";
    const ambiguitySuffix =
      plan.ambiguousProjectTaskCount > 0
        ? `; ${formatCountLabel(
            plan.ambiguousProjectTaskCount,
            "task",
          )} with multiple scheduled fields unchanged`
        : "";
    const blockedSuffix =
      plan.blockedTaskCount > 0
        ? `; marked ${formatCountLabel(
            plan.blockedTaskCount,
            "task",
          )} Blocked`
        : "";
    const recoverySuffix = scheduledRecoveryNoticeSuffix({
      ready: plan.recoveredReadyTaskCount,
      next: plan.recoveredNextTaskCount,
      inProgress: plan.recoveredInProgressTaskCount,
      stillBlocked: plan.stillBlockedTaskCount,
      deferred: plan.deferredRecoveryTaskCount,
    });
    const scheduleLogSuffix =
      plan.scheduleLoggedTaskCount > 0
        ? `; ${
            plan.scheduleLogFallbackTaskCount === plan.scheduleLoggedTaskCount
              ? "logged without a reason on"
              : "logged reason on"
          } ${formatCountLabel(plan.scheduleLoggedTaskCount, "task")}`
        : "";
    const workLogSuffix =
      plan.schedulingWorkLogWrittenCount > 0
        ? `; ${formatCountLabel(plan.schedulingWorkLogWrittenCount, "Work Log")}`
        : "";
    const pomodoroPruneSuffix =
      removedPomodoroLinkCount > 0
        ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
        : pomodoroPruneFailed
          ? "; Pomodoro links not removed"
          : "";
    new Notice(
      `${name} → ${normalizeBulletPropertyValue(value)} on ${formatCountLabel(
        plan.changedTaskCount,
        "task",
      )}${this.getCountedTaskNoticeSuffix(
        session,
        plan.unchangedTaskCount,
      )}${propagationSuffix}${hideSuffix}${blockedSuffix}${ambiguitySuffix}${recoverySuffix}${scheduleLogSuffix}${workLogSuffix}${pomodoroPruneSuffix}`,
    );
    return true;
  }
}
