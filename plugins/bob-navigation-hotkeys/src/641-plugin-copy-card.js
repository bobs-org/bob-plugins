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

function getCopyCardCopyChipsApi(app) {
  try {
    const plugin = app && app.plugins && app.plugins.plugins
      ? app.plugins.plugins["bob-copy-chips"]
      : null;
    const api = plugin && plugin.api && plugin.api.copyChips;
    return api && api.version === 1 &&
        typeof api.chipAt === "function" &&
        typeof api.copyChip === "function"
      ? api
      : null;
  } catch (_error) {
    return null;
  }
}

function resolveCopyCardChip(api, lines, selections) {
  if (!api) {
    return { state: "unavailable", reason: "Bob Copy Chips is not enabled" };
  }
  const list = Array.isArray(selections) ? selections : [];
  const selection = list.length === 1 && list[0] && typeof list[0] === "object"
    ? list[0]
    : null;
  const head = selection && (selection.head || selection);
  if (!head || !Number.isInteger(head.line) || !Number.isFinite(head.ch)) {
    return { state: "unavailable", reason: "No copy chip at the cursor" };
  }
  try {
    const result = api.chipAt({
      lines,
      line: Math.floor(head.line),
      ch: Math.floor(head.ch),
    });
    if (result && result.state === "ready" && result.chip) {
      return result;
    }
    if (result && result.state === "ambiguous") {
      const count = Number.isInteger(result.count) ? result.count : 0;
      return {
        state: "unavailable",
        reason: `${count} chips on this line · move onto one`,
      };
    }
    return { state: "unavailable", reason: "No copy chip at the cursor" };
  } catch (_error) {
    return { state: "unavailable", reason: "No copy chip at the cursor" };
  }
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
    const copyChipsApi = getCopyCardCopyChipsApi(this.app);
    const copyChip = resolveCopyCardChip(copyChipsApi, lines, selections);
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
      copyChip,
    });
    const editorView = editor && (editor.cm || editor.cm6)
      ? (editor.cm || editor.cm6)
      : null;

    const modal = new CopyCardModal(this.app, {
      model,
      onCopy: (row) => this.copyCardRow(row, { copyChipsApi, editorView }),
      onSuccess: (row) => {
        if (!row || row.id !== "copy-chip") {
          new Notice(formatCopiedNotice(row.value));
        }
      },
    });
    modal.open();
  }

  async copyCardRow(row, context) {
    if (row && row.id === "copy-chip") {
      const options = context && typeof context === "object" ? context : {};
      const api = options.copyChipsApi || getCopyCardCopyChipsApi(this.app);
      if (!api || typeof api.copyChip !== "function") {
        return { ok: false, reason: "Bob Copy Chips is not enabled" };
      }
      if (!row.copyChip) {
        return { ok: false, reason: row.reason || "No copy chip at the cursor" };
      }
      try {
        return await api.copyChip(row.copyChip, { view: options.editorView || null });
      } catch (error) {
        return {
          ok: false,
          reason: error && error.message ? error.message : "copy failed",
        };
      }
    }
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
    return this.writeTextToClipboard(task.blockId, "block ID");
  }
}
