// Property-card identity kit (bob-cli-o6 identity-kit): the recognized source
// title block and its recognizers. Pure: no DOM, no CodeMirror. A card that
// owns the title hides exactly this range at render time (never bytes): the
// first body H1 when it is redundant with the card title, plus following
// blank lines and recognized nav or child-link lines. The first unrelated
// non-blank body line stays outside the range. The first non-blank body line
// must start the block, so a fenced, late, or after-prose H1 stays visible.

const PROPERTY_CARD_TITLE_H1 = /^ {0,3}#[ \t]+\S/;
const PROPERTY_CARD_TITLE_WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
const PROPERTY_CARD_TITLE_MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

// Wikilinks become their label, backslash escapes unescape, whitespace
// collapses. Shared by headings, aliases, and Reading line text.
function propertyCardCleanInlineText(raw) {
  return String(raw === null || raw === undefined ? "" : raw)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip the ATX marker and an optional closing # run, then clean inline text.
function propertyCardCleanHeadingText(raw) {
  const text = String(raw === null || raw === undefined ? "" : raw)
    .replace(/^﻿/, "")
    .replace(/^ {0,3}#{1,6}(?=[ \t]|$)/, "")
    .replace(/(^|[ \t])#+[ \t]*$/, "$1");
  return propertyCardCleanInlineText(text);
}

function propertyCardTitleFold(value) {
  return propertyCardCleanInlineText(value).toLowerCase();
}

// Core scan. lineAt(i) -> { text, from, to } for 0-based line i with document
// offsets; lineCount bounds the scan. Stops at the first non-follower line,
// so Live Preview never stringifies a large note. Returns
// { from, to, fromLine, toLine, headingLine, title, nextLine } or null.
function propertyCardTitleSourceRangeFromLines(lineAt, lineCount, recognizer) {
  try {
    if (typeof lineAt !== "function" || !recognizer || typeof recognizer !== "object") return null;
    const count = Number(lineCount);
    if (!Number.isInteger(count) || count < 1) return null;
    const line = (index) => {
      const value = lineAt(index) || {};
      return { text: String(value.text === null || value.text === undefined ? "" : value.text), from: value.from, to: value.to };
    };
    let index = 0;
    const first = line(0);
    if (first.text.replace(/^﻿/, "").trim() === "---") {
      index = -1;
      for (let cursor = 1; cursor < count; cursor += 1) {
        const text = line(cursor).text.trim();
        if (text === "---" || text === "...") {
          index = cursor + 1;
          break;
        }
      }
      if (index < 0) return null;
    }
    while (index < count && !line(index).text.replace(/^﻿/, "").trim()) index += 1;
    if (index >= count) return null;
    const start = line(index);
    const startText = index === 0 ? start.text.replace(/^﻿/, "") : start.text;
    let headingLine = -1;
    let title = "";
    if (PROPERTY_CARD_TITLE_H1.test(startText)) {
      const cleaned = propertyCardCleanHeadingText(startText);
      if (typeof recognizer.heading === "function" && recognizer.heading(cleaned, startText) === true) {
        headingLine = index;
        title = cleaned;
      }
    }
    if (headingLine < 0) {
      const followerStart = recognizer.requireHeading === false
        && typeof recognizer.follower === "function"
        && recognizer.follower(startText.trim(), index) === true;
      if (!followerStart) return null;
    }
    const fromLine = index;
    let toLine = index;
    for (let cursor = index + 1; cursor < count; cursor += 1) {
      const trimmed = line(cursor).text.trim();
      if (!trimmed) {
        toLine = cursor;
        continue;
      }
      if (typeof recognizer.follower === "function" && recognizer.follower(trimmed, cursor) === true) {
        toLine = cursor;
        continue;
      }
      break;
    }
    const from = start.from;
    const to = line(toLine).to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
    return { from, to, fromLine, toLine, headingLine, title, nextLine: toLine + 1 };
  } catch (_) {
    return null;
  }
}

// String wrapper with \n, \r\n, or \r separators and exact offsets.
function propertyCardTitleSourceRange(text, recognizer) {
  const source = String(text === null || text === undefined ? "" : text);
  const lines = [];
  const separator = /\r\n|\r|\n/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(source))) {
    lines.push({ text: source.slice(cursor, match.index), from: cursor, to: match.index });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: source.slice(cursor), from: cursor, to: source.length });
  return propertyCardTitleSourceRangeFromLines((index) => lines[index], lines.length, recognizer);
}

// Inclusive touch rule shared with recordWalkSelectionTouches: some range
// satisfies min <= range.to && max >= range.from. Accepts a CodeMirror
// selection, an EditorState, or a plain { ranges: [{ from, to }] }.
function propertyCardSelectionTouches(selection, range) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return false;
  const ranges = selection?.ranges || selection?.selection?.ranges || [];
  try {
    return Array.from(ranges).some((item) => {
      const a = item?.from ?? item?.anchor;
      const b = item?.to ?? item?.head;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return Math.min(a, b) <= range.to && Math.max(a, b) >= range.from;
    });
  } catch (_) {
    return false;
  }
}

function propertyCardNeverTitleRecognizer(kind) {
  return Object.freeze({
    key: `never:${kind}`,
    requireHeading: true,
    heading: () => false,
    follower: () => false,
  });
}

function propertyCardFirstAlias(alias) {
  const list = Array.isArray(alias) ? alias : [alias];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const cleaned = propertyCardCleanInlineText(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function propertyCardTitleDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, weekday: PROPERTY_CARD_TITLE_WEEKDAYS[date.getUTCDay()] };
}

