class BulletPropertyPickerScheduleReviewMixin extends FilteredPickerModal {
  isCountedSession() {
    return Boolean(
      this.taskSession &&
      this.taskSession.explicit &&
      Array.isArray(this.taskSession.targets) &&
      this.taskSession.targets.length > 0,
    );
  }

  isLinkSession() {
    return Boolean(
      this.linkSession &&
        this.linkSession.kind === "task-link" &&
        Array.isArray(this.linkSession.targets) &&
        this.linkSession.targets.length > 0,
    );
  }

  getTaskSessionSubtitle() {
    if (this.isLinkSession()) {
      return getLinkPickerSessionSubtitle(this.linkSession);
    }
    if (!this.isCountedSession()) {
      return this.bulletSubtitle;
    }
    if (this.taskSession.clamped) {
      return `${formatCountLabel(
        this.taskSession.actualCount,
        "task",
      )} of ${this.taskSession.requestedCount} requested · end of note`;
    }
    return formatCountLabel(this.taskSession.actualCount, "task");
  }

  // The property rows the card's actions and its More section open stages
  // for. Built without painting: no stage lists them.
  buildPropertyItems() {
    let items;
    if (this.isLinkSession()) {
      const aggregate = createLinkPickerPropertyItems(
        this.config,
        this.linkSession.resolved,
      );
      if (!aggregate.valid) {
        new Notice(aggregate.error);
        items = [];
      } else {
        items = aggregate.items;
      }
    } else if (this.isCountedSession()) {
      const aggregate = createCountedBulletPropertyItems(
        this.config,
        this.getEditorContent(),
        this.taskSession,
      );
      if (!aggregate.valid) {
        new Notice(aggregate.error);
        items = [];
      } else {
        items = aggregate.items;
      }
    } else {
      items = createBulletPropertyItems(
        this.config,
        this.lineText,
        this.propertyContext,
      );
    }
    const laneDescription = this.isLinkSession()
      ? describeLaneRow("", {
          linkResolved: this.linkSession.resolved,
        })
      : this.isCountedSession()
        ? describeLaneRow(this.getEditorContent(), {
            taskSession: this.taskSession,
          })
        : describeLaneRow(this.getEditorContent(), {
            cursorLine: this.cursor ? this.cursor.line : NaN,
          });
    let propertyItems = Array.isArray(items) ? items : [];
    if (laneDescription) {
      const laneItem = Object.freeze({
        kind: "lane-toggle",
        property: Object.freeze({ name: "lane" }),
        title: laneDescription.mode === "release" ? "Release to Ready" : "Commit to Next",
        detail: laneDescription.detail,
        mode: laneDescription.mode,
        needsReason: laneDescription.needsReason,
        targetCount: laneDescription.count,
        laneKind: laneDescription.kind,
        order: -1,
      });
      propertyItems = [laneItem, ...propertyItems];
    }
    // Pinned refresh row (nav-stamps), right after the lane row, in task,
    // counted and link mode. Without the freshness api the row stays hidden.
    // It writes through `api.freshness.setRefreshLine`, which also stamps.
    {
      const freshnessApi =
        this.plugin && typeof this.plugin.getFreshnessApi === "function"
          ? this.plugin.getFreshnessApi()
          : getReviewFreshnessApi(this.app);
      const refreshDescription = this.isLinkSession()
        ? describeRefreshRow("", {
            linkResolved: this.linkSession.resolved,
            freshnessApi,
          })
        : this.isCountedSession()
          ? describeRefreshRow(this.getEditorContent(), {
              taskSession: this.taskSession,
              freshnessApi,
            })
          : describeRefreshRow(this.getEditorContent(), {
              cursorLine: this.cursor ? this.cursor.line : NaN,
              freshnessApi,
            });
      if (refreshDescription) {
        const refreshItem = Object.freeze({
          kind: "refresh-interval",
          property: Object.freeze({ name: "refresh" }),
          title: "Refresh every",
          detail: refreshDescription.detail,
          days: refreshDescription.days,
          source: refreshDescription.source,
          mixed: refreshDescription.mixed === true,
          openCount: refreshDescription.openCount,
          targetCount: refreshDescription.count,
          refreshKind: refreshDescription.kind,
          order: -0.5,
          searchText: `refresh interval every ${refreshDescription.detail || ""} refresh`,
        });
        const laneIndex = propertyItems.findIndex((item) => item && item.kind === "lane-toggle");
        if (laneIndex >= 0) {
          propertyItems = [
            ...propertyItems.slice(0, laneIndex + 1),
            refreshItem,
            ...propertyItems.slice(laneIndex + 1),
          ];
        } else {
          propertyItems = [refreshItem, ...propertyItems];
        }
      }
    }
    const cancelDescription = this.isLinkSession()
      ? describeCancelTaskRow("", {
          linkResolved: this.linkSession.resolved,
        })
      : this.isCountedSession()
        ? describeCancelTaskRow(this.getEditorContent(), {
            taskSession: this.taskSession,
          })
        : describeCancelTaskRow(this.getEditorContent(), {
            cursorLine: this.cursor ? this.cursor.line : NaN,
          });
    if (cancelDescription) {
      const cancelTitle = getCancelTaskRowTitle(cancelDescription);
      const cancelItem = Object.freeze({
        kind: "cancel-task",
        property: Object.freeze({ name: "cancel" }),
        title: cancelTitle,
        detail: cancelDescription.detail,
        recurring: cancelDescription.recurring === true,
        cancelKind: cancelDescription.kind,
        openCount: cancelDescription.openCount,
        closedCount: cancelDescription.closedCount,
        fromStatus: cancelDescription.fromStatus,
        searchText: `cancel cancelled canceled abandon drop obsolete wontfix won't do close ❌ ${cancelTitle} ${cancelDescription.detail || ""}`,
      });
      propertyItems = [...propertyItems, cancelItem];
    }
    return propertyItems;
  }

