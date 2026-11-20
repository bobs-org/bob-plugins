// Bob Command Mode: api.commandMode chip contract helpers. Activation-time
// resolution with a bounded catalog wait, guarded per-activation onState
// delivery, and active-run lookup by the engine's canonical signature.

// runText waits this long, and only for a catalog load already in flight.
const CM_API_CATALOG_WAIT_MS = 5000;

function cmApiErrorReason(error, fallback) {
  return String((error && error.message) || error || fallback);
}

function cmApiDeepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) cmApiDeepFreeze(value[key]);
  return Object.freeze(value);
}

// A resolve result that is not ready never reaches execution.
function cmApiRefusal(resolved) {
  return {
    ok: false,
    outcome: "refused",
    stage: "refused",
    state: (resolved && resolved.state) || "invalid",
    step: (resolved && resolved.step) || null,
    runId: null,
    sequenceId: null,
    reason: String((resolved && resolved.reason) || "command could not be resolved"),
  };
}

// Re-resolve at activation. A loading verdict waits (bounded) only for a
// catalog load that is already in flight; this never starts a load itself.
async function cmApiResolveForActivation(api, hooks, text) {
  const resolved = api.resolve(text);
  if (resolved.state !== "loading" || typeof hooks.catalogLoad !== "function") return resolved;
  let flight = null;
  try { flight = hooks.catalogLoad(); }
  catch (error) { flight = null; }
  if (!flight || typeof flight.then !== "function") return resolved;
  const waitMs = Number.isFinite(hooks.catalogWaitMs) ? Math.max(0, hooks.catalogWaitMs) : CM_API_CATALOG_WAIT_MS;
  let timer = null;
  await Promise.race([
    Promise.resolve(flight).then(() => null, () => null),
    new Promise((resolve) => { timer = setTimeout(resolve, waitMs); }),
  ]);
  if (timer) clearTimeout(timer);
  return api.resolve(text);
}

// One activation's onState channel. Every payload is a fresh frozen object
// carrying {state, kind, signature, runId, sequenceId, step, total, outcome,
// reason, exitCode, stoppedAt}; a throwing or rejecting callback is ignored.
function cmApiStateEmitter(onState, base) {
  if (typeof onState !== "function") return null;
  return (payload) => cmCallGuarded(onState, Object.freeze({
    state: null,
    kind: base.kind,
    signature: base.signature,
    runId: null,
    sequenceId: base.sequenceId || null,
    step: 1,
    total: base.total,
    outcome: null,
    reason: null,
    exitCode: null,
    stoppedAt: null,
    ...payload,
  }));
}

// Runner hook -> queued/running only. Terminal states are reported once per
// step (`step`) or per activation (`finished`) from the settled results.
function cmApiRunStateForwarder(emit) {
  if (!emit) return undefined;
  return (payload) => {
    const state = payload && payload.state;
    if (state !== "queued" && state !== "running") return;
    const stamp = payload.sequence;
    emit({
      state,
      runId: payload.runId ? String(payload.runId) : null,
      ...(stamp && stamp.id ? { sequenceId: String(stamp.id) } : {}),
      ...(stamp && Number(stamp.index) > 0 ? { step: Number(stamp.index) } : {}),
      outcome: state,
    });
  };
}

function cmApiFinishedPayload(settled, fallbackStep) {
  const result = settled || {};
  return {
    state: "finished",
    runId: result.runId ? String(result.runId) : null,
    step: Number(result.stoppedAt) || fallbackStep || 1,
    outcome: result.outcome || "failed",
    reason: result.reason != null ? String(result.reason) : null,
    exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
    stoppedAt: Number(result.stoppedAt) || null,
  };
}

function cmApiIsSignature(value) {
  if (typeof value !== "string" || value[0] !== "[") return false;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string");
  } catch (error) {
    return false;
  }
}

