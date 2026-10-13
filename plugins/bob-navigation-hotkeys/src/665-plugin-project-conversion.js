class BobNavigationHotkeysProjectConversionMixin {

  async createProjectNoteFromTask(editor, view) {
    const sourceFile = view && view.file;
    if (!editor || !this.isMarkdownFile(sourceFile)) {
      new Notice(
        "Open an area or project note before creating a project from a task",
      );
      return false;
    }

    if (!this.isAreaOrProjectNote(sourceFile)) {
      new Notice(
        "Project notes can only be created from an area or project note",
      );
      return false;
    }

    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on an open #task checkbox");
      return false;
    }

    const lineText = getEditorLineText(editor, cursor.line);
    if (lineText === null) {
      new Notice("Place the cursor on an open #task checkbox");
      return false;
    }

    if (
      isProjectLifecycleTaskLine(lineText) &&
      isProjectLifecycleTaskAtLine(editor.getValue(), cursor.line)
    ) {
      return this.convertProjectNoteToTask(editor, view, cursor, lineText);
    }

    const parsedTask = parseProjectSourceTaskLine(lineText);
    if (!parsedTask) {
      new Notice(getProjectSourceTaskLineNoticeText(lineText));
      return false;
    }
    if (parsedTask.scheduleError) {
      new Notice(parsedTask.scheduleError);
      return false;
    }

    if (!this.app.vault || typeof this.app.vault.process !== "function") {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    const sourceBlock = getProjectSourceTaskBlock(
      editor,
      cursor.line,
      lineText,
    ) || {
      startLine: cursor.line,
      endLineExclusive: cursor.line + 1,
      lines: [lineText],
      childLines: [],
    };

    const sourceDependencyBlock = collectProjectSourceDependencyBlock(
      sourceBlock.lines.join("\n"),
      0,
    );
    if (!sourceDependencyBlock.valid) {
      new Notice(sourceDependencyBlock.error);
      return false;
    }
    const sourceChildLines = sourceBlock.childLines.filter(
      (_line, index) => !sourceDependencyBlock.lineIndices.includes(index + 1),
    );

    const createdDate = formatProjectTaskCreatedDate(new Date());
    let convertedChildTaskLines = [];
    let convertedChildSections = [];
    let convertedManagedLogLines = [];
    let childConversionLossy = false;
    const hasChildContent = sourceChildLines.some(
      (line) => String(line || "").trim() !== "",
    );
    if (hasChildContent) {
      const conversion = buildProjectSeedFromChildBullets(
        sourceChildLines,
        createdDate,
      );
      if (
        conversion.lossless &&
        (conversion.taskLines.length > 0 ||
          conversion.sections.length > 0 ||
          conversion.managedLogLines.length > 0)
      ) {
        convertedChildTaskLines = conversion.taskLines;
        convertedChildSections = conversion.sections;
        convertedManagedLogLines = conversion.managedLogLines;
      } else {
        childConversionLossy = true;
      }
    }

    const sourceBasename =
      sourceFile.basename ||
      getVaultPathBasenameWithoutExtension(sourceFile.path);
    let projectBasename = null;
    let blockIdBacklinkRewrites = [];
    if (parsedTask.blockId) {
      projectBasename = getProjectBasenameFromTaskBlockId(
        sourceBasename,
        parsedTask.blockId,
      );
      if (!projectBasename) {
        new Notice("Could not derive project note name from task block ID");
        return false;
      }

      if (this.projectNoteBasenameExists(projectBasename, sourceFile)) {
        new Notice(`Note "${projectBasename}" already exists; rename it first`);
        return false;
      }

      blockIdBacklinkRewrites = this.getProjectTaskBlockIdBacklinkRewrites(
        sourceFile,
        parsedTask.blockId,
      );
    }

    if (!view || typeof view.save !== "function") {
      new Notice("Could not save source note");
      return false;
    }

    try {
      await view.save();
    } catch (error) {
      new Notice("Could not save source note");
      return false;
    }

    const createdFile = await this.createProjectNoteFile(
      sourceFile,
      projectBasename || undefined,
    );
    if (!createdFile) {
      return false;
    }

    let seedResult = null;
    try {
      await this.app.vault.process(createdFile, (content) => {
        seedResult = buildProjectContentFromTask(content, parsedTask, {
          projectPath: createdFile.path,
          today: new Date(),
          childTaskLines: convertedChildTaskLines,
          sections: convertedChildSections,
          managedLogLines: convertedManagedLogLines,
        });
        return seedResult.content;
      });
    } catch (error) {
      new Notice("Could not seed project task");
      return false;
    }

    if (!seedResult || !seedResult.seeded) {
      new Notice("Project task placeholder not found; source task was kept");
      return true;
    }

    if (convertedChildTaskLines.length > 0 && !seedResult.tasksInserted) {
      new Notice(
        "Created project, but the Tasks section was missing; source task was kept",
      );
      return true;
    }

    if (
      convertedManagedLogLines.length > 0 &&
      !seedResult.managedLogsInserted
    ) {
      new Notice(
        "Created project, but the task logs could not be added; source task was kept",
      );
      return true;
    }

    const sectionsHandled =
      (seedResult.sectionsInserted || 0) + (seedResult.sectionsCreated || 0);
    if (
      convertedChildSections.length > 0 &&
      sectionsHandled < convertedChildSections.length
    ) {
      new Notice(
        "Created project, but a section could not be added; source task was kept",
      );
      return true;
    }

    if (childConversionLossy) {
      new Notice(
        "Created project, but child bullets could not be converted; source task was kept",
      );
      return true;
    }

    const sourcePath = normalizeVaultRelativePath(sourceFile.path);
    const childBlockIds = new Set(
      convertedChildTaskLines
        .map((line) => getTrailingBlockId(line))
        .filter(Boolean),
    );
    const dependencyRefs = [];
    let droppedResidentDependencyCount = 0;
    for (const target of sourceDependencyBlock.targets) {
      const targetFile = target.note
        ? this.resolveLinkTargetFile(target.note, sourceFile.path)
        : sourceFile;
      if (!this.isMarkdownFile(targetFile)) {
        new Notice("A Depends-On target could not be resolved; the source task was kept");
        return true;
      }
      const targetPath = normalizeVaultRelativePath(targetFile.path);
      if (
        targetPath === sourcePath &&
        (childBlockIds.has(target.blockId) || target.blockId === parsedTask.blockId)
      ) {
        droppedResidentDependencyCount += 1;
        continue;
      }
      dependencyRefs.push({ path: targetPath, blockId: target.blockId });
    }

    let projectContent = seedResult.content;
    if (dependencyRefs.length > 0) {
      const files = new Map([[createdFile.path, projectContent]]);
      for (const target of dependencyRefs) {
        if (files.has(target.path)) continue;
        if (target.path === sourcePath) {
          files.set(target.path, String(editor.getValue() || ""));
          continue;
        }
        const targetContent = await this.readDependencyNoteContent(
          target.path,
          null,
          createdFile.path,
        );
        if (targetContent === null) {
          new Notice("A Depends-On target could not be read; the source task was kept");
          return true;
        }
        files.set(target.path, targetContent);
      }
      const projectLine = findProjectLifecycleTaskIndex(projectContent);
      const dependencyPlan = planDependencyEdit({
        content: projectContent,
        parentLine: projectLine,
        parentPath: createdFile.path,
        add: dependencyRefs,
        remove: [],
        files,
        vaultFiles: [
          ...(this.readDependencyVaultFileList() || []),
          normalizeVaultRelativePath(createdFile.path),
        ],
        resolveLinkpath: this.dependencyLinkpathResolver(),
        // Design §5: the seed may already have flipped residents to `[?]`
        // (future inline date), so transfer reads their pre-seed lanes.
        projectLaneStatuses: [
          parsedTask.status,
          ...convertedChildTaskLines.map((line) =>
            getObsidianTaskCheckboxStatus(String(line || ""))
          ),
        ],
      });
      if (!dependencyPlan.ok) {
        new Notice(`Could not preserve the Depends-On line (${dependencyPlan.reason}); the source task was kept`);
        return true;
      }
      if (dependencyPlan.changed) {
        let committed = false;
        for (const preparation of dependencyPlan.preparations || []) {
          const prepared = await this.prepareDependencyTargetNote(
            preparation.path,
            preparation,
          );
          if (!prepared || prepared.ok !== true) {
            new Notice(`Could not prepare a Depends-On target (${prepared && prepared.reason || "target-preparation-failed"}); the source task was kept`);
            return true;
          }
        }
        try {
          await this.app.vault.process(createdFile, (current) => {
            if (String(current || "") !== projectContent) return current;
            committed = true;
            return dependencyPlan.nextContent;
          });
        } catch (_error) {
          committed = false;
        }
        if (!committed) {
          new Notice("Could not finish the Depends-On write; the source task was kept");
          return true;
        }
        projectContent = dependencyPlan.nextContent;
      }
    }

    const projectIsBlocked = projectLooksBlockedByPrjShortcut(projectContent);
    let dailyCleanupFailed = false;
    let sameFileCleanup = null;
    if (projectIsBlocked && (parsedTask.blockId || childBlockIds.size > 0)) {
      const snapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath,
        sourceContent: String(editor.getValue() || ""),
        today: new Date(),
      });
      const targets = [parsedTask.blockId, ...childBlockIds]
        .filter(Boolean)
        .map((blockId) => ({
        path: sourcePath,
        blockId,
        }));
      if (snapshot) {
        const dailyContent = snapshot.sameFile
          ? String(editor.getValue() || "")
          : snapshot.content;
        const cleanup = planDeferredPomodoroLinkCleanup(
          dailyContent,
          targets,
          {
            dailyPath: snapshot.dailyPath,
            noteIndex: snapshot.noteIndex,
            removeEmptiedEntries: true,
          },
        );
        if (cleanup.changed) {
          if (snapshot.sameFile) {
            sameFileCleanup = {
              targets,
              dailyPath: snapshot.dailyPath,
              noteIndex: snapshot.noteIndex,
            };
          } else {
            dailyCleanupFailed = !(await this.writeDeferredPomodoroCleanup(
              snapshot,
              cleanup,
            ));
          }
        }
      }
    }

    let updatedLinkCount = 0;
    if (parsedTask.blockId) {
      let expanded = false;
      if (!projectIsBlocked) {
        const promotionPlan = planProjectPromotionTargets(projectContent);
        if (promotionPlan.error) {
          new Notice(
            `Created project, but ${promotionPlan.error}; source task was kept`,
          );
          return true;
        }
        const promotionToday =
          this.promotionTodayForTests instanceof Date
            ? this.promotionTodayForTests
            : new Date();
        const expansionResult = await this.applyProjectPromotionBacklinkExpansion(
          {
            sourceFile,
            createdFile,
            sourceBlockId: parsedTask.blockId,
            seedContent: projectContent,
            promotionPlan,
            blockIdBacklinkRewrites,
            today: promotionToday,
          },
        );
        if (expansionResult.expanded) {
          expanded = true;
          updatedLinkCount = expansionResult.updatedLinkCount;
          if (expansionResult.failed) {
            if (expansionResult.error) {
              new Notice(
                `Created project, but ${expansionResult.error}; source task was kept`,
              );
            } else {
              const linkText =
                expansionResult.failedLinkCount === 1 ? "link" : "links";
              new Notice(
                `Created project, but ${expansionResult.failedLinkCount} block ${linkText} could not be updated; source task was kept`,
              );
            }
            return true;
          }
        }
      }
      if (!expanded && blockIdBacklinkRewrites.length > 0) {
        const rewriteResult = await this.applyBlockIdLinkRewrites(
          blockIdBacklinkRewrites,
          createdFile.basename,
        );
        updatedLinkCount = rewriteResult.updatedLinkCount;
        if (rewriteResult.failed) {
          const linkText =
            rewriteResult.failedLinkCount === 1 ? "link" : "links";
          new Notice(
            `Created project, but ${rewriteResult.failedLinkCount} block ${linkText} could not be updated; source task was kept`,
          );
          return true;
        }
      }
    }

    let removedSourceTask = false;
    try {
      await this.app.vault.process(sourceFile, (content) => {
        const base = sameFileCleanup
          ? planDeferredPomodoroLinkCleanup(
              content,
              sameFileCleanup.targets,
              {
                dailyPath: sameFileCleanup.dailyPath,
                noteIndex: sameFileCleanup.noteIndex,
                removeEmptiedEntries: true,
              },
            ).content
          : content;
        const result = removeTaskBlockFromContent(base, sourceBlock);
        removedSourceTask = result.removed;
        return result.content;
      });
    } catch (error) {
      new Notice("Created project, but could not remove the source task");
      return true;
    }

    if (!removedSourceTask) {
      new Notice(
        "Created project, but the source task changed and was not removed",
      );
      return true;
    }

    let notice = getProjectFromTaskNoticeText(
        parsedTask.description,
        sourceBasename,
        projectBasename ? createdFile.basename : undefined,
        updatedLinkCount,
        sectionsHandled,
        convertedManagedLogLines
          .map((line) => {
            const parsed = parseManagedTaskLogParentBullet(line);
            return parsed ? parsed.kind : null;
          })
          .filter(Boolean),
      );
    if (droppedResidentDependencyCount > 0) {
      notice += ` · dropped ${formatCountLabel(droppedResidentDependencyCount, "prerequisite")} that became project residents`;
    }
    if (dailyCleanupFailed) notice += " · Pomodoro links not removed";
    new Notice(notice);
    return true;
  }

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
            removeEmptiedEntries: true,
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

    for (const change of rewritePlan.changes) {
      if (change.path === parentPath) {
        continue;
      }
      const file =
        vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(change.path)
          : null;
      if (!this.isMarkdownFile(file)) {
        continue;
      }
      try {
        await vault.process(file, (current) =>
          current === change.before ? change.after : current,
        );
      } catch (_error) {
        // Post-write rewrite failures do not roll the parent back.
      }
    }

    const dailyPath = dailyCleanupSnapshot
      ? normalizeVaultRelativePath(dailyCleanupSnapshot.dailyPath)
      : null;
    const dailyHandledInRewrites =
      Boolean(dailyPath) &&
      rewritePlan.changes.some((change) => change.path === dailyPath);
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
