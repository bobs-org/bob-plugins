function sameEditorPosition(left, right) {
  return (
    !!left &&
    !!right &&
    left.line === right.line &&
    left.ch === right.ch
  );
}

function isCollapsedCodeMirrorSelection(cmView) {
  const selection = cmView && cmView.state && cmView.state.selection;

  if (!selection || !Array.isArray(selection.ranges)) {
    return true;
  }

  if (selection.ranges.length !== 1) {
    return false;
  }

  const range = selection.ranges[0];
  return range.empty || range.from === range.to;
}

function getEditorLines(cm) {
  if (!cm) {
    return null;
  }

  if (typeof cm.getValue === "function") {
    return String(cm.getValue()).split(/\r?\n/);
  }

  if (typeof cm.getLine !== "function") {
    return null;
  }

  const firstLine = typeof cm.firstLine === "function" ? cm.firstLine() : 0;
  const lastLine =
    typeof cm.lastLine === "function"
      ? cm.lastLine()
      : typeof cm.lineCount === "function"
        ? Math.max(firstLine, cm.lineCount() - 1)
        : firstLine;
  const lines = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    lines[line] = cm.getLine(line) || "";
  }

  return lines;
}

function getEditorCursorLine(cm) {
  if (!cm || typeof cm.getCursor !== "function") {
    return null;
  }

  const cursor = cm.getCursor();
  return cursor && Number.isInteger(cursor.line) ? cursor.line : null;
}

function getActiveMarkdownView(app) {
  const workspace = app && app.workspace;
  if (!workspace || typeof workspace.getActiveViewOfType !== "function") {
    return null;
  }

  const view = workspace.getActiveViewOfType(MarkdownView);
  if (!(view instanceof MarkdownView) || !view.editor) {
    return null;
  }

  return view;
}

function getActiveMarkdownViewPath(app, view) {
  const file = (view && view.file) || getActiveFile(app);
  return file && typeof file.path === "string"
    ? normalizeVaultPath(file.path)
    : "";
}

function delay(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, numericOrDefault(ms, 0))),
  );
}

async function waitForActiveMarkdownView(app, options = {}) {
  const expectedPath = normalizeVaultPath(options.path || "");
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const view = getActiveMarkdownView(app);
    if (
      view &&
      (!expectedPath ||
        sameVaultPath(getActiveMarkdownViewPath(app, view), expectedPath))
    ) {
      return view;
    }

    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
}

async function executeDailyNotesCommand(app) {
  const commands = app && app.commands;
  if (!commands || typeof commands.executeCommandById !== "function") {
    return false;
  }

  try {
    const result = await commands.executeCommandById(DAILY_NOTES_COMMAND_ID);
    return result !== false;
  } catch (error) {
    return false;
  }
}

function parentVaultPath(path) {
  const normalized = normalizeVaultPath(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? "" : normalized.slice(0, slashIndex);
}

function isMarkdownFileLike(file, expectedPath = "") {
  if (!file || typeof file.path !== "string") {
    return false;
  }

  if (expectedPath && !sameVaultPath(file.path, expectedPath)) {
    return false;
  }

  if (Array.isArray(file.children)) {
    return false;
  }

  return !file.extension || String(file.extension).toLowerCase() === "md";
}

async function ensureVaultFolder(app, folderPath) {
  const folder = normalizeVaultPath(folderPath);
  if (!folder) {
    return true;
  }

  const vault = app && app.vault;
  if (!vault) {
    return false;
  }

  let currentPath = "";
  for (const segment of folder.split("/")) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    const existing =
      typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(currentPath)
        : null;
    if (existing) {
      continue;
    }

    if (typeof vault.createFolder !== "function") {
      return false;
    }

    try {
      await vault.createFolder(currentPath);
    } catch (error) {
      const created =
        typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(currentPath)
          : null;
      if (!created) {
        return false;
      }
    }
  }

  return true;
}

async function resolveOrCreateDailyFile(app, path) {
  const vault = app && app.vault;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") {
    return null;
  }

  const dailyPath = normalizeVaultPath(path);
  const existing = vault.getAbstractFileByPath(dailyPath);
  if (existing) {
    return isMarkdownFileLike(existing, dailyPath) ? existing : null;
  }

  if (typeof vault.create !== "function") {
    return null;
  }

  if (!(await ensureVaultFolder(app, parentVaultPath(dailyPath)))) {
    return null;
  }

  try {
    const created = await vault.create(dailyPath, "");
    return isMarkdownFileLike(created, dailyPath) ? created : null;
  } catch (error) {
    const created = vault.getAbstractFileByPath(dailyPath);
    return isMarkdownFileLike(created, dailyPath) ? created : null;
  }
}

