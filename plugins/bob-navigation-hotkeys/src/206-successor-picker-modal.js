const SUCCESSOR_PICKER_ENTER_GUARD_MS = 350;
const SUCCESSOR_PICKER_COLLAPSE_THRESHOLD = 12;
const SUCCESSOR_PICKER_PREVIEW_ROWS = 4;
const SUCCESSOR_PICKER_FOOTER_HINTS = [
  { keys: ["Tab"], label: "toggle and move" },
  { keys: ["Ctrl+A"], label: "mark group" },
  { keys: ["↵"], label: "pull in" },
  { keys: ["Esc"], label: "none" },
];
const SUCCESSOR_PICKER_VERDICT_HINTS = [
  { keys: ["Tab"], label: "toggle and move" },
  { keys: ["Ctrl+A"], label: "mark group" },
  { keys: ["Ctrl+X"], label: "done" },
  { keys: ["Ctrl+Shift+X"], label: "cancel" },
  { keys: ["↵"], label: "pull in" },
  { keys: ["Esc"], label: "none" },
];
const SUCCESSOR_PICKER_RETARGET_HINT = { keys: ["Ctrl+Shift+Enter"], label: "retarget" };

function successorPickerGroupTitle(group) {
  if (group.group === "hand_off") {
    return "Hand-offs";
  }
  if (group.group === "project_finished") {
    return "Project finished";
  }
  if (group.group === "keep_moving") {
    return `Keep ‹${successorPickerKeepMovingProject(group)}› moving`;
  }
  if (group.group === "relation") {
    return group.header || relationCopyGroupTitle(group.label, group.after && group.after.text);
  }
  const note = successorPickerNoteName(group.project);
  return `Project ‹${note || "project"}›`;
}

// Folded-count lines. Legacy groups keep one line per count. A keep_moving
// group folds into the single `2 blocked · 1 scheduled later · 1 hidden`
// line (zero parts omitted, §12.15 copy table).
function successorPickerFoldedLines(group) {
  const folded = group.folded || {};
  if (group.foldText) {
    return [group.foldText];
  }
  if (group.group === "relation") {
    const fold = relationCopyFold({
      already_started: folded.alreadyStarted,
      blocked: folded.blocked,
      hidden: folded.hidden,
    }, "ui");
    return fold ? [fold] : [];
  }
  if (group.group === "keep_moving") {
    const parts = [];
    if (folded.blocked > 0) {
      parts.push(`${folded.blocked} blocked`);
    }
    if (folded.scheduled > 0) {
      parts.push(`${folded.scheduled} scheduled later`);
    }
    if (folded.hidden > 0) {
      parts.push(`${folded.hidden} hidden`);
    }
    if (folded.alreadyPlanned > 0) {
      parts.push(`${folded.alreadyPlanned} already planned`);
    }
    if (folded.subProjects > 0) {
      parts.push(`${folded.subProjects} sub-project${folded.subProjects === 1 ? "" : "s"}`);
    }
    return parts.length > 0 ? [parts.join(" · ")] : [];
  }
  const lines = [];
  if (folded.hidden > 0) {
    lines.push(`${folded.hidden} hidden`);
  }
  if (folded.alreadyPlanned > 0) {
    lines.push(`${folded.alreadyPlanned} already planned`);
  }
  if (folded.subProjects > 0) {
    const count = folded.subProjects;
    lines.push(`${count} sub-project${count === 1 ? " stays" : "s stay"} blocked until the next reconcile`);
  }
  if (folded.blocked > 0) {
    lines.push(`${folded.blocked} blocked`);
  }
  if (folded.scheduled > 0) {
    lines.push(`${folded.scheduled} scheduled later`);
  }
  return lines;
}

function addSuccessorPickerClasses(element, ...classes) {
  const values = classes.flat().filter(Boolean);
  if (element && element.classList && typeof element.classList.add === "function") {
    element.classList.add(...values);
  } else if (element && typeof element.addClass === "function") {
    values.forEach((value) => element.addClass(value));
  }
}

