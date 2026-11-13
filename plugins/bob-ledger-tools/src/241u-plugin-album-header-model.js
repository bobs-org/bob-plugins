// Album header identity and presentation models. Album report labels are never
// link targets; ancestry is resolved through each owner's real parent link.
const ALBUM_HEADER_CLASS = "bob-album-header";
const ALBUM_HEADER_SURFACE_CLASS = "bob-album-header-surface";
const ALBUM_HEADER_CRUMB_CLASS = "bob-album-header-crumb";
const ALBUM_HEADER_MAX_ANCESTORS = 8;

function albumHeaderPath(value) {
  return albumReportPath(value).replace(/\/$/, "");
}

function albumHeaderEntry(report, sourcePath) {
  const path = albumHeaderPath(sourcePath);
  if (!report || !path) return null;
  if (report.albumsByPath instanceof Map) return report.albumsByPath.get(path) || null;
  return (Array.isArray(report.albums) ? report.albums : [])
    .find((album) => albumHeaderPath(album?.path) === path) || null;
}

function albumHeaderSourceType(source) {
  const text = String(source ?? "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return "";
  const limit = lines.findIndex((line, index) => index > 0 && ["---", "..."].includes(line.trim()));
  const yaml = (limit < 0 ? lines.slice(1) : lines.slice(1, limit)).join("\n");
  const match = /^\s*type\s*:\s*(.*?)\s*$/im.exec(yaml);
  return match ? match[1] : "";
}

function albumHeaderIsAlbumSource(source) {
  const type = albumHeaderSourceType(source);
  return Boolean(type) && albumTypeNames(type).includes("album");
}

function albumHeaderFileTypeIsAlbum(path, metadataCache, vault) {
  try {
    const file = typeof notebookResolveLinkFile === "function"
      ? notebookResolveLinkFile(path, path, metadataCache, vault)
      : null;
    const cache = file && metadataCache?.getFileCache?.(file);
    const frontmatter = cache?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "type")) {
      return albumTypeNames(frontmatter.type).includes("album");
    }
  } catch (_) {}
  return true;
}

function albumHeaderResolveFile(target, sourcePath, metadataCache, vault) {
  try {
    if (typeof pomodoroHomeResolveFile === "function") {
      return pomodoroHomeResolveFile(target, sourcePath, sourcePath, metadataCache, vault);
    }
    return notebookResolveLinkFile(target, sourcePath, metadataCache, vault);
  } catch (_) {
    return null;
  }
}

function albumHeaderOwnerChain(entry, options = {}) {
  const metadataCache = options.metadataCache || null;
  const vault = options.vault || null;
  const sourcePath = albumHeaderPath(options.sourcePath || entry?.path);
  const parent = String(entry?.parent || "").trim();
  if (!parent) return { crumbs: [], broken: true, cyclic: false, truncated: false };

  let current = albumHeaderResolveFile(parent, sourcePath, metadataCache, vault);
  const chain = [];
  const seen = new Set();
  let broken = false;
  let cyclic = false;
  let truncated = false;
  if (!current) broken = true;
  for (let depth = 0; current && depth < ALBUM_HEADER_MAX_ANCESTORS; depth += 1) {
    const path = albumHeaderPath(current.path);
    const key = path.toLocaleLowerCase();
    if (!path || seen.has(key)) {
      cyclic = Boolean(path);
      broken = !path;
      break;
    }
    seen.add(key);
    const cache = metadataCache?.getFileCache?.(current) || null;
    const frontmatter = cache?.frontmatter || {};
    const kind = typeof pomodoroHomeType === "function" ? pomodoroHomeType(frontmatter) : "other";
    // A resolved type-definition or other non-home note ends the owned
    // tree naturally (top-level areas conventionally parent [[area]]).
    if (kind !== "area" && kind !== "project") break;
    const stem = path.split("/").pop().replace(/\.md$/i, "");
    chain.push({
      stem,
      path,
      title: typeof notebookHeaderNoteTitle === "function"
        ? notebookHeaderNoteTitle(path, metadataCache, vault)
        : stem,
      kind,
    });
    const rawParent = frontmatter.parent;
    const next = typeof pomodoroHomeParentTarget === "function"
      ? pomodoroHomeParentTarget(rawParent)
      : albumNormalizeParent(rawParent);
    if (!next) {
      if (rawParent != null && String(rawParent).trim()) broken = true;
      break;
    }
    const resolved = albumHeaderResolveFile(next, path, metadataCache, vault);
    if (!resolved) {
      broken = true;
      break;
    }
    current = resolved;
    if (depth === ALBUM_HEADER_MAX_ANCESTORS - 1) truncated = true;
  }
  chain.reverse();
  return { crumbs: chain, broken, cyclic, truncated };
}

