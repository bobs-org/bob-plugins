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
      return null;
    }
  }

  taskCardThemeStageIsActive(generation = this.taskCardThemeStageGeneration) {
    return Boolean(
      this.pickerOpen &&
      this.stage === "value" &&
      this.taskCardThemeStageProjection &&
      generation === this.taskCardThemeStageGeneration
    );
  }

  taskCardThemeStageItemsForQuery(query) {
    const projection = this.taskCardThemeStageProjection;
    const api = this.getTaskCardThemeApi();
    if (!projection || !api) {
      this.items = [];
      this.taskCardThemeStageRows = [];
      return [];
    }
    const rawQuery = typeof query === "string" ? query : "";
    this.taskCardThemeQuery = rawQuery;
    const stage = buildTaskCardThemeStageModel(projection, api, {
      query: rawQuery,
      ledgerApi: this.getTaskCardLedgerApi(),
    });
    const items = stage.rows.map(taskCardThemeStageItem);
    this.taskCardThemeStageRows = items;
    this.items = items;
    const normalizedQuery = rawQuery.trim().toLowerCase();
    return normalizedQuery
      ? items.filter((item) => fuzzyMatchesText(item.searchText, normalizedQuery))
      : items;
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
    if (typeof api.setTaskTheme !== "function" || typeof api.clearTaskTheme !== "function") {
      new Notice("Ledger Tools task-theme write methods are unavailable");
      return false;
    }
    this.taskCardThemeStageProjection = projection;
    this.taskCardThemeStageGeneration = (this.taskCardThemeStageGeneration || 0) + 1;
    const generation = this.taskCardThemeStageGeneration;
    this.taskCardThemeQuery = "";
    this.taskCardThemeSelectedKey = null;
    this.showTaskCardThemeStage();
    try {
      this.taskCardThemeUnsubscribe = this.subscribeTaskCardThemeCatalog(() => {
        if (this.taskCardThemeStageIsActive(generation)) {
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
            if (this.taskCardThemeStageIsActive(generation)) {
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

  clearTaskCardThemeStage() {
    this.clearTaskCardThemeSubscription();
    this.taskCardThemeStageGeneration = (this.taskCardThemeStageGeneration || 0) + 1;
    this.taskCardThemeCommitGeneration = (this.taskCardThemeCommitGeneration || 0) + 1;
    this.taskCardThemeCommitInFlight = false;
    this.taskCardThemeStageProjection = null;
    this.taskCardThemeStageRows = null;
    this.taskCardThemeQuery = "";
    this.taskCardThemeSelectedKey = null;
  }

  showTaskCardThemeStage(options = {}) {
    // Catalog refreshes repaint the choices against the exact projection the
    // user saw on entry. A fresh task/default context is only established by
    // opening the stage again, never by an asynchronous repaint.
    const projection = options.projection || this.taskCardThemeStageProjection ||
      this.freshTaskCardThemeProjection() || this.currentTaskCardThemeProjection();
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
    const items = stage.rows.map(taskCardThemeStageItem);
    this.stage = "value";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    const activeItem = this.visibleItems && this.visibleItems[this.selectedIndex];
    const selectedKey = activeItem && activeItem.key
      ? activeItem.key
      : this.taskCardThemeSelectedKey;
    const visibleItems = query.trim()
      ? items.filter((item) => fuzzyMatchesText(item.searchText, query.trim().toLowerCase()))
      : items;
    let selectedIndex = 0;
    if (selectedKey) {
      const found = visibleItems.findIndex((item) => item.key === selectedKey || item.themeKey === selectedKey);
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
      renderItem: (item, rowEl, query) => this.renderTaskCardThemeStageItem(item, rowEl, query),
      openItem: (item) => this.commitTaskCardThemeStageItem(item),
    });
    if (this.resultsEl) {
      this.renderAll({ clearQuery: !keepQuery });
      if (keepQuery && this.inputEl && typeof this.inputEl.value === "string") {
        this.inputEl.value = query;
      }
    }
  }

  renderTaskCardThemeStageItem(item, rowEl, query) {
    if (!rowEl || typeof rowEl.createDiv !== "function") {
      return;
    }
    rowEl.empty();
    addElementClasses(rowEl, "bob-task-card-theme-option", `is-${item.themeKind}`);
    const text = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const title = text.createDiv({ cls: "bob-cnp-row-title" });
    if (item.themeKind === "default") {
      title.textContent = "Use default";
    } else {
      let hue = null;
      try {
        hue = navigationPomodoroThemeHue(this.getTaskCardThemeApi(), item.themeKey, item.themeName);
      } catch (_error) {
        // Color is decorative; an unavailable hue stays grey.
      }
      const hueClass = hue ? `is-${hue}` : "is-muted";
      const pill = title.createSpan({
        cls: `bob-task-card-theme-option-pill ${hueClass}`,
        attr: { "data-theme-hue": hue || "none" },
      });
      pill.createSpan({
        cls: `bob-cnp-theme-swatch ${hueClass}`,
        attr: { "aria-hidden": "true", title: hue ? `Theme hue: ${hue}` : "No theme color" },
      });
      const name = pill.createSpan({ cls: "bob-task-card-theme-option-name" });
      appendHighlighted(name, item.title || item.themeName || item.themeKey, query);
    }
    const detail = item.themeKind === "default" ? item.detail
      : item.themeKind === "new" ? "New theme"
        : item.themeKind === "inherited-unknown" ? "current default · not in catalog"
          : item.inheritedDefault && item.inheritedFrom
            ? item.inheritedFrom === "reading tasks" ? "default for reading tasks" : `inherited from ${item.inheritedFrom}`
            : null;
    if (detail) text.createDiv({ cls: "bob-cnp-row-path", text: detail });
    const label = { today: "Today", recent: "Recent", new: "New", "inherited-unknown": "Not in catalog" }[item.themeKind];
    if (label || item.inheritedDefault) {
      const badges = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
      if (label) badges.createSpan({ cls: "bob-cnp-row-status", text: label });
      if (item.inheritedDefault) badges.createSpan({
        cls: "bob-cnp-row-status",
        text: "Default",
        attr: { title: "Inherited default; choosing it removes this task's override" },
      });
    }
  }

  async commitTaskCardThemeStageItem(item) {
    if (!item || this.stage !== "value" || !this.taskCardThemeStageProjection) {
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
    if (this.taskCardThemeCommitInFlight) {
      return false;
    }
    this.taskCardThemeCommitInFlight = true;
    const commitGeneration = (this.taskCardThemeCommitGeneration || 0) + 1;
    this.taskCardThemeCommitGeneration = commitGeneration;
    const isCurrent = () =>
      this.taskCardThemeCommitGeneration === commitGeneration &&
      this.pickerOpen &&
      this.stage === "value";
    const projection = this.taskCardThemeStageProjection || this.currentTaskCardThemeProjection();
    const api = this.getTaskCardThemeApi();
    try {
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
      let edits = plan.edits;
      if (this.isLinkSession()) {
        if (!isCurrent()) return false;
        const applied = await this.writeTaskCardLinkedThemeEdits(edits, api, selection, isCurrent);
        if (applied !== true || !isCurrent()) return false;
      } else {
        const fresh = this.freshTaskCardThemeProjection();
        if (!fresh || !fresh.available) {
          new Notice((fresh && fresh.unavailableReason) || "Task context changed; reopen the card");
          return false;
        }
        edits = [];
        for (const edit of plan.edits) {
          const check = taskCardThemeRevalidateEdit(edit, fresh);
          if (!check.ok) {
            new Notice(check.reason || "Task changed; reopen the card");
            return false;
          }
          const refreshed = fresh.targets.find((target) => target.identity.id === edit.target.identity.id);
          const freshPlan = planTaskCardThemeEdits(
            { ...fresh, targets: [refreshed], mixed: false },
            selection,
            api,
            { ledgerApi },
          );
          if (!freshPlan.valid) {
            new Notice(freshPlan.error || "That theme cannot be set on a task");
            return false;
          }
          edits.push(...freshPlan.edits);
        }
        if (!isCurrent()) return false;
        const applied = await this.writeTaskCardThemeEdits(edits, api, isCurrent);
        if (applied !== true || !isCurrent()) return false;
      }
      this.clearTaskCardThemeSubscription();
      this.taskCardThemeStageGeneration = (this.taskCardThemeStageGeneration || 0) + 1;
      this.taskCardThemeStageProjection = null;
      this.taskCardThemeStageRows = null;
      this.taskCardThemeQuery = "";
      this.taskCardThemeSelectedKey = null;
      // Theme-only edits never advance the review walk.
      this.reviewOrigin = null;
      this.reviewBeforeLine = "";
      this.reviewLineIndex = null;
      this.reviewOriginContent = null;
      this.close();
      return true;
    } finally {
      if (this.taskCardThemeCommitGeneration === commitGeneration) {
        this.taskCardThemeCommitInFlight = false;
      }
    }
  }

  async writeTaskCardThemeEdits(edits, api, isCurrent = () => true) {
    if (!isCurrent()) return false;
    if (!Array.isArray(edits) || edits.length === 0) {
      return false;
    }
    if (this.isLinkSession()) {
      return false;
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
      new Notice(taskCardThemeUnchangedNotice([edit]));
      return true;
    }
    const nextLine = this.taskCardThemeNewLineFor(lines[line], edit, api);
    if (nextLine === lines[line]) {
      new Notice(taskCardThemeUnchangedNotice([edit]));
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
    new Notice(taskCardThemeSavedNotice(edit));
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
    const unchanged = [];
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
        unchanged.push(edit);
        continue;
      }
      const nextLine = this.taskCardThemeNewLineFor(lines[line], edit, api);
      if (nextLine !== lines[line]) {
        nextLines[line] = nextLine;
        changed += 1;
      } else {
        unchanged.push(edit);
      }
    }
    if (changed === 0) {
      new Notice(skippedClosed > 0 ? `Closed tasks keep their theme history; nothing was written` : taskCardThemeUnchangedNotice(unchanged));
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

  async writeTaskCardLinkedThemeEdits(edits, api, selection, isCurrent = () => true) {
    let changed = 0;
    let skippedClosed = 0;
    const unchanged = [];
    let skippedStale = 0;
    const failures = [];
    const paths = Array.from(new Set(
      edits.map((edit) => normalizeVaultRelativePath(edit && edit.target && edit.target.identity && edit.target.identity.path || ""))
        .filter(Boolean),
    ));
    let files = null;
    try {
      files = await this.readVaultStageFiles(paths);
    } catch (_error) {
      files = null;
    }
    if (!isCurrent()) return false;
    if (!files) {
      new Notice("Could not read linked task notes; no themes were written");
      return false;
    }
    const preparedEdits = [];
    for (const edit of edits) {
      const identity = edit.target.identity;
      const targetPath = normalizeVaultRelativePath(identity.path || "");
      if (!targetPath || !Number.isInteger(identity.line)) {
        skippedStale += 1;
        new Notice("Linked task changed; reopen the card");
        return false;
      }
      if (this.isTaskCardThemeClosedLine(identity.rawLine)) {
        skippedClosed += 1;
        continue;
      }
      const freshContent = files.get(targetPath);
      if (typeof freshContent !== "string") {
        new Notice(`Could not read ${targetPath}; no themes were written`);
        return false;
      }
      const freshLines = freshContent.split(/\r?\n/);
      if (freshLines[identity.line] !== identity.rawLine || !isObsidianTaskLine(freshLines[identity.line])) {
        new Notice("Linked task changed; reopen the card");
        return false;
      }
      const freshProjection = buildTaskCardThemeProjection({
        themeApi: api,
        filePath: targetPath,
        content: freshContent,
        noteContents: new Map([[targetPath, freshContent]]),
        targets: [{
          path: targetPath,
          line: identity.line,
          rawLine: freshLines[identity.line],
          blockId: identity.blockId,
          content: freshContent,
        }],
      });
      const check = taskCardThemeRevalidateEdit(edit, freshProjection);
      if (!check.ok) {
        new Notice(check.reason || "Linked task changed; reopen the card");
        return false;
      }
      const freshPlan = planTaskCardThemeEdits(freshProjection, selection, api, {
        ledgerApi: this.getTaskCardLedgerApi(),
      });
      if (!freshPlan.valid) {
        new Notice(freshPlan.error || "That theme cannot be set on a task");
        return false;
      }
      const freshEdit = freshPlan.edits[0];
      if (freshEdit.action === "none") {
        unchanged.push(freshEdit);
        continue;
      }
      const nextLine = this.taskCardThemeNewLineFor(freshLines[identity.line], freshEdit, api);
      if (nextLine !== freshLines[identity.line]) {
        preparedEdits.push({
          path: targetPath,
          line: identity.line,
          from: freshLines[identity.line],
          text: nextLine,
          edit: freshEdit,
        });
      } else {
        unchanged.push(freshEdit);
      }
    }
    // All note reads, task preimages, and inherited defaults are validated
    // before the first guarded write. A later note failure is reported as a
    // partial result because cross-note writes cannot share one transaction.
    for (const preparation of preparedEdits) {
      if (!isCurrent()) break;
      let prepared = null;
      try {
        prepared = await this.plugin.prepareDependencyTargetNote(
          preparation.path,
          preparation,
        );
      } catch (_error) {
        prepared = null;
      }
      if (!prepared || prepared.ok !== true) {
        failures.push(preparation.path);
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
      new Notice(taskCardThemeUnchangedNotice(unchanged));
      return true;
    }
    if (failures.length > 0 || skippedStale > 0) {
      new Notice(
        `Theme saved on ${formatCountLabel(changed, "task")}${failures.length > 0 ? ` · failed in ${failures.length} note${failures.length === 1 ? "" : "s"}` : ""}${skippedStale > 0 ? ` · ${skippedStale} stale skipped` : ""}${skippedClosed > 0 ? ` · ${skippedClosed} closed skipped` : ""}`,
      );
      return changed > 0;
    }
    new Notice(
      edits.length === 1 && changed === 1 && skippedClosed === 0
        ? taskCardThemeSavedNotice(preparedEdits[0].edit)
        : `Theme saved on ${formatCountLabel(changed, "task")}${skippedClosed > 0 ? ` (${skippedClosed} closed skipped)` : ""}`,
    );
    return true;
  }

  handleTaskCardThemeKeydown(event) {
    if (!event) {
      return false;
    }
    if (event.isComposing === true || event.keyCode === 229) {
      return this.stage === "value" && this.taskCardThemeStageRows && event.key === "Enter";
    }
    if (this.stage === "value" && this.taskCardThemeStageRows && isCtrlKey(event, "d")) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat === true || this.opening || this.taskCardThemeCommitInFlight) {
        return true;
      }
      this.opening = true;
      void this.applyTaskCardThemeDefault().then((applied) => {
        if (applied === true && this.pickerOpen) {
          this.close();
        }
      }).catch(() => {
        new Notice("Could not clear the theme");
      }).finally(() => {
        this.opening = false;
      });
      return true;
    }
    if (this.stage === "value" && this.taskCardThemeStageRows && event.key === "Escape") {
      // Cancellation writes nothing and clears the stage subscription.
      this.clearTaskCardThemeStage();
      return false;
    }
    return false;
  }
}
