// Pure intention-card subject, metadata, digest, and source-placement models.
// Paths accepted here mirror bob-cli src/native/intentions/subject.rs.
const INTENTION_CARD_OWNED_KEYS = Object.freeze([
  "intentions",
  "summary",
  "summary_digest",
  "summary_drafted",
  "reflection",
  "review_digest",
  "review_drafted",
]);
const INTENTION_CARD_CHIPS = Object.freeze(["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"]);
const INTENTION_CARD_RECENT_CLOSED_DAYS = 7;
const INTENTION_CARD_LINK_HINT = "Unresolved link · run bob periods list -p";
let intentionCardCrypto = null;
try { intentionCardCrypto = require("crypto"); } catch (_) {}

function intentionCardDateParts(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = intentionCardLocalDate(year, month, day);
  if (!date || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return { year, month, day, text };
}

function intentionCardLocalDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date : null;
}

function intentionCardDateText(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  return String(date.getFullYear()).padStart(4, "0") + "-"
    + String(date.getMonth() + 1).padStart(2, "0") + "-"
    + String(date.getDate()).padStart(2, "0");
}

function intentionCardShiftDate(value, days) {
  const parts = intentionCardDateParts(value);
  if (!parts || !Number.isInteger(days)) return "";
  const date = intentionCardLocalDate(parts.year, parts.month, parts.day);
  date.setDate(date.getDate() + days);
  return intentionCardDateText(date);
}

// Gregorian ordinal arithmetic makes age checks independent of DST offsets.
function intentionCardDateOrdinal(value) {
  const parts = intentionCardDateParts(value);
  if (!parts) return null;
  let year = parts.year;
  let month = parts.month;
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month - 3) + 2) / 5) + parts.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

function intentionCardIsoParts(day) {
  const parts = intentionCardDateParts(day);
  if (!parts || typeof periodNotesIsoWeekYear !== "function") return null;
  return periodNotesIsoWeekYear(intentionCardLocalDate(parts.year, parts.month, parts.day));
}

function intentionCardWeeksInIsoYear(year) {
  if (!Number.isInteger(year) || year < 1970 || year > 2999) return 0;
  const parts = periodNotesIsoWeekYear(intentionCardLocalDate(year, 12, 28));
  return parts && parts.isoYear === year ? parts.week : 0;
}

function intentionCardWeekMonday(year, week) {
  if (typeof periodNotesIsoWeekMonday !== "function") return "";
  return periodNotesIsoWeekMonday(year, week) || "";
}

function intentionCardPeriodState(start, end, today) {
  const startOrdinal = intentionCardDateOrdinal(start);
  const endOrdinal = intentionCardDateOrdinal(end);
  const todayOrdinal = intentionCardDateOrdinal(today);
  if (startOrdinal === null || endOrdinal === null || todayOrdinal === null) return "unknown";
  if (endOrdinal < todayOrdinal) return "closed";
  if (startOrdinal > todayOrdinal) return "future";
  return "current";
}

function intentionCardDayLabel(value, withWeekday = true) {
  const parts = intentionCardDateParts(value);
  if (!parts) return "";
  const date = intentionCardLocalDate(parts.year, parts.month, parts.day);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = months[parts.month - 1] + " " + parts.day;
  return withWeekday ? weekdays[date.getDay()] + " " + label + ", " + parts.year : label;
}

function intentionCardDateRange(start, end) {
  const first = intentionCardDateParts(start);
  const last = intentionCardDateParts(end);
  if (!first || !last) return "";
  if (first.year === last.year && first.month === last.month) {
    return intentionCardDayLabel(start, false) + "–" + last.day;
  }
  if (first.year === last.year) {
    return intentionCardDayLabel(start, false) + " – " + intentionCardDayLabel(end, false);
  }
  return intentionCardDayLabel(start, false) + ", " + first.year + " – "
    + intentionCardDayLabel(end, false) + ", " + last.year;
}

