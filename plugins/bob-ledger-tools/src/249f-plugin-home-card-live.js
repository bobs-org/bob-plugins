// Report-backed live patch (bob-cli-pl.5 card-live). Pure merge of the
// already-cached areas/projects report states into a local home-card model,
// plus the recognized ^prj goal-line locators for both surfaces.
//
// Never spawns bob and never writes: entry lookup reads the shared indexed
// reports only. A missing or old snapshot hides only the report-backed parts
// (blocked reasons, close dates, open/today readouts, contract lint) and the
// card keeps painting from local data. Terminal projects keep no report
// readouts (decisions:card_structure_counts = no, and the terminal card owns
// no readout row). Sub-area/sub-project counts never appear.
const HOME_CARD_LIVE_MAX_ANCESTOR_HOPS = 8;
const HOME_CARD_LIVE_MAX_REASON_LINKS = 2;
const HOME_CARD_LIVE_GOAL_CLASS = "bob-home-card-goal";

function homeCardLiveText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function homeCardLivePath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

// Fresh shared state only: unavailable, stale, or entry-less reports patch
// nothing. Refresh-in-flight alone does not hide a current report.
function homeCardLiveUsableState(state) {
  if (!state || typeof state !== "object") return null;
  const report = state.report;
  if (!report || typeof report !== "object") return null;
  if (state.stale === true || state.unavailable === true) return null;
  return report;
}

function homeCardLiveEntry(kind, path, states = {}) {
  const key = homeCardLivePath(path);
  if (!key) return null;
  if (kind === "project") {
    const report = homeCardLiveUsableState(states.projects);
    if (!report || !(report.projectsByPath instanceof Map)) return null;
    return report.projectsByPath.get(key)
      || report.projectsByPath.get(key.replace(/\.md$/i, "") + ".md")
      || null;
  }
  if (kind === "area") {
    const report = homeCardLiveUsableState(states.areas);
    if (!report || !(report.areasByPath instanceof Map)) return null;
    return report.areasByPath.get(key)
      || report.areasByPath.get(key.replace(/\.md$/i, "") + ".md")
      || null;
  }
  return null;
}

function homeCardLiveCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// Nearest blocked ancestor by walking the report's parent rows (bounded and
// cycle-safe). The report already marks each inherited row blocked, so the
// first ancestor carrying a blocked reason is the link target. Stale or
// parent-less chains resolve to no ancestor, never an invented one.
function homeCardLiveBlockedAncestor(report, entry) {
  try {
    if (!report || !(report.projectsByPath instanceof Map)) return null;
    const seen = new Set([homeCardLivePath(entry && entry.path).toLowerCase()]);
    let current = entry && typeof entry.parent === "string" ? entry.parent : "";
    for (let hop = 0; hop < HOME_CARD_LIVE_MAX_ANCESTOR_HOPS && current; hop += 1) {
      const key = homeCardLivePath(current);
      if (!key) return null;
      const lowered = key.toLowerCase();
      if (seen.has(lowered)) return null;
      seen.add(lowered);
      const row = report.projectsByPath.get(key)
        || report.projectsByPath.get(key.replace(/\.md$/i, "") + ".md");
      if (!row || typeof row !== "object") return null;
      if (row.blocked && typeof row.blocked === "object" && typeof row.blocked.kind === "string") {
        const stem = homeCardLiveText(row.stem).trim();
        if (!stem) return null;
        return { text: stem, target: key };
      }
      current = typeof row.parent === "string" ? row.parent : "";
    }
  } catch (_) {}
  return null;
}

function homeCardLiveWaitsStem(target) {
  const text = homeCardLiveText(target);
  const note = text.split("#")[0];
  const name = note.split("/").pop().replace(/\.md$/i, "").trim();
  return { note: note.trim(), stem: name || text.trim() };
}

// waits_on rows are task-dependency targets ("note#^block" or "#^block").
// Note-carrying rows become crumb-like links; same-note rows stay text.
function homeCardLiveWaitsLinks(waitsOn) {
  const links = [];
  let extra = 0;
  for (const raw of Array.isArray(waitsOn) ? waitsOn : []) {
    const parsed = homeCardLiveWaitsStem(raw);
    if (!parsed.stem) continue;
    if (links.length < HOME_CARD_LIVE_MAX_REASON_LINKS) {
      links.push(parsed.note
        ? { text: parsed.stem, target: parsed.note }
        : { text: parsed.stem, target: "" });
    } else {
      extra += 1;
    }
  }
  return { links, extra };
}

