function getEditorViewFromEditor(editorOrCm) {
  // Resolve the underlying CodeMirror 6 EditorView from every editor shape this
  // codebase hands us: the codemirror-vim CM5 adapter (its CM6 view is `.cm6`),
  // an Obsidian Editor (its CM6 view is `.cm`), or a raw EditorView (itself).
  const editorView =
    editorOrCm && (editorOrCm.cm6 || editorOrCm.cm || editorOrCm);
  if (
    !editorView ||
    !editorView.state ||
    !editorView.state.doc ||
    typeof editorView.dispatch !== "function"
  ) {
    return null;
  }

  return editorView;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max) {
  const safeMin = finiteNumberOrNull(min);
  const safeMax = finiteNumberOrNull(max);
  const lower = safeMin === null ? 0 : safeMin;
  const upper =
    safeMax === null ? Number.POSITIVE_INFINITY : Math.max(lower, safeMax);
  return Math.min(Math.max(Number(value) || 0, lower), upper);
}

function getElementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  try {
    const rect = element.getBoundingClientRect();
    if (
      !rect ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.bottom) ||
      rect.bottom <= rect.top
    ) {
      return null;
    }

    return rect;
  } catch (error) {
    return null;
  }
}

function getVerticalIntersectionHeight(rect, viewportRect) {
  if (!rect || !viewportRect) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(rect.bottom, viewportRect.bottom) -
      Math.max(rect.top, viewportRect.top),
  );
}

function getScrollDOMMaxScrollTop(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollHeight = finiteNumberOrNull(scrollDOM.scrollHeight);
  const clientHeight = finiteNumberOrNull(scrollDOM.clientHeight);
  if (scrollHeight === null || clientHeight === null || clientHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, scrollHeight - clientHeight);
}

function getRenderedTasksQueryScrollBounds(scrollDOM, queryRect, viewportRect) {
  if (!scrollDOM || !queryRect || !viewportRect) {
    return null;
  }

  const currentScrollTop = finiteNumberOrNull(scrollDOM.scrollTop);
  const viewportHeight =
    finiteNumberOrNull(scrollDOM.clientHeight) ||
    finiteNumberOrNull(viewportRect.height) ||
    viewportRect.bottom - viewportRect.top;
  if (
    currentScrollTop === null ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return null;
  }

  const queryTop = currentScrollTop + queryRect.top - viewportRect.top;
  const queryBottom = currentScrollTop + queryRect.bottom - viewportRect.top;
  if (
    !Number.isFinite(queryTop) ||
    !Number.isFinite(queryBottom) ||
    queryBottom <= queryTop
  ) {
    return null;
  }

  const maxScrollTop = getScrollDOMMaxScrollTop(scrollDOM);
  const startScrollTop = clampNumber(
    queryTop - RENDERED_TASKS_SCROLL_PADDING_PX,
    0,
    maxScrollTop,
  );
  const endScrollTop = clampNumber(
    Math.max(
      startScrollTop,
      queryBottom - viewportHeight + RENDERED_TASKS_SCROLL_PADDING_PX,
    ),
    0,
    maxScrollTop,
  );

  return {
    currentScrollTop,
    startScrollTop,
    endScrollTop,
    maxScrollTop,
    viewportHeight,
  };
}

