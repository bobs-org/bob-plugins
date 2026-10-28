// Bob Command Mode: the `Bob: Command mode` bottom sheet. Lists catalog,
// surface, context, and recent rows with fuzzy ranking; runs them through the
// runner with preview-first and confirm flows; grows in place into the output
// pager for reports, previews, and `?` help. Argument mode, typed runs, and
// Vim routing belong to the args-vim phase, which extends this modal.

function cmSheetSetIcon(el, name, fallback) {
  try {
    const obsidian = require("obsidian");
    if (obsidian && typeof obsidian.setIcon === "function") {
      obsidian.setIcon(el, name);
      return;
    }
  } catch (error) {
    // Headless tests and older shims fall through to the glyph.
  }
  el.textContent = String(fallback);
}

// Same rule as bob-articles' articleHasArticleType (020-article-core.js):
// the frontmatter type names "article", alone or in a list.
function cmSheetArticleType(type) {
  const values = Array.isArray(type) ? type : [type];
  return values.some((value) => String(value || "").trim()
    .replace(/^\[\[/, "").replace(/\]\]$/, "").trim().toLowerCase() === "article");
}

function cmSheetCaptureContext(app) {
  const context = {
    notePath: null, noteKind: null, clipboardUrl: null,
    originLeaf: null, originView: null, originEditor: null, originCursor: null,
  };
  try {
    const workspace = app && app.workspace;
    context.originLeaf = workspace && workspace.activeLeaf ? workspace.activeLeaf : null;
    const view = workspace && typeof workspace.getActiveViewOfType === "function"
      ? workspace.getActiveViewOfType(MarkdownView)
      : null;
    context.originView = view || null;
    context.originEditor = (view && view.editor) || null;
    try {
      context.originCursor = context.originEditor && typeof context.originEditor.getCursor === "function"
        ? context.originEditor.getCursor()
        : null;
    } catch (error) {
      context.originCursor = null;
    }
    const file = view && view.file;
    if (file && file.path) {
      context.notePath = file.path;
      let frontmatter = null;
      try {
        const cache = app.metadataCache && typeof app.metadataCache.getFileCache === "function"
          ? app.metadataCache.getFileCache(file)
          : null;
        frontmatter = (cache && cache.frontmatter) || null;
      } catch (error) {
        frontmatter = null;
      }
      context.noteKind = cmSheetNoteKind(frontmatter && frontmatter.type, cmSheetArticleType(frontmatter && frontmatter.type));
    }
  } catch (error) {
    // No active note: the sheet still opens with catalog rows.
  }
  return context;
}

function cmSheetReadClipboard() {
  try {
    const clipboard = typeof navigator !== "undefined" && navigator.clipboard;
    if (!clipboard || typeof clipboard.readText !== "function") return Promise.resolve(null);
    return clipboard.readText().then((text) => {
      const url = String(text || "").trim().split(/\s+/)[0] || "";
      return cmSheetIsHttpUrl(url) ? url : null;
    }).catch(() => null);
  } catch (error) {
    return Promise.resolve(null);
  }
}

function cmSheetRowArgv(row) {
  if (row && Array.isArray(row.argv)) return [...row.argv];
  const base = (row && Array.isArray(row.basePath) && row.basePath) ||
    (Array.isArray(row.path) && row.path) || [];
  const userArgs = (row && Array.isArray(row.userArgs) && row.userArgs) || [];
  return [...base, ...userArgs];
}

function cmSheetMissingPositional(row) {
  const required = (row && Array.isArray(row.required) && row.required) || [];
  const userArgs = (row && Array.isArray(row.userArgs) && row.userArgs) || [];
  const filled = userArgs.length;
  const missing = required[filled];
  return missing ? String(missing.name || missing.slot || "value") : null;
}

class CommandModeSheetModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.sheetOpen = false;
    this.stage = "list";
    this.query = String((options && options.initialQuery) || "");
    this.catalog = (plugin && plugin.commandModeCatalog) || null;
    this.host = (plugin && plugin.commandModeRunner && plugin.commandModeRunner.host) || null;
    this.context = (options && options.context) || cmSheetCaptureContext(app);
    this.rows = [];
    this.visible = [];
    this.groups = [];
    this.selectedKey = null;
    this.runRecords = [];
    this.frecency = {};
    this.confirmRow = null;
    this.previewRunId = null;
    this.previewResult = null;
    this.previewCarry = [];
    this.outputRunId = null;
    this.outputTitle = "";
    this.outputWrap = false;
    this.outputStopConfirm = false;
    this.outputSearch = cmDefaultPagerSearch();
    this.outputView = null;
    this.outputNodes = null;
    this.tailTimer = null;
    this.hint = null;
    this.waitingRun = null;
    this.surfaceAvailable = (options && options.surfaceAvailable) || null;
    this.onPickVim = (options && options.onPickVim) || null;
    this.completionExecFile = (options && options.completionExecFile) || null;
  }

  open() {
    if (this.sheetOpen) return this;
    this.sheetOpen = true;
    try {
      return super.open();
    } catch (error) {
      this.sheetOpen = false;
      throw error;
    }
  }

  close() {
    if (!this.sheetOpen) return this;
    this.sheetOpen = false;
    return super.close();
  }

  onOpen() {
    if (this.containerEl && this.containerEl.addClass) this.containerEl.addClass("bob-cmd-sheet-host");
    if (this.modalEl && this.modalEl.addClass) this.modalEl.addClass("bob-cmd-sheet");
    this.refreshRecords();
    this.rebuildRows();
    this.render();
    if (this.modalEl && this.modalEl.addEventListener) {
      this.modalEl.addEventListener("keydown", (event) => this.handleSheetKeydown(event));
    }
    void cmSheetReadClipboard().then((url) => {
      if (!this.sheetOpen || !url || this.context.clipboardUrl === url) return;
      this.context = { ...this.context, clipboardUrl: url };
      const keep = this.selectedKey;
      this.rebuildRows();
      this.selectedKey = keep;
      if (this.stage === "list") this.render();
    });
  }

  onClose() {
    this.stopTail();
    this.sheetOpen = false;
    if (this.plugin && this.plugin.commandModeSheet === this) this.plugin.commandModeSheet = null;
  }

  runner() {
    return this.plugin && this.plugin.commandModeRunner;
  }

  refreshRecords() {
    const runner = this.runner();
    try {
      this.runRecords = runner ? cmListRecords(runner.fs(), runner.runsDir()) : [];
    } catch (error) {
      this.runRecords = [];
    }
  }

  rebuildRows() {
    const surfaceAvailable = this.surfaceAvailable || ((id) => {
      try {
        const commands = this.app && this.app.commands && this.app.commands.commands;
        return Boolean(commands && commands[id]);
      } catch (error) {
        return false;
      }
    });
    const contextRows = cmSheetContextRows(this.catalog, this.context);
    this.rows = [
      ...cmSheetEntryRows(this.catalog, this.host),
      ...cmSheetSurfaceRows(surfaceAvailable),
      ...cmSheetPlainRows(),
      ...contextRows,
    ];
    if (!this.query.trim()) {
      this.refreshRecords();
      this.rows = [...cmSheetRecentRows(this.runRecords, Date.now()), ...this.rows];
    }
    this.frecency = cmSheetFrecencyMap(this.runRecords, this.rows, Date.now(), this.host);
    this.recomputeVisible();
  }

  recomputeVisible() {
    const query = this.query.trim();
    if (!query) {
      this.groups = cmGroupSheetRows(this.rows, this.catalog, this.context);
      this.visible = this.groups.flatMap((group) => group.rows);
    } else {
      this.groups = [];
      this.visible = cmRankSheetRows(query.replace(/\?$/, ""), this.rows, this.frecency);
    }
    if (!this.visible.some((row) => row && row.key === this.selectedKey)) {
      this.selectedKey = this.visible.length ? this.visible[0].key : null;
    }
  }

  selectedRow() {
    return this.visible.find((row) => row && row.key === this.selectedKey) || null;
  }

  select(delta) {
    if (!this.visible.length) return;
    let index = this.visible.findIndex((row) => row && row.key === this.selectedKey);
    index = index < 0 ? 0 : (index + delta + this.visible.length) % this.visible.length;
    this.selectedKey = this.visible[index].key;
    this.render();
    this.scrollSelectionIntoView();
  }

  scrollSelectionIntoView() {
    // Best effort; headless stubs ignore it.
  }

  render() {
    if (!this.sheetOpen && !this.contentEl) return;
    this.contentEl.empty();
    if (this.contentEl.addClass) this.contentEl.addClass("bob-cmd-sheet-content");
    this.renderHeader();
    if (this.stage === "confirm") this.renderConfirm();
    else if (this.stage === "output") this.renderOutput();
    else this.renderList();
    this.renderFooter();
  }

  renderHeader() {
    const header = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-header" });
    header.createEl("span", { cls: "bob-cmd-sheet-brand", text: "bob" });
    const version = this.catalog && this.catalog.bob_version ? "bob " + this.catalog.bob_version : "";
    header.createEl("span", {
      cls: "bob-cmd-sheet-host",
      text: [this.host, version].filter(Boolean).join(" · "),
    });
    const inputWrap = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-input-wrap" });
    inputWrap.createEl("span", { cls: "bob-cmd-sheet-prompt", text: "❯" });
    this.inputEl = inputWrap.createEl("input", { cls: "bob-cmd-sheet-input", attr: { type: "text" } });
    try {
      this.inputEl.value = this.query;
      this.inputEl.setAttribute("placeholder", "Type a command…");
    } catch (error) {
      // Headless stubs may not store attributes.
    }
    this.inputEl.addEventListener("input", () => {
      this.query = String(this.inputEl.value || "");
      this.hint = null;
      if (this.stage !== "list") {
        this.stage = "list";
        this.previewRunId = null;
        this.previewResult = null;
      }
      this.rebuildRows();
      this.render();
      this.refocusInput();
    });
  }

  refocusInput() {
    try {
      if (this.stage === "list" && this.inputEl && typeof this.inputEl.focus === "function") this.inputEl.focus();
    } catch (error) {
      // Focus is best effort.
    }
  }

  renderList() {
    const list = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-list" });
    this.listEl = list;
    this.rowEls = new Map();
    this.sectionHeadingEls = new Map();
    this.aboutEl = null;
    const query = this.query.trim();
    if (!this.visible.length) {
      const empty = list.createEl("div", { cls: "bob-cmd-sheet-empty" });
      empty.setText(query ? "No matching command" : "No commands yet — is bob on PATH?");
      return;
    }
    if (!query) {
      for (const group of this.groups) {
        const heading = list.createEl("div", { cls: "bob-cmd-sheet-section", text: group.title });
        if (group.rows.length) this.sectionHeadingEls.set(group.rows[0].key, heading);
        for (const row of group.rows) this.renderRow(list, row);
      }
      return;
    }
    for (const row of this.visible) this.renderRow(list, row);
  }

  renderRow(list, row) {
    const selected = row.key === this.selectedKey;
    const cls = "bob-cmd-row" + (selected ? " is-selected" : "") + (row.unavailable ? " is-unavailable" : "");
    const el = list.createEl("div", { cls });
    const icon = el.createEl("span", { cls: "bob-cmd-row-icon" });
    cmSheetSetIcon(icon, (CM_SHEET_ICONS[row.icon] || CM_SHEET_ICONS[row.subkind]) || "command", CM_SHEET_ICON_FALLBACK[row.icon] || CM_SHEET_ICON_FALLBACK[row.subkind] || "·");
    const path = Array.isArray(row.path) ? row.path.join(" ") : String(row.path || "");
    el.createEl("span", { cls: "bob-cmd-row-path", text: path });
    el.createEl("span", { cls: "bob-cmd-row-title", text: row.tagline ? row.title + " — " + row.tagline : row.title });
    const chips = el.createEl("span", { cls: "bob-cmd-row-chips" });
    if (row.effect && row.effect !== "opens") chips.createEl("span", { cls: "bob-cmd-chip-" + row.effect, text: row.effect });
    if (row.effect === "opens") chips.createEl("span", { cls: "bob-cmd-chip-opens", text: "opens" });
    if (row.hasPreview) chips.createEl("kbd", { cls: "bob-cmd-kbd", text: "⇧↵" });
    const duration = cmSheetMedianDuration(this.runRecords, row, this.host);
    if (duration !== null) chips.createEl("span", { cls: "bob-cmd-row-duration", text: cmFormatDuration(duration) });
    if (row.kind === "recent") {
      chips.createEl("span", { cls: "bob-cmd-row-glyph", text: row.glyph || "?" });
      if (row.age) chips.createEl("span", { cls: "bob-cmd-row-age", text: row.age });
    }
    if (row.unavailable) chips.createEl("span", { cls: "bob-cmd-row-unavailable", text: row.unavailable });
    if (selected && (row.about || row.tagline)) {
      this.aboutEl = list.createEl("div", { cls: "bob-cmd-row-about", text: row.tagline || row.about });
    }
    el.addEventListener("click", () => {
      this.selectedKey = row.key;
      void this.activateRow(row, {});
    });
    this.rowEls.set(row.key, el);
    return el;
  }

  renderFooter() {
    const footer = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-footer" });
    if (this.hint) {
      footer.createEl("span", { cls: "bob-cmd-sheet-hint is-warning", text: this.hint });
      return;
    }
    if (this.waitingRun) {
      const hint = footer.createEl("span", { cls: "bob-cmd-sheet-hint bob-cmd-sheet-running" });
      hint.createEl("span", { cls: "bob-cmd-sheet-spin" });
      hint.createEl("span", { text: "running " + this.waitingRun.title + "…" });
      return;
    }
    if (this.stage === "output" && this.previewRunId && !this.previewResult) {
      footer.createEl("span", { cls: "bob-cmd-sheet-hint", text: "preview running… ⌃↵ applies when it finishes" });
      return;
    }
    footer.createEl("span", { cls: "bob-cmd-sheet-hint", text: cmSheetFooterHints(this.stage) });
  }

  renderConfirm() {
    const row = this.confirmRow;
    const card = this.contentEl.createEl("div", { cls: "bob-cmd-confirm" });
    card.createEl("div", { cls: "bob-cmd-confirm-title", text: (row && row.title) || "Confirm" });
    card.createEl("div", {
      cls: "bob-cmd-confirm-text",
      text: (row && row.confirm) || "This command needs confirmation.",
    });
    card.createEl("div", { cls: "bob-cmd-confirm-argv", text: "bob " + cmSheetRowArgv(row).map(cmQuoteArg).join(" ") });
    const actions = card.createEl("div", { cls: "bob-cmd-confirm-actions" });
    const run = actions.createEl("button", { cls: "bob-cmd-confirm-run", text: "Run ⌃↵" });
    run.addEventListener("click", () => void this.confirmRun());
    const back = actions.createEl("button", { cls: "bob-cmd-confirm-back", text: "Back" });
    back.addEventListener("click", () => {
      this.stage = "list";
      this.confirmRow = null;
      this.render();
      this.refocusInput();
    });
  }

  handleSheetKeydown(event) {
    if (this.stage === "output") return this.handleOutputKeydown(event);
    if (this.stage === "confirm") {
      if (event && event.key === "Escape") {
        event.preventDefault();
        this.stage = "list";
        this.confirmRow = null;
        this.render();
        this.refocusInput();
        return true;
      }
      if (event && event.key === "Enter" && event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        void this.confirmRun();
        return true;
      }
      if (event && event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        return true;
      }
      return false;
    }
    const action = cmSheetListAction(event, { query: this.query });
    if (!action || action.type === "none") return false;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    if (action.type === "close") {
      this.close();
      return true;
    }
    if (action.type === "down") {
      this.select(1);
      return true;
    }
    if (action.type === "up") {
      this.select(-1);
      return true;
    }
    if (action.type === "help") {
      this.showHelp();
      return true;
    }
    if (action.type === "args") {
      const row = this.selectedRow();
      if (row && typeof this.onPickVim === "function") {
        // Placeholder for the args-vim phase; until then, Tab names the need.
        this.hint = "Argument mode lands with the args-vim phase";
        this.render();
        this.refocusInput();
      } else if (row) {
        this.hint = row.required && row.required.length
          ? "Missing " + row.required.map((arg) => arg.name || arg.slot).join(", ")
          : "Nothing to fill in — press ↵ to run";
        this.render();
        this.refocusInput();
      }
      return true;
    }
    const row = this.selectedRow();
    if (!row) return true;
    if (action.type === "run") void this.activateRow(row, {});
    else if (action.type === "preview") void this.activateRow(row, { preview: true });
    else if (action.type === "run-now") void this.activateRow(row, { force: true });
    return true;
  }

  async activateRow(row, opts = {}) {
    if (!row || row.unavailable) return { ok: false, reason: row && row.unavailable ? row.unavailable : "no row" };
    if (row.kind === "surface") return this.runSurface(row);
    if (row.kind === "plain") return this.runPlain(row);
    if (row.kind === "recent") return this.rerunRecent(row);
    const missing = cmSheetMissingPositional(row);
    if (missing) {
      this.hint = "Needs " + missing;
      this.render();
      this.refocusInput();
      return { ok: false, reason: "missing " + missing };
    }
    const argv = cmSheetRowArgv(row);
    if (opts.preview || (row.policy === "preview-first" && !opts.force)) {
      return this.runPreview(row, argv);
    }
    if (row.policy === "confirm" && !opts.force) {
      this.confirmRow = row;
      this.stage = "confirm";
      this.render();
      return { ok: true, stage: "confirm" };
    }
    if (row.presentation === "report") {
      return this.runReport(row, argv, { preview: false });
    }
    if (row.presentation === "inline") {
      this.close();
      return this.runner().run(argv, { entryId: row.entryId, title: row.title, trigger: "sheet" });
    }
    this.close();
    return this.runner().run(argv, {
      entryId: row.entryId, title: row.title, trigger: "sheet",
      ...(opts.force ? { skipGuards: true } : {}),
    });
  }

  async runSurface(row) {
    try {
      const commands = this.app && this.app.commands;
      if (!commands || typeof commands.executeCommandById !== "function") return { ok: false, reason: "no command runner" };
      this.close();
      await commands.executeCommandById(row.surfaceId);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }

  async runPlain(row) {
    if (row.action === "show-last-output" || row.action === "run-history") {
      const plugin = this.plugin;
      this.close();
      if (plugin && typeof plugin.commandModeOpenOutput === "function") {
        const runner = this.runner();
        const newest = runner && typeof runner.newestRecord === "function" ? runner.newestRecord() : null;
        if (!newest) return { ok: false, reason: "no command output yet" };
        return plugin.commandModeOpenOutput(newest.id);
      }
      return { ok: false, reason: "no output view yet" };
    }
    return this.runReport({ ...row, title: "bob help" }, ["--help"], { preview: false });
  }

  async rerunRecent(row) {
    const runner = this.runner();
    if (!runner) return { ok: false, reason: "no runner" };
    const argv = [...(row.argv || [])];
    if (row.presentation === "report") {
      return this.runReport(row, argv, { preview: false, entryId: row.entryId || undefined });
    }
    this.close();
    return runner.run(argv, {
      ...(row.entryId ? { entryId: row.entryId } : {}),
      title: row.title, trigger: "sheet-recent",
    });
  }

  async runPreview(row, argv) {
    if (!row.hasPreview) {
      if (row.presentation === "report") return this.runReport(row, argv, { preview: false });
      return this.activateRow(row, { force: false });
    }
    const runner = this.runner();
    if (!runner) return { ok: false, reason: "no runner" };
    this.previewRunId = null;
    this.previewResult = null;
    this.previewCarry = [];
    const settled = await this.runWithWaitingLine(row.title || "Preview", () => runner.run(argv, {
      entryId: row.entryId, title: row.title, trigger: "sheet-preview", preview: true,
    }));
    if (!settled || !settled.runId) {
      this.hint = (settled && settled.reason) || "Preview failed to start";
      this.render();
      this.refocusInput();
      return settled || { ok: false };
    }
    this.previewRunId = settled.runId;
    this.previewResult = settled;
    try {
      const record = cmPagerFindRecord(runner, settled.runId);
      if (record && Array.isArray(record.carry)) this.previewCarry = [...record.carry];
    } catch (error) {
      this.previewCarry = [];
    }
    this.enterOutput(settled.runId, row.title + " · preview", { previewOf: { row, argv } });
    return settled;
  }

  async runReport(row, argv, opts = {}) {
    const runner = this.runner();
    if (!runner) return { ok: false, reason: "no runner" };
    const settled = await this.runWithWaitingLine(row.title || "Report", () => runner.run(argv, {
      ...(opts.entryId !== undefined ? { entryId: opts.entryId } : (row.entryId ? { entryId: row.entryId } : {})),
      title: row.title || "Report", trigger: "sheet",
      ...(opts.preview ? { preview: true } : {}),
      ...(opts.skipGuards ? { skipGuards: true } : {}),
    }));
    if (!settled || !settled.runId) {
      this.hint = (settled && settled.reason) || "Run failed to start";
      this.render();
      this.refocusInput();
      return settled || { ok: false };
    }
    this.enterOutput(settled.runId, row.title || "Report", {});
    return settled;
  }

  async confirmRun() {
    const row = this.confirmRow;
    if (!row) return { ok: false, reason: "nothing to confirm" };
    const argv = cmSheetRowArgv(row);
    this.confirmRow = null;
    if (row.presentation === "report") {
      this.stage = "list";
      // The card was the confirmation; the run itself skips the policy gate.
      return this.runReport(row, argv, { skipGuards: true });
    }
    this.close();
    return this.runner().run(argv, {
      entryId: row.entryId, title: row.title, trigger: "sheet", confirmed: true,
    });
  }

  async runWithWaitingLine(title, run) {
    const waitingRun = { title: String(title || "bob") };
    this.waitingRun = waitingRun;
    this.render();
    try {
      return await run();
    } finally {
      if (this.waitingRun === waitingRun) {
        this.waitingRun = null;
        this.render();
      }
    }
  }

  async showHelp() {
    const query = this.query.trim().replace(/\?$/, "").trim();
    const rows = query ? cmRankSheetRows(query, this.rows, this.frecency) : [];
    const selected = rows[0] || this.selectedRow();
    const argv = cmSheetHelpArgv(selected && selected.kind !== "recent" ? selected : null);
    const title = selected && selected.title ? selected.title + " · help" : "bob help";
    const runner = this.runner();
    if (!runner) return { ok: false, reason: "no runner" };
    const settled = await this.runWithWaitingLine(title, () => runner.run(argv, { title, trigger: "sheet-help" }));
    if (!settled || !settled.runId) {
      this.hint = (settled && settled.reason) || "Help failed to start";
      this.render();
      this.refocusInput();
      return settled || { ok: false };
    }
    this.enterOutput(settled.runId, title, {});
    return settled;
  }

  enterOutput(runId, title, opts = {}) {
    this.stage = "output";
    this.outputRunId = String(runId || "");
    this.outputTitle = String(title || "Output");
    this.outputStopConfirm = false;
    this.outputSearch = cmDefaultPagerSearch();
    this.previewOf = opts.previewOf || null;
    if (!this.previewOf) {
      this.previewRunId = null;
      this.previewResult = null;
      this.previewCarry = [];
    }
    this.render();
    this.startTail();
  }

  backToList() {
    this.stopTail();
    this.stage = "list";
    this.outputRunId = null;
    this.previewOf = null;
    this.render();
    this.refocusInput();
  }

  payload() {
    return cmPagerLoadPayload(this.runner(), this.outputRunId);
  }

  records() {
    const runner = this.runner();
    if (!runner) return [];
    try { return cmListRecords(runner.fs(), runner.runsDir()); }
    catch (error) { return []; }
  }

  startTail() {
    this.stopTail();
    this.tailTimer = setInterval(() => this.refreshOutput(), CM_TAIL_POLL_MS);
    if (this.tailTimer && typeof this.tailTimer.unref === "function") this.tailTimer.unref();
  }

  stopTail() {
    if (this.tailTimer) {
      try { clearInterval(this.tailTimer); } catch (error) { /* Best effort. */ }
      this.tailTimer = null;
    }
  }

  refreshOutput() {
    if (!this.sheetOpen || this.stage !== "output") return null;
    const runner = this.runner();
    const vaultBase = runner && typeof runner.deps.vaultBase === "function" ? runner.deps.vaultBase() : cmVaultBasePath(this.app);
    const payload = this.payload();
    if (!payload) return null;
    this.outputView = cmBuildPagerView(payload, {
      app: this.app,
      vaultBase,
      records: this.records(),
      search: this.outputSearch,
      wrap: this.outputWrap,
      stopConfirm: this.outputStopConfirm,
      queuedBehind: cmPagerQueuedBehind(runner),
      nowMs: Date.now(),
    });
    if (!this.outputBody) return this.outputView;
    this.outputNodes = cmRenderPagerView(this.outputBody, this.outputView, {
      onStop: () => this.requestOutputStop(),
      onOpenLog: () => this.openFullLog(),
      onLink: (link) => this.openOutputLink(link),
    });
    this.renderOutputFooter();
    return this.outputView;
  }

  renderOutput() {
    const wrap = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-output" });
    const bar = wrap.createEl("div", { cls: "bob-cmd-sheet-output-bar" });
    bar.createEl("span", { cls: "bob-cmd-sheet-output-title", text: this.outputTitle });
    if (this.previewOf) {
      const apply = bar.createEl("button", {
        cls: "bob-cmd-sheet-apply" + (this.previewResult && !this.previewResult.ok ? " is-disabled" : ""),
        text: "Apply ⌃↵",
      });
      apply.addEventListener("click", () => void this.applyPreview());
    }
    this.outputBody = wrap.createEl("div", { cls: "bob-cmd-sheet-output-body" });
    const footerHost = wrap.createEl("div", { cls: "bob-cmd-sheet-footer" });
    this.outputFooterEl = footerHost;
    this.refreshOutput();
  }

  renderOutputFooter() {
    if (!this.outputFooterEl) return;
    this.outputFooterEl.empty();
    if (this.previewOf) {
      const failed = this.previewResult && !this.previewResult.ok;
      this.outputFooterEl.createEl("span", {
        cls: "bob-cmd-sheet-hint" + (failed ? " is-warning" : ""),
        text: failed ? "preview failed — apply disabled" : "⌃↵ apply · esc back to list · q close",
      });
      return;
    }
    this.outputFooterEl.createEl("span", { cls: "bob-cmd-sheet-hint", text: cmSheetFooterHints("output") });
  }

  async applyPreview() {
    const previewOf = this.previewOf;
    if (!previewOf) return { ok: false, reason: "no preview to apply" };
    if (this.previewResult && !this.previewResult.ok) return { ok: false, reason: "preview failed" };
    const { row, argv } = previewOf;
    const carry = this.previewCarry.length ? this.previewCarry : [];
    this.previewOf = null;
    this.previewRunId = null;
    this.previewResult = null;
    // The preview already ran, so Apply skips the preview-first gate. The
    // save-before-write guard still applies inside the runner.
    if (row.presentation === "report") {
      return this.runReport(row, [...argv, ...carry], { skipGuards: true });
    }
    this.close();
    return this.runner().run([...argv, ...carry], {
      entryId: row.entryId, title: row.title, trigger: "sheet-apply", skipGuards: true,
    });
  }

  requestOutputStop() {
    const record = this.outputView && this.outputView.record;
    if (!record || record.outcome !== "running") return { ok: false, reason: "run is not active" };
    if (record.effect !== "reads" && !this.outputStopConfirm) {
      this.outputStopConfirm = true;
      this.refreshOutput();
      return { ok: true, confirm: true };
    }
    this.outputStopConfirm = false;
    const runner = this.runner();
    if (!runner || typeof runner.stop !== "function") return { ok: false, reason: "run is not active" };
    const result = runner.stop(this.outputRunId);
    this.refreshOutput();
    return result;
  }

  openFullLog() {
    const runner = this.runner();
    if (!runner || typeof this.plugin.commandModeOpenPath !== "function") return { ok: false };
    const paths = cmRunFilePaths(runner.runsDir(), this.outputRunId, runner.pathModule());
    return this.plugin.commandModeOpenPath(paths.out);
  }

  openOutputLink(link) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.openLinkText !== "function") return { ok: false, reason: "note opener unavailable" };
    try {
      const opened = workspace.openLinkText(link.href || link.path, "", Boolean(link.newLeaf), {});
      return opened && typeof opened.then === "function" ? opened.then(() => ({ ok: true })) : { ok: true };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }

  handleOutputKeydown(event) {
    if (!event || typeof event.key !== "string") return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.backToList();
      return true;
    }
    if (event.key === "q" && !event.ctrlKey && !event.metaKey) {
      const tag = event.target && event.target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        this.close();
        return true;
      }
    }
    if (event.key === ":" && !event.ctrlKey && !event.metaKey) {
      const tag = event.target && event.target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        this.backToList();
        return true;
      }
    }
    if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && this.previewOf) {
      event.preventDefault();
      void this.applyPreview();
      return true;
    }
    const action = cmHandlePagerKey(event, {
      search: this.outputSearch,
      stopConfirm: this.outputStopConfirm,
      hasSelection: cmPagerHasSelection(),
    });
    if (!action || action.type === "none") return false;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    this.applyOutputAction(action);
    return true;
  }

  applyOutputAction(action) {
    if (!action) return;
    switch (action.type) {
      case "rerun":
        this.rerunOutput();
        break;
      case "copy-output":
        try {
          if (this.outputView) {
            const text = cmPagerCopyOutput(this.outputView);
            void cmPagerWriteClipboard(text);
          }
        } catch (error) { /* Clipboard is best effort. */ }
        break;
      case "copy-command":
        try {
          if (this.outputView) {
            const text = cmPagerCopyCommand(this.outputView);
            void cmPagerWriteClipboard(text);
          }
        } catch (error) { /* Clipboard is best effort. */ }
        break;
      case "history-older":
      case "history-newer": {
        const ids = cmPagerHistoryIds(this.records());
        const state = cmPagerHistoryState(ids, this.outputRunId, action.type === "history-older" ? -1 : 1);
        if (state && state.runId) {
          this.outputRunId = state.runId;
          this.outputStopConfirm = false;
          this.outputSearch = cmDefaultPagerSearch();
          this.refreshOutput();
        }
        break;
      }
      case "open-log":
        this.openFullLog();
        break;
      case "close":
        this.close();
        break;
      default:
        this.refreshOutput();
        break;
    }
  }

  rerunOutput() {
    const record = this.outputView && this.outputView.record;
    if (!record || !Array.isArray(record.argv)) return { ok: false, reason: "nothing to rerun" };
    const runner = this.runner();
    if (!runner) return { ok: false, reason: "no runner" };
    return runner.run([...record.argv], {
      ...(record.entry_id ? { entryId: record.entry_id } : {}),
      title: record.title, trigger: "sheet-rerun",
    }).then((settled) => {
      if (settled && settled.runId) {
        this.outputRunId = settled.runId;
        this.outputStopConfirm = false;
        this.outputSearch = cmDefaultPagerSearch();
        this.previewOf = null;
        this.refreshOutput();
      }
      return settled;
    });
  }
}
