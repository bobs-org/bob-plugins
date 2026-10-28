// Pure cancel-label policy (`docs/task-relations.md` §17). This is the
// verdict authority for the relation writer and for the next phase's cue.
// Matching uses `relation_label_key` (trim, collapse whitespace, strip one
// trailing colon, Unicode lowercase). Same-edge/same-key re-adds, including
// spelling/case-only changes, never cancel. Unlink, mirrors, hand edits,
// reconcile, rename, sync, and config changes never cancel.

const RELATION_CANCEL_EXPLICIT_TRIGGER = "explicit";
const RELATION_CANCEL_OPEN_STATUSES = OPEN_OBSIDIAN_TASK_STATUSES;
const RELATION_CANCEL_CONFLICT_MODIFIERS = Object.freeze(["!", "=", ":", "&", "*"]);

function relationCancelLabelKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/u, "")
    .trim()
    .toLowerCase();
}

function relationCancelLabelsSet(cancelLabels) {
  if (!cancelLabels) return new Set();
  if (cancelLabels instanceof Set) return cancelLabels;
  if (Array.isArray(cancelLabels)) {
    return new Set(
      cancelLabels.map((entry) => relationCancelLabelKey(entry)).filter(Boolean),
    );
  }
  if (Array.isArray(cancelLabels.keys)) {
    return new Set(
      cancelLabels.keys.map((entry) => relationCancelLabelKey(entry)).filter(Boolean),
    );
  }
  return new Set();
}

function relationCancelEdgeAction(edge) {
  const action = String((edge && edge.action) || "");
  if (action === "added" || action === "relabeled" || action === "unchanged" || action === "removed") {
    return action;
  }
  return "unchanged";
}

function relationCancelNormalizedKeysEqual(left, right) {
  const leftKey = relationCancelLabelKey(left);
  const rightKey = relationCancelLabelKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}

function relationCancelFallbackReason(edges) {
  const parts = [];
  for (const edge of edges || []) {
    const label = String((edge && (edge.label || edge.displayLabel)) || "").trim();
    const link = String((edge && (edge.storedTargetLink || edge.link)) || "").trim();
    if (!label || !link) continue;
    parts.push(`🪢 ${label} ${link}`);
  }
  return parts.join(" · ");
}

function relationCancelSourceIdentityKey(source) {
  const path = normalizeVaultRelativePath((source && source.path) || "");
  const blockId = normalizeBulletPropertyValue((source && source.blockId) || "");
  if (path && blockId) return `${path}\x00${blockId}`;
  const line = Math.floor(numericOrDefault(source && source.line, NaN));
  if (path && Number.isFinite(line)) return `${path}\x00line:${line}`;
  return path || "";
}

function verdictRelationCancelSource(source, configuredKeys, trigger) {
  const explicit = trigger === RELATION_CANCEL_EXPLICIT_TRIGGER;
  const edges = Array.isArray(source && source.edges) ? source.edges : [];
  const triggering = [];
  if (explicit) {
    for (const edge of edges) {
      const action = relationCancelEdgeAction(edge);
      if (action !== "added" && action !== "relabeled") continue;
      const label = edge && (edge.label || edge.displayLabel);
      const labelKey = relationCancelLabelKey(label);
      if (!labelKey || !configuredKeys.has(labelKey)) continue;
      const previous = edge && (edge.previousLabel || edge.previous_label);
      if (
        previous != null &&
        previous !== undefined &&
        String(previous) !== "" &&
        relationCancelNormalizedKeysEqual(previous, label)
      ) {
        continue;
      }
      triggering.push(edge);
    }
  }

  const isRecurring = source && source.isRecurring === true;
  const isNew = source && source.isNew === true;
  const modifiers = Array.isArray(source && source.itemModifiers)
    ? source.itemModifiers
    : [];
  const hasConflict = modifiers.some((entry) =>
    RELATION_CANCEL_CONFLICT_MODIFIERS.includes(String(entry)),
  );
  const status = source && source.status != null ? String(source.status) : " ";
  const isOpen = RELATION_CANCEL_OPEN_STATUSES.has(status);
  const wouldCancel = triggering.length > 0;

  let verdict = "none";
  let cancels = false;
  let refusal = null;
  if (!wouldCancel) {
    verdict = "none";
  } else if (isRecurring) {
    verdict = "recurring";
    refusal = Object.freeze({
      code: "relation_cancels_recurring_task",
      message:
        "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
    });
  } else if (isNew) {
    verdict = "new_task";
    refusal = Object.freeze({
      code: "relation_cancels_new_task",
      message: "new task sources cannot be cancelled by a relation",
    });
  } else if (hasConflict) {
    verdict = "conflict";
    refusal = Object.freeze({
      code: "relation_cancel_conflicts_with_item_action",
      message: "cancel conflicts with another action on the same item",
    });
  } else if (!isOpen) {
    verdict = "already_closed";
  } else {
    verdict = "cancels";
    cancels = true;
  }

  return Object.freeze({
    path: normalizeVaultRelativePath((source && source.path) || ""),
    blockId: normalizeBulletPropertyValue((source && source.blockId) || "") || null,
    line: Number.isInteger(source && source.line) ? source.line : null,
    identity: relationCancelSourceIdentityKey(source),
    status,
    isProject: source && source.isProject === true,
    verdict,
    cancels,
    triggeringEdges: Object.freeze(triggering.slice()),
    fallbackReason: cancels ? relationCancelFallbackReason(triggering) : "",
    refusal,
  });
}

