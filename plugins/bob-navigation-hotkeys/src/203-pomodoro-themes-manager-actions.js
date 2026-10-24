// Pomodoro themes manager actions: action, color, occurrences, and rename
// modals plus the vault occurrence scan and the plugin mixin. Row models
// and the manager picker live in 202-pomodoro-themes-manager.js.

class PomodoroThemeActionModal extends FilteredPickerModal {
  constructor(app, manager, themeRow) {
    const theme = themeRow && themeRow.theme ? themeRow.theme : null;
    const name = theme && theme.name ? theme.name : "theme";
    const hidden = theme && theme.hidden === true;
    super(app, {
      items: [
        { kind: "action", key: "rename", title: `Rename ${name}`, meta: "Previewed one-commit rename (r)" },
        { kind: "action", key: "color", title: `Pin color for ${name}`, meta: "8 hues plus Auto (c)" },
        { kind: "action", key: "hide", title: hidden ? `Unhide ${name}` : `Hide ${name}`, meta: "Recent suggestions only (h)" },
        { kind: "action", key: "occurrences", title: `Show occurrences of ${name}`, meta: "Daily notes, Enter opens (o)" },
      ],
      title: name,
      headerIcon: "timer",
      inputLabel: "Choose a theme action",
      placeholder: "type to filter · r/c/h/o jump when empty",
      resultsLabel: "Theme actions",
      emptyText: "No actions",
      footerHints: [
        { keys: ["r", "c", "h", "o"], label: "Jump to action" },
        { keys: ["↵"], label: "Run" },
        { keys: ["esc"], label: "Back" },
      ],
      filterItem: (row, query) => !query || String(row.title || "").toLowerCase().includes(query),
      renderItem: (row, rowEl, query) => {
        addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", "is-action"]);
        const iconEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(iconEl, row.key === "rename" ? "pencil" : row.key === "color" ? "palette" : row.key === "hide" ? "eye-off" : "search");
        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, row.title, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        appendHighlighted(pathEl, row.meta, query);
      },
      closeBeforeOpenItem: true,
      openItem: (row) => this.runAction(row),
    });
    this.manager = manager;
    this.themeRow = themeRow;
  }

  handleKeydown(event) {
    // Single-key jumps stay out of the way of filtering: with text in the
    // filter input the keys type normally, and jump only when it is empty.
    if (this.inputEl && String(this.inputEl.value || "") !== "") {
      super.handleKeydown(event);
      return;
    }
    const key = String(event.key || "").toLowerCase();
    if (!event.ctrlKey && !event.metaKey && !event.altKey && ["r", "c", "h", "o"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      const map = { r: "rename", c: "color", h: "hide", o: "occurrences" };
      const row = this.items.find((item) => item.key === map[key]);
      if (row) {
        void this.openItemAtIndex(this.items.indexOf(row));
      }
      return;
    }
    super.handleKeydown(event);
  }

  runAction(row) {
    if (!row || !this.manager) {
      return false;
    }
    if (row.key === "rename") {
      this.manager.openThemeRename(this.themeRow);
    } else if (row.key === "color") {
      this.manager.openThemeColor(this.themeRow);
    } else if (row.key === "hide") {
      void this.manager.toggleThemeRowVisibility(this.themeRow);
    } else if (row.key === "occurrences") {
      this.manager.openThemeOccurrences(this.themeRow);
    }
    return true;
  }
}

class PomodoroThemeColorModal extends FilteredPickerModal {
  constructor(app, manager, theme) {
    const name = theme && theme.name ? theme.name : "theme";
    const items = POMODORO_THEMES_MANAGER_HUES.map((hue, index) => ({
      kind: "color",
      key: `color-${hue}`,
      hue,
      label: `${index + 1} ${hue.slice(0, 1).toUpperCase()}${hue.slice(1)}`,
      meta: hue === (theme && theme.hue) ? "current" : "",
    }));
    items.push({ kind: "color", key: "color-auto", hue: "auto", label: "a Auto", meta: theme && theme.pinned === true ? "" : "current" });
    super(app, {
      items,
      title: `Pin color for ${name}`,
      headerIcon: "palette",
      inputLabel: "Choose a theme color",
      placeholder: "type to filter · 1–8/a pin when empty",
      resultsLabel: "Theme colors",
      emptyText: "No colors",
      footerHints: [
        { keys: ["1–8", "a"], label: "Pick hue or Auto" },
        { keys: ["↵"], label: "Pin" },
        { keys: ["esc"], label: "Back" },
      ],
      filterItem: (row, query) => !query || String(row.hue || "").includes(query),
      renderItem: (row, rowEl, query) => {
        addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", "is-color"]);
        const swatchEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        if (row.hue && row.hue !== "auto") {
          swatchEl.createDiv({ cls: `bob-cnp-theme-swatch is-${row.hue}` });
        } else {
          applyIcon(swatchEl, "rotate-ccw");
        }
        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, row.label, query);
        if (row.meta) {
          const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
          appendHighlighted(pathEl, row.meta, query);
        }
      },
      closeBeforeOpenItem: false,
      openItem: (row) => {
        void this.pinColor(row);
        return false;
      },
    });
    this.manager = manager;
    this.theme = theme;
  }