// Contract issue code to the stable settings-contract id (the same rule
// bob-cli's props show uses to file an issue under a setting). Unknown codes
// file under no setting: the lint chip still counts them but opens nothing.
function homeCardContractSetting(code) {
  const name = homeCardLiveText(code).trim();
  if (!name) return "";
  if (name === "area_summary_multiline" || name === "area_summary_long") return "summary";
  if (name === "area_cycle" || name.indexOf("area_parent") === 0) return "parent";
  if (name === "area_color_invalid") return "color";
  if (name === "type_default_conflict" || name === "note_theme_unconfigured") return "task_type";
  if (name === "note_offclock_shadowed" || name === "note_offclock_invalid") return "clock";
  if (name === "note_ready_cap_invalid") return "ready_cap";
  if (name === "task_refresh_invalid") return "task_refresh";
  return "";
}

function homeCardLiveNormalizeIssues(value) {
  if (!Array.isArray(value)) return [];
  const issues = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const code = homeCardLiveText(row.code).trim();
    const message = homeCardLiveText(row.message).trim();
    if (!code || !message) continue;
    issues.push({
      code,
      severity: homeCardLiveText(row.severity).trim() || "warning",
      message,
      setting: homeCardContractSetting(code),
    });
  }
  return issues;
}

function homeCardLiveDateLabel(iso, today) {
  const parsed = typeof homeCardParseDate === "function" ? homeCardParseDate(iso) : null;
  const clean = parsed || (/^\d{4}-\d{2}-\d{2}$/.test(homeCardLiveText(iso).trim()) ? homeCardLiveText(iso).trim() : "");
  if (!clean) return "";
  if (typeof homeCardDateLabel === "function") {
    try { return homeCardDateLabel(clean, today) || ""; } catch (_) {}
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = Number(clean.slice(0, 4));
  const todayYear = /^\d{4}-\d{2}-\d{2}$/.test(homeCardLiveText(today).trim())
    ? Number(homeCardLiveText(today).trim().slice(0, 4))
    : year;
  const label = `${months[Number(clean.slice(5, 7)) - 1]} ${Number(clean.slice(8, 10))}`;
  return year === todayYear ? label : `${label}, ${year}`;
}

function homeCardLiveToday(kind, entry) {
  if (kind === "project") {
    const tasks = entry && typeof entry.tasks === "object" ? entry.tasks : null;
    return {
      open: tasks ? homeCardLiveCount(tasks.open) : null,
      today: tasks ? homeCardLiveCount(tasks.today) : null,
    };
  }
  if (kind === "area") {
    const today = entry && typeof entry.today === "object" ? entry.today : null;
    return { open: null, today: today ? homeCardLiveCount(today.direct) : null };
  }
  return { open: null, today: null };
}

// The report-backed overlay for one card. Returns null when the snapshot has
// nothing to add, so the host can keep the local model untouched.
function homeCardLivePatch(input = {}) {
  try {
    const kind = input.kind === "project" || input.kind === "area" ? input.kind : "";
    const path = homeCardLivePath(input.path);
    const model = input.model && typeof input.model === "object" ? input.model : null;
    const states = input.states && typeof input.states === "object" ? input.states : {};
    if (!kind || !path || !model) return null;
    const terminal = model.terminal === true;
    const entry = homeCardLiveEntry(kind, path, states);
    if (!entry || typeof entry !== "object") return null;
    const patch = {
      path,
      blocked: null,
      closedOn: "",
      open: null,
      today: null,
      contractIssues: homeCardLiveNormalizeIssues(entry.contract_issues),
      firstSetting: "",
    };
    const lifecycle = model.lifecycle && typeof model.lifecycle === "object" ? model.lifecycle : null;
    const blocked = entry.blocked && typeof entry.blocked === "object" ? entry.blocked : null;
    if (!terminal && kind === "project" && lifecycle && lifecycle.kind === "blocked" && blocked && typeof blocked.kind === "string") {
      if (blocked.kind === "dependency") {
        const waits = homeCardLiveWaitsLinks(blocked.waits_on);
        if (waits.links.length) {
          const names = waits.links.map((link) => link.text).join(", ");
          const tail = waits.extra > 0 ? `+${waits.extra}` : "";
          patch.blocked = {
            kind: "dependency",
            lead: "waits on",
            tail,
            links: waits.links,
            text: `waits on ${names}${tail ? ` ${tail}` : ""}`,
          };
        }
      } else if (blocked.kind === "inherited") {
        const statesReport = homeCardLiveUsableState(states.projects);
        const ancestor = homeCardLiveBlockedAncestor(statesReport, entry);
        if (ancestor) {
          patch.blocked = {
            kind: "inherited",
            lead: "parent project",
            tail: "is blocked",
            links: [ancestor],
            text: `parent project ${ancestor.text} is blocked`,
          };
        }
      }
    }
    if (kind === "project" && lifecycle
      && (lifecycle.kind === "done" || lifecycle.kind === "canceled")
      && !homeCardLiveText(lifecycle.detail).trim()
      && typeof entry.closed_on === "string" && entry.closed_on) {
      const reportToday = states.projects && typeof states.projects.today === "string"
        ? states.projects.today
        : (states.areas && typeof states.areas.today === "string" ? states.areas.today : "");
      patch.closedOn = homeCardLiveDateLabel(entry.closed_on, reportToday);
    }
    // Terminal cards keep no readout row (their calm muted card stays as
    // painted); only an undated terminal detail may fill from closed_on.
    if (!terminal) {
      const counts = homeCardLiveToday(kind, entry);
      patch.open = counts.open;
      patch.today = counts.today;
    }
    for (const issue of patch.contractIssues) {
      if (issue.setting) {
        patch.firstSetting = issue.setting;
        break;
      }
    }
    if (!patch.blocked && !patch.closedOn && patch.open == null && patch.today == null
      && !patch.contractIssues.length) {
      return null;
    }
    return patch;
  } catch (_) {
    return null;
  }
}

// In-place patch semantics on a copied model: blocked reasons become link
// segments on the lifecycle subtitle, a report close date fills an undated
// terminal detail, open/today counts land on the report readout, and contract
// issues ride along for the foot lint. Returns the input model when the
// patch is null so painters can skip the copy.
function homeCardApplyLivePatch(model, patch) {
  if (!model || typeof model !== "object" || !patch || typeof patch !== "object") return model;
  const next = { ...model };
  try {
    if (patch.blocked && next.lifecycle && next.lifecycle.kind === "blocked") {
      const reason = patch.blocked;
      const links = Array.isArray(reason.links) ? reason.links : [];
      const lead = homeCardLiveText(reason.lead).trim()
        || (reason.kind === "inherited" ? "parent project" : "waits on");
      const tail = homeCardLiveText(reason.tail).trim();
      const text = homeCardLiveText(reason.text).trim()
        || [lead, links.map((link) => link.text).join(", "), tail].filter(Boolean).join(" ");
      const subtitle = next.subtitle && typeof next.subtitle === "object" ? { ...next.subtitle } : {};
      next.subtitle = {
        ...subtitle,
        kind: "lifecycle",
        text: `${(next.lifecycle && next.lifecycle.word) || "BLOCKED"} · ${text}`,
        word: (next.lifecycle && next.lifecycle.word) || "BLOCKED",
        detail: `· ${text}`,
        tooltip: `${(next.lifecycle && next.lifecycle.word) || "BLOCKED"} · ${text}`,
        icon: (next.lifecycle && next.lifecycle.icon) || "unplug",
        tone: (next.lifecycle && next.lifecycle.tone) || "blocked",
        pending: false,
        reason: { lead, links: links.map((link) => ({ text: link.text, target: link.target || "" })), tail },
      };
      next.lifecycle = { ...next.lifecycle, reason: next.subtitle.reason };
    }
    if (patch.closedOn && next.lifecycle
      && (next.lifecycle.kind === "done" || next.lifecycle.kind === "canceled")
      && !homeCardLiveText(next.lifecycle.detail).trim()) {
      const word = next.lifecycle.word || (next.lifecycle.kind === "done" ? "DONE" : "CANCELED");
      next.lifecycle = { ...next.lifecycle, detail: patch.closedOn };
      if (next.subtitle && typeof next.subtitle === "object" && next.subtitle.kind === "lifecycle") {
        next.subtitle = {
          ...next.subtitle,
          text: `${word} · ${patch.closedOn}`,
          word,
          detail: patch.closedOn,
          tooltip: `${word} · ${patch.closedOn}`,
        };
      }
    }
    if (patch.open != null || patch.today != null) {
      next.report = {
        ...(next.report && typeof next.report === "object" ? next.report : {}),
        kind: next.kind,
        open: patch.open,
        today: patch.today,
      };
    }
    if (Array.isArray(patch.contractIssues)) {
      next.contract = {
        issues: patch.contractIssues.map((issue) => ({ ...issue })),
        firstSetting: patch.firstSetting || "",
      };
    }
  } catch (_) {}
  return next;
}

// Live Preview locator: the exact 1-based source line of the recognized ^prj
// task. Only while a project card is mounted; nothing else decorates.
function homeCardGoalLineFor(model) {
  try {
    if (!model || model.kind !== "project") return null;
    const prj = model.prj && typeof model.prj === "object" ? model.prj : null;
    if (!prj || prj.kind !== "one") return null;
    const line = Number(prj.line);
    if (!Number.isInteger(line) || line < 1) return null;
    return line;
  } catch (_) {
    return null;
  }
}

function homeCardGoalLineExpectedText(model) {
  try {
    const prj = model && model.prj && typeof model.prj === "object" ? model.prj : null;
    const text = homeCardLiveText(prj && prj.text);
    if (!text) return "";
    return text
      .replace(/^\s*[-+*]\s+\[[^\]]*\]\s+/, "")
      .replace(/[\t ]*\^prj[\t ]*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch (_) {
    return "";
  }
}

function homeCardGoalLineCandidateOk(node) {
  try {
    if (!node || node.nodeType !== 1) return false;
    const tag = String(node.tagName || "").toUpperCase();
    if (tag !== "LI") return false;
    const classes = String(node.getAttribute ? (node.getAttribute("class") || "") : "");
    if (!/(^|\s)task-list-item(\s|$)/.test(classes)) return false;
    if (node.getAttribute && node.getAttribute("data-task") === null) return false;
    let parent = node.parentNode;
    while (parent) {
      if (parent.nodeType === 1 && String(parent.tagName || "").toUpperCase() === "LI") return false;
      try {
        const parentClasses = String(parent.getAttribute ? (parent.getAttribute("class") || "") : "");
        if (/(^|\s)task-list-item(\s|$)/.test(parentClasses)) return false;
      } catch (_) {}
      parent = parent.parentNode;
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Reading locator: the first top-level task row before any H2 whose text
// matches the recognized ^prj line. Reading hides the trailing ^prj block
// id, so matching runs on the criterion text with whitespace collapsed;
// Tasks-plugin rewrites keep textContent order, so either side containing
// the other counts as a match. Document order decides: the walk stops at
// the first H2, mirroring the source rule (first body task before any H2).
function homeCardGoalLineNode(root, model) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") return null;
    if (homeCardGoalLineFor(model) == null) return null;
    const expected = homeCardGoalLineExpectedText(model);
    if (!expected) return null;
    const ordered = Array.from(root.querySelectorAll("h2, li.task-list-item") || []);
    const probe = expected.length > 48 ? expected.slice(0, 48) : expected;
    const tail = expected.length > 48 ? expected.slice(-24) : "";
    for (const row of ordered) {
      let tag = "";
      try {
        tag = String(row.tagName || "").toUpperCase();
      } catch (_) {
        tag = "";
      }
      if (tag === "H2") break;
      if (tag !== "LI") continue;
      if (!homeCardGoalLineCandidateOk(row)) continue;
      let text = "";
      try {
        text = String(row.textContent || "").replace(/\s+/g, " ").trim();
      } catch (_) {
        text = "";
      }
      if (!text) continue;
      if (text.indexOf(probe) >= 0 && (!tail || text.indexOf(tail) >= 0)) return row;
      if (expected.indexOf(text) >= 0 && text.length >= 12) return row;
    }
    return null;
  } catch (_) {
    return null;
  }
}

class BobLedgerToolsHomeCardLiveMixin {
  homeCardLiveStates() {
    let projects = null;
    let areas = null;
    try {
      projects = typeof this.projectsReportState === "function" ? this.projectsReportState() : null;
    } catch (_) {
      projects = null;
    }
    try {
      areas = typeof this.areasReportState === "function" ? this.areasReportState() : null;
    } catch (_) {
      areas = null;
    }
    return { projects, areas };
  }

  // Synchronous cache read for paint: never starts a fetch, never spawns.
  homeCardLivePatchFor(path, kind, model) {
    try {
      if (!model || typeof model !== "object") return null;
      return homeCardLivePatch({ kind, path, model, states: this.homeCardLiveStates() });
    } catch (_) {
      return null;
    }
  }

  homeCardLiveSubscribe() {
    if (this.homeCardLiveSubscribed === true) return;
    this.homeCardLiveSubscribed = true;
    try {
      this.homeCardLiveProjectsOff = typeof this.apiProjectsSubscribe === "function"
        ? this.apiProjectsSubscribe(() => { try { this.scheduleHomeCardRefresh(); } catch (_) {} })
        : null;
    } catch (_) {
      this.homeCardLiveProjectsOff = null;
    }
    try {
      this.homeCardLiveAreasOff = typeof this.apiAreasSubscribe === "function"
        ? this.apiAreasSubscribe(() => { try { this.scheduleHomeCardRefresh(); } catch (_) {} })
        : null;
    } catch (_) {
      this.homeCardLiveAreasOff = null;
    }
  }

  homeCardLiveUnsubscribe() {
    this.homeCardLiveSubscribed = false;
    try {
      if (typeof this.homeCardLiveProjectsOff === "function") this.homeCardLiveProjectsOff();
    } catch (_) {}
    try {
      if (typeof this.homeCardLiveAreasOff === "function") this.homeCardLiveAreasOff();
    } catch (_) {}
    this.homeCardLiveProjectsOff = null;
    this.homeCardLiveAreasOff = null;
  }
}
