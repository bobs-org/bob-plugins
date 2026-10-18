// Blocks… stage picker (`docs/task-dependencies.md` §15.3–§15.5).
// Reuses the vault pool; commits through plugin.applyBlocksEdit.

class BulletPropertyPickerBlocksStageMixin extends FilteredPickerModal {
  isBlocksStage() {
    return this.blocksStage === true && this.isLocalTaskStage();
  }

  blocksStageDummyProperty() {
    return {
      kind: "property",
      property: { name: "dependsOn", values: "local_task_id" },
      currentValue: "",
    };
  }

  blocksStageParentLines() {
    if (this.isCountedSession()) {
      return this.taskSession.targets.map((target) => target.line);
    }
    return [this.cursor.line];
  }

  decorateOpenBlocksStage(stage, extras = {}) {
    const decorated = decorateBlocksVaultStage(stage, {
      sources:
        extras.sources ||
        (stage && Array.isArray(stage.sources) && stage.sources.length > 0
          ? stage.sources
          : collectBlocksStageSources(stage)),
      todayLinks: extras.todayLinks || (stage && stage.todayLinks) || [],
      dailyPath: extras.dailyPath,
    });
    if (decorated) {
      decorated.refreshOf = stage && stage.refreshOf ? stage.refreshOf : stage;
    }
    return decorated;
  }

  showBlocksStage() {
    this.stage = "value";
    this.blocksStage = true;
    this.selectedPropertyItem = this.blocksStageDummyProperty();
    this.pendingTask = null;
    this.pendingBlocks = null;
    this.clearPendingBatch();
    this.selectedIndex = 0;
    const parentLines = this.blocksStageParentLines();
    let stage = null;
    try {
      stage =
        this.plugin &&
        typeof this.plugin.buildVaultDependencyStage === "function"
          ? this.plugin.buildVaultDependencyStage({
              filePath: this.filePath,
              content: this.getEditorContent(),
              parentLines,
            })
          : null;
    } catch (_stageError) {
      stage = null;
    }
    this.blocksStageSeed = stage;
    this.vaultStage = this.decorateOpenBlocksStage(stage);
    const items = this.vaultStage
      ? planBlocksStageItemsFromVault(this.vaultStage, "")
      : [];
    this.resetLocalTaskMarks(items);
    const title =
      (this.vaultStage && this.vaultStage.title) || "\ud83e\uddf1 Blocks";
    this.applyOptions({
      items,
      title,
      headerIcon: "brick-wall",
      inputLabel: "Filter tasks",
      placeholder: "Filter tasks",
      resultsLabel: "Tasks this could block",
      emptyText: "No matching open tasks in the vault",
      footerHints: this.getBlocksStageFooterHints(),
      getSubtitle: (visibleItems, allItems) =>
        this.getBlocksStageSubtitle(visibleItems, allItems),
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderTaskValueItem(item, rowEl, query),
      openItem: (item) => this.chooseBlocksTask(item),
    });
    if (this.headerIconEl) {
      this.headerIconEl.empty();
      applyIcon(this.headerIconEl, "brick-wall");
      if (
        this.headerIconEl.children &&
        this.headerIconEl.children.length === 0
      ) {
        applyIcon(this.headerIconEl, "link");
      }
    }
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    this.applyTaskCardChrome({ wide: Boolean(this.vaultStage) });
    this.ensureBlocksConsequenceStrip();
    this.refreshBlocksConsequenceStrip();
    if (
      stage &&
      !stage.cacheReady &&
      this.plugin &&
      typeof this.plugin.refreshVaultDependencyStage === "function"
    ) {
      void this.plugin.refreshVaultDependencyStage(this, stage);
    }
    void this.refreshBlocksStageTodayLinks();
  }

  getBlocksStageFooterHints() {
    const marked = this.getMarkedCount();
    const item = (this.visibleItems || [])[this.selectedIndex];
    let verb = "block";
    if (marked > 0) {
      verb = `apply ${marked}`;
    } else if (item && item.stageSection === "current") {
      verb = "remove";
    }
    const hints = [
      { keys: ["\u2191", "\u2193"], label: "navigate" },
      { keys: ["\u21e5"], label: "mark" },
      { keys: ["\u21b5"], label: verb },
      { keys: ["esc"], label: "dismiss" },
    ];
    if (this.isCountedSession()) {
      return hints.filter((hint) => !hint.keys.includes("\u21e5"));
    }
    return hints;
  }

  getBlocksStageSubtitle(_visibleItems, _allItems) {
    const stage = this.vaultStage;
    const sources = stage && Array.isArray(stage.sources) ? stage.sources : [];
    const needsId = sources.some((source) => source && source.needsBlockId);
    const counted = this.isCountedSession();
    if (this.getMarkedCount() > 0) {
      return blocksStageSubtitle(stage, this.getMarkedTaskDiff(), {
        needsId,
        counted,
      });
    }
    return blocksStageSubtitle(stage, null, { needsId, counted });
  }

