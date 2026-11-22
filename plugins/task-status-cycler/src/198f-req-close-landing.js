// Pinned-requirement jump landings (RV `jump`): resolve a pinned row after
// every planned write and route, by exact identity. Twin of bob-cli
// `src/native/task_complete/req_landing.rs` against the copied RV36–RV43
// vectors. A jump pin never changes a verdict or a byte; the resolver
// returns a landing and never navigates itself.
//
// - `carried_task`: the pinned row was carried, so it lands on the task it
//   became (never on its `[>]` stub).
// - `moved_with_ancestor`: an ancestor was carried, so the row moved with
//   that branch. The carry's move map gives its line inside the new task
//   block; the block's final line comes from its block ID.
// - `requirement`: otherwise (met, dropped, or under a dropped ancestor)
//   the row stays in its owner, found by sibling path and clean text inside
//   the owner's final block.
//
// Inbox-route moves forward the owner or the created task to its
// destination note. A target that cannot be found refuses as
// `req_jump_lost`; one with two candidates, or whose move map disagrees
// with the structure, refuses as `req_jump_ambiguous`. Either refusal
// happens before commit.

function reqLandingRefusal(code, message, extra) {
  return Object.assign({ ok: false, code, message: String(message || "") }, extra || {});
}

function reqLandingLost(key) {
  return reqLandingRefusal("req_jump_lost", `the pinned requirement has no final line: ${key}`, { key });
}

function reqLandingAmbiguous(key) {
  return reqLandingRefusal("req_jump_ambiguous", `the pinned requirement's final line is ambiguous: ${key}`, {
    key,
  });
}

function reqLandingOutcomeFor(plan, key) {
  const outcomes = plan && Array.isArray(plan.outcomes) ? plan.outcomes : [];
  return outcomes.find((outcome) => outcome && outcome.row_key === key) || null;
}

// 0-based line of the req at sibling `path` with clean `text` under `task`.
// Two structural matches refuse by returning `null` (lost), matching the
// Rust twin: label text only confirms a structural match.
function reqLandingReqLine(contents, task, path, text, options) {
  const lineIndex = task && Number.isInteger(task.lineIndex) ? task.lineIndex : null;
  if (lineIndex == null) return null;
  let forest = [];
  try {
    forest = taskReqForestForOwner(contents, lineIndex, options) || [];
  } catch (_error) {
    return null;
  }
  const matches = forest.filter(
    (node) => node && taskReqPathText(node) === String(path || "") && node.text === String(text == null ? "" : text),
  );
  if (matches.length !== 1) return null;
  return matches[0].lineIndex;
}

function reqLandingNoteTasks(contents, options) {
  try {
    return taskReqNoteTasks(contents, options) || [];
  } catch (_error) {
    return [];
  }
}

// Find a block by exact identity in its note, else in the destinations of
// inbox routes out of that note (renamed when the route renamed it).
function reqLandingLocateBlock(path, blockId, input, finalText, target, options) {
  const lookup = (note, id) => {
    let text = null;
    try {
      text = finalText(note);
    } catch (_error) {
      text = null;
    }
    if (typeof text !== "string") return null;
    const matches = reqLandingNoteTasks(text, options).filter(
      (task) => String(task.blockId || "") === String(id || ""),
    );
    if (matches.length > 1) throw reqLandingAmbiguous(target.key);
    if (matches.length === 0) return null;
    return { path: note, blockId: String(id || ""), text, task: matches[0] };
  };
  const direct = lookup(path, blockId);
  if (direct) return direct;
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const found = [];
  for (const route of routes) {
    if (!route || route.source !== path) continue;
    const id = route.old_block_id != null && String(route.old_block_id) === String(blockId || "")
      ? (route.new_block_id != null ? String(route.new_block_id) : String(blockId || ""))
      : String(blockId || "");
    if (found.some((located) => located.path === route.dest && located.blockId === id)) continue;
    const located = lookup(route.dest, id);
    if (located) found.push(located);
  }
  if (found.length === 0) throw reqLandingLost(target.key);
  if (found.length > 1) throw reqLandingAmbiguous(target.key);
  return found[0];
}

// A pinned descendant's sibling path under the task its carried ancestor
// became: the ancestor's own components drop off the front.
function reqLandingRebasedPath(path, ancestorPath) {
  const prefix = `${String(ancestorPath || "")}.`;
  if (!String(path || "").startsWith(prefix)) return null;
  const rest = String(path || "").slice(prefix.length);
  return rest ? rest : null;
}

