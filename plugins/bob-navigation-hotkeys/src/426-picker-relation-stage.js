// Links… stage picker (`docs/task-relations.md` Rules 7–8) and its vault
// pool builders. Commits through `plugin.applyRelationEdit`, so one gesture
// writes the source LINKS line, mints the source id, and follows up the
// LINKED FROM mirrors with one notice. Never stamps, routes inbox tasks,
// or touches Pomodoros (LG13).

class BulletPropertyPickerRelationStageMixin extends FilteredPickerModal {
  isRelationStage() {
    return this.relationStage === true && this.isLocalTaskStage();
  }

  isLinkedFromStage() {
    return this.isRelationStage() && this.relationStageDirection === "from";
  }

  isLinkedFromSession() {
    // The ⇧↵ relation field and the block-ID prompt leave the list stage
    // but still commit the gesture started in Linked from.
    return this.relationStage === true && this.relationStageDirection === "from";
  }

  relationStageDummyProperty() {
    return {
      kind: "property",
      property: { name: "linksTo", values: "local_task_id" },
      currentValue: "",
    };
  }

  relationStageSourceLines() {
    if (this.isCountedSession()) {
      return (this.taskSession.targets || []).map((target) => target.line);
    }
    return [this.cursor.line];
  }

  showRelationStage(direction = "to", options = {}) {
    this.stage = "value";
    this.blocksStage = false;
    this.relationStage = true;
    this.relationStageDirection = direction === "from" ? "from" : "to";
    this.relationLabel = null;
    this.selectedPropertyItem = this.relationStageDummyProperty();
    this.pendingTask = null;
    this.pendingRelation = null;
    this.clearPendingBatch();
    this.selectedIndex = 0;
    const keepQuery = Boolean(options && options.keepQuery);
    const initialQuery =
      keepQuery && typeof this.getQuery === "function" ? this.getQuery() : "";
    const parentLines = this.relationStageSourceLines();
    let stage = null;
    try {
      stage =
        this.plugin &&
        typeof this.plugin.buildVaultRelationStage === "function"
          ? this.plugin.buildVaultRelationStage({
              filePath: this.filePath,
              content: this.getEditorContent(),
              parentLines,
              direction: this.relationStageDirection,
            })
          : null;
    } catch (_stageError) {
      stage = null;
    }
    this.relationStageSeed = stage;
    this.vaultStage = stage;
    const items = this.vaultStage
      ? planRelationStageItemsFromVault(this.vaultStage, initialQuery)
      : [];
    this.resetLocalTaskMarks(items);
    this.applyOptions(this.relationStageListOptions());
    if (this.headerIconEl) {
      this.headerIconEl.empty();
      applyIcon(this.headerIconEl, "link-2");
      if (
        this.headerIconEl.children &&
        this.headerIconEl.children.length === 0
      ) {
        applyIcon(this.headerIconEl, "link");
      }
    }
    if (this.resultsEl) {
      if (keepQuery) {
        this.renderAll({});
      } else {
        this.renderAll({ clearQuery: true });
      }
    }
    this.applyTaskCardChrome({ wide: Boolean(this.vaultStage) });
    this.ensureRelationConsequenceStrip();
    this.refreshRelationConsequenceStrip();
    if (
      stage &&
      (this.isLinkedFromStage() ? stage.incomingNeedsScan : !stage.cacheReady) &&
      this.plugin &&
      typeof this.plugin.refreshVaultRelationStage === "function"
    ) {
      if (!this.isLinkedFromStage()) {
        void this.plugin.refreshVaultRelationStage(this, stage);
      } else if (stage.cacheReady) {
        void this.plugin.refreshVaultLinkedFromIncoming(this, stage);
      } else {
        void this.plugin.refreshVaultRelationStage(this, stage);
      }
    }
    void this.refreshRelationStageTodayLinks();
  }

  showLinkedFromStage() {
    return this.showRelationStage("from");
  }

  flipRelationStageDirection() {
    const next = this.relationStageDirection === "from" ? "to" : "from";
    if (next === "from" && this.taskSession && this.taskSession.type !== "single") {
      new Notice("Linked from needs a single task");
      return false;
    }
    const field = this.inputEl || {};
    const value = String(field.value || "");
    const start = typeof field.selectionStart === "number" ? field.selectionStart : null;
    const end = typeof field.selectionEnd === "number" ? field.selectionEnd : null;
    this.showRelationStage(next, { keepQuery: true });
    if (this.inputEl) {
      this.inputEl.value = value;
      if (start !== null && end !== null) {
        try {
          this.inputEl.setSelectionRange(start, end);
        } catch (_restoreError) {
          // Best effort: the restored value is what matters for filtering.
        }
      }
    }
    if (this.resultsEl && typeof this.renderResults === "function") this.renderResults();
    return true;
  }

