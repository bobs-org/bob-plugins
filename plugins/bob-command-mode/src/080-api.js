// Bob Command Mode: api.commandMode v1 for other plugins.

function cmCreateApi(runner, options = {}) {
  const openOutput = options.openOutput || null;
  const openSheet = options.openSheet || null;
  const getSheet = options.getSheet || null;
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
    // Subscribe to finished runs. Returns an unsubscribe function.
    onRunFinished(callback) {
      if (typeof callback !== "function") return () => {};
      if (typeof runner.deps.onWorkspaceEvent !== "function") return () => {};
      try {
        return runner.deps.onWorkspaceEvent(CM_RUN_FINISHED_EVENT, callback) || (() => {});
      } catch (error) {
        return () => {};
      }
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
