// Gesture integration for the prepared successor-card close engine. Keep the
// picker normalization, post-pick expectations, and close handoff out of 137's
// already crowded orchestration method.

function successorOfferCloseIntegrationCapabilities(plugin, successors) {
  const nav = plugin && plugin.app && plugin.app.plugins &&
    plugin.app.plugins.plugins &&
    plugin.app.plugins.plugins["bob-navigation-hotkeys"];
  const api = nav && nav.api;
  return {
    successors: successors || null,
    cancel: api && api.cancel ? api.cancel : null,
    completeTaskLineText: plugin && typeof plugin.completeTaskLineText === "function"
      ? (line, options) => plugin.completeTaskLineText(line, options)
      : null,
    applyOfferClosesNow: plugin && typeof plugin.applyOfferClosesNow === "function"
      ? (options) => plugin.applyOfferClosesNow(options)
      : null,
  };
}

function successorOfferCloseLiveLinkCheck(dailyLines, dailyPath) {
  let entries = [];
  try {
    entries = findLiveLinks(dailyLines);
  } catch (_error) {
    entries = [];
  }
  return (task) => entries.some((entry) => entry && entry.open === true &&
    (entry.links || []).some((link) => successorLinkMatchesIdentity(
      link,
      { path: task && task.path, blockId: task && task.blockId },
      dailyPath,
    )),
  );
}

function successorJumpPickerSupported(plugin, successors, context) {
  try {
    if (!successors || Number(successors.version) < 5) return false;
    const plugins = plugin && plugin.app && plugin.app.plugins && plugin.app.plugins.plugins;
    const nav = plugins && plugins["bob-navigation-hotkeys"];
    const api = nav && nav.api;
    if (!api || typeof api.landOnTask !== "function") return false;
    const active = context && typeof context === "object" ? context : {};
    if (active.successorNoticeTarget !== "return") return true;
    return active.successorJumpTarget === "return" &&
      api.reviewWalk && Number(api.reviewWalk.version) >= 2;
  } catch (_error) {
    return false;
  }
}

function successorOfferClosePostPickNotes(notes, plan) {
  const out = successorOfferCloseCoerceNoteMap(notes);
  const rows = successorPlanRows(plan);
  const failed = (edit) => rows.some((row) => row &&
    String(row.note_path || "") === String(edit.path || "") &&
    Number(row.line) === Number(edit.line) && row.not_linked === "failed",
  );
  for (const edit of Array.isArray(plan && plan.edits) ? plan.edits : []) {
    if (!edit || typeof edit.path !== "string" || !Number.isInteger(edit.line) ||
        typeof edit.before !== "string" || typeof edit.after !== "string" || failed(edit)) {
      continue;
    }
    const before = out.get(edit.path);
    if (typeof before !== "string") continue;
    const ending = successorOfferCloseLineEnding(before);
    const lines = before.split(/\r?\n/);
    if (edit.line < 0 || edit.line >= lines.length || lines[edit.line] !== edit.before) continue;
    lines[edit.line] = edit.after;
    out.set(edit.path, lines.join(ending));
  }
  return out;
}

function successorOfferCloseExpectedLines(closes, cardOffers, currentOffers, plan) {
  const expected = new Map();
  const edits = Array.isArray(plan && plan.edits) ? plan.edits : [];
  const rows = successorPlanRows(plan);
  const currentByKey = successorOfferCloseOffersByKey(currentOffers);
  for (const close of Array.isArray(closes) ? closes : []) {
    const key = String(close && close.key || "");
    if (!key) continue;
    const card = cardOffers instanceof Map ? cardOffers.get(key) : null;
    const cardTask = card && card.task && typeof card.task === "object" ? card.task : null;
    const preimage = cardTask && typeof cardTask.rawLine === "string"
      ? cardTask.rawLine
      : null;
    let line = preimage;
    const current = currentByKey.get(key);
    const path = String(current && current.notePath || card && card.notePath || "");
    const taskLine = current && current.task && Number.isInteger(current.task.line)
      ? current.task.line
      : current && Number.isInteger(current.line) ? current.line
        : cardTask && Number.isInteger(cardTask.line) ? cardTask.line : -1;
    if (preimage !== null && path && taskLine >= 0) {
      const edit = edits.find((candidate) => candidate &&
        String(candidate.path || "") === path && Number(candidate.line) === taskLine &&
        candidate.before === preimage && typeof candidate.after === "string",
      );
      const editFailed = edit && rows.some((row) => row &&
        String(row.note_path || "") === path && Number(row.line) === taskLine &&
        row.not_linked === "failed",
      );
      if (edit && !editFailed) line = edit.after;
    }
    // An absent card preimage must fail closed; never adopt text read after the
    // picker as the expected line.
    expected.set(key, line === null ? "" : line);
  }
  return expected;
}

