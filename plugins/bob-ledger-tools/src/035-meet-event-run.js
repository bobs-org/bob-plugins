// --- Calendar-aware Pomodoro starts: pure mirror of bob capture -----------
// The MEET event run, the `#untracked` trackedness rule, and the
// run-past-event notice. The shared contract is bob-cli's
// tests/fixtures/meet_event_run/vectors.json (copied byte-for-byte under
// scripts/fixtures/meet_event_run/). Everything here reads lines and returns
// text or messages; it never touches the editor.
//
// A timed ledger row WITH `[t:: Nm]` is tracked; a timed row WITHOUT it is an
// untracked session: on the calendar, off the clock.

const EVENT_RUN_FAR_MINUTES = 25;
const EVENT_RUN_DAY_MINUTES = 1440;
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

// Offsets of the first standalone `#untracked` token (case-insensitive,
// whitespace-bounded, not inside a code span or Markdown link), or null.
function eventTaskUntrackedTagRange(line) {
  const masked = eventRunMaskCodeAndLinks(line);
  const lower = eventRunAsciiLower(masked);
  const needle = "#untracked";
  let search = 0;
  while (search <= lower.length) {
    const at = lower.indexOf(needle, search);
    if (at < 0) return null;
    const end = at + needle.length;
    const before = at > 0 ? masked[at - 1] : null;
    const after = end < masked.length ? masked[end] : null;
    const leftOk = before === null || /\s/.test(before);
    const rightOk = after === null || /\s/.test(after) || "])}:.,;!?".includes(after);
    if (leftOk && rightOk) return { start: at, end };
    search = at + 1;
  }
  return null;
}

function eventTaskLineIsUntracked(line) {
  return eventTaskUntrackedTagRange(line) !== null;
}

