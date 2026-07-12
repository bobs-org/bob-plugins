const { MarkdownView, Plugin } = require("obsidian");

const SURROUND_OPERATOR_NAME = "bobVimSurroundAdd";
// Plain "ys" cannot win against CodeMirror Vim's built-in "y" operator.
// Keep the injected bridge private; obsidian-vimrc-support also owns <A-y>s.
const SURROUND_OPERATOR_KEYS = "<A-b>s";
const TRAILING_WHITESPACE_RE = /\s+$/;
const HORIZONTAL_WHITESPACE_RE = /[ \t]/;
const VISIBLE_SURROUND_CHAR_RE = /^[\p{L}\p{N}\p{P}\p{S}]$/u;
const MAX_SURROUND_SCAN_CHARS = 200000;
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

const SURROUND_PAIRS = {
  '"': { open: '"', close: '"', padded: false },
  "'": { open: "'", close: "'", padded: false },
  "`": { open: "`", close: "`", padded: false },
  "(": { open: "(", close: ")", padded: true },
  ")": { open: "(", close: ")", padded: false },
  "[": { open: "[", close: "]", padded: true },
  "]": { open: "[", close: "]", padded: false },
  "{": { open: "{", close: "}", padded: true },
  "}": { open: "{", close: "}", padded: false },
  "<": { open: "<", close: ">", padded: true },
  ">": { open: "<", close: ">", padded: false },
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePosition(value) {
  if (!value || !isFiniteNumber(value.line) || !isFiniteNumber(value.ch)) {
    return null;
  }

  return {
    line: Math.max(0, Math.floor(value.line)),
    ch: Math.max(0, Math.floor(value.ch)),
  };
}

function normalizeOperatorEndpoint(cm, value) {
  if (
    value &&
    isFiniteNumber(value.line) &&
    typeof value.ch === "number" &&
    !Number.isFinite(value.ch) &&
    cm &&
    typeof cm.clipPos === "function"
  ) {
    const clipped = cm.clipPos({
      line: Math.max(0, Math.floor(value.line)),
      ch: value.ch,
    });
    return normalizePosition(clipped);
  }

  return normalizePosition(value);
}

function comparePositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.ch - right.ch;
}

function sortPositionPair(left, right) {
  return comparePositions(left, right) <= 0
    ? { start: left, end: right }
    : { start: right, end: left };
}

function normalizeRange(cm, value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value) && value.length >= 2) {
    const start = normalizeOperatorEndpoint(cm, value[0]);
    const end = normalizeOperatorEndpoint(cm, value[1]);
    return start && end ? sortPositionPair(start, end) : null;
  }

  const fromValue =
    typeof value.from === "function" ? value.from() : value.from;
  const toValue = typeof value.to === "function" ? value.to() : value.to;
  const rawStart =
    fromValue || value.start || value.anchor || value.oldAnchor || value.head;
  const rawEnd =
    toValue || value.end || value.head || value.newHead || value.anchor;
  const start = normalizeOperatorEndpoint(cm, rawStart);
  const end = normalizeOperatorEndpoint(cm, rawEnd);

  return start && end ? sortPositionPair(start, end) : null;
}

function collectRawRanges(ranges, oldAnchor, newHead, operatorArgs) {
  if (Array.isArray(ranges) && ranges.length > 0) {
    return ranges;
  }

  if (Array.isArray(operatorArgs) && operatorArgs.length > 0) {
    return operatorArgs;
  }

  if (Array.isArray(operatorArgs && operatorArgs.ranges)) {
    return operatorArgs.ranges;
  }

  if (
    operatorArgs &&
    (operatorArgs.from || operatorArgs.start || operatorArgs.anchor)
  ) {
    return [operatorArgs];
  }

  const directStart = normalizePosition(ranges);
  const directEnd = normalizePosition(oldAnchor);
  if (directStart && directEnd) {
    return [[directStart, directEnd]];
  }

  const start = normalizePosition(oldAnchor);
  const end = normalizePosition(newHead);
  return start && end ? [[start, end]] : [];
}

