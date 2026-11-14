// Projects catalog card: pure host/row/chip/tally/reason/fold models plus
// the stored `[!projects]` region scan and host copy text. Bob's list report
// is the authority for rows, order, membership, and counts; these helpers
// never parse project frontmatter, derive lifecycle state, or write notes.

const PROJECTS_CARD_STATES = ["open", "scheduled", "blocked", "warning", "done", "canceled"];
const PROJECTS_CARD_CLOSED_STATES = new Set(["done", "canceled"]);
const PROJECTS_CARD_OPEN_STATES = new Set(["open", "scheduled", "blocked", "warning"]);
const PROJECTS_CLOSED_PEEK_COUNT = 2;
const PROJECTS_CARD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function projectsCardStateOf(entry) {
  const state = entry && typeof entry.state === "string" ? entry.state : null;
  return PROJECTS_CARD_STATES.includes(state) ? state : null;
}

function projectsCardIsClosed(entry) {
  return PROJECTS_CARD_CLOSED_STATES.has(projectsCardStateOf(entry));
}

function projectsCardIsCountedBlocked(entry) {
  // Blocked is a subset of open: scheduled and dependency/inherited blocked
  // rows stay inside the open lane and are never added twice.
  const state = projectsCardStateOf(entry);
  return state === "scheduled" || state === "blocked";
}

function projectsCardMarker(entry) {
  const state = projectsCardStateOf(entry);
  if (state === null) {
    return { kind: "unknown", glyph: "?", label: "unknown state" };
  }
  if (state === "open") {
    return { kind: "ring", glyph: "", label: "open" };
  }
  if (state === "scheduled") {
    return { kind: "glyph", glyph: "◷", label: "scheduled" };
  }
  if (state === "blocked") {
    return { kind: "glyph", glyph: "⛓", label: "blocked" };
  }
  if (state === "warning") {
    return { kind: "glyph", glyph: "⚠", label: "warning" };
  }
  if (state === "done") {
    return { kind: "glyph", glyph: "✓", label: "done" };
  }
  return { kind: "glyph", glyph: "✕", label: "canceled" };
}

function projectsCardCalendarDate(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return "";
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }
  return text;
}

function projectsCardShortDate(value) {
  const date = projectsCardCalendarDate(value);
  if (!date) {
    return "";
  }
  const month = PROJECTS_CARD_MONTHS[Number(date.slice(5, 7)) - 1] || "";
  const day = Number(date.slice(8, 10));
  return `${month} ${day}`;
}

function projectsCardRelativeDay(value, today) {
  const date = projectsCardCalendarDate(value);
  const now = projectsCardCalendarDate(today);
  if (!date || !now) {
    return "";
  }
  let days = null;
  try {
    days = freshDateDiffDays(date, now);
  } catch (error) {
    return "";
  }
  if (!Number.isInteger(days)) {
    return "";
  }
  if (days === 0) {
    return "today";
  }
  // freshDateDiffDays counts to minus from, so a future date reads negative.
  if (days < 0) {
    const ahead = -days;
    if (ahead >= 14) {
      return `in ${Math.floor(ahead / 7)}w`;
    }
    return `in ${ahead}d`;
  }
  if (days >= 14) {
    return `${Math.floor(days / 7)}w overdue`;
  }
  return `${days}d overdue`;
}

function projectsCardBlockedDate(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const blocked = entry.blocked;
  if (blocked && typeof blocked === "object" && typeof blocked.date === "string") {
    return projectsCardCalendarDate(blocked.date);
  }
  const scheduled = entry.prj && typeof entry.prj === "object" ? entry.prj.scheduled : null;
  return projectsCardCalendarDate(scheduled);
}

function projectsCardWaitsOnStem(target) {
  const text = typeof target === "string" ? target : "";
  const anchor = text.split("#")[0].replace(/\\/g, "/");
  const name = (anchor.split("/").pop() || "").replace(/\.md$/i, "").trim();
  return name || text.trim();
}

