class BobNavigationHotkeysProjectNoteMixin {

  async createProjectNoteFile(creatingFile, basename) {
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
          applyProjectCreationFrontmatter(frontmatter, parentLink);
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

  async writeProjectPromotionAnchors(path, file, seedContent, promotionPlan) {
    const normalized = normalizeVaultRelativePath(path);
    if (
      !normalized ||
      normalizeVaultRelativePath(file && file.path) !== normalized
    ) {
      throw new Error(`Promotion file path changed: ${normalized}`);
    }
    const rebase = (content) => {
      const result = rebaseProjectPromotionAnchorPlan(
        seedContent,
        String(content || ""),
        promotionPlan,
      );
      if (!result.ok) {
        throw new Error(`Promotion preimage changed: ${normalized}`);
      }
      return result;
    };
    const editor = this.getOpenMarkdownEditorForPath(normalized);
    if (editor && typeof editor.getValue === "function") {
      const before = String(editor.getValue() || "");
      const result = rebase(before);
      if (
        result.content !== before &&
        (!applyEditorContentTransaction(editor, before, result.content) ||
          String(editor.getValue() || "") !== result.content)
      ) {
        throw new Error(`Promotion editor write failed: ${normalized}`);
      }
      return result;
    }

    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      throw new Error(`Vault content updates are unavailable: ${normalized}`);
    }
    let result = null;
    let transformed = false;
    await vault.process(file, (content) => {
      result = rebase(content);
      transformed = true;
      return result.content;
    });
    if (!transformed || !result) {
      throw new Error(`Promotion file write failed: ${normalized}`);
    }
    return result;
  }
}
