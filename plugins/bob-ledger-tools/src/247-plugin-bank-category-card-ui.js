// Keyboard-first Category card. The card renders Bob's categories and
// suggestions, while the action mixin owns the one editor transaction.

function bankCategoryCardModalBase() {
  if (typeof Modal === "function") return Modal;
  return class BankCategoryCardFallback {
    constructor(app) {
      this.app = app;
      this.contentEl = {
        ownerDocument: app && app.document ? app.document : null,
        listeners: new Map(),
        addClass() {},
        setAttribute() {},
        addEventListener(type, callback) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(callback);
          this.listeners.set(type, listeners);
        },
        removeEventListener(type, callback) {
          this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== callback));
        },
        empty() {},
        appendChild() {},
      };
      this.modalEl = this.contentEl;
    }
    open() { this.onOpen?.(); }
    close() { this.onClose?.(); }
  };
}

function bankCategoryUiEl(doc, tag, className, text, attrs = {}) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const node = doc.createElement(tag);
  if (!node) return null;
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "disabled") node.disabled = value === true;
    else if (typeof node.setAttribute === "function") node.setAttribute(key, String(value));
  }
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function bankCategoryUiAppend(parent, tag, className, text, attrs = {}) {
  const doc = parent && parent.ownerDocument;
  const node = bankCategoryUiEl(doc, tag, className, text, attrs);
  if (node && parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function bankCategoryUiConsume(event) {
  try { event?.preventDefault?.(); } catch (_) {}
  try { event?.stopPropagation?.(); } catch (_) {}
}

function bankCategoryUiEventKey(event) {
  if (!event || typeof event.key !== "string") return "";
  if (event.ctrlKey && event.key === "[") return "Ctrl+[";
  if (event.ctrlKey && event.key === "Enter") return "Ctrl+Enter";
  if (event.ctrlKey && (event.key === "n" || event.key === "N")) return "Ctrl+N";
  if (event.ctrlKey && (event.key === "p" || event.key === "P")) return "Ctrl+P";
  return event.key;
}

// Apply the pure planner's character edits without disturbing the rest of the
// row. The caller replaces that whole line once, producing one undo step.
function bankCategoryApplyLineEdits(lineText, plan) {
  if (!plan || plan.ok !== true || !Array.isArray(plan.edits)) return null;
  let output = String(lineText || "");
  const edits = plan.edits.slice().sort((left, right) => right.fromCh - left.fromCh);
  for (const edit of edits) {
    if (!edit || !Number.isInteger(edit.fromCh) || !Number.isInteger(edit.toCh) ||
        edit.fromCh < 0 || edit.toCh < edit.fromCh || edit.toCh > output.length ||
        typeof edit.insert !== "string") return null;
    output = output.slice(0, edit.fromCh) + edit.insert + output.slice(edit.toCh);
  }
  return output;
}

class BankCategoryCardModal extends bankCategoryCardModalBase() {
  constructor(app, options = {}) {
    super(app);
    this.pluginRef = options.plugin || null;
    this.mode = options.mode === "set" ? "set" : "close";
    this.context = options.context || null;
    this.view = options.view || null;
    this.categories = Array.isArray(options.categories) ? options.categories : null;
    this.suggestion = options.suggestion || null;
    this.progress = options.progress || null;
    this.reason = options.reason || (this.categories ? null : "loading…");
    this.highlightKey = null;
    this.didInteract = false;
    this.busy = false;
    this.waitingRefresh = false;
    this.closed = false;
    this.summary = null;
    this.lock = null;
    this.liveRegion = null;
    this.liveText = "";
    this.reportGen = 0;
    this.chord = bankCategoryChordInit(options.openedWithCtrlEnter === true);
    this.onChoose = typeof options.onChoose === "function" ? options.onChoose : null;
    this.onMonth = typeof options.onMonth === "function" ? options.onMonth : null;
    this.clickListener = (event) => this.onClick(event);
    this.keyListener = (event) => this.onKeyDown(event);
    this.keyupListener = (event) => this.onKeyUp(event);
    this.keyupTarget = null;
    this.model = null;
  }

  onOpen() {
    try {
      this.modalEl?.addClass?.("bob-bank-category-modal");
      this.modalEl?.setAttribute?.("role", "dialog");
      this.modalEl?.setAttribute?.("aria-modal", "true");
      this.modalEl?.setAttribute?.("aria-label", "Bank Category card");
      this.contentEl?.addClass?.("bob-bank-category-dialog");
      this.contentEl?.addClass?.("bob-bank-category-card");
      this.contentEl?.addClass?.("bob-key-card");
      this.contentEl?.addEventListener?.("click", this.clickListener);
      this.contentEl?.addEventListener?.("keydown", this.keyListener, true);
      this.contentEl?.addEventListener?.("keyup", this.keyupListener, true);
      const doc = this.contentEl?.ownerDocument || this.app?.document ||
        (typeof document !== "undefined" ? document : null);
      if (doc && typeof doc.addEventListener === "function") {
        this.keyupTarget = doc;
        doc.addEventListener("keyup", this.keyupListener, true);
      }
    } catch (_) {}
    this.paint();
  }

  onClose() {
    this.closed = true;
    try { this.contentEl?.removeEventListener?.("click", this.clickListener); } catch (_) {}
    try { this.contentEl?.removeEventListener?.("keydown", this.keyListener, true); } catch (_) {}
    try { this.contentEl?.removeEventListener?.("keyup", this.keyupListener, true); } catch (_) {}
    try { this.keyupTarget?.removeEventListener?.("keyup", this.keyupListener, true); } catch (_) {}
    this.keyupTarget = null;
    try { this.pluginRef?.bankCategoryModalClosed?.(this); } catch (_) {}
  }

  onEscapeKey(event) {
    bankCategoryUiConsume(event);
    if (!this.busy) this.close();
    return false;
  }

  cardRow() {
    if (!this.context || typeof this.context !== "object") return {};
    if (this.context.cardRow && typeof this.context.cardRow === "object") return this.context.cardRow;
    if (this.context.row && typeof this.context.row === "object") return this.context.row;
    return {};
  }

  currentModel() {
    const row = this.cardRow();
    this.model = bankCategoryCardModel({
      mode: this.mode,
      categories: this.categories,
      suggestion: this.suggestion,
      row,
      progress: this.progress,
      reason: this.reason || (this.categories ? null : "loading…"),
      path: this.context && this.context.path,
    });
    if (this.highlightKey === null) this.highlightKey = this.model.highlightKey;
    return this.model;
  }

  setReport(report) {
    if (!report || this.didInteract || this.closed) return false;
    if (Array.isArray(report.categories)) this.categories = report.categories;
    const rows = Array.isArray(report.days)
      ? report.days.flatMap((day) => Array.isArray(day.rows) ? day.rows : [])
      : [];
    const cardRow = this.cardRow();
    const match = cardRow ? bankCategoryMatchJsonRow(cardRow, rows) : null;
    this.suggestion = match && match.suggestion ? match.suggestion : null;
    this.reason = null;
    const model = bankCategoryCardModel({
      mode: this.mode,
      categories: this.categories,
      suggestion: this.suggestion,
      row: cardRow || {},
      progress: this.progress,
      path: this.context && this.context.path,
    });
    this.highlightKey = model.highlightKey;
    this.model = model;
    this.paint();
    return true;
  }

  setNext(context, progress, lock) {
    this.context = context;
    this.progress = progress || null;
    this.suggestion = null;
    this.didInteract = false;
    this.waitingRefresh = true;
    this.busy = false;
    this.summary = null;
    this.lock = lock || null;
    this.highlightKey = null;
    this.chord = bankCategoryChordInit(false);
    try { this.paint(); } catch (_) {}
  }

  setReason(reason) {
    this.reason = typeof reason === "string" && reason ? reason : "categories unavailable";
    try { this.paint(); } catch (_) {}
  }

  announce(text) {
    this.liveText = typeof text === "string" ? text : "";
    if (this.liveRegion) this.liveRegion.textContent = this.liveText;
  }

  showSummary(summary) {
    this.waitingRefresh = false;
    this.busy = false;
    this.summary = summary || null;
    this.paint();
  }

  flatTiles(model = this.currentModel()) {
    return (Array.isArray(model.sections) ? model.sections : [])
      .flatMap((section) => Array.isArray(section.tiles) ? section.tiles : []);
  }

  moveHighlight(direction) {
    const model = this.currentModel();
    const next = bankCategoryMoveHighlight(this.highlightKey, this.flatTiles(model), direction);
    if (!next) return false;
    this.highlightKey = next;
    this.didInteract = true;
    this.paint();
    return true;
  }

  async choose(categoryKey, kind) {
    if (this.busy || this.closed || this.summary) return false;
    this.didInteract = true;
    this.busy = true;
    this.paint();
    try {
      if (this.onChoose) await this.onChoose(categoryKey, kind, this);
      return true;
    } catch (error) {
      this.waitingRefresh = false;
      this.busy = false;
      new Notice(`Bank: category could not be filed (${error && error.message ? error.message : error})`);
      return false;
    } finally {
      if (!this.closed && !this.waitingRefresh) {
        this.busy = false;
        this.paint();
      }
    }
  }

  async onKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    const key = bankCategoryUiEventKey(event);
    if (!key) return;
    if (key === "Escape") {
      bankCategoryUiConsume(event);
      this.close();
      return;
    }
    const table = bankCategoryKeyTable(this.categories);
    const action = bankCategoryResolveCardKey({ key, table });
    if (action.action === "ignore") return;
    bankCategoryUiConsume(event);
    if (this.busy || this.waitingRefresh || this.summary) return;
    if (key === "Ctrl+Enter" && bankCategoryLockActive(this.lock, Date.now())) return;
    if ((key === "Enter" || key === "Ctrl+Enter") && bankCategoryChordShouldSwallow(this.chord, "Enter")) return;
    this.didInteract = true;
    if (action.action === "cancel") {
      this.close();
    } else if (action.action === "move") {
      const backwards = action.key === "ArrowLeft" || action.key === "ArrowUp" || action.key === "Ctrl+P";
      this.moveHighlight(backwards ? "back" : "forward");
    } else if (action.action === "no-category") {
      await this.choose(null, "no-category");
    } else if (action.action === "file") {
      await this.choose(action.category, "pick");
    } else if (action.action === "accept") {
      if (this.highlightKey) await this.choose(this.highlightKey, "accept");
    }
  }

  onKeyUp(event) {
    if (event && (event.key === "Enter" || event.code === "NumpadEnter")) {
      this.chord = bankCategoryChordKeyup(this.chord);
    }
  }

  onClick(event) {
    const target = event && event.target;
    const tile = target && typeof target.closest === "function"
      ? target.closest("button[data-category-key]")
      : null;
    if (tile && !tile.disabled) {
      bankCategoryUiConsume(event);
      const key = tile.getAttribute("data-category-key");
      this.highlightKey = key;
      void this.choose(key, "pick");
      return;
    }
    const month = target && typeof target.closest === "function"
      ? target.closest("button[data-bank-month-path]")
      : null;
    if (month && !month.disabled) {
      bankCategoryUiConsume(event);
      const path = month.getAttribute("data-bank-month-path");
      this.close();
      if (path && this.onMonth) void this.onMonth(path);
    }
  }

  paintSummary(root, doc) {
    const summary = this.summary || {};
    bankCategoryUiAppend(root, "h2", "bob-bank-category-title bob-key-card-title", "Bank filing complete");
    bankCategoryUiAppend(root, "p", "bob-bank-category-summary", summary.line1 || "Bank filing complete");
    if (summary.detail) bankCategoryUiAppend(root, "p", "bob-bank-category-detail", summary.detail);
    if (summary.line2) bankCategoryUiAppend(root, "p", "bob-bank-category-summary-detail", summary.line2);
    const links = Array.isArray(summary.waitingLinks) ? summary.waitingLinks : [];
    if (links.length) {
      const section = bankCategoryUiAppend(root, "section", "bob-bank-category-other-months");
      bankCategoryUiAppend(section, "h3", "bob-bank-category-group", "Other months with waiting rows");
      for (const entry of links) {
        const button = bankCategoryUiAppend(section, "button", "bob-bank-category-month-link",
          `${entry.month} · ${entry.waiting} waiting →`, { type: "button", "data-bank-month-path": entry.path });
        if (button) button.disabled = this.busy;
      }
    }
    const close = bankCategoryUiAppend(root, "button", "bob-bank-category-close", "Close", { type: "button" });
    if (close) close.addEventListener?.("click", () => this.close());
    void doc;
  }

  ensureLiveRegion(content, doc) {
    if (this.liveRegion && this.liveRegion.parentNode === content) {
      if (this.liveText && this.liveRegion.textContent !== this.liveText) {
        this.liveRegion.textContent = this.liveText;
      }
      return this.liveRegion;
    }
    const node = bankCategoryUiEl(doc, "div", "bob-bank-category-live", this.liveText || "", {
      role: "status", "aria-live": "polite", "aria-atomic": "true",
    });
    this.liveRegion = node;
    if (node && content && typeof content.appendChild === "function") content.appendChild(node);
    return node;
  }

  paintHeader(root, model) {
    const header = model.header || {};
    const row = bankCategoryUiAppend(root, "div", "bob-bank-category-header");
    if (!row) return;
    const amount = Number.isSafeInteger(header.cents) ? bankFormatCents(header.cents) : "";
    if (amount) {
      const amountClass = model.inflow
        ? "bob-bank-category-amount is-inflow"
        : "bob-bank-category-amount";
      bankCategoryUiAppend(row, "span", amountClass, amount);
    }
    bankCategoryUiAppend(row, "span", "bob-bank-category-payee", header.payee || "Bank row");
    const day = header.day || header.date;
    if (day) bankCategoryUiAppend(row, "span", "bob-bank-category-day", day);
    const chips = [];
    if (header.flagged) chips.push("⚑ flagged");
    if (header.account) chips.push(header.account);
    if (chips.length) {
      const chipRow = bankCategoryUiAppend(root, "div", "bob-bank-category-chips");
      for (const chip of chips) {
        bankCategoryUiAppend(chipRow, "span", "bob-bank-category-chip", chip);
      }
    }
  }

  paintProgress(root, model) {
    if (this.mode === "set") {
      const state = model.header && model.header.state === "acknowledged"
        ? "✓ acknowledged"
        : "waiting";
      bankCategoryUiAppend(root, "p", "bob-bank-category-state", state);
      return;
    }
    const progress = model.progress;
    if (!progress) return;
    const month = progress.month ? ` · ${progress.month}` : "";
    bankCategoryUiAppend(root, "p", "bob-bank-category-progress",
      `${progress.filed} of ${progress.total}${month}`);
    const total = Number(progress.total);
    const filed = Number(progress.filed);
    if (Number.isFinite(total) && total > 0) {
      const meter = bankCategoryUiAppend(root, "div", "bob-bank-category-meter", null, {
        "aria-hidden": "true",
      });
      const width = Math.max(0, Math.min(100, (filed / total) * 100));
      const fill = bankCategoryUiAppend(meter, "span", "bob-bank-category-meter-fill");
      if (fill && fill.style) fill.style.width = `${width}%`;
      else if (fill && typeof fill.setAttribute === "function") fill.setAttribute("style", `width: ${width}%`);
    }
  }

  paintTile(grid, tile, selected, disabled) {
    const attrs = {
      type: "button",
      "data-category-key": tile.key,
      "aria-pressed": selected ? "true" : "false",
    };
    if (tile.hotkey) attrs["aria-keyshortcuts"] = tile.hotkey;
    const button = bankCategoryUiAppend(grid, "button",
      `bob-bank-category-tile${selected ? " is-highlighted" : ""}${tile.dimmed ? " is-dimmed" : ""}`,
      null, attrs);
    if (!button) return;
    button.disabled = disabled;
    if (tile.keycap) {
      bankCategoryUiAppend(button, "kbd", "bob-bank-category-keycap", tile.keycap);
    }
    const label = `${tile.emoji ? `${tile.emoji} ` : ""}${tile.label || tile.key}`;
    bankCategoryUiAppend(button, "span", "bob-bank-category-tile-label", label);
    if (selected) bankCategoryUiAppend(button, "span", "bob-bank-category-enter", "↵");
  }

  paint() {
    const content = this.contentEl;
    if (!content) return;
    const live = this.liveRegion && this.liveRegion.parentNode === content ? this.liveRegion : null;
    try {
      if (typeof content.empty === "function") {
        content.empty();
        if (live && typeof content.appendChild === "function") content.appendChild(live);
      } else if (typeof content.replaceChildren === "function") {
        content.replaceChildren(...(live ? [live] : []));
      } else {
        content.textContent = "";
      }
    } catch (_) {}
    const doc = content.ownerDocument || this.app?.document ||
      (typeof document !== "undefined" ? document : null);
    this.ensureLiveRegion(content, doc);
    const root = bankCategoryUiEl(doc, "section", "bob-bank-category-card bob-key-card", null, {
      role: "dialog", "aria-modal": "true", "aria-label": "Bank Category card",
    });
    if (!root) return;
    if (typeof content.appendChild === "function") content.appendChild(root);
    if (this.summary) {
      this.paintSummary(root, doc);
      return;
    }
    const model = this.currentModel();
    const title = bankCategoryUiAppend(root, "h2", "bob-bank-category-title bob-key-card-title", "Category");
    if (title) title.id = "bob-bank-category-title";
    this.paintHeader(root, model);
    this.paintProgress(root, model);
    if (model.hint) bankCategoryUiAppend(root, "p", "bob-bank-category-hint", model.hint, { role: "status" });
    if (this.waitingRefresh) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint", "Refreshing suggestions…", { role: "status" });
    }
    const disabled = this.busy || this.waitingRefresh;
    for (const sectionModel of Array.isArray(model.sections) ? model.sections : []) {
      const section = bankCategoryUiAppend(root, "section", "bob-bank-category-section");
      if (!section) continue;
      if (sectionModel.group) bankCategoryUiAppend(section, "h3", "bob-bank-category-group", sectionModel.group);
      const grid = bankCategoryUiAppend(section, "div", "bob-bank-category-tiles", null, { role: "group" });
      for (const tile of Array.isArray(sectionModel.tiles) ? sectionModel.tiles : []) {
        this.paintTile(grid, tile, tile.key === this.highlightKey, disabled);
      }
    }
    bankCategoryUiAppend(root, "p", "bob-bank-category-footer", model.footer?.text || "pick a category");
    if (model.footer?.hint) bankCategoryUiAppend(root, "p", "bob-bank-category-hint", model.footer.hint);
    const keys = model.kind === "restricted"
      ? (model.footer?.text || "␣ acknowledge · esc cancel")
      : (this.mode === "close"
        ? "↵ accept · letter choose · Space no category · Esc cancel"
        : "↵ accept · letter choose · Space remove category · Esc cancel");
    bankCategoryUiAppend(root, "p", "bob-bank-category-keys", keys);
  }
}
