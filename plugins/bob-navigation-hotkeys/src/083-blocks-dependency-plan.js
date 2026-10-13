// The nav mirror of the shared Rust BLOCKS planner. This seam computes the
// changed owner notes from the forward-edge delta; same-note edits join the
// dependent transaction and cross-note edits are returned for a checked
// post-commit write (docs/task-dependencies.md §14.7).
function blocksIdentity(path, blockId) {
  const normalized = normalizeVaultRelativePath(path);
  const id = normalizeBulletPropertyValue(blockId);
  return normalized && id ? `${normalized}#^${id}` : "";
}

function blocksPathIsWritable(path, previousDailyPath) {
  const normalized = normalizeVaultRelativePath(path);
  return Boolean(
    normalized &&
      !/^done\//i.test(normalized) &&
      normalized !== normalizeVaultRelativePath(previousDailyPath || ""),
  );
}

function blocksNotePreimage(path, files, preparations) {
  const original = files instanceof Map ? files.get(path) : null;
  if (original === undefined || original === null) return null;
  const newline = String(original).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(original).split(/\r?\n/);
  for (const edit of Array.isArray(preparations) ? preparations : []) {
    if (edit.path !== path || !Number.isInteger(edit.line) || edit.line < 0 || edit.line >= lines.length) continue;
    if (lines[edit.line] === edit.from) lines[edit.line] = edit.text;
  }
  return lines.join(newline);
}

function blocksOwnerState(path, blockId, content) {
  const lines = String(content || "").split(/\r?\n/);
  const line = findTaskLineByTrailingBlockId(lines, blockId);
  if (line === null) return null;
  const status = getObsidianTaskCheckboxStatus(lines[line]);
  return Object.freeze({ line, status, open: OPEN_OBSIDIAN_TASK_STATUSES.has(status) });
}

