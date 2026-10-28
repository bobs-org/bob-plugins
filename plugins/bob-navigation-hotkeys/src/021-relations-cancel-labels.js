// `relations.cancel_labels` loader (`docs/task-relations.md` §17 CL2).
// Missing/null/empty is a valid empty policy. Invalid containers warn once
// and cancel nothing; invalid entries warn and are skipped; duplicate keys
// collapse. Read/parse failures never keep an older effectful policy.
// Independent of `linked_from_lines`. Cache by mtime/size so the next
// gesture sees an edit, and cache warnings so an unchanged bad file does
// not spam.

const RELATIONS_CANCEL_LABELS_LIST_WARNING =
  "invalid relations.cancel_labels in %s: expected a list of relation labels; cancelling nothing";

let relationsCancelLabelsConfigCache = {
  key: null,
  value: emptyRelationsCancelLabels(),
};
let relationsCancelLabelsWarnedKey = null;

function emptyRelationsCancelLabels() {
  return Object.freeze({
    keys: Object.freeze([]),
    labels: Object.freeze({}),
  });
}

function resetRelationsCancelLabelsConfigCache() {
  relationsCancelLabelsConfigCache = {
    key: null,
    value: emptyRelationsCancelLabels(),
  };
  relationsCancelLabelsWarnedKey = null;
}

function freezeRelationsCancelLabels(keys, labels) {
  return Object.freeze({
    keys: Object.freeze(keys.slice()),
    labels: Object.freeze({ ...labels }),
  });
}

function emitRelationsCancelLabelWarnings(messages, cacheKey, emit) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  if (cacheKey != null && relationsCancelLabelsWarnedKey === cacheKey) return;
  if (cacheKey != null) relationsCancelLabelsWarnedKey = cacheKey;
  const warn =
    typeof emit === "function"
      ? emit
      : typeof console !== "undefined" && typeof console.warn === "function"
        ? (text) => console.warn(text)
        : null;
  if (!warn) return;
  for (const message of messages) warn(message);
}

function loadRelationsCancelLabels(options = {}) {
  const empty = emptyRelationsCancelLabels();
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
    relationsCancelLabelsConfigCache = { key: null, value: empty };
    return empty;
  }
  const configPath =
    options.configPath || getBulletPropertyConfigPath({ env, osModule });
  const statKey = blocksLinesConfigStatKey(fsModule, configPath);
  const key = statKey == null ? null : `${configPath}|${statKey}`;
  if (key != null && relationsCancelLabelsConfigCache.key === key) {
    return relationsCancelLabelsConfigCache.value;
  }

  const storeEmpty = () => {
    if (key != null) {
      relationsCancelLabelsConfigCache = { key, value: empty };
    } else {
      relationsCancelLabelsConfigCache = { key: null, value: empty };
    }
    return empty;
  };

  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (_error) {
    return storeEmpty();
  }

  const parse = options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof parse !== "function") {
    return storeEmpty();
  }

  let config;
  try {
    config = parse(rawConfig);
  } catch (_error) {
    return storeEmpty();
  }

  const warn = options.warn;
  const warnings = [];
  const relations = config && config.relations;
  if (!relations || relations.cancel_labels === undefined) {
    return storeEmpty();
  }
  const value = relations.cancel_labels;
  if (value === null) {
    return storeEmpty();
  }
  if (!Array.isArray(value)) {
    warnings.push(
      RELATIONS_CANCEL_LABELS_LIST_WARNING.replace("%s", configPath),
    );
    emitRelationsCancelLabelWarnings(warnings, key, warn);
    return storeEmpty();
  }

  const keys = [];
  const labels = {};
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") {
      warnings.push(
        `invalid relations.cancel_labels entry in ${configPath}: expected a relation label string`,
      );
      continue;
    }
    const normalized = normalizeRelationLabel(entry);
    if (!normalized) {
      warnings.push(
        `invalid relations.cancel_labels entry in ${configPath}: not a legal relation label`,
      );
      continue;
    }
    const labelKey = relationCancelLabelKey(normalized);
    if (!labelKey || seen.has(labelKey)) continue;
    seen.add(labelKey);
    keys.push(labelKey);
    labels[labelKey] = normalized;
  }
  emitRelationsCancelLabelWarnings(warnings, key, warn);

  const loaded = freezeRelationsCancelLabels(keys, labels);
  if (key != null) {
    relationsCancelLabelsConfigCache = { key, value: loaded };
  } else {
    relationsCancelLabelsConfigCache = { key: null, value: loaded };
  }
  return loaded;
}
