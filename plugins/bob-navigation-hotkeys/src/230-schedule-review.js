function planScheduleReview(options = {}) {
  const dateItem = options.dateItem || null;
  const from = normalizeBulletPropertyValue(options.from);
  const to = normalizeBulletPropertyValue(
    options.to || (dateItem && dateItem.value) || "",
  );
  const reasonText = normalizeScheduleReasonText(options.reason);
  const reasonSupplied = options.reasonSupplied === true;
  const targets = freezeSchedulingWorkLogTargets(options.targets);
  const totalIdentities = collectSchedulingWorkLogTargetIdentities(targets);
  const eligibleIdentities = collectSchedulingWorkLogEligibleIdentities(targets);
  const totalCount = totalIdentities.size || targets.length;
  const eligibleCount = eligibleIdentities.size;
  const needsWorkLog = eligibleCount > 0;
  const needsReason = !reasonSupplied;
  const needsReview = needsReason || needsWorkLog;
  const isProject = options.isProject === true;
  const isBatch = totalCount > 1;
  const baseDate =
    options.baseDate instanceof Date
      ? getLocalDateStart(options.baseDate)
      : getLocalDateStart(new Date());
  const validation = validateProjectScheduledDate(to);
  const scheduledDate = validation.valid
    ? projectScheduleLocalDate(validation)
    : null;
  const offset =
    scheduledDate instanceof Date
      ? getLocalDayOffset(baseDate, scheduledDate)
      : null;
  const future = Number.isInteger(offset) && offset > 0;
  const effects = [];
  if (from && to && from !== to) {
    effects.push(`${from}${SCHEDULE_LOG_TRANSITION}${to}`);
  } else if (to) {
    effects.push(`scheduled → ${to}`);
  }
  if (scheduledDate instanceof Date) {
    effects.push(getBulletPropertyDateWeekday(scheduledDate));
    if (Number.isInteger(offset)) {
      effects.push(formatRelativeDayOffset(offset));
    }
  }
  if (isProject) {
    effects.push("propagates to project tasks");
  }
  if (future) {
    effects.push("future date marks Blocked");
  }
  if (needsWorkLog) {
    const taskWord = eligibleCount === 1 ? "task" : "tasks";
    effects.push(
      isBatch
        ? `${eligibleCount} of ${totalCount} ${taskWord} qualify for Work Log`
        : eligibleCount === 1
          ? "1 task qualifies for Work Log"
          : `${eligibleCount} tasks qualify for Work Log`,
    );
  }
  effects.push("nothing written yet");
  return Object.freeze({
    dateItem,
    from,
    to,
    reason: reasonText.reason,
    reasonEmpty: reasonText.empty,
    reasonHasInlineField: reasonText.hasInlineField,
    reasonSupplied,
    needsReason,
    needsWorkLog,
    needsReview,
    targets,
    totalCount,
    eligibleCount,
    isBatch,
    isProject,
    future,
    title: isBatch ? `Schedule ${totalCount} tasks` : "Schedule task",
    focusField: needsReason ? "reason" : needsWorkLog ? "summary" : "reason",
    effects: Object.freeze(effects),
    scheduleSummary: effects.filter((part) => part !== "nothing written yet").join(" · "),
  });
}

// Original lines (pre-batch `target.line` values) whose validated `rawLine`
// qualifies for a scheduling Work Log. Propagation-only tasks are never in
// `targets`, so they are excluded by construction. Prompt counting uses
// identity keys; writers still map these original lines.
function collectSchedulingWorkLogEligibleOriginalLines(targets) {
  const eligible = new Set();
  for (const target of Array.isArray(targets) ? targets : []) {
    if (
      target &&
      Number.isInteger(target.line) &&
      isSchedulingWorkLogRawLine(target.rawLine)
    ) {
      eligible.add(target.line);
    }
  }
  return eligible;
}

