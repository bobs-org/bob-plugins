const SUCCESSOR_PICKER_ENTER_GUARD_MS = 350;
const SUCCESSOR_PICKER_COLLAPSE_THRESHOLD = 12;
const SUCCESSOR_PICKER_PREVIEW_ROWS = 4;
const SUCCESSOR_PICKER_FOOTER_HINTS = [
  { keys: ["Tab"], label: "toggle and move" },
  { keys: ["Ctrl+A"], label: "mark group" },
  { keys: ["↵"], label: "pull in" },
  { keys: ["Esc"], label: "none" },
];
const SUCCESSOR_PICKER_RETARGET_HINT = { keys: ["Ctrl+Shift+Enter"], label: "retarget" };

// Per-row destination override (docs/task-dependencies.md §12.13,
// obsidian_destination): `{kind: "existing", entryLine, entryText, title?} |
// {kind: "new", name}`. Null unless the shape is exact.
function normalizeSuccessorDestinationOverride(choice) {
  try {
    if (!choice || typeof choice !== "object") {
      return null;
    }
    if (choice.kind === "existing") {
      if (!Number.isInteger(choice.entryLine) || choice.entryLine < 0) {
        return null;
      }
      if (typeof choice.entryText !== "string" || !choice.entryText) {
        return null;
      }
      const title = typeof choice.title === "string" ? choice.title.trim() : "";
      return Object.freeze({
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        ...(title ? { title } : {}),
      });
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return Object.freeze({ kind: "new", name });
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function successorDestinationOverrideLabel(destination) {
  try {
    if (!destination || typeof destination !== "object") {
      return "";
    }
    if (destination.kind === "new") {
      return typeof destination.name === "string" ? destination.name.trim() : "";
    }
    if (destination.kind === "existing") {
      if (typeof destination.title === "string" && destination.title.trim()) {
        return destination.title.trim();
      }
      if (typeof destination.name === "string" && destination.name.trim()) {
        return destination.name.trim();
      }
      if (Number.isInteger(destination.entryLine)) {
        return `line ${destination.entryLine + 1}`;
      }
    }
    return "";
  } catch (_error) {
    return "";
  }
}

// Defensive feature detection for block-id-prompt
// `api.pomodoroLinkPicker` v1 (§12.13). Null when the plugin is missing,
// older, or torn down.
function getSuccessorDestinationPickerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const prompt = plugins["block-id-prompt"];
    const api = prompt && prompt.api;
    const picker = api && api.pomodoroLinkPicker;
    if (!picker || !(Number(picker.version) >= 1)) {
      return null;
    }
    if (typeof picker.pick !== "function") {
      return null;
    }
    return picker;
  } catch (_error) {
    return null;
  }
}

function successorPickerText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function successorPickerCount(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value))
    : 0;
}

function successorPickerNoteName(path) {
  const value = successorPickerText(path);
  const leaf = value.split("/").pop() || value;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

function normalizeSuccessorPickerModel(model) {
  try {
    if (!model || typeof model !== "object" || !Array.isArray(model.groups)) {
      return null;
    }
    const allowedGroups = new Set(["hand_off", "project", "project_finished"]);
    const seenKeys = new Set();
    const groups = [];
    let selectableCount = 0;
    let taskRowCount = 0;
    for (const source of model.groups) {
      if (!source || typeof source !== "object" || !allowedGroups.has(source.group)) {
        continue;
      }
      const rows = [];
      for (const row of Array.isArray(source.rows) ? source.rows : []) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const key = typeof row.key === "string" ? row.key : "";
        const text = successorPickerText(row.text);
        if (!key || !text || seenKeys.has(key)) {
          if (key && seenKeys.has(key)) {
            return null;
          }
          continue;
        }
        if (typeof row.notePath !== "string" || typeof row.selectable !== "boolean") {
          continue;
        }
        const normalized = Object.freeze({
          key,
          text,
          notePath: row.notePath,
          status: successorPickerText(row.status),
          destinationLabel: successorPickerText(row.destinationLabel),
          needsBlockId: row.needsBlockId === true,
          selectable: row.selectable,
          mutedReason: successorPickerText(row.mutedReason),
          destination: row.destination,
        });
        seenKeys.add(key);
        rows.push(normalized);
        taskRowCount += 1;
        if (normalized.selectable) {
          selectableCount += 1;
        }
      }
      const folded = source.folded && typeof source.folded === "object"
        ? Object.freeze({
            hidden: successorPickerCount(source.folded.hidden),
            alreadyPlanned: successorPickerCount(source.folded.alreadyPlanned),
            subProjects: successorPickerCount(source.folded.subProjects),
          })
        : Object.freeze({ hidden: 0, alreadyPlanned: 0, subProjects: 0 });
      groups.push(Object.freeze({
        group: source.group,
        header: successorPickerText(source.header),
        project: successorPickerText(source.project),
        rows: Object.freeze(rows),
        folded,
      }));
    }
    if (selectableCount === 0 || groups.length === 0) {
      return null;
    }
    const budget = model.budget && typeof model.budget === "object"
      ? Object.freeze({
          links: successorPickerCount(model.budget.links),
          max: successorPickerCount(model.budget.max),
        })
      : null;
    const predecessors = Array.isArray(model.predecessors)
      ? model.predecessors.filter((row) => row && typeof row === "object").map((row) => Object.freeze({
          notePath: successorPickerText(row.notePath),
          blockId: successorPickerText(row.blockId),
          text: successorPickerText(row.text),
        }))
      : [];
    return Object.freeze({
      title: successorPickerText(model.title) || "Choose successor tasks",
      predecessors: Object.freeze(predecessors),
      groups: Object.freeze(groups),
      budget,
      selectableCount,
      taskRowCount,
    });
  } catch (_error) {
    return null;
  }
}

