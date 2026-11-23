// Recovery-drift preimage for successor offer closes. Bob's ordinary
// dependency or project recovery rewrites a row (`?` to ` `, an
// `[unblocked:: date]` stamp, `#prj_is_blocked` removal) while the
// successor card is open. That rewrite is the same preimage; every other
// change still refuses.
function successorOfferCloseRecoveryDrift(expected, current) {
  const from = String(expected == null ? "" : expected);
  const to = String(current == null ? "" : current);
  if (from === to) return false;
  let fromStatus = null;
  let toStatus = null;
  try {
    fromStatus = getTaskStatusForLine(from, 0);
    toStatus = getTaskStatusForLine(to, 0);
  } catch (_error) {
    return false;
  }
  if (!fromStatus || !toStatus) return false;
  const fromSymbol = String(fromStatus.symbol || "");
  const toSymbol = String(toStatus.symbol || "");
  const unchanged = fromSymbol === toSymbol;
  const recovered = fromSymbol === "?" && toSymbol === " ";
  if (!unchanged && !recovered) return false;
  const normalize = (lineText) => {
    let out = String(lineText || "");
    try {
      const info = getTaskStatusForLine(out, 0);
      if (info && Number.isInteger(info.statusStart) && info.statusStart >= 0) {
        out = `${out.slice(0, info.statusStart)} ${out.slice(info.statusStart + 1)}`;
      }
    } catch (_error) {}
    out = out.replace(/ \[unblocked:: \d{4}-\d{2}-\d{2}\]/g, "");
    try {
      out = stripProjectBlockedResidentTag(out);
    } catch (_error) {}
    return out;
  };
  return normalize(from) === normalize(to);
}

// Adopt a drifted live line into a planned row. Returns true when the row's
// expected line was the card preimage and the live line is only Bob's
// ordinary recovery of that row; the row keeps the adopted line, status,
// and task for the write. Every other mismatch returns false.
function successorOfferCloseAdoptRecoveryDrift(row, currentLine) {
  try {
    if (!row || typeof row.expected !== "string" || typeof currentLine !== "string") return false;
    if (currentLine === row.expected) return true;
    if (successorOfferCloseRecoveryDrift(row.expected, currentLine) !== true) return false;
    row.expected = currentLine;
    try {
      const driftStatus = getTaskStatusForLine(row.expected, row.line);
      if (driftStatus && typeof driftStatus.symbol === "string") row.status = driftStatus.symbol;
    } catch (_error) {}
    if (row.task && typeof row.task === "object") {
      row.task = { ...row.task, rawLine: row.expected, text: row.expected };
      if (typeof row.status === "string") row.task.status = row.status;
    }
    return true;
  } catch (_error) {
    return false;
  }
}
