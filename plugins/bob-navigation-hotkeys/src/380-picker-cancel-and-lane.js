class BulletPropertyPickerCancelLaneMixin extends FilteredPickerModal {
  showCancelReasonStage(cancelItem) {
    this.stage = "cancel-reason";
    this.valueBaseDate =
      this.fixedValueBaseDate || getLocalDateStart(new Date());
    const openCount = Math.max(
      1,
      Math.floor(numericOrDefault(cancelItem && cancelItem.openCount, 1)),
    );
    this.pendingCancel = Object.freeze({
      title:
        (cancelItem && cancelItem.title) ||
        getCancelTaskRowTitle({
          kind: (cancelItem && cancelItem.cancelKind) || "task",
          openCount,
        }),
      cancelKind: (cancelItem && cancelItem.cancelKind) || "task",
      openCount,
      fromStatus: (cancelItem && cancelItem.fromStatus) || null,
      dateText: formatBulletPropertyDate(this.valueBaseDate),
    });
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    this.applyOptions({
      items: [],
      title: this.pendingCancel.title,
      headerIcon: "ban",
      inputLabel: "Cancel reason",
      placeholder: "Why cancel it? (optional · ↵ to skip)",
      resultsLabel: "Cancel reason preview",
      emptyText: "Type a reason",
      footerHints: getCancelReasonHints({ empty: true, count: openCount }),
      getSubtitle: () => this.getCancelReasonSubtitle(),
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderCancelReasonPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmCancelReason(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  getCancelReasonSubtitle() {
    const pending = this.pendingCancel;
    if (!pending) {
      return "";
    }

    let summary;
    if (pending.cancelKind === "link" && this.linkSession) {
      summary = `${getLinkPickerSessionSubtitle(this.linkSession)} → Cancelled`;
    } else if (pending.openCount > 1) {
      summary = `${formatCountLabel(pending.openCount, "task")} → Cancelled`;
    } else {
      summary = `${pending.fromStatus || "Task"} → Cancelled`;
    }
    const parts = [
      summary,
      `${getBulletPropertyDateWeekday(this.valueBaseDate)} ${pending.dateText}`,
      "nothing written yet",
    ];
    return parts.filter(Boolean).join(" · ");
  }

  // Cheap synchronous facts for the cancel preview's effects line: whether
  // any target has a block ID (prune applies) and whether any target already
  // keeps a Cancel Log (empty reasons fall back).
  getCancelReasonFacts() {
    const facts = { anyLog: false, hasBlockId: false };
    if (this.isLinkSession()) {
      const resolved = Array.isArray(this.linkSession.resolved)
        ? this.linkSession.resolved
        : [];
      const contentByPath = new Map();
      for (const group of groupLinkPickerTargetsByNote(resolved)) {
        contentByPath.set(group.path, group.content);
      }
      for (const target of resolved) {
        const rawLine = String((target && target.rawLine) || "");
        if (target && target.blockId) {
          facts.hasBlockId = true;
        }
        const content = contentByPath.get(target && target.path);
        if (
          content !== undefined &&
          Number.isInteger(target && target.line) &&
          findCancelLogParent(content, target.line)
        ) {
          facts.anyLog = true;
        }
      }
      return facts;
    }
    const content = this.getEditorContent();
    const lines =
      this.isCountedSession() && this.taskSession
        ? this.taskSession.targets.map((target) => target.line)
        : [this.cursor ? this.cursor.line : NaN];
    for (const line of lines) {
      if (!Number.isInteger(line)) {
        continue;
      }
      if (findCancelLogParent(content, line)) {
        facts.anyLog = true;
      }
    }
    const rawLines =
      this.isCountedSession() && this.taskSession
        ? this.taskSession.targets.map((target) =>
            String((target && target.rawLine) || ""),
          )
        : [String(getEditorLine(this.editor, this.cursor.line) || "")];
    for (const rawLine of rawLines) {
      if (getTrailingBlockId(rawLine)) {
        facts.hasBlockId = true;
      }
    }
    return facts;
  }

  renderCancelReasonPreviewItem(item, rowEl, query) {
    const pending = this.pendingCancel;
    const dateText = pending ? pending.dateText : "";
    const state = item.empty
      ? (item.fallback ? "fallback" : "empty")
      : item.hasInlineField
        ? "warning"
        : "valid";
    addElementClasses(rowEl, "bob-cnp-cancel-reason-row", `is-${state}`);

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(
      rowIcon,
      item.empty
        ? "minus-circle"
        : item.hasInlineField
          ? "alert-triangle"
          : "check-circle-2",
    );

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });

    if (item.empty && !item.fallback) {
      appendHighlighted(titleEl, "No reason", query);
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: `[-] + [cancelled:: ${dateText}] only; no Cancel Log`,
      });
    } else {
      appendHighlighted(
        titleEl,
        formatCancelLogEntryText({
          date: dateText,
          reason: item.empty
            ? SCHEDULE_LOG_SKIPPED_REASON_TEXT
            : item.reason,
        }),
        query,
      );

      if (item.hasInlineField) {
        textEl.createDiv({
          cls: "bob-cnp-row-meta",
          text: '"::" creates a Dataview inline field on this bullet',
        });
      }

      textEl.createDiv({
        cls: "bob-cnp-cancel-reason-preview",
        text: item.counted
          ? item.empty
            ? `Logged on tasks that already keep a ${CANCEL_LOG_MARKER_TEXT}`
            : `Adds or prepends a ${CANCEL_LOG_MARKER_TEXT} entry on each task`
          : item.fallback
            ? `Logged because this task already keeps a ${CANCEL_LOG_LABEL}`
            : item.empty
              ? `[-] + [cancelled:: ${dateText}] only; no Cancel Log`
              : findCancelLogParent(
                    this.getEditorContent(),
                    this.cursor.line,
                  ) ||
                  (this.isLinkSession() && item.anyLog)
                ? `Prepends to the existing ${CANCEL_LOG_MARKER_TEXT}`
                : `Adds ${CANCEL_LOG_MARKER_TEXT} as the first child`,
      });
    }

    const effects = [];
    if (item.hasBlockId) {
      effects.push("Removes its links from today's open Pomodoros");
    }
    effects.push("unblocks dependents");
    textEl.createDiv({
      cls: "bob-cnp-cancel-reason-effects",
      text: effects.join(" · "),
    });
  }

  confirmCancelReason(item) {
    const pending = this.pendingCancel;
    if (!pending || !item) {
      return false;
    }

    // The payload is supplied even for an empty input: a task that already
    // keeps a log records the fallback entry, and planTaskCancelBatch is what
    // decides that per task (per target, in counted and link sessions).
    return this.plugin.applyTaskCancelFromPicker(this, {
      reason: item.empty ? "" : item.reason,
      fallbackReason: SCHEDULE_LOG_SKIPPED_REASON_TEXT,
    });
  }

  showLaneReleaseReasonStage(laneItem) {
    this.stage = "lane-release-reason";
    this.valueBaseDate =
      this.fixedValueBaseDate || getLocalDateStart(new Date());
    const openCount = Math.max(
      1,
      Math.floor(numericOrDefault(laneItem && laneItem.targetCount, 1)),
    );
    this.pendingLaneRelease = Object.freeze({
      title: "Release task",
      laneKind: (laneItem && laneItem.laneKind) || "task",
      openCount,
      dateText: formatBulletPropertyDate(this.valueBaseDate),
    });
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    this.applyOptions({
      items: [],
      title: this.pendingLaneRelease.title,
      headerIcon: "arrow-down-to-line",
      inputLabel: "Release summary",
      placeholder: "Why is this pending? (optional · ↵ to skip)",
      resultsLabel: "Release summary preview",
      emptyText: "Type a summary",
      footerHints: getLaneReleaseReasonHints({ empty: true }),
      getSubtitle: () => this.getLaneReleaseReasonSubtitle(),
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderLaneReleaseReasonPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmLaneReleaseReason(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  getLaneReleaseReasonSubtitle() {
    const pending = this.pendingLaneRelease;
    if (!pending) {
      return "";
    }
    const summary =
      pending.laneKind === "link" && this.linkSession
        ? `${getLinkPickerSessionSubtitle(this.linkSession)} → Ready`
        : pending.openCount > 1
          ? `${formatCountLabel(pending.openCount, "task")} → Ready`
          : "Task → Ready";
    const parts = [
      summary,
      `${getBulletPropertyDateWeekday(this.valueBaseDate)} ${pending.dateText}`,
      "nothing written yet",
    ];
    return parts.filter(Boolean).join(" · ");
  }

  getLaneReleaseReasonFacts() {
    const facts = { anyLog: false, hasBlockId: false };
    if (this.isLinkSession()) {
      const resolved = Array.isArray(this.linkSession.resolved)
        ? this.linkSession.resolved
        : [];
      const contentByPath = new Map();
      for (const group of groupLinkPickerTargetsByNote(resolved)) {
        contentByPath.set(group.path, group.content);
      }
      for (const target of resolved) {
        if (target && target.blockId) {
          facts.hasBlockId = true;
        }
        const content = contentByPath.get(target && target.path);
        if (
          content !== undefined &&
          Number.isInteger(target && target.line) &&
          findLaneWorkLogParent(
            String(content || "").split(/\r?\n/),
            target.line,
          )
        ) {
          facts.anyLog = true;
        }
      }
      return facts;
    }
    const content = this.getEditorContent();
    const lines =
      this.isCountedSession() && this.taskSession
        ? this.taskSession.targets.map((target) => target.line)
        : [this.cursor ? this.cursor.line : NaN];
    for (const line of lines) {
      if (!Number.isInteger(line)) {
        continue;
      }
      if (
        findLaneWorkLogParent(String(content || "").split(/\r?\n/), line)
      ) {
        facts.anyLog = true;
      }
    }
    const rawLines =
      this.isCountedSession() && this.taskSession
        ? this.taskSession.targets.map((target) =>
            String((target && target.rawLine) || ""),
          )
        : [String(getEditorLine(this.editor, this.cursor.line) || "")];
    for (const rawLine of rawLines) {
      if (getTrailingBlockId(rawLine)) {
        facts.hasBlockId = true;
      }
    }
    return facts;
  }

  renderLaneReleaseReasonPreviewItem(item, rowEl, query) {
    const pending = this.pendingLaneRelease;
    const dateText = pending ? pending.dateText : "";
    addElementClasses(rowEl, "bob-cnp-lane-release-reason-row", "is-valid");
    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, "arrow-down-to-line");
    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    if (item.empty) {
      appendHighlighted(titleEl, "No summary", query);
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: "Release to Ready only; no Work Log",
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
      textEl.createDiv({
        cls: "bob-cnp-cancel-reason-preview",
        text: "Prepends to the Work Log of each released In Progress task",
      });
    }
    const effects = [];
    if (item.hasBlockId) {
      effects.push("Removes its links from today's open Pomodoros");
    }
    effects.push("releases Next and In Progress to Ready");
    textEl.createDiv({
      cls: "bob-cnp-cancel-reason-effects",
      text: effects.join(" · "),
    });
  }

  confirmLaneReleaseReason(item) {
    const pending = this.pendingLaneRelease;
    if (!pending || !item) {
      return false;
    }
    return this.applyInboxRoutedLaneToggle({
      summary: item.empty ? "" : item.reason,
      dateText: pending.dateText,
    });
  }


  getEditorContent() {
    if (this.editor && typeof this.editor.getValue === "function") {
      return String(this.editor.getValue() || "");
    }

    return this.lineText || "";
  }

  getCurrentPropertyValue(name) {
    const lineText = getEditorLine(this.editor, this.cursor.line);
    const field = findBulletPropertyField(
      lineText === null ? this.lineText : lineText,
      name,
    );
    return field ? field.value : "";
  }

  getPriorityRollLevel(dateProperty) {
    if (!dateProperty || dateProperty.values !== "date") {
      return null;
    }
    if (this.isLinkSession()) {
      return null;
    }

    const priorityProperty = this.config.properties.find(
      (property) =>
        property.values === "priority" &&
        property.schedules === dateProperty.name,
    );
    if (!priorityProperty) {
      return null;
    }

    let currentValue;
    if (this.isCountedSession()) {
      const aggregate = createCountedBulletPropertyItems(
        this.config,
        this.getEditorContent(),
        this.taskSession,
      );
      if (!aggregate.valid) {
        return null;
      }
      const priorityItem = aggregate.items.find(
        (item) => item.property === priorityProperty,
      );
      if (!priorityItem || priorityItem.valueState !== "common") {
        return null;
      }
      currentValue = priorityItem.currentValue;
    } else {
      currentValue = this.getCurrentPropertyValue(priorityProperty.name);
    }

    return priorityProperty.levelsByValue.get(currentValue) || null;
  }

  // The Ctrl+Enter recommendation for this single (or ^prj) task, planned
  // from the live note content. Null in counted and link sessions (later
  // phases own those), and whenever there is no recommendation: a closed or
  // non-task line, no priority property naming a date property, or a current
  // value outside the configured levels.
}
