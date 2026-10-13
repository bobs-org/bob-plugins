// Successor offer keys, implicit destination, and picker model
// (docs/task-dependencies.md §12.2 KEYS, §12.3 implicit, §12.13).
// Pure code only: no vault reads, no editor writes. Shared scope with
// 085-successor-plan.js / 089-successor-project.js.

function successorFnv1aHex(text) {
  let hash = 0x811c9dc5;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8).toLowerCase();
}

// Digest input: the mint-pipeline clean description of the body after the
// status box, exactly as the mint helper sees it.
function successorDigestForTask(task) {
  try {
    const raw = task && task.rawLine != null
      ? successorBodyAfterStatusBox(task.rawLine)
      : String((task && task.text) || "");
    const cleaned = cleanDescription(raw, "#task", (task && task.blockId) || null);
    return successorFnv1aHex(cleaned);
  } catch (error) {
    return "00000000";
  }
}

// Assign stable offer keys for candidate tasks. Tasks with a block ID use
// `<path>#^<id>`; idless rows use `<path>@<8 hex>` with `~k` for the k-th
// duplicate digest in the same note in document order. Ordinals derive from
// the note's full task rows (noteTasksByPath), not the selected subset, so
// keys survive subset selections. `candidates` is the offer-candidate list
// in planning order; `noteTasksByPath` maps path -> [{digest,line}] in
// document order. Returns Map(candidate -> key).
function assignSuccessorOfferKeys(candidates, noteTasksByPath) {
  const keys = new Map();
  const seenInSelection = new Map();
  for (const task of Array.isArray(candidates) ? candidates : []) {
    if (!task || !task.path) {
      continue;
    }
    if (task.blockId) {
      keys.set(task, `${task.path}#^${String(task.blockId)}`);
      continue;
    }
    const digest = successorDigestForTask(task);
    const base = `${task.path}@${digest}`;
    // Ordinal among same-note same-digest rows in document order: count how
    // many earlier rows in that note share the digest.
    const noteRows = (noteTasksByPath && noteTasksByPath.get
      ? noteTasksByPath.get(task.path)
      : (noteTasksByPath || {})[task.path]) || null;
    let ordinal = 0;
    if (Array.isArray(noteRows)) {
      for (const row of noteRows) {
        if (!row || row.digest !== digest) {
          continue;
        }
        if (Number(row.line) < Number(task.line)) {
          ordinal += 1;
        } else if (Number(row.line) === Number(task.line)) {
          break;
        }
      }
      // When the note rows lack this exact line (cache task without line),
      // fall back to selection-order counting.
      const hasLine = noteRows.some((row) => Number(row.line) === Number(task.line));
      if (!hasLine) {
        const count = seenInSelection.get(base) || 0;
        ordinal = count;
        seenInSelection.set(base, count + 1);
      } else {
        ordinal += 1;
      }
    } else {
      const count = seenInSelection.get(base) || 0;
      ordinal = count + 1;
      seenInSelection.set(base, count + 1);
    }
    keys.set(task, ordinal <= 1 ? base : `${base}~${ordinal}`);
  }
  return keys;
}

// Build the per-note digest table from staged note texts (document order).
// Each entry: path -> [{digest, line}] sorted by line.
function buildSuccessorNoteDigestTable(noteTexts) {
  const table = new Map();
  const source = noteTexts && typeof noteTexts.get === "function"
    ? [...noteTexts.entries()]
    : Object.entries(noteTexts || {});
  for (const [path, text] of source) {
    const lines = String(text || "").split(/\r?\n/);
    const rows = [];
    for (let line = 0; line < lines.length; line += 1) {
      const parsed = parseTaskDependencyLine(lines[line], path, line);
      if (!parsed) {
        continue;
      }
      const fake = { rawLine: parsed.lineText, text: parsed.lineText, blockId: parsed.blockId };
      rows.push({ digest: successorDigestForTask(fake), line });
    }
    rows.sort((a, b) => a.line - b.line);
    table.set(String(path), rows);
  }
  return table;
}

