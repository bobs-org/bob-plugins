// Links… stage view (`docs/task-relations.md` Rules 7–8). Pool, sources,
// CURRENT, and ranking over the vault-wide candidate set: the
// dependency-stage pool plus closed tasks and `done/` archives (ranked
// last). Only the owner's own LINKS line feeds CURRENT; nothing here reads
// a LINKED FROM line.

function relationStageRowKey(path, blockId) {
  return dependencyStageRowKey(path, blockId);
}

// RESULTS exclusions mirror `isDependencyStageExcludedPath` except that
// `done/` archives stay: they are linkable targets whose LINKED FROM shows
// live only (LG6). Daily notes, `_templates`, `_generated`, `_conflicts`,
// dot-directories, and unsafe paths stay excluded.
function isRelationStageExcludedPath(path) {
  const normalized = String(path || "").replace(/\\/g, "");
  if (!normalized || isUnsafeVaultPath(normalized)) {
    return true;
  }
  if (/^\d{4}\/\d{8}\.md$/i.test(normalized)) {
    return true;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment.startsWith(".") ||
        segment === "_templates" ||
        segment === "_generated" ||
        segment === "_conflicts",
    )
  ) {
    return true;
  }
  return false;
}

function isRelationStageArchivedPath(path) {
  return /^done\//i.test(String(path || ""));
}

function relationStageCandidateFromEntry(path, entry) {
  const route = dependencyStageRouteOf(path);
  const archived = isRelationStageArchivedPath(path);
  return Object.freeze({
    path,
    route,
    note: dependencyStageBasenameOf(path),
    line: entry.line,
    rawLine: entry.rawLine,
    status: entry.status,
    displayText: entry.text,
    text: entry.text,
    blockId: entry.blockId,
    existingBlockId: entry.blockId,
    idField: entry.idField,
    existingIdField: entry.idField,
    section: entry.section,
    open: entry.open === true,
    closed: entry.open !== true,
    archived,
    blocked: entry.blocked === true,
    hidden: entry.hidden === true,
  });
}

function collectVaultRelationCandidatesFromSnapshots(snapshots, options = {}) {
  const dependentPath = normalizeVaultRelativePath(options.dependentPath || "");
  const dependentLines =
    options.dependentLines instanceof Set
      ? options.dependentLines
      : new Set(options.dependentLines || []);
  const out = [];
  for (const [path, snapshot] of snapshots) {
    if (!path || isRelationStageExcludedPath(path)) {
      continue;
    }
    const entries = Array.isArray(snapshot && snapshot.entries)
      ? snapshot.entries
      : [];
    for (const entry of entries) {
      if (!entry || entry.isTask !== true) {
        continue;
      }
      if (path === dependentPath && dependentLines.has(entry.line)) {
        continue;
      }
      out.push(relationStageCandidateFromEntry(path, entry));
    }
  }
  return Object.freeze(out);
}

// Merge Tasks cache records under open-buffer notes: buffers win per note
// (unsaved edits count), cache-only notes fill the rest. Unlike the
// dependency pool, closed tasks and `done/` archives stay — they are
// linkable relation targets (LG6).
function mergeRelationStageCacheCandidates(cacheTasks, notes, options = {}) {
  const dependentPath = normalizeVaultRelativePath(options.dependentPath || "");
  const dependentLines =
    options.dependentLines instanceof Set
      ? options.dependentLines
      : new Set(options.dependentLines || []);
  const buffered = new Set(
    (Array.isArray(notes) ? notes : []).map((note) =>
      normalizeVaultRelativePath(note.path || ""),
    ),
  );
  const out = collectVaultRelationCandidatesFromSnapshots(
    createDependencySnapshotMap(notes),
    { dependentPath, dependentLines },
  ).slice();
  for (const record of cacheTasks || []) {
    if (!record || buffered.has(record.path)) {
      continue;
    }
    if (isRelationStageExcludedPath(record.path)) {
      continue;
    }
    if (
      record.path === dependentPath &&
      dependentLines.has(record.line)
    ) {
      continue;
    }
    out.push(
      Object.freeze({
        ...record,
        closed: record.open !== true,
        archived: isRelationStageArchivedPath(record.path),
      }),
    );
  }
  return Object.freeze(out);
}

