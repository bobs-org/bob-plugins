function mailCloseCardWindow(modal) {
  try { return modal && modal.containerEl && modal.containerEl.ownerDocument && modal.containerEl.ownerDocument.defaultView; }
  catch (_error) { return typeof window !== "undefined" ? window : null; }
}

function normalizeMailCloseCardKey(value) {
  const key = String(value || "").toLowerCase();
  if (key === "control") return "ctrl";
  if (key === "altgraph") return "alt";
  if (key === "meta" || key === "os" || key === "super") return "meta";
  return key;
}

function mailCloseCardIsMacOS() {
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isMacOS === true) return true;
  } catch (_error) {}
  try {
    if (typeof obsidian !== "undefined" && obsidian.Platform && obsidian.Platform.isMacOS === true) return true;
  } catch (_error) {}
  return false;
}

function mailCloseCardFooterText(model, hasOpen) {
  const verb = model && model.verb === "cancel" ? "cancels" : model && model.verb === "close" ? "closes" : "completes";
  const openKey = mailCloseCardIsMacOS() ? "⌘↵" : "Ctrl+↵";
  if (hasOpen) return `y ${verb} \u00b7 ${openKey} opens the thread \u00b7 any other key keeps it`;
  return `y ${verb} \u00b7 any other key keeps it`;
}

class MailCloseCardModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.model = options.model || {};
    this.onConfirm = typeof options.onConfirm === "function" ? options.onConfirm : null;
    this.onKeep = typeof options.onKeep === "function" ? options.onKeep : null;
    this.openingChordKeys = new Set(
      (Array.isArray(options.openingKeys) ? options.openingKeys : [])
        .map(normalizeMailCloseCardKey)
        .filter(Boolean),
    );
    this.openingChordKeyupHandler = null;
    this.settled = false;
    this.confirmButton = null;
  }

  awaitingOpeningChordRelease() {
    return this.openingChordKeys instanceof Set && this.openingChordKeys.size > 0;
  }

  releaseOpeningChordKey(event) {
    if (!event || !(this.openingChordKeys instanceof Set)) return;
    this.openingChordKeys.delete(normalizeMailCloseCardKey(event.key));
  }

  onOpen() {
    const { contentEl } = this;
    if (contentEl && typeof contentEl.empty === "function") contentEl.empty();
    if (this.modalEl && typeof this.modalEl.addClass === "function") this.modalEl.addClass("bob-mail-close-modal");
    if (this.modalEl && typeof this.modalEl.setAttribute === "function") {
      this.modalEl.setAttribute("role", "alertdialog");
      this.modalEl.setAttribute("aria-modal", "true");
    }
    if (contentEl && typeof contentEl.addClass === "function") {
      contentEl.addClass("bob-mail-close-card");
      contentEl.addClass("bob-key-card");
      if (this.model.tone === "warning") contentEl.addClass("is-warning");
    }
    const header = contentEl.createDiv({ cls: "bob-mail-close-header" });
    const icon = header.createDiv({ cls: "bob-mail-close-icon" });
    applyIcon(icon, this.model.tone === "warning" ? "mail-warning" : "mail");
    const heading = header.createDiv({ cls: "bob-mail-close-heading" });
    const title = heading.createDiv({ cls: "bob-mail-close-title bob-key-card-title", text: String(this.model.title || "Close this email task?") });
    const subtitle = heading.createDiv({ cls: "bob-mail-close-subtitle", text: String(this.model.subtitle || "") });
    if (title && typeof title.setAttribute === "function") title.setAttribute("id", "bob-mail-close-title");
    const rows = contentEl.createDiv({ cls: "bob-mail-close-rows" });
    const sourceRows = Array.isArray(this.model.rows) ? this.model.rows.slice(0, 5) : [];
    for (const row of sourceRows) {
      const rowEl = rows.createDiv({ cls: "bob-mail-close-row" });
      rowEl.createDiv({ cls: "bob-mail-close-row-label", text: String(row.label || "Email task") });
      if (row.turn_line) rowEl.createDiv({ cls: `bob-mail-close-row-turn${this.model.tone === "warning" ? " is-warning" : ""}`, text: String(row.turn_line) });
      if (sourceRows.length > 1 && row.note) rowEl.createDiv({ cls: "bob-mail-close-row-note", text: String(row.note) });
    }
    if (Number(this.model.more) > 0) rows.createDiv({ cls: "bob-mail-close-more", text: `+${Number(this.model.more)} more email tasks` });
    const consequence = contentEl.createDiv({ cls: "bob-mail-close-consequence", text: String(this.model.consequence || "Bob stops watching this thread.") });
    if (consequence && typeof consequence.setAttribute === "function") consequence.setAttribute("id", "bob-mail-close-consequence");
    if (this.modalEl && typeof this.modalEl.setAttribute === "function") {
      this.modalEl.setAttribute("aria-labelledby", "bob-mail-close-title");
      this.modalEl.setAttribute("aria-describedby", "bob-mail-close-consequence");
    }
    const actions = contentEl.createDiv({ cls: "bob-mail-close-actions" });
    const first = sourceRows.find((row) => row && row.gmail_url);
    const hasOpen = Boolean(first && first.gmail_url);
    if (hasOpen) {
      const open = actions.createEl("button", { cls: "mod-ghost bob-mail-close-open", text: "Open in Gmail" });
      open.createSpan({ cls: "bob-key-card-key", text: mailCloseCardIsMacOS() ? "⌘↵" : "Ctrl+↵" });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        try { if (typeof obsidian !== "undefined" && typeof obsidian.openExternal === "function") obsidian.openExternal(String(first.gmail_url)); else if (typeof window !== "undefined" && window.open) window.open(String(first.gmail_url), "_blank"); } catch (_error) {}
      });
    }
    const keep = actions.createEl("button", { cls: "mod-cta bob-mail-close-keep", text: "Keep open" });
    keep.addEventListener("click", () => this.keepOpen());
    const confirmText = this.model.verb === "cancel" ? "Cancel anyway" : this.model.verb === "close" ? "Close anyway" : "Complete anyway";
    const confirm = actions.createEl("button", { cls: "mod-warning bob-mail-close-confirm", text: confirmText });
    confirm.createSpan({ cls: "bob-key-card-key", text: "y" });
    confirm.addEventListener("click", () => this.confirmClose());
    this.confirmButton = confirm;
    contentEl.createDiv({ cls: "bob-mail-close-footer bob-key-card-footer", text: mailCloseCardFooterText(this.model, hasOpen) });
    contentEl.addEventListener("keydown", (event) => this.handleKey(event));
    this.openingChordKeyupHandler = (event) => this.releaseOpeningChordKey(event);
    const view = mailCloseCardWindow(this);
    if (view && typeof view.addEventListener === "function") {
      view.addEventListener("keyup", this.openingChordKeyupHandler, true);
    }
    if (view && typeof view.setTimeout === "function") view.setTimeout(() => { try { keep.focus(); } catch (_error) {} }, 0);
  }

  handleKey(event) {
    if (!event || this.settled) return;
    if (this.awaitingOpeningChordRelease()) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.repeat || event.isComposing) { event.preventDefault(); event.stopPropagation(); return; }
    const key = String(event.key || "").toLowerCase();
    if (key === "y" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); this.confirmClose(); return;
    }
    if (key === "enter" && (event.metaKey || event.ctrlKey)) {
      const open = this.contentEl && this.contentEl.querySelector && this.contentEl.querySelector(".bob-mail-close-open");
      if (open) { event.preventDefault(); event.stopPropagation(); open.click(); return; }
    }
    event.preventDefault(); event.stopPropagation(); this.keepOpen();
  }

  confirmClose() {
    if (this.settled) return;
    this.settled = true;
    const callback = this.onConfirm;
    this.onConfirm = null; this.onKeep = null;
    this.releaseOpeningChordListener();
    try { if (callback) callback(); } finally { this.close(); }
  }

  keepOpen() {
    if (this.settled) return;
    this.settled = true;
    const callback = this.onKeep;
    this.onConfirm = null; this.onKeep = null;
    this.releaseOpeningChordListener();
    try { if (callback) callback(); } finally { this.close(); }
  }

  releaseOpeningChordListener() {
    try {
      const view = mailCloseCardWindow(this);
      if (this.openingChordKeyupHandler && view && typeof view.removeEventListener === "function") {
        view.removeEventListener("keyup", this.openingChordKeyupHandler, true);
      }
    } catch (_error) {}
    this.openingChordKeyupHandler = null;
    if (this.openingChordKeys instanceof Set) this.openingChordKeys.clear();
  }

  onClose() {
    this.releaseOpeningChordListener();
    if (!this.settled) {
      this.settled = true;
      const callback = this.onKeep;
      this.onConfirm = null; this.onKeep = null;
      try { if (callback) callback(); } catch (_error) {}
    }
  }
}
