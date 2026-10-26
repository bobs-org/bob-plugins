function isDueInlineScheduledValue(value, today = new Date()) {
  const validation = validateProjectScheduledDate(value);
  return (
    validation.valid &&
    !isFutureInlineScheduledValue(validation.value, today)
  );
}

function getTargetScheduledRecovery(options, line) {
  const recoveryByLine = options && options.recoveryByLine;
  if (recoveryByLine instanceof Map) {
    return recoveryByLine.get(line) || null;
  }
  if (recoveryByLine && typeof recoveryByLine === "object") {
    return recoveryByLine[line] || null;
  }
  return null;
}

// Nav `markUnblockedLine` callback for planners: forwards to ledger
// freshness v12 when present, else null so the planner's missing-API
// `console.warn` fires instead of a silent identity write.
function navFreshnessMarkUnblockedLine(freshnessApi) {
  if (
    !freshnessApi ||
    typeof freshnessApi.markUnblockedLine !== "function"
  ) {
    return null;
  }
  return (line, markOptions) =>
    freshnessApi.markUnblockedLine(line, markOptions);
}

// Out-of-scope scope flags for `[unblocked::]` writes on one note path: a
// daily-note task never takes the field. `isToday` (a Task Link under
// today's open Pomodoros) defaults false; callers that know the target is
// linked today pass true explicitly.
function navNoteScopeFlags(notePath, overrides = {}) {
  const scope =
    overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({
    isDailyNote: Boolean(
      canonicalRecoveryDailyDate(normalizeVaultRelativePath(notePath || "")),
    ),
    isToday: scope.isToday === true,
  });
}

function setProjectBlockedTag(line, on) {
  const text = String(line || "");
  const spans = getWholeTaskTagSpans(text, PROJECT_BLOCKED_TAG);
  if (!on) {
    return removeTextSpans(text, spans);
  }
  if (spans.length === 1) {
    return text;
  }
  const stripped = spans.length > 0 ? removeTextSpans(text, spans) : text;
  const trailingBlockId = getTrailingBlockIdSpan(stripped);
  const insertionIndex = trailingBlockId
    ? trailingBlockId.start
    : stripped.trimEnd().length;
  const before = stripped.slice(0, insertionIndex).replace(/[ \t]+$/, "");
  const after = stripped.slice(insertionIndex);
  return `${before} ${PROJECT_BLOCKED_TAG}${after}`;
}

function reconcileBlockedScheduledTaskLine(lineText, recovery, options = {}) {
  const line = String(lineText || "");
  const taskMatch = OBSIDIAN_TASK_LINE_RE.exec(line);
  if (!taskMatch || taskMatch[1] !== "?") {
    return Object.freeze({
      line,
      changed: false,
      outcome: null,
    });
  }
  const decision =
    recovery || deferredScheduledRecovery("recovery snapshot is unavailable");
  if (
    !["ready", "next", "in-progress"].includes(decision.state) ||
    ![" ", "*", "/"].includes(decision.rank)
  ) {
    return Object.freeze({
      line,
      changed: false,
      outcome:
        decision.state === "blocked" ? "still-blocked" : "deferred",
    });
  }
  const checkboxOffset = taskMatch[0].indexOf("[?]") + 1;
  let nextLine =
    line.slice(0, checkboxOffset) +
    decision.rank +
    line.slice(checkboxOffset + 1);
  nextLine = setProjectBlockedTag(nextLine, false);
  if (decision.rank === " " && options.ownLine === false) {
    const mark =
      options && typeof options.markUnblockedLine === "function"
        ? options.markUnblockedLine
        : null;
    if (mark) {
      nextLine = String(
        mark(nextLine, {
          today: options.today,
          status: " ",
          // Out-of-scope skips: a daily-note task, or a task linked under
          // today's open Pomodoros, never takes an inert `[unblocked::]`.
          isDailyNote: options.isDailyNote === true,
          isToday: options.isToday === true,
        }) || nextLine,
      );
    } else {
      console.warn(
        "api.freshness.markUnblockedLine is unavailable; recovered without [unblocked::]",
      );
    }
  }
  return Object.freeze({
    line: nextLine,
    changed: nextLine !== line,
    outcome: decision.state,
  });
}

