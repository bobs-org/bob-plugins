// --- Task block layout twin (RL), part 1: zones, slots, drawers -------------
// Twin of bob-cli `src/native/task_block_layout.rs` (`docs/task-requirements.md`
// §3) plus the helpers it reads (`task_children` classification and the
// `capture_drawers` drawer list, insertion, and NOTES creation). Rust is the
// authority; the shared RL vectors are copied byte for byte from bob-cli.
// Plugin-agnostic and copied byte for byte; update bob-cli first, then this
// file, then its copies. Reads the RQ twin (`task-reqs-lines-twin.js`).
//
// A task's direct children sit in six zones, in order: Cancel Log, managed
// links, reqs (each with its whole subtree), authored (loose notes and nested
// `#task` subtasks), drawers (`NOTES` first on a req owner), and logs. Order
// inside a zone is authored order and is never re-sorted. A task that owns
// reqs keeps its notes in a `NOTES` drawer, created only when a note lands in
// it. On a `^prj` owner the home is the project note's `## Notes` section
// (Title Case when created; an existing `## NOTES` spelling is kept), with
// column-zero bullets. Tasks are the `taskReqNoteTasks` rows; `blockEnd` and
// every `offset` are UTF-16 offsets into the note.

const TASK_BLOCK_NOTES_KEY = "NOTES";
// Creation stays legacy throughout the reader rollout.
const TASK_BLOCK_NOTES_TITLE = "NOTES";
const TASK_BLOCK_NOTES_SECTION_TITLE = "Notes";
// Drawer slots read the block with the default filter, as bob-cli does.
const TASK_BLOCK_DEFAULT_FILTER = "#task";
const TASK_BLOCK_ZONES = Object.freeze(["cancel-log", "managed-links", "reqs", "authored", "drawers", "logs"]);
const TASK_BLOCK_CHILD_KINDS = Object.freeze([
  "cancel-log",
  "managed-link",
  "req",
  "authored",
  "drawer",
  "notes-drawer",
  "log",
]);

function taskBlockZoneRank(zone) {
  return TASK_BLOCK_ZONES.indexOf(zone);
}

function taskBlockCarriesTaskFilter(line, globalFilter) {
  const body = taskReqListItemBody(line);
  return body !== null && globalFilter !== "" && taskReqSplitWhitespace(body).includes(globalFilter);
}

// `task_children::classify_task_child_with_filter`. `nestedTaskOpen` is the
// scanner's answer for a nested `#task` (null when the caller has no note
// context). Kinds: `{type: "managed-link", link}`, `{type: "managed-log",
// log}`, `{type: "nested-task", open}`, `{type: "requirement", mark}`,
// `{type: "drawer", title}`, `{type: "authored"}`.
function taskBlockClassifyChild(line, nestedTaskOpen, globalFilter) {
  const filter = typeof globalFilter === "string" ? globalFilter : TASK_REQ_GLOBAL_FILTER;
  const text = String(line == null ? "" : line);
  if (taskReqIsSubprojectsLine(text)) return { type: "managed-link", link: "sub-projects" };
  if (taskReqIsManagedLinkLine(text)) {
    const link = taskReqIsDependencyLine(text)
      ? "depends-on"
      : taskReqIsBlocksLine(text)
        ? "blocks"
        : taskReqIsLinksLine(text)
          ? "links"
          : "linked-from";
    return { type: "managed-link", link };
  }
  if (taskReqIsCancelLog(text)) return { type: "managed-log", log: "cancel" };
  const log = taskReqManagedLogKind(text);
  if (log !== null) return { type: "managed-log", log };
  if (nestedTaskOpen === true || nestedTaskOpen === false) {
    if (taskBlockCarriesTaskFilter(text, filter)) return { type: "nested-task", open: nestedTaskOpen };
  } else if (taskBlockCarriesTaskFilter(text, filter)) {
    // Without a note context the line is still a task boundary, never a req.
    return { type: "authored" };
  }
  const mark = taskReqCheckboxMarkWithoutFilter(text, filter);
  if (mark !== null) return { type: "requirement", mark };
  const body = taskReqListItemBody(text);
  if (body !== null) {
    const parsed = drawer_body_title(taskReqTrim(body));
    if (parsed) {
      const key = drawer_key(parsed.title);
      const legacyLog = parsed.marker === "legacy_caps" && DRAWER_LEGACY_LOG_KEYS.has(key);
      if ((!drawer_is_reserved_key(key) || legacyLog) && !drawer_is_structural_h2_key(key)) {
        return { type: "drawer", title: parsed.title };
      }
    }
  }
  return { type: "authored" };
}

