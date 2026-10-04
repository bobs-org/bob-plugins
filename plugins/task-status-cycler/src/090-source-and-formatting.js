function getLineTextFromSourceText(sourceText, lineNumber) {
  const lineIndex = Math.floor(Number(lineNumber));
  if (!Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }

  const lines = splitTextByLineEndings(sourceText);
  return lines[lineIndex] ? lines[lineIndex].text : null;
}

function replaceLineInSourceText(sourceText, lineNumber, nextLineText) {
  const lineIndex = Math.floor(Number(lineNumber));
  if (!Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }

  const lines = splitTextByLineEndings(sourceText);
  if (!lines[lineIndex]) {
    return null;
  }

  lines[lineIndex] = {
    ...lines[lineIndex],
    text: String(nextLineText || ""),
  };
  return lines.map((line) => `${line.text}${line.ending}`).join("");
}

function findBlockLineInSourceText(sourceText, blockId) {
  const lines = splitTextByLineEndings(sourceText);
  for (let line = 0; line < lines.length; line += 1) {
    if (lineContainsStandaloneBlockId(lines[line].text, blockId)) {
      return line;
    }
  }

  return null;
}

function isTasksGeneratedId(value) {
  return TASKS_GENERATED_ID_RE.test(String(value || ""));
}

function getTrailingBlockId(lineText) {
  const match = String(lineText || "").match(TRAILING_BLOCK_ID_CAPTURE_RE);
  return match ? match[1] : null;
}

function normalizeDependencyMarkdownPath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function dependencyId(filePath, blockId) {
  const normalizedPath = normalizeDependencyMarkdownPath(filePath);
  const block = String(blockId || "").replace(/^\^/, "");
  if (!normalizedPath || !MARKDOWN_EXTENSION_RE.test(normalizedPath)) {
    return null;
  }
  if (!BLOCK_ID_RE.test(block)) {
    return null;
  }
  const value = `${normalizedPath.replace(MARKDOWN_EXTENSION_RE, "").replaceAll("/", "__")}__${block}`;
  if (!TASKS_DEPENDENCY_ID_RE.test(value)) {
    return null;
  }
  return value;
}

// Rewrite a target task line's Tasks-generated `[id:: <gen>]` to its trailing
// block ID. Returns { lineText, generatedId, blockId } when a rewrite applies,
// otherwise null. Only generated-shaped IDs paired with a block ID are touched,
// so user-authored IDs are preserved and the block ID stays the final token.
function rewriteGeneratedIdToBlockId(lineText, filePath = "Note.md", options = {}) {
  const line = String(lineText || "");
  const idMatch = line.match(INLINE_ID_FIELD_RE);
  if (!idMatch) {
    return null;
  }

  const leadingWs = idMatch[1];
  const idValue = idMatch[2];
  const trailingWs = idMatch[3];
  const skipIds = options.skipIds instanceof Set ? options.skipIds : new Set();
  if (skipIds.has(idValue)) {
    return null;
  }
  let blockId = getTrailingBlockId(line);
  if (!blockId && isTasksGeneratedId(idValue)) {
    blockId = idValue;
  }
  if (!blockId) {
    return null;
  }
  const canonicalId = dependencyId(filePath, blockId);
  if (!canonicalId) {
    return null;
  }
  let nextLineText =
    line.slice(0, idMatch.index) +
    `[id::${leadingWs}${canonicalId}${trailingWs}]` +
    line.slice(idMatch.index + idMatch[0].length);
  if (!getTrailingBlockId(nextLineText)) {
    const whitespace = /[ \t]*$/.exec(nextLineText)[0];
    nextLineText = `${nextLineText.slice(0, nextLineText.length - whitespace.length).trimEnd()} ^${blockId}${whitespace}`;
  }
  if (nextLineText === line) {
    return null;
  }

  return {
    lineText: nextLineText,
    generatedId: idValue,
    oldId: idValue,
    dependencyId: canonicalId,
    blockId,
  };
}

// Rewrite `[dependsOn:: ...]` values on a single line using a
// generatedId -> blockId map. Comma-separated lists and whitespace variations
// are preserved; unmapped (e.g. user-authored) IDs are left untouched.
function rewriteDependsOnIdsInLine(lineText, idMap) {
  const line = String(lineText || "");
  if (!idMap || typeof idMap !== "object" || !Object.keys(idMap).length) {
    return line;
  }

  return line.replace(
    INLINE_DEPENDS_ON_FIELD_RE,
    (full, leadingWs, value, trailingWs) => {
      if (value === "") {
        return full;
      }

      let changed = false;
      const nextValue = value
        .split(",")
        .map((segment) => {
          const segmentMatch = segment.match(DEPENDS_ON_ID_SEGMENT_RE);
          if (!segmentMatch) {
            return segment;
          }

          const token = segmentMatch[2];
          if (
            token &&
            Object.prototype.hasOwnProperty.call(idMap, token) &&
            idMap[token] &&
            idMap[token] !== token
          ) {
            changed = true;
            return `${segmentMatch[1]}${idMap[token]}${segmentMatch[3]}`;
          }

          return segment;
        })
        .join(",");

      if (!changed) {
        return full;
      }

      return `[dependsOn::${leadingWs}${nextValue}${trailingWs}]`;
    },
  );
}

