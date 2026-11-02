// Pomodoro session clock at close (plan:202611/off_clock_pomodoros.md, phase
// plugins-off-clock-ledger). Mirrors bob-cli's counted-links rule and the
// close half of `capture_pomodoro_close/linked_tasks.rs`: a Ctrl+Enter close
// stamps the closed row `[off:: Nm]` iff the links the closed entry keeps
// (counted Task Links, minus the `#`-deferred ones the close carries away) all
// resolve to `#offclock` tasks, and `[t:: Nm]` otherwise. An unlinked session,
// an unresolved link, or one on-clock link keeps the whole session worked.
//
// bob-cli owns `tests/fixtures/pomodoro_clock/vectors.json`; the copy under
// `plugins/task-status-cycler/scripts/fixtures/pomodoro_clock/` is
// byte-for-byte identical and is never hand-edited. Every close vector not
// marked capture-only applies here (a `~K` drop is capture grammar).
//
// bob-ledger-tools carries the same pure rule for `se<X>` starts; deployed
// plugins must not import one another, so this is an intentional copy.

const POMODORO_CLOCK_TAGS = Object.freeze(["#offclock", "#off-clock", "#untracked"]);
const POMODORO_CLOCK_WORKED_FIELD_RE = /\[t::\s*([^\]]*?)\s*\]/i;
const POMODORO_CLOCK_OFF_FIELD_RE = /\[off::\s*([^\]]*?)\s*\]/i;
const POMODORO_CLOCK_FIELD_GLOBAL_RE = /\[(?:t|off)::\s*[^\]]*?\s*\]/gi;
const POMODORO_CLOCK_LEGACY_RE =
  /⏱️?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/i;
const POMODORO_CLOCK_LEGACY_GLOBAL_RE =
  /⏱️?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/gi;
