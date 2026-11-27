const SECTION_MAP_FULL_ROWS = 12;
const SECTION_MAP_WINDOW_ROWS = 8;
const SECTION_MAP_MIN_OPACITY = 0.55;

function cleanSectionHeadingLabel(value) {
  let label = String(value || "");

  label = label.replace(/\s+#+[ \t]*$/, "");
  label = label.replace(/%%.*?%%/g, "");
  label = label.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, "");
  label = label.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  label = label.replace(/!\[\[([^\]]+)\]\]/g, (_match, body) => {
    const separator = body.indexOf("|");
    return separator < 0 ? "" : body.slice(separator + 1).trim();
  });
  label = label.replace(/\[\[([^\]]+)\]\]/g, (_match, body) => {
    const separator = body.indexOf("|");
    const target = (separator < 0 ? body : body.slice(0, separator)).trim();
    const alias = separator < 0 ? "" : body.slice(separator + 1).trim();
    return alias || target.replace(/\.md$/i, "");
  });
  label = label.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  label = label.replace(/(`+)(.+?)\1/g, "$2");
  label = label.replace(/\*\*(.+?)\*\*/g, "$1");
  label = label.replace(/(?<!\w)__(.+?)__(?!\w)/g, "$1");
  label = label.replace(/~~(.+?)~~/g, "$1");
  label = label.replace(/==(.+?)==/g, "$1");
  label = label.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  label = label.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  label = label.replace(/<\/?[A-Za-z][^>]*>/g, "");
  label = label.replace(/\s+/g, " ").trim();

  return label || "(untitled)";
}

function sectionMapCursorLine(value) {
  const line = Math.floor(numericOrDefault(value, Number.NaN));
  return Number.isFinite(line) ? line : null;
}

function sectionMapContainingIndex(headings, line) {
  if (line === null || !Array.isArray(headings) || headings.length === 0) {
    return -1;
  }

  let low = 0;
  let high = headings.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (headings[middle].line <= line) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function sectionMapTargetIsWrapped(headings, cursorLine, direction) {
  return direction > 0
    ? !headings.some((heading) => heading.line > cursorLine)
    : !headings.some((heading) => heading.line < cursorLine);
}

function sectionMapAncestorIndices(headings, currentIndex) {
  if (currentIndex < 0) {
    return [];
  }

  const ancestors = [];
  let depth = headings[currentIndex].depth;
  for (let index = currentIndex - 1; index >= 0 && depth > 0; index -= 1) {
    if (headings[index].depth < depth) {
      ancestors.push(index);
      depth = headings[index].depth;
    }
  }
  ancestors.reverse();
  if (ancestors.length <= 2) {
    return ancestors;
  }
  return [ancestors[0], ancestors[ancestors.length - 1]];
}

function sectionMapWindowBounds(total, currentIndex, direction, rowCount) {
  if (total <= 0 || rowCount <= 0) {
    return { start: 0, end: 0 };
  }
  if (currentIndex < 0) {
    return { start: 0, end: Math.min(total, rowCount) };
  }

  const rowsBefore = direction < 0 ? 5 : direction > 0 ? 2 : 3;
  const maxStart = Math.max(0, total - rowCount);
  const start = Math.max(0, Math.min(maxStart, currentIndex - rowsBefore));
  return { start, end: Math.min(total, start + rowCount) };
}

function sectionMapVisibleIndices(headings, currentIndex, options) {
  const requestedRows = Math.floor(numericOrDefault(options.maxRows, SECTION_MAP_FULL_ROWS));
  const maxRows = Math.max(1, requestedRows);
  const fullBudget = Math.min(SECTION_MAP_FULL_ROWS, maxRows);
  if (headings.length <= fullBudget) {
    return {
      full: true,
      start: 0,
      end: headings.length,
      indices: headings.map((_heading, index) => index),
    };
  }

  const rowCount = Math.min(SECTION_MAP_WINDOW_ROWS, maxRows, headings.length);
  const bounds = sectionMapWindowBounds(
    headings.length,
    currentIndex,
    options.direction,
    rowCount,
  );
  const indices = new Set();
  for (let index = bounds.start; index < bounds.end; index += 1) {
    indices.add(index);
  }

  const pins = new Set(sectionMapAncestorIndices(headings, currentIndex));
  for (const targetLine of [options.previousTargetLine, options.nextTargetLine]) {
    const targetIndex = headings.findIndex((heading) => heading.line === targetLine);
    if (targetIndex >= 0 && (targetIndex < bounds.start || targetIndex >= bounds.end)) {
      pins.add(targetIndex);
    }
  }
  for (const index of pins) {
    indices.add(index);
  }

  return {
    full: false,
    start: bounds.start,
    end: bounds.end,
    indices: [...indices].sort((left, right) => left - right),
  };
}

function sectionMapRows(headings, visibleIndices, currentIndex, fromIndex, chips) {
  const rows = [];
  const visible = new Set(visibleIndices);
  let index = 0;
  while (index < headings.length) {
    if (visible.has(index)) {
      const heading = headings[index];
      const distance = currentIndex < 0 ? null : Math.abs(index - currentIndex);
      const rowChips = chips.filter((chip) => chip.targetLine === heading.line);
      const emphasized = index === currentIndex || index === fromIndex || rowChips.length > 0;
      rows.push({
        type: "heading",
        key: heading.line,
        line: heading.line,
        level: heading.level,
        depth: heading.depth,
        label: heading.label,
        current: index === currentIndex,
        from: index === fromIndex && fromIndex !== currentIndex,
        chipTarget: rowChips.length > 0,
        distance,
        opacity: emphasized
          ? 1
          : Math.max(SECTION_MAP_MIN_OPACITY, 1 - (distance || 0) * 0.06),
        chips: rowChips,
      });
      index += 1;
      continue;
    }

    const firstHidden = index;
    while (index < headings.length && !visible.has(index)) {
      index += 1;
    }
    const lastHidden = index - 1;
    rows.push({
      type: "gap",
      key: `gap:${headings[firstHidden].line}:${headings[lastHidden].line}`,
      count: lastHidden - firstHidden + 1,
      beforeLine: firstHidden > 0 ? headings[firstHidden - 1].line : null,
      afterLine: index < headings.length ? headings[index].line : null,
    });
  }
  return rows;
}

function sectionMapAriaSentence(model) {
  if (model.total === 0) {
    return "No sections";
  }

  const parts = [];
  if (model.currentIndex >= 0) {
    parts.push(
      `Section ${model.currentIndex + 1} of ${model.total}, ${model.currentLabel}`,
    );
  } else {
    parts.push(`Section map, ${model.total} sections`);
  }
  if (model.wrapped) {
    parts.push("wrapped");
  }
  if (model.onlySection) {
    parts.push("only section");
  }
  if (model.next) {
    parts.push(`next ${model.next.label}`);
  }
  if (model.previous) {
    parts.push(`previous ${model.previous.label}`);
  }
  return parts.join("; ");
}

function buildSectionMapModel(lines, options = {}) {
  const headings = Array.isArray(options.headings)
    ? options.headings
    : getSectionHeadingEntries(lines);
  const cursorLine = sectionMapCursorLine(options.cursorLine);
  const fromLine = sectionMapCursorLine(options.fromLine);
  const direction = options.direction < 0 ? -1 : options.direction > 0 ? 1 : 0;
  const currentIndex = sectionMapContainingIndex(headings, cursorLine);
  const fromIndex = sectionMapContainingIndex(headings, fromLine);
  const previousTargetLine = cursorLine === null
    ? null
    : getSectionHeaderJumpLineFromEntries(headings, cursorLine, -1);
  const nextTargetLine = cursorLine === null
    ? null
    : getSectionHeaderJumpLineFromEntries(headings, cursorLine, 1);
  const chips = [];

  if (headings.length > 1 && cursorLine !== null) {
    for (const chipDirection of [-1, 1]) {
      const targetLine = chipDirection < 0 ? previousTargetLine : nextTargetLine;
      if (targetLine === null || targetLine === cursorLine) {
        continue;
      }
      chips.push({
        direction: chipDirection,
        shortcut: chipDirection < 0 ? "⌃K" : "⌃J",
        targetLine,
        wrapped: sectionMapTargetIsWrapped(headings, cursorLine, chipDirection),
      });
    }
  }

  const wrapped = headings.length > 1 && Boolean(options.wrapped);
  const window = sectionMapVisibleIndices(headings, currentIndex, {
    maxRows: options.maxRows,
    direction,
    previousTargetLine,
    nextTargetLine,
  });
  const rows = sectionMapRows(
    headings,
    window.indices,
    currentIndex,
    fromIndex,
    chips,
  );
  const current = currentIndex >= 0 ? headings[currentIndex] : null;
  const next = headings.length <= 1 || nextTargetLine === null
    ? null
    : headings.find((heading) => heading.line === nextTargetLine) || null;
  const previous = headings.length <= 1 || previousTargetLine === null
    ? null
    : headings.find((heading) => heading.line === previousTargetLine) || null;
  const model = {
    visible: headings.length > 0,
    rows,
    headings,
    total: headings.length,
    currentIndex,
    currentLine: current ? current.line : null,
    currentLabel: current ? current.label : null,
    fromLine: fromIndex >= 0 ? headings[fromIndex].line : null,
    wrapped,
    onlySection: headings.length === 1,
    counter: `${current ? currentIndex + 1 : "–"} / ${headings.length}`,
    next: next ? { line: next.line, label: next.label } : null,
    previous: previous ? { line: previous.line, label: previous.label } : null,
    chips,
    windowed: !window.full,
    window: {
      start: window.start,
      end: window.end,
      visibleLines: window.indices.map((index) => headings[index].line),
    },
  };
  model.ariaSentence = sectionMapAriaSentence(model);
  return model;
}
