class BulletPropertyPickerRollWriteMixin extends FilteredPickerModal {
  // Thin wrapper over the shared planner (396): identical behavior, and
  // parity is pinned by scripts/test-navigation-quick-roll-preview.cjs.
  computePriorityRollRecommendation() {
    if (this.isCountedSession() || this.isLinkSession()) {
      return null;
    }
    const cursor = this.cursor;
    if (!cursor || !Number.isInteger(cursor.line)) {
      return null;
    }
    return planPriorityRollRecommendationAtLine({
      config: this.config,
      content: this.getEditorContent(),
      line: cursor.line,
      baseDate: this.valueBaseDate,
      random: this.priorityRandom,
    });
  }

  refreshPriorityRollRecommendation() {
    this.priorityRollRecommendation = this.computePriorityRollRecommendation();
    this.priorityRollRecommendationReady = true;
    return this.priorityRollRecommendation;
  }

  // The counted Ctrl+Enter batch, planned once when the picker opens (what you
  // see is what you get): each target keeps its own pre-rolled date. Null in
  // single and link sessions, and when no target has a recommendation.
  computeCountedRollBatch() {
    if (!this.isCountedSession() || this.isLinkSession()) {
      return null;
    }
    const content = this.getEditorContent();
    const properties =
      this.config && Array.isArray(this.config.properties)
        ? this.config.properties
        : [];
    for (const priorityProperty of properties) {
      if (!priorityProperty || priorityProperty.values !== "priority") {
        continue;
      }
      const schedulesName = normalizeBulletPropertyName(
        priorityProperty.schedules,
      );
      if (!schedulesName) {
        continue;
      }
      const summary = planPriorityRollRecommendationsForTargets(
        content,
        this.taskSession.targets,
        priorityProperty,
        {
          baseDate: this.valueBaseDate,
          random: this.priorityRandom,
        },
      );
      const actionable =
        (summary.counts.roll || 0) +
        (summary.counts.decay || 0) +
        (summary.counts.assign || 0) +
        (summary.counts.cancel || 0);
      const hasAny =
        actionable > 0 || Boolean(summary.unavailableReason);
      if (!hasAny) {
        continue;
      }
      return Object.freeze({
        ...summary,
        priorityName: priorityProperty.name,
      });
    }
    return null;
  }

  refreshCountedRollBatch() {
    this.countedRollBatch = this.computeCountedRollBatch();
    this.countedRollBatchReady = true;
    return this.countedRollBatch;
  }

  // The link-session Ctrl+Enter batch, planned once when the picker opens
  // (what you see is what you get): each resolved target keeps its own
  // pre-rolled date, read from its own note's content. Null in single and
  // counted sessions, and when no target has a recommendation.
  computeLinkRollBatch() {
    if (!this.isLinkSession()) {
      return null;
    }
    const resolved = Array.isArray(this.linkSession.resolved)
      ? this.linkSession.resolved
      : [];
    const properties =
      this.config && Array.isArray(this.config.properties)
        ? this.config.properties
        : [];
    for (const priorityProperty of properties) {
      if (!priorityProperty || priorityProperty.values !== "priority") {
        continue;
      }
      const schedulesName = normalizeBulletPropertyName(
        priorityProperty.schedules,
      );
      if (!schedulesName) {
        continue;
      }
      const summary = planLinkRollBatchSummary(
        resolved,
        priorityProperty,
        {
          baseDate: this.valueBaseDate,
          random: this.priorityRandom,
        },
      );
      const actionable =
        (summary.counts.roll || 0) +
        (summary.counts.decay || 0) +
        (summary.counts.assign || 0) +
        (summary.counts.cancel || 0);
      const hasAny =
        actionable > 0 || Boolean(summary.unavailableReason);
      if (!hasAny) {
        continue;
      }
      return Object.freeze({
        ...summary,
        priorityName: priorityProperty.name,
      });
    }
    return null;
  }

  refreshLinkRollBatch() {
    this.linkRollBatch = this.computeLinkRollBatch();
    this.linkRollBatchReady = true;
    return this.linkRollBatch;
  }

  getLinkRollBatchForDateProperty(datePropertyName) {
    const batch = this.linkRollBatch;
    if (!batch) {
      return null;
    }
    if (
      normalizeBulletPropertyName(batch.schedulesName) !==
      normalizeBulletPropertyName(datePropertyName)
    ) {
      return null;
    }
    return batch;
  }

  // Link sessions use the single-task copy for exactly one target and the
  // batch copy otherwise. They keep no pinned stage-two roll row.
  getLinkRollPreviewForDateProperty(datePropertyName) {
    const batch = this.getLinkRollBatchForDateProperty(datePropertyName);
    if (!batch) {
      return null;
    }
    return buildLinkRollPreviewModel(batch, this.valueBaseDate);
  }

