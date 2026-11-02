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

  const fenced = getFencedLineNumbers(lines);
  let firstOpenLine = null;
  let lastOpenLine = null;
  for (let line = closedLine + 1; line <= section.endLine; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
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

  // Rust `capture_pomodoros::pomodoro_block_range` keeps interior blanks and
  // nested children verbatim but trims trailing blank lines. The shared
  // `getFullPomodoroEntryEndLine` owns the full fence-aware block elsewhere,
  // so trim locally for the new MEET anchor only.
  const fullEndLine = getFullPomodoroEntryEndLine(lines, lastOpenLine, section);
  let anchorEndLine = fullEndLine;
  while (
    anchorEndLine > lastOpenLine &&
    !String(lines[anchorEndLine] || "").trim()
  ) {
    anchorEndLine -= 1;
  }
  return {
    insertLine: anchorEndLine + 1,
    placedLast: true,
    firstOpenLine,
  };
}