class SuccessorOfferPickerModal extends FilteredPickerModal {
  constructor(app, model, onSettle, options = {}) {
    const retargetEnabled =
      !options || typeof options !== "object" || options.retarget !== false;
    const normalized = normalizeSuccessorPickerModel(model);
    super(app, {
      items: [],
      title: normalized ? normalized.title : "Choose successor tasks",
      headerIcon: normalized && normalized.relationOnly
        ? "link-2"
        : normalized && normalized.keepMovingOnly ? "skip-forward" : "git-pull-request",
      inputLabel: "Filter successor offers",
      placeholder: "Filter tasks, notes, and groups",
      resultsLabel: "Successor offers",
      emptyText: "No matching offers",
      footerHints: SUCCESSOR_PICKER_FOOTER_HINTS.slice(),
    });
    this.model = normalized;
    this.retargetEnabled = retargetEnabled;
    this.onSettle = typeof onSettle === "function" ? onSettle : () => {};
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.openedAt = null;
    this.markedKeys = new Set();
    // Per-row verdicts (`api.successors` v4): key → {outcome, reason?}.
    // One verdict per row, staged never written, exclusive with marks.
    this.verdicts = new Map();
    this.reasonEditKey = null;
    this.reasonPreviousVerdict = null;
    this.reasonOpenedAt = null;
    this.escArmed = false;
    this.statusLine = null;
    this.allowCloseWithoutArm = false;
    // Per-row destination overrides (key → normalized destination). Shown
    // in the row (`→ NAME`) and returned with the picks. The retarget hint
    // appears only when the destination picker is available.
    this.destinationOverrides = new Map();
    this.retargetingDestination = false;
    try {
      if (retargetEnabled && getSuccessorDestinationPickerApi(this.app)) {
        this.footerHints = SUCCESSOR_PICKER_FOOTER_HINTS.concat([SUCCESSOR_PICKER_RETARGET_HINT]);
      }
    } catch (_error) {
      // No hint without a picker; Ctrl+Shift+Enter stays a no-op.
    }
    this.expandedGroups = new Set();
    this.visibleItems = [];
    this.result = null;
    this.didSettle = false;
    this.onCloseSettled = false;
  }

  open() {
    try {
      return super.open();
    } catch (error) {
      // FilteredPickerModal resets pickerOpen when onOpen throws. Restore it
      // just long enough for its close path to tear down Obsidian's Modal.
      this.pickerOpen = true;
      try {
        super.close();
      } catch (_closeError) {
        this.settle(null);
      }
      throw error;
    }
  }

  onOpen() {
    try {
      try {
        if (typeof successorInstallVerdictModalPatches === "function") {
          successorInstallVerdictModalPatches();
        }
      } catch (_error) {
        // The card renders without verdict keys rather than throwing.
      }
      this.openedAt = this.currentTime();
      super.onOpen();
      addSuccessorPickerClasses(this.contentEl, "bob-cnp-successor");
      if (this.model && this.model.keepMovingOnly) {
        addSuccessorPickerClasses(this.contentEl, "is-keep-moving-only");
      }
      if (this.model && this.model.relationOnly) {
        addSuccessorPickerClasses(this.contentEl, "is-relation-only");
      }
      addSuccessorPickerClasses(this.modalEl, "bob-cnp-successor-modal");
      this.renderAll();
    } catch (error) {
      throw error;
    }
  }

  onClose() {
    if (this.onCloseSettled) {
      return;
    }
    this.onCloseSettled = true;
    try {
      super.onClose();
    } finally {
      this.onSettle(this.result);
    }
  }

  currentTime() {
    try {
      const value = Number(this.now());
      return Number.isFinite(value) ? value : Date.now();
    } catch (_error) {
      return Date.now();
    }
  }

  // Ctrl+Shift+Enter retargets the marked (or highlighted) rows through
  // block-id-prompt's Pomodoro link picker when available. Each target
  // gets its own pick in displayed order so the shown suggestion is that
  // task's. Choices publish only after every pick succeeds; cancel, a
  // changed/missing source, or closing this modal while awaiting leaves
  // previous overrides, marks, and selection unchanged. Never throws.
  successorPickerRetargetAborted() {
    return this.didSettle === true || this.onCloseSettled === true || this.pickerOpen !== true;
  }

