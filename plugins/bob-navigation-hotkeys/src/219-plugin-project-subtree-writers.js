// Overflow writers for the sub-project cascade (`docs/task-dependencies.md`
// §13.19). This fragment owns no behaviour of its own: it hosts writer
// methods moved verbatim from `570`/`580` to keep those fragments under the
// 1000-line cap, plus the shared post-commit cascade helper the Schedule
// writers use. Everything installs onto the one plugin class, so `this.*`
// calls work exactly as before the move.

class BobNavigationHotkeysProjectSubtreeWritersMixin {
  // Post-commit cascade for the `^prj` Schedule writers (a future date, a
  // due date and a delete): plan and write the subtree pass off the
  // committed content, consume the newly-Blocked descendants' live Pomodoro
  // links, and report `{subtree, pomodoroRemoved}`. A stale descendant is
  // skipped and counted (PDG14); N is never rolled back. Never throws.
  async applyScheduleSubtreePass(filePath, beforeText, committedContent, options = {}) {
    const empty = Object.freeze({ subtree: null, pomodoroRemoved: 0 });
    try {
      if (typeof this.applySubtreePassForPrjEdit !== "function") {
        return empty;
      }
      const path = normalizeVaultRelativePath(filePath);
      const before = String(beforeText || "");
      const committed = String(committedContent || "");
      if (!path || committed === before) {
        return empty;
      }
      const today = options.today instanceof Date ? options.today : new Date();
      const subtree = await this.applySubtreePassForPrjEdit(
        path,
        before,
        committed,
        { today },
      );
      if (!subtree) {
        return empty;
      }
      let pomodoroRemoved = 0;
      if (
        subtree.pomodoroTargets.length > 0 &&
        typeof this.runSubtreePomodoroCleanup === "function"
      ) {
        try {
          const cleanup = await this.runSubtreePomodoroCleanup(
            subtree.pomodoroTargets,
            path,
            committed,
            today,
          );
          if (cleanup && !cleanup.failed) {
            pomodoroRemoved = cleanup.removed;
          }
        } catch (_error) {
          // The cascade never fails the gesture.
        }
      }
      return Object.freeze({ subtree, pomodoroRemoved });
    } catch (_error) {
      return empty;
    }
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
      isDueInlineScheduledValue(normalizedScheduledValue, today);
    const shouldPrune =
      hasScheduledValue &&
      isFutureInlineScheduledValue(normalizedScheduledValue, today);
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

    // Freshness is the last transformation of the task line (nav-stamps);
    // the stamper itself refuses closed and recurring lines.
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
    const scheduledField = findBulletPropertyField(lineText, "scheduled");
    const currentValue = scheduledField ? scheduledField.value : "";
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

  foldLocalDependencyPomodoroCleanup(nextContent, targets, parentPath, today) {
    let markdownFiles = [];
    try {
      markdownFiles =
        this.app &&
        this.app.vault &&
        typeof this.app.vault.getMarkdownFiles === "function"
          ? this.app.vault.getMarkdownFiles() || []
          : [];
    } catch (_error) {
      markdownFiles = [];
    }
    return foldSameNotePomodoroCleanup(
      nextContent,
      targets,
      parentPath,
      today instanceof Date ? today : new Date(),
      markdownFiles,
    );
  }

  continueLocalTaskDependencyFollowUps(args = {}) {
    const plan = args.plan;
    const filePath = normalizeVaultRelativePath(args.filePath);
    const beforeContent = String(args.beforeContent || "");
    const committedContent = String(args.committedContent || "");
    const targets = Array.isArray(args.targets) ? args.targets : [];
    const folded = args.folded || {
      sameFile: false,
      hasDaily: false,
      removed: 0,
    };
    const showNotice = args.showNotice !== false;
    const today = args.today instanceof Date ? args.today : new Date();
    const pendingCrossFile =
      Boolean(plan && plan.changed) &&
      targets.length > 0 &&
      folded.hasDaily === true &&
      folded.sameFile !== true;
    if (showNotice && !pendingCrossFile) {
      new Notice(
        withBlocksFollowUpNotice(
          dependencyPomodoroNotice(plan, folded.removed || 0, false) ||
            (plan && plan.notice),
          (plan && plan.blocksFailedPaths) || [],
        ),
      );
    } else if (
      !showNotice &&
      !pendingCrossFile &&
      (folded.removed || 0) > 0
    ) {
      const foldedSuffix = dependencyPomodoroNoticeSuffix(
        folded.removed || 0,
        false,
      );
      if (foldedSuffix) {
        new Notice(
          `${(plan && plan.notice) || "⛓ Dependencies updated"}${foldedSuffix}`,
        );
      }
    }
    if (
      !(plan && plan.changed) ||
      (typeof this.applySubtreePassForPrjEdit !== "function" &&
        !pendingCrossFile)
    ) {
      return;
    }
    try {
      const cascade =
        typeof this.applySubtreePassForPrjEdit === "function"
          ? this.applySubtreePassForPrjEdit(
              filePath,
              beforeContent,
              committedContent,
              { files: { [filePath]: beforeContent } },
            )
          : null;
      const cleanup =
        pendingCrossFile && typeof this.runSubtreePomodoroCleanup === "function"
          ? this.runSubtreePomodoroCleanup(
              targets,
              filePath,
              committedContent,
              today,
            )
          : null;
      const finish = (subtree, pomodoroDone) => {
        if (
          subtree &&
          subtree.pomodoroTargets &&
          subtree.pomodoroTargets.length > 0 &&
          typeof this.runSubtreePomodoroCleanup === "function"
        ) {
          this.runSubtreePomodoroCleanup(
            subtree.pomodoroTargets,
            filePath,
            committedContent,
            today,
          );
        }
        if (pendingCrossFile) {
          if (showNotice) {
            new Notice(
              withBlocksFollowUpNotice(
                withSubtreePassNotice(
                  dependencyPomodoroNotice(
                    plan,
                    pomodoroDone.removed,
                    pomodoroDone.failed,
                  ) || (plan && plan.notice),
                  subtree,
                ),
                (plan && plan.blocksFailedPaths) || [],
              ),
            );
          } else if (pomodoroDone.removed > 0 || pomodoroDone.failed) {
            const suffix = dependencyPomodoroNoticeSuffix(
              pomodoroDone.removed,
              pomodoroDone.failed,
            );
            if (suffix) {
              new Notice(
                `${(plan && plan.notice) || "⛓ Dependencies updated"}${suffix}`,
              );
            }
          }
          return;
        }
        const suffix = subtree ? subtreePassNoticeSuffix(subtree) : "";
        if (suffix && showNotice) {
          new Notice(suffix);
        }
      };
      const wait = Promise.all([
        cascade && typeof cascade.then === "function"
          ? cascade.catch(() => null)
          : Promise.resolve(cascade),
        cleanup && typeof cleanup.then === "function"
          ? cleanup.catch(() => ({
              removed: folded.removed || 0,
              failed: true,
            }))
          : Promise.resolve(
              cleanup || {
                removed: folded.removed || 0,
                failed: false,
              },
            ),
      ]);
      wait.then(
        ([subtree, pomodoroDone]) => {
          try {
            finish(subtree, {
              removed:
                (pomodoroDone && pomodoroDone.removed) || folded.removed || 0,
              failed: Boolean(pomodoroDone && pomodoroDone.failed),
            });
          } catch (_error) {
            // The cascade never fails the gesture.
          }
        },
        () => {},
      );
    } catch (_error) {
      // The cascade never fails the gesture.
    }
  }
}
