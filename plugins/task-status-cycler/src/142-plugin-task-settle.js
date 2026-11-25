// Call-time taskSettle consumer bridge (bob-cli-q4.9.1.1 settle-bridge and
// q4.9.1.4 cycle-settle). Looks up ledger-tools at each call, flushes pending
// work, applies a guarded staged or live-buffer settle, settles a pure target
// buffer, snapshots identity, and records the stay-cursor jump exactly once.

const TASK_SETTLE_WRITE_POLICY = Object.freeze({
  immediate: "immediate",
  deferred: "deferred",
  none: "none",
});

function normalizeTaskSettleWritePolicy(policy) {
  if (policy === TASK_SETTLE_WRITE_POLICY.immediate) return TASK_SETTLE_WRITE_POLICY.immediate;
  if (policy === TASK_SETTLE_WRITE_POLICY.deferred) return TASK_SETTLE_WRITE_POLICY.deferred;
  return TASK_SETTLE_WRITE_POLICY.none;
}

function snapshotTaskSettleIdentity(lineText, line, extra = {}) {
  const extraObj = extra && typeof extra === "object" ? extra : {};
  const text = extraObj.text != null
    ? String(extraObj.text)
    : (lineText == null ? null : String(lineText));
  let blockId = extraObj.blockId;
  if (blockId == null && text != null && typeof getTrailingBlockId === "function") {
    blockId = getTrailingBlockId(text);
  }
  if (typeof blockId === "string") {
    blockId = blockId.trim();
    if (!blockId) blockId = null;
  } else {
    blockId = null;
  }
  const hinted = Number.isInteger(line)
    ? line
    : (Number.isInteger(extraObj.line) ? extraObj.line : null);
  return {
    ...(blockId ? { blockId } : {}),
    ...(hinted != null ? { line: hinted } : {}),
    ...(text != null ? { text } : {}),
  };
}

function taskSettleJumpKey(path, generation, result) {
  if (generation != null) return `${String(path || "")}\u0000${generation}`;
  const target = result && result.jumpTarget;
  const line = target && Number.isInteger(target.line) ? target.line : "";
  const ch = target && Number.isInteger(target.ch) ? target.ch : "";
  return `${String(path || "")}\u0000imm:${line}:${ch}`;
}

