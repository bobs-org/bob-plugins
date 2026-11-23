// Property editor add-flow helpers (bob-cli-pf.4.1.4). Name inventory,
// local key checks, and source-key insertion anchors. DOM-free: the modal
// owns staging; bob still validates ownership and writes the bytes.
const PROPERTY_EDITOR_ADD_WIRE_KINDS = new Set([
  "text", "number", "checkbox", "date", "datetime", "list", "tags", "aliases",
]);

function propertyEditorObsidianTypeToWire(type) {
  switch (String(type || "").trim().toLowerCase()) {
    case "number": return "number";
    case "checkbox":
    case "bool":
    case "boolean": return "checkbox";
    case "date": return "date";
    case "datetime":
    case "date-time": return "datetime";
    case "tags": return "tags";
    case "aliases": return "aliases";
    case "multitext":
    case "list": return "list";
    default: return "text";
  }
}

function propertyEditorNormalizePropertyName(raw) {
  let text = String(raw == null ? "" : raw).trim();
  if (text.length >= 2) {
    const start = text.charAt(0);
    const end = text.charAt(text.length - 1);
    if ((start === "\"" && end === "\"") || (start === "'" && end === "'")) {
      text = text.slice(1, -1);
    }
  }
  return text;
}

function propertyEditorExistingKeys(properties) {
  const keys = [];
  for (const row of Array.isArray(properties) ? properties : []) {
    if (row && typeof row.key === "string" && row.key && !keys.includes(row.key)) keys.push(row.key);
  }
  return keys;
}

function propertyEditorValidateNewKey(name, existingKeys) {
  if (!name) {
    return { ok: false, code: "prop_bad_key", message: "A property name is required." };
  }
  if (name.includes("\n") || name.includes("\r") || name.includes("\u{feff}")) {
    return { ok: false, code: "prop_bad_key", message: "Property names must be a single line." };
  }
  const keys = Array.isArray(existingKeys) ? existingKeys : [];
  if (keys.includes(name)) {
    return { ok: false, code: "prop_exists", message: `“${name}” already exists on this note.` };
  }
  return { ok: true, name };
}

