function resolveBulletPropertyTarget(name, context = {}) {
  const descriptor = Object.prototype.hasOwnProperty.call(
    PROJECT_NOTE_PROPERTY_TARGETS,
    name,
  )
    ? PROJECT_NOTE_PROPERTY_TARGETS[name]
    : null;
  if (descriptor && context.isProjectTask && context.valid) {
    return descriptor;
  }

  return Object.freeze({ kind: "inline", fieldName: name });
}

function getBulletPropertyCurrentLabel(property, value) {
  const currentValue = normalizeBulletPropertyValue(value);
  if (
    property &&
    property.values === "priority" &&
    property.levelsByValue instanceof Map
  ) {
    const level = property.levelsByValue.get(currentValue);
    if (level) {
      return level.label;
    }
  }

  return currentValue;
}

function createBulletPropertyItems(config, line, context = {}) {
  const fields = getBulletPropertyFieldMap(line);
  const dependencyEligible =
    context.isObsidianTask === undefined
      ? isObsidianTaskLine(line)
      : Boolean(context.isObsidianTask);
  return config.properties
    .map((property, order) => {
      const target = resolveBulletPropertyTarget(property.name, context);
      const field =
        target.kind === "inline" ? fields.get(property.name) || null : null;
      const frontmatterDefined =
        target.kind === "project-frontmatter" &&
        context.frontmatter &&
        context.frontmatter.scheduledDefined;
      const currentValue = frontmatterDefined
        ? context.frontmatter.scheduledValue
        : field
          ? field.value
          : "";
      return {
        kind: "property",
        property,
        target,
        order,
        defined: frontmatterDefined || !!field,
        currentValue,
        currentLabel: getBulletPropertyCurrentLabel(property, currentValue),
        dependencyEligible,
      };
    })
    .filter(
      (item) =>
        item.property.values !== "local_task_id" ||
        item.dependencyEligible ||
        item.defined,
    )
    .sort((first, second) => {
      if (first.defined !== second.defined) {
        return first.defined ? -1 : 1;
      }

      return first.order - second.order;
    });
}

// An explicit Vim count for the property picker means "additional tasks": a
// repeat of 2 snapshots the current real task plus the next two real tasks in
// document order. Physical line distance is deliberately irrelevant.
function discoverCountedObsidianTaskTargets(
  content,
  startLine,
  additionalTaskCount,
) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalTaskCount, 0)),
  );
  const requestedCount = additional + 1;
  const contexts = getMarkdownLineContexts(text);

  if (
    !Number.isFinite(line) ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines)
  ) {
    return Object.freeze({
      valid: false,
      error: "Counted property editing must start on a #task checkbox",
      explicit: true,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
    });
  }

  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < source.lines.length && targets.length < requestedCount;
    lineIndex += 1
  ) {
    if (
      isObsidianTaskAtLine(text, lineIndex, contexts, source.lines)
    ) {
      targets.push(
        Object.freeze({
          line: lineIndex,
          rawLine: String(source.lines[lineIndex] || ""),
        }),
      );
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
  });
}

function validateCountedTaskSession(content, session) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const targets = session && Array.isArray(session.targets)
    ? session.targets
    : [];
  if (!session || session.valid === false || targets.length === 0) {
    return Object.freeze({
      valid: false,
      error: "Counted task session is unavailable",
      staleTarget: null,
    });
  }

  for (const target of targets) {
    const liveLine = Number.isInteger(target.line)
      ? source.lines[target.line]
      : undefined;
    if (
      liveLine !== target.rawLine ||
      !isObsidianTaskAtLine(text, target.line, contexts, source.lines)
    ) {
      return Object.freeze({
        valid: false,
        error: "A counted task changed while the picker was open",
        staleTarget: target,
      });
    }
  }

  return Object.freeze({ valid: true, error: null, staleTarget: null });
}

