// Task relations are separate from Pomodoro Task Links. This shape recogniser
// includes empty and malformed lines so link-open, cleanup, and deletion paths
// cannot consume a relation while it is being repaired.
const TASK_RELATION_LINE_RE =
  /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:(?:🪢|🔗)[ \t]+)?\*\*(?:LINKS|LINKS TO|LINKED FROM|BACKLINKS):\*\*/u;
const TASK_LINKS_LINE_NOTICE =
  "🪢 LINKS entries are relations, not Task Links · edit them with Ctrl+Shift+L";
const TASK_LINKED_FROM_LINE_NOTICE =
  "🪢 LINKED FROM is generated from other tasks' LINKS lines and text · change it with Ctrl+Shift+Alt+L";

function isTaskRelationLine(lineText, options = {}) {
  const line = String(lineText || "");
  if (
    /^[ \t]*>/.test(line) ||
    options.inFence === true ||
    options.isDirectChildOfTask === false
  ) {
    return false;
  }
  return TASK_RELATION_LINE_RE.test(line);
}

function isTaskLinkedFromLine(lineText, options = {}) {
  const line = String(lineText || "");
  return (
    isTaskRelationLine(line, options) &&
    /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:(?:🪢|🔗)[ \t]+)?\*\*(?:LINKED FROM|BACKLINKS):\*\*/u.test(line)
  );
}

function taskRelationLineNotice(lineText) {
  return isTaskLinkedFromLine(lineText)
    ? TASK_LINKED_FROM_LINE_NOTICE
    : TASK_LINKS_LINE_NOTICE;
}

function isTaskLinkExclusionLine(lineText) {
  return isManagedDependencyLine(lineText) || isTaskRelationLine(lineText);
}
