// --- Dashboard collections (dashboardCollections namespace v1) ------------
// Live PROJECTS / REFERENCES badges for the Dashboard Browse row. Counts
// mirror the pinned default Base views (`projects.base#Active & Waiting`
// and `refs.base#Reading Queue`) without a general Bases interpreter:
// the Base contracts below are validated together with the membership
// predicates, and any membership-affecting drift marks that collection
// unavailable rather than advertising a stale count. All pure helpers
// are unit-testable without Obsidian.

const DASHBOARD_COLLECTIONS_VERSION = 1;
const DASHBOARD_COLLECTION_PROJECTS_VIEW = "🚀 Active & Waiting";
const DASHBOARD_COLLECTION_REFERENCES_VIEW = "🔖 Reading Queue";
const DASHBOARD_COLLECTION_PROJECTS_DEST = "dash_projects";
const DASHBOARD_COLLECTION_REFERENCES_DEST = "dash_references";
const DASHBOARD_COLLECTION_PROJECTS_LABEL = "PROJECTS";
const DASHBOARD_COLLECTION_REFERENCES_LABEL = "REFERENCES";
const DASHBOARD_COLLECTION_ARROW = "↗";

function dashboardCollectionStripQuotes(value) {
  try {
    let text = String(value === null || value === undefined ? "" : value).trim();
    if (text.length >= 2) {
      const first = text[0];
      const last = text[text.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        text = text.slice(1, -1).trim();
      }
    }
    return text;
  } catch (error) {
    return "";
  }
}

function dashboardCollectionLinkTarget(value) {
  try {
    const stripped = dashboardCollectionStripQuotes(value);
    if (!stripped) {
      return "";
    }
    const m = stripped.match(/^\[\[(.+?)\]\]$/);
    let inner = m ? m[1] : stripped;
    inner = String(inner || "").trim();
    if (!inner) {
      return "";
    }
    const pipeAt = inner.indexOf("|");
    if (pipeAt !== -1) {
      inner = inner.slice(0, pipeAt).trim();
    }
    const hashAt = inner.indexOf("#");
    if (hashAt !== -1) {
      inner = inner.slice(0, hashAt).trim();
    }
    return inner;
  } catch (error) {
    return "";
  }
}

