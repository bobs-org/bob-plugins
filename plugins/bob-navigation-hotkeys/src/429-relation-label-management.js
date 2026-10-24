function getNavigationRelationLabelsApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-ledger-tools"];
    const api = holder && holder.api && holder.api.relationLabels;
    return api && Number(api.version) >= 1 ? api : null;
  } catch (_error) {
    return null;
  }
}

function relationLabelRenameInputError(raw) {
  const label = normalizeRelationLabel(String(raw || ""));
  if (label) return null;
  return describeRelationLabelRefusal(raw) || "Enter a valid relation label.";
}

function relationLabelRenameReport(result) {
  return result && result.report && typeof result.report === "object"
    ? result.report
    : result && typeof result === "object"
      ? result
      : null;
}

function formatRelationLabelRenamePreview(result) {
  const report = relationLabelRenameReport(result);
  if (!report) {
    return {
      title: "No rename preview",
      lines: [],
      links: 0,
      notes: 0,
      mirrors: 0,
      doneLinks: 0,
      merge: false,
    };
  }
  const files = Array.isArray(report.files) ? report.files : [];
  const counts = report.counts && typeof report.counts === "object" ? report.counts : {};
  const links = Math.max(0, Number(counts.links) || 0);
  const notes = Math.max(0, Number(counts.notes) || files.length);
  const mirrors = Math.max(0, Number(counts.mirrors) || 0);
  const doneLinks = Math.max(0, Number(counts.done_links) || 0);
  const from = report.from && report.from.name ? String(report.from.name) : "relation";
  const to = report.to && report.to.name ? String(report.to.name) : "new label";
  const lines = files.map((file) => {
    const path = String(file && file.path || "");
    const fileLinks = Math.max(0, Number(file && file.links) || 0);
    const fileMirrors = Math.max(0, Number(file && file.mirrors) || 0);
    const parts = [
      `${fileLinks} ${fileLinks === 1 ? "link" : "links"}`,
      `${fileMirrors} ${fileMirrors === 1 ? "mirror" : "mirrors"}`,
    ];
    const edits = Array.isArray(file && file.lines) ? file.lines : [];
    return `${path} · ${parts.join(" · ")}${edits.length ? ` · ${edits.length} changed ${edits.length === 1 ? "line" : "lines"}` : ""}`;
  });
  const doneNote = doneLinks > 0 ? ` · ${doneLinks} in done/` : "";
  return {
    title: `${from} → ${to} · ${links} ${links === 1 ? "link" : "links"} in ${notes} ${notes === 1 ? "note" : "notes"} · ${mirrors} ${mirrors === 1 ? "mirror" : "mirrors"}${doneNote}`,
    lines,
    links,
    notes,
    mirrors,
    doneLinks,
    merge: report.merge === true,
    stateNote: report.state && report.state.note ? String(report.state.note) : "",
    inverseNote: report.inverse && report.inverse.note ? String(report.inverse.note) : "",
    warnings: Array.isArray(report.warnings) ? report.warnings.map(String) : [],
  };
}

function relationLabelRenamePreviewSignature(result) {
  const report = relationLabelRenameReport(result);
  if (!report) return "";
  return JSON.stringify({
    from: report.from,
    to: report.to,
    merge: report.merge === true,
    files: report.files,
    counts: report.counts,
    state: report.state,
    inverse: report.inverse,
    replacement: report.replacement,
    hide_replacement: report.hide_replacement,
  });
}

function relationLabelRenameFilePaths(result) {
  const report = relationLabelRenameReport(result);
  return [...new Set((Array.isArray(report && report.files) ? report.files : [])
    .map((file) => String(file && file.path || "").trim())
    .filter(Boolean))];
}

async function saveActiveRelationLabelEditor(app) {
  try {
    const workspace = app && app.workspace;
    if (!workspace) return { ok: true };
    let view = null;
    if (typeof workspace.getActiveViewOfType === "function") {
      try {
        view = workspace.getActiveViewOfType(MarkdownView);
      } catch (_error) {
        view = null;
      }
    }
    if (!view && workspace.activeLeaf) view = workspace.activeLeaf.view || null;
    if (!view || !view.file || !view.editor) return { ok: true };
    if (typeof view.save !== "function") {
      return { ok: false, message: "Could not save the active note before previewing the rename." };
    }
    await view.save();
    return { ok: true };
  } catch (_error) {
    return { ok: false, message: "Could not save the active note before previewing the rename." };
  }
}

