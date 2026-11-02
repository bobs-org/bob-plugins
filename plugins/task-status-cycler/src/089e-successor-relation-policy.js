// Cached successor-label policy (`docs/task-relations.md` §20 SU2 and
// `docs/task-dependencies.md` §12.18). Three effect lists share one
// overlap check so a key listed in two or more of cancel/complete/successor
// has no effect. Independent of navigation's private loaders. Missing YAML
// support or an unreadable config never throws from a gesture.

const RELATIONS_CLOSE_LABELS_LIST_WARNINGS = Object.freeze({
  cancel:
    "invalid relations.cancel_labels in %s: expected a list of relation labels; cancelling nothing",
  complete:
    "invalid relations.complete_labels in %s: expected a list of relation labels; completing nothing",
  successor:
    "invalid relations.successor_labels in %s: expected a list of relation labels; offering nothing",
});

const RELATION_LABEL_FORBIDDEN_RE = /[\[\]()"\\|•*~\u0000-\u001f\u007f-\u009f]/u;
const RELATION_SUCCESSOR_INVERSE_NAMED_PAIRS = Object.freeze({
  "duplicate of": "duplicated by",
  "follow-up of": "followed up by",
  "merged into": "merged from",
  "split from": "split into",
  "starts after": "starts before",
});

let relationSuccessorLabelsCache = {
  key: null,
  value: emptyRelationCloseLabels(),
};
let relationSuccessorLabelsWarnedKey = null;

function relationLabelIsReservedStart(value) {
  const text = String(value || "");
  if (!text) return false;
  try {
    return Array.from(text)[0] === "💬";
  } catch (_error) {
    return text.codePointAt(0) === 0x1f4ac;
  }
}

function normalizeRelationLabel(value) {
  if (typeof value !== "string") return null;
  const label = String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/, "")
    .trim();
  const length = Array.from(label).length;
  if (
    length < 1 ||
    length > 40 ||
    RELATION_LABEL_FORBIDDEN_RE.test(label) ||
    /^[·,]/u.test(label) ||
    relationLabelIsReservedStart(label)
  ) {
    return null;
  }
  return label;
}

function normalizeRelationReaderLabel(value) {
  const label = String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/, "")
    .trim();
  if (!label || RELATION_LABEL_FORBIDDEN_RE.test(label) || /^[·,]/u.test(label)) {
    return null;
  }
  return label;
}

function relationLabelKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/u, "")
    .trim()
    .toLowerCase();
}

function relationCancelLabelKey(value) {
  return relationLabelKey(value);
}

function emptyRelationLabelList() {
  return Object.freeze({
    keys: Object.freeze([]),
    labels: Object.freeze({}),
  });
}

function emptyRelationCloseLabels() {
  return Object.freeze({
    cancel: emptyRelationLabelList(),
    complete: emptyRelationLabelList(),
    successor: emptyRelationLabelList(),
    warnings: Object.freeze([]),
  });
}

function freezeRelationLabelList(keys, labels) {
  return Object.freeze({
    keys: Object.freeze(keys.slice()),
    labels: Object.freeze({ ...labels }),
  });
}

function relationLabelListSet(list) {
  if (!list) return new Set();
  if (list instanceof Set) return list;
  if (Array.isArray(list)) {
    return new Set(list.map((entry) => relationLabelKey(entry)).filter(Boolean));
  }
  if (Array.isArray(list.keys)) {
    return new Set(list.keys.map((entry) => relationLabelKey(entry)).filter(Boolean));
  }
  return new Set();
}

function relationLabelEffectForKey(key, closeConfig) {
  const normalized = relationLabelKey(key);
  if (!normalized) return null;
  if (closeConfig && closeConfig.cancel && relationLabelListSet(closeConfig.cancel).has(normalized)) {
    return "cancel";
  }
  if (
    closeConfig && closeConfig.complete &&
    relationLabelListSet(closeConfig.complete).has(normalized)
  ) {
    return "complete";
  }
  if (
    closeConfig && closeConfig.successor &&
    relationLabelListSet(closeConfig.successor).has(normalized)
  ) {
    return "successor";
  }
  return null;
}

function relationInverseForLabel(label) {
  const key = relationLabelKey(label);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(RELATION_SUCCESSOR_INVERSE_NAMED_PAIRS, key)) {
    return RELATION_SUCCESSOR_INVERSE_NAMED_PAIRS[key];
  }
  return null;
}