// `task_block_layout::zone_of`.
function taskBlockZoneOf(kind) {
  if (kind.type === "managed-log") return kind.log === "cancel" ? "cancel-log" : "logs";
  if (kind.type === "managed-link") return "managed-links";
  if (kind.type === "requirement") return "reqs";
  if (kind.type === "drawer") return "drawers";
  return "authored";
}

// `task_children::classify_direct_children_by_filter`: every list-item
// direct child in document order; a nested `#task` reports open.
function taskBlockDirectChildrenIn(doc, task, globalFilter) {
  const children = [];
  if (task.lineIndex >= doc.texts.length) return children;
  const fenced = taskReqDocListFenced(doc);
  for (let lineIndex = task.lineIndex + 1; lineIndex < doc.texts.length; lineIndex += 1) {
    if (doc.spans[lineIndex].end > task.blockEnd) break;
    if (fenced.has(lineIndex)
      || doc.blank[lineIndex]
      || doc.bodies[lineIndex] === null
      || taskReqDocParent(doc, lineIndex) !== task.lineIndex) continue;
    children.push({ lineIndex, kind: taskBlockClassifyChild(doc.texts[lineIndex], true, globalFilter) });
  }
  return children;
}

// `task_block_layout::block_last_line`.
function taskBlockLastLineIn(doc, task) {
  let last = Math.max(doc.spans.length - 1, 0);
  for (let index = 0; index < doc.spans.length; index += 1) {
    if (doc.spans[index].end >= task.blockEnd) {
      last = index;
      break;
    }
  }
  return Math.max(last, task.lineIndex);
}

// `TaskBlock::read`: the task's direct children with their extents (up to
// the next sibling, so trailing blank lines travel with their child).
function taskBlockReadIn(doc, task, globalFilter) {
  const lastLineIndex = taskBlockLastLineIn(doc, task);
  const classified = taskBlockDirectChildrenIn(doc, task, globalFilter);
  return {
    taskLineIndex: task.lineIndex,
    lastLineIndex,
    children: classified.map((child, index) => ({
      lineIndex: child.lineIndex,
      endIndex: index + 1 < classified.length ? classified[index + 1].lineIndex - 1 : lastLineIndex,
      kind: child.kind,
      zone: taskBlockZoneOf(child.kind),
    })),
  };
}

function taskBlockRead(contents, task, options) {
  return taskBlockReadIn(taskReqDocument(contents), task, taskReqOptions(options).globalFilter);
}

// The last nonblank line of a child's extent.
function taskBlockContentEnd(doc, child) {
  let end = child.endIndex;
  while (end > child.lineIndex && doc.blank[end]) end -= 1;
  return end;
}

function taskBlockIsLooseNote(child) {
  return child.kind.type === "authored";
}

function taskBlockIsNotesDrawer(child) {
  return child.kind.type === "drawer" && taskReqDrawerKey(child.kind.title) === TASK_BLOCK_NOTES_KEY;
}

// True when the task owns at least one req (any state, any depth).
function taskBlockOwnsReqs(block) {
  return block.children.some((child) => child.zone === "reqs");
}

// `task_block_layout::line_offset`: the start of `lineIndex`; the line
// count maps to the end of the note.
function taskBlockLineOffset(doc, lineIndex) {
  if (lineIndex === 0 || !doc.spans.length) return 0;
  const span = doc.spans[lineIndex - 1] || doc.spans[doc.spans.length - 1];
  return span.end;
}

// `capture::first_child_indentation`: the first deeper nonblank line's
// leading whitespace inside the block (compared in UTF-8 bytes).
function taskBlockFirstChildIndentation(doc, parentIndex, blockEnd, parentIndentation) {
  const parentBytes = taskReqUtf8Length(parentIndentation);
  for (let index = parentIndex + 1; index < doc.texts.length; index += 1) {
    if (doc.spans[index].end > blockEnd) break;
    if (doc.blank[index]) continue;
    const indentation = taskReqLeadingWhitespace(doc.texts[index]);
    if (taskReqUtf8Length(indentation) > parentBytes) return indentation;
  }
  return null;
}

