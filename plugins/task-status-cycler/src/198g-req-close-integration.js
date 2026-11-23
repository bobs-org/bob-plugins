// Managed Done requirement-close support. Capture requirement forests before
// the initiating write, then match those frozen owners to the actual closed
// identity order at the post-close successor card.

function reqCloseIntegrationNotes(value) {
  const out = new Map();
  if (value instanceof Map) {
    for (const [path, text] of value) {
      if (typeof path === "string" && path && typeof text === "string") out.set(path, text);
    }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [path, text] of Object.entries(value)) {
      if (path && typeof text === "string") out.set(path, text);
    }
  }
  return out;
}

function reqCloseIntegrationSameIdentity(left, right) {
  if (String(left && left.path || "") !== String(right && right.path || "")) return false;
  const leftBlock = String(left && (left.blockId || left.block_id) || "");
  const rightBlock = String(right && (right.blockId || right.block_id) || "");
  if (leftBlock && rightBlock) return leftBlock === rightBlock;
  const leftTask = String(left && (left.taskId || left.task_id) || "");
  const rightTask = String(right && (right.taskId || right.task_id) || "");
  return !!leftTask && leftTask === rightTask;
}

function reqCloseIntegrationTaskMatches(task, identity) {
  const wantedBlock = String(identity && (identity.blockId || identity.block_id) || "");
  if (wantedBlock) return String(task && task.blockId || "") === wantedBlock;
  const wantedTask = String(identity && (identity.taskId || identity.task_id) || "");
  if (!wantedTask) return false;
  let taskId = String(task && (task.taskId || task.task_id) || "");
  if (!taskId && task && typeof task.lineText === "string" &&
      typeof parseTaskDependencyMetadata === "function") {
    try { taskId = String(parseTaskDependencyMetadata(task.lineText).taskId || ""); } catch (_error) {}
  }
  return taskId === wantedTask;
}

function reqCloseIntegrationComposeRestores(entries) {
  const paths = new Map();
  for (const row of Array.isArray(entries) ? entries : []) {
    if (!row || typeof row.path !== "string" || !row.path) continue;
    const previous = paths.get(row.path);
    if (!previous) {
      paths.set(row.path, {
        path: row.path,
        before: typeof row.before === "string" ? row.before : "",
        after: typeof row.after === "string" ? row.after : "",
        created: row.created === true,
      });
    } else {
      previous.after = typeof row.after === "string" ? row.after : previous.after;
      previous.created = previous.created || row.created === true;
    }
  }
  return [...paths.values()].filter((row) => row.created || row.before !== row.after);
}

class TaskStatusCyclerReqCloseIntegrationMixin {
  captureReqCloseOwnersFromText(contents, path, identities) {
    if (typeof contents !== "string" || !path) return [];
    const tasks = taskReqNoteTasks(contents);
    const selected = Array.isArray(identities)
      ? identities.map((identity) => ({
        identity,
        matches: tasks.filter((task) => reqCloseIntegrationTaskMatches(task, identity) ||
          (identity && identity.task_key && Number(identity.line) === task.lineIndex + 1)),
      }))
      : tasks.map((task) => ({ matches: [task] }));
    const owners = [];
    for (const selection of selected) {
      const matches = selection.matches;
      if (!Array.isArray(matches) || matches.length !== 1) continue;
      const task = matches[0];
      const blockId = String(task.blockId || "");
      let taskId = String(task.taskId || "");
      if (!taskId && typeof task.lineText === "string" &&
          typeof parseTaskDependencyMetadata === "function") {
        try { taskId = String(parseTaskDependencyMetadata(task.lineText).taskId || ""); } catch (_error) {}
      }
      const owner = reqCloseCollectOwner(contents, path, task, reqCloseWriteDefaultSha256);
      if (!owner || !owner.nodes.some((node) => node.state === "pending")) continue;
      if (selection.identity && selection.identity.task_key &&
          selection.identity.task_key !== owner.task_key) continue;
      owners.push({
        ...owner,
        close_identity: {
          path: String(path),
          ...(blockId ? { blockId } : {}),
          ...(taskId ? { taskId } : {}),
          task_key: owner.task_key,
          line: owner.line,
        },
      });
    }
    return owners;
  }

