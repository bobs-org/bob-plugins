function planPriorityRollRecommendation(options = {}) {
  const property = options.property;
  if (!property || property.values !== "priority") {
    return null;
  }
  const levels = Array.isArray(property.levels) ? property.levels : [];
  let currentValue = normalizeBulletPropertyValue(options.currentValue);
  let recurring = options.recurring === true;
  let streak = options.streak;
  if (
    (currentValue === "" || streak === undefined) &&
    options.content !== undefined &&
    options.taskLine !== undefined
  ) {
    const lines = String(options.content || "").split(/\r?\n/);
    const taskIndex = Math.floor(numericOrDefault(options.taskLine, NaN));
    if (Number.isFinite(taskIndex) && taskIndex >= 0 && taskIndex < lines.length) {
      const lineText = String(lines[taskIndex] || "");
      if (currentValue === "") {
        const field = findBulletPropertyField(lineText, property.name);
        currentValue = normalizeBulletPropertyValue(field && field.value);
      }
      if (isRecurringTaskLine(lineText)) {
        recurring = true;
      }
      if (streak === undefined) {
        streak =
          currentValue === ""
            ? 0
            : getPriorityRollStreak(
                options.content,
                options.taskLine,
                getBulletPropertyCurrentLabel(property, currentValue),
              );
      }
    }
  }
  if (currentValue === "") {
    return null;
  }
  const level =
    property.levelsByValue instanceof Map
      ? property.levelsByValue.get(currentValue)
      : levels.find((candidate) => candidate && candidate.value === currentValue);
  if (!level) {
    return null;
  }
  const levelIndex = levels.indexOf(level);
  const safeLevelIndex = levelIndex >= 0 ? levelIndex : 0;
  const streakCount = Number.isFinite(Number(streak))
    ? Math.max(0, Math.floor(Number(streak)))
    : 0;
  const limit = getPriorityLevelRollLimit(property, level);
  const baseDate =
    options.baseDate instanceof Date ? options.baseDate : new Date();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const currentScheduled = normalizeBulletPropertyValue(options.currentScheduled);

  if (limit === null || streakCount < limit) {
    const step = limit === null ? null : streakCount + 1;
    const roll = rollPriorityRecommendationDate(
      level,
      baseDate,
      random,
      currentScheduled,
    );
    return Object.freeze({
      kind: "roll",
      level,
      levelIndex: safeLevelIndex,
      streak: streakCount,
      limit,
      step,
      date: formatBulletPropertyDate(roll.date),
      offset: roll.offset,
      reason: formatPriorityRollScheduleReason({
        source: "scheduled",
        level,
        rolledDays: roll.offset,
      }),
    });
  }

  const nextLevel = levels[safeLevelIndex + 1] || null;
  if (nextLevel) {
    const roll = rollPriorityRecommendationDate(
      nextLevel,
      baseDate,
      random,
      currentScheduled,
    );
    return Object.freeze({
      kind: "decay",
      fromLevel: level,
      fromLevelIndex: safeLevelIndex,
      toLevel: nextLevel,
      toLevelIndex: safeLevelIndex + 1,
      streak: streakCount,
      limit,
      date: formatBulletPropertyDate(roll.date),
      offset: roll.offset,
      reason: formatPriorityDecayScheduleReason({
        fromLevel: level,
        toLevel: nextLevel,
        rolledDays: roll.offset,
      }),
    });
  }

  if (recurring) {
    return Object.freeze({
      kind: "unavailable",
      level,
      levelIndex: safeLevelIndex,
      streak: streakCount,
      limit,
      date: "",
      offset: null,
      reason:
        "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
    });
  }
  return Object.freeze({
    kind: "cancel",
    level,
    levelIndex: safeLevelIndex,
    streak: streakCount,
    limit,
    date: "",
    offset: null,
    reason: formatPriorityDecayCancelReason({ level, streak: streakCount }),
  });
}

