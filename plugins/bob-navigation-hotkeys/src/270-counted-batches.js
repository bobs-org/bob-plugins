function planCountedLocalTaskDependency(
  content,
  session,
  dependencyTask,
  filePath,
  options = {},
) {
  const text = String(content || "");
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
  const countedLines = String(content || "").split(/\r?\n/);
  for (const target of session.targets || []) {
    if (
      Number.isInteger(target.line) &&
      isBlockquotedMarkdownLine(countedLines[target.line])
    ) {
      return Object.freeze({
        valid: false,
        stale: true,
        error: "⛓ Dependencies can't be edited inside a blockquote",
        content: text,
        changed: false,
      });
    }
  }

  const dependencyLine = dependencyTask && dependencyTask.line;
  const sourceLines = new Set(session.targets.map((target) => target.line));
  const currentDependencyLine = Number.isInteger(dependencyLine)
    ? splitMarkdownContent(text).lines[dependencyLine]
    : undefined;
  if (
    !dependencyTask ||
    sourceLines.has(dependencyLine) ||
    currentDependencyLine !== dependencyTask.rawLine ||
    !isObsidianTaskAtLine(text, dependencyLine)
  ) {
    return Object.freeze({
      valid: false,
      stale: true,
      error: "The selected dependency changed while the picker was open",
      content: text,
      changed: false,
    });
  }

  const confirmedBlockId = normalizeBulletPropertyValue(
    options.confirmedBlockId,
  );
  let dependencyLineText = currentDependencyLine;
  let resolved = resolveTargetTaskIdentity(dependencyLineText, {
    promptWhenBlockIdMissing: true,
    filePath,
  });
  if (resolved.needsBlockIdPrompt) {
    if (!confirmedBlockId) {
      return Object.freeze({
        valid: false,
        stale: false,
        needsBlockIdPrompt: true,
        error: "The selected dependency needs a block ID",
        content: text,
        changed: false,
      });
    }
    const blockIdValidation = validateBlockIdCandidate(
      confirmedBlockId,
      text,
    );
    if (!blockIdValidation.valid) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: blockIdValidation.message,
        content: text,
        changed: false,
      });
    }
    // An existing valid `[id::]` is never rewritten (§3): only the missing
    // `^id` is appended, and the kept id resolves the field.
    dependencyLineText = applyPromptedBlockIdPreservingLegacyId(
      dependencyLineText,
      confirmedBlockId,
      filePath,
    );
    if (dependencyLineText === null) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: "This note path cannot be encoded as a dependency ID",
        content: text,
        changed: false,
      });
    }
    resolved = Object.freeze({
      value: dependencyTargetId(
        dependencyLineText,
        filePath,
        confirmedBlockId,
      ),
      linkBlockId: confirmedBlockId,
      legacyValue:
        normalizeBulletPropertyValue(dependencyTask.existingIdField) || null,
      needsBlockIdPrompt: false,
      targetEdits: Object.freeze([]),
    });
  } else if (resolved.targetEdits.length > 0) {
    // An existing valid `[id::]` is never rewritten (§3): only apply the
    // add-missing-id edit and resolve the kept id for the field.
    const missingIdEdits = resolved.targetEdits.filter(
      (edit) => edit.kind === "add-id-field",
    );
    if (missingIdEdits.length > 0) {
      dependencyLineText =
        missingIdEdits[missingIdEdits.length - 1].line;
    }
    const keptValue = dependencyTargetId(
      dependencyLineText,
      filePath,
      resolved.linkBlockId,
    );
    resolved = Object.freeze({
      value: keptValue,
      linkBlockId: resolved.linkBlockId,
      legacyValue: resolved.legacyValue,
      needsBlockIdPrompt: false,
      targetEdits: Object.freeze([]),
    });
  }

  if (!resolved.value || !resolved.linkBlockId) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Could not identify the selected dependency",
      content: text,
      changed: false,
    });
  }

  const dependencyAliases = new Set(
    [
      resolved.value,
      resolved.legacyValue,
      dependencyTask.existingIdField,
      dependencyTask.existingBlockId,
    ]
      .map(normalizeBulletPropertyValue)
      .filter(Boolean),
  );
  const linkedBefore = session.targets.map((target) => {
    const field = findBulletPropertyField(target.rawLine, "dependsOn");
    const values = new Set(
      field ? parseLocalTaskIdList(field.value) : [],
    );
    return Array.from(dependencyAliases).some((alias) => values.has(alias));
  });
  const remove = linkedBefore.every(Boolean);

  // An existing valid `[id::]` is never rewritten (§3): the kept id
  // resolves every source field through the planner below.
  const nextSource = splitMarkdownContent(text);
  nextSource.lines[dependencyLine] = dependencyLineText;
  let nextContent = nextSource.lines.join(nextSource.lineEnding);

  // Freshness is the last transformation of each parent task line
  // (nav-stamps). Process parents bottom-to-top through the pure planner so
  // every source keeps the line, the field, status effects, and legacy
  // folding; edits only shift lines below the current parent, so every
  // still-pending source retains its snapshot index.
  const countedDepStamper = resolveFreshStamper(options);
  const countedDepFreshDateText = resolveFreshDateText(options);
  const countedTargetRef = Object.freeze({
    path: normalizeVaultRelativePath(filePath),
    blockId: resolved.linkBlockId,
  });
  let navigationChangedCount = 0;
  const sourceResults = [];
  const orderedTargets = session.targets
    .slice()
    .sort((first, second) => second.line - first.line);
  for (const target of orderedTargets) {
    const parentPlan = planDependencyEdit({
      content: nextContent,
      parentLine: target.line,
      parentPath: filePath,
      add: remove ? [] : [countedTargetRef],
      remove: remove ? [countedTargetRef] : [],
      files: { [normalizeVaultRelativePath(filePath)]: nextContent },
      vaultFiles: options.vaultFiles,
      resolveLinkpath: options.resolveLinkpath,
      recovery: options.recovery,
    });
    if (!parentPlan.ok) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: "Could not plan dependency navigation for every source task",
        content: text,
        changed: false,
      });
    }
    const beforeLines = nextContent.split(/\r?\n/);
    const currentLine = String(beforeLines[target.line] || "");
    let parentChanged =
      parentPlan.changed || currentLine !== target.rawLine;
    nextContent = parentPlan.nextContent;
    if (countedDepStamper && parentChanged) {
      const afterLines = nextContent.split(/\r?\n/);
      const stamped = applyFreshStampLine(
        afterLines[target.line],
        countedDepStamper,
        countedDepFreshDateText,
      );
      if (stamped !== afterLines[target.line]) {
        afterLines[target.line] = stamped;
        const ending = nextContent.includes("\r\n") ? "\r\n" : "\n";
        nextContent = afterLines.join(ending);
        parentChanged = true;
      }
    }
    if (
      parentPlan.structural.replaceLine !== null ||
      parentPlan.structural.insertAt !== null ||
      parentPlan.structural.deleteLines.length > 0
    ) {
      navigationChangedCount += 1;
    }
    sourceResults.push({
      target,
      dependencyChanged: parentChanged,
      navigationChanged: parentPlan.changed,
    });
  }

  const changedTaskCount = sourceResults.filter(
    (entry) => entry.dependencyChanged || entry.navigationChanged,
  ).length;
  return Object.freeze({
    valid: true,
    stale: false,
    needsBlockIdPrompt: false,
    error: null,
    content: nextContent,
    changed: nextContent !== text,
    operation: remove ? "remove" : "add",
    dependencyValue: resolved.value,
    linkBlockId: resolved.linkBlockId,
    targetIdentityChanged: dependencyLineText !== currentDependencyLine,
    changedTaskCount,
    unchangedTaskCount: session.targets.length - changedTaskCount,
    targetCount: session.targets.length,
    navigationChangedCount,
    cursorLine: session.targets[0].line,
  });
}

function getLocalDateStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function compareLocalDates(firstDate, secondDate) {
  const firstTime = getLocalDateStart(firstDate).getTime();
  const secondTime = getLocalDateStart(secondDate).getTime();
  if (firstTime === secondTime) {
    return 0;
  }

  return firstTime < secondTime ? -1 : 1;
}

function addLocalDateDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function getLocalDayOffset(baseDate, targetDate) {
  const baseTime = getLocalDateStart(baseDate).getTime();
  const targetTime = getLocalDateStart(targetDate).getTime();
  return Math.round((targetTime - baseTime) / 86_400_000);
}

function formatRelativeDayOffset(offset) {
  const days = Number(offset);
  if (!Number.isFinite(days)) {
    return "";
  }
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days === -1) {
    return "yesterday";
  }
  if (days > 1) {
    return `in ${days} days`;
  }
  return `${Math.abs(days)} days ago`;
}

function formatRelativeDayRange(minOffset, maxOffset) {
  const min = Number(minOffset);
  const max = Number(maxOffset);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "";
  }
  if (min === max) {
    return formatRelativeDayOffset(min);
  }
  if (min >= 1) {
    return `in ${min}–${max} days`;
  }
  return `${formatRelativeDayOffset(min)} to ${formatRelativeDayOffset(max)}`;
}

