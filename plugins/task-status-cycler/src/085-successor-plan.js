// Pure successor-offer planner (docs/task-dependencies.md §12). Pure code
// only: no vault reads, no editor writes.

const SUCCESSOR_NOTICE_TEXT_LIMIT = 48;

// Status-type names, matching bob-cli's capture output (`/` is In Progress,
// `*` is Next, `?` is Blocked, anything else reads Ready).
function successorStatusName(symbol) {
  if (symbol === "?") {
    return "Blocked";
  }
  if (symbol === "*") {
    return "Next";
  }
  if (symbol === "/") {
    return "In Progress";
  }
  return "Ready";
}

// Normalize one Tasks cache task to successor pool shape, or null when it
// carries no usable location. Field names differ across Tasks versions, so
// every known alias is tried (ported from nav's `normalizeStageCacheTask`,
// `300-dependency-stage.js:360`, and its `readStageTasksCache` shape
// handling, `590-plugin-dependency-stage.js:226`).
function normalizeTasksCacheTask(entry) {
  const task = entry && typeof entry === "object" ? entry : null;
  if (!task) {
    return null;
  }
  const location =
    task.taskLocation && typeof task.taskLocation === "object"
      ? task.taskLocation
      : {};
  const file = task.file && typeof task.file === "object" ? task.file : {};
  const path = normalizeDependencyMarkdownPath(
    task.path || location.path || file.path || "",
  );
  if (!path) {
    return null;
  }
  const status =
    (task.status && task.status.symbol) ||
    task.statusSymbol ||
    (typeof task.status === "string" ? task.status : null) ||
    " ";
  let line = -1;
  for (const candidate of [
    task.lineNumber,
    task.line,
    location.lineNumber,
    location.line,
  ]) {
    const numeric = Math.floor(
      typeof candidate === "number" ? candidate : Number.NaN,
    );
    if (Number.isFinite(numeric) && numeric >= 0) {
      line = numeric;
      break;
    }
  }
  const rawLine =
    typeof task.originalMarkdown === "string" ? task.originalMarkdown : null;
  const text =
    (typeof task.description === "string" && task.description) ||
    (typeof task.text === "string" && task.text) ||
    (rawLine ? successorBodyAfterStatusBox(rawLine) : "(untitled task)");
  const trailingId =
    (typeof task.blockId === "string" && task.blockId) ||
    (rawLine ? getTrailingBlockId(rawLine) : null) ||
    null;
  const idField =
    (typeof task.id === "string" && task.id) ||
    (task.taskId != null ? String(task.taskId) : null) ||
    null;
  const dependsOn = Array.isArray(task.dependsOn)
    ? task.dependsOn
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0)
    : [];
  const scheduledMatches = rawLine ? findScheduledFieldMatches(rawLine) : [];
  return {
    path,
    line,
    status: String(status || " "),
    hidden: task.hidden === true,
    blockId: trailingId
      ? String(trailingId).replace(/^\^/, "").trim() || null
      : null,
    taskId: idField ? String(idField).trim() || null : null,
    dependsOn,
    text: String(text || ""),
    rawLine,
    scheduled: scheduledMatches.length > 0 ? scheduledMatches[0].value : null,
  };
}

// Normalize parsed vault documents to successor pool shape, built on the
// existing `parseTaskDependencyDocument`. `documents` is
// `[{ path, text }]`.
function tasksFromDocuments(documents) {
  const tasks = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const path = normalizeDependencyMarkdownPath(
      (document && document.path) || "",
    );
    if (!path) {
      continue;
    }
    const text = String((document && document.text) || "");
    for (const parsed of parseTaskDependencyDocument(text, path)) {
      const scheduledMatches = findScheduledFieldMatches(parsed.lineText);
      tasks.push({
        path: parsed.path,
        line: parsed.line,
        status: parsed.status,
        blockId: parsed.blockId,
        taskId: parsed.taskId,
        dependsOn: parsed.dependsOn.slice(),
        text: parsed.lineText,
        rawLine: parsed.lineText,
        scheduled: scheduledMatches.length > 0 ? scheduledMatches[0].value : null,
      });
    }
  }
  return tasks;
}