  ensureBlocksConsequenceStrip() {
    if (!this.contentEl || !this.footerEl) {
      return null;
    }
    if (
      this.consequenceStripEl &&
      this.consequenceStripEl.parentElement === this.contentEl
    ) {
      return this.consequenceStripEl;
    }
    const el = this.contentEl.createDiv({
      cls: "bob-cnp-consequence-strip",
      attr: { "aria-live": "polite" },
    });
    try {
      if (
        this.footerEl.parentElement === this.contentEl &&
        typeof this.contentEl.insertBefore === "function"
      ) {
        this.contentEl.insertBefore(el, this.footerEl);
      }
    } catch (_error) {
      // Best-effort placement between the list and the footer.
    }
    this.consequenceStripEl = el;
    return el;
  }

  refreshBlocksConsequenceStrip() {
    if (!this.isBlocksStage()) {
      if (this.consequenceStripEl) {
        this.consequenceStripEl.setText("");
      }
      return;
    }
    const el = this.ensureBlocksConsequenceStrip();
    if (!el) {
      return;
    }
    const marked = this.getMarkedTaskItems();
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const text = blocksStageConsequenceStrip(item, {
      sources: this.vaultStage && this.vaultStage.sources,
      marked,
    });
    el.empty();
    const warning = /\u26a0/.test(text);
    el.createSpan({
      cls: warning
        ? "bob-cnp-consequence-strip-text is-destructive"
        : "bob-cnp-consequence-strip-text",
      text,
    });
  }

  async refreshBlocksStageTodayLinks() {
    const stage = this.vaultStage;
    if (!stage || !this.blocksStage) {
      return;
    }
    const files = stage.files instanceof Map ? stage.files : new Map();
    let dailyPath = null;
    try {
      const listed =
        this.plugin && typeof this.plugin.readDependencyVaultFileList === "function"
          ? this.plugin.readDependencyVaultFileList()
          : [...files.keys()];
      dailyPath = scheduledRecoveryDailyPaths(
        (Array.isArray(listed) ? listed : [...files.keys()]).map((path) => ({
          path,
        })),
      ).current;
    } catch (_error) {
      dailyPath = null;
    }
    if (!dailyPath) {
      return;
    }
    let dailyContent = files.has(dailyPath) ? files.get(dailyPath) : null;
    if (dailyContent === null) {
      const open = this.getOpenTargetNoteContent(dailyPath);
      if (typeof open === "string") {
        dailyContent = open;
      } else if (
        this.plugin &&
        typeof this.plugin.readDependencyNoteContent === "function"
      ) {
        dailyContent = await this.plugin.readDependencyNoteContent(
          dailyPath,
          null,
          "",
        );
      }
    }
    // A vault pool refresh can swap the stage while the daily note loads;
    // the read still applies, to whichever stage is current now.
    const current = this.vaultStage;
    if (!current || !this.blocksStage || dailyContent === null) {
      return;
    }
    if (current.files instanceof Map) {
      current.files.set(dailyPath, dailyContent);
    }
    const todayLinks = collectBlocksStageTodayLinks(
      dailyContent,
      dailyPath,
      current.index,
    );
    const marked = this.markedLines instanceof Set ? new Set(this.markedLines) : new Set();
    this.vaultStage = this.decorateOpenBlocksStage(current, {
      sources: current.sources,
      todayLinks,
      dailyPath,
    });
    const items = planBlocksStageItemsFromVault(
      this.vaultStage,
      this.getQuery ? this.getQuery() : "",
    );
    this.resetLocalTaskMarks(items);
    for (const key of marked) {
      if (this.taskItemsByLine.has(key)) {
        this.markedLines.add(key);
      }
    }
    this.items = items;
    if (this.resultsEl) {
      this.renderResults();
    }
  }

  blocksStageSourceRefs(overrides = new Map()) {
    const sources =
      this.vaultStage && Array.isArray(this.vaultStage.sources)
        ? this.vaultStage.sources
        : [];
    return sources.map((source) => {
      const key = `${source.path}\x00${source.line}`;
      const extra = overrides.get(key) || {};
      return {
        path: source.path,
        line: source.line,
        blockId: extra.blockId || source.blockId || null,
        rawLine: typeof source.rawLine === "string" ? source.rawLine : undefined,
      };
    });
  }

  sourcesNeedingBlockId(overrides = new Map()) {
    return this.blocksStageSourceRefs(overrides).filter(
      (source) => !source.blockId,
    );
  }

  async chooseBlocksTask(item) {
    if (this.getMarkedCount() > 0) {
      return this.commitMarkedBlocks();
    }
    if (!item || item.kind === "stage-more") {
      return false;
    }
    if (item.disabled) {
      new Notice(item.disabledReason || "That task cannot be blocked");
      return false;
    }
    if (this.isCountedSession()) {
      if (item.linkState === "all" || item.stageSection === "current") {
        return this.commitBlocksEdit({ add: [], remove: [item] });
      }
      return this.commitBlocksEdit({ add: [item], remove: [] });
    }
    if (item.stageSection === "current" && item.alreadyLinked) {
      return this.commitBlocksEdit({ add: [], remove: [item] });
    }
    return this.commitBlocksEdit({ add: [item], remove: [] });
  }

