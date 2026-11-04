// Combined cancel/complete/successor/merge label policy
// (`docs/task-relations.md` §§17–18, §20 SU2, and §21 ML1). The four kinds
// share one cache and one overlap check so a configured label can never
// carry more than one effect: a key listed in two or more lists has no
// effect and is dropped from every list.
const RELATIONS_CLOSE_LABELS_LIST_WARNINGS = Object.freeze({
  cancel:
    "invalid relations.cancel_labels in %s: expected a list of relation labels; cancelling nothing",
  complete:
    "invalid relations.complete_labels in %s: expected a list of relation labels; completing nothing",
  successor:
    "invalid relations.successor_labels in %s: expected a list of relation labels; offering nothing",
  merge:
    "invalid relations.merge_labels in %s: expected a list of relation labels; merging nothing",
});

let relationsCloseLabelsConfigCache = {
  key: null,
  value: emptyRelationsCloseLabels(),
};
let relationsCloseLabelsWarnedKey = null;

function emptyRelationsCloseLabels() {
  return Object.freeze({
    cancel: emptyRelationsCancelLabels(),
    complete: emptyRelationsCancelLabels(),
    successor: emptyRelationsCancelLabels(),
    merge: emptyRelationsCancelLabels(),
    warnings: Object.freeze([]),
  });
}

function relationMergeLabelsSet(mergeLabels) {
  return relationCancelLabelsSet(mergeLabels);
}

function relationSuccessorLabelsSet(successorLabels) {
  return relationCancelLabelsSet(successorLabels);
}

function relationLabelEffectForKey(key, closeConfig) {
  const normalized = relationCancelLabelKey(key);
  if (!normalized) return null;
  if (
    closeConfig &&
    closeConfig.cancel &&
    relationCancelLabelsSet(closeConfig.cancel).has(normalized)
  ) {
    return "cancel";
  }
  if (
    closeConfig &&
    closeConfig.complete &&
    relationCancelLabelsSet(closeConfig.complete).has(normalized)
  ) {
    return "complete";
  }
  if (
    closeConfig &&
    closeConfig.successor &&
    relationCancelLabelsSet(closeConfig.successor).has(normalized)
  ) {
    return "successor";
  }
  if (
    closeConfig &&
    closeConfig.merge &&
    relationCancelLabelsSet(closeConfig.merge).has(normalized)
  ) {
    return "merge";
  }
  return null;
}

function relationSuccessorLabelForInverseKey(key, closeConfig) {
  const normalized = relationCancelLabelKey(key);
  if (!normalized || !closeConfig || !closeConfig.successor) return null;
  const keys = Array.isArray(closeConfig.successor.keys)
    ? closeConfig.successor.keys
    : [];
  const labels = closeConfig.successor.labels &&
      typeof closeConfig.successor.labels === "object"
    ? closeConfig.successor.labels
    : {};
  for (const configuredKey of keys) {
    const configuredLabel = String(labels[configuredKey] || configuredKey || "");
    const inverse = inverseRelationPhrase(configuredLabel);
    if (
      inverse &&
      !inverse.endsWith(" → this") &&
      relationCancelLabelKey(inverse) === normalized
    ) {
      return configuredLabel;
    }
  }
  return null;
}

function resetRelationsCloseLabelsConfigCache() {
  relationsCloseLabelsConfigCache = {
    key: null,
    value: emptyRelationsCloseLabels(),
  };
  relationsCloseLabelsWarnedKey = null;
  relationsCancelLabelsConfigCache = {
    key: null,
    value: emptyRelationsCancelLabels(),
  };
  relationsCancelLabelsWarnedKey = null;
}

function emitRelationsCloseLabelWarnings(messages, cacheKey, emit) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  if (cacheKey != null && relationsCloseLabelsWarnedKey === cacheKey) return;
  if (cacheKey != null) relationsCloseLabelsWarnedKey = cacheKey;
  const warn =
    typeof emit === "function"
      ? emit
      : typeof console !== "undefined" && typeof console.warn === "function"
        ? (message) => console.warn(message)
        : null;
  if (warn) for (const message of messages) warn(message);
}

