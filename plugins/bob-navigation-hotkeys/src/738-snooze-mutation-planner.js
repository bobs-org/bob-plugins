// Pure navigation snooze add/retime/drop planner. It consumes only explicit
// snapshots and callbacks; runtime resolution, clocks, and writes belong to
// the controller phase.

function snoozeMutationBuffer(source) {
  const text = String(source == null ? "" : source);
  const ending = text.includes("\r\n") ? "\r\n" : (text.includes("\r") ? "\r" : "\n");
  const trailing = /(?:\r\n|\r|\n)$/.test(text);
  const lines = text.split(/\r\n|\r|\n/);
  if (trailing) lines.pop();
  return {
    lines,
    ending,
    trailing,
    render() {
      return this.lines.join(this.ending) + (this.trailing ? this.ending : "");
    },
    remove(start, end) {
      if (start >= 0 && end >= start && start < this.lines.length) {
        this.lines.splice(start, Math.min(end, this.lines.length - 1) - start + 1);
      }
    },
  };
}

function snoozeMutationH2Indexes(source) {
  const lines = snoozeLineRecords(source);
  const frontmatterEnd = snoozeFrontmatterEnd(lines);
  const headers = [];
  let fence = null;
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
    if (snoozeLevelTwoHeading(line)) headers.push(index);
  }
  return { lines, headers };
}

function snoozeMutationPomodorosRange(source) {
  const { lines, headers } = snoozeMutationH2Indexes(source);
  const headerLine = headers.find((index) => /^##[ \t]+Pomodoros(?:[ \t].*)?$/.test(lines[index].text.trimEnd()));
  if (headerLine === undefined) return null;
  const next = headers.find((index) => index > headerLine);
  return {
    headerLine,
    startLine: headerLine,
    endLine: next === undefined ? lines.length : next,
    lines,
  };
}

function snoozeMutationPath(value) {
  return String(value == null ? "" : value).trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function snoozeMutationIdentity(value) {
  if (typeof value === "string") {
    const at = value.lastIndexOf("#^");
    if (at <= 0 || !value.slice(at + 2)) return null;
    return { route: snoozeMutationPath(value.slice(0, at)), block: value.slice(at + 2) };
  }
  if (!value || typeof value !== "object") return null;
  const route = snoozeMutationPath(value.route || value.path);
  const block = String(value.block || value.blockId || value.id || "");
  return route && block ? { route, block } : null;
}

function snoozeMutationIdentityKey(identity) {
  const value = snoozeMutationIdentity(identity);
  return value ? value.route + "#^" + value.block : null;
}

function snoozeMutationTaskIdentity(task, input, newBlockId) {
  return snoozeMutationIdentity({
    route: task && (task.route || task.path),
    block: task && (task.block || task.blockId) || newBlockId,
  });
}

function snoozeMutationMapIdentity(target, block, input, task, identity, dailyPath) {
  const query = { target: String(target == null ? "" : target), blockId: String(block || "") };
  if (typeof input.resolveIdentity === "function") {
    try {
      return snoozeMutationIdentity(input.resolveIdentity(query));
    } catch (_) {
      return null;
    }
  }
  const candidates = [];
  const source = input.identities;
  if (source instanceof Map) {
    const found = source.get(query.target + "\u0000" + query.blockId);
    if (found && (found.ambiguous === true || found.resolution === "ambiguous")) return null;
    const mapped = snoozeMutationIdentity(found);
    if (mapped) candidates.push(mapped);
    else if (found === null) return null;
  } else if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || String(item.target == null ? "" : item.target) !== query.target || String(item.block || item.blockId || "") !== query.blockId) continue;
      if (item.ambiguous === true || item.resolution === "ambiguous") return null;
      const mapped = snoozeMutationIdentity(item);
      if (mapped) candidates.push(mapped);
    }
  } else if (source && typeof source === "object") {
    const found = source[query.target + "\u0000" + query.blockId];
    if (found && (found.ambiguous === true || found.resolution === "ambiguous")) return null;
    const mapped = snoozeMutationIdentity(found);
    if (mapped) candidates.push(mapped);
    else if (found === null) return null;
  }
  const unique = new Map(candidates.map((value) => [snoozeMutationIdentityKey(value), value]));
  if (unique.size > 1) return null;
  if (unique.size === 1) return unique.values().next().value;

  const selected = snoozeMutationIdentity(identity);
  if (!selected || query.blockId !== selected.block) return null;
  const canonicalTarget = String(task && task.target == null ? "" : task.target || "");
  const sameTarget = canonicalTarget !== "" && query.target === canonicalTarget;
  const localTarget = query.target === "" && snoozeMutationPath(task && task.path) === snoozeMutationPath(dailyPath);
  return sameTarget || localTarget ? selected : null;
}