function projectsCardBlockedReason(entry, today) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const blocked = entry.blocked;
  if (!blocked || typeof blocked !== "object" || typeof blocked.kind !== "string") {
    return null;
  }
  if (blocked.kind === "scheduled") {
    const date = projectsCardBlockedDate(entry);
    if (!date) {
      return { text: "scheduled", hint: "Scheduled, with no usable date in the report." };
    }
    const short = projectsCardShortDate(date);
    const relative = projectsCardRelativeDay(date, today);
    const text = relative ? `${short} · ${relative}` : short;
    return { text, hint: `Scheduled ${date}${relative ? ` (${relative})` : ""}.` };
  }
  if (blocked.kind === "dependency") {
    const waits = Array.isArray(blocked.waits_on) ? blocked.waits_on : [];
    const names = waits.map(projectsCardWaitsOnStem).filter(Boolean);
    if (!names.length) {
      return { text: "waits on dependencies", hint: "Blocked on dependencies with no usable targets in the report." };
    }
    return { text: `waits on ${names.join(", ")}`, hint: `Blocked on ${names.join(", ")}.` };
  }
  if (blocked.kind === "inherited") {
    return { text: "parent blocked", hint: "Blocked because its parent project is blocked." };
  }
  return null;
}

function projectsCardHost(state, sourcePath) {
  const report = state && state.report;
  if (!report || !(report.catalogsByHostPath instanceof Map)) {
    return null;
  }
  const path = projectsReportPath(sourcePath);
  if (!path) {
    return null;
  }
  return report.catalogsByHostPath.get(path)
    || report.catalogsByHostPath.get(path.replace(/\.md$/i, "") + ".md")
    || null;
}

function projectsCardHostIdentity(catalog, sourcePath) {
  const host = catalog && typeof catalog.host === "string" && catalog.host
    ? catalog.host
    : notebookLinkStem(sourcePath || "");
  return String(host || "").trim();
}

function projectsCardCopyText(catalog, sourcePath) {
  const host = projectsCardHostIdentity(catalog, sourcePath);
  return host ? `@${host}^` : "";
}

function projectsCardHostEntry(state, sourcePath) {
  const report = state && state.report;
  if (!report || !(report.projectsByPath instanceof Map)) {
    return null;
  }
  const path = projectsReportPath(sourcePath);
  if (!path) {
    return null;
  }
  return report.projectsByPath.get(path)
    || report.projectsByPath.get(path.replace(/\.md$/i, "") + ".md")
    || null;
}

function projectsCardChildEntries(state, parentPath) {
  const report = state && state.report;
  if (!report || !(report.projectsByPath instanceof Map)) {
    return [];
  }
  const want = projectsReportPath(parentPath);
  const rows = [];
  for (const entry of report.projectsByPath.values()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const parent = typeof entry.parent === "string" ? projectsReportPath(entry.parent) : "";
    if (parent && parent === want) {
      rows.push(entry);
    }
  }
  return rows;
}

function projectsCardRowEntries(state, sourcePath) {
  // Membership comes from Bob's report only: direct children resolve through
  // each row's stored parent path, never a second JS parent resolution.
  const direct = projectsCardChildEntries(state, sourcePath);
  if (direct.length) {
    return direct;
  }
  const host = projectsCardHostEntry(state, sourcePath);
  const children = host && Array.isArray(host.children) ? host.children : [];
  const report = state && state.report;
  if (!children.length || !report || !(report.projectsByPath instanceof Map)) {
    return direct;
  }
  const rows = [];
  for (const child of children) {
    const entry = report.projectsByPath.get(projectsReportPath(child));
    if (entry) {
      rows.push(entry);
    }
  }
  return rows;
}

function projectsCardStemCompare(left, right) {
  const byStem = String(left.stem || "").localeCompare(String(right.stem || ""), undefined, { sensitivity: "base" });
  if (byStem !== 0) {
    return byStem;
  }
  return projectsReportPath(left.path).localeCompare(projectsReportPath(right.path));
}

function projectsCardClosedCompare(left, right) {
  const newer = projectsCardCalendarDate(right.closed_on);
  const older = projectsCardCalendarDate(left.closed_on);
  if (newer && older && newer !== older) {
    return newer < older ? -1 : 1;
  }
  // Undated closures sort after dated ones, then A–Z.
  if (newer && !older) {
    return 1;
  }
  if (older && !newer) {
    return -1;
  }
  return projectsCardStemCompare(left, right);
}

function projectsCardPartition(rows) {
  const open = [];
  const closed = [];
  for (const entry of Array.isArray(rows) ? rows : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (projectsCardIsClosed(entry)) {
      closed.push(entry);
    } else {
      // Unknown states stay visible in the open lane rather than vanishing.
      open.push(entry);
    }
  }
  open.sort(projectsCardStemCompare);
  closed.sort(projectsCardClosedCompare);
  return { open, closed };
}

function projectsCardTally(partition) {
  const open = partition && Array.isArray(partition.open) ? partition.open : [];
  const closed = partition && Array.isArray(partition.closed) ? partition.closed : [];
  const blocked = open.filter(projectsCardIsCountedBlocked).length;
  const full = `${open.length} open · ${blocked} blocked · ${closed.length} closed`;
  const short = `${open.length}·${blocked}·${closed.length}`;
  return {
    open: open.length,
    blocked,
    closed: closed.length,
    full,
    short,
    hint: `${open.length} open projects, ${blocked} blocked, ${closed.length} closed.`,
  };
}

