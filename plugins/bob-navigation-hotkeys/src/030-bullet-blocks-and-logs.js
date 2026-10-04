function findCurrentBulletChildBlock(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return Object.freeze({ startLine: 0, endLineExclusive: 0 });
  }

  const startLine = parentIndex + 1;
  const parentIndentLength = getBulletIndentWidth(
    String(sourceLines[parentIndex] || ""),
  );
  let endLineExclusive = startLine;

  for (let index = startLine; index < sourceLines.length; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (getBulletIndentWidth(lineText) > parentIndentLength) {
      endLineExclusive = index + 1;
      continue;
    }

    break;
  }

  return Object.freeze({ startLine, endLineExclusive });
}

// Pick the indentation for a new dependency child bullet: reuse an existing
// child indentation, otherwise use Obsidian's default TAB indentation.
function getDependencyChildIndent(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const parentIndent = Number.isFinite(parentIndex)
    ? getBulletIndent(String(sourceLines[parentIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === parentIndex
    ) {
      return getBulletIndent(lineText);
    }
  }

  return `${parentIndent}\t`;
}

function getDependencyDirectChildIndentLength(lines, parentLine, block) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const childBlock =
    block || findCurrentBulletChildBlock(sourceLines, parentIndex);
  const parentIndentLength = Number.isFinite(parentIndex)
    ? getBulletIndentWidth(String(sourceLines[parentIndex] || ""))
    : 0;
  let childIndentLength = null;

  for (
    let index = childBlock.startLine;
    index < childBlock.endLineExclusive;
    index += 1
  ) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "" || !BULLET_PROPERTY_LIST_ITEM_RE.test(lineText)) {
      continue;
    }

    const indentLength = getBulletIndentWidth(lineText);
    if (indentLength <= parentIndentLength) {
      continue;
    }

    if (childIndentLength === null || indentLength < childIndentLength) {
      childIndentLength = indentLength;
    }
  }

  return childIndentLength;
}

// Render the managed schedule-log marker bullet, e.g. `  - 🗓️ **SCHEDULE LOG**`,
// reusing an existing marker's own indent/marker character.
function formatScheduleLogParentBullet(indent, marker) {
  return `${indent}${marker} ${SCHEDULE_LOG_MARKER_TEXT}`;
}

// The text of one schedule-log entry without its indentation or list marker:
// `*<from> → <to>* — <reason>`, or `*<to>* — <reason>` when there was no
// previous value. Split out from formatScheduleLogEntryBullet so the modal
// preview renders the exact text the writers insert instead of duplicating the
// format inline.
function formatScheduleLogEntryText({ from, to, reason }) {
  const emphasis = SCHEDULE_LOG_ENTRY_EMPHASIS;
  const fromText = from ? `${from}${SCHEDULE_LOG_TRANSITION}` : "";
  return `${emphasis}${fromText}${to}${emphasis}${SCHEDULE_LOG_SEPARATOR}${reason}`;
}

function formatScheduleLogEntryBullet(indent, marker, fields) {
  return `${indent}${marker} ${formatScheduleLogEntryText(fields)}`;
}

// Parse a managed task-log marker bullet of any kind. Mirrors bob-cli's
// parse_managed_task_log_marker(): a present emoji must agree with the label,
// so `🗓️ **WORK LOG**` is not a marker. The Cancel Log is plugin-only.
function parseManagedTaskLogParentBullet(line) {
  const text = String(line || "");
  const scheduleMatch = SCHEDULE_LOG_PARENT_RE.exec(text);
  if (scheduleMatch) {
    const { indent, marker, emoji } = scheduleMatch.groups;
    return Object.freeze({
      indent,
      marker,
      hasEmoji: Boolean(emoji),
      kind: MANAGED_TASK_LOG_KIND_SCHEDULE,
    });
  }

  const workMatch = WORK_LOG_PARENT_RE.exec(text);
  if (workMatch) {
    const { indent, marker, emoji } = workMatch.groups;
    return Object.freeze({
      indent,
      marker,
      hasEmoji: Boolean(emoji),
      kind: MANAGED_TASK_LOG_KIND_WORK,
    });
  }

  const cancelMatch = CANCEL_LOG_PARENT_RE.exec(text);
  if (cancelMatch) {
    const { indent, marker, emoji } = cancelMatch.groups;
    return Object.freeze({
      indent,
      marker,
      hasEmoji: Boolean(emoji),
      kind: MANAGED_TASK_LOG_KIND_CANCEL,
    });
  }

  return null;
}

