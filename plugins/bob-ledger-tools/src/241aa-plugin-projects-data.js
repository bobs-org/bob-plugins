// Shared projects report and sync service. Bob owns stored `[!projects]`
// catalog bytes; this fragment validates the versioned list and sync JSON
// and fingerprints project identity, scalar parent, status, and the real
// lifecycle `^prj` checkbox. The mixin in 241ab shares one stale-while-
// revalidate list report and one trailing sync across mounted views.

const PROJECTS_REPORT_SCHEMA_VERSION = 1;
const PROJECTS_LIST_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const PROJECTS_LIST_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const PROJECTS_REVALIDATE_DEBOUNCE_MS = 300;
const PROJECTS_SYNC_DEBOUNCE_MS = 3000;
const PROJECTS_ROLLOVER_INTERVAL_MS = 60 * 1000;
const PROJECTS_ROW_STATES = new Set([
  "open",
  "scheduled",
  "blocked",
  "warning",
  "done",
  "canceled",
]);
const PROJECTS_CATALOG_STATES = new Set(["current", "stale", "missing", "damaged"]);
const PROJECTS_CATALOG_KINDS = new Set(["area", "project"]);
const PROJECTS_ISSUE_SEVERITIES = new Set(["error", "warning", "info"]);

function projectsListArgs() {
  return ["projects", "list", "-f", "json"];
}

function projectsSyncArgs() {
  return ["projects", "sync", "-f", "json"];
}

function projectsJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectsJsonString(value) {
  return typeof value === "string" && value.length > 0;
}

function projectsNullableString(value) {
  return value === null || typeof value === "string";
}

function projectsJsonCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function projectsNullableCount(value) {
  return value === null || projectsJsonCount(value);
}

function projectsNullableBool(value) {
  return value === null || typeof value === "boolean";
}

function projectsStringArray(value) {
  return Array.isArray(value) && value.every((part) => typeof part === "string");
}

function projectsListIssueShape(issue) {
  return projectsJsonObject(issue) &&
    projectsJsonString(issue.code) &&
    PROJECTS_ISSUE_SEVERITIES.has(issue.severity) &&
    (issue.line === null || issue.line === undefined || projectsJsonCount(issue.line)) &&
    typeof issue.message === "string";
}

function projectsSyncIssueShape(issue) {
  return projectsJsonObject(issue) &&
    projectsJsonString(issue.code) &&
    (issue.line === null || issue.line === undefined || projectsJsonCount(issue.line)) &&
    typeof issue.message === "string";
}

function projectsPrjShape(prj) {
  return projectsJsonObject(prj) &&
    projectsNullableCount(prj.line) &&
    projectsNullableString(prj.mark) &&
    projectsNullableBool(prj.hidden) &&
    projectsNullableString(prj.scheduled);
}

function projectsBlockedShape(blocked) {
  if (blocked === null) {
    return true;
  }
  if (!projectsJsonObject(blocked) || typeof blocked.kind !== "string") {
    return false;
  }
  if (blocked.kind === "scheduled") {
    return projectsNullableString(blocked.date);
  }
  if (blocked.kind === "dependency") {
    return projectsStringArray(blocked.waits_on);
  }
  return blocked.kind === "inherited";
}

function projectsTasksShape(tasks) {
  return projectsJsonObject(tasks) &&
    projectsNullableCount(tasks.open) &&
    projectsNullableCount(tasks.shown) &&
    projectsNullableCount(tasks.today);
}

function projectsEntryShape(entry) {
  return projectsJsonObject(entry) &&
    projectsJsonString(entry.path) &&
    projectsJsonString(entry.stem) &&
    typeof entry.status === "string" &&
    (entry.state === null || PROJECTS_ROW_STATES.has(entry.state)) &&
    projectsNullableString(entry.criterion) &&
    projectsNullableString(entry.parent) &&
    projectsStringArray(entry.children) &&
    projectsNullableString(entry.closed_on) &&
    projectsPrjShape(entry.prj) &&
    projectsBlockedShape(entry.blocked) &&
    projectsTasksShape(entry.tasks);
}

function projectsListCatalogShape(catalog) {
  return projectsJsonObject(catalog) &&
    projectsJsonString(catalog.host) &&
    projectsJsonString(catalog.path) &&
    PROJECTS_CATALOG_KINDS.has(catalog.kind) &&
    PROJECTS_CATALOG_STATES.has(catalog.state) &&
    projectsJsonObject(catalog.rows) &&
    projectsJsonCount(catalog.rows.open) &&
    projectsJsonCount(catalog.rows.blocked) &&
    projectsJsonCount(catalog.rows.warning) &&
    projectsJsonCount(catalog.rows.closed) &&
    Array.isArray(catalog.issues) && catalog.issues.every(projectsListIssueShape);
}