function emptyScheduledRecoveryCounts() {
  return {
    ready: 0,
    next: 0,
    inProgress: 0,
    stillBlocked: 0,
    deferred: 0,
  };
}

function recordScheduledRecoveryOutcome(counts, outcome) {
  if (outcome === "ready") counts.ready += 1;
  if (outcome === "next") counts.next += 1;
  if (outcome === "in-progress") counts.inProgress += 1;
  if (outcome === "still-blocked") counts.stillBlocked += 1;
  if (outcome === "deferred") counts.deferred += 1;
}

function scheduledRecoveryNoticeParts(counts = {}) {
  const parts = [];
  if (counts.ready > 0) {
    parts.push(`recovered ${formatCountLabel(counts.ready, "task")} Ready`);
  }
  if (counts.next > 0) {
    parts.push(`recovered ${formatCountLabel(counts.next, "task")} Next`);
  }
  if (counts.inProgress > 0) {
    parts.push(
      `recovered ${formatCountLabel(counts.inProgress, "task")} In Progress`,
    );
  }
  if (counts.stillBlocked > 0) {
    parts.push(
      `${formatCountLabel(counts.stillBlocked, "task")} still Blocked`,
    );
  }
  if (counts.deferred > 0) {
    parts.push(
      `${formatCountLabel(
        counts.deferred,
        "task",
      )} deferred to bob task reconcile`,
    );
  }
  return Object.freeze(parts);
}