function snoozeMutationLinkTarget(task, identity, newBlockId) {
  const block = identity && identity.block || String(newBlockId || "");
  const supplied = String(task && task.link || "");
  const suppliedSpan = snoozeBlockLinkSpans(supplied)[0];
  if (suppliedSpan && suppliedSpan.blockId === block) return supplied;
  const target = String(task && task.target == null ? "" : task.target || "");
  return "[[" + (target ? target : "") + "#^" + block + "]]";
}

function snoozeMutationTaskDisplay(task, contents, lineIndex, identity) {
  if (task && typeof task.displayText === "string" && task.displayText.trim()) return task.displayText.trim();
  const line = String(contents || "").split(/\r\n|\r|\n/)[lineIndex] || "";
  return line
    .replace(/^\s*[-*+]\s+\[[ xX*/?\-]\]\s*/, "")
    .replace(/\[[^\]]+::[^\]]*\]/g, "")
    .replace(/\^[A-Za-z0-9-]+\s*$/, "")
    .replace(/(^|\s)#task(?=\s|$)/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim() || (identity && identity.block) || "Task";
}

function snoozeMutationOpenEntryStatus(line) {
  const item = snoozeMarkdownListItem(line);
  if (!item || item.indent !== 0) return null;
  const match = /^\[([ *\/\?xX-])\](?:[ \t]|$)/.exec(item.body);
  if (!match) return null;
  return [" ", "*", "/", "?"].includes(match[1]) ? match[1] : null;
}

function snoozeMutationSubtreeEnd(lines, parentIndex, sectionEnd, fenced) {
  const parent = snoozeMarkdownListItem(lines[parentIndex].text);
  if (!parent) return parentIndex + 1;
  let end = parentIndex + 1;
  while (end < sectionEnd) {
    if (fenced.has(end)) break;
    const text = lines[end].text;
    if (text.trim() === "") {
      let probe = end + 1;
      while (probe < sectionEnd && lines[probe].text.trim() === "") probe += 1;
      if (probe >= sectionEnd) break;
      const next = snoozeMarkdownListItem(lines[probe].text);
      const nextIndent = next ? next.indent : (lines[probe].text.match(/^[ \t]*/) || [""])[0].length;
      if (nextIndent <= parent.indent) break;
      end += 1;
      continue;
    }
    const item = snoozeMarkdownListItem(text);
    const indent = item ? item.indent : (text.match(/^[ \t]*/) || [""])[0].length;
    if (indent <= parent.indent) break;
    end += 1;
  }
  return end;
}

function snoozeMutationPomodoroHits(source, range, task, identity, input, dailyPath) {
  const lines = range.lines;
  const fenced = snoozeFencedLines(lines, range.startLine, range.endLine);
  const entries = [];
  const hits = [];
  let entry = null;
  for (let index = range.startLine + 1; index < range.endLine; index += 1) {
    if (fenced.has(index)) continue;
    const record = lines[index];
    const item = snoozeMarkdownListItem(record.text);
    if (item && item.indent === 0) {
      if (entry) entries.push(entry);
      entry = snoozeMutationOpenEntryStatus(record.text) === null
        ? null
        : {
          lineIndex: index,
          childIndent: null,
          hadChildren: false,
          timed: /\*\*\d{4}-\d{4}\*\*/.test(record.text),
          hits: [],
        };
      continue;
    }
    if (!entry || !item || item.indent <= 0) continue;
    if (entry.childIndent === null) entry.childIndent = item.indent;
    if (item.indent !== entry.childIndent) continue;
    entry.hadChildren = true;
    let body = item.body;
    if (body.startsWith("🍅")) body = body.slice("🍅".length).trimStart();
    const spans = snoozeBlockLinkSpans(body);
    if (spans.length !== 1) continue;
    const span = spans[0];
    const wholeToken = body.slice(span.tokenStart, span.end);
    const dedicated = body.slice(0, span.tokenStart).trim() === "" && body.slice(span.end).trim() === "" && wholeToken.length > 0;
    if (!dedicated || snoozeIsStruckLink(body, span)) continue;
    const resolved = snoozeMutationMapIdentity(span.target, span.blockId, input, task, identity, dailyPath);
    if (!resolved || snoozeMutationIdentityKey(resolved) !== snoozeMutationIdentityKey(identity)) continue;
    const childEnd = snoozeMutationSubtreeEnd(lines, index, range.endLine, fenced);
    const hit = { lineIndex: index, childEnd, entry, span, record, indent: record.text.slice(0, item.indent), hasNotes: childEnd > index + 1 };
    entry.hits.push(hit);
    hits.push(hit);
  }
  if (entry) entries.push(entry);
  return { hits, entries };
}