// Insert one Work Log entry per eligible target into `workingLines` (mutated
// in place). `mappedLinesByOriginal` maps original `target.line` to the
// current line in `workingLines` after task edits, frontmatter shifts, Cancel
// Log insertion, and Schedule Log insertion. Applies bottom-up so an earlier
// insert never invalidates a later target's mapped line. Returns the number
// of entries written. Blank summaries write nothing and never create a
// marker (insertLaneWorkLogEntry already enforces this).
function applySchedulingWorkLogsToLines(
  workingLines,
  mappedLinesByOriginal,
  eligibleOriginalLines,
  summary,
  dateText,
) {
  const normalized = normalizeSchedulingWorkSummary(summary);
  if (!normalized || !Array.isArray(workingLines)) {
    return 0;
  }
  const eligible =
    eligibleOriginalLines instanceof Set
      ? eligibleOriginalLines
      : new Set();
  const entries = [];
  if (mappedLinesByOriginal instanceof Map) {
    for (const [originalLine, currentLine] of mappedLinesByOriginal) {
      if (!eligible.has(originalLine)) {
        continue;
      }
      if (!Number.isInteger(currentLine)) {
        continue;
      }
      entries.push({ originalLine, currentLine });
    }
  }
  entries.sort((a, b) => b.currentLine - a.currentLine);
  let written = 0;
  for (const entry of entries) {
    if (
      insertLaneWorkLogEntry(
        workingLines,
        entry.currentLine,
        normalized,
        dateText,
      )
    ) {
      written += 1;
    }
  }
  return written;
}

// Plan a lane commit/release across the task lines of one note's content.
// Commit wins when any target is Ready; otherwise release. Pass `summary`
// plus `dateText` to log an optional Work Log entry on each released In
// Progress task (blank writes nothing). Stale preimages (a line changed or
// stopped being a task) refuse the whole batch.
function planTaskLaneBatch(content, session, options = {}) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
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
      content: text,
    });
  if (targets.length === 0) {
    return invalid("No tasks to update");
  }
  for (const target of targets) {
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
      return invalid("A task changed while the picker was open", true);
    }
  }
  const statuses = targets.map((target) =>
    getObsidianTaskCheckboxStatus(target.rawLine || ""),
  );
  const hasReady = statuses.some((status) => status === " ");
  const mode = hasReady ? "commit" : "release";
  const summary = normalizeLaneWorkSummary(options.summary);
  const dateText = String(options.dateText || "");
  // Freshness is the last transformation of the task line (nav-stamps). The
  // stamper itself refuses closed and recurring lines, so those never stamp.
  // Pure planners take the stamper as an injected option (identity by default).
  const laneStamper = resolveFreshStamper(options);
  const laneFreshDateText = resolveFreshDateText(options);
  const workingLines = source.lines.slice();
  let changedTaskCount = 0;
  let blockedSkipped = 0;
  let skippedClosedCount = 0;
  let workLogWrittenCount = 0;
  const released = [];
  // Work Log insertions shift later lines, so apply bottom-up.
  const ordered = targets
    .map((target, index) => ({ target, status: statuses[index] }))
    .sort((a, b) => b.target.line - a.target.line);
  for (const { target, status } of ordered) {
    const oldLine = String(workingLines[target.line] || "");
    if (mode === "commit") {
      if (status === " ") {
        let nextLine = replaceObsidianTaskCheckboxStatus(oldLine, "*");
        if (laneStamper) {
          nextLine = applyFreshStampLine(nextLine, laneStamper, laneFreshDateText);
        }
        if (nextLine !== oldLine) {
          changedTaskCount += 1;
        }
        workingLines[target.line] = nextLine;
      } else if (status === "?") {
        blockedSkipped += 1;
      } else if (status === "x" || status === "X" || status === "-") {
        skippedClosedCount += 1;
      }
      continue;
    }
    if (status === "*" || status === "/") {
      let nextLine = replaceObsidianTaskCheckboxStatus(oldLine, " ");
      if (laneStamper) {
        nextLine = applyFreshStampLine(nextLine, laneStamper, laneFreshDateText);
      }
      if (nextLine !== oldLine) {
        changedTaskCount += 1;
      }
      workingLines[target.line] = nextLine;
      const blockId = getTrailingBlockId(nextLine);
      released.push(
        Object.freeze({
          line: target.line,
          blockId: blockId || null,
          fromStatus: status,
        }),
      );
      if (status === "/" && summary) {
        if (insertLaneWorkLogEntry(workingLines, target.line, summary, dateText)) {
          workLogWrittenCount += 1;
        }
      }
    } else if (status === "?") {
      blockedSkipped += 1;
    } else if (status === "x" || status === "X" || status === "-") {
      skippedClosedCount += 1;
    }
  }
  if (changedTaskCount === 0) {
    if (blockedSkipped > 0 && skippedClosedCount === 0) {
      return invalid("Blocked is derived; no tasks were updated");
    }
    return invalid("No tasks to update");
  }
  released.sort((a, b) => a.line - b.line);
  return Object.freeze({
    valid: true,
    error: null,
    stale: false,
    mode,
    changedTaskCount,
    blockedSkipped,
    skippedClosedCount,
    workLogWrittenCount,
    released: Object.freeze(released),
    content: workingLines.join(source.lineEnding),
  });
}

