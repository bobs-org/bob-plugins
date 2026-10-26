// Bob Command Mode: generic outcome classification and the adapter registry.
// Pure function, applied in the spec order. Per-command adapters (feedback
// phase) register by catalog adapter id; unknown ids are ignored.

const CM_OUTCOME_ADAPTERS = {};

function cmRegisterOutcomeAdapter(adapterId, handler) {
  if (typeof adapterId !== "string" || !adapterId) return false;
  if (typeof handler !== "function") return false;
  CM_OUTCOME_ADAPTERS[adapterId] = handler;
  return true;
}

function cmOutcomeAdapter(adapterId) {
  if (typeof adapterId !== "string" || !adapterId) return null;
  return CM_OUTCOME_ADAPTERS[adapterId] || null;
}

function cmAdapterText(stdoutText, stderrText) {
  const stdout = cmStripAnsi(stdoutText);
  const stderr = cmStripAnsi(stderrText);
  const out = cmLastMeaningfulLine(stdoutText);
  const err = cmFirstMeaningfulLine(stderrText);
  return { out, err, stdout, stderr };
}

// Classify a finished run. Input: {exitCode, signal, timedOut, stoppedByUser,
// spawnError, spawnNotFound, spawnMessage, triedPaths, stdoutText, stderrText,
// exitHints, adapterId, run, adapterScope}. Returns {outcome, summary,
// retry?, actions?, carry?}.
function cmClassifyRun(input = {}) {
  if (input.stoppedByUser) {
    return { outcome: "stopped", summary: "Stopped" };
  }
  if (input.spawnError) {
    if (input.spawnNotFound) {
      const tried = Array.isArray(input.triedPaths) ? input.triedPaths.filter(Boolean) : [];
      const where = tried.length > 0 ? " (tried " + tried.join(", ") + ")" : "";
      return { outcome: "failed", summary: "bob not found" + where };
    }
    return { outcome: "failed", summary: String(input.spawnMessage || "bob could not start") };
  }
  if (input.timedOut) {
    const secs = Number(input.budgetSecs);
    const when = Number.isFinite(secs) && secs > 0 ? " after " + secs + " s" : "";
    return { outcome: "failed", summary: "Timed out" + when };
  }
  if (input.signal) {
    return { outcome: "failed", summary: "Killed by signal " + String(input.signal) };
  }
  const stdoutText = String(input.stdoutText || "");
  const stderrText = String(input.stderrText || "");
  const combined = (stdoutText + "\n" + stderrText).toLowerCase();
  const lockPhrase = CM_LOCK_PHRASE.toLowerCase();
  if (combined.includes(lockPhrase)) {
    if (input.exitCode === 0) {
      return { outcome: "attention", summary: "Another bob maintenance run holds the lock", retry: true };
    }
    return { outcome: "failed", summary: "Another bob maintenance run holds the lock", retry: true };
  }
  const adapter = cmOutcomeAdapter(input.adapterId);
  let adapterExtras = {};
  if (adapter) {
    let adjusted = null;
    try {
      const text = cmAdapterText(stdoutText, stderrText);
      const run = { ...(input.run || {}), ...text, exitCode: input.exitCode };
      adjusted = adapter(run, text, input.adapterScope || {});
    } catch (error) {
      adjusted = null;
    }
    if (adjusted && typeof adjusted === "object") {
      const outcome = adjusted.outcome;
      if (outcome === "completed" || outcome === "attention" || outcome === "failed" || outcome === "unknown" || outcome === "stopped") {
        const result = { outcome, summary: String(adjusted.summary || "Done") };
        if (adjusted.retry) result.retry = true;
        if (adjusted.carry !== undefined) result.carry = adjusted.carry;
        if (Array.isArray(adjusted.actions)) result.actions = adjusted.actions;
        return result;
      }
      if (adjusted.retry) adapterExtras.retry = true;
      if (adjusted.carry !== undefined) adapterExtras.carry = adjusted.carry;
      if (Array.isArray(adjusted.actions)) adapterExtras.actions = adjusted.actions;
    }
  }
  if (Array.isArray(input.exitHints)) {
    for (const hint of input.exitHints) {
      if (hint && hint.code === input.exitCode && (hint.outcome === "completed" || hint.outcome === "attention" || hint.outcome === "failed")) {
        return { outcome: hint.outcome, summary: String(hint.meaning || ("Exit " + hint.code)), ...adapterExtras };
      }
    }
  }
  if (input.exitCode === 0) {
    return { outcome: "completed", summary: cmLastMeaningfulLine(stdoutText) || "Done", ...adapterExtras };
  }
  const errorLine = cmFirstErrorLine(stderrText);
  if (errorLine) return { outcome: "failed", summary: errorLine, ...adapterExtras };
  const firstErr = cmFirstMeaningfulLine(stderrText);
  if (firstErr) return { outcome: "failed", summary: firstErr, ...adapterExtras };
  return { outcome: "failed", summary: cmLastMeaningfulLine(stdoutText) || "Failed", ...adapterExtras };
}