function intentionCardDayInfo(day, today, full) {
  const parts = intentionCardDateParts(day);
  if (!parts) return null;
  const week = intentionCardIsoParts(day);
  if (!week) return null;
  const yearText = String(parts.year).padStart(4, "0");
  const info = {
    kind: "day",
    id: day,
    path: yearText + "/" + yearText + String(parts.month).padStart(2, "0")
      + String(parts.day).padStart(2, "0") + ".md",
    label: intentionCardDayLabel(day, true),
    shortLabel: intentionCardDayLabel(day, false),
    start: day,
    end: day,
    state: intentionCardPeriodState(day, day, today),
  };
  if (full) {
    info.today = today;
    info.parent = intentionCardWeekInfo(week.isoYear, week.week, today, false);
    info.previous = intentionCardDayInfo(intentionCardShiftDate(day, -1), today, false);
    info.next = intentionCardDayInfo(intentionCardShiftDate(day, 1), today, false);
  }
  return info;
}

function intentionCardWeekInfo(year, week, today, full) {
  if (!Number.isInteger(year) || year < 1970 || year > 2999) return null;
  if (!Number.isInteger(week) || week < 1 || week > intentionCardWeeksInIsoYear(year)) return null;
  const start = intentionCardWeekMonday(year, week);
  if (!start) return null;
  const end = intentionCardShiftDate(start, 6);
  const yearText = String(year).padStart(4, "0");
  const id = yearText + "-W" + String(week).padStart(2, "0");
  const info = {
    kind: "week",
    id,
    path: yearText + "/" + id + ".md",
    label: id + " · " + intentionCardDateRange(start, end),
    shortLabel: "W" + String(week).padStart(2, "0"),
    start,
    end,
    state: intentionCardPeriodState(start, end, today),
  };
  if (full) {
    info.today = today;
    const quarter = Math.min(4, Math.floor((week - 1) / 13) + 1);
    info.parent = intentionCardQuarterInfo(year, quarter, today, false);
    info.previous = week > 1
      ? intentionCardWeekInfo(year, week - 1, today, false)
      : intentionCardWeekInfo(year - 1, intentionCardWeeksInIsoYear(year - 1), today, false);
    info.next = week < intentionCardWeeksInIsoYear(year)
      ? intentionCardWeekInfo(year, week + 1, today, false)
      : intentionCardWeekInfo(year + 1, 1, today, false);
  }
  return info;
}

function intentionCardQuarterInfo(year, quarter, today, full) {
  if (!Number.isInteger(year) || year < 1970 || year > 2999) return null;
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  const firstWeek = (quarter - 1) * 13 + 1;
  const lastWeek = quarter === 4 ? intentionCardWeeksInIsoYear(year) : quarter * 13;
  const start = intentionCardWeekMonday(year, firstWeek);
  const endMonday = intentionCardWeekMonday(year, lastWeek);
  if (!start || !endMonday) return null;
  const end = intentionCardShiftDate(endMonday, 6);
  const yearText = String(year).padStart(4, "0");
  const id = yearText + "-Q" + quarter;
  const info = {
    kind: "quarter",
    id,
    path: yearText + "/" + id + ".md",
    label: id + " · W" + firstWeek + "–W" + lastWeek + " · " + intentionCardDateRange(start, end),
    shortLabel: "Q" + quarter,
    start,
    end,
    state: intentionCardPeriodState(start, end, today),
  };
  if (full) {
    info.today = today;
    info.parent = intentionCardYearInfo(year, today, false);
    info.previous = quarter > 1
      ? intentionCardQuarterInfo(year, quarter - 1, today, false)
      : intentionCardQuarterInfo(year - 1, 4, today, false);
    info.next = quarter < 4
      ? intentionCardQuarterInfo(year, quarter + 1, today, false)
      : intentionCardQuarterInfo(year + 1, 1, today, false);
  }
  return info;
}

