// Bob Command Mode: sequence marking, tray, review card, and RECENT rows.
// Patches CommandModeSheetModal. Sits after 176-sheet-keys.js, so its
// handleSheetKeydown wrapper is outermost and sees raw events.
function cmSheetSequenceMarks(sheet) {
  if (!sheet) return [];
  if (!Array.isArray(sheet.sequenceMarks)) sheet.sequenceMarks = [];
  return sheet.sequenceMarks;
}

function cmSheetIsMarkKey(event) {
  if (!event || typeof event.key !== "string") return false;
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "");
  return key === "m" || code === "KeyM";
}

function cmSheetSequenceEntryEffect(entry, row, field, fallback) {
  if (row && row[field] !== undefined && row[field] !== null && row[field] !== "") return row[field];
  if (entry && entry[field] !== undefined && entry[field] !== null) return entry[field];
  return fallback;
}

// Pure: build a tray step from a sheet row, or { refused: reason }.
function cmSheetSequenceStep(row, catalog) {
  if (!row) return { refused: "Only bob commands can join a sequence" };
  if (row.unavailable) return { refused: String(row.unavailable) };
  const kind = row.kind || "";
  if (kind === "excluded") return { refused: String(row.unavailable || "That command is excluded") };
  if (kind === "surface" || kind === "plain" || kind === "vim" || kind === "vim-suggestion") {
    return { refused: "Only bob commands can join a sequence" };
  }
  if (kind === "recent" && (row.sequenceId || row.steps)) {
    return { refused: "Sequences load with Ctrl+M" };
  }
  if (kind === "recent") {
    if (row.preview) return { refused: "Previews can't join a sequence" };
    if (row.hasPreview && row.preview) return { refused: "Previews can't join a sequence" };
  }
  if (kind !== "entry" && kind !== "typed" && kind !== "recent") {
    return { refused: "Only bob commands can join a sequence" };
  }
  const argv = cmSheetRowArgv(row);
  if (!Array.isArray(argv) || !argv.length) return { refused: "Only bob commands can join a sequence" };
  const entryId = row.entryId ? String(row.entryId) : null;
  const isTyped = kind === "typed";
  const rawTitle = isTyped ? null : (row.title != null ? String(row.title) : null);
  const stored = cmSequenceStep({ argv, entry_id: entryId, title: rawTitle });
  const key = cmSequenceStepSignature(stored);
  const display = cmSequenceStepDisplay(stored, catalog);
  const entry = entryId ? cmEntryById(catalog, entryId) : null;
  const effect = cmSheetSequenceEntryEffect(entry, row, "effect", "reads");
  const policy = row.policy || (entry ? cmNormalizePolicy(entry.policy) : "run");
  const confirm = row.confirm !== undefined && row.confirm !== null
    ? String(row.confirm)
    : (entry && entry.policy === "confirm" ? String(entry.confirm || "") : null);
  const hasPreview = Boolean(
    (typeof row.hasPreview === "boolean" ? row.hasPreview : null) !== null
      ? row.hasPreview
      : (entry && Array.isArray(entry.preview) && entry.preview.length > 0),
  );
  const presentation = row.presentation || (entry ? cmNormalizePresentation(entry.presentation) : "action");
  return {
    argv: [...stored.argv],
    entry_id: stored.entry_id,
    title: stored.title,
    key,
    display: [...display],
    effect: cmNormalizeEffect(effect),
    policy,
    confirm,
    hasPreview,
    presentation,
    row: { ...row },
  };
}

function cmSheetSequenceSelectAll(sheet) {
  try {
    const input = sheet && sheet.inputEl;
    if (!input) return;
    const len = String(input.value || sheet.query || "").length;
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(0, len);
    else {
      input.selectionStart = 0;
      input.selectionEnd = len;
    }
  } catch (error) {
    // Best effort.
  }
}

