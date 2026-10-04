class FreshnessDecayCardModal extends Modal {
  constructor(app, options) {
    super(app);
    const settings = options && typeof options === "object" ? options : {};
    this.decayTitle = String(settings.title || "Kept reviews in a row");
    this.decaySubtitle = String(settings.subtitle || "");
    this.decayRows = Array.isArray(settings.rows) ? settings.rows : [];
    this.onChoose =
      typeof settings.onChoose === "function" ? settings.onChoose : null;
    this.onDismiss =
      typeof settings.onDismiss === "function" ? settings.onDismiss : null;
    this.settled = false;
    this.rowEls = [];
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-decay-card-modal");
    contentEl.addClass("bob-decay-card");
    contentEl.addClass("bob-key-card");
    const header = contentEl.createDiv({ cls: "bob-decay-card-header" });
    const icon = header.createDiv({ cls: "bob-decay-card-icon" });
    applyIcon(icon, "leaf");
    const headerText = header.createDiv({ cls: "bob-decay-card-header-text" });
    headerText.createDiv({
      cls: "bob-decay-card-title bob-key-card-title",
      text: this.decayTitle,
    });
    if (this.decaySubtitle) {
      headerText.createDiv({
        cls: "bob-decay-card-subtitle",
        text: this.decaySubtitle,
      });
    }
    const list = contentEl.createDiv({ cls: "bob-decay-card-rows" });
    this.rowEls = this.decayRows.map((row) => {
      const rowEl = list.createDiv({
        cls:
          "bob-decay-card-row bob-key-card-row" +
          (row.available ? "" : " is-unavailable"),
      });
      rowEl.setAttribute("role", "button");
      rowEl.setAttribute(
        "aria-label",
        row.available
          ? `${row.label}: ${row.detail}`
          : `${row.label} unavailable: ${row.detail}`,
      );
      if (row.available) {
        rowEl.setAttribute("tabindex", "0");
      } else {
        rowEl.setAttribute("aria-disabled", "true");
      }
      rowEl.createDiv({
        cls: "bob-decay-card-key bob-key-card-key",
        text: row.key,
      });
      const body = rowEl.createDiv({ cls: "bob-decay-card-body" });
      const labelRow = body.createDiv({ cls: "bob-decay-card-label-row" });
      labelRow.createSpan({ cls: "bob-decay-card-label", text: row.label });
      if (row.recommended) {
        labelRow.createSpan({
          cls: "bob-decay-card-recommended",
          text: "recommended",
        });
      }
      body.createDiv({ cls: "bob-decay-card-detail", text: row.detail });
      if (row.available) {
        rowEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.choose(row.action);
        });
        rowEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            this.choose(row.action);
          }
        });
      }
      return rowEl;
    });
    contentEl.createDiv({
      cls: "bob-decay-card-footer bob-key-card-footer",
      text: "Esc changes nothing · D / X drops · 1–4 pick a P-level instead",
    });
    contentEl.addEventListener("keydown", (event) => this.handleKey(event));
    window.setTimeout(() => {
      const first = this.rowEls.find((rowEl, index) => {
        const row = this.decayRows[index];
        return row && row.available;
      });
      if (first && typeof first.focus === "function") {
        first.focus();
      }
    }, 0);
  }

  handleKey(event) {
    if (!event || this.settled) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    // The opening refresh chord (and any held-key repeat) must not approve:
    // only a fresh, non-repeat supported Alt+F / Ctrl+Alt+F press chooses Keep.
    if (
      isReviewRefreshKeydown(event, false) ||
      isReviewRefreshKeydown(event, true)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) {
        return;
      }
      this.choose("keep");
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.repeat) {
      return;
    }
    const key = String(event.key || "").toLowerCase();
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.choose("notNow");
      return;
    }
    if (key === "l") {
      event.preventDefault();
      event.stopPropagation();
      this.choose("lessOften");
      return;
    }
    if (key === "e") {
      event.preventDefault();
      event.stopPropagation();
      this.choose("reword");
      return;
    }
    if (key === "d" || key === "x") {
      event.preventDefault();
      event.stopPropagation();
      this.choose("drop");
      return;
    }
    if (/^[1-4]$/.test(key)) {
      event.preventDefault();
      event.stopPropagation();
      this.choose(`level:${Number(key) - 1}`);
    }
  }

  choose(action) {
    if (this.settled) {
      return;
    }
    const row = this.decayRows.find((candidate) => candidate && candidate.action === action);
    if (!row || !row.available) {
      return;
    }
    this.settled = true;
    const callback = this.onChoose;
    this.onChoose = null;
    this.onDismiss = null;
    try {
      if (typeof callback === "function") {
        callback(action);
      }
    } finally {
      this.close();
    }
  }

  onClose() {
    contentElCleanup(this.contentEl);
    if (!this.settled && typeof this.onDismiss === "function") {
      try {
        this.onDismiss();
      } catch (error) {
        // Best effort: dismissal writes nothing by construction.
      }
    }
    this.onChoose = null;
    this.onDismiss = null;
  }
}
