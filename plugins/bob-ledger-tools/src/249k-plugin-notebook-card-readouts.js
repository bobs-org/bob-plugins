// Notebook Card report-backed readouts (bob-cli-qm notebook-readouts).
// The card shell paints local identity only; this fragment adds the readout
// line, section chips, child chips, and findings from the already-shared
// notebook report service (241a). One plugin-level apiNotebookSubscribe
// patches every mounted card in place. Nothing here spawns bob or writes
// the vault: painting, folding, resizing, and drawer toggles only re-read
// the stored report state. Without a fresh report row for the path, every
// report-backed part is omitted, never zeroed.
const NOTEBOOK_CARD_READOUT_SLOT = "notebook-readouts";
const NOTEBOOK_CARD_READOUT_SECTION_LIMIT = 8;
const NOTEBOOK_CARD_READOUT_SECTION_VISIBLE = 7;
const NOTEBOOK_CARD_READOUT_STALE_TIP = "Heading moved; the report will catch up";

function notebookCardReadoutEntry(plugin, path) {
  try {
    const key = notebookCardPath(path);
    if (!key || typeof plugin?.notebookReportState !== "function") return null;
    const state = plugin.notebookReportState();
    if (!state || !state.report || state.stale === true || state.unavailable === true) return null;
    const entry = notebookHeaderEntryForPath(state.report, key);
    return entry && typeof entry === "object" ? entry : null;
  } catch (_) {
    return null;
  }
}

function notebookCardReadoutCleanHeading(value) {
  try {
    if (typeof propertyCardCleanInlineText === "function") {
      return propertyCardCleanInlineText(value);
    }
  } catch (_) {}
  return String(value == null ? "" : value).trim();
}

function notebookCardReadoutHeadings(plugin, path) {
  const found = [];
  try {
    const key = notebookCardPath(path);
    const metadataCache = typeof propertyCardSettledMetadataCache === "function"
      ? propertyCardSettledMetadataCache(plugin?.app) : plugin?.app?.metadataCache;
    const vault = plugin?.app?.vault || null;
    let file = null;
    try {
      if (vault && typeof vault.getAbstractFileByPath === "function") {
        file = vault.getAbstractFileByPath(key);
      }
    } catch (_) {}
    if (!file && metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
      try { file = metadataCache.getFirstLinkpathDest(key, key); } catch (_) {}
    }
    if (!file) return found;
    const cache = metadataCache && typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache(file) : null;
    const rows = cache && Array.isArray(cache.headings) ? cache.headings : [];
    for (const row of rows) {
      if (!row || row.level !== 2) continue;
      const title = notebookCardReadoutCleanHeading(row.heading);
      if (!title) continue;
      let line = null;
      try {
        const start = row.position && row.position.start ? row.position.start.line : null;
        line = Number.isInteger(start) ? start : null;
      } catch (_) {}
      found.push({ title, line });
    }
  } catch (_) {}
  return found;
}

// Pair report sections to local ## headings in document order. When a title
// at the paired position disagrees (stale report), pair by title in order so
// duplicate titles are told apart by position. An unpaired section keeps its
// chip, but the chip is inert with a stale tooltip.
function notebookCardPairSections(sections, headings) {
  const rows = Array.isArray(sections) ? sections : [];
  const heads = Array.isArray(headings) ? headings : [];
  const used = new Set();
  const lower = (value) => String(value || "").trim().toLowerCase();
  return rows.map((section, index) => {
    const title = typeof section?.title === "string" ? section.title : "";
    const notes = Number.isInteger(section?.notes) ? section.notes : 0;
    let heading = null;
    let headingIndex = -1;
    const positional = heads[index] || null;
    if (positional && lower(positional.title) === lower(title)) {
      heading = positional;
      headingIndex = index;
      used.add(index);
    } else {
      for (let at = 0; at < heads.length; at += 1) {
        if (used.has(at)) continue;
        if (lower(heads[at].title) === lower(title)) {
          heading = heads[at];
          headingIndex = at;
          used.add(at);
          break;
        }
      }
    }
    return { title, notes, heading, headingIndex };
  });
}

