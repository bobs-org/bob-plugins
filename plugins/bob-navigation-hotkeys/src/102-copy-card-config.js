// Copy card `copy.templates` loader. Reads ~/.config/bob/config.yml through
// the same XDG-aware path and mtime/size cache as loadBlocksLinesEnabled.
// Never throws: missing config is empty templates, broken YAML is one
// diagnostic that the model can render as an error row.

let copyCardTemplatesCache = { key: null, value: null };

function resetCopyCardTemplatesCache() {
  copyCardTemplatesCache = { key: null, value: null };
}

function copyCardTemplatesStatKey(fsModule, configPath) {
  return blocksLinesConfigStatKey(fsModule, configPath);
}

function freezeCopyCardTemplatesResult(result) {
  const templates = Array.isArray(result && result.templates)
    ? result.templates
    : [];
  const diagnostic =
    result && typeof result.diagnostic === "string" && result.diagnostic
      ? result.diagnostic
      : undefined;
  if (diagnostic) {
    return Object.freeze({
      templates: Object.freeze(templates.slice()),
      diagnostic,
    });
  }
  return Object.freeze({
    templates: Object.freeze(templates.slice()),
  });
}

function emptyCopyCardTemplates() {
  return freezeCopyCardTemplatesResult({ templates: [] });
}

function loadCopyCardTemplates(options = {}) {
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
  const configPath =
    options.configPath || getBulletPropertyConfigPath({ env, osModule });

  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return emptyCopyCardTemplates();
  }

  const statKey = copyCardTemplatesStatKey(fsModule, configPath);
  const cacheKey = statKey == null ? null : `${configPath}|${statKey}`;
  if (cacheKey != null && copyCardTemplatesCache.key === cacheKey) {
    return copyCardTemplatesCache.value;
  }

  const remember = (result) => {
    const frozen = freezeCopyCardTemplatesResult(result);
    if (cacheKey != null) {
      copyCardTemplatesCache = { key: cacheKey, value: frozen };
    }
    return frozen;
  };

  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return remember({ templates: [] });
    }
    return remember({
      templates: [],
      diagnostic: "could not read copy.templates",
    });
  }

  const parse =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof parse !== "function") {
    return remember({
      templates: [],
      diagnostic: "could not parse copy.templates",
    });
  }

  let parsed;
  try {
    parsed = parse(rawConfig);
  } catch (_error) {
    return remember({
      templates: [],
      diagnostic: "could not parse copy.templates",
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return remember({ templates: [] });
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "copy")) {
    return remember({ templates: [] });
  }
  const copy = parsed.copy;
  if (copy === null || copy === undefined) {
    return remember({ templates: [] });
  }
  if (!copyCardPlainObject(copy)) {
    return remember({
      templates: [],
      diagnostic: "copy must be a mapping",
    });
  }
  if (!Object.prototype.hasOwnProperty.call(copy, "templates")) {
    return remember({ templates: [] });
  }
  const templates = copy.templates;
  if (templates === null || templates === undefined) {
    return remember({
      templates: [],
      diagnostic: "copy.templates must be a list",
    });
  }
  if (!Array.isArray(templates)) {
    return remember({
      templates: [],
      diagnostic: "copy.templates must be a list",
    });
  }
  if (templates.length === 0) {
    return remember({ templates: [] });
  }

  try {
    return remember({ templates: normalizeCopyCardTemplates(templates) });
  } catch (_error) {
    return remember({
      templates: [],
      diagnostic: "could not parse copy.templates",
    });
  }
}
