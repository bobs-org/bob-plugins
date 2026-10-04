function getUnambiguousTranscludedBlockCandidate(candidates, cursorCh) {
  const matches = Array.isArray(candidates) ? candidates : [];
  if (matches.length === 1) {
    return matches[0];
  }

  const ch = Math.max(0, Math.floor(Number(cursorCh) || 0));
  const cursorMatches = matches.filter(
    (candidate) =>
      ch >= (candidate.selectionStartIndex ?? candidate.startIndex) &&
      ch < (candidate.selectionEndIndex ?? candidate.endIndex),
  );
  return cursorMatches.length === 1 ? cursorMatches[0] : null;
}

function getTranscludedTaskTargetFromLine(
  lineText,
  sourcePath,
  lineNumber,
  cursorCh = null,
) {
  if (!sourcePath) {
    return null;
  }

  const line = String(lineText || "");
  const candidates = parseEmbeddedBlockTransclusions(line);
  const hasCursorCh = cursorCh !== null && cursorCh !== undefined;
  const candidate = hasCursorCh
    ? getUnambiguousTranscludedBlockCandidate(candidates, cursorCh)
    : candidates.length === 1
      ? candidates[0]
      : null;

  return candidate
    ? {
        ...candidate,
        sourcePath,
        activeLine: lineNumber,
        activeLineText: line,
      }
    : null;
}

// Ctrl+Enter selection is intentionally broader than recursive Pomodoro
// completion: a selected task block link may be embedded, plain, marked, or
// canonically retired inside strikethrough. Inside an open Pomodoro, a selected
// link that resolves to an Open/Next/In Progress/Done task is handled as a Task
// Link and never completes the Pomodoro; a plain link that does not resolve
// falls back to Pomodoro completion, while an unresolved embedded link keeps
// the keypress consumed. The cursor disambiguates lines with multiple
// candidates; a line with one valid candidate remains selectable from anywhere
// on that line.
function getTaskBlockLinkTargetFromLine(
  lineText,
  sourcePath,
  lineNumber,
  cursorCh = null,
) {
  if (!sourcePath) {
    return null;
  }

  const line = String(lineText || "");
  const strikeSpans = getStrikethroughSpans(line);
  const candidates = getBlockLinkTokenCandidates(line).map((candidate) => {
    const exactStrike = strikeSpans.find(
      (span) =>
        candidate.startIndex === span.start && candidate.endIndex === span.end,
    );
    const tokenStart = exactStrike
      ? exactStrike.start - 2
      : candidate.startIndex;
    const markerPrefix = getPomodoroMarkerPrefix(line, tokenStart);
    return {
      ...candidate,
      selectionStartIndex: markerPrefix.start,
      selectionEndIndex: exactStrike
        ? exactStrike.end + 2
        : candidate.endIndex,
    };
  });
  const hasCursorCh = cursorCh !== null && cursorCh !== undefined;
  const candidate = hasCursorCh
    ? getUnambiguousTranscludedBlockCandidate(candidates, cursorCh)
    : candidates.length === 1
      ? candidates[0]
      : null;

  return candidate
    ? {
        ...candidate,
        sourcePath,
        activeLine: lineNumber,
        activeLineText: line,
      }
    : null;
}

function collectTaskBlockLinkTargetsInLineRange(
  lines,
  sourcePath,
  startLine,
  endLine,
) {
  if (!sourcePath || !Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const firstLine = Math.max(0, Math.floor(Number(startLine) || 0));
  const requestedLastLine = Math.floor(Number(endLine) || 0);
  if (requestedLastLine < firstLine) {
    return [];
  }
  const lastLine = Math.min(
    requestedLastLine,
    lines.length - 1,
  );
  const fenced = getFencedLineNumbers(lines);
  const targets = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const lineText = String(lines[line] || "");
    for (const candidate of getBlockLinkTokenCandidates(lineText)) {
      targets.push({
        ...candidate,
        sourcePath,
        activeLine: line,
        activeLineText: lineText,
      });
    }
  }

  return targets;
}

