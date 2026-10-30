// Counts reach sibling items, not physical lines. Children travel with their
// item; loose continuations and blank separators do not spend the count.
function collectObsidianTaskToggleRangeItems(lines, activeLine, additionalItems) {
  const firstBlock = getListItemBlockRange(lines, activeLine);
  if (!firstBlock || !LIST_ITEM_MARKER_RE.test(String(lines[activeLine] || ""))) {
    return [];
  }

  const prefixPattern = /^[ \t]*(?:>[ \t]*)*/;
  const prefix = String(lines[activeLine]).match(prefixPattern)[0];
  const additional = Number.isInteger(additionalItems) && additionalItems > 0
    ? additionalItems
    : 0;
  const items = [{ line: activeLine, block: firstBlock }];
  let line = firstBlock.endLine + 1;

  while (line < lines.length && items.length <= additional) {
    const lineText = String(lines[line] || "");
    if (parseMarkdownHeadingLine(lineText)) {
      break;
    }
    if (lineText.trim() === "") {
      line += 1;
      continue;
    }

    const nextPrefix = lineText.match(prefixPattern)[0];
    if (nextPrefix.length > prefix.length) {
      line += 1;
      continue;
    }
    if (nextPrefix !== prefix || !LIST_ITEM_MARKER_RE.test(lineText)) {
      break;
    }

    const block = getListItemBlockRange(lines, line);
    items.push({ line, block });
    line = block.endLine + 1;
  }

  return items;
}

function getObsidianTaskToggleRangeDocumentPlan(
  lines,
  activeLine,
  cursorCh,
  createdDateString,
  additionalItems,
) {
  const single = getObsidianTaskToggleDocumentPlan(
    lines, activeLine, cursorCh, createdDateString,
  );
  if (!single || single.mode === "refuse" || !Number.isInteger(additionalItems) || additionalItems <= 0) {
    return single;
  }

  const demoting = isProperObsidianTaskLine(lines[activeLine]);
  const selected = collectObsidianTaskToggleRangeItems(
    lines, activeLine, additionalItems,
  ).filter(({ line }) =>
    isProperObsidianTaskLine(lines[line]) === demoting &&
    (single.mode === "replace" || isTopLevelDashListToggleLine(lines[line])),
  );
  if (selected.length <= 1) {
    return single;
  }

  const items = selected.map(({ line }) => ({
    line,
    sourceLineText: String(lines[line]),
    lineText: getObsidianTaskToggle(lines[line], createdDateString).lineText,
  }));
  const nextLines = lines.slice();
  for (const item of items) {
    nextLines[item.line] = item.lineText;
  }
  const replacePlan = {
    mode: "replaceLines",
    nextLines,
    cursorLine: activeLine,
    cursorCh: single.cursorCh,
  };
  if (single.mode === "replace") {
    return replacePlan;
  }

  const sourceBlocks = selected.map(({ block }) => block);
  const movedBlock = selected.flatMap(({ line, block }, index) => [
    items[index].lineText,
    ...lines.slice(line + 1, block.endLine + 1),
  ]);
  if (single.mode === "prompt") {
    const previewLines = items.map((item) =>
      demoting ? item.lineText : item.sourceLineText,
    );
    return {
      ...single,
      sourceBlocks,
      items,
      movedBlock,
      originalMovedBlock: sourceBlocks.flatMap((block) =>
        lines.slice(block.startLine, block.endLine + 1),
      ),
      itemCount: items.length,
      previewLines,
      previewText: previewLines.join("\n"),
    };
  }

  const state = createLineRemovalState(lines);
  for (const block of sourceBlocks.slice().reverse()) {
    removeSourceListItemBlockFromState(state, block);
  }
  const remaining = state.lines;
  const nextSection = findNextMarkdownSection(remaining, sourceBlocks[0].startLine);
  if (!nextSection) {
    return replacePlan;
  }
  if (blocksTaskMoveIntoPomodoros(items.map((item) => item.sourceLineText), nextSection)) {
    return { mode: "refuse", message: POMODOROS_TASK_MOVE_NOTICE };
  }
  return buildObsidianTaskSectionMovePlan(
    remaining,
    getNextSectionBulletInsertion(remaining, nextSection),
    movedBlock,
    single.sourceLineText,
    single.lineText,
    single.cursorCh,
    "nextSection",
    documentHasFinalNewline(lines),
  ) || replacePlan;
}
