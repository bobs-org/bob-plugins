function canonicalDependencyLink(target, sourcePath, markdownFiles) {
  const ref = normalizeDependencyTargetRef(target);
  const source = normalizeVaultRelativePath(sourcePath);
  let paths = [];
  if (markdownFiles instanceof Map) {
    paths = [...markdownFiles.keys()];
  } else if (Array.isArray(markdownFiles)) {
    paths = markdownFiles.map((entry) =>
      entry && typeof entry === "object" ? entry.path : entry,
    );
  } else if (markdownFiles && typeof markdownFiles === "object") {
    paths = Object.keys(markdownFiles);
  }
  paths = paths
    .map((entry) => normalizeVaultRelativePath(entry))
    .filter(Boolean);
  if (ref.path === source) {
    return Object.freeze({ note: "", text: `[[#^${ref.blockId}]]` });
  }
  const basename = ref.path.split("/").pop().replace(/\.md$/i, "");
  // Archive targets always keep the explicit `done/` path form (contract
  // §3): basename links do not search `done/`, so the short form would
  // stop resolving.
  const isArchiveTarget = /^done\//i.test(ref.path);
  const rivals = paths.filter(
    (entry) =>
      entry !== ref.path &&
      entry.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
        basename.toLowerCase(),
  );
  if (rivals.length === 0 && !isArchiveTarget) {
    return Object.freeze({ note: basename, text: `[[${basename}#^${ref.blockId}]]` });
  }
  const full = ref.path.replace(/\.md$/i, "");
  return Object.freeze({ note: full, text: `[[${full}#^${ref.blockId}]]` });
}

// Find the first `#task` line carrying a trailing `^blockId`, or null.
function findTaskLineByTrailingBlockId(lines, blockId) {
  const wanted = normalizeBulletPropertyValue(blockId);
  if (!wanted) {
    return null;
  }
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const content = sourceLines.join("\n");
  for (let index = 0; index < sourceLines.length; index += 1) {
    if (
      isObsidianTaskAtLine(content, index) &&
      getTrailingBlockId(String(sourceLines[index] || "")) === wanted
    ) {
      return index;
    }
  }
  return null;
}

