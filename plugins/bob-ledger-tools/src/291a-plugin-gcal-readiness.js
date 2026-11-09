// Create-hook readiness: a rendered, settled daily note plus sync notices.
// A raw Templater copy already contains `## Pomodoros`, so the hook waits for
// a note with no pending `<% … %>` tag (the same rule as bob's
// unrendered-note guard) and then requires one more identical ready read at
// least GCAL_EVENTS_SETTLE_MS later before spawning `bob gcal sync`.

const GCAL_EVENTS_SETTLE_MS = 500;

function gcalEventsStripInlineCode(line) {
  let text = String(line || "");
  let previous = null;
  while (text !== previous) {
    previous = text;
    text = text.replace(/(`+)[^`]*?\1/, "");
  }
  return text;
}

function gcalEventsFindPendingTag(source) {
  const lines = String(source == null ? "" : source).replace(/\r\n/g, "\n").split("\n");
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
    // Frontmatter stays in scope: a tag there is still unrendered output.
    if (gcalEventsStripInlineCode(line).includes("<%")) {
      return { line: index + 1, excerpt: line.trim().slice(0, 60) };
    }
  }
  return null;
}

function gcalEventsNoteReady(contents) {
  const text = String(contents == null ? "" : contents);
  if (!gcalEventsHasPomodorosSection(text)) return false;
  return gcalEventsFindPendingTag(text) == null;
}

async function gcalEventsWaitForRenderedNote(read, options = {}) {
  if (typeof read !== "function") return false;
  const opts = options && typeof options === "object" ? options : {};
  const timeout = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : GCAL_EVENTS_WAIT_MS;
  const poll = Number.isFinite(opts.pollMs) ? Math.max(0, opts.pollMs) : GCAL_EVENTS_POLL_MS;
  const settle = Number.isFinite(opts.settleMs) ? Math.max(0, opts.settleMs) : GCAL_EVENTS_SETTLE_MS;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const delayFn = typeof opts.delay === "function"
    ? opts.delay
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = now() + timeout;
  let settled = null;
  while (true) {
    let ready = false;
    let contents = "";
    try {
      contents = String(await read());
      ready = gcalEventsNoteReady(contents);
    } catch (error) {
      settled = null;
    }
    if (ready) {
      if (settle <= 0) return true;
      if (settled && settled.contents === contents) {
        if (now() - settled.at >= settle) return true;
      } else {
        settled = { contents, at: now() };
      }
    } else {
      settled = null;
    }
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await delayFn(Math.min(poll, remaining));
  }
}

// Export alias: existing callers and tests keep working unchanged.
function gcalEventsWaitForPomodoros(read, options) {
  return gcalEventsWaitForRenderedNote(read, options);
}

function gcalEventsSyncArgs() {
  return ["gcal", "sync", "-q", "--format", "json"];
}

function gcalEventsWaitingNoticeText() {
  return "Calendar sync is waiting for Templater to render today's note · run `bob gcal sync` when it's ready";
}

function gcalEventsHeldNoticeText() {
  return "Calendar sync held: today's Events section was replaced · run `bob gcal sync -F`";
}

function gcalEventsShowOncePerDayNotice(state, day, text, options = {}) {
  try {
    if (!state || typeof state !== "object") return false;
    if (!state.gcalSyncNoticeDays) state.gcalSyncNoticeDays = new Set();
    if (state.gcalSyncNoticeDays.has(day)) return false;
    state.gcalSyncNoticeDays.add(day);
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.notice === "function") opts.notice(text);
    else new Notice(text);
  } catch (error) {}
  return true;
}

function gcalEventsShowWaitingNotice(state, report, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  if (!report || report.status !== "waiting") return false;
  const waiting = report.waiting && typeof report.waiting === "object" ? report.waiting : null;
  if (!waiting || waiting.reason !== "note_unrendered") return false;
  const now = opts.now instanceof Date ? opts.now : new Date();
  return gcalEventsShowOncePerDayNotice(state, formatLocalDate(now), gcalEventsWaitingNoticeText(), opts);
}

function gcalEventsShowHeldNotice(state, report, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  if (!report || report.status !== "held") return false;
  const now = opts.now instanceof Date ? opts.now : new Date();
  return gcalEventsShowOncePerDayNotice(state, formatLocalDate(now), gcalEventsHeldNoticeText(), opts);
}
