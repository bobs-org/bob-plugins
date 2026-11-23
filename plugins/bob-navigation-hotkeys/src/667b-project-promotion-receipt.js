// Promotion receipt and empty-Tasks helpers (bob-cli-on.12).
// New fragment so `667-plugin-project-promotion.js` stays under its line cap.

function removeProjectTasksPlaceholderLine(content) {
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const headerIndex = findProjectTasksHeaderIndex(lines);
  if (headerIndex === -1) {
    return Object.freeze({ content: text, removed: false });
  }
  let sectionEnd = lines.length;
  let inFence = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }
    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }
    if (SECTION_HEADER_RE.test(line)) {
      sectionEnd = index;
      break;
    }
  }
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    const line = String(lines[index] || "");
    if (PROJECT_SOURCE_TASK_LINE_RE.test(line) && line.includes(PROJECT_TASKS_PLACEHOLDER)) {
      const nextLines = lines.slice(0, index).concat(lines.slice(index + 1));
      // Collapse a leftover blank run so an empty ## Tasks stays empty.
      const cleaned = [];
      let previousBlank = false;
      for (const next of nextLines) {
        const blank = String(next || "").trim() === "";
        if (blank && previousBlank) {
          continue;
        }
        // Drop a single blank directly after the Tasks header when the
        // section is now empty.
        previousBlank = blank;
        cleaned.push(next);
      }
      return Object.freeze({ content: cleaned.join(lineEnding), removed: true });
    }
  }
  return Object.freeze({ content: text, removed: false });
}

function buildProjectPromotionNoticeWithReceipt(baseNotice, sourceDescription, conversion) {
  const counts = projectSeedPromotionCounts(conversion);
  const receipt = getProjectPromotionReceiptText(sourceDescription, counts.taskCount, counts.noteCount);
  let notice = String(baseNotice || "");
  if (notice) {
    notice += `\n${receipt}`;
  } else {
    notice = receipt;
  }
  if (counts.taskCount === 0) {
    notice += `\n${PROJECT_PROMOTION_NO_REQS_NOTICE}`;
  }
  return Object.freeze({ notice, taskCount: counts.taskCount, noteCount: counts.noteCount });
}
