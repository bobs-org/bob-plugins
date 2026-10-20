// Relation orchestrator (`docs/task-relations.md` Rule 7): write each source
// LINKS line, mint the source id inside that transaction when a mirror will
// be stored, then send best-effort LINKED FROM follow-ups. Same-note S and T
// share one undo group. The writer never stamps, routes inbox tasks, or
// touches Pomodoros (LG13).
class BobNavigationHotkeysRelationEditMixin {
  findRelationEditOpenEditor(filePath) {
    const path = normalizeVaultRelativePath(filePath || "");
    const workspace = this.app && this.app.workspace;
    if (!path || !workspace || typeof workspace.getLeavesOfType !== "function") {
      return null;
    }
    for (const leaf of workspace.getLeavesOfType("markdown") || []) {
      const view = leaf && leaf.view;
      if (
        view &&
        view.file &&
        normalizeVaultRelativePath(view.file.path) === path &&
        view.editor &&
        typeof view.editor.getValue === "function"
      ) {
        return view.editor;
      }
    }
    return null;
  }

  async writeRelationEditNote(filePath, preimage, nextContent) {
    const path = normalizeVaultRelativePath(filePath || "");
    const before = String(preimage || "");
    const after = String(nextContent || "");
    if (!path) {
      return Object.freeze({ ok: false, reason: "invalid-path" });
    }
    if (after === before) {
      return Object.freeze({ ok: true, reason: "unchanged", via: "none" });
    }
    const editor = this.findRelationEditOpenEditor(path);
    if (editor) {
      if (String(editor.getValue() || "") !== before) {
        return Object.freeze({ ok: false, reason: "changed" });
      }
      const committed = applyEditorContentTransaction(
        editor,
        before,
        after,
        null,
        RELATIONS_MACHINE_WRITE_ANNOTATION,
      );
      return committed
        ? Object.freeze({ ok: true, reason: null, via: "editor" })
        : Object.freeze({ ok: false, reason: "commit-failed" });
    }
    const vault = this.app && this.app.vault;
    const file =
      vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
    if (!file || !vault || typeof vault.process !== "function") {
      return Object.freeze({ ok: false, reason: "target-unavailable" });
    }
    let applied = false;
    try {
      await vault.process(file, (data) => {
        if (String(data || "") !== before) return data;
        applied = true;
        return after;
      });
    } catch (_error) {
      applied = false;
    }
    return applied
      ? Object.freeze({ ok: true, reason: null, via: "vault" })
      : Object.freeze({ ok: false, reason: "changed" });
  }

  locateRelationEditRef(ref, content) {
    if (!ref || typeof content !== "string") return null;
    const relocated = relocateBlocksEditRef(ref, content);
    if (!relocated) return null;
    const lines = content.split(/\r?\n/);
    let line = Math.floor(numericOrDefault(relocated.line, Number.NaN));
    const blockId = normalizeBulletPropertyValue(relocated.blockId || "");
    if (!Number.isFinite(line) || line < 0 || line >= lines.length) {
      if (!blockId) return null;
      const found = findTaskLineByTrailingBlockId(lines, blockId);
      if (found === null) return null;
      line = found;
    } else if (!isObsidianTaskAtLine(content, line)) {
      const owning = findOwningTaskLine(lines, line);
      if (owning === null) return null;
      line = owning;
    }
    if (!isObsidianTaskAtLine(content, line)) return null;
    return Object.freeze({
      path: normalizeVaultRelativePath(relocated.path || ref.path),
      line,
      blockId: getTrailingBlockId(lines[line]) || blockId,
      label: relocated.label,
      description: relationNoticeNameFromLine(lines[line]),
      rawLine: String(lines[line] || ""),
    });
  }