// Pure copy for the `scheduled` row's roll-preview line. All display strings
// come from here so the picker render and the tests share one source.
function buildPriorityRollPreviewModel(recommendation, baseDate) {
  if (!recommendation || typeof recommendation.kind !== "string") {
    return null;
  }
  const kind = recommendation.kind;
  const start =
    baseDate instanceof Date ? getLocalDateStart(baseDate) : getLocalDateStart(new Date());
  const formatDatedLine = (dateValue) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(
      normalizeBulletPropertyValue(dateValue),
    );
    if (!match) {
      return { dateText: "", weekday: "", relative: "", ariaDate: "" };
    }
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    const weekday = getBulletPropertyDateWeekday(date);
    const relative = formatRelativeDayOffset(getLocalDayOffset(start, date));
    return {
      dateText: `${normalizeBulletPropertyValue(dateValue)} · ${weekday} · ${relative}`,
      weekday,
      relative,
      ariaDate: `${weekday} ${normalizeBulletPropertyValue(dateValue)}, ${relative}`,
    };
  };

  if (kind === "roll") {
    const level = recommendation.level || {};
    const label = normalizeBulletPropertyValue(level.label);
    if (!label) {
      return null;
    }
    const dated = formatDatedLine(recommendation.date);
    const hasLimit = recommendation.limit !== null && recommendation.limit !== undefined;
    const step = recommendation.step;
    const meta =
      hasLimit && Number.isFinite(Number(step))
        ? `roll ${step}/${recommendation.limit}`
        : "";
    const metaTone =
      hasLimit &&
      Number.isFinite(Number(step)) &&
      Number(step) >= Number(recommendation.limit)
        ? "warn"
        : "info";
    return Object.freeze({
      kind: "roll",
      icon: "dices",
      tone: "accent",
      action: `${label} roll`,
      dateText: dated.dateText,
      dateValue: normalizeBulletPropertyValue(recommendation.date),
      meta,
      metaTone,
      footerLabel: `Roll ${label}`,
      ariaLabel:
        `Ctrl+Enter: ${label} roll to ${dated.ariaDate}` +
        (meta ? `, roll ${step} of ${recommendation.limit}` : ""),
    });
  }

  if (kind === "decay") {
    const fromLevel = recommendation.fromLevel || {};
    const toLevel = recommendation.toLevel || {};
    const fromLabel = normalizeBulletPropertyValue(fromLevel.label);
    const toLabel = normalizeBulletPropertyValue(toLevel.label);
    if (!fromLabel || !toLabel) {
      return null;
    }
    const dated = formatDatedLine(recommendation.date);
    return Object.freeze({
      kind: "decay",
      icon: "trending-down",
      tone: "warn",
      action: `${fromLabel} → ${toLabel}`,
      dateText: dated.dateText,
      dateValue: normalizeBulletPropertyValue(recommendation.date),
      meta: "decay",
      metaTone: "warn",
      footerLabel: `Decay to ${toLabel}`,
      ariaLabel: `Ctrl+Enter: ${fromLabel} → ${toLabel} decay to ${dated.ariaDate}`,
    });
  }

  if (kind === "cancel") {
    const level = recommendation.level || {};
    const label = normalizeBulletPropertyValue(level.label);
    if (!label) {
      return null;
    }
    return Object.freeze({
      kind: "cancel",
      icon: "ban",
      tone: "danger",
      action: "Cancel task",
      dateText: "",
      dateValue: "",
      meta: `decayed past ${label}`,
      metaTone: "warn",
      footerLabel: "Cancel task",
      ariaLabel: `Ctrl+Enter: Cancel task, decayed past ${label}${recommendation.streak > 0 ? ` after ${recommendation.streak} roll${recommendation.streak === 1 ? "" : "s"}` : ""}`,
    });
  }

  if (kind === "unavailable") {
    return Object.freeze({
      kind: "unavailable",
      icon: "circle-slash",
      tone: "muted",
      action: "Cannot cancel",
      dateText: "",
      dateValue: "",
      meta: "recurring · use Obsidian Tasks",
      metaTone: "muted",
      footerLabel: "",
      ariaLabel:
        "Ctrl+Enter unavailable: Cannot cancel a recurring task, use Obsidian Tasks",
    });
  }

  return null;
}

