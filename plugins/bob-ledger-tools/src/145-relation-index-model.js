// Raw-text parser and immutable-map builders for the live task relation index.
// Keep the accepted shapes in step with bob-cli's LK vectors in
// `src/native/task_relations/parse.rs`.
const RELATION_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const RELATION_LABEL_FORBIDDEN_RE = /[\[\]()"\\|•*~]/u;

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
      entries.push({
        target: span.target,
        blockId: span.blockId,
        label,
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
      entries.push({
        target: span.target,
        blockId: span.blockId,
        label,
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

function parseTaskRelationFile(content, path) {
  const lines = String(content || "").split(/\r?\n/u);
  const fenced = relationFenceMarks(lines);
  const tasks = new Map();
  const taskAtLine = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const task = relationTaskInfo(lines[index], index);
    if (!task) continue;
    const row = { ...task, path: String(path || "") };
    if (row.blockId) tasks.set(row.blockId, row);
    taskAtLine.set(index, row);
  }
  const outgoing = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const parsed = parseTaskRelationLine(lines[index]);
    if (parsed.verdict !== "accepted" || parsed.kind !== "links") continue;
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
        targetRef: { path: entry.target, blockId: entry.blockId },
        label: entry.label,
        relationLine: index + 1,
        raw: lines[index],
        embedded: entry.embedded,
        struck: entry.struck,
      });
    }
  }
  return { path: String(path || ""), content: String(content || ""), lines, tasks, outgoing };
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

// Pair key for one unordered task pair {owner, other}. Both ends are
// `path + "\0" + blockId`; the two identities sort so either end
// computes the same key (docs/task-relations.md §5).
function relationPairKey(ownerPath, ownerBlockId, otherPath, otherBlockId) {
  const left = String(ownerPath || "") + "\u0000" + String(ownerBlockId || "");
  const right = String(otherPath || "") + "\u0000" + String(otherBlockId || "");
  return relationCodepointCompare(left, right) <= 0 ? left + "\u0001" + right : right + "\u0001" + left;
}

function relationRelatedOtherIdentity(edge, side) {
  try {
    const other = edge && edge.other && typeof edge.other === "object" ? edge.other : null;
    return { path: String((other && other.path) || ""), blockId: String((other && other.blockId) || "") };
  } catch (error) {
    return { path: "", blockId: "" };
  }
}

// Additive per-task pair view shared by `api.relationIndex.related()` and
// the per-task links block. `outgoing` are this task's authored edges,
// `incoming` the edges other tasks author naming this task; each entry is
// `{ label, other: { path, blockId, ... } }`. Returns
// `{ plain, outgoing, incoming }` where plain holds one entry per plainly
// related task (deduped by pair, `storedOn: "this" | "other" | "both"`),
// outgoing/incoming hold the labelled statements, and redundant plain
// records (a pair that also has a statement) are hidden. Plain entries
// merge both records' `other` display fields, preferring the one that
// already resolved a task. Plain and incoming entries sort canonical;
// outgoing keeps the authored order of this task's LINKS line.
function relationGroupRelatedEdges(ownerPath, ownerBlockId, outgoing, incoming) {
  const owner = String(ownerPath || "");
  const ownerId = String(ownerBlockId || "");
  const outgoingRows = Array.isArray(outgoing) ? outgoing : [];
  const incomingRows = Array.isArray(incoming) ? incoming : [];
  const pairs = new Map();
  const remember = (rows, side) => {
    for (const edge of rows) {
      if (!edge || typeof edge !== "object") continue;
      const identity = relationRelatedOtherIdentity(edge, side);
      if (!identity.blockId) continue;
      const key = relationPairKey(owner, ownerId, identity.path, identity.blockId);
      if (!pairs.has(key)) pairs.set(key, { identity, outgoing: [], incoming: [] });
      const pair = pairs.get(key);
      if (!pair.identity.path && identity.path) pair.identity = identity;
      pair[side].push(edge);
    }
  };
  remember(outgoingRows, "outgoing");
  remember(incomingRows, "incoming");
  const plain = [];
  for (const pair of pairs.values()) {
    const edges = [...pair.outgoing, ...pair.incoming];
    if (!edges.some((edge) => edge && typeof edge.label === "string" && edge.label)) {
      plain.push(pair);
    }
  }
  const pickOther = (pair) => {
    const candidates = [...pair.outgoing, ...pair.incoming]
      .map((edge) => (edge && edge.other && typeof edge.other === "object" ? edge.other : null))
      .filter(Boolean);
    return candidates.find((other) => other && other.task) || candidates[0] || { path: pair.identity.path, blockId: pair.identity.blockId };
  };
  const plainEntries = plain.map((pair) => {
    const storedOn = pair.outgoing.length && pair.incoming.length ? "both" : pair.outgoing.length ? "this" : "other";
    return { other: pickOther(pair), storedOn, label: null, edges: [...pair.outgoing, ...pair.incoming] };
  });
  plainEntries.sort((a, b) => relationCompareLinktext(
    relationEdgeLinktext(a.other && a.other.path, a.other && a.other.blockId, owner),
    relationEdgeLinktext(b.other && b.other.path, b.other && b.other.blockId, owner),
  ));
  const outgoingStatements = [];
  for (const edge of outgoingRows) {
    if (edge && typeof edge.label === "string" && edge.label) outgoingStatements.push(edge);
  }
  const incomingStatements = [];
  for (const edge of incomingRows) {
    if (edge && typeof edge.label === "string" && edge.label) incomingStatements.push(edge);
  }
  incomingStatements.sort((a, b) => relationCompareLinktext(
    relationEdgeLinktext(a.other && a.other.path, a.other && a.other.blockId, owner),
    relationEdgeLinktext(b.other && b.other.path, b.other && b.other.blockId, owner),
  ));
  return { plain: plainEntries, outgoing: outgoingStatements, incoming: incomingStatements };
}

function relationLabelSuggestionRows(edges, prefix) {
  const needle = String(prefix || "").trim().toLocaleLowerCase();
  const counts = new Map();
  for (const edge of edges || []) {
    const label = String(edge && edge.label || "").trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return Array.from(counts.values())
    .filter((item) => !needle || item.label.toLocaleLowerCase().startsWith(needle))
    .sort((a, b) => b.count - a.count || relationCodepointCompare(a.label, b.label))
    .map((item) => ({ label: item.label, count: item.count }));
}
