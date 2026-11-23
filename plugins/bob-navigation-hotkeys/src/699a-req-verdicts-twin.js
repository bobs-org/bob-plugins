// --- Requirement close-card twin (RV choices): numbering, fold, validation --
// Twin of bob-cli `src/native/task_complete/req_verdicts.rs` interactive and
// final choice logic (`docs/task-requirements.md` §7). Consumes
// `req-close-twin.js` snapshots and never writes requirement state.
// Plugin-agnostic and copied byte for byte; update bob-cli first, then this
// file, then its copies.

const REQ_CLOSE_VERDICTS = Object.freeze(["met", "drop", "carry", "carry_pulled"]);

function reqCloseTakesBranch(verdict) {
  return verdict === "drop" || verdict === "carry" || verdict === "carry_pulled";
}

function reqCloseNormalizeReason(reason) {
  if (reason == null) return null;
  const normalized = taskReqSplitWhitespace(String(reason)).join(" ");
  return normalized === "" ? null : normalized;
}

function reqCloseSelectorIsNumber(selector) {
  const text = String(selector == null ? "" : selector);
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

function reqCloseCloneGroup(group) {
  return {
    group: group.group,
    kind: group.kind,
    owner: Object.assign({}, group.owner),
    copy: Object.assign({}, group.copy),
    folded: Object.assign({}, group.folded),
    rows: group.rows.map((row) => ({
      offer: Object.assign({}, row.offer),
      req: Object.assign({}, row.req),
      owner_key: row.owner_key,
      path: row.path,
      depth: row.depth,
      parent_key: row.parent_key,
      text: row.text,
      line: row.line,
      state: row.state,
      pending_descendants: row.pending_descendants,
      depth_exceeded: row.depth_exceeded,
      run: row.run,
      accessibility: row.accessibility,
      consequences: Object.assign({}, row.consequences),
    })),
  };
}

function reqCloseStaleError(selectors, groups, numbering) {
  const numbered = numbering.numberedGroups(groups);
  return {
    ok: false,
    code: "req_close_stale",
    selectors: selectors.slice(),
    current: {
      groups: numbered.ok === false ? groups.map(reqCloseCloneGroup) : numbered.groups,
      rows: numbering.rows.map((row) => Object.assign({}, row)),
    },
  };
}

function reqCloseCardNumbering(groups, taskOfferKeys) {
  const rows = [];
  const byKey = new Map();
  const byNumber = new Map();

  function push(key, kind) {
    if (byKey.has(key)) {
      return { ok: false, code: "req_close_stale", key, kind: "duplicate_card_key" };
    }
    const n = rows.length + 1;
    byKey.set(key, n);
    byNumber.set(n, rows.length);
    rows.push({ key, n, kind });
    return null;
  }

  for (const group of groups || []) {
    for (const row of group.rows) {
      const error = push(row.offer.key, "requirement");
      if (error) return error;
    }
  }
  for (const key of taskOfferKeys || []) {
    const error = push(key, "task_offer");
    if (error) return error;
  }

  function resolve(selector) {
    const text = String(selector == null ? "" : selector);
    if (reqCloseSelectorIsNumber(text)) {
      const n = text === "" ? NaN : Number(text);
      const index = Number.isInteger(n) ? byNumber.get(n) : undefined;
      if (index === undefined) {
        return { ok: false, code: "req_close_stale", selectors: [text] };
      }
      return { ok: true, row: rows[index] };
    }
    const n = byKey.get(text);
    const index = n == null ? undefined : byNumber.get(n);
    if (index === undefined) {
      return { ok: false, code: "req_close_stale", selectors: [text] };
    }
    return { ok: true, row: rows[index] };
  }

  function numberedGroups(source) {
    const next = (source || []).map(reqCloseCloneGroup);
    for (const group of next) {
      for (const row of group.rows) {
        const n = byKey.get(row.offer.key);
        if (n == null) {
          return { ok: false, code: "req_close_stale", selectors: [row.offer.key] };
        }
        row.offer.n = n;
      }
    }
    return { ok: true, groups: next };
  }

  return {
    ok: true,
    rows,
    resolve,
    numberedGroups,
    markAllKeys() {
      return rows.filter((row) => row.kind === "task_offer").map((row) => row.key);
    },
  };
}

function reqCloseRowIndex(owners, groups) {
  const ownersByKey = new Map((owners || []).map((owner) => [owner.key, owner]));
  const rows = new Map();
  for (const group of groups || []) {
    const owner = ownersByKey.get(group.owner.key);
    if (!owner) continue;
    for (const row of group.rows) rows.set(row.offer.key, { owner, row });
  }
  return rows;
}

function reqCloseProvenance(owner, row) {
  return {
    owner_task_key: owner.task_key,
    owner_key: owner.key,
    owner_path: owner.path,
    owner_block_id: owner.block_id,
    owner_line: owner.line,
    owner_preimage: owner.preimage,
    key: row.offer.key,
    path: row.path,
    depth: row.depth,
    parent_key: row.parent_key,
    text: row.text,
    line: row.line,
    pending_descendants: row.pending_descendants,
  };
}

function reqCloseValidateOwnerIdentities(owners, sha256Hex) {
  const taskKeys = new Set();
  const ownerKeys = new Set();
  for (const owner of owners || []) {
    const snapshot = sha256Hex
      ? reqCloseOwnerSnapshotKey(owner.task_key, owner.preimage, sha256Hex)
      : owner.key;
    if (taskKeys.has(owner.task_key) || ownerKeys.has(owner.key) || snapshot !== owner.key) {
      return {
        ok: false,
        code: "req_close_stale",
        kind: "duplicate_owner",
        task_key: owner.task_key,
      };
    }
    taskKeys.add(owner.task_key);
    ownerKeys.add(owner.key);
  }
  return { ok: true };
}

function reqCloseValidateNonOverlapping(selections, rows) {
  for (const ancestor of selections.filter((selection) => reqCloseTakesBranch(selection.verdict))) {
    for (const descendant of selections) {
      if (descendant.row.owner_key !== ancestor.row.owner_key || descendant.row.key === ancestor.row.key) {
        continue;
      }
      const hit = rows.get(descendant.row.key);
      if (!hit) continue;
      const parents = new Map(hit.owner.nodes.map((node) => [node.key, node.parent_key]));
      let parent = descendant.row.parent_key;
      while (parent) {
        if (parent === ancestor.row.key) {
          return {
            ok: false,
            code: "req_verdict_overlap",
            ancestor_key: ancestor.row.key,
            ancestor_text: ancestor.row.text,
            descendant_key: descendant.row.key,
          };
        }
        parent = parents.has(parent) ? parents.get(parent) : null;
      }
    }
  }
  return { ok: true };
}

function reqCloseResolveVerdicts(owners, taskOfferKeys, requests, jumpSelector, sha256Hex) {
  const identity = reqCloseValidateOwnerIdentities(owners, sha256Hex);
  if (!identity.ok) return identity;
  const unnumbered = reqCloseGroupsFromOwners(owners);
  const numbering = reqCloseCardNumbering(unnumbered, taskOfferKeys);
  if (!numbering.ok) return numbering;
  const numbered = numbering.numberedGroups(unnumbered);
  if (!numbered.ok) return numbered;
  const groups = numbered.groups;
  const rows = reqCloseRowIndex(owners, groups);
  const selected = [];
  const selectedByKey = new Map();
  const bad = [];

  for (const request of requests || []) {
    const resolvedRow = numbering.resolve(request.selector);
    if (!resolvedRow.ok || resolvedRow.row.kind !== "requirement") {
      bad.push(String(request.selector));
      continue;
    }
    const hit = rows.get(resolvedRow.row.key);
    if (!hit) {
      bad.push(String(request.selector));
      continue;
    }
    const reason = reqCloseNormalizeReason(request.reason);
    if (reason && request.verdict !== "drop") {
      return { ok: false, code: "offer_verdict_conflict", key: resolvedRow.row.key, kind: "invalid_reason" };
    }
    if (reqCloseTakesBranch(request.verdict) && hit.row.depth_exceeded) {
      return {
        ok: false,
        code: "req_depth_exceeded",
        key: resolvedRow.row.key,
        depth: hit.row.depth,
      };
    }
    const resolved = {
      row: reqCloseProvenance(hit.owner, hit.row),
      verdict: request.verdict,
      reason,
    };
    if (selectedByKey.has(resolvedRow.row.key)) {
      const previous = selected[selectedByKey.get(resolvedRow.row.key)];
      if (previous.verdict !== resolved.verdict || previous.reason !== resolved.reason) {
        return { ok: false, code: "offer_verdict_conflict", key: resolvedRow.row.key };
      }
      continue;
    }
    selectedByKey.set(resolvedRow.row.key, selected.length);
    selected.push(resolved);
  }
  if (bad.length) return reqCloseStaleError(bad, unnumbered, numbering);

  const overlap = reqCloseValidateNonOverlapping(selected, rows);
  if (!overlap.ok) return overlap;

  let jump = null;
  if (jumpSelector != null && jumpSelector !== "") {
    const resolvedJump = numbering.resolve(jumpSelector);
    if (!resolvedJump.ok) {
      return reqCloseStaleError([String(jumpSelector)], unnumbered, numbering);
    }
    const requirement = resolvedJump.row.kind === "requirement"
      ? (() => {
        const hit = rows.get(resolvedJump.row.key);
        return hit ? reqCloseProvenance(hit.owner, hit.row) : null;
      })()
      : null;
    jump = {
      card_row: Object.assign({}, resolvedJump.row),
      requirement,
    };
  }

  return {
    ok: true,
    groups,
    numbering,
    verdicts: selected,
    jump,
  };
}

function reqCloseRevalidatePreimages(selection, freshOwners, freshTaskOfferKeys, sha256Hex) {
  const identity = reqCloseValidateOwnerIdentities(freshOwners, sha256Hex);
  if (!identity.ok) return identity;
  const freshGroups = reqCloseGroupsFromOwners(freshOwners);
  const freshNumbering = reqCloseCardNumbering(freshGroups, freshTaskOfferKeys);
  if (!freshNumbering.ok) return freshNumbering;
  const freshNumbered = freshNumbering.numberedGroups(freshGroups);
  if (!freshNumbered.ok) return reqCloseStaleError(freshNumbered.selectors || [], freshGroups, freshNumbering);
  const freshByTask = new Map((freshOwners || []).map((owner) => [owner.task_key, owner]));
  const checked = new Set();
  const rowsToCheck = (selection.verdicts || []).map((verdict) => verdict.row);
  if (selection.jump && selection.jump.requirement) rowsToCheck.push(selection.jump.requirement);
  for (const selected of rowsToCheck) {
    if (checked.has(selected.owner_task_key)) continue;
    checked.add(selected.owner_task_key);
    const fresh = freshByTask.get(selected.owner_task_key);
    if (!fresh) {
      return reqCloseStaleError([selected.key], freshNumbered.groups, freshNumbering);
    }
    const snapshot = sha256Hex
      ? reqCloseOwnerSnapshotKey(fresh.task_key, fresh.preimage, sha256Hex)
      : fresh.key;
    const sameNode = fresh.nodes.some((node) => (
      node.key === selected.key
      && node.path === selected.path
      && node.depth === selected.depth
      && node.parent_key === selected.parent_key
      && node.text === selected.text
      && node.line === selected.line
      && node.state === "pending"
    ));
    if (
      fresh.key !== selected.owner_key
      || fresh.path !== selected.owner_path
      || fresh.block_id !== selected.owner_block_id
      || fresh.line !== selected.owner_line
      || fresh.preimage !== selected.owner_preimage
      || snapshot !== fresh.key
      || !sameNode
    ) {
      return reqCloseStaleError([selected.key], freshNumbered.groups, freshNumbering);
    }
  }
  return { ok: true };
}

function reqCloseChoiceState() {
  const choices = new Map();
  return {
    choice(key) {
      return choices.has(key) ? choices.get(key) : "met";
    },
    stage(key, verdict) {
      if (verdict === "met" || choices.get(key) === verdict) choices.delete(key);
      else choices.set(key, verdict);
    },
    fold(group, owner) {
      const byKey = new Map((owner.nodes || []).map((node) => [node.key, node.parent_key]));
      return group.rows.map((row) => {
        let ancestor = row.parent_key;
        let hiddenBy = null;
        while (ancestor) {
          if (choices.has(ancestor) && reqCloseTakesBranch(choices.get(ancestor))) {
            hiddenBy = ancestor;
            break;
          }
          ancestor = byKey.has(ancestor) ? byKey.get(ancestor) : null;
        }
        const choice = choices.has(row.offer.key) ? choices.get(row.offer.key) : "met";
        return {
          key: row.offer.key,
          visible: hiddenBy == null,
          hidden_by: hiddenBy,
          nested_go_with_it: (reqCloseTakesBranch(choice) && row.pending_descendants > 0)
            ? row.pending_descendants
            : null,
        };
      });
    },
    requests() {
      return [...choices.entries()].map(([key, verdict]) => ({
        selector: key,
        verdict,
        reason: null,
      }));
    },
  };
}
