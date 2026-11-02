// Pure relation-successor classifier (docs/task-dependencies.md §12.18 R1–R7).
// No I/O, no writes. Runtime offers stay unwired until later phases.
//
// planSuccessorRelations(options) boundary:
//   In:
//     events[]                explicit (T, done|parked) with optional anchor
//     candidates[]            normalized incoming LINKS edges S → T
//                             (relationIndex public shape: source, target,
//                             label, kind, resolved). Mentions ignored.
//     outgoing[]              outgoing successor-label edges from sources (R6)
//     noteTexts               {path: markdown} fresh source/target notes
//     baselineDay, currentDay original baseline and post-gesture ledger
//     dailyPath, today, previousDailyPath
//     successorLabels         {keys, labels} after the three-list policy
//     linkUnblocked           plan.link_unblocked (default true)
//     cancelled               cancel never plans
//     navSuccessorsVersion    < 3 disables relation planning
//     relationIndexReady      false/"unavailable" → uncertainty, no rows
//     dependencySnapshotAvailable  false + dep fields → held blocked
//     recoveries              {identity: {recovered, projectBlocked, project,
//                             openPrerequisites, scheduled}}
//     parkedIdentities[]      sources parked by this gesture (R2)
//     baselineLive[]          sources live-linked on the original baseline
//     currentLive[]           identities live-linked after the gesture
//   Out:
//     marks[]                 offered relation rows (group/trigger "relation")
//     held[]                  held rows (already_planned is display:false)
//     groups[]                {group, label, key, event, after, rows, fold}
//     relation_check          "checked" | "unavailable" | null
//     scan                    whether the classifier considered candidates
//     warnings[]
// The later adapter discovers candidates from relationIndex; the pipeline
// supplies recoveries and merges with hand-off/project/keep-moving.

const RELATION_SUCCESSOR_OPEN_STATUSES = new Set([" ", "*", "/", "?"]);
const RELATION_SUCCESSOR_OFFER_STATUSES = new Set([" ", "*"]);
const RELATION_SUCCESSOR_LINKS_RE =
  /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:(?:🪢|🔗)[ \t]+)?\*\*(?:LINKS|LINKS TO):\*\*[ \t]*(.*)$/u;
const RELATION_SUCCESSOR_LINK_RE = /(?:~~)?!?\[\[([^\]\n]*)\]\](?:~~)?/g;

function relationIdentityKey(path, blockId, line) {
  const normalized = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(path || "")
    : String(path || "").replace(/\\/g, "/");
  const id = String(blockId || "").trim();
  if (normalized && id) return `${normalized}#^${id}`;
  if (normalized && Number.isInteger(line)) return `${normalized}#line:${line}`;
  return normalized || "";
}

function relationParseIdentityKey(key) {
  const text = String(key || "");
  const block = /^(.*)#\^([^#]+)$/.exec(text);
  if (block) return { path: block[1], blockId: block[2], line: null };
  const line = /^(.*)#line:(\d+)$/.exec(text);
  if (line) return { path: line[1], blockId: "", line: Number(line[2]) };
  return { path: text, blockId: "", line: null };
}

function relationPreviousDailyPath(today) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function relationNoteText(noteTexts, path) {
  if (!noteTexts || !path) return "";
  const normalized = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(path)
    : String(path);
  if (typeof noteTexts.get === "function") {
    return String(noteTexts.get(normalized) || noteTexts.get(path) || "");
  }
  return String(noteTexts[normalized] || noteTexts[path] || "");
}

