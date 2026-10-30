// Warm vault task index for the `((` Task Wikilink Picker.
//
// This is phase `index` of plan 202610/obsidian_task_wikilinks.md: an
// incrementally maintained, mtime-validated index over every task-bearing
// note in the vault, with live-editor overlays, a streaming cold build,
// and performance budgets. The picker (a later phase) opens
// synchronously from `snapshot` and re-ranks per keystroke with the pure
// `orderForWikilinkPicker` ranker, so typing never touches the disk.
//
// Everything Obsidian-specific lives behind the `app` facade the adapter
// methods take (`vault`, `metadataCache`, `workspace`); the store itself
// is pure and fully drivable in tests. The store keeps parsed rows plus
// each note's block-ID set (for the detail strip's
// `suggestPromptBlockId` preview), never note texts.

// Idle budget: warm-up yields at least this often so the UI never blocks.
const TASK_WIKILINK_INDEX_IDLE_CHUNK_MS = 12;
// Hard ceiling: no warm-up chunk may block the UI longer than this.
const TASK_WIKILINK_INDEX_MAX_CHUNK_MS = 16;
// Streaming repaints: subscribers hear at most one progress emit per this
// many milliseconds while the cold build runs (plus a final emit).
const TASK_WIKILINK_INDEX_REPAINT_MS = 120;
// Bounded unreadable-file warnings, surfaced as a quiet footer note.
const TASK_WIKILINK_INDEX_MAX_WARNINGS = 5;

// Default yield: an idle callback when the host offers one, else a macro
// task. Tests inject a synchronous scheduler for determinism.
function taskWikilinkIndexDefaultSchedule(callback) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout: 50 });
    return;
  }
  setTimeout(callback, 0);
}

function taskWikilinkIndexAwaitSchedule(schedule) {
  return new Promise((resolve) => {
    schedule(resolve);
  });
}

// Prefilter for the cold build, over one `metadataCache.getFileCache`
// entry: skip files whose cache already proves they hold no task list
// items. A file with no cache yet (null/undefined, or no `listItems`
// array) is always read. Unknown shapes read too: a false skip would
// hide tasks, while a false read only costs one `cachedRead`.
function taskWikilinkCacheHasTasks(fileCache) {
  if (!fileCache || typeof fileCache !== "object") {
    return true;
  }
  const items = fileCache.listItems;
  if (!Array.isArray(items)) {
    return true;
  }
  return items.some(
    (item) => !!item && typeof item.task === "string",
  );
}

function taskWikilinkStatOf(stat) {
  if (!stat || typeof stat !== "object") {
    return { mtime: null, size: null };
  }
  return {
    mtime: typeof stat.mtime === "number" ? stat.mtime : null,
    size: typeof stat.size === "number" ? stat.size : null,
  };
}

function taskWikilinkBlockIdsForRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row && row.blockId) {
      ids.add(row.blockId);
    }
  }
  return ids;
}

class TaskWikilinkIndex {
  constructor(settings) {
    this.settings = settings || defaultTaskWikilinkSettings();
    // path -> { mtime, size, rows, blockIds }. Never note texts.
    this.entries = new Map();
    this.basename = buildBasenameIndex([]);
    this.batchDepth = 0;
    this.basenameDirty = false;
    this.warnings = [];
    this.droppedWarnings = 0;
    this.subscribers = new Set();
    this.progress = { ready: false, scanned: 0, total: 0 };
    this.reparseQueue = [];
    this.queuedPaths = new Set();
    this.emitThrottleMs = TASK_WIKILINK_INDEX_REPAINT_MS;
    this.lastEmitAt = 0;
  }

  setSettings(settings) {
    this.settings = settings || defaultTaskWikilinkSettings();
  }

  beginBatch() {
    this.batchDepth += 1;
  }

  endBatch() {
    if (this.batchDepth > 0) {
      this.batchDepth -= 1;
    }
    if (this.batchDepth === 0 && this.basenameDirty) {
      this.rebuildBasename();
    }
  }

  rebuildBasename() {
    this.basename = buildBasenameIndex([...this.entries.keys()]);
    this.basenameDirty = false;
  }

  markBasenameDirty() {
    if (this.batchDepth > 0) {
      this.basenameDirty = true;
      return;
    }
    this.rebuildBasename();
  }

