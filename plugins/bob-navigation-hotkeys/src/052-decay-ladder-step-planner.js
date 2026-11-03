// Plan the card's one-rung Enter action. Lane steps do not need priority
// config. Priority steps choose their destination directly and deliberately
// bypass the Schedule Log roll-streak recommendation.
function freshnessDecayCardStepBackPhrase(windowText, offset) {
  const clean = normalizeBulletPropertyValue(windowText).replace(/\*\*/g, "");
  const match = /^in (\d+) (\([^)]*\)) days$/.exec(clean);
  if (match) return `back in ${match[1]} days ${match[2]}`;
  if (clean) return `back ${clean}`;
  return Number.isInteger(offset) ? `back in ${offset} days` : "back";
}

function planFreshnessDecayCardStep(options = {}) {
  const rung = normalizeBulletPropertyValue(options.rung) || "Ready";
  const keeps = normalizeFreshnessDecayKeepsCount(options.keeps);
  const unavailable = (reason) => Object.freeze({
    available: false,
    unavailableReason: reason,
    kind: "unavailable",
    fromLabel: rung,
    toLabel: "",
    label: "",
    detail: normalizeBulletPropertyValue(reason),
    date: "",
    offset: null,
    windowText: "",
    reason: "",
    scheduleLog: null,
  });

  if (rung === "WIP") {
    return Object.freeze({
      available: true,
      unavailableReason: null,
      kind: "lane",
      fromLabel: "WIP",
      toLabel: "Next",
      label: "Move to Next",
      detail: "[/] → [*] · still planned, no longer in progress",
      date: "",
      offset: null,
      windowText: "",
      reason: "",
      scheduleLog: null,
    });
  }
  if (rung === "Next") {
    return Object.freeze({
      available: true,
      unavailableReason: null,
      kind: "lane",
      fromLabel: "Next",
      toLabel: "Ready",
      label: "Move to Ready",
      detail: "[*] → [ ] · back in the Ready backlog",
      date: "",
      offset: null,
      windowText: "",
      reason: "",
      scheduleLog: null,
    });
  }

  if (options.decayInvalid === true) return unavailable("priority config is invalid");
  if (options.decayEnabled === false) return unavailable("decay is off");
  const property = options.property || null;
  if (!property || property.values !== "priority") {
    return unavailable(options.priorityLoadError || "no `priority` property in bob/config.yml");
  }

  const baseDate = options.baseDate instanceof Date ? options.baseDate : new Date();
  const random = typeof options.random === "function" ? options.random : Math.random;
  const currentScheduled = normalizeBulletPropertyValue(options.currentScheduled);
  const currentValue = normalizeBulletPropertyValue(options.currentValue);
  let level = null;
  let toLevel = null;
  let kind = "decay";
  let baseReason = "";

  if (rung === "Ready") {
    const entry = resolveFreshnessDecayP0EntryLevel(
      property,
      Number(options.intervalDays),
      options.enterLabel,
    );
    if (!entry || entry.unavailable || !entry.level) {
      return unavailable(entry && entry.reason ? entry.reason : "no priority entry level is available");
    }
    toLevel = entry.level;
    kind = "entry";
    const rolled = rollPriorityRecommendationDate(toLevel, baseDate, random, currentScheduled);
    const windowText = formatPriorityRollChosenWindowText(toLevel, rolled && rolled.offset);
    if (!isFutureDatedRollResult(rolled) || !windowText) {
      return unavailable("no future date in this level's window");
    }
    baseReason = formatPriorityDecayScheduleReason({
      fromLevel: { label: IMPLICIT_PRIORITY_LEVEL_LABEL },
      toLevel,
      rolledDays: rolled.offset,
    });
    if (!baseReason) return unavailable("cannot describe the P0 entry");
    const date = formatBulletPropertyDate(rolled.date);
    const reason = formatFreshnessDecayReasonWithKeptTail(baseReason, keeps, rung);
    return Object.freeze({
      available: true,
      unavailableReason: null,
      kind,
      fromLabel: rung,
      toLabel: normalizeBulletPropertyValue(toLevel.label),
      label: `Defer to ${normalizeBulletPropertyValue(toLevel.label)}`,
      detail: `${rung} → ${normalizeBulletPropertyValue(toLevel.label)} · ${freshnessDecayCardStepBackPhrase(windowText, rolled.offset)}`,
      levelLabel: normalizeBulletPropertyValue(toLevel.label),
      date,
      offset: rolled.offset,
      windowText,
      reason,
      scheduleLog: buildPriorityDecayScheduleLogPayload(currentScheduled, date, reason),
    });
  }

  const levels = Array.isArray(property.levels) ? property.levels : [];
  const currentIndex = levels.findIndex((candidate) => candidate && candidate.value === currentValue);
  if (currentIndex < 0) {
    return unavailable(currentValue ? `unknown priority "${currentValue}"` : "priority level is missing");
  }
  level = levels[currentIndex];
  const terminal = currentIndex === levels.length - 1;
  toLevel = terminal ? level : levels[currentIndex + 1];
  if (!toLevel) return unavailable("no next priority level is configured");
  kind = terminal ? "roll" : "decay";
  const rolled = rollPriorityRecommendationDate(toLevel, baseDate, random, currentScheduled);
  const windowText = formatPriorityRollChosenWindowText(toLevel, rolled && rolled.offset);
  if (!isFutureDatedRollResult(rolled) || !windowText) {
    return unavailable("no future date in this level's window");
  }
  baseReason = terminal
    ? formatPriorityRollScheduleReason({ source: "scheduled", level: toLevel, rolledDays: rolled.offset })
    : formatPriorityDecayScheduleReason({
      fromLevel: { label: rung },
      toLevel,
      rolledDays: rolled.offset,
    });
  if (!baseReason) return unavailable("cannot describe this priority step");
  const date = formatBulletPropertyDate(rolled.date);
  const reason = formatFreshnessDecayReasonWithKeptTail(baseReason, keeps, rung);
  const target = normalizeBulletPropertyValue(toLevel.label);
  const label = terminal ? `Roll again at ${target}` : `Defer to ${target}`;
  const detail = terminal
    ? `bottom of the ladder · ${freshnessDecayCardStepBackPhrase(windowText, rolled.offset)}`
    : `${rung} → ${target} · ${freshnessDecayCardStepBackPhrase(windowText, rolled.offset)}`;
  return Object.freeze({
    available: true,
    unavailableReason: null,
    kind,
    fromLabel: rung,
    toLabel: target,
    label,
    detail,
    levelLabel: target,
    date,
    offset: rolled.offset,
    windowText,
    reason,
    scheduleLog: buildPriorityDecayScheduleLogPayload(currentScheduled, date, reason),
  });
}
