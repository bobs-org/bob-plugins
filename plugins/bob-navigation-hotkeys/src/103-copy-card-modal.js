// Copy card modal: compact key-card surface for Cmd+Y copy rows.
// Modelled on FreshnessDecayCardModal (060) for structure and document
// handling, and on DeleteFileConfirmModal (672) for the catch-all scope.
// Obsidian-free except for Modal/Notice globals so Node tests can load it
// through the navigation-hotkeys harness. It owns only highlight, busy, and
// failure UI state; the model is frozen and never recomputed.

function ensureCopyCardScope(modal) {
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

function copyCardRowDomId(rowId) {
  return `bob-copy-card-row-${String(rowId || "row")}`;
}

function copyCardRowAriaLabel(row) {
  const label = String((row && row.label) || "row");
  if (!row) {
    return label;
  }
  if (row.state === "ready" || row.state === "collision") {
    return row.value ? `${label}: ${row.value}` : label;
  }
  return row.reason ? `${label} unavailable: ${row.reason}` : `${label} unavailable`;
}

class CopyCardModal extends Modal {
  constructor(app, options) {
    super(app);
    const settings = options && typeof options === "object" ? options : {};
    this.copyCardModel =
      settings.model && typeof settings.model === "object" ? settings.model : null;
    this.onCopy = typeof settings.onCopy === "function" ? settings.onCopy : null;
    this.onSuccess =
      typeof settings.onSuccess === "function" ? settings.onSuccess : null;
    this.highlightId =
      this.copyCardModel && typeof this.copyCardModel.defaultRowId === "string"
        ? this.copyCardModel.defaultRowId
        : null;
    this.busy = false;
    this.settled = false;
    this.failure = null;
    this.scopeHandler = null;
    this.rowEls = new Map();
    this.rowsEl = null;
    this.footerEl = null;
    this.footerCopyLabelEl = null;
    this.statusEl = null;
    this.liveEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    if (contentEl && typeof contentEl.empty === "function") {
      contentEl.empty();
    }
    try {
      moveFreshnessDecayModalToAppDocument(this, this.app);
    } catch (_error) {
      // Best effort: the card still renders in the current document.
    }
    if (this.modalEl && typeof this.modalEl.addClass === "function") {
      this.modalEl.addClass("bob-copy-card-modal");
    }
    if (this.modalEl && typeof this.modalEl.setAttribute === "function") {
      this.modalEl.setAttribute("role", "dialog");
      this.modalEl.setAttribute("aria-modal", "true");
      this.modalEl.setAttribute("aria-label", "Copy");
    }
    if (contentEl && typeof contentEl.addClass === "function") {
      contentEl.addClass("bob-copy-card");
      contentEl.addClass("bob-key-card");
    }

    const header = contentEl.createDiv({ cls: "bob-copy-card-header" });
    const icon = header.createDiv({ cls: "bob-copy-card-icon" });
    applyIcon(icon, "copy");
    const headerText = header.createDiv({ cls: "bob-copy-card-header-text" });
    headerText.createDiv({
      cls: "bob-copy-card-title bob-key-card-title",
      text: "Copy",
    });
    headerText.createDiv({
      cls: "bob-copy-card-subtitle",
      text: String((this.copyCardModel && this.copyCardModel.subtitle) || ""),
    });

    this.rowsEl = contentEl.createDiv({ cls: "bob-copy-card-rows" });
    if (this.rowsEl && typeof this.rowsEl.setAttribute === "function") {
      this.rowsEl.setAttribute("role", "listbox");
      this.rowsEl.setAttribute("aria-label", "Copy options");
    }

    this.statusEl = contentEl.createDiv({ cls: "bob-copy-card-status" });
    if (typeof this.statusEl.setAttribute === "function") {
      this.statusEl.setAttribute("role", "status");
    }

    this.footerEl = contentEl.createDiv({ cls: "bob-copy-card-footer" });

    this.liveEl = contentEl.createDiv({ cls: "bob-copy-card-live" });
    if (typeof this.liveEl.setAttribute === "function") {
      this.liveEl.setAttribute("aria-live", "polite");
      this.liveEl.setAttribute("role", "status");
    }

    this.renderRows();
    this.renderFooter();

    const scope = ensureCopyCardScope(this);
    this.scopeHandler = scope.register(null, null, (event) => {
      this.handleCopyCardKey(event);
      return false;
    });
  }

  highlightedRow() {
    const model = this.copyCardModel;
    const rows = (model && Array.isArray(model.rows) ? model.rows : []).filter(Boolean);
    return (
      rows.find((row) => row.id === this.highlightId) ||
      rows.find((row) => row.id === (model && model.defaultRowId)) ||
      null
    );
  }

  renderRows() {
    if (!this.rowsEl) {
      return;
    }
    if (typeof this.rowsEl.empty === "function") {
      this.rowsEl.empty();
    }
    this.rowEls = new Map();
    const model = this.copyCardModel;
    const rows = (model && Array.isArray(model.rows) ? model.rows : []).filter(Boolean);
    let dividerRendered = false;
    for (const row of rows) {
      if (
        !dividerRendered &&
        row.group === "task" &&
        model &&
        model.task &&
        model.task.state !== "none"
      ) {
        const divider = this.rowsEl.createDiv({ cls: "bob-copy-card-divider" });
        divider.createDiv({ cls: "bob-copy-card-divider-rule" });
        divider.createDiv({ cls: "bob-copy-card-divider-label", text: "TASK" });
        divider.createDiv({
          cls: "bob-copy-card-divider-title",
          text: String(model.task.title || ""),
        });
        divider.createDiv({ cls: "bob-copy-card-divider-rule" });
        dividerRendered = true;
      }
      const selected = row.id === this.highlightId;
      const classes = ["bob-copy-card-row", "bob-key-card-row"];
      if (selected) {
        classes.push("is-selected");
      }
      if (row.state === "unavailable") {
        classes.push("is-unavailable");
      }
      if (row.state === "error") {
        classes.push("is-error");
      }
      if (row.state === "collision") {
        classes.push("is-collision");
      }
      const rowEl = this.rowsEl.createDiv({ cls: classes.join(" ") });
      rowEl.setAttribute("role", "option");
      rowEl.setAttribute("id", copyCardRowDomId(row.id));
      rowEl.setAttribute("aria-selected", selected ? "true" : "false");
      if (row.key) {
        rowEl.setAttribute("aria-keyshortcuts", String(row.key));
      }
      if (row.state === "unavailable" || row.state === "error") {
        rowEl.setAttribute("aria-disabled", "true");
      }
      rowEl.setAttribute("aria-label", copyCardRowAriaLabel(row));

      const keyCls = row.key
        ? "bob-key-card-key bob-copy-card-key"
        : "bob-key-card-key bob-copy-card-key is-alias";
      rowEl.createDiv({ cls: keyCls, text: row.key ? String(row.key).toUpperCase() : "" });

      rowEl.createDiv({ cls: "bob-copy-card-label", text: String(row.label || "") });

      const valueEl = rowEl.createDiv({ cls: "bob-copy-card-value" });
      if (typeof row.value === "string" && row.value) {
        valueEl.setAttribute("title", row.value);
      } else if (typeof row.preview === "string" && row.preview) {
        valueEl.setAttribute("title", String(row.preview));
      }
      if (row.isPath && row.previewParts && typeof row.value === "string" && row.value) {
        const pathEl = valueEl.createDiv({ cls: "bob-copy-card-path" });
        pathEl.createDiv({
          cls: "bob-copy-card-path-head",
          text: String(row.previewParts.head || ""),
        });
        pathEl.createDiv({
          cls: "bob-copy-card-path-tail",
          text: String(row.previewParts.tail || ""),
        });
      } else if (row.state === "collision") {
        valueEl.createDiv({
          cls: "bob-copy-card-template",
          text: String(row.preview || ""),
        });
        rowEl.createDiv({
          cls: "bob-copy-card-reason",
          text: String(row.reason || ""),
        });
      } else if (row.state === "ready") {
        valueEl.createDiv({
          cls: "bob-copy-card-template",
          text: String(row.preview || ""),
        });
      } else {
        valueEl.createDiv({
          cls: "bob-copy-card-reason-text",
          text: String(row.preview || row.reason || ""),
        });
      }

      const enterEl = rowEl.createDiv({
        cls: "bob-copy-card-enter",
        text: selected ? "↵" : "",
      });
      enterEl.setAttribute("aria-hidden", "true");

      const captured = row;
      rowEl.addEventListener("click", () => {
        void this.clickCopyCardRow(captured);
      });
      this.rowEls.set(row.id, rowEl);
    }
    if (typeof this.rowsEl.setAttribute === "function") {
      const active = this.highlightedRow();
      if (active) {
        this.rowsEl.setAttribute("aria-activedescendant", copyCardRowDomId(active.id));
      } else {
        this.rowsEl.removeAttribute("aria-activedescendant");
      }
    }
  }

  renderFooter() {
    if (!this.footerEl) {
      return;
    }
    if (typeof this.footerEl.empty === "function") {
      this.footerEl.empty();
    }
    const active = this.highlightedRow();
    const label = active ? String(active.label || "row").toLowerCase() : "row";
    const chips = [
      { keys: ["↵"], label: `copy ${label}` },
      { keys: ["↑↓"], label: "select" },
      { keys: ["esc"], label: "close" },
    ];
    for (const chip of chips) {
      const group = this.footerEl.createDiv({ cls: "bob-cnp-hint" });
      for (const key of chip.keys) {
        group.createEl("kbd", { cls: "bob-cnp-kbd", text: key });
      }
      const labelEl = group.createEl("span", {
        cls: "bob-cnp-hint-label",
        text: chip.label,
      });
      if (chip.keys[0] === "↵") {
        this.footerCopyLabelEl = labelEl;
      }
    }
    this.renderStatus();
  }

  renderStatus() {
    if (!this.statusEl) {
      return;
    }
    if (typeof this.statusEl.empty === "function") {
      this.statusEl.empty();
    }
    if (this.failure) {
      this.statusEl.createDiv({
        cls: "bob-copy-card-failure",
        text: String(this.failure),
      });
    }
  }

  setHighlight(rowId) {
    this.highlightId = rowId;
    this.failure = null;
    this.renderRows();
    this.renderFooter();
  }

  announce(reason) {
    if (this.liveEl) {
      this.liveEl.textContent = String(reason || "");
    }
  }

  nudgeRow(rowId) {
    const rowEl = this.rowEls ? this.rowEls.get(rowId) : null;
    if (!rowEl || typeof rowEl.addClass !== "function") {
      return;
    }
    rowEl.addClass("is-nudge");
    const clear = () => {
      try {
        if (typeof rowEl.removeClass === "function") {
          rowEl.removeClass("is-nudge");
        } else if (rowEl.classList && typeof rowEl.classList.remove === "function") {
          rowEl.classList.remove("is-nudge");
        }
      } catch (_error) {
        // Best effort.
      }
    };
    try {
      const host =
        (this.containerEl && this.containerEl.ownerDocument && this.containerEl.ownerDocument.defaultView) ||
        (typeof window !== "undefined" ? window : null);
      if (host && typeof host.setTimeout === "function") {
        host.setTimeout(clear, 320);
      } else if (typeof setTimeout === "function") {
        setTimeout(clear, 320);
      }
    } catch (_error) {
      // Best effort.
    }
  }

  handleCopyCardKey(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    if (!this.copyCardModel || this.settled) {
      return false;
    }
    const action = resolveCopyCardKey(this.copyCardModel, event, {
      highlightId: this.highlightId,
      busy: this.busy,
    });
    if (!action || typeof action !== "object") {
      return false;
    }
    if (action.type === "close") {
      this.settled = true;
      this.close();
      return false;
    }
    if (action.type === "move") {
      this.setHighlight(action.rowId);
      return false;
    }
    if (action.type === "refuse") {
      this.setHighlight(action.rowId);
      this.announce(action.reason);
      this.nudgeRow(action.rowId);
      return false;
    }
    if (action.type === "copy") {
      const rows = Array.isArray(this.copyCardModel.rows) ? this.copyCardModel.rows : [];
      const row = rows.find((entry) => entry && entry.id === action.rowId) || null;
      if (!row) {
        return false;
      }
      void this.performCopyCardRow(row);
      return false;
    }
    return false;
  }

  async clickCopyCardRow(row) {
    if (!row || this.settled) {
      return;
    }
    if (row.state === "unavailable") {
      this.setHighlight(row.id);
      this.announce(row.reason);
      this.nudgeRow(row.id);
      return;
    }
    if (row.state === "error") {
      return;
    }
    await this.performCopyCardRow(row);
  }

  async performCopyCardRow(row) {
    if (!row || this.busy || this.settled) {
      return;
    }
    this.busy = true;
    let result = null;
    try {
      result = this.onCopy ? await this.onCopy(row) : { ok: false, reason: "copy unavailable" };
    } catch (error) {
      result = { ok: false, reason: error && error.message ? error.message : String(error) };
    }
    this.busy = false;
    if (result && result.ok === true) {
      this.settled = true;
      const success = this.onSuccess;
      this.onSuccess = null;
      this.close();
      try {
        if (typeof success === "function") {
          await success(row);
        }
      } catch (_error) {
        // Best effort: the copy already landed.
      }
      return;
    }
    const reason =
      (result && (result.reason || result.message)) || "copy failed";
    this.failure = `Couldn't copy: ${reason}`;
    this.renderStatus();
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
    this.busy = false;
    contentElCleanup(this.contentEl);
  }
}