function relationResolveNotePath(note, sourcePath, noteTexts) {
  const source = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(sourcePath || "")
    : String(sourcePath || "");
  if (!note) return source;
  let candidate = String(note).split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
  if (!candidate) return source;
  if (!/\.md$/i.test(candidate)) candidate = `${candidate}.md`;
  const normalized = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(candidate)
    : candidate;
  if (relationNoteText(noteTexts, normalized)) return normalized;
  const stem = normalized.split("/").pop().replace(/\.md$/i, "").toLowerCase();
  const keys = noteTexts && typeof noteTexts.keys === "function"
    ? [...noteTexts.keys()]
    : Object.keys(noteTexts || {});
  const matches = keys.filter((path) =>
    String(path).split("/").pop().replace(/\.md$/i, "").toLowerCase() === stem,
  );
  if (matches.length === 1) {
    return typeof normalizeDependencyMarkdownPath === "function"
      ? normalizeDependencyMarkdownPath(matches[0])
      : matches[0];
  }
  if (matches.length > 1) return "";
  return normalized;
}

function relationParseLinksBody(body) {
  const entries = [];
  const tokens = [];
  RELATION_SUCCESSOR_LINK_RE.lastIndex = 0;
  let token = RELATION_SUCCESSOR_LINK_RE.exec(body);
  while (token) {
    tokens.push({
      start: token.index,
      end: token.index + token[0].length,
      inner: token[1],
    });
    token = RELATION_SUCCESSOR_LINK_RE.exec(body);
  }
  RELATION_SUCCESSOR_LINK_RE.lastIndex = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const gap = String(body).slice(index === 0 ? 0 : tokens[index - 1].end, current.start);
    const rawLabel = gap.replace(/^[ \t]*(?:[•·,][ \t]*|[ \t]+)/u, "").trim();
    const inner = String(current.inner || "").split("|")[0];
    const hash = inner.lastIndexOf("#^");
    if (hash < 0) continue;
    const note = inner.slice(0, hash).trim();
    const blockId = inner.slice(hash + 2).trim();
    if (!blockId) continue;
    const reader = typeof normalizeRelationReaderLabel === "function"
      ? normalizeRelationReaderLabel(rawLabel)
      : rawLabel;
    entries.push({
      note,
      blockId,
      label: reader || rawLabel || null,
    });
  }
  return entries;
}

function relationDirectChildLines(lines, taskLine) {
  const parent = String(lines[taskLine] || "");
  const parentIndent = (parent.match(/^(\s*)/) || ["", ""])[1].length;
  const children = [];
  for (let line = taskLine + 1; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!text.trim()) continue;
    const indent = (text.match(/^(\s*)/) || ["", ""])[1].length;
    if (indent <= parentIndent) break;
    children.push({ line, text, indent });
  }
  return children;
}

