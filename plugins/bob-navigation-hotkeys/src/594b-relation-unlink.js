// Relation unlink writes (`docs/task-relations.md` Rule 7): remove one
// or every LINKS entry through applyRelationEdit, with the §19 unlink
// downgrade to `(💬 mentions)` when the source still mentions the target.
class BobNavigationHotkeysRelationUnlinkMixin {
  // §19 unlink downgrade (MN8/M7): a removed relation whose source still
  // mentions the target in its own text becomes a `(💬 mentions)` entry
  // instead of disappearing. Returns the mention label when the downgrade
  // applies, else null. Never throws; reconcile heals a missed downgrade.
  mentionDowngradeLabelForRemove(args = {}) {
    try {
      const linesEnabled = typeof args.linesEnabled === "boolean"
        ? args.linesEnabled
        : loadRelationsLinkedFromLinesEnabled();
      const mentionsEnabled = typeof args.mentionsEnabled === "boolean"
        ? args.mentionsEnabled
        : loadRelationsLinkedFromMentionsEnabled();
      if (!linesEnabled || !mentionsEnabled) {
        return null;
      }
      const api = relationMentionIndexApi(this.app);
      if (!api) return null;
      const sourcePath = normalizeVaultRelativePath(args.sourcePath || "");
      const targetPath = normalizeVaultRelativePath(args.targetPath || "");
      const targetBlockId = normalizeBulletPropertyValue(args.targetBlockId || "");
      const sourceContent = String(args.sourceContent || "");
      const targetContent = String(args.targetContent || "");
      if (!sourcePath || !targetPath || !targetBlockId || !sourceContent || !targetContent) {
        return null;
      }
      let pairs = null;
      try {
        pairs = api.scanMentions(sourceContent, sourcePath) || [];
      } catch (_scanError) {
        return null;
      }
      const mentioned = (Array.isArray(pairs) ? pairs : []).some((pair) => {
        const candidate = (pair && pair.target) || {};
        return normalizeVaultRelativePath(candidate.path || "") === targetPath &&
          normalizeBulletPropertyValue(candidate.blockId || "") === targetBlockId;
      });
      if (!mentioned) return null;
      const sourceLines = sourceContent.split(/\r?\n/);
      const sourceLine = Math.floor(numericOrDefault(args.sourceLine, Number.NaN));
      if (!Number.isFinite(sourceLine) || sourceLine < 0 || sourceLine >= sourceLines.length) {
        return null;
      }
      if (relationMentionSourceUncertain(sourceLines, sourceLine)) return null;
      const resolveLinkpath = args.resolveLinkpath || null;
      const targetIdentity = blocksIdentity(targetPath, targetBlockId);
      const sourceDeps = relationMentionDependencyIdentities(sourceContent, sourceLine, sourcePath, resolveLinkpath);
      if (sourceDeps.has(targetIdentity)) return null;
      const targetLines = targetContent.split(/\r?\n/);
      const targetLine = findTaskLineByTrailingBlockId(targetLines, targetBlockId);
      if (targetLine === null) return null;
      try {
        for (const index of relationMentionOwnerChildLines(targetLines, targetLine)) {
          if (parseDependencyLine(String(targetLines[index] || ""), { isDirectChildOfTask: true }).verdict === "malformed") {
            return null;
          }
        }
      } catch (_dependencyError) {
        return null;
      }
      const sourceBlockId = normalizeBulletPropertyValue(args.sourceBlockId || "");
      const sourceIdentity = sourceBlockId ? blocksIdentity(sourcePath, sourceBlockId) : null;
      const targetDeps = relationMentionDependencyIdentities(targetContent, targetLine, targetPath, resolveLinkpath);
      if (sourceIdentity && targetDeps.has(sourceIdentity)) return null;
      return TASK_MENTION_LABEL;
    } catch (_error) {
      return null;
    }
  }

