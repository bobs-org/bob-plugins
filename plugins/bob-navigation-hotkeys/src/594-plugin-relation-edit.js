// Relation orchestrator (`docs/task-relations.md` Rule 7 / §17): write each
// source LINKS line, mint the source id inside that transaction when a
// mirror will be stored, then send best-effort LINKED FROM follow-ups.
// Same-note S and T share one undo group. The writer never stamps or routes
// inbox tasks. It touches Pomodoros only through the §17 cancel-label
// composition (Task Card Cancel planners folded into the source write).
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
    const refuse = (reason, notice = null, extra = {}) =>
      Object.freeze({
        ok: false,
        reason,
        notice,
        stale: extra.stale === true,
        cancelEffects: extra.cancelEffects || null,
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
      const cancelLabels =
        args.cancelLabels !== undefined
          ? args.cancelLabels
          : loadRelationsCancelLabels();
      const cancelDate =
        typeof args.cancelDate === "string" && args.cancelDate
          ? String(args.cancelDate)
          : formatBulletPropertyDate(today instanceof Date ? today : new Date());
      const cancelTrigger = args.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER;

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
      const cancelledNoticeRows = [];
      const cancelledIdentities = [];
      const cancelSourcePlans = [];
      const cancelRefusals = [];
      let cancelStayedCancelled = false;
      const consumedLinesByPath = new Map();
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
        const consumed = consumedLinesByPath.get(source.path) || new Set();
        const liveSource = relocateRelationCancelSource(content, source, consumed);
        let sourceLine = liveSource.line;
        const liveLines = content.split(/\r?\n/);
        if (liveSource.blockId) {
          const found = findTaskLineByTrailingBlockId(
            liveLines,
            liveSource.blockId,
          );
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
          const noticeRow = (target) =>
            direction === "from"
              ? { ...source, label: target.label }
              : target;
          for (const target of liveAdd) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            if (planned.report.added.includes(link)) {
              noticeAdded.push(noticeRow(target));
            }
            if (planned.report.relabeled.includes(link)) {
              noticeRelabeled.push(noticeRow(target));
            }
          }
          for (const target of liveRelabel) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            const row = noticeRow(target);
            if (
              planned.report.relabeled.includes(link) &&
              !noticeRelabeled.some(
                (entry) =>
                  entry.path === row.path && entry.blockId === row.blockId,
              )
            ) {
              noticeRelabeled.push(row);
            }
          }
          for (const target of liveRemove) {
            const link = storedRelationLinkForTarget(
              existingRows,
              target,
              source.path,
              vaultFiles,
            );
            if (planned.report.removed.includes(link)) {
              noticeRemoved.push(noticeRow(target));
            }
          }
        }

        const cancelEdges = deriveRelationCancelEdges({
          report: planned.report,
          existingRows,
          liveAdd,
          liveRelabel,
          sourcePath: source.path,
          vaultFiles,
        });
        const policyRaw = String(
          content.split(/\r?\n/)[sourceLine] || liveSource.rawLine || "",
        );
        cancelStayedCancelled = cancelStayedCancelled ||
          relationCancelRemovalStaysCancelled(
            policyRaw,
            existingRows,
            liveRemove,
            liveRelabel,
            cancelLabels,
          );
        const policyPlan = planRelationCancelEffects({
          cancelLabels,
          trigger: cancelTrigger,
          sources: [
            relationCancelPolicySourceFromLine(
              {
                path: liveSource.path,
                blockId: liveSource.blockId,
                line: sourceLine,
              },
              policyRaw,
              cancelEdges,
            ),
          ],
        });
        const policySource = policyPlan.sources[0] || null;
        if (policySource) cancelSourcePlans.push(policySource);
        if (policySource && policySource.refusal) {
          cancelRefusals.push(policySource);
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
        if (needsMirror && sourceBlockId) {
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

        const folded = applyComposedRelationSourceCancel({
          policySource, cancelRefusals, content: contentOf(source.path), source,
          liveSource, sourceLine, consumed, cancelEdges, cancelLabels,
          cancelTrigger, cancelDate, liveAdd, liveRelabel, liveRemove, original,
          stageWrite, cancelledIdentities, cancelledNoticeRows, consumedLinesByPath,
        });
        if (!folded.ok) {
          return refuse(
            folded.recurring ? "relation_cancels_recurring_task" : folded.reason || "cancel-failed",
            folded.reason,
          );
        }
      }

      const commitGate = relationCancelCommitGate(
        cancelSourcePlans, cancelRefusals, cancelDate, args.expectedCancelEffects, stale,
      );
      if (!commitGate.ok) {
        return refuse(commitGate.reason, commitGate.notice, {
          stale: commitGate.stale === true,
          cancelEffects: commitGate.cancelEffects,
        });
      }
      const cancelEffects = commitGate.cancelEffects;
      const dailyPrep = await this.prepareRelationCancelDailyCleanup(
        sourceWrites, cancelledIdentities, today,
      );
      if (!dailyPrep.ok) return refuse(dailyPrep.reason, dailyPrep.notice);
      const pomodoroSnapshot = dailyPrep.snapshot;
      const dailyCleanupPlan = dailyPrep.plan;
      const cleanupHandled = dailyPrep.cleanupHandled === true;

      const failed = [];
      for (const write of sourceWrites.values()) {
        const result = await this.writeRelationEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        if (!result.ok) {
          failed.push(write.path);
          if (committed.length === 0) {
            return refuse(stale, stale, { cancelEffects });
          }
          break;
        }
        committed.push(write.path);
      }

      const committedSet = new Set(committed);
      const committedCancelled = cancelledIdentities.filter((entry) =>
        committedSet.has(entry.path),
      );
      let followFailed = [];
      if (followUps.length > 0 && failed.length === 0) {
        try {
          const result = await this.applyRelationFollowUps(followUps);
          followFailed = (result && result.failed) || [];
        } catch (_error) {
          followFailed = followUps.map((entry) => entry.path);
        }
      } else if (failed.length > 0) {
        followFailed = followUps.map((entry) => entry.path);
      }
      mirrorFailed.push(...followFailed);

      let pomodoroLinksRemoved = 0;
      let pruneFailed = false;
      let recovered = 0;
      if (committedCancelled.length > 0) {
        const effects = await this.runPostCancelEffects({
          identities: committedCancelled,
          activePath: liveSources[0] && liveSources[0].path,
          editor: this.findRelationEditOpenEditor(liveSources[0] && liveSources[0].path),
          pomodoroSnapshot, dailyCleanupPlan, cleanupHandled,
          pomodoroLinksRemoved:
            cleanupHandled && dailyCleanupPlan && dailyCleanupPlan.changed
              ? dailyCleanupPlan.removedLinkCount
              : 0,
        });
        pomodoroLinksRemoved = effects.pomodoroLinksRemoved;
        pruneFailed = effects.pruneFailed;
        recovered = effects.recovered;
      }

      const unchanged =
        noticeAdded.length === 0 &&
        noticeRemoved.length === 0 &&
        noticeRelabeled.length === 0 &&
        cancelledNoticeRows.length === 0 &&
        committed.every((path) => {
          const write = sourceWrites.get(path);
          return write && write.original === write.nextContent;
        });
      const relationNotice = unchanged
        ? null
        : withRelationCancelStayNotice(buildRelationEditNotice({
            added: noticeAdded,
            removed: noticeRemoved,
            relabeled: noticeRelabeled,
            direction,
            archived,
            mirrorFailed: [],
          }), cancelStayedCancelled);
      const notice = unchanged
        ? null
        : buildRelationCancelComposeNotice({
            cancelled: cancelledNoticeRows,
            relationNotice,
            pruneFailed,
            pomodoroLinksRemoved,
            recovered,
            mirrorFailed,
          });
      return Object.freeze({
        ok: true,
        reason:
          failed.length > 0 || followFailed.length > 0
            ? "partial"
            : unchanged
              ? "unchanged"
              : null,
        notice,
        stale: false,
        cancelEffects,
        committed: Object.freeze(committed),
        failed: Object.freeze(failed),
        mirrorFailed: Object.freeze([...new Set(mirrorFailed)]),
        pomodoroLinksRemoved,
        pruneFailed,
        recovered,
      });
    } catch (_error) {
      return refuse("apply-failed");
    }
  }

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

  async removeAllRelationLinksByRef(sourceRef = {}) {
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
      const enabled = loadRelationsLinkedFromLinesEnabled();
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
          const desired = linkedFromDesiredAfterDelta(existing, (entry) => ({ identity: entry.identity, link: entry.link }), [], [sourceIdentity]);
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
              add: Object.freeze([]),
              remove: Object.freeze([sourceIdentity]),
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
