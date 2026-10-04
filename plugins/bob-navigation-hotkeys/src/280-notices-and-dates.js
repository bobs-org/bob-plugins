function buildPriorityNoticeModel(options = {}) {
  const property = options.property || {};
  const level = options.level || {};
  const scope = ["task", "counted", "project"].includes(options.scope)
    ? options.scope
    : "task";
  const propertyName = normalizeBulletPropertyName(property.name) || "priority";
  const scheduledName =
    normalizeBulletPropertyName(property.schedules) || "scheduled";
  const levelIndex = normalizePriorityLevelIndex(
    property,
    level,
    options.levelIndex,
  );
  const roll =
    options.roll && typeof options.roll === "object" ? options.roll : null;
  const rollKind =
    roll && typeof roll.kind === "string" ? roll.kind : "";
  const rollFromLevel = normalizeBulletPropertyValue(roll && roll.fromLevel);
  const pill =
    rollKind === "roll" && normalizeBulletPropertyValue(level.label)
      ? `${normalizeBulletPropertyValue(level.label)} roll`
      : rollKind === "decay" && rollFromLevel && normalizeBulletPropertyValue(level.label)
        ? `${rollFromLevel} → ${normalizeBulletPropertyValue(level.label)}`
        : normalizeBulletPropertyValue(level.label);
  const levelValue = normalizeBulletPropertyValue(level.value);
  const taskCount = Math.max(
    1,
    normalizePriorityNoticeCount(options.taskCount || 1),
  );
  const scheduleSummary = getPriorityNoticeScheduleSummary(
    options.scheduledValues || [],
    options.baseDate instanceof Date
      ? getLocalDateStart(options.baseDate)
      : getLocalDateStart(new Date()),
  );
  const outcomeTextParts = getPriorityNoticeOutcomeParts(
    options.outcome || {},
    scope,
  );
  const textHeader =
    rollKind === "roll"
      ? `${scheduledName} → ${pill}`
      : rollKind === "decay"
        ? `${propertyName} → ${normalizeBulletPropertyValue(level.label)} (${levelValue}) · decayed from ${rollFromLevel}`
        : scope === "counted"
          ? `${propertyName} → ${pill} (${levelValue}) on ${formatCountLabel(
              taskCount,
              "task",
            )}`
          : `${propertyName} → ${pill} (${levelValue})`;
  // Leading roll chips, before the existing outcome chips. With decay
  // disabled (no step/limit) there are no roll or next chips.
  const leadingChips = [];
  if (rollKind === "roll" && Number.isFinite(Number(roll.step)) && roll.limit !== null && roll.limit !== undefined) {
    leadingChips.push(
      Object.freeze({ text: `roll ${roll.step}/${roll.limit}`, tone: "info" }),
    );
  } else if (rollKind === "decay" && rollFromLevel) {
    leadingChips.push(
      Object.freeze({ text: `decayed from ${rollFromLevel}`, tone: "warn" }),
    );
  }
  if (
    (rollKind === "roll" || rollKind === "decay") &&
    roll &&
    typeof roll.next === "string"
  ) {
    if (roll.next === "decay" && normalizeBulletPropertyValue(roll.nextLabel)) {
      leadingChips.push(
        Object.freeze({
          text: `next ^↵ → ${normalizeBulletPropertyValue(roll.nextLabel)}`,
          tone: "warn",
        }),
      );
    } else if (roll.next === "cancel") {
      leadingChips.push(
        Object.freeze({ text: "next ^↵ cancels", tone: "warn" }),
      );
    }
  }
  const leadingTextParts = leadingChips.map((chip) => chip.text);
  const model = {
    iconName: getPriorityLevelIconName(levelIndex),
    levelIndex,
    pill,
    countPill: scope === "counted" ? formatCountLabel(taskCount, "task") : "",
    receipt: `[${propertyName}:: ${levelValue}]`,
    dateLabel: scope === "project" ? `${scheduledName} (project)` : scheduledName,
    textDateLabel: scheduledName,
    exactDateText: scheduleSummary.exactDateText,
    dateStartText: scheduleSummary.dateStartText,
    dateEndText: scheduleSummary.dateEndText,
    weekdayText: scheduleSummary.weekdayText,
    textDateText: scheduleSummary.textDateText,
    dateText: scheduleSummary.dateText,
    relativeText: scheduleSummary.relativeText,
    chips: Object.freeze([
      ...leadingChips,
      ...outcomeTextParts.map((part) =>
        Object.freeze({
          text: getPriorityNoticeChipText(part),
          tone: getPriorityNoticeChipTone(part),
        }),
      ),
    ]),
    outcomeTextParts,
    leadingTextParts: Object.freeze(leadingTextParts),
    textHeader,
  };
  model.text = formatPriorityNoticeText(model);
  return Object.freeze(model);
}

