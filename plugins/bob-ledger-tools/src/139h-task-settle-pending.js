// Provider-owned delayed settle scheduler (bob-cli-q4.8.1.3 pending-api).
// Entries keep only editor identity, path, task identity, generation, and timer;
// settle always reads the editor's current buffer when the work drains.

const TASK_SETTLE_PENDING_DELAY_MS = 500;
let taskSettleCodeMirrorUndoDepth = null;
try {
  const commands = require("@codemirror/commands");
  taskSettleCodeMirrorUndoDepth =
    commands && typeof commands.undoDepth === "function" ? commands.undoDepth : null;
} catch (_error) {
  // Obsidian's editor.transaction fallback remains available without CM6 history.
}

function taskSettleHistoryDepth(cm) {
  if (!cm || !cm.state || typeof taskSettleCodeMirrorUndoDepth !== "function") return null;
  try {
    const depth = taskSettleCodeMirrorUndoDepth(cm.state);
    return Number.isInteger(depth) && depth >= 0 ? depth : null;
  } catch (_error) {
    return null;
  }
}

function taskSettlePendingBufferFingerprint(editor) {
  if (!editor || typeof editor.getValue !== "function") return null;
  try {
    const text = String(editor.getValue());
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return `${text.length}:${hash >>> 0}`;
  } catch (_error) {
    return null;
  }
}

function taskSettleWrapCommand(plugin, command) {
  if (!command || typeof command !== "object") return command;
  const wrapped = { ...command };
  for (const name of ["callback", "editorCallback"]) {
    const callback = wrapped[name];
    if (typeof callback !== "function") continue;
    wrapped[name] = function (...args) {
      plugin.taskSettleFlushPending();
      return callback.apply(this, args);
    };
  }
  for (const name of ["checkCallback", "editorCheckCallback"]) {
    const callback = wrapped[name];
    if (typeof callback !== "function") continue;
    wrapped[name] = function (checking, ...args) {
      if (checking !== true) plugin.taskSettleFlushPending();
      return callback.call(this, checking, ...args);
    };
  }
  return wrapped;
}

function taskSettlePendingIdentityKey(identity) {
  if (!identity || typeof identity !== "object") return null;
  const blockId = typeof identity.blockId === "string" ? identity.blockId.trim() : "";
  if (blockId) return `id\u0000${blockId}`;
  if (identity.text == null) return null;
  const text = String(identity.text);
  if (!text) return null;
  if (Number.isInteger(identity.line)) return `line\u0000${identity.line}`;
  return `text\u0000${text}`;
}

function taskSettleCloneIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  return {
    ...(typeof identity.blockId === "string" ? { blockId: identity.blockId } : {}),
    ...(Number.isInteger(identity.line) ? { line: identity.line } : {}),
    ...(identity.text != null ? { text: String(identity.text) } : {}),
  };
}

