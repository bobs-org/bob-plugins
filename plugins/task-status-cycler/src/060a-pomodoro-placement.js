function getPomodoroContinuationPlacement(
  lines,
  section,
  closedLine,
  closedEndLine,
  continuationName,
) {
  const immediateInsertLine = closedEndLine + 1;
  const normalizedName = String(continuationName || "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (normalizedName !== "meet" || !section) {
    return { insertLine: immediateInsertLine, placedLast: false, firstOpenLine: null };
  }

  let firstOpenLine = null;
  let lastOpenLine = null;
  for (let line = closedLine + 1; line <= section.endLine; line += 1) {
    if (!isPomodoroTaskLine(lines, section, line)) {
      continue;
    }
    if (!parsePomodoroEntryLineParts(lines[line])) {
      continue;
    }
    const status = getTaskStatusForLine(lines[line], line);
    if (!status || status.symbol !== " ") {
      continue;
    }
    if (firstOpenLine == null) {
      firstOpenLine = line;
    }
    lastOpenLine = line;
  }
  if (lastOpenLine == null) {
    return { insertLine: immediateInsertLine, placedLast: false, firstOpenLine: null };
  }

  return {
    insertLine: getFullPomodoroEntryEndLine(lines, lastOpenLine, section) + 1,
    placedLast: true,
    firstOpenLine,
  };
}
