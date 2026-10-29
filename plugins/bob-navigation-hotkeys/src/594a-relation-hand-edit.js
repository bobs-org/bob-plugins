// §19 relationIndex v2 accessor for nav's mention reads and writes.
// Null when ledger-tools is missing or older than v2 (MN18 skips then).
function relationMentionIndexApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-ledger-tools"];
    const api = holder && holder.api && holder.api.relationIndex;
    if (!api || Number(api.version) < 2 || typeof api.scanMentions !== "function") {
      return null;
    }
    return api;
  } catch (_error) {
    return null;
  }
}

function relationMentionPairKey(pair) {
  return `${String((pair && pair.sourceKey) || "")}\u0000${String((pair && pair.targetKey) || "")}`;
}

// Direct-child lines of one owner, for malformed edge-line detection.
function relationMentionOwnerChildLines(lines, owner) {
  const out = [];
  let block = null;
  try {
    block = findCurrentBulletChildBlock(lines, owner);
  } catch (_error) {
    block = null;
  }
  if (!block) return out;
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    try {
      if (findNearestParentListItem(lines, index) === owner) out.push(index);
    } catch (_error) {
      // One unreadable line never blocks the uncertainty check.
    }
  }
  return out;
}

function relationMentionNoteHasUnclosedFence(lines) {
  let opening = null;
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line || "");
    if (opening) {
      try {
        if (isClosingFence(text, opening)) opening = null;
      } catch (_error) {
        opening = null;
      }
      continue;
    }
    let next = null;
    try {
      next = getFenceOpening(text);
    } catch (_error) {
      next = null;
    }
    if (next) opening = next;
  }
  return opening !== null;
}

// M-uncertainty for one source owner in already-split lines: a malformed
// LINKS or Depends-On child, a duplicate ^id for the owner, or an unclosed
// fence in the note. Uncertain sources are kept byte-for-byte, never added.
function relationMentionSourceUncertain(lines, owner) {
  const at = Math.floor(Number(owner));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) return true;
  for (const index of relationMentionOwnerChildLines(lines, at)) {
    const text = String(lines[index] || "");
    try {
      if (parseLinksLine(text, { isDirectChildOfTask: true }).verdict === "malformed") return true;
    } catch (_error) {
      return true;
    }
    try {
      if (parseDependencyLine(text, { isDirectChildOfTask: true }).verdict === "malformed") return true;
    } catch (_error) {
      return true;
    }
  }
  const ownerId = normalizeBulletPropertyValue(getTrailingBlockId(String(lines[at] || "")) || "");
  if (ownerId) {
    let count = 0;
    for (const match of String(lines.join("\n")).matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)) {
      if (String(match[1] || "") === ownerId) {
        count += 1;
        if (count > 1) return true;
      }
    }
  }
  return relationMentionNoteHasUnclosedFence(lines);
}

// Accepted Depends-On target identities for one owner task.
function relationMentionDependencyIdentities(content, owner, ownerPath, resolveLinkpath) {
  const out = new Set();
  let collection = null;
  try {
    collection = collectDependencyNavigationBullets(content, owner);
  } catch (_error) {
    collection = null;
  }
  for (const target of (collection && collection.targets) || []) {
    let targetPath = null;
    try {
      targetPath = dependencyPathForLinkNote(target.note, ownerPath, resolveLinkpath);
    } catch (_error) {
      targetPath = null;
    }
    const identity = blocksIdentity(targetPath, target.blockId);
    if (identity) out.add(identity);
  }
  return out;
}