function parseScheduleLogParentBullet(line) {
  const parsed = parseManagedTaskLogParentBullet(line);
  return parsed && parsed.kind === MANAGED_TASK_LOG_KIND_SCHEDULE
    ? Object.freeze({
        indent: parsed.indent,
        marker: parsed.marker,
        hasEmoji: parsed.hasEmoji,
      })
    : null;
}

function parseScheduleLogEntryBullet(line) {
  const match = SCHEDULE_LOG_ENTRY_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  const { indent, marker, from, to, reason } = match.groups;
  return Object.freeze({ indent, marker, from: from || "", to, reason });
}

// Trim and collapse a raw reason input to a single normalized string, without
// otherwise mutating it: wikilinks, backticks, and markdown are preserved
// verbatim. `hasInlineField` flags a Dataview-style `key:: value` span so the
// caller can warn (not block) before it lands inside a plain-markdown bullet.
function normalizeScheduleReasonText(raw) {
  const reason = String(raw === null || raw === undefined ? "" : raw)
    .replace(/\s+/g, " ")
    .trim();
  return Object.freeze({
    reason,
    empty: reason === "",
    hasInlineField: /::/.test(reason),
  });
}

// Find the managed `🗓️ **Schedule log:**` marker among `taskLine`'s direct
// children, ignoring a marker that belongs to a nested grandchild bullet.
// Returns the first match (a second marker under the same task is left alone).
function findScheduleLogParent(lines, taskLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  if (!Number.isFinite(taskIndex) || taskIndex < 0) {
    return null;
  }

  const block = findCurrentBulletChildBlock(sourceLines, taskIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    const parsed = parseScheduleLogParentBullet(lineText);
    if (parsed && findNearestParentListItem(sourceLines, index) === taskIndex) {
      return Object.freeze({
        line: index,
        indent: parsed.indent,
        marker: parsed.marker,
      });
    }
  }

  return null;
}

// Pick the indentation for a new schedule-log entry: reuse an existing
// entry's indentation when the marker already has entries, otherwise the
// marker's own indent plus one tab (mirrors getDependencyChildIndent).
function getScheduleLogEntryIndent(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const markerIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const markerIndent = Number.isFinite(markerIndex)
    ? getBulletIndent(String(sourceLines[markerIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, markerIndex);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === markerIndex
    ) {
      return getBulletIndent(lineText);
    }
  }

  return `${markerIndent}${SCHEDULE_LOG_INDENT_UNIT}`;
}