  hasLinkRollBatchForDateProperty(datePropertyName) {
    const batch = this.getLinkRollBatchForDateProperty(datePropertyName);
    if (!batch) {
      return false;
    }
    return (
      batch.actionableCount > 0 || Boolean(batch.unavailableReason)
    );
  }

  // Ctrl+R re-rolls every pre-rolled link date. Only dated
  // targets (roll and decay) have one.
  rerollLinkRollBatch() {
    const cached = this.linkRollBatch;
    if (!cached || cached.actionableCount <= 0 || cached.unavailableReason) {
      return false;
    }
    const fresh = this.computeLinkRollBatch();
    if (!fresh || fresh.actionableCount <= 0 || fresh.unavailableReason) {
      return false;
    }
    if (!samePriorityRecommendationCounts(fresh.counts, cached.counts)) {
      return false;
    }
    this.linkRollBatch = fresh;
    this.linkRollBatchReady = true;
    return true;
  }

  getCountedRollBatchForDateProperty(datePropertyName) {
    const batch = this.countedRollBatch;
    if (!batch) {
      return null;
    }
    if (
      normalizeBulletPropertyName(batch.schedulesName) !==
      normalizeBulletPropertyName(datePropertyName)
    ) {
      return null;
    }
    return batch;
  }

  getCountedRollPreviewForDateProperty(datePropertyName) {
    const batch = this.getCountedRollBatchForDateProperty(datePropertyName);
    if (!batch) {
      return null;
    }
    return buildBatchPriorityRollPreviewModel(batch);
  }

  // Ctrl+R re-rolls every pre-rolled counted date. Only dated
  // targets (roll and decay) have one.
  rerollCountedRollBatch() {
    const cached = this.countedRollBatch;
    if (!cached || cached.actionableCount <= 0 || cached.unavailableReason) {
      return false;
    }
    const fresh = this.computeCountedRollBatch();
    if (!fresh || fresh.actionableCount <= 0 || fresh.unavailableReason) {
      return false;
    }
    if (!samePriorityRecommendationCounts(fresh.counts, cached.counts)) {
      return false;
    }
    this.countedRollBatch = fresh;
    this.countedRollBatchReady = true;
    return true;
  }

  getScheduledRollRecommendation(datePropertyName) {
    const recommendation = this.priorityRollRecommendation;
    if (!recommendation) {
      return null;
    }
    if (
      normalizeBulletPropertyName(recommendation.schedulesName) !==
      normalizeBulletPropertyName(datePropertyName)
    ) {
      return null;
    }
    return recommendation;
  }

  getRollPreviewForDateProperty(datePropertyName) {
    if (this.isLinkSession()) {
      return this.getLinkRollPreviewForDateProperty(datePropertyName);
    }
    if (this.isCountedSession()) {
      return this.getCountedRollPreviewForDateProperty(datePropertyName);
    }
    const recommendation = this.getScheduledRollRecommendation(datePropertyName);
    if (!recommendation) {
      return null;
    }
    return buildPriorityRollPreviewModel(recommendation, this.valueBaseDate);
  }

  // Ctrl+R in the schedule stage re-rolls the recommendation's date. Only
  // dated recommendations (roll and decay) have one.
  rerollPriorityRollRecommendation() {
    const cached = this.priorityRollRecommendation;
    if (!cached || !cached.date) {
      return false;
    }
    const fresh = this.computePriorityRollRecommendation();
    if (!fresh || !fresh.date || fresh.kind !== cached.kind) {
      return false;
    }
    this.priorityRollRecommendation = fresh;
    this.priorityRollRecommendationReady = true;
    return true;
  }

  findPriorityPropertyByName(name) {
    const properties =
      this.config && Array.isArray(this.config.properties)
        ? this.config.properties
        : [];
    return (
      properties.find(
        (candidate) =>
          candidate &&
          candidate.values === "priority" &&
          normalizeBulletPropertyName(candidate.name) ===
            normalizeBulletPropertyName(name),
      ) || null
    );
  }

  // Ctrl+Enter takes the previewed recommendation and closes the picker.
  // Before writing, the recommendation is recomputed from the live note: when
  // the kind, the from or to level, or the target line differs from the
  // preview, nothing is written and the card re-renders with the fresh
  // recommendation. Ctrl+Enter honours `opening`, so it never double-fires.
  async applyRecommendedRoll() {
    const cached = this.priorityRollRecommendation;
    if (!cached) {
      return false;
    }
    if (cached.kind === "unavailable") {
      new Notice(cached.reason);
      return false;
    }
    if (this.opening) {
      return false;
    }
    this.opening = true;
    try {
      const fresh = this.computePriorityRollRecommendation();
      if (!fresh || !isSamePriorityRollTarget(cached, fresh)) {
        new Notice("Task changed while the picker was open; nothing was written");
        this.priorityRollRecommendation = fresh || null;
        this.priorityRollRecommendationReady = true;
        this.returnHome({ rebuild: true });
        return false;
      }
      if (isDatedPriorityRecommendation(cached)) {
        return await this.maybeOfferRecommendedWorkLog(cached);
      }
      if (cached.kind === "cancel") {
        return await this.applyRecommendedCancelWrite(cached);
      }
      return false;
    } finally {
      this.opening = false;
    }
  }

