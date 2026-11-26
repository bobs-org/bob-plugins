// Compose the two dependency plans in a same-note reversal without losing
// either dependent's downstream effects. `second.lineEdits` is relative to
// the first plan's postimage, so the arrays compose in execution order.
function composeTieDependencyPlans(first, second) {
  const unionRefs = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const entry of lists.flat()) {
      const path = normalizeVaultRelativePath(entry && entry.path || "");
      const blockId = normalizeBulletPropertyValue(entry && entry.blockId || "");
      const key = `${path}\x00${blockId}`;
      if (!path || !blockId || seen.has(key)) continue;
      seen.add(key);
      out.push(Object.freeze({ ...entry, path, blockId }));
    }
    return Object.freeze(out);
  };
  const one = first.summary || {};
  const two = second.summary || {};
  const projectOne = one.project || null;
  const projectTwo = two.project || null;
  const project = projectOne || projectTwo
    ? Object.freeze({
        blocked: (projectOne && projectOne.blocked || 0) + (projectTwo && projectTwo.blocked || 0),
        recovered: (projectOne && projectOne.recovered || 0) + (projectTwo && projectTwo.recovered || 0),
        ready: (projectOne && projectOne.ready || 0) + (projectTwo && projectTwo.ready || 0),
        pomodoroTargets: unionRefs(
          projectOne && projectOne.pomodoroTargets || [],
          projectTwo && projectTwo.pomodoroTargets || [],
        ),
      })
    : null;
  const summary = Object.freeze({
    ...one,
    added: (one.added || 0) + (two.added || 0),
    removed: (one.removed || 0) + (two.removed || 0),
    openRemaining: two.openRemaining,
    blockedAfter: two.blockedAfter,
    recoveredOutcome: two.recoveredOutcome || one.recoveredOutcome,
    pomodoroTargets: unionRefs(one.pomodoroTargets || [], two.pomodoroTargets || []),
    project,
  });
  return Object.freeze({
    ...first,
    nextContent: second.nextContent,
    lineEdits: Object.freeze([...(first.lineEdits || []), ...(second.lineEdits || [])]),
    parentLineNext: mapLineThroughLineEdits(first.parentLineNext, second.lineEdits),
    summary,
    targetEdits: Object.freeze([...(first.targetEdits || []), ...(second.targetEdits || [])]),
    preparations: Object.freeze([...(first.preparations || []), ...(second.preparations || [])]),
    blocksFollowUps: Object.freeze([...(first.blocksFollowUps || []), ...(second.blocksFollowUps || [])]),
    blocksFailedPaths: Object.freeze([...(first.blocksFailedPaths || []), ...(second.blocksFailedPaths || [])]),
    promotions: Object.freeze([...(first.promotions || []), ...(second.promotions || [])]),
    added: Object.freeze([...(first.added || []), ...(second.added || [])]),
    removed: Object.freeze([...(first.removed || []), ...(second.removed || [])]),
    changed: first.changed === true || second.changed === true,
  });
}

function lineForTrailingTaskId(content, blockId, fallback = null) {
  const wanted = normalizeBulletPropertyValue(blockId || "");
  if (wanted) {
    const found = findTaskLineByTrailingBlockId(String(content || "").split(/\r?\n/), wanted);
    if (found !== null) return found;
  }
  return Number.isInteger(fallback) ? fallback : null;
}

// Fold counted tie absorption into the existing cross-note BLOCKS write for
// a target note. Keeping one postimage avoids one follow-up restoring the
// other's edits from a shared preimage.
function mergeCountedTieFollowUps(blocksFollowUps, tieFollowUps) {
  const out = (Array.isArray(blocksFollowUps) ? blocksFollowUps : []).map((entry) => ({
    ...entry,
    tiePairs: Array.isArray(entry.tiePairs) ? entry.tiePairs.slice() : [],
  }));
  for (const tieEntry of Array.isArray(tieFollowUps) ? tieFollowUps : []) {
    const path = normalizeVaultRelativePath(tieEntry && tieEntry.path || "");
    if (!path) continue;
    const pairs = Array.isArray(tieEntry.pairs) ? tieEntry.pairs : [];
    const matching = out.findIndex(
      (entry) => normalizeVaultRelativePath(entry.path || "") === path,
    );
    if (matching < 0) {
      out.push({ path, preimage: tieEntry.preimage, tiePairs: pairs.slice() });
      continue;
    }
    const current = out[matching];
    out[matching] = {
      ...current,
      preimage: current.preimage === tieEntry.preimage ? current.preimage : null,
      tiePairs: [...(current.tiePairs || []), ...pairs],
    };
  }
  return out;
}

