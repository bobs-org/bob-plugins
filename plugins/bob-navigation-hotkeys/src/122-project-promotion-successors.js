// Pure promotion-successor planner (plan:202610/promotion_successor_offers.md).
// No vault reads, no editor writes. Shared scope with 120-project-notes.js,
// 140-scheduled-recovery.js, 160-pomodoro-reorder.js, and the 206 picker model.

function promotionSuccessorFnv1aHex(text) {
  let hash = 0x811c9dc5;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8).toLowerCase();
}

function promotionSuccessorScheduledDate(lineText) {
  const match = /\[scheduled::\s*(\d{4})-(\d{2})-(\d{2})\s*\]/.exec(String(lineText || ""));
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function promotionSuccessorTodayText(today) {
  const base = today instanceof Date ? today : new Date();
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function promotionSuccessorHasHideToken(lineText) {
  return /(^|\s)#hide(\s|$)/.test(String(lineText || ""));
}

function promotionTruncateTaskText(text, maxLength = 48) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function promotionSuccessorLinkForId(projectPath, blockId, fileIndex) {
  const id = String(blockId || "").trim();
  const normalized = normalizeVaultRelativePath(projectPath || "");
  const withoutMd = normalized.replace(/\.md$/i, "");
  const basename = withoutMd.split("/").pop() || withoutMd;
  let ref = withoutMd;
  try {
    if (fileIndex && fileIndex.basenames instanceof Map) {
      const key = String(basename || "").toLowerCase();
      if (key && fileIndex.basenames.get(key) === normalized) {
        ref = basename;
      }
    } else {
      ref = basename;
    }
  } catch (_error) {
    ref = basename;
  }
  return `[[${ref}#^${id}]]`;
}

function planPromotionSuccessorRows(projectContent, options = {}) {
  const text = String(projectContent || "");
  const projectPath = normalizeVaultRelativePath(options.projectPath || "");
  const today = options.today instanceof Date ? options.today : new Date();
  const todayText = promotionSuccessorTodayText(today);
  const liveLinkedIds = options.liveLinkedIds instanceof Set
    ? options.liveLinkedIds
    : new Set(options.liveLinkedIds || []);
  const splitted = splitMarkdownContent(text);
  const lines = splitted.lines;
  const contexts = getMarkdownLineContexts(text);
  const rows = [];
  const digestCounts = new Map();
  const digestOrder = new Map();
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const context = contexts[index];
    if (context && (context.inFrontmatter || context.inFence)) continue;
    const lineText = String(lines[index] || "");
    if (!OBSIDIAN_TASK_LINE_RE.test(lineText)) continue;
    if (!isObsidianTaskLine(lineText)) continue;
    if (isProjectLifecycleTaskLine(lineText)) continue;
    if (lineText.includes(PROJECT_TASKS_PLACEHOLDER)) continue;
    const status = getObsidianTaskCheckboxStatus(lineText);
    if (status === null) continue;
    if (POMODORO_LEDGER_CLOSED_STATUSES.has(status)) continue;
    const blockId = getTrailingBlockId(lineText);
    const display = cleanTaskDisplayText(lineText);
    const digest = promotionSuccessorFnv1aHex(display);
    const seen = digestCounts.get(digest) || 0;
    digestCounts.set(digest, seen + 1);
    if (!digestOrder.has(digest)) digestOrder.set(digest, []);
    digestOrder.get(digest).push(index);
    candidates.push({ line: index, text: lineText, status, blockId, display, digest });
  }
  let hidden = 0;
  let alreadyPlanned = 0;
  const seenKeys = new Set();
  for (const candidate of candidates) {
    if (promotionSuccessorHasHideToken(candidate.text)) {
      hidden += 1;
      continue;
    }
    if (candidate.blockId && liveLinkedIds.has(candidate.blockId)) {
      alreadyPlanned += 1;
      continue;
    }
    let selectable = true;
    let mutedReason = "";
    if (candidate.status === "?") {
      selectable = false;
      mutedReason = "blocked";
    } else {
      const scheduled = promotionSuccessorScheduledDate(candidate.text);
      if (scheduled && scheduled > todayText) {
        selectable = false;
        const date = new Date(`${scheduled}T00:00:00`);
        const label = Number.isNaN(date.getTime())
          ? scheduled
          : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        mutedReason = `scheduled ${label}`;
      }
    }
    let key;
    if (candidate.blockId) {
      key = `${projectPath}#^${candidate.blockId}`;
    } else {
      const order = (digestOrder.get(candidate.digest) || []).indexOf(candidate.line) + 1;
      const base = `${projectPath}@${candidate.digest}`;
      key = order <= 1 ? base : `${base}~${order}`;
    }
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    rows.push(Object.freeze({
      key,
      text: candidate.display,
      notePath: projectPath,
      status: candidate.status,
      destinationLabel: String(options.destinationLabel || ""),
      needsBlockId: !candidate.blockId,
      selectable,
      ...(mutedReason ? { mutedReason } : {}),
      line: candidate.line,
      rawLine: candidate.text,
      blockId: candidate.blockId,
    }));
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    folded: Object.freeze({ hidden, alreadyPlanned }),
  });
}

