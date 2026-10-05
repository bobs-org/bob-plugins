function discoverSelectedBlockIdSource(editor, file) {
  if (
    !editor ||
    typeof editor.getValue !== "function" ||
    typeof editor.getLine !== "function" ||
    typeof editor.replaceRange !== "function"
  ) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  const selection = getSingleEditorSelection(editor);
  if (!selection) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  const content = editor.getValue();
  const lines = content.split("\n");
  const range = findLocalMarkdownBlockRange(lines, selection.head.line);
  if (!range) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  if (!selection.empty) {
    const span = selectedLineSpan(selection);
    if (span.startLine < range.startLine || span.endLine > range.endLine) {
      return {
        notice: "Selection spans multiple Markdown blocks",
      };
    }
  }

  const rangeStart = lineStartIndexFromLines(lines, range.startLine);
  const rangeEnd = lineEndIndexFromLines(lines, range.endLine);
  const blockMatches = collectBlockTokenMatches(content).filter(
    (match) => match.start >= rangeStart && match.end <= rangeEnd,
  );

  if (blockMatches.length > 1) {
    return {
      notice: "Multiple block IDs found in selected block",
    };
  }

  if (blockMatches.length === 1) {
    const blockMatch = blockMatches[0];
    const start = indexToEditorPosition(content, blockMatch.start);
    const end = indexToEditorPosition(content, blockMatch.end);

    return {
      source: {
        kind: "direct-rename",
        editor,
        sourcePath: file.path,
        targetText: "",
        oldId: blockMatch.id,
        aliasSuffix: "",
        blockPrefix: "#^",
        line: start.line,
        startCh: start.ch,
        endCh: end.ch,
        raw: `^${blockMatch.id}`,
        previewText: blockRangePreviewText(content, lines, range, blockMatch),
        prefillId: true,
      },
    };
  }

  const previewText = blockRangePreviewText(content, lines, range, null);
  const expectedBlockText = lineRangeText(lines, range.startLine, range.endLine);
  const isSingleLineBlock = range.startLine === range.contentEndLine;
  const insertionLine = range.contentEndLine;
  const insertionLineText = lines[insertionLine] || "";

  if (isSingleLineBlock) {
    const insertionCh = insertionLineText.replace(/[ \t]+$/g, "").length;
    return {
      source: {
        kind: "direct-add",
        editor,
        sourcePath: file.path,
        line: insertionLine,
        startCh: insertionCh,
        endCh: insertionLineText.length,
        addMode: "append",
        rangeStartLine: range.startLine,
        rangeEndLine: range.endLine,
        expectedBlockText,
        previewText,
      },
    };
  }

  return {
    source: {
      kind: "direct-add",
      editor,
      sourcePath: file.path,
      line: insertionLine,
      startCh: insertionLineText.length,
      endCh: insertionLineText.length,
      addMode: "standalone",
      rangeStartLine: range.startLine,
      rangeEndLine: range.endLine,
      expectedBlockText,
      previewText,
    },
  };
}

function cleanPreviewText(value) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  const text = lines.map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
  return text.trim() ? text : null;
}

function lineWithoutBlockToken(lineText, match, lineStart) {
  const tokenStart = match.start - lineStart;
  const tokenEnd = match.end - lineStart;
  const before = lineText.slice(0, tokenStart);
  const after = lineText.slice(tokenEnd);

  if (before.trim() && after.trim()) {
    return `${before.replace(/[ \t]+$/g, "")} ${after.replace(/^[ \t]+/g, "")}`;
  }

  return before + after;
}

function extractPreviousContiguousBlock(content, lineStart) {
  let prefix = content.slice(0, lineStart).replace(/\r\n?/g, "\n");
  if (prefix.endsWith("\n")) {
    prefix = prefix.slice(0, -1);
  }

  if (!prefix) {
    return null;
  }

  const lines = prefix.split("\n");
  let end = lines.length - 1;
  if (!lines[end].trim()) {
    return null;
  }

  let start = end;
  while (start > 0 && lines[start - 1].trim()) {
    start -= 1;
  }

  return cleanPreviewText(lines.slice(start, end + 1).join("\n"));
}

function extractBlockPreviewText(content, id) {
  if (typeof content !== "string" || !BLOCK_ID_RE.test(id || "")) {
    return null;
  }

  const matches = blockTokenMatches(content, id);
  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  const lineStart =
    match.start === 0 ? 0 : content.lastIndexOf("\n", match.start - 1) + 1;
  const lineEndIndex = content.indexOf("\n", match.end);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const lineText = content.slice(lineStart, lineEnd);
  const sameLinePreview = cleanPreviewText(
    lineWithoutBlockToken(lineText, match, lineStart),
  );

  if (sameLinePreview) {
    return sameLinePreview;
  }

  return extractPreviousContiguousBlock(content, lineStart);
}

function indexToEditorPosition(content, index) {
  let line = 0;
  let ch = 0;

  for (let offset = 0; offset < index; offset += 1) {
    if (content[offset] === "\n") {
      line += 1;
      ch = 0;
    } else {
      ch += 1;
    }
  }

  return { line, ch };
}

