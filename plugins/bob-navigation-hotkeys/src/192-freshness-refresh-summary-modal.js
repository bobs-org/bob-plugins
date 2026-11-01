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
    const totalCount = Math.max(
      1,
      Math.floor(numericOrDefault(this.options.totalCount, 1)),
    );
    const eligibleCount = Math.max(
      0,
      Math.floor(numericOrDefault(this.options.eligibleCount, totalCount)),
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
    const subtitleParts = [];
    if (eligibleCount !== totalCount) {
      subtitleParts.push(`${eligibleCount} of ${totalCount} ${taskWord} qualify`);
    }
    subtitleParts.push("nothing written yet");
    headerText.createDiv({
      cls: "bob-cnp-subtitle",
      text: subtitleParts.join(" · "),
    });
    const inputWrap = contentEl.createDiv({ cls: "bob-cnp-search" });
    const inputIcon = inputWrap.createDiv({ cls: "bob-cnp-search-icon" });
    applyIcon(inputIcon, "briefcase");
    this.inputEl = inputWrap.createEl("input", {
      cls: "bob-cnp-input",
      attr: {
        "aria-label": "Work summary",
        placeholder: "What did you get done? (optional · ↵ to skip)",
        type: "text",
      },
    });
    this.previewEl = contentEl.createDiv({ cls: "bob-cnp-results" });
    this.hintsEl = contentEl.createDiv({ cls: "bob-cnp-footer" });
    this.inputEl.addEventListener("input", () => this.renderPreview());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
    const actions = contentEl.createDiv({ cls: "bob-cnp-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
    this.refreshButton = actions.createEl("button", { text: "Refresh" });
    this.refreshButton.addEventListener("click", () => this.submit());
    this.renderPreview();
    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  renderBatchFields(contentEl) {
    const keepTargets = this.options.keepTargets || [];
    const showWorkField = this.options.showWorkField === true;
    const hasCountedTargets = keepTargets.some((target) => target.kind !== "lane");
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

    if (showWorkField) {
      const field = contentEl.createDiv({ cls: "bob-cnp-field bob-cnp-work-field" });
      field.createDiv({ cls: "bob-cnp-field-title", text: "Work summary" });
      const inputWrap = field.createDiv({ cls: "bob-cnp-search" });
      const inputIcon = inputWrap.createDiv({ cls: "bob-cnp-search-icon" });
      applyIcon(inputIcon, "briefcase");
      this.workInputEl = inputWrap.createEl("input", {
        cls: "bob-cnp-input",
        attr: {
          "aria-label": "Work summary",
          placeholder: "What did you get done? (optional · ↵ to skip)",
          type: "text",
        },
      });
      this.workPreviewEl = field.createDiv({ cls: "bob-cnp-results" });
    }

    if (keepTargets.length > 0) {
      const field = contentEl.createDiv({ cls: "bob-cnp-field bob-cnp-rotten-field" });
      field.createDiv({ cls: "bob-cnp-field-title", text: "Keep reason" });
      const inputWrap = field.createDiv({ cls: "bob-cnp-search" });
      inputWrap.createDiv({ cls: "bob-cnp-search-icon", text: "🥀" });
      this.keepInputEl = inputWrap.createEl("input", {
        cls: "bob-cnp-input",
        attr: {
          "aria-label": "Keep reason",
          placeholder: hasCountedTargets
            ? "Why keep them as written? (optional · ↵ logs 🤷)"
            : "Why keep them in Next? (optional · ↵ to skip)",
          type: "text",
        },
      });
      this.keepPreviewEl = field.createDiv({ cls: "bob-cnp-results" });
    }

    this.inputEl = this.workInputEl || this.keepInputEl;
    this.hintsEl = contentEl.createDiv({ cls: "bob-cnp-footer" });
    for (const input of [this.workInputEl, this.keepInputEl].filter(Boolean)) {
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
        } else if (
          event.key === "Tab" &&
          this.workInputEl &&
          this.keepInputEl
        ) {
          event.preventDefault();
          event.stopPropagation();
          const next = event.shiftKey
            ? (input === this.keepInputEl ? this.workInputEl : this.keepInputEl)
            : (input === this.workInputEl ? this.keepInputEl : this.workInputEl);
          next.focus();
        }
      });
    }
    const actions = contentEl.createDiv({ cls: "bob-cnp-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.refreshButton = actions.createEl("button", { text: "Refresh" });
    this.refreshButton.addEventListener("click", () => this.submit());
    this.renderBatchPreview();
    window.setTimeout(() => {
      const first = this.workInputEl || this.keepInputEl;
      if (first) first.focus();
    }, 0);
  }

  renderBatchPreview() {
    if (this.workPreviewEl && this.workInputEl) {
      const summary = normalizeLaneWorkSummary(this.workInputEl.value);
      const hasInlineField = summary.includes("::");
      this.workPreviewEl.empty();
      const row = this.workPreviewEl.createDiv({
        cls: "bob-cnp-row bob-cnp-schedule-reason-row",
      });
      addElementClasses(
        row,
        summary ? (hasInlineField ? "is-warning" : "is-valid") : "is-empty",
      );
      const icon = row.createDiv({ cls: "bob-cnp-row-icon" });
      applyIcon(icon, summary ? (hasInlineField ? "alert-triangle" : "check-circle-2") : "minus-circle");
      const text = row.createDiv({ cls: "bob-cnp-row-text" });
      text.createDiv({
        cls: "bob-cnp-row-title",
        text: summary
          ? formatLaneWorkLogEntry(
              summary,
              formatWorkLogStamp(
                this.options.now instanceof Date
                  ? this.options.now
                  : new Date(),
              ),
            )
          : "No summary",
      });
      if (hasInlineField) {
        text.createDiv({
          cls: "bob-cnp-row-meta",
          text: '"::" creates a Dataview inline field on this bullet',
        });
      }
      const eligibleCount = Math.max(
        1,
        Math.floor(numericOrDefault(this.options.eligibleCount, 1)),
      );
      text.createDiv({
        cls: "bob-cnp-schedule-reason-preview",
        text: summary
          ? eligibleCount === 1
            ? "Prepends under 🛠️ **WORK LOG** on the qualifying task"
            : `Prepends under 🛠️ **WORK LOG** on each of the ${eligibleCount} qualifying tasks`
          : "Refresh only; no Work Log entry",
      });
    }
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
        const isLane = target.kind === "lane";
        const keeps = target.keep && Number.isInteger(target.keep.keepsAfter)
          ? target.keep.keepsAfter
          : parseKeepsCount(target.raw || entry.originalMarkdown || "");
        const history = target.history || { status: "missing", entries: [] };
        const count = Array.isArray(history.entries) ? history.entries.length : 0;
        const logged = ["unknown", "ambiguous"].includes(history.status)
          ? "log unreadable"
          : `${count} logged`;
        const row = this.keepPreviewEl.createDiv({
          cls: "bob-cnp-row bob-cnp-schedule-reason-row",
        });
        const text = row.createDiv({ cls: "bob-cnp-row-text" });
        text.createDiv({
          cls: "bob-cnp-row-title",
          text: isLane ? `${title} · Next · ${count} logged`
            : `${title} · kept ${keeps}× · ${logged}`,
        });
        text.createDiv({
          cls: "bob-cnp-row-meta",
          text: isLane
            ? reason
              ? formatRottenLogEntryText({ date: this.options.dateText, reason, lane: "next" })
              : "no entry (blank reason)"
            : formatRottenLogEntryText({ date: this.options.dateText, reason, keeps }),
        });
      }
      const willWriteCount = targets.filter((target) => target.kind !== "lane").length +
        (reason ? targets.filter((target) => target.kind === "lane").length : 0);
      const destination = this.keepPreviewEl.createDiv({
        cls: "bob-cnp-row-meta bob-cnp-schedule-reason-preview",
        text: willWriteCount === 0
          ? "Refresh only; no Rotten Log entry"
          : `Writes one entry under 🥀 **ROTTEN LOG** on each of the ${willWriteCount} qualifying ${willWriteCount === 1 ? "task" : "tasks"}`,
      });
      if (destination && typeof destination.setAttribute === "function") {
        destination.setAttribute("aria-live", "polite");
      }
    }
    if (this.hintsEl) {
      this.hintsEl.empty();
      const reason = normalizeLaneWorkSummary(this.keepInputEl && this.keepInputEl.value);
      const hasCounted = this.options.keepTargets.some((target) => target.kind !== "lane");
      const hasLane = this.options.keepTargets.some((target) => target.kind === "lane");
      const actionLabel = this.options.showWorkField && this.options.keepTargets.length
        ? "Refresh, log & continue"
        : hasCounted ? "Keep & log"
          : hasLane ? reason ? "Keep & log" : "Keep"
            : "Refresh";
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
      const reason = normalizeLaneWorkSummary(this.keepInputEl && this.keepInputEl.value);
      const hasCounted = this.options.keepTargets.some((target) => target.kind !== "lane");
      const hasLane = this.options.keepTargets.some((target) => target.kind === "lane");
      this.refreshButton.setText(this.options.showWorkField && this.options.keepTargets.length
        ? "Refresh & log"
        : hasCounted ? "Keep & log"
          : hasLane ? reason ? "Keep & log" : "Keep"
            : "Refresh");
      this.refreshButton.disabled = this.options.keepTargets.some((target) => {
        const history = target && target.history;
        const ambiguous = history && ["unknown", "ambiguous"].includes(history.status);
        return Boolean(ambiguous && (target.kind !== "lane" || reason));
      });
    }
  }

  renderPreview() {
    if (!this.previewEl || !this.inputEl) {
      return;
    }
    const summary = normalizeLaneWorkSummary(this.inputEl.value);
    const hasInlineField = summary.includes("::");
    this.previewEl.empty();
    const row = this.previewEl.createDiv({
      cls: "bob-cnp-row bob-cnp-schedule-reason-row",
    });
    addElementClasses(
      row,
      summary ? (hasInlineField ? "is-warning" : "is-valid") : "is-empty",
    );
    const icon = row.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(icon, summary ? (hasInlineField ? "alert-triangle" : "check-circle-2") : "minus-circle");
    const text = row.createDiv({ cls: "bob-cnp-row-text" });
    text.createDiv({
      cls: "bob-cnp-row-title",
      text: summary
        ? formatLaneWorkLogEntry(
            summary,
            formatWorkLogStamp(
              this.options.now instanceof Date ? this.options.now : new Date(),
            ),
          )
        : "No summary",
    });
    if (hasInlineField) {
      text.createDiv({
        cls: "bob-cnp-row-meta",
        text: '"::" creates a Dataview inline field on this bullet',
      });
    }
    const eligibleCount = Math.max(
      1,
      Math.floor(numericOrDefault(this.options.eligibleCount, 1)),
    );
    text.createDiv({
      cls: "bob-cnp-schedule-reason-preview",
      text: summary
        ? eligibleCount === 1
          ? "Prepends under 🛠️ **WORK LOG** on the qualifying task"
          : `Prepends under 🛠️ **WORK LOG** on each of the ${eligibleCount} qualifying tasks`
        : "Refresh only; no Work Log entry",
    });
    if (this.hintsEl) {
      this.hintsEl.empty();
      const enter = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      enter.createEl("kbd", { cls: "bob-cnp-kbd", text: "↵" });
      enter.createSpan({
        cls: "bob-cnp-hint-label",
        text: summary ? "Refresh & log summary" : "Refresh without a summary",
      });
      const escape = this.hintsEl.createSpan({ cls: "bob-cnp-hint" });
      escape.createEl("kbd", { cls: "bob-cnp-kbd", text: "esc" });
      escape.createSpan({ cls: "bob-cnp-hint-label", text: "Cancel" });
    }
  }

  submit() {
    if (Array.isArray(this.options.keepTargets)) {
      if (this.completed || (this.refreshButton && this.refreshButton.disabled)) return;
      this.completed = true;
      try {
        if (typeof this.onDone === "function") {
          this.onDone({
            summary: this.workInputEl ? String(this.workInputEl.value || "") : "",
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

