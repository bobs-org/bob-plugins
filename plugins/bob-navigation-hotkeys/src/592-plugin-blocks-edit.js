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

  async applyBlocksEdit(args = {}) {
    try {
      const today = args.today || new Date();
      const add = Array.isArray(args.add) ? args.add : [];
      const remove = Array.isArray(args.remove) ? args.remove : [];
      const sources = Array.isArray(args.sources) ? args.sources : [];
      const files = new Map();
      if (args.files instanceof Map) {
        for (const [filePath, fileContent] of args.files) {
          files.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
        }
      } else if (args.files && typeof args.files === "object") {
        for (const filePath of Object.keys(args.files)) {
          files.set(
            normalizeVaultRelativePath(filePath),
            String(args.files[filePath] || ""),
          );
        }
      }
      const resolveLinkpath = this.dependencyLinkpathResolver();
      const wanted = new Set();
      for (const ref of [...sources, ...add, ...remove]) {
        const path = normalizeVaultRelativePath(ref && ref.path);
        if (path) {
          wanted.add(path);
        }
      }
      for (const filePath of wanted) {
        if (files.has(filePath)) {
          continue;
        }
        const loaded = await this.readDependencyNoteContent(filePath, null, "");
        if (loaded === null) {
          return Object.freeze({
            ok: false,
            reason: "target-not-found",
            notice: null,
            committed: Object.freeze([]),
            failed: Object.freeze([]),
            pomodoro: null,
            blocksFailed: Object.freeze([]),
          });
        }
        files.set(filePath, loaded);
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
      for (const filePath of [...files.keys()]) {
        const content = files.get(filePath);
        const lines = String(content || "").split(/\r?\n/);
        for (let line = 0; line < lines.length; line += 1) {
          const collection = collectDependencyNavigationBullets(content, line);
          if (collection.reason) {
            continue;
          }
          for (const target of collection.targets) {
            const targetPath = dependencyPathForLinkNote(
              target.note,
              filePath,
              resolveLinkpath,
            );
            if (targetPath && !files.has(targetPath)) {
              const loaded = await this.readDependencyNoteContent(
                targetPath,
                null,
                filePath,
              );
              if (loaded !== null) {
                files.set(targetPath, loaded);
              }
            }
          }
        }
      }
      if (args.expected instanceof Map || (args.expected && typeof args.expected === "object")) {
        const expected =
          args.expected instanceof Map
            ? args.expected
            : new Map(Object.entries(args.expected));
        for (const [filePath, expectedContent] of expected) {
          const path = normalizeVaultRelativePath(filePath);
          const live = files.get(path);
          if (live !== undefined && String(live) !== String(expectedContent || "")) {
            new Notice("changed — reopen");
            return Object.freeze({
              ok: false,
              reason: "changed — reopen",
              notice: "changed — reopen",
              committed: Object.freeze([]),
              failed: Object.freeze([]),
              pomodoro: null,
              blocksFailed: Object.freeze([]),
            });
          }
        }
      }
      const blocksLinesEnabled =
        args.blocksLinesEnabled !== undefined
          ? args.blocksLinesEnabled === true
          : loadBlocksLinesEnabled();
      const registry = args.registry || (await readTasksStatusRegistry(this.app));
      const needsRecovery = remove.length > 0;
      const vaultContents = needsRecovery
        ? await this.readDependencyRecoveryVaultContents(
            sources[0] && sources[0].path,
            files.get(normalizeVaultRelativePath((sources[0] && sources[0].path) || "")) || "",
          )
        : null;
      const lanesByPath = new Map();
      const subtreePreps = [];
      for (const ref of add) {
        const path = normalizeVaultRelativePath(ref && ref.path);
        if (!path || lanesByPath.has(path) || !files.has(path)) {
          continue;
        }
        const prep = await this.prepareSubtreeForDependencyPlan(path, files.get(path), {
          files,
          add: sources,
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
        sources,
        add,
        remove,
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
          ...navNoteScopeFlags(
            normalizeVaultRelativePath((sources[0] && sources[0].path) || ""),
          ),
        },
      });
      if (!plan.ok) {
        return Object.freeze({
          ok: false,
          reason: plan.reason,
          notice: null,
          committed: Object.freeze([]),
          failed: Object.freeze([]),
          pomodoro: null,
          blocksFailed: Object.freeze([]),
        });
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
      const extraPomodoroTargets = [];
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
          extraPomodoroTargets.push(...planned.pass.pomodoroTargets);
        }
      }
      const pomodoroTargets = collectDependencyPlanPomodoroTargets([
        { summary: { pomodoroTargets: plan.pomodoroTargets } },
        { summary: { pomodoroTargets: extraPomodoroTargets } },
      ]);
      const foldPath =
        dailyPath && sourceWrites.some((entry) => entry.path === dailyPath)
          ? dailyPath
          : dailyPath && dependentWrites.some((entry) => entry.path === dailyPath)
            ? dailyPath
            : null;
      const foldWrite = foldPath
        ? sourceWrites.find((entry) => entry.path === foldPath) ||
          dependentWrites.find((entry) => entry.path === foldPath)
        : null;
      const pomodoroParent = foldWrite
        ? foldWrite.path
        : (sourceWrites[0] && sourceWrites[0].path) ||
          (dependentWrites[0] && dependentWrites[0].path) ||
          "";
      const pomodoroBefore = foldWrite
        ? foldWrite.original
        : files.get(pomodoroParent) || "";
      const pomodoroNext = foldWrite
        ? foldWrite.nextContent
        : files.get(pomodoroParent) || "";
      let pomodoroPrep = await prepareDependencyPomodoroCleanup(
        (snapshotOptions) =>
          this.readDeferredPomodoroSnapshot(this.app, snapshotOptions),
        pomodoroTargets,
        pomodoroParent,
        pomodoroBefore,
        pomodoroNext,
        today,
      );
      if (foldWrite && pomodoroPrep.commitContent !== foldWrite.nextContent) {
        foldWrite.nextContent = pomodoroPrep.commitContent;
      }
      for (const write of sourceWrites) {
        const result = await this.writeBlocksEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        if (!result.ok) {
          new Notice("changed — reopen");
          return Object.freeze({
            ok: false,
            reason: "changed — reopen",
            notice: "changed — reopen",
            committed: Object.freeze([]),
            failed: Object.freeze([]),
            pomodoro: null,
            blocksFailed: Object.freeze([]),
          });
        }
      }
      const committed = [];
      const failed = [];
      for (const write of dependentWrites) {
        const result = await this.writeBlocksEditNote(
          write.path,
          write.original,
          write.nextContent,
        );
        const refs = (write.tPlans || []).map((entry) =>
          Object.freeze({
            path: write.path,
            line: entry.parentLine,
            blockId:
              getTrailingBlockId(
                String(write.nextContent.split(/\r?\n/)[entry.parentLine] || ""),
              ) ||
              (entry.row && entry.row.blockId) ||
              "",
            kind: entry.row && entry.row.kind,
          }),
        );
        if (result.ok) {
          for (const ref of refs) {
            committed.push(ref);
          }
        } else {
          for (const ref of refs) {
            failed.push(ref);
          }
        }
      }
      for (const write of sourceWrites) {
        if (!write.foldedDependents) {
          continue;
        }
        const note = (plan.notePlans || []).find(
          (entry) => entry.path === write.path,
        );
        for (const entry of (note && note.tPlans) || []) {
          committed.push(
            Object.freeze({
              path: write.path,
              line: entry.parentLine,
              blockId:
                getTrailingBlockId(
                  String(write.nextContent.split(/\r?\n/)[entry.parentLine] || ""),
                ) ||
                (entry.row && entry.row.blockId) ||
                "",
              kind: entry.row && entry.row.kind,
            }),
          );
        }
      }
      let blocksFailed = [];
      if (blocksLinesEnabled) {
        for (const source of plan.sources || []) {
          const liveEditor = this.findBlocksEditOpenEditor(source.path);
          const liveContent = liveEditor
            ? String(liveEditor.getValue() || "")
            : files.has(source.path)
              ? String(
                  (await this.readDependencyNoteContent(source.path, null, "")) ??
                    files.get(source.path),
                )
              : "";
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
          const mirror = planBlocksMirrorForSource({
            content: liveContent,
            sourcePath: source.path,
            sourceBlockId:
              getTrailingBlockId(
                String(liveContent.split(/\r?\n/)[source.line] || ""),
              ) || source.blockId,
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
      const pomodoroDone = await finishProjectPomodoroCleanup(
        (snapshot, cleanup) =>
          this.writeDeferredPomodoroCleanup(snapshot, cleanup),
        pomodoroPrep.snapshot,
        pomodoroPrep.cleanup,
      );
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
      const notice = buildBlocksEditNotice({
        sourceCount: (plan.sources || []).length,
        added: plan.added,
        removed: plan.removed,
        takesLane: plan.takesLane,
        failedCount: failed.length,
        pomodoroRemoved: pomodoroDone.removed,
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
          removed: pomodoroDone.removed,
          failed: pomodoroDone.failed,
        }),
        blocksFailed: Object.freeze(blocksFailed),
        subtree,
      });
    } catch (_error) {
      return Object.freeze({
        ok: false,
        reason: "apply-failed",
        notice: null,
        committed: Object.freeze([]),
        failed: Object.freeze([]),
        pomodoro: null,
        blocksFailed: Object.freeze([]),
      });
    }
  }
}
