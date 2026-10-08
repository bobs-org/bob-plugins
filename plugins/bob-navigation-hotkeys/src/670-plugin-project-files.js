class BobNavigationHotkeysProjectFileMixin {

  async applyProjectPromotionBacklinkExpansion(options) {
    const opts = options && typeof options === "object" ? options : {};
    const sourceFile = opts.sourceFile;
    const createdFile = opts.createdFile;
    const sourceBlockId = String(opts.sourceBlockId || "").trim();
    const seedContent = String(opts.seedContent || "");
    const promotionPlan = opts.promotionPlan;
    const blockIdBacklinkRewrites = Array.isArray(opts.blockIdBacklinkRewrites)
      ? opts.blockIdBacklinkRewrites
      : [];
    const today =
      opts.today instanceof Date ? opts.today : new Date();
    const empty = Object.freeze({
      updatedLinkCount: 0,
      failedLinkCount: 0,
      failed: false,
      error: null,
      expanded: false,
    });
    if (!sourceFile || !createdFile || !sourceBlockId || !promotionPlan) {
      return empty;
    }
    if (promotionPlan.error) {
      return Object.freeze({
        updatedLinkCount: 0,
        failedLinkCount: 0,
        failed: true,
        error: "target block IDs are ambiguous",
        expanded: false,
      });
    }
    const targets = Array.isArray(promotionPlan.targets)
      ? promotionPlan.targets
      : [];
    if (targets.length === 0) {
      return empty;
    }
    const targetBlockIds = targets.map((target) => target.blockId);
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      return Object.freeze({
        updatedLinkCount: 0,
        failedLinkCount: 0,
        failed: true,
        error: "vault updates are unavailable",
        expanded: false,
      });
    }
    const buffers = getOpenMarkdownBufferContents(this.app);
    if (buffers && buffers.ambiguous) {
      return Object.freeze({
        updatedLinkCount: 0,
        failedLinkCount: 0,
        failed: true,
        error: "open notes conflict",
        expanded: false,
      });
    }
    let markdownFiles = [];
    try {
      markdownFiles =
        typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles() || []
          : [];
    } catch (error) {
      markdownFiles = [];
    }
    const fileIndex = createProjectPromotionLinkIndex(markdownFiles);
    const sourcePath = normalizeVaultRelativePath(sourceFile.path);
    const createdPath = normalizeVaultRelativePath(createdFile.path);
    const projectPathWithoutMd = createdPath.replace(/\.md$/i, "");
    const projectBasename =
      (createdFile.basename ||
        getVaultPathBasenameWithoutExtension(createdPath) ||
        "").trim();
    if (!projectPathWithoutMd || !projectBasename) {
      return Object.freeze({
        updatedLinkCount: 0,
        failedLinkCount: 0,
        failed: true,
        error: "project note name is unavailable",
        expanded: false,
      });
    }
    const candidatePaths = new Set();
    for (const rewrite of blockIdBacklinkRewrites) {
      const rewritePath = normalizeVaultRelativePath(
        (rewrite && rewrite.path) || "",
      );
      if (rewritePath) {
        candidatePaths.add(rewritePath);
      }
    }
    for (const file of markdownFiles) {
      const filePath = normalizeVaultRelativePath(
        (file && file.path) || "",
      );
      if (
        filePath &&
        isProjectPromotionEligibleDailyPath(filePath, today)
      ) {
        candidatePaths.add(filePath);
      }
    }
    const fileByPath = new Map();
    for (const file of markdownFiles) {
      const filePath = normalizeVaultRelativePath(
        (file && file.path) || "",
      );
      if (filePath && !fileByPath.has(filePath)) {
        fileByPath.set(filePath, file);
      }
    }
    const expansionWrites = [];
    for (const candidatePath of candidatePaths) {
      if (!isProjectPromotionEligibleDailyPath(candidatePath, today)) {
        continue;
      }
      const file =
        fileByPath.get(candidatePath) ||
        (typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(candidatePath)
          : null);
      if (!this.isMarkdownFile(file)) {
        continue;
      }
      const snapshot = await this.readProjectPromotionCandidateContent(
        candidatePath,
        file,
        buffers,
      );
      if (snapshot === null) {
        return Object.freeze({
          updatedLinkCount: 0,
          failedLinkCount: 0,
          failed: true,
          error: `daily note could not be read: ${candidatePath}`,
          expanded: false,
        });
      }
      const plan = planProjectPromotionFileEdits(snapshot, candidatePath, {
        sourcePath,
        sourceBlockId,
        projectPathWithoutMd,
        projectBasename,
        targetBlockIds,
        today,
        fileIndex,
      });
      if (!plan.changed || plan.expandedCount === 0) {
        continue;
      }
      expansionWrites.push(
        Object.freeze({
          path: candidatePath,
          file,
          before: snapshot,
          after: plan.content,
          expandedCount: plan.expandedCount,
          legacyCount: plan.legacyCount,
        }),
      );
    }
    if (expansionWrites.length === 0) {
      return empty;
    }
    const updatedProjectContent = promotionPlan.content;
    if (updatedProjectContent !== seedContent) {
      try {
        await this.writeProjectPromotionFileChange(
          createdPath,
          createdFile,
          seedContent,
          updatedProjectContent,
        );
      } catch (error) {
        return Object.freeze({
          updatedLinkCount: 0,
          failedLinkCount: 0,
          failed: true,
          error: "project anchors could not be persisted",
          expanded: true,
        });
      }
      const verifyContent = await this.readProjectPromotionCandidateContent(
        createdPath,
        createdFile,
        getOpenMarkdownBufferContents(this.app),
      );
      if (verifyContent === null) {
        return Object.freeze({
          updatedLinkCount: 0,
          failedLinkCount: 0,
          failed: true,
          error: "project note could not be verified",
          expanded: true,
        });
      }
      for (const target of targets) {
        if (!blockIdExistsInContent(verifyContent, target.blockId)) {
          return Object.freeze({
            updatedLinkCount: 0,
            failedLinkCount: 0,
            failed: true,
            error: "project anchors changed before ledger writes",
            expanded: true,
          });
        }
      }
    }
    let expandedTotal = 0;
    let legacyFromExpansions = 0;
    try {
      for (const write of expansionWrites) {
        await this.writeProjectPromotionFileChange(
          write.path,
          write.file,
          write.before,
          write.after,
        );
        expandedTotal += write.expandedCount;
        legacyFromExpansions += write.legacyCount;
      }
    } catch (error) {
      return Object.freeze({
        updatedLinkCount: expandedTotal + legacyFromExpansions,
        failedLinkCount: 0,
        failed: true,
        error: "daily note changed during promotion",
        expanded: true,
      });
    }
    const expandedPaths = new Set(
      expansionWrites.map((write) => write.path),
    );
    const legacyOnlyRewrites = blockIdBacklinkRewrites.filter((rewrite) => {
      const rewritePath = normalizeVaultRelativePath(
        (rewrite && rewrite.path) || "",
      );
      return rewritePath && !expandedPaths.has(rewritePath);
    });
    let legacyUpdated = 0;
    if (legacyOnlyRewrites.length > 0) {
      const legacyResult = await this.applyBlockIdLinkRewrites(
        legacyOnlyRewrites,
        projectBasename,
      );
      legacyUpdated = legacyResult.updatedLinkCount;
      if (legacyResult.failed) {
        return Object.freeze({
          updatedLinkCount: expandedTotal + legacyFromExpansions + legacyUpdated,
          failedLinkCount: legacyResult.failedLinkCount,
          failed: true,
          error: null,
          expanded: true,
        });
      }
    }
    return Object.freeze({
      updatedLinkCount: expandedTotal + legacyFromExpansions + legacyUpdated,
      failedLinkCount: 0,
      failed: false,
      error: null,
      expanded: true,
    });
  }

  showCreatedNoteNotice(file, fallbackPath) {
    new Notice(getCreatedNoteNoticeText(file, fallbackPath));
  }

  getTemplaterPlugin() {
    const plugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["templater-obsidian"];
    return plugin &&
      plugin.templater &&
      typeof plugin.templater.create_new_note_from_template === "function"
      ? plugin
      : null;
  }

  getNoteTemplateFile(templatePath) {
    const file = this.app.vault.getAbstractFileByPath(templatePath);
    return this.isMarkdownFile(file) ? file : null;
  }

  getCreationTargetForLinkTarget(linkTarget) {
    const linkText = this.normalizeLinkTarget(linkTarget);
    if (!linkText || isExternalLinkTarget(linkText)) {
      return null;
    }

    const pathPart = normalizeVaultRelativePath(
      this.stripLinkSubpath(linkText),
    );
    if (
      isUnsafeVaultPath(pathPart) ||
      isExternalLinkTarget(pathPart) ||
      hasNonMarkdownExtension(pathPart)
    ) {
      return null;
    }

    const path = MARKDOWN_EXTENSION_RE.test(pathPart)
      ? pathPart
      : `${pathPart}.md`;
    if (isUnsafeVaultPath(path)) {
      return null;
    }

    const { folderPath, basename } = splitVaultPath(path);
    if (!basename) {
      return null;
    }

    return { basename, folderPath, path };
  }

  async ensureVaultFolder(folderPath) {
    if (!folderPath) {
      return typeof this.app.vault.getRoot === "function"
        ? this.app.vault.getRoot()
        : "";
    }

    if (isUnsafeVaultPath(folderPath)) {
      new Notice("Unsafe note folder");
      return null;
    }

    const segments = folderPath.split("/");
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (existing) {
        if (!this.isVaultFolder(existing)) {
          new Notice("Cannot create note folder");
          return null;
        }
        continue;
      }

      if (typeof this.app.vault.createFolder !== "function") {
        new Notice("Cannot create note folder");
        return null;
      }

      try {
        await this.app.vault.createFolder(currentPath);
      } catch (error) {
        const created = this.app.vault.getAbstractFileByPath(currentPath);
        if (!this.isVaultFolder(created)) {
          new Notice("Cannot create note folder");
          return null;
        }
      }
    }

    return this.app.vault.getAbstractFileByPath(folderPath) || folderPath;
  }

  async openFrontmatterLink(fieldName, missingMessage, notFoundMessage) {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const link = this.getFrontmatterLink(frontmatter, fieldName);
    if (!link) {
      new Notice(missingMessage);
      return;
    }

    await this.openOrCreateLinkTarget(link, file.path, notFoundMessage, link);
  }

  async openLabeledBodyLink(label) {
    const context = await this.getActiveMarkdownContext();
    if (!context) {
      return;
    }

    const link = this.findFirstRenderedLink(context.content, label);
    if (!link) {
      new Notice(`No ${label} link found`);
      return;
    }

    await this.openOrCreateLinkTarget(
      link.target,
      context.file.path,
      `${this.capitalize(label)} note not found`,
      link.renderedText,
    );
  }

  async openOrCreateLinkTarget(
    linkTarget,
    sourcePath,
    notFoundMessage,
    renderedText,
  ) {
    const candidate = this.toLineLinkCandidate(
      { target: linkTarget, renderedText },
      sourcePath,
      0,
    );

    if (!candidate) {
      new Notice(notFoundMessage);
      return false;
    }

    return this.openOrCreateLinkCandidate(candidate);
  }

  async openAlternateFile() {
    if (!this.alternateFilePath) {
      new Notice("No alternate file");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.alternateFilePath);
    if (!this.isMarkdownFile(file)) {
      new Notice("Alternate file not found");
      return;
    }

    this.captureActiveFilePosition();
    const restorePosition = normalizePosition(this.filePositions.get(file.path));
    const opened = await this.openMarkdownFileWithLeafReuse(
      file,
      "Could not open alternate file",
    );
    if (opened) {
      this.restoreFilePosition(file.path, restorePosition);
    }
    return opened;
  }

  async deleteCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const path = file.path;
    try {
      await this.app.fileManager.trashFile(file);
      new Notice(getDeletedFileNoticeText(path));
    } catch (error) {
      new Notice(path ? `Could not delete "${path}"` : "Could not delete file");
    }
  }

  openRenameCurrentFileModal() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    new RenameCurrentFileModal(this.app, this, file).open();
  }

  async renameCurrentFileToName(input) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return false;
    }

    const oldPath = normalizeVaultRelativePath(file.path);
    const target = getRenameTargetPath(oldPath, input);
    if (!target.ok) {
      new Notice(target.message);
      return false;
    }

    const existingFile = this.app.vault.getAbstractFileByPath(target.path);
    if (existingFile) {
      new Notice(`File already exists: ${target.path}`);
      return false;
    }

    const fileManager = this.app.fileManager;
    if (!fileManager || typeof fileManager.renameFile !== "function") {
      new Notice(`Could not rename "${oldPath}"`);
      return false;
    }

    const audit = this.collectInboundLinkRenameSummary(file);

    try {
      await fileManager.renameFile(file, target.path);
      new Notice(getRenamedFileNoticeText(oldPath, target.path, audit), 8000);
      return true;
    } catch (error) {
      new Notice(`Could not rename "${oldPath}"`);
      return false;
    }
  }

  collectInboundLinkRenameSummary(file) {
    const metadataCache = this.app && this.app.metadataCache;
    const vault = this.app && this.app.vault;
    if (
      !file ||
      !file.path ||
      !metadataCache ||
      typeof metadataCache.getFileCache !== "function" ||
      typeof metadataCache.getFirstLinkpathDest !== "function" ||
      !vault ||
      typeof vault.getMarkdownFiles !== "function"
    ) {
      return createRenameLinkAudit(true);
    }

    const targetPath = normalizeVaultRelativePath(file.path);
    const summary = createRenameLinkAudit();

    try {
      vault.getMarkdownFiles().forEach((sourceFile) => {
        if (!sourceFile || !sourceFile.path) {
          return;
        }

        const sourcePath = normalizeVaultRelativePath(sourceFile.path);
        const cache = metadataCache.getFileCache(sourceFile);
        this.countCachedRenameReferences(
          cache,
          "links",
          "bodyLinks",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "embeds",
          "embeds",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "frontmatterLinks",
          "frontmatterLinks",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "referenceLinks",
          "referenceLinks",
          sourcePath,
          targetPath,
          summary,
        );
      });
    } catch (error) {
      return createRenameLinkAudit(true);
    }

    summary.sourceFileCount = summary.sourceFilePaths.size;
    return summary;
  }

  countCachedRenameReferences(
    cache,
    cacheKey,
    summaryKey,
    sourcePath,
    targetPath,
    summary,
  ) {
    getCachedReferenceItems(cache, cacheKey).forEach((reference) => {
      if (
        !this.cachedRenameReferencePointsToFile(
          reference,
          sourcePath,
          targetPath,
        )
      ) {
        return;
      }

      summary[summaryKey] += 1;
      summary.totalLinks += 1;
      summary.sourceFilePaths.add(sourcePath);
    });
  }

  cachedRenameReferencePointsToFile(reference, sourcePath, targetPath) {
    const link = this.normalizeLinkTarget(getCachedReferenceLinkText(reference));
    if (!link || isExternalLinkTarget(link)) {
      return false;
    }

    const linkText = this.stripMarkdownExtension(link);
    const lookupText = this.stripLinkSubpath(linkText);
    if (!lookupText) {
      return false;
    }

    const resolvedFile = this.resolveLinkTargetFile(linkText, sourcePath);
    return (
      resolvedFile &&
      normalizeVaultRelativePath(resolvedFile.path) === targetPath
    );
  }

  trackOpenedFile(file) {
    // A landing ends when another note opens: the next gesture is no
    // longer "on the row `]s` just landed on".
    // The current review task deliberately survives a note switch.
    try {
      const landing = this.reviewLanding;
      const openedPath =
        file && typeof file.path === "string" ? file.path : null;
      if (landing && openedPath !== landing.path) {
        this.reviewLanding = null;
      }
    } catch (error) {
      // Best effort: the capture guard rechecks the landing anyway.
    }
    if (!this.isMarkdownFile(file)) {
      this.clearDashScrollCaptureTarget();
      return;
    }

    if (file.path === this.currentFilePath) {
      this.refreshDashScrollCaptureTarget();
      return;
    }

    if (this.currentFilePath) {
      this.alternateFilePath = this.currentFilePath;
    }
    this.currentFilePath = file.path;
    this.refreshDashScrollCaptureTarget();
  }

  trackSelectionUpdate(update) {
    if (
      !update ||
      (!update.selectionSet && !update.docChanged && !update.viewportChanged)
    ) {
      return;
    }

    const view = this.getActiveMarkdownView();
    if (!view || !view.file || !view.editor) {
      return;
    }

    if (update.view && view.editor.cm && view.editor.cm !== update.view) {
      return;
    }

    const position =
      update.selectionSet || update.docChanged
        ? positionFromCodeMirrorUpdate(update)
        : null;
    if (position) {
      this.saveFilePosition(view.file.path, position);
    }

    if (view.file.path === DASH_FILE_PATH) {
      this.refreshDashScrollCaptureTarget(view);
      this.captureDashLocationFromView(view, { position });
    }
  }

  getActiveMarkdownFile() {
    const file = this.app.workspace.getActiveFile();
    if (!this.isMarkdownFile(file)) {
      new Notice("No active markdown file");
      return null;
    }

    return file;
  }

  getActiveMarkdownView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || !this.isMarkdownFile(view.file) || !view.editor) {
      return null;
    }

    return view;
  }

  captureActiveFilePosition() {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      !view.editor ||
      typeof view.editor.getCursor !== "function"
    ) {
      return false;
    }

    return this.saveFilePosition(view.file.path, view.editor.getCursor());
  }

  saveFilePosition(filePath, position) {
    if (!filePath) {
      return false;
    }

    const normalized = normalizePosition(position);
    if (!normalized) {
      return false;
    }

    this.filePositions.set(filePath, normalized);
    return true;
  }

  restoreFilePosition(filePath, position) {
    const normalized = normalizePosition(position);
    if (!normalized) {
      return false;
    }

    if (this.restoreActiveFilePosition(filePath, normalized)) {
      return true;
    }

    this.deferRestoreFilePosition(filePath, normalized);
    return false;
  }

  restoreActiveFilePosition(filePath, position) {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file || view.file.path !== filePath || !view.editor) {
      return false;
    }

    const target = clampPositionToEditor(view.editor, position);
    if (!target || !setEditorCursor(view.editor, target)) {
      return false;
    }

    this.saveFilePosition(filePath, target);
    return true;
  }

  deferRestoreFilePosition(filePath, position) {
    this.cancelPendingRestore();

    this.pendingRestoreDeferred = deferToNextFrame(() => {
      this.pendingRestoreDeferred = null;
      this.restoreActiveFilePosition(filePath, position);
    });
  }

  cancelPendingRestore() {
    cancelDeferred(this.pendingRestoreDeferred);
    this.pendingRestoreDeferred = null;
  }

  async getActiveMarkdownContext() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return null;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      view &&
      view.file &&
      view.file.path === file.path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      return { file, content: view.editor.getValue() };
    }

    return { file, content: await this.app.vault.cachedRead(file) };
  }

  isMarkdownFile(file) {
    return !!file && file.extension === "md";
  }

  isVaultFolder(file) {
    const TFolder = obsidian && obsidian.TFolder;
    return !!(
      file &&
      ((typeof TFolder === "function" && file instanceof TFolder) ||
        (file.children && !file.extension))
    );
  }

  getFrontmatterLink(frontmatter, fieldName) {
    const links = this.getFrontmatterLinks(frontmatter, fieldName);
    return links.length === 0 ? null : links[0];
  }

  getFrontmatterLinks(frontmatter, fieldName) {
    if (
      !frontmatter ||
      !Object.prototype.hasOwnProperty.call(frontmatter, fieldName)
    ) {
      return [];
    }

    const fieldValue = frontmatter[fieldName];
    const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    const links = [];

    for (const value of values) {
      const link = this.extractLinkTarget(value);
      if (link) {
        links.push(link);
      }
    }

    return links;
  }

  isAreaOrProjectNote(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.getFrontmatterLinks(frontmatter, "type").some((link) =>
      this.isAreaOrProjectTypeLink(link, file.path),
    );
  }

  isAreaOrProjectTypeLink(link, sourcePath) {
    const resolvedFile = this.resolveLinkTargetFile(link, sourcePath);
    const basename =
      resolvedFile && resolvedFile.basename
        ? resolvedFile.basename
        : this.basenameForRenderedWikiLink(link);

    return PROJECT_PARENT_TYPE_BASENAMES.has(basename);
  }

  getFrontmatterWikiLinkToFile(file) {
    const target = this.stripMarkdownExtension(
      normalizeVaultRelativePath(file.path),
    );
    const basename = file.basename || this.basenameForRenderedWikiLink(target);
    return target === basename ? `[[${basename}]]` : `[[${target}|${basename}]]`;
  }

  frontmatterFieldPointsToFile(frontmatter, fieldName, targetFile, sourcePath) {
    if (!this.isMarkdownFile(targetFile)) {
      return false;
    }

    return this.getFrontmatterLinks(frontmatter, fieldName).some((link) => {
      const resolvedFile = this.resolveLinkTargetFile(link, sourcePath);
      return resolvedFile && resolvedFile.path === targetFile.path;
    });
  }

  extractLinkTarget(value) {
    const text = this.normalizeText(value);
    if (!text) {
      return null;
    }

    const wikiIndex = text.indexOf("[[");
    if (wikiIndex !== -1) {
      const wikiLink = this.parseWikiLinkAt(text, wikiIndex);
      if (wikiLink) {
        return wikiLink.target;
      }
    }

    const markdownIndex = this.findNextMarkdownLinkStart(text, 0);
    if (markdownIndex !== -1) {
      const markdownLink = this.parseMarkdownLinkAt(text, markdownIndex);
      if (markdownLink) {
        return markdownLink.target;
      }
    }

    return this.normalizeLinkTarget(text);
  }

  findFirstRenderedLink(content, expectedLabel) {
    const label = expectedLabel.trim();
    const lines = String(content).split(/\r?\n/);
    let lineIndex = 0;
    let inFrontmatter = false;
    let inFence = null;

    if (this.startsWithFrontmatter(lines)) {
      inFrontmatter = true;
      lineIndex = 1;
    }

    for (; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];

      if (inFrontmatter) {
        if (FRONTMATTER_DELIMITER_RE.test(line)) {
          inFrontmatter = false;
        }
        continue;
      }

      if (inFence) {
        if (this.isClosingFence(line, inFence)) {
          inFence = null;
        }
        continue;
      }

      const openingFence = this.getFenceOpening(line);
      if (openingFence) {
        inFence = openingFence;
        continue;
      }

      const link = this.findFirstRenderedLinkInLine(line, label);
      if (link) {
        return link;
      }
    }

    return null;
  }

  startsWithFrontmatter(lines) {
    return startsWithFrontmatter(lines);
  }
}
