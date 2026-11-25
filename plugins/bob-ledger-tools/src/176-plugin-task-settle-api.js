// Complete public task settle provider (bob-cli-q4.8.1.3 pending-api).
// Follows the versioned-namespace shape of `174-plugin-task-merge-api.js`.
// The complete frozen taskSettle v1 namespace is published by the root API.

const TASK_SETTLE_API_VERSION = 1;

class BobLedgerToolsTaskSettleMixin {
  taskSettleCaptureContext(options = {}) {
    return taskSettleCaptureContext(this.app, options);
  }

  taskSettleApplyToEditor(editor, path, options = {}) {
    return taskSettleApplyToEditor(editor, path, options, this);
  }

  taskSettleApi() {
    if (!this.taskSettleApiValue) {
      const plugin = this;
      this.taskSettleApiValue = Object.freeze({
        version: TASK_SETTLE_API_VERSION,
        applyToEditor: (editor, path, options) =>
          plugin.taskSettleApplyToEditor(editor, path, options),
        settleNote: (request) => plugin.taskSettleNote(request),
        schedulePending: (request) => plugin.taskSettleSchedulePending(request),
        flushPending: () => plugin.taskSettleFlushPending(),
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
