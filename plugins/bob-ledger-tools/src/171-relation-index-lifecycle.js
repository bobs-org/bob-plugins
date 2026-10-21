class BobLedgerToolsRelationIndexMixin {
  initializeRelationIndex() {
    this.relationIndexTornDown = false;
    this.relationIndexFiles = new Map();
    this.relationIndexVersions = new Map();
    this.relationIndexListeners = new Set();
    this.relationIndexPendingTargetReads = new Set();
    this.relationIndexScanToken = 0;
    this.relationIndexReadyFlag = false;
    this.relationIndexGeneration = 0;
    this.relationIndexOverlay = null;
    this.relationIndexOverlayTimer = null;
    this.relationIndexState = {
      generation: 0,
      ready: false,
      forward: new Map(),
      reverse: new Map(),
      edges: [],
    };
    const plugin = this;
    this.relationIndexApiValue = Object.freeze({
      version: 1,
      get generation() {
        return plugin.relationIndexState.generation;
      },
      ready: () => plugin.relationIndexState.ready,
      outgoing: (path, blockIdOrLine) =>
        plugin.relationIndexOutgoing(path, blockIdOrLine),
      incoming: (path, blockId) => plugin.relationIndexIncoming(path, blockId),
      related: (path, blockIdOrLine) =>
        plugin.relationIndexRelated(path, blockIdOrLine),
      labelSuggestions: (prefix) => plugin.relationIndexLabelSuggestions(prefix),
      onChange: (listener) => plugin.relationIndexOnChange(listener),
    });
  }

  relationIndexApi() {
    return this.relationIndexApiValue;
  }

  relationIndexNormalizePath(path) {
    try {
      return typeof normalizePath === "function"
        ? normalizePath(String(path || "")).replace(/^\//u, "")
        : String(path || "").replace(/^\//u, "");
    } catch (error) {
      return String(path || "").replace(/^\//u, "");
    }
  }

  relationIndexIsMarkdownFile(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath && fileOrPath.path;
    return typeof path === "string" && /\.md$/iu.test(path);
  }

  relationIndexOnChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.relationIndexListeners.add(listener);
    return () => this.relationIndexListeners.delete(listener);
  }

  relationIndexOutgoing(path, blockIdOrLine) {
    try {
      const normalized = this.relationIndexNormalizePath(path);
      if (typeof blockIdOrLine === "number" && Number.isFinite(blockIdOrLine)) {
        return (this.relationIndexState.forward.get(relationTaskLineNumberIdentity(normalized, blockIdOrLine)) || []).slice();
      }
      let blockId = String(blockIdOrLine || "").trim();
      if (/^(?:[-*+]|\d+[.)])[ \t]+/u.test(blockId) || blockId.includes("#task") || blockId.includes("\n")) {
        const match = blockId.match(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/u);
        if (!match) return (this.relationIndexState.forward.get(relationTaskLineIdentity(normalized, blockId)) || []).slice();
        blockId = match[1];
      }
      if (blockId.startsWith("^")) blockId = blockId.slice(1);
      return (this.relationIndexState.forward.get(relationIdentity(normalized, blockId)) || []).slice();
    } catch (error) {
      return [];
    }
  }

  relationIndexIncoming(path, blockId) {
    try {
      const normalized = this.relationIndexNormalizePath(path);
      let id = String(blockId || "").trim();
      if (id.startsWith("^")) id = id.slice(1);
      return (this.relationIndexState.reverse.get(relationIdentity(normalized, id)) || []).slice();
    } catch (error) {
      return [];
    }
  }

  // Additive per-task pair view (ledger-chips): one entry per plainly
  // related task (deduped by pair, `storedOn: "this" | "other" | "both"`),
  // then the labelled statements, with redundant plain records hidden.
  // Same generation as `outgoing` / `incoming`, which behave exactly as
  // before. `api.relationIndex` stays `version: 1`; callers
  // feature-detect `typeof api.related === "function"`. The result
  // carries `generation` and `ready` so callers tell loading from none.
  relationIndexRelated(path, blockIdOrLine) {
    const empty = () => ({
      generation: this.relationIndexState.generation,
      ready: this.relationIndexState.ready,
      plain: [],
      outgoing: [],
      incoming: [],
    });
    try {
      const normalized = this.relationIndexNormalizePath(path);
      let ownerId = "";
      let forwardEdges = [];
      let reverseEdges = [];
      if (typeof blockIdOrLine === "number" && Number.isFinite(blockIdOrLine)) {
        ownerId = "line-number:" + String(blockIdOrLine);
        forwardEdges = (this.relationIndexState.forward.get(
          relationTaskLineNumberIdentity(normalized, blockIdOrLine),
        ) || []).slice();
      } else {
        let blockId = String(blockIdOrLine || "").trim();
        if (/^(?:[-*+]|\d+[.)])[ \t]+/u.test(blockId) || blockId.includes("#task") || blockId.includes("\n")) {
          const match = blockId.match(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/u);
          if (match) {
            blockId = match[1];
          } else {
            ownerId = "line:" + blockId.trim();
            forwardEdges = (this.relationIndexState.forward.get(
              relationTaskLineIdentity(normalized, blockId),
            ) || []).slice();
          }
        }
        if (!ownerId) {
          if (blockId.startsWith("^")) blockId = blockId.slice(1);
          if (!blockId) return empty();
          ownerId = blockId;
          forwardEdges = (this.relationIndexState.forward.get(
            relationIdentity(normalized, blockId),
          ) || []).slice();
          reverseEdges = (this.relationIndexState.reverse.get(
            relationIdentity(normalized, blockId),
          ) || []).slice();
        }
      }
      const mapOutgoing = (edge) => {
        if (!edge || typeof edge !== "object") return null;
        const target = edge.target && typeof edge.target === "object" ? edge.target : {};
        if (!target.blockId) return null;
        return {
          label: typeof edge.label === "string" && edge.label ? edge.label : null,
          other: {
            path: String(target.path || ""),
            blockId: String(target.blockId || ""),
            line: target.line === undefined ? null : target.line,
            text: target.text === undefined ? null : target.text,
            status: target.status === undefined ? null : target.status,
            resolved: Boolean(target.resolved),
            archived: Boolean(target.archived),
          },
          relationLine: edge.relationLine === undefined ? null : edge.relationLine,
        };
      };
      const mapIncoming = (edge) => {
        if (!edge || typeof edge !== "object") return null;
        const source = edge.source && typeof edge.source === "object" ? edge.source : {};
        if (!source.blockId) return null;
        return {
          label: typeof edge.label === "string" && edge.label ? edge.label : null,
          other: {
            path: String(source.path || ""),
            blockId: String(source.blockId || ""),
            line: source.line === undefined ? null : source.line,
            text: source.text === undefined ? null : source.text,
            status: source.status === undefined ? null : source.status,
            resolved: true,
            archived: false,
          },
          relationLine: edge.relationLine === undefined ? null : edge.relationLine,
        };
      };
      const outgoing = forwardEdges.map(mapOutgoing).filter(Boolean);
      const incoming = reverseEdges.map(mapIncoming).filter(Boolean);
      const grouped = relationGroupRelatedEdges(normalized, ownerId, outgoing, incoming);
      return {
        generation: this.relationIndexState.generation,
        ready: this.relationIndexState.ready,
        plain: grouped.plain,
        outgoing: grouped.outgoing,
        incoming: grouped.incoming,
      };
    } catch (error) {
      return empty();
    }
  }

  relationIndexLabelSuggestions(prefix) {
    try {
      return relationLabelSuggestionRows(this.relationIndexState.edges, prefix);
    } catch (error) {
      return [];
    }
  }

  relationIndexCacheFor(fileOrPath) {
    try {
      const cache = this.app && this.app.metadataCache;
      if (!cache) return null;
      if (typeof fileOrPath !== "string" && typeof cache.getFileCache === "function") {
        const result = cache.getFileCache(fileOrPath);
        if (result) return result;
      }
      const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath && fileOrPath.path;
      if (path && typeof cache.getCache === "function") return cache.getCache(path) || null;
    } catch (error) {
      return null;
    }
    return null;
  }

  relationIndexHasBlockLinks(file) {
    try {
      const cache = this.relationIndexCacheFor(file);
      if (!cache) return false;
      const links = [
        ...(Array.isArray(cache.links) ? cache.links : []),
        ...(Array.isArray(cache.embeds) ? cache.embeds : []),
      ];
      return links.some((item) => /#\^[A-Za-z0-9-]+/u.test(String(item && item.link || "")));
    } catch (error) {
      return false;
    }
  }

  relationIndexHasCachedBlock(fileOrPath, blockId) {
    const id = String(blockId || "");
    const cache = this.relationIndexCacheFor(fileOrPath);
    const blocks = cache && cache.blocks;
    if (!blocks || typeof blocks !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(blocks, id) || Object.prototype.hasOwnProperty.call(blocks, "^" + id)) return true;
    return Object.values(blocks).some((item) => item && String(item.id || "").replace(/^\^/u, "") === id);
  }

  relationIndexResolvePath(target, sourcePath) {
    const raw = String(target || "").trim();
    if (!raw) return this.relationIndexNormalizePath(sourcePath);
    try {
      const metadata = this.app && this.app.metadataCache;
      const dest = metadata && typeof metadata.getFirstLinkpathDest === "function"
        ? metadata.getFirstLinkpathDest(raw, sourcePath)
        : null;
      return dest && typeof dest.path === "string" ? this.relationIndexNormalizePath(dest.path) : null;
    } catch (error) {
      return null;
    }
  }

  relationIndexTaskMemo() {
    const byPathAndLine = new Map();
    try {
      const tasks = planBlockTasks(this.app) || [];
      for (const task of tasks) {
        if (!task || typeof task.path !== "string") continue;
        const line = Number(task.lineNumber);
        if (!Number.isFinite(line)) continue;
        byPathAndLine.set(relationIdentity(this.relationIndexNormalizePath(task.path), String(line)), task);
      }
    } catch (error) {
      // The index remains useful from raw note text when Tasks is unavailable.
    }
    return byPathAndLine;
  }

  relationIndexDisplayTask(raw, taskMemo) {
    if (!raw) return null;
    const path = this.relationIndexNormalizePath(raw.path);
    const memo = taskMemo.get(relationIdentity(path, String(raw.line - 1))) || taskMemo.get(relationIdentity(path, String(raw.line)));
    if (!memo) return { ...raw };
    const status = memo.status && (memo.status.type || memo.status.name || memo.status.symbol)
      ? (memo.status.type || memo.status.name || memo.status.symbol)
      : raw.status;
    const text = memo.description || memo.originalMarkdown || memo.text || raw.text;
    return { ...raw, status, text, fromTaskMemo: true };
  }

  relationIndexScheduleTargetRead(file) {
    if (!file || typeof file.path !== "string") return;
    if (!this.relationIndexIsMarkdownFile(file)) return;
    const path = this.relationIndexNormalizePath(file.path);
    if (!path || this.relationIndexFiles.has(path) || this.relationIndexPendingTargetReads.has(path)) return;
    const vault = this.app && this.app.vault;
    const read = vault && (vault.cachedRead || vault.read);
    if (typeof read !== "function") return;
    this.relationIndexPendingTargetReads.add(path);
    const version = this.relationIndexVersions.get(path) || 0;
    Promise.resolve(read.call(vault, file)).then((content) => {
      if ((this.relationIndexVersions.get(path) || 0) !== version || !this.relationIndexPendingTargetReads.has(path)) return;
      this.relationIndexFiles.set(path, parseTaskRelationFile(content, path));
      this.relationIndexPendingTargetReads.delete(path);
      this.publishRelationIndex();
    }).catch(() => {
      this.relationIndexPendingTargetReads.delete(path);
    });
  }

  relationIndexScheduleFileRead(file) {
    if (!file || typeof file.path !== "string") return;
    if (!this.relationIndexIsMarkdownFile(file)) return;
    const path = this.relationIndexNormalizePath(file.path);
    const version = (this.relationIndexVersions.get(path) || 0) + 1;
    this.relationIndexVersions.set(path, version);
    const vault = this.app && this.app.vault;
    const read = vault && (vault.cachedRead || vault.read);
    if (typeof read !== "function") return;
    Promise.resolve(read.call(vault, file)).then((content) => {
      this.relationIndexApplyFile(path, content, version);
    }).catch(() => {
      // Keep the last known file snapshot when a transient vault read fails.
    });
  }

  relationIndexApplyFile(path, content, expectedVersion) {
    const normalized = this.relationIndexNormalizePath(path);
    if (!normalized || (expectedVersion !== undefined && (this.relationIndexVersions.get(normalized) || 0) !== expectedVersion)) return false;
    this.relationIndexFiles.set(normalized, parseTaskRelationFile(content, normalized));
    this.publishRelationIndex();
    return true;
  }

  relationIndexRemoveFile(path) {
    const normalized = this.relationIndexNormalizePath(path);
    if (!normalized) return;
    this.relationIndexVersions.set(normalized, (this.relationIndexVersions.get(normalized) || 0) + 1);
    this.relationIndexFiles.delete(normalized);
    if (this.relationIndexOverlay && this.relationIndexOverlay.path === normalized) this.relationIndexOverlay = null;
    this.publishRelationIndex();
  }

  relationIndexHandleRename(file, oldPath) {
    const before = this.relationIndexNormalizePath(oldPath);
    const after = this.relationIndexNormalizePath(file && file.path);
    if (before && before !== after) this.relationIndexRemoveFile(before);
    if (file && after) this.relationIndexScheduleFileRead(file);
  }

  relationIndexActiveEditor() {
    try {
      const view = getActiveMarkdownView(this.app);
      const file = view && view.file;
      const editor = view && view.editor;
      if (!file || typeof file.path !== "string" || !editor || typeof editor.getValue !== "function") return null;
      return { path: this.relationIndexNormalizePath(file.path), content: String(editor.getValue()) };
    } catch (error) {
      return null;
    }
  }

  refreshRelationIndexOverlay() {
    const active = this.relationIndexActiveEditor();
    const next = active && active.path ? active : null;
    const previous = this.relationIndexOverlay;
    if ((!previous && !next) || (previous && next && previous.path === next.path && previous.content === next.content)) return false;
    this.relationIndexOverlay = next;
    this.publishRelationIndex();
    return true;
  }

  scheduleRelationIndexOverlayRefresh() {
    if (this.relationIndexOverlayTimer !== null) clearTimeout(this.relationIndexOverlayTimer);
    this.relationIndexOverlayTimer = setTimeout(() => {
      this.relationIndexOverlayTimer = null;
      this.refreshRelationIndexOverlay();
    }, 75);
  }

  relationIndexPrefilter(file) {
    if (!this.relationIndexIsMarkdownFile(file)) return false;
    return this.relationIndexHasBlockLinks(file);
  }

  // Athena sample (2026-10-20): the cold scan over a temporary, Markdown-only
  // copy of ~/bob (6,432 notes; 3,162 block-link-prefilter candidates) took
  // 256.87 ms; the current vault copy had no relation edges yet. A warm update
  // of a 292,989-byte copy of its largest daily note, padded with 250 synthetic
  // same-note relations, took 13.21 ms. That sample did not include Obsidian's
  // vault-load create replay, which in 1.60.0 read every vault file (about
  // 3.5 GB on the MacBook) and OOM-crashed the renderer. Relation listeners
  // are therefore registered at layout-ready. Re-run
  // scripts/measure-ledger-tools-relation-index.cjs after parser/lifecycle work.
  // Keep the scan chunked as vault size grows, despite this sample staying below 1s.
  startRelationIndexScan() {
    if (this.relationIndexTornDown) return;
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") return;
    const token = ++this.relationIndexScanToken;
    this.relationIndexReadyFlag = false;
    this.publishRelationIndex();
    let files = [];
    try {
      files = vault.getMarkdownFiles().filter((file) => this.relationIndexPrefilter(file));
    } catch (error) {
      this.relationIndexReadyFlag = true;
      this.publishRelationIndex();
      return;
    }
    let offset = 0;
    const scanChunk = async () => {
      if (token !== this.relationIndexScanToken) return;
      const chunk = files.slice(offset, offset + 24);
      offset += chunk.length;
      await Promise.all(chunk.map(async (file) => {
        const path = this.relationIndexNormalizePath(file && file.path);
        if (!path) return;
        const version = this.relationIndexVersions.get(path) || 0;
        try {
          const read = vault.cachedRead || vault.read;
          if (typeof read !== "function") return;
          const content = await read.call(vault, file);
          if (token !== this.relationIndexScanToken || (this.relationIndexVersions.get(path) || 0) !== version || this.relationIndexNormalizePath(file.path) !== path) return;
          this.relationIndexFiles.set(path, parseTaskRelationFile(content, path));
        } catch (error) {
          // One unreadable note does not prevent the remainder from indexing.
        }
      }));
      if (token !== this.relationIndexScanToken) return;
      this.publishRelationIndex(offset >= files.length);
      if (offset < files.length) setTimeout(scanChunk, 0);
      else this.refreshRelationIndexOverlay();
    };
    if (!files.length) {
      this.relationIndexReadyFlag = true;
      this.refreshRelationIndexOverlay();
      this.publishRelationIndex(true);
    } else {
      setTimeout(scanChunk, 0);
    }
  }

  publishRelationIndex(ready = this.relationIndexReadyFlag) {
    const records = new Map(this.relationIndexFiles);
    if (this.relationIndexOverlay) {
      records.set(this.relationIndexOverlay.path, parseTaskRelationFile(this.relationIndexOverlay.content, this.relationIndexOverlay.path));
    }
    const taskMemo = this.relationIndexTaskMemo();
    const forward = new Map();
    const reverse = new Map();
    const edges = [];
    for (const [sourcePath, record] of records) {
      if (!record || !Array.isArray(record.outgoing)) continue;
      for (const sourceEdge of record.outgoing) {
        const source = this.relationIndexDisplayTask(sourceEdge.source, taskMemo) || sourceEdge.source;
        const targetPath = this.relationIndexResolvePath(sourceEdge.targetRef.path, sourcePath);
        const targetRecord = targetPath ? records.get(targetPath) : null;
        const cachedBlock = targetPath && this.relationIndexHasCachedBlock(targetPath, sourceEdge.targetRef.blockId);
        const targetTask = targetRecord && targetRecord.tasks.get(sourceEdge.targetRef.blockId);
        const targetExistsInText = Boolean(targetTask);
        const resolved = Boolean(targetPath && (cachedBlock || targetExistsInText));
        const targetFile = targetPath && this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(targetPath)
          : null;
        if (targetPath && !targetRecord && targetFile) this.relationIndexScheduleTargetRead(targetFile);
        const targetRaw = targetTask || (targetRecord && Array.from(targetRecord.tasks.values()).find((task) => task.blockId === sourceEdge.targetRef.blockId));
        let target = {
          path: targetPath,
          blockId: sourceEdge.targetRef.blockId,
          line: targetRaw ? targetRaw.line : null,
          text: targetRaw ? targetRaw.text : null,
          status: targetRaw ? targetRaw.status : null,
          resolved,
          archived: Boolean(targetPath && /(^|\/)done\//iu.test(targetPath)),
        };
        if (targetRaw && targetRecord) target = { ...target, ...this.relationIndexDisplayTask(targetRaw, taskMemo), resolved, archived: Boolean(targetPath && /(^|\/)done\//iu.test(targetPath)) };
        const edge = {
          source: { path: sourcePath, blockId: source.blockId, line: source.line, text: source.text, status: source.status },
          target,
          label: sourceEdge.label,
          relationLine: sourceEdge.relationLine,
          raw: sourceEdge.raw,
          embedded: sourceEdge.embedded,
          struck: sourceEdge.struck,
          resolved,
        };
        if (source.blockId) {
          const sourceKey = relationIdentity(sourcePath, source.blockId);
          if (!forward.has(sourceKey)) forward.set(sourceKey, []);
          forward.get(sourceKey).push(edge);
        }
        const sourceLineKey = relationTaskLineIdentity(sourcePath, sourceEdge.source.text);
        if (!forward.has(sourceLineKey)) forward.set(sourceLineKey, []);
        forward.get(sourceLineKey).push(edge);
        const sourceLineNumberKey = relationTaskLineNumberIdentity(sourcePath, sourceEdge.source.line);
        if (!forward.has(sourceLineNumberKey)) forward.set(sourceLineNumberKey, []);
        forward.get(sourceLineNumberKey).push(edge);
        if (resolved) {
          const targetKey = relationIdentity(targetPath, sourceEdge.targetRef.blockId);
          if (!reverse.has(targetKey)) reverse.set(targetKey, []);
          reverse.get(targetKey).push(edge);
        }
        edges.push(edge);
      }
    }
    const generation = this.relationIndexGeneration + 1;
    const snapshot = { generation, ready: Boolean(ready), forward, reverse, edges };
    // Publish both directions together; no consumer can observe half a rebuild.
    this.relationIndexGeneration = generation;
    this.relationIndexReadyFlag = Boolean(ready);
    this.relationIndexState = snapshot;
    for (const listener of this.relationIndexListeners) {
      try {
        listener({ generation, ready: snapshot.ready });
      } catch (error) {
        // One consumer cannot interrupt the shared index.
      }
    }
  }

  setupRelationIndex() {
    if (this.relationIndexTornDown) return;
    const metadata = this.app && this.app.metadataCache;
    if (metadata && typeof metadata.on === "function") {
      this.registerEvent(metadata.on("changed", (file, data) => {
        if (!this.relationIndexIsMarkdownFile(file)) return;
        const path = this.relationIndexNormalizePath(file && file.path);
        if (!path) return;
        const version = (this.relationIndexVersions.get(path) || 0) + 1;
        this.relationIndexVersions.set(path, version);
        if (typeof data === "string") this.relationIndexApplyFile(path, data, version);
        else this.relationIndexScheduleFileRead(file);
      }));
    }
    const vault = this.app && this.app.vault;
    if (vault && typeof vault.on === "function") {
      this.registerEvent(vault.on("create", (file) => this.relationIndexScheduleFileRead(file)));
      this.registerEvent(vault.on("modify", (file) => this.relationIndexScheduleFileRead(file)));
      this.registerEvent(vault.on("delete", (file) => this.relationIndexRemoveFile(file && file.path)));
      this.registerEvent(vault.on("rename", (file, oldPath) => this.relationIndexHandleRename(file, oldPath)));
    }
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      this.registerEvent(workspace.on("active-leaf-change", () => this.scheduleRelationIndexOverlayRefresh()));
      this.registerEvent(workspace.on("file-open", () => this.scheduleRelationIndexOverlayRefresh()));
    }
  }

  teardownRelationIndex() {
    this.relationIndexTornDown = true;
    this.relationIndexScanToken = (this.relationIndexScanToken || 0) + 1;
    if (
      this.relationIndexOverlayTimer !== null &&
      this.relationIndexOverlayTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.relationIndexOverlayTimer);
    }
    this.relationIndexOverlayTimer = null;
    if (this.relationIndexListeners && typeof this.relationIndexListeners.clear === "function") {
      this.relationIndexListeners.clear();
    }
  }
}
