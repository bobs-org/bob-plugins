// Completion writer composition for §18. The preview and writer share this
// summary shape; only committed completion identities reach the post-Done API.
function relationTaskStatusCyclerApi(app) {
  return app && app.plugins && app.plugins.plugins &&
    app.plugins.plugins["task-status-cycler"] &&
    app.plugins.plugins["task-status-cycler"].api || null;
}

function planRelationClosingSource(details = {}) {
  const cancelPlan = planRelationCancelEffects({
    cancelLabels: details.cancelLabels,
    trigger: details.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER,
    sources: [details.source],
  });
  const cancel = cancelPlan.sources[0] || null;
  const source = {
    ...(details.source || {}),
    cancelTriggeringEdges: (cancel && cancel.triggeringEdges) || [],
  };
  const completePlan = planRelationCompleteEffects({
    completeLabels: details.completeLabels,
    trigger: details.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER,
    cyclerApiAvailable: details.cyclerApiAvailable === true,
    sources: [source],
  });
  return Object.freeze({
    cancel,
    complete: completePlan.sources[0] || null,
    cancelRefusal: cancel && cancel.refusal ? cancel : null,
    completeRefusal: completePlan.refusals[0] || null,
  });
}

function completeTaskIdFromLine(line) {
  const field = findBulletPropertyField(String(line || ""), "id");
  return normalizeBulletPropertyValue(field && field.value);
}

function summarizeRelationCompleteEffects(plan, day) {
  const sources = ((plan && plan.sources) || []).map((source) =>
    Object.freeze({
      path: source.path || "",
      identity: source.identity || "",
      verdict: source.verdict || "none",
      completes: source.completes === true,
      edges: Object.freeze(
        (source.triggeringEdges || []).map((edge) =>
          Object.freeze({
            action: relationCancelEdgeAction(edge),
            labelKey: relationCancelLabelKey(
              edge && (edge.label || edge.displayLabel),
            ),
            link: String((edge && (edge.storedTargetLink || edge.link)) || ""),
          }),
        ),
      ),
    }),
  );
  sources.sort((left, right) =>
    String(left.path).localeCompare(String(right.path)) ||
    String(left.identity).localeCompare(String(right.identity)),
  );
  return Object.freeze({ day: String(day || ""), sources: Object.freeze(sources) });
}

function summarizeRelationCloseEffects(cancelPlans, completePlan, day) {
  const byIdentity = new Map();
  const ensure = (source) => {
    const identity = String((source && source.identity) || "");
    if (!identity) return null;
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, {
        path: source.path || "",
        identity,
        cancel: null,
        complete: null,
      });
    }
    return byIdentity.get(identity);
  };
  for (const source of cancelPlans || []) {
    const entry = ensure(source);
    if (entry) entry.cancel = source;
  }
  for (const source of (completePlan && completePlan.sources) || []) {
    const entry = ensure(source);
    if (entry) entry.complete = source;
  }
  const sources = [...byIdentity.values()].map((entry) => {
    const cancel = entry.cancel;
    const complete = entry.complete;
    const cancelVerdict = (cancel && cancel.verdict) || "none";
    const completeVerdict = (complete && complete.verdict) || "none";
    const edges = [];
    const addEdges = (effect, plan) => {
      for (const edge of (plan && plan.triggeringEdges) || []) {
        edges.push(
          Object.freeze({
            effect,
            action: relationCancelEdgeAction(edge),
            labelKey: relationCancelLabelKey(
              edge && (edge.label || edge.displayLabel),
            ),
            link: String((edge && (edge.storedTargetLink || edge.link)) || ""),
          }),
        );
      }
    };
    addEdges("cancel", cancel);
    addEdges("complete", complete);
    let effect = "none";
    let verdict = "none";
    if (completeVerdict === "conflict") {
      verdict = completeVerdict;
    } else if (cancel && cancel.cancels === true) {
      effect = "cancel";
      verdict = "cancels";
    } else if (complete && complete.completes === true) {
      effect = "complete";
      verdict = "completes";
    } else if (completeVerdict !== "none" && completeVerdict !== "already_closed") {
      verdict = completeVerdict;
    } else if (cancelVerdict !== "none" && cancelVerdict !== "already_closed") {
      verdict = cancelVerdict;
    } else if (cancelVerdict === "already_closed" || completeVerdict === "already_closed") {
      verdict = "already_closed";
    }
    edges.sort((left, right) =>
      left.effect.localeCompare(right.effect) ||
      left.link.localeCompare(right.link) ||
      left.labelKey.localeCompare(right.labelKey),
    );
    return Object.freeze({
      path: entry.path,
      identity: entry.identity,
      verdict,
      effect,
      cancelVerdict,
      completeVerdict,
      edges: Object.freeze(edges),
    });
  });
  sources.sort((left, right) =>
    String(left.path).localeCompare(String(right.path)) ||
    String(left.identity).localeCompare(String(right.identity)),
  );
  return Object.freeze({ day: String(day || ""), sources: Object.freeze(sources) });
}

