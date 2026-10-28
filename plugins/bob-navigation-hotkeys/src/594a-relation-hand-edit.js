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
}
