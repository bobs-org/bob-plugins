// --- Task requirement writers twin (RW) --------------------------------------
// Twin of bob-cli `src/native/task_block_layout/writers.rs`
// (`docs/task-requirements.md` §2, §3, §5): drop, restore, the Ctrl+]
// note/req toggle, and first-requirement insertion. Rust is the authority;
// the shared RW vectors (`writes.json`) are copied byte for byte from
// bob-cli, and a behavior difference is a twin bug. Plugin-agnostic and
// copied byte for byte; update bob-cli first, then this file, then its
// copies. Reads the RQ twin and the RL twin (`task-block-layout-twin.js`,
// `task-block-tidy-twin.js`).
//
// Each writer takes the whole note, a target `{lineIndex, preimage}` (the
// 0-based line and the exact text it expects there, without its ending),
// and the usual `{globalFilter, statusTypes}` options. It returns
// `{ok: true, updated, …}` with the whole updated note, or
// `{ok: false, code, message}` with bob-cli's stable code and the copy a
// client shows. A moved or edited line refuses as `req_stale` instead of
// writing elsewhere. No writer ever writes req completion: the only req
// edits are drop (`[ ]` to `[-]` plus a Cancel Log), restore (`[-]` to
// `[ ]`), and the toggle between a note and a req. Every write keeps each
// untouched line's own ending and the note's final-newline state.

// Written when a req that already keeps a Cancel Log is dropped with no
// reason: a kept history has no gaps.
const TASK_REQ_WRITE_NO_REASON_GIVEN = "🤷 no reason given";
const TASK_REQ_WRITE_CANCEL_LOG_MARKER = "❌ **CANCEL LOG**";
const TASK_REQ_WRITE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function taskReqWriteRefusal(code, message) {
  return { ok: false, code, message };
}

function taskReqWriteParentRefusal() {
  return taskReqWriteRefusal("req_parent", "A requirement needs a task or requirement directly above it");
}

function taskReqWriteDepthRefusal() {
  return taskReqWriteRefusal(
    "req_depth",
    `Requirements nest at most ${TASK_REQ_MAX_DEPTH} deep — carry this branch into its own task`,
  );
}

// `writers::stale`: null when the target line still reads `preimage`.
function taskReqWriteStale(contents, target) {
  const lineIndex = target && target.lineIndex;
  const spans = taskReqLineSpans(contents);
  if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < spans.length
    && spans[lineIndex].text === String(target.preimage)) return null;
  return taskReqWriteRefusal("req_stale", "The line changed — try again");
}

// `writers::owner_text`: the owner's clean description.
function taskReqWriteOwnerText(contents, node, options) {
  const task = taskBlockFindTask(contents, node.ownerIndex, options);
  return task ? task.description : "the task";
}

// `writers::locate_req`: `{node, forest}` or a refusal.
function taskReqWriteLocate(contents, target, options) {
  const stale = taskReqWriteStale(contents, target);
  if (stale) return stale;
  const forest = taskReqForest(contents, options);
  const node = forest.find((row) => row.lineIndex === target.lineIndex);
  if (!node) return taskReqWriteRefusal("not_a_req", "This line is not a requirement");
  return { node, forest };
}

// `writers::descendant_count`: descendant reqs that go with `node`.
function taskReqWriteDescendantCount(forest, node) {
  return forest.filter((other) => other.ownerIndex === node.ownerIndex
    && other.lineIndex > node.lineIndex
    && other.lineIndex <= node.subtreeEndIndex).length;
}

// `writers::rewrite_checkbox`: `line` with its checkbox mark replaced
// (`null` drops the checkbox entirely), keeping everything else byte for
// byte. Null when the line has no checkbox.
function taskReqWriteRewriteCheckbox(line, mark) {
  const item = taskReqListItem(line);
  if (!item || !item.body.startsWith("[")) return null;
  const prefix = line.slice(0, item.bodyFrom);
  const rest = item.body.slice(1);
  const point = rest.codePointAt(0);
  if (point === undefined) return null;
  const markChar = String.fromCodePoint(point);
  const afterMark = rest.slice(markChar.length);
  if (!afterMark.startsWith("]")) return null;
  const after = afterMark.slice(1);
  if (mark === null) return `${prefix}${after.replace(/^[ \t]+/, "")}`;
  return `${prefix}[${mark}]${after}`;
}

