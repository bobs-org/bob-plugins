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
    const cleaned = cleanDescription(raw, task && task.globalFilter || "#task", (task && task.blockId) || null);
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
      const reference = !parsed && successorKeepMovingIsReferenceLine(lines[line]);
      const status = reference ? getTaskStatusForLine(lines[line], line) : null;
      if (!parsed && !status) {
        continue;
      }
      const rawLine = parsed ? parsed.lineText : lines[line];
      const fake = {
        rawLine,
        text: rawLine,
        blockId: parsed ? parsed.blockId : getTrailingBlockId(rawLine),
        ...(reference ? { globalFilter: "#ref" } : {}),
      };
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
  const relationHeld = Array.isArray(options.relationHeld) ? options.relationHeld : [];
  const ensureGroup = (group, project, extra = {}) => {
    const relationKey = group === "relation"
      ? `${group}\0${extra.after || ""}\0${extra.labelKey || extra.label || ""}`
      : `${group}\0${project || ""}`;
    if (!byGroup.has(relationKey)) {
      let header = "";
      if (group === "hand_off") {
        header = "Hand-offs";
      } else if (group === "project_finished") {
        header = "Project finished";
      } else if (group === "project") {
        header = headers.get(project) || `Project ${String(project || "").split("/").pop() || project}`;
      } else if (group === "keep_moving") {
        const stem = String(project || "").split("/").pop().replace(/\.md$/i, "") || String(project || "");
        header = `Keep ‹${stem}› moving`;
      } else if (group === "relation") {
        const label = String(extra.label || "");
        const target = String(extra.afterText || "");
        try {
          header = typeof relationCopyGroupTitle === "function" && label
            ? relationCopyGroupTitle(label, target)
            : `${label} \u201c${target}\u201d`;
        } catch (_error) {
          header = `${label} \u201c${target}\u201d`;
        }
      }
      const entry = {
        group,
        ...(project && group !== "relation" ? { project } : {}),
        header,
        rows: [],
      };
      if (group === "keep_moving") {
        entry.caption = "";
        entry.tag = `ready in ${String(project || "").split("/").pop().replace(/\.md$/i, "")} · not dependents`;
      }
      if (group === "relation") {
        let caption = "";
        let tag = "";
        try {
          caption = typeof relationCopyWhy === "function"
            ? relationCopyWhy(extra.afterText || "", extra.event || "")
            : "";
          tag = typeof relationCopyTag === "function" ? relationCopyTag() : "your links \u00b7 not dependents";
        } catch (_error) {
          caption = "";
          tag = "your links \u00b7 not dependents";
        }
        entry.caption = caption;
        entry.tag = tag;
        entry.after = {
          notePath: String((extra.afterParts && extra.afterParts.notePath) || ""),
          blockId: String((extra.afterParts && extra.afterParts.blockId) || ""),
          text: String(extra.afterText || ""),
        };
        entry.event = String(extra.event || "");
        entry.label = String(extra.label || "");
        entry.foldText = "";
      }
      byGroup.set(relationKey, entry);
    }
    return byGroup.get(relationKey);
  };
  for (const offer of offers) {
    if (!offer || !offer.key) {
      continue;
    }
    const groupName = offer.group || "hand_off";
    let afterParts = null;
    if (groupName === "relation" && offer.after) {
      const raw = String(offer.after);
      const hash = raw.indexOf("#^");
      if (hash >= 0) {
        afterParts = { notePath: raw.slice(0, hash), blockId: raw.slice(hash + 2) };
      } else {
        afterParts = { notePath: raw, blockId: "" };
      }
    }
    const entry = ensureGroup(groupName, offer.project || null, {
      after: offer.after || "",
      afterParts,
      afterText: offer.afterText || "",
      event: offer.event || "",
      label: offer.label || "",
      labelKey: offer.labelKey || "",
    });
    const row = {
      key: String(offer.key),
      text: String(offer.text || ""),
      notePath: String(offer.notePath || ""),
      status: String(offer.status || " "),
      destinationLabel: successorDestinationLabel(offer.destination),
      needsBlockId: offer.needsBlockId === true,
      selectable: true,
    };
    if (groupName === "relation") {
      const lane = String(offer.lane || (offer.status === "*" ? "Next" : "Ready"));
      if (lane) row.lane = lane;
      if (offer.suffix) row.suffix = String(offer.suffix);
      if (offer.reason) row.reason = String(offer.reason);
      else if (offer.label && offer.afterText) {
        try {
          row.reason = typeof relationCopyReason === "function"
            ? relationCopyReason(offer.label, offer.afterText)
            : `· ${offer.label} \u201c${offer.afterText}\u201d`;
        } catch (_error) {}
      }
    }
    if (offer.reason && groupName !== "relation") {
      row.reason = String(offer.reason);
    }
    if (entry.group === "keep_moving") {
      row.lane = successorKeepMovingLaneName(offer.status) || successorStatusName(offer.status);
      const preds = Array.isArray(offer.predecessorRows) ? offer.predecessorRows : [];
      const names = preds.map((pred) => {
        const raw = String(pred && pred.text || "");
        const body = raw.match(TASK_LINE_RE) ? successorBodyAfterStatusBox(raw) : raw;
        return truncateSuccessorNoticeText(cleanDescription(body, "#task", pred && pred.block_id || null));
      }).filter(Boolean);
      if (!entry.caption && names.length) {
        const stem = String(entry.project || "").split("/").pop().replace(/\.md$/i, "");
        entry.caption = names.length === 1
          ? `✓ ${names[0]} was the last ${stem} task planned today`
          : `✓ ${names[0]} and ${names.length - 1} more were the last ${stem} tasks planned today`;
      }
    }
    const taskContext = buildSuccessorPickerTaskContext(offer);
    if (taskContext) {
      row.task = taskContext;
    }
    entry.rows.push(row);
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
  // Attach held counts + fold text to relation groups (offer_pipeline v3).
  for (const entry of byGroup.values()) {
    if (entry.group !== "relation") continue;
    const afterKey = `${entry.after && entry.after.notePath || ""}#^${entry.after && entry.after.blockId || ""}`;
    const labelKey = String(entry.label || "").toLowerCase();
    const heldForGroup = relationHeld.filter((held) => {
      if (!held || typeof held !== "object") return false;
      const heldAfter = String(held.after || (held.relation && held.relation.after && held.relation.after[0] && `${held.relation.after[0].note_path}#^${held.relation.after[0].block_id}`) || "");
      const heldLabel = String(held.labelKey || held.label || (held.relation && (held.relation.key || held.relation.label)) || "").toLowerCase();
      // Match by after target + label; fall back to label-only when after is empty.
      if (afterKey && afterKey !== "#^" && heldAfter) return heldAfter === afterKey && heldLabel === labelKey;
      return heldLabel === labelKey;
    });
    let hidden = 0;
    let blocked = 0;
    let alreadyStarted = 0;
    let waitsFor = 0;
    let alreadyPlanned = 0;
    for (const held of heldForGroup) {
      if (held.reason === "hidden") hidden += 1;
      else if (held.reason === "blocked") blocked += 1;
      else if (held.reason === "already_started") alreadyStarted += 1;
      else if (held.reason === "waits_for") waitsFor += Array.isArray(held.waits_for) && held.waits_for.length > 0 ? held.waits_for.length : 1;
      else if (held.reason === "already_planned") alreadyPlanned += 1;
    }
    entry.folded = {
      hidden,
      alreadyPlanned,
      subProjects: 0,
      blocked,
      scheduled: 0,
      alreadyStarted,
      waitsFor,
    };
    // Fold text via shared copy (ui style); omit when no held rows apply.
    if (heldForGroup.length > 0) {
      try {
        const first = heldForGroup[0] || {};
        const foldInput = {
          waits_for: (first.waits_for_text || first.waits_for || []).map((value) =>
            String(value || "task"),
          ),
          source: String(first.text || first.source || ""),
          already_started: alreadyStarted,
          blocked,
          hidden,
          target: String(entry.after && entry.after.text || ""),
        };
        const fold = typeof relationCopyFold === "function" ? relationCopyFold(foldInput, "ui") : "";
        if (fold) entry.foldText = fold;
      } catch (_error) {}
    }
    // Rows within a relation group sort Next before Ready, then path/line (SA vectors).
    entry.rows.sort((left, right) => {
      const laneRank = (lane) => (lane === "Next" ? 0 : 1);
      return laneRank(left.lane) - laneRank(right.lane) ||
        String(left.notePath || "").localeCompare(String(right.notePath || "")) ||
        0;
    });
  }
  const groups = [];
  for (const group of ["hand_off", "relation", "project", "project_finished"]) {
    // Relation groups sort by T anchor position, then T path/line, then label key.
    const entries = [...byGroup.values()].filter((entry) => entry.group === group);
    if (group === "relation") {
      entries.sort((left, right) =>
        String(left.after && left.after.notePath || "").localeCompare(String(right.after && right.after.notePath || "")) ||
        String(left.after && left.after.blockId || "").localeCompare(String(right.after && right.after.blockId || "")) ||
        String(left.label || "").localeCompare(String(right.label || "")));
    }
    for (const entry of entries) {
      if (group !== "relation") {
        const folded = foldedByProject.get(entry.project || "") || null;
        if (folded && (folded.hidden > 0 || folded.alreadyPlanned > 0 || folded.subProjects > 0)) {
          entry.folded = {
            hidden: folded.hidden || 0,
            alreadyPlanned: folded.alreadyPlanned || 0,
            subProjects: folded.subProjects || 0,
            ...(folded.blocked > 0 ? { blocked: folded.blocked } : {}),
            ...(folded.scheduled > 0 ? { scheduled: folded.scheduled } : {}),
          };
        }
      }
      groups.push(entry);
    }
  }
  for (const entry of byGroup.values()) {
    if (entry.group !== "keep_moving") continue;
    const folded = foldedByProject.get(entry.project || "") || {};
    if (folded.blocked > 0 || folded.scheduled > 0 || folded.hidden > 0) {
      entry.folded = {
        ...(folded.blocked > 0 ? { blocked: folded.blocked } : {}),
        ...(folded.scheduled > 0 ? { scheduled: folded.scheduled } : {}),
        ...(folded.hidden > 0 ? { hidden: folded.hidden } : {}),
      };
    }
    groups.push(entry);
  }
  const keepOnly = groups.length > 0 && groups.every((entry) => entry.group === "keep_moving");
  const relationOnly = groups.length > 0 && groups.every((entry) => entry.group === "relation");
  const keepProjects = [...new Set(groups.filter((entry) => entry.group === "keep_moving").map((entry) => entry.project))];
  const keepTitle = keepProjects.length === 1
    ? `Keep ‹${String(keepProjects[0]).split("/").pop().replace(/\.md$/i, "")}› moving`
    : `Keep ${keepProjects.length} projects moving`;
  let relationTitle = "";
  if (relationOnly) {
    try {
      const first = groups[0] || {};
      const label = String(first.label || "starts after");
      const target = String(first.after && first.after.text || "");
      const count = groups.reduce((sum, group) => sum + ((group.rows && group.rows.length) || 0), 0);
      if (groups.length === 1 && target) {
        relationTitle = typeof relationCopyGroupTitle === "function"
          ? relationCopyGroupTitle(label, target)
          : `${label} \u201c${target}\u201d`;
      } else {
        relationTitle = typeof relationCopyPickerTitle === "function"
          ? relationCopyPickerTitle({ label, count, targets: groups.map((group) => group.after && group.after.text).filter(Boolean) })
          : `${label} ${count} tasks`;
      }
    } catch (_error) {
      relationTitle = "";
    }
  }
  const model = {
    title: keepOnly
      ? keepTitle
      : relationOnly && relationTitle
        ? relationTitle
        : predecessors.length === 1
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
  const closeCapabilities = options.offerCloseCapabilities;
  if (isSuccessorOfferCloseSupported(closeCapabilities)) {
    const descriptors = options.offerCloseDescriptors instanceof Map ||
        (options.offerCloseDescriptors && typeof options.offerCloseDescriptors === "object")
      ? options.offerCloseDescriptors
      : buildSuccessorOfferCloseDescriptors(
        offers,
        options.offerCloseContext,
        closeCapabilities,
      );
    return enrichSuccessorPickerModelWithOfferCloses(
      model,
      descriptors,
      closeCapabilities,
    );
  }
  return model;
}

// Strict validation for additive themeIntent on a destination override.
// Malformed intent is dropped so it can never enable a write; absent
// intent keeps the legacy destination shape; retype is an explicit
// alternative to the default merge landing.
function normalizeSuccessorThemeIntent(intent) {
  try {
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      return null;
    }
    if (typeof intent.deliberate !== "boolean") {
      return null;
    }
    if (typeof intent.retype !== "boolean") {
      return null;
    }
    let shown = null;
    if (intent.shown === undefined || intent.shown === null) {
      shown = null;
    } else if (typeof intent.shown !== "object") {
      return null;
    } else {
      const theme = intent.shown.theme;
      if (!theme || typeof theme !== "object") {
        return null;
      }
      if (typeof theme.key !== "string" || !theme.key) {
        return null;
      }
      shown = intent.shown;
    }
    return {
      deliberate: intent.deliberate,
      retype: intent.retype,
      shown,
    };
  } catch (error) {
    return null;
  }
}

