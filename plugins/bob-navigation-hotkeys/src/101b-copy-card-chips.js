// The task's lines use the same ownership rule as findOwningTaskLine, but
// share one Markdown-context parse and memoize owner walks across the block.
function copyCardTaskScopeLines(lines, ownerLine) {
  try {
    const sourceLines = Array.isArray(lines)
      ? lines
      : String(lines || "").split(/\r?\n/);
    if (
      !Number.isInteger(ownerLine) ||
      ownerLine < 0 ||
      ownerLine >= sourceLines.length
    ) {
      return Object.freeze([]);
    }
    const content = sourceLines.join("\n");
    const contexts = getMarkdownLineContextsForLines(sourceLines);
    if (!isObsidianTaskAtLine(content, ownerLine, contexts, sourceLines)) {
      return Object.freeze([]);
    }
    const block = findCurrentBulletChildBlock(sourceLines, ownerLine);
    const ownerCache = new Map();
    const ownerFor = (line) => {
      let current = line;
      const path = [];
      let owner = null;
      while (Number.isInteger(current) && current >= 0 && current < sourceLines.length) {
        if (ownerCache.has(current)) {
          owner = ownerCache.get(current);
          break;
        }
        path.push(current);
        if (isObsidianTaskAtLine(content, current, contexts, sourceLines)) {
          owner = current;
          ownerCache.set(current, current);
          break;
        }
        const parent = findNearestParentListItem(sourceLines, current);
        if (parent === null || parent >= current) break;
        current = parent;
      }
      for (const visited of path) ownerCache.set(visited, owner);
      return owner;
    };
    const result = [ownerLine];
    for (let line = block.startLine; line < block.endLineExclusive; line += 1) {
      if (ownerFor(line) === ownerLine) result.push(line);
    }
    return Object.freeze(result);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Copy card's optional C row. The API result is a frozen v2 copy-chip
// selection; keep its literal payload and source coordinates for copying.
function buildCopyCardChipRow(spec, result) {
  const resolved = result && typeof result === "object" ? result : null;
  if (!resolved) {
    return null;
  }
  if (resolved.state === "ready") {
    const chip = resolved.chip && typeof resolved.chip === "object" ? resolved.chip : null;
    const text = chip && typeof chip.text === "string" ? chip.text : "";
    if (!chip || !/\S/.test(text)) {
      return null;
    }
    const rawLabel = typeof chip.label === "string" ? chip.label.trim() : "";
    const faceSource = rawLabel !== "" ? rawLabel : text;
    const face = copyCardMiddleTruncate(copyCardPreviewText(faceSource), 40);
    return buildCopyCardRow({
      id: spec.id,
      group: "chip",
      key: spec.key,
      label: `Chip · ${face}`,
      value: text,
      preview: copyCardPreviewText(text),
      state: "ready",
      reason: null,
      chipScope: resolved.scope === "task" ? "task" : "cursor",
      copyChip: chip,
    });
  }
  if (resolved.state === "ambiguous") {
    const count = Number.isInteger(resolved.count) ? resolved.count : 0;
    const where = resolved.scope === "task" ? "in this task" : "on this line";
    const reason = `${count} chips ${where} · move onto one`;
    return buildCopyCardRow({
      id: spec.id,
      group: "chip",
      key: spec.key,
      label: "Chip",
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  return null;
}
