// RECURRING landing refusal (Alt+F and Ctrl+Alt+F write nothing and stay).
// Exact text from plan:202610/recurring_review_tier.md.
const REVIEW_RECURRING_TIER_NOTICE =
  "RECURRING \u00b7 never stamped \u2014 Ctrl+Enter done \u00b7 Ctrl+Shift+Enter today \u00b7 Ctrl+Shift+P reschedule \u00b7 ]s skip";

function reviewLineChecklistKind(line) {
  const tokens = String(line || "").toLowerCase().match(/#[^\s#]+/g) || [];
  const tags = new Set(tokens);
  if (!tags.has("#gtd")) {
    return null;
  }
  if (tags.has("#pre")) {
    return "pre";
  }
  if (tags.has("#post")) {
    return "post";
  }
  return null;
}

function planReviewJump(queue, options = {}) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const direction = options.direction < 0 ? -1 : 1;
  if (list.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const endpointRaw =
    options && typeof options.endpoint === "string"
      ? options.endpoint.trim().toLowerCase()
      : "";
  if (endpointRaw === "first" || endpointRaw === "last") {
    const index = endpointRaw === "first" ? 0 : list.length - 1;
    return Object.freeze({
      kind: "jump",
      entry: list[index],
      rank: index + 1,
      total: list.length,
      wrapped: false,
      originTier: null,
    });
  }
  const finish = (step, walkList) =>
    applyReviewJumpRepeat(step, walkList, direction, options.repeat);
  const todayText =
    options && typeof options.todayText === "string" ? options.todayText : "";
  let anchor =
    options.anchor && typeof options.anchor === "object"
      ? options.anchor
      : options.stamped && typeof options.stamped === "object"
        ? options.stamped
        : null;
  if (anchor && !reviewAnchorIsCurrentDay(anchor, todayText)) {
    anchor = null;
  }
  const handledKeys = reviewVerifiedHandledKeys(list, anchor);
  const hasAnchorShape =
    Boolean(anchor) &&
    (Array.isArray(anchor.afterKeys) || Array.isArray(anchor.beforeKeys));
  const cursor =
    options.cursor && typeof options.cursor === "object"
      ? options.cursor
      : null;
  const resume = planReviewResume(list, anchor, cursor, direction);
  const resumeRef = resume && resume.resumeRef ? resume.resumeRef : null;
  const resumeIndex = resume && Number.isInteger(resume.resumeIndex) ? resume.resumeIndex : -1;
  const resumeJump = (at) =>
    finish(
      {
        kind: "jump",
        entry: list[at],
        rank: at + 1,
        total: list.length,
        wrapped: false,
        originTier: anchor && typeof anchor.tier === "string" ? anchor.tier : null,
      },
      list,
    );
  if (resumeRef && resumeIndex >= 0 && resume && resume.cursorOnResume === true) {
    return resumeJump(resumeIndex);
  }
  // The cursor on a just-handled (stamped, released, or rolled) task is
  // not a live queue entry, even when the lagging Tasks cache still
  // lists it: handled keys never match here, so the anchor below
  // continues the walk instead of stepping from a stale position.
  // Identity is text-first so a recurrence insert above the cursor
  // cannot make `]s` skip the next chore.
  const cursorIndex = findReviewCursorIndex(list, cursor, handledKeys);
  if (cursorIndex >= 0) {
    if (
      !resumeRef ||
      (cursor &&
        list[cursorIndex] &&
        list[cursorIndex].originalMarkdown === cursor.text)
    ) {
      let index = cursorIndex + direction;
      let wrapped = false;
      if (index < 0) {
        index = list.length - 1;
        wrapped = true;
      } else if (index >= list.length) {
        index = 0;
        wrapped = true;
      }
      return finish(
        {
          kind: "jump",
          entry: list[index],
          rank: index + 1,
          total: list.length,
          wrapped,
          originTier: reviewEntryMachineTier(list[cursorIndex]) || null,
        },
        list,
      );
    }
  }
  if (resumeRef && resumeIndex >= 0) {
    return resumeJump(resumeIndex);
  }
  if (anchor && (handledKeys.size > 0 || hasAnchorShape)) {
    const remaining = list.filter(
      (entry) => !handledKeys.has(reviewQueueEntryKey(entry)),
    );
    if (remaining.length === 0) {
      return Object.freeze({ kind: "empty" });
    }
    if (hasAnchorShape) {
      const resolved = resolveReviewAnchorTarget(
        remaining,
        anchor,
        direction,
      );
      if (!resolved) {
        return Object.freeze({ kind: "empty" });
      }
      const originTier =
        anchor && typeof anchor.tier === "string" && anchor.tier
          ? String(anchor.tier).trim().toLowerCase() || null
          : null;
      return finish(
        {
          kind: "jump",
          entry: resolved.entry,
          rank: resolved.rank,
          total: resolved.total,
          wrapped: resolved.wrapped,
          originTier,
        },
        remaining,
      );
    }
    if (Number.isInteger(anchor.rank)) {
      const skip = Math.max(
        0,
        anchor.rank -
          Math.max(0, Math.floor(numericOrDefault(anchor.count, 0))),
      );
      const originTier =
        anchor && typeof anchor.tier === "string" && anchor.tier
          ? String(anchor.tier).trim().toLowerCase() || null
          : null;
      if (direction < 0) {
        const at = Math.min(skip - 1, remaining.length - 1);
        if (at >= 0) {
          return finish(
            {
              kind: "jump",
              entry: remaining[at],
              rank: at + 1,
              total: remaining.length,
              wrapped: false,
              originTier,
            },
            remaining,
          );
        }
        return finish(
          {
            kind: "jump",
            entry: remaining[remaining.length - 1],
            rank: remaining.length,
            total: remaining.length,
            wrapped: true,
            originTier,
          },
          remaining,
        );
      }
      if (skip < remaining.length) {
        return finish(
          {
            kind: "jump",
            entry: remaining[skip],
            rank: skip + 1,
            total: remaining.length,
            wrapped: false,
            originTier,
          },
          remaining,
        );
      }
      return finish(
        {
          kind: "jump",
          entry: remaining[0],
          rank: 1,
          total: remaining.length,
          wrapped: true,
          originTier,
        },
        remaining,
      );
    }
  }
  const index = direction < 0 ? list.length - 1 : 0;
  return finish(
    {
      kind: "jump",
      entry: list[index],
      rank: index + 1,
      total: list.length,
      wrapped: false,
      originTier: null,
    },
    list,
  );
}

// Resolve a queue entry to a 0-based line without writing: the entry's
// `originalMarkdown` still at `line`, else a unique exact match in the file
// (skipping frontmatter and fences). Anything else is a stale queue.
function resolveReviewQueueLine(content, entry) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const want =
    entry && typeof entry.originalMarkdown === "string"
      ? entry.originalMarkdown
      : "";
  const oneBased = entry && Number.isInteger(entry.line) ? entry.line : null;
  if (
    oneBased !== null &&
    oneBased >= 1 &&
    oneBased <= lines.length &&
    lines[oneBased - 1] === want
  ) {
    return Object.freeze({ ok: true, line: oneBased - 1, source: "line" });
  }
  if (!want) {
    return Object.freeze({ ok: false, reason: "stale" });
  }
  const contexts = getMarkdownLineContexts(text);
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== want) {
      continue;
    }
    const context = contexts[index];
    if (context && (context.inFrontmatter || context.inFence)) {
      continue;
    }
    hits.push(index);
  }
  if (hits.length === 1) {
    return Object.freeze({ ok: true, line: hits[0], source: "text" });
  }
  return Object.freeze({ ok: false, reason: "stale" });
}