// Optional validated task context for the destination picker. Offer
// `task.line` is zero-based; the row stores a one-based line and the full
// matching note snapshot. Malformed context is omitted so older rows stay
// selectable.
function buildSuccessorPickerTaskContext(offer) {
  try {
    if (!offer || typeof offer !== "object") {
      return null;
    }
    const task = offer.task && typeof offer.task === "object" ? offer.task : null;
    const path = (task && typeof task.path === "string" && task.path)
      || (typeof offer.notePath === "string" ? offer.notePath : "");
    if (!path) {
      return null;
    }
    const zeroBased = Number.isInteger(task && task.line)
      ? task.line
      : (Number.isInteger(offer.line) ? offer.line : null);
    if (zeroBased == null || zeroBased < 0) {
      return null;
    }
    const noteText = typeof offer.noteText === "string"
      ? offer.noteText
      : (task && typeof task.noteText === "string" ? task.noteText : null);
    if (typeof noteText !== "string") {
      return null;
    }
    const preimage = task && typeof task.rawLine === "string"
      ? task.rawLine
      : (task && typeof task.text === "string"
        ? task.text
        : (typeof offer.preimage === "string" ? offer.preimage : null));
    if (typeof preimage !== "string") {
      return null;
    }
    const lines = noteText.split(/\r?\n/);
    if (zeroBased >= lines.length || lines[zeroBased] !== preimage) {
      return null;
    }
    const displayText = typeof offer.text === "string" ? offer.text : "";
    const status = (task && typeof task.status === "string" ? task.status : null)
      || (typeof offer.status === "string" ? offer.status : " ");
    return {
      path,
      line: zeroBased + 1,
      text: noteText,
      displayText,
      status,
      preimage,
    };
  } catch (error) {
    return null;
  }
}

