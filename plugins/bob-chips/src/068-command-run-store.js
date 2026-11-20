// CommandChipRunStore: the one plugin-owned record of chip-started runs,
// keyed by the engine's canonical signature (or `text:` + payload while the
// catalog loads). State lives here, never in widgets, so it survives
// decoration rebuilds and notes that rewrite themselves mid-run. Widgets
// subscribe and repaint in place; unsubscribing never touches a run.
//
// States: `idle` (nothing recorded), `pending` (a gesture was accepted and
// the engine has not queued anything yet; paint it as resting, never as a
// spinner), `queued`, `running`, `completed` (returns to idle after
// COMMAND_CHIP_COMPLETED_MS), `attention`, and `failed` (both kept until the
// next run or a plugin reload).
const COMMAND_CHIP_COMPLETED_MS = 1600;
const COMMAND_CHIP_LATCH_MS = 400;
const COMMAND_CHIP_TEXT_KEY_PREFIX = "text:";

function commandChipStoreKey(verdict, text) {
  try {
    if (verdict && verdict.state === "ready" && typeof verdict.signature === "string" && verdict.signature) {
      return verdict.signature;
    }
    return COMMAND_CHIP_TEXT_KEY_PREFIX + String(text === undefined || text === null ? "" : text);
  } catch (error) {
    return COMMAND_CHIP_TEXT_KEY_PREFIX;
  }
}

function commandChipIsLiveState(state) {
  return state === "queued" || state === "running";
}

// Terminal ink for an engine outcome. `unknown` and `stopped` halt a
// sequence without being errors, so they ask for attention.
function commandChipTerminalState(outcome) {
  if (outcome === "completed") return "completed";
  if (outcome === "attention" || outcome === "unknown" || outcome === "stopped") return "attention";
  return "failed";
}

// Identity of one rendered chip for armed-target matching. Inline chips use
// zero-based `line` and UTF-16 line-relative `from` / `to` with delimiters,
// `to` exclusive (the scanLine / chipAt convention). Block chips use the
// zero-based `fence.open` line (or `line` when no fence is given). The
// source path is part of the identity, so equal commands in two notes share
// run state but never both appear armed.
function commandChipTargetId(target) {
  try {
    if (!target || typeof target !== "object") return null;
    const path = typeof target.sourcePath === "string" ? target.sourcePath : "";
    if (target.form === "block") {
      const open = target.fence && Number.isInteger(target.fence.open) ? target.fence.open : target.line;
      if (!Number.isInteger(open)) return null;
      return JSON.stringify(["block", path, open]);
    }
    if (!Number.isInteger(target.line) || !Number.isInteger(target.from) || !Number.isInteger(target.to)) {
      return null;
    }
    return JSON.stringify(["inline", path, target.line, target.from, target.to]);
  } catch (error) {
    return null;
  }
}

function commandChipDefaultTimers() {
  return {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle),
  };
}