function successorOfferCloseDigestCount(table, path, digest) {
  const rows = table instanceof Map ? table.get(String(path || "")) :
    (table || {})[String(path || "")];
  return Array.isArray(rows)
    ? rows.filter((row) => row && row.digest === digest).length
    : 0;
}

function successorOfferCloseIsIdlessKey(key) {
  const value = String(key || "");
  if (value.includes("#^")) return null;
  const at = value.lastIndexOf("@");
  if (at < 0) return null;
  const tail = value.slice(at + 1).match(/^([0-9a-f]{8})(?:~(\d+))?$/i);
  return tail ? { path: value.slice(0, at), digest: tail[1].toLowerCase() } : null;
}

function successorOfferCloseAmbiguousKeys(keys, cardNotes, freshNotes) {
  const originalTable = buildSuccessorNoteDigestTable(cardNotes || {});
  const freshTable = buildSuccessorNoteDigestTable(freshNotes || {});
  const ambiguous = new Set();
  for (const rawKey of Array.isArray(keys) ? keys : []) {
    const key = String(rawKey || "");
    const idless = successorOfferCloseIsIdlessKey(key);
    if (idless && successorOfferCloseDigestCount(originalTable, idless.path, idless.digest) !==
        successorOfferCloseDigestCount(freshTable, idless.path, idless.digest)) {
      ambiguous.add(key);
    }
  }
  return ambiguous;
}

function successorOfferCloseRelocatedOffers(options = {}) {
  const closes = Array.isArray(options.closes) ? options.closes : [];
  const allowed = options.revalidatedKeys instanceof Set ? options.revalidatedKeys : new Set();
  const cardOffers = options.cardOffers instanceof Map ? options.cardOffers : new Map();
  const freshOffers = successorOfferCloseOffersByKey(options.freshOffers || []);
  const notes = successorOfferCloseCoerceNoteMap(options.noteTexts || {});
  const originalNotes = successorOfferCloseCoerceNoteMap(options.cardNoteTexts || {});
  const originalTable = buildSuccessorNoteDigestTable(originalNotes);
  const currentTable = buildSuccessorNoteDigestTable(notes);
  const tasks = tasksFromDocuments([...notes.entries()].map(([path, text]) => ({ path, text })));
  const keys = assignSuccessorOfferKeys(tasks, currentTable);
  const taskByKey = new Map();
  for (const task of tasks) {
    const key = keys.get(task);
    if (key && !taskByKey.has(String(key))) taskByKey.set(String(key), task);
  }
  const out = [];
  for (const close of closes) {
    const key = String(close && close.key || "");
    if (!key || !allowed.has(key)) continue;
    const fresh = freshOffers.get(key);
    const card = cardOffers.get(key);
    if (!fresh || !card) continue;
    const idless = successorOfferCloseIsIdlessKey(key);
    if (idless && successorOfferCloseDigestCount(originalTable, idless.path, idless.digest) !==
        successorOfferCloseDigestCount(currentTable, idless.path, idless.digest)) {
      continue;
    }
    const task = taskByKey.get(key);
    if (!task) continue;
    const path = String(task.path || "");
    const noteText = notes.get(path);
    const cardTask = card.task && typeof card.task === "object" ? card.task : {};
    out.push({
      ...fresh,
      notePath: path,
      line: task.line,
      task: {
        ...task,
        cardLine: Number.isInteger(cardTask.line) ? cardTask.line : card.line,
        cardRawLine: typeof cardTask.rawLine === "string" ? cardTask.rawLine : "",
      },
      ...(typeof noteText === "string" ? { noteText } : {}),
    });
  }
  return out;
}

