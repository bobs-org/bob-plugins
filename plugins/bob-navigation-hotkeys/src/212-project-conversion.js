// Conversion helpers for moving the ordinary Depends-On line with a task or
// the project's ^prj line. The field is a mirror; this line remains the
// source of truth during either conversion.

function collectProjectSourceDependencyBlock(content, parentLine) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const parent = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const collection = collectDependencyNavigationBullets(text, parent);
  if (collection.reason) {
    return Object.freeze({
      valid: false,
      error: "Could not read the task's Depends-On line",
      lineIndices: Object.freeze([]),
      targets: Object.freeze([]),
    });
  }

  const lineIndices = new Set(collection.lineIndices);
  const block = findCurrentBulletChildBlock(lines, parent);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (findNearestParentListItem(lines, index) !== parent) {
      continue;
    }
    const parsed = parseDependencyLine(lines[index], {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict === "malformed") {
      return Object.freeze({
        valid: false,
        error: "The task's Depends-On line is malformed; repair it before conversion",
        lineIndices: Object.freeze([]),
        targets: Object.freeze([]),
      });
    }
    if (parsed.verdict === "accept" || parsed.verdict === "empty") {
      lineIndices.add(index);
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    lineIndices: Object.freeze([...lineIndices].sort((a, b) => a - b)),
    targets: Object.freeze(collection.targets.slice()),
  });
}

// Named recogniser for the machine-owned Sub-projects child (Rule 11, MC7):
// never claims a BLOCKS line and the BLOCKS parser never claims it.
function isProjectSubprojectsLine(lineText) {
  const text = String(lineText || "");
  if (parseBlocksLine(text, {}).verdict !== "not-a-line") {
    return false;
  }
  if (parseDependencyLine(text, {}).verdict !== "not-a-line") {
    return false;
  }
  return /\*\*\s*Sub-projects?\s*:?\s*\*\*/i.test(text);
}

// On reversal, the managed dependency child moves first. The machine-owned
// Sub-projects and LINKED FROM children describe note hierarchy or a generated
// projection, so each is dropped with its whole subtree. Authored LINKS stays
// with the task that owns it; reconcile regenerates incoming mirrors later.
function splitProjectLifecycleChildren(parentLine, childLines) {
  const children = Array.isArray(childLines) ? childLines.map(String) : [];
  const synthetic = [String(parentLine || ""), ...children];
  const direct = [];
  for (let index = 1; index < synthetic.length; index += 1) {
    if (findNearestParentListItem(synthetic, index) === 0) {
      direct.push(index);
    }
  }

  const skipped = new Set();
  const dependencyLines = [];
  for (let at = 0; at < direct.length; at += 1) {
    const start = direct[at];
    const end = at + 1 < direct.length ? direct[at + 1] : synthetic.length;
    const line = synthetic[start];
    const dependency = parseDependencyLine(line, {
      isDirectChildOfTask: true,
    });
    if (dependency.verdict === "malformed") {
      return Object.freeze({
        valid: false,
        error: "Project Depends-On line is malformed; repair it before conversion",
        dependencyLine: null,
        otherLines: Object.freeze([]),
      });
    }
    if (dependency.verdict === "accept" || dependency.verdict === "empty") {
      dependencyLines.push(line);
      for (let index = start; index < end; index += 1) skipped.add(index);
      continue;
    }
    // BW18 + MC7: a BLOCKS mirror is never copied as a user child; drop it
    // like Sub-projects. Owners naming the converted source are left to
    // reconcile.
    if (parseBlocksLine(line, {}).verdict !== "not-a-line") {
      for (let index = start; index < end; index += 1) skipped.add(index);
      continue;
    }
    if (parseLinkedFromLine(line, { isDirectChildOfTask: true }).verdict !== "not-a-line") {
      for (let index = start; index < end; index += 1) skipped.add(index);
      continue;
    }
    if (isProjectSubprojectsLine(line)) {
      for (let index = start; index < end; index += 1) skipped.add(index);
    }
  }

  if (dependencyLines.length > 1) {
    return Object.freeze({
      valid: false,
      error: "Project has multiple Depends-On lines; repair it before conversion",
      dependencyLine: null,
      otherLines: Object.freeze([]),
    });
  }

  const otherLines = [];
  for (let index = 1; index < synthetic.length; index += 1) {
    if (!skipped.has(index)) otherLines.push(synthetic[index]);
  }
  return Object.freeze({
    valid: true,
    error: null,
    dependencyLine: dependencyLines[0] || null,
    otherLines: Object.freeze(otherLines),
  });
}

function rewriteProjectDependencyLineForDestination(line, options = {}) {
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  const destinationPath = normalizeVaultRelativePath(options.destinationPath);
  if (!sourcePath || !destinationPath) return String(line || "");
  const movedBlockIds = new Set(options.movedBlockIds || []);
  const sourceBlockIds = new Set(options.sourceBlockIds || []);
  return rewriteTaskMoveBlockLinks(String(line || ""), {
    sourcePath,
    destinationPath,
    currentPath: sourcePath,
    role: "moved",
    movedBlockIds,
    sourceBlockIds,
  }).content;
}

// Plan `#^prj` → restored-block-id rewrites in memory. Callers write the
// parent first, then apply the remaining files. A missing original or an
// unreadable path fails the whole plan so conversion can abort before any
// write.
function planBlockIdLinkContentRewrites(
  rewrites,
  newBasename,
  blockId,
  contentsByPath,
) {
  let updatedLinkCount = 0;
  let failedLinkCount = 0;
  const contents =
    contentsByPath instanceof Map
      ? contentsByPath
      : new Map(Object.entries(contentsByPath || {}));
  const changes = [];
  for (const rewrite of Array.isArray(rewrites) ? rewrites : []) {
    const path = normalizeVaultRelativePath(rewrite && rewrite.path);
    const originals = Array.isArray(rewrite && rewrite.originals)
      ? rewrite.originals
      : [];
    if (!path || !contents.has(path)) {
      failedLinkCount += originals.length || 1;
      continue;
    }
    const replacements = [];
    originals.forEach((original) => {
      const replacement = rewriteBlockIdLinkOriginal(
        original,
        newBasename,
        blockId,
      );
      if (!replacement) {
        failedLinkCount += 1;
        return;
      }
      replacements.push({ original, replacement });
    });
    if (replacements.length === 0) {
      continue;
    }
    const before = String(contents.get(path) || "");
    const result = replaceLinkOriginalsInContent(before, replacements);
    failedLinkCount += result.missing.length;
    updatedLinkCount += replacements.length - result.missing.length;
    if (result.content !== before) {
      changes.push({ path, before, after: result.content });
    }
  }
  return Object.freeze({
    updatedLinkCount,
    failedLinkCount,
    failed: failedLinkCount > 0,
    changes,
  });
}
