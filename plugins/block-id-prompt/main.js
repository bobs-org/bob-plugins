const {
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  Setting,
  setIcon,
  TFile,
} = require("obsidian");
const { EditorView } = require("@codemirror/view");

const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK_RE = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const OPEN_OBSIDIAN_TASK_STATUSES = new Set([" ", "/", "B"]);
const OBSIDIAN_TASK_LINE_RE =
  /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
const PROJECT_TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/;
const PROJECT_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/g;
const TRAILING_BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const TASKS_INLINE_FIELD_RE = /[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g;
const TASKS_EMOJI_DATE_RE =
  /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g;
const SCAN_DEBOUNCE_MS = 75;
const EDIT_SUPPRESS_MS = 250;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (error) {
    return value;
  }
}

function stripWrappingQuotes(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function normalizeLinkTarget(value) {
  let target = normalizeText(value);
  if (!target) {
    return "";
  }

  target = stripWrappingQuotes(target);
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  return safeDecodeUri(target);
}

function minPositiveIndex(first, second) {
  if (first === -1) {
    return second;
  }

  if (second === -1) {
    return first;
  }

  return Math.min(first, second);
}

function findSubpathIndex(linkText) {
  const headingIndex = linkText.indexOf("#");
  const blockIndex = linkText.indexOf("^");

  return minPositiveIndex(headingIndex, blockIndex);
}

function stripLinkSubpath(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  return subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
}

function stripMarkdownExtension(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  const pathPart = subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
  const subpathPart = subpathIndex === -1 ? "" : linkText.slice(subpathIndex);

  return pathPart.replace(/\.md$/i, "") + subpathPart;
}

function sourceKey(source) {
  return [
    source.kind || "marker-link",
    source.sourcePath,
    source.line,
    source.startCh,
    source.endCh,
    source.oldId,
  ].join(":");
}

function splitWikiLinkBody(body) {
  const pipeIndex = body.indexOf("|");
  return {
    destination: pipeIndex === -1 ? body : body.slice(0, pipeIndex),
    aliasSuffix: pipeIndex === -1 ? "" : body.slice(pipeIndex),
  };
}

function parseTrailingTaskPickerMarker(match) {
  const raw = match[0];
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  let markerIndex = destination.lastIndexOf("#^^");
  let blockPrefix = "#^";

  if (markerIndex === -1 || markerIndex + 3 !== destination.length) {
    markerIndex = destination.lastIndexOf("^^");
    blockPrefix = "^";
    if (markerIndex === -1 || markerIndex + 2 !== destination.length) {
      return null;
    }
  }

  const targetText = destination.slice(0, markerIndex);
  if (targetText.includes("^")) {
    return null;
  }

  const markerStartCh = match.index + 2 + markerIndex;
  const markerEndCh = match.index + 2 + destination.length;

  return {
    kind: "link-task-picker",
    raw,
    targetText,
    aliasSuffix,
    blockPrefix,
    startCh: match.index,
    endCh: match.index + raw.length,
    markerStartCh,
    markerEndCh,
  };
}

function parseInlineMarkerLink(match) {
  const raw = match[0];
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const markerIndex = destination.lastIndexOf("#^^");

  if (markerIndex === -1) {
    return null;
  }

  const oldId = destination.slice(markerIndex + 3);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    raw,
    targetText: destination.slice(0, markerIndex),
    oldId,
    aliasSuffix,
    blockPrefix: "#^",
    startCh: match.index,
    endCh: match.index + raw.length,
  };
}

function parseTrailingBlockDestination(destination) {
  const hashBlockIndex = destination.lastIndexOf("#^");
  if (hashBlockIndex !== -1) {
    const oldId = destination.slice(hashBlockIndex + 2);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, hashBlockIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const bareBlockIndex = destination.lastIndexOf("^");
  if (bareBlockIndex === -1) {
    return null;
  }

  const oldId = destination.slice(bareBlockIndex + 1);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    targetText: destination.slice(0, bareBlockIndex),
    oldId,
    blockPrefix: "^",
  };
}

function getCaretCompletionDestination(destination) {
  const parsed = parseTrailingBlockDestination(destination);
  if (!parsed) {
    return destination;
  }

  if (parsed.blockPrefix === "#^") {
    return `${parsed.targetText}#`;
  }

  return parsed.targetText;
}

function hasSingleTrailingMarker(lineText, markerCh, markerChar) {
  return (
    lineText[markerCh] === markerChar && lineText[markerCh + 1] !== markerChar
  );
}

function parseTrailingAtBlockRenameMarker(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  if (!hasSingleTrailingMarker(lineText, markerCh, "@")) {
    return null;
  }

  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const parsedDestination = parseTrailingBlockDestination(destination);
  if (!parsedDestination) {
    return null;
  }

  return {
    raw: raw + "@",
    ...parsedDestination,
    aliasSuffix,
    startCh: match.index,
    endCh: markerCh + 1,
  };
}

function parseTrailingCaretCompletionMarker(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  if (!hasSingleTrailingMarker(lineText, markerCh, "^")) {
    return null;
  }

  const { destination } = splitWikiLinkBody(match[1]);
  if (!normalizeText(destination)) {
    return null;
  }

  const completionDestination = getCaretCompletionDestination(destination);
  const insertionCh = match.index + 2 + completionDestination.length;

  return {
    kind: "file-link-jump",
    raw: raw + "^",
    destination,
    plainReplacement: `[[${completionDestination}]]`,
    completionReplacement: `[[${completionDestination}^]]`,
    startCh: match.index,
    endCh: markerCh + 1,
    insertionCh,
    finalCursorCh: insertionCh + 1,
  };
}

function parseMarkerLink(match, lineText) {
  return (
    parseTrailingCaretCompletionMarker(match, lineText) ||
    parseTrailingAtBlockRenameMarker(match, lineText) ||
    parseInlineMarkerLink(match)
  );
}

