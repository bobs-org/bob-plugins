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
    (model.offer_close_refused && Number(model.offer_close_refused.count) > 0) ||
    (Array.isArray(model.failures) && model.failures.length > 0)
  ));
}

function successorOfferCloseNoticeText(model, baseText) {
  const source = model && typeof model === "object" ? model : {};
  const lines = [];
  if (typeof baseText === "string" && baseText) lines.push(baseText);
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
    if (failure && failure.reason) lines.push(`⚠ ${failure.kind === "recovery" ? "Recovery failed" : "Close write failed"}: ${failure.reason}`);
  }
  return lines.join("\n");
}

class TaskStatusCyclerSuccessorOfferCloseIntegrationMixin {
  successorOfferCloseCapabilities(successors) {
    return successorOfferCloseIntegrationCapabilities(this, successors);
  }

  async pickSuccessorOfferChoices(options = {}) {
    const offers = Array.isArray(options.offers) ? options.offers : [];
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
    } catch (_error) {
      model = null;
    }
    if (!model || !Array.isArray(model.groups) || !model.groups.some((group) =>
      Array.isArray(group.rows) && group.rows.some((row) => row.selectable),
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