  relationStageListOptions() {
    const title =
      (this.vaultStage && this.vaultStage.title) || "🪢 Links";
    return {
      items: this.vaultStage
        ? planRelationStageItemsFromVault(
            this.vaultStage,
            this.getQuery ? this.getQuery() : "",
          )
        : [],
      title,
      headerIcon: "link-2",
      inputLabel: "Filter tasks",
      placeholder: "Filter tasks",
      resultsLabel: this.isLinkedFromStage()
        ? "Tasks that could link here"
        : "Tasks this could link to",
      emptyText: this.isLinkedFromStage()
        ? "No matching editable tasks in the vault"
        : "No matching tasks in the vault",
      footerHints: this.getRelationStageFooterHints(),
      getSubtitle: (visibleItems, allItems) =>
        this.getRelationStageSubtitle(visibleItems, allItems),
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderTaskValueItem(item, rowEl, query),
      openItem: (item) => this.chooseRelationTask(item),
    };
  }

  getRelationStageFooterHints() {
    if (!this.isRelationStage()) {
      return this.getLocalTaskFooterHints();
    }
    const marked = this.getMarkedCount();
    const item = (this.visibleItems || [])[this.selectedIndex];
    let verb = this.isLinkedFromStage() ? "link here" : "link";
    if (marked > 0) {
      verb = `apply ${marked}`;
    } else if (item && item.stageSection === "current") {
      verb = this.isLinkedFromStage() ? "remove source" : "unlink";
    }
    const hints = [
      { keys: ["↑", "↓"], label: "navigate" },
      { keys: ["⇥"], label: "mark" },
      { keys: ["↵"], label: verb },
      { keys: ["⇧↵"], label: "with a relation" },
    ];
    if (!this.taskSession || this.taskSession.type === "single") {
      hints.push({ keys: ["~"], label: "flip direction" });
    }
    hints.push({ keys: ["esc"], label: "dismiss" });
    return hints;
  }

  getRelationStageSubtitle(_visibleItems, _allItems) {
    const stage = this.vaultStage;
    if (this.getMarkedCount() > 0) {
      return relationStageSubtitle(stage, this.getMarkedTaskDiff(), {});
    }
    return relationStageSubtitle(stage, null, {});
  }