// CURRENT rows: the owner's LINKS entries in authored order, resolved
// against everything, so closed, archived, hidden, and missing targets stay
// removable. Returns `{ok, rows}` or `{ok: false, reason}` for a malformed
// line (left alone, never projected).
function resolveRelationStageCurrent(
  content,
  parentLine,
  parentPath,
  index,
  snapshot = null,
) {
  const text = String(content || "");
  const lines = snapshot && Array.isArray(snapshot.lines)
    ? snapshot.lines
    : text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return Object.freeze({ ok: false, reason: "parent-out-of-range", rows: [] });
  }
  const children = findLinksChildren(lines, at);
  const entries = [];
  for (const child of children) {
    const parsed = parseLinksLine(String(lines[child] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict === "malformed") {
      return Object.freeze({ ok: false, reason: "malformed-links-line", rows: [] });
    }
    if (parsed.verdict !== "accept") {
      continue;
    }
    for (const entry of parsed.entries || []) {
      entries.push(entry);
    }
  }
  const rows = [];
  for (const entry of entries) {
    const targetPath = resolveDependencyStageLinkTarget(
      entry.note,
      entry.blockId,
      parentPath,
      index,
    );
    const key =
      targetPath && entry.blockId
        ? relationStageRowKey(targetPath, entry.blockId)
        : null;
    const record = (key && index && index.byKey.get(key)) || null;
    if (!record) {
      rows.push(
        Object.freeze({
          kind: "current",
          path: targetPath,
          blockId: entry.blockId,
          status: "?",
          displayText: `^${entry.blockId} not found`,
          text: `^${entry.blockId} not found`,
          label: entry.label || null,
          missing: true,
          open: true,
          closed: false,
          archived: false,
          rawLine: null,
          line: null,
          section: null,
        }),
      );
      continue;
    }
    rows.push(
      Object.freeze({
        kind: "current",
        path: record.path,
        blockId: record.blockId,
        status: record.status,
        displayText: record.text,
        text: record.text,
        label: entry.label || null,
        missing: false,
        nonTask: record.isTask === false,
        open: record.open === true,
        closed: record.open !== true,
        archived: isRelationStageArchivedPath(record.path),
        rawLine: record.rawLine,
        line: record.line,
        section: record.section,
      }),
    );
  }
  return Object.freeze({ ok: true, reason: null, rows: Object.freeze(rows) });
}

// Owner's Depends-On identities, so the stage can badge a candidate that is
// also a prerequisite (`⛓ prerequisite`, information only).
function relationStagePrerequisiteIdentities(content, parentLine, parentPath, index) {
  try {
    const resolved = resolveDependencyStageCurrent(
      content,
      parentLine,
      parentPath,
      index,
    );
    const out = new Set();
    if (!resolved || resolved.ok !== true) {
      return out;
    }
    for (const row of resolved.rows || []) {
      if (row && row.path && row.blockId && !row.missing) {
        out.add(blocksIdentity(row.path, row.blockId));
      }
    }
    return out;
  } catch (_error) {
    return new Set();
  }
}

function relationStageSourceFromLine(content, path, line) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return null;
  }
  const rawLine = String(lines[at] || "");
  const blockId = getTrailingBlockId(rawLine);
  const idFieldRaw = findBulletPropertyField(rawLine, "id");
  const idField = idFieldRaw
    ? normalizeBulletPropertyValue(idFieldRaw.value)
    : null;
  const displayText = cleanTaskDisplayText(rawLine);
  const key =
    (blockId && relationStageRowKey(path, blockId)) ||
    (idField ? `id:${idField}` : `${normalizeVaultRelativePath(path)}#line:${at}`);
  return Object.freeze({
    path: normalizeVaultRelativePath(path),
    line: at,
    rawLine,
    text: rawLine,
    blockId: blockId ? normalizeBulletPropertyValue(blockId) : null,
    idField,
    displayText,
    textDisplay: displayText,
    key,
    status: getObsidianTaskCheckboxStatus(rawLine),
    needsBlockId: !blockId,
  });
}

