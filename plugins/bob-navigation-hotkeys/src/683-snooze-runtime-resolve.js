// Snooze runtime: pure cursor resolution, card facts, wake placement, and
// wake-report interpretation. Used by one controller (741) serving both Alt+Z
// and the Task Card `z` row; the card phase renders from these facts without
// reimplementing them. Everything here is pure: snapshots in, frozen facts
// out. It never reads the vault, never spawns, and never uses ambient time.
//
// Resolution reuses the planner's identity rules (never basename guesses):
// `identities` accepts the same three shapes the mutation planner takes (a
// resolver function, a Map, an array, or a plain object keyed by
// `target + "\0" + blockId`). Rows and links come from the shared snooze
// twins (`snoozeBlockLinkSpans`, `snoozeIsStruckLink`, `snoozeParseSection`)
// so refusal and matching stay identical to the commit path.
const SNOOZE_RUNTIME_VERSION = 1;

const SNOOZE_RUNTIME_REFUSAL_MESSAGES = Object.freeze({
  not_on_task: "Place the cursor on a task, a Task Link, or a Snoozed row",
  fenced: "Snooze is unavailable inside a code fence",
  prose_mention: "Snooze needs a task or its dedicated Task Link, not a prose mention",
  ambiguous_target: "That link matches more than one task; qualify it before snoozing",
  missing_task: "No task found at the cursor",
  multi_task: "Snooze handles one task; pick a single row",
  event_task: "Calendar Event Tasks cannot be snoozed",
  blocked: "That task is Blocked; clear its prerequisites first",
  done: "That task is already done",
  cancelled: "That task is cancelled",
  not_task: "That row is not an open task",
  no_pomodoros: "Today's note has no Pomodoros section to snooze from",
  needs_naming: "That task needs a block ID before it can be snoozed",
  stale: "The note changed while the card was open; try again",
  day_changed: "The day changed while the card was open; try again",
  ambiguous_buffers: "Open notes are ambiguous; close duplicates and try again",
  unavailable: "Snooze is unavailable here",
});

function snoozeRuntimeRefusal(reason, extra) {
  const message = (extra && extra.message) ||
    SNOOZE_RUNTIME_REFUSAL_MESSAGES[reason] || SNOOZE_RUNTIME_REFUSAL_MESSAGES.unavailable;
  return Object.freeze({ ok: false, refusal: reason, message });
}

