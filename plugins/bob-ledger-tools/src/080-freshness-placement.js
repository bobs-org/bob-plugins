// --- Task freshness: placement ----------------------------------------------
// Owned by `docs/freshness.md` in bob-cli; the Rust half is
// `src/native/freshness/placement.rs`. Both sides run the placement (P)
// conformance vectors in that doc verbatim.
//
// Placement is the exception to the copy-small-helpers rule: nav,
// task-status-cycler and block-id-prompt call
// `api?.freshness?.stampLine?.(line, dateText) ?? line` (api
// `version >= 3`) instead of placing `fresh` themselves. A missing stamp
// only means Bryan sees the task once more; a misplaced stamp hides
// Tasks fields — so the risky part lives here, and when ledger-tools is
// absent or old the gesture simply doesn't stamp.

// Tasks keys recognized at the end of a Dataview task line, in the order
// `docs/freshness.md` pins them.
const FRESHNESS_TASKS_KEYS = [
  "priority",
  "start",
  "created",
  "scheduled",
  "due",
  "completion",
  "cancelled",
  "repeat",
  "onCompletion",
  "id",
  "dependsOn",
];

// Any `[key:: value]` or `(key:: value)` field, with the key matched
// case-sensitively and any spacing allowed around `::`. Mirrors the Rust
// `INLINE_FIELD_RE` in `task_fields.rs`.
const FRESHNESS_INLINE_FIELD_SOURCE =
  "\\[([A-Za-z][A-Za-z0-9_-]*)\\s*::\\s*([^\\]\n]*)\]|\\(([A-Za-z][A-Za-z0-9_-]*)\\s*::\\s*([^)\n]*)\\)";

// Every `key` field on `line`, in line order: `{ start, end, value }`
// with UTF-16 offsets into `line`. The key match is case-sensitive and
// the value is trimmed of spaces/tabs only, like the Rust scanner.
function freshnessInlineFields(line, key) {
  const text = String(line || "");
  const pattern = new RegExp(FRESHNESS_INLINE_FIELD_SOURCE, "g");
  const out = [];
  let match = pattern.exec(text);
  while (match !== null) {
    const matchedKey = match[1] !== undefined ? match[1] : match[3];
    const raw = match[1] !== undefined ? match[2] : match[4];
    if (matchedKey === key) {
      const value = raw.replace(/^[ \t]+|[ \t]+$/g, "");
      out.push({ start: match.index, end: match.index + match[0].length, value });
    }
    match = pattern.exec(text);
  }
  return out;
}

function freshnessIsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// A strict `YYYY-MM-DD` calendar date, else null. Anything else —
// including out-of-range months and days — is rejected, like the Rust
// `parse_strict_calendar_date`.
function parseFreshDateStrict(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  const daysInMonth = [
    31,
    freshnessIsLeapYear(year) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ][month - 1];
  if (day > daysInMonth) {
    return null;
  }
  return text;
}

function freshDateToUtc(text) {
  return Date.UTC(
    Number(text.slice(0, 4)),
    Number(text.slice(5, 7)) - 1,
    Number(text.slice(8, 10)),
  );
}

function freshPad2(number) {
  return String(number).padStart(2, "0");
}

// Add `days` to a canonical date. DST-safe via UTC noon arithmetic.
function freshDateAddDays(text, days) {
  const shifted = new Date(freshDateToUtc(text) + days * 86400000);
  return (
    String(shifted.getUTCFullYear()).padStart(4, "0") +
    "-" +
    freshPad2(shifted.getUTCMonth() + 1) +
    "-" +
    freshPad2(shifted.getUTCDate())
  );
}

// Whole days from `from` to `to` (both canonical dates).
function freshDateDiffDays(from, to) {
  return Math.round((freshDateToUtc(to) - freshDateToUtc(from)) / 86400000);
}

// Drop leading `>` quote markers the way the vault scanner does (up to
// three spaces, `>`, one optional space, repeated). Quoted tasks are
// still tasks; the `>` bytes stay in place on write.
function freshnessStripBlockquotePrefix(line) {
  let rest = String(line || "");
  for (;;) {
    const spaces = rest.match(/^ */)[0].length;
    if (spaces > 3 || rest[spaces] !== ">") {
      return rest;
    }
    rest = rest.slice(spaces + 1);
    if (rest.startsWith(" ")) {
      rest = rest.slice(1);
    }
  }
}