function cmSheetSequenceToggle(sheet, trayStep) {
  const marks = cmSheetSequenceMarks(sheet);
  const index = marks.findIndex((mark) => mark && mark.key === trayStep.key);
  if (index >= 0) marks.splice(index, 1);
  else marks.push(trayStep);
  sheet.hint = null;
  sheet.render();
  sheet.refocusInput();
  cmSheetSequenceSelectAll(sheet);
  return index < 0;
}

function cmSheetSequenceUnmarkLast(sheet) {
  const marks = cmSheetSequenceMarks(sheet);
  if (!marks.length) return false;
  marks.pop();
  sheet.hint = null;
  sheet.render();
  sheet.refocusInput();
  cmSheetSequenceSelectAll(sheet);
  return true;
}

function cmSheetSequenceClear(sheet) {
  if (Array.isArray(sheet.sequenceMarks)) sheet.sequenceMarks = [];
  else sheet.sequenceMarks = [];
}

function cmSheetSequenceIsSequenceRow(row) {
  return Boolean(row && (row.sequenceId || (Array.isArray(row.steps) && row.kind === "recent")));
}

function cmSheetSequenceGroupToggle(sheet, row, catalog) {
  const steps = Array.isArray(row.steps) ? row.steps.map(cmSequenceStep) : [];
  if (!steps.length) {
    sheet.hint = "That sequence is empty";
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: "empty sequence" };
  }
  const marks = cmSheetSequenceMarks(sheet);
  const keys = steps.map(cmSequenceStepSignature);
  const everyMarked = keys.every((key) => marks.some((mark) => mark && mark.key === key));
  if (everyMarked) {
    const drop = new Set(keys);
    sheet.sequenceMarks = marks.filter((mark) => mark && !drop.has(mark.key));
  } else {
    const have = new Set(marks.map((mark) => mark && mark.key));
    for (const step of steps) {
      const key = cmSequenceStepSignature(step);
      if (have.has(key)) continue;
      have.add(key);
      const display = cmSequenceStepDisplay(step, catalog);
      const entry = step.entry_id ? cmEntryById(catalog, step.entry_id) : null;
      marks.push({
        argv: [...step.argv],
        entry_id: step.entry_id,
        title: step.title,
        key,
        display: [...display],
        effect: cmNormalizeEffect(entry ? entry.effect : "reads"),
        policy: entry ? cmNormalizePolicy(entry.policy) : "run",
        confirm: entry && entry.policy === "confirm" ? String(entry.confirm || "") : null,
        hasPreview: Boolean(entry && Array.isArray(entry.preview) && entry.preview.length > 0),
        presentation: entry ? cmNormalizePresentation(entry.presentation) : "action",
        row: null,
      });
    }
  }
  sheet.hint = null;
  sheet.render();
  sheet.refocusInput();
  cmSheetSequenceSelectAll(sheet);
  return { ok: true, unmarked: everyMarked };
}

function cmSheetSequenceShowReview(sheet, steps, guards) {
  sheet.confirmSequence = { steps: steps.map(cmSequenceStep), guards: Array.isArray(guards) ? guards : [], force: false };
  sheet.confirmRow = null;
  sheet.stage = "confirm";
  sheet.render();
  sheet.refocusInput();
}

async function cmSheetSequenceStart(sheet, opts = {}) {
  const marks = cmSheetSequenceMarks(sheet);
  const steps = marks.map((mark) => cmSequenceStep({ argv: mark.argv, entry_id: mark.entry_id, title: mark.title }));
  const signature = cmSequenceSignature(steps);
  const plugin = sheet.plugin;
  if (plugin && typeof plugin.commandModeSequenceIsActive === "function") {
    let active = false;
    try {
      active = plugin.commandModeSequenceIsActive(signature);
    } catch (error) {
      active = false;
    }
    if (active) {
      sheet.hint = "That sequence is already running";
      sheet.render();
      sheet.refocusInput();
      return { ok: false, reason: "already running" };
    }
  }
  cmSheetSequenceClear(sheet);
  sheet.confirmSequence = null;
  try {
    sheet.close();
  } catch (error) {
    // Headless closes are best effort.
  }
  if (plugin && typeof plugin.commandModeRunSequence === "function") {
    return plugin.commandModeRunSequence(steps, { trigger: "sheet-sequence" });
  }
  const runner = typeof sheet.runner === "function" ? sheet.runner() : null;
  if (!runner) return { ok: false, reason: "no runner" };
  return cmRunSequence(runner, steps, {});
}

