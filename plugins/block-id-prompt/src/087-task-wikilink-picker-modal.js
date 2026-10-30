// Task Wikilink Picker modal: the vault-wide `((` card. State, keys, and
// streaming refresh live here; row/section/detail plans come from 088.

class TaskWikilinkPickerModal extends Modal {
  constructor(app, plugin, source, snapshot) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.snapshot = snapshot || { rows: [], ready: true, scanned: 0, total: 0 };
    this.query = source && source.query ? String(source.query) : "";
    this.selectedKey = source && source.pickerState && source.pickerState.selectedKey
      ? source.pickerState.selectedKey
      : null;
    this.rowLimit = TASK_WIKILINK_PICKER_WINDOW;
    this.narrow = false;
    this.completed = false;
    this.accepting = false;
    this.unsubscribe = null;
    this.inputEl = null;
    this.countEl = null;
    this.progressEl = null;
    this.resultsEl = null;
    this.detailEl = null;
    this.footerEl = null;
    this.liveEl = null;
    this.plan = null;
  }

  pickerState() {
    return {
      query: this.query,
      selectedKey: this.selectedKey,
      rowLimit: this.rowLimit,
      scrollTop: this.resultsEl ? this.resultsEl.scrollTop || 0 : 0,
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-tlp-modal");
    this.modalEl.addClass("bid-twl-modal");
    contentEl.addClass("bid-tlp");
    contentEl.addClass("bid-twl");

    const header = contentEl.createDiv({ cls: "bid-tlp-header bid-twl-header" });
    const headerIcon = header.createDiv({ cls: "bid-tlp-header-icon bid-twl-header-icon" });
    headerIcon.createSpan({ cls: "bid-twl-header-glyph", text: "((" });
    const headerText = header.createDiv({ cls: "bid-tlp-header-text" });
    this.titleEl = headerText.createDiv({ cls: "bid-tlp-title" });
    this.subtitleEl = headerText.createDiv({ cls: "bid-tlp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bid-tlp-search bid-twl-search" });
    const searchIcon = searchEl.createDiv({ cls: "bid-tlp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bid-tlp-input bid-twl-input",
      attr: {
        type: "text",
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": "true",
        "aria-controls": TASK_WIKILINK_PICKER_LIST_ID,
        "aria-label": TASK_WIKILINK_PICKER_PLACEHOLDER,
        placeholder: TASK_WIKILINK_PICKER_PLACEHOLDER,
      },
    });
    this.inputEl.value = this.query;
    this.countEl = searchEl.createDiv({ cls: "bid-twl-count" });
    this.progressEl = searchEl.createDiv({ cls: "bid-twl-search-progress" });
    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value;
      this.selectedKey = null;
      this.rowLimit = TASK_WIKILINK_PICKER_WINDOW;
      this.renderAll();
    });
    this.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));

    this.resultsEl = contentEl.createDiv({
      cls: "bid-tlp-results bid-twl-results",
      attr: {
        id: TASK_WIKILINK_PICKER_LIST_ID,
        role: "listbox",
        "aria-label": "Vault tasks",
      },
    });
    this.resultsEl.addEventListener("scroll", () => this.onResultsScroll());

    this.detailEl = contentEl.createDiv({ cls: "bid-twl-detail" });
    this.footerEl = contentEl.createDiv({ cls: "bid-tlp-footer bid-twl-footer" });
    this.liveEl = contentEl.createDiv({
      cls: "bid-twl-live",
      attr: { "aria-live": "polite", role: "status" },
    });

    this.renderAll();
    this.subscribeToIndex();
    if (this.source && this.source.pickerState && Number.isInteger(this.source.pickerState.scrollTop)) {
      this.resultsEl.scrollTop = this.source.pickerState.scrollTop;
    }
    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  subscribeToIndex() {
    if (this.unsubscribe) {
      return;
    }
    const snapshot = this.snapshot;
    if (!snapshot || typeof snapshot.subscribe !== "function") {
      return;
    }
    this.unsubscribe = snapshot.subscribe(() => {
      this.refreshFromIndex();
    });
  }

  refreshFromIndex() {
    if (!this.plugin || typeof this.plugin.taskWikilinkSnapshot !== "function") {
      return;
    }
    const next = this.plugin.taskWikilinkSnapshot(this.source);
    if (!next) {
      return;
    }
    this.snapshot = next;
    this.renderAll();
  }

  onClose() {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch (error) {
        // Teardown must never throw from a modal close.
      }
      this.unsubscribe = null;
    }
    this.modalEl.removeClass("bid-tlp-modal");
    this.modalEl.removeClass("bid-twl-modal");
    this.contentEl.empty();
    if (this.plugin) {
      this.plugin.lastPromptKey = null;
      this.plugin.promptOpen = false;
    }
  }

  currentNarrow() {
    try {
      const width = this.modalEl && this.modalEl.clientWidth;
      if (Number.isInteger(width) && width > 0) {
        return width < 620;
      }
    } catch (error) {
      // Fall through to the last known flag.
    }
    return this.narrow;
  }

  buildPlan() {
    this.narrow = this.currentNarrow();
    const plugin = this.plugin;
    const index = plugin && plugin.taskWikilinkIndex;
    const blockIdsByPath = new Map();
    if (index && index.entries) {
      for (const [path, entry] of index.entries) {
        blockIdsByPath.set(path, entry.blockIds || new Set());
      }
    }
    let isInboxNote = null;
    try {
      const route = plugin && typeof plugin.getInboxRouteApi === "function"
        ? plugin.getInboxRouteApi()
        : null;
      if (route && typeof route.isInboxNote === "function") {
        isInboxNote = (path) => route.isInboxNote(path);
      }
    } catch (error) {
      isInboxNote = null;
    }
    this.plan = buildTaskWikilinkPickerPlan({
      rows: this.snapshot.rows || [],
      query: this.query,
      ownerPath: this.source && this.source.sourcePath,
      source: this.source,
      selectedKey: this.selectedKey,
      rowLimit: this.rowLimit,
      renderAll: this.rowLimit >= Number.MAX_SAFE_INTEGER / 4,
      narrow: this.narrow,
      progress: {
        ready: this.snapshot.ready,
        scanned: this.snapshot.scanned,
        total: this.snapshot.total,
      },
      warningNote: index && typeof index.warningNote === "function" ? index.warningNote() : null,
      blockIdsByPath,
      isInboxNote,
      now: plugin && typeof plugin.now === "function" ? plugin.now() : new Date(),
    });
    if (this.plan.selected) {
      this.selectedKey = this.plan.selected.key;
    }
    this.rowLimit = this.plan.window.rowLimit;
    return this.plan;
  }

  renderAll() {
    const plan = this.buildPlan();
    if (this.titleEl) {
      this.titleEl.setText(plan.header.title);
    }
    if (this.subtitleEl) {
      this.subtitleEl.setText(plan.header.subtitle);
    }
    if (this.countEl) {
      this.countEl.setText(plan.search.countText);
    }
    if (this.progressEl) {
      this.progressEl.classList.toggle("is-active", Boolean(plan.search.indexing));
      if (plan.search.indexing && plan.search.indexing.total) {
        const ratio = plan.search.indexing.scanned / plan.search.indexing.total;
        this.progressEl.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
      } else {
        this.progressEl.style.width = "0%";
      }
    }
    if (this.inputEl && plan.selected) {
      this.inputEl.setAttribute(
        "aria-activedescendant",
        `bid-twl-row-${String(plan.selected.key).replace(/[^A-Za-z0-9_-]+/g, "-")}`,
      );
    } else if (this.inputEl) {
      this.inputEl.removeAttribute("aria-activedescendant");
    }
    this.renderResults(plan);
    this.renderDetail(plan);
    this.renderFooter(plan);
    if (this.liveEl) {
      const live = [plan.live.count, plan.live.selected].filter(Boolean).join(". ");
      this.liveEl.setText(live);
    }
  }

  renderResults(plan) {
    if (!this.resultsEl) {
      return;
    }
    this.resultsEl.empty();
    if (plan.empty) {
      const emptyEl = this.resultsEl.createDiv({ cls: "bid-tlp-empty bid-twl-empty" });
      emptyEl.createDiv({ cls: "bid-tlp-empty-text", text: plan.empty.message });
      return;
    }
    for (const item of plan.items) {
      if (item.kind === "section") {
        renderTaskWikilinkSection(this.resultsEl, item);
      } else if (item.kind === "note") {
        renderTaskWikilinkNoteHeader(this.resultsEl, item);
      } else if (item.kind === "row") {
        const rowEl = renderTaskWikilinkRow(this.resultsEl, item, {
          onClick: (clicked) => this.acceptKey(clicked.key),
        });
        if (item.selected) {
          this.scrollRowIntoView(rowEl);
        }
      }
    }
  }

  renderDetail(plan) {
    if (!this.detailEl) {
      return;
    }
    this.detailEl.empty();
    const detail = plan.detail;
    if (!detail) {
      return;
    }
    const titleEl = this.detailEl.createDiv({ cls: "bid-twl-detail-title" });
    appendTaskWikilinkTitle(titleEl, detail.titleParts);
    this.detailEl.createDiv({ cls: "bid-twl-detail-meta", text: detail.meta });
    const actionEl = this.detailEl.createDiv({
      cls: `bid-twl-detail-action is-${detail.action.kind}`,
    });
    if (detail.action.kind === "identified" && detail.action.replacement) {
      actionEl.createSpan({ text: "↵ inserts " });
      actionEl.createSpan({
        cls: "bid-twl-inline-link",
        text: detail.action.replacement,
      });
    } else {
      actionEl.setText(detail.action.text);
    }
  }

  renderFooter(plan) {
    if (!this.footerEl) {
      return;
    }
    this.footerEl.empty();
    for (const hint of plan.footer.hints) {
      const group = this.footerEl.createDiv({ cls: "bid-tlp-hint" });
      for (const key of hint.keys) {
        group.createEl("kbd", { cls: "bid-tlp-kbd", text: key });
      }
      group.createEl("span", { cls: "bid-tlp-hint-label", text: hint.label });
    }
    if (plan.footer.warningNote) {
      this.footerEl.createDiv({
        cls: "bid-twl-warning",
        text: plan.footer.warningNote,
      });
    }
  }

  onResultsScroll() {
    if (!this.resultsEl || !this.plan || !this.plan.window.canExtend) {
      return;
    }
    const el = this.resultsEl;
    const remaining = (el.scrollHeight || 0) - (el.scrollTop || 0) - (el.clientHeight || 0);
    if (remaining < 120) {
      this.extendWindow();
    }
  }

  extendWindow() {
    if (!this.plan || !this.plan.window.canExtend) {
      return;
    }
    this.rowLimit = this.plan.window.rowLimit + TASK_WIKILINK_PICKER_WINDOW;
    this.renderAll();
  }

  renderThroughEnd() {
    this.rowLimit = Number.MAX_SAFE_INTEGER / 4;
    this.renderAll();
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
        // Scrolling is optional.
      }
    }
  }

  moveSelection(delta) {
    const keys = this.plan ? this.plan.selectableKeys : [];
    if (keys.length === 0) {
      return;
    }
    const current = Math.max(0, keys.indexOf(this.selectedKey));
    const next = (current + delta % keys.length + keys.length) % keys.length;
    this.selectedKey = keys[next];
    if (next + 1 > this.rowLimit) {
      this.rowLimit = Math.ceil((next + 1) / TASK_WIKILINK_PICKER_WINDOW) * TASK_WIKILINK_PICKER_WINDOW;
    }
    this.renderAll();
  }

  jumpSelection(toEnd) {
    const keys = this.plan ? this.plan.selectableKeys : [];
    if (keys.length === 0) {
      return;
    }
    if (toEnd) {
      this.renderThroughEnd();
      this.selectedKey = keys[keys.length - 1];
    } else {
      this.selectedKey = keys[0];
    }
    this.renderAll();
  }

  handleKeydown(event) {
    if (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this.jumpSelection(true);
      return;
    }
    if (event.key === "ArrowUp" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this.jumpSelection(false);
      return;
    }
    if (event.key === "ArrowDown" || isCtrlKey(event, "n") || isCtrlKey(event, "j")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }
    if (event.key === "ArrowUp" || isCtrlKey(event, "p") || isCtrlKey(event, "k")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(10);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-10);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (event.shiftKey || event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.acceptSelected();
      return;
    }
    if (event.key === "Escape" || isCtrlKey(event, "[")) {
      event.preventDefault();
      event.stopPropagation();
      if (String(this.query || "") !== "") {
        this.query = "";
        if (this.inputEl) {
          this.inputEl.value = "";
        }
        this.selectedKey = null;
        this.rowLimit = TASK_WIKILINK_PICKER_WINDOW;
        this.renderAll();
        return;
      }
      this.close();
      return;
    }
    if (event.key === "Backspace" && String(this.inputEl ? this.inputEl.value : this.query) === "") {
      event.preventDefault();
      event.stopPropagation();
      this.undoTriggerAndClose();
    }
  }

  acceptSelected() {
    const selected = this.plan && this.plan.selected;
    if (!selected || selected.disabled) {
      return;
    }
    this.acceptKey(selected.key);
  }

  acceptKey(key) {
    const selected = (this.plan && this.plan.items || []).find(
      (item) => item.kind === "row" && item.key === key,
    ) || (this.plan && this.plan.selected && this.plan.selected.key === key
      ? this.plan.selected
      : null);
    if (!selected || selected.disabled) {
      return;
    }
    if (!selected.identified) {
      return;
    }
    if (this.accepting) {
      return;
    }
    this.accepting = true;
    const source = this.source;
    const plugin = this.plugin;
    Promise.resolve(plugin.acceptTaskWikilinkIdentified(source, selected))
      .then((result) => {
        this.accepting = false;
        if (result && result.ok) {
          this.completed = true;
          this.close();
          return;
        }
        if (result && result.stale) {
          this.refreshFromIndex();
        }
      })
      .catch(() => {
        this.accepting = false;
      });
  }

  undoTriggerAndClose() {
    const source = this.source;
    const removal = source && source.removal;
    if (!removal || !source.editor || typeof source.editor.getLine !== "function") {
      this.close();
      return;
    }
    const lineText = source.editor.getLine(source.line) || "";
    const from = { line: source.line, ch: removal.start };
    const to = { line: source.line, ch: removal.end };
    const expected = lineText.slice(removal.start, removal.end);
    if (removal.start > lineText.length || removal.end > lineText.length) {
      this.close();
      return;
    }
    void expected;
    if (this.plugin && typeof this.plugin.suppressEditorScans === "function") {
      this.plugin.suppressEditorScans();
    }
    const caret = { line: source.line, ch: removal.caretCh };
    if (typeof source.editor.transaction === "function") {
      source.editor.transaction({
        changes: [{ from, to, text: removal.insert || "" }],
        selections: [{ from: caret, to: caret }],
      });
    } else {
      source.editor.replaceRange(removal.insert || "", from, to);
      if (typeof source.editor.setCursor === "function") {
        source.editor.setCursor(caret);
      }
    }
    this.completed = true;
    this.close();
  }
}