  ensureRelationConsequenceStrip() {
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

  refreshRelationConsequenceStrip() {
    if (!this.isRelationStage()) {
      if (this.consequenceStripEl) {
        this.consequenceStripEl.setText("");
      }
      return;
    }
    const el = this.ensureRelationConsequenceStrip();
    if (!el) {
      return;
    }
    const marked = this.getMarkedTaskItems();
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const text = relationStageConsequenceStrip(item, {
      marked,
      direction: this.relationStageDirection,
    });
    el.empty();
    el.createSpan({ cls: "bob-cnp-consequence-strip-text", text });
  }

  // 🍅 badge (display only): today's Pomodoro links over the current pool.
  // Relations never consume them; the badge only informs (LG13).
  async refreshRelationStageTodayLinks() {
    const stage = this.vaultStage;
    if (!stage || !this.relationStage) {
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
    const current = this.vaultStage;
    if (!current || !this.relationStage || dailyContent === null) {
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
    const todayMap = new Map();
    for (const link of todayLinks || []) {
      if (link && link.key && !todayMap.has(link.key)) {
        todayMap.set(link.key, link);
      }
    }
    current.todayMap = todayMap;
    const marked = this.markedLines instanceof Set ? new Set(this.markedLines) : new Set();
    const items = planRelationStageItemsFromVault(
      current,
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

  relationStageSourceRefs(overrides = new Map()) {
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

  relationStageExpectedMap(refs) {
    const expected = new Map();
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      for (const ref of refs || []) {
        const path = normalizeVaultRelativePath(ref.path || "");
        if (path && this.vaultStage.files.has(path) && !expected.has(path)) {
          expected.set(path, String(this.vaultStage.files.get(path) || ""));
        }
      }
    }
    return expected;
  }

  chooseRelationTask(item, options = {}) {
    if (this.getMarkedCount() > 0 && !options.withLabel) {
      return this.commitMarkedRelations();
    }
    if (!item || item.kind === "stage-more") {
      return false;
    }
    if (item.disabled) {
      new Notice(item.disabledReason || "That task cannot be linked");
      return false;
    }
    if (item.stageSection === "current" && item.alreadyLinked) {
      if (options.withLabel) {
        return this.showRelationLabelStage([item], { mode: "relabel" });
      }
      return this.commitRelationEdit({ add: [], remove: [item], relabel: [] });
    }
    if (options.withLabel) {
      return this.showRelationLabelStage([item], { mode: "add" });
    }
    if (this.getMarkedCount() > 0) {
      return this.commitMarkedRelations();
    }
    return this.commitRelationEdit({ add: [item], remove: [], relabel: [] });
  }

  commitMarkedRelations() {
    if (this.getMarkedCount() === 0) {
      return false;
    }
    const planned = planRelationStageCommit(this.getMarkedTaskItems());
    if (planned.add.length === 0 && planned.remove.length === 0) {
      return false;
    }
    if (this.isLinkedFromStage() && planned.add.length > 0 && planned.remove.length > 0) {
      new Notice("Apply incoming links or remove current sources in separate gestures");
      return false;
    }
    return this.commitRelationEdit(planned);
  }

  async commitRelationEdit({ add, remove, relabel }, targetOverrides = new Map()) {
    const additions = Array.isArray(add) ? add : [];
    const removals = Array.isArray(remove) ? remove : [];
    const relabels = Array.isArray(relabel) ? relabel : [];
    const linkedFrom = this.isLinkedFromSession();
    const owner = linkedFrom ? this.relationStageSourceRefs()[0] || null : null;
    const ownerKey = owner
      ? `${normalizeVaultRelativePath(owner.path || "")}\x00${owner.line}`
      : "";
    // LG5: id-less targets run the block-ID prompt once on apply. Escape
    // closes the prompt and writes and mints nothing.
    const missing = linkedFrom
      ? additions.length + relabels.length > 0 &&
        owner &&
        !normalizeBulletPropertyValue(owner.blockId || "") &&
        !targetOverrides.get(ownerKey)
        ? [owner]
        : []
      : [...additions, ...relabels].filter(
          (target) =>
            !normalizeBulletPropertyValue(target.blockId || "") &&
            !targetOverrides.get(
              `${normalizeVaultRelativePath(target.path || "")}\x00${target.line}`,
            ),
        );
    if (missing.length > 0) {
      const reservedIds = new Set();
      for (const extra of targetOverrides.values()) {
        if (extra && extra.blockId) {
          reservedIds.add(extra.blockId);
        }
      }
      this.pendingRelation = {
        add: additions,
        remove: removals,
        relabel: relabels,
        overrides: targetOverrides,
        queue: missing.slice(),
        reservedIds,
        reverseOwner: linkedFrom ? owner : null,
      };
      return this.promptNextRelationTargetId();
    }
    const sources = this.relationStageSourceRefs();
    const toRef = (item) => {
      const extra = targetOverrides.get(
        `${normalizeVaultRelativePath(item.path || "")}\x00${item.line}`,
      );
      return {
        path: normalizeVaultRelativePath(item.path || ""),
        line: item.line,
        blockId:
          (extra && extra.blockId) ||
          item.blockId ||
          item.existingBlockId ||
          null,
        label: item.label !== undefined ? item.label : undefined,
        rawLine:
          extra && typeof extra.rawLine === "string"
            ? extra.rawLine
            : typeof item.rawLine === "string"
              ? item.rawLine
              : undefined,
      };
    };
    // The open-time snapshot of the touched notes only; the writer reads
    // live content and compares, so a changed note refuses with
    // "changed — reopen".
    const expected = this.relationStageExpectedMap([
      ...sources,
      ...additions.map(toRef),
      ...removals.map(toRef),
      ...relabels.map(toRef),
    ]);
    if (linkedFrom) {
      if (!owner) {
        new Notice("This task could not be resolved");
        return false;
      }
      const ownerRef = toRef(owner);
      const groups = [
        { mode: "add", items: additions },
        { mode: "remove", items: removals },
        { mode: "relabel", items: relabels },
      ].filter((group) => group.items.length > 0);
      const notices = [];
      for (const group of groups) {
        const sourceRefs = group.items.map(toRef);
        const label = group.items[0].label || null;
        const outcome = await this.plugin.applyRelationEdit({
          sources: sourceRefs,
          add: group.mode === "add" ? [{ ...ownerRef, label }] : [],
          remove: group.mode === "remove" ? [ownerRef] : [],
          relabel: group.mode === "relabel" ? [{ ...ownerRef, label }] : [],
          direction: "from",
          expected: this.relationStageExpectedMap([...sourceRefs, ownerRef]),
        });
        if (!outcome.ok) {
          if (outcome.reason === "changed — reopen" || outcome.reason === "changed") {
            return this.refuseDependencyStale();
          }
          new Notice(outcome.notice || `🪢 Could not update links (${outcome.reason})`);
          return false;
        }
        if (outcome.notice) notices.push(outcome.notice);
      }
      if (notices.length === 1) new Notice(notices[0]);
      else if (notices.length > 1) new Notice(notices.join(" · "));
      this.clearPendingBatch();
      this.pendingRelation = null;
      return true;
    }
    const write = async () => {
      const outcome = await this.plugin.applyRelationEdit({
        sources,
        add: additions.map(toRef),
        remove: removals.map(toRef),
        relabel: relabels.map(toRef),
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
          outcome.notice || `🪢 Could not update links (${outcome.reason})`,
        );
        return false;
      }
      if (outcome.notice) {
        new Notice(outcome.notice);
      }
      this.clearPendingBatch();
      this.pendingRelation = null;
      return true;
    };
    return write();
  }

  promptNextRelationTargetId() {
    const pending = this.pendingRelation;
    if (!pending || !Array.isArray(pending.queue) || pending.queue.length === 0) {
      return this.commitRelationEdit(
        { add: pending && pending.add, remove: pending && pending.remove, relabel: pending && pending.relabel },
        pending && pending.overrides,
      );
    }
    const target = pending.reverseOwner || pending.queue[0];
    const snapshot = {
      path: target.path,
      line: target.line,
      rawLine: typeof target.rawLine === "string" ? target.rawLine : null,
      displayText: target.displayText || target.path,
      existingIdField: target.existingIdField || target.idField || null,
      blockId: null,
    };
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      const content = this.vaultStage.files.get(
        normalizeVaultRelativePath(target.path),
      );
      if (typeof content === "string" && Number.isInteger(target.line)) {
        snapshot.rawLine = String(content.split(/\r?\n/)[target.line] || "");
        snapshot.displayText = cleanTaskDisplayText(snapshot.rawLine);
        snapshot.existingIdField =
          (findBulletPropertyField(snapshot.rawLine, "id") || {}).value || null;
      }
    }
    this.showBlockIdStage(snapshot, { mode: "relation-target" });
    return false;
  }

  async confirmRelationTargetBlockId(item) {
    const pending = this.pendingRelation;
    if (!pending || !item || !item.valid) {
      return false;
    }
    const target = pending.reverseOwner || pending.queue[0];
    if (!target) {
      return false;
    }
    const targetPath = normalizeVaultRelativePath(target.path || "");
    const files = await this.readVaultStageFiles([targetPath]);
    if (!files) {
      return false;
    }
    const targetContent = files.get(targetPath);
    const validation = validateBlockIdCandidate(item.id, targetContent, {
      reservedIds: pending.reservedIds || new Set(),
    });
    if (!validation.valid || !tryDependencyId(targetPath, validation.id)) {
      new Notice(
        validation.message || "That block ID cannot be used in the target note",
      );
      return false;
    }
    const targetLines = String(targetContent).split(/\r?\n/);
    if (
      targetLines[target.line] !== target.rawLine ||
      !isObsidianTaskAtLine(targetContent, target.line, null, targetLines)
    ) {
      return this.refuseDependencyStale();
    }
    // The planner resolves targets by `^block-id`, so the confirmed id is
    // written to the target before the single commit below runs.
    const updatedLine = applyPromptedBlockIdPreservingLegacyId(
      targetLines[target.line],
      validation.id,
      targetPath,
    );
    if (updatedLine === null) {
      new Notice(
        "Link not added: this note path cannot be encoded as a block ID",
      );
      return false;
    }
    const prepared = await this.plugin.prepareDependencyTargetNote(
      targetPath,
      {
        line: target.line,
        from: targetLines[target.line],
        text: updatedLine,
      },
    );
    if (!prepared.ok) {
      new Notice(`🪢 Could not prepare ${targetPath} (${prepared.reason})`);
      return false;
    }
    pending.reservedIds.add(validation.id);
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      const nextLines = targetLines.slice();
      nextLines[target.line] = updatedLine;
      this.vaultStage.files.set(
        targetPath,
        nextLines.join(relationLineEnding(String(targetContent))),
      );
    }
    pending.overrides.set(`${target.path}\x00${target.line}`, {
      blockId: validation.id,
      rawLine: updatedLine,
    });
    pending.queue.shift();
    if (pending.queue.length > 0) {
      return this.promptNextRelationTargetId();
    }
    const add = pending.add;
    const remove = pending.remove;
    const relabel = pending.relabel;
    const overrides = pending.overrides;
    this.pendingRelation = null;
    this.clearPendingBatch();
    return this.commitRelationEdit({ add, remove, relabel }, overrides);
  }

  // The relation field (⇧↵): one input, suggestion chips from the live
  // relation index, a live `S — ‹label› → T` sentence, and inline
  // validation. ↵ commits (empty commits plain, LG3); Escape returns to
  // the list and writes nothing.
  showRelationLabelStage(targets, options = {}) {
    const list = (Array.isArray(targets) ? targets : []).filter(
      (target) => target && target.path,
    );
    if (list.length === 0) {
      return false;
    }
    this.relationLabelTargets = list;
    this.relationLabelMode = options.mode === "relabel" ? "relabel" : "add";
    this.stage = "relation-label";
    this.selectedIndex = 0;
    this.relationLabelShowHidden = false;
    this.relationLabelOneOff = false;
    this.relationLabelLastQuery = "";
    this.relationLabelTabNoMatch = false;
    this.relationLabelGhosts = new Map();
    this.relationLabelWrites = new Set();
    const suggestions = this.readRelationLabelSuggestions("", { hidden: "exclude" });
    const hiddenCount = this.readRelationLabelHiddenCount();
    this.relationLabelTitleBase = this.relationLabelMode === "relabel"
      ? "🪢 Relabel the relation"
      : "🪢 Link with a relation";
    this.applyOptions({
      items: suggestions.map((row) => ({
        kind: "relation-label",
        label: row.label,
        count: row.count,
        typed: false,
      })),
      title: `${this.relationLabelTitleBase}${hiddenCount > 0 ? ` · ◌ ${hiddenCount} hidden ⌃H` : ""}`,
      headerIcon: "link-2",
      inputLabel: "Relation",
      placeholder: relationStageLabelPlaceholder(suggestions),
      resultsLabel: "Suggestions",
      emptyText: "Type a relation, or leave it empty for a plain link",
      footerHints: this.getRelationLabelFooterHints(),
      getSubtitle: () => this.getRelationLabelSubtitle(),
      filterItem: (item, query) =>
        !item || item.kind !== "relation-label" || !item.label
          ? true
          : fuzzyMatchesText(item.label, query),
      renderItem: (item, rowEl, query) =>
        this.renderRelationLabelItem(item, rowEl, query),
      openItem: (item) => this.commitRelationLabel(item),
    });
    this.subscribeRelationLabelChanges();
    if (this.headerIconEl) {
      this.headerIconEl.empty();
      applyIcon(this.headerIconEl, "link-2");
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
    return false;
  }

  getRelationLabelSubtitle() {
    const sources =
      this.vaultStage && Array.isArray(this.vaultStage.sources)
        ? this.vaultStage.sources
        : [];
    const targets = Array.isArray(this.relationLabelTargets)
      ? this.relationLabelTargets
      : [];
    const sourceText = this.isLinkedFromSession()
      ? (targets[0] && targets[0].displayText) || "This task"
      : (sources[0] && sources[0].displayText) || "This task";
    const firstText =
      (targets[0] &&
        (targets[0].displayText || targets[0].text || targets[0].blockId)) ||
      "that task";
    const targetText = this.isLinkedFromSession()
      ? "this"
      : targets.length > 1
        ? `${firstText} +${targets.length - 1} more`
        : firstText;
    const raw = this.getRawQuery ? this.getRawQuery() : "";
    return relationStageLiveSentence(sourceText, raw, targetText);
  }

  getRelationLabelPreviewItems() {
    const raw = this.getRawQuery ? String(this.getRawQuery() || "") : "";
    if (raw !== this.relationLabelLastQuery) {
      this.relationLabelLastQuery = raw;
      this.relationLabelGhosts = new Map();
      this.relationLabelOneOff = false;
      this.relationLabelTabNoMatch = false;
      this.selectedIndex = 0;
    }
    const typed = normalizeRelationLabel(raw);
    const suggestions = this.readRelationLabelSuggestions(raw, { hidden: "include" });
    const ghosts = this.relationLabelGhosts instanceof Map
      ? this.relationLabelGhosts
      : new Map();
    const effective = suggestions.map((row) => {
      const ghost = ghosts.get(row.key);
      return ghost
        ? { ...row, hidden: ghost.hidden, ghost: true }
        : { ...row, ghost: false };
    });
    this.relationLabelTopMatchKey = (effective.find((row) => row.hidden !== true && row.ghost !== true) || {}).key || "";
    const out = [];
    if (!raw.trim()) {
      out.push(
        Object.freeze({
          kind: "relation-label",
          label: null,
          typed: false,
          plain: true,
          displayText: "Plain link (no relation)",
          searchText: "",
          oneOff: false,
        }),
      );
    } else if (typed) {
      const key = normalizeRelationLabel(typed).toLowerCase();
      const existing = suggestions.find((row) => row.key === key) || null;
      const label = existing ? existing.label : typed;
      const hidden = existing ? existing.hidden === true : false;
      const warning = Boolean(this.relationLabelOneOff && existing && !hidden && existing.count > 0);
      out.push(
        Object.freeze({
          kind: "relation-label",
          key,
          label,
          typed: !existing,
          existing: Boolean(existing),
          count: existing ? existing.count : 0,
          hidden,
          oneOff: this.relationLabelOneOff === true,
          warning,
          warningText: warning
            ? `⚠ Capturing also hides “${label}” (${existing.count} links) from suggestions. Existing links keep their label.`
            : "",
          displayText: label,
          searchText: label,
        }),
      );
    } else {
      return Object.freeze([
        Object.freeze({
          kind: "relation-label-invalid",
          label: null,
          reason: describeRelationLabelRefusal(raw) || "That relation cannot be used",
          displayText: describeRelationLabelRefusal(raw) || "That relation cannot be used",
          searchText: "",
          disabled: true,
        }),
      ]);
    }
    const typedKey = typed ? normalizeRelationLabel(typed).toLowerCase() : "";
    const visibleRows = effective.filter((row) => row.hidden !== true && row.key !== typedKey);
    const hiddenRows = effective.filter((row) => row.hidden === true && row.key !== typedKey);
    const toItem = (row) => Object.freeze({
      kind: "relation-label",
      key: row.key,
      label: row.label,
      count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
      inverse: row.inverse || null,
      hidden: row.hidden === true,
      ghost: row.ghost === true,
      typed: false,
      displayText: row.label,
      searchText: row.label,
    });
    for (const row of visibleRows) {
      out.push(toItem(row));
      if (out.length >= 12) break;
    }
    if (this.relationLabelShowHidden === true && hiddenRows.length > 0 && out.length < 13) {
      out.push(Object.freeze({
        kind: "relation-label-heading",
        displayText: "Hidden",
        searchText: "",
        nonSelectable: true,
      }));
      for (const row of hiddenRows) {
        out.push(toItem(row));
        if (out.length >= 24) break;
      }
    } else if (this.relationLabelShowHidden !== true) {
      for (const row of hiddenRows.filter((entry) => entry.ghost)) {
        out.push(toItem(row));
        if (out.length >= 24) break;
      }
    }
    return Object.freeze(out);
  }

  renderRelationLabelItem(item, rowEl, query) {
    if (item && item.kind === "relation-label-heading") {
      addElementClasses(rowEl, "bob-cnp-task-value-row", "is-disabled", "is-relation-label-heading");
      rowEl.setAttribute("aria-disabled", "true");
      rowEl.createDiv({ cls: "bob-cnp-section-header", text: "── Hidden ──" });
      return;
    }
    if (!item || item.kind === "relation-label-invalid") {
      addElementClasses(rowEl, "bob-cnp-task-value-row", "is-disabled");
      rowEl.setAttribute("aria-disabled", "true");
      const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
      textEl.createDiv({
        cls: "bob-cnp-row-title",
        text: (item && item.reason) || "That relation cannot be used",
      });
      return;
    }
    addElementClasses(
      rowEl,
      "bob-cnp-task-value-row",
      item.typed ? "is-create" : "is-existing",
      item.hidden ? "is-relation-label-hidden" : "",
      item.ghost ? "is-relation-label-ghost" : "",
      item.warning ? "is-relation-label-warning" : "",
    );
    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, item.plain ? "link" : "link-2");
    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.plain ? "Plain link (no relation)" : item.label, query);
    if (item.oneOff) {
      textEl.createDiv({ cls: "bob-cnp-row-meta bob-cnp-relation-label-one-off", text: "◌ one-off · will stay hidden" });
    } else if (item.warning) {
      textEl.createDiv({ cls: "bob-cnp-row-meta bob-cnp-relation-label-warning", text: item.warningText });
    } else if (item.ghost) {
      textEl.createDiv({
        cls: "bob-cnp-row-meta bob-cnp-relation-label-ghost-meta",
        text: item.hidden ? "hidden everywhere · ⌃D undo" : "visible everywhere · ⌃D hide",
      });
    } else if (item.hidden) {
      textEl.createDiv({ cls: "bob-cnp-row-meta bob-cnp-relation-label-hidden-meta", text: "hidden everywhere · ⌃D unhide" });
    } else if (!item.plain && Number.isInteger(item.count) && item.count > 0) {
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: `used ${item.count}×`,
      });
    }
  }

