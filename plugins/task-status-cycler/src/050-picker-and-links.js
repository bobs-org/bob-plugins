function fuzzyMatchesText(source, query) {
  const haystack = String(source || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if (!needle) {
    return true;
  }

  let haystackIndex = 0;
  for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
    haystackIndex = haystack.indexOf(needle[needleIndex], haystackIndex);
    if (haystackIndex === -1) {
      return false;
    }
    haystackIndex += 1;
  }

  return true;
}

function getDemotionEffectiveTitle(query) {
  const trimmed = String(query || "").trim();
  return trimmed || TASK_ROUTING_SECTION_TITLES.requirements;
}

function getDemotionPrimaryAction(query, headings, promptKind = TASK_SECTION_PROMPT_KIND.demotion) {
  const trimmed = String(query || "").trim();
  const selectable = Array.isArray(headings) ? headings : [];
  if (!trimmed) {
    if (selectable.length > 0) {
      return null;
    }
    if (promptKind === TASK_SECTION_PROMPT_KIND.promotion) {
      return null;
    }
    return {
      kind: "create",
      title: TASK_ROUTING_SECTION_TITLES.requirements,
      heading: null,
      statusText: `Create ## ${TASK_ROUTING_SECTION_TITLES.requirements}`,
    };
  }

  const normalized = normalizeHeadingTitle(trimmed);
  const hasExactMatch = selectable.some(
    (heading) => normalizeHeadingTitle(heading.title) === normalized,
  );
  if (hasExactMatch) {
    return null;
  }

  if (
    promptKind === TASK_SECTION_PROMPT_KIND.demotion &&
    isTasksHeadingTitle(trimmed)
  ) {
    return {
      kind: "invalid",
      title: trimmed,
      heading: null,
      statusText: TASKS_DESTINATION_REJECTION,
    };
  }

  return {
    kind: "create",
    title: trimmed,
    heading: null,
    statusText: `Create ## ${trimmed}`,
  };
}

function filterSelectableDemotionHeadings(headings, query) {
  const needle = String(query || "").trim();
  const selectable = Array.isArray(headings) ? headings : [];
  if (!needle) {
    return selectable.slice();
  }

  return selectable.filter((heading) => fuzzyMatchesText(heading.title, needle));
}

function demotionHeadingRow(heading) {
  return {
    type: "existing",
    heading,
    title: heading.title,
    meta: getDemotionHeadingMeta(heading),
    badge: "Existing section",
  };
}

function demotionCreateRow(title) {
  return {
    type: "primary",
    primary: {
      kind: "create",
      title,
      heading: null,
      statusText: `Create ## ${title}`,
    },
    title,
    meta: "New H2 at the bottom of the note",
    badge: "Create section",
  };
}

function demotionInvalidRow(title) {
  return {
    type: "primary",
    primary: {
      kind: "invalid",
      title,
      heading: null,
      statusText: TASKS_DESTINATION_REJECTION,
    },
    title,
    meta: TASKS_DESTINATION_REJECTION,
    badge: "Invalid",
  };
}

function getDemotionSectionPickerRows(
  headings,
  query,
  promptKind = TASK_SECTION_PROMPT_KIND.demotion,
) {
  const selectable = Array.isArray(headings) ? headings : [];
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    if (selectable.length > 0) {
      return selectable.map(demotionHeadingRow);
    }
    if (promptKind === TASK_SECTION_PROMPT_KIND.promotion) {
      return [];
    }
    return [demotionCreateRow(TASK_ROUTING_SECTION_TITLES.requirements)];
  }

  const normalized = normalizeHeadingTitle(trimmed);
  const exactHeadings = selectable.filter(
    (heading) => normalizeHeadingTitle(heading.title) === normalized,
  );
  const fuzzyHeadings = selectable.filter(
    (heading) =>
      normalizeHeadingTitle(heading.title) !== normalized &&
      fuzzyMatchesText(heading.title, trimmed),
  );

  if (exactHeadings.length > 0) {
    return [
      ...exactHeadings.map(demotionHeadingRow),
      ...fuzzyHeadings.map(demotionHeadingRow),
    ];
  }

  const actionRow =
    promptKind === TASK_SECTION_PROMPT_KIND.demotion && isTasksHeadingTitle(trimmed)
    ? demotionInvalidRow(trimmed)
    : demotionCreateRow(trimmed);
  return [actionRow, ...fuzzyHeadings.map(demotionHeadingRow)];
}

