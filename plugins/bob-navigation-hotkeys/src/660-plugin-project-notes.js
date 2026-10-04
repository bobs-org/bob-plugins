class BobNavigationHotkeysProjectNoteMixin {

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

    const createdDate = formatProjectTaskCreatedDate(new Date());
    let convertedChildTaskLines = [];
    let convertedChildSections = [];
    let convertedManagedLogLines = [];
    let childConversionLossy = false;
    const hasChildContent = sourceBlock.childLines.some(
      (line) => String(line || "").trim() !== "",
    );
    if (hasChildContent) {
      const conversion = buildProjectSeedFromChildBullets(
        sourceBlock.childLines,
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
      parsedTask.scheduled,
    );
    if (!createdFile) {
      return false;
    }

    let seedResult = null;
    try {
      await this.app.vault.process(createdFile, (content) => {
        seedResult = buildProjectContentFromTask(content, parsedTask, {
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

    let updatedLinkCount = 0;
    if (parsedTask.blockId) {
      const promotionPlan = planProjectPromotionTargets(
        seedResult.content,
      );
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
          seedContent: seedResult.content,
          promotionPlan,
          blockIdBacklinkRewrites,
          today: promotionToday,
        },
      );
      if (expansionResult.expanded) {
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
      } else if (blockIdBacklinkRewrites.length > 0) {
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
        const result = removeTaskBlockFromContent(content, sourceBlock);
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

    new Notice(
      getProjectFromTaskNoticeText(
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
      ),
    );
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
    const built = buildTaskBlockFromProjectNote(content, { noteBasename });
    if (!built.valid) {
      new Notice(built.error);
      return false;
    }

    if (!isProjectFrontmatterParentLink(built.parentLink)) {
      new Notice("Project note has no parent link");
      return false;
    }

    const parentTarget = this.extractLinkTarget(built.parentLink);
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
    const restored = buildTaskBlockFromProjectNote(content, {
      noteBasename,
      parentBasename,
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

    const insertion = insertTaskMoveBlocks(
      parentContent,
      [restored.lines],
      destination.kind,
    );
    if (!insertion.valid) {
      new Notice(
        `Parent note "${parentBasename}" has no ## Tasks section`,
      );
      return false;
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

    let wroteParent = false;
    try {
      await vault.process(parentFile, (current) => {
        if (current !== parentContent) {
          return current;
        }
        wroteParent = true;
        return insertion.content;
      });
    } catch (error) {
      new Notice("Could not update the parent note");
      return false;
    }

    if (!wroteParent) {
      new Notice("Parent note changed; nothing was converted");
      return false;
    }

    let updatedLinkCount = 0;
    if (classification.blockRewrites.length > 0) {
      const rewriteResult = await this.applyBlockIdLinkRewrites(
        classification.blockRewrites,
        parentBasename,
        restored.blockId,
      );
      updatedLinkCount = rewriteResult.updatedLinkCount;
      if (rewriteResult.failed) {
        const failed = rewriteResult.failedLinkCount;
        new Notice(
          `Restored the task in ${parentBasename}, but ${failed} links could not be updated; "${noteBasename}" was kept`,
        );
        return true;
      }
    }

    await this.focusTaskMoveDestination(parentFile, {
      line: insertion.insertedLine,
      text: restored.lines[0],
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

    new Notice(
      getProjectNoteToTaskNoticeText(
        noteBasename,
        parentBasename,
        restored.taskCount,
        restored.sectionCount,
        updatedLinkCount,
      ),
    );
    return true;
  }

  async createProjectNoteFile(creatingFile, basename, scheduled = null) {
    const templaterPlugin = this.getTemplaterPlugin();
    if (!templaterPlugin) {
      new Notice("Templater is not available");
      return null;
    }

    const templateFile = this.getNoteTemplateFile(PROJECT_TEMPLATE_PATH);
    if (!templateFile) {
      new Notice("Project note template not found");
      return null;
    }

    const resolvedBasename =
      basename === undefined ||
      basename === null ||
      String(basename).trim() === ""
        ? this.getDefaultProjectNoteBasename(creatingFile)
        : basename;
    if (!resolvedBasename) {
      new Notice("Could not derive project note name");
      return null;
    }

    const folder =
      typeof this.app.vault.getRoot === "function"
        ? this.app.vault.getRoot()
        : "";

    let createdFile = null;
    try {
      createdFile =
        await templaterPlugin.templater.create_new_note_from_template(
          templateFile,
          folder,
          resolvedBasename,
          true,
        );
    } catch (error) {
      new Notice("Could not create project note");
      return null;
    }

    if (!this.isMarkdownFile(createdFile)) {
      new Notice("Could not create project note");
      return null;
    }

    const parentLink = this.getFrontmatterWikiLinkToFile(creatingFile);
    try {
      await this.app.fileManager.processFrontMatter(
        createdFile,
        (frontmatter) => {
          applyProjectCreationFrontmatter(
            frontmatter,
            parentLink,
            scheduled,
          );
        },
      );
    } catch (error) {
      new Notice("Could not set project parent");
      return null;
    }

    return createdFile;
  }

  getRootMarkdownBasenames() {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return null;
    }

    let markdownFiles;
    try {
      markdownFiles = vault.getMarkdownFiles();
    } catch (error) {
      return null;
    }

    if (!Array.isArray(markdownFiles)) {
      return null;
    }

    const basenames = new Set();
    for (const file of markdownFiles) {
      const path = getVaultRelativeFilePath(file);
      if (!path || path.includes("/") || !this.isMarkdownFile(file)) {
        continue;
      }

      const basename =
        typeof file.basename === "string" && file.basename
          ? file.basename
          : getVaultPathBasenameWithoutExtension(path);
      if (basename) {
        basenames.add(basename);
      }
    }

    return basenames;
  }

  getDefaultProjectNoteBasename(creatingFile) {
    const sourceBasename =
      creatingFile &&
      typeof creatingFile.basename === "string" &&
      creatingFile.basename
        ? creatingFile.basename
        : getVaultPathBasenameWithoutExtension(
            creatingFile && creatingFile.path,
          );
    const rootBasenames = this.getRootMarkdownBasenames();
    if (!rootBasenames) {
      return null;
    }

    return getNextDefaultProjectBasename(sourceBasename, rootBasenames);
  }

  projectNoteBasenameExists(basename, sourceFile) {
    const targetBasename = String(basename || "").trim();
    if (!targetBasename) {
      return false;
    }

    const metadataCache = this.app.metadataCache;
    if (
      metadataCache &&
      typeof metadataCache.getFirstLinkpathDest === "function"
    ) {
      try {
        const existingFile = metadataCache.getFirstLinkpathDest(
          targetBasename,
          (sourceFile && sourceFile.path) || "",
        );
        if (this.isMarkdownFile(existingFile)) {
          return true;
        }
      } catch (error) {
        // Fall back to a direct root-path check below.
      }
    }

    if (
      !this.app.vault ||
      typeof this.app.vault.getAbstractFileByPath !== "function"
    ) {
      return false;
    }

    return this.isMarkdownFile(
      this.app.vault.getAbstractFileByPath(`${targetBasename}.md`),
    );
  }

  getProjectTaskBlockIdBacklinkRewrites(file, blockId) {
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return [];
    }

    try {
      const backlinks = metadataCache.getBacklinksForFile(file);
      return collectBlockIdBacklinkRewrites(
        backlinks && backlinks.data,
        blockId,
      );
    } catch (error) {
      return [];
    }
  }

  getProjectNoteBacklinkClassification(file, parentPath) {
    const empty = Object.freeze({
      blockRewrites: Object.freeze([]),
      otherPaths: Object.freeze([]),
    });
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return empty;
    }

    try {
      const backlinks = metadataCache.getBacklinksForFile(file);
      const classified = collectProjectNoteBacklinkClassification(
        backlinks && backlinks.data,
        parentPath,
      );
      const filePath = normalizeVaultRelativePath(file && file.path);
      return Object.freeze({
        blockRewrites: classified.blockRewrites,
        otherPaths: Object.freeze(
          classified.otherPaths.filter((path) => path !== filePath),
        ),
      });
    } catch (error) {
      return empty;
    }
  }

  async applyBlockIdLinkRewrites(rewrites, newBasename, blockId = "prj") {
    let updatedLinkCount = 0;
    let failedLinkCount = 0;
    const vault = this.app.vault;

    for (const rewrite of Array.isArray(rewrites) ? rewrites : []) {
      const originals = Array.isArray(rewrite && rewrite.originals)
        ? rewrite.originals
        : [];
      const file =
        vault &&
        typeof vault.getAbstractFileByPath === "function" &&
        rewrite &&
        rewrite.path
          ? vault.getAbstractFileByPath(rewrite.path)
          : null;
      if (!this.isMarkdownFile(file)) {
        failedLinkCount += originals.length || 1;
        continue;
      }

      const replacements = [];
      originals.forEach((original) => {
        const replacement = rewriteBlockIdLinkOriginal(
          original,
          newBasename,
          blockId,
        );
        if (!replacement) {
          failedLinkCount += 1;
          return;
        }

        replacements.push({
          original,
          replacement,
        });
      });

      if (replacements.length === 0) {
        continue;
      }

      let missing = [];
      try {
        await vault.process(file, (content) => {
          const result = replaceLinkOriginalsInContent(content, replacements);
          missing = result.missing;
          return result.content;
        });
      } catch (error) {
        failedLinkCount += replacements.length;
        continue;
      }

      updatedLinkCount += replacements.length - missing.length;
      failedLinkCount += missing.length;
    }

    return Object.freeze({
      updatedLinkCount,
      failedLinkCount,
      failed: failedLinkCount > 0,
    });
  }

  async readProjectPromotionCandidateContent(path, file, buffers) {
    const normalized = normalizeVaultRelativePath(path);
    if (buffers && !buffers.ambiguous && buffers.has(normalized)) {
      return String(buffers.get(normalized) || "");
    }
    const editor = this.getOpenMarkdownEditorForPath(normalized);
    if (editor && typeof editor.getValue === "function") {
      return String(editor.getValue() || "");
    }
    const vault = this.app && this.app.vault;
    const vaultFile =
      file ||
      (vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(normalized)
        : null);
    if (!vault || !vaultFile) {
      return null;
    }
    try {
      if (typeof vault.cachedRead === "function") {
        return String((await vault.cachedRead(vaultFile)) || "");
      }
      if (typeof vault.read === "function") {
        return String((await vault.read(vaultFile)) || "");
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async writeProjectPromotionFileChange(path, file, before, after) {
    const normalized = normalizeVaultRelativePath(path);
    const editor = this.getOpenMarkdownEditorForPath(normalized);
    if (editor && typeof editor.getValue === "function") {
      if (String(editor.getValue() || "") !== before) {
        throw new Error(`Promotion preimage changed: ${normalized}`);
      }
      const applied = applyEditorContentTransaction(editor, before, after);
      if (!applied || String(editor.getValue() || "") !== after) {
        throw new Error(`Promotion editor write failed: ${normalized}`);
      }
      return;
    }
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function" || !file) {
      throw new Error(`Vault content updates are unavailable: ${normalized}`);
    }
    let transformed = false;
    await vault.process(file, (content) => {
      if (String(content || "") !== before) {
        throw new Error(`Promotion preimage changed: ${normalized}`);
      }
      transformed = true;
      return after;
    });
    if (!transformed) {
      throw new Error(`Promotion file write failed: ${normalized}`);
    }
  }
}