  async retargetRowsForDestination() {
    if (this.retargetEnabled === false) {
      return false;
    }
    if (this.retargetingDestination === true || this.successorPickerRetargetAborted()) {
      return false;
    }
    let api = null;
    try {
      api = getSuccessorDestinationPickerApi(this.app);
    } catch (_error) {
      return false;
    }
    if (!api || !this.model) {
      return false;
    }
    const targets = successorPickerRetargetRows(this);
    if (targets.length === 0) {
      try {
        const active = this.visibleItems && this.visibleItems[this.selectedIndex];
        if (active && active.kind === "offer" && this.verdicts instanceof Map &&
          this.verdicts.has(active.row.key) && (this.markedKeys == null || this.markedKeys.size === 0)) {
          this.statusLine = { text: SUCCESSOR_VERDICT_RETARGET_REFUSAL, kind: "refusal" };
          this.escArmed = false;
          this.renderAll();
        }
      } catch (_error) {
        // A missing refusal line never blocks retarget.
      }
      return false;
    }
    this.retargetingDestination = true;
    try {
      const collected = [];
      for (const row of targets) {
        if (this.successorPickerRetargetAborted()) {
          return false;
        }
        let request = {};
        if (row.task) {
          const refreshed = await refreshSuccessorPickerTaskContext(this.app, row.task);
          if (!refreshed || this.successorPickerRetargetAborted()) {
            return false;
          }
          request = successorPickerTaskPickRequest(refreshed);
        }
        const choice = await api.pick(request);
        if (this.successorPickerRetargetAborted()) {
          return false;
        }
        const destination = normalizeSuccessorDestinationOverride(choice);
        if (!destination) {
          return false;
        }
        collected.push([row.key, destination]);
      }
      for (const [key, destination] of collected) {
        this.destinationOverrides.set(key, destination);
      }
      this.renderAll();
      return true;
    } catch (_error) {
      return false;
    } finally {
      this.retargetingDestination = false;
    }
  }

