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
    const plugins = app && app.plugins && app.plugins.plugins;
    const plugin = plugins
      ? plugins["bob-chips"] ?? plugins["bob-copy-chips"]
      : null;
    const api = plugin && plugin.api && plugin.api.copyChips;
    return api && Number(api.version) >= 1 &&
        typeof api.chipAt === "function"
      ? api
      : null;
  } catch (_error) {
    return null;
  }
}

function resolveCopyCardChip(api, lines, selections, taskScopeLines) {
  if (!api) {
    return null;
  }
  const list = Array.isArray(selections) ? selections : [];
  if (list.length !== 1) {
    return null;
  }
  const selection = list[0] && typeof list[0] === "object" ? list[0] : null;
  const head = selection && (selection.head || selection);
  if (!head || !Number.isInteger(head.line) || !Number.isFinite(head.ch)) {
    return null;
  }
  try {
    const result = api.chipAt({
      lines,
      line: Math.floor(head.line),
      ch: Math.floor(head.ch),
      ...(Array.isArray(taskScopeLines)
        ? { scope: { kind: "task", lines: taskScopeLines } }
        : null),
    });
    if (result && result.state === "ready" && result.chip) {
      return {
        state: "ready",
        count: Number.isInteger(result.count) ? result.count : 1,
        scope: result.scope === "task" ? "task" : "cursor",
        chip: result.chip,
      };
    }
    if (result && result.state === "ambiguous") {
      const count = Number.isInteger(result.count) ? result.count : 0;
      return {
        state: "ambiguous",
        count,
        scope: result.scope === "task" ? "task" : "cursor",
      };
    }
    return null;
  } catch (_error) {
    return null;
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
    const taskScopeLines =
      task && (task.state === "ready" || task.state === "no-id")
        ? copyCardTaskScopeLines(lines, task.line)
        : null;
    const copyChip = resolveCopyCardChip(
      copyChipsApi,
      lines,
      selections,
      taskScopeLines,
    );
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
        new Notice(formatCopiedNotice(row.value));
      },
    });
    modal.open();
  }

  async copyCardRow(row, context) {
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
    } catch (error) {
      return {
        ok: false,
        reason: error && error.message ? error.message : "copy failed",
      };
    }
    if (row.id === "chip" && row.copyChip) {
      const options = context && typeof context === "object" ? context : {};
      const api = options.copyChipsApi || getCopyCardCopyChipsApi(this.app);
      if (api && typeof api.flash === "function") {
        try {
          api.flash(row.copyChip, { view: options.editorView || null });
        } catch (_error) {
          // Flash failures never turn a successful copy into a failure.
        }
      }
    }
    return { ok: true };
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
