// Bob Command Mode: detached file-backed run engine (spawn, tail, queue,
// guards, budgets, stop, reload adoption). The plugin wires real modules and
// the Obsidian app; tests inject fakes through the deps object.

function cmDefaultRunnerDeps(overrides = {}) {
  return {
    childProcess: null, // defaults to require("child_process")
    fs: null, // defaults to require("fs")
    os: null,
    path: null,
    nowMs: () => Date.now(),
    random: Math.random,
    tailPollMs: CM_TAIL_POLL_MS,
    readKillGraceMs: CM_READ_KILL_GRACE_MS,
    stopKillGraceMs: CM_STOP_KILL_GRACE_MS,
    adoptPollMs: CM_ADOPT_POLL_MS,
    maxParallelReads: CM_MAX_PARALLEL_READS,
    // Production unrefs children and timers so detached runs never hold the
    // host loop; tests set this false so the loop survives until settlement.
    unrefHandles: true,
    keepRuns: CM_DEFAULT_KEEP_RUNS,
    keepDays: CM_DEFAULT_KEEP_DAYS,
    env: typeof process !== "undefined" ? process.env : {},
    // App integration points, overridden by the plugin and the harness.
    resolveBob: () => ({ path: "bob", source: "path", tried: [] }),
    vaultBase: () => null,
    catalog: () => null,
    saveAllMarkdown: () => Promise.resolve({ ok: true }),
    notify: () => {},
    fireEvent: () => {},
    shellOpenPath: null,
    pagerWidthCols: 100,
    home: "",
    isWin32: typeof process !== "undefined" && process.platform === "win32",
    ...overrides,
  };
}

class CommandModeRunner {
  constructor(deps = {}) {
    this.deps = cmDefaultRunnerDeps(deps);
    this.live = new Map(); // runId -> live run
    this.pending = []; // queued {kind, spec, resolve}
    this.readsActive = 0;
    this.writerActive = false;
    this.adoptTimers = new Set();
    this.lastRunId = null;
    try {
      this.host = this.deps.os && typeof this.deps.os.hostname === "function"
        ? this.deps.os.hostname()
        : null;
    } catch (error) {
      this.host = null;
    }
    if (!this.host) {
      try {
        this.host = (this.deps.env && this.deps.env.HOSTNAME) || null;
      } catch (error) {
        this.host = null;
      }
    }
  }

  fs() {
    return this.deps.fs || cmFs();
  }

  childProcess() {
    return this.deps.childProcess || cmChildProcess();
  }

  pathModule() {
    return this.deps.path || cmPath();
  }

  runsDir() {
    return cmRunsDir(this.deps.env, { osModule: this.deps.os, pathModule: this.deps.path });
  }

  catalog() {
    try {
      return this.deps.catalog() || null;
    } catch (error) {
      return null;
    }
  }

  // Full pipeline. Never rejects; settles {ok, runId, outcome, exitCode, reason?}.
  run(argv, opts = {}) {
    return this.runInner(Array.isArray(argv) ? [...argv] : [], opts).catch((error) => ({
      ok: false,
      runId: null,
      outcome: "failed",
      exitCode: null,
      reason: String((error && error.message) || error || "run failed"),
    }));
  }