// bob's period range label (bob-cli periods/labels.rs): `Nov 16 – 22`,
// `Oct 26 – Nov 1`, or `Dec 28, 2026 – Jan 3, 2027`.
function propertyCardPeriodRangeLabel(start, end) {
  const a = propertyCardTitleDateParts(start);
  const b = propertyCardTitleDateParts(end);
  if (!a || !b) return "";
  const month = (parts) => PROPERTY_CARD_TITLE_MONTHS[parts.month - 1];
  if (a.year !== b.year) return `${month(a)} ${a.day}, ${a.year} – ${month(b)} ${b.day}, ${b.year}`;
  if (a.month !== b.month) return `${month(a)} ${a.day} – ${month(b)} ${b.day}`;
  return `${month(a)} ${a.day} – ${b.day}`;
}

// bob's scaffold title for a period subject (the H1 and first alias it
// writes): `2026-W47 · Nov 16 – 22`, `2026-Q4 · W40–W53 · Sep 28, 2026 –
// Jan 3, 2027`, or `2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks`.
function propertyCardPeriodScaffoldTitle(subject) {
  try {
    if (!subject || !subject.id) return "";
    const range = propertyCardPeriodRangeLabel(subject.start, subject.end);
    if (!range) return "";
    if (subject.kind === "week") return `${subject.id} · ${range}`;
    if (subject.kind === "quarter") {
      const weeks = /W(\d+)–W(\d+)/.exec(String(subject.label || ""));
      return weeks ? `${subject.id} · W${weeks[1]}–W${weeks[2]} · ${range}` : "";
    }
    if (subject.kind === "year") {
      const weeks = /· (\d+) weeks$/.exec(String(subject.label || ""));
      return weeks ? `${subject.id} · ${range} · ${weeks[1]} weeks` : "";
    }
  } catch (_) {}
  return "";
}

// Home (area/project): the first-body H1 whose cleaned text equals the card
// title. No followers, so the range never consumes a following `^prj` line.
function propertyCardHomeTitleRecognizer(title) {
  const want = propertyCardCleanInlineText(title);
  if (!want) return propertyCardNeverTitleRecognizer("home");
  return Object.freeze({
    key: `home:${want}`,
    requireHeading: true,
    heading: (cleaned) => propertyCardCleanInlineText(cleaned) === want,
    follower: () => false,
  });
}

// Album: the first H1 whose cleaned text equals the card title. No followers.
function propertyCardAlbumTitleRecognizer(title) {
  const want = propertyCardCleanInlineText(title);
  if (!want) return propertyCardNeverTitleRecognizer("album");
  return Object.freeze({
    key: `album:${want}`,
    requireHeading: true,
    heading: (cleaned) => propertyCardCleanInlineText(cleaned) === want,
    follower: () => false,
  });
}

// Day: an H1 equal to the first alias or one of this date's shapes
// (`YYYY-MM-DD ddd`, `Day: YYYY-MM-DD ddd`, `day = YYYY-MM-DD.ddd`),
// case-insensitively; followers are the daily nav line forms.
function propertyCardDayTitleRecognizer(subject, options = {}) {
  if (!subject || subject.kind !== "day" || typeof intentionCardIsNavigationLine !== "function") {
    return propertyCardNeverTitleRecognizer("day");
  }
  const date = String(subject.id || subject.start || "");
  const parts = propertyCardTitleDateParts(date);
  if (!parts) return propertyCardNeverTitleRecognizer("day");
  const today = options?.today || subject.today;
  const accepted = new Set([
    `${date} ${parts.weekday}`,
    `Day: ${date} ${parts.weekday}`,
    `day = ${date}.${parts.weekday}`,
  ].map(propertyCardTitleFold));
  const alias = propertyCardFirstAlias(options?.alias);
  if (alias) accepted.add(propertyCardTitleFold(alias));
  return Object.freeze({
    key: `day:${date}`,
    requireHeading: true,
    heading: (cleaned) => accepted.has(propertyCardTitleFold(cleaned)),
    follower: (line) => {
      try { return intentionCardIsNavigationLine(line, subject, today) === true; } catch (_) { return false; }
    },
  });
}

// Week, quarter, or year: an H1 equal to the first alias or bob's scaffold
// title (which is also the scaffold alias); followers are the period nav line
// and the child-links line.
function propertyCardPeriodTitleRecognizer(subject, options = {}) {
  const kinds = ["week", "quarter", "year"];
  if (!subject || !kinds.includes(subject.kind) || !subject.id
    || typeof intentionCardIsNavigationLine !== "function"
    || typeof intentionCardIsChildLinksLine !== "function") {
    return propertyCardNeverTitleRecognizer(kinds.includes(subject?.kind) ? subject.kind : "period");
  }
  const today = options?.today || subject.today;
  const accepted = new Set();
  const alias = propertyCardFirstAlias(options?.alias);
  if (alias) accepted.add(propertyCardTitleFold(alias));
  const scaffold = propertyCardPeriodScaffoldTitle(subject);
  if (scaffold) accepted.add(propertyCardTitleFold(scaffold));
  if (subject.label) accepted.add(propertyCardTitleFold(subject.label));
  return Object.freeze({
    key: `${subject.kind}:${subject.id}`,
    requireHeading: true,
    heading: (cleaned) => accepted.has(propertyCardTitleFold(cleaned)),
    follower: (line) => {
      try {
        return intentionCardIsNavigationLine(line, subject, today) === true
          || intentionCardIsChildLinksLine(line, subject, today) === true;
      } catch (_) {
        return false;
      }
    },
  });
}
