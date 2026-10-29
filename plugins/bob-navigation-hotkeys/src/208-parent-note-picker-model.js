const PARENT_PICKER_HINTS = Object.freeze([
  Object.freeze({ keys: Object.freeze(["↑", "↓"]), label: "Navigate" }),
  Object.freeze({ keys: Object.freeze(["^N", "^P"]), label: "Move" }),
  Object.freeze({ keys: Object.freeze(["↵"]), label: "Set parent" }),
  Object.freeze({ keys: Object.freeze(["esc"]), label: "Cancel" }),
]);

const PARENT_PICKER_RESULT_CAP = 50;
const PARENT_BREADCRUMB_MAX = 5;
const PARENT_ANCESTRY_MAX_HOPS = 16;
const PARENT_WORD_SEPARATORS = " _-./";

function parentNoteBasenameFromPath(path) {
  const value = String(path || "");
  const leaf = value.split("/").pop() || value;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

function isConflictsNotePath(path) {
  return String(path || "")
    .split("/")
    .some((part) => part === "_conflicts");
}

function isTerminalProjectNoteInfo(noteInfo) {
  if (!noteInfo || noteInfo.kind !== "project") {
    return false;
  }
  const key = String(noteInfo.statusKey || "");
  return key === "done" || key === "canceled" || key === "cancelled";
}

function parentKindWeight(noteInfo) {
  if (noteInfo && noteInfo.kind === "area") {
    return 0;
  }
  if (noteInfo && noteInfo.kind === "project") {
    return isTerminalProjectNoteInfo(noteInfo) ? 2 : 0;
  }
  return 1;
}

function parentQueryHasWordStart(name, query) {
  if (!name || !query || name.length <= query.length) {
    return false;
  }
  for (let index = 1; index < name.length; index += 1) {
    if (
      PARENT_WORD_SEPARATORS.includes(name[index - 1]) &&
      name.slice(index, index + query.length) === query
    ) {
      return true;
    }
  }
  return false;
}

function parentQueryIsFuzzy(name, query) {
  if (!name || !query) {
    return false;
  }
  let cursor = 0;
  for (let index = 0; index < name.length; index += 1) {
    if (name[index] === query[cursor]) {
      cursor += 1;
      if (cursor === query.length) {
        return true;
      }
    }
  }
  return false;
}

function parentQueryMatchTier(record, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const name = String(record.basename || "").toLowerCase();
  const path = String(record.path || "").toLowerCase();
  if (name === needle) {
    return 0;
  }
  if (name.startsWith(needle)) {
    return 1;
  }
  if (parentQueryHasWordStart(name, needle)) {
    return 2;
  }
  if (name.includes(needle)) {
    return 3;
  }
  if (path.includes(needle)) {
    return 4;
  }
  if (parentQueryIsFuzzy(name, needle)) {
    return 5;
  }
  return null;
}

function normalizeParentPickerRecord(record) {
  if (!record || typeof record !== "object" || !record.path) {
    return null;
  }
  const path = String(record.path);
  const recentRank = Number(record.recentRank);
  return {
    path,
    basename:
      typeof record.basename === "string" && record.basename
        ? record.basename
        : parentNoteBasenameFromPath(path),
    file: record.file || null,
    noteInfo: record.noteInfo || Object.freeze({ kind: "plain" }),
    parentPath: record.parentPath || null,
    recentRank: Number.isFinite(recentRank) ? recentRank : Infinity,
    childCount: 0,
  };
}

function buildParentPickerIndex(records, context = {}) {
  const sourcePath = context && context.sourcePath ? String(context.sourcePath) : "";
  const byPath = new Map();
  const children = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const source of list) {
    const normalized = normalizeParentPickerRecord(source);
    if (!normalized || byPath.has(normalized.path)) {
      continue;
    }
    byPath.set(normalized.path, normalized);
  }
  for (const record of byPath.values()) {
    if (!record.parentPath) {
      continue;
    }
    const siblings = children.get(record.parentPath) || [];
    siblings.push(record.path);
    children.set(record.parentPath, siblings);
    const parent = byPath.get(record.parentPath);
    if (parent) {
      parent.childCount += 1;
    }
  }
  const excluded = new Set();
  if (sourcePath) {
    excluded.add(sourcePath);
    const queue = (children.get(sourcePath) || []).slice();
    while (queue.length > 0) {
      const path = queue.shift();
      if (excluded.has(path)) {
        continue;
      }
      excluded.add(path);
      const kids = children.get(path);
      if (kids) {
        for (let index = 0; index < kids.length; index += 1) {
          queue.push(kids[index]);
        }
      }
    }
  }
  for (const record of byPath.values()) {
    if (isConflictsNotePath(record.path)) {
      excluded.add(record.path);
    }
  }
  const source = sourcePath ? byPath.get(sourcePath) : null;
  const currentParentPath =
    (source && source.parentPath) ||
    (context && context.currentParentPath) ||
    null;
  const currentParent = currentParentPath ? byPath.get(currentParentPath) : null;
  const grandparentPath = currentParent && currentParent.parentPath
    ? currentParent.parentPath
    : null;
  return {
    sourcePath,
    byPath,
    records: Array.from(byPath.values()),
    children,
    excluded,
    currentParentPath,
    grandparentPath,
  };
}