function removeResolvedOfferCloseRows(plan, result) {
  const resolved = Array.isArray(result && result.resolved) ? result.resolved : [];
  if (!plan || resolved.length === 0) return;
  const keys = new Set(resolved.map((row) => String(row && row.key || "")).filter(Boolean));
  const byBlock = new Set(resolved.filter((row) => row && row.path && row.blockId)
    .map((row) => `${row.path}\0${row.blockId}`));
  const isResolved = (row) => {
    if (!row || typeof row !== "object") return false;
    const offerKey = row.offer && row.offer.key;
    if (offerKey && keys.has(String(offerKey))) return true;
    const block = row.block_id || row.blockId;
    return !!(block && byBlock.has(`${String(row.note_path || row.path || "")}\0${String(block)}`));
  };
  for (const field of ["unblocked", "keep_moving", "relation_successors", "rows"]) {
    if (Array.isArray(plan[field])) plan[field] = plan[field].filter((row) => !isResolved(row));
  }
}

function successorOfferCloseHasReceipt(model) {
  return !!(model && typeof model === "object" && (
    (Array.isArray(model.offer_closes) && model.offer_closes.length > 0) ||
    (Array.isArray(model.req_outcomes) && model.req_outcomes.length > 0) ||
    (Array.isArray(model.req_met) && model.req_met.length > 0) ||
    (model.offer_close_refused && Number(model.offer_close_refused.count) > 0) ||
    (Array.isArray(model.failures) && model.failures.length > 0)
  ));
}

function successorOfferCloseNoticeText(model, baseText) {
  const source = model && typeof model === "object" ? model : {};
  const lines = [];
  if (typeof baseText === "string" && baseText) lines.push(baseText);
  for (const row of Array.isArray(source.req_outcomes) ? source.req_outcomes : []) {
    const receipt = String(row && (row.receipt || row.message) || "").trim();
    if (receipt) lines.push(receipt);
  }
  for (const row of Array.isArray(source.req_met) ? source.req_met : []) {
    const receipt = String(row && (row.receipt || row.message) || "").trim();
    if (receipt) lines.push(receipt);
  }
  const stampedRecoveries = [];
  for (const row of Array.isArray(source.offer_closes) ? source.offer_closes : []) {
    if (!row || typeof row !== "object") continue;
    const message = String(row.message || successorOfferCloseReceiptMessage({
      display: row.text,
      statusName: row.previous_status_name,
      outcome: row.outcome,
      reason: row.reason,
      recovered: row.recovered,
    }) || "");
    if (message) lines.push(message);
    for (const recovered of Array.isArray(row.recovered) ? row.recovered : []) {
      if (recovered && recovered.unblocked_stamped === true && recovered.text) stampedRecoveries.push(recovered);
    }
  }
  if (stampedRecoveries.length === 1) {
    lines.push(`↳ “${stampedRecoveries[0].text}” back tomorrow as a tickler`);
  } else if (stampedRecoveries.length > 1) {
    lines.push(`↳ ${stampedRecoveries.length} unblocked tasks back tomorrow as ticklers`);
  }
  const refusal = source.offer_close_refused && typeof source.offer_close_refused === "object"
    ? source.offer_close_refused
    : null;
  if (refusal && Number(refusal.count) > 0) {
    lines.push(`${Math.floor(Number(refusal.count))} not closed · changed since the card opened`);
    for (const row of Array.isArray(refusal.rows) ? refusal.rows : []) {
      if (row && (row.text || row.why)) lines.push([row.text, row.why].filter(Boolean).join(" · "));
    }
  }
  for (const failure of Array.isArray(source.failures) ? source.failures : []) {
    if (!failure || !failure.reason) continue;
    if (failure.kind === "requirement") {
      lines.push(`⚠ Requirements unchanged: ${failure.reason}`);
    } else {
      lines.push(`⚠ ${failure.kind === "recovery" ? "Recovery failed" : "Close write failed"}: ${failure.reason}`);
    }
  }
  return lines.join("\n");
}

class TaskStatusCyclerSuccessorOfferCloseIntegrationMixin {
  successorOfferCloseCapabilities(successors) {
    return successorOfferCloseIntegrationCapabilities(this, successors);
  }

