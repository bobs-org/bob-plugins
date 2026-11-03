// The rung a keep counts on: WIP for `[/]`, Next for `[*]`, the priority
// level label for a prioritized `[ ]`, else Ready. A Blocked `[?]`
// follows its queue lane. Blocked is an overlay, never a rung.
function rottenKeepRungForTarget(raw, entry, priorityName = "priority") {
  const status = getObsidianTaskCheckboxStatus(String(raw || ""));
  if (status === "/") return "WIP";
  if (status === "*") return "Next";
  if (status === "?" && entry && entry.lane === "pending") return "WIP";
  if (status === "?" && entry && entry.lane === "next") return "Next";
  const field = typeof findBulletPropertyField === "function"
    ? findBulletPropertyField(raw, priorityName)
    : null;
  const value = field ? normalizeBulletPropertyValue(field.value) : "";
  return value || "Ready";
}

// Lanes and Ready use "in", P-levels use "at".
function rottenKeepRungPreposition(rung) {
  return rung === "WIP" || rung === "Next" || rung === "Ready" ? "in" : "at";
}

// Whether the row is on its rung's due tier: PENDING for WIP, NEXT for
// Next, ROTTEN/TICKLER for Ready and P-levels (`docs/freshness.md` §2a).
function rottenKeepIsDueRung(lane, tier) {
  if (lane === "pending") return tier === "pending";
  if (lane === "next") return tier === "next";
  if (lane === "ready") return tier === "rotten" || tier === "tickler";
  return false;
}

// Whether the decay card handles lane rungs (WIP, Next): version 3,
// when the rung-aware card ships. Until then lane rows with
// `decide: true` count and log like any keep — no card and no batch
// skip — so a newer ledger never promises a card this nav cannot
// open. Gate every lane-card behavior on this (never on a pasted `3`)
// so the version bump alone flips it.
function freshnessDecayLaneCardAvailable() {
  try {
    return FRESHNESS_DECAY_CARD_VERSION >= 3;
  } catch (error) {
    return false;
  }
}

// Whether an at-limit row on `lane` skips the stamp for a later card
// decision: Ready rows always skip once decisions are enabled, while
// lane rows skip only behind the rung-aware card. Never throws.
function freshnessDecayDecisionSkipsLane(lane) {
  try {
    if (lane !== "pending" && lane !== "next") return true;
    return freshnessDecayLaneCardAvailable();
  } catch (error) {
    return false;
  }
}

// Today membership for a matched queue entry (a Task Link under today's
// open Pomodoros): Today-linked rows never count (`docs/freshness.md`
// §2a). Best-effort — false when the namespace predates `isToday` or
// the row carries no block ID. Never throws.
function freshnessTargetIsToday(api, entry) {
  try {
    if (!api || typeof api.isToday !== "function" || !entry || typeof entry !== "object") {
      return false;
    }
    return api.isToday({ path: entry.path, blockId: entry.blockId }) === true;
  } catch (error) {
    return false;
  }
}