  // Parse and store one note. Non-note paths (non-`.md`, excluded
  // directories) are dropped instead. Returns true when stored.
  ingestNote(path, content, stat) {
    if (!isTaskWikilinkNotePath(path)) {
      if (this.entries.has(path)) {
        this.removeNote(path);
      }
      return false;
    }
    const stamp = taskWikilinkStatOf(stat);
    const rows = parseNoteTaskRows(path, String(content ?? ""), this.settings);
    this.entries.set(path, {
      mtime: stamp.mtime,
      size: stamp.size,
      rows,
      blockIds: taskWikilinkBlockIdsForRows(rows),
    });
    this.dequeueReparse(path);
    this.markBasenameDirty();
    this.emit();
    return true;
  }

  removeNote(path) {
    if (!this.entries.has(path)) {
      return false;
    }
    this.entries.delete(path);
    this.dequeueReparse(path);
    this.markBasenameDirty();
    this.emit();
    return true;
  }

  // Re-key rows after a vault rename. Content is unchanged, so rows and
  // block IDs move as-is; only the basename index is recomputed.
  renameNote(oldPath, newPath) {
    if (!this.entries.has(oldPath)) {
      return false;
    }
    if (oldPath === newPath) {
      return true;
    }
    const entry = this.entries.get(oldPath);
    this.entries.delete(oldPath);
    this.dequeueReparse(oldPath);
    if (!isTaskWikilinkNotePath(newPath)) {
      this.markBasenameDirty();
      this.emit();
      return true;
    }
    const movedRows = entry.rows.map((row) => ({ ...row, notePath: newPath }));
    this.entries.set(newPath, {
      mtime: entry.mtime,
      size: entry.size,
      rows: movedRows,
      blockIds: new Set(entry.blockIds),
    });
    this.dequeueReparse(newPath);
    this.markBasenameDirty();
    this.emit();
    return true;
  }

  // Post-write refresh: `{ path, content, stat }` entries, as produced
  // after an ID-naming or lane-raising write. Content is required; paths
  // without content are skipped so a missing read never blanks rows.
  refreshPaths(items) {
    let changed = false;
    this.beginBatch();
    try {
      for (const item of items || []) {
        if (!item || typeof item.path !== "string") {
          continue;
        }
        if (typeof item.content !== "string") {
          continue;
        }
        changed = this.ingestNote(item.path, item.content, item.stat) || changed;
      }
    } finally {
      this.endBatch();
    }
    if (changed) {
      this.emit();
    }
    return changed;
  }

  entryFor(path) {
    return this.entries.get(path) || null;
  }

  notePaths() {
    return [...this.entries.keys()];
  }

  // Paths that currently bear at least one task row.
  taskBearingPaths() {
    const paths = [];
    for (const [path, entry] of this.entries) {
      if (entry.rows.length > 0) {
        paths.push(path);
      }
    }
    return paths;
  }

  // The note's block-ID set, for the detail strip's
  // `suggestPromptBlockId` preview. Returns a fresh array.
  blockIdsFor(path) {
    const entry = this.entries.get(path);
    return entry ? [...entry.blockIds] : [];
  }

  warn(message) {
    if (this.warnings.length < TASK_WIKILINK_INDEX_MAX_WARNINGS) {
      this.warnings.push(String(message));
    } else {
      this.droppedWarnings += 1;
    }
  }