  handleKeydown(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    if (
      event.key === "Enter" &&
      (event.ctrlKey === true || event.metaKey === true) &&
      event.shiftKey === true && event.altKey !== true
    ) {
      if (this.reasonEditKey != null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (this.retargetEnabled !== false) {
        void this.retargetRowsForDestination();
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Esc" ||
      (event.ctrlKey === true && String(event.key || "").toLowerCase() === "[" && event.metaKey !== true && event.altKey !== true && event.shiftKey !== true)) {
      if (this.reasonEditKey != null) {
        return;
      }
      if (this.handleEscapeKey(event)) {
        return;
      }
    }
    if (this.handleVerdictKey(event)) {
      return;
    }
    if (this.escArmed === true && successorModalHasVerdicts(this)) {
      const harmless = event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta";
      if (!harmless) {
        this.escArmed = false;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (
        event.ctrlKey === true || event.metaKey === true || event.altKey === true ||
        event.shiftKey === true || event.repeat === true || event.isComposing === true ||
        event.keyCode === 229 ||
        (this.openedAt !== null && this.currentTime() - this.openedAt < SUCCESSOR_PICKER_ENTER_GUARD_MS)
      ) {
        return;
      }
      const active = this.visibleItems[this.selectedIndex];
      if (this.markedKeys.size > 0 || successorModalHasVerdicts(this)) {
        this.applySelection();
        return;
      }
      if (active && active.kind === "expand") {
        this.expandGroup(active.groupIndex);
        return;
      }
      if (active && active.kind === "offer" && active.row.selectable) {
        this.applySelection();
      }
      return;
    }
    if (
      event.key && String(event.key).toLowerCase() === "a" &&
      (event.ctrlKey === true || event.metaKey === true) && event.altKey !== true
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.markHighlightedGroup();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey === true) {
        this.moveSelection(-1);
      } else {
        const active = this.visibleItems[this.selectedIndex];
        if (active && active.kind === "offer" && active.row.selectable) {
          this.toggleMark(active.row.key);
        }
        this.moveSelection(1);
      }
      return;
    }
    // Unmatched keys go to the base picker for its navigation (↑/↓ and
    // Ctrl+N/Ctrl+P), as every other FilteredPickerModal subclass does.
    // Enter never reaches the base because the Enter branch above always returns.
    super.handleKeydown(event);
  }

  moveSelection(delta) {
    if (this.visibleItems.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex + delta + this.visibleItems.length) % this.visibleItems.length;
    try {
      const highlight = successorStatusForHighlight(this);
      if (highlight) {
        this.statusLine = highlight;
      }
    } catch (_error) {
      // Highlight keeps its previous status line.
    }
    this.renderResults();
  }

  markHighlightedGroup() {
    const active = this.visibleItems[this.selectedIndex];
    if (!active || !this.model) {
      return;
    }
    const group = this.model.groups[active.groupIndex];
    if (!group) {
      return;
    }
    for (const row of group.rows) {
      if (row.selectable) {
        if (this.verdicts instanceof Map && this.verdicts.has(row.key)) {
          continue;
        }
        this.markedKeys.add(row.key);
      }
    }
    this.escArmed = false;
    this.renderAll();
  }

  toggleMark(key) {
    if (!key) {
      return;
    }
    try {
      if (this.verdicts instanceof Map && this.verdicts.has(key)) {
        successorConvertVerdictToMark(this, key);
        this.escArmed = false;
        this.renderAll();
        return;
      }
    } catch (_error) {
      // Fall through to the normal mark toggle.
    }
    if (this.markedKeys.has(key)) {
      this.markedKeys.delete(key);
    } else {
      this.markedKeys.add(key);
    }
    this.escArmed = false;
    this.renderAll();
  }

  expandGroup(groupIndex) {
    this.expandedGroups.add(groupIndex);
    const group = this.model.groups[groupIndex];
    const first = group && group.rows.find((row) => row.selectable);
    this.highlightKeyAfterRender = first ? first.key : null;
    this.renderAll();
  }

  isCollapsed(groupIndex, group, query) {
    return !query && group.group === "project" &&
      this.model.taskRowCount > SUCCESSOR_PICKER_COLLAPSE_THRESHOLD &&
      !this.expandedGroups.has(groupIndex);
  }

  matchingRows(group, query) {
    if (!query) {
      return group.rows.map((row, index) => ({ row, index }));
    }
    const context = [group.header, group.caption, group.tag, group.project, group.foldText, group.label, group.event, successorPickerGroupTitle(group)]
      .join(" ").toLowerCase();
    if (context.includes(query)) {
      return group.rows.map((row, index) => ({ row, index }));
    }
    return group.rows.map((row, index) => ({ row, index })).filter(({ row }) =>
      [row.text, row.notePath, row.status, row.lane, row.destinationLabel, row.mutedReason, row.suffix, row.reason].join(" ").toLowerCase().includes(query),
    );
  }

  prospectiveKeys() {
    if (this.markedKeys.size > 0) {
      return this.model.groups.flatMap((group) => group.rows)
        .filter((row) => row.selectable && this.markedKeys.has(row.key))
        .map((row) => row.key);
    }
    try {
      if (successorModalHasVerdicts(this)) {
        return [];
      }
    } catch (_error) {
      // Fall through to the highlight fallback.
    }
    const active = this.visibleItems[this.selectedIndex];
    return active && active.kind === "offer" && active.row.selectable
      ? [active.row.key]
      : [];
  }

  renderFooter() {
    try {
      this.footerHints = successorVerdictFooterHints(this);
    } catch (_error) {
      // The static hints stay when the verdict hints cannot build.
    }
    super.renderFooter();
    if (!this.footerEl || !this.model) {
      return;
    }
    successorRenderStatusLine(this, this.footerEl);
    const counts = successorVerdictCounts(this);
    const prospective = this.prospectiveKeys().length;
    const summary = this.footerEl.createDiv({ cls: "bob-successor-footer-summary" });
    summary.createSpan({
      cls: "bob-successor-pull-count",
      text: successorFooterSummaryText(prospective, counts.done, counts.cancel),
    });
    if (this.model.budget) {
      const current = this.model.budget.links;
      const maximum = this.model.budget.max;
      const next = current + prospective;
      const over = next > maximum;
      summary.createSpan({
        cls: `bob-successor-plan-meter${over ? " is-over" : ""}`,
        text: `plan ${current}/${maximum} → ${next}/${maximum}${over ? " · over plan" : ""}`,
      });
    }
  }

  renderResults() {
    if (!this.resultsEl || !this.model) {
      return;
    }
    const activeBefore = this.visibleItems[this.selectedIndex];
    const oldKey = activeBefore && activeBefore.kind === "offer" ? activeBefore.row.key : null;
    const query = this.getQuery();
    const navigation = [];
    this.resultsEl.empty();
    for (let groupIndex = 0; groupIndex < this.model.groups.length; groupIndex += 1) {
      const group = this.model.groups[groupIndex];
      const matches = this.matchingRows(group, query);
      if (query && matches.length === 0) {
        continue;
      }
      const groupEl = this.resultsEl.createDiv({ cls: `bob-successor-group is-${group.group}` });
      const heading = groupEl.createDiv({ cls: "bob-successor-group-heading" });
      // A group tag (keep_moving contrast tag) shares the title line,
      // right-aligned; groups without one keep the bare title div.
      const titleRow = group.tag
        ? heading.createDiv({ cls: "bob-successor-group-titlebar" })
        : heading;
      titleRow.createDiv({ cls: "bob-successor-group-title", text: successorPickerGroupTitle(group) });
      if (group.tag) {
        titleRow.createSpan({ cls: "bob-successor-group-tag", text: group.tag });
      }
      if (group.caption) {
        heading.createDiv({ cls: "bob-successor-group-caption", text: group.caption });
      }
      if (group.group === "project" && group.header) {
        heading.createDiv({ cls: "bob-successor-project-task", text: group.header });
      }
      const collapsed = this.isCollapsed(groupIndex, group, query);
      const shown = collapsed ? matches.slice(0, SUCCESSOR_PICKER_PREVIEW_ROWS) : matches;
      for (const { row, index: rowIndex } of shown) {
        const item = { kind: "offer", groupIndex, rowIndex, row };
        const navIndex = navigation.push(item) - 1;
        const selected = navIndex === this.selectedIndex || (this.highlightKeyAfterRender && this.highlightKeyAfterRender === row.key);
        const verdict = this.verdicts instanceof Map ? this.verdicts.get(row.key) : null;
        const classes = ["bob-successor-row"];
        if (selected) classes.push("is-highlighted");
        if (this.markedKeys.has(row.key)) classes.push("is-marked");
        if (verdict && verdict.outcome === SUCCESSOR_VERDICT_DONE) classes.push("is-verdict-done");
        if (verdict && verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) classes.push("is-verdict-cancel");
        if (!row.selectable) classes.push("is-muted");
        const ariaSuffix = successorVerdictRowAriaSuffix(row, verdict);
        const rowEl = groupEl.createDiv({
          cls: classes.join(" "),
          attr: {
            role: "option",
            "aria-selected": selected ? "true" : "false",
            "aria-checked": this.markedKeys.has(row.key) ? "true" : "false",
            "aria-disabled": row.selectable ? "false" : "true",
            ...(ariaSuffix ? { "aria-label": `${row.text} — ${ariaSuffix}` } : {}),
            ...(verdict ? { "data-successor-verdict": verdict.outcome } : {}),
            "data-successor-key": row.key,
          },
        });
        const markText = successorVerdictMarkText(row, verdict) ||
          (this.markedKeys.has(row.key) ? "☑" : "□");
        const markEl = rowEl.createSpan({ cls: "bob-successor-mark", text: markText, attr: { "aria-hidden": "true" } });
        if (verdict) {
          successorApplyVerdictMarkIcon(markEl, verdict);
        }
        if (successorModalVerdictsActive(this) && (selected || verdict)) {
          successorRenderVerdictActions(this, rowEl, row, verdict, navIndex);
        }
        const content = rowEl.createDiv({ cls: "bob-successor-row-content" });
        const titleCls = verdict ? "bob-successor-row-text is-verdict" : "bob-successor-row-text";
        content.createDiv({ cls: titleCls, text: row.text });
        if (this.reasonEditKey === row.key && verdict && verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
          successorRenderReasonEditor(this, content, row, verdict.reason || "");
        } else {
          const details = successorRowDetailsList(this, row, verdict);
          if (details.length > 0) {
            content.createDiv({ cls: "bob-successor-row-details", text: details.join(" · ") });
          }
        }
        const meta = [row.suffix, row.reason].filter(Boolean);
        if (meta.length > 0) {
          content.createDiv({ cls: "bob-successor-row-meta", text: meta.join(" ") });
        }
        rowEl.addEventListener("mousedown", (event) => event.preventDefault());
        rowEl.addEventListener("click", () => {
          this.selectedIndex = navIndex;
          if (row.selectable) this.toggleMark(row.key);
          else this.renderResults();
        });
      }
      if (collapsed && matches.length > shown.length) {
        const remaining = matches.length - shown.length;
        const item = { kind: "expand", groupIndex };
        const navIndex = navigation.push(item) - 1;
        const more = groupEl.createEl("button", {
          cls: `bob-successor-more${navIndex === this.selectedIndex ? " is-highlighted" : ""}`,
          text: `+${remaining} more`,
          attr: { type: "button", "aria-label": `Show ${remaining} more offers in ${successorPickerGroupTitle(group)}` },
        });
        more.addEventListener("mousedown", (event) => event.preventDefault());
        more.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.expandGroup(groupIndex);
        });
      }
      for (const line of successorPickerFoldedLines(group)) {
        groupEl.createDiv({ cls: "bob-successor-folded-count", text: line });
      }
    }
    this.visibleItems = navigation;
    if (this.highlightKeyAfterRender) {
      const desired = navigation.findIndex((item) => item.kind === "offer" && item.row.key === this.highlightKeyAfterRender);
      if (desired >= 0) this.selectedIndex = desired;
      this.highlightKeyAfterRender = null;
    } else if (oldKey) {
      const retained = navigation.findIndex((item) => item.kind === "offer" && item.row.key === oldKey);
      if (retained >= 0) this.selectedIndex = retained;
    }
    if (this.selectedIndex >= navigation.length || this.selectedIndex < 0) {
      this.selectedIndex = navigation.findIndex((item) => item.kind === "offer" && item.row.selectable);
      if (this.selectedIndex < 0) this.selectedIndex = 0;
    }
    if (navigation.length === 0) {
      const empty = this.resultsEl.createDiv({ cls: "bob-cnp-empty" });
      empty.createDiv({ cls: "bob-cnp-empty-text", text: this.emptyText });
    }
    this.updateSubtitle();
    this.renderFooter();
  }

