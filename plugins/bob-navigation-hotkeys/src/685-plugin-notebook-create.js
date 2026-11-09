// Create notebook here: the modal and the command (plan
// 202611/bob_notebooks.md, phase plugins-notebook-gestures). The pure model
// is 684-notebook-create-model.js; the write goes through the Bob Ledger
// Tools `api.notebooks.create` namespace, which runs `bob notebooks create`.
const NOTEBOOK_CREATE_OPEN_ATTEMPTS = 25;
const NOTEBOOK_CREATE_OPEN_DELAY_MS = 100;

class NotebookCreateModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.parentFile = options.parentFile || null;
    this.parentPath = String(options.parentPath || (this.parentFile && this.parentFile.path) || "");
    this.parentStem = String(options.parentStem || (this.parentFile && this.parentFile.basename) || "");
    this.basenames = Array.isArray(options.basenames) ? options.basenames : [];
    this.summaryInput = null;
    this.idInput = null;
    this.titleInput = null;
    this.statusEl = null;
    this.previewEl = null;
    this.createButton = null;
    this.idTouched = false;
    this.busy = false;
    this.closed = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.modalEl && typeof this.modalEl.addClass === "function") {
      this.modalEl.addClass("bob-nbc-modal");
    }
    contentEl.createDiv({ cls: "bob-nbc-title", text: "Create notebook here" });
    contentEl.createDiv({
      cls: "bob-nbc-subtitle",
      text: `A new notebook under ${this.parentStem}`,
    });
    this.summaryInput = this.addField(contentEl, "Summary", {
      placeholder: "One line on what belongs in this notebook",
      required: true,
    });
    this.idInput = this.addField(contentEl, "ID", {
      placeholder: "Used in the file name",
    });
    this.titleInput = this.addField(contentEl, "Title (optional)", {
      placeholder: "Defaults to the ID, title-cased",
    });
    this.previewEl = contentEl.createDiv({
      cls: "bob-nbc-preview",
      attr: { "aria-live": "polite" },
    });
    this.statusEl = contentEl.createDiv({
      cls: "bob-nbc-status",
      attr: { "aria-live": "polite" },
    });
    const row = contentEl.createDiv({ cls: "bob-nbc-actions" });
    const cancelButton = row.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
    this.createButton = row.createEl("button", {
      text: "Create",
      cls: "mod-cta",
    });
    this.createButton.addEventListener("click", () => void this.submit());

    this.summaryInput.addEventListener("input", () => {
      if (!this.idTouched) {
        this.idInput.value = notebookCreateSuggestId(
          this.summaryInput.value,
          this.parentStem,
          this.basenames,
        );
      }
      this.refresh();
    });
    this.idInput.addEventListener("input", () => {
      this.idTouched = true;
      this.refresh();
    });
    this.titleInput.addEventListener("input", () => this.refresh());
    for (const input of [this.summaryInput, this.idInput, this.titleInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          void this.submit();
        }
      });
    }
    this.refresh();
    window.setTimeout(() => {
      if (!this.closed && this.summaryInput) {
        this.summaryInput.focus();
      }
    }, 0);
  }

  onClose() {
    this.closed = true;
    if (this.plugin && this.plugin.activeNotebookCreateModal === this) {
      this.plugin.activeNotebookCreateModal = null;
    }
    this.contentEl.empty();
  }

  addField(parentEl, label, options = {}) {
    const wrapper = parentEl.createDiv({ cls: "bob-nbc-field" });
    wrapper.createEl("label", { cls: "bob-nbc-label", text: label });
    return wrapper.createEl("input", {
      cls: "bob-nbc-input",
      attr: {
        type: "text",
        placeholder: options.placeholder || "",
        ...(options.required ? { "aria-required": "true" } : {}),
      },
    });
  }

  currentFields() {
    return {
      summary: this.summaryInput ? this.summaryInput.value : "",
      id: this.idInput ? this.idInput.value : "",
      title: this.titleInput ? this.titleInput.value : "",
    };
  }

  validation() {
    return notebookCreateValidate(this.currentFields(), {
      parentStem: this.parentStem,
      basenames: this.basenames,
    });
  }

  refresh() {
    const result = this.validation();
    if (this.previewEl) {
      this.previewEl.empty();
      if (result.id && NOTEBOOK_CREATE_ID_RE.test(result.id)) {
        this.previewEl.setText(
          `Creates ${notebookCreateFileStem(this.parentStem, result.id)}.md`,
        );
      }
    }
    if (this.statusEl) {
      this.statusEl.empty();
      // Stay quiet until the user has typed something: a fresh modal with no
      // summary is not yet an error.
      const typed = this.summaryInput && this.summaryInput.value !== "";
      const message = typed
        ? result.errors.id || result.errors.summary || result.warning
        : "";
      this.statusEl.setText(message || "");
      this.statusEl.classList.toggle("is-error", Boolean(typed && !result.ok));
    }
    if (this.createButton) {
      this.createButton.disabled = this.busy || !result.ok;
    }
    return result;
  }

  async submit() {
    if (this.busy) {
      return false;
    }
    const result = this.refresh();
    if (!result.ok) {
      const message = result.errors.summary || result.errors.id;
      if (this.statusEl && message) {
        this.statusEl.setText(message);
        this.statusEl.classList.add("is-error");
      }
      return false;
    }
    this.busy = true;
    this.refresh();
    let outcome = null;
    try {
      outcome = await this.plugin.commitNotebookCreate({
        parent: this.parentPath,
        id: result.id,
        summary: result.summary,
        title: result.title,
      });
    } finally {
      this.busy = false;
    }
    if (outcome && outcome.ok) {
      this.close();
      return true;
    }
    if (!this.closed) {
      this.refresh();
      if (this.idInput && typeof this.idInput.focus === "function") {
        this.idInput.focus();
      }
    }
    return false;
  }
}