// Normalize a selection input to { mode, keys }. Missing/null/empty links
// nothing. "all" links every offer. An array/Set of keys links that subset.
// The runtime passes only the picker's returned keys.
function normalizeSuccessorSelection(selection) {
  if (selection === "all" || selection === true) {
    return { mode: "all", keys: new Set() };
  }
  if (typeof selection === "string") {
    const trimmed = selection.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") {
      return { mode: "none", keys: new Set() };
    }
    if (trimmed.toLowerCase() === "all") {
      return { mode: "all", keys: new Set() };
    }
    return { mode: "set", keys: new Set([trimmed]) };
  }
  if (Array.isArray(selection)) {
    const keys = new Set(
      selection.map((key) => String(key || "").trim()).filter(Boolean),
    );
    return keys.size === 0 ? { mode: "none", keys } : { mode: "set", keys };
  }
  if (selection instanceof Set) {
    const keys = new Set(
      [...selection].map((key) => String(key || "").trim()).filter(Boolean),
    );
    return keys.size === 0 ? { mode: "none", keys } : { mode: "set", keys };
  }
  return { mode: "none", keys: new Set() };
}

function successorSelectionPicks(normalized, key) {
  if (!normalized || !key) {
    return false;
  }
  if (normalized.mode === "all") {
    return true;
  }
  if (normalized.mode === "set") {
    return normalized.keys.has(String(key));
  }
  return false;
}

// Implicit destination: today's single open timed entry, else the first
// open entry in document order (the plain @route:id Ensure-Next rule).
// Returns { entryLine, name } or null when it fails (no day file, no
// section, no open entry, or several open timed entries).
function resolveSuccessorImplicitDestination(dailyLines) {
  const lines = successorNormalizeLines(dailyLines);
  const section = findPomodorosSectionInLines(lines);
  if (!section) {
    return null;
  }
  const entries = parseSuccessorLedgerEntries(lines);
  const open = entries.filter((entry) => entry && entry.open);
  if (open.length === 0) {
    return null;
  }
  const timed = open.filter((entry) => {
    try {
      const parts = parsePomodoroEntryLineParts(String(lines[entry.entryLine] || ""));
      return !!parts && parts.placeholder !== true;
    } catch (error) {
      return false;
    }
  });
  if (timed.length === 1) {
    const entry = timed[0];
    return { entryLine: entry.entryLine, name: entry.name || "" };
  }
  if (timed.length > 1) {
    return null;
  }
  const first = open[0];
  return { entryLine: first.entryLine, name: first.name || "" };
}

// Destination label for the picker model (§12.13): the entry name, or the
// line number for unnamed entries.
function successorDestinationLabel(destination) {
  if (!destination || typeof destination !== "object") {
    return "";
  }
  if (destination.entry_name) {
    return String(destination.entry_name);
  }
  if (Number.isInteger(destination.entry_line)) {
    return `line ${destination.entry_line}`;
  }
  return "";
}

