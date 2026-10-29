// Relation orchestrator (`docs/task-relations.md` Rule 7 / §17): write each
// source LINKS line, mint the source id inside that transaction when a
// mirror will be stored, then send best-effort LINKED FROM follow-ups.
// Same-note S and T share one undo group. Relation status changes only via
// the explicit §17 cancel-label and §18 complete-label exceptions.
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
        closeEffects: extra.closeEffects || null,
        committed: Object.freeze([]),
        failed: Object.freeze([]),
        mirrorFailed: Object.freeze([]),
        completedIdentities: Object.freeze([]),
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
      // §19 mentions switch, honoring the same explicit-override channel so
      // tests can drive the downgrade deterministically.
      const linkedFromMentionsEnabled =
        args.linkedFromMentionsEnabled !== undefined
          ? args.linkedFromMentionsEnabled === true
          : loadRelationsLinkedFromMentionsEnabled();
      const hasInjectedClosePolicy =
        args.closeLabels !== undefined ||
        args.cancelLabels !== undefined ||
        args.completeLabels !== undefined;
      const closeLabels = args.closeLabels !== undefined
        ? args.closeLabels
        : hasInjectedClosePolicy
          ? {
              cancel: args.cancelLabels || emptyRelationsCancelLabels(),
              complete: args.completeLabels || emptyRelationsCancelLabels(),
            }
          : loadRelationsCloseLabels();
      const cancelLabels =
        args.cancelLabels !== undefined ? args.cancelLabels : closeLabels.cancel;
      const completeLabels =
        args.completeLabels !== undefined ? args.completeLabels : closeLabels.complete;
      const cyclerApi = relationTaskStatusCyclerApi(this.app);
      const cyclerApiAvailable = relationCompleteCyclerApiAvailable(cyclerApi);
      const cancelDate =
        typeof args.cancelDate === "string" && args.cancelDate
          ? String(args.cancelDate)
          : formatBulletPropertyDate(today instanceof Date ? today : new Date());
      const cancelTrigger = args.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER;
      const completeDate = cancelDate;

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
      const noticeDowngraded = [];
      const downgradedPairs = new Set();
      const mirrorFailed = [];
      const cancelledNoticeRows = [];
      const cancelledIdentities = [];
      const cancelSourcePlans = [];
      const cancelRefusals = [];
      const completeSourcePlans = [];
      const completeRefusals = [];
      const completedIdentities = [];
      const completionNoticeRows = [];
      const closingRows = [];
      let cancelStayedCancelled = false;
      let completeStayedDone = false;
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
                : planned.reason === "invalid-label" && planned.labelReason === "reserved"
                  ? TASK_MENTION_RESERVED_MESSAGE
                  : null),
          );
        }
        content = planned.nextContent;
        if (planned.report) {
          const noticeRow = (target) =>
            direction === "from"
              ? { ...source, label: target.label, relationSourcePath: source.path }
              : { ...target, relationSourcePath: source.path };
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
              // §19: the mirror loop below may downgrade this pair to
              // `(💬 mentions)`; the pair key lets composition filter the
              // plain removal then (the mirror loop runs after this block).
              noticeRemoved.push({
                ...noticeRow(target),
                downgradePairKey: `${source.path}\u0000${target.path}\u0000${target.blockId}`,
              });
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
        completeStayedDone = completeStayedDone ||
          relationCompleteRemovalStaysDone(
            policyRaw,
            existingRows,
            liveRemove,
            liveRelabel,
            completeLabels,
          );
        const closePlan = planRelationClosingSource({
          cancelLabels,
          completeLabels,
          trigger: cancelTrigger,
          cyclerApiAvailable,
          source: relationCancelPolicySourceFromLine(
            {
              path: liveSource.path,
              blockId: liveSource.blockId,
              line: sourceLine,
            },
            policyRaw,
            cancelEdges,
          ),
        });
        const policySource = closePlan.cancel;
        const completeSource = closePlan.complete;
        if (policySource) cancelSourcePlans.push(policySource);
        if (closePlan.cancelRefusal) cancelRefusals.push(closePlan.cancelRefusal);
        if (completeSource) completeSourcePlans.push(completeSource);
        if (closePlan.completeRefusal) completeRefusals.push(closePlan.completeRefusal);

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
          let addRows = isRemove
            ? []
            : [
                {
                  identity: sourceIdentity,
                  link: canonical,
                  label: addLabel ? addLabel.label || null : null,
                },
              ];
          // NOTE: linkedFromDesiredAfterDelta drops an identity listed in
          // both add and remove, so a downgrade replaces instead of removing.
          let removeIds = isRemove ? [sourceIdentity] : [];
          // §19 unlink downgrade: a removed relation whose source still
          // mentions the target becomes `(💬 mentions)` (MN8/M7).
          if (isRemove && !addLabel) {
            // Same-note mirror inserts above can shift lines: re-resolve the
            // source owner by ^id before evaluating M7.
            let downgradeSourceLine = sourceLine;
            try {
              const freshSourceLines = contentOf(source.path).split(/\r?\n/);
              const relocated = sourceBlockId
                ? findTaskLineByTrailingBlockId(freshSourceLines, sourceBlockId)
                : null;
              if (relocated !== null) downgradeSourceLine = relocated;
            } catch (_relocateError) {
              // Fall through with the loop's source line.
            }
            const downgradeLabel = this.mentionDowngradeLabelForRemove({
              sourcePath: source.path,
              sourceLine: downgradeSourceLine,
              sourceBlockId,
              sourceContent: contentOf(source.path),
              targetPath: target.path,
              targetBlockId: target.blockId,
              targetContent: contentOf(target.path),
              resolveLinkpath,
              linesEnabled: linkedFromLinesEnabled,
              mentionsEnabled: linkedFromMentionsEnabled,
            });
            if (downgradeLabel) {
              addRows = [
                { identity: sourceIdentity, link: canonical, label: downgradeLabel },
              ];
              removeIds = [];
              downgradedPairs.add(`${source.path}\u0000${target.path}\u0000${target.blockId}`);
              noticeDowngraded.push({ description: source.description, relationSourcePath: source.path });
            }
          }
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

        const closeSource = relationCloseSourceForFold(
          contentOf(source.path), sourceLine, liveSource, sourceBlockId,
          Boolean((policySource && policySource.cancels && cancelRefusals.length === 0) ||
            (completeSource && completeSource.completes)),
        );
        if (!closeSource) return refuse(stale, stale, { stale: true });
        const foldSource = closeSource.source;
        const resolvedLine = closeSource.line;
        const foldCompleteSource = completeSource
          ? Object.freeze({
              ...completeSource,
              blockId: foldSource.blockId || null,
            })
          : completeSource;

        const cancelRowsBefore = cancelledNoticeRows.length;
        const folded = applyComposedRelationSourceCancel({
          policySource, cancelRefusals, content: contentOf(source.path), source,
          liveSource: foldSource, sourceLine: resolvedLine, consumed, cancelEdges, cancelLabels,
          cancelTrigger, cancelDate, liveAdd, liveRelabel, liveRemove, original,
          stageWrite, cancelledIdentities, cancelledNoticeRows, consumedLinesByPath,
        });
        if (!folded.ok) {
          return refuse(
            folded.recurring ? "relation_cancels_recurring_task" : folded.reason || "cancel-failed",
            folded.reason,
          );
        }
        for (const row of cancelledNoticeRows.slice(cancelRowsBefore)) {
          closingRows.push(Object.freeze({ ...row, effect: "cancel" }));
        }
        if (completeSource && completeSource.completes) {
          const completeFold = foldRelationCompleteLine(
            contentOf(source.path),
            foldCompleteSource,
            cyclerApi,
            completeDate,
            resolvedLine,
          );
          if (!completeFold.ok) {
            return refuse("relation_complete_write_failed", null, {
              closeEffects: null,
            });
          }
          stageWrite(source.path, original, completeFold.content);
          const completedBlockId = getTrailingBlockId(completeFold.rawLine);
          const completedTaskId = completeTaskIdFromLine(completeFold.rawLine);
          const completedIdentity = Object.freeze({
            path: source.path,
            blockId: completedBlockId || null,
            taskId: completedTaskId || null,
            line: completeFold.line,
          });
          completedIdentities.push(completedIdentity);
          const edge = completeSource.triggeringEdges[0] || {};
          const target = edge.target || {};
          const completionRow = Object.freeze({
            effect: "complete",
            path: source.path,
            sourceName:
              liveSource.description || relationNoticeNameFromLine(policyRaw) || "task",
            targetName:
              target.description || target.displayText || target.blockId || "task",
            label: edge.label || edge.displayLabel || "",
          });
          completionNoticeRows.push(completionRow);
          closingRows.push(completionRow);
        }
      }

      const commitGate = relationCloseCommitGate({
        cancelSourcePlans,
        cancelRefusals,
        completePlan: {
          sources: completeSourcePlans,
          completes: completeSourcePlans.filter((entry) => entry && entry.completes),
          refusals: completeRefusals,
        },
        day: cancelDate,
        expectedCloseEffects: args.expectedCloseEffects,
        expectedCancelEffects: args.expectedCancelEffects,
        staleReason: stale,
      });
      if (!commitGate.ok) {
        return refuse(commitGate.reason, commitGate.notice, {
          stale: commitGate.stale === true,
          cancelEffects: commitGate.cancelEffects,
          closeEffects: commitGate.closeEffects,
        });
      }
      const cancelEffects = commitGate.cancelEffects;
      const closeEffects = commitGate.closeEffects;
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
            return refuse(stale, stale, { cancelEffects, closeEffects });
          }
          break;
        }
        committed.push(write.path);
      }

      const committedSet = new Set(committed);
      const committedCancelled = cancelledIdentities.filter((entry) =>
        committedSet.has(entry.path),
      );
      const committedCompleted = dedupeRelationCompleteIdentities(
        completedIdentities.filter((entry) => committedSet.has(entry.path)),
      );
      const committedCancelledNoticeRows = cancelledNoticeRows.filter((entry) =>
        !entry.path || committedSet.has(entry.path),
      );
      const committedClosingRows = closingRows.filter((entry) =>
        !entry.path || committedSet.has(entry.path),
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
        noticeAdded.every((entry) => entry.relationSourcePath && !committedSet.has(entry.relationSourcePath)) &&
        noticeRemoved.every((entry) => entry.relationSourcePath && !committedSet.has(entry.relationSourcePath)) &&
        noticeRelabeled.every((entry) => entry.relationSourcePath && !committedSet.has(entry.relationSourcePath)) &&
        noticeDowngraded.every((entry) => entry.relationSourcePath && !committedSet.has(entry.relationSourcePath)) &&
        committedCancelledNoticeRows.length === 0 &&
        committedCompleted.length === 0 &&
        committed.every((path) => {
          const write = sourceWrites.get(path);
          return write && write.original === write.nextContent;
        });
      const committedDowngraded = noticeDowngraded.filter((entry) => !entry.relationSourcePath || committedSet.has(entry.relationSourcePath));
      // §19: downgraded pairs report the unlink notice naming the mention
      // source, never the plain `Unlinked` line.
      const downgradeNotice = committedDowngraded.length > 0
        ? committedDowngraded.map((entry) => relationMentionUnlinkNotice(entry.description || "that task")).join(" · ")
        : null;
      const committedNoticeAdded = noticeAdded.filter((entry) => !entry.relationSourcePath || committedSet.has(entry.relationSourcePath));
      // §19: downgraded pairs report the unlink notice, never the plain
      // removal, even when the mirror loop ran after the notice rows above.
      const committedNoticeRemoved = noticeRemoved.filter((entry) =>
        (!entry.relationSourcePath || committedSet.has(entry.relationSourcePath)) &&
        !downgradedPairs.has(entry.downgradePairKey),
      );
      const committedNoticeRelabeled = noticeRelabeled.filter((entry) => !entry.relationSourcePath || committedSet.has(entry.relationSourcePath));
      const hasBaseChanges = committedNoticeAdded.length + committedNoticeRemoved.length + committedNoticeRelabeled.length > 0;
      const baseRelationNotice = unchanged
        ? null
        : withRelationCloseStayNotice(buildRelationEditNotice({
            added: committedNoticeAdded,
            removed: committedNoticeRemoved,
            relabeled: committedNoticeRelabeled,
            direction,
            archived,
            mirrorFailed: [],
          }), cancelStayedCancelled, completeStayedDone);
      // A downgrade-only gesture reports only the unlink notice; mixed
      // gestures join both.
      const relationNotice = unchanged
        ? null
        : downgradeNotice && !hasBaseChanges
          ? downgradeNotice
          : [baseRelationNotice, downgradeNotice].filter(Boolean).join(" · ") || null;
      const baseNotice = unchanged
        ? null
        : committedCompleted.length > 0
          ? buildRelationClosingNotice({
              closingRows: committedClosingRows,
              relationNotice,
              pruneFailed,
              pomodoroLinksRemoved,
              recovered,
              mirrorFailed,
            })
          : buildRelationCancelComposeNotice({
              cancelled: committedCancelledNoticeRows,
              relationNotice,
              pruneFailed,
              pomodoroLinksRemoved,
              recovered,
              mirrorFailed,
            });
      const outcome = Object.freeze({
        ok: true,
        reason:
          failed.length > 0 || followFailed.length > 0
            ? "partial"
            : unchanged
              ? "unchanged"
              : null,
        notice: baseNotice,
        stale: false,
        cancelEffects,
        closeEffects,
        relationNotice,
        closingRows: committedClosingRows,
        completedIdentities: committedCompleted,
        activePath: liveSources[0] && liveSources[0].path,
        committed: Object.freeze(committed),
        failed: Object.freeze(failed),
        mirrorFailed: Object.freeze([...new Set(mirrorFailed)]),
        pomodoroLinksRemoved,
        pruneFailed,
        recovered,
      });
      if (
        committedCompleted.length > 0 &&
        args.deferCloseFinalization !== true
      ) {
        const picker = this.activeBulletPropertyPicker;
        const activePath =
          normalizeVaultRelativePath(picker && picker.filePath) ||
          outcome.activePath;
        return this.finalizeRelationCompleteOutcome(outcome, {
          activePath,
          editor:
            (picker && picker.editor) ||
            this.findRelationEditOpenEditor(activePath),
        });
      }
      return outcome;
    } catch (_error) {
      return refuse("apply-failed");
    }
  }


}