function taskSettleCreatePendingScheduler(options = {}) {
  const pending = new Map();
  const delay = Number.isFinite(options.delayMs) && options.delayMs >= 0
    ? options.delayMs
    : TASK_SETTLE_PENDING_DELAY_MS;
  const setTimer = typeof options.setTimeout === "function"
    ? options.setTimeout
    : (callback, ms) => setTimeout(callback, ms);
  const clearTimer = typeof options.clearTimeout === "function"
    ? options.clearTimeout
    : (timer) => clearTimeout(timer);
  const apply = typeof options.apply === "function" ? options.apply : () => null;
  let generation = 0;
  let disposed = false;

  function cancel(entry) {
    if (!entry || entry.timer == null) return;
    try {
      clearTimer(entry.timer);
    } catch (_error) {
      // A disposed host timer is already inert.
    }
    entry.timer = null;
  }

  function copyEntry(entry) {
    if (!entry) return null;
    return {
      editor: entry.editor,
      path: entry.path,
      identity: taskSettleCloneIdentity(entry.identity),
      generation: entry.generation,
      bufferFingerprint: entry.bufferFingerprint,
    };
  }

  function remove(entry) {
    if (!entry) return;
    if (pending.get(entry.editor) === entry) pending.delete(entry.editor);
    cancel(entry);
  }

  function drain(editor, expectedGeneration) {
    const entry = pending.get(editor);
    if (!entry || (expectedGeneration != null && entry.generation !== expectedGeneration)) {
      return { applied: false, reason: "stale" };
    }

    // Clear ownership before invoking editor code; its transaction can re-enter
    // extension listeners, but it cannot drain this generation a second time.
    pending.delete(editor);
    cancel(entry);
    let result;
    try {
      result = apply(copyEntry(entry));
    } catch (_error) {
      result = { applied: false, changed: false, reason: "error" };
    }
    return {
      path: entry.path,
      generation: entry.generation,
      result: result == null ? { applied: false, changed: false, reason: "context" } : result,
    };
  }

  function arm(entry) {
    const token = entry.generation;
    try {
      entry.timer = setTimer(() => {
        if (!disposed) drain(entry.editor, token);
      }, delay);
      return true;
    } catch (_error) {
      remove(entry);
      return false;
    }
  }

  function schedule(editor, path, identity) {
    if (disposed) return { scheduled: false, reason: "disposed", pending: pending.size };
    const normalizedPath = normalizeVaultPath(path);
    const snapshot = taskSettleCloneIdentity(identity);
    const identityKey = taskSettlePendingIdentityKey(snapshot);
    if (!editor || !normalizedPath || !identityKey) {
      return { scheduled: false, reason: "identity", pending: pending.size };
    }

    const existing = pending.get(editor);
    if (
      existing &&
      existing.path === normalizedPath &&
      taskSettlePendingIdentityKey(existing.identity) === identityKey
    ) {
      cancel(existing);
      existing.identity = snapshot;
      existing.bufferFingerprint = taskSettlePendingBufferFingerprint(editor);
      existing.generation = ++generation;
      if (!arm(existing)) return { scheduled: false, reason: "timer", pending: pending.size };
      return { scheduled: true, reset: true, generation: existing.generation, pending: pending.size };
    }

    // Two editor objects for one path may hold divergent unsaved buffers. Drop
    // both delayed writes rather than let one view overwrite the other's edit.
    const sharedPath = [...pending.values()].filter(
      (entry) => entry.path === normalizedPath && entry.editor !== editor,
    );
    if (sharedPath.length > 0) {
      for (const entry of sharedPath) remove(entry);
      if (existing) remove(existing);
      return { scheduled: false, reason: "shared-path", pending: pending.size };
    }

    // A different task in this editor flushes its predecessor first. The
    // apply callback rechecks the current view path and live identity.
    if (existing) drain(editor, existing.generation);

    const entry = {
      editor,
      path: normalizedPath,
      identity: snapshot,
      generation: ++generation,
      bufferFingerprint: taskSettlePendingBufferFingerprint(editor),
      timer: null,
    };
    pending.set(editor, entry);
    if (!arm(entry)) return { scheduled: false, reason: "timer", pending: pending.size };
    return { scheduled: true, reset: false, generation: entry.generation, pending: pending.size };
  }

  function flushPending() {
    if (disposed) return [];
    return [...pending.values()].map((entry) => drain(entry.editor, entry.generation));
  }

  function flushEditor(editor) {
    if (disposed) return { applied: false, reason: "disposed" };
    const entry = pending.get(editor);
    return entry ? drain(editor, entry.generation) : { applied: false, reason: "empty" };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of pending.values()) cancel(entry);
    pending.clear();
  }

  return Object.freeze({
    schedule,
    flushPending,
    flushEditor,
    hasPending: (editor) => pending.has(editor),
    peek: (editor) => copyEntry(pending.get(editor)),
    get size() { return pending.size; },
    dispose,
  });
}

class BobLedgerToolsTaskSettlePendingMixin {
  taskSettleWrapRegisteredCommands() {
    const registry = this.app && this.app.commands && this.app.commands.commands;
    if (!registry) return 0;
    if (!(this.taskSettleCommandsWrapped instanceof WeakSet)) {
      this.taskSettleCommandsWrapped = new WeakSet();
    }
    const entries = registry instanceof Map
      ? [...registry.entries()]
      : Object.entries(registry);
    const pluginId = this.manifest && this.manifest.id ? this.manifest.id : "bob-ledger-tools";
    const prefix = `${pluginId}:`;
    let wrappedCount = 0;
    for (const [key, command] of entries) {
      if (!command || typeof command !== "object" || this.taskSettleCommandsWrapped.has(command)) continue;
      const id = typeof command.id === "string" ? command.id : String(key);
      if (!id.startsWith(prefix)) continue;
      try {
        const wrapped = taskSettleWrapCommand(this, command);
        for (const name of ["callback", "editorCallback", "checkCallback", "editorCheckCallback"]) {
          if (typeof wrapped[name] === "function") command[name] = wrapped[name];
        }
        this.taskSettleCommandsWrapped.add(command);
        wrappedCount += 1;
      } catch (_error) {
        // A read-only registry row keeps its original behavior.
      }
    }
    return wrappedCount;
  }

  taskSettleEnsurePendingScheduler() {
    if (this.taskSettlePendingScheduler) return this.taskSettlePendingScheduler;
    this.taskSettlePendingScheduler = taskSettleCreatePendingScheduler({
      apply: (entry) => this.taskSettleApplyPending(entry),
    });
    return this.taskSettlePendingScheduler;
  }