function getDemotionSectionPickerStatusText(row) {
  if (!row) {
    return "Type a new section name.";
  }
  if (row.type === "primary" && row.primary && row.primary.statusText) {
    return row.primary.statusText;
  }
  if (row.type === "existing" && row.title) {
    return `Move to existing ${row.title}`;
  }
  return "";
}

function clampDemotionPickerSelectedIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) {
    return 0;
  }

  const selected = Number.isInteger(index) ? index : 0;
  return Math.min(Math.max(selected, 0), length - 1);
}

function createDemotionSectionPickerState(
  headings,
  query = "",
  promptKind = TASK_SECTION_PROMPT_KIND.demotion,
) {
  return {
    headings: Array.isArray(headings) ? headings.slice() : [],
    query: String(query || ""),
    selectedIndex: 0,
    promptKind:
      promptKind === TASK_SECTION_PROMPT_KIND.promotion
        ? TASK_SECTION_PROMPT_KIND.promotion
        : TASK_SECTION_PROMPT_KIND.demotion,
  };
}

function setDemotionPickerQuery(state, query) {
  return {
    headings: state && Array.isArray(state.headings) ? state.headings.slice() : [],
    query: String(query || ""),
    selectedIndex: 0,
    promptKind:
      state && state.promptKind === TASK_SECTION_PROMPT_KIND.promotion
        ? TASK_SECTION_PROMPT_KIND.promotion
        : TASK_SECTION_PROMPT_KIND.demotion,
  };
}

function getDemotionSectionPickerRowClasses(row, isSelected) {
  const classes = ["tsc-sdp-row"];
  if (isSelected) {
    classes.push("is-selected");
  }
  if (row && row.type === "primary") {
    classes.push("is-primary");
    if (row.primary && row.primary.kind) {
      classes.push(`is-${row.primary.kind}`);
    }
  } else {
    classes.push("is-existing");
  }
  return classes;
}

function getDemotionHeadingMeta(heading) {
  if (!heading || !Number.isInteger(heading.line) || !Number.isInteger(heading.depth)) {
    return "";
  }

  return `H${heading.depth} · line ${heading.line + 1}`;
}

function getDemotionSectionPickerModel(state) {
  const headings = state && Array.isArray(state.headings) ? state.headings : [];
  const query = state ? String(state.query || "") : "";
  const promptKind =
    state && state.promptKind === TASK_SECTION_PROMPT_KIND.promotion
      ? TASK_SECTION_PROMPT_KIND.promotion
      : TASK_SECTION_PROMPT_KIND.demotion;
  const trimmedQuery = query.trim();
  const rows = getDemotionSectionPickerRows(headings, query, promptKind);
  const filteredHeadings = rows
    .filter((row) => row && row.type === "existing" && row.heading)
    .map((row) => row.heading);
  const selectedIndex = clampDemotionPickerSelectedIndex(
    state && state.selectedIndex,
    rows.length,
  );
  const selectedRow = rows[selectedIndex] || null;
  const selectedDestination = getDemotionDestinationFromRow(selectedRow);
  const canSubmit = Boolean(selectedDestination);
  const primary =
    rows.find((row) => row && row.type === "primary" && row.primary) || null;
  const selectedPrimary =
    selectedRow && selectedRow.type === "primary" ? selectedRow.primary : null;
  const tasksOnlyDefault =
    promptKind === TASK_SECTION_PROMPT_KIND.demotion &&
    !trimmedQuery &&
    headings.length === 0;

  return {
    query,
    primary: primary ? primary.primary : null,
    filteredHeadings,
    rows,
    selectedIndex,
    selectedRow,
    canSubmit,
    statusText: getDemotionSectionPickerStatusText(selectedRow),
    emptyExisting: trimmedQuery && filteredHeadings.length === 0,
    emptyText:
      !trimmedQuery && headings.length === 0
        ? "No other sections in this note"
        : "No matching sections",
    inputPlaceholder: tasksOnlyDefault
      ? DEMOTION_PICKER_TASKS_ONLY_PLACEHOLDER
      : DEMOTION_PICKER_EXISTING_PLACEHOLDER,
    selectedPrimary,
  };
}

