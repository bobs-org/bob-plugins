class BobNavigationHotkeysDependencyStageMixin {

  // Vault linkpath resolver for the writer (`docs/task-dependencies.md` §3):
  // bare basenames resolve through the metadata cache against the whole
  // vault (so `[[cash#^a]]` with duplicate basenames keeps its full route),
  // with the same-note suffix heuristic as the fallback. Returns null when
  // no resolver is available; the planner then uses the heuristic alone.
  dependencyLinkpathResolver() {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      return (linkpath, sourcePath) => {
        try {
          const dest = metadataCache.getFirstLinkpathDest(
            String(linkpath || ""),
            String(sourcePath || ""),
          );
          if (dest && dest.path) {
            return normalizeVaultRelativePath(dest.path);
          }
        } catch (_error) {
          // Fall through to the heuristic.
        }
        return null;
      };
    } catch (_error) {
      return null;
    }
  }

  // Vault markdown file list for writer link-form ranking, or null when the
  // vault cannot list files (the planner then ranks loaded notes only).
  readDependencyVaultFileList() {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getMarkdownFiles !== "function") {
        return null;
      }
      const paths = [];
      for (const file of vault.getMarkdownFiles() || []) {
        const normalized = normalizeVaultRelativePath(file && file.path);
        if (normalized) {
          paths.push(normalized);
        }
      }
      return paths;
    } catch (_error) {
      return null;
    }
  }

  // Vault snapshot for ADJ-8 recovery: every markdown note with open-buffer
  // contents winning (unsaved edits count), so the recovery index sees the
  // vault with the edited buffer overriding, including today's daily note.
  // Returns null when the vault cannot be snapshotted; the planner then
  // recovers from the loaded notes alone.
  async readDependencyRecoveryVaultContents(sourcePath, sourceContent) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getMarkdownFiles !== "function") {
        return null;
      }
      const buffers = getOpenMarkdownBufferContents(this.app);
      const contents = new Map();
      for (const file of vault.getMarkdownFiles() || []) {
        const normalized = normalizeVaultRelativePath(file && file.path);
        if (!normalized || contents.has(normalized)) {
          continue;
        }
        if (buffers.has(normalized)) {
          contents.set(normalized, String(buffers.get(normalized) || ""));
          continue;
        }
        if (typeof vault.cachedRead !== "function") {
          return null;
        }
        contents.set(normalized, String(await vault.cachedRead(file)));
      }
      const source = normalizeVaultRelativePath(sourcePath);
      if (source) {
        contents.set(source, String(sourceContent || ""));
      }
      return contents;
    } catch (_error) {
      return null;
    }
  }

  async readDependencyNoteContent(filePath, editor, parentPath) {
    try {
      const normalized = normalizeVaultRelativePath(filePath);
      const buffered = this.readOpenBufferContent(normalized);
      if (buffered !== null) {
        return buffered;
      }
      if (editor && normalized === normalizeVaultRelativePath(parentPath)) {
        return String(editor.getValue() || "");
      }
      const app = this.app;
      const vault = app && app.vault;
      const file =
        vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(normalized)
          : null;
      if (!file || typeof vault.cachedRead !== "function") {
        return null;
      }
      return String(await vault.cachedRead(file));
    } catch (_error) {
      return null;
    }
  }

  // Cross-note preparation: the open editor when the note is open, otherwise
  // a preimage-checked `vault.process`. Synchronous boolean plumbing is
  // avoided: vault writes are async, so preparation results are Promises.
  async prepareDependencyTargetNote(filePath, preparation) {
    try {
      const normalized = normalizeVaultRelativePath(filePath);
      const app = this.app;
      const workspace = app && app.workspace;
      if (workspace && typeof workspace.getLeavesOfType === "function") {
        for (const leaf of workspace.getLeavesOfType("markdown") || []) {
          const view = leaf && leaf.view;
          if (
            !view ||
            !view.file ||
            normalizeVaultRelativePath(view.file.path) !== normalized ||
            !view.editor ||
            typeof view.editor.getValue !== "function"
          ) {
            continue;
          }
          const current = String(view.editor.getValue() || "").split(/\r?\n/);
          if (
            current[preparation.line] === undefined ||
            current[preparation.line] !== preparation.from
          ) {
            return { ok: false, reason: "target-changed" };
          }
          current[preparation.line] = preparation.text;
          const ending = String(view.editor.getValue() || "").includes("\r\n")
            ? "\r\n"
            : "\n";
          const committed = applyEditorContentTransaction(
            view.editor,
            view.editor.getValue(),
            current.join(ending),
          );
          return committed
            ? { ok: true }
            : { ok: false, reason: "target-commit-failed" };
        }
      }
      const vault = app && app.vault;
      const file =
        vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(normalized)
          : null;
      if (!file || typeof vault.process !== "function") {
        return { ok: false, reason: "target-unavailable" };
      }
      let applied = false;
      await vault.process(file, (data) => {
        const current = String(data || "").split(/\r?\n/);
        if (current[preparation.line] !== preparation.from) {
          return data;
        }
        current[preparation.line] = preparation.text;
        applied = true;
        return current.join(
          String(data || "").includes("\r\n") ? "\r\n" : "\n",
        );
      });
      return applied
        ? { ok: true }
        : { ok: false, reason: "target-changed" };
    } catch (_error) {
      return { ok: false, reason: "target-preparation-failed" };
    }
  }

  // ---- Vault-wide Depends on stage pool (nav-stage) ----
  // `docs/task-dependencies.md` §6.2: the pool comes from the Tasks cache
  // (`getTasks()` when `getState()` is `"Warm"`) with open-buffer
  // overrides, falling back to a one-time vault scan when the stage opens.
  // Never reads from disk on a keystroke: the scan runs once per open and
  // refreshes the already-open stage.
  collectStageBufferNotes() {
    const notes = new Map();
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return notes;
      }
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        const view = leaf && leaf.view;
        if (
          !view ||
          !view.file ||
          !view.editor ||
          typeof view.editor.getValue !== "function"
        ) {
          continue;
        }
        const path = normalizeVaultRelativePath(view.file.path || "");
        if (path && !notes.has(path)) {
          notes.set(path, String(view.editor.getValue() || ""));
        }
      }
    } catch (_error) {
      // Best effort: the vault scan still covers unopened notes.
    }
    return notes;
  }

  // Defensive read of the Tasks plugin cache. Tasks 8.4.0 exposes `id` and
  // `dependsOn` on each task; the exact accessor differs by version, so
  // every known shape is tried and anything unusable falls back to the
  // vault scan (still correct, just one read at open).
  readStageTasksCache() {
    try {
      const plugins =
        (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const tasksPlugin = plugins["obsidian-tasks-plugin"];
      if (!tasksPlugin) {
        return { ready: false, tasks: [] };
      }
      const apis = [tasksPlugin.apiV1, tasksPlugin.api, tasksPlugin].filter(
        Boolean,
      );
      for (const api of apis) {
        if (!api || typeof api.getTasks !== "function") {
          continue;
        }
        const state =
          typeof api.getState === "function" ? api.getState() : "Warm";
        if (state !== "Warm") {
          return { ready: false, tasks: [] };
        }
        const raw = api.getTasks();
        if (!Array.isArray(raw)) {
          continue;
        }
        const tasks = raw
          .map((entry) => normalizeStageCacheTask(entry))
          .filter(Boolean);
        return { ready: true, tasks };
      }
    } catch (_error) {
      // Fall through to the vault scan.
    }
    return { ready: false, tasks: [] };
  }

  buildVaultDependencyStage(args = {}) {
    const notes = [];
    for (const [path, content] of this.collectStageBufferNotes()) {
      notes.push({ path, content });
    }
    return this.buildVaultDependencyStageFromNotes(notes, args);
  }

  buildVaultDependencyStageFromNotes(bufferNotes, args = {}) {
    const ownerPath = normalizeVaultRelativePath(args.filePath || "");
    const text = String(args.content || "");
    const lines = text.split(/\r?\n/);
    const parents = (Array.isArray(args.parentLines) ? args.parentLines : [])
      .map((line) => Math.floor(numericOrDefault(line, Number.NaN)))
      .filter((line) => Number.isFinite(line) && line >= 0 && line < lines.length);
    const primary = parents.length > 0 ? parents[0] : -1;
    const notes = (Array.isArray(bufferNotes) ? bufferNotes : []).slice();
    const seen = new Set(notes.map((note) => normalizeVaultRelativePath(note.path || "")));
    if (ownerPath && !seen.has(ownerPath)) {
      notes.push({ path: ownerPath, content: text });
      seen.add(ownerPath);
    } else if (ownerPath) {
      for (const note of notes) {
        if (normalizeVaultRelativePath(note.path || "") === ownerPath) {
          note.content = text;
        }
      }
    }
    const files = new Map(
      notes.map((note) => [
        normalizeVaultRelativePath(note.path || ""),
        String(note.content || ""),
      ]),
    );
    const cache = this.readStageTasksCache();
    const dependentLines = new Set(parents);
    const snapshots = createDependencySnapshotMap(notes);
    const ownerSnapshot = ownerPath ? snapshots.get(ownerPath) : null;
    let candidates = collectVaultDependencyCandidatesFromSnapshots(snapshots, {
      dependentPath: ownerPath,
      dependentLines,
    });
    // An authoritative Warm cache is ready even when it holds zero tasks:
    // open-buffer tasks still participate, and no full-vault fallback runs
    // merely because the task array is empty.
    let cacheReady = false;
    if (cache.ready) {
      candidates = mergeStageCacheCandidates(cache.tasks, notes, {
        dependentPath: ownerPath,
        dependentLines,
      });
      cacheReady = true;
    }
    const index = indexDependencyStageNotesFromSnapshots(snapshots);
    registerStageCacheRecords(index, cache.ready ? cache.tasks : []);
    const edges = collectDependencyStageEdgesFromSnapshots(snapshots, index);
    mergeStageCacheEdges(edges, cache.ready ? cache.tasks : [], index);
    // Open prerequisite counts for the BLOCKED badge (`docs/task-dependencies.md`
    // §6.3, DC7/DC8): every Blocked candidate counts from its own Depends-On
    // line, whether or not it carries a `^blockId` — closed, missing, and
    // non-task targets never count, so one closed plus one open prerequisite
    // reads `waits on 1`. Candidates whose own line cannot be resolved fall
    // back to the edge graph below.
    const contentByPath = files;
    const edgeOpenCount = (candidate) => {
      const key =
        candidate.path && candidate.blockId
          ? dependencyStageRowKey(candidate.path, candidate.blockId)
          : null;
      const targets = (key && edges.get(key)) || [];
      let openPrereqs = 0;
      for (const target of targets) {
        const record = index.byKey.get(target);
        if (record && record.open) {
          openPrereqs += 1;
        }
      }
      return openPrereqs;
    };
    candidates = candidates.map((candidate) => {
      let openPrereqs = null;
      if (candidate.blocked) {
        const candidatePath = normalizeVaultRelativePath(candidate.path || "");
        const ownSnapshot = snapshots.get(candidatePath) || null;
        const ownContent = contentByPath.get(candidatePath);
        if (ownContent !== undefined && Number.isInteger(candidate.line)) {
          const resolved = resolveDependencyStageCurrent(
            ownContent,
            candidate.line,
            candidatePath,
            index,
            ownSnapshot,
          );
          if (resolved.ok) {
            openPrereqs = resolved.rows.filter((row) => row.open).length;
          }
        }
      }
      if (openPrereqs === null) {
        openPrereqs = edgeOpenCount(candidate);
      }
      // A Blocked candidate with no open prerequisite names its future
      // `scheduled` date when one blocks it (`🔒 scheduled YYYY-MM-DD`).
      let scheduledDate = null;
      if (candidate.blocked && openPrereqs === 0) {
        const ownContent = contentByPath.get(
          normalizeVaultRelativePath(candidate.path || ""),
        );
        const ownLines =
          ownContent !== undefined ? String(ownContent).split(/\r?\n/) : [];
        const ownLine =
          (candidate.rawLine !== undefined && candidate.rawLine !== null
            ? String(candidate.rawLine)
            : ownLines[candidate.line] !== undefined
              ? String(ownLines[candidate.line])
              : "");
        const field = findBulletPropertyField(ownLine, "scheduled");
        const raw = field ? String(field.value || "").trim() : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && dependencyParentHasFutureSchedule(ownLine)) {
          scheduledDate = raw;
        }
      }
      return Object.freeze({ ...candidate, openCount: openPrereqs, scheduledDate });
    });
    const currentRows = [];
    const linkedKeys = new Set();
    for (const parentLine of parents) {
      const resolved = resolveDependencyStageCurrent(
        text,
        parentLine,
        ownerPath,
        index,
        ownerSnapshot,
      );
      for (const row of resolved.ok ? resolved.rows : []) {
        const key =
          row.path && row.blockId
            ? dependencyStageRowKey(row.path, row.blockId)
            : `missing:${normalizeVaultRelativePath(row.path || "")}#^${row.blockId || ""}`;
        if (row.path && row.blockId) {
          linkedKeys.add(key);
        }
        if (!currentRows.some((entry) => entry.dedupeKey === key)) {
          currentRows.push({ ...row, dedupeKey: key });
        }
      }
    }
    const current = currentRows.map(({ dedupeKey, ...row }) => Object.freeze(row));
    const openCount = current.filter((row) => row.open).length;
    let dependentKey = null;
    let parentText = "";
    if (primary >= 0) {
      parentText = String(lines[primary] || "");
      const parentBlockId = getTrailingBlockId(parentText);
      const parentIdField = findBulletPropertyField(parentText, "id");
      const parentIdValue =
        parentIdField && normalizeBulletPropertyValue(parentIdField.value);
      dependentKey =
        (parentBlockId && dependencyStageRowKey(ownerPath, parentBlockId)) ||
        (parentIdValue ? `id:${parentIdValue}` : null);
    }
    const title =
      parents.length > 1
        ? `⛓ Depends on · ${formatCountLabel(parents.length, "task")}`
        : `⛓ Depends on · ${cleanTaskDisplayText(parentText).slice(0, 48)}`;
    return {
      candidates,
      current: Object.freeze(current),
      linkedKeys,
      edges,
      files,
      index,
      cacheReady,
      dependent: Object.freeze({
        path: ownerPath,
        line: primary,
        key: dependentKey,
        displayText: cleanTaskDisplayText(parentText) || null,
        text: cleanTaskDisplayText(parentText) || null,
      }),
      parentLines: Object.freeze(parents.slice()),
      sourceValueSets: Array.isArray(args.dependencyValueSets)
        ? args.dependencyValueSets
        : null,
      title,
      openCount,
      poolSize: candidates.length,
      refreshOf: null,
    };
  }

  buildVaultDependencyStageFromSnapshots(snapshots, args = {}, cache = null) {
    const ownerPath = normalizeVaultRelativePath(args.filePath || "");
    const text = String(args.content || "");
    const lines = text.split(/\r?\n/);
    const parents = (Array.isArray(args.parentLines) ? args.parentLines : [])
      .map((line) => Math.floor(numericOrDefault(line, Number.NaN)))
      .filter((line) => Number.isFinite(line) && line >= 0 && line < lines.length);
    const primary = parents.length > 0 ? parents[0] : -1;
    const resolvedCache = cache || { ready: false, tasks: [] };
    const dependentLines = new Set(parents);
    const ownerSnapshot = ownerPath ? snapshots.get(ownerPath) : null;
    let candidates = collectVaultDependencyCandidatesFromSnapshots(snapshots, {
      dependentPath: ownerPath,
      dependentLines,
    });
    let cacheReady = false;
    if (resolvedCache.ready) {
      const notes = [...snapshots].map(([path, snapshot]) => ({
        path,
        content: snapshot.text,
      }));
      candidates = mergeStageCacheCandidates(resolvedCache.tasks, notes, {
        dependentPath: ownerPath,
        dependentLines,
      });
      cacheReady = true;
    }
    const files = new Map(
      [...snapshots].map(([path, snapshot]) => [path, String(snapshot.text || "")]),
    );
    const index = indexDependencyStageNotesFromSnapshots(snapshots);
    registerStageCacheRecords(index, resolvedCache.ready ? resolvedCache.tasks : []);
    const edges = collectDependencyStageEdgesFromSnapshots(snapshots, index);
    mergeStageCacheEdges(edges, resolvedCache.ready ? resolvedCache.tasks : [], index);
    const contentByPath = files;
    const edgeOpenCount = (candidate) => {
      const key =
        candidate.path && candidate.blockId
          ? dependencyStageRowKey(candidate.path, candidate.blockId)
          : null;
      const targets = (key && edges.get(key)) || [];
      let openPrereqs = 0;
      for (const target of targets) {
        const record = index.byKey.get(target);
        if (record && record.open) {
          openPrereqs += 1;
        }
      }
      return openPrereqs;
    };
    candidates = candidates.map((candidate) => {
      let openPrereqs = null;
      if (candidate.blocked) {
        const candidatePath = normalizeVaultRelativePath(candidate.path || "");
        const ownSnapshot = snapshots.get(candidatePath) || null;
        const ownContent = contentByPath.get(candidatePath);
        if (ownContent !== undefined && Number.isInteger(candidate.line)) {
          const resolved = resolveDependencyStageCurrent(
            ownContent,
            candidate.line,
            candidatePath,
            index,
            ownSnapshot,
          );
          if (resolved.ok) {
            openPrereqs = resolved.rows.filter((row) => row.open).length;
          }
        }
      }
      if (openPrereqs === null) {
        openPrereqs = edgeOpenCount(candidate);
      }
      let scheduledDate = null;
      if (candidate.blocked && openPrereqs === 0) {
        const ownContent = contentByPath.get(
          normalizeVaultRelativePath(candidate.path || ""),
        );
        const ownLines =
          ownContent !== undefined ? String(ownContent).split(/\r?\n/) : [];
        const ownLine =
          (candidate.rawLine !== undefined && candidate.rawLine !== null
            ? String(candidate.rawLine)
            : ownLines[candidate.line] !== undefined
              ? String(ownLines[candidate.line])
              : "");
        const field = findBulletPropertyField(ownLine, "scheduled");
        const raw = field ? String(field.value || "").trim() : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && dependencyParentHasFutureSchedule(ownLine)) {
          scheduledDate = raw;
        }
      }
      return Object.freeze({ ...candidate, openCount: openPrereqs, scheduledDate });
    });
    const currentRows = [];
    const linkedKeys = new Set();
    for (const parentLine of parents) {
      const resolved = resolveDependencyStageCurrent(
        text,
        parentLine,
        ownerPath,
        index,
        ownerSnapshot,
      );
      for (const row of resolved.ok ? resolved.rows : []) {
        const key =
          row.path && row.blockId
            ? dependencyStageRowKey(row.path, row.blockId)
            : `missing:${normalizeVaultRelativePath(row.path || "")}#^${row.blockId || ""}`;
        if (row.path && row.blockId) {
          linkedKeys.add(key);
        }
        if (!currentRows.some((entry) => entry.dedupeKey === key)) {
          currentRows.push({ ...row, dedupeKey: key });
        }
      }
    }
    const current = currentRows.map(({ dedupeKey, ...row }) => Object.freeze(row));
    const openCount = current.filter((row) => row.open).length;
    let dependentKey = null;
    let parentText = "";
    if (primary >= 0) {
      parentText = String(lines[primary] || "");
      const parentBlockId = getTrailingBlockId(parentText);
      const parentIdField = findBulletPropertyField(parentText, "id");
      const parentIdValue =
        parentIdField && normalizeBulletPropertyValue(parentIdField.value);
      dependentKey =
        (parentBlockId && dependencyStageRowKey(ownerPath, parentBlockId)) ||
        (parentIdValue ? `id:${parentIdValue}` : null);
    }
    const title =
      parents.length > 1
        ? `⛓ Depends on · ${formatCountLabel(parents.length, "task")}`
        : `⛓ Depends on · ${cleanTaskDisplayText(parentText).slice(0, 48)}`;
    return {
      candidates,
      current: Object.freeze(current),
      linkedKeys,
      edges,
      files,
      index,
      cacheReady,
      dependent: Object.freeze({
        path: ownerPath,
        line: primary,
        key: dependentKey,
        displayText: cleanTaskDisplayText(parentText) || null,
        text: cleanTaskDisplayText(parentText) || null,
      }),
      parentLines: Object.freeze(parents.slice()),
      sourceValueSets: Array.isArray(args.dependencyValueSets)
        ? args.dependencyValueSets
        : null,
      title,
      openCount,
      poolSize: candidates.length,
      refreshOf: null,
    };
  }

  // One-time vault scan for stages that opened while the Tasks cache was
  // not Warm. Open buffers override the scan; the already-open stage keeps
  // its marks across the refresh. Reads and snapshot preparation run in
  // bounded chunks with a real event-loop yield between batches, tied to a
  // request generation so dismissal, stage leaves, or a newer request
  // abandons obsolete work before painting.
  async refreshVaultDependencyStage(modal, stage) {
    const requestId = (this._vaultDependencyRefreshSeq =
      (this._vaultDependencyRefreshSeq || 0) + 1);
    if (modal) {
      modal.vaultStageRefreshId = requestId;
    }
    const isLive = () =>
      Boolean(
        modal &&
          modal.vaultStage === stage &&
          modal.vaultStageRefreshId === requestId &&
          typeof modal.isLocalTaskStage === "function" &&
          modal.isLocalTaskStage(),
      );
    try {
      if (!isLive()) {
        return;
      }
      const vault = this.app && this.app.vault;
      if (
        !vault ||
        typeof vault.getMarkdownFiles !== "function" ||
        typeof vault.cachedRead !== "function"
      ) {
        return;
      }
      const files = vault.getMarkdownFiles() || [];
      const snapshots = new Map();
      let batchStart = Date.now();
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        if (!file || !file.path || !/\.md$/i.test(file.path)) {
          continue;
        }
        if (!isLive()) {
          return;
        }
        let content = null;
        try {
          content = String((await vault.cachedRead(file)) || "");
        } catch (_readError) {
          content = null;
        }
        if (!isLive()) {
          return;
        }
        if (content !== null) {
          const path = normalizeVaultRelativePath(file.path || "");
          if (path) {
            try {
              snapshots.set(path, createDependencyNoteSnapshot(content));
            } catch (_parseError) {
              // Best effort: skip unparsable notes, keep the sync pool.
            }
          }
        }
        const elapsed = Date.now() - batchStart;
        const atBatchEnd = (fileIndex + 1) % 12 === 0 || elapsed >= 10;
        if (atBatchEnd && fileIndex + 1 < files.length) {
          await vaultStageYield();
          batchStart = Date.now();
          if (!isLive()) {
            return;
          }
        }
      }
      if (!isLive()) {
        return;
      }
      for (const [path, content] of this.collectStageBufferNotes()) {
        if (!isLive()) {
          return;
        }
        const normalized = normalizeVaultRelativePath(path || "");
        if (!normalized) {
          continue;
        }
        try {
          snapshots.set(normalized, createDependencyNoteSnapshot(content));
        } catch (_parseError) {
          // Best effort: keep any vault-scan snapshot already prepared.
        }
        if (snapshots.size % 12 === 0) {
          await vaultStageYield();
          if (!isLive()) {
            return;
          }
        }
      }
      if (!isLive()) {
        return;
      }
      const parentLines = Array.isArray(stage.parentLines) && stage.parentLines.length > 0
        ? stage.parentLines.slice()
        : [stage.dependent.line];
      const request = {
        filePath: stage.dependent.path,
        content:
          modal.editor && typeof modal.editor.getValue === "function"
            ? String(modal.editor.getValue() || "")
            : "",
        parentLines,
        dependencyValueSets: stage.sourceValueSets,
      };
      // The owner buffer may have changed while the scan yielded: rebuild
      // only that snapshot so CURRENT rows match the live editor text.
      try {
        snapshots.set(
          normalizeVaultRelativePath(request.filePath || ""),
          createDependencyNoteSnapshot(request.content),
        );
      } catch (_parseError) {
        // Best effort: keep the buffer snapshot already prepared.
      }
      const fresh = this.buildVaultDependencyStageFromSnapshots(
        snapshots,
        request,
        { ready: false, tasks: [] },
      );
      fresh.refreshOf = stage;
      fresh.cacheReady = true;
      if (!isLive()) {
        return;
      }
      modal.applyVaultStageItems(fresh);
    } catch (_error) {
      // Best effort: the sync pool stays in place.
    }
  }

  // Task Link mode: the Depends on row edits the linked task in its own
  // note, named in the stage title (`docs/task-dependencies.md` §6.1).
  async openLinkedDependencyStage(target) {
    try {
      const path = normalizeVaultRelativePath((target && target.path) || "");
      if (!path) {
        new Notice("Linked task has no note");
        return false;
      }
      let editor =
        typeof this.getOpenMarkdownEditorForPath === "function"
          ? this.getOpenMarkdownEditorForPath(path)
          : null;
      if (!editor) {
        const vault = this.app && this.app.vault;
        const file =
          vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
        if (!file) {
          new Notice(`Linked note not found: ${path}`);
          return false;
        }
        const opened = await openMarkdownFileWithLeafReuse(
          this,
          file,
          `Could not open ${path}`,
        );
        if (!opened) {
          return false;
        }
        editor =
          typeof this.getOpenMarkdownEditorForPath === "function"
            ? this.getOpenMarkdownEditorForPath(path)
            : null;
        if (!editor) {
          new Notice(`Could not open ${path}`);
          return false;
        }
      }
      const line = Math.floor(numericOrDefault(target.line, Number.NaN));
      if (Number.isFinite(line)) {
        setEditorCursorSafely(editor, line, 0);
      }
      return this.openBulletPropertyPicker(editor, {
        initialProperty: "dependsOn",
      });
    } catch (_error) {
      new Notice("Could not open the linked task");
      return false;
    }
  }

  // Palette command `edit-task-dependencies` (no default hotkey, Q6): the
  // task under the cursor. Prose with several links, or a selection
  // spanning tasks, is refused with a short reason.
  openDependencyStageAtCursor(editor) {
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }
    const content = String(editor.getValue() || "");
    if (editorSelectionSpansTasks(editor, content)) {
      new Notice("Selection spans several tasks; put the cursor on one task");
      return false;
    }
    const entry = resolveDependencyStageEntry(content, cursor.line);
    if (entry.ok) {
      if (entry.parentLine !== cursor.line) {
        setEditorCursorSafely(editor, entry.parentLine, 0);
      }
      return this.openBulletPropertyPicker(editor, {
        initialProperty: "dependsOn",
      });
    }
    const lineText = getEditorLine(editor, cursor.line);
    if (lineText !== null && parseLinkPickerTaskLink(lineText)) {
      void this.openLinkPicker(editor).catch(() => false);
      return true;
    }
    if (lineText !== null && (lineText.match(/\[\[/g) || []).length >= 2) {
      new Notice("Several links here — put the cursor on one Task Link");
      return false;
    }
    return this.openBulletPropertyPicker(editor);
  }

  // nav api v2: open the vault-wide Depends on stage for the owning task
  // of `ref` (nav-stage; `docs/task-dependencies.md` §6).
  async openDependencyStageForRef(ref = {}) {
    try {
      const path = normalizeVaultRelativePath(ref.path || "");
      const hitLine = Math.floor(numericOrDefault(ref.line, Number.NaN));
      if (!path || !Number.isFinite(hitLine)) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const view = this.getActiveMarkdownView();
      const fileMatches =
        view && view.file && normalizeVaultRelativePath(view.file.path) === path;
      if (!fileMatches || !view.editor) {
        return Object.freeze({ ok: false, reason: "note-not-open" });
      }
      const content = String(view.editor.getValue() || "");
      const lines = content.split(/\r?\n/);
      if (hitLine < 0 || hitLine >= lines.length) {
        return Object.freeze({ ok: false, reason: "line-out-of-range" });
      }
      const owning = findOwningTaskLine(lines, hitLine);
      if (owning === null) {
        return Object.freeze({ ok: false, reason: "no-owning-task" });
      }
      setEditorCursorSafely(view.editor, owning, 0);
      const opened = this.openBulletPropertyPicker(view.editor, {
        initialProperty: "dependsOn",
      });
      if (!opened) {
        return Object.freeze({ ok: false, reason: "picker-not-opened" });
      }
      return Object.freeze({ ok: true });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "open-failed" });
    }
  }

  // nav api v2: remove one prerequisite through the single-transaction
  // writer. Re-reads the dependent and refuses with a notice when stale.
  async removeDependencyByRef(parentRef = {}, target = {}) {
    try {
      const path = normalizeVaultRelativePath(parentRef.path || "");
      const hitLine = Math.floor(
        numericOrDefault(parentRef.line, Number.NaN),
      );
      const blockId = normalizeBulletPropertyValue(target.blockId || "");
      const targetPath = normalizeVaultRelativePath(
        target.path || path,
      );
      if (!path || !Number.isFinite(hitLine) || !blockId) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const view = this.getActiveMarkdownView();
      const fileMatches =
        view && view.file && normalizeVaultRelativePath(view.file.path) === path;
      if (!fileMatches || !view.editor) {
        return Object.freeze({ ok: false, reason: "note-not-open" });
      }
      const content = String(view.editor.getValue() || "");
      const lines = content.split(/\r?\n/);
      if (hitLine < 0 || hitLine >= lines.length) {
        return Object.freeze({ ok: false, reason: "line-out-of-range" });
      }
      const owning = findOwningTaskLine(lines, hitLine);
      if (owning === null) {
        return Object.freeze({ ok: false, reason: "no-owning-task" });
      }
      // Contract §9: the dependent is re-read and the removal refuses when
      // the target is not on its line — never a silent `ok`.
      const owningLinks = collectDependencyNavigationBullets(content, owning);
      if (owningLinks.reason) {
        return Object.freeze({ ok: false, reason: owningLinks.reason });
      }
      const linkResolver = this.dependencyLinkpathResolver();
      const onLine = owningLinks.targets.some((entry) => {
        const entryPath = dependencyPathForLinkNote(
          entry.note,
          path,
          linkResolver,
        );
        return (
          normalizeVaultRelativePath(entryPath) === targetPath &&
          normalizeBulletPropertyValue(entry.blockId) === blockId
        );
      });
      if (!onLine) {
        new Notice("⛓ That dependency is not on this task");
        return Object.freeze({ ok: false, reason: "not-on-line" });
      }
      const outcome = await this.applyDependencyEdit({
        editor: view.editor,
        parentPath: path,
        parentLine: owning,
        add: [],
        remove: [{ path: targetPath, blockId }],
      });
      if (!outcome.ok) {
        new Notice(`⛓ Could not remove dependency (${outcome.reason})`);
      } else if (outcome.notice) {
        new Notice(outcome.notice);
      }
      return outcome.ok
        ? Object.freeze({ ok: true })
        : Object.freeze({ ok: false, reason: outcome.reason });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "remove-failed" });
    }
  }
}
