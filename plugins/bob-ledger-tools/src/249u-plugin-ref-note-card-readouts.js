// Ref Card readouts (bob-cli-qp ref-readouts): subscribes to the shared
// ref-library snapshot and patches the lane chip, Today pill, annotations,
// reread lineage, identifiers, and diagnostics into existing rows with no
// layout shift. Nothing here spawns bob or writes the vault: painting,
// folding, scrolling, cursor motion, and drawer toggles only re-read the
// stored report state. Without a report row for the path, every
// report-backed part stays hidden, never zeroed or guessed. A stale
// snapshot still paints; only a missing row clears the chips.
const REF_NOTE_CARD_READOUT_SLOT = "ref-readouts";
const REF_NOTE_CARD_READOUT_PREREQ_LIMIT = 28;

function refNoteCardReadoutSlots() {
  return Object.freeze(["lane", "counts", "identifiers", "foot"]);
}

// One shared-snapshot row for a mounted card, or null. A stale snapshot
// still serves: a failed refresh keeps the last good snapshot and changes
// no chips, so only a missing row clears the readouts.
function refNoteCardReadoutRow(plugin, path) {
  try {
    const key = refNoteCardPath(path);
    if (!key || !plugin) return null;
    if (typeof plugin.refLibraryReportRow === "function") {
      const row = plugin.refLibraryReportRow(key);
      if (row && typeof row === "object") return row;
    }
    const state = typeof plugin.refLibraryReportState === "function"
      ? plugin.refLibraryReportState() : null;
    const rows = state && state.rowsByPath;
    if (rows instanceof Map) {
      const row = rows.get(key) || null;
      return row && typeof row === "object" ? row : null;
    }
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      const row = Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null;
      return row && typeof row === "object" ? row : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Today membership comes only from the in-memory ledger cache, never from
// a tag or a guess: without a ready cache nothing is ranked today.
function refNoteCardReadoutToday(plugin, task) {
  try {
    if (!plugin || !task || typeof task !== "object") return Object.freeze({ ready: false, today: false });
    const ready = typeof plugin.isTodayCacheReady === "function" && plugin.isTodayCacheReady() === true;
    if (!ready) return Object.freeze({ ready: false, today: false });
    const key = typeof readingBoardTaskKey === "function" ? readingBoardTaskKey(task) : null;
    if (!key) return Object.freeze({ ready: true, today: false });
    const rank = plugin.todayCache ? plugin.todayCache.rank : null;
    if (rank instanceof Map) return Object.freeze({ ready: true, today: rank.has(key) });
    if (rank && typeof rank === "object") {
      return Object.freeze({ ready: true, today: Object.prototype.hasOwnProperty.call(rank, key) });
    }
    return Object.freeze({ ready: true, today: false });
  } catch (_) {
    return Object.freeze({ ready: false, today: false });
  }
}

function refNoteCardReadoutTruncate(value, limit = REF_NOTE_CARD_READOUT_PREREQ_LIMIT) {
  try {
    const text = String(value === null || value === undefined ? "" : value).trim().replace(/\s+/g, " ");
    const max = Number.isInteger(limit) && limit > 2 ? limit : REF_NOTE_CARD_READOUT_PREREQ_LIMIT;
    if (!text || text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}…`;
  } catch (_) {
    return "";
  }
}

// Kit-style date label with the current year omitted: "Oct 23" this year,
// "Oct 23, 2026" otherwise, "" when the value is not a calendar date.
function refNoteCardReadoutDateLabel(value, today) {
  try {
    const text = String(value === null || value === undefined ? "" : value).trim().slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return "";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const current = /^\d{4}-/.test(String(today || "")) ? Number(String(today).slice(0, 4)) : new Date().getFullYear();
    const dated = `${months[month - 1]} ${day}`;
    return year === current ? dated : `${dated}, ${year}`;
  } catch (_) {
    return "";
  }
}

function refNoteCardReadoutBoardReason(blockedBy, today, legacy) {
  try {
    if (typeof readingBoardReasonModel === "function") {
      const reason = readingBoardReasonModel(
        Array.isArray(blockedBy) ? blockedBy : [],
        typeof today === "string" && today ? today : "",
        legacy === true,
      );
      if (reason && typeof reason === "object") return reason;
    }
  } catch (_) {}
  return { text: "", tooltip: "", dependencies: [], projects: [], schedules: [] };
}

function refNoteCardReadoutConflictMessage(row) {
  try {
    const diagnostics = Array.isArray(row && row.diagnostics) ? row.diagnostics : [];
    for (const item of diagnostics) {
      if (!item || typeof item !== "object") continue;
      if (String(item.code || "").trim() !== "status_conflict") continue;
      const detail = String(item.detail || item.message || "").trim();
      if (detail) return detail;
    }
  } catch (_) {}
  try {
    if (typeof READING_BOARD_SYNC_TOOLTIP === "string" && READING_BOARD_SYNC_TOOLTIP) {
      return READING_BOARD_SYNC_TOOLTIP;
    }
  } catch (_) {}
  return "Frontmatter status catches up on the next Highlights sync.";
}

// Pure lane view model. Open means an awake reading status (wip, next,
// ready); finished lanes stay muted and only Reading and Next take the
// accent. A sync conflict wins over every lane; pending sync is transient
// and keeps the normal lane.
function refNoteCardLaneModel(row, options = {}) {
  try {
    if (!row || typeof row !== "object") return null;
    const today = typeof options.today === "string" && options.today ? options.today : "";
    const sync = typeof row.status_sync === "string" ? row.status_sync.trim() : "";
    if (sync && sync !== "ok" && sync !== "pending") {
      return Object.freeze({
        id: "conflict",
        text: "⚠ Status conflict",
        tooltip: refNoteCardReadoutConflictMessage(row),
        link: "",
        priority: null,
        today: false,
      });
    }
    const status = typeof row.status === "string" ? row.status.trim() : "";
    const task = row.task && typeof row.task === "object" ? row.task : null;
    const link = (() => {
      try {
        if (typeof readingBoardTaskTarget === "function") {
          const target = readingBoardTaskTarget(task);
          if (target) return target;
        }
      } catch (_) {}
      try {
        if (task && typeof task.path === "string" && task.path.trim()
          && typeof task.block_id === "string" && task.block_id.trim()) {
          return `${task.path.trim().replace(/\.md$/i, "")}#^${task.block_id.trim()}`;
        }
      } catch (_) {}
      return "";
    })();
    if (row.blocked === true && (status === "wip" || status === "next" || status === "ready")) {
      const reasons = Array.isArray(row.blocked_by) ? row.blocked_by : null;
      const reason = refNoteCardReadoutBoardReason(
        Array.isArray(reasons) ? reasons : [],
        today,
        reasons === null,
      );
      const schedules = Array.isArray(reason.schedules) ? reason.schedules : [];
      const singleSchedule = Array.isArray(reasons) && reasons.length === 1
        && reasons[0] && reasons[0].kind === "local_schedule" && schedules.length === 1;
      if (singleSchedule) {
        return Object.freeze({
          id: "snoozed",
          text: `💤 Snoozed · until ${schedules[0].label || schedules[0].date || ""}`.trim(),
          tooltip: reason.tooltip || "",
          link,
          priority: null,
          today: false,
        });
      }
      const dependencies = Array.isArray(reason.dependencies) ? reason.dependencies : [];
      const projects = Array.isArray(reason.projects) ? reason.projects : [];
      const first = dependencies.length
        && Array.isArray(dependencies[0].prerequisites) && dependencies[0].prerequisites.length
        ? dependencies[0].prerequisites[0].title
        : projects.length ? projects[0].project : "";
      const extra = dependencies.reduce(
        (count, entry) => count + (Array.isArray(entry.prerequisites) ? entry.prerequisites.length : 0), 0,
      ) - 1;
      const title = String(first || "").trim();
      const text = title
        ? `💤 Snoozed · after ${refNoteCardReadoutTruncate(title)}${extra > 0 ? ` +${extra}` : ""}`
        : "💤 Snoozed";
      return Object.freeze({
        id: "snoozed",
        text,
        tooltip: reason.tooltip || "",
        link,
        priority: null,
        today: false,
      });
    }
    const open = status === "wip" || status === "next" || status === "ready";
    if (open) {
      const base = status === "wip" ? "📖 Reading" : status === "next" ? "⭐ Next" : "📥 Ready";
      const id = status === "wip" ? "reading" : status;
      let priority = null;
      try {
        const value = task && typeof task.priority === "string" ? task.priority.trim() : "";
        if (value && typeof readingBoardPriorityMarkModel === "function") {
          priority = readingBoardPriorityMarkModel(value);
        }
      } catch (_) {
        priority = null;
      }
      const ranked = Boolean(options.todayRanked === true);
      return Object.freeze({
        id,
        text: base,
        tooltip: "",
        link,
        priority: priority && typeof priority === "object" ? priority : null,
        today: ranked,
      });
    }
    if (status === "read") {
      const label = refNoteCardReadoutDateLabel(row.finished, today);
      return Object.freeze({
        id: "read",
        text: label ? `✓ Read · ${label}` : "✓ Read",
        tooltip: "",
        link,
        priority: null,
        today: false,
      });
    }
    if (status === "abandoned") {
      return Object.freeze({ id: "abandoned", text: "Dropped", tooltip: "", link, priority: null, today: false });
    }
    if (status === "legacy") {
      const state = typeof row.reading_state === "string" ? row.reading_state.trim() : "";
      const known = state === "started" || state === "queued" || state === "finished" || state === "dropped";
      return Object.freeze({
        id: "legacy",
        text: known ? `🗄 Legacy · ${state}` : "🗄 Legacy",
        tooltip: "",
        link,
        priority: null,
        today: false,
      });
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Reread lineage: a vN chip when the report counts two or more readings.
// `earlier:` is newest-first, so the first entry is the reading to open.
function refNoteCardVersionModel(row) {
  try {
    if (!row || typeof row !== "object") return null;
    const reading = Number.isInteger(row.reading) ? row.reading : null;
    if (!reading || reading < 2) return null;
    const earlier = (Array.isArray(row.earlier) ? row.earlier : []).filter(
      (entry) => entry && typeof entry === "object",
    );
    const labels = earlier.map((entry) => String(entry.label || "").trim()).filter(Boolean);
    const target = earlier.length ? String(earlier[0].target || "").trim() : "";
    if (!target) return null;
    return Object.freeze({
      text: `v${reading}`,
      tooltip: labels.length ? `Earlier readings: ${labels.join(" · ")}` : "",
      target,
    });
  } catch (_) {
    return null;
  }
}

// Identifier copy chips append to the byline row from the report only.
function refNoteCardIdentifierModels(row) {
  try {
    const identity = row && row.identity && typeof row.identity === "object" ? row.identity : null;
    if (!identity) return Object.freeze([]);
    const found = [];
    const arxiv = typeof identity.arxiv === "string" ? identity.arxiv.trim() : "";
    if (arxiv) {
      found.push({ kind: "arxiv", label: "arXiv", value: arxiv, text: `arXiv:${arxiv} ⧉` });
    }
    const doi = typeof identity.doi === "string" ? identity.doi.trim() : "";
    if (doi) {
      found.push({ kind: "doi", label: "DOI", value: doi, text: `doi:${doi} ⧉` });
    }
    return Object.freeze(found.map((entry) => Object.freeze({
      ...entry,
      tooltip: `Copy ${entry.label} identifier`,
    })));
  } catch (_) {
    return Object.freeze([]);
  }
}

// Annotation counts patch the readout row the note already laid out: the
// row exists only when the note declares a PDF or audio, the only refs
// that can carry annotations. Nonzero counts only, never zeroes.
function refNoteCardAnnotationsModel(row, options = {}) {
  try {
    if (!row || typeof row !== "object") return null;
    const notes = Number.isSafeInteger(row.annotation_count) && row.annotation_count > 0
      ? row.annotation_count : null;
    if (!notes) return null;
    const comments = Number.isSafeInteger(row.comment_count) && row.comment_count > 0
      ? row.comment_count : null;
    const text = comments
      ? `✎ ${notes} ${notes === 1 ? "annotation" : "annotations"} · ${comments} with notes`
      : `✎ ${notes} ${notes === 1 ? "annotation" : "annotations"}`;
    const scan = row.snapshot && typeof row.snapshot === "object"
      ? String(row.snapshot.synced_at || "").trim() : "";
    const label = scan ? refNoteCardReadoutDateLabel(scan, options.today) : "";
    return Object.freeze({
      text,
      tooltip: label
        ? `From the Highlights scan on ${label}; not live PDF state.`
        : "From the last Highlights scan; not live PDF state.",
      notes,
      comments,
    });
  } catch (_) {
    return null;
  }
}

// Foot lint lines: every report diagnostic by code and message, one line
// for a status conflict (reusing the conflict diagnostic when it carries
// the message), and one line for a declared PDF missing from the vault.
function refNoteCardLintModels(row, options = {}) {
  try {
    const lines = [];
    const diagnostics = row && Array.isArray(row.diagnostics) ? row.diagnostics : [];
    let conflictDetail = "";
    for (const item of diagnostics) {
      if (!item || typeof item !== "object") continue;
      const code = String(item.code || "").trim();
      const detail = String(item.detail || item.message || "").trim();
      if (!code && !detail) continue;
      if (code === "status_conflict" && detail && !conflictDetail) conflictDetail = detail;
      lines.push({ code: code || "report", text: detail ? `${code}: ${detail}` : code });
    }
    const sync = row && typeof row.status_sync === "string" ? row.status_sync.trim() : "";
    if (sync && sync !== "ok" && sync !== "pending" && !conflictDetail) {
      lines.push({ code: "status_sync", text: `Status conflict: ${refNoteCardReadoutConflictMessage(row)}` });
    }
    const missing = options.pdfMissing === true ? String(options.pdfPath || "").trim() : "";
    if (missing) lines.push({ code: "missing_pdf", text: `PDF not found at ${missing}` });
    return Object.freeze(lines.map((line) => Object.freeze(line)));
  } catch (_) {
    return Object.freeze([]);
  }
}

// Finished refs paint in muted ink; tone still comes from the report,
// falling back to the local shell tone for everything else.
function refNoteCardReadoutTone(row, fallback = "") {
  try {
    if (row && typeof row === "object" && row.status === "read") return "read";
  } catch (_) {}
  return fallback || "";
}

function refNoteCardReadoutDigest(readout) {
  if (!readout) return "none";
  try {
    return JSON.stringify([
      readout.lane,
      readout.version,
      readout.identifiers,
      readout.annotations,
      readout.lint,
      readout.pdfMissing === true,
      readout.tone || "",
    ]);
  } catch (_) {
    return "readout";
  }
}

function refNoteCardReadoutEl(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  if (text) node.appendChild(doc.createTextNode(text));
  return node;
}

function refNoteCardReadoutClear(node) {
  try {
    while (node.firstChild) {
      try { node.removeChild(node.firstChild); } catch (_) { break; }
    }
    try { node.removeAttribute?.("title"); } catch (_) {}
  } catch (_) {}
}

function refNoteCardReadoutResetSlot(slot) {
  if (!slot) return;
  refNoteCardReadoutClear(slot);
  try { slot.setAttribute("data-state", "waiting"); } catch (_) {}
  try { slot.setAttribute("aria-hidden", "true"); } catch (_) {}
}

// Patch the reserved slots' stable children in place: every slot keeps its
// shape (no layout shift) while the rows fill, empty, or collapse.
function refNoteCardReadoutFill(doc, card, readout, handlers = {}) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !card || !card.querySelector) return false;
    const lane = card.querySelector("[data-ref-lane]");
    const version = card.querySelector("[data-ref-version]");
    const identifiers = card.querySelector("[data-ref-identifiers]");
    const readouts = card.querySelector("[data-ref-readouts]");
    const annotations = card.querySelector("[data-ref-annotations]");
    const lint = card.querySelector("[data-ref-lint]");
    if (!lane && !version && !identifiers && !annotations && !lint) return false;
    const model = readout && typeof readout === "object" ? readout.lane : null;

    if (lane) {
      if (model && typeof model.text === "string" && model.text) {
        refNoteCardReadoutClear(lane);
        const label = [model.text];
        if (model.priority && typeof model.priority.tooltip === "string" && model.priority.tooltip) {
          label.push(String(model.priority.tooltip).split("\n")[0]);
        }
        if (model.today === true) label.push("ranked today");
        lane.setAttribute("data-state", "ready");
        lane.setAttribute("data-lane", model.id || "lane");
        lane.setAttribute("aria-label", label.join(", "));
        try { lane.removeAttribute?.("aria-hidden"); } catch (_) {}
        if (model.tooltip) lane.setAttribute("title", model.tooltip);
        const link = typeof model.link === "string" ? model.link : "";
        const holder = link
          ? refNoteCardReadoutEl(doc, "button", "bob-ref-card-lane-chip", model.text)
          : refNoteCardReadoutEl(doc, "span", "bob-ref-card-lane-text", model.text);
        if (link) {
          holder.setAttribute("type", "button");
          holder.setAttribute("aria-hidden", "true");
          holder.setAttribute("tabindex", "-1");
          holder.addEventListener?.("click", (event) => {
            try { event?.preventDefault?.(); } catch (_) {}
            try { handlers.onOpenTask?.(link, event); } catch (_) {}
          });
        } else {
          holder.setAttribute("aria-hidden", "true");
        }
        lane.appendChild(holder);
        if (model.priority && typeof buildPriorityMarkElement === "function") {
          try {
            const mark = buildPriorityMarkElement(doc, model.priority, { decorative: true, inheritColor: true });
            if (mark) lane.appendChild(mark);
          } catch (_) {}
        }
        if (model.today === true) {
          const pill = refNoteCardReadoutEl(doc, "span", "bob-ref-card-today", "TODAY");
          pill.setAttribute("aria-hidden", "true");
          pill.setAttribute("title", "Linked under today's Pomodoros");
          lane.appendChild(pill);
        }
      } else {
        refNoteCardReadoutResetSlot(lane);
      }
    }

    if (version) {
      const entry = readout && typeof readout === "object" ? readout.version : null;
      if (entry && typeof entry.text === "string" && entry.text && entry.target) {
        refNoteCardReadoutClear(version);
        version.setAttribute("data-state", "ready");
        try { version.removeAttribute?.("aria-hidden"); } catch (_) {}
        const chip = refNoteCardReadoutEl(doc, "button", "bob-ref-card-version-chip", entry.text);
        chip.setAttribute("type", "button");
        chip.setAttribute("aria-label", `Open earlier reading ${entry.text}`);
        if (entry.tooltip) chip.setAttribute("title", entry.tooltip);
        chip.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { handlers.onOpenEarlier?.(entry.target, event); } catch (_) {}
        });
        version.appendChild(chip);
      } else {
        refNoteCardReadoutResetSlot(version);
      }
    }

    if (identifiers) {
      const rows = readout && typeof readout === "object" && Array.isArray(readout.identifiers)
        ? readout.identifiers : [];
      if (rows.length) {
        refNoteCardReadoutClear(identifiers);
        identifiers.setAttribute("data-state", "ready");
        try { identifiers.removeAttribute?.("aria-hidden"); } catch (_) {}
        identifiers.appendChild(doc.createTextNode(" · "));
        for (const entry of rows) {
          if (!entry || typeof entry.text !== "string" || !entry.text) continue;
          const chip = refNoteCardReadoutEl(doc, "button", "bob-ref-card-identifier", entry.text);
          chip.setAttribute("type", "button");
          chip.setAttribute("aria-label", entry.tooltip || `Copy identifier ${entry.value || entry.text}`);
          if (entry.tooltip) chip.setAttribute("title", entry.tooltip);
          chip.addEventListener?.("click", (event) => {
            try { event?.preventDefault?.(); } catch (_) {}
            try { handlers.onCopyIdentifier?.(entry, event); } catch (_) {}
          });
          identifiers.appendChild(chip);
        }
      } else {
        refNoteCardReadoutResetSlot(identifiers);
      }
    }

    if (readouts && annotations) {
      const entry = readout && typeof readout === "object" ? readout.annotations : null;
      if (entry && typeof entry.text === "string" && entry.text) {
        refNoteCardReadoutClear(annotations);
        annotations.setAttribute("data-state", "ready");
        try { annotations.removeAttribute?.("aria-hidden"); } catch (_) {}
        const chip = refNoteCardReadoutEl(doc, "button", "bob-ref-card-annotations-chip", entry.text);
        chip.setAttribute("type", "button");
        chip.setAttribute("aria-label", `Jump to Highlights: ${entry.text}`);
        if (entry.tooltip) chip.setAttribute("title", entry.tooltip);
        chip.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { handlers.onJumpHighlights?.(event); } catch (_) {}
        });
        annotations.appendChild(chip);
        readouts.setAttribute("data-state", "ready");
      } else {
        refNoteCardReadoutClear(annotations);
        annotations.setAttribute("data-state", "waiting");
        try { annotations.setAttribute("aria-hidden", "true"); } catch (_) {}
        readouts.setAttribute("data-state", "reserved");
      }
    }

    if (lint) {
      const rows = readout && typeof readout === "object" && Array.isArray(readout.lint)
        ? readout.lint : [];
      if (rows.length) {
        refNoteCardReadoutClear(lint);
        lint.setAttribute("data-state", "ready");
        try { lint.removeAttribute?.("aria-hidden"); } catch (_) {}
        for (const line of rows) {
          if (!line || typeof line.text !== "string" || !line.text) continue;
          const node = refNoteCardReadoutEl(doc, "span", "bob-ref-card-lint-line", line.text);
          node.setAttribute("data-lint-code", line.code || "report");
          lint.appendChild(node);
        }
      } else {
        refNoteCardReadoutResetSlot(lint);
      }
    }

    if (readout && readout.pdfMissing === true) {
      try { card.querySelector("[data-ref-pdf]")?.remove?.(); } catch (_) {}
    }
    return true;
  } catch (_) {
    return false;
  }
}

