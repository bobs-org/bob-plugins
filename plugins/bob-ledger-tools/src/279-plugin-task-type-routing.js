// --- Task type routing: pure JS mirror of bob-cli routing.rs (D4-D8, R2) ---
// Agreement, landing, placement, relocation, merge, and shed planners over plain data.
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

// Legacy explicit task-field selection (D6). `planLanding` below is the
// default link/move behavior; this helper stays for explicit type editors.
function planExplicitRetype(input, sources) {
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

function taskTypeIsMeetName(name) {
  return pomodoroThemeNormalizeKey(name) === "meet";
}

// Default Task Link landing (R2). A named destination merges the task's
// effective type into its name unless the gesture explicitly requests a
// field retype or the destination is calendar-owned MEET.
function planLanding(input, sources) {
  const opts = input && typeof input === "object" ? input : {};
  const destination = String(opts.destination == null ? "" : opts.destination);
  const components = typeComponents(destination, sources);
  if (components.every((item) => !item.isType)) {
    return { kind: "container" };
  }
  const effectiveKey = opts.effectiveKey == null || opts.effectiveKey === ""
    ? null
    : pomodoroThemeNormalizeKey(opts.effectiveKey);
  if (!effectiveKey) {
    return { kind: "consistent" };
  }
  const entryKeys = new Set(
    pomodoroThemeSplitComponents(destination).map((component) =>
      pomodoroThemeNormalizeKey(component),
    ),
  );
  if (entryKeys.has(effectiveKey)) {
    return { kind: "consistent" };
  }
  if (opts.retype !== true && !taskTypeIsMeetName(destination)) {
    const current = opts.effectiveName || opts.effectiveKey || "";
    const canonical = pomodoroThemeCanonicalName(current) || String(current || "");
    return { kind: "merge", name: `${destination.trim()} + ${canonical}` };
  }
  return planExplicitRetype(opts, sources);
}

// Version-1 compatibility alias: retype is the explicit `planLanding` mode.
function planRetype(input, sources) {
  return planLanding({ ...(input && typeof input === "object" ? input : {}), retype: true }, sources);
}

// Deduplicating component join (R5): base order first, followed by each
// other name's components in order. First spelling wins and labels remain.
function mergeNames(base, others) {
  const seen = new Set();
  const parts = [];
  const names = [base, ...(Array.isArray(others) ? others : [])];
  for (const name of names) {
    for (const component of pomodoroThemeSplitComponents(String(name || ""))) {
      const key = pomodoroThemeNormalizeKey(component);
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(component);
      }
    }
  }
  return parts.join(" + ");
}

// Narrow a closed merged Pomodoro to the types that had worked links (R6).
// Labels stay in place, as do every type component when no component was
// worked. Single-type and calendar-owned MEET entries never change.
function narrowClosed(name, workedKeys, sources) {
  const rawName = String(name == null ? "" : name);
  if (taskTypeIsMeetName(rawName)) {
    return rawName;
  }
  const classified = typeComponents(rawName, sources);
  const types = classified.filter((item) => item.isType);
  if (types.length < 2) {
    return rawName;
  }
  const worked = new Set(
    (Array.isArray(workedKeys) ? workedKeys : [])
      .map((key) => pomodoroThemeNormalizeKey(key)).filter(Boolean),
  );
  if (!types.some((item) => worked.has(item.key))) {
    return rawName;
  }
  return classified
    .filter((item) => !item.isType || worked.has(item.key))
    .map((item) => item.name)
    .join(" + ");
}

// Shed merged-in types whose last Task Link left. Types with no prior links,
// labels, and the base type survive. MEET is calendar-owned and immutable.
function shed(name, beforeKeys, afterKeys, sources) {
  const rawName = String(name == null ? "" : name);
  if (taskTypeIsMeetName(rawName)) {
    return rawName;
  }
  const classified = typeComponents(rawName, sources);
  const types = classified.filter((item) => item.isType);
  if (types.length < 2) {
    return rawName;
  }
  const before = new Set(
    (Array.isArray(beforeKeys) ? beforeKeys : [])
      .map((key) => pomodoroThemeNormalizeKey(key)).filter(Boolean),
  );
  const after = new Set(
    (Array.isArray(afterKeys) ? afterKeys : [])
      .map((key) => pomodoroThemeNormalizeKey(key)).filter(Boolean),
  );
  const drop = new Set(types
    .filter((item) => before.has(item.key) && !after.has(item.key))
    .map((item) => item.key));
  if (types.every((item) => drop.has(item.key))) {
    drop.delete(types[0].key);
  }
  return classified
    .filter((item) => !item.isType || !drop.has(item.key))
    .map((item) => item.name)
    .join(" + ");
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
  return { kind: "createBelow", from, name: typeName };
}

// Parse one R4 split selector: bare `build`, `#build`, `=build`, or a
// quoted literal `#"SASE V18"` (whole-key match only). Mirrors Rust
// `routing::parse_type_selector`.
function parseSplitSelector(raw) {
  let text = String(raw == null ? "" : raw).trim();
  if (text.startsWith("#") || text.startsWith("=")) {
    text = text.slice(1);
  }
  text = text.trim();
  const literal =
    text.length >= 2 && text.startsWith('"') && text.endsWith('"');
  const inner = literal ? text.slice(1, -1) : text;
  return {
    raw: inner,
    key: pomodoroThemeNormalizeKey(inner),
    literal,
  };
}

