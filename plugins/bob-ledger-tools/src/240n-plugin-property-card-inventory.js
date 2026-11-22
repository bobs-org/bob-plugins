// Pure source-ordered frontmatter inventory for the property-card drawer.
// Source provides membership, order, occurrences, and line locations; the
// metadata cache provides values when the current path's cache is confirmed.
const PROPERTY_CARD_INVENTORY_RECOVERY = "Frontmatter doesn't parse — y opens YAML";

function propertyCardInventoryPath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
}

function propertyCardInventorySyntheticKey(key, value) {
  return key === "position" && value && typeof value === "object" && !Array.isArray(value)
    && (Object.prototype.hasOwnProperty.call(value, "start") || Object.prototype.hasOwnProperty.call(value, "end"));
}

function propertyCardInventoryCacheKeys(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return [];
  return Object.keys(frontmatter).filter((key) => !propertyCardInventorySyntheticKey(key, frontmatter[key]));
}

function propertyCardInventoryTypedValue(present, value) {
  if (!present) return "absent";
  if (value === null) return "null";
  if (value === "") return "empty-string";
  if (Array.isArray(value)) return value.length === 0 ? "empty-list" : "list";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value === 0 ? "zero" : "number";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "invalid-date" : "date";
  if (typeof value === "string") return "text";
  if (typeof value === "object") return "map";
  return "other";
}

function propertyCardInventoryColon(line) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) return -1;
    if (char === ":" && (index + 1 === line.length || /\s/.test(line[index + 1]))) return index;
  }
  return -1;
}

function propertyCardInventoryKey(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text[0] === "\"" && text[text.length - 1] === "\"") {
    try { return JSON.parse(text); } catch (_) { return text.slice(1, -1); }
  }
  if (text[0] === "'" && text[text.length - 1] === "'") return text.slice(1, -1).replace(/''/g, "'");
  if (text[0] === "?" && /^\?\s/.test(text)) return text.slice(1).trim();
  return text;
}

function propertyCardInventoryScalar(line, colon) {
  if (!Number.isInteger(colon) || colon < 0) return "";
  let raw = line.slice(colon + 1).trim();
  let quote = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quote = "";
    } else if (quote === "'") {
      if (char === "'" && raw[index + 1] === "'") index += 1;
      else if (char === "'") quote = "";
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(raw[index - 1]))) {
      raw = raw.slice(0, index).trimEnd();
      break;
    }
  }
  return raw;
}

function propertyCardScanFrontmatter(sourceText) {
  const allLines = String(sourceText).split(/\r?\n/);
  if (allLines.length && allLines[0].charCodeAt(0) === 0xFEFF) allLines[0] = allLines[0].slice(1);
  if (!allLines.length || allLines[0].trim() !== "---") {
    return { state: "none", yaml: "", yamlLines: [], entries: [], sourceLineOffset: 0 };
  }
  let close = -1;
  for (let index = 1; index < allLines.length; index += 1) {
    const marker = allLines[index].trim();
    if (marker === "---" || marker === "...") { close = index; break; }
  }
  if (close < 0) return { state: "unclosed", yaml: "", yamlLines: [], entries: [], sourceLineOffset: 1 };

  const yamlLines = allLines.slice(1, close);
  const entries = [];
  for (let index = 0; index < yamlLines.length; index += 1) {
    const line = yamlLines[index];
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line) || /^\s*[-?](?:\s|$)/.test(line)) continue;
    const colon = propertyCardInventoryColon(line);
    if (colon < 0) continue;
    const key = propertyCardInventoryKey(line.slice(0, colon));
    if (key === null || key === undefined || typeof key === "object") continue;
    entries.push({ key: String(key), yamlLine: index, colon, line: index + 2, rawScalar: propertyCardInventoryScalar(line, colon) });
  }
  return { state: "closed", yaml: yamlLines.join("\n"), yamlLines, entries, sourceLineOffset: 1 };
}

