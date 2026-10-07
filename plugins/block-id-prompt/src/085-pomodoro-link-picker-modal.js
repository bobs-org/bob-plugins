// Pomodoro link picker modal: the promise-based "Link to today" picker for
// the Ctrl+Shift+Enter link direction. Pure UI over the core phase's picker
// model and row builder; not wired to any command on its own. The modal
// touches no plugin state; the caller owns `promptOpen`.
const POMODORO_LINK_PICKER_PLACEHOLDER = "Filter Pomodoros or name a new one";
const POMODORO_LINK_PICKER_LIST_ID = "bid-ppk-list";

// Lane chip for a task checkbox status: Ready/Blocked flow into Next, while
// Next and In Progress stay. Mirrors the link-direction lane rules.
function pomodoroLinkPickerLaneChip(status) {
  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return { text: "Blocked → Next", cls: "bid-ppk-lane is-green" };
  }

  if (status === "*") {
    return { text: "stays Next", cls: "bid-ppk-lane is-muted" };
  }

  if (status === "/") {
    return { text: "stays In Progress", cls: "bid-ppk-lane is-muted" };
  }

  if (status === " ") {
    return { text: "Ready → Next", cls: "bid-ppk-lane" };
  }

  return { text: `stays ${laneStatusName(status)}`, cls: "bid-ppk-lane is-muted" };
}

function formatPomodoroTaskCountSummary(linkCount) {
  if (!Number.isInteger(linkCount) || linkCount <= 0) {
    return "empty";
  }

  return linkCount === 1 ? "1 task" : `${linkCount} tasks`;
}

// Up to two child Task Link block IDs plus a `+k` remainder, in document
// order (`fix-flaky, web-capture +1`). Empty when the entry has no links.
function pomodoroLinkChildIdSummary(entry) {
  const links = (entry && entry.links) || [];
  if (links.length === 0) {
    return "";
  }

  const visible = links
    .slice(0, 2)
    .map((link) => link.blockId)
    .filter(Boolean);
  const remainder = links.length - visible.length;
  const summary = visible.join(", ");

  if (remainder > 0) {
    return summary ? `${summary} +${remainder}` : `+${remainder}`;
  }

  return summary;
}

// Screen-reader label for an existing row
// (`CAPTURE, running, 09:20–09:50, 3 tasks`).
function pomodoroLinkPickerRowLabel(entry, progress) {
  const parts = [entry.title];
  if (entry.running) {
    parts.push("running");
  } else if (entry.nextUp) {
    parts.push("next up");
  }

  if (entry.range) {
    parts.push(entry.range.text);
  }

  parts.push(formatPomodoroTaskCountSummary(entry.linkCount));
  return parts.filter(Boolean).join(", ");
}

// Best-effort read of the current plan meter: a throw or a misshapen meter
// hides the meter instead of breaking the picker.
function readPomodoroLinkBudgetMeter(budget) {
  try {
    const meter = budget ? budget.current : null;
    if (
      !meter ||
      !meter.themes ||
      !meter.links ||
      !Number.isInteger(meter.themes.count) ||
      !Number.isInteger(meter.themes.cap) ||
      !Number.isInteger(meter.links.count) ||
      !Number.isInteger(meter.links.cap)
    ) {
      return null;
    }

    return meter;
  } catch (error) {
    return null;
  }
}

// Best-effort projection for a new name: a throw or a misshapen meter
// hides the theme badge detail instead of breaking the picker.
function readPomodoroLinkNewNameMeter(budget, name) {
  try {
    if (!budget || typeof budget.forNewName !== "function") {
      return null;
    }

    const meter = budget.forNewName(name);
    if (
      !meter ||
      !meter.themes ||
      !Number.isInteger(meter.themes.count) ||
      !Number.isInteger(meter.themes.cap)
    ) {
      return null;
    }

    return meter;
  } catch (error) {
    return null;
  }
}

// Footer meter text (`plan 2/3 · 6/10`).
function formatPomodoroLinkMeter(meter) {
  return `plan ${meter.themes.count}/${meter.themes.cap} · ${meter.links.count}/${meter.links.cap}`;
}

