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

// Notebook parent rules (plan 202611/bob_notebooks.md) plus album and record
// parent rules (plan 202611/album_plugin_ui.md): an area, project, reference,
// record, or album note never names a notebook as its parent, and a
// notebook's parent is an area, a project, or another notebook. An album's
// parent is an area or a project of any status; a record's parent is an
// album. The kind comes from the `type:` frontmatter, mirroring bob's
// classification: area, project, notebook, ref, album, then `[[record]]` and
// any other typed note except the reserved non-record types, which are
// record notes.
const PARENT_RULE_NON_RECORD_TYPES = new Set([
  "article",
  "mail",
  "day",
  "done",
  "type",
]);

function parentRuleTypeNames(frontmatter) {
  const names = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "string") {
      return;
    }
    const text = value.trim();
    const wiki = text.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
    const name = (wiki ? wiki[1] : text)
      .trim()
      .split("/")
      .pop()
      .replace(/\.md$/i, "")
      .trim();
    if (name) {
      names.push(name);
    }
  };
  visit(frontmatter && frontmatter.type);
  return names;
}

// "area" | "project" | "notebook" | "reference" | "album" | "record" | "other".
function parentRuleKindOf(frontmatter) {
  const names = parentRuleTypeNames(frontmatter);
  if (names.includes("area")) {
    return "area";
  }
  if (names.includes("project")) {
    return "project";
  }
  if (names.includes("notebook")) {
    return "notebook";
  }
  if (names.includes("ref")) {
    return "reference";
  }
  // Albums are explicit before the legacy record fallback: without this,
  // every album would read as a record. `[[record]]` stays a record through
  // the fallback below, alongside existing noun-typed records.
  if (names.includes("album")) {
    return "album";
  }
  if (names.includes("record")) {
    return "record";
  }
  if (names.some((name) => !PARENT_RULE_NON_RECORD_TYPES.has(name))) {
    return "record";
  }
  return "other";
}

const PARENT_RULE_NO_NOTEBOOK_PARENT_KINDS = new Set([
  "area",
  "project",
  "reference",
  "album",
  "record",
]);
const PARENT_RULE_NOTEBOOK_PARENT_KINDS = new Set([
  "area",
  "project",
  "notebook",
]);

// Why `candidateKind` cannot be the parent of a `sourceKind` note, or null
// when the pair is allowed: "notebook" (the source can never hang under a
// notebook), "not-notebook-parent" (a notebook hangs only under an area,
// project, or notebook), "not-album-parent" (an album hangs only under an
// area or a project of any status), or "not-record-parent" (a record hangs
// only under an album).
function parentKindRefusal(sourceKind, candidateKind) {
  if (sourceKind === "notebook") {
    return PARENT_RULE_NOTEBOOK_PARENT_KINDS.has(candidateKind)
      ? null
      : "not-notebook-parent";
  }
  // A notebook candidate stays a notebook refusal for every ruled-out
  // source — including albums and records — so typing a notebook name always
  // teaches the same rule.
  if (
    candidateKind === "notebook" &&
    PARENT_RULE_NO_NOTEBOOK_PARENT_KINDS.has(sourceKind)
  ) {
    return "notebook";
  }
  // An album's parent is an area or a project of any status — never a
  // notebook, another album, or a record (or anything else).
  if (sourceKind === "album") {
    return candidateKind === "area" || candidateKind === "project"
      ? null
      : "not-album-parent";
  }
  // A record's parent is an album, and nothing else.
  if (sourceKind === "record") {
    return candidateKind === "album" ? null : "not-record-parent";
  }
  return null;
}

