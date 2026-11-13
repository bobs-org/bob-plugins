// Dual-format SUBOPEN reader for project children (docs/task-dependencies.md
// §12.10). Mirrors bob-cli `projects/catalog_rows.rs` plus the legacy
// `🧩 **Sub-projects:**` marker fallback. A damaged `[!projects` opener
// counts as open (fail-safe); Rust treats damage as unplannable.

const PROJECT_SUBPROJECTS_MARKER = "🧩 **Sub-projects:**";
const PROJECT_WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const PROJECT_CATALOG_CALLOUT = "projects";
const PROJECT_CATALOG_SCHEDULED_GLYPH = "🗓️";
const PROJECT_CATALOG_BLOCKED_GLYPH = "⛓️";
const PROJECT_CATALOG_WARNING_GLYPH = "⚠️";
const PROJECT_CATALOG_DONE_GLYPH = "✅";
const PROJECT_CATALOG_CANCELED_GLYPH = "❌";
const PROJECT_CATALOG_CLOSED_GROUP_LABEL = "**Closed**";
const PROJECT_CATALOG_ROW_SEPARATOR = " — ";

function projectCatalogBodyFirst(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 0;
  }
  const first = String(lines[0] || "").replace(/^\uFEFF/, "");
  if (first !== "---") {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (String(lines[index] || "") === "---") {
      return index + 1;
    }
  }
  return 0;
}

function projectCatalogFencedFlags(lines, bodyFirst) {
  const fenced = new Array(lines.length).fill(false);
  let opening = null;
  for (let index = bodyFirst; index < lines.length; index += 1) {
    const text = String(lines[index] || "");
    if (!opening) {
      const match = text.match(CODE_FENCE_OPEN_RE);
      if (match) {
        opening = { marker: match[1][0], length: match[1].length };
        fenced[index] = true;
      }
      continue;
    }
    fenced[index] = true;
    const close = text.match(CODE_FENCE_CLOSE_RE);
    if (
      close &&
      close[1][0] === opening.marker &&
      close[1].length >= opening.length
    ) {
      opening = null;
    }
  }
  return fenced;
}

function projectCatalogLeadingSpaces(content) {
  const text = String(content || "");
  let indent = 0;
  while (indent < text.length && text[indent] === " ") {
    indent += 1;
  }
  return indent;
}

function projectCatalogIsQuoteLine(content) {
  const text = String(content || "");
  const indent = projectCatalogLeadingSpaces(text);
  if (indent > 3) {
    return false;
  }
  return text.startsWith(">", indent);
}

function projectCatalogIsCalloutHead(content, callout) {
  const text = String(content || "");
  const indent = projectCatalogLeadingSpaces(text);
  if (indent > 3) {
    return false;
  }
  if (!text.startsWith(">", indent)) {
    return false;
  }
  const afterGt = text.slice(indent + 1).replace(/^[ \t]+/, "");
  if (!afterGt.startsWith("[")) {
    return false;
  }
  const close = afterGt.indexOf("]");
  if (close === -1) {
    return false;
  }
  const inner = afterGt.slice(1, close).trim();
  if (!inner.startsWith("!")) {
    return false;
  }
  if (inner.slice(1).toLowerCase() !== String(callout || "").toLowerCase()) {
    return false;
  }
  let tail = afterGt.slice(close + 1).replace(/^[ \t]+/, "");
  if (tail.startsWith("-") || tail.startsWith("+")) {
    tail = tail.slice(1);
  }
  return !tail.replace(/^[ \t]+/, "").startsWith("|");
}

function projectCatalogIsMalformedHead(content, callout) {
  if (projectCatalogIsCalloutHead(content, callout)) {
    return false;
  }
  const text = String(content || "");
  const indent = projectCatalogLeadingSpaces(text);
  if (indent > 3) {
    return false;
  }
  if (!text.startsWith(">", indent)) {
    return false;
  }
  const afterGt = text.slice(indent + 1).replace(/^[ \t]+/, "");
  if (!afterGt.startsWith("[!")) {
    return false;
  }
  const rest = afterGt.slice(2);
  let length = 0;
  while (
    length < rest.length &&
    /[A-Za-z0-9_-]/.test(rest.charAt(length))
  ) {
    length += 1;
  }
  return rest.slice(0, length).toLowerCase() === String(callout || "").toLowerCase();
}