  captureReqCloseOwnersFromRange(contents, path, startLine, endLine) {
    if (typeof contents !== "string" || !path) return [];
    const lo = Math.min(Number(startLine) || 0, Number(endLine) || 0);
    const hi = Math.max(Number(startLine) || 0, Number(endLine) || 0);
    const tasks = taskReqNoteTasks(contents);
    const identities = [];
    for (const task of tasks) {
      if (!Number.isInteger(task.lineIndex) || task.lineIndex < lo || task.lineIndex > hi) continue;
      const identity = this.reqCloseIdentityForTaskLine(contents, path, task.lineIndex);
      if (identity) identities.push(identity);
    }
    return this.captureReqCloseOwnersFromText(contents, path, identities);
  }

  captureReqCloseOwnersFromEditor(identity, editor, path, fallbackText = "") {
    if (!identity) return [];
    const text = editor && typeof editor.getValue === "function"
      ? editor.getValue()
      : this.getEditorLineTexts(editor).join("\n");
    return this.captureReqCloseOwnersFromText(text || fallbackText, path, [identity]);
  }

  reqCloseIdentityForResolvedTarget(target) {
    if (!target || !target.file) return null;
    return closedTaskIdentity(target.file.path, target.taskStatus && target.taskStatus.lineText) ||
      (target.blockId ? { path: target.file.path, blockId: target.blockId } : null);
  }

  captureReqCloseOwnersForResolvedTarget(target, context = {}) {
    const identity = this.reqCloseIdentityForResolvedTarget(target);
    if (!identity || !target || typeof target.sourceText !== "string") return [];
    return this.captureReqCloseOwnersFromText(target.sourceText, target.file.path, [identity]);
  }

  // Read-only pre-close snapshot API for managed callers that own their write
  // outside this plugin (currently the navigation relation close gesture).
  async captureReqCloseOwners(identities, context = {}) {
    const closed = Array.isArray(identities) ? identities : [];
    const active = context && typeof context === "object" ? context : {};
    const supplied = reqCloseIntegrationNotes(active.preCloseNotes);
    const cache = new Map();
    const owners = [];
    for (const identity of closed) {
      if (!identity || !identity.path) continue;
      const path = String(identity.path);
      let contents = supplied.get(path);
      if (typeof contents !== "string") {
        try { contents = await this.readSuccessorNoteText(path, active, cache); } catch (_error) { contents = null; }
      }
      if (typeof contents !== "string") continue;
      owners.push(...this.captureReqCloseOwnersFromText(contents, path, [identity]));
    }
    return owners;
  }

  reqCloseOwnersForManagedDone(captured, closed, context = {}) {
    const active = context && typeof context === "object" ? context : {};
    if (active.closeKind === "cancelled" || active.closeKind === "parked" ||
        active.relationEventKind === "parked" || active.automated === true) return [];
    const snapshots = Array.isArray(captured) ? captured : [];
    const ordered = [];
    const identities = Array.isArray(closed) ? closed : [];
    for (const owner of snapshots) {
      if (!owner || !owner.close_identity || ordered.some((row) => row.key === owner.key)) continue;
      const identity = owner.close_identity;
      const anchored = Boolean(identity.blockId || identity.taskId);
      if (anchored) {
        if (identities.some((closedIdentity) =>
          reqCloseIntegrationSameIdentity(identity, closedIdentity))) ordered.push(owner);
      } else if (identity.task_key && Number.isInteger(Number(identity.line))) {
        // Idless owners have no dependency identity. Their caller supplies
        // snapshots only after the corresponding Done write succeeds.
        ordered.push(owner);
      }
    }
    return ordered;
  }

  reqCloseExpectedOwnerPostimages(owners, notes) {
    return reqCloseOwnerPostimagesFromNotes(owners, notes);
  }