// Tier-aware jump notice. v4 entries (with per-tier ranks) read
// `Review {rank}/{total} · {TIER} {tierRank}/{tierTotal} · {detail}`:
// NEW has no detail; PROJECTS names the empty-project confirmation;
// PENDING/NEXT name the confirmation age; TICKLER names the return
// date; ROTTEN names the overdue age and interval (or `due today`).
// Lane tiers add a second line with the keep/release/today actions.
// Legacy v3 entries keep today's state text.
function formatReviewJumpNoticeFromView(entry, rank, total, options = {}) {
  const viewFn =
    options && typeof options.reviewEntryView === "function"
      ? options.reviewEntryView
      : null;
  if (!viewFn || !reviewEntryHasTierRanks(entry)) {
    return null;
  }
  try {
    const todayText =
      options && typeof options.todayText === "string"
        ? options.todayText
        : null;
    const trackers =
      options && typeof options.trackers === "boolean"
        ? options.trackers
        : true;
    const presentation = viewFn(entry, { todayText });
    if (
      !presentation ||
      typeof presentation !== "object" ||
      presentation.ok === false ||
      !presentation.label
    ) {
      return null;
    }
    const label = String(presentation.label);
    const head = `Review ${rank}/${total} · ${label} ${entry.tierRank}/${entry.tierTotal}`;
    const tier =
      typeof presentation.tier === "string" && presentation.tier
        ? presentation.tier
        : reviewEntryMachineTier(entry);
    let detail =
      typeof presentation.detail === "string" ? presentation.detail : "";
    if ((tier === "projects" || tier === "references") && !trackers) {
      detail = "";
    }
    const actionHint =
      typeof presentation.actionHint === "string" ? presentation.actionHint : "";
    const lines = [detail ? `${head} · ${detail}` : head];
    if (actionHint && options.omitActionHint !== true) {
      lines.push(actionHint);
    }
    const wrapped =
      options && options.wrapped === true ? " · wrapped around" : "";
    return lines.join("\n") + wrapped;
  } catch (error) {
    return null;
  }
}