// Resolve a pinned requirement row against the final staged texts.
// `finalText` returns a note's final text by vault-relative path.
function resolveReqLanding(input, finalText) {
  const options = input && typeof input === "object" ? input : {};
  const target = options.target || {};
  const owners = Array.isArray(options.owners) ? options.owners : [];
  const plan = options.plan && typeof options.plan === "object" ? options.plan : {};
  const settings = options.settings && typeof options.settings === "object" ? options.settings : undefined;
  const readFinal = typeof finalText === "function" ? finalText : () => null;
  try {
    const locate = (path, blockId) => reqLandingLocateBlock(path, blockId, options, readFinal, target, settings);
    const own = reqLandingOutcomeFor(plan, target.key);
    if (own && own.carried) {
      const located = locate(own.carried.path, own.carried.block_id);
      if (!located) throw reqLandingLost(target.key);
      return {
        ok: true,
        landing: {
          key: target.key,
          kind: "carried_task",
          outcome: own.verdict,
          path: located.path,
          line: located.task.lineIndex + 1,
          blockId: located.blockId,
        },
      };
    }
    const owner = owners.find((entry) => entry && entry.key === target.owner_key);
    if (!owner) throw reqLandingLost(target.key);
    const rows = new Map(
      (owner.nodes || []).map((node) => [
        node.key,
        { parentKey: node.parent_key, path: node.path, line: node.line },
      ]),
    );
    let ancestorKey = target.parent_key;
    let structural = null;
    while (ancestorKey) {
      const row = rows.get(ancestorKey);
      if (!row) throw reqLandingLost(target.key);
      const outcome = reqLandingOutcomeFor(plan, ancestorKey);
      if (outcome && outcome.verdict !== "met") {
        structural = { outcome, path: row.path, line: row.line };
        break;
      }
      ancestorKey = row.parentKey;
    }
    const ancestor = structural && structural.outcome.carried ? structural : null;
    if (ancestor) {
      const located = locate(ancestor.outcome.carried.path, ancestor.outcome.carried.block_id);
      if (!located) throw reqLandingLost(target.key);
      const rebased = reqLandingRebasedPath(target.path, ancestor.path);
      if (rebased == null) throw reqLandingLost(target.key);
      const structuralLine = reqLandingReqLine(located.text, located.task, rebased, target.text, settings);
      if (structuralLine == null) throw reqLandingLost(target.key);
      // Compose the carry's move map: the row's offset under its carried
      // head in the frozen forest names its `from` line at write time; `to`
      // is relative to the created task line, which only shifts as a whole
      // afterwards.
      const offset = Number(target.line) - Number(ancestor.line);
      if (!Number.isInteger(offset) || offset < 0) throw reqLandingLost(target.key);
      const from = Number(ancestor.outcome.source_line) + offset;
      const move = (ancestor.outcome.moves || []).find((entry) => Number(entry.from) === from);
      if (move) {
        const relative = Number(move.to) - Number(ancestor.outcome.carried.line);
        const mapped = located.task.lineIndex + relative;
        if (mapped !== structuralLine) throw reqLandingAmbiguous(target.key);
      }
      return {
        ok: true,
        landing: {
          key: target.key,
          kind: "moved_with_ancestor",
          outcome: ancestor.outcome.verdict,
          path: located.path,
          line: structuralLine + 1,
          blockId: null,
        },
      };
    }
    const outcome = own ? own.verdict : (structural ? structural.outcome.verdict : "met");
    const ownerText = owner.text;
    const found = [];
    const searchOwner = (note) => {
      const text = readFinal(note);
      if (typeof text !== "string") return;
      for (const task of reqLandingNoteTasks(text, settings)) {
        if (task.blockId || task.description !== ownerText) continue;
        const line = reqLandingReqLine(text, task, target.path, target.text, settings);
        if (line != null) found.push({ path: note, line });
      }
    };
    if (!target.owner_block_id) {
      const notes = [target.owner_path];
      for (const route of (Array.isArray(options.routes) ? options.routes : [])) {
        if (route && route.source === target.owner_path && !notes.includes(route.dest)) notes.push(route.dest);
      }
      for (const note of notes) searchOwner(note);
    } else {
      const located = locate(target.owner_path, target.owner_block_id);
      if (!located) throw reqLandingLost(target.key);
      const line = reqLandingReqLine(located.text, located.task, target.path, target.text, settings);
      if (line != null) found.push({ path: located.path, line });
    }
    if (found.length === 0) throw reqLandingLost(target.key);
    if (found.length > 1) throw reqLandingAmbiguous(target.key);
    return {
      ok: true,
      landing: {
        key: target.key,
        kind: "requirement",
        outcome,
        path: found[0].path,
        line: found[0].line + 1,
        blockId: null,
      },
    };
  } catch (refusal) {
    if (refusal && refusal.ok === false && typeof refusal.code === "string") return refusal;
    throw refusal;
  }
}
