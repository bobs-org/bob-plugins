// Shared Areas report and sync contract. Bob owns catalog bytes and reports
// area identity, order, nesting, and hue; this fragment only validates and
// indexes the versioned JSON.

const AREAS_REPORT_SCHEMA_VERSION = 1;
const AREAS_LIST_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const AREAS_LIST_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const AREAS_REVALIDATE_DEBOUNCE_MS = 300;
const AREAS_ROLLOVER_INTERVAL_MS = 60 * 1000;
const AREAS_HUES = new Set(["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"]);
const AREAS_HUE_SOURCES = new Set(["color", "muted", "hash"]);
const AREAS_CATALOG_STATES = new Set(["current", "stale", "missing", "damaged"]);

function areasListArgs() {
  return ["areas", "list", "-f", "json"];
}

function areasSyncArgs() {
  return ["areas", "sync", "-f", "json"];
}

function areasJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function areasJsonString(value) {
  return typeof value === "string" && value.length > 0;
}

function areasNullableString(value) {
  return value === null || typeof value === "string";
}

function areasJsonCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function areasIssueShape(issue) {
  return areasJsonObject(issue) && areasJsonString(issue.code) &&
    (issue.severity === "error" || issue.severity === "warning") &&
    (issue.line === null || issue.line === undefined || areasJsonCount(issue.line)) &&
    typeof issue.message === "string";
}

function areasRollupShape(value) {
  return areasJsonObject(value) && areasJsonCount(value.direct) && areasJsonCount(value.subtree);
}

function areasEntryShape(entry) {
  return areasJsonObject(entry) &&
    areasJsonString(entry.path) && areasJsonString(entry.stem) &&
    areasJsonString(entry.link) && areasJsonString(entry.title) &&
    typeof entry.titled === "boolean" && areasNullableString(entry.summary) &&
    areasNullableString(entry.parent) && areasNullableString(entry.parent_raw) &&
    (entry.depth === null || areasJsonCount(entry.depth)) &&
    areasNullableString(entry.top) &&
    (entry.hue === null || AREAS_HUES.has(entry.hue)) &&
    (entry.hue_source === null || AREAS_HUE_SOURCES.has(entry.hue_source)) &&
    Array.isArray(entry.children) && entry.children.every((path) => typeof path === "string") &&
    areasRollupShape(entry.projects) && areasRollupShape(entry.today) &&
    Array.isArray(entry.issues) && entry.issues.every(areasIssueShape);
}

function areasCatalogShape(catalog) {
  return areasJsonObject(catalog) && areasJsonString(catalog.host) &&
    areasJsonString(catalog.path) && ["root", "area", "project"].includes(catalog.kind) &&
    AREAS_CATALOG_STATES.has(catalog.state) && Array.isArray(catalog.rows) &&
    catalog.rows.every((row) => areasJsonObject(row) && areasJsonString(row.path) &&
      areasJsonString(row.link) && areasJsonCount(row.depth)) &&
    Array.isArray(catalog.issues) && catalog.issues.every(areasIssueShape);
}

function areasReportPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string" ? value.path : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function areasIndexReport(report) {
  const areasByPath = new Map();
  const areasByStem = new Map();
  const areasByLink = new Map();
  const catalogsByHostPath = new Map();
  for (const entry of report.areas) {
    const path = areasReportPath(entry.path);
    areasByPath.set(path, entry);
    const stemRows = areasByStem.get(entry.stem) || [];
    stemRows.push(entry);
    areasByStem.set(entry.stem, stemRows);
    const linkRows = areasByLink.get(entry.link) || [];
    linkRows.push(entry);
    areasByLink.set(entry.link, linkRows);
  }
  for (const catalog of report.catalogs) {
    catalogsByHostPath.set(areasReportPath(catalog.path), catalog);
  }
  return { ...report, areasByPath, areasByStem, areasByLink, catalogsByHostPath };
}

function areasDecodeListReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return { ok: false, code: "bad-json", message: "bob areas list returned invalid JSON.", detail: statsFirstLine(stderr) };
  }
  if (!areasJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob areas list returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== AREAS_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob areas list uses a different schema.", detail: statsFirstLine(stderr) };
  }
  const root = body.root;
  const counts = body.counts;
  const catalogCounts = counts && counts.catalogs;
  if (
    typeof body.ok !== "boolean" || body.command !== "list" ||
    !areasJsonObject(root) || !["found", "missing", "ambiguous"].includes(root.state) ||
    !areasNullableString(root.path) || !areasNullableString(root.stem) ||
    !Array.isArray(body.areas) || !body.areas.every(areasEntryShape) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(areasCatalogShape) ||
    !Array.isArray(body.findings) || !body.findings.every(areasIssueShape) ||
    !areasJsonObject(counts) || !areasJsonCount(counts.areas) ||
    !areasJsonCount(counts.top_level) || !areasJsonCount(counts.hosts) ||
    !areasJsonCount(counts.errors) || !areasJsonCount(counts.warnings) ||
    !areasJsonObject(catalogCounts) || !["current", "missing", "stale", "damaged"].every((key) => areasJsonCount(catalogCounts[key]))
  ) {
    return { ok: false, code: "bad-shape", message: "bob areas list returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  return { ok: true, report: areasIndexReport(body) };
}

function areasDecodeSyncReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return { ok: false, code: "bad-json", message: "bob areas sync returned invalid JSON.", detail: statsFirstLine(stderr) };
  }
  if (!areasJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob areas sync returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== AREAS_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob areas sync uses a different schema.", detail: statsFirstLine(stderr) };
  }
  if (
    typeof body.ok !== "boolean" || body.command !== "sync" || typeof body.dry_run !== "boolean" ||
    !Array.isArray(body.changed) || !body.changed.every((path) => typeof path === "string") ||
    !Array.isArray(body.changes) || !body.changes.every((change) => areasJsonObject(change) && typeof change.path === "string") ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(areasCatalogShape) ||
    !Array.isArray(body.findings) || !body.findings.every(areasIssueShape) ||
    !Array.isArray(body.warnings) ||
    (body.commit !== undefined && body.commit !== null && !areasJsonObject(body.commit)) ||
    (body.sync !== undefined && body.sync !== null && !areasJsonObject(body.sync)) ||
    (body.error !== undefined && body.error !== null && !areasJsonObject(body.error))
  ) {
    return { ok: false, code: "bad-shape", message: "bob areas sync returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  return { ok: true, report: body };
}

function areasTypeNames(value) {
  if (Array.isArray(value)) return value.flatMap(areasTypeNames);
  if (typeof value !== "string") return [];
  let text = value.trim();
  if (!text) return [];
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1).trim();
  if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  else if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1).split(",").flatMap(areasTypeNames);
  if (text.startsWith("- ")) return areasTypeNames(text.slice(2));
  return [text.replace(/\.md$/i, "").trim().toLowerCase()].filter(Boolean);
}

function areasRelevantPath(fileOrPath, options = {}) {
  const path = areasReportPath(fileOrPath);
  if (!/\.md$/i.test(path) || (typeof isDoneArchivePath === "function" && isDoneArchivePath(path))) return false;
  if (path.split("/").some((part) => part === ".obsidian" || part === ".bob" || part === "node_modules" || part.startsWith("."))) return false;
  const normalized = path.toLowerCase();
  const rootPath = areasReportPath(options.rootPath).toLowerCase();
  const dailyPath = areasReportPath(options.dailyPath).toLowerCase();
  if ((rootPath && normalized === rootPath) || (dailyPath && normalized === dailyPath)) return true;
  if ((normalized.split("/").pop() || "").replace(/\.md$/i, "") === "area") return true;
  const frontmatter = options.frontmatter || (fileOrPath && typeof fileOrPath === "object" ? fileOrPath.frontmatter : null) || {};
  const types = areasTypeNames(frontmatter.type);
  return types.includes("area") || types.includes("project");
}

function areasLocalDate(now = new Date()) {
  try {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } catch (_error) {
    return "";
  }
}

function areasErrorModel(error) {
  const source = areasJsonObject(error) ? error : { code: "failed" };
  if (source.code === "bob-not-found") return { hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  if (source.code === "timeout") return { hint: "bob areas timed out. Retry, then check bob areas list in a terminal." };
  if (["schema-mismatch", "bad-json", "bad-shape"].includes(source.code)) return { hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  return { hint: source.detail || source.hint || source.message || "Areas data is unavailable. Retry bob areas list." };
}
