// Pure notebook catalog presentation: chips, source regions, hue, and
// link matching. Bob remains the authority for rows and their order;
// this fragment never writes note bytes.

const NOTEBOOK_CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NOTEBOOK_CATALOG_BEGIN_RE = /<!--\s*bob:notebooks:begin(?:\s+\S+)?\s*-->/;
const NOTEBOOK_CATALOG_END_RE = /<!--\s*bob:notebooks:end\s*-->/;
const NOTEBOOK_CALLOUT_HEAD_RE = /^>\s*\[!notebooks\]\s*[-+]?(?:\s+.*)?$/i;
const NOTEBOOKS_H2_RE = /^##\s+Notebooks(?:\s.*)?$/i;
const NOTEBOOK_H1_RE = /^#\s+\S/;
const NOTEBOOK_FENCE_RE = /^(`{3,}|~{3,})/;
const NOTEBOOK_PROJECT_GROUP_RE = /^\s*\u{1F9E9}/u;
const NOTEBOOK_WIKILINK_RE = /\[\[([^\]\n]+)\]\]/;
const NOTEBOOK_EM_DASH = " \u2014 ";

function notebookCalendarDate(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!NOTEBOOK_CALENDAR_DATE_RE.test(text)) {
    return "";
  }
  const match = NOTEBOOK_CALENDAR_DATE_RE.exec(text);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }
  return text;
}

function notebookAgeChip(lastNote, today) {
  const last = notebookCalendarDate(lastNote);
  const now = notebookCalendarDate(today);
  if (!last || !now) {
    return null;
  }
  let days;
  try {
    days = freshDateDiffDays(last, now);
  } catch (error) {
    return null;
  }
  if (!Number.isInteger(days) || days < 0) {
    return null;
  }
  return days === 0 ? "today" : `${days}d`;
}

function notebookCountChip(notebook) {
  if (!notebook || !Number.isInteger(notebook.notes)) {
    return null;
  }
  if (!Array.isArray(notebook.sections)) {
    return `${notebook.notes} notes`;
  }
  return `${notebook.notes} notes \u00b7 ${notebook.sections.length} \u00a7`;
}

function notebookSummaryIsBlank(summary) {
  if (summary === null || summary === undefined) {
    return true;
  }
  return String(summary).trim() === "";
}

function notebookWikilinkTarget(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  const inner = text.startsWith("[[") && text.endsWith("]]")
    ? text.slice(2, -2)
    : text;
  const pathPart = inner.split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
  return pathPart.replace(/^\.\//, "");
}

function notebookLinkStem(target) {
  const path = notebookReportPath(target);
  const name = path.split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function notebookSourceFenceToggle(line, fence) {
  const match = NOTEBOOK_FENCE_RE.exec(String(line || "").trim());
  if (!match) {
    return fence;
  }
  const marker = match[1];
  if (!fence) {
    return marker[0];
  }
  if (marker[0] === fence) {
    return null;
  }
  return fence;
}

function notebookQuoteBody(line) {
  const text = String(line || "");
  if (!text.startsWith(">")) {
    return text;
  }
  return text.replace(/^>(?: )?/gm, "").replace(/^>\s?/, "");
}

function notebookSourceRowKind(line) {
  const body = notebookQuoteBody(line).replace(/^\s+/, "");
  if (!body.startsWith("- ")) {
    return "other";
  }
  const item = body.slice(2);
  if (NOTEBOOK_PROJECT_GROUP_RE.test(item)) {
    return "project-group";
  }
  if (NOTEBOOK_WIKILINK_RE.test(item)) {
    return "notebook-row";
  }
  return "other";
}

function notebookSourceRowTarget(line) {
  const match = NOTEBOOK_WIKILINK_RE.exec(String(line || ""));
  if (!match) {
    return "";
  }
  return notebookWikilinkTarget(match[1]);
}

function notebookIsCalloutHead(line) {
  const text = String(line || "");
  const indent = (text.match(/^ */) || [""])[0].length;
  if (indent > 3) {
    return false;
  }
  return NOTEBOOK_CALLOUT_HEAD_RE.test(text.trim());
}

function notebookIsQuoteLine(line) {
  const text = String(line || "");
  const indent = (text.match(/^ */) || [""])[0].length;
  if (indent > 3) {
    return false;
  }
  return text.trimStart().startsWith(">");
}

function notebookFrontmatterEnd(lines) {
  const first = lines.length > 0 ? String(lines[0]).replace(/^\uFEFF/, "") : "";
  if (first !== "---") {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (String(lines[index]) === "---") {
      return index + 1;
    }
  }
  return 0;
}

function notebookCatalogRegions(text) {
  const lines = String(text === null || text === undefined ? "" : text).split("\n");
  const regions = [];
  const bodyFirst = notebookFrontmatterEnd(lines);
  let fence = null;
  let open = null;
  const fenced = new Array(lines.length).fill(false);
  // First pass: fence map and legacy pairs.
  for (let index = bodyFirst; index < lines.length; index += 1) {
    const line = lines[index];
    const nextFence = notebookSourceFenceToggle(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      fenced[index] = true;
      continue;
    }
    if (fence) {
      fenced[index] = true;
    }
  }
  const isReal = (index) => index >= bodyFirst && !fenced[index];
  // Legacy pairs first.
  let legacyBegin = -1;
  let legacyEnd = -1;
  for (let index = bodyFirst; index < lines.length; index += 1) {
    if (!isReal(index)) {
      continue;
    }
    const line = lines[index];
    if (NOTEBOOK_CATALOG_BEGIN_RE.test(line)) {
      if (legacyBegin < 0) {
        legacyBegin = index;
      }
      continue;
    }
    if (NOTEBOOK_CATALOG_END_RE.test(line)) {
      if (legacyBegin >= 0 && legacyEnd < 0) {
        legacyEnd = index;
      }
      continue;
    }
  }
  let legacy = null;
  if (legacyBegin >= 0 && legacyEnd > legacyBegin) {
    legacy = {
      begin: legacyBegin,
      end: legacyEnd,
      calloutLine: -1,
      rows: [],
      legacy: true,
    };
    for (let index = legacyBegin + 1; index < legacyEnd; index += 1) {
      if (!isReal(index)) {
        continue;
      }
      if (legacy.calloutLine < 0 && notebookIsCalloutHead(lines[index])) {
        legacy.calloutLine = index;
        continue;
      }
      const kind = notebookSourceRowKind(lines[index]);
      if (kind === "notebook-row" || kind === "project-group") {
        legacy.rows.push({
          line: index,
          kind,
          target: notebookSourceRowTarget(lines[index]),
        });
      }
    }
    regions.push(legacy);
  }
  // Bare callout blocks outside the legacy pair.
  let index = bodyFirst;
  while (index < lines.length) {
    if (!isReal(index) || !notebookIsCalloutHead(lines[index])) {
      index += 1;
      continue;
    }
    if (legacy && index > legacy.begin && index < legacy.end) {
      index += 1;
      continue;
    }
    let end = index;
    let next = index + 1;
    while (next < lines.length && isReal(next) && notebookIsQuoteLine(lines[next])) {
      end = next;
      next += 1;
    }
    const region = {
      begin: index,
      end,
      calloutLine: index,
      rows: [],
      legacy: false,
    };
    for (let row = index + 1; row <= end; row += 1) {
      const kind = notebookSourceRowKind(lines[row]);
      if (kind === "notebook-row" || kind === "project-group") {
        region.rows.push({
          line: row,
          kind,
          target: notebookSourceRowTarget(lines[row]),
        });
      }
    }
    regions.push(region);
    index = end + 1;
  }
  regions.sort((a, b) => a.begin - b.begin);
  return regions;
}

function notebookFindHeadingLine(text, matcher) {
  const lines = String(text === null || text === undefined ? "" : text).split("\n");
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextFence = notebookSourceFenceToggle(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      continue;
    }
    if (fence) {
      continue;
    }
    if (matcher(line)) {
      return index;
    }
  }
  return -1;
}

function notebookFindNotebooksHeadingLine(text) {
  return notebookFindHeadingLine(text, (line) => NOTEBOOKS_H2_RE.test(line.trim()));
}

function notebookFindHostTitleLine(text) {
  return notebookFindHeadingLine(text, (line) => NOTEBOOK_H1_RE.test(line.trim()));
}

function notebookHostCatalog(state, sourcePath) {
  const report = state && state.report;
  if (!report || !(report.catalogsByHostPath instanceof Map)) {
    return null;
  }
  const path = notebookReportPath(sourcePath);
  if (!path) {
    return null;
  }
  return report.catalogsByHostPath.get(path)
    || report.catalogsByHostPath.get(path.replace(/\.md$/i, "") + ".md")
    || null;
}

function notebookSyncActionModel(catalog, options = {}) {
  const busy = options.busy === true;
  const state = catalog && typeof catalog.state === "string" ? catalog.state : "";
  const needed = state === "missing" || state === "stale" || state === "damaged";
  if (!needed && !busy) {
    return null;
  }
  const label = busy ? "\u21bb sync" : "\u21bb sync";
  let hint = "Run bob notebooks sync to refresh this catalog.";
  if (state === "damaged") {
    hint = "This catalog is damaged. Repair the old markers by hand, then sync.";
  } else if (state === "stale") {
    hint = "This catalog is stale. Sync to rewrite it from the notebook tree.";
  } else if (state === "missing") {
    hint = "This catalog is missing. Sync to write it.";
  }
  if (options.errorHint) {
    hint = String(options.errorHint);
  }
  return {
    kind: "sync",
    label,
    hint,
    busy,
    disabled: busy,
    state: state || "missing",
    missingWithoutHeading: options.missingWithoutHeading === true,
  };
}

function notebookRetryActionModel(state) {
  if (!state || typeof state !== "object") {
    return null;
  }
  const errorModel = state.errorModel || null;
  const unavailable = state.unavailable === true;
  const stale = state.stale === true && Boolean(state.report);
  const busy = state.refreshing === true;
  if (!unavailable && !stale && !errorModel) {
    return null;
  }
  if (unavailable || (errorModel && !state.report)) {
    return {
      kind: "retry",
      label: "Retry",
      hint: (errorModel && errorModel.hint)
        || "Notebook data is unavailable. Retry the list report.",
      code: (errorModel && errorModel.code) || "unavailable",
      busy,
      disabled: busy,
      state: "unavailable",
    };
  }
  // Stale-while-revalidate stays silent: a report that only lags a vault
  // change, with no recorded error, paints no Retry and no status.
  // A failed refresh (errorModel) with a report always offers Retry.
  if (errorModel && state.report) {
    return {
      kind: "retry",
      label: "Retry",
      hint: errorModel.hint
        || "Showing the last good notebook list. Retry to refresh.",
      code: errorModel.code || "stale",
      busy,
      disabled: busy,
      state: "stale",
    };
  }
  return null;
}

function notebookStatusModel(state) {
  if (!state || typeof state !== "object") {
    return null;
  }
  const retry = notebookRetryActionModel(state);
  const syncError = state.syncErrorModel || null;
  if (!retry && !syncError) {
    return null;
  }
  const hint = (retry && retry.hint)
    || (syncError && syncError.hint)
    || "Notebook data is unavailable.";
  const kind = retry
    ? retry.state
    : (syncError && syncError.code === "desktop-only" ? "unavailable" : "sync-error");
  return {
    kind,
    hint,
    retry,
    code: (retry && retry.code) || (syncError && syncError.code) || "",
  };
}

function notebookRowModel(notebook, today) {
  if (!notebook) {
    return {
      counts: null,
      age: null,
      addSummary: false,
      path: "",
      stem: "",
      title: "",
    };
  }
  return {
    counts: notebookCountChip(notebook),
    age: notebookAgeChip(notebook.last_note, today),
    addSummary: notebookSummaryIsBlank(notebook.summary),
    path: notebook.path || "",
    stem: notebook.stem || "",
    title: notebook.title || "",
  };
}

function notebookResolveLinkFile(target, sourcePath, metadataCache, vault) {
  const name = notebookWikilinkTarget(target);
  if (!name) {
    return null;
  }
  try {
    if (typeof pomodoroHomeResolveFile === "function") {
      const file = pomodoroHomeResolveFile(
        name,
        sourcePath,
        sourcePath,
        metadataCache,
        vault,
      );
      if (file && typeof file.path === "string" && file.path) {
        return file;
      }
    }
  } catch (error) {
    // Fall through to the path/stem guess.
  }
  const guessed = /\.md$/i.test(name) ? name : `${name}.md`;
  return { path: guessed };
}

function notebookLookupByTarget(report, target, sourcePath, metadataCache, vault) {
  if (!report) {
    return null;
  }
  const file = notebookResolveLinkFile(target, sourcePath, metadataCache, vault);
  const path = file && file.path ? notebookReportPath(file.path) : notebookReportPath(target);
  const stem = notebookLinkStem(path || target);
  if (report.notebooksByPath instanceof Map && path) {
    const byPath = report.notebooksByPath.get(path);
    if (byPath) {
      return byPath;
    }
  }
  if (report.notebooksByStem instanceof Map && stem) {
    const byStem = report.notebooksByStem.get(stem);
    if (byStem) {
      return byStem;
    }
  }
  return null;
}

function notebookHostHueName(path, metadataCache, vault) {
  try {
    if (typeof pomodoroHomeResolve !== "function") {
      return null;
    }
    const resolved = pomodoroHomeResolve(
      path,
      path,
      metadataCache,
      vault,
      [],
      new Set(),
    );
    const hue = resolved && resolved.hue;
    if (hue && Array.isArray(POMODORO_HOME_SLOT_ORDER) && POMODORO_HOME_SLOT_ORDER.includes(hue)) {
      return hue;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function notebookPropertyCommandIds() {
  return [
    "app:show-file-properties",
    "markdown:open-properties",
    "file-properties:open",
  ];
}
