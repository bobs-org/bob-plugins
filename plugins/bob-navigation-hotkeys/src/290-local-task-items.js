function createBulletPropertyLocalTaskItems(content, options = {}) {
  const dependencyValues =
    options.dependencyValues instanceof Set
      ? options.dependencyValues
      : new Set(options.dependencyValues || []);
  const dependencyValueSets = Array.isArray(options.dependencyValueSets)
    ? options.dependencyValueSets.map((values) =>
        values instanceof Set ? values : new Set(values || []),
      )
    : [dependencyValues];

  return getOpenLocalTasks(content, {
    excludeLine: options.excludeLine,
    excludeLines: options.excludeLines,
  }).map(
    (task) => {
      // The dependency value stored in `[dependsOn:: ...]` (prefers an existing
      // `[id::]`, then the trailing block ID). The link block ID is the trailing
      // `^block-id` the navigation bullet points at, which may be absent even
      // when a dependency value exists.
      const dependencyValue = getLocalTaskDependencyIdentifier(
        task,
        options.filePath || "",
      );
      const legacyDependencyValue = task.existingIdField || task.existingBlockId || "";
      const linkBlockId = task.existingBlockId || "";
      const linkedSourceCount = dependencyValue
        ? dependencyValueSets.filter(
            (values) =>
              values.has(dependencyValue) ||
              (legacyDependencyValue !== dependencyValue &&
                values.has(legacyDependencyValue)),
          ).length
        : 0;
      const linkState =
        linkedSourceCount === 0
          ? "none"
          : linkedSourceCount === dependencyValueSets.length
            ? "all"
            : "mixed";
      const alreadyLinked = linkState === "all";
      const needsBlockIdPrompt = !linkBlockId;
      const needsDependencyValue = !dependencyValue;
      const needsPromptForAdd = !alreadyLinked && needsBlockIdPrompt;

      return Object.freeze({
        kind: "local-task",
        ...task,
        value: dependencyValue,
        dependencyValue,
        legacyDependencyValue,
        linkBlockId,
        alreadyLinked,
        linkedSourceCount,
        sourceCount: dependencyValueSets.length,
        linkState,
        needsBlockIdPrompt,
        needsDependencyValue,
        needsPromptForAdd,
        searchText: [
          task.displayText,
          `line ${task.line + 1}`,
          task.status,
          dependencyValue,
          alreadyLinked ? "depends linked" : "",
          linkState === "mixed" ? "mixed partially linked" : "",
          needsPromptForAdd
            ? "needs id block create"
            : dependencyValue
              ? "block id"
              : "create id",
        ]
          .filter(Boolean)
          .join(" "),
      });
    },
  );
}

// ---------- Vault-wide Depends on stage (nav-stage) ----------
// `docs/task-dependencies.md` §6 in bob-cli is authoritative: the candidate
// pool is vault-wide (Tasks cache with open-buffer overrides, falling back
// to a one-time vault scan), ranking ports `capture_link_tasks.rs::rank`,
// and rows group into CURRENT / RESULTS / BLOCKED with guards. Every helper
// here is pure and synchronous so the stage never reads from disk on a
// keystroke; the plugin methods below supply the pool and the commit path.
const DEPENDENCY_STAGE_MAX_ROWS = 60;
const DEPENDENCY_STAGE_SECTION_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;

// Identity key for one stage row or graph node: the NUL separator keeps
// paths with spaces unambiguous (block ids never contain whitespace).
function dependencyStageRowKey(path, blockId) {
  const normalized = normalizeVaultRelativePath(path || "");
  const id = normalizeBulletPropertyValue(blockId || "");
  if (!normalized || !id) {
    return null;
  }
  return `${normalized}\x00${id}`;
}

