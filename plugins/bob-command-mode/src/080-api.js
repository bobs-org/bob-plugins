// Bob Command Mode: api.commandMode v1 for other plugins.

function cmApiSubscribe(runner, eventName, callback) {
  if (typeof callback !== "function") return () => {};
  const subscribe = runner && runner.deps && runner.deps.onWorkspaceEvent;
  if (typeof subscribe !== "function") return () => {};
  try {
    return subscribe(eventName, callback) || (() => {});
  } catch (error) {
    return () => {};
  }
}

function cmApiActiveRunRecord(record) {
  if (!record || !record.id) return null;
  return {
    runId: String(record.id),
    argv: Array.isArray(record.argv) ? [...record.argv] : [],
    entryId: record.entry_id || null,
    outcome: record.outcome || null,
    trigger: record.trigger || null,
    source: cmCopyRunSource(record.source),
    startedAt: record.started_at || null,
    sequence: record.sequence ? cmCopySequenceStamp(record.sequence) : null,
  };
}

// Legacy text-form lookup, kept for the shipped activeRun(text) shape.
function cmApiActiveRunForSteps(runner, steps, options = {}) {
  return cmApiActiveLegacy(cmApiFindActive(runner, cmSequenceSignature(steps), options));
}

function cmApiTextStepRow(step, catalog) {
  const stored = cmSequenceStep(step);
  const entry = cmSequenceLookupEntry(stored, catalog);
  if (!entry) return null;
  return {
    kind: "entry",
    entryId: entry.id,
    title: entry.title || entry.id,
    argv: [...stored.argv],
    basePath: [...(entry.path || [])],
    userArgs: stored.argv.slice((entry.path || []).length),
    required: [],
    policy: cmNormalizePolicy(entry.policy),
    hasPreview: Boolean(Array.isArray(entry.preview) && entry.preview.length),
    presentation: cmNormalizePresentation(entry.presentation),
    confirm: entry.policy === "confirm" ? String(entry.confirm || "") : null,
    effect: cmNormalizeEffect(entry.effect),
  };
}

// Open the guarded path for resolved steps. Card stages settle
// {ok, stage: "confirm" | "review", outcome: "opened", runId: null} without
// any run; a report runs for real (stage "output") and reports through
// onState; a preview settles the dry run's own result with stage "preview".
async function cmApiOpenResolvedText(runner, hooks, resolved, options = {}) {
  let catalog = null;
  try { catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null; }
  catch (error) { catalog = null; }
  const plan = options.plan || cmPlanActivation(resolved.steps, catalog, { intent: "open" });
  if (!plan.ok) return { ok: false, outcome: "refused", stage: "refused", reason: plan.reason || "could not plan command" };
  const refuse = (reason) => ({ ok: false, outcome: "refused", stage: "refused", runId: null, reason: String(reason) });
  if (typeof hooks.openSheet !== "function") return refuse("no command sheet");
  let opened;
  try {
    opened = await Promise.resolve(hooks.openSheet());
  } catch (error) {
    return refuse(cmApiErrorReason(error, "sheet failed to open"));
  }
  if (!opened || opened.ok === false) return refuse((opened && opened.reason) || "sheet failed to open");
  let sheet = null;
  try { sheet = typeof hooks.getSheet === "function" ? hooks.getSheet() : null; }
  catch (error) { sheet = null; }
  if (!sheet) return refuse("no command sheet");
  const source = cmCopyRunSource(options.source);
  if (plan.action === "review") {
    cmSheetSequenceShowReview(sheet, plan.steps, plan.guards, { trigger: "chip", source });
    return {
      ok: true,
      stage: plan.steps.length > 1 ? "review" : "confirm",
      outcome: "opened",
      runId: null,
      sequenceId: null,
      steps: plan.steps,
      guards: plan.guards,
    };
  }
  const step = plan.steps[0];
  const row = cmApiTextStepRow(step, catalog);
  if (!row) return refuse("unknown command");
  if (plan.action === "preview") {
    if (typeof sheet.runPreview !== "function") return refuse("no command sheet");
    const previewed = await sheet.runPreview(row, step.argv, { trigger: "chip", source });
    return { ...(previewed || { ok: false, reason: "preview failed to start" }), stage: "preview" };
  }
  if (plan.action === "report") {
    if (typeof sheet.runReport !== "function") return refuse("no command sheet");
    const emit = cmApiStateEmitter(options.onState, {
      kind: "run", signature: resolved.signature, sequenceId: null, total: 1,
    });
    let settled;
    try {
      settled = await sheet.runReport(row, step.argv, {
        trigger: "chip", source, onState: cmApiRunStateForwarder(emit),
      });
    } catch (error) {
      settled = { ok: false, runId: null, outcome: "failed", reason: cmApiErrorReason(error, "report failed") };
    }
    const result = { ...(settled || { ok: false, runId: null, outcome: "failed", reason: "report failed to start" }) };
    if (!result.outcome) result.outcome = result.ok ? "completed" : "failed";
    if (emit) emit(cmApiFinishedPayload(result, 1));
    return { ...result, stage: "output", sequenceId: null };
  }
  return refuse("command could not be opened");
}