function buildReviewJumpNotice(entry, rank, total, options = {}) {
  const fromView = formatReviewJumpNoticeFromView(entry, rank, total, options);
  if (fromView !== null) {
    return fromView;
  }
  const todayText =
    options && typeof options.todayText === "string"
      ? options.todayText
      : null;
  const trackers =
    options && typeof options.trackers === "boolean"
      ? options.trackers
      : true;
  if (reviewEntryHasTierRanks(entry)) {
    const label = reviewEntryTierLabel(entry) || "REVIEW";
    const tier = reviewEntryMachineTier(entry);
    const head = `Review ${rank}/${total} · ${label} ${entry.tierRank}/${entry.tierTotal}`;
    let detail = "";
    if ((tier === "projects" || tier === "references") && trackers) {
      const fresh =
        entry && typeof entry.fresh === "string" && entry.fresh
          ? entry.fresh
          : null;
      const interval =
        entry && Number.isInteger(entry.interval) ? entry.interval : null;
      const every = interval !== null ? ` · every ${interval}d` : "";
      const kind = tier === "projects" ? "Empty project" : "Reference";
      if (!fresh) {
        detail = `${kind} · never confirmed${every}`;
      } else {
        const overdue =
          entry && Number.isFinite(entry.daysOverdue)
            ? Math.max(0, Math.floor(entry.daysOverdue))
            : null;
        const lead =
          overdue === null
            ? entry && typeof entry.dueOn === "string" && entry.dueOn
              ? `due ${reviewShortDate(entry.dueOn)}`
              : "due"
            : overdue < 1
              ? "due today"
              : `${overdue}d overdue`;
        detail = `${kind} · ${lead} · confirmed ${reviewShortDate(fresh)}${every}`;
      }
    } else if (tier === "pending" || tier === "next") {
      detail = reviewLaneConfirmedDetail(entry, todayText);
    } else if (tier === "recurring") {
      const overdue =
        entry && Number.isFinite(entry.daysOverdue)
          ? Math.max(0, Math.floor(entry.daysOverdue))
          : null;
      detail =
        overdue === null || overdue < 1
          ? "due today"
          : `${overdue}d overdue`;
    } else if (tier === "tickler") {
      const since =
        entry && typeof entry.dueOn === "string" && entry.dueOn
          ? entry.dueOn
          : entry && typeof entry.fresh === "string"
            ? entry.fresh
            : "";
      detail = since ? `back since ${reviewShortDate(since)}` : "tickler";
    } else if (tier === "rotten") {
      const interval =
        entry && Number.isInteger(entry.interval) ? entry.interval : null;
      const every = interval !== null ? ` · every ${interval}d` : "";
      const overdue =
        entry && Number.isFinite(entry.daysOverdue)
          ? Math.max(0, Math.floor(entry.daysOverdue))
          : null;
      detail =
        overdue === null || overdue < 1
          ? `due today${every}`
          : `rotten ${overdue}d${every}`;
    } else if (tier === "pre") {
      detail = "checklist";
    } else if (tier === "post") {
      detail = "closeout";
    }
    const lines = [detail ? `${head} · ${detail}` : head];
    if (options.omitActionHint !== true && tier === "pending") {
      lines.push("Still pending? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today");
    } else if (options.omitActionHint !== true && tier === "next") {
      lines.push("Still next? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today");
    } else if (options.omitActionHint !== true && tier === "recurring") {
      lines.push("Ctrl+Enter done · Ctrl+Shift+Enter today · Ctrl+Shift+P reschedule · ]s skip");
    } else if (options.omitActionHint !== true && tier === "pre") {
      lines.push("Ctrl+Enter done · ]s skip");
    } else if (options.omitActionHint !== true && tier === "post") {
      lines.push("Ctrl+Enter done · closes the review");
    }
    const wrapped =
      options && options.wrapped === true ? " · wrapped around" : "";
    return lines.join("\n") + wrapped;
  }
  const state = entry && typeof entry.state === "string" ? entry.state : "";
  let detail = state;
  if (state === "new") {
    detail = "NEW";
  } else if (state === "rotten") {
    const overdue =
      entry && Number.isFinite(entry.daysOverdue)
        ? entry.daysOverdue
        : null;
    detail = overdue === null ? "rotten" : `rotten ${overdue}d`;
  } else if (state === "resurfaced") {
    detail = "resurfaced";
  }
  const wrapped =
    options && options.wrapped === true ? " · wrapped around" : "";
  return `Review ${rank}/${total} · ${detail}${wrapped}`;
}

