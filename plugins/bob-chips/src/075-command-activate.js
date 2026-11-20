// commandChipActivate(chip, ctx): the one path from a deliberate gesture to
// Command Mode, shared by Live Preview widgets, Reading buttons, the
// `bob-run` card, and `⌘↵`. Only Command Mode tokenizes, validates, and
// spawns; this file never builds argv, never retries, and never touches the
// chip's task, its status, freshness, or the walk.
//
// `chip` is `{ label, text, form?, line?, from?, to?, fence? }` (the chipAt
// shape). `ctx` is the renderer's activation context:
//   plugin              the Bob Chips plugin (required)
//   sourcePath          vault-relative path of the note holding the span
//   resolveSourcePath() fresher path reader; wins over sourcePath
//   sourceVerified      query results only: true once the owning note is proven
//   line                zero-based source line, sent as run provenance
//   origin              "live" | "reading" | "embed" | "hover" | "query" |
//                       "fence" | "cursor"
//   view, element       the editor view and/or the chip element
//   checkSource()       fresh stale check: boolean, {ok, reason}, or a Promise
//   range               Live Preview `{ from, to, raw }` absolute doc slice
//   readSource(), snapshot  text reader plus `{ line, from, to, raw }`
//   refresh()           repaint after a stale or changed span
//   shift, alt          Shift opens the guarded path; Alt is inert for now
//   copyFeedback(result) optional copy feedback override
// Settles a frozen `{ action, ok, stage, outcome, reason, runId,
// sequenceId, signature }` and never rejects.
const COMMAND_CHIP_REFUSED_PREFIX = "Can't run: ";
const COMMAND_CHIP_FAILED_PREFIX = "Command chip failed: ";

function commandChipResult(action, fields) {
  const f = fields && typeof fields === "object" ? fields : {};
  return copyChipFreeze({
    action,
    ok: f.ok === undefined ? action !== "refused" && action !== "error" && action !== "stale" : Boolean(f.ok),
    stage: f.stage === undefined ? null : f.stage,
    outcome: f.outcome === undefined ? null : f.outcome,
    reason: f.reason === undefined || f.reason === null ? null : String(f.reason),
    runId: f.runId ? String(f.runId) : null,
    sequenceId: f.sequenceId ? String(f.sequenceId) : null,
    signature: f.signature ? String(f.signature) : null,
  });
}

function commandChipNotice(message) {
  try {
    if (CopyChipsNotice && typeof CopyChipsNotice === "function") {
      // eslint-disable-next-line no-new
      new CopyChipsNotice(String(message));
    }
  } catch (error) {
    // Notices are best-effort.
  }
}

function commandChipErrorReason(error, fallback) {
  try {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
    const text = String(error === undefined || error === null ? "" : error).trim();
    if (text && text !== "[object Object]") return text;
  } catch (ignore) {
    // Fall through to the fallback.
  }
  return fallback;
}

function commandChipRefusalText(verdict) {
  const reason = String((verdict && verdict.reason) || "command could not be resolved");
  const step = verdict && Number(verdict.step) > 1 ? " (step " + Number(verdict.step) + ")" : "";
  return reason + step;
}

function commandChipRefresh(ctx) {
  try {
    if (ctx && typeof ctx.refresh === "function") {
      const value = ctx.refresh();
      if (value && typeof value.catch === "function") value.catch(() => {});
    }
  } catch (error) {
    // Refresh is best-effort; the next gesture rechecks anyway.
  }
}

// Copy-only contexts copy the exact payload with the copy chips' feedback
// and never reach Command Mode.
async function commandChipCopyOnly(text, ctx, reason) {
  let written = null;
  try {
    written = await copyChipWrite(text);
  } catch (error) {
    written = copyChipFreeze({ ok: false, reason: "copy failed" });
  }
  const ok = Boolean(written && written.ok);
  const failure = (written && written.reason) || "copy failed";
  try {
    const el = ctx && ctx.element;
    if (ctx && typeof ctx.copyFeedback === "function") {
      commandChipCallListener(ctx.copyFeedback, written);
    } else if (el) {
      if (ok) copyChipShowFeedback(el, "success");
      else copyChipFail(el, failure);
    } else if (ok) {
      copyChipAnnounce(typeof document !== "undefined" ? document : null, "Copied");
    } else {
      commandChipNotice("Couldn't copy: " + failure);
    }
  } catch (error) {
    // Feedback never turns a written copy into a failure.
  }
  return commandChipResult("copy", { ok, reason: ok ? reason : failure });
}