function cmCreateApi(runner, options = {}) {
  const openOutput = options.openOutput || null;
  const openSheet = options.openSheet || null;
  const getSheet = options.getSheet || null;
  const hooks = {
    openOutput,
    openSheet,
    getSheet,
    runSequence: options.runSequence || null,
    activeSequences: options.activeSequences || null,
    catalogLoad: options.catalogLoad || null,
    catalogInfo: options.catalogInfo || null,
    catalogWaitMs: options.catalogWaitMs,
  };
  const catalogStatus = () => {
    try { return typeof hooks.catalogInfo === "function" ? (hooks.catalogInfo() || {}).status : null; }
    catch (error) { return null; }
  };
  const api = {
    version: CM_API_VERSION,
    // Run bob argv under the same guards as the sheet. Settles
    // {ok, runId, outcome, exitCode, reason?} and never rejects.
    run(argv, runOpts = {}) {
      const refused = (error) => ({
        ok: false,
        runId: null,
        outcome: "failed",
        exitCode: null,
        reason: String((error && error.message) || error || "run failed"),
      });
      let pending;
      try {
        pending = runner.run(argv, { trigger: "api", ...(runOpts || {}) });
      } catch (error) {
        return Promise.resolve(refused(error));
      }
      return Promise.resolve(pending).catch(refused);
    },
    // Parse one chip payload into catalog-legal bob steps. Pure, synchronous,
    // and frozen: {ok, state, signature, steps, reason, step}. Never spawns
    // and never starts a catalog load.
    resolve(text) {
      try {
        return cmResolveCommandText(runner && typeof runner.catalog === "function" ? runner.catalog() : null, text, {
          host: runner && runner.host,
          catalogStatus: catalogStatus(),
        });
      } catch (error) {
        return cmResolveFailure("invalid", cmApiErrorReason(error, "command could not be resolved"), null);
      }
    },
    // Run a validated command chip now. Only {source, onState} are read; the
    // trigger is always "chip", preview-first is skipped, and confirm is
    // always reviewed. Settles {ok, stage, outcome, runId, sequenceId, reason?}.
    async runText(text, runOpts = {}) {
      const opts = runOpts && typeof runOpts === "object" ? runOpts : {};
      const source = cmCopyRunSource(opts.source);
      const onState = typeof opts.onState === "function" ? opts.onState : null;
      try {
        const resolved = await cmApiResolveForActivation(api, hooks, text);
        if (!resolved.ok) return cmApiRefusal(resolved);
        const catalog = api.catalog();
        const plan = cmPlanActivation(resolved.steps, catalog, { intent: "chip" });
        if (!plan.ok) return cmApiRefusal({ state: "invalid", reason: plan.reason });
        let found = null;
        try { found = cmApiFindActive(runner, resolved.signature, hooks); }
        catch (error) { found = null; }
        if (found) return await cmApiOpenActive(found, hooks);
        if (plan.action === "review" || plan.action === "report") {
          return await cmApiOpenResolvedText(runner, hooks, resolved, { source, onState, plan });
        }
        if (resolved.steps.length === 1) return await cmApiRunResolvedStep(runner, resolved, catalog, { source, onState });
        return await cmApiRunResolvedSequence(runner, hooks, resolved, catalog, { source, onState });
      } catch (error) {
        return { ok: false, outcome: "failed", stage: "refused", runId: null, sequenceId: null, reason: cmApiErrorReason(error, "command could not run") };
      }
    },
    // Open the guarded sheet path for a text payload. Single reports open
    // output, preview-first commands show their preview, and writers review.
    async openText(text, openOpts = {}) {
      const opts = openOpts && typeof openOpts === "object" ? openOpts : {};
      try {
        const resolved = await cmApiResolveForActivation(api, hooks, text);
        if (!resolved.ok) return cmApiRefusal(resolved);
        return await cmApiOpenResolvedText(runner, hooks, resolved, {
          source: opts.source,
          onState: typeof opts.onState === "function" ? opts.onState : null,
        });
      } catch (error) {
        return { ok: false, outcome: "refused", stage: "refused", runId: null, reason: cmApiErrorReason(error, "command could not be opened") };
      }
    },
    // activeRun(signature) -> frozen {kind, state, runId, sequenceId, step,
    // total, ...} or null. activeRun(text) keeps the shipped record shape.
    activeRun(signatureOrText) {
      try {
        if (cmApiIsSignature(signatureOrText)) {
          return cmApiActiveView(cmApiFindActive(runner, signatureOrText, hooks));
        }
        const resolved = api.resolve(signatureOrText);
        if (!resolved.ok) return null;
        return cmApiActiveLegacy(cmApiFindActive(runner, resolved.signature, hooks));
      } catch (error) {
        return null;
      }
    },
    // Frozen {state, status, ready, loading, fingerprint, generation, token};
    // token changes whenever cached chip verdicts must be dropped.
    catalogInfo() {
      let info = {};
      try { info = (typeof hooks.catalogInfo === "function" ? hooks.catalogInfo() : null) || {}; }
      catch (error) { info = {}; }
      const ready = Boolean(api.catalog());
      const status = info.status ? String(info.status) : (ready ? "ready" : "empty");
      const generation = Number(info.generation) || (ready ? 1 : 0);
      const fingerprint = info.fingerprint ? String(info.fingerprint) : null;
      return Object.freeze({
        state: ready ? "ready" : (cmCatalogUnavailableReason(status) ? "unavailable" : "loading"),
        status,
        ready,
        loading: Boolean(info.loading),
        fingerprint,
        generation,
        token: info.token ? String(info.token) : generation + ":" + (fingerprint || ""),
      });
    },
    activeRuns() {
      try {
        const records = runner && typeof runner.activeRecords === "function" ? runner.activeRecords() : [];
        return (Array.isArray(records) ? records : []).map(cmApiActiveRunRecord).filter(Boolean);
      } catch (error) {
        return [];
      }
    },
    // Open a run's output in the pager.
    openOutput(runId) {
      if (typeof openOutput === "function") {
        try {
          return Promise.resolve(openOutput(runId));
        } catch (error) {
          return Promise.resolve({ ok: false, reason: String((error && error.message) || error) });
        }
      }
      return Promise.resolve({ ok: false, reason: "no output view yet" });
    },
    // Open the command sheet straight into argv's preview stage (or, for a
    // report row, its output stage). Never applies a write and never rejects.
    // Settles {ok, runId, stage: "preview" | "report"} or {ok: false, reason}.
    preview(argv, previewOpts = {}) {
      void previewOpts;
      return cmApiPreview(runner, { openSheet, getSheet }, argv);
    },
    onRunStarted(callback) {
      return cmApiSubscribe(runner, CM_RUN_STARTED_EVENT, callback);
    },
    onRunState(callback) {
      return cmApiSubscribe(runner, CM_RUN_STATE_EVENT, callback);
    },
    // Subscribe to finished runs. Returns an unsubscribe function.
    onRunFinished(callback) {
      return cmApiSubscribe(runner, CM_RUN_FINISHED_EVENT, callback);
    },
    // Fires on the first usable catalog and on every content or binary
    // fingerprint change: {catalog, bobVersion, fingerprint, generation,
    // token, reason}. Returns an unsubscribe function.
    onCatalogChanged(callback) {
      return cmApiSubscribe(runner, CM_CATALOG_CHANGED_EVENT, callback);
    },
    catalog() {
      try {
        return runner.catalog();
      } catch (error) {
        return null;
      }
    },
    lastRun() {
      try {
        const record = runner.newestRecord();
        if (!record) return null;
        return {
          runId: record.id,
          argv: Array.isArray(record.argv) ? [...record.argv] : [],
          entryId: record.entry_id || null,
          outcome: record.outcome || null,
          exitCode: typeof record.exit_code === "number" ? record.exit_code : null,
          summary: record.summary || null,
          finishedAt: record.finished_at || null,
          trigger: record.trigger || null,
          source: cmCopyRunSource(record.source),
        };
      } catch (error) {
        return null;
      }
    },
  };
  return Object.freeze(api);
}