function cmApiSignatureLength(signature) {
  try {
    const parsed = JSON.parse(signature);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch (error) {
    return 0;
  }
}

function cmApiLiveRecords(runner) {
  let records = [];
  try {
    records = runner && typeof runner.activeRecords === "function" ? runner.activeRecords() : [];
  } catch (error) {
    records = [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => record && cmIsLiveRunState(record.outcome));
}

// Find the live run or sequence for a canonical signature. Sequences match on
// their immutable steps (stamps or the plugin's live signature), so a lookup
// between two steps still finds the sequence. Returns null or
// {kind, record, stamp, sequence}.
function cmApiFindActive(runner, wanted, hooks = {}) {
  if (!wanted) return null;
  const active = cmApiLiveRecords(runner);
  for (const record of active) {
    const stamp = record.sequence;
    if (stamp && Array.isArray(stamp.steps) && cmSequenceSignature(stamp.steps) === wanted) {
      return { kind: "sequence", record, stamp, sequence: null };
    }
  }
  if (typeof hooks.activeSequences === "function") {
    try {
      const sequences = hooks.activeSequences();
      const sequence = (Array.isArray(sequences) ? sequences : []).find((item) => (
        item && String(item.signature || "") === wanted
      ));
      if (sequence) {
        const current = active.find((record) => record.sequence && record.sequence.id === sequence.id) || null;
        return { kind: "sequence", record: current, stamp: null, sequence };
      }
    } catch (error) {
      // The sequence map is an optional plugin integration.
    }
  }
  if (cmApiSignatureLength(wanted) !== 1) return null;
  let catalog = null;
  try { catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null; }
  catch (error) { catalog = null; }
  for (const record of active) {
    // A dry-run preview is not the command itself running.
    if (record.sequence || record.preview) continue;
    const replay = cmReplayRun(record, catalog);
    const recorded = cmSequenceStep({ argv: replay.argv, entry_id: replay.entryId || record.entry_id });
    if (cmSequenceSignature([recorded]) === wanted) return { kind: "run", record, stamp: null, sequence: null };
  }
  return null;
}

// The shipped activeRun(text) shape, kept byte-compatible.
function cmApiActiveLegacy(found) {
  if (!found) return null;
  if (found.stamp) {
    return {
      ...cmApiActiveRunRecord(found.record),
      sequenceId: found.stamp.id || null,
      step: Number(found.stamp.index) || null,
      total: Number(found.stamp.total) || found.stamp.steps.length,
    };
  }
  if (found.sequence) {
    const sequence = found.sequence;
    const current = found.record;
    return {
      ...(cmApiActiveRunRecord(current) || {}),
      runId: current ? String(current.id) : null,
      outcome: "running",
      sequenceId: String(sequence.id || "") || null,
      step: Number(sequence.index) || null,
      total: Number(sequence.total) || (Array.isArray(sequence.steps) ? sequence.steps.length : 0),
    };
  }
  return cmApiActiveRunRecord(found.record);
}

function cmApiLastStepRunId(sequence) {
  const results = sequence && Array.isArray(sequence.results) ? sequence.results : [];
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index] && results[index].runId) return String(results[index].runId);
  }
  return null;
}

// activeRun(signature): frozen {kind, state, runId, sequenceId, step, total}
// plus the legacy record fields. Between sequence steps runId names the last
// finished step's run so a repeated activation can still open live output.
function cmApiActiveView(found) {
  const legacy = cmApiActiveLegacy(found);
  if (!legacy) return null;
  const isSequence = found.kind === "sequence";
  return cmApiDeepFreeze({
    ...legacy,
    kind: isSequence ? "sequence" : "run",
    state: found.record ? String(found.record.outcome) : "running",
    runId: legacy.runId || (found.sequence ? cmApiLastStepRunId(found.sequence) : null),
    sequenceId: isSequence ? legacy.sequenceId || null : null,
    step: Number(legacy.step) || 1,
    total: Number(legacy.total) || 1,
  });
}