// One priority-style card for a counted recommended-roll batch: header icon
// `dices`, pill `Rolled N tasks`, leading `N rolled` / `N decayed` /
// `N cancelled` chips, the rolled date span, then the existing outcome chips
// (Blocked, removed Pomodoro links, skipped, prune-failed). Pure.
function buildBatchPriorityRollNoticeModel(batch, options = {}) {
  const counts = (batch && batch.counts) || {};
  const rolled = Math.max(0, Math.floor(numericOrDefault(counts.roll, 0)));
  const decayed = Math.max(0, Math.floor(numericOrDefault(counts.decay, 0)));
  const cancelled = Math.max(0, Math.floor(numericOrDefault(counts.cancel, 0)));
  const actionable = Math.max(
    0,
    Math.floor(
      numericOrDefault(
        batch && batch.actionableCount,
        rolled + decayed + cancelled,
      ),
    ),
  );
  const baseDate =
    options.baseDate instanceof Date
      ? getLocalDateStart(options.baseDate)
      : getLocalDateStart(new Date());
  const scheduledValues = Array.isArray(options.scheduledValues)
    ? options.scheduledValues
    : [];
  const scheduleSummary = getPriorityNoticeScheduleSummary(
    scheduledValues,
    baseDate,
  );
  const outcome = options.outcome || {};
  const outcomeTextParts = getPriorityNoticeOutcomeParts(outcome, "counted");
  const leadingChips = [];
  if (rolled > 0) {
    leadingChips.push(
      Object.freeze({
        text: `${rolled} rolled`,
        tone: "info",
      }),
    );
  }
  if (decayed > 0) {
    leadingChips.push(
      Object.freeze({ text: `${decayed} decayed`, tone: "warn" }),
    );
  }
  if (cancelled > 0) {
    leadingChips.push(
      Object.freeze({ text: `${cancelled} cancelled`, tone: "warn" }),
    );
  }
  const leadingTextParts = leadingChips.map((chip) => chip.text);
  const skipped = Math.max(
    0,
    Math.floor(
      numericOrDefault(
        outcome.skippedCount ?? (batch && batch.skippedCount),
        0,
      ),
    ),
  );
  const fullOutcomeParts = skipped > 0
    ? Object.freeze([
        ...outcomeTextParts,
        `${formatCountLabel(skipped, "task")} skipped`,
      ])
    : outcomeTextParts;
  const pill = `Rolled ${formatCountLabel(actionable, "task")}`;
  const model = {
    iconName: "dices",
    levelIndex: null,
    pill,
    countPill: "",
    receipt: "[priority]",
    dateLabel: "scheduled",
    textDateLabel: "scheduled",
    exactDateText: scheduleSummary.exactDateText,
    dateStartText: scheduleSummary.dateStartText,
    dateEndText: scheduleSummary.dateEndText,
    weekdayText: scheduleSummary.weekdayText,
    textDateText: scheduleSummary.textDateText,
    dateText: scheduleSummary.dateText,
    relativeText: scheduleSummary.relativeText,
    chips: Object.freeze([
      ...leadingChips,
      ...fullOutcomeParts.map((part) =>
        Object.freeze({
          text: getPriorityNoticeChipText(part),
          tone: getPriorityNoticeChipTone(part),
        }),
      ),
    ]),
    outcomeTextParts: fullOutcomeParts,
    leadingTextParts: Object.freeze(leadingTextParts),
    textHeader: pill,
  };
  model.text = formatPriorityNoticeText(model);
  return Object.freeze(model);
}

