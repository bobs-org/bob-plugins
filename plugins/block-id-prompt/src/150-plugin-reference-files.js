class BlockIdPromptReferenceFilesMixin {
  async readDestinationForValidation(source) {
    const file = this.resolveDestinationFile(source);
    if (!file) {
      return null;
    }

    if (file.path === source.sourcePath && typeof source.editor.getValue === "function") {
      return {
        file,
        content: source.editor.getValue(),
      };
    }

    // Prefer a live target buffer over stale disk so suggestions,
    // validation, and writes stay coherent; disagreeing buffers refuse.
    if (typeof readAuthoritativePromptTargetContent === "function") {
      try {
        const snapshot = await readAuthoritativePromptTargetContent(this, source, file);
        if (snapshot.ambiguous) {
          return { file, content: null };
        }
        if (snapshot.content !== null) {
          return { file, content: snapshot.content };
        }
      } catch (error) {
        // Fall through to the vault read below.
      }
    }

    try {
      return {
        file,
        content: await this.app.vault.read(file),
      };
    } catch (error) {
      console.error("Block ID Prompt failed to read target note", error);
      return {
        file,
        content: null,
      };
    }
  }

  async readBlockPreviewText(source) {
    if (Object.prototype.hasOwnProperty.call(source, "previewText")) {
      return source.previewText || null;
    }

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination || destination.content === null) {
        return null;
      }

      return extractBlockPreviewText(destination.content, source.oldId);
    } catch (error) {
      return null;
    }
  }

  resolveDestinationFile(source) {
    return this.resolveReferenceDestination(source, source.sourcePath);
  }

  resolveReferenceDestination(reference, sourcePath) {
    const linkText = stripMarkdownExtension(normalizeLinkTarget(reference.targetText));
    const lookupText = stripLinkSubpath(linkText);

    if (!lookupText) {
      const currentFile = this.app.vault.getAbstractFileByPath(sourcePath);
      return currentFile instanceof TFile ? currentFile : null;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(
      lookupText,
      sourcePath,
    );

    return file instanceof TFile ? file : null;
  }

  async collectCandidateReferenceFiles(destinationFile, source) {
    // Candidates are discovered from Obsidian's in-memory metadata cache only
    // (backlinks + resolvedLinks). We intentionally do NOT scan every vault note
    // from disk: on a large vault that was thousands of sequential reads per
    // rename. Downstream (buildReferenceRewritePlan / applyReferenceRewritePlan)
    // re-reads, re-parses, and re-verifies every candidate, so narrowing the set
    // never weakens correctness — it only changes which files we look at.
    //
    // Accepted residual risk: a note that references the block but was edited
    // *externally* (e.g. by bob-cli) and not yet re-indexed by Obsidian could be
    // missed until Obsidian re-indexes it (which it does on file change). The two
    // common cases — the active note and the destination note — are always
    // covered below regardless of cache freshness.
    const candidatePaths = new Set();
    this.addCandidatePath(candidatePaths, destinationFile.path);
    // Always include the current/active note, independent of the metadata cache.
    // Never remove this: the user often renames a block id immediately after
    // Obsidian auto-creates it when linking to an unnamed block, and at that
    // instant the active note may not yet be re-indexed. readFileSnapshot reads
    // this note from the live editor buffer (source.editor.getValue()), so even
    // unsaved edits are handled correctly.
    this.addCandidatePath(candidatePaths, source.sourcePath);
    this.addBacklinkCandidatePaths(candidatePaths, destinationFile);
    this.addResolvedLinkCandidatePaths(candidatePaths, destinationFile);

    return Array.from(candidatePaths)
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file) => file instanceof TFile && file.extension === "md")
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  addCandidatePath(candidatePaths, path) {
    if (typeof path === "string" && path) {
      candidatePaths.add(path);
    }
  }

  addBacklinkCandidatePaths(candidatePaths, destinationFile) {
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return;
    }

    const backlinks = metadataCache.getBacklinksForFile(destinationFile);
    const data = backlinks && backlinks.data;
    if (!data) {
      return;
    }

    if (data instanceof Map) {
      for (const path of data.keys()) {
        this.addCandidatePath(candidatePaths, path);
      }
      return;
    }

    if (typeof data === "object") {
      for (const path of Object.keys(data)) {
        this.addCandidatePath(candidatePaths, path);
      }
    }
  }

  addResolvedLinkCandidatePaths(candidatePaths, destinationFile) {
    const resolvedLinks = this.app.metadataCache && this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks || typeof resolvedLinks !== "object") {
      return;
    }

    for (const [sourcePath, destinations] of Object.entries(resolvedLinks)) {
      if (
        destinations &&
        Object.prototype.hasOwnProperty.call(destinations, destinationFile.path)
      ) {
        this.addCandidatePath(candidatePaths, sourcePath);
      }
    }
  }

  async readFileSnapshot(file, source) {
    if (
      file.path === source.sourcePath &&
      source.editor &&
      typeof source.editor.getValue === "function"
    ) {
      return source.editor.getValue();
    }

    try {
      return await this.app.vault.read(file);
    } catch (error) {
      console.error("Block ID Prompt failed to read note", error);
      return null;
    }
  }

  async applyReferenceRewritePlan(plan, source) {
    if (!(await this.verifyPlannedFilesUnchanged(plan, source))) {
      return false;
    }

    for (const filePlan of plan.filePlans) {
      if (!(await this.applyReferenceEdits(filePlan, source))) {
        return false;
      }
    }

    return true;
  }

  async verifyPlannedFilesUnchanged(plan, source) {
    for (const filePlan of plan.filePlans) {
      const currentContent = await this.readFileSnapshot(filePlan.file, source);
      if (currentContent === null) {
        new Notice(`Block ID rename blocked: ${filePlan.file.path} could not be read`);
        return false;
      }

      if (currentContent !== filePlan.content) {
        new Notice(
          `Block ID rename blocked: ${filePlan.file.path} changed before rewrite`,
        );
        return false;
      }
    }

    return true;
  }

  async applyReferenceEdits(filePlan, source) {
    if (filePlan.file.path === source.sourcePath) {
      return this.applyActiveReferenceEdits(filePlan, source.editor);
    }

    const nextContent = applyTextEdits(filePlan.content, filePlan.edits);
    try {
      await this.app.vault.modify(filePlan.file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify backlink note", error);
      new Notice(`Block ID rename stopped: ${filePlan.file.path} could not be modified`);
      return false;
    }
  }

  applyActiveReferenceEdits(filePlan, editor) {
    if (!editor || typeof editor.replaceRange !== "function") {
      new Notice("Block ID rename stopped: active note could not be modified");
      return false;
    }

    this.suppressEditorScans();
    const sorted = [...filePlan.edits].sort((left, right) => right.start - left.start);
    for (const edit of sorted) {
      editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(filePlan.content, edit.start),
        indexToEditorPosition(filePlan.content, edit.end),
      );
    }

    return true;
  }

  async renameDestinationBlock(file, source, oldId, newId, expectedContent) {
    if (newId === oldId) {
      return true;
    }

    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      new Notice(`Block ID rename stopped: ${file.path} could not be read`);
      return false;
    }

    if (typeof expectedContent === "string" && content !== expectedContent) {
      new Notice(`Block ID rename stopped: ${file.path} changed before rename`);
      return false;
    }

    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${file.path}`);
      return false;
    }

    const matches = blockTokenMatches(content, oldId);
    if (matches.length !== 1) {
      new Notice(
        `Block ID rename stopped: old ID was not found exactly once in ${file.path}`,
      );
      return false;
    }

    const match = matches[0];
    if (file.path === source.sourcePath) {
      this.suppressEditorScans();
      source.editor.replaceRange(
        `^${newId}`,
        indexToEditorPosition(content, match.start),
        indexToEditorPosition(content, match.end),
      );
      return true;
    }

    const nextContent =
      content.slice(0, match.start) + `^${newId}` + content.slice(match.end);
    try {
      await this.app.vault.modify(file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify target note", error);
      new Notice(`Block ID rename stopped: ${file.path} could not be modified`);
      return false;
    }
  }

  suppressEditorScans() {
    this.suppressUntil = Date.now() + EDIT_SUPPRESS_MS;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
      this.scanView = null;
    }
  }

  // The "today" clock for planTargetTaskUpdate's future-schedule comparison.
  // Overridable so tests can inject a fixed local date.
  now() {
    return new Date();
  }

  // Task freshness stamper from bob-ledger-tools (api `version >= 3`).
  // Placement lives in ledger-tools; this plugin only calls
  // `api?.freshness?.stampLine?.(line, dateText) ?? line`. Returns undefined
  // when ledger-tools is absent or old, in which case gestures simply don't
  // stamp.
  getFreshnessStampLine() {
    try {
      const plugins = this.app && this.app.plugins;
      const byId =
        plugins && plugins.plugins
          ? plugins.plugins["bob-ledger-tools"]
          : null;
      const holder =
        byId ||
        (plugins && typeof plugins.getPlugin === "function"
          ? plugins.getPlugin("bob-ledger-tools")
          : null);
      const api = holder && holder.api;
      if (!api || api.version < 3 || !api.freshness) {
        return undefined;
      }
      const stampLine = api.freshness.stampLine;
      if (typeof stampLine !== "function") {
        return undefined;
      }
      return stampLine.bind(api.freshness);
    } catch (error) {
      return undefined;
    }
  }

  getFreshnessDateText() {
    try {
      return formatCalendarDate(localTodayParts(this.now()));
    } catch (error) {
      return undefined;
    }
  }

}
