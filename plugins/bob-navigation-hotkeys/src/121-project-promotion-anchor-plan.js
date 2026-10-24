function rebaseProjectPromotionAnchorPlan(seedContent, currentContent, promotionPlan) {
  const seedLines = splitMarkdownContent(String(seedContent || "")).lines;
  const current = splitMarkdownContent(String(currentContent || ""));
  const currentLines = current.lines.slice();
  const plannedTargets = Array.isArray(promotionPlan && promotionPlan.targets)
    ? promotionPlan.targets
    : [];
  const groups = new Map();

  for (const target of plannedTargets) {
    const seedLine = Number.isInteger(target && target.line)
      ? String(seedLines[target.line] || "")
      : "";
    if (!seedLine) {
      return Object.freeze({
        ok: false,
        content: null,
        targets: Object.freeze([]),
      });
    }
    if (getTrailingBlockId(seedLine)) {
      continue;
    }
    if (!groups.has(seedLine)) {
      groups.set(seedLine, []);
    }
    groups.get(seedLine).push(target);
  }

  if (groups.size === 0) {
    return Object.freeze({
      ok: true,
      content: String(currentContent || ""),
      targets: Object.freeze(plannedTargets.slice()),
    });
  }

  const contexts = getMarkdownLineContexts(String(currentContent || ""));
  const isProjectTaskLine = (index) => {
    const context = contexts[index];
    const line = String(currentLines[index] || "");
    return !(
      (context && (context.inFrontmatter || context.inFence)) ||
      !OBSIDIAN_TASK_LINE_RE.test(line) ||
      !isObsidianTaskLine(line) ||
      isProjectLifecycleTaskLine(line) ||
      line.includes(PROJECT_TASKS_PLACEHOLDER)
    );
  };
  const targetLines = new Map();

  for (const [seedLine, targets] of groups) {
    const targetByAnchoredLine = new Map(
      targets.map((target) => [
        appendBlockIdToLine(seedLine, target.blockId),
        target,
      ]),
    );
    const candidates = [];
    for (let index = 0; index < currentLines.length; index += 1) {
      if (!isProjectTaskLine(index)) {
        continue;
      }
      const line = String(currentLines[index] || "");
      if (line === seedLine || targetByAnchoredLine.has(line)) {
        candidates.push(index);
      }
    }
    if (candidates.length !== targets.length) {
      return Object.freeze({
        ok: false,
        content: null,
        targets: Object.freeze([]),
      });
    }

    const assigned = new Set();
    for (const index of candidates) {
      const target = targetByAnchoredLine.get(String(currentLines[index] || ""));
      if (!target) {
        continue;
      }
      if (assigned.has(target)) {
        return Object.freeze({
          ok: false,
          content: null,
          targets: Object.freeze([]),
        });
      }
      assigned.add(target);
      targetLines.set(index, target);
    }

    const remainingTargets = targets.filter((target) => !assigned.has(target));
    const remainingLines = candidates.filter((index) => !targetLines.has(index));
    if (remainingTargets.length !== remainingLines.length) {
      return Object.freeze({
        ok: false,
        content: null,
        targets: Object.freeze([]),
      });
    }
    remainingLines.forEach((index, offset) => {
      targetLines.set(index, remainingTargets[offset]);
    });
  }

  for (const [index, target] of targetLines) {
    const otherLines = currentLines.filter((_line, otherIndex) => otherIndex !== index);
    if (blockIdExistsInContent(otherLines.join(current.lineEnding), target.blockId)) {
      return Object.freeze({
        ok: false,
        content: null,
        targets: Object.freeze([]),
      });
    }
  }

  for (const [index, target] of targetLines) {
    const line = String(currentLines[index] || "");
    if (!getTrailingBlockId(line)) {
      currentLines[index] = appendBlockIdToLine(line, target.blockId);
    }
  }

  return Object.freeze({
    ok: true,
    content: currentLines.join(current.lineEnding),
    targets: Object.freeze(plannedTargets.slice()),
  });
}