// Create-row meta: where the new entry would land, plus whether it becomes
// the next-up entry; a completed-only name re-plans that theme instead.
function pomodoroLinkCreateRowMeta(row, model) {
  if (row.againOf) {
    return `${row.againOf} is done — starts a fresh ${row.name}`;
  }

  const anchor = (model && model.creation && model.creation.anchor) || null;
  const kind = anchor ? anchor.kind : null;
  if (kind === "section-top" || !row.anchorTitle) {
    return "first in Pomodoros";
  }

  const suffix = row.becomesNextUp ? " · becomes next up" : "";
  if (kind === "first-open") {
    return `before ${row.anchorTitle}${suffix}`;
  }

  return `after ${row.anchorTitle}${suffix}`;
}

class PomodoroLinkPickerModal extends Modal {
  constructor(app, request) {
    super(app);
    const safeRequest = request || {};
    this.model = safeRequest.model || null;
    const task = safeRequest.task || {};
    this.taskDisplayText = task.displayText || "";
    this.taskStatus = task.status || " ";
    this.needsBlockId = safeRequest.needsBlockId === true;
    this.now = safeRequest.now || null;
    this.budget = safeRequest.budget || null;
    this.query = "";
    this.rows = [];
    this.selectedIndex = -1;
    this.settled = false;
    this.choice = null;
    this.inputEl = null;
    this.resultsEl = null;
    this.shiftHintEl = null;
    this.choicePromise = new Promise((resolve) => {
      this.resolveChoice = resolve;
    });
  }

  waitForChoice() {
    return this.choicePromise;
  }