// `capture::dominant_indent_unit`: tab when more lines start with a tab than
// a space, two spaces otherwise, null when nothing is indented.
function taskBlockDominantIndentUnit(doc) {
  let tabs = 0;
  let spaces = 0;
  for (const text of doc.texts) {
    if (text[0] === "\t") tabs += 1;
    else if (text[0] === " ") spaces += 1;
  }
  if (tabs + spaces === 0) return null;
  return tabs > spaces ? "\t" : "  ";
}

function taskBlockNestedIndentation(doc, parentIndex, blockEnd, parentIndentation) {
  const first = taskBlockFirstChildIndentation(doc, parentIndex, blockEnd, parentIndentation);
  if (first !== null) return first;
  const unit = taskBlockDominantIndentUnit(doc);
  return unit !== null ? `${parentIndentation}${unit}` : `${parentIndentation}\t`;
}

// `task_block_layout::child_indent`.
function taskBlockChildIndentIn(doc, task) {
  return taskBlockNestedIndentation(doc, task.lineIndex, task.blockEnd, task.indentation);
}

function taskBlockSlotLine(doc, block, kind) {
  const children = block.children;
  const after = (child) => taskBlockContentEnd(doc, child) + 1;
  const lastIn = (accept) => {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (accept(taskBlockZoneRank(children[index].zone))) return children[index];
    }
    return null;
  };
  const firstIn = (zone) => children.find((child) => child.zone === zone) || null;
  const managedRank = taskBlockZoneRank("managed-links");
  const managedEnd = () => {
    const last = lastIn((rank) => rank <= managedRank);
    if (last) return after(last);
    return children.length ? children[0].lineIndex : block.lastLineIndex + 1;
  };
  const tail = () => {
    const log = firstIn("logs");
    return log ? log.lineIndex : block.lastLineIndex + 1;
  };
  if (kind === "cancel-log") return block.taskLineIndex + 1;
  if (kind === "managed-link") return managedEnd();
  if (kind === "req") {
    const last = lastIn((rank) => rank === taskBlockZoneRank("reqs"));
    return last ? after(last) : managedEnd();
  }
  if (kind === "authored" && taskBlockOwnsReqs(block)) {
    const last = lastIn((rank) => rank <= taskBlockZoneRank("authored"));
    return last ? after(last) : managedEnd();
  }
  if (kind === "authored" || kind === "drawer") return tail();
  if (kind === "notes-drawer") {
    const drawer = firstIn("drawers");
    return drawer ? drawer.lineIndex : tail();
  }
  if (kind === "log") return block.lastLineIndex + 1;
  throw new Error(`unknown task block child kind: ${kind}`);
}

// `task_block_layout::insertion_offset`: where a new child of `kind` goes:
// `{lineIndex, offset, indent}`, inserting before `lineIndex` (the line
// count appends).
function taskBlockInsertionSlotIn(doc, task, kind, options) {
  const block = taskBlockReadIn(doc, task, options.globalFilter);
  const lineIndex = taskBlockSlotLine(doc, block, kind);
  return { lineIndex, offset: taskBlockLineOffset(doc, lineIndex), indent: taskBlockChildIndentIn(doc, task) };
}

function taskBlockInsertionSlot(contents, task, kind, options) {
  return taskBlockInsertionSlotIn(taskReqDocument(contents), task, kind, taskReqOptions(options));
}

// `task_block_layout::drawer_header_offset`: a created `NOTES` lands first
// among the drawers, any other drawer before the first managed log.
function taskBlockDrawerHeaderOffset(contents, task, notesFirst) {
  const doc = taskReqDocument(contents);
  const block = taskBlockReadIn(doc, task, TASK_BLOCK_DEFAULT_FILTER);
  return taskBlockLineOffset(doc, taskBlockSlotLine(doc, block, notesFirst ? "notes-drawer" : "drawer"));
}

// --- Drawers (`capture_drawers`) -------------------------------------------

function taskBlockLineStart(doc, lineIndex) {
  return lineIndex === 0 ? 0 : doc.spans[lineIndex - 1].end;
}

function taskBlockDirectChildListIndexes(doc, parentIndex, blockEnd) {
  const parentIndent = doc.indents[parentIndex];
  const indexes = [];
  for (let lineIndex = parentIndex + 1; lineIndex < doc.texts.length; lineIndex += 1) {
    if (doc.spans[lineIndex].end > blockEnd) break;
    if (doc.indents[lineIndex] <= parentIndent
      || doc.bodies[lineIndex] === null
      || taskReqDocParent(doc, lineIndex) !== parentIndex) continue;
    indexes.push(lineIndex);
  }
  return indexes;
}