function snoozeRuntimeNormalizePath(value) {
  return String(value == null ? "" : value).trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function snoozeRuntimeEligibility(task) {
  if (!task || task.is_task === false) return "not_task";
  if (task.is_event === true) return "event_task";
  const status = String(task.status == null ? "" : task.status).slice(0, 1);
  if (task.blocked === true || status === "?") return "blocked";
  if (status === "x" || status === "X") return "done";
  if (status === "-") return "cancelled";
  if (![" ", "*", "/"].includes(status)) return "not_task";
  return null;
}

// Mirror of the planner's identity mapping: resolver function, Map, array,
// or plain object. Returns the canonical {route, block} or null on any
// ambiguity or miss. Never guesses from a basename.
function snoozeRuntimeMapIdentity(target, blockId, identities, fallbackTask, dailyPath) {
  const queryTarget = String(target == null ? "" : target);
  const queryBlock = String(blockId == null ? "" : blockId);
  const coerce = (value) => {
    if (typeof value === "string") {
      const at = value.lastIndexOf("#^");
      if (at <= 0 || !value.slice(at + 2)) return null;
      return { route: snoozeRuntimeNormalizePath(value.slice(0, at)), block: value.slice(at + 2) };
    }
    if (!value || typeof value !== "object") return null;
    const route = snoozeRuntimeNormalizePath(value.route || value.path);
    const block = String(value.block || value.blockId || value.id || "");
    return route && block ? { route, block } : null;
  };
  if (typeof identities === "function") {
    try {
      return coerce(identities({ target: queryTarget, blockId: queryBlock }));
    } catch (_) {
      return null;
    }
  }
  if (typeof identities === "function") {
    try {
      const answer = identities({ target: queryTarget, blockId: queryBlock });
      if (answer && (answer.ambiguous === true || answer.resolution === "ambiguous")) return null;
      const mapped = coerce(answer);
      if (mapped) return mapped;
    } catch (_) {
      return null;
    }
  }
  const hasIdentities = (identities instanceof Map && identities.size > 0)
    || (Array.isArray(identities) && identities.length > 0)
    || (identities && typeof identities === "object" && !(identities instanceof Map) && Object.keys(identities).length > 0);
  // A path-form link names its note outright and needs no alias map; a bare
  // basename without identities stays unknown rather than guessed.
  const directPath = !hasIdentities && queryTarget.includes("/") && queryBlock
    ? { route: snoozeRuntimeNormalizePath(queryTarget), block: queryBlock }
    : null;
  const key = queryTarget + "\u0000" + queryBlock;
  const collect = (found) => {
    if (found && (found.ambiguous === true || found.resolution === "ambiguous")) return "ambiguous";
    if (found === null || found === undefined) return null;
    return coerce(found);
  };
  if (identities instanceof Map) {
    const mapped = collect(identities.get(key));
    if (mapped === "ambiguous") return null;
    if (mapped) return mapped;
  } else if (Array.isArray(identities)) {
    const candidates = [];
    for (const item of identities) {
      if (!item || String(item.target == null ? "" : item.target) !== queryTarget) continue;
      if (String(item.block || item.blockId || "") !== queryBlock) continue;
      if (item.ambiguous === true || item.resolution === "ambiguous") return null;
      const mapped = coerce(item);
      if (mapped) candidates.push(mapped.route + "#^" + mapped.block);
    }
    const unique = [...new Set(candidates)];
    if (unique.length > 1) return null;
    if (unique.length === 1) {
      const at = unique[0].lastIndexOf("#^");
      return { route: unique[0].slice(0, at), block: unique[0].slice(at + 2) };
    }
  } else if (identities && typeof identities === "object") {
    const mapped = collect(identities[key]);
    if (mapped === "ambiguous") return null;
    if (mapped) return mapped;
  }
  const selected = coerce(fallbackTask);
  if (selected && queryBlock === selected.block) {
    const canonicalTarget = String((fallbackTask && fallbackTask.target) == null ? "" : fallbackTask.target || "");
    if (canonicalTarget !== "" && queryTarget === canonicalTarget) return selected;
    if (queryTarget === "" && snoozeRuntimeNormalizePath(fallbackTask && fallbackTask.path) === snoozeRuntimeNormalizePath(dailyPath)) return selected;
  }
  return directPath;
}

function snoozeRuntimeEntryName(line) {
  const text = String(line || "");
  const dash = text.indexOf("—");
  if (dash === -1) return null;
  const name = text.slice(dash + 1).trim();
  return name || null;
}

function snoozeRuntimeEntryRunning(line) {
  const text = String(line || "");
  return /\*\*\d{4}-\d{4}\*\*/.test(text) || /\(\d{1,2}:\d{2}-\d{1,2}:\d{2}\)/.test(text);
}

// Nearest preceding column-zero list item at or above `lineIndex`, or null
// when the line is not inside a Pomodoros entry subtree.
function snoozeRuntimeEnclosingEntry(lines, lineIndex) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const text = String(lines[index] || "");
    if (/^#{1,6}\s/.test(text)) {
      if (/^##[ \t]+Pomodoros(?:[ \t]|$)/.test(text.trimEnd())) return null;
      return null;
    }
    if (/^##[ \t]+Pomodoros(?:[ \t].*)?$/.test(text.trimEnd())) return null;
    const item = /^([-*+]|\d+[.)])\s+\[.?\]\s+/.exec(text);
    if (!item) continue;
    const indent = (text.match(/^[ \t]*/) || [""])[0].length;
    if (indent === 0) return { lineIndex: index, name: snoozeRuntimeEntryName(text), running: snoozeRuntimeEntryRunning(text) };
    return null;
  }
  return null;
}

function snoozeRuntimeFindPomodorosRange(lines) {
  let header = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^##[ \t]+Pomodoros(?:[ \t].*)?$/.test(String(lines[index] || "").trimEnd())) {
      header = index;
      break;
    }
  }
  if (header === -1) return null;
  let end = lines.length;
  for (let index = header + 1; index < lines.length; index += 1) {
    if (/^##[ \t]+\S/.test(String(lines[index] || "").trimEnd())) {
      end = index;
      break;
    }
  }
  return { header, end };
}

