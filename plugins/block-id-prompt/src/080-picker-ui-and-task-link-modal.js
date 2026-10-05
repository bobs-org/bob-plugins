const TASK_LINK_PICKER_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Link" },
  { keys: ["esc"], label: "Dismiss" },
];

function isCtrlKey(event, key) {
  return (
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === key
  );
}

function applyIcon(el, iconName) {
  if (!el || typeof setIcon !== "function") {
    return;
  }

  try {
    setIcon(el, iconName);
  } catch (error) {
    // Icons are decorative here; rendering should continue without them.
  }
}

function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!query) {
    el.appendText(source);
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let matchIndex = lowerSource.indexOf(lowerQuery);

  if (matchIndex === -1) {
    el.appendText(source);
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > index) {
      el.appendText(source.slice(index, matchIndex));
    }
    el.createSpan({
      cls: "bid-tlp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function taskStatusLabel(status) {
  return `[${status || " "}]`;
}

// Lane name for a checkbox status, for "stays <lane>" Notices.
function laneStatusName(status) {
  if (status === "*") {
    return "Next";
  }

  if (status === "/") {
    return "In Progress";
  }

  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "Blocked";
  }

  if (status === " ") {
    return "Ready";
  }

  return "Open";
}

function taskStatusClass(status) {
  if (status === "/") {
    return "active";
  }

  if (status === "*") {
    return "next";
  }

  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "blocked";
  }

  return "todo";
}

function taskBlockedState(task) {
  const dependency = (task && task.dependency) || null;
  const statusBlocked =
    Boolean(task) && task.status === BLOCKED_OBSIDIAN_TASK_STATUS;
  const dependencyBlocked = Boolean(dependency && dependency.isBlocked);

  return {
    isBlocked: statusBlocked || dependencyBlocked,
    statusBlocked,
    dependencyBlocked,
    depCount: dependency ? dependency.depIds.length : 0,
    metCount: dependency ? dependency.metCount : 0,
    unmetCount: dependency ? dependency.unmetBlockers.length : 0,
    unresolvedCount: dependency ? dependency.unresolvedIds.length : 0,
    unmetBlockers: dependency ? dependency.unmetBlockers : [],
  };
}

function countBlockedTasks(tasks) {
  return (tasks || [])
    .filter((task) => taskBlockedState(task).isBlocked)
    .length;
}

function blockedTaskCountSuffix(count) {
  return count > 0 ? ` · ${count} blocked` : "";
}

function partitionTaskPickerItems(tasks) {
  const unblocked = [];
  const blocked = [];

  (tasks || []).forEach((task) => {
    (taskBlockedState(task).isBlocked ? blocked : unblocked).push(task);
  });

  return { unblocked, blocked };
}

function blockedChipLabel(state) {
  return state.dependencyBlocked && state.depCount > 1
    ? `Blocked · ${state.unmetCount}`
    : "Blocked";
}

function buildBlockedTooltip(state) {
  if (!state || !state.isBlocked) {
    return "";
  }

  if (!state.dependencyBlocked) {
    if (state.depCount === 0) {
      return "Marked Blocked in the note; no dependencies listed";
    }

    if (state.unresolvedCount > 0) {
      return `Marked Blocked in the note; ${state.unresolvedCount} unresolved dependency ${pluralize(
        state.unresolvedCount,
        "reference",
        "references",
      )}`;
    }

    return `Marked Blocked in the note; all ${state.depCount} ${pluralize(
      state.depCount,
      "dependency",
      "dependencies",
    )} are done`;
  }

  const blockers = state.unmetBlockers || [];
  const visibleBlockers = blockers.slice(0, 3).map((blocker) =>
    normalizeText(blocker.title) || blocker.id,
  );
  const remainingCount = Math.max(0, blockers.length - visibleBlockers.length);
  let tooltip = `Blocked by: ${visibleBlockers.join(", ")}`;

  if (remainingCount > 0) {
    tooltip += `, +${remainingCount} more`;
  }

  if (state.unresolvedCount > 0) {
    tooltip += `; ${state.unresolvedCount} unresolved`;
  }

  return tooltip;
}