async function relationLabelDirtyEditorPaths(app, result) {
  const touched = new Set(relationLabelRenameFilePaths(result));
  if (!touched.size) return [];
  const workspace = app && app.workspace;
  const vault = app && app.vault;
  if (!workspace || !vault) return [];
  const leaves = [];
  try {
    if (typeof workspace.iterateAllLeaves === "function") {
      workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
    } else if (typeof workspace.getLeavesOfType === "function") {
      for (const type of ["markdown", "editor"]) {
        try {
          for (const leaf of workspace.getLeavesOfType(type) || []) leaves.push(leaf);
        } catch (_error) {
          // Other leaf types are not Markdown editors.
        }
      }
    }
  } catch (_error) {
    return [...touched];
  }
  const dirty = new Set();
  for (const leaf of leaves) {
    const view = leaf && leaf.view;
    const file = view && view.file;
    const editor = view && view.editor;
    if (!file || !touched.has(String(file.path || "")) || !editor || typeof editor.getValue !== "function") continue;
    try {
      const disk = typeof vault.read === "function"
        ? await vault.read(file)
        : vault.adapter && typeof vault.adapter.read === "function"
          ? await vault.adapter.read(file.path)
          : null;
      if (typeof disk !== "string" || String(editor.getValue()) !== disk) dirty.add(file.path);
    } catch (_error) {
      // If an affected buffer cannot be compared with disk, refuse the write.
      dirty.add(file.path);
    }
  }
  return [...dirty].sort();
}

class RelationLabelRenameModal extends Modal {
  constructor(app, from, options = {}) {
    super(app);
    this.from = String(from || "");
    this.afterRename = typeof options.afterRename === "function" ? options.afterRename : null;
    this.renamePreview = null;
    this.previewSignature = "";
    this.renameError = "";
    this.renameApplying = false;
  }