function compareParentCandidates(left, right, currentParentPath) {
  if (left.path === currentParentPath && right.path !== currentParentPath) {
    return -1;
  }
  if (right.path === currentParentPath && left.path !== currentParentPath) {
    return 1;
  }
  const kindDelta = parentKindWeight(left.noteInfo) - parentKindWeight(right.noteInfo);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  if (right.childCount !== left.childCount) {
    return right.childCount - left.childCount;
  }
  const leftRecent = Number.isFinite(left.recentRank) ? left.recentRank : Infinity;
  const rightRecent = Number.isFinite(right.recentRank) ? right.recentRank : Infinity;
  if (leftRecent !== rightRecent) {
    return leftRecent - rightRecent;
  }
  if (left.path.length !== right.path.length) {
    return left.path.length - right.path.length;
  }
  return left.path.localeCompare(right.path);
}

function takeParentCandidate(record, seen, excluded, out) {
  if (!record || seen.has(record.path) || excluded.has(record.path)) {
    return;
  }
  seen.add(record.path);
  out.push(record);
}

function rankParentCandidates(index, query, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : PARENT_PICKER_RESULT_CAP;
  const currentParentPath =
    options.currentParentPath || (index && index.currentParentPath) || null;
  const grandparentPath =
    options.grandparentPath || (index && index.grandparentPath) || null;
  const excluded = (index && index.excluded) || new Set();
  const records = (index && Array.isArray(index.records) ? index.records : []);
  const needle = String(query || "").trim();

  if (!needle) {
    const seen = new Set();
    const out = [];
    const byPath = (index && index.byPath) || new Map();
    takeParentCandidate(byPath.get(currentParentPath), seen, excluded, out);
    takeParentCandidate(byPath.get(grandparentPath), seen, excluded, out);
    const recents = records
      .filter((record) => Number.isFinite(record.recentRank) && !excluded.has(record.path))
      .slice()
      .sort(
        (left, right) =>
          left.recentRank - right.recentRank || left.path.localeCompare(right.path),
      );
    for (let indexRecent = 0; indexRecent < recents.length; indexRecent += 1) {
      takeParentCandidate(recents[indexRecent], seen, excluded, out);
    }
    const popular = records
      .filter((record) => !excluded.has(record.path))
      .slice()
      .sort(
        (left, right) =>
          right.childCount - left.childCount || left.path.localeCompare(right.path),
      );
    for (let indexPopular = 0; indexPopular < popular.length; indexPopular += 1) {
      takeParentCandidate(popular[indexPopular], seen, excluded, out);
    }
    return {
      items: out.slice(0, limit),
      total: out.length,
      excludedOnly: false,
    };
  }

  const matched = [];
  const excludedMatches = [];
  for (let indexRecord = 0; indexRecord < records.length; indexRecord += 1) {
    const record = records[indexRecord];
    const tier = parentQueryMatchTier(record, needle);
    if (tier === null) {
      continue;
    }
    if (excluded.has(record.path)) {
      excludedMatches.push(record);
      continue;
    }
    matched.push({ record, tier });
  }
  matched.sort((left, right) => {
    if (left.tier !== right.tier) {
      return left.tier - right.tier;
    }
    return compareParentCandidates(left.record, right.record, currentParentPath);
  });
  const items = matched.map((row) => row.record);
  return {
    items: items.slice(0, limit),
    total: items.length,
    excludedOnly: items.length === 0 && excludedMatches.length > 0,
  };
}

function buildParentAncestry(index, path, maxHops = PARENT_ANCESTRY_MAX_HOPS) {
  const hops = Number.isInteger(maxHops) && maxHops > 0 ? maxHops : PARENT_ANCESTRY_MAX_HOPS;
  const byPath = (index && index.byPath) || new Map();
  const seen = new Set();
  const upward = [];
  let current = path || null;
  let count = 0;
  while (current && count < hops) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const record = byPath.get(current);
    upward.push({
      path: current,
      basename: record
        ? record.basename
        : parentNoteBasenameFromPath(current),
      missing: !record,
      ellipsis: false,
    });
    current = record && record.parentPath ? record.parentPath : null;
    count += 1;
  }
  return upward.reverse();
}

function collapseParentBreadcrumb(segments, max = PARENT_BREADCRUMB_MAX) {
  const list = Array.isArray(segments) ? segments.slice() : [];
  const cap = Number.isInteger(max) && max > 0 ? max : PARENT_BREADCRUMB_MAX;
  if (list.length <= cap) {
    return list;
  }
  return [
    list[0],
    {
      path: "",
      basename: "…",
      missing: false,
      ellipsis: true,
    },
    ...list.slice(-(cap - 2)),
  ];
}

function parentChangeWouldCycle(index, sourcePath, candidatePath) {
  if (!sourcePath || !candidatePath) {
    return false;
  }
  if (sourcePath === candidatePath) {
    return true;
  }
  const ancestry = buildParentAncestry(index, candidatePath, PARENT_ANCESTRY_MAX_HOPS);
  for (let indexSeg = 0; indexSeg < ancestry.length; indexSeg += 1) {
    if (ancestry[indexSeg].path === sourcePath) {
      return true;
    }
  }
  return false;
}

function parentNameLastSegment(target) {
  const text = String(target || "").trim();
  if (!text) {
    return "";
  }
  const leaf = text.split("/").pop() || text;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

function parentEmptyStateText(query, excludedOnly) {
  const shown = String(query || "").trim();
  if (excludedOnly) {
    return `“${shown}” is inside this note's own subtree — choosing it would create a cycle`;
  }
  return `No note matches “${shown}” — the parent must be an existing note`;
}