function relationCompleteRemovalStaysDone(rawLine, existingRows, removed, relabeled, completeLabels) {
  const status = relationCancelSourceStatus(rawLine);
  if (status !== "x" && status !== "X") return false;
  const configured = relationCompleteLabelsSet(completeLabels);
  const oldByIdentity = new Map(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => [row.identity, row]),
  );
  for (const target of [
    ...(Array.isArray(removed) ? removed : []),
    ...(Array.isArray(relabeled) ? relabeled : []),
  ]) {
    const identity = blocksIdentity(target && target.path, target && target.blockId);
    const old = oldByIdentity.get(identity);
    if (!old || !configured.has(relationCancelLabelKey(old.label))) continue;
    const next = (Array.isArray(removed) ? removed : []).includes(target)
      ? ""
      : relationCancelLabelKey(target && target.label);
    if (!next || !configured.has(next)) return true;
  }
  return false;
}

function withRelationCompleteStayNotice(notice, staysDone) {
  return notice && staysDone
    ? `${notice} · stays Done · reopen with Alt+[`
    : notice;
}

function withRelationCloseStayNotice(notice, staysCancelled, staysDone) {
  return withRelationCompleteStayNotice(
    withRelationCancelStayNotice(notice, staysCancelled),
    staysDone,
  );
}

function relationCloseEffectsEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function relationCloseExpectedMatchesCancelSummary(expected, cancelEffects) {
  if (!expected || !cancelEffects) return false;
  return relationCancelEffectsEqual(expected, cancelEffects);
}

function relationCloseCommitGate(details = {}) {
  const cancelPlans = Array.isArray(details.cancelSourcePlans)
    ? details.cancelSourcePlans
    : [];
  const completePlan = details.completePlan || { sources: [], completes: [], refusals: [] };
  const cancelRefusals = Array.isArray(details.cancelRefusals)
    ? details.cancelRefusals
    : [];
  const completeRefusals = Array.isArray(completePlan.refusals)
    ? completePlan.refusals
    : [];
  const cancelPlan = Object.freeze({
    sources: Object.freeze(cancelPlans.slice()),
    cancels: Object.freeze(cancelPlans.filter((entry) => entry && entry.cancels)),
    refusals: Object.freeze(cancelRefusals.slice()),
    refuse: cancelRefusals.length > 0,
  });
  const cancelEffects = summarizeRelationCancelEffects(cancelPlan, details.day);
  const closeEffects = summarizeRelationCloseEffects(
    cancelPlans,
    completePlan,
    details.day,
  );
  if (
    details.expectedCloseEffects &&
    !relationCloseEffectsEqual(details.expectedCloseEffects, closeEffects)
  ) {
    return Object.freeze({
      ok: false,
      reason: details.staleReason || "changed — reopen",
      notice: details.staleReason || "changed — reopen",
      stale: true,
      closeEffects,
      cancelEffects,
    });
  }
  if (
    !details.expectedCloseEffects &&
    details.expectedCancelEffects &&
    !relationCloseExpectedMatchesCancelSummary(
      details.expectedCancelEffects,
      cancelEffects,
    )
  ) {
    return Object.freeze({
      ok: false,
      reason: details.staleReason || "changed — reopen",
      notice: details.staleReason || "changed — reopen",
      stale: true,
      closeEffects,
      cancelEffects,
    });
  }
  const refusal =
    completeRefusals[0] && completeRefusals[0].refusal
      ? completeRefusals[0].refusal
      : cancelRefusals[0] && cancelRefusals[0].refusal;
  if (refusal) {
    return Object.freeze({
      ok: false,
      reason: refusal.code || "relation-close-refused",
      notice: refusal.message || null,
      stale: false,
      closeEffects,
      cancelEffects,
    });
  }
  return Object.freeze({
    ok: true,
    reason: null,
    notice: null,
    stale: false,
    closeEffects,
    cancelEffects,
  });
}

function applyRelationCloseStaleToPicker(picker, outcome) {
  if (!outcome || outcome.stale !== true) return false;
  if (picker) {
    picker.relationCloseExpected = null;
    picker.relationCancelExpected = outcome.cancelEffects || null;
    picker.relationCancelConfirmNonce = null;
    if (typeof picker.refreshRelationConsequenceStrip === "function") {
      try {
        picker.refreshRelationConsequenceStrip();
      } catch (_error) {
        // The next Return re-renders the live relation stage.
      }
    }
  }
  return true;
}