class BobNavigationHotkeysNotebookCreateMixin {
  registerNotebookCreateCommand() {
    this.addCommand({
      id: "create-notebook-here",
      name: "Create notebook here",
      callback: () => this.openNotebookCreate(),
    });
  }

  notebookLedgerApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const api = holder && holder.api && holder.api.notebooks;
      return api && typeof api.create === "function" ? api : null;
    } catch (_error) {
      return null;
    }
  }

  // Every vault note's basename: the ID suggestion and the exists check read
  // it, and bob's own collision check stays authoritative at write time.
  collectNotebookCreateBasenames() {
    const vault = this.app && this.app.vault;
    const files =
      vault && typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles() || []
        : [];
    return files.map((file) => file.basename).filter(Boolean);
  }

  openNotebookCreate() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return false;
    }
    const cache =
      this.app.metadataCache &&
      typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
    const refusal = notebookCreateHostRefusal(
      parentRuleKindOf(cache && cache.frontmatter),
      file.basename,
    );
    if (refusal) {
      new Notice(refusal);
      return false;
    }
    const active = this.activeNotebookCreateModal;
    if (active && active.isOpen !== false && !active.closed) {
      if (active.summaryInput && typeof active.summaryInput.focus === "function") {
        active.summaryInput.focus();
      }
      return true;
    }
    const modal = new NotebookCreateModal(this.app, this, {
      parentFile: file,
      parentPath: file.path,
      parentStem: file.basename,
      basenames: this.collectNotebookCreateBasenames(),
    });
    this.activeNotebookCreateModal = modal;
    modal.open();
    return true;
  }

  // Run the create and open the new note. Resolves bob's result; a refusal
  // is shown as one notice and the modal stays open to fix it.
  async commitNotebookCreate(request) {
    const api = this.notebookLedgerApi();
    if (!api) {
      new Notice(
        "Can't create notebook: Bob Ledger Tools is not running — enable it and reload",
      );
      return { ok: false, code: "no-ledger-tools" };
    }
    let result;
    try {
      result = await api.create(request);
    } catch (_error) {
      result = { ok: false, code: "failed", message: "bob notebooks create failed" };
    }
    if (!result || !result.ok) {
      new Notice(notebookCreateFailureNotice(result));
      return result || { ok: false, code: "failed" };
    }
    new Notice(notebookCreateSuccessNotice(result.report));
    await this.openCreatedNotebook(String(result.report.notebook.path || ""));
    return result;
  }

  // The new file lands through bob, so Obsidian's vault watcher may not have
  // indexed it yet: poll briefly before opening it.
  async openCreatedNotebook(path) {
    const vault = this.app && this.app.vault;
    if (!path || !vault || typeof vault.getAbstractFileByPath !== "function") {
      return false;
    }
    let file = null;
    for (let attempt = 0; attempt < NOTEBOOK_CREATE_OPEN_ATTEMPTS; attempt += 1) {
      file = vault.getAbstractFileByPath(path);
      if (file) {
        break;
      }
      await new Promise((resolve) =>
        window.setTimeout(resolve, NOTEBOOK_CREATE_OPEN_DELAY_MS),
      );
    }
    if (!file || !this.isMarkdownFile(file)) {
      new Notice(`Created ${path} — open it once Obsidian has indexed it`);
      return false;
    }
    try {
      const leaf = this.app.workspace.getLeaf(false);
      return await openWithLeafSwitchGuard(this, file, leaf, () => leaf.openFile(file));
    } catch (_error) {
      new Notice(`Created ${path} — could not open it`);
      return false;
    }
  }
}
