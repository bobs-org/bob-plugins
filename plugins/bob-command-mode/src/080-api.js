// Bob Command Mode: api.commandMode v1 for other plugins.

function cmCreateApi(runner, options = {}) {
  const openOutput = options.openOutput || null;
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

function cmCreateRootApi(commandMode) {
  return Object.freeze({ version: CM_API_VERSION, commandMode });
}