// Reverse index over normalized successor tasks
// (`{ path, line, status, blockId, taskId, dependsOn[], text, rawLine,
// scheduled }`). `byTaskId` covers only tasks with an explicit `[id::]`
// (the one identity blocking resolves under); `tasks` keeps every task in
// input order so dependents without an `[id::]` of their own still qualify.
function buildDependentsIndex(tasks) {
  const byDependsOn = new Map();
  const byTaskId = new Map();
  const all = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== "object") {
      continue;
    }
    all.push(task);
    if (task.taskId) {
      if (!byTaskId.has(task.taskId)) {
        byTaskId.set(task.taskId, task);
      }
    }
    for (const id of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
      if (!id) {
        continue;
      }
      if (!byDependsOn.has(id)) {
        byDependsOn.set(id, []);
      }
      byDependsOn.get(id).push(task);
    }
  }
  return { byDependsOn, byTaskId, tasks: all };
}

function successorNormalizeLines(dailyLines) {
  if (Array.isArray(dailyLines)) {
    return dailyLines.map((line) => String(line ?? ""));
  }
  return String(dailyLines ?? "").split(/\r?\n/);
}

// Whether a link token spans a list item's whole body, ignoring surrounding
// whitespace and one trailing `#` deferral marker.
function successorTokenSpansListBody(lineText, startIndex, endIndex) {
  const line = String(lineText || "");
  const listMatch = line.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return false;
  }
  const bodyStart = listMatch[1].length;
  let end = line.length;
  while (end > bodyStart && (line[end - 1] === " " || line[end - 1] === "\t")) {
    end -= 1;
  }
  if (end - 1 > bodyStart && line[end - 1] === "#") {
    end -= 1;
  }
  while (end > bodyStart && (line[end - 1] === " " || line[end - 1] === "\t")) {
    end -= 1;
  }
  let start = bodyStart;
  while (start < end && (line[start] === " " || line[start] === "\t")) {
    start += 1;
  }
  return startIndex === start && endIndex === end;
}

// Whether a single sub-bullet line is a live Task Link: after stripping 🍅
// markers, its body is exactly one block link (plain, embed, or
// `#`-deferred) and the link is unstruck. Struck links and Depends-On lines
// are history, not plans. Returns `{ pathPart, blockId, embedded }` or null.
function parseSuccessorLiveLink(lineText) {
  const stripped = stripPomodoroMarkersFromLine(lineText);
  if (isTaskDependencyLine(stripped)) {
    return null;
  }
  const spans = getStrikethroughSpans(stripped);
  const embedded = parseEmbeddedBlockTransclusions(stripped);
  if (embedded.length === 1) {
    const candidate = embedded[0];
    if (
      successorTokenSpansListBody(stripped, candidate.startIndex, candidate.endIndex) &&
      !rangeIsStruck(candidate.startIndex, candidate.endIndex, spans)
    ) {
      return {
        pathPart: candidate.pathPart,
        blockId: candidate.blockId,
        embedded: true,
      };
    }
    return null;
  }
  if (embedded.length > 1) {
    return null;
  }
  const bare = getBareNonEmbeddedBlockLinkTargetFromListItem(stripped);
  if (bare && !rangeIsStruck(bare.startIndex, bare.endIndex, spans)) {
    return { pathPart: bare.pathPart, blockId: bare.blockId, embedded: false };
  }
  return null;
}

// One Pomodoro entry with its live links. `name` is null for unnamed
// entries; `links` is in ledger order.
function parseSuccessorLedgerEntries(lines) {
  const section = findPomodorosSectionInLines(lines);
  if (!section) {
    return [];
  }
  const entries = [];
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!isTopLevelTaskLine(lineText)) {
      continue;
    }
    const parts = parsePomodoroEntryLineParts(lineText);
    if (!parts) {
      continue;
    }
    const status = getTaskStatusForLine(lineText, line);
    const open = !!status && status.symbol === " ";
    const range = getSubBulletBlockRange(lines, line, section);
    // Live links live only under open entries: struck links and links under
    // closed entries are history, not plans (§12).
    const links = [];
    if (open) {
      for (let linkLine = range.startLine; linkLine < range.endLine; linkLine += 1) {
        const live = parseSuccessorLiveLink(lines[linkLine]);
        if (live) {
          links.push({ line: linkLine, ...live });
        }
      }
    }
    entries.push({
      entryLine: line,
      name: parts.name,
      placeholder: parts.placeholder,
      open,
      links,
    });
  }
  return entries;
}