// Plan a recommendation for every counted target from its own line and Schedule
// Log. Each actionable target gets its own pre-rolled date, using the counted
// priority writer's one-roll-per-target approach (one `random` draw per dated
// target, in target order). Targets with no recommendation (closed, no priority,
// unconfigured value) are skipped and reported. Pure and CRLF-preserving.
function planPriorityRollRecommendationsForTargets(
  content,
  targets,
  property,
  options = {},
) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const list = Array.isArray(targets) ? targets : [];
  if (!property || property.values !== "priority") {
    return Object.freeze({
      valid: true,
      error: null,
      property: property || null,
      schedulesName: "",
      entries: Object.freeze([]),
      counts: Object.freeze({ roll: 0, decay: 0, cancel: 0, unavailable: 0 }),
      total: list.length,
      actionableCount: 0,
      skippedCount: list.length,
      dateStart: "",
      dateEnd: "",
      unavailableReason: null,
      hasRecommendation: false,
      allRollSameLevel: false,
      sharedLevelLabel: "",
    });
  }
  const schedulesName = normalizeBulletPropertyName(property.schedules);
  const baseDate =
    options.baseDate instanceof Date ? options.baseDate : new Date();
  const random =
    typeof options.random === "function" ? options.random : Math.random;
  const entries = [];
  let roll = 0;
  let decay = 0;
  let cancel = 0;
  let unavailable = 0;
  const dated = [];
  let unavailableReason = null;
  for (const target of list) {
    const lineIndex = target && target.line;
    const rawLine = String((target && target.rawLine) || "");
    const liveLine =
      Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length
        ? String(lines[lineIndex] || "")
        : undefined;
    if (liveLine !== rawLine) {
      entries.push(
        Object.freeze({
          line: lineIndex,
          rawLine,
          recommendation: null,
          skipped: "changed",
          currentValue: "",
        }),
      );
      continue;
    }
    const status = getObsidianTaskCheckboxStatus(rawLine);
    if (
      !isObsidianTaskLine(rawLine) ||
      !OPEN_OBSIDIAN_TASK_STATUSES.has(status)
    ) {
      entries.push(
        Object.freeze({
          line: lineIndex,
          rawLine,
          recommendation: null,
          skipped: "closed",
          currentValue: "",
        }),
      );
      continue;
    }
    const field = findBulletPropertyField(rawLine, property.name);
    const currentValue = normalizeBulletPropertyValue(
      field && field.value,
    );
    if (!currentValue) {
      entries.push(
        Object.freeze({
          line: lineIndex,
          rawLine,
          recommendation: null,
          skipped: "no-priority",
          currentValue: "",
        }),
      );
      continue;
    }
    const level =
      property.levelsByValue instanceof Map
        ? property.levelsByValue.get(currentValue)
        : (Array.isArray(property.levels) ? property.levels : []).find(
            (candidate) =>
              candidate && candidate.value === currentValue,
          );
    if (!level) {
      entries.push(
        Object.freeze({
          line: lineIndex,
          rawLine,
          recommendation: null,
          skipped: "unconfigured",
          currentValue,
        }),
      );
      continue;
    }
    let currentScheduled = "";
    try {
      const liveContext = getProjectNotePropertyContext(text, lineIndex);
      const scheduledTarget = resolveBulletPropertyTarget(
        schedulesName,
        liveContext,
      );
      if (scheduledTarget.kind === "project-frontmatter") {
        currentScheduled =
          liveContext.frontmatter && liveContext.frontmatter.scheduledDefined
            ? liveContext.frontmatter.scheduledValue
            : "";
      } else {
        const scheduledField = findBulletPropertyField(rawLine, schedulesName);
        currentScheduled = scheduledField ? scheduledField.value : "";
      }
    } catch (error) {
      currentScheduled = "";
    }
    const planned = planPriorityRollRecommendation({
      property,
      content: text,
      taskLine: lineIndex,
      currentScheduled,
      baseDate,
      random,
    });
    if (!planned) {
      entries.push(
        Object.freeze({
          line: lineIndex,
          rawLine,
          recommendation: null,
          skipped: "no-recommendation",
          currentValue,
        }),
      );
      continue;
    }
    const recommendation = Object.freeze({
      ...planned,
      priorityName: property.name,
      schedulesName,
      taskLine: lineIndex,
    });
    if (recommendation.kind === "roll") {
      roll += 1;
      dated.push(recommendation.date);
    } else if (recommendation.kind === "decay") {
      decay += 1;
      dated.push(recommendation.date);
    } else if (recommendation.kind === "cancel") {
      cancel += 1;
    } else if (recommendation.kind === "unavailable") {
      unavailable += 1;
      if (!unavailableReason) {
        unavailableReason = recommendation.reason;
      }
    }
    entries.push(
      Object.freeze({
        line: lineIndex,
        rawLine,
        recommendation,
        skipped: null,
        currentValue,
      }),
    );
  }
  const actionable = entries.filter(
    (entry) =>
      entry.recommendation &&
      (entry.recommendation.kind === "roll" ||
        entry.recommendation.kind === "decay" ||
        entry.recommendation.kind === "cancel"),
  );
  const sortedDates = dated
    .map((value) => normalizeBulletPropertyValue(value))
    .filter(Boolean)
    .sort();
  const dateStart = sortedDates.length > 0 ? sortedDates[0] : "";
  const dateEnd =
    sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
  const skippedCount = entries.filter((entry) => !entry.recommendation).length;
  const rollEntries = actionable.filter(
    (entry) => entry.recommendation.kind === "roll",
  );
  const rollLabels = Array.from(
    new Set(
      rollEntries.map((entry) =>
        normalizeBulletPropertyValue(
          entry.recommendation.level && entry.recommendation.level.label,
        ),
      ),
    ),
  );
  const allRollSameLevel =
    actionable.length > 0 &&
    rollEntries.length === actionable.length &&
    rollLabels.length === 1;
  return Object.freeze({
    valid: true,
    error: null,
    property,
    schedulesName,
    entries: Object.freeze(entries),
    counts: Object.freeze({ roll, decay, cancel, unavailable }),
    total: list.length,
    actionableCount: actionable.length,
    skippedCount,
    dateStart,
    dateEnd,
    unavailableReason,
    hasRecommendation: actionable.length > 0 && !unavailableReason,
    allRollSameLevel,
    sharedLevelLabel: allRollSameLevel ? rollLabels[0] : "",
  });
}