async function cmSheetSequenceStartSteps(sheet, steps, opts = {}) {
  const stored = (Array.isArray(steps) ? steps : []).map(cmSequenceStep);
  const signature = cmSequenceSignature(stored);
  const plugin = sheet.plugin;
  if (plugin && typeof plugin.commandModeSequenceIsActive === "function") {
    let active = false;
    try {
      active = plugin.commandModeSequenceIsActive(signature);
    } catch (error) {
      active = false;
    }
    if (active) {
      sheet.hint = "That sequence is already running";
      sheet.render();
      sheet.refocusInput();
      return { ok: false, reason: "already running" };
    }
  }
  if (!opts.force) {
    const catalog = sheet.catalog;
    let guards = [];
    try {
      guards = cmSequenceGuards(stored, catalog);
    } catch (error) {
      guards = [];
    }
    if (guards.length) {
      cmSheetSequenceShowReview(sheet, stored, guards);
      return { ok: true, stage: "confirm" };
    }
  }
  cmSheetSequenceClear(sheet);
  sheet.confirmSequence = null;
  try {
    sheet.close();
  } catch (error) {
    // Headless closes are best effort.
  }
  if (plugin && typeof plugin.commandModeRunSequence === "function") {
    return plugin.commandModeRunSequence(stored, { trigger: "sheet-sequence" });
  }
  const runner = typeof sheet.runner === "function" ? sheet.runner() : null;
  if (!runner) return { ok: false, reason: "no runner" };
  return cmRunSequence(runner, stored, {});
}

const cmOriginalSheetRenderHeaderSeq = CommandModeSheetModal.prototype.renderHeader;
CommandModeSheetModal.prototype.renderHeader = function renderHeaderWithSequenceTray() {
  const result = cmOriginalSheetRenderHeaderSeq.call(this);
  const marks = cmSheetSequenceMarks(this);
  if (!marks.length) return result;
  if (this.stage !== "list" && this.stage !== "args") return result;
  try {
    const tray = this.contentEl.createEl("div", { cls: "bob-cmd-seq-tray" });
    tray.createEl("span", { cls: "bob-cmd-seq-label", text: "SEQUENCE" });
    marks.forEach((mark, index) => {
      if (index > 0) tray.createEl("span", { cls: "bob-cmd-seq-sep", text: "›" });
      const chip = tray.createEl("span", { cls: "bob-cmd-seq-chip" });
      try {
        chip.setAttribute("title", String(mark.title || "") + "\n" + cmFormatArgv(["bob", ...(mark.display || [])]));
      } catch (error) {
        // Best effort.
      }
      chip.createEl("span", { cls: "bob-cmd-seq-num", text: String(index + 1) });
      chip.createEl("span", { cls: "bob-cmd-seq-text", text: (mark.display || []).join(" ") });
      const remove = chip.createEl("button", { cls: "bob-cmd-seq-remove", text: "×" });
      try {
        if (typeof remove.setAttribute === "function") remove.setAttribute("aria-label", "Remove step " + (index + 1));
      } catch (error) {
        // Best effort.
      }
      const stepKey = mark.key;
      remove.addEventListener("click", (event) => {
        if (event) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
        }
        const current = cmSheetSequenceMarks(this);
        const at = current.findIndex((item) => item && item.key === stepKey);
        if (at >= 0) current.splice(at, 1);
        this.hint = null;
        this.render();
        this.refocusInput();
        cmSheetSequenceSelectAll(this);
      });
    });
    const run = tray.createEl("button", { cls: "bob-cmd-seq-run", text: "Run " + marks.length + " ↵" });
    run.addEventListener("click", (event) => {
      if (event) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      }
      void cmSheetSequenceEnterRun(this, false);
    });
  } catch (error) {
    // Tray is best effort.
  }
  return result;
};

