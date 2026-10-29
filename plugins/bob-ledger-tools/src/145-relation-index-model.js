// Raw-text parser and immutable-map builders for the live task relation index.
// Keep the accepted shapes in step with bob-cli's LK vectors in
// `src/native/task_relations/parse.rs`.
//
// Text mentions (§19, MN vectors in `tests/fixtures/task_mentions/vectors.json`):
// the mention scanner below implements M1–M6 plus display/site/excerpt, and
// the LINKED FROM parser returns typed `{kind: "relation" | "mention"}` rows.
// `incoming()`/`outgoing()` stay relations-only; typed rows surface through
// `linkedFrom()` v2 in `171-relation-index-lifecycle.js`.
const RELATION_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const RELATION_LABEL_FORBIDDEN_RE = /[\[\]()"\\|•*~]/u;
const MENTION_LABEL = "💬 mentions";
const MENTION_RESERVED_CODEPOINT = 0x1F4AC;

function mentionIsReservedLabelStart(label) {
  const text = String(label || "");
  if (!text) return false;
  return text.codePointAt(0) === MENTION_RESERVED_CODEPOINT;
}

function mentionCollapsedIsMentionLabel(label) {
  return relationCollapseLabel(label) === MENTION_LABEL;
}

function relationInlineCodeRanges(text) {
  const ranges = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    const start = index;
    while (text[index] === "`") index += 1;
    const width = index - start;
    let search = index;
    let close = -1;
    while (search < text.length) {
      if (text[search] !== "`") {
        search += 1;
        continue;
      }
      const runStart = search;
      while (text[search] === "`") search += 1;
      if (search - runStart === width) {
        close = search;
        break;
      }
    }
    if (close >= 0) {
      ranges.push({ start, end: close });
      index = close;
    }
  }
  return ranges;
}

function relationWikilinkSpans(text) {
  const code = relationInlineCodeRanges(text);
  const spans = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("[[", cursor);
    if (open < 0) break;
    const close = text.indexOf("]]", open + 2);
    if (close < 0) break;
    const end = close + 2;
    cursor = end;
    if (code.some((span) => open < span.end && end > span.start)) continue;
    const inside = text.slice(open + 2, close);
    const linkTarget = inside.split("|")[0];
    const fragment = linkTarget.indexOf("#^");
    if (fragment < 0) continue;
    const target = linkTarget.slice(0, fragment).trim();
    const blockId = linkTarget.slice(fragment + 2).trim();
    if (!RELATION_BLOCK_ID_RE.test(blockId)) continue;
    const embedded = open > 0 && text[open - 1] === "!";
    const tokenStart = embedded ? open - 1 : open;
    const struck = text.slice(Math.max(0, tokenStart - 2), tokenStart) === "~~" &&
      text.slice(end, end + 2) === "~~";
    spans.push({
      target,
      blockId,
      open,
      end,
      fullStart: struck ? tokenStart - 2 : tokenStart,
      fullEnd: struck ? end + 2 : end,
      embedded,
      struck,
      aliased: inside.includes("|"),
      alias: inside.includes("|") ? inside.split("|").slice(1).join("|") : null,
    });
  }
  return spans;
}

function relationParseHeader(line) {
  const match = String(line || "").match(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(?:(🪢|🔗)[ \t]+)?\*\*(LINKS(?: TO)?|LINKED FROM|BACKLINKS)(:?)\*\*:?(.*)$/u,
  );
  if (!match) return null;
  const rest = match[5] || "";
  if (rest && !/^[ \t]/u.test(rest)) return { malformed: true };
  const kind = match[3] === "LINKS" || match[3] === "LINKS TO" ? "links" : "linkedFrom";
  const bodyStart = line.length - rest.length;
  return {
    kind,
    bodyStart,
    canonical: match[2] === "🪢" && match[3] === (kind === "links" ? "LINKS" : "LINKED FROM") && match[4] === ":",
  };
}

function relationCollapseLabel(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).join(" ").replace(/:$/u, "").trim();
}

function relationParseLabel(value) {
  const label = relationCollapseLabel(value);
  if (!label) return { ok: true, label: null };
  if (label.startsWith("·") || label.startsWith(",") || RELATION_LABEL_FORBIDDEN_RE.test(label) || /[\u0000-\u001f\u007f]/u.test(label)) {
    return { ok: false, label: null };
  }
  return { ok: true, label };
}