function rollPriorityScheduledDateWithOffset(
  level,
  baseDate,
  random = Math.random,
) {
  const span = level.maxDays - level.minDays + 1;
  const rolledOffset = Math.floor(random() * span);
  const offset =
    level.minDays + clampNumber(rolledOffset, 0, Math.max(0, span - 1));
  return Object.freeze({
    date: addLocalDateDays(getLocalDateStart(baseDate), offset),
    offset,
  });
}

function rollPriorityScheduledDate(level, baseDate, random = Math.random) {
  return rollPriorityScheduledDateWithOffset(level, baseDate, random).date;
}

// Roll a recommendation date that never lands on the task's current `scheduled`
// date when the window has room. Draws uniformly from the window minus the
// current date's offset, and only when that offset is inside the window and the
// window spans more than one day; otherwise behaves exactly like
// rollPriorityScheduledDateWithOffset. A skipped automatic entry (unchanged
// date) would otherwise silently lose a streak step.
function rollPriorityRecommendationDate(
  level,
  baseDate,
  random = Math.random,
  avoidValue = "",
) {
  const bounds = getPriorityRollBounds(level);
  const start = getLocalDateStart(baseDate);
  if (!bounds) {
    return rollPriorityScheduledDateWithOffset(level, baseDate, random);
  }
  const span = bounds.maxDays - bounds.minDays + 1;
  if (!(span > 1)) {
    return rollPriorityScheduledDateWithOffset(level, baseDate, random);
  }
  const avoidText = normalizeBulletPropertyValue(avoidValue);
  const avoidMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(avoidText);
  if (!avoidMatch) {
    return rollPriorityScheduledDateWithOffset(level, baseDate, random);
  }
  const avoidDate = new Date(
    Number(avoidMatch[1]),
    Number(avoidMatch[2]) - 1,
    Number(avoidMatch[3]),
  );
  if (!Number.isFinite(avoidDate.getTime())) {
    return rollPriorityScheduledDateWithOffset(level, baseDate, random);
  }
  const avoidOffset = getLocalDayOffset(start, avoidDate);
  if (avoidOffset < bounds.minDays || avoidOffset > bounds.maxDays) {
    return rollPriorityScheduledDateWithOffset(level, baseDate, random);
  }
  const rolled = Math.floor(random() * (span - 1));
  const clamped = clampNumber(rolled, 0, Math.max(0, span - 2));
  let offset = bounds.minDays + clamped;
  if (offset >= avoidOffset) {
    offset += 1;
  }
  return Object.freeze({
    date: addLocalDateDays(start, offset),
    offset,
  });
}

function addLocalDateMonths(date, months) {
  const targetMonthIndex = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const targetDay = Math.min(
    date.getDate(),
    getDaysInMonth(targetYear, targetMonth),
  );

  return new Date(targetYear, normalizedMonthIndex, targetDay);
}

function getDaysUntilWeekday(date, weekday, allowToday) {
  const delta = (weekday - date.getDay() + 7) % 7;
  return delta === 0 && !allowToday ? 7 : delta;
}

function formatBulletPropertyDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBulletPropertyDateWeekday(date) {
  return BULLET_PROPERTY_WEEKDAY_NAMES[date.getDay()] || "";
}

