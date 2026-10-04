
// Ctrl+[ closes the Task Card and every stage its modal opens. Matches the
// requested chord only: Ctrl alone (no Alt, Meta, or Shift). This is the
// modal's own close path; it does not synthesize Escape or go through Vim.
function isCtrlLeftBracketKeydown(event) {
  return (
    Boolean(event) &&
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    event.shiftKey !== true &&
    (event.code === "BracketLeft" || event.key === "[")
  );
}

// The keys that close the Task Card without writing: Escape, bare q / Q
// (Shift allowed for Q; never Ctrl, Meta, or Alt), and Ctrl+[. Composition
// and text-field focus are the caller's guards.
function isTaskCardCloseKeydown(event) {
  if (!event) {
    return false;
  }
  const key = String(event.key || "");
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  return (
    (key === "Escape" && !ctrl && !meta && !alt && !shift) ||
    (key.toLowerCase() === "q" && !ctrl && !meta && !alt) ||
    isCtrlLeftBracketKeydown(event)
  );
}

function isCtrlKey(event, key) {
  return (
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === key
  );
}

// ---------------------------------------------------------------------------
// freshness review (nav-review): vault-wide due-task jumps (Ctrl+Alt+J/K,
// `]s` / `[s` via the vimrc) and Alt+F / Alt+Shift+F refresh.
//
// Reads come from `api.freshness.queue()` / `api.freshness.counts()` on
// bob-ledger-tools (api `version >= 3`); writes go through
// `api.freshness.stampLine` only. Placement is the exception to the
// copy-small-helpers rule: nav never places `[fresh::]` itself, so when
// ledger-tools is absent or old the command shows
// "Bob Ledger Tools api v3 required" and changes nothing. A missing stamp
// only means Bryan sees the task once more; a misplaced stamp could hide
// Tasks fields, so the risky part lives in one place.

const REVIEW_FRESHNESS_API_REQUIRED_NOTICE = "Bob Ledger Tools api v3 required";
const REVIEW_FRESHNESS_KEEP_REQUIRED_NOTICE = "Bob Ledger Tools keep support required";
const REVIEW_QUEUE_CHANGED_NOTICE = "Review queue changed — try again";

// The ledger-tools freshness namespace, or null when it is absent or older
// than api `version >= 3`. Never throws.
function getReviewFreshnessApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins ? plugins["bob-ledger-tools"] : null;
    const api = holder ? holder.api : null;
    if (!api || Number(api.version) < 3 || !api.freshness) {
      return null;
    }
    return api.freshness;
  } catch (error) {
    return null;
  }
}

// Tier-aware walk behavior (ledger-tools freshness namespace v4) requires
// `api.freshness.version >= 4`. With v3 the walk still works, but notices
// keep the legacy state text and the refresh row keeps the local chain.
function reviewFreshnessSupportsTiers(freshnessApi) {
  try {
    return (
      Boolean(freshnessApi) && Number(freshnessApi.version) >= 4
    );
  } catch (error) {
    return false;
  }
}

// Project/reference tracking review (ledger-tools freshness capability
// `trackerReview`). Legacy v3/v4 queues keep working when the
// capability is absent: they never carry `projects` or `references`
// entries, and every branch below treats a missing capability as "no
// tracker detail".
function reviewFreshnessSupportsTrackers(freshnessApi) {
  try {
    return (
      Boolean(freshnessApi) && freshnessApi.trackerReview === true
    );
  } catch (error) {
    return false;
  }
}

