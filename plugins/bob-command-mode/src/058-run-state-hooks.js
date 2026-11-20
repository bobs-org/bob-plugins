// Bob Command Mode: per-run state hooks. A caller's onState rides the live
// record in memory (never the persisted JSON), so adopted runs from an older
// instance never call back. Hooks are guarded and never affect execution.

const cmRunStateHooks = new WeakMap(); // live record -> [onState]

function cmIsLiveRunState(state) {
  return state === "queued" || state === "running";
}

// Call a subscriber without letting a throw or a rejected promise escape.
function cmCallGuarded(callback, payload) {
  if (typeof callback !== "function") return;
  try {
    const result = callback(payload);
    if (result && typeof result.then === "function") result.then(undefined, () => {});
  } catch (error) {
    // Subscribers never affect execution.
  }
}

// The payload shared by the run-state workspace event and per-run hooks.
function cmRunStatePayload(record, state) {
  return {
    runId: record.id,
    argv: Array.isArray(record.argv) ? [...record.argv] : [],
    entryId: record.entry_id || null,
    state: String(state || record.outcome || "unknown"),
    outcome: record.outcome || String(state || "unknown"),
    effect: record.effect || null,
    trigger: record.trigger || null,
    source: cmCopyRunSource(record.source),
    sequence: record.sequence ? cmCopySequenceStamp(record.sequence) : null,
  };
}

// Attach onState to a live record. With replay, a caller that joined an
// already queued or running run (engine dedup) hears its current state now.
function cmAddRunStateHook(record, hook, options = {}) {
  if (!record || typeof hook !== "function") return;
  const hooks = cmRunStateHooks.get(record) || [];
  hooks.push(hook);
  cmRunStateHooks.set(record, hooks);
  if (options.replay && record.id && cmIsLiveRunState(record.outcome)) {
    cmCallGuarded(hook, Object.freeze(cmRunStatePayload(record, record.outcome)));
  }
}

function cmFireRunStateHooks(record, payload) {
  const hooks = record ? cmRunStateHooks.get(record) : null;
  if (!hooks || !hooks.length) return;
  if (!cmIsLiveRunState(payload && payload.state)) cmRunStateHooks.delete(record);
  const frozen = Object.freeze({ ...payload });
  for (const hook of [...hooks]) cmCallGuarded(hook, frozen);
}
