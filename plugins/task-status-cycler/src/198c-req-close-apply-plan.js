// Requirement close-card apply planner (RV writes): carry/drop bytes, receipts,
// created-task identities, and descendant moves. Twin of bob-cli
// `src/native/task_complete/req_writes.rs` against the copied RV20–RV28
// vectors. Pure: injected `planCarryReq` is the navigation carry planner
// (`taskSplitPlanCarryReq`); drops use the existing RW twin. Met writes
// nothing. Live persistence lives in `198d-req-close-apply.js`.

const REQ_CLOSE_WRITE_TRIM_END_RE =
  /[ \t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/;

function reqCloseWriteRefusal(code, message, extra) {
  return Object.assign({ ok: false, code, message: String(message || "") }, extra || {});
}

function reqCloseWriteStale(selectors) {
  const list = Array.isArray(selectors) ? selectors.filter(Boolean).map((entry) => String(entry)) : [];
  return reqCloseWriteRefusal(
    "req_close_stale",
    list.length ? `stale requirement pick: ${list.join(", ")}` : "stale requirement pick",
    { selectors: list },
  );
}

function reqCloseWriteCoerceNotes(value) {
  const out = new Map();
  if (value instanceof Map) {
    for (const [path, text] of value) {
      if (typeof path === "string" && path && typeof text === "string") out.set(path, text);
    }
    return out;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [path, text] of Object.entries(value)) {
      if (typeof path === "string" && path && typeof text === "string") out.set(path, text);
    }
  }
  return out;
}

function reqCloseWriteFilesObject(notes) {
  const files = {};
  for (const [path, text] of notes) files[path] = text;
  return files;
}

function reqCloseWriteRowSuffix(fullKey) {
  const text = String(fullKey == null ? "" : fullKey);
  const index = text.indexOf("/req/");
  return index >= 0 ? text.slice(index + 5) : text;
}

function reqCloseWriteLineDigest(line, sha256Hex) {
  const trimmed = String(line == null ? "" : line).replace(REQ_CLOSE_WRITE_TRIM_END_RE, "");
  return String(reqCloseNeedHash(sha256Hex)(trimmed)).slice(0, 8);
}

function reqCloseWriteStillOpen(node) {
  const mark = node && node.mark;
  const state = node && node.state;
  return (mark === "open" || mark === "unknown") && (state === "pending" || state === "met");
}