function rewriteDependsOnBlockIdsInText(sourceText, idMap) {
  const lines = splitTextByLineEndings(sourceText);
  const fenced = getFencedLineNumbers(lines.map((line) => line.text));
  let changed = false;
  const nextLines = lines.map((line, lineNumber) => {
    if (fenced.has(lineNumber)) {
      return line;
    }
    const nextText = rewriteDependsOnIdsInLine(line.text, idMap);
    if (nextText !== line.text) {
      changed = true;
    }
    return { ...line, text: nextText };
  });

  if (!changed) {
    return { text: String(sourceText || ""), changed: false };
  }

  return {
    text: nextLines.map((line) => `${line.text}${line.ending}`).join(""),
    changed: true,
  };
}

// Normalize an entire document: collect generatedId -> blockId mappings from
// target task lines, rewrite those `[id:: ...]` fields, and rewrite matching
// `[dependsOn:: ...]` values in the same document. Returns the (possibly
// unchanged) text, a changed flag, and the discovered mapping for cross-file
// propagation. Re-running on already-normalized text is a no-op (block IDs are
// not generated-shaped, or equal the ID), which keeps write loops from forming.
function normalizeTaskDependencyBlockIds(
  sourceText,
  filePath = "Note.md",
  options = {},
) {
  const lines = splitTextByLineEndings(sourceText);
  const fenced = getFencedLineNumbers(lines.map((line) => line.text));
  const pathSupported = Boolean(dependencyId(filePath, "block"));
  const unsupportedPath =
    !pathSupported &&
    lines.some((line, lineNumber) => {
      if (fenced.has(lineNumber)) return false;
      const idMatch = line.text.match(INLINE_ID_FIELD_RE);
      return Boolean(
        idMatch &&
          (getTrailingBlockId(line.text) || isTasksGeneratedId(idMatch[2])),
      );
    });
  const idMap = {};

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    if (fenced.has(lineNumber)) continue;
    const line = lines[lineNumber];
    const rewrite = rewriteGeneratedIdToBlockId(line.text, filePath, options);
    if (rewrite) {
      idMap[rewrite.oldId] = rewrite.dependencyId;
    }
  }

  let changed = false;
  const nextLines = lines.map((line, lineNumber) => {
    if (fenced.has(lineNumber)) {
      return line;
    }
    let text = line.text;
    const idRewrite = rewriteGeneratedIdToBlockId(text, filePath, options);
    if (idRewrite) {
      text = idRewrite.lineText;
    }
    text = rewriteDependsOnIdsInLine(text, idMap);
    if (text !== line.text) {
      changed = true;
    }
    return { ...line, text };
  });

  if (!changed) {
    return {
      text: String(sourceText || ""),
      changed: false,
      idMap,
      unsupportedPath,
    };
  }

  return {
    text: nextLines.map((line) => `${line.text}${line.ending}`).join(""),
    changed: true,
    idMap,
    unsupportedPath,
  };
}

function rewriteRenamedDependencyIds(sourceText, oldPath, newPath) {
  const lines = splitTextByLineEndings(sourceText);
  const fenced = getFencedLineNumbers(lines.map((line) => line.text));
  const idMap = {};
  let unsupportedPath = false;
  let changed = false;
  const next = lines.map((line, lineNumber) => {
    if (fenced.has(lineNumber)) return line;
    const blockId = getTrailingBlockId(line.text);
    const idMatch = line.text.match(INLINE_ID_FIELD_RE);
    if (!blockId || !idMatch) return line;
    const oldId = dependencyId(oldPath, blockId);
    if (!oldId) {
      unsupportedPath = true;
      return line;
    }
    if (idMatch[2] !== oldId) return line;
    const newId = dependencyId(newPath, blockId);
    if (!newId) {
      unsupportedPath = true;
      return line;
    }
    idMap[oldId] = newId;
    changed = true;
    return {
      ...line,
      text:
        line.text.slice(0, idMatch.index) +
        `[id::${idMatch[1]}${newId}${idMatch[3]}]` +
        line.text.slice(idMatch.index + idMatch[0].length),
    };
  });
  const withDependents = next.map((line, lineNumber) => {
    if (fenced.has(lineNumber)) return line;
    const text = rewriteDependsOnIdsInLine(line.text, idMap);
    if (text !== line.text) changed = true;
    return text === line.text ? line : { ...line, text };
  });
  return {
    text: changed
      ? withDependents.map((line) => `${line.text}${line.ending}`).join("")
      : String(sourceText || ""),
    changed,
    idMap,
    unsupportedPath,
  };
}