// ---------------------------------------------------------------------------
// link-picker: Ctrl+Shift+P edits the task behind a Task Link bullet.
//
// A dedicated Task Link bullet is a bullet whose body, after an optional
// checkbox, optional 🍅 markers, an optional wrapping ~~…~~, and an optional
// trailing `#` move-only marker, is exactly one block link `[[T#^id]]` or
// `![[T#^id]]` with an optional alias. This mirrors block-id-prompt's
// dedicated-link grammar so both plugins agree on what a Task Link bullet is,
// but stays self-contained because plugins deploy separately.
// ---------------------------------------------------------------------------
const LINK_PICKER_DEDICATED_BODY_RE =
  /^(?:\[[^\]\n]\][ \t]+)?(?:🍅[ \t]+)*(~~)?(!)?\[\[([^\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\](~~)?(?:[ \t]*#)?[ \t]*$/u;

// Parse a dedicated Task Link bullet line into its link parts, or null when
// the line is not one. The body must hold exactly one block link; a
// strikethrough marker must wrap both sides or neither.
function parseLinkPickerTaskLink(lineText) {
  const line = String(lineText || "");
  const bounds = pomodoroBulletBodyBounds(line);
  if (!bounds) {
    return null;
  }
  const body = line.slice(bounds.start, bounds.end);
  const match = LINK_PICKER_DEDICATED_BODY_RE.exec(body);
  if (!match) {
    return null;
  }
  const strikeOpen = match[1] || null;
  const strikeClose = match[5] || null;
  if (Boolean(strikeOpen) !== Boolean(strikeClose)) {
    return null;
  }
  return Object.freeze({
    target: String(match[3] || "").trim(),
    blockId: match[4],
    embedded: Boolean(match[2]),
    struck: Boolean(strikeOpen),
  });
}

// Discover the Task Links a counted Ctrl+Shift+P covers: the dedicated link
// under the cursor plus the next N dedicated Task Link siblings — same indent
// depth, same parent block (for ledger links, the same Pomodoro entry), in
// document order, skipping non-link siblings. The scan stops when the parent
// block ends and clamps there. On a #task line the existing task behavior is
// unchanged, so a non-link line reports `notLink` instead of an error and the
// caller falls through to the regular picker path.
function discoverLinkPickerTargets(content, startLine, additionalTaskCount) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalTaskCount, 0)),
  );
  const requestedCount = additional + 1;
  const contexts = getMarkdownLineContexts(text);
  const invalid = (error, notLink = false) =>
    Object.freeze({
      valid: false,
      error,
      notLink,
      explicit: additional > 0,
      kind: "task-link",
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
    });
  if (
    !Number.isFinite(line) ||
    line < 0 ||
    line >= source.lines.length ||
    (contexts[line] && contexts[line].inFence)
  ) {
    return invalid("Cursor is not on a Task Link", true);
  }
  if (isObsidianTaskAtLine(text, line, contexts, source.lines)) {
    return invalid("Cursor is not on a Task Link", true);
  }
  const firstLink = parseLinkPickerTaskLink(source.lines[line]);
  if (!firstLink) {
    return invalid("Cursor is not on a Task Link", true);
  }

  const cursorIndent = getBulletIndentWidth(String(source.lines[line] || ""));
  const targets = [
    Object.freeze({
      line,
      rawLine: String(source.lines[line] || ""),
      link: firstLink,
    }),
  ];
  let clamped = false;
  for (
    let lineIndex = line + 1;
    lineIndex < source.lines.length && targets.length < requestedCount;
    lineIndex += 1
  ) {
    const lineText = String(source.lines[lineIndex] || "");
    if (lineText.trim() === "") {
      continue;
    }
    if (contexts[lineIndex] && contexts[lineIndex].inFence) {
      continue;
    }
    const indent = getBulletIndentWidth(lineText);
    if (indent < cursorIndent) {
      clamped = targets.length < requestedCount;
      break;
    }
    if (
      cursorIndent === 0 &&
      !PROJECT_LIST_ITEM_RE.test(lineText)
    ) {
      clamped = targets.length < requestedCount;
      break;
    }
    if (indent !== cursorIndent) {
      continue;
    }
    const link = parseLinkPickerTaskLink(lineText);
    if (!link) {
      continue;
    }
    targets.push(
      Object.freeze({ line: lineIndex, rawLine: lineText, link }),
    );
  }
  if (targets.length < requestedCount) {
    clamped = true;
  }

  return Object.freeze({
    valid: true,
    error: null,
    notLink: false,
    explicit: additional > 0,
    kind: "task-link",
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped,
    targets: Object.freeze(targets),
  });
}