function planRelationCancelEffects(args = {}) {
  const configuredKeys = relationCancelLabelsSet(args.cancelLabels);
  const trigger = args.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER;
  const rawSources = Array.isArray(args.sources)
    ? args.sources
    : args.source
      ? [args.source]
      : [];
  const seen = new Set();
  const sources = [];
  const refusals = [];
  const cancels = [];
  for (const source of rawSources) {
    const planned = verdictRelationCancelSource(source, configuredKeys, trigger);
    const identity = planned.identity || `anon:${sources.length}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    sources.push(planned);
    if (planned.refusal) refusals.push(planned);
    if (planned.cancels) cancels.push(planned);
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    cancels: Object.freeze(cancels),
    refusals: Object.freeze(refusals),
    refuse: refusals.length > 0,
  });
}

function planRelationCancelEffectsFromVector(vector) {
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
    edges: [
      {
        action: vector.action,
        label: vector.label,
        previousLabel: vector.previous_label,
        storedTargetLink: "[[#^target]]",
      },
    ],
  };
  return planRelationCancelEffects({
    cancelLabels: vector.configured,
    trigger: vector.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER,
    sources: [source],
  });
}

function summarizeRelationCancelEffects(plan, day) {
  const sources = ((plan && plan.sources) || []).map((source) =>
    Object.freeze({
      path: source.path || "",
      identity: source.identity || "",
      verdict: source.verdict || "none",
      cancels: source.cancels === true,
      edges: Object.freeze(
        (source.triggeringEdges || []).map((edge) =>
          Object.freeze({
            action: relationCancelEdgeAction(edge),
            labelKey: relationCancelLabelKey(edge && (edge.label || edge.displayLabel)),
            link: String((edge && (edge.storedTargetLink || edge.link)) || ""),
          }),
        ),
      ),
    }),
  );
  sources.sort((left, right) => {
    const byPath = String(left.path).localeCompare(String(right.path));
    if (byPath !== 0) return byPath;
    return String(left.identity).localeCompare(String(right.identity));
  });
  return Object.freeze({
    day: String(day || ""),
    sources: Object.freeze(sources),
  });
}

function relationCancelEffectsEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function relationCancelEdgeFromReport(link, action, label, previousLabel, target) {
  return Object.freeze({
    action,
    label: label || null,
    previousLabel: previousLabel || null,
    storedTargetLink: link,
    target: target || null,
  });
}

function deriveRelationCancelEdges(details = {}) {
  const report = details.report || {};
  const added = Array.isArray(report.added) ? report.added : [];
  const relabeled = Array.isArray(report.relabeled) ? report.relabeled : [];
  const unchanged = Array.isArray(report.unchanged) ? report.unchanged : [];
  const existingRows = Array.isArray(details.existingRows)
    ? details.existingRows
    : [];
  const liveAdd = Array.isArray(details.liveAdd) ? details.liveAdd : [];
  const liveRelabel = Array.isArray(details.liveRelabel)
    ? details.liveRelabel
    : [];
  const sourcePath = details.sourcePath;
  const vaultFiles = details.vaultFiles;
  const edges = [];
  const seen = new Set();
  const previousLabelFor = (link) => {
    const row = existingRows.find((entry) => entry && entry.link === link);
    return row && row.label ? row.label : null;
  };
  const push = (target, reportedAction) => {
    const link = storedRelationLinkForTarget(
      existingRows,
      target,
      sourcePath,
      vaultFiles,
    );
    if (!link || seen.has(link)) return;
    seen.add(link);
    let action = reportedAction;
    const previousLabel = previousLabelFor(link);
    const label = target && target.label !== undefined ? target.label : null;
    if (
      action === "relabeled" &&
      relationCancelNormalizedKeysEqual(previousLabel, label)
    ) {
      action = "unchanged";
    }
    edges.push(relationCancelEdgeFromReport(link, action, label, previousLabel, target));
  };
  for (const target of liveAdd) {
    const link = storedRelationLinkForTarget(
      existingRows,
      target,
      sourcePath,
      vaultFiles,
    );
    const action = added.includes(link)
      ? "added"
      : relabeled.includes(link)
        ? "relabeled"
        : unchanged.includes(link)
          ? "unchanged"
          : null;
    if (action) push(target, action);
  }
  for (const target of liveRelabel) {
    const link = storedRelationLinkForTarget(
      existingRows,
      target,
      sourcePath,
      vaultFiles,
    );
    if (seen.has(link)) continue;
    const action = relabeled.includes(link) ? "relabeled" : "unchanged";
    push(target, action);
  }
  return edges;
}