  async maybeOfferRecommendedWorkLog(cached) {
    const targets =
      this.cursor && Number.isInteger(this.cursor.line)
        ? [
            {
              line: this.cursor.line,
              rawLine: getEditorLine(this.editor, this.cursor.line) ?? this.lineText,
            },
          ]
        : [];
    const eligible = collectSchedulingWorkLogEligibleOriginalLines(targets);
    if (eligible.size === 0) {
      if (cached.kind === "roll") {
        return await this.applyRecommendedRollWrite(cached);
      }
      if (cached.kind === "decay") {
        return await this.applyRecommendedDecayWrite(cached);
      }
      return await this.applyRecommendedAssignWrite(cached);
    }
    const scheduleSummary = cached.date
      ? `scheduled → ${normalizeBulletPropertyValue(cached.date)}`
      : "";
    return await this.offerSchedulingWorkLogOrDispatch({
      targets,
      scheduleSummary,
      dispatch: async (summary) => {
        const schedulingWorkLog = summary
          ? {
              summary,
              dateText: formatBulletPropertyDate(
                this.valueBaseDate instanceof Date
                  ? this.valueBaseDate
                  : getLocalDateStart(new Date()),
              ),
            }
          : null;
        if (cached.kind === "roll") {
          return await this.applyRecommendedRollWrite(cached, schedulingWorkLog);
        }
        if (cached.kind === "decay") {
          return await this.applyRecommendedDecayWrite(cached, schedulingWorkLog);
        }
        return await this.applyRecommendedAssignWrite(cached, schedulingWorkLog);
      },
    });
  }