// Accepted LINKS target identities for one owner task, with labels, so the
// courtesy write can apply M7 precedence (a relation on the pair wins).
function relationMentionLinksIdentities(content, owner, ownerPath, resolveLinkpath) {
  const out = new Map();
  const lines = String(content || "").split(/\r?\n/);
  const at = Math.floor(Number(owner));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) return out;
  for (const child of findLinksChildren(lines, at)) {
    let parsed = null;
    try {
      parsed = parseLinksLine(String(lines[child] || ""), { isDirectChildOfTask: true });
    } catch (_error) {
      parsed = null;
    }
    if (!parsed || parsed.verdict !== "accept") continue;
    for (const entry of parsed.entries || []) {
      let targetPath = null;
      try {
        targetPath = dependencyPathForLinkNote(entry.note, ownerPath, resolveLinkpath);
      } catch (_error) {
        targetPath = null;
      }
      const identity = blocksIdentity(targetPath, entry.blockId);
      if (identity && !out.has(identity)) out.set(identity, entry.label || null);
    }
  }
  return out;
}

// Resolve one scanMentions source to its owner line in already-split lines:
// the trailing ^id first, then the recorded 1-based line as a fallback.
function relationMentionSourceOwnerLine(lines, source) {
  const blockId = normalizeBulletPropertyValue((source && source.blockId) || "");
  if (blockId) {
    try {
      const found = findTaskLineByTrailingBlockId(lines, blockId);
      if (found !== null) return found;
    } catch (_error) {
      // Fall through to the recorded line.
    }
  }
  const hint = Math.floor(numericOrDefault(source && source.line, Number.NaN));
  if (Number.isFinite(hint) && hint >= 1 && hint <= lines.length) return hint - 1;
  return null;
}