// Resolve a block ID to its task line inside one note's content. The ID must
// be unique and must sit on an open #task line; anything else reports an
// error the caller surfaces as a Notice without changing anything.
function findUniqueLinkPickerTargetLine(noteContent, blockId) {
  const id = normalizeBulletPropertyValue(blockId);
  const text = String(noteContent || "");
  if (!id) {
    return Object.freeze({ valid: false, error: "missing", line: null });
  }
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const matches = [];
  for (let index = 0; index < source.lines.length; index += 1) {
    if (
      getTrailingBlockId(String(source.lines[index] || "")) === id
    ) {
      matches.push(index);
    }
  }
  if (matches.length === 0) {
    return Object.freeze({ valid: false, error: "missing", line: null });
  }
  if (matches.length !== 1) {
    return Object.freeze({ valid: false, error: "duplicated", line: null });
  }
  const line = matches[0];
  const rawLine = String(source.lines[line] || "");
  if (!isObsidianTaskAtLine(text, line, contexts, source.lines)) {
    return Object.freeze({ valid: false, error: "not-task", line: null });
  }
  if (!isOpenObsidianTaskLine(rawLine)) {
    return Object.freeze({ valid: false, error: "closed", line: null });
  }
  return Object.freeze({ valid: true, error: null, line, rawLine });
}

// Aggregate one property row across link-picker targets that live in different
// notes. Mirrors createCountedBulletPropertyItems (common only when every
// target defines the same value, otherwise mixed) but reads each target from
// its own note content. The Depends on row edits the linked task in its own
// note, for single links and batches alike (`docs/task-dependencies.md` §6.1).
function createLinkPickerPropertyItems(config, resolvedTargets, options = {}) {
  const targets = Array.isArray(resolvedTargets) ? resolvedTargets : [];
  if (targets.length === 0) {
    return Object.freeze({ valid: false, error: "No linked tasks", items: [] });
  }
  const singleLinkTarget =
    targets.length === 1 ? targets[0] : null;
  const properties = (config && Array.isArray(config.properties)
    ? config.properties
    : []
  ).filter((property) => {
    const name = normalizeBulletPropertyName(property && property.name);
    if (property && property.values === "local_task_id") {
      return name === "dependsOn";
    }
    return name !== "dependsOn";
  });
  const items = [];
  for (let order = 0; order < properties.length; order += 1) {
    const property = properties[order];
    const states = [];
    for (const target of targets) {
      const state = getCountedPropertyTargetState(
        target.content,
        { line: target.line, rawLine: target.rawLine },
        property,
        options,
      );
      if (!state.valid) {
        return Object.freeze({ valid: false, error: state.error, items: [] });
      }
      states.push(state);
    }

    const definedStates = states.filter((state) => state.defined);
    const values = Array.from(
      new Set(definedStates.map((state) => state.value)),
    );
    const allDefined = definedStates.length === states.length;
    const valueState =
      definedStates.length === 0
        ? "absent"
        : allDefined && values.length === 1
          ? "common"
          : "mixed";
    const currentLabels = Object.freeze(
      values.map((value) => getBulletPropertyCurrentLabel(property, value)),
    );
    const isLinkDependencyRow =
      property &&
      property.values === "local_task_id" &&
      normalizeBulletPropertyName(property.name) === "dependsOn";
    items.push({
      kind: "property",
      property,
      target: Object.freeze({ kind: "link-picker-batch" }),
      order,
      defined: definedStates.length > 0,
      definedCount: definedStates.length,
      targetCount: states.length,
      currentValue: valueState === "common" ? values[0] : "",
      currentLabel: valueState === "common" ? currentLabels[0] : "",
      currentValues: Object.freeze(values),
      currentLabels,
      valueState,
      mixed: valueState === "mixed",
      dependencyEligible: false,
      sourceStates: Object.freeze(states),
      linkDependency: isLinkDependencyRow,
      detailText: isLinkDependencyRow
        ? singleLinkTarget
          ? `↗ ${dependencyStageBasenameOf(singleLinkTarget.path)} · ${singleLinkTarget.displayText}`
          : `↗ ${targets.length} linked tasks · opens each in its own note`
        : null,
    });
  }

  items.sort((first, second) => {
    if (first.defined !== second.defined) {
      return first.defined ? -1 : 1;
    }
    return first.order - second.order;
  });
  return Object.freeze({
    valid: true,
    error: null,
    items: Object.freeze(items),
  });
}