// Build the §12.13 picker model from a planned offer set. `offers` are the
// selectable rows in ORDER with { key, text, notePath, status, destination,
// needsBlockId, group, project }; `stillBlocked` supplies muted rows;
// `foldedByProject` maps project path -> { hidden, alreadyPlanned,
// subProjects }; `headers` maps project path -> header text (the ^prj line).
// `budget` is { links, max } or null. Every offer is unselected.
function buildSuccessorPickerModel(options = {}) {
  const predecessors = Array.isArray(options.predecessors) ? options.predecessors : [];
  const offers = Array.isArray(options.offers) ? options.offers : [];
  const stillBlocked = Array.isArray(options.stillBlocked) ? options.stillBlocked : [];
  const foldedByProject = options.foldedByProject instanceof Map
    ? options.foldedByProject
    : new Map(Object.entries(options.foldedByProject || {}));
  const headers = options.headers instanceof Map
    ? options.headers
    : new Map(Object.entries(options.headers || {}));
  const byGroup = new Map();
  const ensureGroup = (group, project) => {
    const key = `${group}\0${project || ""}`;
    if (!byGroup.has(key)) {
      let header = "";
      if (group === "hand_off") {
        header = "Hand-offs";
      } else if (group === "project_finished") {
        header = "Project finished";
      } else if (group === "project") {
        header = headers.get(project) || `Project ${String(project || "").split("/").pop() || project}`;
      }
      byGroup.set(key, {
        group,
        ...(project ? { project } : {}),
        header,
        rows: [],
      });
    }
    return byGroup.get(key);
  };
  for (const offer of offers) {
    if (!offer || !offer.key) {
      continue;
    }
    const entry = ensureGroup(offer.group || "hand_off", offer.project || null);
    entry.rows.push({
      key: String(offer.key),
      text: String(offer.text || ""),
      notePath: String(offer.notePath || ""),
      status: String(offer.status || " "),
      destinationLabel: successorDestinationLabel(offer.destination),
      needsBlockId: offer.needsBlockId === true,
      selectable: true,
    });
  }
  // Muted still-blocked project residents join their project group as
  // unselectable rows.
  for (const row of stillBlocked) {
    if (!row || !row.project || (row.reason !== "project" && row.reason !== "waits_on" && row.reason !== "scheduled")) {
      continue;
    }
    // Only project-group muted rows (those carrying a project path) are
    // shown; dependency still-blocked rows stay in the card only.
    if (!row.mutedProject) {
      continue;
    }
    const entry = ensureGroup("project", row.project);
    entry.rows.push({
      key: String(row.mutedKey || `${row.note_path}@muted-${row.line}`),
      text: String(row.text || ""),
      notePath: String(row.note_path || ""),
      status: String(row.status_symbol || "?"),
      destinationLabel: "",
      needsBlockId: false,
      selectable: false,
      mutedReason: String(row.reason || "project"),
    });
  }
  const groups = [];
  for (const group of ["hand_off", "project", "project_finished"]) {
    for (const entry of byGroup.values()) {
      if (entry.group !== group) {
        continue;
      }
      const folded = foldedByProject.get(entry.project || "") || null;
      if (folded && (folded.hidden > 0 || folded.alreadyPlanned > 0 || folded.subProjects > 0)) {
        entry.folded = {
          hidden: folded.hidden || 0,
          alreadyPlanned: folded.alreadyPlanned || 0,
          subProjects: folded.subProjects || 0,
        };
      }
      groups.push(entry);
    }
  }
  const model = {
    title: predecessors.length === 1
      ? `Pull in successors of ${predecessors[0].text || "task"}`
      : `Pull in successors (${predecessors.length} closed)`,
    predecessors: predecessors.map((pred) => ({
      notePath: String(pred.note_path || pred.notePath || ""),
      blockId: String(pred.block_id || pred.blockId || ""),
      text: String(pred.text || ""),
    })),
    groups,
  };
  if (options.budget && typeof options.budget === "object" &&
      Number.isFinite(options.budget.links) && Number.isFinite(options.budget.max)) {
    model.budget = { links: options.budget.links, max: options.budget.max };
  }
  return model;
}

// Normalize a picker result to an array of keys. Null, empty, malformed,
// and picker exceptions all mean no picks. Preserves the optional
// destination seam without implementing it (§SO23 belongs to a later phase).
function normalizeSuccessorPicks(result) {
  try {
    if (!result || typeof result !== "object") {
      return [];
    }
    const picks = Array.isArray(result.picks) ? result.picks : null;
    if (!picks) {
      return [];
    }
    const keys = [];
    for (const pick of picks) {
      if (!pick || typeof pick !== "object") {
        continue;
      }
      const key = String(pick.key || "").trim();
      if (key && !keys.includes(key)) {
        keys.push(key);
      }
    }
    return keys;
  } catch (error) {
    return [];
  }
}