// `capture_drawers::has_task_checkbox`.
function taskBlockHasTaskCheckbox(body) {
  if (!body.startsWith("[")) return false;
  const point = body.codePointAt(1);
  if (point === undefined) return false;
  const status = String.fromCodePoint(point);
  if (status === "]" || status === "\n") return false;
  const afterStatus = body.slice(1 + status.length);
  if (!afterStatus.startsWith("]")) return false;
  return taskReqIndentLength(afterStatus.slice(1)) > 0;
}

function taskBlockRawFenced(doc) {
  return taskReqDocMemo(doc, "raw-fenced", () => taskReqFencedLines(doc.texts, 0, doc.texts.length));
}

// `capture_drawers::drawers`: the dual-read drawer headers directly under the
// task, as `{title, key, line (1-based), lineIndex, indentation, blockEnd,
// entryCount}`.
function taskBlockDrawersIn(doc, task) {
  const children = drawer_direct_child_indexes(doc.contents, task);
  const drawers = [];
  children.forEach((lineIndex, index) => {
    const text = doc.texts[lineIndex];
    const header = recognize_drawer_header(doc.contents, task, lineIndex);
    if (!header || taskReqManagedLogKind(text) !== null) return;
    const blockEnd = index + 1 < children.length ? taskBlockLineStart(doc, children[index + 1]) : task.blockEnd;
    drawers.push({
      title: header.title,
      key: header.key,
      marker: header.marker,
      line: lineIndex + 1,
      lineIndex,
      indentation: taskReqLeadingWhitespace(text),
      blockEnd,
      entryCount: taskBlockDirectChildListIndexes(doc, lineIndex, blockEnd).length,
    });
  });
  return drawers;
}

function taskBlockDrawers(contents, task) {
  return taskBlockDrawersIn(taskReqDocument(contents), task);
}

// `capture::first_direct_managed_log_start`.
function taskBlockFirstDirectManagedLogStart(doc, parentIndex, blockEnd) {
  let lineStart = doc.spans[parentIndex].end;
  for (let lineIndex = parentIndex + 1; lineIndex < doc.texts.length; lineIndex += 1) {
    if (doc.spans[lineIndex].end > blockEnd) break;
    if (!doc.blank[lineIndex]
      && taskReqManagedLogKind(doc.texts[lineIndex]) !== null
      && taskReqDocParent(doc, lineIndex) === parentIndex) return lineStart;
    lineStart = doc.spans[lineIndex].end;
  }
  return null;
}

// `capture_drawers::drawer_insertion`: `{offset, indentation}` for entries
// filed under `drawer`, before the drawer's own managed logs.
function taskBlockDrawerInsertion(contents, drawer) {
  const doc = taskReqDocument(contents);
  const indentation = taskBlockNestedIndentation(doc, drawer.lineIndex, drawer.blockEnd, drawer.indentation);
  const logStart = taskBlockFirstDirectManagedLogStart(doc, drawer.lineIndex, drawer.blockEnd);
  return { offset: logStart === null ? drawer.blockEnd : logStart, indentation };
}

// `projects::has_trailing_prj_anchor` plus the `#task` check of
// `capture_drawers::is_prj_parent`.
function taskBlockIsPrjParent(contents, task) {
  const doc = taskReqDocument(contents);
  const line = doc.texts[task.lineIndex];
  if (line === undefined) return false;
  const trimmed = taskReqTrimEnd(line);
  if (!trimmed.endsWith("^prj")) return false;
  const before = trimmed.slice(0, -4);
  return (before === "" || taskReqIsWhitespaceChar(before[before.length - 1])) && line.includes("#task");
}