// Machine walk tier for a queue entry: v4 `tier` (plus the `projects`
// and `references` tracker tiers), else the legacy v3 `state` mapping
// (`resurfaced` reads as the RETURNED tier). Returns "".
function reviewEntryMachineTier(entry) {
  const tier =
    entry && typeof entry.tier === "string"
      ? entry.tier.trim().toLowerCase()
      : "";
  if (
    tier === "new" ||
    tier === "projects" ||
    tier === "pending" ||
    tier === "next" ||
    tier === "returned" ||
    tier === "references" ||
    tier === "rotten"
  ) {
    return tier;
  }
  const state =
    entry && typeof entry.state === "string"
      ? entry.state.trim().toLowerCase()
      : "";
  if (state === "new") {
    return "new";
  }
  if (state === "rotten") {
    return "rotten";
  }
  if (state === "resurfaced") {
    return "returned";
  }
  return "";
}

// Display tier for a queue entry: v4 `tierLabel`, else the machine tier.
function reviewEntryTierLabel(entry) {
  if (entry && typeof entry.tierLabel === "string" && entry.tierLabel) {
    return entry.tierLabel;
  }
  const tier = reviewEntryMachineTier(entry);
  return tier ? tier.toUpperCase() : "";
}

// True for v4 tiered entries (they carry per-tier ranks).
function reviewEntryHasTierRanks(entry) {
  return (
    Boolean(entry) &&
    Number.isInteger(entry.tierRank) &&
    Number.isInteger(entry.tierTotal)
  );
}

function reviewIsCommitmentTier(tier) {
  return (
    tier === "new" ||
    tier === "projects" ||
    tier === "pending" ||
    tier === "next" ||
    tier === "returned" ||
    tier === "references"
  );
}

// Canonical `YYYY-MM-DD` as a day number, or null.
function reviewParseDayNumber(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim());
  if (!match) {
    return null;
  }
  const day = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (!Number.isFinite(day)) {
    return null;
  }
  return Math.round(day / 86400000);
}

// `2026-10-07` -> `Oct 7`, else the raw text.
function reviewShortDate(text) {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim());
  if (!match) {
    return String(text || "");
  }
  const month = months[Number(match[2]) - 1];
  if (!month) {
    return String(text || "");
  }
  return `${month} ${Number(match[3])}`;
}

// Lane detail for a PENDING/NEXT entry: `never confirmed`,
// `confirmed yesterday`, or `confirmed {n} days ago`, from the age of
// `fresh`. Prefers an explicit `todayText`, else derives the age from
// `daysOverdue + interval` (`dueOn = fresh + interval`).
function reviewLaneConfirmedDetail(entry, todayText) {
  const fresh =
    entry && typeof entry.fresh === "string" && entry.fresh
      ? entry.fresh
      : null;
  if (!fresh) {
    return "never confirmed";
  }
  const freshDay = reviewParseDayNumber(fresh);
  const todayDay = reviewParseDayNumber(todayText);
  let age = null;
  if (freshDay !== null && todayDay !== null) {
    age = todayDay - freshDay;
  } else if (
    entry &&
    Number.isFinite(entry.daysOverdue) &&
    Number.isInteger(entry.interval)
  ) {
    age = Math.max(0, Math.floor(entry.daysOverdue)) + entry.interval;
  }
  if (age === null || !Number.isFinite(age)) {
    return `confirmed ${fresh}`;
  }
  if (age <= 0) {
    return "confirmed today";
  }
  if (age === 1) {
    return "confirmed yesterday";
  }
  return `confirmed ${age} days ago`;
}

// Task freshness stamping (nav-stamps): placement lives in bob-ledger-tools
// (`api.freshness.stampLine` / `setRefreshLine`, api `version >= 3`). This
// plugin never places `[fresh::]` itself: a missing stamp only means Bryan
// sees the task once more, while a misplaced stamp would hide Tasks fields.
// When ledger-tools is absent or old, gestures simply don't stamp. Pure
// planners take the stamper as an injected `stampLine` option (identity by
// default, never throws), applied as the last edit of every rewritten task
// line that stays open.
function identityFreshStampLine(line) {
  return String(line || "");
}