function parseBlockReferenceDestination(destination, options = {}) {
  const markerIndex = destination.lastIndexOf("#^^");
  if (markerIndex !== -1) {
    const oldId = destination.slice(markerIndex + 3);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, markerIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const hashBlockIndex = destination.lastIndexOf("#^");
  if (hashBlockIndex !== -1) {
    const oldId = destination.slice(hashBlockIndex + 2);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, hashBlockIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const bareBlockIndex = destination.lastIndexOf("^");
  if (
    bareBlockIndex === -1 ||
    (bareBlockIndex !== 0 && !options.allowPathBareBlock)
  ) {
    return null;
  }

  const oldId = destination.slice(bareBlockIndex + 1);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    targetText: destination.slice(0, bareBlockIndex),
    oldId,
    blockPrefix: "^",
  };
}

function parseWikiBlockReference(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  const hasTrailingMarker =
    hasSingleTrailingMarker(lineText, markerCh, "^") ||
    hasSingleTrailingMarker(lineText, markerCh, "@");
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const parsedDestination = parseBlockReferenceDestination(destination, {
    allowPathBareBlock: true,
  });

  if (!parsedDestination) {
    return null;
  }

  const endCh = hasTrailingMarker ? markerCh + 1 : markerCh;

  return {
    raw: lineText.slice(match.index, endCh),
    ...parsedDestination,
    aliasSuffix,
    startCh: match.index,
    endCh,
  };
}

function findMarkerLinkNearCursor(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const parsed = parseMarkerLink(match, lineText);
    if (!parsed) {
      continue;
    }

    const cursorInside =
      cursorCh >= parsed.startCh && cursorCh <= parsed.endCh;
    const cursorJustAfter =
      cursorCh > parsed.endCh && cursorCh - parsed.endCh <= 2;
    if (!cursorInside && !cursorJustAfter) {
      continue;
    }

    candidates.push({
      ...parsed,
      distance: Math.abs(cursorCh - parsed.endCh),
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0] || null;
}

function findTaskPickerMarkerNearCursor(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const parsed = parseTrailingTaskPickerMarker(match);
    if (!parsed) {
      continue;
    }

    const cursorAtMarker =
      cursorCh >= parsed.markerStartCh && cursorCh <= parsed.markerEndCh + 2;
    if (!cursorAtMarker) {
      continue;
    }

    candidates.push({
      ...parsed,
      distance: Math.abs(cursorCh - parsed.markerEndCh),
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0] || null;
}

function cursorDistanceToRange(cursorCh, startCh, endCh) {
  if (cursorCh < startCh) {
    return startCh - cursorCh;
  }

  if (cursorCh > endCh) {
    return cursorCh - endCh;
  }

  return 0;
}

function findBlockReferenceOnLine(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const raw = match[0];
    const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
    const parsedDestination = parseBlockReferenceDestination(destination, {
      allowPathBareBlock: true,
    });
    if (!parsedDestination) {
      continue;
    }

    const linkStartCh =
      match.index > 0 && lineText[match.index - 1] === "!"
        ? match.index - 1
        : match.index;
    const endCh = match.index + raw.length;
    const cursorInside = cursorCh >= linkStartCh && cursorCh <= endCh;

    candidates.push({
      kind: "link-block",
      raw,
      ...parsedDestination,
      aliasSuffix,
      startCh: match.index,
      endCh,
      prefillId: true,
      cursorInside,
      distance: cursorDistanceToRange(cursorCh, linkStartCh, endCh),
    });
  }

  candidates.sort((left, right) => {
    if (left.cursorInside !== right.cursorInside) {
      return left.cursorInside ? -1 : 1;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return left.startCh - right.startCh;
  });

  return candidates[0] || null;
}

function getFenceOpening(line) {
  const match = String(line || "").match(OPENING_FENCE_RE);
  if (!match) {
    return null;
  }

  return {
    markerChar: match[2][0],
    markerLength: match[2].length,
  };
}

function isClosingFence(line, openingFence) {
  const match = String(line || "").match(CLOSING_FENCE_RE);
  if (!match) {
    return false;
  }

  return (
    match[2][0] === openingFence.markerChar &&
    match[2].length >= openingFence.markerLength
  );
}

function lineIsInsideCodeFence(editor, lineNumber) {
  let activeFence = null;

  for (let line = 0; line <= lineNumber; line += 1) {
    const lineText = editor.getLine(line) || "";

    if (!activeFence) {
      const openingFence = getFenceOpening(lineText);
      if (openingFence) {
        activeFence = openingFence;
      }
      continue;
    }

    if (isClosingFence(lineText, activeFence)) {
      if (line === lineNumber) {
        return true;
      }

      activeFence = null;
    }
  }

  return Boolean(activeFence);
}

function startsWithFrontmatter(lines) {
  return lines.length > 0 && /^\s*---\s*$/.test(lines[0]);
}

function normalizeMarkdownLine(lineText) {
  return String(lineText || "").replace(/\r$/, "");
}

function getObsidianTaskLineMatch(lineText) {
  return OBSIDIAN_TASK_LINE_RE.exec(normalizeMarkdownLine(lineText));
}

function isOpenObsidianTaskLine(lineText) {
  const match = getObsidianTaskLineMatch(lineText);
  if (!match) {
    return false;
  }

  const status = match[1];
  const body = match[2] || "";
  return (
    OPEN_OBSIDIAN_TASK_STATUSES.has(status) && PROJECT_TASK_TAG_RE.test(body)
  );
}

function getTrailingBlockId(lineText) {
  const match = normalizeMarkdownLine(lineText).match(TRAILING_BLOCK_ID_RE);
  return match ? match[1] : null;
}

function stripTaskTag(text) {
  return String(text || "").replace(
    PROJECT_TASK_TAG_GLOBAL_RE,
    (match, prefix) => {
      if (!prefix) {
        return "";
      }

      return /\s/.test(prefix) ? " " : prefix;
    },
  );
}

function cleanTaskDisplayText(lineText) {
  const match = getObsidianTaskLineMatch(lineText);
  let text = match ? match[2] || "" : normalizeMarkdownLine(lineText);

  text = text
    .replace(TRAILING_BLOCK_ID_RE, "")
    .replace(TASKS_INLINE_FIELD_RE, "")
    .replace(TASKS_EMOJI_DATE_RE, "");
  text = stripTaskTag(text)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text || "(untitled task)";
}

function taskItemFromLine(lineText, lineNumber) {
  const match = getObsidianTaskLineMatch(lineText);
  if (!match) {
    return null;
  }

  const status = match[1];
  const body = match[2] || "";
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status) || !PROJECT_TASK_TAG_RE.test(body)) {
    return null;
  }

  return {
    line: lineNumber,
    rawLine: lineText,
    status,
    existingId: getTrailingBlockId(lineText),
    displayText: cleanTaskDisplayText(lineText),
  };
}

function getOpenTasksInContent(content) {
  const sourceLines = String(content || "").split("\n");
  const tasks = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex] || "";

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

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

    const task = taskItemFromLine(line, lineIndex);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

function fuzzyIncludes(text, query) {
  const haystack = String(text || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if (!needle) {
    return true;
  }

  if (haystack.includes(needle)) {
    return true;
  }

  let offset = 0;
  for (const char of needle) {
    offset = haystack.indexOf(char, offset);
    if (offset === -1) {
      return false;
    }
    offset += 1;
  }

  return true;
}

function blockTokenMatches(content, id) {
  const matches = [];
  const re = new RegExp(
    `(^|[ \\t])\\^${escapeRegExp(id)}(?=$|[ \\t\\r\\n])`,
    "gm",
  );
  let match;

  while ((match = re.exec(content)) !== null) {
    const start = match.index + match[1].length;
    matches.push({
      start,
      end: start + 1 + id.length,
    });
  }

  return matches;
}

function collectBlockTokenMatches(content) {
  const matches = [];
  const re = /(^|[ \t])\^([A-Za-z0-9-]+)(?=$|[ \t\r\n])/gm;
  let match;

  while ((match = re.exec(content)) !== null) {
    const start = match.index + match[1].length;
    matches.push({
      id: match[2],
      start,
      end: start + 1 + match[2].length,
    });
  }

  return matches;
}

function standaloneBlockIdFromLine(lineText) {
  const match = String(lineText || "").match(/^\s*\^([A-Za-z0-9-]+)\s*$/);
  return match ? match[1] : null;
}

function markdownLineKind(lineText) {
  const line = String(lineText || "");
  const trimmed = line.trim();

  if (!trimmed) {
    return "blank";
  }

  if (standaloneBlockIdFromLine(line)) {
    return "standalone-id";
  }

  if (getFenceOpening(line)) {
    return "fence";
  }

  if (/^\s{0,3}#{1,6}\s+/.test(line)) {
    return "heading";
  }

  if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
    return "list";
  }

  if (/^\s*>/.test(line)) {
    return "quote";
  }

  if (/^\s*\|.*\|\s*$/.test(line)) {
    return "table";
  }

  return "paragraph";
}

function findContentBlockRange(lines, lineNumber) {
  const kind = markdownLineKind(lines[lineNumber]);
  if (kind === "blank" || kind === "fence" || kind === "standalone-id") {
    return null;
  }

  if (kind === "heading" || kind === "list") {
    return {
      startLine: lineNumber,
      contentEndLine: lineNumber,
      endLine: lineNumber,
    };
  }

  let startLine = lineNumber;
  while (startLine > 0 && markdownLineKind(lines[startLine - 1]) === kind) {
    startLine -= 1;
  }

  let endLine = lineNumber;
  while (
    endLine < lines.length - 1 &&
    markdownLineKind(lines[endLine + 1]) === kind
  ) {
    endLine += 1;
  }

  return {
    startLine,
    contentEndLine: endLine,
    endLine,
  };
}

function includeFollowingStandaloneBlockIds(lines, range) {
  let endLine = range.endLine;
  while (
    endLine < lines.length - 1 &&
    markdownLineKind(lines[endLine + 1]) === "standalone-id"
  ) {
    endLine += 1;
  }

  return {
    ...range,
    endLine,
  };
}

function findLocalMarkdownBlockRange(lines, lineNumber) {
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const kind = markdownLineKind(lines[lineNumber]);
  if (kind === "blank" || kind === "fence") {
    return null;
  }

  if (kind === "standalone-id") {
    let baseLine = lineNumber - 1;
    while (baseLine >= 0 && markdownLineKind(lines[baseLine]) === "standalone-id") {
      baseLine -= 1;
    }

    const baseRange = findContentBlockRange(lines, baseLine);
    if (!baseRange) {
      return null;
    }

    return {
      ...baseRange,
      endLine: lineNumber,
    };
  }

  const range = findContentBlockRange(lines, lineNumber);
  return range ? includeFollowingStandaloneBlockIds(lines, range) : null;
}

function isEditorPosition(position) {
  return (
    position &&
    Number.isInteger(position.line) &&
    Number.isInteger(position.ch) &&
    position.line >= 0 &&
    position.ch >= 0
  );
}

function compareEditorPositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.ch - right.ch;
}