function editorPositionToIndex(content, position) {
  if (
    !position ||
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.ch) ||
    position.line < 0 ||
    position.ch < 0
  ) {
    return null;
  }

  let line = 0;
  let lineStart = 0;
  while (line < position.line) {
    const newlineIndex = content.indexOf("\n", lineStart);
    if (newlineIndex === -1) {
      return null;
    }

    lineStart = newlineIndex + 1;
    line += 1;
  }

  const newlineIndex = content.indexOf("\n", lineStart);
  const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
  if (position.ch > lineEnd - lineStart) {
    return null;
  }

  return lineStart + position.ch;
}

function sourceReplacement(source, id, blockPrefix = source.blockPrefix) {
  return `[[${source.targetText}${blockPrefix}${id}${source.aliasSuffix}]]`;
}

function taskPickerRevertReplacement(source) {
  return `[[${source.targetText}${source.blockPrefix}${source.aliasSuffix}]]`;
}

function taskPickerRevertCursorCh(source) {
  return source.startCh + 2 + source.targetText.length + source.blockPrefix.length;
}

function forEachContentLine(content, callback) {
  let lineNumber = 0;
  let lineStart = 0;

  while (lineStart <= content.length) {
    const newlineIndex = content.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    callback(content.slice(lineStart, lineEnd), lineNumber, lineStart);

    if (newlineIndex === -1) {
      break;
    }

    lineNumber += 1;
    lineStart = newlineIndex + 1;
  }
}

function forEachMarkdownLineOutsideCodeFence(content, callback) {
  let activeFence = null;

  forEachContentLine(content, (lineText, lineNumber, lineStart) => {
    if (activeFence) {
      if (isClosingFence(lineText, activeFence)) {
        activeFence = null;
      }
      return;
    }

    const openingFence = getFenceOpening(lineText);
    if (openingFence) {
      activeFence = openingFence;
      return;
    }

    callback(lineText, lineNumber, lineStart);
  });
}

function collectWikiBlockReferences(content) {
  const references = [];

  forEachMarkdownLineOutsideCodeFence(content, (lineText, lineNumber, lineStart) => {
    let match;

    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
      const reference = parseWikiBlockReference(match, lineText);
      if (!reference) {
        continue;
      }

      references.push({
        ...reference,
        line: lineNumber,
        start: lineStart + reference.startCh,
        end: lineStart + reference.endCh,
      });
    }
  });

  return references;
}

function extractMarkdownLinkDestination(body) {
  const value = normalizeText(body);
  if (!value) {
    return "";
  }

  if (value.startsWith("<")) {
    const closeIndex = value.indexOf(">");
    return closeIndex === -1 ? "" : value.slice(1, closeIndex).trim();
  }

  const whitespaceMatch = value.match(/\s/);
  return whitespaceMatch ? value.slice(0, whitespaceMatch.index) : value;
}

function collectMarkdownBlockReferences(content) {
  const references = [];

  forEachMarkdownLineOutsideCodeFence(content, (lineText, lineNumber, lineStart) => {
    let match;

    MARKDOWN_LINK_RE.lastIndex = 0;
    while ((match = MARKDOWN_LINK_RE.exec(lineText)) !== null) {
      const target = extractMarkdownLinkDestination(match[1]);
      const parsedDestination = parseBlockReferenceDestination(target);
      if (!parsedDestination) {
        continue;
      }

      references.push({
        raw: match[0],
        ...parsedDestination,
        line: lineNumber,
        start: lineStart + match.index,
        end: lineStart + match.index + match[0].length,
      });
    }
  });

  return references;
}

function validateNonOverlappingEdits(edits) {
  const sorted = [...edits].sort((left, right) => left.start - right.start);

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      return false;
    }
  }

  return true;
}

function applyTextEdits(content, edits) {
  let nextContent = content;
  const sorted = [...edits].sort((left, right) => right.start - left.start);

  for (const edit of sorted) {
    nextContent =
      nextContent.slice(0, edit.start) +
      edit.replacement +
      nextContent.slice(edit.end);
  }

  return nextContent;
}

function pomodoroEntryEndLine(lines, entryLine, sectionEndLine) {
  let endLine = entryLine;

  for (let line = entryLine + 1; line <= sectionEndLine; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line]);
    if (lineText.trim() && lineIndentWidth(lineText) === 0) {
      break;
    }

    endLine = line;
  }

  return endLine;
}

function collectFutureOpenPomodoroRanges(lines, context) {
  const ranges = [];
  const sectionEndLine = context.section.endLine;

  for (let line = context.ownerLine + 1; line <= sectionEndLine; line += 1) {
    if (!isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const status = pomodoroEntryStatus(lines[line]);
    const endLine = pomodoroEntryEndLine(lines, line, sectionEndLine);
    if (isOpenPomodoroStatus(status)) {
      ranges.push({
        entryLine: line,
        startLine: line + 1,
        endLine,
        status,
      });
    }

    line = endLine;
  }

  return ranges;
}

function collectAllOpenPomodoroRanges(lines, section) {
  const ranges = [];
  if (!Array.isArray(lines) || !section) {
    return ranges;
  }

  const fencedLines = computeFencedLineFlags(lines);
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fencedLines[line] || !isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const status = pomodoroEntryStatus(lines[line]);
    const endLine = pomodoroEntryEndLine(lines, line, section.endLine);
    if (isOpenPomodoroStatus(status)) {
      ranges.push({
        entryLine: line,
        startLine: line + 1,
        endLine,
        status,
      });
    }

    line = endLine;
  }

  return ranges;
}

