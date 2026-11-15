// Pure presentation models for the display-only Areas card. Bob's report is
// authoritative for host membership, row order, nested depth, and hue.

function areasCardHost(state, sourcePath) {
  const report = state && state.report;
  if (!report || !(report.catalogsByHostPath instanceof Map)) return null;
  const path = areasReportPath(sourcePath);
  if (!path) return null;
  return report.catalogsByHostPath.get(path) || report.catalogsByHostPath.get(path.replace(/\.md$/i, "") + ".md") || null;
}

function areasCardHostEntry(state, sourcePath) {
  const report = state && state.report;
  if (!report || !(report.areasByPath instanceof Map)) return null;
  const path = areasReportPath(sourcePath);
  return report.areasByPath.get(path) || null;
}

function areasCardHueSlot(hue) {
  return AREAS_HUES.has(hue) ? hue : null;
}

function areasCardHostHue(state, sourcePath) {
  const catalog = areasCardHost(state, sourcePath);
  if (!catalog || catalog.kind === "root") return null;
  return areasCardHueSlot(areasCardHostEntry(state, sourcePath)?.hue);
}

function areasCardRowModel(entry, row = {}) {
  if (!entry || typeof entry.path !== "string") return null;
  const hue = areasCardHueSlot(entry.hue);
  return {
    path: areasReportPath(entry.path),
    stem: entry.stem || "",
    link: row.link || entry.link || entry.stem || "",
    depth: Number.isInteger(row.depth) && row.depth >= 0 ? row.depth : 0,
    summary: typeof entry.summary === "string" ? entry.summary : "",
    hue,
    muted: entry.hue_source === "muted" || !hue,
    title: entry.title || entry.stem || "",
    titled: entry.titled === true,
  };
}

function areasCardRows(state, sourcePath) {
  const report = state && state.report;
  const catalog = areasCardHost(state, sourcePath);
  if (!report || !catalog || !(report.areasByPath instanceof Map)) return [];
  const rows = [];
  for (const row of catalog.rows || []) {
    const entry = report.areasByPath.get(areasReportPath(row.path));
    const model = areasCardRowModel(entry, row);
    if (model) rows.push(model);
  }
  return rows;
}

function areasCardLookupByTarget(report, target, sourcePath, metadataCache, vault) {
  if (!report || !(report.areasByPath instanceof Map)) return null;
  const name = typeof notebookWikilinkTarget === "function" ? notebookWikilinkTarget(target) : String(target || "").split("|")[0].trim();
  if (!name) return null;
  let file = null;
  try { file = metadataCache?.getFirstLinkpathDest?.(name, sourcePath) || null; } catch (_error) { file = null; }
  if (!file) {
    try { file = vault?.getAbstractFileByPath?.(/\.md$/i.test(name) ? name : `${name}.md`) || null; }
    catch (_error) { file = null; }
  }
  if (file && typeof file.path === "string") {
    return { entry: report.areasByPath.get(areasReportPath(file.path)) || null, file };
  }
  const normalized = areasReportPath(name).replace(/\.md$/i, "");
  const byPath = report.areasByPath.get(`${normalized}.md`) || report.areasByPath.get(normalized);
  if (byPath) return { entry: byPath, file: null };
  const linked = report.areasByLink instanceof Map ? report.areasByLink.get(name) : null;
  if (Array.isArray(linked) && linked.length === 1) return { entry: linked[0], file: null };
  const stem = name.split("/").pop().replace(/\.md$/i, "");
  const matches = report.areasByStem instanceof Map ? report.areasByStem.get(stem) : null;
  return Array.isArray(matches) && matches.length === 1 ? { entry: matches[0], file: null } : null;
}

function areasCardIssueHint(issues) {
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => issue && typeof issue === "object")
    .map((issue) => {
      const where = [issue.path, issue.line].filter((value) => value !== null && value !== undefined && value !== "").join(":");
      const message = typeof issue.message === "string" && issue.message ? issue.message : issue.code || "issue";
      return `${where ? `${where}: ` : ""}${message}`;
    })
    .join("\n");
}