// Pure planner (`docs/task-dependencies.md` §§2-3, 5-6). `add`/`remove` are
// arrays of `{path, blockId}`; `files` maps vault-relative note paths to
// contents for target `[id::]` lookup and link-form ranking. Returns a plan
// whose `nextContent` is the dependent note's full next text, `targetEdits`
// (same-note, applied in the one transaction) and `preparations`
// (cross-note, applied first) cover `^id` / `[id::]` writes, and `status`
// carries the Blocked / commitment-transfer / ADJ-8 recovery effects.
// `options.recovery` (`{registry, today}`) lets a removal recover the
// dependent to its derived rank immediately on the post-edit buffer.
function planDependencyEdit(args = {}) {
  const content = String(args.content || "");
  const parentPath = normalizeVaultRelativePath(args.parentPath || "");
  const parentIndex = Math.floor(numericOrDefault(args.parentLine, Number.NaN));
  const fail = (reason) =>
    Object.freeze({ ok: false, reason, changed: false, notice: null });
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (
    !Number.isFinite(parentIndex) ||
    parentIndex < 0 ||
    parentIndex >= lines.length
  ) {
    return fail("parent-out-of-range");
  }
  if (!isObsidianTaskAtLine(content, parentIndex)) {
    return fail("not-task");
  }
  if (isBlockquotedMarkdownLine(lines[parentIndex])) {
    return fail("in-blockquote");
  }
  const filesMap = new Map();
  const rawFiles = args.files;
  if (rawFiles instanceof Map) {
    for (const [filePath, fileContent] of rawFiles) {
      filesMap.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
    }
  } else if (rawFiles && typeof rawFiles === "object") {
    for (const filePath of Object.keys(rawFiles)) {
      filesMap.set(
        normalizeVaultRelativePath(filePath),
        String(rawFiles[filePath] || ""),
      );
    }
  }
  if (!filesMap.has(parentPath)) {
    filesMap.set(parentPath, content);
  }
  // Link-form ranking uses the vault's file list when the caller injects it
  // (`args.vaultFiles`); otherwise it falls back to the loaded notes. Link
  // paths resolve through `args.resolveLinkpath` (the vault's linkpath
  // resolver) with the same-note suffix heuristic as the fallback.
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const rankPaths =
    Array.isArray(args.vaultFiles) && args.vaultFiles.length > 0
      ? args.vaultFiles
          .map((entry) =>
            entry && typeof entry === "object" ? entry.path : entry,
          )
          .map((entry) => normalizeVaultRelativePath(entry))
          .filter(Boolean)
      : [...filesMap.keys()];

  const add = (Array.isArray(args.add) ? args.add : [])
    .map(normalizeDependencyTargetRef)
    .filter((ref) => ref.path && ref.blockId);
  const remove = (Array.isArray(args.remove) ? args.remove : [])
    .map(normalizeDependencyTargetRef)
    .filter((ref) => ref.path && ref.blockId);

  const parentStatusBefore = getObsidianTaskCheckboxStatus(lines[parentIndex]);
  // Legacy children join the order while the field (or this batch) still
  // manages them, so a touch folds them into the line in the same write.
  const collection = collectDependencyNavigationBullets(content, parentIndex, [
    ...add.map((ref) => ({
      blockId: ref.blockId,
      note: dependencyLinkNoteForPath(ref.path, parentPath),
    })),
    ...remove.map((ref) => ({
      blockId: ref.blockId,
      note: dependencyLinkNoteForPath(ref.path, parentPath),
    })),
  ]);
  if (collection.reason) {
    return fail(collection.reason);
  }
  const existing = collection.targets.map((target) =>
    Object.freeze({
      path: dependencyPathForLinkNote(target.note, parentPath, resolveLinkpath),
      blockId: target.blockId,
      note: String(target.note || "").trim(),
    }),
  );
  // Existing links keep their order; new links append; re-adds move to the
  // end; removals drop. Never re-sorts.
  const removeKeys = new Set(remove.map(dependencyTargetRefKey));
  const finalRefs = [];
  const seenKeys = new Set();
  for (const ref of existing) {
    const key = dependencyTargetRefKey(ref);
    if (removeKeys.has(key)) {
      continue;
    }
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    finalRefs.push(ref);
  }
  for (const ref of add) {
    const key = dependencyTargetRefKey(ref);
    if (seenKeys.has(key)) {
      const at = finalRefs.findIndex(
        (entry) => dependencyTargetRefKey(entry) === key,
      );
      if (at !== -1) {
        finalRefs.splice(at, 1);
      }
    }
    seenKeys.add(key);
    finalRefs.push(ref);
  }

  // Resolve every final target to its dependency id and canonical link.
  // A kept link whose note is not loaded (an unloaded cross-note target, or
  // a deleted note) stays verbatim: its id comes from the parent field by
  // position and it counts as open, so recovery never fires on unknowns.
  // Removing such a link always works. Only added links must resolve.
  const filePaths = [...filesMap.keys()];
  const keptExisting = existing.filter(
    (ref) => !removeKeys.has(dependencyTargetRefKey(ref)),
  );
  const parentField = findBulletPropertyField(lines[parentIndex], "dependsOn");
  const parentFieldValues = parentField
    ? parseLocalTaskIdList(parentField.value)
    : [];
  const addedKeys = new Set(add.map(dependencyTargetRefKey));
  const resolved = [];
  const targetRows = new Map();
  for (const ref of finalRefs) {
    const targetContent = filesMap.has(ref.path)
      ? String(filesMap.get(ref.path) || "").split(/\r?\n/)
      : null;
    if (!targetContent) {
      if (addedKeys.has(dependencyTargetRefKey(ref))) {
        return fail("target-not-found");
      }
      if (parentFieldValues.length !== existing.length) {
        return fail("target-not-found");
      }
      const slot = existing.findIndex(
        (entry) => dependencyTargetRefKey(entry) === dependencyTargetRefKey(ref),
      );
      const keptValue =
        slot !== -1 ? parentFieldValues[slot] : undefined;
      if (!keptValue) {
        return fail("target-not-found");
      }
      const keptNote = slot !== -1 ? existing[slot].note : "";
      const row = Object.freeze({
        ref,
        depValue: keptValue,
        link: Object.freeze({
          note: keptNote,
          text: keptNote ? `[[${keptNote}#^${ref.blockId}]]` : `[[#^${ref.blockId}]]`,
        }),
        line: null,
        text: "",
        status: "?",
        open: true,
        description: `^${ref.blockId}`,
        needsBlockId: false,
        needsIdField: false,
      });
      resolved.push(row);
      targetRows.set(dependencyTargetRefKey(ref), row);
      continue;
    }
    const targetLine = findTaskLineByTrailingBlockId(targetContent, ref.blockId);
    if (targetLine === null) {
      return fail("target-not-found");
    }
    const targetText = String(targetContent[targetLine] || "");
    const depValue = dependencyTargetId(targetText, ref.path, ref.blockId);
    if (!depValue) {
      return fail("target-id-unencodable");
    }
    const link = canonicalDependencyLink(ref, parentPath, rankPaths);
    const status = getObsidianTaskCheckboxStatus(targetText);
    const row = Object.freeze({
      ref,
      depValue,
      link,
      line: targetLine,
      text: targetText,
      status,
      open: OPEN_OBSIDIAN_TASK_STATUSES.has(status),
      description: cleanTaskDisplayText(targetText),
      needsBlockId: !getTrailingBlockId(targetText),
      needsIdField:
        normalizeBulletPropertyValue(
          findBulletPropertyField(targetText, "id")
            ? findBulletPropertyField(targetText, "id").value
            : "",
        ) !== depValue,
    });
    resolved.push(row);
    targetRows.set(dependencyTargetRefKey(ref), row);
  }

  const existingKeys = new Set(existing.map(dependencyTargetRefKey));
  const seenAddKeys = new Set();
  const addedRows = [];
  let addedCount = 0;
  for (const ref of add) {
    const key = dependencyTargetRefKey(ref);
    if (seenAddKeys.has(key)) {
      continue;
    }
    seenAddKeys.add(key);
    const row = targetRows.get(key);
    if (row) {
      addedRows.push(row);
    }
    if (!existingKeys.has(key) && !removeKeys.has(key)) {
      addedCount += 1;
    }
  }
  const removedCount = existing.filter(
    (ref) => !targetRows.has(dependencyTargetRefKey(ref)),
  ).length;

  // Field mirrors the line's order; an empty list removes the field (R9 has
  // no placeholder).
  const seenValues = new Set();
  const fieldValues = [];
  for (const row of resolved) {
    if (seenValues.has(row.depValue)) {
      continue;
    }
    seenValues.add(row.depValue);
    fieldValues.push(row.depValue);
  }
  let parentText = String(lines[parentIndex] || "");
  if (fieldValues.length === 0) {
    parentText = deleteBulletProperty(parentText, "dependsOn").line;
  } else {
    const nextField = formatBulletPropertyField(
      "dependsOn",
      fieldValues.join(", "),
    );
    const existingField = findBulletPropertyField(parentText, "dependsOn");
    parentText = existingField
      ? parentText.slice(0, existingField.span.start) +
        nextField +
        parentText.slice(existingField.span.end)
      : upsertBulletProperty(parentText, "dependsOn", fieldValues.join(", ")).line;
  }

  // Status effects (§5). Adding an open prerequisite blocks the dependent;
  // when the dependent held Next/In Progress, the open target rises to at
  // least that lane (commitment transfer). The hand-edit mirror
  // (`mirrorTouch`) applies the same effects from the hand-edited state:
  // a hand-added open prerequisite blocks, but there is never a commitment
  // transfer.
  const mirrorTouch = args.mirrorTouch === true;
  const addedOpen = addedRows.filter((row) => row.open);
  let blockParent = false;
  const mirrorOpenRemaining = resolved.filter((row) => row.open).length;
  if (mirrorTouch ? mirrorOpenRemaining > 0 : addedOpen.length > 0) {
    const blocked = blockObsidianTaskCheckboxStatus(parentText);
    blockParent = blocked !== parentText;
    parentText = blocked;
  }
  const promotions = [];
  for (const row of (mirrorTouch ? [] : addedOpen)) {
    const desired = getDependencyPromotionStatus(parentStatusBefore);
    if (!desired) {
      continue;
    }
    const promoted = promoteObsidianTaskCheckboxStatus(row.text, desired);
    if (promoted !== row.text) {
      promotions.push(
        Object.freeze({
          path: row.ref.path,
          line: row.line,
          from: row.text,
          to: promoted,
        }),
      );
    }
  }

  // Same-note target writes join the dependent's one transaction;
  // cross-note targets are prepared first (an unused id is acceptable, a
  // link to an unprepared target is not).
  const targetEdits = [];
  const preparations = [];
  const recordTargetWrite = (row, nextText) => {
    if (nextText === row.text) {
      return;
    }
    const edit = Object.freeze({
      path: row.ref.path,
      line: row.line,
      from: row.text,
      text: nextText,
    });
    if (row.ref.path === parentPath) {
      targetEdits.push(edit);
    } else {
      preparations.push(
        Object.freeze({ ...edit, kind: "target-identity" }),
      );
    }
  };
  for (const row of resolved) {
    let nextText = row.text;
    const promotion = promotions.find(
      (entry) =>
        entry.path === row.ref.path && entry.line === row.line,
    );
    if (promotion) {
      nextText = promotion.to;
    }
    if (row.needsBlockId) {
      nextText = appendBlockIdToLine(nextText, row.ref.blockId);
    }
    if (row.needsIdField || row.needsBlockId) {
      const upserted = upsertBulletProperty(nextText, "id", row.depValue);
      nextText = upserted.line;
    }
    recordTargetWrite(row, nextText);
  }

  // The line: create, append, remove, or delete (empty list deletes it).
  const linkTargets = resolved.map((row) => ({
    blockId: row.ref.blockId,
    note: row.link.note,
  }));
  const indent =
    collection.indent === null || collection.indent === undefined
      ? getDependencyChildIndent(lines, parentIndex)
      : collection.indent;
  const marker =
    collection.marker === null || collection.marker === undefined
      ? "-"
      : collection.marker;
  const lineText =
    linkTargets.length === 0
      ? null
      : formatDependencyNavigationBulletWithMarker(linkTargets, indent, marker);
  const structural = { replaceLine: null, insertAt: null, deleteLines: [] };
  if (collection.lineIndex !== null && collection.lineIndex !== undefined) {
    structural.replaceLine = collection.lineIndex;
  }
  for (const lineIndex of collection.lineIndices) {
    if (lineIndex !== structural.replaceLine) {
      structural.deleteLines.push(lineIndex);
    }
  }
  if (lineText === null) {
    if (structural.replaceLine !== null) {
      structural.deleteLines.push(structural.replaceLine);
      structural.replaceLine = null;
    }
  } else if (structural.replaceLine === null) {
    structural.insertAt = getDependencyInsertLine(lines, parentIndex);
  }

  // Removing a dependency recovers the dependent to its derived rank
  // immediately (ADJ-8) when no open prerequisite and no future `scheduled`
  // date remain; otherwise it stays `[?]`. The hooks keep the final word.
  // A cleared field counts as a removal even when no link row was removed
  // (field-only Ctrl+D), and the hand-edit mirror recovers whenever no open
  // prerequisite remains, since the hand edit itself is the removal.
  const openRemaining = resolved.filter((row) => row.open).length;
  const recoveryToday =
    args.recovery && args.recovery.today
      ? args.recovery.today
      : new Date();
  const fieldCleared =
    parentFieldValues.length > 0 && fieldValues.length === 0;
  let recoverParent =
    (removedCount > 0 || fieldCleared || mirrorTouch) &&
    openRemaining === 0 &&
    getObsidianTaskCheckboxStatus(parentText) === "?" &&
    !dependencyParentHasFutureSchedule(parentText, recoveryToday);
  let recoveredOutcome = null;
  if (recoverParent && args.recovery && args.recovery.registry) {
    const preview = applyDependencyPlanLines(
      lines,
      parentIndex,
      parentText,
      targetEdits.filter((edit) => edit.path === parentPath),
      structural,
      lineText,
      lineEnding,
    );
    // Recovery resolves over the vault snapshot with the edited buffer
    // overriding (`args.recovery.vaultContents`), so Pomodoro-linked
    // dependents in unloaded notes (including today's daily note) recover
    // to their derived rank instead of deferring or defaulting to Ready.
    const recoveryFiles = new Map();
    const vaultContents =
      args.recovery && args.recovery.vaultContents;
    if (vaultContents instanceof Map) {
      for (const [filePath, fileContent] of vaultContents) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (normalized) {
          recoveryFiles.set(normalized, String(fileContent || ""));
        }
      }
    } else if (vaultContents && typeof vaultContents === "object") {
      for (const filePath of Object.keys(vaultContents)) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (normalized) {
          recoveryFiles.set(normalized, String(vaultContents[filePath] || ""));
        }
      }
    }
    for (const filePath of filePaths) {
      recoveryFiles.set(
        filePath,
        filePath === parentPath
          ? preview.lines.join(preview.lineEnding)
          : String(filesMap.get(filePath) || ""),
      );
    }
    const recoveryIndex = buildScheduledRecoveryIndex(
      [...recoveryFiles].map(([path, content]) => ({ path, content })),
      args.recovery.registry,
      args.recovery.today,
    );
    const metadata = getScheduledRecoveryMetadata(
      recoveryIndex,
      parentPath,
      parentIndex,
    );
    const reconciled = reconcileBlockedScheduledTaskLine(parentText, metadata);
    parentText = reconciled.line;
    recoveredOutcome = reconciled.outcome;
    recoverParent = reconciled.outcome === "still-blocked";
  }

  const next = applyDependencyPlanLines(
    lines,
    parentIndex,
    parentText,
    targetEdits.filter((edit) => edit.path === parentPath),
    structural,
    lineText,
    lineEnding,
  );
  const nextContent = next.lines.join(next.lineEnding);
  const summary = Object.freeze({
    added: addedCount,
    removed: removedCount,
    openRemaining,
    blockedAfter: getObsidianTaskCheckboxStatus(parentText) === "?",
    recoveredOutcome,
  });
  return Object.freeze({
    ok: true,
    reason: null,
    changed: nextContent !== content,
    parentPath,
    parentLine: parentIndex,
    nextContent,
    field: fieldValues.length === 0 ? null : fieldValues.join(", "),
    lineText,
    structural: Object.freeze({
      replaceLine: structural.replaceLine,
      insertAt: structural.insertAt,
      deleteLines: Object.freeze(structural.deleteLines.slice()),
    }),
    targetEdits: Object.freeze(targetEdits),
    preparations: Object.freeze(preparations),
    promotions: Object.freeze(promotions),
    blockParent,
    recoverParent,
    added: Object.freeze(addedRows.map((row) => row.description)),
    removed: Object.freeze(
      existing
        .filter((ref) => !targetRows.has(dependencyTargetRefKey(ref)))
        .map((ref) => describeRemovedDependencyTarget(ref, filesMap)),
    ),
    summary,
    notice: buildDependencyEditNotice(summary, {
      added: addedRows.map((row) => row.description),
      removed: existing
        .filter((ref) => !targetRows.has(dependencyTargetRefKey(ref)))
        .map((ref) => describeRemovedDependencyTarget(ref, filesMap)),
    }),
  });
}

