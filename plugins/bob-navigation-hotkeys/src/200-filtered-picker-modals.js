class FilteredPickerModal extends Modal {
  constructor(app, options) {
    super(app);
    // Obsidian's Modal does not expose isOpen; the picker owns this state.
    this.isOpen = false;
    this.selectedIndex = 0;
    this.opening = false;
    this.closeBeforeOpenItem = false;
    this.footerHints = KEYBOARD_HINTS;
    this.items = [];
    this.visibleItems = [];
    this.applyOptions(options);
  }

  open() {
    if (this.isOpen) {
      return this;
    }
    this.isOpen = true;
    try {
      return super.open();
    } catch (error) {
      this.isOpen = false;
      throw error;
    }
  }

  close() {
    if (!this.isOpen) {
      return this;
    }
    this.isOpen = false;
    return super.close();
  }

  applyOptions(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "items")) {
      this.items = options.items || [];
      this.visibleItems = this.items;
    }
    if (Object.prototype.hasOwnProperty.call(options, "title")) {
      this.title = options.title;
    }
    if (Object.prototype.hasOwnProperty.call(options, "headerIcon")) {
      this.headerIcon = options.headerIcon;
    }
    if (Object.prototype.hasOwnProperty.call(options, "inputLabel")) {
      this.inputLabel = options.inputLabel;
    }
    if (Object.prototype.hasOwnProperty.call(options, "placeholder")) {
      this.placeholder = options.placeholder;
    }
    if (Object.prototype.hasOwnProperty.call(options, "resultsLabel")) {
      this.resultsLabel = options.resultsLabel;
    }
    if (Object.prototype.hasOwnProperty.call(options, "emptyText")) {
      this.emptyText = options.emptyText;
    }
    if (Object.prototype.hasOwnProperty.call(options, "getSubtitle")) {
      this.getSubtitle = options.getSubtitle;
    }
    if (Object.prototype.hasOwnProperty.call(options, "filterItem")) {
      this.filterItem = options.filterItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "renderItem")) {
      this.renderItem = options.renderItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "openItem")) {
      this.openItem = options.openItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "closeBeforeOpenItem")) {
      this.closeBeforeOpenItem = Boolean(options.closeBeforeOpenItem);
    }
    if (Object.prototype.hasOwnProperty.call(options, "footerHints")) {
      this.footerHints = options.footerHints || [];
    }

    return this;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof contentEl.removeAttribute === "function") {
      contentEl.removeAttribute("tabindex");
    }
    this.modalEl.addClass("bob-cnp-modal");
    contentEl.addClass("bob-cnp");

    const header = contentEl.createDiv({ cls: "bob-cnp-header" });
    this.headerEl = header;
    this.headerIconEl = header.createDiv({ cls: "bob-cnp-header-icon" });
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    this.titleEl = headerText.createDiv({ cls: "bob-cnp-title" });
    this.subtitleEl = headerText.createDiv({ cls: "bob-cnp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bob-cnp-search" });
    this.searchEl = searchEl;
    const searchIcon = searchEl.createDiv({ cls: "bob-cnp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bob-cnp-input",
      attr: {
        "aria-label": this.inputLabel,
        placeholder: this.placeholder,
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

    this.resultsEl = contentEl.createDiv({ cls: "bob-cnp-results" });
    this.footerEl = contentEl.createDiv({ cls: "bob-cnp-footer" });

    this.renderAll();

    const openingInput = this.inputEl;
    window.setTimeout(() => {
      if (this.isOpen && this.inputEl === openingInput && openingInput && typeof openingInput.focus === "function") {
        openingInput.focus();
      }
    }, 0);
  }

  renderAll(options = {}) {
    if (this.headerIconEl) {
      this.headerIconEl.empty();
      applyIcon(this.headerIconEl, this.headerIcon);
    }

    if (this.titleEl) {
      this.titleEl.textContent = this.title || "";
    }

    if (this.inputEl) {
      this.inputEl.setAttribute("aria-label", this.inputLabel || "");
      this.inputEl.setAttribute("placeholder", this.placeholder || "");
      if (options.clearQuery) {
        this.inputEl.value = "";
      }
    }

    if (this.resultsEl) {
      this.resultsEl.setAttribute("role", "listbox");
      this.resultsEl.setAttribute("aria-label", this.resultsLabel || "");
    }

    this.renderFooter();
    this.renderResults();
  }

  renderFooter() {
    if (!this.footerEl) {
      return;
    }

    this.footerEl.empty();
    (Array.isArray(this.footerHints) ? this.footerHints : KEYBOARD_HINTS).forEach(
      (hint) => {
        if (
          !hint ||
          !Array.isArray(hint.keys) ||
          typeof hint.label !== "string" ||
          hint.keys.length === 0
        ) {
          return;
        }
        const group = this.footerEl.createDiv({ cls: "bob-cnp-hint" });
        hint.keys.forEach((key) =>
          group.createEl("kbd", { cls: "bob-cnp-kbd", text: key }),
        );
        group.createEl("span", {
          cls: "bob-cnp-hint-label",
          text: hint.label,
        });
      },
    );
  }

  onClose() {
    this.modalEl.removeClass("bob-cnp-modal");
    this.contentEl.empty();
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
      this.openSelectedItem();
    }
  }

  moveSelection(delta) {
    if (this.visibleItems.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.visibleItems.length) %
      this.visibleItems.length;
    this.renderResults();
  }

  getQuery() {
    return this.inputEl ? this.inputEl.value.trim().toLowerCase() : "";
  }

  getRawQuery() {
    return this.inputEl ? this.inputEl.value.trim() : "";
  }

  getFilteredItems() {
    const query = this.getQuery();
    if (!query) {
      return this.items;
    }

    return this.items.filter((item) => this.filterItem(item, query));
  }

  updateSubtitle() {
    if (!this.subtitleEl || typeof this.getSubtitle !== "function") {
      return;
    }

    this.subtitleEl.textContent = this.getSubtitle(
      this.visibleItems,
      this.items,
    );
  }

  renderResults() {
    this.visibleItems = this.getFilteredItems();
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleItems.length,
    );

    this.updateSubtitle();
    this.resultsEl.empty();

    if (this.visibleItems.length === 0) {
      const emptyEl = this.resultsEl.createDiv({ cls: "bob-cnp-empty" });
      const emptyIcon = emptyEl.createDiv({ cls: "bob-cnp-empty-icon" });
      applyIcon(emptyIcon, "file-question");
      emptyEl.createDiv({
        cls: "bob-cnp-empty-text",
        text: this.emptyText,
      });
      return;
    }

    const query = this.getQuery();

    this.visibleItems.forEach((item, index) => {
      const isSelected = index === this.selectedIndex;
      const classes = ["bob-cnp-row"];
      if (isSelected) {
        classes.push("is-selected");
      }

      const rowEl = this.resultsEl.createDiv({
        cls: classes.join(" "),
        attr: {
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      this.renderItem(item, rowEl, query);

      const enterEl = rowEl.createDiv({ cls: "bob-cnp-row-enter" });
      applyIcon(enterEl, "corner-down-left");

      rowEl.addEventListener("mousedown", (event) => event.preventDefault());
      rowEl.addEventListener("click", () => this.openItemAtIndex(index));

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
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
        // Scrolling is a nicety; never let it break rendering.
      }
    }
  }

  clampSelectedIndex(index, length) {
    if (length === 0) {
      return 0;
    }

    return Math.min(Math.max(index, 0), length - 1);
  }

  openSelectedItem() {
    this.openItemAtIndex(this.selectedIndex);
  }

  async openItemAtIndex(index) {
    if (this.opening) {
      return;
    }

    const item = this.visibleItems[index];
    if (!item) {
      return;
    }

    this.opening = true;
    const closeBeforeOpenItem = this.closeBeforeOpenItem;
    if (closeBeforeOpenItem) {
      this.close();
    }
    try {
      if ((await this.openItem(item)) && !closeBeforeOpenItem) {
        this.close();
      }
    } finally {
      this.opening = false;
    }
  }
}

function renderTypedNotePickerRow(file, noteInfo, rowEl, query) {
  const rowIcon = rowEl.createDiv({
    cls:
      noteInfo && noteInfo.decorated
        ? `bob-cnp-row-icon is-status-${noteInfo.variant}`
        : "bob-cnp-row-icon",
  });
  applyIcon(rowIcon, noteInfo ? noteInfo.icon : "file-text");

  const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
  const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
  appendHighlighted(titleEl, file.basename, query);
  const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
  appendHighlighted(pathEl, file.path, query);

  if (!noteInfo || !noteInfo.decorated) {
    return;
  }
  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  if (noteInfo.kind === "project" && noteInfo.scheduled) {
    const scheduleAriaLabel = `Project scheduled for ${noteInfo.scheduledDate}`;
    const scheduleEl = badgesEl.createDiv({
      cls: "bob-cnp-row-schedule",
      attr: {
        "aria-label": scheduleAriaLabel,
        title: scheduleAriaLabel,
      },
    });
    const scheduleIcon = scheduleEl.createSpan({
      cls: "bob-cnp-row-schedule-icon",
    });
    applyIcon(scheduleIcon, "calendar-clock");
    const scheduleLabel = scheduleEl.createSpan({
      cls: "bob-cnp-row-schedule-label",
    });
    appendHighlighted(scheduleLabel, noteInfo.scheduledLabel, query);
  }

  const statusText = [noteInfo.emoji, noteInfo.label]
    .filter(Boolean)
    .join(" ");
  const ariaLabel =
    noteInfo.kind === "area"
      ? "Area note"
      : `Project status: ${noteInfo.label}`;
  const statusEl = badgesEl.createDiv({
    cls: `bob-cnp-row-status is-status-${noteInfo.variant}`,
    attr: {
      "aria-label": ariaLabel,
      title: ariaLabel,
    },
  });
  appendHighlighted(statusEl, statusText, query);
}

function addPickerRowClasses(rowEl, classes) {
  const list = Array.isArray(classes) ? classes : [classes];
  if (rowEl && rowEl.classList && typeof rowEl.classList.add === "function") {
    rowEl.classList.add(...list.filter(Boolean));
    return;
  }
  if (rowEl && typeof rowEl.addClass === "function") {
    list.filter(Boolean).forEach((cls) => rowEl.addClass(cls));
  }
}

function renderPomodoroBulletMovePickerRow(row, rowEl, query) {
  const kind = row && row.kind ? row.kind : "invalid";
  addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", `is-${kind}`]);

  const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
  applyIcon(
    rowIcon,
    kind === "new"
      ? "plus"
      : kind === "rename"
        ? "pencil"
        : kind === "split"
          ? "split"
        : kind === "invalid"
          ? "circle-alert"
          : "timer",
  );

  const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
  const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
  appendHighlighted(
    titleEl,
    kind === "invalid" ? row.statusText : row.title,
    query,
  );
  const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
  appendHighlighted(
    pathEl,
    kind === "invalid" ? "Type a valid Pomodoro name" : row.meta,
    query,
  );

  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  if (kind === "new" || kind === "rename" || kind === "split") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-create",
    });
    appendHighlighted(statusEl, row.badge || "New", query);
    return;
  }
  if (kind === "invalid") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-unavailable",
    });
    appendHighlighted(statusEl, "Not selectable", query);
    return;
  }
  if (!row.statusLabel) {
    return;
  }

  const statusClass =
    row.statusLabel === "Unscheduled" ? " is-status-unscheduled" : "";
  const statusEl = badgesEl.createDiv({
    cls: `bob-cnp-row-status${statusClass}`,
    attr: {
      "aria-label": row.statusLabel,
      title: row.statusLabel,
    },
  });
  appendHighlighted(
    statusEl,
    [row.statusEmoji, row.statusLabel].filter(Boolean).join(" "),
    query,
  );
}

