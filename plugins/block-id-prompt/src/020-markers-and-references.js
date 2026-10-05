function parseTaskPickerPosition(destination) {
  let blockPrefix;
  let targetText;

  if (destination.endsWith("#^")) {
    blockPrefix = "#^";
    targetText = destination.slice(0, -2);
  } else if (destination.endsWith("^")) {
    blockPrefix = "^";
    targetText = destination.slice(0, -1);
  } else {
    return null;
  }

  if (targetText.includes("^")) {
    return null;
  }

  return { targetText, blockPrefix };
}

function taskPickerMarkerFromPosition(
  match,
  position,
  aliasSuffix,
  raw,
  endCh,
  markerStartCh,
  markerEndCh,
) {
  const parsedPosition = parseTaskPickerPosition(position);
  if (!parsedPosition) {
    return null;
  }

  return {
    kind: "link-task-picker",
    raw,
    ...parsedPosition,
    aliasSuffix,
    startCh: match.index,
    endCh,
    markerStartCh,
    markerEndCh,
  };
}

function parseTrailingTaskPickerMarker(match) {
  const raw = match[0];
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  let markerLength;

  if (destination.endsWith("#^^")) {
    markerLength = 3;
  } else if (destination.endsWith("^^")) {
    markerLength = 2;
  } else {
    return null;
  }

  const markerStartCh = match.index + 2 + destination.length - markerLength;
  const markerEndCh = match.index + 2 + destination.length;
  const rawBase = destination.slice(0, destination.length - markerLength);
  if (rawBase.endsWith("^")) {
    return null;
  }

  const base = markerLength === 3 ? `${rawBase}#` : rawBase;
  const position = `${getCaretCompletionDestination(base)}^`;

  return taskPickerMarkerFromPosition(
    match,
    position,
    aliasSuffix,
    raw,
    match.index + raw.length,
    markerStartCh,
    markerEndCh,
  );
}

function parseRapidTaskPickerMarker(match, lineText) {
  const linkRaw = match[0];
  const markerStartCh = match.index + linkRaw.length;
  if (
    lineText.slice(markerStartCh, markerStartCh + 2) !== "^^" ||
    lineText[markerStartCh + 2] === "^"
  ) {
    return null;
  }

  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  if (!normalizeText(destination)) {
    return null;
  }

  const position = `${getCaretCompletionDestination(destination)}^`;
  const markerEndCh = markerStartCh + 2;

  return taskPickerMarkerFromPosition(
    match,
    position,
    aliasSuffix,
    lineText.slice(match.index, markerEndCh),
    markerEndCh,
    markerStartCh,
    markerEndCh,
  );
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
  const path = stripLinkSubpath(destination);
  return path === destination ? path : `${path}#`;
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
    const parsed =
      parseTrailingTaskPickerMarker(match) ||
      parseRapidTaskPickerMarker(match, lineText);
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