function commandChipOpenOutput(engine, runId) {
  try {
    if (!engine || typeof engine.openOutput !== "function" || !runId) return;
    const pending = engine.openOutput(runId);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch (error) {
    // Opening output never starts a run and never throws.
  }
}

// A key already running opens its live output (once per latch window); a
// key whose gesture is still pending acceptance swallows the duplicate.
function commandChipBusy(store, engine, key) {
  const snapshot = store.snapshot(key);
  if (commandChipIsLiveState(snapshot.state) && snapshot.runId) {
    if (!store.claimOutput(key)) return commandChipResult("duplicate", { signature: snapshot.signature });
    commandChipOpenOutput(engine, snapshot.runId);
    return commandChipResult("output", {
      stage: "output",
      outcome: snapshot.state,
      runId: snapshot.runId,
      sequenceId: snapshot.sequenceId,
      signature: snapshot.signature,
    });
  }
  if (store.isLatched(key) || snapshot.state === "pending" || commandChipIsLiveState(snapshot.state)) {
    return commandChipResult("duplicate", { signature: snapshot.signature });
  }
  return null;
}

// Map Command Mode's settled result onto the store and the user.
function commandChipSettle(store, key, seq, settled, intent, signature) {
  const r = settled && typeof settled === "object" ? settled : null;
  if (!r) {
    const reason = "Command Mode returned no result";
    store.fail(key, seq, reason);
    commandChipNotice(COMMAND_CHIP_FAILED_PREFIX + reason);
    return commandChipResult("error", { reason, signature });
  }
  const stage = typeof r.stage === "string" ? r.stage : null;
  const fields = {
    ok: r.ok !== false,
    stage,
    outcome: r.outcome || null,
    reason: r.reason,
    runId: r.runId,
    sequenceId: r.sequenceId,
    signature,
  };
  if (stage === "refused") {
    store.revert(key, seq);
    commandChipNotice(COMMAND_CHIP_REFUSED_PREFIX + commandChipRefusalText(r));
    return commandChipResult("refused", { ...fields, ok: false });
  }
  if (stage === "confirm" || stage === "review" || stage === "preview" || (stage === "output" && r.duplicate)) {
    // A card, a dry-run preview, or someone else's live run: nothing of
    // ours is running, so restore the resting ink.
    store.revert(key, seq);
    if (r.ok === false && stage === "preview") {
      commandChipNotice(COMMAND_CHIP_REFUSED_PREFIX + String(r.reason || "preview failed"));
    }
    return commandChipResult(stage === "output" ? "output" : intent, fields);
  }
  store.settle(key, seq, r);
  if (r.ok === false && !r.runId && (stage === "run" || stage === "output")) {
    // Refused before it queued (for example, a failed save): no toast or
    // card will explain it, so say why once.
    commandChipNotice(COMMAND_CHIP_REFUSED_PREFIX + String(r.reason || "run failed"));
  }
  return commandChipResult(intent, fields);
}

async function commandChipActivate(chip, ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const runtime = commandChipRuntimeOf(c.plugin);
  const text = chip && typeof chip.text === "string" ? chip.text : "";
  if (!runtime) return commandChipResult("refused", { reason: "Bob Chips is not loaded" });
  if (!/\S/.test(text)) return commandChipResult("refused", { reason: RUN_CHIP_NOTHING_TO_RUN });
  if (c.alt === true) return commandChipResult("inert", { ok: true });
  const app = c.plugin.app;
  const store = runtime.store;
  const intent = c.shift === true ? "open" : "run";

  // 1. Source note, host, and engine.
  let policy = commandChipEligibility(app, c);
  if (policy.mode !== "run") return commandChipCopyOnly(text, c, policy.reason);

  // 2. A fresh verdict names the key; the latch is taken synchronously,
  //    before the first asynchronous boundary.
  let verdict = commandChipFreshResolve(policy.engine, text);
  let key = commandChipStoreKey(verdict, text);
  const busy = commandChipBusy(store, policy.engine, key);
  if (busy) return busy;
  const latches = [];
  const first = store.tryLatch(key);
  if (first === null) return commandChipResult("duplicate", { signature: verdict.signature });
  latches.push([key, first]);
  const settleLatches = () => {
    for (const [latchKey, token] of latches) store.settleLatch(latchKey, token);
  };
  let seq = 0;
  let liveKey = key;
  try {
    // 3. The displayed span must still be the source span.
    const source = await commandChipCheckSource(c);
    if (!source || !source.ok) {
      commandChipRefresh(c);
      return commandChipResult("stale", { reason: (source && source.reason) || COMMAND_CHIP_SOURCE_CHANGED });
    }
    // 4. Recheck note, engine, and catalog after the asynchronous read.
    policy = commandChipEligibility(app, c);
    if (policy.mode !== "run") return commandChipCopyOnly(text, c, policy.reason);
    verdict = commandChipFreshResolve(policy.engine, text);
    if (verdict.state === "invalid" || verdict.state === "unavailable") {
      commandChipNotice(COMMAND_CHIP_REFUSED_PREFIX + commandChipRefusalText(verdict));
      return commandChipResult("refused", { stage: "refused", outcome: "refused", reason: verdict.reason });
    }
    const nextKey = commandChipStoreKey(verdict, text);
    if (nextKey !== key) {
      const busyNext = commandChipBusy(store, policy.engine, nextKey);
      if (busyNext) return busyNext;
      const token = store.tryLatch(nextKey);
      if (token === null) return commandChipResult("duplicate", { signature: verdict.signature });
      latches.push([nextKey, token]);
      key = nextKey;
    }
    liveKey = key;

    // 5. Hand the payload to Command Mode, feeding the store from its events.
    const steps = Array.isArray(verdict.steps) ? verdict.steps.length : 0;
    seq = store.begin(key, { signature: verdict.signature, intent, total: steps || 1 });
    const onState = (payload) => {
      if (runtime.disposed || !payload || typeof payload !== "object") return;
      if (typeof payload.signature === "string" && payload.signature && payload.signature !== liveKey) {
        if (store.rekey(liveKey, payload.signature, seq)) liveKey = payload.signature;
      }
      store.apply(liveKey, seq, payload);
      if (payload.state === "queued" || payload.state === "running") settleLatches();
    };
    const sourceArg = { path: policy.sourcePath };
    if (Number.isInteger(c.line) && c.line >= 0) sourceArg.line = c.line;
    const engine = policy.engine;
    let settled;
    try {
      settled = await (intent === "open"
        ? engine.openText(text, { source: sourceArg, onState })
        : engine.runText(text, { source: sourceArg, onState }));
    } catch (error) {
      const reason = commandChipErrorReason(error, "Command Mode failed");
      if (!runtime.disposed) store.fail(liveKey, seq, reason);
      commandChipNotice(COMMAND_CHIP_FAILED_PREFIX + reason);
      return commandChipResult("error", { reason, signature: verdict.signature });
    }
    if (runtime.disposed) return commandChipResult(intent, { stage: settled && settled.stage, ok: settled && settled.ok });
    return commandChipSettle(store, liveKey, seq, settled, intent, verdict.signature);
  } catch (error) {
    const reason = commandChipErrorReason(error, "command chip failed");
    if (seq && !runtime.disposed) store.fail(liveKey, seq, reason);
    commandChipNotice(COMMAND_CHIP_FAILED_PREFIX + reason);
    return commandChipResult("error", { reason });
  } finally {
    settleLatches();
  }
}
