class BobMailTaskModal extends Modal {
  constructor(app, plugin, context, initialText, link) {
    super(app);
    this.plugin = plugin;
    this.context = context;
    this.initialText = initialText;
    this.link = link;
    this.input = null;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Task from this email" });
    content.createEl("p", { text: "Capture a task with a link back to the email." });
    this.input = content.createEl("input", { type: "text", value: this.initialText });
    this.input.value = this.initialText;
    this.input.setAttribute("aria-label", "Task text");
    const buttons = content.createEl("div", { cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const capture = buttons.createEl("button", { text: "Capture task", cls: "mod-cta" });
    capture.addEventListener("click", async () => {
      const text = String(this.input && this.input.value || "").trim();
      if (!text) return;
      capture.disabled = true;
      const result = await this.plugin.mailCaptureTask(text, this.link);
      if (result) this.close();
      else capture.disabled = false;
    });
    this.input.focus();
    this.input.select();
  }

  onClose() {
    this.contentEl.empty();
  }
}