class TaskLinkPickerModal extends Modal {
  constructor(app, plugin, source, tasks, targetFile) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.tasks = tasks;
    this.targetFile = targetFile;
    this.visibleTasks = tasks;
    this.selectedIndex = 0;
    this.completed = false;
    this.opening = false;
    this.inputEl = null;
    this.subtitleEl = null;
    this.resultsEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-tlp-modal");
    contentEl.addClass("bid-tlp");

    const header = contentEl.createDiv({ cls: "bid-tlp-header" });
    const headerIcon = header.createDiv({ cls: "bid-tlp-header-icon" });
    applyIcon(headerIcon, "list-checks");
    const headerText = header.createDiv({ cls: "bid-tlp-header-text" });
    headerText.createDiv({ cls: "bid-tlp-title", text: "Link to task" });
    this.subtitleEl = headerText.createDiv({ cls: "bid-tlp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bid-tlp-search" });
    const searchIcon = searchEl.createDiv({ cls: "bid-tlp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bid-tlp-input",
      attr: {
        "aria-label": "Filter tasks",
        placeholder: "Filter tasks",
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    this.inputEl.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );

    this.resultsEl = contentEl.createDiv({
      cls: "bid-tlp-results",
      attr: {
        role: "listbox",
        "aria-label": "Open tasks",
      },
    });

    this.renderFooter(contentEl);
    this.renderResults();

    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  renderFooter(contentEl) {
    const footerEl = contentEl.createDiv({ cls: "bid-tlp-footer" });
    TASK_LINK_PICKER_HINTS.forEach((hint) => {
      const group = footerEl.createDiv({ cls: "bid-tlp-hint" });
      hint.keys.forEach((key) =>
        group.createEl("kbd", { cls: "bid-tlp-kbd", text: key }),
      );
      group.createEl("span", { cls: "bid-tlp-hint-label", text: hint.label });
    });
  }

  onClose() {
    this.modalEl.removeClass("bid-tlp-modal");
    this.contentEl.empty();

    if (!this.completed) {
      this.plugin.cancelTaskLinkPicker(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
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
      this.openSelectedTask();
    }
  }

  moveSelection(delta) {
    if (this.visibleTasks.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.visibleTasks.length) %
      this.visibleTasks.length;
    this.renderResults();
  }

  getQuery() {
    return this.inputEl ? this.inputEl.value.trim().toLowerCase() : "";
  }

  getFilteredTasks() {
    const query = this.getQuery();
    if (!query) {
      return this.tasks;
    }

    return this.tasks.filter((task) =>
      fuzzyIncludes(task.displayText, query),
    );
  }

  renderResults() {
    if (!this.resultsEl) {
      return;
    }

    const groups = partitionTaskPickerItems(this.getFilteredTasks());
    this.visibleTasks = groups.unblocked.concat(groups.blocked);
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleTasks.length,
    );
    this.updateSubtitle();
    this.resultsEl.empty();

    if (this.visibleTasks.length === 0) {
      this.renderEmptyState();
      return;
    }

    const showGroupHeaders =
      groups.unblocked.length > 0 && groups.blocked.length > 0;
    const query = this.getQuery();
    this.visibleTasks.forEach((task, index) => {
      if (showGroupHeaders && index === 0) {
        this.renderGroupHeader("Unblocked", groups.unblocked.length, "unblocked");
      }
      if (showGroupHeaders && index === groups.unblocked.length) {
        this.renderGroupHeader("Blocked", groups.blocked.length, "blocked");
      }

      const isSelected = index === this.selectedIndex;
      const blockedState = taskBlockedState(task);
      const rowEl = this.resultsEl.createDiv({
        cls: [
          "bid-tlp-row",
          isSelected ? "is-selected" : "",
          blockedState.isBlocked ? "is-blocked" : "",
        ].filter(Boolean).join(" "),
        attr: {
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      this.renderTaskRow(rowEl, task, query);

      rowEl.addEventListener("mousedown", (event) => event.preventDefault());
      rowEl.addEventListener("click", () => this.openTaskAtIndex(index));

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
    });
  }

  renderGroupHeader(label, count, variant) {
    const headerEl = this.resultsEl.createDiv({
      cls: `bid-tlp-group is-${variant}`,
      attr: { role: "presentation", "aria-hidden": "true" },
    });
    headerEl.createSpan({ cls: "bid-tlp-group-label", text: label });
    headerEl.createSpan({ cls: "bid-tlp-group-count", text: String(count) });
  }

  renderTaskRow(rowEl, task, query) {
    rowEl.createDiv({
      cls: `bid-tlp-status-pill is-${taskStatusClass(task.status)}`,
      text: taskStatusLabel(task.status),
    });

    const textEl = rowEl.createDiv({ cls: "bid-tlp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bid-tlp-row-title" });
    appendHighlighted(titleEl, task.displayText, query);

    const metaEl = textEl.createDiv({ cls: "bid-tlp-row-meta" });
    metaEl.createSpan({ text: `Line ${task.line + 1}` });
    const blockedState = taskBlockedState(task);
    if (blockedState.isBlocked) {
      const tooltip = buildBlockedTooltip(blockedState);
      const chipEl = metaEl.createSpan({
        cls: "bid-tlp-blocked-chip",
        attr: {
          "aria-label": tooltip,
          title: tooltip,
        },
      });
      const iconEl = chipEl.createSpan({
        cls: "bid-tlp-blocked-icon",
        attr: { "aria-hidden": "true" },
      });
      applyIcon(iconEl, "lock");
      chipEl.createSpan({
        cls: "bid-tlp-blocked-label",
        text: blockedChipLabel(blockedState),
      });
    }

    const badgeEl = rowEl.createDiv({
      cls: `bid-tlp-badge ${task.existingId ? "is-existing" : "is-create"}`,
    });
    if (task.existingId) {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "↵ link" });
      badgeEl.createSpan({ cls: "bid-tlp-badge-id", text: `^${task.existingId}` });
    } else {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "+ id" });
    }
  }

  renderEmptyState() {
    const basename = this.targetFile && this.targetFile.basename;
    const hasTasks = this.tasks.length > 0;
    const emptyEl = this.resultsEl.createDiv({ cls: "bid-tlp-empty" });
    const iconEl = emptyEl.createDiv({ cls: "bid-tlp-empty-icon" });
    applyIcon(iconEl, hasTasks ? "search-x" : "list-x");
    emptyEl.createDiv({
      cls: "bid-tlp-empty-text",
      text: hasTasks
        ? "No matching tasks"
        : `No open tasks in ${basename || "target note"}`,
    });
  }

  updateSubtitle() {
    if (!this.subtitleEl) {
      return;
    }

    const total = this.tasks.length;
    const shown = this.visibleTasks.length;
    const basename = this.targetFile && this.targetFile.basename;
    if (shown !== total) {
      this.subtitleEl.textContent =
        `Showing ${shown} of ${total}${blockedTaskCountSuffix(
          countBlockedTasks(this.visibleTasks),
        )}`;
      return;
    }

    this.subtitleEl.textContent =
      `${total} open ${pluralize(total, "task", "tasks")}` +
      `${basename ? ` in ${basename}` : ""}` +
      blockedTaskCountSuffix(countBlockedTasks(this.tasks));
  }

  clampSelectedIndex(index, length) {
    if (length === 0) {
      return 0;
    }

    return Math.min(Math.max(index, 0), length - 1);
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

  openSelectedTask() {
    this.openTaskAtIndex(this.selectedIndex);
  }

  async openTaskAtIndex(index) {
    if (this.opening) {
      return;
    }

    const task = this.visibleTasks[index];
    if (!task) {
      return;
    }

    this.opening = true;
    let promptSource = null;
    try {
      const result = await this.plugin.selectTaskLinkTask(this.source, task);
      if (!result) {
        return;
      }

      promptSource = result.promptSource || null;
      this.completed = true;
      this.close();
    } finally {
      this.opening = false;
    }

    if (promptSource) {
      window.setTimeout(() => this.plugin.openBlockIdPrompt(promptSource), 0);
    }
  }
}

