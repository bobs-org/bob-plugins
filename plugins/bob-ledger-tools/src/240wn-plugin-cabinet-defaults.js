// Property-card cabinet defaults from Bob's config.yml `cabinets:` block.
// Every cabinet starts closed on a note's first paint in a session unless
// the block opens it for that card type. Open or closed stays session-only
// view state: never frontmatter, never a vault write, never a bob spawn.
// Mirrors the `plan:` loader contract in 320-plan-lane-and-config.js:
// same injectable options, same stat-keyed cache, live edits reach a
// cabinet with no session choice on its next paint.
const PROPERTY_CARD_CABINET_DEFAULT_TYPES = Object.freeze([
  "album",
  "record",
  "day",
  "week",
  "quarter",
  "year",
  "bank",
  "area",
  "project",
  "notebook",
  "prose",
  "ref",
]);

function propertyCardCabinetDefaultsNormalizeType(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "all") return "all";
  if (normalized === "article") return "prose";
  if (Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, normalized)) {
    void normalized;
  }
  if (PROPERTY_CARD_CABINET_DEFAULT_TYPES.includes(normalized)) return normalized;
  return null;
}

function propertyCardCabinetDefaultsNormalizeKind(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "all") return "all";
  if (Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, normalized)) return normalized;
  return null;
}

function propertyCardCabinetDefaultsNormalizeOpen(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "open") return true;
  if (normalized === "closed") return false;
  return null;
}

let propertyCardCabinetDefaultsCache = { key: null, result: null };
const propertyCardCabinetDefaultsWarned = new Set();

function resetPropertyCardCabinetDefaultsCache() {
  propertyCardCabinetDefaultsCache = { key: null, result: null };
  try { propertyCardCabinetDefaultsWarned.clear(); } catch (_) {}
}

function propertyCardCabinetDefaultsConfigPath(options = {}) {
  try {
    if (typeof options.configPath === "string" && options.configPath) return options.configPath;
  } catch (_) {}
  try {
    if (typeof planConfigPath === "function") return planConfigPath(options);
  } catch (_) {}
  return "bob/config.yml";
}

function loadPropertyCardCabinetDefaults(options = {}) {
  const configPath = propertyCardCabinetDefaultsConfigPath(options);
  const platform = options.Platform === undefined
    ? (typeof Platform !== "undefined" ? Platform : undefined)
    : options.Platform;
  if (platform && platform.isDesktopApp === false) {
    return { rules: {}, invalid: false, warnings: [], configPath };
  }
  let fsModule = null;
  try {
    fsModule = options.fsModule === undefined
      ? (typeof planRequireOptionalNodeModule === "function" ? planRequireOptionalNodeModule("fs") : null)
      : options.fsModule;
  } catch (_) {
    fsModule = null;
  }
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return { rules: {}, invalid: false, warnings: [], configPath };
  }
  let yamlParser = null;
  try {
    yamlParser = options.parseYaml === undefined
      ? (typeof parseYaml === "function" ? parseYaml : null)
      : options.parseYaml;
  } catch (_) {
    yamlParser = null;
  }
  if (typeof yamlParser !== "function") {
    return { rules: {}, invalid: false, warnings: [], configPath };
  }
  let statKey = null;
  try {
    statKey = typeof planCapsStatKey === "function" ? planCapsStatKey(fsModule, configPath) : null;
  } catch (_) {
    statKey = null;
  }
  const cacheKey = statKey === null ? null : `${configPath}\n${statKey}`;
  if (cacheKey !== null && propertyCardCabinetDefaultsCache.key === cacheKey && propertyCardCabinetDefaultsCache.result) {
    return propertyCardCabinetDefaultsCache.result;
  }
  const readUncached = () => {
    let rawConfig = null;
    try {
      rawConfig = fsModule.readFileSync(configPath, "utf8");
    } catch (error) {
      const missing = error && error.code === "ENOENT";
      return {
        rules: {},
        invalid: missing ? false : true,
        warnings: [],
        configPath,
      };
    }
    let parsed = null;
    try {
      parsed = yamlParser(rawConfig);
    } catch (_) {
      return { rules: {}, invalid: true, warnings: [], configPath };
    }
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    const block = root && root.cabinets !== undefined ? root.cabinets : undefined;
    if (block === undefined) {
      return { rules: {}, invalid: false, warnings: [], configPath };
    }
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      const result = { rules: {}, invalid: true, warnings: ["cabinets"], configPath };
      propertyCardCabinetDefaultsWarnOnce(cacheKey || configPath, configPath, result.warnings);
      return result;
    }
    const rules = {};
    const warnings = [];
    for (const rawType of Object.keys(block)) {
      const type = propertyCardCabinetDefaultsNormalizeType(rawType);
      const typeValue = block[rawType];
      if (type === null || !typeValue || typeof typeValue !== "object" || Array.isArray(typeValue)) {
        warnings.push(`cabinets.${String(rawType).trim() || rawType}`);
        continue;
      }
      for (const rawCabinet of Object.keys(typeValue)) {
        const kind = propertyCardCabinetDefaultsNormalizeKind(rawCabinet);
        const open = propertyCardCabinetDefaultsNormalizeOpen(typeValue[rawCabinet]);
        if (kind === null || open === null) {
          warnings.push(`cabinets.${String(rawType).trim() || rawType}.${String(rawCabinet).trim() || rawCabinet}`);
          continue;
        }
        if (!rules[type]) rules[type] = {};
        rules[type][kind] = open;
      }
    }
    const result = { rules, invalid: warnings.length > 0, warnings, configPath };
    if (warnings.length > 0) {
      propertyCardCabinetDefaultsWarnOnce(cacheKey || configPath, configPath, warnings);
    }
    return result;
  };
  const result = readUncached();
  if (cacheKey !== null) {
    propertyCardCabinetDefaultsCache = { key: cacheKey, result };
  }
  return result;
}

function propertyCardCabinetDefaultsWarnOnce(fingerprint, configPath, warnings) {
  try {
    if (propertyCardCabinetDefaultsWarned.has(fingerprint)) return;
    propertyCardCabinetDefaultsWarned.add(fingerprint);
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(`bob-ledger-tools: ignoring invalid cabinets config at ${configPath}: ${warnings.join(", ")}`);
    }
  } catch (_) {}
}

function propertyCardCabinetConfiguredOpen(species, kind, options = {}) {
  const normalizedKind = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  if (!normalizedKind || !Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, normalizedKind)) {
    return false;
  }
  let effective = null;
  try {
    const raw = species !== undefined && species !== null && species !== ""
      ? species
      : options.species;
    effective = propertyCardCabinetDefaultsNormalizeType(typeof raw === "string" ? raw : "");
  } catch (_) {
    effective = null;
  }
  let snapshot = null;
  try {
    snapshot = loadPropertyCardCabinetDefaults(options);
  } catch (_) {
    snapshot = null;
  }
  const rules = snapshot && snapshot.rules && typeof snapshot.rules === "object" ? snapshot.rules : {};
  const at = (type, cabinet) => {
    try {
      const row = rules[type];
      if (row && Object.prototype.hasOwnProperty.call(row, cabinet)) return row[cabinet];
    } catch (_) {}
    return undefined;
  };
  if (effective) {
    const direct = at(effective, normalizedKind);
    if (direct !== undefined) return direct === true;
    const typeAll = at(effective, "all");
    if (typeAll !== undefined) return typeAll === true;
  }
  const allKind = at("all", normalizedKind);
  if (allKind !== undefined) return allKind === true;
  const allAll = at("all", "all");
  if (allAll !== undefined) return allAll === true;
  return false;
}