// Obsidian Bases `containsAny` semantics: a scalar string uses substring
// matching while a list matches list elements exactly. Anything else
// (missing, number, object) never matches.
function dashboardCollectionStatusContainsAny(statusRaw, needles) {
  try {
    const wants = Array.isArray(needles) ? needles : [];
    if (typeof statusRaw === "string") {
      for (const needle of wants) {
        if (typeof needle === "string" && needle && statusRaw.indexOf(needle) !== -1) {
          return true;
        }
      }
      return false;
    }
    if (Array.isArray(statusRaw)) {
      for (const item of statusRaw) {
        if (typeof item !== "string") {
          continue;
        }
        for (const needle of wants) {
          if (item === needle) {
            return true;
          }
        }
      }
      return false;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function dashboardCollectionPathInTemplates(path) {
  try {
    const parts = String(path || "").split("/");
    for (const part of parts.slice(0, -1)) {
      if (part === "_templates") {
        return true;
      }
    }
    // A root-level `_templates.md` is not a folder match.
    return false;
  } catch (error) {
    return false;
  }
}

// A project note: scalar type link resolving to `project.md` (alias and
// path spellings resolve through the caller-supplied resolver), outside
// any `_templates/` folder, with active/waiting status. A list type or an
// unresolvable type never counts: never widened into link equality.
function dashboardCollectionIsProjectMember(note, resolver) {
  try {
    if (!note || typeof note !== "object") {
      return false;
    }
    const path = typeof note.path === "string" ? note.path : "";
    if (!path || !/\.md$/.test(path)) {
      return false;
    }
    if (dashboardCollectionPathInTemplates(path)) {
      return false;
    }
    const frontmatter =
      note.frontmatter && typeof note.frontmatter === "object" && !Array.isArray(note.frontmatter)
        ? note.frontmatter
        : null;
    if (!frontmatter) {
      return false;
    }
    const typeRaw = frontmatter.type;
    if (typeof typeRaw !== "string") {
      return false;
    }
    const target = dashboardCollectionLinkTarget(typeRaw);
    if (!target) {
      return false;
    }
    let destPath = null;
    try {
      if (typeof resolver === "function") {
        const dest = resolver(target, path);
        if (dest && typeof dest.path === "string") {
          destPath = dest.path;
        } else if (typeof dest === "string") {
          destPath = dest;
        }
      }
    } catch (error) {
      destPath = null;
    }
    if (!destPath) {
      // Fallback for pure unit tests without an Obsidian resolver: an
      // exact `project` / `project.md` target counts. Live code always
      // supplies the resolver above, so this never widens vault reads.
      const lowered = target.toLowerCase();
      if (lowered !== "project" && lowered !== "project.md") {
        return false;
      }
    } else if (destPath !== "project.md") {
      return false;
    }
    return dashboardCollectionStatusContainsAny(frontmatter.status, ["wip", "waiting"]);
  } catch (error) {
    return false;
  }
}

// A reference note: exact `ref/` prefix, Markdown extension, scalar status
// exactly `next`, `wip`, or `ready` (case-sensitive). Lists never count,
// PDFs/`lib/` files, `ref.md`, and similarly named folders never count,
// and no task-only Today/hide/freshness/schedule filters apply.
function dashboardCollectionIsReferenceMember(note) {
  try {
    if (!note || typeof note !== "object") {
      return false;
    }
    const path = typeof note.path === "string" ? note.path : "";
    if (!path || path.indexOf("ref/") !== 0) {
      return false;
    }
    if (!/\.md$/.test(path)) {
      return false;
    }
    const frontmatter =
      note.frontmatter && typeof note.frontmatter === "object" && !Array.isArray(note.frontmatter)
        ? note.frontmatter
        : null;
    if (!frontmatter) {
      return false;
    }
    const status = frontmatter.status;
    return status === "next" || status === "wip" || status === "ready";
  } catch (error) {
    return false;
  }
}

function dashboardCollectionNormalizeFilterText(text) {
  try {
    return String(text === null || text === undefined ? "" : text)
      .replace(/'/g, '"')
      .replace(/\s+/g, "")
      .trim();
  } catch (error) {
    return "";
  }
}

function dashboardCollectionFilterList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function dashboardCollectionFindView(parsed, name) {
  try {
    const views = parsed && Array.isArray(parsed.views) ? parsed.views : [];
    for (const view of views) {
      if (view && view.name === name) {
        return view;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function dashboardCollectionHasLimit(node) {
  try {
    if (!node || typeof node !== "object") {
      return false;
    }
    for (const key of ["limit", "pagination", "maxResults", "take"]) {
      if (node[key] !== undefined && node[key] !== null) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Validate the membership-affecting structure of `projects.base`:
// global `note.type == link("project")` plus `_templates` exclusion, and
// the `Active & Waiting` view's `status.containsAny("wip","waiting")`.
// Presentation-only keys (formulas, columns, grouping, sorting) are
// ignored. Any result limit, extra global filter, or renamed view fails
// closed so the badge shows unavailable instead of a stale count.
function dashboardCollectionValidateProjectsBase(parsed) {
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "projects.base is unreadable" };
    }
    if (dashboardCollectionHasLimit(parsed)) {
      return { ok: false, reason: "projects.base has a result limit" };
    }
    const filters = parsed.filters && typeof parsed.filters === "object" ? parsed.filters : null;
    const globalAnd = filters ? dashboardCollectionFilterList(filters.and) : [];
    if (!filters || !Array.isArray(filters.and) || globalAnd.length !== 2) {
      return { ok: false, reason: "projects.base global filters changed" };
    }
    const normalized = new Set(globalAnd.map(dashboardCollectionNormalizeFilterText));
    const wantA = dashboardCollectionNormalizeFilterText('note.type == link("project")');
    const wantB = dashboardCollectionNormalizeFilterText('file.inFolder("_templates") == false');
    if (!normalized.has(wantA) || !normalized.has(wantB) || normalized.size !== 2) {
      return { ok: false, reason: "projects.base global filters changed" };
    }
    const view = dashboardCollectionFindView(parsed, DASHBOARD_COLLECTION_PROJECTS_VIEW);
    if (!view) {
      return { ok: false, reason: "projects.base Active & Waiting view is missing" };
    }
    if (dashboardCollectionHasLimit(view)) {
      return { ok: false, reason: "projects.base Active & Waiting view has a result limit" };
    }
    const viewFilters = view.filters && typeof view.filters === "object" ? view.filters : null;
    const viewAnd = viewFilters ? dashboardCollectionFilterList(viewFilters.and) : [];
    if (!viewFilters || !Array.isArray(viewFilters.and) || viewAnd.length !== 1) {
      return { ok: false, reason: "projects.base Active & Waiting filters changed" };
    }
    const wantView = dashboardCollectionNormalizeFilterText('status.containsAny("wip", "waiting")');
    if (dashboardCollectionNormalizeFilterText(viewAnd[0]) !== wantView) {
      return { ok: false, reason: "projects.base Active & Waiting filters changed" };
    }
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: "projects.base is unreadable" };
  }
}

// Validate the membership-affecting structure of `refs.base`: global
// `ref/` prefix plus Markdown extension, and the Reading Queue view's
// exact `next`/`wip`/`ready` disjunction. Same fail-closed policy.
function dashboardCollectionValidateRefsBase(parsed) {
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "refs.base is unreadable" };
    }
    if (dashboardCollectionHasLimit(parsed)) {
      return { ok: false, reason: "refs.base has a result limit" };
    }
    const filters = parsed.filters && typeof parsed.filters === "object" ? parsed.filters : null;
    const globalAnd = filters ? dashboardCollectionFilterList(filters.and) : [];
    if (!filters || !Array.isArray(filters.and) || globalAnd.length !== 2) {
      return { ok: false, reason: "refs.base global filters changed" };
    }
    const normalized = new Set(globalAnd.map(dashboardCollectionNormalizeFilterText));
    const wantA = dashboardCollectionNormalizeFilterText('file.path.startsWith("ref/")');
    const wantB = dashboardCollectionNormalizeFilterText('file.ext == "md"');
    if (!normalized.has(wantA) || !normalized.has(wantB) || normalized.size !== 2) {
      return { ok: false, reason: "refs.base global filters changed" };
    }
    const view = dashboardCollectionFindView(parsed, DASHBOARD_COLLECTION_REFERENCES_VIEW);
    if (!view) {
      return { ok: false, reason: "refs.base Reading Queue view is missing" };
    }
    if (dashboardCollectionHasLimit(view)) {
      return { ok: false, reason: "refs.base Reading Queue view has a result limit" };
    }
    const viewFilters = view.filters && typeof view.filters === "object" ? view.filters : null;
    const viewOr = viewFilters ? dashboardCollectionFilterList(viewFilters.or) : [];
    if (!viewFilters || !Array.isArray(viewFilters.or) || viewOr.length !== 3) {
      return { ok: false, reason: "refs.base Reading Queue filters changed" };
    }
    const normalizedOr = new Set(viewOr.map(dashboardCollectionNormalizeFilterText));
    const wantNext = dashboardCollectionNormalizeFilterText('status == "next"');
    const wantWip = dashboardCollectionNormalizeFilterText('status == "wip"');
    const wantReady = dashboardCollectionNormalizeFilterText('status == "ready"');
    if (!normalizedOr.has(wantNext) || !normalizedOr.has(wantWip) || !normalizedOr.has(wantReady) || normalizedOr.size !== 3) {
      return { ok: false, reason: "refs.base Reading Queue filters changed" };
    }
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: "refs.base is unreadable" };
  }
}

function dashboardCollectionEntryFor(kind, count, available, reason) {
  const isProjects = kind === "projects";
  const label = isProjects ? DASHBOARD_COLLECTION_PROJECTS_LABEL : DASHBOARD_COLLECTION_REFERENCES_LABEL;
  const destination = isProjects ? DASHBOARD_COLLECTION_PROJECTS_DEST : DASHBOARD_COLLECTION_REFERENCES_DEST;
  const view = isProjects ? DASHBOARD_COLLECTION_PROJECTS_VIEW : DASHBOARD_COLLECTION_REFERENCES_VIEW;
  const unit = isProjects ? "projects" : "references";
  if (available === true && Number.isInteger(count) && count >= 0) {
    const tooltip = isProjects
      ? `${count} projects in Active & Waiting. Open Projects.`
      : `${count} references in Reading Queue (next, wip, ready). Open References.`;
    return {
      kind: isProjects ? "projects" : "references",
      label,
      count,
      available: true,
      reason: null,
      destination,
      view,
      unit,
      valueText: String(count),
      tooltip,
      aria: tooltip,
      placeholder: false,
      over: false,
    };
  }
  const short = reason ? String(reason) : "unavailable";
  const tooltip = isProjects
    ? `PROJECTS – ${short}. Open Projects.`
    : `REFERENCES – ${short}. Open References.`;
  const aria = isProjects
    ? `PROJECTS unavailable (${short}). Open Projects.`
    : `REFERENCES unavailable (${short}). Open References.`;
  return {
    kind: isProjects ? "projects" : "references",
    label,
    count: null,
    available: false,
    reason: short,
    destination,
    view,
    unit,
    valueText: "–",
    tooltip,
    aria,
    placeholder: true,
    over: false,
  };
}

function dashboardCollectionChipModel(kind, entry) {
  try {
    const normalized = kind === "references" ? "references" : "projects";
    const safe =
      entry && typeof entry === "object"
        ? entry
        : dashboardCollectionEntryFor(normalized, null, false, "unavailable");
    return {
      kind: normalized,
      label: normalized === "projects" ? DASHBOARD_COLLECTION_PROJECTS_LABEL : DASHBOARD_COLLECTION_REFERENCES_LABEL,
      valueText: typeof safe.valueText === "string" ? safe.valueText : "–",
      tooltip: typeof safe.tooltip === "string" ? safe.tooltip : "Unavailable",
      aria: typeof safe.aria === "string" ? safe.aria : "Unavailable",
      destination: typeof safe.destination === "string" ? safe.destination : normalized === "projects" ? DASHBOARD_COLLECTION_PROJECTS_DEST : DASHBOARD_COLLECTION_REFERENCES_DEST,
      placeholder: safe.placeholder === true || safe.available === false,
    };
  } catch (error) {
    const normalized = kind === "references" ? "references" : "projects";
    const fallback = dashboardCollectionEntryFor(normalized, null, false, "unavailable");
    return {
      kind: normalized,
      label: fallback.label,
      valueText: "–",
      tooltip: fallback.tooltip,
      aria: fallback.aria,
      destination: fallback.destination,
      placeholder: true,
    };
  }
}

// --- Per-note Ready cap views (ledger-views) ---------------------------
// Pure view models for the dash CROWDED chip, the `bob-ready-notes`
// ranked-bar block, and the `## Tasks` heading chip. All take plain
// snapshot/entry data so they are unit-testable without Obsidian.

const NOTE_READY_CROWDED_LABEL = "CROWDED";
const NOTE_READY_CROWDED_ARROW = "↗";
// First `## Tasks` heading only: up to 3 leading spaces, exactly two
// `#`, at least one space/tab, then `Tasks` case-insensitive with an
// optional trailing run. `### Tasks` never matches (the third `#` is
// not a space); fences are tracked by the line walker below.
const NOTE_READY_TASKS_HEADING_RE = /^ {0,3}##[ \t]+Tasks(?:[ \t].*)?$/i;
const NOTE_READY_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const NOTE_READY_BAR_MAX = 30;
const NOTE_READY_REMEDIES = "split, sequence, defer, or drop";

function noteReadyCapSourceLabel(source) {
  if (source === "note") {
    return "this note";
  }
  if (source === "config") {
    return "Bob config";
  }
  if (source === "preview") {
    return "preview";
  }
  return "default";
}

function noteReadyCrowdedChipModel(snapshot) {
  try {
    if (!snapshot || snapshot.available !== true) {
      return {
        available: false,
        crowded: 0,
        full: 0,
        excess: 0,
        label: NOTE_READY_CROWDED_LABEL,
        valueText: "–",
        over: false,
        calm: false,
        placeholder: true,
        tooltip: "CROWDED unavailable",
        aria: "CROWDED: unavailable",
      };
    }
    const totals = snapshot.totals || {};
    const crowded = Number.isInteger(totals.crowded) ? totals.crowded : 0;
    const full = Number.isInteger(totals.full) ? totals.full : 0;
    const excess = Number.isInteger(totals.excess) ? totals.excess : 0;
    const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
    const crowdedNotes = notes.filter(
      (entry) => entry && entry.state === "crowded",
    );
    const named = crowdedNotes
      .slice(0, 5)
      .map((entry) => `${entry.name} ${entry.count}/${entry.cap}`);
    const more = crowdedNotes.length > 5 ? ", …" : "";
    const list = named.length > 0 ? `: ${named.join(", ")}${more}` : "";
    const noun = crowded === 1 ? "note" : "notes";
    const tooltip =
      crowded > 0
        ? `${crowded} ${noun} over their ready cap${list} · ${full} full · ${excess} over. Open Crowded Notes.`
        : `No notes over their ready cap · ${full} full. Open Crowded Notes.`;
    return {
      available: true,
      crowded,
      full,
      excess,
      label: NOTE_READY_CROWDED_LABEL,
      valueText: crowded > 0 ? String(crowded) : "0 ✓",
      over: crowded > 0,
      calm: crowded === 0,
      placeholder: false,
      tooltip,
      aria: tooltip,
    };
  } catch (error) {
    return {
      available: false,
      crowded: 0,
      full: 0,
      excess: 0,
      label: NOTE_READY_CROWDED_LABEL,
      valueText: "–",
      over: false,
      calm: false,
      placeholder: true,
      tooltip: "CROWDED unavailable",
      aria: "CROWDED: unavailable",
    };
  }
}

function noteReadyBarModel(count, cap, max = NOTE_READY_BAR_MAX) {
  const safeMax = Number.isInteger(max) && max > 0 ? max : NOTE_READY_BAR_MAX;
  const safeCount = Number.isInteger(count) && count >= 0 ? count : 0;
  const safeCap =
    Number.isInteger(cap) && cap > 0 ? cap : NOTE_READY_DEFAULT_CAP;
  const total = Math.min(safeMax, Math.max(safeCap, safeCount));
  return {
    total,
    filled: Math.min(safeCount, total),
    capAt: Math.min(safeCap, total),
    overflow: Math.max(0, safeCount - safeCap),
    over: safeCount > safeCap,
  };
}

function noteReadyFindTasksHeadingLine(text) {
  try {
    const lines = String(text === null || text === undefined ? "" : text).split(
      "\n",
    );
    let inFence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (NOTE_READY_FENCE_RE.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        continue;
      }
      if (NOTE_READY_TASKS_HEADING_RE.test(line)) {
        return index;
      }
    }
    return -1;
  } catch (error) {
    return -1;
  }
}

function noteReadyHeadingChipModel(entry, options = {}) {
  try {
    const invalid = Boolean(options.invalid);
    const mobileDefault = Boolean(options.mobileDefault);
    if (!entry || typeof entry !== "object") {
      return {
        available: false,
        text: "ready –",
        tooltip: "ready count unavailable",
        aria: "ready count: unavailable",
        over: false,
        placeholder: true,
        exempt: false,
        key: "unavailable",
      };
    }
    const count = Number.isInteger(entry.count) ? entry.count : 0;
    const cap = Number.isInteger(entry.cap) ? entry.cap : null;
    const makeUp =
      entry.make_up && typeof entry.make_up === "object"
        ? entry.make_up
        : null;
    const remedies = NOTE_READY_REMEDIES;
    if (entry.state === "exempt") {
      const tooltip =
        `${count} ready-lane tasks · no cap (ready_cap: off) · ${remedies}` +
        (mobileDefault ? " · default cap on mobile" : "");
      return {
        available: true,
        text: `ready ${count} · no cap`,
        tooltip,
        aria: tooltip,
        over: false,
        placeholder: false,
        exempt: true,
        key: `exempt:${count}`,
      };
    }
    const capText = cap === null ? "–" : String(cap);
    const sourceLabel = noteReadyCapSourceLabel(entry.cap_source);
    let lane = "";
    if (makeUp) {
      const ready = Number.isInteger(makeUp.ready) ? makeUp.ready : 0;
      const fresh = Number.isInteger(makeUp.new) ? makeUp.new : 0;
      const rotten = Number.isInteger(makeUp.rotten) ? makeUp.rotten : 0;
      lane = `${count} ready-lane tasks = ${ready} ready + ${fresh} new + ${rotten} rotten`;
    } else {
      lane = `${count} ready-lane tasks`;
    }
    const overText =
      entry.state === "crowded" && Number.isInteger(entry.over_by)
        ? ` · ${entry.over_by} over`
        : "";
    let tooltip = `${lane} · cap ${capText} (${sourceLabel})${overText} · ${remedies}`;
    if (invalid) {
      tooltip += ` · ready_cap invalid, using ${capText}`;
    }
    if (mobileDefault) {
      tooltip += " · default cap on mobile";
    }
    if (entry.state === "crowded") {
      const text = `ready ${count}/${capText} · +${entry.over_by}`;
      return {
        available: true,
        text,
        tooltip,
        aria: tooltip,
        over: true,
        placeholder: false,
        exempt: false,
        key: `crowded:${count}/${capText}`,
      };
    }
    if (entry.state === "full") {
      const text = `ready ${count}/${capText} · full`;
      return {
        available: true,
        text,
        tooltip,
        aria: tooltip,
        over: false,
        placeholder: false,
        exempt: false,
        key: `full:${count}/${capText}`,
      };
    }
    const text = `ready ${count}/${capText}`;
    return {
      available: true,
      text,
      tooltip,
      aria: tooltip,
      over: false,
      placeholder: false,
      exempt: false,
      key: `${entry.state}:${count}/${capText}`,
    };
  } catch (error) {
    return {
      available: false,
      text: "ready –",
      tooltip: "ready count unavailable",
      aria: "ready count: unavailable",
      over: false,
      placeholder: true,
      exempt: false,
      key: "unavailable",
    };
  }
}

function noteReadyReadyNotesSummary(snapshot) {
  try {
    if (!snapshot || snapshot.available !== true) {
      return "CROWDED –";
    }
    const totals = snapshot.totals || {};
    const crowded = Number.isInteger(totals.crowded) ? totals.crowded : 0;
    if (crowded === 0) {
      return "CROWDED 0 ✓ · every note has room";
    }
    const full = Number.isInteger(totals.full) ? totals.full : 0;
    const excess = Number.isInteger(totals.excess) ? totals.excess : 0;
    const notes = Number.isInteger(totals.notes) ? totals.notes : 0;
    return `CROWDED ${crowded} · ${excess} over · ${full} full · ${notes} notes`;
  } catch (error) {
    return "CROWDED –";
  }
}

function noteReadyEscapeHtml(text) {
  return String(text === null || text === undefined ? "" : text).replace(
    /[&<>"']/g,
    (ch) => {
      if (ch === "&") {
        return "&amp;";
      }
      if (ch === "<") {
        return "&lt;";
      }
      if (ch === ">") {
        return "&gt;";
      }
      if (ch === '"') {
        return "&quot;";
      }
      return "&#39;";
    },
  );
}

// --- Plan block model -----------------------------------------------------

function planBlockTargetPath(app, sourcePath) {
  if (sourcePath && PLAN_DAILY_PATH_RE.test(String(sourcePath))) {
    return String(sourcePath);
  }
  return todayDailyPath(new Date(), getDailyNotesOptions(app));
}

function planBlockTasks(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const tasks = plugins && plugins[PLAN_TASKS_PLUGIN_ID];
    if (tasks && typeof tasks.getTasks === "function") {
      const all = tasks.getTasks();
      return Array.isArray(all) ? all : null;
    }
  } catch (error) {
    // The Tasks plugin is optional; the block shows `–` without it.
  }
  return null;
}

// Daily NEXT/PENDING presentation uses the dashboard section budget.
// A supplied budget (including unavailable nulls) is used as-is and
// never replaced with an ungated whole-lane fallback. Standalone
// callers without a prepared budget compute the same section through
// dashboardLaneBudgetFromTasks when Tasks data is present.
function unavailablePlanDashboardBudget(effective, lane) {
  return {
    section: null,
    lane: null,
    count: null,
    laneCount: null,
    cap: lane === "next" ? effective.maxNext : effective.maxPending,
    over: false,
    today: null,
  };
}

function resolvePlanDashboardBudget(
  supplied,
  taskList,
  day,
  effective,
  lane,
  isTodayPredicate,
  hasTasks,
) {
  if (supplied !== undefined) {
    if (!supplied || typeof supplied !== "object") {
      return unavailablePlanDashboardBudget(effective, lane);
    }
    return supplied;
  }
  if (!hasTasks) {
    return unavailablePlanDashboardBudget(effective, lane);
  }
  try {
    return dashboardLaneBudgetFromTasks(
      taskList,
      day,
      effective,
      lane,
      isTodayPredicate,
    );
  } catch (error) {
    return unavailablePlanDashboardBudget(effective, lane);
  }
}

// Synchronous view-model for the ```bob-plan block. Never throws: missing
// content, caps, or Tasks all degrade to `–` placeholders, never an error.
// `isToday` is the caller's Today predicate over cached Tasks tasks
// (the plugin passes its synchronous cache); it still feeds READY.
// READY is the shared live current backlog (Today excluded); it never
// changes what the ledger's PLAN status means.
// Daily NEXT/PENDING badges follow dashboard section counts. Whole-lane
// `next`/`pending` remain for cap lints. Optional `nextDashboard` /
// `pendingDashboard` are prepared guarded budgets from the paint path.
function planBlockModel({
  content,
  tasks,
  today,
  caps,
  sourcePath,
  app,
  isToday,
  isReviewBucket,
  review,
  nextDashboard,
  pendingDashboard,
}) {
  const effective = effectivePlanCaps(caps);
  const targetPath = planBlockTargetPath(app, sourcePath);
  let budget;
  try {
    budget =
      typeof content === "string"
        ? computePlanBudget(content, effective, targetPath)
        : emptyPlanBudget(effective);
  } catch (error) {
    budget = emptyPlanBudget(effective);
  }
  const hasTasks = Array.isArray(tasks);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const taskList = hasTasks ? tasks : [];
  const day = today === undefined ? new Date() : today;
  let next;
  let pending;
  try {
    next = laneBudgetFromTasks(taskList, day, effective, "next");
  } catch (error) {
    next = { count: 0, cap: effective.maxNext, over: false };
  }
  try {
    pending = laneBudgetFromTasks(taskList, day, effective, "pending");
  } catch (error) {
    pending = { count: 0, cap: effective.maxPending, over: false };
  }
  const nextDash = resolvePlanDashboardBudget(
    nextDashboard,
    taskList,
    day,
    effective,
    "next",
    isTodayPredicate,
    hasTasks,
  );
  const pendingDash = resolvePlanDashboardBudget(
    pendingDashboard,
    taskList,
    day,
    effective,
    "pending",
    isTodayPredicate,
    hasTasks,
  );
  const nextModel = dashboardLaneBadgeModel(nextDash, "next");
  const pendingModel = dashboardLaneBadgeModel(pendingDash, "pending");
  let ready = null;
  if (hasTasks) {
    try {
      ready = readyBudgetFromTasks(
        taskList,
        day,
        effective,
        isTodayPredicate,
        isReviewBucket,
      );
    } catch (error) {
      ready = null;
    }
  }
  // Ledger PLAN status stays independent of lane pressure. READY over
  // still flags the aggregate `over` for existing READY tests; the
  // accessible summary uses the ledger status for "over plan".
  const over =
    budget.status === "over" || (hasTasks && ready && ready.over);
  const lintWarnings = budget.warnings.slice();
  if (hasTasks && next.over) {
    lintWarnings.push({
      code: PLAN_LINT_NEXT_CAP,
      message: `NEXT whole lane has ${next.count}/${next.cap} tasks (including TODAY); release some with Alt+N`,
    });
  }
  if (hasTasks && pending.over) {
    lintWarnings.push({
      code: PLAN_LINT_PENDING_CAP,
      message: `PENDING whole lane has ${pending.count}/${pending.cap} tasks (including TODAY); release some with Alt+N`,
    });
  }
  if (
    hasTasks &&
    ready &&
    Number.isInteger(ready.count) &&
    ready.over
  ) {
    lintWarnings.push({
      code: PLAN_LINT_READY_CAP,
      message: `READY has ${ready.count}/${ready.cap} tasks; prune at the weekly review`,
    });
  }
  const themeCounts = budget.entries
    .filter((entry) => !entry.exempt)
    .map((entry) => `${entry.name} ${entry.links}`);
  // Total lane pressure for the gated READY tooltip: the gated
  // count plus the NEW and ROTTEN buckets behind it. Without a review
  // breakdown the badge keeps its legacy tooltip.
  const reviewLane =
    review &&
    Number.isInteger(review.new) &&
    review.new >= 0 &&
    Number.isInteger(review.rotten) &&
    review.rotten >= 0 &&
    ready &&
    Number.isInteger(ready.count) &&
    ready.count >= 0
      ? {
          total: review.new + review.rotten + ready.count,
          new: review.new,
          rotten: review.rotten,
          ready: ready.count,
        }
      : null;
  const readyModel = readyBadgeModel(
    ready
      ? { count: ready.count, cap: ready.cap, over: ready.over }
      : { count: null, cap: effective.maxReady },
    reviewLane ? { lane: reviewLane } : {},
  );
  return {
    targetPath,
    hasContent: typeof content === "string",
    hasTasks,
    planText: budget.hasSection
      ? `TODAY ${budget.themes.count}/${budget.themes.cap} · ${budget.links.count}/${budget.links.cap}`
      : "TODAY –",
    planTitle: budget.hasSection
      ? themeCounts.join(" · ") || "no themes"
      : "no Pomodoros section",
    nextText: nextModel.text,
    pendingText: pendingModel.text,
    readyText: hasTasks ? readyModel.text : "READY –",
    readyModel,
    nextModel,
    pendingModel,
    themesText:
      budget.themeNames.length > 0
        ? `★ ${budget.themeNames.join(" · ")}`
        : "",
    lints: lintWarnings.map((warning) =>
      warning.line === undefined || warning.line === null
        ? `${warning.message}  ${warning.code}`
        : `${warning.message} (line ${warning.line})  ${warning.code}`,
    ),
    over,
    budget,
    next,
    pending,
    nextDashboard: nextDash,
    pendingDashboard: pendingDash,
    ready,
    lane: reviewLane,
  };
}