function projectCatalogOwnedRegions(lines) {
  const source = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const bodyFirst = projectCatalogBodyFirst(source);
  const fenced = projectCatalogFencedFlags(source, bodyFirst);
  const real = (index) => index >= bodyFirst && !fenced[index];
  for (let index = bodyFirst; index < source.length; index += 1) {
    if (
      real(index) &&
      projectCatalogIsMalformedHead(source[index], PROJECT_CATALOG_CALLOUT)
    ) {
      return { damaged: true, line: index + 1, regions: [] };
    }
  }
  const regions = [];
  let index = bodyFirst;
  while (index < source.length) {
    if (
      !real(index) ||
      !projectCatalogIsCalloutHead(source[index], PROJECT_CATALOG_CALLOUT)
    ) {
      index += 1;
      continue;
    }
    let end = index;
    let next = index + 1;
    while (
      next < source.length &&
      real(next) &&
      projectCatalogIsQuoteLine(source[next])
    ) {
      end = next;
      next += 1;
    }
    regions.push({ start: index, end });
    index = end + 1;
  }
  return { damaged: false, line: null, regions };
}

function projectCatalogListItemContent(content) {
  const trimmed = String(content || "").replace(/^[ \t]+/, "");
  if (!trimmed) {
    return null;
  }
  const first = trimmed.charCodeAt(0);
  if (
    (first === 45 || first === 43 || first === 42) &&
    /[ \t]/.test(trimmed.charAt(1) || "")
  ) {
    return trimmed.slice(2).replace(/^[ \t]+/, "");
  }
  let digits = 0;
  while (digits < trimmed.length && /[0-9]/.test(trimmed.charAt(digits))) {
    digits += 1;
  }
  if (
    digits > 0 &&
    (trimmed.charAt(digits) === "." || trimmed.charAt(digits) === ")") &&
    /[ \t]/.test(trimmed.charAt(digits + 1) || "")
  ) {
    return trimmed.slice(digits + 2).replace(/^[ \t]+/, "");
  }
  return null;
}

function projectCatalogGlyphPrefixLen(text, glyph) {
  const source = String(text || "");
  const mark = String(glyph || "");
  if (source.startsWith(mark)) {
    return mark.length;
  }
  if (mark.endsWith("\uFE0F")) {
    const base = mark.slice(0, -1);
    if (source.startsWith(base)) {
      return base.length;
    }
  }
  return 0;
}

function projectCatalogRowState(beforeLink) {
  const prefix = String(beforeLink || "");
  const glyphs = [
    [PROJECT_CATALOG_SCHEDULED_GLYPH, "scheduled"],
    [PROJECT_CATALOG_BLOCKED_GLYPH, "blocked"],
    [PROJECT_CATALOG_WARNING_GLYPH, "warning"],
    [PROJECT_CATALOG_DONE_GLYPH, "done"],
    [PROJECT_CATALOG_CANCELED_GLYPH, "canceled"],
  ];
  for (const [glyph, state] of glyphs) {
    if (projectCatalogGlyphPrefixLen(prefix, glyph) > 0) {
      return state;
    }
  }
  return "open";
}

function projectCatalogStateIsOpen(state) {
  return state !== "done" && state !== "canceled";
}

function projectCatalogParseRow(line, lineNumber) {
  const text = String(line || "");
  const indent = projectCatalogLeadingSpaces(text);
  if (indent > 3 || !text.startsWith(">", indent)) {
    return null;
  }
  const afterQuote = text.slice(indent + 1).replace(/^[ \t]+/, "");
  const item = projectCatalogListItemContent(afterQuote);
  if (item == null) {
    return null;
  }
  const linkStart = item.indexOf("[[");
  if (linkStart === -1) {
    return null;
  }
  const closeRel = item.indexOf("]]", linkStart + 2);
  if (closeRel === -1) {
    return null;
  }
  const rawInner = item.slice(linkStart + 2, closeRel);
  if (rawInner.includes("[[")) {
    return null;
  }
  const pipe = rawInner.indexOf("|");
  const rawTarget = (pipe === -1 ? rawInner : rawInner.slice(0, pipe)).trim();
  const hash = rawTarget.indexOf("#");
  const keyTarget = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim();
  const slash = keyTarget.lastIndexOf("/");
  const key = (slash === -1 ? keyTarget : keyTarget.slice(slash + 1))
    .trim()
    .toLowerCase();
  if (!key) {
    return null;
  }
  const state = projectCatalogRowState(item.slice(0, linkStart).replace(/^[ \t]+/, ""));
  return {
    key,
    linkTarget: rawTarget,
    state,
    open: projectCatalogStateIsOpen(state),
    line: lineNumber,
  };
}

