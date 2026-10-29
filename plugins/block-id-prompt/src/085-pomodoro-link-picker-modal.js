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
    // Task-aware picks carry the task line text and the suggestion actually
    // presented (cloned so later catalog changes cannot rewrite intent).
    // Picks without task context keep the legacy choice shape.
    this.taskLineText = typeof task.lineText === "string" ? task.lineText : null;
    this.taskAware = this.taskLineText !== null;
    this.shownSuggestion = clonePomodoroThemeSuggestion(
      safeRequest.model && safeRequest.model.themeSuggestion,
    );
    this.interacted = false;
    this.initialKey = null;
    this.themeFooterEl = null;
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
    this.themesApi = null;
    this.themesUnsubscribe = null;
    this.hiddenThemeRows = new Map();
    this.themeWriteInFlight = false;
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
    startBlockPomodoroThemePicker(this);
    this.updateQuery("", "init");

    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  onClose() {
    stopBlockPomodoroThemePicker(this);
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
      this.updateQuery(this.inputEl ? this.inputEl.value : "", "input");
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
    this.renderHint(hintsEl, ["⌃D"], "hide / undo");
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
    // Second footer line: the live pending theme-field edit preview. It is
    // refreshed on every selection/query/refresh change and shown only for
    // an effective edit.
    this.themeFooterEl = footerEl.createDiv({
      cls: "bid-ppk-theme-footer",
      attr: { "aria-live": "polite" },
    });
    this.themeFooterEl.style.display = "none";
  }

  deliberateForRow(row) {
    return pomodoroPickerRowDeliberate(this.initialKey, this.query, row);
  }

  deliberateForSelectedRow() {
    return this.deliberateForRow(this.rows[this.selectedIndex]);
  }

  withTaskIntent(choice, deliberate, linkOnce) {
    if (choice && this.taskAware) {
      choice.themeIntent = {
        deliberate: deliberate === true,
        linkOnce: linkOnce === true,
        shown: this.shownSuggestion,
      };
    }
    return choice;
  }

  choiceForRow(row, deliberate, linkOnce) {
    let choice = null;
    if (!row) {
      return null;
    }
    if (row.kind === "new") {
      choice = {
        kind: "new",
        name: row.name,
        ...(row.preserveSpelling === true ? { preserveSpelling: true } : {}),
      };
    } else if (row.kind === "recent") {
      choice = { kind: "new", name: row.name, preserveSpelling: true };
    } else if (row.kind === "existing") {
      choice = {
        kind: "existing",
        entryLine: row.entry.entryLine,
        entryText: row.entry.entryText,
        title: row.entry.title,
      };
    }
    return this.withTaskIntent(choice, deliberate, linkOnce);
  }

  updateThemeFooter() {
    if (!this.themeFooterEl) {
      return;
    }
    const preview = this.taskAware
      ? describePomodoroThemeFooterPreview({
        rowName: destinationPomodoroRowName(this.rows[this.selectedIndex]),
        deliberate: this.deliberateForSelectedRow(),
        lineText: this.taskLineText || "",
        shown: this.shownSuggestion,
        exemptKeys: (this.model && this.model.themeSnapshot && this.model.themeSnapshot.exemptKeys) || [],
        taskThemeOf: (line) => {
          try {
            return this.themesApi && typeof this.themesApi.taskThemeOf === "function"
              ? this.themesApi.taskThemeOf(line)
              : null;
          } catch (_error) {
            return null;
          }
        },
        planThemeChange: (options) => {
          try {
            return this.themesApi && typeof this.themesApi.planThemeChange === "function"
              ? this.themesApi.planThemeChange(options)
              : null;
          } catch (_error) {
            return null;
          }
        },
      })
      : null;
    if (!preview) {
      this.themeFooterEl.setText("");
      this.themeFooterEl.style.display = "none";
      return;
    }
    this.themeFooterEl.setText(preview);
    this.themeFooterEl.style.display = "";
  }

  renderHint(hintsEl, keys, label) {
    const group = hintsEl.createDiv({ cls: "bid-ppk-hint" });
    keys.forEach((key) => group.createEl("kbd", { cls: "bid-ppk-kbd", text: key }));
    group.createEl("span", { cls: "bid-ppk-hint-label", text: label });
    return group;
  }

  handleKeydown(event) {
    if (isCtrlKey(event, "d")) {
      event.preventDefault();
      event.stopPropagation();
      void toggleBlockPomodoroThemeVisibility(this);
      return;
    }

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
      // Alt+Enter links once without remembering a theme, before the
      // generic Enter/Shift branch. A habitual double tap links to the
      // current/next Pomodoro, so Ctrl+Shift+Enter commits exactly like
      // Enter — before the Shift branch.
      if (event.altKey) {
        this.commitLinkOnce();
      } else if (event.shiftKey && !event.ctrlKey) {
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
    // Navigation marks the picker touched: later catalog/history refreshes
    // preserve the user's position instead of revising the default.
    this.interacted = true;
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

  // Selection stays stable across asynchronous refreshes. Refreshes update
  // only catalog knowledge and decoration; task semantics stay fixed. An
  // untouched empty-query picker adopts the newly eligible default and
  // settles its initial key. After interaction, refreshes preserve the row
  // key when possible and otherwise choose the first selectable row. Query
  // changes use the model's normal selection and never clear interaction.
  updateQuery(query, origin = "input") {
    const nextQuery = String(query === null || query === undefined ? "" : query);
    const queryChanged = nextQuery !== this.query;
    if (queryChanged && this.hiddenThemeRows.size > 0) {
      this.hiddenThemeRows.clear();
    }
    const previousKey = selectedPomodoroPickerKey(this.rows, this.selectedIndex);
    if (
      !queryChanged && origin === "refresh" &&
      refreshBlockPomodoroThemePickerSnapshot(this.model, this.themesApi)
    ) {
      this.shownSuggestion = clonePomodoroThemeSuggestion(
        this.model && this.model.themeSuggestion,
      );
    }
    this.query = nextQuery;
    const built = buildPomodoroLinkPickerRows(this.model, this.query, {
      themesApi: this.themesApi,
      hiddenRows: this.hiddenThemeRows,
    });
    this.rows = built.rows;
    if (!queryChanged && origin === "refresh") {
      if (!this.interacted && !this.query.trim()) {
        this.selectedIndex = built.selectedIndex;
        this.initialKey = selectedPomodoroPickerKey(this.rows, this.selectedIndex);
      } else {
        const preserved = previousKey !== null
          ? this.rows.findIndex((row) => row && row.key === previousKey)
          : -1;
        this.selectedIndex = preserved >= 0
          ? preserved
          : firstSelectablePomodoroPickerIndex(this.rows);
      }
    } else {
      if (queryChanged) {
        this.interacted = true;
      }
      this.selectedIndex = built.selectedIndex;
      if (origin === "init") {
        this.initialKey = selectedPomodoroPickerKey(this.rows, this.selectedIndex);
      }
    }
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

    this.updateThemeFooter();
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
        role: row.kind === "section" ? "presentation" : "option",
        "aria-selected": isSelected ? "true" : "false",
        "aria-label": this.rowLabel(row),
      },
    });

    if (row.kind === "existing") {
      this.renderExistingRow(rowEl, row, isSelected);
    } else if (row.kind === "recent") {
      this.renderRecentRow(rowEl, row, isSelected);
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
    let label = null;
    if (row.kind === "existing") {
      label = pomodoroLinkPickerRowLabel(row.entry, this.now);
    } else if (row.kind === "recent") {
      label = `New Pomodoro ${row.name}, Recent, ${formatBlockPomodoroThemeRecentMeta(row.theme)}`;
    } else if (row.kind === "new") {
      label = `${row.unconfigured ? "Not in your themes, " : ""}New Pomodoro ${row.name}`;
    } else {
      return row.message || "";
    }
    // Color is never the only cue: suggested rows name their origin aloud.
    if (row.suggested === true) {
      label += pomodoroThemeSuggestedLabelSuffix(row.themeSuggestion);
    }
    return label;
  }

  // Suggestion reason under the row meta: `Suggested · this task`,
  // `Suggested · reading task`, `Suggested · daily review`, or
  // `Suggested · from ● <stem>` plus the suggested theme pill. The dot
  // carries the place hue (from.hue) and the pill the theme hue, reusing
  // the PT6 swatch tokens.
  renderSuggestionReason(textEl, row) {
    if (!row || row.suggested !== true) {
      return;
    }
    const reason = pomodoroThemeSuggestionReason(row.themeSuggestion);
    if (!reason) {
      return;
    }
    const reasonEl = textEl.createDiv({ cls: "bid-ppk-suggest", attr: { role: "note" } });
    const tailEl = reasonEl.createSpan({ cls: "bid-ppk-suggest-text" });
    tailEl.appendText("Suggested · ");
    if (reason.kind === "note") {
      tailEl.appendText("from ");
      if (reason.placeHue) {
        tailEl.createSpan({
          cls: `bid-ppk-theme-swatch is-${reason.placeHue}`,
          attr: { "aria-hidden": "true" },
        });
        tailEl.appendText(` ${reason.stem}`);
      } else {
        tailEl.appendText(reason.stem);
      }
    } else {
      tailEl.appendText(reason.text);
    }
    if (reason.themeName) {
      const pillEl = reasonEl.createSpan({ cls: "bid-ppk-pill is-suggested-theme" });
      renderBlockPomodoroThemeSwatches(pillEl, this.themesApi, reason.themeName);
      pillEl.appendText(reason.themeName);
    }
  }

  renderExistingRow(rowEl, row, isSelected) {
    const { entry } = row;
    this.renderGlyph(rowEl, entry);

    const textEl = rowEl.createDiv({ cls: "bid-ppk-row-text" });
    const titleEl = textEl.createDiv({
      cls: `bid-ppk-row-title${entry.name ? "" : " is-unnamed"}`,
    });
    renderBlockPomodoroThemeSwatches(titleEl, this.themesApi, entry.name);
    appendHighlighted(titleEl, entry.title, this.query);
    this.renderExistingMeta(textEl, entry);
    this.renderSuggestionReason(textEl, row);

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
    titleEl.appendText(row.suggestedCreate ? "New " : "New Pomodoro ");
    const nameEl = titleEl.createSpan({ cls: "bid-ppk-create-name" });
    renderBlockPomodoroThemeSwatches(nameEl, this.themesApi, row.name);
    appendHighlighted(nameEl, row.name, this.query);
    if (row.suggestedCreate) {
      titleEl.appendText(" Pomodoro");
    }
    textEl.createDiv({
      cls: "bid-ppk-row-meta",
      text: pomodoroLinkCreateRowMeta(row, this.model),
    });
    this.renderSuggestionReason(textEl, row);

    const rightEl = rowEl.createDiv({ cls: "bid-ppk-row-right" });
    rightEl.createDiv({ cls: "bid-ppk-pill is-new", text: "New" });
    if (row.unconfigured) {
      rightEl.createDiv({
        cls: "bid-ppk-pill is-warning",
        text: "Not in your themes",
        attr: { title: "This name isn't in your configured themes" },
      });
    }
    if (row.hiddenThemes && row.hiddenThemes.length > 0) {
      rightEl.createDiv({
        cls: "bid-ppk-pill is-hidden-theme",
        text: "Hidden · ⌃D unhide",
      });
    }
    for (const similar of row.similarTo || []) {
      rightEl.createDiv({
        cls: "bid-ppk-pill is-similar-theme",
        text: `like ${similar}`,
      });
    }
    rightEl.createDiv({
      cls: `bid-ppk-theme${this.createThemeOver(row) ? " is-over" : ""}`,
      text: this.createThemeText(row),
    });

    if (isSelected) {
      const keycap = rightEl.createDiv({ cls: "bid-ppk-keycap" });
      applyIcon(keycap, "corner-down-left");
    }
  }

  renderRecentRow(rowEl, row, isSelected) {
    const glyph = rowEl.createDiv({ cls: "bid-ppk-glyph is-create is-recent" });
    applyIcon(glyph, "plus");

    const textEl = rowEl.createDiv({ cls: "bid-ppk-row-text" });
    const titleEl = textEl.createDiv({ cls: "bid-ppk-row-title" });
    titleEl.appendText("New Pomodoro ");
    const nameEl = titleEl.createSpan({ cls: "bid-ppk-create-name" });
    renderBlockPomodoroThemeSwatches(nameEl, this.themesApi, row.name);
    appendHighlighted(nameEl, row.name, this.query);
    textEl.createDiv({
      cls: "bid-ppk-row-meta",
      text: row.hidden
        ? `${formatBlockPomodoroThemeRecentMeta(row.theme)} · Hidden · ⌃D undo`
        : formatBlockPomodoroThemeRecentMeta(row.theme),
    });
    this.renderSuggestionReason(textEl, row);

    const rightEl = rowEl.createDiv({ cls: "bid-ppk-row-right" });
    rightEl.createDiv({
      cls: `bid-ppk-pill is-recent-theme${row.hidden ? " is-hidden-theme" : ""}`,
      text: row.hidden ? "Hidden" : "Recent",
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
    // The standalone deliberate helper keeps commitRow usable on partial
    // doubles that only stub rows/settleChoice.
    const deliberate = pomodoroPickerRowDeliberate(this.initialKey, this.query, row);
    this.settleChoice(this.choiceForRow(row, deliberate, false));
  }

  // Alt+Enter commits the selected row once: linkOnce without remembering
  // a theme, so deliberate stays false even on a non-default row.
  commitLinkOnce() {
    const row = this.rows[this.selectedIndex];
    if (!row || !row.selectable) {
      return;
    }
    this.settleChoice(this.choiceForRow(row, false, true));
  }

  // ⇧↵ creates from the typed text even when other rows match; an exact
  // open name links there instead (never a duplicate open name). Committing
  // a named intent is always deliberate.
  commitCreateIntent() {
    const intent = resolvePomodoroLinkCreateIntent(this.model, this.query);
    if (intent.kind === "new") {
      const canonicalKey = asciiLowercasePomodoroText(
        intent.name.replace(/\s+/g, " "),
      );
      const exactRecent = this.rows.find(
        (row) => row.kind === "recent" && row.theme && row.theme.key === canonicalKey,
      );
      if (exactRecent) {
        this.settleChoice(this.choiceForRow(exactRecent, true, false));
        return;
      }
      this.settleChoice(this.withTaskIntent({ kind: "new", name: intent.name }, true, false));
      return;
    }

    if (intent.kind === "existing" && intent.entry) {
      this.settleChoice(this.withTaskIntent({
        kind: "existing",
        entryLine: intent.entry.entryLine,
        entryText: intent.entry.entryText,
        title: intent.entry.title,
      }, true, false));
    }
  }
}