  commitMarkedBlocks() {
    if (this.getMarkedCount() === 0) {
      return false;
    }
    const add = [];
    const remove = [];
    for (const item of this.getMarkedTaskItems()) {
      if (item.disabled) {
        new Notice(item.disabledReason || "That task cannot be blocked");
        return false;
      }
      if (item.alreadyLinked || item.stageSection === "current") {
        remove.push(item);
      } else {
        add.push(item);
      }
    }
    return this.commitBlocksEdit({ add, remove });
  }

  async commitBlocksEdit({ add, remove }, sourceOverrides = new Map()) {
    const missing = this.sourcesNeedingBlockId(sourceOverrides);
    if (missing.length > 0) {
      const reservedIds = new Set();
      for (const extra of sourceOverrides.values()) {
        if (extra && extra.blockId) {
          reservedIds.add(extra.blockId);
        }
      }
      this.pendingBlocks = {
        add,
        remove,
        overrides: sourceOverrides,
        queue: missing.slice(),
        reservedIds,
      };
      return this.promptNextBlocksSourceId();
    }
    const sources = this.blocksStageSourceRefs(sourceOverrides);
    const toRef = (item) => ({
      path: normalizeVaultRelativePath(item.path || ""),
      line: item.line,
      blockId: item.blockId || item.existingBlockId || null,
      rawLine: typeof item.rawLine === "string" ? item.rawLine : undefined,
    });
    // The open-time snapshot of the touched notes only (§15.6 step 1); the
    // writer reads live content and compares. A closed note the stage never
    // read has no snapshot, so its rows carry `rawLine` instead.
    const expected = new Map();
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      for (const ref of [...sources, ...add.map(toRef), ...remove.map(toRef)]) {
        const path = normalizeVaultRelativePath(ref.path || "");
        if (path && this.vaultStage.files.has(path) && !expected.has(path)) {
          expected.set(path, String(this.vaultStage.files.get(path) || ""));
        }
      }
    }
    const action = {
      label:
        add.length + remove.length > 1
          ? `edit ${add.length + remove.length} blocks`
          : add.length > 0
            ? "block 1 task"
            : "remove 1 dependent",
    };
    const write = async () => {
      const outcome = await this.plugin.applyBlocksEdit({
        sources,
        add: add.map(toRef),
        remove: remove.map(toRef),
        expected,
      });
      if (!outcome.ok) {
        if (
          outcome.reason === "changed — reopen" ||
          outcome.reason === "changed"
        ) {
          return this.refuseDependencyStale();
        }
        new Notice(
          outcome.notice ||
            `\ud83e\uddf1 Could not update Blocks (${outcome.reason})`,
        );
        return false;
      }
      if (outcome.notice) {
        new Notice(outcome.notice);
      }
      this.clearPendingBatch();
      this.pendingBlocks = null;
      return true;
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(action, write);
    }
    return await write();
  }

  promptNextBlocksSourceId() {
    const pending = this.pendingBlocks;
    if (!pending || !Array.isArray(pending.queue) || pending.queue.length === 0) {
      return this.commitBlocksEdit(
        { add: pending && pending.add, remove: pending && pending.remove },
        pending && pending.overrides,
      );
    }
    const source = pending.queue[0];
    const snapshot = {
      path: source.path,
      line: source.line,
      rawLine: null,
      displayText: source.displayText || source.path,
      existingIdField: source.idField || null,
      blockId: null,
    };
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      const content = this.vaultStage.files.get(
        normalizeVaultRelativePath(source.path),
      );
      if (typeof content === "string" && Number.isInteger(source.line)) {
        snapshot.rawLine = String(content.split(/\r?\n/)[source.line] || "");
        snapshot.displayText = cleanTaskDisplayText(snapshot.rawLine);
        snapshot.existingIdField =
          (findBulletPropertyField(snapshot.rawLine, "id") || {}).value || null;
      }
    }
    this.showBlockIdStage(snapshot, { mode: "blocks-source" });
    return false;
  }

  async confirmBlocksSourceBlockId(item) {
    const pending = this.pendingBlocks;
    if (!pending || !item || !item.valid) {
      return false;
    }
    const source = pending.queue[0];
    if (!source) {
      return false;
    }
    const targetPath = normalizeVaultRelativePath(source.path || "");
    const files =
      this.vaultStage && this.vaultStage.files instanceof Map
        ? this.vaultStage.files
        : new Map();
    const content = files.get(targetPath) || "";
    const validation = validateBlockIdCandidate(item.id, content, {
      reservedIds: pending.reservedIds || new Set(),
    });
    if (!validation.valid) {
      new Notice(validation.message || "That block ID cannot be used");
      return false;
    }
    pending.reservedIds.add(validation.id);
    pending.overrides.set(`${source.path}\x00${source.line}`, {
      blockId: validation.id,
    });
    pending.queue.shift();
    if (pending.queue.length > 0) {
      return this.promptNextBlocksSourceId();
    }
    const add = pending.add;
    const remove = pending.remove;
    const overrides = pending.overrides;
    this.pendingBlocks = null;
    this.clearPendingBatch();
    return this.commitBlocksEdit({ add, remove }, overrides);
  }
}