// One tier check, ported from `field_tier` in
// `src/native/capture_link_tasks.rs`: 3 for a field prefix, 2 for a word
// prefix (the preceding character is not alphanumeric), 1 for a substring,
// and 0 for an in-order subsequence. Both sides are already lowercased.
function dependencyStageFieldTier(field, term) {
  const text = String(field || "");
  const needle = String(term || "");
  if (!needle) {
    return null;
  }
  if (text.startsWith(needle)) {
    return 3;
  }
  let from = text.indexOf(needle, 1);
  while (from !== -1) {
    const before = text[from - 1];
    if (before !== undefined && !/[\p{L}\p{N}]/u.test(before)) {
      return 2;
    }
    from = text.indexOf(needle, from + 1);
  }
  if (text.includes(needle)) {
    return 1;
  }
  let wanted = 0;
  for (const cell of text) {
    if (cell === needle[wanted]) {
      wanted += 1;
      if (wanted >= needle.length) {
        return 0;
      }
    }
  }
  return null;
}

// A term's best tier over the searchable fields, or null when it matches
// nothing: the cleaned description, `route:blockId`, the block id, the note
// route, and the section heading (`docs/task-dependencies.md` §6.3).
function dependencyStageTermTier(candidate, term) {
  const needle = String(term || "").toLowerCase();
  if (!needle || !candidate) {
    return null;
  }
  const fields = [];
  if (candidate.blockId) {
    fields.push(`${candidate.route || ""}:${candidate.blockId}`);
    fields.push(candidate.blockId);
  }
  fields.push(candidate.text || "");
  fields.push(candidate.route || "");
  if (candidate.section) {
    fields.push(candidate.section);
  }
  let best = null;
  for (const field of fields) {
    const tier = dependencyStageFieldTier(
      String(field || "").toLowerCase(),
      needle,
    );
    if (tier !== null && (best === null || tier > best)) {
      best = tier;
    }
  }
  return best;
}

// Rank candidates for a query, ported from `rank` in
// `src/native/capture_link_tasks.rs`: every whitespace-separated term must
// match, tasks order by the summed tiers descending, and ties (and the empty
// query) keep the input order. The sort is stable, so callers pre-sort into
// canonical order first.
function dependencyStageRank(candidates, query) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  const terms = String(query || "")
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) {
    return list;
  }
  const scored = [];
  for (const candidate of list) {
    let total = 0;
    let matched = true;
    for (const term of terms) {
      const tier = dependencyStageTermTier(candidate, term);
      if (tier === null) {
        matched = false;
        break;
      }
      total += tier;
    }
    if (matched) {
      scored.push({ candidate, total });
    }
  }
  scored.sort((left, right) => right.total - left.total);
  return scored.map((entry) => entry.candidate);
}

function dependencyStageRouteOf(path) {
  return String(path || "").replace(/\.md$/i, "");
}

function dependencyStageBasenameOf(path) {
  const route = dependencyStageRouteOf(path);
  const at = route.lastIndexOf("/");
  return at === -1 ? route : route.slice(at + 1);
}

// RESULTS exclusions (`docs/task-dependencies.md` §6.2): daily notes
// (`YYYY/YYYYMMDD.md`), `done/`, `_templates`, `_generated`, `_conflicts`
// (matched as a path segment), dot-dirs, and the dependent itself (handled
// by the caller through `dependentLines`). Fenced code never reaches here:
// the task scanner skips it.
function isDependencyStageExcludedPath(path) {
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
  return segments[0] === "done";
}

function findDependencyStageSection(lines, line) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  for (let index = line - 1; index >= 0; index -= 1) {
    const match = DEPENDENCY_STAGE_SECTION_RE.exec(
      String(sourceLines[index] || ""),
    );
    if (match) {
      return (match[1] || "").trim() || null;
    }
  }
  return null;
}

// Every `#task` line in one note, open or closed, plus non-task block-id
// carriers (for the "not a task" CURRENT state). Fenced code and frontmatter
// are skipped through the shared line contexts. Sections are carried forward
// during the single scan instead of searching backward per task.
function scanDependencyStageNoteTasks(content) {
  return createDependencyNoteSnapshot(content).entries;
}