function propertyCardInventoryParserResult(parseYaml, yaml) {
  try {
    const value = parseYaml(yaml);
    if (value === null || value === undefined) return { ok: true, value: {} };
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: new Error("Frontmatter must be a mapping") };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function propertyCardInventoryTopLevelDuplicates(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const lines = byKey.get(entry.key) || [];
    lines.push(entry.line);
    byKey.set(entry.key, lines);
  }
  return [...byKey.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([key, lines]) => ({ kind: "duplicate", key, lines }));
}

function propertyCardInventoryCheckYaml(scan, parseYaml, duplicates) {
  if (typeof parseYaml !== "function") return { ok: false, pending: true, error: null };
  const direct = propertyCardInventoryParserResult(parseYaml, scan.yaml);
  if (direct.ok || !duplicates.length) return { ...direct, pending: false };

  // Some YAML parsers reject duplicate mapping keys. Rename only the later
  // top-level occurrences and parse again: duplicate rows stay visible, while
  // unrelated syntax errors still produce the ordinary recovery state.
  const lines = scan.yamlLines.slice();
  const seen = new Set();
  let replacement = 0;
  for (const entry of scan.entries) {
    if (!seen.has(entry.key)) { seen.add(entry.key); continue; }
    let candidate;
    do { candidate = `__bob_property_duplicate_${replacement++}__`; }
    while (seen.has(candidate));
    lines[entry.yamlLine] = `${JSON.stringify(candidate)}${lines[entry.yamlLine].slice(entry.colon)}`;
    seen.add(candidate);
  }
  const afterRenaming = propertyCardInventoryParserResult(parseYaml, lines.join("\n"));
  return afterRenaming.ok ? { ok: true, duplicateOnly: true } : { ...direct, pending: false };
}

function propertyCardInventoryManaged(key) {
  return /_digest$/.test(key) || /_drafted$/.test(key) || /^zorg_/.test(key) || /^generated_from_zorg/.test(key);
}

function propertyCardInventoryRows(entries, frontmatter, options = {}) {
  const cacheAvailable = options.cacheAvailable === true;
  const counts = new Map();
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
  const seen = new Map();
  return entries.map((entry) => {
    const occurrence = (seen.get(entry.key) || 0) + 1;
    seen.set(entry.key, occurrence);
    const duplicate = (counts.get(entry.key) || 0) > 1;
    const hasValue = cacheAvailable && Object.prototype.hasOwnProperty.call(frontmatter, entry.key);
    const value = hasValue ? frontmatter[entry.key] : undefined;
    const where = options.where && typeof options.where === "object" ? options.where : {};
    const nested = options.nested && typeof options.nested === "object" ? options.nested : {};
    const legacy = options.legacy && typeof options.legacy === "object" ? options.legacy : {};
    const hasMark = Object.prototype.hasOwnProperty.call(where, entry.key) && where[entry.key] != null && where[entry.key] !== "";
    const group = hasMark ? "card" : propertyCardInventoryManaged(entry.key) ? "managed" : "loose";
    const hasNested = Object.prototype.hasOwnProperty.call(nested, entry.key);
    const hasLegacy = Object.prototype.hasOwnProperty.call(legacy, entry.key);
    const pendingValue = options.valuePending === true || (cacheAvailable && !hasValue);
    return {
      id: `property:${encodeURIComponent(entry.key)}:${occurrence}`,
      key: entry.key,
      occurrence,
      line: entry.line == null ? null : entry.line,
      group,
      mark: hasMark ? String(where[entry.key]) : null,
      nested: hasNested ? nested[entry.key] : null,
      legacy: hasLegacy ? (legacy[entry.key] === true ? "legacy" : String(legacy[entry.key])) : null,
      duplicate,
      value,
      valuePresent: hasValue,
      valueState: pendingValue ? "pending" : propertyCardInventoryTypedValue(hasValue, value),
      valueSource: pendingValue ? "pending" : duplicate && hasValue ? "shared-cache" : hasValue ? "cache" : "absent",
      duplicateValuesIndependent: !duplicate,
      sourceScalar: entry.rawScalar || "",
    };
  });
}