  taskSettleApplyPending(entry) {
    const editor = entry && entry.editor;
    const path = entry && entry.path;
    if (!editor || typeof editor.getValue !== "function") {
      return { applied: false, changed: false, reason: "editor" };
    }
    const guard = taskSettleGuardEditorPath(this.app, editor, path);
    if (!guard.ok) {
      return { applied: false, changed: false, reason: guard.reason };
    }
    const contents = String(editor.getValue());
    const lines = taskSettleLogicalLines(contents);
    if (taskSettleFindIdentityLine(lines, entry.identity) == null) {
      return { applied: false, changed: false, reason: "identity" };
    }
    const unchangedSinceSchedule =
      entry.bufferFingerprint != null &&
      taskSettlePendingBufferFingerprint(editor) === entry.bufferFingerprint;
    return this.taskSettleApplyToEditor(editor, path, {
      identity: entry.identity,
      joinHistory: unchangedSinceSchedule,
    });
  }

  taskSettleSchedulePending(request = {}) {
    const req = request && typeof request === "object" ? request : {};
    try {
      return this.taskSettleEnsurePendingScheduler().schedule(
        req.editor,
        req.path,
        req.identity,
      );
    } catch (_error) {
      return { scheduled: false, reason: "error" };
    }
  }

  taskSettleFlushPending() {
    if (!this.taskSettlePendingScheduler) return [];
    try {
      return this.taskSettlePendingScheduler.flushPending();
    } catch (_error) {
      return [];
    }
  }

  taskSettleFlushPendingForEditor(editor) {
    if (!this.taskSettlePendingScheduler) return { applied: false, reason: "empty" };
    try {
      return this.taskSettlePendingScheduler.flushEditor(editor);
    } catch (_error) {
      return { applied: false, reason: "error" };
    }
  }

  taskSettleFlushIfCursorLeaves(editor, cursorLine) {
    const scheduler = this.taskSettlePendingScheduler;
    if (!scheduler) return { applied: false, reason: "empty" };
    const entry = scheduler.peek(editor);
    if (!entry || !Number.isInteger(cursorLine)) return { applied: false, reason: "empty" };
    try {
      const guard = taskSettleGuardEditorPath(this.app, editor, entry.path);
      if (!guard.ok) return scheduler.flushEditor(editor);
      const lines = taskSettleLogicalLines(String(editor.getValue()));
      const taskLine = taskSettleFindIdentityLine(lines, entry.identity);
      if (taskLine == null || taskLine !== cursorLine) {
        return scheduler.flushEditor(editor);
      }
    } catch (_error) {
      return scheduler.flushEditor(editor);
    }
    return { applied: false, reason: "cursor-on-task" };
  }

  taskSettleEditorLineFromCmView(cmView) {
    try {
      const position = cmView && cmView.state && cmView.state.selection &&
        cmView.state.selection.main && cmView.state.selection.main.head;
      const line = cmView && cmView.state && cmView.state.doc &&
        cmView.state.doc.lineAt(position).number;
      return Number.isInteger(line) && line > 0 ? line - 1 : null;
    } catch (_error) {
      return null;
    }
  }

  taskSettleEditorForCmView(cmView) {
    const view = taskSettleFindMarkdownViewForEditor(this.app, cmView);
    return view && view.editor ? view.editor : null;
  }

  taskSettleInstallPendingLifecycle() {
    if (this.taskSettlePendingLifecycleActive) return;
    this.taskSettlePendingLifecycleActive = true;
    this.taskSettleEnsurePendingScheduler();
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      for (const name of ["active-leaf-change", "file-open"]) {
        this.registerEvent(workspace.on(name, () => this.taskSettleFlushPending()));
      }
    }

    if (
      EditorView &&
      EditorView.updateListener &&
      typeof EditorView.updateListener.of === "function"
    ) {
      this.registerEditorExtension(
        EditorView.updateListener.of((update) => {
          if (!update || !update.selectionSet) return;
          const cmView = update.view;
          const editor = this.taskSettleEditorForCmView(cmView);
          const line = this.taskSettleEditorLineFromCmView(cmView);
          if (editor && line != null) this.taskSettleFlushIfCursorLeaves(editor, line);
        }),
      );
    }

    if (EditorView && typeof EditorView.domEventHandlers === "function") {
      this.registerEditorExtension(
        EditorView.domEventHandlers({
          blur: (_event, cmView) => {
            const editor = this.taskSettleEditorForCmView(cmView);
            if (editor) this.taskSettleFlushPendingForEditor(editor);
            return false;
          },
        }),
      );
    }
  }

  taskSettleDisposePendingLifecycle() {
    const scheduler = this.taskSettlePendingScheduler;
    if (scheduler) scheduler.dispose();
    this.taskSettlePendingScheduler = null;
    this.taskSettlePendingLifecycleActive = false;
  }
}