function findPromotionPlannedLinks(dailyContent, dailyPath, options = {}) {
  const text = String(dailyContent || "");
  const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
  const sourceBlockId = String(options.sourceBlockId || "").trim();
  const filePath = normalizeVaultRelativePath(dailyPath || "");
  if (!sourcePath || !sourceBlockId || !filePath) return Object.freeze([]);
  const index = options.fileIndex && typeof options.fileIndex === "object"
    ? options.fileIndex
    : createProjectPromotionLinkIndex(options.files || []);
  const splitted = splitMarkdownContent(text);
  const lines = splitted.lines;
  const contexts = getMarkdownLineContexts(text);
  const section = findPomodorosSectionRange(text);
  if (!section) return Object.freeze([]);
  const ranges = collectOpenPomodoroRanges(lines, contexts, section);
  if (ranges.length === 0) return Object.freeze([]);
  const found = [];
  for (const range of ranges) {
    const entryText = String(lines[range.entryLine] || "");
    let destinationLabel = "";
    try {
      const parts = typeof parsePomodoroEntryLineParts === "function"
        ? parsePomodoroEntryLineParts(entryText)
        : null;
      if (parts && parts.name) destinationLabel = parts.name;
    } catch (_error) {
      destinationLabel = "";
    }
    if (!destinationLabel) {
      const nameMatch = /—\s*(.+?)\s*$/.exec(entryText);
      if (nameMatch) destinationLabel = nameMatch[1].trim();
    }
    if (!destinationLabel) {
      const spanMatch = /\(\*\*(\d{4}-\d{4})\*\*\)/.exec(entryText);
      if (spanMatch) destinationLabel = spanMatch[1];
    }
    for (let lineIndex = range.startLine; lineIndex <= range.endLine; lineIndex += 1) {
      const context = contexts[lineIndex];
      if (context && (context.inFrontmatter || context.inFence)) continue;
      const lineText = String(lines[lineIndex] || "");
      if (!PROJECT_LIST_ITEM_RE.test(lineText)) continue;
      if (findNearestParentListItem(lines, lineIndex) !== range.entryLine) continue;
      const parsed = parseProjectPromotionDedicatedLink(lineText);
      if (!parsed) continue;
      if (parsed.strikeOpen || parsed.strikeClose) continue;
      if (parsed.checkbox !== null && POMODORO_LEDGER_CLOSED_STATUSES.has(parsed.checkbox)) continue;
      if (parsed.blockId !== sourceBlockId) continue;
      const resolved = resolveProjectPromotionLinkTarget(parsed.target, filePath, index);
      if (!resolved || normalizeVaultRelativePath(resolved) !== sourcePath) continue;
      const block = findCurrentBulletChildBlock(lines, lineIndex);
      found.push(Object.freeze({
        dailyPath: filePath,
        entryLine: range.entryLine,
        bulletLine: lineIndex,
        entryText,
        destinationLabel,
        lineText,
        subtreeEnd: block && Number.isFinite(block.endLineExclusive) ? block.endLineExclusive : lineIndex + 1,
      }));
    }
  }
  return Object.freeze(found);
}

