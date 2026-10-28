// Combined cancel/complete label policy (`docs/task-relations.md` §§17–18).
// The two kinds share one cache and one overlap check so a configured label
// can never carry both status effects.
const RELATIONS_CLOSE_LABELS_LIST_WARNINGS = Object.freeze({
  cancel:
    "invalid relations.cancel_labels in %s: expected a list of relation labels; cancelling nothing",
  complete:
    "invalid relations.complete_labels in %s: expected a list of relation labels; completing nothing",
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
    warnings: Object.freeze([]),
  });
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
    const field = kind === "cancel" ? "cancel_labels" : "complete_labels";
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
  const overlap = cancel.keys.filter((key) => complete.keys.includes(key));
  if (overlap.length > 0) {
    const cancelKeys = cancel.keys.filter((key) => !overlap.includes(key));
    const completeKeys = complete.keys.filter((key) => !overlap.includes(key));
    for (const key of overlap) {
      const label = cancel.labels[key] || complete.labels[key] || key;
      warnings.push(
        `relations: “${label}” is in both cancel_labels and complete_labels in ${configPath}; it closes nothing`,
      );
    }
    cancel = freezeRelationsCancelLabels(
      cancelKeys,
      Object.fromEntries(cancelKeys.map((key) => [key, cancel.labels[key]])),
    );
    complete = freezeRelationsCancelLabels(
      completeKeys,
      Object.fromEntries(completeKeys.map((key) => [key, complete.labels[key]])),
    );
  }
  emitRelationsCloseLabelWarnings(warnings, cacheKey, options.warn);
  return store(
    Object.freeze({
      cancel,
      complete,
      warnings: Object.freeze(warnings.slice()),
    }),
  );
}
