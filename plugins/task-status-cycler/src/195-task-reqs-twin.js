// --- Task requirements twin (RQ), part 2: the recognizer -------------------
// Twin of bob-cli `src/native/task_reqs.rs` (`docs/task-requirements.md`
// §1–§2) over the part-1 line helpers (`task-reqs-lines-twin.js`). A req is
// a checkbox list item without the global filter whose structural parent is
// a real task or another req, outside fences, quotes, and frontmatter.
// State is derived, never written. Plugin-agnostic and copied byte for byte;
// update bob-cli first, then this file, then its copies.
//
// Row fields keep bob-ledger-tools' display subset names (`line`,
// `lineIndex`, `depth`, `parent`, `owner`, `ownerLine`, `ownerText`,
// `ownerName`, `mark`, `markChar`, `state`, `text`, `anchor`,
// `depth_exceeded`, `excludedBy`, `excludedBecause`, `markerFrom`,
// `markerTo`). Fields ending in `Index` / `Indexes` are 0-based; `line`,
// `parent`, `owner`, `ownerLine`, and `excludedBy` are 1-based.

// --- Requirement recognizer ----------------------------------------------

function taskReqMarkName(markChar) {
  if (markChar === " ") return "open";
  if (markChar === "-") return "dropped";
  if (markChar === ">") return "carried";
  if (markChar === "x" || markChar === "X") return "legacy-met";
  return "unknown";
}

// A req checkbox head: `[` + one mark + `]` + whitespace (or the end).
// `mark` is the raw mark character (bob-ledger-tools' shape); `markName` is
// its stable name (`open`, `dropped`, `carried`, `legacy-met`, `unknown`).
function taskReqParseCheckbox(body) {
  const text = String(body == null ? "" : body);
  if (!text.startsWith("[")) return null;
  const point = text.codePointAt(1);
  if (point === undefined) return null;
  const markChar = String.fromCodePoint(point);
  const afterMark = text.slice(1 + markChar.length);
  if (!afterMark.startsWith("]")) return null;
  const afterClose = afterMark.slice(1);
  const parsed = {
    mark: markChar,
    markChar,
    markName: taskReqMarkName(markChar),
    rest: "",
    markerLength: 2 + markChar.length,
  };
  if (afterClose === "") return parsed;
  if (afterClose[0] !== " " && afterClose[0] !== "\t") return null;
  parsed.rest = afterClose.replace(/^[ \t]+/, "");
  return parsed;
}

function taskReqCarriesGlobalFilter(rest, globalFilter) {
  const filter = globalFilter === undefined ? TASK_REQ_GLOBAL_FILTER : globalFilter;
  return filter !== "" && taskReqSplitWhitespace(rest).includes(filter);
}

// Line-shape check: a checkbox list item without the global filter token.
// Position (parent chain, fences, quotes) is decided by the forest.
function taskReqHeadMark(line, globalFilter) {
  const item = taskReqListItem(line);
  if (!item) return null;
  const parsed = taskReqParseCheckbox(item.body);
  if (!parsed || taskReqCarriesGlobalFilter(parsed.rest, globalFilter)) return null;
  parsed.bodyFrom = item.bodyFrom;
  return parsed;
}

// `task_reqs::checkbox_mark_without_filter`: the cheap single-line prefilter
// (`open`, `dropped`, …) or null. Only such a line can be a req.
function taskReqCheckboxMarkWithoutFilter(line, globalFilter) {
  const head = taskReqHeadMark(line, globalFilter);
  return head ? head.markName : null;
}

// Clean text: the trailing `^anchor` removed, trailing whitespace trimmed.
function taskReqCleanText(rest) {
  const trimmed = taskReqTrimEnd(rest);
  const anchor = taskReqTrailingBlockId(trimmed);
  if (anchor === null) return { text: trimmed, anchor: null };
  const suffix = `^${anchor}`;
  const without = trimmed.endsWith(suffix) ? trimmed.slice(0, trimmed.length - suffix.length) : trimmed;
  return { text: taskReqTrimEnd(without), anchor };
}