  async removeAllRelationLinksByRef(sourceRef = {}, overrides = {}) {
    const flags = overrides && typeof overrides === "object" ? overrides : {};
    try {
      const path = normalizeVaultRelativePath(sourceRef.path || "");
      if (!path) return Object.freeze({ ok: false, reason: "invalid-ref" });
      const original = await this.readDependencyNoteContent(path, null, "");
      if (original === null) return Object.freeze({ ok: false, reason: "target-not-found" });
      const lines = original.split(/\r?\n/);
      let owner = Math.floor(numericOrDefault(sourceRef.line, Number.NaN));
      if (sourceRef.blockId) {
        const byId = findTaskLineByTrailingBlockId(lines, sourceRef.blockId);
        if (byId !== null) owner = byId;
      }
      if (!Number.isFinite(owner) || owner < 0 || owner >= lines.length || !isObsidianTaskAtLine(original, owner)) {
        return Object.freeze({ ok: false, reason: "not-task" });
      }
      const children = findLinksChildren(lines, owner);
      const entries = [];
      for (const child of children) {
        const parsed = parseLinksLine(String(lines[child] || ""), { isDirectChildOfTask: true });
        if (parsed.verdict === "malformed") {
          return Object.freeze({ ok: false, reason: "malformed-links-line", notice: "its LINKS line is malformed" });
        }
        if (parsed.verdict === "accept") entries.push(...(parsed.entries || []));
      }
      if (entries.length === 0) return Object.freeze({ ok: true, removed: 0, mirrorFailed: [] });
      const planned = planLinksEdit(original, owner, {
        remove: entries.map((entry) => relationLinkText(entry)),
      });
      if (!planned.ok) return Object.freeze({ ok: false, reason: planned.reason });
      let nextContent = planned.nextContent;
      const sourceBlockId = getTrailingBlockId(lines[owner]);
      const followUps = [];
      const mirrorFailed = new Set();
      const enabled = typeof flags.linkedFromLinesEnabled === "boolean"
        ? flags.linkedFromLinesEnabled
        : loadRelationsLinkedFromLinesEnabled();
      const vaultFiles = this.readDependencyVaultFileList() || [];
      const daily = scheduledRecoveryDailyPaths(vaultFiles.map((entry) => ({ path: typeof entry === "string" ? entry : entry.path })));
      const previousDailyPath = normalizeVaultRelativePath((daily && daily.previous) || "");
      const resolveLinkpath = this.dependencyLinkpathResolver();
      if (enabled && sourceBlockId) {
        const sourceIdentity = blocksIdentity(path, sourceBlockId);
        const targets = new Map();
        for (const entry of entries) {
          const targetPath = normalizeVaultRelativePath(dependencyPathForLinkNote(entry.note, path, resolveLinkpath) || "");
          const blockId = normalizeBulletPropertyValue(entry.blockId || "");
          if (targetPath && blockId) targets.set(`${targetPath}\x00${blockId}`, { path: targetPath, blockId });
        }
        for (const target of targets.values()) {
          if (!relationPathIsWritable(target.path, previousDailyPath)) continue;
          const targetContent = target.path === path
            ? nextContent
            : await this.readDependencyNoteContent(target.path, null, "");
          if (targetContent === null) {
            mirrorFailed.add(target.path);
            continue;
          }
          const targetLines = targetContent.split(/\r?\n/);
          const targetLine = findTaskLineByTrailingBlockId(targetLines, target.blockId);
          if (targetLine === null) continue;
          const mirrors = findLinkedFromChildren(targetLines, targetLine);
          const parsedMirrors = mirrors.map((index) => parseLinkedFromLine(targetLines[index], { isDirectChildOfTask: true }));
          if (parsedMirrors.some((entry) => entry.verdict === "malformed")) {
            mirrorFailed.add(target.path);
            continue;
          }
          const existing = mirrors.flatMap((index) => relationLinkedFromRows(target.path, targetLines[index], resolveLinkpath, vaultFiles));
          // §19 unlink downgrade (Links-to Ctrl+D): a removed relation whose
          // source still mentions the target becomes `(💬 mentions)`.
          // Same-note mirror inserts above can shift lines: re-resolve the
          // source owner by ^id before evaluating M7.
          let downgradeOwner = owner;
          try {
            const relocated = sourceBlockId
              ? findTaskLineByTrailingBlockId(nextContent.split(/\r?\n/), sourceBlockId)
              : null;
            if (relocated !== null) downgradeOwner = relocated;
          } catch (_relocateError) {
            // Fall through with the original owner line.
          }
          const downgradeLabel = this.mentionDowngradeLabelForRemove({
            sourcePath: path,
            sourceLine: downgradeOwner,
            sourceBlockId,
            sourceContent: nextContent,
            targetPath: target.path,
            targetBlockId: target.blockId,
            targetContent,
            resolveLinkpath,
            linesEnabled: flags.linkedFromLinesEnabled,
            mentionsEnabled: flags.linkedFromMentionsEnabled,
          });
          const downgradeAdd = downgradeLabel
            ? [{
                identity: sourceIdentity,
                link: canonicalDependencyLink({ path, blockId: sourceBlockId }, target.path, vaultFiles).text,
                label: downgradeLabel,
              }]
            : [];
          // NOTE: linkedFromDesiredAfterDelta drops an identity listed in
          // both add and remove, so a downgrade replaces instead of removing.
          const downgradeRemove = downgradeLabel ? [] : [sourceIdentity];
          const desired = linkedFromDesiredAfterDelta(existing, (entry) => ({ identity: entry.identity, link: entry.link }), downgradeAdd, downgradeRemove);
          const mirrorPlan = planLinkedFromLine(targetContent, targetLine, desired);
          if (!mirrorPlan.ok) {
            mirrorFailed.add(target.path);
            continue;
          }
          if (target.path === path) nextContent = mirrorPlan.nextContent;
          else if (mirrorPlan.nextContent !== targetContent) {
            followUps.push(Object.freeze({
              path: target.path,
              ownerBlockId: target.blockId,
              add: Object.freeze(downgradeAdd),
              remove: Object.freeze(downgradeRemove),
              preimage: targetContent,
              today: new Date(),
            }));
          }
        }
      }
      if (nextContent !== original) {
        const write = await this.writeRelationEditNote(path, original, nextContent);
        if (!write.ok) return Object.freeze({ ok: false, reason: "changed — reopen" });
      }
      if (followUps.length > 0) {
        const outcome = await this.applyRelationFollowUps(followUps);
        for (const failedPath of outcome.failed || []) mirrorFailed.add(failedPath);
      }
      return Object.freeze({
        ok: true,
        removed: entries.length,
        mirrorFailed: Object.freeze([...mirrorFailed]),
        notice: mirrorFailed.size > 0 ? "🪢 LINKED FROM not updated" : null,
      });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "remove-failed" });
    }
  }

  async removeRelationLinkByRef(sourceRef = {}, targetRef = {}) {
    try {
      const sourcePath = normalizeVaultRelativePath(sourceRef.path || "");
      const targetPath = normalizeVaultRelativePath(targetRef.path || "");
      const targetBlockId = normalizeBulletPropertyValue(targetRef.blockId || "");
      if (!sourcePath || !targetPath || !targetBlockId) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const sourceContent = await this.readDependencyNoteContent(
        sourcePath,
        null,
        "",
      );
      const targetContent = await this.readDependencyNoteContent(
        targetPath,
        null,
        "",
      );
      if (sourceContent === null || targetContent === null) {
        return Object.freeze({ ok: false, reason: "target-not-found" });
      }
      const sourceHit = Math.floor(numericOrDefault(sourceRef.line, Number.NaN));
      const sourceLines = sourceContent.split(/\r?\n/);
      let sourceLine = Number.isFinite(sourceHit) ? sourceHit : null;
      if (sourceRef.blockId) {
        const found = findTaskLineByTrailingBlockId(
          sourceLines,
          sourceRef.blockId,
        );
        if (found !== null) sourceLine = found;
      }
      if (!Number.isFinite(sourceLine) || sourceLine < 0) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const ownerLine = findOwningTaskLine(sourceLines, sourceLine);
      if (ownerLine === null) {
        return Object.freeze({ ok: false, reason: "no-owning-task" });
      }
      const expected = new Map([
        [sourcePath, sourceContent],
        [targetPath, targetContent],
      ]);
      const outcome = await this.applyRelationEdit({
        sources: [
          {
            path: sourcePath,
            line: ownerLine,
            blockId: getTrailingBlockId(sourceLines[ownerLine]),
          },
        ],
        add: [],
        remove: [{ path: targetPath, blockId: targetBlockId }],
        expected,
      });
      if (!outcome.ok) {
        if (outcome.notice) new Notice(outcome.notice);
        return Object.freeze({ ok: false, reason: outcome.reason });
      }
      if (outcome.notice) new Notice(outcome.notice);
      return Object.freeze({ ok: true, notice: outcome.notice });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "remove-failed" });
    }
  }
}
