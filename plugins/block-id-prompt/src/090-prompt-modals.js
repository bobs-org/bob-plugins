class BlockIdPromptModal extends Modal {
  constructor(app, plugin, source) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.completed = false;
    this.submitting = false;
    this.input = null;
    this.previewEl = null;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Block ID" });
    this.createPreviewEl();
    this.loadPreview();

    new Setting(this.contentEl).setName("ID").addText((text) => {
      this.input = text;
      text.setPlaceholder("my-id");
      if (this.source.prefillId && this.source.oldId) {
        text.setValue(this.source.oldId);
      }
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        this.submit();
      });
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Save")
          .setCta()
          .onClick(() => this.submit()),
      );

    window.setTimeout(() => {
      if (this.input && this.input.inputEl) {
        this.input.inputEl.focus();
        if (this.source.prefillId && this.input.getValue()) {
          this.input.inputEl.select();
        }
      }
    }, 0);
  }

  createPreviewEl() {
    this.previewEl = this.contentEl.createEl("div", {
      text: "Loading block contents...",
    });
    this.previewEl.setAttribute("aria-label", "Current block contents");
    this.previewEl.setAttribute("role", "note");
    Object.assign(this.previewEl.style, {
      backgroundColor: "var(--background-secondary)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "4px",
      color: "var(--text-muted)",
      lineHeight: "var(--line-height-normal)",
      margin: "0 0 12px 0",
      maxHeight: "12rem",
      overflowWrap: "anywhere",
      overflowY: "auto",
      padding: "10px 12px",
      userSelect: "text",
      whiteSpace: "pre-wrap",
    });
  }

  setPreviewText(text, muted) {
    if (!this.previewEl) {
      return;
    }

    this.previewEl.textContent = text;
    this.previewEl.style.color = muted
      ? "var(--text-muted)"
      : "var(--text-normal)";
  }

  async loadPreview() {
    const previewEl = this.previewEl;
    const previewText = await this.plugin.readBlockPreviewText(this.source);

    if (!previewEl || previewEl !== this.previewEl || !previewEl.isConnected) {
      return;
    }

    if (previewText) {
      this.setPreviewText(previewText, false);
    } else {
      this.setPreviewText("Block contents unavailable", true);
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    const id = this.input ? this.input.getValue().trim() : "";
    if (!id) {
      new Notice("Block ID cannot be blank");
      return;
    }

    if (!BLOCK_ID_RE.test(id)) {
      new Notice("Block ID can only contain letters, numbers, and hyphens");
      return;
    }

    this.submitting = true;
    try {
      const accepted = await this.plugin.submitBlockId(this.source, id);
      if (accepted) {
        this.completed = true;
        this.close();
      }
    } finally {
      this.submitting = false;
    }
  }

  onClose() {
    this.contentEl.empty();

    if (!this.completed && !this.submitting) {
      this.plugin.cancelBlockIdPrompt(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }
}

class WorkSummaryPromptModal extends Modal {
  constructor(app, plugin, source) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.workLogDate = localTodayParts(plugin.now());
    this.completed = false;
    this.submitting = false;
    this.inputEl = null;
    this.previewEl = null;
    this.warningEl = null;
    this.primaryButton = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-wlp-modal");
    contentEl.addClass("bid-wlp");

    const header = contentEl.createDiv({ cls: "bid-wlp-header" });
    const headerIcon = header.createDiv({ cls: "bid-wlp-header-icon" });
    applyIcon(headerIcon, "pause-circle");
    const headerText = header.createDiv({ cls: "bid-wlp-header-text" });
    headerText.createDiv({ cls: "bid-wlp-title", text: "Unlink task" });
    headerText.createDiv({
      cls: "bid-wlp-subtitle",
      text: "Optional: why is this pending? Saved to the Work Log.",
    });

    const contextEl = contentEl.createDiv({
      cls: "bid-wlp-context",
      attr: { role: "note", "aria-label": "Selected task" },
    });
    contextEl.createDiv({
      cls: "bid-wlp-context-task",
      text: this.source.task && this.source.task.displayText
        ? this.source.task.displayText
        : "(untitled task)",
    });
    contextEl.createDiv({
      cls: "bid-wlp-context-source",
      text: this.source.contextPath || this.source.sourcePath || "Current note",
    });

    const fieldEl = contentEl.createDiv({ cls: "bid-wlp-field" });
    fieldEl.createEl("label", {
      cls: "bid-wlp-label",
      attr: { for: "bid-wlp-summary" },
      text: "Work summary (optional)",
    });
    this.inputEl = fieldEl.createEl("input", {
      cls: "bid-wlp-input",
      attr: {
        id: "bid-wlp-summary",
        "aria-describedby": "bid-wlp-preview bid-wlp-warning",
        placeholder: "What did you get done?",
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => this.updatePreview());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.submit();
    });

    this.previewEl = contentEl.createDiv({
      cls: "bid-wlp-preview",
      attr: { id: "bid-wlp-preview", role: "note", "aria-live": "polite" },
    });
    this.warningEl = contentEl.createDiv({
      cls: "bid-wlp-warning",
      attr: { id: "bid-wlp-warning", role: "status" },
      text: "Contains ::, which Dataview may read as an inline field.",
    });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) => {
        this.primaryButton = button;
        button
          .setButtonText("Unlink")
          .setCta()
          .onClick(() => this.submit());
      });

    this.updatePreview();
    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  updatePreview() {
    if (!this.previewEl) {
      return;
    }

    const state = workSummaryPromptState(this.inputEl ? this.inputEl.value : "", {
      date: this.workLogDate,
    });
    if (this.primaryButton && typeof this.primaryButton.setButtonText === "function") {
      this.primaryButton.setButtonText(state.primaryButtonText);
    }

    this.previewEl.empty();
    if (state.isBlank) {
      this.previewEl.setAttribute("aria-label", "No work-log entry will be added.");
      this.previewEl.createDiv({
        cls: "bid-wlp-preview-muted",
        text: "No work-log entry will be added.",
      });
    } else {
      this.previewEl.setAttribute("aria-label", state.formattedEntry);
      this.previewEl.createDiv({
        cls: "bid-wlp-preview-marker",
        text: `${WORK_LOG_EMOJI} **${WORK_LOG_LABEL}**`,
      });
      const entryEl = this.previewEl.createDiv({
        cls: "bid-wlp-preview-entry",
      });
      entryEl.createEl("em", {
        cls: "bid-wlp-preview-date",
        text: formatCalendarDate(state.date),
      });
      entryEl.createSpan({
        cls: "bid-wlp-preview-separator",
        text: WORK_LOG_ENTRY_SEPARATOR,
      });
      entryEl.createSpan({
        cls: "bid-wlp-preview-summary",
        text: state.summary,
      });
    }

    if (this.warningEl) {
      this.warningEl.toggleClass("is-hidden", !state.hasDataviewWarning);
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    try {
      const accepted = await this.plugin.submitPomodoroWorkSummary(
        this.source,
        this.inputEl ? this.inputEl.value : "",
        { workLogDate: this.workLogDate },
      );
      if (accepted) {
        this.completed = true;
        this.close();
      }
    } finally {
      this.submitting = false;
    }
  }

  onClose() {
    this.modalEl.removeClass("bid-wlp-modal");
    this.contentEl.empty();

    if (!this.completed && !this.submitting) {
      this.plugin.cancelWorkSummaryPrompt(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }
}

