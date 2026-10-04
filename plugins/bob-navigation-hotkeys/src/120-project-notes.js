function getProjectBasenameSuffixForIndex(index, length) {
  const suffixIndex = Math.floor(numericOrDefault(index, Number.NaN));
  const suffixLength = Math.floor(numericOrDefault(length, Number.NaN));
  const alphabet = PROJECT_DEFAULT_BASENAME_SUFFIX_ALPHABET;
  const base = alphabet.length;

  if (
    !Number.isFinite(suffixIndex) ||
    !Number.isFinite(suffixLength) ||
    suffixIndex < 0 ||
    suffixLength < 1
  ) {
    return null;
  }

  const candidateCount = Math.pow(base, suffixLength);
  if (suffixIndex >= candidateCount) {
    return null;
  }

  let remaining = suffixIndex;
  const characters = new Array(suffixLength);
  for (let position = suffixLength - 1; position >= 0; position -= 1) {
    characters[position] = alphabet[remaining % base];
    remaining = Math.floor(remaining / base);
  }

  return characters.join("");
}

function getNextDefaultProjectBasename(sourceBasename, existingBasenames) {
  const sourceText =
    typeof sourceBasename === "string"
      ? sourceBasename
      : String(sourceBasename || "");
  if (!sourceText.trim()) {
    return null;
  }

  const existing = new Set();
  if (
    existingBasenames &&
    typeof existingBasenames[Symbol.iterator] === "function"
  ) {
    for (const basename of existingBasenames) {
      if (typeof basename === "string" && basename) {
        existing.add(basename);
      }
    }
  }

  let checkedCount = 0;
  for (
    let suffixLength = 1;
    checkedCount <= existing.size;
    suffixLength += 1
  ) {
    const suffixCount = Math.pow(
      PROJECT_DEFAULT_BASENAME_SUFFIX_ALPHABET.length,
      suffixLength,
    );
    for (
      let suffixIndex = 0;
      suffixIndex < suffixCount && checkedCount <= existing.size;
      suffixIndex += 1
    ) {
      const suffix = getProjectBasenameSuffixForIndex(
        suffixIndex,
        suffixLength,
      );
      const candidate = `${sourceText}_${suffix}`;
      if (!existing.has(candidate)) {
        return candidate;
      }

      checkedCount += 1;
    }
  }

  return null;
}

function backlinkLinkTargetsBlockId(linkText, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return false;
  }

  return getLinkSubpath(linkText) === `#^${id}`;
}

function backlinkCacheTargetsBlockId(value, blockId) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof value.link === "string" && value.link) {
    return backlinkLinkTargetsBlockId(value.link, blockId);
  }

  return (
    typeof value.original === "string" &&
    backlinkTextReferencesBlockId(value.original, blockId)
  );
}

function collectBlockIdBacklinkOriginals(value, blockId, originals, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (backlinkCacheTargetsBlockId(value, blockId)) {
    const original = String(value.original || "");
    if (original) {
      originals.add(original);
    }
    return;
  }

  if (value instanceof Map) {
    for (const entryValue of value.values()) {
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entryValue) =>
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1),
    );
    return;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entryValue) =>
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1),
    );
  }
}

function collectBlockIdBacklinkRewrites(backlinksData, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return [];
  }

  const entries =
    backlinksData instanceof Map
      ? Array.from(backlinksData.entries())
      : backlinksData && typeof backlinksData === "object"
        ? Object.entries(backlinksData)
        : [];

  return entries
    .map(([path, value]) => {
      const originals = new Set();
      collectBlockIdBacklinkOriginals(value, id, originals);
      return {
        path: String(path || ""),
        originals: Object.freeze(Array.from(originals)),
      };
    })
    .filter((rewrite) => rewrite.path && rewrite.originals.length > 0)
    .map((rewrite) => Object.freeze(rewrite));
}

function collectBacklinkOriginalStrings(value, originals, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (
    typeof value === "object" &&
    !(value instanceof Map) &&
    !Array.isArray(value) &&
    typeof value.original === "string" &&
    value.original
  ) {
    originals.add(value.original);
  }

  if (value instanceof Map) {
    for (const entryValue of value.values()) {
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entryValue) =>
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1),
    );
    return;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entryValue) =>
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1),
    );
  }
}