function getSingleEditorSelection(editor) {
  if (!editor || typeof editor.getCursor !== "function") {
    return null;
  }

  if (typeof editor.listSelections === "function") {
    const selections = editor.listSelections();
    if (!Array.isArray(selections) || selections.length !== 1) {
      return null;
    }

    const selection = selections[0] || {};
    const anchor = selection.anchor || selection.from;
    const head = selection.head || selection.to;
    if (!isEditorPosition(anchor) || !isEditorPosition(head)) {
      return null;
    }

    const from = compareEditorPositions(anchor, head) <= 0 ? anchor : head;
    const to = from === anchor ? head : anchor;
    return {
      anchor,
      head,
      from,
      to,
      empty: compareEditorPositions(anchor, head) === 0,
    };
  }

  const cursor = editor.getCursor();
  if (!isEditorPosition(cursor)) {
    return null;
  }

  return {
    anchor: cursor,
    head: cursor,
    from: cursor,
    to: cursor,
    empty: true,
  };
}

function selectedLineSpan(selection) {
  let endLine = selection.to.line;
  if (!selection.empty && selection.to.ch === 0 && endLine > selection.from.line) {
    endLine -= 1;
  }

  return {
    startLine: selection.from.line,
    endLine,
  };
}

function lineStartIndexFromLines(lines, lineNumber) {
  let index = 0;
  for (let line = 0; line < lineNumber; line += 1) {
    index += lines[line].length + 1;
  }

  return index;
}

function lineEndIndexFromLines(lines, lineNumber) {
  return lineStartIndexFromLines(lines, lineNumber) + lines[lineNumber].length;
}

function contentLineAt(content, lineNumber) {
  const lines = String(content || "").split("\n");
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  return lines[lineNumber];
}

function taskLineAppendEdit(content, lineNumber, id) {
  const lines = String(content || "").split("\n");
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const lineText = lines[lineNumber];
  const lineStart = lineStartIndexFromLines(lines, lineNumber);
  const lineEnd = lineEndIndexFromLines(lines, lineNumber);
  const contentLineEnd = lineText.endsWith("\r") ? lineEnd - 1 : lineEnd;
  const lineWithoutCarriageReturn = lineText.endsWith("\r")
    ? lineText.slice(0, -1)
    : lineText;
  const trimmedLength = lineWithoutCarriageReturn.replace(/[ \t]+$/g, "").length;

  return {
    start: lineStart + trimmedLength,
    end: contentLineEnd,
    replacement: ` ^${id}`,
  };
}

function lineRangeText(lines, startLine, endLine) {
  return lines.slice(startLine, endLine + 1).join("\n");
}