async function cmApiPreview(runner, hooks, argv) {
  const refuse = (reason) => ({ ok: false, reason: String(reason) });
  try {
    const words = Array.isArray(argv) ? argv.map(String) : [];
    if (!words.length) return refuse("no command given");
    const catalog = runner.catalog();
    if (!catalog) return refuse("catalog unavailable");
    const entry = cmFindEntryForArgv(catalog, words);
    if (!entry) return refuse("unknown command");
    const excluded = cmExcludedReason(catalog, words);
    if (excluded) return refuse(excluded);
    if (runner.deps && runner.deps.isWin32) return refuse("Bob command mode supports Linux and macOS");
    const row = cmSheetEntryRows(catalog, runner.host).find((candidate) => candidate.entryId === entry.id);
    if (!row) return refuse("unknown command");
    if (row.unavailable) return refuse(row.unavailable);
    const hasPreview = Boolean(row.hasPreview);
    // A row with neither a preview nor a report would apply, so refuse it.
    if (!hasPreview && row.presentation !== "report") return refuse("no preview for this command");
    if (typeof hooks.openSheet !== "function") return refuse("no command sheet");
    const opened = hooks.openSheet();
    if (!opened || opened.ok === false) return refuse((opened && opened.reason) || "sheet failed to open");
    const sheet = typeof hooks.getSheet === "function" ? hooks.getSheet() : null;
    if (!sheet || typeof sheet.runPreview !== "function") return refuse("no command sheet");
    const userArgs = words.slice(entry.path.length);
    const settled = await sheet.runPreview({ ...row, userArgs }, words);
    if (!settled || !settled.runId) return refuse((settled && settled.reason) || "preview failed to start");
    return { ok: true, runId: settled.runId, stage: hasPreview ? "preview" : "report" };
  } catch (error) {
    return refuse((error && error.message) || error || "preview failed");
  }
}

function cmCreateRootApi(commandMode) {
  return Object.freeze({ version: CM_API_VERSION, commandMode });
}