function collectProjectNoteBacklinkClassification(backlinksData, excludePath) {
  const blockRewrites = collectBlockIdBacklinkRewrites(backlinksData, "prj");
  const prjOriginalsByPath = new Map();
  for (const rewrite of blockRewrites) {
    prjOriginalsByPath.set(rewrite.path, new Set(rewrite.originals));
  }

  const excluded = new Set();
  const excludeText = String(excludePath || "").trim();
  if (excludeText) {
    excluded.add(excludeText);
    excluded.add(normalizeVaultRelativePath(excludeText));
  }

  const entries =
    backlinksData instanceof Map
      ? Array.from(backlinksData.entries())
      : backlinksData && typeof backlinksData === "object"
        ? Object.entries(backlinksData)
        : [];

  const otherPaths = [];
  for (const [path, value] of entries) {
    const entryPath = String(path || "");
    if (
      !entryPath ||
      excluded.has(entryPath) ||
      excluded.has(normalizeVaultRelativePath(entryPath))
    ) {
      continue;
    }

    const allOriginals = new Set();
    collectBacklinkOriginalStrings(value, allOriginals);
    const prjOriginals = prjOriginalsByPath.get(entryPath) || new Set();
    const hasOther = Array.from(allOriginals).some(
      (original) => !prjOriginals.has(original),
    );
    if (hasOther) {
      otherPaths.push(entryPath);
    }
  }

  return Object.freeze({
    blockRewrites: Object.freeze(blockRewrites),
    otherPaths: Object.freeze(otherPaths),
  });
}

function rewriteBlockIdLinkOriginal(original, newBasename, blockId = "prj") {
  const text = String(original || "");
  const targetBasename = String(newBasename || "").trim();
  const id = String(blockId || "").trim() || "prj";
  if (!text || !targetBasename) {
    return null;
  }

  const wikiMatch = /^(!?)\[\[([^\]\n|]*?)#\^[A-Za-z0-9-]+(\|[^\]\n]*)?\]\]$/.exec(
    text,
  );
  if (wikiMatch) {
    return `${wikiMatch[1]}[[${targetBasename}#^${id}${wikiMatch[3] || ""}]]`;
  }

  const markdownMatch =
    /^(!?\[[^\]\n]*(?:\\.[^\]\n]*)*\])\(([^)\s]*)#\^[A-Za-z0-9-]+(?:\s+[^)]*)?\)$/.exec(
      text,
    );
  if (markdownMatch) {
    return `${markdownMatch[1]}(${targetBasename}.md#^${id})`;
  }

  return null;
}

function replaceLinkOriginalsInContent(content, replacements) {
  let nextContent = String(content || "");
  const missing = [];

  (Array.isArray(replacements) ? replacements : []).forEach((replacement) => {
    const original = String((replacement && replacement.original) || "");
    const next = String((replacement && replacement.replacement) || "");
    if (!original) {
      return;
    }

    if (!nextContent.includes(original)) {
      missing.push(original);
      return;
    }

    nextContent = nextContent.split(original).join(next);
  });

  return Object.freeze({
    content: nextContent,
    missing,
  });
}