function blockRangePreviewText(content, lines, range, blockMatch) {
  const rangeStart = lineStartIndexFromLines(lines, range.startLine);
  const rangeEnd = lineEndIndexFromLines(lines, range.endLine);
  let text = content.slice(rangeStart, rangeEnd);

  if (blockMatch) {
    const tokenStart = blockMatch.start - rangeStart;
    const tokenEnd = blockMatch.end - rangeStart;
    text = text.slice(0, tokenStart) + text.slice(tokenEnd);
  }

  return cleanPreviewText(text);
}

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

function sourceReplacement(source, id) {
  return `[[${source.targetText}${source.blockPrefix}${id}${source.aliasSuffix}]]`;
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

function pluralize(value, singular, plural) {
  return value === 1 ? singular : plural;
}

function setEditorCursorIfPossible(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  editor.setCursor(position);
  return true;
}

function dispatchFileLinkBlockCompletion(editor, line, marker) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function"
  ) {
    return false;
  }

  try {
    const lineStart = cm.state.doc.line(line + 1).from;
    cm.dispatch({
      changes: {
        from: lineStart + marker.startCh,
        to: lineStart + marker.endCh,
        insert: marker.completionReplacement,
      },
      selection: { anchor: lineStart + marker.finalCursorCh },
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  } catch (error) {
    console.error("Block ID Prompt failed to dispatch block completion", error);
    return false;
  }
}

function applyFileLinkBlockCompletionWithEditorApi(editor, line, marker) {
  if (!editor || typeof editor.replaceRange !== "function") {
    return false;
  }

  editor.replaceRange(
    marker.plainReplacement,
    { line, ch: marker.startCh },
    { line, ch: marker.endCh },
  );

  const insertionPos = { line, ch: marker.insertionCh };
  setEditorCursorIfPossible(editor, insertionPos);
  editor.replaceRange("^", insertionPos);
  setEditorCursorIfPossible(editor, { line, ch: marker.finalCursorCh });
  return true;
}

const TASK_LINK_PICKER_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Link" },
  { keys: ["esc"], label: "Dismiss" },
];

function isCtrlKey(event, key) {
  return (
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === key
  );
}

function applyIcon(el, iconName) {
  if (!el || typeof setIcon !== "function") {
    return;
  }

  try {
    setIcon(el, iconName);
  } catch (error) {
    // Icons are decorative here; rendering should continue without them.
  }
}