class BobLedgerToolsRefNoteCardReadoutsMixin {
  refNoteCardReadoutSubscriptions() {
    if (!(this.refNoteCardReadoutTokens instanceof Map)) this.refNoteCardReadoutTokens = new Map();
    return this.refNoteCardReadoutTokens;
  }

  // One plugin-level subscription per mounted card: the shared service
  // fans one snapshot out to every mounted path, debounces revalidation,
  // and releases everything when the last card unmounts.
  refNoteCardReadoutSubscribe(path) {
    try {
      const key = refNoteCardPath(path);
      if (!key || typeof this.apiRefLibrarySubscribe !== "function") return false;
      const tokens = this.refNoteCardReadoutSubscriptions();
      if (tokens.has(key)) return true;
      const unsubscribe = this.apiRefLibrarySubscribe(
        () => this.scheduleRefNoteCardRefresh?.(),
        { path: key },
      );
      if (typeof unsubscribe !== "function") return false;
      tokens.set(key, unsubscribe);
      return true;
    } catch (_) {
      return false;
    }
  }

  refNoteCardReadoutUnsubscribePath(path) {
    try {
      const key = refNoteCardPath(path);
      const tokens = this.refNoteCardReadoutSubscriptions();
      const unsubscribe = key ? tokens.get(key) : null;
      if (typeof unsubscribe === "function") {
        try { unsubscribe(); } catch (_) {}
      }
      if (key) tokens.delete(key);
    } catch (_) {}
  }