function relationSkipOneSeparator(value) {
  let rest = String(value || "").trimStart();
  if (["•", "·", ","].includes(rest[0])) rest = rest.slice(1);
  return rest.trimStart();
}

function relationSeparatorResidue(value) {
  return /^[\s•·,]*$/u.test(String(value || ""));
}

function relationHasOrphanBrackets(line, start, spans) {
  let residue = "";
  let cursor = start;
  for (const span of spans) {
    residue += line.slice(cursor, span.fullStart);
    cursor = Math.max(cursor, span.fullEnd);
  }
  residue += line.slice(cursor);
  return residue.includes("[[") || residue.includes("]]" );
}

function parseTaskRelationLine(line) {
  const text = String(line || "");
  const header = relationParseHeader(text);
  if (!header) return { verdict: "not-a-line", entries: [] };
  if (header.malformed) return { verdict: "malformed", entries: [] };
  const spans = relationWikilinkSpans(text).filter((span) => span.fullStart >= header.bodyStart);
  if (relationHasOrphanBrackets(text, header.bodyStart, spans)) {
    return { verdict: "malformed", kind: header.kind, entries: [] };
  }
  const body = text.slice(header.bodyStart);
  if (!spans.length) {
    return body.trim() ? { verdict: "malformed", kind: header.kind, entries: [] } :
      { verdict: "empty", kind: header.kind, canonical: header.canonical, entries: [] };
  }

  const entries = [];
  if (header.kind === "links") {
    let previousEnd = header.bodyStart;
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      const gap = text.slice(previousEnd, span.fullStart);
      const labelResult = relationParseLabel(index === 0 ? gap : relationSkipOneSeparator(gap));
      if (!labelResult.ok) return { verdict: "malformed", kind: header.kind, entries: [] };
      let label = labelResult.label;
      if (!label && span.alias) {
        const aliasResult = relationParseLabel(span.alias);
        if (!aliasResult.ok) return { verdict: "malformed", kind: header.kind, entries: [] };
        label = aliasResult.label;
      }
      // §19: 💬-first labels are reserved; on LINKS any such label is malformed (MN15).
      if (label && mentionIsReservedLabelStart(label)) {
        return { verdict: "malformed", kind: header.kind, entries: [] };
      }
      entries.push({
        target: span.target,
        blockId: span.blockId,
        label,
        kind: "relation",
        embedded: span.embedded,
        struck: span.struck,
        aliased: span.aliased,
      });
      previousEnd = span.fullEnd;
    }
    if (!relationSeparatorResidue(text.slice(previousEnd))) {
      return { verdict: "malformed", kind: header.kind, entries: [] };
    }
  } else {
    if (text.slice(header.bodyStart, spans[0].fullStart).trim()) {
      return { verdict: "malformed", kind: header.kind, entries: [] };
    }
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      const isLast = index + 1 === spans.length;
      let gap = text.slice(span.fullEnd, isLast ? text.length : spans[index + 1].fullStart).trimStart();
      let label = null;
      if (gap.startsWith("(")) {
        const close = gap.indexOf(")");
        if (close < 0 || gap.slice(1, close).includes("(")) {
          return { verdict: "malformed", kind: header.kind, entries: [] };
        }
        const labelResult = relationParseLabel(gap.slice(1, close));
        if (!labelResult.ok || !labelResult.label) {
          return { verdict: "malformed", kind: header.kind, entries: [] };
        }
        label = labelResult.label;
        gap = gap.slice(close + 1).trimStart();
      }
      if (!isLast) {
        gap = relationSkipOneSeparator(gap);
        if (gap.trim()) return { verdict: "malformed", kind: header.kind, entries: [] };
      } else if (!relationSeparatorResidue(gap)) {
        return { verdict: "malformed", kind: header.kind, entries: [] };
      }
      if (!label && span.alias) {
        const aliasResult = relationParseLabel(span.alias);
        if (!aliasResult.ok) return { verdict: "malformed", kind: header.kind, entries: [] };
        label = aliasResult.label;
      }
      // §19: on LINKED FROM exactly `💬 mentions` is a typed mention entry;
      // any other 💬-first label is malformed (MN15, MN16).
      let kind = "relation";
      if (label && mentionIsReservedLabelStart(label)) {
        if (!mentionCollapsedIsMentionLabel(label)) {
          return { verdict: "malformed", kind: header.kind, entries: [] };
        }
        kind = "mention";
      }
      entries.push({
        target: span.target,
        blockId: span.blockId,
        label,
        kind,
        embedded: span.embedded,
        struck: span.struck,
        aliased: span.aliased,
      });
    }
  }
  return { verdict: "accepted", kind: header.kind, canonical: header.canonical, entries };
}

