// Derived calendar group and step stops for api.navGroups v1. Built on
// intentionCardSubjectForPath and the day/week/quarter/year infos. Pure:
// callers pass today, vault existence, and the adopted ISO-year set.
const NAV_GROUPS_WEEK_NOTE_RE = /^(\d{4})\/\1-W(\d{2})\.md$/i;
const NAV_GROUPS_ALL_TIME_PATH = "all_time.md";
const NAV_GROUPS_NONE_YEAR = Object.freeze({
  reason: "year",
  message: "Years have no group jump — ]n steps years",
});
const NAV_GROUPS_NONE_ALL = Object.freeze({
  reason: "all",
  message: "All time has no group jump",
});
const NAV_GROUPS_WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
const NAV_GROUPS_MONTHS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

function navGroupsNormalizePath(value) {
  const text = String(value || "").replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  if (!text) return "";
  return /\.md$/i.test(text) ? text : text + ".md";
}

function navGroupsTarget(path) {
  const text = navGroupsNormalizePath(path);
  return text.replace(/\.md$/i, "");
}

function navGroupsWeekNoteIsoYear(path) {
  const match = NAV_GROUPS_WEEK_NOTE_RE.exec(navGroupsNormalizePath(path));
  return match ? Number(match[1]) : null;
}

function navGroupsPathYear(path) {
  const text = navGroupsNormalizePath(path);
  if (text === NAV_GROUPS_ALL_TIME_PATH) return null;
  const match = /^(\d{4})(?:\/|\.md$)/.exec(text);
  return match ? Number(match[1]) : null;
}

function navGroupsPathInBounds(path) {
  const text = navGroupsNormalizePath(path);
  if (text === NAV_GROUPS_ALL_TIME_PATH) return true;
  const year = navGroupsPathYear(text);
  return Number.isInteger(year) && year >= 1970 && year <= 2999;
}

function navGroupsAdoptedIsoYearsFromFiles(files, exceptPath) {
  const years = new Set();
  const except = exceptPath ? navGroupsNormalizePath(exceptPath) : "";
  const list = Array.isArray(files) ? files : [];
  for (const file of list) {
    const raw = typeof file === "string" ? file : file && typeof file.path === "string" ? file.path : "";
    const path = navGroupsNormalizePath(raw);
    if (!path || (except && path === except)) continue;
    const year = navGroupsWeekNoteIsoYear(path);
    if (year !== null) years.add(year);
  }
  return years;
}

function navGroupsAdoptedHas(adoptedYears, isoYear) {
  if (!Number.isInteger(isoYear) || !adoptedYears) return false;
  try {
    if (typeof adoptedYears.has === "function") return adoptedYears.has(isoYear) === true;
  } catch (_error) {}
  return false;
}

function navGroupsIsPreAdoption(end, isoYear, today, adoptedYears) {
  if (!Number.isInteger(isoYear)) return false;
  const endOrd = typeof intentionCardDateOrdinal === "function" ? intentionCardDateOrdinal(end) : null;
  const todayOrd = typeof intentionCardDateOrdinal === "function" ? intentionCardDateOrdinal(today) : null;
  if (endOrd === null || todayOrd === null) return false;
  if (endOrd >= todayOrd) return false;
  return !navGroupsAdoptedHas(adoptedYears, isoYear);
}

function navGroupsDayLandingLabel(day) {
  const parts = typeof intentionCardDateParts === "function" ? intentionCardDateParts(day) : null;
  if (!parts) return "";
  const date = intentionCardLocalDate(parts.year, parts.month, parts.day);
  if (!date) return "";
  return NAV_GROUPS_WEEKDAYS[date.getDay()] + " " + NAV_GROUPS_MONTHS[parts.month - 1] + " " + parts.day;
}

