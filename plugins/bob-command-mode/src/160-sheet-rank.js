// Bob Command Mode: bottom sheet row model, fuzzy ranking, and frecency.
// Pure: no DOM and no Obsidian imports. The sheet modal (170) renders rows,
// and node tests require this file through the built main.js helpers.

const CM_SHEET_RECENT_LIMIT = 4;
const CM_SHEET_FRECENCY_WINDOW = 10;
// Shown only when the median tops two seconds.
const CM_SHEET_DURATION_FLOOR_MS = 2000;
// [max age in days, weight] per the sheet spec: runs at most 4 / 14 / 31 /
// 90 days old earn 100 / 70 / 50 / 30, older runs earn 10.
const CM_SHEET_FRECENCY_BUCKETS = [
  [4, 100],
  [14, 70],
  [31, 50],
  [90, 30],
  [Infinity, 10],
];
const CM_SHEET_FIELD_WEIGHTS = { path: 1.0, alias: 0.9, title: 0.8, keywords: 0.6 };
const CM_SHEET_PATH_PREFIX_BONUS = 8;
const CM_SHEET_KEYWORD_BONUS = 8;

// Row-kind icons (Lucide names). Entries derive their kind from effect and
// network; the modal falls back to a text glyph when setIcon is unavailable.
const CM_SHEET_ICONS = {
  network: "globe",
  syncs: "refresh-cw",
  writes: "pencil-line",
  reads: "book-open",
  surface: "app-window",
  vim: "terminal-square",
  help: "help-circle",
  recent: "history",
  plain: "command",
  sequence: "list-ordered",
};
const CM_SHEET_ICON_FALLBACK = {
  network: "◉",
  syncs: "⟳",
  writes: "✎",
  reads: "ⓘ",
  surface: "▤",
  vim: "›",
  help: "?",
  recent: "↺",
  plain: "⌘",
  sequence: "≡",
};

// Surface rows owned by the plugin. Each runs an existing Obsidian command and
// is feature-detected through app.commands.commands[id]; a missing command
// makes the row unavailable. There is no "Preview article adoption" row: the
// plan names a bob-articles adopt-preview command id, but no such command
// exists in bob-articles' source (only format-article and convert-to-article),
// so there is nothing to detect.
const CM_SHEET_SURFACE_ROWS = [
  { plugin: "bob-ledger-tools", id: "open-today-daily-note", title: "Today's daily note", section: "daily" },
  { plugin: "bob-navigation-hotkeys", id: "open-pomodoro-themes-manager", title: "Task types manager", section: "daily" },
  { plugin: "bob-ledger-tools", id: "open-stats", title: "Stats dashboard", section: "daily" },
  { plugin: "bob-navigation-hotkeys", id: "open-dash-tasks", title: "Dash tasks", section: "tasks" },
  { plugin: "bob-navigation-hotkeys", id: "open-relation-labels-manager", title: "Relation labels manager", section: "tasks" },
  { plugin: "bob-ledger-tools", id: "open-reading-board", title: "Reading Board", section: "vault" },
  { plugin: "bob-articles", id: "format-article", title: "Format this article", section: "vault" },
];

function cmSheetLower(value) {
  return String(value || "").toLowerCase();
}

function cmSheetWords(text) {
  return cmSheetLower(text).split(/[\s_\/-]+/).filter(Boolean);
}

// Subsequence match of token inside field. Scores consecutive runs and word
// starts; returns 0 when token is not a subsequence of field.
function cmFuzzyFieldScore(token, field) {
  const needle = cmSheetLower(token);
  const hay = cmSheetLower(field);
  if (!needle || !hay) return 0;
  if (hay === needle) return 14;
  if (hay.startsWith(needle)) return 10;
  let score = 0;
  let ni = 0;
  let run = 0;
  for (let hi = 0; hi < hay.length && ni < needle.length; hi += 1) {
    if (hay[hi] === needle[ni]) {
      ni += 1;
      run += 1;
      score += 1 + run;
      if (hi === 0 || /[\s_\/\-:.]/.test(hay[hi - 1])) score += 2;
    } else {
      run = 0;
    }
  }
  if (ni < needle.length) return 0;
  const words = cmSheetWords(hay);
  if (words.some((word) => word.startsWith(needle))) score += 4;
  return score;
}

