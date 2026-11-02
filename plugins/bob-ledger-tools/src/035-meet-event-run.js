// --- Calendar-aware Pomodoro starts: pure mirror of bob capture -----------
// The MEET event run, the `#offclock` clock rule, `[buffer::]` occupied
// spans, and the run-past-event notice. Shared contracts: bob-cli's
// tests/fixtures/meet_event_run/vectors.json,
// tests/fixtures/event_buffer/vectors.json, and
// tests/fixtures/pomodoro_clock/vectors.json (copied byte-for-byte under
// scripts/fixtures/). Everything here reads lines and returns text or
// messages; it never touches the editor.
//
// A timed ledger row carries `[t:: Nm]` (on the clock) or `[off:: Nm]` (an
// Off-Clock Pomodoro: recorded, but off the work clock). A `[buffer::]` field
// widens the span the event occupies; the meeting span stays the bold clock.

const EVENT_RUN_FAR_MINUTES = 25;
const EVENT_RUN_DAY_MINUTES = 1440;
const EVENT_BUFFER_CAP_MINUTES = 720;
const EVENT_BUFFER_MINUS = "\u2212";
const EVENT_BUFFER_EMPTY = Object.freeze({ beforeMin: 0, afterMin: 0 });
const EVENT_TASK_LINE_RE =
  /^[ \t]*- \[(.)\][ \t]*(?:#task[ \t]*)?\*\*(\d{4})-(\d{4})\*\*(?=$|[ \t])/;
const EVENT_RUN_LINK_RE =
  /^([ \t]+)[-*+][ \t]+(?:🍅[ \t]*)*(!?)\[\[([^\]|#]*)#\^([A-Za-z0-9-]+)(?:\|[^\]]*)?\]\][ \t]*$/;

function eventRunAsciiLower(text) {
  return String(text || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function eventRunHhmm(minutes) {
  const wrapped = ((Math.round(minutes) % EVENT_RUN_DAY_MINUTES) + EVENT_RUN_DAY_MINUTES) % EVENT_RUN_DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}${String(wrapped % 60).padStart(2, "0")}`;
}

function eventRunParseHhmm(value) {
  const text = String(value || "");
  if (!/^\d{4}$/.test(text)) return null;
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2));
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

function eventRunHumanize(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function eventRunClockLabel(minutes) {
  const wrapped = ((Math.round(minutes) % EVENT_RUN_DAY_MINUTES) + EVENT_RUN_DAY_MINUTES) % EVENT_RUN_DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function eventBufferIsEmpty(buffer) {
  return !buffer || (buffer.beforeMin === 0 && buffer.afterMin === 0);
}

function eventBufferParseToken(token) {
  const text = String(token || "");
  let part;
  let rest;
  if (text.startsWith("+")) {
    part = "after";
    rest = text.slice(1);
  } else if (text.startsWith("-") || text.startsWith("\u2212") || text.startsWith("\u2013")) {
    part = "before";
    rest = text.slice(1);
  } else {
    return null;
  }
  const digits = /[mM]$/.test(rest) ? rest.slice(0, -1) : rest;
  if (!digits || digits.length > 3 || !/^\d+$/.test(digits)) return null;
  return { part, minutes: Math.min(Number(digits), EVENT_BUFFER_CAP_MINUTES) };
}

function eventBufferParse(value) {
  const tokens = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let before = null;
  let after = null;
  for (const token of tokens) {
    const parsed = eventBufferParseToken(token);
    if (!parsed) return null;
    if (parsed.part === "before") {
      if (before === null) before = parsed.minutes;
    } else if (after === null) {
      after = parsed.minutes;
    }
  }
  return { beforeMin: before || 0, afterMin: after || 0 };
}

function eventBufferBody(buffer, minus) {
  if (eventBufferIsEmpty(buffer)) return null;
  const before = buffer.beforeMin;
  const after = buffer.afterMin;
  if (before && !after) return `${minus}${before}m`;
  if (!before && after) return `+${after}m`;
  return `${minus}${before}m +${after}m`;
}

function eventBufferField(buffer) {
  const body = eventBufferBody(buffer, "-");
  return body ? `[buffer:: ${body}]` : null;
}

function eventBufferLabel(buffer) {
  return eventBufferBody(buffer, EVENT_BUFFER_MINUS);
}

function eventBufferPartLabel(buffer, part) {
  if (part === "before") return eventBufferLabel({ beforeMin: buffer.beforeMin, afterMin: 0 });
  if (part === "after") return eventBufferLabel({ beforeMin: 0, afterMin: buffer.afterMin });
  return null;
}

function eventRunBufferedSpan(startMin, endOnTimeline, buffer) {
  const start = Number(startMin);
  const end = Number(endOnTimeline);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { startMin: start, endOnTimeline: end, timeRange: null };
  }
  if (eventBufferIsEmpty(buffer)) {
    return {
      startMin: start,
      endOnTimeline: end,
      timeRange: `${eventRunHhmm(start)}-${eventRunHhmm(end)}`,
    };
  }
  const occupiedStart = Math.max(0, start - buffer.beforeMin);
  let occupiedEnd = end + buffer.afterMin;
  if (occupiedEnd - occupiedStart >= EVENT_RUN_DAY_MINUTES) {
    occupiedEnd = occupiedStart + EVENT_RUN_DAY_MINUTES - 1;
  }
  return {
    startMin: occupiedStart,
    endOnTimeline: occupiedEnd,
    timeRange: `${eventRunHhmm(occupiedStart)}-${eventRunHhmm(occupiedEnd)}`,
  };
}

function eventRunBufferHoldsTitle(occupied) {
  if (!occupied || occupied.timeRange == null) return "";
  return `Holds ${eventRunClockLabel(occupied.startMin)}\u2013${eventRunClockLabel(occupied.endOnTimeline)}`;
}

function eventRunBufferTooltip(buffer, occupied) {
  const holds = eventRunBufferHoldsTitle(occupied);
  const parts = [];
  if (buffer && buffer.beforeMin) parts.push(`${buffer.beforeMin}m before`);
  if (buffer && buffer.afterMin) parts.push(`${buffer.afterMin}m after`);
  return [holds, ...parts].filter(Boolean).join(" \u00b7 ");
}

function eventRunWithBufferLabel(title, timeRange, buffer) {
  const label = eventBufferLabel(buffer);
  return label ? `${title} (${timeRange} ${label})` : `${title} (${timeRange})`;
}

// First `[buffer::]` field outside code spans and Markdown links.
// An invalid value is no buffer. Offsets match the original line.
function eventRunBufferFieldRange(line) {
  const masked = eventRunMaskCodeAndLinks(line);
  const fields = typeof pomodoroThemeInlineFields === "function"
    ? pomodoroThemeInlineFields(masked)
    : [];
  const field = fields.find((item) => eventRunAsciiLower(item.key) === "buffer");
  if (!field) return null;
  const parsed = eventBufferParse(field.value);
  if (!parsed || eventBufferIsEmpty(parsed)) {
    return { start: field.start, end: field.end, buffer: EVENT_BUFFER_EMPTY, parsed: null };
  }
  return { start: field.start, end: field.end, buffer: parsed, parsed };
}

function eventRunParseBuffer(line) {
  const found = eventRunBufferFieldRange(line);
  return found && found.parsed ? found.parsed : EVENT_BUFFER_EMPTY;
}

function eventRunMinutesAhead(from, to) {
  let delta = to - from;
  if (delta < 0) delta += EVENT_RUN_DAY_MINUTES;
  return delta;
}

// Mirror of event_task.rs `mask_code_and_markdown_links`: code spans and
// Markdown links become spaces of the same length.
function eventRunFindCodeClose(text, start, width) {
  let search = start;
  while (search < text.length) {
    if (text[search] !== "`") {
      search += 1;
      continue;
    }
    const close = search;
    while (search < text.length && text[search] === "`") search += 1;
    if (search - close === width) return search;
  }
  return null;
}

function eventRunMarkdownLinkEnd(text, open) {
  const rest = text.slice(open + 1);
  const textClose = rest.indexOf("]");
  if (textClose < 0) return null;
  const after = rest.slice(textClose + 1);
  if (!after.startsWith("(")) return null;
  const urlClose = after.slice(1).indexOf(")");
  if (urlClose < 0) return null;
  return open + 1 + textClose + 1 + 1 + urlClose + 1;
}

function eventRunMaskCodeAndLinks(line) {
  const text = String(line || "");
  const out = text.split("");
  const blank = (from, to) => {
    for (let index = from; index < to && index < out.length; index += 1) out[index] = " ";
  };
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      let width = 0;
      while (text[index + width] === "`") width += 1;
      const close = eventRunFindCodeClose(text, index + width, width);
      if (close !== null) {
        blank(index, close);
        index = close;
        continue;
      }
    }
    if (text[index] === "[") {
      const end = eventRunMarkdownLinkEnd(text, index);
      if (end !== null) {
        blank(index, end);
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return out.join("");
}

// `#offclock` is canonical; `#off-clock` and `#untracked` are permanent
// aliases (mirror of bob's `line_has_off_clock_tag`).
const OFF_CLOCK_TAGS = Object.freeze(["#offclock", "#off-clock", "#untracked"]);

// Offsets of the first standalone off-clock tag token (any spelling,
// case-insensitive, whitespace-bounded on the left and followed by whitespace,
// end of line, or one of `])}:.,;!?`, not inside a code span or Markdown
// link), or null. A nested tag such as `#offclock/x` does not qualify.
function eventTaskOffClockTagRange(line) {
  const masked = eventRunMaskCodeAndLinks(line);
  const lower = eventRunAsciiLower(masked);
  let best = null;
  for (const needle of OFF_CLOCK_TAGS) {
    let search = 0;
    while (search <= lower.length) {
      const at = lower.indexOf(needle, search);
      if (at < 0) break;
      const end = at + needle.length;
      const before = at > 0 ? masked[at - 1] : null;
      const after = end < masked.length ? masked[end] : null;
      const leftOk = before === null || /\s/.test(before);
      const rightOk = after === null || /\s/.test(after) || "])}:.,;!?".includes(after);
      if (leftOk && rightOk) {
        if (best === null || at < best.start) best = { start: at, end };
        break;
      }
      search = at + 1;
    }
  }
  return best;
}

function eventTaskLineIsOffClock(line) {
  return eventTaskOffClockTagRange(line) !== null;
}

function eventRunStripTrailingField(title) {
  const trimmed = title.trimEnd();
  const open = trimmed.lastIndexOf("[");
  if (open < 0 || !trimmed.slice(open).includes("::") || !trimmed.endsWith("]")) return trimmed;
  return trimmed.slice(0, open).trimEnd();
}

// Strips a trailing off-clock tag (any spelling, with the sentence
// punctuation Rust allows after it) from a title.
function eventRunStripTrailingOffClock(title) {
  const trimmed = title.trimEnd();
  const candidate = trimmed.replace(/[.,;:!?]+$/, "");
  const lower = eventRunAsciiLower(candidate);
  for (const tag of OFF_CLOCK_TAGS) {
    const start = lower.lastIndexOf(tag);
    if (start < 0 || start + tag.length !== candidate.length) continue;
    if (start > 0 && !/\s/.test(candidate[start - 1])) continue;
    return candidate.slice(0, start).trimEnd();
  }
  return trimmed;
}

function eventRunStripTrailingMarkdownLink(title) {
  const trimmed = title.trimEnd();
  const open = trimmed.lastIndexOf("[");
  if (open < 0 || eventRunMarkdownLinkEnd(trimmed, open) !== trimmed.length) return trimmed;
  return trimmed.slice(0, open).trimEnd();
}

// Mirror of event_task.rs `clean_event_title`: strip trailing fields, any
// off-clock tag, and Markdown links in any interleaving until nothing
// changes, so `[buffer::]` never leaks into a title.
function eventRunCleanTitle(after) {
  let title = String(after || "").trim();
  const id = /(?:^|\s)\^[A-Za-z0-9-]+$/.exec(title);
  if (id) title = title.slice(0, id.index).trimEnd();
  for (;;) {
    const before = title.length;
    title = eventRunStripTrailingField(title);
    title = eventRunStripTrailingOffClock(title);
    title = eventRunStripTrailingMarkdownLink(title);
    if (title.length === before) break;
  }
  const tail = /^(.*) · \*([^*]*)\*$/.exec(title);
  if (tail) title = tail[1].trimEnd();
  return title.trim();
}

// Every Event Task row in the daily note's `## Events` section. Context
// rows (no checkbox) and all-day rows are not Event Tasks.
function eventRunEventRows(lines) {
  const source = Array.isArray(lines) ? lines : [];
  const section = gcalEventsFindSection(source, "Events");
  if (!section) return [];
  const rows = [];
  let fence = null;
  for (let index = section.start; index < section.end; index += 1) {
    const line = String(source[index] || "");
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const match = EVENT_TASK_LINE_RE.exec(line);
    if (!match) continue;
    const startMin = eventRunParseHhmm(match[2]);
    const endMin = eventRunParseHhmm(match[3]);
    if (startMin === null || endMin === null) continue;
    const idMatch = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
    const endOnTimeline = endMin < startMin ? endMin + EVENT_RUN_DAY_MINUTES : endMin;
    const bufferField = eventRunBufferFieldRange(line);
    const buffer = bufferField && bufferField.parsed ? bufferField.parsed : EVENT_BUFFER_EMPTY;
    const occupied = eventRunBufferedSpan(startMin, endOnTimeline, buffer);
    rows.push({
      lineIndex: index,
      status: match[1],
      open: !"xX-".includes(match[1]),
      startMin,
      endMin,
      endOnTimeline,
      buffer,
      bufferField: bufferField && bufferField.parsed
        ? { start: bufferField.start, end: bufferField.end }
        : null,
      bufferedStartMin: occupied.startMin,
      bufferedEndOnTimeline: occupied.endOnTimeline,
      bufferedTimeRange: occupied.timeRange,
      offClock: eventTaskLineIsOffClock(line),
      blockId: idMatch ? idMatch[1] : null,
      title: eventRunCleanTitle(line.slice(match[0].length)),
      timeRange: `${match[2]}-${match[3]}`,
    });
  }
  return rows;
}

// The lone Event Task carrying `^id`; null when none or ambiguous.
function eventRunById(rows, blockId) {
  const found = rows.filter((row) => row.blockId === blockId);
  return found.length === 1 ? found[0] : null;
}

function eventRunIndent(line) {
  return (/^[ \t]*/.exec(String(line || "")) || [""])[0].length;
}

// A session's queued Task Links: direct-child bullets at the first child
// indentation that hold exactly one block link (after stripping 🍅).
function eventRunQueuedLinks(lines, entryIndex) {
  const links = [];
  const entryIndent = eventRunIndent(lines[entryIndex]);
  let childIndent = null;
  let fence = false;
  for (let index = entryIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (line.trim() === "" || eventRunIndent(line) <= entryIndent) break;
    if (childIndent === null) childIndent = eventRunIndent(line);
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || eventRunIndent(line) !== childIndent) continue;
    const match = EVENT_RUN_LINK_RE.exec(line);
    if (!match) continue;
    links.push({
      embedded: match[2] === "!",
      pathPart: match[3],
      blockId: match[4],
      index: links.length + 1,
    });
  }
  return links;
}

function eventRunLineName(line) {
  const offset = pomodoroThemeNameOffsetInLine(line);
  if (!offset) return null;
  const name = String(line).slice(offset.nameStart, offset.nameEnd).trim();
  return name === "" ? null : name;
}

function eventRunIsMeetName(name) {
  return typeof name === "string" && name.split(/\s+/).filter(Boolean).join(" ").toLowerCase() === "meet";
}

// The event run of the MEET session headlined at `entryIndex`: its earliest
// open, not-yet-ended lineup Event Task plus every following one that touches
// or overlaps it and shares its clock. Null when the lineup has none.
function computeMeetEventRun(lines, entryIndex, nowMinutes, rows = eventRunEventRows(lines)) {
  const seen = new Set();
  const candidates = [];
  eventRunQueuedLinks(lines, entryIndex).forEach((link, position) => {
    if (link.embedded || link.pathPart !== "") return;
    const event = eventRunById(rows, link.blockId);
    if (!event) return;
    if (!event.open || event.bufferedEndOnTimeline <= nowMinutes || event.endOnTimeline <= event.startMin) return;
    if (seen.has(link.blockId)) return;
    seen.add(link.blockId);
    candidates.push({ position, event, number: link.index });
  });
  candidates.sort(
    (left, right) =>
      left.event.bufferedStartMin - right.event.bufferedStartMin ||
      left.event.bufferedEndOnTimeline - right.event.bufferedEndOnTimeline ||
      left.position - right.position,
  );
  if (candidates.length === 0) return null;
  const first = candidates[0].event;
  const events = [candidates[0]];
  let endMin = first.bufferedEndOnTimeline;
  for (const next of candidates.slice(1)) {
    if (next.event.bufferedStartMin > endMin || next.event.offClock !== first.offClock) break;
    endMin = Math.max(endMin, next.event.bufferedEndOnTimeline);
    events.push(next);
  }
  return { startMin: first.bufferedStartMin, endMin, offClock: first.offClock, events };
}

// End, on the day's timeline, of today's latest closed timed session.
function eventRunLatestClosedEnd(lines) {
  const section = findPomodorosSection(lines);
  if (!section) return null;
  let best = null;
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    const entry = parseLedgerLine(String(lines[line] || ""));
    if (!entry || !entry.completed || !entry.range) continue;
    let end = entry.range.endMinutes;
    if (end < entry.range.startMinutes) end += EVENT_RUN_DAY_MINUTES;
    if (best === null || end > best) best = end;
  }
  return best;
}

function eventRunStartInSession(eventStart, sessionStart, sessionEnd) {
  if (sessionStart === sessionEnd) return false;
  if (sessionEnd > sessionStart) return eventStart >= sessionStart && eventStart < sessionEnd;
  return eventStart >= sessionStart || eventStart < sessionEnd;
}

function eventRunMeetingInProgressAt(event, clock) {
  const start = event.startMin;
  const end = event.endOnTimeline;
  const time = clock;
  return (start < time && time < end) || (start < time + EVENT_RUN_DAY_MINUTES && time + EVENT_RUN_DAY_MINUTES < end);
}

function eventRunSessionRange(start, end) {
  if (start === end) return null;
  let sessionEnd = end;
  if (sessionEnd < start) sessionEnd += EVENT_RUN_DAY_MINUTES;
  return { start, end: sessionEnd };
}

function eventRunOverlapRange(session, eventStart, eventEnd) {
  let best = null;
  for (const shift of [-EVENT_RUN_DAY_MINUTES, 0, EVENT_RUN_DAY_MINUTES]) {
    const start = eventStart + shift;
    const end = eventEnd + shift;
    const overlapStart = Math.max(start, session.start);
    const overlapEnd = Math.min(end, session.end);
    const length = overlapEnd - overlapStart;
    if (length > 0 && (!best || length > best.length)) {
      best = { length, overlapStart, overlapEnd, shift };
    }
  }
  return best;
}

function eventRunSessionPrecedes(sessionStart, sessionEnd, target) {
  if (sessionStart === sessionEnd || sessionStart === target) return false;
  if (sessionEnd > sessionStart) return sessionStart < target;
  return target > sessionStart || target < sessionEnd;
}

function eventRunStartRank(eventStart, sessionStart, sessionEnd) {
  if (sessionEnd > sessionStart || eventStart >= sessionStart) return [0, eventStart];
  return [1, eventStart];
}

// Shared conflict predicate. A non-MEET session `[S, E)` conflicts with
// an open Event Task when it overlaps the occupied (buffered) span and
// the meeting is not already in progress at `S`. Unbuffered events keep
// the start-in-session rule.
function eventRunSpanConflict(span, event) {
  if (!span || !event) return null;
  if (eventRunMeetingInProgressAt(event, span.start)) return null;
  const session = eventRunSessionRange(span.start, span.end);
  const occupiedStart = event.bufferedStartMin;
  const occupiedEnd = event.bufferedEndOnTimeline;
  const overlap = session
    ? eventRunOverlapRange(session, occupiedStart, occupiedEnd)
    : null;
  if (eventBufferIsEmpty(event.buffer)) {
    if (!eventRunStartInSession(event.startMin, span.start, span.end)) return null;
  } else if (!overlap) {
    return null;
  }
  let overlapMinutes = 0;
  let bufferPart = null;
  if (overlap) {
    overlapMinutes = overlap.overlapEnd - overlap.overlapStart;
    const meetingStart = event.startMin + overlap.shift;
    const meetingEnd = event.endOnTimeline + overlap.shift;
    if (
      overlap.overlapStart >= occupiedStart + overlap.shift
      && overlap.overlapEnd <= meetingStart
    ) {
      bufferPart = "before";
    } else if (
      overlap.overlapStart >= meetingEnd
      && overlap.overlapEnd <= occupiedEnd + overlap.shift
    ) {
      bufferPart = "after";
    }
  }
  return {
    overlapMinutes,
    bufferPart,
    fitStartMin: eventRunSessionPrecedes(span.start, span.end, occupiedStart)
      ? occupiedStart
      : null,
  };
}

// Open Event Tasks whose occupied span newly conflicts, earliest
// buffered start first. `old` is the span before the operator; events
// in the session's own lineup never count.
function eventRunNewCrossings(lines, entryIndex, span, old, rows = eventRunEventRows(lines)) {
  const exclude = new Set(eventRunQueuedLinks(lines, entryIndex).map((link) => link.blockId));
  const crossed = [];
  for (const row of rows) {
    if (!row.open || (row.blockId && exclude.has(row.blockId))) continue;
    const conflict = eventRunSpanConflict(span, row);
    if (!conflict) continue;
    if (old && eventRunSpanConflict(old, row)) continue;
    crossed.push({ ...row, conflict });
  }
  crossed.sort((left, right) => {
    const a = eventRunStartRank(left.bufferedStartMin, span.start, span.end);
    const b = eventRunStartRank(right.bufferedStartMin, span.start, span.end);
    return a[0] - b[0]
      || a[1] - b[1]
      || left.bufferedEndOnTimeline - right.bufferedEndOnTimeline
      || left.lineIndex - right.lineIndex;
  });
  return crossed;
}

function eventRunOverlapMinutes(span, event) {
  const conflict = event.conflict || eventRunSpanConflict(span, event);
  if (conflict) return conflict.overlapMinutes;
  const start = span.start;
  let end = span.end;
  if (end <= start) end += EVENT_RUN_DAY_MINUTES;
  let eventStart = event.bufferedStartMin;
  if (eventStart < start) eventStart += EVENT_RUN_DAY_MINUTES;
  let eventEnd = event.bufferedEndOnTimeline;
  if (eventEnd <= eventStart) eventEnd += EVENT_RUN_DAY_MINUTES;
  return Math.max(0, Math.min(eventEnd, end) - Math.max(eventStart, start));
}

function eventRunFitTarget(event, kind) {
  if (kind === "earlier" || eventBufferIsEmpty(event.buffer)) return event.startMin;
  if (event.conflict && event.conflict.fitStartMin != null) return event.conflict.fitStartMin;
  return null;
}

// Fit draft: the largest same-gesture count that ends at or before the
// occupied start. `kind` is "start" (`se<K>[-<offset>]`), "extend"
// (`K\p`), "later" (`K\o`), or "earlier" (`K\O`); null when no positive
// count fits. `\O` (`--N`) names the meeting start.
function eventRunFitToken(kind, span, old, event, offsetUnits = 0) {
  const target = eventRunFitTarget(event, kind);
  if (target == null) return null;
  if (kind === "start") {
    const count = Math.floor(eventRunMinutesAhead(span.start, target) / STEP_MINUTES);
    if (count <= 0) return null;
    return offsetUnits ? `se${count}-${offsetUnits}` : `se${count}`;
  }
  if (kind === "extend" || kind === "later") {
    const count = Math.floor(eventRunMinutesAhead(old.end, target) / STEP_MINUTES);
    if (count <= 0) return null;
    return kind === "extend" ? `${count}\\p` : `${count}\\o`;
  }
  if (kind === "earlier") {
    const gap = eventRunMinutesAhead(target, old.start);
    const count = Math.floor((gap - 1) / STEP_MINUTES);
    return gap > 0 && count > 0 ? `${count}\\O` : null;
  }
  return null;
}

function eventRunConflictTarget(event) {
  const part = event.conflict && event.conflict.bufferPart;
  if (part && !eventBufferIsEmpty(event.buffer)) {
    return `${event.title}'s ${eventBufferPartLabel(event.buffer, part)} buffer (${event.timeRange})`;
  }
  return eventRunWithBufferLabel(event.title, event.timeRange, event.buffer);
}

function eventRunConflictEndsAt(event, fit) {
  if (typeof fit === "string" && fit.includes("\\O")) return event.startMin;
  if (event.conflict && event.conflict.fitStartMin != null) return event.conflict.fitStartMin;
  return eventBufferIsEmpty(event.buffer) ? event.startMin : event.bufferedStartMin;
}

// The `pomodoro_runs_past_event` notice, worded like bob capture's warning.
function eventRunConflictNotice(name, span, crossed, fit) {
  const first = crossed[0];
  let message = `⚠ ${name || "session"} ${eventRunHhmm(span.start)}-${eventRunHhmm(span.end)} runs ${eventRunOverlapMinutes(span, first)}m into ${eventRunConflictTarget(first)}`;
  if (crossed.length > 1) message += ` and ${crossed.length - 1} more`;
  if (fit) message += ` · ${fit} ends at ${eventRunHhmm(eventRunConflictEndsAt(first, fit))}`;
  return { code: "pomodoro_runs_past_event", message };
}

function eventRunSpan(startMinutes, endMinutes) {
  return {
    start: ((startMinutes % EVENT_RUN_DAY_MINUTES) + EVENT_RUN_DAY_MINUTES) % EVENT_RUN_DAY_MINUTES,
    end: ((endMinutes % EVENT_RUN_DAY_MINUTES) + EVENT_RUN_DAY_MINUTES) % EVENT_RUN_DAY_MINUTES,
  };
}

// Notice for a `\p` (extend), `\o` (later), or `\O` (earlier) rewrite of the
// timed Pomodoro at `lineIndex`; null for shrinks, MEET sessions, or no new
// crossing. `oldRange` and `newRange` are parseTimeRange results.
function eventRunRewriteNotice(lines, lineIndex, kind, oldRange, newRange) {
  try {
    if (!oldRange || !newRange || !["extend", "later", "earlier"].includes(kind)) return null;
    const name = eventRunLineName(String(lines[lineIndex] || ""));
    if (eventRunIsMeetName(name)) return null;
    const span = eventRunSpan(newRange.startMinutes, newRange.endMinutes);
    const old = eventRunSpan(oldRange.startMinutes, oldRange.endMinutes);
    const crossed = eventRunNewCrossings(lines, lineIndex, span, old);
    if (crossed.length === 0) return null;
    return eventRunConflictNotice(name, span, crossed, eventRunFitToken(kind, span, old, crossed[0]));
  } catch (error) {
    return null;
  }
}

// Apply bob capture's MEET, clock, and run-past-event rules to an `se<X>`
// expansion on the ledger line `lineIndex` of `lines` (the document before the
// expansion). Returns { expansion, notices, offClock, eventRun }. A MEET with
// an event run takes that run's span and clock; every other session (and a
// MEET with no run) keeps its span and takes the clock of its counted lineup.
// `options.resolveTask(link)` returns the full line of another note's task
// (or null), so the rule can read other-note Task Links.
function applyEventRunToExpansion(lines, lineIndex, expansion, now = new Date(), options = {}) {
  const result = { expansion, notices: [], offClock: false, eventRun: null };
  try {
    if (!expansion || !Array.isArray(lines) || typeof expansion.range !== "string") return result;
    const trigger = parseTrigger(expansion.trigger);
    if (!trigger || trigger.kind !== "ledgerRange") return result;
    const section = findPomodorosSection(lines);
    const lineText = String(lines[lineIndex] || "");
    if (!section || lineIndex < section.startLine || lineIndex > section.endLine || !parseLedgerLine(lineText)) {
      return result;
    }
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const base = computeRange(now, trigger.durationMultiplier, trigger.offsetMultiplier, trigger.dashPresent);
    const written = lineText.slice(0, expansion.fromCh) + expansion.replacement + lineText.slice(expansion.toCh);
    const name = eventRunLineName(written);
    const suffix = expansion.replacement.slice(expansion.range.length);
    if (eventRunIsMeetName(name)) {
      const run = computeMeetEventRun(lines, lineIndex, nowMinutes);
      if (run) {
        result.offClock = run.offClock;
        let startMinutes = base.startMinutes;
        let endMinutes = base.endMinutes;
        let durationMinutes = base.durationMinutes;
        let source = "explicit";
        if (expansion.trigger === "se") {
          const closedEnd = eventRunLatestClosedEnd(lines);
          startMinutes = closedEnd !== null && closedEnd > run.startMin && closedEnd < run.endMin ? closedEnd : run.startMin;
          endMinutes = run.endMin;
          durationMinutes = endMinutes - startMinutes;
          source = "calendar";
          if (startMinutes - nowMinutes > EVENT_RUN_FAR_MINUTES) {
            const firstEvent = run.events[0].event;
            const title = eventBufferIsEmpty(firstEvent.buffer)
              ? firstEvent.title
              : eventRunWithBufferLabel(firstEvent.title, firstEvent.timeRange, firstEvent.buffer);
            result.notices.push({
              code: "pomodoro_event_run_later",
              message: `MEET's next event, ${title}, starts at ${eventRunHhmm(startMinutes)} (${eventRunHumanize(startMinutes - nowMinutes)} from now) · type \`se5\` to start 25 minutes now`,
            });
          }
        }
        const metadata = ` ${run.offClock ? formatOffClockField(durationMinutes) : formatDurationField(durationMinutes)}`;
        const range = formatTimeRange(startMinutes, endMinutes, "compact", metadata);
        result.expansion = { ...expansion, range, replacement: range + suffix };
        result.eventRun = {
          timeRange: `${eventRunHhmm(startMinutes)}-${eventRunHhmm(endMinutes)}`,
          offClock: run.offClock,
          source,
        };
        return result;
      }
    }
    // MEET sessions never warn about running into an event; every other
    // session does when it newly crosses one.
    if (!eventRunIsMeetName(name)) {
      const rest = lineText.slice(0, expansion.fromCh) + lineText.slice(expansion.toCh);
      const previous = parseTimeRange(rest);
      const old = previous ? eventRunSpan(previous.startMinutes, previous.endMinutes) : null;
      const span = eventRunSpan(base.startMinutes, base.endMinutes);
      const crossed = eventRunNewCrossings(lines, lineIndex, span, old);
      if (crossed.length > 0) {
        const fit = eventRunFitToken("start", span, old, crossed[0], trigger.offsetMultiplier);
        result.notices.push(eventRunConflictNotice(name, span, crossed, fit));
      }
    }
    // Which clock the lineup puts this session on: all #offclock links write
    // [off::]; an unlinked, mixed, or unresolved lineup stays worked.
    const lineup = pomodoroLineupClock(lines, lineIndex, options.resolveTask, name);
    if (lineup.notice) result.notices.push(lineup.notice);
    if (lineup.offClock) {
      result.offClock = true;
      const range = formatTimeRange(base.startMinutes, base.endMinutes, "compact", ` ${formatOffClockField(base.durationMinutes)}`);
      result.expansion = { ...expansion, range, replacement: range + suffix };
    }
    return result;
  } catch (error) {
    return { expansion, notices: [], offClock: false, eventRun: null };
  }
}