// The quiet notice for an uncounted lane keep that already carries a
// prior-day stamp (early or Today-linked): "early · not counted".
// Same-day repeats and brand-new rows stamp silently. Never throws.
function freshnessQuietNotCountedNotice(raw, dateText) {
  try {
    const text = String(raw || "");
    const day = String(dateText || "").trim();
    if (!day) return "";
    if (freshStampLineHasToday(text, day)) return "";
    const fresh = /[\[(]fresh\s*::\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    if (!fresh || fresh[1] === day) return "";
    return " · early · not counted";
  } catch (error) {
    return "";
  }
}

// A counted keep is predicted by the same pure helper that will stamp it.
// Callers gate this on freshnessSupportsKeeps; legacy stampers never log.
// Counts exact due rows on every rung (WIP, Next, Ready, P-levels) and
// returns the rung plus the before/after keeps. NEW, early/FRESH,
// same-day, Today-linked, PROJECTS, recurring, checklist, unblock
// tickler, unresolved-cache, and Pomodoro rows stamp uncounted through
// the existing path and preserve the streak. `isToday` is Today
// membership for the row (a Task Link under today's open Pomodoros);
// pass true to keep Today-linked rows uncounted.
function classifyRottenKeepTarget({ match, raw, stamper, dateText, isToday } = {}) {
  const keepsBefore = parseKeepsCount(raw);
  const uncounted = { counted: false, keepsBefore, keepsAfter: keepsBefore, rung: null };
  if (isPomodoroFreshnessLedgerLine(raw)) return uncounted;
  if (!match || !match.ok || !match.entry || typeof stamper !== "function") return uncounted;
  if (!rottenKeepIsDueRung(match.entry.lane, reviewEntryMachineTier(match.entry))) return uncounted;
  if (match.entry.returnedBy === "unblocked" || isToday === true ||
      freshStampLineHasToday(raw, dateText) ||
      !classifyFreshStampTarget(raw).ok) return uncounted;
  const rung = rottenKeepRungForTarget(raw, match.entry);
  try {
    const after = String(stamper(raw, dateText, { counted: true }) ?? raw);
    const keepsAfter = parseKeepsCount(after);
    return after !== raw && keepsAfter === Math.min(keepsBefore + 1, 999)
      ? { counted: true, keepsBefore, keepsAfter, rung } : uncounted;
  } catch (error) {
    return uncounted;
  }
}

// Stamps and child entries form a single plan. No caller can commit a stamp
// when its predicted keep cannot be logged. Line coordinates are pre-write.
function formatRottenLogEntryText({ date, reason, keeps, lane, rung }) {
  const day = String(date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const normalized = normalizeScheduleReasonText(reason);
  const targetRung = rung || (lane === "next" ? "Next" : null);
  if (targetRung) {
    // Every counted keep writes a rung-qualified entry; a blank reason
    // always logs 🤷 (`docs/freshness.md` §2a).
    const safeReason = normalized.empty ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : normalized.reason;
    const count = Math.floor(numericOrDefault(keeps, 0));
    if (count < 1 || count > 999) return "";
    return "*" + day + "*" + SCHEDULE_LOG_SEPARATOR + safeReason +
      " · kept " + count + "× " + rottenKeepRungPreposition(targetRung) + " " + targetRung;
  }
  if (lane === "next") {
    // Legacy uncounted Next form, kept for old callers only.
    if (normalized.empty) return "";
    return "*" + day + "*" + SCHEDULE_LOG_SEPARATOR + normalized.reason + " · kept in Next";
  }
  const safeReason = normalized.empty ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : normalized.reason;
  const count = Math.floor(numericOrDefault(keeps, 0));
  if (count < 1 || count > 999) return "";
  return "*" + day + "*" + SCHEDULE_LOG_SEPARATOR + safeReason + " · kept " + count + "×";
}

// Rung-changing card answers are task-local Rotten Log events. A Stay uses
// the human's reason (or 🤷); a step, terminal P4 re-roll, or drop is machine
// copy. The parser in 010 accepts this shared grammar.
function formatFreshnessDecayRottenLogBody({ kind, rung, toRung, keeps, reason } = {}) {
  const from = normalizeBulletPropertyValue(rung);
  const to = normalizeBulletPropertyValue(toRung);
  const count = Math.floor(numericOrDefault(keeps, Number.NaN));
  if (!from || !Number.isInteger(count) || count < 1 || count > 999) return "";
  const after = `after ${count} ${count === 1 ? "keep" : "keeps"}`;
  if (kind === "stay") {
    const normalized = normalizeScheduleReasonText(reason);
    const safeReason = normalized.empty ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : normalized.reason;
    const noun = count === 1 ? "keep" : "keeps";
    return `${safeReason} · stayed ${rottenKeepRungPreposition(from)} ${from} after ${count} ${noun}`;
  }
  if (kind === "step") {
    return from === to
      ? `${PRIORITY_DECAY_CANCEL_EMOJI} rolled again at ${from} · ${after}`
      : to
        ? `${PRIORITY_DECAY_CANCEL_EMOJI} ${from} → ${to} · ${after}`
        : "";
  }
  if (kind === "drop") {
    return `${PRIORITY_DECAY_CANCEL_EMOJI} ${from} → dropped · ${after}`;
  }
  return "";
}

// Compose one validated card event beneath the task's Rotten Log marker.
// Duplicate/ambiguous markers refuse the entire caller transaction.
function appendFreshnessDecayRottenLogEntry(content, taskLine, dateText, body) {
  const day = String(dateText || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Object.freeze({ ok: false, refusal: "rotten-log-invalid", content: String(content || "") });
  }
  const insertion = planManagedTaskLogEntry(content, taskLine, {
    kind: MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: `*${day}*${SCHEDULE_LOG_SEPARATOR}${String(body || "").trim()}`,
  });
  if (!insertion.valid) {
    return Object.freeze({
      ok: false,
      refusal: insertion.reason === "ambiguous-markers" ? "rotten-log-ambiguous" : "rotten-log-invalid",
      content: String(content || ""),
    });
  }
  const split = splitMarkdownContent(content);
  if (applyManagedTaskLogEntryToLines(split.lines, insertion) < 1) {
    return Object.freeze({ ok: false, refusal: "rotten-log-invalid", content: String(content || "") });
  }
  return Object.freeze({ ok: true, refusal: null, content: split.lines.join(split.lineEnding) });
}

// Normalize one validated `ROTTEN_LOG_ENTRY_RE` count group (1-999),
// or null when absent or out of range.
function rottenLogEntryCount(value) {
  if (value === undefined || value === null) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 999) return null;
  return count;
}

function parseRottenLogEntryBullet(line) {
  const match = ROTTEN_LOG_ENTRY_RE.exec(String(line || ""));
  if (!match) return null;
  const groups = match.groups || {};
  const { indent, marker, date } = groups;
  const base = { indent, marker, date };
  const kept = (reason, count, rung) => {
    if (count === null) return null;
    return Object.freeze({ ...base, reason, keeps: count, rung,
      lane: rung === "Next" ? "next" : null, kind: "kept" });
  };
  if (groups.keptRung !== undefined) {
    return kept(groups.keptReason, rottenLogEntryCount(groups.keptCount), groups.keptRung);
  }
  if (groups.keptAtRung !== undefined) {
    const rung = String(groups.keptAtRung || "").trim();
    if (!rung) return null;
    return kept(groups.keptAtReason, rottenLogEntryCount(groups.keptAtCount), rung);
  }
  if (groups.legacyCount !== undefined) {
    return kept(groups.legacyReason, rottenLogEntryCount(groups.legacyCount), "Ready");
  }
  if (groups.lane !== undefined) {
    return Object.freeze({ ...base, reason: groups.nextReason, keeps: null,
      rung: "Next", lane: "next", kind: "kept" });
  }
  const stayed = (reason, count, rung) => {
    if (count === null) return null;
    return Object.freeze({ ...base, reason, keeps: count, rung,
      lane: rung === "Next" ? "next" : null, kind: "stayed" });
  };
  if (groups.stayRung !== undefined) {
    return stayed(groups.stayReason, rottenLogEntryCount(groups.stayCount), groups.stayRung);
  }
  if (groups.stayAtRung !== undefined) {
    const rung = String(groups.stayAtRung || "").trim();
    if (!rung) return null;
    return stayed(groups.stayAtReason, rottenLogEntryCount(groups.stayAtCount), rung);
  }
  if (groups.rerollAt !== undefined) {
    const rung = String(groups.rerollAt || "").trim();
    const count = rottenLogEntryCount(groups.rerollCount);
    if (!rung || count === null) return null;
    return Object.freeze({ ...base, reason: `${PRIORITY_DECAY_CANCEL_EMOJI} rolled again at ${rung}`,
      keeps: count, rung, lane: rung === "Next" ? "next" : null, kind: "reroll" });
  }
  if (groups.dropFrom !== undefined) {
    const from = String(groups.dropFrom || "").trim();
    const count = rottenLogEntryCount(groups.dropCount);
    if (!from || count === null) return null;
    const rung = from;
    return Object.freeze({ ...base, reason: `${PRIORITY_DECAY_CANCEL_EMOJI} ${from} → dropped`,
      keeps: count, rung, lane: rung === "Next" ? "next" : null, kind: "drop" });
  }
  if (groups.stepFrom !== undefined) {
    const from = String(groups.stepFrom || "").trim();
    const to = String(groups.stepTo || "").trim();
    const count = rottenLogEntryCount(groups.stepCount);
    if (!from || !to || count === null) return null;
    return Object.freeze({ ...base, reason: `${PRIORITY_DECAY_CANCEL_EMOJI} ${from} → ${to}`,
      keeps: count, rung: from, lane: from === "Next" ? "next" : null, kind: "step" });
  }
  return null;
}

// Per-rung keep tallies over a Rotten Log history's entries (legacy
// entries included): `[{ rung, count }]` in ladder order (WIP, Next,
// Ready, then level labels sorted), answering "how many times was it
// kept in each status" without a stored field. Never throws.
function rottenLogRungTallies(entries) {
  try {
    const counts = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const rung = entry && typeof entry.rung === "string" ? entry.rung : null;
      if (!rung) continue;
      counts.set(rung, (counts.get(rung) || 0) + 1);
    }
    const order = (rung) => rung === "WIP" ? 0 : rung === "Next" ? 1 : rung === "Ready" ? 2 : 3;
    return Object.freeze([...counts.entries()]
      .sort((left, right) => order(left[0]) - order(right[0]) ||
        (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([rung, count]) => Object.freeze({ rung, count })));
  } catch (error) {
    return Object.freeze([]);
  }
}

// Display-only tallies: `WIP 2 · Next 1 · Ready 3`, or "" when nothing
// is tallied. Shared in spirit with ledger-tools'
// `freshnessMarkRottenLogTallies`. Never throws.
function formatRottenLogRungTallies(entries) {
  try {
    return rottenLogRungTallies(entries)
      .map(({ rung, count }) => `${rung} ${count}`)
      .join(" · ");
  } catch (error) {
    return "";
  }
}

// One Rotten Log entry per counted keep: `rottenTargets` are
// `{ line, rung }` for counted Ready/P-level keeps and `laneTargets`
// are `{ line, rung }` for counted due lane keeps. Early, same-day,
// and otherwise uncounted rows are never passed here, so they stamp
// without an entry. A refused entry (duplicate markers, unreadable
// history) refuses the whole answer: nothing is written. The Work Log
// keeps its real writers elsewhere; freshness gestures never write it.
function planFreshStampBatchWithLogs(content, targets, stamper, dateText, options = {}) {
  const plan = planFreshStampBatch(content, targets, stamper, dateText);
  const refuse = (refusal) => ({ ok: false, refusal, content, stamped: [],
    workLogWrittenCount: 0, rottenLogWrittenCount: 0 });
  if (!plan.ok) return { ...plan, workLogWrittenCount: 0, rottenLogWrittenCount: 0 };
  const rungForLine = new Map();
  for (const target of [...(options.rottenTargets || []), ...(options.laneTargets || [])]) {
    if (target && Number.isInteger(target.line) && typeof target.rung === "string" && target.rung) {
      rungForLine.set(target.line, target.rung);
    }
  }
  // Backwards compatibility for callers that still pass line sets: a
  // bare line defaults to a Ready rung (Ready keeps) or Next (lane).
  for (const line of options.rottenLines || []) {
    if (!rungForLine.has(line)) {
      const entries = plan.stamped.filter((entry) => entry.line === line);
      if (entries.length !== 1) return refuse("rotten-keep-mismatch");
      rungForLine.set(line, rottenKeepRungForTarget(entries[0].before, null));
    }
  }
  for (const line of options.laneLines || []) {
    if (!rungForLine.has(line)) rungForLine.set(line, "Next");
  }
  for (const line of rungForLine.keys()) {
    const entries = plan.stamped.filter((entry) => entry.line === line);
    if (entries.length !== 1 || entries[0].before === entries[0].after ||
        freshStampLineHasToday(entries[0].before, dateText) ||
        !freshStampLineHasToday(entries[0].after, dateText) ||
        countFreshStampKept(entries) !== 1) return refuse("rotten-keep-mismatch");
  }
  const { lines, lineEnding } = splitMarkdownContent(plan.content);
  let rottenLogWrittenCount = 0;
  const entries = [...plan.stamped].sort((a, b) => b.line - a.line);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.line)) continue;
    seen.add(entry.line);
    if (!rungForLine.has(entry.line)) continue;
    const insertion = planManagedTaskLogEntry(lines.join(lineEnding), entry.line, {
      kind: MANAGED_TASK_LOG_KIND_ROTTEN,
      entryText: formatRottenLogEntryText({ date: dateText, reason: options.keepReason,
        keeps: parseKeepsCount(entry.after), rung: rungForLine.get(entry.line) }),
    });
    if (!insertion.valid) return refuse(insertion.reason === "ambiguous-markers"
      ? "rotten-log-ambiguous" : "rotten-log-invalid");
    if (!applyManagedTaskLogEntryToLines(lines, insertion)) return refuse("rotten-log-invalid");
    rottenLogWrittenCount += 1;
  }
  return { ...plan, content: lines.join(lineEnding), workLogWrittenCount: 0, rottenLogWrittenCount };
}