function getRenderedTasksQueryScrollPlan(scrollDOM, queryRect, viewportRect, direction) {
  const bounds = getRenderedTasksQueryScrollBounds(
    scrollDOM,
    queryRect,
    viewportRect,
  );
  if (!bounds) {
    return null;
  }

  const normalizedDirection = direction >= 0 ? 1 : -1;
  const scrollAmount = Math.max(1, Math.floor(bounds.viewportHeight / 2));
  let targetScrollTop;

  if (normalizedDirection > 0) {
    if (
      bounds.currentScrollTop >=
      bounds.endScrollTop - RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX
    ) {
      return null;
    }

    const proposedScrollTop = bounds.currentScrollTop + scrollAmount;
    targetScrollTop =
      bounds.currentScrollTop <
      bounds.startScrollTop - RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX
        ? Math.min(proposedScrollTop, bounds.startScrollTop)
        : Math.min(proposedScrollTop, bounds.endScrollTop);
  } else {
    if (
      bounds.currentScrollTop <=
      bounds.startScrollTop + RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX
    ) {
      return null;
    }

    const proposedScrollTop = bounds.currentScrollTop - scrollAmount;
    targetScrollTop =
      bounds.currentScrollTop >
      bounds.endScrollTop + RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX
        ? Math.max(proposedScrollTop, bounds.endScrollTop)
        : Math.max(proposedScrollTop, bounds.startScrollTop);
  }

  targetScrollTop = clampNumber(targetScrollTop, 0, bounds.maxScrollTop);
  if (
    Math.abs(targetScrollTop - bounds.currentScrollTop) <
    RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX
  ) {
    return null;
  }

  return {
    ...bounds,
    direction: normalizedDirection,
    targetScrollTop,
  };
}

function editorViewPositionFromLineCh(editorView, line, ch) {
  const doc = editorView && editorView.state && editorView.state.doc;
  if (!doc || typeof doc.line !== "function") {
    return null;
  }

  const lineCount = Number.isInteger(doc.lines) && doc.lines > 0 ? doc.lines : 1;
  const safeLine = Math.min(
    Math.max(Math.floor(Number(line) || 0), 0),
    lineCount - 1,
  );

  let lineInfo;
  try {
    lineInfo = doc.line(safeLine + 1);
  } catch (error) {
    return null;
  }

  if (
    !lineInfo ||
    !Number.isInteger(lineInfo.from) ||
    !Number.isInteger(lineInfo.to)
  ) {
    return null;
  }

  const maxCh = Math.max(lineInfo.to - lineInfo.from, 0);
  const safeCh = Math.min(Math.max(Math.floor(Number(ch) || 0), 0), maxCh);
  return lineInfo.from + safeCh;
}