function propertyEditorSortPropertyInfos(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
    const countDelta = (Number(right.count) || 0) - (Number(left.count) || 0);
    if (countDelta) return countDelta;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function propertyEditorPropertyInfosFromApi(app) {
  try {
    const fn = app?.metadataCache?.getAllPropertyInfos;
    if (typeof fn !== "function") return null;
    const raw = fn.call(app.metadataCache);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rows = [];
    for (const [key, info] of Object.entries(raw)) {
      const name = info && typeof info.name === "string" && info.name ? info.name : key;
      if (!name) continue;
      const type = info && typeof info.type === "string" && info.type ? info.type : "text";
      const count = info && Number.isFinite(Number(info.count)) ? Number(info.count) : 0;
      rows.push({
        name,
        type,
        count,
        wireKind: propertyEditorObsidianTypeToWire(type),
        authoritative: true,
      });
    }
    return rows;
  } catch (_) {
    return null;
  }
}

function propertyEditorPropertyInfosFromCache(app) {
  const counts = new Map();
  try {
    const files = app?.vault?.getMarkdownFiles?.() || [];
    for (const file of files) {
      const frontmatter = app?.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) continue;
      for (const key of Object.keys(frontmatter)) {
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  } catch (_) {}
  return [...counts].map(([name, count]) => ({
    name,
    type: null,
    count,
    wireKind: "text",
    authoritative: false,
  }));
}

function propertyEditorPropertyInfos(app) {
  const fromApi = propertyEditorPropertyInfosFromApi(app);
  return {
    source: fromApi ? "infos" : "cache",
    rows: propertyEditorSortPropertyInfos(fromApi || propertyEditorPropertyInfosFromCache(app)),
  };
}

function propertyEditorFilterPropertyNames(rows, filter) {
  const text = String(filter || "").trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!text) return list.slice();
  return list.filter((row) => String(row.name || "").toLowerCase().includes(text));
}

function propertyEditorAddPlacement(where, selectedKey, properties) {
  const keys = propertyEditorExistingKeys(properties);
  if (!keys.length || where === "end" || !selectedKey) {
    return { where: "end", before: null, after: null, anchorKey: null };
  }
  if (where === "above") {
    return { where: "above", before: selectedKey, after: null, anchorKey: selectedKey };
  }
  return { where: "below", before: null, after: selectedKey, anchorKey: selectedKey };
}

function propertyEditorAddPositionFields(placement) {
  if (placement && typeof placement.after === "string" && placement.after) return { after: placement.after };
  if (placement && typeof placement.before === "string" && placement.before) return { before: placement.before };
  return {};
}

function propertyEditorAddAnchorAlive(anchorKey, properties) {
  if (!anchorKey) return true;
  return propertyEditorExistingKeys(properties).includes(anchorKey);
}

function propertyEditorAddRace(name, placement, properties) {
  const valid = propertyEditorValidateNewKey(name, propertyEditorExistingKeys(properties));
  if (!valid.ok) return valid;
  const anchorKey = placement && placement.anchorKey;
  if (anchorKey && !propertyEditorAddAnchorAlive(anchorKey, properties)) {
    return {
      ok: false,
      code: "prop_missing",
      message: `The insert anchor “${anchorKey}” is gone.`,
      hint: "The draft is kept. Cancel or keep this name; the destination does not move.",
    };
  }
  return { ok: true, name };
}

function propertyEditorAcceptAddName(typed, catalog, options = {}) {
  const name = propertyEditorNormalizePropertyName(typed);
  const filtered = propertyEditorFilterPropertyNames(catalog, propertyEditorNormalizePropertyName(typed));
  if (options.literal === true) {
    return { ok: true, name, wireKind: "text", type: "text", fromCompletion: false, authoritative: false };
  }
  const index = Number.isInteger(options.suggestionIndex) ? options.suggestionIndex : -1;
  const picked = index >= 0 ? filtered[index] : null;
  const exact = name ? filtered.find((row) => row && row.name === name) : null;
  const chosen = picked || exact || null;
  if (chosen) {
    const authoritative = chosen.authoritative === true;
    return {
      ok: true,
      name: chosen.name,
      wireKind: authoritative ? chosen.wireKind : "text",
      type: authoritative ? chosen.type : "text",
      fromCompletion: true,
      authoritative,
    };
  }
  return { ok: true, name, wireKind: "text", type: "text", fromCompletion: false, authoritative: false };
}

function propertyEditorAddSyntheticRow(name, wireKind) {
  const kind = PROPERTY_EDITOR_ADD_WIRE_KINDS.has(wireKind) ? wireKind : "text";
  let value;
  if (kind === "list" || kind === "tags" || kind === "aliases") value = [];
  else if (kind === "checkbox") value = false;
  else if (kind === "number") value = null;
  else value = "";
  return {
    key: name,
    line: null,
    end_line: null,
    value,
    kind,
    role: "loose",
    owner: "props",
    editor: null,
    reason: null,
    duplicate: false,
    opaque: false,
    pending: false,
  };
}

function propertyEditorParseCheckbox(raw) {
  const text = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!text || text === "false" || text === "no" || text === "0" || text === "off" || text === "✗") {
    return { ok: true, value: false };
  }
  if (text === "true" || text === "yes" || text === "1" || text === "on" || text === "✓") {
    return { ok: true, value: true };
  }
  return { ok: false, message: "Enter true or false for this checkbox." };
}

function propertyEditorAddStageBuild(stage, draft, options = {}) {
  if (!stage || !stage.add || !stage.addRow) {
    return { ok: false, message: "There is no property being added." };
  }
  const race = propertyEditorAddRace(stage.key, stage.addPlacement, options.properties);
  if (!race.ok) return race;
  let built;
  if (stage.kind === "checkbox") {
    const parsed = propertyEditorParseCheckbox(draft && draft.value);
    if (!parsed.ok) return parsed;
    built = {
      ok: true,
      value: parsed.value,
      kind: "checkbox",
      ops: [{ op: "prop.set", key: stage.key, value: parsed.value, kind: "checkbox" }],
      changed: true,
    };
  } else {
    built = propertyEditorStageBuild(stage.addRow, stage, draft, options);
  }
  if (!built || built.ok !== true) return built;
  const op = { ...built.ops[0], ...propertyEditorAddPositionFields(stage.addPlacement) };
  return { ...built, changed: true, ops: [op] };
}