function taskReqOwnerStatus(task) {
  if (task.statusType === "DONE") return "done";
  if (task.statusType === "CANCELLED") return "cancelled";
  return "open";
}

function taskReqBaseState(mark, ownerStatus) {
  if (mark === "dropped") return "dropped";
  if (mark === "carried") return "carried";
  if (mark === "legacy-met") return "met";
  if (ownerStatus === "done") return "met";
  if (ownerStatus === "cancelled") return "moot";
  return "pending";
}

// `task_reqs::block_last_line` (`block_end` is an offset).
function taskReqBlockLastLine(doc, task) {
  for (let index = 0; index < doc.spans.length; index += 1) {
    if (doc.spans[index].end > task.blockEnd) return Math.max(index - 1, 0);
  }
  return Math.max(doc.spans.length - 1, 0);
}

function taskReqChainReaches(doc, tasksByLine, fenced, lineIndex, target) {
  let cursor = lineIndex;
  for (;;) {
    if (cursor === target) return true;
    if (tasksByLine.has(cursor) || fenced.has(cursor)) return false;
    const parent = taskReqDocParent(doc, cursor);
    if (parent === null) return false;
    cursor = parent;
  }
}

function taskReqChainCrossesContainer(doc, fenced, lineIndex, target) {
  let cursor = lineIndex;
  for (;;) {
    if (cursor === target || fenced.has(cursor)) return false;
    const parent = taskReqDocParent(doc, cursor);
    if (parent === null) return false;
    if (parent !== target && taskReqIsStructuralContainer(doc.texts[parent])) return true;
    cursor = parent;
  }
}

function taskReqContiguousRanges(sorted) {
  const ranges = [];
  let start = null;
  let previous = 0;
  for (const line of sorted) {
    if (start === null) {
      start = line;
    } else if (line !== previous + 1) {
      ranges.push([start, previous]);
      start = line;
    }
    previous = line;
  }
  if (start !== null) ranges.push([start, previous]);
  return ranges;
}

