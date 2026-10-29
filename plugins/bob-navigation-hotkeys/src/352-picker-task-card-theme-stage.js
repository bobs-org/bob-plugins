// Task Card theme stage: t/Enter opens a filtered theme picker, Ctrl+D on
// the Theme row clears to Use default. All commits use the Ledger Tools
// string setters on exact task lines with preimage guards; no status, link,
// ID, freshness, schedule, Work Log, or review-walk effects.
class BulletPropertyPickerTaskCardThemeStageMixin extends FilteredPickerModal {
  getTaskCardThemeApi() {
    try {
      const runtime = buildTaskCardThemeRuntimeContext(this);
      if (runtime && runtime.themeApi) {
        return runtime.themeApi;
      }
    } catch (_error) {
      // Fall through to the direct lookup.
    }
    try {
      return getNavigationPomodoroThemesApi(this.app);
    } catch (_error) {
      return null;
    }
  }

  getTaskCardLedgerApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const ledger = plugins && plugins["bob-ledger-tools"];
      return (ledger && ledger.api) || null;
    } catch (_error) {
      return null;
    }
  }

  currentTaskCardThemeProjection() {
    if (this.taskCardModel && this.taskCardModel.themeProjection) {
      return this.taskCardModel.themeProjection;
    }
    return null;
  }

  freshTaskCardThemeProjection() {
    try {
      const fresh = planTaskCard(this.buildTaskCardContext());
      return fresh && fresh.themeProjection ? fresh.themeProjection : null;
    } catch (_error) {
      return this.currentTaskCardThemeProjection();
    }
  }

  openTaskCardThemeStage() {
    const projection = this.freshTaskCardThemeProjection() || this.currentTaskCardThemeProjection();
    const api = this.getTaskCardThemeApi();
    if (!projection || !projection.available) {
      new Notice(
        (projection && projection.unavailableReason) ||
          "Theme editing is unavailable",
      );
      return false;
    }
    if (!api) {
      new Notice("Ledger Tools task-theme API is unavailable");
      return false;
    }
    this.taskCardThemeStageProjection = projection;
    this.taskCardThemeQuery = typeof this.taskCardThemeQuery === "string" ? this.taskCardThemeQuery : "";
    this.taskCardThemeSelectedKey = this.taskCardThemeSelectedKey || null;
    this.showTaskCardThemeStage();
    try {
      this.taskCardThemeUnsubscribe = this.subscribeTaskCardThemeCatalog(() => {
        if (this.pickerOpen && this.stage === "value" && this.taskCardThemeStageProjection) {
          const query = this.inputEl && typeof this.inputEl.value === "string" ? this.inputEl.value : this.taskCardThemeQuery || "";
          this.taskCardThemeQuery = query;
          this.showTaskCardThemeStage({ keepQuery: true });
        }
      });
    } catch (_error) {
      this.taskCardThemeUnsubscribe = null;
    }
    try {
      if (api && typeof api.fetch === "function") {
        Promise.resolve(api.fetch())
          .then(() => {
            if (this.pickerOpen && this.stage === "value" && this.taskCardThemeStageProjection) {
              this.showTaskCardThemeStage({ keepQuery: true });
            }
          })
          .catch(() => {});
      }
    } catch (_error) {
      // Fetch is best-effort; cached rows already render.
    }
    return false;
  }

  subscribeTaskCardThemeCatalog(onChange) {
    try {
      this.clearTaskCardThemeSubscription();
      const api = this.getTaskCardThemeApi();
      if (api && typeof api.onChange === "function") {
        const unsubscribe = api.onChange(onChange);
        this.taskCardThemeUnsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
        return this.taskCardThemeUnsubscribe;
      }
    } catch (_error) {
      // Subscription is best-effort.
    }
    return null;
  }

  clearTaskCardThemeSubscription() {
    if (typeof this.taskCardThemeUnsubscribe === "function") {
      try {
        this.taskCardThemeUnsubscribe();
      } catch (_error) {
        // Unsubscribe is best-effort.
      }
    }
    this.taskCardThemeUnsubscribe = null;
  }

  showTaskCardThemeStage(options = {}) {
    const projection = this.freshTaskCardThemeProjection() || this.currentTaskCardThemeProjection();
    if (!projection || !projection.available) {
      new Notice((projection && projection.unavailableReason) || "Theme editing is unavailable");
      this.returnToTaskCard({ rebuild: true });
      return;
    }
    const api = this.getTaskCardThemeApi();
    if (!api) {
      new Notice("Ledger Tools task-theme API is unavailable");
      this.returnToTaskCard({ rebuild: true });
      return;
    }
    this.taskCardThemeStageProjection = projection;
    const keepQuery = options.keepQuery === true;
    const query = keepQuery
      ? (this.inputEl && typeof this.inputEl.value === "string" ? this.inputEl.value : this.taskCardThemeQuery || "")
      : "";
    this.taskCardThemeQuery = query;
    const ledgerApi = this.getTaskCardLedgerApi();
    const stage = buildTaskCardThemeStageModel(projection, api, { query, ledgerApi });
    const items = stage.rows.map((row) => Object.freeze({
      key: row.kind === "default" ? "__default" : `theme-${row.key}`,
      themeKind: row.kind,
      themeKey: row.key,
      themeName: row.name,
      title: row.kind === "default" ? "Use default" : row.title,
      detail: row.detail,
      searchText: row.kind === "default" ? `use default ${row.detail}` : `${row.title || ""} ${row.detail || ""} ${row.key || ""}`,
    }));
    this.stage = "value";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    const selectedKey = this.taskCardThemeSelectedKey;
    let selectedIndex = 0;
    if (selectedKey) {
      const found = items.findIndex((item) => item.key === selectedKey || item.themeKey === selectedKey);
      if (found >= 0) {
        selectedIndex = found;
      }
    }
    this.selectedIndex = selectedIndex;
    this.taskCardThemeStageRows = items;
    const subtitle = stage.mixed
      ? `${formatCountLabel(stage.targetCount, "task")} · Use default clears each task to its own default`
      : stage.defaultDetail
        ? `${stage.defaultDetail}`
        : "Choose a theme";
    this.applyOptions({
      items,
      title: "Theme",
      headerIcon: "palette",
      inputLabel: "Filter themes",
      placeholder: "Type a theme name or filter",
      resultsLabel: "themes",
      emptyText: "No matching themes",
      footerHints: [
        { keys: ["↵"], label: "Apply" },
        { keys: ["^D"], label: "Use default" },
        { keys: ["esc"], label: "Close without writing" },
      ],
      getSubtitle: () => subtitle,
      filterItem: (item, nextQuery) => fuzzyMatchesText(item.searchText, nextQuery),
      renderItem: (item, rowEl) => this.renderTaskCardThemeStageItem(item, rowEl),
      openItem: (item) => this.commitTaskCardThemeStageItem(item),
    });
    if (this.resultsEl) {
      this.renderAll({ clearQuery: !keepQuery });
      if (keepQuery && this.inputEl && typeof this.inputEl.value === "string") {
        this.inputEl.value = query;
      }
    }
  }

  renderTaskCardThemeStageItem(item, rowEl) {
    if (!rowEl || typeof rowEl.createSpan !== "function") {
      return;
    }
    rowEl.empty();
    const main = rowEl.createSpan({ cls: "bob-cnp-row-main" });
    if (item.themeKind === "default") {
      main.createSpan({ cls: "bob-cnp-row-title", text: "Use default" });
      if (item.detail) {
        main.createSpan({ cls: "bob-cnp-row-detail", text: ` · ${item.detail}` });
      }
      return;
    }
    const api = this.getTaskCardThemeApi();
    try {
      if (api && typeof api.hueFor === "function" && item.themeKey) {
        const hue = navigationPomodoroThemeHue(api, item.themeKey, item.themeName);
        if (hue) {
          const dot = main.createSpan({ cls: `bob-task-card-theme-dot is-${hue}`, text: "● " });
          if (dot && typeof dot.setAttribute === "function") {
            dot.setAttribute("aria-hidden", "true");
          }
        }
      }
    } catch (_error) {
      // Hue dot is decorative.
    }
    main.createSpan({ cls: "bob-cnp-row-title", text: item.title || item.themeName || item.themeKey });
    if (item.detail) {
      const badge = item.themeKind === "today" ? "Today" : item.themeKind === "recent" ? "Recent" : item.themeKind === "new" ? "New" : item.themeKind === "inherited-unknown" ? "Current default" : "";
      main.createSpan({ cls: "bob-cnp-row-detail", text: ` · ${badge ? `${badge} · ` : ""}${item.detail}` });
    }
  }

  async commitTaskCardThemeStageItem(item) {
    if (!item) {
      return false;
    }
    if (this.opening) {
      return false;
    }
    this.taskCardThemeSelectedKey = item.key || item.themeKey || null;
    this.taskCardThemeQuery = this.inputEl && typeof this.inputEl.value === "string" ? this.inputEl.value : this.taskCardThemeQuery || "";
    if (item.themeKind === "default") {
      return await this.applyTaskCardThemeDefault();
    }
    return await this.applyTaskCardThemeChoice({ kind: item.themeKind, key: item.themeKey, name: item.themeName });
  }

  async applyTaskCardThemeDefault() {
    return await this.applyTaskCardThemeChoice({ kind: "default", key: "__default", name: null });
  }

  async applyTaskCardThemeChoice(selection) {
    const projection = this.freshTaskCardThemeProjection() || this.currentTaskCardThemeProjection();
    const api = this.getTaskCardThemeApi();
    if (!projection || !projection.available) {
      new Notice((projection && projection.unavailableReason) || "Theme editing is unavailable");
      return false;
    }
    if (!api || typeof api.setTaskTheme !== "function" || typeof api.clearTaskTheme !== "function") {
      new Notice("Ledger Tools task-theme API is unavailable");
      return false;
    }
    const ledgerApi = this.getTaskCardLedgerApi();
    const plan = planTaskCardThemeEdits(projection, selection, api, { ledgerApi });
    if (!plan.valid) {
      new Notice(plan.error || "That theme cannot be set on a task");
      return false;
    }
    const fresh = this.freshTaskCardThemeProjection() || projection;
    const edits = [];
    for (const edit of plan.edits) {
      const check = taskCardThemeRevalidateEdit(edit, fresh);
      if (!check.ok) {
        new Notice(check.reason || "Task changed; reopen the card");
        return false;
      }
      edits.push(edit);
    }
    const applied = await this.writeTaskCardThemeEdits(edits, api);
    if (applied !== true) {
      return false;
    }
    this.clearTaskCardThemeSubscription();
    this.taskCardThemeStageProjection = null;
    this.taskCardThemeQuery = "";
    this.taskCardThemeSelectedKey = null;
    // Theme-only edits never advance the review walk.
    this.reviewOrigin = null;
    this.reviewBeforeLine = "";
    this.reviewLineIndex = null;
    this.reviewOriginContent = null;
    this.close();
    return true;
  }

  async writeTaskCardThemeEdits(edits, api) {
    if (!Array.isArray(edits) || edits.length === 0) {
      return false;
    }
    if (this.isLinkSession()) {
      return await this.writeTaskCardLinkedThemeEdits(edits, api);
    }
    if (this.isCountedSession()) {
      return await this.writeTaskCardCountedThemeEdits(edits, api);
    }
    return await this.writeTaskCardSingleThemeEdits(edits, api);
  }

  taskCardThemeNewLineFor(rawLine, edit, api) {
    if (edit.action === "clear") {
      return api.clearTaskTheme(rawLine);
    }
    if (edit.action === "set") {
      return api.setTaskTheme(rawLine, edit.name);
    }
    return rawLine;
  }

  isTaskCardThemeClosedLine(rawLine) {
    try {
      const status = getObsidianTaskCheckboxStatus(String(rawLine || ""));
      if (status === null) {
        return false;
      }
      if (typeof OPEN_OBSIDIAN_TASK_STATUSES !== "undefined" && OPEN_OBSIDIAN_TASK_STATUSES.has) {
        return !OPEN_OBSIDIAN_TASK_STATUSES.has(status);
      }
      return status === "x" || status === "X" || status === "-";
    } catch (_error) {
      return false;
    }
  }

  async writeTaskCardSingleThemeEdits(edits, api) {
    const edit = edits[0];
    if (!edit) {
      return false;
    }
    if (this.isTaskCardThemeClosedLine(edit.target.identity.rawLine)) {
      new Notice("Closed tasks keep their theme history; nothing was written");
      return false;
    }
    const editor = this.editor;
    if (!editor || typeof editor.getValue !== "function" || typeof editor.replaceRange !== "function") {
      new Notice("No active markdown editor");
      return false;
    }
    const content = String(editor.getValue() || "");
    const lines = content.split(/\r?\n/);
    const line = edit.target.identity.line;
    if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
      new Notice("Task changed; reopen the card");
      return false;
    }
    if (lines[line] !== edit.target.identity.rawLine) {
      new Notice("Task changed; reopen the card");
      return false;
    }
    if (edit.action === "none") {
      new Notice("Theme is already set; nothing was written");
      this.close();
      return true;
    }
    const nextLine = this.taskCardThemeNewLineFor(lines[line], edit, api);
    if (nextLine === lines[line]) {
      new Notice("Theme is already set; nothing was written");
      this.close();
      return true;
    }
    const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : this.cursor;
    const applied = replaceEditorLine(editor, line, lines[line], nextLine);
    if (!applied) {
      new Notice("Could not write the theme; nothing was written");
      return false;
    }
    if (cursor && typeof editor.setCursor === "function") {
      try {
        setEditorCursorSafely(editor, cursor.line, Math.min(cursor.ch, nextLine.length));
      } catch (_error) {
        // Cursor restore is best-effort.
      }
    }
    new Notice(edit.action === "clear" ? "Theme cleared to default" : `Theme ${edit.name} saved`);
    return true;
  }

  async writeTaskCardCountedThemeEdits(edits, api) {
    const editor = this.editor;
    if (!editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }
    const content = String(typeof this.getEditorContent === "function" ? this.getEditorContent() : editor.getValue() || "");
    const lines = content.split(/\r?\n/);
    const nextLines = lines.slice();
    let changed = 0;
    let skippedClosed = 0;
    for (const edit of edits) {
      const line = edit.target.identity.line;
      if (!Number.isInteger(line) || line < 0 || line >= lines.length || lines[line] !== edit.target.identity.rawLine) {
        new Notice("Task changed; reopen the card");
        return false;
      }
      if (this.isTaskCardThemeClosedLine(lines[line])) {
        skippedClosed += 1;
        continue;
      }
      if (edit.action === "none") {
        continue;
      }
      const nextLine = this.taskCardThemeNewLineFor(lines[line], edit, api);
      if (nextLine !== lines[line]) {
        nextLines[line] = nextLine;
        changed += 1;
      }
    }
    if (changed === 0) {
      new Notice(skippedClosed > 0 ? `Closed tasks keep their theme history; nothing was written` : "Themes are already set; nothing was written");
      if (skippedClosed === 0) {
        this.close();
      }
      return skippedClosed === 0;
    }
    const ending = content.includes("\r\n") ? "\r\n" : "\n";
    const nextContent = nextLines.join(ending);
    const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : this.cursor;
    const applied = applyEditorContentTransaction(editor, content, nextContent, cursor ? { line: cursor.line, ch: cursor.ch } : null);
    if (!applied || String(editor.getValue() || "") !== nextContent) {
      new Notice("Could not write themes; no tasks were updated");
      return false;
    }
    new Notice(
      `Theme saved on ${formatCountLabel(changed, "task")}${skippedClosed > 0 ? ` (${skippedClosed} closed skipped)` : ""}`,
    );
    return true;
  }

  async writeTaskCardLinkedThemeEdits(edits, api) {
    let changed = 0;
    let skippedClosed = 0;
    let skippedStale = 0;
    const failures = [];
    for (const edit of edits) {
      const identity = edit.target.identity;
      const targetPath = identity.path;
      if (!targetPath || !Number.isInteger(identity.line)) {
        skippedStale += 1;
        continue;
      }
      if (this.isTaskCardThemeClosedLine(identity.rawLine)) {
        skippedClosed += 1;
        continue;
      }
      if (edit.action === "none") {
        continue;
      }
      let freshContent = null;
      try {
        if (typeof this.readVaultStageFiles === "function") {
          const files = await this.readVaultStageFiles([targetPath]);
          freshContent = files ? files.get(targetPath) : null;
        } else if (this.plugin && typeof this.plugin.readDependencyNoteContent === "function") {
          freshContent = await this.plugin.readDependencyNoteContent(targetPath, null, "");
        }
      } catch (_error) {
        freshContent = null;
      }
      if (typeof freshContent !== "string") {
        failures.push(targetPath);
        continue;
      }
      const freshLines = freshContent.split(/\r?\n/);
      if (freshLines[identity.line] !== identity.rawLine || !isObsidianTaskLine(freshLines[identity.line])) {
        skippedStale += 1;
        continue;
      }
      const nextLine = this.taskCardThemeNewLineFor(freshLines[identity.line], edit, api);
      if (nextLine === freshLines[identity.line]) {
        continue;
      }
      let prepared = null;
      try {
        prepared = await this.plugin.prepareDependencyTargetNote(targetPath, {
          line: identity.line,
          from: freshLines[identity.line],
          text: nextLine,
        });
      } catch (_error) {
        prepared = null;
      }
      if (!prepared || prepared.ok !== true) {
        failures.push(targetPath);
        continue;
      }
      changed += 1;
    }
    if (changed === 0 && failures.length === 0 && skippedStale === 0 && skippedClosed > 0) {
      new Notice("Closed tasks keep their theme history; nothing was written");
      return false;
    }
    if (changed === 0 && failures.length === 0 && skippedStale > 0) {
      new Notice("Linked task changed; reopen the card");
      return false;
    }
    if (changed === 0 && failures.length === 0) {
      new Notice("Themes are already set; nothing was written");
      this.close();
      return true;
    }
    if (failures.length > 0 || skippedStale > 0) {
      new Notice(
        `Theme saved on ${formatCountLabel(changed, "task")}${failures.length > 0 ? ` · failed in ${failures.length} note${failures.length === 1 ? "" : "s"}` : ""}${skippedStale > 0 ? ` · ${skippedStale} stale skipped` : ""}${skippedClosed > 0 ? ` · ${skippedClosed} closed skipped` : ""}`,
      );
      return changed > 0;
    }
    new Notice(
      `Theme saved on ${formatCountLabel(changed, "task")}${skippedClosed > 0 ? ` (${skippedClosed} closed skipped)` : ""}`,
    );
    return true;
  }

  handleTaskCardThemeKeydown(event) {
    if (!event || event.isComposing === true || event.keyCode === 229) {
      return false;
    }
    if (this.stage === "value" && this.taskCardThemeStageRows && isCtrlKey(event, "d")) {
      event.preventDefault();
      event.stopPropagation();
      void this.applyTaskCardThemeDefault().catch(() => {
        new Notice("Could not clear the theme");
      });
      return true;
    }
    if (this.stage === "value" && this.taskCardThemeStageRows && event.key === "Escape") {
      // Cancellation writes nothing and clears the stage subscription.
      this.clearTaskCardThemeSubscription();
      this.taskCardThemeStageProjection = null;
      this.taskCardThemeStageRows = null;
      return false;
    }
    return false;
  }
}