async function openVaultFile(app, file) {
  const workspace = app && app.workspace;
  const leaf =
    workspace && typeof workspace.getLeaf === "function"
      ? workspace.getLeaf(false)
      : null;

  if (!leaf || typeof leaf.openFile !== "function") {
    return false;
  }

  try {
    await leaf.openFile(file);
    return true;
  } catch (error) {
    return false;
  }
}

function getMarkdownLeafFile(leaf) {
  const view = leaf && leaf.view;
  if (!(view instanceof MarkdownView)) {
    return null;
  }

  const file = view.file;
  return isMarkdownFileLike(file) ? file : null;
}

function getMarkdownLeafViewByPath(leaf, path = "") {
  const view = leaf && leaf.view;
  if (!(view instanceof MarkdownView) || !view.editor) {
    return null;
  }

  const file = getMarkdownLeafFile(leaf);
  if (!file) {
    return null;
  }

  const expectedPath = normalizeVaultPath(path || "");
  return !expectedPath || sameVaultPath(file.path, expectedPath) ? view : null;
}

function findOpenMarkdownLeafByPath(app, path) {
  const workspace = app && app.workspace;
  const expectedPath = normalizeVaultPath(path);
  if (
    !workspace ||
    !expectedPath ||
    typeof workspace.iterateAllLeaves !== "function"
  ) {
    return null;
  }

  let matchingLeaf = null;
  try {
    workspace.iterateAllLeaves((leaf) => {
      if (matchingLeaf) {
        return;
      }

      const file = getMarkdownLeafFile(leaf);
      if (file && sameVaultPath(file.path, expectedPath)) {
        matchingLeaf = leaf;
      }
    });
  } catch (error) {
    return null;
  }

  return matchingLeaf;
}

async function waitForMarkdownLeafViewByPath(leaf, options = {}) {
  const expectedPath = normalizeVaultPath(options.path || "");
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const view = getMarkdownLeafViewByPath(leaf, expectedPath);
    if (view) {
      return view;
    }

    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
}

async function activateMarkdownLeaf(app, leaf, options = {}) {
  const workspace = app && app.workspace;
  if (!workspace || !leaf) {
    return null;
  }

  if (typeof workspace.revealLeaf === "function") {
    try {
      await workspace.revealLeaf(leaf);
    } catch (error) {
      // Continue with direct activation when revealing is unavailable or fails.
    }
  }

  let activated = false;
  if (typeof workspace.setActiveLeaf === "function") {
    try {
      await workspace.setActiveLeaf(leaf, { focus: true });
      activated = true;
    } catch (error) {
      try {
        await workspace.setActiveLeaf(leaf);
        activated = true;
      } catch (ignoredError) {
        // Fall through to the leaf-level focus API below.
      }
    }
  }

  if (!activated && typeof leaf.focus === "function") {
    try {
      await leaf.focus();
      activated = true;
    } catch (error) {
      // Report activation failure below.
    }
  }

  if (!activated) {
    return null;
  }

  return (
    (await waitForMarkdownLeafViewByPath(leaf, options)) ||
    waitForActiveMarkdownView(app, options)
  );
}

async function openTodayDailyNoteWithState(app, options = {}) {
  const dailyPath = todayDailyPath(
    options.now || new Date(),
    options.dailyOptions || getDailyNotesOptions(app),
  );
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  const existingLeaf = findOpenMarkdownLeafByPath(app, dailyPath);
  if (existingLeaf) {
    const view = await activateMarkdownLeaf(app, existingLeaf, {
      path: dailyPath,
      attempts,
      delayMs,
    });
    return view
      ? { view, path: dailyPath, reusedOpenLeaf: true }
      : null;
  }

  if (await executeDailyNotesCommand(app)) {
    const commandView = await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    });
    if (commandView) {
      return { view: commandView, path: dailyPath, reusedOpenLeaf: false };
    }
  }

  const file = await resolveOrCreateDailyFile(app, dailyPath);
  if (!file || !(await openVaultFile(app, file))) {
    return null;
  }

  const view =
    (await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    })) || getActiveMarkdownView(app);
  if (
    !view ||
    !sameVaultPath(getActiveMarkdownViewPath(app, view), dailyPath)
  ) {
    return null;
  }

  return { view, path: dailyPath, reusedOpenLeaf: false };
}