// The req forest for every task in the note, ordered by owner then document
// position (`task_reqs::forest_for_note`).
function taskReqForestIn(doc, options) {
  const lineCount = doc.texts.length;
  if (lineCount === 0) return [];
  const fenced = taskReqDocListFenced(doc);
  const logical = doc.texts.map((line, index) => (doc.bodies[index] !== null ? doc.bodies[index] : line));
  const frontmatterEnd = taskReqFrontmatterEnd(logical);
  const tasks = taskReqScanIn(doc, options);
  const tasksByLine = new Map(tasks.map((task) => [task.lineIndex, task]));
  const ownerEnds = new Map();
  const ownerEnd = (ownerLine) => {
    if (!ownerEnds.has(ownerLine)) {
      const task = tasksByLine.get(ownerLine);
      ownerEnds.set(ownerLine, task ? taskReqBlockLastLine(doc, task) : Math.max(lineCount - 1, 0));
    }
    return ownerEnds.get(ownerLine);
  };
  const nodes = [];
  const nodeByLine = new Map();
  // Innermost owners first, so nested subtasks win their own reqs.
  const owners = tasks.slice().sort((left, right) => right.lineIndex - left.lineIndex || left.blockEnd - right.blockEnd);
  for (const owner of owners) {
    const ownerStatus = taskReqOwnerStatus(owner);
    const end = Math.min(ownerEnd(owner.lineIndex), lineCount - 1);
    for (let lineIndex = owner.lineIndex + 1; lineIndex <= end; lineIndex += 1) {
      if ((frontmatterEnd !== null && lineIndex <= frontmatterEnd)
        || fenced.has(lineIndex)
        || doc.blank[lineIndex]
        || doc.bodies[lineIndex] === null
        || tasksByLine.has(lineIndex)) continue;
      const line = doc.texts[lineIndex];
      const head = taskReqHeadMark(line, options.globalFilter);
      if (!head || taskReqIsStructuralContainer(line)) continue;
      const parentLine = taskReqDocParent(doc, lineIndex);
      if (parentLine === null || fenced.has(parentLine) || taskReqIsStructuralContainer(doc.texts[parentLine])) continue;
      let depth;
      let parentIndex;
      if (parentLine === owner.lineIndex) {
        depth = 1;
        parentIndex = null;
      } else if (nodeByLine.has(parentLine)) {
        const parentNode = nodes[nodeByLine.get(parentLine)];
        if (parentNode.ownerIndex !== owner.lineIndex) continue;
        depth = parentNode.depth + 1;
        parentIndex = parentLine;
      } else {
        // Under a note, a drawer entry, a managed line, or any other
        // non-req bullet: an ordinary checklist, never a req.
        continue;
      }
      const cleaned = taskReqCleanText(head.rest);
      let state = taskReqBaseState(head.markName, ownerStatus);
      let excludedByIndex = null;
      let excludedBecause = null;
      if (parentIndex !== null && state !== "dropped" && state !== "carried") {
        const parentNode = nodes[nodeByLine.get(parentIndex)];
        if (parentNode.state === "dropped" || parentNode.state === "carried") {
          state = "excluded";
          excludedByIndex = parentIndex;
          excludedBecause = parentNode.state;
        } else if (parentNode.state === "excluded") {
          state = "excluded";
          excludedByIndex = parentIndex;
          excludedBecause = parentNode.excludedBecause;
        }
      }
      nodeByLine.set(lineIndex, nodes.length);
      nodes.push({
        line: lineIndex + 1,
        lineIndex,
        depth,
        parent: parentIndex === null ? null : parentIndex + 1,
        parentIndex,
        owner: owner.lineIndex + 1,
        ownerLine: owner.lineIndex + 1,
        ownerIndex: owner.lineIndex,
        ownerText: doc.texts[owner.lineIndex],
        ownerName: owner.description,
        mark: head.markName,
        markChar: head.markChar,
        state,
        text: cleaned.text,
        anchor: cleaned.anchor,
        excludedBy: excludedByIndex === null ? null : excludedByIndex + 1,
        excludedByIndex,
        excludedBecause,
        path: [],
        subtreeEndIndex: lineIndex,
        noteRangeIndexes: [],
        depth_exceeded: depth > TASK_REQ_MAX_DEPTH,
        markerFrom: head.bodyFrom,
        markerTo: head.bodyFrom + head.markerLength,
      });
    }
  }

  // Sibling ordinals among reqs sharing one owner and structural parent.
  const ordinals = new Map();
  const pathByHead = new Map();
  const order = nodes.map((_, index) => index)
    .sort((left, right) => nodes[left].ownerIndex - nodes[right].ownerIndex || nodes[left].lineIndex - nodes[right].lineIndex);
  for (const index of order) {
    const node = nodes[index];
    const key = `${node.ownerIndex}:${node.parentIndex === null ? "root" : node.parentIndex}`;
    const ordinal = (ordinals.get(key) || 0) + 1;
    ordinals.set(key, ordinal);
    const path = (pathByHead.get(key) || []).concat([ordinal]);
    pathByHead.set(`${node.ownerIndex}:${node.lineIndex}`, path);
    node.path = path;
  }

  // Subtree ends and direct note ranges. A line belongs to the nearest req
  // whose chain reaches it without crossing another req or a nested task.
  const chains = new Map();
  for (const node of nodes) {
    const chain = [node.lineIndex];
    let cursor = node.parentIndex;
    while (cursor !== null) {
      chain.push(cursor);
      cursor = nodes[nodeByLine.get(cursor)].parentIndex;
    }
    chains.set(node.lineIndex, chain);
  }
  const allNotes = [];
  for (const node of nodes) {
    let end = node.lineIndex;
    const noteLines = [];
    const lastLine = ownerEnd(node.ownerIndex);
    const headIndent = doc.indents[node.lineIndex];
    let cursor = node.lineIndex + 1;
    while (cursor <= lastLine && cursor < lineCount) {
      const text = doc.texts[cursor];
      const isList = doc.bodies[cursor] !== null;
      if (isList && doc.indents[cursor] <= headIndent) break;
      if (tasksByLine.has(cursor)) {
        cursor = taskReqBlockLastLine(doc, tasksByLine.get(cursor)) + 1;
        continue;
      }
      if (fenced.has(cursor)) {
        cursor += 1;
        continue;
      }
      if (taskReqChainReaches(doc, tasksByLine, fenced, cursor, node.lineIndex)) {
        end = cursor;
        // Managed lines, drawers, and their nested content travel with the
        // req but are never its notes.
        if (!nodeByLine.has(cursor)
          && isList
          && !taskReqIsStructuralContainer(text)
          && !taskReqChainCrossesContainer(doc, fenced, cursor, node.lineIndex)
          && taskReqHeadMark(text, options.globalFilter) === null) {
          noteLines.push(cursor);
        }
      }
      cursor += 1;
    }
    node.subtreeEndIndex = end;
    allNotes.push(noteLines);
  }
  nodes.forEach((node, index) => {
    const childSubtrees = nodes
      .filter((other) => other.ownerIndex === node.ownerIndex
        && other.lineIndex !== node.lineIndex
        && chains.get(other.lineIndex).includes(node.lineIndex))
      .map((other) => [other.lineIndex, other.subtreeEndIndex]);
    const direct = allNotes[index].filter((line) => !childSubtrees.some(([start, stop]) => line >= start && line <= stop));
    node.noteRangeIndexes = taskReqContiguousRanges(direct);
  });

  return nodes.sort((left, right) => left.ownerIndex - right.ownerIndex || left.lineIndex - right.lineIndex);
}