function renderPriorityNoticeFragment(model, root) {
  const levelClass =
    Number.isInteger(model.levelIndex) &&
    model.levelIndex >= 0 &&
    model.levelIndex <= 3
      ? ` is-level-${model.levelIndex}`
      : "";
  const card = root.createDiv({
    cls: `bob-nh-notice${levelClass}`,
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  applyIcon(iconEl, model.iconName);
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: model.pill });
  if (model.countPill) {
    headerEl.createSpan({ cls: "bob-nh-notice-count", text: model.countPill });
  }
  headerEl.createSpan({ cls: "bob-nh-notice-receipt", text: model.receipt });

  const dateEl = card.createDiv({ cls: "bob-nh-notice-date" });
  const dateHeadingEl = dateEl.createDiv({
    cls: "bob-nh-notice-date-heading",
  });
  const dateIconEl = dateHeadingEl.createSpan({ cls: "bob-nh-notice-date-icon" });
  applyIcon(dateIconEl, "dices");
  dateHeadingEl.createSpan({
    cls: "bob-nh-notice-date-label",
    text: model.dateLabel,
  });
  if (model.relativeText) {
    dateHeadingEl.createSpan({
      cls: "bob-nh-notice-relative",
      text: model.relativeText,
    });
  }
  const receiptEl = dateEl.createDiv({
    cls: "bob-nh-notice-date-receipt",
  });
  receiptEl.createSpan({
    cls: "bob-nh-notice-date-iso",
    text: model.dateStartText || model.exactDateText || "",
  });
  if (model.dateEndText) {
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-arrow",
      text: "→",
      attr: { "aria-hidden": "true" },
    });
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-iso",
      text: model.dateEndText,
    });
  } else if (model.weekdayText) {
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-separator",
      text: "·",
      attr: { "aria-hidden": "true" },
    });
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-weekday",
      text: model.weekdayText,
    });
  }

  if (model.chips.length > 0) {
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    model.chips.forEach((chip) => {
      chipsEl.createSpan({
        cls: `bob-nh-notice-chip is-${chip.tone}`,
        text: chip.text,
      });
    });
  }

  return card;
}

function showPriorityNotice(model, options = {}) {
  const fallbackText =
    model && typeof model.text === "string" ? model.text : String(model || "");
  try {
    if (typeof document === "undefined") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    renderPriorityNoticeFragment(model, fragment);
    showBulletPropertyNotice(fragment, options);
  } catch (error) {
    showBulletPropertyNotice(fallbackText, options);
  }
}

// Read the ledger-tools plan budget for a cancel notice chip, or "" when the
// API is missing or unusable. `dailyContent` is the post-prune daily note
// text, the same input block-id-prompt's unlink notices use.
function getCancelPlanBudgetChip(app, dailyContent) {
  if (typeof dailyContent !== "string") {
    return "";
  }
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api =
      plugins &&
      plugins["bob-ledger-tools"] &&
      plugins["bob-ledger-tools"].api;
    if (!api || typeof api.planBudget !== "function") {
      return "";
    }
    const budget = api.planBudget({ content: dailyContent });
    if (
      !budget ||
      typeof budget !== "object" ||
      typeof budget.then === "function"
    ) {
      return "";
    }
    const themes = budget.themes;
    const links = budget.links;
    if (
      !themes ||
      !links ||
      !Number.isInteger(themes.count) ||
      !Number.isInteger(themes.cap) ||
      !Number.isInteger(links.count) ||
      !Number.isInteger(links.cap)
    ) {
      return "";
    }
    const over =
      budget.status === "over" || themes.over === true || links.over === true;
    return `plan ${themes.count}/${themes.cap} · ${links.count}/${links.cap}${over ? " 🔴" : ""}`;
  } catch (error) {
    return "";
  }
}