// Collect every open resident ([?] or [ ], including #ref/inbox/stale) of
// each recovered project for PROJECT OFFERS. The ^prj itself is skipped.
// Mutates candidateByLocation (Map location -> task). Pure apart from the
// map write; never throws.
function collectProjectResidentCandidates(candidateByLocation, projectInfoByPath, projectRecoveryPaths, noteTexts) {
  try {
    for (const recoveryPath of projectRecoveryPaths || []) {
      const project = (projectInfoByPath instanceof Map ? projectInfoByPath.get(String(recoveryPath || "")) : (projectInfoByPath || {})[String(recoveryPath || "")]);
      if (!project) {
        continue;
      }
      const staged = noteTexts instanceof Map ? noteTexts.get(String(recoveryPath || "")) : noteTexts[String(recoveryPath || "")];
      const stagedText = typeof staged === "string" ? staged : projectNoteTextFor(noteTexts, recoveryPath);
      if (typeof stagedText !== "string" || !stagedText) {
        continue;
      }
      const lines = stagedText.split(/\r?\n/);
      const fenced = getFencedLineNumbers(lines);
      for (let line = 0; line < lines.length; line += 1) {
        if (fenced.has(line)) {
          continue;
        }
        const text = String(lines[line] || "");
        let status = null;
        try {
          status = getTaskStatusForLine(text, line);
        } catch (error) {
          status = null;
        }
        if (!status || (status.symbol !== "?" && status.symbol !== " ")) {
          continue;
        }
        if (/^\s*>/.test(text)) {
          continue;
        }
        const blockId = getTrailingBlockId(text);
        if (successorIsProjectTask(blockId)) {
          continue;
        }
        const locationKey = `${recoveryPath}\0${line}`;
        if (candidateByLocation.has(locationKey)) {
          continue;
        }
        if (successorIsDonePath(recoveryPath)) {
          continue;
        }
        const metadata = parseTaskDependencyMetadata(text);
        const scheduledMatches = findScheduledFieldMatches(text);
        candidateByLocation.set(locationKey, {
          path: String(recoveryPath),
          line,
          status: status.symbol,
          blockId: blockId || null,
          taskId: metadata.taskId || null,
          dependsOn: Array.isArray(metadata.dependsOn) ? metadata.dependsOn.slice() : [],
          text,
          rawLine: text,
          scheduled: scheduledMatches.length > 0 ? scheduledMatches[0].value : null,
          hidden: successorHasHideTag(text),
        });
      }
    }
  } catch (error) {
    // Best effort.
  }
}