function collectTranscludedTaskTargetsInLineRange(
  lines,
  sourcePath,
  startLine,
  endLine,
  cursorCh = null,
) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const firstLine = Math.max(0, Math.floor(Number(startLine) || 0));
  const lastLine = Math.min(
    Math.max(firstLine, Math.floor(Number(endLine) || firstLine)),
    Math.max(sourceLines.length - 1, 0),
  );
  const targets = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    const target = getTranscludedTaskTargetFromLine(
      sourceLines[line],
      sourcePath,
      line,
      line === firstLine ? cursorCh : null,
    );
    if (target) {
      targets.push(target);
    }
  }

  return targets;
}

function getStandaloneBlockIdRegex(blockId) {
  return new RegExp(
    `${STANDALONE_BLOCK_ID_PREFIX_RE}\\^${escapeRegExp(blockId)}${STANDALONE_BLOCK_ID_SUFFIX_RE}`,
  );
}

function lineContainsStandaloneBlockId(lineText, blockId) {
  if (!BLOCK_ID_RE.test(String(blockId || ""))) {
    return false;
  }

  return getStandaloneBlockIdRegex(blockId).test(String(lineText || ""));
}

function splitTextByLineEndings(text) {
  const sourceText = String(text || "");
  const lines = [];
  const lineRe = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;

  while ((match = lineRe.exec(sourceText)) !== null) {
    if (match[0] === "" && match.index === sourceText.length) {
      break;
    }

    lines.push({
      text: match[1],
      ending: match[2],
    });

    if (match[2] === "") {
      break;
    }
  }

  return lines.length ? lines : [{ text: "", ending: "" }];
}

function getFencedLineNumbers(lines) {
  const fenced = new Set();
  let opening = null;
  for (let line = 0; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!opening) {
      const match = text.match(CODE_FENCE_OPEN_RE);
      if (match) {
        opening = { marker: match[1][0], length: match[1].length };
        fenced.add(line);
      }
      continue;
    }
    fenced.add(line);
    const close = text.match(CODE_FENCE_CLOSE_RE);
    if (
      close &&
      close[1][0] === opening.marker &&
      close[1].length >= opening.length
    ) {
      opening = null;
    }
  }
  return fenced;
}

function getStrikethroughSpans(lineText) {
  const line = String(lineText || "");
  const delimiters = [];
  let offset = 0;
  while ((offset = line.indexOf("~~", offset)) !== -1) {
    delimiters.push(offset);
    offset += 2;
  }
  const spans = [];
  for (let index = 0; index + 1 < delimiters.length; index += 2) {
    spans.push({ start: delimiters[index] + 2, end: delimiters[index + 1] });
  }
  return spans;
}

function rangeIsStruck(start, end, spans) {
  return (spans || []).some((span) => start >= span.start && end <= span.end);
}

// Shared per-candidate retired-link edit used by vault-wide retirement and by
// the single-line Ctrl+Enter strike path. For an embedded candidate
// (`candidate.embedded === true`, or a `parseEmbeddedBlockTransclusions`
// candidate whose `startIndex` is on the `!`) the wikilink text drops the `!`;
// for a plain candidate it is the token itself. Returns `{ start, end, text }`,
// or `null` when a plain token is already inside a strike span and there is
// nothing to do. An already-struck embedded token still emits a rewrite so the
// `!` is dropped, preserving today's retirement output byte-for-byte.
function buildRetiredBlockLinkEdit(lineText, candidate, strikeSpans, pomodoro) {
  const line = String(lineText || "");
  const startIndex = candidate && Number.isInteger(candidate.startIndex)
    ? candidate.startIndex
    : null;
  const endIndex = candidate && Number.isInteger(candidate.endIndex)
    ? candidate.endIndex
    : null;
  if (startIndex === null || endIndex === null) {
    return null;
  }
  const embedded = candidate.embedded !== false;
  const spans = Array.isArray(strikeSpans)
    ? strikeSpans
    : getStrikethroughSpans(line);
  if (!embedded && rangeIsStruck(startIndex, endIndex, spans)) {
    return null;
  }
  const wikilink = embedded
    ? line.slice(startIndex + 1, endIndex)
    : line.slice(startIndex, endIndex);
  const exactStrike = spans.find(
    (span) => startIndex === span.start && endIndex === span.end,
  );
  const alreadyStruck = rangeIsStruck(startIndex, endIndex, spans);
  const needsLeadingSpace =
    !alreadyStruck && line.slice(Math.max(0, startIndex - 2), startIndex) === "~~";
  const needsTrailingSpace =
    !alreadyStruck && line.slice(endIndex, endIndex + 2) === "~~";
  const retiredText = exactStrike
    ? `~~${wikilink}~~`
    : alreadyStruck
      ? wikilink
      : `${needsLeadingSpace ? " " : ""}~~${wikilink}~~${needsTrailingSpace ? " " : ""}`;
  const displayStart = exactStrike
    ? exactStrike.start - 2
    : startIndex;
  const displayEnd = exactStrike
    ? exactStrike.end + 2
    : endIndex;
  const prefix = getPomodoroMarkerPrefix(line, displayStart);
  return {
    start: pomodoro ? prefix.start : startIndex,
    end: pomodoro ? displayEnd : endIndex,
    text: retiredText,
  };
}