function cmSheetTokenize(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
}

// Best weighted field score for one token across the row's match views.
// Views: {path, alias, title, keywords} as plain strings.
function cmSheetTokenScore(token, views) {
  let best = 0;
  for (const field of Object.keys(CM_SHEET_FIELD_WEIGHTS)) {
    const text = views && views[field];
    if (!text) continue;
    const score = cmFuzzyFieldScore(token, text) * CM_SHEET_FIELD_WEIGHTS[field];
    if (score > best) best = score;
  }
  return best;
}

// Ranked score for a row. Every query token must match somewhere (AND);
// exact path-prefix and exact keyword hits add a bonus. Returns -1 when the
// row does not match.
function cmRankSheetRow(queryText, views, keywords) {
  const tokens = cmSheetTokenize(queryText);
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    const tokenScore = cmSheetTokenScore(token, views);
    if (tokenScore <= 0) return -1;
    total += tokenScore;
  }
  const query = cmSheetLower(queryText).trim().replace(/\s+/g, " ");
  if (views && cmSheetLower(views.path).startsWith(query)) total += CM_SHEET_PATH_PREFIX_BONUS;
  const words = Array.isArray(keywords) ? keywords.map(cmSheetLower) : [];
  if (tokens.some((token) => words.includes(token))) total += CM_SHEET_KEYWORD_BONUS;
  return total;
}

function cmSheetRowViews(row) {
  return {
    path: Array.isArray(row.path) ? row.path.join(" ") : String(row.path || ""),
    alias: Array.isArray(row.aliases) ? row.aliases.join(" ") : String(row.aliases || ""),
    title: String(row.title || ""),
    keywords: Array.isArray(row.keywords) ? row.keywords.join(" ") : String(row.keywords || ""),
  };
}

// Rank rows for a query: best match first. Frecency breaks ties, then the
// input (catalog) order. Never mutates the input.
function cmRankSheetRows(query, rows, frecencyByKey) {
  const scored = [];
  for (let index = 0; index < (rows || []).length; index += 1) {
    const row = rows[index];
    const views = cmSheetRowViews(row);
    const score = cmRankSheetRow(query, views, row.keywords);
    if (score < 0) continue;
    scored.push({ row, score, index });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftFrec = Number((frecencyByKey && frecencyByKey[left.row.key]) || 0);
    const rightFrec = Number((frecencyByKey && frecencyByKey[right.row.key]) || 0);
    if (rightFrec !== leftFrec) return rightFrec - leftFrec;
    return left.index - right.index;
  });
  return scored.map((item) => item.row);
}

function cmSheetRunTimeMs(run) {
  const stamp = (run && (run.finished_at || run.started_at)) || null;
  const ms = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function cmSheetFrecencyWeight(ageMs) {
  const days = ageMs / 86400000;
  for (const [maxDays, weight] of CM_SHEET_FRECENCY_BUCKETS) {
    if (days <= maxDays) return weight;
  }
  return 10;
}

// Frecency per row key over that row's last 10 runs. Counts runs from this
// host plus runs recorded before hosts were tracked (null host).
function cmSheetFrecency(runs, key, nowMs, host) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  let total = 0;
  let seen = 0;
  const ordered = [...(runs || [])].reverse();
  for (const run of ordered) {
    if (seen >= CM_SHEET_FRECENCY_WINDOW) break;
    if (!run || cmSheetRunKey(run) !== key) continue;
    if (run.host && host && run.host !== host) continue;
    const at = cmSheetRunTimeMs(run);
    if (at === null || at > now) continue;
    total += cmSheetFrecencyWeight(now - at);
    seen += 1;
  }
  return total;
}

