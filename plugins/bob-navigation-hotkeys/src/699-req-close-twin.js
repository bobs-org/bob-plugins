// --- Requirement close-card twin (RV rows): snapshots, groups, and copy ------
// Twin of bob-cli `src/native/task_complete/req_close.rs`
// (`docs/task-requirements.md` §7). Rust is the authority; the shared RV
// vectors in `scripts/fixtures/req_close/` are copied byte for byte from
// bob-cli. Plugin-agnostic and copied byte for byte; update bob-cli first,
// then this file, then its copies. Reads the RQ twin.
//
// Collection binds each successful non-recurring closing owner to the exact
// pre-close owner-block bytes. Groups list only Pending rows. SHA-256 is
// injected (`sha256Hex(text) -> hex`) so this fragment stays pure.

const REQ_CLOSE_COPY = Object.freeze({
  WHY: "Met when it closes, unless you say otherwise",
  DROP_PROMPT: "Why drop it? (optional)",
  FOOTER: "⌃X met · ⌃⇧X drop · ⌃⇧T own task · space pull in · ⌃J jump",
  JUMP_HINT: "↗ jumps to the requirement — ⌃⇧T makes it a task",
  HINT: "-k N own task · -X N[=why] drop · -p N pull in",
  TEACHING: "Met when this task closes. Drop it or make it a task if the scope changes.",
});

function reqCloseQuoted(text) {
  return `“${text}”`;
}

function reqCloseGroupTitle(ownerText) {
  return `Requirements · ${reqCloseQuoted(ownerText)}`;
}

function reqCloseScope(pending, branches) {
  if (branches > 1) return `${pending} requirements in ${branches} branches`;
  return pending === 1 ? "1 requirement" : `${pending} requirements`;
}

function reqCloseHistory(dropped, carried, met) {
  const parts = [];
  if (dropped > 0) parts.push(`${dropped} dropped earlier`);
  if (carried > 0) parts.push(`${carried} carried earlier`);
  if (met > 0) parts.push(`${met} met earlier`);
  return parts.length ? `· ${parts.join(" · ")}` : null;
}

function reqCloseOverlap(ancestor) {
  return `${reqCloseQuoted(ancestor)} already takes this branch — restage it as met to choose here`;
}

function reqCloseNestedGoWithIt(count) {
  return `· ${count} nested go with it`;
}

function reqCloseMetReceipt(count, ownerText) {
  return `✓ ${count} requirements met with ${reqCloseQuoted(ownerText)}`;
}

function reqCloseHumanMetLine(count, ownerText) {
  return reqCloseMetReceipt(count, ownerText);
}

function reqCloseDropReceipt(text, reason) {
  let line = `⊘ Dropped ${reqCloseQuoted(text)}`;
  if (reason) line += ` · ${reqCloseQuoted(reason)}`;
  return line;
}

function reqCloseCarryReceipt(text, pulled) {
  let line = `→ ${reqCloseQuoted(text)} is its own task now`;
  if (pulled) line += " · pulled in";
  return line;
}

function reqCloseSummary(met, dropped, carried) {
  return `reqs ✓${met} ⊘${dropped} →${carried}`;
}

function reqCloseAccessibility(depth, verb) {
  return `requirement, level ${depth}, ${verb}`;
}

function reqCloseWouldMet(count, ownerText) {
  return `would meet ${count} requirements with ${reqCloseQuoted(ownerText)}`;
}

function reqCloseConsequences(text) {
  return {
    met: REQ_CLOSE_COPY.WHY,
    drop: reqCloseDropReceipt(text, null),
    carry: reqCloseCarryReceipt(text, false),
    carry_pulled: reqCloseCarryReceipt(text, true),
  };
}

function reqCloseNeedHash(sha256Hex) {
  if (typeof sha256Hex !== "function") {
    throw new Error("reqClose twins need sha256Hex(text) -> hex");
  }
  return sha256Hex;
}

function reqCloseDigest8(sha256Hex) {
  const hash = reqCloseNeedHash(sha256Hex);
  return (text) => String(hash(text)).slice(0, 8);
}

function reqCloseNotePath(relativePath) {
  return String(relativePath || "")
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".")
    .join("/");
}