function createBulletPropertyDateValueItem(
  label,
  date,
  currentValue,
  options = {},
) {
  const value = formatBulletPropertyDate(date);
  const weekday = getBulletPropertyDateWeekday(date);
  return {
    kind: "value",
    value,
    label,
    detail: `${value} · ${weekday}`,
    current: value === currentValue,
    dynamic: !!options.dynamic,
    searchText: `${label} ${value} ${weekday}`,
  };
}

function createBulletPropertyDateItems(baseDate, currentValue) {
  const today = getLocalDateStart(baseDate);
  const saturday = addLocalDateDays(
    today,
    getDaysUntilWeekday(today, 6, true),
  );
  const sunday = addLocalDateDays(today, getDaysUntilWeekday(today, 0, true));
  const nextMonday = addLocalDateDays(
    today,
    getDaysUntilWeekday(today, 1, false),
  );

  return [
    ["Today", today],
    ["Tomorrow", addLocalDateDays(today, 1)],
    ["In 2 days", addLocalDateDays(today, 2)],
    ["In 3 days", addLocalDateDays(today, 3)],
    ["This Saturday", saturday],
    ["This Sunday", sunday],
    ["Next Monday", nextMonday],
    ["In 1 week", addLocalDateDays(today, 7)],
    ["In 2 weeks", addLocalDateDays(today, 14)],
    ["In 1 month", addLocalDateMonths(today, 1)],
  ].map(([label, date]) =>
    createBulletPropertyDateValueItem(label, date, currentValue),
  );
}

function createPriorityRollDateItem(
  level,
  baseDate,
  currentValue,
  random = Math.random,
) {
  const roll = rollPriorityScheduledDateWithOffset(level, baseDate, random);
  const date = roll.date;
  const value = formatBulletPropertyDate(date);
  const weekday = getBulletPropertyDateWeekday(date);
  return {
    kind: "value",
    value,
    label: `${level.label} roll`,
    detail: `${value} · ${weekday} · ${formatPriorityRollWindowText(level)}`,
    current: value === currentValue,
    dynamic: false,
    priorityRoll: true,
    level,
    rolledDays: roll.offset,
    searchText: `${level.label} roll ${value} ${weekday} random priority`,
  };
}

function getPriorityLevelIconName(levelIndex) {
  if (levelIndex === 0) {
    return "signal-high";
  }
  if (levelIndex === 1) {
    return "signal-medium";
  }
  if (levelIndex === 2) {
    return "signal-low";
  }
  return "signal-zero";
}

function normalizePriorityLevelIndex(property, level, levelIndex) {
  if (Number.isInteger(levelIndex) && levelIndex >= 0) {
    return levelIndex;
  }
  const levels = property && Array.isArray(property.levels)
    ? property.levels
    : [];
  const directIndex = levels.indexOf(level);
  if (directIndex >= 0) {
    return directIndex;
  }
  const levelLabel = level && normalizeBulletPropertyValue(level.label);
  const levelValue = level && normalizeBulletPropertyValue(level.value);
  const matchingIndex = levels.findIndex(
    (candidate) =>
      normalizeBulletPropertyValue(candidate && candidate.label) === levelLabel &&
      normalizeBulletPropertyValue(candidate && candidate.value) === levelValue,
  );
  return matchingIndex >= 0 ? matchingIndex : 0;
}

function parsePriorityNoticeScheduledValue(value) {
  const text = normalizeBulletPropertyValue(value);
  const validation = validateProjectScheduledDate(text);
  if (!validation.valid) {
    return Object.freeze({
      text: text || validation.value,
      valid: false,
      date: null,
      time: null,
      weekday: "",
    });
  }
  const date = projectScheduleLocalDate(validation);
  return Object.freeze({
    text: validation.value,
    valid: true,
    date,
    time: getLocalDateStart(date).getTime(),
    weekday: getBulletPropertyDateWeekday(date),
  });
}

