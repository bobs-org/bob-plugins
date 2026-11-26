// Settle-aware identity forwarding for review queue rows, resume anchors,
// and recorded jumps. Queue/resume lines stay 1-based; editor/settle maps
// stay 0-based. A supplied block ID is authoritative and never falls back
// to a stale line number.

function navReviewEntryBlockId(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry.blockId === "string" && entry.blockId.trim()) {
    return entry.blockId.trim();
  }
  return navTaskSettleLineBlockId(entry.originalMarkdown || entry.text || "");
}

function navSettleQueueLineToZero(line) {
  if (!Number.isInteger(line)) return null;
  return Math.max(0, line - 1);
}

function mapNavJumpLocationThroughSettle(location, lineMap, contents) {
  if (!location || typeof location !== "object") return null;
  const path = typeof location.path === "string" ? location.path : "";
  if (!path) return null;
  const lines = splitMarkdownContent(contents == null ? "" : contents).lines;
  const identity = {
    blockId: typeof location.blockId === "string" ? location.blockId : "",
    text: location.text == null ? null : String(location.text),
    line: Number.isInteger(location.line) ? location.line : undefined,
  };
  const resolved = resolveNavTaskIdentity(lines, identity);
  let line = resolved.line;
  if (line == null) {
    line = mapNavLineThroughSettle(lineMap, identity.line);
  }
  if (line == null) return null;
  const text = String(lines[line] || "");
  const ch = Number.isInteger(location.ch)
    ? Math.max(0, Math.min(location.ch, text.length))
    : 0;
  return Object.freeze({
    path,
    line,
    ch,
    ...(identity.blockId ? { blockId: identity.blockId } : {}),
    text,
  });
}

function mapReviewQueueEntryThroughSettle(entry, contents, lineMap) {
  if (!entry || typeof entry !== "object") return null;
  const lines = splitMarkdownContent(contents == null ? "" : contents).lines;
  const blockId = navReviewEntryBlockId(entry);
  const text =
    typeof entry.originalMarkdown === "string"
      ? entry.originalMarkdown
      : typeof entry.text === "string"
        ? entry.text
        : null;
  const zero = navSettleQueueLineToZero(entry.line);
  const resolved = resolveNavTaskIdentity(lines, {
    blockId,
    text,
    line: zero,
  });
  let line = resolved.line;
  if (line == null && !blockId) {
    line = mapNavLineThroughSettle(lineMap, zero);
  }
  if (line == null) return null;
  const nextText = String(lines[line] || "");
  return Object.freeze({
    ...entry,
    line: line + 1,
    originalMarkdown: nextText,
    ...(blockId ? { blockId } : {}),
  });
}

function mapReviewResumeRefThroughSettle(ref, contents, lineMap) {
  if (!ref || typeof ref !== "object") return null;
  const lines = splitMarkdownContent(contents == null ? "" : contents).lines;
  const blockId =
    typeof ref.blockId === "string" && ref.blockId.trim()
      ? ref.blockId.trim()
      : navTaskSettleLineBlockId(ref.text || "");
  const text = ref.text == null ? null : String(ref.text);
  const zero = navSettleQueueLineToZero(ref.line);
  const resolved = resolveNavTaskIdentity(lines, {
    blockId,
    text,
    line: zero,
  });
  let line = resolved.line;
  if (line == null && !blockId) {
    line = mapNavLineThroughSettle(lineMap, zero);
  }
  if (line == null) return null;
  const nextText = String(lines[line] || "");
  return Object.freeze({
    ...ref,
    line: line + 1,
    text: nextText,
    ...(blockId ? { blockId } : {}),
  });
}

const resolveReviewQueueLineBeforeSettle = resolveReviewQueueLine;
resolveReviewQueueLine = function resolveReviewQueueLineWithBlockId(content, entry) {
  const blockId =
    entry && typeof entry.blockId === "string" ? entry.blockId.trim() : "";
  if (blockId) {
    const { lines } = splitMarkdownContent(String(content || ""));
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (navTaskSettleLineBlockId(lines[index]) === blockId) matches.push(index);
    }
    if (matches.length === 1 && !reviewAdvanceLineIsClosed(lines[matches[0]])) {
      return Object.freeze({ ok: true, line: matches[0], source: "blockId" });
    }
    return Object.freeze({ ok: false, reason: "stale" });
  }
  return resolveReviewQueueLineBeforeSettle(content, entry);
};

const reviewResumeRefBeforeSettle = reviewResumeRef;
reviewResumeRef = function reviewResumeRefWithSettleIdentity(entry) {
  const ref = reviewResumeRefBeforeSettle(entry);
  if (!ref) return ref;
  const blockId = navReviewEntryBlockId(entry);
  if (!blockId) return ref;
  return Object.freeze({ ...ref, blockId });
};

// Explicit walk navigation can use identity even while Tasks still reports
// the pre-settle text/line. Alt+N's off-landing eligibility remains the
// separate exact-text check in captureReviewDueRowGesture.
const findReviewCursorIndexBeforeSettle = findReviewCursorIndex;
findReviewCursorIndex = function findReviewCursorIndexWithSettleIdentity(list, cursor, handledKeys) {
  const blockId = cursor && navTaskSettleLineBlockId(cursor.text);
  if (!blockId) return findReviewCursorIndexBeforeSettle(list, cursor, handledKeys);
  const index = findReviewResumeIndex(list, { ...cursor, blockId });
  const handled = handledKeys instanceof Set ? handledKeys : new Set(handledKeys || []);
  return index >= 0 && !handled.has(reviewQueueEntryKey(list[index])) ? index : -1;
};

const findReviewResumeIndexBeforeSettle = findReviewResumeIndex;
findReviewResumeIndex = function findReviewResumeIndexWithSettleIdentity(list, ref) {
  try {
    const rows = Array.isArray(list) ? list : null;
    if (!rows || !ref || typeof ref !== "object") {
      return findReviewResumeIndexBeforeSettle(list, ref);
    }
    const blockId =
      typeof ref.blockId === "string" && ref.blockId.trim()
        ? ref.blockId.trim()
        : "";
    if (!blockId) {
      return findReviewResumeIndexBeforeSettle(list, ref);
    }
    const refPath = typeof ref.path === "string" ? ref.path : "";
    if (!refPath) return -1;
    const hits = [];
    for (let index = 0; index < rows.length; index += 1) {
      const entry = rows[index];
      if (!entry || typeof entry !== "object") continue;
      if (String(entry.path || "") !== refPath) continue;
      const entryId = navReviewEntryBlockId(entry);
      if (entryId === blockId) hits.push(index);
    }
    if (hits.length === 1) return hits[0];
    return -1;
  } catch (_error) {
    return -1;
  }
};