function navGroupsMemberDayLabel(day) {
  const parts = typeof intentionCardDateParts === "function" ? intentionCardDateParts(day) : null;
  if (!parts) return "";
  const date = intentionCardLocalDate(parts.year, parts.month, parts.day);
  if (!date) return "";
  return NAV_GROUPS_WEEKDAYS[date.getDay()] + " " + parts.day;
}

function navGroupsPadWeek(week) {
  return "W" + String(week).padStart(2, "0");
}

function navGroupsWeekGroupLabel(isoYear, week, currentIsoYear) {
  const short = navGroupsPadWeek(week);
  return isoYear === currentIsoYear ? short : String(isoYear).padStart(4, "0") + "-" + short;
}

function navGroupsQuarterGroupLabel(year, quarter, currentYear) {
  const short = "Q" + quarter;
  return year === currentYear ? short : String(year).padStart(4, "0") + "-" + short;
}

function navGroupsGhostReason(info) {
  if (!info) return "";
  if (info.kind === "day") {
    const label = navGroupsDayLandingLabel(info.start || info.id);
    return (label || info.id) + " is before Bob's period notes began — navigation never creates it";
  }
  return String(info.id || "") + " is before Bob's period notes began — navigation never creates it";
}

function navGroupsIsoYearOf(info) {
  if (!info) return null;
  if (info.kind === "day") {
    const parts = typeof intentionCardIsoParts === "function" ? intentionCardIsoParts(info.start || info.id) : null;
    return parts && Number.isInteger(parts.isoYear) ? parts.isoYear : null;
  }
  if (info.kind === "week" || info.kind === "quarter" || info.kind === "year") {
    const match = /^(\d{4})/.exec(String(info.id || ""));
    return match ? Number(match[1]) : navGroupsPathYear(info.path);
  }
  return null;
}

function navGroupsClassify(info, today, vaultHas, adoptedYears) {
  if (!info || !info.path || !navGroupsPathInBounds(info.path)) {
    return { state: "ghost", ghostReason: "" };
  }
  let exists = false;
  try {
    exists = typeof vaultHas === "function" ? vaultHas(info.path) === true : false;
  } catch (_error) {
    exists = false;
  }
  if (exists) return { state: "exists", ghostReason: null };
  if (info.kind === "all") {
    return {
      state: "ghost",
      ghostReason: "All time is not in the vault — navigation never creates it",
    };
  }
  const isoYear = navGroupsIsoYearOf(info);
  if (navGroupsIsPreAdoption(info.end || info.start, isoYear, today, adoptedYears)) {
    return { state: "ghost", ghostReason: navGroupsGhostReason(info) };
  }
  return { state: "creatable", ghostReason: null };
}

function navGroupsStop(info, labels, today, vaultHas, adoptedYears, wraps) {
  if (!info || !info.path || !navGroupsPathInBounds(info.path)) return null;
  const classified = navGroupsClassify(info, today, vaultHas, adoptedYears);
  return Object.freeze({
    path: info.path,
    target: navGroupsTarget(info.path),
    groupLabel: labels.groupLabel,
    landingLabel: labels.landingLabel,
    shortLabel: labels.shortLabel,
    state: classified.state,
    ghostReason: classified.ghostReason,
    wraps: wraps === true,
    source: "calendar",
  });
}

function navGroupsAllTimeInfo() {
  return {
    kind: "all",
    id: "all_time",
    path: NAV_GROUPS_ALL_TIME_PATH,
    label: "All time",
    shortLabel: "All time",
    start: null,
    end: null,
  };
}

function navGroupsMemberState(path, currentPath, vaultHas) {
  if (path === currentPath) return "current";
  try {
    if (typeof vaultHas === "function" && vaultHas(path) === true) return "exists";
  } catch (_error) {}
  return "missing";
}