  refreshPropertyItems() {
    const propertyItems = this.buildPropertyItems();
    this.propertyItems = Array.isArray(propertyItems) ? propertyItems : [];
    return this.propertyItems;
  }

  showValueStage(propertyItem) {
    if (propertyItem && propertyItem.kind === "refresh-interval") {
      this.showRefreshValueStage(propertyItem);
      return;
    }
    if (propertyItem && propertyItem.kind === "cancel-task") {
      if (propertyItem.recurring) {
        new Notice(
          "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
        );
        return;
      }
      this.showCancelReasonStage(propertyItem);
      return;
    }
    if (propertyItem && propertyItem.kind === "lane-toggle") {
      if (propertyItem.needsReason) {
        this.showLaneReleaseReasonStage(propertyItem);
        return;
      }
      void this.plugin
        .applyLaneToggleFromPicker(this)
        .then((applied) => {
          if (applied !== true) {
            this.returnHome();
          }
        })
        .catch(() => {
          this.returnHome();
        });
      return;
    }
    this.stage = "value";
    this.selectedPropertyItem = propertyItem;
    this.pendingTask = null;
    this.valueBaseDate =
      this.fixedValueBaseDate || getLocalDateStart(new Date());
    this.selectedIndex = 0;
    const property = propertyItem.property;
    if (property.values === "local_task_id") {
      if (this.isLinkSession()) {
        // Task Link mode: the Depends on row edits the linked task in its
        // own note (`docs/task-dependencies.md` §6.1), for single links and
        // batches alike. Batches open each linked task's stage in turn.
        if (propertyItem.linkDependency) {
          const resolved = Array.isArray(this.linkSession.resolved)
            ? this.linkSession.resolved
            : [];
          if (resolved.length === 1) {
            const target = resolved[0];
            this.close();
            void this.plugin.openLinkedDependencyStage(target);
            return;
          }
          if (resolved.length > 1) {
            const [first, ...rest] = resolved;
            this.close();
            void this.plugin.openLinkedDependencyStage(first);
            if (rest.length > 0) {
              new Notice(
                `⛓ Opened the first of ${resolved.length} linked tasks; reopen Depends on for the rest`,
              );
            }
            return;
          }
        }
        new Notice("No linked task to edit dependencies for");
        this.returnHome();
        return;
      }
      const validation = this.isCountedSession()
        ? validateCountedTaskSession(
            this.getEditorContent(),
            this.taskSession,
          )
        : validateDependencyParentForEditor(
            this.editor,
            this.cursor,
            this.lineText,
          );
      if (!validation.valid) {
        new Notice(validation.message || validation.error);
        this.returnHome();
        return;
      }
      if (!tryDependencyId(this.filePath, "task")) {
        new Notice(
          "Dependencies are unavailable: this note path cannot be encoded as a dependency ID",
        );
        this.returnHome();
        return;
      }
      this.showLocalTaskValueStage(propertyItem);
      return;
    }
    this.clearLocalTaskMarks();

    const isDateProperty = property.values === "date";
    const isScheduledProperty =
      isDateProperty &&
      normalizeBulletPropertyName(property.name) === "scheduled";
    const isPriorityProperty = property.values === "priority";
    const items = createBulletPropertyValueItems(
      propertyItem,
      this.valueBaseDate,
    );
    const priorityRollLevel = this.getPriorityRollLevel(property);
    // Counted batches use per-target rolls: when every target is a same-level
    // roll at one shared level the recommendation replaces the shared-date
    // pinned row, avoiding a duplicate. Otherwise the pinned row stays as the
    // explicit override.
    const countedBatchForStage =
      this.isCountedSession() && !this.isLinkSession()
        ? this.getCountedRollBatchForDateProperty(property.name)
        : null;
    const suppressCountedPinnedRoll = Boolean(
      countedBatchForStage && countedBatchForStage.allRollSameLevel,
    );
    if (priorityRollLevel && !suppressCountedPinnedRoll) {
      // For a same-level recommendation the pinned row shares the previewed
      // date, so Ctrl+Enter and Enter on the pinned row write the identical
      // date. For a decay or cancel it keeps its own same-level roll as the
      // explicit override, marked as over the ladder's limit.
      const sharedRoll = this.getScheduledRollRecommendation(property.name);
      if (sharedRoll && sharedRoll.kind === "roll") {
        items.unshift(
          createPriorityRollDateItemFromRecommendation(
            sharedRoll,
            propertyItem.currentValue || "",
          ) ||
            createPriorityRollDateItem(
              priorityRollLevel,
              this.valueBaseDate,
              propertyItem.currentValue || "",
              this.priorityRandom,
            ),
        );
      } else {
        const pinnedRoll = createPriorityRollDateItem(
          priorityRollLevel,
          this.valueBaseDate,
          propertyItem.currentValue || "",
          this.priorityRandom,
        );
        if (
          sharedRoll &&
          (sharedRoll.kind === "decay" ||
            sharedRoll.kind === "cancel" ||
            sharedRoll.kind === "unavailable")
        ) {
          const overLabel = getPriorityRollCurrentLabel(sharedRoll);
          if (overLabel) {
            pinnedRoll.detail = `${pinnedRoll.detail} · over ${overLabel}'s roll limit`;
          }
        }
        items.unshift(pinnedRoll);
      }
    }
    this.applyOptions({
      items,
      title: property.name,
      headerIcon: isDateProperty
        ? "calendar-days"
        : isPriorityProperty
          ? "signal-high"
          : "list-checks",
      inputLabel: `Filter ${property.name} values`,
      placeholder: isDateProperty
        ? isScheduledProperty
          ? "Type 3, 3d, mon, +3d, or 6/24"
          : "Type date, +3d, or 6/24"
        : isPriorityProperty
          ? "Filter priorities"
          : "Filter values",
      resultsLabel: isPriorityProperty
        ? "priority levels"
        : `${property.name} values`,
      emptyText: "No matching values",
      footerHints: getBulletPropertyStageTwoHints(
        Boolean(priorityRollLevel),
        this.getRollPreviewForDateProperty(property.name),
        {
          skipReason: isScheduledProperty,
        },
      ),
      getSubtitle: () => {
        const scope = this.isCountedSession()
          ? `${this.getTaskSessionSubtitle()} · `
          : "";
        if (propertyItem.valueState === "mixed") {
          return isPriorityProperty
            ? `${scope}Choose a level · rolls a scheduled date · current values mixed`
            : `${scope}Choose a value · current values mixed`;
        }
        const currentLabel = propertyItem.currentLabel || "";
        if (isPriorityProperty) {
          return currentLabel
            ? `${scope}Choose a level · rolls a scheduled date · current: ${currentLabel}`
            : `${scope}Choose a level · rolls a scheduled date`;
        }
        return currentLabel
          ? `${scope}Choose a value · current: ${currentLabel}`
          : `${scope}Choose a value`;
      },
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderValueItem(item, rowEl, query),
      openItem:
        normalizeBulletPropertyName(property.name) === "scheduled"
          ? (item) => this.commitScheduledDateItem(item)
          : (item) => this.maybeOfferPriorityWorkLog(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  // Refresh interval value stage (nav-stamps): presets plus "use default"
  // (clears `[refresh:: N]` via `setRefreshLine` with null, which also
  // stamps). A typed integer 1-365 applies as a custom value.
  showRefreshValueStage(refreshItem) {
    this.stage = "value";
    this.selectedPropertyItem = refreshItem;
    this.pendingTask = null;
    this.selectedIndex = 0;
    const currentDays =
      refreshItem && Number.isInteger(refreshItem.days) ? refreshItem.days : null;
    const items = createRefreshValueItems(currentDays);
    this.applyOptions({
      items,
      title: "Refresh every",
      headerIcon: "refresh-ccw",
      inputLabel: "Filter refresh intervals",
      placeholder: "Type days (1-365) or filter",
      resultsLabel: "refresh intervals",
      emptyText: "No matching intervals",
      footerHints: [
        { keys: ["↵"], label: "Apply" },
        { keys: ["esc"], label: "Close or dismiss" },
      ],
      getSubtitle: () => {
        const scope = this.isCountedSession()
          ? `${this.getTaskSessionSubtitle()} · `
          : "";
        if (refreshItem && refreshItem.mixed) {
          return `${scope}Choose days · current values mixed`;
        }
        if (Number.isInteger(currentDays)) {
          return `${scope}Choose days · current: every ${currentDays} d`;
        }
        return `${scope}Choose days · using default`;
      },
      filterItem: (item, query) => {
        if (!query || !String(query).trim()) {
          return true;
        }
        const custom = parseRefreshCustomValue(query);
        if (custom !== null && item && item.refreshDays === custom) {
          return true;
        }
        return fuzzyMatchesText(item.searchText || "", query);
      },
      renderItem: (item, rowEl, query) =>
        this.renderValueItem(item, rowEl, query),
      openItem: (item) => this.applySelectedValue(item),
    });
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  // Custom refresh entry: when the value-stage query itself is an integer
  // 1-365 with no matching preset row selected, apply it directly.
  applyRefreshCustomFromQuery(query) {
    const custom = parseRefreshCustomValue(query);
    if (custom === null) {
      return false;
    }
    return this.plugin.applyRefreshIntervalFromPicker(
      this,
      Object.freeze({
        kind: "value",
        value: custom,
        label: `${custom} days`,
        refreshDays: custom,
      }),
    );
  }

  // The scheduled value a picked date replaces: frontmatter for a ^prj task,
  // the inline field otherwise. Empty in a counted session, where each target's
  // own previous value is resolved by the counted planner instead.
  getPendingScheduleFrom() {
    const propertyItem = this.selectedPropertyItem;
    if (
      !propertyItem ||
      this.isCountedSession() ||
      this.isLinkSession()
    ) {
      return "";
    }

    return normalizeBulletPropertyValue(
      propertyItem.target && propertyItem.target.kind === "project-frontmatter"
        ? propertyItem.currentValue
        : this.getCurrentPropertyValue(propertyItem.property.name),
    );
  }

  // Whether pressing ↵ on an empty input still logs an entry: only when the
  // date actually moves and the task already keeps a log. A counted session
  // answers yes on behalf of the batch — each target is decided at write time.
  willLogWithoutReason() {
    const pending = this.pendingScheduleReason;
    if (!pending || !pending.to || pending.from === pending.to) {
      return false;
    }

    return (
      this.isCountedSession() ||
      this.isLinkSession() ||
      Boolean(findScheduleLogParent(this.getEditorContent(), this.cursor.line))
    );
  }

  // The pinned priority-roll row is a date the plugin chose, so it never prompts:
  // it writes straight through with a deterministic reason. Null when the roll
  // landed on the date the task already has.
  buildPriorityRollScheduleLogForItem(item) {
    if (!item || !item.priorityRoll || !item.level) {
      return null;
    }

    return buildPriorityRollScheduleLog({
      source: "scheduled",
      level: item.level,
      rolledDays: item.rolledDays,
      from: this.getPendingScheduleFrom(),
      to: item.value,
    });
  }

  // Live explicit targets for scheduling review/Work Log prompts. Counted and
  // single-note rows re-read the editor so a mid-review edit is visible.
  getSchedulingWorkLogTargets() {
    const path = typeof this.filePath === "string" ? this.filePath : "";
    if (this.isLinkSession()) {
      const resolved = Array.isArray(this.linkSession.resolved)
        ? this.linkSession.resolved
        : [];
      return resolved.map((target) => ({
        ...target,
        path: typeof target.path === "string" ? target.path : path,
      }));
    }
    if (this.isCountedSession() && this.taskSession) {
      return this.taskSession.targets.map((target) => ({
        ...target,
        path: typeof target.path === "string" ? target.path : path,
        rawLine:
          getEditorLine(this.editor, target.line) ?? target.rawLine,
      }));
    }
    if (this.cursor && Number.isInteger(this.cursor.line)) {
      return [
        {
          line: this.cursor.line,
          path,
          rawLine:
            getEditorLine(this.editor, this.cursor.line) ?? this.lineText,
        },
      ];
    }
    return [];
  }

  // Freeze a scheduled date pick and route it through the combined review:
  // one optional Reason plus Work summary form that commits nothing until
  // Enter, or an immediate write when an inline reason or Shift+Enter
  // blank-reason makes the Reason known and no Work Log target qualifies.
  // Invalid typed previews never write. Pinned rolls keep their deterministic
  // reason and skip this path.
  commitScheduledDateItem(item, options = {}) {
    if (!item) {
      return false;
    }
    if (item.priorityRoll) {
      return this.maybeOfferPinnedRollWorkLog(item);
    }
    if (item.typedSchedule && item.valid === false) {
      return false;
    }
    const skipReason = options.skipReason === true;
    const normalizedInline = normalizeScheduleReasonText(
      skipReason ? "" : String(item.inlineReason || ""),
    );
    return this.openScheduleReviewOrDispatch(item, {
      reason: skipReason ? "" : normalizedInline.reason,
      reasonSupplied: skipReason || !normalizedInline.empty,
    });
  }

  // Task Card explicit-date review: one optional Reason field plus Work
  // summary when any Next/Pending target qualifies. Inline/skip reasons with
  // no Work target dispatch immediately through the existing writer.
  openScheduleReviewOrDispatch(item, options = {}) {
    const from = this.getPendingScheduleFrom();
    const plan = planScheduleReview({
      dateItem: item,
      from,
      to: item && item.value,
      reason: options.reason,
      reasonSupplied: options.reasonSupplied === true,
      targets: this.getSchedulingWorkLogTargets(),
      isProject: Boolean(
        this.selectedPropertyItem &&
          this.selectedPropertyItem.target &&
          this.selectedPropertyItem.target.kind === "project-frontmatter",
      ),
      baseDate: this.valueBaseDate,
    });
    if (!plan.needsReview) {
      return this.applySelectedValue(item, {
        scheduleLog: {
          from: plan.from,
          to: plan.to,
          reason: plan.reason,
          fallbackReason: SCHEDULE_LOG_SKIPPED_REASON_TEXT,
        },
        schedulingWorkLog: null,
      });
    }
    this.showScheduleReviewStage(plan);
    return false;
  }

  // Combined Task Card review: Reason plus optional Work summary in one
  // uncommitted state. Nothing is written until Enter confirms both fields.
  showScheduleReviewStage(plan) {
    if (!plan || !plan.dateItem) {
      return;
    }
    this.ensureTaskCardStageChrome();
    this.stage = "schedule-review";
    this.pendingScheduleReview = Object.freeze({
      ...plan,
      resume: async ({ reason, summary }) => {
        const scheduleLog = {
          from: plan.from,
          to: plan.to,
          reason,
          fallbackReason: SCHEDULE_LOG_SKIPPED_REASON_TEXT,
        };
        return await this.applySelectedValue(plan.dateItem, {
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
        });
      },
    });
    this.pendingScheduleReason = Object.freeze({
      dateItem: plan.dateItem,
      from: plan.from,
      to: plan.to,
    });
    this.scheduleReviewFormEl = null;
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    this.applyOptions({
      items: [],
      title: plan.title || "Schedule task",
      headerIcon: "calendar-clock",
      inputLabel: "Reason for this date",
      placeholder: "Why this date? (optional)",
      resultsLabel: "Schedule review",
      emptyText: "Nothing written yet",
      footerHints: getScheduleReviewHints({
        empty: plan.reasonEmpty && !plan.needsWorkLog,
        hasWorkLog: plan.needsWorkLog,
      }),
      getSubtitle: () => this.getScheduleReviewSubtitle(),
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderScheduleReviewPreview(item, rowEl, query),
      openItem: () => this.confirmScheduleReview(),
    });
    if (!this.headerEl || !this.searchEl || !this.resultsEl) {
      FilteredPickerModal.prototype.onOpen.call(this);
      return;
    }
    this.renderAll();
  }

}