// Per-entry live links in ledger order, built on
// `findPomodorosSectionInLines` / `getSubBulletBlockRange` / the
// `classifyPomodoroSubBullets` conventions (struck links never count; open
// means a `[ ]` entry).
function findLiveLinks(dailyLines) {
  return parseSuccessorLedgerEntries(successorNormalizeLines(dailyLines));
}

function successorLinkMatchesIdentity(link, identity, dailyPath) {
  if (!link || !identity || !link.blockId || !identity.blockId) {
    return false;
  }
  if (String(link.blockId) !== String(identity.blockId)) {
    return false;
  }
  const target = successorPathWithoutExtension(identity.path || "");
  if (!target) {
    return false;
  }
  if (!link.pathPart) {
    return (
      !!dailyPath &&
      normalizeDependencyMarkdownPath(identity.path || "") ===
        normalizeDependencyMarkdownPath(dailyPath)
    );
  }
  return (
    link.pathPart === target ||
    link.pathPart === successorPathBasename(identity.path || "")
  );
}

// Anchor each closed identity (`{ path, blockId, taskId, rootKey? }`) on the
// day text before the gesture: `closing` when its link sits under the
// Pomodoro this gesture closes, `slot` at its first live link in ledger
// order, `inherit` at its root's anchor for a closed subtask with no live
// link of its own, else `none`. Returns one anchor per closed entry:
// `{ kind, entryLine, bulletLine }` (`bulletLine` is null for closing and
// none anchors). `options.closingEntry` is the 0-based closed-entry line.
function computeSuccessorAnchors(closedIdentities, dailyLines, options = {}) {
  const lines = successorNormalizeLines(dailyLines);
  const closingEntry =
    options && Number.isInteger(options.closingEntry)
      ? options.closingEntry
      : null;
  const dailyPath =
    options && typeof options.dailyPath === "string" ? options.dailyPath : null;
  const entries = parseSuccessorLedgerEntries(lines);
  const anchorFor = (identity) => {
    if (closingEntry != null) {
      const closed = entries.find((entry) => entry.entryLine === closingEntry);
      if (
        closed &&
        closed.links.some((link) =>
          successorLinkMatchesIdentity(link, identity, dailyPath),
        )
      ) {
        return { kind: "closing", entryLine: closingEntry, bulletLine: null };
      }
    }
    for (const entry of entries) {
      const link = entry.links.find((candidate) =>
        successorLinkMatchesIdentity(candidate, identity, dailyPath),
      );
      if (link) {
        return { kind: "slot", entryLine: entry.entryLine, bulletLine: link.line };
      }
    }
    return { kind: "none", entryLine: null, bulletLine: null };
  };
  return (Array.isArray(closedIdentities) ? closedIdentities : []).map(
    (identity) => {
      const direct = anchorFor(identity || {});
      if (direct.kind === "none" && identity && identity.rootKey) {
        const root = anchorFor(identity.rootKey);
        if (root.kind !== "none") {
          return {
            kind: "inherit",
            entryLine: root.entryLine,
            bulletLine: root.bulletLine,
          };
        }
      }
      return direct;
    },
  );
}

function successorHasHideTag(rawLine) {
  return String(rawLine || "")
    .split(/\s+/)
    .some((token) => token === "#hide");
}

function successorIsProjectTask(blockId) {
  return typeof blockId === "string" && blockId.toLowerCase() === "prj";
}

function successorIsDonePath(path) {
  return String(path || "")
    .split("/")
    .some((segment) => segment === "done");
}

// Row display text: the mint-pipeline cleaning of the body after the status
// box (mirroring Rust's `clean_description` row text).
function successorDisplayText(task, globalFilter = "#task") {
  if (!task) {
    return "";
  }
  if (task.rawLine) {
    return cleanDescription(
      successorBodyAfterStatusBox(task.rawLine),
      globalFilter,
      task.blockId || null,
    );
  }
  return String(task.text || "");
}

