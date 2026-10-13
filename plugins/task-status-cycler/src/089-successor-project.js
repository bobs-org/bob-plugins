// Project pull-in helpers (docs/task-dependencies.md §12.10 / §12.11).
// Pure code: the cycler mirror of sync's surface predicate, #hide bytes,
// and the pull-in planner. Consumed by 085-successor-plan.js.

const PROJECT_SUBPROJECTS_MARKER = "🧩 **Sub-projects:**";
const PROJECT_HIDE_TAG = "#hide";
const PROJECT_PRJ_TAG = "#prj";
const PROJECT_BLOCKED_TAG = "#prj_is_blocked";
const PROJECT_CLOSED_MARKS = new Set(["x", "X", "-"]);
const PROJECT_WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

function projectNoteTextFor(noteTexts, path) {
  if (!noteTexts || !path) {
    return "";
  }
  if (typeof noteTexts.get === "function") {
    const value = noteTexts.get(path);
    return typeof value === "string" ? value : "";
  }
  const value = noteTexts[path];
  return typeof value === "string" ? value : "";
}

function projectHideTagLeftBoundary(character) {
  return /\s/.test(character) || character === "(" || character === "[" ||
    character === "{";
}

function projectHideTagRightBoundary(character) {
  return /\s/.test(character) ||
    "])}:.,;!?".includes(character);
}

function projectWholeTagSpans(text, tag) {
  const source = String(text || "");
  const spans = [];
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(tag, offset);
    if (index === -1) {
      break;
    }
    const end = index + tag.length;
    const before = index === 0 ? null : source[index - 1];
    const after = end >= source.length ? null : source[end];
    if (
      (before == null || projectHideTagLeftBoundary(before)) &&
      (after == null || projectHideTagRightBoundary(after))
    ) {
      spans.push({ start: index, end });
      offset = end;
    } else {
      offset = index + 1;
    }
  }
  return spans;
}

function projectLineHasWholeTag(text, tag) {
  return projectWholeTagSpans(text, tag).length > 0;
}

function projectTaskTextOffset(line) {
  const match = String(line || "").match(TASK_LINE_RE);
  return match ? match[0].length : 0;
}

function projectTagRemovalRange(line, start, end) {
  let after = end;
  while (after < line.length && (line[after] === " " || line[after] === "\t")) {
    after += 1;
  }
  if (after > end) {
    return { start, end: after };
  }
  let before = start;
  while (before > 0 && (line[before - 1] === " " || line[before - 1] === "\t")) {
    before -= 1;
  }
  return { start: before, end };
}

// Byte-identical to Rust `normalize_task_hide_tag(line, false, true)` (PP22).
function removeProjectHideTags(line) {
  const source = String(line || "");
  if (!getTaskStatusForLine(source)) {
    return source;
  }
  const offset = projectTaskTextOffset(source);
  const spans = projectWholeTagSpans(source.slice(offset), PROJECT_HIDE_TAG)
    .map((span) => ({ start: span.start + offset, end: span.end + offset }));
  if (spans.length === 0) {
    return source;
  }
  const ranges = spans
    .map((span) => projectTagRemovalRange(source, span.start, span.end))
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  let output = "";
  let cursor = 0;
  for (const range of merged) {
    output += source.slice(cursor, range.start);
    cursor = range.end;
  }
  output += source.slice(cursor);
  return output;
}

function lineHasTrailingPrjAnchor(line) {
  const trimmed = String(line || "").replace(/[ \t]+$/, "");
  return trimmed === "^prj" || trimmed.endsWith(" ^prj") ||
    trimmed.endsWith("\t^prj");
}

function projectFrontmatterScheduled(sourceText) {
  const value = parseFrontmatterScalar(sourceText, "scheduled");
  if (value == null) {
    return { value: null, count: 0, valid: true };
  }
  if (value === "") {
    return { value: "", count: 1, valid: false };
  }
  const parsed = parseStrictCalendarDate(value);
  return {
    value: parsed ? formatCalendarDate(parsed) : value,
    count: 1,
    valid: !!parsed,
  };
}