  updateSubtitle() {
    if (!this.subtitleEl || !this.model) return;
    const predecessorCount = this.model.predecessors.length;
    const predecessorText = predecessorCount === 1
      ? this.model.predecessors[0].text || successorPickerNoteName(this.model.predecessors[0].notePath)
      : predecessorCount > 1 ? `${predecessorCount} predecessors` : "Successor offers";
    this.subtitleEl.textContent = `${predecessorText} · ${this.model.selectableCount} offer${this.model.selectableCount === 1 ? "" : "s"}`;
  }

  applySelection() {
    const keys = this.model.groups.flatMap((group) => group.rows)
      .filter((row) => {
        if (!row.selectable || !this.markedKeys.has(row.key)) {
          return false;
        }
        if (this.verdicts instanceof Map && this.verdicts.has(row.key)) {
          return false;
        }
        return true;
      })
      .map((row) => row.key);
    const closes = [];
    try {
      if (this.verdicts instanceof Map) {
        for (const [key, verdict] of this.verdicts) {
          if (!verdict || !key) {
            continue;
          }
          const row = successorFindRowByKey(this, key);
          if (!row || !successorRowVerdictEligible(row, verdict.outcome)) {
            continue;
          }
          if (this.markedKeys instanceof Set && this.markedKeys.has(key)) {
            continue;
          }
          if (verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
            const reason = normalizeSuccessorCancelReason(verdict.reason);
            closes.push(reason ? { key, outcome: "cancelled", reason } : { key, outcome: "cancelled" });
          } else {
            closes.push({ key, outcome: "done" });
          }
        }
      }
    } catch (_error) {
      // Picks still apply without closes rather than refusing the gesture.
    }
    let selected = keys;
    if (selected.length === 0 && closes.length === 0) {
      const active = this.visibleItems[this.selectedIndex];
      if (!active || active.kind !== "offer" || !active.row.selectable) {
        return false;
      }
      selected = [active.row.key];
    }
    this.settle({
      picks: selected.map((key) => {
        const item = { key };
        try {
          const override = this.destinationOverrides && this.destinationOverrides.get(key);
          if (override && typeof override === "object") {
            item.destination = override;
          }
        } catch (_error) {
          // A pick without an override still links at its planned spot.
        }
        return item;
      }),
      ...(closes.length > 0 ? { closes } : {}),
    });
    return true;
  }

