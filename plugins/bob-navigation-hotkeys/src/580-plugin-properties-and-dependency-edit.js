class BobNavigationHotkeysPropertyDependencyMixin {

  async deleteProjectNoteScheduledValue(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
  ) {
    const writeContext = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
      "deleted",
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }

    const today = new Date();
    const recoveryByLine = await buildTargetScheduledRecoveryByLine(
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
      "deleted",
    );
    if (!guarded.valid || guarded.content !== writeContext.content) {
      new Notice(
        guarded.valid
          ? "Active project note changed; scheduled was not deleted"
          : guarded.error,
      );
      return null;
    }
    const plan = planProjectScheduledDelete(
      writeContext.content,
      cursor.line,
      { today, recoveryByLine },
    );
    if (!plan.valid) {
      new Notice(plan.error);
      return null;
    }

    let finalLine = "";
    try {
      finalLine =
        splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
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
        throw new Error("Editor cannot replace note content");
      }
    } catch (error) {
      new Notice("Could not delete project scheduled");
      return null;
    }

    new Notice(
      `scheduled ✗ removed${
        plan.removedScheduledTaskCount > 0
          ? `; removed propagated schedule from ${formatCountLabel(
              plan.removedScheduledTaskCount,
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

  async setInlineBulletPropertyValues(
    cm,
    cursor,
    edits,
    scheduledValue,
    options = {},
  ) {
    const writeContext = this.getInlinePropertyWriteContext(
      cm,
      cursor,
      options,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const lineText = writeContext.line;
    const today =
      options.today instanceof Date ? getLocalDateStart(options.today) : new Date();
    const hasScheduledValue =
      scheduledValue !== null && scheduledValue !== undefined;
    const normalizedScheduledValue = hasScheduledValue
      ? normalizeBulletPropertyValue(scheduledValue)
      : "";
    const shouldRecover =
      hasScheduledValue &&
      isDueInlineScheduledValue(normalizedScheduledValue, today) &&
      !isProjectLifecycleTaskLine(lineText);
    const shouldPrune =
      hasScheduledValue &&
      isFutureInlineScheduledValue(normalizedScheduledValue, today) &&
      !isProjectLifecycleTaskLine(lineText);
    let recovery = null;
    let pomodoroSnapshot = null;
    if (shouldRecover || shouldPrune) {
      if (shouldRecover) {
        const recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          writeContext.filePath,
          writeContext.content,
          [cursor.line],
          today,
        );
        recovery = recoveryByLine.get(cursor.line);
      }
      if (shouldPrune) {
        pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
          sourcePath: writeContext.filePath,
          sourceContent: writeContext.content,
          today,
        });
      }
      const guarded = this.getInlinePropertyWriteContext(cm, cursor, options);
      if (
        !guarded.valid ||
        guarded.content !== writeContext.content ||
        guarded.line !== lineText
      ) {
        new Notice(
          guarded.valid
            ? "Current task changed; bullet property was not updated"
            : guarded.error,
        );
        return false;
      }
    }

    // Dropping a field before re-adding it moves it to the end of the line, so
    // callers that care about trailing-field order (priority must never sit to
    // the right of the date metadata, since Tasks-format parsers read trailing
    // fields right to left) can rebuild the order they need.
    const editBaseLine = (
      Array.isArray(options.reorderPropertyNames)
        ? options.reorderPropertyNames
        : []
    ).reduce((line, name) => removeAllBulletProperties(line, name), lineText);
    const result = applyBulletPropertyEdits(editBaseLine, edits);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    let nextLine = result.line;
    let blocked = false;
    let recoveryOutcome = null;
    if (shouldPrune) {
      const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
      blocked = blockedLine !== nextLine;
      nextLine = blockedLine;
    } else if (shouldRecover) {
      const reconciliation = reconcileBlockedScheduledTaskLine(
        nextLine,
        recovery,
      );
      nextLine = reconciliation.line;
      recoveryOutcome = reconciliation.outcome;
    }

    // Freshness is the last transformation of the task line (nav-stamps).
    // Project-frontmatter edits never stamp; the stamper itself refuses
    // closed and recurring lines.
    if (nextLine !== lineText) {
      const inlineStamper = this.getFreshnessStampLine();
      if (typeof inlineStamper === "function") {
        nextLine = applyFreshStampLine(nextLine, inlineStamper, this.getFreshnessDateText());
      }
    }

    // When the deferred task's live Pomodoro links sit in this same note, the
    // property edit and the prune are folded into one editor transaction below
    // instead of two, so they land in a single undo group (edge case: the
    // source note is today's daily note).
    let dailyCleanupPlan = null;
    let foldedDailyContent = null;
    let effectiveCursorLine = cursor.line;
    if (shouldPrune && pomodoroSnapshot) {
      const blockId = getTrailingBlockId(nextLine);
      const targets = blockId
        ? [
            Object.freeze({
              path: normalizeVaultRelativePath(writeContext.filePath),
              blockId,
            }),
          ]
        : [];
      if (targets.length > 0) {
        if (pomodoroSnapshot.sameFile) {
          const merged = splitMarkdownContent(writeContext.content);
          merged.lines[cursor.line] = nextLine;
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            merged.lines.join(merged.lineEnding),
            targets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
          if (dailyCleanupPlan.changed) {
            foldedDailyContent = dailyCleanupPlan.content;
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

    // Plan the Schedule Log entry against the postimage before touching the
    // editor, so the task-line edit, any folded same-file Pomodoro prune and
    // the log entry land in one editor change set (one undo step).
    const hasTaskLineChange = nextLine !== lineText;
    const wantsScheduleLog = hasScheduleLogReasonInput(options.scheduleLog);
    const schedulingWorkLogInput =
      options.schedulingWorkLog && typeof options.schedulingWorkLog === "object"
        ? options.schedulingWorkLog
        : options.workLog && typeof options.workLog === "object"
          ? options.workLog
          : null;
    const isSchedulingInlineEdit =
      hasScheduledValue && Boolean(normalizedScheduledValue);
    const wantsWorkLog =
      isSchedulingInlineEdit &&
      isSchedulingWorkLogRawLine(lineText) &&
      hasSchedulingWorkLogInput(schedulingWorkLogInput);
    const workLogSummary = wantsWorkLog
      ? normalizeSchedulingWorkSummary(schedulingWorkLogInput.summary)
      : "";
    const workLogDateText = wantsWorkLog
      ? resolveSchedulingWorkLogDateText(schedulingWorkLogInput, undefined)
      : "";
    let preplannedScheduleLog = null;
    if (foldedDailyContent !== null) {
      const linesRemovedBeforeCursor = dailyCleanupPlan.removedLineRanges.reduce(
        (total, range) =>
          range.endLineExclusive <= cursor.line
            ? total + (range.endLineExclusive - range.startLine)
            : total,
        0,
      );
      effectiveCursorLine = cursor.line - linesRemovedBeforeCursor;
      if (wantsScheduleLog) {
        preplannedScheduleLog = planScheduleLogEntry(
          foldedDailyContent,
          effectiveCursorLine,
          options.scheduleLog,
        );
      }
    } else if (wantsScheduleLog) {
      const original = splitMarkdownContent(writeContext.content);
      const postLines = original.lines.slice();
      if (hasTaskLineChange) {
        postLines[cursor.line] = nextLine;
      }
      preplannedScheduleLog = planScheduleLogEntry(
        postLines.join(original.lineEnding),
        effectiveCursorLine,
        options.scheduleLog,
      );
    }
    const finalCursor = {
      line: effectiveCursorLine,
      ch: Math.min(Math.max(cursor.ch, 0), nextLine.length),
    };

    let scheduleLogOutcome = null;
    let workLogWritten = false;
    if (foldedDailyContent !== null) {
      let finalContent = foldedDailyContent;
      const folded = splitMarkdownContent(foldedDailyContent);
      const mutable = folded.lines.slice();
      if (preplannedScheduleLog && preplannedScheduleLog.valid) {
        applyScheduleLogEntryToLines(mutable, preplannedScheduleLog);
      }
      if (wantsWorkLog && workLogSummary) {
        if (
          insertLaneWorkLogEntry(
            mutable,
            effectiveCursorLine,
            workLogSummary,
            workLogDateText,
          )
        ) {
          workLogWritten = true;
        }
      }
      finalContent = mutable.join(folded.lineEnding);
      if (finalContent !== writeContext.content) {
        if (
          !applyEditorContentTransaction(cm, writeContext.content, finalContent, finalCursor)
        ) {
          new Notice("Could not update bullet property");
          return false;
        }
      } else if (
        hasTaskLineChange ||
        (preplannedScheduleLog && preplannedScheduleLog.valid)
      ) {
        if (
          !applyEditorContentTransaction(cm, writeContext.content, finalContent, finalCursor)
        ) {
          new Notice("Could not update bullet property");
          return false;
        }
      }
      if (preplannedScheduleLog) {
        scheduleLogOutcome = getScheduleLogWriteOutcome(
          preplannedScheduleLog,
          preplannedScheduleLog.valid,
        );
      }
    } else if (wantsWorkLog && workLogSummary) {
      const original = splitMarkdownContent(writeContext.content);
      const mutable = original.lines.slice();
      if (hasTaskLineChange) {
        mutable[cursor.line] = nextLine;
      }
      if (preplannedScheduleLog && preplannedScheduleLog.valid) {
        applyScheduleLogEntryToLines(mutable, preplannedScheduleLog);
      }
      if (
        insertLaneWorkLogEntry(
          mutable,
          effectiveCursorLine,
          workLogSummary,
          workLogDateText,
        )
      ) {
        workLogWritten = true;
      }
      const finalContent = mutable.join(original.lineEnding);
      scheduleLogOutcome = preplannedScheduleLog
        ? getScheduleLogWriteOutcome(preplannedScheduleLog, preplannedScheduleLog.valid)
        : null;
      if (finalContent !== writeContext.content) {
        if (
          !applyEditorContentTransaction(cm, writeContext.content, finalContent, finalCursor)
        ) {
          new Notice("Could not update bullet property");
          return false;
        }
      } else {
        if (preplannedScheduleLog) {
          scheduleLogOutcome = getScheduleLogWriteOutcome(preplannedScheduleLog, false);
        }
        if (!hasTaskLineChange && !workLogWritten) {
          if (preplannedScheduleLog) {
            scheduleLogOutcome = getScheduleLogWriteOutcome(preplannedScheduleLog, false);
          }
        }
      }
    } else {
      const wantsWrite =
        hasTaskLineChange ||
        (preplannedScheduleLog && preplannedScheduleLog.valid);
      if (wantsWrite) {
        if (
          typeof cm.transaction === "function" &&
          preplannedScheduleLog &&
          preplannedScheduleLog.valid
        ) {
          if (
            !applyInlinePropertyAndScheduleLogTransaction(
              cm,
              cursor.line,
              lineText,
              nextLine,
              preplannedScheduleLog,
              finalCursor,
            )
          ) {
            new Notice("Could not update bullet property");
            return false;
          }
          scheduleLogOutcome = getScheduleLogWriteOutcome(
            preplannedScheduleLog,
            preplannedScheduleLog.valid,
          );
        } else if (
          hasTaskLineChange &&
          !replaceEditorLine(cm, cursor.line, lineText, nextLine)
        ) {
          new Notice("Could not update bullet property");
          return false;
        } else if (preplannedScheduleLog) {
          scheduleLogOutcome = getScheduleLogWriteOutcome(
            preplannedScheduleLog,
            preplannedScheduleLog.valid &&
              insertEditorLine(cm, preplannedScheduleLog.insertLine, preplannedScheduleLog.lineText),
          );
        } else {
          scheduleLogOutcome = null;
        }
      } else if (preplannedScheduleLog) {
        scheduleLogOutcome = getScheduleLogWriteOutcome(preplannedScheduleLog, false);
      }
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot && !pomodoroSnapshot.sameFile) {
      const written = await this.writeDeferredPomodoroCleanup(
        pomodoroSnapshot,
        dailyCleanupPlan,
      );
      if (written) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        pomodoroPruneFailed = true;
      }
    } else if (foldedDailyContent !== null) {
      removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
    }

    setEditorCursorSafely(
      cm,
      effectiveCursorLine,
      Math.min(Math.max(cursor.ch, 0), nextLine.length),
    );
    const firstEdit = Array.isArray(edits) ? edits[0] : null;
    const noticeText =
      options.noticeText ||
      `${firstEdit ? firstEdit.name : "property"} → ${
        firstEdit ? normalizeBulletPropertyValue(firstEdit.value) : ""
      }`;
    const recoveryCounts = {
      ready: recoveryOutcome === "ready" ? 1 : 0,
      next: recoveryOutcome === "next" ? 1 : 0,
      inProgress: recoveryOutcome === "in-progress" ? 1 : 0,
      stillBlocked: recoveryOutcome === "still-blocked" ? 1 : 0,
      deferred: recoveryOutcome === "deferred" ? 1 : 0,
    };
    if (typeof options.buildNotice === "function") {
      showPriorityNotice(
        options.buildNotice({
          blocked,
          recoveryOutcome,
          recoveryCounts,
          scheduleLogOutcome,
          schedulingWorkLogWrittenCount: workLogWritten ? 1 : 0,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        }),
        { ...(options || {}), app: this.app },
      );
    } else {
      const scheduleLogSuffix =
        scheduleLogOutcome === "added"
          ? "; logged reason"
          : scheduleLogOutcome === "added-fallback"
            ? "; logged without a reason"
            : scheduleLogOutcome === "created"
              ? "; created schedule log"
              : scheduleLogOutcome === "guard-failed"
                ? "; schedule log not written"
                : "";
      const workLogSuffix = workLogWritten ? "; 1 Work Log" : "";
      const pomodoroPruneSuffix =
        removedPomodoroLinkCount > 0
          ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
          : pomodoroPruneFailed
            ? "; Pomodoro links not removed"
            : "";
      new Notice(
        `${noticeText}${
          blocked ? "; marked task Blocked" : ""
        }${scheduledRecoveryNoticeSuffix(recoveryCounts)}${scheduleLogSuffix}${workLogSuffix}${pomodoroPruneSuffix}`,
      );
    }
    return true;
  }

  async setBulletPropertyValue(cm, cursor, name, value, options = {}) {
    const propertyName = normalizeBulletPropertyName(name);
    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [{ name, value }],
      propertyName === "scheduled" ? value : null,
      options,
    );
  }

  async setBulletPriorityValue(
    cm,
    cursor,
    filePath,
    lineText,
    property,
    level,
    context = {},
  ) {
    if (!property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }

    const baseDate =
      context.baseDate instanceof Date
        ? getLocalDateStart(context.baseDate)
        : getLocalDateStart(new Date());
    // A decay write reuses the previewed date (what you see is what you get)
    // instead of rolling a fresh one. The override holds an already-formatted
    // `date` plus its window `offset` for the reason text.
    const precomputedRoll =
      context.precomputedRoll && typeof context.precomputedRoll === "object"
        ? context.precomputedRoll
        : null;
    const precomputedMatch =
      precomputedRoll &&
      /^(\d{4})-(\d{2})-(\d{2})/.exec(
        normalizeBulletPropertyValue(precomputedRoll.date),
      );
    const roll =
      precomputedMatch &&
      Number.isInteger(Number(precomputedRoll.offset)) &&
      getPriorityRollBounds(level) !== null &&
      Number(precomputedRoll.offset) >= getPriorityRollBounds(level).minDays &&
      Number(precomputedRoll.offset) <= getPriorityRollBounds(level).maxDays
        ? Object.freeze({
            date: new Date(
              Number(precomputedMatch[1]),
              Number(precomputedMatch[2]) - 1,
              Number(precomputedMatch[3]),
            ),
            offset: Number(precomputedRoll.offset),
          })
        : rollPriorityScheduledDateWithOffset(
            level,
            baseDate,
            typeof context.random === "function" ? context.random : Math.random,
          );
    const rolledDate = roll.date;
    const rolledValue = formatBulletPropertyDate(rolledDate);
    const levelIndex = normalizePriorityLevelIndex(property, level);
    // Read the live line rather than the captured one so the transition is correct
    // even if `lineText` was not supplied; the writers' own expectedLine guard is
    // what aborts the whole write if the note moved underneath us.
    const currentLine = getEditorLine(cm, cursor.line) ?? lineText ?? "";
    const priorityField = findBulletPropertyField(currentLine, property.name);
    const fromLevelLabel = getPriorityRollFromLevelLabel(property, priorityField ? priorityField.value : "");
    const propertyContext =
      context.propertyContext ||
      getProjectNotePropertyContext(
        cm && typeof cm.getValue === "function" ? cm.getValue() : "",
        cursor.line,
      );
    const scheduledTarget = resolveBulletPropertyTarget(
      property.schedules,
      propertyContext,
    );
    const schedulingWorkLogForPriority =
      context.schedulingWorkLog || context.workLog || null;
    if (scheduledTarget.kind === "project-frontmatter") {
      const expectedScheduledValue =
        propertyContext.frontmatter &&
        propertyContext.frontmatter.scheduledDefined
          ? propertyContext.frontmatter.scheduledValue
          : "";
      return await this.setProjectNoteScheduledValue(
        cm,
        cursor,
        filePath,
        lineText,
        expectedScheduledValue,
        rolledValue,
        {
          inlineEdits: [{ name: property.name, value: level.value }],
          today: baseDate,
          scheduleLog: context.scheduleReasonOverride
            ? buildPriorityDecayScheduleLogPayload(
                expectedScheduledValue,
                rolledValue,
                context.scheduleReasonOverride,
              )
            : buildPriorityRollScheduleLog({
                source: "priority",
                level,
                rolledDays: roll.offset,
                fromLevelLabel,
                from: expectedScheduledValue,
                to: rolledValue,
              }),
          schedulingWorkLog: schedulingWorkLogForPriority,
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level,
              levelIndex,
              baseDate,
              scheduledValues: [outcome.scheduled || rolledValue],
              taskCount: 1,
              scope: "project",
              roll: context.noticeRoll || null,
              outcome: {
                ...outcome,
                scheduleLoggedTaskCount:
                  outcome.scheduleLogOutcome === "added" ||
                  outcome.scheduleLogOutcome === "created"
                    ? 1
                    : 0,
              },
            }),
        },
      );
    }

    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [
        { name: property.name, value: level.value },
        { name: property.schedules, value: rolledValue },
      ],
      rolledValue,
      {
        filePath,
        expectedLine: lineText,
        today: baseDate,
        scheduleLog: context.scheduleReasonOverride
          ? buildPriorityDecayScheduleLogPayload(
              (findBulletPropertyField(currentLine, property.schedules) || {}).value || "",
              rolledValue,
              context.scheduleReasonOverride,
            )
          : buildPriorityRollScheduleLog({
              source: "priority",
              level,
              rolledDays: roll.offset,
              fromLevelLabel,
              from: (findBulletPropertyField(currentLine, property.schedules) || {}).value || "",
              to: rolledValue,
            }),
        schedulingWorkLog: schedulingWorkLogForPriority,
        buildNotice: (outcome) =>
          buildPriorityNoticeModel({
            property,
            level,
            levelIndex,
            baseDate,
            scheduledValues: [rolledValue],
            taskCount: 1,
            scope: "task",
            roll: context.noticeRoll || null,
            outcome: {
              blockedTaskCount: outcome.blocked ? 1 : 0,
              recoveryCounts: outcome.recoveryCounts,
              scheduleLoggedTaskCount:
                outcome.scheduleLogOutcome === "added" ||
                outcome.scheduleLogOutcome === "created"
                  ? 1
                  : 0,
              schedulingWorkLogWrittenCount:
                outcome.schedulingWorkLogWrittenCount || 0,
              removedPomodoroLinkCount: outcome.removedPomodoroLinkCount,
              pomodoroPruneFailed: outcome.pomodoroPruneFailed,
            },
          }),
        // Rebuild an existing schedules field after the priority, matching the
        // counted writer, so a level value outside Tasks' priority names can
        // never hide the rolled date from a right-to-left trailing-field parse.
        reorderPropertyNames: [property.schedules],
      },
    );
  }

  // Single-transaction Depends-On writer (`docs/task-dependencies.md` §6.6).
  // Plans with `planDependencyEdit`, prepares cross-note targets first (an
  // unused target id is acceptable, a link to an unprepared target is not),
  // then commits the dependent's note in one editor transaction: the line,
  // the field, same-note target ids, status effects, legacy folding, and
  // `[fresh:: today]`. `args.editor` + `args.filePath` select the live same-
  // note flow; `args.content` + `args.files` drive the pure/test flow.
  // `args.stamper` overrides the freshness stamper (tests inject one).
  async applyDependencyEdit(args = {}) {
    try {
      const editor =
        args.editor ||
        (args.cm !== undefined ? args.cm : null);
      const parentPath = normalizeVaultRelativePath(
        args.parentPath || args.filePath || "",
      );
      const parentLine = Math.floor(
        numericOrDefault(
          args.parentLine !== undefined ? args.parentLine : args.line,
          Number.NaN,
        ),
      );
      if (!parentPath || !Number.isFinite(parentLine)) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const content =
        args.content !== undefined
          ? String(args.content)
          : editor && typeof editor.getValue === "function"
            ? String(editor.getValue() || "")
            : null;
      if (content === null) {
        return Object.freeze({ ok: false, reason: "no-content" });
      }
      const add = Array.isArray(args.add) ? args.add : [];
      const remove = Array.isArray(args.remove) ? args.remove : [];
      const files = new Map();
      if (args.files instanceof Map) {
        for (const [filePath, fileContent] of args.files) {
          files.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
        }
      } else if (args.files && typeof args.files === "object") {
        for (const filePath of Object.keys(args.files)) {
          files.set(
            normalizeVaultRelativePath(filePath),
            String(args.files[filePath] || ""),
          );
        }
      }
      if (!files.has(parentPath)) {
        files.set(parentPath, content);
      }
      // Every note the edit touches is loaded: the add/remove targets plus
      // every note already linked on the line (open buffers first, else the
      // vault). A link whose note cannot be loaded stays verbatim in the
      // planner (or drops when removed), so one cross-note prerequisite
      // never blocks every other add or remove.
      const resolveLinkpath = this.dependencyLinkpathResolver();
      const wanted = new Set([parentPath]);
      for (const ref of [...add, ...remove]) {
        const normalized = normalizeDependencyTargetRef(ref);
        if (normalized.path && normalized.blockId) {
          wanted.add(normalized.path);
        }
      }
      const existingLinks = collectDependencyNavigationBullets(content, parentLine);
      if (!existingLinks.reason) {
        for (const target of existingLinks.targets) {
          const targetPath = dependencyPathForLinkNote(
            target.note,
            parentPath,
            resolveLinkpath,
          );
          if (targetPath) {
            wanted.add(targetPath);
          }
        }
      }
      for (const filePath of wanted) {
        if (files.has(filePath)) {
          continue;
        }
        const loaded = await this.readDependencyNoteContent(
          filePath,
          editor,
          parentPath,
        );
        if (loaded === null) {
          if (filePath === parentPath) {
            return Object.freeze({ ok: false, reason: "target-not-found" });
          }
          continue;
        }
        files.set(filePath, loaded);
      }
      const mirrorTouch = args.mirrorTouch === true;
      const registry = await readTasksStatusRegistry(this.app);
      const vaultContents = needsDependencyRecoverySnapshot(content, parentLine, remove, mirrorTouch, add)
        ? await this.readDependencyRecoveryVaultContents(parentPath, content)
        : null;
      const plan = planDependencyEdit({
        content,
        parentLine,
        parentPath,
        add,
        remove,
        files,
        vaultFiles: this.readDependencyVaultFileList(),
        resolveLinkpath,
        mirrorTouch,
        recovery: {
          registry,
          today: args.today || new Date(),
          vaultContents,
        },
      });
      if (!plan.ok) {
        return Object.freeze({ ok: false, reason: plan.reason });
      }
      if (!plan.changed) {
        return Object.freeze({ ok: true, reason: "unchanged", notice: plan.notice });
      }
      const outcome = await applyDependencyEditTransaction(plan, {
        // The hand-edit mirror never writes cross-note targets' `[id::]`;
        // the hooks reconcile them (contract §4).
        prepareTargetFile: mirrorTouch
          ? async () => ({ ok: true })
          : (filePath, preparation) =>
              this.prepareDependencyTargetNote(filePath, preparation),
        commitDependentContent: (nextContent) => {
          if (!editor) {
            return { ok: false, reason: "no-editor" };
          }
          if (typeof editor.getValue === "function") {
            const live = String(editor.getValue() || "");
            if (live !== content) {
              return { ok: false, reason: "stale-editor" };
            }
          }
          // The hand-edit mirror never stamps freshness.
          const finalContent = mirrorTouch
            ? nextContent
            : this.stampDependencyParentLine(
                nextContent,
                parentLine,
                args.stamper,
                args.dateText,
              );
          const committed = applyEditorContentTransaction(
            editor,
            content,
            finalContent,
          );
          return committed
            ? { ok: true }
            : { ok: false, reason: "commit-failed" };
        },
      });
      if (!outcome.ok && outcome.reason === "stale-editor") {
        new Notice("changed — reopen");
      }
      return outcome;
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "apply-failed" });
    }
  }

  // Freshness is the last transformation of the parent task line
  // (nav-stamps). Applied inside the one transaction, never as its own edit.
  stampDependencyParentLine(nextContent, parentLine, stamperOverride, dateTextOverride) {
    const stamper =
      typeof stamperOverride === "function"
        ? stamperOverride
        : this.getFreshnessStampLine();
    if (typeof stamper !== "function") {
      return nextContent;
    }
    const dateText =
      dateTextOverride !== undefined
        ? dateTextOverride
        : this.getFreshnessDateText();
    const { lines, lineEnding } = splitMarkdownContent(nextContent);
    if (parentLine < 0 || parentLine >= lines.length) {
      return nextContent;
    }
    lines[parentLine] = applyFreshStampLine(lines[parentLine], stamper, dateText);
    return lines.join(lineEnding);
  }

  // Best-effort vault read for planner target resolution: the open buffer
  // when the note is open (unsaved edits count), else the vault content.
  // Open-buffer content for a note path (unsaved edits count), or null
  // when the note has no open markdown leaf. Synchronous, so the picker
  // never waits on disk while typing.
  readOpenBufferContent(filePath) {
    try {
      const normalized = normalizeVaultRelativePath(filePath || "");
      const workspace = this.app && this.app.workspace;
      if (!normalized || !workspace || typeof workspace.getLeavesOfType !== "function") {
        return null;
      }
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        const view = leaf && leaf.view;
        if (
          view &&
          view.file &&
          normalizeVaultRelativePath(view.file.path) === normalized &&
          view.editor &&
          typeof view.editor.getValue === "function"
        ) {
          return String(view.editor.getValue() || "");
        }
      }
      return null;
    } catch (_error) {
      return null;
    }
  }
}