// Mirror of event_task.rs `clean_event_title`.
function eventRunCleanTitle(after) {
  let title = String(after || "").trim();
  const id = /(?:^|\s)\^[A-Za-z0-9-]+$/.exec(title);
  if (id) title = title.slice(0, id.index).trimEnd();
  for (;;) {
    const trimmed = title.trimEnd();
    const open = trimmed.lastIndexOf("[");
    if (open < 0 || !trimmed.slice(open).includes("::") || !trimmed.endsWith("]")) break;
    title = trimmed.slice(0, open).trimEnd();
  }
  for (;;) {
    const trimmed = title.trimEnd();
    const start = eventRunAsciiLower(trimmed).lastIndexOf("#untracked");
    if (start < 0 || start + "#untracked".length !== trimmed.length) break;
    if (start > 0 && !/\s/.test(trimmed[start - 1])) break;
    title = trimmed.slice(0, start).trimEnd();
  }
  for (;;) {
    const trimmed = title.trimEnd();
    const open = trimmed.lastIndexOf("[");
    if (open < 0 || eventRunMarkdownLinkEnd(trimmed, open) !== trimmed.length) break;
    title = trimmed.slice(0, open).trimEnd();
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
    rows.push({
      lineIndex: index,
      status: match[1],
      open: !"xX-".includes(match[1]),
      startMin,
      endMin,
      endOnTimeline: endMin < startMin ? endMin + EVENT_RUN_DAY_MINUTES : endMin,
      untracked: eventTaskLineIsUntracked(line),
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
// or overlaps it and shares its trackedness. Null when the lineup has none.
function computeMeetEventRun(lines, entryIndex, nowMinutes, rows = eventRunEventRows(lines)) {
  const seen = new Set();
  const candidates = [];
  eventRunQueuedLinks(lines, entryIndex).forEach((link, position) => {
    if (link.embedded || link.pathPart !== "") return;
    const event = eventRunById(rows, link.blockId);
    if (!event) return;
    if (!event.open || event.endOnTimeline <= nowMinutes || event.endOnTimeline <= event.startMin) return;
    if (seen.has(link.blockId)) return;
    seen.add(link.blockId);
    candidates.push({ position, event, number: link.index });
  });
  candidates.sort(
    (left, right) =>
      left.event.startMin - right.event.startMin ||
      left.event.endOnTimeline - right.event.endOnTimeline ||
      left.position - right.position,
  );
  if (candidates.length === 0) return null;
  const first = candidates[0].event;
  const events = [candidates[0]];
  let endMin = first.endOnTimeline;
  for (const next of candidates.slice(1)) {
    if (next.event.startMin > endMin || next.event.untracked !== first.untracked) break;
    endMin = Math.max(endMin, next.event.endOnTimeline);
    events.push(next);
  }
  return { startMin: first.startMin, endMin, untracked: first.untracked, events };
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

// Open Event Tasks whose start the span newly crosses, earliest first.
// `old` ({start, end} or null) is the span before the operator; events in the
// session's own lineup never count.
function eventRunNewCrossings(lines, entryIndex, span, old, rows = eventRunEventRows(lines)) {
  const exclude = new Set(eventRunQueuedLinks(lines, entryIndex).map((link) => link.blockId));
  const rank = (row) =>
    span.end > span.start || row.startMin >= span.start ? [0, row.startMin] : [1, row.startMin];
  return rows
    .filter(
      (row) =>
        row.open &&
        !(row.blockId && exclude.has(row.blockId)) &&
        eventRunStartInSession(row.startMin, span.start, span.end) &&
        !(old && eventRunStartInSession(row.startMin, old.start, old.end)),
    )
    .sort((left, right) => {
      const a = rank(left);
      const b = rank(right);
      return a[0] - b[0] || a[1] - b[1] || left.endOnTimeline - right.endOnTimeline || left.lineIndex - right.lineIndex;
    });
}

function eventRunOverlapMinutes(span, event) {
  const start = span.start;
  let end = span.end;
  if (end <= start) end += EVENT_RUN_DAY_MINUTES;
  let eventStart = event.startMin;
  if (eventStart < start) eventStart += EVENT_RUN_DAY_MINUTES;
  let eventEnd = event.endOnTimeline;
  if (eventEnd <= eventStart) eventEnd += EVENT_RUN_DAY_MINUTES;
  return Math.max(0, Math.min(eventEnd, end) - Math.max(eventStart, start));
}

// Fit draft: the largest same-gesture count that ends at or before the event.
// `kind` is "start" (`se<K>[-<offset>]`), "extend" (`K\p`), "later" (`K\o`),
// or "earlier" (`K\O`); null when no positive count fits.
function eventRunFitToken(kind, span, old, event, offsetUnits = 0) {
  if (kind === "start") {
    const count = Math.floor(eventRunMinutesAhead(span.start, event.startMin) / STEP_MINUTES);
    if (count <= 0) return null;
    return offsetUnits ? `se${count}-${offsetUnits}` : `se${count}`;
  }
  if (kind === "extend" || kind === "later") {
    const count = Math.floor(eventRunMinutesAhead(old.end, event.startMin) / STEP_MINUTES);
    if (count <= 0) return null;
    return kind === "extend" ? `${count}\\p` : `${count}\\o`;
  }
  if (kind === "earlier") {
    const gap = eventRunMinutesAhead(event.startMin, old.start);
    const count = Math.floor((gap - 1) / STEP_MINUTES);
    return gap > 0 && count > 0 ? `${count}\\O` : null;
  }
  return null;
}

// The `pomodoro_runs_past_event` notice, worded like bob capture's warning.
function eventRunConflictNotice(name, span, crossed, fit) {
  const first = crossed[0];
  let message = `⚠ ${name || "session"} ${eventRunHhmm(span.start)}-${eventRunHhmm(span.end)} runs ${eventRunOverlapMinutes(span, first)}m into ${first.title} (${first.timeRange})`;
  if (crossed.length > 1) message += ` and ${crossed.length - 1} more`;
  if (fit) message += ` · ${fit} ends at ${eventRunHhmm(first.startMin)}`;
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

// Apply bob capture's MEET and run-past-event rules to an `se<X>` expansion
// on the ledger line `lineIndex` of `lines` (the document before the
// expansion). Returns { expansion, notices, tracked, eventRun }; the
// expansion is unchanged unless the line is a MEET with an event run.
function applyEventRunToExpansion(lines, lineIndex, expansion, now = new Date()) {
  const result = { expansion, notices: [], tracked: true, eventRun: null };
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
    if (eventRunIsMeetName(name)) {
      const run = computeMeetEventRun(lines, lineIndex, nowMinutes);
      if (!run) return result;
      result.tracked = !run.untracked;
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
          result.notices.push({
            code: "pomodoro_event_run_later",
            message: `MEET's next event, ${run.events[0].event.title}, starts at ${eventRunHhmm(startMinutes)} (${eventRunHumanize(startMinutes - nowMinutes)} from now) · type \`se5\` to start 25 minutes now`,
          });
        }
      }
      const metadata = result.tracked ? ` ${formatDurationField(durationMinutes)}` : "";
      const range = formatTimeRange(startMinutes, endMinutes, "compact", metadata);
      const suffix = expansion.replacement.slice(expansion.range.length);
      result.expansion = { ...expansion, range, replacement: range + suffix };
      result.eventRun = {
        timeRange: `${eventRunHhmm(startMinutes)}-${eventRunHhmm(endMinutes)}`,
        untracked: run.untracked,
        source,
      };
      return result;
    }
    const rest = lineText.slice(0, expansion.fromCh) + lineText.slice(expansion.toCh);
    const previous = parseTimeRange(rest);
    const old = previous ? eventRunSpan(previous.startMinutes, previous.endMinutes) : null;
    const span = eventRunSpan(base.startMinutes, base.endMinutes);
    const crossed = eventRunNewCrossings(lines, lineIndex, span, old);
    if (crossed.length > 0) {
      const fit = eventRunFitToken("start", span, old, crossed[0], trigger.offsetMultiplier);
      result.notices.push(eventRunConflictNotice(name, span, crossed, fit));
    }
    return result;
  } catch (error) {
    return { expansion, notices: [], tracked: true, eventRun: null };
  }
}