  async runInner(argv, opts) {
    const catalog = this.catalog();
    const entry = opts.entryId ? cmEntryById(catalog, opts.entryId) : cmFindEntryForArgv(catalog, argv);
    const excluded = cmExcludedReason(catalog, argv);
    if (excluded) {
      return { ok: false, runId: null, outcome: "failed", exitCode: null, reason: excluded };
    }
    if (this.deps.isWin32) {
      return { ok: false, runId: null, outcome: "failed", exitCode: null, reason: "Bob command mode supports Linux and macOS" };
    }
    const vaultBase = this.deps.vaultBase();
    if (!vaultBase) {
      return { ok: false, runId: null, outcome: "failed", exitCode: null, reason: "Command mode needs a local vault" };
    }
    const effect = cmNormalizeEffect(opts.effect || (entry && entry.effect));
    const presentation = cmNormalizePresentation(opts.presentation || (entry && entry.presentation));
    const policy = cmNormalizePolicy(opts.policy || (entry && entry.policy));
    const usePreview = Boolean(opts.preview);
    if (policy === "confirm" && !opts.skipGuards && !opts.confirmed) {
      const confirmText = (entry && entry.confirm) || "This command needs confirmation.";
      return { ok: false, runId: null, outcome: "failed", exitCode: null, reason: confirmText };
    }
    if (policy === "preview-first" && usePreview !== true && !opts.skipGuards) {
      return { ok: false, runId: null, outcome: "failed", exitCode: null, reason: "Run the preview first, then apply." };
    }
    const finalArgv = entry ? cmAssembleArgv(entry, argv.slice(entry.path.length), { preview: usePreview }) : [...argv];
    const duplicate = this.findDuplicate(finalArgv, usePreview);
    if (duplicate) {
      const settled = await duplicate.settled;
      return { ...settled, duplicate: true };
    }
    const resolution = this.deps.resolveBob();
    const features = catalog && Array.isArray(catalog.features) ? catalog.features : [];
    const bobVersion = catalog && typeof catalog.bob_version === "string" ? catalog.bob_version : null;
    const runId = cmRunId(this.deps.nowMs(), this.deps.random);
    const record = cmNewRecord({
      id: runId,
      argv: finalArgv,
      entryId: (entry && entry.id) || opts.entryId || null,
      title: opts.title || (entry && entry.title) || null,
      effect,
      presentation,
      preview: usePreview,
      trigger: opts.trigger || "sheet",
      bobPath: resolution.path,
      bobVersion,
      host: this.host,
      nowMs: this.deps.nowMs(),
    });
    const isReads = effect === "reads";
    const budgetSecs = Number((entry && entry.budget_secs) || (isReads ? 60 : 180)) || 60;
    record.budget_secs = budgetSecs;
    if (!isReads) {
      const saved = await this.deps.saveAllMarkdown();
      if (!saved || !saved.ok) {
        return {
          ok: false,
          runId: null,
          outcome: "failed",
          exitCode: null,
          reason: "Could not save `" + (saved && saved.path ? saved.path : "note") + "`; run refused",
        };
      }
    }
    let settleResolve;
    const settled = new Promise((resolve) => { settleResolve = resolve; });
    const spec = {
      record, entry, resolution, features, vaultBase, usePreview,
      argvKey: JSON.stringify({ argv: finalArgv, preview: usePreview }),
      budgetSecs,
      settled, settleResolve,
    };
    if (isReads) {
      this.pending.push({ kind: "read", spec });
    } else {
      record.outcome = "queued";
      this.persistRecord(record);
      this.pending.push({ kind: "write", spec });
    }
    this.live.set(runId, { record, spec, waiters: [settleResolve] });
    this.lastRunId = runId;
    this.pump();
    return settled;
  }

  findDuplicate(argv, preview) {
    // Compare against the pre-spawn argv key: record.argv gains the resolved
    // bob path once the child spawns, which would hide later duplicates.
    const key = JSON.stringify({ argv, preview });
    for (const live of this.live.values()) {
      if (live.spec && live.spec.argvKey === key) return live.spec;
    }
    for (const queued of this.pending) {
      if (queued.spec && queued.spec.argvKey === key) return queued.spec;
    }
    return null;
  }