// Display-only card header for the logged keeps: per-rung tallies plus
// the newest entry, or "" when nothing is logged. Ambiguous markers
// report unreadable; the stage submit stays disabled because the
// planner would refuse anyway.
function buildFreshnessDecayRottenHeaderLine(history) {
  if (history && (history.status === "unknown" || history.status === "ambiguous")) return "🥀 log unreadable";
  const entries = history && Array.isArray(history.entries) ? history.entries : [];
  if (entries.length === 0) return "";
  const tallies = formatRottenLogRungTallies(entries);
  const last = entries[0] || {};
  const tail = tallies ? `🥀 ${tallies} · last ` : "🥀 last ";
  return `${tail}${reviewShortDate(last.date)} — ${last.reason}`;
}

// One rung's allowance subtitle: `keep 1 of 2 in Next`, `keep 2 of 2
// in Next · the next due keep opens the decay card`, or `keep 3 in
// Next · decay off for Next` when that rung never asks. `allowance`
// is the rung's effective keep limit (integer 0-999) or false. Lane
// rungs omit the card promise until the rung-aware card ships
// (`freshnessDecayLaneCardAvailable`). Never throws.
function rottenKeepAllowanceSubtitle(rung, keepsAfter, allowance, laneCard) {
  try {
    const target = String(rung || "Ready");
    const prep = rottenKeepRungPreposition(target);
    const count = Math.max(1, Math.floor(numericOrDefault(keepsAfter, 1)));
    if (allowance === false) {
      return `keep ${count} ${prep} ${target} · decay off for ${target}`;
    }
    const limit = Math.floor(numericOrDefault(allowance, 3));
    if (!(limit >= 0)) {
      return `keep ${count} ${prep} ${target}`;
    }
    if (limit === 0) {
      return `keep ${count} ${prep} ${target} · every due keep asks`;
    }
    if (count >= limit && (target === "Ready" || prep === "at" || laneCard === true)) {
      return `keep ${count} of ${limit} ${prep} ${target} · the next due keep opens the decay card`;
    }
    return `keep ${count} of ${limit} ${prep} ${target}`;
  } catch (error) {
    return "";
  }
}