function getPriorityNoticeScheduleSummary(values, baseDate) {
  const entries = (Array.isArray(values) ? values : [values])
    .map(parsePriorityNoticeScheduledValue)
    .filter((entry) => entry.text);
  if (entries.length === 0) {
    return Object.freeze({
      exactDateText: "",
      dateStartText: "",
      dateEndText: "",
      weekdayText: "",
      relativeText: "",
      textDateText: "",
      dateText: "",
    });
  }
  const validEntries = entries.filter((entry) => entry.valid);
  if (validEntries.length !== entries.length) {
    if (entries.length === 1) {
      return Object.freeze({
        exactDateText: entries[0].text,
        dateStartText: entries[0].text,
        dateEndText: "",
        weekdayText: "",
        relativeText: "",
        textDateText: entries[0].text,
        dateText: entries[0].text,
      });
    }
    const firstText = entries[0].text;
    const lastText = entries[entries.length - 1].text;
    const textDateText = `${firstText} to ${lastText}`;
    return Object.freeze({
      exactDateText: `${firstText} → ${lastText}`,
      dateStartText: firstText,
      dateEndText: lastText,
      weekdayText: "",
      relativeText: "",
      textDateText,
      dateText: textDateText,
    });
  }

  const sortedEntries = validEntries
    .slice()
    .sort((first, second) => first.time - second.time);
  const first = sortedEntries[0];
  const last = sortedEntries[sortedEntries.length - 1];
  if (first.time === last.time) {
    const textDateText = `${first.text} · ${first.weekday}`;
    return Object.freeze({
      exactDateText: first.text,
      dateStartText: first.text,
      dateEndText: "",
      weekdayText: first.weekday,
      relativeText: formatRelativeDayOffset(
        getLocalDayOffset(baseDate, first.date),
      ),
      textDateText,
      dateText: textDateText,
    });
  }

  const minOffset = getLocalDayOffset(baseDate, first.date);
  const maxOffset = getLocalDayOffset(baseDate, last.date);
  const textDateText = `${first.text} to ${last.text}`;
  return Object.freeze({
    exactDateText: `${first.text} → ${last.text}`,
    dateStartText: first.text,
    dateEndText: last.text,
    weekdayText: "",
    relativeText: formatRelativeDayRange(minOffset, maxOffset),
    textDateText,
    dateText: textDateText,
  });
}

function normalizePriorityNoticeCount(value) {
  return Math.max(0, Math.floor(numericOrDefault(value, 0)));
}

function getPriorityNoticeRecoveryCounts(outcome = {}) {
  const recoveryCounts = outcome.recoveryCounts || {};
  return Object.freeze({
    ready: normalizePriorityNoticeCount(
      recoveryCounts.ready ?? outcome.recoveredReadyTaskCount,
    ),
    next: normalizePriorityNoticeCount(
      recoveryCounts.next ?? outcome.recoveredNextTaskCount,
    ),
    inProgress: normalizePriorityNoticeCount(
      recoveryCounts.inProgress ?? outcome.recoveredInProgressTaskCount,
    ),
    stillBlocked: normalizePriorityNoticeCount(
      recoveryCounts.stillBlocked ?? outcome.stillBlockedTaskCount,
    ),
    deferred: normalizePriorityNoticeCount(
      recoveryCounts.deferred ?? outcome.deferredRecoveryTaskCount,
    ),
  });
}

function getPriorityNoticeBlockedText(count, scope) {
  if (count <= 0) {
    return "";
  }
  if (scope === "task") {
    return "marked task Blocked";
  }
  return `marked ${formatCountLabel(count, "task")} Blocked`;
}