function propertyCardInventoryGroups(rows) {
  const loose = rows.filter((row) => row.group === "loose");
  const card = rows.filter((row) => row.group === "card");
  const managed = rows.filter((row) => row.group === "managed");
  return [
    { id: "loose", label: "", rows: loose, count: loose.length },
    { id: "card", label: "On this card", rows: card, count: card.length },
    { id: "managed", label: `Managed · ${managed.length}`, rows: managed, count: managed.length, initiallyFolded: true },
  ];
}

function propertyCardInventoryPending(reason, rows = []) {
  return { state: "pending", reason, rows, groups: propertyCardInventoryGroups(rows), count: rows.length, issues: [], recovery: null };
}

function propertyCardInventoryFailure(state, issue, additionalIssues = []) {
  return {
    state, reason: issue.kind, rows: [], groups: propertyCardInventoryGroups([]),
    count: 0, issues: [issue, ...additionalIssues], recovery: PROPERTY_CARD_INVENTORY_RECOVERY,
  };
}

function propertyCardInventory(input = {}) {
  const options = input && typeof input === "object" ? input : {};
  const frontmatter = options.frontmatter && typeof options.frontmatter === "object" && !Array.isArray(options.frontmatter)
    ? options.frontmatter : null;
  const expectedPath = propertyCardInventoryPath(options.path);
  const sourcePath = propertyCardInventoryPath(options.sourcePath);
  const cachePath = propertyCardInventoryPath(options.cachePath);
  if (expectedPath && sourcePath && expectedPath !== sourcePath) return propertyCardInventoryPending("source-path-mismatch");
  const cacheMatches = !expectedPath || !cachePath || expectedPath === cachePath;
  const cacheAvailable = Boolean(frontmatter && cacheMatches);
  const sourceAvailable = typeof options.sourceText === "string";

  if (!sourceAvailable) {
    if (!cacheAvailable) return propertyCardInventoryPending("source-unavailable");
    const entries = propertyCardInventoryCacheKeys(frontmatter).map((key) => ({ key, line: null, rawScalar: "" }));
    const rows = propertyCardInventoryRows(entries, frontmatter, { ...options, cacheAvailable: true });
    return propertyCardInventoryPending("source-unavailable", rows);
  }

  const scan = propertyCardScanFrontmatter(options.sourceText);
  if (scan.state === "unclosed") return propertyCardInventoryFailure("unclosed", { kind: "unclosed-frontmatter" });
  if (scan.state === "none") {
    const cachedKeys = cacheAvailable ? propertyCardInventoryCacheKeys(frontmatter) : [];
    if (cachedKeys.length) return propertyCardInventoryPending("source-cache-mismatch");
    return { state: "ready", reason: null, rows: [], groups: propertyCardInventoryGroups([]), count: 0, issues: [], recovery: null };
  }

  const duplicates = propertyCardInventoryTopLevelDuplicates(scan.entries);
  const parsed = propertyCardInventoryCheckYaml(scan, options.parseYaml, duplicates);
  if (parsed.pending) return propertyCardInventoryPending("yaml-parser-unavailable");
  if (!parsed.ok) return propertyCardInventoryFailure(
    "invalid",
    { kind: "parse-failure", message: String(parsed.error && parsed.error.message || parsed.error || "Invalid YAML") },
    duplicates,
  );

  const rows = propertyCardInventoryRows(scan.entries, frontmatter, {
    ...options,
    cacheAvailable,
    valuePending: !cacheAvailable,
  });
  const valuesPending = rows.some((row) => row.valueState === "pending");
  return {
    state: cacheAvailable && !valuesPending ? "ready" : "pending",
    reason: valuesPending
      ? cachePath && expectedPath && cachePath !== expectedPath ? "cache-path-mismatch" : "cache-incomplete"
      : cacheAvailable ? null : "cache-unavailable",
    rows,
    groups: propertyCardInventoryGroups(rows),
    count: rows.length,
    issues: duplicates,
    recovery: null,
  };
}