function collectRelationStageSources(stage) {
  const path = normalizeVaultRelativePath(
    (stage && stage.dependent && stage.dependent.path) || "",
  );
  const content =
    (stage && stage.files instanceof Map && stage.files.get(path)) || "";
  const lines = Array.isArray(stage && stage.parentLines)
    ? stage.parentLines
    : [];
  const sources = [];
  for (const line of lines) {
    const source = relationStageSourceFromLine(content, path, line);
    if (source) {
      sources.push(source);
    }
  }
  return Object.freeze(sources);
}

function decorateRelationVaultStage(stage, options = {}) {
  if (!stage) {
    return null;
  }
  const sources =
    Array.isArray(options.sources) && options.sources.length > 0
      ? options.sources
      : collectRelationStageSources(stage);
  const current = Array.isArray(options.current)
    ? options.current
    : Array.isArray(stage.current)
      ? stage.current
      : [];
  const linkedKeys = new Set();
  for (const row of current) {
    const key =
      row && row.path && row.blockId
        ? relationStageRowKey(row.path, row.blockId)
        : null;
    if (key) {
      linkedKeys.add(key);
    }
  }
  const primary = sources[0];
  const title = stage.direction === "from"
    ? `🪢 Linked from · ${String(
        (primary && primary.displayText) || "",
      ).slice(0, 44)}`
    : `🪢 Links · ${String(
    (primary && primary.displayText) || "",
  ).slice(0, 48)}`;
  return {
    ...stage,
    relationStage: true,
    sources: Object.freeze(sources),
    current: Object.freeze(current),
    linkedKeys,
    title,
    openCount: current.length,
    poolSize: Array.isArray(stage.candidates) ? stage.candidates.length : 0,
  };
}

const RELATION_INVERSE_PHRASES = Object.freeze({
  "merged into": "merged from",
  "duplicate of": "duplicated by",
  "follow-up of": "followed up by",
  "superseded by": "supersedes",
  "split from": "split into",
  "implemented by": "implements",
  "verified by": "verifies",
});

function inverseRelationPhrase(label) {
  const raw = String(label || "").trim();
  if (!raw) return "";
  return RELATION_INVERSE_PHRASES[raw.toLocaleLowerCase("en-US")] || `${raw} → this`;
}

function relationStageIncomingRow(source, label, options = {}) {
  const rawLabel = label ? String(label) : null;
  const displayText = String(source.displayText || source.text || "task");
  return Object.freeze({
    ...source,
    searchText: [displayText, source.route, source.blockId, source.note].filter(Boolean).join(" "),
    kind: "current",
    label: inverseRelationPhrase(rawLabel),
    storedLabel: rawLabel,
    incoming: true,
    readOnly: options.readOnly === true,
    disabled: options.readOnly === true,
    disabledReason: options.readOnly ? "This source task is in a read-only note" : null,
  });
}

function relationStageEdgeStatusSymbol(source) {
  const text = source && source.text != null ? String(source.text) : "";
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  if (match) return match[1];
  const word = String((source && source.status) || "").trim().toUpperCase();
  if (word === "TODO") return " ";
  if (word === "NEXT") return "*";
  if (word === "IN_PROGRESS") return "/";
  if (word === "BLOCKED") return "?";
  if (word === "DONE") return "x";
  if (word === "CANCELLED") return "-";
  return " ";
}

function relationStageIncomingRowsFromEdges(edges, index, previousDailyPath) {
  const rows = [];
  const seen = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = edge && edge.source;
    const path = normalizeVaultRelativePath((source && source.path) || "");
    const blockId = normalizeBulletPropertyValue((source && source.blockId) || "");
    if (!path || !blockId) continue;
    const key = relationStageRowKey(path, blockId);
    if (seen.has(key)) continue;
    seen.add(key);
    const record = index && index.byKey instanceof Map ? index.byKey.get(key) : null;
    const archived = isRelationStageArchivedPath(path);
    let rowSource;
    if (record) {
      rowSource = {
        ...record,
        path,
        blockId,
        archived,
        note: dependencyStageBasenameOf(path),
        route: dependencyStageRouteOf(path),
      };
    } else {
      const line =
        Number.isInteger(source && source.line) && source.line >= 1
          ? source.line - 1
          : -1;
      const rawText = source && source.text != null ? String(source.text) : "";
      const cleaned = rawText ? cleanTaskDisplayText(rawText) : "";
      const text = cleaned || `^${blockId}`;
      const status = relationStageEdgeStatusSymbol(source);
      rowSource = {
        path,
        blockId,
        line,
        rawLine: null,
        status,
        displayText: text,
        text,
        open: OPEN_OBSIDIAN_TASK_STATUSES.has(status),
        closed: !OPEN_OBSIDIAN_TASK_STATUSES.has(status),
        archived,
        note: dependencyStageBasenameOf(path),
        route: dependencyStageRouteOf(path),
        hidden: false,
      };
    }
    rows.push(relationStageIncomingRow(rowSource, edge && edge.label, {
      readOnly: archived || path === normalizeVaultRelativePath(previousDailyPath || ""),
    }));
  }
  return Object.freeze(rows);
}