  onOpen() {
    this.contentEl.empty();
    this.modalEl.addClass("bob-cnp-modal");
    this.contentEl.addClass("bob-cnp");
    const header = this.contentEl.createDiv({ cls: "bob-cnp-header" });
    const icon = header.createDiv({ cls: "bob-cnp-header-icon" });
    applyIcon(icon, "pencil");
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    headerText.createDiv({ cls: "bob-cnp-title", text: `Rename ${this.from || "relation"}` });
    headerText.createDiv({ cls: "bob-cnp-subtitle", text: "Previewed rename across every LINKS and LINKED FROM label" });

    const form = this.contentEl.createDiv({ cls: "bob-cnp-rename-form" });
    form.createEl("label", { cls: "bob-cnp-rename-label", text: "New relation label" });
    this.nameInput = form.createEl("input", {
      cls: "bob-cnp-input",
      attr: { type: "text", placeholder: "prompted by", "aria-label": "New relation label" },
    });
    this.mergeToggle = form.createEl("input", {
      cls: "bob-cnp-rename-merge",
      attr: { type: "checkbox", "aria-label": "Merge into an existing relation label" },
    });
    form.createEl("label", { cls: "bob-cnp-rename-label", text: "Allow merging into an existing relation label (--merge)" });
    this.mergeConfirmWrap = form.createDiv({ cls: "bob-cnp-rename-merge-confirm" });
    this.mergeConfirmWrap.style.display = "none";
    this.mergeConfirmToggle = this.mergeConfirmWrap.createEl("input", {
      cls: "bob-cnp-rename-merge",
      attr: { type: "checkbox", "aria-label": "Confirm merging relation labels" },
    });
    this.mergeConfirmWrap.createEl("label", {
      cls: "bob-cnp-rename-label",
      text: "Confirm: combine these relation labels everywhere",
    });

    const buttons = this.contentEl.createDiv({ cls: "bob-cnp-rename-buttons" });
    this.previewButton = buttons.createEl("button", { cls: "bob-cnp-rename-button", text: "Preview" });
    this.applyButton = buttons.createEl("button", { cls: "bob-cnp-rename-button", text: "Rename everywhere" });
    this.applyButton.disabled = true;
    this.previewButton.addEventListener("click", () => void this.previewRename());
    this.applyButton.addEventListener("click", () => void this.applyRename());
    this.nameInput.addEventListener("input", () => this.invalidateRenamePreview());
    this.mergeToggle.addEventListener("change", () => this.invalidateRenamePreview());
    this.mergeConfirmToggle.addEventListener("change", () => this.renderRenamePreview());
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.previewRename();
      }
    });
    this.previewEl = this.contentEl.createDiv({ cls: "bob-cnp-results" });
    this.renderRenamePreview();
    window.setTimeout(() => {
      if (this.nameInput && typeof this.nameInput.focus === "function") this.nameInput.focus();
    }, 0);
  }

  renameTarget() {
    return normalizeRelationLabel(String((this.nameInput && this.nameInput.value) || "")) || "";
  }

  renameOptions(dryRun) {
    return {
      dryRun: dryRun === true,
      merge: Boolean(this.mergeToggle && this.mergeToggle.checked),
      via: "bob-navigation-hotkeys",
    };
  }

  invalidateRenamePreview() {
    this.renamePreview = null;
    this.previewSignature = "";
    this.renameError = "";
    if (this.mergeConfirmToggle) this.mergeConfirmToggle.checked = false;
    this.renderRenamePreview();
  }

  async freshRenamePreview() {
    const api = getNavigationRelationLabelsApi(this.app);
    if (!api || typeof api.rename !== "function") {
      return { ok: false, message: "Update Bob Ledger Tools to use relation-label renames." };
    }
    return api.rename(this.from, this.renameTarget(), this.renameOptions(true));
  }

  async refuseDirtyEditors(report) {
    const dirty = await relationLabelDirtyEditorPaths(this.app, report);
    if (!dirty.length) return false;
    const shown = dirty.slice(0, 3).join(", ");
    const more = dirty.length > 3 ? `, +${dirty.length - 3} more` : "";
    this.renameError = `Save or close affected open notes before renaming: ${shown}${more}`;
    this.renamePreview = null;
    this.previewSignature = "";
    return true;
  }

  async previewRename() {
    if (this.renameApplying) return null;
    this.renameError = relationLabelRenameInputError(this.renameTarget());
    if (this.renameError) {
      this.renamePreview = null;
      this.renderRenamePreview();
      return null;
    }
    const saved = await saveActiveRelationLabelEditor(this.app);
    if (!saved.ok) {
      this.renameError = saved.message;
      this.renamePreview = null;
      this.renderRenamePreview();
      return null;
    }
    try {
      const result = await this.freshRenamePreview();
      if (!result || result.ok !== true) {
        this.renameError = (result && result.message) || "Could not preview the relation rename.";
        if (result && result.code === "label_exists") this.renameError += " Enable merge to preview combining them.";
        this.renamePreview = null;
        this.renderRenamePreview();
        return null;
      }
      if (await this.refuseDirtyEditors(result)) {
        this.renderRenamePreview();
        return null;
      }
      this.renamePreview = relationLabelRenameReport(result);
      this.previewSignature = relationLabelRenamePreviewSignature(result);
      this.renameError = "";
      if (this.mergeConfirmToggle) this.mergeConfirmToggle.checked = false;
      this.renderRenamePreview();
      return formatRelationLabelRenamePreview(result);
    } catch (_error) {
      this.renameError = "Could not preview the relation rename.";
      this.renamePreview = null;
      this.renderRenamePreview();
      return null;
    }
  }

  renderRenamePreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();
    if (this.renameError) {
      this.previewEl.createDiv({ cls: "bob-cnp-empty-text", text: this.renameError });
    }
    if (this.renamePreview) {
      const summary = formatRelationLabelRenamePreview(this.renamePreview);
      this.previewEl.createDiv({ cls: "bob-cnp-row-title", text: summary.title });
      for (const line of summary.lines) {
        this.previewEl.createDiv({ cls: "bob-cnp-row-path", text: line });
      }
      for (const note of [summary.stateNote, summary.inverseNote, ...summary.warnings].filter(Boolean)) {
        this.previewEl.createDiv({ cls: "bob-cnp-row-path", text: note });
      }
    } else if (!this.renameError) {
      this.previewEl.createDiv({
        cls: "bob-cnp-empty-text",
        text: "Preview shows the affected notes, links, mirrors, and done/ history before anything writes.",
      });
    }
    const merge = Boolean(this.renamePreview && this.renamePreview.merge === true);
    if (this.mergeConfirmWrap) this.mergeConfirmWrap.style.display = merge ? "flex" : "none";
    if (!merge && this.mergeConfirmToggle) this.mergeConfirmToggle.checked = false;
    if (this.applyButton) {
      this.applyButton.textContent = merge ? "Merge labels everywhere" : "Rename everywhere";
      this.applyButton.disabled = Boolean(this.renameError) || !this.renamePreview || (merge && !this.mergeConfirmToggle.checked);
    }
  }

  async applyRename() {
    if (this.renameApplying || this.renameError || !this.renamePreview) return false;
    const merge = this.renamePreview.merge === true;
    if (merge && !this.mergeConfirmToggle.checked) {
      this.renameError = "Confirm the merge before writing.";
      this.renderRenamePreview();
      return false;
    }
    this.renameApplying = true;
    if (this.applyButton) this.applyButton.disabled = true;
    try {
      const saved = await saveActiveRelationLabelEditor(this.app);
      if (!saved.ok) {
        this.renameError = saved.message;
        this.renderRenamePreview();
        return false;
      }
      const fresh = await this.freshRenamePreview();
      if (!fresh || fresh.ok !== true) {
        this.renameError = (fresh && fresh.message) || "Could not refresh the relation rename preview.";
        this.renderRenamePreview();
        return false;
      }
      if (await this.refuseDirtyEditors(fresh)) {
        this.renderRenamePreview();
        return false;
      }
      const freshSignature = relationLabelRenamePreviewSignature(fresh);
      if (freshSignature !== this.previewSignature) {
        this.renamePreview = relationLabelRenameReport(fresh);
        this.previewSignature = freshSignature;
        if (this.mergeConfirmToggle) this.mergeConfirmToggle.checked = false;
        this.renameError = "The vault changed since this preview. Review the updated plan and confirm again.";
        this.renderRenamePreview();
        return false;
      }
      const api = getNavigationRelationLabelsApi(this.app);
      const result = await api.rename(this.from, this.renameTarget(), this.renameOptions(false));
      if (!result || result.ok !== true) {
        this.renameError = (result && result.message) || "Could not rename the relation label.";
        this.renderRenamePreview();
        return false;
      }
      const summary = formatRelationLabelRenamePreview(result);
      const report = relationLabelRenameReport(result);
      const syncPending = report && report.sync && report.sync.post === "failed" ? " · sync pending" : "";
      new Notice(`Renamed ${this.from} → ${this.renameTarget()} · ${summary.links} ${summary.links === 1 ? "link" : "links"} in ${summary.notes} ${summary.notes === 1 ? "note" : "notes"} · one commit${syncPending}`);
      this.close();
      if (this.afterRename) {
        try {
          await this.afterRename(this.from, this.renameTarget(), result);
        } catch (_error) {
          // The rename committed; refreshing a client view cannot roll it back.
        }
      }
      return true;
    } catch (_error) {
      this.renameError = "Could not rename the relation label.";
      this.renderRenamePreview();
      return false;
    } finally {
      this.renameApplying = false;
      if (this.applyButton) this.applyButton.disabled = Boolean(this.renameError) || !this.renamePreview || (this.renamePreview.merge === true && !this.mergeConfirmToggle.checked);
    }
  }

  onClose() {
    this.modalEl.removeClass("bob-cnp-modal");
    this.contentEl.empty();
  }
}