async function openTodayDailyNote(app, options = {}) {
  const result = await openTodayDailyNoteWithState(app, options);
  return result ? result.view : null;
}

function getActiveEditorView(app) {
  const view = getActiveMarkdownView(app);
  if (!view) {
    return null;
  }

  return getEditorViewFromEditor(view.editor);
}

function getEditorViewFromEditor(cm) {
  // Resolve the underlying CodeMirror 6 EditorView from every shape the codebase
  // hands us: the codemirror-vim CM5 adapter (its CM6 view is `.cm6`), an
  // Obsidian Editor (its CM6 view is `.cm`), or a raw EditorView (itself).
  const editorView = cm && (cm.cm6 || cm.cm || cm);
  if (
    !editorView ||
    !editorView.state ||
    !editorView.state.doc ||
    typeof editorView.dispatch !== "function"
  ) {
    return null;
  }

  return editorView;
}

function positionFromCodeMirrorUpdate(update) {
  const state = update && (update.state || (update.view && update.view.state));
  const selection = state && state.selection;
  const mainSelection = selection && selection.main;
  const rawHead = mainSelection && mainSelection.head;
  const head = Math.floor(numericOrDefault(rawHead, Number.NaN));
  const doc = state && state.doc;
  if (!Number.isFinite(head) || !doc) {
    return null;
  }

  if (typeof doc.lineAt === "function") {
    try {
      const line = doc.lineAt(head);
      if (line && Number.isFinite(line.number) && Number.isFinite(line.from)) {
        return normalizeEditorPosition({
          line: line.number - 1,
          ch: head - line.from,
        });
      }
    } catch (error) {
      return null;
    }
  }

  if (typeof doc.toString === "function") {
    const text = doc.toString();
    const safeHead = Math.min(Math.max(head, 0), text.length);
    const beforeCursor = text.slice(0, safeHead);
    const lines = beforeCursor.split("\n");
    const line = lines.length - 1;
    const lastLine = lines[line] || "";
    return {
      line,
      ch: lastLine.endsWith("\r") ? lastLine.length - 1 : lastLine.length,
    };
  }

  return null;
}