function parseRelationSuccessorEdgesFromNotes(noteTexts) {
  const edges = [];
  const entries = noteTexts && typeof noteTexts.keys === "function"
    ? [...noteTexts.keys()].map((path) => [path, noteTexts.get(path)])
    : Object.entries(noteTexts || {});
  for (const [path, raw] of entries) {
    const sourcePath = typeof normalizeDependencyMarkdownPath === "function"
      ? normalizeDependencyMarkdownPath(path)
      : String(path || "");
    const lines = String(raw || "").split(/\r?\n/);
    const tasks = typeof parseTaskDependencyDocument === "function"
      ? parseTaskDependencyDocument(raw, sourcePath)
      : [];
    for (const task of tasks) {
      for (const child of relationDirectChildLines(lines, task.line)) {
        const match = RELATION_SUCCESSOR_LINKS_RE.exec(child.text);
        if (!match) continue;
        for (const entry of relationParseLinksBody(match[2] || "")) {
          const targetPath = relationResolveNotePath(entry.note, sourcePath, noteTexts);
          const targetTask = targetPath && typeof parseTaskDependencyDocument === "function"
            ? parseTaskDependencyDocument(relationNoteText(noteTexts, targetPath), targetPath)
              .find((item) => item.blockId === entry.blockId)
            : null;
          const resolved = Boolean(targetPath && targetTask);
          edges.push({
            source: {
              path: sourcePath,
              blockId: task.blockId || "",
              line: task.line,
              text: task.lineText,
              status: task.status,
            },
            target: {
              path: targetPath,
              blockId: entry.blockId,
              line: targetTask ? targetTask.line : null,
              text: targetTask ? targetTask.lineText : null,
              status: targetTask ? targetTask.status : null,
              resolved,
            },
            sourceKey: `${sourcePath}\u0000${task.blockId || ""}`,
            targetKey: targetPath ? `${targetPath}\u0000${entry.blockId}` : null,
            label: entry.label,
            kind: "relation",
            alsoMentioned: false,
            relationLine: child.line,
            raw: child.text,
            embedded: /!\[\[/.test(child.text),
            struck: /~~/.test(child.text),
            resolved,
          });
        }
      }
    }
  }
  return edges;
}

function buildFakeRelationIndex(noteTexts, options = {}) {
  const edges = parseRelationSuccessorEdgesFromNotes(noteTexts);
  const ready = options.ready !== false;
  const generation = Number.isInteger(options.generation) ? options.generation : 1;
  const incoming = (path, blockId) => {
    const key = relationIdentityKey(path, blockId);
    return edges.filter((edge) =>
      relationIdentityKey(edge.target.path, edge.target.blockId) === key,
    );
  };
  const outgoing = (path, blockIdOrLine) => {
    const sourcePath = typeof normalizeDependencyMarkdownPath === "function"
      ? normalizeDependencyMarkdownPath(path || "")
      : String(path || "");
    if (typeof blockIdOrLine === "number") {
      return edges.filter((edge) =>
        edge.source.path === sourcePath && edge.source.line === blockIdOrLine,
      );
    }
    const key = relationIdentityKey(path, blockIdOrLine);
    return edges.filter((edge) =>
      relationIdentityKey(edge.source.path, edge.source.blockId, edge.source.line) === key,
    );
  };
  return {
    ready: () => ready,
    generation,
    incoming,
    outgoing,
  };
}

function relationNormalizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const kind = event.event || event.kind;
  if (kind !== "done" && kind !== "parked") return null;
  let target = event.target;
  if (typeof target === "string") {
    const parsed = relationParseIdentityKey(target);
    target = {
      path: parsed.path,
      blockId: parsed.blockId,
      line: parsed.line,
      text: event.text || "",
    };
  }
  if (!target || typeof target !== "object") return null;
  const path = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(target.path || "")
    : String(target.path || "");
  return {
    event: kind,
    target: {
      path,
      blockId: String(target.blockId || ""),
      line: Number.isInteger(target.line) ? target.line : null,
      text: String(target.text || ""),
      status: target.status == null ? "" : String(target.status),
    },
    anchor: event.anchor || null,
  };
}

function relationNormalizeEdge(edge) {
  if (!edge || typeof edge !== "object") return null;
  if (edge.kind === "mention" || edge.struck === true) return null;
  const source = edge.source && typeof edge.source === "object" ? edge.source : {};
  const target = edge.target && typeof edge.target === "object" ? edge.target : {};
  const label = edge.label;
  const key = typeof relationLabelKey === "function" ? relationLabelKey(label) : String(label || "").toLowerCase();
  if (!key) return null;
  const sourcePath = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(source.path || "")
    : String(source.path || "");
  const targetPath = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(target.path || "")
    : String(target.path || "");
  const resolved = target.resolved !== false && edge.resolved !== false &&
    Boolean(targetPath && target.blockId);
  return {
    source: {
      path: sourcePath,
      blockId: String(source.blockId || ""),
      line: Number.isInteger(source.line) ? source.line : source.line,
      text: String(source.text || ""),
      status: source.status,
    },
    target: {
      path: targetPath,
      blockId: String(target.blockId || ""),
      line: target.line,
      text: target.text,
      status: target.status,
      resolved,
    },
    label: String(label || ""),
    key,
    kind: edge.kind || "relation",
    resolved,
  };
}

function relationLiveIdentitySet(dayText, dailyPath, extras) {
  const live = new Set();
  for (const item of Array.isArray(extras) ? extras : []) {
    if (typeof item === "string") {
      live.add(item);
      continue;
    }
    if (item && typeof item === "object") {
      const key = relationIdentityKey(item.path, item.blockId, item.line);
      if (key) live.add(key);
    }
  }
  if (dayText == null || dayText === "") return live;
  if (typeof parseSuccessorLedgerEntries !== "function") return live;
  const entries = parseSuccessorLedgerEntries(
    typeof successorNormalizeLines === "function" ? successorNormalizeLines(dayText) : String(dayText).split(/\r?\n/),
  );
  for (const entry of entries) {
    for (const link of entry.links || []) {
      const path = link.pathPart
        ? (/\.md$/i.test(link.pathPart) ? link.pathPart : `${link.pathPart}.md`)
        : dailyPath;
      const key = relationIdentityKey(path, link.blockId);
      if (key) live.add(key);
    }
  }
  return live;
}

function relationLookupTask(path, blockId, line, noteTexts) {
  const text = relationNoteText(noteTexts, path);
  if (!text || typeof parseTaskDependencyDocument !== "function") return null;
  const tasks = parseTaskDependencyDocument(text, path);
  if (blockId) {
    const match = tasks.find((task) => task.blockId === blockId);
    if (match) return match;
  }
  if (Number.isInteger(line)) {
    return tasks.find((task) => task.line === line) || null;
  }
  return null;
}

function relationSourceTask(edge, noteTexts) {
  const found = relationLookupTask(
    edge.source.path,
    edge.source.blockId,
    edge.source.line,
    noteTexts,
  );
  const lineText = found ? found.lineText : edge.source.text;
  const status = found ? found.status : edge.source.status;
  return {
    path: edge.source.path,
    blockId: found ? found.blockId : edge.source.blockId,
    line: found ? found.line : edge.source.line,
    text: lineText,
    rawLine: lineText,
    status,
    taskId: found ? found.taskId : null,
    dependsOn: found && Array.isArray(found.dependsOn) ? found.dependsOn.slice() : [],
  };
}

function relationIsPreviousDaily(path, previousDailyPath, today) {
  const normalized = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(path || "")
    : String(path || "");
  const previous = previousDailyPath || relationPreviousDailyPath(today);
  if (!previous) return false;
  const previousNormalized = typeof normalizeDependencyMarkdownPath === "function"
    ? normalizeDependencyMarkdownPath(previous)
    : previous;
  return normalized === previousNormalized;
}

function relationTargetReleased(target, eventKeys, currentLive, noteTexts) {
  const key = relationIdentityKey(target.path, target.blockId, target.line);
  if (eventKeys.has(key)) return true;
  const task = relationLookupTask(target.path, target.blockId, target.line, noteTexts);
  const status = String((task && task.status) || target.status || "");
  if (status === "x" || status === "X" || status === "-") return true;
  if (status === "/") return !currentLive.has(key);
  return false;
}

function relationBlockedDetails(source, recovery, snapshotAvailable, today) {
  const line = source.rawLine || source.text || "";
  const hasDepFields = (Array.isArray(source.dependsOn) && source.dependsOn.length > 0) ||
    /\[dependsOn::/i.test(line);
  const openPrereq = recovery && recovery.openPrerequisites != null
    ? Number(recovery.openPrerequisites)
    : null;
  if (hasDepFields && snapshotAvailable === false) {
    return {
      reason: "blocked",
      waits_on: Math.max(1, (source.dependsOn && source.dependsOn.length) || 1),
    };
  }
  if (source.status === "?") {
    return { reason: "blocked", waits_on: openPrereq != null ? openPrereq : 1 };
  }
  if (openPrereq > 0) {
    return { reason: "blocked", waits_on: openPrereq };
  }
  const future = typeof findSingleFutureScheduledField === "function"
    ? findSingleFutureScheduledField(line, today)
    : null;
  if (future) {
    return { reason: "blocked", scheduled: future.value || (recovery && recovery.scheduled) };
  }
  if (recovery && recovery.scheduled) {
    return { reason: "blocked", scheduled: recovery.scheduled };
  }
  if (recovery && recovery.projectBlocked) {
    const project = recovery.project && recovery.project !== true ? recovery.project : true;
    return { reason: "blocked", project };
  }
  return null;
}

function relationProjectBlockedDetails(source, noteTexts, openIds, closedIds, snapshotAvailable, today) {
  if (typeof project089Info !== "function" || typeof projectIsBlockedAfter !== "function") return null;
  const project = project089Info(relationNoteText(noteTexts, source.path), source.path);
  if (!project) return null;
  if (!snapshotAvailable && Array.isArray(project.dependencyIds) && project.dependencyIds.length > 0) {
    return {
      reason: "blocked",
      project: String(source.path || ""),
      waits_on: project.dependencyIds.length,
    };
  }
  if (!projectIsBlockedAfter(project, openIds, today, closedIds)) return null;
  return {
    reason: "blocked",
    project: String(source.path || ""),
    ...(typeof projectHasFutureSchedule === "function" && projectHasFutureSchedule(project, today)
      ? { scheduled: project.scheduled }
      : {}),
  };
}

function relationEmptyResult(overrides = {}) {
  return Object.freeze({
    marks: Object.freeze([]),
    held: Object.freeze([]),
    groups: Object.freeze([]),
    relation_check: overrides.relation_check === undefined ? null : overrides.relation_check,
    scan: overrides.scan === true,
    warnings: Object.freeze(Array.isArray(overrides.warnings) ? overrides.warnings.slice() : []),
  });
}

function planSuccessorRelations(options = {}) {
  const linkUnblocked = options.linkUnblocked !== false;
  const cancelled = options.cancelled === true;
  const navVersion = Number(options.navSuccessorsVersion);
  const successorLabels = options.successorLabels && typeof options.successorLabels === "object"
    ? options.successorLabels
    : emptyRelationLabelList();
  const successorKeys = new Set(
    Array.isArray(successorLabels.keys) ? successorLabels.keys.map((key) => relationLabelKey(key)) : [],
  );
  if (!linkUnblocked || successorKeys.size === 0 || cancelled ||
      (Number.isFinite(navVersion) && navVersion < 3)) {
    return relationEmptyResult({ relation_check: null, scan: false });
  }
  if (options.relationIndexReady === false || options.relationIndexReady === "unavailable") {
    return relationEmptyResult({ relation_check: "unavailable", scan: false });
  }

  const today = options.today || (typeof formatLocalDate === "function" ? formatLocalDate() : "");
  const dailyPath = options.dailyPath || "";
  const previousDailyPath = options.previousDailyPath || relationPreviousDailyPath(today);
  const noteTexts = options.noteTexts && typeof options.noteTexts === "object" ? options.noteTexts : {};
  const events = (Array.isArray(options.events) ? options.events : [])
    .map(relationNormalizeEvent)
    .filter(Boolean);
  const eventKeys = new Set(events.map((event) =>
    relationIdentityKey(event.target.path, event.target.blockId, event.target.line),
  ));
  const snapshotAvailable = options.dependencySnapshotAvailable !== false;
  const closedIds = new Set((Array.isArray(options.closedTaskIds) ? options.closedTaskIds : []).map(String));
  const openIds = new Set();
  for (const task of Array.isArray(options.dependencyTasks) ? options.dependencyTasks : []) {
    if (task && task.taskId && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) &&
        !closedIds.has(String(task.taskId))) {
      openIds.add(String(task.taskId));
    }
  }
  const recoveries = options.recoveries && typeof options.recoveries === "object"
    ? options.recoveries
    : {};
  const baselineLive = relationLiveIdentitySet(options.baselineDay, dailyPath, options.baselineLive);
  const currentLive = relationLiveIdentitySet(options.currentDay, dailyPath, options.currentLive);
  const parkedIdentities = new Set(
    (Array.isArray(options.parkedIdentities) ? options.parkedIdentities : []).map((item) =>
      typeof item === "string" ? item : relationIdentityKey(item.path, item.blockId, item.line),
    ),
  );
  for (const event of events) {
    if (event.event === "parked") {
      parkedIdentities.add(
        relationIdentityKey(event.target.path, event.target.blockId, event.target.line),
      );
    }
  }

  const candidateEdges = (Array.isArray(options.candidates) ? options.candidates : [])
    .map(relationNormalizeEdge)
    .filter(Boolean)
    .filter((edge) => successorKeys.has(edge.key) && edge.resolved);
  const outgoingEdges = (Array.isArray(options.outgoing) ? options.outgoing : candidateEdges)
    .map(relationNormalizeEdge)
    .filter(Boolean)
    .filter((edge) => successorKeys.has(edge.key));

  const offeredBySource = new Map();
  const held = [];
  const seenHeld = new Set();
  const pushHeld = (row) => {
    const key = `${row.key}\0${row.reason}`;
    if (seenHeld.has(key)) return;
    seenHeld.add(key);
    held.push(row);
  };

  for (const event of events) {
    const targetKey = relationIdentityKey(
      event.target.path,
      event.target.blockId,
      event.target.line,
    );
    const matching = candidateEdges.filter((edge) =>
      relationIdentityKey(edge.target.path, edge.target.blockId, edge.target.line) === targetKey,
    );
    for (const edge of matching) {
      const sourceKey = relationIdentityKey(
        edge.source.path,
        edge.source.blockId,
        edge.source.line,
      );
      if (!sourceKey || sourceKey === targetKey) continue;
      const foundSource = relationSourceTask(edge, noteTexts);
      const sourceIdentity = relationIdentityKey(foundSource.path, foundSource.blockId, foundSource.line);
      const recovery = recoveries[sourceIdentity] || recoveries[sourceKey] || {};
      const source = recovery.effectiveStatus
        ? { ...foundSource, status: recovery.effectiveStatus }
        : foundSource;
      const line = source.rawLine || source.text || "";
      const isOpenTask = RELATION_SUCCESSOR_OPEN_STATUSES.has(source.status) &&
        (typeof lineMatchesTasksGlobalFilterText === "function"
          ? lineMatchesTasksGlobalFilterText(line)
          : /(?:^|[^A-Za-z0-9_/#-])#task(?=$|\/|[^A-Za-z0-9_-])/.test(line));
      if (!isOpenTask || successorIsDonePath(source.path) ||
          relationIsPreviousDaily(source.path, previousDailyPath, today)) {
        continue;
      }
      const configuredLabel = successorLabels.labels && successorLabels.labels[edge.key]
        ? successorLabels.labels[edge.key]
        : edge.label;
      const targetTask = relationLookupTask(
        event.target.path,
        event.target.blockId,
        event.target.line,
        noteTexts,
      );
      const targetLine = (targetTask && targetTask.lineText) || event.target.text || "";
      const targetText = typeof successorDisplayText === "function"
        ? successorDisplayText({
          rawLine: targetLine,
          text: event.target.text,
          blockId: event.target.blockId,
        })
        : event.target.text;
      const baseHeld = {
        key: sourceIdentity,
        reason: "",
        label: configuredLabel,
        labelKey: edge.key,
        after: targetKey,
        event: event.event,
        text: typeof successorDisplayText === "function"
          ? successorDisplayText(source)
          : source.text,
        source,
        display: true,
      };

      if (parkedIdentities.has(sourceIdentity) || baselineLive.has(sourceIdentity)) {
        pushHeld({ ...baseHeld, reason: "already_planned", display: false });
        continue;
      }
      if (source.status === "/") {
        pushHeld({ ...baseHeld, reason: "already_started" });
        continue;
      }
      const openPrerequisites = snapshotAvailable && Array.isArray(options.dependencyTasks) &&
        Array.isArray(source.dependsOn) && source.dependsOn.length > 0
        ? source.dependsOn.filter((id) => openIds.has(String(id))).length
        : null;
      const effectiveRecovery = openPrerequisites == null
        ? recovery
        : { ...recovery, openPrerequisites };
      const blocked = relationBlockedDetails(source, effectiveRecovery, snapshotAvailable, today) ||
        relationProjectBlockedDetails(source, noteTexts, openIds, closedIds, snapshotAvailable, today);
      if (blocked) {
        pushHeld({ ...baseHeld, ...blocked });
        continue;
      }
      if (typeof successorHasHideTag === "function" ? successorHasHideTag(line) : false) {
        pushHeld({ ...baseHeld, reason: "hidden" });
        continue;
      }
      const otherTargets = outgoingEdges.filter((out) => {
        const outSource = relationIdentityKey(out.source.path, out.source.blockId, out.source.line);
        if (outSource !== sourceIdentity) return false;
        const outTarget = relationIdentityKey(out.target.path, out.target.blockId, out.target.line);
        if (!outTarget || outTarget === targetKey || eventKeys.has(outTarget)) return false;
        if (!out.resolved) return false;
        return !relationTargetReleased(out.target, eventKeys, currentLive, noteTexts);
      });
      if (otherTargets.length > 0) {
        pushHeld({
          ...baseHeld,
          reason: "waits_for",
          waits_for: otherTargets.map((out) =>
            relationIdentityKey(out.target.path, out.target.blockId, out.target.line),
          ),
          waits_for_text: otherTargets.map((out) => {
            const task = relationLookupTask(out.target.path, out.target.blockId, out.target.line, noteTexts);
            const raw = task && task.lineText || out.target.text || "";
            const display = typeof successorDisplayText === "function"
              ? successorDisplayText({ rawLine: raw, blockId: out.target.blockId })
              : String(raw);
            return display || String(out.target.path || "").split("/").pop().replace(/\.md$/i, "") || "task";
          }),
        });
        continue;
      }
      if (!RELATION_SUCCESSOR_OFFER_STATUSES.has(source.status)) continue;

      const trigger = {
        targetKey,
        label: configuredLabel,
        labelKey: edge.key,
        event: event.event,
        anchor: event.anchor,
        targetText: targetText || configuredLabel,
        target: event.target,
      };
      const existing = offeredBySource.get(sourceIdentity);
      if (existing) {
        existing.triggers.push(trigger);
        if (recovery.recovered) existing.recovered = true;
      } else {
        offeredBySource.set(sourceIdentity, {
          // Classification uses the effective post-recovery status above;
          // writes and receipts retain the original parsed task line/status.
          source: foundSource,
          sourceIdentity,
          effectiveStatus: source.status,
          recovered: recovery.recovered === true,
          triggers: [trigger],
        });
      }
    }
  }

  const groupMap = new Map();
  const marks = [];
  for (const row of offeredBySource.values()) {
    const first = row.triggers[0];
    const groupId = `${first.targetKey}\0${first.labelKey}`;
    const targetTexts = row.triggers.map((trigger) => trigger.targetText).filter(Boolean);
    const suffix = targetTexts.length > 1 ? relationCopySuffix(targetTexts) : "";
    const lane = first && row.effectiveStatus === "*" ? "Next" : "Ready";
    const mark = {
      task: row.source,
      group: "relation",
      trigger: "relation",
      label: first.label,
      key: first.labelKey,
      event: first.event,
      after: first.targetKey,
      afterText: first.targetText,
      unblocked_by: row.triggers.map((trigger) => ({
        note_path: trigger.target.path,
        block_id: trigger.target.blockId,
        text: trigger.targetText,
      })),
      relation: {
        label: first.label,
        key: first.labelKey,
        event: first.event,
        after: row.triggers.map((trigger) => ({
          path: trigger.target.path,
          blockId: trigger.target.blockId,
          text: trigger.targetText,
        })),
      },
      recovered: row.recovered === true,
      anchor: first.anchor,
      suffix,
      lane,
      sourceKey: row.sourceIdentity,
    };
    marks.push(mark);
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        group: "relation",
        label: first.label,
        key: first.labelKey,
        event: first.event,
        after: first.targetKey,
        target: first.target,
        anchor: first.anchor,
        rows: [],
      });
    }
    groupMap.get(groupId).rows.push({
      key: row.sourceIdentity,
      lane,
      suffix: suffix || undefined,
      recovered: row.recovered === true ? true : undefined,
      mark,
    });
  }

  const groups = [...groupMap.values()].sort((left, right) => {
    const leftAnchor = left.anchor && typeof left.anchor === "object" ? left.anchor : {};
    const rightAnchor = right.anchor && typeof right.anchor === "object" ? right.anchor : {};
    const leftPos = Number.isInteger(leftAnchor.entryLine) ? leftAnchor.entryLine
      : Number.isInteger(leftAnchor.bulletLine) ? leftAnchor.bulletLine : Number.MAX_SAFE_INTEGER;
    const rightPos = Number.isInteger(rightAnchor.entryLine) ? rightAnchor.entryLine
      : Number.isInteger(rightAnchor.bulletLine) ? rightAnchor.bulletLine : Number.MAX_SAFE_INTEGER;
    return leftPos - rightPos ||
      String(left.target && left.target.path || "").localeCompare(String(right.target && right.target.path || "")) ||
      (Number(left.target && left.target.line) || 0) - (Number(right.target && right.target.line) || 0) ||
      String(left.key || "").localeCompare(String(right.key || ""));
  });
  for (const group of groups) {
    group.rows.sort((left, right) => {
      const laneRank = (lane) => (lane === "Next" ? 0 : 1);
      return laneRank(left.lane) - laneRank(right.lane) ||
        String(left.mark.task.path || "").localeCompare(String(right.mark.task.path || "")) ||
        (Number(left.mark.task.line) || 0) - (Number(right.mark.task.line) || 0);
    });
  }

  const projectedGroups = groups.map((group) => {
    const rows = group.rows.map((row) => {
      const projected = { key: row.key, lane: row.lane };
      if (row.suffix) projected.suffix = row.suffix;
      if (row.recovered) projected.recovered = true;
      return projected;
    });
    return {
      group: "relation",
      label: group.label,
      event: group.event,
      after: group.after,
      rows,
    };
  });

  const projectedHeld = held.map((row) => {
    const projected = { key: row.key, reason: row.reason };
    if (row.display === false) projected.display = false;
    if (row.waits_on != null) projected.waits_on = row.waits_on;
    if (row.scheduled) projected.scheduled = row.scheduled;
    if (row.project && row.project !== true) projected.project = row.project;
    if (Array.isArray(row.waits_for)) projected.waits_for = row.waits_for.slice();
    // Group identity for the merged pipeline picker (offer_pipeline): label,
    // key, after target, and event survive projection so relation groups can
    // carry held counts and fold text. Independent classifier tests ignore
    // these additive fields via subset matching.
    if (row.label) projected.label = row.label;
    if (row.labelKey) projected.labelKey = row.labelKey;
    if (row.after) projected.after = row.after;
    if (row.event) projected.event = row.event;
    if (row.text) projected.text = row.text;
    return projected;
  });

  return Object.freeze({
    marks,
    held: Object.freeze(projectedHeld),
    groups: Object.freeze(projectedGroups),
    relation_check: "checked",
    scan: true,
    warnings: Object.freeze([]),
  });
}