function relationIndent(line) {
  const prefix = String(line || "").match(/^[ \t]*/u)[0];
  return Array.from(prefix).reduce((width, char) => width + (char === "\t" ? 4 : 1), 0);
}

function relationListMarker(line) {
  return /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u.test(String(line || ""));
}

function relationTaskStatusWord(symbol) {
  if (symbol === "x" || symbol === "X") return "DONE";
  if (symbol === "/") return "IN_PROGRESS";
  if (symbol === "-") return "CANCELLED";
  if (symbol === "*") return "NEXT";
  if (symbol === "?") return "BLOCKED";
  return "TODO";
}

function relationTaskInfo(line, lineNumber) {
  const text = String(line || "");
  if (!dependencyChipIsTaskLine(text)) return null;
  const match = text.match(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/u);
  if (match && !RELATION_BLOCK_ID_RE.test(match[1])) return null;
  const statusMatch = text.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([^\]\n])\]/u);
  const symbol = statusMatch ? statusMatch[1] : " ";
  return {
    blockId: match ? match[1] : "",
    line: lineNumber + 1,
    text,
    status: relationTaskStatusWord(symbol),
  };
}

function relationFenceMarks(lines) {
  const fenced = new Set();
  let marker = null;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(`{3,}|~{3,})/u);
    if (!marker && match) marker = match[1][0];
    else if (marker && match && match[1][0] === marker) marker = null;
    if (marker || match) fenced.add(index);
  }
  return fenced;
}

// §19 M2: Sub-projects lines are edge lines (any verdict except not-a-line
// counts, so malformed rows stay out too). Mirrors Rust `is_subprojects_line`.
function mentionIsSubprojectsLine(line) {
  const text = String(line || "");
  if (!relationListMarker(text)) return false;
  const indent = String(text.match(/^[ \t]*/u)[0]).length;
  let rest = text.slice(indent);
  rest = rest.replace(/^(?:[-*+]|\d+[.)])[ \t]+/u, "");
  rest = rest.replace(/^🧩[ \t]*/u, "");
  return rest.includes("**Sub-projects:**") || rest.includes("**Sub-projects**");
}

// §19 M2: whether a line is a managed edge child (Depends-On, BLOCKS,
// Sub-projects, LINKS, or LINKED FROM). Every verdict except not-a-line
// counts, so malformed rows are excluded from mentions too.
function mentionIsEdgeLine(line) {
  const text = String(line || "");
  try {
    const relation = parseTaskRelationLine(text);
    if (relation && relation.verdict && relation.verdict !== "not-a-line") return true;
  } catch (error) { /* fall through */ }
  try {
    if (typeof parseDependencyLine === "function") {
      const dependency = parseDependencyLine(text, {});
      if (dependency && dependency.verdict && dependency.verdict !== "not-a-line") return true;
    }
  } catch (error) { /* fall through */ }
  try {
    if (typeof parseBlocksLine === "function") {
      const blocks = parseBlocksLine(text, {});
      if (blocks && blocks.verdict && blocks.verdict !== "not-a-line") return true;
    }
  } catch (error) { /* fall through */ }
  if (mentionIsSubprojectsLine(text)) return true;
  return false;
}

// §19 sites: log markers that own a mention occurrence.
function mentionLogKindForLine(line) {
  const text = String(line || "");
  if (!relationListMarker(text)) return null;
  if (text.includes("CANCEL LOG")) return "cancel_log";
  if (text.includes("SCHEDULE LOG") || text.includes("Schedule log")) return "schedule_log";
  if (text.includes("WORK LOG") || text.includes("Work log")) return "work_log";
  if (text.includes("ROTTEN LOG") || text.includes("Rotten log")) return "rotten_log";
  return null;
}

function mentionLogSite(kind) {
  if (kind === "cancel_log") return "cancel_log";
  if (kind === "schedule_log") return "schedule_log";
  if (kind === "work_log") return "work_log";
  if (kind === "rotten_log") return "rotten_log";
  return "note";
}

// §19 M3: `%%…%%` comment ranges over the whole note (inline and multi-line).
// Unpaired trailing `%%` runs to the end of the note.
function mentionPercentRanges(content) {
  const text = String(content || "");
  const marks = [];
  let cursor = 0;
  while (true) {
    const at = text.indexOf("%%", cursor);
    if (at < 0) break;
    marks.push(at);
    cursor = at + 2;
  }
  const ranges = [];
  for (let index = 0; index + 1 < marks.length; index += 2) {
    ranges.push({ start: marks[index], end: marks[index + 1] + 2 });
  }
  if (marks.length % 2 === 1) {
    ranges.push({ start: marks[marks.length - 1], end: text.length });
  }
  return ranges;
}

function mentionLineStarts(content, lines) {
  const text = String(content || "");
  const starts = [0];
  let position = 0;
  for (let index = 0; index < lines.length; index += 1) {
    position += String(lines[index]).length;
    if (position >= text.length) {
      starts.push(text.length);
      continue;
    }
    if (text.startsWith("\r\n", position)) position += 2;
    else if (text[position] === "\n" || text[position] === "\r") position += 1;
    starts.push(position);
  }
  return starts;
}

// §19 M3: blockquoted lines never carry mentions.
function mentionIsBlockquoted(line) {
  const text = String(line || "");
  if (/^[ \t]*>/u.test(text)) return true;
  return /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+>/u.test(text);
}

// §19 M3: inline Dataview field values (`[key:: …]` / `(key:: …)`).
// A link inside an enclosing bracket pair whose text holds `::` is skipped.
function mentionInDataviewField(line, open, end) {
  const text = String(line || "");
  const encloses = (left, right) => {
    let depth = 0;
    for (let index = 0; index < open; index += 1) {
      if (text[index] === left) depth += 1;
      else if (text[index] === right) depth -= 1;
    }
    if (depth <= 0) return false;
    let inner = depth;
    for (let index = end; index < text.length; index += 1) {
      if (text[index] === left) inner += 1;
      else if (text[index] === right) {
        inner -= 1;
        if (inner === 0) {
          let start = -1;
          let level = 0;
          for (let back = open - 1; back >= 0; back -= 1) {
            if (text[back] === right) level += 1;
            else if (text[back] === left) {
              if (level === 0) { start = back; break; }
              level -= 1;
            }
          }
          if (start < 0) return false;
          return text.slice(start, index + 1).includes("::");
        }
      }
    }
    return false;
  };
  return encloses("[", "]") || encloses("(", ")");
}

// §19 M1: nearest `#task` ancestor (the task's own line counts; a nested
// `#task` owns its own subtree). Returns `{task, line}` or null.
function mentionOwnerForLine(lines, taskAtLine, fenced, lineIndex) {
  if (taskAtLine.has(lineIndex)) {
    return { task: taskAtLine.get(lineIndex), line: lineIndex };
  }
  let currentIndent = relationIndent(lines[lineIndex]);
  for (let previous = lineIndex - 1; previous >= 0; previous -= 1) {
    if (fenced.has(previous)) continue;
    if (!relationListMarker(lines[previous])) continue;
    const indent = relationIndent(lines[previous]);
    if (indent >= currentIndent) continue;
    if (taskAtLine.has(previous)) {
      return { task: taskAtLine.get(previous), line: previous };
    }
    currentIndent = indent;
  }
  return null;
}

// §19 M6: a task whose description is exactly one embed is never a source.
function mentionTaskIsProxy(taskText) {
  let rest = String(taskText || "").replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u, "");
  rest = rest.replace(/^\[[^\]\n]\][ \t]+/u, "");
  rest = rest.replace(/#[^\s\]\)]+/gu, " ");
  rest = rest.replace(/\[[^\]\n]*::[^\]\n]*\]/gu, " ");
  rest = rest.replace(/\([^\)\n]*::[^\)\n]*\)/gu, " ");
  rest = rest.replace(/(?:^|\s)\^[A-Za-z0-9-]+(?=\s|$)/gu, " ");
  rest = rest.trim().replace(/\s+/u, " ");
  return /^!\[\[[^\n\]]+(?:\|[^\n\]]+)?\]\]$/u.test(rest);
}