// Group resolved link-picker targets by note so each note is planned with the
// pure counted-batch planner and written with one guarded transaction.
function groupLinkPickerTargetsByNote(resolvedTargets) {
  const groups = new Map();
  for (const target of Array.isArray(resolvedTargets)
    ? resolvedTargets
    : []) {
    if (!target || !target.path) {
      continue;
    }
    if (!groups.has(target.path)) {
      groups.set(
        target.path,
        Object.freeze({
          path: target.path,
          file: target.file || null,
          content: target.content,
          targets: [],
        }),
      );
    }
    groups.get(target.path).targets.push(
      Object.freeze({ line: target.line, rawLine: target.rawLine }),
    );
  }
  return Array.from(groups.values()).map((group) =>
    Object.freeze({
      path: group.path,
      file: group.file,
      content: group.content,
      session: Object.freeze({
        valid: true,
        error: null,
        explicit: true,
        kind: "task-link",
        startLine: group.targets[0] ? group.targets[0].line : null,
        requestedAdditionalCount: group.targets.length - 1,
        requestedCount: group.targets.length,
        actualCount: group.targets.length,
        clamped: false,
        targets: Object.freeze(group.targets),
      }),
    }),
  );
}

// Picker subtitle for a link session: `↗ <note> · <task text>` for one link,
// a link count for a batch, and the clamp notice at the parent's end.
function getLinkPickerSessionSubtitle(session) {
  if (!session || !Array.isArray(session.targets)) {
    return "";
  }
  if (session.actualCount <= 1) {
    const first =
      session.resolved && session.resolved.length > 0
        ? session.resolved[0]
        : null;
    if (!first) {
      return "Task Link";
    }
    const note = getVaultPathBasenameWithoutExtension(first.path || "");
    const task = truncateBulletPropertySubtitle(
      cleanTaskDisplayText(first.rawLine || ""),
    );
    const single = `↗ ${note} · ${task}`;
    if (session.clamped) {
      return `${single} · ${formatCountLabel(session.actualCount, "link")} of ${session.requestedCount} requested · end of Pomodoro`;
    }
    return single;
  }
  if (session.clamped) {
    return `${formatCountLabel(session.actualCount, "link")} of ${
      session.requestedCount
    } requested · end of Pomodoro`;
  }
  return formatCountLabel(session.actualCount, "link");
}

// ---------------------------------------------------------------------------
// task-lane: Commit Ready to Next, or release Next/In Progress to Ready.
//
// - Commit: if any target is Ready (` `), every Ready target becomes Next
//   (`*`). Other targets are untouched and no link is written.
// - Release: otherwise, every Next (`*`) and In Progress (`/`) target
//   becomes Ready (` `), and each released task's live links under today's
//   open Pomodoros are removed by the caller. Blocked (`?`) targets are
//   skipped and counted in the Notice ("Blocked is derived").
// - Done, cancelled and non-task targets keep the existing session refusals.
// - `summary` (optional) is prepended to each released In Progress task's
//   Work Log; a blank summary writes nothing. `dateText` is `YYYY-MM-DD`.
//   Work Log planning mirrors block-id-prompt's pure `planWorkLogInsertion`
//   (see `plugins/block-id-prompt/main.js`): prepend under the existing
//   marker when one is a direct child, else append a new marker plus entry
//   at the end of the task's child block. Copied as an independent
//   implementation since plugins deploy separately and never import each
//   other's `main.js`.
function normalizeLaneWorkSummary(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s+/g, " ");
}

