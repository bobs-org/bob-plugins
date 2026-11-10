function deleteGuardFileBasename(file, path) {
  if (file && typeof file.basename === "string" && file.basename) {
    return file.basename;
  }
  const leaf = String(path || "").replace(/\\/g, "/").split("/").pop() || "";
  const trimmed = leaf.replace(/\.[^.]+$/, "");
  return trimmed || leaf || "file";
}

function ensureDeleteConfirmScope(modal) {
  if (modal.scope && typeof modal.scope.register === "function") {
    return modal.scope;
  }
  modal.scope = {
    register(_modifiers, _key, fn) {
      return { fn };
    },
    unregister() {},
  };
  return modal.scope;
}

class DeleteFileConfirmModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    const settings = options && typeof options === "object" ? options : {};
    this.file = settings.file || null;
    this.filePath = String(
      settings.path || (this.file && this.file.path) || "",
    );
    this.plan =
      settings.plan && typeof settings.plan === "object"
        ? settings.plan
        : { confirm: true, reasons: [], facts: { text: "" } };
    this.onConfirm =
      typeof settings.onConfirm === "function" ? settings.onConfirm : null;
    this.onCancel =
      typeof settings.onCancel === "function" ? settings.onCancel : null;
    this.onClosed =
      typeof settings.onClosed === "function" ? settings.onClosed : null;
    this.settled = false;
    this.scopeHandler = null;
    this.keepButtonEl = null;
    this.trashButtonEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    if (contentEl && typeof contentEl.empty === "function") {
      contentEl.empty();
    }
    if (this.modalEl && typeof this.modalEl.addClass === "function") {
      this.modalEl.addClass("bob-delete-confirm-modal");
    }
    if (contentEl && typeof contentEl.addClass === "function") {
      contentEl.addClass("bob-delete-confirm");
    }
    if (this.modalEl && typeof this.modalEl.setAttribute === "function") {
      this.modalEl.setAttribute("role", "dialog");
      this.modalEl.setAttribute("aria-modal", "true");
      this.modalEl.setAttribute(
        "aria-label",
        `Delete ${deleteGuardFileBasename(this.file, this.filePath)}?`,
      );
    }

    const header = contentEl.createDiv({ cls: "bob-delete-confirm-header" });
    const icon = header.createDiv({ cls: "bob-delete-confirm-header-icon" });
    applyIcon(icon, "trash-2");

    const headerText = header.createDiv({
      cls: "bob-delete-confirm-header-text",
    });
    headerText.createDiv({
      cls: "bob-delete-confirm-title",
      text: `Delete ${deleteGuardFileBasename(this.file, this.filePath)}?`,
    });
    headerText.createDiv({
      cls: "bob-delete-confirm-subtitle",
      text: this.filePath,
    });

    const reasons = Array.isArray(this.plan.reasons) ? this.plan.reasons : [];
    if (reasons.length > 0) {
      const list = contentEl.createEl("ul", {
        cls: "bob-delete-confirm-reasons",
      });
      for (const reason of reasons) {
        list.createEl("li", {
          cls: "bob-delete-confirm-reason",
          text: String(reason),
        });
      }
    }

    const factsText =
      this.plan.facts && this.plan.facts.text ? this.plan.facts.text : "";
    if (factsText) {
      contentEl.createDiv({
        cls: "bob-delete-confirm-facts",
        text: factsText,
      });
    }

    contentEl.createDiv({
      cls: "bob-delete-confirm-hint",
      text: "Press y to move it to trash · any other key keeps it",
    });

    const actions = contentEl.createDiv({
      cls: "bob-delete-confirm-actions",
    });
    this.keepButtonEl = actions.createEl("button", {
      text: "Keep",
      attr: { type: "button" },
    });
    this.keepButtonEl.addEventListener("click", () => this.cancelDelete());
    this.trashButtonEl = actions.createEl("button", {
      cls: "mod-warning",
      text: "Move to trash",
      attr: { type: "button" },
    });
    this.trashButtonEl.addEventListener("click", () => this.confirmDelete());

    const scope = ensureDeleteConfirmScope(this);
    this.scopeHandler = scope.register(null, null, (evt) => {
      this.handleDeleteConfirmKey(evt);
      return false;
    });
  }

  handleDeleteConfirmKey(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    const action = classifyDeleteConfirmKey(event);
    if (action === "confirm") {
      this.confirmDelete();
    } else if (action === "cancel") {
      this.cancelDelete();
    }
    return false;
  }

  confirmDelete() {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.close();
    if (typeof this.onConfirm === "function") {
      this.onConfirm();
    }
  }

  cancelDelete() {
    if (this.settled) {
      return;
    }
    this.settled = true;
    if (typeof this.onCancel === "function") {
      this.onCancel();
    }
    this.close();
  }

  onClose() {
    try {
      if (
        this.scopeHandler &&
        this.scope &&
        typeof this.scope.unregister === "function"
      ) {
        this.scope.unregister(this.scopeHandler);
      }
    } catch (_error) {
      // Best effort.
    }
    this.scopeHandler = null;
    if (!this.settled) {
      this.settled = true;
      if (typeof this.onCancel === "function") {
        this.onCancel();
      }
    }
    if (typeof this.onClosed === "function") {
      this.onClosed();
    }
  }
}
