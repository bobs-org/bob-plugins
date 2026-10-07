// ---------------------------------------------------------------------------
// task-link-lane: toggle a Pomodoro Task Link's target between Next (`*`) and
// In Progress (`/`) (plan 202610/in_progress_task_link_marks.md §6).
//
// `isPomodoroTaskLinkLine` is the single definition of "Pomodoro Task Link
// line" shared by nav's `api.taskLinkLane.matches` and task-status-cycler's
// Alt+[ / Alt+] delegation, so the two plugins can never disagree. The mode
// is decided once across all note groups (`decideTaskLinkLaneMode`: start
// wins), each group is planned with `planTaskLinkLaneBatch` (shaped like
// `planTaskLaneBatch`), and `buildTaskLinkLaneNotice` renders the D5/L1-L8
// notices. `taskLinkLanePromptState` drives the Move to Next prompt.
// ---------------------------------------------------------------------------

// True when `line` (0-based) of `content` is a Pomodoro Task Link line: the
// path has daily-note shape, the line is unfenced, it carries no checkbox, it
// is accepted by `parseLinkPickerTaskLink` (a dedicated bullet: plain, 🍅,
// `#` move-only, struck, or embedded), and it sits inside a Pomodoro entry's
// sub-bullet block within `## Pomodoros`. The entry may be open or closed:
// toggling from a 🍅 history line changes the task, never the line. Never
// throws.
function isPomodoroTaskLinkLine(content, line, path) {
  try {
    if (!canonicalRecoveryDailyDate(path)) {
      return false;
    }
    const text = String(content || "");
    const source = splitMarkdownContent(text);
    const index = Math.floor(numericOrDefault(line, Number.NaN));
    if (
      !Number.isFinite(index) ||
      index < 0 ||
      index >= source.lines.length
    ) {
      return false;
    }
    const contexts = getMarkdownLineContexts(text);
    const context = contexts[index] || {};
    if (context.inFence || context.inFrontmatter) {
      return false;
    }
    // Any checkbox line stays on its legacy behavior — including `[x] [[…]]`
    // checklist rows without `#task`, which `parseLinkPickerTaskLink` would
    // otherwise accept (D4). This is broader than `isObsidianTaskAtLine`.
    if (OBSIDIAN_TASK_LINE_RE.test(String(source.lines[index] || ""))) {
      return false;
    }
    if (!parseLinkPickerTaskLink(source.lines[index])) {
      return false;
    }
    return Boolean(findPomodoroBulletContext(text, index));
  } catch (error) {
    return false;
  }
}

// Decide the toggle mode once across every target status: start wins (any
// Next target starts), otherwise pause (any In Progress target pauses),
// otherwise null (the batch is refused with the first target's D5 message).
// `statuses` are single checkbox characters (or null). Never throws.
function decideTaskLinkLaneMode(statuses) {
  try {
    const list = Array.isArray(statuses) ? statuses : [];
    if (list.some((status) => status === "*")) {
      return "start";
    }
    if (list.some((status) => status === "/")) {
      return "pause";
    }
    return null;
  } catch (error) {
    return null;
  }
}

// The D5 refusal Notice text for one target status, or null when the status
// toggles (`*` or `/`). Unknown statuses get a neutral refusal.
function taskLinkLaneRefusalFor(status) {
  switch (String(status ?? "")) {
    case "*":
    case "/":
      return null;
    case " ":
      return "Task is Ready · Alt+N commits it to Next";
    case "?":
      return "Blocked is derived · clear its dependency or future schedule first";
    case "x":
    case "X":
      return "Task is done · Ctrl+Enter reopens it";
    case "-":
      return "Task is cancelled";
    default:
      return "Task is not open · only Next and In Progress toggle";
  }
}

// Truncate a task label to about 60 characters with `…`.
function truncateTaskLinkLaneLabel(value) {
  const text = String(value === null || value === undefined ? "" : value);
  if (text.length <= 60) {
    return text;
  }
  return `${text.slice(0, 59).trimEnd()}…`;
}