const POMODORO_CLOCK_LINK_RE =
  /^([ \t]+)[-*+][ \t]+(~~[ \t]*)?(!?)(\[\[([^\]|#]*)#\^([A-Za-z0-9-]+)(?:\|[^\]]*)?\]\])([ \t]*~~)?[ \t]*$/;
const POMODORO_CLOCK_MINUTES_PER_DAY = 24 * 60;

function pomodoroClockAsciiLower(text) {
  return String(text || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

// Mirror of event_task.rs `mask_code_and_markdown_links`: code spans and
// Markdown links become spaces of the same length.
function pomodoroClockMaskCodeAndLinks(line) {
  const text = String(line || "");
  const out = text.split("");
  const blank = (from, to) => {
    for (let index = from; index < to && index < out.length; index += 1) out[index] = " ";
  };
  const codeClose = (start, width) => {
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
  };
  const linkEnd = (open) => {
    const rest = text.slice(open + 1);
    const textClose = rest.indexOf("]");
    if (textClose < 0) return null;
    const after = rest.slice(textClose + 1);
    if (!after.startsWith("(")) return null;
    const urlClose = after.slice(1).indexOf(")");
    if (urlClose < 0) return null;
    return open + 1 + textClose + 1 + 1 + urlClose + 1;
  };
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      let width = 0;
      while (text[index + width] === "`") width += 1;
      const close = codeClose(index + width, width);
      if (close !== null) {
        blank(index, close);
        index = close;
        continue;
      }
    }
    if (text[index] === "[") {
      const end = linkEnd(index);
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

// Mirror of bob's `line_has_off_clock_tag`: a standalone `#offclock`,
// `#off-clock`, or `#untracked` token, case-insensitive, whitespace-bounded on
// the left and followed by whitespace, end of line, or one of `])}:.,;!?`, not
// inside a code span or Markdown link. A nested tag (`#offclock/x`) does not
// qualify.
function pomodoroClockLineHasOffClockTag(line) {
  const masked = pomodoroClockMaskCodeAndLinks(line);
  const lower = pomodoroClockAsciiLower(masked);
  for (const needle of POMODORO_CLOCK_TAGS) {
    let search = 0;
    while (search <= lower.length) {
      const at = lower.indexOf(needle, search);
      if (at < 0) break;
      const end = at + needle.length;
      const before = at > 0 ? masked[at - 1] : null;
      const after = end < masked.length ? masked[end] : null;
      const leftOk = before === null || /\s/.test(before);
      const rightOk = after === null || /\s/.test(after) || "])}:.,;!?".includes(after);
      if (leftOk && rightOk) return true;
      search = at + 1;
    }
  }
  return false;
}

function pomodoroClockParseDuration(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  const minuteMatch = /^(\d+)\s*m$/.exec(text);
  if (minuteMatch) return Number.parseInt(minuteMatch[1], 10);
  const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  return (match[1] ? Number.parseInt(match[1], 10) : 0) * 60 + (match[2] ? Number.parseInt(match[2], 10) : 0);
}

function pomodoroClockMinutesFromParts(hours, minutes) {
  const h = Number(hours);
  const m = Number(minutes);
  return h > 23 || m > 59 ? null : h * 60 + m;
}

// The first timed `( … )` range of a ledger line, or null for a placeholder.
function pomodoroClockParseRange(line) {
  const text = String(line || "");
  const colon = POMODORO_COLON_TIME_RANGE_RE.exec(text);
  const compact = colon ? null : POMODORO_COMPACT_TIME_RANGE_RE.exec(text);
  const match = colon || compact;
  if (!match) return null;
  if (Boolean(match[1]) !== Boolean(match[6])) return null;
  const startMinutes = pomodoroClockMinutesFromParts(match[2], match[3]);
  const endMinutes = pomodoroClockMinutesFromParts(match[4], match[5]);
  if (startMinutes === null || endMinutes === null) return null;
  return {
    startCh: match.index,
    endCh: match.index + match[0].length,
    startMinutes,
    endMinutes,
    style: colon ? "colon" : "compact",
    metadata: match[7] || "",
  };
}

function pomodoroClockFormatTime(minutes, style) {
  const wrapped = ((minutes % POMODORO_CLOCK_MINUTES_PER_DAY) + POMODORO_CLOCK_MINUTES_PER_DAY) % POMODORO_CLOCK_MINUTES_PER_DAY;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const rest = String(wrapped % 60).padStart(2, "0");
  return style === "colon" ? `${hours}:${rest}` : `${hours}${rest}`;
}

// Which clock a timed row belongs to (mirror of bob's `session_clock`):
// `[t::]` or the legacy stopwatch is worked, `[off::]` is off the clock, a
// bare timed span is an older off-clock session counted by its span, and a row
// holding both keys is a conflict that reads as worked.
function pomodoroClockSession(line, range = pomodoroClockParseRange(line)) {
  if (!range) {
    return { kind: "placeholder", minutes: null, stamped: false, conflict: false };
  }
  const rangeText = String(line || "").slice(range.startCh, range.endCh);
  const span = ((range.endMinutes - range.startMinutes) % POMODORO_CLOCK_MINUTES_PER_DAY + POMODORO_CLOCK_MINUTES_PER_DAY) % POMODORO_CLOCK_MINUTES_PER_DAY;
  const worked = POMODORO_CLOCK_WORKED_FIELD_RE.exec(rangeText);
  const off = POMODORO_CLOCK_OFF_FIELD_RE.exec(rangeText);
  const legacy = POMODORO_CLOCK_LEGACY_RE.exec(rangeText);
  const workedValue = worked ? pomodoroClockParseDuration(worked[1]) : null;
  const legacyValue = legacy ? pomodoroClockParseDuration(legacy[1]) : null;
  const workedMinutes = workedValue !== null ? workedValue : legacyValue;
  if (worked) {
    return { kind: "worked", minutes: workedMinutes !== null ? workedMinutes : span, stamped: true, conflict: Boolean(off) };
  }
  if (off) {
    const offMinutes = pomodoroClockParseDuration(off[1]);
    return { kind: "off-clock", minutes: offMinutes !== null ? offMinutes : span, stamped: true, conflict: false };
  }
  if (workedMinutes !== null) {
    return { kind: "worked", minutes: workedMinutes, stamped: true, conflict: false };
  }
  return { kind: "off-clock", minutes: span, stamped: false, conflict: false };
}

// Move a timed row between clocks ("worked" | "off-clock"), keeping its
// recorded minutes and other metadata (mirror of bob's `set_ledger_clock`).
// A bare row takes its span as minutes; a conflict resolves to the target.
function setPomodoroLineClock(line, clock) {
  const text = String(line || "");
  const range = pomodoroClockParseRange(text);
  if (!range) return text;
  const current = pomodoroClockSession(text, range);
  if (
    !current.conflict &&
    ((current.kind === "worked" && clock === "worked") ||
      (current.kind === "off-clock" && current.stamped && clock === "off-clock"))
  ) {
    return text;
  }
  const rest = range.metadata
    .replace(POMODORO_CLOCK_FIELD_GLOBAL_RE, "")
    .replace(POMODORO_CLOCK_LEGACY_GLOBAL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  const key = clock === "off-clock" ? "off" : "t";
  const field = `[${key}:: ${Math.max(0, Math.floor(current.minutes))}m]`;
  const metadata = rest ? ` ${field} ${rest}` : ` ${field}`;
  // Like bob's writers, a rewritten range is always the bold clock.
  const next = `(**${pomodoroClockFormatTime(range.startMinutes, range.style)}-${pomodoroClockFormatTime(range.endMinutes, range.style)}**${metadata})`;
  return text.slice(0, range.startCh) + next + text.slice(range.endCh);
}

function pomodoroClockIndent(line) {
  return (/^[ \t]*/.exec(String(line || "")) || [""])[0].length;
}

// The closed entry's counted Task Links, in ledger order: direct-child bullets
// at the first child indentation that hold exactly one block link (plain,
// struck, 🍅-marked, or embedded). A `[[…]]#` deferral is not a bare link, so
// the links the close carries away are already out.
function collectPomodoroClockLinks(lines, entryLine) {
  const links = [];
  const entryIndent = pomodoroClockIndent(lines[entryLine]);
  let childIndent = null;
  let fence = false;
  for (let index = entryLine + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (line.trim() === "" || pomodoroClockIndent(line) <= entryIndent) break;
    if (childIndent === null) childIndent = pomodoroClockIndent(line);
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || pomodoroClockIndent(line) !== childIndent) continue;
    const match = POMODORO_CLOCK_LINK_RE.exec(line.replace(/🍅[ \t]?/g, ""));
    if (!match || Boolean(match[2]) !== Boolean(match[7])) continue;
    links.push({
      embedded: match[3] === "!",
      token: `${match[3]}${match[4]}`,
      pathPart: match[5],
      blockId: match[6],
      line: index,
    });
  }
  return links;
}

// The clock verdict over caller-resolved facts (`offClock`: true, false, or
// null when the link did not resolve to exactly one task).
function pomodoroClockVerdict(facts) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) return { kind: "worked", reason: "unlinked", index: null };
  const unresolved = list.findIndex((fact) => fact.offClock === null || fact.offClock === undefined);
  if (unresolved >= 0) return { kind: "worked", reason: "unresolved", index: unresolved };
  const onClock = list.findIndex((fact) => fact.offClock === false);
  if (onClock >= 0) return { kind: "worked", reason: "mixed", index: onClock };
  return { kind: "off-clock", reason: null, index: null };
}

// Mirror of bob's `close_task_text` label: the task text without tags,
// fields, and the block id.
function pomodoroClockTaskLabel(lineText) {
  const body = String(lineText || "")
    .replace(TASK_LINE_RE, "")
    .replace(/(?:^|\s)\^[A-Za-z0-9-]+\s*$/, "");
  return body
    .split(/\s+/)
    .filter((token) => token && !token.startsWith("#") && !token.startsWith("[") && !token.startsWith("^"))
    .join(" ");
}

// The `pomodoro_clock_mixed` notice, worded like bob capture's warning; null
// unless the lineup holds an off-clock link yet the session stays worked.
function pomodoroClockMixedMessage(name, facts, verdict) {
  const list = Array.isArray(facts) ? facts : [];
  if (verdict.kind === "off-clock" || !list.some((fact) => fact.offClock === true)) return null;
  const label = String(name || "").trim() || "the session";
  let detail = null;
  if (verdict.reason === "unresolved") {
    const link = list[verdict.index];
    detail = `${link && link.token ? link.token : "a Task Link"} does not resolve`;
  } else if (verdict.reason === "mixed") {
    const link = list[verdict.index];
    detail = link && link.text
      ? `it also links ${link.text}`
      : `it also links ${link && link.token ? link.token : "another task"}`;
  }
  return detail === null ? null : `◌ ${label} stays on the clock: ${detail}`;
}

// Decide the clock of the Pomodoro at `entryLine` from its counted links.
// `resolveLine(link)` returns the linked task's full line text, or null when
// the link does not resolve to a task. Returns
// { clock: "worked" | "off-clock", verdict, facts, message }.
async function planPomodoroCloseClock(lines, entryLine, name, resolveLine) {
  const links = collectPomodoroClockLinks(lines, entryLine);
  const facts = [];
  for (const link of links) {
    const fact = { token: link.token, offClock: null, text: null };
    let lineText = null;
    try {
      lineText = await resolveLine(link);
    } catch (error) {
      lineText = null;
    }
    if (typeof lineText === "string") {
      fact.offClock = pomodoroClockLineHasOffClockTag(lineText);
      fact.text = pomodoroClockTaskLabel(lineText);
    }
    facts.push(fact);
  }
  const verdict = pomodoroClockVerdict(facts);
  return {
    clock: verdict.kind === "off-clock" ? "off-clock" : "worked",
    verdict,
    facts,
    message: pomodoroClockMixedMessage(name, facts, verdict),
  };
}

class TaskStatusCyclerPomodoroClockMixin {
  // Seam for tests: the task line a counted Task Link names, read through the
  // same resolver the close uses for linked tasks (the live buffer for the
  // active note, the vault for any other). Null when it does not resolve to a
  // task, which the rule reads as unresolved (the session stays worked).
  async resolvePomodoroClockLinkLine(link, context) {
    const target = await this.resolveTranscludedBlockTarget(
      { pathPart: link.pathPart, blockId: link.blockId },
      context,
      { taskStatusPredicate: (status) => Boolean(status) },
    );
    return target && typeof target.lineText === "string" ? target.lineText : null;
  }

  // The clock to stamp on the Pomodoro being closed, or null when the row is
  // untimed (a `()` placeholder has no key) or the rule could not run.
  async resolvePomodoroCloseClock(lines, entryLine, context) {
    try {
      const headline = String(lines[entryLine] || "");
      if (!pomodoroClockParseRange(headline)) {
        return null;
      }
      const parts = parsePomodoroEntryLineParts(headline);
      return await planPomodoroCloseClock(
        lines,
        entryLine,
        parts && parts.name ? parts.name : "",
        (link) => this.resolvePomodoroClockLinkLine(link, context),
      );
    } catch (error) {
      return null;
    }
  }
}