// Apply one plan's dependent-note edits to a line array: same-line
// replacements first (indices stay valid), then deletions descending, then
// the line insert adjusted past earlier deletions.
function applyDependencyPlanLines(
  lines,
  parentIndex,
  parentText,
  sameNoteTargetEdits,
  structural,
  lineText,
  lineEnding = "\n",
) {
  const sourceLines = Array.isArray(lines) ? lines.slice() : [];
  const ending = lineEnding === "\r\n" ? "\r\n" : "\n";
  sourceLines[parentIndex] = parentText;
  for (const edit of sameNoteTargetEdits) {
    if (
      Number.isInteger(edit.line) &&
      edit.line >= 0 &&
      edit.line < sourceLines.length &&
      edit.line !== parentIndex
    ) {
      sourceLines[edit.line] = edit.text;
    }
  }
  const deletes = (structural.deleteLines || []).slice().sort((a, b) => b - a);
  for (const lineIndex of deletes) {
    if (lineIndex >= 0 && lineIndex < sourceLines.length) {
      sourceLines.splice(lineIndex, 1);
    }
  }
  let delta = 0;
  if (structural.insertAt !== null && structural.insertAt !== undefined) {
    delta = structural.insertAt;
    for (const lineIndex of deletes) {
      if (lineIndex < structural.insertAt) {
        delta -= 1;
      }
    }
    sourceLines.splice(Math.max(0, Math.min(delta, sourceLines.length)), 0, lineText);
  } else if (structural.replaceLine !== null && structural.replaceLine !== undefined) {
    let at = structural.replaceLine;
    for (const lineIndex of deletes) {
      if (lineIndex < structural.replaceLine) {
        at -= 1;
      }
    }
    sourceLines[at] = lineText;
  }
  return { lines: sourceLines, lineEnding: ending };
}

