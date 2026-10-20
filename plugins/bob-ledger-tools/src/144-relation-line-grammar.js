// Task relation rows are inert metadata, never Pomodoro Task Links or plan
// budget items. Recognize empty and malformed shapes too, so their wikilinks
// cannot leak into `maxLinks` accounting while a line is being repaired.
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
