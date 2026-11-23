// Property editor row fidelity (bob-cli-pf.4.1.7 row-fidelity).
// Nearest-row identity across reconciliation, overlay post-images for every
// surface, hook-aware drawer digests, verbatim recovery diagnostics, and
// datetime/tag/null/add-flow value fidelity. Pure helpers stay DOM-free;
// prototype patches follow the 298i/298l pattern.
function propertyEditorSelectionOf(rows, id) {
  const list = Array.isArray(rows) ? rows : [];
  let ordinal = 0;
  const seen = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index];
    if (!row || typeof row.key !== "string") continue;
    const count = seen.get(row.key) || 0;
    seen.set(row.key, count + 1);
    if (propertyEditorRowId(row, index) === id) {
      return {
        key: row.key,
        ordinal: count,
        line: Number.isInteger(row.line) ? row.line : null,
      };
    }
    void ordinal;
  }
  return null;
}

function propertyEditorNormalizeSelection(value) {
  if (!value || typeof value !== "object") return null;
  const key = typeof value.key === "string" ? value.key : "";
  const ordinal = Number.isInteger(value.ordinal) && value.ordinal >= 0 ? value.ordinal : 0;
  const line = Number.isInteger(value.line) && value.line > 0 ? value.line : null;
  if (!key && line === null) return null;
  return { key, ordinal, line };
}

function propertyEditorYamlReopenSelection(rows, wanted) {
  const target = propertyEditorNormalizeSelection(wanted) || { key: "", ordinal: 0, line: null };
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return target.key || target.line !== null ? target : null;
  const nearest = propertyEditorNearestId(list, target);
  if (!nearest) return target.key ? target : null;
  const found = propertyEditorSelectionOf(list, nearest);
  return found || target;
}