function reqCloseWriteOwnerTask(contents, frozenOwner) {
  const tasks = taskReqNoteTasks(contents);
  if (frozenOwner && frozenOwner.block_id) {
    return tasks.find((task) => task.blockId === frozenOwner.block_id) || null;
  }
  const wanted = frozenOwner && frozenOwner.text;
  const matches = tasks.filter((task) => task.description === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function reqCloseWriteOwnerMatch(contents, frozenOwner, node) {
  const task = taskReqNoteTasks(contents).find((entry) => entry.lineIndex === node.ownerIndex);
  if (!task) return false;
  if (frozenOwner && frozenOwner.block_id) return task.blockId === frozenOwner.block_id;
  return task.description === (frozenOwner && frozenOwner.text);
}

function reqCloseWriteOwnerBlock(contents, frozenOwner) {
  const task = reqCloseWriteOwnerTask(contents, frozenOwner);
  return task ? reqCloseOwnerBlockPreimage(contents, task) : null;
}

function reqCloseWriteFindPending(contents, frozenOwner, fullKey, path, depth, text, sha256Hex) {
  const wanted = reqCloseWriteRowSuffix(fullKey);
  const digest8 = reqCloseDigest8(sha256Hex);
  const matches = taskReqForest(contents).filter((node) => (
    reqCloseWriteStillOpen(node)
    && node.text === text
    && node.depth === depth
    && taskReqPathText(node) === path
    && reqCloseWriteRowSuffix(taskReqRowKey("", node, digest8)) === wanted
    && reqCloseWriteOwnerMatch(contents, frozenOwner, node)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function reqCloseWriteLineText(contents, lineIndex) {
  const spans = taskReqLineSpans(contents);
  return spans[lineIndex] ? spans[lineIndex].text : "";
}

function composeReqCloseRestores(entries) {
  const byPath = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.path !== "string" || !entry.path) continue;
    const path = entry.path;
    const before = typeof entry.before === "string" ? entry.before : "";
    const after = typeof entry.after === "string" ? entry.after : "";
    const created = entry.created === true;
    const previous = byPath.get(path);
    if (!previous) {
      byPath.set(path, { path, before, after, created });
      continue;
    }
    previous.after = after;
    if (created) previous.created = true;
  }
  return [...byPath.values()];
}

function reqCloseWriteMetReceipts(owners, verdicts) {
  const covered = new Map();
  for (const resolved of verdicts || []) {
    if (!reqCloseTakesBranch(resolved.verdict)) continue;
    const key = resolved.row.owner_key;
    const extra = 1 + (Number(resolved.row.pending_descendants) || 0);
    covered.set(key, (covered.get(key) || 0) + extra);
  }
  const met = [];
  for (const owner of owners || []) {
    const pending = reqClosePendingCount(owner);
    const taken = covered.get(owner.key) || 0;
    const count = Math.max(0, pending - taken);
    if (count === 0) continue;
    met.push({
      owner_task_key: owner.task_key,
      owner_key: owner.key,
      count,
      receipt: reqCloseMetReceipt(count, owner.text),
    });
  }
  return met;
}

function reqCloseWriteSortBottomToTop(left, right) {
  const pathCmp = String(right.row.owner_path).localeCompare(String(left.row.owner_path));
  if (pathCmp !== 0) return pathCmp;
  return (Number(right.row.line) || 0) - (Number(left.row.line) || 0);
}

function reqCloseWritePreflightExpected(notes, owners, verdicts, expectedNotes, expectedOwnerPostimages) {
  const expectedFiles = reqCloseWriteCoerceNotes(expectedNotes);
  if (expectedFiles.size > 0) {
    for (const [path, expected] of expectedFiles) {
      const live = notes.get(path);
      if (live !== expected) return reqCloseWriteStale([path]);
    }
  }
  if (!expectedOwnerPostimages || typeof expectedOwnerPostimages !== "object") return { ok: true };
  const blocks = expectedOwnerPostimages instanceof Map
    ? expectedOwnerPostimages
    : new Map(Object.entries(expectedOwnerPostimages));
  const needed = new Set();
  for (const resolved of verdicts) needed.add(resolved.row.owner_key);
  for (const owner of owners) {
    if (!needed.has(owner.key) || !blocks.has(owner.key)) continue;
    const live = notes.get(owner.path);
    if (typeof live !== "string") return reqCloseWriteStale([owner.key]);
    const block = reqCloseWriteOwnerBlock(live, owner);
    if (block !== blocks.get(owner.key)) return reqCloseWriteStale([owner.key]);
  }
  return { ok: true };
}

function reqCloseWriteHasCarryPulled(verdicts) {
  return (verdicts || []).some((entry) => entry.verdict === "carry_pulled");
}

function reqCloseWriteHasCarry(verdicts) {
  return (verdicts || []).some((entry) => entry.verdict === "carry" || entry.verdict === "carry_pulled");
}

function reqCloseWriteDiffPostimages(before, after) {
  const postimages = {};
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const path of keys) {
    const previous = before.get(path);
    const next = after.get(path);
    if (typeof next === "string" && previous !== next) postimages[path] = next;
  }
  return postimages;
}

function reqCloseWriteRepairCarried(working, pending) {
  for (const carry of pending) {
    const finalText = working.get(carry.destPath);
    if (typeof finalText !== "string") continue;
    const tasks = taskReqNoteTasks(finalText);
    const task = tasks.find((entry) => entry.blockId === carry.blockId);
    if (!task) continue;
    const finalLine = task.lineIndex + 1;
    const delta = finalLine - carry.intermediateLine;
    if (delta === 0) continue;
    const outcome = carry.outcome;
    if (outcome.carried) {
      outcome.carried.line = Math.max(1, outcome.carried.line + delta);
    }
    for (const lineMove of outcome.moves) {
      lineMove.to = Math.max(1, lineMove.to + delta);
    }
  }
}

// Plan every structural requirement verdict. `notes` is the current live
// snapshot (usually post-close). `owners` is the frozen pre-close forest.
// `planCarryReq(files, args)` must be the pure navigation carry planner.
function planReqCloseWrites(options) {
  const input = options && typeof options === "object" ? options : {};
  const sha256Hex = input.sha256Hex;
  const notes = reqCloseWriteCoerceNotes(input.notes);
  const owners = Array.isArray(input.owners) ? input.owners : [];
  const requests = Array.isArray(input.requests) ? input.requests : [];
  const today = typeof input.today === "string" && input.today ? input.today : "";
  const date = typeof input.date === "string" && input.date ? input.date : today;
  const planCarryReq = input.planCarryReq;
  const pullInPreflight = input.pullInPreflight;
  const inboxRoute = typeof input.inboxRoute === "string" && input.inboxRoute
    ? input.inboxRoute
    : "inbox.md";

  const selection = reqCloseResolveVerdicts(
    owners,
    input.taskOfferKeys || [],
    requests,
    input.jumpSelector,
    sha256Hex,
  );
  if (!selection.ok) return selection;

  const verdicts = selection.verdicts || [];
  if (reqCloseWriteHasCarryPulled(verdicts) && typeof pullInPreflight !== "function") {
    return reqCloseWriteRefusal(
      "req_pull_in_unavailable",
      "Carry plus pull-in needs a destination preflight before any write",
    );
  }
  if (reqCloseWriteHasCarry(verdicts) && typeof planCarryReq !== "function") {
    return reqCloseWriteRefusal("split_unavailable", "Task split is unavailable");
  }
  if (typeof pullInPreflight === "function" && reqCloseWriteHasCarryPulled(verdicts)) {
    const preview = pullInPreflight({ owners, verdicts, notes: reqCloseWriteFilesObject(notes) });
    if (preview && preview.ok === false) {
      return reqCloseWriteRefusal(
        preview.code || "req_pull_in_unavailable",
        preview.message || "Carry plus pull-in destination preflight refused",
      );
    }
  }

  const expected = reqCloseWritePreflightExpected(
    notes,
    owners,
    verdicts,
    input.expectedNotes,
    input.expectedOwnerPostimages,
  );
  if (!expected.ok) return expected;

  const frozenByKey = new Map(owners.map((owner) => [owner.key, owner]));
  const carries = verdicts
    .filter((entry) => entry.verdict === "carry" || entry.verdict === "carry_pulled")
    .slice()
    .sort(reqCloseWriteSortBottomToTop);
  const drops = verdicts
    .filter((entry) => entry.verdict === "drop")
    .slice()
    .sort(reqCloseWriteSortBottomToTop);

  const original = new Map(notes);
  const working = new Map(notes);
  const outcomes = [];
  const pending = [];
  const restoreEntries = [];

  for (const resolved of carries) {
    const frozen = frozenByKey.get(resolved.row.owner_key);
    if (!frozen) return reqCloseWriteStale([resolved.row.key]);
    const ownerPath = resolved.row.owner_path;
    const current = working.get(ownerPath);
    if (typeof current !== "string") return reqCloseWriteStale([resolved.row.key]);
    const node = reqCloseWriteFindPending(
      current,
      frozen,
      resolved.row.key,
      resolved.row.path,
      resolved.row.depth,
      resolved.row.text,
      sha256Hex,
    );
    if (!node) return reqCloseWriteStale([resolved.row.key]);
    const expectedLine = reqCloseWriteLineDigest(reqCloseWriteLineText(current, node.lineIndex), sha256Hex);
    const expectedOwnerPreimage = reqCloseWriteOwnerBlock(current, frozen);
    const planned = planCarryReq(reqCloseWriteFilesObject(working), {
      notePath: ownerPath,
      line: node.line,
      expectedLine,
      expectedOwnerPreimage,
      today,
      settings: {
        linked_from_mentions: true,
        linked_from_lines: true,
        inbox_route: inboxRoute,
      },
    });
    if (!planned || planned.ok !== true) {
      return reqCloseWriteRefusal(
        (planned && planned.code) || "split_unavailable",
        (planned && planned.message) || "Task split is unavailable",
      );
    }
    const postimages = (planned.plan && planned.plan.files) || planned.files || {};
    for (const [path, after] of Object.entries(postimages)) {
      const before = working.has(path) ? working.get(path) : "";
      const created = !original.has(path) && !working.has(path);
      restoreEntries.push({
        path,
        before: original.has(path) ? original.get(path) : before,
        after: String(after),
        created: created || (!original.has(path) && before === ""),
      });
      working.set(path, String(after));
    }
    const task = planned.task || {};
    const moveMap = planned.moveMap || {};
    const pulled = resolved.verdict === "carry_pulled";
    const outcome = {
      owner_task_key: resolved.row.owner_task_key,
      owner_key: resolved.row.owner_key,
      row_key: resolved.row.key,
      path: resolved.row.path,
      depth: resolved.row.depth,
      text: resolved.row.text,
      verdict: resolved.verdict,
      reason: null,
      pulled,
      receipt: reqCloseCarryReceipt(resolved.row.text, pulled),
      carried: {
        path: String(task.path || ""),
        line: Number(task.line) || 0,
        block_id: String(task.blockId || task.block_id || ""),
      },
      moves: Array.isArray(moveMap.moves)
        ? moveMap.moves.map((entry) => ({ from: Number(entry.from) || 0, to: Number(entry.to) || 0 }))
        : [],
      source_line: node.line,
    };
    outcomes.push(outcome);
    pending.push({
      outcome,
      destPath: String(task.path || ownerPath),
      intermediateLine: Number(task.line) || 0,
      blockId: String(task.blockId || task.block_id || ""),
    });
  }

  for (const resolved of drops) {
    const frozen = frozenByKey.get(resolved.row.owner_key);
    if (!frozen) return reqCloseWriteStale([resolved.row.key]);
    const ownerPath = resolved.row.owner_path;
    const current = working.get(ownerPath);
    if (typeof current !== "string") return reqCloseWriteStale([resolved.row.key]);
    const node = reqCloseWriteFindPending(
      current,
      frozen,
      resolved.row.key,
      resolved.row.path,
      resolved.row.depth,
      resolved.row.text,
      sha256Hex,
    );
    if (!node) return reqCloseWriteStale([resolved.row.key]);
    const preimage = reqCloseWriteLineText(current, node.lineIndex);
    const written = taskReqDrop(
      current,
      { lineIndex: node.lineIndex, preimage },
      date,
      resolved.reason || "",
    );
    if (!written || written.ok !== true) {
      return reqCloseWriteRefusal(
        (written && written.code) || "req_close_stale",
        (written && written.message) || "The line changed — try again",
      );
    }
    restoreEntries.push({
      path: ownerPath,
      before: original.has(ownerPath) ? original.get(ownerPath) : current,
      after: written.updated,
      created: false,
    });
    working.set(ownerPath, written.updated);
    const reason = reqCloseNormalizeReason(resolved.reason);
    outcomes.push({
      owner_task_key: resolved.row.owner_task_key,
      owner_key: resolved.row.owner_key,
      row_key: resolved.row.key,
      path: resolved.row.path,
      depth: resolved.row.depth,
      text: resolved.row.text,
      verdict: "drop",
      reason,
      pulled: false,
      receipt: reqCloseDropReceipt(resolved.row.text, reason),
      carried: null,
      moves: [],
      source_line: node.line,
    });
  }

  reqCloseWriteRepairCarried(working, pending);
  const met = reqCloseWriteMetReceipts(owners, verdicts);
  const postimages = reqCloseWriteDiffPostimages(original, working);
  const restores = composeReqCloseRestores(restoreEntries.map((entry) => {
    const after = working.has(entry.path) ? working.get(entry.path) : entry.after;
    return {
      path: entry.path,
      before: original.has(entry.path) ? original.get(entry.path) : "",
      after,
      created: !original.has(entry.path),
    };
  }));

  return {
    ok: true,
    req_outcomes: outcomes,
    outcomes,
    met,
    postimages,
    restores,
    notes: reqCloseWriteFilesObject(working),
    jump: selection.jump || null,
  };
}