function commandChipCallListener(listener, ...args) {
  try {
    const result = listener(...args);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch (error) {
    // A painter's failure never affects the store or other painters.
  }
}

class CommandChipRunStore {
  constructor(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.timers = opts.timers && typeof opts.timers.set === "function" ? opts.timers : commandChipDefaultTimers();
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.completedMs = Number.isFinite(opts.completedMs) ? opts.completedMs : COMMAND_CHIP_COMPLETED_MS;
    this.latchMs = Number.isFinite(opts.latchMs) ? opts.latchMs : COMMAND_CHIP_LATCH_MS;
    this.entries = new Map();
    this.latches = new Map();
    this.outputAt = new Map();
    this.listeners = new Map();
    this.anyListeners = new Set();
    this.armed = null;
    this.seq = 0;
    this.latchSeq = 0;
    this.disposed = false;
  }

  // Frozen `{ key, signature, state, kind, intent, runId, sequenceId, step,
  // total, steps, outcome, reason, exitCode, stoppedAt, prior, seq, latched }`.
  // `step` is the 1-based current step; `steps` holds each settled step's
  // frozen `{ index, outcome, reason, runId }`.
  snapshot(key) {
    const entry = this.entries.get(key);
    const latched = this.latches.has(key);
    if (!entry) {
      return copyChipFreeze({
        key, signature: null, state: "idle", kind: null, intent: null, runId: null,
        sequenceId: null, step: 0, total: 0, steps: copyChipFreeze([]), outcome: null,
        reason: null, exitCode: null, stoppedAt: null, prior: null, seq: 0, latched,
      });
    }
    return copyChipFreeze({
      key,
      signature: entry.signature,
      state: entry.state,
      kind: entry.kind,
      intent: entry.intent,
      runId: entry.runId,
      sequenceId: entry.sequenceId,
      step: entry.step,
      total: entry.total,
      steps: copyChipFreeze(entry.steps.slice()),
      outcome: entry.outcome,
      reason: entry.reason,
      exitCode: entry.exitCode,
      stoppedAt: entry.stoppedAt,
      prior: entry.prior ? entry.prior.state : null,
      seq: entry.seq,
      latched,
    });
  }

  isLive(key) {
    const entry = this.entries.get(key);
    return Boolean(entry && commandChipIsLiveState(entry.state));
  }

  // Subscribe one painter to one key. Returns an idempotent unsubscribe.
  subscribe(key, listener) {
    if (this.disposed || typeof listener !== "function") return () => {};
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    const token = { listener };
    set.add(token);
    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) this.listeners.delete(key);
    };
  }

  // Every change: `listener(key, snapshot)`. Armed changes notify too.
  subscribeAll(listener) {
    if (this.disposed || typeof listener !== "function") return () => {};
    const token = { listener };
    this.anyListeners.add(token);
    return () => {
      this.anyListeners.delete(token);
    };
  }

  notify(key) {
    if (this.disposed) return;
    const snapshot = this.snapshot(key);
    const set = this.listeners.get(key);
    if (set) {
      for (const token of [...set]) commandChipCallListener(token.listener, snapshot);
    }
    for (const token of [...this.anyListeners]) commandChipCallListener(token.listener, key, snapshot);
  }

  clearTimer(entry) {
    if (!entry || entry.timer === null || entry.timer === undefined) return;
    try {
      this.timers.clear(entry.timer);
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    entry.timer = null;
  }

  // A gesture was accepted for `key`: record `pending` and remember what to
  // restore if nothing runs. Returns the activation's sequence number, which
  // every later update must present; a stale number is ignored.
  begin(key, info = {}) {
    if (this.disposed) return 0;
    this.seq += 1;
    const seq = this.seq;
    const previous = this.entries.get(key) || null;
    if (previous) this.clearTimer(previous);
    const prior = previous && !commandChipIsLiveState(previous.state) && previous.state !== "pending"
      ? { ...previous, timer: null, prior: null }
      : null;
    const total = Number(info.total) > 0 ? Number(info.total) : 1;
    this.entries.set(key, {
      key,
      seq,
      signature: typeof info.signature === "string" ? info.signature : null,
      state: "pending",
      kind: info.kind === "sequence" || total > 1 ? "sequence" : "run",
      intent: info.intent === "open" ? "open" : "run",
      runId: null,
      sequenceId: null,
      step: 1,
      total,
      steps: [],
      outcome: null,
      reason: null,
      exitCode: null,
      stoppedAt: null,
      prior,
      timer: null,
    });
    this.notify(key);
    return seq;
  }

  current(key, seq) {
    if (this.disposed) return null;
    const entry = this.entries.get(key);
    return entry && entry.seq === seq ? entry : null;
  }

  // Move a loading-time `text:` entry to the signature the engine reported.
  // An existing live entry under `toKey` wins and the move is refused.
  rekey(fromKey, toKey, seq) {
    if (fromKey === toKey) return true;
    const entry = this.current(fromKey, seq);
    if (!entry || typeof toKey !== "string" || toKey === "") return false;
    const existing = this.entries.get(toKey);
    if (existing && (commandChipIsLiveState(existing.state) || existing.state === "pending")) return false;
    if (existing) this.clearTimer(existing);
    this.entries.delete(fromKey);
    entry.key = toKey;
    entry.signature = toKey;
    this.entries.set(toKey, entry);
    this.notify(fromKey);
    this.notify(toKey);
    return true;
  }

  // Apply one engine `onState` payload for activation `seq`.
  apply(key, seq, payload) {
    const entry = this.current(key, seq);
    if (!entry || !payload || typeof payload !== "object") return false;
    const state = payload.state;
    if (payload.kind === "run" || payload.kind === "sequence") entry.kind = payload.kind;
    if (Number(payload.total) > 0) entry.total = Number(payload.total);
    if (payload.sequenceId) entry.sequenceId = String(payload.sequenceId);
    if (state === "queued" || state === "running") {
      if (payload.runId) entry.runId = String(payload.runId);
      if (Number(payload.step) > 0) entry.step = Number(payload.step);
      entry.state = state;
      entry.outcome = state;
    } else if (state === "step") {
      const index = Number(payload.step) > 0 ? Number(payload.step) : entry.step;
      const row = copyChipFreeze({
        index,
        outcome: payload.outcome ? String(payload.outcome) : "failed",
        reason: payload.reason != null ? String(payload.reason) : null,
        runId: payload.runId ? String(payload.runId) : null,
      });
      entry.steps = entry.steps.filter((item) => item.index !== index).concat([row]);
      entry.steps.sort((left, right) => left.index - right.index);
      if (row.runId) entry.runId = row.runId;
      if (index < entry.total) entry.step = index + 1;
      if (entry.state === "pending" || entry.state === "queued") entry.state = "running";
    } else if (state === "finished") {
      this.finish(entry, payload);
    } else {
      return false;
    }
    this.notify(entry.key);
    return true;
  }

  finish(entry, result) {
    const outcome = result && result.outcome ? String(result.outcome) : "failed";
    entry.state = commandChipTerminalState(outcome);
    entry.outcome = outcome;
    if (result && result.runId) entry.runId = String(result.runId);
    entry.reason = result && result.reason != null ? String(result.reason) : null;
    entry.exitCode = result && typeof result.exitCode === "number" ? result.exitCode : null;
    entry.stoppedAt = result && Number(result.stoppedAt) > 0 ? Number(result.stoppedAt) : null;
    if (result && Number(result.step) > 0) entry.step = Number(result.step);
    entry.prior = null;
    this.clearTimer(entry);
    if (entry.state === "completed") {
      const seq = entry.seq;
      const key = entry.key;
      try {
        entry.timer = this.timers.set(() => {
          const current = this.entries.get(key);
          // A newer run, or a rekey, owns the entry now: never reset it.
          if (!current || current !== entry || current.seq !== seq || current.state !== "completed") return;
          current.timer = null;
          this.entries.delete(key);
          this.notify(key);
        }, this.completedMs);
      } catch (error) {
        entry.timer = null;
      }
    }
  }

  // The engine settled activation `seq` with a run result. Events already
  // delivered win; a result without a `finished` event still ends the run.
  settle(key, seq, result) {
    const entry = this.current(key, seq);
    if (!entry) return false;
    if (entry.state !== "pending" && !commandChipIsLiveState(entry.state)) return false;
    const outcome = result && result.outcome;
    if (outcome === "queued" || outcome === "running") return false;
    this.finish(entry, result || {});
    this.notify(entry.key);
    return true;
  }

  // Nothing ran for activation `seq` (a card opened, a preview, a refusal):
  // restore the ink from before the gesture, never a fake running state.
  revert(key, seq) {
    const entry = this.current(key, seq);
    if (!entry || entry.state !== "pending") return false;
    this.clearTimer(entry);
    const prior = entry.prior;
    if (prior && prior.state !== "completed") {
      this.entries.set(key, { ...prior, key, timer: null, prior: null });
    } else {
      this.entries.delete(key);
    }
    this.notify(key);
    return true;
  }

  // The activation itself broke (a throwing or rejecting engine call).
  fail(key, seq, reason) {
    const entry = this.current(key, seq);
    if (!entry) return false;
    this.finish(entry, { outcome: "failed", reason: String(reason || "command failed") });
    this.notify(entry.key);
    return true;
  }

  // Synchronous per-key latch. Returns a token, or null while another
  // gesture holds it. The latch lasts at least `latchMs` and until
  // settleLatch(token): swallowing double clicks and key repeats.
  tryLatch(key) {
    if (this.disposed || this.latches.has(key)) return null;
    this.latchSeq += 1;
    const latch = { token: this.latchSeq, settled: false, elapsed: false, timer: null };
    this.latches.set(key, latch);
    try {
      latch.timer = this.timers.set(() => {
        latch.timer = null;
        latch.elapsed = true;
        if (latch.settled) this.releaseLatch(key, latch.token);
      }, this.latchMs);
    } catch (error) {
      latch.elapsed = true;
    }
    return latch.token;
  }

  settleLatch(key, token) {
    const latch = this.latches.get(key);
    if (!latch || latch.token !== token) return false;
    latch.settled = true;
    if (latch.elapsed) this.releaseLatch(key, token);
    return true;
  }

  releaseLatch(key, token) {
    const latch = this.latches.get(key);
    if (!latch || latch.token !== token) return false;
    if (latch.timer !== null) {
      try {
        this.timers.clear(latch.timer);
      } catch (error) {
        // Timer cleanup is best-effort.
      }
    }
    this.latches.delete(key);
    return true;
  }

  isLatched(key) {
    return this.latches.has(key);
  }

  // Output deduplication: true when opening `key`'s output now is allowed,
  // and claims the next `latchMs` so a double click opens it once.
  claimOutput(key) {
    if (this.disposed) return false;
    const now = this.now();
    const last = this.outputAt.get(key);
    if (Number.isFinite(last) && now - last < this.latchMs) return false;
    this.outputAt.set(key, now);
    return true;
  }

  // The `⌘↵` target that widgets paint `.is-armed` (keymap phase owner).
  // `target` carries the run key (`key`) plus the commandChipTargetId
  // identity fields; null disarms.
  setArmed(target) {
    if (this.disposed) return false;
    const id = commandChipTargetId(target);
    const key = id && target && typeof target.key === "string" ? target.key : null;
    const next = id && key ? copyChipFreeze({ id, key, target: copyChipFreeze({ ...target }) }) : null;
    const previous = this.armed;
    if ((previous && previous.id) === (next && next.id) && (previous && previous.key) === (next && next.key)) return false;
    this.armed = next;
    if (previous) this.notify(previous.key);
    if (next && (!previous || previous.key !== next.key)) this.notify(next.key);
    return true;
  }

  armedTarget() {
    return this.armed ? this.armed.target : null;
  }

  isArmed(identity) {
    if (!this.armed) return false;
    const id = commandChipTargetId(identity);
    return Boolean(id && id === this.armed.id);
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries.values()) this.clearTimer(entry);
    for (const [key, latch] of this.latches) {
      if (latch.timer !== null) {
        try {
          this.timers.clear(latch.timer);
        } catch (error) {
          // Timer cleanup is best-effort.
        }
      }
      this.latches.delete(key);
    }
    this.entries.clear();
    this.outputAt.clear();
    this.listeners.clear();
    this.anyListeners.clear();
    this.armed = null;
    this.disposed = true;
  }
}