function applyFreshStampLine(line, stamper, dateText) {
  const fn = typeof stamper === "function" ? stamper : identityFreshStampLine;
  try {
    const stamped = fn(String(line || ""), dateText);
    if (typeof stamped === "string") {
      return stamped;
    }
    return String(line || "");
  } catch (error) {
    return String(line || "");
  }
}

function applyFreshRefreshLine(line, refresher, days, dateText) {
  const fn = typeof refresher === "function" ? refresher : null;
  if (!fn) {
    return String(line || "");
  }
  try {
    const out = fn(String(line || ""), days, dateText);
    if (typeof out === "string") {
      return out;
    }
    return String(line || "");
  } catch (error) {
    return String(line || "");
  }
}

function resolveFreshStamper(options) {
  if (options && typeof options.stampLine === "function") {
    return options.stampLine;
  }
  return null;
}

function resolveFreshDateText(options) {
  if (options && typeof options.freshDateText === "string" && options.freshDateText) {
    return options.freshDateText;
  }
  if (options && typeof options.dateText === "string" && options.dateText) {
    return options.dateText;
  }
  return undefined;
}

// First valid `[refresh:: N]` (1-365) on the line, or null. Mirrors the
// ledger-tools placement rule's "first valid existing one" without placing
// anything.
function parseRefreshDaysFromLine(lineText) {
  const text = String(lineText || "");
  const pattern = /(?:\[refresh\s*::\s*([^\]\n]*)\]|\((?:refresh)\s*::\s*([^)\n]*)\))/g;
  let match = pattern.exec(text);
  while (match) {
    const raw = String(match[1] ?? match[2] ?? "").trim();
    if (/^[+-]?\d+$/.test(raw)) {
      const number = Number(raw);
      if (Number.isSafeInteger(number) && number >= 1 && number <= 365) {
        return number;
      }
    }
    match = pattern.exec(text);
  }
  return null;
}

function parseNoteRefreshDays(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }
  const text = String(raw)
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!/^[+-]?\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return null;
  }
  return number;
}

// Effective refresh interval for one task line: the task's `[refresh:: N]`,
// then the note's `task_refresh`, then `freshness.interval`, then 7. Returns
// `{ days, source }` with source one of `task`, `note`, `config`, `default`.
function describeRefreshInterval(lineText, noteRefreshRaw, freshnessApi) {
  // v4 ledger-tools exposes the lane-aware chain (with the Ready-chain
  // interval the task returns to after release) as
  // `api.freshness.intervalForLine`, so nav never re-implements it. v3
  // namespaces keep the local chain below.
  try {
    if (
      freshnessApi &&
      typeof freshnessApi.intervalForLine === "function"
    ) {
      const resolved = freshnessApi.intervalForLine(
        String(lineText || ""),
        noteRefreshRaw,
      );
      if (
        resolved &&
        Number.isInteger(resolved.days) &&
        resolved.days >= 1 &&
        resolved.days <= 365 &&
        typeof resolved.source === "string"
      ) {
        const ready =
          resolved.ready && Number.isInteger(resolved.ready.days)
            ? Object.freeze({
              days: resolved.ready.days,
              source: resolved.ready.source,
            })
            : null;
        return Object.freeze({
          days: resolved.days,
          source: resolved.source,
          ready,
        });
      }
    }
  } catch (error) {
    // Fall through to the local chain.
  }
  const taskDays = parseRefreshDaysFromLine(lineText);
  if (taskDays !== null) {
    return Object.freeze({ days: taskDays, source: "task", ready: null });
  }
  const noteDays = parseNoteRefreshDays(noteRefreshRaw);
  if (noteDays !== null) {
    return Object.freeze({ days: noteDays, source: "note", ready: null });
  }
  let configDays = null;
  try {
    const config = freshnessApi && typeof freshnessApi.config === "function"
      ? freshnessApi.config()
      : null;
    if (config && Number.isInteger(config.interval) && config.interval >= 1 && config.interval <= 365) {
      configDays = config.interval;
    }
  } catch (error) {
    configDays = null;
  }
  // `api.freshness.config()` only exposes `{ interval, ... }` without the
  // internal `intervalFromConfig` flag, so an explicit `interval: 7` and an
  // absent block both read as 7. Follow the plan's picker example and report
  // the fallback as `config` (e.g. `every 7 d (config)`); task and note
  // overrides still win above.
  if (configDays !== null) {
    return Object.freeze({ days: configDays, source: "config", ready: null });
  }
  return Object.freeze({ days: 7, source: "default", ready: null });
}