function parentKindRefusalText(refusal, candidateName) {
  const name = candidateName || "that note";
  if (refusal === "notebook") {
    return `${name} is a notebook — areas, projects, references, albums, and record notes can't hang under one`;
  }
  if (refusal === "not-notebook-parent") {
    return `${name} can't hold a notebook — a notebook hangs under an area, a project, or another notebook`;
  }
  if (refusal === "not-album-parent") {
    return `${name} can't hold an album — an album hangs under an area or a project`;
  }
  if (refusal === "not-record-parent") {
    return `${name} can't hold a record — a record hangs under an album`;
  }
  return "";
}

function parentNoteBasenameFromPath(path) {
  const value = String(path || "");
  const leaf = value.split("/").pop() || value;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
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
    ruleKind: typeof record.ruleKind === "string" ? record.ruleKind : "other",
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
  const sourceRuleKind = source ? source.ruleKind : "other";
  // Candidates the notebook/album/record parent rules rule out, kept apart
  // from the subtree exclusions so the empty state can teach the right reason.
  const hiddenByKind = new Map();
  for (const record of byPath.values()) {
    if (excluded.has(record.path)) {
      continue;
    }
    const refusal = parentKindRefusal(sourceRuleKind, record.ruleKind);
    if (refusal) {
      hiddenByKind.set(record.path, refusal);
    }
  }
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
    sourceRuleKind,
    byPath,
    records: Array.from(byPath.values()),
    children,
    excluded,
    hiddenByKind,
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
  const hiddenByKind = (index && index.hiddenByKind) || new Map();
  // Rule-refused kinds drop out of every list; the subtree exclusions stay
  // separate so an empty query never offers either.
  const excluded = new Set([
    ...((index && index.excluded) || []),
    ...hiddenByKind.keys(),
  ]);
  const subtreeExcluded = (index && index.excluded) || new Set();
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
      kindRefusal: null,
      kindRefusalName: null,
    };
  }

  const matched = [];
  const excludedMatches = [];
  const kindMatches = [];
  for (let indexRecord = 0; indexRecord < records.length; indexRecord += 1) {
    const record = records[indexRecord];
    const tier = parentQueryMatchTier(record, needle);
    if (tier === null) {
      continue;
    }
    if (subtreeExcluded.has(record.path)) {
      excludedMatches.push(record);
      continue;
    }
    if (hiddenByKind.has(record.path)) {
      kindMatches.push(record);
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
  const kindOnly =
    items.length === 0 && excludedMatches.length === 0 && kindMatches.length > 0;
  return {
    items: items.slice(0, limit),
    total: items.length,
    excludedOnly: items.length === 0 && excludedMatches.length > 0,
    kindRefusal: kindOnly ? hiddenByKind.get(kindMatches[0].path) : null,
    kindRefusalName: kindOnly ? kindMatches[0].basename : null,
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

// The commit-time check against the live index: the notice text when the
// notebook/album/record parent rules forbid `candidatePath` as
// `sourcePath`'s parent.
function parentChangeKindRefusal(index, sourcePath, candidatePath) {
  const byPath = (index && index.byPath) || new Map();
  const source = byPath.get(sourcePath);
  const candidate = byPath.get(candidatePath);
  if (!source || !candidate) {
    return null;
  }
  const refusal = parentKindRefusal(source.ruleKind, candidate.ruleKind);
  return refusal
    ? parentKindRefusalText(refusal, candidate.basename)
    : null;
}

function parentNameLastSegment(target) {
  const text = String(target || "").trim();
  if (!text) {
    return "";
  }
  const leaf = text.split("/").pop() || text;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

// `kindRefusal` / `kindRefusalName` come from `rankParentCandidates` when
// every match was ruled out by the notebook/album/record parent rules.
function parentEmptyStateText(query, excludedOnly, kindRefusal, kindRefusalName) {
  const shown = String(query || "").trim();
  if (excludedOnly) {
    return `“${shown}” is inside this note's own subtree — choosing it would create a cycle`;
  }
  if (kindRefusal) {
    return parentKindRefusalText(kindRefusal, kindRefusalName || shown);
  }
  return `No note matches “${shown}” — the parent must be an existing note`;
}