function formatReviewPostLandingTail(remaining) {
  const counts = remaining && typeof remaining === "object" ? remaining : {};
  const commitments = Number.isInteger(counts.commitments)
    ? counts.commitments
    : 0;
  const rotten = Number.isInteger(counts.rotten) ? counts.rotten : 0;
  return ` · ${commitments} commitments due · ${rotten} ROTTEN left`;
}

function appendReviewPostLandingTail(notice, remaining) {
  const tail = formatReviewPostLandingTail(remaining);
  const lines = String(notice || "").split("\n");
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    return tail.trim();
  }
  lines[0] = `${lines[0]}${tail}`;
  return lines.join("\n");
}

// `Nothing due for review · ✓ 12 today` (the upkeep meter: tasks
// stamped today outside the Pending/Next lanes).
function buildReviewEmptyNotice(counts) {
  const upkeep =
    counts && Number.isInteger(counts.upkeepToday)
      ? counts.upkeepToday
      : counts && Number.isFinite(counts.refreshedToday)
        ? counts.refreshedToday
        : 0;
  return `Nothing due for review · ✓ ${upkeep} today`;
}

// Refusal class for one Alt+F target line: non-tasks, done and cancelled
// tasks, and recurring tasks are never stamped. Every open status
// (` `, `/`, `*`, `?`) stamps, because a Next, Pending or Blocked task may
// come back to Ready later.
function classifyFreshStampTarget(rawLine) {
  const line = String(rawLine || "");
  if (!isObsidianTaskLine(line)) {
    return Object.freeze({ ok: false, refusal: "not-task" });
  }
  const status = getObsidianTaskCheckboxStatus(line);
  if (status === null || !OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
    return Object.freeze({ ok: false, refusal: "closed" });
  }
  if (isRecurringTaskLine(line)) {
    return Object.freeze({ ok: false, refusal: "recurring" });
  }
  return Object.freeze({ ok: true, refusal: null });
}

function freshStampRefusalNotice(refusal) {
  if (refusal === "recurring") {
    return "recurring · not reviewed";
  }
  if (refusal === "closed") {
    return "Task is closed · not reviewed";
  }
  if (refusal === "stamp") {
    return "Could not update task; no tasks were updated";
  }
  return "Cursor is not on a task or Task Link";
}