function getPriorityNoticeOutcomeParts(outcome = {}, scope = "task") {
  const parts = [];
  if (scope === "counted") {
    parts.push(
      ...getCountedTaskNoticeParts(
        outcome.session,
        normalizePriorityNoticeCount(outcome.unchangedTaskCount),
      ),
    );
  }
  const propagatedScheduleTaskCount = normalizePriorityNoticeCount(
    outcome.propagatedScheduleTaskCount ?? outcome.scheduledTaskCount,
  );
  if (propagatedScheduleTaskCount > 0) {
    parts.push(
      `scheduled ${formatCountLabel(propagatedScheduleTaskCount, "task")}`,
    );
  }
  const removedHideTaskCount = normalizePriorityNoticeCount(
    outcome.removedHideTaskCount,
  );
  if (removedHideTaskCount > 0) {
    parts.push(
      `removed #hide from ${formatCountLabel(removedHideTaskCount, "task")}`,
    );
  }
  const scheduleLoggedTaskCount = normalizePriorityNoticeCount(outcome.scheduleLoggedTaskCount);
  if (scheduleLoggedTaskCount > 0) {
    parts.push(
      scope === "counted" ? `logged reason on ${formatCountLabel(scheduleLoggedTaskCount, "task")}` : "logged reason",
    );
  }
  const schedulingWorkLogWrittenCount = normalizePriorityNoticeCount(
    outcome.schedulingWorkLogWrittenCount,
  );
  if (schedulingWorkLogWrittenCount > 0) {
    parts.push(
      scope === "counted"
        ? `${formatCountLabel(schedulingWorkLogWrittenCount, "Work Log")}`
        : "1 Work Log",
    );
  }
  const blockedText = getPriorityNoticeBlockedText(
    normalizePriorityNoticeCount(outcome.blockedTaskCount),
    scope,
  );
  if (blockedText) {
    parts.push(blockedText);
  }
  const ambiguousTaskCount = normalizePriorityNoticeCount(
    outcome.ambiguousTaskCount ?? outcome.ambiguousProjectTaskCount,
  );
  if (ambiguousTaskCount > 0) {
    parts.push(
      `${formatCountLabel(ambiguousTaskCount, "task")} with multiple scheduled fields unchanged`,
    );
  }
  parts.push(...scheduledRecoveryNoticeParts(getPriorityNoticeRecoveryCounts(outcome)));
  const removedPomodoroLinkCount = normalizePriorityNoticeCount(
    outcome.removedPomodoroLinkCount,
  );
  if (removedPomodoroLinkCount > 0) {
    parts.push(
      `removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`,
    );
  } else if (outcome.pomodoroPruneFailed) {
    parts.push("Pomodoro links not removed");
  }
  return Object.freeze(parts);
}

function getPriorityNoticeChipTone(text) {
  if (/^recovered /.test(text)) {
    return "ok";
  }
  if (/Blocked$/.test(text)) {
    return "warn";
  }
  if (text === "Pomodoro links not removed") {
    return "warn";
  }
  if (/^(scheduled|removed #hide|removed \d+ Pomodoro links?)/.test(text)) {
    return "info";
  }
  if (/^logged reason/.test(text)) {
    return "info";
  }
  if (/Work Log$/.test(text)) {
    return "info";
  }
  return "muted";
}

function getPriorityNoticeChipText(text) {
  const markedMatch = /^marked (?:(\d+) tasks?|task) Blocked$/.exec(text);
  if (markedMatch) {
    return markedMatch[1] ? `${markedMatch[1]} Blocked` : "Blocked";
  }
  const loggedMatch = /^logged reason(?: on (\d+) tasks?)?$/.exec(text);
  if (loggedMatch) {
    return loggedMatch[1] ? `${loggedMatch[1]} logged` : "logged";
  }
  const workLogMatch = /^(\d+) Work Logs?$/.exec(text);
  if (workLogMatch) {
    return workLogMatch[1] === "1" ? "1 Work Log" : `${workLogMatch[1]} Work Log`;
  }
  if (text === "1 Work Log") {
    return "1 Work Log";
  }
  const pomodoroRemovedMatch = /^removed (\d+) Pomodoro links?$/.exec(text);
  if (pomodoroRemovedMatch) {
    return `${pomodoroRemovedMatch[1]} removed`;
  }
  if (text === "Pomodoro links not removed") {
    return "not removed";
  }
  return text;
}

function formatPriorityNoticeText(model) {
  const parts = [];
  if (model.textHeader) {
    parts.push(model.textHeader);
  }
  if (Array.isArray(model.leadingTextParts)) {
    parts.push(...model.leadingTextParts);
  }
  const dateText = model.textDateText || model.dateText || model.exactDateText;
  if (dateText) {
    const dateLabel = model.textDateLabel || model.dateLabel || "scheduled";
    const relativeText = model.relativeText ? ` · ${model.relativeText}` : "";
    parts.push(`${dateLabel} → ${dateText}${relativeText}`);
  }
  if (Array.isArray(model.outcomeTextParts)) {
    parts.push(...model.outcomeTextParts);
  }
  return parts.join("; ");
}