function reqCloseIsRecurringTaskLine(line) {
  const text = String(line == null ? "" : line);
  return text.includes("[repeat::") || text.includes("(repeat::") || text.includes("🔁");
}

function reqCloseStableTaskKey(relativePath, blockId, description, globalFilter, digestOrdinal, sha256Hex) {
  const path = reqCloseNotePath(relativePath);
  if (blockId) return `${path}#^${blockId}`;
  const cleaned = taskReqCleanDescription(description, globalFilter === undefined ? TASK_REQ_GLOBAL_FILTER : globalFilter, null);
  const hex = String(reqCloseNeedHash(sha256Hex)(cleaned));
  const ordinal = digestOrdinal == null ? 1 : digestOrdinal;
  return ordinal >= 2 ? `${path}@${hex.slice(0, 8)}~${ordinal}` : `${path}@${hex.slice(0, 8)}`;
}

function reqCloseOwnerSnapshotKey(taskKey, preimage, sha256Hex) {
  return `${taskKey}@${reqCloseNeedHash(sha256Hex)(preimage)}`;
}

function reqCloseOwnerBlockPreimage(contents, task) {
  const text = String(contents == null ? "" : contents);
  const spans = taskReqLineSpans(text);
  const start = task.lineIndex <= 0
    ? 0
    : (spans[task.lineIndex - 1] ? spans[task.lineIndex - 1].end : 0);
  const end = Math.min(task.blockEnd, text.length);
  if (start >= end || start > text.length) return "";
  return text.slice(start, end);
}

function reqCloseDigestOrdinal(contents, task, options) {
  if (task.blockId) return 1;
  const scan = taskReqNoteTasks(contents, options);
  let ordinal = 0;
  for (const other of scan) {
    if (other.blockId) continue;
    if (other.description === task.description) ordinal += 1;
    if (other.lineIndex === task.lineIndex) break;
  }
  return Math.max(ordinal, 1);
}

function reqClosePendingDescendantCount(forest, node) {
  return forest.filter((other) => (
    other.lineIndex > node.lineIndex
    && other.lineIndex <= node.subtreeEndIndex
    && other.ownerIndex === node.ownerIndex
    && other.state === "pending"
  )).length;
}

function reqCloseFindTask(tasks, spec) {
  if (spec && spec.block_id) {
    return tasks.find((task) => task.blockId === spec.block_id) || null;
  }
  if (spec && spec.line != null) {
    const lineIndex = Number(spec.line) - 1;
    return tasks.find((task) => task.lineIndex === lineIndex) || null;
  }
  return null;
}

function reqCloseHistoryFolds(nodes) {
  const folds = { dropped: 0, carried: 0, met: 0 };
  for (const node of nodes) {
    if (node.state === "dropped") folds.dropped += 1;
    else if (node.state === "carried") folds.carried += 1;
    else if (node.state === "met") folds.met += 1;
  }
  return folds;
}

function reqClosePendingCount(owner) {
  return owner.nodes.filter((node) => node.state === "pending").length;
}

function reqClosePendingBranches(owner) {
  return owner.nodes.filter((node) => node.state === "pending" && node.depth === 1).length;
}

function reqCloseOwnerView(owner) {
  return {
    task_key: owner.task_key,
    key: owner.key,
    path: owner.path,
    block_id: owner.block_id,
    line: owner.line,
    text: owner.text,
  };
}

