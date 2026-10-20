// Links stage vault pool (`docs/task-relations.md` Rules 7-8).
class BobNavigationHotkeysRelationStageMixin {
  buildVaultRelationStage(args = {}) {
    const notes = [];
    for (const [path, content] of this.collectStageBufferNotes()) {
      notes.push({ path, content });
    }
    return this.buildVaultRelationStageFromNotes(notes, args);
  }

  relationStageLiveIndex() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const api = holder && holder.api && holder.api.relationIndex;
      if (!api || Number(api.version) < 1 || typeof api.incoming !== "function") return null;
      if (typeof api.ready === "function" && api.ready() !== true) return null;
      return api;
    } catch (_error) {
      return null;
    }
  }

  decorateLinkedFromVaultStage(stage) {
    if (!stage) return null;
    const owner = (stage.sources || [])[0] || null;
    let previousDailyPath = "";
    try {
      const paths = this.readDependencyVaultFileList() || [];
      const daily = scheduledRecoveryDailyPaths(paths.map((path) => ({ path })));
      previousDailyPath = normalizeVaultRelativePath(daily.previous || "");
    } catch (_error) {
      previousDailyPath = "";
    }
    const api = this.relationStageLiveIndex();
    let current = [];
    if (api && owner && owner.blockId) {
      let incoming = [];
      try {
        incoming = api.incoming(owner.path, owner.blockId);
      } catch (_error) {
        incoming = [];
      }
      current = relationStageIncomingRowsFromEdges(
        incoming,
        stage.index,
        previousDailyPath,
      );
    }
    const linkedKeys = new Set(
      current.map((row) => relationStageRowKey(row.path, row.blockId)),
    );
    return {
      ...stage,
      direction: "from",
      current: Object.freeze(current),
      linkedKeys,
      previousDailyPath,
      incomingNeedsScan: !api && Boolean(owner && owner.blockId),
      title: `🪢 Linked from · ${String((owner && owner.displayText) || "this task").slice(0, 44)}`,
    };
  }

  buildVaultRelationStageFromNotes(bufferNotes, args = {}) {
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
    let candidates = collectVaultRelationCandidatesFromSnapshots(snapshots, {
      dependentPath: ownerPath,
      dependentLines,
    });
    let cacheReady = false;
    if (cache.ready) {
      candidates = mergeRelationStageCacheCandidates(cache.tasks, notes, {
        dependentPath: ownerPath,
        dependentLines,
      });
      cacheReady = true;
    }
    const index = indexDependencyStageNotesFromSnapshots(snapshots);
    registerStageCacheRecords(index, cache.ready ? cache.tasks : []);
    const currentRows = [];
    const linkedKeys = new Set();
    for (const parentLine of parents) {
      const resolved = resolveRelationStageCurrent(
        text,
        parentLine,
        ownerPath,
        index,
        ownerSnapshot,
      );
      for (const row of resolved.ok ? resolved.rows : []) {
        const key =
          row.path && row.blockId
            ? relationStageRowKey(row.path, row.blockId)
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
    const prerequisiteIds =
      primary >= 0
        ? relationStagePrerequisiteIdentities(text, primary, ownerPath, index)
        : new Set();
    let dependentKey = null;
    let parentText = "";
    if (primary >= 0) {
      parentText = String(lines[primary] || "");
      const parentBlockId = getTrailingBlockId(parentText);
      dependentKey = parentBlockId
        ? relationStageRowKey(ownerPath, parentBlockId)
        : null;
    }
    const raw = {
      candidates,
      current: Object.freeze(current),
      linkedKeys,
      files,
      index,
      cacheReady,
      prerequisiteIds,
      todayMap: new Map(),
      dependent: Object.freeze({
        path: ownerPath,
        line: primary,
        key: dependentKey,
        displayText: cleanTaskDisplayText(parentText) || null,
        text: cleanTaskDisplayText(parentText) || null,
      }),
      parentLines: Object.freeze(parents.slice()),
      poolSize: candidates.length,
      refreshOf: null,
    };
    const decorated = decorateRelationVaultStage(raw);
    return args.direction === "from"
      ? this.decorateLinkedFromVaultStage(decorated)
      : decorated;
  }

  // One-time vault scan for Links stages that opened while the Tasks cache
  // was not Warm. Mirrors `refreshVaultDependencyStage`: bounded chunks with
  // a real event-loop yield, tied to a request generation.
  async refreshVaultRelationStage(modal, stage) {
    const requestId = (this._vaultRelationRefreshSeq =
      (this._vaultRelationRefreshSeq || 0) + 1);
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
        direction: stage.direction || "to",
      };
      try {
        snapshots.set(
          normalizeVaultRelativePath(request.filePath || ""),
          createDependencyNoteSnapshot(request.content),
        );
      } catch (_parseError) {
        // Best effort: keep the buffer snapshot already prepared.
      }
      const fresh = this.buildVaultRelationStageFromSnapshots(
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
      if (fresh.direction === "from" && fresh.incomingNeedsScan) {
        void this.refreshVaultLinkedFromIncoming(modal, fresh);
      }
    } catch (_error) {
      // Best effort: the sync pool stays in place.
    }
  }

  buildVaultRelationStageFromSnapshots(snapshots, args = {}, cache = null) {
    const resolvedCache = cache || { ready: false, tasks: [] };
    const ownerPath = normalizeVaultRelativePath(args.filePath || "");
    const text = String(args.content || "");
    const lines = text.split(/\r?\n/);
    const parents = (Array.isArray(args.parentLines) ? args.parentLines : [])
      .map((line) => Math.floor(numericOrDefault(line, Number.NaN)))
      .filter((line) => Number.isFinite(line) && line >= 0 && line < lines.length);
    const primary = parents.length > 0 ? parents[0] : -1;
    const ownerSnapshot = ownerPath ? snapshots.get(ownerPath) : null;
    let candidates = collectVaultRelationCandidatesFromSnapshots(snapshots, {
      dependentPath: ownerPath,
      dependentLines: new Set(parents),
    });
    let cacheReady = false;
    if (resolvedCache.ready) {
      const notes = [...snapshots].map(([path, snapshot]) => ({
        path,
        content: snapshot.text,
      }));
      candidates = mergeRelationStageCacheCandidates(resolvedCache.tasks, notes, {
        dependentPath: ownerPath,
        dependentLines: new Set(parents),
      });
      cacheReady = true;
    }
    const files = new Map(
      [...snapshots].map(([path, snapshot]) => [path, String(snapshot.text || "")]),
    );
    const index = indexDependencyStageNotesFromSnapshots(snapshots);
    registerStageCacheRecords(index, resolvedCache.ready ? resolvedCache.tasks : []);
    const currentRows = [];
    const linkedKeys = new Set();
    for (const parentLine of parents) {
      const resolved = resolveRelationStageCurrent(
        text,
        parentLine,
        ownerPath,
        index,
        ownerSnapshot,
      );
      for (const row of resolved.ok ? resolved.rows : []) {
        const key =
          row.path && row.blockId
            ? relationStageRowKey(row.path, row.blockId)
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
    const prerequisiteIds =
      primary >= 0
        ? relationStagePrerequisiteIdentities(text, primary, ownerPath, index)
        : new Set();
    let parentText = "";
    if (primary >= 0) {
      parentText = String(lines[primary] || "");
    }
    const decorated = decorateRelationVaultStage({
      candidates,
      current: Object.freeze(current),
      linkedKeys,
      files,
      index,
      cacheReady,
      prerequisiteIds,
      todayMap: new Map(),
      dependent: Object.freeze({
        path: ownerPath,
        line: primary,
        key:
          primary >= 0 && getTrailingBlockId(parentText)
            ? relationStageRowKey(ownerPath, getTrailingBlockId(parentText))
            : null,
        displayText: cleanTaskDisplayText(parentText) || null,
        text: cleanTaskDisplayText(parentText) || null,
      }),
      parentLines: Object.freeze(parents.slice()),
      poolSize: candidates.length,
      refreshOf: null,
    });
    return args.direction === "from"
      ? this.decorateLinkedFromVaultStage(decorated)
      : decorated;
  }

  // The reverse stage's CURRENT is a raw-text scan only when the live index
  // is unavailable or still warming. Each result is generation-guarded so a
  // late vault read cannot overwrite a newer stage or an unsaved buffer.
  async refreshVaultLinkedFromIncoming(modal, stage) {
    const requestId = (this._linkedFromRefreshSeq = (this._linkedFromRefreshSeq || 0) + 1);
    if (modal) modal.linkedFromRefreshId = requestId;
    const isLive = () => Boolean(
      modal &&
      modal.vaultStage === stage &&
      modal.linkedFromRefreshId === requestId &&
      typeof modal.isLinkedFromStage === "function" &&
      modal.isLinkedFromStage(),
    );
    try {
      const owner = (stage.sources || [])[0] || null;
      if (!owner || !owner.blockId || !isLive()) return;
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getMarkdownFiles !== "function" || typeof vault.cachedRead !== "function") return;
      const files = vault.getMarkdownFiles() || [];
      const snapshots = new Map();
      let batchStart = Date.now();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file || !file.path || !/\.md$/i.test(file.path)) continue;
        if (!isLive()) return;
        let content = null;
        try { content = String((await vault.cachedRead(file)) || ""); } catch (_error) { content = null; }
        if (!isLive()) return;
        if (content !== null) {
          const path = normalizeVaultRelativePath(file.path);
          if (path) {
            try { snapshots.set(path, createDependencyNoteSnapshot(content)); } catch (_error) { /* skip */ }
          }
        }
        if ((index + 1) % 12 === 0 || Date.now() - batchStart >= 10) {
          await vaultStageYield();
          batchStart = Date.now();
          if (!isLive()) return;
        }
      }
      for (const [path, content] of this.collectStageBufferNotes()) {
        if (!isLive()) return;
        const normalized = normalizeVaultRelativePath(path || "");
        if (!normalized) continue;
        try { snapshots.set(normalized, createDependencyNoteSnapshot(content)); } catch (_error) { /* skip */ }
      }
      if (modal.editor && typeof modal.editor.getValue === "function") {
        const ownerPath = normalizeVaultRelativePath(owner.path || "");
        try { snapshots.set(ownerPath, createDependencyNoteSnapshot(String(modal.editor.getValue() || ""))); } catch (_error) { /* keep */ }
      }
      if (!isLive()) return;
      const index = indexDependencyStageNotesFromSnapshots(snapshots);
      let previousDailyPath = stage.previousDailyPath || "";
      let current = collectRelationStageIncomingFromSnapshots(
        snapshots,
        index,
        owner,
        previousDailyPath,
      ).map((row) => {
        const readOnly = row.archived === true || row.path === previousDailyPath;
        return Object.freeze({
          ...row,
          readOnly,
          disabled: readOnly,
          disabledReason: readOnly ? "This source task is in a read-only note" : null,
        });
      });
      const linkedKeys = new Set(current.map((row) => relationStageRowKey(row.path, row.blockId)));
      const fresh = {
        ...stage,
        current: Object.freeze(current),
        linkedKeys,
        index,
        incomingNeedsScan: false,
      };
      if (!isLive()) return;
      modal.applyVaultStageItems(fresh);
    } catch (_error) {
      // The stage remains usable with an empty CURRENT list if scanning fails.
    }
  }

  // Palette/chord entry for Ctrl+Shift+L: on a LINKS line open the owner's
  // stage directly (LG8), else open the card one-shot on the Links to row.
  openLinksStageAtCursor(editor) {
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
    if (entry.ok && (entry.lineKind === "links" || entry.lineKind === "linked-from")) {
      setEditorCursorSafely(editor, entry.parentLine, 0);
      return this.openBulletPropertyPicker(editor, {
        reopenLinksStage: true,
      });
    }
    return this.openBulletPropertyPicker(editor, {
      initialTaskCardRow: "links-to",
    });
  }

  // Reverse-stage chord/palette entry (`Ctrl+Shift+Alt+L`): line gestures
  // always resolve to the owning task, then open Linked from… there.
  openLinkedFromStageAtCursor(editor) {
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
    if (entry.ok && (entry.lineKind === "links" || entry.lineKind === "linked-from")) {
      setEditorCursorSafely(editor, entry.parentLine, 0);
      return this.openBulletPropertyPicker(editor, {
        reopenLinkedFromStage: true,
      });
    }
    return this.openBulletPropertyPicker(editor, {
      initialTaskCardRow: "linked-from",
    });
  }

  // nav api.relations.openStage for the Links ("to") direction. The reverse
  // direction stays unavailable until nav-linked-from lands.
  async openRelationStageForRef(ref = {}) {
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
      const from = ref.direction === "from";
      const opened = this.openBulletPropertyPicker(view.editor, from
        ? { reopenLinkedFromStage: true }
        : { reopenLinksStage: true });
      if (!opened) {
        return Object.freeze({ ok: false, reason: "picker-not-opened" });
      }
      return Object.freeze({ ok: true });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "open-failed" });
    }
  }
}
