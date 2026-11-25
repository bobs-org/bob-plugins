// Guarded editor adapter for task settle (bob-cli-q4.8.1.2 editor-apply).
// Follows the versioned-namespace shape of `174-plugin-task-merge-api.js`.
// The frozen `taskSettle` v1 object is built here but is NOT published on
// `this.api` until pending-api lands schedulePending/flushPending.

const TASK_SETTLE_API_VERSION = 1;

class BobLedgerToolsTaskSettleMixin {
  taskSettleCaptureContext(options = {}) {
    return taskSettleCaptureContext(this.app, options);
  }

  taskSettleApplyToEditor(editor, path, options = {}) {
    return taskSettleApplyToEditor(editor, path, options, this);
  }

  // Built for pending-api to publish; unpublished on the root api in this phase.
  taskSettleApi() {
    if (!this.taskSettleApiValue) {
      const plugin = this;
      this.taskSettleApiValue = Object.freeze({
        version: TASK_SETTLE_API_VERSION,
        applyToEditor: (editor, path, options) =>
          plugin.taskSettleApplyToEditor(editor, path, options),
        settleNote: (request) => plugin.taskSettleNote(request),
      });
    }
    return this.taskSettleApiValue;
  }

  taskSettleNote(request) {
    const req = request && typeof request === "object" ? request : {};
    const context = this.taskSettleCaptureContext({
      today: req.today,
      dailyPath: req.dailyPath,
      tasksSettings: req.tasksSettings,
      now: req.now,
    });
    return taskSettleNote(
      normalizeVaultPath(req.path),
      String(req.contents == null ? "" : req.contents),
      context.today,
      context.classification,
      context.dailyPath,
    );
  }
}
