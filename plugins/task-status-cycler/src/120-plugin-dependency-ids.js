class TaskStatusCyclerDependencyIdsMixin {
  scheduleActiveEditorDependencyNormalize(editor, info) {
    if (!editor) {
      return;
    }

    const file =
      (info && info.file) ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    this.invalidateDependencyAmbiguityCache(file && file.path);

    if (this.activeEditorDependencyTimer) {
      window.clearTimeout(this.activeEditorDependencyTimer);
    }
    this.activeEditorDependencyTimer = window.setTimeout(() => {
      this.activeEditorDependencyTimer = null;
      Promise.resolve(
        this.normalizeActiveEditorDependencyBlockIds(editor, file),
      ).catch(() => {});
    }, DEPENDENCY_NORMALIZE_DEBOUNCE_MS);
  }

  scheduleVaultFileDependencyNormalize(file) {
    if (!file || !file.path || !MARKDOWN_EXTENSION_RE.test(file.path)) {
      return;
    }
    this.invalidateDependencyAmbiguityCache(file.path);

    if (!this.vaultDependencyTimers) {
      this.vaultDependencyTimers = new Map();
    }

    const path = file.path;
    if (this.vaultDependencyTimers.has(path)) {
      window.clearTimeout(this.vaultDependencyTimers.get(path));
    }
    const timer = window.setTimeout(() => {
      this.vaultDependencyTimers.delete(path);
      Promise.resolve(
        this.normalizeVaultFileDependencyBlockIds(file),
      ).catch(() => {});
    }, DEPENDENCY_NORMALIZE_DEBOUNCE_MS);
    this.vaultDependencyTimers.set(path, timer);
  }

  invalidateDependencyAmbiguityCache(changedPath) {
    if (!this.dependencyAmbiguityCache) return;
    for (const path of this.dependencyAmbiguityCache.keys()) {
      if (!changedPath || path !== changedPath) {
        this.dependencyAmbiguityCache.delete(path);
      }
    }
  }

  notifyDependencyIssue(file, kind, values = []) {
    if (!this.dependencyIssueStates) this.dependencyIssueStates = new Map();
    const path = file && file.path ? file.path : "(active note)";
    const key = `${path}:${kind}`;
    const signature = [...values].sort().join(",");
    if (!signature) {
      this.dependencyIssueStates.delete(key);
      return;
    }
    if (this.dependencyIssueStates.get(key) === signature) return;
    this.dependencyIssueStates.set(key, signature);
    if (kind === "unsupported-path") {
      new Notice(
        `Dependency IDs were not normalized in ${path} because its path contains unsupported characters.`,
      );
      return;
    }
    new Notice(
      `Dependency IDs not normalized because they are ambiguous: ${signature}`,
    );
  }

  async normalizeActiveEditorDependencyBlockIds(editor, file) {
    if (!editor || typeof editor.getLine !== "function") {
      return false;
    }

    const oldLines = this.getEditorLineArray(editor);
    const snapshot = oldLines.join("\n");
    let result = normalizeTaskDependencyBlockIds(
      snapshot,
      file && file.path ? file.path : "Note.md",
    );
    const ambiguousIds = await this.findAmbiguousDependencyIds(
      Object.keys(result.idMap || {}),
      file,
      snapshot,
    );
    if (ambiguousIds.size > 0) {
      result = normalizeTaskDependencyBlockIds(
        oldLines.join("\n"),
        file && file.path ? file.path : "Note.md",
        { skipIds: ambiguousIds },
      );
    }
    this.notifyDependencyIssue(file, "ambiguity", ambiguousIds);
    this.notifyDependencyIssue(
      file,
      "unsupported-path",
      result.unsupportedPath ? [file && file.path ? file.path : "active"] : [],
    );

    if (this.getEditorLineArray(editor).join("\n") !== snapshot) {
      this.scheduleActiveEditorDependencyNormalize(editor, { file });
      return false;
    }

    if (result.changed) {
      const nextLines = result.text.split("\n");
      const cursor =
        typeof editor.getCursor === "function" ? editor.getCursor() : null;

      for (
        let line = 0;
        line < nextLines.length && line < oldLines.length;
        line += 1
      ) {
        if (
          nextLines[line] !== oldLines[line] &&
          typeof editor.replaceRange === "function"
        ) {
          editor.replaceRange(
            nextLines[line],
            { line, ch: 0 },
            { line, ch: oldLines[line].length },
          );
        }
      }

      if (cursor && typeof editor.setCursor === "function") {
        const cursorLineText =
          typeof editor.getLine === "function"
            ? editor.getLine(cursor.line) || ""
            : "";
        editor.setCursor({
          line: cursor.line,
          ch: Math.max(0, Math.min(cursor.ch, cursorLineText.length)),
        });
      }
    }

    await this.propagateDependencyBlockIds(result.idMap, file);
    return result.changed;
  }

  async normalizeVaultFileDependencyBlockIds(file) {
    if (!file || !this.app.vault) {
      return;
    }

    // Route the active file through the editor path so the cursor stays stable
    // and we never clobber an open editor buffer with a disk write.
    const activeView =
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    if (
      activeView &&
      activeView.editor &&
      activeView.file &&
      activeView.file.path === file.path
    ) {
      await this.normalizeActiveEditorDependencyBlockIds(activeView.editor, file);
      return;
    }

    const snapshot =
      typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
    let result = normalizeTaskDependencyBlockIds(snapshot, file.path);
    const ambiguousIds = await this.findAmbiguousDependencyIds(
      Object.keys(result.idMap || {}),
      file,
      snapshot,
    );
    if (ambiguousIds.size > 0) {
      result = normalizeTaskDependencyBlockIds(snapshot, file.path, {
        skipIds: ambiguousIds,
      });
    }
    this.notifyDependencyIssue(file, "ambiguity", ambiguousIds);
    this.notifyDependencyIssue(
      file,
      "unsupported-path",
      result.unsupportedPath ? [file.path] : [],
    );
    const idMap = result.idMap || {};
    await this.processVaultFileText(file, (text) =>
      text === snapshot && result.changed ? result.text : text,
    );

    await this.propagateDependencyBlockIds(idMap, file);
  }

  async findAmbiguousDependencyIds(ids, originFile, originText) {
    const candidates = new Set(ids || []);
    const originPath = originFile && originFile.path ? originFile.path : "(active note)";
    const idsKey = [...candidates].sort().join("\0");
    const originLines = splitTextByLineEndings(originText);
    const fenced = getFencedLineNumbers(originLines.map((line) => line.text));
    const identityLines = originLines
      .filter((line, lineNumber) => !fenced.has(lineNumber) && INLINE_ID_FIELD_RE.test(line.text))
      .map((line) => line.text)
      .join("\n");
    if (!this.dependencyAmbiguityCache) this.dependencyAmbiguityCache = new Map();
    const cached = this.dependencyAmbiguityCache.get(originPath);
    if (cached && cached.idsKey === idsKey && cached.identityLines === identityLines) {
      return new Set(cached.ambiguousIds);
    }
    const counts = new Map([...candidates].map((id) => [id, 0]));
    const countText = (text) => {
      const lines = splitTextByLineEndings(text);
      const fencedLines = getFencedLineNumbers(lines.map((line) => line.text));
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
        if (fencedLines.has(lineNumber)) continue;
        const line = lines[lineNumber];
        const match = line.text.match(INLINE_ID_FIELD_RE);
        if (match && candidates.has(match[2])) {
          counts.set(match[2], (counts.get(match[2]) || 0) + 1);
        }
      }
    };
    countText(originText);
    if (
      candidates.size > 0 &&
      this.app.vault &&
      typeof this.app.vault.getMarkdownFiles === "function"
    ) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file || (originFile && file.path === originFile.path)) continue;
        try {
          const text = typeof this.app.vault.cachedRead === "function"
            ? await this.app.vault.cachedRead(file)
            : await this.app.vault.read(file);
          countText(text);
        } catch (error) {
          // A file that cannot be preflighted makes every candidate unsafe.
          return candidates;
        }
      }
    }
    const ambiguousIds = new Set(
      [...counts].filter(([, count]) => count !== 1).map(([id]) => id),
    );
    this.dependencyAmbiguityCache.set(originPath, {
      idsKey,
      identityLines,
      ambiguousIds: [...ambiguousIds],
    });
    return ambiguousIds;
  }

  async propagateDependencyBlockIds(idMap, originFile) {
    const ids = idMap ? Object.keys(idMap) : [];
    if (
      !ids.length ||
      !this.app.vault ||
      typeof this.app.vault.getMarkdownFiles !== "function"
    ) {
      return;
    }

    const originPath = originFile && originFile.path ? originFile.path : null;
    const allFiles = this.app.vault.getMarkdownFiles();
    const openPaths = new Set(this.getOpenMarkdownFilePaths());
    // Narrow pass over open/current files first, then the rest of the vault.
    const orderedFiles = [
      ...allFiles.filter((candidate) => candidate && openPaths.has(candidate.path)),
      ...allFiles.filter((candidate) => candidate && !openPaths.has(candidate.path)),
    ];

    for (const candidate of orderedFiles) {
      if (!candidate || candidate.path === originPath) {
        continue;
      }

      let cachedText;
      try {
        cachedText =
          typeof this.app.vault.cachedRead === "function"
            ? await this.app.vault.cachedRead(candidate)
            : await this.app.vault.read(candidate);
      } catch (error) {
        continue;
      }

      const present = ids.filter((id) => cachedText.includes(id));
      if (!present.length) {
        continue;
      }

      const subset = {};
      for (const id of present) {
        subset[id] = idMap[id];
      }

      const openEditor = this.getOpenMarkdownEditor(candidate.path);
      const changed = openEditor
        ? this.rewriteOpenEditorDependencyIds(openEditor, subset)
        : await this.processVaultFileText(candidate, (text) => {
            const rewrite = rewriteDependsOnBlockIdsInText(text, subset);
            return rewrite.changed ? rewrite.text : text;
          });

      void changed;
    }
  }

  getOpenMarkdownEditor(filePath) {
    if (!this.app.workspace) return null;
    const active = typeof this.app.workspace.getActiveViewOfType === "function"
      ? this.app.workspace.getActiveViewOfType(MarkdownView)
      : null;
    if (active && active.file && active.file.path === filePath) {
      return active.editor || null;
    }
    if (typeof this.app.workspace.getLeavesOfType !== "function") return null;
    const leaf = this.app.workspace.getLeavesOfType("markdown").find(
      (candidate) =>
        candidate &&
        candidate.view &&
        candidate.view.file &&
        candidate.view.file.path === filePath,
    );
    return leaf && leaf.view ? leaf.view.editor || null : null;
  }

  rewriteOpenEditorDependencyIds(editor, idMap) {
    if (!editor || typeof editor.replaceRange !== "function") return false;
    const lines = this.getEditorLineArray(editor);
    const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : null;
    let changed = false;
    lines.forEach((lineText, line) => {
      const next = rewriteDependsOnIdsInLine(lineText, idMap);
      if (next !== lineText) {
        editor.replaceRange(next, { line, ch: 0 }, { line, ch: lineText.length });
        changed = true;
      }
    });
    if (cursor && typeof editor.setCursor === "function") {
      const text = editor.getLine(cursor.line) || "";
      editor.setCursor({ line: cursor.line, ch: Math.min(cursor.ch, text.length) });
    }
    return changed;
  }

  async reconcileRenamedDependencyIds(file, oldPath) {
    if (
      !file ||
      !file.path ||
      !MARKDOWN_EXTENSION_RE.test(file.path) ||
      !MARKDOWN_EXTENSION_RE.test(String(oldPath || ""))
    ) {
      return false;
    }
    const activeView =
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    const activeEditor =
      activeView && activeView.file && activeView.file.path === file.path
        ? activeView.editor
        : null;
    const activeLines = activeEditor ? this.getEditorLineArray(activeEditor) : null;
    const snapshot = activeLines
      ? activeLines.join("\n")
      : typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
    const result = rewriteRenamedDependencyIds(snapshot, oldPath, file.path);
    if (result.unsupportedPath) {
      this.notifyDependencyIssue(file, "unsupported-path", [file.path]);
      return false;
    }
    this.notifyDependencyIssue(file, "unsupported-path", []);
    if (!result.changed) return false;
    const collisions = await this.findDependencyIdentityCollisions(
      new Set(Object.values(result.idMap)),
      file,
    );
    if (collisions.size > 0) {
      throw new Error(
        `Dependency ID rename collision: ${[...collisions].join(", ")}`,
      );
    }
    if (
      activeEditor &&
      activeLines &&
      this.getEditorLineArray(activeEditor).join("\n") !== snapshot
    ) {
      this.scheduleRenamedDependencyReconcile(file, oldPath);
      return false;
    }
    let changed = false;
    if (activeEditor && activeLines) {
      const nextLines = result.text.split("\n");
      const cursor = typeof activeEditor.getCursor === "function"
        ? activeEditor.getCursor()
        : null;
      for (let line = 0; line < activeLines.length; line += 1) {
        if (nextLines[line] !== activeLines[line]) {
          activeEditor.replaceRange(
            nextLines[line],
            { line, ch: 0 },
            { line, ch: activeLines[line].length },
          );
          changed = true;
        }
      }
      if (cursor && typeof activeEditor.setCursor === "function") {
        const text = activeEditor.getLine(cursor.line) || "";
        activeEditor.setCursor({
          line: cursor.line,
          ch: Math.min(cursor.ch, text.length),
        });
      }
    } else {
      changed = await this.processVaultFileText(file, (text) =>
        text === snapshot ? result.text : text,
      );
    }
    await this.propagateDependencyBlockIds(result.idMap, file);
    return changed;
  }

  scheduleRenamedDependencyReconcile(file, oldPath) {
    if (!file || !file.path) return;
    if (!this.renamedDependencyTimers) this.renamedDependencyTimers = new Map();
    if (this.renamedDependencyTimers.has(file.path)) {
      window.clearTimeout(this.renamedDependencyTimers.get(file.path));
    }
    const timer = window.setTimeout(() => {
      this.renamedDependencyTimers.delete(file.path);
      Promise.resolve(this.reconcileRenamedDependencyIds(file, oldPath)).catch(
        () => {},
      );
    }, DEPENDENCY_NORMALIZE_DEBOUNCE_MS);
    this.renamedDependencyTimers.set(file.path, timer);
  }

  async findDependencyIdentityCollisions(newIds, originFile) {
    const collisions = new Set();
    if (
      !(newIds instanceof Set) ||
      newIds.size === 0 ||
      !this.app.vault ||
      typeof this.app.vault.getMarkdownFiles !== "function"
    ) {
      return collisions;
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file || (originFile && file.path === originFile.path)) continue;
      const text = typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
      for (const line of splitTextByLineEndings(text)) {
        const blockId = getTrailingBlockId(line.text);
        if (blockId) {
          const canonicalId = dependencyId(file.path, blockId);
          if (canonicalId && newIds.has(canonicalId)) collisions.add(canonicalId);
        }
      }
    }
    return collisions;
  }

  getOpenMarkdownFilePaths() {
    const paths = [];
    if (!this.app.workspace) {
      return paths;
    }

    if (typeof this.app.workspace.getActiveFile === "function") {
      const active = this.app.workspace.getActiveFile();
      if (active && active.path) {
        paths.push(active.path);
      }
    }

    if (typeof this.app.workspace.getLeavesOfType === "function") {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const leafFile = leaf && leaf.view && leaf.view.file;
        if (leafFile && leafFile.path) {
          paths.push(leafFile.path);
        }
      }
    }

    return paths;
  }

  async processVaultFileText(file, transform) {
    if (!file || !this.app.vault || typeof transform !== "function") {
      return false;
    }

    let changed = false;
    const applyTransform = (text) => {
      const next = transform(text);
      if (typeof next === "string" && next !== text) {
        changed = true;
        return next;
      }
      return text;
    };

    try {
      const snapshot =
        typeof this.app.vault.cachedRead === "function"
          ? await this.app.vault.cachedRead(file)
          : typeof this.app.vault.read === "function"
            ? await this.app.vault.read(file)
            : null;
      if (typeof snapshot !== "string") return false;
      const planned = applyTransform(snapshot);
      if (planned === snapshot) return false;
      changed = false;
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(file, (text) => {
          if (text === snapshot) {
            changed = true;
            return planned;
          }
          return applyTransform(text);
        });
        return changed;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return false;
      }

      const text = await this.app.vault.read(file);
      const nextText = applyTransform(text);
      if (!changed) {
        return false;
      }

      await this.app.vault.modify(file, nextText);
      return true;
    } catch (error) {
      return false;
    }
  }

}