function planProjectPromotionTargets(content) {
  const text = String(content || "");
  const splitted = splitMarkdownContent(text);
  const lines = splitted.lines;
  const lineEnding = splitted.lineEnding;
  const contexts = getMarkdownLineContexts(text);
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const context = contexts[index];
    if (context && (context.inFrontmatter || context.inFence)) {
      continue;
    }
    const line = String(lines[index] || "");
    if (!OBSIDIAN_TASK_LINE_RE.test(line)) {
      continue;
    }
    if (!isObsidianTaskLine(line)) {
      continue;
    }
    if (isProjectLifecycleTaskLine(line)) {
      continue;
    }
    if (line.includes(PROJECT_TASKS_PLACEHOLDER)) {
      continue;
    }
    candidates.push(
      Object.freeze({
        line: index,
        text: line,
        blockId: getTrailingBlockId(line),
      }),
    );
  }
  if (candidates.length === 0) {
    return Object.freeze({
      targets: Object.freeze([]),
      content: text,
      error: null,
    });
  }
  const allIds = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const context = contexts[index];
    if (context && (context.inFrontmatter || context.inFence)) {
      continue;
    }
    const id = getTrailingBlockId(String(lines[index] || ""));
    if (!id) {
      continue;
    }
    if (!allIds.has(id)) {
      allIds.set(id, []);
    }
    allIds.get(id).push(index);
  }
  for (const candidate of candidates) {
    if (!candidate.blockId) {
      continue;
    }
    const occurrences = allIds.get(candidate.blockId) || [];
    if (occurrences.length > 1) {
      return Object.freeze({
        targets: Object.freeze([]),
        content: text,
        error: `Target block ID ^${candidate.blockId} is duplicated`,
      });
    }
  }
  const reserved = new Set(allIds.keys());
  reserved.add("prj");
  const nextLines = lines.slice();
  const targets = [];
  for (const candidate of candidates) {
    let id = candidate.blockId;
    if (!id) {
      id = suggestBlockIdFromTask(cleanTaskDisplayText(candidate.text), text, {
        reservedIds: reserved,
      });
      nextLines[candidate.line] = appendBlockIdToLine(
        nextLines[candidate.line],
        id,
      );
      reserved.add(id);
    }
    targets.push(Object.freeze({ line: candidate.line, blockId: id }));
  }
  return Object.freeze({
    targets: Object.freeze(targets),
    content: nextLines.join(lineEnding),
    error: null,
  });
}

function isProjectPromotionEligibleDailyPath(filePath, today) {
  const daily = canonicalRecoveryDailyDate(filePath);
  if (!daily) {
    return false;
  }
  const base = today instanceof Date ? today : new Date();
  const local = getLocalDateStart(base);
  const todayValue =
    local.getFullYear() * 10000 + (local.getMonth() + 1) * 100 + local.getDate();
  return daily.value >= todayValue;
}

function createProjectPromotionLinkIndex(files) {
  const paths = new Set();
  const basenames = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const rawPath = file && file.path ? file.path : file;
    const normalized = normalizeVaultRelativePath(rawPath);
    if (!normalized) {
      continue;
    }
    paths.add(normalized);
    const basename = recoveryMarkdownBasename(normalized).toLowerCase();
    if (!basenames.has(basename)) {
      basenames.set(basename, normalized);
    } else if (basenames.get(basename) !== normalized) {
      basenames.set(basename, null);
    }
  }
  return Object.freeze({ paths, basenames });
}

function resolveProjectPromotionLinkTarget(linkTargetText, containingPath, index) {
  const raw = String(linkTargetText || "").trim();
  const container = normalizeVaultRelativePath(containingPath || "");
  if (!raw) {
    if (!container || !index || !index.paths) {
      return null;
    }
    return index.paths.has(container) ? container : container;
  }
  if (!index || !index.paths || !index.basenames) {
    return null;
  }
  const exact = canonicalRecoveryMarkdownPath(raw);
  if (exact && index.paths.has(exact)) {
    return exact;
  }
  const basename = recoveryMarkdownBasename(exact || raw).toLowerCase();
  if (!basename) {
    return null;
  }
  return index.basenames.get(basename) || null;
}

