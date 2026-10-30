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
  const total = Number(summary.total) || 0;
  const clock = cmFormatClock(summary.durationMs);
  let message;
  if (summary.outcome === "interrupted") {
    message = "bob sequence interrupted · " + clock;
  } else if (summary.stoppedAt) {
    const halt = Array.isArray(summary.results)
      ? summary.results.find((row) => row && Number(row.index) === Number(summary.stoppedAt))
      : null;
    const reason = halt && halt.reason ? String(halt.reason) : "";
    message = "bob sequence stopped at " + summary.stoppedAt + "/" + total
      + (reason ? " · " + reason : "");
  } else {
    const done = Array.isArray(summary.results)
      ? summary.results.filter((row) => row && !row.skipped).length
      : total;
    message = "bob sequence · " + done + "/" + total + " " + (summary.outcome || "completed") + " in " + clock;
  }
  new Notice(message);
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