  handleKeydown(event) {
    if (this.inputEl && String(this.inputEl.value || "") !== "") {
      super.handleKeydown(event);
      return;
    }
    const key = String(event.key || "").toLowerCase();
    if (!event.ctrlKey && !event.metaKey && !event.altKey && POMODORO_THEMES_MANAGER_COLOR_KEYS.includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      const index = key === "a" ? this.items.length - 1 : Number(key) - 1;
      const row = this.items[index];
      if (row) {
        void this.pinColor(row);
      }
      return;
    }
    super.handleKeydown(event);
  }

  async pinColor(row) {
    if (!row || !this.manager || !this.manager.themesApi) {
      return;
    }
    const api = this.manager.themesApi;
    if (typeof api.color !== "function") {
      new Notice("Update bob to pin theme colors");
      return;
    }
    try {
      const result = await api.color(this.theme.name, row.hue);
      if (!result || result.ok !== true) {
        new Notice((result && result.message) || "Could not pin the theme color");
        return;
      }
      new Notice(row.hue === "auto" ? `${this.theme.name} uses its automatic hue` : `${this.theme.name} wears ${row.hue}`);
      this.close();
      await this.manager.refreshManagerReport("write");
    } catch (error) {
      new Notice("Could not pin the theme color");
    }
  }
}

class PomodoroThemeOccurrencesModal extends FilteredPickerModal {
  constructor(app, plugin, theme, options = {}) {
    super(app, {
      items: [],
      title: `Occurrences of ${theme && theme.name ? theme.name : "theme"}`,
      headerIcon: "search",
      inputLabel: "Filter occurrences",
      placeholder: "Filter daily notes",
      resultsLabel: "Theme occurrences",
      emptyText: "Scanning daily notes…",
      footerHints: [
        { keys: ["↵"], label: "Open at entry" },
        { keys: ["esc"], label: "Back" },
      ],
      getSubtitle: () => this.occurrencesSubtitle(),
      filterItem: (row, query) => !query || `${row.path} ${row.tail}`.toLowerCase().includes(query),
      renderItem: (row, rowEl, query) => {
        addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", "is-occurrence"]);
        const iconEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(iconEl, "timer");
        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, row.path, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        appendHighlighted(pathEl, row.tail, query);
      },
      closeBeforeOpenItem: true,
      openItem: (row) => {
        void this.openOccurrence(row);
        return false;
      },
    });
    this.plugin = plugin;
    this.theme = theme;
    this.opener = options && typeof options.opener === "function" ? options.opener : null;
    this.occurrencesError = null;
  }

  occurrencesSubtitle() {
    if (this.occurrencesError) {
      return this.occurrencesError;
    }
    const count = this.items.length;
    return `${count} ${count === 1 ? "occurrence" : "occurrences"}`;
  }

  onOpen() {
    super.onOpen();
    void this.loadOccurrences();
  }

  async loadOccurrences() {
    try {
      const rows = await findPomodoroThemeOccurrences(this.app, this.theme && this.theme.key);
      if (!this.pickerOpen) {
        return;
      }
      this.items = rows.map((row, index) => ({ kind: "occurrence", key: `occurrence-${index}`, ...row }));
      this.selectedIndex = 0;
      if (rows.length === 0) {
        this.emptyText = "No occurrences in daily notes";
      }
      this.renderResults();
    } catch (error) {
      this.occurrencesError = "Could not scan daily notes";
      this.emptyText = "Could not scan daily notes";
      this.renderResults();
    }
  }

  async openOccurrence(row) {
    if (!row || row.kind !== "occurrence") {
      return;
    }
    try {
      if (this.opener) {
        await this.opener(row);
        return;
      }
      const plugin = this.plugin;
      if (!plugin || typeof plugin.openMarkdownFileWithLeafReuse !== "function") {
        new Notice("Could not open the daily note");
        return;
      }
      const file = plugin.app && plugin.app.vault ? plugin.app.vault.getAbstractFileByPath(row.path) : null;
      if (!file) {
        new Notice("Daily note is no longer in the vault");
        return;
      }
      const opened = await plugin.openMarkdownFileWithLeafReuse(file, "Could not open the daily note");
      if (!opened) {
        return;
      }
      const view = typeof plugin.getActiveMarkdownView === "function" ? plugin.getActiveMarkdownView() : null;
      const editor = view && view.editor ? view.editor : null;
      if (editor && typeof setEditorCursor === "function") {
        setEditorCursor(editor, { line: row.line, ch: 0 });
      }
    } catch (error) {
      new Notice("Could not open the daily note");
    }
  }
}

