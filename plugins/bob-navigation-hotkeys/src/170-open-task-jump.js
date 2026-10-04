function getOpenObsidianTaskJumpLine(
  lines,
  cursorLine,
  direction,
  repeat = 1,
) {
  const currentLine = Math.floor(numericOrDefault(cursorLine, Number.NaN));
  if (!Number.isFinite(currentLine)) {
    return null;
  }

  const taskLines = getOpenTaskNavigationLines(lines);
  if (taskLines.length === 0) {
    return null;
  }

  let targetLine = null;
  if (direction < 0) {
    for (let index = taskLines.length - 1; index >= 0; index -= 1) {
      if (taskLines[index] < currentLine) {
        targetLine = taskLines[index];
        break;
      }
    }
    if (targetLine === null) {
      // No higher open task: wrap to the last open task in the file.
      targetLine = taskLines[taskLines.length - 1];
    }
  } else {
    for (const taskLine of taskLines) {
      if (taskLine > currentLine) {
        targetLine = taskLine;
        break;
      }
    }
    if (targetLine === null) {
      // No lower open task: wrap to the first open task in the file.
      targetLine = taskLines[0];
    }
  }

  // The only matching open task is already on the cursor line; with multiple
  // tasks the resolved target is always a different line, so this leaves the
  // single-task/current-line case as the lone no-target outcome. Counted
  // repeats keep that same refusal rather than spinning in place.
  if (targetLine === currentLine) {
    return null;
  }

  const firstIndex = taskLines.indexOf(targetLine);
  if (firstIndex < 0) {
    return targetLine;
  }

  const step =
    (normalizeVimRepeat(repeat) - 1) % taskLines.length;
  const signedStep = direction < 0 ? -step : step;
  const finalIndex =
    (firstIndex + signedStep + taskLines.length) % taskLines.length;
  return taskLines[finalIndex];
}

function getDashTasksHeaderLine(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  let inFence = null;

  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (line.trim() === DASH_TASKS_HEADER) {
      return lineIndex;
    }
  }

  return null;
}

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  const line = Math.floor(numericOrDefault(position.line, Number.NaN));
  const ch = Math.floor(numericOrDefault(position.ch, 0));
  if (!Number.isFinite(line) || line < 0) {
    return null;
  }

  return {
    line,
    ch: Math.max(ch, 0),
  };
}