function findSelectedBlockLinkCandidate(lineText, selection) {
  const line = String(lineText || "");
  if (!selection || typeof selection.blockId !== "string") {
    return null;
  }
  const matching = getBlockLinkTokenCandidates(line).filter(
    (candidate) =>
      candidate.pathPart === selection.pathPart &&
      candidate.blockId === selection.blockId,
  );
  if (matching.length === 0) {
    return null;
  }
  const sameKind = matching.filter(
    (candidate) => !!candidate.embedded === !!selection.embedded,
  );
  const pool = sameKind.length > 0 ? sameKind : matching;
  const anchor = Number.isInteger(selection.startIndex)
    ? selection.startIndex
    : null;
  let best = pool[0];
  if (anchor !== null) {
    let bestDistance = Math.abs(best.startIndex - anchor);
    for (const candidate of pool.slice(1)) {
      const distance = Math.abs(candidate.startIndex - anchor);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function strikeSelectedTaskBlockLinkInLine(lineText, selection, options = {}) {
  const line = String(lineText || "");
  const candidate = findSelectedBlockLinkCandidate(line, selection);
  if (!candidate) {
    return null;
  }
  const strikeSpans = getStrikethroughSpans(line);
  const pomodoro = !!(options && options.pomodoro);
  const edit = buildRetiredBlockLinkEdit(line, candidate, strikeSpans, pomodoro);
  if (!edit) {
    return null;
  }
  const nextLine = `${line.slice(0, edit.start)}${edit.text}${line.slice(edit.end)}`;
  return nextLine === line ? null : nextLine;
}

function unstrikeSelectedTaskBlockLinkInLine(lineText, selection) {
  const line = String(lineText || "");
  if (!selection || typeof selection.blockId !== "string") {
    return null;
  }
  const matching = getBlockLinkTokenCandidates(line).filter(
    (candidate) =>
      candidate.embedded === false &&
      candidate.pathPart === selection.pathPart &&
      candidate.blockId === selection.blockId,
  );
  if (matching.length === 0) {
    return null;
  }
  const anchor = Number.isInteger(selection.startIndex)
    ? selection.startIndex
    : null;
  let best = matching[0];
  if (anchor !== null) {
    let bestDistance = Math.abs(best.startIndex - anchor);
    for (const candidate of matching.slice(1)) {
      const distance = Math.abs(candidate.startIndex - anchor);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  const strikeSpans = getStrikethroughSpans(line);
  const exactStrike = strikeSpans.find(
    (span) => best.startIndex === span.start && best.endIndex === span.end,
  );
  if (!exactStrike) {
    return null;
  }
  const wikilink = line.slice(best.startIndex, best.endIndex);
  const nextLine = `${line.slice(0, exactStrike.start - 2)}${wikilink}${line.slice(exactStrike.end + 2)}`;
  return nextLine === line ? null : nextLine;
}