function formatLaneWorkLogEntry(summary, dateText) {
  const normalized = normalizeLaneWorkSummary(summary);
  if (!normalized) {
    return "";
  }
  return `*${String(dateText || "")}* — ${normalized}`;
}

function findLaneWorkLogParent(lines, taskLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  if (!Number.isFinite(taskIndex) || taskIndex < 0 || taskIndex >= sourceLines.length) {
    return null;
  }
  const block = findCurrentBulletChildBlock(sourceLines, taskIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (!lineText.trim()) {
      continue;
    }
    if (!WORK_LOG_PARENT_RE.exec(lineText)) {
      continue;
    }
    if (findNearestParentListItem(sourceLines, index) === taskIndex) {
      const indentMatch = /^([ \t]*)/.exec(lineText);
      const markerMatch = /^[ \t]*(?:>\s*)*([-*+]|\d+[.)])/.exec(lineText);
      return {
        line: index,
        indent: indentMatch ? indentMatch[1] : "",
        marker: markerMatch ? markerMatch[1] : "-",
      };
    }
  }
  return null;
}

function getLaneTaskChildIndent(lines, taskLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  const parentIndent = Number.isFinite(taskIndex)
    ? getBulletIndent(String(sourceLines[taskIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, taskIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (!lineText.trim()) {
      continue;
    }
    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === taskIndex
    ) {
      return getBulletIndent(lineText);
    }
  }
  const unit = parentIndent && !parentIndent.includes("\t") ? parentIndent : "\t";
  return `${parentIndent}${unit}`;
}

// Insert one Work Log entry into `workingLines` (mutated in place) for the
// task at `taskLine`. Returns true when an entry was added.
function insertLaneWorkLogEntry(workingLines, taskLine, summary, dateText) {
  const normalized = normalizeLaneWorkSummary(summary);
  if (!normalized) {
    return false;
  }
  const entryText = formatLaneWorkLogEntry(normalized, dateText);
  if (!entryText) {
    return false;
  }
  const marker = findLaneWorkLogParent(workingLines, taskLine);
  if (marker) {
    const markerBlock = findCurrentBulletChildBlock(workingLines, marker.line);
    let entryIndent = `${marker.indent}\t`;
    let entryMarker = "-";
    for (let index = marker.line + 1; index < markerBlock.endLineExclusive; index += 1) {
      const lineText = String(workingLines[index] || "");
      if (!lineText.trim()) {
        continue;
      }
      if (
        BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
        findNearestParentListItem(workingLines, index) === marker.line
      ) {
        entryIndent = getBulletIndent(lineText);
        const markerMatch = /^[ \t]*(?:>\s*)*([-*+]|\d+[.)])/.exec(lineText);
        entryMarker = markerMatch ? markerMatch[1] : "-";
        break;
      }
    }
    workingLines.splice(marker.line + 1, 0, `${entryIndent}${entryMarker} ${entryText}`);
    return true;
  }
  const childIndent = getLaneTaskChildIndent(workingLines, taskLine);
  const taskIndent = getBulletIndent(String(workingLines[taskLine] || ""));
  const taskMarkerMatch = /^[ \t]*(?:>\s*)*([-*+]|\d+[.)])/.exec(
    String(workingLines[taskLine] || ""),
  );
  const taskMarker = taskMarkerMatch ? taskMarkerMatch[1] : "-";
  void taskMarker;
  const block = findCurrentBulletChildBlock(workingLines, taskLine);
  const markerLine = `${childIndent}- ${WORK_LOG_EMOJI} **${WORK_LOG_LABEL}**`;
  const entryLine = `${childIndent}\t- ${entryText}`;
  void taskIndent;
  workingLines.splice(block.endLineExclusive, 0, markerLine, entryLine);
  return true;
}

// Scheduling Work Log eligibility: the explicit target's validated line must be
// a real open `#task` in Pending (`/`) or Next (`*`) before any schedule
// propagation, checkbox recovery/blocking, freshness stamp, or cancellation.
// Determined from the original status, never from links or the postimage
// (which may already be `[?]` after a future-date prune).
function isSchedulingWorkLogStatus(status) {
  return status === "/" || status === "*";
}

