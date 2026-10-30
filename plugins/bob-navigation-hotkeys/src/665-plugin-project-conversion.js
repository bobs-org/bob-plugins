class BobNavigationHotkeysProjectConversionMixin {

  async convertProjectNoteToTask(editor, view, cursor, lineText) {
    const vault = this.app && this.app.vault;
    if (
      !vault ||
      typeof vault.process !== "function" ||
      typeof vault.read !== "function"
    ) {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    if (!view || typeof view.save !== "function") {
      new Notice("Could not save project note");
      return false;
    }

    try {
      await view.save();
    } catch (error) {
      new Notice("Could not save project note");
      return false;
    }

    const sourceFile = view.file;
    const content = editor.getValue();
    const noteBasename =
      (sourceFile && sourceFile.basename) ||
      getVaultPathBasenameWithoutExtension(sourceFile && sourceFile.path);
    const projectHeader = buildTaskBlockFromProjectNote(content, { noteBasename });
    if (!projectHeader.valid) {
      new Notice(projectHeader.error);
      return false;
    }

    if (!isProjectFrontmatterParentLink(projectHeader.parentLink)) {
      new Notice("Project note has no parent link");
      return false;
    }

    const parentTarget = this.extractLinkTarget(projectHeader.parentLink);
    if (!parentTarget) {
      new Notice("Project note has no parent link");
      return false;
    }

    const parentFile = this.resolveLinkTargetFile(
      parentTarget,
      sourceFile && sourceFile.path,
    );
    const parentDisplay = this.basenameForRenderedWikiLink(parentTarget);
    if (!this.isMarkdownFile(parentFile)) {
      new Notice(`Parent note "${parentDisplay}" not found`);
      return false;
    }

    if (parentFile.path === sourceFile.path) {
      new Notice("Project note parent points at itself");
      return false;
    }

    const children = this.collectChildNotes(sourceFile);
    if (children.length > 0) {
      new Notice(
        `Project has ${children.length} child notes; move them before converting`,
      );
      return false;
    }

    const parentBasename =
      parentFile.basename ||
      getVaultPathBasenameWithoutExtension(parentFile.path);
    const today = new Date();
    const restored = buildTaskBlockFromProjectNote(content, {
      noteBasename,
      parentBasename,
      sourcePath: sourceFile.path,
      destinationPath: parentFile.path,
    });
    if (!restored.valid) {
      new Notice(restored.error);
      return false;
    }

    let parentContent;
    try {
      parentContent = await vault.read(parentFile);
    } catch (error) {
      new Notice(`Parent note "${parentBasename}" not found`);
      return false;
    }

    const destination = parseTaskMoveDestinationFrontmatter(parentContent);
    if (!destination.valid) {
      new Notice(
        `Parent note "${parentBasename}" must be an area or open project`,
      );
      return false;
    }

    if (restored.blockId) {
      const existingIds = collectTaskMoveBlockIds(parentContent);
      if (existingIds.has(restored.blockId)) {
        new Notice(
          `Parent note already contains block ID: ${restored.blockId}`,
        );
        return false;
      }
    }

    const parentProjectBlocked =
      destination.kind === "project" &&
      projectLooksBlockedByPrjShortcut(parentContent);
    let restoredLines = [...restored.lines];
    let reversedBlockedCount = 0;
    let reversedRecoveredCount = 0;
    const sourceRows = collectProjectNoteTaskRows(content).residents;
    const sourceRowsById = new Map(
      sourceRows.filter((row) => row.blockId).map((row) => [row.blockId, row]),
    );
    const hasBlockedResidents = restoredLines
      .slice(1)
      .some((line) => taskHasProjectBlockedTag(line));
    if (hasBlockedResidents && !parentProjectBlocked) {
      const recovery = await buildInteractiveScheduledRecoverySnapshot(
        this.app,
        { sourcePath: sourceFile.path, sourceContent: content, today },
      );
      const projectBlocked = new Map(
        recovery && recovery.projectBlocked instanceof Map
          ? recovery.projectBlocked
          : [],
      );
      for (const line of restoredLines.slice(1)) {
        const blockId = getTrailingBlockId(line);
        const row = blockId ? sourceRowsById.get(blockId) : null;
        if (row) {
          projectBlocked.delete(recoveryIdentity(sourceFile.path, String(row.line)));
        }
      }
      const recoveryIndex = recovery
        ? { ...recovery, projectBlocked }
        : null;
      const markUnblockedLine = navFreshnessMarkUnblockedLine(
        this.getFreshnessApi(),
      );
      restoredLines = restoredLines.map((line, index) => {
        // Closed lines are never edited: a legacy tag on one stays put.
        if (
          index === 0 ||
          !taskHasProjectBlockedTag(line) ||
          !isOpenObsidianTaskLine(line)
        ) {
          return line;
        }
        const blockId = getTrailingBlockId(line);
        const row = blockId ? sourceRowsById.get(blockId) : null;
        const metadata = row && recoveryIndex
          ? getScheduledRecoveryMetadata(
              recoveryIndex,
              sourceFile.path,
              row.line,
            )
          : deferredScheduledRecovery("project task recovery is unavailable");
        const result = recoverProjectResidentLine(line, metadata, {
          today,
          markUnblockedLine,
          isDailyNote: Boolean(
            canonicalRecoveryDailyDate(
              normalizeVaultRelativePath(parentFile.path),
            ),
          ),
          isToday: false,
        });
        if (result.recovered) {
          reversedRecoveredCount += 1;
        }
        return result.line;
      });
    }

    if (parentProjectBlocked) {
      restoredLines = restoredLines.map((line) => {
        if (!isOpenObsidianTaskLine(line)) {
          return line;
        }
        const next = blockProjectResidentLine(line);
        if (next !== line) {
          reversedBlockedCount += 1;
        }
        return next;
      });
    }

    const finalInsertion = insertTaskMoveBlocks(
      parentContent,
      [restoredLines],
      destination.kind,
    );
    if (!finalInsertion.valid) {
      new Notice(
        `Parent note "${parentBasename}" has no ## Tasks section`,
      );
      return false;
    }

    const finalBlockIds = new Set(
      restoredLines.map((line) => getTrailingBlockId(line)).filter(Boolean),
    );
    const projectDependencyBlock = collectProjectSourceDependencyBlock(
      content,
      findProjectLifecycleTaskIndex(content),
    );
    if (!projectDependencyBlock.valid) {
      new Notice(projectDependencyBlock.error);
      return false;
    }
    const dependencyRefs = [];
    for (const target of projectDependencyBlock.targets) {
      const targetFile = target.note
        ? this.resolveLinkTargetFile(target.note, sourceFile.path)
        : sourceFile;
      if (!this.isMarkdownFile(targetFile)) {
        new Notice("A Depends-On target could not be resolved; nothing was converted");
        return false;
      }
      const targetPath = normalizeVaultRelativePath(targetFile.path);
      dependencyRefs.push({
        path:
          targetPath === normalizeVaultRelativePath(sourceFile.path) &&
          finalBlockIds.has(target.blockId)
            ? normalizeVaultRelativePath(parentFile.path)
            : targetPath,
        blockId: target.blockId,
      });
    }

    let parentContentToWrite = finalInsertion.content;
    let conversionBlocksFollowUps = [];
    if (dependencyRefs.length > 0) {
      const files = new Map([[normalizeVaultRelativePath(parentFile.path), finalInsertion.content]]);
      for (const target of dependencyRefs) {
        if (files.has(target.path)) continue;
        const targetContent = await this.readDependencyNoteContent(
          target.path,
          null,
          parentFile.path,
        );
        if (targetContent === null) {
          new Notice("A Depends-On target could not be read; nothing was converted");
          return false;
        }
        files.set(target.path, targetContent);
      }
      const plan = planDependencyEdit({
        content: finalInsertion.content,
        parentLine: finalInsertion.insertedLine,
        parentPath: parentFile.path,
        add: dependencyRefs,
        remove: [],
        files,
        vaultFiles: this.readDependencyVaultFileList(),
        resolveLinkpath: this.dependencyLinkpathResolver(),
        blocksLinesEnabled: loadBlocksLinesEnabled(),
      });
      if (!plan.ok) {
        new Notice(`Could not preserve the Depends-On line (${plan.reason}); nothing was converted`);
        return false;
      }
      for (const preparation of plan.preparations || []) {
        const prepared = await this.prepareDependencyTargetNote(
          preparation.path,
          preparation,
        );
        if (!prepared || prepared.ok !== true) {
          new Notice(`Could not prepare a Depends-On target (${prepared && prepared.reason || "target-preparation-failed"}); nothing was converted`);
          return false;
        }
      }
      parentContentToWrite = plan.nextContent;
      conversionBlocksFollowUps = plan.blocksFollowUps || [];
    }

    const classification = this.getProjectNoteBacklinkClassification(
      sourceFile,
      parentFile.path,
    );
    if (classification.otherPaths.length > 0) {
      new Notice(
        `${classification.otherPaths.length} notes link to "${noteBasename}"; update them before converting (first: ${classification.otherPaths[0]})`,
      );
      return false;
    }
    if (classification.blockRewrites.length > 0 && !restored.blockId) {
      new Notice(
        "Could not derive a task block ID for the links that point at ^prj",
      );
      return false;
    }

    // Plan `#^prj` rewrites in memory and write the parent first. Writing
    // other files before the parent (a7fafed) edited Health.md when it
    // linked to the project's `^prj`, then the parent write saw changed
    // content and aborted with dangling links. A rewrite failure still
    // aborts before any write.
    const parentPath = normalizeVaultRelativePath(parentFile.path);
    const rewriteContents = new Map();
    let rewriteReadFailed = false;
    if (classification.blockRewrites.length > 0) {
      for (const rewrite of classification.blockRewrites) {
        const path = normalizeVaultRelativePath(rewrite.path);
        if (!path) {
          rewriteReadFailed = true;
          break;
        }
        if (path === parentPath) {
          rewriteContents.set(path, parentContentToWrite);
          continue;
        }
        const file =
          vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
        if (!this.isMarkdownFile(file)) {
          rewriteReadFailed = true;
          break;
        }
        try {
          rewriteContents.set(path, String((await vault.read(file)) || ""));
        } catch (_error) {
          rewriteReadFailed = true;
          break;
        }
      }
    }
    let rewritePlan = {
      updatedLinkCount: 0,
      failedLinkCount: rewriteReadFailed ? 1 : 0,
      failed: rewriteReadFailed,
      changes: [],
    };
    if (classification.blockRewrites.length > 0 && !rewriteReadFailed) {
      rewritePlan = planBlockIdLinkContentRewrites(
        classification.blockRewrites,
        parentBasename,
        restored.blockId,
        rewriteContents,
      );
    }
    const updatedLinkCount = rewritePlan.updatedLinkCount;
    if (classification.blockRewrites.length > 0 && rewritePlan.failed) {
      new Notice(
        `Could not update every link to "^prj" (${rewritePlan.failedLinkCount} failed); nothing was converted`,
      );
      return false;
    }
    const parentRewrite = rewritePlan.changes.find(
      (change) => change.path === parentPath,
    );
    if (parentRewrite) {
      parentContentToWrite = parentRewrite.after;
    }

    const sameNoteBlocks = planProjectReverseSameNoteBlocks({
      content: parentContentToWrite,
      parentPath,
      projectPath: sourceFile.path,
      restoredBlockId: restored.blockId,
      restoredTaskLine: restoredLines[0],
      dependencies: dependencyRefs,
      vaultFiles: this.readDependencyVaultFileList(),
      resolveLinkpath: this.dependencyLinkpathResolver(),
      blocksLinesEnabled: loadBlocksLinesEnabled(),
    });
    if (!sameNoteBlocks.ok) {
      new Notice("Could not update a prerequisite's BLOCKS line; nothing was converted");
      return false;
    }
    parentContentToWrite = sameNoteBlocks.content;

    let dailyCleanup = null;
    let dailyCleanupSnapshot = null;
    if (parentProjectBlocked) {
      dailyCleanupSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: parentFile.path,
        sourceContent: parentContent,
        today,
      });
      const targets = [
        { path: sourceFile.path, blockId: "prj" },
        restored.blockId
          ? { path: parentFile.path, blockId: restored.blockId }
          : null,
        ...restoredLines
          .filter((line) => isOpenObsidianTaskLine(line) && taskHasProjectBlockedTag(line))
          .map((line) => getTrailingBlockId(line))
          .filter(Boolean)
          .map((blockId) => ({ path: parentFile.path, blockId })),
      ].filter(Boolean);
      if (dailyCleanupSnapshot && targets.length > 0) {
        const dailyPath = normalizeVaultRelativePath(
          dailyCleanupSnapshot.dailyPath,
        );
        const dailyRewrite = rewritePlan.changes.find(
          (change) => change.path === dailyPath,
        );
        const dailyContent = dailyCleanupSnapshot.sameFile
          ? parentContentToWrite
          : dailyRewrite
            ? dailyRewrite.after
            : dailyCleanupSnapshot.content;
        dailyCleanup = planDeferredPomodoroLinkCleanup(
          dailyContent,
          targets,
          {
            dailyPath: dailyCleanupSnapshot.dailyPath,
            noteIndex: dailyCleanupSnapshot.noteIndex,
          },
        );
        if (dailyCleanup.changed) {
          if (dailyCleanupSnapshot.sameFile) {
            parentContentToWrite = dailyCleanup.content;
          } else if (dailyRewrite) {
            dailyRewrite.after = dailyCleanup.content;
          }
        }
      }
    }

    let wroteParent = false;
    try {
      await vault.process(parentFile, (current) => {
        if (current !== parentContent) {
          return current;
        }
        wroteParent = true;
        return parentContentToWrite;
      });
    } catch (error) {
      new Notice("Could not update the parent note");
      return false;
    }

    if (!wroteParent) {
      new Notice("Parent note changed; nothing was converted");
      return false;
    }
    await this.finishBlocksFollowUps(conversionBlocksFollowUps);

    // Post-write link rewrites report their failures instead of rolling the
    // parent back (§13.10): when any failed, the project note is kept for a
    // retry and the notice says so.
    const postWriteRewrites = await applyPlannedBlockIdLinkRewrites({
      vault,
      isMarkdownFile: (file) => this.isMarkdownFile(file),
      changes: rewritePlan.changes,
      parentPath,
      plannedLinksByPath: countPlannedRewriteLinksByPath(
        classification.blockRewrites,
        parentPath,
      ),
    });
    const postWriteFailedLinkCount = postWriteRewrites.failedLinkCount;
    const postWriteFailedPaths = postWriteRewrites.failedPaths;

    const dailyPath = dailyCleanupSnapshot
      ? normalizeVaultRelativePath(dailyCleanupSnapshot.dailyPath)
      : null;
    const dailyHandledInRewrites =
      Boolean(dailyPath) &&
      rewritePlan.changes.some((change) => change.path === dailyPath);
    if (postWriteFailedLinkCount > 0) {
      let keptNotice =
        `Restored the task in ${parentBasename}, but ${postWriteFailedLinkCount} ` +
        `${postWriteFailedLinkCount === 1 ? "link" : "links"} could not be updated; ` +
        `"${noteBasename}" was kept`;
      if (
        dailyCleanup &&
        dailyCleanup.changed &&
        dailyCleanupSnapshot &&
        !dailyCleanupSnapshot.sameFile &&
        dailyHandledInRewrites &&
        dailyPath &&
        postWriteFailedPaths.has(dailyPath)
      ) {
        keptNotice += " · Pomodoro links not removed";
      }
      new Notice(keptNotice);
      return true;
    }
    const dailyCleanupFailed =
      dailyCleanup && dailyCleanup.changed && dailyCleanupSnapshot &&
      !dailyCleanupSnapshot.sameFile && !dailyHandledInRewrites
        ? !(await this.writeDeferredPomodoroCleanup(
            dailyCleanupSnapshot,
            dailyCleanup,
          ))
        : false;

    await this.focusTaskMoveDestination(parentFile, {
      line: finalInsertion.insertedLine,
      text: restoredLines[0],
      blockId: restored.blockId,
    });

    try {
      if (
        !this.app.fileManager ||
        typeof this.app.fileManager.trashFile !== "function"
      ) {
        throw new Error("trash unavailable");
      }
      await this.app.fileManager.trashFile(sourceFile);
    } catch (error) {
      new Notice(
        `Restored the task in ${parentBasename}, but could not delete "${noteBasename}"`,
      );
      return true;
    }

    let notice = getProjectNoteToTaskNoticeText(
      noteBasename,
      parentBasename,
      restored.taskCount,
      restored.sectionCount,
      updatedLinkCount,
      reversedBlockedCount,
      reversedRecoveredCount,
    );
    if (dailyCleanupFailed) notice += " · Pomodoro links not removed";
    new Notice(notice);
    return true;
  }
}