// Pure model for the Cancelled notice card: header (ban icon, `Cancelled`
// level pill, count pill, `[cancelled:: date]` receipt), an italic
// `❌ <reason>` quote (or the muted no-reason/fallback text), and one chip
// per side effect. `model.text` is the aria-label and plain-text fallback.
function buildCancelNoticeModel(options = {}) {
  const count = Math.max(
    1,
    Math.floor(numericOrDefault(options.count, 1)),
  );
  const viaLinks = Boolean(options.viaLinks);
  const dateText = normalizeBulletPropertyValue(options.date);
  const reason = String(options.reason || "");
  const fallbackUsed = Boolean(options.fallbackUsed);
  const scopeText =
    viaLinks && count === 1
      ? "task via Task Link"
      : viaLinks
        ? `${formatCountLabel(count, "task")} via Task Links`
        : count === 1
          ? "task"
          : formatCountLabel(count, "task");
  const countPill =
    viaLinks && count === 1
      ? "via Task Link"
      : !viaLinks && count === 1
        ? ""
        : viaLinks
          ? `${formatCountLabel(count, "task")} via Task Links`
          : formatCountLabel(count, "task");
  const chips = [];
  const removedPomodoroLinkCount = Math.max(
    0,
    Math.floor(numericOrDefault(options.removedPomodoroLinkCount, 0)),
  );
  if (removedPomodoroLinkCount > 0) {
    chips.push(
      Object.freeze({
        text: `removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`,
        tone: "info",
      }),
    );
  }
  const reopened = Math.max(
    0,
    Math.floor(numericOrDefault(options.reopenedDependents, 0)),
  );
  if (options.recoveryRan === true && reopened > 0) {
    chips.push(
      Object.freeze({
        text: `unblocked ${formatCountLabel(reopened, "dependent")}`,
        tone: "ok",
      }),
    );
  }
  const planChip = String(options.planChip || "");
  if (planChip) {
    chips.push(Object.freeze({ text: planChip, tone: "info" }));
  }
  const skippedClosedCount = Math.max(
    0,
    Math.floor(numericOrDefault(options.skippedClosedCount, 0)),
  );
  if (skippedClosedCount > 0) {
    chips.push(
      Object.freeze({
        text: `skipped ${formatCountLabel(skippedClosedCount, "closed")}`,
        tone: "muted",
      }),
    );
  }
  if (options.pomodoroPruneFailed === true) {
    chips.push(
      Object.freeze({ text: "Pomodoro links not removed", tone: "warn" }),
    );
  }
  const parts = [`Cancelled ${scopeText}`];
  if (reason) {
    parts.push(`\u201c${reason}\u201d`);
  } else if (fallbackUsed) {
    parts.push(`\u201c${SCHEDULE_LOG_SKIPPED_REASON_TEXT} · logged\u201d`);
  }
  for (const chip of chips) {
    parts.push(chip.text);
  }
  const reasonBody = reason
    ? `${CANCEL_LOG_EMOJI} ${reason}`
    : fallbackUsed
      ? `${SCHEDULE_LOG_SKIPPED_REASON_TEXT} · logged`
      : "No reason recorded";
  return Object.freeze({
    iconName: "ban",
    level: "Cancelled",
    countPill,
    receipt: `[cancelled:: ${dateText}]`,
    reasonBody,
    reasonMuted: !reason,
    chips: Object.freeze(chips),
    text: parts.join(" · "),
  });
}

function renderCancelNoticeFragment(model, root) {
  const card = root.createDiv({
    cls: "bob-nh-notice is-cancel",
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  applyIcon(iconEl, model.iconName || "ban");
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: model.level });
  if (model.countPill) {
    headerEl.createSpan({ cls: "bob-nh-notice-count", text: model.countPill });
  }
  headerEl.createSpan({ cls: "bob-nh-notice-receipt", text: model.receipt });

  const reasonEl = card.createDiv({
    cls: `bob-nh-notice-reason${model.reasonMuted ? " is-muted" : ""}`,
  });
  reasonEl.createSpan({ cls: "bob-nh-notice-reason-text", text: model.reasonBody });

  if (model.chips.length > 0) {
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    model.chips.forEach((chip) => {
      chipsEl.createSpan({
        cls: `bob-nh-notice-chip is-${chip.tone}`,
        text: chip.text,
      });
    });
  }

  return card;
}