// Aggregate one roll recommendation per Task Link target across notes: each
// resolved target's recommendation is read from its own note's content via
// `groupLinkPickerTargetsByNote`, reusing
// `planPriorityRollRecommendationsForTargets` per note group. Pure. The
// returned summary mirrors that planner's shape (counts, dates, skips, the
// whole-batch unavailable reason) with flattened `entries` (each carrying its
// note `path`) plus per-note `groups` holding each group's own summary for the
// write path.
function planLinkRollBatchSummary(resolvedTargets, property, options = {}) {
  const empty = () =>
    Object.freeze({
      valid: true,
      error: null,
      property: property || null,
      schedulesName: "",
      entries: Object.freeze([]),
      counts: Object.freeze({ roll: 0, decay: 0, cancel: 0, unavailable: 0 }),
      total: 0,
      actionableCount: 0,
      skippedCount: 0,
      dateStart: "",
      dateEnd: "",
      unavailableReason: null,
      hasRecommendation: false,
      allRollSameLevel: false,
      sharedLevelLabel: "",
      groups: Object.freeze([]),
    });
  const groups = groupLinkPickerTargetsByNote(resolvedTargets);
  if (
    !property ||
    property.values !== "priority" ||
    groups.length === 0
  ) {
    return empty();
  }
  const perGroup = groups.map((group) => ({
    group,
    summary: planPriorityRollRecommendationsForTargets(
      group.content,
      group.session.targets,
      property,
      options,
    ),
  }));
  const entries = [];
  for (const { group, summary } of perGroup) {
    for (const entry of summary.entries) {
      entries.push(
        Object.freeze({ path: group.path, ...entry }),
      );
    }
  }
  const counts = { roll: 0, decay: 0, cancel: 0, unavailable: 0 };
  let actionableCount = 0;
  let skippedCount = 0;
  let unavailableReason = null;
  const dated = [];
  for (const { summary } of perGroup) {
    counts.roll += summary.counts.roll;
    counts.decay += summary.counts.decay;
    counts.cancel += summary.counts.cancel;
    counts.unavailable += summary.counts.unavailable;
    actionableCount += summary.actionableCount;
    skippedCount += summary.skippedCount;
    if (!unavailableReason && summary.unavailableReason) {
      unavailableReason = summary.unavailableReason;
    }
    for (const value of [summary.dateStart, summary.dateEnd]) {
      const date = normalizeBulletPropertyValue(value);
      if (date) {
        dated.push(date);
      }
    }
  }
  dated.sort();
  const rollLabels = Array.from(
    new Set(
      entries
        .filter(
          (entry) =>
            entry.recommendation && entry.recommendation.kind === "roll",
        )
        .map((entry) =>
          normalizeBulletPropertyValue(
            entry.recommendation.level &&
              entry.recommendation.level.label,
          ),
        ),
    ),
  );
  const rollCount = entries.filter(
    (entry) =>
      entry.recommendation && entry.recommendation.kind === "roll",
  ).length;
  const allRollSameLevel =
    actionableCount > 0 &&
    rollCount === actionableCount &&
    rollLabels.length === 1;
  return Object.freeze({
    valid: true,
    error: null,
    property,
    schedulesName: perGroup[0].summary.schedulesName,
    entries: Object.freeze(entries),
    counts: Object.freeze(counts),
    total: entries.length,
    actionableCount,
    skippedCount,
    dateStart: dated.length > 0 ? dated[0] : "",
    dateEnd: dated.length > 0 ? dated[dated.length - 1] : "",
    unavailableReason,
    hasRecommendation: actionableCount > 0 && !unavailableReason,
    allRollSameLevel,
    sharedLevelLabel: allRollSameLevel ? rollLabels[0] : "",
    groups: Object.freeze(
      perGroup.map(({ group, summary }) =>
        Object.freeze({ path: group.path, file: group.file, content: group.content, session: group.session, summary }),
      ),
    ),
  });
}