function cmSheetFrecencyMap(runs, rows, nowMs, host) {
  const map = {};
  for (const row of rows || []) {
    if (!row || !row.key || row.key in map) continue;
    map[row.key] = cmSheetFrecency(runs, row.key, nowMs, host);
  }
  return map;
}

function cmSheetRunKey(run) {
  if (run && run.entry_id) return "entry:" + run.entry_id;
  return "argv:" + JSON.stringify(cmRecordArgs(run));
}

function cmSheetAgeText(ms) {
  const age = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + "h";
  return Math.floor(hours / 24) + "d";
}

const CM_SHEET_OUTCOME_GLYPH = { completed: "✓", attention: "◐", failed: "✗", unknown: "?", stopped: "■", running: "⟳", interrupted: "◌" };

// One RECENT row per sequence: step display words joined by faint ›
// separators, "N steps" title, and an about line of step titles (or the
// halt/interrupt note). Shares the 4-row limit and dedupe with single rows.
function cmSheetSequenceRowAbout(group, catalog) {
  const titles = (group.steps || []).map((step) => cmSequenceStepTitle(step, catalog));
  const state = group.state || group.outcome || "unknown";
  if (state === "failed" || state === "unknown" || state === "stopped") {
    const stoppedAt = Number(group.stoppedAt) || 0;
    const hit = (group.results || []).find((row) => row && Number(row.index) === stoppedAt && !row.skipped);
    const reason = String((hit && hit.reason) || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
    if (stoppedAt && reason) return "Stopped at step " + stoppedAt + ": " + reason;
    if (stoppedAt) return "Stopped at step " + stoppedAt + " of " + group.total;
    return titles.join(" → ");
  }
  if (state === "interrupted") {
    const done = (group.results || []).filter((row) => row && !row.skipped).length;
    return "Interrupted after step " + done + " of " + group.total;
  }
  return titles.join(" → ");
}

function cmSheetSequenceRecentRow(group, now, catalog) {
  const steps = Array.isArray(group.steps) ? group.steps.map(cmSequenceStep) : [];
  const total = Number(group.total) || steps.length;
  const displays = steps.map((step) => cmSequenceStepDisplay(step, catalog).join(" "));
  const path = [];
  displays.forEach((text, index) => {
    if (index > 0) path.push("›");
    path.push(text);
  });
  const state = group.state || group.outcome || "unknown";
  const stamp = group.finished_at || group.started_at;
  const at = stamp ? Date.parse(stamp) : NaN;
  const key = "recent-seq:" + group.signature;
  return {
    // Row keys must stay unique across the whole sheet: selection, highlighting, rowEls, and section headings are all keyed by row.key.
    key,
    kind: "recent",
    path,
    title: total + " steps",
    about: cmSheetSequenceRowAbout(group, catalog),
    steps,
    sequenceId: group.id,
    signature: group.signature,
    total,
    state,
    outcome: state,
    stoppedAt: group.stoppedAt || null,
    required: [],
    runKey: key,
    glyph: state === "running" ? "⟳" : (CM_SHEET_OUTCOME_GLYPH[state] || "?"),
    age: Number.isFinite(at) ? cmSheetAgeText(now - at) : "",
    duration: typeof group.durationMs === "number" ? group.durationMs : null,
    icon: "sequence",
  };
}

// Last four distinct runs or sequences, newest first. Every record carrying
// the same sequence.id folds into one row; steps never appear as separate
// RECENT rows. Single and sequence rows share one dedupe set and the 4-row
// limit. Keeping kind "recent" reuses RECENT grouping plus glyph and age.
function cmSheetRecentRows(runs, nowMs, catalog, options = {}) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const rawActive = options && options.activeSequenceIds;
  const activeIds = rawActive instanceof Set
    ? rawActive
    : Array.isArray(rawActive)
      ? new Set(rawActive.map(String))
      : new Set();
  let groupsById = new Map();
  try {
    const groups = cmSequenceHistory(runs, { activeIds });
    for (const group of groups) {
      if (group && group.id) groupsById.set(String(group.id), group);
    }
  } catch (error) {
    groupsById = new Map();
  }
  const seen = new Set();
  const seenSeqId = new Set();
  const rows = [];
  for (const run of [...(runs || [])].reverse()) {
    if (rows.length >= CM_SHEET_RECENT_LIMIT) break;
    if (!run || !Array.isArray(run.argv)) continue;
    const seqId = run.sequence && run.sequence.id ? String(run.sequence.id) : "";
    if (seqId) {
      if (seenSeqId.has(seqId)) continue;
      seenSeqId.add(seqId);
      const group = groupsById.get(seqId);
      if (!group) continue;
      if (seen.has(group.signature)) continue;
      seen.add(group.signature);
      rows.push(cmSheetSequenceRecentRow(group, now, catalog));
      continue;
    }
    const replay = cmReplayRun(run, catalog);
    const signature = JSON.stringify({ argv: replay.argv, preview: replay.preview });
    if (seen.has(signature)) continue;
    seen.add(signature);
    const entry = replay.entryId ? cmEntryById(catalog, replay.entryId) : null;
    const at = cmSheetRunTimeMs(run);
    rows.push({
      // Row keys must stay unique across the whole sheet: selection, highlighting, rowEls, and section headings are all keyed by row.key.
      key: "recent:" + signature,
      kind: "recent",
      path: cmRecordArgs(run),
      title: run.title || run.entry_id || "Last command",
      about: run.summary || "",
      argv: [...replay.argv],
      preview: replay.preview,
      entryId: replay.entryId,
      presentation: entry
        ? cmNormalizePresentation(entry.presentation)
        : cmNormalizePresentation(run.presentation || "action"),
      policy: entry ? cmNormalizePolicy(entry.policy) : "run",
      hasPreview: Boolean(entry && Array.isArray(entry.preview) && entry.preview.length > 0),
      confirm: entry && entry.policy === "confirm" ? String(entry.confirm || "") : null,
      required: [],
      runKey: cmSheetRunKey(run),
      outcome: run.outcome || "unknown",
      glyph: CM_SHEET_OUTCOME_GLYPH[run.outcome] || "?",
      age: at === null ? "" : cmSheetAgeText(now - at),
      duration: typeof run.duration_ms === "number" ? run.duration_ms : null,
      icon: "recent",
    });
  }
  return rows;
}