function projectsCardChips(entry, today) {
  const chips = [];
  const tasks = entry && typeof entry === "object" && entry.tasks && typeof entry.tasks === "object"
    ? entry.tasks
    : {};
  if (Number.isInteger(tasks.open)) {
    chips.push({ kind: "tasks", text: `${tasks.open} tasks`, hint: `${tasks.open} open tasks.` });
  }
  if (Number.isInteger(tasks.today) && tasks.today > 0) {
    chips.push({ kind: "today", text: "● today", hint: `${tasks.today} tasks due today.` });
  }
  if (entry && entry.prj && typeof entry.prj === "object" && entry.prj.hidden === false) {
    chips.push({ kind: "empty", text: "empty", hint: "No hidden project line; this project reads empty." });
  }
  const reason = projectsCardBlockedReason(entry, today);
  if (reason) {
    chips.push({ kind: "reason", text: reason.text, hint: reason.hint });
  }
  return chips;
}

function projectsCardRowModel(entry, today) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const children = Array.isArray(entry.children) ? entry.children.filter((child) => typeof child === "string") : [];
  return {
    path: projectsReportPath(entry.path),
    stem: typeof entry.stem === "string" ? entry.stem : "",
    criterion: typeof entry.criterion === "string" ? entry.criterion : "",
    state: projectsCardStateOf(entry),
    marker: projectsCardMarker(entry),
    chips: projectsCardChips(entry, today),
    children,
    childCount: children.length,
    closedOn: projectsCardCalendarDate(entry.closed_on),
  };
}

function projectsCardChildTooltip(metadataCache, file) {
  try {
    const cache = metadataCache && typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache(file)
      : null;
    const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
    for (const heading of headings) {
      if (heading && typeof heading === "object" && heading.level === 1 && typeof heading.heading === "string" && heading.heading.trim()) {
        return heading.heading.trim();
      }
    }
  } catch (error) {
    // Tooltips are best-effort.
  }
  return "";
}

function projectsCardLookupByTarget(report, target, sourcePath, metadataCache, vault) {
  if (!report || !(report.projectsByPath instanceof Map)) {
    return null;
  }
  const name = notebookWikilinkTarget(target);
  if (!name) {
    return null;
  }
  let file = null;
  try {
    file = metadataCache?.getFirstLinkpathDest?.(name, sourcePath) || null;
  } catch (error) {
    file = null;
  }
  if (!file) {
    try {
      file = vault?.getAbstractFileByPath?.(/\.md$/i.test(name) ? name : `${name}.md`) || null;
    } catch (error) {
      file = null;
    }
  }
  // Never fall back to a stem after a different file has resolved: duplicate
  // display titles must not turn an ordinary note into a project row.
  if (file && typeof file.path === "string" && file.path) {
    return { entry: report.projectsByPath.get(projectsReportPath(file.path)) || null, file };
  }
  return { entry: null, file: null };
}

function projectsCardHealthModel(catalog) {
  const issues = (catalog && Array.isArray(catalog.issues) ? catalog.issues : []).filter((issue) => issue && typeof issue === "object");
  const state = catalog && typeof catalog.state === "string" ? catalog.state : "";
  if (state === "damaged") {
    return {
      label: "damaged catalog",
      repairable: false,
      hint: projectsCardIssueHint(issues) || "This projects catalog is damaged. Repair the stored [!projects] block by hand, then sync.",
    };
  }
  if (state === "missing" || state === "stale") {
    return {
      label: `${state} catalog`,
      repairable: true,
      hint: projectsCardIssueHint(issues) || `This projects catalog is ${state}. Sync projects to refresh it.`,
    };
  }
  if (issues.length) {
    return { label: "check projects", repairable: false, hint: projectsCardIssueHint(issues) };
  }
  return null;
}

function projectsCardIssueHint(issues) {
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => issue && typeof issue === "object")
    .map((issue) => {
      const where = [issue.path, issue.line].filter((part) => part != null && part !== "").join(":");
      const message = typeof issue.message === "string" && issue.message ? issue.message : (issue.code || "issue");
      return `${where ? `${where}: ` : ""}${message}`;
    })
    .join("\n");
}