function navGroupsDayMembers(weekInfo, currentPath, vaultHas) {
  if (!weekInfo || !weekInfo.start) return null;
  const members = [];
  let cursor = weekInfo.start;
  for (let index = 0; index < 7; index += 1) {
    const dayInfo = intentionCardDayInfo(cursor, weekInfo.today, false);
    if (!dayInfo) return null;
    members.push(Object.freeze({
      label: navGroupsMemberDayLabel(cursor),
      path: dayInfo.path,
      state: navGroupsMemberState(dayInfo.path, currentPath, vaultHas),
    }));
    cursor = intentionCardShiftDate(cursor, 1);
  }
  return Object.freeze(members);
}

function navGroupsWeekMembers(quarterInfo, currentPath, vaultHas) {
  if (!quarterInfo) return null;
  const match = /^(\d{4})-Q([1-4])$/.exec(String(quarterInfo.id || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const firstWeek = (quarter - 1) * 13 + 1;
  const lastWeek = quarter === 4 ? intentionCardWeeksInIsoYear(year) : quarter * 13;
  const members = [];
  for (let week = firstWeek; week <= lastWeek; week += 1) {
    const info = intentionCardWeekInfo(year, week, quarterInfo.today, false);
    if (!info) return null;
    members.push(Object.freeze({
      label: info.shortLabel,
      path: info.path,
      state: navGroupsMemberState(info.path, currentPath, vaultHas),
    }));
  }
  return Object.freeze(members);
}

function navGroupsQuarterMembers(yearInfo, currentPath, vaultHas) {
  if (!yearInfo) return null;
  const year = Number(yearInfo.id);
  if (!Number.isInteger(year)) return null;
  const members = [];
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const info = intentionCardQuarterInfo(year, quarter, yearInfo.today, false);
    if (!info) return null;
    members.push(Object.freeze({
      label: info.shortLabel,
      path: info.path,
      state: navGroupsMemberState(info.path, currentPath, vaultHas),
    }));
  }
  return Object.freeze(members);
}

function navGroupsEnteringLabel(stop) {
  return stop && typeof stop.shortLabel === "string" && stop.shortLabel ? stop.shortLabel : null;
}

function navGroupsGroup(spec) {
  const position = spec.position;
  const size = spec.size;
  return Object.freeze({
    noun: spec.noun,
    label: spec.label,
    shortLabel: spec.shortLabel,
    position,
    size,
    index: spec.index,
    count: spec.count,
    members: spec.members,
    atStart: position === 1,
    atEnd: size > 0 && position === size,
    enteringNext: spec.atEnd ? spec.enteringNext : null,
    enteringPrev: spec.atStart ? spec.enteringPrev : null,
  });
}

function navGroupsOk(fields) {
  return Object.freeze({
    ok: true,
    route: fields.route == null ? null : fields.route,
    kind: fields.kind == null ? null : fields.kind,
    lane: fields.lane == null ? null : fields.lane,
    step: fields.step || null,
    stepNone: fields.stepNone || null,
    group: fields.group || null,
    prevGroup: fields.prevGroup || null,
    nextGroup: fields.nextGroup || null,
    none: fields.none || null,
  });
}

function navGroupsStep(prev, next, parent) {
  return Object.freeze({ prev: prev || null, next: next || null, parent: parent || null });
}

function navGroupsWeekOfDay(subject) {
  if (subject && subject.parent && subject.parent.kind === "week") return subject.parent;
  const parts = typeof intentionCardIsoParts === "function"
    ? intentionCardIsoParts(subject && (subject.start || subject.id)) : null;
  if (!parts) return null;
  return intentionCardWeekInfo(parts.isoYear, parts.week, subject && subject.today, false);
}

function navGroupsDailyGroupStops(subject, today, vaultHas, adoptedYears) {
  const week = navGroupsWeekOfDay(subject);
  if (!week || !week.start) return { prevGroup: null, nextGroup: null };
  const currentIso = navGroupsIsoYearOf(week);
  const prevDay = intentionCardShiftDate(week.start, -7);
  const nextDay = intentionCardShiftDate(week.start, 7);
  const prevInfo = prevDay ? intentionCardDayInfo(prevDay, today, false) : null;
  const nextInfo = nextDay ? intentionCardDayInfo(nextDay, today, false) : null;
  const prevIso = prevInfo ? navGroupsIsoYearOf(prevInfo) : null;
  const nextIso = nextInfo ? navGroupsIsoYearOf(nextInfo) : null;
  const prevWeek = prevInfo ? intentionCardIsoParts(prevInfo.start) : null;
  const nextWeek = nextInfo ? intentionCardIsoParts(nextInfo.start) : null;
  const prevGroup = prevInfo && prevWeek ? navGroupsStop(prevInfo, {
    groupLabel: navGroupsWeekGroupLabel(prevIso, prevWeek.week, currentIso),
    landingLabel: navGroupsDayLandingLabel(prevInfo.start),
    shortLabel: navGroupsWeekGroupLabel(prevIso, prevWeek.week, currentIso),
  }, today, vaultHas, adoptedYears, false) : null;
  const nextGroup = nextInfo && nextWeek ? navGroupsStop(nextInfo, {
    groupLabel: navGroupsWeekGroupLabel(nextIso, nextWeek.week, currentIso),
    landingLabel: navGroupsDayLandingLabel(nextInfo.start),
    shortLabel: navGroupsWeekGroupLabel(nextIso, nextWeek.week, currentIso),
  }, today, vaultHas, adoptedYears, false) : null;
  return { prevGroup, nextGroup, week, currentIso };
}

function navGroupsWeekGroupStops(subject, today, vaultHas, adoptedYears) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(subject && subject.id || ""));
  if (!match) return { prevGroup: null, nextGroup: null };
  const year = Number(match[1]);
  const week = Number(match[2]);
  const quarter = Math.min(4, Math.floor((week - 1) / 13) + 1);
  const prevInfo = quarter > 1
    ? intentionCardWeekInfo(year, (quarter - 2) * 13 + 1, today, false)
    : intentionCardWeekInfo(year - 1, 40, today, false);
  const nextInfo = quarter < 4
    ? intentionCardWeekInfo(year, quarter * 13 + 1, today, false)
    : intentionCardWeekInfo(year + 1, 1, today, false);
  const prevMatch = prevInfo ? /^(\d{4})-W(\d{2})$/.exec(prevInfo.id) : null;
  const nextMatch = nextInfo ? /^(\d{4})-W(\d{2})$/.exec(nextInfo.id) : null;
  const prevQuarter = prevMatch ? Math.min(4, Math.floor((Number(prevMatch[2]) - 1) / 13) + 1) : null;
  const nextQuarter = nextMatch ? Math.min(4, Math.floor((Number(nextMatch[2]) - 1) / 13) + 1) : null;
  const prevYear = prevMatch ? Number(prevMatch[1]) : null;
  const nextYear = nextMatch ? Number(nextMatch[1]) : null;
  const prevGroup = prevInfo && prevQuarter ? navGroupsStop(prevInfo, {
    groupLabel: navGroupsQuarterGroupLabel(prevYear, prevQuarter, year),
    landingLabel: prevInfo.shortLabel,
    shortLabel: navGroupsQuarterGroupLabel(prevYear, prevQuarter, year),
  }, today, vaultHas, adoptedYears, false) : null;
  const nextGroup = nextInfo && nextQuarter ? navGroupsStop(nextInfo, {
    groupLabel: navGroupsQuarterGroupLabel(nextYear, nextQuarter, year),
    landingLabel: nextInfo.shortLabel,
    shortLabel: navGroupsQuarterGroupLabel(nextYear, nextQuarter, year),
  }, today, vaultHas, adoptedYears, false) : null;
  return { prevGroup, nextGroup, year, week, quarter };
}

