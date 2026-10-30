// Bob Command Mode: sequence plugin wiring (run, suppress step toasts, rerun last).

BobCommandModePlugin.prototype.commandModeSequenceMap = function commandModeSequenceMap() {
  if (!(this.commandModeSequences instanceof Map)) this.commandModeSequences = new Map();
  return this.commandModeSequences;
};

BobCommandModePlugin.prototype.commandModeSequenceIsActive = function commandModeSequenceIsActive(signature) {
  const wanted = String(signature || "");
  if (!wanted) return false;
  for (const live of this.commandModeSequenceMap().values()) {
    if (live && String(live.signature || "") === wanted) return true;
  }
  return false;
};

BobCommandModePlugin.prototype.commandModeSequenceSnapshots = function commandModeSequenceSnapshots() {
  const runner = this.commandModeRunner;
  let catalog = null;
  try {
    catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null;
  } catch (error) {
    catalog = null;
  }
  const out = [];
  for (const live of this.commandModeSequenceMap().values()) {
    if (!live) continue;
    const steps = Array.isArray(live.steps) ? live.steps : [];
    out.push({
      id: live.id,
      total: steps.length,
      index: live.index || 1,
      steps: steps.map((step) => ({
        title: cmSequenceStepTitle(step, catalog),
        display: cmSequenceStepDisplay(step, catalog),
      })),
      results: Array.isArray(live.results) ? live.results : [],
      startedAtMs: live.startedAtMs,
    });
  }
  return out;
};

BobCommandModePlugin.prototype.commandModeRunSequence = async function commandModeRunSequence(steps, opts = {}) {
  const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
  if (!stored.length) return { ok: false, reason: "empty sequence" };
  const runner = this.commandModeRunner;
  if (!runner || typeof runner.run !== "function") {
    return { ok: false, reason: "command mode is not loaded" };
  }
  const signature = cmSequenceSignature(stored);
  if (this.commandModeSequenceIsActive(signature)) {
    try { new Notice("That sequence is already running"); }
    catch (error) { /* Headless. */ }
    return { ok: false, reason: "already running" };
  }
  const startedAtMs = typeof opts.startedAtMs === "number" ? opts.startedAtMs : Date.now();
  const random = runner.deps && typeof runner.deps.random === "function" ? runner.deps.random : Math.random;
  const id = opts.id ? String(opts.id) : "seq-" + cmRunId(startedAtMs, random);
  const live = {
    id,
    steps: stored,
    index: (Number(opts.startIndex) || 0) + 1,
    results: Array.isArray(opts.priorResults) ? [...opts.priorResults] : [],
    startedAtMs,
    signature,
  };
  this.commandModeSequenceMap().set(id, live);
  let summary;
  try {
    summary = await cmRunSequence(runner, stored, {
      id,
      startedAtMs,
      startIndex: opts.startIndex,
      priorResults: opts.priorResults,
      trigger: opts.trigger || "sequence",
      continues: opts.continues,
      cancelled: () => Boolean(this.commandModeUnloaded) || (typeof opts.cancelled === "function" && opts.cancelled()),
      onStepStart: (index, step) => {
        live.index = index + 1;
        cmSequenceCallHook(opts.onStepStart, index, step);
      },
      onStepFinish: (index, result) => {
        live.results = Array.isArray(live.results) ? live.results : [];
        live.results[index] = result;
        live.index = Math.min(index + 2, stored.length);
        cmSequenceCallHook(opts.onStepFinish, index, result);
      },
    });
  } finally {
    this.commandModeSequenceMap().delete(id);
  }
  if (this.commandModeUnloaded) return summary;
  try {
    this.commandModeSequenceFinished(summary);
  } catch (error) {
    // Finish feedback must never throw into the caller.
  }
  return summary;
};

BobCommandModePlugin.prototype.commandModeSequenceFinished = function commandModeSequenceFinished(summary) {
  if (!summary) return;
  const catalog = this.commandModeRunner && typeof this.commandModeRunner.catalog === "function"
    ? this.commandModeRunner.catalog()
    : null;
  const model = cmSequenceToastModel(summary, catalog);
  const focusRunId = model.focusRunId;
  const chipState = this.commandModeChipState();
  if (chipState && chipState.shown instanceof Set && chipState.shown.has(model.id)) {
    const index = model.stoppedAt || model.total;
    const step = model.steps[index - 1] || {};
    chipState.settle = {
      runId: focusRunId,
      title: String(step.title || cmSequenceStepTitle(step, catalog) || "bob"),
      outcome: model.outcome,
      durationMs: model.durationMs,
      atMs: Date.now(),
      sequence: {
        id: model.id,
        step: index + "/" + model.total,
        stepTitle: String(step.title || cmSequenceStepTitle(step, catalog) || "bob"),
        total: model.total,
      },
    };
    try {
      if (this.commandModeStatusEl) this.commandModeRefreshStatusChip(chipState.settle.atMs);
    } catch (error) {
      // Paint is best effort here; the timer repaints within 250 ms.
    }
  }

  const stickyKey = "sequence:" + model.signature;
  const stickyCards = this.commandModeStickyNotices || (this.commandModeStickyNotices = new Map());
  const previous = stickyCards.get(stickyKey);
  if (previous) {
    try { if (typeof previous.hide === "function") previous.hide(); }
    catch (error) { /* A previous card may already be closed. */ }
    stickyCards.delete(stickyKey);
  }
  const fragment = cmCreateSequenceToastFragment(
    model,
    (action) => this.commandModeRunSequenceToastAction(action, model),
    (runId) => { if (runId) return this.commandModeOpenOutput(runId); },
  );
  const duration = CM_TOAST_META[model.outcome] ? CM_TOAST_META[model.outcome].duration : CM_TOAST_META.unknown.duration;
  let card;
  try {
    card = new Notice(fragment || (model.title + " · " + model.duration), duration);
  } catch (error) {
    return;
  }
  if (model.sticky) stickyCards.set(stickyKey, card);
  this.commandModeMaybeNotifySequence(summary, model);
};

