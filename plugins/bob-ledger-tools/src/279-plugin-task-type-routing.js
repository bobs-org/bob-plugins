// --- Task type routing: pure JS mirror of bob-cli routing.rs (D4-D8) ---
// Agreement, retype, placement, and relocation planners over plain data.
// Vocabulary, exempt, and inventory ride the `sources` argument as raw name
// lists (`{ vocab, exempt, inventory }`); a null or empty `vocab` means no
// configured vocabulary. Vectors in
// `scripts/fixtures/pomodoro_themes/vectors.json` are copied byte-for-byte
// from bob-cli; the Rust suite there is the source of truth. This file never
// spawns bob and never touches the vault, so it also runs on mobile.

// Normalize one raw `sources` argument into key sets. `vocab` stays null
// when no vocabulary is configured (missing, null, or empty), exactly like
// Rust's `parse_themes_config` returning `Ok(None)`.
function normalizeTaskTypeSources(sources) {
  const raw = sources && typeof sources === "object" ? sources : {};
  const keySet = (values) => new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => pomodoroThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const vocabList = Array.isArray(raw.vocab) ? raw.vocab : null;
  const vocab = vocabList && vocabList.length > 0 ? keySet(vocabList) : null;
  return {
    vocab,
    exempt: keySet(raw.exempt),
    inventory: keySet(raw.inventory),
  };
}

// Classify each component of a Pomodoro name (D4). Unnamed entries and
// `(unnamed)` have no components. An entry with no type components is a
// container. With a configured vocabulary a component is a type component
// iff its key is in the vocabulary; otherwise every component except
// inventory labels is a type component.
function typeComponents(name, sources) {
  const sets = normalizeTaskTypeSources(sources);
  const text = String(name == null ? "" : name).trim();
  if (!text || text === "(unnamed)") {
    return [];
  }
  return pomodoroThemeSplitComponents(text).map((component) => {
    const key = pomodoroThemeNormalizeKey(component);
    const isType = sets.vocab !== null
      ? sets.vocab.has(key)
      : !sets.inventory.has(key);
    return { name: component, key, isType };
  });
}

// Agreement invariant (D5): a live Task Link sits under a Pomodoro whose
// name includes its task's type, or under a container.
function typeAgrees(taskKey, entryName, sources) {
  if (taskKey === null || taskKey === undefined || taskKey === "") {
    return true;
  }
  const key = pomodoroThemeNormalizeKey(taskKey);
  if (!key) {
    return true;
  }
  const components = typeComponents(entryName, sources);
  if (components.every((item) => !item.isType)) {
    return true;
  }
  if (entryName === null || entryName === undefined) {
    return true;
  }
  return pomodoroThemeSplitComponents(String(entryName))
    .some((component) => pomodoroThemeNormalizeKey(component) === key);
}