function buildRottenKeepPromptModel(options = {}) {
  const history = options.history || { status: "missing", entries: [] };
  const entries = history.entries || [];
  const ambiguous = history.status === "unknown" || history.status === "ambiguous";
  const tallies = formatRottenLogRungTallies(entries);
  const logged = ambiguous ? "log unreadable" : tallies || "none logged yet";
  const keepsBefore = options.keepsBefore || 0;
  const keepsAfter = options.keepsAfter || Math.min(keepsBefore + 1, 999);
  const entry = options.entry || {};
  const today = reviewParseDayNumber(options.dateText);
  const rawFresh = /\[fresh::\s*(\d{4}-\d{2}-\d{2})\s*\]/.exec(String(options.raw || ""));
  const fresh = reviewParseDayNumber(entry.fresh || (rawFresh && rawFresh[1]));
  const age = Number.isFinite(entry.ageDays) ? entry.ageDays
    : today !== null && fresh !== null ? Math.max(0, today - fresh) : null;
  const rung = options.rung ||
    (options.lane === "next" ? "Next" : null) ||
    rottenKeepRungForTarget(options.raw || "", entry) || "Ready";
  const prep = rottenKeepRungPreposition(rung);
  const decayCard = options.decayCard === true;
  const subtitle = [cleanTaskDisplayText(options.raw || entry.originalMarkdown || entry.text || ""),
    String(entry.tierLabel || entry.tier || rung).toUpperCase(),
    age === null ? "" : `${age}d`].filter(Boolean).join(" · ");
  const reason = normalizeLaneWorkSummary(options.reason);
  const allowance = decayCard
    ? `stay ${prep} ${rung} after ${keepsBefore} ${keepsBefore === 1 ? "keep" : "keeps"} · count starts over`
    : rottenKeepAllowanceSubtitle(rung, keepsAfter, options.allowance,
        options.laneCard === true ||
        (typeof freshnessDecayLaneCardAvailable === "function" && freshnessDecayLaneCardAvailable()));
  const previewBody = decayCard
    ? formatFreshnessDecayRottenLogBody({ kind: "stay", rung, keeps: keepsBefore, reason })
    : "";
  const previewEntryText = decayCard
    ? `*${String(options.dateText || "")}* ${SCHEDULE_LOG_SEPARATOR} ${previewBody}`
    : formatRottenLogEntryText({ date: options.dateText, reason,
      keeps: keepsAfter, rung });
  return {
    title: decayCard ? `Stay ${prep} ${rung}?` : `Why keep it ${prep} ${rung}?`,
    subtitleLines: [subtitle, [allowance, logged].filter(Boolean).join(" · ")],
    placeholder: `${decayCard ? "Why stay" : "Why keep it"} ${prep} ${rung}? (optional · ↵ logs 🤷)`,
    previewEntryText,
    empty: !reason,
    previewTitle: previewEntryText,
    previewDestination: history.status === "missing" || history.status === "none"
      ? "Adds 🥀 ROTTEN LOG as the task's last child"
      : "Prepends under 🥀 ROTTEN LOG",
    warning: reason.includes("::") ? '"::" creates a Dataview inline field on this bullet' : "",
    destinationText: history.status === "missing" || history.status === "none"
      ? "Adds 🥀 ROTTEN LOG as the task's last child" : "Prepends under 🥀 ROTTEN LOG",
    historyRows: entries.slice(0, 3).map((item) => ({
      date: reviewShortDate(item.date), reason: item.reason,
      kept: item.kind === "stayed" ? `stayed in ${item.rung} after ${item.keeps} keep${item.keeps === 1 ? "" : "s"}`
        : item.kind === "step" || item.kind === "reroll" || item.kind === "drop" ? item.reason
        : item.keeps === null || item.keeps === undefined ? `kept in ${item.rung || "Next"}`
        : `kept ${item.keeps}× ${rottenKeepRungPreposition(item.rung || "Ready")} ${item.rung || "Ready"}`,
      empty: item.reason === SCHEDULE_LOG_SKIPPED_REASON_TEXT,
    })),
    olderCount: Math.max(0, entries.length - 3),
    enterHint: decayCard
      ? options.advance ? "Stay, log & next" : "Stay & log"
      : options.advance ? "Keep, log & next" : "Keep & log",
    escapeHint: "Cancel",
    disabled: ambiguous,
  };
}