  async applyRelationEdit(args = {}) {
    const stale = "changed — reopen";
    const refuse = (reason, notice = null) =>
      Object.freeze({
        ok: false,
        reason,
        notice,
        committed: Object.freeze([]),
        failed: Object.freeze([]),
        mirrorFailed: Object.freeze([]),
      });
    try {
      const today = args.today || new Date();
      const sources = Array.isArray(args.sources) ? args.sources : [];
      const add = Array.isArray(args.add) ? args.add : [];
      const remove = Array.isArray(args.remove) ? args.remove : [];
      const relabel = Array.isArray(args.relabel)
        ? args.relabel
        : args.relabel && typeof args.relabel === "object"
          ? Object.entries(args.relabel).map(([key, label]) => ({
              target: key,
              label,
            }))
          : [];
      const direction = args.direction === "from" ? "from" : "to";
      const resolveLinkpath = this.dependencyLinkpathResolver();
      const linkedFromLinesEnabled =
        args.linkedFromLinesEnabled !== undefined
          ? args.linkedFromLinesEnabled === true
          : loadRelationsLinkedFromLinesEnabled();

      const files = new Map();
      const collectRef = (ref) => {
        const path = normalizeVaultRelativePath(
          ref && (ref.path || (typeof ref.target === "object" && ref.target.path)),
        );
        return path;
      };
      for (const ref of [...sources, ...add, ...remove, ...relabel]) {
        const path = collectRef(ref && ref.target ? ref.target : ref);
        if (!path || files.has(path)) continue;
        const loaded = await this.readDependencyNoteContent(path, null, "");
        if (loaded === null) return refuse("target-not-found");
        files.set(path, loaded);
      }
      const vaultFiles = this.readDependencyVaultFileList() || [...files.keys()];
      const dailyPaths = scheduledRecoveryDailyPaths(
        vaultFiles.map((path) => ({ path })),
        today,
      );
      const previousDailyPath = dailyPaths && dailyPaths.previous;
      const expected =
        args.expected instanceof Map
          ? args.expected
          : args.expected && typeof args.expected === "object"
            ? new Map(Object.entries(args.expected))
            : new Map();
      for (const [filePath, expectedContent] of expected) {
        const live = files.get(normalizeVaultRelativePath(filePath));
        if (live !== undefined && live !== String(expectedContent || "")) {
          return refuse(stale, stale);
        }
      }

      const locateList = (refs) => {
        const located = [];
        for (const ref of refs) {
          const raw = ref && ref.target ? { ...ref.target, label: ref.label } : ref;
          const path = normalizeVaultRelativePath(raw && raw.path);
          const row = this.locateRelationEditRef(raw, files.get(path));
          if (!row) return null;
          located.push(
            Object.freeze({
              ...row,
              label: raw && raw.label !== undefined ? raw.label : row.label,
            }),
          );
        }
        return located;
      };
      const liveSources = locateList(sources);
      const liveAdd = locateList(add);
      const liveRemove = locateList(remove);
      const liveRelabel = locateList(relabel);
      if (!liveSources || !liveAdd || !liveRemove || !liveRelabel) {
        return refuse(stale, stale);
      }
      if (liveSources.length === 0) {
        return refuse("invalid-ref");
      }
      for (const target of [...liveAdd, ...liveRelabel]) {
        if (!target.blockId) return refuse("target-needs-id");
      }
      for (const source of liveSources) {
        for (const target of [...liveAdd, ...liveRemove, ...liveRelabel]) {
          if (
            source.path === target.path &&
            source.blockId &&
            target.blockId &&
            source.blockId === target.blockId
          ) {
            return refuse("self-relation");
          }
        }
      }

      const sourceWrites = new Map();
      const followUps = [];
      const committed = [];
      const noticeAdded = [];
      const noticeRemoved = [];
      const noticeRelabeled = [];
      const mirrorFailed = [];
      let archived = false;
      const contentOf = (path) =>
        sourceWrites.has(path)
          ? sourceWrites.get(path).nextContent
          : String(files.get(path) || "");
      const stageWrite = (path, original, nextContent) => {
        const current = sourceWrites.get(path);
        sourceWrites.set(path, {
          path,
          original: current ? current.original : original,
          nextContent,
        });
      };

      for (const source of liveSources) {
        let content = contentOf(source.path);
        const original = sourceWrites.has(source.path)
          ? sourceWrites.get(source.path).original
          : String(files.get(source.path) || "");
        let sourceLine = source.line;
        const liveLines = content.split(/\r?\n/);
        if (source.blockId) {
          const found = findTaskLineByTrailingBlockId(liveLines, source.blockId);
          if (found !== null) sourceLine = found;
        }
        const children = findLinksChildren(liveLines, sourceLine);
        const existingRows = children.flatMap((index) =>
          relationLinksRows(
            source.path,
            liveLines[index],
            resolveLinkpath,
            vaultFiles,
          ),
        );
        const addEdit = liveAdd.map((target) => ({
          link: storedRelationLinkForTarget(
            existingRows,
            target,
            source.path,
            vaultFiles,
          ),
          label: target.label,
        }));
        const removeEdit = liveRemove.map((target) =>
          storedRelationLinkForTarget(
            existingRows,
            target,
            source.path,
            vaultFiles,
          ),
        );
        const relabelEdit = liveRelabel.map((target) => ({
          link: storedRelationLinkForTarget(
            existingRows,
            target,
            source.path,
            vaultFiles,
          ),
          label: target.label,
        }));
        const planned = planLinksEdit(content, sourceLine, {
          add: addEdit,
          remove: removeEdit,
          relabel: relabelEdit,
        });
        if (!planned.ok) {
          return refuse(
            planned.reason,
            planned.notice ||
              (planned.reason === "malformed-links-line"
                ? "its LINKS line is malformed"
                : null),
          );
        }
        content = planned.nextContent;
        if (planned.report) {
          for (const target of liveAdd) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            if (planned.report.added.includes(link)) noticeAdded.push(target);
            if (planned.report.relabeled.includes(link)) {
              noticeRelabeled.push(target);
            }
          }
          for (const target of liveRelabel) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            if (
              planned.report.relabeled.includes(link) &&
              !noticeRelabeled.includes(target)
            ) {
              noticeRelabeled.push(target);
            }
          }
          for (const target of liveRemove) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            if (planned.report.removed.includes(link)) noticeRemoved.push(target);
          }
        }