function createDependencySnapshotMap(notes) {
  const snapshots = new Map();
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note) {
      continue;
    }
    const path = normalizeVaultRelativePath(note.path || "");
    if (!path) {
      continue;
    }
    if (!snapshots.has(path)) {
      snapshots.set(path, createDependencyNoteSnapshot(note.content));
    } else {
      snapshots.set(path, createDependencyNoteSnapshot(note.content));
    }
  }
  return snapshots;
}

function collectVaultDependencyCandidatesFromSnapshots(snapshots, options = {}) {
  const dependentPath = normalizeVaultRelativePath(options.dependentPath || "");
  const dependentLines =
    options.dependentLines instanceof Set
      ? options.dependentLines
      : new Set(options.dependentLines || []);
  const out = [];
  for (const [path, snapshot] of snapshots) {
    if (!path || isDependencyStageExcludedPath(path)) {
      continue;
    }
    const route = dependencyStageRouteOf(path);
    const noteName = dependencyStageBasenameOf(path);
    for (const entry of snapshot.entries) {
      if (!entry.isTask || !entry.open) {
        continue;
      }
      if (path === dependentPath && dependentLines.has(entry.line)) {
        continue;
      }
      out.push(
        Object.freeze({
          path,
          route,
          note: noteName,
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
          open: true,
          blocked: entry.blocked,
          hidden: entry.hidden,
        }),
      );
    }
  }
  return Object.freeze(out);
}

function indexDependencyStageNotesFromSnapshots(snapshots) {
  const byKey = new Map();
  const byBlockId = new Map();
  const byIdField = new Map();
  const basenames = new Map();
  const register = (path, entry) => {
    const record = Object.freeze({ path, ...entry });
    if (entry.blockId) {
      const key = dependencyStageRowKey(path, entry.blockId);
      if (!byKey.has(key)) {
        byKey.set(key, record);
      }
      if (!byBlockId.has(entry.blockId)) {
        byBlockId.set(entry.blockId, []);
      }
      byBlockId.get(entry.blockId).push(record);
    }
    if (entry.idField && !byIdField.has(entry.idField)) {
      byIdField.set(entry.idField, record);
    }
    return record;
  };
  for (const [path, snapshot] of snapshots) {
    if (!path) {
      continue;
    }
    const basename = dependencyStageBasenameOf(path);
    if (!basenames.has(basename)) {
      basenames.set(basename, []);
    }
    basenames.get(basename).push(path);
    for (const entry of snapshot.entries) {
      register(path, entry);
    }
  }
  return Object.freeze({ byKey, byBlockId, byIdField, basenames });
}

// The vault-wide RESULTS pool (`docs/task-dependencies.md` §6.2): open
// tasks passing the `#task` global filter, including `ref/`, inbox,
// Blocked, and `#hide`. `notes` is `[{path, content}]`; open editor buffers
// must already override the cache in that list, so unsaved edits count.
function collectVaultDependencyCandidates(notes, options = {}) {
  return collectVaultDependencyCandidatesFromSnapshots(
    createDependencySnapshotMap(notes),
    options,
  );
}

// Lookup over everything — including closed, archived, hidden, and missing
// targets — so CURRENT rows can still be removed
// (`docs/task-dependencies.md` §6.2).
function indexDependencyStageNotes(notes) {
  return indexDependencyStageNotesFromSnapshots(createDependencySnapshotMap(notes));
}

// Resolve one Depends-On line link to its note path: same-note links stay
// put, bare basenames resolve when unique (case-insensitive), otherwise the
// full vault-relative route wins.
function resolveDependencyStageLinkTarget(linkNote, blockId, parentPath, index) {
  const id = normalizeBulletPropertyValue(blockId);
  if (!id || !index) {
    return null;
  }
  const note = String(linkNote || "");
  if (!note) {
    return normalizeVaultRelativePath(parentPath || "");
  }
  if (note.includes("/")) {
    return normalizeVaultRelativePath(`${note}.md`);
  }
  const paths = index.basenames.get(note) || [];
  const lowered = note.toLowerCase();
  const matches = paths.length > 0 ? paths : [];
  if (matches.length === 0) {
    for (const [basename, candidates] of index.basenames) {
      if (basename.toLowerCase() === lowered) {
        return normalizeVaultRelativePath(candidates[0] || "");
      }
    }
    return null;
  }
  return normalizeVaultRelativePath(matches[0] || "");
}

