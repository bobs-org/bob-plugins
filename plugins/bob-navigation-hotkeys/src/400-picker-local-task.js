class BulletPropertyPickerLocalTaskMixin extends FilteredPickerModal {
  rerollPriorityDateSuggestion() {
    const rollIndex = this.items.findIndex((item) => item.priorityRoll);
    if (rollIndex === -1) {
      return false;
    }

    const previous = this.items[rollIndex];
    // The pinned row mirrors the card's recommendation for a roll, so
    // Ctrl+R re-rolls both together and keeps the shared date in sync.
    const shared =
      this.selectedPropertyItem && this.selectedPropertyItem.property
        ? this.getScheduledRollRecommendation(
            this.selectedPropertyItem.property.name,
          )
        : null;
    if (
      shared &&
      shared.kind === "roll" &&
      previous.level &&
      shared.level &&
      normalizeBulletPropertyValue(previous.level.label) ===
        normalizeBulletPropertyValue(shared.level.label)
    ) {
      if (!this.rerollPriorityRollRecommendation()) {
        return false;
      }
      const next = this.priorityRollRecommendation;
      const nextItems = [...this.items];
      nextItems[rollIndex] =
        createPriorityRollDateItemFromRecommendation(
          next,
          this.selectedPropertyItem.currentValue || "",
        ) ||
        createPriorityRollDateItem(
          previous.level,
          this.valueBaseDate,
          this.selectedPropertyItem.currentValue || "",
          this.priorityRandom,
        );
      this.applyOptions({ items: nextItems });
      this.selectedIndex = rollIndex;
      if (this.resultsEl) {
        this.renderAll({ clearQuery: true });
      }
      return true;
    }

    const nextItems = [...this.items];
    nextItems[rollIndex] = createPriorityRollDateItem(
      previous.level,
      this.valueBaseDate,
      this.selectedPropertyItem.currentValue || "",
      this.priorityRandom,
    );
    this.applyOptions({ items: nextItems });
    this.selectedIndex = rollIndex;
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    return true;
  }

  clearLocalTaskMarks() {
    if (!this.markedLines) {
      this.markedLines = new Set();
    } else {
      this.markedLines.clear();
    }

    if (!this.taskItemsByLine) {
      this.taskItemsByLine = new Map();
    } else {
      this.taskItemsByLine.clear();
    }
  }

  resetLocalTaskMarks(items) {
    this.markedLines = new Set();
    this.taskItemsByLine = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const key = bulletPropertyTaskMarkKey(item);
      if (key !== null) {
        this.taskItemsByLine.set(key, item);
      }
    });
  }

  clearPendingBatch() {
    this.pendingBatch = null;
    this.pendingCountedDependency = null;
    this.pendingVaultSingle = null;
    this.pendingVaultCounted = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
    this.pendingScheduleReason = null;
    this.pendingScheduleReview = null;
    this.pendingCancel = null;
    this.pendingLaneRelease = null;
    this.pendingScheduleWorkLog = null;
  }

  isScheduledValueStage() {
    return Boolean(
      this.stage === "value" &&
        this.selectedPropertyItem &&
        this.selectedPropertyItem.property &&
        this.selectedPropertyItem.property.values === "date" &&
        normalizeBulletPropertyName(this.selectedPropertyItem.property.name) ===
          "scheduled",
    );
  }

  isLocalTaskStage() {
    return (
      this.stage === "value" &&
      this.selectedPropertyItem &&
      this.selectedPropertyItem.property &&
      this.selectedPropertyItem.property.values === "local_task_id"
    );
  }

  getMarkedCount() {
    return this.markedLines ? this.markedLines.size : 0;
  }

  getMarkedTaskItems() {
    if (!this.markedLines || !this.taskItemsByLine) {
      return [];
    }

    return Array.from(this.markedLines)
      .map((line) => this.taskItemsByLine.get(line))
      .filter(Boolean);
  }

  getMarkedTaskDiff() {
    return this.getMarkedTaskItems().reduce(
      (counts, item) => {
        if (item.alreadyLinked) {
          counts.remove += 1;
        } else if (item.needsPromptForAdd) {
          counts.needId += 1;
        } else {
          counts.add += 1;
        }
        return counts;
      },
      { add: 0, needId: 0, remove: 0 },
    );
  }

  getLocalTaskFooterHints() {
    if (this.isCountedSession()) {
      return BULLET_PROPERTY_LOCAL_TASK_HINTS.filter(
        (hint) => !hint.keys.includes("⇥"),
      );
    }
    // The vault-wide Depends on stage footer per the design:
    // `↑↓ navigate · ⇥ mark · ↵ toggle · esc dismiss`, with ↵ reading
    // `apply N` when rows are marked.
    if (this.vaultStage) {
      const marked = this.getMarkedCount();
      return [
        { keys: ["↑", "↓"], label: "navigate" },
        { keys: ["⇥"], label: "mark" },
        { keys: ["↵"], label: marked > 0 ? `apply ${marked}` : "toggle" },
        { keys: ["esc"], label: "dismiss" },
      ];
    }
    const hints = getBulletPropertyLocalTaskHints(this.getMarkedCount() > 0);
    return hints;
  }

  refreshLocalTaskFooter() {
    if (!this.isLocalTaskStage()) {
      return;
    }

    this.footerHints = this.getLocalTaskFooterHints();
    this.renderFooter();
  }

  getLocalTaskSubtitle(visibleItems, allItems) {
    const countText =
      visibleItems.length === allItems.length
        ? ""
        : `Showing ${visibleItems.length} of ${allItems.length} · `;
    if (this.getMarkedCount() === 0) {
      return this.isCountedSession()
        ? `${countText}${this.getTaskSessionSubtitle()} · choose a dependency`
        : `${countText}Choose a task dependency · ⇥ to mark several`;
    }

    const diff = this.getMarkedTaskDiff();
    const parts = [];
    if (diff.add > 0) {
      parts.push(`${diff.add} to add`);
    }
    if (diff.needId > 0) {
      parts.push(`${diff.needId} ${diff.needId === 1 ? "needs ID" : "need IDs"}`);
    }
    if (diff.remove > 0) {
      parts.push(`${diff.remove} to remove`);
    }
    parts.push("↵ to apply");
    return `${countText}${parts.join(" · ")}`;
  }

  toggleHighlightedLocalTaskMark() {
    const item = this.visibleItems[this.selectedIndex];
    if (!item || item.kind !== "local-task") {
      return;
    }
    if (item.disabled) {
      new Notice(item.disabledReason || "That task cannot be linked");
      return;
    }
    const key = bulletPropertyTaskMarkKey(item);
    if (key === null) {
      return;
    }

    // Block-ID-less tasks can now be marked; their block IDs are collected via
    // sequential prompts when the batch is applied.
    if (this.markedLines.has(key)) {
      this.markedLines.delete(key);
    } else {
      this.markedLines.add(key);
    }

    this.refreshLocalTaskFooter();
    this.moveSelection(1);
  }

  // Vault-wide Depends on stage (nav-stage, `docs/task-dependencies.md`
  // §6): the CURRENT / RESULTS / BLOCKED layout over the vault-wide pool.
  // Ranking and guards come from `planDependencyStageView`; the commit
  // paths below write through the single-transaction writer, so one gesture
  // still commits the line, the field, target ids, status effects, legacy
  // folding, and the freshness stamp in one transaction.
  showLocalTaskValueStage(propertyItem) {
    this.stage = "value";
    this.selectedPropertyItem = propertyItem;
    this.pendingTask = null;
    this.clearPendingBatch();
    this.selectedIndex = 0;
    const property = propertyItem.property;
    const dependencyValueSets = this.isCountedSession()
      ? propertyItem.sourceStates.map(
          (state) => new Set(parseLocalTaskIdList(state.value)),
        )
      : [
          new Set(
            parseLocalTaskIdList(this.getCurrentPropertyValue(property.name)),
          ),
        ];
    const parentLines = this.isCountedSession()
      ? this.taskSession.targets.map((target) => target.line)
      : [this.cursor.line];
    // The vault pool is best-effort: anything unexpected falls back to the
    // current-note stage rather than refusing to open.
    let stage = null;
    try {
      stage =
        this.plugin &&
        typeof this.plugin.buildVaultDependencyStage === "function"
          ? this.plugin.buildVaultDependencyStage({
              filePath: this.filePath,
              content: this.getEditorContent(),
              parentLines,
              dependencyValueSets: this.isCountedSession()
                ? dependencyValueSets
                : null,
            })
          : null;
    } catch (_stageError) {
      stage = null;
    }
    this.vaultStage = stage;
    const items = stage
      ? planDependencyStageView({
          current: stage.current,
          candidates: stage.candidates,
          query: "",
          dependent: stage.dependent,
          edges: stage.edges,
          linkedKeys: stage.linkedKeys,
          sourceValueSets: stage.sourceValueSets,
        })
      : createBulletPropertyLocalTaskItems(this.getEditorContent(), {
          excludeLine: this.isCountedSession() ? null : this.cursor.line,
          excludeLines: this.isCountedSession()
            ? new Set(this.taskSession.targets.map((target) => target.line))
            : new Set(),
          dependencyValues: dependencyValueSets[0],
          dependencyValueSets,
          filePath: this.filePath,
        });
    this.resetLocalTaskMarks(items);

    this.applyOptions({
      items,
      title: stage ? stage.title : property.name,
      headerIcon: "link",
      inputLabel: "Filter tasks",
      placeholder: "Filter tasks",
      resultsLabel: "Depends on candidates",
      emptyText: stage ? "No matching tasks in the vault" : "No open tasks in this file",
      footerHints: this.getLocalTaskFooterHints(),
      getSubtitle: (visibleItems, allItems) =>
        this.vaultStage
          ? this.getVaultStageSubtitle(visibleItems, allItems)
          : this.getLocalTaskSubtitle(visibleItems, allItems),
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderTaskValueItem(item, rowEl, query),
      openItem: (item) => this.chooseTaskDependency(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    this.applyTaskCardChrome({ wide: Boolean(this.vaultStage) });
    if (
      stage &&
      !stage.cacheReady &&
      this.plugin &&
      typeof this.plugin.refreshVaultDependencyStage === "function"
    ) {
      void this.plugin.refreshVaultDependencyStage(this, stage);
    }
  }

  // Swap in the vault-scan pool, keeping marks across the refresh: mark keys
  // are stable (`path#line`), so marked rows survive the pool replacement.
  applyVaultStageItems(stage) {
    if (!stage || this.vaultStage !== stage.refreshOf) {
      return;
    }
    const marked = this.markedLines instanceof Set
      ? new Set(this.markedLines)
      : new Set();
    this.vaultStage = stage;
    const items = planDependencyStageView({
      current: stage.current,
      candidates: stage.candidates,
      query: this.getQuery(),
      dependent: stage.dependent,
      edges: stage.edges,
      linkedKeys: stage.linkedKeys,
      sourceValueSets: stage.sourceValueSets,
    });
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

  getVaultStageSubtitle(visibleItems, allItems) {
    const stage = this.vaultStage;
    if (!stage) {
      return this.getLocalTaskSubtitle(visibleItems, allItems);
    }
    const countText =
      visibleItems.length === allItems.length
        ? ""
        : `Showing ${visibleItems.length} of ${allItems.length} · `;
    const head = `${countText}${stage.current.length} prerequisite${stage.current.length === 1 ? "" : "s"} · ${stage.openCount} open · searching ${stage.poolSize} open tasks`;
    if (this.getMarkedCount() === 0) {
      return `${head} · ⇥ to mark several`;
    }
    const diff = this.getMarkedTaskDiff();
    const parts = [];
    if (diff.add > 0) {
      parts.push(`${diff.add} to add`);
    }
    if (diff.needId > 0) {
      parts.push(`${diff.needId} ${diff.needId === 1 ? "needs ID" : "need IDs"}`);
    }
    if (diff.remove > 0) {
      parts.push(`${diff.remove} to remove`);
    }
    parts.push("↵ to apply");
    return `${head} · ${parts.join(" · ")}`;
  }

  // The note whose content seeds `+ id` suggestions and uniqueness checks:
  // the target's own note for vault-wide rows, else the dependent's note.
  getBlockIdStageContent() {
    const task = this.pendingTask;
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const targetPath = normalizeVaultRelativePath(
      (task && task.path) || ownerPath,
    );
    if (
      targetPath &&
      targetPath !== ownerPath &&
      this.vaultStage &&
      this.vaultStage.files instanceof Map &&
      this.vaultStage.files.has(targetPath)
    ) {
      return String(this.vaultStage.files.get(targetPath) || "");
    }
    return this.getEditorContent();
  }

  // Reserved block IDs chosen earlier in the current batch prompt sequence, so
  // suggestions and validation avoid colliding with them before any write.
  getBlockIdReservedIds() {
    if (this.blockIdMode === "batch" && this.pendingBatch) {
      return this.pendingBatch.reservedIds;
    }
    if (this.blockIdMode === "vault-single" && this.pendingVaultSingle) {
      return this.pendingVaultSingle.reservedIds || new Set();
    }
    if (this.blockIdMode === "vault-counted" && this.pendingVaultCounted) {
      return this.pendingVaultCounted.reservedIds || new Set();
    }
    return new Set();
  }

  // Render the block-ID prompt for one task. Serves both the single-task flow
  // (mode "single") and each step of a batch (mode "batch"), which only differ
  // in the subtitle/footer wording and the reserved-ID set.
  showBlockIdStage(task, options = {}) {
    this.stage = "blockid";
    this.pendingTask = task;
    this.blockIdMode = [
      "batch",
      "counted-source",
      "vault-single",
      "vault-counted",
    ].includes(options.mode)
      ? options.mode
      : "single";
    this.blockIdContext =
      this.blockIdMode === "batch"
        ? {
            position: Math.max(1, Math.floor(options.position || 1)),
            total: Math.max(1, Math.floor(options.total || 1)),
          }
        : null;
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    const reservedIds = this.getBlockIdReservedIds();
    // Prefill with the existing `[id::]` value when present (confirmation
    // replaces it with the canonical path-qualified ID); otherwise suggest a slug that avoids existing and
    // reserved block IDs in the target's own note.
    const suggestedId = task.existingIdField
      ? normalizeBulletPropertyValue(task.existingIdField)
      : suggestBlockIdFromTask(task.displayText, this.getBlockIdStageContent(), {
          reservedIds,
        });
    const isLast =
      this.blockIdMode !== "batch" ||
      this.blockIdContext.position >= this.blockIdContext.total;

    this.applyOptions({
      items: [],
      title: "New block ID",
      headerIcon: "hash",
      inputLabel: "Block ID",
      placeholder: "Block ID - letters, numbers, hyphens",
      resultsLabel: "Block ID preview",
      emptyText: "Type a block ID",
      footerHints: getBulletPropertyBlockIdHints({
        batch: this.blockIdMode === "batch",
        last: isLast,
        counted: this.blockIdMode === "counted-source",
      }),
      getSubtitle: () =>
        this.blockIdMode === "batch"
          ? `Block ID ${this.blockIdContext.position} of ${this.blockIdContext.total} · line ${task.line + 1}`
          : this.blockIdMode === "counted-source"
            ? `${this.getTaskSessionSubtitle()} · create an ID for dependency on line ${task.line + 1}`
            : `Create an ID for line ${task.line + 1}`,
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderBlockIdPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmBlockId(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
      if (this.inputEl) {
        this.inputEl.value = suggestedId;
        this.inputEl.select();
      }
      this.renderResults();
    }
  }

}
