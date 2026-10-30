// Forward promotion: task -> project with successor offers
// (plan:202610/promotion_successor_offers.md). Pure planning lives in
// 122-project-promotion-successors.js; this mixin owns vault orchestration.

class BobNavigationHotkeysProjectPromotionMixin {

  async createProjectNoteFromTask(editor, view) {
    const sourceFile = view && view.file;
    if (!editor || !this.isMarkdownFile(sourceFile)) {
      new Notice("Open an area or project note before creating a project from a task");
      return false;
    }
    if (!this.isAreaOrProjectNote(sourceFile)) {
      new Notice("Project notes can only be created from an area or project note");
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
    if (isProjectLifecycleTaskLine(lineText) && isProjectLifecycleTaskAtLine(editor.getValue(), cursor.line)) {
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
    const sourceBlock = getProjectSourceTaskBlock(editor, cursor.line, lineText) || {
      startLine: cursor.line,
      endLineExclusive: cursor.line + 1,
      lines: [lineText],
      childLines: [],
    };
    const sourceDependencyBlock = collectProjectSourceDependencyBlock(sourceBlock.lines.join("\n"), 0);
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
    const hasChildContent = sourceChildLines.some((line) => String(line || "").trim() !== "");
    if (hasChildContent) {
      const conversion = buildProjectSeedFromChildBullets(sourceChildLines, createdDate);
      if (conversion.lossless && (conversion.taskLines.length > 0 || conversion.sections.length > 0 || conversion.managedLogLines.length > 0)) {
        convertedChildTaskLines = conversion.taskLines;
        convertedChildSections = conversion.sections;
        convertedManagedLogLines = conversion.managedLogLines;
      } else {
        childConversionLossy = true;
      }
    }
    if (childConversionLossy) {
      new Notice("Child bullets could not be converted; nothing was promoted");
      return false;
    }
    const sourceBasename = sourceFile.basename || getVaultPathBasenameWithoutExtension(sourceFile.path);
    let projectBasename = null;
    let blockIdBacklinkRewrites = [];
    if (parsedTask.blockId) {
      projectBasename = getProjectBasenameFromTaskBlockId(sourceBasename, parsedTask.blockId);
      if (!projectBasename) {
        new Notice("Could not derive project note name from task block ID");
        return false;
      }
      if (this.projectNoteBasenameExists(projectBasename, sourceFile)) {
        new Notice(`Note "${projectBasename}" already exists; rename it first`);
        return false;
      }
      blockIdBacklinkRewrites = this.getProjectTaskBlockIdBacklinkRewrites(sourceFile, parsedTask.blockId);
    }
    const sourcePath = normalizeVaultRelativePath(sourceFile.path);
    const childBlockIds = new Set(convertedChildTaskLines.map((line) => getTrailingBlockId(line)).filter(Boolean));
    const dependencyRefs = [];
    let droppedResidentDependencyCount = 0;
    for (const target of sourceDependencyBlock.targets) {
      const targetFile = target.note ? this.resolveLinkTargetFile(target.note, sourceFile.path) : sourceFile;
      if (!this.isMarkdownFile(targetFile)) {
        new Notice("A Depends-On target could not be resolved; nothing was promoted");
        return false;
      }
      const targetPath = normalizeVaultRelativePath(targetFile.path);
      if (targetPath === sourcePath && (childBlockIds.has(target.blockId) || target.blockId === parsedTask.blockId)) {
        droppedResidentDependencyCount += 1;
        continue;
      }
      dependencyRefs.push({ path: targetPath, blockId: target.blockId });
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
    const sourceSnapshot = String(editor && typeof editor.getValue === "function" ? editor.getValue() : "");
    const createdFile = await this.createProjectNoteFile(sourceFile, projectBasename || undefined, { open: false });
    if (!createdFile) return false;
    const createdPath = normalizeVaultRelativePath(createdFile.path);
    const trashCreated = async () => {
      try {
        if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") {
          await this.app.fileManager.trashFile(createdFile);
          return true;
        }
      } catch (_error) {
        return false;
      }
      return false;
    };
    const failBeforeReference = async (message) => {
      const trashed = await trashCreated();
      new Notice(trashed ? `${message}; nothing was promoted` : `${message}; delete ${createdFile.basename} before retrying`);
      return true;
    };
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
      await failBeforeReference("Could not seed project task");
      return true;
    }
    if (!seedResult || !seedResult.seeded) {
      await failBeforeReference("Project task placeholder not found");
      return true;
    }
    if (convertedChildTaskLines.length > 0 && !seedResult.tasksInserted) {
      await failBeforeReference("The Tasks section was missing");
      return true;
    }
    if (convertedManagedLogLines.length > 0 && !seedResult.managedLogsInserted) {
      await failBeforeReference("The task logs could not be added");
      return true;
    }
    const sectionsHandled = (seedResult.sectionsInserted || 0) + (seedResult.sectionsCreated || 0);
    if (convertedChildSections.length > 0 && sectionsHandled < convertedChildSections.length) {
      await failBeforeReference("A section could not be added");
      return true;
    }
    let projectContent = seedResult.content;
    if (dependencyRefs.length > 0) {
      const files = new Map([[createdFile.path, projectContent]]);
      for (const target of dependencyRefs) {
        if (files.has(target.path)) continue;
        if (target.path === sourcePath) {
          files.set(target.path, sourceSnapshot);
          continue;
        }
        const targetContent = await this.readDependencyNoteContent(target.path, null, createdFile.path);
        if (targetContent === null) {
          await failBeforeReference("A Depends-On target could not be read");
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
        vaultFiles: [...(this.readDependencyVaultFileList() || []), createdPath],
        resolveLinkpath: this.dependencyLinkpathResolver(),
        blocksLinesEnabled: loadBlocksLinesEnabled(),
        projectLaneStatuses: [parsedTask.status, ...convertedChildTaskLines.map((line) => getObsidianTaskCheckboxStatus(String(line || "")))],
      });
      if (!dependencyPlan.ok) {
        await failBeforeReference(`Could not preserve the Depends-On line (${dependencyPlan.reason})`);
        return true;
      }
      if (dependencyPlan.changed) {
        let committed = false;
        for (const preparation of dependencyPlan.preparations || []) {
          const prepared = await this.prepareDependencyTargetNote(preparation.path, preparation);
          if (!prepared || prepared.ok !== true) {
            await failBeforeReference(`Could not prepare a Depends-On target (${prepared && prepared.reason || "target-preparation-failed"})`);
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
          await failBeforeReference("Could not finish the Depends-On write");
          return true;
        }
        projectContent = dependencyPlan.nextContent;
        await this.finishBlocksFollowUps(dependencyPlan.blocksFollowUps);
      }
    }
    const projectIsBlocked = projectLooksBlockedByPrjShortcut(projectContent);
    const promotionToday = this.promotionTodayForTests instanceof Date ? this.promotionTodayForTests : new Date();
    let vaultFiles = [];
    try {
      vaultFiles = (this.app.vault.getMarkdownFiles && this.app.vault.getMarkdownFiles()) || [];
    } catch (_error) {
      vaultFiles = [];
    }
    const fileIndex = createProjectPromotionLinkIndex(vaultFiles);
    const readNoteByPath = async (lookupPath) => {
      const normalized = normalizeVaultRelativePath(lookupPath);
      const buffers = getOpenMarkdownBufferContents(this.app);
      if (buffers && !buffers.ambiguous && buffers.has(normalized)) return String(buffers.get(normalized) || "");
      const editorForPath = this.getOpenMarkdownEditorForPath(normalized);
      if (editorForPath && typeof editorForPath.getValue === "function") return String(editorForPath.getValue() || "");
      const file = vaultFiles.find((candidate) => normalizeVaultRelativePath(candidate.path) === normalized)
        || (this.app.vault.getAbstractFileByPath ? this.app.vault.getAbstractFileByPath(normalized) : null);
      if (!file) return null;
      try {
        if (typeof this.app.vault.cachedRead === "function") return String((await this.app.vault.cachedRead(file)) || "");
        return String((await this.app.vault.read(file)) || "");
      } catch (_error) {
        return null;
      }
    };
    const eligibleDailyPaths = vaultFiles
      .map((file) => normalizeVaultRelativePath(file.path))
      .filter((filePath) => filePath && isProjectPromotionEligibleDailyPath(filePath, promotionToday));
    const plannedByPath = new Map();
    let anchor = null;
    if (parsedTask.blockId) {
      for (const dailyPath of eligibleDailyPaths) {
        const dailyText = await readNoteByPath(dailyPath);
        if (typeof dailyText !== "string") continue;
        const links = findPromotionPlannedLinks(dailyText, dailyPath, {
          sourcePath,
          sourceBlockId: parsedTask.blockId,
          fileIndex,
        });
        if (links.length > 0) plannedByPath.set(dailyPath, { text: dailyText, links });
      }
      const isTodayPath = (dailyPath) => {
        try {
          const daily = canonicalRecoveryDailyDate(dailyPath);
          const base = getLocalDateStart(promotionToday);
          const todayValue = base.getFullYear() * 10000 + (base.getMonth() + 1) * 100 + base.getDate();
          return Boolean(daily && daily.value === todayValue);
        } catch (_error) {
          return false;
        }
      };
      const orderedPaths = [...plannedByPath.keys()].sort();
      const todayPaths = orderedPaths.filter(isTodayPath);
      const searchPaths = todayPaths.length > 0 ? todayPaths : orderedPaths;
      for (const dailyPath of searchPaths) {
        const entry = plannedByPath.get(dailyPath);
        const sorted = entry.links.slice().sort((a, b) => a.entryLine - b.entryLine || a.bulletLine - b.bulletLine);
        if (sorted.length > 0) {
          anchor = { ...sorted[0], dailyPath };
          break;
        }
      }
    }
    let picks = null;
    let offerPlan = null;
    let liveLinkedChildIds = new Set();
    if (anchor && !projectIsBlocked && parsedTask.blockId) {
      for (const [, entry] of plannedByPath) {
        for (const link of entry.links) {
          void link;
        }
      }
      const anchorText = (plannedByPath.get(anchor.dailyPath) || {}).text || "";
      const childIdOccurrences = new Map();
      try {
        const lines = anchorText.split(/\r?\n/);
        for (const line of lines) {
          for (const occurrence of collectPomodoroBlockLinkOccurrences(String(line || ""))) {
            if (occurrence.struck) continue;
            const resolved = resolveProjectPromotionLinkTarget(occurrence.target, anchor.dailyPath, fileIndex);
            if (resolved && normalizeVaultRelativePath(resolved) === sourcePath && childBlockIds.has(occurrence.blockId)) {
              liveLinkedChildIds.add(occurrence.blockId);
            }
          }
        }
      } catch (_error) {
        liveLinkedChildIds = new Set();
      }
      const projectDescription = (() => {
        try {
          const rows = collectProjectNoteTaskRows(projectContent);
          const prj = rows.prj[0];
          return prj ? cleanTaskDisplayText(prj.text) : "";
        } catch (_error) {
          return "";
        }
      })();
      offerPlan = planPromotionSuccessorRows(projectContent, {
        projectPath: createdPath,
        today: promotionToday,
        liveLinkedIds: liveLinkedChildIds,
        destinationLabel: anchor.destinationLabel || "",
      });
      const selectableCount = offerPlan.rows.filter((row) => row.selectable).length;
      if (selectableCount > 0) {
        const header = projectDescription;
        const model = buildPromotionSuccessorModel(offerPlan, {
          sourcePath,
          sourceBlockId: parsedTask.blockId,
          sourceDescription: parsedTask.description || "",
          projectPath: createdPath,
          projectDescription: header,
          destinationLabel: anchor.destinationLabel || "",
        });
        if (model) {
          try {
            const result = await this.pickSuccessorOffers(model, { retarget: false });
            picks = result && Array.isArray(result.picks) ? result.picks : null;
          } catch (_error) {
            picks = null;
          }
        }
      }
    }
    const pickedKeys = new Set((picks || []).map((pick) => pick.key));
    const pickedRows = offerPlan ? offerPlan.rows.filter((row) => pickedKeys.has(row.key)) : [];
    const revalidateSource = await readNoteByPath(sourcePath);
    if (typeof revalidateSource !== "string") {
      await failBeforeReference("Source task changed while choosing");
      return true;
    }
    try {
      const check = removeTaskBlockFromContent(revalidateSource, sourceBlock);
      if (!check.removed) {
        await failBeforeReference("Source task changed while choosing");
        return true;
      }
    } catch (_error) {
      await failBeforeReference("Source task changed while choosing");
      return true;
    }
    let refusedCount = 0;
    let projectApplied = projectContent;
    let mintedByKey = new Map();
    if (pickedRows.length > 0) {
      try {
        const applied = this.applyPromotionSuccessorPicks(projectContent, pickedRows, {
          createdPath,
          today: promotionToday,
        });
        if (!applied) {
          await failBeforeReference("Project tasks could not be linked");
          return true;
        }
        if (applied.refused > 0) refusedCount = applied.refused;
        mintedByKey = applied.mintedByKey instanceof Map ? applied.mintedByKey : new Map();
        projectApplied = applied.content;
      } catch (_error) {
        await failBeforeReference("Project tasks could not be linked");
        return true;
      }
      if (projectApplied === null) {
        await failBeforeReference("Project tasks could not be linked");
        return true;
      }
    }
    if (pickedRows.length > 0 || projectApplied !== projectContent) {
      let committed = false;
      const beforeProject = projectContent;
      try {
        await this.app.vault.process(createdFile, (current) => {
          if (String(current || "") !== beforeProject) throw new Error("project changed");
          committed = true;
          return projectApplied;
        });
      } catch (_error) {
        const freshProject = await readNoteByPath(createdPath);
        if (typeof freshProject !== "string") {
          await failBeforeReference("Project tasks could not be linked");
          return true;
        }
        let reapplied = null;
        try {
          reapplied = this.applyPromotionSuccessorPicks(freshProject, pickedRows, { createdPath, today: promotionToday });
        } catch (_retryError) {
          reapplied = null;
        }
        if (!reapplied) {
          await failBeforeReference("Project tasks could not be linked");
          return true;
        }
        if (reapplied.refused > 0) refusedCount += reapplied.refused;
        for (const [key, id] of reapplied.mintedByKey) {
          if (!mintedByKey.has(key)) mintedByKey.set(key, id);
        }
        try {
          await this.app.vault.process(createdFile, (current) => {
            if (String(current || "") !== freshProject) throw new Error("project changed");
            committed = true;
            return reapplied.content;
          });
        } catch (_retryError) {
          await failBeforeReference("Project tasks could not be linked");
          return true;
        }
        if (!committed) {
          await failBeforeReference("Project tasks could not be linked");
          return true;
        }
        projectContent = reapplied.content;
        projectApplied = reapplied.content;
      }
      if (!committed) {
        await failBeforeReference("Project tasks could not be linked");
        return true;
      }
      projectContent = projectApplied;
    }
    const childIdsForHistory = [...childBlockIds];
    const ledgerResults = [];
    if (parsedTask.blockId) {
      const anchorDailyPath = anchor ? anchor.dailyPath : null;
      const pathsToWrite = new Set([...plannedByPath.keys()]);
      for (const dailyPath of [...pathsToWrite].sort()) {
        const entry = plannedByPath.get(dailyPath);
        const before = entry.text;
        let after = before;
        let anchorReplacement = null;
        if (dailyPath === anchorDailyPath && pickedRows.length > 0) {
          anchorReplacement = this.planPromotionAnchorReplacement(before, anchor, pickedRows, {
            projectPath: createdPath,
            fileIndex,
            anchorLabel: anchor.destinationLabel || "",
            mintedByKey,
          });
          if (anchorReplacement) after = anchorReplacement.content;
        }
        const isAnchorFile = dailyPath === anchorDailyPath;
        const consumeTargets = [{ path: sourcePath, blockId: parsedTask.blockId }];
        if (!projectIsBlocked) {
          for (const childId of childBlockIds) consumeTargets.push({ path: sourcePath, blockId: childId });
        }
        let consumed = after;
        if (isAnchorFile && anchorReplacement) {
          consumed = this.consumePromotionPlannedLinksExceptAnchor(after, anchor, consumeTargets, { dailyPath, sourcePath, sourceBlockId: parsedTask.blockId, fileIndex });
        } else {
          consumed = this.consumeAllPromotionPlannedLinks(after, consumeTargets, { dailyPath, sourcePath, sourceBlockId: parsedTask.blockId, fileIndex });
        }
        after = consumed;
        if (!projectIsBlocked && pickedRows.length > 0) {
          after = this.repointPromotionChildLinks(after, dailyPath, {
            sourcePath,
            projectPath: createdPath,
            childIds: childBlockIds,
            fileIndex,
          });
        }
        const history = planPromotionHistoryRewrites(after, dailyPath, {
          sourcePath,
          sourceBlockId: parsedTask.blockId,
          projectBasename: createdFile.basename,
          childBlockIds: childIdsForHistory,
          fileIndex,
        });
        after = history.content;
        if (after === before) continue;
        const file = vaultFiles.find((candidate) => normalizeVaultRelativePath(candidate.path) === dailyPath)
          || (this.app.vault.getAbstractFileByPath ? this.app.vault.getAbstractFileByPath(dailyPath) : null);
        const writeOnce = async (expectedBefore, nextAfter) => {
          await this.writeProjectPromotionFileChange(dailyPath, file, expectedBefore, nextAfter);
        };
        try {
          await writeOnce(before, after);
        } catch (_error) {
          const fresh = await readNoteByPath(dailyPath);
          if (typeof fresh !== "string") {
            await failBeforeReference("Daily note changed during promotion");
            return true;
          }
          let replanned = fresh;
          if (dailyPath === anchorDailyPath && pickedRows.length > 0) {
            const retryAnchorLinks = findPromotionPlannedLinks(fresh, dailyPath, { sourcePath, sourceBlockId: parsedTask.blockId, fileIndex });
            const retryAnchor = retryAnchorLinks.slice().sort((a, b) => a.entryLine - b.entryLine || a.bulletLine - b.bulletLine)[0];
            if (retryAnchor) {
              const retryReplacement = this.planPromotionAnchorReplacement(fresh, { ...retryAnchor, dailyPath }, pickedRows, { projectPath: createdPath, fileIndex, anchorLabel: retryAnchor.destinationLabel || "", mintedByKey });
              if (retryReplacement) replanned = retryReplacement.content;
            }
          }
          replanned = this.consumeAllPromotionPlannedLinks(replanned, consumeTargets, { dailyPath, sourcePath, sourceBlockId: parsedTask.blockId, fileIndex });
          if (!projectIsBlocked && pickedRows.length > 0) {
            replanned = this.repointPromotionChildLinks(replanned, dailyPath, { sourcePath, projectPath: createdPath, childIds: childBlockIds, fileIndex });
          }
          replanned = planPromotionHistoryRewrites(replanned, dailyPath, {
            sourcePath,
            sourceBlockId: parsedTask.blockId,
            projectBasename: createdFile.basename,
            childBlockIds: childIdsForHistory,
            fileIndex,
          }).content;
          if (replanned === fresh) continue;
          try {
            await writeOnce(fresh, replanned);
          } catch (_retryError) {
            await failBeforeReference("Daily note changed during promotion");
            return true;
          }
          after = replanned;
        }
        ledgerResults.push({ path: dailyPath, after });
      }
    }
    let updatedLinkCount = pickedRows.length;
    if (parsedTask.blockId && blockIdBacklinkRewrites.length > 0) {
      const writtenPaths = new Set(ledgerResults.map((entry) => entry.path));
      const remaining = blockIdBacklinkRewrites.filter((rewrite) => !writtenPaths.has(normalizeVaultRelativePath(rewrite.path)));
      if (remaining.length > 0 && !projectIsBlocked) {
        const rewriteResult = await this.applyBlockIdLinkRewrites(remaining, createdFile.basename);
        updatedLinkCount += rewriteResult.updatedLinkCount;
        if (rewriteResult.failed) {
          new Notice(`Created project, but ${rewriteResult.failedLinkCount} block ${rewriteResult.failedLinkCount === 1 ? "link" : "links"} could not be updated; source task was kept`);
          return true;
        }
      } else if (remaining.length > 0 && projectIsBlocked) {
        const rewriteResult = await this.applyBlockIdLinkRewrites(remaining.map((rewrite) => ({ ...rewrite })), createdFile.basename, "prj");
        void rewriteResult;
      }
    }
    let removedSourceTask = false;
    try {
      await this.app.vault.process(sourceFile, (content) => {
        const result = removeTaskBlockFromContent(content, sourceBlock);
        removedSourceTask = result.removed;
        return result.content;
      });
    } catch (error) {
      new Notice("Created project, but could not remove the source task");
      return true;
    }
    if (!removedSourceTask) {
      new Notice("Created project, but the source task changed and was not removed");
      return true;
    }
    const prjLineIndex = findProjectLifecycleTaskIndex(projectContent);
    const prjLineText = String((projectContent.split(/\r?\n/)[prjLineIndex] || ""));
    await this.focusTaskMoveDestination(createdFile, { line: prjLineIndex, text: prjLineText, blockId: "prj" });
    let notice = getProjectFromTaskNoticeText(parsedTask.description, sourceBasename, createdFile.basename, updatedLinkCount, (seedResult.sectionsInserted || 0) + (seedResult.sectionsCreated || 0), (convertedManagedLogLines.map((line) => { const parsed = parseManagedTaskLogParentBullet(line); return parsed ? parsed.kind : null; }).filter(Boolean)));
    if (droppedResidentDependencyCount > 0) notice += ` · dropped ${formatCountLabel(droppedResidentDependencyCount, "prerequisite")} that became project residents`;
    if (parsedTask.blockId) {
      const anchorLabel = (anchor && anchor.destinationLabel) || "Pomodoro";
      if (projectIsBlocked) {
        notice += `\nRemoved the ${anchorLabel} link · project is Blocked`;
      } else if (!anchor) {
        notice += "";
      } else if (!offerPlan || offerPlan.rows.length === 0) {
        notice += `\nRemoved the ${anchorLabel} link · no project tasks to pull in`;
      } else if (pickedRows.length === 0) {
        const total = offerPlan.rows.filter((row) => row.selectable).length + (offerPlan.folded.hidden || 0);
        void total;
        const offerCount = offerPlan.rows.filter((row) => row.selectable).length + (offerPlan.folded.hidden || 0) + (offerPlan.folded.alreadyPlanned || 0);
        const selectableCount = offerPlan.rows.filter((row) => row.selectable).length;
        const count = selectableCount + (offerPlan.folded.hidden || 0);
        notice += `\nRemoved the ${anchorLabel} link · ${count} project task${count === 1 ? "" : "s"} not pulled in`;
        void offerCount;
      } else {
        const notPulled = offerPlan.rows.filter((row) => row.selectable && !pickedKeys.has(row.key)).length + (offerPlan.folded.hidden || 0);
        const moreRemoved = Math.max(0, plannedByPath.size > 0 ? [...plannedByPath.values()].reduce((sum, entry) => sum + entry.links.length, 0) - 1 : 0);
        notice += `\n${buildPromotionNoticeLine2({ picks: pickedRows, anchorLabel, notPulledCount: notPulled, moreRemovedCount: moreRemoved, refusedCount })}`;
      }
    }
    new Notice(notice);
    return true;
  }

  applyPromotionSuccessorPicks(projectContent, pickedRows, options = {}) {
    const text = String(projectContent || "");
    const createdPath = normalizeVaultRelativePath(options.projectPath || options.createdPath || "");
    const today = options.today instanceof Date ? options.today : new Date();
    const dateText = promotionSuccessorTodayText(today);
    let stamper = null;
    let stampFallback = null;
    try {
      stamper = typeof this.getFreshnessStampLine === "function" ? this.getFreshnessStampLine() : null;
    } catch (_error) {
      stamper = null;
    }
    const { lines, lineEnding } = splitMarkdownContent(text);
    const nextLines = lines.slice();
    const reserved = new Set(["prj"]);
    for (let index = 0; index < nextLines.length; index += 1) {
      const id = getTrailingBlockId(String(nextLines[index] || ""));
      if (id) reserved.add(id);
    }
    const digestTable = new Map();
    for (const row of pickedRows) {
      if (row.blockId) continue;
      const digest = promotionSuccessorFnv1aHex(cleanTaskDisplayText(row.rawLine || row.text));
      if (!digestTable.has(digest)) digestTable.set(digest, []);
    }
    for (let index = 0; index < nextLines.length; index += 1) {
      const lineText = String(nextLines[index] || "");
      if (!OBSIDIAN_TASK_LINE_RE.test(lineText) || !isObsidianTaskLine(lineText) || isProjectLifecycleTaskLine(lineText) || lineText.includes(PROJECT_TASKS_PLACEHOLDER)) continue;
      const digest = promotionSuccessorFnv1aHex(cleanTaskDisplayText(lineText));
      if (digestTable.has(digest)) digestTable.get(digest).push(index);
    }
    let refused = 0;
    const usedLines = new Set();
    const mintedByKey = new Map();
    for (const row of pickedRows) {
      let targetLine = -1;
      if (row.blockId) {
        for (let index = 0; index < nextLines.length; index += 1) {
          if (usedLines.has(index)) continue;
          if (getTrailingBlockId(String(nextLines[index] || "")) === row.blockId) {
            targetLine = index;
            break;
          }
        }
        if (targetLine < 0) {
          for (let index = 0; index < nextLines.length; index += 1) {
            if (usedLines.has(index)) continue;
            if (cleanTaskDisplayText(String(nextLines[index] || "")) === row.text && getObsidianTaskCheckboxStatus(String(nextLines[index] || "")) !== null) {
              targetLine = index;
              break;
            }
          }
        }
      } else {
        const digest = promotionSuccessorFnv1aHex(cleanTaskDisplayText(row.rawLine || row.text));
        const candidates = (digestTable.get(digest) || []).filter((line) => !usedLines.has(line));
        if (candidates.length > 0) {
          const orderMatch = String(row.key || "").match(/~(\d+)$/);
          const order = orderMatch ? Number(orderMatch[1]) : 1;
          targetLine = candidates[Math.min(order - 1, candidates.length - 1)];
        }
      }
      if (targetLine < 0) {
        refused += 1;
        continue;
      }
      usedLines.add(targetLine);
      let line = String(nextLines[targetLine] || "");
      if (!getTrailingBlockId(line)) {
        const minted = suggestBlockIdFromTask(cleanTaskDisplayText(line), nextLines.join(lineEnding), { reservedIds: reserved });
        line = appendBlockIdToLine(line, minted);
        reserved.add(minted);
        mintedByKey.set(row.key, minted);
      } else {
        mintedByKey.set(row.key, getTrailingBlockId(line));
      }
      const status = getObsidianTaskCheckboxStatus(line);
      if (status === " ") {
        line = line.replace(OBSIDIAN_TASK_LINE_RE, (match, box, body) => match.replace(`[${box}]`, "[*]"));
      }
      try {
        if (stamper) line = applyFreshStampLine(line, stamper, dateText);
        else if (stampFallback) line = stampFallback(line);
        else {
          if (!/\[fresh::/.test(line)) {
            const idMatch = /(\s*\^[A-Za-z0-9-]+)(\s*)$/.exec(line);
            if (idMatch) line = line.replace(/(\s*\^[A-Za-z0-9-]+)(\s*)$/, ` [fresh:: ${dateText}]$1$2`);
            else line = `${line} [fresh:: ${dateText}]`;
          }
        }
      } catch (_error) {
        if (!/\[fresh::/.test(line)) line = `${line} [fresh:: ${dateText}]`;
      }
      nextLines[targetLine] = line;
    }
    return { content: nextLines.join(lineEnding), refused, mintedByKey };
  }

  planPromotionAnchorReplacement(dailyContent, anchor, pickedRows, options = {}) {
    const text = String(dailyContent || "");
    const projectPath = normalizeVaultRelativePath(options.projectPath || "");
    const fileIndex = options.fileIndex || null;
    const mintedByKey = options.mintedByKey instanceof Map ? options.mintedByKey : new Map();
    const lines = text.split(/\r?\n/);
    const ending = text.includes("\r\n") ? "\r\n" : "\n";
    const bulletLine = anchor.bulletLine;
    const anchorLine = String(lines[bulletLine] || "");
    const prefixMatch = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(anchorLine);
    if (!prefixMatch) return null;
    const prefix = prefixMatch[1];
    const subtreeEnd = anchor.subtreeEnd || bulletLine + 1;
    const subtreeLines = lines.slice(bulletLine + 1, subtreeEnd);
    const successorLines = [];
    for (const row of pickedRows) {
      const id = row.blockId || mintedByKey.get(row.key);
      if (!id) continue;
      successorLines.push(`${prefix}${promotionSuccessorLinkForId(projectPath, id, fileIndex)}`);
    }
    if (successorLines.length === 0) return null;
    const replacement = [successorLines[0], ...subtreeLines, ...successorLines.slice(1)];
    const nextLines = lines.slice();
    nextLines.splice(bulletLine, subtreeEnd - bulletLine, ...replacement);
    return { content: nextLines.join(ending) };
  }

  removePromotionBulletsAtLines(dailyContent, bulletLines) {
    const text = String(dailyContent || "");
    if (!Array.isArray(bulletLines) || bulletLines.length === 0) return text;
    const sorted = bulletLines.slice().sort((a, b) => b.line - a.line);
    const lines = text.split(/\r?\n/);
    const ending = text.includes("\r\n") ? "\r\n" : "\n";
    const removals = sorted.map((entry) => {
      const start = entry.line;
      const end = entry.end || entry.line + 1;
      return { start, end };
    });
    const merged = [];
    for (const removal of removals) {
      const last = merged[merged.length - 1];
      if (last && removal.start <= last.end && removal.end >= last.start) {
        last.start = Math.min(last.start, removal.start);
        last.end = Math.max(last.end, removal.end);
      } else {
        merged.push({ ...removal });
      }
    }
    merged.sort((a, b) => b.start - a.start);
    const nextLines = lines.slice();
    for (const removal of merged) {
      nextLines.splice(removal.start, removal.end - removal.start);
    }
    let next = nextLines.join(ending);
    next = this.deletePromotionEmptiedEntries(next);
    return next;
  }

  deletePromotionEmptiedEntries(dailyContent) {
    const text = String(dailyContent || "");
    const splitted = splitMarkdownContent(text);
    const lines = splitted.lines;
    const ending = splitted.lineEnding;
    const contexts = getMarkdownLineContexts(text);
    const section = findPomodorosSectionRange(text);
    if (!section) return text;
    const ranges = collectOpenPomodoroRanges(lines, contexts, section);
    const toDelete = [];
    for (const range of ranges) {
      const entryBlock = findCurrentBulletChildBlock(lines, range.entryLine);
      const childEnd = Math.min(entryBlock.endLineExclusive, section.endLine + 1);
      let remaining = 0;
      for (let line = entryBlock.startLine; line < childEnd; line += 1) {
        if (line === range.entryLine) continue;
        const lineText = String(lines[line] || "");
        if (contexts[line] && contexts[line].inFence) continue;
        if (!PROJECT_LIST_ITEM_RE.test(lineText)) continue;
        remaining += 1;
      }
      if (remaining === 0) {
        let endExclusive = childEnd;
        if (range.entryLine > 0 && lines[range.entryLine - 1].trim() === "" && endExclusive < lines.length && lines[endExclusive].trim() === "") {
          endExclusive += 1;
        }
        toDelete.push({ start: range.entryLine, end: endExclusive });
      }
    }
    if (toDelete.length === 0) return text;
    toDelete.sort((a, b) => b.start - a.start);
    const nextLines = lines.slice();
    for (const removal of toDelete) {
      nextLines.splice(removal.start, removal.end - removal.start);
    }
    return nextLines.join(ending);
  }

  consumePromotionPlannedLinksExceptAnchor(dailyContent, anchor, targets, options = {}) {
    const text = String(dailyContent || "");
    const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
    const fileIndex = options.fileIndex || null;
    const dailyPath = normalizeVaultRelativePath(options.dailyPath || (anchor && anchor.dailyPath) || "");
    const links = findPromotionPlannedLinks(text, dailyPath, { sourcePath, sourceBlockId: options.sourceBlockId || "", fileIndex });
    const removals = [];
    for (const link of links) {
      if (link.bulletLine === anchor.bulletLine && link.entryLine === anchor.entryLine) continue;
      removals.push({ line: link.bulletLine, end: link.subtreeEnd });
    }
    if (removals.length === 0) return text;
    return this.removePromotionBulletsAtLines(text, removals);
  }

  consumeAllPromotionPlannedLinks(dailyContent, targets, options = {}) {
    const text = String(dailyContent || "");
    const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
    const sourceBlockId = String(options.sourceBlockId || "").trim();
    const fileIndex = options.fileIndex || null;
    const dailyPath = normalizeVaultRelativePath(options.dailyPath || "");
    if (!sourcePath || !sourceBlockId || !dailyPath) {
      if (!Array.isArray(targets) || targets.length === 0) return text;
      return text;
    }
    const links = findPromotionPlannedLinks(text, dailyPath, { sourcePath, sourceBlockId, fileIndex });
    if (links.length === 0) return text;
    return this.removePromotionBulletsAtLines(text, links.map((link) => ({ line: link.bulletLine, end: link.subtreeEnd })));
  }

  repointPromotionChildLinks(dailyContent, dailyPath, options = {}) {
    const text = String(dailyContent || "");
    const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
    const projectPath = normalizeVaultRelativePath(options.projectPath || "");
    const fileIndex = options.fileIndex || null;
    const childIds = options.childIds instanceof Set ? options.childIds : new Set(options.childIds || []);
    if (!sourcePath || !projectPath || childIds.size === 0) return text;
    const filePath = normalizeVaultRelativePath(dailyPath || "");
    const splitted = splitMarkdownContent(text);
    const lines = splitted.lines;
    const ending = splitted.lineEnding;
    const contexts = getMarkdownLineContexts(text);
    const section = findPomodorosSectionRange(text);
    if (!section) return text;
    const ranges = collectOpenPomodoroRanges(lines, contexts, section);
    const entryByLine = new Map();
    for (const range of ranges) {
      for (let line = range.startLine; line <= range.endLine; line += 1) entryByLine.set(line, range);
    }
    let changed = false;
    const nextLines = lines.slice();
    for (let lineIndex = 0; lineIndex < nextLines.length; lineIndex += 1) {
      if (!entryByLine.has(lineIndex)) continue;
      const context = contexts[lineIndex];
      if (context && (context.inFrontmatter || context.inFence)) continue;
      const lineText = String(nextLines[lineIndex] || "");
      if (!PROJECT_LIST_ITEM_RE.test(lineText)) continue;
      const parsed = parseProjectPromotionDedicatedLink(lineText);
      if (!parsed || parsed.strikeOpen || parsed.strikeClose) continue;
      if (parsed.checkbox !== null && POMODORO_LEDGER_CLOSED_STATUSES.has(parsed.checkbox)) continue;
      if (!childIds.has(parsed.blockId)) continue;
      const resolved = resolveProjectPromotionLinkTarget(parsed.target, filePath, fileIndex);
      if (!resolved || normalizeVaultRelativePath(resolved) !== sourcePath) continue;
      const link = promotionSuccessorLinkForId(projectPath, parsed.blockId, fileIndex);
      const prefixMatch = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(lineText);
      if (!prefixMatch) continue;
      const checkboxText = parsed.checkbox !== null ? `[${parsed.checkbox}] ` : "";
      const suffixText = parsed.suffix ? parsed.suffix.replace(/^[ \t]*/, " ") : "";
      const embedPrefix = parsed.embedded ? "!" : "";
      nextLines[lineIndex] = `${prefixMatch[1]}${checkboxText}${parsed.markerRun}${embedPrefix}${link}${suffixText}`;
      changed = true;
    }
    return changed ? nextLines.join(ending) : text;
  }

}