function propertyEditorNearestId(rows, wanted) {
  const list = Array.isArray(rows) ? rows : [];
  const entries = [];
  list.forEach((row, index) => {
    if (!row || typeof row.key !== "string") return;
    entries.push({ row, index, id: propertyEditorRowId(row, index) });
  });
  if (!entries.length) return "";
  const key = wanted && typeof wanted.key === "string" ? wanted.key : "";
  if (!key) return entries[0].id;
  const sameKey = entries.filter((entry) => entry.row.key === key);
  if (sameKey.length) {
    const ordinal = wanted && Number.isInteger(wanted.ordinal) ? wanted.ordinal : 0;
    if (ordinal >= 0 && ordinal < sameKey.length) return sameKey[ordinal].id;
    const line = wanted && Number.isInteger(wanted.line) ? wanted.line : null;
    if (line !== null) {
      let best = sameKey[0];
      let bestDistance = best.row && Number.isInteger(best.row.line)
        ? Math.abs(best.row.line - line)
        : Number.MAX_SAFE_INTEGER;
      for (const entry of sameKey.slice(1)) {
        const distance = entry.row && Number.isInteger(entry.row.line)
          ? Math.abs(entry.row.line - line)
          : Number.MAX_SAFE_INTEGER;
        if (distance < bestDistance) {
          best = entry;
          bestDistance = distance;
        }
      }
      return best.id;
    }
    return sameKey[0].id;
  }
  const line = wanted && Number.isInteger(wanted.line) ? wanted.line : null;
  if (line !== null) {
    let best = entries[0];
    let bestDistance = best.row && Number.isInteger(best.row.line)
      ? Math.abs(best.row.line - line)
      : Number.MAX_SAFE_INTEGER;
    for (const entry of entries.slice(1)) {
      const distance = entry.row && Number.isInteger(entry.row.line)
        ? Math.abs(entry.row.line - line)
        : Number.MAX_SAFE_INTEGER;
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    return best.id;
  }
  return entries[0].id;
}

function propertyEditorWantedSelection(modal) {
  try {
    const rows = modal && Array.isArray(modal.properties) ? modal.properties : [];
    const found = propertyEditorSelectionOf(rows, modal && modal.selectedId);
    // Cache-first rows have no source line and collapse duplicates, so they
    // cannot override a stored duplicate ordinal or source position.
    if (found && Number.isInteger(found.line)) return found;
  } catch (_) {}
  const stored = propertyEditorNormalizeSelection(modal && modal.requestedSelection);
  if (stored && stored.key) return stored;
  try {
    const cache = modal && Array.isArray(modal.cacheRows) ? modal.cacheRows : [];
    const found = propertyEditorSelectionOf(cache, modal && modal.selectedId);
    if (found) return found;
  } catch (_) {}
  // Opening with a key before cache or report rows exist must keep that key.
  const requested = modal && typeof modal.requestedKey === "string" ? modal.requestedKey : "";
  if (requested) return { key: requested, ordinal: 0, line: null };
  return { key: "", ordinal: 0, line: null };
}

// Recovery diagnostics arrive on three channels: frontmatter.error carries
// the parse message and 1-based source line, duplicate rows carry their own
// source lines, and ownership_diagnostics explains unresolved ownership.
// The YAML target prefers the parse-error line, then the first duplicate
// row's line, then the earliest surviving row line.
function propertyEditorRecoveryDetails(report) {
  if (!report || typeof report !== "object") return null;
  const state = propertyEditorFrontmatterState(report);
  if (state !== "invalid" && state !== "unclosed" && state !== "duplicate") return null;
  const frontmatter = report.frontmatter && typeof report.frontmatter === "object" ? report.frontmatter : {};
  const error = frontmatter.error && typeof frontmatter.error === "object" ? frontmatter.error : {};
  const message = typeof error.message === "string" && error.message ? error.message : "";
  const errorLine = Number.isInteger(error.line) && error.line > 0 ? error.line : null;
  const rows = Array.isArray(report.properties) ? report.properties : [];
  let duplicateLine = null;
  let earliestLine = null;
  const diagnostics = [];
  for (const row of rows) {
    if (!row) continue;
    if (Number.isInteger(row.line) && row.line > 0) {
      if (earliestLine === null || row.line < earliestLine) earliestLine = row.line;
      if (row.duplicate === true && duplicateLine === null) duplicateLine = row.line;
    }
    if (typeof row.diagnostic === "string" && row.diagnostic) {
      diagnostics.push({ key: typeof row.key === "string" ? row.key : "", line: row.line ?? null, diagnostic: row.diagnostic });
    }
  }
  const ownership = Array.isArray(report.ownership_diagnostics)
    ? report.ownership_diagnostics.filter((entry) => typeof entry === "string" && entry)
    : [];
  let line = errorLine;
  if (line === null && state === "duplicate" && duplicateLine !== null) line = duplicateLine;
  if (line === null) line = earliestLine;
  if (line === null && Number.isInteger(frontmatter.start_line) && frontmatter.start_line > 0) line = frontmatter.start_line;
  return { state, line, message, diagnostics, ownership };
}

function propertyEditorRowDiagnostics(report) {
  const details = propertyEditorRecoveryDetails(report);
  if (!details) return [];
  return details.diagnostics;
}

// Overlay post-image for one surface paint: confirmed values replace the
// cached ones by key (first occurrence wins for duplicates) while rows keep
// their inventory metadata; deleted keys leave the paint. Null stays null:
// only absence removes a row.
function propertyEditorOverlayRows(rows, overlay) {
  const list = Array.isArray(rows) ? rows : [];
  if (!overlay || typeof overlay !== "object") return list;
  const replacements = new Map();
  for (const row of Array.isArray(overlay.properties) ? overlay.properties : []) {
    if (!row || typeof row.key !== "string" || !row.key) continue;
    if (!replacements.has(row.key)) replacements.set(row.key, row.value);
  }
  const deleted = new Set(
    (Array.isArray(overlay.deletedKeys) ? overlay.deletedKeys : []).filter((key) => typeof key === "string" && key),
  );
  if (!replacements.size && !deleted.size) return list;
  const seen = new Set();
  const next = [];
  for (const row of list) {
    if (!row || typeof row.key !== "string") continue;
    if (deleted.has(row.key)) continue;
    if (replacements.has(row.key) && !seen.has(row.key)) {
      seen.add(row.key);
      next.push({ ...row, value: replacements.get(row.key) });
      continue;
    }
    if (replacements.has(row.key)) {
      seen.add(row.key);
      continue;
    }
    next.push(row);
  }
  return next;
}

function propertyEditorOverlayFor(plugin, path) {
  try {
    if (plugin && typeof plugin.propertyOverlayFor === "function") return plugin.propertyOverlayFor(path);
  } catch (_) {}
  return null;
}

// Datetime fidelity: an existing value without an offset (empty-style) and
// a brand-new datetime both send local wall time with no offset, unless the
// user typed an explicit offset whose instant is then retained. Seconds
// follow the existing value's precision.
function propertyEditorExistingDateTimeInfo(value, style) {
  const text = typeof value === "string" ? value : "";
  let offset = null;
  if (style && typeof style === "object" && style.datetime_offset !== undefined && style.datetime_offset !== null) {
    offset = String(style.datetime_offset);
  } else if (text) {
    const match = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(text.trim());
    if (match) offset = match[1] || "";
  }
  let seconds = null;
  if (text) {
    const timeMatch = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)/.exec(text.trim());
    if (timeMatch) seconds = timeMatch[1].split(":").length >= 3;
  }
  return { hasOffset: offset === null ? null : offset !== "", offset: offset || "", hasSeconds: seconds };
}

function propertyEditorDateTimeHasSeconds(raw) {
  const match = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?/.exec(String(raw || "").trim());
  if (!match) return null;
  return match[0].split(":").length >= 3;
}

function propertyEditorFormatDateTimeParts(parts, options = {}) {
  const date = propertyEditorFormatDate(parts);
  const wantSeconds = options.seconds !== false;
  const time = wantSeconds
    ? propertyEditorFormatTime(parts)
    : `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  const offset = typeof options.offset === "string" ? options.offset : "";
  return `${date}T${time}${offset}`;
}

// Exact typed names win over a highlighted substring match on Enter/Tab
// unless the user explicitly moved the highlight after typing.
function propertyEditorAcceptAddNameExactFirst(typed, catalog, options = {}) {
  const name = propertyEditorNormalizePropertyName(typed);
  const filtered = propertyEditorFilterPropertyNames(catalog, propertyEditorNormalizePropertyName(typed));
  if (options.literal === true) {
    return { ok: true, name, wireKind: "text", type: "text", fromCompletion: false, authoritative: false };
  }
  const exact = name ? filtered.find((row) => row && row.name === name) : null;
  if (exact && options.suggestionTouched !== true) {
    const authoritative = exact.authoritative === true;
    return {
      ok: true,
      name: exact.name,
      wireKind: authoritative ? exact.wireKind : "text",
      type: authoritative ? exact.type : "text",
      fromCompletion: true,
      authoritative,
    };
  }
  return propertyEditorAcceptAddName(typed, catalog, options);
}

const PROPERTY_EDITOR_FINISH_EDIT_FIRST = "Finish the open edit first \u2014 = is reserved while drafting.";