function freshnessAfterListMarker(line, index) {
  if (line[index] === "-" || line[index] === "*" || line[index] === "+") {
    return line[index + 1] !== undefined &&
      /\s/.test(line[index + 1])
      ? index + 1
      : null;
  }
  const digits = (line.slice(index).match(/^\d+/) || [""])[0].length;
  if (
    digits === 0 ||
    (line[index + digits] !== "." && line[index + digits] !== ")")
  ) {
    return null;
  }
  return line[index + digits + 1] !== undefined &&
    /\s/.test(line[index + digits + 1])
    ? index + digits + 1
    : null;
}

// The checkbox status char on a task line, or null when `line` is not a
// task line.
function freshnessTaskStatus(line) {
  const stripped = freshnessStripBlockquotePrefix(line);
  let index = 0;
  while (stripped[index] === " " || stripped[index] === "\t") {
    index += 1;
  }
  const after = freshnessAfterListMarker(stripped, index);
  if (after === null) {
    return null;
  }
  index = after;
  while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
    index += 1;
  }
  if (stripped[index] !== "[") {
    return null;
  }
  const close = stripped.indexOf("]", index + 1);
  if (close === -1) {
    return null;
  }
  const inner = stripped.slice(index + 1, close);
  if ([...inner].length !== 1) {
    return null;
  }
  const trailing = stripped.slice(close + 1);
  if (trailing !== "" && !/^\s/.test(trailing)) {
    return null;
  }
  return inner;
}

function freshnessIsClosedStatus(status) {
  return status === "x" || status === "X" || status === "-";
}

function freshnessHasRepeatField(line) {
  return freshnessInlineFields(line, "repeat").length > 0;
}

// A `[refresh:: N]` value: an integer 1-365, nothing else.
function freshnessParseRefreshValue(value) {
  const trimmed = String(value || "").trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return null;
  }
  return number;
}

function freshnessFirstValidRefresh(line) {
  const fields = freshnessInlineFields(line, "refresh");
  for (const field of fields) {
    const days = freshnessParseRefreshValue(field.value);
    if (days !== null) {
      return days;
    }
  }
  return null;
}

// A `[keeps:: N]` value: a decimal integer 1-999, nothing else.
// Absence means 0 and writers omit zero. Mirrors `parse_keeps_value`
// in `src/native/freshness/placement.rs`.
function freshnessParseKeepsValue(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "" || !/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1 || number > 999) {
    return null;
  }
  return number;
}

function freshnessFirstValidKeeps(line) {
  const fields = freshnessInlineFields(line, "keeps");
  for (const field of fields) {
    const count = freshnessParseKeepsValue(field.value);
    if (count !== null) {
      return count;
    }
  }
  return null;
}

// The scan floor: the start of the task body, or the end of a leading
// `#task` global-filter token. The suffix scan never moves left of it.
// Quote markers are detection-only: the floor is shifted back into the
// original line's coordinates.
function freshnessScanFloor(line) {
  const text = String(line || "");
  const stripped = freshnessStripBlockquotePrefix(text);
  const offset = text.length - stripped.length;
  let index = 0;
  while (stripped[index] === " " || stripped[index] === "\t") {
    index += 1;
  }
  const after = freshnessAfterListMarker(stripped, index);
  if (after === null) {
    return null;
  }
  index = after;
  while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
    index += 1;
  }
  const close = stripped.indexOf("]", index);
  if (close === -1) {
    return null;
  }
  let bodyStart = close + 1;
  while (stripped[bodyStart] === " " || stripped[bodyStart] === "\t") {
    bodyStart += 1;
  }
  const body = stripped.slice(bodyStart);
  if (
    body === "#task" ||
    body.startsWith("#task ") ||
    body.startsWith("#task\t")
  ) {
    return offset + bodyStart + "#task".length;
  }
  return offset + bodyStart;
}

function freshnessTrimEndTo(text, cursor) {
  let end = Math.min(cursor, text.length);
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) {
    end -= 1;
  }
  return end;
}

// Start of a trailing ` ^id` block link, if `text` ends with one.
function freshnessTrailingBlockStart(text) {
  const trimmed = text.replace(/[ \t]+$/, "");
  const tokenStart = (() => {
    const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
    return last === -1 ? 0 : last + 1;
  })();
  const token = trimmed.slice(tokenStart);
  if (!token.startsWith("^")) {
    return null;
  }
  const id = token.slice(1);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) {
    return null;
  }
  if (tokenStart > 0) {
    const before = trimmed[tokenStart - 1];
    if (before !== " " && before !== "\t") {
      return null;
    }
  }
  return text.replace(/[ \t]+$/, "").length - token.length;
}