// Describe the pinned refresh picker row: null when the freshness api (with
// `setRefreshLine`) is absent, or when no open `#task` target exists.
// Otherwise the effective interval, its source, and the detail line the
// picker renders, e.g. `refresh · every 7 d (config)`.
function describeRefreshRow(content, options = {}) {
  const freshnessApi = options.freshnessApi || null;
  if (!freshnessApi || typeof freshnessApi.setRefreshLine !== "function") {
    return null;
  }
  const text = String(content || "");
  const cursorLine = Math.floor(numericOrDefault(options.cursorLine, NaN));
  const taskSession = options.taskSession || null;
  const linkResolved = Array.isArray(options.linkResolved) ? options.linkResolved : null;
  const fallbackNoteRefreshRaw =
    options.noteRefreshRaw !== undefined
      ? options.noteRefreshRaw
      : getNoteTaskRefreshRaw(text);
  const statusOf = (lineText) => getObsidianTaskCheckboxStatus(lineText);
  const isOpenStatus = (status) => status !== null && OPEN_OBSIDIAN_TASK_STATUSES.has(status);
  const detailFor = (lineText, noteRaw) => {
    const interval = describeRefreshInterval(
      lineText,
      noteRaw !== undefined ? noteRaw : fallbackNoteRefreshRaw,
      freshnessApi,
    );
    // Lane tasks read their lane interval, with the task's own refresh
    // kept as the once-Ready return value, e.g.
    // `refresh · every 1 d (next lane) · 14 d once Ready`.
    if (interval.source === "pending" || interval.source === "next") {
      let detail = `refresh · every ${interval.days} d (${interval.source} lane)`;
      if (interval.ready && interval.ready.source === "task") {
        detail += ` · ${interval.ready.days} d once Ready`;
      }
      return Object.freeze({
        days: interval.days,
        source: interval.source,
        detail,
      });
    }
    return Object.freeze({
      days: interval.days,
      source: interval.source,
      detail: `refresh · every ${interval.days} d (${interval.source})`,
    });
  };
  const noteRawForLinkTarget = (target) => {
    if (target && typeof target.content === "string") {
      return getNoteTaskRefreshRaw(target.content);
    }
    return fallbackNoteRefreshRaw;
  };
  if (linkResolved) {
    if (linkResolved.length === 0) {
      return null;
    }
    const open = linkResolved.filter((target) => {
      const raw = String((target && target.rawLine) || "");
      return isObsidianTaskLine(raw) && isOpenStatus(statusOf(raw));
    });
    if (open.length === 0) {
      return null;
    }
    const first = detailFor(String(open[0].rawLine || ""), noteRawForLinkTarget(open[0]));
    const mixed = open.some((target) => {
      const current = detailFor(String(target.rawLine || ""), noteRawForLinkTarget(target));
      return current.days !== first.days || current.source !== first.source;
    });
    return Object.freeze({
      kind: "link",
      count: linkResolved.length,
      openCount: open.length,
      days: mixed ? null : first.days,
      source: mixed ? null : first.source,
      detail: mixed ? "refresh · mixed" : first.detail,
      mixed,
    });
  }
  if (taskSession && Array.isArray(taskSession.targets) && taskSession.targets.length > 0) {
    const open = taskSession.targets.filter((target) => {
      const raw = String((target && target.rawLine) || "");
      return isObsidianTaskLine(raw) && isOpenStatus(statusOf(raw));
    });
    if (open.length === 0) {
      return null;
    }
    const first = detailFor(String(open[0].rawLine || ""));
    const mixed = open.some((target) => {
      const current = detailFor(String(target.rawLine || ""));
      return current.days !== first.days || current.source !== first.source;
    });
    return Object.freeze({
      kind: "task",
      count: taskSession.targets.length,
      openCount: open.length,
      days: mixed ? null : first.days,
      source: mixed ? null : first.source,
      detail: mixed ? "refresh · mixed" : first.detail,
      mixed,
    });
  }
  if (Number.isFinite(cursorLine)) {
    const lines = text.split(/\r?\n/);
    const line = String(lines[cursorLine] || "");
    if (!isObsidianTaskLine(line)) {
      return null;
    }
    if (!isOpenStatus(statusOf(line))) {
      return null;
    }
    const resolved = detailFor(line);
    return Object.freeze({
      kind: "task",
      count: 1,
      openCount: 1,
      days: resolved.days,
      source: resolved.source,
      detail: resolved.detail,
      mixed: false,
    });
  }
  return null;
}