function completeTaskLineForRelation(api, rawLine, date, expectedBlockId) {
  const before = String(rawLine || "");
  if (!api || typeof api.completeTaskLineText !== "function") {
    return Object.freeze({ ok: false, reason: "cycler-api" });
  }
  let after;
  try {
    after = api.completeTaskLineText(before, { date });
  } catch (_error) {
    return Object.freeze({ ok: false, reason: "cycler-api" });
  }
  if (typeof after !== "string" || after === before) {
    return Object.freeze({ ok: false, reason: "unexpected-cycler-result" });
  }
  const blockId = getTrailingBlockId(after);
  const completion = findBulletPropertyField(after, "completion");
  if (
    getObsidianTaskCheckboxStatus(after) !== "x" ||
    !completion ||
    String(completion.value || "") !== date ||
    (expectedBlockId && blockId !== expectedBlockId) ||
    !isObsidianTaskAtLine(after, 0)
  ) {
    return Object.freeze({ ok: false, reason: "unexpected-cycler-result" });
  }
  return Object.freeze({ ok: true, lineText: after });
}

function foldRelationCompleteLine(content, planned, api, date, sourceLine) {
  const lines = String(content || "").split(/\r?\n/);
  const blockId = normalizeBulletPropertyValue((planned && planned.blockId) || "");
  let line = Math.floor(numericOrDefault(sourceLine, NaN));
  if (blockId) {
    const found = findTaskLineByTrailingBlockId(lines, blockId);
    if (found !== null) line = found;
  }
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
    return Object.freeze({ ok: false, reason: "source-not-found" });
  }
  const result = completeTaskLineForRelation(api, lines[line], date, blockId);
  if (!result.ok) return result;
  lines[line] = result.lineText;
  return Object.freeze({
    ok: true,
    content: lines.join(relationLineEnding(content)),
    line,
    rawLine: result.lineText,
  });
}

function relationCompleteIdentityKey(identity) {
  return `${normalizeVaultRelativePath(identity && identity.path)}\x00${normalizeBulletPropertyValue(identity && identity.blockId)}\x00${String((identity && identity.taskId) || "")}\x00${Math.floor(numericOrDefault(identity && identity.line, -1))}`;
}