// The link-session preview: the single-task copy when the session holds
// exactly one target, otherwise the batch copy. Null when nothing is
// actionable and the batch is not unavailable.
function buildLinkRollPreviewModel(summary, baseDate) {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  if (summary.total === 1 && Array.isArray(summary.entries)) {
    const only = summary.entries[0];
    if (only && only.recommendation) {
      return buildPriorityRollPreviewModel(only.recommendation, baseDate);
    }
  }
  return buildBatchPriorityRollPreviewModel(summary);
}

// Render the counted batch copy: one line on the `scheduled` row, for example
// `4 tasks · 2 roll · 1 decay · 1 cancel · 2026-10-05 → 2026-12-19`, plus a
// muted `N skipped` suffix. Tone and icon follow the most severe kind present:
// cancel > decay > roll. The footer is `Roll N tasks` when every target is a
// roll, otherwise `Apply N recommendations`. An unavailable batch renders the
// muted `Cannot apply` line. Null when no target has a recommendation.
function buildBatchPriorityRollPreviewModel(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  const counts = summary.counts || {};
  const roll = Math.max(0, Math.floor(numericOrDefault(counts.roll, 0)));
  const decayCount = Math.max(0, Math.floor(numericOrDefault(counts.decay, 0)));
  const cancelCount = Math.max(0, Math.floor(numericOrDefault(counts.cancel, 0)));
  const actionable = Math.max(
    0,
    Math.floor(
      numericOrDefault(
        summary.actionableCount,
        roll + decayCount + cancelCount,
      ),
    ),
  );
  if (summary.unavailableReason) {
    return Object.freeze({
      kind: "unavailable",
      icon: "circle-slash",
      tone: "muted",
      action: "Cannot apply",
      dateText: "",
      dateValue: "",
      meta: "a recurring task would be cancelled",
      metaTone: "muted",
      footerLabel: "",
      ariaLabel:
        "Ctrl+Enter unavailable: Cannot apply, a recurring task would be cancelled",
      searchText: "roll cannot apply recurring",
    });
  }
  if (actionable <= 0) {
    return null;
  }
  const kind =
    cancelCount > 0 ? "cancel" : decayCount > 0 ? "decay" : "roll";
  const icon =
    kind === "cancel" ? "ban" : kind === "decay" ? "trending-down" : "dices";
  const tone =
    kind === "cancel" ? "danger" : kind === "decay" ? "warn" : "accent";
  const parts = [];
  if (roll > 0) {
    parts.push(`${roll} roll`);
  }
  if (decayCount > 0) {
    parts.push(`${decayCount} decay`);
  }
  if (cancelCount > 0) {
    parts.push(`${cancelCount} cancel`);
  }
  const action = `${actionable} ${actionable === 1 ? "task" : "tasks"}${
    parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
  }`;
  const dateStart = normalizeBulletPropertyValue(summary.dateStart);
  const dateEnd = normalizeBulletPropertyValue(summary.dateEnd);
  const dateText =
    dateStart && dateEnd
      ? dateStart === dateEnd
        ? dateStart
        : `${dateStart} → ${dateEnd}`
      : dateStart || dateEnd || "";
  const skipped = Math.max(
    0,
    Math.floor(numericOrDefault(summary.skippedCount, 0)),
  );
  const meta = skipped > 0 ? `${skipped} skipped` : "";
  const allRoll = roll === actionable && decayCount === 0 && cancelCount === 0;
  const footerLabel = allRoll
    ? `Roll ${actionable} ${actionable === 1 ? "task" : "tasks"}`
    : `Apply ${actionable} ${actionable === 1 ? "recommendation" : "recommendations"}`;
  return Object.freeze({
    kind,
    icon,
    tone,
    action,
    dateText,
    dateValue: dateText,
    meta,
    metaTone: "muted",
    footerLabel,
    ariaLabel:
      `Ctrl+Enter: ${action}` +
      (dateText ? `, ${dateText}` : "") +
      (meta ? `, ${meta}` : ""),
    searchText: `roll ${action} ${meta}`.trim(),
  });
}