function intentionCardYearInfo(year, today, full) {
  if (!Number.isInteger(year) || year < 1970 || year > 2999) return null;
  const weeks = intentionCardWeeksInIsoYear(year);
  const start = intentionCardWeekMonday(year, 1);
  const lastMonday = intentionCardWeekMonday(year, weeks);
  if (!weeks || !start || !lastMonday) return null;
  const end = intentionCardShiftDate(lastMonday, 6);
  const yearText = String(year).padStart(4, "0");
  const info = {
    kind: "year",
    id: yearText,
    path: yearText + ".md",
    label: yearText + " · " + intentionCardDateRange(start, end) + " · " + weeks + " weeks",
    shortLabel: yearText,
    start,
    end,
    state: intentionCardPeriodState(start, end, today),
    parent: null,
  };
  if (full) {
    info.today = today;
    info.previous = intentionCardYearInfo(year - 1, today, false);
    info.next = intentionCardYearInfo(year + 1, today, false);
  }
  return info;
}

function intentionCardPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

function intentionCardSubjectForPath(value, todayValue) {
  const path = intentionCardPath(value);
  const today = intentionCardDateParts(todayValue) ? todayValue : dayStripLocalToday(new Date());
  if (!path || path.startsWith("/") || path.split("/").length > 2) return null;
  const withoutExtension = path.replace(/\.md$/i, "");
  const dayMatch = /^(\d{4})\/(\d{8})$/.exec(withoutExtension);
  if (dayMatch && dayMatch[1] === dayMatch[2].slice(0, 4)) {
    const date = dayMatch[2].slice(0, 4) + "-" + dayMatch[2].slice(4, 6) + "-" + dayMatch[2].slice(6, 8);
    if (intentionCardDateParts(date)) return intentionCardDayInfo(date, today, true);
    return null;
  }
  const periodPath = /\.md$/i.test(path) ? path : path + ".md";
  const parsed = typeof periodNotesPeriodForPath === "function"
    ? periodNotesPeriodForPath(periodPath) : null;
  if (!parsed || parsed.kind === "all") return null;
  if (parsed.kind === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(parsed.id);
    return match ? intentionCardWeekInfo(Number(match[1]), Number(match[2]), today, true) : null;
  }
  if (parsed.kind === "quarter") {
    const match = /^(\d{4})-Q([1-4])$/.exec(parsed.id);
    return match ? intentionCardQuarterInfo(Number(match[1]), Number(match[2]), today, true) : null;
  }
  if (parsed.kind === "year" && /^\d{4}$/.test(parsed.id)) {
    return intentionCardYearInfo(Number(parsed.id), today, true);
  }
  return null;
}

function intentionCardDigest(value) {
  const text = String(value === null || value === undefined ? "" : value);
  const normalized = text.replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.replace(/\s+$/u, "")).join("\n").trim();
  if (!intentionCardCrypto || typeof intentionCardCrypto.createHash !== "function") return "";
  return "sha256:" + intentionCardCrypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

function intentionCardDateStamp(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return String(value.getUTCFullYear()).padStart(4, "0") + "-"
      + String(value.getUTCMonth() + 1).padStart(2, "0") + "-"
      + String(value.getUTCDate()).padStart(2, "0");
  }
  const text = String(value || "");
  return intentionCardDateParts(text) ? text : null;
}

function intentionCardEmpty(value) {
  return value === undefined || value === null || value === "";
}