async function cmSheetSequenceEnterRun(sheet, force) {
  const marks = cmSheetSequenceMarks(sheet);
  if (!marks.length) return { ok: false, reason: "no marks" };
  if (marks.length === 1) {
    const single = marks[0];
    const row = single.row;
    cmSheetSequenceClear(sheet);
    sheet.render();
    if (!row) {
      const runner = typeof sheet.runner === "function" ? sheet.runner() : null;
      if (!runner) return { ok: false, reason: "no runner" };
      try {
        sheet.close();
      } catch (error) {
        // Best effort.
      }
      return runner.run([...single.argv], {
        ...(single.entry_id ? { entryId: single.entry_id } : {}),
        title: single.title || (single.display || []).join(" "),
        trigger: "sheet",
        ...(force ? { skipGuards: true } : {}),
      });
    }
    return cmOriginalSheetActivateRowSeq.call(sheet, row, force ? { force: true } : {});
  }
  if (!force) {
    let guards = [];
    try {
      guards = cmSequenceGuards(marks.map((mark) => ({ argv: mark.argv, entry_id: mark.entry_id })), sheet.catalog);
    } catch (error) {
      guards = [];
    }
    if (guards.length) {
      cmSheetSequenceShowReview(sheet, marks.map((mark) => ({ argv: mark.argv, entry_id: mark.entry_id, title: mark.title })), guards);
      return { ok: true, stage: "confirm" };
    }
  }
  return cmSheetSequenceStart(sheet, { force });
}

const cmOriginalSheetRenderRowSeq = CommandModeSheetModal.prototype.renderRow;
CommandModeSheetModal.prototype.renderRow = function renderRowWithSequenceMarks(list, row) {
  const el = cmOriginalSheetRenderRowSeq.call(this, list, row);
  try {
    const marks = cmSheetSequenceMarks(this);
    const isSequenceRow = cmSheetSequenceIsSequenceRow(row);
    if (isSequenceRow && Array.isArray(row.path)) {
      const pathEl = (el.children || []).find((child) => Array.isArray(child.classes) && child.classes.includes("bob-cmd-row-path"));
      if (pathEl) {
        pathEl.empty();
        row.path.forEach((part) => {
          if (part === "›") pathEl.createEl("span", { cls: "bob-cmd-row-seq-sep", text: "›" });
          else pathEl.createEl("span", { cls: "bob-cmd-row-seq-part", text: String(part) });
        });
      }
      if (typeof row.duration === "number") {
        const chipsEl = (el.children || []).find((child) => Array.isArray(child.classes) && child.classes.includes("bob-cmd-row-chips"));
        if (chipsEl) chipsEl.createEl("span", { cls: "bob-cmd-row-duration", text: cmFormatDuration(row.duration) });
      }
    }
    if (!isSequenceRow && row && row.key) {
      const signature = cmSequenceStepSignature({ argv: cmSheetRowArgv(row), entry_id: row.entryId || null });
      const position = marks.findIndex((mark) => mark && mark.key === signature);
      if (position >= 0) {
        if (!el.classes.includes("is-marked")) el.classes.push("is-marked");
        const badge = el.createEl("span", { cls: "bob-cmd-row-mark", text: String(position + 1) });
        try {
          if (typeof badge.setAttribute === "function") badge.setAttribute("aria-label", "Step " + (position + 1));
        } catch (error) {
          // Best effort.
        }
      }
    }
    if (el._listeners && el._listeners.click) el._listeners.click = [];
    el.addEventListener("click", (event) => {
      const ctrlClick = Boolean(event && (event.ctrlKey || event.metaKey));
      const pending = cmSheetSequenceMarks(this).length > 0;
      if (ctrlClick || pending) {
        if (event) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
        }
        this.selectedKey = row.key;
        if (cmSheetSequenceIsSequenceRow(row)) cmSheetSequenceGroupToggle(this, row, this.catalog);
        else {
          const built = cmSheetSequenceStep(row, this.catalog);
          if (built && built.refused) {
            this.hint = built.refused;
            this.render();
            this.refocusInput();
            return;
          }
          const missing = cmSheetMissingPositional(row);
          if (missing) {
            if (typeof this.enterArgumentStage === "function") this.enterArgumentStage(row);
            return;
          }
          cmSheetSequenceToggle(this, built);
        }
        return;
      }
      this.selectedKey = row.key;
      void this.activateRow(row, {});
    });
  } catch (error) {
    // Mark rendering is best effort.
  }
  return el;
};

