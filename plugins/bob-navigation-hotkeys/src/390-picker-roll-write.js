class BulletPropertyPickerRollWriteMixin extends FilteredPickerModal {
  computePriorityRollRecommendation() {
    if (this.isCountedSession() || this.isLinkSession()) {
      return null;
    }
    const cursor = this.cursor;
    if (!cursor || !Number.isInteger(cursor.line)) {
      return null;
    }
    const content = this.getEditorContent();
    if (!isObsidianTaskAtLine(content, cursor.line)) {
      return null;
    }
    const lines = splitMarkdownContent(content).lines;
    const lineText = lines[cursor.line] || "";
    if (!OPEN_OBSIDIAN_TASK_STATUSES.has(getObsidianTaskCheckboxStatus(lineText))) {
      return null;
    }
    const properties =
      this.config && Array.isArray(this.config.properties)
        ? this.config.properties
        : [];
    const liveContext = getProjectNotePropertyContext(content, cursor.line);
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
      const scheduledTarget = resolveBulletPropertyTarget(
        schedulesName,
        liveContext,
      );
      let currentScheduled = "";
      if (scheduledTarget.kind === "project-frontmatter") {
        currentScheduled =
          liveContext.frontmatter && liveContext.frontmatter.scheduledDefined
            ? liveContext.frontmatter.scheduledValue
            : "";
      } else {
        const scheduledField = findBulletPropertyField(lineText, schedulesName);
        currentScheduled = scheduledField ? scheduledField.value : "";
      }
      const planned = planPriorityRollRecommendation({
        property: priorityProperty,
        content,
        taskLine: cursor.line,
        currentScheduled,
        baseDate: this.valueBaseDate,
        random: this.priorityRandom,
      });
      if (!planned) {
        continue;
      }
      return Object.freeze({
        ...planned,
        priorityName: priorityProperty.name,
        schedulesName,
        taskLine: cursor.line,
      });
    }
    return null;
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
    if (
      fresh.counts.roll !== cached.counts.roll ||
      fresh.counts.decay !== cached.counts.decay ||
      fresh.counts.cancel !== cached.counts.cancel
    ) {
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
    if (
      fresh.counts.roll !== cached.counts.roll ||
      fresh.counts.decay !== cached.counts.decay ||
      fresh.counts.cancel !== cached.counts.cancel
    ) {
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
      if (cached.kind === "roll" || cached.kind === "decay") {
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
      return await this.applyRecommendedDecayWrite(cached);
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
        return await this.applyRecommendedDecayWrite(cached, schedulingWorkLog);
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
    if (scheduledTarget.kind === "project-frontmatter") {
      const liveScheduled =
        liveContext.frontmatter && liveContext.frontmatter.scheduledDefined
          ? liveContext.frontmatter.scheduledValue
          : "";
      return await this.plugin.setProjectNoteScheduledValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        liveScheduled,
        recommendation.date,
        {
          scheduleLog: buildPriorityRollScheduleLog({
            source: "scheduled",
            level: recommendation.level,
            rolledDays: recommendation.offset,
            from: liveScheduled,
            to: recommendation.date,
          }),
          schedulingWorkLog,
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level: recommendation.level,
              levelIndex,
              baseDate: this.valueBaseDate,
              scheduledValues: [outcome.scheduled || recommendation.date],
              taskCount: 1,
              scope: "project",
              roll: rollOption,
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
    return await this.plugin.setBulletPriorityValue(
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
