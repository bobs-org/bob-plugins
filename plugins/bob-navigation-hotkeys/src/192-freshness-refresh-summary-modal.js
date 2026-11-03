class FreshnessRefreshSummaryModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options || {};
    this.onDone = this.options.onDone;
    this.completed = false;
    this.inputEl = null;
    this.previewEl = null;
    this.hintsEl = null;
    this.refreshButton = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-cnp-modal");
    contentEl.addClass("bob-cnp");
    if (Array.isArray(this.options.keepTargets)) {
      this.renderBatchFields(contentEl);
      return;
    }
    if (this.options.keep) {
      this.keepStage = new RottenKeepReasonStage(contentEl, {
        ...this.options.keep,
        dateText: this.options.dateText,
        onModel: (model) => {
          if (!this.refreshButton) return;
          this.refreshButton.setText(model.enterHint);
          this.refreshButton.disabled = model.disabled;
        },
        onSubmit: () => this.submit(),
        onCancel: () => this.close(),
      });
      this.inputEl = this.keepStage.inputEl;
      this.previewEl = this.keepStage.previewEl;
      const actions = contentEl.createDiv({ cls: "bob-cnp-modal-actions" });
      actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
      const model = buildRottenKeepPromptModel(this.options.keep);
      this.refreshButton = actions.createEl("button", { text: model.enterHint });
      this.refreshButton.disabled = model.disabled;
      this.refreshButton.addEventListener("click", () => this.submit());
      window.setTimeout(() => { if (this.keepStage) this.keepStage.focus(); }, 0);
      return;
    }
    // Freshness gestures never ask for a Work Log summary, so a prompt
    // with no keep target closes without writing.
    this.close();
  }

  renderBatchFields(contentEl) {
    const keepTargets = this.options.keepTargets || [];
    const totalCount = Math.max(
      1,
      Math.floor(numericOrDefault(this.options.totalCount, keepTargets.length)),
    );
    const taskWord = totalCount === 1 ? "task" : "tasks";
    const header = contentEl.createDiv({ cls: "bob-cnp-header" });
    const headerIcon = header.createDiv({ cls: "bob-cnp-header-icon" });
    applyIcon(headerIcon, "refresh-cw");
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    headerText.createDiv({
      cls: "bob-cnp-title",
      text: totalCount === 1 ? "Refresh task" : `Refresh ${totalCount} tasks`,
    });
    headerText.createDiv({
      cls: "bob-cnp-subtitle",
      text: "nothing written yet",
    });

    if (keepTargets.length > 0) {
      const field = contentEl.createDiv({ cls: "bob-cnp-field bob-cnp-rotten-field" });
      field.createDiv({ cls: "bob-cnp-field-title", text: "Keep reason" });
      const inputWrap = field.createDiv({ cls: "bob-cnp-search" });
      inputWrap.createDiv({ cls: "bob-cnp-search-icon", text: "🥀" });
      this.keepInputEl = inputWrap.createEl("input", {
        cls: "bob-cnp-input",
        attr: {
          "aria-label": "Keep reason",
          placeholder: "Why keep them? (optional · ↵ logs 🤷)",
          type: "text",
        },
      });
      this.keepPreviewEl = field.createDiv({ cls: "bob-cnp-results" });
    }

    this.inputEl = this.keepInputEl;
    this.hintsEl = contentEl.createDiv({ cls: "bob-cnp-footer" });
    for (const input of [this.keepInputEl].filter(Boolean)) {
      input.addEventListener("input", () => this.renderBatchPreview());
      input.addEventListener("keydown", (event) => {
        if (isReviewRefreshKeydown(event, false) || isReviewRefreshKeydown(event, true)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter") {
          if (event.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          this.submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      });
    }
    const actions = contentEl.createDiv({ cls: "bob-cnp-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.refreshButton = actions.createEl("button", { text: "Refresh" });
    this.refreshButton.addEventListener("click", () => this.submit());
    this.renderBatchPreview();
    window.setTimeout(() => {
      if (this.keepInputEl) this.keepInputEl.focus();
    }, 0);
  }

  renderBatchPreview() {
    if (this.keepPreviewEl && this.keepInputEl) {
      const reason = normalizeLaneWorkSummary(this.keepInputEl.value);
      this.keepPreviewEl.empty();
      const targets = Array.isArray(this.options.keepTargets)
        ? this.options.keepTargets
        : [];
      for (const target of targets) {
        const entry = target.entry || {};
        const title = cleanTaskDisplayText(
          target.raw || entry.originalMarkdown || entry.text || "Task",
        );
        const rung = target.rung || target.keep?.rung ||
          (target.kind === "lane" ? "Next" : "Ready");
        const keeps = target.keep && Number.isInteger(target.keep.keepsAfter)
          ? target.keep.keepsAfter
          : parseKeepsCount(target.raw || entry.originalMarkdown || "");
        const history = target.history || { status: "missing", entries: [] };
        const tallies = formatRottenLogRungTallies(history.entries || []);
        const logged = ["unknown", "ambiguous"].includes(history.status)
          ? "log unreadable"
          : tallies || "none logged yet";
        const row = this.keepPreviewEl.createDiv({
          cls: "bob-cnp-row bob-cnp-schedule-reason-row",
        });
        const text = row.createDiv({ cls: "bob-cnp-row-text" });
        text.createDiv({
          cls: "bob-cnp-row-title",
          text: `${title} · ${rung} · ${logged}`,
        });
        text.createDiv({
          cls: "bob-cnp-row-meta",
          text: formatRottenLogEntryText({ date: this.options.dateText, reason, keeps, rung }),
        });
      }
      const destination = this.keepPreviewEl.createDiv({
        cls: "bob-cnp-row-meta bob-cnp-schedule-reason-preview",
        text: targets.length === 0
          ? "Refresh only; no Rotten Log entry"
          : `Writes one entry under 🥀 **ROTTEN LOG** on each of the ${targets.length} qualifying ${targets.length === 1 ? "task" : "tasks"}`,
      });
      if (destination && typeof destination.setAttribute === "function") {
        destination.setAttribute("aria-live", "polite");
      }
    }
    if (this.hintsEl) {
      this.hintsEl.empty();
      const hasKeep = (this.options.keepTargets || []).length > 0;
      const actionLabel = hasKeep ? "Keep & log" : "Refresh";
      const enter = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      enter.createEl("kbd", { cls: "bob-cnp-kbd", text: "↵" });
      enter.createSpan({
        cls: "bob-cnp-hint-label",
        text: actionLabel,
      });
      const escape = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      escape.createEl("kbd", { cls: "bob-cnp-kbd", text: "esc" });
      escape.createSpan({ cls: "bob-cnp-hint-label", text: "Cancel" });
    }
    if (this.refreshButton) {
      const hasKeep = (this.options.keepTargets || []).length > 0;
      this.refreshButton.setText(hasKeep ? "Keep & log" : "Refresh");
      this.refreshButton.disabled = (this.options.keepTargets || []).some((target) => {
        const history = target && target.history;
        return Boolean(history && ["unknown", "ambiguous"].includes(history.status));
      });
    }
  }

  submit() {
    if (Array.isArray(this.options.keepTargets)) {
      if (this.completed || (this.refreshButton && this.refreshButton.disabled)) return;
      this.completed = true;
      try {
        if (typeof this.onDone === "function") {
          this.onDone({
            summary: "",
            keepReason: this.keepInputEl ? String(this.keepInputEl.value || "") : "",
          });
        }
      } finally {
        this.close();
      }
      return;
    }
    if (this.completed || (this.options.keep && buildRottenKeepPromptModel({
      ...this.options.keep,
      reason: this.inputEl ? this.inputEl.value : "",
    }).disabled)) {
      return;
    }
    this.completed = true;
    const value = this.inputEl ? this.inputEl.value : "";
    try {
      if (typeof this.onDone === "function") {
        this.onDone(String(value || ""));
      }
    } finally {
      this.close();
    }
  }

  onClose() {
    if (this.keepStage) this.keepStage.destroy();
    this.keepStage = null;
    contentElCleanup(this.contentEl);
    if (!this.completed && typeof this.onDone === "function") {
      try {
        this.onDone(null);
      } catch (error) {
        // Best effort.
      }
    }
    this.onDone = null;
  }
}