BobCommandModePlugin.prototype.commandModeMaybeNotifySequence = function commandModeMaybeNotifySequence(summary, model) {
  if (this.settings && this.settings.osNotifications === false || Number(summary && summary.durationMs) <= 15000) return false;
  try {
    if (typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus()) return false;
    if (typeof Notification !== "function") return false;
    const notification = new Notification(model.title, {
      body: (model.lines || []).slice(0, 4).map((line) => line.title + (line.duration ? " · " + line.duration : "")).join("\n"),
    });
    notification.onclick = () => {
      try { if (typeof window !== "undefined" && typeof window.focus === "function") window.focus(); }
      catch (error) { /* The shell may not expose focus. */ }
      if (model.focusRunId) void this.commandModeOpenOutput(model.focusRunId);
    };
    return true;
  } catch (error) {
    return false;
  }
};

BobCommandModePlugin.prototype.commandModeRunSequenceToastAction = async function commandModeRunSequenceToastAction(action, model = {}) {
  if (!action || !action.id) return { ok: false, reason: "unknown action" };
  const runner = this.commandModeRunner;
  const catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null;
  switch (action.id) {
    case "output":
      return model.focusRunId ? this.commandModeOpenOutput(model.focusRunId) : { ok: false, reason: "run not found" };
    case "resume": {
      if (!model.id || !model.stoppedAt) return { ok: false, reason: "sequence cannot resume" };
      return this.commandModeRunSequence(model.steps, {
        id: model.id,
        startedAtMs: model.startedAtMs,
        startIndex: model.stoppedAt - 1,
        priorResults: model.results,
        trigger: "retry",
      });
    }
    case "rerun":
      return this.commandModeRunSequence(model.steps, { trigger: "retry" });
    case "copy": {
      try {
        const clipboard = typeof navigator !== "undefined" && navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== "function") return { ok: false, reason: "clipboard unavailable" };
        await clipboard.writeText(cmSequenceCopyText(model.steps, catalog));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error) };
      }
    }
    default:
      return { ok: false, reason: "unknown action: " + action.id };
  }
};

BobCommandModePlugin.prototype.commandModeRerunLast = function commandModeRerunLast() {
  const runner = this.commandModeRunner;
  const newest = runner && typeof runner.newestRecord === "function" ? runner.newestRecord() : null;
  if (newest && newest.sequence && typeof newest.sequence === "object") {
    const steps = cmSequenceStepsFromRecord(newest);
    if (steps.length) {
      return this.commandModeRunSequence(steps, { trigger: "retry" });
    }
  }
  return this.commandModeRerun(newest);
};

const cmOriginalNotifySequence = BobCommandModePlugin.prototype.commandModeNotify;
BobCommandModePlugin.prototype.commandModeNotify = function commandModeNotifySequence(notice) {
  try {
    const record = notice && notice.record && typeof notice.record === "object" ? notice.record : {};
    const seqId = record.sequence && record.sequence.id ? String(record.sequence.id) : "";
    if (seqId && this.commandModeSequences instanceof Map && this.commandModeSequences.has(seqId)) {
      try {
        const runId = record.id || (notice && notice.runId);
        if (this.commandModePagerIsWatching(runId)) {
          if (this.commandModePager && typeof this.commandModePager.refresh === "function") {
            this.commandModePager.refresh();
          }
        }
      } catch (error) {
        // Pager refresh is best effort.
      }
      return null;
    }
  } catch (error) {
    // Suppression must never throw into the runner.
  }
  return cmOriginalNotifySequence.call(this, notice);
};

const cmOriginalChipSettleSequence = BobCommandModePlugin.prototype.commandModeRecordChipSettle;
BobCommandModePlugin.prototype.commandModeRecordChipSettle = function commandModeRecordChipSettleSequence(payload) {
  try {
    const runId = payload && payload.runId ? String(payload.runId) : "";
    const record = cmPagerFindRecord(this.commandModeRunner, runId);
    const seqId = record && record.sequence && record.sequence.id ? String(record.sequence.id) : "";
    if (seqId && this.commandModeSequences instanceof Map && this.commandModeSequences.has(seqId)) {
      return;
    }
  } catch (error) {
    // Settle skip must never throw into finalization.
  }
  return cmOriginalChipSettleSequence.call(this, payload);
};

const cmOriginalPluginOnunloadSeq = BobCommandModePlugin.prototype.onunload;
BobCommandModePlugin.prototype.onunload = function onunloadSequences() {
  this.commandModeUnloaded = true;
  return cmOriginalPluginOnunloadSeq.apply(this, arguments);
};