const cmOriginalSheetRenderFooterSeq = CommandModeSheetModal.prototype.renderFooter;
CommandModeSheetModal.prototype.renderFooter = function renderFooterWithSequence() {
  if (this.hint || this.waitingRun) return cmOriginalSheetRenderFooterSeq.call(this);
  if (this.stage === "output" && this.previewRunId && !this.previewResult) {
    return cmOriginalSheetRenderFooterSeq.call(this);
  }
  const marks = cmSheetSequenceMarks(this);
  try {
    if (this.stage === "confirm" && this.confirmSequence && !this.confirmRow) {
      const footer = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-footer" });
      footer.createEl("span", { cls: "bob-cmd-sheet-hint", text: "⌃↵ run all · esc back" });
      return;
    }
    if (this.stage === "list" && marks.length) {
      const footer = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-footer" });
      footer.createEl("span", {
        cls: "bob-cmd-sheet-hint",
        text: "⌃M unmark · ↵ run " + marks.length + " · ⌃↵ run " + marks.length + " now · ⌫ unmark last · esc clear marks",
      });
      return;
    }
    if (this.stage === "args") {
      const footer = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-footer" });
      if (marks.length) {
        footer.createEl("span", {
          cls: "bob-cmd-sheet-hint",
          text: "⌃M add as step " + (marks.length + 1) + " · ↵ add & run " + (marks.length + 1) + " · ⌃↵ add & run now · esc back",
        });
        return;
      }
      footer.createEl("span", {
        cls: "bob-cmd-sheet-hint",
        text: "⌃M mark · ⌃N/⌃P completion · ⇥ accept · ↵ run · ⇧↵ preview · ⌃↵ run now · esc back",
      });
      return;
    }
  } catch (error) {
    // Fall through to the original footer.
  }
  return cmOriginalSheetRenderFooterSeq.call(this);
};

const cmOriginalSheetRenderConfirmSeq = CommandModeSheetModal.prototype.renderConfirm;
CommandModeSheetModal.prototype.renderConfirm = function renderConfirmWithSequence() {
  if (this.confirmSequence && !this.confirmRow) {
    const seq = this.confirmSequence;
    const steps = Array.isArray(seq.steps) ? seq.steps : [];
    const guardsByIndex = new Map();
    for (const guard of seq.guards || []) {
      if (guard && Number(guard.index)) guardsByIndex.set(Number(guard.index), guard);
    }
    const card = this.contentEl.createEl("div", { cls: "bob-cmd-confirm bob-cmd-seq-review" });
    card.createEl("div", { cls: "bob-cmd-confirm-title", text: "Run " + steps.length + " commands in order" });
    const list = card.createEl("div", { cls: "bob-cmd-seq-review-list" });
    steps.forEach((step, offset) => {
      const index = offset + 1;
      const display = cmSequenceStepDisplay(step, this.catalog).join(" ");
      const title = cmSequenceStepTitle(step, this.catalog);
      const entry = step.entry_id ? cmEntryById(this.catalog, step.entry_id) : null;
      const effect = entry ? cmNormalizeEffect(entry.effect) : "reads";
      const line = list.createEl("div", { cls: "bob-cmd-seq-review-row" });
      line.createEl("span", { cls: "bob-cmd-seq-review-index", text: "(" + index + ")" });
      line.createEl("span", { cls: "bob-cmd-seq-review-path", text: display });
      line.createEl("span", { cls: "bob-cmd-seq-review-title", text: title });
      line.createEl("span", { cls: "bob-cmd-seq-review-effect", text: effect });
      const guard = guardsByIndex.get(index);
      if (guard) {
        const note = guard.kind === "confirm" && guard.text
          ? "⚠ asks first: " + guard.text
          : "⚠ applies without its preview";
        list.createEl("div", { cls: "bob-cmd-confirm-text bob-cmd-seq-review-note", text: note });
      }
    });
    card.createEl("div", {
      cls: "bob-cmd-seq-review-stop",
      text: "Stops at the first failure · open notes save before each writer",
    });
    const actions = card.createEl("div", { cls: "bob-cmd-confirm-actions" });
    const run = actions.createEl("button", { cls: "bob-cmd-confirm-run", text: "Run all ⌃↵" });
    run.addEventListener("click", () => void this.confirmRun());
    const back = actions.createEl("button", { cls: "bob-cmd-confirm-back", text: "Back" });
    back.addEventListener("click", () => {
      this.confirmSequence = null;
      this.stage = "list";
      this.render();
      this.refocusInput();
    });
    return;
  }
  return cmOriginalSheetRenderConfirmSeq.call(this);
};