// Removal notices name the task's description, never its block id
// (`docs/task-dependencies.md` §6.7): resolve the removed target's display
// text from the loaded notes, falling back to `^blockId` when the note is
// gone or the line no longer resolves.
function describeRemovedDependencyTarget(ref, filesMap) {
  try {
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    const blockId = normalizeBulletPropertyValue((ref && ref.blockId) || "");
    if (!path || !blockId || !(filesMap instanceof Map)) {
      return blockId ? `^${blockId}` : "(missing task)";
    }
    const content = filesMap.get(path);
    if (content === undefined) {
      return `^${blockId}`;
    }
    const targetLines = String(content).split(/\r?\n/);
    const found = findTaskLineByTrailingBlockId(targetLines, blockId);
    if (found === null) {
      return `^${blockId}`;
    }
    const cleaned = cleanTaskDisplayText(String(targetLines[found] || ""));
    return cleaned || `^${blockId}`;
  } catch (_removedNameError) {
    const fallback = normalizeBulletPropertyValue((ref && ref.blockId) || "");
    return fallback ? `^${fallback}` : "(missing task)";
  }
}

// Contract §6.7 notices for one dependency gesture.
function buildDependencyEditNotice(summary, names = {}) {
  const added = Math.max(0, summary.added || 0);
  const removed = Math.max(0, summary.removed || 0);
  const firstAdded = (names.added || [])[0];
  const firstRemoved = (names.removed || [])[0];
  const state = summary.blockedAfter
    ? `Blocked${summary.openRemaining > 0 ? ` (${summary.openRemaining} open)` : ""}`
    : summary.recoveredOutcome && summary.recoveredOutcome !== "still-blocked"
      ? "Ready again"
      : "Ready";
  if (added === 1 && removed === 0 && firstAdded) {
    return `⛓ Now waits on "${firstAdded}" · ${summary.blockedAfter ? "Blocked" : "Ready"}`;
  }
  if (added === 0 && removed === 1 && firstRemoved) {
    return `⛓ No longer waits on "${firstRemoved}" · ${summary.blockedAfter ? "Still blocked" : "Ready again"}`;
  }
  const parts = [];
  if (added > 0) {
    parts.push(`${added} added`);
  }
  if (removed > 0) {
    parts.push(`${removed} removed`);
  }
  if (parts.length === 0) {
    return `⛓ Dependencies updated · ${state}`;
  }
  return `⛓ ${parts.join(" · ")} · ${state}`;
}