class TaskStatusCyclerTaskSettleMixin {
  resolveTaskSettleApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const settle = holder && holder.api && holder.api.taskSettle;
      if (!settle || settle.version !== 1) return null;
      if (typeof settle.applyToEditor !== "function") return null;
      return settle;
    } catch (_error) {
      return null;
    }
  }

  taskSettleWritePolicy(policy) {
    return normalizeTaskSettleWritePolicy(policy);
  }

  taskSettleIdentityAtEditorLine(editor, line, extra = {}) {
    if (!editor || typeof editor.getLine !== "function" || !Number.isInteger(line)) {
      return null;
    }
    let lineText = null;
    try {
      lineText = editor.getLine(line);
    } catch (_error) {
      lineText = null;
    }
    if (typeof lineText !== "string") return null;
    return this.snapshotTaskSettleIdentity(lineText, line, extra);
  }

  scheduleTaskCycleSettle(editor, path, identity) {
    if (!editor || !path || !identity || this.taskSettleShuttingDown) {
      return { scheduled: false, reason: "context" };
    }
    const livePath = this.taskSettleLiveEditorPath(editor);
    if (livePath && livePath !== path) {
      return { scheduled: false, reason: "path" };
    }
    return this.schedulePendingTaskSettle({ editor, path, identity });
  }

  flushPendingTaskSettleBeforeCommand(editor, checking = false) {
    if (checking === true || this.taskSettleShuttingDown) return [];
    return this.flushPendingTaskSettle({ editor });
  }

  runTaskSettleAwareCommand(checking, editor, callback) {
    this.flushPendingTaskSettleBeforeCommand(editor, checking);
    return typeof callback === "function" ? callback() : false;
  }

  snapshotTaskSettleIdentity(lineText, line, extra) {
    return snapshotTaskSettleIdentity(lineText, line, extra);
  }

  taskSettleLiveEditorPath(editor) {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace) return null;
      let match = null;
      const consider = (view) => {
        if (!view) return;
        if (editor && view.editor !== editor) return;
        const file = view.file;
        if (file && typeof file.path === "string") match = file.path;
      };
      if (typeof workspace.iterateAllLeaves === "function") {
        workspace.iterateAllLeaves((leaf) => consider(leaf && leaf.view));
        if (match) return match;
      }
      if (typeof workspace.getLeavesOfType === "function") {
        const leaves = workspace.getLeavesOfType("markdown") || [];
        for (const leaf of leaves) consider(leaf && leaf.view);
        if (match) return match;
      }
      if (typeof workspace.getActiveViewOfType === "function" && typeof MarkdownView !== "undefined") {
        consider(workspace.getActiveViewOfType(MarkdownView));
      }
      return match;
    } catch (_error) {
      return null;
    }
  }

  recordTaskSettleJump(from, to) {
    const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
    const api = plugins && plugins["bob-navigation-hotkeys"] && plugins["bob-navigation-hotkeys"].api;
    if (!api || typeof api.recordJump !== "function") return false;
    try {
      return api.recordJump(from, to) === true;
    } catch (_error) {
      return false;
    }
  }

  rememberTaskSettleJumpKey(key) {
    if (!key) return false;
    if (!Array.isArray(this.taskSettleRecordedJumpKeys)) this.taskSettleRecordedJumpKeys = [];
    if (this.taskSettleRecordedJumpKeys.includes(key)) return false;
    this.taskSettleRecordedJumpKeys.push(key);
    if (this.taskSettleRecordedJumpKeys.length > 64) this.taskSettleRecordedJumpKeys.shift();
    return true;
  }

  recordTaskSettleResultJump(path, generation, result, guard = {}) {
    if (
      this.taskSettleShuttingDown ||
      !result || result.applied !== true || !result.jumpTarget || !result.cursor
    ) return false;
    const expectedPath = guard.path || path;
    if (guard.generation != null && generation != null && guard.generation !== generation) {
      return false;
    }
    const editor = guard.editor;
    if (editor) {
      const livePath = this.taskSettleLiveEditorPath(editor);
      if (livePath && expectedPath && livePath !== expectedPath) return false;
    }
    const key = taskSettleJumpKey(expectedPath || path, generation, result);
    if (!this.rememberTaskSettleJumpKey(key)) return false;
    const jumpTarget = result.jumpTarget;
    // recordJump(from, to): Ctrl+O returns to `from`. Stay keeps the physical
    // line, so `from` is the moved task and `to` is the stay cursor.
    return this.recordTaskSettleJump(
      {
        path: String(jumpTarget.path || expectedPath || path || ""),
        line: jumpTarget.line,
        ch: Number.isInteger(jumpTarget.ch) ? jumpTarget.ch : 0,
      },
      {
        path: String(expectedPath || path || jumpTarget.path || ""),
        line: result.cursor.line,
        ch: Number.isInteger(result.cursor.ch) ? result.cursor.ch : 0,
      },
    );
  }

  applyTaskSettleToEditor(editor, path, options = {}) {
    const settle = this.resolveTaskSettleApi();
    if (!settle) return { applied: false, changed: false, reason: "missing" };
    try {
      const result = settle.applyToEditor(editor, path, {
        ...options,
        app: options.app || this.app,
      });
      if (result && result.applied) {
        this.recordTaskSettleResultJump(path, options && options.generation, result, {
          editor,
          path,
          generation: options && options.generation,
        });
      }
      return result == null
        ? { applied: false, changed: false, reason: "context" }
        : result;
    } catch (_error) {
      return { applied: false, changed: false, reason: "error" };
    }
  }

  settleTargetContents(path, contents, options = {}) {
    const settle = this.resolveTaskSettleApi();
    if (!settle || typeof settle.settleNote !== "function") {
      return {
        contents: contents == null ? "" : String(contents),
        changed: false,
        reason: "missing",
      };
    }
    try {
      return settle.settleNote({
        path,
        contents,
        today: options.today,
        dailyPath: options.dailyPath,
        tasksSettings: options.tasksSettings,
      });
    } catch (_error) {
      return {
        contents: contents == null ? "" : String(contents),
        changed: false,
        reason: "error",
      };
    }
  }

  flushPendingTaskSettle(options = {}) {
    if (this.taskSettleShuttingDown) return [];
    const settle = this.resolveTaskSettleApi();
    if (!settle || typeof settle.flushPending !== "function") return [];
    try {
      const outcomes = settle.flushPending();
      if (!Array.isArray(outcomes)) return [];
      for (const outcome of outcomes) {
        if (!outcome) continue;
        this.recordTaskSettleResultJump(
          outcome.path,
          outcome.generation,
          outcome.result,
          {
            editor: options.editor,
            path: outcome.path,
            generation: outcome.generation,
          },
        );
      }
      return outcomes;
    } catch (_error) {
      return [];
    }
  }

  schedulePendingTaskSettle(request = {}) {
    const settle = this.resolveTaskSettleApi();
    if (!settle || typeof settle.schedulePending !== "function") {
      return { scheduled: false, reason: "missing" };
    }
    const req = request && typeof request === "object" ? request : {};
    const consumer = typeof req.onSettled === "function" ? req.onSettled : null;
    const onSettled = (delivery) => {
      if (this.taskSettleShuttingDown) return;
      if (delivery) {
        this.recordTaskSettleResultJump(
          delivery.path,
          delivery.generation,
          delivery.result,
          {
            editor: req.editor,
            path: req.path || delivery.path,
            generation: delivery.generation,
          },
        );
      }
      if (!consumer) return;
      try {
        consumer(delivery);
      } catch (_error) {
        // Consumer observers must not change the provider write.
      }
    };
    try {
      return settle.schedulePending({
        editor: req.editor,
        path: req.path,
        identity: req.identity,
        onSettled,
      });
    } catch (_error) {
      return { scheduled: false, reason: "error" };
    }
  }
}
