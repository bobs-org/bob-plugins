class BobNavigationHotkeysNotesMoveMixin {

  openYankPathPicker() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    new YankPathPickerModal(this.app, this, file).open();
  }

  collectChildNotes(parentFile) {
    if (!this.isMarkdownFile(parentFile)) {
      return [];
    }

    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          file.path !== parentFile.path &&
          this.frontmatterFieldPointsToFile(
            this.app.metadataCache.getFileCache(file)?.frontmatter,
            "parent",
            parentFile,
            file.path,
          ),
      )
      .sort((first, second) => first.path.localeCompare(second.path));
  }

  async openChildNote(file) {
    if (!this.isMarkdownFile(file)) {
      new Notice("Child note not found");
      return false;
    }

    this.captureActiveFilePosition();

    return this.openMarkdownFileWithLeafReuse(
      file,
      "Could not open child note",
    );
  }

  async yankActiveFilePath(kind) {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return false;
    }

    const label = YANK_PATH_NOTICE_LABELS[kind] || "path";
    const result = this.getActiveFileYankPath(kind, file);
    if (!result.ok) {
      new Notice(result.message);
      return false;
    }

    return this.writeTextToClipboard(result.text, label);
  }

  getActiveFileYankPath(kind, file) {
    const relativePath = getVaultRelativeFilePath(file);
    if (!relativePath) {
      return {
        ok: false,
        message: "No active markdown file",
      };
    }

    const needsBasePath = kind === "absolute" || kind === "absolute-tilde";
    const basePath = needsBasePath ? this.getVaultBasePath() : "";
    if (needsBasePath && !basePath) {
      return {
        ok: false,
        message: "Absolute paths are unavailable in this Obsidian runtime",
      };
    }

    const text = getYankPathText(
      kind,
      relativePath,
      basePath,
      getHomeDirectoryPath(),
    );
    if (text === null) {
      return {
        ok: false,
        message: "Unknown path yank command",
      };
    }

    return {
      ok: true,
      text,
    };
  }

  getVaultBasePath() {
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (!adapter || typeof adapter.getBasePath !== "function") {
      return "";
    }

    try {
      return normalizeFilesystemPath(adapter.getBasePath());
    } catch (error) {
      return "";
    }
  }

  async writeTextToClipboard(text, label) {
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      new Notice("Clipboard is unavailable");
      return false;
    }

    try {
      await clipboard.writeText(text);
      new Notice(`Copied ${label}`);
      return true;
    } catch (error) {
      new Notice(`Could not copy ${label}`);
      return false;
    }
  }

  handleVimLineLinkAction(cm, actionArgs, direction, defaultOffset) {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file) {
      return false;
    }

    // Snapshot the original cursor before a count selects another line and
    // before a picker takes focus. Counted Enter returns to this origin, not
    // to the counted link line.
    const jumpContext = this.beginVimLinkJump(cm);
    if (!jumpContext) {
      // No resolvable origin: fall through to the existing no-history path so
      // ordinary link opening keeps working.
    }

    const targetLine = getVimOffsetTargetLine(
      cm,
      actionArgs,
      direction,
      defaultOffset,
    );
    if (targetLine === null) {
      return false;
    }

    const lineText = getEditorLineText(cm, targetLine);
    if (lineText === null) {
      return false;
    }

    const candidates = this.collectLineLinkCandidates(lineText, view.file.path);
    if (candidates.length === 0) {
      return false;
    }

    if (candidates.length === 1) {
      this.openOrCreateLinkCandidate(candidates[0], jumpContext).catch(() => {
        new Notice("Could not open link target");
      });
      return true;
    }

    new LinkCandidatePickerModal(
      this.app,
      this,
      candidates,
      targetLine,
      jumpContext,
    ).open();
    return true;
  }

  handleVimEnterLinkAction(cm, actionArgs) {
    return this.handleVimLineLinkAction(cm, actionArgs, 1, 0);
  }

  handleVimBackspaceLinkAction(cm, actionArgs) {
    return this.handleVimLineLinkAction(cm, actionArgs, -1, -1);
  }

  collectLineLinkCandidates(lineText, sourcePath) {
    const candidates = this.extractLineLinks(lineText)
      .map((link, index) => this.toLineLinkCandidate(link, sourcePath, index))
      .filter(Boolean);

    return this.dedupeLineLinkCandidates(candidates);
  }

  extractLineLinks(lineText) {
    const line = String(lineText || "");
    const links = [];
    let index = 0;

    while (index < line.length) {
      const wikiIndex = line.indexOf("[[", index);
      const markdownIndex = this.findNextMarkdownLinkStart(line, index);
      const nextIndex = this.minPositiveIndex(wikiIndex, markdownIndex);

      if (nextIndex === -1) {
        break;
      }

      const link =
        nextIndex === wikiIndex
          ? this.parseWikiLinkAt(line, nextIndex, { allowTransclusion: true })
          : this.parseMarkdownLinkAt(line, nextIndex);

      if (!link) {
        index = nextIndex + 1;
        continue;
      }

      links.push(link);
      index = link.endIndex;
    }

    return links;
  }

  toLineLinkCandidate(link, sourcePath, index) {
    const target = this.normalizeLinkTarget(link && link.target);
    if (!target || isExternalLinkTarget(target)) {
      return null;
    }

    const resolvedFile = this.resolveLinkTargetFile(target, sourcePath);
    if (resolvedFile) {
      if (!this.isMarkdownFile(resolvedFile)) {
        return null;
      }

      return {
        actionKind: "open",
        actionLabel: "Open",
        index,
        label: this.getCandidateLabel(link, target, resolvedFile, null),
        path: resolvedFile.path,
        resolvedFile,
        sourcePath,
        subpath: getLinkSubpath(target),
        target,
      };
    }

    const creation = this.getCreationTargetForLinkTarget(target);
    if (!creation) {
      return null;
    }

    return {
      actionKind: "create",
      actionLabel: "Create",
      creation,
      index,
      label: this.getCandidateLabel(link, target, null, creation),
      path: creation.path,
      resolvedFile: null,
      sourcePath,
      subpath: getLinkSubpath(target),
      target,
    };
  }

  getCandidateLabel(link, target, resolvedFile, creation) {
    const renderedText = this.normalizeText(link && link.renderedText);
    if (renderedText) {
      return renderedText;
    }

    if (resolvedFile && resolvedFile.basename) {
      return resolvedFile.basename;
    }

    if (creation && creation.basename) {
      return creation.basename;
    }

    return this.basenameForRenderedWikiLink(target);
  }

  dedupeLineLinkCandidates(candidates) {
    const seenKeys = new Set();
    const uniqueCandidates = [];

    for (const candidate of candidates) {
      const key = this.getCandidateDedupeKey(candidate);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      uniqueCandidates.push(candidate);
    }

    return uniqueCandidates;
  }

  getCandidateDedupeKey(candidate) {
    if (candidate.actionKind === "open" && candidate.resolvedFile) {
      const linkText = this.stripMarkdownExtension(
        this.normalizeLinkTarget(candidate.target),
      );
      return `open:${candidate.resolvedFile.path}:${linkText}`;
    }

    if (candidate.actionKind === "create" && candidate.creation) {
      return `create:${candidate.creation.path}`;
    }

    return `${candidate.actionKind}:${candidate.target}`;
  }

  async openOrCreateLinkCandidate(candidate, jumpContext = null) {
    if (!candidate) {
      return false;
    }

    this.captureActiveFilePosition();

    // A stale picker (the user switched notes while it was open) never
    // records a false jump: still open the chosen target, but drop the
    // recording context.
    let effectiveJumpContext = jumpContext;
    if (
      effectiveJumpContext &&
      effectiveJumpContext.origin &&
      typeof effectiveJumpContext.origin.path === "string"
    ) {
      try {
        const activeFile =
          this.app && this.app.workspace
            ? this.app.workspace.getActiveFile()
            : null;
        const activePath =
          activeFile && typeof activeFile.path === "string"
            ? activeFile.path
            : null;
        if (activePath && activePath !== effectiveJumpContext.origin.path) {
          effectiveJumpContext = null;
        }
      } catch (error) {
        // Best-effort staleness check only.
      }
    }

    const expectedPath =
      candidate.resolvedFile && candidate.resolvedFile.path
        ? candidate.resolvedFile.path
        : candidate.creation && candidate.creation.path
          ? candidate.creation.path
          : typeof candidate.path === "string"
            ? candidate.path
            : null;

    let opened = false;
    if (candidate.resolvedFile) {
      opened = await this.openResolvedLink(
        candidate.target,
        candidate.sourcePath,
        "Link target not found",
      );
    } else {
      opened = await this.createNoteFromLinkCandidate(candidate);
    }

    if (!opened || !effectiveJumpContext || !expectedPath) {
      return opened;
    }

    try {
      await this.finishVimLinkJump(effectiveJumpContext, expectedPath);
    } catch (error) {
      // Recording must never turn a successful open into a failure.
    }

    return opened;
  }

  async createNoteFromLinkCandidate(candidate) {
    const creation =
      candidate.creation ||
      this.getCreationTargetForLinkTarget(candidate.target);
    if (!creation) {
      new Notice("Unsafe note target");
      return false;
    }

    const existingFile = this.app.vault.getAbstractFileByPath(creation.path);
    if (this.isMarkdownFile(existingFile)) {
      return this.openMarkdownFileWithLeafReuse(
        existingFile,
        "Could not open note",
      );
    }

    const templaterPlugin = this.getTemplaterPlugin();
    if (!templaterPlugin) {
      new Notice("Templater is not available");
      return false;
    }

    const templateSelection = getNoteTemplateForCreationPath(creation.path);
    const templateFile = this.getNoteTemplateFile(
      templateSelection.templatePath,
    );
    if (!templateFile) {
      new Notice(templateSelection.missingTemplateNotice);
      return false;
    }

    const folder = await this.ensureVaultFolder(creation.folderPath);
    if (folder === null) {
      return false;
    }

    try {
      const createdFile =
        await templaterPlugin.templater.create_new_note_from_template(
          templateFile,
          folder,
          creation.basename,
          true,
        );
      const createdIsMarkdown = this.isMarkdownFile(createdFile);
      if (createdIsMarkdown) {
        this.showCreatedNoteNotice(createdFile, creation.path);
      }
      return createdIsMarkdown;
    } catch (error) {
      new Notice("Could not create note from template");
      return false;
    }
  }

  async createProjectNote() {
    const creatingFile = this.app.workspace.getActiveFile();
    if (!this.isMarkdownFile(creatingFile)) {
      new Notice("Open an area or project note before creating a project");
      return false;
    }

    if (!this.isAreaOrProjectNote(creatingFile)) {
      new Notice(
        "Project notes can only be created from an area or project note",
      );
      return false;
    }

    const createdFile = await this.createProjectNoteFile(creatingFile);
    if (!createdFile) {
      return false;
    }

    this.showCreatedNoteNotice(createdFile, createdFile.path);
    return true;
  }

  openTaskMoveOrPomodoroBulletPicker(editor, view, options = {}) {
    const cursor = getEditorCursor(editor);
    if (editor && typeof editor.getValue === "function" && cursor) {
      const sourceContent = String(editor.getValue() || "");
      if (findPomodoroBulletContext(sourceContent, cursor.line)) {
        return this.openPomodoroBulletMovePicker(editor, view, options);
      }
      if (findPomodoroEntryContext(sourceContent, cursor.line)) {
        return this.openPomodoroEntryMovePicker(editor, view, options);
      }
    }

    return this.openTaskMoveDestinationPicker(editor, view, options);
  }

  openPomodoroBulletMovePicker(editor, view, options = {}) {
    let activePicker = this.activeTaskMoveDestinationPicker;
    if (
      activePicker &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(activePicker)
    ) {
      if (this.activeTaskMoveDestinationPicker === activePicker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      activePicker = null;
    }
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown Pomodoro note before moving bullets");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a Pomodoro sub-bullet");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverMovablePomodoroBulletTargets(
      sourceContent,
      cursor.line,
      options.additionalTaskCount || 0,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }

    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      discovery,
      entries: discovery.context.entries,
      sourceEntry: discovery.context.entry,
    });
    const picker = new PomodoroBulletMovePickerModal(
      this.app,
      this,
      session,
    );
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  openPomodoroEntryMovePicker(editor, view, options = {}) {
    let activePicker = this.activeTaskMoveDestinationPicker;
    if (
      activePicker &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(activePicker)
    ) {
      if (this.activeTaskMoveDestinationPicker === activePicker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      activePicker = null;
    }
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown Pomodoro note before moving bullets");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a Pomodoro entry");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverPomodoroEntryMoveTargets(
      sourceContent,
      cursor.line,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }

    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      ignoredCount: Math.max(
        0,
        Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
      ),
      discovery,
      entries: discovery.context.entries,
      sourceEntry: discovery.context.entry,
    });
    const picker = new PomodoroEntryMovePickerModal(this.app, this, session);
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  openTaskMoveDestinationPicker(editor, view, options = {}) {
    let activePicker = this.activeTaskMoveDestinationPicker;
    if (
      activePicker &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(activePicker)
    ) {
      if (this.activeTaskMoveDestinationPicker === activePicker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      activePicker = null;
    }
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown task before moving tasks");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a real #task checkbox");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverMovableObsidianTaskTargets(
      sourceContent,
      cursor.line,
      options.additionalTaskCount || 0,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }
    const ranges = buildTaskMoveRanges(sourceContent, discovery.targets);
    if (!ranges.valid) {
      new Notice(ranges.error);
      return false;
    }

    const vault = this.app && this.app.vault;
    const markdownFiles =
      vault && typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles()
        : [];
    const destinations = collectTaskMoveDestinations(
      markdownFiles,
      sourceFile.path,
      (file) => getFileChildNoteInfo(this.app, file, new Date()),
    );
    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    // Review-walk (nav-gestures): a landed move captures so the commit can
    // consume the landing and park the walk; a move never advances. While
    // the gesture lock is held the key is swallowed with no write. The
    // Pomodoro bullet and entry contexts use different pickers and never
    // match a landing, so only this task path captures.
    let reviewOrigin = null;
    try {
      if (typeof this.captureReviewGesture === "function") {
        const captured = this.captureReviewGesture(editor);
        if (captured && captured.busy === true) {
          return true;
        }
        reviewOrigin = captured || null;
      }
    } catch (error) {
      reviewOrigin = null;
    }
    this.taskMoveReviewCommitStarted = false;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      discovery,
      ranges: ranges.ranges,
      reviewOrigin,
    });
    const picker = new TaskMoveDestinationPickerModal(
      this.app,
      this,
      destinations,
      session,
    );
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  async getTaskMoveFileSnapshot(file) {
    if (!this.isMarkdownFile(file)) {
      throw new Error("Task move file is not Markdown");
    }
    const openEditor = this.getOpenMarkdownEditorForPath(file.path);
    if (openEditor && typeof openEditor.getValue === "function") {
      return Object.freeze({
        file,
        editor: openEditor,
        content: String(openEditor.getValue() || ""),
      });
    }
    if (!this.app.vault || typeof this.app.vault.cachedRead !== "function") {
      throw new Error("Vault content reads are unavailable");
    }
    return Object.freeze({
      file,
      editor: null,
      content: String((await this.app.vault.cachedRead(file)) || ""),
    });
  }

  async writeTaskMoveChange(path, change, file, session, finalCursor = null) {
    const sourceEditor =
      path === session.sourcePath ? session.editor : null;
    const editor = sourceEditor || this.getOpenMarkdownEditorForPath(path);
    if (editor && typeof editor.getValue === "function") {
      if (String(editor.getValue() || "") !== change.before) {
        throw new Error(`Task move preimage changed: ${path}`);
      }
      let applied = false;
      try {
        applied = applyEditorContentTransaction(
          editor,
          change.before,
          change.after,
          finalCursor,
        );
      } catch (error) {
        if (String(editor.getValue() || "") === change.after) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor,
            change,
          });
        }
        throw error;
      }
      if (!applied || String(editor.getValue() || "") !== change.after) {
        const error = new Error(`Task move editor transaction failed: ${path}`);
        if (String(editor.getValue() || "") === change.after) {
          error.taskMoveAppliedEntry = Object.freeze({ path, file, editor, change });
        }
        throw error;
      }
      return Object.freeze({ path, file, editor, change });
    }

    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      throw new Error("Vault content updates are unavailable");
    }
    let transformed = false;
    try {
      await vault.process(file, (content) => {
        if (String(content || "") !== change.before) {
          throw new Error(`Task move preimage changed: ${path}`);
        }
        transformed = true;
        return change.after;
      });
    } catch (error) {
      try {
        if (
          typeof vault.cachedRead === "function" &&
          String((await vault.cachedRead(file)) || "") === change.after
        ) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor: null,
            change,
          });
        }
      } catch (ignoredError) {
        // The original process error remains authoritative.
      }
      throw error;
    }
    if (!transformed) {
      throw new Error(`Task move file transaction failed: ${path}`);
    }
    return Object.freeze({ path, file, editor: null, change });
  }

  async rollbackTaskMoveChanges(written) {
    const failedPaths = [];
    for (const entry of (Array.isArray(written) ? written : []).slice().reverse()) {
      const editor =
        (entry.editor && typeof entry.editor.getValue === "function"
          ? entry.editor
          : this.getOpenMarkdownEditorForPath(entry.path));
      try {
        if (editor) {
          if (String(editor.getValue() || "") !== entry.change.after) {
            throw new Error("postimage changed");
          }
          if (
            !applyEditorContentTransaction(
              editor,
              entry.change.after,
              entry.change.before,
            ) ||
            String(editor.getValue() || "") !== entry.change.before
          ) {
            throw new Error("editor rollback failed");
          }
          continue;
        }
        let restored = false;
        await this.app.vault.process(entry.file, (content) => {
          if (String(content || "") !== entry.change.after) {
            throw new Error("postimage changed");
          }
          restored = true;
          return entry.change.before;
        });
        if (!restored) {
          throw new Error("file rollback failed");
        }
      } catch (error) {
        failedPaths.push(entry.path);
      }
    }
    return failedPaths;
  }

  restoreTaskMoveSourceContext(session) {
    const editor = session && session.editor;
    if (!editor) {
      return;
    }
    if (session.scroll && typeof editor.scrollTo === "function") {
      try {
        editor.scrollTo(session.scroll.left, session.scroll.top);
      } catch (error) {
        // Viewport restoration is best-effort after the guarded transaction.
      }
    }
    if (typeof editor.focus === "function") {
      try {
        editor.focus();
      } catch (error) {
        // The source leaf is already active; focus is a final nicety.
      }
    }
  }
}