function intentionCardReadFields(frontmatter) {
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  const own = (key) => Object.prototype.hasOwnProperty.call(fm, key);
  const invalid = (key, reason) => ({ ok: false, key, reason });
  let intentions = [];
  if (own("intentions") && !intentionCardEmpty(fm.intentions)) {
    if (!Array.isArray(fm.intentions)) return invalid("intentions", "expected-list");
    for (const value of fm.intentions) {
      if (typeof value !== "string" || !value.trim()
        || value !== value.trim() || /[\r\n\u2028\u2029]/u.test(value)) {
        return invalid("intentions", "expected-nonempty-trimmed-lines");
      }
    }
    intentions = fm.intentions.slice();
  }

  let summary = "";
  if (own("summary") && !intentionCardEmpty(fm.summary)) {
    if (typeof fm.summary !== "string" || /[\r\n\u2028\u2029]/u.test(fm.summary)) {
      return invalid("summary", "expected-one-line-string");
    }
    summary = fm.summary.trim() ? fm.summary : "";
  }

  let reflection = "";
  if (own("reflection") && !intentionCardEmpty(fm.reflection)) {
    if (typeof fm.reflection !== "string") return invalid("reflection", "expected-string");
    reflection = fm.reflection.trim() ? fm.reflection : "";
  }

  const readDigest = (key) => {
    if (!own(key) || intentionCardEmpty(fm[key])) return { ok: true, value: "" };
    return typeof fm[key] === "string" && /^sha256:[0-9a-f]{16}$/.test(fm[key])
      ? { ok: true, value: fm[key] }
      : { ok: false, value: "" };
  };
  const readDate = (key) => {
    if (!own(key) || intentionCardEmpty(fm[key])) return { ok: true, value: "" };
    const value = intentionCardDateStamp(fm[key]);
    return value ? { ok: true, value } : { ok: false, value: "" };
  };
  const summaryDigest = readDigest("summary_digest");
  if (!summaryDigest.ok) return invalid("summary_digest", "invalid-stamp");
  const summaryDrafted = readDate("summary_drafted");
  if (!summaryDrafted.ok) return invalid("summary_drafted", "invalid-stamp");
  const reviewDigest = readDigest("review_digest");
  if (!reviewDigest.ok) return invalid("review_digest", "invalid-stamp");
  const reviewDrafted = readDate("review_drafted");
  if (!reviewDrafted.ok) return invalid("review_drafted", "invalid-stamp");

  return {
    ok: true,
    intentions,
    summary,
    summaryDigest: summaryDigest.value,
    summaryDrafted: summaryDrafted.value,
    reflection,
    reviewDigest: reviewDigest.value,
    reviewDrafted: reviewDrafted.value,
    summaryState: !summary ? "empty"
      : summaryDigest.value && summaryDigest.value === intentionCardDigest(summary) ? "agent" : "edited",
  };
}

function intentionCardParseFrontmatter(source) {
  const text = String(source === null || source === undefined ? "" : source).replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\r|\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    return { ok: true, hasFrontmatter: false, frontmatter: {} };
  }
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---" || lines[index].trim() === "...") {
      end = index;
      break;
    }
  }
  if (end < 0) return { ok: false, reason: "unclosed-frontmatter" };
  const yaml = lines.slice(1, end).join("\n");
  const owned = new Set(INTENTION_CARD_OWNED_KEYS);
  const seen = new Set();
  const keyPattern = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w-]*))\s*:/;
  for (const line of lines.slice(1, end)) {
    const match = keyPattern.exec(line);
    const key = match ? match[1] || match[2] || match[3] : "";
    if (!owned.has(key)) continue;
    if (seen.has(key)) return { ok: false, reason: "duplicate-owned-key" };
    seen.add(key);
  }
  if (typeof parseYaml !== "function") return { ok: false, reason: "yaml-parser-unavailable" };
  let parsed = null;
  try { parsed = parseYaml(yaml); } catch (_) { return { ok: false, reason: "malformed-yaml" }; }
  if (parsed === null || parsed === undefined) parsed = {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "frontmatter-not-mapping" };
  return { ok: true, hasFrontmatter: true, frontmatter: parsed };
}

function intentionCardStableValue(value) {
  if (value instanceof Date) return { date: intentionCardDateStamp(value) };
  if (Array.isArray(value)) return value.map(intentionCardStableValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = intentionCardStableValue(value[key]);
    return out;
  }
  return value;
}

