// Shared pure Snoozed-row cleanup planners. Keep this fragment byte-identical
// in bob-navigation-hotkeys, block-id-prompt, and task-status-cycler.

function snoozeLinkMapKey(target, blockId) {
  return String(target == null ? "" : target) + "\u0000" + String(blockId == null ? "" : blockId);
}

function snoozeNormalizeIdentity(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const route = value.route || value.path;
  const block = value.blockId || value.block || value.id;
  return snoozeIdentityKey(route, block);
}

function snoozeResolveRowIdentity(row, options) {
  const config = options && typeof options === "object" ? options : {};
  if (!row || row.kind !== "active" || !row.blockId) return null;
  if (typeof config.resolveIdentity === "function") {
    try {
      return snoozeNormalizeIdentity(config.resolveIdentity(row));
    } catch (_) {
      return null;
    }
  }
  const map = config.identityByLink;
  const key = snoozeLinkMapKey(row.target, row.blockId);
  if (map instanceof Map) return snoozeNormalizeIdentity(map.get(key));
  if (map && typeof map === "object") return snoozeNormalizeIdentity(map[key]);
  return null;
}

function snoozeLineRemovalEdit(section, row) {
  const record = section.lines[row.lineIndex];
  const last = section.lines[Math.max(row.lineIndex, row.childrenEnd - 1)] || record;
  return {
    start: record.start,
    end: last.nextStart,
    replacement: "",
    lineStart: row.lineIndex,
    lineEnd: row.childrenEnd,
    kind: "row",
  };
}

function snoozeApplyEdits(source, edits) {
  let output = String(source == null ? "" : source);
  const ordered = edits.slice().sort((left, right) => right.start - left.start);
  for (const edit of ordered) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return output;
}

function snoozeEmptySectionEdit(source, prunedText) {
  const section = snoozeParseSection(prunedText);
  if (!section || section.rows.length) return null;
  const hasProse = section.lines
    .slice(section.contentStart, section.contentEnd)
    .some((line) => line.text.trim() !== "");
  if (hasProse) return null;
  const originalSection = snoozeParseSection(source);
  if (!originalSection) return null;
  let start = originalSection.headerStart;
  const end = originalSection.sectionEndOffset;
  const atEof = originalSection.contentEnd === originalSection.lines.length;
  if (atEof) {
    const originalLines = snoozeLineRecords(source);
    let headerIndex = originalLines.findIndex((line) => line.start === originalSection.headerStart);
    while (headerIndex > 0 && originalLines[headerIndex - 1].text.trim() === "") {
      headerIndex -= 1;
      start = originalLines[headerIndex].start;
    }
  }
  return { start, end, replacement: "", lineStart: originalSection.headerLine, lineEnd: originalSection.contentEnd, kind: "empty-section" };
}

function snoozeFinalizeRemoval(source, removals) {
  const original = String(source == null ? "" : source);
  const rowEdits = removals.map((item) => item.edit);
  const intermediate = snoozeApplyEdits(original, rowEdits);
  const sectionEdit = snoozeEmptySectionEdit(original, intermediate);
  const edits = sectionEdit ? [sectionEdit] : rowEdits.slice().sort((left, right) => left.start - right.start);
  const postimage = sectionEdit
    ? original.slice(0, sectionEdit.start) + sectionEdit.replacement + original.slice(sectionEdit.end)
    : intermediate;
  return { postimage, edits, sectionRemoved: Boolean(sectionEdit) };
}

function snoozeRemovalDetails(removals) {
  const identities = Array.from(new Set(removals.map((item) => item.identity).filter(Boolean))).sort();
  return {
    removedIdentities: identities,
    detachedSubtrees: removals.map((item) => ({
      identity: item.identity,
      line: item.row.line,
      source: item.row.subtree,
      children: item.row.childrenText,
      row: item.row,
    })),
  };
}

