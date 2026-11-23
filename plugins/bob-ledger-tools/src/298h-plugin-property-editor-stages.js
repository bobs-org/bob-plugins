// Property editor typed values (bob-cli-pf.4.1.3). The editor owns only the
// stage UI and draft conversion; every value still previews and writes through
// the guarded props session.
const PROPERTY_EDITOR_STAGE_WIRE_KINDS = new Set([
  "text", "number", "date", "datetime", "list", "tags", "aliases",
]);

function propertyEditorStageKindForRow(row) {
  if (!row || propertyEditorRoleOf(row) !== "loose" || row.pending === true || row.opaque === true) return null;
  switch (String(row.kind || "").toLowerCase()) {
    case "text":
    case "null": return "text";
    case "number": return "number";
    case "date": return "date";
    case "datetime": return "datetime";
    case "list": return "list";
    case "tags": return "tags";
    case "aliases": return "aliases";
    default: return null;
  }
}

function propertyEditorStageSeed(row, kind) {
  const value = row ? row.value : undefined;
  if (kind === "list" || kind === "tags" || kind === "aliases") {
    return { items: Array.isArray(value) ? value.slice() : [], itemDraft: "" };
  }
  return { value: value == null ? "" : String(value), items: [], itemDraft: "" };
}

function propertyEditorJsonEqual(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return left === right; }
}

function propertyEditorStageListShape(row, kind) {
  if (!row || !["list", "tags", "aliases"].includes(kind)) return true;
  return Array.isArray(row.value);
}

function propertyEditorIsoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return check.getUTCFullYear() === parts.year
    && check.getUTCMonth() === parts.month - 1
    && check.getUTCDate() === parts.day
    ? parts
    : null;
}

function propertyEditorClockParts(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(\s*[ap]m)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const meridiem = String(match[5] || "").replace(/\s+/g, "").toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function propertyEditorPartsInZone(date, timeZone) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const byType = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year), month: Number(byType.month), day: Number(byType.day),
    hour: Number(byType.hour), minute: Number(byType.minute), second: Number(byType.second),
  };
}

