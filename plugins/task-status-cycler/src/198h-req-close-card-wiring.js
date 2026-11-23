// Cycler-boundary wiring for the managed Done requirement close card:
// picker `{key, verdict}` → resolver `{selector}`, owner-block snapshots at
// card open, composed expected texts through later gesture writes, and
// landable jump targets. Does not change the RV resolver or twin.

function reqCloseCardRequestSelector(request) {
  if (!request || typeof request !== "object") return "";
  if (typeof request.selector === "string" && request.selector.trim()) {
    return request.selector.trim();
  }
  return typeof request.key === "string" ? request.key.trim() : "";
}

function reqCloseCardRequestsFromChoices(reqs) {
  const out = [];
  for (const row of Array.isArray(reqs) ? reqs : []) {
    if (!row || typeof row !== "object") continue;
    const selector = reqCloseCardRequestSelector(row);
    const verdict = row.verdict;
    if (!selector || !["met", "drop", "carry", "carry_pulled"].includes(verdict)) continue;
    const request = { selector, verdict };
    if (row.reason !== undefined) request.reason = row.reason;
    out.push(request);
  }
  return out;
}

function reqCloseOwnerPostimagesFromNotes(owners, notes) {
  const files = typeof reqCloseIntegrationNotes === "function"
    ? reqCloseIntegrationNotes(notes)
    : new Map();
  const result = {};
  for (const owner of Array.isArray(owners) ? owners : []) {
    if (!owner || !owner.key || !owner.path || !files.has(owner.path)) continue;
    const block = typeof reqCloseWriteOwnerBlock === "function"
      ? reqCloseWriteOwnerBlock(files.get(owner.path), owner)
      : null;
    if (typeof block === "string") result[owner.key] = block;
  }
  return result;
}

function reqCloseOwnerKeyForSelector(owners, selector) {
  const wanted = String(selector || "");
  if (!wanted) return "";
  for (const owner of Array.isArray(owners) ? owners : []) {
    if (!owner) continue;
    if (owner.key === wanted) return owner.key;
    if ((owner.nodes || []).some((node) => node && node.key === wanted)) return owner.key;
  }
  return "";
}

function reqCloseRefuseStaleOwnerChoices(options = {}) {
  const owners = Array.isArray(options.owners) ? options.owners : [];
  const requests = Array.isArray(options.requests) ? options.requests.slice() : [];
  const jumpKey = typeof options.jumpKey === "string" && options.jumpKey ? options.jumpKey : null;
  const openBlocks = options.openBlocks instanceof Map
    ? Object.fromEntries(options.openBlocks)
    : (options.openBlocks && typeof options.openBlocks === "object" ? options.openBlocks : {});
  const freshBlocks = reqCloseOwnerPostimagesFromNotes(owners, options.freshNotes);
  const stale = new Set();
  const failures = [];
  for (const owner of owners) {
    if (!owner || !owner.key) continue;
    const expected = openBlocks[owner.key];
    const live = freshBlocks[owner.key];
    if (typeof expected === "string" && expected !== live) {
      stale.add(owner.key);
      failures.push({
        kind: "requirement",
        code: "req_close_stale",
        key: owner.key,
        reason: `requirement choices went stale for “${owner.text || "task"}”`,
      });
    }
  }
  return {
    owners: owners.filter((owner) => owner && !stale.has(owner.key)),
    requests: requests.filter((request) => {
      const ownerKey = reqCloseOwnerKeyForSelector(owners, reqCloseCardRequestSelector(request));
      return !ownerKey || !stale.has(ownerKey);
    }),
    jumpKey: jumpKey && stale.has(reqCloseOwnerKeyForSelector(owners, jumpKey)) ? null : jumpKey,
    failures,
    staleKeys: [...stale],
  };
}

function reqCloseComposeExpectedNotes(options = {}) {
  const open = typeof reqCloseIntegrationNotes === "function"
    ? reqCloseIntegrationNotes(options.openNotes)
    : new Map();
  const expected = new Map();
  for (const owner of Array.isArray(options.owners) ? options.owners : []) {
    if (owner && owner.path && open.has(owner.path)) expected.set(owner.path, open.get(owner.path));
  }
  if (typeof successorOfferClosePostPickNotes === "function") {
    const planned = successorOfferClosePostPickNotes(open, options.plan);
    for (const edit of Array.isArray(options.plan && options.plan.edits) ? options.plan.edits : []) {
      if (edit && typeof edit.path === "string" && planned.has(edit.path)) {
        expected.set(edit.path, planned.get(edit.path));
      }
    }
  }
  if (options.dailyPath && typeof options.dailyAfter === "string") {
    expected.set(String(options.dailyPath), options.dailyAfter);
  }
  for (const restore of Array.isArray(options.restores) ? options.restores : []) {
    if (!restore || typeof restore.path !== "string" || typeof restore.after !== "string") continue;
    expected.set(restore.path, restore.after);
  }
  return expected;
}

function reqCloseLandingNotePaths(options = {}) {
  const paths = new Set();
  const add = (path) => {
    if (typeof path === "string" && path) paths.add(path);
  };
  for (const owner of Array.isArray(options.owners) ? options.owners : []) {
    add(owner && owner.path);
  }
  const plan = options.plan && typeof options.plan === "object" ? options.plan : {};
  for (const outcome of Array.isArray(plan.outcomes) ? plan.outcomes : []) {
    add(outcome && outcome.carried && outcome.carried.path);
  }
  const notes = plan.notes && typeof plan.notes === "object" && !Array.isArray(plan.notes)
    ? plan.notes
    : {};
  for (const path of Object.keys(notes)) add(path);
  for (const route of Array.isArray(options.routes) ? options.routes : []) {
    add(route && route.source);
    add(route && route.dest);
  }
  add(options.dailyPath);
  return [...paths];
}

function reqCloseLandableTarget(landing, noteText, node) {
  const lineIndex = landing && Number.isInteger(landing.line) ? landing.line - 1 : -1;
  const lineText = typeof noteText === "string" && lineIndex >= 0
    ? String(noteText.split(/\r?\n/)[lineIndex] || "")
    : "";
  const description = node && typeof node.text === "string" ? node.text : "";
  return {
    ok: true,
    key: landing && landing.key,
    kind: landing && landing.kind,
    outcome: landing && landing.outcome,
    path: landing && landing.path,
    line: lineIndex,
    text: lineText,
    blockId: landing && landing.kind === "carried_task"
      ? (landing.blockId || landing.block_id || null)
      : null,
    description,
    label: description,
  };
}
