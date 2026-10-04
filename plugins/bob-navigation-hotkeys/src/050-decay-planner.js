function planFreshnessDecayLessOften(intervalDays) {
  const current = Number(intervalDays);
  if (!Number.isInteger(current) || current < 1 || current > 365) {
    return Object.freeze({
      available: false,
      mode: "unavailable",
      unavailableReason: "unknown refresh interval",
      beforeDays: null,
      afterDays: null,
    });
  }
  if (current >= 365) {
    return Object.freeze({
      available: false,
      mode: "unavailable",
      unavailableReason: "already reviewing every 365 days",
      beforeDays: current,
      afterDays: null,
    });
  }
  if (current >= 90) {
    return Object.freeze({
      available: true,
      mode: "picker",
      beforeDays: current,
      afterDays: null,
      minDays: current + 1,
      maxDays: 365,
    });
  }
  const presets = Array.isArray(REFRESH_ROW_PRESET_DAYS)
    ? REFRESH_ROW_PRESET_DAYS
    : [];
  const next = presets.find(
    (days) => Number.isInteger(days) && days > current,
  );
  if (!Number.isInteger(next)) {
    return Object.freeze({
      available: true,
      mode: "picker",
      beforeDays: current,
      afterDays: null,
      minDays: current + 1,
      maxDays: 365,
    });
  }
  return Object.freeze({
    available: true,
    mode: "refresh",
    beforeDays: current,
    afterDays: next,
  });
}

// Explicit 1–4 level picks in ladder order: one previewed roll per configured
// level, each with reset. No absent levels are invented; invalid windows and
// non-future dates are unavailable per level rather than failing the card.
function planFreshnessDecayExplicitLevelPicks(options = {}) {
  const property = options.property || null;
  const levels = property && Array.isArray(property.levels) ? property.levels : [];
  const baseDate = options.baseDate instanceof Date ? options.baseDate : new Date();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const currentScheduled = normalizeBulletPropertyValue(options.currentScheduled);
  const fromLabel = normalizeBulletPropertyValue(options.fromLabel) || IMPLICIT_PRIORITY_LEVEL_LABEL;
  const keeps = normalizeFreshnessDecayKeepsCount(options.keeps);
  const picks = levels.map((level, index) => {
    if (!level || !level.label) {
      return Object.freeze({
        index,
        label: "",
        available: false,
        unavailableReason: "unconfigured level",
        date: "",
        offset: null,
        reason: "",
      });
    }
    const rolled = rollPriorityRecommendationDate(level, baseDate, random, currentScheduled);
    if (!isFutureDatedRollResult(rolled)) {
      return Object.freeze({
        index,
        label: normalizeBulletPropertyValue(level.label),
        available: false,
        unavailableReason: "no future date in this level's window",
        date: "",
        offset: null,
        reason: "",
      });
    }
    const windowText = formatPriorityRollChosenWindowText(level, rolled.offset);
    if (!windowText) {
      return Object.freeze({
        index,
        label: normalizeBulletPropertyValue(level.label),
        available: false,
        unavailableReason: "invalid level window",
        date: "",
        offset: null,
        reason: "",
      });
    }
    const baseReason = formatPriorityRollScheduleReason({
      source: "priority",
      fromLevelLabel: fromLabel,
      level,
      rolledDays: rolled.offset,
    });
    if (!baseReason) {
      return Object.freeze({
        index,
        label: normalizeBulletPropertyValue(level.label),
        available: false,
        unavailableReason: "cannot describe this level pick",
        date: "",
        offset: null,
        reason: "",
      });
    }
    return Object.freeze({
      index,
      label: normalizeBulletPropertyValue(level.label),
      available: true,
      unavailableReason: null,
      date: formatBulletPropertyDate(rolled.date),
      offset: rolled.offset,
      windowText,
      reason: formatFreshnessDecayReasonWithKeptTail(baseReason, keeps),
    });
  });
  return Object.freeze(picks);
}