// A repeated activation of a live signature opens its output and never
// starts another run: {ok, active, duplicate, stage: "output", kind, state,
// runId, sequenceId, step, total, ...legacy record fields}.
async function cmApiOpenActive(found, hooks) {
  const view = cmApiActiveView(found);
  if (view.runId && typeof hooks.openOutput === "function") {
    try { await Promise.resolve(hooks.openOutput(view.runId)); }
    catch (error) { /* Opening output never starts another run. */ }
  }
  return { ...view, ok: true, active: true, duplicate: true, stage: "output" };
}

// One run-now step with the sheet's Ctrl+Enter options plus chip provenance.
async function cmApiRunResolvedStep(runner, resolved, catalog, options) {
  const step = resolved.steps[0];
  const entry = cmSequenceLookupEntry(step, catalog);
  const emit = cmApiStateEmitter(options.onState, {
    kind: "run", signature: resolved.signature, sequenceId: null, total: 1,
  });
  const runOpts = {
    entryId: entry && entry.id,
    title: (entry && entry.title) || step.title,
    trigger: "chip",
    source: options.source,
    skipGuards: true,
  };
  const forward = cmApiRunStateForwarder(emit);
  if (forward) runOpts.onState = forward;
  let settled;
  try {
    settled = await runner.run([...step.argv], runOpts);
  } catch (error) {
    settled = { ok: false, runId: null, outcome: "failed", exitCode: null, reason: cmApiErrorReason(error, "run failed") };
  }
  const result = { ...(settled || { ok: false, runId: null, outcome: "failed", reason: "run failed" }) };
  if (!result.outcome) result.outcome = result.ok ? "completed" : "failed";
  if (emit) emit(cmApiFinishedPayload(result, 1));
  return { ...result, stage: "run", sequenceId: null };
}

// A multi-step chip through the plugin's sequence driver. Each step's run
// reports queued/running, each settled step reports `step`, and the whole
// sequence reports one `finished` (distinct from its steps' finishes).
async function cmApiRunResolvedSequence(runner, hooks, resolved, catalog, options) {
  const random = runner && runner.deps && typeof runner.deps.random === "function" ? runner.deps.random : Math.random;
  const sequenceId = "seq-" + cmRunId(cmSequenceNowMs(runner), random);
  const total = resolved.steps.length;
  const emit = cmApiStateEmitter(options.onState, {
    kind: "sequence", signature: resolved.signature, sequenceId, total,
  });
  const runOptions = { id: sequenceId, trigger: "chip", source: options.source };
  if (emit) {
    runOptions.onRunState = cmApiRunStateForwarder(emit);
    runOptions.onStepFinish = (index, row) => emit({
      state: "step",
      runId: row && row.runId ? String(row.runId) : null,
      step: index + 1,
      outcome: (row && row.outcome) || "failed",
      reason: row && row.reason != null ? String(row.reason) : null,
    });
  }
  let summary;
  try {
    summary = typeof hooks.runSequence === "function"
      ? await hooks.runSequence(resolved.steps, runOptions)
      : await cmRunSequence(runner, resolved.steps, runOptions);
  } catch (error) {
    summary = { outcome: "failed", reason: cmApiErrorReason(error, "sequence failed") };
  }
  if (!summary || !Array.isArray(summary.results)) {
    // The driver refused before any step (for example, already running).
    return {
      ...(summary || {}),
      ok: false,
      outcome: "refused",
      stage: "refused",
      runId: null,
      sequenceId: null,
      reason: String((summary && summary.reason) || "sequence failed"),
    };
  }
  const halted = summary.stoppedAt
    ? summary.results.find((row) => row && Number(row.index) === Number(summary.stoppedAt))
    : null;
  const result = {
    ...summary,
    ok: summary.outcome === "completed" || summary.outcome === "attention",
    stage: "sequence",
    sequenceId: String(summary.id || sequenceId),
    runId: cmSequenceFocusRunId(summary, catalog) || null,
  };
  const reason = summary.reason || (halted && halted.reason) || null;
  if (reason) result.reason = String(reason);
  if (emit) {
    emit({
      ...cmApiFinishedPayload(result, total),
      sequenceId: result.sequenceId,
      step: Number(summary.stoppedAt) || total,
    });
  }
  return result;
}