// Sequencing core for the writer: preparations first (an unused target id is
// acceptable, a link to an unprepared target is not), then the dependent's
// one-transaction commit. Both effects are injected so tests can stub them;
// the plugin method below wires the real editor and vault. Preparations are
// awaited before the commit: a failed preparation aborts with the dependent
// untouched, so a failed gesture can never leave a promoted target behind.
async function applyDependencyEditTransaction(plan, io = {}) {
  if (!plan || plan.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: (plan && plan.reason) || "plan-failed",
    });
  }
  const prepare =
    typeof io.prepareTargetFile === "function"
      ? io.prepareTargetFile
      : async () => ({ ok: true });
  for (const preparation of plan.preparations || []) {
    let result = null;
    try {
      result = await prepare(preparation.path, preparation);
    } catch (_error) {
      result = { ok: false, reason: "target-preparation-threw" };
    }
    if (!result || result.ok !== true) {
      return Object.freeze({
        ok: false,
        reason: (result && result.reason) || "target-preparation-failed",
      });
    }
  }
  const commit =
    typeof io.commitDependentContent === "function"
      ? io.commitDependentContent
      : () => ({ ok: false, reason: "no-commit" });
  let committed = null;
  try {
    committed = commit(plan.nextContent, plan);
  } catch (_error) {
    committed = { ok: false, reason: "commit-threw" };
  }
  if (!committed || committed.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: (committed && committed.reason) || "commit-failed",
    });
  }
  return Object.freeze({ ok: true, reason: null, notice: plan.notice });
}