  // Quiet footer note for unreadable files, or null when clean.
  warningNote() {
    if (this.warnings.length === 0) {
      return null;
    }
    const shown = this.warnings.join("; ");
    if (this.droppedWarnings > 0) {
      return `Skipped ${this.warnings.length + this.droppedWarnings} unreadable notes: ${shown} (+${this.droppedWarnings} more)`;
    }
    return `Skipped ${this.warnings.length} unreadable note${this.warnings.length === 1 ? "" : "s"}: ${shown}`;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  emit() {
    if (this.subscribers.size === 0) {
      return;
    }
    if (this.emitThrottleMs > 0) {
      const now = Date.now();
      if (now - this.lastEmitAt < this.emitThrottleMs) {
        return;
      }
      this.lastEmitAt = now;
    }
    for (const listener of [...this.subscribers]) {
      try {
        listener(this.progressSnapshot());
      } catch (error) {
        continue;
      }
    }
  }

  emitForced() {
    if (this.subscribers.size === 0) {
      return;
    }
    this.lastEmitAt = Date.now();
    for (const listener of [...this.subscribers]) {
      try {
        listener(this.progressSnapshot());
      } catch (error) {
        continue;
      }
    }
  }

  progressSnapshot() {
    return {
      ready: this.progress.ready,
      scanned: this.progress.scanned,
      total: this.progress.total,
    };
  }

  queueReparse(path) {
    if (!this.queuedPaths.has(path)) {
      this.queuedPaths.add(path);
      this.reparseQueue.push(path);
    }
  }

  dequeueReparse(path) {
    if (this.queuedPaths.has(path)) {
      this.queuedPaths.delete(path);
      this.reparseQueue = this.reparseQueue.filter((queued) => queued !== path);
    }
  }

  takeReparseQueue() {
    const queued = this.reparseQueue;
    this.reparseQueue = [];
    this.queuedPaths.clear();
    return queued;
  }

  // Open-time validation over a `statOf(path)` reader returning
  // `{ mtime, size }` (or null when the path is gone). Changed and
  // vanished files are queued for background re-parse; the queue is
  // drained by `drainReparseQueue`. Returns the changed paths.
  validateEntries(statOf) {
    if (typeof statOf !== "function") {
      return [];
    }
    const changed = [];
    for (const [path, entry] of this.entries) {
      let current = null;
      try {
        current = statOf(path);
      } catch (error) {
        current = null;
      }
      const stamp = taskWikilinkStatOf(current);
      if (current === null || current === undefined) {
        changed.push(path);
        this.queueReparse(path);
        continue;
      }
      if (entry.mtime !== stamp.mtime || entry.size !== stamp.size) {
        changed.push(path);
        this.queueReparse(path);
      }
    }
    return changed;
  }

  decorateRow(row) {
    const [locator, linkTarget] = this.basename.locatorAndTargetFor(row.notePath);
    const decorated = {
      ...row,
      locator,
      linkTarget,
    };
    // Precompute the lowered search fields once per snapshot so every
    // per-keystroke rank reuses them instead of rebuilding and
    // re-lowercasing thousands of field arrays.
    decorated.loweredSearchFields = taskWikilinkSearchFields(decorated).map(
      (field) => String(field).toLowerCase(),
    );
    return decorated;
  }

  // Picker input: stored rows with live-editor overlays applied
  // (overlays win over disk and never persist), decorated with the
  // current locator and link target, in empty-query canonical order for
  // `ownerPath`. Per-keystroke filtering re-ranks these rows with
  // `orderForWikilinkPicker` and performs no vault reads.
  rowsForPicker({ ownerPath = null, overlays = null } = {}) {
    const overlaid = new Set();
    let rows = [];
    if (overlays && typeof overlays === "object") {
      const entries = overlays instanceof Map ? overlays.entries() : Object.entries(overlays);
      for (const [path, text] of entries) {
        if (typeof text !== "string" || !isTaskWikilinkNotePath(path)) {
          continue;
        }
        overlaid.add(path);
        for (const row of parseNoteTaskRows(path, text, this.settings)) {
          rows.push(this.decorateRow(row));
        }
      }
    }
    for (const [path, entry] of this.entries) {
      if (overlaid.has(path)) {
        continue;
      }
      for (const row of entry.rows) {
        rows.push(this.decorateRow(row));
      }
    }
    return orderForWikilinkPicker(rows, "", ownerPath);
  }

  // What the picker opens from: validated, overlaid, ordered rows plus
  // `{ ready, scanned, total }` progress and a change subscription for
  // streaming repaints. `statOf` is the vault stat reader; omit it (or
  // pass null) when stats are already known fresh, e.g. in tests.
  snapshot({ ownerPath = null, overlays = null, statOf = null } = {}) {
    const changed = this.validateEntries(statOf);
    return {
      rows: this.rowsForPicker({ ownerPath, overlays }),
      ready: this.progress.ready,
      scanned: this.progress.scanned,
      total: this.progress.total,
      changed,
      subscribe: (listener) => this.subscribe(listener),
    };
  }

  // --- Thin Obsidian adapter. Each method takes the app facade; the
  // --- store above never touches it.

  // Streaming cold build. Enumerates `vault.getMarkdownFiles()`,
  // prefilters with `metadataCache.getFileCache`, reads the rest with
  // `vault.cachedRead`, and ingests in idle chunks of at most
  // `yieldAfterMs` (default 12 ms) so the UI never blocks. Progress
  // emits stream to subscribers (throttled to one repaint per 120 ms)
  // plus a forced final emit; `onChunk({ scanned, total, chunkMs })`
  // reports every chunk for the performance test.
  async warmUpFromVault(app, options = {}) {
    const schedule = options.schedule || taskWikilinkIndexDefaultSchedule;
    const yieldAfterMs =
      typeof options.yieldAfterMs === "number"
        ? options.yieldAfterMs
        : TASK_WIKILINK_INDEX_IDLE_CHUNK_MS;
    const onChunk = options.onChunk;
    const vault = app && app.vault;
    const metadataCache = app && app.metadataCache;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return { scanned: 0, total: 0, skipped: 0, warnings: [...this.warnings] };
    }
    let files = [];
    try {
      files = vault.getMarkdownFiles() || [];
    } catch (error) {
      this.warn(`could not list vault notes: ${error && error.message ? error.message : error}`);
      return { scanned: 0, total: 0, skipped: 0, warnings: [...this.warnings] };
    }
    this.progress.total = files.length;
    this.progress.scanned = 0;
    this.progress.ready = false;
    let skipped = 0;
    this.beginBatch();
    try {
      let chunkStart = Date.now();
      for (const file of files) {
        let cache = null;
        try {
          cache =
            metadataCache && typeof metadataCache.getFileCache === "function"
              ? metadataCache.getFileCache(file)
              : null;
        } catch (error) {
          cache = null;
        }
        if (!taskWikilinkCacheHasTasks(cache)) {
          skipped += 1;
          this.progress.scanned += 1;
        } else {
          let text = null;
          try {
            text = await vault.cachedRead(file);
          } catch (error) {
            this.warn(
              `could not read ${file && file.path ? file.path : "a note"}: ${error && error.message ? error.message : error}`,
            );
            text = null;
          }
          if (typeof text === "string") {
            this.ingestNoteBatch(file.path, text, file && file.stat);
          } else if (text !== null) {
            this.ingestNoteBatch(file.path, String(text), file && file.stat);
          }
          this.progress.scanned += 1;
        }
        if (Date.now() - chunkStart >= yieldAfterMs) {
          const chunkMs = Date.now() - chunkStart;
          if (typeof onChunk === "function") {
            try {
              onChunk({
                scanned: this.progress.scanned,
                total: this.progress.total,
                chunkMs,
              });
            } catch (error) {
              continue;
            }
          }
          this.emit();
          await taskWikilinkIndexAwaitSchedule(schedule);
          chunkStart = Date.now();
        }
      }
    } finally {
      this.endBatch();
    }
    this.progress.ready = true;
    this.emitForced();
    return {
      scanned: this.progress.scanned,
      total: this.progress.total,
      skipped,
      warnings: [...this.warnings],
    };
  }

