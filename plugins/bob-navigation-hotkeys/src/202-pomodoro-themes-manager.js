// Bob Pomodoro themes manager: browse, hide, pin, inspect, and rename themes.
// Ledger Tools `api.themes` owns the catalog, hues, ranking, and writes; this
// file only composes the manager picker, its action/color/occurrences/rename
// modals, and the pure row models the tests cover. Mobile stays a Notice:
// history and writes need the desktop app.

const POMODORO_THEMES_MANAGER_VIEWS = ["active", "hidden", "duplicates", "all"];

const POMODORO_THEMES_MANAGER_VIEW_LABELS = {
  active: "Active",
  hidden: "Hidden",
  duplicates: "Possible duplicates",
  all: "All",
};

const POMODORO_THEMES_MANAGER_HUES = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];

const POMODORO_THEMES_MANAGER_COLOR_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "a"];

const POMODORO_THEMES_MANAGER_HINTS = [
  { keys: ["Tab"], label: "Switch view" },
  { keys: ["↵"], label: "Rename · color · hide · occurrences" },
  { keys: ["^D"], label: "Hide / undo" },
  { keys: ["esc"], label: "Dismiss" },
];

function normalizePomodoroThemeManagerKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Relative day label for a `YYYY-MM-DD` date against today's `YYYY-MM-DD`.
function formatPomodoroThemeManagerRelative(isoDate, todayIso) {
  const date = String(isoDate || "");
  const today = String(todayIso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "unknown";
  }
  if (date === today) {
    return "today";
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  const parsedToday = Date.parse(`${today}T00:00:00Z`);
  if (Number.isFinite(parsed) && Number.isFinite(parsedToday)) {
    const diff = Math.round((parsedToday - parsed) / dayMs);
    if (diff === 1) {
      return "yesterday";
    }
    if (diff > 1 && diff <= 6) {
      return `${diff} days ago`;
    }
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = date.split("-");
  const month = months[Number(parts[1]) - 1] || parts[1];
  if (date.slice(0, 4) === today.slice(0, 4)) {
    return `${month} ${Number(parts[2])}`;
  }
  return `${month} ${Number(parts[2])} ${parts[0]}`;
}

function pomodoroThemesManagerStripPunctuation(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Levenshtein distance capped at 2: anything above 1 is just "far".
function pomodoroThemesManagerLevenshteinCapped(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (Math.abs(a.length - b.length) > 1) {
    return 2;
  }
  let prev = [];
  for (let j = 0; j <= b.length; j += 1) {
    prev.push(j);
  }
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(value);
      if (value < rowMin) {
        rowMin = value;
      }
    }
    if (rowMin > 1) {
      return 2;
    }
    prev = curr;
  }
  return prev[b.length] > 1 ? 2 : prev[b.length];
}

// Possible-duplicate pairs across the catalog, using the PT7 near-duplicate
// rule: equal modulo space, hyphen, and punctuation, plural/singular (`s`,
// `es`), or Levenshtein distance 1 when both keys have at least 5 characters.
function pomodoroThemesManagerDuplicatePairs(themes) {
  const list = (Array.isArray(themes) ? themes : []).filter(
    (theme) => theme && typeof theme.key === "string" && theme.key,
  );
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const left = list[i].key;
      const right = list[j].key;
      if (!left || !right || left === right) {
        continue;
      }
      let qualifies = false;
      const strippedLeft = pomodoroThemesManagerStripPunctuation(left);
      const strippedRight = pomodoroThemesManagerStripPunctuation(right);
      if (strippedLeft && strippedLeft === strippedRight) {
        qualifies = true;
      }
      if (
        !qualifies &&
        (right === `${left}s` || right === `${left}es` || left === `${right}s` || left === `${right}es`)
      ) {
        qualifies = true;
      }
      if (
        !qualifies &&
        left.length >= 5 &&
        right.length >= 5 &&
        pomodoroThemesManagerLevenshteinCapped(left, right) <= 1
      ) {
        qualifies = true;
      }
      if (qualifies) {
        const first = list[i].name < list[j].name ? list[i] : list[j];
        const second = first === list[i] ? list[j] : list[i];
        pairs.push({ a: first, b: second });
      }
    }
  }
  pairs.sort((left, right) => {
    const leftKey = `${left.a.key}\0${left.b.key}`;
    const rightKey = `${right.a.key}\0${right.b.key}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return pairs;
}

// Build the manager rows for one view. Hint rows (collision hints) stay on
// top; theme rows carry badges; renamed-reappeared names are flagged.
function buildPomodoroThemesManagerRows(report, view) {
  const current = POMODORO_THEMES_MANAGER_VIEWS.includes(view) ? view : "active";
  const themes = report && Array.isArray(report.themes) ? report.themes : [];
  const hints = report && Array.isArray(report.hints) ? report.hints : [];
  const reappeared = new Set(report && Array.isArray(report.renamed_reappeared) ? report.renamed_reappeared : []);
  const rows = [];
  if ((current === "active" || current === "all") && hints.length > 0) {
    for (const hint of hints) {
      if (!hint || hint.code !== "theme_hue_collision") {
        continue;
      }
      const names = Array.isArray(hint.themes) ? hint.themes : [];
      const suggestion = hint.suggest && hint.suggest.name ? ` → ${hint.suggest.name} ${hint.suggest.hue || ""}`.trimEnd() : "";
      rows.push({
        kind: "hint",
        key: `hint-${names.join("+")}`,
        title: `${names.join(" and ")} share ${hint.hue || "a hue"}${suggestion}`,
        hint,
      });
    }
  }
  const duplicateKeys = new Set();
  if (current === "duplicates") {
    for (const pair of pomodoroThemesManagerDuplicatePairs(themes)) {
      duplicateKeys.add(pair.a.key);
      duplicateKeys.add(pair.b.key);
    }
  }
  for (const theme of themes) {
    if (!theme || typeof theme.key !== "string") {
      continue;
    }
    const hidden = theme.hidden === true;
    if (current === "active" && hidden) {
      continue;
    }
    if (current === "hidden" && !hidden) {
      continue;
    }
    if (current === "duplicates" && !duplicateKeys.has(theme.key)) {
      continue;
    }
    const badges = [];
    if (theme.today === "open" || theme.today === "closed") {
      badges.push("today");
    }
    if (hidden) {
      badges.push("hidden");
    }
    if (theme.pinned === true) {
      badges.push("pinned");
    }
    if (theme.exempt === true) {
      badges.push("exempt");
    }
    if (theme.configured === false) {
      badges.push("not configured");
    }
    if (reappeared.has(theme.key) || reappeared.has(theme.name)) {
      badges.push("reappeared");
    }
    rows.push({ kind: "theme", key: `theme-${theme.key}`, theme, badges });
  }
  return rows;
}

function filterPomodoroThemesManagerRows(rows, query) {
  const trimmed = String(query || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!trimmed) {
    return rows;
  }
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row) {
      return false;
    }
    if (row.kind === "hint") {
      return String(row.title || "").toLowerCase().includes(trimmed);
    }
    if (row.kind === "theme" && row.theme) {
      return (
        String(row.theme.name || "").toLowerCase().includes(trimmed) ||
        String(row.theme.key || "").includes(trimmed)
      );
    }
    return true;
  });
}

// Validate a rename target: a valid single theme (a `+` makes invalid_name).
function pomodoroThemesManagerRenameInputError(raw) {
  const validated = normalizePomodoroName(raw);
  if (!validated.valid) {
    return validated.error;
  }
  if (validated.name.includes("+")) {
    return "Rename to a single theme without +";
  }
  return null;
}

// Human rename preview from a `bob themes rename --dry-run -f json` report.
function formatPomodoroThemeManagerRenamePreview(dryRun) {
  const empty = { title: "No rename preview", lines: [], stateNote: "", colorNote: "", entries: 0, files: 0 };
  if (!dryRun || typeof dryRun !== "object") {
    return empty;
  }
  const report = dryRun.report && typeof dryRun.report === "object" ? dryRun.report : dryRun;
  if (!report || typeof report !== "object") {
    return empty;
  }
  const from = report.from && report.from.name ? report.from.name : "";
  const to = report.to && report.to.name ? report.to.name : "";
  const files = Array.isArray(report.files) ? report.files : [];
  const entries = Number.isFinite(Number(report.entries)) ? Number(report.entries) : 0;
  const lines = files.map((file) => {
    const tails = Array.isArray(file.tails) ? file.tails : [];
    const tailText = tails
      .map((tail) => `${tail.before || ""} → ${tail.after || ""}`)
      .join("; ");
    return `${file.path || ""} · ${file.entries || 0} ${Number(file.entries) === 1 ? "entry" : "entries"}${tailText ? ` · ${tailText}` : ""}`;
  });
  const stateNote = report.state && report.state.note ? String(report.state.note) : "";
  const colorNote = report.color && report.color.note ? String(report.color.note) : "";
  return {
    title: `${from} → ${to} · ${entries} ${entries === 1 ? "entry" : "entries"} in ${files.length} ${files.length === 1 ? "note" : "notes"}`,
    lines,
    stateNote,
    colorNote,
    entries,
    files: files.length,
  };
}

// Scan one note's text for Pomodoro entries whose ` — NAME` tail contains the
// theme key. Returns `{ path, line, tail }` rows with 0-based line numbers.
function collectPomodoroThemeOccurrencesInText(path, content, key) {
  const wanted = normalizePomodoroThemeManagerKey(key);
  if (!wanted) {
    return [];
  }
  const rows = [];
  const lines = String(content || "").split("\n");
  const isFence = (text) => /^```/.test(String(text || "").trimStart().slice(0, 3)) || /^\s*```/.test(text);
  let fenced = false;
  lines.forEach((rawLine, index) => {
    const text = String(rawLine || "");
    if (/^\s*```/.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced || isFence(text)) {
      return;
    }
    if (!/^\s*-\s*\[[ xX?\/-]\]/.test(text)) {
      return;
    }
    const separator = text.indexOf(" — ");
    if (separator === -1) {
      return;
    }
    // Task lines (`#task`) are not Pomodoro entries, even with a checkbox.
    if (text.slice(0, separator).includes("#task")) {
      return;
    }
    const tail = text.slice(separator + 3).trim();
    if (!tail) {
      return;
    }
    const components = tail.split("+").map((part) => part.trim()).filter(Boolean);
    if (components.some((part) => normalizePomodoroThemeManagerKey(part) === wanted)) {
      rows.push({ path, line: index, tail });
    }
  });
  return rows;
}

