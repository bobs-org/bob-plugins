class BulletPropertyPickerTaskCardMixin extends FilteredPickerModal {
  applyTaskCardChrome(options = {}) {
    if (!this.modalEl) {
      return;
    }
    const add =
      typeof this.modalEl.addClass === "function"
        ? (name) => this.modalEl.addClass(name)
        : () => {};
    const remove =
      typeof this.modalEl.removeClass === "function"
        ? (name) => this.modalEl.removeClass(name)
        : () => {};
    if (this.hasTaskCard) {
      add("bob-task-card-modal");
      if (options.wide) {
        add("bob-task-card-wide");
      } else {
        remove("bob-task-card-wide");
      }
    } else {
      remove("bob-task-card-modal");
      remove("bob-task-card-wide");
    }
  }

  getTaskCardFreshnessApi() {
    if (this.plugin && typeof this.plugin.getFreshnessApi === "function") {
      return this.plugin.getFreshnessApi();
    }
    return getReviewFreshnessApi(this.app);
  }

  buildTaskCardContext() {
    return {
      config: this.config,
      content: this.getEditorContent(),
      lineText: this.lineText,
      cursorLine: this.cursor ? this.cursor.line : 0,
      filePath: this.filePath,
      inboxRoute: this.inboxRoute || null,
      propertyContext: this.propertyContext,
      taskSession: this.taskSession,
      linkSession: this.linkSession,
      baseDate: this.fixedValueBaseDate || this.valueBaseDate,
      random: this.priorityRandom,
      freshnessApi: this.getTaskCardFreshnessApi(),
      frozenRecommendation: this.getTaskCardFrozenRecommendation(),
      selectedRowId: this.taskCardSelectedRowId,
    };
  }

  showTaskCard(options = {}) {
    this.stage = "task-card";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    if (typeof this.clearPendingBatch === "function") {
      this.clearPendingBatch();
    }
    if (options.rebuild === true || !this.taskCardModel) {
      this.taskCardModel = planTaskCard(this.buildTaskCardContext());
      this.taskCardSelectedRowId =
        this.taskCardModel.selectedRowId || "schedule";
    } else if (this.taskCardSelectedRowId) {
      this.taskCardModel = Object.freeze({
        ...this.taskCardModel,
        selectedRowId: this.taskCardSelectedRowId,
      });
    }
    this.applyTaskCardChrome({ wide: false });
    if (this.pickerOpen && this.contentEl && this.modalEl) {
      this.contentEl.empty();
      this.modalEl.addClass("bob-cnp-modal");
      this.contentEl.addClass("bob-cnp");
      this.renderTaskCard();
    }
  }

  renderTaskCard() {
    if (!this.contentEl || !this.taskCardModel) {
      return;
    }
    this.contentEl.empty();
    this.contentEl.addClass("bob-cnp");
    this.contentEl.addClass("bob-task-card-root");
    this.contentEl.setAttribute("tabindex", "-1");
    this.modalEl.addClass("bob-cnp-modal");
    this.applyTaskCardChrome({ wide: false });
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-labelledby", "bob-task-card-title");
    const rendered = renderTaskCardView(this.contentEl, this.taskCardModel, {
      app: this.app,
      onClose: () => this.close(),
      onSelectRow: (rowId) => {
        this.taskCardSelectedRowId = rowId;
        this.taskCardModel = Object.freeze({
          ...this.taskCardModel,
          selectedRowId: rowId,
        });
        this.renderTaskCard();
      },
      onOpenRow: (rowId) => {
        const row = (this.taskCardModel && this.taskCardModel.rows || []).find((item) => item.id === rowId);
        void this.dispatchTaskCardIntent(taskCardIntentForRow(row));
      },
      onSelectPriority: (level) => {
        void this.dispatchTaskCardIntent({ type: "set-priority", key: level && level.key, value: level && level.value });
      },
      onClearPriority: () => {
        void this.dispatchTaskCardIntent({ type: "clear-priority" });
      },
      onApplyRecommendation: () => {
        void this.dispatchTaskCardIntent({ type: "apply-recommendation" });
      },
      onRefreshPreviews: () => this.refreshTaskCardPreviews(),
      onOpenProperty: (propertyName) => {
        void this.dispatchTaskCardIntent({ type: "open-property", propertyName });
      },
      onFocusList: (listEl) => {
        this.taskCardListEl = listEl;
        if (listEl && typeof listEl.focus === "function") {
          listEl.focus();
        }
      },
    });
    this.taskCardListEl = rendered && rendered.listEl;
    this.inputEl = null;
    this.resultsEl = null;
    this.headerEl = null;
    this.headerIconEl = null;
    this.titleEl = null;
    this.subtitleEl = null;
    this.footerEl = null;
  }

  getTaskCardFrozenRecommendation() {
    const baseDate = this.valueBaseDate instanceof Date
      ? this.valueBaseDate
      : getLocalDateStart(new Date());
    if (this.linkSession && this.linkSession.kind === "task-link") {
      const source = this.linkRollBatch;
      if (!source) {
        return null;
      }
      return Object.freeze({
        kind: "batch",
        source,
        preview: buildLinkRollPreviewModel(source, baseDate),
        available: source.actionableCount > 0 && !source.unavailableReason,
        unavailableReason: source.unavailableReason || null,
        effects: source.counts,
        targetCount: source.total,
        actionableCount: source.actionableCount,
        skippedCount: source.skippedCount,
      });
    }
    if (this.isCountedSession()) {
      const source = this.countedRollBatch;
      if (!source) {
        return null;
      }
      return Object.freeze({
        kind: "batch",
        source,
        preview: buildBatchPriorityRollPreviewModel(source),
        available: source.actionableCount > 0 && !source.unavailableReason,
        unavailableReason: source.unavailableReason || null,
        effects: source.counts,
        targetCount: source.total,
        actionableCount: source.actionableCount,
        skippedCount: source.skippedCount,
      });
    }
    const source = this.priorityRollRecommendation;
    if (!source) {
      return null;
    }
    const preview = buildPriorityRollPreviewModel(source, baseDate);
    const available = source.kind !== "unavailable" && Boolean(source.date || source.kind === "cancel");
    return Object.freeze({
      kind: "single",
      source,
      preview,
      available,
      unavailableReason: source.kind === "unavailable" ? source.reason || "Recommendation is unavailable" : null,
      effects: Object.freeze({
        roll: source.kind === "roll" ? 1 : 0,
        decay: source.kind === "decay" ? 1 : 0,
        cancel: source.kind === "cancel" ? 1 : 0,
      }),
      targetCount: 1,
      actionableCount: available ? 1 : 0,
      skippedCount: 0,
    });
  }

  getTaskCardPropertyItems() {
    if (this.isLinkSession()) {
      const aggregate = createLinkPickerPropertyItems(this.config, this.linkSession.resolved);
      return aggregate.valid ? aggregate.items : [];
    }
    if (this.isCountedSession()) {
      const aggregate = createCountedBulletPropertyItems(this.config, this.getEditorContent(), this.taskSession);
      return aggregate.valid ? aggregate.items : [];
    }
    return createBulletPropertyItems(this.config, this.lineText, this.propertyContext);
  }

  getTaskCardPropertyItem(propertyName) {
    const normalized = normalizeBulletPropertyName(propertyName);
    return this.getTaskCardPropertyItems().find(
      (item) => item && item.property && normalizeBulletPropertyName(item.property.name) === normalized,
    ) || null;
  }

  // Swaps the card for the filtered-picker chrome a value, reason, or review
  // stage paints into. The caller opens that stage in the same synchronous
  // step; `openTaskCardStage` returns to the card when nothing took over.
  ensureTaskCardStageChrome() {
    if (this.stage !== "task-card") {
      return;
    }
    this.stage = TASK_CARD_PENDING_STAGE;
    this.applyOptions(taskCardNeutralStageOptions());
    FilteredPickerModal.prototype.onOpen.call(this);
    this.applyTaskCardChrome({ wide: false });
  }

  openTaskCardStage(open) {
    this.ensureTaskCardStageChrome();
    try {
      open();
    } finally {
      if (this.pickerOpen && this.stage === TASK_CARD_PENDING_STAGE) {
        this.returnToTaskCard();
      }
    }
  }

  // Where a refused or stale stage lands: back on the card, or closed when
  // this modal was opened straight into a stage and never had a card.
  returnHome(options = {}) {
    if (this.hasTaskCard) {
      this.returnToTaskCard(options);
    } else if (this.pickerOpen) {
      this.close();
    }
  }

  selectTaskCardRow(rowId) {
    this.taskCardSelectedRowId = rowId;
    if (this.taskCardModel) {
      this.taskCardModel = Object.freeze({ ...this.taskCardModel, selectedRowId: rowId });
    }
    this.renderTaskCard();
  }

  returnToTaskCard(options = {}) {
    this.pendingScheduleReason = null;
    this.pendingScheduleReview = null;
    this.pendingCancel = null;
    this.pendingLaneRelease = null;
    this.pendingScheduleWorkLog = null;
    this.pendingTask = null;
    this.pendingBatch = null;
    this.pendingVaultSingle = null;
    this.pendingVaultCounted = null;
    this.pendingCountedDependency = null;
    this.scheduleReviewFormEl = null;
    this.scheduleReviewReasonEl = null;
    this.scheduleReviewSummaryEl = null;
    this.clearLocalTaskMarks();
    this.showTaskCard(options.rebuild === true ? { rebuild: true } : {});
  }

  handleTaskCardKeydown(event) {
    if (!event) {
      return;
    }
    const stop = () => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
    };
    if (event.isComposing === true || event.keyCode === 229) {
      stop();
      return;
    }
    if (this.linkResolving) {
      stop();
      if (isTaskCardCloseKeydown(event)) this.close();
      return;
    }
    const model = this.taskCardModel;
    const intent = resolveTaskCardKey(model, event);
    if (!intent) {
      return;
    }
    stop();
    if (intent.type === "ignored") {
      return;
    }
    if (intent.type === "move-selection") {
      const rows = orderedTaskCardRows(model);
      if (rows.length === 0) return;
      const current = rows.findIndex((row) => row.id === this.taskCardSelectedRowId);
      const delta = intent.direction === "previous" ? -1 : 1;
      const next = (Math.max(0, current) + delta + rows.length) % rows.length;
      this.selectTaskCardRow(rows[next].id);
      return;
    }
    if (intent.type === "back") {
      this.returnToTaskCard();
      return;
    }
    void this.dispatchTaskCardIntent(intent).catch(() => {
      new Notice("Could not apply Task Card action");
    });
  }

  async dispatchTaskCardIntent(intent) {
    if (!intent) return false;
    if (intent.type === "unavailable") {
      if (intent.reason) new Notice(intent.reason);
      return false;
    }
    if (intent.type === "close-card") {
      this.close();
      return true;
    }
    if (this.linkResolving || this.taskCardDispatching || this.opening) {
      return false;
    }
    this.taskCardDispatching = true;
    try {
      let result = false;
      if (intent.type === "refresh-previews") {
        this.refreshTaskCardPreviews();
      } else if (intent.type === "apply-recommendation") {
        result = await this.applyTaskCardRecommendation();
      } else if (intent.type === "set-priority") {
        const level = this.taskCardModel.priorityStrip.levels.find((item) =>
          intent.key ? item.key === intent.key : item.value === intent.value,
        );
        result = await this.commitTaskCardPriority(level);
      } else if (intent.type === "clear-priority") {
        result = await this.clearTaskCardPriority();
      } else if (intent.type === "delete-property") {
        result = await this.deleteTaskCardProperty(intent.propertyName);
      } else if (intent.type === "open-action") {
        result = await this.openTaskCardAction(intent.rowId, intent.action);
      } else if (intent.type === "open-property") {
        result = await this.openTaskCardProperty(intent.propertyName);
      }
      if (result === true && this.pickerOpen) this.close();
      return result;
    } finally {
      this.taskCardDispatching = false;
    }
  }

  async openTaskCardAction(rowId, action) {
    if (action === "schedule" || rowId === "schedule") {
      const scheduleRow = (this.taskCardModel && this.taskCardModel.rows || []).find((row) => row.id === "schedule");
      const item = this.getTaskCardPropertyItem(scheduleRow && scheduleRow.propertyName || "scheduled");
      if (!item) {
        new Notice("Schedule is not configured");
        return false;
      }
      this.valueBaseDate = this.fixedValueBaseDate || this.valueBaseDate;
      this.openTaskCardStage(() => this.showValueStage(item));
      return false;
    }
    this.refreshPropertyItems();
    const findItem = (predicate) =>
      this.propertyItems.find((candidate) => candidate && predicate(candidate));
    if (rowId === "depends-on" || action === "dependencies") {
      const item = findItem((candidate) => candidate.property && candidate.property.values === "local_task_id");
      if (item) this.openTaskCardStage(() => this.showValueStage(item));
      return false;
    }
    if (rowId === "review-every" || action === "refresh") {
      const item = findItem((candidate) => candidate.kind === "refresh-interval");
      if (item) this.openTaskCardStage(() => this.showRefreshValueStage(item));
      return false;
    }
    if (rowId === "cancel" || action === "cancel") {
      const item = findItem((candidate) => candidate.kind === "cancel-task");
      if (item) this.openTaskCardStage(() => this.showCancelReasonStage(item));
      return false;
    }
    if (rowId === "lane" || action === "toggle-lane") {
      const item = findItem((candidate) => candidate.kind === "lane-toggle");
      if (!item) return false;
      if (item.needsReason) {
        this.openTaskCardStage(() => this.showLaneReleaseReasonStage(item));
        return false;
      }
      this.ensureTaskCardStageChrome();
      const applied = await this.applyInboxRoutedLaneToggle();
      if (applied !== true && this.pickerOpen && this.stage === TASK_CARD_PENDING_STAGE) {
        this.returnHome({ rebuild: true });
      }
      return applied;
    }
    return false;
  }

  // A More-section row opens that property's existing value stage; the
  // `scheduled` property takes the same schedule commit path as its card row.
  async openTaskCardProperty(propertyName) {
    this.refreshPropertyItems();
    const wanted = normalizeBulletPropertyName(propertyName);
    const item = this.propertyItems.find(
      (candidate) =>
        candidate &&
        candidate.kind === "property" &&
        candidate.property &&
        normalizeBulletPropertyName(candidate.property.name) === wanted,
    );
    if (!item) {
      new Notice(`${propertyName || "Property"} is not available`);
      return false;
    }
    this.openTaskCardStage(() => this.showValueStage(item));
    return false;
  }

  taskCardPrecomputedPriorityOptions(level) {
    const previews = Array.isArray(level && level.targetPreviews) ? level.targetPreviews : [];
    const byPath = new Map();
    const byLine = new Map();
    const scheduledByLine = new Map();
    for (const preview of previews) {
      const roll = Object.freeze({ date: preview.date, offset: preview.offset });
      if (this.isLinkSession()) {
        const path = normalizeVaultRelativePath(preview.path || "");
        if (!byPath.has(path)) byPath.set(path, { rollByLine: new Map(), scheduledValueByLine: new Map() });
        byPath.get(path).rollByLine.set(preview.line, roll);
        byPath.get(path).scheduledValueByLine.set(preview.line, preview.date);
      } else {
        byLine.set(preview.line, roll);
        scheduledByLine.set(preview.line, preview.date);
      }
    }
    for (const [path, value] of byPath) byPath.set(path, Object.freeze(value));
    const first = previews[0];
    return {
      precomputedRoll: first ? Object.freeze({ date: first.date, offset: first.offset }) : null,
      precomputedRollByLine: byLine,
      precomputedScheduledValueByLine: scheduledByLine,
      precomputedByPath: byPath,
      scheduleSummary: formatSchedulingWorkLogDateSpan(previews.map((item) => item.date)),
    };
  }

  async commitTaskCardPriority(level) {
    if (!level || !level.available || this.linkResolving || this.opening) {
      if (level && level.unavailableReason) new Notice(level.unavailableReason);
      return false;
    }
    const item = this.getTaskCardPropertyItem(this.taskCardModel && this.taskCardModel.priorityStrip && this.taskCardModel.priorityStrip.propertyName);
    if (!item) {
      new Notice("Priority is not configured");
      return false;
    }
    const valueItem = createBulletPropertyValueItems(item, this.valueBaseDate).find(
      (entry) => entry.value === level.value,
    );
    if (!valueItem) {
      new Notice("Priority level is not configured");
      return false;
    }
    this.selectedPropertyItem = item;
    const previewOptions = this.taskCardPrecomputedPriorityOptions(level);
    return await this.maybeOfferPriorityWorkLog(valueItem, previewOptions);
  }

  async clearTaskCardPriority() {
    const name = this.taskCardModel && this.taskCardModel.priorityStrip && this.taskCardModel.priorityStrip.propertyName;
    return await this.deleteTaskCardProperty(name);
  }

  async deleteTaskCardProperty(propertyName) {
    if (!propertyName) {
      new Notice("This action has no deletable property");
      return false;
    }
    if (!this.isLinkSession() && !this.isCountedSession()) {
      const item = this.getTaskCardPropertyItem(propertyName);
      if (!item || item.kind !== "property" || !item.defined) {
        new Notice(
          item && item.target && item.target.kind === "project-frontmatter"
            ? `${propertyName} is not set on this project`
            : `${propertyName} is not set on this bullet`,
        );
        return false;
      }
    }
    this.refreshPropertyItems();
    const item = this.propertyItems.find(
      (candidate) =>
        candidate &&
        candidate.kind === "property" &&
        candidate.property &&
        candidate.property.name === propertyName,
    );
    if (!item) {
      new Notice(`${propertyName} is not a deletable property`);
      this.returnToTaskCard({ rebuild: true });
      return false;
    }
    this.ensureTaskCardStageChrome();
    const deleted = await this.deletePropertyItem(item);
    if (deleted !== true && this.pickerOpen) {
      this.returnToTaskCard({ rebuild: true });
    }
    return deleted;
  }

  async applyTaskCardRecommendation() {
    if (!this.taskCardModel || !this.taskCardModel.recommendation || !this.taskCardModel.recommendation.available) {
      new Notice(this.taskCardModel?.recommendation?.unavailableReason || "No recommendation is available");
      return false;
    }
    if (this.isLinkSession()) return await this.applyLinkRecommendedRoll();
    if (this.isCountedSession()) return await this.applyCountedRecommendedRoll();
    return await this.applyRecommendedRoll();
  }

  refreshTaskCardPreviews() {
    if (this.linkSession && this.linkSession.kind === "task-link") {
      this.refreshLinkRollBatch();
    } else if (this.isCountedSession()) {
      this.refreshCountedRollBatch();
    } else {
      this.refreshPriorityRollRecommendation();
    }
    this.showTaskCard({ rebuild: true });
  }

  // Ctrl+[ closes the modal from any focused element inside it. The date,
  // filter, reason, and Work summary fields reach `handleKeydown`; this
  // catches the rest (the Back button, a card row) as the event bubbles.
  bindCloseChord() {
    if (
      this.closeChordBound ||
      !this.modalEl ||
      typeof this.modalEl.addEventListener !== "function"
    ) {
      return;
    }
    this.closeChordBound = true;
    if (!this.taskCardKeyRouterBound && this.contentEl) {
      this.taskCardKeyRouterBound = true;
      this.contentEl.addEventListener("keydown", (event) => {
        if (
          this.stage === "task-card" &&
          !(event && event.defaultPrevented)
        ) {
          this.handleTaskCardKeydown(event);
        }
      });
    }
    this.modalEl.addEventListener("keydown", (event) => {
      if (
        !event ||
        event.isComposing === true ||
        event.keyCode === 229 ||
        !isCtrlLeftBracketKeydown(event)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  onOpen() {
    this.bindCloseChord();
    if (this.stage === "task-card") {
      this.contentEl.empty();
      this.modalEl.addClass("bob-cnp-modal");
      this.contentEl.addClass("bob-cnp");
      this.applyTaskCardChrome({ wide: false });
      this.renderTaskCard();
      const openingList = this.taskCardListEl;
      window.setTimeout(() => {
        if (
          this.pickerOpen &&
          this.stage === "task-card" &&
          this.taskCardListEl === openingList &&
          openingList &&
          typeof openingList.focus === "function"
        ) {
          openingList.focus();
        }
      }, 0);
      return;
    }
    super.onOpen();
    this.applyTaskCardChrome({ wide: Boolean(this.vaultStage) });
  }

  // Dismissing the modal mid-prompt is a clean cancel: no writes happen until
  // the final block ID is confirmed, so just drop the pending batch state.
  // Invalidate any pending vault-stage refresh so it never paints into the
  // closed modal.
  onClose() {
    if (this.plugin && this.plugin.activeBulletPropertyPicker === this) {
      this.plugin.activeBulletPropertyPicker = null;
    }
    this.vaultStageRefreshId = -1;
    this.clearPendingBatch();
    // Review-walk auto-advance (nav-gestures): normal commits show their
    // rich card before this close, so settling here lands the walk toast
    // after it. The cancel route defers and settles after its own notice.
    if (this.reviewOrigin && this.reviewSettleDeferred !== true) {
      const picker = this;
      setTimeout(() => {
        try {
          picker.settleReviewOrigin();
        } catch (error) {
          // Settle is best effort after close.
        }
      }, 0);
    }
    super.onClose();
  }

  // Idempotent: read the after-line from the editor at the captured line
  // and continue the walk. Esc, `q`, refusals, and no-op writes read an
  // unchanged line, which stays; every committing write is judged from the
  // line after the write. Never throws.
  settleReviewOrigin() {
    const origin = this.reviewOrigin;
    this.reviewOrigin = null;
    if (!origin) {
      return;
    }
    try {
      const plugin = this.plugin;
      if (!plugin || typeof plugin.continueReviewWalkAfter !== "function") {
        return;
      }
      const beforeLine =
        typeof this.reviewBeforeLine === "string" ? this.reviewBeforeLine : "";
      let afterLine = "";
      try {
        const live =
          this.editor && Number.isInteger(this.reviewLineIndex)
            ? getEditorLine(this.editor, this.reviewLineIndex)
            : null;
        afterLine = typeof live === "string" ? live : "";
      } catch (error) {
        afterLine = "";
      }
      let handledRefs = [
        { path: this.filePath || null, line: this.reviewLineIndex, raw: beforeLine },
      ];
      try {
        const session = this.taskSession;
        if (
          session &&
          session.explicit === true &&
          Array.isArray(session.targets) &&
          session.targets.length > 0
        ) {
          handledRefs = session.targets
            .filter((target) => target && Number.isInteger(target.line))
            .map((target) => ({
              path: this.filePath || null,
              line: target.line,
              raw: String(target.rawLine ?? ""),
            }));
        }
      } catch (error) {
        // Keep the single cursor-task ref.
      }
      void plugin.continueReviewWalkAfter(origin, {
        kind: "card",
        beforeLine,
        afterLine,
        handledRefs,
      });
    } catch (error) {
      try {
        void this.plugin.continueReviewWalkAfter(origin, null);
      } catch (ignoredError) {
        // Best effort only.
      }
    }
  }

  renderAll(options = {}) {
    if (this.stage === "task-card") {
      this.renderTaskCard();
      return;
    }
    if (this.stage === "schedule-review") {
      super.renderAll({ ...options, clearQuery: false });
      this.applyTaskCardChrome({ wide: false });
      this.addTaskCardBackButton();
      this.renderScheduleReviewForm();
      return;
    }
    super.renderAll(options);
    this.applyTaskCardChrome({ wide: Boolean(this.vaultStage) });
    this.addTaskCardBackButton();
    this.deferStageInputFocus();
  }

  deferStageInputFocus() {
    const stage = this.stage;
    const openingInput = this.inputEl;
    if (!openingInput || typeof openingInput.focus !== "function") {
      return;
    }
    window.setTimeout(() => {
      if (
        this.pickerOpen &&
        this.stage === stage &&
        this.stage !== "task-card" &&
        this.inputEl === openingInput
      ) {
        openingInput.focus();
      }
    }, 0);
  }

  addTaskCardBackButton() {
    if (!this.hasTaskCard || this.stage === "task-card" || !this.headerEl) {
      return;
    }
    if (this.taskCardBackHeaderEl === this.headerEl && this.taskCardBackButtonEl) {
      return;
    }
    const back = this.headerEl.createEl("button", {
      cls: "bob-task-card-back bob-key-card-key",
      text: "Back",
      attr: { type: "button", "aria-label": "Back to Task Card" },
    });
    back.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      this.returnToTaskCard();
    });
    this.taskCardBackHeaderEl = this.headerEl;
    this.taskCardBackButtonEl = back;
  }

}