function mentionSourceKey(path, task, idCounts) {
  const note = String(path || "");
  const blockId = task && task.blockId ? String(task.blockId) : "";
  if (blockId && idCounts && idCounts.get(blockId) === 1) {
    return `${note}#^${blockId}`;
  }
  return `${note}:${task && task.line ? task.line : 1}`;
}

function mentionDisplayToken(span) {
  if (span && span.aliased && span.alias != null) return String(span.alias);
  return "this task";
}

function parseTaskRelationFile(content, path) {
  const lines = String(content || "").split(/\r?\n/u);
  const fenced = relationFenceMarks(lines);
  const tasks = new Map();
  const taskAtLine = new Map();
  const taskIdCounts = new Map();
  const allTasks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const task = relationTaskInfo(lines[index], index);
    if (!task) continue;
    const row = { ...task, path: String(path || "") };
    allTasks.push({ row, line: index });
    if (row.blockId) taskIdCounts.set(row.blockId, (taskIdCounts.get(row.blockId) || 0) + 1);
    taskAtLine.set(index, row);
  }
  for (const { row } of allTasks) {
    if (row.blockId) tasks.set(row.blockId, row);
  }
  const outgoing = [];
  const dependsOn = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const parsed = parseTaskRelationLine(lines[index]);
    if (parsed.verdict !== "accepted" || parsed.kind !== "links") {
      // Accepted Depends-On lines still feed M7 even when the line is not LINKS.
      try {
        if (typeof parseDependencyLine === "function") {
          const dependency = parseDependencyLine(lines[index], {});
          if (dependency && dependency.verdict === "accept" && Array.isArray(dependency.targets)) {
            const childIndent = relationIndent(lines[index]);
            let parentTask = null;
            for (let previous = index - 1; previous >= 0; previous -= 1) {
              if (fenced.has(previous) || !relationListMarker(lines[previous])) continue;
              if (relationIndent(lines[previous]) < childIndent) {
                parentTask = taskAtLine.get(previous) || null;
                break;
              }
            }
            if (parentTask) {
              for (const target of dependency.targets) {
                dependsOn.push({
                  source: parentTask,
                  sourceKey: mentionSourceKey(path, parentTask, taskIdCounts),
                  targetRef: { path: target.linkpath || "", blockId: target.blockId || "" },
                  line: index + 1,
                });
              }
            }
          }
        }
      } catch (error) { /* M7 input stays best-effort */ }
      continue;
    }
    const childIndent = relationIndent(lines[index]);
    let parentTask = null;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (fenced.has(previous) || !relationListMarker(lines[previous])) continue;
      if (relationIndent(lines[previous]) < childIndent) {
        parentTask = taskAtLine.get(previous) || null;
        break;
      }
    }
    if (!parentTask) continue;
    for (const entry of parsed.entries) {
      outgoing.push({
        source: parentTask,
        sourceKey: mentionSourceKey(path, parentTask, taskIdCounts),
        targetRef: { path: entry.target, blockId: entry.blockId },
        label: entry.label,
        kind: entry.kind || "relation",
        relationLine: index + 1,
        raw: lines[index],
        embedded: entry.embedded,
        struck: entry.struck,
      });
    }
    // LINKS lines do not also carry Depends-On targets; handled above.
  }
  // Accepted Depends-On lines that share a line with LINKS are impossible
  // (one line has one verdict), so the loop above covers every Depends-On row.
  const mentionOccurrences = [];
  const percentRanges = mentionPercentRanges(content);
  const lineStarts = mentionLineStarts(content, lines);
  const listMarkerLength = (line) => {
    const match = String(line || "").match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u);
    return match ? match[0].length : 0;
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const line = lines[index];
    if (mentionIsBlockquoted(line)) continue;
    const spans = relationWikilinkSpans(line);
    if (!spans.length) continue;
    const absoluteOpen = (span) => lineStarts[index] + span.open;
    const inPercent = (span) => percentRanges.some((range) => absoluteOpen(span) >= range.start && absoluteOpen(span) < range.end);
    // Sole-link detection (M5 display, excerpt rule): after the marker,
    // checkbox, and every full token, no letter or digit remains.
    const markerLength = listMarkerLength(line);
    let stripped = line.slice(markerLength).replace(/^\[[^\]\n]\][ \t]+/u, "");
    for (const span of spans) {
      stripped = stripped.split(line.slice(span.fullStart, span.fullEnd)).join(" ");
    }
    const sole = !/[\p{L}\p{N}]/u.test(stripped);
    for (const span of spans) {
      if (inPercent(span)) continue;
      if (mentionInDataviewField(line, span.open, span.end)) continue;
      const owner = mentionOwnerForLine(lines, taskAtLine, fenced, index);
      if (!owner) continue;
      // M6: proxy tasks are never sources.
      if (mentionTaskIsProxy(owner.task.text)) continue;
      // M2: on, or anywhere under, an edge line.
      if (mentionIsEdgeLine(line)) continue;
      let underEdge = false;
      let siteKind = null;
      let currentIndent = relationIndent(line);
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (fenced.has(previous)) continue;
        if (!relationListMarker(lines[previous])) continue;
        const indent = relationIndent(lines[previous]);
        if (indent >= currentIndent) continue;
        if (previous <= owner.line) break;
        if (mentionIsEdgeLine(lines[previous])) { underEdge = true; break; }
        if (!siteKind) siteKind = mentionLogKindForLine(lines[previous]);
        currentIndent = indent;
      }
      if (underEdge) continue;
      const isTitle = index === owner.line;
      let site = "note";
      if (isTitle) site = "title";
      else if (siteKind) site = mentionLogSite(siteKind);
      else {
        const directLog = mentionLogKindForLine(line);
        if (directLog) site = mentionLogSite(directLog);
      }
      const tokenStart = span.embedded ? span.open - 1 : span.open;
      const isEmbedLike = Boolean(span.embedded || (span.struck && sole));
      let excerpt = null;
      if (site !== "title" && !sole && !span.embedded) {
        const withoutMarker = line.slice(markerLength).replace(/^\[[^\]\n]\][ \t]+/u, "");
        const spansForExcerpt = relationWikilinkSpans(withoutMarker);
        // Map back to the original span by document order among identical targets.
        const sameTarget = spansForExcerpt.filter((candidate) =>
          candidate.target === span.target && candidate.blockId === span.blockId);
        const excerptSpan = sameTarget.length === 1 ? sameTarget[0] :
          spansForExcerpt[spans.indexOf(span)] || spansForExcerpt[0];
        if (excerptSpan) {
          let built = "";
          let cursor = 0;
          for (const candidate of spansForExcerpt) {
            built += withoutMarker.slice(cursor, candidate.fullStart);
            if (candidate === excerptSpan) built += `⟦${mentionDisplayToken(span)}⟧`;
            else built += mentionDisplayToken(candidate);
            cursor = candidate.fullEnd;
          }
          built += withoutMarker.slice(cursor);
          excerpt = built.trim();
          if (!excerpt) excerpt = null;
        }
      }
      mentionOccurrences.push({
        source: owner.task,
        sourceKey: mentionSourceKey(path, owner.task, taskIdCounts),
        targetRef: { path: span.target, blockId: span.blockId },
        line: index + 1,
        ch: tokenStart,
        embedded: Boolean(span.embedded),
        struck: Boolean(span.struck),
        sole,
        isEmbed: isEmbedLike,
        site,
        excerpt,
        alias: span.aliased ? span.alias : null,
        displayToken: mentionDisplayToken(span),
      });
    }
  }
  return { path: String(path || ""), content: String(content || ""), lines, tasks, taskIdCounts, outgoing, dependsOn, mentionOccurrences };
}

function relationIdentity(path, blockId) {
  return String(path || "") + "\u0000" + String(blockId || "");
}

function relationTaskLineIdentity(path, line) {
  return String(path || "") + "\u0000line:" + String(line || "").trim();
}

function relationTaskLineNumberIdentity(path, lineNumber) {
  return String(path || "") + "\u0000line-number:" + String(lineNumber || "");
}

function relationCodepointCompare(left, right) {
  const a = Array.from(String(left), (char) => char.codePointAt(0));
  const b = Array.from(String(right), (char) => char.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function relationLabelSuggestionRows(edges, prefix) {
  return relationLabelRankRows(
    relationLabelCatalogRows(edges, {}),
    prefix,
    "exclude",
  ).map((row) => ({ label: row.name, count: row.count }));
}