function buildPromotionSuccessorModel(offerPlan, options = {}) {
  const rows = Array.isArray(offerPlan && offerPlan.rows) ? offerPlan.rows : [];
  const selectable = rows.filter((row) => row && row.selectable);
  const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
  const sourceBlockId = String(options.sourceBlockId || "").trim();
  const sourceText = String(options.sourceDescription || "").trim();
  const projectPath = normalizeVaultRelativePath(options.projectPath || "");
  const header = String(options.projectDescription || "").trim();
  const destinationLabel = String(options.destinationLabel || "");
  const modelRows = selectable.map((row) => Object.freeze({
    key: row.key,
    text: row.text,
    notePath: row.notePath,
    status: row.status,
    destinationLabel: destinationLabel || row.destinationLabel || "",
    needsBlockId: row.needsBlockId === true,
    selectable: true,
    ...(row.mutedReason ? { mutedReason: row.mutedReason } : {}),
  }));
  const muted = rows.filter((row) => row && !row.selectable);
  for (const row of muted) {
    modelRows.push(Object.freeze({
      key: row.key,
      text: row.text,
      notePath: row.notePath,
      status: row.status,
      destinationLabel: destinationLabel || row.destinationLabel || "",
      needsBlockId: row.needsBlockId === true,
      selectable: false,
      mutedReason: row.mutedReason || "blocked",
    }));
  }
  if (modelRows.length === 0 || selectable.length === 0) return null;
  const folded = offerPlan && offerPlan.folded ? offerPlan.folded : { hidden: 0, alreadyPlanned: 0 };
  return Object.freeze({
    title: "Promoted to project · pull in successors",
    predecessors: Object.freeze([Object.freeze({
      notePath: sourcePath,
      blockId: sourceBlockId,
      text: sourceText,
    })]),
    groups: Object.freeze([Object.freeze({
      group: "project",
      header,
      project: projectPath,
      rows: Object.freeze(modelRows),
      folded: Object.freeze({
        hidden: Number(folded.hidden) || 0,
        alreadyPlanned: Number(folded.alreadyPlanned) || 0,
        subProjects: 0,
      }),
    })]),
    budget: null,
    selectableCount: selectable.length,
    taskRowCount: rows.length,
  });
}

