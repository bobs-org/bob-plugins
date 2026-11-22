// nav's proseField namespace, or null: without it the field types plainly.
function mailProseFieldApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const nav = plugins && plugins["bob-navigation-hotkeys"];
    const api = nav && nav.api && nav.api.proseField;
    return api && Number(api.version) >= 1 && typeof api.attach === "function" ? api : null;
  } catch (error) {
    return null;
  }
}

// Ctrl alone + [ (never Alt, Meta, or Shift): Esc's alias.
function mailIsCtrlLeftBracket(event) {
  return Boolean(event) &&
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    event.shiftKey !== true &&
    (event.code === "BracketLeft" || event.key === "[");
}

class BobMailTaskModal extends Modal {
  constructor(app, plugin, context, initialText, link) {
    super(app);
    this.plugin = plugin;
    this.context = context;
    this.initialText = initialText;
    this.link = link;
    this.input = null;
    this.prose = null;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Task from this email" });
    content.createEl("p", { text: "Capture a task with a link back to the email." });
    // bob-text: prose S13
    this.input = content.createEl("input", { type: "text", value: this.initialText });
    this.input.value = this.initialText;
    this.input.setAttribute("aria-label", "Task text");
    this.attachLinks(content);
    // Ctrl+[ mirrors Esc (close); the LINK band consumes it first while open.
    content.addEventListener("keydown", (event) => {
      if (!mailIsCtrlLeftBracket(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
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

  // The task text is prose (S13): `[[` and `((` share nav's LINK band.
  // bob capture routes the task, so there is no home note for `[[#…`.
  attachLinks(content) {
    try {
      const api = mailProseFieldApi(this.app);
      if (!api || !this.input) return;
      const bandHost = content.createEl("div", { cls: "bob-mail-link-host" });
      this.prose = api.attach({
        inputEl: this.input,
        bandHost,
        recall: null,
        sourcePath: null,
        density: "roomy",
        links: true,
        tasks: true,
        arrowKeys: true,
        ownKeys: true,
        scope: this.scope,
      });
    } catch (error) {
      this.prose = null;
    }
  }

  onClose() {
    try {
      if (this.prose && typeof this.prose.detach === "function") this.prose.detach();
    } catch (error) {
      // Closing never depends on band cleanup.
    }
    this.prose = null;
    this.contentEl.empty();
  }
}
