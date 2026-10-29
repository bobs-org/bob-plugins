class BobNavigationHotkeysParentChangeMixin {
  openParentChangePicker() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return false;
    }

    let active = this.activeParentNotePicker;
    if (
      active &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(active)
    ) {
      if (this.activeParentNotePicker === active) {
        this.activeParentNotePicker = null;
      }
      active = null;
    }
    if (active && active.pickerOpen === true) {
      if (active.inputEl && typeof active.inputEl.focus === "function") {
        active.inputEl.focus();
      }
      return true;
    }
    if (this.parentChangePickerOpening) {
      return true;
    }

    void this.openParentChangePickerNow(file);
    return true;
  }

  async openParentChangePickerNow(file) {
    this.parentChangePickerOpening = true;
    try {
      const context = await this.getActiveMarkdownContext();
      const content =
        context && context.file && context.file.path === file.path
          ? String(context.content || "")
          : "";
      const field = readParentFrontmatterField(content);
      const records = this.collectParentPickerRecords();
      const index = buildParentPickerIndex(records, { sourcePath: file.path });
      const initialQuery = this.parentChangeInitialQuery(file, field, index);
      const picker = new ParentNotePickerModal(this.app, this, {
        sourceFile: file,
        index,
        field,
        expectedRaw: field.raw,
        initialQuery,
      });
      this.activeParentNotePicker = picker;
      picker.open();
      return picker;
    } finally {
      this.parentChangePickerOpening = false;
    }
  }

  parentChangeInitialQuery(file, field, index) {
    if (index && index.currentParentPath) {
      const current = index.byPath.get(index.currentParentPath);
      if (current && current.basename) {
        return current.basename;
      }
      return parentNoteBasenameFromPath(index.currentParentPath);
    }
    if (field && field.state === "scalar" && field.target) {
      return parentNameLastSegment(field.target);
    }
    return "";
  }

  collectParentPickerRecords() {
    const vault = this.app && this.app.vault;
    const files =
      vault && typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles() || []
        : [];
    const workspace = this.app && this.app.workspace;
    const lastOpen =
      workspace && typeof workspace.getLastOpenFiles === "function"
        ? workspace.getLastOpenFiles() || []
        : [];
    const recentIndex = new Map();
    for (let index = 0; index < lastOpen.length; index += 1) {
      const path = lastOpen[index];
      if (path && !recentIndex.has(path)) {
        recentIndex.set(path, index);
      }
    }
    const now = new Date();
    const records = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      if (!this.isMarkdownFile(file)) {
        continue;
      }
      const cache =
        this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
          ? this.app.metadataCache.getFileCache(file)
          : null;
      const frontmatter = cache && cache.frontmatter;
      const links = this.getFrontmatterLinks(frontmatter, "parent");
      let parentPath = null;
      if (links.length === 1) {
        const resolved = this.resolveLinkTargetFile(links[0], file.path);
        if (resolved && resolved.path) {
          parentPath = resolved.path;
        }
      }
      const recentRank = recentIndex.has(file.path)
        ? recentIndex.get(file.path)
        : Infinity;
      records.push({
        path: file.path,
        basename: file.basename,
        file,
        noteInfo: getFileChildNoteInfo(this.app, file, now),
        parentPath,
        recentRank,
      });
    }
    return records;
  }

  parentChangeLinkFor(file) {
    return this.getFrontmatterWikiLinkToFile(file);
  }

  resolveParentChangeFile(file) {
    const cache =
      this.app.metadataCache &&
      typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
    const links = this.getFrontmatterLinks(cache && cache.frontmatter, "parent");
    if (links.length !== 1) {
      return null;
    }
    const resolved = this.resolveLinkTargetFile(links[0], file.path);
    return resolved && this.isMarkdownFile(resolved) ? resolved : null;
  }

  parentChangeLiveIndex(sourcePath) {
    return buildParentPickerIndex(this.collectParentPickerRecords(), {
      sourcePath,
    });
  }

  noticeParentChangeFailure(plan, candidate) {
    const name =
      (candidate && candidate.basename) ||
      (candidate && candidate.file && candidate.file.basename) ||
      "that note";
    if (!plan || plan.ok) {
      return;
    }
    if (plan.reason === "unclosed-frontmatter") {
      new Notice("Can't change parent: the frontmatter block has no closing ---");
      return;
    }
    if (plan.reason === "duplicate-parent-keys") {
      const count = Number(plan.count) || 2;
      new Notice(
        `Can't change parent: the frontmatter has ${count} parent: keys — fix them by hand first`,
      );
      return;
    }
    if (plan.reason === "unquotable-link") {
      new Notice(
        `Can't change parent: ${name}'s name can't be written as a quoted link`,
      );
      return;
    }
    if (plan.reason === "stale") {
      new Notice(
        "Parent changed while the panel was open — press Ctrl+Shift+- again",
      );
      return;
    }
    new Notice("Could not change parent");
  }

  noticeParentChangeSuccess(previousName, nextName) {
    if (previousName) {
      new Notice(`Parent: ${previousName} → ${nextName}`);
      return;
    }
    new Notice(`Parent set: ${nextName}`);
  }

  closeParentChangePicker() {
    const picker = this.activeParentNotePicker;
    if (picker && typeof picker.close === "function") {
      try {
        picker.close();
      } catch (_error) {
        this.activeParentNotePicker = null;
      }
    }
    this.activeParentNotePicker = null;
  }

  async commitParentChange({ file, candidate, expected }) {
    const candidateFile =
      candidate && candidate.file ? candidate.file : candidate;
    if (!this.isMarkdownFile(file) || !this.isMarkdownFile(candidateFile)) {
      this.closeParentChangePicker();
      return false;
    }
    const liveIndex = this.parentChangeLiveIndex(file.path);
    if (parentChangeWouldCycle(liveIndex, file.path, candidateFile.path)) {
      new Notice(
        `Can't make ${candidateFile.basename} the parent: it is inside this note's subtree`,
      );
      this.closeParentChangePicker();
      return false;
    }
    const currentParent = this.resolveParentChangeFile(file);
    if (currentParent && currentParent.path === candidateFile.path) {
      new Notice(`Parent unchanged: ${candidateFile.basename}`);
      this.closeParentChangePicker();
      return false;
    }
    const linkText = this.parentChangeLinkFor(candidateFile);
    const previousName = currentParent
      ? currentParent.basename
      : parentNameLastSegment(
          (this.activeParentNotePicker &&
            this.activeParentNotePicker.field &&
            this.activeParentNotePicker.field.target) ||
            "",
        );
    const view = this.getActiveMarkdownView();
    const editor =
      view &&
      view.file &&
      view.file.path === file.path &&
      typeof view.getMode === "function" &&
      view.getMode() === "source" &&
      view.editor
        ? view.editor
        : null;

    const finish = (plan) => {
      if (!plan || !plan.ok) {
        this.noticeParentChangeFailure(plan, candidateFile);
        this.closeParentChangePicker();
        return false;
      }
      if (!plan.changed) {
        new Notice(`Parent unchanged: ${candidateFile.basename}`);
        this.closeParentChangePicker();
        return false;
      }
      this.noticeParentChangeSuccess(previousName, candidateFile.basename);
      this.closeParentChangePicker();
      return true;
    };

    if (editor && typeof editor.getValue === "function") {
      const content = editor.getValue();
      const plan = planParentFrontmatterEdit(content, linkText, {
        expectedRaw: expected,
      });
      if (!plan.ok || !plan.changed) {
        return finish(plan);
      }
      applyEditorContentTransaction(editor, content, plan.content);
      return finish(plan);
    }

    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      new Notice("Could not change parent: vault write is unavailable");
      this.closeParentChangePicker();
      return false;
    }
    let plan = null;
    try {
      await vault.process(file, (data) => {
        plan = planParentFrontmatterEdit(data, linkText, {
          expectedRaw: expected,
        });
        if (!plan.ok || !plan.changed) {
          return data;
        }
        return plan.content;
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      new Notice(`Could not change parent: ${message}`);
      this.closeParentChangePicker();
      return false;
    }
    return finish(plan);
  }
}