// --- Approved-decay decision planner (bob-cli-3v.4) --------------------------
// Pure freshness decision planner adjacent to the priority recommendation
// helpers. Composes the existing priority roll/decay planner, the refresh
// presets, and the managed Schedule/Cancel Log insertion planners into one
// stable, previewed card model. The card itself (interaction, guarded commit,
// batch skip) landed in decision-card; this planner rolls every displayed date
// exactly once so approval can persist the preview without re-rolling.
//
// Inputs: exact target preimages (content/taskLine/rawLine), parsed keeps,
// effective interval days, normalized freshness decay policy, the validated
// priority property, the local base date, and injectable randomness.
// Output: a frozen card model with per-action plans and unavailable
// explanations. No writes, no timers, no DOM access.
//
// Reason grammar (pinned):
// - Schedule-changing decisions append ` · kept N×` after the existing
//   roll/decay head, so `classifyScheduleLogRollReason` keeps its meaning:
//   `🎲 P0 → P2 decay · in **17** (8–30) days · kept 3×` still classifies as
//   "decay", and `🎲 P2 roll · … · kept 3×` still classifies as "roll".
// - `🎲 less often · every A → B days · kept N×` and `🎲 reword · kept N×`
//   deliberately classify as "other" and reset the roll streak: they are
//   explicit human decisions, not roll events.
// - Drop writes `🍂 dropped after N keep(s)` to the Cancel Log and preserves
//   keeps history on the closed line.
function formatKeptCountTail(keeps) {
  const count = Number.isInteger(keeps) && keeps >= 0 ? keeps : 0;
  return ` · kept ${count}×`;
}

function formatFreshnessDecayReasonWithKeptTail(baseReason, keeps) {
  return `${normalizeBulletPropertyValue(baseReason)}${formatKeptCountTail(keeps)}`;
}