function snoozePlanRemoveRows(source, selectedIdentities, options) {
  const text = String(source == null ? "" : source);
  const section = snoozeParseSection(text);
  const wanted = new Set((Array.isArray(selectedIdentities) ? selectedIdentities : [selectedIdentities])
    .map(snoozeNormalizeIdentity)
    .filter(Boolean));
  if (!section || !wanted.size) {
    return { postimage: text, text, edits: [], removedIdentities: [], detachedSubtrees: [], sectionRemoved: false };
  }
  const removals = [];
  for (const row of section.rows) {
    if (row.kind !== "active") continue;
    const identity = snoozeResolveRowIdentity(row, options);
    if (!identity || !wanted.has(identity)) continue;
    removals.push({ identity, row, edit: snoozeLineRemovalEdit(section, row) });
  }
  const final = snoozeFinalizeRemoval(text, removals);
  return { ...final, text: final.postimage, ...snoozeRemovalDetails(removals) };
}

function snoozeTaskFactsByLink(tasks) {
  const byLink = new Map();
  const byIdentity = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== "object") continue;
    const route = typeof task.route === "string" && task.route ? task.route : task.path;
    const block = task.block;
    const identity = snoozeIdentityKey(route, block);
    const linkTarget = typeof task.link === "string" ? snoozeBlockLinkSpans(task.link)[0] : null;
    const target = typeof task.target === "string"
      ? task.target
      : (linkTarget ? linkTarget.target : (typeof route === "string" ? route.split("/").pop().replace(/\.md$/i, "") : ""));
    if (!identity || typeof target !== "string") continue;
    const key = snoozeLinkMapKey(target, block);
    if (task.resolution === "ambiguous") {
      byLink.set(key, null);
      continue;
    }
    if (task.resolution === "missing" || task.resolution === "unresolved") continue;
    const existing = byLink.get(key);
    if (existing && existing.identity !== identity) {
      byLink.set(key, null);
      continue;
    }
    if (existing === null && byLink.has(key)) continue;
    byLink.set(key, { identity, task });
    byIdentity.set(identity, task);
  }
  return { byLink, byIdentity };
}

function snoozePomodorosRange(source) {
  const lines = snoozeLineRecords(source);
  const frontmatterEnd = snoozeFrontmatterEnd(lines);
  let fence = null;
  let header = null;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (frontmatterEnd !== null && index <= frontmatterEnd) continue;
    const line = lines[index].text;
    if (fence) {
      if (snoozeClosesFence(line, fence)) fence = null;
      continue;
    }
    const marker = snoozeFenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    if (header === null) {
      if (/^##[ \t]+Pomodoros(?:$|\s)/.test(line)) header = index;
    } else if (snoozeLevelTwoHeading(line)) {
      end = index;
      break;
    }
  }
  return header === null ? null : { lines, start: header + 1, end };
}

function snoozeMarkdownListItem(line) {
  const indent = (line.match(/^[ \t]*/) || [""])[0].length;
  const match = /^[-*+][ \t]+(.*)$/.exec(line.slice(indent));
  return match ? { indent, body: match[1] } : null;
}

function snoozeIsStruckLink(text, span) {
  const delimiters = [];
  let cursor = 0;
  while (true) {
    const at = text.indexOf("~~", cursor);
    if (at < 0) break;
    delimiters.push(at);
    cursor = at + 2;
  }
  for (let index = 0; index + 1 < delimiters.length; index += 2) {
    if (span.tokenStart >= delimiters[index] + 2 && span.end <= delimiters[index + 1]) return true;
  }
  return false;
}

