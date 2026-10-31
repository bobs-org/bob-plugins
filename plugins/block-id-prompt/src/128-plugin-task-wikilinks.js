// `((` Task Wikilink Picker wiring: written-range accumulation, the
// `link-task-wikilink` command, snapshot opens, and identified-link insert.

function taskWikilinkLineForIdentity(content, task) {
  const lines = String(content || "").split("\n");
  if (
    task && Number.isInteger(task.line) &&
    lines[task.line] === task.rawLine
  ) {
    return { line: task.line, rawLine: task.rawLine };
  }
  const matches = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (lines[line] === (task && task.rawLine)) {
      matches.push(line);
    }
  }
  return matches.length === 1
    ? { line: matches[0], rawLine: task.rawLine }
    : null;
}

function dispatchTaskWikilinkCompletion(editor, changes, caret) {
  const cm = editor && editor.cm;
  if (!cm || typeof cm.dispatch !== "function" || !cm.state || !cm.state.doc) {
    return false;
  }
  try {
    const mapped = (changes || []).map((change) => ({
      from: change.from,
      to: change.to,
      insert: change.insert,
    }));
    if (mapped.length === 0) {
      return false;
    }
    cm.dispatch({
      changes: mapped.length === 1 ? mapped[0] : mapped,
      selection: { anchor: caret },
      userEvent: "input.complete",
      scrollIntoView: true,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

class BlockIdPromptTaskWikilinksMixin {
  ensureTaskWikilinkIndex() {
    if (this.taskWikilinkIndex) {
      return this.taskWikilinkIndex;
    }
    this.taskWikilinkIndex = new TaskWikilinkIndex();
    this.taskWikilinkWrittenRanges = [];
    return this.taskWikilinkIndex;
  }

  startTaskWikilinkIndex() {
    const index = this.ensureTaskWikilinkIndex();
    index.attachLiveUpdates(this, this.app);
    const workspace = this.app && this.app.workspace;
    const start = () => {
      void index.warmUpFromVault(this.app);
    };
    if (workspace && typeof workspace.onLayoutReady === "function") {
      workspace.onLayoutReady(start);
    } else {
      start();
    }
  }

  recordTaskWikilinkWrittenRanges(update) {
    if (!update || !update.docChanged) {
      return;
    }
    if (!Array.isArray(this.taskWikilinkWrittenRanges)) {
      this.taskWikilinkWrittenRanges = [];
    }
    const changeSet = taskWikilinkChangeSetFromUpdate(update);
    if (taskWikilinkUpdateIsUserInput(update)) {
      addTaskWikilinkChanges(this.taskWikilinkWrittenRanges, changeSet);
    } else {
      mapTaskWikilinkRanges(this.taskWikilinkWrittenRanges, changeSet);
    }
  }

  clearTaskWikilinkWrittenRanges() {
    this.taskWikilinkWrittenRanges = [];
  }

  editorMarkdownLines(editor) {
    if (!editor) {
      return [];
    }
    if (typeof editor.lineCount === "function") {
      const lines = [];
      const count = editor.lineCount();
      for (let index = 0; index < count; index += 1) {
        lines.push(editor.getLine(index) || "");
      }
      return lines;
    }
    if (typeof editor.getValue === "function") {
      return String(editor.getValue() || "").split("\n");
    }
    return [];
  }

  editorLineStartOffset(editor, line) {
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      offset += (editor.getLine(index) || "").length + 1;
    }
    return offset;
  }

  isTaskWikilinkReadingView(view) {
    try {
      if (view && typeof view.getMode === "function" && view.getMode() === "preview") {
        return true;
      }
      const state = view && typeof view.getState === "function" ? view.getState() : null;
      if (state && state.mode === "preview") {
        return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  isTaskWikilinkComposing(view) {
    try {
      if (view && view.editor && view.editor.cm && view.editor.cm.composing) {
        return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  taskWikilinkSourceFromToken(editor, sourcePath, line, lineText, token, extra) {
    return {
      kind: "task-wikilink",
      trigger: "((",
      editor,
      sourcePath,
      line,
      replaceStart: token.replaceStart,
      replaceEnd: token.replaceEnd,
      startCh: token.replaceStart,
      endCh: token.replaceEnd,
      query: token.query || "",
      raw: lineText.slice(token.replaceStart, token.replaceEnd),
      removal: token.removal || null,
      opener: token.opener,
      closer: token.closer,
      ...(extra || {}),
    };
  }

  maybeOpenTaskWikilinkFromEditor(view, file, cursor, lineText, writtenRanges = this.taskWikilinkWrittenRanges) {
    const editor = view.editor;
    if (this.isTaskWikilinkReadingView(view) || this.isTaskWikilinkComposing(view)) {
      const token = findTaskWikilinkToken(lineText, cursor.ch || 0);
      this.clearTaskWikilinkWrittenRanges();
      return Boolean(token);
    }
    const token = findTaskWikilinkToken(lineText, cursor.ch || 0);
    if (!token) {
      this.clearTaskWikilinkWrittenRanges();
      return false;
    }
    const lines = this.editorMarkdownLines(editor);
    const context = taskWikilinkContextAt(lines, cursor.line, cursor.ch || 0);
    const lineStart = this.editorLineStartOffset(editor, cursor.line);
    const wroteSecond = taskWikilinkWrittenSecondParen(
      token,
      writtenRanges,
      lineStart,
    );
    this.clearTaskWikilinkWrittenRanges();
    if (!context.allowed) {
      if (wroteSecond && context.notice) {
        const key = `twl-notice:${file.path}:${cursor.line}:${token.opener}`;
        if (this.lastPromptKey !== key) {
          new Notice(context.notice);
          this.lastPromptKey = key;
        }
      }
      return true;
    }
    if (!wroteSecond) {
      return true;
    }
    this.openTaskWikilinkPicker(
      this.taskWikilinkSourceFromToken(editor, file.path, cursor.line, lineText, token),
    );
    return true;
  }

  linkTaskWikilinkCommand(editor, view) {
    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("Task wikilinks can't go here");
      return;
    }
    if (this.isTaskWikilinkReadingView(markdownView) || this.isTaskWikilinkComposing(markdownView)) {
      new Notice("Task wikilinks can't go here");
      return;
    }
    if (!this.hasSingleCursor(editor)) {
      new Notice("Task wikilinks can't go here");
      return;
    }
    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Task wikilinks can't go here");
      return;
    }
    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      new Notice("Task wikilinks can't go here");
      return;
    }
    const lineText = editor.getLine(cursor.line) || "";
    const context = taskWikilinkContextAt(
      this.editorMarkdownLines(editor),
      cursor.line,
      cursor.ch || 0,
    );
    if (!context.allowed) {
      new Notice(context.notice || "Task wikilinks can't go here");
      return;
    }
    if (this.promptOpen) {
      return;
    }
    const token = findTaskWikilinkToken(lineText, cursor.ch || 0);
    if (token) {
      this.openTaskWikilinkPicker(
        this.taskWikilinkSourceFromToken(editor, file.path, cursor.line, lineText, token, {
          fromCommand: true,
        }),
      );
      return;
    }
    if (selection && !selection.empty && selection.from.line === selection.to.line) {
      const raw = lineText.slice(selection.from.ch, selection.to.ch);
      this.openTaskWikilinkPicker({
        kind: "task-wikilink",
        trigger: "((",
        editor,
        sourcePath: file.path,
        line: selection.from.line,
        replaceStart: selection.from.ch,
        replaceEnd: selection.to.ch,
        startCh: selection.from.ch,
        endCh: selection.to.ch,
        query: raw,
        raw,
        removal: null,
        fromCommand: true,
        selectionReplacement: true,
      });
      return;
    }
    this.openTaskWikilinkPicker({
      kind: "task-wikilink",
      trigger: "((",
      editor,
      sourcePath: file.path,
      line: cursor.line,
      replaceStart: cursor.ch,
      replaceEnd: cursor.ch,
      startCh: cursor.ch,
      endCh: cursor.ch,
      query: "",
      raw: "",
      removal: null,
      fromCommand: true,
    });
  }

  taskWikilinkSnapshot(source) {
    const index = this.ensureTaskWikilinkIndex();
    const overlays = index.collectEditorOverlays(this.app);
    if (source && source.editor && source.sourcePath && typeof source.editor.getValue === "function") {
      try {
        overlays.set(source.sourcePath, String(source.editor.getValue() || ""));
      } catch (error) {
        // Source overlay is best-effort; disk rows still paint.
      }
    }
    return index.snapshot({
      ownerPath: source && source.sourcePath,
      overlays,
      statOf: index.vaultStatOf(this.app),
    });
  }

  openTaskWikilinkPicker(source) {
    if (this.promptOpen) {
      return;
    }
    this.ensureTaskWikilinkIndex();
    const key = sourceKey(source);
    this.lastPromptKey = key;
    this.promptOpen = true;
    const snapshot = this.taskWikilinkSnapshot(source);
    new TaskWikilinkPickerModal(this.app, this, source, snapshot).open();
    void this.taskWikilinkIndex.drainReparseQueue(this.app);
  }

  taskWikilinkTokenStillPresent(source) {
    if (!source || !source.editor || typeof source.editor.getLine !== "function") {
      return false;
    }
    const lineText = source.editor.getLine(source.line) || "";
    const current = lineText.slice(source.replaceStart, source.replaceEnd);
    return current === source.raw;
  }

  async validateTaskWikilinkId(source, id) {
    if (!BLOCK_ID_RE.test(String(id || ""))) {
      return { valid: false, message: "Use letters, numbers, and dashes" };
    }
    if (!this.taskWikilinkTokenStillPresent(source)) {
      return { valid: false, message: "The ((…)) text changed" };
    }
    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      return { valid: false, message: "The target note could not be checked" };
    }
    if (destination.file.path !== source.task.notePath) {
      return { valid: false, message: "The task note no longer resolves" };
    }
    const task = taskWikilinkLineForIdentity(destination.content, source.task);
    if (!task) {
      return { valid: false, message: "The selected task moved or changed" };
    }
    if (getTrailingBlockId(task.rawLine)) {
      return { valid: false, message: "The task already has a block ID" };
    }
    if (blockTokenMatches(destination.content, id).length > 0) {
      return { valid: false, message: `^${id} already exists in ${destination.file.path}` };
    }
    return { valid: true, message: "Ready to add the ID and link" };
  }

  countTaskWikilinkBlockId(path, content, blockId) {
    const settings =
      (this.taskWikilinkIndex && this.taskWikilinkIndex.settings) ||
      defaultTaskWikilinkSettings();
    const rows = parseNoteTaskRows(path, String(content || ""), settings);
    const matches = rows.filter((row) => row.blockId === blockId);
    if (matches.length === 0) {
      return { count: 0, taskLine: null };
    }
    if (matches.length > 1 || matches[0].duplicateId) {
      return { count: 2, taskLine: matches[0].line };
    }
    return { count: 1, taskLine: matches[0].line };
  }

  async acceptTaskWikilinkIdentified(source, item) {
    const row = item && item.row;
    if (!row || !row.blockId) {
      return { ok: false };
    }
    if (this.taskWikilinkPomodoroContext(source)) {
      return this.taskWikilinkPomodoroCommit(source, row, {
        id: row.blockId,
        pomodoroTarget: item.pomodoroTarget,
      });
    }
    if (!this.taskWikilinkTokenStillPresent(source)) {
      new Notice("Task wikilink not inserted: the ((…)) text changed");
      return { ok: false, stale: true };
    }
    const file = this.app.vault.getAbstractFileByPath
      ? this.app.vault.getAbstractFileByPath(row.notePath)
      : null;
    const targetFile = file instanceof TFile ? file : { path: row.notePath };
    const authoritative = await readAuthoritativePromptTargetContent(this, source, targetFile);
    if (!authoritative || typeof authoritative.content !== "string") {
      new Notice(`Task wikilink not inserted: ${row.notePath} no longer has ^${row.blockId}`);
      this.refreshTaskWikilinkNote(row.notePath, null);
      return { ok: false, stale: true };
    }
    const found = this.countTaskWikilinkBlockId(row.notePath, authoritative.content, row.blockId);
    if (found.count === 0) {
      new Notice(`Task wikilink not inserted: ${row.notePath} no longer has ^${row.blockId}`);
      this.refreshTaskWikilinkNote(row.notePath, authoritative.content);
      return { ok: false, stale: true };
    }
    if (found.count > 1) {
      new Notice(`Task wikilink not inserted: ^${row.blockId} is now duplicated in ${row.notePath}`);
      this.refreshTaskWikilinkNote(row.notePath, authoritative.content);
      return { ok: false, stale: true };
    }
    if (found.taskLine !== row.line) {
      new Notice(`Task wikilink not inserted: the task line changed in ${row.notePath}`);
      this.refreshTaskWikilinkNote(row.notePath, authoritative.content);
      return { ok: false, stale: true };
    }
    let linkTarget = row.linkTarget || taskWikilinkPathStem(row.notePath);
    try {
      const dest =
        this.app.metadataCache &&
        typeof this.app.metadataCache.getFirstLinkpathDest === "function"
          ? this.app.metadataCache.getFirstLinkpathDest(linkTarget, source.sourcePath)
          : null;
      if (!dest || dest.path !== row.notePath) {
        linkTarget = taskWikilinkPathStem(row.notePath);
      }
    } catch (error) {
      linkTarget = taskWikilinkPathStem(row.notePath);
    }
    const replacement = `[[${linkTarget}#^${row.blockId}]]`;
    if (!this.taskWikilinkTokenStillPresent(source)) {
      new Notice("Task wikilink not inserted: the ((…)) text changed");
      return { ok: false, stale: true };
    }
    this.suppressEditorScans();
    const from = { line: source.line, ch: source.replaceStart };
    const to = { line: source.line, ch: source.replaceEnd };
    const caret = {
      line: source.line,
      ch: source.replaceStart + replacement.length,
    };
    const fromIndex = editorPositionToIndex(source.editor.getValue(), from);
    const toIndex = editorPositionToIndex(source.editor.getValue(), to);
    // The caret is after the replacement, so it may not map into the
    // pre-change document. CM6 expects the post-change offset here.
    const caretIndex = fromIndex === null ? null : fromIndex + replacement.length;
    if (
      fromIndex !== null && toIndex !== null && caretIndex !== null &&
      dispatchTaskWikilinkCompletion(source.editor, [{
        from: fromIndex,
        to: toIndex,
        insert: replacement,
      }], caretIndex)
    ) {
      return { ok: true, replacement };
    }
    if (typeof source.editor.transaction === "function") {
      source.editor.transaction({
        changes: [{ from, to, text: replacement }],
        selections: [{ from: caret, to: caret }],
      });
    } else {
      source.editor.replaceRange(replacement, from, to);
      setEditorCursorIfPossible(source.editor, caret);
    }
    return { ok: true, replacement };
  }

  refreshTaskWikilinkNote(path, content) {
    const index = this.ensureTaskWikilinkIndex();
    if (typeof content === "string") {
      index.refreshPaths([{ path, content }]);
      return;
    }
    void index.refreshPathsFromVault(this.app, [path]);
  }
}

function taskWikilinkChangeSetFromUpdate(update) {
  const changes = [];
  if (!update || !update.changes || typeof update.changes.iterChanges !== "function") {
    return changes;
  }
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text =
      inserted && typeof inserted.toString === "function"
        ? inserted.toString()
        : String(inserted || "");
    changes.push({ from: fromA, to: toA, text });
  });
  return changes;
}

function taskWikilinkUpdateIsUserInput(update) {
  const transactions = (update && update.transactions) || [];
  if (transactions.length === 0) {
    return false;
  }
  let sawInput = false;
  for (const transaction of transactions) {
    if (!transaction || typeof transaction.isUserEvent !== "function") {
      continue;
    }
    if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) {
      return false;
    }
    if (transaction.isUserEvent("input")) {
      sawInput = true;
    }
  }
  return sawInput;
}