class ChildNotePickerModal extends FilteredPickerModal {
  constructor(app, plugin, childFiles, parentFile) {
    const now = new Date();
    const noteInfoByPath = new Map(
      childFiles.map((file) => [
        file.path,
        getFileChildNoteInfo(app, file, now),
      ]),
    );
    const summaryParts = getChildNoteSummary(childFiles, noteInfoByPath);

    super(app, {
      items: childFiles,
      title: "Open child note",
      headerIcon: "folder-tree",
      inputLabel: "Filter child notes",
      placeholder: "Filter child notes",
      resultsLabel: "Child notes",
      emptyText: "No matching child notes",
      getSubtitle: (visibleFiles, allFiles) => {
        const total = allFiles.length;
        const shown = visibleFiles.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        let text = `${total} note${total === 1 ? "" : "s"}`;
        const parentName = parentFile && parentFile.basename;
        if (parentName) {
          text += ` under ${parentName}`;
        }
        if (summaryParts.length > 0) {
          text += ` · ${summaryParts.join(" · ")}`;
        }
        return text;
      },
      filterItem: (file, query) =>
        childNoteMatchesQuery(file, noteInfoByPath.get(file.path), query),
      renderItem: (file, rowEl, query) =>
        renderTypedNotePickerRow(
          file,
          noteInfoByPath.get(file.path),
          rowEl,
          query,
        ),
      openItem: (file) => plugin.openChildNote(file),
    });
  }
}