  async pickSuccessorOfferChoices(options = {}) {
    const offers = Array.isArray(options.offers) ? options.offers : [];
    const reqGroups = Array.isArray(options.reqCloseGroups) ? options.reqCloseGroups : [];
    const numbering = reqCloseCardNumbering(
      reqGroups,
      offers.map((offer) => String(offer && offer.key || "")).filter(Boolean),
    );
    const numberedReqGroups = numbering.ok && reqGroups.length
      ? numbering.numberedGroups(reqGroups).groups
      : [];
    const plan = options.plan && typeof options.plan === "object" ? options.plan : {};
    const successors = options.pickerApi || null;
    const capabilities = this.successorOfferCloseCapabilities(successors);
    const originalOfferByKey = new Map();
    for (const offer of offers) {
      if (offer && offer.key) originalOfferByKey.set(String(offer.key), offer);
    }
    let model = null;
    try {
      model = buildSuccessorPickerModel({
        predecessors: (options.identities || []).map((identity) => ({
          note_path: String(identity.path || ""),
          block_id: identity.blockId ? String(identity.blockId) : "",
          text: identity.text ? String(identity.text) : "",
        })),
        offers,
        stillBlocked: Array.isArray(plan.still_blocked) ? plan.still_blocked : [],
        foldedByProject: plan.foldedByProject instanceof Map ? plan.foldedByProject : new Map(),
        headers: plan.projectHeaders instanceof Map ? plan.projectHeaders : new Map(),
        relationHeld: Array.isArray(plan.relation_held) ? plan.relation_held : [],
        offerCloseCapabilities: capabilities,
        jumpSupported: successorJumpPickerSupported(this, successors, options.context),
        offerCloseContext: {
          noteTexts: options.noteTexts || {},
          plannedRecoveryEdits: Array.isArray(plan.edits) ? plan.edits : [],
          tasks: options.tasks || [],
          today: options.today,
          dailyPath: options.dailyPath,
          dailyBefore: options.dailyBefore || [],
          dailyAfter: options.dailyAfter || [],
          dependencySnapshotAvailable: options.dependencySnapshotAvailable === true,
          markUnblockedLine: options.markUnblockedLine,
          hasLiveLink: successorOfferCloseLiveLinkCheck(options.dailyAfter || [], options.dailyPath),
        },
      });
      if (model && numberedReqGroups.length) {
        model.groups = [...numberedReqGroups, ...(model.groups || [])];
      }
    } catch (_error) {
      model = null;
    }
    if (!model || !Array.isArray(model.groups) || !model.groups.some((group) =>
      Array.isArray(group.rows) && group.rows.some((row) => row.selectable || group.group === "requirements"),
    )) {
      return { pickerOpened: false, model, choices: null, originalOfferByKey };
    }
    try {
      const result = await successors.pick(model);
      return {
        pickerOpened: true,
        model,
        choices: normalizeSuccessorChoices(result),
        originalOfferByKey,
      };
    } catch (_error) {
      return { pickerOpened: true, model, choices: null, originalOfferByKey };
    }
  }

