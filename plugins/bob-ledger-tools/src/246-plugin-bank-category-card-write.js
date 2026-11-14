// Pure Category card write planner, next-waiting finder, and JSON row match
// (bank_weekly_category_walk card-model). Reuses bankScanSource and
// bankTokenizeLine; every byte the plugin does not own is preserved.

const BANK_CATEGORY_WRITE_REFUSAL = "Bank: the row changed — nothing written";

function bankCategoryCapture(input = {}) {
  const lineText = typeof input.lineText === "string" ? input.lineText : "";
  const match = String(lineText).match(/[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/);
  const blockId = match ? match[1] : null;
  const ackMatch = blockId ? blockId.match(/^bank-([0-9a-fA-F]+)$/i) : null;
  return {
    path: typeof input.path === "string" ? input.path : "",
    line: Number.isInteger(input.line) ? input.line : null,
    lineText,
    bankId: ackMatch ? ackMatch[1].toLowerCase() : null,
  };
}

function bankCategoryCountCatFields(lineText) {
  const matches = String(lineText || "").match(/\[cat::/g);
  return matches ? matches.length : 0;
}

function bankCategoryCurrentToken(path, source, line) {
  if (typeof source !== "string" || !Number.isInteger(line) || line < 1) {
    return null;
  }
  try {
    const scan = bankScanSource(path, source);
    if (!scan || !scan.month) {
      return null;
    }
    const row = scan.rows.find((entry) => entry && entry.line === line);
    if (!row) {
      return null;
    }
    const lines = String(source).replace(/^\uFEFF/, "").split("\n");
    const raw = (lines[line - 1] || "").replace(/\r$/, "");
    const token = bankTokenizeLine(raw);
    if (!token) {
      return null;
    }
    return { scan, row, raw, token };
  } catch (error) {
    return null;
  }
}

function bankCategoryResolveForCommit(capture, currentPath, currentSource) {
  if (!capture || capture.path !== currentPath) {
    return { ok: false, reason: "file-changed", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  if (typeof currentSource !== "string") {
    return { ok: false, reason: "no-source", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const lines = String(currentSource).replace(/^\uFEFF/, "").split("\n");
  if (capture.bankId) {
    let scan = null;
    try {
      scan = bankScanSource(currentPath, currentSource);
    } catch (error) {
      scan = null;
    }
    if (!scan || !scan.month) {
      return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
    }
    const matches = scan.rows.filter((row) => row && row.ackId === capture.bankId);
    if (matches.length !== 1) {
      return { ok: false, reason: "moved-or-edited", message: BANK_CATEGORY_WRITE_REFUSAL };
    }
    const resolved = matches[0];
    const raw = (lines[resolved.line - 1] || "").replace(/\r$/, "");
    let token = null;
    try {
      token = bankTokenizeLine(raw);
    } catch (error) {
      token = null;
    }
    if (!token) {
      return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
    }
    return { ok: true, line: resolved.line, raw, token };
  }
  if (!Number.isInteger(capture.line) || capture.line < 1 || capture.line > lines.length) {
    return { ok: false, reason: "moved-or-edited", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const raw = (lines[capture.line - 1] || "").replace(/\r$/, "");
  if (raw !== capture.lineText) {
    return { ok: false, reason: "moved-or-edited", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  let token = null;
  try {
    token = bankTokenizeLine(raw);
  } catch (error) {
    token = null;
  }
  if (!token) {
    return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  return { ok: true, line: capture.line, raw, token };
}

// One editor transaction plan: status byte plus insert/replace/remove of a
// single [cat:: key] right after the payee span. Space removes with one
// leading space. Returns character edits within the resolved line.
function bankCategoryWritePlan(input = {}) {
  const mode = input.mode === "set" ? "set" : "close";
  const capture = input.capture && typeof input.capture === "object" ? input.capture : null;
  const categoryKey = input.categoryKey === null || input.categoryKey === undefined
    ? null
    : (typeof input.categoryKey === "string" && input.categoryKey ? input.categoryKey : null);
  if (input.categoryKey !== null && input.categoryKey !== undefined && categoryKey === null) {
    return { ok: false, reason: "bad-category", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const resolved = bankCategoryResolveForCommit(capture, input.currentPath, input.currentSource);
  if (!resolved.ok) {
    return resolved;
  }
  const { line, raw, token } = resolved;
  if (bankCategoryCountCatFields(raw) >= 2) {
    return { ok: false, reason: "duplicate-cat", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  if (mode === "close" && token.acknowledged) {
    return { ok: false, reason: "not-waiting", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const edits = [];
  if (mode === "close") {
    const checkbox = token.checkbox;
    if (!checkbox || !Number.isInteger(checkbox.start)) {
      return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
    }
    const statusAt = checkbox.start + 1;
    const current = raw[statusAt];
    if (current !== "x" && current !== "X") {
      edits.push({ line, fromCh: statusAt, toCh: statusAt + 1, insert: "x" });
    }
  }
  const existing = token.category;
  if (categoryKey === null) {
    if (existing && existing.span && Number.isInteger(existing.span.start)) {
      let fromCh = existing.span.start;
      if (fromCh > 0 && raw[fromCh - 1] === " ") {
        fromCh -= 1;
      }
      edits.push({ line, fromCh, toCh: existing.span.end, insert: "" });
      return { ok: true, mode, line, action: "remove", edits, tick: mode === "close" };
    }
    if (mode === "close" && edits.length > 0) {
      return { ok: true, mode, line, action: "tick", edits, tick: true };
    }
    if (mode === "set") {
      return { ok: true, mode, line, action: "noop", edits, tick: false };
    }
    return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const replacement = `[cat:: ${categoryKey}]`;
  if (existing && existing.span && Number.isInteger(existing.span.start)) {
    edits.push({ line, fromCh: existing.span.start, toCh: existing.span.end, insert: replacement });
    return { ok: true, mode, line, action: "replace", edits, tick: mode === "close" };
  }
  const payeeSpan = token.payeeSpan;
  if (!payeeSpan || !Number.isInteger(payeeSpan.end)) {
    return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  edits.push({ line, fromCh: payeeSpan.end, toCh: payeeSpan.end, insert: ` ${replacement}` });
  return { ok: true, mode, line, action: "insert", edits, tick: mode === "close" };
}

function bankCategoryWaitingRows(scan) {
  const rows = scan && Array.isArray(scan.rows) ? scan.rows : [];
  return rows
    .filter((row) => bankWalkIsWaiting(row))
    .slice()
    .sort((left, right) => Number(left.line || 0) - Number(right.line || 0));
}

// Next waiting row in document order after the filed line; wraps once to
// the first waiting row above. Never opens another file.
function bankCategoryNextWaiting(input = {}) {
  const filedLine = Number.isInteger(input.filedLine) ? input.filedLine : null;
  if (filedLine === null) {
    return null;
  }
  let scan = input.scan || null;
  if (!scan && typeof input.source === "string" && typeof input.path === "string") {
    try {
      scan = bankScanSource(input.path, input.source);
    } catch (error) {
      scan = null;
    }
  }
  if (!scan || !scan.month) {
    return null;
  }
  const waiting = bankCategoryWaitingRows(scan);
  if (waiting.length === 0) {
    return null;
  }
  const below = waiting.find((row) => Number(row.line) > filedLine);
  if (below) {
    return { row: below, wrapped: false };
  }
  const first = waiting[0];
  if (Number(first.line) === filedLine) {
    return null;
  }
  return { row: first, wrapped: true };
}

// Match the card row to bob JSON: by ^bank- ID, else path+line with equal
// cents and payee. No match still files; the card shows no suggestion.
function bankCategoryMatchJsonRow(cardRow, jsonRows) {
  const rows = Array.isArray(jsonRows) ? jsonRows : [];
  if (!cardRow || typeof cardRow !== "object") {
    return null;
  }
  const cardId = typeof cardRow.id === "string" && cardRow.id ? cardRow.id.toLowerCase() : null;
  const cardAck = typeof cardRow.ackId === "string" && cardRow.ackId
    ? cardRow.ackId.toLowerCase()
    : cardId;
  if (cardAck) {
    const byId = rows.filter((row) => row &&
      typeof row.id === "string" && row.id.toLowerCase() === cardAck);
    if (byId.length === 1) {
      return byId[0];
    }
    if (byId.length > 1) {
      return null;
    }
  }
  const candidates = rows.filter((row) => row &&
    row.path === cardRow.path && Number(row.line) === Number(cardRow.line));
  if (candidates.length !== 1) {
    return null;
  }
  const candidate = candidates[0];
  if (Number(candidate.cents) !== Number(cardRow.cents)) {
    return null;
  }
  if (typeof candidate.payee === "string" && typeof cardRow.payee === "string" &&
    candidate.payee !== cardRow.payee) {
    return null;
  }
  return candidate;
}