function navGroupsQuarterGroupStops(subject, today, vaultHas, adoptedYears) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(subject && subject.id || ""));
  if (!match) return { prevGroup: null, nextGroup: null };
  const year = Number(match[1]);
  const prevInfo = intentionCardQuarterInfo(year - 1, 1, today, false);
  const nextInfo = intentionCardQuarterInfo(year + 1, 1, today, false);
  const prevGroup = prevInfo ? navGroupsStop(prevInfo, {
    groupLabel: String(year - 1).padStart(4, "0"),
    landingLabel: "Q1",
    shortLabel: String(year - 1).padStart(4, "0"),
  }, today, vaultHas, adoptedYears, false) : null;
  const nextGroup = nextInfo ? navGroupsStop(nextInfo, {
    groupLabel: String(year + 1).padStart(4, "0"),
    landingLabel: "Q1",
    shortLabel: String(year + 1).padStart(4, "0"),
  }, today, vaultHas, adoptedYears, false) : null;
  return { prevGroup, nextGroup, year };
}

function navGroupsStepLabels(info, currentIsoYear) {
  if (!info) return { groupLabel: "", landingLabel: "", shortLabel: "" };
  if (info.kind === "day") {
    const landing = navGroupsMemberDayLabel(info.start || info.id) || navGroupsDayLandingLabel(info.start || info.id);
    return { groupLabel: landing, landingLabel: landing, shortLabel: landing };
  }
  if (info.kind === "week") {
    const iso = navGroupsIsoYearOf(info);
    const weekMatch = /^(\d{4})-W(\d{2})$/.exec(String(info.id || ""));
    const label = weekMatch
      ? navGroupsWeekGroupLabel(iso, Number(weekMatch[2]), currentIsoYear)
      : info.shortLabel;
    return { groupLabel: label, landingLabel: info.shortLabel, shortLabel: label };
  }
  if (info.kind === "quarter") {
    const iso = navGroupsIsoYearOf(info);
    const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(String(info.id || ""));
    const label = quarterMatch
      ? navGroupsQuarterGroupLabel(iso, Number(quarterMatch[2]), currentIsoYear)
      : info.shortLabel;
    return { groupLabel: label, landingLabel: info.shortLabel, shortLabel: label };
  }
  if (info.kind === "year" || info.kind === "all") {
    const label = info.shortLabel || info.id;
    return { groupLabel: label, landingLabel: label, shortLabel: label };
  }
  const label = info.shortLabel || info.id || "";
  return { groupLabel: label, landingLabel: label, shortLabel: label };
}