        const mirrorTargets = [...liveAdd, ...liveRemove, ...liveRelabel].filter(
          (target, index, list) =>
            list.findIndex(
              (entry) =>
                entry.path === target.path && entry.blockId === target.blockId,
            ) === index,
        );
        const writableMirrors = [];
        for (const target of mirrorTargets) {
          if (!relationPathIsWritable(target.path, previousDailyPath)) {
            archived = true;
            continue;
          }
          writableMirrors.push(target);
        }

        let sourceBlockId = getTrailingBlockId(content.split(/\r?\n/)[sourceLine]);
        const needsMirror =
          linkedFromLinesEnabled &&
          writableMirrors.length > 0 &&
          (planned.report.added.length > 0 ||
            planned.report.relabeled.length > 0 ||
            planned.report.removed.length > 0);
        if (needsMirror && !sourceBlockId) {
          const used = new Set();
          for (const match of String(content).matchAll(
            /\^([A-Za-z0-9-]+)(?=\s|$)/g,
          )) {
            used.add(match[1]);
          }
          sourceBlockId = mintDependentBlockId(
            content.split(/\r?\n/)[sourceLine],
            used,
          );
          const mintedLines = content.split(/\r?\n/);
          mintedLines[sourceLine] = appendBlockIdToLine(
            mintedLines[sourceLine],
            sourceBlockId,
          );
          content = mintedLines.join(relationLineEnding(content));
        }
        stageWrite(source.path, original, content);
        if (!needsMirror || !sourceBlockId) continue;