function intentionCardFrontmatterEvidence(source, cachedFrontmatter) {
  const parsed = intentionCardParseFrontmatter(source);
  if (!parsed.ok) return parsed;
  const cached = cachedFrontmatter && typeof cachedFrontmatter === "object" && !Array.isArray(cachedFrontmatter)
    ? cachedFrontmatter : {};
  for (const key of INTENTION_CARD_OWNED_KEYS) {
    const sourceHas = Object.prototype.hasOwnProperty.call(parsed.frontmatter, key);
    const cacheHas = Object.prototype.hasOwnProperty.call(cached, key);
    if (sourceHas !== cacheHas) return { ok: false, reason: "stale-metadata-cache", key };
    if (sourceHas && JSON.stringify(intentionCardStableValue(parsed.frontmatter[key]))
      !== JSON.stringify(intentionCardStableValue(cached[key]))) {
      return { ok: false, reason: "stale-metadata-cache", key };
    }
  }
  return { ok: true, hasFrontmatter: parsed.hasFrontmatter, frontmatter: parsed.frontmatter };
}

function intentionCardLinkPath(target) {
  const text = String(target || "").trim();
  const inner = text.startsWith("[[") && text.endsWith("]]") ? text.slice(2, -2) : text;
  const path = inner.split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
  if (!path) return "";
  const period = /^(\d{4})-W(\d{2})$/i.exec(path);
  if (period) return period[1] + "/" + period[1] + "-W" + period[2] + ".md";
  const quarter = /^(\d{4})-Q([1-4])$/i.exec(path);
  if (quarter) return quarter[1] + "/" + quarter[1] + "-Q" + quarter[2] + ".md";
  if (/^\d{4}$/.test(path)) return path + ".md";
  return /\.md$/i.test(path) ? path : path + ".md";
}

function intentionCardLineLinks(line) {
  const text = String(line || "");
  const links = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match = null;
  while ((match = regex.exec(text))) {
    const body = match[1];
    const parts = body.split("|");
    links.push({
      raw: match[0],
      target: (parts[0] || "").trim(),
      label: (parts.length > 1 ? parts.slice(1).join("|") : parts[0] || "").trim(),
    });
  }
  return links;
}

function intentionCardLineIsOnlyLinks(line, links) {
  if (!links.length) return false;
  const remainder = String(line || "").replace(/\[\[[^\]]+\]\]/g, "");
  return /^[\s·|,;]*$/.test(remainder);
}