const REFRESH_ROW_PRESET_DAYS = Object.freeze([2, 3, 7, 14, 30, 90, 180, 365]);

// Value-stage items for the refresh row: presets, plus "use default" which
// clears `[refresh:: N]` (via `setRefreshLine` with null, which also stamps).
function createRefreshValueItems(currentDays) {
  const items = REFRESH_ROW_PRESET_DAYS.map((days) => Object.freeze({
    kind: "value",
    value: days,
    label: `${days} days`,
    detail: days === currentDays ? "Current value" : `every ${days} d`,
    current: days === currentDays,
    dynamic: false,
    refreshDays: days,
    searchText: `${days} ${days} days every ${days} d refresh`,
  }));
  items.push(Object.freeze({
    kind: "value",
    value: null,
    label: "use default",
    detail: currentDays === null || currentDays === undefined ? "Current value" : "clear [refresh:: N]",
    current: currentDays === null || currentDays === undefined,
    dynamic: false,
    refreshDays: null,
    searchText: "use default clear default refresh",
  }));
  return Object.freeze(items);
}

// A typed custom refresh value: an integer 1-365, else null.
function parseRefreshCustomValue(query) {
  const text = String(query || "").trim();
  if (!/^[+-]?\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return null;
  }
  return number;
}

// Raw `task_refresh` value from a note's frontmatter, or undefined when
// absent. Lightweight: no YAML dependency, mirrors the ledger-tools
// `task_refresh` parse (integer 1-365, quoted or not).
function getNoteTaskRefreshRaw(content) {
  try {
    const text = String(content || "");
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) {
      return undefined;
    }
    const frontmatter = match[1];
    const lineMatch = /^[ \t]*task_refresh[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter);
    if (!lineMatch) {
      return undefined;
    }
    return lineMatch[1];
  } catch (error) {
    return undefined;
  }
}

// Stable identity for a queue entry across re-reads. Ledger-tools entries
// carry `key`; fall back to path plus the 1-based line.
function reviewQueueEntryKey(entry) {
  if (entry && typeof entry.key === "string" && entry.key) {
    return entry.key;
  }
  const path = entry && typeof entry.path === "string" ? entry.path : "";
  const line = entry && Number.isInteger(entry.line) ? entry.line : 0;
  return `${path}:${line}`;
}