function projectsCardStatus(state, sourcePath) {
  const catalog = projectsCardHost(state, sourcePath);
  const hostEntry = projectsCardHostEntry(state, sourcePath);
  const issues = catalog && Array.isArray(catalog.issues) ? catalog.issues : [];
  const findings = state && state.report && Array.isArray(state.report.findings) ? state.report.findings : [];
  const messages = [];
  let action = null;
  if (!state || !state.report) {
    messages.push((state && state.errorModel && state.errorModel.hint) || "Projects data is loading; counts are unavailable.");
  } else if (state.stale) {
    messages.push((state.errorModel && state.errorModel.hint) || "Showing cached projects while refreshing.");
  }
  if (catalog && catalog.state !== "current") {
    const health = projectsCardHealthModel(catalog);
    messages.push(health ? health.hint : `Projects catalog: ${catalog.state}. ${projectsCardIssueHint(issues)}`.trim());
  }
  if (findings.length) {
    const shown = findings
      .slice(0, 3)
      .map((finding) => (finding && typeof finding.message === "string" && finding.message)
        || (finding && typeof finding.code === "string" && finding.code)
        || "")
      .filter(Boolean);
    if (shown.length) {
      messages.push(`Findings: ${shown.join("; ")}${findings.length > shown.length ? ` (+${findings.length - shown.length} more)` : ""}`);
    }
  }
  if (state && state.syncErrorModel) {
    messages.push(state.syncErrorModel.hint);
  }
  if ((!state || state.errorModel || (!state.report && !state.refreshing))) {
    if (!state || !state.report || state.errorModel) {
      action = {
        kind: "retry",
        label: "Retry",
        hint: (state && state.errorModel && state.errorModel.hint) || "Read the projects list again.",
        disabled: Boolean(state && state.refreshing),
      };
    }
  }
  if (!action && state && state.report) {
    const repairable = catalog && (catalog.state === "missing" || catalog.state === "stale");
    if (state.syncBusy || repairable) {
      action = {
        kind: "sync",
        label: state.syncBusy ? "Syncing…" : "↻ sync",
        hint: "Run bob projects sync to refresh this catalog.",
        disabled: Boolean(state.syncBusy),
      };
    }
  }
  const copy = state && state.report && (catalog || (hostEntry && Array.isArray(hostEntry.children) && hostEntry.children.length > 0))
    ? { label: "＋ project", hint: `Copy @${projectsCardHostIdentity(catalog, sourcePath)}^ to start a project capture.` }
    : null;
  return { message: messages.join("\n"), action, copy };
}

function projectsCardSourceRegions(text) {
  const lines = String(text === null || text === undefined ? "" : text).split("\n");
  const regions = [];
  let fence = null;
  for (let index = notebookFrontmatterEnd(lines); index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence || !/^ {0,3}>\s*\[!projects\](?:[-+])?(?:\s.*)?$/i.test(line)) {
      continue;
    }
    const region = { begin: index, end: index };
    while (region.end + 1 < lines.length && /^ {0,3}>/.test(lines[region.end + 1])) {
      region.end += 1;
    }
    regions.push(region);
    index = region.end;
  }
  return regions;
}

function projectsCardAnchorLine(text) {
  const lines = String(text === null || text === undefined ? "" : text).split("\n");
  const first = notebookFrontmatterEnd(lines);
  const body = lines.slice(first).join("\n");
  const heading = notebookFindHeadingLine(body, (line) => /^## Projects\s*$/.test(line));
  const title = notebookFindHeadingLine(body, (line) => /^# \S/.test(line));
  if (heading >= 0) {
    return first + heading;
  }
  if (title >= 0) {
    return first + title;
  }
  const nonblank = lines.slice(first).findIndex((line) => line.trim());
  return first + Math.max(0, nonblank);
}

function projectsCardClosedFoldKey(hostPath) {
  return `closed:${projectsReportPath(hostPath)}`;
}

function projectsCardChildFoldKey(hostPath, childPath) {
  return `child:${projectsReportPath(hostPath)}:${projectsReportPath(childPath)}`;
}

function projectsCardFoldMap(host) {
  if (host instanceof Map) {
    return host;
  }
  return new Map();
}

function projectsCardIsClosedFolded(folds, hostPath) {
  // The Closed group defaults folded; an explicit stored false opens it.
  const map = projectsCardFoldMap(folds);
  const key = projectsCardClosedFoldKey(hostPath);
  if (!map.has(key)) {
    return true;
  }
  return map.get(key) !== false;
}

function projectsCardIsChildExpanded(folds, hostPath, childPath) {
  const map = projectsCardFoldMap(folds);
  return map.get(projectsCardChildFoldKey(hostPath, childPath)) === true;
}