function successorPickerGroupTitle(group) {
  if (group.group === "hand_off") {
    return "Hand-offs";
  }
  if (group.group === "project_finished") {
    return "Project finished";
  }
  const note = successorPickerNoteName(group.project);
  return `Project ‹${note || "project"}›`;
}

function successorPickerFoldedLines(group) {
  const folded = group.folded || {};
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
    const normalized = normalizeSuccessorPickerModel(model);
    super(app, {
      items: [],
      title: normalized ? normalized.title : "Choose successor tasks",
      headerIcon: "git-pull-request",
      inputLabel: "Filter successor offers",
      placeholder: "Filter tasks, notes, and groups",
      resultsLabel: "Successor offers",
      emptyText: "No matching offers",
      footerHints: SUCCESSOR_PICKER_FOOTER_HINTS.slice(),
    });
    this.model = normalized;
    this.onSettle = typeof onSettle === "function" ? onSettle : () => {};
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.openedAt = null;
    this.markedKeys = new Set();
    // Per-row destination overrides (key → normalized destination). Shown
    // in the row (`→ NAME`) and returned with the picks. The retarget hint
    // appears only when the destination picker is available.
    this.destinationOverrides = new Map();
    this.retargetingDestination = false;
    try {
      if (getSuccessorDestinationPickerApi(this.app)) {
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
      this.openedAt = this.currentTime();
      super.onOpen();
      addSuccessorPickerClasses(this.contentEl, "bob-cnp-successor");
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
  // block-id-prompt's Pomodoro link picker when available; a cancelled
  // destination pick leaves this picker exactly as it was. Never throws.
  async retargetRowsForDestination() {
    if (this.retargetingDestination === true || this.didSettle === true) {
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
    const targets = [];
    try {
      if (this.markedKeys.size > 0) {
        for (const group of this.model.groups) {
          for (const row of group.rows) {
            if (row.selectable && this.markedKeys.has(row.key)) {
              targets.push(row.key);
            }
          }
        }
      } else {
        const active = this.visibleItems[this.selectedIndex];
        if (active && active.kind === "offer" && active.row.selectable) {
          targets.push(active.row.key);
        }
      }
    } catch (_error) {
      return false;
    }
    if (targets.length === 0) {
      return false;
    }
    this.retargetingDestination = true;
    try {
      const choice = await api.pick();
      const destination = normalizeSuccessorDestinationOverride(choice);
      if (!destination) {
        return false;
      }
      for (const key of targets) {
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
      event.preventDefault();
      event.stopPropagation();
      void this.retargetRowsForDestination();
      return;
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
      if (this.markedKeys.size > 0) {
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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
    }
  }

  moveSelection(delta) {
    if (this.visibleItems.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex + delta + this.visibleItems.length) % this.visibleItems.length;
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
        this.markedKeys.add(row.key);
      }
    }
    this.renderAll();
  }

  toggleMark(key) {
    if (!key) {
      return;
    }
    if (this.markedKeys.has(key)) {
      this.markedKeys.delete(key);
    } else {
      this.markedKeys.add(key);
    }
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
    const context = [group.header, group.project, successorPickerGroupTitle(group)].join(" ").toLowerCase();
    if (context.includes(query)) {
      return group.rows.map((row, index) => ({ row, index }));
    }
    return group.rows.map((row, index) => ({ row, index })).filter(({ row }) =>
      [row.text, row.notePath, row.status, row.destinationLabel, row.mutedReason].join(" ").toLowerCase().includes(query),
    );
  }

  prospectiveKeys() {
    if (this.markedKeys.size > 0) {
      return this.model.groups.flatMap((group) => group.rows)
        .filter((row) => row.selectable && this.markedKeys.has(row.key))
        .map((row) => row.key);
    }
    const active = this.visibleItems[this.selectedIndex];
    return active && active.kind === "offer" && active.row.selectable
      ? [active.row.key]
      : [];
  }

  renderFooter() {
    super.renderFooter();
    if (!this.footerEl || !this.model) {
      return;
    }
    const prospective = this.prospectiveKeys().length;
    const summary = this.footerEl.createDiv({ cls: "bob-successor-footer-summary" });
    summary.createSpan({ cls: "bob-successor-pull-count", text: `pull in ${prospective}` });
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
      heading.createDiv({ cls: "bob-successor-group-title", text: successorPickerGroupTitle(group) });
      if (group.group === "project" && group.header) {
        heading.createDiv({ cls: "bob-successor-project-task", text: group.header });
      }
      const collapsed = this.isCollapsed(groupIndex, group, query);
      const shown = collapsed ? matches.slice(0, SUCCESSOR_PICKER_PREVIEW_ROWS) : matches;
      for (const { row, index: rowIndex } of shown) {
        const item = { kind: "offer", groupIndex, rowIndex, row };
        const navIndex = navigation.push(item) - 1;
        const selected = navIndex === this.selectedIndex || (this.highlightKeyAfterRender && this.highlightKeyAfterRender === row.key);
        const classes = ["bob-successor-row"];
        if (selected) classes.push("is-highlighted");
        if (this.markedKeys.has(row.key)) classes.push("is-marked");
        if (!row.selectable) classes.push("is-muted");
        const rowEl = groupEl.createDiv({
          cls: classes.join(" "),
          attr: {
            role: "option",
            "aria-selected": selected ? "true" : "false",
            "aria-checked": this.markedKeys.has(row.key) ? "true" : "false",
            "aria-disabled": row.selectable ? "false" : "true",
          },
        });
        rowEl.createSpan({ cls: "bob-successor-mark", text: this.markedKeys.has(row.key) ? "☑" : "□", attr: { "aria-hidden": "true" } });
        const content = rowEl.createDiv({ cls: "bob-successor-row-content" });
        content.createDiv({ cls: "bob-successor-row-text", text: row.text });
        const note = successorPickerNoteName(row.notePath);
        const details = [];
        if (note) details.push(note);
        if (row.status) details.push(row.status);
        let shownDestination = row.destinationLabel;
        try {
          const override = this.destinationOverrides && this.destinationOverrides.get(row.key);
          const overrideLabel = successorDestinationOverrideLabel(override);
          if (overrideLabel) {
            shownDestination = overrideLabel;
          }
        } catch (_error) {
          // Fall through to the planned destination label.
        }
        if (shownDestination) details.push(`→ ${shownDestination}`);
        if (row.needsBlockId) details.push("needs ^id");
        if (!row.selectable && row.mutedReason) details.push(row.mutedReason);
        if (details.length > 0) {
          content.createDiv({ cls: "bob-successor-row-details", text: details.join(" · ") });
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
      .filter((row) => row.selectable && this.markedKeys.has(row.key))
      .map((row) => row.key);
    let selected = keys;
    if (selected.length === 0) {
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
    });
    return true;
  }

  settle(result) {
    if (this.didSettle) return;
    this.didSettle = true;
    this.result = result && Array.isArray(result.picks) ? result : null;
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
    version: 1,
    pick(model) {
      try {
        if (!plugin || plugin.successorPickerUnavailable === true || typeof plugin.pickSuccessorOffers !== "function") {
          return Promise.resolve(null);
        }
        return Promise.resolve()
          .then(() => plugin.pickSuccessorOffers(model))
          .then((result) => {
            try {
              return result && Array.isArray(result.picks) ? result : null;
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

  pickSuccessorOffers(model) {
    try {
      if (
        this.successorPickerUnavailable === true ||
        this.activeSuccessorPicker ||
        !normalizeSuccessorPickerModel(model)
      ) {
        return Promise.resolve(null);
      }
      this.holdReviewWalkForSuccessorPicker();
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
              const allowed = new Set(normalized.groups.flatMap((group) =>
                group.rows.filter((row) => row.selectable).map((row) => row.key),
              ));
              const picks = [];
              const pickedKeys = new Set();
              for (const pick of result.picks) {
                const key = pick && typeof pick.key === "string" ? pick.key : "";
                if (!allowed.has(key) || pickedKeys.has(key)) continue;
                pickedKeys.add(key);
                const item = { key };
                const destination = normalizeSuccessorDestinationOverride(pick && pick.destination);
                if (destination) {
                  item.destination = destination;
                }
                picks.push(item);
              }
              resolve(picks.length > 0 ? { picks } : null);
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
            { now: () => this.successorPickerNow() },
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