// Scan the vault's canonical daily notes for entries containing the theme
// key. Reads through the vault cache so the scan stays cheap.
async function findPomodoroThemeOccurrences(app, key) {
  const wanted = normalizePomodoroThemeManagerKey(key);
  if (!wanted) {
    return [];
  }
  const vault = app && app.vault ? app.vault : null;
  if (!vault || typeof vault.getMarkdownFiles !== "function") {
    return [];
  }
  const files = vault.getMarkdownFiles().filter((file) => file && isPomodoroThemeManagerDailyPath(file.path));
  files.sort((left, right) => (left.path < right.path ? 1 : left.path > right.path ? -1 : 0));
  const rows = [];
  for (const file of files) {
    try {
      const content =
        typeof vault.cachedRead === "function"
          ? await vault.cachedRead(file)
          : typeof vault.read === "function"
            ? await vault.read(file)
            : "";
      for (const row of collectPomodoroThemeOccurrencesInText(file.path, content, wanted)) {
        rows.push(row);
      }
    } catch (error) {
      continue;
    }
  }
  return rows;
}

class PomodoroThemeRenameModal extends Modal {
  constructor(app, manager, theme) {
    super(app);
    this.manager = manager;
    this.theme = theme;
    this.renamePreview = null;
    this.renameError = null;
    this.renameApplying = false;
  }