function loadRelationsCloseLabels(options = {}) {
  const empty = emptyRelationsCloseLabels();
  const env =
    options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule =
    options.osModule === undefined
      ? requireOptionalNodeModule("os")
      : options.osModule;
  const fsModule =
    options.fsModule === undefined
      ? requireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    relationsCloseLabelsConfigCache = { key: null, value: empty };
    return empty;
  }
  const configPath =
    options.configPath || getBulletPropertyConfigPath({ env, osModule });
  const statKey = blocksLinesConfigStatKey(fsModule, configPath);
  const cacheKey = statKey == null ? null : `${configPath}|${statKey}`;
  if (
    cacheKey != null &&
    relationsCloseLabelsConfigCache.key === cacheKey
  ) {
    return relationsCloseLabelsConfigCache.value;
  }
  const store = (value) => {
    relationsCloseLabelsConfigCache = { key: cacheKey, value };
    return value;
  };

  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (_error) {
    return store(empty);
  }
  const parse = options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof parse !== "function") return store(empty);
  let config;
  try {
    config = parse(rawConfig);
  } catch (_error) {
    return store(empty);
  }

  const relations = config && config.relations;
  const warnings = [];
  const parseList = (kind) => {
    const field = kind === "cancel"
      ? "cancel_labels"
      : kind === "complete"
        ? "complete_labels"
        : kind === "merge"
          ? "merge_labels"
          : "successor_labels";
    const value = relations && relations[field];
    if (value === undefined || value === null) {
      return freezeRelationsCancelLabels([], {});
    }
    if (!Array.isArray(value)) {
      warnings.push(
        RELATIONS_CLOSE_LABELS_LIST_WARNINGS[kind].replace("%s", configPath),
      );
      return freezeRelationsCancelLabels([], {});
    }
    const keys = [];
    const labels = {};
    const seen = new Set();
    for (const entry of value) {
      if (typeof entry !== "string") {
        warnings.push(
          `invalid relations.${field} entry in ${configPath}: expected a relation label string`,
        );
        continue;
      }
      const normalized = normalizeRelationLabel(entry);
      if (!normalized) {
        warnings.push(
          `invalid relations.${field} entry in ${configPath}: not a legal relation label`,
        );
        continue;
      }
      const key = relationCancelLabelKey(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      labels[key] = normalized;
    }
    return freezeRelationsCancelLabels(keys, labels);
  };

  let cancel = parseList("cancel");
  let complete = parseList("complete");
  let successor = parseList("successor");
  let merge = parseList("merge");
  const countIn = (key) =>
    (cancel.keys.includes(key) ? 1 : 0) +
    (complete.keys.includes(key) ? 1 : 0) +
    (successor.keys.includes(key) ? 1 : 0) +
    (merge.keys.includes(key) ? 1 : 0);
  const overlap = [...new Set([...cancel.keys, ...complete.keys, ...successor.keys, ...merge.keys])]
    .filter((key) => countIn(key) > 1);
  if (overlap.length > 0) {
    const cancelKeys = cancel.keys.filter((key) => !overlap.includes(key));
    const completeKeys = complete.keys.filter((key) => !overlap.includes(key));
    const successorKeys = successor.keys.filter((key) => !overlap.includes(key));
    const mergeKeys = merge.keys.filter((key) => !overlap.includes(key));
    for (const key of overlap) {
      // Mirror `task_merge::overlapping_effect_keys`: a merge-involved
      // overlap names merge_labels; a bare cancel+complete overlap keeps
      // its legacy "closes nothing" copy; anything else names the three
      // legacy lists.
      const mergeInvolved = merge.keys.includes(key);
      if (mergeInvolved) {
        const label = merge.labels[key] || successor.labels[key] ||
          cancel.labels[key] || complete.labels[key] || key;
        warnings.push(
          `relations: “${label}” is in merge_labels and another effect list in ${configPath}; it has no effect`,
        );
      } else if (
        successor.keys.includes(key) ||
        !(cancel.keys.includes(key) && complete.keys.includes(key))
      ) {
        const label = successor.labels[key] || cancel.labels[key] ||
          complete.labels[key] || key;
        warnings.push(
          `relations: “${label}” is in more than one of cancel_labels, complete_labels, successor_labels in ${configPath}; it has no effect`,
        );
      } else {
        const label = cancel.labels[key] || complete.labels[key] || key;
        warnings.push(
          `relations: “${label}” is in both cancel_labels and complete_labels in ${configPath}; it closes nothing`,
        );
      }
    }
    cancel = freezeRelationsCancelLabels(
      cancelKeys,
      Object.fromEntries(cancelKeys.map((key) => [key, cancel.labels[key]])),
    );
    complete = freezeRelationsCancelLabels(
      completeKeys,
      Object.fromEntries(completeKeys.map((key) => [key, complete.labels[key]])),
    );
    successor = freezeRelationsCancelLabels(
      successorKeys,
      Object.fromEntries(successorKeys.map((key) => [key, successor.labels[key]])),
    );
    merge = freezeRelationsCancelLabels(
      mergeKeys,
      Object.fromEntries(mergeKeys.map((key) => [key, merge.labels[key]])),
    );
  }
  emitRelationsCloseLabelWarnings(warnings, cacheKey, options.warn);
  return store(
    Object.freeze({
      cancel,
      complete,
      successor,
      merge,
      warnings: Object.freeze(warnings.slice()),
    }),
  );
}