// `writers::replace_line_text`: new text for one physical line, keeping its
// own ending.
function taskReqWriteReplaceLineText(physical, text) {
  return `${text}${physical.slice(taskBlockBare(physical).length)}`;
}

// `writers::nesting_unit`: one nesting unit for children of `lineIndex`:
// the line's own indent relative to its structural parent, else a tab.
function taskReqWriteNestingUnit(doc, lineIndex) {
  const text = doc.texts[lineIndex];
  const own = taskReqIndentLength(text);
  const parent = taskReqDocParent(doc, lineIndex);
  if (parent === null) return "\t";
  const parentIndent = taskReqIndentLength(doc.texts[parent]);
  return parentIndent < own ? text.slice(parentIndent, own) : "\t";
}

// `writers::direct_children`: list-item children of a req, in order.
function taskReqWriteDirectChildren(doc, node) {
  const children = [];
  for (let index = node.lineIndex + 1; index <= node.subtreeEndIndex; index += 1) {
    if (doc.bodies[index] !== null && taskReqDocParent(doc, index) === node.lineIndex) children.push(index);
  }
  return children;
}

function taskReqWriteLineIndent(text) {
  return text.slice(0, taskReqIndentLength(text));
}

// Physical lines joined back into the note, keeping its final-newline state.
function taskReqWriteJoin(contents, out) {
  return taskBlockRestoreFinalNewline(contents, out.join(""));
}

// `writers::drop_req`: drop a pending req. `[ ]` becomes `[-]` and the
// reason lands in a Cancel Log as the req's first child, written the way a
// task cancel writes it (`*YYYY-MM-DD* — reason`, newest first). An empty
// reason writes no log unless the req already keeps one; then it gets
// `*YYYY-MM-DD* — 🤷 no reason given`. The owner may already be closed.
// `date` is a `YYYY-MM-DD` string. Success: `{ok: true, updated,
// lineIndex, log: "none" | "created" | "prepended", descendants}`.
function taskReqDrop(contents, target, date, reason, options) {
  if (!TASK_REQ_WRITE_DATE_RE.test(String(date))) {
    throw new TypeError(`taskReqDrop needs a YYYY-MM-DD date, got ${String(date)}`);
  }
  const text = String(contents == null ? "" : contents);
  const resolved = taskReqOptions(options);
  const located = taskReqWriteLocate(text, target, resolved);
  if (located.ok === false) return located;
  const { node, forest } = located;
  if (node.state === "excluded") {
    return node.excludedBecause === "carried"
      ? taskReqWriteRefusal(
        "req_excluded",
        "Its parent requirement was carried into its own task — it goes with it",
      )
      : taskReqWriteRefusal("req_excluded", "Its parent requirement was dropped — restore it first");
  }
  if (node.mark === "dropped") return taskReqWriteRefusal("req_dropped", "Already dropped");
  if (node.mark === "carried") return taskReqWriteRefusal("req_carried", "Carried — open the linked task");
  if (node.mark === "legacy-met") return taskReqWriteRefusal("req_met", "Already met");

  const doc = taskReqDocument(text);
  const physical = taskBlockPhysicalLines(text);
  const ending = taskBlockDocumentLineEnding(text);
  const head = node.lineIndex;
  const dropped = taskReqWriteRewriteCheckbox(doc.texts[head], "-");
  if (dropped === null) return taskReqWriteRefusal("not_a_req", "Not a requirement");

  const children = taskReqWriteDirectChildren(doc, node);
  const log = children.find((index) => taskReqIsCancelLog(doc.texts[index]));
  const cleanReason = taskReqSplitWhitespace(String(reason == null ? "" : reason)).join(" ");
  let entry = null;
  if (cleanReason !== "") entry = cleanReason;
  else if (log !== undefined) entry = TASK_REQ_WRITE_NO_REASON_GIVEN;

  const unit = taskReqWriteNestingUnit(doc, head);
  const out = physical.slice();
  out[head] = taskReqWriteReplaceLineText(physical[head], dropped);
  let outcome = "none";
  if (log !== undefined && entry !== null) {
    const markerIndent = taskReqWriteLineIndent(doc.texts[log]);
    const next = doc.texts[log + 1];
    const entryIndent = next !== undefined && taskReqIndentLength(next) > markerIndent.length
      ? taskReqWriteLineIndent(next)
      : `${markerIndent}${unit}`;
    out[log] = taskBlockWithEnding(out[log], ending);
    out.splice(log + 1, 0, `${entryIndent}- *${date}* — ${entry}${ending}`);
    outcome = "prepended";
  } else if (entry !== null) {
    const headerIndent = children.length
      ? taskReqWriteLineIndent(doc.texts[children[0]])
      : `${taskReqWriteLineIndent(doc.texts[head])}${unit}`;
    const entryIndent = `${headerIndent}${unit}`;
    out[head] = taskBlockWithEnding(out[head], ending);
    out.splice(
      head + 1,
      0,
      `${headerIndent}- ${TASK_REQ_WRITE_CANCEL_LOG_MARKER}${ending}`,
      `${entryIndent}- *${date}* — ${entry}${ending}`,
    );
    outcome = "created";
  }
  return {
    ok: true,
    updated: taskReqWriteJoin(text, out),
    lineIndex: head,
    log: outcome,
    descendants: taskReqWriteDescendantCount(forest, node),
  };
}

