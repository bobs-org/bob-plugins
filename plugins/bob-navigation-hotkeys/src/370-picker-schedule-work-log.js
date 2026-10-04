class BulletPropertyPickerScheduleWorkLogMixin extends FilteredPickerModal {
  getScheduleReviewSubtitle() {
    const pending = this.pendingScheduleReview;
    if (!pending) {
      return "";
    }
    return (pending.effects || []).join(" · ");
  }

  getScheduleReviewReasonText() {
    if (this.scheduleReviewReasonEl) {
      return String(this.scheduleReviewReasonEl.value || "");
    }
    const pending = this.pendingScheduleReview;
    return pending ? String(pending.reason || "") : "";
  }

  getScheduleReviewSummaryText() {
    if (!this.pendingScheduleReview || !this.pendingScheduleReview.needsWorkLog) {
      return "";
    }
    if (this.scheduleReviewSummaryEl) {
      return String(this.scheduleReviewSummaryEl.value || "");
    }
    return "";
  }

  renderScheduleReviewForm() {
    const pending = this.pendingScheduleReview;
    if (!pending || !this.searchEl) {
      return;
    }
    const reasonValue = this.getScheduleReviewReasonText() || pending.reason || "";
    const summaryValue = this.getScheduleReviewSummaryText();
    this.searchEl.empty();
    addElementClasses(this.searchEl, "bob-task-card-review");
    const form = this.searchEl.createDiv({
      cls: "bob-task-card-review-form",
    });
    this.scheduleReviewFormEl = form;

    const reasonField = form.createDiv({ cls: "bob-task-card-review-field" });
    reasonField.createEl("label", {
      text: "Reason for this date (optional)",
      attr: { for: "bob-schedule-review-reason" },
    });
    const reasonInput = reasonField.createEl("input", {
      cls: "bob-cnp-input bob-task-card-review-input",
      attr: {
        id: "bob-schedule-review-reason",
        type: "text",
        "aria-label": "Reason for this date",
        placeholder: "Why this date? (optional)",
      },
    });
    reasonInput.value = reasonValue;
    this.inputEl = reasonInput;
    this.scheduleReviewReasonEl = reasonInput;
    reasonInput.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    reasonInput.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );

    this.scheduleReviewSummaryEl = null;
    if (pending.needsWorkLog) {
      const summaryField = form.createDiv({
        cls: "bob-task-card-review-field",
      });
      const countLabel =
        pending.eligibleCount === 1
          ? "1 Next/Pending target only"
          : `${pending.eligibleCount} Next/Pending targets only`;
      summaryField.createEl("label", {
        text: `Work summary (optional · ${countLabel})`,
        attr: { for: "bob-schedule-review-summary" },
      });
      const summaryInput = summaryField.createEl("input", {
        cls: "bob-cnp-input bob-task-card-review-input",
        attr: {
          id: "bob-schedule-review-summary",
          type: "text",
          "aria-label": "Work summary",
          placeholder: "What did you get done? (optional · ↵ to skip)",
        },
      });
      summaryInput.value = summaryValue;
      this.scheduleReviewSummaryEl = summaryInput;
      summaryInput.addEventListener("input", () => {
        this.selectedIndex = 0;
        this.renderResults();
      });
      summaryInput.addEventListener("keydown", (event) =>
        this.handleKeydown(event),
      );
    }

    this.renderResults();
    const focusEl =
      pending.focusField === "summary" && this.scheduleReviewSummaryEl
        ? this.scheduleReviewSummaryEl
        : reasonInput;
    if (focusEl && typeof focusEl.focus === "function") {
      focusEl.focus();
    }
  }

  cycleScheduleReviewFocus(event, reverse) {
    const fields = [
      this.scheduleReviewReasonEl,
      this.scheduleReviewSummaryEl,
      this.taskCardBackButtonEl,
    ].filter(Boolean);
    if (fields.length === 0) {
      return;
    }
    const current = fields.indexOf(event && event.target);
    const delta = reverse ? -1 : 1;
    const start = current >= 0 ? current : 0;
    const next = fields[(start + delta + fields.length) % fields.length];
    if (next && typeof next.focus === "function") {
      next.focus();
    }
  }

  renderScheduleReviewPreview(item, rowEl, query) {
    const pending = this.pendingScheduleReview;
    addElementClasses(rowEl, "bob-cnp-schedule-reason-row", "bob-task-card-review-preview");
    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    if (item && item.reasonEmpty) {
      appendHighlighted(
        titleEl,
        item.reasonFallback ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : "No reason",
        query,
      );
    } else {
      appendHighlighted(
        titleEl,
        formatScheduleLogEntryText({
          from: pending ? pending.from : "",
          to: pending ? pending.to : "",
          reason: item && item.reason,
        }),
        query,
      );
    }
    if (item && item.reasonHasInlineField) {
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: '"::" creates a Dataview inline field on this bullet',
      });
    }
    if (pending && pending.needsWorkLog) {
      textEl.createDiv({
        cls: "bob-cnp-schedule-work-log-preview",
        text: item && item.summaryEmpty
          ? "Schedule only; no Work Log"
          : pending.eligibleCount === 1
            ? `Prepends under 🛠️ **WORK LOG** on the qualifying task`
            : `Prepends under 🛠️ **WORK LOG** on each of the ${pending.eligibleCount} qualifying tasks`,
      });
      if (item && !item.summaryEmpty) {
        textEl.createDiv({
          cls: "bob-cnp-schedule-work-log-effects",
          text: formatLaneWorkLogEntry(
            item.summary,
            formatBulletPropertyDate(
              this.valueBaseDate instanceof Date
                ? this.valueBaseDate
                : getLocalDateStart(new Date()),
            ),
          ),
        });
      }
    }
    if (pending && Array.isArray(pending.effects)) {
      textEl.createDiv({
        cls: "bob-task-card-review-effects",
        text: pending.effects.join(" · "),
      });
    }
  }

  async confirmScheduleReview() {
    const pending = this.pendingScheduleReview;
    if (!pending || typeof pending.resume !== "function") {
      return false;
    }
    if (schedulingWorkLogSnapshotChanged(pending.targets, this.getSchedulingWorkLogTargets())) {
      new Notice("Task changed while the picker was open; nothing was written");
      this.pendingScheduleReview = null;
      this.pendingScheduleReason = null;
      this.returnHome();
      return false;
    }
    const reason = normalizeScheduleReasonText(this.getScheduleReviewReasonText());
    const summary = normalizeSchedulingWorkSummary(this.getScheduleReviewSummaryText());
    let applied = false;
    try {
      applied = await pending.resume({
        reason: reason.empty ? "" : reason.reason,
        summary,
      });
    } catch (_error) {
      applied = false;
    }
    if (applied === true) {
      return true;
    }
    this.pendingScheduleReview = null;
    this.pendingScheduleReason = null;
    this.returnHome();
    return false;
  }

  // Optional Work Log stage for scheduling Pending/Next tasks. Entered after
  // the schedule-reason stage (explicit dates) or directly (priority picks,
  // pinned rolls, recommended rolls/decays). `pending.resume` commits the
  // frozen scheduling action with the given normalized summary ("" skips).
  // Escape or dismissal discards all pending state with zero writes via
  // clearPendingBatch/onClose.
  showSchedulingWorkLogStage(pending) {
    if (!pending || typeof pending.resume !== "function") {
      return;
    }
    this.ensureTaskCardStageChrome();
    this.stage = "schedule-work-log";
    this.pendingScheduleWorkLog = pending;
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    this.applyOptions({
      items: [],
      title: pending.title || "Schedule task",
      headerIcon: "briefcase",
      inputLabel: "Work summary",
      placeholder: "What did you get done? (optional · ↵ to skip)",
      resultsLabel: "Work Log preview",
      emptyText: "Type a summary",
      footerHints: getSchedulingWorkLogHints({ empty: true }),
      getSubtitle: () => this.getSchedulingWorkLogSubtitle(),
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderSchedulingWorkLogPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmSchedulingWorkLog(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  getSchedulingWorkLogSubtitle() {
    const pending = this.pendingScheduleWorkLog;
    if (!pending) {
      return "";
    }
    const parts = [];
    if (pending.scheduleSummary) {
      parts.push(String(pending.scheduleSummary));
    }
    if (Number.isInteger(pending.eligibleCount) && pending.eligibleCount > 0) {
      const taskWord = pending.eligibleCount === 1 ? "task" : "tasks";
      if (pending.isBatch) {
        parts.push(`${pending.eligibleCount} of ${pending.totalCount || pending.eligibleCount} ${taskWord} qualify`);
      } else {
        parts.push(pending.eligibleCount === 1 ? "1 task qualifies" : `${pending.eligibleCount} tasks qualify`);
      }
    }
    parts.push("nothing written yet");
    return parts.filter(Boolean).join(" · ");
  }

  renderSchedulingWorkLogPreviewItem(item, rowEl, query) {
    const pending = this.pendingScheduleWorkLog;
    const dateText = pending ? pending.dateText : "";
    const state = item.empty ? "empty" : item.hasInlineField ? "warning" : "valid";
    addElementClasses(rowEl, "bob-cnp-schedule-work-log-row", `is-${state}`);

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, item.empty ? "minus-circle" : item.hasInlineField ? "alert-triangle" : "check-circle-2");

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    if (item.empty) {
      appendHighlighted(titleEl, "No summary", query);
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: "Schedule only; no Work Log",
      });
    } else {
      appendHighlighted(
        titleEl,
        formatLaneWorkLogEntry(item.reason, dateText),
        query,
      );
      if (item.hasInlineField) {
        textEl.createDiv({
          cls: "bob-cnp-row-meta",
          text: '"::" creates a Dataview inline field on this bullet',
        });
      }
      const eligible = pending ? Math.max(1, Math.floor(numericOrDefault(pending.eligibleCount, 1))) : 1;
      textEl.createDiv({
        cls: "bob-cnp-schedule-work-log-preview",
        text:
          eligible === 1
            ? `Prepends under 🛠️ **WORK LOG** on the qualifying task`
            : `Prepends under 🛠️ **WORK LOG** on each of the ${eligible} qualifying tasks`,
      });
    }
    if (pending && pending.scheduleSummary) {
      textEl.createDiv({
        cls: "bob-cnp-schedule-work-log-effects",
        text: String(pending.scheduleSummary),
      });
    }
  }

  async confirmSchedulingWorkLog(item) {
    const pending = this.pendingScheduleWorkLog;
    if (!pending || !item || typeof pending.resume !== "function") {
      return false;
    }
    const summary = item.empty ? "" : String(item.reason || "");
    let applied = false;
    try {
      applied = await pending.resume(summary);
    } catch (error) {
      applied = false;
    }
    if (applied === true) {
      return true;
    }
    // Refusals must not carry a stale summary forward: drop the frozen action
    // and return to the card with fresh recommendations.
    this.pendingScheduleWorkLog = null;
    this.pendingScheduleReason = null;
    this.returnHome({ rebuild: true });
    return false;
  }

  // Count qualifying Pending/Next explicit targets for the current picker
  // state. `targets` are `{ line, rawLine }` in original coordinates.
  countSchedulingWorkLogEligible(targets) {
    return collectSchedulingWorkLogEligibleOriginalLines(targets).size;
  }

  // Route one accepted scheduling gesture through the optional Work Log
  // stage when any explicit target qualifies, else dispatch immediately.
  // `dispatch` commits the frozen scheduling action given a normalized
  // summary ("" skips the Work Log). Returns the dispatch result when no
  // prompt is needed, else false to keep the modal open on the new stage.
  async offerSchedulingWorkLogOrDispatch(options = {}) {
    const targets = Array.isArray(options.targets) ? options.targets : [];
    const dispatch = options.dispatch;
    if (typeof dispatch !== "function") {
      return false;
    }
    // Deduplicate by note plus identity so linked notes with equal line
    // numbers still count separately, and duplicate links to one task count
    // once.
    const totalCount = collectSchedulingWorkLogTargetIdentities(targets).size;
    const eligibleCount = collectSchedulingWorkLogEligibleIdentities(targets).size;
    if (eligibleCount === 0) {
      return await dispatch("");
    }
    const isBatch = totalCount > 1;
    const dateText = formatBulletPropertyDate(
      this.valueBaseDate instanceof Date
        ? this.valueBaseDate
        : getLocalDateStart(new Date()),
    );
    const title = isBatch
      ? `Schedule ${totalCount} tasks`
      : "Schedule task";
    const pending = Object.freeze({
      title,
      isBatch,
      eligibleCount,
      totalCount,
      dateText,
      scheduleSummary: String(options.scheduleSummary || ""),
      resume: dispatch,
    });
    this.showSchedulingWorkLogStage(pending);
    return false;
  }

  // Pinned roll row in the `scheduled` stage: deterministic Schedule Log
  // reason, frozen date in `item.value`; offer the Work Log stage when any
  // explicit target qualifies.
  async maybeOfferPinnedRollWorkLog(item) {
    if (!item) {
      return false;
    }
    const scheduleLog = this.buildPriorityRollScheduleLogForItem(item);
    const targets = this.isLinkSession()
      ? Array.isArray(this.linkSession.resolved)
        ? this.linkSession.resolved
        : []
      : this.isCountedSession() && this.taskSession
        ? this.taskSession.targets
        : this.cursor && Number.isInteger(this.cursor.line)
          ? [
              {
                line: this.cursor.line,
                rawLine: getEditorLine(this.editor, this.cursor.line) ?? this.lineText,
              },
            ]
          : [];
    const scheduleSummary = item.value
      ? `scheduled → ${normalizeBulletPropertyValue(item.value)}`
      : "";
    return await this.offerSchedulingWorkLogOrDispatch({
      targets,
      scheduleSummary,
      dispatch: async (summary) =>
        await this.applySelectedValue(item, {
          scheduleLog,
          schedulingWorkLog: summary
            ? {
                summary,
                dateText: formatBulletPropertyDate(
                  this.valueBaseDate instanceof Date
                    ? this.valueBaseDate
                    : getLocalDateStart(new Date()),
                ),
              }
            : null,
        }),
    });
  }

  // Priority-level picks (and any non-scheduled property): only priority
  // scheduling gestures offer the Work Log stage. All other properties keep
  // the existing immediate flow. Priority rolls are materialized once before
  // the prompt and reused on resume, so opening/submitting the prompt never
  // consumes extra randomness or changes the chosen schedule.
  async maybeOfferPriorityWorkLog(item, precomputed = {}) {
    const property =
      this.selectedPropertyItem && this.selectedPropertyItem.property;
    if (!property || property.values !== "priority") {
      return await this.applySelectedValue(item);
    }
    const level = item && item.priorityLevel;
    if (!level) {
      return await this.applySelectedValue(item);
    }
    const baseDate =
      this.valueBaseDate instanceof Date
        ? getLocalDateStart(this.valueBaseDate)
        : getLocalDateStart(new Date());
    const random =
      typeof this.priorityRandom === "function"
        ? this.priorityRandom
        : Math.random;
    if (this.isLinkSession()) {
      const resolved = Array.isArray(this.linkSession.resolved)
        ? this.linkSession.resolved
        : [];
      const eligible = collectSchedulingWorkLogEligibleOriginalLines(resolved);
      if (eligible.size === 0) {
        return await this.applySelectedValue(item, precomputed);
      }
      const groups = groupLinkPickerTargetsByNote(resolved);
      const precomputedByPath = precomputed.precomputedByPath instanceof Map
        ? precomputed.precomputedByPath
        : new Map();
      const allDates = [];
      for (const group of groups) {
        let frozen = precomputedByPath.get(group.path);
        if (!frozen) {
          const rollByLine = new Map(
            group.session.targets.map((target) => [
              target.line,
              rollPriorityScheduledDateWithOffset(level, baseDate, random),
            ]),
          );
          const scheduledValueByLine = new Map(
            Array.from(rollByLine, ([line, roll]) => [
              line,
              formatBulletPropertyDate(roll.date),
            ]),
          );
          frozen = Object.freeze({ rollByLine, scheduledValueByLine });
          precomputedByPath.set(group.path, frozen);
        }
        const scheduledValueByLine = frozen.scheduledValueByLine;
        for (const date of scheduledValueByLine.values()) {
          allDates.push(date);
        }
      }
      const scheduleSummary = precomputed.scheduleSummary || formatSchedulingWorkLogDateSpan(allDates);
      return await this.offerSchedulingWorkLogOrDispatch({
        targets: resolved,
        scheduleSummary,
        dispatch: async (summary) =>
          await this.plugin.applyLinkPickerPriorityValue(this, item, {
            schedulingWorkLog: summary
              ? { summary, dateText: formatBulletPropertyDate(baseDate) }
              : null,
            precomputedByPath,
          }),
      });
    }
    if (this.isCountedSession() && this.taskSession) {
      const targets = this.taskSession.targets;
      const eligible = collectSchedulingWorkLogEligibleOriginalLines(targets);
      if (eligible.size === 0) {
        return await this.applySelectedValue(item, precomputed);
      }
      const rollByLine = precomputed.precomputedRollByLine instanceof Map
        ? precomputed.precomputedRollByLine
        : new Map(
            targets.map((target) => [
              target.line,
              rollPriorityScheduledDateWithOffset(level, baseDate, random),
            ]),
          );
      const scheduledValueByLine = precomputed.precomputedScheduledValueByLine instanceof Map
        ? precomputed.precomputedScheduledValueByLine
        : new Map(
            Array.from(rollByLine, ([line, roll]) => [
              line,
              formatBulletPropertyDate(roll.date),
            ]),
          );
      const scheduleSummary = precomputed.scheduleSummary || formatSchedulingWorkLogDateSpan(Array.from(scheduledValueByLine.values()));
      return await this.offerSchedulingWorkLogOrDispatch({
        targets,
        scheduleSummary,
        dispatch: async (summary) =>
          await this.applySelectedValue(item, {
            schedulingWorkLog: summary
              ? { summary, dateText: formatBulletPropertyDate(baseDate) }
              : null,
            precomputedRollByLine: rollByLine,
            precomputedScheduledValueByLine: scheduledValueByLine,
          }),
      });
    }
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
      return await this.applySelectedValue(item, precomputed);
    }
    const frozenRoll = precomputed.precomputedRoll || rollPriorityScheduledDateWithOffset(level, baseDate, random);
    const rolledValue = typeof frozenRoll.date === "string"
      ? normalizeBulletPropertyValue(frozenRoll.date)
      : formatBulletPropertyDate(frozenRoll.date);
    const precomputedRoll = Object.freeze({ date: rolledValue, offset: frozenRoll.offset });
    const scheduleSummary = precomputed.scheduleSummary || `scheduled → ${rolledValue}`;
    return await this.offerSchedulingWorkLogOrDispatch({
      targets,
      scheduleSummary,
      dispatch: async (summary) =>
        await this.applySelectedValue(item, {
          schedulingWorkLog: summary
            ? { summary, dateText: formatBulletPropertyDate(baseDate) }
            : null,
          precomputedRoll,
        }),
    });
  }

  // Free-text prompt shown after the pinned Cancel row is chosen, mirroring
  // the schedule-reason stage: nothing is written until this prompt is
  // confirmed (Enter, empty or not) or the modal is dismissed (Esc, a clean
  // cancel — see onClose's contract).
}
