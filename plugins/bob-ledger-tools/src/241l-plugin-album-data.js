// Shared album report and sync service. Bob owns stored `[!albums]`
// catalog rows and `[!records]` index bytes; this fragment validates its
// versioned JSON and shares one stale-while-revalidate list report and one
// sync operation across mounted views. Later album phases consume
// `apiAlbumReport`/`apiAlbumSubscribe` instead of spawning their own CLI.

const ALBUM_REPORT_SCHEMA_VERSION = 1;
const ALBUM_LIST_TIMEOUT_MS = BOB_SPAWN_TIMEOUT_MS;
const ALBUM_LIST_MAX_BUFFER = BOB_SPAWN_MAX_BUFFER;
const ALBUM_REVALIDATE_DEBOUNCE_MS = 300;
const ALBUM_SYNC_DEBOUNCE_MS = 3000;
const ALBUM_ROLLOVER_INTERVAL_MS = 60 * 1000;

function albumListArgs() {
  return ["albums", "list", "-f", "json"];
}

function albumSyncArgs() {
  return ["albums", "sync", "-f", "json"];
}

function albumJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function albumJsonString(value) {
  return typeof value === "string" && value.length > 0;
}

function albumNullableString(value) {
  return value === null || typeof value === "string";
}

function albumJsonCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function albumStringArray(value) {
  return Array.isArray(value) && value.every((part) => typeof part === "string");
}

function albumIssueRows(value) {
  return Array.isArray(value) && value.every((issue) =>
    albumJsonObject(issue) &&
    albumJsonString(issue.code) &&
    (issue.severity === "error" || issue.severity === "warning" || issue.severity === "info") &&
    albumJsonString(issue.path) &&
    (issue.line === null || issue.line === undefined || albumJsonCount(issue.line)) &&
    (issue.key_path === null || issue.key_path === undefined || typeof issue.key_path === "string") &&
    typeof issue.message === "string" &&
    Array.isArray(issue.suggestions) && issue.suggestions.every((part) => typeof part === "string"),
  );
}

function albumOptionalBool(value) {
  return value === undefined || value === null || typeof value === "boolean";
}

function albumOptionalCount(value) {
  return value === undefined || value === null || albumJsonCount(value);
}

function albumChoiceShape(choice) {
  return albumJsonObject(choice) &&
    typeof choice.value === "string" &&
    typeof choice.label === "string" &&
    albumOptionalCount(choice.count);
}

function albumFieldShape(field) {
  return albumJsonObject(field) &&
    albumJsonString(field.key) &&
    typeof field.label === "string" &&
    typeof field.kind === "string" &&
    typeof field.required === "boolean" &&
    typeof field.list === "boolean" &&
    Array.isArray(field.choices) && field.choices.every(albumChoiceShape) &&
    (field.suggest === undefined || typeof field.suggest === "boolean") &&
    albumOptionalCount(field.line) &&
    albumOptionalCount(field.filled) &&
    (field.min === undefined || field.min === null || typeof field.min === "number") &&
    (field.max === undefined || field.max === null || typeof field.max === "number");
}

function albumGroupShape(group) {
  return albumJsonObject(group) &&
    typeof group.value === "string" &&
    typeof group.label === "string" &&
    albumJsonCount(group.count) &&
    albumStringArray(group.peek);
}

function albumIndexStateShape(index) {
  return albumJsonObject(index) &&
    (index.state === "current" || index.state === "missing" || index.state === "stale" || index.state === "damaged");
}