// `writers::restore_req`: `[-]` becomes `[ ]` and the Cancel Log stays, the
// way reopening a task keeps its log. Success: `{ok: true, updated,
// lineIndex, log: "none", descendants}`.
function taskReqRestore(contents, target, options) {
  const text = String(contents == null ? "" : contents);
  const resolved = taskReqOptions(options);
  const located = taskReqWriteLocate(text, target, resolved);
  if (located.ok === false) return located;
  const { node, forest } = located;
  if (node.mark === "carried") return taskReqWriteRefusal("req_carried", "Carried — open the linked task");
  if (node.mark === "legacy-met") return taskReqWriteRefusal("req_met", "Already met");
  if (node.mark !== "dropped") {
    return taskReqWriteRefusal(
      "req_not_dropped",
      `Requirements are met when “${taskReqWriteOwnerText(text, node, resolved)}” closes — Ctrl+Enter on the task`,
    );
  }
  const doc = taskReqDocument(text);
  const physical = taskBlockPhysicalLines(text);
  const restored = taskReqWriteRewriteCheckbox(doc.texts[node.lineIndex], " ");
  if (restored === null) return taskReqWriteRefusal("not_a_req", "Not a requirement");
  const out = physical.slice();
  out[node.lineIndex] = taskReqWriteReplaceLineText(physical[node.lineIndex], restored);
  return {
    ok: true,
    updated: taskReqWriteJoin(text, out),
    lineIndex: node.lineIndex,
    log: "none",
    descendants: taskReqWriteDescendantCount(forest, node),
  };
}

// `writers::toggle_note_req`: Ctrl+] on a line.
//
// - Note to req. At depth 1 the line and its subtree move to the end of the
//   reqs zone, and the first req of a task runs the first-req scoop in the
//   same write. Deeper, the toggle happens in place. A note inside a drawer,
//   under another note, or under a managed line refuses (`req_in_drawer`,
//   `req_parent`).
// - Req to note. A leaf converts in place at depth 2 or more; at depth 1 the
//   line and its subtree move into `NOTES`. A req with descendant reqs
//   refuses: carry it or toggle them first.
//
// Success: `{ok: true, updated, lineIndex, direction: "note-to-req" |
// "req-to-note", depth, scooped, notesCreated, firstReq}`. `lineIndex` is the
// toggled item's head line after the write; `depth` is the req depth (after
// a note became a req, before a req became a note); `firstReq` (additive,
// not in bob-cli) is true when a note became its owner's first req.
function taskReqToggle(contents, target, options) {
  const text = String(contents == null ? "" : contents);
  const resolved = taskReqOptions(options);
  const stale = taskReqWriteStale(text, target);
  if (stale) return stale;
  const forest = taskReqForest(text, resolved);
  const node = forest.find((row) => row.lineIndex === target.lineIndex);
  return node
    ? taskReqWriteReqToNote(text, node, forest, resolved)
    : taskReqWriteNoteToReq(text, target, forest, resolved);
}