function projectFrontmatterScheduledCount(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/);
  if (lines.length === 0 || !/^\s*---\s*$/.test(lines[0])) {
    return 0;
  }
  let count = 0;
  for (let line = 1; line < lines.length; line += 1) {
    if (/^\s*---\s*$/.test(lines[line])) {
      break;
    }
    if (/^scheduled\s*:/.test(lines[line])) {
      count += 1;
    }
  }
  return count;
}

function projectHasScanIssue(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/);
  const fenced = getFencedLineNumbers(lines);
  const prjLines = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    if (lineHasTrailingPrjAnchor(lines[line])) {
      prjLines.push(line);
    }
  }
  if (prjLines.length !== 1) {
    return prjLines.length > 1;
  }
  const scheduled = findScheduledFieldMatches(lines[prjLines[0]]);
  if (scheduled.length > 1) {
    return true;
  }
  if (scheduled.length === 1 && !parseStrictCalendarDate(scheduled[0].value)) {
    return true;
  }
  const frontmatterCount = projectFrontmatterScheduledCount(sourceText);
  if (frontmatterCount > 1) {
    return true;
  }
  if (frontmatterCount === 1) {
    const leftover = projectFrontmatterScheduled(sourceText);
    if (!leftover.valid) {
      return true;
    }
  }
  return false;
}

function projectMarkerHasOpenChild(lines, prjLine, options = {}) {
  const closedChildPaths = options.closedChildPaths instanceof Set
    ? options.closedChildPaths
    : new Set(Array.from(options.closedChildPaths || [], String));
  const notePaths = Array.isArray(options.notePaths)
    ? options.notePaths
    : [];
  const parentPath = String(options.path || "");
  const prjIndent = getLineIndentation(String(lines[prjLine] || "")).length;
  const seen = new Set();
  for (let line = prjLine + 1; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!text.trim()) {
      break;
    }
    const indent = getLineIndentation(text).length;
    if (indent <= prjIndent && parseListItemPrefix(text)) {
      break;
    }
    const prefix = parseListItemPrefix(text);
    if (!prefix) {
      continue;
    }
    const content = text.replace(/^([ \t]*)([-*+]|\d+[.)])[ \t]+/, "").trimStart();
    if (!content.startsWith(PROJECT_SUBPROJECTS_MARKER)) {
      continue;
    }
    PROJECT_WIKILINK_RE.lastIndex = 0;
    let match;
    let foundOpen = false;
    while ((match = PROJECT_WIKILINK_RE.exec(text)) !== null) {
      const target = String(match[1] || "").split("|")[0].split("#")[0].trim();
      const name = target;
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      const linkedPath = resolveProjectParentPath(target, parentPath, notePaths);
      if (linkedPath && closedChildPaths.has(linkedPath)) {
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      const before = text.slice(0, start).trimEnd();
      const after = text.slice(end).trimStart();
      if (before.endsWith("~~") && after.startsWith("~~")) {
        const marker = after.slice(2).trimStart();
        if (marker.startsWith("✅") || marker.startsWith("❌")) {
          continue;
        }
      }
      foundOpen = true;
    }
    return foundOpen;
  }
  return false;
}

function projectRemainingCount(sourceText, scheduleApplies, skipKeys, notePath) {
  const lines = String(sourceText || "").split(/\r?\n/);
  const fenced = getFencedLineNumbers(lines);
  let remaining = 0;
  for (let line = 0; line < lines.length; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const text = String(lines[line] || "");
    const status = getTaskStatusForLine(text, line);
    if (!status || PROJECT_CLOSED_MARKS.has(status.rawSymbol)) {
      continue;
    }
    if (!lineMatchesTasksGlobalFilterText(text)) {
      continue;
    }
    if (lineHasTrailingPrjAnchor(text)) {
      continue;
    }
    const parsed = parseTaskDependencyLine(text, "", line);
    if (parsed && skipKeys && notePath && (
      (parsed.blockId && skipKeys.has(`${notePath}\0^${parsed.blockId}`)) ||
      (parsed.taskId && skipKeys.has(`${notePath}\0id:${parsed.taskId}`))
    )) {
      continue;
    }
    const hidden = projectLineHasWholeTag(
      text.slice(projectTaskTextOffset(text)),
      PROJECT_HIDE_TAG,
    );
    const scheduledCount = findScheduledFieldMatches(text).length;
    if (hidden && !(scheduleApplies && scheduledCount < 2)) {
      continue;
    }
    remaining += 1;
  }
  return remaining;
}