  async applyRecommendedRollWrite(recommendation, schedulingWorkLog = null) {
    const property = this.findPriorityPropertyByName(
      recommendation.priorityName,
    );
    if (!property) {
      new Notice("Task changed while the picker was open; nothing was written");
      return false;
    }
    const content = this.getEditorContent();
    const lines = splitMarkdownContent(content).lines;
    const liveLine = lines[this.cursor.line] || "";
    const liveContext = getProjectNotePropertyContext(content, this.cursor.line);
    const scheduledTarget = resolveBulletPropertyTarget(
      recommendation.schedulesName,
      liveContext,
    );
    // Project scheduling uses the same inline field and adds resident effects.
    if (scheduledTarget.kind === "project-inline") {
      const liveScheduledField = findBulletPropertyField(
        liveLine,
        recommendation.schedulesName,
      );
      const liveScheduledDirect = liveScheduledField
        ? liveScheduledField.value
        : "";
      const nextHintDirect = planNextPriorityRollHint(property, recommendation);
      const rollOptionDirect = {
        kind: "roll",
        fromLevel: getPriorityRollCurrentLabel(recommendation),
        step: recommendation.step,
        limit: recommendation.limit,
        next: nextHintDirect ? nextHintDirect.next : null,
        nextLabel: nextHintDirect ? nextHintDirect.nextLabel : "",
      };
      const levelIndexDirect = normalizePriorityLevelIndex(
        property,
        recommendation.level,
      );
      return await this.plugin.setProjectNoteScheduledValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        liveScheduledDirect,
        recommendation.date,
        {
          today: this.valueBaseDate,
          scheduleLog: buildPriorityRollScheduleLog({
            source: "scheduled",
            level: recommendation.level,
            rolledDays: recommendation.offset,
            from: liveScheduledDirect,
            to: recommendation.date,
          }),
          schedulingWorkLog,
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level: recommendation.level,
              levelIndex: levelIndexDirect,
              baseDate: this.valueBaseDate,
              scheduledValues: [outcome.scheduled || recommendation.date],
              taskCount: 1,
              scope: "project",
              roll: rollOptionDirect,
              outcome: {
                ...outcome,
                scheduleLoggedTaskCount:
                  outcome.scheduleLogOutcome === "added" ||
                  outcome.scheduleLogOutcome === "created"
                    ? 1
                    : 0,
              },
            }),
        },
      );
    }
    const rollAction = {
      label: recommendation.date
        ? `roll to ${recommendation.date}`
        : `set ${recommendation.level || "priority"}`,
    };
    const rollWrite = async () => {
      const nextHint = planNextPriorityRollHint(property, recommendation);
      const rollOption = {
        kind: "roll",
        fromLevel: getPriorityRollCurrentLabel(recommendation),
        step: recommendation.step,
        limit: recommendation.limit,
        next: nextHint ? nextHint.next : null,
        nextLabel: nextHint ? nextHint.nextLabel : "",
      };
      const levelIndex = normalizePriorityLevelIndex(
        property,
        recommendation.level,
      );
      const scheduledField = findBulletPropertyField(
        liveLine,
        recommendation.schedulesName,
      );
      return await this.plugin.setBulletPropertyValue(
        this.editor,
        this.cursor,
        recommendation.schedulesName,
        recommendation.date,
        {
          filePath: this.filePath,
          expectedLine: this.lineText,
          today: this.valueBaseDate,
          scheduleLog: buildPriorityRollScheduleLog({
            source: "scheduled",
            level: recommendation.level,
            rolledDays: recommendation.offset,
            from: scheduledField ? scheduledField.value : "",
            to: recommendation.date,
          }),
          schedulingWorkLog,
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level: recommendation.level,
              levelIndex,
              baseDate: this.valueBaseDate,
              scheduledValues: [recommendation.date],
              taskCount: 1,
              scope: "task",
              roll: rollOption,
              outcome: {
                blockedTaskCount: outcome.blocked ? 1 : 0,
                recoveryCounts: outcome.recoveryCounts,
                scheduleLoggedTaskCount:
                  outcome.scheduleLogOutcome === "added" ||
                  outcome.scheduleLogOutcome === "created"
                    ? 1
                    : 0,
                schedulingWorkLogWrittenCount:
                  outcome.schedulingWorkLogWrittenCount || 0,
                removedPomodoroLinkCount: outcome.removedPomodoroLinkCount,
                pomodoroPruneFailed: outcome.pomodoroPruneFailed,
              },
            }),
        },
      );
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(rollAction, rollWrite);
    }
    return await rollWrite();
  }

  async applyRecommendedDecayWrite(recommendation, schedulingWorkLog = null) {
    const property = this.findPriorityPropertyByName(
      recommendation.priorityName,
    );
    if (!property || !recommendation.toLevel) {
      new Notice("Task changed while the picker was open; nothing was written");
      return false;
    }
    const nextHint = planNextPriorityRollHint(property, recommendation);
    const liveContext = getProjectNotePropertyContext(
      this.getEditorContent(),
      this.cursor.line,
    );
    const decayAction = {
      label: recommendation.toLevel
        ? `decay to ${recommendation.toLevel.label || recommendation.toLevel.value || "next"}`
        : "decay",
    };
    const decayWrite = async () =>
      await this.plugin.setBulletPriorityValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        property,
        recommendation.toLevel,
        {
          propertyContext: liveContext,
          baseDate: this.valueBaseDate,
          random: this.priorityRandom,
          precomputedRoll: {
            date: recommendation.date,
            offset: recommendation.offset,
          },
          scheduleReasonOverride: recommendation.reason,
          schedulingWorkLog,
          noticeRoll: {
            kind: "decay",
            fromLevel: getPriorityRollCurrentLabel(recommendation),
            step: null,
            limit: recommendation.limit,
            next: nextHint ? nextHint.next : null,
            nextLabel: nextHint ? nextHint.nextLabel : "",
          },
        },
      );
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(decayAction, decayWrite);
    }
    return await decayWrite();
  }

  async applyRecommendedAssignWrite(recommendation, schedulingWorkLog = null) {
    const property = this.findPriorityPropertyByName(
      recommendation.priorityName,
    );
    if (!property || !recommendation.level) {
      new Notice("Task changed while the picker was open; nothing was written");
      return false;
    }
    const liveContext = getProjectNotePropertyContext(
      this.getEditorContent(),
      this.cursor.line,
    );
    const levelLabel = normalizeBulletPropertyValue(
      recommendation.level && recommendation.level.label,
    );
    const assignAction = {
      label: levelLabel ? `set ${levelLabel}` : "set priority",
    };
    const assignWrite = async () =>
      await this.plugin.setBulletPriorityValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        property,
        recommendation.level,
        {
          propertyContext: liveContext,
          baseDate: this.valueBaseDate,
          random: this.priorityRandom,
          precomputedRoll: {
            date: recommendation.date,
            offset: recommendation.offset,
          },
          schedulingWorkLog,
        },
      );
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(assignAction, assignWrite);
    }
    return await assignWrite();
  }

  async applyRecommendedCancelWrite(recommendation) {
    return await this.plugin.applyTaskCancelFromPicker(this, {
      reason: formatPriorityDecayCancelReason({
        level: recommendation.level,
        streak: recommendation.streak,
      }),
    });
  }

}