function scheduledRecoveryNoticeSuffix(counts = {}) {
  const parts = scheduledRecoveryNoticeParts(counts);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

function getCountedTaskNoticeParts(session, unchangedTaskCount = 0) {
  const parts = [];
  if (unchangedTaskCount > 0) {
    parts.push(`${formatCountLabel(unchangedTaskCount, "task")} unchanged`);
  }
  if (session && session.clamped) {
    parts.push(
      `requested ${session.requestedCount}, found ${session.actualCount} at end of note`,
    );
  }
  return Object.freeze(parts);
}

function getCountedTaskNoticeSuffix(session, unchangedTaskCount = 0) {
  const parts = getCountedTaskNoticeParts(session, unchangedTaskCount);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

// Plan one counted set/delete without mutating the editor. Scheduled values on
// ^prj sources are composed through the ^prj inline date first;
// every other source remains an inline Dataview edit. `options.priorityValueByLine`
// (a Map from original line to priority value) overrides the shared
// `options.priorityValue` per target for `set-priority`; callers that omit it get
// byte-identical output. The caller can therefore commit the complete result as
// one guarded transaction.
function planCountedBulletPropertyBatch(
  content,
  session,
  name,
  value,
  options = {},
) {
  const text = String(content || "");
  const propertyName = normalizeBulletPropertyName(name);
  const operation =
    options.operation === "delete"
      ? "delete"
      : options.operation === "set-priority"
        ? "set-priority"
        : "set";
  const isPriorityOperation = operation === "set-priority";
  const normalizedValue = normalizeBulletPropertyValue(
    isPriorityOperation ? options.priorityValue : value,
  );
  const scheduledPropertyName = isPriorityOperation
    ? normalizeBulletPropertyName(options.scheduledPropertyName)
    : "";
  const scheduledValueByLine =
    isPriorityOperation && options.scheduledValueByLine instanceof Map
      ? options.scheduledValueByLine
      : null;
  const priorityValueByLine =
    isPriorityOperation && options.priorityValueByLine instanceof Map
      ? options.priorityValueByLine
      : null;
  const getCountedPriorityValueForLine = (targetLine) => {
    if (priorityValueByLine && priorityValueByLine.has(targetLine)) {
      return normalizeBulletPropertyValue(
        priorityValueByLine.get(targetLine),
      );
    }
    return normalizedValue;
  };
  const shouldBlockInlineTasks =
    operation === "set" &&
    propertyName === "scheduled" &&
    isFutureInlineScheduledValue(
      normalizedValue,
      options.today || new Date(),
    );
  const shouldRecoverInlineTasks =
    propertyName === "scheduled" &&
    (operation === "delete" ||
      (operation === "set" &&
        isDueInlineScheduledValue(
          normalizedValue,
          options.today || new Date(),
        )));
  const sessionValidation = validateCountedTaskSession(text, session);
  if (!sessionValidation.valid) {
    return Object.freeze({
      valid: false,
      stale: true,
      error: sessionValidation.error,
      content: text,
      changed: false,
    });
  }
  if (!propertyName) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Bullet property name is empty",
      content: text,
      changed: false,
    });
  }
  if (
    isPriorityOperation &&
    ((!normalizedValue && !priorityValueByLine) ||
      !scheduledPropertyName ||
      !scheduledValueByLine)
  ) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Counted priority update is missing configured values",
      content: text,
      changed: false,
    });
  }

  const targetStates = [];
  const property = { name: propertyName };
  const scheduledProperty = { name: scheduledPropertyName };
  for (const target of session.targets) {
    const state = getCountedPropertyTargetState(
      text,
      target,
      property,
      options,
    );
    if (!state.valid) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: state.error,
        content: text,
        changed: false,
      });
    }
    let scheduledState = null;
    if (isPriorityOperation) {
      const scheduledValue = normalizeBulletPropertyValue(
        scheduledValueByLine.get(target.line),
      );
      if (
        !scheduledValue ||
        !validateProjectScheduledDate(scheduledValue).valid
      ) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: `Counted priority update has no valid scheduled date for line ${
            target.line + 1
          }`,
          content: text,
          changed: false,
        });
      }
      scheduledState = getCountedPropertyTargetState(
        text,
        target,
        scheduledProperty,
        options,
      );
      if (!scheduledState.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: scheduledState.error,
          content: text,
          changed: false,
        });
      }
    }
    targetStates.push({ target, state, scheduledState });
  }

  const projectTargets =
    propertyName === "scheduled" || isPriorityOperation
      ? targetStates.filter(
          (entry) =>
            (isPriorityOperation ? entry.scheduledState : entry.state).target
              .kind === "project-inline",
        )
      : [];
  let nextContent = text;
  let taskLineDelta = 0;
  let propagatedScheduleTaskCount = 0;
  let removedProjectScheduleTaskCount = 0;
  let removedHideTaskCount = 0;
  let blockedTaskCount = 0;
  let ambiguousProjectTaskCount = 0;
  const recoveryCounts = emptyScheduledRecoveryCounts();
  let projectPropertyChanged = false;
  let projectScheduledValue = "";
  // Original (pre-batch) line numbers, matching the convention `target.line`
  // and `recoveryByLine` already use throughout this function.
  const futureScheduledTaskLines = [];

  if (projectTargets.length > 0) {
    const firstProject = projectTargets[0];
    const projectState = isPriorityOperation
      ? firstProject.scheduledState
      : firstProject.state;
    projectScheduledValue = isPriorityOperation
      ? normalizeBulletPropertyValue(
          scheduledValueByLine.get(firstProject.target.line),
        )
      : normalizedValue;
    if (operation === "set" || isPriorityOperation) {
      const projectPlan = planProjectScheduledUpdate(
        text,
        firstProject.target.line,
        projectScheduledValue,
        options.today || new Date(),
        options,
      );
      if (!projectPlan.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: projectPlan.error,
          content: text,
          changed: false,
        });
      }
      nextContent = projectPlan.content;
      taskLineDelta = projectPlan.cursorLine - firstProject.target.line;
      propagatedScheduleTaskCount = projectPlan.scheduledTaskCount;
      removedHideTaskCount = projectPlan.removedHideTaskCount;
      blockedTaskCount = projectPlan.blockedTaskCount;
      ambiguousProjectTaskCount = projectPlan.ambiguousTaskLines.length;
      recoveryCounts.ready += projectPlan.recoveredReadyTaskCount;
      recoveryCounts.next += projectPlan.recoveredNextTaskCount;
      recoveryCounts.inProgress +=
        projectPlan.recoveredInProgressTaskCount;
      recoveryCounts.stillBlocked += projectPlan.stillBlockedTaskCount;
      recoveryCounts.deferred += projectPlan.deferredRecoveryTaskCount;
      projectPropertyChanged =
        !projectState.defined || projectState.value !== projectScheduledValue;
      futureScheduledTaskLines.push(...projectPlan.futureScheduledTaskLines);
    } else if (projectState.defined) {
      const projectPlan = planProjectScheduledDelete(
        text,
        firstProject.target.line,
        options,
      );
      if (!projectPlan.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: projectPlan.error,
          content: text,
          changed: false,
        });
      }
      nextContent = projectPlan.content;
      taskLineDelta = projectPlan.cursorLine - firstProject.target.line;
      removedProjectScheduleTaskCount =
        projectPlan.removedScheduledTaskCount;
      recoveryCounts.ready += projectPlan.recoveredReadyTaskCount;
      recoveryCounts.next += projectPlan.recoveredNextTaskCount;
      recoveryCounts.inProgress +=
        projectPlan.recoveredInProgressTaskCount;
      recoveryCounts.stillBlocked += projectPlan.stillBlockedTaskCount;
      recoveryCounts.deferred += projectPlan.deferredRecoveryTaskCount;
      projectPropertyChanged = true;
    }
  }

  // Freshness is the last transformation of the task line (nav-stamps);
  // the stamper itself refuses closed and recurring lines.
  const countedStamper = resolveFreshStamper(options);
  const countedFreshDateText = resolveFreshDateText(options);
  const source = splitMarkdownContent(nextContent);
  const changedTargets = [];
  const unchangedTargets = [];
  for (const { target, state, scheduledState } of targetStates) {
    const mappedLine = target.line + taskLineDelta;
    const liveLine = String(source.lines[mappedLine] || "");
    let nextLine = liveLine;
    let targetChanged = false;

    if (isPriorityOperation) {
      const targetPriorityValue = getCountedPriorityValueForLine(target.line);
      if (!targetPriorityValue) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: `Counted priority update has no valid priority value for line ${
            target.line + 1
          }`,
          content: text,
          changed: false,
        });
      }
      const priorityBaseLine = removeAllBulletProperties(
        liveLine,
        scheduledPropertyName,
      );
      const priorityResult = upsertBulletProperty(
        priorityBaseLine,
        propertyName,
        targetPriorityValue,
      );
      nextLine = priorityResult.line;
      targetChanged =
        priorityBaseLine !== liveLine || priorityResult.changed;
      const scheduledValue = normalizeBulletPropertyValue(
        scheduledValueByLine.get(target.line),
      );
      if (scheduledState.target.kind === "project-inline") {
        const scheduledResult = upsertBulletProperty(
          nextLine,
          scheduledPropertyName,
          scheduledValue,
        );
        nextLine = scheduledResult.line;
        targetChanged ||=
          projectPropertyChanged ||
          scheduledResult.changed ||
          liveLine !== target.rawLine;
        if (shouldBlockInlineTasks) {
          const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
          if (blockedLine !== nextLine) {
            nextLine = blockedLine;
            targetChanged = true;
            blockedTaskCount += 1;
          }
        } else if (shouldRecoverInlineTasks) {
          const recovery = reconcileBlockedScheduledTaskLine(
            nextLine,
            getTargetScheduledRecovery(options, target.line),
            {
              today: options.today,
              // Only the `^prj` line itself is the gesture's own line; a
              // recovering resident takes `[unblocked::]` (§13.10).
              ownLine: Boolean(
                scheduledState.context && scheduledState.context.isProjectTask,
              ),
              markUnblockedLine: options.markUnblockedLine,
              isDailyNote: options.isDailyNote === true,
              isToday: options.isToday === true,
            },
          );
          nextLine = recovery.line;
          targetChanged ||= recovery.changed;
          recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
        }
      } else {
        const scheduledResult = upsertBulletProperty(
          nextLine,
          scheduledPropertyName,
          scheduledValue,
        );
        nextLine = scheduledResult.line;
        targetChanged ||= scheduledResult.changed;
        if (
          isFutureInlineScheduledValue(
            scheduledValue,
            options.today || new Date(),
          )
        ) {
          futureScheduledTaskLines.push(target.line);
          const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
          if (blockedLine !== nextLine) {
            nextLine = blockedLine;
            targetChanged = true;
            blockedTaskCount += 1;
          }
        } else if (
          isDueInlineScheduledValue(
            scheduledValue,
            options.today || new Date(),
          )
        ) {
          const recovery = reconcileBlockedScheduledTaskLine(
            nextLine,
            getTargetScheduledRecovery(options, target.line),
            {
              today: options.today,
              // Counted and batch recoveries take `[unblocked::]` (UB
              // WRITE); the single-gesture own-line exclusion does not
              // apply to batch rows.
              ownLine: false,
              markUnblockedLine: options.markUnblockedLine,
              isDailyNote: options.isDailyNote === true,
              isToday: options.isToday === true,
            },
          );
          nextLine = recovery.line;
          targetChanged ||= recovery.changed;
          recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
        }
      }
    } else {
      const result =
        operation === "delete"
          ? deleteBulletProperty(liveLine, propertyName)
          : upsertBulletProperty(liveLine, propertyName, normalizedValue);
      nextLine = result.line;
      targetChanged =
        result.changed ||
        (propertyName === "scheduled" &&
          state.target.kind === "project-inline" &&
          projectPropertyChanged) ||
        liveLine !== target.rawLine;
      if (shouldBlockInlineTasks) {
        futureScheduledTaskLines.push(target.line);
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) {
          nextLine = blockedLine;
          targetChanged = true;
          blockedTaskCount += 1;
        }
      } else if (shouldRecoverInlineTasks) {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, target.line),
          {
            today: options.today,
            // Counted and batch recoveries take `[unblocked::]` (UB
            // WRITE); the single-gesture own-line exclusion does not
            // apply to batch rows.
            ownLine: false,
            markUnblockedLine: options.markUnblockedLine,
            isDailyNote: options.isDailyNote === true,
            isToday: options.isToday === true,
          },
        );
        nextLine = recovery.line;
        targetChanged ||= recovery.changed;
        recordScheduledRecoveryOutcome(
          recoveryCounts,
          recovery.outcome,
        );
      }
    }

    if (countedStamper && targetChanged) {
      const stamped = applyFreshStampLine(
        nextLine,
        countedStamper,
        countedFreshDateText,
        { content: source.lines.join(source.lineEnding), line: mappedLine },
      );
      if (stamped !== nextLine) {
        nextLine = stamped;
        targetChanged = true;
      }
    }

    source.lines[mappedLine] = nextLine;
    const detail = Object.freeze({
      line: mappedLine,
      originalLine: target.line,
      rawLine: target.rawLine,
      lineText: nextLine,
    });
    (targetChanged ? changedTargets : unchangedTargets).push(detail);
  }

  // One entry per changed target, using that target's own previous value
  // (captured above via getCountedPropertyTargetState) and its own rolled date.
  // A priority batch supplies reasonByLine because each task may have had a
  // different previous level; a scheduled batch supplies one shared reason.
  // Insertions apply in descending insertLine order so an earlier (smaller-index)
  // insert position is never invalidated by a later one.
  let scheduleLoggedTaskCount = 0;
  let scheduleLogCreatedParentCount = 0;
  let scheduleLogFallbackTaskCount = 0;
  const appliedScheduleInserts = [];
  const scheduleLogOptions =
    options.scheduleLog && (isPriorityOperation || (operation === "set" && propertyName === "scheduled"))
      ? options.scheduleLog
      : null;
  if (scheduleLogOptions) {
    const entryByOriginalLine = new Map(targetStates.map((entry) => [entry.target.line, entry]));
    const scheduleLogPlans = changedTargets
      .map((detail) => {
        const entry = entryByOriginalLine.get(detail.originalLine);
        const scheduledState = isPriorityOperation ? entry && entry.scheduledState : entry && entry.state;
        // Project schedule writes and priority rolls update the ^prj inline field.
        const to = !isPriorityOperation
          ? normalizedValue
          : scheduledState && scheduledState.target.kind === "project-inline"
            ? projectScheduledValue
            : normalizeBulletPropertyValue(scheduledValueByLine.get(detail.originalLine));
        const from = scheduledState ? scheduledState.value : "";
        const rawReason =
          scheduleLogOptions.reasonByLine instanceof Map && scheduleLogOptions.reasonByLine.has(detail.originalLine)
            ? scheduleLogOptions.reasonByLine.get(detail.originalLine)
            : scheduleLogOptions.reason;
        const normalizedReason = normalizeScheduleReasonText(rawReason);
        // planScheduleLogEntry decides per target whether an empty reason falls
        // back, since only it knows whether that task already keeps a log.
        if (normalizedReason.empty && normalizeScheduleReasonText(scheduleLogOptions.fallbackReason).empty) {
          return null;
        }
        if (scheduleLogOptions.automatic && !shouldWriteAutomaticScheduleLog(from, to)) {
          return null;
        }
        return planScheduleLogEntry(source.lines.join(source.lineEnding), detail.line, {
          from,
          to,
          reason: normalizedReason.reason,
          fallbackReason: scheduleLogOptions.fallbackReason,
        });
      })
      .filter((scheduleLogPlan) => scheduleLogPlan && scheduleLogPlan.valid)
      .sort((first, second) => second.insertLine - first.insertLine);
    for (const scheduleLogPlan of scheduleLogPlans) {
      const applied = applyScheduleLogEntryToLines(source.lines, scheduleLogPlan);
      if (applied > 0) {
        scheduleLoggedTaskCount += 1;
        appliedScheduleInserts.push({
          insertLine: scheduleLogPlan.insertLine,
          count: applied,
        });
        if (scheduleLogPlan.createdParent) {
          scheduleLogCreatedParentCount += 1;
        }
        if (scheduleLogPlan.usedFallback) {
          scheduleLogFallbackTaskCount += 1;
        }
      }
    }
  }

  const isSchedulingWorkLogOperation =
    isPriorityOperation || (operation === "set" && propertyName === "scheduled");
  const schedulingWorkLogInput =
    options.schedulingWorkLog && typeof options.schedulingWorkLog === "object"
      ? options.schedulingWorkLog
      : options.workLog && typeof options.workLog === "object"
        ? options.workLog
        : null;
  let schedulingWorkLogWrittenCount = 0;
  let schedulingWorkLogEligibleCount = 0;
  if (isSchedulingWorkLogOperation && hasSchedulingWorkLogInput(schedulingWorkLogInput)) {
    const eligibleOriginalLines =
      collectSchedulingWorkLogEligibleOriginalLines(session.targets);
    schedulingWorkLogEligibleCount = eligibleOriginalLines.size;
    if (eligibleOriginalLines.size > 0) {
      const mappedByOriginal = new Map();
      for (const detail of changedTargets) {
        mappedByOriginal.set(detail.originalLine, detail.line);
      }
      for (const detail of unchangedTargets) {
        if (!mappedByOriginal.has(detail.originalLine)) {
          mappedByOriginal.set(detail.originalLine, detail.line);
        }
      }
      // Schedule inserts land strictly after their own task line, so shift
      // every mapped task line at or after each applied insert.
      for (const insert of appliedScheduleInserts) {
        const at = Math.floor(numericOrDefault(insert.insertLine, NaN));
        const count = Math.floor(numericOrDefault(insert.count, 0));
        if (!Number.isFinite(at) || count <= 0) {
          continue;
        }
        for (const [originalLine, currentLine] of Array.from(mappedByOriginal)) {
          if (currentLine >= at) {
            mappedByOriginal.set(originalLine, currentLine + count);
          }
        }
      }
      const workLogDateText = resolveSchedulingWorkLogDateText(
        schedulingWorkLogInput,
        undefined,
      );
      schedulingWorkLogWrittenCount = applySchedulingWorkLogsToLines(
        source.lines,
        mappedByOriginal,
        eligibleOriginalLines,
        schedulingWorkLogInput.summary,
        workLogDateText,
      );
    }
  }

  nextContent = source.lines.join(source.lineEnding);
  const cursorLine = session.targets[0].line + taskLineDelta;
  return Object.freeze({
    valid: true,
    stale: false,
    error: null,
    operation,
    propertyName,
    value: normalizedValue,
    scheduledPropertyName,
    content: nextContent,
    changed: nextContent !== text,
    changedTaskCount: changedTargets.length,
    unchangedTaskCount: unchangedTargets.length,
    targetCount: session.targets.length,
    changedTargets: Object.freeze(changedTargets),
    unchangedTargets: Object.freeze(unchangedTargets),
    cursorLine,
    cursorLineDelta: taskLineDelta,
    propagatedScheduleTaskCount,
    removedProjectScheduleTaskCount,
    removedHideTaskCount,
    ambiguousProjectTaskCount,
    blockedTaskCount,
    scheduleLoggedTaskCount,
    scheduleLogCreatedParentCount,
    scheduleLogFallbackTaskCount,
    schedulingWorkLogWrittenCount,
    schedulingWorkLogEligibleCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
  });
}

// Converge one selected dependency across every counted source task. All
// source fields, target identity normalization, and per-parent navigation
// bullets are built in memory so the runtime path can apply exactly one write.