class TaskMoveDestinationPickerModal extends FilteredPickerModal {
  constructor(app, plugin, destinations, session) {
    const selectedCount = session.discovery.actualCount;
    const requestedCount = session.discovery.requestedCount;
    const clampedText = session.discovery.clamped
      ? ` · requested ${requestedCount}; reached end of note`
      : "";
    super(app, {
      items: destinations,
      title: "Move tasks to note",
      headerIcon: "move-right",
      inputLabel: "Filter task destinations",
      placeholder: "Filter areas and open projects",
      resultsLabel: "Task move destinations",
      emptyText: "No matching areas or open projects",
      getSubtitle: (visible, all) => {
        const shown =
          visible.length === all.length
            ? `${all.length} destination${all.length === 1 ? "" : "s"}`
            : `showing ${visible.length} of ${all.length} destinations`;
        return `${selectedCount} selected task${selectedCount === 1 ? "" : "s"} · ${shown}${clampedText}`;
      },
      filterItem: (entry, query) =>
        childNoteMatchesQuery(entry.file, entry.noteInfo, query),
      renderItem: (entry, rowEl, query) =>
        renderTypedNotePickerRow(entry.file, entry.noteInfo, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (entry) => plugin.commitTaskMoveSession(session, entry),
    });
    this.plugin = plugin;
    this.session = session;
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
  }
}

class PomodoroBulletMovePickerModal extends FilteredPickerModal {
  constructor(app, plugin, session) {
    const discovery = session && session.discovery ? session.discovery : {};
    const sourceEntry = session && session.sourceEntry ? session.sourceEntry : null;
    const destinationCount = (session && Array.isArray(session.entries)
      ? session.entries
      : []
    ).filter(
      (entry) =>
        entry &&
        entry.open &&
        (!sourceEntry || entry.entryLine !== sourceEntry.entryLine),
    ).length;
    const selectedCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.actualCount, 0)),
    );
    const requestedCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.requestedCount, selectedCount)),
    );
    const sourcePosition =
      sourceEntry && sourceEntry.position ? sourceEntry.position : "?";
    const clampedText = discovery.clamped
      ? ` · requested ${requestedCount}; reached end of Pomodoro`
      : "";

    super(app, {
      items: [],
      title: "Move Pomodoro bullets",
      headerIcon: "timer",
      inputLabel: "Filter Pomodoro destinations",
      placeholder: "Filter open Pomodoros, type a name, = same, or =NAME split",
      resultsLabel: "Pomodoro destinations",
      emptyText: "Type a name to create a new Pomodoro",
      getSubtitle: () =>
        `${selectedCount} bullet${selectedCount === 1 ? "" : "s"} from Pomodoro #${sourcePosition} · ${destinationCount} destination${destinationCount === 1 ? "" : "s"} · = same name · =NAME split${clampedText}`,
      renderItem: (row, rowEl, query) =>
        renderPomodoroBulletMovePickerRow(row, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (row) => {
        if (!row || row.kind === "invalid") {
          return false;
        }
        if (row.kind === "split") {
          return plugin.commitPomodoroBulletSplitSession(session, row);
        }
        return plugin.commitPomodoroBulletMoveSession(session, row);
      },
    });
    this.plugin = plugin;
    this.session = session;
  }

  getFilteredItems() {
    return createPomodoroBulletMovePickerRows(
      this.session && this.session.entries,
      this.session && this.session.sourceEntry
        ? this.session.sourceEntry.entryLine
        : null,
      this.getRawQuery(),
    );
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
  }
}

