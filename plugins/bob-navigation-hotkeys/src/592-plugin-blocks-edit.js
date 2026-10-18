// Reverse Blocks orchestrator (`docs/task-dependencies.md` §15.6): prepare
// each source once, commit other T notes, mirror BLOCKS from the T's that
// actually landed, then consume Pomodoros and run sub-project passes.
class BobNavigationHotkeysBlocksEditMixin {
  findBlocksEditOpenEditor(filePath) {
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

  async writeBlocksEditNote(filePath, preimage, nextContent) {
    const path = normalizeVaultRelativePath(filePath || "");
    const before = String(preimage || "");
    const after = String(nextContent || "");
    if (!path) {
      return Object.freeze({ ok: false, reason: "invalid-path" });
    }
    if (after === before) {
      return Object.freeze({ ok: true, reason: "unchanged", via: "none" });
    }
    const editor = this.findBlocksEditOpenEditor(path);
    if (editor) {
      if (String(editor.getValue() || "") !== before) {
        return Object.freeze({ ok: false, reason: "changed" });
      }
      const committed = applyEditorContentTransaction(
        editor,
        before,
        after,
        null,
        BLOCKS_MACHINE_WRITE_ANNOTATION,
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
        if (String(data || "") !== before) {
          return data;
        }
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

  // Notes the apply-time guards need beyond the touched ones: N's Depends-On
  // closure (a cycle needs N to reach T) and the project ancestors of every
  // source note (a project T refuses an N inside its sub-projects). Bounded,
  // best-effort reads; an unreadable note is simply absent.
  async readBlocksEditGuardNotes(files, sources, vaultFiles, resolveLinkpath) {
    const guardFiles = new Map(files);
    const load = async (filePath, parentPath) => {
      const path = normalizeVaultRelativePath(filePath || "");
      if (!path) {
        return null;
      }
      if (!guardFiles.has(path)) {
        const loaded = await this.readDependencyNoteContent(path, null, parentPath);
        if (loaded === null) {
          return null;
        }
        guardFiles.set(path, loaded);
      }
      return guardFiles.get(path);
    };
    const visited = new Set();
    const queue = [];
    for (const ref of sources) {
      const path = normalizeVaultRelativePath((ref && ref.path) || "");
      const content = guardFiles.get(path);
      if (typeof content === "string" && Number.isInteger(ref.line)) {
        queue.push({ path, line: ref.line });
      }
      let current = path;
      for (let depth = 0; depth < PROJECT_SUBTREE_MAX_DEPTH && current; depth += 1) {
        const text = await load(current, "");
        if (text === null) {
          break;
        }
        const parentPath = resolveProjectParentPath(
          projectParentTarget(projectParentFieldFromNoteText(text)),
          current,
          vaultFiles,
        );
        if (!parentPath) {
          break;
        }
        current = parentPath;
      }
    }
    while (queue.length > 0 && visited.size < 200) {
      const { path, line } = queue.shift();
      const key = `${path}\x00${line}`;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      const content = await load(path, "");
      if (content === null) {
        continue;
      }
      const enqueue = (targetPath, blockId) => {
        const loaded = guardFiles.get(targetPath);
        const found =
          typeof loaded === "string"
            ? findTaskLineByTrailingBlockId(loaded.split(/\r?\n/), blockId)
            : null;
        if (found !== null) {
          queue.push({ path: targetPath, line: found });
        }
      };
      const collection = collectDependencyNavigationBullets(content, line);
      if (!collection.reason) {
        for (const target of collection.targets) {
          const targetPath = dependencyPathForLinkNote(target.note, path, resolveLinkpath);
          if (targetPath && (await load(targetPath, path)) !== null) {
            enqueue(targetPath, target.blockId);
          }
        }
      }
      // A resident inherits its project's prerequisites (§13.6).
      const info = getProjectPrjDependencyResidents(content, path);
      if (info && info.prjLine !== line) {
        queue.push({ path, line: info.prjLine });
      }
    }
    return guardFiles;
  }

  async applyBlocksEdit(args = {}) {
    const stale = "changed — reopen";
    // The writer never shows a Notice: it returns `notice` and the caller
    // (the stage, the chip ×, the palette command) shows it exactly once.
    const refuse = (reason, notice = null) =>
      Object.freeze({
        ok: false,
        reason,
        notice,
        committed: Object.freeze([]),
        failed: Object.freeze([]),
        pomodoro: null,
        blocksFailed: Object.freeze([]),
      });
    try {
      const today = args.today || new Date();
      const add = Array.isArray(args.add) ? args.add : [];
      const remove = Array.isArray(args.remove) ? args.remove : [];
      const sources = Array.isArray(args.sources) ? args.sources : [];
      const resolveLinkpath = this.dependencyLinkpathResolver();

      // Preflight (§15.6 step 1): live content for every touched note, an
      // open buffer winning over the vault, then the changed-since-open check.
      const files = new Map();
      for (const ref of [...sources, ...add, ...remove]) {
        const path = normalizeVaultRelativePath(ref && ref.path);
        if (!path || files.has(path)) {
          continue;
        }
        const loaded = await this.readDependencyNoteContent(path, null, "");
        if (loaded === null) {
          return refuse("target-not-found");
        }
        files.set(path, loaded);
      }
      const vaultFiles = this.readDependencyVaultFileList() || [...files.keys()];
      let dailyPath = null;
      try {
        dailyPath = scheduledRecoveryDailyPaths(
          vaultFiles.map((path) => ({ path })),
          today,
        ).current;
      } catch (_error) {
        dailyPath = null;
      }
      if (dailyPath && !files.has(dailyPath)) {
        const loaded = await this.readDependencyNoteContent(dailyPath, null, "");
        if (loaded !== null) {
          files.set(dailyPath, loaded);
        }
      }
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
      const locate = (refs) => {
        const located = [];
        for (const ref of refs) {
          const row = relocateBlocksEditRef(
            ref,
            files.get(normalizeVaultRelativePath(ref && ref.path)),
          );
          if (!row) {
            return null;
          }
          located.push(row);
        }
        return located;
      };
      const liveSources = locate(sources);
      const liveAdd = locate(add);
      const liveRemove = locate(remove);
      if (!liveSources || !liveAdd || !liveRemove) {
        return refuse(stale, stale);
      }
      // The planner reads each T's existing Depends-On targets.
      for (const ref of [...liveAdd, ...liveRemove]) {
        const path = normalizeVaultRelativePath(ref.path);
        const collection = collectDependencyNavigationBullets(
          files.get(path),
          ref.line,
        );
        if (collection.reason) {
          continue;
        }
        for (const target of collection.targets) {
          const targetPath = dependencyPathForLinkNote(
            target.note,
            path,
            resolveLinkpath,
          );
          if (targetPath && !files.has(targetPath)) {
            const loaded = await this.readDependencyNoteContent(targetPath, null, path);
            if (loaded !== null) {
              files.set(targetPath, loaded);
            }
          }
        }
      }
      if (liveAdd.length > 0) {
        const guard = checkBlocksEditGuards({
          sources: liveSources,
          add: liveAdd,
          remove: liveRemove,
          files: await this.readBlocksEditGuardNotes(
            files,
            liveSources,
            vaultFiles,
            resolveLinkpath,
          ),
        });
        if (!guard.ok) {
          return refuse(guard.reason, guard.notice);
        }
      }

      const blocksLinesEnabled =
        args.blocksLinesEnabled !== undefined
          ? args.blocksLinesEnabled === true
          : loadBlocksLinesEnabled();
      const registry = args.registry || (await readTasksStatusRegistry(this.app));
      const needsRecovery = liveRemove.length > 0;
      const vaultContents = needsRecovery
        ? await this.readDependencyRecoveryVaultContents(
            liveSources[0] && liveSources[0].path,
            files.get(
              normalizeVaultRelativePath((liveSources[0] && liveSources[0].path) || ""),
            ) || "",
          )
        : null;
      const lanesByPath = new Map();
      const subtreePreps = [];
      for (const ref of liveAdd) {
        const path = normalizeVaultRelativePath(ref && ref.path);
        if (!path || lanesByPath.has(path) || !files.has(path)) {
          continue;
        }
        const prep = await this.prepareSubtreeForDependencyPlan(path, files.get(path), {
          files,
          add: liveSources,
          remove: [],
          today,
        });
        if (prep) {
          if (Array.isArray(prep.lanes) && prep.lanes.length > 0) {
            lanesByPath.set(path, prep.lanes);
          }
          subtreePreps.push(Object.freeze({ path, prep }));
        }
      }
      const stamper =
        typeof args.stamper === "function"
          ? args.stamper
          : this.getFreshnessStampLine();
      const dateText =
        args.dateText !== undefined
          ? args.dateText
          : typeof this.getFreshnessDateText === "function"
            ? this.getFreshnessDateText()
            : undefined;
      const plan = planBlocksEdit({
        sources: liveSources,
        add: liveAdd,
        remove: liveRemove,
        files,
        vaultFiles,
        resolveLinkpath,
        blocksLinesEnabled,
        stamper,
        dateText,
        projectLaneStatusesByPath: lanesByPath,
        recovery: {
          registry,
          today,
          vaultContents,
          markUnblockedLine: navFreshnessMarkUnblockedLine(
            typeof this.getFreshnessApi === "function"
              ? this.getFreshnessApi()
              : null,
          ),
        },
      });
      if (!plan.ok) {
        return refuse(plan.reason);
      }
      if (!plan.changed) {
        return Object.freeze({
          ok: true,
          reason: "unchanged",
          notice: null,
          committed: Object.freeze([]),
          failed: Object.freeze([]),
          pomodoro: null,
          blocksFailed: Object.freeze([]),
        });
      }
      const sourceWrites = plan.sourceWrites.map((entry) => ({ ...entry }));
      const dependentWrites = plan.dependentWrites.map((entry) => ({ ...entry }));
      const extraTargetsByPath = new Map();
      for (const entry of subtreePreps) {
        const write =
          dependentWrites.find((item) => item.path === entry.path) ||
          sourceWrites.find((item) => item.path === entry.path);
        if (!write || !entry.prep) {
          continue;
        }
        let planned = null;
        try {
          planned = await this.planSubtreePassForPrjEdit(
            entry.path,
            write.original,
            write.nextContent,
            {
              files,
              descendantTexts: entry.prep.texts,
              childrenMap: entry.prep.childrenMap,
              notePaths: entry.prep.notePaths,
              today,
              registry,
            },
          );
        } catch (_error) {
          planned = null;
        }
        if (
          planned &&
          planned.pass &&
          Array.isArray(planned.pass.pomodoroTargets)
        ) {
          extraTargetsByPath.set(entry.path, planned.pass.pomodoroTargets);
        }
      }
      // Pomodoro links are consumed only for T's that committed: the
      // targets of one note's T's, or none for a note that has no T.
      const planByPath = new Map(
        (plan.notePlans || []).map((note) => [
          note.path,
          note.tPlans.map((entry) => entry.plan),
        ]),
      );
      const targetsForPath = (path) =>
        collectDependencyPlanPomodoroTargets([
          ...(planByPath.get(path) || []),
          { summary: { pomodoroTargets: extraTargetsByPath.get(path) || [] } },
        ]);
      const readSnapshot = (snapshotOptions) =>
        this.readDeferredPomodoroSnapshot(this.app, snapshotOptions);
      // Today's daily note, when it is also written here, takes the cleanup
      // of its own T's in that same transaction.
      let foldRemoved = 0;
      let foldedPath = null;
      const foldWrite = dailyPath
        ? [...sourceWrites, ...dependentWrites].find(
            (entry) => entry.path === dailyPath,
          )
        : null;
      if (foldWrite) {
        const foldTargets = targetsForPath(foldWrite.path);
        const prep = await prepareDependencyPomodoroCleanup(
          readSnapshot,
          foldTargets,
          foldWrite.path,
          foldWrite.original,
          foldWrite.nextContent,
          today,
        );
        if (prep.commitContent !== foldWrite.nextContent) {
          foldWrite.nextContent = prep.commitContent;
          foldRemoved = prep.cleanup ? prep.cleanup.removedLinkCount : 0;
          foldedPath = foldWrite.path;
        }
      }

      for (const write of sourceWrites) {
        const result = await this.writeBlocksEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        if (!result.ok) {
          return refuse(stale, stale);
        }
      }
      // `committed` holds only T's that landed, with the planner's final
      // line and block id (never the pre-plan index).
      const refOf = (write, entry) =>
        Object.freeze({
          path: write.path,
          line: entry.finalLine,
          blockId: entry.blockId,
          kind: entry.row && entry.row.kind,
        });
      const committed = [];
      const failed = [];
      const committedPaths = new Set();
      for (const write of dependentWrites) {
        const result = await this.writeBlocksEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        const refs = (write.tPlans || []).map((entry) => refOf(write, entry));
        if (result.ok) {
          committedPaths.add(write.path);
          committed.push(...refs);
        } else {
          failed.push(...refs);
        }
      }
      for (const write of sourceWrites) {
        if (!write.foldedDependents) {
          continue;
        }
        const note = (plan.notePlans || []).find(
          (entry) => entry.path === write.path,
        );
        committedPaths.add(write.path);
        for (const entry of (note && note.tPlans) || []) {
          committed.push(refOf(write, entry));
        }
      }
      let blocksFailed = [];
      if (blocksLinesEnabled) {
        for (const source of plan.sources || []) {
          const liveEditor = this.findBlocksEditOpenEditor(source.path);
          const liveContent = liveEditor
            ? String(liveEditor.getValue() || "")
            : String(
                (await this.readDependencyNoteContent(source.path, null, "")) ??
                  files.get(source.path) ??
                  "",
              );
          const addCommitted = [];
          const removeCommitted = [];
          for (const ref of committed) {
            if (!ref.blockId) {
              continue;
            }
            if (ref.kind === "remove") {
              removeCommitted.push({ path: ref.path, blockId: ref.blockId });
            } else {
              addCommitted.push({ path: ref.path, blockId: ref.blockId });
            }
          }
          // N is found by its block id in the post-write content; its
          // pre-write line may have moved.
          const mirror = planBlocksMirrorForSource({
            content: liveContent,
            sourcePath: source.path,
            sourceBlockId: source.blockId,
            add: addCommitted,
            remove: removeCommitted,
            vaultFiles,
            resolveLinkpath,
            blocksLinesEnabled: true,
          });
          if (!mirror.ok) {
            blocksFailed.push(source.path);
            continue;
          }
          if (!mirror.changed) {
            continue;
          }
          const written = await this.writeBlocksEditNote(
            source.path,
            liveContent,
            mirror.nextContent,
          );
          if (!written.ok) {
            blocksFailed.push(source.path);
          }
        }
      }
      // One cleanup after the writes, for the T's that committed in notes
      // whose cleanup was not folded; its counts are what was removed.
      const consumed = foldedPath && committedPaths.has(foldedPath) ? foldRemoved : 0;
      const deferredTargets = collectDependencyPlanPomodoroTargets(
        [...committedPaths]
          .filter((path) => path !== foldedPath)
          .map((path) => ({ summary: { pomodoroTargets: targetsForPath(path) } })),
      );
      const deferred = await prepareDependencyPomodoroCleanup(
        readSnapshot,
        deferredTargets,
        "",
        "",
        "",
        today,
      );
      const pomodoroDone = await finishProjectPomodoroCleanup(
        (snapshot, cleanup) =>
          this.writeDeferredPomodoroCleanup(snapshot, cleanup),
        deferred.snapshot,
        deferred.cleanup,
      );
      const pomodoroRemoved = pomodoroDone.removed + consumed;
      let subtree = null;
      const subtreeRoots = [];
      for (const write of [...sourceWrites, ...dependentWrites]) {
        const landed = failed.every(
          (ref) => normalizeVaultRelativePath(ref.path) !== write.path,
        );
        if (!landed) {
          continue;
        }
        subtreeRoots.push({
          path: write.path,
          beforeText: write.original,
          afterText: write.nextContent,
        });
      }
      if (
        subtreeRoots.length > 0 &&
        typeof this.applySubtreePassesForRoots === "function"
      ) {
        try {
          subtree = await this.applySubtreePassesForRoots(subtreeRoots, {
            today,
          });
        } catch (_error) {
          subtree = null;
        }
      }
      const failedKeys = new Set(
        failed.map((ref) => `${ref.path}\x00${ref.line}`),
      );
      const landedOnly = (infos) =>
        (infos || []).filter(
          (info) => !failedKeys.has(`${info.path}\x00${info.line}`),
        );
      const notice = buildBlocksEditNotice({
        sourceCount: (plan.sources || []).length,
        added: landedOnly(plan.added),
        removed: landedOnly(plan.removed),
        takesLane: plan.takesLane,
        failedCount: failed.length,
        pomodoroRemoved,
        pomodoroFailed: pomodoroDone.failed,
        blocksFailed: blocksFailed.length > 0,
      });
      const withSubtree = subtree && subtreePassNoticeSuffix(subtree)
        ? `${notice} ${subtreePassNoticeSuffix(subtree)}`
        : notice;
      return Object.freeze({
        ok: true,
        reason: failed.length > 0 ? "partial" : null,
        notice: withSubtree,
        committed: Object.freeze(committed),
        failed: Object.freeze(failed),
        pomodoro: Object.freeze({
          removed: pomodoroRemoved,
          failed: pomodoroDone.failed,
        }),
        blocksFailed: Object.freeze(blocksFailed),
        subtree,
      });
    } catch (_error) {
      return refuse("apply-failed");
    }
  }
}
