// Project scheduling is stored on the ordinary ^prj task line. The project
// schedule still propagates to residents and owns the same block/recovery
// effects, but no navigation writer reads or writes YAML `scheduled`.
function getProjectScheduleRecoveryTargetLines(content) {
  return getRealMarkdownTaskLines(content)
    .filter((task) => {
      if (!PROJECT_TASK_TAG_RE.test(task.text)) return false;
      const match = OBSIDIAN_TASK_LINE_RE.exec(task.text);
      return Boolean(match && OPEN_OBSIDIAN_TASK_STATUSES.has(match[1]));
    })
    .map((task) => task.line);
}

function upsertProjectTaskScheduledField(
  lineText,
  scheduled,
  previousProjectScheduled = "",
) {
  const text = String(lineText || "");
  const fields = parseProjectTaskScheduledFields(text);
  if (fields.length > 1) {
    return Object.freeze({ line: text, changed: false, ambiguous: true });
  }
  if (fields.length === 1) {
    const current = validateProjectScheduledDate(fields[0].value);
    const previous = normalizeBulletPropertyValue(previousProjectScheduled);
    const movingPriorCopyEarlier =
      previous && current.valid && current.value === previous;
    if (
      current.valid &&
      current.value >= scheduled &&
      !movingPriorCopyEarlier
    ) {
      return Object.freeze({ line: text, changed: false, ambiguous: false });
    }
    const nextLine =
      text.slice(0, fields[0].span.start) +
      formatBulletPropertyField("scheduled", scheduled) +
      text.slice(fields[0].span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      ambiguous: false,
    });
  }
  const inserted = upsertBulletProperty(text, "scheduled", scheduled);
  return Object.freeze({
    line: inserted.line,
    changed: inserted.changed,
    ambiguous: false,
  });
}

function planProjectTaskSchedules(
  content,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  const original = String(content || "");
  if (!validation.valid) {
    return Object.freeze({
      valid: false,
      error: validation.message,
      content: original,
      changed: false,
      changedTaskCount: 0,
      scheduledTaskCount: 0,
      removedHideTaskCount: 0,
      blockedTaskCount: 0,
      recoveredReadyTaskCount: 0,
      recoveredNextTaskCount: 0,
      recoveredInProgressTaskCount: 0,
      stillBlockedTaskCount: 0,
      deferredRecoveryTaskCount: 0,
      ambiguousTaskLines: Object.freeze([]),
      taskCount: 0,
      futureScheduledTaskLines: Object.freeze([]),
    });
  }

  const date = new Date(
    validation.year,
    validation.month - 1,
    validation.day,
  );
  const future = compareLocalDates(date, getLocalDateStart(today)) > 0;
  const source = splitMarkdownContent(original);
  const tasks = getRealMarkdownTaskLines(original).filter((task) =>
    PROJECT_TASK_TAG_RE.test(task.text),
  );
  const projectTask = tasks.find((task) => task.isProjectTask);
  const previousProjectScheduled = normalizeBulletPropertyValue(
    options.previousScheduled !== undefined
      ? options.previousScheduled
      : projectTask
        ? readProjectTaskScheduledValue(projectTask.text)
        : "",
  );
  let changedTaskCount = 0;
  let scheduledTaskCount = 0;
  let removedHideTaskCount = 0;
  let blockedTaskCount = 0;
  let projectHideChanged = false;
  const ambiguousTaskLines = [];
  const futureScheduledTaskLines = [];
  const recoveryCounts = emptyScheduledRecoveryCounts();

  for (const task of tasks) {
    let nextLine = task.text;
    const statusMatch = OBSIDIAN_TASK_LINE_RE.exec(nextLine);
    const status = statusMatch ? statusMatch[1] : null;
    if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      continue;
    }

    if (task.isProjectTask) {
      const beforeHide = getWholeTaskTagSpans(nextLine, PROJECT_HIDE_TAG).length;
      nextLine = normalizeProjectLifecycleHideTag(
        nextLine,
        future,
        future || tasks.length === 1,
      );
      projectHideChanged =
        projectHideChanged ||
        beforeHide !== getWholeTaskTagSpans(nextLine, PROJECT_HIDE_TAG).length;
      const priorField = findBulletPropertyField(nextLine, "scheduled");
      const scheduleResult = upsertBulletProperty(
        nextLine,
        "scheduled",
        validation.value,
      );
      nextLine = scheduleResult.line;
      if (scheduleResult.changed) scheduledTaskCount += 1;
      if (future) {
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) blockedTaskCount += 1;
        nextLine = blockedLine;
        futureScheduledTaskLines.push(task.line);
      } else {
        nextLine = setProjectBlockedTag(nextLine, false);
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, task.line),
          {
            today,
            ownLine: true,
            markUnblockedLine: options.markUnblockedLine,
          },
        );
        nextLine = recovery.line;
        recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
      }
      if (!priorField && scheduleResult.changed && !future) {
        // A due date is still an explicit project schedule; only the blocked
        // state changes when its reason clears.
      }
    } else {
      const scheduledFields = parseProjectTaskScheduledFields(nextLine);
      if (scheduledFields.length > 1) {
        ambiguousTaskLines.push(task.line);
        if (future) {
          nextLine = setProjectBlockedTag(nextLine, true);
          const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
          if (blockedLine !== nextLine) blockedTaskCount += 1;
          nextLine = blockedLine;
          futureScheduledTaskLines.push(task.line);
        } else {
          nextLine = setProjectBlockedTag(nextLine, false);
        }
      } else {
        const withoutHide = removeTextSpans(
          nextLine,
          getWholeTaskTagSpans(nextLine, PROJECT_HIDE_TAG),
        );
        if (withoutHide !== nextLine) removedHideTaskCount += 1;
        nextLine = withoutHide;
        const scheduleResult = upsertProjectTaskScheduledField(
          nextLine,
          validation.value,
          previousProjectScheduled,
        );
        nextLine = scheduleResult.line;
        if (scheduleResult.changed) scheduledTaskCount += 1;
        const ownFields = parseProjectTaskScheduledFields(nextLine);
        const ownFuture =
          ownFields.length === 1 &&
          isFutureInlineScheduledValue(ownFields[0].value, today);

        if (future) {
          nextLine = setProjectBlockedTag(nextLine, true);
          const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
          if (blockedLine !== nextLine) blockedTaskCount += 1;
          nextLine = blockedLine;
          futureScheduledTaskLines.push(task.line);
        } else {
          nextLine = setProjectBlockedTag(nextLine, false);
          if (ownFuture) {
            const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
            if (blockedLine !== nextLine) blockedTaskCount += 1;
            nextLine = blockedLine;
            futureScheduledTaskLines.push(task.line);
          } else {
            const recovery = reconcileBlockedScheduledTaskLine(
              nextLine,
              getTargetScheduledRecovery(options, task.line),
              {
                today,
                ownLine: false,
                markUnblockedLine: options.markUnblockedLine,
              },
            );
            nextLine = recovery.line;
            recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
          }
        }
      }
    }

    if (nextLine !== task.text) {
      source.lines[task.line] = nextLine;
      changedTaskCount += 1;
    }
  }

  const nextContent = source.lines.join(source.lineEnding);
  return Object.freeze({
    valid: true,
    error: null,
    content: nextContent,
    changed: nextContent !== original,
    changedTaskCount,
    scheduledTaskCount,
    removedHideTaskCount,
    blockedTaskCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
    ambiguousTaskLines: Object.freeze(ambiguousTaskLines),
    taskCount: tasks.length,
    future,
    projectHideChanged,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
  });
}