class PomodoroEntryMovePickerModal extends FilteredPickerModal {
  constructor(app, plugin, session) {
    const discovery = session && session.discovery ? session.discovery : {};
    const sourceEntry = session && session.sourceEntry ? session.sourceEntry : null;
    const destinationCount = (session && Array.isArray(session.entries)
      ? session.entries
      : []
    ).filter(
      (entry) =>
        entry &&
        entry.open &&
        (!sourceEntry || entry.entryLine !== sourceEntry.entryLine),
    ).length;
    const bulletCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.bulletCount, 0)),
    );
    const sourcePosition =
      sourceEntry && sourceEntry.position ? sourceEntry.position : "?";
    const ignoredCountText =
      session && session.countExplicit && session.ignoredCount > 0
        ? " · count ignored on a Pomodoro entry"
        : "";
    const mergeDirectionText =
      sourceEntry && isOpenTimedPomodoroEntry(sourceEntry)
        ? "Ctrl+X absorbs the selected future Pomodoro"
        : "Ctrl+X appends this Pomodoro to the selection";

    super(app, {
      items: [],
      title: "Move, merge, or rename Pomodoro",
      headerIcon: "timer",
      inputLabel: "Filter Pomodoro destinations",
      placeholder: "Filter open Pomodoros or type a new name",
      resultsLabel: "Pomodoro destinations",
      emptyText: "Type a name to rename this Pomodoro",
      getSubtitle: () =>
        `Pomodoro #${sourcePosition} (${bulletCount} bullet${bulletCount === 1 ? "" : "s"}) · ${destinationCount} destination${destinationCount === 1 ? "" : "s"} · ${mergeDirectionText}${ignoredCountText}`,
      renderItem: (row, rowEl, query) =>
        renderPomodoroBulletMovePickerRow(row, rowEl, query),
      footerHints: POMODORO_ENTRY_MOVE_HINTS,
      closeBeforeOpenItem: true,
      openItem: (row) => {
        if (!row || row.kind === "invalid") {
          return false;
        }
        return plugin.commitPomodoroEntryMoveSession(session, row);
      },
    });
    this.plugin = plugin;
    this.session = session;
  }

  handleKeydown(event) {
    if (isCtrlKey(event, "x")) {
      event.preventDefault();
      event.stopPropagation();
      this.mergeSelectedItem();
      return;
    }
    super.handleKeydown(event);
  }

  async mergeSelectedItem() {
    if (this.opening) {
      return;
    }
    const row = this.visibleItems[this.selectedIndex];
    if (!row) {
      new Notice("Select an existing Pomodoro to merge; nothing was merged");
      return;
    }
    if (row.kind !== "existing") {
      new Notice(
        row.kind === "rename"
          ? "Select an existing Pomodoro to merge; press Enter to rename instead; nothing was merged"
          : "Select an existing Pomodoro to merge; nothing was merged",
      );
      return;
    }

    const plan = planPomodoroEntryMerge(
      this.session && this.session.sourceContent,
      buildPomodoroEntryMergeOptions(this.session, row),
    );
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was merged`);
      return;
    }

    this.opening = true;
    this.close();
    try {
      await this.plugin.commitPomodoroEntryMergeSession(this.session, row);
    } finally {
      this.opening = false;
    }
  }

  getFilteredItems() {
    return createPomodoroBulletMovePickerRows(
      this.session && this.session.entries,
      this.session && this.session.sourceEntry
        ? this.session.sourceEntry.entryLine
        : null,
      this.getRawQuery(),
      { mode: "entry" },
    );
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
  }
}

class LinkCandidatePickerModal extends FilteredPickerModal {
  constructor(app, plugin, candidates, targetLine, jumpContext = null) {
    const frozenJumpContext = jumpContext
      ? Object.freeze({
          origin: jumpContext.origin
            ? Object.freeze({ ...jumpContext.origin })
            : null,
          token: jumpContext.token,
        })
      : null;
    super(app, {
      items: candidates,
      title: "Open link target",
      headerIcon: "link",
      inputLabel: "Filter link targets",
      placeholder: "Filter link targets",
      resultsLabel: "Link targets",
      emptyText: "No matching links",
      getSubtitle: (visibleCandidates, allCandidates) => {
        const total = allCandidates.length;
        const shown = visibleCandidates.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        const lineText =
          Number.isFinite(targetLine) ? ` on line ${targetLine + 1}` : "";
        return `${total} link target${total === 1 ? "" : "s"}${lineText}`;
      },
      filterItem: (candidate, query) =>
        candidate.label.toLowerCase().includes(query) ||
        candidate.path.toLowerCase().includes(query) ||
        (!!candidate.subpath &&
          candidate.subpath.toLowerCase().includes(query)) ||
        candidate.actionLabel.toLowerCase().includes(query),
      renderItem: (candidate, rowEl, query) => {
        const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(
          rowIcon,
          candidate.actionKind === "create" ? "file-plus" : "file-text",
        );

        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, candidate.label, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        appendHighlighted(pathEl, candidate.path, query);
        if (candidate.subpath) {
          appendHighlighted(pathEl, candidate.subpath, query);
        }

        const statusEl = rowEl.createDiv({
          cls: `bob-cnp-row-status is-${candidate.actionKind}`,
        });
        appendHighlighted(statusEl, candidate.actionLabel, query);
      },
      openItem: (candidate) =>
        plugin.openOrCreateLinkCandidate(candidate, frozenJumpContext),
    });
    this.vimJumpContext = frozenJumpContext;
  }
}

class YankPathPickerModal extends FilteredPickerModal {
  constructor(app, plugin, file) {
    super(app, {
      items: YANK_PATH_COMMANDS.map((command) =>
        createYankPathPickerItem(plugin, command, file),
      ),
      title: "Copy active file path",
      headerIcon: "copy",
      inputLabel: "Filter path formats",
      placeholder: "Filter path formats",
      resultsLabel: "Path formats",
      emptyText: "No matching path formats",
      getSubtitle: (visibleItems, allItems) => {
        const total = allItems.length;
        const shown = visibleItems.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        const filePath = getVaultRelativeFilePath(file);
        return filePath
          ? `${total} path format${total === 1 ? "" : "s"} for ${filePath}`
          : `${total} path format${total === 1 ? "" : "s"}`;
      },
      filterItem: (item, query) =>
        item.title.toLowerCase().includes(query) ||
        item.kind.toLowerCase().includes(query) ||
        item.preview.toLowerCase().includes(query),
      renderItem: (item, rowEl, query) => {
        const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(rowIcon, item.available ? "copy" : "circle-alert");

        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, item.title, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        pathEl.setAttribute("title", item.preview);
        appendHighlighted(pathEl, item.preview, query);

        const statusEl = rowEl.createDiv({
          cls: `bob-cnp-row-status ${
            item.available ? "is-open" : "is-unavailable"
          }`,
        });
        appendHighlighted(statusEl, item.actionLabel, query);
      },
      openItem: (item) => plugin.yankActiveFilePath(item.kind),
    });
  }
}