function snoozeRuntimeTaskAt(tasks, path, line) {
  if (!Array.isArray(tasks)) return null;
  const want = snoozeRuntimeNormalizePath(path);
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    if (snoozeRuntimeNormalizePath(task.path || task.route) !== want) continue;
    if (Number(task.line) !== Number(line)) continue;
    return task;
  }
  return null;
}

function snoozeRuntimeAdoptTask(kind, task, extra) {
  const refusal = snoozeRuntimeEligibility(task);
  if (refusal) return snoozeRuntimeRefusal(refusal);
  const block = String((task && (task.block || task.blockId)) || "");
  if (!block) {
    return Object.freeze({
      ok: false,
      refusal: "needs_naming",
      message: SNOOZE_RUNTIME_REFUSAL_MESSAGES.needs_naming,
      kind,
      task: task || null,
    });
  }
  return Object.freeze({
    ok: true,
    kind,
    task,
    identity: Object.freeze({
      route: snoozeRuntimeNormalizePath(task.route || task.path),
      block,
    }),
    needsNaming: false,
    ...(extra || {}),
  });
}

// Resolve one supported cursor context. Snapshot:
// {
//   sourcePath, sourceContents, cursorLine (0-based), dailyPath,
//   explicitTargets (Task Card session array, or null for Alt+Z),
//   tasks (definition records with path/line/block/status flags),
//   identities (planner-shaped map for link/row resolution),
//   dailyContents (today's daily note text; defaults to sourceContents
//     when the cursor is already in the daily note).
// }
// Kinds: definition | live-link | woken-link | history-link | snoozed-row.
// A historical source only identifies the task: writes always target
// today's daily note, which the controller resolves separately.
function resolveSnoozeCursorTarget(snapshot) {
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  const dailyPath = snoozeRuntimeNormalizePath(input.dailyPath);
  if (Array.isArray(input.explicitTargets)) {
    if (input.explicitTargets.length === 0) return snoozeRuntimeRefusal("missing_task");
    if (input.explicitTargets.length > 1) return snoozeRuntimeRefusal("multi_task");
    const only = input.explicitTargets[0];
    const task = only && typeof only === "object" ? only : null;
    if (!task) return snoozeRuntimeRefusal("missing_task");
    return snoozeRuntimeAdoptTask("definition", task, { sourcePath: snoozeRuntimeNormalizePath(task.path || task.route || input.sourcePath) });
  }

  const sourcePath = snoozeRuntimeNormalizePath(input.sourcePath);
  const contents = String(input.sourceContents == null ? "" : input.sourceContents);
  const cursorLine = Math.floor(Number(input.cursorLine));
  const split = splitMarkdownContent(contents);
  const lines = split.lines;
  if (!Number.isInteger(cursorLine) || cursorLine < 0 || cursorLine >= lines.length) {
    return snoozeRuntimeRefusal("not_on_task");
  }
  let contexts = null;
  try {
    contexts = getMarkdownLineContexts(contents);
  } catch (_) {
    contexts = null;
  }
  if (contexts && contexts[cursorLine] && contexts[cursorLine].inFence) {
    return snoozeRuntimeRefusal("fenced");
  }
  const line = String(lines[cursorLine] || "");

  const taskAtCursor = snoozeRuntimeTaskAt(input.tasks, sourcePath, cursorLine);
  let onTaskLine = false;
  try {
    onTaskLine = isObsidianTaskAtLine(contents, cursorLine, contexts || getMarkdownLineContexts(contents), lines);
  } catch (_) {
    onTaskLine = /^\s*[-*+]\s+\[[ xX*?/\-]\]/.test(line);
  }
  if (onTaskLine && taskAtCursor) {
    return snoozeRuntimeAdoptTask("definition", taskAtCursor, { sourcePath });
  }

  // A Snoozed row identifies its task only when the cursor sits on the row
  // itself, which always lives in today's daily note.
  if (sourcePath === dailyPath) {
    const section = snoozeParseSection(contents);
    if (section) {
      const row = section.rows.find((candidate) => candidate.kind === "active" && candidate.lineIndex === cursorLine) || null;
      if (row) {
        const resolved = snoozeRuntimeMapIdentity(row.target, row.blockId, input.identities, null, dailyPath);
        if (!resolved) return snoozeRuntimeRefusal("ambiguous_target");
        const rowTask = (Array.isArray(input.tasks) ? input.tasks : []).find((task) => {
          if (!task || typeof task !== "object") return false;
          const route = snoozeRuntimeNormalizePath(task.route || task.path);
          return route === resolved.route && String(task.block || task.blockId || "") === resolved.block;
        }) || null;
        if (rowTask) {
          const refusal = snoozeRuntimeEligibility(rowTask);
          if (refusal && refusal !== "blocked") return snoozeRuntimeRefusal(refusal);
        }
        const padded = row.minutes != null ? String(row.minutes).padStart(4, "0") : null;
        return Object.freeze({
          ok: true,
          kind: "snoozed-row",
          task: rowTask,
          identity: Object.freeze(resolved),
          needsNaming: false,
          sourcePath,
          row: Object.freeze({ hhmm: row.hhmm != null ? row.hhmm : padded, minutes: row.minutes, target: row.target, blockId: row.blockId }),
        });
      }
    }
  }

  // Spans are parsed from the list body (like the mutation planner), so
  // offsets stay relative to `body`; the line-based struck check maps them
  // back through the bullet prefix.
  let item = null;
  try {
    item = snoozeMarkdownListItem(line);
  } catch (_) {
    item = null;
  }
  let body = item ? item.body : line;
  if (typeof body === "string" && body.startsWith("🍅")) {
    body = body.slice("🍅".length).trimStart();
  }
  // A struck wrapper (`~~[[t#^id]]~~`) and a trailing woken mark
  // (`⏰ woke HH:MM`) still count as the task's dedicated link; prose around
  // the link does not.
  let linkBody = body;
  let struckWrap = false;
  const strikeMatch = /^~~([\s\S]*)~~[ \t]*$/.exec(linkBody.trim());
  if (strikeMatch) {
    linkBody = strikeMatch[1].trim();
    struckWrap = true;
  }
  const wokenSuffix = /[ \t]*⏰[ \t]*woke[ \t]+\d{2}:\d{2}[ \t]*$/.exec(linkBody);
  if (wokenSuffix) linkBody = linkBody.slice(0, wokenSuffix.index).trimEnd();
  let spans = [];
  try {
    spans = snoozeBlockLinkSpans(linkBody) || [];
  } catch (_) {
    spans = [];
  }
  if (spans.length === 1) {
    const span = spans[0];
    const token = linkBody.slice(span.tokenStart, span.end);
    const dedicated = linkBody.slice(0, span.tokenStart).trim() === "" && linkBody.slice(span.end).trim() === "" && token.length > 0;
    if (dedicated) {
      const struck = struckWrap || (() => {
        try {
          const at = line.indexOf(token);
          if (at === -1) return /~~/.test(line);
          return snoozeIsStruckLink(line, { tokenStart: at, end: at + token.length });
        } catch (_) {
          return /~~/.test(line);
        }
      })();
      const wokenMatch = /⏰\s*woke\s+(\d{2}:\d{2})/.exec(line);
      const resolved = snoozeRuntimeMapIdentity(span.target, span.blockId, input.identities, null, dailyPath);
      if (!resolved) return snoozeRuntimeRefusal("ambiguous_target");
      const linkTask = (Array.isArray(input.tasks) ? input.tasks : []).find((task) => {
        if (!task || typeof task !== "object") return false;
        const route = snoozeRuntimeNormalizePath(task.route || task.path);
        return route === resolved.route && String(task.block || task.blockId || "") === resolved.block;
      }) || null;
      const kind = struck ? "history-link" : (wokenMatch ? "woken-link" : "live-link");
      if (linkTask && !struck) {
        const refusal = snoozeRuntimeEligibility(linkTask);
        if (refusal) return snoozeRuntimeRefusal(refusal);
      }
      const enclosing = snoozeRuntimeEnclosingEntry(lines, cursorLine);
      return Object.freeze({
        ok: true,
        kind,
        task: linkTask,
        identity: Object.freeze(resolved),
        needsNaming: false,
        sourcePath,
        historical: struck,
        wakeTime: wokenMatch ? wokenMatch[1] : null,
        sourcePomodoro: enclosing ? enclosing.name : null,
      });
    }
  }
  if (spans.length > 1) return snoozeRuntimeRefusal("prose_mention");
  let parsed = null;
  try {
    parsed = parseLinkPickerTaskLink(line);
  } catch (_) {
    parsed = null;
  }
  if (!parsed && /(\[\[[^\]]+#\^[A-Za-z0-9-]+\]\])/.test(line)) return snoozeRuntimeRefusal("prose_mention");
  return snoozeRuntimeRefusal(onTaskLine ? "missing_task" : "not_on_task");
}

// Pure never-running wake destination projection. Mirrors
// `pomodoro_themes::routing::place` with `never_running: true` plus the
// untyped fallback: untimed exact type, untimed containing type, otherwise a
// next-up placeholder; without a type the first untimed entry wins, else a
// bare fallback. Footer only: it never writes.
function projectSnoozeWakeDestination(input) {
  const options = input && typeof input === "object" ? input : {};
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const open = entries.filter((entry) => entry && entry.open === true);
  const untimed = open.filter((entry) => entry.running !== true);
  const normalize = (value) => String(value == null ? "" : value).trim().toLowerCase();
  const splitComponents = (name) => String(name == null ? "" : name).split("+").map((part) => normalize(part)).filter(Boolean);
  const exempt = new Set((Array.isArray(options.exempt) ? options.exempt : []).map((value) => normalize(value)));
  const typeKey = options.typeKey == null || String(options.typeKey).trim() === "" ? null : normalize(options.typeKey);
  const typeName = options.typeName == null || String(options.typeName).trim() === "" ? null : String(options.typeName).trim();
  const keptIsExact = (name) => {
    const kept = splitComponents(name).filter((part) => part === typeKey || !exempt.has(part));
    return kept.length === 1 && kept[0] === typeKey;
  };
  if (typeKey) {
    const exact = untimed.find((entry) => keptIsExact(entry.name));
    if (exact) return Object.freeze({ kind: "entry", name: exact.name, created: false });
    const containing = untimed.find((entry) => splitComponents(entry.name).includes(typeKey));
    if (containing) return Object.freeze({ kind: "entry", name: containing.name, created: false });
    return Object.freeze({ kind: "create", name: typeName || String(options.typeKey).trim(), created: true });
  }
  const first = untimed[0];
  if (first) return Object.freeze({ kind: "entry", name: first.name, created: false });
  return Object.freeze({ kind: "create", name: null, created: true });
}

// Pure card facts from explicit provider snapshots. Anything a provider did
// not supply is reported as unavailable text, never an invented zero or
// destination: `unavailable` names the missing providers.
function buildSnoozeCardFacts(input) {
  const options = input && typeof input === "object" ? input : {};
  const unavailable = [];
  const zone = typeof options.zone === "string" && options.zone ? options.zone : null;
  if (!zone) unavailable.push("zone");
  const dateText = typeof options.dateText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.dateText) ? options.dateText : null;
  if (!dateText) unavailable.push("date");
  const nowMinutes = Number.isInteger(options.nowMinutes) ? options.nowMinutes : null;
  const nowText = typeof options.nowText === "string" && options.nowText ? options.nowText : (nowMinutes != null ? String(Math.floor(nowMinutes / 60)).padStart(2, "0") + ":" + String(nowMinutes % 60).padStart(2, "0") : null);
  if (nowMinutes == null) unavailable.push("clock");
  const events = Array.isArray(options.events) ? options.events.map((event) => Object.freeze({
    title: String((event && event.title) || "Event"),
    startMin: Number.isInteger(event && event.startMin) ? event.startMin : null,
    endMin: Number.isInteger(event && event.endMin) ? event.endMin : null,
  })) : null;
  if (!events) unavailable.push("events");
  const activeRow = options.activeRow && typeof options.activeRow === "object" ? Object.freeze({
    hhmm: typeof options.activeRow.hhmm === "string" ? options.activeRow.hhmm : null,
    minutes: Number.isInteger(options.activeRow.minutes) ? options.activeRow.minutes : null,
    state: typeof options.activeRow.state === "string" ? options.activeRow.state : null,
    blockedReason: typeof options.activeRow.blockedReason === "string" ? options.activeRow.blockedReason : null,
  }) : null;
  if (options.wantRow === true && !activeRow) unavailable.push("snoozed-row");
  const task = options.task && typeof options.task === "object" ? Object.freeze({
    typeKey: typeof options.task.typeKey === "string" ? options.task.typeKey : null,
    typeName: typeof options.task.typeName === "string" ? options.task.typeName : null,
    offClock: options.task.offClock === true,
    status: typeof options.task.status === "string" ? options.task.status : null,
    blockedReason: typeof options.task.blockedReason === "string" ? options.task.blockedReason : null,
  }) : null;
  if (options.wantTask === true && !task) unavailable.push("task");
  const sourcePomodoro = typeof options.sourcePomodoro === "string" ? options.sourcePomodoro : null;
  let counts = null;
  if (options.onClock && typeof options.onClock === "object" && Number.isInteger(options.onClock.count) && Number.isInteger(options.onClock.cap)) {
    counts = Object.freeze({ count: options.onClock.count, cap: options.onClock.cap, over: options.onClock.count > options.onClock.cap });
  } else if (options.wantCounts === true) {
    unavailable.push("plan-budget");
  }
  const destination = projectSnoozeWakeDestination({
    entries: options.ledgerEntries,
    typeKey: task ? task.typeKey : null,
    typeName: task ? task.typeName : null,
    exempt: options.exempt,
  });
  return Object.freeze({
    dateText, nowText, nowMinutes, zone, events, activeRow, task,
    sourcePomodoro,
    counts,
    destination,
    unavailable: Object.freeze(unavailable),
  });
}

// Pure wake-report policy shared by the controller and its tests. The local
// 8-second Notice fires only for a nonempty `woken` list the vault did not
// already announce (`notified: none`); every other report is not success.
function interpretSnoozeWakeReport(input) {
  const options = input && typeof input === "object" ? input : {};
  if (options.unavailable === true) {
    return Object.freeze({ outcome: "unavailable", notice: false, noticeText: null, refresh: false, message: "Wake now needs the desktop app; the row stays snoozed" });
  }
  if (options.unsupported === true) {
    return Object.freeze({ outcome: "unsupported", notice: false, noticeText: null, refresh: false, message: "That bob is too old to wake; update bob and try again" });
  }
  if (options.timeout === true) {
    return Object.freeze({ outcome: "timeout", notice: false, noticeText: null, refresh: false, message: "bob snooze wake timed out; the row stays snoozed, try again" });
  }
  const decoded = options.decoded;
  if (!decoded || typeof decoded !== "object" || decoded.ok !== true || !decoded.report) {
    const code = (decoded && decoded.code) || "bad-report";
    return Object.freeze({ outcome: "invalid", notice: false, noticeText: null, refresh: false, message: "bob snooze wake returned an unexpected report (" + code + "); the row stays snoozed" });
  }
  const report = decoded.report;
  if (report.status === "deferred") {
    return Object.freeze({ outcome: "deferred", notice: false, noticeText: null, refresh: false, message: "Wake held for a calendar meeting; it runs after" });
  }
  if (report.status === "skipped" || report.status === "nothing_due") {
    return Object.freeze({ outcome: String(report.status), notice: false, noticeText: null, refresh: false, message: "Nothing woke; the row stays snoozed" });
  }
  if (report.status === "woke" && Array.isArray(report.woken) && report.woken.length > 0) {
    const notice = report.notified === "none";
    let noticeText = null;
    if (notice) {
      noticeText = report.woken.length > 1
        ? "⏰ " + report.woken.length + " snoozed tasks are ready"
        : "⏰ Ready now: " + String(report.woken[0].title || "task") + " · woke " + String(report.woken[0].woke_at || "");
    }
    return Object.freeze({ outcome: "woke", notice, noticeText, refresh: true, message: noticeText || "Woke " + report.woken.length + " task" + (report.woken.length === 1 ? "" : "s") });
  }
  return Object.freeze({ outcome: "no-op", notice: false, noticeText: null, refresh: false, message: "Nothing woke; the row stays snoozed" });
}