function collectRelationStageIncomingFromSnapshots(snapshots, index, target, previousDailyPath = "") {
  const targetPath = normalizeVaultRelativePath((target && target.path) || "");
  const targetBlockId = normalizeBulletPropertyValue((target && target.blockId) || "");
  if (!targetPath || !targetBlockId) return Object.freeze([]);
  const rows = [];
  const seen = new Set();
  const previous = normalizeVaultRelativePath(previousDailyPath || "");
  for (const [path, snapshot] of snapshots || []) {
    if (!path || (isRelationStageExcludedPath(path) && path !== previous)) continue;
    const lines = Array.isArray(snapshot && snapshot.lines)
      ? snapshot.lines
      : String((snapshot && snapshot.text) || "").split(/\r?\n/);
    const content = String((snapshot && snapshot.text) || lines.join("\n"));
    for (const entry of Array.isArray(snapshot && snapshot.entries) ? snapshot.entries : []) {
      if (!entry || entry.isTask !== true) continue;
      const ownerLine = Math.floor(numericOrDefault(entry.line, -1));
      if (ownerLine < 0 || ownerLine >= lines.length) continue;
      for (const child of findLinksChildren(lines, ownerLine)) {
        const parsed = parseLinksLine(String(lines[child] || ""), { isDirectChildOfTask: true });
        if (parsed.verdict !== "accept") continue;
        for (const relation of parsed.entries || []) {
          const resolvedPath = resolveDependencyStageLinkTarget(
            relation.note,
            relation.blockId,
            path,
            index,
          );
          if (
            normalizeVaultRelativePath(resolvedPath || "") !== targetPath ||
            normalizeBulletPropertyValue(relation.blockId || "") !== targetBlockId
          ) continue;
          const source = relationStageSourceFromLine(content, path, ownerLine);
          if (!source || !source.blockId) continue;
          const key = relationStageRowKey(source.path, source.blockId);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(relationStageIncomingRow({
            ...source,
            note: dependencyStageBasenameOf(path),
            route: dependencyStageRouteOf(path),
            closed: !OPEN_OBSIDIAN_TASK_STATUSES.has(source.status),
            archived: isRelationStageArchivedPath(path),
          }, relation.label, {
            readOnly: isRelationStageArchivedPath(path),
          }));
        }
      }
    }
  }
  return Object.freeze(rows);
}

