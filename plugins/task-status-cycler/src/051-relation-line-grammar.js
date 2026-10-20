// Shape-only relation recogniser for inert LINKS and generated LINKED FROM
// children. The source/target meaning is deliberately separate from the two
// cycler uses below: relations never enter Pomodoro Task Link scanners, but
// Ctrl+Enter and Alt+] may act on a selected relation target root-only.
const TASK_RELATION_LINE_RE =
  /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:(?:🪢|🔗)[ \t]+)?\*\*(?:LINKS|LINKS TO|LINKED FROM|BACKLINKS):\*\*/u;

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

// Used only by Pomodoro / successor collection: any recognized dependency,
// BLOCKS, or relation line is not a Task Link source.
function isTaskLinkExclusionLine(lineText) {
  return isManagedDependencyLine(lineText) || isTaskRelationLine(lineText);
}

// Used only by Ctrl+Enter and Alt+]/Alt+[: the same line families get the
// root-only link gesture and never strike, embed, tree-close, or reformat.
function isTaskLinkGestureLine(lineText) {
  return isManagedDependencyLine(lineText) || isTaskRelationLine(lineText);
}