function applyTiePromptPreparations(content, path, preparations) {
  const wanted = normalizeVaultRelativePath(path || "");
  const relevant = (Array.isArray(preparations) ? preparations : []).filter(
    (entry) => normalizeVaultRelativePath(entry && entry.path || "") === wanted,
  );
  if (relevant.length === 0) return String(content || "");
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  for (const entry of relevant) {
    const line = Number.isInteger(entry.line) ? entry.line : -1;
    if (line < 0 || line >= lines.length) return null;
    if (lines[line] === entry.text) continue;
    if (lines[line] !== entry.from || typeof entry.text !== "string") return null;
    lines[line] = entry.text;
  }
  return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}

function applyTiePromptPreparationsToNotes(notes, preparations) {
  const out = new Map(notes);
  const grouped = new Map();
  for (const entry of Array.isArray(preparations) ? preparations : []) {
    const path = normalizeVaultRelativePath(entry && entry.path || "");
    if (!path || !out.has(path)) return null;
    if (!grouped.has(path)) grouped.set(path, []);
    grouped.get(path).push(entry);
  }
  for (const [path, entries] of grouped) {
    const next = applyTiePromptPreparations(out.get(path), path, entries);
    if (next === null) return null;
    out.set(path, next);
  }
  return out;
}

async function confirmTieChangeBlockId(picker, item) {
  const pending = picker.pendingTieChange;
  if (!pending || !item || item.valid !== true) return false;
  const requests = Array.isArray(pending.requests) && pending.requests.length > 0
    ? pending.requests
    : [{ side: pending.missingSide, missing: pending.missing }];
  const request = requests[pending.promptIndex || 0];
  const missing = request && request.missing;
  const path = normalizeVaultRelativePath(missing && missing.path || "");
  if (!missing || !path) {
    picker.clearPendingBatch();
    new Notice("That task could not be located");
    return false;
  }
  const files = await picker.readVaultStageFiles([path]);
  const content = files && files.get(path);
  if (typeof content !== "string") return false;
  const validation = validateBlockIdCandidate(item.id, content, {
    reservedIds: pending.reservedIds || new Set(),
  });
  if (!validation.valid || !tryDependencyId(path, validation.id)) {
    new Notice(validation.message || "That block ID cannot be used in the target note");
    return false;
  }
  const lines = content.split(/\r?\n/);
  const line = Number.isInteger(missing.line) ? missing.line : -1;
  if (line < 0 || lines[line] !== missing.rawLine || !isObsidianTaskAtLine(content, line, null, lines)) {
    picker.clearPendingBatch();
    return picker.refuseDependencyStale();
  }
  const text = applyPromptedBlockIdPreservingLegacyId(lines[line], validation.id, path);
  if (text === null) return false;
  const preparation = Object.freeze({
    side: request.side,
    path,
    line,
    from: lines[line],
    text,
    blockId: validation.id,
  });
  const confirmedIds = Object.freeze({
    ...(pending.confirmedIds || {}),
    [request.side]: validation.id,
  });
  const preparations = Object.freeze([...(pending.preparations || []), preparation]);
  pending.reservedIds.add(validation.id);
  const nextIndex = (pending.promptIndex || 0) + 1;
  if (nextIndex < requests.length) {
    const next = requests[nextIndex];
    picker.pendingTieChange = Object.freeze({
      ...pending,
      promptIndex: nextIndex,
      confirmedIds,
      preparations,
      missingSide: next.side,
      missing: next.missing,
    });
    picker.showBlockIdStage(next.missing, { mode: "tie-change" });
    return false;
  }
  const owner = pending.owner && pending.owner.blockId
    ? pending.owner
    : { ...pending.owner, blockId: confirmedIds.owner };
  const other = pending.other && pending.other.blockId
    ? pending.other
    : { ...pending.other, blockId: confirmedIds.other };
  picker.clearPendingBatch();
  let outcome = null;
  try {
    outcome = await picker.plugin.applyTieChange(owner, other, pending.to, {
      promptBlockId: null,
      promptPreparations: preparations,
      expected: pending.expected,
      editor: picker.editor,
      editorPath: picker.filePath,
    });
  } catch (_error) {
    new Notice("Could not update the tie");
    return false;
  }
  if (!outcome || outcome.ok !== true) {
    new Notice((outcome && outcome.notice) || "Could not update the tie");
    return false;
  }
  if (outcome.notice) new Notice(outcome.notice);
  try {
    if (typeof picker.reopenDependencyStageFresh === "function") {
      picker.reopenDependencyStageFresh();
    }
  } catch (_error) {}
  return true;
}