function propertyEditorOffsetMinutes(date, timeZone) {
  const local = propertyEditorPartsInZone(date, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function propertyEditorFormatOffset(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function propertyEditorFormatDate(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function propertyEditorFormatTime(parts) {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second || 0).padStart(2, "0")}`;
}

function propertyEditorWallTimeInstant(parts, timeZone) {
  let zone = timeZone || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date(0)); }
  catch (_) { zone = "UTC"; }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  const offsets = new Set();
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    try { offsets.add(propertyEditorOffsetMinutes(new Date(wall + hours * 3600000), zone)); } catch (_) {}
  }
  const candidates = [];
  for (const offset of offsets) {
    const instant = new Date(wall - offset * 60000);
    try {
      const observed = propertyEditorPartsInZone(instant, zone);
      if (observed.year === parts.year && observed.month === parts.month && observed.day === parts.day
        && observed.hour === parts.hour && observed.minute === parts.minute && observed.second === (parts.second || 0)) {
        if (!candidates.some((candidate) => candidate.instant.getTime() === instant.getTime())) {
          candidates.push({ instant, offset: propertyEditorOffsetMinutes(instant, zone) });
        }
      }
    } catch (_) {}
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return { error: "That local time does not exist in the viewer's time zone." };
  return { error: "That local time is ambiguous; include an ISO offset to choose the intended instant." };
}

function propertyEditorClockNow(input) {
  let value = input && input.now;
  if (typeof value === "function") {
    try { value = value(); } catch (_) { value = null; }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : value == null ? new Date() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function propertyEditorRelativeDate(raw, nowParts) {
  const input = String(raw || "").trim().toLowerCase();
  if (!input) return { error: "Enter a date." };
  let delta = null;
  if (input === "now" || input === "today") delta = 0;
  else if (input === "tomorrow") delta = 1;
  else if (input === "yesterday") delta = -1;
  else {
    const relative = /^([+-]\d+)d$/.exec(input);
    if (relative) delta = Number(relative[1]);
    const weekdays = {
      sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
      wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
      fri: 5, friday: 5, sat: 6, saturday: 6,
    };
    if (Object.prototype.hasOwnProperty.call(weekdays, input)) {
      const target = weekdays[input];
      const today = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
      delta = (target - today + 7) % 7;
    }
  }
  if (delta !== null) {
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > 366000) return { error: "That relative date is out of range." };
    const date = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + delta));
    return { parts: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() } };
  }
  const iso = propertyEditorIsoDateParts(raw);
  return iso ? { parts: iso } : { error: "Use now, a weekday, ±Nd, or an ISO date." };
}

function propertyEditorExplicitIsoDateTime(raw) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(String(raw || "").trim());
  if (!match) return null;
  const date = propertyEditorIsoDateParts(match[1]);
  const time = propertyEditorClockParts(`${match[2]}:${match[3]}:${match[4] || "00"}`);
  const zone = match[6].toUpperCase();
  const offsetMatch = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(zone);
  if (!date || !time || !Number.isFinite(Date.parse(String(raw).trim().replace(" ", "T")))) return { error: "Enter a valid ISO date and time." };
  if (offsetMatch && (Number(offsetMatch[2]) > 14 || Number(offsetMatch[3] || 0) > 59)) return { error: "The ISO offset is out of range." };
  return { value: String(raw).trim().replace(" ", "T") };
}

function propertyEditorLocalIsoDateTime(raw) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(String(raw || "").trim());
  if (!match) return null;
  const date = propertyEditorIsoDateParts(match[1]);
  const time = propertyEditorClockParts(`${match[2]}:${match[3]}:${match[4] || "00"}`);
  return date && time ? { ...date, ...time } : { error: "Enter a valid ISO date and time." };
}

function propertyEditorExistingClock(value) {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(?:\s*(Z|[+-]\d{2}(?::?\d{2})?))?$/i.exec(String(value || ""));
  if (!match) return null;
  const time = propertyEditorClockParts(match[1]);
  if (!time) return null;
  return { ...time, offset: match[2] || "" };
}

function propertyEditorDateTimeValue(raw, options = {}) {
  const input = String(raw || "").trim();
  const now = propertyEditorClockNow(options);
  const zone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const nowParts = propertyEditorPartsInZone(now, zone);
  if (!input) return { ok: false, message: "Enter a date and time; use Ctrl+D to unset this property." };
  if (/^now$/i.test(input)) {
    const offset = propertyEditorOffsetMinutes(now, zone);
    return { ok: true, value: `${propertyEditorFormatDate(nowParts)}T${propertyEditorFormatTime(nowParts)}${propertyEditorFormatOffset(offset)}` };
  }
  const explicit = propertyEditorExplicitIsoDateTime(input);
  if (explicit) return explicit.error ? { ok: false, message: explicit.error } : { ok: true, value: explicit.value };
  const localIso = propertyEditorLocalIsoDateTime(input);
  if (localIso) {
    if (localIso.error) return { ok: false, message: localIso.error };
    const resolved = propertyEditorWallTimeInstant(localIso, zone);
    if (resolved.error) return { ok: false, message: resolved.error };
    return { ok: true, value: `${propertyEditorFormatDate(localIso)}T${propertyEditorFormatTime(localIso)}${propertyEditorFormatOffset(resolved.offset)}` };
  }
  const timeOnly = propertyEditorClockParts(input);
  if (timeOnly) {
    const parts = { ...nowParts, ...timeOnly };
    const resolved = propertyEditorWallTimeInstant(parts, zone);
    if (resolved.error) return { ok: false, message: resolved.error };
    return { ok: true, value: `${propertyEditorFormatDate(parts)}T${propertyEditorFormatTime(parts)}${propertyEditorFormatOffset(resolved.offset)}` };
  }
  const dateResult = propertyEditorRelativeDate(input, nowParts);
  if (dateResult.error) return { ok: false, message: dateResult.error };
  const existing = propertyEditorExistingClock(options.existingValue);
  if (existing && existing.offset) {
    return { ok: true, value: `${propertyEditorFormatDate(dateResult.parts)}T${propertyEditorFormatTime(existing)}${existing.offset}` };
  }
  const parts = { ...dateResult.parts, ...(existing || { hour: 0, minute: 0, second: 0 }) };
  const resolved = propertyEditorWallTimeInstant(parts, zone);
  if (resolved.error) return { ok: false, message: resolved.error };
  return { ok: true, value: `${propertyEditorFormatDate(parts)}T${propertyEditorFormatTime(parts)}${propertyEditorFormatOffset(resolved.offset)}` };
}

function propertyEditorDateValue(raw, options = {}) {
  const now = propertyEditorClockNow(options);
  const zone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const nowParts = propertyEditorPartsInZone(now, zone);
  const result = propertyEditorRelativeDate(raw, nowParts);
  return result.error ? { ok: false, message: result.error } : { ok: true, value: propertyEditorFormatDate(result.parts) };
}

function propertyEditorParseNumber(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return { ok: false, message: "Enter a valid number; use Ctrl+D to unset this property." };
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, message: "That number is out of range." };
}

function propertyEditorNormalizeTag(raw) {
  return String(raw == null ? "" : raw).trim().replace(/^#+/, "");
}

function propertyEditorSuggestValues(app, key, currentPath = "") {
  const counts = new Map();
  try {
    const files = app?.vault?.getMarkdownFiles?.() || [];
    for (const file of files) {
      if (!file || file.path === currentPath) continue;
      const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, key)) continue;
      const raw = frontmatter[key];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (typeof value !== "string" && typeof value !== "number") continue;
        const text = String(value);
        if (!text) continue;
        counts.set(text, (counts.get(text) || 0) + 1);
      }
    }
  } catch (_) {}
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function propertyEditorTagSuggestions(app) {
  try {
    const tags = app?.metadataCache?.getTags?.();
    if (!tags || typeof tags !== "object") return [];
    return Object.entries(tags)
      .map(([tag, count]) => ({ value: propertyEditorNormalizeTag(tag), count: Number(count) || 0 }))
      .filter((row) => row.value)
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  } catch (_) {
    return [];
  }
}

function propertyEditorStageBuild(row, stage, draft, options = {}) {
  if (!row || !stage || propertyEditorRoleOf(row) !== "loose") return { ok: false, message: "This property cannot be edited here." };
  const kind = stage.kind;
  const wireKind = stage.wireKind;
  if (!PROPERTY_EDITOR_STAGE_WIRE_KINDS.has(wireKind)) return { ok: false, message: "This property type uses the YAML escape." };
  let value;
  if (kind === "text") {
    value = draft && Object.prototype.hasOwnProperty.call(draft, "value") ? String(draft.value) : "";
  } else if (kind === "number") {
    const parsed = propertyEditorParseNumber(draft && draft.value);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  } else if (kind === "date") {
    const parsed = propertyEditorDateValue(draft && draft.value, options);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  } else if (kind === "datetime") {
    const parsed = propertyEditorDateTimeValue(draft && draft.value, { ...options, existingValue: row.value });
    if (!parsed.ok) return parsed;
    value = parsed.value;
  } else if (["list", "tags", "aliases"].includes(kind)) {
    if (!propertyEditorStageListShape(row, kind)) return { ok: false, message: "This scalar value cannot be edited as a list; use YAML to preserve its shape." };
    const items = Array.isArray(draft && draft.items) ? draft.items.slice() : [];
    const itemDraft = String((draft && draft.itemDraft) ?? "");
    const item = kind === "tags" ? propertyEditorNormalizeTag(itemDraft) : itemDraft.trim();
    if (item) items.push(item);
    value = kind === "tags" ? items.map(propertyEditorNormalizeTag) : items;
  } else {
    return { ok: false, message: "This property type uses the YAML escape." };
  }
  const op = { op: "prop.set", key: row.key, value, kind: wireKind };
  return { ok: true, value, kind: wireKind, ops: [op], changed: !propertyEditorJsonEqual(row.value, value) };
}