// Match one parsed split selector against the merged-in type items.
// Exact key wins; otherwise a unique key-prefix match wins unless the
// selector is a quoted literal. Returns the matched item or null.
function matchSplitType(parsed, mergedIn) {
  const exact = (Array.isArray(mergedIn) ? mergedIn : []).find(
    (item) => item && item.key === parsed.key,
  );
  if (exact) {
    return exact;
  }
  if (!parsed || parsed.literal) {
    return null;
  }
  const prefixed = (Array.isArray(mergedIn) ? mergedIn : []).filter(
    (item) => item && typeof item.key === "string" && item.key.startsWith(parsed.key),
  );
  return prefixed.length === 1 ? prefixed[0] : null;
}

// Resolve an explicit R4 split set over the base and merged-in items.
// Returns `{ ok, items }` or `{ ok: false, code, name, selector }`.
// `items` are in name order (their position in `mergedIn`).
function resolveSplitTypes(selectors, base, mergedIn) {
  const list = Array.isArray(mergedIn) ? mergedIn : [];
  const chosen = [];
  const seen = new Set();
  for (const selector of Array.isArray(selectors) ? selectors : []) {
    const parsed = parseSplitSelector(selector);
    if (!parsed.key) {
      return {
        ok: false,
        code: "split_type_unknown",
        selector: String(selector == null ? "" : selector),
      };
    }
    if (
      parsed.key === base.key ||
      (!parsed.literal &&
        typeof base.key === "string" &&
        base.key.startsWith(parsed.key))
    ) {
      return { ok: false, code: "split_base_type", name: base.name };
    }
    const resolved = matchSplitType(parsed, list);
    if (!resolved) {
      return {
        ok: false,
        code: "split_type_unknown",
        selector: String(selector == null ? "" : selector),
      };
    }
    if (seen.has(resolved.key)) {
      return { ok: false, code: "split_type_repeated", name: resolved.name };
    }
    seen.add(resolved.key);
    chosen.push(resolved);
  }
  chosen.sort(
    (left, right) =>
      list.findIndex((item) => item.key === left.key) -
      list.findIndex((item) => item.key === right.key),
  );
  return { ok: true, items: chosen };
}

// Partition an open merged Pomodoro by type (R4). `linkKeys` is each
// top-level Task Link's effective type, in child order; `null`/empty
// entries never move. `splitSelectors` is null/empty for "split every
// merged-in type", else an explicit non-empty selector list. Mirrors
// Rust `merged::split_plan` and passes the shared `split` vectors.
function planSplit(input, sources) {
  const opts = input && typeof input === "object" ? input : {};
  const name = String(opts.name == null ? "" : opts.name);
  const open = opts.open === true;
  const linkKeys = Array.isArray(opts.linkKeys) ? opts.linkKeys : [];
  const rawSplit = opts.splitSelectors !== undefined ? opts.splitSelectors : opts.split;
  const hasExplicit =
    Array.isArray(rawSplit) ? rawSplit.length > 0 : rawSplit !== undefined && rawSplit !== null;
  const selectors = Array.isArray(rawSplit) ? rawSplit : null;

  if (!open) {
    return { kind: "error", code: "split_closed" };
  }
  if (taskTypeIsMeetName(name)) {
    return { kind: "error", code: "split_meet" };
  }
  const classified = typeComponents(name, sources);
  const types = classified.filter((item) => item && item.isType === true);
  if (types.length < 2) {
    return { kind: "error", code: "split_not_merged" };
  }
  const base = types[0];
  const mergedIn = types.slice(1);
  let selected;
  if (!hasExplicit) {
    selected = mergedIn.slice();
  } else {
    if (types.length === 2) {
      return { kind: "error", code: "split_type_not_needed" };
    }
    const resolved = resolveSplitTypes(selectors || [], base, mergedIn);
    if (!resolved.ok) {
      if (resolved.code === "split_base_type") {
        return { kind: "error", code: resolved.code, name: resolved.name };
      }
      if (resolved.code === "split_type_repeated") {
        return { kind: "error", code: resolved.code, name: resolved.name };
      }
      return { kind: "error", code: resolved.code, selector: resolved.selector };
    }
    selected = resolved.items;
  }
  const selectedKeys = new Set(selected.map((item) => item.key));
  const remaining = classified
    .filter((item) => !item.isType || !selectedKeys.has(item.key))
    .map((item) => item.name)
    .join(" + ");
  const created = selected.map((item) => ({
    name: item.name,
    link_indices: linkKeys
      .map((key, index) => ({ key, index }))
      .filter(
        ({ key }) =>
          key !== null &&
          key !== undefined &&
          key !== "" &&
          pomodoroThemeNormalizeKey(key) === item.key,
      )
      .map(({ index }) => index),
  }));
  return { kind: "ok", remaining, created };
}