  async revalidateSuccessorPickerChoices(options = {}) {
    const {
      identities, selectableOffers, closeChoices, reqRequests, reqJumpKey,
      noteTexts, noteTextsObject, dailyPath, hint, active, cache,
      relationLookupIdentities, cancelledClose, pickerApi, today, relationPreflight,
      relationRuntime, relationEventKind, parkedSlot, relationPlanOptions,
      linkUnblocked, keepMovingEnabled, keepMovingCandidatePaths, keepMovingAnchorHints,
      keepMovingBaseline, planFirst, reqCloseOwners, updateBasenames, updateDependencySnapshot,
    } = options;
    const reqCloseOwnerRows = Array.isArray(reqCloseOwners) ? reqCloseOwners : [];
    let plan = options.plan;
    let selectedKeys = Array.isArray(options.selectedKeys) ? options.selectedKeys : [];
    let selectedDestinations = options.selectedDestinations instanceof Map
      ? options.selectedDestinations : new Map();
    let closeRevalidatedKeys = options.closeRevalidatedKeys instanceof Set
      ? options.closeRevalidatedKeys : new Set();
    let closePassNoteTexts = options.closePassNoteTexts;
    let closePassTasks = options.closePassTasks;
    let closePassDependencySnapshotAvailable = options.closePassDependencySnapshotAvailable;
    let tasks = options.tasks;
    let dailyCurrent = options.dailyCurrent;
    let dailyBefore = options.dailyBefore;
    let dailyAfter = options.dailyAfter;
    let planClosingEntry = options.planClosingEntry;
    let dependencySnapshotAvailable = options.dependencySnapshotAvailable;
    if (selectedKeys.length > 0 || closeChoices.length > 0 || reqRequests !== null || reqJumpKey) {
      // Re-read fresh texts (editor buffers first), invalidating caches.
      const affected = new Set();
      for (const identity of identities) {
        if (identity && identity.path) {
          affected.add(String(identity.path));
        }
      }
      for (const owner of reqCloseOwnerRows) {
        if (owner && owner.path) affected.add(String(owner.path));
      }
      for (const offer of selectableOffers) {
        if (offer && offer.notePath) {
          affected.add(String(offer.notePath));
        }
      }
      for (const row of successorPlanRows(plan)) {
        if (row && row.note_path) {
          affected.add(String(row.note_path));
        }
      }
      for (const row of plan.still_blocked || []) {
        if (row && row.note_path) {
          affected.add(String(row.note_path));
        }
      }
      for (const path of noteTexts.keys()) {
        affected.add(String(path));
      }
      if (dailyPath) {
        affected.add(String(dailyPath));
      }
      for (const path of affected) {
        try {
          cache.delete(path);
        } catch (error) {
          // Best effort.
        }
      }
      let dailyFresh = null;
      if (dailyPath) {
        dailyFresh = await this.readSuccessorNoteText(dailyPath, active, cache);
      }
      const freshNoteTexts = new Map();
      const unavailableFreshNotes = new Set();
      if (dailyPath) {
        if (typeof dailyFresh === "string") {
          freshNoteTexts.set(dailyPath, dailyFresh);
        } else {
          unavailableFreshNotes.add(dailyPath);
        }
      }
      for (const path of affected) {
        if (path === dailyPath) {
          continue;
        }
        const text = await this.readSuccessorNoteText(path, active, cache);
        if (typeof text === "string") {
          freshNoteTexts.set(path, text);
        } else {
          unavailableFreshNotes.add(path);
        }
      }
      // Preserve untouched snapshots, but never revive an affected note
      // whose fresh read failed or whose file was deleted.
      for (const [path, text] of noteTexts) {
        if (!freshNoteTexts.has(path) && !unavailableFreshNotes.has(path) && !affected.has(String(path))) {
          freshNoteTexts.set(path, text);
        }
      }
      let freshNotesObj = {};
      for (const [path, text] of freshNoteTexts) {
        freshNotesObj[path] = text;
      }
      // Rebuild the dependents index with fresh affected docs overriding
      // stale cache locations (warm) or fresh overlay (cold). No new
      // full-vault scan on a warm pass.
      let freshTasks = tasks;
      let freshDependencySnapshotAvailable = false;
      try {
        const freshCache = typeof this.readSuccessorTasksCache === "function" ? this.readSuccessorTasksCache() : { ready: false, tasks: [] };
        if (freshCache && freshCache.ready) {
          freshDependencySnapshotAvailable = true;
          const freshBuffered = new Set(freshNoteTexts.keys());
          const base = [];
          for (const task of freshCache.tasks || []) {
            if (!freshBuffered.has(task.path)) {
              base.push(task);
            }
          }
          for (const [path, text] of freshNoteTexts) {
            if (affected.has(String(path)) && !isExcludedSuccessorVaultPath(path)) base.push(...tasksFromDocuments([{ path, text }]));
          }
          freshTasks = base;
        } else {
          const oldByPath = new Map();
          for (const task of tasks || []) {
            if (!task || !task.path) {
              continue;
            }
            if (!oldByPath.has(task.path)) {
              oldByPath.set(task.path, []);
            }
            oldByPath.get(task.path).push(task);
          }
          const next = [];
          for (const [path, list] of oldByPath) {
            if (affected.has(String(path))) {
              continue;
            }
            for (const task of list) {
              next.push(task);
            }
          }
          for (const [path, text] of freshNoteTexts) {
            if (affected.has(String(path)) && !isExcludedSuccessorVaultPath(path)) next.push(...tasksFromDocuments([{ path, text }]));
          }
          freshTasks = next;
        }
      } catch (error) {
        freshTasks = tasks;
      }
      const dailyFreshLines = typeof dailyFresh === "string" ? dailyFresh.split(/\r?\n/) : dailyAfter;
      // Relocate the closing entry against fresh text; never carry an old
      // bullet offset into a newly edited ledger.
      let freshClosing = null;
      if (hint && Number.isInteger(hint.line)) {
        try {
          const relocated = this.relocateSuccessorClosingEntry(dailyFreshLines, hint);
          freshClosing = relocated;
        } catch (error) {
          freshClosing = null;
        }
      } else if (Number.isInteger(planClosingEntry)) {
        freshClosing = planClosingEntry < dailyFreshLines.length ? planClosingEntry : null;
      }
      // The anchor / already-planned baseline is the day before this
      // gesture: the fresh text with the closed entry's headline restored
      // to its pre-close form, so its links still anchor `closing`
      // instead of falling through to the implicit destination.
      let freshBefore = dailyFreshLines;
      if (
        hint && typeof hint.lineText === "string" &&
        Number.isInteger(freshClosing) &&
        freshClosing >= 0 && freshClosing < dailyFreshLines.length
      ) {
        freshBefore = dailyFreshLines.slice();
        freshBefore[freshClosing] = hint.lineText;
      }
      const freshRelationRuntime = this.prepareSuccessorRelationRuntime(
        active,
        cancelledClose,
        cancelledClose ? null : getSuccessorPickerApi(this.app),
      );
      const freshRelationPreflight = this.preflightSuccessorRelationIndex(
        relationLookupIdentities,
        freshRelationRuntime,
      );
      let freshRelationOptions = {};
      if (freshRelationPreflight.state === "unavailable") {
        freshRelationOptions = {
          relationSuccessorLabels: freshRelationRuntime.labels,
          navSuccessorsVersion: 3,
          relationIndexReady: false,
        };
      } else if (freshRelationPreflight.state === "candidates") {
        const freshRelation = await this.readSuccessorRelationInputs({
          runtime: freshRelationRuntime,
          preflight: freshRelationPreflight,
          active,
          cache,
          noteTexts: freshNoteTexts,
          identities: relationLookupIdentities,
          baselineDay: freshBefore,
          currentDay: dailyFreshLines,
          dailyPath: dailyPath || "",
          closingEntry: freshClosing,
          eventKind: relationEventKind,
          slot: parkedSlot,
        });
        freshRelationOptions = freshRelation.options || {};
        for (const [path, text] of freshRelation.noteTexts || []) {
          if (typeof text === "string") {
            freshNoteTexts.set(path, text);
            affected.add(path);
          }
        }
      }
      if (successorRelationInputsNeedDependencySnapshot(freshRelationOptions, freshNoteTexts)) {
        // A relation's own prerequisite or project may have changed while
        // the picker was open. Trust only the refreshed warm Tasks pool;
        // otherwise the classifier conservatively holds the candidate.
        dependencySnapshotAvailable = freshDependencySnapshotAvailable;
        updateDependencySnapshot(freshDependencySnapshotAvailable);
      }
      freshNotesObj = {};
      for (const [path, text] of freshNoteTexts) freshNotesObj[path] = text;
      const freshBasenames = countSuccessorBasenames(this.app, freshTasks, identities, dailyPath, freshNoteTexts);
      updateBasenames(freshBasenames);
      let replanned = planFirst(
        selectedKeys,
        freshBefore,
        dailyFreshLines,
        freshTasks,
        freshNotesObj,
        freshClosing,
        selectedDestinations,
        freshRelationOptions,
        freshRelationRuntime.linkUnblocked,
      );
      if (!replanned) {
        replanned = plan;
        selectedKeys = [];
        selectedDestinations = new Map();
        closeRevalidatedKeys = new Set();
      } else {
        // Refuse stale/ambiguous picks individually; newly appearing
        // offers stay unpicked (no second picker).
        const freshKeys = new Set((replanned.offers || []).map((offer) => String(offer.key)));
        const refused = selectedKeys.filter((key) => !freshKeys.has(String(key)));
        // Ambiguous idless rebinding: when a note's digest count changed,
        // refuse every idless pick for that digest in that note.
        const ambiguousCloseKeys = successorOfferCloseAmbiguousKeys(
          [...selectedKeys, ...closeChoices.map((close) => String(close.key))],
          noteTextsObject,
          freshNotesObj,
        );
        for (const key of ambiguousCloseKeys) {
          if (selectedKeys.some((selected) => String(selected) === String(key)) &&
              !refused.includes(key)) {
            refused.push(key);
          }
        }
        closeRevalidatedKeys = new Set(closeChoices
          .map((close) => String(close.key))
          .filter((key) => freshKeys.has(key) && !ambiguousCloseKeys.has(key)));
        if (refused.length > 0) {
          replanned.refusedKeys = refused;
        }
        plan = replanned;
        // Swap working sets to the fresh texts for the apply below.
        tasks = freshTasks;
        closePassTasks = freshTasks;
        closePassNoteTexts = freshNotesObj;
        closePassDependencySnapshotAvailable = dependencySnapshotAvailable;
        for (const [path, text] of freshNoteTexts) {
          noteTexts.set(path, text);
        }
        dailyCurrent = dailyFresh;
        // dailyBefore/dailyAfter for insertion planning become fresh.
        dailyBefore = dailyFreshLines;
        dailyAfter = dailyFreshLines;
        planClosingEntry = freshClosing;
        selectedKeys = selectedKeys.filter((key) => !refused.includes(String(key)));
        if (refused.length > 0) {
          const refusedSet = new Set(refused.map(String));
          for (const key of [...selectedDestinations.keys()]) {
            if (refusedSet.has(String(key))) {
              selectedDestinations.delete(key);
            }
          }
        }
      }
    }
    return {
      plan, selectedKeys, selectedDestinations, closeRevalidatedKeys, closePassNoteTexts,
      closePassTasks, closePassDependencySnapshotAvailable, tasks, dailyCurrent,
      dailyBefore, dailyAfter, planClosingEntry, dependencySnapshotAvailable,
    };
  }