// The shared approved-decay action planner. Pure: rolls each displayed date
// exactly once with the injected `random` and freezes the model so approval
// can persist the preview without re-rolling.
function planFreshnessDecayCard(options = {}) {
  const keeps = normalizeFreshnessDecayKeepsCount(options.keeps);
  const limitRaw = options.limit;
  const decay = options.freshnessDecay && typeof options.freshnessDecay === "object"
    ? options.freshnessDecay
    : {};
  const limit = Number.isInteger(decay.keeps) && decay.keeps >= 0
    ? decay.keeps
    : Number.isInteger(limitRaw) && limitRaw >= 0
      ? limitRaw
      : 3;
  const enterLabel = decay.enter !== undefined && decay.enter !== null
    ? normalizeBulletPropertyValue(decay.enter)
    : "";
  const decayInvalid = decay.invalid === true;
  const decayEnabled = decay.enabled !== false;
  const property = options.property || null;
  const hasPriorityLadder = Boolean(property && property.values === "priority");
  const baseDate = options.baseDate instanceof Date ? options.baseDate : new Date();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const todayText = formatBulletPropertyDate(getLocalDateStart(baseDate));
  const intervalDays = Number(options.intervalDays);
  const intervalValid = Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 365;
  const content = typeof options.content === "string" ? options.content : null;
  const taskLine = Number.isInteger(options.taskLine) ? options.taskLine : null;
  const rawLine = typeof options.rawLine === "string"
    ? options.rawLine
    : content !== null && taskLine !== null
      ? String(String(content).split(/\r?\n/)[taskLine] || "")
      : "";
  let currentValue = options.currentValue !== undefined
    ? normalizeBulletPropertyValue(options.currentValue)
    : "";
  if (options.currentValue === undefined && rawLine && hasPriorityLadder) {
    try {
      const field = findBulletPropertyField(rawLine, property.name);
      currentValue = normalizeBulletPropertyValue(field && field.value);
    } catch (error) {
      currentValue = "";
    }
  }
  const currentScheduled = normalizeBulletPropertyValue(options.currentScheduled);
  const fromLabel = currentValue
    ? getPriorityRollFromLevelLabel(property, currentValue)
    : IMPLICIT_PRIORITY_LEVEL_LABEL;
  const reviewNoun = keeps === 1 ? "review" : "reviews";
  const title = `Kept ${keeps} ${reviewNoun} in a row`;

  const unavailable = (reason) =>
    Object.freeze({
      available: false,
      unavailableReason: reason,
      date: "",
      offset: null,
      reason: "",
    });

  let notNow = unavailable("Not now is unavailable");
  if (decayInvalid) {
    notNow = unavailable("priority config is invalid");
  } else if (!decayEnabled) {
    notNow = unavailable("decay is off");
  } else if (!hasPriorityLadder) {
    notNow = unavailable("no priority ladder is configured");
  } else if (!currentValue) {
    const entry = resolveFreshnessDecayP0EntryLevel(property, intervalDays, enterLabel);
    if (entry.unavailable) {
      notNow = unavailable(entry.reason);
    } else {
      const rolled = rollPriorityRecommendationDate(entry.level, baseDate, random, currentScheduled);
      const windowText = formatPriorityRollChosenWindowText(entry.level, rolled && rolled.offset);
      if (!isFutureDatedRollResult(rolled) || !windowText) {
        notNow = unavailable("no future date in this level's window");
      } else {
        const baseReason = formatPriorityDecayScheduleReason({
          fromLevel: { label: IMPLICIT_PRIORITY_LEVEL_LABEL },
          toLevel: entry.level,
          rolledDays: rolled.offset,
        });
        if (!baseReason) {
          notNow = unavailable("cannot describe the P0 entry");
        } else {
          const reason = formatFreshnessDecayReasonWithKeptTail(baseReason, keeps);
          notNow = Object.freeze({
            available: true,
            unavailableReason: null,
            kind: "entry",
            fromLabel: IMPLICIT_PRIORITY_LEVEL_LABEL,
            levelLabel: normalizeBulletPropertyValue(entry.level.label),
            date: formatBulletPropertyDate(rolled.date),
            offset: rolled.offset,
            windowText,
            from: currentScheduled,
            to: formatBulletPropertyDate(rolled.date),
            reason,
            substitutedFor: null,
            scheduleLog: buildPriorityDecayScheduleLogPayload(
              currentScheduled,
              formatBulletPropertyDate(rolled.date),
              reason,
            ),
          });
        }
      }
    }
  } else {
    const levels = Array.isArray(property.levels) ? property.levels : [];
    const level = property.levelsByValue instanceof Map
      ? property.levelsByValue.get(currentValue)
      : levels.find((candidate) => candidate && candidate.value === currentValue);
    if (!level) {
      notNow = unavailable(`unknown priority "${currentValue}"`);
    } else {
      const planned = planPriorityRollRecommendation({
        property,
        currentValue,
        content: content !== null ? content : undefined,
        taskLine: taskLine !== null ? taskLine : undefined,
        streak: options.streak,
        currentScheduled,
        baseDate,
        random,
      });
      if (!planned || planned.kind === "unavailable" || !planned.kind) {
        notNow = unavailable(
          planned && planned.reason
            ? planned.reason
            : "no priority recommendation is available",
        );
      } else if (planned.kind === "roll" || planned.kind === "decay") {
        if (!Number.isInteger(planned.offset) || planned.offset < 1 || !planned.date) {
          notNow = unavailable("no future date in this level's window");
        } else {
          const reason = formatFreshnessDecayReasonWithKeptTail(planned.reason, keeps);
          const payload = planned.kind === "decay"
            ? buildPriorityDecayScheduleLogPayload(currentScheduled, planned.date, reason)
            : shouldWriteAutomaticScheduleLog(currentScheduled, planned.date)
              ? Object.freeze({
                from: currentScheduled,
                to: planned.date,
                reason,
                automatic: true,
              })
              : null;
          notNow = Object.freeze({
            available: true,
            unavailableReason: null,
            kind: planned.kind,
            fromLabel: getPriorityRollFromLevelLabel(property, currentValue),
            levelLabel: normalizeBulletPropertyValue(
              (planned.level || planned.toLevel || {}).label,
            ),
            date: normalizeBulletPropertyValue(planned.date),
            offset: planned.offset,
            windowText: formatPriorityRollChosenWindowText(
              planned.level || planned.toLevel,
              planned.offset,
            ),
            from: currentScheduled,
            to: normalizeBulletPropertyValue(planned.date),
            reason,
            substitutedFor: null,
            scheduleLog: payload || null,
          });
        }
      } else if (planned.kind === "cancel") {
        const rolled = rollPriorityRecommendationDate(level, baseDate, random, currentScheduled);
        const windowText = formatPriorityRollChosenWindowText(level, rolled && rolled.offset);
        if (!isFutureDatedRollResult(rolled) || !windowText) {
          notNow = unavailable("no future date in this level's window");
        } else {
          const baseReason = formatPriorityRollScheduleReason({
            source: "scheduled",
            level,
            rolledDays: rolled.offset,
          });
          const reason = formatFreshnessDecayReasonWithKeptTail(baseReason, keeps);
          notNow = Object.freeze({
            available: true,
            unavailableReason: null,
            kind: "card-roll",
            fromLabel: getPriorityRollFromLevelLabel(property, currentValue),
            levelLabel: normalizeBulletPropertyValue(level.label),
            date: formatBulletPropertyDate(rolled.date),
            offset: rolled.offset,
            windowText,
            from: currentScheduled,
            to: formatBulletPropertyDate(rolled.date),
            reason,
            substitutedFor: "cancel",
            terminalWouldCancel: true,
            scheduleLog: Object.freeze({
              from: currentScheduled,
              to: formatBulletPropertyDate(rolled.date),
              reason,
              automatic: true,
            }),
          });
        }
      } else {
        notNow = unavailable("no priority recommendation is available");
      }
    }
  }

  let lessOften = planFreshnessDecayLessOften(intervalDays);
  if (lessOften.available && lessOften.mode === "refresh") {
    const reason = formatFreshnessDecisionLessOftenReason({
      beforeDays: lessOften.beforeDays,
      afterDays: lessOften.afterDays,
      keeps,
    });
    let scheduleLogPlan = null;
    if (content !== null && taskLine !== null) {
      try {
        scheduleLogPlan = planScheduleLogEntry(content, taskLine, {
          from: currentScheduled,
          to: currentScheduled,
          reason,
        });
      } catch (error) {
        scheduleLogPlan = null;
      }
    }
    lessOften = Object.freeze({
      ...lessOften,
      reason,
      scheduleLogPlan,
    });
  } else if (lessOften.available && lessOften.mode === "picker") {
    lessOften = Object.freeze({
      ...lessOften,
      reason: "",
      scheduleLogPlan: null,
    });
  }

  const rewordReason = formatFreshnessDecisionRewordReason({ keeps });
  let rewordScheduleLogPlan = null;
  if (content !== null && taskLine !== null) {
    try {
      rewordScheduleLogPlan = planScheduleLogEntry(content, taskLine, {
        from: currentScheduled,
        to: currentScheduled,
        reason: rewordReason,
      });
    } catch (error) {
      rewordScheduleLogPlan = null;
    }
  }
  const reword = Object.freeze({
    available: true,
    reason: rewordReason,
    scheduleLogPlan: rewordScheduleLogPlan,
  });

  const dropReason = formatFreshnessDecisionDropCancelReason({ keeps });
  let dropCancelLogPlan = null;
  if (content !== null && taskLine !== null) {
    try {
      dropCancelLogPlan = planCancelLogEntry(content, taskLine, {
        date: todayText,
        reason: dropReason,
      });
    } catch (error) {
      dropCancelLogPlan = null;
    }
  }
  const drop = Object.freeze({
    available: true,
    reason: dropReason,
    date: todayText,
    cancelLogPlan: dropCancelLogPlan,
  });

  const keep = Object.freeze({
    available: true,
    nextKeeps: Math.min(999, keeps + 1),
  });

  const levels = decayInvalid || !hasPriorityLadder
    ? Object.freeze(
      (property && Array.isArray(property.levels) ? property.levels : []).map((level, index) =>
        Object.freeze({
          index,
          label: normalizeBulletPropertyValue(level && level.label),
          available: false,
          unavailableReason: decayInvalid
            ? "priority config is invalid"
            : "no priority ladder is configured",
          date: "",
          offset: null,
          reason: "",
        }),
      ),
    )
    : planFreshnessDecayExplicitLevelPicks({
      property,
      fromLabel,
      keeps,
      currentScheduled,
      baseDate,
      random,
    });

  return Object.freeze({
    valid: true,
    error: null,
    keeps,
    limit,
    enterLabel,
    fromLabel,
    title,
    todayText,
    intervalDays: intervalValid ? intervalDays : null,
    notNow,
    lessOften,
    reword,
    drop,
    keep,
    levels,
  });
}