  // Batch ingest without per-note emits or basename rebuilds; the
  // surrounding `beginBatch`/`endBatch` in `warmUpFromVault` flushes.
  ingestNoteBatch(path, content, stat) {
    if (!isTaskWikilinkNotePath(path)) {
      return false;
    }
    const stamp = taskWikilinkStatOf(stat);
    const rows = parseNoteTaskRows(path, String(content ?? ""), this.settings);
    this.entries.set(path, {
      mtime: stamp.mtime,
      size: stamp.size,
      rows,
      blockIds: taskWikilinkBlockIdsForRows(rows),
    });
    this.dequeueReparse(path);
    this.basenameDirty = true;
    return true;
  }

  // Live maintenance. `host` supplies `registerEvent` (the plugin);
  // every subscription is registered on it for teardown in `onunload`.
  // `changed` re-parses from the event's `data` with no extra read;
  // renames re-key rows and recompute the basename index.
  attachLiveUpdates(host, app) {
    if (!host || typeof host.registerEvent !== "function" || !app) {
      return () => {};
    }
    const detach = [];
    const metadataCache = app.metadataCache;
    const vault = app.vault;
    if (metadataCache && typeof metadataCache.on === "function") {
      try {
        detach.push(
          host.registerEvent(
            metadataCache.on("changed", (file, data) => {
              if (!file || typeof file.path !== "string") {
                return;
              }
              if (typeof data !== "string") {
                return;
              }
              this.ingestNote(file.path, data, file.stat);
            }),
          ),
        );
      } catch (error) {
        this.warn(`could not watch note changes: ${error && error.message ? error.message : error}`);
      }
    }
    if (vault && typeof vault.on === "function") {
      try {
        detach.push(
          host.registerEvent(
            vault.on("rename", (file, oldPath) => {
              if (!file || typeof file.path !== "string") {
                return;
              }
              this.renameNote(oldPath, file.path);
            }),
          ),
        );
      } catch (error) {
        this.warn(`could not watch renames: ${error && error.message ? error.message : error}`);
      }
      try {
        detach.push(
          host.registerEvent(
            vault.on("delete", (file) => {
              if (!file || typeof file.path !== "string") {
                return;
              }
              this.removeNote(file.path);
            }),
          ),
        );
      } catch (error) {
        this.warn(`could not watch deletions: ${error && error.message ? error.message : error}`);
      }
    }
    return () => detach;
  }