function areasCardHealthModel(catalog) {
  if (!catalog) return null;
  const issues = Array.isArray(catalog.issues) ? catalog.issues : [];
  if (catalog.state === "damaged") {
    return { label: "damaged catalog", repairable: false, hint: areasCardIssueHint(issues) || "This Areas catalog is damaged. Repair the stored [!areas] block by hand." };
  }
  if (catalog.state === "missing" || catalog.state === "stale") {
    return { label: "stale catalog", repairable: true, hint: areasCardIssueHint(issues) || `This Areas catalog is ${catalog.state}. Run bob areas sync to refresh it.` };
  }
  return issues.length ? { label: "check catalog", repairable: false, hint: areasCardIssueHint(issues) } : null;
}

function areasCardUnplacedModel(state, sourcePath) {
  const catalog = areasCardHost(state, sourcePath);
  const report = state && state.report;
  if (!catalog || catalog.kind !== "root" || !report) return null;
  const unplaced = (report.areas || []).filter((entry) => entry && entry.depth === null);
  if (!unplaced.length) return null;
  const paths = new Set(unplaced.map((entry) => areasReportPath(entry.path)));
  const findings = (report.findings || []).filter((issue) => paths.has(areasReportPath(issue.path)));
  const lines = findings.map((issue) => {
    const where = [issue.path, issue.line].filter((value) => value !== null && value !== undefined && value !== "").join(":");
    return `${where ? `${where}: ` : ""}${issue.message || issue.code || "area finding"}`;
  });
  return { count: unplaced.length, tooltip: lines.join("\n") || unplaced.map((entry) => entry.path).join("\n") };
}

function areasCardStatus(state, sourcePath) {
  if (!state || !state.report) return null;
  const catalog = areasCardHost(state, sourcePath);
  if (!catalog) return null;
  const health = areasCardHealthModel(catalog);
  const messages = [];
  let action = null;
  if (state.error) {
    messages.push(state.errorModel?.hint || "Could not refresh the Areas report.");
    action = { kind: "retry", label: "Retry", hint: "Read the Areas report again.", disabled: Boolean(state.refreshing) };
  } else if (state.stale) {
    messages.push(state.refreshing ? "Refreshing Areas report…" : "Showing cached Areas while refreshing.");
  }
  if (health && catalog.state === "damaged") {
    messages.push(health.hint);
  } else if (health && health.repairable) {
    if (state.syncErrorModel) messages.push(state.syncErrorModel.hint);
    if (!state.error) action = { kind: "sync", label: state.syncBusy ? "Syncing…" : "↻ sync", hint: "Run bob areas sync to refresh this catalog.", disabled: Boolean(state.syncBusy) };
  } else if (state.syncErrorModel) {
    messages.push(state.syncErrorModel.hint);
  }
  if (state.syncBusy && !action) action = { kind: "sync", label: "Syncing…", hint: "Refreshing Areas catalogs.", disabled: true };
  return { message: messages.join("\n"), health, action };
}

function areasCardAnchorLine(text) {
  const lines = String(text || "").split(/\r?\n/);
  let start = 0;
  if (/^\s*---\s*$/.test(lines[0] || "")) {
    for (let i = 1; i < lines.length; i += 1) {
      if (/^\s*---\s*$/.test(lines[i])) { start = i + 1; break; }
    }
  }
  let fence = null;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!fence) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (match) { fence = { char: match[1][0], length: match[1].length }; continue; }
      if (/^##\s+Areas\s*#*\s*$/i.test(line)) return i;
    } else {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
    }
  }
  return Math.max(0, start);
}

function areasCardHasCallout(text) {
  const lines = String(text || "").split(/\r?\n/);
  let start = 0;
  if (/^\s*---\s*$/.test(lines[0] || "")) {
    for (let i = 1; i < lines.length; i += 1) if (/^\s*---\s*$/.test(lines[i])) { start = i + 1; break; }
  }
  let fence = null;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!fence) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (match) { fence = { char: match[1][0], length: match[1].length }; continue; }
      if (/^\s*>\s*\[!areas\](?:\s|$)/i.test(line)) return true;
    } else {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
    }
  }
  return false;
}