// Pure stamp plan over 0-based targets: classify every target first so one
// refusal refuses the whole batch with the note unchanged, then stamp each
// line through the injected `stamper`. Each target is a 0-based line index
// (legacy) or `{ line, path, raw, counted }` with the pre-write 0-based
// line, the note path, the pre-write raw text, and the exact-eligibility
// decision (`docs/freshness.md` §2a). The stamper runs as
// `stamper(before, dateText, decision)` where `decision` is
// `{ counted, path, line, raw }` (legacy index targets decide
// `{ counted: false }` with no path/raw); keep stampers pass `counted`
// through to `api.freshness.keepLine`, while legacy stampers ignore the
// third argument. A throwing stamper refuses the batch (`stamp`) with no
// partial write, so a missing/throwing v5 `keepLine` fails without writing
// instead of falling back to the now-resetting generic stamper. Returns
// `{ ok, refusal, content, stamped }` where `stamped` is
// `[{ line, before, after, counted }]`.
function planFreshStampBatch(content, targetLines, stamper, dateText) {
  const text = String(content || "");
  const { lines, lineEnding } = splitMarkdownContent(text);
  const apply = typeof stamper === "function" ? stamper : (line) => line;
  const rawTargets = Array.isArray(targetLines) ? targetLines : [];
  const targets = rawTargets.map((target) => {
    if (target !== null && typeof target === "object") {
      const line = Math.floor(numericOrDefault(target.line, Number.NaN));
      return Object.freeze({
        line,
        path:
          target.path === undefined || target.path === null
            ? null
            : String(target.path),
        raw:
          target.raw === undefined || target.raw === null
            ? null
            : String(target.raw),
        counted: target.counted === true,
      });
    }
    return Object.freeze({
      line: Math.floor(numericOrDefault(target, Number.NaN)),
      path: null,
      raw: null,
      counted: false,
    });
  });
  for (const target of targets) {
    const check = classifyFreshStampTarget(lines[target.line]);
    if (!check.ok) {
      return Object.freeze({
        ok: false,
        refusal: check.refusal,
        content: text,
        stamped: Object.freeze([]),
      });
    }
  }
  const next = lines.slice();
  const stamped = [];
  for (const target of targets) {
    const before = String(lines[target.line] || "");
    const decision = Object.freeze({
      counted: target.counted,
      path: target.path,
      line: target.line,
      raw: target.raw === null ? before : target.raw,
    });
    let after;
    try {
      after = String(apply(before, dateText, decision) ?? before);
    } catch (error) {
      return Object.freeze({
        ok: false,
        refusal: "stamp",
        content: text,
        stamped: Object.freeze([]),
      });
    }
    next[target.line] = after;
    stamped.push(
      Object.freeze({
        line: target.line,
        before,
        after,
        counted: target.counted,
      }),
    );
  }
  return Object.freeze({
    ok: true,
    refusal: null,
    content: next.join(lineEnding),
    stamped: Object.freeze(stamped),
  });
}

// Pure freshness refresh plan with an optional Pending Work Log summary.
// Every target is stamped first, preserving the planner's all-or-nothing
// refusal behavior, then one entry is prepended for each stamped pre-write
// Pending (`[/]`) task. The shared inserter preserves marker ownership,
// indentation, line endings, and existing child blocks.
function planFreshStampBatchWithWorkLogs(
  content,
  targetLines,
  stamper,
  dateText,
  summary,
) {
  const stampPlan = planFreshStampBatch(content, targetLines, stamper, dateText);
  if (!stampPlan.ok) {
    return Object.freeze({ ...stampPlan, workLogWrittenCount: 0 });
  }
  const normalized = normalizeLaneWorkSummary(summary);
  if (!normalized) {
    return Object.freeze({ ...stampPlan, workLogWrittenCount: 0 });
  }
  const { lines, lineEnding } = splitMarkdownContent(stampPlan.content);
  const pendingLines = Array.from(
    new Set(
      stampPlan.stamped
        .filter((entry) => isPendingWorkLogTargetRawLine(entry.before))
        .map((entry) => entry.line),
    ),
  ).sort((a, b) => b - a);
  let workLogWrittenCount = 0;
  for (const line of pendingLines) {
    if (insertLaneWorkLogEntry(lines, line, normalized, dateText)) {
      workLogWrittenCount += 1;
    }
  }
  return Object.freeze({
    ...stampPlan,
    content: lines.join(lineEnding),
    workLogWrittenCount,
  });
}