const cmOriginalSheetConfirmRunSeq = CommandModeSheetModal.prototype.confirmRun;
CommandModeSheetModal.prototype.confirmRun = function confirmRunWithSequence() {
  if (this.confirmSequence && !this.confirmRow) {
    const seq = this.confirmSequence;
    const steps = Array.isArray(seq.steps) ? seq.steps : [];
    this.confirmSequence = null;
    cmSheetSequenceClear(this);
    try {
      this.close();
    } catch (error) {
      // Best effort.
    }
    const plugin = this.plugin;
    if (plugin && typeof plugin.commandModeRunSequence === "function") {
      return plugin.commandModeRunSequence(steps, { trigger: "sheet-sequence" });
    }
    const runner = typeof this.runner === "function" ? this.runner() : null;
    if (!runner) return { ok: false, reason: "no runner" };
    return cmRunSequence(runner, steps, {});
  }
  const result = cmOriginalSheetConfirmRunSeq.call(this);
  return result;
};

const cmOriginalSheetActivateRowSeq = CommandModeSheetModal.prototype.activateRow;
CommandModeSheetModal.prototype.activateRow = function activateRowWithSequence(row, opts = {}) {
  if (!row) return { ok: false, reason: "no row" };
  if (cmSheetSequenceIsSequenceRow(row)) {
    const steps = Array.isArray(row.steps) ? row.steps : [];
    const force = Boolean(opts && opts.force);
    if (opts && opts.preview) {
      this.hint = "⇧↵ previews one command — ↵ runs the sequence";
      this.render();
      this.refocusInput();
      return { ok: false, reason: "preview refused" };
    }
    return cmSheetSequenceStartSteps(this, steps, { force });
  }
  return cmOriginalSheetActivateRowSeq.call(this, row, opts);
};

