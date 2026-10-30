// Bob Command Mode: in-order sequence driver. Never rejects.

function cmSequenceNowMs(runner, fallback) {
  try {
    if (runner && runner.deps && typeof runner.deps.nowMs === "function") {
      const value = runner.deps.nowMs();
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  } catch (error) {
    // Fall through to Date.now.
  }
  return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : Date.now();
}

function cmSequenceCallHook(hook, ...args) {
  if (typeof hook !== "function") return;
  try {
    hook(...args);
  } catch (error) {
    // Hook errors never stop the run or reach the runner.
  }
}

function cmSequenceIsCancelled(options) {
  if (!options || typeof options.cancelled !== "function") return false;
  try {
    return Boolean(options.cancelled());
  } catch (error) {
    return false;
  }
}

function cmSequenceShouldContinue(options, outcome) {
  const continues = options && typeof options.continues === "function"
    ? options.continues
    : cmSequenceContinues;
  try {
    return Boolean(continues(outcome));
  } catch (error) {
    return false;
  }
}

function cmSequencePadSkipped(results, fromIndex0, total) {
  for (let i = fromIndex0; i < total; i += 1) {
    results.push({ index: i + 1, skipped: true });
  }
}

function cmSequenceSummaryOutcome(results, halted, interrupted) {
  if (interrupted) return "interrupted";
  if (halted) return halted;
  if (results.some((row) => row && row.outcome === "attention")) return "attention";
  return "completed";
}

async function cmRunSequenceInner(runner, steps, options) {
  const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
  const total = stored.length;
  const startedAtMs = typeof options.startedAtMs === "number"
    ? options.startedAtMs
    : cmSequenceNowMs(runner);
  const random = runner && runner.deps && typeof runner.deps.random === "function"
    ? runner.deps.random
    : Math.random;
  const id = options.id ? String(options.id) : "seq-" + cmRunId(startedAtMs, random);
  const signature = cmSequenceSignature(stored);
  const startIndex = Math.max(0, Math.min(Number(options.startIndex) || 0, total));
  const prior = Array.isArray(options.priorResults) ? options.priorResults : [];
  const results = [];
  for (let i = 0; i < startIndex; i += 1) {
    const existing = prior.find((row) => row && Number(row.index) === i + 1);
    if (existing && !existing.skipped) {
      results.push({
        index: i + 1,
        runId: existing.runId || null,
        outcome: existing.outcome || "completed",
        reason: existing.reason || null,
        durationMs: typeof existing.durationMs === "number" ? existing.durationMs : null,
      });
    } else {
      results.push({ index: i + 1, skipped: true });
    }
  }
  let halted = null;
  let stoppedAt = null;
  let interrupted = false;
  const catalogOf = () => {
    try {
      return runner && typeof runner.catalog === "function" ? runner.catalog() : null;
    } catch (error) {
      return null;
    }
  };
  for (let i = startIndex; i < total; i += 1) {
    if (cmSequenceIsCancelled(options)) {
      interrupted = true;
      cmSequencePadSkipped(results, i, total);
      break;
    }
    const step = stored[i];
    cmSequenceCallHook(options.onStepStart, i, step);
    const catalog = catalogOf();
    const entry = step.entry_id ? cmEntryById(catalog, step.entry_id) : null;
    const stamp = cmSequenceStamp(id, i, stored, startedAtMs);
    const runOpts = {
      title: cmSequenceStepTitle(step, catalog),
      trigger: options.trigger || "sequence",
      skipGuards: true,
      sequence: stamp,
    };
    if (entry) runOpts.entryId = entry.id;
    const t0 = cmSequenceNowMs(runner);
    let settled;
    try {
      settled = await runner.run(step.argv, runOpts);
    } catch (error) {
      settled = {
        ok: false,
        runId: null,
        outcome: "failed",
        reason: String((error && error.message) || error || "run failed"),
      };
    }
    const durationMs = Math.max(0, cmSequenceNowMs(runner) - t0);
    const runId = settled && settled.runId ? settled.runId : null;
    const outcome = runId
      ? (settled.outcome || "unknown")
      : (settled && settled.outcome ? settled.outcome : "failed");
    const reason = settled && settled.reason ? settled.reason : null;
    const result = { index: i + 1, runId, outcome, reason, durationMs };
    results.push(result);
    cmSequenceCallHook(options.onStepFinish, i, result);
    if (!cmSequenceShouldContinue(options, outcome)) {
      halted = outcome;
      stoppedAt = i + 1;
      cmSequencePadSkipped(results, i + 1, total);
      break;
    }
  }
  const finishedAtMs = cmSequenceNowMs(runner, startedAtMs);
  const outcome = cmSequenceSummaryOutcome(results, halted, interrupted);
  return {
    id,
    signature,
    steps: stored,
    total,
    outcome,
    stoppedAt,
    results,
    startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
  };
}

async function cmRunSequence(runner, steps, options = {}) {
  try {
    if (!runner || typeof runner.run !== "function") {
      const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
      const nowMs = Date.now();
      return {
        id: options.id ? String(options.id) : "",
        signature: cmSequenceSignature(stored),
        steps: stored,
        total: stored.length,
        outcome: "failed",
        stoppedAt: stored.length ? 1 : null,
        results: stored.map((_, i) => (i === 0
          ? { index: 1, runId: null, outcome: "failed", reason: "no runner", durationMs: 0 }
          : { index: i + 1, skipped: true })),
        startedAtMs: nowMs,
        finishedAtMs: nowMs,
        durationMs: 0,
      };
    }
    return await cmRunSequenceInner(runner, steps, options);
  } catch (error) {
    const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
    const nowMs = Date.now();
    return {
      id: options.id ? String(options.id) : "",
      signature: cmSequenceSignature(stored),
      steps: stored,
      total: stored.length,
      outcome: "failed",
      stoppedAt: null,
      results: stored.map((_, i) => ({ index: i + 1, skipped: true })),
      startedAtMs: nowMs,
      finishedAtMs: nowMs,
      durationMs: 0,
      reason: String((error && error.message) || error || "sequence failed"),
    };
  }
}