class RelationLabelActionModal extends FilteredPickerModal {
  constructor(app, manager, row) {
    const label = String(row && row.name || "relation");
    const hidden = row && row.hidden === true;
    super(app, {
      items: [
        { key: "rename", title: `Rename ${label}`, meta: "Preview every changed note (r)" },
        { key: "visibility", title: `${hidden ? "Unhide" : "Hide"} ${label}`, meta: "Changes suggestions only (h)" },
      ],
      title: label,
      headerIcon: "link-2",
      inputLabel: "Choose a relation-label action",
      placeholder: "type to filter · r/h jump when empty",
      resultsLabel: "Relation-label actions",
      emptyText: "No actions",
      footerHints: [
        { keys: ["r", "h"], label: "Jump to action" },
        { keys: ["↵"], label: "Run" },
        { keys: ["esc"], label: "Back" },
      ],
      filterItem: (item, query) => !query || `${item.title} ${item.meta}`.toLowerCase().includes(query),
      renderItem: (item, rowEl, query) => {
        addElementClasses(rowEl, "bob-cnp-task-value-row", "is-relation-label-action");
        const icon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(icon, item.key === "rename" ? "pencil" : "eye-off");
        const text = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        appendHighlighted(text.createDiv({ cls: "bob-cnp-row-title" }), item.title, query);
        text.createDiv({ cls: "bob-cnp-row-path", text: item.meta });
      },
      closeBeforeOpenItem: true,
      openItem: (item) => this.runAction(item),
    });
    this.manager = manager;
    this.labelRow = row;
  }