function taskReqWriteReqToNote(contents, node, forest, options) {
  if (node.mark === "dropped") return taskReqWriteRefusal("req_dropped", "Dropped — restore it first");
  if (node.mark === "carried") return taskReqWriteRefusal("req_carried", "Carried — open the linked task");
  const nested = taskReqWriteDescendantCount(forest, node);
  if (nested > 0) {
    return taskReqWriteRefusal(
      "req_has_nested",
      `“${node.text}” has ${nested} nested requirement${nested === 1 ? "" : "s"} — carry it or toggle them first`,
    );
  }
  const doc = taskReqDocument(contents);
  const physical = taskBlockPhysicalLines(contents);
  const note = taskReqWriteRewriteCheckbox(doc.texts[node.lineIndex], null);
  if (note === null) return taskReqWriteRefusal("not_a_req", "Not a requirement");
  const result = (updated, lineIndex, notesCreated) => ({
    ok: true,
    updated: taskBlockRestoreFinalNewline(contents, updated),
    lineIndex,
    direction: "req-to-note",
    depth: node.depth,
    scooped: 0,
    notesCreated,
    firstReq: false,
  });
  if (node.depth >= 2) {
    const out = physical.slice();
    out[node.lineIndex] = taskReqWriteReplaceLineText(physical[node.lineIndex], note);
    return result(out.join(""), node.lineIndex, false);
  }
  const { remaining, pulled } = taskBlockPullRanges(contents, [[node.lineIndex, node.subtreeEndIndex]]);
  pulled[0].lines[0] = taskReqWriteReplaceLineText(pulled[0].lines[0], note);
  const filed = taskBlockFileIntoNotes(remaining, node.ownerIndex, pulled, options);
  if (!filed) return taskReqWriteRefusal("not_a_task", "No task owns this requirement");
  return result(filed.updated, filed.firstLine, filed.created);
}

function taskReqWriteNoteToReq(contents, target, forest, options) {
  const doc = taskReqDocument(contents);
  const lineIndex = target.lineIndex;
  const text = doc.texts[lineIndex];
  const kind = taskBlockClassifyChild(text, true, options.globalFilter);
  const item = taskReqListItem(text);
  if (!item) return taskReqWriteRefusal("not_a_note", "Only a note can become a requirement");
  // A checkbox that is no req by structure is an ordinary checklist.
  if (kind.type === "requirement") return taskReqWriteParentRefusal();
  if (kind.type !== "authored") return taskReqWriteRefusal("not_a_note", "Only a note can become a requirement");

  const parent = taskReqDocParent(doc, lineIndex);
  if (parent === null) return taskReqWriteParentRefusal();
  let ownerLine;
  let depth;
  const parentTask = taskBlockFindTask(contents, parent, options);
  const parentReq = parentTask ? null : forest.find((row) => row.lineIndex === parent);
  if (parentTask) {
    ownerLine = parentTask.lineIndex;
    depth = 1;
  } else if (parentReq) {
    ownerLine = parentReq.ownerIndex;
    depth = parentReq.depth + 1;
  } else {
    const parentBody = doc.bodies[parent] === null ? "" : doc.bodies[parent];
    return taskReqIsDrawerTitle(taskReqTrim(parentBody))
      ? taskReqWriteRefusal("req_in_drawer", "Drawers hold notes — put the requirement directly under the task")
      : taskReqWriteParentRefusal();
  }
  if (depth > TASK_REQ_MAX_DEPTH) return taskReqWriteDepthRefusal();

  const converted = `${text.slice(0, item.bodyFrom)}[ ] ${item.body}`;
  const physical = taskBlockPhysicalLines(contents);
  if (depth >= 2) {
    const out = physical.slice();
    out[lineIndex] = taskReqWriteReplaceLineText(physical[lineIndex], converted);
    return {
      ok: true,
      updated: taskReqWriteJoin(contents, out),
      lineIndex,
      direction: "note-to-req",
      depth,
      scooped: 0,
      notesCreated: false,
      firstReq: false,
    };
  }

  // Depth 1: the note and its subtree move to the end of the reqs zone.
  const owner = taskBlockFindTask(contents, ownerLine, options);
  if (!owner) return taskReqWriteParentRefusal();
  const block = taskBlockReadIn(doc, owner, options.globalFilter);
  const hadReqs = taskBlockOwnsReqs(block);
  const child = block.children.find((entry) => entry.lineIndex === lineIndex);
  if (!child) return taskReqWriteParentRefusal();
  const { remaining, pulled } = taskBlockPullRanges(contents, [[child.lineIndex, taskBlockContentEnd(doc, child)]]);
  pulled[0].lines[0] = taskReqWriteReplaceLineText(pulled[0].lines[0], converted);
  const movedOwner = taskBlockFindTask(remaining, ownerLine, options);
  if (!movedOwner) return taskReqWriteParentRefusal();
  const slot = taskBlockInsertionSlot(remaining, movedOwner, "req", options);
  let updated = taskBlockInsertLines(remaining, slot.offset, taskBlockRebased(pulled[0], slot.indent));
  let scooped = 0;
  let notesCreated = false;
  if (!hadReqs) {
    const scoop = taskBlockScoopLooseNotes(updated, ownerLine, options);
    if (scoop) {
      scooped = scoop.filed;
      notesCreated = scoop.created;
      updated = scoop.updated;
    }
  }
  const last = taskReqWriteLastDepthOneReq(updated, ownerLine, options);
  return {
    ok: true,
    updated: taskBlockRestoreFinalNewline(contents, updated),
    lineIndex: last === null ? slot.lineIndex : last,
    direction: "note-to-req",
    depth,
    scooped,
    notesCreated,
    firstReq: !hadReqs,
  };
}

