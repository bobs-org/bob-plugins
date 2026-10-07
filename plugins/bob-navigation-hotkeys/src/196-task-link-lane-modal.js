// Move to Next prompt for the Task Link lane toggle (plan
// 202610/in_progress_task_link_marks.md D8). Styled like block-id-prompt's
// polished `Unlink task` prompt (`bid-wlp`), so the two Work Log prompts
// look like one family; the `bob-tll-*` styles live in this plugin's
// `styles.css`. Calls back with null on cancel/Esc or `{ summary }` on
// submit. A blank summary moves without logging.
class TaskLinkLanePromptModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options || {};
    this.onDone = this.options.onDone;
    this.completed = false;
    this.inputEl = null;
    this.previewEl = null;
    this.warningEl = null;
    this.primaryButton = null;
  }

  taskLinkLaneTasks() {
    const tasks = this.options.tasks;
    if (!Array.isArray(tasks)) {
      return [];
    }
    return tasks
      .filter((task) => task && typeof task === "object")
      .map((task) =>
        Object.freeze({
          displayText: String(task.displayText || "(untitled task)"),
          path: String(task.path || "Current note"),
        }),
      );
  }

  taskLinkLaneDateText() {
    if (typeof this.options.dateText === "string" && this.options.dateText) {
      return String(this.options.dateText);
    }
    return formatBulletPropertyDate(getLocalDateStart(new Date()));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-tll-modal");
    contentEl.addClass("bob-tll");

    const header = contentEl.createDiv({ cls: "bob-tll-header" });
    const headerIcon = header.createDiv({ cls: "bob-tll-header-icon" });
    applyIcon(headerIcon, "pause-circle");
    const headerText = header.createDiv({ cls: "bob-tll-header-text" });
    headerText.createDiv({ cls: "bob-tll-title", text: "Move to Next" });
    headerText.createDiv({
      cls: "bob-tll-subtitle",
      text: "Optional: what did you get done? Saved to the Work Log.",
    });

    const tasks = this.taskLinkLaneTasks();
    const contextEl = contentEl.createDiv({
      cls: "bob-tll-context",
      attr: { role: "note", "aria-label": "Selected tasks" },
    });
    if (tasks.length <= 1) {
      const single = tasks.length === 1 ? tasks[0] : null;
      contextEl.createDiv({
        cls: "bob-tll-context-task",
        text: single ? single.displayText : "(untitled task)",
      });
      contextEl.createDiv({
        cls: "bob-tll-context-source",
        text: single ? single.path : "Current note",
      });
    } else {
      contextEl.createDiv({
        cls: "bob-tll-context-task",
        text: `${tasks.length} tasks`,
      });
      for (const task of tasks.slice(0, 3)) {
        contextEl.createDiv({
          cls: "bob-tll-context-source",
          text: task.displayText,
        });
      }
      if (tasks.length > 3) {
        contextEl.createDiv({
          cls: "bob-tll-context-source",
          text: `+${tasks.length - 3} more`,
        });
      }
      contextEl.createDiv({
        cls: "bob-tll-context-source",
        text: "The same entry is logged on each task.",
      });
    }

    const fieldEl = contentEl.createDiv({ cls: "bob-tll-field" });
    fieldEl.createEl("label", {
      cls: "bob-tll-label",
      attr: { for: "bob-tll-summary" },
      text: "Work summary (optional)",
    });
    this.inputEl = fieldEl.createEl("input", {
      cls: "bob-tll-input",
      attr: {
        id: "bob-tll-summary",
        "aria-describedby": "bob-tll-preview bob-tll-warning",
        placeholder: "What did you get done?",
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => this.updatePreview());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.submit();
    });

    this.previewEl = contentEl.createDiv({
      cls: "bob-tll-preview",
      attr: { id: "bob-tll-preview", role: "note", "aria-live": "polite" },
    });
    this.warningEl = contentEl.createDiv({
      cls: "bob-tll-warning",
      attr: { id: "bob-tll-warning", role: "status" },
      text: "Contains ::, which Dataview may read as an inline field.",
    });

    const row = contentEl.createDiv({ cls: "bob-tll-actions" });
    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    this.primaryButton = row.createEl("button", { text: "Move to Next" });
    this.primaryButton.addEventListener("click", () => this.submit());

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
    const state = taskLinkLanePromptState(
      this.inputEl ? this.inputEl.value : "",
      { date: this.taskLinkLaneDateText() },
    );
    if (
      this.primaryButton &&
      typeof this.primaryButton.setText === "function"
    ) {
      this.primaryButton.setText(state.primaryButtonText);
    }
    this.previewEl.empty();
    if (state.isBlank) {
      this.previewEl.setAttribute(
        "aria-label",
        "No work-log entry will be added.",
      );
      this.previewEl.createDiv({
        cls: "bob-tll-preview-muted",
        text: "No work-log entry will be added.",
      });
    } else {
      this.previewEl.setAttribute("aria-label", state.formattedEntry);
      this.previewEl.createDiv({
        cls: "bob-tll-preview-marker",
        text: `${WORK_LOG_EMOJI} **${WORK_LOG_LABEL}**`,
      });
      this.previewEl.createDiv({
        cls: "bob-tll-preview-entry",
        text: state.formattedEntry,
      });
    }
    if (this.warningEl) {
      const hidden = !state.hasDataviewWarning;
      if (typeof this.warningEl.toggleClass === "function") {
        this.warningEl.toggleClass("is-hidden", hidden);
      } else if (this.warningEl.classList) {
        this.warningEl.classList.toggle("is-hidden", hidden);
      }
    }
  }

  submit() {
    const value = this.inputEl ? this.inputEl.value : "";
    this.completed = true;
    try {
      if (typeof this.onDone === "function") {
        this.onDone({ summary: String(value || "") });
      }
    } finally {
      this.onDone = null;
      this.close();
    }
  }

  onClose() {
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