// The Links stage list: CURRENT (outgoing, authored order), RESULTS
// (open), CLOSED (closed, then archived). `prerequisiteIds` marks rows that
// are also prerequisites; `todayMap` marks rows linked under today's open
// Pomodoros (🍅, display only).
function planRelationStageView(args = {}) {
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const current = Array.isArray(args.current) ? args.current : [];
  const pool = Array.isArray(args.candidates) ? args.candidates : [];
  const query = String(args.query || "");
  const source = sources[0] || {};
  const sourcePath = normalizeVaultRelativePath(source.path || "");
  const sourceBlockId = normalizeBulletPropertyValue(source.blockId || "");
  const linkedKeys = args.linkedKeys instanceof Set ? args.linkedKeys : new Set();
  const prerequisiteIds =
    args.prerequisiteIds instanceof Set ? args.prerequisiteIds : new Set();
  const todayMap = args.todayMap instanceof Map ? args.todayMap : new Map();
  const maxRows = Math.max(
    1,
    Math.floor(numericOrDefault(args.maxRows, DEPENDENCY_STAGE_MAX_ROWS)),
  );
  const markedCurrent = current.map((row, index) =>
    Object.freeze({
      ...row,
      kind: "local-task",
      relationKind: true,
      stageSection: "current",
      alreadyLinked: true,
      firstInSection: index === 0,
      markKey:
        row.markKey ||
        (row.path
          ? `${normalizeVaultRelativePath(row.path)}#${row.blockId || `line:${row.line}`}`
          : row.line),
    }),
  );
  const seen = new Set(linkedKeys);
  const fresh = [];
  for (const candidate of pool) {
    const key =
      candidate.path && candidate.blockId
        ? relationStageRowKey(candidate.path, candidate.blockId)
        : null;
    // The owner itself is never a pool row (LG vectors: self links refuse).
    if (
      candidate.path === sourcePath &&
      (candidate.line === source.line ||
        (sourceBlockId &&
          normalizeBulletPropertyValue(candidate.blockId || "") === sourceBlockId))
    ) {
      continue;
    }
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    fresh.push({ candidate, key });
  }
  let ordered;
  if (!query.trim()) {
    // Empty query shows only what the design lists: CURRENT is separate,
    // RESULTS is same-note tasks plus the In Progress and Next lanes, and
    // CLOSED is closed tasks plus `done/` archives. Ready tasks from other
    // notes need typing.
    const emptyPool = fresh.filter(
      (entry) =>
        entry.candidate.path === sourcePath ||
        entry.candidate.status === "/" ||
        entry.candidate.status === "*" ||
        entry.candidate.closed === true ||
        entry.candidate.archived === true,
    );
    ordered = emptyPool
      .slice()
      .sort((left, right) =>
        compareRelationStageCanonical(left.candidate, right.candidate, sourcePath),
      )
      .map((entry) => entry.candidate);
  } else {
    const ranked = dependencyStageRank(
      fresh.map((entry) => entry.candidate),
      query,
    );
    const rankIndex = new Map(ranked.map((candidate, index) => [candidate, index]));
    ordered = fresh
      .slice()
      .sort((left, right) => {
        const leftRank = rankIndex.has(left.candidate)
          ? rankIndex.get(left.candidate)
          : Number.POSITIVE_INFINITY;
        const rightRank = rankIndex.has(right.candidate)
          ? rankIndex.get(right.candidate)
          : Number.POSITIVE_INFINITY;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return compareRelationStageCanonical(
          left.candidate,
          right.candidate,
          sourcePath,
        );
      })
      .map((entry) => entry.candidate)
      .filter((candidate) => rankIndex.has(candidate));
  }
  const results = [];
  const closed = [];
  for (const candidate of ordered) {
    if (candidate.closed === true || candidate.archived === true) {
      closed.push(candidate);
    } else {
      results.push(candidate);
    }
  }
  const room = Math.max(0, maxRows - markedCurrent.length);
  const picked = [...results, ...closed].slice(0, room);
  const shape = (candidate, section, first) => {
    const key =
      candidate.path && candidate.blockId
        ? relationStageRowKey(candidate.path, candidate.blockId)
        : null;
    const self =
      candidate.path === sourcePath &&
      sourceBlockId &&
      normalizeBulletPropertyValue(candidate.blockId || "") === sourceBlockId;
    const todayLink = (key && todayMap.get(key)) || null;
    const prerequisite =
      Boolean(key) && prerequisiteIds.has(blocksIdentity(candidate.path, candidate.blockId));
    return Object.freeze({
      kind: "local-task",
      relationKind: true,
      stageSection: section,
      firstInSection: first,
      path: candidate.path,
      blockId: candidate.blockId,
      route: candidate.route,
      note: candidate.note,
      noteLabel:
        candidate.path && candidate.path !== sourcePath
          ? dependencyStageBasenameOf(candidate.path)
          : null,
      line: candidate.line,
      rawLine: candidate.rawLine,
      status: candidate.status,
      displayText: candidate.displayText,
      text: candidate.text,
      searchText: [
        candidate.displayText,
        candidate.route,
        candidate.blockId
          ? `${candidate.route}:${candidate.blockId}`
          : "",
        candidate.blockId || "",
        candidate.section || "",
        candidate.note || "",
      ]
        .filter(Boolean)
        .join(" "),
      alreadyLinked: false,
      needsBlockIdPrompt: !candidate.blockId,
      needsPromptForAdd: !candidate.blockId,
      hidden: candidate.hidden,
      section: candidate.section,
      markKey: `${candidate.path}#${candidate.line >= 0 ? candidate.line : (candidate.blockId || candidate.displayText)}`,
      disabled: self,
      disabledReason: self ? "this task" : null,
      label: null,
      archived: candidate.archived === true,
      closed: candidate.closed === true,
      prerequisite,
      todayLink,
    });
  };
  const out = [...markedCurrent];
  const pickedResults = picked.filter(
    (candidate) => candidate.closed !== true && candidate.archived !== true,
  );
  const pickedClosed = picked.filter(
    (candidate) => candidate.closed === true || candidate.archived === true,
  );
  pickedResults.forEach((candidate, index) =>
    out.push(shape(candidate, "results", index === 0)),
  );
  pickedClosed.forEach((candidate, index) =>
    out.push(shape(candidate, "closed", index === 0)),
  );
  const totalOrdered = [...results, ...closed].length;
  const hiddenCount = Math.max(0, totalOrdered - picked.length);
  if (hiddenCount > 0) {
    out.push(
      Object.freeze({
        kind: "stage-more",
        stageSection: pickedClosed.length > 0 ? "closed" : "results",
        firstInSection: false,
        path: null,
        blockId: null,
        displayText: `type to search ${hiddenCount} more`,
        text: `type to search ${hiddenCount} more`,
        searchText: "",
        hiddenCount,
        disabled: true,
        disabledReason: `type to search ${hiddenCount} more`,
        cycle: null,
        cycleLabels: null,
        waitsOn: null,
      }),
    );
  }
  return Object.freeze(out);
}