function projectTaskAsSuccessor(project) {
  const task = project.projectTask;
  return {
    path: project.path,
    line: task.line,
    status: task.status,
    blockId: task.blockId,
    taskId: task.taskId,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.slice() : [],
    text: task.lineText,
    rawLine: task.lineText,
    scheduled: project.scheduled,
  };
}

// Sync's surface predicate on one note (PP2–PP6, PP20, PP26, PP28).
function projectSurfaceState(text, path, today, options = {}) {
  const source = String(text || "");
  const notePath = String(path || "");
  if (!notePath || successorIsDonePath(notePath) || isCanonicalDailyNotePath(notePath)) {
    return null;
  }
  if (!project089TypeIsProject(source)) {
    return null;
  }
  if (project089StatusIsTerminal(source)) {
    return null;
  }
  if (projectHasScanIssue(source)) {
    return null;
  }
  const project = project089Info(source, notePath);
  if (!project || !project.projectTask) {
    return null;
  }
  const leftover = projectFrontmatterScheduled(source);
  const scheduleApplies = leftover.count > 0
    ? leftover.valid
    : !!project.scheduled;
  const scheduled = leftover.count > 0 && leftover.valid
    ? leftover.value
    : project.scheduled;
  const skipKeys = options.skipKeys instanceof Set ? options.skipKeys : null;
  const remaining = projectRemainingCount(source, scheduleApplies, skipKeys, notePath);
  const lines = source.split(/\r?\n/);
  const subopen = projectMarkerHasOpenChild(lines, project.projectTask.line, {
    path: notePath,
    notePaths: options.notePaths,
    closedChildPaths: options.closedChildPaths,
  });
  return {
    path: notePath,
    project,
    projectTask: project.projectTask,
    task: projectTaskAsSuccessor(project),
    scheduled: scheduled || null,
    remaining,
    subopen,
    empty: remaining === 0 && !subopen,
    hidden: projectLineHasWholeTag(
      project.projectTask.lineText.slice(
        projectTaskTextOffset(project.projectTask.lineText),
      ),
      PROJECT_HIDE_TAG,
    ),
  };
}

function projectClosedSkipKeys(closed) {
  const keys = new Set();
  for (const identity of Array.isArray(closed) ? closed : []) {
    if (!identity) {
      continue;
    }
    const path = String(identity.path || "");
    if (identity.blockId) {
      keys.add(`${path}\0^${identity.blockId}`);
    }
    if (identity.taskId) {
      keys.add(`${path}\0id:${identity.taskId}`);
    }
  }
  return keys;
}

function projectClosedTaskIds(closed) {
  const ids = new Set();
  for (const identity of Array.isArray(closed) ? closed : []) {
    if (identity && identity.taskId) {
      ids.add(String(identity.taskId));
    }
  }
  return ids;
}

function projectIdentityIsPrj(identity) {
  return identity && String(identity.blockId || "").toLowerCase() === "prj";
}

function projectPredsForNote(closed, path) {
  return (Array.isArray(closed) ? closed : []).filter(
    (identity) =>
      identity &&
      String(identity.path || "") === String(path || "") &&
      !projectIdentityIsPrj(identity),
  );
}

function projectPredsForDepends(closed, dependsOn) {
  const ids = new Set((dependsOn || []).map((id) => String(id)));
  return (Array.isArray(closed) ? closed : []).filter(
    (identity) => identity && identity.taskId && ids.has(String(identity.taskId)),
  );
}

function projectPredecessorRows(preds) {
  return preds.map((identity) => ({
    note_path: String(identity.path || ""),
    block_id: String(identity.blockId || ""),
    text: String(identity.text || ""),
  }));
}