function albumHeaderRouteReason(entry) {
  const errors = (Array.isArray(entry?.issues) ? entry.issues : [])
    .filter((issue) => issue && issue.severity === "error");
  if (errors.length) return String(errors[0].message || "The album schema is invalid.");
  const stem = String(entry?.stem || "");
  const path = albumHeaderPath(entry?.path);
  if (!/^[a-z][a-z0-9_]*$/.test(stem) || path !== `${stem}.md`) {
    return "This album does not have a valid capture route.";
  }
  const noun = String(entry?.noun || "");
  if (!/^[a-z][a-z0-9_]*$/.test(noun) || noun === "album" || noun === "record") {
    return "This album has no valid record noun.";
  }
  return "";
}

function albumHeaderHumanize(value) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim();
  if (!text) return "";
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function albumHeaderOptionalCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function albumHeaderOptionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function albumHeaderChoiceModel(choice) {
  if (!choice || typeof choice !== "object") {
    const label = String(choice || "");
    return { value: "", label, count: null };
  }
  return {
    value: String(choice.value || ""),
    label: String(choice.label ?? choice.value ?? ""),
    count: albumHeaderOptionalCount(choice.count),
  };
}

function albumHeaderFieldModel(field) {
  const hasDefault = Boolean(field && Object.prototype.hasOwnProperty.call(field, "default"));
  return {
    key: String(field?.key || ""),
    label: String(field?.label || field?.key || ""),
    kind: String(field?.kind || ""),
    list: field?.list === true,
    required: field?.required === true,
    suggest: field?.suggest === true,
    // Preserve presence independently from the typed value. In particular,
    // false, zero, an empty string, and an empty list are all real defaults.
    defaultPresent: hasDefault,
    default: hasDefault ? field.default : undefined,
    min: albumHeaderOptionalNumber(field?.min),
    max: albumHeaderOptionalNumber(field?.max),
    line: albumHeaderOptionalCount(field?.line),
    filled: albumHeaderOptionalCount(field?.filled),
    choices: (Array.isArray(field?.choices) ? field.choices : []).map(albumHeaderChoiceModel),
  };
}

function albumHeaderIssueModel(issue) {
  return {
    severity: String(issue?.severity || "info"),
    code: String(issue?.code || ""),
    message: String(issue?.message || ""),
    line: albumHeaderOptionalCount(issue?.line),
    keyPath: issue?.key_path == null ? "" : String(issue.key_path),
    suggestions: (Array.isArray(issue?.suggestions) ? issue.suggestions : [])
      .map((item) => String(item || "")).filter(Boolean),
  };
}

function albumHeaderSchemaLabel(entry) {
  const label = String(entry?.label || "").trim();
  if (label) return label;
  const noun = albumHeaderHumanize(entry?.noun);
  if (noun) return noun;
  return albumHeaderHumanize(entry?.stem) || "Album";
}

function albumHeaderFieldLabel(fields, key) {
  const match = (fields || []).find((field) => field.key === key);
  return match?.label || albumHeaderHumanize(key) || key;
}

