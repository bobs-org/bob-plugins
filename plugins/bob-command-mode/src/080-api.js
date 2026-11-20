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

function cmApiActiveRunForSteps(runner, steps, options = {}) {
  const wanted = cmSequenceSignature(steps);
  if (!wanted) return null;
  let records = [];
  try {
    records = runner && typeof runner.activeRecords === "function" ? runner.activeRecords() : [];
  } catch (error) {
    records = [];
  }
  const active = (Array.isArray(records) ? records : []).filter((record) => record && (record.outcome === "queued" || record.outcome === "running"));
  for (const record of active) {
    const stamp = record.sequence;
    if (stamp && Array.isArray(stamp.steps) && cmSequenceSignature(stamp.steps) === wanted) {
      return {
        ...cmApiActiveRunRecord(record),
        sequenceId: stamp.id || null,
        step: Number(stamp.index) || null,
        total: Number(stamp.total) || stamp.steps.length,
      };
    }
  }
  if (typeof options.activeSequences === "function") {
    try {
      const sequences = options.activeSequences();
      const sequence = (Array.isArray(sequences) ? sequences : []).find((item) => (
        item && Array.isArray(item.steps) && cmSequenceSignature(item.steps) === wanted
      ));
      if (sequence) {
        const current = active.find((record) => record.sequence && record.sequence.id === sequence.id) || null;
        return {
          ...(cmApiActiveRunRecord(current) || {}),
          runId: current ? String(current.id) : null,
          outcome: "running",
          sequenceId: String(sequence.id || "") || null,
          step: Number(sequence.index) || null,
          total: Number(sequence.total) || sequence.steps.length,
        };
      }
    } catch (error) {
      // The sequence map is an optional plugin integration.
    }
  }
  if (!Array.isArray(steps) || steps.length !== 1) return null;
  const catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null;
  for (const record of active) {
    if (record.sequence) continue;
    const replay = cmReplayRun(record, catalog);
    const recorded = cmSequenceStep({ argv: replay.argv, entry_id: replay.entryId || record.entry_id });
    if (cmSequenceSignature([recorded]) === wanted) return cmApiActiveRunRecord(record);
  }
  return null;
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

async function cmApiOpenResolvedText(runner, hooks, resolved, options = {}) {
  let catalog = null;
  try { catalog = runner && typeof runner.catalog === "function" ? runner.catalog() : null; }
  catch (error) { catalog = null; }
  const plan = cmPlanActivation(resolved.steps, catalog, { intent: "open" });
  if (!plan.ok) return { ok: false, reason: plan.reason || "could not plan command" };
  if (typeof hooks.openSheet !== "function") return { ok: false, reason: "no command sheet" };
  let opened;
  try {
    opened = await Promise.resolve(hooks.openSheet());
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || error || "sheet failed to open") };
  }
  if (!opened || opened.ok === false) return { ok: false, reason: (opened && opened.reason) || "sheet failed to open" };
  let sheet = null;
  try { sheet = typeof hooks.getSheet === "function" ? hooks.getSheet() : null; }
  catch (error) { sheet = null; }
  if (!sheet) return { ok: false, reason: "no command sheet" };
  const source = cmCopyRunSource(options.source);
  if (plan.action === "review") {
    cmSheetSequenceShowReview(sheet, plan.steps, plan.guards, { trigger: "chip", source });
    return { ok: true, stage: "confirm", steps: plan.steps, guards: plan.guards };
  }
  const step = plan.steps[0];
  const row = cmApiTextStepRow(step, catalog);
  if (!row) return { ok: false, reason: "unknown command" };
  if (plan.action === "preview") {
    if (!sheet || typeof sheet.runPreview !== "function") return { ok: false, reason: "no command sheet" };
    return sheet.runPreview(row, step.argv, { trigger: "chip", source });
  }
  if (plan.action === "report") {
    if (!sheet || typeof sheet.runReport !== "function") return { ok: false, reason: "no command sheet" };
    return sheet.runReport(row, step.argv, { trigger: "chip", source });
  }
  return { ok: false, reason: "command could not be opened" };
}

function cmApiCreateResult(ok, reason) {
  return { ok: Boolean(ok), ...(reason ? { reason: String(reason) } : {}) };
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
    // Parse one chip payload into catalog-legal bob steps without throwing.
    resolve(text) {
      try {
        return cmResolveCommandText(runner && typeof runner.catalog === "function" ? runner.catalog() : null, text, {
          host: runner && runner.host,
        });
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error || "command could not be resolved") };
      }
    },
    // Run a validated command chip now. Preview-first is skipped; confirm is
    // always reviewed. Source is optional {path, line} provenance only.
    async runText(text, runOpts = {}) {
      const resolved = api.resolve(text);
      if (!resolved.ok) return cmApiCreateResult(false, resolved.reason);
      const source = cmCopyRunSource(runOpts && runOpts.source);
      const plan = cmPlanActivation(resolved.steps, api.catalog(), { intent: "chip" });
      if (!plan.ok) return cmApiCreateResult(false, plan.reason);
      let active = null;
      try { active = cmApiActiveRunForSteps(runner, resolved.steps, hooks); }
      catch (error) { active = null; }
      if (active) {
        if (active.runId && typeof hooks.openOutput === "function") {
          try { await Promise.resolve(hooks.openOutput(active.runId)); }
          catch (error) { /* Opening output never starts another run. */ }
        }
        return { ok: true, active: true, ...active };
      }
      if (plan.action === "review" || plan.action === "report") {
        try { return await cmApiOpenResolvedText(runner, hooks, resolved, { source }); }
        catch (error) { return { ok: false, reason: String((error && error.message) || error || "command could not be opened") }; }
      }
      if (resolved.steps.length === 1) {
        const step = resolved.steps[0];
        const entry = cmSequenceLookupEntry(step, api.catalog());
        try {
          return await runner.run(step.argv, {
            entryId: entry && entry.id,
            title: (entry && entry.title) || step.title,
            trigger: "chip",
            source,
            skipGuards: true,
          });
        } catch (error) {
          return { ok: false, runId: null, outcome: "failed", reason: String((error && error.message) || error || "run failed") };
        }
      }
      try {
        const runOptions = { trigger: "chip", source };
        const summary = typeof hooks.runSequence === "function"
          ? await hooks.runSequence(resolved.steps, runOptions)
          : await cmRunSequence(runner, resolved.steps, runOptions);
        if (!summary) return { ok: false, outcome: "failed", reason: "sequence failed" };
        return {
          ...summary,
          ok: summary.outcome === "completed" || summary.outcome === "attention",
        };
      } catch (error) {
        return { ok: false, outcome: "failed", reason: String((error && error.message) || error || "sequence failed") };
      }
    },
    // Open the guarded sheet path for a text payload. Single reports open
    // output, preview-first commands show their preview, and writers review.
    async openText(text, openOpts = {}) {
      const resolved = api.resolve(text);
      if (!resolved.ok) return cmApiCreateResult(false, resolved.reason);
      try {
        return await cmApiOpenResolvedText(runner, hooks, resolved, { source: openOpts && openOpts.source });
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error || "command could not be opened") };
      }
    },
    // Find the live run (or active sequence step) for this payload.
    activeRun(text) {
      const resolved = api.resolve(text);
      if (!resolved.ok) return null;
      try { return cmApiActiveRunForSteps(runner, resolved.steps, hooks); }
      catch (error) { return null; }
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