  settleChoice(choice) {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.choice = choice;
    this.resolveChoice(choice);
    this.close();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-ppk-modal");
    contentEl.addClass("bid-ppk");

    this.renderHeader(contentEl);
    this.renderSearch(contentEl);
    this.renderBanner(contentEl);
    this.resultsEl = contentEl.createDiv({
      cls: "bid-ppk-results",
      attr: {
        id: POMODORO_LINK_PICKER_LIST_ID,
        role: "listbox",
        "aria-label": "Today's open Pomodoros",
      },
    });
    this.renderFooter(contentEl);
    this.updateQuery("");

    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  onClose() {
    this.modalEl.removeClass("bid-ppk-modal");
    this.contentEl.empty();

    if (!this.settled) {
      this.settleChoice(null);
    }
  }

  renderHeader(contentEl) {
    const header = contentEl.createDiv({ cls: "bid-ppk-header" });
    const headerIcon = header.createDiv({ cls: "bid-ppk-header-icon" });
    applyIcon(headerIcon, "timer");
    const headerText = header.createDiv({ cls: "bid-ppk-header-text" });
    headerText.createDiv({ cls: "bid-ppk-title", text: "Link to today" });
    headerText.createDiv({
      cls: "bid-ppk-subtitle",
      text: this.taskDisplayText,
    });

    const side = header.createDiv({ cls: "bid-ppk-header-side" });
    const lane = pomodoroLinkPickerLaneChip(this.taskStatus);
    side.createDiv({ cls: lane.cls, text: lane.text });
    if (this.needsBlockId) {
      side.createDiv({
        cls: "bid-ppk-blockid",
        text: "+ block ID",
        attr: { title: "You'll name the block ID next" },
      });
    }
  }

  renderSearch(contentEl) {
    const searchEl = contentEl.createDiv({ cls: "bid-ppk-search" });
    const searchIcon = searchEl.createDiv({ cls: "bid-ppk-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bid-ppk-input",
      attr: {
        id: "bid-ppk-input",
        "aria-label": "Filter Pomodoros or name a new one",
        "aria-controls": POMODORO_LINK_PICKER_LIST_ID,
        placeholder: POMODORO_LINK_PICKER_PLACEHOLDER,
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.updateQuery(this.inputEl ? this.inputEl.value : "");
    });
    this.inputEl.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );
  }

  renderBanner(contentEl) {
    if (!this.model || this.model.ok !== true || !this.model.multipleRunning) {
      return;
    }

    const runningCount = (this.model.entries || []).filter(
      (entry) => entry.timed,
    ).length;
    contentEl.createDiv({
      cls: "bid-ppk-banner",
      text:
        `${runningCount} ${pluralize(runningCount, "Pomodoro", "Pomodoros")} ` +
        "are running — pick one; new Pomodoros are off until one finishes",
      attr: { role: "note" },
    });
  }

  renderFooter(contentEl) {
    const footerEl = contentEl.createDiv({ cls: "bid-ppk-footer" });
    const hintsEl = footerEl.createDiv({ cls: "bid-ppk-hints" });
    this.renderHint(hintsEl, ["↑↓"], "select");
    this.renderHint(hintsEl, ["↵"], "link");
    this.shiftHintEl = this.renderHint(hintsEl, ["⇧↵"], "new NAME");
    this.renderHint(hintsEl, ["esc"], "cancel");

    const meter = readPomodoroLinkBudgetMeter(this.budget);
    if (meter) {
      footerEl.createDiv({
        cls: `bid-ppk-meter${meter.over ? " is-over" : ""}`,
        text: formatPomodoroLinkMeter(meter),
        attr: { "aria-live": "polite" },
      });
    }
  }

  renderHint(hintsEl, keys, label) {
    const group = hintsEl.createDiv({ cls: "bid-ppk-hint" });
    keys.forEach((key) => group.createEl("kbd", { cls: "bid-ppk-kbd", text: key }));
    group.createEl("span", { cls: "bid-ppk-hint-label", text: label });
    return group;
  }

  handleKeydown(event) {
    if (event.key === "ArrowDown" || isCtrlKey(event, "n")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || isCtrlKey(event, "p")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      // A habitual double tap links to the current/next Pomodoro, so
      // Ctrl+Shift+Enter commits exactly like Enter — before the Shift branch.
      if (event.shiftKey && !event.ctrlKey) {
        this.commitCreateIntent();
      } else {
        this.commitRow(this.selectedIndex);
      }

      return;
    }

    if (event.key === "Escape" || isCtrlKey(event, "[")) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  moveSelection(delta) {
    const selectable = [];
    this.rows.forEach((row, index) => {
      if (row.selectable) {
        selectable.push(index);
      }
    });

    if (selectable.length === 0) {
      return;
    }

    let position = selectable.indexOf(this.selectedIndex);
    if (position === -1) {
      position = delta > 0 ? 0 : selectable.length - 1;
    } else {
      position =
        (position + delta + selectable.length) % selectable.length;
    }

    this.selectedIndex = selectable[position];
    this.renderRows();
  }

  updateQuery(query) {
    this.query = String(query === null || query === undefined ? "" : query);
    const built = buildPomodoroLinkPickerRows(this.model, this.query);
    this.rows = built.rows;
    this.selectedIndex = built.selectedIndex;
    this.renderRows();
  }

  renderRows() {
    if (!this.resultsEl) {
      return;
    }

    this.resultsEl.empty();

    if (this.rows.length === 0) {
      this.renderEmptyState();
    } else {
      this.rows.forEach((row, index) => {
        this.renderRow(row, index);
      });
    }

    if (this.inputEl) {
      const selectedId =
        this.selectedIndex >= 0 ? `bid-ppk-row-${this.selectedIndex}` : "";
      if (selectedId) {
        this.inputEl.setAttribute("aria-activedescendant", selectedId);
      } else {
        this.inputEl.removeAttribute("aria-activedescendant");
      }
    }

    if (this.shiftHintEl) {
      const intent = resolvePomodoroLinkCreateIntent(this.model, this.query);
      this.shiftHintEl.style.display = intent.kind === "none" ? "none" : "";
    }
  }

  renderRow(row, index) {
    const isSelected = index === this.selectedIndex;
    const rowEl = this.resultsEl.createDiv({
      cls: [
        "bid-ppk-row",
        `is-${row.kind}`,
        isSelected ? "is-selected" : "",
        row.selectable ? "" : "is-inert",
      ]
        .filter(Boolean)
        .join(" "),
      attr: {
        id: `bid-ppk-row-${index}`,
        role: "option",
        "aria-selected": isSelected ? "true" : "false",
        "aria-label": this.rowLabel(row),
      },
    });

    if (row.kind === "existing") {
      this.renderExistingRow(rowEl, row, isSelected);
    } else if (row.kind === "new") {
      this.renderCreateRow(rowEl, row, isSelected, index);
    } else {
      this.renderNoticeRow(rowEl, row);
    }

    // Clicks choose without stealing input focus.
    rowEl.addEventListener("mousedown", (event) => event.preventDefault());
    rowEl.addEventListener("click", () => this.commitRow(index));

    if (isSelected) {
      this.scrollRowIntoView(rowEl);
    }
  }

  rowLabel(row) {
    if (row.kind === "existing") {
      return pomodoroLinkPickerRowLabel(row.entry, this.now);
    }

    if (row.kind === "new") {
      return `New Pomodoro ${row.name}`;
    }

    return row.message || "";
  }

  renderExistingRow(rowEl, row, isSelected) {
    const { entry } = row;
    this.renderGlyph(rowEl, entry);

    const textEl = rowEl.createDiv({ cls: "bid-ppk-row-text" });
    const titleEl = textEl.createDiv({
      cls: `bid-ppk-row-title${entry.name ? "" : " is-unnamed"}`,
    });
    appendHighlighted(titleEl, entry.title, this.query);
    this.renderExistingMeta(textEl, entry);

    const rightEl = rowEl.createDiv({ cls: "bid-ppk-row-right" });
    if (entry.running) {
      rightEl.createDiv({ cls: "bid-ppk-pill is-running", text: "Running" });
    } else if (entry.nextUp) {
      rightEl.createDiv({ cls: "bid-ppk-pill is-next-up", text: "Next up" });
    }

    if (isSelected) {
      const keycap = rightEl.createDiv({ cls: "bid-ppk-keycap" });
      applyIcon(keycap, "corner-down-left");
    }
  }

  // The running entry shows a conic-gradient progress ring filled to the
  // elapsed fraction of its time range; the next-up entry a 2px accent
  // ring; other open entries a faint hollow ring.
  renderGlyph(rowEl, entry) {
    const glyph = rowEl.createDiv({
      cls: [
        "bid-ppk-glyph",
        entry.running ? "is-running" : entry.nextUp ? "is-next-up" : "is-open",
      ].join(" "),
    });

    if (entry.running) {
      const progress = pomodoroRunProgress(entry, this.now);
      const fraction = progress ? progress.fraction : 0;
      if (glyph.style && typeof glyph.style.setProperty === "function") {
        glyph.style.setProperty("--bid-ppk-progress", String(fraction));
      } else {
        glyph.style["--bid-ppk-progress"] = String(fraction);
      }

      glyph.createDiv({ cls: "bid-ppk-dot" });
    }
  }

  renderExistingMeta(textEl, entry) {
    const metaEl = textEl.createDiv({ cls: "bid-ppk-row-meta" });
    const parts = [];

    if (entry.range) {
      parts.push({ text: entry.range.text, cls: "" });
    }

    if (entry.running) {
      const progress = pomodoroRunProgress(entry, this.now);
      if (progress) {
        if (progress.minutesLeft >= 0) {
          parts.push({
            text: `${progress.minutesLeft}m left`,
            cls: "bid-ppk-left",
          });
        } else {
          parts.push({
            text: `${-progress.minutesLeft}m over`,
            cls: "bid-ppk-over",
          });
        }
      }
    }

    parts.push({
      text: formatPomodoroTaskCountSummary(entry.linkCount),
      cls: "",
    });

    const childIds = pomodoroLinkChildIdSummary(entry);
    if (childIds) {
      parts.push({ text: childIds, cls: "bid-ppk-ids" });
    }

    parts.forEach((part, partIndex) => {
      if (partIndex > 0) {
        metaEl.appendText(" · ");
      }

      metaEl.createSpan({ cls: part.cls || "", text: part.text });
    });
  }

  renderCreateRow(rowEl, row, isSelected, index) {
    if (index > 0) {
      rowEl.addClass("is-after-matches");
    }

    const glyph = rowEl.createDiv({ cls: "bid-ppk-glyph is-create" });
    applyIcon(glyph, "plus");

    const textEl = rowEl.createDiv({ cls: "bid-ppk-row-text" });
    const titleEl = textEl.createDiv({ cls: "bid-ppk-row-title" });
    titleEl.appendText("New Pomodoro ");
    const nameEl = titleEl.createSpan({ cls: "bid-ppk-create-name" });
    appendHighlighted(nameEl, row.name, this.query);
    textEl.createDiv({
      cls: "bid-ppk-row-meta",
      text: pomodoroLinkCreateRowMeta(row, this.model),
    });

    const rightEl = rowEl.createDiv({ cls: "bid-ppk-row-right" });
    rightEl.createDiv({ cls: "bid-ppk-pill is-new", text: "New" });
    rightEl.createDiv({
      cls: `bid-ppk-theme${this.createThemeOver(row) ? " is-over" : ""}`,
      text: this.createThemeText(row),
    });

    if (isSelected) {
      const keycap = rightEl.createDiv({ cls: "bid-ppk-keycap" });
      applyIcon(keycap, "corner-down-left");
    }
  }

  createThemeMeter(row) {
    return readPomodoroLinkNewNameMeter(this.budget, row.name);
  }

  createThemeOver(row) {
    const meter = this.createThemeMeter(row);
    return Boolean(meter && meter.themes && meter.themes.over);
  }

  createThemeText(row) {
    const meter = this.createThemeMeter(row);
    if (meter && meter.themes.over) {
      return `+1 theme · ${meter.themes.count}/${meter.themes.cap}`;
    }

    return "+1 theme";
  }

  renderNoticeRow(rowEl, row) {
    const glyph = rowEl.createDiv({ cls: "bid-ppk-glyph is-notice" });
    applyIcon(glyph, "circle-alert");

    const textEl = rowEl.createDiv({ cls: "bid-ppk-row-text" });
    textEl.createDiv({ cls: "bid-ppk-row-title", text: row.message || "" });
    if (row.kind === "invalid") {
      textEl.createDiv({
        cls: "bid-ppk-row-meta",
        text: "Start with a letter or digit",
      });
    }
  }

  renderEmptyState() {
    const emptyEl = this.resultsEl.createDiv({ cls: "bid-ppk-empty" });
    const iconEl = emptyEl.createDiv({ cls: "bid-ppk-empty-icon" });
    applyIcon(iconEl, "timer-off");
    emptyEl.createDiv({
      cls: "bid-ppk-empty-text",
      text: "No open Pomodoros today",
    });
    emptyEl.createDiv({
      cls: "bid-ppk-empty-hint",
      text: "Type a name to plan one",
    });
  }

  scrollRowIntoView(rowEl) {
    if (!rowEl || typeof rowEl.scrollIntoView !== "function") {
      return;
    }

    try {
      rowEl.scrollIntoView({ block: "nearest" });
    } catch (error) {
      try {
        rowEl.scrollIntoView(false);
      } catch (ignoredError) {
        // Scrolling is optional; never let it break selection.
      }
    }
  }

  commitRow(index) {
    const row = this.rows[index];
    if (!row || !row.selectable) {
      return;
    }

    if (row.kind === "new") {
      this.settleChoice({ kind: "new", name: row.name });
      return;
    }

    if (row.kind === "existing") {
      this.settleChoice({
        kind: "existing",
        entryLine: row.entry.entryLine,
        entryText: row.entry.entryText,
        title: row.entry.title,
      });
    }
  }

  // ⇧↵ creates from the typed text even when other rows match; an exact
  // open name links there instead (never a duplicate open name).
  commitCreateIntent() {
    const intent = resolvePomodoroLinkCreateIntent(this.model, this.query);
    if (intent.kind === "new") {
      this.settleChoice({ kind: "new", name: intent.name });
      return;
    }

    if (intent.kind === "existing" && intent.entry) {
      this.settleChoice({
        kind: "existing",
        entryLine: intent.entry.entryLine,
        entryText: intent.entry.entryText,
        title: intent.entry.title,
      });
    }
  }
}