// Decision card and review-walk integration (`docs/freshness.md` §2a,
// decision-card phase). The trigger is a single source-task
// Alt+F/Alt+Shift+F with exact eligibility and a pre-write `decide`
// row; the press opens the card and writes nothing. Counted source
// sessions and all Task Link sessions never open cards: exact
// at-limit targets skip without changing fresh/count. Pure unless
// noted; never throws.

// The review-walk decision-card capability ledger-tools feature-detects
// (`api.freshnessDecayCard.version >= 2`). Exposed on the plugin api at
// load; removed again on unload so marks cannot promise an absent card.
// Version 2 is the ungated handler contract: cards are available as
// soon as decay is enabled. Bumped only for a breaking card-contract
// change.
const FRESHNESS_DECAY_CARD_VERSION = 2;
const FRESHNESS_DECAY_CARD_CAPABILITY = Object.freeze({
  version: FRESHNESS_DECAY_CARD_VERSION,
});

// Whether the decision machinery may ask under `decay` (`{ enabled }`):
// decay is not off. `decay: false` keeps counting/display but never
// asks or skips. The per-row `decide` flag already encodes this; this
// predicate covers callers without a resolved row. Availability is
// never chosen by a calendar date. Never throws.
function freshnessDecayCardActive(decay) {
  try {
    if (decay && typeof decay === "object" && decay.enabled === false) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// True when a pre-write queue row says a choice is due — never permission
// to execute an action. Pre-v5 rows carry no flag and never decide.
function isFreshnessDecayDecisionEntry(entry) {
  try {
    return Boolean(entry) && entry.decide === true;
  } catch (error) {
    return false;
  }
}

// Partition resolved stamp entries into writes and decision skips:
// `resolved` is `[{ target, match }]` with `match` a
// `matchFreshStampExactEntry` result. An exact, due, at-limit row skips
// without changing fresh/count; everything else stamps (counted only
// when exactly eligible). Skip is a named decision outcome, not a
// swallowed write failure. Pass `{ enabled: false }` to stamp every
// target (older freshness namespaces fall back to counting). Returns
// `{ stamp, skipped }`. Never throws.
function partitionFreshStampDecisionSkips(resolved, options) {
  try {
    const skipDecisions = !options || options.enabled !== false;
    const stamp = [];
    const skipped = [];
    for (const item of Array.isArray(resolved) ? resolved : []) {
      const match = item ? item.match : null;
      if (
        skipDecisions &&
        match &&
        match.ok === true &&
        isFreshnessDecayDecisionEntry(match.entry)
      ) {
        skipped.push(item.target);
      } else {
        stamp.push(item.target);
      }
    }
    return Object.freeze({ stamp: Object.freeze(stamp), skipped: Object.freeze(skipped) });
  } catch (error) {
    const targets = [];
    for (const item of Array.isArray(resolved) ? resolved : []) {
      if (item && item.target !== undefined) {
        targets.push(item.target);
      }
    }
    return Object.freeze({ stamp: Object.freeze(targets), skipped: Object.freeze([]) });
  }
}

// The skip tail appended to a Fresh notice when some targets needed a
// decision (`1 needs a decision`), or "" when none skipped. Skipped
// targets never inflate upkeep and never enter anchor exclusions.
function formatFreshStampSkipTail(skipped) {
  try {
    const count = Math.floor(numericOrDefault(skipped, Number.NaN));
    if (!Number.isInteger(count) || count <= 0) {
      return "";
    }
    return count === 1 ? " · 1 needs a decision" : ` · ${count} need a decision`;
  } catch (error) {
    return "";
  }
}

// The standalone notice when every target skipped: nothing was written,
// and the review walk reaches the decision later.
function formatFreshStampSkippedNotice(skipped) {
  try {
    const count = Math.floor(numericOrDefault(skipped, Number.NaN));
    if (!Number.isInteger(count) || count <= 0) {
      return "Could not update task; no tasks were updated";
    }
    const tasks = count === 1 ? "1 task" : `${count} tasks`;
    const verb = count === 1 ? "needs" : "need";
    return `${tasks} ${verb} a decision · the review walk reaches it later`;
  } catch (error) {
    return "Could not update task; no tasks were updated";
  }
}

// Cursor placement for Reword: the end of the task body, before trailing
// metadata (`[key:: v]` / `(key:: v)` fields, `#tags`, `^block-id`), so
// editing starts on the wording and the count restarts from the commit.
// Falls back to the trimmed line end. Never throws.
function freshnessDecayRewordCursorCh(line) {
  try {
    const text = String(line || "");
    // `#task` is the global filter token, not metadata: the cursor belongs
    // after the wording, never wedged between the checkbox and `#task`.
    const pattern = /[ \t]+(?:\[[A-Za-z][A-Za-z0-9_-]*\s*::|\([A-Za-z][A-Za-z0-9_-]*\s*::|#(?!task(?:[\s]|$))[^\s#][^\s]*|\^[A-Za-z0-9-]+[ \t]*$)/;
    const match = pattern.exec(text);
    if (match && Number.isInteger(match.index) && match.index > 0) {
      return match.index;
    }
    return text.replace(/[ \t]+$/, "").length;
  } catch (error) {
    return String(line || "").length;
  }
}

// "captured 6 weeks ago" from a `[created:: YYYY-MM-DD]` value for the
// card context line. Null when created is unavailable — age is optional.
// Never throws.
function formatFreshnessDecayCapturedAge(createdValue, todayText) {
  try {
    const created = normalizeBulletPropertyValue(createdValue);
    const today = normalizeBulletPropertyValue(todayText);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      return null;
    }
    const start = new Date(created + "T00:00:00");
    const end = new Date(today + "T00:00:00");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return null;
    }
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (!Number.isInteger(days) || days < 0) {
      return null;
    }
    if (days === 0) {
      return "captured today";
    }
    if (days === 1) {
      return "captured yesterday";
    }
    if (days < 14) {
      return `captured ${days} days ago`;
    }
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "captured 1 week ago" : `captured ${weeks} weeks ago`;
  } catch (error) {
    return null;
  }
}

// Stable snapshot of the task's child block: the lines strictly below the
// task line that belong to its subtree (Schedule Log preimages included).
// Reuses `findCurrentBulletChildBlock`; never writes a new parser. Never
// throws.
function snapshotFreshnessDecayChildBlock(content, taskLine) {
  try {
    const lines = String(content || "").split(/\r?\n/);
    const index = Math.floor(Number(taskLine));
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
      return "";
    }
    const block = findCurrentBulletChildBlock(lines, index);
    const start = Math.max(0, block.startLine);
    const end = Math.max(start, Math.min(lines.length, block.endLineExclusive));
    return lines.slice(start, end).join("\n");
  } catch (error) {
    return "";
  }
}

// Stable serialization of the priority-ladder config consumed by
// `planFreshnessDecayCard` (levels, windows, roll limits, decay on/off).
// `"null"` when absent. Never throws.
function serializeFreshnessDecayPriorityProperty(property) {
  try {
    if (!property) {
      return "null";
    }
    return JSON.stringify(property, (key, value) =>
      value instanceof Map ? Array.from(value.entries()) : value,
    );
  } catch (error) {
    return "__unserializable__";
  }
}

// The first configured priority-ladder property (`values === "priority"`),
// or null. Priority validity resolves against this loader, never a second
// hard-coded table. Never throws.
function findFreshnessDecayPriorityProperty(config) {
  try {
    const properties =
      config && Array.isArray(config.properties) ? config.properties : [];
    return (
      properties.find(
        (candidate) => candidate && candidate.values === "priority",
      ) || null
    );
  } catch (error) {
    return null;
  }
}

// The effective review interval for a decision card, in days: the
// ledger-resolved interval for the queue row, else the line's
// `[refresh:: N]`, else the note's `task_refresh`, else the configured
// interval, else 7. Never throws.
function resolveFreshnessDecayIntervalDays(api, entry, rawLine, content) {
  try {
    if (api && typeof api.intervalFor === "function" && entry) {
      const resolved = api.intervalFor(entry);
      if (
        resolved &&
        Number.isInteger(resolved.days) &&
        resolved.days >= 1 &&
        resolved.days <= 365
      ) {
        return resolved.days;
      }
    }
  } catch (error) {
    // Fall through to the local chain below.
  }
  try {
    const lineDays = parseRefreshDaysFromLine(rawLine);
    if (Number.isInteger(lineDays)) {
      return lineDays;
    }
  } catch (error) {
    // Fall through to the note chain below.
  }
  try {
    const noteDays = parseNoteRefreshDays(getNoteTaskRefreshRaw(content));
    if (Number.isInteger(noteDays)) {
      return noteDays;
    }
  } catch (error) {
    // Fall through to the configured interval below.
  }
  try {
    if (api && typeof api.config === "function") {
      const config = api.config();
      if (config && Number.isInteger(config.interval) && config.interval >= 1 && config.interval <= 365) {
        return config.interval;
      }
    }
  } catch (error) {
    // Fall through to the default below.
  }
  return 7;
}

// One decision-card row: `{ key, action, label, detail, available,
// unavailableReason, recommended }`. `action` is the commit key the
// modal hands back (`notNow`, `lessOften`, `reword`, `drop`, `keep`,
// or `level:N`). Pure; never throws.
function buildFreshnessDecayCardRows(plan) {
  try {
    const source = plan && typeof plan === "object" ? plan : {};
    const keeps = normalizeFreshnessDecayKeepsCount(source.keeps);
    const keepNoun = keeps === 1 ? "keep" : "keeps";
    const backPhrase = (windowText, offset) => {
      const clean = normalizeBulletPropertyValue(windowText).replace(
        /\*\*/g,
        "",
      );
      const windowed = /^in (\d+) (\([^)]*\)) days$/.exec(clean);
      if (windowed) {
        return `back in ${windowed[1]} days ${windowed[2]}`;
      }
      if (clean) {
        return `back ${clean}`;
      }
      return Number.isInteger(offset) ? `back in ${offset} days` : "back";
    };
    const rows = [];
    const notNow = source.notNow && typeof source.notNow === "object" ? source.notNow : {};
    if (notNow.available === true) {
      rows.push(
        Object.freeze({
          key: "Enter",
          action: "notNow",
          label: "Not now",
          detail: `${normalizeBulletPropertyValue(notNow.fromLabel) || "P0"} → ${normalizeBulletPropertyValue(notNow.levelLabel)} · ${backPhrase(notNow.windowText, notNow.offset)}`,
          available: true,
          unavailableReason: null,
          recommended: true,
        }),
      );
    } else {
      rows.push(
        Object.freeze({
          key: "Enter",
          action: "notNow",
          label: "Not now",
          detail: normalizeBulletPropertyValue(notNow.unavailableReason) || "Not now is unavailable",
          available: false,
          unavailableReason: normalizeBulletPropertyValue(notNow.unavailableReason) || "Not now is unavailable",
          recommended: false,
        }),
      );
    }
    const lessOften = source.lessOften && typeof source.lessOften === "object" ? source.lessOften : {};
    if (lessOften.available === true && lessOften.mode === "refresh") {
      rows.push(
        Object.freeze({
          key: "L",
          action: "lessOften",
          label: "Less often",
          detail: `review every ${lessOften.afterDays} days instead of ${lessOften.beforeDays}`,
          available: true,
          unavailableReason: null,
          recommended: false,
        }),
      );
    } else if (lessOften.available === true && lessOften.mode === "picker") {
      rows.push(
        Object.freeze({
          key: "L",
          action: "lessOften",
          label: "Less often",
          detail: `choose every ${lessOften.minDays}–${lessOften.maxDays} days…`,
          available: true,
          unavailableReason: null,
          recommended: false,
        }),
      );
    } else {
      rows.push(
        Object.freeze({
          key: "L",
          action: "lessOften",
          label: "Less often",
          detail: normalizeBulletPropertyValue(lessOften.unavailableReason) || "Less often is unavailable",
          available: false,
          unavailableReason: normalizeBulletPropertyValue(lessOften.unavailableReason) || "Less often is unavailable",
          recommended: false,
        }),
      );
    }
    rows.push(
      Object.freeze({
        key: "E",
        action: "reword",
        label: "Reword",
        detail: "edit the task · start the count over",
        available: true,
        unavailableReason: null,
        recommended: false,
      }),
    );
    rows.push(
      Object.freeze({
        key: "D",
        action: "drop",
        label: "Drop",
        detail: `cancel · dropped after ${keeps} ${keepNoun}`,
        available: true,
        unavailableReason: null,
        recommended: false,
      }),
    );
    rows.push(
      Object.freeze({
        key: "Alt+F",
        action: "keep",
        label: "Keep",
        detail: "still right · asks again next review",
        available: true,
        unavailableReason: null,
        recommended: false,
      }),
    );
    const levels = Array.isArray(source.levels) ? source.levels : [];
    levels.forEach((pick, index) => {
      const entry = pick && typeof pick === "object" ? pick : {};
      const label = normalizeBulletPropertyValue(entry.label) || `P${index + 1}`;
      if (entry.available === true) {
        rows.push(
          Object.freeze({
            key: String(index + 1),
            action: `level:${index}`,
            label,
            detail: backPhrase(entry.windowText, entry.offset),
            available: true,
            unavailableReason: null,
            recommended: false,
          }),
        );
      } else {
        rows.push(
          Object.freeze({
            key: String(index + 1),
            action: `level:${index}`,
            label,
            detail: normalizeBulletPropertyValue(entry.unavailableReason) || `${label} is unavailable`,
            available: false,
            unavailableReason: normalizeBulletPropertyValue(entry.unavailableReason) || `${label} is unavailable`,
            recommended: false,
          }),
        );
      }
    });
    return Object.freeze(rows);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The review-walk decision card (`docs/freshness.md` §2a): a small
// keyboard-first modal over one due Ready task at its keep limit. Enter
// defers but never cancels; Esc changes nothing. The opening gesture is
// consumed — key repeat, bubbling, and a double callback cannot approve
// or apply twice — and the card never opens nested cards. Selection,
// mouse, and keyboard activate the same action. Never throws out of the
// callbacks; dismissal writes nothing.