  settle(result) {
    if (this.didSettle) return;
    this.didSettle = true;
    const picks = result && Array.isArray(result.picks) ? result.picks : null;
    const closes = result && Array.isArray(result.closes) ? result.closes : null;
    if (picks) {
      this.result = closes ? { picks, closes } : { picks };
    } else {
      this.result = null;
    }
    try {
      this.close();
    } catch (_error) {
      // Cleanup is delivered below even when Obsidian's modal teardown fails.
    }
    if (!this.onCloseSettled) {
      this.onCloseSettled = true;
      try {
        this.onSettle(this.result);
      } catch (_error) {
        // A settled picker never re-opens or rejects its caller.
      }
    }
  }
}

function createSuccessorPickerApi(plugin) {
  return Object.freeze({
    version: 4,
    pick(model) {
      try {
        if (!plugin || plugin.successorPickerUnavailable === true || typeof plugin.pickSuccessorOffers !== "function") {
          return Promise.resolve(null);
        }
        return Promise.resolve()
          .then(() => plugin.pickSuccessorOffers(model))
          .then((result) => {
            try {
              if (!result || !Array.isArray(result.picks)) {
                return null;
              }
              if (result.picks.length === 0 && !(Array.isArray(result.closes) && result.closes.length > 0)) {
                return null;
              }
              return result;
            } catch (_error) {
              return null;
            }
          })
          .catch(() => null);
      } catch (_error) {
        return Promise.resolve(null);
      }
    },
  });
}