// Shared by the refresh modal and the decay card. The stage owns only its
// subtree and input; its host owns closing, committing, and returning to choices.
class RottenKeepReasonStage {
  constructor(container, options = {}) {
    this.options = options;
    this.completed = false;
    this.root = container.createDiv({ cls: "bob-rotten-stage" });
    const model = buildRottenKeepPromptModel(options);
    const header = this.root.createDiv({ cls: "bob-cnp-header" });
    header.createDiv({ cls: "bob-cnp-header-icon bob-rotten-icon", text: "🥀" });
    const text = header.createDiv({ cls: "bob-cnp-header-text" });
    text.createDiv({ cls: "bob-cnp-title", text: model.title });
    for (const line of model.subtitleLines) text.createDiv({ cls: "bob-cnp-subtitle", text: line });
    const inputWrap = this.root.createDiv({ cls: "bob-cnp-search" });
    inputWrap.createDiv({ cls: "bob-cnp-search-icon", text: "✎" });
    this.inputEl = inputWrap.createEl("input", { cls: "bob-cnp-input", attr: {
      type: "text", "aria-label": options.decayCard === true ? "Stay reason" : "Keep reason", placeholder: model.placeholder,
    } });
    this.previewEl = this.root.createDiv({ cls: "bob-cnp-results", attr: { "aria-live": "polite" } });
    if (model.historyRows.length) {
      this.root.createDiv({ cls: "bob-rotten-history-title", text: options.decayCard === true ? "EARLIER DECISIONS" : "EARLIER KEEPS" });
      const history = this.root.createDiv({ cls: "bob-rotten-history", attr: { role: "list" } });
      for (const item of model.historyRows) {
        const row = history.createDiv({ cls: `bob-rotten-history-row${item.empty ? " is-empty" : ""}`, attr: { role: "listitem" } });
        row.createSpan({ cls: "bob-rotten-date", text: item.date });
        const detail = row.createDiv({ cls: "bob-rotten-history-detail" });
        detail.createSpan({ cls: "bob-rotten-reason", text: item.reason, attr: { title: item.reason } });
        detail.createSpan({ cls: "bob-rotten-kept", text: item.kept });
      }
      if (model.olderCount) this.root.createDiv({ cls: "bob-cnp-row-meta", text: `+ ${model.olderCount} older` });
    }
    const hints = this.root.createDiv({ cls: "bob-cnp-footer" });
    this.enterHintEl = null;
    for (const [key, label] of [["↵", model.enterHint], ["esc", model.escapeHint]]) {
      const hint = hints.createSpan({ cls: "bob-cnp-hint" });
      hint.createEl("kbd", { cls: "bob-cnp-kbd", text: key });
      const labelEl = hint.createSpan({ cls: "bob-cnp-hint-label", text: label });
      if (key === "↵") this.enterHintEl = labelEl;
    }
    this.inputEl.addEventListener("input", () => this.renderPreview());
    this.inputEl.addEventListener("keydown", (event) => {
      if (isReviewRefreshKeydown(event, false) || isReviewRefreshKeydown(event, true)) {
        event.preventDefault(); event.stopPropagation();
      } else if (event.key === "Enter") {
        if (event.isComposing) return;
        event.preventDefault(); event.stopPropagation(); this.submit();
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (typeof this.options.onCancel === "function") this.options.onCancel();
      }
    });
    this.renderPreview();
  }