const cmOriginalSheetKeydownSeq = CommandModeSheetModal.prototype.handleSheetKeydown;
CommandModeSheetModal.prototype.handleSheetKeydown = function handleSheetKeydownWithSequence(event) {
  if (!event || typeof event.key !== "string") return false;
  if (cmHandledSheetKeys.has(event)) return true;
  const consume = () => {
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
  };
  const done = () => {
    cmHandledSheetKeys.add(event);
    return true;
  };
  if (this.stage === "confirm") {
    if (this.confirmSequence && !this.confirmRow) {
      const alias = cmCommandModeKeyAlias(event);
      const isEscape = event.key === "Escape" || alias === "Escape";
      const isRunAll = event.key === "Enter" && event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey;
      const isPlainEnter = event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (isEscape) {
        consume();
        this.confirmSequence = null;
        this.stage = "list";
        this.render();
        this.refocusInput();
        return done();
      }
      if (isRunAll) {
        consume();
        void this.confirmRun();
        return done();
      }
      if (isPlainEnter) {
        consume();
        return done();
      }
      return false;
    }
    const result = cmOriginalSheetKeydownSeq.call(this, event);
    if (result) cmHandledSheetKeys.add(event);
    return result;
  }
  if (this.stage !== "list" && this.stage !== "args") {
    const result = cmOriginalSheetKeydownSeq.call(this, event);
    if (result) cmHandledSheetKeys.add(event);
    return result;
  }
  const marks = cmSheetSequenceMarks(this);
  const alias = cmCommandModeKeyAlias(event);
  const isEscape = event.key === "Escape" || alias === "Escape";
  if (cmSheetIsMarkKey(event)) {
    consume();
    if (this.stage === "args") {
      const outcome = cmSheetSequenceMarkFromArgs(this);
      if (outcome && outcome.then) void outcome;
      return done();
    }
    const row = this.selectedRow ? this.selectedRow() : null;
    if (!row) {
      this.hint = "Nothing to mark";
      this.render();
      this.refocusInput();
      return done();
    }
    if (cmSheetSequenceIsSequenceRow(row)) {
      cmSheetSequenceGroupToggle(this, row, this.catalog);
      return done();
    }
    const missing = cmSheetMissingPositional(row);
    if (missing) {
      if (typeof this.enterArgumentStage === "function") this.enterArgumentStage(row);
      return done();
    }
    const built = cmSheetSequenceStep(row, this.catalog);
    if (built && built.refused) {
      this.hint = built.refused;
      this.render();
      this.refocusInput();
      return done();
    }
    cmSheetSequenceToggle(this, built);
    return done();
  }
  if (this.stage === "list") {
    const ctrl = Boolean(event.ctrlKey);
    const shift = Boolean(event.shiftKey);
    const meta = Boolean(event.metaKey);
    const alt = Boolean(event.altKey);
    if (isEscape) {
      if (marks.length) {
        consume();
        cmSheetSequenceClear(this);
        this.hint = null;
        this.render();
        this.refocusInput();
        return done();
      }
      const result = cmOriginalSheetKeydownSeq.call(this, event);
      if (result) cmHandledSheetKeys.add(event);
      return result;
    }
    if (!marks.length) {
      const result = cmOriginalSheetKeydownSeq.call(this, event);
      if (result) cmHandledSheetKeys.add(event);
      return result;
    }
    if (event.key === "Enter" && !ctrl && !shift && !meta && !alt) {
      consume();
      void cmSheetSequenceEnterRun(this, false);
      return done();
    }
    if (event.key === "Enter" && ctrl && !shift && !meta && !alt) {
      consume();
      void cmSheetSequenceEnterRun(this, true);
      return done();
    }
    if (event.key === "Enter" && shift && !ctrl && !meta) {
      consume();
      this.hint = "⇧↵ previews one command — ↵ runs the sequence";
      this.render();
      this.refocusInput();
      return done();
    }
    if (event.key === "Backspace" && !ctrl && !meta && !alt && !String(this.query || "").length) {
      consume();
      cmSheetSequenceUnmarkLast(this);
      return done();
    }
    const result = cmOriginalSheetKeydownSeq.call(this, event);
    if (result) cmHandledSheetKeys.add(event);
    return result;
  }
  if (this.stage === "args") {
    const ctrl = Boolean(event.ctrlKey);
    const shift = Boolean(event.shiftKey);
    const meta = Boolean(event.metaKey);
    if (event.key === "Enter" && shift && !ctrl && !meta) {
      consume();
      this.hint = "⇧↵ previews one command — ↵ runs the sequence";
      this.render();
      this.refocusInput();
      return done();
    }
    if (event.key === "Enter" && !shift && !meta) {
      const rendered = (typeof cmArgRenderedRows === "function" ? cmArgRenderedRows(this) : []) || [];
      const highlighted = this.argSelectedKey && rendered.some((item) => item && item.key === this.argSelectedKey);
      if (highlighted) {
        const result = cmOriginalSheetKeydownSeq.call(this, event);
        if (result) cmHandledSheetKeys.add(event);
        return result;
      }
      consume();
      const force = Boolean(ctrl && !shift);
      void cmSheetSequenceAddAndRunFromArgs(this, force);
      return done();
    }
    const result = cmOriginalSheetKeydownSeq.call(this, event);
    if (result) cmHandledSheetKeys.add(event);
    return result;
  }
  const result = cmOriginalSheetKeydownSeq.call(this, event);
  if (result) cmHandledSheetKeys.add(event);
  return result;
};