// Start of a trailing `#tag`, if `trimmed` (already right-trimmed) ends
// with one starting at or after `floor`.
function freshnessTrailingTagStart(trimmed, floor) {
  const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
  const tokenStart = last === -1 ? 0 : last + 1;
  const start = Math.max(tokenStart, floor);
  const token = trimmed.slice(start);
  if (!token.startsWith("#")) {
    return null;
  }
  if (start > floor) {
    const before = trimmed[start - 1];
    if (before !== " " && before !== "\t") {
      return null;
    }
  }
  const value = token.slice(1);
  if (!value || /[\s!@#$%^&*(),.?":{}|<>]/.test(value)) {
    return null;
  }
  return start;
}

// The `(start, key)` of a trailing `[k:: v]` / `(k:: v)` field: the key
// must equal its trim.
function freshnessTrailingFieldKey(trimmed) {
  let end = trimmed.length;
  if (trimmed.endsWith(",")) {
    end -= 1;
    end = trimmed.slice(0, end).replace(/[ \t]+$/, "").length;
  }
  const head = trimmed.slice(0, end);
  const close = head[head.length - 1];
  const open = close === "]" ? "[" : close === ")" ? "(" : null;
  if (open === null) {
    return null;
  }
  const withoutClose = head.slice(0, -1);
  const start = withoutClose.lastIndexOf(open);
  if (start === -1) {
    return null;
  }
  const inner = withoutClose.slice(start + 1).trim();
  const separator = inner.indexOf("::");
  if (separator === -1) {
    return null;
  }
  const key = inner.slice(0, separator);
  if (key !== key.trim() || !key.trim()) {
    return null;
  }
  return { start, key: key.trim() };
}

// Byte offset where the trailing Tasks suffix starts. The suffix starts
// at the leftmost Tasks element (a Tasks-key field, a trailing tag, or
// `^id`) of the run scanned from the end of the line. `fresh` /
// `refresh` / `keeps` fields extend the run but are not part of the
// suffix. `keeps` is a run-extending non-Tasks key: it is never added
// to the Tasks key registry. Returns the trimmed length when there is
// no suffix.
function freshnessTasksSuffixStart(line) {
  const text = String(line || "");
  const floor = freshnessScanFloor(text);
  if (floor === null) {
    return text.replace(/[ \t\n\r]+$/, "").length;
  }
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  let cursor = trimmedLen;
  let leftmost = null;

  const blockStart = freshnessTrailingBlockStart(text.slice(0, cursor));
  if (blockStart !== null && blockStart >= floor) {
    leftmost = blockStart;
    cursor = freshnessTrimEndTo(text.slice(0, blockStart), blockStart);
  }

  for (;;) {
    if (cursor <= floor) {
      break;
    }
    const slice = text.slice(0, cursor);
    const trimmed = slice.replace(/[ \t\n\r]+$/, "");
    const end = trimmed.length;
    if (end <= floor) {
      break;
    }
    const tagStart = freshnessTrailingTagStart(trimmed, floor);
    if (tagStart !== null) {
      leftmost = tagStart;
      cursor = freshnessTrimEndTo(text.slice(0, tagStart), tagStart);
      continue;
    }
    const field = freshnessTrailingFieldKey(trimmed);
    if (!field) {
      break;
    }
    if (field.start < floor) {
      break;
    }
    if (FRESHNESS_TASKS_KEYS.includes(field.key)) {
      leftmost = field.start;
      cursor = freshnessTrimEndTo(text.slice(0, field.start), field.start);
      continue;
    }
    if (
      field.key === "fresh" ||
      field.key === "refresh" ||
      field.key === "keeps"
    ) {
      cursor = freshnessTrimEndTo(text.slice(0, field.start), field.start);
      continue;
    }
    break;
  }

  return leftmost === null ? trimmedLen : leftmost;
}

// Remove every `fresh`, `refresh`, and `keeps` field from `text`,
// collapsing the whitespace each removal leaves to a single space.
function freshnessRemoveFields(text) {
  const ranges = [];
  for (const field of freshnessInlineFields(text, "fresh")) {
    ranges.push([field.start, field.end]);
  }
  for (const field of freshnessInlineFields(text, "refresh")) {
    ranges.push([field.start, field.end]);
  }
  for (const field of freshnessInlineFields(text, "keeps")) {
    ranges.push([field.start, field.end]);
  }
  if (ranges.length === 0) {
    return text;
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  let output = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    const before = text.slice(cursor, start).replace(/[ \t]+$/, "");
    output += before;
    let next = end;
    while (text[next] === " " || text[next] === "\t") {
      next += 1;
    }
    if (output !== "" && next < text.length) {
      output += " ";
    }
    cursor = next;
  }
  output += text.slice(cursor);
  return output;
}

// Rebuild `line` with `[fresh:: dateText]` (plus `[refresh:: N]` and
// `[keeps:: N]` when kept) immediately before the Tasks suffix.
// Output order is `fresh`, optional `refresh`, optional `keeps`, then
// the existing Tasks suffix, tags, and block ID. The suffix bytes
// themselves are never changed.
function freshnessRebuildWithoutFields(
  line,
  dateText,
  keptRefresh,
  keptKeeps,
) {
  const text = String(line || "");
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  const suffixStart = Math.min(freshnessTasksSuffixStart(text), trimmedLen);
  const headClean = freshnessRemoveFields(text.slice(0, suffixStart));
  const suffixClean = freshnessRemoveFields(text.slice(suffixStart, trimmedLen));
  const head = headClean.replace(/[ \t\n\r]+$/, "");
  const suffix = suffixClean.trim().replace(/^[ \t]+/, "");

  let output = head + " [fresh:: " + dateText + "]";
  if (keptRefresh !== null && keptRefresh !== undefined) {
    output += " [refresh:: " + keptRefresh + "]";
  }
  if (keptKeeps !== null && keptKeeps !== undefined) {
    output += " [keeps:: " + keptKeeps + "]";
  }
  if (suffix !== "") {
    output += " " + suffix;
  }
  return output;
}

function freshnessTodayFallback() {
  return formatLocalDate(new Date());
}

function freshnessNormalizeDateText(dateText) {
  return parseFreshDateStrict(dateText) || freshnessTodayFallback();
}

// Stamp `line` with `dateText`, keeping the first valid existing
// `[refresh:: N]` if there is one. Every generic human stamp clears
// `keeps`: the line is rewritten without any `keeps` field, even when
// `dateText` already equals today. Refusals (not a task, recurring,
// done/cancelled) return the line unchanged with a reason. A line
// already stamped with `dateText` in canonical position — and with no
// `keeps` to clear — is byte-identical with `changed: false`.
function freshnessStampLine(line, dateText) {
  const text = String(line || "");
  const day = freshnessNormalizeDateText(dateText);
  const status = freshnessTaskStatus(text);
  if (status === null) {
    return { line: text, changed: false, refused: "not_task" };
  }
  if (freshnessIsClosedStatus(status)) {
    return { line: text, changed: false, refused: "closed" };
  }
  if (freshnessHasRepeatField(text)) {
    return { line: text, changed: false, refused: "recurring" };
  }
  const output = freshnessRebuildWithoutFields(
    text,
    day,
    freshnessFirstValidRefresh(text),
    null,
  );
  return { line: output, changed: output !== text, refused: null };
}

// The sole increment helper (`docs/freshness.md` §2a): stamp `line`
// with `dateText` while counting one due-Ready bare keep. `options`
// carries `{ counted }`: a counted keep increments the valid semantic
// streak by one (saturating at 999; absence means 0 so the first
// counted keep writes 1), while an uncounted keep preserves the valid
// semantic value. Both paths canonicalize and repair
// malformed/duplicate placement. A valid prior `fresh < today` is
// independently required before incrementing, even when `counted` is
// true, so NEW and same-day lines never inflate under stale caches or
// repeated events — those stamp and preserve instead. Refusals match
// the generic stamper. Rust reads, clears, and reports `keeps`; it has
// no increment path.
function freshnessKeepLine(line, dateText, options) {
  const text = String(line || "");
  const day = freshnessNormalizeDateText(dateText);
  const status = freshnessTaskStatus(text);
  if (status === null) {
    return { line: text, changed: false, refused: "not_task" };
  }
  if (freshnessIsClosedStatus(status)) {
    return { line: text, changed: false, refused: "closed" };
  }
  if (freshnessHasRepeatField(text)) {
    return { line: text, changed: false, refused: "recurring" };
  }
  const counted =
    options !== null &&
    options !== undefined &&
    typeof options === "object" &&
    Boolean(options.counted);
  const read = readFreshness(text, day);
  const priorValid = read.fresh !== null && read.fresh < day;
  let keptKeeps = null;
  if (counted && priorValid) {
    keptKeeps = Math.min(read.keeps + 1, 999);
  } else if (read.keeps > 0) {
    keptKeeps = read.keeps;
  }
  const output = freshnessRebuildWithoutFields(
    text,
    day,
    freshnessFirstValidRefresh(text),
    keptKeeps,
  );
  return { line: output, changed: output !== text, refused: null };
}

// Set or clear `[refresh:: N]` and stamp with `dateText`. A value
// outside 1-365 clears the field instead of writing an invalid one,
// like the Rust `set_refresh`.
function freshnessSetRefreshLine(line, days, dateText) {
  const text = String(line || "");
  const day = freshnessNormalizeDateText(dateText);
  let normalized = days;
  if (typeof normalized === "string" && /^[+-]?\d+$/.test(normalized.trim())) {
    normalized = Number(normalized.trim());
  }
  const edit =
    Number.isSafeInteger(normalized) && normalized >= 1 && normalized <= 365
      ? normalized
      : null;
  const status = freshnessTaskStatus(text);
  if (status === null) {
    return { line: text, changed: false, refused: "not_task" };
  }
  if (freshnessIsClosedStatus(status)) {
    return { line: text, changed: false, refused: "closed" };
  }
  if (freshnessHasRepeatField(text)) {
    return { line: text, changed: false, refused: "recurring" };
  }
  const output = freshnessRebuildWithoutFields(text, day, edit, null);
  return { line: output, changed: output !== text, refused: null };
}

function freshnessPushLint(lints, code) {
  if (!lints.includes(code)) {
    lints.push(code);
  }
}

// Read the `fresh` / `refresh` / `keeps` fields on `line`: the latest
// valid `fresh` date not after `todayText` (a future date is treated
// as none), the first valid `[refresh:: N]`, the first valid
// `[keeps:: N]` semantic count (0 when absent or when no value is
// valid), and lint codes in first-seen order. Mirrors `read_freshness`
// in `src/native/freshness/placement.rs`.
function readFreshness(line, todayText) {
  const text = String(line || "");
  const today = freshnessNormalizeDateText(todayText);
  const freshFields = freshnessInlineFields(text, "fresh");
  const refreshFields = freshnessInlineFields(text, "refresh");
  const keepsFields = freshnessInlineFields(text, "keeps");
  const lints = [];

  let best = null;
  for (const field of freshFields) {
    const date = parseFreshDateStrict(field.value.trim());
    if (date === null) {
      freshnessPushLint(lints, "fresh_malformed");
    } else if (date > today) {
      freshnessPushLint(lints, "fresh_future");
    } else if (best === null || date > best) {
      best = date;
    }
  }
  if (freshFields.length > 1) {
    freshnessPushLint(lints, "fresh_duplicate");
  }

  let refresh = null;
  let refreshInvalidSeen = false;
  for (const field of refreshFields) {
    const days = freshnessParseRefreshValue(field.value);
    if (days === null) {
      refreshInvalidSeen = true;
    } else if (refresh === null) {
      refresh = days;
    }
  }
  if (refreshInvalidSeen) {
    freshnessPushLint(lints, "refresh_invalid");
  }

  let keeps = null;
  let keepsInvalidSeen = false;
  for (const field of keepsFields) {
    const count = freshnessParseKeepsValue(field.value);
    if (count === null) {
      keepsInvalidSeen = true;
    } else if (keeps === null) {
      keeps = count;
    }
  }
  if (keepsInvalidSeen) {
    freshnessPushLint(lints, "keeps_invalid");
  }
  if (keepsFields.length > 1) {
    freshnessPushLint(lints, "keeps_duplicate");
  }

  const suffixStart = freshnessTasksSuffixStart(text);
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  if (suffixStart < trimmedLen) {
    const misplaced = (name) =>
      freshnessInlineFields(text, name).some(
        (field) => field.start >= suffixStart,
      );
    if (misplaced("fresh") || misplaced("refresh") || misplaced("keeps")) {
      freshnessPushLint(lints, "fresh_misplaced");
    }
  }

  return { fresh: best, refresh, keeps: keeps === null ? 0 : keeps, lints };
}

