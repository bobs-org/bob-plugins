// Strict Ctrl modifier helpers for picker key handling. Split out of
// 470-keydown-and-freshness.js to keep that fragment at or under the
// 1000-line cap. All chords match Ctrl only, never Meta, so macOS ⌘B stays
// Bold. Callers (Ctrl+N/P/X/D/R, Ctrl+[, tie chords) share these guards.
function isCtrlLeftBracketKeydown(event) {
  return (
    Boolean(event) &&
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    event.shiftKey !== true &&
    (event.code === "BracketLeft" || event.key === "[")
  );
}

function isTaskCardCloseKeydown(event) {
  if (!event) {
    return false;
  }
  const key = String(event.key || "");
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  return (
    (key === "Escape" && !ctrl && !meta && !alt && !shift) ||
    (key.toLowerCase() === "q" && !ctrl && !meta && !alt) ||
    isCtrlLeftBracketKeydown(event)
  );
}

function isCtrlKey(event, key) {
  return (
    Boolean(event) &&
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    event.shiftKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === String(key).toLowerCase()
  );
}

function isCtrlShiftKey(event, key) {
  return (
    Boolean(event) &&
    event.ctrlKey === true &&
    event.shiftKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === String(key).toLowerCase()
  );
}
