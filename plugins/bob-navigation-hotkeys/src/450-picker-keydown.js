class BulletPropertyPickerKeydownMixin extends FilteredPickerModal {
  handleKeydown(event) {
    if (this.stage === "task-card") {
      this.handleTaskCardKeydown(event);
      return;
    }
    // Ctrl+[ closes from every stage, including a focused date, filter,
    // reason, or Work summary field. Closing discards uncommitted state and
    // writes nothing, exactly as Escape does.
    if (
      event &&
      event.isComposing !== true &&
      event.keyCode !== 229 &&
      isCtrlLeftBracketKeydown(event)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (this.stage === "schedule-review" && event) {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.cycleScheduleReviewFocus(event, event.shiftKey === true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (this.opening) {
          return;
        }
        this.opening = true;
        Promise.resolve(this.confirmScheduleReview())
          .then((applied) => {
            if (applied === true) {
              this.close();
            }
          })
          .catch(() => false)
          .finally(() => {
            this.opening = false;
          });
        return;
      }
      if (
        event.key === "Backspace" &&
        this.scheduleReviewSummaryEl &&
        event.target === this.scheduleReviewSummaryEl &&
        !String(this.scheduleReviewSummaryEl.value || "")
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (this.scheduleReviewReasonEl && typeof this.scheduleReviewReasonEl.focus === "function") {
          this.scheduleReviewReasonEl.focus();
        }
        return;
      }
    }
    if (
      this.hasTaskCard &&
      this.stage !== "task-card" &&
      event &&
      event.key === "Backspace" &&
      event.target === this.inputEl &&
      this.inputEl &&
      !String(this.inputEl.value || "")
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.returnToTaskCard();
      return;
    }
    // Ctrl+Enter (or Cmd+Enter) on `scheduled` takes the recommended roll in
    // both picker stages. Anywhere else it behaves exactly like Enter, as it
    // does today; other stages keep their existing key handling untouched.
    // Counted and link sessions use their batch recommendation through the
    // same gesture.
    if (isRecommendedRollKeydown(event) && this.stage === "value") {
      event.preventDefault();
      event.stopPropagation();
      if (!this.opening) {
        const rollPropertyName =
          this.selectedPropertyItem && this.selectedPropertyItem.property
            ? this.selectedPropertyItem.property.name
            : "";
        if (
          rollPropertyName &&
          this.hasCountedRollBatchForDateProperty(rollPropertyName)
        ) {
          void this.applyCountedRecommendedRoll()
            .then((applied) => {
              if (applied === true) {
                this.close();
              }
            })
            .catch(() => {
              new Notice("Could not apply the recommended roll");
            });
        } else if (
          rollPropertyName &&
          this.hasLinkRollBatchForDateProperty(rollPropertyName)
        ) {
          void this.applyLinkRecommendedRoll()
            .then((applied) => {
              if (applied === true) {
                this.close();
              }
            })
            .catch(() => {
              new Notice("Could not apply the recommended roll");
            });
        } else if (
          rollPropertyName &&
          this.getScheduledRollRecommendation(rollPropertyName)
        ) {
          void this.applyRecommendedRoll()
            .then((applied) => {
              if (applied === true) {
                this.close();
              }
            })
            .catch(() => {
              new Notice("Could not apply the recommended roll");
            });
        } else {
          super.handleKeydown(event);
        }
      }
      return;
    }

    if (
      this.isLocalTaskStage() &&
      !this.isCountedSession() &&
      event.key === "Tab"
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleHighlightedLocalTaskMark();
      return;
    }

    if (
      this.isLocalTaskStage() &&
      event.key === "Enter" &&
      this.getMarkedCount() > 0
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.opening) {
        return;
      }

      this.opening = true;
      const markedOutcome = this.commitMarkedDependencies();
      // Batches commit asynchronously (stale re-read per target, target
      // preparation, and recovery); the modal closes when the outcome
      // resolves truthy.
      if (markedOutcome && typeof markedOutcome.then === "function") {
        markedOutcome
          .then((applied) => {
            if (applied) {
              this.close();
            }
          })
          .catch(() => false)
          .finally(() => {
            this.opening = false;
          });
      } else {
        try {
          if (markedOutcome) {
            this.close();
          }
        } finally {
          this.opening = false;
        }
      }
      return;
    }

    if (this.stage === "value" && isCtrlKey(event, "r")) {
      if (this.isLinkSession()) {
        // Link sessions keep no pinned roll row: re-roll the batch so the
        // stage-two footer preview stays in sync.
        if (this.rerollLinkRollBatch()) {
          this.applyOptions({
            footerHints: getBulletPropertyStageTwoHints(
              Boolean(
                this.items.some((item) => item && item.priorityRoll),
              ),
              this.selectedPropertyItem
                ? this.getRollPreviewForDateProperty(
                    this.selectedPropertyItem.property.name,
                  )
                : null,
              { skipReason: this.isScheduledValueStage() },
            ),
          });
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      } else if (this.isCountedSession()) {
        let rerolled = false;
        if (this.rerollCountedRollBatch()) {
          this.applyOptions({
            footerHints: getBulletPropertyStageTwoHints(
              Boolean(
                this.items.some((item) => item && item.priorityRoll),
              ),
              this.selectedPropertyItem
                ? this.getRollPreviewForDateProperty(
                    this.selectedPropertyItem.property.name,
                  )
                : null,
              { skipReason: this.isScheduledValueStage() },
            ),
          });
          rerolled = true;
        }
        if (this.rerollPriorityDateSuggestion()) {
          rerolled = true;
        }
        if (rerolled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      } else if (this.rerollPriorityDateSuggestion()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (
      this.isScheduledValueStage() &&
      event &&
      event.key === "Enter" &&
      event.shiftKey === true &&
      event.ctrlKey !== true &&
      event.metaKey !== true &&
      event.altKey !== true
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.opening) {
        return;
      }
      const item = this.visibleItems[this.selectedIndex];
      if (!item) {
        return;
      }
      this.opening = true;
      Promise.resolve(this.commitScheduledDateItem(item, { skipReason: true }))
        .then((applied) => {
          if (applied === true) {
            this.close();
          }
        })
        .catch(() => false)
        .finally(() => {
          this.opening = false;
        });
      return;
    }

    super.handleKeydown(event);
  }

  async deletePropertyItem(item) {
    if (!item || item.kind !== "property") {
      return false;
    }

    const propertyName = item.property.name;
    if (!item.defined) {
      new Notice(
        item.target.kind === "project-frontmatter"
          ? `${propertyName} is not set on this project`
          : `${propertyName} is not set on this bullet`,
      );
      return false;
    }
    // Project-frontmatter writers stay unwrapped (task-card-gate).
    if (
      !this.isLinkSession() &&
      !this.isCountedSession() &&
      item.target &&
      item.target.kind === "project-frontmatter"
    ) {
      const direct = await this.plugin.deleteProjectNoteScheduledValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        item.currentValue,
      );
      if (!direct || direct.deleted !== true) {
        if (direct && direct.line) {
          this.lineText = direct.line;
          this.bulletSubtitle = truncateBulletPropertySubtitle(direct.line);
          this.refreshPropertyItems();
        }
        return false;
      }
      return true;
    }

    const action = { label: `clear ${propertyName}` };
    const write = async () => {
      const result = await (this.isLinkSession()
        ? this.plugin.deleteLinkPickerPropertyValue(this, item)
        : this.isCountedSession()
          ? this.plugin.deleteCountedBulletPropertyValue(
              this.editor,
              this.cursor,
              this.filePath,
              this.taskSession,
              propertyName,
            )
          : item.target.kind === "project-frontmatter"
            ? await this.plugin.deleteProjectNoteScheduledValue(
                this.editor,
                this.cursor,
                this.filePath,
                this.lineText,
                item.currentValue,
              )
            : this.plugin.deleteBulletPropertyValue(
                this.editor,
                this.cursor,
                propertyName,
                {
                  filePath: this.filePath,
                  expectedLine: this.lineText,
                },
              ));
      if (!result || result.deleted !== true) {
        if (result && result.line) {
          this.lineText = result.line;
          this.bulletSubtitle = truncateBulletPropertySubtitle(result.line);
          this.refreshPropertyItems();
        }
        return false;
      }

      return true;
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(action, write);
    }
    return await write();
  }

  describeInboxRouteSelectedValueAction(item) {
    try {
      const selected = this.selectedPropertyItem;
      if (!selected) {
        return { label: "apply" };
      }
      if (selected.kind === "refresh-interval") {
        const days =
          (item && (item.refreshDays ?? item.value)) || selected.days || "";
        return { label: days ? `review every ${days}d` : "review every" };
      }
      const propertyName =
        (selected.property && selected.property.name) || "property";
      if (selected.property && selected.property.values === "priority") {
        const level =
          (item && (item.label || item.value)) ||
          (item && item.priorityLevel && item.priorityLevel.label) ||
          "";
        return { label: level ? `set ${level}` : `set ${propertyName}` };
      }
      if (propertyName === "scheduled" || propertyName === "scheduledDate") {
        const date = (item && (item.value || item.label)) || "";
        return { label: date ? `schedule ${date}` : "schedule" };
      }
      const value = (item && (item.value ?? item.label)) || "";
      return {
        label: value ? `set ${propertyName} ${value}` : `set ${propertyName}`,
      };
    } catch (error) {
      return { label: "apply" };
    }
  }

  async applySelectedValue(item, options = {}) {
    if (!this.selectedPropertyItem || !item) {
      return false;
    }

    // Project-frontmatter writers stay unwrapped (task-card-gate).
    const selectedTarget =
      this.selectedPropertyItem && this.selectedPropertyItem.target;
    if (
      !this.isLinkSession() &&
      !this.isCountedSession() &&
      selectedTarget &&
      selectedTarget.kind === "project-frontmatter"
    ) {
      if (this.selectedPropertyItem.kind === "refresh-interval") {
        return await this.plugin.applyRefreshIntervalFromPicker(this, item, options);
      }
      const schedulingWorkLogDirect =
        options.schedulingWorkLog || options.workLog || null;
      if (this.selectedPropertyItem.property.values === "priority") {
        return await this.plugin.setBulletPriorityValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.lineText,
          this.selectedPropertyItem.property,
          item.priorityLevel,
          {
            propertyContext: this.propertyContext,
            baseDate: this.valueBaseDate,
            random: this.priorityRandom,
            schedulingWorkLog: schedulingWorkLogDirect,
            precomputedRoll: options.precomputedRoll,
          },
        );
      }
      return await this.plugin.setProjectNoteScheduledValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        this.selectedPropertyItem.currentValue,
        item.value,
        { scheduleLog: options.scheduleLog, schedulingWorkLog: schedulingWorkLogDirect },
      );
    }

    if (this.selectedPropertyItem.kind === "refresh-interval") {
      const refreshAction = this.describeInboxRouteSelectedValueAction(item);
      const refreshWrite = async () =>
        await this.plugin.applyRefreshIntervalFromPicker(this, item, options);
      if (typeof this.runInboxRoutedCommit === "function") {
        return await this.runInboxRoutedCommit(refreshAction, refreshWrite);
      }
      return await refreshWrite();
    }

    const schedulingWorkLog =
      options.schedulingWorkLog || options.workLog || null;

    if (this.isLinkSession()) {
      return await this.plugin.applyLinkPickerPropertyValue(
        this,
        item,
        {
          ...options,
          schedulingWorkLog,
        },
      );
    }

    const selectedAction = this.describeInboxRouteSelectedValueAction(item);
    const selectedWrite = async () => {
      if (this.isCountedSession()) {
        if (this.selectedPropertyItem.property.values === "priority") {
          return await this.plugin.setCountedBulletPriorityValue(
            this.editor,
            this.cursor,
            this.filePath,
            this.taskSession,
            this.selectedPropertyItem.property,
            item.priorityLevel,
            {
              baseDate: this.valueBaseDate,
              random: this.priorityRandom,
              schedulingWorkLog,
              precomputedRollByLine: options.precomputedRollByLine,
              precomputedScheduledValueByLine:
                options.precomputedScheduledValueByLine,
              rollByLine: options.rollByLine,
              scheduledValueByLine: options.scheduledValueByLine,
            },
          );
        }
        return await this.plugin.setCountedBulletPropertyValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.taskSession,
          this.selectedPropertyItem.property.name,
          item.value,
          { scheduleLog: options.scheduleLog, schedulingWorkLog },
        );
      }

      if (this.selectedPropertyItem.property.values === "priority") {
        return await this.plugin.setBulletPriorityValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.lineText,
          this.selectedPropertyItem.property,
          item.priorityLevel,
          {
            propertyContext: this.propertyContext,
            baseDate: this.valueBaseDate,
            random: this.priorityRandom,
            schedulingWorkLog,
            precomputedRoll: options.precomputedRoll,
          },
        );
      }

      if (this.selectedPropertyItem.target.kind === "project-frontmatter") {
        return await this.plugin.setProjectNoteScheduledValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.lineText,
          this.selectedPropertyItem.currentValue,
          item.value,
          { scheduleLog: options.scheduleLog, schedulingWorkLog },
        );
      }

      return await this.plugin.setBulletPropertyValue(
        this.editor,
        this.cursor,
        this.selectedPropertyItem.property.name,
        item.value,
        {
          filePath: this.filePath,
          expectedLine: this.lineText,
          scheduleLog: options.scheduleLog,
          schedulingWorkLog,
        },
      );
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(selectedAction, selectedWrite);
    }
    return await selectedWrite();
  }
}
