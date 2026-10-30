// Event Task clock close (plan:202610/bob_gcal_daily_events.md, phase
// event-close-js). Mirrors bob-cli's `src/native/event_task.rs` and the clock
// half of `capture_pomodoro_close/selection.rs`: on a timed Ctrl+Enter
// Pomodoro completion, a bare plain Task Link to an Event Task in the same
// canonical daily note's `## Events` section is rewritten before the normal
// completion flow so the existing machinery produces the clock outcome. An
// `ended_inside` link gains an embedded `!` prefix (completed, never carried:
// the same `![[...]]` bytes Rust writes for a Complete outcome) and a
// `not_started` / `ended_before` link gains an authored-style `#` deferral
// (carried, never started: the same `[[...]]#` bytes Rust writes for a
// Deferred outcome). A `running` link is left alone (started and carried, as
// today). Embedded links, authored `#` deferrals, foreign-note links, and
// untimed `()` closes keep their existing behavior, exactly as in Rust.
//
// bob-cli owns `tests/fixtures/event_task_close/vectors.json`; the copy under
// `plugins/task-status-cycler/scripts/fixtures/event_task_close/` is
// byte-for-byte identical and is never hand-edited. Every `classify` case and
// every `close` case not marked `rust_only` applies here.

const EVENT_TASK_CLOCK_MINUTES_PER_DAY = 24 * 60;

function parseEventTaskClockHhmm(value) {
  const text = String(value || "");
  if (text.length !== 4 || !/^\d{4}$/.test(text)) {
    return null;
  }
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(2));
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

// Mirrors `event_task::parse_event_span`: a `#task` line (with an optional
// `#task` tag) whose text starts with `**HHMM-HHMM**`. Returns
// `{ startMin, endMin, crossesMidnight }` or null.
function parseEventTaskClockSpan(lineText) {
  let body = String(lineText || "").replace(/^[ \t]+/, "");
  if (!body.startsWith("- ")) {
    return null;
  }
  body = body.slice(2);
  if (!body.startsWith("[")) {
    return null;
  }
  const close = body.indexOf("]");
  if (close === -1) {
    return null;
  }
  if ([...body.slice(1, close)].length !== 1) {
    return null;
  }
  body = body.slice(close + 1).replace(/^[ \t]+/, "");
  if (body.startsWith("#task")) {
    body = body.slice("#task".length).replace(/^[ \t]+/, "");
  }
  if (!body.startsWith("**")) {
    return null;
  }
  const raw = body.slice(2, 11);
  if (raw.length !== 9 || raw[4] !== "-") {
    return null;
  }
  if (body.slice(11, 13) !== "**") {
    return null;
  }
  const after = body.slice(13);
  if (after !== "" && after[0] !== " " && after[0] !== "\t") {
    return null;
  }
  for (let index = 0; index < 9; index += 1) {
    if (index === 4) {
      continue;
    }
    const char = raw[index];
    if (char < "0" || char > "9") {
      return null;
    }
  }
  const startMin = parseEventTaskClockHhmm(raw.slice(0, 4));
  const endMin = parseEventTaskClockHhmm(raw.slice(5, 9));
  if (startMin === null || endMin === null) {
    return null;
  }
  return { startMin, endMin, crossesMidnight: endMin < startMin };
}

function eventTaskClockEndOnTimeline(span) {
  return span.endMin + (span.crossesMidnight ? EVENT_TASK_CLOCK_MINUTES_PER_DAY : 0);
}

// Mirrors `event_task::classify`, including its test order: `ended_before`
// is checked before `not_started`.
function classifyEventTaskClockSpan(span, sessionStartMin, closeAtMin) {
  const start = span.startMin;
  let close = closeAtMin;
  if (close < sessionStartMin) {
    close += EVENT_TASK_CLOCK_MINUTES_PER_DAY;
  }
  const end = eventTaskClockEndOnTimeline(span);
  if (end <= sessionStartMin) {
    return "ended_before";
  }
  if (start >= close) {
    return "not_started";
  }
  if (end <= close) {
    return "ended_inside";
  }
  return "running";
}

