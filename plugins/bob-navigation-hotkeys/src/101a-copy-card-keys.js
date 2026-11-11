// Copy card key resolution and copied-notice formatting. Companion to
// 101-copy-card-model.js; cmd_y_twice is the accepted plan decision.

const COPY_CARD_CMD_Y_TWICE = true;
const COPY_CARD_MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
]);

function copyCardRowById(model, rowId) {
  const rows = model && Array.isArray(model.rows) ? model.rows : [];
  return rows.find((row) => row.id === rowId) || null;
}

function copyCardKeyAction(type, extra) {
  return freezeCopyCardValue({ type, ...(extra || {}) });
}

function copyCardPlatformName(override) {
  if (override != null && String(override)) {
    return String(override);
  }
  if (typeof process !== "undefined" && process.platform) {
    return String(process.platform);
  }
  if (typeof navigator !== "undefined" && navigator.platform) {
    return String(navigator.platform);
  }
  return "";
}

function copyCardModUsesMeta(platform) {
  const name = copyCardPlatformName(platform);
  return name === "darwin" || /^mac/i.test(name);
}

function isCopyCardModY(event, platform) {
  const key = String(event && event.key ? event.key : "").toLowerCase();
  if (key !== "y") {
    return false;
  }
  if (event.altKey === true || event.shiftKey === true) {
    return false;
  }
  if (copyCardModUsesMeta(platform)) {
    return event.metaKey === true && event.ctrlKey !== true;
  }
  return event.ctrlKey === true && event.metaKey !== true;
}

function isCopyCardCtrlLetter(event, letter) {
  const key = String(event && event.key ? event.key : "").toLowerCase();
  return (
    key === letter &&
    event.ctrlKey === true &&
    event.metaKey !== true &&
    event.altKey !== true &&
    event.shiftKey !== true
  );
}

function stepCopyCardHighlight(model, highlightId, direction) {
  const rows = model && Array.isArray(model.rows) ? model.rows : [];
  const copyable = rows.filter(isCopyableCopyCardRow);
  if (copyable.length === 0) {
    return highlightId || null;
  }
  const currentIndex = rows.findIndex((row) => row.id === highlightId);
  const count = rows.length;
  for (let step = 1; step <= count; step += 1) {
    const index =
      currentIndex < 0
        ? direction > 0
          ? (step - 1) % count
          : (count - step) % count
        : (currentIndex + direction * step + count * step) % count;
    const row = rows[index];
    if (isCopyableCopyCardRow(row)) {
      return row.id;
    }
  }
  return copyable[0].id;
}

function resolveCopyCardCopyAction(model, row) {
  if (!row) {
    return null;
  }
  if (isCopyableCopyCardRow(row)) {
    return copyCardKeyAction("copy", { rowId: row.id });
  }
  if (row.state === "unavailable") {
    return copyCardKeyAction("refuse", {
      rowId: row.id,
      reason: row.reason || "unavailable",
    });
  }
  return copyCardKeyAction("consume");
}

function resolveCopyCardKey(model, event, ui) {
  if (!model || !event) {
    return null;
  }
  const state = ui && typeof ui === "object" ? ui : {};
  const busy = state.busy === true;
  if (busy) {
    return copyCardKeyAction("consume");
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return null;
  }
  if (event.repeat === true) {
    return null;
  }
  const key = String(event.key || "");
  if (COPY_CARD_MODIFIER_KEYS.has(key)) {
    return null;
  }
  const modified =
    event.altKey === true ||
    event.ctrlKey === true ||
    event.metaKey === true ||
    event.shiftKey === true;
  if (key === "Escape") {
    if (modified) {
      return null;
    }
    return copyCardKeyAction("close");
  }
  if (COPY_CARD_CMD_Y_TWICE && isCopyCardModY(event, state.platform)) {
    const row =
      copyCardRowById(model, state.highlightId) ||
      copyCardRowById(model, model.defaultRowId);
    return resolveCopyCardCopyAction(model, row);
  }
  if (
    key === "ArrowDown" &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.ctrlKey
  ) {
    return copyCardKeyAction("move", {
      rowId: stepCopyCardHighlight(model, state.highlightId, 1),
    });
  }
  if (
    key === "ArrowUp" &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.ctrlKey
  ) {
    return copyCardKeyAction("move", {
      rowId: stepCopyCardHighlight(model, state.highlightId, -1),
    });
  }
  if (isCopyCardCtrlLetter(event, "n")) {
    return copyCardKeyAction("move", {
      rowId: stepCopyCardHighlight(model, state.highlightId, 1),
    });
  }
  if (isCopyCardCtrlLetter(event, "p")) {
    return copyCardKeyAction("move", {
      rowId: stepCopyCardHighlight(model, state.highlightId, -1),
    });
  }
  if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) {
    return null;
  }
  if (key === "Enter") {
    const row =
      copyCardRowById(model, state.highlightId) ||
      copyCardRowById(model, model.defaultRowId);
    return resolveCopyCardCopyAction(model, row);
  }
  if (event.shiftKey === true && /^[a-z]$/i.test(key)) {
    return null;
  }
  const bound = key.toLowerCase();
  if (!/^[a-z0-9]$/.test(bound)) {
    return null;
  }
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const matched = rows.find((row) => row.key === bound) || null;
  if (matched) {
    return resolveCopyCardCopyAction(model, matched);
  }
  if (COPY_CARD_RESERVED_KEYS.includes(bound)) {
    return copyCardKeyAction("consume");
  }
  return null;
}
