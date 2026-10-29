// §19 kill switch: `relations.linked_from_mentions` (default false).
// Missing, invalid, or unreadable values stay disabled so the switch is
// lossless; cache by mtime/size like nav's loader. Warns in the
// `linked_from_lines` wording pattern on invalid values.
let relationIndexMentionsConfigCache = { key: null, value: false };

function resetRelationIndexMentionsConfigCache() {
  relationIndexMentionsConfigCache = { key: null, value: false };
}

function relationIndexMentionsStatKey(fsModule, configPath) {
  try {
    if (!fsModule || typeof fsModule.statSync !== "function") return null;
    const stat = fsModule.statSync(configPath);
    const mtime = stat && stat.mtimeMs != null ? stat.mtimeMs : stat && stat.mtime ? Number(stat.mtime) : "?";
    const size = stat && stat.size != null ? stat.size : "?";
    return `${mtime}:${size}`;
  } catch (error) {
    return error && error.code === "ENOENT" ? "missing" : null;
  }
}

function loadRelationIndexMentionsEnabled(options = {}) {
  const env = options.env || (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? (typeof planRequireOptionalNodeModule === "function" ? planRequireOptionalNodeModule("os") : null)
    : options.osModule;
  const fsModule = options.fsModule === undefined
    ? (typeof planRequireOptionalNodeModule === "function" ? planRequireOptionalNodeModule("fs") : null)
    : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") return false;
  let configPath = options.configPath || null;
  if (!configPath) {
    try {
      if (typeof planConfigPath === "function") configPath = planConfigPath({ env, osModule });
      else if (typeof getBulletPropertyConfigPath === "function") configPath = getBulletPropertyConfigPath({ env, osModule });
    } catch (error) { /* fall through to default */ }
  }
  if (!configPath) return false;
  const statKey = relationIndexMentionsStatKey(fsModule, configPath);
  const key = statKey == null ? null : `${configPath}|${statKey}`;
  if (key != null && relationIndexMentionsConfigCache.key === key) {
    return relationIndexMentionsConfigCache.value;
  }
  let enabled = false;
  try {
    const parse = options.parseYaml === undefined
      ? (typeof parseYaml === "function" ? parseYaml : null)
      : options.parseYaml;
    if (typeof parse === "function") {
      const config = parse(fsModule.readFileSync(configPath, "utf8"));
      const value = config && config.relations && config.relations.linked_from_mentions;
      if (typeof value === "boolean") {
        enabled = value;
      } else if (value !== undefined && value !== null) {
        enabled = false;
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("relations.linked_from_mentions is invalid; treating as false");
        }
      }
    }
  } catch (_error) {
    enabled = false;
  }
  if (key != null) relationIndexMentionsConfigCache = { key, value: enabled };
  return enabled;
}