function cmSheetSequenceBuildArgsRow(sheet) {
  const parsed = cmTokenizeBobArgv(sheet.query);
  if (parsed.error) return { error: parsed.error };
  const userArgs = cmTokenizedWords(parsed);
  const row = {
    ...(sheet.argRow || {}),
    kind: "entry",
    path: [...sheet.argEntry.path, ...(sheet.argEntry.fixed || [])],
    basePath: [...sheet.argEntry.path],
    fixed: [...(sheet.argEntry.fixed || [])],
    required: cmRequiredPositionals(sheet.argEntry),
    userArgs,
    argv: [...sheet.argEntry.path, ...userArgs],
  };
  return { row, userArgs };
}

function cmSheetSequenceMarkFromArgs(sheet) {
  const built = cmSheetSequenceBuildArgsRow(sheet);
  if (built.error) {
    sheet.hint = built.error;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: built.error };
  }
  const missing = cmSheetMissingPositional(built.row);
  if (missing) {
    sheet.hint = "Needs " + missing;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: "missing " + missing };
  }
  const step = cmSheetSequenceStep(
    { ...built.row, entryId: sheet.argEntry.id, title: sheet.argEntry.title || sheet.argEntry.id },
    sheet.catalog,
  );
  if (step && step.refused) {
    sheet.hint = step.refused;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: step.refused };
  }
  const marks = cmSheetSequenceMarks(sheet);
  const at = marks.findIndex((mark) => mark && mark.key === step.key);
  if (at >= 0) marks.splice(at, 1);
  else marks.push({ ...step, row: { ...built.row, entryId: sheet.argEntry.id } });
  if (typeof sheet.leaveArgumentStage === "function") sheet.leaveArgumentStage();
  else {
    sheet.stage = "list";
    sheet.render();
    sheet.refocusInput();
  }
  cmSheetSequenceSelectAll(sheet);
  return { ok: true, unmarked: at >= 0 };
}

async function cmSheetSequenceAddAndRunFromArgs(sheet, force) {
  const built = cmSheetSequenceBuildArgsRow(sheet);
  if (built.error) {
    sheet.hint = built.error;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: built.error };
  }
  const missing = cmSheetMissingPositional(built.row);
  if (missing) {
    sheet.hint = "Needs " + missing;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: "missing " + missing };
  }
  const step = cmSheetSequenceStep(
    { ...built.row, entryId: sheet.argEntry.id, title: sheet.argEntry.title || sheet.argEntry.id },
    sheet.catalog,
  );
  if (step && step.refused) {
    sheet.hint = step.refused;
    sheet.render();
    sheet.refocusInput();
    return { ok: false, reason: step.refused };
  }
  const marks = cmSheetSequenceMarks(sheet);
  if (!marks.some((mark) => mark && mark.key === step.key)) {
    marks.push({ ...step, row: { ...built.row, entryId: sheet.argEntry.id } });
  }
  return cmSheetSequenceEnterRun(sheet, force);
}

const cmOriginalSheetOnCloseSeq = CommandModeSheetModal.prototype.onClose;
CommandModeSheetModal.prototype.onClose = function onCloseWithSequence() {
  cmSheetSequenceClear(this);
  this.confirmSequence = null;
  return cmOriginalSheetOnCloseSeq.call(this);
};