function planLinkedFromStageView(args = {}) {
  const owner = (Array.isArray(args.sources) && args.sources[0]) || {};
  const ownerPath = normalizeVaultRelativePath(owner.path || "");
  const ownerBlockId = normalizeBulletPropertyValue(owner.blockId || "");
  const current = Array.isArray(args.current) ? args.current : [];
  const pool = Array.isArray(args.candidates) ? args.candidates : [];
  const linkedKeys = args.linkedKeys instanceof Set ? args.linkedKeys : new Set();
  const query = String(args.query || "");
  const previousDailyPath = normalizeVaultRelativePath(args.previousDailyPath || "");
  const maxRows = Math.max(1, Math.floor(numericOrDefault(args.maxRows, DEPENDENCY_STAGE_MAX_ROWS)));
  const out = current.map((row, index) => Object.freeze({
    ...row,
    kind: "local-task",
    relationKind: true,
    stageSection: "current",
    alreadyLinked: true,
    firstInSection: index === 0,
    markKey: row.markKey || `${normalizeVaultRelativePath(row.path || "")}#${row.blockId || `line:${row.line}`}`,
  }));
  const seen = new Set(linkedKeys);
  const fresh = [];
  for (const candidate of pool) {
    if (!candidate || candidate.archived === true) continue;
    const path = normalizeVaultRelativePath(candidate.path || "");
    if (!path || path === previousDailyPath) continue;
    const blockId = normalizeBulletPropertyValue(candidate.blockId || "");
    if (path === ownerPath && (candidate.line === owner.line || (ownerBlockId && ownerBlockId === blockId))) continue;
    const key = blockId ? relationStageRowKey(path, blockId) : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    fresh.push(candidate);
  }
  let ordered = fresh.slice();
  if (query.trim()) {
    const ranked = dependencyStageRank(fresh, query);
    const rank = new Map(ranked.map((candidate, index) => [candidate, index]));
    ordered = ordered.filter((candidate) => rank.has(candidate)).sort((left, right) =>
      rank.get(left) - rank.get(right) || compareRelationStageCanonical(left, right, ownerPath),
    );
  } else {
    ordered.sort((left, right) => {
      const openOrder = Number(right.open === true) - Number(left.open === true);
      return openOrder || compareRelationStageCanonical(left, right, ownerPath);
    });
  }
  const room = Math.max(0, maxRows - out.length);
  const picked = ordered.slice(0, room);
  picked.forEach((candidate, index) => {
    out.push(Object.freeze({
      kind: "local-task",
      relationKind: true,
      stageSection: "results",
      firstInSection: index === 0,
      path: normalizeVaultRelativePath(candidate.path || ""),
      blockId: candidate.blockId || null,
      line: candidate.line,
      rawLine: candidate.rawLine,
      status: candidate.status,
      displayText: candidate.displayText || candidate.text || "task",
      text: candidate.text || candidate.displayText || "task",
      route: candidate.route,
      note: candidate.note,
      noteLabel: candidate.path !== ownerPath ? dependencyStageBasenameOf(candidate.path) : null,
      searchText: [candidate.displayText, candidate.route, candidate.blockId, candidate.note].filter(Boolean).join(" "),
      alreadyLinked: false,
      needsBlockIdPrompt: false,
      needsPromptForAdd: false,
      hidden: candidate.hidden,
      section: candidate.section,
      markKey: `${candidate.path}#${candidate.line >= 0 ? candidate.line : (candidate.blockId || candidate.displayText)}`,
      disabled: false,
      label: null,
      archived: false,
      closed: candidate.closed === true,
      prerequisite: false,
      todayLink: null,
    }));
  });
  const hiddenCount = Math.max(0, ordered.length - picked.length);
  if (hiddenCount > 0) {
    out.push(Object.freeze({
      kind: "stage-more",
      stageSection: "results",
      firstInSection: false,
      path: null,
      blockId: null,
      displayText: `type to search ${hiddenCount} more`,
      text: `type to search ${hiddenCount} more`,
      searchText: "",
      hiddenCount,
      disabled: true,
      disabledReason: `type to search ${hiddenCount} more`,
    }));
  }
  return Object.freeze(out);
}