  pump() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const readIndex = this.pending.findIndex((item) => item.kind === "read");
      if (readIndex >= 0 && this.readsActive < this.deps.maxParallelReads) {
        const [item] = this.pending.splice(readIndex, 1);
        this.readsActive += 1;
        this.spawnRun(item.spec, "read");
        progressed = true;
      }
      if (!this.writerActive) {
        const writeIndex = this.pending.findIndex((item) => item.kind === "write");
        if (writeIndex >= 0) {
          const [item] = this.pending.splice(writeIndex, 1);
          this.writerActive = true;
          this.spawnRun(item.spec, "write");
          progressed = true;
        }
      }
    }
  }

  releaseSlot(kind) {
    if (kind === "read") this.readsActive = Math.max(0, this.readsActive - 1);
    else this.writerActive = false;
    this.pump();
  }

  persistRecord(record) {
    try {
      cmWriteRecord(this.fs(), this.runsDir(), record);
    } catch (error) {
      // Records are best effort when the disk is unusable; the run continues.
    }
  }

  spawnRun(spec, kind) {
    const { record } = spec;
    const fsModule = this.fs();
    const runsDir = this.runsDir();
    const paths = cmRunFilePaths(runsDir, record.id, this.deps.path);
    spec.paths = paths;
    spec.kind = kind;
    record.outcome = "running";
    try {
      cmEnsureRunsDir(fsModule, runsDir);
      for (const file of [paths.out, paths.err]) {
        const fd = fsModule.openSync(file, "w", 0o600);
        fsModule.closeSync(fd);
        try {
          fsModule.chmodSync(file, 0o600);
        } catch (error) {
          // Best effort.
        }
      }
      this.persistRecord(record);
    } catch (error) {
      this.finishSpawnError(spec, kind, {
        ok: false, runId: record.id, outcome: "failed", exitCode: null,
        reason: "Cannot write run files: " + String(error && error.message || error),
      });
      return;
    }
    const receiptPath = spec.features.includes(CM_FEATURE_RECEIPT) ? paths.receipt : null;
    const env = cmBuildChildEnv({
      env: this.deps.env,
      vaultBase: spec.vaultBase,
      features: spec.features,
      receiptPath,
      pagerWidthCols: this.deps.pagerWidthCols,
      pathModule: this.deps.path,
      home: this.deps.home || cmHomeDir({ env: this.deps.env, osModule: this.deps.os }),
    });
    let outFd = -1;
    let errFd = -1;
    let child = null;
    let spawnError = null;
    // The binary never travels inside argv: entry runs assemble path words
    // only, and a raw argv may still carry a leading `bob` word to drop.
    let spawnArgs = [...record.argv];
    if (!spec.entry && spawnArgs.length > 0) {
      const first = String(spawnArgs[0] || "");
      if (first === "bob" || first.endsWith("/bob")) spawnArgs = spawnArgs.slice(1);
    }
    spec.spawnBinary = spec.resolution.path;
    spec.spawnArgs = spawnArgs;
    try {
      outFd = fsModule.openSync(paths.out, "a");
      errFd = fsModule.openSync(paths.err, "a");
      child = this.childProcess().spawn(spec.resolution.path, spawnArgs, {
        cwd: spec.vaultBase,
        detached: true,
        stdio: ["ignore", outFd, errFd],
        env,
      });
    } catch (error) {
      spawnError = error;
    }
    try {
      if (outFd >= 0) fsModule.closeSync(outFd);
    } catch (error) {
      // Already closed.
    }
    try {
      if (errFd >= 0) fsModule.closeSync(errFd);
    } catch (error) {
      // Already closed.
    }
    if (spawnError || !child) {
      this.classifySpawnError(spec, kind, spawnError);
      return;
    }
    // Record the exact argv that ran (bob path + args) for honest history.
    record.argv = [spec.spawnBinary, ...spec.spawnArgs];
    if (typeof child.pid === "number") record.pid = child.pid;
    this.persistRecord(record);
    const live = this.live.get(record.id);
    const state = {
      spec, kind, child, paths,
      stdout: "", stderr: "",
      outOffset: 0, errOffset: 0,
      outFd: -1, errFd: -1,
      truncated: false,
      stdoutDecoder: this.makeDecoder(),
      stderrDecoder: this.makeDecoder(),
      exitInfo: null,
      timedOut: false,
      stoppedByUser: false,
      finished: false,
      budgetTimer: null, killTimer: null, tailTimer: null,
    };
    if (live) live.state = state;
    if (this.deps.unrefHandles !== false) {
      try {
        if (typeof child.unref === "function") child.unref();
      } catch (error) {
        // Attached children still finalize normally.
      }
    }
    try {
      state.outFd = fsModule.openSync(paths.out, "r");
      state.errFd = fsModule.openSync(paths.err, "r");
    } catch (error) {
      state.outFd = -1;
      state.errFd = -1;
    }
    child.on("error", (error) => {
      if (state.finished) return;
      this.classifySpawnError(spec, kind, error, state);
    });
    child.on("close", (code, signal) => {
      if (state.finished) return;
      state.exitInfo = { code: typeof code === "number" ? code : null, signal: signal || null };
      this.drainTails(state);
      this.finalizeLiveRun(record.id, state);
    });
    state.tailTimer = setInterval(() => {
      if (state.finished) return;
      this.drainTails(state);
    }, this.deps.tailPollMs);
    if (this.deps.unrefHandles !== false && state.tailTimer && typeof state.tailTimer.unref === "function") state.tailTimer.unref();
    if (isReads(record)) {
      state.budgetTimer = setTimeout(() => this.timeoutRead(record.id, spec, state), spec.budgetSecs * 1000);
      if (this.deps.unrefHandles !== false && state.budgetTimer && typeof state.budgetTimer.unref === "function") state.budgetTimer.unref();
    } else {
      state.budgetTimer = setTimeout(() => {
        if (state.finished) return;
        record.overdue = true;
        this.persistRecord(record);
      }, spec.budgetSecs * 1000);
      if (this.deps.unrefHandles !== false && state.budgetTimer && typeof state.budgetTimer.unref === "function") state.budgetTimer.unref();
    }
    // Self-contained exit path: the closure below captures only files and the
    // record snapshot, so a plugin reload mid-run still finalizes the record.
    state.finalizeFromExit = () => this.finalizeLiveRun(record.id, state);
  }

  isReadsRecord(record) {
    return record && record.effect === "reads";
  }

  makeDecoder() {
    try {
      if (typeof TextDecoder === "function") return new TextDecoder("utf-8");
    } catch (error) {
      // Fall back to whole-buffer decoding below.
    }
    return null;
  }

  decodeChunk(decoder, buffer) {
    if (decoder) {
      try {
        return decoder.decode(buffer, { stream: true });
      } catch (error) {
        // Fall through to whole-buffer decoding.
      }
    }
    return buffer.toString("utf8");
  }

  flushDecoder(decoder, chunks) {
    if (decoder) {
      try {
        const rest = decoder.decode();
        if (rest) chunks.push(rest);
      } catch (error) {
        // Nothing pending.
      }
    }
  }

  drainTails(state) {
    const fsModule = this.fs();
    this.drainOneTail(state, "out", fsModule);
    this.drainOneTail(state, "err", fsModule);
  }

  drainOneTail(state, stream, fsModule) {
    const fd = stream === "out" ? state.outFd : state.errFd;
    if (typeof fd !== "number" || fd < 0) return;
    const isOut = stream === "out";
    const offsetKey = isOut ? "outOffset" : "errOffset";
    const textKey = isOut ? "stdout" : "stderr";
    const decoderKey = isOut ? "stdoutDecoder" : "stderrDecoder";
    let offset = state[offsetKey];
    for (;;) {
      let buffer;
      try {
        buffer = Buffer.alloc(64 * 1024);
      } catch (error) {
        return;
      }
      let bytesRead = 0;
      try {
        bytesRead = fsModule.readSync(fd, buffer, 0, buffer.length, offset);
      } catch (error) {
        return;
      }
      if (!bytesRead) break;
      const slice = buffer.slice(0, bytesRead);
      offset += bytesRead;
      const text = this.decodeChunk(state[decoderKey], slice);
      const record = state.spec.record;
      record.interleave.push([stream, bytesRead]);
      if (!state.truncated) {
        const next = state[textKey].length + text.length;
        if (next > CM_MEM_CAP_BYTES) {
          state[textKey] += text.slice(0, Math.max(0, CM_MEM_CAP_BYTES - state[textKey].length));
          state.truncated = true;
          record.truncated = true;
        } else {
          state[textKey] += text;
        }
      }
    }
    state[offsetKey] = offset;
  }

  timeoutRead(runId, spec, state) {
    if (state.finished || state.exitInfo) return;
    state.timedOut = true;
    this.killProcessGroup(state, () => {
      if (state.finished) return;
      state.exitInfo = state.exitInfo || { code: null, signal: "SIGKILL" };
      this.drainTails(state);
      this.finalizeLiveRun(runId, state);
    }, this.deps.readKillGraceMs);
  }

  killProcessGroup(state, onGaveUp, graceMs) {
    const child = state.child;
    const pid = child && typeof child.pid === "number" ? child.pid : (state.spec.record.pid || null);
    const killTarget = (signal) => {
      if (pid) {
        try {
          process.kill(-pid, signal);
          return true;
        } catch (error) {
          // No group (or already gone): fall back to the child handle.
        }
      }
      try {
        if (child && typeof child.kill === "function") return child.kill(signal);
      } catch (error) {
        return false;
      }
      return false;
    };
    killTarget("SIGTERM");
    state.killTimer = setTimeout(() => {
      if (state.finished) return;
      if (state.exitInfo) return;
      killTarget("SIGKILL");
      if (typeof onGaveUp === "function") onGaveUp();
    }, graceMs);
    if (this.deps.unrefHandles !== false && state.killTimer && typeof state.killTimer.unref === "function") state.killTimer.unref();
  }

  // Stop is offered only for runs this instance spawned and still tracks.
  stop(runId) {
    const live = this.live.get(runId);
    if (!live || !live.state || live.state.finished) return { ok: false, reason: "run is not active" };
    const state = live.state;
    state.stoppedByUser = true;
    this.killProcessGroup(state, () => {
      if (state.finished) return;
      state.exitInfo = state.exitInfo || { code: null, signal: "SIGKILL" };
      this.drainTails(state);
      this.finalizeLiveRun(runId, state);
    }, this.deps.stopKillGraceMs);
    return { ok: true, runId };
  }

  classifySpawnError(spec, kind, error, state) {
    if (state) {
      state.finished = true;
      this.clearStateTimers(state);
      this.closeStateFds(state);
    }
    const tried = (spec.resolution && spec.resolution.tried) || [];
    const message = error && error.message ? String(error.message) : String(error || "");
    const notFound = !error || (error && (error.code === "ENOENT" || /ENOENT/i.test(message)));
    const classification = cmClassifyRun({
      spawnError: true,
      spawnNotFound: notFound,
      spawnMessage: message,
      triedPaths: tried,
      stdoutText: "",
      stderrText: "",
      exitHints: (spec.entry && spec.entry.exit_codes) || [],
      adapterId: spec.entry && spec.entry.adapter,
      run: spec.record,
      budgetSecs: spec.budgetSecs,
    });
    this.finishWithClassification(spec, kind, state, {
      exit_code: null, signal: null, outcome: classification.outcome, summary: classification.summary,
    });
  }

  finishSpawnError(spec, kind, result) {
    const live = this.live.get(spec.record.id);
    if (live) {
      for (const waiter of live.waiters.splice(0)) {
        try {
          waiter(result);
        } catch (error) {
          // A waiter must never break finalization.
        }
      }
      this.live.delete(spec.record.id);
    }
    try {
      spec.settleResolve(result);
    } catch (error) {
      // Settle exactly once.
    }
    this.releaseSlot(kind);
  }

  finalizeLiveRun(runId, state) {
    if (state.finished) return;
    state.finished = true;
    this.clearStateTimers(state);
    if (state.stdoutDecoder || state.stderrDecoder) {
      const outChunks = [];
      const errChunks = [];
      this.flushDecoder(state.stdoutDecoder, outChunks);
      this.flushDecoder(state.stderrDecoder, errChunks);
      const outRest = outChunks.join("");
      const errRest = errChunks.join("");
      if (outRest && !state.truncated) state.stdout += outRest;
      if (errRest && !state.truncated) state.stderr += errRest;
    }
    this.closeStateFds(state);
    const { spec, kind } = state;
    const { record } = spec;
    const fsModule = this.fs();
    let receipt = null;
    if (spec.features.includes(CM_FEATURE_RECEIPT)) {
      receipt = cmReadReceipt(fsModule, spec.paths.receipt);
    }
    const exitCode = receipt && typeof receipt.exit_code === "number"
      ? receipt.exit_code
      : (state.exitInfo && typeof state.exitInfo.code === "number" ? state.exitInfo.code : null);
    const signal = state.exitInfo && state.exitInfo.signal ? state.exitInfo.signal : null;
    const classification = cmClassifyRun({
      exitCode,
      signal,
      timedOut: state.timedOut,
      stoppedByUser: state.stoppedByUser,
      stdoutText: state.stdout,
      stderrText: state.stderr,
      exitHints: (spec.entry && spec.entry.exit_codes) || [],
      adapterId: spec.entry && spec.entry.adapter,
      run: record,
      budgetSecs: spec.budgetSecs,
    });
    const finished = {
      exit_code: exitCode, signal, outcome: classification.outcome, summary: classification.summary,
    };
    if (classification.retry) finished.retry = true;
    if (classification.carry !== undefined) finished.carry = classification.carry;
    if (Array.isArray(classification.actions)) finished.actions = classification.actions;
    this.finishWithClassification(spec, kind, state, finished);
  }

  finishWithClassification(spec, kind, state, result) {
    const { record } = spec;
    const nowMs = this.deps.nowMs();
    record.finished_at = cmIsoNow(nowMs);
    try {
      const started = Date.parse(record.started_at);
      record.duration_ms = Number.isFinite(started) ? Math.max(0, nowMs - started) : null;
    } catch (error) {
      record.duration_ms = null;
    }
    record.exit_code = result.exit_code;
    record.signal = result.signal;
    record.outcome = result.outcome;
    record.summary = result.summary;
    if (result.retry) record.retry = true;
    if (result.carry !== undefined) record.carry = result.carry;
    if (Array.isArray(result.actions)) record.actions = result.actions;
    if (state) {
      if (state.stdoutDecoder || state.stderrDecoder || state.stdout || state.stderr) {
        record.summary = result.summary;
      }
    }
    this.persistRecord(record);
    try {
      cmRetentionSweep(this.fs(), this.runsDir(), {
        keepRuns: this.deps.keepRuns, keepDays: this.deps.keepDays, nowMs,
      });
    } catch (error) {
      // Retention never blocks finalization.
    }
    const settlement = {
      ok: result.outcome === "completed",
      runId: record.id,
      outcome: result.outcome,
      exitCode: result.exit_code,
    };
    if (result.outcome !== "completed") settlement.reason = result.summary;
    const live = this.live.get(record.id);
    // Notify the UI only when this instance is still loaded; the record and
    // receipt already carry the truth across a reload. Retry/carry/actions ride
    // the notice (not the record) for the feedback phase's buttons.
    const notice = {
      ...settlement,
      record: { ...record },
      entryId: record.entry_id,
      effect: record.effect,
      invalidates: this.entryInvalidates(spec.entry),
    };
    if (result.retry) notice.retry = true;
    if (result.carry !== undefined) notice.carry = result.carry;
    if (Array.isArray(result.actions)) notice.actions = result.actions;
    try {
      this.deps.notify(notice);
    } catch (error) {
      // Notification must never break finalization.
    }
    try {
      this.deps.fireEvent(CM_RUN_FINISHED_EVENT, {
        runId: record.id,
        argv: [...record.argv],
        entryId: record.entry_id,
        outcome: result.outcome,
        effect: record.effect,
        invalidates: this.entryInvalidates(spec.entry),
      });
    } catch (error) {
      // Event delivery must never break finalization.
    }
    if (live) {
      for (const waiter of live.waiters.splice(0)) {
        try {
          waiter(settlement);
        } catch (error) {
          // A waiter must never break finalization.
        }
      }
      this.live.delete(record.id);
    } else {
      try {
        spec.settleResolve(settlement);
      } catch (error) {
        // Settle exactly once.
      }
    }
    this.releaseSlot(kind);
  }

  entryInvalidates(entry) {
    if (!entry || !Array.isArray(entry.invalidates)) return [];
    return entry.invalidates.filter((tag) => typeof tag === "string");
  }

  clearStateTimers(state) {
    for (const key of ["tailTimer", "budgetTimer", "killTimer"]) {
      const timer = state[key];
      if (timer) {
        try {
          clearTimeout(timer);
          if (typeof timer === "object" && typeof timer.unref !== "function") clearInterval(timer);
        } catch (error) {
          // Timers are best effort on teardown.
        }
        state[key] = null;
      }
    }
  }

  closeStateFds(state) {
    const fsModule = this.fs();
    for (const key of ["outFd", "errFd"]) {
      const fd = state[key];
      if (typeof fd === "number" && fd >= 0) {
        try {
          fsModule.closeSync(fd);
        } catch (error) {
          // Already closed.
        }
        state[key] = -1;
      }
    }
  }

  // Adopt records left unfinished by a previous instance. Runs already
  // finished (receipt present) finalize silently; the rest poll the receipt
  // until it appears or the unknown deadline passes. PIDs are never trusted.
  adoptUnfinished(options = {}) {
    const fsModule = this.fs();
    const runsDir = this.runsDir();
    const catalog = this.catalog();
    const records = cmListRecords(fsModule, runsDir).filter((record) => cmIsUnfinishedOutcome(record.outcome));
    const results = [];
    for (const record of records) {
      const entry = record.entry_id ? cmEntryById(catalog, record.entry_id) : cmFindEntryForArgv(catalog, record.argv);
      const paths = cmRunFilePaths(runsDir, record.id, this.deps.path);
      const budgetSecs = Number((entry && entry.budget_secs) || (record.effect === "reads" ? 60 : 180)) || 60;
      const receipt = cmReadReceipt(fsModule, paths.receipt);
      if (receipt) {
        const finished = this.finalizeAdoptedRecord(record, entry, paths, {
          exit_code: receipt.exit_code, signal: null,
        }, { silent: true });
        results.push({ runId: finished.id, outcome: finished.outcome, silent: true });
        continue;
      }
      const deadline = cmAdoptionDeadlineMs(record, budgetSecs);
      const nowMs = this.deps.nowMs();
      if (deadline !== null && nowMs >= deadline) {
        this.finalizeAdoptedRecord(record, entry, paths, { exit_code: null, signal: null, unknown: true }, {});
        results.push({ runId: record.id, outcome: "unknown" });
        continue;
      }
      const timer = setInterval(() => {
        const late = cmReadJsonFile(fsModule, paths.json);
        if (!late || !cmIsUnfinishedOutcome(late.outcome)) {
          clearInterval(timer);
          this.adoptTimers.delete(timer);
          return;
        }
        const lateReceipt = cmReadReceipt(fsModule, paths.receipt);
        if (lateReceipt) {
          clearInterval(timer);
          this.adoptTimers.delete(timer);
          this.finalizeAdoptedRecord(late, entry, paths, { exit_code: lateReceipt.exit_code, signal: null }, {});
          return;
        }
        if (deadline !== null && this.deps.nowMs() >= deadline) {
          clearInterval(timer);
          this.adoptTimers.delete(timer);
          this.finalizeAdoptedRecord(late, entry, paths, { exit_code: null, signal: null, unknown: true }, {});
        }
      }, this.deps.adoptPollMs);
      if (this.deps.unrefHandles !== false && timer && typeof timer.unref === "function") timer.unref();
      this.adoptTimers.add(timer);
      results.push({ runId: record.id, outcome: "adopted" });
    }
    return results;
  }

  finalizeAdoptedRecord(record, entry, paths, result, options = {}) {
    const fsModule = this.fs();
    let stdoutText = "";
    let stderrText = "";
    try {
      stdoutText = fsModule.readFileSync(paths.out, "utf8");
    } catch (error) {
      stdoutText = "";
    }
    try {
      stderrText = fsModule.readFileSync(paths.err, "utf8");
    } catch (error) {
      stderrText = "";
    }
    const classification = result.unknown
      ? { outcome: "unknown", summary: "Unknown — log preserved" }
      : cmClassifyRun({
        exitCode: result.exit_code,
        signal: result.signal,
        stdoutText: cmStripTailForClassification(stdoutText),
        stderrText: cmStripTailForClassification(stderrText),
        exitHints: (entry && entry.exit_codes) || [],
        adapterId: entry && entry.adapter,
        run: record,
        budgetSecs: (entry && entry.budget_secs) || (record.effect === "reads" ? 60 : 180),
      });
    const finished = cmReadJsonFile(fsModule, paths.json) || record;
    finished.finished_at = finished.finished_at || cmIsoNow(this.deps.nowMs());
    try {
      const started = Date.parse(finished.started_at);
      const done = Date.parse(finished.finished_at);
      finished.duration_ms = Number.isFinite(started) && Number.isFinite(done) ? Math.max(0, done - started) : null;
    } catch (error) {
      finished.duration_ms = null;
    }
    finished.exit_code = result.exit_code;
    finished.signal = result.signal;
    finished.outcome = classification.outcome;
    finished.summary = classification.summary;
    if (classification.retry) finished.retry = true;
    if (classification.carry !== undefined) finished.carry = classification.carry;
    if (Array.isArray(classification.actions)) finished.actions = classification.actions;
    try {
      cmWriteRecord(fsModule, this.runsDir(), finished);
    } catch (error) {
      // Best effort on a damaged store.
    }
    if (options.silent) return finished;
    const settlement = {
      ok: classification.outcome === "completed",
      runId: finished.id,
      outcome: classification.outcome,
      exitCode: result.exit_code,
    };
    if (classification.outcome !== "completed") settlement.reason = classification.summary;
    // A run that failed while Obsidian was closed gets one summary notice.
    if (classification.outcome === "failed" || classification.outcome === "unknown") {
      try {
        this.deps.notify({
          ...settlement,
          record: { ...finished },
          entryId: finished.entry_id,
          effect: finished.effect,
          invalidates: this.entryInvalidates(entry),
          ...(classification.retry ? { retry: true } : {}),
          ...(classification.carry !== undefined ? { carry: classification.carry } : {}),
          ...(Array.isArray(classification.actions) ? { actions: classification.actions } : {}),
        });
      } catch (error) {
        // Notification must never break adoption.
      }
    }
    try {
      this.deps.fireEvent(CM_RUN_FINISHED_EVENT, {
        runId: finished.id,
        argv: Array.isArray(finished.argv) ? [...finished.argv] : [],
        entryId: finished.entry_id,
        outcome: classification.outcome,
        effect: finished.effect,
        invalidates: this.entryInvalidates(entry),
      });
    } catch (error) {
      // Event delivery must never break adoption.
    }
    return finished;
  }

  newestRecord() {
    const records = cmListRecords(this.fs(), this.runsDir());
    return records.length > 0 ? records[records.length - 1] : null;
  }

  activeRecords() {
    return [...this.live.values()]
      .map((live) => live && live.record)
      .filter((record) => record && (record.outcome === "queued" || record.outcome === "running"));
  }

  dispose() {
    for (const timer of this.adoptTimers) {
      try {
        clearInterval(timer);
      } catch (error) {
        // Best effort.
      }
    }
    this.adoptTimers.clear();
  }
}

function isReads(record) {
  return record && record.effect === "reads";
}

// Adoption reads whole files; classification only needs the meaningful edges,
// so cap the text to keep a huge log from stalling load.
function cmStripTailForClassification(text) {
  const value = String(text || "");
  if (value.length <= 256 * 1024) return value;
  return value.slice(0, 128 * 1024) + "\n…\n" + value.slice(-128 * 1024);
}