function projectsSyncCatalogShape(catalog) {
  return projectsJsonObject(catalog) &&
    projectsJsonString(catalog.host) &&
    projectsJsonString(catalog.path) &&
    (catalog.kind === undefined || PROJECTS_CATALOG_KINDS.has(catalog.kind)) &&
    PROJECTS_CATALOG_STATES.has(catalog.state) &&
    projectsJsonCount(catalog.open) &&
    projectsJsonCount(catalog.blocked) &&
    projectsJsonCount(catalog.warning) &&
    projectsJsonCount(catalog.closed) &&
    Array.isArray(catalog.issues) && catalog.issues.every(projectsSyncIssueShape);
}

function projectsListCountsShape(counts) {
  return projectsJsonObject(counts) &&
    projectsJsonCount(counts.projects) &&
    projectsJsonCount(counts.catalogs) &&
    projectsJsonCount(counts.errors) &&
    projectsJsonCount(counts.warnings);
}

function projectsChangeShape(change) {
  return projectsJsonObject(change) && typeof change.path === "string";
}

function projectsReportPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function projectsIndexReport(report) {
  const projectsByPath = new Map();
  const projectsByStem = new Map();
  const catalogsByHostPath = new Map();
  for (const project of report.projects) {
    const path = projectsReportPath(project.path);
    projectsByPath.set(path, project);
    const stem = project.stem;
    const rows = projectsByStem.get(stem);
    if (rows) {
      rows.push(project);
    } else {
      projectsByStem.set(stem, [project]);
    }
  }
  for (const catalog of report.catalogs) {
    catalogsByHostPath.set(projectsReportPath(catalog.path), catalog);
  }
  return { ...report, projectsByPath, projectsByStem, catalogsByHostPath };
}

function projectsDecodeListReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob projects list returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!projectsJsonObject(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob projects list returned no report object.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== PROJECTS_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: "bob projects list uses a different schema.",
      detail: statsFirstLine(stderr),
    };
  }
  if (
    typeof body.ok !== "boolean" ||
    body.command !== "list" ||
    typeof body.today !== "string" ||
    !Array.isArray(body.projects) || !body.projects.every(projectsEntryShape) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(projectsListCatalogShape) ||
    !Array.isArray(body.findings) ||
    !projectsListCountsShape(body.counts)
  ) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob projects list returned an incomplete report.",
      detail: statsFirstLine(stderr),
    };
  }
  // `ok: false` is a valid list: damaged catalogs and warning rows stay
  // visible. Transport failure is different from invalid content.
  return { ok: true, report: projectsIndexReport(body) };
}

function projectsDecodeSyncReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob projects sync returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!projectsJsonObject(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob projects sync returned no report object.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== PROJECTS_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: "bob projects sync uses a different schema.",
      detail: statsFirstLine(stderr),
    };
  }
  if (
    typeof body.ok !== "boolean" || body.command !== "sync" ||
    typeof body.dry_run !== "boolean" ||
    !Array.isArray(body.changed) || !body.changed.every((path) => typeof path === "string") ||
    !Array.isArray(body.changes) || !body.changes.every(projectsChangeShape) ||
    !Array.isArray(body.events) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(projectsSyncCatalogShape) ||
    !Array.isArray(body.findings) ||
    !Array.isArray(body.warnings) ||
    (body.commit !== null && body.commit !== undefined && !projectsJsonObject(body.commit)) ||
    (body.sync !== null && body.sync !== undefined && !projectsJsonObject(body.sync)) ||
    (body.error !== undefined && body.error !== null && !projectsJsonObject(body.error))
  ) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob projects sync returned an incomplete report.",
      detail: statsFirstLine(stderr),
    };
  }
  // A well-formed refusal (damaged catalog, lock busy, missing worktree)
  // is transport success with an operation-level `ok: false`.
  return { ok: true, report: body };
}

function projectsTypeNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap((part) => projectsTypeNames(part));
  }
  if (typeof value !== "string") {
    return [];
  }
  let text = value.trim();
  if (!text) {
    return [];
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("[[") && text.endsWith("]]") && /^\[\[[^\[\]]+\]\]$/.test(text)) {
    text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  } else if (text.startsWith("[") && text.endsWith("]")) {
    return text.slice(1, -1).split(",").flatMap((part) => projectsTypeNames(part));
  }
  if (text.startsWith("- ")) {
    return projectsTypeNames(text.slice(2));
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  }
  text = text.replace(/\.md$/i, "").trim().toLowerCase();
  return text ? [text] : [];
}

function projectsNormalizeScalarParent(value) {
  if (projectsJsonObject(value) && typeof value.path === "string") {
    value = value.path;
  }
  if (typeof value !== "string") {
    return "";
  }
  let text = value.trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    text = text.slice(2, -2).split("|")[0].trim();
  }
  text = text.split("#")[0].replace(/\\/g, "/").replace(/\.md$/i, "").trim();
  return text;
}

function projectsNormalizeParent(value) {
  if (Array.isArray(value)) {
    return "\u0001list:" + value.map(projectsNormalizeScalarParent).filter(Boolean).sort().join("\u0000");
  }
  return projectsNormalizeScalarParent(value);
}

