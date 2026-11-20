// Day and period card identity (bob-cli-o6 day-period-cards): the title
// block (title, kicker, subtitle, leaf tile, state pill) computed from the
// subject alone, the kit title recognizer for the note's own H1, and the
// docked rail read from the recognized nav and child-link lines. Pure: no DOM,
// no plugin, no vault. Unresolved link flags are added in the DOM step.
// Code identifiers keep the intentionCard* prefix; UI words say day card and
// period card.
const INTENTION_CARD_IDENTITY_WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
const INTENTION_CARD_IDENTITY_MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
const INTENTION_CARD_PERIOD_WORDS = Object.freeze({ day: "day", week: "week", quarter: "quarter", year: "year" });

// Kicker and rail targets are link paths without `.md`, as the kit expects.
function intentionCardLinkTarget(path) {
  return String(path || "").replace(/\.md$/i, "");
}

function intentionCardWeekdayShort(value) {
  const parts = intentionCardDateParts(value);
  if (!parts) return "";
  const date = intentionCardLocalDate(parts.year, parts.month, parts.day);
  return date ? INTENTION_CARD_IDENTITY_WEEKDAYS[date.getDay()] : "";
}

// `Fri, Nov 20, 2026`.
function intentionCardDayTitle(value) {
  const parts = intentionCardDateParts(value);
  const weekday = intentionCardWeekdayShort(value);
  if (!parts || !weekday) return "";
  return `${weekday}, ${INTENTION_CARD_IDENTITY_MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

// bob's spaced range label, plus `, <yyyy>` when both ends share a year (a
// cross-year range already carries both years).
function intentionCardRangeSubtitle(start, end) {
  const first = intentionCardDateParts(start);
  const last = intentionCardDateParts(end);
  if (!first || !last) return "";
  const range = typeof propertyCardPeriodRangeLabel === "function"
    ? propertyCardPeriodRangeLabel(start, end)
    : intentionCardDateRange(start, end);
  if (!range) return "";
  return first.year === last.year ? `${range}, ${first.year}` : range;
}

// The full subject name used in titles and accessible labels.
function intentionCardSubjectName(subject) {
  if (!subject) return "";
  if (subject.kind === "all") return "All time";
  if (subject.kind === "day") return intentionCardDayTitle(subject.id);
  return String(subject.id || "");
}

// { text, tone } or null. Days: TODAY (solid), YESTERDAY or TOMORROW
// (outline) by date ordinals. Periods: THIS WEEK / QUARTER / YEAR (solid)
// while current. Nothing else gets a pill.
function intentionCardStatePill(subject) {
  try {
    if (!subject) return null;
    if (subject.kind === "day") {
      const day = intentionCardDateOrdinal(subject.id);
      const today = intentionCardDateOrdinal(subject.today);
      if (day === null || today === null) return null;
      if (day === today) return { text: "TODAY", tone: "solid" };
      if (day === today - 1) return { text: "YESTERDAY", tone: "outline" };
      if (day === today + 1) return { text: "TOMORROW", tone: "outline" };
      return null;
    }
    const word = INTENTION_CARD_PERIOD_WORDS[subject.kind];
    if (!word || subject.state !== "current") return null;
    return { text: `THIS ${word.toUpperCase()}`, tone: "solid" };
  } catch (_) {
    return null;
  }
}

// { kind, title, kicker: [{ text, target? }], subtitle, tile: { band, value },
// pill } or null. Titles are computed from the path, never parsed from an H1.
function intentionCardIdentity(subject) {
  try {
    if (!subject || !subject.id) return null;
    const pill = intentionCardStatePill(subject);
    if (subject.kind === "day") {
      const parts = intentionCardDateParts(subject.id);
      const weekday = intentionCardWeekdayShort(subject.id);
      if (!parts || !weekday) return null;
      const kicker = [];
      const week = subject.parent;
      if (week && week.shortLabel) kicker.push({ text: week.shortLabel, target: intentionCardLinkTarget(week.path) });
      // The ISO week-year, which is the year note the week belongs to.
      const year = /^(\d{4})-W\d{2}$/.exec(String(week?.id || ""))?.[1] || String(parts.year);
      kicker.push({ text: year });
      return {
        kind: "day", title: intentionCardDayTitle(subject.id), kicker, subtitle: "",
        tile: { band: weekday.toUpperCase(), value: String(parts.day) }, pill,
      };
    }
    if (subject.kind === "week") {
      const match = /^\d{4}-W(\d{2})$/.exec(String(subject.id));
      if (!match) return null;
      const parent = subject.parent;
      return {
        kind: "week", title: subject.id,
        kicker: parent ? [{ text: parent.id, target: intentionCardLinkTarget(parent.path) }] : [],
        subtitle: intentionCardRangeSubtitle(subject.start, subject.end),
        tile: { band: "WEEK", value: String(Number(match[1])) }, pill,
      };
    }
    if (subject.kind === "quarter") {
      const parent = subject.parent;
      const span = /· (W\d+–W\d+) ·/.exec(String(subject.label || ""))?.[1] || "";
      const range = intentionCardRangeSubtitle(subject.start, subject.end);
      return {
        kind: "quarter", title: subject.id,
        kicker: parent ? [{ text: parent.id, target: intentionCardLinkTarget(parent.path) }] : [],
        subtitle: [span, range].filter(Boolean).join(" · "),
        tile: { band: "QTR", value: String(subject.shortLabel || "") }, pill,
      };
    }
    if (subject.kind === "year") {
      const weeks = /· (\d+) weeks$/.exec(String(subject.label || ""))?.[1] || "";
      const range = intentionCardRangeSubtitle(subject.start, subject.end);
      return {
        kind: "year", title: subject.id,
        kicker: [{ text: "All time", target: "all_time" }],
        subtitle: [range, weeks ? `${weeks} weeks` : ""].filter(Boolean).join(" · "),
        tile: { band: "YEAR", value: String(subject.id) }, pill,
      };
    }
  } catch (_) {}
  return null;
}

// The note's `aliases` (or `alias`) frontmatter, as the kit recognizers take it.
function intentionCardTitleAlias(frontmatter) {
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  if (Object.prototype.hasOwnProperty.call(fm, "aliases") && fm.aliases != null) return fm.aliases;
  if (Object.prototype.hasOwnProperty.call(fm, "alias") && fm.alias != null) return fm.alias;
  return null;
}

// The kit day or period recognizer for this subject's own H1, or null when
// the kit is missing.
function intentionCardTitleRecognizer(subject, frontmatter, todayValue) {
  try {
    if (!subject) return null;
    const today = intentionCardDateParts(todayValue) ? todayValue : subject.today;
    const options = { alias: intentionCardTitleAlias(frontmatter), today };
    if (subject.kind === "day") {
      return typeof propertyCardDayTitleRecognizer === "function" ? propertyCardDayTitleRecognizer(subject, options) : null;
    }
    if (["week", "quarter", "year"].includes(subject.kind)) {
      return typeof propertyCardPeriodTitleRecognizer === "function" ? propertyCardPeriodTitleRecognizer(subject, options) : null;
    }
  } catch (_) {}
  return null;
}

function intentionCardRailPeriodLabel(label) {
  return String(label || "").replace(/^\s*[‹↑]\s*/u, "").replace(/\s*›\s*$/u, "").trim();
}

function intentionCardRailDayItem(link, day, aria) {
  if (!link || !day) return null;
  const weekday = intentionCardWeekdayShort(day.id);
  const parts = intentionCardDateParts(day.id);
  if (!weekday || !parts) return null;
  return {
    label: `${weekday} ${parts.day}`, shortLabel: weekday, target: link.target,
    ariaLabel: `${aria}: ${intentionCardDayTitle(day.id)}`,
  };
}

function intentionCardRailPeriodItem(link, subject, aria) {
  if (!link) return null;
  const label = intentionCardRailPeriodLabel(link.label) || intentionCardRailPeriodLabel(link.target);
  const name = intentionCardSubjectName(subject);
  return { label, shortLabel: label, target: link.target, ariaLabel: name ? `${aria}: ${name}` : aria };
}

// { range, prev, parent, next, children } or null. The rail exists only when
// the recognized source title range holds a recognized nav line, so it never
// duplicates a visible nav line; targets always come from that line's links.
// Children come from the first recognized child-links line in the same range.
function intentionCardRailModel(source, subject, recognizer, todayValue) {
  try {
    if (!subject || !recognizer || typeof propertyCardTitleSourceRange !== "function") return null;
    const today = intentionCardDateParts(todayValue) ? todayValue : subject.today;
    const text = String(source === null || source === undefined ? "" : source);
    const range = propertyCardTitleSourceRange(text, recognizer);
    if (!range) return null;
    const lines = text.split(/\r\n|\r|\n/);
    let navLine = "";
    let childLine = "";
    for (let index = range.fromLine + 1; index <= range.toLine && index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      if (!navLine && intentionCardIsNavigationLine(line, subject, today)) {
        navLine = line;
        continue;
      }
      if (!childLine && intentionCardIsChildLinksLine(line, subject, today)) childLine = line;
    }
    if (!navLine) return null;
    const links = intentionCardLineLinks(navLine);
    const word = INTENTION_CARD_PERIOD_WORDS[subject.kind] || "note";
    let prev = null;
    let parent = null;
    let next = null;
    if (subject.kind === "day") {
      prev = intentionCardRailDayItem(links[0], subject.previous, "Previous day");
      next = intentionCardRailDayItem(links[links.length - 1], subject.next, "Next day");
      const week = subject.parent;
      if (week) {
        // A two-link `prev · next` daily has no parent link: use the week path.
        const target = links.length === 3 ? links[1].target : intentionCardLinkTarget(week.path);
        parent = { label: week.shortLabel, shortLabel: week.shortLabel, target, ariaLabel: `Parent week: ${week.id}` };
      }
    } else {
      prev = intentionCardRailPeriodItem(links[0], subject.previous, `Previous ${word}`);
      next = intentionCardRailPeriodItem(links[2], subject.next, `Next ${word}`);
      parent = subject.kind === "year"
        ? intentionCardRailPeriodItem(links[1], { kind: "all" }, "Parent")
        : intentionCardRailPeriodItem(links[1], subject.parent, `Parent ${subject.parent?.kind || "period"}`);
    }
    const children = childLine
      ? intentionCardLineLinks(childLine).map((link) => {
        const child = intentionCardLinkSubject(link.target, today);
        return { label: link.label, target: link.target, current: Boolean(child && child.state === "current") };
      })
      : [];
    return {
      range: { from: range.from, to: range.to, fromLine: range.fromLine, toLine: range.toLine },
      prev, parent, next, children,
    };
  } catch (_) {
    return null;
  }
}

// The set-intentions ghost: current and future subjects with no intentions.
// Summary or reflection may exist; past subjects never show it.
function intentionCardShowsGhost(model) {
  const state = model?.subject?.state;
  return Boolean((state === "current" || state === "future")
    && Array.isArray(model.intentions) && model.intentions.length === 0);
}