function collectSuccessorUsedIds(noteText) {
  const used = new Set();
  for (const line of successorNormalizeLines(noteText)) {
    const id = getTrailingBlockId(line);
    if (id) {
      used.add(String(id));
    }
  }
  return used;
}

// Default inbox check: `inbox.md` at the vault root (the root case of nav's
// `isInboxNotePath`). Pass a richer `isInbox` when vault frontmatter is
// available.
function successorDefaultIsInbox(path) {
  return normalizeDependencyMarkdownPath(path) === "inbox.md";
}

// Vault directories capture never walks (`vault_note_paths`): hidden
// dot-directories and the always-excluded names. Only directory segments
// count — a dotted file name is still eligible.
const SUCCESSOR_EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".obsidian",
  "_conflicts",
  "_generated",
  "_templates",
]);

function isExcludedSuccessorVaultPath(path) {
  const segments = String(path || "").split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (
      segment.startsWith(".") || SUCCESSOR_EXCLUDED_DIR_NAMES.has(segment)
    ) {
      return true;
    }
  }
  return false;
}

// Inbox predicate for the successor pass: nav's versioned `inboxRoute`
// API (`api.inboxRoute.version >= 1`, root `inbox.md` plus direct area
// children), else the host plugin's `isInboxNotePath`, else the safe
// root-`inbox.md` default. Never throws; per-path failures fall back.
function getSuccessorIsInbox(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const nav = plugins["bob-navigation-hotkeys"];
    const api = nav && nav.api;
    const route = api && api.inboxRoute;
    if (
      route && Number(route.version) >= 1 &&
      typeof route.isInboxNote === "function"
    ) {
      return (path) => {
        try {
          return route.isInboxNote(path) === true;
        } catch (error) {
          return successorDefaultIsInbox(path);
        }
      };
    }
    if (nav && typeof nav.isInboxNotePath === "function") {
      return (path) => {
        try {
          return nav.isInboxNotePath(path) === true;
        } catch (error) {
          return successorDefaultIsInbox(path);
        }
      };
    }
  } catch (error) {
    // Fall through to the default.
  }
  return successorDefaultIsInbox;
}

// Basename counts over the same eligible Markdown path set capture
// walks: every vault `.md` file minus dot-directories and the
// always-excluded names (`.git`, `.obsidian`, `_conflicts`, `_generated`,
// `_templates`), unioned with staged/open-editor paths. Bodies are never
// read. Never throws.
function countSuccessorBasenames(app, tasks, identities, dailyPath, noteTexts) {
  const counts = {};
  try {
    const knownPaths = new Set();
    const vault = app && app.vault;
    const files = vault && typeof vault.getMarkdownFiles === "function"
      ? vault.getMarkdownFiles()
      : [];
    for (const file of files) {
      const path = file && file.path;
      if (!path || !MARKDOWN_EXTENSION_RE.test(path)) {
        continue;
      }
      if (isExcludedSuccessorVaultPath(path)) {
        continue;
      }
      knownPaths.add(String(path));
    }
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (task && task.path) {
        knownPaths.add(String(task.path));
      }
    }
    for (const identity of Array.isArray(identities) ? identities : []) {
      if (identity && identity.path) {
        knownPaths.add(String(identity.path));
      }
    }
    if (dailyPath) {
      knownPaths.add(String(dailyPath));
    }
    if (noteTexts && typeof noteTexts.keys === "function") {
      for (const path of noteTexts.keys()) {
        if (path) {
          knownPaths.add(String(path));
        }
      }
    } else if (noteTexts && typeof noteTexts === "object") {
      for (const path of Object.keys(noteTexts)) {
        if (path) {
          knownPaths.add(String(path));
        }
      }
    }
    for (const path of knownPaths) {
      const base = path.split("/").pop() || "";
      const stem = (base.replace(/\.md$/i, "") || base).toLowerCase();
      if (!stem) {
        continue;
      }
      counts[stem] = (counts[stem] || 0) + 1;
    }
  } catch (error) {
    // Best effort: an empty count links long, never wrong-short.
  }
  return counts;
}