function blocksLinkForIdentity(identity, ownerPath, vaultFiles) {
  const split = String(identity || "").match(/^(.*)#\^([A-Za-z0-9-]+)$/);
  if (!split) return "";
  return canonicalDependencyLink(
    { path: split[1], blockId: split[2] },
    ownerPath,
    vaultFiles,
  ).text;
}

function blocksExistingRows(ownerPath, lineText, resolveLinkpath, vaultFiles) {
  const parsed = parseBlocksLine(lineText, { isDirectChildOfTask: true });
  return parsed.links.map((entry) => {
    const targetPath = dependencyPathForLinkNote(entry.note, ownerPath, resolveLinkpath);
    const identity = blocksIdentity(targetPath, entry.blockId);
    const link = targetPath
      ? canonicalDependencyLink({ path: targetPath, blockId: entry.blockId }, ownerPath, vaultFiles).text
      : `[[${entry.note ? `${entry.note}#` : "#"}^${entry.blockId}]]`;
    return Object.freeze({ note: entry.note, blockId: entry.blockId, identity, link });
  });
}

function planBlocksForDependencyEdit(args = {}) {
  const original = String(args.content || "");
  let nextContent = String(args.nextContent === undefined ? original : args.nextContent);
  if (args.blocksLinesEnabled !== true) {
    return Object.freeze({ nextContent, blocksFollowUps: Object.freeze([]), failedPaths: Object.freeze([]) });
  }
  const parentPath = normalizeVaultRelativePath(args.parentPath || "");
  const parentLine = Math.floor(Number(args.parentLine));
  const files = args.files instanceof Map ? args.files : new Map(Object.entries(args.files || {}));
  const vaultFiles = Array.isArray(args.vaultFiles) ? args.vaultFiles : [...files.keys()];
  const resolveLinkpath = typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const today = args.today || new Date();
  const dailyPaths = scheduledRecoveryDailyPaths(vaultFiles.map((path) => typeof path === "string" ? { path } : path), today);
  const previousDailyPath = dailyPaths && dailyPaths.previous;
  const originalLines = original.split(/\r?\n/);
  const nextLines = nextContent.split(/\r?\n/);
  if (!parentPath || !Number.isInteger(parentLine) || !isObsidianTaskAtLine(original, parentLine)) {
    return Object.freeze({ nextContent, blocksFollowUps: Object.freeze([]), failedPaths: Object.freeze([]) });
  }

  const oldByKey = new Map();
  for (const ref of Array.isArray(args.existing) ? args.existing : []) {
    const key = dependencyTargetRefKey(ref);
    if (!oldByKey.has(key)) oldByKey.set(key, ref);
  }
  const newByKey = new Map();
  for (const row of Array.isArray(args.resolved) ? args.resolved : []) {
    const ref = row && row.ref ? row.ref : row;
    const key = ref && dependencyTargetRefKey(ref);
    if (key && !newByKey.has(key)) newByKey.set(key, ref);
  }
  const edgeAdded = [...newByKey].some(([key]) => !oldByKey.has(key));
  const dependentOpen = OPEN_OBSIDIAN_TASK_STATUSES.has(getObsidianTaskCheckboxStatus(originalLines[parentLine]));
  const parentWritable = blocksPathIsWritable(parentPath, previousDailyPath);
  let dependentBlockId = getTrailingBlockId(nextLines[parentLine]);

  // Mint only when this forward edit will newly list the dependent. Once
  // minted, all of its existing open prerequisites can receive the link too.
  let mintNeeded = !dependentBlockId && edgeAdded && dependentOpen && parentWritable;
  const ownerContentFor = (path) => {
    if (path === parentPath) return nextContent;
    return blocksNotePreimage(path, files, args.preparations) ?? String(files.get(path) || "");
  };
  const eligibleNewOwners = [...newByKey.values()].filter((ref) => {
    if (!ref || !blocksPathIsWritable(ref.path, previousDailyPath)) return false;
    const state = blocksOwnerState(ref.path, ref.blockId, ownerContentFor(ref.path));
    return Boolean(state && state.open);
  });
  if (mintNeeded && eligibleNewOwners.length === 0) mintNeeded = false;
  if (mintNeeded) {
    const used = new Set();
    for (const match of String(nextContent).matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)) used.add(match[1]);
    dependentBlockId = mintDependentBlockId(originalLines[parentLine], used);
    nextLines[parentLine] = appendBlockIdToLine(nextLines[parentLine], dependentBlockId);
    nextContent = nextLines.join(nextContent.includes("\r\n") ? "\r\n" : "\n");
  }
  if (!dependentBlockId) {
    return Object.freeze({ nextContent, blocksFollowUps: Object.freeze([]), failedPaths: Object.freeze([]) });
  }

  const dependentIdentity = blocksIdentity(parentPath, dependentBlockId);
  const additions = [];
  const removals = [];
  for (const [key, ref] of newByKey) {
    if (mintNeeded || !oldByKey.has(key)) additions.push(ref);
  }
  for (const [key, ref] of oldByKey) {
    if (!newByKey.has(key)) removals.push(ref);
  }
  const byOwner = new Map();
  const register = (ref, kind) => {
    const ownerPath = normalizeVaultRelativePath(ref && ref.path);
    const ownerBlockId = normalizeBulletPropertyValue(ref && ref.blockId);
    if (!ownerPath || !ownerBlockId || !blocksPathIsWritable(ownerPath, previousDailyPath)) return;
    const ownerContent = ownerContentFor(ownerPath);
    const state = blocksOwnerState(ownerPath, ownerBlockId, ownerContent);
    // Closed owners freeze as history. Closed dependents are only removed,
    // never newly projected.
    if (!state || !state.open || (kind === "add" && !dependentOpen)) return;
    const key = `${ownerPath}#^${ownerBlockId}`;
    if (!byOwner.has(key)) {
      byOwner.set(key, { path: ownerPath, ownerBlockId, add: [], remove: [], preimage: ownerContent });
    }
    const row = byOwner.get(key);
    if (kind === "add") {
      const link = canonicalDependencyLink({ path: parentPath, blockId: dependentBlockId }, ownerPath, vaultFiles).text;
      row.add.push(Object.freeze({ identity: dependentIdentity, link }));
    } else {
      row.remove.push(dependentIdentity);
    }
  };
  for (const ref of additions) register(ref, "add");
  for (const ref of removals) register(ref, "remove");

  const failedPaths = new Set();
  const followUps = [];
  for (const row of byOwner.values()) {
    const ownerContent = row.path === parentPath ? nextContent : row.preimage;
    const ownerLines = ownerContent.split(/\r?\n/);
    const ownerLine = findTaskLineByTrailingBlockId(ownerLines, row.ownerBlockId);
    if (ownerLine === null) continue;
    const childLines = findBlocksChildren(ownerLines, ownerLine);
    const parsed = childLines.map((index) => parseBlocksLine(ownerLines[index], { isDirectChildOfTask: true }));
    if (parsed.some((entry) => entry.verdict === "malformed")) {
      failedPaths.add(row.path);
      continue;
    }
    const existingRows = childLines.flatMap((index) =>
      blocksExistingRows(row.path, ownerLines[index], resolveLinkpath, vaultFiles),
    );
    const desired = blocksDesiredAfterDelta(
      existingRows,
      (entry) => entry.identity || null,
      row.add,
      row.remove,
    );
    if (row.path === parentPath) {
      const plan = planBlocksLineEdit(nextContent, ownerLine, desired);
      if (!plan.ok) {
        failedPaths.add(row.path);
        continue;
      }
      nextContent = plan.nextContent;
    } else {
      followUps.push(Object.freeze({
        path: row.path,
        ownerBlockId: row.ownerBlockId,
        add: Object.freeze(row.add.map((entry) => entry.link)),
        remove: Object.freeze(row.remove.slice()),
        preimage: blocksNotePreimage(row.path, files, args.preparations),
        today,
      }));
    }
  }
  return Object.freeze({
    nextContent,
    blocksFollowUps: Object.freeze(followUps),
    failedPaths: Object.freeze([...failedPaths]),
  });
}