// Median of the row's last 10 local durations; null when under the floor.
function cmSheetMedianDuration(runs, row, host) {
  const signature = row.kind === "recent" && row.runKey
    ? row.runKey
    : row.key;
  const durations = [];
  for (const run of [...(runs || [])].reverse()) {
    if (durations.length >= CM_SHEET_FRECENCY_WINDOW) break;
    if (!run || typeof run.duration_ms !== "number") continue;
    if (run.host && host && run.host !== host) continue;
    const key = run.entry_id && row.entryId
      ? (run.entry_id === row.entryId ? signature : null)
      : (cmSheetRunKey(run) === signature ? signature : null);
    if (key) durations.push(run.duration_ms);
  }
  if (!durations.length) return null;
  durations.sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  return median > CM_SHEET_DURATION_FLOOR_MS ? median : null;
}

function cmSheetEntryKind(entry) {
  if (entry && entry.network) return "network";
  const effect = cmNormalizeEffect(entry && entry.effect);
  if (effect === "syncs") return "syncs";
  if (effect === "writes") return "writes";
  return "reads";
}

// Alias strings whose `to` path names this entry, e.g. "ref clip".
function cmSheetEntryAliases(catalog, entry) {
  const path = Array.isArray(entry && entry.path) ? entry.path : [];
  const found = [];
  for (const alias of ((catalog && catalog.aliases) || [])) {
    if (alias && Array.isArray(alias.to) && Array.isArray(alias.from) &&
        alias.to.length === path.length && alias.to.every((word, i) => word === path[i])) {
      found.push(alias.from.join(" "));
    }
  }
  return found;
}