function showCancelNotice(model, options = {}) {
  const fallbackText =
    model && typeof model.text === "string" ? model.text : String(model || "");
  try {
    if (typeof document === "undefined") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    renderCancelNoticeFragment(model, fragment);
    showBulletPropertyNotice(fragment, options);
  } catch (error) {
    showBulletPropertyNotice(fallbackText, options);
  }
}

function parseBulletPropertyTypedDate(query, baseDate) {
  const text = String(query || "").trim();
  if (!text) {
    return null;
  }

  const ymdMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (
    ymdMatch &&
    isValidDateParts(ymdMatch[1], ymdMatch[2], ymdMatch[3])
  ) {
    return new Date(
      parseIntegerText(ymdMatch[1]),
      parseIntegerText(ymdMatch[2]) - 1,
      parseIntegerText(ymdMatch[3]),
    );
  }

  const monthDayMatch = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (monthDayMatch) {
    const monthText = monthDayMatch[1];
    const dayText = monthDayMatch[2];
    let year = baseDate.getFullYear();
    if (!isValidDateParts(String(year), monthText, dayText)) {
      return null;
    }

    let date = new Date(
      year,
      parseIntegerText(monthText) - 1,
      parseIntegerText(dayText),
    );
    if (compareLocalDates(date, baseDate) <= 0) {
      year += 1;
      if (!isValidDateParts(String(year), monthText, dayText)) {
        return null;
      }
      date = new Date(
        year,
        parseIntegerText(monthText) - 1,
        parseIntegerText(dayText),
      );
    }
    return date;
  }

  const offsetMatch = text.match(/^\+(\d+)([dwm])$/i);
  if (offsetMatch) {
    const count = parseIntegerText(offsetMatch[1]);
    const unit = offsetMatch[2].toLowerCase();
    if (!Number.isInteger(count) || count < 0) {
      return null;
    }

    if (unit === "d") {
      return addLocalDateDays(baseDate, count);
    }
    if (unit === "w") {
      return addLocalDateDays(baseDate, count * 7);
    }
    return addLocalDateMonths(baseDate, count);
  }

  return null;
}

function createBulletPropertyTypedDateItem(query, baseDate, currentValue) {
  const date = parseBulletPropertyTypedDate(query, baseDate);
  if (!date) {
    return null;
  }

  const value = formatBulletPropertyDate(date);
  return createBulletPropertyDateValueItem(`Use ${value}`, date, currentValue, {
    dynamic: true,
  });
}

const TYPED_SCHEDULE_ERROR_INVALID = "invalid date";
const TYPED_SCHEDULE_ERROR_NEGATIVE = "negative offset";
const TYPED_SCHEDULE_ERROR_OVERFLOW = "overflow offset";
const TYPED_SCHEDULE_ERROR_AMBIGUOUS = "ambiguous input";
const TYPED_SCHEDULE_MAX_COUNT_DIGITS = 5;
const TYPED_SCHEDULE_WEEKDAY_INDEX = Object.freeze({
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
});

function freezeTypedScheduleResult(date, reason, valid, error) {
  return Object.freeze({
    date: valid && date instanceof Date ? getLocalDateStart(date) : null,
    reason: String(reason || ""),
    valid: valid === true,
    error: valid ? null : error || null,
  });
}

function parseTypedScheduleCount(text) {
  const digits = String(text || "");
  if (!/^\d+$/.test(digits)) {
    return { error: TYPED_SCHEDULE_ERROR_INVALID };
  }
  if (digits.length > TYPED_SCHEDULE_MAX_COUNT_DIGITS) {
    return { error: TYPED_SCHEDULE_ERROR_OVERFLOW };
  }
  const count = Number.parseInt(digits, 10);
  if (!Number.isInteger(count) || count < 0) {
    return { error: TYPED_SCHEDULE_ERROR_OVERFLOW };
  }
  return { count };
}