function projectPullInDisplayText(task, lineText) {
  const raw = lineText != null ? String(lineText) : (task && task.rawLine) || "";
  const cleaned = cleanDescription(
    successorBodyAfterStatusBox(raw),
    "#task",
    (task && task.blockId) || null,
  );
  return cleaned
    .split(/\s+/)
    .filter((token) => token && token !== PROJECT_PRJ_TAG &&
      token !== PROJECT_BLOCKED_TAG &&
      projectWholeTagSpans(token, PROJECT_HIDE_TAG).length === 0)
    .join(" ");
}

function projectScheduledIsFuture(scheduled, today) {
  const date = parseStrictCalendarDate(scheduled);
  const anchor = parseStrictCalendarDate(today);
  return !!date && !!anchor && compareCalendarDates(date, anchor) > 0;
}

function projectLocationKey(path, line) {
  return `${path}\0${line}`;
}

function projectPullInCandidatePaths(closed, noteTexts, today) {
  const skipKeys = projectClosedSkipKeys(closed);
  const paths = [];
  const seen = new Set();
  for (const identity of Array.isArray(closed) ? closed : []) {
    if (!identity || !identity.path || projectIdentityIsPrj(identity)) {
      continue;
    }
    const path = String(identity.path);
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const surface = projectSurfaceState(
      projectNoteTextFor(noteTexts, path),
      path,
      today,
      { skipKeys },
    );
    if (surface && surface.empty) {
      paths.push(path);
    }
  }
  return paths;
}

function projectEarliestAnchor(preds, closed, anchors) {
  const anchored = preds.map((identity) => {
    const position = closed.findIndex((candidate) => candidate === identity);
    return {
      identity,
      anchor: position === -1
        ? { kind: "none", entryLine: null, bulletLine: null }
        : anchors[position],
    };
  });
  anchored.sort(
    (left, right) =>
      successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor) ||
      (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1),
  );
  return anchored[0] || null;
}

// Plan pull-in verdicts in planSuccessors' recover / mark / still-blocked
// shapes. One row per R; pull-ins replace SL11 project_task / hidden.

