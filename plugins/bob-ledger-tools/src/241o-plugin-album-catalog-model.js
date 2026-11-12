// Album presentation uses the report's paths and declaration order. No YAML
// parsing, catalog regeneration, or note writes belong in these helpers.
function albumLookupByTarget(report, target, sourcePath, metadataCache, vault) {
  if (!report || !(report.albumsByPath instanceof Map)) return null;
  const name = notebookWikilinkTarget(target);
  let file = null;
  try { file = metadataCache?.getFirstLinkpathDest?.(name, sourcePath); } catch (_) {}
  if (!file) {
    try { file = vault?.getAbstractFileByPath?.(/\.md$/i.test(name) ? name : `${name}.md`); } catch (_) {}
  }
  // Never fall back to a stem after a different file has resolved: aliases and
  // duplicate display titles must not turn an ordinary note into an album.
  return file ? report.albumsByPath.get(albumReportPath(file.path)) || null : null;
}

function albumHostCatalog(state, sourcePath) {
  return state?.report?.catalogsByHostPath?.get(albumReportPath(sourcePath)) || null;
}

function albumLowerLabel(text) {
  return /^[A-Z]{2}/.test(text) ? text : text.replace(/^./u, (first) => first.toLowerCase());
}

function albumGroupTally(group) {
  const label = String(group.label || "").trim();
  // Match bob's split_icon/lowercase_rest grammar, including acronym labels.
  const icon = /^[^a-zA-Z0-9\s]+/u.exec(label)?.[0];
  return icon
    ? `${icon} ${group.count}${label.slice(icon.length).trim() ? ` ${albumLowerLabel(label.slice(icon.length).trim())}` : ""}`
    : `${group.count} ${albumLowerLabel(label)}`;
}

function albumIssueHint(issues) {
  return (issues || []).map((issue) => {
    const where = [issue.path, issue.line, issue.key_path].filter((part) => part != null && part !== "").join(":");
    const suggestions = (issue.suggestions || []).join("; ");
    return `${where ? `${where}: ` : ""}${issue.message || issue.code}${suggestions ? ` — ${suggestions}` : ""}`;
  }).join("\n");
}

function albumHealthModel(album) {
  const issues = album?.issues || [];
  const invalid = issues.some((issue) => issue.severity === "error" && issue.code !== "album_index_damaged");
  const state = album?.index?.state;
  if (invalid || state === "damaged") {
    return { label: invalid ? "invalid" : "damaged index", repairable: false,
      hint: albumIssueHint(issues) || "Repair the album schema or damaged Records region before syncing." };
  }
  if (state === "missing" || state === "stale") {
    return { label: `${state} index`, repairable: true,
      hint: albumIssueHint(issues) || `The Records index is ${state}. Sync albums to refresh it.` };
  }
  if (issues.length) return { label: "check album", repairable: false, hint: albumIssueHint(issues) };
  return null;
}

function albumRowModel(album, today) {
  if (!album) return null;
  const lead = (album.groups || []).find((group) => group.count > 0) || null;
  return { path: album.path, title: album.title,
    count: `${album.records} ${album.plural || "records"}`,
    lead: lead ? { ...lead, tally: albumGroupTally(lead), peek: (lead.peek || []).slice(0, 3) } : null,
    age: notebookAgeChip(album.last_record, today), lastAdded: album.last_record,
    health: albumHealthModel(album) };
}

function albumCatalogStatus(state, sourcePath) {
  const catalog = albumHostCatalog(state, sourcePath);
  const issues = catalog?.issues || [];
  const messages = [];
  let action = null;
  if (!state.report) messages.push(state.errorModel?.hint || "Album data is loading; counts are unavailable.");
  else if (state.stale) messages.push(state.errorModel?.hint || "Showing cached album data while refreshing.");
  if (catalog && catalog.state !== "current") {
    messages.push(`Albums catalog: ${catalog.state}. ${albumIssueHint(issues)}`.trim());
  }
  if (state.syncErrorModel) messages.push(state.syncErrorModel.hint);
  const rows = state.report?.albums || [];
  const repairable = ["missing", "stale"].includes(catalog?.state)
    || rows.some((album) => (album.path && (album.owner === sourcePath.replace(/\.md$/, "")
      || album.root === sourcePath.replace(/\.md$/, ""))) && albumHealthModel(album)?.repairable);
  if (state.errorModel || (!state.report && !state.refreshing)) {
    action = { kind: "retry", label: "Retry", hint: state.errorModel?.hint || "Read the album report again.", disabled: state.refreshing };
  } else if (state.syncBusy || repairable) {
    action = { kind: "sync", label: state.syncBusy ? "Syncing…" : "Sync albums",
      hint: "Refresh generated album catalogs and record indexes.", disabled: state.syncBusy };
  }
  return { message: messages.join("\n"), action };
}

// Only real, top-level generated callouts participate, never examples in
// frontmatter/fences or embedded quote callouts. Positions are zero-based.
function albumSourceRegions(text, kind = "albums") {
  const lines = String(text || "").split("\n");
  const regions = [];
  let fence = null;
  for (let i = notebookFrontmatterEnd(lines); i < lines.length; i += 1) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence || !new RegExp(`^ {0,3}>\\s*\\[!${kind}\\](?:[-+])?(?:\\s.*)?$`, "i").test(lines[i])) continue;
    const region = { begin: i, end: i, groups: [] };
    while (region.end + 1 < lines.length && /^ {0,3}>/.test(lines[region.end + 1])) region.end += 1;
    for (let row = i + 1; row <= region.end; row += 1) {
      const group = /^ {0,3}> - \*\*(.*)\*\* · (\d+)\s*$/.exec(lines[row]);
      if (group) region.groups.push({ line: row, label: group[1].replace(/\\([\s\S])/g, "$1"), count: Number(group[2]) });
    }
    regions.push(region);
    i = region.end;
  }
  return regions;
}

function albumGroupJumpTarget(text, album, value) {
  const regions = albumSourceRegions(text, "records");
  const group = (album?.groups || []).find((item) => item.value === value);
  const label = group?.label?.replace(/\s+/g, " ").trim();
  const matches = regions.length === 1 && group
    ? regions[0].groups.filter((item) => item.label === label) : [];
  // An ambiguous or missing label never targets an unrelated row. Do not use
  // the live report's group ordinal against an out-of-date stored index.
  if (matches.length === 1) return { line: matches[0].line, found: true, value, label };
  const line = regions[0]?.begin ?? notebookFindHeadingLine(text, (row) => /^## Records\s*$/.test(row));
  return { line: Math.max(0, line), found: false, value, label,
    hint: "Opened Records. That group is missing or ambiguous; sync albums to refresh the index." };
}

function albumCatalogAnchorLine(text) {
  const lines = String(text || "").split("\n");
  const first = notebookFrontmatterEnd(lines);
  const body = lines.slice(first).join("\n");
  const heading = notebookFindHeadingLine(body, (line) => /^## Albums\s*$/.test(line));
  const title = notebookFindHeadingLine(body, (line) => /^# \S/.test(line));
  if (heading >= 0) return first + heading;
  if (title >= 0) return first + title;
  const nonblank = lines.slice(first).findIndex((line) => line.trim());
  return first + Math.max(0, nonblank);
}