// Daily-note scope for occurrences and rename-adjacent scans: canonical
// `YYYY/YYYYMMDD.md` notes plus `_templates/daily.md`.
function isPomodoroThemeManagerDailyPath(path) {
  const value = String(path || "");
  if (value === "_templates/daily.md") {
    return true;
  }
  return /^\d{4}\/\d{8}\.md$/.test(value);
}

function renderPomodoroThemesManagerRow(row, rowEl, query, themesApi) {
  if (!row || !rowEl) {
    return;
  }
  if (row.kind === "hint") {
    addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", "is-hint"]);
    const iconEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(iconEl, "lightbulb");
    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, row.title, query);
    const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
    pathEl.setText("Suggestion — Tab past it to browse themes");
    return;
  }
  if (row.kind !== "theme" || !row.theme) {
    return;
  }
  const theme = row.theme;
  addPickerRowClasses(rowEl, [
    "bob-cnp-pomodoro-row",
    "is-theme",
    theme.hidden === true ? "is-hidden-theme" : "",
    theme.configured === false ? "is-unconfigured-theme" : "",
  ]);
  const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
  const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
  renderNavigationPomodoroThemeSwatches(titleEl, themesApi, theme.name);
  appendHighlighted(titleEl, theme.name, query);
  const days = Math.max(0, Number(theme.days_used) || 0);
  const lastUsed = theme.last_used ? formatPomodoroThemeManagerRelative(theme.last_used, "") : "unknown";
  const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
  const entries = Math.max(0, Number(theme.entries) || 0);
  appendHighlighted(
    pathEl,
    `${lastUsed} · ${days} ${days === 1 ? "day" : "days"} · ${entries} ${entries === 1 ? "entry" : "entries"}`,
    query,
  );
  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  for (const badge of row.badges || []) {
    const cls =
      badge === "hidden"
        ? "bob-cnp-row-status is-hidden-theme"
        : badge === "reappeared"
          ? "bob-cnp-row-status is-similar-theme"
          : badge === "not configured"
            ? "bob-cnp-row-status is-warning"
          : "bob-cnp-row-status is-recent-theme";
    const label =
      badge === "reappeared"
        ? "reappeared — rename again?"
        : badge.slice(0, 1).toUpperCase() + badge.slice(1);
    badgesEl.createDiv({
      cls,
      text: label,
      attr: { title: label, "aria-label": `${theme.name}: ${label}` },
    });
  }
  if (theme.hue) {
    const source = theme.hue_source === "config"
      ? " · config"
      : theme.pinned === true
        ? " · pinned"
        : "";
    badgesEl.createDiv({
      cls: "bob-cnp-row-status",
      text: `${theme.hue}${source}`,
      attr: {
        title: theme.hue_source === "config"
          ? "Color set in ~/.config/bob/config.yml"
          : `Hue ${theme.hue}${theme.pinned === true ? " (pinned)" : ""}`,
      },
    });
  }
}

