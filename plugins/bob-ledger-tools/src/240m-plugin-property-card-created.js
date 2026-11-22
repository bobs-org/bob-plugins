// Pure created-stamp formatter shared by property-card adapters. The caller
// supplies the value and, when available, its confirmed source scalar so YAML
// date-only syntax is not confused with a timestamp converted by Obsidian.
const PROPERTY_CARD_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const PROPERTY_CARD_CREATED_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i;

function propertyCardCalendarEpoch(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, millisecond);
  return value.getTime();
}

function propertyCardValidCalendarParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23
    || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const probe = new Date(propertyCardCalendarEpoch(year, month, day, hour, minute, second));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() + 1 === month
    && probe.getUTCDate() === day && probe.getUTCHours() === hour
    && probe.getUTCMinutes() === minute && probe.getUTCSeconds() === second;
}

function propertyCardZoneName(zone) {
  const requested = typeof zone === "string" && zone.trim()
    ? zone.trim()
    : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: requested }).format(0);
    return requested;
  } catch (_) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
}

function propertyCardPartsInZone(date, zone) {
  const rows = new Intl.DateTimeFormat("en-US-u-hc-h23", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const parts = Object.create(null);
  for (const row of rows) if (row.type !== "literal") parts[row.type] = Number(row.value);
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function propertyCardZoneWallEpoch(parts) {
  return propertyCardCalendarEpoch(parts.year, parts.month, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

function propertyCardLocalWallTimeEpoch(parts, zone) {
  const wanted = propertyCardZoneWallEpoch(parts);
  let guess = wanted;
  // Resolve a wall-clock timestamp in the viewer zone without relying on the
  // process zone. Iteration also follows offset changes near DST boundaries.
  for (let i = 0; i < 5; i += 1) {
    const probe = new Date(guess);
    const localAsUtc = propertyCardZoneWallEpoch(propertyCardPartsInZone(probe, zone));
    const offset = localAsUtc - (guess - (guess % 1000));
    const next = wanted - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function propertyCardUnquoteYamlScalar(value) {
  let text = String(value == null ? "" : value).trim();
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
    } else if (quote === "'") {
      if (char === "'" && text[i + 1] === "'") i += 1;
      else if (char === "'") quote = "";
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      text = text.slice(0, i).trimEnd();
      break;
    }
  }
  if (text.length >= 2 && text[0] === "\"" && text[text.length - 1] === "\"") {
    try { return JSON.parse(text); } catch (_) { return text.slice(1, -1); }
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function propertyCardParseCreatedDate(value, sourceScalar, zone) {
  const sourceText = typeof sourceScalar === "string" ? propertyCardUnquoteYamlScalar(sourceScalar) : "";
  const sourceDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceText);
  if (sourceDateOnly) {
    const year = Number(sourceDateOnly[1]);
    const month = Number(sourceDateOnly[2]);
    const day = Number(sourceDateOnly[3]);
    if (!propertyCardValidCalendarParts(year, month, day)) return null;
    return { dateOnly: true, calendar: { year, month, day }, raw: String(sourceScalar).trim() };
  }

  // Prefer confirmed source syntax for YAML Date objects. Obsidian's YAML
  // parser can turn both date-only and timestamp scalars into Date instances.
  const input = value instanceof Date && sourceText ? sourceText : value;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return { dateOnly: false, instant: new Date(input.getTime()), raw: String(sourceScalar || input.toISOString()).trim() };
  }
  if (typeof input !== "string") return null;
  const text = input.trim();
  const match = PROPERTY_CARD_CREATED_STAMP_RE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = hasTime && match[6] ? Number(match[6]) : 0;
  const millis = hasTime && match[7] ? Number((match[7] + "000").slice(0, 3)) : 0;
  if (!propertyCardValidCalendarParts(year, month, day, hour, minute, second)) return null;
  if (!hasTime) return { dateOnly: true, calendar: { year, month, day }, raw: String(sourceScalar || text).trim() };

  let instantMs;
  const offsetText = match[8] || "";
  const wallParts = { year, month, day, hour, minute, second };
  if (/^Z$/i.test(offsetText)) {
    instantMs = propertyCardCalendarEpoch(year, month, day, hour, minute, second, millis);
  } else if (offsetText) {
    const offsetMatch = /^([+-])(\d{2}):?(\d{2})$/.exec(offsetText);
    if (!offsetMatch) return null;
    const offsetHour = Number(offsetMatch[2]);
    const offsetMinute = Number(offsetMatch[3]);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetMs = sign * (offsetHour * 60 + offsetMinute) * 60_000;
    instantMs = propertyCardCalendarEpoch(year, month, day, hour, minute, second, millis) - offsetMs;
  } else {
    instantMs = propertyCardLocalWallTimeEpoch(wallParts, zone) + millis;
  }
  const instant = new Date(instantMs);
  if (Number.isNaN(instant.getTime())) return null;
  return { dateOnly: false, instant, raw: String(sourceScalar || text).trim() };
}

function propertyCardCalendarForCreated(parsed, zone) {
  return parsed.dateOnly ? parsed.calendar : propertyCardPartsInZone(parsed.instant, zone);
}

function propertyCardCreatedAge(createdParts, nowParts) {
  const createdDay = Math.floor(propertyCardZoneWallEpoch({ ...createdParts, hour: 0, minute: 0, second: 0 }) / 86_400_000);
  const nowDay = Math.floor(propertyCardZoneWallEpoch({ ...nowParts, hour: 0, minute: 0, second: 0 }) / 86_400_000);
  const days = nowDay - createdDay;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  return days > 0 ? `${days} days ago` : `in ${-days} days`;
}

function propertyCardCreatedDateText(parts, includeYear) {
  const date = `${PROPERTY_CARD_MONTHS[parts.month - 1]} ${parts.day}`;
  return includeYear ? `${date}, ${parts.year}` : date;
}

function propertyCardCreatedTimeText(date, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
}

function propertyCardFormatCreatedStamp(input = {}) {
  const options = input && typeof input === "object" ? input : {};
  const kind = String(options.kind || "").toLowerCase();
  const verb = kind === "record" ? "added" : "created";
  const temporal = options.temporal === true || ["day", "week", "quarter", "year"].includes(kind);
  const present = options.present === undefined
    ? Object.prototype.hasOwnProperty.call(options, "value") && options.value !== undefined
    : options.present === true;
  if (!present) return { text: temporal ? "" : "no created date", tooltip: "", state: "missing", dateOnly: false };

  const zone = propertyCardZoneName(options.timeZone);
  const parsed = propertyCardParseCreatedDate(options.value, options.sourceScalar, zone);
  if (!parsed) {
    const raw = typeof options.sourceScalar === "string" && options.sourceScalar.trim()
      ? options.sourceScalar.trim()
      : options.value instanceof Date ? String(options.value) : String(options.value);
    return { text: `${verb} ⚠`, tooltip: `Invalid created value: ${raw}`, state: "invalid", dateOnly: false };
  }

  const nowValue = typeof options.clock === "function" ? options.clock() : options.now;
  const now = nowValue instanceof Date && !Number.isNaN(nowValue.getTime()) ? nowValue : new Date();
  const nowParts = propertyCardPartsInZone(now, zone);
  const dateParts = propertyCardCalendarForCreated(parsed, zone);
  const age = propertyCardCreatedAge(dateParts, nowParts);
  const raw = parsed.raw || String(options.value);
  const tooltip = `${raw} · ${age}`;
  const earlierYear = dateParts.year < nowParts.year;
  const dateText = propertyCardCreatedDateText(dateParts, earlierYear);
  const timeText = parsed.dateOnly ? "" : propertyCardCreatedTimeText(parsed.instant, zone);
  const noteDate = typeof options.noteDate === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.noteDate.trim())
    : null;
  const represented = noteDate
    ? { year: Number(noteDate[1]), month: Number(noteDate[2]), day: Number(noteDate[3]) }
    : options.noteDate instanceof Date && !Number.isNaN(options.noteDate.getTime())
      ? propertyCardPartsInZone(options.noteDate, zone)
      : null;
  const sameDayNote = kind === "day" && represented
    && represented.year === dateParts.year && represented.month === dateParts.month && represented.day === dateParts.day;

  let text;
  if (temporal) {
    if (sameDayNote && !parsed.dateOnly) text = `${verb} ${timeText}`;
    else text = `${verb} ${dateText}${timeText ? `, ${timeText}` : ""}`;
  } else if (age === "today" || age === "yesterday") {
    text = `${verb} ${age}${timeText ? `, ${timeText}` : ""}`;
  } else {
    text = `${verb} ${dateText}`;
  }
  return { text, tooltip, state: "ok", dateOnly: parsed.dateOnly };
}