// `writers::last_depth_one_req`: where a req inserted at the end of the reqs
// zone ends up, whatever the first-req scoop moved around it.
function taskReqWriteLastDepthOneReq(contents, ownerLine, options) {
  let last = null;
  for (const row of taskReqForest(contents, options)) {
    if (row.ownerIndex === ownerLine && row.depth === 1 && (last === null || row.lineIndex > last)) last = row.lineIndex;
  }
  return last;
}

// `writers::insert_reqs`: insert req blocks at the end of the task's reqs
// zone. Each block is the text of one depth-1 req and everything nested
// under it, with relative indentation: its first line is an open
// `- [ ] text` with no indent, and the task's child indentation is added to
// every line. A task that owned no req before runs the first-req scoop in
// the same write: its loose direct notes move into `NOTES`, which is created
// only when at least one note moves (`notes_drawer_birth =
// with_first_note`). `target` names the task line. Success: `{ok: true,
// updated, firstLine, lineCount, scooped, notesCreated}`.
function taskReqInsert(contents, target, blocks, options) {
  const text = String(contents == null ? "" : contents);
  const resolved = taskReqOptions(options);
  const stale = taskReqWriteStale(text, target);
  if (stale) return stale;
  const task = taskBlockFindTask(text, target.lineIndex, resolved);
  if (!task) return taskReqWriteRefusal("not_a_task", "This line is not a task");
  const list = Array.isArray(blocks) ? blocks.map((block) => String(block)) : [];
  if (!list.length) return taskReqWriteRefusal("req_empty", "Nothing to insert");
  for (const block of list) {
    let first = block.split("\n")[0];
    if (first.endsWith("\r")) first = first.slice(0, -1);
    const open = first[0] !== " " && first[0] !== "\t"
      && taskReqCheckboxMarkWithoutFilter(first, resolved.globalFilter) === "open";
    if (!open) return taskReqWriteRefusal("req_state", "Requirements start open — they're met when the task closes");
  }

  const doc = taskReqDocument(text);
  const hadReqs = taskBlockOwnsReqs(taskBlockReadIn(doc, task, resolved.globalFilter));
  const slot = taskBlockInsertionSlotIn(doc, task, "req", resolved);
  const lines = list
    .flatMap((block) => block.split("\n"))
    .map((line) => (taskReqIsBlank(line) ? "" : `${slot.indent}${line}`));
  let updated = taskBlockInsertLines(text, slot.offset, lines);
  let scooped = 0;
  let notesCreated = false;
  if (!hadReqs) {
    const scoop = taskBlockScoopLooseNotes(updated, task.lineIndex, resolved);
    if (scoop) {
      scooped = scoop.filed;
      notesCreated = scoop.created;
      updated = scoop.updated;
    }
  }
  const forest = taskReqForest(updated, resolved);
  if (forest.some((row) => row.ownerIndex === task.lineIndex && row.depth_exceeded)) return taskReqWriteDepthRefusal();
  const ownedBefore = taskReqForest(text, resolved)
    .filter((row) => row.ownerIndex === task.lineIndex).length;
  const ownedAfter = forest
    .filter((row) => row.ownerIndex === task.lineIndex).length;
  const topLevel = forest
    .filter((row) => row.ownerIndex === task.lineIndex && row.depth === 1)
    .map((row) => row.lineIndex)
    .sort((left, right) => left - right);
  const from = topLevel.length - list.length;
  return {
    ok: true,
    updated: taskBlockRestoreFinalNewline(text, updated),
    firstLine: from >= 0 && from < topLevel.length ? topLevel[from] : slot.lineIndex,
    lineCount: lines.length,
    added: Math.max(0, ownedAfter - ownedBefore),
    scooped,
    notesCreated,
  };
}