function taskReqForest(contents, options) {
  return taskReqForestIn(taskReqDocument(contents), taskReqOptions(options));
}

// The reqs one owner task owns (`task_reqs::req_forest`).
function taskReqForestForOwner(contents, ownerIndex, options) {
  return taskReqForest(contents, options).filter((node) => node.ownerIndex === ownerIndex);
}

function taskReqInfoAtLine(contents, lineIndex, options) {
  return taskReqForest(contents, options).find((node) => node.lineIndex === lineIndex) || null;
}

// `task_reqs::owner_of_line`: the 0-based owning task line for a task line
// or a req, else null.
function taskReqOwnerOfLine(contents, lineIndex, options) {
  const doc = taskReqDocument(contents);
  const resolved = taskReqOptions(options);
  if (taskReqScanIn(doc, resolved).some((task) => task.lineIndex === lineIndex)) return lineIndex;
  const node = taskReqForestIn(doc, resolved).find((row) => row.lineIndex === lineIndex);
  return node ? node.ownerIndex : null;
}

function taskReqIsReqLine(contents, lineIndex, options) {
  return taskReqInfoAtLine(contents, lineIndex, options) !== null;
}

// `task_reqs::req_path`: dotted 1-based sibling ordinals (`2.1.3`).
function taskReqPathText(row) {
  return (row && Array.isArray(row.path) ? row.path : []).join(".");
}

// `task_reqs::req_row_key`. `digest8(text)` returns the first 8 hex digits
// of the SHA-256 of the UTF-8 text; it is injected to keep this fragment
// pure and synchronous.
function taskReqRowKey(ownerKey, row, digest8) {
  return `${ownerKey}/req/${taskReqPathText(row)}~${String(digest8(row.text)).slice(0, 8)}`;
}

// `task_reqs::req_run`: the hash run drawn in place of a req's checkbox.
function taskReqRun(depth) {
  if (depth <= 1) return "⌗⌗";
  if (depth === 2) return "⌗⌗⌗";
  return "⌗⌗⌗⌗";
}