// Apply line substitutions and structural inserts/deletes for the forward
// Depends-On planner. Kept beside the BLOCKS seam so 080 stays below the
// source fragment's 1000-line limit.
function applyDependencyPlanLines(lines, parentIndex, parentText, sameNoteTargetEdits, structural, lineText, lineEnding = "\n") {
  const sourceLines = Array.isArray(lines) ? lines.slice() : [];
  const ending = lineEnding === "\r\n" ? "\r\n" : "\n";
  sourceLines[parentIndex] = parentText;
  for (const edit of sameNoteTargetEdits) {
    if (Number.isInteger(edit.line) && edit.line >= 0 && edit.line < sourceLines.length && edit.line !== parentIndex) {
      sourceLines[edit.line] = edit.text;
    }
  }
  const deletes = (structural.deleteLines || []).slice().sort((a, b) => b - a);
  for (const lineIndex of deletes) if (lineIndex >= 0 && lineIndex < sourceLines.length) sourceLines.splice(lineIndex, 1);
  if (structural.insertAt !== null && structural.insertAt !== undefined) {
    let at = structural.insertAt;
    for (const lineIndex of deletes) if (lineIndex < structural.insertAt) at -= 1;
    sourceLines.splice(Math.max(0, Math.min(at, sourceLines.length)), 0, lineText);
  } else if (structural.replaceLine !== null && structural.replaceLine !== undefined) {
    let at = structural.replaceLine;
    for (const lineIndex of deletes) if (lineIndex < structural.replaceLine) at -= 1;
    sourceLines[at] = lineText;
  }
  return { lines: sourceLines, lineEnding: ending };
}