// Build the lane Notice. Budget suffixes come from the ledger-tools api v2
// read before the write, adjusted by the number of tasks that changed,
// because the Tasks cache lags behind the write. They are omitted when the
// api is unavailable. Over-cap counts gain a red dot plus the weekly-review
// hint.
function buildLaneToggleNotice(details = {}) {
  const mode = details.mode === "release" ? "release" : "commit";
  const changed = Math.max(
    0,
    Math.floor(numericOrDefault(details.changedTaskCount, 0)),
  );
  const arrow = "→";
  const dest = mode === "release" ? "Ready" : "Next";
  let text = `${arrow} ${dest} · ${formatCountLabel(changed, "task")}`;
  const unlinked = Math.max(
    0,
    Math.floor(numericOrDefault(details.unlinkedFromToday, 0)),
  );
  if (mode === "release" && unlinked > 0) {
    text += ` · unlinked ${unlinked} from today`;
  }
  const blocked = Math.max(
    0,
    Math.floor(numericOrDefault(details.blockedSkipped, 0)),
  );
  if (blocked > 0) {
    text += ` · ${blocked} Blocked skipped — Blocked is derived`;
  }
  const budgets = details.laneBudgets || null;
  const parts = [];
  if (
    budgets &&
    budgets.next &&
    Number.isFinite(Math.floor(Number(budgets.next.count))) &&
    Number.isFinite(Math.floor(Number(budgets.next.cap)))
  ) {
    const delta =
      mode === "release"
        ? -Math.max(
            0,
            Math.floor(numericOrDefault(details.releasedNextCount, changed)),
          )
        : changed;
    void delta;
    const nextAfter = Math.max(
      0,
      Math.floor(Number(budgets.next.count)) +
        (mode === "release"
          ? -Math.floor(numericOrDefault(details.releasedNextCount, 0))
          : changed),
    );
    const nextCap = Math.floor(Number(budgets.next.cap));
    parts.push(`NEXT ${nextAfter}/${nextCap}`);
    if (nextAfter > nextCap) {
      parts.push("🔴 · prune at the weekly review");
    }
  }
  if (
    budgets &&
    budgets.pending &&
    Number.isFinite(Math.floor(Number(budgets.pending.count))) &&
    Number.isFinite(Math.floor(Number(budgets.pending.cap)))
  ) {
    const pendingAfter = Math.max(
      0,
      Math.floor(Number(budgets.pending.count)) +
        (mode === "release"
          ? -Math.floor(numericOrDefault(details.releasedPendingCount, 0))
          : 0),
    );
    const pendingCap = Math.floor(Number(budgets.pending.cap));
    parts.push(`PENDING ${pendingAfter}/${pendingCap}`);
    if (pendingAfter > pendingCap) {
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

// Read the ledger-tools lane budgets for the Notice, or null when the api
// is missing, older than v2, or unusable. Never throws and never awaits:
// callers read synchronously before the write.
function readLaneBudgets(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-ledger-tools"];
    const api = holder && holder.api;
    if (!api || Number(api.version) < 2) {
      return null;
    }
    if (
      typeof api.nextBudget !== "function" ||
      typeof api.pendingBudget !== "function"
    ) {
      return null;
    }
    const next = api.nextBudget();
    const pending = api.pendingBudget();
    if (next && typeof next.then === "function") {
      return null;
    }
    if (pending && typeof pending.then === "function") {
      return null;
    }
    const clean = (value) => {
      if (
        !value ||
        !Number.isFinite(Math.floor(Number(value.count))) ||
        !Number.isFinite(Math.floor(Number(value.cap)))
      ) {
        return null;
      }
      return Object.freeze({
        count: Math.floor(Number(value.count)),
        cap: Math.floor(Number(value.cap)),
        over: Boolean(value.over),
      });
    };
    const cleanNext = clean(next);
    const cleanPending = clean(pending);
    if (!cleanNext && !cleanPending) {
      return null;
    }
    return Object.freeze({ next: cleanNext, pending: cleanPending });
  } catch (error) {
    return null;
  }
}

// Describe the pinned lane picker row: null when no committable or
// releasable target exists, otherwise whether choosing the row would commit
// or release, how many tasks it covers, and whether a Work Log reason stage
// applies (release with an In Progress target).
function describeLaneRow(content, options = {}) {
  const text = String(content || "");
  const cursorLine = Math.floor(numericOrDefault(options.cursorLine, NaN));
  const taskSession = options.taskSession || null;
  const linkResolved = Array.isArray(options.linkResolved)
    ? options.linkResolved
    : null;
  const statusOf = (lineText) => getObsidianTaskCheckboxStatus(lineText);
  const summarize = (statuses) => {
    const hasReady = statuses.some((status) => status === " ");
    if (hasReady) {
      return Object.freeze({
        mode: "commit",
        detail: "lane · commit to Next",
        needsReason: false,
      });
    }
    const releasable = statuses.filter(
      (status) => status === "*" || status === "/",
    );
    if (releasable.length > 0) {
      return Object.freeze({
        mode: "release",
        detail: "lane · release to Ready",
        needsReason: releasable.some((status) => status === "/"),
      });
    }
    return null;
  };
  if (linkResolved) {
    if (linkResolved.length === 0) {
      return null;
    }
    const resolved = summarize(
      linkResolved.map((target) => statusOf(target.rawLine || "")),
    );
    if (!resolved) {
      return null;
    }
    return Object.freeze({
      kind: "link",
      count: linkResolved.length,
      mode: resolved.mode,
      detail: resolved.detail,
      needsReason: resolved.needsReason,
    });
  }
  if (
    taskSession &&
    taskSession.explicit &&
    Array.isArray(taskSession.targets) &&
    taskSession.targets.length > 0
  ) {
    const resolved = summarize(
      taskSession.targets.map((target) => statusOf(target.rawLine || "")),
    );
    if (!resolved) {
      return null;
    }
    return Object.freeze({
      kind: "task",
      count: taskSession.targets.length,
      mode: resolved.mode,
      detail: resolved.detail,
      needsReason: resolved.needsReason,
    });
  }
  if (
    Number.isFinite(cursorLine) &&
    isObsidianTaskLine(String(text.split(/\r?\n/)[cursorLine] || ""))
  ) {
    const line = String(text.split(/\r?\n/)[cursorLine] || "");
    const status = statusOf(line);
    if (status === " ") {
      return Object.freeze({
        kind: "task",
        count: 1,
        mode: "commit",
        detail: "lane · commit to Next",
        needsReason: false,
      });
    }
    if (status === "*" || status === "/") {
      return Object.freeze({
        kind: "task",
        count: 1,
        mode: "release",
        detail: "lane · release to Ready",
        needsReason: status === "/",
      });
    }
  }
  return null;
}

// True when a task line is recurring: it carries a Tasks `repeat` field in
// either the bracket `[repeat:: …]` or parenthetical `(repeat:: …)` shape, or
// the 🔁 emoji. Such tasks are refused by the cancel planner so Obsidian
// Tasks can create the next occurrence.
function isRecurringTaskLine(lineText) {
  const text = String(lineText || "");
  return (
    /\[repeat\s*::/i.test(text) ||
    /\(repeat\s*::/i.test(text) ||
    text.includes("🔁")
  );
}

// Status name for the cancel row detail: Ready (` `), Next (`*`),
// In Progress (`/`) or Blocked (`?`). Null for any other symbol.
function getTaskCancelStatusLabel(symbol) {
  switch (String(symbol ?? "")) {
    case " ":
      return "Ready";
    case "*":
      return "Next";
    case "/":
      return "In Progress";
    case "?":
      return "Blocked";
    default:
      return null;
  }
}

// Describe the pinned Cancel picker row: null when no open `#task` target
// exists (closed tasks, plain bullets, or no task under the cursor), otherwise
// the counts, recurring flag, and detail line the picker renders. `^prj`
// lifecycle tasks are allowed. In counted and link sessions a single recurring
// open target refuses the whole batch, so the detail reports the recurring
// refusal.
function describeCancelTaskRow(content, options = {}) {
  const text = String(content || "");
  const cursorLine = Math.floor(numericOrDefault(options.cursorLine, NaN));
  const taskSession = options.taskSession || null;
  const linkResolved = Array.isArray(options.linkResolved)
    ? options.linkResolved
    : null;

  const statusOf = (lineText) => getObsidianTaskCheckboxStatus(lineText);
  const isOpenStatus = (status) =>
    status !== null && OPEN_OBSIDIAN_TASK_STATUSES.has(status);

  if (linkResolved) {
    if (linkResolved.length === 0) {
      return null;
    }
    let openCount = 0;
    let closedCount = 0;
    let recurring = false;
    for (const target of linkResolved) {
      const rawLine = String((target && target.rawLine) || "");
      const status = statusOf(rawLine);
      if (isObsidianTaskLine(rawLine) && isOpenStatus(status)) {
        openCount += 1;
        if (isRecurringTaskLine(rawLine)) {
          recurring = true;
        }
      } else {
        closedCount += 1;
      }
    }
    if (openCount === 0) {
      return null;
    }
    if (recurring) {
      return Object.freeze({
        kind: "link",
        count: linkResolved.length,
        openCount,
        closedCount,
        recurring: true,
        fromStatus: null,
        detail: "recurring · use Obsidian Tasks",
      });
    }
    const sessionLike = {
      targets: linkResolved,
      resolved: linkResolved,
      actualCount: linkResolved.length,
      requestedCount: linkResolved.length,
      clamped: false,
    };
    const subtitle = getLinkPickerSessionSubtitle(sessionLike);
    const detail =
      closedCount > 0
        ? `${subtitle} → Cancelled · ${closedCount} already closed`
        : `${subtitle} → Cancelled`;
    return Object.freeze({
      kind: "link",
      count: linkResolved.length,
      openCount,
      closedCount,
      recurring: false,
      fromStatus: null,
      detail,
    });
  }

  if (
    taskSession &&
    Array.isArray(taskSession.targets) &&
    taskSession.targets.length > 0
  ) {
    let openCount = 0;
    let closedCount = 0;
    let recurring = false;
    for (const target of taskSession.targets) {
      const rawLine = String((target && target.rawLine) || "");
      const status = statusOf(rawLine);
      if (isObsidianTaskLine(rawLine) && isOpenStatus(status)) {
        openCount += 1;
        if (isRecurringTaskLine(rawLine)) {
          recurring = true;
        }
      } else {
        closedCount += 1;
      }
    }
    if (openCount === 0) {
      return null;
    }
    if (recurring) {
      return Object.freeze({
        kind: "task",
        count: taskSession.targets.length,
        openCount,
        closedCount,
        recurring: true,
        fromStatus: null,
        detail: "recurring · use Obsidian Tasks",
      });
    }
    const taskWord = openCount === 1 ? "task" : "tasks";
    const detail =
      closedCount > 0
        ? `${openCount} ${taskWord} → Cancelled · ${closedCount} already closed`
        : `${openCount} ${taskWord} → Cancelled · asks why`;
    return Object.freeze({
      kind: "task",
      count: taskSession.targets.length,
      openCount,
      closedCount,
      recurring: false,
      fromStatus: null,
      detail,
    });
  }

  if (Number.isFinite(cursorLine)) {
    const lines = text.split(/\r?\n/);
    const line = String(lines[cursorLine] || "");
    if (!isObsidianTaskLine(line)) {
      return null;
    }
    const status = statusOf(line);
    if (!isOpenStatus(status)) {
      return null;
    }
    const fromStatus = getTaskCancelStatusLabel(status);
    if (isRecurringTaskLine(line)) {
      return Object.freeze({
        kind: "task",
        count: 1,
        openCount: 1,
        closedCount: 0,
        recurring: true,
        fromStatus,
        detail: "recurring · use Obsidian Tasks",
      });
    }
    return Object.freeze({
      kind: "task",
      count: 1,
      openCount: 1,
      closedCount: 0,
      recurring: false,
      fromStatus,
      detail: `${fromStatus} → Cancelled · asks why`,
    });
  }

  return null;
}

// Plan a pure batch cancel across one note's content: set `[-]`, upsert
// `[cancelled:: date]`, and write the Cancel Log first-child/prepend/fallback
// entry for every open target. Closed targets are skipped. A single recurring
// open target refuses the whole batch. `details.reasonByLine` (a Map from
// original line to reason) overrides `details.reason` per target; callers that
// omit it get byte-identical output. Targets are processed bottom-up so
// insertions never shift pending lines. Pure and CRLF-preserving.
