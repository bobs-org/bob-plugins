// A counted keep is predicted by the same pure helper that will stamp it.
// Callers gate this on freshnessSupportsKeeps; legacy stampers never log.
function classifyRottenKeepTarget({ match, raw, stamper, dateText } = {}) {
  const keepsBefore = parseKeepsCount(raw);
  const uncounted = { counted: false, keepsBefore, keepsAfter: keepsBefore };
  if (isPomodoroFreshnessLedgerLine(raw)) return uncounted;
  if (!match || !match.ok || !match.entry || match.entry.lane !== "ready" ||
      !["rotten", "tickler"].includes(reviewEntryMachineTier(match.entry)) ||
      match.entry.returnedBy === "unblocked" || freshStampLineHasToday(raw, dateText) ||
      !classifyFreshStampTarget(raw).ok || typeof stamper !== "function") return uncounted;
  try {
    const after = String(stamper(raw, dateText, { counted: true }) ?? raw);
    const keepsAfter = parseKeepsCount(after);
    return after !== raw && keepsAfter === Math.min(keepsBefore + 1, 999)
      ? { counted: true, keepsBefore, keepsAfter } : uncounted;
  } catch (error) {
    return uncounted;
  }
}

// Stamps and child entries form a single plan. No caller can commit a stamp
// when its predicted keep cannot be logged. Line coordinates are pre-write.
function formatRottenLogEntryText({ date, reason, keeps, lane }) {
  const day = String(date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const normalized = normalizeScheduleReasonText(reason);
  if (lane === "next") {
    if (normalized.empty) return "";
    return "*" + day + "*" + SCHEDULE_LOG_SEPARATOR + normalized.reason + " · kept in Next";
  }
  const safeReason = normalized.empty ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : normalized.reason;
  const count = Math.floor(numericOrDefault(keeps, 0));
  if (count < 1 || count > 999) return "";
  return "*" + day + "*" + SCHEDULE_LOG_SEPARATOR + safeReason + " · kept " + count + "×";
}

function parseRottenLogEntryBullet(line) {
  const match = ROTTEN_LOG_ENTRY_RE.exec(String(line || ""));
  if (!match) return null;
  const { indent, marker, date, reason, keeps, lane } = match.groups;
  const count = keeps === undefined ? null : Number(keeps);
  if (count !== null && (count < 1 || count > 999)) return null;
  return Object.freeze({ indent, marker, date, reason, keeps: count, lane: lane === "Next" ? "next" : null });
}

function planFreshStampBatchWithLogs(content, targets, stamper, dateText, options = {}) {
  const plan = planFreshStampBatch(content, targets, stamper, dateText);
  const refuse = (refusal) => ({ ok: false, refusal, content, stamped: [],
    workLogWrittenCount: 0, rottenLogWrittenCount: 0 });
  if (!plan.ok) return { ...plan, workLogWrittenCount: 0, rottenLogWrittenCount: 0 };
  const rottenLines = new Set(options.rottenLines || []);
  const laneLines = new Set(options.laneLines || []);
  for (const line of rottenLines) {
    const entries = plan.stamped.filter((entry) => entry.line === line);
    if (entries.length !== 1 || entries[0].before === entries[0].after ||
        freshStampLineHasToday(entries[0].before, dateText) ||
        !freshStampLineHasToday(entries[0].after, dateText) ||
        countFreshStampKept(entries) !== 1) return refuse("rotten-keep-mismatch");
  }
  const { lines, lineEnding } = splitMarkdownContent(plan.content);
  const summary = normalizeLaneWorkSummary(options.workSummary);
  let workLogWrittenCount = 0;
  let rottenLogWrittenCount = 0;
  const entries = [...plan.stamped].sort((a, b) => b.line - a.line);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.line)) continue;
    seen.add(entry.line);
    if (rottenLines.has(entry.line)) {
      const insertion = planManagedTaskLogEntry(lines.join(lineEnding), entry.line, {
        kind: MANAGED_TASK_LOG_KIND_ROTTEN,
        entryText: formatRottenLogEntryText({ date: dateText, reason: options.keepReason,
          keeps: parseKeepsCount(entry.after) }),
      });
      if (!insertion.valid) return refuse(insertion.reason === "ambiguous-markers"
        ? "rotten-log-ambiguous" : "rotten-log-invalid");
      if (!applyManagedTaskLogEntryToLines(lines, insertion)) return refuse("rotten-log-invalid");
      rottenLogWrittenCount += 1;
    } else if (laneLines.has(entry.line) && !rottenLines.has(entry.line) &&
        isNextRottenLogTargetRawLine(entry.before)) {
      const entryText = formatRottenLogEntryText({
        date: dateText, reason: options.keepReason, lane: "next",
      });
      if (!entryText) continue;
      const insertion = planManagedTaskLogEntry(lines.join(lineEnding), entry.line, {
        kind: MANAGED_TASK_LOG_KIND_ROTTEN,
        entryText,
      });
      if (!insertion.valid) return refuse(insertion.reason === "ambiguous-markers"
        ? "rotten-log-ambiguous" : "rotten-log-invalid");
      if (!applyManagedTaskLogEntryToLines(lines, insertion)) return refuse("rotten-log-invalid");
      rottenLogWrittenCount += 1;
    } else if (summary && isPendingWorkLogTargetRawLine(entry.before)) {
      if (insertLaneWorkLogEntry(lines, entry.line, summary, dateText)) workLogWrittenCount += 1;
    }
  }
  return { ...plan, content: lines.join(lineEnding), workLogWrittenCount, rottenLogWrittenCount };
}

