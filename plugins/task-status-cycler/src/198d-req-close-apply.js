// Requirement close-card apply service: persist planned carry/drop verdicts
// through `api.taskSplit.carryReq` and the RW twin. Best-effort Obsidian
// writes: surface actual failures, never report an unapplied structural
// choice as successful, and never delete the only surviving copy after a
// partial write. One composed restore list (earliest before → final after)
// feeds the navigation guarded Undo adapter. Managed Done call sites stay
// with `close_wiring`.

function reqCloseWriteDefaultSha256(text) {
  try {
    if (typeof require === "function") {
      const crypto = require("crypto");
      if (crypto && typeof crypto.createHash === "function") {
        return crypto.createHash("sha256").update(String(text == null ? "" : text), "utf8").digest("hex");
      }
    }
  } catch (_error) {}
  throw new Error("reqClose twins need sha256Hex(text) -> hex");
}

function reqCloseWriteTaskSplitApi(plugin) {
  try {
    const holder = plugin && plugin.app && plugin.app.plugins && plugin.app.plugins.plugins;
    const nav = holder && holder["bob-navigation-hotkeys"];
    const api = nav && nav.api && nav.api.taskSplit;
    if (api && Number(api.version) >= 1 && typeof api.carryReq === "function") return api;
  } catch (_error) {}
  return null;
}

function reqCloseWriteOutcomeJson(outcome) {
  if (!outcome) return null;
  return {
    row_key: outcome.row_key,
    verdict: outcome.verdict,
    receipt: outcome.receipt,
    carried: outcome.carried
      ? {
        path: outcome.carried.path,
        line: outcome.carried.line,
        block_id: outcome.carried.block_id,
      }
      : null,
    moves: Array.isArray(outcome.moves) ? outcome.moves.map((entry) => ({ from: entry.from, to: entry.to })) : [],
  };
}

async function reqCloseWriteReadNote(plugin, path, context, cache) {
  if (cache instanceof Map && cache.has(path)) return cache.get(path);
  if (typeof plugin.readSuccessorNoteText === "function") {
    try {
      const live = await plugin.readSuccessorNoteText(path, context || {}, cache instanceof Map ? cache : new Map());
      if (typeof live === "string") return live;
    } catch (_error) {}
  }
  const editors = typeof plugin.getOpenMarkdownEditors === "function"
    ? plugin.getOpenMarkdownEditors(context || {})
    : new Map();
  const editor = editors instanceof Map ? editors.get(path) : null;
  if (editor && typeof editor.getValue === "function") {
    try {
      return String(editor.getValue() || "");
    } catch (_error) {}
  }
  const vault = plugin && plugin.app && plugin.app.vault;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
  const file = vault.getAbstractFileByPath(path);
  if (!file) return null;
  try {
    if (typeof vault.cachedRead === "function") return String((await vault.cachedRead(file)) || "");
    if (typeof vault.read === "function") return String((await vault.read(file)) || "");
  } catch (_error) {}
  return null;
}

async function reqCloseWritePersistDrop(plugin, path, before, after, context) {
  if (before === after) return { ok: true };
  if (typeof writeOfferCloseNoteText === "function") {
    return writeOfferCloseNoteText(plugin, path, before, after, context || {});
  }
  return { ok: false, reason: "note cannot be updated safely" };
}