function numericLine(value) {
  const line = Math.floor(Number(value));
  return Number.isFinite(line) && line >= 0 ? line : null;
}

function getBlockCacheEntryLine(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const position = entry.position || entry.pos || null;
  const startPosition = position && (position.start || position);
  const directLine = numericLine(entry.line);
  const startLine = numericLine(entry.startLine);
  const positionLine = startPosition ? numericLine(startPosition.line) : null;

  if (positionLine !== null) {
    return positionLine;
  }
  if (startLine !== null) {
    return startLine;
  }
  return directLine;
}

function blockCacheEntryMatchesBlockId(entry, key, blockId) {
  if (String(key || "") === blockId) {
    return true;
  }

  if (!entry || typeof entry !== "object") {
    return false;
  }

  return [entry.id, entry.blockId, entry.block].some(
    (value) => String(value || "") === blockId,
  );
}

function addBlockCacheEntries(entries, value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      addBlockCacheEntries(entries, item, key);
    }
    return;
  }

  entries.push({ entry: value, key });
}

function collectBlockCacheEntries(blocks) {
  const entries = [];
  if (!blocks) {
    return entries;
  }

  if (Array.isArray(blocks)) {
    for (const entry of blocks) {
      addBlockCacheEntries(entries, entry, null);
    }
    return entries;
  }

  if (blocks instanceof Map) {
    for (const [key, value] of blocks.entries()) {
      addBlockCacheEntries(entries, value, key);
    }
    return entries;
  }

  if (typeof blocks === "object") {
    for (const [key, value] of Object.entries(blocks)) {
      addBlockCacheEntries(entries, value, key);
    }
  }

  return entries;
}

function getBlockLineFromCache(fileCache, blockId) {
  const entries = collectBlockCacheEntries(fileCache && fileCache.blocks);

  for (const { entry, key } of entries) {
    if (!blockCacheEntryMatchesBlockId(entry, key, blockId)) {
      continue;
    }

    const line = getBlockCacheEntryLine(entry);
    if (line !== null) {
      return line;
    }
  }

  return null;
}

function getTaskCheckboxMarkerToggle(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(TASK_CHECKBOX_MARKER_RE);

  if (taskMatch) {
    const prefix = taskMatch[1];
    const body = taskMatch[3] || "";
    const markerStart = prefix.length;
    const markerEnd = line.length - body.length;

    return {
      lineText: `${prefix}${body}`,
      markerStart,
      markerEnd,
      delta: markerStart - markerEnd,
    };
  }

  const listMatch = line.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return null;
  }

  const prefix = listMatch[1];
  const body = listMatch[2] || "";

  return {
    lineText: `${prefix}${EMPTY_TASK_CHECKBOX_MARKER}${body}`,
    markerStart: prefix.length,
    markerEnd: prefix.length,
    delta: EMPTY_TASK_CHECKBOX_MARKER.length,
  };
}

function rewriteTaskCheckboxMarker(lineText) {
  const toggle = getTaskCheckboxMarkerToggle(lineText);
  return toggle ? toggle.lineText : null;
}

function getTaskCheckboxMarkerCursorCh(cursorCh, toggle) {
  if (!toggle) {
    return cursorCh;
  }

  const currentCh = Math.max(0, Math.floor(Number(cursorCh) || 0));
  let nextCh = currentCh;

  if (toggle.delta < 0) {
    if (currentCh > toggle.markerStart && currentCh < toggle.markerEnd) {
      nextCh = toggle.markerStart;
    } else if (currentCh >= toggle.markerEnd) {
      nextCh = currentCh + toggle.delta;
    }
  } else if (currentCh >= toggle.markerStart) {
    nextCh = currentCh + toggle.delta;
  }

  return Math.max(0, Math.min(toggle.lineText.length, nextCh));
}

// Alt-bracket whole-bullet formatting cycle. On non-checkbox list items the
// task-status cycle commands fall back to cycling the visible bullet body
// through normal -> bold -> italic -> strike (and the reverse), leaving the
// list marker, surrounding whitespace, and any trailing block id untouched.
// See the SDD tale obsidian_alt_bracket_bullet_formatting.md.
const BULLET_FORMAT_STATES = ["normal", "bold", "italic", "strike"];
const BULLET_FORMAT_MARKERS = {
  normal: "",
  bold: "**",
  italic: "*",
  strike: "~~",
};
// Detection accepts the canonical markers above plus common alternatives, but
// rewrites only emit canonical markers so repeated cycling normalizes the line.
const BULLET_FORMAT_DETECTORS = [
  { state: "bold", marker: "**" },
  { state: "bold", marker: "__" },
  { state: "strike", marker: "~~" },
  { state: "italic", marker: "*" },
  { state: "italic", marker: "_" },
];