function formatFreshnessDecisionLessOftenReason(details = {}) {
  const before = Math.floor(numericOrDefault(details.beforeDays, NaN));
  const after = Math.floor(numericOrDefault(details.afterDays, NaN));
  const keeps = Number.isInteger(details.keeps) && details.keeps >= 0 ? details.keeps : 0;
  if (!Number.isInteger(before) || !Number.isInteger(after)) {
    return "";
  }
  return `${SCHEDULE_LOG_AUTO_REASON_EMOJI} less often${SCHEDULE_LOG_AUTO_REASON_SEPARATOR}every ${before} → ${after} days${formatKeptCountTail(keeps)}`;
}

function formatFreshnessDecisionRewordReason(details = {}) {
  const keeps = Number.isInteger(details.keeps) && details.keeps >= 0 ? details.keeps : 0;
  return `${SCHEDULE_LOG_AUTO_REASON_EMOJI} reword${SCHEDULE_LOG_AUTO_REASON_SEPARATOR}kept ${keeps}×`;
}

function formatFreshnessDecisionDropCancelReason(details = {}) {
  const keeps = Number.isInteger(details.keeps) && details.keeps >= 0 ? details.keeps : 0;
  const noun = keeps === 1 ? "keep" : "keeps";
  return `${PRIORITY_DECAY_CANCEL_EMOJI} dropped after ${keeps} ${noun}`;
}

function normalizeFreshnessDecayKeepsCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    return 0;
  }
  return Math.min(999, count);
}

// Resolve the `enter` label against the configured priority ladder. Returns
// the matching level or null when `enter` is absent. Unknown labels return
// `{ unknown: label }` so the caller can explain Not now's unavailability
// without inventing a fallback level.
function resolveFreshnessDecayEnterLevel(property, enterLabel) {
  const label = normalizeBulletPropertyValue(enterLabel);
  if (!label) {
    return null;
  }
  const levels = property && Array.isArray(property.levels) ? property.levels : [];
  const found = levels.find(
    (level) => level && normalizeBulletPropertyValue(level.label) === label,
  );
  if (found) {
    return found;
  }
  return { unknown: label };
}

// P0 entry: the first configured level in ladder order with
// `min_days > effective interval`. A valid fixed `enter` level overrides the
// scan. Returns `{ level }` or `{ unavailable, reason }`. Never shortens the
// lease, never picks the last level silently, never cancels.
function resolveFreshnessDecayP0EntryLevel(property, intervalDays, enterLabel) {
  const levels = property && Array.isArray(property.levels) ? property.levels : [];
  if (levels.length === 0) {
    return { unavailable: true, reason: "no configured priority levels" };
  }
  const enterResolved = resolveFreshnessDecayEnterLevel(property, enterLabel);
  if (enterResolved && enterResolved.unknown) {
    return {
      unavailable: true,
      reason: `unknown enter level "${enterResolved.unknown}"`,
    };
  }
  if (enterResolved) {
    return { level: enterResolved };
  }
  const interval = Math.floor(numericOrDefault(intervalDays, NaN));
  if (!Number.isInteger(interval)) {
    return { unavailable: true, reason: "unknown refresh interval" };
  }
  const entry = levels.find(
    (level) =>
      level &&
      Number.isInteger(level.minDays) &&
      Number.isInteger(level.maxDays) &&
      level.minDays <= level.maxDays &&
      level.minDays > interval,
  );
  if (!entry) {
    return {
      unavailable: true,
      reason: `no level stays out longer than every ${interval} days`,
    };
  }
  return { level: entry };
}

function isFutureDatedRollResult(rolled) {
  if (!rolled || !(rolled.date instanceof Date)) {
    return false;
  }
  if (!Number.isFinite(rolled.date.getTime())) {
    return false;
  }
  return Number.isInteger(rolled.offset) && rolled.offset >= 1;
}

// Less often: the next refresh preset strictly above the current interval.
// Below 90 the planner names the exact next preset day; at 90+ the existing
// custom refresh picker takes over (constrained to a longer value ≤ 365);
// at 365 there is nowhere longer to go.