  async commitRelationLabel(item) {
    const targets = Array.isArray(this.relationLabelTargets)
      ? this.relationLabelTargets
      : [];
    if (targets.length === 0) {
      return false;
    }
    if (item && (item.kind === "relation-label-invalid" || item.kind === "relation-label-heading")) {
      new Notice(item.reason || "That relation cannot be used");
      return false;
    }
    const raw = this.getRawQuery ? String(this.getRawQuery() || "") : "";
    let label = null;
    if (item && item.kind === "relation-label" && !item.plain) {
      // Relation-label text is always item.label; item.typed is a boolean flag.
      label = item.label ? normalizeRelationLabel(item.label) : null;
      if (!label) {
        new Notice(describeRelationLabelRefusal(raw) || "That relation cannot be used");
        return false;
      }
    } else if (item && item.plain) {
      label = null;
    } else {
      // ↵ with a typed value and no selected suggestion: the input commits.
      if (raw.trim() === "") {
        label = null;
      } else {
        label = normalizeRelationLabel(raw);
        if (!label) {
          new Notice(describeRelationLabelRefusal(raw) || "That relation cannot be used");
          return false;
        }
      }
    }
    const withLabel = targets.map((target) => ({ ...target, label }));
    let committed = false;
    if (this.relationLabelMode === "relabel") {
      committed = await this.commitRelationEdit({ add: [], remove: [], relabel: withLabel });
    } else {
      committed = await this.commitRelationEdit({ add: withLabel, remove: [], relabel: [] });
    }
    if (committed && label && this.relationLabelOneOff === true) {
      try {
        const api = this.relationLabelsApi();
        const hidden = api && typeof api.hide === "function"
          ? await api.hide(label, { allowUnused: true })
          : { ok: false, message: "Bob Ledger Tools api.relationLabels is required." };
        if (!hidden || hidden.ok !== true) {
          const quoted = `'${String(label).replace(/'/gu, "'\\''")}'`;
          new Notice(`Relation saved, but it could not be hidden. Retry: bob relations hide ${quoted}`);
        }
      } catch (_error) {
        const quoted = `'${String(label).replace(/'/gu, "'\\''")}'`;
        new Notice(`Relation saved, but it could not be hidden. Retry: bob relations hide ${quoted}`);
      }
    }
    return committed;
  }

  restoreRelationList() {
    this.clearRelationLabelSubscriptions();
    this.relationLabelTargets = null;
    this.relationLabelMode = null;
    this.relationLabelShowHidden = false;
    this.relationLabelOneOff = false;
    this.relationLabelGhosts = new Map();
    this.relationLabelWrites = new Set();
    this.stage = "value";
    this.selectedIndex = 0;
    const items = this.vaultStage
      ? planRelationStageItemsFromVault(
          this.vaultStage,
          this.getQuery ? this.getQuery() : "",
        )
      : [];
    this.resetLocalTaskMarks(items);
    this.applyOptions(this.relationStageListOptions());
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    this.refreshRelationConsequenceStrip();
    return true;
  }

}