        const sourceIdentity = blocksIdentity(source.path, sourceBlockId);
        for (const target of writableMirrors) {
          const targetContent = contentOf(target.path);
          const targetLines = targetContent.split(/\r?\n/);
          let targetLine = target.line;
          if (target.blockId) {
            const found = findTaskLineByTrailingBlockId(
              targetLines,
              target.blockId,
            );
            if (found !== null) targetLine = found;
          }
          const mirrorChildren = findLinkedFromChildren(targetLines, targetLine);
          const parsedMirror = mirrorChildren.map((index) =>
            parseLinkedFromLine(targetLines[index], {
              isDirectChildOfTask: true,
            }),
          );
          if (parsedMirror.some((entry) => entry.verdict === "malformed")) {
            mirrorFailed.push(target.path);
            continue;
          }
          const existingMirror = mirrorChildren.flatMap((index) =>
            relationLinkedFromRows(
              target.path,
              targetLines[index],
              resolveLinkpath,
              vaultFiles,
            ),
          );
          const isRemove = liveRemove.some(
            (entry) =>
              entry.path === target.path && entry.blockId === target.blockId,
          );
          const addLabel = (
            liveAdd.find(
              (entry) =>
                entry.path === target.path && entry.blockId === target.blockId,
            ) ||
            liveRelabel.find(
              (entry) =>
                entry.path === target.path && entry.blockId === target.blockId,
            )
          );
          const canonical = canonicalDependencyLink(
            { path: source.path, blockId: sourceBlockId },
            target.path,
            vaultFiles,
          ).text;
          const addRows = isRemove
            ? []
            : [
                {
                  identity: sourceIdentity,
                  link: canonical,
                  label: addLabel ? addLabel.label || null : null,
                },
              ];
          const removeIds = isRemove ? [sourceIdentity] : [];
          if (target.path === source.path) {
            const desired = linkedFromDesiredAfterDelta(
              existingMirror,
              (entry) => ({ identity: entry.identity, link: entry.link }),
              addRows,
              removeIds,
            );
            const mirrorPlan = planLinkedFromLine(
              contentOf(source.path),
              targetLine,
              desired,
            );
            if (!mirrorPlan.ok) {
              mirrorFailed.push(target.path);
              continue;
            }
            stageWrite(
              source.path,
              sourceWrites.get(source.path).original,
              mirrorPlan.nextContent,
            );
          } else {
            followUps.push(
              Object.freeze({
                path: target.path,
                ownerBlockId: target.blockId,
                add: Object.freeze(addRows),
                remove: Object.freeze(removeIds),
                preimage: String(files.get(target.path) || ""),
                today,
              }),
            );
          }
        }
      }

      const failed = [];
      for (const write of sourceWrites.values()) {
        const result = await this.writeRelationEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        if (!result.ok) {
          return refuse(stale, stale);
        }
        committed.push(write.path);
      }

      let followFailed = [];
      if (followUps.length > 0) {
        try {
          const result = await this.applyRelationFollowUps(followUps);
          followFailed = (result && result.failed) || [];
        } catch (_error) {
          followFailed = followUps.map((entry) => entry.path);
        }
      }
      mirrorFailed.push(...followFailed);

      const unchanged =
        noticeAdded.length === 0 &&
        noticeRemoved.length === 0 &&
        noticeRelabeled.length === 0 &&
        committed.every((path) => {
          const write = sourceWrites.get(path);
          return write && write.original === write.nextContent;
        });
      const notice = unchanged
        ? null
        : buildRelationEditNotice({
            added: noticeAdded,
            removed: noticeRemoved,
            relabeled: noticeRelabeled,
            direction,
            archived,
            mirrorFailed,
          });
      return Object.freeze({
        ok: true,
        reason: followFailed.length > 0 ? "partial" : unchanged ? "unchanged" : null,
        notice,
        committed: Object.freeze(committed),
        failed: Object.freeze(failed),
        mirrorFailed: Object.freeze([...new Set(mirrorFailed)]),
      });
    } catch (_error) {
      return refuse("apply-failed");
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