// Mirrors `markdown::strictly_closed_frontmatter_end`: the 0-based index of
// the closing `---` when the file opens with one, else -1.
function eventTaskClockFrontmatterEnd(lines) {
  if (String(lines[0] || "").replace(/[ \t\r\n]+$/, "") !== "---") {
    return -1;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (String(lines[index] || "").replace(/[ \t\r\n]+$/, "") === "---") {
      return index;
    }
  }
  return -1;
}

// Mirrors `markdown::fence_marker`: up to 3 leading spaces, then a run of at
// least 3 backticks or tildes.
function eventTaskClockFenceMarker(lineText) {
  const line = String(lineText || "");
  let indentation = 0;
  while (line[indentation] === " ") {
    indentation += 1;
  }
  if (indentation > 3) {
    return null;
  }
  const rest = line.slice(indentation);
  const character = rest[0];
  if (character !== "`" && character !== "~") {
    return null;
  }
  let length = 0;
  while (rest[length] === character) {
    length += 1;
  }
  return length >= 3 ? { character, length } : null;
}

// Mirrors `markdown::closes_fence`.
function eventTaskClockClosesFence(lineText, open) {
  const marker = eventTaskClockFenceMarker(lineText);
  if (!marker) {
    return false;
  }
  const trimmed = String(lineText || "").replace(/^[ \t]+/, "");
  return marker.character === open.character &&
    marker.length >= open.length &&
    trimmed.slice(marker.length).trim() === "";
}

function isEventTaskClockEventsHeading(lineText) {
  const line = String(lineText || "");
  if (!line.startsWith("##")) {
    return false;
  }
  const rest = line.slice(2);
  if (rest[0] !== " " && rest[0] !== "\t") {
    return false;
  }
  return rest.trim() === "Events";
}

function isEventTaskClockLevelTwoHeading(lineText) {
  const line = String(lineText || "");
  if (!line.startsWith("##")) {
    return false;
  }
  const rest = line.slice(2);
  return rest[0] === " " || rest[0] === "\t";
}