  handleKeydown(event) {
    if (this.inputEl && String(this.inputEl.value || "") !== "") {
      super.handleKeydown(event);
      return;
    }
    const key = String(event && event.key || "").toLowerCase();
    if (!event.ctrlKey && !event.metaKey && !event.altKey && ["r", "h"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      const index = this.items.findIndex((item) => item.key === (key === "r" ? "rename" : "visibility"));
      if (index >= 0) void this.openItemAtIndex(index);
      return;
    }
    super.handleKeydown(event);
  }

  runAction(item) {
    if (!item || !this.manager) return false;
    if (item.key === "rename") this.manager.openRelationLabelRename(this.labelRow);
    else if (item.key === "visibility") void this.manager.toggleRelationLabel(this.labelRow);
    return true;
  }
}

class RelationLabelManagerModal extends FilteredPickerModal {
  constructor(app, plugin) {
    super(app, {
      items: [],
      title: "Relation labels",
      headerIcon: "link-2",
      inputLabel: "Filter relation labels",
      placeholder: "type to filter labels",
      resultsLabel: "Relation labels",
      emptyText: "No relation labels match",
      footerHints: [
        { keys: ["↵"], label: "manage" },
        { keys: ["esc"], label: "dismiss" },
      ],
      getSubtitle: () => `${this.managerRows.length} labels · Hide changes suggestions only`,
      filterItem: (row, query) => !query || `${row.name} ${row.key} ${row.inverse || ""}`.toLowerCase().includes(query),
      renderItem: (row, rowEl, query) => this.renderRelationLabelRow(row, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (row) => this.openRelationLabelActions(row),
    });
    this.plugin = plugin;
    this.relationLabelsApi = getNavigationRelationLabelsApi(app);
    this.managerRows = [];
    this.writeInFlight = new Set();
    this.unsubscribeRelationLabels = null;
  }

  onOpen() {
    super.onOpen();
    if (!this.relationLabelsApi || typeof this.relationLabelsApi.rows !== "function") {
      new Notice("Update Bob Ledger Tools to use relation labels.");
      this.close();
      return;
    }
    if (typeof this.relationLabelsApi.onChange === "function") {
      this.unsubscribeRelationLabels = this.relationLabelsApi.onChange(() => {
        void this.refreshRelationLabelManagerRows();
      });
    }
    void this.refreshRelationLabelManagerRows();
  }

  async refreshRelationLabelManagerRows() {
    try {
      const rows = this.relationLabelsApi.rows("", { hidden: "include" });
      if (rows && typeof rows.then === "function") return false;
      if (!Array.isArray(rows)) return false;
      const selected = this.visibleItems && this.visibleItems[this.selectedIndex];
      const selectedKey = selected && selected.key;
      this.managerRows = rows.filter((row) => row && row.name).map((row) => ({
        ...row,
        key: String(row.key || normalizeRelationLabel(row.name).toLowerCase()),
        name: String(row.name),
        hidden: row.hidden === true,
        count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
      }));
      this.items = this.managerRows;
      const index = this.managerRows.findIndex((row) => row.key === selectedKey);
      this.selectedIndex = index >= 0 ? index : 0;
      this.renderResults();
      return true;
    } catch (_error) {
      new Notice("Could not load relation labels.");
      return false;
    }
  }

  renderRelationLabelRow(row, rowEl, query) {
    addElementClasses(rowEl, "bob-cnp-task-value-row", "is-relation-label-manager-row", row.hidden ? "is-hidden" : "");
    const icon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(icon, row.hidden ? "eye-off" : "link-2");
    const text = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    appendHighlighted(text.createDiv({ cls: "bob-cnp-row-title" }), row.name, query);
    const meta = row.hidden
      ? "hidden from suggestions"
      : `${row.count} ${row.count === 1 ? "link" : "links"}`;
    text.createDiv({ cls: "bob-cnp-row-path", text: row.inverse ? `${meta} · inverse: ${row.inverse}` : meta });
  }

  openRelationLabelActions(row) {
    if (!row) return false;
    new RelationLabelActionModal(this.app, this, row).open();
    return true;
  }

  openRelationLabelRename(row) {
    if (!row || !row.name) return false;
    new RelationLabelRenameModal(this.app, row.name, {
      afterRename: () => this.refreshRelationLabelManagerRows(),
    }).open();
    return true;
  }

  async toggleRelationLabel(row) {
    if (!row || !row.name || this.writeInFlight.has(row.key)) return false;
    const method = row.hidden ? this.relationLabelsApi.unhide : this.relationLabelsApi.hide;
    if (typeof method !== "function") {
      new Notice("Update Bob Ledger Tools to use relation-label writes.");
      return false;
    }
    this.writeInFlight.add(row.key);
    try {
      const result = await method.call(this.relationLabelsApi, row.name);
      if (!result || result.ok !== true) {
        new Notice((result && result.message) || "Could not update the relation label.");
        return false;
      }
      new Notice(`${row.hidden ? "Unhid" : "Hid"} ${row.name} from suggestions.`);
      await this.refreshRelationLabelManagerRows();
      return true;
    } catch (_error) {
      new Notice("Could not update the relation label.");
      return false;
    } finally {
      this.writeInFlight.delete(row.key);
    }
  }

  onClose() {
    if (typeof this.unsubscribeRelationLabels === "function") {
      try {
        this.unsubscribeRelationLabels();
      } catch (_error) {
        // Unsubscribing cannot affect a completed relation-label write.
      }
    }
    this.unsubscribeRelationLabels = null;
    super.onClose();
  }
}

class BulletPropertyPickerRelationLabelManagementMixin extends FilteredPickerModal {
  openRelationLabelRenameForStage(item) {
    if (!item || item.kind !== "relation-label" || item.typed === true || item.plain === true || !item.label) {
      new Notice("Select an existing relation label to rename.");
      return false;
    }
    new RelationLabelRenameModal(this.app, item.label, {
      afterRename: () => {
        if (this.stage !== "relation-label") return;
        this.relationLabelGhosts = new Map();
        this.relationLabelLastQuery = null;
        this.refreshRelationLabelHeader();
        this.renderResults();
      },
    }).open();
    return true;
  }
}

class BobNavigationHotkeysRelationLabelsManagerMixin {
  openRelationLabelsManager() {
    const api = getNavigationRelationLabelsApi(this.app);
    if (!api || typeof api.rows !== "function") {
      new Notice("Update Bob Ledger Tools to use relation labels.");
      return false;
    }
    try {
      new RelationLabelManagerModal(this.app, this).open();
      return true;
    } catch (_error) {
      new Notice("Could not open relation labels.");
      return false;
    }
  }
}