function cmSheetEntryUnavailable(entry, host) {
  const hosts = Array.isArray(entry && entry.hosts) ? entry.hosts.filter(Boolean) : [];
  if (hosts.length && (!host || !hosts.includes(host))) return "Unavailable here";
  return null;
}

// Catalog entry rows in catalog order. Skips entries retired by an exclusion
// rule that names the entry's exact path (for example bare `capture`, whose
// free-text runs stay refused); named rows under an excluded prefix keep
// their row because the runner runs them by entry id.
function cmSheetEntryRows(catalog, host) {
  const entries = (catalog && Array.isArray(catalog.entries) && catalog.entries) || [];
  const excludedPaths = new Set(
    ((catalog && Array.isArray(catalog.excluded) && catalog.excluded) || [])
      .filter((rule) => rule && Array.isArray(rule.path))
      .map((rule) => JSON.stringify(rule.path)),
  );
  const rows = [];
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.path) || !entry.path.length) continue;
    if (excludedPaths.has(JSON.stringify(entry.path)) && !(entry.fixed || []).length) continue;
    const unavailable = cmSheetEntryUnavailable(entry, host);
    rows.push({
      key: "entry:" + entry.id,
      kind: "entry",
      subkind: cmSheetEntryKind(entry),
      icon: cmSheetEntryKind(entry),
      path: [...entry.path, ...((entry.fixed || []).map(String))],
      basePath: [...entry.path],
      fixed: (entry.fixed || []).map(String),
      aliases: cmSheetEntryAliases(catalog, entry),
      title: entry.title || entry.id,
      about: (entry.about || "").split("\n")[0],
      keywords: Array.isArray(entry.keywords) ? [...entry.keywords] : [],
      effect: cmNormalizeEffect(entry.effect),
      presentation: cmNormalizePresentation(entry.presentation),
      policy: cmNormalizePolicy(entry.policy),
      hasPreview: Array.isArray(entry.preview) && entry.preview.length > 0,
      confirm: entry.policy === "confirm" ? String(entry.confirm || "") : null,
      required: cmRequiredPositionals(entry),
      entryId: entry.id,
      section: entry.section || "daily",
      unavailable,
    });
  }
  return rows;
}

function cmSheetSurfaceRows(surfaceAvailable) {
  return CM_SHEET_SURFACE_ROWS.map((item) => {
    const commandId = item.plugin + ":" + item.id;
    const available = typeof surfaceAvailable === "function" ? surfaceAvailable(commandId) : true;
    return {
      key: "surface:" + commandId,
      kind: "surface",
      icon: "surface",
      path: [item.title],
      title: item.title,
      about: "Open in Obsidian",
      keywords: [item.id.replace(/-/g, " ")],
      effect: "opens",
      presentation: "surface",
      policy: "run",
      hasPreview: false,
      required: [],
      surfaceId: commandId,
      section: item.section,
      unavailable: available ? null : "Enable " + item.plugin,
    };
  });
}

function cmSheetPlainRows() {
  return [
    {
      key: "plain:bob-help", kind: "plain", icon: "help", path: ["bob", "--help"],
      title: "bob help", about: "Every command, in the pager", keywords: ["help", "usage", "man"],
      effect: "reads", presentation: "report", policy: "run", hasPreview: false,
      required: [], argv: ["--help"], section: "setup", unavailable: null,
    },
    {
      key: "plain:show-last-output", kind: "plain", icon: "plain", path: ["Show last output"],
      title: "Show last output", about: "The newest run, in the pager", keywords: ["last", "output", "history"],
      effect: "reads", presentation: "report", policy: "run", hasPreview: false,
      required: [], action: "show-last-output", section: "setup", unavailable: null,
    },
    {
      key: "plain:run-history", kind: "plain", icon: "recent", path: ["Run history"],
      title: "Run history", about: "Every recorded run, newest first", keywords: ["history", "runs", "log"],
      effect: "reads", presentation: "report", policy: "run", hasPreview: false,
      required: [], action: "run-history", section: "setup", unavailable: null,
    },
  ];
}

function cmSheetIsHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

// Normalize a note's frontmatter `type` plus the article check into the
// context kind the sheet builds "For this note" rows from.
function cmSheetNoteKind(frontmatterType, isArticle) {
  const values = Array.isArray(frontmatterType) ? frontmatterType : [frontmatterType];
  const normalized = values
    .map((value) => String(value || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("ref")) return "ref";
  if (normalized.includes("area")) return "area";
  if (normalized.includes("project")) return "project";
  if (isArticle || normalized.includes("article")) return "article";
  return "note";
}

// Context-filled argv rows: complete argv (never auto-filled on a plain row
// run), each naming the entry it fills. Only rows whose entry exists in the
// catalog are returned.
function cmSheetContextRows(catalog, context) {
  const byId = new Map();
  for (const entry of ((catalog && catalog.entries) || [])) {
    if (entry && entry.id) byId.set(entry.id, entry);
  }
  const rows = [];
  const fill = (entryId, userArgs, tagline) => {
    const entry = byId.get(entryId);
    if (!entry) return;
    rows.push({
      key: "ctx:" + entryId + ":" + JSON.stringify(userArgs),
      kind: "entry",
      context: true,
      subkind: cmSheetEntryKind(entry),
      icon: cmSheetEntryKind(entry),
      path: [...entry.path],
      basePath: [...entry.path],
      fixed: (entry.fixed || []).map(String),
      aliases: [],
      title: entry.title || entryId,
      about: tagline || (entry.about || "").split("\n")[0],
      tagline: tagline || null,
      keywords: Array.isArray(entry.keywords) ? [...entry.keywords] : [],
      effect: cmNormalizeEffect(entry.effect),
      presentation: cmNormalizePresentation(entry.presentation),
      policy: cmNormalizePolicy(entry.policy),
      hasPreview: Array.isArray(entry.preview) && entry.preview.length > 0,
      confirm: entry.policy === "confirm" ? String(entry.confirm || "") : null,
      required: cmRequiredPositionals(entry),
      entryId,
      userArgs: [...userArgs],
      section: "context",
      unavailable: null,
    });
  };
  const note = context && context.notePath;
  const kind = (context && context.noteKind) || null;
  if (note) {
    if (kind === "ref") {
      fill("ref-today", [note], "Pull into today's Pomodoro");
      fill("ref-show", [note], "Show this reference");
      fill("ref-rename", [note], "Rename this reference");
    } else if (kind === "area" || kind === "project") {
      fill("ready", [note], "Ready lane for this note");
    } else if (kind === "article") {
      fill("articles-outline", [note], "Outline this article");
    }
    fill("ref-create", [note], "Snapshot note to Highlights");
  }
  const url = context && context.clipboardUrl;
  if (url && cmSheetIsHttpUrl(url)) {
    fill("ref-queue", [url], "Queue link for reading");
    fill("ref-create", [url], "Create reference now");
    fill("ref-find", [url], "Is this in my library?");
  }
  return rows;
}

// Every row the sheet can show, in catalog order: entries, then surface rows,
// then the three plain rows. Context rows are separate (they head the empty
// query) but join the ranked pool once the user types.
function cmBuildSheetRows(catalog, options = {}) {
  const host = options.host || null;
  const rows = [
    ...cmSheetEntryRows(catalog, host),
    ...cmSheetSurfaceRows(options.surfaceAvailable),
    ...cmSheetPlainRows(),
  ];
  if (options.context) rows.push(...cmSheetContextRows(catalog, options.context));
  return rows;
}

// Empty-query sections in sheet order: RECENT, FOR THIS NOTE, FROM CLIPBOARD,
// then one per catalog section in catalog order.
function cmGroupSheetRows(rows, catalog, context) {
  const groups = [];
  const recent = (rows || []).filter((row) => row && row.kind === "recent");
  if (recent.length) groups.push({ id: "recent", title: "RECENT", rows: recent });
  const noteRows = (rows || []).filter((row) => row && row.context && row.section === "context" && row.userArgs &&
    !(context && context.clipboardUrl && row.userArgs.includes(context.clipboardUrl)));
  if (noteRows.length) {
    const label = context && context.notePath ? "FOR THIS NOTE · " + context.notePath : "FOR THIS NOTE";
    groups.push({ id: "context", title: label, rows: noteRows });
  }
  const clipRows = (rows || []).filter((row) => row && row.context && !noteRows.includes(row));
  if (clipRows.length) {
    const label = context && context.clipboardUrl ? "FROM CLIPBOARD · " + context.clipboardUrl : "FROM CLIPBOARD";
    groups.push({ id: "clipboard", title: label, rows: clipRows });
  }
  const rest = (rows || []).filter((row) => row && row.kind !== "recent" && !row.context);
  const sections = (catalog && Array.isArray(catalog.sections) && catalog.sections) || [];
  const seen = new Set();
  for (const section of sections) {
    if (!section || !section.id) continue;
    seen.add(section.id);
    const sectionRows = rest.filter((row) => (row.section || "daily") === section.id);
    if (sectionRows.length) groups.push({ id: section.id, title: String(section.title || section.id).toUpperCase(), rows: sectionRows });
  }
  const homeless = rest.filter((row) => !seen.has(row.section || "daily"));
  if (homeless.length) groups.push({ id: "more", title: "MORE", rows: homeless });
  return groups;
}

// Footer hint bar per stage.
function cmSheetFooterHints(stage) {
  if (stage === "confirm") return "⌃↵ run · esc back";
  if (stage === "output") return "r rerun · y copy · [ ] history · : list · esc back · q close";
  return "⌃N/⌃P select · ↵ run · ⌃M mark · ⇥ args · ⇧↵ preview · ⌃↵ run now · ? help · :: vim · esc close";
}

// List-stage key intent. `args` and `vim` stages belong to the args-vim phase;
// this maps only what the sheet owns and reports `unhandled` for the rest.
function cmSheetListAction(event, state = {}) {
  if (!event || typeof event.key !== "string") return { type: "none" };
  const key = event.key;
  const ctrl = Boolean(event.ctrlKey);
  const shift = Boolean(event.shiftKey);
  const meta = Boolean(event.metaKey);
  if (meta) return { type: "none" };
  if (key === "Escape") return { type: "close" };
  if (key === "Enter" && ctrl && !shift) return { type: "run-now" };
  if (key === "Enter" && shift && !ctrl) return { type: "preview" };
  if (key === "Enter" && !ctrl && !shift) return { type: "run" };
  if (key === "Tab" && !ctrl) return { type: "args" };
  if ((key === "ArrowDown" || (ctrl && key === "n")) && !shift) return { type: "down" };
  if ((key === "ArrowUp" || (ctrl && key === "p")) && !shift) return { type: "up" };
  if (key === "?" && !ctrl && String((state.query || "")).endsWith("?")) return { type: "help" };
  if (key === "Backspace" && !ctrl && !String(state.query || "").length) return { type: "close" };
  return { type: "none" };
}

// Help argv for a `?` run: `bob <path> --help` for the selected row, or bare
// `bob --help` with no selection.
function cmSheetHelpArgv(selectedRow) {
  if (selectedRow && Array.isArray(selectedRow.basePath) && selectedRow.basePath.length) {
    return [...selectedRow.basePath, "--help"];
  }
  return ["--help"];
}