// Folded counts + headers for the picker model (§12.5 pull_in.groups).
// Returns { foldedByProject: Map, projectHeaders: Map }.
function computeProjectFoldedAndHeaders(projectInfoByPath, projectRecoveryPaths, noteTexts, recovers) {
  const foldedByProject = new Map();
  const projectHeaders = new Map();
  const ensureFolded = (projectPath) => {
    if (!foldedByProject.has(projectPath)) {
      foldedByProject.set(projectPath, { hidden: 0, alreadyPlanned: 0, subProjects: 0 });
    }
    return foldedByProject.get(projectPath);
  };
  try {
    for (const recover of recovers || []) {
      if (recover && recover.foldedProject) {
        const folded = ensureFolded(String(recover.foldedProject));
        if (recover.reason === "hidden") {
          folded.hidden += 1;
        } else if (recover.reason === "already_planned") {
          folded.alreadyPlanned += 1;
        }
      }
    }
  } catch (error) {
    // Best effort.
  }
  try {
    for (const path of projectRecoveryPaths || []) {
      const project = projectInfoByPath instanceof Map
        ? projectInfoByPath.get(String(path || ""))
        : (projectInfoByPath || {})[String(path || "")];
      if (!project || !project.projectTask) {
        continue;
      }
      try {
        const header = successorDisplayText({
          rawLine: project.projectTask.lineText,
          blockId: project.projectTask.blockId,
          text: project.projectTask.lineText,
        });
        if (header) {
          projectHeaders.set(String(path), header);
        }
      } catch (error) {
        // Best effort.
      }
      try {
        const staged = noteTexts instanceof Map ? noteTexts.get(String(path || "")) : noteTexts[String(path || "")];
        const stagedText = typeof staged === "string" ? staged : projectNoteTextFor(noteTexts, path);
        if (typeof stagedText === "string") {
          const lines = stagedText.split(/\r?\n/);
          const markerLine = project.projectTask.line;
          let subCount = 0;
          if (Number.isInteger(markerLine) && markerLine >= 0 && markerLine < lines.length) {
            const prjIndent = getLineIndentation(String(lines[markerLine] || "")).length;
            for (let line = markerLine + 1; line < lines.length; line += 1) {
              const text = String(lines[line] || "");
              if (!text.trim()) {
                break;
              }
              const indent = getLineIndentation(text).length;
              if (indent <= prjIndent && parseListItemPrefix(text)) {
                break;
              }
              if (!parseListItemPrefix(text) || !text.includes(PROJECT_SUBPROJECTS_MARKER)) {
                continue;
              }
              PROJECT_WIKILINK_RE.lastIndex = 0;
              let match;
              const seen = new Set();
              while ((match = PROJECT_WIKILINK_RE.exec(text)) !== null) {
                const target = String(match[1] || "").split("|")[0].split("#")[0].trim();
                if (!target || seen.has(target)) {
                  continue;
                }
                seen.add(target);
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
                subCount += 1;
              }
              break;
            }
          }
          if (subCount > 0) {
            ensureFolded(String(path)).subProjects = subCount;
          }
        }
      } catch (error) {
        // Best effort.
      }
    }
  } catch (error) {
    // Best effort.
  }
  return { foldedByProject, projectHeaders };
}

// Group order for §12.2 ORDER: hand_off, project, project_finished.
function successorGroupOrder(group) {
  if (group === "hand_off") {
    return 0;
  }
  if (group === "project") {
    return 1;
  }
  return 2;
}

function successorOfferOrderCompare(left, right) {
  return successorGroupOrder(left.group) - successorGroupOrder(right.group) ||
    successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor) ||
    (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1) ||
    String(left.notePath || "").localeCompare(String(right.notePath || "")) ||
    (Number(left.line) || 0) - (Number(right.line) || 0);
}