  refNoteCardReadoutsUnbind() {
    try {
      for (const unsubscribe of this.refNoteCardReadoutSubscriptions().values()) {
        try { if (typeof unsubscribe === "function") unsubscribe(); } catch (_) {}
      }
      this.refNoteCardReadoutSubscriptions().clear();
    } catch (_) {}
  }

  refNoteCardPdfMissing(path, model) {
    try {
      const pdf = model && typeof model.sourcePdf === "string" ? model.sourcePdf : "";
      if (!pdf) return "";
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return "";
      return vault.getAbstractFileByPath(pdf) ? "" : pdf;
    } catch (_) {
      return "";
    }
  }

  refNoteCardTodayStamp() {
    try {
      if (typeof this.todayLocalDate === "function") {
        const stamp = this.todayLocalDate();
        if (typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
      }
    } catch (_) {}
    return "";
  }

  refNoteCardReadoutFor(path, model = null) {
    try {
      const key = refNoteCardPath(path);
      if (!key) return null;
      const row = refNoteCardReadoutRow(this, key);
      if (!row) return null;
      const today = this.refNoteCardTodayStamp();
      const ranked = refNoteCardReadoutToday(this, row.task);
      const missing = this.refNoteCardPdfMissing(key, model);
      const lint = refNoteCardLintModels(row, { pdfMissing: missing ? true : false, pdfPath: missing });
      return Object.freeze({
        path: key,
        lane: refNoteCardLaneModel(row, { today, todayRanked: ranked.today === true }),
        version: refNoteCardVersionModel(row),
        identifiers: refNoteCardIdentifierModels(row),
        annotations: refNoteCardAnnotationsModel(row, { today }),
        lint,
        pdfMissing: missing ? true : false,
        pdfPath: missing || "",
        tone: refNoteCardReadoutTone(row, ""),
      });
    } catch (_) {
      return null;
    }
  }

  refNoteCardOpenTask(path, target, event) {
    const key = refNoteCardPath(path);
    const link = String(target || "").trim();
    if (!key || !link) return Promise.resolve(false);
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const pane = (() => {
          try {
            if (typeof homeCardLinkPane === "function") return homeCardLinkPane(event);
          } catch (_) {}
          return Boolean(event && (event.ctrlKey === true || event.metaKey === true));
        })();
        return Promise.resolve()
          .then(() => workspace.openLinkText(link.replace(/\.md$/i, ""), key, pane))
          .then(() => true)
          .catch(() => {
            try { new Notice("Could not open the reading task."); } catch (_) {}
            return false;
          });
      }
    } catch (_) {}
    try { new Notice("Could not open the reading task."); } catch (_) {}
    return Promise.resolve(false);
  }

  refNoteCardOpenEarlier(path, target, event) {
    const key = refNoteCardPath(path);
    const link = String(target || "").trim();
    if (!key || !link) return Promise.resolve(false);
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const pane = (() => {
          try {
            if (typeof homeCardLinkPane === "function") return homeCardLinkPane(event);
          } catch (_) {}
          return Boolean(event && (event.ctrlKey === true || event.metaKey === true));
        })();
        return Promise.resolve()
          .then(() => workspace.openLinkText(link.replace(/\.md$/i, ""), key, pane))
          .then(() => true)
          .catch(() => {
            try { new Notice("Could not open the earlier reading."); } catch (_) {}
            return false;
          });
      }
    } catch (_) {}
    try { new Notice("Could not open the earlier reading."); } catch (_) {}
    return Promise.resolve(false);
  }

  refNoteCardCopyIdentifier(entry) {
    const value = entry && typeof entry.value === "string" ? entry.value : "";
    const label = entry && typeof entry.text === "string" && entry.text ? entry.text : value;
    if (!value) return Promise.resolve(false);
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      try { new Notice("Clipboard is unavailable."); } catch (_) {}
      return Promise.resolve(false);
    }
    return clipboard.writeText(value).then(
      () => {
        try { new Notice(`Copied ${label}.`); } catch (_) {}
        return true;
      },
      () => {
        try { new Notice("Could not copy the identifier."); } catch (_) {}
        return false;
      },
    );
  }

  // Jump to the local `## Highlights` scan the counts describe. The scan
  // section holds the annotations; the report only counts them.
  refNoteCardJumpHighlights(path, context = {}) {
    try {
      const key = refNoteCardPath(path);
      if (!key) return false;
      const editor = context.editor || (context.view && context.view.editor) || null;
      if (editor && typeof editor.setCursor === "function") {
        let line = null;
        try {
          const file = this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function"
            ? this.app.vault.getAbstractFileByPath(key) : null;
          const cache = this.app && this.app.metadataCache
            && typeof this.app.metadataCache.getFileCache === "function" && file
            ? this.app.metadataCache.getFileCache(file) : null;
          const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
          for (const heading of headings) {
            if (!heading || heading.level !== 2) continue;
            if (String(heading.heading || "").trim().toLowerCase() !== "highlights") continue;
            const start = heading.position && heading.position.start ? heading.position.start.line : null;
            if (Number.isInteger(start)) { line = start; break; }
          }
        } catch (_) {}
        if (line === null || line === undefined) return false;
        editor.setCursor({ line, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          try { editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
          catch (_) { try { editor.scrollIntoView({ line, ch: 0 }); } catch (__) {} }
        }
        return true;
      }
      const scope = context.scope || null;
      if (scope && typeof scope.querySelectorAll === "function") {
        for (const node of Array.from(scope.querySelectorAll("h2"))) {
          try {
            if (String(node.textContent || "").trim().toLowerCase() !== "highlights") continue;
            if (typeof node.scrollIntoView === "function") {
              try { node.scrollIntoView({ block: "start" }); } catch (_) { node.scrollIntoView(); }
            }
            return true;
          } catch (_) {}
        }
      }
    } catch (_) {}
    return false;
  }

  refNoteCardPaintReadouts(card, path, doc, context = {}) {
    try {
      const key = refNoteCardPath(path);
      if (!card || !key || !doc) return false;
      const model = context.model || null;
      const readout = this.refNoteCardReadoutFor(key, model);
      const plugin = this;
      let focusLabel = "";
      try {
        const active = doc.activeElement || null;
        if (active && typeof card.contains === "function" && card.contains(active)) {
          focusLabel = active.getAttribute?.("aria-label") || "";
        }
      } catch (_) {}
      const filled = refNoteCardReadoutFill(doc, card, readout, {
        onOpenTask: (link, event) => { void plugin.refNoteCardOpenTask(key, link, event); },
        onOpenEarlier: (target, event) => { void plugin.refNoteCardOpenEarlier(key, target, event); },
        onCopyIdentifier: (entry) => { void plugin.refNoteCardCopyIdentifier(entry); },
        onJumpHighlights: (event) => {
          void plugin.refNoteCardJumpHighlights(key, {
            ...context,
            editor: context.editor || (context.view && context.view.editor) || null,
          });
        },
      });
      if (filled && focusLabel) {
        try {
          const again = card.querySelector?.('[aria-label="'
            + String(focusLabel).replace(/["\\]/g, "\\$&") + '"]') || null;
          if (again && typeof again.focus === "function") again.focus();
        } catch (_) {}
      }
      return filled;
    } catch (_) {
      return false;
    }
  }
}