function projectChildCache(lines) {
  const source = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const owned = projectCatalogOwnedRegions(source);
  if (owned.damaged) {
    return {
      source: "damaged",
      rows: [],
      open: 1,
      damageLine: owned.line,
    };
  }
  if (owned.regions.length === 0) {
    return { source: "absent", rows: [], open: 0, damageLine: null };
  }
  const rows = [];
  for (const region of owned.regions) {
    for (let index = region.start; index <= region.end; index += 1) {
      const row = projectCatalogParseRow(source[index], index + 1);
      if (row) {
        rows.push(row);
      }
    }
  }
  return {
    source: "catalog",
    rows,
    open: rows.filter((row) => row.open).length,
    damageLine: null,
  };
}

function projectCatalogClosedChildSets(options) {
  const closedChildPaths = options && options.closedChildPaths instanceof Set
    ? options.closedChildPaths
    : new Set(Array.from((options && options.closedChildPaths) || [], String));
  const stems = new Set();
  for (const path of closedChildPaths) {
    const base = String(path || "").replace(/\\/g, "/").split("/").pop() || "";
    const stem = base.replace(/\.md$/i, "").trim().toLowerCase();
    if (stem) {
      stems.add(stem);
    }
  }
  return { paths: closedChildPaths, stems };
}

function projectCatalogRowIsClosedChild(row, options) {
  if (!row) {
    return false;
  }
  const { paths, stems } = projectCatalogClosedChildSets(options || {});
  if (stems.has(row.key)) {
    return true;
  }
  const linkedPath = resolveProjectParentPath(
    row.linkTarget,
    options && options.path,
    options && options.notePaths,
  );
  return Boolean(linkedPath && paths.has(linkedPath));
}

function projectLegacyWikilinkIsClosed(text, match, options) {
  const target = String(match[1] || "").split("|")[0].split("#")[0].trim();
  if (!target) {
    return true;
  }
  const { paths, stems } = projectCatalogClosedChildSets(options || {});
  const key = target.replace(/\\/g, "/").split("/").pop().replace(/\.md$/i, "")
    .trim()
    .toLowerCase();
  if (key && stems.has(key)) {
    return true;
  }
  const linkedPath = resolveProjectParentPath(
    target,
    options && options.path,
    options && options.notePaths,
  );
  return Boolean(linkedPath && paths.has(linkedPath));
}

function projectLegacyWikilinkIsStruckClosed(text, match) {
  const start = match.index;
  const end = start + match[0].length;
  const before = String(text).slice(0, start).trimEnd();
  const after = String(text).slice(end).trimStart();
  if (!before.endsWith("~~") || !after.startsWith("~~")) {
    return false;
  }
  const marker = after.slice(2).trimStart();
  return marker.startsWith("✅") || marker.startsWith("❌");
}

function projectLegacyOpenChildCount(lines, prjLine, options = {}) {
  const source = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const parent = Number.isInteger(prjLine) ? prjLine : -1;
  if (parent < 0 || parent >= source.length) {
    return 0;
  }
  const fenced = getFencedLineNumbers(source);
  const prjIndent = getLineIndentation(String(source[parent] || "")).length;
  const seen = new Set();
  let open = 0;
  for (let line = parent + 1; line < source.length; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const text = String(source[line] || "");
    if (!text.trim()) {
      break;
    }
    const indent = getLineIndentation(text).length;
    if (indent <= prjIndent && parseListItemPrefix(text)) {
      break;
    }
    const prefix = parseListItemPrefix(text);
    if (!prefix) {
      continue;
    }
    const content = text.replace(/^([ \t]*)([-*+]|\d+[.)])[ \t]+/, "").trimStart();
    if (!content.startsWith(PROJECT_SUBPROJECTS_MARKER)) {
      continue;
    }
    PROJECT_WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = PROJECT_WIKILINK_RE.exec(text)) !== null) {
      const target = String(match[1] || "").split("|")[0].split("#")[0].trim();
      if (!target || seen.has(target)) {
        continue;
      }
      seen.add(target);
      if (projectLegacyWikilinkIsClosed(text, match, options)) {
        continue;
      }
      if (projectLegacyWikilinkIsStruckClosed(text, match)) {
        continue;
      }
      open += 1;
    }
    return open;
  }
  return 0;
}

function projectOpenChildCount(lines, prjLine, options = {}) {
  const cache = projectChildCache(lines);
  if (cache.source === "damaged") {
    return 1;
  }
  if (cache.source === "catalog") {
    return cache.rows.filter((row) =>
      row.open && !projectCatalogRowIsClosedChild(row, options)
    ).length;
  }
  return projectLegacyOpenChildCount(lines, prjLine, options);
}

function projectHasOpenChild(lines, prjLine, options = {}) {
  return projectOpenChildCount(lines, prjLine, options) > 0;
}

function projectMarkerHasOpenChild(lines, prjLine, options = {}) {
  return projectHasOpenChild(lines, prjLine, options);
}