function notebookCardReadoutDateText(isoDate, today) {
  const text = typeof isoDate === "string" ? isoDate.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  let names = null;
  try {
    names = Array.isArray(PROPERTY_CARD_MONTHS) ? PROPERTY_CARD_MONTHS : null;
  } catch (_) {}
  const short = (names && names[month - 1])
    || ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  const currentYear = typeof today === "string" && /^\d{4}-/.test(today)
    ? Number(today.slice(0, 4)) : new Date().getFullYear();
  const dated = `${short} ${day}`;
  return year === currentYear ? dated : `${dated}, ${year}`;
}

function notebookCardReadoutSplitIssues(entry) {
  const issues = Array.isArray(entry?.issues) ? entry.issues : [];
  const errors = [];
  const warnings = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const code = typeof issue.code === "string" ? issue.code.trim() : "";
    const message = typeof issue.message === "string" ? issue.message.trim() : "";
    if (!code || !message) continue;
    const line = Number.isInteger(issue.line) ? issue.line : null;
    const row = { code, message, line, severity: issue.severity === "error" ? "error" : "warning" };
    if (row.severity === "error") errors.push(row);
    else warnings.push(row);
  }
  return { errors, warnings };
}

function notebookCardReadoutChildRows(plugin, entry) {
  const kids = Array.isArray(entry?.children) ? entry.children : [];
  if (!kids.length) return [];
  let report = null;
  try { report = plugin?.notebookReportState?.()?.report || null; } catch (_) {}
  return kids.map((stem) => {
    const name = String(stem || "").trim();
    let child = null;
    try {
      if (report) child = notebookHeaderLookup(report, name);
    } catch (_) {}
    return {
      stem: name,
      path: child && child.path ? notebookReportPath(child.path) : "",
      title: child && child.title ? child.title : name,
      notes: child && Number.isInteger(child.notes) ? child.notes : null,
    };
  }).filter((row) => row.stem);
}

// Pure view model for the readout slot. Returns null without a fresh report
// row, so callers omit every report-backed part instead of painting zeroes.
function notebookCardReadoutModel(plugin, path, options = {}) {
  try {
    const key = notebookCardPath(path);
    if (!key) return null;
    const entry = notebookCardReadoutEntry(plugin, key);
    if (!entry) return null;
    let today = "";
    try { today = plugin?.notebookReportState?.()?.today || notebookLocalDate(); } catch (_) {}
    const headings = Array.isArray(options.headings) ? options.headings : notebookCardReadoutHeadings(plugin, key);
    const collapsed = options.collapsed === true;
    const notes = Number.isInteger(entry.notes) ? entry.notes : null;
    const sections = notebookCardPairSections(entry.sections, headings);
    const { errors, warnings } = notebookCardReadoutSplitIssues(entry);
    const stem = notebookCardStem(key);
    const newest = typeof entry.last_note === "string" && entry.last_note.trim() ? entry.last_note.trim() : "";
    const newestText = newest ? notebookCardReadoutDateText(newest, today) : "";
    return {
      path: key,
      stem,
      notes,
      newest: newestText ? newest : "",
      newestText,
      sectionTotal: sections.length,
      sections,
      children: notebookCardReadoutChildRows(plugin, entry),
      errors,
      warnings,
      collapsed,
      expanded: options.expanded === true,
    };
  } catch (_) {
    return null;
  }
}

function notebookCardReadoutDigest(readout) {
  if (!readout) return "none";
  try {
    return JSON.stringify([
      readout.notes,
      readout.newest,
      readout.newestText,
      readout.sectionTotal,
      readout.sections.map((row) => [row.title, row.notes, row.headingIndex]),
      readout.children.map((row) => [row.path || row.stem, row.title, row.notes]),
      readout.errors.map((row) => [row.code, row.message, row.line]),
      readout.warnings.map((row) => [row.code, row.message, row.line]),
      readout.collapsed === true,
      readout.expanded === true,
    ]);
  } catch (_) {
    return "readout";
  }
}