function albumEntryShape(entry) {
  return albumJsonObject(entry) &&
    albumJsonString(entry.stem) &&
    albumJsonString(entry.path) &&
    typeof entry.title === "string" &&
    albumNullableString(entry.emoji) &&
    albumNullableString(entry.summary) &&
    albumNullableString(entry.noun) &&
    albumNullableString(entry.label) &&
    albumNullableString(entry.plural) &&
    albumOptionalBool(entry.dated_notes) &&
    (entry.legacy === undefined || entry.legacy === null || albumStringArray(entry.legacy)) &&
    (entry.schema_fingerprint === undefined || entry.schema_fingerprint === null || typeof entry.schema_fingerprint === "string") &&
    albumNullableString(entry.parent) &&
    albumNullableString(entry.parent_kind) &&
    albumNullableString(entry.owner) &&
    albumNullableString(entry.root) &&
    albumStringArray(entry.breadcrumb) &&
    Array.isArray(entry.fields) && entry.fields.every(albumFieldShape) &&
    albumNullableString(entry.group_field) &&
    albumNullableString(entry.index_by) &&
    albumStringArray(entry.index_facets) &&
    albumJsonCount(entry.records) &&
    Array.isArray(entry.groups) && entry.groups.every(albumGroupShape) &&
    albumJsonCount(entry.needs_status) &&
    albumNullableString(entry.last_record) &&
    albumIndexStateShape(entry.index) &&
    albumIssueRows(entry.issues);
}

function albumCatalogShape(catalog) {
  return albumJsonObject(catalog) &&
    albumJsonString(catalog.host) &&
    albumJsonString(catalog.path) &&
    albumNullableString(catalog.root) &&
    ["current", "stale", "missing", "damaged"].includes(catalog.state) &&
    albumJsonCount(catalog.albums) &&
    albumIssueRows(catalog.issues);
}

function albumCountsShape(counts, forSync) {
  if (!albumJsonObject(counts)) {
    return false;
  }
  if (
    !albumJsonCount(counts.albums) ||
    !albumJsonCount(counts.records) ||
    !albumJsonCount(counts.roots)
  ) {
    return false;
  }
  for (const key of ["errors", "warnings", "damaged"]) {
    if (counts[key] !== undefined && !albumJsonCount(counts[key])) {
      return false;
    }
  }
  void forSync;
  return true;
}

function albumReportPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function albumIndexReport(report) {
  const albumsByPath = new Map();
  const albumsByStem = new Map();
  const catalogsByHostPath = new Map();
  for (const album of report.albums) {
    albumsByPath.set(albumReportPath(album.path), album);
    albumsByStem.set(album.stem, album);
  }
  for (const catalog of report.catalogs) {
    catalogsByHostPath.set(albumReportPath(catalog.path), catalog);
  }
  return { ...report, albumsByPath, albumsByStem, catalogsByHostPath };
}

function albumDecodeListReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob albums list returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!albumJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob albums list returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== ALBUM_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob albums list uses a different schema.", detail: statsFirstLine(stderr) };
  }
  if (
    typeof body.ok !== "boolean" ||
    !Array.isArray(body.albums) || !body.albums.every(albumEntryShape) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(albumCatalogShape) ||
    !albumCountsShape(body.counts, false) ||
    (body.findings !== undefined && !Array.isArray(body.findings))
  ) {
    return { ok: false, code: "bad-shape", message: "bob albums list returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  // `ok: false` is a valid list: invalid albums stay visible with their
  // counts and issues. Transport failure is different from invalid content.
  return { ok: true, report: albumIndexReport(body) };
}

function albumDecodeSyncReport(stdout, stderr = "") {
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob albums sync returned invalid JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!albumJsonObject(body)) {
    return { ok: false, code: "bad-shape", message: "bob albums sync returned no report object.", detail: statsFirstLine(stderr) };
  }
  if (body.schema_version !== ALBUM_REPORT_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob albums sync uses a different schema.", detail: statsFirstLine(stderr) };
  }
  if (
    typeof body.ok !== "boolean" || body.command !== "sync" ||
    !Array.isArray(body.changed) || !body.changed.every((path) => typeof path === "string") ||
    !Array.isArray(body.changes) || !body.changes.every((change) => albumJsonObject(change) && typeof change.path === "string") ||
    !Array.isArray(body.albums) || !body.albums.every(albumEntryShape) ||
    !Array.isArray(body.catalogs) || !body.catalogs.every(albumCatalogShape) ||
    !Array.isArray(body.findings) ||
    !albumCountsShape(body.counts, true)
  ) {
    return { ok: false, code: "bad-shape", message: "bob albums sync returned an incomplete report.", detail: statsFirstLine(stderr) };
  }
  // A well-formed refusal (for example, a damaged catalog or a missing
  // worktree) is transport success with an operation-level `ok: false`
  // for the shared sync caller.
  return { ok: true, report: body };
}

function albumTypeNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap((part) => albumTypeNames(part));
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
    return text.slice(1, -1).split(",").flatMap((part) => albumTypeNames(part));
  }
  if (text.startsWith("- ")) {
    return albumTypeNames(text.slice(2));
  }
  if (text.startsWith("[[") && text.endsWith("]]")) {
    text = text.slice(2, -2).split("|")[0].split("#")[0].trim();
  }
  text = text.replace(/\.md$/i, "").trim().toLowerCase();
  return text ? [text] : [];
}

function albumNormalizeParent(value) {
  if (Array.isArray(value)) {
    return value.map(albumNormalizeParent).filter(Boolean).sort().join("\u0000");
  }
  if (albumJsonObject(value) && typeof value.path === "string") {
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

function albumNormalizeSummary(value) {
  if (Array.isArray(value)) {
    return value.map(albumNormalizeSummary).filter(Boolean).join("\n");
  }
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function albumNormalizeText(value) {
  if (Array.isArray(value)) {
    return value.map(albumNormalizeText).filter(Boolean).join("\n");
  }
  return typeof value === "string" ? value.trim() : "";
}

function albumNormalizeIndexFacets(value) {
  const list = Array.isArray(value) ? value : (value === null || value === undefined ? [] : [value]);
  const facets = [];
  for (const part of list) {
    if (typeof part !== "string") {
      continue;
    }
    const text = part.trim();
    if (text) {
      facets.push(text);
    }
  }
  return facets;
}

// Order-preserving canonical form for the `record:` schema subtree.
// Field and choice order is significant to the album contract, so objects
// keep insertion order at every level instead of sorting keys.
function albumStableStringify(value, seen) {
  const guard = seen || new Set();
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((part) => albumStableStringify(part, guard)).join(",")}]`;
  }
  if (typeof value === "object") {
    if (guard.has(value)) {
      return "\"<cycle>\"";
    }
    guard.add(value);
    const parts = Object.keys(value).map((key) =>
      `${JSON.stringify(key)}:${albumStableStringify(value[key], guard)}`,
    );
    guard.delete(value);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function albumFrontmatterFingerprint(frontmatter) {
  const data = albumJsonObject(frontmatter) ? frontmatter : {};
  const types = [...new Set(albumTypeNames(data.type))].sort();
  const indexFacets = albumNormalizeIndexFacets(data.index_facets);
  return {
    types,
    typeKey: types.join("\u0000"),
    isAlbum: types.includes("album"),
    isOwner: types.includes("area") || types.includes("project"),
    parent: albumNormalizeParent(data.parent),
    summary: albumNormalizeSummary(data.summary),
    emoji: albumNormalizeText(data.emoji),
    noun: albumNormalizeText(data.record && albumJsonObject(data.record) ? data.record.noun : data.noun),
    label: albumNormalizeText(data.record && albumJsonObject(data.record) ? data.record.label : data.label),
    plural: albumNormalizeText(data.record && albumJsonObject(data.record) ? data.record.plural : data.plural),
    indexBy: albumNormalizeText(data.index_by),
    indexFacets,
    indexFacetsKey: indexFacets.join("\u0000"),
    recordSignature: albumStableStringify(data.record === undefined ? null : data.record),
    contentKey: albumStableStringify(data),
  };
}

function albumDirname(path) {
  const slash = path.replace(/\\/g, "/");
  const index = slash.lastIndexOf("/");
  return index < 0 ? "" : slash.slice(0, index);
}

function albumIsMember(fingerprint, path, knownStems) {
  if (!fingerprint) {
    return false;
  }
  const stems = knownStems instanceof Set ? knownStems : new Set();
  const folder = albumDirname(albumReportPath(path));
  const folderBase = folder.includes("/") ? folder.slice(folder.lastIndexOf("/") + 1) : folder;
  if (folderBase && stems.has(folderBase)) {
    return true;
  }
  if (fingerprint.parent) {
    const parentBase = fingerprint.parent.includes("/")
      ? fingerprint.parent.slice(fingerprint.parent.lastIndexOf("/") + 1)
      : fingerprint.parent;
    if (stems.has(fingerprint.parent) || (parentBase && stems.has(parentBase))) {
      return true;
    }
    // Before the first report lands there are no known stems yet; treat
    // any parent-linked note as a potential record member so its first
    // frontmatter change still invalidates the pending report.
    if (stems.size === 0) {
      return true;
    }
  }
  return false;
}

function albumFingerprintNeedsSync(previous, next, path, knownStems) {
  const stems = knownStems instanceof Set ? knownStems : new Set();
  const key = albumReportPath(path);
  if (!next) {
    if (!previous) {
      return false;
    }
    return Boolean(
      previous.isAlbum || previous.isOwner || albumIsMember(previous, key, stems),
    );
  }
  if (!previous) {
    return Boolean(
      next.isAlbum || next.isOwner || albumIsMember(next, key, stems),
    );
  }
  if (previous.isAlbum !== next.isAlbum) {
    return true;
  }
  if (next.isAlbum) {
    // Compare content, never metadata offsets. Unknown or invalid schemas
    // still refresh: their raw `record:` bytes enter the signature.
    return (
      previous.typeKey !== next.typeKey ||
      previous.parent !== next.parent ||
      previous.summary !== next.summary ||
      previous.emoji !== next.emoji ||
      previous.noun !== next.noun ||
      previous.label !== next.label ||
      previous.plural !== next.plural ||
      previous.indexBy !== next.indexBy ||
      previous.indexFacetsKey !== next.indexFacetsKey ||
      previous.recordSignature !== next.recordSignature
    );
  }
  const ownerTransition = previous.isOwner !== next.isOwner;
  const typeTransition = previous.typeKey !== next.typeKey;
  if (previous.isOwner || next.isOwner) {
    // An owner's ancestry or type invalidates the catalogs that list it.
    // Other owner frontmatter stays out of the sync decision.
    return Boolean(ownerTransition || typeTransition || previous.parent !== next.parent);
  }
  const wasMember = albumIsMember(previous, key, stems);
  const isMember = albumIsMember(next, key, stems);
  if (!wasMember && !isMember) {
    return false;
  }
  // Structural record members sync on any frontmatter change: grouping,
  // counts, and ages all read record fields. Body-only edits never reach
  // this comparison because the fingerprint is frontmatter-only.
  return (
    wasMember !== isMember ||
    previous.typeKey !== next.typeKey ||
    previous.parent !== next.parent ||
    previous.contentKey !== next.contentKey
  );
}

function albumIsMarkdownFile(fileOrPath) {
  const path = typeof fileOrPath === "string"
    ? fileOrPath
    : fileOrPath && typeof fileOrPath.path === "string"
      ? fileOrPath.path
      : "";
  return /\.md$/i.test(path);
}

function albumRelevantPath(fileOrPath) {
  if (!albumIsMarkdownFile(fileOrPath)) {
    return false;
  }
  const path = albumReportPath(typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path);
  return !path.split("/").some((part) =>
    part === ".obsidian" || part === ".bob" || part === "node_modules" || part.startsWith("."),
  );
}

function albumLocalDate(now = new Date()) {
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

function albumErrorModel(error) {
  const source = albumJsonObject(error) ? error : { code: "failed" };
  const code = typeof source.code === "string" ? source.code : "failed";
  if (code === "bob-not-found" && /needs the desktop app/i.test(String(source.message || ""))) {
    return { code: "desktop-only", hint: "Album data needs desktop Obsidian, where bob can run." };
  }
  if (code === "bob-not-found") {
    return { code, hint: "bob was not found. Install or update bob-cli, or set stats.bob_path." };
  }
  if (code === "timeout") {
    return { code, hint: "bob albums timed out. Retry, then check bob albums list in a terminal." };
  }
  if (code === "schema-mismatch" || code === "bad-json" || code === "bad-shape") {
    return { code, hint: "Update bob-cli and Bob Ledger Tools together, then retry." };
  }
  return {
    code,
    hint: source.detail || source.hint || source.message || "Album data is unavailable. Retry bob albums list.",
  };
}