class BobNavigationHotkeysSuccessorPickerMixin {
  successorPickerNow() {
    return Date.now();
  }

  beginReviewSuccessorGestureOwner(origin, kind = "capture") {
    try {
      if (!origin || !Number.isInteger(origin.seq) || !Number.isInteger(origin.epoch)) {
        return null;
      }
      const owner = {
        seq: origin.seq,
        epoch: origin.epoch,
        key: successorPickerText(origin.key),
        kind,
        held: false,
      };
      this.reviewSuccessorGestureOwner = owner;
      return owner;
    } catch (_error) {
      return null;
    }
  }

  holdReviewWalkForSuccessorPicker() {
    try {
      const owner = this.reviewSuccessorGestureOwner;
      const landing = this.reviewLanding;
      if (
        !owner ||
        owner.seq !== this.reviewGestureSeq ||
        owner.epoch !== this.reviewLandingEpoch ||
        (owner.key && (!landing || landing.key !== owner.key))
      ) {
        return null;
      }
      owner.held = true;
      this.reviewSuccessorWalkHold = owner;
      return owner;
    } catch (_error) {
      return null;
    }
  }

  isReviewSuccessorWalkHeld() {
    return Boolean(
      this.reviewSuccessorWalkHold &&
      this.reviewSuccessorWalkHold.held === true,
    );
  }