// Plan a two-state Next <-> In Progress toggle across the task lines of one
// note's content. `mode` ("start" or "pause") is passed in, decided once
// across groups by `decideTaskLinkLaneMode` — never per-group. Start moves
// every Next (`*`) target to In Progress (`/`); pause moves every In Progress
// (`/`) target to Next (`*`) and writes `insertLaneWorkLogEntry` for each
// paused task when the summary is non-blank. Ready, Blocked, and closed
// targets are skipped and counted, never written. Stale preimages (a line
// changed or stopped being a task) refuse the whole batch. Writes apply
// bottom-up and the freshness stamp is the last line transformation. Pure
// and CRLF-preserving, shaped like `planTaskLaneBatch`.
function planTaskLinkLaneBatch(content, session, options = {}) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const mode = options && options.mode === "pause" ? "pause" : options && options.mode === "start" ? "start" : null;
  const targets =
    session && Array.isArray(session.targets) ? session.targets : [];
  const invalid = (error, stale = false) =>
    Object.freeze({
      valid: false,
      error,
      stale,
      mode: null,
      changedTaskCount: 0,
      blockedSkipped: 0,
      skippedClosedCount: 0,
      workLogWrittenCount: 0,
      released: Object.freeze([]),
      moved: Object.freeze([]),
      started: Object.freeze([]),
      paused: Object.freeze([]),
      readySkipped: 0,
      closedSkipped: 0,
      content: text,
    });
  if (!mode) {
    return invalid("No tasks to update");
  }
  if (targets.length === 0) {
    return invalid("No tasks to update");
  }
  // Duplicate targets in one batch are written once (L14).
  const seenLines = new Set();
  const deduped = [];
  for (const target of targets) {
    if (!target || !Number.isInteger(target.line)) {
      continue;
    }
    if (seenLines.has(target.line)) {
      continue;
    }
    seenLines.add(target.line);
    deduped.push(target);
  }
  for (const target of deduped) {
    const live =
      Number.isInteger(target.line) &&
      target.line >= 0 &&
      target.line < source.lines.length
        ? source.lines[target.line]
        : undefined;
    if (
      live !== target.rawLine ||
      !isObsidianTaskAtLine(text, target.line, contexts, source.lines)
    ) {
      return invalid("A linked note changed; no tasks were updated", true);
    }
  }
  const summary = normalizeLaneWorkSummary(options.summary);
  const dateText = String(options.dateText || "");
  const laneStamper = resolveFreshStamper(options);
  const laneFreshDateText = resolveFreshDateText(options);
  const workingLines = source.lines.slice();
  let changedTaskCount = 0;
  let blockedSkipped = 0;
  let skippedClosedCount = 0;
  let readySkipped = 0;
  let closedSkipped = 0;
  let workLogWrittenCount = 0;
  const moved = [];
  // Work Log insertions shift later lines, so apply bottom-up.
  const ordered = deduped
    .map((target) => ({
      target,
      status: getObsidianTaskCheckboxStatus(target.rawLine || ""),
    }))
    .sort((a, b) => b.target.line - a.target.line);
  for (const { target, status } of ordered) {
    const applicable =
      (mode === "start" && status === "*") ||
      (mode === "pause" && status === "/");
    if (!applicable) {
      // Already in the destination lane: left alone and uncounted (D6).
      if (
        (mode === "start" && status === "/") ||
        (mode === "pause" && status === "*")
      ) {
        continue;
      }
      if (status === " ") {
        readySkipped += 1;
      } else if (status === "?") {
        blockedSkipped += 1;
      } else {
        skippedClosedCount += 1;
        closedSkipped += 1;
      }
      continue;
    }
    const toStatus = mode === "start" ? "/" : "*";
    const oldLine = String(workingLines[target.line] || "");
    let nextLine = replaceObsidianTaskCheckboxStatus(oldLine, toStatus);
    if (laneStamper) {
      nextLine = applyFreshStampLine(nextLine, laneStamper, laneFreshDateText);
    }
    if (nextLine !== oldLine) {
      changedTaskCount += 1;
    }
    workingLines[target.line] = nextLine;
    // Read the block ID from the pre-edit line: the freshness stamp lands
    // after it, so the postimage no longer ends with the ID.
    const blockId = getTrailingBlockId(oldLine);
    moved.push(
      Object.freeze({
        line: target.line,
        blockId: blockId || null,
        fromStatus: status,
        toStatus,
      }),
    );
    if (mode === "pause" && summary) {
      if (insertLaneWorkLogEntry(workingLines, target.line, summary, dateText)) {
        workLogWrittenCount += 1;
      }
    }
  }
  moved.sort((a, b) => a.line - b.line);
  const frozenMoved = Object.freeze(moved);
  return Object.freeze({
    valid: true,
    error: null,
    stale: false,
    mode,
    changedTaskCount,
    blockedSkipped,
    skippedClosedCount,
    workLogWrittenCount,
    released: frozenMoved,
    moved: frozenMoved,
    started: mode === "start" ? frozenMoved : Object.freeze([]),
    paused: mode === "pause" ? frozenMoved : Object.freeze([]),
    readySkipped,
    closedSkipped,
    content: workingLines.join(source.lineEnding),
  });
}