function projectsNormalizeStatus(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return "\u0001value:" + String(value);
  }
  if (Array.isArray(value)) {
    return "\u0001list:" + value.map(projectsNormalizeStatus).join("\u0000");
  }
  return "\u0001other";
}

function projectsBodyStart(lines) {
  if (!/^\s*---\s*$/.test(lines[0] || "")) {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (/^\s*---\s*$/.test(lines[index])) {
      return index + 1;
    }
  }
  return lines.length;
}

function projectsFencedLines(lines) {
  const fenced = new Set();
  let opening = null;
  for (let line = 0; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!opening) {
      const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (match) {
        opening = { marker: match[1][0], length: match[1].length };
        fenced.add(line);
      }
      continue;
    }
    fenced.add(line);
    const close = text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (close && close[1][0] === opening.marker && close[1].length >= opening.length) {
      opening = null;
    }
  }
  return fenced;
}

function projectsIsPrjAnchor(raw) {
  return raw === "^prj" || raw.endsWith(" ^prj") || raw.endsWith("\t^prj");
}

function projectsCheckboxMark(raw) {
  const match = String(raw || "").match(/^\s*[-+*]\s+\[([^\]]*)\]/);
  return match ? match[1] : "";
}

function projectsLifecycleFingerprint(text) {
  const source = typeof text === "string" ? text : "";
  if (!source) {
    return { kind: "missing", mark: null, count: 0 };
  }
  const lines = source.split(/\r?\n/);
  const start = projectsBodyStart(lines);
  const fenced = projectsFencedLines(lines);
  const hits = [];
  for (let line = start; line < lines.length; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const raw = String(lines[line] || "").replace(/[ \t]+$/, "");
    if (!projectsIsPrjAnchor(raw)) {
      continue;
    }
    hits.push(projectsCheckboxMark(raw));
  }
  if (hits.length === 0) {
    return { kind: "missing", mark: null, count: 0 };
  }
  if (hits.length > 1) {
    return { kind: "duplicate", mark: null, count: hits.length };
  }
  return { kind: "one", mark: hits[0], count: 1 };
}

function projectsFingerprint(frontmatter, text) {
  const data = projectsJsonObject(frontmatter) ? frontmatter : {};
  const types = [...new Set(projectsTypeNames(data.type))].sort();
  const lifecycle = projectsLifecycleFingerprint(text);
  return {
    types,
    typeKey: types.join("\u0000"),
    isProject: types.includes("project"),
    isArea: types.includes("area"),
    isHost: types.includes("project") || types.includes("area"),
    parent: projectsNormalizeParent(data.parent),
    status: projectsNormalizeStatus(data.status),
    prjKind: lifecycle.kind,
    prjMark: lifecycle.mark,
    prjCount: lifecycle.count,
  };
}

function projectsFingerprintNeedsSync(previous, next) {
  if (!next) {
    return Boolean(previous && (previous.isProject || previous.isHost));
  }
  if (!previous) {
    return Boolean(next.isProject || next.isHost);
  }
  if (previous.isProject !== next.isProject || previous.isArea !== next.isArea) {
    return true;
  }
  if (next.isProject) {
    return (
      previous.typeKey !== next.typeKey ||
      previous.parent !== next.parent ||
      previous.status !== next.status ||
      previous.prjKind !== next.prjKind ||
      previous.prjMark !== next.prjMark ||
      previous.prjCount !== next.prjCount
    );
  }
  if (previous.isHost || next.isHost) {
    return previous.typeKey !== next.typeKey || previous.parent !== next.parent;
  }
  return false;
}

function projectsIsMarkdownFile(fileOrPath) {
  const path = typeof fileOrPath === "string"
    ? fileOrPath
    : fileOrPath && typeof fileOrPath.path === "string"
      ? fileOrPath.path
      : "";
  return /\.md$/i.test(path);
}

function projectsRelevantPath(fileOrPath) {
  if (!projectsIsMarkdownFile(fileOrPath)) {
    return false;
  }
  const path = projectsReportPath(typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path);
  if (typeof isDoneArchivePath === "function" && isDoneArchivePath(path)) {
    return false;
  }
  return !path.split("/").some((part) =>
    part === ".obsidian" || part === ".bob" || part === "node_modules" || part.startsWith("."),
  );
}

function projectsLocalDate(now = new Date()) {
  try {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } catch (error) {
    return "";
  }
}

function projectsErrorModel(error) {
  const source = projectsJsonObject(error) ? error : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Projects data needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "timeout") {
    return { code, hint: "bob projects timed out. Retry, then check bob projects list in a terminal." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "Projects data is unavailable. Retry bob projects list.",
  };
}

function projectsEventPayload(eventData) {
  if (typeof eventData === "string") {
    return { text: eventData, frontmatter: null };
  }
  if (!projectsJsonObject(eventData)) {
    return { text: null, frontmatter: null };
  }
  const text = typeof eventData.text === "string"
    ? eventData.text
    : typeof eventData.data === "string"
      ? eventData.data
      : null;
  const frontmatter = projectsJsonObject(eventData.frontmatter) ? eventData.frontmatter : null;
  return { text, frontmatter };
}