function successorAnchorPosition(anchor) {
  return anchor && anchor.entryLine != null
    ? anchor.entryLine
    : Number.MAX_SAFE_INTEGER;
}

function successorOrderCompare(left, right) {
  return (
    successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor) ||
    (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1) ||
    String(left.notePath || "").localeCompare(String(right.notePath || "")) ||
    (Number(left.line) || 0) - (Number(right.line) || 0)
  );
}

// Plan the successor-offer write set (§12.2). Options:
//
// - `closed`: identities this gesture moved open → Done
//   (`[{ path, blockId, taskId, text, rootKey? }]`); matching uses only the
//   `[id::]` (`taskId`) values.
// - `index`: a `buildDependentsIndex` result over the staged post-close
//   snapshot.
// - `dailyBefore`: day text (or lines) before the gesture — the
//   already-planned baseline and anchor source.
// - `dailyAfter`: day text (or lines) after the gesture for the derived
//   recover rank (defaults to `dailyBefore`; the strike never moves a
//   dependent's own links, but pass the post text when the same close can
//   drop them, e.g. `=x~K`).
// - `dailyPath`: vault-relative day path (day-file link exception, row
//   `day_file`).
// - `today`: `"YYYY-MM-DD"` (defaults to today).
// - `linkUnblocked`: the `plan.link_unblocked` kill switch (default true).
// - `cancelled`: a cancel close recovers only; rows report `cancelled`.
// - `isInbox`: `(path) => boolean` (default: root `inbox.md` check).
// - `basenameCounts`: lowercase-basename → vault-wide note count for the
//   §12.4 link form.
// - `closingEntry`: 0-based line of the Pomodoro this gesture closes.
// - `noteTexts`: `{ path: text }` staged note bodies for mint used-IDs.
// - `selection`: offer selection — null/undefined/[] links nothing (plan
//   offers only); `"all"` links every selectable offer; an array/Set of
//   offer keys links that subset (SO2–SO5, vector fixtures).
// - `stampLine`: freshness stamper `(line, dateText) => string` from
//   `this.getFreshnessStampLine()`; null preserves the safe no-stamp
//   behavior (§12.4 PICK).
//
// Note `line` in rows is 0-based (mirroring Rust's `line_index`); day-file
// `entry_line`/`line` in placements are 1-based (per §12.5). Returns
// `{ unblocked, still_blocked, edits, placements, unblocked_check }` with
// §12.5 snake_case rows; `edits` are `{ path, line, before, after }`
// (`before`/`after` are null when the source line is unknown, e.g. a cache
// task without `originalMarkdown` — the wiring re-reads the vault).
// `placements` carry `rowIndex` into `unblocked` and are already in ORDER
// (anchor ledger position, then note path, then line).
function planSuccessors(options = {}) {
  const closed = Array.isArray(options.closed) ? options.closed : [];
  const index =
    options.index && typeof options.index === "object"
      ? options.index
      : { byDependsOn: new Map(), byTaskId: new Map(), tasks: [] };
  const dailyBefore = successorNormalizeLines(options.dailyBefore ?? []);
  const dailyAfter = options.dailyAfter === undefined
    ? dailyBefore
    : successorNormalizeLines(options.dailyAfter);
  const dailyPath = typeof options.dailyPath === "string" ? options.dailyPath : "";
  const today =
    typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate();
  const markUnblockedLine = typeof options.markUnblockedLine === "function"
    ? options.markUnblockedLine
    : null;
  const linkUnblocked = options.linkUnblocked !== false;
  // `cycler_polish`: an Alt+]/Alt+[ move into Cancelled recovers only —
  // rows report `cancelled`, never `disabled`, and nothing links or mints.
  const cancelledClose = options.cancelled === true;
  const isInbox =
    typeof options.isInbox === "function" ? options.isInbox : successorDefaultIsInbox;
  const basenameCounts =
    options.basenameCounts instanceof Map ||
    (options.basenameCounts && typeof options.basenameCounts === "object")
      ? options.basenameCounts
      : {};
  const closingEntry = Number.isInteger(options.closingEntry)
    ? options.closingEntry
    : null;
  const noteTexts =
    options.noteTexts && typeof options.noteTexts === "object" ? options.noteTexts : {};
  const notePaths = Array.isArray(options.notePaths)
    ? options.notePaths
    : Object.keys(noteTexts);
  const selection = normalizeSuccessorSelection(options.selection);
  const stampLine = typeof options.stampLine === "function" ? options.stampLine : null;

  const empty = {
    unblocked: [],
    still_blocked: [],
    edits: [],
    placements: [],
    unblocked_check: "checked",
  };

  const closedTaskIds = new Set();
  for (const identity of closed) {
    if (identity && identity.taskId) {
      closedTaskIds.add(String(identity.taskId));
    }
  }
  const pullIns = planProjectPullIns({
    closed,
    index,
    dailyBefore,
    dailyAfter,
    dailyPath,
    today,
    linkUnblocked,
    cancelled: cancelledClose,
    closingEntry,
    noteTexts,
    notePaths,
    selection,
    stampLine,
  });
  const applyContext = (recovers, successorMarks, stillBlocked, projectTagStripEdits, hasLiveLink, extra = {}) =>
    applySuccessorVerdicts({
      recovers,
      successorMarks,
      stillBlocked,
      projectTagStripEdits,
      dailyPath,
      dailyBefore,
      dailyAfter,
      today,
      markUnblockedLine,
      stampLine,
      selection,
      isInbox,
      basenameCounts,
      noteTexts,
      notePaths,
      closingEntry,
      hasLiveLink,
      projectOffers: extra.projectOffers || [],
      foldedByProject: extra.foldedByProject || new Map(),
      projectHeaders: extra.projectHeaders || new Map(),
    });
  // GATE: no `[id::]` in C and no pull-in candidate → nothing.
  // A `[?]` R pull-in still recovers N's residents via the same
  // project-recovery wiring as the id branch (P3).
  if (closedTaskIds.size === 0) {
    if (!pullIns.hasCandidates) {
      return empty;
    }
    const liveAfterEntries = parseSuccessorLedgerEntries(dailyAfter);
    const hasLiveLink = (task) =>
      liveAfterEntries.some((entry) =>
        entry.links.some((link) =>
          successorLinkMatchesIdentity(
            link,
            { path: task.path, blockId: task.blockId },
            dailyPath,
          ),
        ),
      );
    const idlessRecovery = projectPullInRecoveryMembersForIdless(noteTexts, index, pullIns, today);
    return applyContext(
      [...pullIns.recovers, ...idlessRecovery.recovers],
      pullIns.successorMarks,
      pullIns.still_blocked,
      idlessRecovery.projectTagStripEdits,
      hasLiveLink,
    );
  }

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

  const allTasks = Array.isArray(index.tasks) ? index.tasks : [...byTaskId.values()];
  const wiring = projectPullInRecoveryWiring(noteTexts, index, pullIns, today, closedTaskIds);
  const projectInfoByPath = wiring.projectInfoByPath;
  const projectRecoveryPaths = wiring.projectRecoveryPaths;
  const projectTagStripEdits = wiring.projectTagStripEdits;
  const candidateByLocation = new Map();
  for (const task of allTasks) {
    if (
      task &&
      typeof task === "object" &&
      DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) &&
      !(task.taskId && closedTaskIds.has(String(task.taskId))) &&
      !successorIsDonePath(task.path) &&
      Array.isArray(task.dependsOn) &&
      task.dependsOn.some((id) => closedTaskIds.has(String(id)))
    ) {
      candidateByLocation.set(`${task.path}\0${task.line}`, task);
    }
  }
  for (const task of projectSuccessorRecoveryMembers(
    projectInfoByPath,
    projectRecoveryPaths,
  )) {
    if (!successorIsDonePath(task.path)) {
      candidateByLocation.set(`${task.path}\0${task.line}`, task);
    }
  }
  collectProjectResidentCandidates(candidateByLocation, projectInfoByPath, projectRecoveryPaths, noteTexts);
  const candidates = [...candidateByLocation.values()]
    .sort(
      (left, right) =>
        String(left.path || "").localeCompare(String(right.path || "")) ||
        (Number(left.line) || 0) - (Number(right.line) || 0),
    );

  const liveBefore = parseSuccessorLedgerEntries(dailyBefore);
  const liveAfter = dailyAfter === dailyBefore
    ? liveBefore
    : parseSuccessorLedgerEntries(dailyAfter);
  const hasLiveLink = (entries, task) =>
    entries.some((entry) =>
      entry.links.some((link) =>
        successorLinkMatchesIdentity(
          link,
          { path: task.path, blockId: task.blockId },
          dailyPath,
        ),
      ),
    );

  const anchors = computeSuccessorAnchors(closed, dailyBefore, {
    closingEntry,
    dailyPath,
  });
  const anchorOf = (identity) => {
    const position = closed.findIndex(
      (candidate) => candidate === identity,
    );
    return position === -1
      ? { kind: "none", entryLine: null, bulletLine: null }
      : anchors[position];
  };

  // Candidate verdicts in candidate order: still-blocked rows, recoveries
  // (`{ task, reason, always }`), and successor marked with their anchor.
  const stillBlocked = [];
  const recovers = [];
  const successorMarks = [];

  for (const task of candidates) {
    if (
      successorIsProjectTask(task.blockId) &&
      pullIns.locations.has(`${task.path}\0${task.line}`)
    ) {
      continue;
    }
    const project = projectInfoByPath.get(String(task.path || ""));
    const projectResident = project && task.blockId !== "prj" &&
      project.tasks.some((candidate) => candidate.line === task.line);
    const inRecovered = !!(project && projectResident && projectRecoveryPaths.has(task.path));
    const postOpen = (task.dependsOn || []).filter((id) => openIdsAfter.has(String(id)));
    if (postOpen.length > 0) {
      stillBlocked.push({
        note_path: task.path, block_id: task.blockId || "", line: task.line,
        text: successorDisplayText(task), status_symbol: task.status,
        reason: "waits_on", waits_on: postOpen.length, scheduled: null,
        ...(inRecovered ? { project: String(task.path || ""), mutedProject: true } : {}),
        trigger: "dependency",
      });
      continue;
    }
    const futureScheduled = task.rawLine ? findSingleFutureScheduledField(task.rawLine, today) : null;
    if (futureScheduled) {
      stillBlocked.push({
        note_path: task.path, block_id: task.blockId || "", line: task.line,
        text: successorDisplayText(task), status_symbol: task.status,
        reason: "scheduled", waits_on: 0, scheduled: futureScheduled.value,
        ...(inRecovered ? { project: String(task.path || ""), mutedProject: true } : {}),
        trigger: "dependency",
      });
      continue;
    }
    const projectTask = project && task.blockId === "prj";
    if (
      project && (projectResident || projectTask) &&
      projectIsBlockedAfter(project, openIdsAfter, today, closedTaskIds)
    ) {
      const projectDateBlocked = projectHasFutureSchedule(project, today);
      const projectOpenCount = project.dependencyIds.filter((id) => {
        const localIds = new Set(
          project.tasks.map((candidate) => candidate.taskId).filter(Boolean),
        );
        return !localIds.has(String(id)) && openIdsAfter.has(String(id)) &&
          !closedTaskIds.has(String(id));
      }).length;
      stillBlocked.push({
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: successorDisplayText(task),
        status_symbol: task.status,
        reason: "project",
        waits_on: projectOpenCount,
        scheduled: projectDateBlocked ? project.scheduled : null,
        project: String(task.path || ""),
        trigger: "dependency",
      });
      continue;
    }
    const predecessors = closed.filter(
      (identity) =>
        identity &&
        identity.taskId &&
        (task.dependsOn || []).some((id) => String(id) === String(identity.taskId)),
    );
    const predecessorRows = predecessors.map((identity) => ({
      note_path: String(identity.path || ""),
      block_id: String(identity.blockId || ""),
      text: String(identity.text || ""),
    }));
    const anchored = predecessors.map((identity) => ({
      identity,
      anchor: anchorOf(identity),
    }));
    const locationKey = `${task.path}\0${task.line}`;
    // 3. Project tasks recover but never link. A §12.10 pull-in replaces
    // this row (and a hidden recover) for the emptied project's ^prj.
    if (successorIsProjectTask(task.blockId)) {
      if (!pullIns.locations.has(locationKey)) {
        recovers.push({ task, reason: "project_task", predecessorRows });
      }
      continue;
    }
    if (project && projectResident && projectRecoveryPaths.has(task.path)) {
      // DEDUP (§12.2): a resident also directly dependent appears once in
      // hand_off, merging causes. Let it fall through to the hand-off offer
      // path below.
      if (!Array.isArray(task.dependsOn) || !task.dependsOn.some((id) => closedTaskIds.has(String(id)))) {
        const unblocking = closed.filter(
          (identity) => identity && identity.taskId &&
            project.dependencyIds.some((id) => String(id) === String(identity.taskId)),
        );
        const verdict = decideProjectResidentVerdict(task, project, unblocking, {
          openIdsAfter, today, hasLiveLinkBefore: (candidate) => hasLiveLink(liveBefore, candidate),
          cancelledClose, linkUnblocked, anchorOf, dailyBefore,
        });
        if (verdict.kind === "stillBlocked") {
          stillBlocked.push(verdict.row);
          continue;
        }
        if (verdict.kind === "recover") {
          recovers.push({ task, reason: verdict.reason, predecessorRows: verdict.predecessorRows, foldedProject: verdict.foldedProject });
          continue;
        }
        successorMarks.push({
          task, anchor: verdict.anchor, implicit: verdict.implicit,
          predecessorRows: verdict.predecessorRows, notePath: task.path, line: task.line,
          group: verdict.group, project: verdict.project,
        });
        continue;
      }
    }
    // 4. Hidden tasks recover but never link.
    if (
      task.hidden === true ||
      (task.rawLine && successorHasHideTag(task.rawLine))
    ) {
      if (!pullIns.locations.has(locationKey)) {
        recovers.push({ task, reason: "hidden", predecessorRows });
      }
      continue;
    }
    // 5. Already planned today: recover to the derived rank, never duplicate.
    if (hasLiveLink(liveBefore, task)) {
      recovers.push({ task, reason: "already_planned", predecessorRows });
      continue;
    }
    // 6-7. Kill switch / cancel: recovery only, never an offer (§12.2
    // steps 8–9). Checked before anchor resolution so disabled/cancelled
    // closes never prompt.
    if (cancelledClose || !linkUnblocked) {
      recovers.push({
        task,
        reason: cancelledClose ? "cancelled" : "disabled",
        predecessorRows,
      });
      continue;
    }
    // 8. Anchor or implicit destination (§12.2 step 7 + §12.3). A direct
    // offer uses the earliest predecessor slot/closing/inherit anchor; with
    // no anchor, resolve the implicit destination from the staged daily
    // text. Missing day/section/open entries or several open timed entries
    // yields no_destination and no offer.
    anchored.sort(
      (left, right) =>
        successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor) ||
        (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1),
    );
    const withAnchor = anchored.filter((pred) => pred.anchor.kind !== "none");
    if (withAnchor.length > 0) {
      successorMarks.push({
        task,
        anchor: withAnchor[0].anchor,
        predecessorRows,
        notePath: task.path,
        line: task.line,
        group: "hand_off",
      });
      continue;
    }
    const implicit = resolveSuccessorImplicitDestination(dailyBefore);
    if (!implicit) {
      recovers.push({ task, reason: "no_destination", predecessorRows });
      continue;
    }
    successorMarks.push({
      task,
      anchor: { kind: "implicit", entryLine: implicit.entryLine, bulletLine: null },
      implicit,
      predecessorRows,
      notePath: task.path,
      line: task.line,
      group: "hand_off",
    });
  }

  for (const recover of pullIns.recovers) {
    recovers.push(recover);
  }
  for (const mark of pullIns.successorMarks) {
    if (!mark.group) {
      mark.group = "project_finished";
    }
    successorMarks.push(mark);
  }
  for (const row of pullIns.still_blocked) {
    stillBlocked.push(row);
  }

  const { foldedByProject, projectHeaders } = computeProjectFoldedAndHeaders(projectInfoByPath, projectRecoveryPaths, noteTexts, recovers);

  return applyContext(
    recovers,
    successorMarks,
    stillBlocked,
    projectTagStripEdits,
    (task) => hasLiveLink(liveAfter, task),
    { foldedByProject, projectHeaders },
  );
}