// CURRENT rows: the dependent's existing prerequisites resolved against
// everything, so closed, archived, hidden, and missing targets stay
// removable. Returns `{ok, rows}` or `{ok: false, reason}` for a malformed
// line (left alone, never projected).
function resolveDependencyStageCurrent(content, parentLine, parentPath, index, snapshot = null) {
  const text = String(content || "");
  const lines = snapshot && Array.isArray(snapshot.lines)
    ? snapshot.lines
    : text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return Object.freeze({ ok: false, reason: "parent-out-of-range", rows: [] });
  }
  const collection = snapshot
    ? getCachedDependencyCollection(snapshot, text, at)
    : collectDependencyNavigationBullets(text, at);
  if (collection.reason) {
    return Object.freeze({ ok: false, reason: collection.reason, rows: [] });
  }
  const rows = [];
  for (const target of collection.targets) {
    const targetPath = resolveDependencyStageLinkTarget(
      target.note,
      target.blockId,
      parentPath,
      index,
    );
    const key =
      targetPath && target.blockId
        ? dependencyStageRowKey(targetPath, target.blockId)
        : null;
    const record = (key && index.byKey.get(key)) || null;
    if (!record) {
      const siblings =
        (target.blockId && index.byBlockId.get(target.blockId)) || [];
      if (siblings.length === 0) {
        rows.push(
          Object.freeze({
            kind: "current",
            path: targetPath,
            blockId: target.blockId,
            status: "?",
            displayText: `^${target.blockId} not found`,
            text: `^${target.blockId} not found`,
            missing: true,
            open: true,
            blocked: false,
            rawLine: null,
            section: null,
          }),
        );
        continue;
      }
    }
    if (record && !record.isTask) {
      rows.push(
        Object.freeze({
          kind: "current",
          path: record.path,
          blockId: record.blockId,
          status: record.status,
          displayText: record.text,
          text: record.text,
          nonTask: true,
          open: false,
          blocked: false,
          rawLine: record.rawLine,
          section: record.section,
        }),
      );
      continue;
    }
    if (record) {
      rows.push(
        Object.freeze({
          kind: "current",
          path: record.path,
          blockId: record.blockId,
          status: record.status,
          displayText: record.text,
          text: record.text,
          open: record.open,
          blocked: record.blocked,
          closed: !record.open,
          rawLine: record.rawLine,
          section: record.section,
        }),
      );
      continue;
    }
    rows.push(
      Object.freeze({
        kind: "current",
        path: targetPath,
        blockId: target.blockId,
        status: "?",
        displayText: `^${target.blockId} not found`,
        text: `^${target.blockId} not found`,
        missing: true,
        open: true,
        blocked: false,
        rawLine: null,
        section: null,
      }),
    );
  }
  return Object.freeze({ ok: true, reason: null, rows: Object.freeze(rows) });
}