function planProjectScheduledUpdate(
  content,
  cursorLine,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  if (!validation.valid) {
    return Object.freeze({ valid: false, error: validation.message });
  }
  const context = getProjectNotePropertyContext(content, cursorLine, options);
  if (!context.valid || !context.isProjectTask) {
    return Object.freeze({
      valid: false,
      error: context.error || "Cursor is not on a valid ^prj task",
    });
  }
  const previousScheduled = readProjectTaskScheduledValue(context.lineText);
  const propagation = planProjectTaskSchedules(
    content,
    validation.value,
    today,
    { ...options, previousScheduled },
  );
  if (!propagation.valid) {
    return Object.freeze({ valid: false, error: propagation.error });
  }
  return Object.freeze({
    ...propagation,
    valid: true,
    error: null,
    cursorLine,
    scheduled: validation.value,
  });
}

function planProjectScheduledDelete(content, cursorLine, options = {}) {
  const original = String(content || "");
  const context = getProjectNotePropertyContext(original, cursorLine, options);
  if (!context.valid || !context.isProjectTask) {
    return Object.freeze({
      valid: false,
      error: context.error || "Cursor is not on a valid ^prj task",
    });
  }
  const scheduled = readProjectTaskScheduledValue(context.lineText);
  if (!scheduled) {
    return Object.freeze({
      valid: false,
      error: "scheduled is not set on this project",
    });
  }

  const source = splitMarkdownContent(original);
  const tasks = getRealMarkdownTaskLines(original).filter((task) =>
    PROJECT_TASK_TAG_RE.test(task.text),
  );
  const recoveryCounts = emptyScheduledRecoveryCounts();
  let changedTaskCount = 0;
  let removedScheduledTaskCount = 0;
  const futureScheduledTaskLines = [];
  for (const task of tasks) {
    let nextLine = task.text;
    const match = OBSIDIAN_TASK_LINE_RE.exec(nextLine);
    if (!match || !OPEN_OBSIDIAN_TASK_STATUSES.has(match[1])) continue;
    if (task.isProjectTask) {
      nextLine = removeProjectTaskScheduledFields(nextLine).line;
      nextLine = normalizeProjectLifecycleHideTag(
        nextLine,
        false,
        tasks.length === 1,
      );
      nextLine = setProjectBlockedTag(nextLine, false);
      const recovery = reconcileBlockedScheduledTaskLine(
        nextLine,
        getTargetScheduledRecovery(options, task.line),
        {
          today: options.today,
          ownLine: true,
          markUnblockedLine: options.markUnblockedLine,
        },
      );
      nextLine = recovery.line;
      recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
    } else {
      const removed = removeProjectTaskScheduledFields(
        nextLine,
        (field) => field.value === scheduled,
      );
      nextLine = removed.line;
      if (removed.removedCount > 0) removedScheduledTaskCount += 1;
      nextLine = setProjectBlockedTag(nextLine, false);
      const ownFields = parseProjectTaskScheduledFields(nextLine);
      const ownFuture =
        ownFields.length === 1 &&
        isFutureInlineScheduledValue(
          ownFields[0].value,
          options.today || new Date(),
        );
      if (ownFuture) {
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) nextLine = blockedLine;
        futureScheduledTaskLines.push(task.line);
      } else {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, task.line),
          {
            today: options.today,
            ownLine: false,
            markUnblockedLine: options.markUnblockedLine,
          },
        );
        nextLine = recovery.line;
        recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
      }
    }
    if (nextLine !== task.text) {
      source.lines[task.line] = nextLine;
      changedTaskCount += 1;
    }
  }

  const nextContent = source.lines.join(source.lineEnding);
  return Object.freeze({
    valid: true,
    error: null,
    content: nextContent,
    changed: nextContent !== original,
    cursorLine,
    scheduled,
    changedTaskCount,
    removedScheduledTaskCount,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
  });
}
