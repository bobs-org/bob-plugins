// Copy card plugin mixin: Cmd+Y Copy card, clipboard writes, and the
// yank-block-id palette command. The model (101/101a/102) is frozen at open;
// this mixin only gathers the active file, editor guards, vault paths, and
// templates, then hands the frozen model to CopyCardModal (103).

function copyCardEditorGuardsOk(view, editor) {
  if (!view || !editor) {
    return false;
  }
  if (
    view.file === null ||
    view.file === undefined ||
    typeof view.file.path !== "string" ||
    !view.file.path
  ) {
    return false;
  }
  if (typeof view.getMode === "function") {
    const mode = String(view.getMode() || "").toLowerCase();
    if (mode === "preview" || mode === "reading") {
      return false;
    }
  }
  if (
    editor &&
    typeof editor.listSelections === "function" &&
    editor.listSelections().length !== 1
  ) {
    return false;
  }
  return true;
}

class BobNavigationHotkeysCopyCardMixin {
  openCopyCard() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const view =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    const editor = (view && view.editor) || null;
    const guardsOk = copyCardEditorGuardsOk(view, editor);

    let lines = [];
    let selections = [];
    if (guardsOk && editor && typeof editor.getValue === "function") {
      lines = String(editor.getValue() || "").split(/\r?\n/);
      if (typeof editor.listSelections === "function") {
        try {
          selections = editor.listSelections() || [];
        } catch (_error) {
          selections = [];
        }
      } else if (
        typeof editor.getCursor === "function" &&
        editor.getCursor() &&
        Number.isInteger(editor.getCursor().line)
      ) {
        const cursor = editor.getCursor();
        selections = [{ anchor: cursor, head: cursor }];
      }
    } else {
      selections = [];
    }

    const task = resolveCopyCardTask(lines, selections.length === 1 ? selections : []);
    const relativePath = getVaultRelativeFilePath(file);
    const basePath = this.getVaultBasePath();
    const homePath = getHomeDirectoryPath();
    let loaded = null;
    try {
      loaded = loadCopyCardTemplates();
    } catch (_error) {
      loaded = null;
    }
    const templates = loaded && Array.isArray(loaded.templates) ? loaded.templates : [];
    const diagnostic =
      loaded && typeof loaded.diagnostic === "string" ? loaded.diagnostic : null;
    const model = buildCopyCardModel({
      filePath: relativePath,
      basePath,
      homePath,
      task,
      templates,
      diagnostic,
    });

    const modal = new CopyCardModal(this.app, {
      model,
      onCopy: (row) => this.copyCardRow(row),
      onSuccess: (row) => {
        new Notice(formatCopiedNotice(row.value));
      },
    });
    modal.open();
  }

  async copyCardRow(row) {
    if (!row || typeof row.value !== "string" || !row.value) {
      return { ok: false, reason: (row && row.reason) || "nothing to copy" };
    }
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      return { ok: false, reason: "clipboard is unavailable" };
    }
    try {
      await clipboard.writeText(row.value);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error && error.message ? error.message : "copy failed",
      };
    }
  }

  yankTaskBlockId() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return false;
    }
    const view =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    const editor = (view && view.editor) || null;
    if (!copyCardEditorGuardsOk(view, editor) || typeof editor.getValue !== "function") {
      new Notice("No task at the cursor");
      return false;
    }
    let selections = [];
    if (typeof editor.listSelections === "function") {
      try {
        selections = editor.listSelections() || [];
      } catch (_error) {
        selections = [];
      }
    }
    const lines = String(editor.getValue() || "").split(/\r?\n/);
    const task = resolveCopyCardTask(lines, selections.length === 1 ? selections : []);
    if (!task || task.state === "none") {
      new Notice("No task at the cursor");
      return false;
    }
    if (task.state === "no-id" || !task.blockId) {
      new Notice("This task has no block ID yet · Ctrl+6 on the task line names one");
      return false;
    }
    return this.writeTextToClipboard(`^${task.blockId}`, "block ID");
  }
}