function getEditorLastLine(editor) {
  if (!editor) {
    return null;
  }

  if (typeof editor.lastLine === "function") {
    const line = Math.floor(numericOrDefault(editor.lastLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  if (typeof editor.lineCount === "function") {
    const count = Math.floor(numericOrDefault(editor.lineCount(), Number.NaN));
    if (Number.isFinite(count)) {
      return Math.max(count - 1, 0);
    }
  }

  if (typeof editor.getValue === "function") {
    return Math.max(String(editor.getValue()).split(/\r?\n/).length - 1, 0);
  }

  return null;
}

function getEditorFirstLine(editor) {
  if (!editor) {
    return null;
  }

  if (typeof editor.firstLine === "function") {
    const line = Math.floor(numericOrDefault(editor.firstLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  return 0;
}

function getEditorLineText(editor, line) {
  if (!editor) {
    return null;
  }

  if (typeof editor.getLine === "function") {
    const text = editor.getLine(line);
    return text === null || text === undefined ? "" : String(text);
  }

  if (typeof editor.getValue === "function") {
    const lines = String(editor.getValue()).split(/\r?\n/);
    return lines[line] === undefined ? "" : lines[line];
  }

  return null;
}

function clampPositionToEditor(editor, position) {
  const normalized = normalizePosition(position);
  if (!normalized) {
    return null;
  }

  const lastLine = getEditorLastLine(editor);
  const line =
    lastLine === null ? normalized.line : Math.min(normalized.line, lastLine);
  const lineText = getEditorLineText(editor, line);
  const ch =
    lineText === null ? normalized.ch : Math.min(normalized.ch, lineText.length);

  return { line, ch };
}

function getEditorViewFromEditor(editorOrCm) {
  const editorView =
    editorOrCm && (editorOrCm.cm6 || editorOrCm.cm || editorOrCm);
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

function getElementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  try {
    const rect = element.getBoundingClientRect();
    if (
      !rect ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.bottom) ||
      rect.bottom <= rect.top
    ) {
      return null;
    }

    return rect;
  } catch (error) {
    return null;
  }
}

function getVerticalIntersectionHeight(rect, viewportRect) {
  if (!rect || !viewportRect) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(rect.bottom, viewportRect.bottom) -
      Math.max(rect.top, viewportRect.top),
  );
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

function getRenderedTasksQueryContexts(editorView, viewportRect) {
  const root = editorView && editorView.dom;
  if (!root || typeof root.querySelectorAll !== "function") {
    return [];
  }

  let resultLists;
  try {
    resultLists = Array.from(
      root.querySelectorAll(DASH_RENDERED_TASKS_QUERY_RESULT_SELECTOR),
    );
  } catch (error) {
    return [];
  }

  const seenContainers = new Set();
  const contexts = [];
  for (const resultList of resultLists) {
    let container = resultList;
    try {
      if (resultList && typeof resultList.closest === "function") {
        container =
          resultList.closest(DASH_RENDERED_TASKS_BLOCK_SELECTOR) || resultList;
      }
    } catch (error) {
      container = resultList;
    }

    if (!container || seenContainers.has(container)) {
      continue;
    }
    seenContainers.add(container);

    const rect = getElementRect(container);
    if (!rect) {
      continue;
    }

    let sourceLine = null;
    const doc = editorView && editorView.state && editorView.state.doc;
    if (
      editorView &&
      typeof editorView.posAtDOM === "function" &&
      doc &&
      typeof doc.lineAt === "function"
    ) {
      try {
        const position = editorView.posAtDOM(container);
        const line = Number.isFinite(position) ? doc.lineAt(position) : null;
        if (line && Number.isFinite(line.number) && line.number >= 1) {
          sourceLine = Math.floor(line.number) - 1;
        }
      } catch (error) {
        sourceLine = null;
      }
    }

    contexts.push({
      index: contexts.length,
      sourceLine,
      element: container,
      resultList,
      rect,
      viewportRect,
    });
  }

  return contexts;
}

function findDashboardRenderedTasksQueryContext(editorView, scrollDOM) {
  const viewportRect = getElementRect(scrollDOM);
  if (!viewportRect) {
    return null;
  }

  const contexts = getRenderedTasksQueryContexts(editorView, viewportRect);
  if (contexts.length === 0) {
    return null;
  }

  const visible = [];
  let nearest = null;
  for (const context of contexts) {
    const intersectionHeight = getVerticalIntersectionHeight(
      context.rect,
      viewportRect,
    );
    if (intersectionHeight > 0) {
      visible.push({ ...context, intersectionHeight, distance: 0 });
      continue;
    }

    const distance =
      context.rect.bottom <= viewportRect.top
        ? viewportRect.top - context.rect.bottom
        : context.rect.top >= viewportRect.bottom
          ? context.rect.top - viewportRect.bottom
          : 0;
    const candidate = { ...context, intersectionHeight: 0, distance };
    if (!nearest || candidate.distance < nearest.distance) {
      nearest = candidate;
    }
  }

  if (visible.length > 0) {
    visible.sort((left, right) => {
      const intersectionDelta =
        right.intersectionHeight - left.intersectionHeight;
      if (intersectionDelta !== 0) {
        return intersectionDelta;
      }

      return left.rect.top - right.rect.top;
    });
    return visible[0];
  }

  return nearest;
}

function getDashboardRenderedTasksQuerySnapshot(editorView, scrollDOM) {
  const viewportRect = getElementRect(scrollDOM);
  const currentScrollTop = finiteNumberOrNull(scrollDOM && scrollDOM.scrollTop);
  if (!viewportRect || currentScrollTop === null) {
    return null;
  }

  const context = findDashboardRenderedTasksQueryContext(editorView, scrollDOM);
  if (!context) {
    return null;
  }

  const queryDocumentTop =
    currentScrollTop + context.rect.top - viewportRect.top;
  const queryHeight = context.rect.bottom - context.rect.top;
  if (!Number.isFinite(queryDocumentTop) || !Number.isFinite(queryHeight)) {
    return null;
  }

  return {
    index: context.index,
    sourceLine: context.sourceLine,
    offsetTop: currentScrollTop - queryDocumentTop,
    height: Math.max(0, queryHeight),
  };
}

function normalizeDashboardRenderedTasksQuerySnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  const index = Math.floor(numericOrDefault(snapshot.index, Number.NaN));
  const rawSourceLine =
    snapshot.sourceLine === null || snapshot.sourceLine === undefined
      ? null
      : Math.floor(numericOrDefault(snapshot.sourceLine, Number.NaN));
  const sourceLine =
    rawSourceLine !== null &&
    Number.isFinite(rawSourceLine) &&
    rawSourceLine >= 0
      ? rawSourceLine
      : null;
  const offsetTop = finiteNumberOrNull(snapshot.offsetTop);
  const height = finiteNumberOrNull(snapshot.height);
  if (!Number.isFinite(index) || index < 0 || offsetTop === null) {
    return null;
  }

  return {
    index,
    sourceLine,
    offsetTop,
    height: height === null ? null : Math.max(0, height),
  };
}

function normalizeDashLocation(location) {
  if (!location) {
    return null;
  }

  const sourcePosition = normalizePosition(
    location.sourcePosition || location.cursor || location.position,
  );
  const scrollTop = finiteNumberOrNull(location.scrollTop);
  const scrollLeft = finiteNumberOrNull(location.scrollLeft);
  const renderedTasksQuery = normalizeDashboardRenderedTasksQuerySnapshot(
    location.renderedTasksQuery,
  );

  if (
    !sourcePosition &&
    scrollTop === null &&
    scrollLeft === null &&
    !renderedTasksQuery
  ) {
    return null;
  }

  const normalized = {};
  if (sourcePosition) {
    normalized.sourcePosition = sourcePosition;
  }
  if (scrollTop !== null) {
    normalized.scrollTop = Math.max(0, scrollTop);
  }
  if (scrollLeft !== null) {
    normalized.scrollLeft = Math.max(0, scrollLeft);
  }
  if (renderedTasksQuery) {
    normalized.renderedTasksQuery = renderedTasksQuery;
  }

  return normalized;
}

function getDashboardQueryRestoreScrollTop(snapshot, editorView, scrollDOM) {
  const normalized = normalizeDashboardRenderedTasksQuerySnapshot(snapshot);
  const viewportRect = getElementRect(scrollDOM);
  const currentScrollTop = finiteNumberOrNull(scrollDOM && scrollDOM.scrollTop);
  if (!normalized || !viewportRect || currentScrollTop === null) {
    return null;
  }

  const contexts = getRenderedTasksQueryContexts(editorView, viewportRect);
  let context = null;
  if (normalized.sourceLine !== null) {
    context =
      contexts.find(
        (candidate) => candidate.sourceLine === normalized.sourceLine,
      ) || null;

    const fallbackContext = contexts[normalized.index];
    if (!context && fallbackContext && fallbackContext.sourceLine === null) {
      context = fallbackContext;
    }
  } else {
    context = contexts[normalized.index];
  }
  if (!context) {
    return null;
  }

  const queryDocumentTop =
    currentScrollTop + context.rect.top - viewportRect.top;
  const queryHeight = context.rect.bottom - context.rect.top;
  const viewportHeight =
    finiteNumberOrNull(scrollDOM && scrollDOM.clientHeight) ||
    finiteNumberOrNull(viewportRect.height) ||
    viewportRect.bottom - viewportRect.top;
  if (
    !Number.isFinite(queryDocumentTop) ||
    !Number.isFinite(queryHeight) ||
    !Number.isFinite(viewportHeight) ||
    queryHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  const minRelativeOffset = -Math.max(
    0,
    viewportHeight - DASH_RENDERED_TASKS_SCROLL_PADDING_PX,
  );
  const maxRelativeOffset = Math.max(
    0,
    queryHeight - DASH_RENDERED_TASKS_SCROLL_PADDING_PX,
  );
  const savedMaxRelativeOffset =
    normalized.height === null
      ? null
      : Math.max(0, normalized.height - DASH_RENDERED_TASKS_SCROLL_PADDING_PX);
  const saneRelativeOffset =
    savedMaxRelativeOffset === null
      ? normalized.offsetTop
      : clampNumber(
          normalized.offsetTop,
          minRelativeOffset,
          savedMaxRelativeOffset,
        );
  const targetRelativeOffset = clampNumber(
    saneRelativeOffset,
    minRelativeOffset,
    maxRelativeOffset,
  );

  return clampNumber(
    queryDocumentTop + targetRelativeOffset,
    0,
    getScrollDOMMaxScrollTop(scrollDOM),
  );
}

function positionFromTextOffset(text, offset) {
  const value = String(text);
  const targetOffset = Math.min(
    Math.max(Math.floor(numericOrDefault(offset, 0)), 0),
    value.length,
  );
  const beforeCursor = value.slice(0, targetOffset);
  const lines = beforeCursor.split("\n");
  const line = lines.length - 1;
  const lastLine = lines[line] || "";

  return {
    line,
    ch: lastLine.endsWith("\r") ? lastLine.length - 1 : lastLine.length,
  };
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
      if (
        line &&
        Number.isFinite(line.number) &&
        Number.isFinite(line.from)
      ) {
        return normalizePosition({
          line: line.number - 1,
          ch: head - line.from,
        });
      }
    } catch (error) {
      return null;
    }
  }

  if (typeof doc.toString === "function") {
    return positionFromTextOffset(doc.toString(), head);
  }

  return null;
}

function setEditorCursor(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  try {
    editor.setCursor(position.line, position.ch);
  } catch (error) {
    editor.setCursor(position);
  }

  if (typeof editor.scrollIntoView === "function") {
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
    } catch (error) {
      try {
        editor.scrollIntoView(position);
      } catch (ignoredError) {
        // Cursor restore should still succeed if a scroll helper is unavailable.
      }
    }
  }

  return true;
}

function setEditorCursorWithoutScroll(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  try {
    editor.setCursor(position.line, position.ch);
  } catch (error) {
    editor.setCursor(position);
  }

  return true;
}

function scrollEditorLineToTop(editor, line) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(targetLine)) {
    return false;
  }

  try {
    const docLine = cm.state.doc.line(targetLine + 1);
    if (!docLine || !Number.isFinite(docLine.from)) {
      return false;
    }

    cm.dispatch({
      effects: EditorView.scrollIntoView(docLine.from, { y: "start" }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Vim `zz`-style centered scroll: dispatch a CM6 scrollIntoView centered on the
// target line/column. Mirrors scrollEditorLineToTop's feature detection and
// never throws, returning false on unsupported editor shapes so callers can
// fall back to Obsidian's editor-level scroll.
function scrollEditorLineToCenter(editor, line, ch = 0) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(targetLine)) {
    return false;
  }

  const targetCh = Math.floor(numericOrDefault(ch, 0));

  try {
    const docLine = cm.state.doc.line(targetLine + 1);
    if (!docLine || !Number.isFinite(docLine.from)) {
      return false;
    }

    const lineLength = Number.isFinite(docLine.to)
      ? Math.max(0, docLine.to - docLine.from)
      : 0;
    const clampedCh = Math.min(
      Math.max(Number.isFinite(targetCh) ? targetCh : 0, 0),
      lineLength,
    );

    cm.dispatch({
      effects: EditorView.scrollIntoView(docLine.from + clampedCh, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Defer a Vim `zz`-style center for a successful open-task jump by one frame so
// it runs after the current keydown/editor command turn (Vim normal mode can
// otherwise issue a trailing cursor-visibility scroll that overrides a
// synchronous center). Tracks a single pending center on the plugin so rapid
// repeated presses never leave a stale frame queued. Centering is best-effort:
// a failure must not turn a successful jump into a command failure.
function scheduleOpenTaskJumpCenter(plugin, editor, line, ch = 0) {
  if (!plugin) {
    return false;
  }

  cancelDeferred(plugin.pendingOpenTaskJumpCenterDeferred);
  plugin.pendingOpenTaskJumpCenterDeferred = deferToNextFrame(() => {
    plugin.pendingOpenTaskJumpCenterDeferred = null;

    if (scrollEditorLineToCenter(editor, line, ch)) {
      return;
    }

    // CM6 centering is unavailable (older Obsidian or an unexpected editor
    // shape); fall back to Obsidian's editor-level centered scroll.
    if (!editor || typeof editor.scrollIntoView !== "function") {
      return;
    }

    const position = { line, ch };
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
    } catch (error) {
      try {
        editor.scrollIntoView(position);
      } catch (ignoredError) {
        // Best-effort centering only; ignore unsupported scroll shapes.
      }
    }
  });

  return true;
}

function getEditorCursor(cm) {
  if (!cm || typeof cm.getCursor !== "function") {
    return null;
  }

  return normalizePosition(cm.getCursor());
}

function getEditorLine(cm, line) {
  if (!cm || typeof cm.getLine !== "function") {
    return null;
  }

  const lineText = cm.getLine(line);
  return lineText === null || lineText === undefined ? "" : String(lineText);
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

function positionsEqual(left, right) {
  const normalizedLeft = normalizePosition(left);
  const normalizedRight = normalizePosition(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.line === normalizedRight.line &&
      normalizedLeft.ch === normalizedRight.ch,
  );
}

function normalizeTransclusionCommitCursorOptions(options) {
  const directCursor = normalizePosition(options);
  if (directCursor) {
    return {
      invocationCursor: null,
      finalCursor: directCursor,
    };
  }

  if (!options || typeof options !== "object") {
    return {
      invocationCursor: null,
      finalCursor: null,
    };
  }

  return {
    invocationCursor: normalizePosition(options.invocationCursor),
    finalCursor: normalizePosition(options.finalCursor),
  };
}

function getTransclusionCommitFinalCursor(cm, options) {
  if (!options || !options.finalCursor) {
    return null;
  }

  if (!options.invocationCursor) {
    return options.finalCursor;
  }

  return positionsEqual(getEditorCursor(cm), options.invocationCursor)
    ? options.finalCursor
    : null;
}