function planProjectPullIns(options = {}) {
  const closed = Array.isArray(options.closed) ? options.closed : [];
  const index =
    options.index && typeof options.index === "object"
      ? options.index
      : { byDependsOn: new Map(), byTaskId: new Map(), tasks: [] };
  const noteTexts =
    options.noteTexts && typeof options.noteTexts === "object" ? options.noteTexts : {};
  const notePaths = Array.isArray(options.notePaths)
    ? options.notePaths
    : Object.keys(noteTexts);
  const today =
    typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate();
  const dailyBefore = successorNormalizeLines(options.dailyBefore ?? []);
  const closingEntry = Number.isInteger(options.closingEntry)
    ? options.closingEntry
    : null;
  const dailyPath = typeof options.dailyPath === "string" ? options.dailyPath : "";
  const linkUnblocked = options.linkUnblocked !== false;
  const cancelledClose = options.cancelled === true;
  const skipKeys = projectClosedSkipKeys(closed);
  const closedTaskIds = projectClosedTaskIds(closed);
  const surfaceCache = new Map();
  const cachedSurface = (noteText, path, closedChildPaths = new Set()) => {
    const childKey = [...closedChildPaths].sort().join("\0");
    const key = `${String(path || "")}\0${childKey}`;
    if (surfaceCache.has(key)) {
      return surfaceCache.get(key);
    }
    const surface = projectSurfaceState(noteText, path, today, {
      skipKeys,
      notePaths,
      closedChildPaths,
    });
    surfaceCache.set(key, surface);
    return surface;
  };
  const byTaskId = index.byTaskId instanceof Map ? index.byTaskId : new Map();
  const openIdsAfter = new Set();
  for (const [id, task] of byTaskId) {
    if (
      task &&
      DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) &&
      !closedTaskIds.has(String(id))
    ) {
      openIdsAfter.add(String(id));
    }
  }

  const anchors = computeSuccessorAnchors(closed, dailyBefore, {
    closingEntry,
    dailyPath,
  });
  const liveBefore = parseSuccessorLedgerEntries(dailyBefore);
  const hasLiveLinkBefore = (task) =>
    liveBefore.some((entry) =>
      entry.links.some((link) =>
        successorLinkMatchesIdentity(
          link,
          { path: task.path, blockId: task.blockId },
          dailyPath,
        ),
      ),
    );

  const candidates = new Map();
  const addCandidate = (surface, preds, { parentPullIn = false } = {}) => {
    if (!surface || !surface.empty || !surface.task) {
      return;
    }
    const task = surface.task;
    if (closed.some((identity) =>
      identity &&
      String(identity.path || "") === String(task.path) &&
      (
        (identity.blockId && String(identity.blockId) === String(task.blockId || "")) ||
        (identity.taskId && task.taskId && String(identity.taskId) === String(task.taskId))
      )
    )) {
      return;
    }
    const key = projectLocationKey(task.path, task.line);
    const existing = candidates.get(key);
    const merged = existing
      ? [...existing.preds]
      : [];
    for (const pred of preds) {
      if (!merged.includes(pred)) {
        merged.push(pred);
      }
    }
    candidates.set(key, {
      surface,
      preds: merged,
      parentPullIn: parentPullIn || Boolean(existing && existing.parentPullIn),
    });
  };

  const seenNotes = new Set();
  for (const identity of closed) {
    if (!identity || !identity.path || projectIdentityIsPrj(identity)) {
      continue;
    }
    const path = String(identity.path);
    if (seenNotes.has(path)) {
      continue;
    }
    seenNotes.add(path);
    const surface = cachedSurface(projectNoteTextFor(noteTexts, path), path);
    if (surface) {
      addCandidate(surface, projectPredsForNote(closed, path));
    }
  }

  // Trigger (c): closing a child project's ^prj can empty its parent's
  // Sub-projects marker. Treat only the closed child links as resolved.
  for (const [parentPath, closedChildPaths] of projectPullInParentPathMap(
    closed,
    noteTexts,
    notePaths,
  )) {
    const surface = cachedSurface(
      projectNoteTextFor(noteTexts, parentPath),
      parentPath,
      closedChildPaths,
    );
    const preds = closed.filter((identity) =>
      identity && projectIdentityIsPrj(identity) &&
      closedChildPaths.has(String(identity.path || ""))
    );
    addCandidate(surface, preds, { parentPullIn: true });
  }

  const allTasks = Array.isArray(index.tasks) ? index.tasks : [];
  for (const task of allTasks) {
    if (
      !task ||
      !successorIsProjectTask(task.blockId) ||
      !Array.isArray(task.dependsOn) ||
      !task.dependsOn.some((id) => closedTaskIds.has(String(id)))
    ) {
      continue;
    }
    const noteText = projectNoteTextFor(noteTexts, task.path);
    if (!noteText) {
      continue;
    }
    const surface = cachedSurface(noteText, task.path);
    if (surface) {
      addCandidate(surface, projectPredsForDepends(closed, task.dependsOn));
    }
  }

  const stillBlocked = [];
  const recovers = [];
  const successorMarks = [];
  const locations = new Set();
  const cascadePaths = new Set();

  for (const { surface, preds, parentPullIn } of candidates.values()) {
    const task = surface.task;
    const key = projectLocationKey(task.path, task.line);
    locations.add(key);
    const predecessorRows = projectPredecessorRows(preds);
    if (prjInheritsBlock(task.rawLine)) {
      const target = projectParentTarget(
        projectNoteTextFor(noteTexts, task.path),
      );
      const parentPath = resolveProjectParentPath(
        target,
        task.path,
        notePaths,
      );
      stillBlocked.push({
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: projectPullInDisplayText(task, task.rawLine),
        status_symbol: task.status,
        reason: "project",
        waits_on: 0,
        scheduled: null,
        project: parentPath || target || task.path,
        trigger: "project_empty",
      });
      continue;
    }
    const postOpen = (task.dependsOn || []).filter((id) => openIdsAfter.has(String(id)));
    if (postOpen.length > 0) {
      stillBlocked.push({
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: projectPullInDisplayText(task, task.rawLine),
        status_symbol: task.status,
        reason: "waits_on",
        waits_on: postOpen.length,
        scheduled: null,
        project: task.path,
        trigger: "project_empty",
      });
      continue;
    }
    if (projectScheduledIsFuture(surface.scheduled, today)) {
      stillBlocked.push({
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: projectPullInDisplayText(task, task.rawLine),
        status_symbol: task.status,
        reason: "scheduled",
        waits_on: 0,
        scheduled: surface.scheduled,
        project: task.path,
        trigger: "project_empty",
      });
      continue;
    }
    if (task.status === "?") {
      cascadePaths.add(task.path);
    }
    const hideRemoved = surface.hidden === true;
    const anchored = projectEarliestAnchor(preds, closed, anchors);
    const hasAnchor = anchored && anchored.anchor && anchored.anchor.kind !== "none";
    const alreadyPlanned = hasLiveLinkBefore(task);
    if (alreadyPlanned) {
      recovers.push({
        task,
        reason: "already_planned",
        predecessorRows,
        pullIn: true,
        hideRemoved,
        raiseToNext: true,
      });
      continue;
    }
    if (cancelledClose && parentPullIn) {
      recovers.push({
        task,
        reason: "cancelled",
        predecessorRows,
        pullIn: true,
        hideRemoved,
      });
      continue;
    }
    if (!hasAnchor) {
      recovers.push({
        task,
        reason: "not_planned_today",
        predecessorRows,
        pullIn: true,
        hideRemoved,
      });
      continue;
    }
    if (cancelledClose) {
      recovers.push({
        task,
        reason: "cancelled",
        predecessorRows,
        pullIn: true,
        hideRemoved,
      });
      continue;
    }
    if (!linkUnblocked) {
      recovers.push({
        task,
        reason: "disabled",
        predecessorRows,
        pullIn: true,
        hideRemoved,
      });
      continue;
    }
    successorMarks.push({
      task,
      anchor: anchored.anchor,
      predecessorRows,
      notePath: task.path,
      line: task.line,
      pullIn: true,
      hideRemoved,
    });
  }

  return {
    hasCandidates: candidates.size > 0,
    locations,
    still_blocked: stillBlocked,
    recovers,
    successorMarks,
    cascadePaths,
  };
}