function isBodyWrappedWithMarker(text, marker) {
  const body = String(text || "");
  if (body.length < marker.length * 2 + 1) {
    return false;
  }
  if (!body.startsWith(marker) || !body.endsWith(marker)) {
    return false;
  }

  const inner = body.slice(marker.length, body.length - marker.length);
  // A premature copy of the marker inside means this is not a single whole-body
  // span (e.g. `**a** **b**`), so it does not define the bullet state.
  return inner.length > 0 && !inner.includes(marker);
}

function parseWholeBulletFormat(coreText) {
  const core = String(coreText || "");
  for (const { state, marker } of BULLET_FORMAT_DETECTORS) {
    if (isBodyWrappedWithMarker(core, marker)) {
      return {
        state,
        content: core.slice(marker.length, core.length - marker.length),
        openMarker: marker,
        closeMarker: marker,
      };
    }
  }

  return { state: "normal", content: core, openMarker: "", closeMarker: "" };
}

function splitTrailingBlockIdFromBody(bodyText) {
  const body = String(bodyText || "");
  const match = body.match(TRAILING_BLOCK_ID_RE);
  if (!match) {
    return { content: body, blockIdSuffix: "" };
  }

  return {
    content: body.slice(0, match.index),
    blockIdSuffix: body.slice(match.index),
  };
}

function getWholeBulletFormatState(bodyText) {
  const { content } = splitTrailingBlockIdFromBody(String(bodyText || ""));
  return parseWholeBulletFormat(content.trim()).state;
}

function getAdjacentBulletFormatState(currentState, direction) {
  const index = BULLET_FORMAT_STATES.indexOf(currentState);
  if (index === -1 || BULLET_FORMAT_STATES.length < 2) {
    return null;
  }

  const step = direction < 0 ? -1 : 1;
  const nextIndex =
    (index + step + BULLET_FORMAT_STATES.length) % BULLET_FORMAT_STATES.length;
  return BULLET_FORMAT_STATES[nextIndex];
}

function getPlainListItemFormattingTarget(lineText) {
  const line = String(lineText || "");
  if (TASK_CHECKBOX_MARKER_RE.test(line)) {
    return null;
  }

  const match = line.match(LIST_ITEM_MARKER_RE);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const body = match[2] || "";
  const { content, blockIdSuffix } = splitTrailingBlockIdFromBody(body);
  if (content.trim() === "") {
    return null;
  }

  return {
    prefix,
    body,
    content,
    blockIdSuffix,
    bodyStart: prefix.length,
  };
}

function getPlainBulletFormatToggle(lineText, direction) {
  const line = String(lineText || "");
  // Depends-On lines are managed by the dependency stage; Alt+]/Alt+[ cycle
  // the link under the cursor there and must never reformat the bullet.
  if (isTaskDependencyLine(line)) {
    return null;
  }
  const target = getPlainListItemFormattingTarget(line);
  if (!target) {
    return null;
  }

  const leadingWs = (target.content.match(/^[ \t]*/) || [""])[0];
  const trailingWs = (target.content.match(/[ \t]*$/) || [""])[0];
  const core = target.content.slice(
    leadingWs.length,
    target.content.length - trailingWs.length,
  );
  if (core === "") {
    return null;
  }

  const parsed = parseWholeBulletFormat(core);
  const nextState = getAdjacentBulletFormatState(parsed.state, direction);
  if (!nextState || nextState === parsed.state) {
    return null;
  }

  const nextMarker = BULLET_FORMAT_MARKERS[nextState];
  const coreStart = target.bodyStart + leadingWs.length;
  const contentStart = coreStart + parsed.openMarker.length;
  const contentEnd = contentStart + parsed.content.length;

  // Emit marker-level edits (insert/delete/replace at each end of the content)
  // so the edit-aware cursor helper keeps the caret on the same visible text.
  const edits = [];
  if (parsed.openMarker !== nextMarker) {
    edits.push({
      start: coreStart,
      end: coreStart + parsed.openMarker.length,
      text: nextMarker,
    });
  }
  if (parsed.closeMarker !== nextMarker) {
    edits.push({
      start: contentEnd,
      end: contentEnd + parsed.closeMarker.length,
      text: nextMarker,
    });
  }

  const newCore = `${nextMarker}${parsed.content}${nextMarker}`;
  const nextLineText = `${target.prefix}${leadingWs}${newCore}${trailingWs}${target.blockIdSuffix}`;

  return {
    sourceLineText: line,
    lineText: nextLineText,
    edits,
  };
}