// True when the line already carries today's stamp (re-stamping it repairs
// placement at most and does not grow the "refreshed today" count).
function freshStampLineHasToday(rawLine, dateText) {
  const day = String(dateText || "").trim();
  if (!day) {
    return false;
  }
  const escaped = day.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[\\[(]fresh\\s*::\\s*${escaped}`).test(
    String(rawLine || ""),
  );
}

// First valid `[keeps:: N]` semantic count (1-999) on the line, or 0.
// Mirrors the ledger-tools `freshnessParseKeepsValue` first-valid rule
// without placing anything; used only to measure actual increments for
// the `kept N×` notice tail.
function parseKeepsCount(lineText) {
  const text = String(lineText || "");
  const pattern = /(?:\[keeps\s*::\s*([^\]\n]*)\]|\((?:keeps)\s*::\s*([^)\n]*)\))/g;
  let match = pattern.exec(text);
  while (match) {
    const raw = String(match[1] ?? match[2] ?? "").trim();
    if (/^[+-]?\d+$/.test(raw)) {
      const number = Number(raw);
      if (Number.isSafeInteger(number) && number >= 1 && number <= 999) {
        return number;
      }
    }
    match = pattern.exec(text);
  }
  return 0;
}

// How many stamped entries actually incremented their streak: a counted
// entry whose after-line keeps is exactly one above the before-line keeps
// (saturating at 999). Uncounted preserves, same-day counted preserves,
// and stale-cache mismatches never inflate this number. Batch notices
// never promise `next review asks` — only the decision card's Keep does,
// where the installed card is the active capability.
function countFreshStampKept(stamped) {
  let kept = 0;
  for (const entry of Array.isArray(stamped) ? stamped : []) {
    if (!entry || entry.counted !== true) {
      continue;
    }
    const beforeKeeps = parseKeepsCount(entry.before);
    const afterKeeps = parseKeepsCount(entry.after);
    if (afterKeeps > 0 && afterKeeps === Math.min(beforeKeeps + 1, 999)) {
      kept += 1;
    }
  }
  return kept;
}

// Deduplicate stamp targets to one write per source task: the first entry
// wins for each `path + 0-based line` identity. Duplicate Task Links
// resolving to the same source line stamp and count once, never twice.
function deduplicateFreshStampTargets(targets) {
  const seen = new Set();
  const kept = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target || typeof target !== "object") {
      continue;
    }
    const key = `${String(target.path || "")}::${Math.floor(numericOrDefault(target.line, Number.NaN))}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(target);
  }
  return Object.freeze(kept);
}

// `Fresh ✓ 1 task · 22 due (3 new) · ✓ 13 today` from the pre-write counts
// adjusted by the change (the Tasks cache lags, so post-write counts would
// still show the old queue). With a budget the tail reads `✓ 13/15`; once
// the budget is met and no NEW task remains, ` · done for today` is added.
// With `kept > 0` actual streak increments, the tail gains ` · kept N×`.
function buildFreshStampNotice(details = {}) {
  const changed = Math.max(
    0,
    Math.floor(numericOrDefault(details.changed, 0)),
  );
  const dueAfter = Math.max(
    0,
    Math.floor(numericOrDefault(details.dueAfter, 0)),
  );
  const newAfter = Math.max(
    0,
    Math.floor(numericOrDefault(details.newAfter, 0)),
  );
  const refreshedAfter = Math.max(
    0,
    Math.floor(numericOrDefault(details.refreshedAfter, 0)),
  );
  const budgetRaw = details.budget === null || details.budget === undefined
    ? null
    : Math.floor(numericOrDefault(details.budget, Number.NaN));
  const budget =
    Number.isInteger(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
  const tasks = changed === 1 ? "task" : "tasks";
  const tail = budget !== null
    ? `✓ ${refreshedAfter}/${budget}`
    : `✓ ${refreshedAfter} today`;
  const done =
    budget !== null && refreshedAfter >= budget && newAfter === 0
      ? " · done for today"
      : "";
  const keptRaw = Math.floor(numericOrDefault(details.kept, 0));
  const keptTail =
    Number.isInteger(keptRaw) && keptRaw > 0 ? ` · kept ${keptRaw}×` : "";
  const workLogWrittenCount = Math.max(
    0,
    Math.floor(numericOrDefault(details.workLogWrittenCount, 0)),
  );
  const workLogTail = workLogWrittenCount > 0
    ? ` · ${formatCountLabel(workLogWrittenCount, "Work Log")}`
    : "";
  return `Fresh ✓ ${changed} ${tasks} · ${dueAfter} due (${newAfter} new) · ${tail}${done}${keptTail}${workLogTail}`;
}

// True when the freshness api can count keeps: namespace v5 with the sole
// increment helper. A v5 namespace missing `keepLine` must fail without
// writing (never fall back to the now-resetting generic stamper); a
// pre-v5 namespace stamps uncounted through the old stamper.
function freshnessSupportsKeeps(freshnessApi) {
  try {
    return (
      Boolean(freshnessApi) &&
      Number(freshnessApi.version) >= 5 &&
      typeof freshnessApi.keepLine === "function"
    );
  } catch (error) {
    return false;
  }
}

// True when the freshness api can intercept cards and skip decision
// targets: namespace v6 with the sole increment helper. A v5
// namespace still counts through `keepLine` but falls back to the
// counted keep path instead of opening a card or skipping. Never throws.
function freshnessSupportsDecayDecisions(freshnessApi) {
  try {
    return (
      Boolean(freshnessApi) &&
      Number(freshnessApi.version) >= 6 &&
      typeof freshnessApi.keepLine === "function"
    );
  } catch (error) {
    return false;
  }
}

// Strict keep-counting eligibility for one explicit keep (`docs/freshness.md`
// §2a): `ref` (`{ path, line, raw }` with the pre-write 0-based editor line)
// authorizes counting only when the pre-write queue holds exactly one row
// with `entry.path === path`, `entry.line === editorLine + 1`,
// `entry.originalMarkdown === rawLine`, `lane === 'ready'`, and
// `tier in {'rotten','tickler'}`. Line-only or raw-only matches, age,
// glyph, bucket alone, block ID alone, a changed line number, or a selected
// DOM row never authorize. Anything else stamps uncounted through
// `keepLine` and preserves the streak. Returns `{ ok, entry, reason }`
// with `reason` one of `ok`, `missing`, `ambiguous`, `lane`, or `tier`.
function matchFreshStampExactEntry(queueBefore, ref) {
  const missing = (reason) =>
    Object.freeze({ ok: false, entry: null, reason });
  const list = Array.isArray(queueBefore) ? queueBefore : [];
  if (!ref || typeof ref !== "object") {
    return missing("missing");
  }
  const refPath = String(ref.path || "");
  const refLine = Math.floor(numericOrDefault(ref.line, Number.NaN));
  const refRaw = String(ref.raw || "");
  if (!Number.isInteger(refLine) || !refRaw) {
    return missing("missing");
  }
  const candidates = list.filter(
    (entry) =>
      Boolean(entry) &&
      String(entry.path || "") === refPath &&
      Number(entry.line) === refLine + 1 &&
      String(entry.originalMarkdown || "") === refRaw,
  );
  if (candidates.length === 0) {
    return missing("missing");
  }
  if (candidates.length > 1) {
    return missing("ambiguous");
  }
  const entry = candidates[0];
  if (entry.lane !== "ready") {
    return Object.freeze({ ok: false, entry, reason: "lane" });
  }
  const tier = reviewEntryMachineTier(entry);
  if (tier !== "rotten" && tier !== "tickler") {
    return Object.freeze({ ok: false, entry, reason: "tier" });
  }
  return Object.freeze({ ok: true, entry, reason: "ok" });
}

// Alt+F (wantAdvance false) / Ctrl+Alt+F (wantAdvance true). Obsidian >=
// 1.14 runs its keymap as a window capture listener registered before
// plugins load, so a bound hotkey runs the command first whatever the Vim
// mode and only calls stopPropagation; that command path consumes a pending
// Vim count itself. The capture-phase fallback therefore skips keydowns
// already defaultPrevented and acts only when no binding handled the chord,
// for example after the hotkey is removed or on an older build. Shift and
// Meta are never part of a supported refresh chord: Alt+Shift+F is retired.
function isReviewRefreshKeydown(event, wantAdvance) {
  if (!event || event.metaKey || event.shiftKey || !event.altKey) {
    return false;
  }
  if (Boolean(event.ctrlKey) !== Boolean(wantAdvance)) {
    return false;
  }
  return event.code === "KeyF" || event.key === "f" || event.key === "F";
}

async function openMarkdownFileWithLeafReuse(plugin, file, failureNotice) {
  if (!plugin || !plugin.isMarkdownFile(file)) {
    if (failureNotice) {
      new Notice(failureNotice);
    }
    return false;
  }

  const activeView = plugin.getActiveMarkdownView();
  if (activeView && activeView.file && activeView.file.path === file.path) {
    return true;
  }

  try {
    const existingLeaf = plugin.findMarkdownLeafByPath(file.path);
    if (existingLeaf && (await plugin.activateWorkspaceLeaf(existingLeaf))) {
      return true;
    }

    await plugin.app.workspace.getLeaf(false).openFile(file);
    return true;
  } catch (error) {
    if (failureNotice) {
      new Notice(failureNotice);
    }
    return false;
  }
}

// nav api v3 (`docs/task-dependencies.md` §9). Dependency calls return Promises
// resolving to `{ok, reason?}` and never throw; checklist claim synchronously
// declines with null or returns a settled Promise; `reviewWalk` is the
// review-walk auto-advance contract (`capture`/`continue`, version 1).
// `openDependencyStage`
// opens today's Depends on stage for the owning task of `ref` (`ref`:
// `{path, line}` — any line of the task block or its Depends-On line);
// `nav-stage` swaps in the vault-wide stage. `removeDependency` removes one
// prerequisite through the single-transaction writer (`parentRef`:
// `{path, line}`, `target`: `{path, blockId}`); it re-reads the dependent
// and refuses with a notice when stale. `taskLinkLane` is the Pomodoro Task
// Link lane toggle (plan 202610/in_progress_task_link_marks.md §3): `matches`
// synchronously reports whether a line is a Pomodoro Task Link line and
// `toggle` runs the Next <-> In Progress toggle, settling to a result
// object and never rejecting. Plugins never import each other's
// `main.js`: bob-ledger-tools feature-detects `api?.version >= 1` and
// task-status-cycler feature-detects `api?.taskLinkLane?.version >= 1`.
// `notice` is the additive Unblocked card (`api.notice` v1, §12.6);
// callers feature-detect `api.notice?.version >= 1`.
function createDependencyNavApi(plugin) {
  const shape = (result) =>
    result && typeof result === "object" && "ok" in result
      ? result
      : { ok: false, reason: "unexpected-result" };
  const settle = (call) => {
    try {
      return Promise.resolve()
        .then(call)
        .then(shape, () => ({ ok: false, reason: "api-failed" }));
    } catch (_error) {
      return Promise.resolve({ ok: false, reason: "api-failed" });
    }
  };
  // The review-walk decision card (`docs/freshness.md` §2a): present
  // while the plugin is loaded so ledger-tools marks can promise the
  // leaf and `Alt+F to decide`. Removed again on unload (see `onunload`)
  // so marks degrade to counting pips instead of an absent card.
  return Object.freeze({
    version: 3,
    ...(plugin ? { freshnessDecayCard: FRESHNESS_DECAY_CARD_CAPABILITY } : null),
    reviewWalk: createReviewWalkApi(plugin),
    inboxRoute: createInboxRouteApi(plugin),
    taskLinkLane: createTaskLinkLaneApi(plugin),
    notice: createNoticeApi(plugin),
    openDependencyStage(ref) {
      if (!plugin || typeof plugin.openDependencyStageForRef !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() => plugin.openDependencyStageForRef(ref || {}));
    },
    removeDependency(parentRef, target) {
      if (!plugin || typeof plugin.removeDependencyByRef !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() =>
        plugin.removeDependencyByRef(parentRef || {}, target || {}),
      );
    },
    claimReviewWalkCompletion(editor) {
      try {
        if (!plugin || typeof plugin.claimReviewWalkCtrlEnter !== "function") {
          return null;
        }
        const result = plugin.claimReviewWalkCtrlEnter(editor);
        if (!result || typeof result.then !== "function") {
          return null;
        }
        return Promise.resolve(result)
          .then(shape)
          .catch(() => ({ ok: false, reason: "api-failed" }));
      } catch (error) {
        return null;
      }
    },
  });
}