function reqCloseOwnerGroup(owner) {
  const pending = owner.nodes.filter((node) => node.state === "pending");
  if (!pending.length) return null;
  const folds = reqCloseHistoryFolds(owner.nodes);
  return {
    group: "requirements",
    kind: "requirements",
    owner: reqCloseOwnerView(owner),
    copy: {
      title: reqCloseGroupTitle(owner.text),
      scope: reqCloseScope(pending.length, reqClosePendingBranches(owner)),
      why: REQ_CLOSE_COPY.WHY,
      history: reqCloseHistory(folds.dropped, folds.carried, folds.met),
      glyph: "requirement",
      footer: REQ_CLOSE_COPY.FOOTER,
      hint: REQ_CLOSE_COPY.HINT,
    },
    folded: folds,
    rows: pending.map((node) => {
      const run = taskReqGlyph(node.state);
      const accessibility = reqCloseAccessibility(node.depth, "will be met");
      return {
        offer: {
          key: node.key,
          n: 0,
          group: "requirements",
          selected: false,
        },
        req: {
          owner: owner.key,
          path: node.path,
          depth: node.depth,
          parent_key: node.parent_key,
          text: node.text,
          line: node.line,
          state: node.state,
          pending_descendants: node.pending_descendants,
          depth_exceeded: node.depth_exceeded,
          run,
          accessibility,
        },
        // Keep the Cycler's local flat view for its write planner and audit
        // vectors; `req` is the canonical v6 navigation API payload.
        owner_key: owner.key,
        path: node.path,
        depth: node.depth,
        parent_key: node.parent_key,
        text: node.text,
        line: node.line,
        state: node.state,
        pending_descendants: node.pending_descendants,
        depth_exceeded: node.depth_exceeded,
        run,
        accessibility,
        consequences: reqCloseConsequences(node.text),
      };
    }),
  };
}

function reqCloseGroupsFromOwners(owners) {
  return (owners || []).map(reqCloseOwnerGroup).filter(Boolean);
}

function reqCloseCollectOwner(contents, relativePath, task, sha256Hex, options) {
  const text = String(contents == null ? "" : contents);
  const resolved = taskReqOptions(options);
  const spans = taskReqLineSpans(text);
  const taskLine = spans[task.lineIndex] ? spans[task.lineIndex].text : String(task.description || "");
  if (reqCloseIsRecurringTaskLine(taskLine)) return null;
  const scan = taskReqNoteTasks(text, resolved);
  const owned = scan.find((row) => row.lineIndex === task.lineIndex) || task;
  const preimage = reqCloseOwnerBlockPreimage(text, owned);
  const ordinal = reqCloseDigestOrdinal(text, owned, resolved);
  const taskKey = reqCloseStableTaskKey(
    relativePath,
    owned.blockId,
    owned.description,
    resolved.globalFilter,
    ordinal,
    sha256Hex,
  );
  const key = reqCloseOwnerSnapshotKey(taskKey, preimage, sha256Hex);
  const forest = taskReqForestForOwner(text, owned.lineIndex, resolved);
  const digest8 = reqCloseDigest8(sha256Hex);
  const keysByLine = new Map();
  for (const node of forest) {
    keysByLine.set(node.lineIndex, taskReqRowKey(key, node, digest8));
  }
  let depthExceeded = false;
  const nodes = forest.map((node) => {
    if (node.depth_exceeded || node.depth > TASK_REQ_MAX_DEPTH) depthExceeded = true;
    const parentKey = node.parentIndex == null ? null : (keysByLine.get(node.parentIndex) || null);
    return {
      key: keysByLine.get(node.lineIndex) || taskReqRowKey(key, node, digest8),
      path: taskReqPathText(node),
      depth: node.depth,
      parent_key: parentKey,
      text: node.text,
      line: node.lineIndex + 1,
      state: node.state,
      mark: node.mark,
      pending_descendants: reqClosePendingDescendantCount(forest, node),
      depth_exceeded: Boolean(node.depth_exceeded),
    };
  });
  return {
    task_key: taskKey,
    key,
    path: reqCloseNotePath(relativePath),
    block_id: owned.blockId || "",
    line: owned.lineIndex + 1,
    text: owned.description,
    preimage,
    task_line: taskLine,
    depth_exceeded: depthExceeded,
    nodes,
  };
}

function reqCloseCollectOwners(notes, sha256Hex, options) {
  const owners = [];
  for (const note of notes || []) {
    const ending = note.eol === "crlf" ? "\r\n" : "\n";
    const contents = `${(note.source_lines || []).join(ending)}${ending}`;
    const tasks = taskReqNoteTasks(contents, options);
    for (const spec of note.closing || []) {
      const task = reqCloseFindTask(tasks, spec);
      if (!task) continue;
      const owner = reqCloseCollectOwner(contents, note.path, task, sha256Hex, options);
      if (owner) owners.push(owner);
    }
  }
  return owners;
}