// `markdown::atx_heading`: `{level, title}` or null.
function taskBlockAtxHeading(line) {
  const text = String(line);
  let spaces = 0;
  while (text[spaces] === " ") spaces += 1;
  if (spaces > 3) return null;
  const rest = text.slice(spaces);
  let hashes = 0;
  while (rest[hashes] === "#") hashes += 1;
  if (hashes < 1 || hashes > 6) return null;
  if (hashes < rest.length && !taskReqIsAsciiWhitespace(rest[hashes])) return null;
  const trimmed = taskReqTrim(rest.slice(hashes));
  const withoutHashes = trimmed.replace(/#+$/, "");
  let title = trimmed;
  if (withoutHashes.length !== trimmed.length
    && (withoutHashes === "" || taskReqIsWhitespaceChar(withoutHashes[withoutHashes.length - 1]))) {
    title = taskReqTrimEnd(withoutHashes);
  }
  return { level: hashes, title };
}

// `capture_drawers::h2_insert_position`: `{offset, empty}` for a column-zero
// capture into a project `##` section.
function taskBlockH2InsertPosition(contents, drawer) {
  const doc = taskReqDocument(contents);
  const headingIdx = Math.min(Math.max((drawer.line || 1) - 1, 0), doc.texts.length);
  let endIdx = doc.texts.length;
  for (let idx = 0; idx <= doc.texts.length; idx += 1) {
    if (taskBlockLineOffset(doc, idx) >= drawer.blockEnd) {
      endIdx = idx;
      break;
    }
  }
  const last = Math.min(endIdx, doc.texts.length);
  for (let idx = last - 1; idx > headingIdx; idx -= 1) {
    if (taskReqTrim(doc.texts[idx]) === "") continue;
    return { offset: doc.spans[idx].end, empty: false };
  }
  const heading = doc.spans[headingIdx];
  return { offset: heading ? heading.end : 0, empty: true };
}

// The project note's `## Notes` (or `## NOTES`) section as a drawer
// (`project_h2_drawers` narrowed to the NOTES key).
function taskBlockProjectNotesDrawer(contents) {
  const doc = taskReqDocument(contents);
  const fenced = taskBlockRawFenced(doc);
  for (let lineIndex = 0; lineIndex < doc.texts.length; lineIndex += 1) {
    if (fenced.has(lineIndex)) continue;
    const heading = taskBlockAtxHeading(doc.texts[lineIndex]);
    if (!heading || heading.level !== 2) continue;
    const title = taskReqTrim(heading.title);
    if (title === "" || taskReqDrawerKey(title) !== TASK_BLOCK_NOTES_KEY) continue;
    let endLine = doc.texts.length;
    for (let next = lineIndex + 1; next < doc.texts.length; next += 1) {
      if (fenced.has(next)) continue;
      const nextHeading = taskBlockAtxHeading(doc.texts[next]);
      if (nextHeading && nextHeading.level <= 2) {
        endLine = next;
        break;
      }
    }
    const blockEnd = endLine === 0
      ? 0
      : endLine <= doc.spans.length ? doc.spans[endLine - 1].end : doc.spans[doc.spans.length - 1].end;
    return { title, key: TASK_BLOCK_NOTES_KEY, line: lineIndex + 1, lineIndex, indentation: "", blockEnd };
  }
  return null;
}

// `capture_drawers::insertion_text_preserving_line_endings`.
function taskBlockInsertionTextPreservingLineEndings(contents, index, line) {
  const ending = taskBlockDocumentLineEnding(contents);
  const text = String(line).replace(/\n/g, ending);
  const needsLeadingEnding = index > 0 && contents[index - 1] !== "\n";
  return needsLeadingEnding ? `${ending}${text}${ending}` : `${text}${ending}`;
}

// `capture::document_line_ending`.
function taskBlockDocumentLineEnding(contents) {
  return String(contents).includes("\r\n") ? "\r\n" : "\n";
}

// `task_block_layout::notes_drawer`: the project `## Notes` section on a
// `^prj` owner, else the task-child `NOTES` drawer.
function taskBlockNotesDrawer(contents, task) {
  if (taskBlockIsPrjParent(contents, task)) return taskBlockProjectNotesDrawer(contents);
  return taskBlockDrawers(contents, task).find((drawer) => drawer.key === TASK_BLOCK_NOTES_KEY) || null;
}

// `task_block_layout::notes_create_title`.
function taskBlockNotesCreateTitle(contents, task) {
  return taskBlockIsPrjParent(contents, task) ? TASK_BLOCK_NOTES_SECTION_TITLE : TASK_BLOCK_NOTES_TITLE;
}

// `task_block_layout::ensure_notes_drawer` (`capture_drawers::ensure_drawer`
// creating `NOTES`): `{updated, drawer, created: true}`, or null when the
// drawer could not be found after the write. A `^prj` project task gets a
// Title Case `## Notes` section at the end of the note instead of a child
// bullet.
function taskBlockEnsureNotesDrawer(contents, task) {
  const text = String(contents);
  if (taskBlockIsPrjParent(text, task)) {
    const ending = taskBlockDocumentLineEnding(text);
    const separator = text === "" || text.endsWith(`${ending}${ending}`)
      ? ""
      : text.endsWith(ending) ? ending : `${ending}${ending}`;
    const updated = `${text}${separator}## ${TASK_BLOCK_NOTES_SECTION_TITLE}${ending}`;
    const drawer = taskBlockProjectNotesDrawer(updated);
    return drawer ? { updated, drawer, created: true } : null;
  }
  const doc = taskReqDocument(text);
  const header = `${taskBlockChildIndentIn(doc, task)}- ${TASK_BLOCK_NOTES_TITLE}`;
  const headerOffset = taskBlockDrawerHeaderOffset(text, task, true);
  const addition = taskBlockInsertionTextPreservingLineEndings(text, headerOffset, header);
  const updatedTask = Object.assign({}, task, {
    blockEnd: headerOffset <= task.blockEnd ? task.blockEnd + addition.length : task.blockEnd,
  });
  const updated = `${text.slice(0, headerOffset)}${addition}${text.slice(headerOffset)}`;
  const drawer = taskBlockDrawers(updated, updatedTask).find((entry) => entry.key === TASK_BLOCK_NOTES_KEY);
  return drawer ? { updated, drawer, created: true } : null;
}

// --- Note homes and violations ------------------------------------------------

// `task_block_layout::note_home`: `{home: "loose", slot}` for a task with no
// reqs, `{home: "notes", drawer}` when its `NOTES` exists, else
// `{home: "new-notes"}`.
function taskBlockNoteHome(contents, task, options) {
  const resolved = taskReqOptions(options);
  const doc = taskReqDocument(contents);
  const block = taskBlockReadIn(doc, task, resolved.globalFilter);
  if (!taskBlockOwnsReqs(block)) return { home: "loose", slot: taskBlockInsertionSlotIn(doc, task, "authored", resolved) };
  const drawer = taskBlockNotesDrawer(contents, task);
  return drawer ? { home: "notes", drawer } : { home: "new-notes" };
}

// Sort key of a child: zone rank plus a sub-rank that puts `NOTES` first
// among a req owner's drawers. Without reqs, authored and drawers share a
// rank (authored notes may follow drawers).
function taskBlockSortKey(child, ownsReqs) {
  const ranks = { "cancel-log": 0, "managed-links": 1, reqs: 2, authored: 3, drawers: ownsReqs ? 4 : 3, logs: 5 };
  const sub = ownsReqs && child.zone === "drawers" && !taskBlockIsNotesDrawer(child) ? 1 : 0;
  return [ranks[child.zone], sub];
}

function taskBlockCompareKeys(left, right) {
  return left[0] - right[0] || left[1] - right[1];
}

// Child positions in canonical order: a stable sort, so authored order
// survives inside each zone.
function taskBlockDesiredOrder(block) {
  const ownsReqs = taskBlockOwnsReqs(block);
  return block.children
    .map((_, index) => index)
    .sort((left, right) => taskBlockCompareKeys(
      taskBlockSortKey(block.children[left], ownsReqs),
      taskBlockSortKey(block.children[right], ownsReqs),
    ));
}

// `task_block_layout::layout_violations`: `{lineIndex, kind, zone}` with
// `kind` one of `out-of-zone`, `notes-not-first`, `note-outside-notes`, in
// document order.
function taskBlockLayoutViolations(contents, task, options) {
  const block = taskBlockRead(contents, task, options);
  const ownsReqs = taskBlockOwnsReqs(block);
  const violations = [];
  let highest = null;
  for (const child of block.children) {
    const key = taskBlockSortKey(child, ownsReqs);
    if (highest !== null && taskBlockCompareKeys(key, highest) < 0) {
      const notesNotFirst = child.zone === "drawers" && taskBlockIsNotesDrawer(child);
      violations.push({
        lineIndex: child.lineIndex,
        kind: notesNotFirst ? "notes-not-first" : "out-of-zone",
        zone: child.zone,
      });
    }
    if (highest === null || taskBlockCompareKeys(key, highest) > 0) highest = key;
    if (ownsReqs && child.zone === "authored" && taskBlockIsLooseNote(child)) {
      violations.push({ lineIndex: child.lineIndex, kind: "note-outside-notes", zone: child.zone });
    }
  }
  return violations;
}

// The scanned task at `lineIndex`, for callers that rescan after a write.
function taskBlockFindTask(contents, lineIndex, options) {
  return taskReqNoteTasks(contents, options).find((task) => task.lineIndex === lineIndex) || null;
}