function dedupeRelationCompleteIdentities(identities) {
  const seen = new Set();
  const result = [];
  for (const identity of Array.isArray(identities) ? identities : []) {
    const path = normalizeVaultRelativePath(identity && identity.path);
    const blockId = normalizeBulletPropertyValue(identity && identity.blockId);
    const taskId = String((identity && identity.taskId) || "");
    const line = Math.floor(numericOrDefault(identity && identity.line, -1));
    if (!path || (!blockId && !taskId && line < 0)) continue;
    const normalized = Object.freeze({
      path,
      blockId: blockId || null,
      taskId: taskId || null,
      ...(line >= 0 ? { line } : {}),
    });
    const key = relationCompleteIdentityKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return Object.freeze(result);
}

function buildRelationClosingNotice(details = {}) {
  const rows = Array.isArray(details.closingRows) ? details.closingRows : [];
  const relationNotice = details.relationNotice || null;
  const chips = [];
  const removed = Math.max(0, Math.floor(numericOrDefault(details.pomodoroLinksRemoved, 0)));
  const unblocked = Math.max(0, Math.floor(numericOrDefault(details.recovered, 0))) +
    Math.max(0, Math.floor(numericOrDefault(details.reopened, 0)));
  if (details.pruneFailed === true) chips.push("Pomodoro links not removed");
  else if (removed > 0) chips.push(`removed ${formatRelationCancelCount(removed, "Pomodoro link")}`);
  if (unblocked > 0) chips.push(`unblocked ${unblocked}`);
  if (details.recoveryFailed === true) chips.push("dependents not recovered");
  if (details.retirementFailed === true) chips.push("references not retired");
  const mirrorFailed = details.mirrorFailed;
  const formatRow = (row) => {
    const sourceName = String(row.sourceName || "task");
    const targetName = String(row.targetName || "task");
    const label = String(row.label || "").trim();
    const arrow = label ? ` — ${label} → ` : " → ";
    return `🪢 ${sourceName}${arrow}${targetName} · ${row.effect === "complete" ? "✓ done" : "⊘ cancelled"}`;
  };
  let notice;
  if (rows.length === 0) {
    notice = relationNotice;
  } else if (rows.length === 1) {
    notice = formatRow(rows[0]);
    if (relationNotice && rows[0].includeRelationNotice === true) {
      notice = `${notice} · ${relationNotice}`;
    }
  } else {
    notice = rows.map(formatRow).join(" · ");
    if (relationNotice) notice = `${notice} · ${relationNotice}`;
  }
  if (notice && chips.length > 0) notice = `${notice} · ${chips.join(" · ")}`;
  if (notice) notice = withLinkedFromFollowUpNotice(notice, mirrorFailed);
  const successorNotice =
    typeof details.successorNotice === "string" ? details.successorNotice.trim() : "";
  return [notice, successorNotice].filter(Boolean).join("\n") || null;
}

class BobNavigationHotkeysRelationCompleteComposeMixin {
  async finalizeRelationCompleteOutcome(outcome, options = {}) {
    const result = outcome || {};
    const identities = dedupeRelationCompleteIdentities(result.completedIdentities);
    if (identities.length === 0) return result;
    const picker = options.picker || this.activeBulletPropertyPicker || null;
    const key = identities.map(relationCompleteIdentityKey).join("\n");
    if (picker && picker.relationCloseFinalizationKey === key) {
      return picker.relationCloseFinalizationPromise || result;
    }
    let resolveFinalization;
    const pending = new Promise((resolve) => { resolveFinalization = resolve; });
    if (picker) {
      picker.relationCloseFinalizationKey = key;
      picker.relationCloseFinalizationPromise = pending;
      picker.reviewSettleDeferred = true;
      if (typeof picker.clearPendingBatch === "function") picker.clearPendingBatch();
      picker.pendingRelation = null;
      picker.relationLabelBuffer = "";
      try {
        if (typeof picker.close === "function") picker.close();
      } catch (_error) {
        // The modal must be closed before successor selection can open.
      }
    }
    const activePath = normalizeVaultRelativePath(
      options.activePath || (picker && picker.filePath) || result.activePath || "",
    );
    const editor =
      options.editor ||
      (picker && picker.editor) ||
      (typeof this.findRelationEditOpenEditor === "function"
        ? this.findRelationEditOpenEditor(activePath)
        : null);
    const cycler =
      this.app && this.app.plugins && this.app.plugins.plugins &&
      this.app.plugins.plugins["task-status-cycler"];
    const api = cycler && cycler.api;
    let finalization = {
      reopened: 0,
      retired: 0,
      recoveryFailures: [],
      retirementFailures: [],
      successors: null,
      successorNotice: null,
    };
    if (relationCompleteCyclerApiAvailable(api)) {
      try {
        const actual = await api.finalizeClosedTasks(identities, {
          activePath,
          editor,
          successorNoticeTarget: "return",
        });
        if (actual && typeof actual === "object") {
          finalization = {
            ...finalization,
            ...actual,
            reopened: Math.max(0, Math.floor(numericOrDefault(actual.reopened, 0))),
            recoveryFailures: Array.isArray(actual.recoveryFailures) ? actual.recoveryFailures : [],
            retirementFailures: Array.isArray(actual.retirementFailures) ? actual.retirementFailures : [],
          };
        }
      } catch (error) {
        finalization.recoveryFailures = [error && error.message ? error.message : String(error)];
      }
    } else {
      finalization.recoveryFailures = ["Task Status Cycler API v3 is unavailable"];
    }
    const completionNotice = buildRelationClosingNotice({
      closingRows: result.closingRows,
      relationNotice: result.relationNotice,
      pruneFailed: result.pruneFailed,
      pomodoroLinksRemoved: result.pomodoroLinksRemoved,
      recovered: result.recovered,
      reopened: finalization.reopened,
      recoveryFailed: finalization.recoveryFailures.length > 0,
      retirementFailed: finalization.retirementFailures.length > 0,
      mirrorFailed: result.mirrorFailed,
      successorNotice: finalization.successorNotice,
    });
    const walkOrigin = picker && picker.reviewOrigin ? picker.reviewOrigin : null;
    let noticeDisplayed = false;
    try {
      if (walkOrigin && typeof picker.settleReviewOrigin === "function") {
        const activeCompleted = identities.some((identity) => identity.path === activePath);
        await picker.settleReviewOrigin(activeCompleted ? "complete" : "noop", {
          notice: completionNotice,
        });
        noticeDisplayed = true;
      }
    } catch (_error) {
      noticeDisplayed = false;
    }
    const completed = Object.freeze({
      ...result,
      completedIdentities: identities,
      finalization: Object.freeze(finalization),
      notice: noticeDisplayed ? null : completionNotice,
      noticeDisplayed,
    });
    if (picker) resolveFinalization(completed);
    return completed;
  }
}