// Walk anchor: where the walk is. Recorded on every successful landing
// and every Alt+F / Alt+Shift+F stamp. Holds the handled entry keys, the
// handled task's path/line/tier, and the ordered keys after and before
// them in the queue they came from, so `]s` after an Alt+N release,
// Ctrl+Shift+Enter, or a roll continues from the successor (and `[s` from
// the predecessor) instead of restarting at rank 1.
function buildReviewAnchor(queue, handledKeys, fallbackRank) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const keys = list.map((entry) => reviewQueueEntryKey(entry));
  const handled = new Set(Array.isArray(handledKeys) ? handledKeys : []);
  const positions = [];
  keys.forEach((key, index) => {
    if (handled.has(key)) {
      positions.push(index);
    }
  });
  if (positions.length === 0) {
    return null;
  }
  const at = Math.max(...positions);
  const holder = list[at];
  const afterKeys = keys.slice(at + 1);
  const beforeKeys = keys.slice(0, at).filter((key) => !handled.has(key));
  const rank =
    holder && Number.isInteger(holder.rank)
      ? holder.rank
      : Number.isInteger(fallbackRank)
        ? fallbackRank
        : at + 1;
  return Object.freeze({
    keys: Object.freeze(Array.from(handled)),
    rank,
    count: handled.size,
    path: holder && typeof holder.path === "string" ? holder.path : "",
    line: holder && Number.isInteger(holder.line) ? holder.line : null,
    tier: reviewEntryMachineTier(holder) || null,
    afterKeys: Object.freeze(afterKeys),
    beforeKeys: Object.freeze(beforeKeys),
  });
}

// Remaining walk counts after excluding handled keys: `{ commitments,
// rotten }`. Commitments are the NEW/PROJECTS/PENDING/NEXT/RETURNED/
// REFERENCES tiers.
function reviewWalkRemaining(queue, excludedKeys) {
  const excluded =
    excludedKeys instanceof Set
      ? excludedKeys
      : new Set(Array.isArray(excludedKeys) ? excludedKeys : []);
  let commitments = 0;
  let rotten = 0;
  for (const entry of Array.isArray(queue) ? queue : []) {
    if (excluded.has(reviewQueueEntryKey(entry))) {
      continue;
    }
    const tier = reviewEntryMachineTier(entry);
    if (reviewIsCommitmentTier(tier)) {
      commitments += 1;
    } else if (tier === "rotten") {
      rotten += 1;
    }
  }
  return Object.freeze({ commitments, rotten });
}

// Boundary line prepended when a forward step leaves a commitment tier
// for ROTTEN, or null when no boundary applies:
// - `Commitments done \u2014 {n} ROTTEN left` when none remain;
// - `ROTTEN next \u2014 {m} commitments still due` otherwise.
// A step from an unknown origin only shows the done line (when zero
// remain); a step within ROTTEN never shows one.
function buildReviewBoundaryNotice(options = {}) {
  const dest = String(options.destTier || "").trim().toLowerCase();
  if (dest !== "rotten") {
    return null;
  }
  const origin =
    options.originTier === null ||
    options.originTier === undefined ||
    String(options.originTier).trim() === ""
      ? null
      : String(options.originTier).trim().toLowerCase();
  if (origin !== null && !reviewIsCommitmentTier(origin)) {
    return null;
  }
  const commitments = Number.isInteger(options.commitmentsLeft)
    ? options.commitmentsLeft
    : null;
  const rotten = Number.isInteger(options.rottenLeft)
    ? options.rottenLeft
    : null;
  if (commitments === null) {
    return null;
  }
  if (commitments === 0) {
    return `Commitments done \u2014 ${rotten === null ? 0 : rotten} ROTTEN left`;
  }
  if (origin === null) {
    return null;
  }
  return `ROTTEN next \u2014 ${commitments} commitments still due`;
}