function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!query) {
    el.appendText(source);
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let matchIndex = lowerSource.indexOf(lowerQuery);

  if (matchIndex === -1) {
    el.appendText(source);
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > index) {
      el.appendText(source.slice(index, matchIndex));
    }
    el.createSpan({
      cls: "bid-tlp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function taskStatusLabel(status) {
  return `[${status || " "}]`;
}

function taskStatusClass(status) {
  if (status === "/") {
    return "active";
  }

  if (status === "B") {
    return "blocked";
  }

  return "todo";
}

class TaskLinkPickerModal extends Modal {
  constructor(app, plugin, source, tasks, targetFile) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.tasks = tasks;
    this.targetFile = targetFile;
    this.visibleTasks = tasks;
    this.selectedIndex = 0;
    this.completed = false;
    this.opening = false;
    this.inputEl = null;
    this.subtitleEl = null;
    this.resultsEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-tlp-modal");
    contentEl.addClass("bid-tlp");

    const header = contentEl.createDiv({ cls: "bid-tlp-header" });
    const headerIcon = header.createDiv({ cls: "bid-tlp-header-icon" });
    applyIcon(headerIcon, "list-checks");
    const headerText = header.createDiv({ cls: "bid-tlp-header-text" });
    headerText.createDiv({ cls: "bid-tlp-title", text: "Link to task" });
    this.subtitleEl = headerText.createDiv({ cls: "bid-tlp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bid-tlp-search" });
    const searchIcon = searchEl.createDiv({ cls: "bid-tlp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bid-tlp-input",
      attr: {
        "aria-label": "Filter tasks",
        placeholder: "Filter tasks",
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    this.inputEl.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );

    this.resultsEl = contentEl.createDiv({
      cls: "bid-tlp-results",
      attr: {
        role: "listbox",
        "aria-label": "Open tasks",
      },
    });

    this.renderFooter(contentEl);
    this.renderResults();

    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  renderFooter(contentEl) {
    const footerEl = contentEl.createDiv({ cls: "bid-tlp-footer" });
    TASK_LINK_PICKER_HINTS.forEach((hint) => {
      const group = footerEl.createDiv({ cls: "bid-tlp-hint" });
      hint.keys.forEach((key) =>
        group.createEl("kbd", { cls: "bid-tlp-kbd", text: key }),
      );
      group.createEl("span", { cls: "bid-tlp-hint-label", text: hint.label });
    });
  }

  onClose() {
    this.modalEl.removeClass("bid-tlp-modal");
    this.contentEl.empty();

    if (!this.completed) {
      this.plugin.cancelTaskLinkPicker(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }

  handleKeydown(event) {
    if (event.key === "ArrowDown" || isCtrlKey(event, "n")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || isCtrlKey(event, "p")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.openSelectedTask();
    }
  }

  moveSelection(delta) {
    if (this.visibleTasks.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.visibleTasks.length) %
      this.visibleTasks.length;
    this.renderResults();
  }

  getQuery() {
    return this.inputEl ? this.inputEl.value.trim().toLowerCase() : "";
  }

  getFilteredTasks() {
    const query = this.getQuery();
    if (!query) {
      return this.tasks;
    }

    return this.tasks.filter((task) =>
      fuzzyIncludes(task.displayText, query),
    );
  }

  renderResults() {
    if (!this.resultsEl) {
      return;
    }

    this.visibleTasks = this.getFilteredTasks();
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleTasks.length,
    );
    this.updateSubtitle();
    this.resultsEl.empty();

    if (this.visibleTasks.length === 0) {
      this.renderEmptyState();
      return;
    }

    const query = this.getQuery();
    this.visibleTasks.forEach((task, index) => {
      const isSelected = index === this.selectedIndex;
      const rowEl = this.resultsEl.createDiv({
        cls: `bid-tlp-row${isSelected ? " is-selected" : ""}`,
        attr: {
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      this.renderTaskRow(rowEl, task, query);

      rowEl.addEventListener("mousedown", (event) => event.preventDefault());
      rowEl.addEventListener("click", () => this.openTaskAtIndex(index));

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
    });
  }

  renderTaskRow(rowEl, task, query) {
    rowEl.createDiv({
      cls: `bid-tlp-status-pill is-${taskStatusClass(task.status)}`,
      text: taskStatusLabel(task.status),
    });

    const textEl = rowEl.createDiv({ cls: "bid-tlp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bid-tlp-row-title" });
    appendHighlighted(titleEl, task.displayText, query);

    const metaEl = textEl.createDiv({ cls: "bid-tlp-row-meta" });
    metaEl.createSpan({ text: `Line ${task.line + 1}` });

    const badgeEl = rowEl.createDiv({
      cls: `bid-tlp-badge ${task.existingId ? "is-existing" : "is-create"}`,
    });
    if (task.existingId) {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "↵ link" });
      badgeEl.createSpan({ cls: "bid-tlp-badge-id", text: `^${task.existingId}` });
    } else {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "+ id" });
    }
  }

  renderEmptyState() {
    const basename = this.targetFile && this.targetFile.basename;
    const hasTasks = this.tasks.length > 0;
    const emptyEl = this.resultsEl.createDiv({ cls: "bid-tlp-empty" });
    const iconEl = emptyEl.createDiv({ cls: "bid-tlp-empty-icon" });
    applyIcon(iconEl, hasTasks ? "search-x" : "list-x");
    emptyEl.createDiv({
      cls: "bid-tlp-empty-text",
      text: hasTasks
        ? "No matching tasks"
        : `No open tasks in ${basename || "target note"}`,
    });
  }

  updateSubtitle() {
    if (!this.subtitleEl) {
      return;
    }

    const total = this.tasks.length;
    const shown = this.visibleTasks.length;
    const basename = this.targetFile && this.targetFile.basename;
    if (shown !== total) {
      this.subtitleEl.textContent = `Showing ${shown} of ${total}`;
      return;
    }

    this.subtitleEl.textContent = `${total} open ${pluralize(
      total,
      "task",
      "tasks",
    )}${basename ? ` in ${basename}` : ""}`;
  }

  clampSelectedIndex(index, length) {
    if (length === 0) {
      return 0;
    }

    return Math.min(Math.max(index, 0), length - 1);
  }

  scrollRowIntoView(rowEl) {
    if (!rowEl || typeof rowEl.scrollIntoView !== "function") {
      return;
    }

    try {
      rowEl.scrollIntoView({ block: "nearest" });
    } catch (error) {
      try {
        rowEl.scrollIntoView(false);
      } catch (ignoredError) {
        // Scrolling is optional; never let it break selection.
      }
    }
  }

  openSelectedTask() {
    this.openTaskAtIndex(this.selectedIndex);
  }

  async openTaskAtIndex(index) {
    if (this.opening) {
      return;
    }

    const task = this.visibleTasks[index];
    if (!task) {
      return;
    }

    this.opening = true;
    let promptSource = null;
    try {
      const result = await this.plugin.selectTaskLinkTask(this.source, task);
      if (!result) {
        return;
      }

      promptSource = result.promptSource || null;
      this.completed = true;
      this.close();
    } finally {
      this.opening = false;
    }

    if (promptSource) {
      window.setTimeout(() => this.plugin.openBlockIdPrompt(promptSource), 0);
    }
  }
}

class BlockIdPromptModal extends Modal {
  constructor(app, plugin, source) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.completed = false;
    this.submitting = false;
    this.input = null;
    this.previewEl = null;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Block ID" });
    this.createPreviewEl();
    this.loadPreview();

    new Setting(this.contentEl).setName("ID").addText((text) => {
      this.input = text;
      text.setPlaceholder("my-id");
      if (this.source.prefillId && this.source.oldId) {
        text.setValue(this.source.oldId);
      }
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        this.submit();
      });
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Save")
          .setCta()
          .onClick(() => this.submit()),
      );

    window.setTimeout(() => {
      if (this.input && this.input.inputEl) {
        this.input.inputEl.focus();
        if (this.source.prefillId && this.input.getValue()) {
          this.input.inputEl.select();
        }
      }
    }, 0);
  }

  createPreviewEl() {
    this.previewEl = this.contentEl.createEl("div", {
      text: "Loading block contents...",
    });
    this.previewEl.setAttribute("aria-label", "Current block contents");
    this.previewEl.setAttribute("role", "note");
    Object.assign(this.previewEl.style, {
      backgroundColor: "var(--background-secondary)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "4px",
      color: "var(--text-muted)",
      lineHeight: "var(--line-height-normal)",
      margin: "0 0 12px 0",
      maxHeight: "12rem",
      overflowWrap: "anywhere",
      overflowY: "auto",
      padding: "10px 12px",
      userSelect: "text",
      whiteSpace: "pre-wrap",
    });
  }

  setPreviewText(text, muted) {
    if (!this.previewEl) {
      return;
    }

    this.previewEl.textContent = text;
    this.previewEl.style.color = muted
      ? "var(--text-muted)"
      : "var(--text-normal)";
  }

  async loadPreview() {
    const previewEl = this.previewEl;
    const previewText = await this.plugin.readBlockPreviewText(this.source);

    if (!previewEl || previewEl !== this.previewEl || !previewEl.isConnected) {
      return;
    }

    if (previewText) {
      this.setPreviewText(previewText, false);
    } else {
      this.setPreviewText("Block contents unavailable", true);
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    const id = this.input ? this.input.getValue().trim() : "";
    if (!id) {
      new Notice("Block ID cannot be blank");
      return;
    }

    if (!BLOCK_ID_RE.test(id)) {
      new Notice("Block ID can only contain letters, numbers, and hyphens");
      return;
    }

    this.submitting = true;
    try {
      const accepted = await this.plugin.submitBlockId(this.source, id);
      if (accepted) {
        this.completed = true;
        this.close();
      }
    } finally {
      this.submitting = false;
    }
  }

  onClose() {
    this.contentEl.empty();

    if (!this.completed && !this.submitting) {
      this.plugin.cancelBlockIdPrompt(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }
}

module.exports = class BlockIdPromptPlugin extends Plugin {
  onload() {
    this.promptOpen = false;
    this.scanTimer = null;
    this.scanView = null;
    this.suppressUntil = 0;
    this.lastPromptKey = null;

    this.addCommand({
      id: "rename-selected-block-id",
      name: "Rename selected block ID",
      hotkeys: [{ modifiers: ["Ctrl"], key: "6" }],
      editorCallback: (editor, view) =>
        this.openSelectedBlockIdPrompt(editor, view),
    });

    this.registerEditorExtension(
      EditorView.updateListener.of((update) => this.scheduleScan(update)),
    );

    this.register(() => {
      if (this.scanTimer !== null) {
        window.clearTimeout(this.scanTimer);
      }
    });
  }

  scheduleScan(update) {
    if (!update.docChanged) {
      return;
    }

    if (this.promptOpen) {
      return;
    }

    this.scanView = update.view;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
    }

    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      this.inspectActiveEditor(this.scanView);
      this.scanView = null;
    }, SCAN_DEBOUNCE_MS);
  }

  inspectActiveEditor(cmView) {
    if (this.promptOpen) {
      return;
    }

    const scansSuppressed = Date.now() < this.suppressUntil;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(view instanceof MarkdownView) || !view.editor) {
      return;
    }

    if (view.editor.cm && cmView && view.editor.cm !== cmView) {
      return;
    }

    if (!this.hasSingleCursor(view.editor)) {
      return;
    }

    const file = view.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    const cursor = view.editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) {
      return;
    }

    const lineText = view.editor.getLine(cursor.line) || "";
    const taskMarker = findTaskPickerMarkerNearCursor(lineText, cursor.ch || 0);
    if (taskMarker) {
      if (lineIsInsideCodeFence(view.editor, cursor.line)) {
        return;
      }

      void this.openTaskLinkPicker({
        ...taskMarker,
        editor: view.editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    if (scansSuppressed) {
      return;
    }

    const marker = findMarkerLinkNearCursor(lineText, cursor.ch || 0);
    if (!marker) {
      this.lastPromptKey = null;
      return;
    }

    if (lineIsInsideCodeFence(view.editor, cursor.line)) {
      return;
    }

    if (marker.kind === "file-link-jump") {
      this.applyFileLinkJumpMarker(marker, view.editor, cursor.line);
      return;
    }

    const source = {
      ...marker,
      editor: view.editor,
      sourcePath: file.path,
      line: cursor.line,
    };
    this.openBlockIdPrompt(source);
  }

  openSelectedBlockIdPrompt(editor, view) {
    if (this.promptOpen) {
      return;
    }

    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("No active Markdown block selected");
      return;
    }

    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No active Markdown block selected");
      return;
    }

    if (!this.hasSingleCursor(editor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return;
    }

    const lineText = editor.getLine(cursor.line) || "";
    const blockReference = findBlockReferenceOnLine(
      lineText,
      cursor.ch || 0,
    );
    if (blockReference) {
      this.openBlockIdPrompt({
        ...blockReference,
        editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    const result = discoverSelectedBlockIdSource(editor, file);
    if (!result || !result.source) {
      new Notice(
        (result && result.notice) || "No active Markdown block selected",
      );
      return;
    }

    this.openBlockIdPrompt(result.source);
  }

  openBlockIdPrompt(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;
    new BlockIdPromptModal(this.app, this, source).open();
  }

  async openTaskLinkPicker(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination) {
        new Notice("Task link blocked: target note could not be resolved");
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (destination.content === null) {
        new Notice(`Task link blocked: ${destination.file.path} could not be read`);
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (!this.sourceMarkerStillPresent(source, { quiet: true })) {
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      const tasks = getOpenTasksInContent(destination.content);
      new TaskLinkPickerModal(
        this.app,
        this,
        {
          ...source,
          destinationPath: destination.file.path,
        },
        tasks,
        destination.file,
      ).open();
    } catch (error) {
      console.error("Block ID Prompt failed to open task link picker", error);
      new Notice("Task link blocked: target note could not be read");
      this.lastPromptKey = null;
      this.promptOpen = false;
    }
  }

  cancelTaskLinkPicker(source) {
    this.revertTaskPickerMarker(source, { quiet: true });
  }

  async selectTaskLinkTask(source, task) {
    if (task.existingId) {
      return this.completeTaskLinkWithExistingId(source, task);
    }

    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    return {
      promptSource: {
        ...source,
        kind: "link-task-complete",
        task: { ...task },
        previewText: task.displayText,
        prefillId: false,
      },
    };
  }

  async completeTaskLinkWithExistingId(source, task) {
    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return null;
    }

    if (!this.taskLineStillPresent(destination.content, task, destination.file.path)) {
      return null;
    }

    const currentId = getTrailingBlockId(task.rawLine);
    if (currentId !== task.existingId) {
      new Notice("Task link blocked: selected task block ID changed");
      return null;
    }

    if (!this.completeTaskSourceLink(source, task.existingId)) {
      return null;
    }

    new Notice("Linked task block");
    return { completed: true };
  }

  hasSingleCursor(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    if (typeof editor.listSelections !== "function") {
      return true;
    }

    const selections = editor.listSelections();
    return Array.isArray(selections) && selections.length === 1;
  }

  cancelBlockIdPrompt(source) {
    if (source.kind === "link-task-complete") {
      this.revertTaskPickerMarker(source, { quiet: true });
      return;
    }

    if (
      source.kind === "direct-add" ||
      source.kind === "direct-rename" ||
      source.kind === "link-block"
    ) {
      return;
    }

    this.replaceSourceLink(source, source.oldId, { quiet: true });
  }

  applyFileLinkJumpMarker(marker, editor, line) {
    if (!editor || typeof editor.getLine !== "function") {
      return false;
    }

    const lineText = editor.getLine(line) || "";
    if (lineText.slice(marker.startCh, marker.endCh) !== marker.raw) {
      return false;
    }

    this.suppressEditorScans();
    if (!dispatchFileLinkBlockCompletion(editor, line, marker)) {
      applyFileLinkBlockCompletionWithEditorApi(editor, line, marker);
    }
    this.lastPromptKey = null;
    return true;
  }

  async submitBlockId(source, newId) {
    if (source.kind === "direct-add") {
      return this.submitDirectBlockAdd(source, newId);
    }

    if (source.kind === "direct-rename") {
      return this.submitDirectBlockRename(source, newId);
    }

    if (source.kind === "link-task-complete") {
      return this.submitLinkTaskBlockId(source, newId);
    }

    return this.submitLinkedBlockId(source, newId);
  }

  async submitLinkedBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(source, destination, newId);
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  async submitDirectBlockRename(source, newId) {
    if (!this.directRenameSourceStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(
      source,
      destination,
      newId,
      { requireSourceMarker: false },
    );
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  submitDirectBlockAdd(source, newId) {
    if (!this.directAddSourceStillPresent(source)) {
      return false;
    }

    const content = source.editor.getValue();
    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${source.sourcePath}`);
      return false;
    }

    this.suppressEditorScans();
    if (source.addMode === "append") {
      source.editor.replaceRange(
        ` ^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    } else {
      source.editor.replaceRange(
        `\n^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    }

    new Notice("Added block ID");
    return true;
  }

  async submitLinkTaskBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return false;
    }

    const duplicateMatches = blockTokenMatches(destination.content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
      return false;
    }

    if (!this.taskLineStillPresent(destination.content, source.task, destination.file.path)) {
      return false;
    }

    if (
      !(await this.appendTaskBlockId(
        destination.file,
        source,
        source.task,
        newId,
        destination.content,
      ))
    ) {
      return false;
    }

    if (!this.completeTaskSourceLink(source, newId)) {
      new Notice("Task block ID added, but the source link changed before completion");
      return true;
    }

    new Notice("Added block ID and linked task");
    return true;
  }

  sourceMarkerStillPresent(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    return true;
  }

  taskLineStillPresent(content, task, filePath) {
    const currentLine = contentLineAt(content, task && task.line);
    if (currentLine === null || currentLine !== task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${filePath}`);
      return false;
    }

    return true;
  }

  async appendTaskBlockId(file, source, task, newId, expectedContent) {
    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      new Notice(`Task link stopped: ${file.path} could not be read`);
      return false;
    }

    if (content !== expectedContent) {
      new Notice(`Task link stopped: ${file.path} changed before update`);
      return false;
    }

    const edit = taskLineAppendEdit(content, task.line, newId);
    if (!edit) {
      new Notice(`Task link stopped: selected task changed in ${file.path}`);
      return false;
    }

    if (file.path === source.sourcePath) {
      if (!source.editor || typeof source.editor.replaceRange !== "function") {
        new Notice("Task link stopped: active note could not be modified");
        return false;
      }

      this.suppressEditorScans();
      source.editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(content, edit.start),
        indexToEditorPosition(content, edit.end),
      );
      return true;
    }

    const nextContent =
      content.slice(0, edit.start) + edit.replacement + content.slice(edit.end);
    try {
      await this.app.vault.modify(file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify task note", error);
      new Notice(`Task link stopped: ${file.path} could not be modified`);
      return false;
    }
  }

  directRenameSourceStillPresent(source) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      new Notice("Block ID rename blocked: selected block changed before rename");
      return false;
    }

    return true;
  }

  directAddSourceStillPresent(source) {
    if (!source.editor || typeof source.editor.getValue !== "function") {
      new Notice("Block ID add blocked: active note could not be read");
      return false;
    }

    const lines = source.editor.getValue().split("\n");
    if (
      source.rangeStartLine < 0 ||
      source.rangeEndLine >= lines.length ||
      source.line >= lines.length
    ) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    const currentBlockText = lineRangeText(
      lines,
      source.rangeStartLine,
      source.rangeEndLine,
    );
    if (currentBlockText !== source.expectedBlockText) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    return true;
  }

  async buildReferenceRewritePlan(source, destination, newId, options = {}) {
    const requireSourceMarker = options.requireSourceMarker !== false;
    const candidateFiles = await this.collectCandidateReferenceFiles(
      destination.file,
      source,
    );
    const filePlans = [];
    let editCount = 0;
    let unsupportedCount = 0;
    let sourceMarkerPlanned = false;
    let destinationContentAfterReferences = null;

    for (const file of candidateFiles) {
      const snapshot = await this.readFileSnapshot(file, source);
      if (snapshot === null) {
        new Notice(`Block ID rename blocked: ${file.path} could not be read`);
        return null;
      }

      const sourceMarkerStart =
        requireSourceMarker && file.path === source.sourcePath
          ? editorPositionToIndex(snapshot, {
              line: source.line,
              ch: source.startCh,
            })
          : null;
      const sourceMarkerEnd =
        sourceMarkerStart === null ? null : sourceMarkerStart + source.raw.length;
      const edits = [];

      for (const reference of collectWikiBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (!targetFile || targetFile.path !== destination.file.path) {
          continue;
        }

        if (snapshot.slice(reference.start, reference.end) !== reference.raw) {
          unsupportedCount += 1;
          continue;
        }

        const replacement = sourceReplacement(reference, newId);
        if (replacement !== reference.raw) {
          edits.push({
            start: reference.start,
            end: reference.end,
            replacement,
          });
          editCount += 1;
        }

        if (
          file.path === source.sourcePath &&
          reference.start === sourceMarkerStart &&
          reference.end === sourceMarkerEnd
        ) {
          sourceMarkerPlanned = true;
        }
      }

      for (const reference of collectMarkdownBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (targetFile && targetFile.path === destination.file.path) {
          unsupportedCount += 1;
        }
      }

      if (!validateNonOverlappingEdits(edits)) {
        new Notice("Block ID rename blocked: overlapping link edits were found");
        return null;
      }

      if (file.path === destination.file.path) {
        destinationContentAfterReferences = applyTextEdits(snapshot, edits);
      }

      if (edits.length > 0) {
        filePlans.push({
          file,
          content: snapshot,
          edits,
        });
      }
    }

    if (requireSourceMarker && !sourceMarkerPlanned) {
      new Notice("Block ID rename blocked: source marker link was not found");
      return null;
    }

    return {
      filePlans,
      editCount,
      unsupportedCount,
      destinationContentAfterReferences:
        destinationContentAfterReferences === null
          ? destination.content
          : destinationContentAfterReferences,
    };
  }

  replaceSourceLink(source, id, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      sourceReplacement(source, id),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );

    return true;
  }

  completeTaskSourceLink(source, id) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      new Notice("Block marker link changed before it could be rewritten");
      return false;
    }

    const replacement = sourceReplacement(source, id);
    this.suppressEditorScans();
    source.editor.replaceRange(
      replacement,
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );
    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: source.startCh + replacement.length,
    });

    return true;
  }

  revertTaskPickerMarker(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      taskPickerRevertReplacement(source),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );
    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: taskPickerRevertCursorCh(source),
    });

    return true;
  }

  async readDestinationForValidation(source) {
    const file = this.resolveDestinationFile(source);
    if (!file) {
      return null;
    }

    if (file.path === source.sourcePath && typeof source.editor.getValue === "function") {
      return {
        file,
        content: source.editor.getValue(),
      };
    }

    try {
      return {
        file,
        content: await this.app.vault.read(file),
      };
    } catch (error) {
      console.error("Block ID Prompt failed to read target note", error);
      return {
        file,
        content: null,
      };
    }
  }

  async readBlockPreviewText(source) {
    if (Object.prototype.hasOwnProperty.call(source, "previewText")) {
      return source.previewText || null;
    }

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination || destination.content === null) {
        return null;
      }

      return extractBlockPreviewText(destination.content, source.oldId);
    } catch (error) {
      return null;
    }
  }

  resolveDestinationFile(source) {
    return this.resolveReferenceDestination(source, source.sourcePath);
  }

  resolveReferenceDestination(reference, sourcePath) {
    const linkText = stripMarkdownExtension(normalizeLinkTarget(reference.targetText));
    const lookupText = stripLinkSubpath(linkText);

    if (!lookupText) {
      const currentFile = this.app.vault.getAbstractFileByPath(sourcePath);
      return currentFile instanceof TFile ? currentFile : null;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(
      lookupText,
      sourcePath,
    );

    return file instanceof TFile ? file : null;
  }

  async collectCandidateReferenceFiles(destinationFile, source) {
    // Candidates are discovered from Obsidian's in-memory metadata cache only
    // (backlinks + resolvedLinks). We intentionally do NOT scan every vault note
    // from disk: on a large vault that was thousands of sequential reads per
    // rename. Downstream (buildReferenceRewritePlan / applyReferenceRewritePlan)
    // re-reads, re-parses, and re-verifies every candidate, so narrowing the set
    // never weakens correctness — it only changes which files we look at.
    //
    // Accepted residual risk: a note that references the block but was edited
    // *externally* (e.g. by bob-cli) and not yet re-indexed by Obsidian could be
    // missed until Obsidian re-indexes it (which it does on file change). The two
    // common cases — the active note and the destination note — are always
    // covered below regardless of cache freshness.
    const candidatePaths = new Set();
    this.addCandidatePath(candidatePaths, destinationFile.path);
    // Always include the current/active note, independent of the metadata cache.
    // Never remove this: the user often renames a block id immediately after
    // Obsidian auto-creates it when linking to an unnamed block, and at that
    // instant the active note may not yet be re-indexed. readFileSnapshot reads
    // this note from the live editor buffer (source.editor.getValue()), so even
    // unsaved edits are handled correctly.
    this.addCandidatePath(candidatePaths, source.sourcePath);
    this.addBacklinkCandidatePaths(candidatePaths, destinationFile);
    this.addResolvedLinkCandidatePaths(candidatePaths, destinationFile);

    return Array.from(candidatePaths)
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file) => file instanceof TFile && file.extension === "md")
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  addCandidatePath(candidatePaths, path) {
    if (typeof path === "string" && path) {
      candidatePaths.add(path);
    }
  }

  addBacklinkCandidatePaths(candidatePaths, destinationFile) {
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return;
    }

    const backlinks = metadataCache.getBacklinksForFile(destinationFile);
    const data = backlinks && backlinks.data;
    if (!data) {
      return;
    }

    if (data instanceof Map) {
      for (const path of data.keys()) {
        this.addCandidatePath(candidatePaths, path);
      }
      return;
    }

    if (typeof data === "object") {
      for (const path of Object.keys(data)) {
        this.addCandidatePath(candidatePaths, path);
      }
    }
  }

  addResolvedLinkCandidatePaths(candidatePaths, destinationFile) {
    const resolvedLinks = this.app.metadataCache && this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks || typeof resolvedLinks !== "object") {
      return;
    }

    for (const [sourcePath, destinations] of Object.entries(resolvedLinks)) {
      if (
        destinations &&
        Object.prototype.hasOwnProperty.call(destinations, destinationFile.path)
      ) {
        this.addCandidatePath(candidatePaths, sourcePath);
      }
    }
  }

  async readFileSnapshot(file, source) {
    if (
      file.path === source.sourcePath &&
      source.editor &&
      typeof source.editor.getValue === "function"
    ) {
      return source.editor.getValue();
    }

    try {
      return await this.app.vault.read(file);
    } catch (error) {
      console.error("Block ID Prompt failed to read note", error);
      return null;
    }
  }

  async applyReferenceRewritePlan(plan, source) {
    if (!(await this.verifyPlannedFilesUnchanged(plan, source))) {
      return false;
    }

    for (const filePlan of plan.filePlans) {
      if (!(await this.applyReferenceEdits(filePlan, source))) {
        return false;
      }
    }

    return true;
  }

  async verifyPlannedFilesUnchanged(plan, source) {
    for (const filePlan of plan.filePlans) {
      const currentContent = await this.readFileSnapshot(filePlan.file, source);
      if (currentContent === null) {
        new Notice(`Block ID rename blocked: ${filePlan.file.path} could not be read`);
        return false;
      }

      if (currentContent !== filePlan.content) {
        new Notice(
          `Block ID rename blocked: ${filePlan.file.path} changed before rewrite`,
        );
        return false;
      }
    }

    return true;
  }

  async applyReferenceEdits(filePlan, source) {
    if (filePlan.file.path === source.sourcePath) {
      return this.applyActiveReferenceEdits(filePlan, source.editor);
    }

    const nextContent = applyTextEdits(filePlan.content, filePlan.edits);
    try {
      await this.app.vault.modify(filePlan.file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify backlink note", error);
      new Notice(`Block ID rename stopped: ${filePlan.file.path} could not be modified`);
      return false;
    }
  }

  applyActiveReferenceEdits(filePlan, editor) {
    if (!editor || typeof editor.replaceRange !== "function") {
      new Notice("Block ID rename stopped: active note could not be modified");
      return false;
    }

    this.suppressEditorScans();
    const sorted = [...filePlan.edits].sort((left, right) => right.start - left.start);
    for (const edit of sorted) {
      editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(filePlan.content, edit.start),
        indexToEditorPosition(filePlan.content, edit.end),
      );
    }

    return true;
  }

  async renameDestinationBlock(file, source, oldId, newId, expectedContent) {
    if (newId === oldId) {
      return true;
    }

    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      new Notice(`Block ID rename stopped: ${file.path} could not be read`);
      return false;
    }

    if (typeof expectedContent === "string" && content !== expectedContent) {
      new Notice(`Block ID rename stopped: ${file.path} changed before rename`);
      return false;
    }

    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${file.path}`);
      return false;
    }

    const matches = blockTokenMatches(content, oldId);
    if (matches.length !== 1) {
      new Notice(
        `Block ID rename stopped: old ID was not found exactly once in ${file.path}`,
      );
      return false;
    }

    const match = matches[0];
    if (file.path === source.sourcePath) {
      this.suppressEditorScans();
      source.editor.replaceRange(
        `^${newId}`,
        indexToEditorPosition(content, match.start),
        indexToEditorPosition(content, match.end),
      );
      return true;
    }

    const nextContent =
      content.slice(0, match.start) + `^${newId}` + content.slice(match.end);
    try {
      await this.app.vault.modify(file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify target note", error);
      new Notice(`Block ID rename stopped: ${file.path} could not be modified`);
      return false;
    }
  }

  suppressEditorScans() {
    this.suppressUntil = Date.now() + EDIT_SUPPRESS_MS;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
      this.scanView = null;
    }
  }
};