// Extracted legacy history pass: every non-planned reference to the source or a
// moved child becomes <project>#^prj. Pure; past daily notes get only this rewrite.
function planPromotionHistoryRewrites(content, filePath, options = {}) {
  const text = String(content || "");
  const sourcePath = normalizeVaultRelativePath(options.sourcePath || "");
  const sourceBlockId = String(options.sourceBlockId || "").trim();
  const projectBasename = String(options.projectBasename || "").trim();
  if (!sourcePath || !sourceBlockId || !projectBasename) {
    return Object.freeze({ content: text, changed: false, count: 0 });
  }
  const index = options.fileIndex && typeof options.fileIndex === "object"
    ? options.fileIndex
    : createProjectPromotionLinkIndex(options.files || []);
  const childIds = new Set(
    (Array.isArray(options.childBlockIds) ? options.childBlockIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const lines = text.split(/\r?\n/);
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  let count = 0;
  const nextLines = lines.map((originalLine) => {
    let lineText = String(originalLine || "");
    const original = lineText;
    const wikiOccurrences = collectPomodoroBlockLinkOccurrences(lineText);
    const wikiReplacements = [];
    for (const occurrence of wikiOccurrences) {
      const id = occurrence.blockId;
      const isSource = id === sourceBlockId;
      const isChild = childIds.has(id);
      if (!isSource && !isChild) continue;
      const resolved = resolveProjectPromotionLinkTarget(occurrence.target, filePath, index);
      if (!resolved) continue;
      const resolvedPath = normalizeVaultRelativePath(resolved);
      if (isSource && resolvedPath !== sourcePath) continue;
      let linkOnlyStart = occurrence.start;
      const markerMatch = /^(?:🍅[ \t]+)*/.exec(lineText.slice(occurrence.start, occurrence.end));
      if (markerMatch) linkOnlyStart = occurrence.start + markerMatch[0].length;
      const originalLink = lineText.slice(linkOnlyStart, occurrence.end);
      const replacementLink = rewriteBlockIdLinkOriginal(originalLink, projectBasename, "prj");
      if (!replacementLink) continue;
      wikiReplacements.push({ start: linkOnlyStart, end: occurrence.end, replacementLink });
    }
    wikiReplacements.sort((a, b) => b.start - a.start).forEach((item) => {
      lineText = lineText.slice(0, item.start) + item.replacementLink + lineText.slice(item.end);
      count += 1;
    });
    const markdownLinkRe = /\[([^\]\n]*)\]\(([^)\s]*?)#\^([A-Za-z0-9-]+)(?:\s+[^)]*)?\)/g;
    markdownLinkRe.lastIndex = 0;
    let markdownMatch = null;
    const markdownReplacements = [];
    while ((markdownMatch = markdownLinkRe.exec(lineText)) !== null) {
      const targetText = String(markdownMatch[2] || "").trim();
      const blockId = markdownMatch[3];
      const isSource = blockId === sourceBlockId;
      const isChild = childIds.has(blockId);
      if (!isSource && !isChild) continue;
      const strippedTarget = targetText.replace(/\.md$/i, "");
      const resolved = resolveProjectPromotionLinkTarget(strippedTarget || targetText, filePath, index);
      if (!resolved) continue;
      if (isSource && normalizeVaultRelativePath(resolved) !== sourcePath) continue;
      const originalLink = markdownMatch[0];
      const replacementLink = rewriteBlockIdLinkOriginal(originalLink, projectBasename, "prj");
      if (!replacementLink) continue;
      markdownReplacements.push({ start: markdownMatch.index, end: markdownMatch.index + originalLink.length, replacementLink });
    }
    markdownReplacements.sort((a, b) => b.start - a.start).forEach((item) => {
      lineText = lineText.slice(0, item.start) + item.replacementLink + lineText.slice(item.end);
      count += 1;
    });
    return lineText === original ? originalLine : lineText;
  });
  const next = nextLines.join(ending);
  return Object.freeze({ content: next, changed: next !== text, count });
}

function buildPromotionNoticeLine2(options = {}) {
  const picks = Array.isArray(options.picks) ? options.picks : [];
  const anchorLabel = String(options.anchorLabel || "").trim() || "Pomodoro";
  const offerCount = Number(options.offerCount) || 0;
  const notPulled = Number(options.notPulledCount) || 0;
  const moreRemoved = Number(options.moreRemovedCount) || 0;
  const refused = Number(options.refusedCount) || 0;
  const blocked = options.blocked === true;
  const nothingOfferable = options.nothingOfferable === true;
  const describePick = (pick) => promotionTruncateTaskText(pick && pick.text ? pick.text : "");
  if (blocked) return `Removed the ${anchorLabel} link · project is Blocked`;
  if (nothingOfferable) return `Removed the ${anchorLabel} link · no project tasks to pull in`;
  if (picks.length === 0) {
    return `Removed the ${anchorLabel} link · ${offerCount} project task${offerCount === 1 ? "" : "s"} not pulled in`;
  }
  let head;
  if (picks.length === 1) {
    head = `Next in ${anchorLabel}: ${describePick(picks[0])}`;
  } else {
    const shown = picks.slice(0, 3).map(describePick).join(", ");
    const extra = picks.length > 3 ? ` +${picks.length - 3}` : "";
    head = `${picks.length} Next in ${anchorLabel}: ${shown}${extra}`;
  }
  const suffixes = [];
  if (notPulled > 0) suffixes.push(`${notPulled} not pulled in`);
  if (moreRemoved > 0) suffixes.push(`${moreRemoved} more Pomodoro link${moreRemoved === 1 ? "" : "s"} removed`);
  if (refused > 0) suffixes.push(`couldn't link ${refused} (project note changed)`);
  return suffixes.length > 0 ? `${head} · ${suffixes.join(" · ")}` : head;
}