function notebookCardReadoutFootWarnings(readout) {
  if (!readout || !Array.isArray(readout.warnings)) return [];
  return readout.warnings.map((issue) => ({
    code: issue.code,
    severity: "warning",
    message: issue.message,
    setting: "",
  }));
}

function notebookCardReadoutCountText(doc, readout) {
  const parts = [];
  if (Number.isInteger(readout.notes) && readout.notes > 0) {
    parts.push(`${readout.notes} ${readout.notes === 1 ? "note" : "notes"}`);
  }
  if (readout.newestText) {
    parts.push(`newest ${readout.newestText}`);
  }
  if (readout.collapsed === true && readout.sectionTotal > 0) {
    parts.push(`${readout.sectionTotal} ${readout.sectionTotal === 1 ? "section" : "sections"}`);
  }
  return parts.join(" · ");
}

function notebookCardReadoutCountTip(readout) {
  const tips = [];
  if (Number.isInteger(readout.notes)) {
    tips.push(`${readout.notes} direct ${readout.notes === 1 ? "note" : "notes"}, excluding nested detail and child notebooks`);
  }
  if (readout.newest) {
    tips.push(`Newest authored [created::] date ${readout.newest}, never file time`);
  }
  return tips.join(". ");
}

function notebookCardReadoutSectionTip(readout, row) {
  const route = `@${readout.stem}#${row.title}`;
  if (row.notes > 0) return `${row.notes} ${row.notes === 1 ? "note" : "notes"} · ${route}`;
  return route;
}

function notebookCardReadoutErrorTip(errors) {
  return errors.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
}

function notebookCardReadoutEl(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  if (text) node.appendChild(doc.createTextNode(text));
  return node;
}