function moveDemotionPickerSelection(state, delta) {
  const current = state || createDemotionSectionPickerState([]);
  const model = getDemotionSectionPickerModel(current);
  const length = model.rows.length;
  if (length === 0) {
    return {
      headings: current.headings.slice(),
      query: current.query,
      selectedIndex: 0,
      promptKind: current.promptKind,
    };
  }

  const step = Number.isInteger(delta) ? delta : 0;
  const nextIndex = (model.selectedIndex + step % length + length) % length;
  return {
    headings: current.headings.slice(),
    query: current.query,
    selectedIndex: nextIndex,
    promptKind: current.promptKind,
  };
}

function getDemotionDestinationFromRow(row) {
  if (!row) {
    return null;
  }

  if (row.type === "primary") {
    const primary = row.primary;
    if (!primary || primary.kind === "invalid") {
      return null;
    }
    if (primary.kind === "existing") {
      return { kind: "existing", heading: primary.heading };
    }
    return { kind: "create", title: primary.title };
  }

  if (row.type === "existing" && row.heading) {
    return { kind: "existing", heading: row.heading };
  }

  return null;
}

function getDemotionDestinationFromSelectedRow(model) {
  if (!model || !model.canSubmit) {
    return null;
  }

  return getDemotionDestinationFromRow(model.selectedRow);
}

function getListItemBlockRange(lines, activeLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const activeIndent = getLineIndentation(lines[activeLine]).length;
  let endLine = activeLine;

  for (let line = activeLine + 1; line < lines.length; line += 1) {
    const lineText = String(lines[line] || "");
    if (lineText.trim() === "") {
      break;
    }
    if (parseMarkdownHeadingLine(lineText)) {
      break;
    }
    if (getLineIndentation(lineText).length <= activeIndent) {
      break;
    }

    endLine = line;
  }

  return { startLine: activeLine, endLine };
}

// Collect embedded block transclusions (`![[note#^id]]`, `![[#^id]]`) found on
// the descendant list-item lines of a resolved task's list-item block. The task
// line itself (range.startLine) is excluded so this returns the task's children,
// which is what recursive Pomodoro closure follows. Same-file `![[#^id]]` child
// links carry an empty pathPart and are resolved by the caller against the
// source file they were found in.
function collectEmbeddedTranscludedTaskTargetsInListItemBlock(sourceText, taskLine) {
  const lines = splitTextByLineEndings(sourceText).map((line) => line.text);
  const range = getListItemBlockRange(lines, taskLine);
  if (!range) {
    return [];
  }

  const targets = [];
  for (let line = range.startLine + 1; line <= range.endLine; line += 1) {
    // Depends-On lines hold the dependent's prerequisites, which closing the
    // dependent must never close.
    if (isTaskDependencyLine(lines[line])) {
      continue;
    }
    for (const target of parseEmbeddedBlockTransclusions(lines[line])) {
      targets.push(target);
    }
  }

  return targets;
}

function getLineArrayReplacement(oldLines, newLines) {
  const before = Array.isArray(oldLines) ? oldLines : [];
  const after = Array.isArray(newLines) ? newLines : [];
  const beforeLength = before.length;
  const afterLength = after.length;

  let prefix = 0;
  const maxPrefix = Math.min(beforeLength, afterLength);
  while (prefix < maxPrefix && String(before[prefix]) === String(after[prefix])) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(beforeLength, afterLength) - prefix;
  while (
    suffix < maxSuffix &&
    String(before[beforeLength - 1 - suffix]) ===
      String(after[afterLength - 1 - suffix])
  ) {
    suffix += 1;
  }

  const removedEndExclusive = beforeLength - suffix;
  const insertEndExclusive = afterLength - suffix;
  if (prefix === removedEndExclusive && prefix === insertEndExclusive) {
    return null;
  }

  return {
    startLine: prefix,
    removedEndExclusive,
    lines: after.slice(prefix, insertEndExclusive),
  };
}