  // Live text of every open Markdown editor, keyed by note path. The
  // picker merges its source editor over this map before calling
  // `snapshot`, so the source buffer always wins even when its leaf
  // reports no file yet.
  collectEditorOverlays(app) {
    const overlays = new Map();
    try {
      const workspace = app && app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return overlays;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        const view = leaf && leaf.view;
        if (!view || !view.file || typeof view.file.path !== "string") {
          continue;
        }
        if (!view.editor || typeof view.editor.getValue !== "function") {
          continue;
        }
        try {
          overlays.set(view.file.path, String(view.editor.getValue() || ""));
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return overlays;
    }
    return overlays;
  }

  // Stat reader over the vault for open-time validation.
  vaultStatOf(app) {
    const vault = app && app.vault;
    return (path) => {
      try {
        const file =
          vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
        if (!file || !file.stat) {
          return null;
        }
        return taskWikilinkStatOf(file.stat);
      } catch (error) {
        return null;
      }
    };
  }

  // Background drain for paths `snapshot` flagged stale: re-reads each
  // through `vault.cachedRead` and refreshes the store.
  async drainReparseQueue(app) {
    const queued = this.takeReparseQueue();
    if (queued.length === 0) {
      return [];
    }
    const vault = app && app.vault;
    if (!vault || typeof vault.cachedRead !== "function") {
      return queued;
    }
    const refreshed = [];
    const items = [];
    for (const path of queued) {
      let file = null;
      try {
        file =
          typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
      } catch (error) {
        file = null;
      }
      if (!file) {
        this.removeNote(path);
        refreshed.push(path);
        continue;
      }
      try {
        const text = await vault.cachedRead(file);
        items.push({ path, content: typeof text === "string" ? text : String(text ?? ""), stat: file.stat });
        refreshed.push(path);
      } catch (error) {
        this.warn(`could not re-read ${path}: ${error && error.message ? error.message : error}`);
      }
    }
    this.refreshPaths(items);
    return refreshed;
  }

  // `{ path, text }` for every task-bearing note, read on demand for
  // PDG1 consumption (`planTaskLinkBlockConsumption`). Texts are never
  // cached here; each call reads fresh.
  async taskBearingDocuments(app) {
    const vault = app && app.vault;
    if (!vault || typeof vault.cachedRead !== "function") {
      return [];
    }
    const documents = [];
    for (const path of this.taskBearingPaths()) {
      let file = null;
      try {
        file =
          typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
      } catch (error) {
        file = null;
      }
      if (!file) {
        continue;
      }
      try {
        const text = await vault.cachedRead(file);
        documents.push({ path, text: typeof text === "string" ? text : String(text ?? "") });
      } catch (error) {
        this.warn(`could not read ${path}: ${error && error.message ? error.message : error}`);
      }
    }
    return documents;
  }

  // Post-write refresh from the vault: re-reads `paths` through
  // `vault.cachedRead` and refreshes the store.
  async refreshPathsFromVault(app, paths) {
    const vault = app && app.vault;
    if (!vault || typeof vault.cachedRead !== "function") {
      return false;
    }
    const items = [];
    for (const path of paths || []) {
      let file = null;
      try {
        file =
          typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
      } catch (error) {
        file = null;
      }
      if (!file) {
        this.removeNote(path);
        continue;
      }
      try {
        const text = await vault.cachedRead(file);
        items.push({ path, content: typeof text === "string" ? text : String(text ?? ""), stat: file.stat });
      } catch (error) {
        this.warn(`could not re-read ${path}: ${error && error.message ? error.message : error}`);
      }
    }
    return this.refreshPaths(items);
  }
}