// §19 M4/M7 resolution shared by publish and scanMentions.
// `records` maps normalized path -> parseTaskRelationFile output.
// `resolvePath` is (target, sourcePath) -> normalized path or null.
// Returns `{mentionPairs, relationPairs, dependencyPairs}` where each pair
// is `{sourceKey, targetKey, source, target}` plus occurrences for mentions.
function relationIndexResolveMentionPairs(records, resolvePath, opts = {}) {
  const includeUnresolved = opts.includeUnresolved === true;
  const isCachedBlock = typeof opts.isCachedBlock === "function" ? opts.isCachedBlock : null;
  const mentionGroups = new Map();
  const relationPairs = new Map();
  const dependencyPairs = new Map();
  const targetInfo = new Map();
  const getTargetInfo = (targetPath, blockId) => {
    const key = `${targetPath}\u0000${blockId}`;
    if (targetInfo.has(key)) return targetInfo.get(key);
    const record = records.get(targetPath);
    const counts = record && record.taskIdCounts;
    const count = counts ? (counts.get(blockId) || 0) : 0;
    const task = record && record.tasks ? record.tasks.get(blockId) : null;
    let info = { record, count, task, unique: count === 1 && Boolean(task) };
    if (!info.unique && isCachedBlock) {
      // Live-index optimism (mirrors the relation edge path): the target
      // note is not parsed yet but the metadata cache already holds the
      // block, so resolve now and let the scheduled target read confirm
      // uniqueness on the next publish. Fixture vectors pass no cache and
      // stay strict (M4 duplicates ignored).
      try {
        if (isCachedBlock(targetPath, blockId)) {
          info = { record: record || null, count: 1, task: task || null, unique: true, cached: true };
        }
      } catch (error) { /* strict on cache failure */ }
    }
    targetInfo.set(key, info);
    return info;
  };
  // Relations (accepted LINKS) resolve exactly as the live index does.
  for (const [sourcePath, record] of records) {
    if (!record || !Array.isArray(record.outgoing)) continue;
    for (const edge of record.outgoing) {
      let targetPath = null;
      try {
        targetPath = resolvePath(edge.targetRef.path, sourcePath);
      } catch (error) { targetPath = null; }
      if (!targetPath) continue;
      const targetKey = `${targetPath}\u0000${edge.targetRef.blockId}`;
      const sourceKey = edge.sourceKey || `${sourcePath}\u0000${edge.source && edge.source.blockId ? edge.source.blockId : ""}`;
      relationPairs.set(`${sourceKey}\u0000${targetKey}`, { sourceKey, targetKey });
    }
  }
  // Dependencies (accepted Depends-On) resolve by path; existence is not
  // required for the join to suppress a mention row.
  for (const [sourcePath, record] of records) {
    if (!record || !Array.isArray(record.dependsOn)) continue;
    for (const dep of record.dependsOn) {
      let targetPath = null;
      try {
        targetPath = resolvePath(dep.targetRef.path, sourcePath);
      } catch (error) { targetPath = null; }
      if (!targetPath) continue;
      const targetKey = `${targetPath}\u0000${dep.targetRef.blockId}`;
      const sourceKey = dep.sourceKey || `${sourcePath}\u0000${dep.source && dep.source.blockId ? dep.source.blockId : ""}`;
      dependencyPairs.set(`${sourceKey}\u0000${targetKey}`, { sourceKey, targetKey });
    }
  }
  // Mentions: M4 resolution (same resolver as relations; silent on miss).
  for (const [sourcePath, record] of records) {
    if (!record || !Array.isArray(record.mentionOccurrences)) continue;
    for (const occurrence of record.mentionOccurrences) {
      let targetPath = null;
      try {
        targetPath = resolvePath(occurrence.targetRef.path, sourcePath);
      } catch (error) { targetPath = null; }
      if (!targetPath) continue;
      const info = getTargetInfo(targetPath, occurrence.targetRef.blockId);
      if (!info.unique) {
        if (!includeUnresolved) continue;
      }
      const targetKey = `${targetPath}\u0000${occurrence.targetRef.blockId}`;
      // M4 self-links are ignored silently.
      const sourceId = occurrence.source && occurrence.source.blockId ? String(occurrence.source.blockId) : "";
      const sourceCount = record.taskIdCounts ? (record.taskIdCounts.get(sourceId) || 0) : 0;
      if (sourceId && sourceCount === 1 && targetPath === sourcePath && occurrence.targetRef.blockId === sourceId) {
        continue;
      }
      const sourceKey = occurrence.sourceKey || `${sourcePath}\u0000${sourceId}`;
      const pairKey = `${sourceKey}\u0000${targetKey}`;
      if (!mentionGroups.has(pairKey)) {
        mentionGroups.set(pairKey, {
          sourceKey,
          targetKey,
          source: occurrence.source,
          sourcePath,
          targetPath,
          targetBlockId: occurrence.targetRef.blockId,
          targetTask: info.task || null,
          occurrences: [],
        });
      }
      mentionGroups.get(pairKey).occurrences.push(occurrence);
    }
  }
  // Sort occurrences in document order; display is embed only when every
  // occurrence is an embed (M5).
  for (const group of mentionGroups.values()) {
    group.occurrences.sort((left, right) => (left.line - right.line) || (left.ch - right.ch));
    group.display = group.occurrences.every((occurrence) => occurrence.isEmbed) ? "embed" : "mention";
    group.count = group.occurrences.length;
  }
  return { mentionGroups, relationPairs, dependencyPairs };
}

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
    this.relationIndexPublishPending = false;
    this.relationIndexTurnFlushScheduled = false;
    this.relationIndexTaskMemoCache = null;
    this.relationIndexState = {
      generation: 0,
      ready: false,
      forward: new Map(),
      reverse: new Map(),
      mentionReverse: new Map(),
      mentionGroups: new Map(),
      edges: [],
    };
    const plugin = this;
    this.relationIndexApiValue = Object.freeze({
      version: 2,
      get generation() {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexState.generation;
      },
      ready: () => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexState.ready;
      },
      outgoing: (path, blockIdOrLine) => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexOutgoing(path, blockIdOrLine);
      },
      incoming: (path, blockId) => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexIncoming(path, blockId);
      },
      labelSuggestions: (prefix) => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexLabelSuggestions(prefix);
      },
      linkedFrom: (path, blockId) => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexLinkedFrom(path, blockId);
      },
      scanMentions: (content, path) => {
        plugin.flushRelationIndexPublish();
        return plugin.relationIndexScanMentions(content, path);
      },
      onChange: (listener) => plugin.relationIndexOnChange(listener),
    });
    this.initializeRelationLabels();
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

  // §19 `relationIndex` v2: typed LINKED FROM rows. Relations keep their
  // v1 shape plus `alsoMentioned`; mentions carry display/count/occurrences.
  // Dependency-joined pairs are omitted from the mention group (M7).
  relationIndexLinkedFrom(path, blockId) {
    try {
      const normalized = this.relationIndexNormalizePath(path);
      let id = String(blockId || "").trim();
      if (id.startsWith("^")) id = id.slice(1);
      const key = relationIdentity(normalized, id);
      const relations = (this.relationIndexState.reverse.get(key) || []).map((edge) => ({
        ...edge,
        kind: "relation",
        alsoMentioned: Boolean(edge && edge.alsoMentioned),
      }));
      const mentions = (this.relationIndexState.mentionReverse.get(key) || []).map((row) => ({
        kind: "mention",
        source: row.source,
        display: row.display,
        count: row.count,
        occurrences: row.occurrences.map((occurrence) => ({ ...occurrence })),
      }));
      return [...relations, ...mentions];
    } catch (error) {
      return [];
    }
  }

  // §19 pure helper for nav's courtesy write: this note's resolved (S, T)
  // pairs with their occurrences (M1–M6 + M4; M7 applied by the caller).
  // Returns [] when the kill switch is off.
  relationIndexScanMentions(content, path) {
    try {
      if (!loadRelationIndexMentionsEnabled()) return [];
      const normalized = this.relationIndexNormalizePath(path);
      const parsed = parseTaskRelationFile(String(content || ""), normalized);
      const records = new Map(this.relationIndexFiles);
      records.set(normalized, parsed);
      if (this.relationIndexOverlay && this.relationIndexOverlay.path !== normalized) {
        try {
          records.set(
            this.relationIndexOverlay.path,
            parseTaskRelationFile(this.relationIndexOverlay.content, this.relationIndexOverlay.path),
          );
        } catch (error) { /* overlay stays best-effort */ }
      }
      const resolvePath = (target, sourcePath) => this.relationIndexResolvePath(target, sourcePath);
      const { mentionGroups } = relationIndexResolveMentionPairs(records, resolvePath, {
        isCachedBlock: (targetPath, blockId) => this.relationIndexHasCachedBlock(targetPath, blockId),
      });
      const pairs = [];
      for (const group of mentionGroups.values()) {
        if (group.sourcePath !== normalized) continue;
        pairs.push({
          source: group.source,
          sourceKey: group.sourceKey,
          target: group.targetTask || { path: group.targetPath, blockId: group.targetBlockId },
          targetKey: group.targetKey,
          display: group.display,
          count: group.count,
          occurrences: group.occurrences.map((occurrence) => ({
            line: occurrence.line,
            ch: occurrence.ch,
            site: occurrence.site,
            excerpt: occurrence.excerpt,
            embedded: occurrence.embedded,
            struck: occurrence.struck,
          })),
        });
      }
      pairs.sort((left, right) =>
        relationCodepointCompare(left.targetKey, right.targetKey) ||
        relationCodepointCompare(left.sourceKey, right.sourceKey));
      return pairs;
    } catch (error) {
      return [];
    }
  }

  relationIndexLabelSuggestions(prefix) {
    try {
      return this.relationLabelsRows(prefix, { hidden: "exclude" }).map((row) => ({
        label: row.name,
        count: row.count,
      }));
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
    if (this.relationIndexTaskMemoCache) return this.relationIndexTaskMemoCache;
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
    this.relationIndexTaskMemoCache = byPathAndLine;
    this.relationIndexEnsureTurnFlush();
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
      this.scheduleRelationIndexPublish();
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
    this.scheduleRelationIndexPublish();
    return true;
  }

  relationIndexRemoveFile(path) {
    const normalized = this.relationIndexNormalizePath(path);
    if (!normalized) return;
    this.relationIndexVersions.set(normalized, (this.relationIndexVersions.get(normalized) || 0) + 1);
    this.relationIndexFiles.delete(normalized);
    if (this.relationIndexOverlay && this.relationIndexOverlay.path === normalized) this.relationIndexOverlay = null;
    this.scheduleRelationIndexPublish();
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
    this.scheduleRelationIndexPublish();
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
  // are therefore registered at layout-ready. Event-driven publishes now
  // coalesce to one rebuild per microtask; re-run
  // scripts/measure-ledger-tools-relation-index.cjs after parser/lifecycle work.
  // Keep the scan chunked as vault size grows, despite this sample staying below 1s.
  // Mention-index sample, apollo (2026-10-29, with the §19 M1–M6 scanner and
  // M7 resolution live): 6,795 notes, 3,256 prefilter candidates, 189
  // relation edges, cold scan 1,322.85 ms, warm 292,989-byte daily update
  // 23.36 ms. The cold scan stays chunked (24 files per turn) so the colder
  // number is load-spread, not blocking.
  startRelationIndexScan() {
    if (this.relationIndexTornDown) return;
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") return;
    const token = ++this.relationIndexScanToken;
    this.relationIndexReadyFlag = false;
    this.scheduleRelationIndexPublish();
    let files = [];
    try {
      files = vault.getMarkdownFiles().filter((file) => this.relationIndexPrefilter(file));
    } catch (error) {
      this.relationIndexReadyFlag = true;
      this.scheduleRelationIndexPublish();
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
      this.scheduleRelationIndexPublish(offset >= files.length);
      if (offset < files.length) setTimeout(scanChunk, 0);
      else this.refreshRelationIndexOverlay();
    };
    if (!files.length) {
      this.relationIndexReadyFlag = true;
      this.refreshRelationIndexOverlay();
      this.scheduleRelationIndexPublish(true);
    } else {
      setTimeout(scanChunk, 0);
    }
  }

  // Event-driven rebuilds coalesce to one publish per microtask. A v1
  // api.relationIndex read flushes first so consumers never observe a
  // stale snapshot. The Tasks memo is reused for every rebuild in the
  // same turn.
  scheduleRelationIndexPublish(ready) {
    if (this.relationIndexTornDown) return;
    if (arguments.length > 0) this.relationIndexReadyFlag = Boolean(ready);
    this.relationIndexPublishPending = true;
    this.relationIndexEnsureTurnFlush();
  }

  relationIndexEnsureTurnFlush() {
    if (this.relationIndexTurnFlushScheduled) return;
    this.relationIndexTurnFlushScheduled = true;
    const run = () => {
      this.relationIndexTurnFlushScheduled = false;
      if (this.relationIndexTornDown) {
        this.relationIndexPublishPending = false;
        this.relationIndexTaskMemoCache = null;
        return;
      }
      this.flushRelationIndexPublish();
      this.relationIndexTaskMemoCache = null;
    };
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  flushRelationIndexPublish() {
    if (this.relationIndexTornDown || !this.relationIndexPublishPending) return false;
    this.relationIndexPublishPending = false;
    this.publishRelationIndex(this.relationIndexReadyFlag);
    return true;
  }

  publishRelationIndex(ready = this.relationIndexReadyFlag) {
    this.relationIndexPublishPending = false;
    const records = new Map(this.relationIndexFiles);
    if (this.relationIndexOverlay) {
      records.set(this.relationIndexOverlay.path, parseTaskRelationFile(this.relationIndexOverlay.content, this.relationIndexOverlay.path));
    }
    const taskMemo = this.relationIndexTaskMemo();
    const forward = new Map();
    const reverse = new Map();
    const mentionReverse = new Map();
    const mentionGroups = new Map();
    const edges = [];
    let mentionsEnabled = false;
    try {
      mentionsEnabled = loadRelationIndexMentionsEnabled();
    } catch (error) {
      mentionsEnabled = false;
    }
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
          sourceKey: sourceEdge.sourceKey || `${sourcePath}\u0000${source.blockId || ""}`,
          targetKey: targetPath ? `${targetPath}\u0000${sourceEdge.targetRef.blockId}` : null,
          target,
          label: sourceEdge.label,
          kind: "relation",
          alsoMentioned: false,
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
    // §19 mentions: same generation, same resolver, M7 precedence. When the
    // kill switch is off, no mention rows are published and scanMentions
    // returns [] (the loader above already gates that helper).
    if (mentionsEnabled) {
      try {
        // Schedule reads for mention-only targets so the next publish can
        // resolve them, mirroring the relation target-read path above.
        for (const [sourcePath, record] of records) {
          if (!record || !Array.isArray(record.mentionOccurrences)) continue;
          for (const occurrence of record.mentionOccurrences) {
            let targetPath = null;
            try {
              targetPath = this.relationIndexResolvePath(occurrence.targetRef.path, sourcePath);
            } catch (error) { targetPath = null; }
            if (!targetPath || records.get(targetPath)) continue;
            try {
              const targetFile = this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function"
                ? this.app.vault.getAbstractFileByPath(targetPath)
                : null;
              if (targetFile) this.relationIndexScheduleTargetRead(targetFile);
            } catch (error) { /* best-effort */ }
          }
        }
        const resolvePath = (target, sourcePath) => this.relationIndexResolvePath(target, sourcePath);
        const resolved = relationIndexResolveMentionPairs(records, resolvePath, {
          isCachedBlock: (targetPath, blockId) => this.relationIndexHasCachedBlock(targetPath, blockId),
        });
        for (const [pairKey, group] of resolved.mentionGroups) {
          mentionGroups.set(pairKey, group);
        }
        // Mixed pairs (MN8): the relation row keeps its label and gains the
        // trailing 💬 marker via `alsoMentioned`.
        for (const edge of edges) {
          if (!edge || !edge.sourceKey || !edge.targetKey) continue;
          if (mentionGroups.has(`${edge.sourceKey}\u0000${edge.targetKey}`)) {
            edge.alsoMentioned = true;
          }
        }
        // Mention rows: dependency-joined pairs omitted (M7); relation pairs
        // stay as relations (alsoMentioned above).
        for (const [pairKey, group] of mentionGroups) {
          if (resolved.relationPairs.has(pairKey)) continue;
          const reversePairKey = `${group.targetKey}\u0000${group.sourceKey}`;
          if (resolved.dependencyPairs.has(pairKey) || resolved.dependencyPairs.has(reversePairKey)) {
            continue;
          }
          const source = this.relationIndexDisplayTask(group.source, taskMemo) || group.source;
          const row = {
            kind: "mention",
            source: { path: group.sourcePath, blockId: source.blockId, line: source.line, text: source.text, status: source.status },
            sourceKey: group.sourceKey,
            targetKey: group.targetKey,
            display: group.display,
            count: group.count,
            occurrences: group.occurrences.map((occurrence) => ({
              line: occurrence.line,
              ch: occurrence.ch,
              site: occurrence.site,
              excerpt: occurrence.excerpt,
            })),
          };
          const targetKey = relationIdentity(group.targetPath, group.targetBlockId);
          if (!mentionReverse.has(targetKey)) mentionReverse.set(targetKey, []);
          mentionReverse.get(targetKey).push(row);
        }
        // Canonical order within each target group (source path/codepoint).
        for (const rows of mentionReverse.values()) {
          rows.sort((left, right) =>
            relationCodepointCompare(left.source.path, right.source.path) ||
            relationCodepointCompare(left.source.blockId || "", right.source.blockId || "") ||
            (left.source.line || 0) - (right.source.line || 0));
        }
      } catch (error) {
        // Mentions never break the relation index; relations still publish.
      }
    }
    const generation = this.relationIndexGeneration + 1;
    const snapshot = { generation, ready: Boolean(ready), forward, reverse, mentionReverse, mentionGroups, edges };
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
    this.relationLabelsNotifyChanged("catalog");
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
    this.setupRelationLabelsJournal();
  }

  teardownRelationIndex() {
    this.relationIndexTornDown = true;
    this.teardownRelationLabelsJournal();
    this.relationIndexScanToken = (this.relationIndexScanToken || 0) + 1;
    if (
      this.relationIndexOverlayTimer !== null &&
      this.relationIndexOverlayTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.relationIndexOverlayTimer);
    }
    this.relationIndexOverlayTimer = null;
    this.relationIndexPublishPending = false;
    this.relationIndexTaskMemoCache = null;
    if (this.relationIndexListeners && typeof this.relationIndexListeners.clear === "function") {
      this.relationIndexListeners.clear();
    }
  }
}