// Resolve one anchor step over `remaining` (the queue minus the handled
// keys). Forward takes the first surviving `afterKeys` entry, backward
// the last surviving `beforeKeys` entry, wrapping to the first/last
// remaining entry. Ranks count over `remaining` (1-based).
function resolveReviewAnchorTarget(remaining, anchor, direction) {
  const rest = Array.isArray(remaining) ? remaining : [];
  if (rest.length === 0) {
    return null;
  }
  const atRest = (key) =>
    rest.findIndex((entry) => reviewQueueEntryKey(entry) === key);
  if (direction < 0) {
    const before = anchor && Array.isArray(anchor.beforeKeys)
      ? anchor.beforeKeys
      : [];
    for (let index = before.length - 1; index >= 0; index -= 1) {
      const found = atRest(before[index]);
      if (found >= 0) {
        return Object.freeze({
          entry: rest[found],
          rank: found + 1,
          total: rest.length,
          wrapped: false,
        });
      }
    }
    return Object.freeze({
      entry: rest[rest.length - 1],
      rank: rest.length,
      total: rest.length,
      wrapped: true,
    });
  }
  const after = anchor && Array.isArray(anchor.afterKeys)
    ? anchor.afterKeys
    : [];
  for (const key of after) {
    const found = atRest(key);
    if (found >= 0) {
      return Object.freeze({
        entry: rest[found],
        rank: found + 1,
        total: rest.length,
        wrapped: false,
      });
    }
  }
  return Object.freeze({
    entry: rest[0],
    rank: 1,
    total: rest.length,
    wrapped: true,
  });
}

// After the one-step landing, move `repeat - 1` further indexes on the
// same walk list (full queue for a cursor hit or no-origin fallback;
// remaining for an anchor). Absent or invalid `repeat` is 1.
function applyReviewJumpRepeat(step, walkList, direction, repeatRaw) {
  if (!step || step.kind !== "jump") {
    return step;
  }
  const repeat = normalizeVimRepeat(repeatRaw);
  if (repeat <= 1) {
    return Object.freeze({
      kind: "jump",
      entry: step.entry,
      rank: step.rank,
      total: step.total,
      wrapped: step.wrapped,
      originTier: step.originTier,
    });
  }
  const list = Array.isArray(walkList) ? walkList : [];
  if (list.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const wantKey = reviewQueueEntryKey(step.entry);
  const firstIndex = list.findIndex(
    (entry) =>
      entry === step.entry || reviewQueueEntryKey(entry) === wantKey,
  );
  if (firstIndex < 0) {
    return Object.freeze({
      kind: "jump",
      entry: step.entry,
      rank: step.rank,
      total: step.total,
      wrapped: step.wrapped,
      originTier: step.originTier,
    });
  }
  const extra = repeat - 1;
  const raw = firstIndex + direction * extra;
  const rem = raw % list.length;
  const finalIndex = rem < 0 ? rem + list.length : rem;
  return Object.freeze({
    kind: "jump",
    entry: list[finalIndex],
    rank: finalIndex + 1,
    total: list.length,
    wrapped: Boolean(step.wrapped) || raw < 0 || raw >= list.length,
    originTier: step.originTier,
  });
}

// Pure jump position over a freshly read queue. Returns `{ kind: "empty" }`
// or `{ kind: "jump", entry, rank, total, wrapped, originTier }`
// (`rank` is 1-based). `endpoint` ("first"/"last") selects that queue
// endpoint with full-queue rank/total, `wrapped: false`, and a null origin,
// ignoring cursor, anchor, and `repeat`. `direction` is +1 (next) or -1
// (prev); `repeat` is the total number of queue steps (default 1).
// `cursor` is `{ path, line, text }` with a 1-based line; `stamped` (or
// `anchor`) is the walk anchor from the last landing or Alt+F write (the
// Tasks cache lags, so handled keys are skipped by key). Origin resolves
// in order: the cursor on a live (unhandled) queue entry goes to its
// neighbor in `direction`; else the anchor goes to its first surviving
// successor (`]s`) or last surviving predecessor (`[s`), wrapping with
// the notice; else the first or last entry. Legacy `{ keys, rank, count }`
// anchors without before/after keys keep the rank-skip behavior forward,
// mirrored backward. Extra counted steps continue from that one-step
// landing on the same walk list; `originTier` stays the one-step origin.