function albumHeaderGroupingClause(entry, fields) {
  const indexBy = String(entry?.index_by || "").trim();
  if (!indexBy) return "";
  const parts = [`grouped by ${albumHeaderFieldLabel(fields, indexBy)}`];
  const facets = (Array.isArray(entry?.index_facets) ? entry.index_facets : [])
    .map((item) => String(item || "").trim())
    .filter((key) => key && key !== indexBy);
  if (facets.length) {
    parts.push(`sub-grouped by ${facets.map((key) => albumHeaderFieldLabel(fields, key)).join(", ")}`);
  }
  return parts.join(", ");
}

function albumHeaderModel(report, sourcePath, options = {}) {
  const entry = albumHeaderEntry(report, sourcePath);
  if (!entry) return null;
  if (options.sourceText !== undefined && !albumHeaderIsAlbumSource(options.sourceText)) return null;
  if (options.sourceText === undefined && !albumHeaderFileTypeIsAlbum(
    sourcePath,
    options.metadataCache,
    options.vault,
  )) return null;

  const ancestry = albumHeaderOwnerChain(entry, { ...options, sourcePath });
  const fields = Array.isArray(entry.fields) ? entry.fields.map(albumHeaderFieldModel) : [];
  const issues = (Array.isArray(entry.issues) ? entry.issues : []).map(albumHeaderIssueModel);
  const schemaInvalid = issues.some((issue) => issue.severity === "error");
  const routeReason = albumHeaderRouteReason(entry);
  const crumbs = ancestry.crumbs.concat([{
    stem: String(entry.stem || ""),
    path: albumHeaderPath(entry.path),
    title: String(entry.title || entry.stem || ""),
    kind: "album",
    current: true,
  }]);
  const indexBy = String(entry.index_by || "").trim();
  const indexFacets = (Array.isArray(entry.index_facets) ? entry.index_facets : [])
    .map((item) => String(item || "").trim()).filter(Boolean);
  return {
    path: albumHeaderPath(entry.path),
    stem: String(entry.stem || ""),
    title: String(entry.title || entry.stem || ""),
    emoji: entry.emoji == null ? "" : String(entry.emoji),
    noun: entry.noun == null ? null : String(entry.noun),
    singular: entry.singular == null ? null : String(entry.singular),
    plural: entry.plural == null ? null : String(entry.plural),
    storedLabel: entry.label == null ? null : String(entry.label),
    storedPlural: entry.plural == null ? null : String(entry.plural),
    schemaFingerprint: entry.schema_fingerprint == null ? "" : String(entry.schema_fingerprint),
    schemaLabel: albumHeaderSchemaLabel(entry),
    datedNotes: entry.dated_notes === true,
    legacy: (Array.isArray(entry.legacy) ? entry.legacy : [])
      .map((item) => String(item || "")).filter(Boolean),
    records: albumHeaderOptionalCount(entry.records) ?? 0,
    indexBy,
    indexFacets,
    groupingClause: albumHeaderGroupingClause(entry, fields),
    crumbs,
    broken: ancestry.broken,
    cyclic: ancestry.cyclic,
    truncated: ancestry.truncated,
    ancestryMessage: ancestry.broken || ancestry.cyclic || ancestry.truncated
      ? "Some owner ancestry could not be resolved; only confirmed notes are linked."
      : "",
    fields,
    emptySchema: fields.length === 0,
    schemaInvalid,
    issues,
    routeReason,
    captureText: routeReason ? "" : `Name @${entry.stem}/`,
    captureLabel: routeReason ? "" : String(entry.noun),
  };
}

function albumHeaderSignature(model, extra = {}) {
  if (!model) return "none";
  return JSON.stringify({
    path: model.path,
    title: model.title,
    schemaFingerprint: model.schemaFingerprint,
    singular: model.singular,
    storedLabel: model.storedLabel,
    storedPlural: model.storedPlural,
    crumbs: model.crumbs,
    fields: model.fields,
    issues: model.issues,
    captureText: model.captureText,
    routeReason: model.routeReason,
    ancestryMessage: model.ancestryMessage,
    datedNotes: model.datedNotes,
    groupingClause: model.groupingClause,
    legacy: model.legacy,
    records: model.records,
    schemaInvalid: model.schemaInvalid,
    expanded: extra.expanded === true,
    desktop: extra.desktop !== false,
  });
}