function navGroupsStepStop(info, currentIsoYear, today, vaultHas, adoptedYears) {
  if (!info) return null;
  return navGroupsStop(info, navGroupsStepLabels(info, currentIsoYear), today, vaultHas, adoptedYears, false);
}

function navGroupsDayPosition(subject) {
  const startOrd = intentionCardDateOrdinal(subject.parent && subject.parent.start);
  const dayOrd = intentionCardDateOrdinal(subject.start || subject.id);
  if (startOrd === null || dayOrd === null) return 1;
  return dayOrd - startOrd + 1;
}

function navGroupsResolveAllTime(today, vaultHas, adoptedYears) {
  const info = navGroupsAllTimeInfo();
  const classified = navGroupsClassify({
    ...info,
    end: today,
  }, today, vaultHas, adoptedYears);
  void classified;
  return navGroupsOk({
    route: "calendar",
    kind: "all",
    step: navGroupsStep(null, null, null),
    none: NAV_GROUPS_NONE_ALL,
  });
}

function navGroupsCalendarResolve(path, options) {
  const opts = options && typeof options === "object" ? options : {};
  const today = opts.today;
  const vaultHas = typeof opts.vaultHas === "function" ? opts.vaultHas : () => false;
  const adoptedYears = opts.adoptedYears instanceof Set ? opts.adoptedYears : new Set();
  const normalized = navGroupsNormalizePath(path);
  if (normalized === NAV_GROUPS_ALL_TIME_PATH) {
    return navGroupsResolveAllTime(today, vaultHas, adoptedYears);
  }
  const subject = typeof intentionCardSubjectForPath === "function"
    ? intentionCardSubjectForPath(path, today) : null;
  if (!subject) {
    return navGroupsOk({ route: null, kind: null });
  }
  const currentIso = navGroupsIsoYearOf(subject);
  const stepPrev = navGroupsStepStop(subject.previous, currentIso, today, vaultHas, adoptedYears);
  const stepNext = navGroupsStepStop(subject.next, currentIso, today, vaultHas, adoptedYears);
  if (subject.kind === "year") {
    const parent = navGroupsStop(navGroupsAllTimeInfo(), {
      groupLabel: "All time",
      landingLabel: "All time",
      shortLabel: "All time",
    }, today, vaultHas, adoptedYears, false);
    return navGroupsOk({
      route: "calendar",
      kind: "year",
      step: navGroupsStep(stepPrev, stepNext, parent),
      none: NAV_GROUPS_NONE_YEAR,
    });
  }
  if (subject.kind === "day") {
    const jumps = navGroupsDailyGroupStops(subject, today, vaultHas, adoptedYears);
    const week = jumps.week;
    const position = navGroupsDayPosition(subject);
    const weeksInYear = week ? intentionCardWeeksInIsoYear(navGroupsIsoYearOf(week)) : 0;
    const weekMatch = week ? /^(\d{4})-W(\d{2})$/.exec(week.id) : null;
    const groupLabel = weekMatch
      ? navGroupsWeekGroupLabel(Number(weekMatch[1]), Number(weekMatch[2]), navGroupsIsoYearOf(subject) || Number(weekMatch[1]))
      : (week && week.shortLabel) || "";
    const group = week ? navGroupsGroup({
      noun: "day",
      label: groupLabel,
      shortLabel: groupLabel,
      position,
      size: 7,
      index: weekMatch ? Number(weekMatch[2]) : 1,
      count: weeksInYear || 1,
      members: navGroupsDayMembers(week, subject.path, vaultHas),
      atStart: position === 1,
      atEnd: position === 7,
      enteringNext: navGroupsEnteringLabel(jumps.nextGroup),
      enteringPrev: navGroupsEnteringLabel(jumps.prevGroup),
    }) : null;
    return navGroupsOk({
      route: "calendar",
      kind: "day",
      step: navGroupsStep(stepPrev, stepNext, navGroupsStepStop(subject.parent, currentIso, today, vaultHas, adoptedYears)),
      group,
      prevGroup: jumps.prevGroup,
      nextGroup: jumps.nextGroup,
    });
  }
  if (subject.kind === "week") {
    const jumps = navGroupsWeekGroupStops(subject, today, vaultHas, adoptedYears);
    const firstWeek = (jumps.quarter - 1) * 13 + 1;
    const lastWeek = jumps.quarter === 4 ? intentionCardWeeksInIsoYear(jumps.year) : jumps.quarter * 13;
    const size = lastWeek - firstWeek + 1;
    const position = jumps.week - firstWeek + 1;
    const quarterInfo = intentionCardQuarterInfo(jumps.year, jumps.quarter, today, false);
    const groupLabel = navGroupsQuarterGroupLabel(jumps.year, jumps.quarter, jumps.year);
    const group = Number.isInteger(jumps.quarter) ? navGroupsGroup({
      noun: "week",
      label: groupLabel,
      shortLabel: groupLabel,
      position,
      size,
      index: jumps.quarter,
      count: 4,
      members: navGroupsWeekMembers(quarterInfo, subject.path, vaultHas),
      atStart: position === 1,
      atEnd: position === size,
      enteringNext: navGroupsEnteringLabel(jumps.nextGroup),
      enteringPrev: navGroupsEnteringLabel(jumps.prevGroup),
    }) : null;
    return navGroupsOk({
      route: "calendar",
      kind: "week",
      step: navGroupsStep(stepPrev, stepNext, navGroupsStepStop(subject.parent, currentIso, today, vaultHas, adoptedYears)),
      group,
      prevGroup: jumps.prevGroup,
      nextGroup: jumps.nextGroup,
    });
  }
  if (subject.kind === "quarter") {
    const jumps = navGroupsQuarterGroupStops(subject, today, vaultHas, adoptedYears);
    const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(String(subject.id || ""));
    const position = quarterMatch ? Number(quarterMatch[2]) : 1;
    const yearInfo = intentionCardYearInfo(jumps.year, today, false);
    const groupLabel = String(jumps.year).padStart(4, "0");
    const group = Number.isInteger(jumps.year) ? navGroupsGroup({
      noun: "quarter",
      label: groupLabel,
      shortLabel: groupLabel,
      position,
      size: 4,
      index: 1,
      count: 1,
      members: navGroupsQuarterMembers(yearInfo, subject.path, vaultHas),
      atStart: position === 1,
      atEnd: position === 4,
      enteringNext: navGroupsEnteringLabel(jumps.nextGroup),
      enteringPrev: navGroupsEnteringLabel(jumps.prevGroup),
    }) : null;
    return navGroupsOk({
      route: "calendar",
      kind: "quarter",
      step: navGroupsStep(stepPrev, stepNext, navGroupsStepStop(subject.parent, currentIso, today, vaultHas, adoptedYears)),
      group,
      prevGroup: jumps.prevGroup,
      nextGroup: jumps.nextGroup,
    });
  }
  return navGroupsOk({ route: null, kind: null });
}