function getObsidianTaskToggleDocumentPlan(
  lines,
  activeLine,
  cursorCh,
  createdDateString,
) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const sourceLineText = String(lines[activeLine] || "");
  const toggle = getObsidianTaskToggle(sourceLineText, createdDateString);
  if (!toggle) {
    return null;
  }

  const finalCursorCh = getObsidianTaskToggleCursorCh(cursorCh, toggle);
  const demoting = isProperObsidianTaskLine(sourceLineText);

  const inPlacePlan = {
    mode: "replace",
    line: activeLine,
    sourceLineText,
    lineText: toggle.lineText,
    cursorLine: activeLine,
    cursorCh: finalCursorCh,
    targetSection: null,
  };

  if (!isTopLevelDashListToggleLine(sourceLineText)) {
    return inPlacePlan;
  }

  const block = getListItemBlockRange(lines, activeLine);
  if (!block) {
    return inPlacePlan;
  }

  const movedBlock = [
    toggle.lineText,
    ...lines.slice(activeLine + 1, block.endLine + 1),
  ];
  const originalMovedBlock = [
    sourceLineText,
    ...lines.slice(activeLine + 1, block.endLine + 1),
  ];
  const sourceBlock = { startLine: block.startLine, endLine: block.endLine };
  const sourceHeading = findOwningMarkdownHeadingIdentity(lines, activeLine);

  if (demoting && isEligibleTasksSectionDemotion(lines, activeLine, sourceLineText)) {
    return {
      mode: "prompt",
      promptKind: TASK_SECTION_PROMPT_KIND.demotion,
      sourceLines: lines.slice(),
      sourceLine: activeLine,
      sourceLineText,
      lineText: toggle.lineText,
      cursorLine: activeLine,
      cursorCh: finalCursorCh,
      originalCursorCh: cursorCh,
      sourceBlock,
      sourceHeading,
      movedBlock,
      originalMovedBlock,
      headings: collectSelectableDemotionHeadings(lines),
      previewText: toggle.lineText,
      targetSection: null,
    };
  }

  // Promotion always prompts when an exact Tasks section exists, including
  // preamble / Tasks-only notes and bullets already in the Tasks body.
  // Demotion outside the Tasks body still routes to the next section.
  if (!demoting) {
    if (!findNamedMarkdownSection(lines, TASK_ROUTING_SECTION_TITLES.tasks)) {
      return inPlacePlan;
    }

    return {
      mode: "prompt",
      promptKind: TASK_SECTION_PROMPT_KIND.promotion,
      sourceLines: lines.slice(),
      sourceLine: activeLine,
      sourceLineText,
      lineText: toggle.lineText,
      cursorLine: activeLine,
      cursorCh: finalCursorCh,
      originalCursorCh: cursorCh,
      sourceBlock,
      sourceHeading,
      movedBlock,
      originalMovedBlock,
      headings: collectSelectablePromotionHeadings(lines, sourceHeading),
      previewText: sourceLineText,
      targetSection: null,
    };
  }

  const removal = removeSourceListItemBlock(lines, block);
  if (!removal) {
    return inPlacePlan;
  }

  const { remaining } = removal;
  const nextSection = findNextMarkdownSection(remaining, block.startLine);
  if (!nextSection) {
    return inPlacePlan;
  }

  return (
    buildObsidianTaskSectionMovePlan(
      remaining,
      getNextSectionBulletInsertion(remaining, nextSection),
      movedBlock,
      sourceLineText,
      toggle.lineText,
      finalCursorCh,
      "nextSection",
      documentHasFinalNewline(lines),
    ) || inPlacePlan
  );
}

function addOrReplaceCompletionField(lineText, completionDateString) {
  const completionField = `[completion:: ${completionDateString}]`;
  const lineWithoutCompletion = removeCompletionField(lineText);
  const blockIdMatch = lineWithoutCompletion.match(TRAILING_BLOCK_ID_RE);

  if (!blockIdMatch) {
    return `${lineWithoutCompletion}  ${completionField}`;
  }

  const beforeBlockId = lineWithoutCompletion
    .slice(0, blockIdMatch.index)
    .replace(/[ \t]+$/, "");
  return `${beforeBlockId}  ${completionField} ${blockIdMatch[0].trim()}`;
}