// Patch the reserved slot's stable children in place: the slot keeps its
// shape (no layout shift) while the rows fill, empty, or collapse.
function notebookCardReadoutFill(doc, slot, readout, handlers = {}) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !slot) return false;
    const summary = slot.querySelector?.("[data-notebook-summary]") || null;
    const sections = slot.querySelector?.("[data-notebook-sections]") || null;
    const children = slot.querySelector?.("[data-notebook-children]") || null;
    const findings = slot.querySelector?.("[data-notebook-findings]") || null;
    for (const row of [summary, sections, children, findings]) {
      if (!row) continue;
      while (row.firstChild) {
        try { row.removeChild(row.firstChild); } catch (_) { break; }
      }
      try { row.removeAttribute?.("title"); } catch (_) {}
    }
    if (!readout) {
      slot.setAttribute("data-state", "none");
      return true;
    }
    slot.setAttribute("data-state", "ready");

    if (summary) {
      const text = notebookCardReadoutCountText(doc, readout);
      if (text) {
        const line = notebookCardReadoutEl(doc, "div", "bob-notebook-card-readout", text);
        const tip = notebookCardReadoutCountTip(readout);
        if (tip) line.setAttribute("title", tip);
        line.setAttribute("aria-label", `Notebook data: ${text}`);
        summary.appendChild(line);
      }
    }
    if (sections) {
      const rows = Array.isArray(readout.sections) ? readout.sections : [];
      const over = rows.length > NOTEBOOK_CARD_READOUT_SECTION_LIMIT && readout.expanded !== true;
      const visible = over ? rows.slice(0, NOTEBOOK_CARD_READOUT_SECTION_VISIBLE) : rows;
      for (const row of visible) {
        const paired = Boolean(row.heading);
        const label = row.notes > 0 ? `§ ${row.title} ${row.notes}` : `§ ${row.title}`;
        if (!paired) {
          const inert = notebookCardReadoutEl(doc, "span", "bob-notebook-card-section-chip is-inert", label);
          inert.setAttribute("title", NOTEBOOK_CARD_READOUT_STALE_TIP);
          inert.setAttribute("aria-label", `${row.title}: ${NOTEBOOK_CARD_READOUT_STALE_TIP}`);
          sections.appendChild(inert);
          continue;
        }
        const chip = notebookCardReadoutEl(doc, "button", "bob-notebook-card-section-chip", label);
        chip.setAttribute("type", "button");
        chip.setAttribute("title", notebookCardReadoutSectionTip(readout, row));
        chip.setAttribute("aria-label", `Jump to section ${row.title}`);
        chip.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { handlers.onJumpSection?.(row); } catch (_) {}
        });
        sections.appendChild(chip);
      }
      if (over) {
        const rest = rows.length - NOTEBOOK_CARD_READOUT_SECTION_VISIBLE;
        const more = notebookCardReadoutEl(doc, "button", "bob-notebook-card-sections-more", `+${rest}`);
        more.setAttribute("type", "button");
        more.setAttribute("title", `Show ${rest} more ${rest === 1 ? "section" : "sections"}`);
        more.setAttribute("aria-label", `Show ${rest} more sections`);
        more.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { handlers.onToggleSections?.(); } catch (_) {}
        });
        sections.appendChild(more);
      }
    }
    if (children) {
      for (const row of Array.isArray(readout.children) ? readout.children : []) {
        const label = Number.isInteger(row.notes) && row.notes > 0 ? `↳ ${row.title} ${row.notes}` : `↳ ${row.title}`;
        const chip = notebookCardReadoutEl(doc, "button", "bob-notebook-card-child-chip", label);
        chip.setAttribute("type", "button");
        chip.setAttribute("title", `Open ${row.title}`);
        chip.setAttribute("aria-label", `Open child notebook ${row.title}`);
        chip.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { handlers.onOpenChild?.(row.path || row.stem, event); } catch (_) {}
        });
        children.appendChild(chip);
      }
    }
    if (findings && Array.isArray(readout.errors) && readout.errors.length > 0) {
      const count = readout.errors.length;
      const pill = notebookCardReadoutEl(
        doc, "button", "bob-notebook-card-error-pill", `✗ ${count} ${count === 1 ? "error" : "errors"}`,
      );
      pill.setAttribute("type", "button");
      pill.setAttribute("title", notebookCardReadoutErrorTip(readout.errors));
      pill.setAttribute("aria-label", `Notebook errors: ${notebookCardReadoutErrorTip(readout.errors)}`);
      pill.addEventListener?.("click", (event) => {
        try { event?.preventDefault?.(); } catch (_) {}
        try { handlers.onJumpError?.(); } catch (_) {}
      });
      findings.appendChild(pill);
    }
    return true;
  } catch (_) {
    return false;
  }
}

class BobLedgerToolsNotebookCardReadoutsMixin {
  notebookCardReadoutsBind() {
    if (this.notebookCardReadoutsBound === true) return true;
    this.notebookCardReadoutsBound = true;
    if (!(this.notebookCardSectionsExpanded instanceof Map)) this.notebookCardSectionsExpanded = new Map();
    try {
      this.notebookCardReadoutsUnsubscribe = typeof this.apiNotebookSubscribe === "function"
        ? this.apiNotebookSubscribe(() => this.scheduleNotebookCardRefresh?.())
        : null;
    } catch (_) {
      this.notebookCardReadoutsUnsubscribe = null;
    }
    return true;
  }

  notebookCardReadoutsUnbind() {
    try {
      if (typeof this.notebookCardReadoutsUnsubscribe === "function") {
        this.notebookCardReadoutsUnsubscribe();
      }
    } catch (_) {}
    this.notebookCardReadoutsUnsubscribe = null;
    this.notebookCardReadoutsBound = false;
    try { this.notebookCardSectionsExpanded?.clear?.(); } catch (_) {}
  }

  notebookCardSectionsOpen(path) {
    const key = notebookCardPath(path);
    try {
      return key && this.notebookCardSectionsExpanded instanceof Map
        && this.notebookCardSectionsExpanded.get(key) === true;
    } catch (_) {
      return false;
    }
  }