function intentionCardLinkSubject(target, today) {
  const link = String(target || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
  if (link === "all_time" || link === "all_time.md") return { kind: "all", path: "all_time.md" };
  return intentionCardSubjectForPath(intentionCardLinkPath(target), today);
}

function intentionCardIsNavigationLine(line, subject, today) {
  if (!subject) return false;
  const links = intentionCardLineLinks(line);
  if (!intentionCardLineIsOnlyLinks(line, links)) return false;
  const resolved = links.map((link) => intentionCardLinkSubject(link.target, today));
  if (subject.kind === "day") {
    if (links.length === 2) {
      return resolved[0]?.path === subject.previous?.path
        && resolved[1]?.path === subject.next?.path
        && links[0].label.toLowerCase() === "prev"
        && links[1].label.toLowerCase() === "next";
    }
    return links.length === 3
      && resolved[0]?.path === subject.previous?.path
      && resolved[1]?.path === subject.parent?.path
      && resolved[2]?.path === subject.next?.path;
  }
  if (subject.kind === "year") {
    return links.length === 3
      && resolved[0]?.path === subject.previous?.path
      && resolved[1]?.kind === "all"
      && resolved[2]?.path === subject.next?.path;
  }
  return links.length === 3
    && resolved[0]?.path === subject.previous?.path
    && resolved[1]?.path === subject.parent?.path
    && resolved[2]?.path === subject.next?.path;
}

function intentionCardIsDirectChild(child, subject) {
  if (!child || !subject) return false;
  if (subject.kind === "week" && child.kind === "day") {
    const ordinal = intentionCardDateOrdinal(child.start);
    return ordinal >= intentionCardDateOrdinal(subject.start) && ordinal <= intentionCardDateOrdinal(subject.end);
  }
  if (subject.kind === "quarter" && child.kind === "week") return child.parent?.id === subject.id;
  if (subject.kind === "year" && child.kind === "quarter") return child.parent?.id === subject.id;
  return false;
}

function intentionCardIsChildLinksLine(line, subject, today) {
  if (!subject || !["week", "quarter", "year"].includes(subject.kind)) return false;
  const links = intentionCardLineLinks(line);
  if (!intentionCardLineIsOnlyLinks(line, links)) return false;
  return links.every((link) => intentionCardIsDirectChild(intentionCardLinkSubject(link.target, today), subject));
}

function intentionCardPlacement(source, subject, todayValue) {
  const today = intentionCardDateParts(todayValue) ? todayValue
    : subject && subject.today ? subject.today : dayStripLocalToday(new Date());
  const text = String(source === null || source === undefined ? "" : source).replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\r|\n/);
  let index = lines[0]?.trim() === "---" ? -1 : 0;
  if (index < 0) {
    for (let cursor = 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() === "---" || lines[cursor].trim() === "...") {
        index = cursor + 1;
        break;
      }
    }
    if (index < 0) return null;
  }
  let fence = "";
  let headingLine = -1;
  const fenceMatch = (line) => /^\s{0,3}(\x60{3,}|~{3,})/.exec(line);
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    const opening = fenceMatch(lines[cursor]);
    if (opening) {
      const mark = opening[1][0];
      if (!fence) fence = mark;
      else if (fence === mark) fence = "";
      continue;
    }
    if (!fence && /^#\s+\S/.test(lines[cursor].trim())) {
      headingLine = cursor;
      break;
    }
  }
  // No unfenced H1 (the H1-less 2024 and 2025 dailies, a legacy year note):
  // the card goes before the first non-blank body line, and nothing is skipped.
  if (headingLine < 0) {
    let first = index;
    while (first < lines.length && !lines[first].trim()) first += 1;
    return { headingLine: -1, insertBeforeLine: first < lines.length ? first : lines.length, skippedLines: 0 };
  }
  let cursor = headingLine + 1;
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) {
      cursor += 1;
      continue;
    }
    if (intentionCardIsNavigationLine(lines[cursor].trim(), subject, today)) {
      cursor += 1;
      continue;
    }
    if (intentionCardIsChildLinksLine(lines[cursor].trim(), subject, today)) {
      cursor += 1;
      continue;
    }
    break;
  }
  return {
    headingLine,
    insertBeforeLine: cursor < lines.length ? cursor : lines.length,
    skippedLines: Math.max(0, cursor - headingLine - 1),
  };
}

function intentionCardMissingBands(subject, fields, today) {
  if (!subject || subject.state !== "closed" || !fields || fields.intentions.length === 0) return null;
  const todayOrdinal = intentionCardDateOrdinal(today);
  const endOrdinal = intentionCardDateOrdinal(subject.end);
  if (todayOrdinal === null || endOrdinal === null) return null;
  const age = todayOrdinal - endOrdinal;
  if (age < 1 || age > INTENTION_CARD_RECENT_CLOSED_DAYS) return null;
  return { summary: !fields.summary, reflection: !fields.reflection };
}

function intentionCardModelFor(path, frontmatter, todayValue, parentFrontmatter) {
  const today = intentionCardDateParts(todayValue) ? todayValue : dayStripLocalToday(new Date());
  const subject = intentionCardSubjectForPath(path, today);
  if (!subject) return null;
  const fields = intentionCardReadFields(frontmatter);
  // Malformed owned fields fail open to native rendering. Empty fields still
  // get a model: the day or period card always mounts with its identity.
  if (!fields.ok) return null;
  let parentIntentions = [];
  if (subject.parent && parentFrontmatter) {
    const parentFields = intentionCardReadFields(parentFrontmatter);
    if (parentFields.ok) parentIntentions = parentFields.intentions;
  }
  const missingBands = intentionCardMissingBands(subject, fields, today);
  return {
    subject,
    path: subject.path,
    kind: subject.kind,
    label: subject.label,
    intentions: fields.intentions,
    summary: fields.summary,
    summaryState: fields.summaryState,
    summaryDrafted: fields.summaryDrafted,
    reflection: fields.reflection,
    parentIntentions,
    missingBands,
    hasContent: Boolean(fields.intentions.length || fields.summary || fields.reflection),
  };
}