// Display-only card header for the logged keeps, or "" when nothing is
// logged. Ambiguous markers report unreadable; the stage submit stays
// disabled because the planner would refuse anyway.
function buildFreshnessDecayRottenHeaderLine(history) {
  if (history && (history.status === "unknown" || history.status === "ambiguous")) return "🥀 log unreadable";
  const entries = history && Array.isArray(history.entries) ? history.entries : [];
  if (entries.length === 0) return "";
  const count = entries.length;
  const last = entries[0] || {};
  return `🥀 ${count} ${count === 1 ? "keep" : "keeps"} logged · last ${reviewShortDate(last.date)} — ${last.reason}`;
}

function buildRottenKeepPromptModel(options = {}) {
  const history = options.history || { status: "missing", entries: [] };
  const entries = history.entries || [];
  const ambiguous = history.status === "unknown" || history.status === "ambiguous";
  const count = entries.length;
  const logged = ambiguous ? "log unreadable" : count === 0 ? "none logged yet"
    : `${count} ${count === 1 ? "keep" : "keeps"} logged`;
  const keepsBefore = options.keepsBefore || 0;
  const keepsAfter = options.keepsAfter || Math.min(keepsBefore + 1, 999);
  const entry = options.entry || {};
  const today = reviewParseDayNumber(options.dateText);
  const rawFresh = /\[fresh::\s*(\d{4}-\d{2}-\d{2})\s*\]/.exec(String(options.raw || ""));
  const fresh = reviewParseDayNumber(entry.fresh || (rawFresh && rawFresh[1]));
  const age = Number.isFinite(entry.ageDays) ? entry.ageDays
    : today !== null && fresh !== null ? Math.max(0, today - fresh) : null;
  const lane = options.lane === "next";
  const subtitle = [cleanTaskDisplayText(options.raw || entry.originalMarkdown || entry.text || ""),
    lane ? "NEXT" : String(entry.tierLabel || entry.tier || "ROTTEN").toUpperCase(),
    age === null ? "" : `${age}d`].filter(Boolean).join(" · ");
  const reason = normalizeLaneWorkSummary(options.reason);
  const streak = lane ? "" : options.decayCard
    ? `Kept ${keepsBefore} reviews in a row · this keep makes ${keepsAfter}`
    : keepsBefore ? `kept ${keepsBefore} in a row` : "";
  const previewEntryText = formatRottenLogEntryText({ date: options.dateText, reason,
    keeps: keepsAfter, lane: lane ? "next" : undefined });
  return {
    title: lane ? "Keep in Next?" : "Keep as written?",
    subtitleLines: [subtitle, [streak, logged].filter(Boolean).join(" · ")],
    placeholder: lane ? "Why keep it in Next? (optional · ↵ to skip)"
      : "Why keep it as written? (optional · ↵ logs 🤷)",
    previewEntryText,
    empty: !reason,
    previewTitle: lane && !reason ? "No entry" : previewEntryText,
    previewDestination: lane && !reason
      ? "Refresh only; no Rotten Log entry"
      : history.status === "missing" || history.status === "none"
        ? "Adds 🥀 ROTTEN LOG as the task's last child"
        : "Prepends under 🥀 ROTTEN LOG",
    warning: reason.includes("::") ? '"::" creates a Dataview inline field on this bullet' : "",
    destinationText: history.status === "missing" || history.status === "none"
      ? "Adds 🥀 ROTTEN LOG as the task's last child" : "Prepends under 🥀 ROTTEN LOG",
    historyRows: entries.slice(0, 3).map((item) => ({
      date: reviewShortDate(item.date), reason: item.reason,
      kept: item.lane === "next" ? "kept in Next" : `kept ${item.keeps ?? item.kept}×`,
      empty: item.reason === SCHEDULE_LOG_SKIPPED_REASON_TEXT,
    })),
    olderCount: Math.max(0, count - 3),
    enterHint: lane
      ? options.advance ? (reason ? "Keep, log & next" : "Keep & next")
        : (reason ? "Keep & log" : "Keep")
      : options.advance ? "Keep, log & next" : "Keep & log",
    escapeHint: "Cancel",
    disabled: lane ? Boolean(reason) && ambiguous : ambiguous,
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
      type: "text", "aria-label": "Keep reason", placeholder: model.placeholder,
    } });
    this.previewEl = this.root.createDiv({ cls: "bob-cnp-results", attr: { "aria-live": "polite" } });
    if (model.historyRows.length) {
      this.root.createDiv({ cls: "bob-rotten-history-title", text: "EARLIER KEEPS" });
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