function getRangeText(cm, start, end) {
  if (cm && typeof cm.getRange === "function") {
    return cm.getRange(start, end);
  }

  if (!cm || typeof cm.getLine !== "function") {
    return "";
  }

  if (start.line === end.line) {
    return String(cm.getLine(start.line) || "").slice(start.ch, end.ch);
  }

  const lines = [String(cm.getLine(start.line) || "").slice(start.ch)];
  for (let line = start.line + 1; line < end.line; line += 1) {
    lines.push(String(cm.getLine(line) || ""));
  }
  lines.push(String(cm.getLine(end.line) || "").slice(0, end.ch));
  return lines.join("\n");
}

function advancePosition(start, text) {
  const next = { line: start.line, ch: start.ch };
  const source = String(text || "");

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      next.line += 1;
      next.ch = 0;
    } else {
      next.ch += 1;
    }
  }

  return next;
}

function trimTrailingWhitespaceFromRange(cm, range) {
  const text = getRangeText(cm, range.start, range.end);
  const trimmedText = String(text || "").replace(TRAILING_WHITESPACE_RE, "");

  if (!trimmedText) {
    return null;
  }

  return {
    start: range.start,
    end: advancePosition(range.start, trimmedText),
  };
}

function collectSurroundSpans(cm, ranges, oldAnchor, newHead, operatorArgs) {
  const spans = [];

  for (const rawRange of collectRawRanges(
    ranges,
    oldAnchor,
    newHead,
    operatorArgs,
  )) {
    const range = normalizeRange(cm, rawRange);
    if (!range || comparePositions(range.start, range.end) === 0) {
      continue;
    }

    const trimmedRange = trimTrailingWhitespaceFromRange(cm, range);
    if (trimmedRange) {
      spans.push(trimmedRange);
    }
  }

  return spans.sort((left, right) => comparePositions(left.start, right.start));
}

function isSymmetricSurroundChar(key) {
  return (
    typeof key === "string" &&
    key.length === 1 &&
    VISIBLE_SURROUND_CHAR_RE.test(key)
  );
}

function getSurroundPair(key) {
  if (SURROUND_PAIRS[key]) {
    return SURROUND_PAIRS[key];
  }

  return isSymmetricSurroundChar(key)
    ? { open: key, close: key, padded: false }
    : null;
}

function isHorizontalWhitespaceChar(value) {
  return (
    typeof value === "string" &&
    value.length === 1 &&
    HORIZONTAL_WHITESPACE_RE.test(value)
  );
}

function getDocumentLines(cm) {
  if (cm && typeof cm.getValue === "function") {
    return String(cm.getValue()).split("\n");
  }

  if (cm && typeof cm.lineCount === "function") {
    const lineCount = Math.max(0, Math.floor(cm.lineCount()));
    const lines = [];
    for (let line = 0; line < lineCount; line += 1) {
      lines.push(String(cm.getLine(line) || ""));
    }
    return lines.length > 0 ? lines : [""];
  }

  if (cm && typeof cm.getLine === "function") {
    return [String(cm.getLine(0) || "")];
  }

  return [""];
}

function buildDocumentSnapshot(cm) {
  const lines = getDocumentLines(cm);
  const lineStarts = [];
  let nextLineStart = 0;

  for (let line = 0; line < lines.length; line += 1) {
    lineStarts.push(nextLineStart);
    nextLineStart += lines[line].length;
    if (line < lines.length - 1) {
      nextLineStart += 1;
    }
  }

  return {
    lines,
    lineStarts,
    text: lines.join("\n"),
  };
}

function positionToIndex(doc, position) {
  if (!doc || !Array.isArray(doc.lines) || doc.lines.length === 0) {
    return 0;
  }

  const normalized = normalizePosition(position) || { line: 0, ch: 0 };
  const line = Math.min(normalized.line, doc.lines.length - 1);
  const ch = Math.min(normalized.ch, doc.lines[line].length);
  return doc.lineStarts[line] + ch;
}