function taskTypeStripSelector(raw) {
  let text = String(raw == null ? "" : raw).trim();
  if (text.startsWith("#") || text.startsWith("=")) {
    text = text.slice(1);
  }
  text = text.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

// How a link landing in Pomodoro D retypes its task (D6). `effectiveKey` is
// the task's current effective type and `inheritedKey` the same cascade
// without the task field; `selector` is the authored `#NAME` / `=name`
// text, `keepType` the keep-type merge path, and `tabPick` the cycled
// composite choice.
function planRetype(input, sources) {
  const opts = input && typeof input === "object" ? input : {};
  const sets = normalizeTaskTypeSources(sources);
  const destination = String(opts.destination == null ? "" : opts.destination);
  const components = typeComponents(destination, sources);
  if (components.every((item) => !item.isType)) {
    return { kind: "container" };
  }
  const effectiveKey = opts.effectiveKey == null || opts.effectiveKey === ""
    ? null
    : pomodoroThemeNormalizeKey(opts.effectiveKey);
  if (effectiveKey) {
    const entryKeys = new Set(
      pomodoroThemeSplitComponents(destination).map((component) =>
        pomodoroThemeNormalizeKey(component),
      ),
    );
    if (entryKeys.has(effectiveKey)) {
      return { kind: "consistent" };
    }
  }
  if (opts.keepType === true) {
    const current = opts.effectiveName || opts.effectiveKey || "";
    const canonical = pomodoroThemeCanonicalName(current) || String(current || "");
    return { kind: "merge", name: `${destination.trim()} + ${canonical}` };
  }
  const candidates = components.filter((item) => item.isType);
  if (candidates.length === 0) {
    return { kind: "container" };
  }
  let chosen = null;
  if (opts.selector !== null && opts.selector !== undefined) {
    const want = pomodoroThemeNormalizeKey(taskTypeStripSelector(opts.selector));
    if (want) {
      chosen = candidates.find((item) => item.key === want)
        || candidates.find((item) => item.key.startsWith(want))
        || null;
    }
  }
  if (!chosen && opts.tabPick !== null && opts.tabPick !== undefined) {
    const want = pomodoroThemeNormalizeKey(opts.tabPick);
    chosen = candidates.find((item) => item.key === want) || null;
  }
  if (!chosen) {
    chosen = candidates.find((item) => !sets.exempt.has(item.key))
      || candidates[0];
  }
  const inheritedKey = opts.inheritedKey == null || opts.inheritedKey === ""
    ? null
    : pomodoroThemeNormalizeKey(opts.inheritedKey);
  if (inheritedKey && inheritedKey === chosen.key) {
    return { kind: "clear" };
  }
  return { kind: "set", name: chosen.name, key: chosen.key };
}

function taskTypeIsExactEntry(name, key, exempt) {
  if (name === null || name === undefined) {
    return false;
  }
  const kept = pomodoroThemeSplitComponents(String(name))
    .map((component) => pomodoroThemeNormalizeKey(component))
    .filter((component) => component === key || !exempt.has(component));
  return kept.length === 1 && kept[0] === key;
}

function taskTypeContainsKey(name, key) {
  if (name === null || name === undefined) {
    return false;
  }
  return pomodoroThemeSplitComponents(String(name)).some(
    (component) => pomodoroThemeNormalizeKey(component) === key,
  );
}

// Where Bob puts the Pomodoro for type T (D7). Unlike menus, placement may
// create entries for unknown or unconfigured names. With no effective type
// the caller keeps today's implicit current/next selection.
function planPlacement(input) {
  const opts = input && typeof input === "object" ? input : {};
  if (opts.typeKey === null || opts.typeKey === undefined || opts.typeKey === "") {
    return { kind: "noType" };
  }
  const key = pomodoroThemeNormalizeKey(opts.typeKey);
  if (!key) {
    return { kind: "noType" };
  }
  if (opts.alreadyQueued === true) {
    return { kind: "alreadyQueued" };
  }
  const entries = Array.isArray(opts.entries) ? opts.entries : [];
  const exempt = new Set(
    (Array.isArray(opts.exempt) ? opts.exempt : [])
      .map((value) => pomodoroThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const runningExact = entries.findIndex(
    (entry) => entry && entry.open === true && entry.running === true
      && taskTypeIsExactEntry(entry.name, key, exempt),
  );
  if (runningExact >= 0) {
    return { kind: "entry", index: runningExact };
  }
  const openExact = entries.findIndex(
    (entry) => entry && entry.open === true && entry.running !== true
      && taskTypeIsExactEntry(entry.name, key, exempt),
  );
  if (openExact >= 0) {
    return { kind: "entry", index: openExact };
  }
  const containing = entries.findIndex(
    (entry) => entry && entry.open === true
      && taskTypeContainsKey(entry.name, key),
  );
  if (containing >= 0) {
    return { kind: "entry", index: containing };
  }
  const ledgerKeys = new Set(
    (Array.isArray(opts.ledgerKeys) ? opts.ledgerKeys : [])
      .map((value) => pomodoroThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const addsTheme = !exempt.has(key) && !ledgerKeys.has(key);
  const strict = opts.strict === true;
  const themesBefore = Number(opts.themesBefore) || 0;
  const cap = Number(opts.cap) || 0;
  if (strict && addsTheme && themesBefore + 1 > cap) {
    return { kind: "refused", code: "strict_cap" };
  }
  const name = typeof opts.typeName === "string" && opts.typeName
    ? opts.typeName
    : key;
  return { kind: "create", name };
}

// Replace an entry's type components with X, keeping labels in order with X
// in the first type component's position.
function replaceTypeComponents(name, typeName, sources) {
  const fallback = typeof typeName === "string" && typeName ? typeName : "";
  if (name === null || name === undefined) {
    return fallback;
  }
  const classified = typeComponents(name, sources);
  if (classified.length === 0) {
    return fallback;
  }
  const parts = [];
  let placed = false;
  for (const item of classified) {
    if (!item.isType) {
      parts.push(item.name);
    } else if (!placed) {
      parts.push(fallback);
      placed = true;
    }
  }
  if (!placed) {
    parts.push(fallback);
  }
  return parts.join(" + ");
}

// What happens to the live ledger when a task's type becomes X (D8,
// `running_retype = absorb`: running entries keep the task).
function planRelocation(input) {
  const opts = input && typeof input === "object" ? input : {};
  const entries = Array.isArray(opts.entries) ? opts.entries : [];
  const from = opts.liveLink;
  if (!Number.isInteger(from) || from < 0 || from >= entries.length) {
    return { kind: "unchanged" };
  }
  const entry = entries[from];
  if (!entry || entry.open !== true) {
    return { kind: "unchanged" };
  }
  const key = pomodoroThemeNormalizeKey(opts.typeKey);
  if (!key) {
    return { kind: "unchanged" };
  }
  const typeName = typeof opts.typeName === "string" && opts.typeName
    ? opts.typeName
    : key;
  if (typeAgrees(key, entry.name, opts.sources)) {
    return { kind: "unchanged" };
  }
  if (entry.running === true) {
    if (Number(entry.links) <= 1) {
      return {
        kind: "renameEntry",
        index: from,
        newName: replaceTypeComponents(entry.name, typeName, opts.sources),
      };
    }
    const base = entry.name === null || entry.name === undefined
      ? ""
      : String(entry.name);
    return {
      kind: "appendComponent",
      index: from,
      newName: `${base} + ${typeName}`,
    };
  }
  // Steps 1-3 of place(X), skipping running entries.
  const planned = entries.map((item) => ({
    name: item ? item.name : null,
    open: !!item && item.open === true && item.running !== true,
    running: false,
  }));
  const sets = normalizeTaskTypeSources(opts.sources);
  const placed = planPlacement({
    typeKey: key,
    typeName,
    entries: planned,
    exempt: [...sets.exempt],
    ledgerKeys: opts.ledgerKeys,
    themesBefore: opts.themesBefore,
    cap: opts.cap,
    strict: false,
    alreadyQueued: false,
  });
  if (placed.kind === "entry" && placed.index !== from) {
    return { kind: "moveTo", from, to: placed.index };
  }
  if (Number(entry.links) <= 1) {
    return {
      kind: "renamePlaceholder",
      index: from,
      newName: replaceTypeComponents(entry.name, typeName, opts.sources),
    };
  }
  const ledgerKeys = new Set(
    (Array.isArray(opts.ledgerKeys) ? opts.ledgerKeys : [])
      .map((value) => pomodoroThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const addsTheme = !sets.exempt.has(key) && !ledgerKeys.has(key);
  const strict = opts.strict === true;
  const themesBefore = Number(opts.themesBefore) || 0;
  const cap = Number(opts.cap) || 0;
  if (strict && addsTheme && themesBefore + 1 > cap) {
    return {
      kind: "refused",
      code: "strict_cap",
      typeKey: key,
      typeName,
      themesBefore,
      cap,
    };
  }
  return { kind: "createBelow", from, name: typeName };
}