// One project-resident verdict for PROJECT OFFERS (§12.2). Returns a
// descriptor consumed by planSuccessors' candidate loop; never throws.
// `ctx` carries { openIdsAfter, today, hasLiveLinkBefore, cancelledClose,
// linkUnblocked, anchorOf, dailyBefore }.
function decideProjectResidentVerdict(task, project, unblocking, ctx = {}) {
  const openIdsAfter = ctx.openIdsAfter instanceof Set ? ctx.openIdsAfter : new Set();
  const today = typeof ctx.today === "string" ? ctx.today : formatLocalDate();
  const hasLiveLinkBefore = typeof ctx.hasLiveLinkBefore === "function" ? ctx.hasLiveLinkBefore : () => false;
  const cancelledClose = ctx.cancelledClose === true;
  const linkUnblocked = ctx.linkUnblocked !== false;
  const anchorOf = typeof ctx.anchorOf === "function" ? ctx.anchorOf : () => ({ kind: "none", entryLine: null, bulletLine: null });
  const dailyBefore = ctx.dailyBefore || [];
  const projectPredecessors = unblocking.map((identity) => ({
    note_path: String(identity.path || ""),
    block_id: String(identity.blockId || ""),
    text: String(identity.text || ""),
  }));
  const ownOpen = (task.dependsOn || []).filter((id) => openIdsAfter.has(String(id)));
  let ownFuture = null;
  try {
    ownFuture = task.rawLine ? findSingleFutureScheduledField(task.rawLine, today) : null;
  } catch (error) {
    ownFuture = null;
  }
  if (ownOpen.length > 0 || ownFuture) {
    return {
      kind: "stillBlocked",
      row: {
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text: successorDisplayText(task),
        status_symbol: task.status,
        reason: ownFuture && ownOpen.length === 0 ? "scheduled" : "waits_on",
        waits_on: ownOpen.length,
        scheduled: ownFuture ? ownFuture.value : null,
        project: String(task.path || ""),
        mutedProject: true,
        trigger: "dependency",
      },
    };
  }
  if (task.hidden === true || (task.rawLine && successorHasHideTag(task.rawLine))) {
    return { kind: "recover", reason: "hidden", predecessorRows: projectPredecessors, foldedProject: String(task.path || "") };
  }
  if (hasLiveLinkBefore(task)) {
    return { kind: "recover", reason: "already_planned", predecessorRows: projectPredecessors, foldedProject: String(task.path || "") };
  }
  if (cancelledClose || linkUnblocked === false) {
    return { kind: "recover", reason: cancelledClose ? "cancelled" : "disabled", predecessorRows: projectPredecessors };
  }
  const predAnchors = unblocking.map((identity) => ({ identity, anchor: anchorOf(identity) }))
    .filter((entry) => entry.anchor.kind !== "none")
    .sort((l, r) => successorAnchorPosition(l.anchor) - successorAnchorPosition(r.anchor) ||
      (l.anchor.bulletLine ?? -1) - (r.anchor.bulletLine ?? -1));
  if (predAnchors.length > 0) {
    return {
      kind: "offer",
      anchor: predAnchors[0].anchor,
      predecessorRows: projectPredecessors,
      group: "project",
      project: String(task.path || ""),
    };
  }
  const implicitResident = resolveSuccessorImplicitDestination(dailyBefore);
  if (!implicitResident) {
    return { kind: "recover", reason: "no_destination", predecessorRows: projectPredecessors };
  }
  return {
    kind: "offer",
    anchor: { kind: "implicit", entryLine: implicitResident.entryLine, bulletLine: null },
    implicit: implicitResident,
    predecessorRows: projectPredecessors,
    group: "project",
    project: String(task.path || ""),
  };
}

// Destination object for an offer (§12.5): { day_file, entry_name,
// entry_role, fallback }. entry_role is slot|closing|implicit|created;
// fallback true when the implicit path was used because no §12.3 anchor
// existed. `anchor` is the offer's anchor; `implicit` is the resolved
// implicit entry when anchor.kind === "implicit".
function successorOfferDestination(anchor, implicit, dailyLines, dailyPath) {
  const dayFile = String(dailyPath || "");
  try {
    if (anchor && anchor.kind === "implicit" && implicit) {
      const name = typeof implicit.name === "string" ? implicit.name : successorEntryNameAt(successorNormalizeLines(dailyLines), implicit.entryLine);
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: "implicit", fallback: true };
    }
    if (anchor && anchor.kind === "closing") {
      const name = successorEntryNameAt(successorNormalizeLines(dailyLines), anchor.entryLine);
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: "closing", fallback: false };
    }
    if (anchor && anchor.entryLine != null) {
      const name = successorEntryNameAt(successorNormalizeLines(dailyLines), anchor.entryLine);
      const role = anchor.kind === "inherit" ? "slot" : "slot";
      return { day_file: dayFile, entry_name: String(name || ""), entry_role: role, fallback: false };
    }
  } catch (error) {
    // Fall through.
  }
  return { day_file: dayFile, entry_name: "", entry_role: "implicit", fallback: true };
}

// Defensive feature detection for nav api.successors v1 (§12.13).
function getSuccessorPickerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const nav = plugins["bob-navigation-hotkeys"];
    const api = nav && nav.api;
    const successors = api && api.successors;
    if (!successors || !(Number(successors.version) >= 1)) {
      return null;
    }
    if (typeof successors.pick !== "function") {
      return null;
    }
    return successors;
  } catch (error) {
    return null;
  }
}