function centerEditorViewOnPosition(editorView, line, ch) {
  if (
    !editorView ||
    typeof editorView.dispatch !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const position = editorViewPositionFromLineCh(editorView, line, ch);
  if (position === null) {
    return false;
  }

  try {
    editorView.dispatch({
      effects: EditorView.scrollIntoView(position, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Bounded number of animation frames to wait for the target editor view to
// attach before falling back to an editor-level reveal. One frame is usually
// enough for the active editor; the small budget only covers the rare case
// where the CM6 view lags by a frame right after the completion edits.
const CENTER_ON_LINE_ATTEMPTS = 5;

// Defer `callback` past the current synchronous turn (e.g. the codemirror-vim
// command cycle) so any scroll it dispatches runs after Vim's own trailing
// "keep cursor visible" scroll. Returns a handle that cancelDeferred can clear.
function deferToNextFrame(callback) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return { type: "raf", handle: window.requestAnimationFrame(callback) };
  }

  return { type: "timeout", handle: setTimeout(callback, 0) };
}

function cancelDeferred(deferred) {
  if (!deferred) {
    return;
  }

  if (
    deferred.type === "raf" &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(deferred.handle);
    return;
  }

  if (deferred.type === "timeout") {
    clearTimeout(deferred.handle);
  }
}

function isCtrlKey(event, key) {
  return (
    !!event &&
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
    // Icons are decorative; rendering should continue without them.
  }
}

function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!el) {
    return;
  }

  if (!query || typeof el.createSpan !== "function") {
    if (typeof el.appendText === "function") {
      el.appendText(source);
    } else {
      el.textContent = source;
    }
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = String(query).toLowerCase();
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
      cls: "tsc-sdp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function focusElementSoon(el) {
  if (!el || typeof el.focus !== "function") {
    return;
  }

  el.focus();
  const schedule =
    typeof window !== "undefined" && typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : typeof setTimeout === "function"
        ? setTimeout
        : null;
  if (!schedule) {
    return;
  }

  schedule(() => {
    if (el && typeof el.focus === "function") {
      el.focus();
    }
  }, 0);
}

class DemotionSectionPickerModal extends Modal {
  constructor(app, plugin, snapshot) {
    super(app);
    this.plugin = plugin;
    this.snapshot = snapshot;
    this.state = createDemotionSectionPickerState(
      snapshot && snapshot.plan && snapshot.plan.headings,
      "",
      snapshot && snapshot.plan && snapshot.plan.promptKind,
    );
    this.completed = false;
    this.submitting = false;
    this.inputEl = null;
    this.resultsEl = null;
    this.statusEl = null;
    this.previewEl = null;
    this.rowEls = [];
  }

  onOpen() {
    const { contentEl } = this;
    if (contentEl && typeof contentEl.empty === "function") {
      contentEl.empty();
    }
    if (this.modalEl && typeof this.modalEl.addClass === "function") {
      this.modalEl.addClass("tsc-sdp-modal");
    }
    if (contentEl && typeof contentEl.addClass === "function") {
      contentEl.addClass("tsc-sdp");
    }

    const header = contentEl.createDiv({ cls: "tsc-sdp-header" });
    const headerIcon = header.createDiv({ cls: "tsc-sdp-header-icon" });
    applyIcon(headerIcon, "list-tree");
    const headerText = header.createDiv({ cls: "tsc-sdp-header-text" });
    headerText.createDiv({
      cls: "tsc-sdp-title",
      text: DEMOTION_PICKER_TITLE,
    });
    headerText.createDiv({
      cls: "tsc-sdp-subtitle",
      text: DEMOTION_PICKER_SUBTITLE,
    });

    const preview = contentEl.createDiv({ cls: "tsc-sdp-preview" });
    preview.createDiv({
      cls: "tsc-sdp-preview-label",
      text: "Moving",
    });
    this.previewEl = preview.createDiv({ cls: "tsc-sdp-preview-text" });
    this.previewEl.textContent =
      (this.snapshot && this.snapshot.plan && this.snapshot.plan.previewText) ||
      "";

    const searchEl = contentEl.createDiv({ cls: "tsc-sdp-search" });
    const searchIcon = searchEl.createDiv({ cls: "tsc-sdp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "tsc-sdp-input",
      attr: {
        type: "text",
        role: "combobox",
        "aria-label": DEMOTION_PICKER_INPUT_LABEL,
        "aria-autocomplete": "list",
        "aria-expanded": "true",
        "aria-controls": "tsc-sdp-results",
        placeholder: DEMOTION_PICKER_TASKS_ONLY_PLACEHOLDER,
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.state = setDemotionPickerQuery(this.state, this.inputEl.value);
      this.renderResults();
    });
    this.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));

    this.statusEl = contentEl.createDiv({
      cls: "tsc-sdp-status",
      attr: {
        role: "status",
        "aria-live": "polite",
      },
    });

    this.resultsEl = contentEl.createDiv({
      cls: "tsc-sdp-results",
      attr: {
        id: "tsc-sdp-results",
        role: "listbox",
        "aria-label": DEMOTION_PICKER_RESULTS_LABEL,
      },
    });

    this.renderFooter(contentEl);
    this.renderResults();
    focusElementSoon(this.inputEl);
  }

  renderFooter(contentEl) {
    const footerEl = contentEl.createDiv({ cls: "tsc-sdp-footer" });
    DEMOTION_PICKER_HINTS.forEach((hint) => {
      const group = footerEl.createDiv({ cls: "tsc-sdp-hint" });
      hint.keys.forEach((key) =>
        group.createEl("kbd", { cls: "tsc-sdp-kbd", text: key }),
      );
      group.createEl("span", { cls: "tsc-sdp-hint-label", text: hint.label });
    });
  }

  onClose() {
    if (this.modalEl && typeof this.modalEl.removeClass === "function") {
      this.modalEl.removeClass("tsc-sdp-modal");
    }
    if (this.contentEl && typeof this.contentEl.empty === "function") {
      this.contentEl.empty();
    }
    if (this.plugin && typeof this.plugin.clearDemotionSectionPicker === "function") {
      this.plugin.clearDemotionSectionPicker(this);
    }
  }

  handleKeydown(event) {
    if (!event) {
      return;
    }

    if (event.key === "ArrowDown" || isCtrlKey(event, "n")) {
      event.preventDefault();
      event.stopPropagation();
      this.state = moveDemotionPickerSelection(this.state, 1);
      this.renderResults();
      return;
    }

    if (event.key === "ArrowUp" || isCtrlKey(event, "p")) {
      event.preventDefault();
      event.stopPropagation();
      this.state = moveDemotionPickerSelection(this.state, -1);
      this.renderResults();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.acceptSelected();
    }
  }

  renderResults() {
    if (!this.resultsEl) {
      return;
    }

    const model = getDemotionSectionPickerModel(this.state);
    this.resultsEl.empty();
    this.rowEls = [];

    if (this.statusEl) {
      this.statusEl.textContent = model.statusText || "";
      if (model.selectedPrimary && model.selectedPrimary.kind === "invalid") {
        if (typeof this.statusEl.addClass === "function") {
          this.statusEl.addClass("is-invalid");
        }
      } else if (typeof this.statusEl.removeClass === "function") {
        this.statusEl.removeClass("is-invalid");
      }
    }

    if (this.inputEl && typeof this.inputEl.setAttribute === "function") {
      this.inputEl.setAttribute(
        "placeholder",
        model.inputPlaceholder || DEMOTION_PICKER_EXISTING_PLACEHOLDER,
      );
      this.inputEl.setAttribute(
        "aria-activedescendant",
        `tsc-sdp-option-${model.selectedIndex}`,
      );
      this.inputEl.setAttribute(
        "aria-invalid",
        model.selectedPrimary && model.selectedPrimary.kind === "invalid"
          ? "true"
          : "false",
      );
    }

    const query = String(model.query || "").trim();
    model.rows.forEach((row, index) => {
      const isSelected = index === model.selectedIndex;
      const rowEl = this.resultsEl.createDiv({
        cls: getDemotionSectionPickerRowClasses(row, isSelected).join(" "),
        attr: {
          id: `tsc-sdp-option-${index}`,
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      const textEl = rowEl.createDiv({ cls: "tsc-sdp-row-text" });
      const titleEl = textEl.createDiv({ cls: "tsc-sdp-row-title" });
      appendHighlighted(titleEl, row.title, query);
      if (row.meta) {
        textEl.createDiv({ cls: "tsc-sdp-row-meta", text: row.meta });
      }

      rowEl.createDiv({
        cls: [
          "tsc-sdp-badge",
          row.type === "primary" && row.primary && row.primary.kind === "create"
            ? "is-create"
            : "",
          row.type === "primary" && row.primary && row.primary.kind === "invalid"
            ? "is-invalid"
            : "",
          row.type === "existing" ||
          (row.type === "primary" && row.primary && row.primary.kind === "existing")
            ? "is-existing"
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        text: row.badge,
      });

      rowEl.addEventListener("mousedown", (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
      });
      rowEl.addEventListener("click", () => this.acceptIndex(index));
      this.rowEls.push(rowEl);

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
    });

    if (model.emptyExisting) {
      const emptyEl = this.resultsEl.createDiv({ cls: "tsc-sdp-empty" });
      const emptyIcon = emptyEl.createDiv({ cls: "tsc-sdp-empty-icon" });
      applyIcon(emptyIcon, "file-question");
      emptyEl.createDiv({
        cls: "tsc-sdp-empty-text",
        text: model.emptyText,
      });
    }
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

  acceptSelected() {
    const model = getDemotionSectionPickerModel(this.state);
    return this.acceptIndex(model.selectedIndex);
  }

  acceptIndex(index) {
    if (this.submitting || this.completed) {
      return false;
    }

    const model = getDemotionSectionPickerModel(this.state);
    const row = model.rows[index];
    const destination = getDemotionDestinationFromRow(row);
    if (!destination || !this.plugin) {
      return false;
    }

    return this.plugin.submitDemotionSectionPicker(this, destination);
  }
}