  onOpen() {
    this.contentEl.empty();
    this.modalEl.addClass("bob-cnp-modal");
    this.contentEl.addClass("bob-cnp");
    const header = this.contentEl.createDiv({ cls: "bob-cnp-header" });
    const headerIcon = header.createDiv({ cls: "bob-cnp-header-icon" });
    applyIcon(headerIcon, "pencil");
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    const title = headerText.createDiv({ cls: "bob-cnp-title" });
    const from = this.theme && this.theme.name ? this.theme.name : "theme";
    title.setText(`Rename ${from}`);
    const subtitle = headerText.createDiv({ cls: "bob-cnp-subtitle" });
    subtitle.setText("Previewed one-commit rename across daily notes");

    const form = this.contentEl.createDiv({ cls: "bob-cnp-rename-form" });
    form.createEl("label", { cls: "bob-cnp-rename-label", text: "New name" });
    this.nameInput = form.createEl("input", {
      cls: "bob-cnp-input",
      attr: { type: "text", placeholder: "FIX", "aria-label": "New theme name" },
    });
    this.mergeToggle = form.createEl("input", {
      cls: "bob-cnp-rename-merge",
      attr: { type: "checkbox", "aria-label": "Merge into an existing theme" },
    });
    form.createEl("label", { cls: "bob-cnp-rename-label", text: "Merge into an existing theme (--merge)" });

    const buttons = this.contentEl.createDiv({ cls: "bob-cnp-rename-buttons" });
    this.previewButton = buttons.createEl("button", { cls: "bob-cnp-rename-button", text: "Preview" });
    this.applyButton = buttons.createEl("button", { cls: "bob-cnp-rename-button", text: "Rename" });
    this.previewButton.addEventListener("click", () => void this.previewRename());
    this.applyButton.addEventListener("click", () => void this.applyRename());
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.previewRename();
      }
    });

    this.previewEl = this.contentEl.createDiv({ cls: "bob-cnp-results" });
    window.setTimeout(() => {
      if (this.nameInput && typeof this.nameInput.focus === "function") {
        this.nameInput.focus();
      }
    }, 0);
  }

  renameTarget() {
    return String((this.nameInput && this.nameInput.value) || "");
  }

  async previewRename() {
    this.renameError = null;
    const error = pomodoroThemesManagerRenameInputError(this.renameTarget());
    if (error) {
      this.renameError = error;
      this.renderRenamePreview();
      return null;
    }
    const api = this.manager && this.manager.themesApi;
    if (!api || typeof api.rename !== "function") {
      this.renameError = "Theme renames need the desktop app.";
      this.renderRenamePreview();
      return null;
    }
    const merge = Boolean(this.mergeToggle && this.mergeToggle.checked);
    try {
      const result = await api.rename(this.theme.name, this.renameTarget().trim().toUpperCase(), { dryRun: true, merge });
      if (!result || result.ok !== true) {
        this.renameError = (result && result.message) || "Could not preview the rename";
        if (result && result.code === "theme_exists") {
          this.renameError += " — tick merge to combine";
        }
        this.renamePreview = null;
        this.renderRenamePreview();
        return null;
      }
      this.renamePreview = formatPomodoroThemeManagerRenamePreview(result.report || result);
      this.renderRenamePreview();
      return this.renamePreview;
    } catch (error) {
      this.renameError = "Could not preview the rename";
      this.renderRenamePreview();
      return null;
    }
  }

  renderRenamePreview() {
    if (!this.previewEl) {
      return;
    }
    this.previewEl.empty();
    if (this.renameError) {
      const errorEl = this.previewEl.createDiv({ cls: "bob-cnp-empty" });
      errorEl.createDiv({ cls: "bob-cnp-empty-text", text: this.renameError });
      return;
    }
    if (!this.renamePreview) {
      const hintEl = this.previewEl.createDiv({ cls: "bob-cnp-empty" });
      hintEl.createDiv({ cls: "bob-cnp-empty-text", text: "Preview shows the notes, entries, and color change before anything writes." });
      return;
    }
    const titleEl = this.previewEl.createDiv({ cls: "bob-cnp-row-title" });
    titleEl.setText(this.renamePreview.title);
    for (const line of this.renamePreview.lines) {
      const rowEl = this.previewEl.createDiv({ cls: "bob-cnp-row" });
      const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
      textEl.createDiv({ cls: "bob-cnp-row-path", text: line });
    }
    if (this.renamePreview.stateNote || this.renamePreview.colorNote) {
      const noteEl = this.previewEl.createDiv({ cls: "bob-cnp-row-path" });
      noteEl.setText([this.renamePreview.stateNote, this.renamePreview.colorNote].filter(Boolean).join(" · "));
    }
  }

  async applyRename() {
    if (this.renameApplying) {
      return;
    }
    const preview = this.renamePreview || (await this.previewRename());
    if (!preview) {
      return;
    }
    const api = this.manager && this.manager.themesApi;
    if (!api || typeof api.rename !== "function") {
      new Notice("Theme renames need the desktop app.");
      return;
    }
    const to = this.renameTarget().trim().toUpperCase();
    const merge = Boolean(this.mergeToggle && this.mergeToggle.checked);
    this.renameApplying = true;
    try {
      const saved = await this.saveOpenThemeNotes(preview);
      if (!saved) {
        new Notice("Save the listed notes first, then rename again");
        return;
      }
      const result = await api.rename(this.theme.name, to, { merge });
      if (!result || result.ok !== true) {
        new Notice((result && result.message) || "Could not rename the theme");
        return;
      }
      const files = preview.files;
      new Notice(`Renamed ${this.theme.name} → ${to} in ${files} ${files === 1 ? "note" : "notes"} · one commit`);
      this.close();
      if (this.manager) {
        await this.manager.refreshManagerReport("rename");
      }
    } catch (error) {
      new Notice("Could not rename the theme");
    } finally {
      this.renameApplying = false;
    }
  }

  // Save every open editor whose note the rename touches. A failed save
  // refuses the rename instead of writing under an unsaved buffer.
  async saveOpenThemeNotes(preview) {
    try {
      const app = this.manager && this.manager.app ? this.manager.app : this.app;
      const workspace = app && app.workspace ? app.workspace : null;
      if (!workspace) {
        return true;
      }
      const touched = new Set((preview && preview.lines ? preview.lines : []).map((line) => String(line).split(" · ")[0]));
      const leaves = [];
      if (typeof workspace.iterateAllLeaves === "function") {
        workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
      } else if (typeof workspace.getLeavesOfType === "function") {
        for (const type of ["markdown", "editor"]) {
          try {
            for (const leaf of workspace.getLeavesOfType(type)) {
              leaves.push(leaf);
            }
          } catch (error) {
            continue;
          }
        }
      }
      for (const leaf of leaves) {
        const view = leaf && leaf.view ? leaf.view : null;
        const file = view && view.file ? view.file : null;
        if (!file || !touched.has(file.path)) {
          continue;
        }
        if (view && typeof view.save === "function") {
          try {
            await view.save();
          } catch (error) {
            return false;
          }
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  onClose() {
    this.modalEl.removeClass("bob-cnp-modal");
    this.contentEl.empty();
  }
}

class BobNavigationHotkeysPomodoroThemesManagerMixin {
  openPomodoroThemesManager() {
    const api = getNavigationPomodoroThemesApi(this.app);
    if (!navigationPomodoroThemeAvailable(api)) {
      new Notice("Pomodoro themes need the desktop app.");
      return false;
    }
    try {
      new PomodoroThemesManagerModal(this.app, this).open();
      return true;
    } catch (error) {
      new Notice("Could not open Pomodoro themes");
      return false;
    }
  }
}