function rewriteTaskLineForLocalFallback(
  lineText,
  nextSymbol,
  completionDateString,
  options = {},
) {
  const lineWithNextSymbol = replaceTaskStatusSymbol(lineText, nextSymbol);

  let rewritten;
  if (nextSymbol === "x") {
    rewritten = addOrReplaceCompletionField(lineWithNextSymbol, completionDateString);
  } else if (nextSymbol === " " || nextSymbol === "/") {
    rewritten = removeCompletionField(lineWithNextSymbol);
  } else {
    rewritten = lineWithNextSymbol;
  }

  // Freshness is the last transformation of the line. The stamper itself
  // refuses closed and recurring lines, so closing never stamps.
  const stamper = resolveFreshStamper(options);
  if (!stamper) {
    return rewritten;
  }
  return applyFreshStampLine(rewritten, stamper, options.freshDateText);
}

function lineMatchesTasksGlobalFilterText(lineText) {
  const escapedFilter = TASKS_GLOBAL_FILTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(
    `(^|[^A-Za-z0-9_/#-])${escapedFilter}(?=$|/|[^A-Za-z0-9_-])`,
  );
  return tagPattern.test(String(lineText || ""));
}

function rewriteTaskLineForTranscludedSource(
  lineText,
  nextSymbol,
  completionDateString,
  options = {},
) {
  if (lineMatchesTasksGlobalFilterText(lineText)) {
    return rewriteTaskLineForLocalFallback(
      lineText,
      nextSymbol,
      completionDateString,
      options,
    );
  }

  const rewritten = replaceTaskStatusSymbol(lineText, nextSymbol);
  // Freshness is the last transformation of the line (see above).
  const stamper = resolveFreshStamper(options);
  if (!stamper) {
    return rewritten;
  }
  return applyFreshStampLine(rewritten, stamper, options.freshDateText);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (error) {
    return value;
  }
}

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  if (text.length < 2) {
    return text;
  }

  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function normalizeTranscludedLinkTarget(value) {
  let target = stripWrappingQuotes(String(value || "").trim());
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  return safeDecodeUri(target);
}

function stripMarkdownExtensionFromPathPart(pathPart) {
  return String(pathPart || "").replace(MARKDOWN_EXTENSION_RE, "");
}

function parseTranscludedBlockTarget(rawTarget) {
  const target = normalizeTranscludedLinkTarget(rawTarget);
  const blockMarkerIndex = target.indexOf("#^");

  if (blockMarkerIndex === -1) {
    return null;
  }

  const rawPathPart = target.slice(0, blockMarkerIndex).trim();
  const blockId = target.slice(blockMarkerIndex + 2).trim();

  if (
    !BLOCK_ID_RE.test(blockId) ||
    rawPathPart.includes("#") ||
    rawPathPart.includes("^") ||
    URI_SCHEME_RE.test(rawPathPart)
  ) {
    return null;
  }

  return {
    target,
    pathPart: stripMarkdownExtensionFromPathPart(rawPathPart),
    blockId,
  };
}