class BobNavigationHotkeysRelationHandEditMixin {
  async mirrorRelationHandEdit(editor, parentPath, oldContent, baselineLine, currentOwnerLine) {
    const path = normalizeVaultRelativePath(parentPath || "");
    if (!editor || typeof editor.getValue !== "function" || !path) {
      return Object.freeze({ mirrored: false, reason: "editor-unavailable" });
    }
    const before = String(oldContent || "");
    const after = String(editor.getValue() || "");
    if (!taskRelationLinesChanged(before, after).linksChanged) {
      return Object.freeze({ mirrored: false, reason: "no-links-change" });
    }
    const oldLines = before.split(/\r?\n/);
    const currentLines = after.split(/\r?\n/);
    const oldHint = Math.max(0, Math.min(Math.floor(numericOrDefault(baselineLine, 0)), oldLines.length - 1));
    const newHint = Math.max(0, Math.min(Math.floor(numericOrDefault(currentOwnerLine, oldHint)), currentLines.length - 1));
    const oldOwner = findOwningTaskLine(oldLines, oldHint);
    let owner = findOwningTaskLine(currentLines, newHint);
    if (oldOwner === null || owner === null) {
      return Object.freeze({ mirrored: false, reason: "owner-not-found" });
    }
    const oldId = getTrailingBlockId(oldLines[oldOwner]);
    if (oldId) {
      const relocated = findTaskLineByTrailingBlockId(currentLines, oldId);
      if (relocated !== null) owner = relocated;
    }
    const resolveLinkpath = this.dependencyLinkpathResolver();
    const vaultFiles = this.readDependencyVaultFileList() || [];
    const collect = (content, ownerLine) => {
      const lines = String(content || "").split(/\r?\n/);
      const children = findLinksChildren(lines, ownerLine);
      const entries = [];
      for (const child of children) {
        const parsed = parseLinksLine(String(lines[child] || ""), { isDirectChildOfTask: true });
        if (parsed.verdict === "malformed") return null;
        if (parsed.verdict === "accept") entries.push(...(parsed.entries || []));
      }
      const rows = new Map();
      for (const entry of entries) {
        const targetPath = normalizeVaultRelativePath(
          dependencyPathForLinkNote(entry.note, path, resolveLinkpath) || "",
        );
        const blockId = normalizeBulletPropertyValue(entry.blockId || "");
        if (!targetPath || !blockId) continue;
        const identity = blocksIdentity(targetPath, blockId);
        rows.set(identity, {
          path: targetPath,
          blockId,
          label: entry.label || null,
          link: relationLinkText(entry),
        });
      }
      return rows;
    };
    const oldEdges = collect(before, oldOwner);
    const newEdges = collect(after, owner);
    if (!oldEdges || !newEdges) {
      return Object.freeze({ mirrored: false, reason: "malformed-links-line" });
    }
    const changes = [];
    for (const [identity, oldEdge] of oldEdges) {
      if (!newEdges.has(identity)) changes.push({ kind: "remove", ...oldEdge });
      else if ((newEdges.get(identity).label || null) !== (oldEdge.label || null)) {
        changes.push({ kind: "relabel", ...newEdges.get(identity) });
      }
    }
    for (const [identity, edge] of newEdges) {
      if (!oldEdges.has(identity)) changes.push({ kind: "add", ...edge });
    }
    if (changes.length === 0) return Object.freeze({ mirrored: false, reason: "unchanged" });

    const mirrorEnabled = loadRelationsLinkedFromLinesEnabled();
    let currentContent = after;
    let liveLines = currentContent.split(/\r?\n/);
    let sourceBlockId = getTrailingBlockId(liveLines[owner]);
    if (mirrorEnabled && newEdges.size > 0 && !sourceBlockId) {
      const used = new Set();
      for (const match of currentContent.matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)) used.add(match[1]);
      sourceBlockId = mintDependentBlockId(liveLines[owner], used);
      liveLines[owner] = appendBlockIdToLine(liveLines[owner], sourceBlockId);
      currentContent = liveLines.join(relationLineEnding(currentContent));
    }
    const sourceIdentity = sourceBlockId ? blocksIdentity(path, sourceBlockId) : null;
    const daily = scheduledRecoveryDailyPaths(vaultFiles.map((entry) => ({ path: typeof entry === "string" ? entry : entry.path })));
    const previousDailyPath = normalizeVaultRelativePath((daily && daily.previous) || "");
    const followUps = [];
    const failed = new Set();
    if (mirrorEnabled && sourceIdentity) {
      for (const change of changes) {
        if (!relationPathIsWritable(change.path, previousDailyPath)) continue;
        let targetContent = change.path === path
          ? currentContent
          : await this.readDependencyNoteContent(change.path, null, "");
        if (targetContent === null) {
          failed.add(change.path);
          continue;
        }
        const targetLines = targetContent.split(/\r?\n/);
        const targetLine = findTaskLineByTrailingBlockId(targetLines, change.blockId);
        if (targetLine === null) {
          failed.add(change.path);
          continue;
        }
        const children = findLinkedFromChildren(targetLines, targetLine);
        const parsed = children.map((index) => parseLinkedFromLine(targetLines[index], { isDirectChildOfTask: true }));
        if (parsed.some((entry) => entry.verdict === "malformed")) {
          failed.add(change.path);
          continue;
        }
        const existing = children.flatMap((index) => relationLinkedFromRows(change.path, targetLines[index], resolveLinkpath, vaultFiles));
        const canonical = canonicalDependencyLink({ path, blockId: sourceBlockId }, change.path, vaultFiles).text;
        const add = change.kind === "remove" ? [] : [{ identity: sourceIdentity, link: canonical, label: change.label || null }];
        const remove = change.kind === "remove" ? [sourceIdentity] : [];
        const desired = linkedFromDesiredAfterDelta(existing, (entry) => ({ identity: entry.identity, link: entry.link }), add, remove);
        const planned = planLinkedFromLine(targetContent, targetLine, desired);
        if (!planned.ok) {
          failed.add(change.path);
          continue;
        }
        if (change.path === path) {
          currentContent = planned.nextContent;
        } else if (planned.nextContent !== targetContent) {
          followUps.push(Object.freeze({
            path: change.path,
            ownerBlockId: change.blockId,
            add: Object.freeze(add),
            remove: Object.freeze(remove),
            preimage: targetContent,
            today: new Date(),
          }));
        }
      }
    }
    if (currentContent !== after) {
      const written = await this.writeRelationEditNote(path, after, currentContent);
      if (!written.ok) return Object.freeze({ mirrored: false, reason: "changed" });
    }
    if (followUps.length > 0) {
      const result = await this.applyRelationFollowUps(followUps);
      for (const failedPath of result.failed || []) failed.add(failedPath);
    }
    showRelationCancelHandEditNotice(changes, currentLines[owner], failed);
    return Object.freeze({ mirrored: true, failed: Object.freeze([...failed]) });
  }

  // §19 courtesy write (MN18). Runs after the dependency and LINKS mirrors:
  // diff the note's mention pairs between the burst baseline and the current
  // text, then converge each changed target's LINKED FROM (M7, minting,
  // uncertainty, switches). Same-note targets join one annotated
  // transaction; cross-note targets go through applyRelationFollowUps.
  // Silent on success and failure; reconcile heals what this misses.
  async mirrorMentionHandEdit(editor, parentPath, beforeContent, options = {}) {
    const path = normalizeVaultRelativePath(parentPath || "");
    if (!editor || typeof editor.getValue !== "function" || !path) {
      return Object.freeze({ mirrored: false, reason: "editor-unavailable" });
    }
    const api = relationMentionIndexApi(this.app);
    if (!api) {
      return Object.freeze({ mirrored: false, reason: "no-index-api" });
    }
    const flags = options && typeof options === "object" ? options : {};
    const linesEnabled = typeof flags.linesEnabled === "boolean"
      ? flags.linesEnabled
      : loadRelationsLinkedFromLinesEnabled();
    const mentionsEnabled = typeof flags.mentionsEnabled === "boolean"
      ? flags.mentionsEnabled
      : loadRelationsLinkedFromMentionsEnabled();
    if (!linesEnabled || !mentionsEnabled) {
      return Object.freeze({ mirrored: false, reason: "switch-off" });
    }
    const before = String(beforeContent || "");
    const after = String(editor.getValue() || "");
    if (before === after) {
      return Object.freeze({ mirrored: false, reason: "unchanged" });
    }
    let beforePairs = null;
    let afterPairs = null;
    try {
      beforePairs = api.scanMentions(before, path) || [];
      afterPairs = api.scanMentions(after, path) || [];
    } catch (_error) {
      return Object.freeze({ mirrored: false, reason: "scan-failed" });
    }
    if (!Array.isArray(beforePairs) || !Array.isArray(afterPairs)) {
      return Object.freeze({ mirrored: false, reason: "scan-failed" });
    }
    const resolveLinkpath = this.dependencyLinkpathResolver();
    const vaultFiles = this.readDependencyVaultFileList() || [];
    const dailyPaths = scheduledRecoveryDailyPaths(vaultFiles.map((entry) => ({ path: typeof entry === "string" ? entry : entry.path })));
    const previousDailyPath = normalizeVaultRelativePath((dailyPaths && dailyPaths.previous) || "");
    const beforeKeys = new Set(beforePairs.map(relationMentionPairKey));
    const afterKeys = new Set(afterPairs.map(relationMentionPairKey));
    const addedPairs = afterPairs.filter((pair) => !beforeKeys.has(relationMentionPairKey(pair)));
    const removedPairs = beforePairs.filter((pair) => !afterKeys.has(relationMentionPairKey(pair)));
    // Sources whose LINKS or Depends-On inputs changed flip M7 without
    // changing the pair set (hand-edited LINKS removal, new dependency):
    // re-converge their after-pair targets too.
    const touchedSources = new Set();
    try {
      const beforeLines = before.split(/\r?\n/);
      const afterLines = after.split(/\r?\n/);
      const sources = new Map();
      for (const pair of [...beforePairs, ...afterPairs]) {
        const key = String((pair && pair.sourceKey) || "");
        if (key && !sources.has(key)) sources.set(key, (pair && pair.source) || null);
      }
      for (const source of sources.values()) {
        const beforeOwner = relationMentionSourceOwnerLine(beforeLines, source);
        const afterOwner = relationMentionSourceOwnerLine(afterLines, source);
        if (beforeOwner === null || afterOwner === null) continue;
        const linksBefore = relationMentionLinksIdentities(before, beforeOwner, path, resolveLinkpath);
        const linksAfter = relationMentionLinksIdentities(after, afterOwner, path, resolveLinkpath);
        const depsBefore = relationMentionDependencyIdentities(before, beforeOwner, path, resolveLinkpath);
        const depsAfter = relationMentionDependencyIdentities(after, afterOwner, path, resolveLinkpath);
        const sameLinks = linksBefore.size === linksAfter.size &&
          [...linksBefore].every(([identity, label]) => linksAfter.has(identity) && linksAfter.get(identity) === label);
        const sameDeps = depsBefore.size === depsAfter.size &&
          [...depsBefore].every((identity) => depsAfter.has(identity));
        if (!sameLinks || !sameDeps) {
          touchedSources.add(String((source && source.blockId) || "") || `line:${Number((source && source.line) || 0)}`);
        }
      }
    } catch (_error) {
      // Input comparison stays best-effort; the pair diff below still runs.
    }
    const changedTargets = new Map();
    const rememberTarget = (pair) => {
      const target = (pair && pair.target) || {};
      const targetPath = normalizeVaultRelativePath(target.path || "");
      const targetBlockId = normalizeBulletPropertyValue(target.blockId || "");
      if (!targetPath || !targetBlockId) return;
      const key = `${targetPath}\u0000${targetBlockId}`;
      if (!changedTargets.has(key)) {
        changedTargets.set(key, {
          path: targetPath,
          blockId: targetBlockId,
          added: [],
          removed: [],
        });
      }
    };
    for (const pair of addedPairs) {
      rememberTarget(pair);
      const key = `${normalizeVaultRelativePath((pair.target && pair.target.path) || "")}\u0000${normalizeBulletPropertyValue((pair.target && pair.target.blockId) || "")}`;
      if (changedTargets.has(key)) changedTargets.get(key).added.push(pair);
    }
    for (const pair of removedPairs) {
      rememberTarget(pair);
      const key = `${normalizeVaultRelativePath((pair.target && pair.target.path) || "")}\u0000${normalizeBulletPropertyValue((pair.target && pair.target.blockId) || "")}`;
      if (changedTargets.has(key)) changedTargets.get(key).removed.push(pair);
    }
    for (const pair of afterPairs) {
      const source = (pair && pair.source) || {};
      const fingerprint = String(source.blockId || "") || `line:${Number(source.line || 0)}`;
      if (!touchedSources.has(fingerprint)) continue;
      rememberTarget(pair);
      const key = `${normalizeVaultRelativePath((pair.target && pair.target.path) || "")}\u0000${normalizeBulletPropertyValue((pair.target && pair.target.blockId) || "")}`;
      if (!changedTargets.has(key)) continue;
      const bucket = changedTargets.get(key);
      if (!bucket.added.some((entry) => relationMentionPairKey(entry) === relationMentionPairKey(pair)) &&
        !bucket.removed.some((entry) => relationMentionPairKey(entry) === relationMentionPairKey(pair))) {
        bucket.added.push(pair);
      }
    }
    if (changedTargets.size === 0) {
      return Object.freeze({ mirrored: false, reason: "unchanged" });
    }
    // Phase A (read-only plan on pristine lines): decide every pair action
    // before any write, so same-note line shifts can never misresolve a
    // later id-less source. Actions reference sources by fingerprint and
    // materialize identities in phase B, after minting.
    const pristineLines = after.split(/\r?\n/);
    const sourceWritable = relationPathIsWritable(path, previousDailyPath);
    const targetPlans = [];
    for (const target of changedTargets.values()) {
      if (!relationPathIsWritable(target.path, previousDailyPath)) continue;
      const targetContent = target.path === path
        ? after
        : await this.readDependencyNoteContent(target.path, null, "");
      if (targetContent === null) {
        targetPlans.push({ target, failed: true });
        continue;
      }
      const targetLines = targetContent.split(/\r?\n/);
      const targetLine = findTaskLineByTrailingBlockId(targetLines, target.blockId);
      if (targetLine === null) {
        targetPlans.push({ target, failed: true });
        continue;
      }
      const targetChildren = findLinkedFromChildren(targetLines, targetLine);
      const targetParsed = targetChildren.map((index) => parseLinkedFromLine(targetLines[index], { isDirectChildOfTask: true }));
      if (targetParsed.some((entry) => entry.verdict === "malformed")) {
        targetPlans.push({ target, failed: true });
        continue;
      }
      // T's Depends-On must parse for the pair: a malformed line there
      // keeps every existing entry naming S (M-uncertainty).
      let targetUncertain = false;
      try {
        for (const index of relationMentionOwnerChildLines(targetLines, targetLine)) {
          if (parseDependencyLine(String(targetLines[index] || ""), { isDirectChildOfTask: true }).verdict === "malformed") {
            targetUncertain = true;
            break;
          }
        }
      } catch (_error) {
        targetUncertain = true;
      }
      const targetDeps = targetUncertain
        ? new Set()
        : relationMentionDependencyIdentities(targetContent, targetLine, target.path, resolveLinkpath);
      const targetIdentity = blocksIdentity(target.path, target.blockId);
      const actions = [];
      for (const pair of [...target.added, ...target.removed]) {
        const source = (pair && pair.source) || {};
        const owner = relationMentionSourceOwnerLine(pristineLines, source);
        if (owner === null) continue;
        const fingerprint = String(source.blockId || "") || `line:${Number(source.line || 0)}`;
        const sourceUncertain = relationMentionSourceUncertain(pristineLines, owner);
        const ownerBlockId = normalizeBulletPropertyValue(getTrailingBlockId(String(pristineLines[owner] || "")) || "");
        const sourceLinks = relationMentionLinksIdentities(after, owner, path, resolveLinkpath);
        const sourceDeps = relationMentionDependencyIdentities(after, owner, path, resolveLinkpath);
        const sourceIdentity = ownerBlockId ? blocksIdentity(path, ownerBlockId) : null;
        const relationLabel = sourceLinks.get(targetIdentity);
        const dependencyJoin = (sourceIdentity && targetDeps.has(sourceIdentity)) || sourceDeps.has(targetIdentity);
        if (sourceUncertain || targetUncertain) continue;
        if (relationLabel !== undefined) {
          // M7: a relation on the pair wins; a stale mention spelling for
          // the same identity becomes the relation entry.
          actions.push({ kind: "relation", fingerprint, owner, sourceBlockId: ownerBlockId, label: relationLabel });
          continue;
        }
        if (dependencyJoin) {
          // M7: a dependency on the pair suppresses the mention entry, but
          // never a relation entry.
          actions.push({ kind: "suppress", fingerprint, owner, sourceBlockId: ownerBlockId });
          continue;
        }
        const stillMentioned = afterKeys.has(relationMentionPairKey(pair));
        if (!stillMentioned) {
          actions.push({ kind: "remove", fingerprint, owner, sourceBlockId: ownerBlockId });
          continue;
        }
        actions.push({ kind: "mention", fingerprint, owner, sourceBlockId: ownerBlockId });
      }
      targetPlans.push({
        target,
        failed: false,
        preimage: targetContent,
        actions,
      });
    }
    // Phase B (apply): mint every id-less source whose entry will be stored
    // first (mints never shift lines), then converge each target. T owners
    // resolve by ^id at apply time; mention identities use the minted ids.
    let currentContent = after;
    let currentLines = currentContent.split(/\r?\n/);
    const followUps = [];
    const failed = new Set();
    for (const plan of targetPlans) {
      if (plan.failed) {
        failed.add(plan.target.path);
        continue;
      }
    }
    const mintedByOwner = new Map();
    if (sourceWritable) {
      const used = new Set();
      for (const match of currentContent.matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)) used.add(match[1]);
      const mintOwners = new Set();
      for (const plan of targetPlans) {
        if (plan.failed) continue;
        for (const action of plan.actions) {
          if (action.kind === "mention" && !action.sourceBlockId) mintOwners.add(action.owner);
        }
      }
      for (const owner of mintOwners) {
        if (owner === null || owner < 0 || owner >= currentLines.length) continue;
        if (normalizeBulletPropertyValue(getTrailingBlockId(String(currentLines[owner] || "")) || "")) continue;
        const minted = mintDependentBlockId(currentLines[owner], used);
        if (!minted) continue;
        currentLines[owner] = appendBlockIdToLine(currentLines[owner], minted);
        used.add(minted);
        mintedByOwner.set(owner, minted);
      }
      if (mintedByOwner.size > 0) {
        currentContent = currentLines.join(relationLineEnding(currentContent));
      }
    }
    const sourceIdentityFor = (action) => {
      if (action.sourceBlockId) return blocksIdentity(path, action.sourceBlockId);
      const minted = mintedByOwner.get(action.owner);
      return minted ? blocksIdentity(path, minted) : null;
    };
    for (const plan of targetPlans) {
      if (plan.failed) continue;
      const { target } = plan;
      const targetContent = target.path === path
        ? currentContent
        : plan.preimage;
      const targetLines = targetContent.split(/\r?\n/);
      const targetLine = findTaskLineByTrailingBlockId(targetLines, target.blockId);
      if (targetLine === null) {
        failed.add(target.path);
        continue;
      }
      const targetChildren = findLinkedFromChildren(targetLines, targetLine);
      const existing = targetChildren.flatMap((index) => relationLinkedFromRows(target.path, targetLines[index], resolveLinkpath, vaultFiles));
      const addRows = [];
      const removeIds = [];
      for (const action of plan.actions) {
        const sourceIdentity = sourceIdentityFor(action);
        const existingEntry = sourceIdentity
          ? existing.find((entry) => entry.identity === sourceIdentity)
          : null;
        if (action.kind === "relation") {
          if (sourceIdentity && (!existingEntry || relationLabelIsMentionLabel(existingEntry.label))) {
            const blockId = action.sourceBlockId || mintedByOwner.get(action.owner);
            if (!blockId) continue;
            addRows.push({
              identity: sourceIdentity,
              link: canonicalDependencyLink({ path, blockId }, target.path, vaultFiles).text,
              label: action.label,
            });
          }
          continue;
        }
        if (action.kind === "suppress" || action.kind === "remove") {
          if (existingEntry && relationLabelIsMentionLabel(existingEntry.label)) {
            removeIds.push(sourceIdentity);
          }
          continue;
        }
        if (action.kind !== "mention") continue;
        if (existingEntry) continue;
        const blockId = action.sourceBlockId || mintedByOwner.get(action.owner);
        if (!blockId || !sourceIdentity) continue;
        addRows.push({
          identity: sourceIdentity,
          link: canonicalDependencyLink({ path, blockId }, target.path, vaultFiles).text,
          label: TASK_MENTION_LABEL,
        });
      }
      if (addRows.length === 0 && removeIds.length === 0) continue;
      const desired = linkedFromDesiredAfterDelta(existing, (entry) => ({ identity: entry.identity, link: entry.link }), addRows, removeIds);
      const planned = planLinkedFromLine(targetContent, targetLine, desired);
      if (!planned.ok) {
        failed.add(target.path);
        continue;
      }
      if (target.path === path) {
        currentContent = planned.nextContent;
        currentLines = currentContent.split(/\r?\n/);
      } else if (planned.nextContent !== targetContent) {
        followUps.push(Object.freeze({
          path: target.path,
          ownerBlockId: target.blockId,
          add: Object.freeze(addRows),
          remove: Object.freeze(removeIds),
          preimage: plan.preimage,
          today: new Date(),
        }));
      }
    }
    if (currentContent !== after) {
      const written = await this.writeRelationEditNote(path, after, currentContent);
      if (!written.ok) return Object.freeze({ mirrored: false, reason: "changed" });
    }
    if (followUps.length > 0) {
      const result = await this.applyRelationFollowUps(followUps);
      for (const failedPath of result.failed || []) failed.add(failedPath);
    }
    if (currentContent === after && followUps.length === 0) {
      return Object.freeze({ mirrored: false, reason: "unchanged" });
    }
    return Object.freeze({ mirrored: true, failed: Object.freeze([...failed]) });
  }
}