  releaseReviewSuccessorGestureOwner(originOrOwner) {
    try {
      if (!originOrOwner) return false;
      const owner = originOrOwner && originOrOwner.held !== undefined
        ? originOrOwner
        : this.reviewSuccessorGestureOwner;
      if (!owner) return false;
      if (
        originOrOwner && originOrOwner.seq !== undefined &&
        (owner.seq !== originOrOwner.seq || owner.epoch !== originOrOwner.epoch)
      ) {
        return false;
      }
      owner.held = false;
      if (this.reviewSuccessorWalkHold === owner) {
        this.reviewSuccessorWalkHold = null;
      }
      if (this.reviewSuccessorGestureOwner === owner) {
        this.reviewSuccessorGestureOwner = null;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  pickSuccessorOffers(model, options = {}) {
    try {
      if (
        this.successorPickerUnavailable === true ||
        this.activeSuccessorPicker ||
        !normalizeSuccessorPickerModel(model)
      ) {
        return Promise.resolve(null);
      }
      this.holdReviewWalkForSuccessorPicker();
      const retargetEnabled =
        !options || typeof options !== "object" || options.retarget !== false;
      return new Promise((resolve) => {
        let modal = null;
        let settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          if (this.activeSuccessorPicker === modal) {
            this.activeSuccessorPicker = null;
          }
          try {
            if (result && Array.isArray(result.picks)) {
              const normalized = normalizeSuccessorPickerModel(model);
              if (!normalized) {
                resolve(null);
                return;
              }
              const byKey = new Map();
              for (const group of normalized.groups) {
                for (const row of group.rows) {
                  if (row && typeof row.key === "string" && !byKey.has(row.key)) {
                    byKey.set(row.key, row);
                  }
                }
              }
              const allowed = new Set([...byKey].filter(([, row]) => row.selectable).map(([key]) => key));
              const picks = [];
              const pickedKeys = new Set();
              for (const pick of result.picks) {
                const key = pick && typeof pick.key === "string" ? pick.key : "";
                if (!allowed.has(key) || pickedKeys.has(key)) continue;
                pickedKeys.add(key);
                const item = { key };
                if (retargetEnabled) {
                  const destination = normalizeSuccessorDestinationOverride(pick && pick.destination);
                  if (destination) {
                    item.destination = destination;
                  }
                }
                picks.push(item);
              }
              const closes = normalizeSuccessorClosesForResult({ model: normalized }, result.closes);
              const kept = closes.filter((close) => !pickedKeys.has(close.key));
              if (picks.length === 0 && kept.length === 0) {
                resolve(null);
                return;
              }
              resolve(kept.length > 0 ? { picks, closes: kept } : { picks });
            } else {
              resolve(null);
            }
          } catch (_error) {
            resolve(null);
          }
        };
        try {
          modal = new SuccessorOfferPickerModal(
            this.app,
            model,
            settle,
            { now: () => this.successorPickerNow(), retarget: retargetEnabled },
          );
          this.activeSuccessorPicker = modal;
          modal.open();
          if (!modal.pickerOpen) settle(null);
        } catch (_error) {
          if (modal) {
            try {
              modal.settle(null);
            } catch (_settleError) {
              settle(null);
            }
          } else {
            settle(null);
          }
        }
      });
    } catch (_error) {
      return Promise.resolve(null);
    }
  }

  closeSuccessorPickerForUnload() {
    const modal = this.activeSuccessorPicker;
    if (modal) {
      try {
        modal.allowCloseWithoutArm = true;
        modal.close();
      } catch (_error) {
        try {
          modal.settle(null);
        } catch (_settleError) {
          this.activeSuccessorPicker = null;
        }
      }
    }
    this.activeSuccessorPicker = null;
    this.releaseReviewSuccessorGestureOwner(this.reviewSuccessorGestureOwner);
    this.reviewSuccessorWalkHold = null;
    this.reviewSuccessorGestureOwner = null;
  }
}