function snoozeDayLiveIdentities(source, byLink) {
  const range = snoozePomodorosRange(source);
  const identities = new Set();
  if (!range) return identities;
  let entry = null;
  for (let index = range.start; index < range.end; index += 1) {
    const line = range.lines[index].text;
    const item = snoozeMarkdownListItem(line);
    if (item && item.indent === 0) {
      const status = /^\[([ *\/?xX-])\](?:[ \t]|$)/.exec(item.body);
      entry = status && [" ", "*", "/", "?"].includes(status[1])
        ? { indent: 0, childIndent: null }
        : null;
      continue;
    }
    if (!entry || !item || item.indent <= entry.indent) continue;
    if (entry.childIndent === null) entry.childIndent = item.indent;
    if (item.indent !== entry.childIndent) continue;
    let body = item.body;
    if (body.startsWith("🍅")) body = body.slice("🍅".length).trimStart();
    const spans = snoozeBlockLinkSpans(body);
    if (spans.length !== 1) continue;
    const span = spans[0];
    if (span.tokenStart !== 0 || body.slice(span.end).trim() !== "" || snoozeIsStruckLink(body, span)) continue;
    const match = byLink.get(snoozeLinkMapKey(span.target, span.blockId));
    if (match && match.identity) identities.add(match.identity);
  }
  return identities;
}

function snoozePlanStatePrune(source, tasks, clockInput, options) {
  const text = String(source == null ? "" : source);
  const section = snoozeParseSection(text);
  if (!section) return { postimage: text, text, edits: [], removedIdentities: [], detachedSubtrees: [], sectionRemoved: false, states: [] };
  const config = Object.assign({}, clockInput || {}, options || {});
  const today = String(config.today || config.date || "");
  const now = snoozeParseNowMinutes(config.nowMinutes !== undefined ? config.nowMinutes : config.now);
  const { byLink, byIdentity } = snoozeTaskFactsByLink(tasks);
  const liveIdentities = snoozeDayLiveIdentities(text, byLink);
  const rows = section.rows.map((row) => {
    const match = row.kind === "active" ? byLink.get(snoozeLinkMapKey(row.target, row.blockId)) : null;
    const fact = match ? match.task : null;
    return {
      line: row.line,
      minutes: row.minutes,
      history: row.kind === "history",
      malformed: row.kind === "malformed",
      resolution: fact ? "found" : (byLink.has(snoozeLinkMapKey(row.target, row.blockId)) ? "ambiguous" : "missing"),
      route: match && fact ? (fact.route || fact.path) : null,
      block: row.blockId,
      status: fact && typeof fact.status === "string" ? fact.status.slice(0, 1) : null,
      is_task: fact ? fact.is_task !== false : false,
      is_event: fact ? fact.is_event === true : false,
      live_link: fact ? fact.live_link === true || fact.liveLink === true || liveIdentities.has(match.identity) : false,
    };
  });
  const classified = snoozeClassifyRows({
    today,
    note_date: String(config.noteDate || config.note_date || today),
    now_minutes: now,
    zone: String(config.zone || ""),
    rows,
  });
  const removableStates = new Set(["done", "cancelled", "already_linked"]);
  const wanted = new Set(classified.rows
    .filter((row) => row.identity && removableStates.has(row.state))
    .map((row) => row.identity));
  const identityByLink = new Map();
  for (const [key, value] of byLink.entries()) identityByLink.set(key, value ? value.identity : null);
  const removals = [];
  for (const row of section.rows) {
    if (row.kind !== "active") continue;
    const match = byLink.get(snoozeLinkMapKey(row.target, row.blockId));
    const identity = match ? match.identity : null;
    if (!identity || !wanted.has(identity)) continue;
    removals.push({ identity, row, edit: snoozeLineRemovalEdit(section, row) });
  }
  const final = snoozeFinalizeRemoval(text, removals);
  return {
    ...final,
    text: final.postimage,
    ...snoozeRemovalDetails(removals),
    states: classified.rows.map((row) => ({ line: row.line, state: row.state })),
    identityByLink,
    byIdentity,
  };
}

const snoozeModel = Object.freeze({
  parseSection: snoozeParseSection,
  parseWhen: snoozeParseWhen,
  resolveTarget: snoozeResolveTarget,
  classifyRows: snoozeClassifyRows,
  liveTargets: snoozeLiveTargets,
  identityKey: snoozeIdentityKey,
  planStatePrune: snoozePlanStatePrune,
  planRemoveRows: snoozePlanRemoveRows,
});