class PomodoroThemesManagerModal extends FilteredPickerModal {
  constructor(app, plugin) {
    const themesApi = getNavigationPomodoroThemesApi(app);
    super(app, {
      items: [],
      title: "Types",
      headerIcon: "timer",
      inputLabel: "Filter types",
      placeholder: "Filter types — Tab switches view",
      resultsLabel: "Types",
      emptyText: "No types match",
      footerHints: POMODORO_THEMES_MANAGER_HINTS,
      getSubtitle: () => this.managerSubtitle(),
      filterItem: (row, query) => filterPomodoroThemesManagerRows([row], query).length > 0,
      renderItem: (row, rowEl, query) => renderPomodoroThemesManagerRow(row, rowEl, query, this.themesApi),
      closeBeforeOpenItem: true,
      openItem: (row) => this.openThemeActions(row),
    });
    this.plugin = plugin;
    this.themesApi = themesApi;
    this.managerView = "active";
    this.managerReport = null;
    this.managerError = null;
    this.themeWriteInFlight = false;
  }

  managerSubtitle() {
    const label = POMODORO_THEMES_MANAGER_VIEW_LABELS[this.managerView] || "Active";
    const counts = this.managerReport && this.managerReport.counts ? this.managerReport.counts : null;
    const known = counts && counts.known !== undefined ? ` · ${counts.known} known` : "";
    const suffix = this.managerError ? ` · ${this.managerError}` : "";
    return `${label} view · Tab switches${known}${suffix}`;
  }