function relationSuccessorLabelForInverseKey(key, closeConfig) {
  const normalized = relationLabelKey(key);
  if (!normalized || !closeConfig || !closeConfig.successor) return null;
  const keys = Array.isArray(closeConfig.successor.keys) ? closeConfig.successor.keys : [];
  const labels = closeConfig.successor.labels && typeof closeConfig.successor.labels === "object"
    ? closeConfig.successor.labels
    : {};
  for (const configuredKey of keys) {
    const configuredLabel = String(labels[configuredKey] || configuredKey || "");
    const inverse = relationInverseForLabel(configuredLabel);
    if (inverse && relationLabelKey(inverse) === normalized) {
      return configuredLabel;
    }
  }
  return null;
}

function resetRelationSuccessorLabelsCache() {
  relationSuccessorLabelsCache = { key: null, value: emptyRelationCloseLabels() };
  relationSuccessorLabelsWarnedKey = null;
}

function emitRelationSuccessorLabelWarnings(messages, cacheKey, emit) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  if (cacheKey != null && relationSuccessorLabelsWarnedKey === cacheKey) return;
  if (cacheKey != null) relationSuccessorLabelsWarnedKey = cacheKey;
  const warn = typeof emit === "function"
    ? emit
    : typeof console !== "undefined" && typeof console.warn === "function"
      ? (message) => console.warn(message)
      : null;
  if (warn) for (const message of messages) warn(message);
}

function loadRelationSuccessorLabels(options = {}) {
  const empty = emptyRelationCloseLabels();
  const env = options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? successorRequireOptionalNodeModule("os")
    : options.osModule;
  const fsModule = options.fsModule === undefined
    ? successorRequireOptionalNodeModule("fs")
    : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    relationSuccessorLabelsCache = { key: null, value: empty };
    return empty;
  }
  const configPath = options.configPath || successorPlanConfigPath({ env, osModule });
  const statKey = successorConfigStatKey(fsModule, configPath);
  const cacheKey = statKey == null ? null : `${configPath}|${statKey}`;
  if (cacheKey != null && relationSuccessorLabelsCache.key === cacheKey) {
    return relationSuccessorLabelsCache.value;
  }
  const store = (value) => {
    relationSuccessorLabelsCache = { key: cacheKey, value };
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
        : "successor_labels";
    const value = relations && relations[field];
    if (value === undefined || value === null) {
      return freezeRelationLabelList([], {});
    }
    if (!Array.isArray(value)) {
      warnings.push(RELATIONS_CLOSE_LABELS_LIST_WARNINGS[kind].replace("%s", configPath));
      return freezeRelationLabelList([], {});
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
      const key = relationLabelKey(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      labels[key] = normalized;
    }
    return freezeRelationLabelList(keys, labels);
  };

  let cancel = parseList("cancel");
  let complete = parseList("complete");
  let successor = parseList("successor");
  const countIn = (key) =>
    (cancel.keys.includes(key) ? 1 : 0) +
    (complete.keys.includes(key) ? 1 : 0) +
    (successor.keys.includes(key) ? 1 : 0);
  const overlap = [...new Set([...cancel.keys, ...complete.keys, ...successor.keys])]
    .filter((key) => countIn(key) > 1);
  if (overlap.length > 0) {
    const cancelKeys = cancel.keys.filter((key) => !overlap.includes(key));
    const completeKeys = complete.keys.filter((key) => !overlap.includes(key));
    const successorKeys = successor.keys.filter((key) => !overlap.includes(key));
    for (const key of overlap) {
      const successorInvolved = successor.keys.includes(key);
      if (successorInvolved) {
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
    cancel = freezeRelationLabelList(
      cancelKeys,
      Object.fromEntries(cancelKeys.map((key) => [key, cancel.labels[key]])),
    );
    complete = freezeRelationLabelList(
      completeKeys,
      Object.fromEntries(completeKeys.map((key) => [key, complete.labels[key]])),
    );
    successor = freezeRelationLabelList(
      successorKeys,
      Object.fromEntries(successorKeys.map((key) => [key, successor.labels[key]])),
    );
  }
  emitRelationSuccessorLabelWarnings(warnings, cacheKey, options.warn);
  return store(Object.freeze({
    cancel,
    complete,
    successor,
    warnings: Object.freeze(warnings.slice()),
  }));
}