class TaskStatusCyclerReqCloseApplyMixin {
  // Apply validated requirement verdicts. Callers supply frozen pre-close
  // `owners`, the current live `notes` (post-close expected bytes), and
  // `requests`. Carry uses `api.taskSplit.carryReq` when present and never
  // falls back to ordinary split. Carry-plus-pull-in refuses until
  // `pullInPreflight` is supplied (`req_delivery`).
  async applyReqCloseWrites(options = {}) {
    const input = options && typeof options === "object" ? options : {};
    const sha256Hex = typeof input.sha256Hex === "function" ? input.sha256Hex : reqCloseWriteDefaultSha256;
    const provided = reqCloseWriteCoerceNotes(input.notes);
    const owners = Array.isArray(input.owners) ? input.owners : [];
    const requests = Array.isArray(input.requests) ? input.requests : [];
    const today = typeof input.today === "string" && input.today ? input.today : formatLocalDate();
    const date = typeof input.date === "string" && input.date ? input.date : today;
    const context = input.context && typeof input.context === "object" ? input.context : {};
    const cache = input.cache instanceof Map ? input.cache : new Map();
    const planCarryReq = typeof input.planCarryReq === "function" ? input.planCarryReq : null;
    const pullInPreflight = typeof input.pullInPreflight === "function" ? input.pullInPreflight : null;
    const taskSplit = input.taskSplit || reqCloseWriteTaskSplitApi(this);
    const carryReq = typeof input.carryReq === "function"
      ? input.carryReq
      : (taskSplit && typeof taskSplit.carryReq === "function" ? taskSplit.carryReq.bind(taskSplit) : null);

    const liveNotes = new Map(provided);
    for (const owner of owners) {
      if (!owner || !owner.path || liveNotes.has(owner.path)) continue;
      const live = await reqCloseWriteReadNote(this, owner.path, context, cache);
      if (typeof live === "string") liveNotes.set(owner.path, live);
    }
    for (const [path, providedText] of provided) {
      const live = await reqCloseWriteReadNote(this, path, context, cache);
      if (typeof live === "string") liveNotes.set(path, live);
      else liveNotes.set(path, providedText);
    }

    // Plan-only callers (RV vectors) inject `planCarryReq` and never a live
    // `carryReq`. Production uses `api.taskSplit.carryReq` and never falls
    // back to ordinary split. A dummy planner would refuse every carry
    // before the live API ran.
    if (typeof carryReq !== "function") {
      return planReqCloseWrites({
        ...input,
        notes: liveNotes,
        sha256Hex,
        today,
        date,
        planCarryReq,
        pullInPreflight,
      });
    }

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
    if (typeof pullInPreflight === "function" && reqCloseWriteHasCarryPulled(verdicts)) {
      const preview = pullInPreflight({
        owners,
        verdicts,
        notes: reqCloseWriteFilesObject(liveNotes),
      });
      if (preview && preview.ok === false) {
        return reqCloseWriteRefusal(
          preview.code || "req_pull_in_unavailable",
          preview.message || "Carry plus pull-in destination preflight refused",
        );
      }
    }
    const expected = reqCloseWritePreflightExpected(
      liveNotes,
      owners,
      verdicts,
      input.expectedNotes,
      input.expectedOwnerPostimages,
    );
    if (!expected.ok) return expected;
    if (!reqCloseWriteHasCarry(verdicts) && !verdicts.some((entry) => entry.verdict === "drop")) {
      return planReqCloseWrites({
        ...input,
        notes: liveNotes,
        sha256Hex,
        today,
        date,
        planCarryReq,
        pullInPreflight,
      });
    }

    const original = new Map(liveNotes);
    const working = new Map(liveNotes);
    const outcomes = [];
    const failures = [];
    const pending = [];
    const frozenByKey = new Map(owners.map((owner) => [owner.key, owner]));
    const carries = verdicts
      .filter((entry) => entry.verdict === "carry" || entry.verdict === "carry_pulled")
      .slice()
      .sort(reqCloseWriteSortBottomToTop);
    const drops = verdicts
      .filter((entry) => entry.verdict === "drop")
      .slice()
      .sort(reqCloseWriteSortBottomToTop);

    for (const resolved of carries) {
      const frozen = frozenByKey.get(resolved.row.owner_key);
      const ownerPath = resolved.row.owner_path;
      const current = working.get(ownerPath);
      if (!frozen || typeof current !== "string") {
        failures.push({
          key: resolved.row.key,
          code: "req_close_stale",
          message: "stale requirement pick",
          path: ownerPath,
        });
        continue;
      }
      const node = reqCloseWriteFindPending(
        current,
        frozen,
        resolved.row.key,
        resolved.row.path,
        resolved.row.depth,
        resolved.row.text,
        sha256Hex,
      );
      if (!node) {
        failures.push({
          key: resolved.row.key,
          code: "req_close_stale",
          message: "stale requirement pick",
          path: ownerPath,
        });
        continue;
      }
      const expectedLine = reqCloseWriteLineDigest(reqCloseWriteLineText(current, node.lineIndex), sha256Hex);
      const expectedOwnerPreimage = reqCloseWriteOwnerBlock(current, frozen);
      let result = null;
      try {
        result = await carryReq({
          notePath: ownerPath,
          line: node.line,
          expectedLine,
          expectedOwnerPreimage,
          today,
        });
      } catch (_error) {
        result = reqCloseWriteRefusal("split_unavailable", "Task split is unavailable");
      }
      if (!result || result.ok !== true) {
        failures.push({
          key: resolved.row.key,
          code: (result && result.code) || "split_unavailable",
          message: (result && result.message) || "Task split is unavailable",
          path: ownerPath,
          failedPaths: result && result.failedPaths,
        });
        continue;
      }
      const restores = Array.isArray(result.restores) ? result.restores : [];
      const files = (result.plan && result.plan.files) || result.files || {};
      if (restores.length > 0) {
        for (const restore of restores) {
          if (!restore || typeof restore.path !== "string") continue;
          working.set(restore.path, String(restore.after || ""));
        }
      } else {
        for (const [path, after] of Object.entries(files)) {
          working.set(path, String(after));
        }
      }
      const task = result.task || {};
      const moveMap = result.moveMap || {};
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
      try { cache.delete(ownerPath); } catch (_error) {}
    }

    for (const resolved of drops) {
      const frozen = frozenByKey.get(resolved.row.owner_key);
      const ownerPath = resolved.row.owner_path;
      const current = working.get(ownerPath);
      if (!frozen || typeof current !== "string") {
        failures.push({
          key: resolved.row.key,
          code: "req_close_stale",
          message: "stale requirement pick",
          path: ownerPath,
        });
        continue;
      }
      const node = reqCloseWriteFindPending(
        current,
        frozen,
        resolved.row.key,
        resolved.row.path,
        resolved.row.depth,
        resolved.row.text,
        sha256Hex,
      );
      if (!node) {
        failures.push({
          key: resolved.row.key,
          code: "req_close_stale",
          message: "stale requirement pick",
          path: ownerPath,
        });
        continue;
      }
      const preimage = reqCloseWriteLineText(current, node.lineIndex);
      const written = taskReqDrop(
        current,
        { lineIndex: node.lineIndex, preimage },
        date,
        resolved.reason || "",
      );
      if (!written || written.ok !== true) {
        failures.push({
          key: resolved.row.key,
          code: (written && written.code) || "req_close_stale",
          message: (written && written.message) || "The line changed — try again",
          path: ownerPath,
        });
        continue;
      }
      const persist = typeof input.persistDrop === "function"
        ? await input.persistDrop(ownerPath, current, written.updated, context)
        : await reqCloseWritePersistDrop(this, ownerPath, current, written.updated, context);
      if (!persist || persist.ok !== true) {
        failures.push({
          key: resolved.row.key,
          code: "req_write_failed",
          message: (persist && persist.reason) || "note cannot be updated safely",
          path: ownerPath,
        });
        continue;
      }
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
      try { cache.delete(ownerPath); } catch (_error) {}
    }

    reqCloseWriteRepairCarried(working, pending);
    const restores = composeReqCloseRestores([...working.keys()].map((path) => ({
      path,
      before: original.has(path) ? original.get(path) : "",
      after: working.get(path),
      created: !original.has(path),
    })).filter((entry) => entry.before !== entry.after));
    return {
      ok: failures.length === 0,
      req_outcomes: outcomes,
      outcomes,
      met: reqCloseWriteMetReceipts(owners, verdicts.filter((entry) => (
        outcomes.some((row) => row.row_key === entry.row.key) || !reqCloseTakesBranch(entry.verdict)
      ))),
      postimages: reqCloseWriteDiffPostimages(original, working),
      restores,
      notes: reqCloseWriteFilesObject(working),
      failures: failures.length > 0 ? failures : null,
      jump: selection.jump || null,
    };
  }
}