function typedScheduleDateOrError(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return { error: TYPED_SCHEDULE_ERROR_OVERFLOW };
  }
  const year = date.getFullYear();
  if (year < 1 || year > 9999) {
    return { error: TYPED_SCHEDULE_ERROR_OVERFLOW };
  }
  return { date: getLocalDateStart(date) };
}

function parseTypedScheduleMonthDay(monthText, dayText, baseDate) {
  let year = baseDate.getFullYear();
  if (!isValidDateParts(String(year), monthText, dayText)) {
    return { error: TYPED_SCHEDULE_ERROR_INVALID };
  }
  let date = new Date(
    year,
    parseIntegerText(monthText) - 1,
    parseIntegerText(dayText),
  );
  if (compareLocalDates(date, baseDate) <= 0) {
    year += 1;
    if (!isValidDateParts(String(year), monthText, dayText)) {
      return { error: TYPED_SCHEDULE_ERROR_INVALID };
    }
    date = new Date(
      year,
      parseIntegerText(monthText) - 1,
      parseIntegerText(dayText),
    );
  }
  return typedScheduleDateOrError(date);
}

function applyTypedScheduleUnit(baseDate, count, unit) {
  if (unit === "d") {
    return typedScheduleDateOrError(addLocalDateDays(baseDate, count));
  }
  if (unit === "w") {
    return typedScheduleDateOrError(addLocalDateDays(baseDate, count * 7));
  }
  return typedScheduleDateOrError(addLocalDateMonths(baseDate, count));
}

function matchTypedSchedulePrefix(text) {
  const patterns = [
    { kind: "iso", re: /^(\d{4})-(\d{2})-(\d{2})/ },
    { kind: "month-day", re: /^(\d{1,2})[/-](\d{1,2})/ },
    { kind: "unit", re: /^([+-]?)(\d+)([dwm])/i },
    { kind: "days", re: /^([+-]?)(\d+)/ },
    {
      kind: "weekday",
      re: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)/i,
    },
  ];
  for (const pattern of patterns) {
    const match = pattern.re.exec(text);
    if (!match) {
      continue;
    }
    const token = match[0];
    const restRaw = text.slice(token.length);
    if (restRaw !== "" && !/^\s/.test(restRaw)) {
      return Object.freeze({ kind: "attached", token, rest: restRaw });
    }
    return Object.freeze({
      kind: pattern.kind,
      token,
      rest: restRaw.trim(),
      match,
    });
  }
  return null;
}