  notebookCardToggleSections(path) {
    const key = notebookCardPath(path);
    if (!key) return false;
    if (!(this.notebookCardSectionsExpanded instanceof Map)) this.notebookCardSectionsExpanded = new Map();
    const next = this.notebookCardSectionsExpanded.get(key) !== true;
    this.notebookCardSectionsExpanded.set(key, next);
    try { this.scheduleNotebookCardRefresh?.(); } catch (_) {}
    return next;
  }

  notebookCardReadoutFor(path, options = {}) {
    try {
      const key = notebookCardPath(path);
      if (!key) return null;
      return notebookCardReadoutModel(this, key, {
        collapsed: options.collapsed === true,
        expanded: this.notebookCardSectionsOpen(key),
      });
    } catch (_) {
      return null;
    }
  }

  notebookCardJumpSection(path, row, context = {}) {
    try {
      const key = notebookCardPath(path);
      const line = Number.isInteger(row?.heading?.line) ? row.heading.line : null;
      const editor = context.editor || context.view?.editor || null;
      if (editor && typeof editor.setCursor === "function" && line !== null) {
        editor.setCursor({ line, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          try { editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
          catch (_) { try { editor.scrollIntoView({ line, ch: 0 }); } catch (__) {} }
        }
        return true;
      }
      const scope = context.scope || null;
      const index = Number.isInteger(row?.headingIndex) ? row.headingIndex : -1;
      if (scope && typeof scope.querySelectorAll === "function" && index >= 0) {
        const heads = Array.from(scope.querySelectorAll("h2"));
        const target = heads[index] || null;
        if (target && typeof target.scrollIntoView === "function") {
          try { target.scrollIntoView({ block: "start" }); } catch (_) { target.scrollIntoView(); }
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  notebookCardJumpError(path, context = {}) {
    try {
      const key = notebookCardPath(path);
      const readout = this.notebookCardReadoutFor(key, { collapsed: context.collapsed === true });
      const first = Array.isArray(readout?.errors)
        ? readout.errors.find((issue) => Number.isInteger(issue.line)) : null;
      if (!first) return false;
      const line = first.line - 1;
      const editor = context.editor || context.view?.editor || null;
      if (editor && typeof editor.setCursor === "function" && line >= 0) {
        editor.setCursor({ line, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          try { editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
          catch (_) { try { editor.scrollIntoView({ line, ch: 0 }); } catch (__) {} }
        }
        return true;
      }
    } catch (_) {}
    return false;
  }

  notebookCardPaintReadouts(card, path, doc, context = {}) {
    try {
      const key = notebookCardPath(path);
      if (!card || !key || !doc) return false;
      const slot = card.querySelector?.(`[${NOTEBOOK_CARD_READOUT_MARKER}]`) || null;
      if (!slot) return false;
      const collapsed = context.collapsed === true;
      const readout = this.notebookCardReadoutFor(key, { collapsed });
      const plugin = this;
      let focusLabel = "";
      try {
        const active = doc.activeElement || null;
        if (active && typeof slot.contains === "function" && slot.contains(active)) {
          focusLabel = active.getAttribute?.("aria-label") || "";
        }
      } catch (_) {}
      const filled = notebookCardReadoutFill(doc, slot, readout, {
        onJumpSection: (row) => { void plugin.notebookCardJumpSection(key, row, context); },
        onJumpError: () => { void plugin.notebookCardJumpError(key, context); },
        onToggleSections: () => { void plugin.notebookCardToggleSections(key); },
        onOpenChild: (target, event) => { void plugin.notebookHeaderOpenPath?.(target, key, event); },
      });
      if (filled && focusLabel) {
        try {
          const again = slot.querySelector?.(`[aria-label="${focusLabel}"]`) || null;
          if (again && typeof again.focus === "function") again.focus();
        } catch (_) {}
      }
      return filled;
    } catch (_) {
      return false;
    }
  }
}