// Build the notice for a local-task dependency write, distinguishing whether the
// `[dependsOn:: ...]` field was newly added vs already present and summarizing
// how the single managed navigation bullet changed.
function buildLocalTaskDependencyNotice(details = {}) {
  const id = normalizeBulletPropertyValue(details.id);
  const name = String(details.name || "");
  const dependencyText = details.dependencyAlreadyPresent
    ? `Already depends on ${id}`
    : `${name} → ${id}`;
  const navigationParts = [];

  switch (details.navigationResult) {
    case "added":
      navigationParts.push("added navigation link");
      break;
    case "updated":
      navigationParts.push("updated navigation bullet");
      break;
    case "already-present":
      navigationParts.push("navigation link already present");
      break;
    case "failed":
    case "guard-failed":
      return `${dependencyText} (could not add navigation link)`;
    default:
      break;
  }

  if (details.navigationConsolidated) {
    navigationParts.push("consolidated navigation bullet");
  }

  return navigationParts.length > 0
    ? `${dependencyText}; ${navigationParts.join("; ")}`
    : dependencyText;
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildMultiDependencyNotice(details = {}) {
  const added = Math.max(0, Math.floor(numericOrDefault(details.added, 0)));
  const removed = Math.max(0, Math.floor(numericOrDefault(details.removed, 0)));
  const navigationAdded = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationAdded, 0)),
  );
  const navigationRemoved = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationRemoved, 0)),
  );
  const navigationUpdated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationUpdated, 0)),
  );
  const navigationConsolidated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationConsolidated, 0)),
  );
  const skippedStale = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedStale, 0)),
  );
  const skippedOther = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedOther, 0)),
  );
  const parts = [];

  if (added > 0) {
    parts.push(
      `Linked ${formatCountLabel(added, "dependency", "dependencies")}`,
    );
  }
  if (removed > 0) {
    parts.push(
      `Unlinked ${formatCountLabel(removed, "dependency", "dependencies")}`,
    );
  }

  const navigationParts = [];
  if (navigationAdded > 0) {
    navigationParts.push(`added ${formatCountLabel(navigationAdded, "link")}`);
  }
  if (navigationRemoved > 0) {
    navigationParts.push(
      `removed ${formatCountLabel(navigationRemoved, "link")}`,
    );
  }
  if (navigationUpdated > 0) {
    navigationParts.push(
      `updated ${formatCountLabel(navigationUpdated, "bullet")}`,
    );
  }
  if (navigationConsolidated > 0) {
    navigationParts.push(
      `consolidated ${formatCountLabel(navigationConsolidated, "task")}`,
    );
  }
  if (navigationParts.length > 0) {
    parts.push(`Navigation ${navigationParts.join(", ")}`);
  }

  if (skippedStale > 0) {
    parts.push(
      `Skipped ${formatCountLabel(
        skippedStale,
        "changed task",
        "changed tasks",
      )}`,
    );
  }
  if (skippedOther > 0) {
    parts.push(
      `Skipped ${formatCountLabel(skippedOther, "task", "tasks")}`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : "No dependency changes";
}

function parseLocalTaskIdList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function rewriteDependsOnIdsInLine(line, replacements) {
  const mapping = replacements instanceof Map
    ? replacements
    : new Map(Object.entries(replacements || {}));
  if (mapping.size === 0) {
    return String(line || "");
  }
  return String(line || "").replace(
    /\[(\s*dependsOn\s*::)([^\]\n]*)\]/g,
    (field, prefix, value) => {
      let changed = false;
      const nextValue = value
        .split(",")
        .map((segment) => {
          const leading = /^\s*/.exec(segment)[0];
          const trailing = /\s*$/.exec(segment)[0];
          const token = segment.slice(leading.length, segment.length - trailing.length);
          const replacement = mapping.get(token);
          if (!replacement || replacement === token) {
            return segment;
          }
          changed = true;
          return `${leading}${replacement}${trailing}`;
        })
        .join(",");
      return changed ? `[${prefix}${nextValue}]` : field;
    },
  );
}

function rewriteDependsOnIdsInContent(content, replacements) {
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lineContexts = getMarkdownLineContexts(text);
  const sourceLines = text.split(/\r?\n/);
  const next = sourceLines
    .map((line, lineIndex) =>
      isObsidianTaskAtLine(text, lineIndex, lineContexts, sourceLines)
        ? rewriteDependsOnIdsInLine(line, replacements)
        : line,
    )
    .join(newline);
  return Object.freeze({ content: next, changed: next !== text });
}

