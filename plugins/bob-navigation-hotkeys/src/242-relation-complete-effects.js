// Pure complete-label policy (`docs/task-relations.md` §18). Edge deltas
// come from `deriveRelationCancelEdges`, shared with the cancel writer.
const RELATION_COMPLETE_CONFLICT_MODIFIERS = Object.freeze([
  "!",
  "=",
  ":",
  "&",
  "*",
]);

function relationCompleteLabelsSet(labels) {
  return relationCancelLabelsSet(labels);
}

function relationCompleteCyclerApiAvailable(api) {
  return Boolean(
    api &&
      Number(api.version) >= 3 &&
      typeof api.completeTaskLineText === "function" &&
      typeof api.finalizeClosedTasks === "function",
  );
}

function verdictRelationCompleteSource(source, configuredKeys, trigger, apiAvailable) {
  const edges = Array.isArray(source && source.edges) ? source.edges : [];
  const triggering = [];
  if (trigger === RELATION_CANCEL_EXPLICIT_TRIGGER) {
    for (const edge of edges) {
      const action = relationCancelEdgeAction(edge);
      if (action !== "added" && action !== "relabeled") continue;
      const label = edge && (edge.label || edge.displayLabel);
      const key = relationCancelLabelKey(label);
      if (!key || !configuredKeys.has(key)) continue;
      const previous = edge && (edge.previousLabel || edge.previous_label);
      if (
        previous != null &&
        String(previous) !== "" &&
        relationCancelNormalizedKeysEqual(previous, label)
      ) {
        continue;
      }
      triggering.push(edge);
    }
  }

  const modifiers = Array.isArray(source && source.itemModifiers)
    ? source.itemModifiers.map(String)
    : [];
  const hasConflict = modifiers.some((entry) =>
    RELATION_COMPLETE_CONFLICT_MODIFIERS.includes(entry),
  );
  const cancelEdges = Array.isArray(source && source.cancelTriggeringEdges)
    ? source.cancelTriggeringEdges
    : [];
  const bothEffects =
    cancelEdges.length > 0 || modifiers.includes("cancel_label");
  const status = source && source.status != null ? String(source.status) : " ";
  const wouldComplete = triggering.length > 0;
  let verdict = "none";
  let completes = false;
  let refusal = null;
  if (!wouldComplete) {
    verdict = "none";
  } else if (bothEffects) {
    verdict = "conflict";
    refusal = Object.freeze({
      code: "relation_close_effects_conflict",
      message: "A task cannot be cancelled and completed in one relation commit",
    });
  } else if (source && source.isRecurring === true) {
    verdict = "recurring";
    refusal = Object.freeze({
      code: "relation_completes_recurring_task",
      message:
        "Recurring tasks are completed with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
    });
  } else if (source && source.isNew === true) {
    verdict = "new_task";
    refusal = Object.freeze({
      code: "relation_completes_new_task",
      message: "new task sources cannot be completed by a relation",
    });
  } else if (hasConflict) {
    verdict = "conflict";
    refusal = Object.freeze({
      code: "relation_complete_conflicts_with_item_action",
      message: "complete conflicts with another action on the same item",
    });
  } else if (!RELATION_CANCEL_OPEN_STATUSES.has(status)) {
    verdict = "already_closed";
  } else if (apiAvailable !== true) {
    verdict = "cycler_api";
    refusal = Object.freeze({
      code: "relation_complete_cycler_api_required",
      message: "Update Task Status Cycler to complete from a link",
    });
  } else {
    verdict = "completes";
    completes = true;
  }

  return Object.freeze({
    path: normalizeVaultRelativePath((source && source.path) || ""),
    blockId: normalizeBulletPropertyValue((source && source.blockId) || "") || null,
    line: Number.isInteger(source && source.line) ? source.line : null,
    identity: relationCancelSourceIdentityKey(source),
    status,
    isProject: source && source.isProject === true,
    verdict,
    completes,
    triggeringEdges: Object.freeze(triggering.slice()),
    refusal,
  });
}

function planRelationCompleteEffects(args = {}) {
  const configuredKeys = relationCompleteLabelsSet(args.completeLabels);
  const trigger = args.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER;
  const apiAvailable = args.cyclerApiAvailable !== false;
  const rawSources = Array.isArray(args.sources)
    ? args.sources
    : args.source
      ? [args.source]
      : [];
  const seen = new Set();
  const sources = [];
  const refusals = [];
  const completes = [];
  for (const source of rawSources) {
    const planned = verdictRelationCompleteSource(
      source,
      configuredKeys,
      trigger,
      apiAvailable,
    );
    const identity = planned.identity || `anon:${sources.length}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    sources.push(planned);
    if (planned.refusal) refusals.push(planned);
    if (planned.completes) completes.push(planned);
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    completes: Object.freeze(completes),
    refusals: Object.freeze(refusals),
    refuse: refusals.length > 0,
  });
}

function planRelationCompleteEffectsFromVector(vector) {
  const cancelLabels = Array.isArray(vector && vector.configured_cancel)
    ? vector.configured_cancel
    : [];
  const completeLabels = Array.isArray(vector && vector.configured_complete)
    ? vector.configured_complete
    : [];
  const cancelKeys = new Set(cancelLabels.map(relationCancelLabelKey));
  const completeKeys = new Set(completeLabels.map(relationCancelLabelKey));
  const overlap = new Set([...cancelKeys].filter((key) => completeKeys.has(key)));
  const effectiveCancel = cancelLabels.filter((entry) => !overlap.has(relationCancelLabelKey(entry)));
  const effectiveComplete = completeLabels.filter((entry) => !overlap.has(relationCancelLabelKey(entry)));
  const cancelTrigger =
    effectiveCancel.some((entry) => relationCancelLabelKey(entry) === relationCancelLabelKey(vector && vector.label))
      ? [{ label: vector.label, action: vector.action }]
      : [];
  const source = {
    path: "vector.md",
    blockId: "source",
    line: 0,
    status: vector.source_status,
    isNew: vector.source_is_new === true,
    isProject: vector.source_is_project === true,
    isRecurring: vector.source_is_recurring === true,
    itemModifiers: Array.isArray(vector.item_modifiers)
      ? vector.item_modifiers
      : [],
    cancelTriggeringEdges: cancelTrigger,
    edges: [
      {
        action: vector.action,
        label: vector.label,
        previousLabel: vector.previous_label,
        storedTargetLink: "[[#^target]]",
      },
    ],
  };
  return planRelationCompleteEffects({
    completeLabels: effectiveComplete,
    trigger: vector.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER,
    sources: [source],
  });
}