// Plan the schedule-log write for one task: either prepend a new entry above
// an existing marker's entries, or append a fresh marker + entry as the last
// direct child. Guards (never throws) on an out-of-range line, a non-list-item
// line, or an empty/whitespace-only reason.
function planScheduleLogEntry(content, taskLine, details = {}) {
  const lines = String(content || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  const guard = (reason) =>
    Object.freeze({
      valid: false,
      reason,
      changed: false,
      createdParent: false,
      usedFallback: false,
      insertLine: null,
      lineTexts: Object.freeze([]),
      lineText: null,
    });

  if (!Number.isFinite(taskIndex) || taskIndex < 0 || taskIndex >= lines.length) {
    return guard("task-out-of-range");
  }

  if (!isBulletLine(String(lines[taskIndex] || ""))) {
    return guard("not-list-item");
  }

  const normalized = normalizeScheduleReasonText(details.reason);
  const fallback = normalizeScheduleReasonText(details.fallbackReason);
  // An empty reason falls back only on a task that already keeps a log; a task
  // with no marker is still left completely untouched, which is the documented
  // escape hatch for "I do not want a log on this one".
  const usedFallback = normalized.empty && !fallback.empty;
  const reasonText = usedFallback ? fallback.reason : normalized.reason;
  if (!reasonText) {
    return guard("empty-reason");
  }

  const entryFields = {
    from: normalizeBulletPropertyValue(details.from),
    to: normalizeBulletPropertyValue(details.to),
    reason: reasonText,
  };

  const existingParent = findScheduleLogParent(lines, taskIndex);
  if (usedFallback) {
    if (!existingParent) {
      return guard("no-schedule-log");
    }
    // Generated text never claims a change that did not happen — the same rule
    // shouldWriteAutomaticScheduleLog applies to a rolled date's reason. A typed
    // reason on an unchanged date is a human decision and is still written.
    if (!shouldWriteAutomaticScheduleLog(entryFields.from, entryFields.to)) {
      return guard("unchanged-date");
    }
  }
  if (existingParent) {
    const entryIndent = getScheduleLogEntryIndent(lines, existingParent.line);
    const lineText = formatScheduleLogEntryBullet(
      entryIndent,
      existingParent.marker,
      entryFields,
    );
    return Object.freeze({
      valid: true,
      reason: null,
      changed: true,
      createdParent: false,
      usedFallback,
      insertLine: existingParent.line + 1,
      lineTexts: Object.freeze([lineText]),
      lineText,
    });
  }

  const block = findCurrentBulletChildBlock(lines, taskIndex);
  const markerIndent = getDependencyChildIndent(lines, taskIndex);
  // The entry is a grandchild of the task: one Obsidian Tab level deeper than
  // the marker it belongs to, matching getScheduleLogEntryIndent's fallback for
  // a marker that exists but has no entries yet.
  const entryIndent = `${markerIndent}${SCHEDULE_LOG_INDENT_UNIT}`;
  const lineTexts = Object.freeze([
    formatScheduleLogParentBullet(markerIndent, "-"),
    formatScheduleLogEntryBullet(entryIndent, "-", entryFields),
  ]);
  return Object.freeze({
    valid: true,
    reason: null,
    changed: true,
    createdParent: true,
    insertLine: block.endLineExclusive,
    lineTexts,
    lineText: lineTexts.join("\n"),
  });
}

// Render the managed cancel-log marker bullet, e.g. `  - ❌ **CANCEL LOG**`,
// reusing an existing marker's own indent/marker character.
function formatCancelLogParentBullet(indent, marker) {
  return `${indent}${marker} ${CANCEL_LOG_MARKER_TEXT}`;
}

// The text of one cancel-log entry without its indentation or list marker:
// `*YYYY-MM-DD* — <reason>`. Split out from formatCancelLogEntryBullet so the
// modal preview renders the exact text the writers insert instead of
// duplicating the format inline.
function formatCancelLogEntryText({ date, reason }) {
  const emphasis = SCHEDULE_LOG_ENTRY_EMPHASIS;
  const dateText = normalizeBulletPropertyValue(date);
  return `${emphasis}${dateText}${emphasis}${SCHEDULE_LOG_SEPARATOR}${reason}`;
}

function formatCancelLogEntryBullet(indent, marker, fields) {
  return `${indent}${marker} ${formatCancelLogEntryText(fields)}`;
}

function parseCancelLogParentBullet(line) {
  const parsed = parseManagedTaskLogParentBullet(line);
  return parsed && parsed.kind === MANAGED_TASK_LOG_KIND_CANCEL
    ? Object.freeze({
        indent: parsed.indent,
        marker: parsed.marker,
        hasEmoji: parsed.hasEmoji,
      })
    : null;
}

// Find the managed `❌ **CANCEL LOG**` marker among `taskLine`'s direct
// children, ignoring a marker that belongs to a nested grandchild bullet.
// Returns the first match (a second marker under the same task is left alone).
function findCancelLogParent(lines, taskLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  if (!Number.isFinite(taskIndex) || taskIndex < 0) {
    return null;
  }

  const block = findCurrentBulletChildBlock(sourceLines, taskIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    const parsed = parseCancelLogParentBullet(lineText);
    if (parsed && findNearestParentListItem(sourceLines, index) === taskIndex) {
      return Object.freeze({
        line: index,
        indent: parsed.indent,
        marker: parsed.marker,
      });
    }
  }

  return null;
}

// Pick the indentation for a new cancel-log entry: reuse an existing
// entry's indentation when the marker already has entries, otherwise the
// marker's own indent plus one tab (mirrors getDependencyChildIndent).
function getCancelLogEntryIndent(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const markerIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const markerIndent = Number.isFinite(markerIndex)
    ? getBulletIndent(String(sourceLines[markerIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, markerIndex);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === markerIndex
    ) {
      return getBulletIndent(lineText);
    }
  }

  return `${markerIndent}${MANAGED_TASK_LOG_INDENT_UNIT}`;
}

// Plan the cancel-log write for one task: either prepend a new entry above
// an existing marker's entries, or insert a fresh marker + entry as the
// task's first direct child, directly below the task line. Guards (never
// throws) on an out-of-range line, a non-list-item line, a missing date, or
// an empty/whitespace-only reason.
function planCancelLogEntry(content, taskLine, details = {}) {
  const lines = String(content || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  const guard = (reason) =>
    Object.freeze({
      valid: false,
      reason,
      changed: false,
      createdParent: false,
      usedFallback: false,
      insertLine: null,
      lineTexts: Object.freeze([]),
      lineText: null,
    });

  if (!Number.isFinite(taskIndex) || taskIndex < 0 || taskIndex >= lines.length) {
    return guard("task-out-of-range");
  }

  if (!isBulletLine(String(lines[taskIndex] || ""))) {
    return guard("not-list-item");
  }

  const dateText = normalizeBulletPropertyValue(details.date);
  if (!dateText) {
    return guard("missing-date");
  }

  const normalized = normalizeScheduleReasonText(details.reason);
  const fallback = normalizeScheduleReasonText(details.fallbackReason);
  // An empty reason falls back only on a task that already keeps a log; a task
  // with no marker is still left completely untouched, which is the documented
  // escape hatch for "I do not want a log on this one".
  const usedFallback = normalized.empty && !fallback.empty;
  const reasonText = usedFallback ? fallback.reason : normalized.reason;
  if (!reasonText) {
    return guard("empty-reason");
  }

  const entryFields = {
    date: dateText,
    reason: reasonText,
  };

  const existingParent = findCancelLogParent(lines, taskIndex);
  if (usedFallback && !existingParent) {
    return guard("no-cancel-log");
  }
  if (existingParent) {
    const entryIndent = getCancelLogEntryIndent(lines, existingParent.line);
    const lineText = formatCancelLogEntryBullet(
      entryIndent,
      existingParent.marker,
      entryFields,
    );
    return Object.freeze({
      valid: true,
      reason: null,
      changed: true,
      createdParent: false,
      usedFallback,
      insertLine: existingParent.line + 1,
      lineTexts: Object.freeze([lineText]),
      lineText,
    });
  }

  const markerIndent = getDependencyChildIndent(lines, taskIndex);
  // The verdict reads first: the marker goes directly below the task line as
  // its first direct child, and the entry nests one Tab deeper than that,
  // matching getCancelLogEntryIndent's fallback for a marker that exists but
  // has no entries yet.
  const entryIndent = `${markerIndent}${MANAGED_TASK_LOG_INDENT_UNIT}`;
  const lineTexts = Object.freeze([
    formatCancelLogParentBullet(markerIndent, "-"),
    formatCancelLogEntryBullet(entryIndent, "-", entryFields),
  ]);
  return Object.freeze({
    valid: true,
    reason: null,
    changed: true,
    createdParent: true,
    usedFallback,
    insertLine: taskIndex + 1,
    lineTexts,
    lineText: lineTexts.join("\n"),
  });
}

// Shared primitive for the two content-level schedule-log writers (project
// frontmatter and counted batch): splice a plan's lines into a mutable line
// array. Editor-level writers use insertEditorLine directly instead.
function applyScheduleLogEntryToLines(lines, plan) {
  if (!plan || !plan.changed || !Array.isArray(lines)) {
    return 0;
  }

  const insertLine = Math.floor(numericOrDefault(plan.insertLine, Number.NaN));
  if (!Number.isFinite(insertLine) || insertLine < 0) {
    return 0;
  }

  const lineTexts = Array.isArray(plan.lineTexts) ? plan.lineTexts : [];
  lines.splice(insertLine, 0, ...lineTexts);
  return lineTexts.length;
}

// True when a scheduleLog payload carries anything a writer could log: a typed
// reason, or a fallback that a task with an existing log would use. The writers
// call this before planning so an absent payload costs nothing.
function hasScheduleLogReasonInput(scheduleLog) {
  if (!scheduleLog) {
    return false;
  }

  return (
    !normalizeScheduleReasonText(scheduleLog.reason).empty ||
    !normalizeScheduleReasonText(scheduleLog.fallbackReason).empty
  );
}

// Map a planned (and attempted) schedule-log write to the outcome the writers
// report. Null means "say nothing": the task keeps no log, or the date did not
// move, and neither is a failure worth a notice.
function getScheduleLogWriteOutcome(plan, applied) {
  if (!plan) {
    return null;
  }

  if (plan.valid && applied) {
    return plan.createdParent ? "created" : plan.usedFallback ? "added-fallback" : "added";
  }

  return !plan.valid && SCHEDULE_LOG_SILENT_GUARD_REASONS.has(plan.reason) ? null : "guard-failed";
}

// The roll window as the picker states it, e.g. `random in 8–30 days`.
// Durable schedule-log reasons lean on the die emoji instead and say
// `in **8** (8–30) days`. Note the en dash.
function formatPriorityRollWindowText(level) {
  return `random in ${level.minDays}–${level.maxDays} days`;
}

function getPriorityRollBounds(level) {
  const minDays = Number(level && level.minDays);
  const maxDays = Number(level && level.maxDays);
  if (
    !Number.isInteger(minDays) ||
    !Number.isInteger(maxDays) ||
    minDays > maxDays
  ) {
    return null;
  }

  return Object.freeze({ minDays, maxDays });
}

function formatPriorityRollChosenWindowText(level, rolledDays) {
  const bounds = getPriorityRollBounds(level);
  const days = Number(rolledDays);
  if (
    !bounds ||
    !Number.isInteger(days) ||
    days < bounds.minDays ||
    days > bounds.maxDays
  ) {
    return "";
  }

  return `in **${days}** (${bounds.minDays}–${bounds.maxDays}) days`;
}

// The previous priority as a picker label for the left side of a transition.
// An absent field is the implicit P0; a value outside the configured levels
// falls through as itself rather than being dropped.
function getPriorityRollFromLevelLabel(property, value) {
  return getBulletPropertyCurrentLabel(property, value) || IMPLICIT_PRIORITY_LEVEL_LABEL;
}

// Deterministic reason text for a machine-rolled scheduled date. Priority
// choices use the level or transition as the head; pinned scheduled-stage
// choices keep a `roll` suffix so they stay distinguishable from unchanged
// priority picks.
function formatPriorityRollScheduleReason(details = {}) {
  const level = details.level;
  if (!level || !level.label) {
    return "";
  }

  const windowText = formatPriorityRollChosenWindowText(
    level,
    details.rolledDays,
  );
  if (!windowText) {
    return "";
  }

  const head =
    details.source === "priority"
      ? details.fromLevelLabel && details.fromLevelLabel !== level.label
        ? `${details.fromLevelLabel}${SCHEDULE_LOG_TRANSITION}${level.label}`
        : level.label
      : `${level.label} roll`;
  return `${SCHEDULE_LOG_AUTO_REASON_EMOJI} ${head}${SCHEDULE_LOG_AUTO_REASON_SEPARATOR}${windowText}`;
}

// An automatic entry records a scheduling change, so a roll that landed on the
// date the task already had writes nothing. A typed reason is a human decision
// and is never suppressed this way.
function shouldWriteAutomaticScheduleLog(from, to) {
  const fromValue = normalizeBulletPropertyValue(from);
  const toValue = normalizeBulletPropertyValue(to);
  return Boolean(toValue) && fromValue !== toValue;
}

// Schedule-log payload for a decay write: the previewed reason verbatim, or
// null when the reason is empty or the date is unchanged (an automatic entry
// that moves nothing writes nothing).
function buildPriorityDecayScheduleLogPayload(from, to, reason) {
  const text = normalizeBulletPropertyValue(reason);
  if (!text || normalizeScheduleReasonText(text).empty) {
    return null;
  }
  if (!shouldWriteAutomaticScheduleLog(from, to)) {
    return null;
  }
  return Object.freeze({
    from: normalizeBulletPropertyValue(from),
    to: normalizeBulletPropertyValue(to),
    reason: text,
    automatic: true,
  });
}

// Build the `options.scheduleLog` payload for a machine-rolled date, or null
// when nothing should be logged. Returning null (rather than a flag the callers
// must check) lets every writer keep its existing "falsy scheduleLog means no
// log" guard unchanged.
function buildPriorityRollScheduleLog(details = {}) {
  if (!shouldWriteAutomaticScheduleLog(details.from, details.to)) {
    return null;
  }

  const reason = formatPriorityRollScheduleReason(details);
  if (!reason) {
    return null;
  }

  return Object.freeze({
    from: normalizeBulletPropertyValue(details.from),
    to: normalizeBulletPropertyValue(details.to),
    reason,
    automatic: true,
  });
}

// Classify one Schedule Log reason for the roll-streak reader. Only reasonless,
// same-level recommended rolls build a streak; any deliberate scheduling decision
// resets it. Returns a frozen { kind, label, from, to } where kind is one of
// "roll", "randomize", "decay" or "other". "randomize" is transparent (skipped
// when counting); everything except a same-level "roll" stops the streak. The
// caller compares a "roll" label against the task's current level label.
function classifyScheduleLogRollReason(reason) {
  const text = String(reason === null || reason === undefined ? "" : reason);
  const prefix = `${SCHEDULE_LOG_AUTO_REASON_EMOJI} `;
  if (!text.startsWith(prefix)) {
    return Object.freeze({ kind: "other", label: "", from: "", to: "" });
  }
  const rest = text.slice(prefix.length);
  const separatorIndex = rest.indexOf(SCHEDULE_LOG_AUTO_REASON_SEPARATOR);
  const head =
    separatorIndex === -1 ? rest.trim() : rest.slice(0, separatorIndex).trim();
  if (!head) {
    return Object.freeze({ kind: "other", label: "", from: "", to: "" });
  }
  if (head.includes(SCHEDULE_LOG_TRANSITION)) {
    const parts = head.split(SCHEDULE_LOG_TRANSITION);
    const from = (parts[0] || "").trim();
    const toAndSuffix = (parts.slice(1).join(SCHEDULE_LOG_TRANSITION) || "").trim();
    if (/(^|\s)decay(\s|$)/.test(toAndSuffix)) {
      const to = toAndSuffix.replace(/(^|\s)decay(\s|$)/, " ").trim();
      return Object.freeze({
        kind: "decay",
        label: "",
        from,
        to,
      });
    }
    return Object.freeze({ kind: "other", label: "", from, to: toAndSuffix });
  }
  if (/\brandomize\b/.test(head)) {
    return Object.freeze({ kind: "randomize", label: "", from: "", to: "" });
  }
  const rollMatch = /^(.+?)\s+roll$/.exec(head);
  if (rollMatch) {
    return Object.freeze({
      kind: "roll",
      label: rollMatch[1].trim(),
      from: "",
      to: "",
    });
  }
  return Object.freeze({ kind: "other", label: "", from: "", to: "" });
}

// Count the roll streak from newest-first Schedule Log reasons. Only reasonless
// same-level recommended rolls count; a `randomize` entry is transparent and
// anything else (a decay, a priority re-pick, a typed reason, an unparseable
// bullet) stops the walk.
function countPriorityRollStreak(reasons, currentLabel) {
  const label = normalizeBulletPropertyValue(currentLabel);
  if (!label) {
    return 0;
  }
  let streak = 0;
  for (const reason of Array.isArray(reasons) ? reasons : []) {
    const classified = classifyScheduleLogRollReason(reason);
    if (classified.kind === "randomize") {
      continue;
    }
    if (
      classified.kind === "roll" &&
      normalizeBulletPropertyValue(classified.label) === label
    ) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

// Read the roll streak from the task's managed Schedule Log: the number of
// `🎲 <level> roll` entries at the current level, counted from the newest entry
// until the first entry that breaks it. Derived, never stored. Returns 0 when
// there is no log, no current label, or no streak.
function getPriorityRollStreak(content, taskLine, currentLabel) {
  const label = normalizeBulletPropertyValue(currentLabel);
  if (!label) {
    return 0;
  }
  const lines = String(content || "").split(/\r?\n/);
  const parent = findScheduleLogParent(lines, taskLine);
  if (!parent) {
    return 0;
  }
  const block = findCurrentBulletChildBlock(lines, parent.line);
  const reasons = [];
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(lines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }
    if (
      !BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) ||
      findNearestParentListItem(lines, index) !== parent.line
    ) {
      continue;
    }
    const parsed = parseScheduleLogEntryBullet(lineText);
    if (!parsed) {
      reasons.push(lineText);
      continue;
    }
    reasons.push(parsed.reason);
  }
  return countPriorityRollStreak(reasons, label);
}

// Deterministic reason text for a decay write: the transition gains a `decay`
// suffix, e.g. `🎲 P2 → P3 decay · in **45** (31–90) days`. The window always
// comes from the level the task decays into.
function formatPriorityDecayScheduleReason(details = {}) {
  const fromLevel = details.fromLevel;
  const toLevel = details.toLevel;
  if (!fromLevel || !fromLevel.label || !toLevel || !toLevel.label) {
    return "";
  }
  const windowText = formatPriorityRollChosenWindowText(
    toLevel,
    details.rolledDays,
  );
  if (!windowText) {
    return "";
  }
  const head = `${fromLevel.label}${SCHEDULE_LOG_TRANSITION}${toLevel.label} decay`;
  return `${SCHEDULE_LOG_AUTO_REASON_EMOJI} ${head}${SCHEDULE_LOG_AUTO_REASON_SEPARATOR}${windowText}`;
}

// Cancel Log reason for a decay past the last level: `🍂 decayed past P4 after
// 1 roll`, `… after 3 rolls`, or just `🍂 decayed past P4` when the streak is 0.
function formatPriorityDecayCancelReason(details = {}) {
  const label = normalizeBulletPropertyValue(
    details.level && details.level.label,
  );
  if (!label) {
    return "";
  }
  const streak = Math.floor(numericOrDefault(details.streak, 0));
  if (!(streak > 0)) {
    return `${PRIORITY_DECAY_CANCEL_EMOJI} decayed past ${label}`;
  }
  return `${PRIORITY_DECAY_CANCEL_EMOJI} decayed past ${label} after ${streak} roll${streak === 1 ? "" : "s"}`;
}

// Plan the recommended roll for one task: a same-level roll, a decay to the
// next level, or a cancel past the last level. Pure: pass the streak explicitly,
// or pass content + taskLine to derive it from the task's Schedule Log. Null
// when there is no recommendation (no priority property, or the current value is
// not a configured level). A cancel on a recurring task is `unavailable`:
// nothing may be written, so no date is rolled.