  async applyManagedReqCloseCard(options = {}) {
    const owners = Array.isArray(options.owners) ? options.owners : [];
    const choices = options.choices && typeof options.choices === "object" ? options.choices : {};
    const requests = reqCloseCardRequestsFromChoices(Array.isArray(choices.reqs) ? choices.reqs : []);
    const jumpKey = choices.jump && typeof choices.jump.key === "string"
      ? choices.jump.key
      : "";
    const reqJump = owners.some((owner) => (owner.nodes || []).some((node) => node.key === jumpKey));
    if (!owners.length || (!Array.isArray(choices.reqs) && !reqJump)) return null;
    const expectedNotes = options.expectedNotes != null
      ? reqCloseIntegrationNotes(options.expectedNotes)
      : reqCloseIntegrationNotes(options.notes);
    const notes = reqCloseIntegrationNotes(options.notes);
    const ownerPaths = new Set(owners.map((owner) => owner && owner.path).filter(Boolean));
    if (options.dailyPath) ownerPaths.add(String(options.dailyPath));
    const liveCache = options.cache instanceof Map ? options.cache : new Map();
    const livePaths = new Set([...ownerPaths, ...expectedNotes.keys()]);
    for (const path of livePaths) {
      try { liveCache.delete(path); } catch (_error) {}
      try {
        const live = await this.readSuccessorNoteText(path, options.context || {}, liveCache);
        if (typeof live === "string") notes.set(path, live);
      } catch (_error) {}
    }
    const expectedOwnerPostimages = options.expectedOwnerPostimages != null
      ? options.expectedOwnerPostimages
      : reqCloseOwnerPostimagesFromNotes(owners, expectedNotes);
    const dailyPath = String(options.dailyPath || "");
    const vault = this.app && this.app.vault;
    const index = vault && typeof vault.getMarkdownFiles === "function"
      ? vault.getMarkdownFiles().map((file) => file && file.path).filter(Boolean)
      : [...notes.keys()];
    const completed = (Array.isArray(options.identities) ? options.identities : []).map((identity) => ({
      path: String(identity && identity.path || ""),
      blockId: String(identity && identity.blockId || ""),
      isRoot: !identity?.rootKey,
    }));
    let closing = options.closing && typeof options.closing === "object"
      ? options.closing
      : null;
    if (options.closingHint && dailyPath && typeof this.relocateSuccessorClosingEntry === "function") {
      try {
        const day = notes.get(dailyPath);
        const line = typeof day === "string"
          ? this.relocateSuccessorClosingEntry(day.split(/\r?\n/), options.closingHint)
          : null;
        if (Number.isInteger(line)) {
          closing = {
            continuationName: String(options.closingHint.createdName || options.closingHint.name || ""),
            closedLine: line,
          };
        }
      } catch (_error) {}
    }
    const pullInPreflight = createReqPullInPreflight({
      dayPath: dailyPath,
      day: notes.get(dailyPath),
      index,
      completed,
      closing,
    });
    const result = await this.applyReqCloseWrites({
      owners,
      taskOfferKeys: (Array.isArray(options.taskOfferKeys) ? options.taskOfferKeys : []).map(String),
      requests,
      jumpSelector: reqJump ? jumpKey : null,
      today: options.today,
      date: options.today,
      notes,
      expectedNotes,
      expectedOwnerPostimages,
      pullInPreflight,
      context: options.context || {},
      cache: new Map(),
    });
    return { ...result, reqJump: reqJump ? jumpKey : null, index, completed, closing };
  }

