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
    this.onKeepReason =
      typeof settings.onKeepReason === "function"
        ? settings.onKeepReason
        : null;
    this.rottenHeader =
      typeof settings.rottenHeader === "string" ? settings.rottenHeader : "";
    this.rottenKeep =
      settings.rotten && typeof settings.rotten === "object"
        ? settings.rotten
        : null;
    this.keepStageActive = false;
    this.keepStage = null;
    this.settled = false;
    this.rowEls = [];
    this.rowsEl = null;
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
    if (this.rottenHeader) {
      headerText.createDiv({
        cls: "bob-decay-card-rotten",
        text: this.rottenHeader,
      });
    }
    this.rowsEl = contentEl.createDiv({ cls: "bob-decay-card-rows" });
    this.renderRows();
    contentEl.createDiv({
      cls: "bob-decay-card-footer bob-key-card-footer",
      text: "Esc changes nothing · D / X drops · 1–4 pick a P-level instead",
    });
    contentEl.addEventListener("keydown", (event) => this.handleKey(event));
    window.setTimeout(() => {
      this.focusKeepRowOrFirst();
    }, 0);
  }

  focusKeepRowOrFirst() {
    const keepIndex = this.decayRows.findIndex(
      (row) => row && row.action === "keep" && row.available,
    );
    const ordered =
      keepIndex >= 0
        ? [this.rowEls[keepIndex], ...this.rowEls]
        : this.rowEls;
    for (const rowEl of ordered) {
      if (rowEl && typeof rowEl.focus === "function") {
        rowEl.focus();
        return;
      }
    }
  }

  renderRows() {
    if (!this.rowsEl) {
      return;
    }
    this.rowsEl.empty();
    this.rowEls = this.decayRows.map((row) => {
      const rowEl = this.rowsEl.createDiv({
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
  }

  canKeepStage() {
    return Boolean(this.rottenKeep && this.onKeepReason && !this.settled);
  }

  showKeepStage() {
    if (!this.canKeepStage() || !this.rowsEl) {
      return false;
    }
    this.keepStageActive = true;
    this.rowsEl.empty();
    this.rowEls = [];
    this.keepStage = new RottenKeepReasonStage(this.rowsEl, {
      ...this.rottenKeep,
      onSubmit: (reason) => this.submitKeepStage(reason),
      onCancel: () => this.showRows(),
    });
    window.setTimeout(() => {
      if (this.keepStage) {
        this.keepStage.focus();
      }
    }, 0);
    return true;
  }

  showRows() {
    if (!this.keepStageActive) {
      return false;
    }
    if (this.keepStage) {
      try {
        this.keepStage.destroy();
      } catch (error) {
        // Best effort: the rows re-render below regardless.
      }
    }
    this.keepStage = null;
    this.keepStageActive = false;
    this.renderRows();
    window.setTimeout(() => {
      this.focusKeepRowOrFirst();
    }, 0);
    return true;
  }

  submitKeepStage(reason) {
    if (this.settled || !this.keepStageActive || !this.keepStage) {
      return;
    }
    const value = typeof reason === "string" ? reason : this.keepStage.value();
    try {
      if (
        buildRottenKeepPromptModel({ ...this.rottenKeep, reason: value })
          .disabled
      ) {
        return;
      }
    } catch (error) {
      return;
    }
    this.settled = true;
    const callback = this.onKeepReason;
    this.onChoose = null;
    this.onDismiss = null;
    this.onKeepReason = null;
    try {
      if (typeof callback === "function") {
        callback(value);
      }
    } finally {
      this.close();
    }
  }

  handleKey(event) {
    if (!event || this.settled) {
      return;
    }
    if (this.keepStageActive) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.showRows();
        return;
      }
      // The opening refresh chord (and any held-key repeat) must never
      // submit the stage: only an explicit Enter does.
      if (
        isReviewRefreshKeydown(event, false) ||
        isReviewRefreshKeydown(event, true)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Enter") {
        if (event.isComposing || event.repeat) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.submitKeepStage();
        return;
      }
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
    if (action === "keep" && this.keepStageActive) {
      return;
    }
    if (action === "keep" && this.canKeepStage()) {
      this.showKeepStage();
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
    this.onKeepReason = null;
    try {
      if (typeof callback === "function") {
        callback(action);
      }
    } finally {
      this.close();
    }
  }

  onClose() {
    if (this.keepStage) {
      try {
        this.keepStage.destroy();
      } catch (error) {
        // Best effort: dismissal writes nothing by construction.
      }
    }
    this.keepStage = null;
    this.keepStageActive = false;
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
    this.onKeepReason = null;
  }
}