function snoozeMutationConsumeLiveLinks(source, range, task, identity, input, dailyPath, hhmm) {
  const { hits, entries } = snoozeMutationPomodoroHits(source, range, task, identity, input, dailyPath);
  const first = hits[0] || null;
  const sourceLines = snoozeLineRecords(source);
  const link = snoozeMutationLinkTarget(task, identity, identity && identity.block);
  let notes = [];
  if (first && first.hasNotes) {
    notes = sourceLines.slice(first.lineIndex + 1, first.childEnd).map((record) => {
      const text = record.text.startsWith(first.indent) ? record.text.slice(first.indent.length) : record.text;
      return text;
    });
  }
  const display = snoozeMutationTaskDisplay(task, task && task.contents, Number(task && task.line || 1) - 1, identity);
  const edits = [];
  for (const hit of hits) {
    const line = sourceLines[hit.lineIndex];
    const last = sourceLines[Math.max(hit.lineIndex, hit.childEnd - 1)] || line;
    const end = last ? last.nextStart : line.nextStart;
    const isFirst = hit === first;
    const preserveDuplicateNotes = !isFirst && hit.hasNotes;
    if (preserveDuplicateNotes) {
      edits.push({ start: line.start, end: line.end, replacement: hit.indent + "- " + display });
    } else {
      edits.push({ start: line.start, end, replacement: "" });
    }
    hit.removed = !preserveDuplicateNotes;
    hit.keptDisplay = preserveDuplicateNotes;
  }
  for (const candidate of entries) {
    if (!candidate.hadChildren || candidate.timed || !candidate.hits.length) continue;
    const removed = new Set();
    for (const hit of candidate.hits) {
      if (!hit.keptDisplay) {
        for (let line = hit.lineIndex; line < hit.childEnd; line += 1) removed.add(line);
      }
    }
    const entryEnd = snoozeChildrenEnd(sourceLines, candidate.lineIndex, range.endLine, snoozeFencedLines(sourceLines, range.startLine, range.endLine));
    let remains = false;
    for (let line = candidate.lineIndex + 1; line < entryEnd; line += 1) {
      if (removed.has(line)) continue;
      const hit = candidate.hits.find((item) => item.lineIndex === line && item.keptDisplay);
      if (hit || (sourceLines[line] && sourceLines[line].text.trim())) {
        remains = true;
        break;
      }
    }
    if (!remains) {
      const entryLine = sourceLines[candidate.lineIndex];
      edits.push({ start: entryLine.start, end: entryLine.nextStart, replacement: "" });
    }
  }
  const after = snoozeMutationApplyEdits(source, edits);
  return { postimage: after, notes, removedCount: hits.length, edits };
}

function snoozeMutationApplyEdits(source, edits) {
  let output = String(source == null ? "" : source);
  const ordered = (Array.isArray(edits) ? edits : []).slice().sort((left, right) => right.start - left.start);
  for (const edit of ordered) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return output;
}

function snoozeMutationInsertSection(source, range, hhmm, link, notes) {
  const buffer = snoozeMutationBuffer(source);
  const insertAt = range.endLine;
  const block = [];
  if (insertAt > 0 && buffer.lines[insertAt - 1] && buffer.lines[insertAt - 1].trim() !== "") block.push("");
  block.push("## Snoozed", "");
  if (insertAt < buffer.lines.length) block.push("");
  buffer.lines.splice(insertAt, 0, ...block);
  buffer.trailing = true;
  const parsed = snoozeParseSection(buffer.render());
  if (!parsed) return source;
  const next = snoozeMutationBuffer(buffer.render());
  const insertLine = parsed.headerLine + 1 + (next.lines[parsed.headerLine + 1] === "" ? 1 : 0);
  next.lines.splice(insertLine, 0, "- **" + hhmm + "** " + link, ...notes);
  next.trailing = true;
  return next.render();
}