// Archived rows sink below closed rows; open rows float above both. Within
// a tier the owner's note wins, then visible before `#hide`, then In
// Progress, Next, Ready and Blocked together, then other statuses, then
// path, then line (relations never block, so Blocked shares Ready's lane).
function compareRelationStageCanonical(first, second, ownerPath) {
  const firstArchived = first && first.archived === true ? 1 : 0;
  const secondArchived = second && second.archived === true ? 1 : 0;
  if (firstArchived !== secondArchived) {
    return firstArchived - secondArchived;
  }
  const firstClosed = first && first.closed === true ? 1 : 0;
  const secondClosed = second && second.closed === true ? 1 : 0;
  if (firstClosed !== secondClosed) {
    return firstClosed - secondClosed;
  }
  return compareDependencyStageCanonical(first, second, ownerPath, {
    blockedWithReady: true,
  });
}

function planRelationStageItemsFromVault(stage, query) {
  if (!stage) {
    return Object.freeze([]);
  }
  if (stage.direction === "from") {
    return planLinkedFromStageView({
      sources: stage.sources,
      current: stage.current,
      candidates: stage.candidates,
      query: query || "",
      linkedKeys: stage.linkedKeys,
      previousDailyPath: stage.previousDailyPath,
    });
  }
  return planRelationStageView({
    sources: stage.sources,
    current: stage.current,
    candidates: stage.candidates,
    query: query || "",
    linkedKeys: stage.linkedKeys,
    prerequisiteIds: stage.prerequisiteIds,
    todayMap: stage.todayMap,
  });
}

// Pure commit plan for one Links stage gesture (LG15): marked and chosen
// rows become one `applyRelationEdit` call with one notice. CURRENT rows
// unlink; every other row links plain (the relation field adds labels).
function planRelationStageCommit(items) {
  const list = Array.isArray(items) ? items : [];
  const add = [];
  const remove = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || item.kind === "stage-more" || item.disabled) {
      continue;
    }
    const key = `${normalizeVaultRelativePath(item.path || "")}\u0000${normalizeBulletPropertyValue(item.blockId || "")}\u0000${item.stageSection === "current" ? "remove" : "add"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const ref = {
      path: normalizeVaultRelativePath(item.path || ""),
      line: item.line,
      blockId: item.blockId || item.existingBlockId || null,
      rawLine: typeof item.rawLine === "string" ? item.rawLine : undefined,
    };
    if (item.alreadyLinked || item.stageSection === "current") {
      remove.push(ref);
    } else {
      add.push(ref);
    }
  }
  return Object.freeze({
    add: Object.freeze(add),
    remove: Object.freeze(remove),
  });
}