// Normalize a per-row destination override (§12.13 obsidian_destination):
// `{kind: "existing", entryLine, entryText, title?} | {kind: "new", name,
// preserveSpelling?}`. Optional `themeIntent` rides along when valid.
// Null unless the destination shape is exact; a malformed override never
// blocks the pick, and malformed intent never rejects a valid destination.
function normalizeSuccessorPickDestination(choice) {
  try {
    if (!choice || typeof choice !== "object") {
      return null;
    }
    const themeIntent = normalizeSuccessorThemeIntent(choice.themeIntent);
    if (choice.kind === "existing") {
      if (!Number.isInteger(choice.entryLine) || choice.entryLine < 0) {
        return null;
      }
      if (typeof choice.entryText !== "string" || !choice.entryText) {
        return null;
      }
      const title = typeof choice.title === "string" ? choice.title.trim() : "";
      return {
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        ...(title ? { title } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      };
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return {
        kind: "new",
        name,
        ...(choice.preserveSpelling === true ? { preserveSpelling: true } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Normalize a picker result to `[{key, destination?}]`. Null, empty,
// malformed, and picker exceptions all mean no picks. Validated
// destinations ride along for the override-aware insertion planner.
function normalizeSuccessorPicks(result) {
  const choices = normalizeSuccessorChoices(result);
  return choices ? choices.picks : [];
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
            subCount = projectOpenChildCount(lines, markerLine);
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
  if (group === "hand_off") return 0;
  if (group === "relation") return 1;
  if (group === "project") return 2;
  if (group === "project_finished") return 3;
  if (group === "keep_moving") return 4;
  return 3;
}

function successorRelationTargetKey(mark) {
  try {
    if (mark && typeof mark.after === "string" && mark.after) return String(mark.after);
    const rel = mark && mark.relation;
    if (rel && Array.isArray(rel.after) && rel.after[0]) {
      const first = rel.after[0];
      const path = String(first.path || "");
      const blockId = String(first.blockId || first.block_id || "");
      if (path && blockId) return `${path}#^${blockId}`;
      if (path) return path;
    }
    const unblocked = mark && (mark.unblocked_by || mark.predecessorRows);
    if (Array.isArray(unblocked) && unblocked[0]) {
      const first = unblocked[0];
      const path = String(first.note_path || first.path || "");
      const blockId = String(first.block_id || first.blockId || "");
      if (path && blockId) return `${path}#^${blockId}`;
      if (path) return path;
    }
  } catch (_error) {}
  return "";
}

function successorRelationLaneRank(status) {
  if (status === "*") return 0;
  return 1;
}

function successorOfferOrderCompare(left, right) {
  const groupOrder = successorGroupOrder(left.group || (left.pullIn ? "project_finished" : "hand_off")) - successorGroupOrder(right.group || (right.pullIn ? "project_finished" : "hand_off"));
  if (groupOrder) return groupOrder;
  const leftIsRelation = (left.group || (left.pullIn ? "project_finished" : "hand_off")) === "relation";
  const rightIsRelation = (right.group || (right.pullIn ? "project_finished" : "hand_off")) === "relation";
  if (leftIsRelation || rightIsRelation) {
    const anchorOrder = successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor);
    if (anchorOrder) return anchorOrder;
    const bulletOrder = (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1);
    if (bulletOrder) return bulletOrder;
    // Relation groups sort by T identity then label key (SA12/SA18).
    const leftTarget = successorRelationTargetKey(left);
    const rightTarget = successorRelationTargetKey(right);
    const targetOrder = String(leftTarget).localeCompare(String(rightTarget));
    if (targetOrder) return targetOrder;
    const leftLabel = String(left.key || (left.relation && left.relation.key) || "");
    const rightLabel = String(right.key || (right.relation && right.relation.key) || "");
    const labelOrder = leftLabel.localeCompare(rightLabel);
    if (labelOrder) return labelOrder;
    // Rows within a relation group: Next before Ready, then path and line.
    const leftLane = successorRelationLaneRank(left.task && left.task.status);
    const rightLane = successorRelationLaneRank(right.task && right.task.status);
    if (leftLane !== rightLane) return leftLane - rightLane;
    const pathOrder = String(left.task && left.task.path || left.notePath || "").localeCompare(String(right.task && right.task.path || right.notePath || ""));
    if (pathOrder) return pathOrder;
    return (Number((left.task && left.task.line) ?? left.line) || 0) - (Number((right.task && right.task.line) ?? right.line) || 0);
  }
  const anchorOrder = successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor);
  if (anchorOrder) return anchorOrder;
  if (left.group === "keep_moving" || right.group === "keep_moving") {
    const bulletOrder = (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1);
    if (bulletOrder) return bulletOrder;
    const pathOrder = String(left.notePath || "").localeCompare(String(right.notePath || ""));
    if (pathOrder) return pathOrder;
    const laneOrder = (SUCCESSOR_KEEP_MOVING_LANES[left.task && left.task.status] ?? 99) -
      (SUCCESSOR_KEEP_MOVING_LANES[right.task && right.task.status] ?? 99);
    if (laneOrder) return laneOrder;
  } else {
    const bulletOrder = (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1);
    if (bulletOrder) return bulletOrder;
    const pathOrder = String(left.notePath || "").localeCompare(String(right.notePath || ""));
    if (pathOrder) return pathOrder;
  }
  return (Number(left.line) || 0) - (Number(right.line) || 0);
}

// One project-resident verdict for PROJECT OFFERS (§12.2). Returns a
// descriptor consumed by planSuccessors' candidate loop; never throws.
// `ctx` carries { openIdsAfter, today, hasLiveLinkBefore, cancelledClose,
// linkUnblocked, anchorOf, dailyBefore }.