  managerAvailable() {
    return navigationPomodoroThemeAvailable(this.themesApi);
  }

  onOpen() {
    super.onOpen();
    if (!this.managerAvailable()) {
      new Notice("Pomodoro themes need the desktop app.");
      this.close();
      return;
    }
    startNavigationPomodoroThemePicker(this);
    void this.refreshManagerReport("open");
  }

  async refreshManagerReport(reason) {
    void reason;
    if (!this.themesApi || typeof this.themesApi.fetch !== "function") {
      return;
    }
    try {
      const result = await this.themesApi.fetch();
      if (!this.pickerOpen) {
        return;
      }
      if (result && result.report) {
        this.managerReport = result.report;
        this.managerError = null;
      } else if (result && result.error && result.error.message) {
        this.managerError = result.error.message;
      }
      this.rebuildManagerItems();
    } catch (error) {
      this.managerError = "Could not load themes";
      this.rebuildManagerItems();
    }
  }

  rebuildManagerItems() {
    this.items = buildPomodoroThemesManagerRows(this.managerReport, this.managerView);
    this.selectedIndex = 0;
    this.renderResults();
  }

  getFilteredItems() {
    const query = this.getRawQuery();
    return filterPomodoroThemesManagerRows(this.items, query);
  }

  cycleManagerView() {
    const index = POMODORO_THEMES_MANAGER_VIEWS.indexOf(this.managerView);
    this.managerView = POMODORO_THEMES_MANAGER_VIEWS[(index + 1) % POMODORO_THEMES_MANAGER_VIEWS.length];
    this.selectedIndex = 0;
    this.rebuildManagerItems();
  }

  selectedThemeRow() {
    const row = this.visibleItems && this.visibleItems[this.selectedIndex];
    return row && row.kind === "theme" ? row : null;
  }

  handleKeydown(event) {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      this.cycleManagerView();
      return;
    }
    if (isCtrlKey(event, "d")) {
      event.preventDefault();
      event.stopPropagation();
      void this.toggleSelectedThemeVisibility();
      return;
    }
    super.handleKeydown(event);
  }

  async toggleSelectedThemeVisibility() {
    await this.toggleThemeRowVisibility(this.selectedThemeRow());
  }

  async toggleThemeRowVisibility(row) {
    if (!row || row.kind !== "theme" || !this.themesApi || this.themeWriteInFlight) {
      return;
    }
    const method = row.theme.hidden === true ? "unhide" : "hide";
    if (typeof this.themesApi[method] !== "function") {
      new Notice("Update bob to hide themes");
      return;
    }
    this.themeWriteInFlight = true;
    try {
      const result = await this.themesApi[method](row.theme.name);
      if (!result || result.ok !== true) {
        new Notice((result && result.message) || "Could not update the theme");
        return;
      }
      await this.refreshManagerReport("write");
    } catch (error) {
      new Notice("Could not update the theme");
    } finally {
      this.themeWriteInFlight = false;
    }
  }

  openThemeActions(row) {
    if (!row || row.kind !== "theme") {
      return false;
    }
    new PomodoroThemeActionModal(this.app, this, row).open();
    return true;
  }

  openThemeRename(row) {
    if (!row || row.kind !== "theme") {
      return;
    }
    new PomodoroThemeRenameModal(this.app, this, row.theme).open();
  }

  openThemeColor(row) {
    if (!row || row.kind !== "theme") {
      return;
    }
    if (row.theme && row.theme.hue_source === "config") {
      new Notice("Color set in ~/.config/bob/config.yml");
      return;
    }
    new PomodoroThemeColorModal(this.app, this, row.theme).open();
  }

  openThemeOccurrences(row) {
    if (!row || row.kind !== "theme") {
      return;
    }
    new PomodoroThemeOccurrencesModal(this.app, this.plugin, row.theme).open();
  }

  onClose() {
    stopNavigationPomodoroThemePicker(this);
    super.onClose();
  }
}