  async finishManagedReqPullIn(options = {}) {
    const result = options.result;
    if (!result || !Array.isArray(result.outcomes) ||
        !result.outcomes.some((row) => row && row.verdict === "carry_pulled")) return result;
    const notes = reqCloseIntegrationNotes(result.notes);
    const dayPath = String(options.dailyPath || "");
    const active = options.context || {};
    const cache = new Map();
    const carriedPaths = (Array.isArray(result.outcomes) ? result.outcomes : [])
      .map((row) => row && row.carried && row.carried.path)
      .filter((path) => typeof path === "string" && path);
    const paths = new Set([...notes.keys(), ...carriedPaths, dayPath].filter(Boolean));
    for (const path of paths) {
      try { cache.delete(path); } catch (_error) {}
      let text = null;
      try { text = await this.readSuccessorNoteText(path, active, cache); } catch (_error) {}
      if (typeof text === "string") notes.set(path, text);
    }
    let closing = options.closing && typeof options.closing === "object"
      ? { ...options.closing }
      : null;
    if (closing && options.closingHint && typeof this.relocateSuccessorClosingEntry === "function") {
      const dayText = notes.get(dayPath);
      try {
        const line = typeof dayText === "string"
          ? this.relocateSuccessorClosingEntry(dayText.split(/\r?\n/), options.closingHint)
          : null;
        if (Number.isInteger(line)) closing.closedLine = line;
      } catch (_error) {}
    }
    const themesApi = (() => {
      try {
        return typeof getSuccessorTaskThemesApi === "function"
          ? getSuccessorTaskThemesApi(this.app)
          : null;
      } catch (_error) { return null; }
    })();
    const routePulledTask = ({ task, target, destination }) => {
      if (!themesApi || !task || !task.path || !task.blockId) return {};
      const taskText = notes.get(String(task.path));
      if (typeof taskText !== "string") return {};
      let rows = [];
      try { rows = taskReqNoteTasks(taskText) || []; } catch (_error) {}
      const taskRow = rows.find((row) => String(row && row.blockId || "") === String(task.blockId));
      if (!taskRow || !Number.isInteger(taskRow.lineIndex)) return {};
      const view = reqPullInDayView(notes.get(dayPath) || "", dayPath, options.index || []);
      const entryIndex = target && Number.isInteger(target.entryIndex) ? target.entryIndex : null;
      const entry = entryIndex == null ? null : view.entries[entryIndex];
      let anchor = null;
      let implicit = null;
      if (entry) {
        if (destination && destination.entryRole === "implicit") {
          anchor = { kind: "implicit", entryLine: entry.line };
          implicit = { entryLine: entry.line, name: entry.name };
        } else {
          anchor = {
            kind: destination && destination.entryRole === "closing" ? "closing" : "inherit",
            entryLine: entry.line,
          };
        }
      }
      // A closing continuation can already have a newly-created typed name.
      // Preserve it when the effective task type agrees with that name.
      if (destination && destination.entryRole === "created") {
        try {
          const suggestion = typeof themesApi.effectiveTypeFor === "function"
            ? themesApi.effectiveTypeFor({ path: task.path, line: taskRow.lineIndex + 1, text: taskText })
            : null;
          const typeKey = suggestion && suggestion.theme && suggestion.theme.key;
          if (!typeKey || (typeof themesApi.typeAgrees === "function" &&
              themesApi.typeAgrees(typeKey, destination.entryName))) return {};
        } catch (_error) { return {}; }
      }
      const routed = successorOfferTypedDestination({
        anchor,
        implicit,
        dailyLines: view.lines,
        dailyPath: dayPath,
        task: { path: task.path, line: taskRow.lineIndex },
        noteText: taskText,
        themesApi,
      });
      const override = routed && routed.placementOverride;
      if (!override) return {};
      if (override.kind === "existing") {
        const at = view.entries.findIndex((candidate) => candidate.line === override.entryLine &&
          String(view.lines[candidate.line] || "").replace(/\r$/, "") === override.entryText && candidate.open);
        if (at < 0) return { refusal: { code: "req_pull_in_no_destination", message: "the typed Pomodoro destination changed" } };
        const selected = view.entries[at];
        return {
          target: { kind: "closing", entryIndex: at, insertAt: selected.end, createdName: null },
          destination: { entryName: selected.name, entryRole: "typed", fallback: false },
          routed: true,
        };
      }
      if (override.kind === "new" && typeof override.name === "string" && override.name.trim()) {
        const probe = "__bob_req_pull_in_d7_probe__";
        const planned = planSuccessorInsertions(view.lines, [{
          key: "req-pull-in-d7",
          blockLink: probe,
          anchor,
          implicit,
          override,
        }]);
        if (!planned || !Array.isArray(planned.links) || !planned.links.length) {
          return { refusal: { code: "req_pull_in_no_destination", message: "no typed Pomodoro destination is available" } };
        }
        const link = planned.links[0];
        if (link.entry_created !== true) {
          const routedEntry = view.entries.findIndex((candidate) => candidate.line === link.entry_line - 1 && candidate.open);
          if (routedEntry < 0) return { refusal: { code: "req_pull_in_no_destination", message: "the typed Pomodoro destination changed" } };
          const selected = view.entries[routedEntry];
          return {
            target: { kind: "closing", entryIndex: routedEntry, insertAt: selected.end, createdName: null },
            destination: { entryName: selected.name, entryRole: "typed", fallback: false },
            routed: true,
          };
        }
        const splice = (planned.splices || []).find((row) => Array.isArray(row.lines) && row.lines.includes(`\t- ${probe}`));
        if (!splice || !Number.isInteger(splice.at)) {
          return { refusal: { code: "req_pull_in_no_destination", message: "no typed Pomodoro destination is available" } };
        }
        return {
          target: { kind: "closing", entryIndex: null, insertAt: splice.at, createdName: override.name.trim() },
          destination: { entryName: override.name.trim(), entryRole: "created", fallback: false },
          routed: true,
        };
      }
      return {};
    };
    const pull = planReqPullInLinks({
      owners: options.owners || [],
      outcomes: result.outcomes,
      day: notes.get(dayPath),
      dayPath,
      index: options.index || [],
      completed: options.completed || [],
      closing,
      notes,
      today: options.today,
      routePulledTask,
    });
    let persisted = { ok: pull.ok === true, notes, restores: [], failures: [] };
    if (pull.ok) persisted = await this.persistReqPullInPlan({ notes }, pull, { ...active, cache });
    const failed = !pull.ok || persisted.ok !== true;
    const outcomes = result.outcomes.map((row) => {
      if (!row || row.verdict !== "carry_pulled") return row;
      const linked = !failed;
      return {
        ...row,
        pulled: linked,
        receipt: reqCloseCarryReceipt(row.text, linked),
        ...(failed ? { pull_in_failed: true } : {}),
      };
    });
    const failures = [
      ...(Array.isArray(result.failures) ? result.failures : []),
      ...(pull.ok ? (persisted.failures || []) : [{ code: pull.code, message: pull.message }]),
    ];
    return {
      ...result,
      outcomes,
      req_outcomes: outcomes,
      notes: Object.fromEntries(persisted.notes || notes),
      restores: reqCloseIntegrationComposeRestores([
        ...(result.restores || []),
        ...(persisted.restores || []),
      ]),
      failures: failures.length ? failures : null,
      pullIn: pull,
    };
  }