function getEditorLastLine(cm) {
  if (!cm) {
    return null;
  }

  if (typeof cm.lastLine === "function") {
    const line = Math.floor(numericOrDefault(cm.lastLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  if (typeof cm.lineCount === "function") {
    const count = Math.floor(numericOrDefault(cm.lineCount(), Number.NaN));
    if (Number.isFinite(count)) {
      return Math.max(count - 1, 0);
    }
  }

  if (typeof cm.getValue === "function") {
    return Math.max(String(cm.getValue()).split(/\r?\n/).length - 1, 0);
  }

  return null;
}

function getEditorLineText(cm, line) {
  if (!cm) {
    return null;
  }

  if (typeof cm.getLine === "function") {
    const text = cm.getLine(line);
    return text === null || text === undefined ? "" : String(text);
  }

  if (typeof cm.getValue === "function") {
    const lines = String(cm.getValue()).split(/\r?\n/);
    return lines[line] === undefined ? "" : lines[line];
  }

  return null;
}

function clampEditorPosition(cm, position) {
  const normalized = normalizeEditorPosition(position);
  if (!normalized) {
    return null;
  }

  const lastLine = getEditorLastLine(cm);
  const line =
    lastLine === null ? normalized.line : Math.min(normalized.line, lastLine);
  const lineText = getEditorLineText(cm, line);
  const ch =
    lineText === null ? normalized.ch : Math.min(normalized.ch, lineText.length);
  return { line, ch };
}

function getScrollDOMMaxScrollTop(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollHeight = finiteNumberOrNull(scrollDOM.scrollHeight);
  const clientHeight = finiteNumberOrNull(scrollDOM.clientHeight);
  if (scrollHeight === null || clientHeight === null || clientHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, scrollHeight - clientHeight);
}

function getScrollDOMMaxScrollLeft(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollWidth = finiteNumberOrNull(scrollDOM.scrollWidth);
  const clientWidth = finiteNumberOrNull(scrollDOM.clientWidth);
  if (scrollWidth === null || clientWidth === null || clientWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, scrollWidth - clientWidth);
}

function setScrollDOMPosition(scrollDOM, scrollTop, scrollLeft = null) {
  if (!scrollDOM) {
    return false;
  }

  const targetScrollTop = clampNumber(
    scrollTop,
    0,
    getScrollDOMMaxScrollTop(scrollDOM),
  );
  const rawScrollLeft =
    finiteNumberOrNull(scrollLeft) ?? finiteNumberOrNull(scrollDOM.scrollLeft) ?? 0;
  const targetScrollLeft = clampNumber(
    rawScrollLeft,
    0,
    getScrollDOMMaxScrollLeft(scrollDOM),
  );

  if (typeof scrollDOM.scrollTo === "function") {
    try {
      scrollDOM.scrollTo({ top: targetScrollTop, left: targetScrollLeft });
      return true;
    } catch (error) {
      // Fall through to direct assignment.
    }
  }

  try {
    scrollDOM.scrollTop = targetScrollTop;
    scrollDOM.scrollLeft = targetScrollLeft;
    return true;
  } catch (error) {
    return false;
  }
}

function editorViewPositionFromLineCh(editorView, line, ch) {
  const doc = editorView && editorView.state && editorView.state.doc;
  if (!doc || typeof doc.line !== "function") {
    return null;
  }

  const lineCount =
    Number.isInteger(doc.lines) && doc.lines > 0 ? doc.lines : 1;
  const safeLine = Math.min(
    Math.max(Math.floor(numericOrDefault(line, 0)), 0),
    lineCount - 1,
  );

  let lineInfo;
  try {
    lineInfo = doc.line(safeLine + 1);
  } catch (error) {
    return null;
  }

  if (
    !lineInfo ||
    !Number.isInteger(lineInfo.from) ||
    !Number.isInteger(lineInfo.to)
  ) {
    return null;
  }

  const maxCh = Math.max(lineInfo.to - lineInfo.from, 0);
  const safeCh = Math.min(
    Math.max(Math.floor(numericOrDefault(ch, 0)), 0),
    maxCh,
  );
  return lineInfo.from + safeCh;
}

function centerEditorViewOnPosition(editorView, line, ch) {
  if (
    !editorView ||
    typeof editorView.dispatch !== "function" ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const position = editorViewPositionFromLineCh(editorView, line, ch);
  if (position === null) {
    return false;
  }

  try {
    editorView.dispatch({
      effects: EditorView.scrollIntoView(position, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

function scrollEditorIntoView(cm, line, ch) {
  if (cm && typeof cm.scrollIntoView === "function") {
    cm.scrollIntoView({ line, ch });
    return true;
  }

  return false;
}

function focusEditor(cm) {
  if (!cm) {
    return false;
  }

  if (typeof cm.focus === "function") {
    try {
      cm.focus();
      return true;
    } catch (error) {
      // Fall through to the underlying CodeMirror view when available.
    }
  }

  const editorView = getEditorViewFromEditor(cm);
  if (editorView && typeof editorView.focus === "function") {
    try {
      editorView.focus();
      return true;
    } catch (error) {
      return false;
    }
  }

  return false;
}

function setEditorCursor(cm, line, ch, options = {}) {
  if (!cm || typeof cm.setCursor !== "function") {
    return false;
  }

  try {
    cm.setCursor(line, ch);
  } catch (error) {
    cm.setCursor({ line, ch });
  }

  if (options.scroll !== false) {
    scrollEditorIntoView(cm, line, ch);
  }

  return true;
}

// Defer `callback` past the current synchronous turn (e.g. the codemirror-vim
// command cycle) so any scroll it dispatches runs after Vim's own trailing
// "keep cursor visible" scroll. Returns a handle that cancelDeferred can clear.
function deferToNextFrame(callback) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return { type: "raf", handle: window.requestAnimationFrame(callback) };
  }

  return { type: "timeout", handle: setTimeout(callback, 0) };
}

function cancelDeferred(deferred) {
  if (!deferred) {
    return;
  }

  if (
    deferred.type === "raf" &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(deferred.handle);
    return;
  }

  if (deferred.type === "timeout") {
    clearTimeout(deferred.handle);
  }
}

function replaceEditorLine(cm, line, oldLineText, newLineText) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  cm.replaceRange(
    newLineText,
    { line, ch: 0 },
    { line, ch: oldLineText.length },
  );
  return true;
}