// Dependency edges for cycle guards: each open task's Depends-On line links
// plus its `[dependsOn::]` field ids, resolved to `path blockId` keys.
// Unresolvable links are skipped: they never block and never guard.
function collectDependencyStageEdgesFromSnapshots(snapshots, index) {
  const edges = new Map();
  const add = (from, to) => {
    if (!from || !to || from === to) {
      return;
    }
    if (!edges.has(from)) {
      edges.set(from, []);
    }
    if (!edges.get(from).includes(to)) {
      edges.get(from).push(to);
    }
  };
  for (const [path, snapshot] of snapshots) {
    if (!path || !snapshot) {
      continue;
    }
    const { lines, contexts, text } = snapshot;
    for (const entry of snapshot.entries) {
      if (!entry.isTask || !entry.open) {
        continue;
      }
      const line = entry.line;
      const rawLine = String(lines[line] || "");
      const selfBlockId = entry.blockId;
      const selfIdField = entry.idField;
      const from =
        (selfBlockId && dependencyStageRowKey(path, selfBlockId)) ||
        (selfIdField && `id:${selfIdField}`) ||
        `${path}#line:${line}`;
      const collection = getCachedDependencyCollection(snapshot, text, line);
      if (!collection.reason) {
        for (const target of collection.targets) {
          const targetPath = resolveDependencyStageLinkTarget(
            target.note,
            target.blockId,
            path,
            index,
          );
          if (targetPath && target.blockId) {
            add(from, dependencyStageRowKey(targetPath, target.blockId));
          }
        }
      }
      const field = findBulletPropertyField(rawLine, "dependsOn");
      if (field && index) {
        for (const id of parseLocalTaskIdList(field.value)) {
          const record = index.byIdField.get(id);
          if (record && record.blockId) {
            add(from, dependencyStageRowKey(record.path, record.blockId));
          }
        }
      }
    }
  }
  return edges;
}

function collectDependencyStageEdges(notes, index) {
  return collectDependencyStageEdgesFromSnapshots(createDependencySnapshotMap(notes), index);
}

// Whether linking `fromKey` to `toKey` would create a cycle: `toKey` already
// reaches `fromKey` through the current graph. Returns the cycle path
// (for the tooltip) or null.
function findDependencyStageCycle(edges, fromKey, toKey) {
  if (!fromKey || !toKey || !edges) {
    return null;
  }
  if (fromKey === toKey) {
    return Object.freeze([fromKey]);
  }
  const visited = new Set([toKey]);
  const stack = [{ key: toKey, trail: [toKey] }];
  while (stack.length > 0) {
    const { key, trail } = stack.pop();
    const next = edges instanceof Map ? edges.get(key) : edges[key];
    for (const edge of next || []) {
      if (edge === fromKey) {
        return Object.freeze([...trail, fromKey]);
      }
      if (!visited.has(edge)) {
        visited.add(edge);
        stack.push({ key: edge, trail: [...trail, edge] });
      }
    }
  }
  return null;
}

// Canonical order for ties and the empty query
// (`docs/task-dependencies.md` §6.3): same-note tasks in document order,
// then In Progress, Next, Ready (by path, then line), then `#hide`.
function compareDependencyStageCanonical(first, second, dependentPath) {
  const firstSame = first.path === dependentPath;
  const secondSame = second.path === dependentPath;
  if (firstSame !== secondSame) {
    return firstSame ? -1 : 1;
  }
  if (firstSame && secondSame) {
    return first.line - second.line;
  }
  // `#hide` ranks last, ahead of the lane: a hidden In Progress task sorts
  // after a visible Ready one (`docs/task-dependencies.md` §6.3).
  if (Boolean(first.hidden) !== Boolean(second.hidden)) {
    return first.hidden ? 1 : -1;
  }
  const lane = (status) =>
    status === "/" ? 0 : status === "*" ? 1 : status === " " ? 2 : 3;
  const laneDiff = lane(first.status) - lane(second.status);
  if (laneDiff !== 0) {
    return laneDiff;
  }
  if (first.path !== second.path) {
    return first.path < second.path ? -1 : 1;
  }
  return first.line - second.line;
}

// The staged view: CURRENT, then RESULTS, then BLOCKED
// (`docs/task-dependencies.md` §6). Guards disable rows with a reason: the
// dependent itself, a cycle (checked on the graph after the whole batch,
// with the path), an unencodable target, or a stale target/dependent
// (refused at commit time, then reopened fresh). Removing a link is always
// allowed, so CURRENT rows are never disabled. At most about 60 rows
// render; typing reaches the rest.