function indexToPosition(doc, index) {
  if (!doc || !Array.isArray(doc.lines) || doc.lines.length === 0) {
    return { line: 0, ch: 0 };
  }

  const clampedIndex = Math.max(
    0,
    Math.min(Math.floor(index), doc.text.length),
  );
  let low = 0;
  let high = doc.lines.length - 1;
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (doc.lineStarts[mid] <= clampedIndex) {
      line = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineStart = doc.lineStarts[line];
  const lineEnd = lineStart + doc.lines[line].length;
  return {
    line,
    ch: Math.min(clampedIndex, lineEnd) - lineStart,
  };
}

function rangeFromIndexes(doc, startIndex, endIndex) {
  return {
    start: indexToPosition(doc, startIndex),
    end: indexToPosition(doc, endIndex),
  };
}

function buildSurroundMatch(
  doc,
  targetKey,
  targetPair,
  openIndex,
  closeIndex,
  openLength = 1,
  closeLength = 1,
) {
  if (
    !doc ||
    !targetPair ||
    !isFiniteNumber(openIndex) ||
    !isFiniteNumber(closeIndex) ||
    !isFiniteNumber(openLength) ||
    !isFiniteNumber(closeLength) ||
    openIndex < 0 ||
    openLength < 1 ||
    closeLength < 1 ||
    closeIndex < openIndex + openLength ||
    closeIndex + closeLength > doc.text.length
  ) {
    return null;
  }

  return {
    doc,
    targetKey,
    targetPair,
    open: {
      index: openIndex,
      length: openLength,
      range: rangeFromIndexes(doc, openIndex, openIndex + openLength),
    },
    close: {
      index: closeIndex,
      length: closeLength,
      range: rangeFromIndexes(doc, closeIndex, closeIndex + closeLength),
    },
  };
}

function findQuoteSurroundPair(doc, targetKey, targetPair, cursor) {
  const line = Math.min(cursor.line, doc.lines.length - 1);
  const lineText = doc.lines[line] || "";
  const cursorCh = Math.min(cursor.ch, lineText.length);
  const quoteRuns = [];

  for (let ch = 0; ch < lineText.length; ch += 1) {
    if (lineText[ch] === targetPair.open) {
      const start = ch;
      while (
        ch + 1 < lineText.length &&
        lineText[ch + 1] === targetPair.open
      ) {
        ch += 1;
      }
      quoteRuns.push({ start, length: ch - start + 1 });
    }
  }

  for (let index = 0; index + 1 < quoteRuns.length; index += 2) {
    const openRun = quoteRuns[index];
    const closeRun = quoteRuns[index + 1];
    const closeRunEnd = closeRun.start + closeRun.length;
    if (
      openRun.length === closeRun.length &&
      openRun.start <= cursorCh &&
      cursorCh < closeRunEnd
    ) {
      const openIndex = doc.lineStarts[line] + openRun.start;
      const closeIndex = doc.lineStarts[line] + closeRun.start;
      return buildSurroundMatch(
        doc,
        targetKey,
        targetPair,
        openIndex,
        closeIndex,
        openRun.length,
        closeRun.length,
      );
    }
  }

  return null;
}

function findBracketOpeningIndex(doc, pair, cursorIndex) {
  const text = doc.text;
  if (text[cursorIndex] === pair.open) {
    return cursorIndex;
  }

  const startIndex =
    text[cursorIndex] === pair.close
      ? cursorIndex - 1
      : Math.min(cursorIndex, text.length - 1);
  let depth = 0;
  let scanned = 0;

  for (
    let index = startIndex;
    index >= 0 && scanned < MAX_SURROUND_SCAN_CHARS;
    index -= 1, scanned += 1
  ) {
    const char = text[index];
    if (char === pair.close) {
      depth += 1;
    } else if (char === pair.open) {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return null;
}

function findBracketClosingIndex(doc, pair, openingIndex, cursorIndex) {
  const text = doc.text;
  if (text[cursorIndex] === pair.close) {
    return cursorIndex;
  }

  let depth = 0;
  let scanned = 0;

  for (
    let index = openingIndex + 1;
    index < text.length && scanned < MAX_SURROUND_SCAN_CHARS;
    index += 1, scanned += 1
  ) {
    const char = text[index];
    if (char === pair.open) {
      depth += 1;
    } else if (char === pair.close) {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return null;
}

function findEnclosingSurroundPair(cm, targetKey) {
  const targetPair = getSurroundPair(targetKey);
  const cursor =
    cm && typeof cm.getCursor === "function"
      ? normalizePosition(cm.getCursor())
      : null;
  if (!targetPair || !cursor) {
    return null;
  }

  const doc = buildDocumentSnapshot(cm);
  const cursorIndex = positionToIndex(doc, cursor);

  if (targetPair.open === targetPair.close) {
    return findQuoteSurroundPair(doc, targetKey, targetPair, cursor);
  }

  const openIndex = findBracketOpeningIndex(doc, targetPair, cursorIndex);
  if (!isFiniteNumber(openIndex)) {
    return null;
  }

  const closeIndex = findBracketClosingIndex(
    doc,
    targetPair,
    openIndex,
    cursorIndex,
  );
  if (
    !isFiniteNumber(closeIndex) ||
    cursorIndex < openIndex ||
    cursorIndex > closeIndex
  ) {
    return null;
  }

  return buildSurroundMatch(
    doc,
    targetKey,
    targetPair,
    openIndex,
    closeIndex,
  );
}

function buildTargetSurroundSpans(match) {
  if (!match || !match.doc || !match.targetPair) {
    return null;
  }

  const doc = match.doc;
  let openingEndIndex = match.open.index + match.open.length;
  let closingStartIndex = match.close.index;

  if (match.targetPair.padded) {
    if (
      openingEndIndex < closingStartIndex &&
      isHorizontalWhitespaceChar(doc.text[openingEndIndex])
    ) {
      openingEndIndex += 1;
    }

    if (
      closingStartIndex - 1 >= openingEndIndex &&
      isHorizontalWhitespaceChar(doc.text[closingStartIndex - 1])
    ) {
      closingStartIndex -= 1;
    }
  }

  return {
    doc,
    openingIndex: match.open.index,
    openingRange: rangeFromIndexes(doc, match.open.index, openingEndIndex),
    closingRange: rangeFromIndexes(
      doc,
      closingStartIndex,
      match.close.index + match.close.length,
    ),
  };
}

function buildChangeSurroundEdit(match, replacementPair) {
  const spans = buildTargetSurroundSpans(match);
  if (!spans || !replacementPair) {
    return null;
  }

  const openingText = replacementPair.padded
    ? `${replacementPair.open} `
    : replacementPair.open;
  const closingText = replacementPair.padded
    ? ` ${replacementPair.close}`
    : replacementPair.close;

  return {
    openingText,
    closingText,
    openingRange: spans.openingRange,
    closingRange: spans.closingRange,
    cursor: indexToPosition(spans.doc, spans.openingIndex + openingText.length),
  };
}

function buildDeleteSurroundEdit(match) {
  const spans = buildTargetSurroundSpans(match);
  if (!spans) {
    return null;
  }

  return {
    openingText: "",
    closingText: "",
    openingRange: spans.openingRange,
    closingRange: spans.closingRange,
    cursor: indexToPosition(spans.doc, spans.openingIndex),
  };
}

function isModifierOnlyKey(event) {
  return !!event && MODIFIER_KEYS.has(event.key);
}

function getSurroundKeyFromEvent(event) {
  if (
    !event ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return null;
  }

  return typeof event.key === "string" && event.key.length === 1
    ? event.key
    : null;
}

function getPlainLowercaseKeyFromEvent(event) {
  if (
    !event ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null;
  }

  return typeof event.key === "string" && event.key.length === 1
    ? event.key
    : null;
}

function consumeEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function operation(cm, callback) {
  if (cm && typeof cm.operation === "function") {
    cm.operation(callback);
    return;
  }

  callback();
}

function replaceRange(cm, text, from, to) {
  if (cm && typeof cm.replaceRange === "function") {
    cm.replaceRange(text, from, to);
  }
}

function setCursor(cm, position) {
  if (cm && typeof cm.setCursor === "function") {
    cm.setCursor(position);
  }
}

function getDocSignature(cm) {
  const cm6Doc = cm && cm.cm6 && cm.cm6.state && cm.cm6.state.doc;
  if (cm6Doc) {
    return cm6Doc;
  }

  return cm && typeof cm.getValue === "function" ? cm.getValue() : null;
}

class BobVimSurroundPlugin extends Plugin {
  onload() {
    this.pendingSurround = null;
    this.pendingChangeSurround = null;
    this.pendingDeleteSurround = null;
    this.surroundTriggerCandidate = null;
    this.lastSurroundAction = null;
    this.surroundDocSig = null;
    this.vimMappingsRegistered = false;
    this.handledSurroundEvents = new WeakSet();

    this.registerSurroundInputListeners();

    this.app.workspace.onLayoutReady(() => {
      if (this.registerVimMappings()) {
        return;
      }

      const ref = this.app.workspace.on("active-leaf-change", () => {
        if (this.registerVimMappings()) {
          this.app.workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });
  }

  onunload() {
    this.pendingSurround = null;
    this.pendingChangeSurround = null;
    this.pendingDeleteSurround = null;
    this.surroundTriggerCandidate = null;
    this.clearLastSurroundAction();
  }

  registerSurroundInputListeners() {
    const keydownHandler = (event) => this.handleSurroundKeydown(event);

    const windowObject = typeof window === "undefined" ? null : window;
    const documentObject = typeof document === "undefined" ? null : document;
    const targets = [];
    if (windowObject) {
      targets.push(windowObject);
    }
    if (documentObject && documentObject !== windowObject) {
      targets.push(documentObject);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    const vim = codeMirrorAdapter && codeMirrorAdapter.Vim;
    if (
      !vim ||
      typeof vim.defineOperator !== "function" ||
      typeof vim.mapCommand !== "function"
    ) {
      return false;
    }

    vim.defineOperator(
      SURROUND_OPERATOR_NAME,
      (cm, operatorArgs, ranges, oldAnchor, newHead) =>
        this.handleSurroundOperator(cm, operatorArgs, ranges, oldAnchor, newHead),
    );
    vim.mapCommand(
      SURROUND_OPERATOR_KEYS,
      "operator",
      SURROUND_OPERATOR_NAME,
      {},
      { context: "normal" },
    );

    this.vimMappingsRegistered = true;
    return true;
  }

  getVim() {
    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    return codeMirrorAdapter && codeMirrorAdapter.Vim;
  }

  getFocusedMarkdownEditorView(event) {
    const workspace = this.app && this.app.workspace;
    const view =
      workspace && typeof workspace.getActiveViewOfType === "function"
        ? workspace.getActiveViewOfType(MarkdownView)
        : null;
    if (
      !(view instanceof MarkdownView) ||
      !this.isEditorEventTarget(event, view)
    ) {
      return null;
    }

    return view;
  }

  isEditorEventTarget(event, view) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    const editorEl = target.closest(".cm-editor");
    if (!editorEl) {
      return false;
    }

    const containerEl = view && view.containerEl;
    return (
      !containerEl ||
      typeof containerEl.contains !== "function" ||
      containerEl.contains(editorEl)
    );
  }

  resolveEventNormalModeVimCm(event) {
    const view = this.getFocusedMarkdownEditorView(event);
    return view ? this.resolveNormalModeVimCm(view.editor, view) : null;
  }

  resolveNormalModeVimCm(editor, view) {
    const editorCm = editor && editor.cm && editor.cm.cm;
    const viewCm =
      view &&
      view.editMode &&
      view.editMode.editor &&
      view.editMode.editor.cm &&
      view.editMode.editor.cm.cm;
    const cm = editorCm || viewCm;
    if (!cm || typeof cm.getCursor !== "function") {
      return null;
    }

    const mode = this.getCurrentVimMode(cm);
    if (
      ["insert", "visual", "visual-block", "visual-line", "replace"].includes(
        mode,
      )
    ) {
      return null;
    }

    return cm;
  }

  getCurrentVimMode(cm) {
    const vimState = cm && cm.state && cm.state.vim;
    if (vimState) {
      if (vimState.insertMode === true) {
        return "insert";
      }
      if (vimState.visualMode === true) {
        return "visual";
      }
      if (vimState.replaceMode === true) {
        return "replace";
      }
      if (typeof vimState.mode === "string") {
        return vimState.mode;
      }
    }

    const vimrcSupport =
      this.app &&
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["obsidian-vimrc-support"];
    return vimrcSupport && typeof vimrcSupport.currentVimStatus === "string"
      ? vimrcSupport.currentVimStatus
      : null;
  }

  injectVimKey(cm, key, vim) {
    vim = vim || this.getVim();
    if (!vim || typeof vim.handleKey !== "function") {
      return false;
    }

    vim.handleKey(cm, key, "mapping");
    return true;
  }

  injectSurroundOperatorTrigger(cm, vim) {
    if (!this.injectVimKey(cm, "<Esc>", vim)) {
      return false;
    }

    return (
      this.injectVimKey(cm, "<A-b>", vim) &&
      this.injectVimKey(cm, "s", vim)
    );
  }

  recordLastSurroundAction(cm, action) {
    this.lastSurroundAction = action;
    this.surroundDocSig = getDocSignature(cm);
  }

  clearLastSurroundAction() {
    this.lastSurroundAction = null;
    this.surroundDocSig = null;
  }

  isSurroundStillLastChange(cm) {
    return (
      this.surroundDocSig !== null &&
      getDocSignature(cm) === this.surroundDocSig
    );
  }

  handleSurroundOperator(cm, operatorArgs, ranges, oldAnchor, newHead) {
    const spans = collectSurroundSpans(
      cm,
      ranges,
      oldAnchor,
      newHead,
      operatorArgs,
    );

    if (spans.length === 0) {
      this.pendingSurround = null;
      return normalizePosition(oldAnchor) || false;
    }

    this.pendingSurround = {
      cm,
      spans,
    };
    return spans[0].start;
  }

  handleSurroundKeydown(event) {
    if (
      this.handledSurroundEvents &&
      this.handledSurroundEvents.has(event)
    ) {
      return false;
    }
    if (this.handledSurroundEvents) {
      this.handledSurroundEvents.add(event);
    }

    if (this.pendingChangeSurround) {
      return this.handlePendingChangeSurroundKeydown(event);
    }

    if (this.pendingDeleteSurround) {
      return this.handlePendingDeleteSurroundKeydown(event);
    }

    if (this.pendingSurround) {
      return this.handlePendingSurroundKeydown(event);
    }

    if (
      this.lastSurroundAction &&
      !this.surroundTriggerCandidate &&
      getPlainLowercaseKeyFromEvent(event) === "." &&
      this.handleSurroundDotRepeat(event)
    ) {
      return true;
    }

    return this.handlePhysicalSurroundTriggerKeydown(event);
  }

  handleSurroundDotRepeat(event) {
    const cm = this.resolveEventNormalModeVimCm(event);
    const action = this.lastSurroundAction;
    if (!cm || !action || action.cm !== cm) {
      return false;
    }

    // Motions preserve the signature, but real edits should fall through to
    // CodeMirror Vim's native dot-repeat.
    if (!this.isSurroundStillLastChange(cm)) {
      this.clearLastSurroundAction();
      return false;
    }

    if (action.type === "ys") {
      const vimState = cm.state && cm.state.vim;
      const lastEdit = vimState && vimState.lastEditInputState;
      // A no-text-change command such as yank can replace Vim's last edit
      // record while leaving the document signature intact.
      if (!lastEdit || lastEdit.operator !== SURROUND_OPERATOR_NAME) {
        return false;
      }

      consumeEvent(event);
      this.replayAddSurround(cm, action);
      return true;
    }

    if (action.type === "cs") {
      consumeEvent(event);
      this.replayChangeSurround(cm, action);
      return true;
    }

    if (action.type === "ds") {
      consumeEvent(event);
      this.replayDeleteSurround(cm, action);
      return true;
    }

    return false;
  }

  replayAddSurround(cm, action) {
    this.pendingSurround = null;
    if (!this.injectVimKey(cm, ".")) {
      return false;
    }

    const pendingSurround = this.pendingSurround;
    this.pendingSurround = null;
    return pendingSurround
      ? this.applySurround(pendingSurround, action.pair)
      : false;
  }

  replayChangeSurround(cm, action) {
    this.injectVimKey(cm, "<Esc>");
    return this.applyChangeSurround(
      { cm, targetKey: action.targetKey },
      action.pair,
    );
  }

  replayDeleteSurround(cm, action) {
    this.injectVimKey(cm, "<Esc>");
    return this.applyDeleteSurround({ cm }, action.targetKey);
  }

  handlePhysicalSurroundTriggerKeydown(event) {
    const key = getPlainLowercaseKeyFromEvent(event);
    const candidate = this.surroundTriggerCandidate;

    if (candidate && key !== "s") {
      if (!isModifierOnlyKey(event)) {
        this.surroundTriggerCandidate = null;
      }
      return false;
    }

    if (!candidate) {
      if (key === "y" || key === "c" || key === "d") {
        const cm = this.resolveEventNormalModeVimCm(event);
        this.surroundTriggerCandidate = cm ? { cm, op: key } : null;
      }
      return false;
    }

    this.surroundTriggerCandidate = null;

    const cm = this.resolveEventNormalModeVimCm(event);
    if (!cm || cm !== candidate.cm) {
      return false;
    }
    const vim = this.getVim();
    if (!vim || typeof vim.handleKey !== "function") {
      return false;
    }
    if (candidate.op === "y" && !this.registerVimMappings()) {
      return false;
    }

    if (this.handledSurroundEvents) {
      this.handledSurroundEvents.add(event);
    }

    consumeEvent(event);
    this.pendingSurround = null;
    this.pendingChangeSurround = null;
    this.pendingDeleteSurround = null;

    if (candidate.op === "y") {
      return this.injectSurroundOperatorTrigger(cm, vim);
    }

    if (!this.injectVimKey(cm, "<Esc>", vim)) {
      return false;
    }

    if (candidate.op === "c") {
      this.pendingChangeSurround = {
        cm,
        stage: "target",
        targetKey: null,
      };
    } else {
      this.pendingDeleteSurround = { cm };
    }
    return true;
  }

  handlePendingSurroundKeydown(event) {
    const key = getSurroundKeyFromEvent(event);
    const pair = getSurroundPair(key);
    if (!pair) {
      if (isModifierOnlyKey(event)) {
        return false;
      }
      if (this.handledSurroundEvents) {
        this.handledSurroundEvents.add(event);
      }
      consumeEvent(event);
      this.pendingSurround = null;
      return true;
    }

    if (this.handledSurroundEvents) {
      this.handledSurroundEvents.add(event);
    }

    consumeEvent(event);
    const pendingSurround = this.pendingSurround;
    this.pendingSurround = null;
    this.applySurround(pendingSurround, pair);
    return true;
  }

  handlePendingChangeSurroundKeydown(event) {
    if (event && (event.key === "Escape" || event.key === "Esc")) {
      if (this.handledSurroundEvents) {
        this.handledSurroundEvents.add(event);
      }
      consumeEvent(event);
      this.pendingChangeSurround = null;
      return true;
    }

    const key = getSurroundKeyFromEvent(event);
    const pair = getSurroundPair(key);
    if (!pair) {
      if (isModifierOnlyKey(event)) {
        return false;
      }
      if (this.handledSurroundEvents) {
        this.handledSurroundEvents.add(event);
      }
      consumeEvent(event);
      this.pendingChangeSurround = null;
      return true;
    }

    if (this.handledSurroundEvents) {
      this.handledSurroundEvents.add(event);
    }

    consumeEvent(event);
    const pendingChangeSurround = this.pendingChangeSurround;

    if (pendingChangeSurround.stage === "target") {
      this.pendingChangeSurround = {
        cm: pendingChangeSurround.cm,
        stage: "replacement",
        targetKey: key,
      };
      return true;
    }

    this.pendingChangeSurround = null;
    this.applyChangeSurround(pendingChangeSurround, pair);
    return true;
  }

  handlePendingDeleteSurroundKeydown(event) {
    if (event && (event.key === "Escape" || event.key === "Esc")) {
      if (this.handledSurroundEvents) {
        this.handledSurroundEvents.add(event);
      }
      consumeEvent(event);
      this.pendingDeleteSurround = null;
      return true;
    }

    const key = getSurroundKeyFromEvent(event);
    const pair = getSurroundPair(key);
    if (!pair) {
      if (isModifierOnlyKey(event)) {
        return false;
      }
      if (this.handledSurroundEvents) {
        this.handledSurroundEvents.add(event);
      }
      consumeEvent(event);
      this.pendingDeleteSurround = null;
      return true;
    }

    if (this.handledSurroundEvents) {
      this.handledSurroundEvents.add(event);
    }

    consumeEvent(event);
    const pendingDeleteSurround = this.pendingDeleteSurround;
    this.pendingDeleteSurround = null;
    this.applyDeleteSurround(pendingDeleteSurround, key);
    return true;
  }

  applySurround(pendingSurround, pair) {
    if (
      !pendingSurround ||
      !pendingSurround.cm ||
      !Array.isArray(pendingSurround.spans) ||
      pendingSurround.spans.length === 0
    ) {
      return false;
    }

    const cm = pendingSurround.cm;
    const openingText = pair.padded ? `${pair.open} ` : pair.open;
    const closingText = pair.padded ? ` ${pair.close}` : pair.close;
    const spans = pendingSurround.spans
      .slice()
      .sort((left, right) => comparePositions(right.start, left.start));
    const firstStart = pendingSurround.spans[0].start;

    operation(cm, () => {
      for (const span of spans) {
        replaceRange(cm, closingText, span.end, span.end);
        replaceRange(cm, openingText, span.start, span.start);
      }
      setCursor(cm, {
        line: firstStart.line,
        ch: firstStart.ch + openingText.length,
      });
    });

    this.recordLastSurroundAction(cm, { type: "ys", cm, pair });
    return true;
  }

  applyChangeSurround(pendingChangeSurround, replacementPair) {
    if (
      !pendingChangeSurround ||
      !pendingChangeSurround.cm ||
      !pendingChangeSurround.targetKey ||
      !replacementPair
    ) {
      return false;
    }

    const cm = pendingChangeSurround.cm;
    const match = findEnclosingSurroundPair(
      cm,
      pendingChangeSurround.targetKey,
    );
    const edit = buildChangeSurroundEdit(match, replacementPair);
    if (!edit) {
      return false;
    }

    operation(cm, () => {
      replaceRange(
        cm,
        edit.closingText,
        edit.closingRange.start,
        edit.closingRange.end,
      );
      replaceRange(
        cm,
        edit.openingText,
        edit.openingRange.start,
        edit.openingRange.end,
      );
      setCursor(cm, edit.cursor);
    });

    this.recordLastSurroundAction(cm, {
      type: "cs",
      cm,
      targetKey: pendingChangeSurround.targetKey,
      pair: replacementPair,
    });
    return true;
  }

  applyDeleteSurround(pendingDeleteSurround, targetKey) {
    if (!pendingDeleteSurround || !pendingDeleteSurround.cm || !targetKey) {
      return false;
    }

    const cm = pendingDeleteSurround.cm;
    const match = findEnclosingSurroundPair(cm, targetKey);
    const edit = buildDeleteSurroundEdit(match);
    if (!edit) {
      return false;
    }

    operation(cm, () => {
      replaceRange(
        cm,
        edit.closingText,
        edit.closingRange.start,
        edit.closingRange.end,
      );
      replaceRange(
        cm,
        edit.openingText,
        edit.openingRange.start,
        edit.openingRange.end,
      );
      setCursor(cm, edit.cursor);
    });

    this.recordLastSurroundAction(cm, { type: "ds", cm, targetKey });
    return true;
  }
}

BobVimSurroundPlugin.__test = {
  SURROUND_PAIRS,
  buildChangeSurroundEdit,
  buildDeleteSurroundEdit,
  findEnclosingSurroundPair,
  getSurroundPair,
};

module.exports = BobVimSurroundPlugin;