function isSchedulingWorkLogRawLine(rawLine) {
  const status = getObsidianTaskCheckboxStatus(String(rawLine || ""));
  if (!isSchedulingWorkLogStatus(status)) {
    return false;
  }
  return isObsidianTaskLine(String(rawLine || ""));
}

function isPendingWorkLogTargetRawLine(rawLine) {
  const line = String(rawLine || "");
  return (
    getObsidianTaskCheckboxStatus(line) === "/" &&
    isObsidianTaskLine(line)
  );
}

function normalizeSchedulingWorkSummary(value) {
  return normalizeLaneWorkSummary(value);
}

function hasSchedulingWorkLogInput(workLog) {
  if (!workLog || typeof workLog !== "object") {
    return false;
  }
  return Boolean(normalizeSchedulingWorkSummary(workLog.summary));
}

function resolveSchedulingWorkLogDateText(workLog, fallbackDate) {
  if (workLog && typeof workLog.dateText === "string" && workLog.dateText) {
    return String(workLog.dateText);
  }
  if (typeof fallbackDate === "string" && fallbackDate) {
    return String(fallbackDate);
  }
  return formatBulletPropertyDate(getLocalDateStart(new Date()));
}

// Note-plus-identity key for a scheduling target. Linked notes can share a
// line number, so eligibility and review counts never use line alone.
function schedulingWorkLogTargetIdentity(target) {
  if (!target || typeof target !== "object") {
    return "";
  }
  const path = typeof target.path === "string" ? target.path : "";
  const blockId =
    normalizeBulletPropertyValue(target.blockId) ||
    getTrailingBlockId(String(target.rawLine || "")) ||
    "";
  if (blockId) {
    return `${path}#^${blockId}`;
  }
  if (Number.isInteger(target.line)) {
    return `${path}::${target.line}`;
  }
  return "";
}

function freezeSchedulingWorkLogTargets(targets) {
  return Object.freeze(
    (Array.isArray(targets) ? targets : [])
      .filter((target) => target && Number.isInteger(target.line))
      .map((target) =>
        Object.freeze({
          path: typeof target.path === "string" ? target.path : "",
          line: target.line,
          rawLine: String(target.rawLine || ""),
          blockId:
            normalizeBulletPropertyValue(target.blockId) ||
            getTrailingBlockId(String(target.rawLine || "")) ||
            "",
        }),
      ),
  );
}

function collectSchedulingWorkLogTargetIdentities(targets) {
  const identities = new Set();
  for (const target of Array.isArray(targets) ? targets : []) {
    const identity = schedulingWorkLogTargetIdentity(target);
    if (identity) {
      identities.add(identity);
    }
  }
  return identities;
}

function collectSchedulingWorkLogEligibleIdentities(targets) {
  const eligible = new Set();
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!isSchedulingWorkLogRawLine(target && target.rawLine)) {
      continue;
    }
    const identity = schedulingWorkLogTargetIdentity(target);
    if (identity) {
      eligible.add(identity);
    }
  }
  return eligible;
}

function schedulingWorkLogSnapshotChanged(frozen, currentTargets) {
  const current = freezeSchedulingWorkLogTargets(currentTargets);
  const previous = freezeSchedulingWorkLogTargets(frozen);
  if (previous.length !== current.length) {
    return true;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index];
    const right = current[index];
    if (
      !left ||
      !right ||
      left.path !== right.path ||
      left.line !== right.line ||
      left.rawLine !== right.rawLine ||
      left.blockId !== right.blockId
    ) {
      return true;
    }
  }
  return false;
}

function getScheduleReviewHints(options = {}) {
  const hints = [
    {
      keys: ["↵"],
      label: options.empty ? "Skip optional logs" : "Apply schedule",
    },
  ];
  if (options.hasWorkLog) {
    hints.push({ keys: ["tab"], label: "Next field" });
  }
  hints.push({ keys: ["esc"], label: "Cancel" });
  return hints;
}

// Pure planner for the combined Task Card schedule review. A review is needed
// when the reason is still unknown or any explicit Next/Pending target
// qualifies for a Work Log. Inline/skip reasons with no Work target dispatch
// immediately.