  async resolveManagedReqCloseLanding(options = {}) {
    const owners = Array.isArray(options.owners) ? options.owners : [];
    const plan = options.plan && typeof options.plan === "object" ? options.plan : {};
    const key = String(options.key || "");
    if (!key) return null;
    const owner = owners.find((entry) => entry && (entry.nodes || []).some((node) => node.key === key));
    const node = owner && owner.nodes.find((entry) => entry && entry.key === key);
    if (!owner || !node) return null;
    const target = {
      key,
      owner_key: owner.key,
      owner_path: owner.path,
      owner_block_id: owner.block_id,
      path: node.path,
      parent_key: node.parent_key,
      text: node.text,
      line: node.line,
    };
    const active = options.context || {};
    const routes = Array.isArray(options.routes) ? options.routes : [];
    const cache = options.cache instanceof Map ? options.cache : new Map();
    const paths = reqCloseLandingNotePaths({
      owners,
      plan,
      routes,
      dailyPath: options.dailyPath,
    });
    for (const path of paths) {
      try { cache.delete(path); } catch (_error) {}
    }
    const texts = new Map();
    if (plan.notes && typeof plan.notes === "object" && !Array.isArray(plan.notes)) {
      for (const [path, text] of Object.entries(plan.notes)) {
        if (typeof text === "string") texts.set(path, text);
      }
    }
    for (const path of paths) {
      try {
        const text = await this.readSuccessorNoteText(path, active, cache);
        if (typeof text === "string") texts.set(path, text);
      } catch (_error) {}
    }
    const resolved = resolveReqLanding({ target, owners, plan, routes }, (path) => (
      texts.has(path) ? texts.get(path) : null
    ));
    if (!resolved || resolved.ok !== true) return resolved || null;
    const landing = resolved.landing;
    return reqCloseLandableTarget(landing, texts.get(landing.path), node);
  }

  async persistReqPullInPlan(result, plan, context = {}) {
    const current = reqCloseIntegrationNotes(result && result.notes);
    const postimages = plan && plan.postimages && typeof plan.postimages === "object"
      ? plan.postimages
      : {};
    const restores = [];
    const failures = [];
    const entries = Object.entries(postimages);
    for (const [path, afterValue] of entries) {
      const after = String(afterValue);
      const before = current.get(path);
      if (typeof before !== "string") {
        failures.push({ path, reason: "note changed before pull-in write" });
        break;
      }
      if (before === after) continue;
      const written = await reqCloseWritePersistDrop(this, path, before, after, context);
      if (!written || written.ok !== true) {
        failures.push({ path, reason: written && written.reason || "note changed before pull-in write" });
        break;
      }
      current.set(path, after);
      restores.push({ path, before, after, created: false });
      try { if (context.cache instanceof Map) context.cache.delete(path); } catch (_error) {}
    }
    return {
      ok: failures.length === 0,
      notes: current,
      restores,
      failures,
    };
  }
}