  async applySuccessorOfferCloseChoices(options = {}) {
    const closes = Array.isArray(options.closes) ? options.closes : [];
    if (closes.length === 0) return null;
    const successors = options.pickerApi || null;
    const capabilities = this.successorOfferCloseCapabilities(successors);
    const cardOffers = options.cardOffers instanceof Map ? options.cardOffers : new Map();
    const freshOffers = Array.isArray(options.freshOffers) ? options.freshOffers : [];
    const noteTexts = successorOfferClosePostPickNotes(options.noteTexts, options.plan);
    const paths = new Set();
    for (const close of closes) {
      const offer = cardOffers.get(String(close && close.key || ""));
      const path = String(offer && offer.notePath || offer && offer.task && offer.task.path || "");
      if (path) paths.add(path);
    }
    const active = options.context && typeof options.context === "object" ? options.context : {};
    const cache = new Map();
    if (options.dailyPath) paths.add(String(options.dailyPath));
    for (const path of paths) {
      let text = null;
      try {
        text = await this.readSuccessorNoteText(path, active, cache);
      } catch (_error) {
        text = null;
      }
      if (typeof text === "string") noteTexts.set(path, text);
      else noteTexts.delete(path);
    }
    const relocatedOffers = successorOfferCloseRelocatedOffers({
      closes,
      revalidatedKeys: options.revalidatedKeys,
      cardOffers,
      freshOffers,
      noteTexts,
      cardNoteTexts: options.cardNoteTexts,
    });
    const expectedLines = successorOfferCloseExpectedLines(
      closes,
      cardOffers,
      freshOffers,
      options.plan,
    );
    const dailyText = options.dailyPath ? noteTexts.get(String(options.dailyPath)) : null;
    const dailyLines = typeof dailyText === "string" ? dailyText.split(/\r?\n/) : [];
    const context = {
      ...active,
      today: options.today,
      dailyPath: String(options.dailyPath || ""),
      dailyBefore: dailyLines,
      dailyAfter: dailyLines,
      noteTexts,
      notePaths: Array.isArray(options.notePaths) ? options.notePaths.slice() : [...noteTexts.keys()],
      tasks: Array.isArray(options.tasks) ? options.tasks : [],
      dependencySnapshotAvailable: options.dependencySnapshotAvailable === true,
      markUnblockedLine: options.markUnblockedLine,
      hasLiveLink: successorOfferCloseLiveLinkCheck(dailyLines, options.dailyPath),
    };
    try {
      return await this.applyOfferClosesNow({
        closes,
        offers: relocatedOffers,
        expectedLines,
        noteTexts,
        context,
        cache: new Map(),
        capabilities,
      });
    } catch (_error) {
      return {
        offer_closes: [],
        offer_close_refused: {
          count: closes.length,
          rows: closes.map((close) => {
            const key = String(close && close.key || "");
            const offer = cardOffers.get(key);
            return {
              text: String(offer && offer.text || "task"),
              why: "The current task line could not be verified.",
            };
          }),
        },
        undo: null,
        resolved: [],
        failures: [{ kind: "write", reason: "The close could not be applied safely." }],
      };
    }
  }
}