const PROJECT_PROMOTION_DEDICATED_BODY_RE =
  /^(?:\[([^\]\n])\][ \t]+)?((?:🍅[ \t]+)*)(~~)?(!)?\[\[([^\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\](~~)?([ \t]*#)?[ \t]*$/u;

function splitProjectPromotionLinkPrefix(line) {
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(String(line || ""));
  if (!match) {
    return null;
  }
  return Object.freeze({ prefix: match[1], body: match[2] });
}

function parseProjectPromotionDedicatedLink(line) {
  const splitted = splitProjectPromotionLinkPrefix(line);
  if (!splitted) {
    return null;
  }
  const match = PROJECT_PROMOTION_DEDICATED_BODY_RE.exec(splitted.body);
  if (!match) {
    return null;
  }
  return Object.freeze({
    prefix: splitted.prefix,
    checkbox: match[1] === undefined ? null : match[1],
    markerRun: match[2] || "",
    strikeOpen: Boolean(match[3]),
    embedded: Boolean(match[4]),
    target: String(match[5] || "").trim(),
    blockId: match[6],
    strikeClose: Boolean(match[7]),
    suffix: match[8] || "",
  });
}

function buildProjectPromotionReplacementLines(
  originalLine,
  projectPathWithoutMd,
  targetBlockIds,
) {
  const parsed = parseProjectPromotionDedicatedLink(originalLine);
  if (!parsed) {
    return null;
  }
  if (parsed.strikeOpen || parsed.strikeClose) {
    return null;
  }
  if (
    parsed.checkbox !== null &&
    POMODORO_LEDGER_CLOSED_STATUSES.has(parsed.checkbox)
  ) {
    return null;
  }
  const projectRef = String(projectPathWithoutMd || "").trim();
  if (!projectRef) {
    return null;
  }
  const ids = Array.isArray(targetBlockIds) ? targetBlockIds : [];
  if (ids.length === 0) {
    return null;
  }
  const embedPrefix = parsed.embedded ? "!" : "";
  const suffixText = parsed.suffix ? parsed.suffix.replace(/^[ \t]*/, " ") : "";
  const lines = [];
  ids.forEach((blockId, order) => {
    const id = String(blockId || "").trim();
    if (!id) {
      return;
    }
    if (order === 0) {
      const checkboxText =
        parsed.checkbox !== null ? `[${parsed.checkbox}] ` : "";
      lines.push(
        `${parsed.prefix}${checkboxText}${parsed.markerRun}${embedPrefix}[[${projectRef}#^${id}]]${suffixText}`,
      );
    } else {
      lines.push(
        `${parsed.prefix}${embedPrefix}[[${projectRef}#^${id}]]${suffixText}`,
      );
    }
  });
  return Object.freeze(lines);
}

function planProjectPromotionFileEdits(content, filePath, options) {
  const text = String(content || "");
  const opts = options && typeof options === "object" ? options : {};
  const sourcePath = normalizeVaultRelativePath(opts.sourcePath || "");
  const sourceBlockId = String(opts.sourceBlockId || "").trim();
  const projectPathWithoutMd = String(
    opts.projectPathWithoutMd || opts.projectBasename || "",
  ).trim();
  const projectBasename = String(
    opts.projectBasename || opts.projectPathWithoutMd || "",
  )
    .trim()
    .split("/")
    .pop();
  const targetBlockIds = Array.isArray(opts.targetBlockIds)
    ? opts.targetBlockIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const today = opts.today instanceof Date ? opts.today : new Date();
  const index =
    opts.fileIndex && typeof opts.fileIndex === "object"
      ? opts.fileIndex
      : createProjectPromotionLinkIndex(opts.files || []);
  const empty = Object.freeze({
    content: text,
    changed: false,
    expandedCount: 0,
    legacyCount: 0,
  });
  if (!sourcePath || !sourceBlockId || !projectPathWithoutMd || !projectBasename) {
    return empty;
  }
  if (targetBlockIds.length === 0) {
    return empty;
  }
  if (!isProjectPromotionEligibleDailyPath(filePath, today)) {
    return empty;
  }
  const splitted = splitMarkdownContent(text);
  const lines = splitted.lines;
  const lineEnding = splitted.lineEnding;
  const contexts = getMarkdownLineContexts(text);
  const section = findPomodorosSectionRange(text);
  if (!section) {
    return empty;
  }
  const ranges = collectOpenPomodoroRanges(lines, contexts, section);
  if (ranges.length === 0) {
    return empty;
  }
  const expansions = [];
  for (const range of ranges) {
    for (
      let lineIndex = range.startLine;
      lineIndex <= range.endLine;
      lineIndex += 1
    ) {
      const context = contexts[lineIndex];
      if (context && (context.inFrontmatter || context.inFence)) {
        continue;
      }
      const lineText = String(lines[lineIndex] || "");
      if (!PROJECT_LIST_ITEM_RE.test(lineText)) {
        continue;
      }
      if (findNearestParentListItem(lines, lineIndex) !== range.entryLine) {
        continue;
      }
      const parsed = parseProjectPromotionDedicatedLink(lineText);
      if (!parsed) {
        continue;
      }
      if (parsed.strikeOpen || parsed.strikeClose) {
        continue;
      }
      if (
        parsed.checkbox !== null &&
        POMODORO_LEDGER_CLOSED_STATUSES.has(parsed.checkbox)
      ) {
        continue;
      }
      if (parsed.blockId !== sourceBlockId) {
        continue;
      }
      const resolved = resolveProjectPromotionLinkTarget(
        parsed.target,
        filePath,
        index,
      );
      if (!resolved || normalizeVaultRelativePath(resolved) !== sourcePath) {
        continue;
      }
      const replacementLines = buildProjectPromotionReplacementLines(
        lineText,
        projectPathWithoutMd,
        targetBlockIds,
      );
      if (!replacementLines || replacementLines.length === 0) {
        continue;
      }
      const block = findCurrentBulletChildBlock(lines, lineIndex);
      const subtreeEnd =
        block && Number.isFinite(block.endLineExclusive)
          ? block.endLineExclusive
          : lineIndex + 1;
      expansions.push(
        Object.freeze({
          lineIndex,
          originalLine: lineText,
          replacementLines,
          subtreeStart: lineIndex + 1,
          subtreeEnd: Math.max(lineIndex + 1, subtreeEnd),
        }),
      );
    }
  }
  if (expansions.length === 0) {
    return empty;
  }
  const covered = new Set();
  for (const expansion of expansions) {
    for (
      let lineIndex = expansion.lineIndex;
      lineIndex < expansion.subtreeEnd;
      lineIndex += 1
    ) {
      covered.add(lineIndex);
    }
  }
  const nextLines = lines.slice();
  const sorted = expansions.slice().sort((a, b) => b.lineIndex - a.lineIndex);
  for (const expansion of sorted) {
    const subtreeLines = nextLines.slice(
      expansion.subtreeStart,
      expansion.subtreeEnd,
    );
    const first = expansion.replacementLines[0];
    const rest = expansion.replacementLines.slice(1);
    const replacement = [first, ...subtreeLines, ...rest];
    nextLines.splice(
      expansion.lineIndex,
      expansion.subtreeEnd - expansion.lineIndex,
      ...replacement,
    );
  }
  let legacyCount = 0;
  const markdownLinkRe =
    /\[([^\]\n]*)\]\(([^)\s]*?)#\^([A-Za-z0-9-]+)(?:\s+[^)]*)?\)/g;
  for (let lineIndex = 0; lineIndex < nextLines.length; lineIndex += 1) {
    let lineText = String(nextLines[lineIndex] || "");
    const originalLineText = lineText;
    const wikiOccurrences = collectPomodoroBlockLinkOccurrences(lineText);
    const wikiReplacements = [];
    for (const occurrence of wikiOccurrences) {
      if (occurrence.blockId !== sourceBlockId) {
        continue;
      }
      const resolved = resolveProjectPromotionLinkTarget(
        occurrence.target,
        filePath,
        index,
      );
      if (!resolved || normalizeVaultRelativePath(resolved) !== sourcePath) {
        continue;
      }
      let linkOnlyStart = occurrence.start;
      const markerMatch = /^(?:🍅[ \t]+)*/.exec(
        lineText.slice(occurrence.start, occurrence.end),
      );
      if (markerMatch) {
        linkOnlyStart = occurrence.start + markerMatch[0].length;
      }
      const originalLink = lineText.slice(linkOnlyStart, occurrence.end);
      const replacementLink = rewriteBlockIdLinkOriginal(
        originalLink,
        projectBasename,
        "prj",
      );
      if (!replacementLink) {
        continue;
      }
      wikiReplacements.push({ start: linkOnlyStart, end: occurrence.end, replacementLink });
    }
    wikiReplacements
      .sort((a, b) => b.start - a.start)
      .forEach((item) => {
        lineText =
          lineText.slice(0, item.start) +
          item.replacementLink +
          lineText.slice(item.end);
        legacyCount += 1;
      });
    markdownLinkRe.lastIndex = 0;
    let markdownMatch = null;
    const markdownReplacements = [];
    while ((markdownMatch = markdownLinkRe.exec(lineText)) !== null) {
      const targetText = String(markdownMatch[2] || "").trim();
      const blockId = markdownMatch[3];
      if (blockId !== sourceBlockId) {
        continue;
      }
      const strippedTarget = targetText.replace(/\.md$/i, "");
      const resolved = resolveProjectPromotionLinkTarget(
        strippedTarget || targetText,
        filePath,
        index,
      );
      if (!resolved || normalizeVaultRelativePath(resolved) !== sourcePath) {
        continue;
      }
      const originalLink = markdownMatch[0];
      const replacementLink = rewriteBlockIdLinkOriginal(
        originalLink,
        projectBasename,
        "prj",
      );
      if (!replacementLink) {
        continue;
      }
      markdownReplacements.push({
        start: markdownMatch.index,
        end: markdownMatch.index + originalLink.length,
        replacementLink,
      });
    }
    markdownReplacements
      .sort((a, b) => b.start - a.start)
      .forEach((item) => {
        lineText =
          lineText.slice(0, item.start) +
          item.replacementLink +
          lineText.slice(item.end);
        legacyCount += 1;
      });
    if (lineText !== originalLineText) {
      nextLines[lineIndex] = lineText;
    }
  }
  return Object.freeze({
    content: nextLines.join(lineEnding),
    changed: nextLines.join(lineEnding) !== text,
    expandedCount: expansions.length,
    legacyCount,
  });
}

function parseIntegerText(text) {
  return Number.parseInt(String(text || ""), 10);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year, month) {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function isValidMonthText(monthText) {
  const month = parseIntegerText(monthText);
  return month >= 1 && month <= 12;
}

function isValidDateParts(yearText, monthText, dayText) {
  const year = parseIntegerText(yearText);
  const month = parseIntegerText(monthText);
  const day = parseIntegerText(dayText);

  return (
    Number.isInteger(year) &&
    isValidMonthText(monthText) &&
    day >= 1 &&
    day <= getDaysInMonth(year, month)
  );
}

function getNoteTemplateSelection(kind) {
  return NOTE_TEMPLATE_SELECTIONS[kind] || NOTE_TEMPLATE_SELECTIONS.default;
}

function getNoteTemplateForCreationPath(path) {
  const normalizedPath = normalizeVaultRelativePath(path);
  const dailyMatch = normalizedPath.match(DAILY_NOTE_CREATION_PATH_RE);
  if (
    dailyMatch &&
    dailyMatch[1] === dailyMatch[2] &&
    isValidDateParts(dailyMatch[2], dailyMatch[3], dailyMatch[4])
  ) {
    return getNoteTemplateSelection("daily");
  }

  const monthlyMatch = normalizedPath.match(MONTHLY_NOTE_CREATION_PATH_RE);
  if (
    monthlyMatch &&
    monthlyMatch[1] === monthlyMatch[2] &&
    isValidMonthText(monthlyMatch[3])
  ) {
    return getNoteTemplateSelection("monthly");
  }

  if (YEARLY_NOTE_CREATION_PATH_RE.test(normalizedPath)) {
    return getNoteTemplateSelection("yearly");
  }

  return getNoteTemplateSelection("default");
}

// Index of the first subpath marker (`#` heading or `^` block) in a link text,
// or -1 when the link carries no subpath. `note#^abc` -> index of `#`.
function findLinkSubpathIndex(linkText) {
  const text = String(linkText || "");
  const headingIndex = text.indexOf("#");
  const blockIndex = text.indexOf("^");
  if (headingIndex === -1) {
    return blockIndex;
  }
  if (blockIndex === -1) {
    return headingIndex;
  }
  return Math.min(headingIndex, blockIndex);
}

// The `#…` subpath portion (heading and/or `^blockid`) of a link text, or ""
// when there is none. `note.md#^abc` -> `#^abc`; `note` -> "".
function getLinkSubpath(linkText) {
  const subpathIndex = findLinkSubpathIndex(linkText);
  return subpathIndex === -1 ? "" : String(linkText || "").slice(subpathIndex);
}

// True when a link is a *pure* subpath reference into the current note: its
// path part is empty and it carries a non-empty heading/block subpath. Rejects
// the degenerate `#`, `#^`, and the empty string so they never resolve.
function isSubpathOnlyLink(linkText) {
  if (findLinkSubpathIndex(linkText) !== 0) {
    return false;
  }

  const subpath = String(linkText || "");
  return subpath.replace(/[#^]/g, "").trim().length > 0;
}

function startsWithFrontmatter(lines) {
  return lines.length > 0 && /^\s*---\s*$/.test(lines[0]);
}

function getFenceOpening(line) {
  const match = String(line).match(OPENING_FENCE_RE);
  if (!match) {
    return null;
  }

  return {
    markerChar: match[2][0],
    markerLength: match[2].length,
  };
}