function navGroupsRequestError(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return Object.freeze({ ok: false, reason: "invalid-input" });
  }
  if (typeof request.path !== "string" || !request.path.trim()) {
    return Object.freeze({ ok: false, reason: "invalid-input" });
  }
  return null;
}

function navGroupsPreAdoptionMessageForPath(path, today) {
  const normalized = navGroupsNormalizePath(path);
  if (normalized === NAV_GROUPS_ALL_TIME_PATH) {
    return "all_time is before Bob's period notes began — navigation never creates it";
  }
  const subject = typeof intentionCardSubjectForPath === "function"
    ? intentionCardSubjectForPath(path, today) : null;
  if (subject) return navGroupsGhostReason(subject);
  const period = typeof periodNotesPeriodForPath === "function" ? periodNotesPeriodForPath(normalized) : null;
  if (period && period.id) {
    return period.id + " is before Bob's period notes began — navigation never creates it";
  }
  return "That note is before Bob's period notes began — navigation never creates it";
}

function navGroupsPathIsPreAdoptionWith(path, today, adoptedYears) {
  const normalized = navGroupsNormalizePath(path);
  if (!normalized) return false;
  const subject = typeof intentionCardSubjectForPath === "function"
    ? intentionCardSubjectForPath(path, today) : null;
  if (subject) {
    return navGroupsIsPreAdoption(subject.end || subject.start, navGroupsIsoYearOf(subject), today, adoptedYears);
  }
  const period = typeof periodNotesPeriodForPath === "function" ? periodNotesPeriodForPath(normalized) : null;
  if (!period || period.kind === "all") return false;
  if (period.kind === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(period.id);
    const info = match ? intentionCardWeekInfo(Number(match[1]), Number(match[2]), today, false) : null;
    return info ? navGroupsIsPreAdoption(info.end, Number(match[1]), today, adoptedYears) : false;
  }
  if (period.kind === "quarter") {
    const match = /^(\d{4})-Q([1-4])$/.exec(period.id);
    const info = match ? intentionCardQuarterInfo(Number(match[1]), Number(match[2]), today, false) : null;
    return info ? navGroupsIsPreAdoption(info.end, Number(match[1]), today, adoptedYears) : false;
  }
  if (period.kind === "year") {
    const year = Number(period.id);
    const info = Number.isInteger(year) ? intentionCardYearInfo(year, today, false) : null;
    return info ? navGroupsIsPreAdoption(info.end, year, today, adoptedYears) : false;
  }
  return false;
}