// Build the Task Link lane Notice. `details.tasks` holds cleaned display
// strings for the moved tasks. Successes read `◐ In Progress · <task|N tasks>`
// and `→ Next · <task|N tasks>` with `· logged` suffixes, skip counts, and
// PENDING/NEXT budget suffixes from `readLaneBudgets` adjusted by the moved
// count for both lanes (over-cap lanes gain Alt+N's 🔴 weekly-review hint).
function buildTaskLinkLaneNotice(details = {}) {
  const mode = details.mode === "pause" ? "pause" : "start";
  const changed = Math.max(
    0,
    Math.floor(numericOrDefault(details.changedTaskCount, 0)),
  );
  const tasks = Array.isArray(details.tasks) ? details.tasks : [];
  const label =
    tasks.length === 1
      ? truncateTaskLinkLaneLabel(tasks[0])
      : `${formatCountLabel(changed, "task")}`;
  let text = mode === "start" ? `◐ In Progress · ${label}` : `→ Next · ${label}`;
  const logged = Math.max(
    0,
    Math.floor(numericOrDefault(details.workLogWrittenCount, 0)),
  );
  if (mode === "pause" && logged > 0) {
    text += tasks.length === 1 ? " · logged" : ` · logged ${logged}`;
  }
  const ready = Math.max(
    0,
    Math.floor(numericOrDefault(details.readySkipped, 0)),
  );
  if (ready > 0) {
    text += ` · ${ready} Ready skipped`;
  }
  const blocked = Math.max(
    0,
    Math.floor(numericOrDefault(details.blockedSkipped, 0)),
  );
  if (blocked > 0) {
    text += ` · ${blocked} Blocked skipped — Blocked is derived`;
  }
  const closed = Math.max(
    0,
    Math.floor(
      numericOrDefault(
        details.closedSkipped,
        numericOrDefault(details.skippedClosedCount, 0),
      ),
    ),
  );
  if (closed > 0) {
    text += ` · ${closed} already closed`;
  }
  const budgets = details.laneBudgets || null;
  const parts = [];
  if (
    budgets &&
    budgets.pending &&
    Number.isFinite(Math.floor(Number(budgets.pending.count))) &&
    Number.isFinite(Math.floor(Number(budgets.pending.cap)))
  ) {
    const pendingAfter = Math.max(
      0,
      Math.floor(Number(budgets.pending.count)) +
        (mode === "start" ? changed : -changed),
    );
    const pendingCap = Math.floor(Number(budgets.pending.cap));
    parts.push(`PENDING ${pendingAfter}/${pendingCap}`);
    if (pendingAfter > pendingCap) {
      parts.push("🔴 · prune at the weekly review");
    }
  }
  if (
    budgets &&
    budgets.next &&
    Number.isFinite(Math.floor(Number(budgets.next.count))) &&
    Number.isFinite(Math.floor(Number(budgets.next.cap)))
  ) {
    const nextAfter = Math.max(
      0,
      Math.floor(Number(budgets.next.count)) +
        (mode === "start" ? -changed : changed),
    );
    const nextCap = Math.floor(Number(budgets.next.cap));
    parts.push(`NEXT ${nextAfter}/${nextCap}`);
    if (nextAfter > nextCap) {
      parts.push("🔴 · prune at the weekly review");
    }
  }
  // Deduplicate the prune hint when both lanes are over.
  const deduped = [];
  let hintSeen = false;
  for (const part of parts) {
    if (part.includes("prune at the weekly review")) {
      if (hintSeen) {
        continue;
      }
      hintSeen = true;
    }
    deduped.push(part);
  }
  if (deduped.length > 0) {
    text += ` · ${deduped.join(" · ")}`;
  }
  return text;
}

// Pure state for the Move to Next prompt: normalized summary, today's date,
// the formatted Work Log preview (blank when nothing would be logged), the
// `::` Dataview warning flag, and the call-to-action button text.
function taskLinkLanePromptState(summary, options = {}) {
  const normalized = normalizeLaneWorkSummary(summary);
  const date =
    options && typeof options.date === "string" && options.date
      ? String(options.date)
      : formatBulletPropertyDate(getLocalDateStart(new Date()));
  const formattedEntry = normalized
    ? formatLaneWorkLogEntry(normalized, date)
    : "";
  return Object.freeze({
    summary: normalized,
    date,
    formattedEntry,
    isBlank: normalized.length === 0,
    hasDataviewWarning: normalized.includes("::"),
    primaryButtonText: normalized ? "Log & move to Next" : "Move to Next",
  });
}
