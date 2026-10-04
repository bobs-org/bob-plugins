class TaskStatusCyclerTargetsMixin {
  getActiveLineTranscludedTaskTarget(editor, sourcePath) {
    if (
      !sourcePath ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    return getTranscludedTaskTargetFromLine(
      editor.getLine(cursor.line),
      sourcePath,
      cursor.line,
      cursor.ch,
    );
  }

  getActiveLineTaskBlockLinkTarget(editor, sourcePath) {
    if (
      !sourcePath ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }
    const lines = this.getEditorLineTexts(editor);
    if (getFencedLineNumbers(lines).has(cursor.line)) {
      return null;
    }

    return getTaskBlockLinkTargetFromLine(
      editor.getLine(cursor.line),
      sourcePath,
      cursor.line,
      cursor.ch,
    );
  }

  // Whether the cursor sits on a Depends-On line. Gestures key off the line
  // shape; the fenced-code and task-parentage rules stay hooks concerns.
  isActiveTaskDependencyLine(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return false;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return false;
    }

    return isTaskDependencyLine(editor.getLine(cursor.line));
  }

  // The dependency link under the cursor on a Depends-On line (plain,
  // embedded, or struck while canonicalisation is pending), or null when the
  // active line is not one or the cursor names no single link.
  getActiveTaskDependencyLinkTarget(editor, sourcePath) {
    if (
      !sourcePath ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText = editor.getLine(cursor.line);
    if (!isTaskDependencyLine(lineText)) {
      return null;
    }

    return getTaskBlockLinkTargetFromLine(
      lineText,
      sourcePath,
      cursor.line,
      cursor.ch,
    );
  }

  // Detect when the active line is an embedded transcluded task link that is a
  // sub-bullet of a Pomodoro task. Returns { candidate, pomodoroLine } so the
  // caller can run recursive forced-done over the selected tree; null otherwise,
  // which keeps the generic non-recursive transcluded toggle as the fallback.
  // The active line must sit in the `## Pomodoros` section, be an indented list
  // line, carry an unambiguous embedded block transclusion, and fall inside the
  // sub-bullet block of the nearest top-level Pomodoro task above it.
  getActivePomodoroTranscludedTaskLineTarget(editor, activePath) {
    const candidate = this.getActiveLineTranscludedTaskTarget(editor, activePath);
    const owningContext = this.getActivePomodoroChildContext(editor);
    if (!candidate || !owningContext) {
      return null;
    }

    return { candidate, ...owningContext };
  }

  async resolveTranscludedBlockTarget(candidate, context, options = {}) {
    const file = this.resolveTranscludedTargetFile(candidate, context.originPath);
    if (!this.isMarkdownFile(file)) {
      return null;
    }

    const sourceText = await this.readTranscludedTargetSourceText(file, context);
    if (sourceText === null) {
      return null;
    }

    const fileCache =
      this.app.metadataCache &&
      typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
    const cachedLine = getBlockLineFromCache(fileCache, candidate.blockId);
    const resolvedCachedLine = this.resolveTranscludedTaskLineFromSourceText(
      sourceText,
      cachedLine,
      candidate.blockId,
      options,
    );

    if (resolvedCachedLine) {
      return {
        ...resolvedCachedLine,
        file,
        blockId: candidate.blockId,
        sourceText,
      };
    }

    const scannedLine = findBlockLineInSourceText(sourceText, candidate.blockId);
    const resolvedScannedLine = this.resolveTranscludedTaskLineFromSourceText(
      sourceText,
      scannedLine,
      candidate.blockId,
      options,
    );

    return resolvedScannedLine
      ? {
          ...resolvedScannedLine,
          file,
          blockId: candidate.blockId,
          sourceText,
        }
      : null;
  }

  resolveTranscludedTaskLineFromSourceText(sourceText, line, blockId, options = {}) {
    if (line === null) {
      return null;
    }

    const lineText = getLineTextFromSourceText(sourceText, line);
    if (!lineContainsStandaloneBlockId(lineText, blockId)) {
      return null;
    }

    const linePredicate =
      typeof options.linePredicate === "function" ? options.linePredicate : null;
    if (linePredicate && !linePredicate(lineText)) {
      return null;
    }

    const taskStatus = getTaskStatusForLine(lineText, line);
    const taskStatusPredicate =
      typeof options.taskStatusPredicate === "function"
        ? options.taskStatusPredicate
        : this.isOpenDoneTaskStatus.bind(this);
    if (!taskStatusPredicate(taskStatus)) {
      return null;
    }

    return {
      line,
      lineText,
      taskStatus,
    };
  }

  resolveTranscludedTargetFile(candidate, originPath) {
    if (!candidate || !originPath) {
      return null;
    }

    // Empty pathPart means a same-file `![[#^id]]` link: resolve it against the
    // origin note it was found in (the active note for first-level links, or a
    // recursed-into source note for descendant links).
    if (!candidate.pathPart) {
      const originFile =
        this.app.vault &&
        typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(originPath)
          : null;
      return this.isMarkdownFile(originFile) ? originFile : null;
    }

    if (
      !this.app.metadataCache ||
      typeof this.app.metadataCache.getFirstLinkpathDest !== "function"
    ) {
      return null;
    }

    return (
      this.app.metadataCache.getFirstLinkpathDest(candidate.pathPart, originPath) ||
      null
    );
  }

  async readTranscludedTargetSourceText(file, context) {
    // Read the live editor buffer only for the active note; every other source
    // note (including notes recursed into) is read from the vault.
    const editor = context && context.editor;
    if (this.fileMatchesPath(file, context && context.activePath) && editor) {
      if (typeof editor.getValue === "function") {
        return editor.getValue();
      }
    }

    if (!this.app.vault || typeof this.app.vault.read !== "function") {
      return null;
    }

    try {
      return await this.app.vault.read(file);
    } catch (error) {
      return null;
    }
  }

  async replaceResolvedTranscludedTaskLine(
    resolvedTarget,
    context,
    forcedNextSymbol = null,
    options = {},
  ) {
    // Write through the editor only when the resolved task lives in the active
    // note; all other source notes are written through the vault.
    if (this.fileMatchesPath(resolvedTarget.file, context && context.activePath)) {
      const replacedInEditor = this.replaceResolvedTranscludedTaskLineInEditor(
        resolvedTarget,
        context && context.editor,
        forcedNextSymbol,
        options,
      );
      if (replacedInEditor) {
        return true;
      }
    }

    return this.replaceResolvedTranscludedTaskLineInVault(
      resolvedTarget,
      forcedNextSymbol,
      options,
    );
  }

  replaceResolvedTranscludedTaskLineInEditor(
    resolvedTarget,
    editor,
    forcedNextSymbol = null,
    options = {},
  ) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const currentLineText = editor.getLine(resolvedTarget.line);
    const nextLineText = this.getNextTranscludedTaskLineText(
      currentLineText,
      resolvedTarget.line,
      resolvedTarget.blockId,
      forcedNextSymbol,
      options,
    );
    if (nextLineText === null || nextLineText === currentLineText) {
      return false;
    }

    editor.replaceRange(
      nextLineText,
      { line: resolvedTarget.line, ch: 0 },
      { line: resolvedTarget.line, ch: currentLineText.length },
    );
    return true;
  }

  async replaceResolvedTranscludedTaskLineInVault(
    resolvedTarget,
    forcedNextSymbol = null,
    options = {},
  ) {
    if (!this.app.vault) {
      return false;
    }

    let changed = false;
    const updateSourceText = (sourceText) => {
      const currentLineText = getLineTextFromSourceText(
        sourceText,
        resolvedTarget.line,
      );
      const nextLineText = this.getNextTranscludedTaskLineText(
        currentLineText,
        resolvedTarget.line,
        resolvedTarget.blockId,
        forcedNextSymbol,
        options,
      );
      if (nextLineText === null || nextLineText === currentLineText) {
        return sourceText;
      }

      const nextSourceText = replaceLineInSourceText(
        sourceText,
        resolvedTarget.line,
        nextLineText,
      );
      if (nextSourceText === null) {
        return sourceText;
      }

      changed = true;
      return nextSourceText;
    };

    try {
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(resolvedTarget.file, updateSourceText);
        return changed;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return false;
      }

      const sourceText = await this.app.vault.read(resolvedTarget.file);
      const nextSourceText = updateSourceText(sourceText);
      if (!changed) {
        return false;
      }

      await this.app.vault.modify(resolvedTarget.file, nextSourceText);
      return true;
    } catch (error) {
      return false;
    }
  }

  getNextTranscludedTaskLineText(
    lineText,
    line,
    blockId,
    forcedNextSymbol = null,
    options = {},
  ) {
    if (!lineContainsStandaloneBlockId(lineText, blockId)) {
      return null;
    }

    const taskStatus = getTaskStatusForLine(lineText, line);
    const nextSymbol = forcedNextSymbol || getNextOpenDoneSymbol(taskStatus);
    if (!nextSymbol) {
      return null;
    }

    if (forcedNextSymbol) {
      const forcedStatusPredicate =
        typeof options.forcedStatusPredicate === "function"
          ? options.forcedStatusPredicate
          : null;
      const canForce = forcedStatusPredicate
        ? forcedStatusPredicate(taskStatus) &&
          FIXED_SYMBOLS.includes(forcedNextSymbol)
        : options.allowAnyStatus
          ? isCyclableTaskStatus(taskStatus) &&
            FIXED_SYMBOLS.includes(forcedNextSymbol)
          : this.canForceTranscludedTaskStatus(taskStatus, forcedNextSymbol);
      if (!canForce || taskStatus.symbol === forcedNextSymbol) {
        return null;
      }
    }

    return rewriteTaskLineForTranscludedSource(
      lineText,
      nextSymbol,
      this.getCompletionDateString(),
      {
        stampLine: this.getFreshnessStampLine(),
        freshDateText: formatLocalDate(),
      },
    );
  }

  // Task freshness stamper from bob-ledger-tools (api `version >= 3`).
  // Placement lives in ledger-tools; this plugin only calls
  // `api?.freshness?.stampLine?.(line, dateText) ?? line`. Returns null when
  // ledger-tools is absent or old, in which case gestures simply don't stamp.
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
        return null;
      }
      const stampLine = api.freshness.stampLine;
      if (typeof stampLine !== "function") {
        return null;
      }
      return stampLine.bind(api.freshness);
    } catch (error) {
      return null;
    }
  }

  // Stamp one editor line with today's freshness date when a stamper is
  // available. Best effort: returns false when nothing was written.
  stampFreshnessOnEditorLine(editor, line) {
    try {
      const stamper = this.getFreshnessStampLine();
      if (typeof stamper !== "function") {
        return false;
      }
      if (!editor || typeof editor.getLine !== "function") {
        return false;
      }
      const current = editor.getLine(line);
      if (typeof current !== "string") {
        return false;
      }
      const stamped = applyFreshStampLine(current, stamper, formatLocalDate());
      if (stamped === current) {
        return false;
      }
      if (typeof editor.replaceRange !== "function") {
        return false;
      }
      editor.replaceRange(
        stamped,
        { line, ch: 0 },
        { line, ch: current.length },
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  canForceTranscludedTaskStatus(taskStatus, forcedNextSymbol) {
    if (!FIXED_SYMBOLS.includes(forcedNextSymbol)) {
      return false;
    }

    if (forcedNextSymbol === "x") {
      return isTranscludedCompletionClosableStatus(taskStatus);
    }

    if (forcedNextSymbol === "/") {
      return isNonTranscludedStartableStatus(taskStatus);
    }

    if (forcedNextSymbol === " ") {
      return !!taskStatus && taskStatus.symbol === "/";
    }

    return isOpenDoneTaskStatus(taskStatus);
  }

  fileMatchesPath(file, path) {
    return !!file && !!path && file.path === path;
  }

  isMarkdownFile(file) {
    return (
      !!file &&
      typeof file.path === "string" &&
      file.path.toLowerCase().endsWith(".md")
    );
  }

  getCompletionDateString() {
    return formatLocalDate();
  }

  getCreatedDateString() {
    return formatLocalDate();
  }

  getScheduleLogDateString() {
    return formatLocalDate();
  }

  // The date stamped on Pomodoro Work Log entries: the daily note's own date
  // when `activePath` is one, else today. Closing yesterday's Pomodoro must
  // not stamp today's date.
  getPomodoroWorkLogDateString(activePath) {
    return getDailyNoteDateFromPath(activePath) || formatLocalDate();
  }

  isOpenDoneTaskStatus(taskStatus) {
    return isOpenDoneTaskStatus(taskStatus);
  }

  isTranscludedCompletionTraversableStatus(taskStatus) {
    return isTranscludedCompletionTraversableStatus(taskStatus);
  }

  isTranscludedCompletionClosableStatus(taskStatus) {
    return isTranscludedCompletionClosableStatus(taskStatus);
  }

  getActiveTaskStatus(editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    return getTaskStatusForLine(line, cursor.line);
  }

  getEditorLineTexts(editor) {
    if (!editor) {
      return [];
    }

    if (typeof editor.getValue === "function") {
      return splitTextByLineEndings(editor.getValue()).map((line) => line.text);
    }

    if (typeof editor.getLine !== "function") {
      return [];
    }

    const firstLine =
      typeof editor.firstLine === "function" ? editor.firstLine() : 0;
    const lastLine = this.getCodeMirrorLastLine(editor);
    const lines = [];

    for (let line = firstLine; line <= lastLine; line += 1) {
      lines[line] = editor.getLine(line) || "";
    }

    return lines;
  }

  getEditorLineCount(editor) {
    if (!editor) {
      return 0;
    }

    if (typeof editor.lineCount === "function") {
      return Math.max(0, editor.lineCount());
    }

    if (typeof editor.lastLine === "function") {
      return Math.max(0, editor.lastLine() + 1);
    }

    return this.getEditorLineTexts(editor).length;
  }

  lineMatchesTasksGlobalFilter(lineText) {
    return lineMatchesTasksGlobalFilterText(lineText);
  }

  tryExecuteTasksCommand(commandId) {
    if (!this.app.commands.commands[commandId]) {
      return false;
    }

    try {
      return this.app.commands.executeCommandById(commandId) !== false;
    } catch (error) {
      return false;
    }
  }

  getAdjacentSymbol(currentSymbol, direction) {
    const cycle = this.getSourceStatusCycle();
    const currentIndex = cycle.indexOf(currentSymbol);

    if (currentIndex === -1 || cycle.length < 2) {
      return null;
    }

    // Step through the source ring, skipping a landing on Blocked (`?`): it
    // is a readable source but never a writable destination.
    let nextIndex = currentIndex;
    for (let step = 0; step < cycle.length; step += 1) {
      nextIndex = (nextIndex + direction + cycle.length) % cycle.length;
      if (cycle[nextIndex] !== BLOCKED_TASK_STATUS_SYMBOL) {
        break;
      }
    }

    const nextSymbol = cycle[nextIndex];
    return FIXED_SYMBOLS.includes(nextSymbol) ? nextSymbol : null;
  }

  getStatusCycle() {
    return FIXED_SYMBOLS;
  }

  getSourceStatusCycle() {
    return SOURCE_STATUS_CYCLE;
  }

  getHalfPageLineCount(cm) {
    if (
      cm &&
      typeof cm.getScrollInfo === "function" &&
      typeof cm.defaultTextHeight === "function"
    ) {
      const scrollInfo = cm.getScrollInfo();
      const lineHeight = cm.defaultTextHeight();
      if (
        scrollInfo &&
        Number.isFinite(scrollInfo.clientHeight) &&
        scrollInfo.clientHeight > 0 &&
        Number.isFinite(lineHeight) &&
        lineHeight > 0
      ) {
        return Math.max(1, Math.floor(scrollInfo.clientHeight / lineHeight / 2));
      }
    }

    return DEFAULT_HALF_PAGE_LINES;
  }

  findQueryCodeBlocks(cm) {
    if (!cm || typeof cm.getLine !== "function") {
      return [];
    }

    const blocks = [];
    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    let activeFence = null;

    for (let line = firstLine; line <= lastLine; line += 1) {
      const lineText = cm.getLine(line) || "";

      if (!activeFence) {
        const openingFence = this.getFenceOpening(lineText);
        if (openingFence) {
          activeFence = {
            ...openingFence,
            startLine: line,
            isQuery: this.isQueryFenceInfo(lineText),
          };
        }
        continue;
      }

      if (this.isClosingFence(lineText, activeFence)) {
        if (activeFence.isQuery) {
          blocks.push({ startLine: activeFence.startLine, endLine: line });
        }
        activeFence = null;
      }
    }

    if (activeFence && activeFence.isQuery) {
      blocks.push({ startLine: activeFence.startLine, endLine: lastLine });
    }

    return blocks;
  }

  isQueryFenceInfo(line) {
    const openingFence = this.getFenceOpening(line);
    if (!openingFence) {
      return false;
    }

    const language = openingFence.info.trim().split(/\s+/)[0].toLowerCase();
    return QUERY_CODE_BLOCK_LANGS.has(language);
  }

  lineIsInsideAnyQueryCodeBlock(blocks, line) {
    return !!this.findQueryCodeBlockAtLine(blocks, line);
  }

  findNearestNonQueryLine(blocks, line, direction, firstLine, lastLine) {
    if (!this.lineIsInsideAnyQueryCodeBlock(blocks, line)) {
      return line;
    }

    const preferredDirection = direction >= 0 ? 1 : -1;
    const preferredLine = this.walkToNonQueryLine(
      blocks,
      line,
      preferredDirection,
      firstLine,
      lastLine,
    );
    if (preferredLine !== null) {
      return preferredLine;
    }

    const fallbackLine = this.walkToNonQueryLine(
      blocks,
      line,
      -preferredDirection,
      firstLine,
      lastLine,
    );
    return fallbackLine === null ? line : fallbackLine;
  }

  walkToNonQueryLine(blocks, line, direction, firstLine, lastLine) {
    let candidate = line;

    while (candidate >= firstLine && candidate <= lastLine) {
      const block = this.findQueryCodeBlockAtLine(blocks, candidate);
      if (!block) {
        return candidate;
      }

      candidate = direction >= 0 ? block.endLine + 1 : block.startLine - 1;
    }

    return null;
  }

  findQueryCodeBlockAtLine(blocks, line) {
    return blocks.find((block) => line >= block.startLine && line <= block.endLine);
  }

  getFenceOpening(line) {
    const match = String(line).match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) {
      return null;
    }

    return {
      markerChar: match[2][0],
      markerLength: match[2].length,
      info: match[3] || "",
    };
  }

  isClosingFence(line, openingFence) {
    const match = String(line).match(/^( {0,3})(`{3,}|~{3,})\s*$/);
    if (!match) {
      return false;
    }

    return (
      match[2][0] === openingFence.markerChar &&
      match[2].length >= openingFence.markerLength
    );
  }

  getCodeMirrorFirstLine(cm) {
    return typeof cm.firstLine === "function" ? cm.firstLine() : 0;
  }

  getCodeMirrorLastLine(cm) {
    if (typeof cm.lastLine === "function") {
      return cm.lastLine();
    }

    if (typeof cm.lineCount === "function") {
      return Math.max(0, cm.lineCount() - 1);
    }

    return 0;
  }

  clampLine(line, firstLine, lastLine) {
    return Math.max(firstLine, Math.min(lastLine, line));
  }

  normalizeStatusSymbol(symbol) {
    return normalizeTaskStatusSymbol(symbol);
  }

  commandIdForSymbol(symbol) {
    return `${TASKS_COMMAND_PREFIX}${symbol === " " ? "space" : symbol}`;
  }
}