// Conservative Task Card date grammar. An inline reason is the remainder
// after a complete recognized date token and whitespace; it is never parsed
// as further commands. Unrecognized input returns valid=false with no error
// so ordinary preset filtering can keep the query.
function resolveTypedSchedule(query, baseDate) {
  const text = String(query || "").trim();
  const start = getLocalDateStart(
    baseDate instanceof Date ? baseDate : new Date(),
  );
  if (!text) {
    return freezeTypedScheduleResult(null, "", false, null);
  }

  const prefix = matchTypedSchedulePrefix(text);
  if (!prefix) {
    return freezeTypedScheduleResult(null, "", false, null);
  }
  if (prefix.kind === "attached") {
    return freezeTypedScheduleResult(
      null,
      "",
      false,
      TYPED_SCHEDULE_ERROR_AMBIGUOUS,
    );
  }

  const reason = prefix.rest;
  if (prefix.kind === "iso") {
    const yearText = prefix.match[1];
    const monthText = prefix.match[2];
    const dayText = prefix.match[3];
    if (!isValidDateParts(yearText, monthText, dayText)) {
      return freezeTypedScheduleResult(
        null,
        reason,
        false,
        TYPED_SCHEDULE_ERROR_INVALID,
      );
    }
    const resolved = typedScheduleDateOrError(
      new Date(
        parseIntegerText(yearText),
        parseIntegerText(monthText) - 1,
        parseIntegerText(dayText),
      ),
    );
    if (resolved.error) {
      return freezeTypedScheduleResult(null, reason, false, resolved.error);
    }
    return freezeTypedScheduleResult(resolved.date, reason, true, null);
  }

  if (prefix.kind === "month-day") {
    const resolved = parseTypedScheduleMonthDay(
      prefix.match[1],
      prefix.match[2],
      start,
    );
    if (resolved.error) {
      return freezeTypedScheduleResult(null, reason, false, resolved.error);
    }
    return freezeTypedScheduleResult(resolved.date, reason, true, null);
  }

  if (prefix.kind === "unit" || prefix.kind === "days") {
    const sign = prefix.match[1] || "";
    const countText = prefix.match[2];
    const unit = prefix.kind === "unit" ? prefix.match[3].toLowerCase() : "d";
    if (sign === "-") {
      return freezeTypedScheduleResult(
        null,
        reason,
        false,
        TYPED_SCHEDULE_ERROR_NEGATIVE,
      );
    }
    if (prefix.kind === "days" && sign === "+") {
      return freezeTypedScheduleResult(
        null,
        reason,
        false,
        TYPED_SCHEDULE_ERROR_AMBIGUOUS,
      );
    }
    const parsedCount = parseTypedScheduleCount(countText);
    if (parsedCount.error) {
      return freezeTypedScheduleResult(null, reason, false, parsedCount.error);
    }
    const resolved = applyTypedScheduleUnit(start, parsedCount.count, unit);
    if (resolved.error) {
      return freezeTypedScheduleResult(null, reason, false, resolved.error);
    }
    return freezeTypedScheduleResult(resolved.date, reason, true, null);
  }

  const weekday =
    TYPED_SCHEDULE_WEEKDAY_INDEX[String(prefix.token || "").toLowerCase()];
  if (!Number.isInteger(weekday)) {
    return freezeTypedScheduleResult(
      null,
      reason,
      false,
      TYPED_SCHEDULE_ERROR_INVALID,
    );
  }
  const resolved = typedScheduleDateOrError(
    addLocalDateDays(start, getDaysUntilWeekday(start, weekday, false)),
  );
  if (resolved.error) {
    return freezeTypedScheduleResult(null, reason, false, resolved.error);
  }
  return freezeTypedScheduleResult(resolved.date, reason, true, null);
}

function createTypedScheduleValueItem(resolved, baseDate, currentValue) {
  if (!resolved) {
    return null;
  }
  const reason = String(resolved.reason || "");
  if (resolved.valid === true && resolved.date instanceof Date) {
    const date = getLocalDateStart(resolved.date);
    const value = formatBulletPropertyDate(date);
    const weekday = getBulletPropertyDateWeekday(date);
    const relative = formatRelativeDayOffset(
      getLocalDayOffset(baseDate, date),
    );
    const yearRollover =
      date.getFullYear() !== getLocalDateStart(baseDate).getFullYear();
    const label = `Use ${weekday} ${value}`;
    const detailParts = [relative];
    if (yearRollover) {
      detailParts.push(String(date.getFullYear()));
    }
    if (reason) {
      detailParts.push(reason);
    }
    return {
      kind: "value",
      value,
      label,
      detail: detailParts.join(" · "),
      current: value === currentValue,
      dynamic: true,
      typedSchedule: true,
      valid: true,
      inlineReason: reason,
      yearRollover,
      weekday,
      relative,
      searchText: `${label} ${detailParts.join(" ")}`,
    };
  }
  if (resolved.error) {
    return {
      kind: "value",
      value: "",
      label: "Invalid date",
      detail: resolved.error,
      current: false,
      dynamic: true,
      typedSchedule: true,
      valid: false,
      error: resolved.error,
      inlineReason: reason,
      searchText: `invalid date ${resolved.error}`,
    };
  }
  return null;
}

function getLocalTaskDependencyIdentifier(task, filePath = "") {
  if (!task) {
    return "";
  }
  if (task.existingBlockId && filePath) {
    return tryDependencyId(filePath, task.existingBlockId) || "";
  }
  return task.existingIdField || task.existingBlockId || "";
}