function snoozeMutationUpsertRow(source, task, identity, hhmm, notes, input, dailyPath) {
  let current = String(source == null ? "" : source);
  let section = snoozeParseSection(current);
  if (!section) {
    const range = snoozeMutationPomodorosRange(current);
    if (!range) return { ok: false, refusal: "no_pomodoros", postimage: current };
    current = snoozeMutationInsertSection(current, range, hhmm, snoozeMutationLinkTarget(task, identity, identity.block), notes);
    return { ok: true, postimage: current };
  }
  const identityKey = snoozeMutationIdentityKey(identity);
  const rowMatches = (row) => {
    const resolved = snoozeMutationMapIdentity(row.target, row.blockId, input, task, identity, dailyPath);
    return resolved && snoozeMutationIdentityKey(resolved) === identityKey;
  };
  const matchingActive = section.rows.filter((row) => row.kind === "active" && rowMatches(row));
  const matchingHistory = section.rows.slice().reverse().find((row) => row.kind === "history" && rowMatches(row));
  // Re-snoozing a woken task replaces the last matching struck history row
  // and its subtree. Do not carry those children as notes. Active matches
  // are retimed and existing history stays.
  let carried = Array.isArray(notes) ? notes.slice() : [];
  if (!carried.length) {
    for (const row of matchingActive) {
      carried.push(...section.lines.slice(row.lineIndex + 1, row.childrenEnd).map((line) => line.text));
    }
  }
  const buffer = snoozeMutationBuffer(current);
  if (!matchingActive.length) {
    if (matchingHistory) {
      buffer.remove(matchingHistory.lineIndex, Math.max(matchingHistory.lineIndex, matchingHistory.childrenEnd - 1));
    }
  } else {
    const removed = matchingActive.slice().sort((left, right) => right.lineIndex - left.lineIndex);
    for (const row of removed) buffer.remove(row.lineIndex, Math.max(row.lineIndex, row.childrenEnd - 1));
  }
  const afterRemoval = buffer.render();
  const updated = snoozeParseSection(afterRemoval);
  if (!updated) return { ok: false, refusal: "no_pomodoros", postimage: current };
  const targetLink = snoozeMutationLinkTarget(task, identity, identity.block);
  const sortKey = (row) => [Number.isInteger(row.minutes) ? row.minutes : Number.MAX_SAFE_INTEGER, row.target ? "[[" + row.target + "#^" + row.blockId + "]]" : "[[#^" + row.blockId + "]]"];
  let insertAt = updated.headerLine + 1;
  const active = updated.rows.filter((row) => row.kind === "active");
  if (active.length) {
    const targetMinutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
    const firstGreater = active.find((row) => {
      const key = sortKey(row);
      return key[0] > targetMinutes || (key[0] === targetMinutes && key[1] > targetLink);
    });
    if (firstGreater) insertAt = firstGreater.lineIndex;
    else insertAt = active[active.length - 1].childrenEnd;
  } else if (buffer.lines[insertAt] === "") {
    insertAt += 1;
  }
  const finalBuffer = snoozeMutationBuffer(afterRemoval);
  finalBuffer.lines.splice(insertAt, 0, "- **" + hhmm + "** " + targetLink, ...carried);
  finalBuffer.trailing = true;
  return { ok: true, postimage: finalBuffer.render() };
}

function snoozeMutationDropRows(source, task, identity, input, dailyPath) {
  const current = String(source == null ? "" : source);
  const section = snoozeParseSection(current);
  if (!section) return { ok: false, refusal: "not_snoozed", postimage: current };
  const identityKey = snoozeMutationIdentityKey(identity);
  const matching = section.rows.filter((row) => {
    if (row.kind !== "active") return false;
    const resolved = snoozeMutationMapIdentity(row.target, row.blockId, input, task, identity, dailyPath);
    return resolved && snoozeMutationIdentityKey(resolved) === identityKey;
  });
  if (!matching.length) return { ok: false, refusal: "not_snoozed", postimage: current };
  const buffer = snoozeMutationBuffer(current);
  for (const row of matching.slice().sort((left, right) => right.lineIndex - left.lineIndex)) {
    buffer.remove(row.lineIndex, Math.max(row.lineIndex, row.childrenEnd - 1));
  }
  const afterRows = buffer.render();
  const remaining = snoozeParseSection(afterRows);
  if (remaining && !remaining.rows.length) {
    const hasProse = remaining.lines.slice(remaining.contentStart, remaining.contentEnd).some((line) => line.text.trim() !== "");
    if (!hasProse) {
      const empty = snoozeMutationBuffer(afterRows);
      let end = remaining.contentEnd - 1;
      if (remaining.contentStart >= remaining.contentEnd) end = remaining.headerLine;
      const atEof = remaining.contentEnd === remaining.lines.length;
      empty.remove(remaining.headerLine, Math.max(remaining.headerLine, end));
      if (atEof) {
        while (empty.lines.length && empty.lines[empty.lines.length - 1].trim() === "") empty.lines.pop();
        empty.trailing = true;
      }
      return { ok: true, postimage: empty.render(), removed: matching.length };
    }
  }
  return { ok: true, postimage: afterRows, removed: matching.length };
}