function projectPullInRewriteLine(before, rank, options = {}) {
  const stripped = removeProjectHideTags(before);
  const recoverRank = options.recoverRank === true;
  if (recoverRank) {
    const rewritten = rewriteRecoveredTaskLine(stripped, rank, {
      markUnblockedLine: options.markUnblockedLine,
      today: options.today,
      isDailyNote: options.isDailyNote,
      isToday: options.isToday,
    });
    return rewritten == null ? stripped : rewritten;
  }
  return replaceTaskStatusSymbol(stripped, rank);
}

function applySuccessorVerdicts(context) {
  const recovers = Array.isArray(context.recovers) ? context.recovers : [];
  const successorMarks = Array.isArray(context.successorMarks)
    ? context.successorMarks
    : [];
  const stillBlocked = Array.isArray(context.stillBlocked) ? context.stillBlocked : [];
  const edits = Array.isArray(context.projectTagStripEdits)
    ? context.projectTagStripEdits.slice()
    : [];
  const dailyPath = context.dailyPath || "";
  const today = context.today;
  const markUnblockedLine = context.markUnblockedLine;
  const isInbox = context.isInbox;
  const basenameCounts = context.basenameCounts;
  const noteTexts = context.noteTexts || {};
  const hasLiveLink = context.hasLiveLink;

  const unblocked = [];
  let placements = [];

  const pushRow = (task, rank, extra) => {
    const pullIn = extra.pullIn === true;
    const before = task.rawLine != null ? String(task.rawLine) : null;
    let after = before;
    if (before != null) {
      after = pullIn
        ? projectPullInRewriteLine(before, rank, {
          recoverRank: extra.recoverRank === true,
          markUnblockedLine,
          today,
          isDailyNote: isDailyNotePath(task.path),
          isToday: hasLiveLink(task),
        })
        : extra.linked
          ? extra.after
          : rewriteRecoveredTaskLine(before, rank, {
            markUnblockedLine,
            today,
            isDailyNote: isDailyNotePath(task.path),
            isToday: hasLiveLink(task),
          });
    }
    const hideRemoved = pullIn && before != null &&
      removeProjectHideTags(before) !== before;
    if (rank === task.status && !extra.always && !hideRemoved && !extra.linked) {
      return null;
    }
    if (before !== after && after != null) {
      edits.push({ path: task.path, line: task.line, before, after });
    }
    const text = pullIn
      ? projectPullInDisplayText(task, after != null ? after : before)
      : successorDisplayText(task);
    const row = {
      note_path: task.path,
      block_id: extra.blockId || task.blockId || "",
      line: task.line,
      text,
      previous_status_symbol: task.status,
      previous_status_name: successorStatusName(task.status),
      status_symbol: rank,
      status_name: successorStatusName(rank),
      inbox: isInbox(task.path) === true,
      unblocked_by: extra.predecessorRows || [],
      link: extra.link || null,
      not_linked: extra.not_linked == null ? null : extra.not_linked,
      trigger: pullIn ? "project_empty" : "dependency",
      hide_removed: hideRemoved,
    };
    unblocked.push(row);
    return unblocked.length - 1;
  };

  const pushRecover = (recover, alwaysReason) => {
    const task = recover.task;
    const pullIn = recover.pullIn === true;
    const rank = recover.raiseToNext
      ? (task.status === "?" || task.status === " " ? "*" : task.status)
      : (task.status === "?"
        ? (hasLiveLink(task) ? "*" : " ")
        : task.status);
    const reason = alwaysReason || recover.reason;
    pushRow(task, rank, {
      pullIn,
      recoverRank: pullIn && !recover.raiseToNext,
      always: recover.hideRemoved === true || alwaysReason === "breaker",
      predecessorRows: recover.predecessorRows,
      not_linked: reason,
    });
  };

  const pullInMarks = successorMarks.filter((mark) => mark.pullIn);
  const regularMarks = successorMarks.filter((mark) => !mark.pullIn);
  const broken = regularMarks.length > SUCCESSOR_BREAKER_LIMIT;
  for (const recover of recovers) {
    pushRecover(recover, false);
  }
  const linkedMarks = broken ? pullInMarks : successorMarks.slice().sort(successorOrderCompare);
  if (broken) {
    pullInMarks.sort(successorOrderCompare);
  }
  const mintedByNote = new Map();
  for (const mark of linkedMarks) {
    const task = mark.task;
    const rank = task.status === "?" || task.status === " " ? "*" : task.status;
    let blockId = task.blockId || "";
    let blockIdCreated = false;
    const before = task.rawLine != null ? String(task.rawLine) : null;
    let after = null;
    if (mark.pullIn) {
      after = null;
    } else {
      if (!blockId) {
        if (!mintedByNote.has(task.path)) {
          mintedByNote.set(
            task.path,
            collectSuccessorUsedIds(noteTexts[task.path] ?? ""),
          );
        }
        const used = mintedByNote.get(task.path);
        blockId = mintBlockId(
          cleanDescription(successorBodyAfterStatusBox(task.rawLine || ""), "#task"),
          used,
        );
        used.add(blockId);
        blockIdCreated = true;
      }
      after = before != null ? replaceTaskStatusSymbol(before, rank) : null;
      if (after != null && blockIdCreated) {
        after = `${after.replace(/\s+$/, "")} ^${blockId}`;
      }
    }
    const rowIndex = pushRow(task, rank, {
      pullIn: mark.pullIn === true,
      linked: true,
      after,
      blockId,
      predecessorRows: mark.predecessorRows,
      not_linked: null,
      link: {
        day_file: dailyPath,
        entry_name: "",
        entry_line: null,
        entry_created: false,
        next_up: false,
        line: null,
        block_link: successorLinkText(task.path, blockId, dailyPath, basenameCounts),
        block_id_created: blockIdCreated,
      },
    });
    if (rowIndex != null) {
      placements.push({
        key: `${task.path}|${blockId}`,
        rowIndex,
        anchor: mark.anchor,
        blockLink: unblocked[rowIndex].link.block_link,
      });
    }
  }
  if (broken) {
    for (const mark of regularMarks) {
      pushRecover(mark, "breaker");
    }
    // Pull-ins still link; only regular successors are broken.
  }

  return {
    unblocked,
    still_blocked: stillBlocked,
    edits,
    placements,
    unblocked_check: "checked",
  };
}