  value() { return this.inputEl ? String(this.inputEl.value || "") : ""; }
  focus() { if (this.inputEl) this.inputEl.focus(); }
  renderPreview() {
    if (!this.previewEl) return;
    const model = buildRottenKeepPromptModel({ ...this.options, reason: this.value() });
    if (this.enterHintEl) this.enterHintEl.setText(model.enterHint);
    this.previewEl.empty();
    const row = this.previewEl.createDiv({ cls: `bob-cnp-row bob-cnp-schedule-reason-row ${model.empty ? "is-empty" : model.warning ? "is-warning" : "is-valid"}` });
    row.createDiv({ cls: "bob-cnp-row-icon", text: "✓" });
    const text = row.createDiv({ cls: "bob-cnp-row-text" });
    text.createDiv({ cls: "bob-cnp-row-title", text: model.previewTitle || model.previewEntryText });
    if (model.warning) text.createDiv({ cls: "bob-cnp-row-meta", text: model.warning });
    text.createDiv({ cls: "bob-cnp-schedule-reason-preview", text: model.previewDestination || model.destinationText });
    if (typeof this.options.onModel === "function") this.options.onModel(model);
  }
  submit() {
    if (this.completed || buildRottenKeepPromptModel({ ...this.options, reason: this.value() }).disabled) return;
    this.completed = true;
    if (typeof this.options.onSubmit === "function") this.options.onSubmit(this.value());
  }
  destroy() {
    this.completed = true;
    contentElCleanup(this.root);
    this.inputEl = null;
    this.previewEl = null;
  }
}