function snoozeMutationRefusal(input, task) {
  if (!task || task.is_task === false) return "not_task";
  if (task.is_event === true) return "event_task";
  const status = String(task.status == null ? "" : task.status).slice(0, 1);
  if (task.blocked === true || status === "?") return "blocked";
  if (status === "x" || status === "X") return "done";
  if (status === "-") return "cancelled";
  if (![" ", "*", "/"].includes(status)) return "not_task";
  return null;
}

function snoozeMutationPlan(input) {
  const request = input && typeof input === "object" ? input : {};
  const action = request.action || request.mode;
  const day = String(request.day == null ? "" : request.day);
  const task = request.task && typeof request.task === "object" ? request.task : {};
  const dailyPath = snoozeMutationPath(request.dailyPath || request.dayPath || (task.target === "" ? task.path : "daily.md")) || "daily.md";
  const taskPath = snoozeMutationPath(task.path || task.route);
  const newBlockId = String(request.newBlockId || task.newBlockId || "");
  const identity = snoozeMutationTaskIdentity(task, request, newBlockId);
  const refusal = (reason) => ({ ok: false, refusal: reason, plans: [], operation: { action, identity: snoozeMutationIdentityKey(identity) } });
  if (action !== "add" && action !== "drop") return refusal("invalid_action");
  if (!identity) return refusal("ambiguous_target");

  if (action === "drop") {
    const dropped = snoozeMutationDropRows(day, task, identity, request, dailyPath);
    if (!dropped.ok) return refusal(dropped.refusal);
    return {
      ok: true,
      refusal: null,
      plans: [{ path: dailyPath, preimage: day, postimage: dropped.postimage }],
      task_unchanged: true,
      operation: { action, identity: snoozeMutationIdentityKey(identity), removed: dropped.removed },
    };
  }

  const targetRefusal = snoozeMutationRefusal(request, task);
  if (targetRefusal) return refusal(targetRefusal);
  const clock = request.clock && typeof request.clock === "object" ? request.clock : {
    date: request.date,
    now: request.now,
    zone: request.zone,
  };
  const range = snoozeMutationPomodorosRange(day);
  if (!range) return refusal("no_pomodoros");
  const resolved = snoozeParseWhen(request.when, clock);
  if (!resolved.ok) return refusal(resolved.refusal);
  const hhmm = resolved.value.hhmm;
  const lineIndex = Number(task.line) - 1;
  const taskPreimage = taskPath === dailyPath ? day : String(task.contents == null ? "" : task.contents);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= taskPreimage.split(/\r\n|\r|\n/).length) return refusal("not_task");
  let taskPostimage = taskPreimage;
  let taskPlan = null;
  let taskUnchanged = true;
  if (String(task.status).slice(0, 1) === " ") {
    if (typeof request.planTargetTaskUpdate !== "function") return refusal("planning_unavailable");
    try {
      taskPlan = request.planTargetTaskUpdate(taskPreimage, lineIndex, {
        forceNext: true,
        freshDateText: request.freshDateText || clock.freshDateText,
        stampLine: request.stampLine,
        now: request.nowInstant || clock.nowInstant || clock.nowDate,
        newBlockId: newBlockId || undefined,
      });
    } catch (_) {
      taskPlan = null;
    }
    if (!taskPlan || typeof taskPlan.content !== "string") return refusal("not_task");
    taskPostimage = taskPlan.content;
    taskUnchanged = taskPostimage === taskPreimage;
  }
  const dayBase = taskPath === dailyPath ? taskPostimage : day;
  const live = snoozeMutationConsumeLiveLinks(dayBase, snoozeMutationPomodorosRange(dayBase), task, identity, request, dailyPath, hhmm);
  const upserted = snoozeMutationUpsertRow(live.postimage, task, identity, hhmm, live.notes, request, dailyPath);
  if (!upserted.ok) return refusal(upserted.refusal);
  const plans = [{ path: dailyPath, preimage: day, postimage: upserted.postimage }];
  if (taskPath && taskPath !== dailyPath) plans.push({ path: taskPath, preimage: taskPreimage, postimage: taskPostimage });
  return {
    ok: true,
    refusal: null,
    plans,
    task_unchanged: taskUnchanged,
    operation: { action, identity: snoozeMutationIdentityKey(identity), hhmm, instant: resolved.value.rfc3339, removedLiveLinks: live.removedCount },
  };
}

const snoozeMutationPlanner = Object.freeze({ plan: snoozeMutationPlan });