// Mirrors `event_task::events_section_range` plus `markdown::fenced_lines`:
// the half-open `## Events` body range and the set of fenced line numbers.
function scanEventTaskClockLines(lines) {
  const frontmatterEnd = eventTaskClockFrontmatterEnd(lines);
  let sectionStart = null;
  let fence = null;
  const fenced = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (frontmatterEnd !== -1 && index <= frontmatterEnd) {
      continue;
    }
    const line = String(lines[index] || "");
    if (fence) {
      fenced.add(index);
      if (eventTaskClockClosesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = eventTaskClockFenceMarker(line);
    if (open) {
      fenced.add(index);
      fence = open;
      continue;
    }
    if (sectionStart !== null) {
      if (isEventTaskClockLevelTwoHeading(line)) {
        return { start: sectionStart, end: index, fenced };
      }
    } else if (isEventTaskClockEventsHeading(line)) {
      sectionStart = index + 1;
    }
  }
  return sectionStart === null
    ? { start: null, end: lines.length, fenced }
    : { start: sectionStart, end: lines.length, fenced };
}

// Mirrors `event_task::event_task_by_id`: the single `## Events` row carrying
// `^blockId`, or null when there is none, more than one, or the row is not an
// Event Task. Callers check `isDailyNotePath` first, as `event_task_at` does.
function findEventTaskClockSpanById(lines, blockId) {
  const id = String(blockId || "");
  if (id === "") {
    return null;
  }
  const scan = scanEventTaskClockLines(lines);
  if (scan.start === null) {
    return null;
  }
  const suffix = `^${id}`;
  let found = null;
  for (let index = scan.start; index < scan.end; index += 1) {
    const trimmed = String(lines[index] || "").replace(/[ \t\r\n]+$/, "");
    if (!trimmed.endsWith(suffix)) {
      continue;
    }
    const before = trimmed.slice(0, trimmed.length - suffix.length);
    const last = before[before.length - 1];
    if (last !== " " && last !== "\t") {
      continue;
    }
    if (scan.fenced.has(index)) {
      continue;
    }
    const span = parseEventTaskClockSpan(lines[index]);
    if (!span) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    found = span;
  }
  return found;
}

// Session start/end minutes from a Pomodoro headline's time range, or null
// for a placeholder `()` close or an unparseable range. `rangeText` comes
// from `parsePomodoroEntryLineParts`, which already validated that the range
// opens the entry body.
function parseEventTaskClockSessionRange(rangeText) {
  const match = String(rangeText || "").match(
    /(\d\d):?(\d\d)\s*-\s*(\d\d):?(\d\d)/,
  );
  if (!match) {
    return null;
  }
  const startMin = parseEventTaskClockHhmm(`${match[1]}${match[2]}`);
  const endMin = parseEventTaskClockHhmm(`${match[3]}${match[4]}`);
  if (startMin === null || endMin === null) {
    return null;
  }
  return { startMin, endMin };
}

// Mirrors `close_clock_for_entry` with the Ctrl+Enter close-time rule: now
// when the note is today's note, otherwise the session's written end. An
// untimed `()` close and a non-daily note have no clock.
function resolveEventTaskCloseClock(options = {}) {
  const sourcePath = options.sourcePath;
  if (!isDailyNotePath(sourcePath)) {
    return null;
  }
  const parsed = parsePomodoroEntryLineParts(options.headline);
  if (!parsed || parsed.placeholder) {
    return null;
  }
  const range = parseEventTaskClockSessionRange(parsed.rangeText);
  if (!range) {
    return null;
  }
  let closeAtMin;
  if (sourcePath === options.todayPath) {
    if (
      !Number.isInteger(options.nowMinutes) ||
      options.nowMinutes < 0 ||
      options.nowMinutes > 1439
    ) {
      return null;
    }
    closeAtMin = options.nowMinutes;
  } else {
    closeAtMin = range.endMin;
  }
  return { sessionStartMin: range.startMin, closeAtMin };
}

// The clock pre-pass for Ctrl+Enter Pomodoro completion. Returns
// `{ line, lineText }` rewrites in editor coordinates: `ended_inside` links
// gain `!`, `not_started` / `ended_before` links gain `#`, and `running`
// links are untouched. Only bare plain same-file links to an Event Task are
// considered; the caller applies the rewrites and re-reads the editor before
// the normal completion flow.
function planEventTaskClockRewrites(lines, pomodoroLine, section, options = {}) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(pomodoroLine) ||
    !isPomodoroTaskLine(lines, section, pomodoroLine)
  ) {
    return [];
  }
  const clock = resolveEventTaskCloseClock({
    sourcePath: options.sourcePath,
    headline: lines[pomodoroLine],
    todayPath: options.todayPath,
    nowMinutes: options.nowMinutes,
  });
  if (!clock) {
    return [];
  }
  const range = getSubBulletBlockRange(lines, pomodoroLine, section);
  if (!range) {
    return [];
  }
  const bullets = classifyPomodoroSubBullets(lines, range);
  const rewrites = [];
  for (
    const bullet of bullets.startableNonTranscludedTaskLinkBullets || []
  ) {
    const target = bullet && Array.isArray(bullet.targets)
      ? bullet.targets[0]
      : null;
    if (!target || target.pathPart !== "") {
      continue;
    }
    const span = findEventTaskClockSpanById(lines, target.blockId);
    if (!span) {
      continue;
    }
    const clockClass = classifyEventTaskClockSpan(
      span,
      clock.sessionStartMin,
      clock.closeAtMin,
    );
    if (clockClass === "running") {
      continue;
    }
    const stripped = stripPomodoroMarkersFromLine(lines[bullet.line]);
    const bare = getBareNonEmbeddedBlockLinkTargetFromListItem(stripped);
    if (!bare || bare.blockId !== target.blockId || bare.pathPart !== "") {
      continue;
    }
    if (clockClass === "ended_inside") {
      rewrites.push({
        line: bullet.line,
        lineText: `${stripped.slice(0, bare.startIndex)}!${stripped.slice(bare.startIndex)}`,
      });
    } else {
      rewrites.push({
        line: bullet.line,
        lineText: `${stripped.slice(0, bare.endIndex)}#${stripped.slice(bare.endIndex)}`,
      });
    }
  }
  return rewrites;
}

class TaskStatusCyclerEventTaskClockMixin {
  // Overridable seams for tests (mirrors `getPomodoroWorkLogDateString`).
  getEventTaskClockTodayPath() {
    try {
      return todayDailyPath(this.app);
    } catch (error) {
      return null;
    }
  }

  getEventTaskClockNowMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}