function parseEmbeddedBlockTransclusions(lineText) {
  const line = String(lineText || "");
  const candidates = [];
  let match;

  EMBEDDED_WIKILINK_RE.lastIndex = 0;
  while ((match = EMBEDDED_WIKILINK_RE.exec(line)) !== null) {
    const rawTarget = String(match[1] || "").split("|")[0].trim();
    const parsedTarget = parseTranscludedBlockTarget(rawTarget);
    if (!parsedTarget) {
      continue;
    }

    candidates.push({
      ...parsedTarget,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return candidates;
}

function parseNonEmbeddedBlockLinks(lineText) {
  const line = String(lineText || "");
  const candidates = [];
  let match;

  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(line)) !== null) {
    if (match.index > 0 && line[match.index - 1] === "!") {
      continue;
    }

    const rawTarget = String(match[1] || "").split("|")[0].trim();
    const parsedTarget = parseTranscludedBlockTarget(rawTarget);
    if (!parsedTarget) {
      continue;
    }

    candidates.push({
      ...parsedTarget,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return candidates;
}

function getBlockLinkTokenCandidates(lineText) {
  return [
    ...parseEmbeddedBlockTransclusions(lineText).map((candidate) => ({
      ...candidate,
      embedded: true,
    })),
    ...parseNonEmbeddedBlockLinks(lineText).map((candidate) => ({
      ...candidate,
      embedded: false,
    })),
  ].sort((left, right) => left.startIndex - right.startIndex);
}

// Depends-On line recogniser (contract docs/task-dependencies.md section 2,
// DP vectors). Each plugin copies this small recogniser rather than importing
// it, since deployed plugins must not import one another's main.js. The line
// shape alone governs: writer form `⛓️ **DEPENDS ON:**` plus reader tolerance
// (legacy `🔗` emoji, missing emoji, missing VS16, `DEPENDENCIES` label, `•` /
// `·` / `,` / whitespace separators, aliased / struck / embedded links).
// Block links are found first and never split on separators, because an alias
// can contain one. Parentage (direct child of a `#task` line) and fenced code
// are hooks projection concerns; compat gestures key off the line shape so a
// managed line is never struck, restored, reformatted, or tree-closed.
const TASK_DEPENDENCY_LINE_LINK_RE = /(?:~~)?!?(?:~~)?\[\[[^\]\n]+\]\](?:~~)?/g;
const TASK_DEPENDENCY_LINE_REMAINDER_RE =
  /^[ \t]*(?:⛓️?|🔗)?[ \t]*\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*[ \t•·,]*$/u;

function isTaskDependencyLine(lineText) {
  const line = String(lineText || "");
  // DP29: a blockquoted line is never a Depends-On line (contract §2.3;
  // the Rust parser and nav reject it too).
  if (/^[ \t]*>/.test(line)) {
    return false;
  }
  const marker = line.match(LIST_ITEM_MARKER_RE);
  if (!marker) {
    return false;
  }
  const body = marker[2] || "";
  // DP24: the legacy link emoji never carries VS16 — not a line. Only
  // the pre-label emoji counts, as in the ledger-tools parser, so a
  // VS16 sequence inside a link alias cannot trip it.
  const labelAt = body.search(/\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/);
  if (/🔗️/.test(labelAt === -1 ? body : body.slice(0, labelAt))) {
    return false;
  }
  TASK_DEPENDENCY_LINE_LINK_RE.lastIndex = 0;
  const remainder = body.replace(TASK_DEPENDENCY_LINE_LINK_RE, "");
  TASK_DEPENDENCY_LINE_LINK_RE.lastIndex = 0;
  if (TASK_DEPENDENCY_LINE_REMAINDER_RE.test(remainder)) {
    // Accepted and empty (R9) lines, plus the malformed vectors whose
    // links strip cleanly (DP23 bare note link, DP25 heading link, DP26
    // separator-only): all guarded.
    return true;
  }
  // Malformed lines (contract R10: DP15 half-typed, DP16 trailing prose)
  // are still managed lines: guard them exactly like accepted ones, so
  // every malformed vector (DP15, DP16, DP23, DP25, DP26, DP31) behaves
  // the same way. Only the not-a-line vectors stay unguarded (DP24
  // rejected above; DP27 lowercase label has no label match; DP28 no
  // marker). Like the Rust parser, link brackets mark the residue as
  // malformed rather than a new shape.
  if (/\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/.test(body) && /(\[\[|\]\])/.test(body)) {
    return true;
  }
  // DP31 (prose-only line): the label shape leads the line but prose
  // follows with no block link. Guard it like the other malformed
  // vectors so the cycler never strikes or reformats it.
  if (/^[ \t]*(?:⛓️?|🔗)?[ \t]*\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/u.test(body)) {
    const afterLabel = body.replace(/^[ \t]*(?:⛓️?|🔗)?[ \t]*\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/u, "");
    if (/[^\s•·,]/.test(afterLabel)) {
      return true;
    }
  }
  return false;
}

