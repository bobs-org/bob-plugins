class BulletPropertyPickerFilterRenderMixin extends FilteredPickerModal {
  getFilteredItems() {
    // Ranked, section-ordered rows for the vault-wide Depends on stage. The
    // sync pool never reads from disk; the one-time vault scan (when the
    // Tasks cache is not Warm) refreshes through `applyVaultStageItems`.
    if (this.isLocalTaskStage() && this.vaultStage) {
      try {
        return planDependencyStageView({
          current: this.vaultStage.current,
          candidates: this.vaultStage.candidates,
          query: this.getQuery(),
          dependent: this.vaultStage.dependent,
          edges: this.vaultStage.edges,
          linkedKeys: this.vaultStage.linkedKeys,
          sourceValueSets: this.vaultStage.sourceValueSets,
        });
      } catch (_error) {
        return super.getFilteredItems();
      }
    }
    if (this.stage === "schedule-review") {
      const reason = normalizeScheduleReasonText(this.getScheduleReviewReasonText());
      const summary = normalizeSchedulingWorkSummary(
        this.getScheduleReviewSummaryText(),
      );
      const pending = this.pendingScheduleReview;
      const parentExists = Boolean(
        findScheduleLogParent(this.getEditorContent(), this.cursor.line),
      );
      const fallback = reason.empty && this.willLogWithoutReason();
      return [
        Object.freeze({
          kind: "schedule-review-preview",
          reason: reason.reason,
          reasonEmpty: reason.empty,
          reasonHasInlineField: reason.hasInlineField,
          reasonFallback: fallback,
          summary,
          summaryEmpty: !summary,
          summaryHasInlineField: /::/.test(summary),
          parentExists,
          counted: this.isCountedSession() || this.isLinkSession(),
          eligibleCount: pending ? pending.eligibleCount : 0,
          searchText: reason.reason,
        }),
      ];
    }

    if (this.stage === "schedule-work-log") {
      const normalized = normalizeScheduleReasonText(this.getRawQuery());
      return [
        Object.freeze({
          kind: "schedule-work-log-preview",
          ...normalized,
          counted: this.isCountedSession() || this.isLinkSession(),
          searchText: normalized.reason,
        }),
      ];
    }

    if (this.stage === "lane-release-reason") {
      const normalized = normalizeScheduleReasonText(this.getRawQuery());
      const facts = this.getLaneReleaseReasonFacts();
      return [
        Object.freeze({
          kind: "lane-release-reason-preview",
          ...normalized,
          ...facts,
          counted: this.isCountedSession() || this.isLinkSession(),
          searchText: normalized.reason,
        }),
      ];
    }

    if (this.stage === "cancel-reason") {
      const normalized = normalizeScheduleReasonText(this.getRawQuery());
      const facts = this.getCancelReasonFacts();
      return [
        Object.freeze({
          kind: "cancel-reason-preview",
          ...normalized,
          ...facts,
          counted: this.isCountedSession() || this.isLinkSession(),
          fallback: normalized.empty && facts.anyLog,
          searchText: normalized.reason,
        }),
      ];
    }

    if (this.stage === "blockid") {
      // Uniqueness is checked against the target's note: cross-note `+ id`
      // rows prompt for an id that must be fresh in that note, not this one.
      const validation = validateBlockIdCandidate(
        this.getRawQuery(),
        this.getBlockIdStageContent(),
        { reservedIds: this.getBlockIdReservedIds() },
      );
      return [
        Object.freeze({
          kind: "blockid-preview",
          ...validation,
          task: this.pendingTask,
          searchText: validation.id,
        }),
      ];
    }

    const items = super.getFilteredItems();
    if (
      this.stage !== "value" ||
      !this.selectedPropertyItem ||
      this.selectedPropertyItem.property.values !== "date"
    ) {
      return items;
    }

    const currentValue = this.selectedPropertyItem.currentValue || "";
    const isScheduledProperty =
      normalizeBulletPropertyName(this.selectedPropertyItem.property.name) ===
      "scheduled";
    if (isScheduledProperty) {
      const typedItem = createTypedScheduleValueItem(
        resolveTypedSchedule(this.getRawQuery(), this.valueBaseDate),
        this.valueBaseDate,
        currentValue,
      );
      if (!typedItem) {
        return items;
      }
      return [
        typedItem,
        ...items.filter(
          (item) => !typedItem.value || item.value !== typedItem.value,
        ),
      ];
    }

    const typedItem = createBulletPropertyTypedDateItem(
      this.getRawQuery(),
      this.valueBaseDate,
      currentValue,
    );
    if (!typedItem) {
      return items;
    }

    return [
      typedItem,
      ...items.filter((item) => item.value !== typedItem.value),
    ];
  }

  // The base class's input listener only calls renderResults(), so this is
  // what flips the reason-stage footer hint (Skip reason ⇄ Log reason) live
  // as the user types, mirroring refreshLocalTaskFooter.
  renderResults() {
    super.renderResults();
    if (this.stage === "cancel-reason") {
      const item = (this.visibleItems || [])[0];
      const pending = this.pendingCancel;
      this.footerHints = getCancelReasonHints({
        empty: Boolean(item && item.empty),
        fallback: Boolean(item && item.fallback),
        count: pending ? pending.openCount : 1,
      });
      this.renderFooter();
    }
    if (this.stage === "lane-release-reason") {
      const item = (this.visibleItems || [])[0];
      this.footerHints = getLaneReleaseReasonHints({
        empty: Boolean(item && item.empty),
      });
      this.renderFooter();
    }
    if (this.stage === "schedule-work-log") {
      const item = (this.visibleItems || [])[0];
      this.footerHints = getSchedulingWorkLogHints({
        empty: Boolean(item && item.empty),
      });
      this.renderFooter();
    }
    if (this.stage === "schedule-review") {
      const item = (this.visibleItems || [])[0];
      const pending = this.pendingScheduleReview;
      this.footerHints = getScheduleReviewHints({
        empty: Boolean(item && item.reasonEmpty && item.summaryEmpty),
        hasWorkLog: Boolean(pending && pending.needsWorkLog),
      });
      this.renderFooter();
    }
  }

  renderValueItem(item, rowEl, query) {
    addElementClasses(
      rowEl,
      "bob-cnp-property-value-row",
      item.priorityLevel ? "bob-cnp-priority-value-row" : "",
      item.priorityRoll ? "is-priority-roll" : "",
      item.current ? "is-current" : "",
      item.dynamic ? "is-dynamic" : "",
      item.typedSchedule && item.valid === false ? "is-invalid" : "",
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(
      rowIcon,
      item.priorityRoll
        ? "dices"
        : item.typedSchedule && item.valid === false
          ? "alert-triangle"
          : item.current
            ? "check-circle-2"
            : item.dynamic
              ? "calendar-plus"
              : "circle",
    );

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.label, query);

    if (item.detail) {
      const detailEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
      appendHighlighted(detailEl, item.detail, query);
    }

    if (item.current) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: "current",
      });
    }
    if (item.priorityLevel) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: `${item.priorityLevel.minDays}–${item.priorityLevel.maxDays}d`,
      });
    }
    if (item.priorityRoll) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: item.level.label,
      });
    }
  }

  renderTaskValueItem(item, rowEl, query) {
    // CURRENT / RESULTS / BLOCKED section headers for the vault-wide stage
    // (`docs/task-dependencies.md` §6).
    if (item && item.stageSection && item.firstInSection) {
      const sectionNames = { current: "CURRENT", results: "RESULTS", blocked: "BLOCKED" };
      rowEl.createDiv({
        cls: "bob-cnp-section-header",
        text: sectionNames[item.stageSection] || item.stageSection,
      });
    }
    // The ~60-row cap hint row: muted, non-interactive, styled on its own.
    if (item && item.kind === "stage-more") {
      addElementClasses(rowEl, "bob-cnp-task-value-row", "bob-cnp-dep-row", "bob-cnp-dep-more", "is-disabled");
      rowEl.setAttribute("aria-disabled", "true");
      const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text bob-cnp-dep-text" });
      const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
      titleEl.setText(item.displayText || "type to search more");
      return;
    }
    const markKey = bulletPropertyTaskMarkKey(item);
    const marked =
      this.markedLines instanceof Set &&
      markKey !== null &&
      this.markedLines.has(markKey);
    const markedRemove = marked && item.alreadyLinked;
    const markedNeedsId = marked && !item.alreadyLinked && item.needsPromptForAdd;
    const markedAdd = marked && !item.alreadyLinked && !item.needsPromptForAdd;
    addElementClasses(
      rowEl,
      "bob-cnp-task-value-row",
      "bob-cnp-dep-row",
      item.hidden ? "bob-cnp-dep-hidden" : "",
      item.stageSection === "blocked" ? "bob-cnp-dep-blocked" : "",
      item.alreadyLinked ? "is-linked" : "",
      item.linkState === "mixed" ? "is-mixed" : "",
      item.needsBlockIdPrompt ? "is-create" : "is-existing",
      item.disabled ? "is-disabled" : "",
      item.stageSection ? `is-stage-${item.stageSection}` : "",
      marked ? "is-marked" : "",
      markedRemove ? "is-marked-remove" : "",
      markedAdd ? "is-marked-add" : "",
      markedNeedsId ? "is-marked-id-needed" : "",
    );
    if (item.disabled) {
      rowEl.setAttribute("aria-disabled", "true");
    }
    // Muted `#hide` rows carry the design tooltip; disabled rows expose
    // the short reason plus the cycle path when present.
    if (item.hidden) {
      rowEl.setAttribute("title", "#hide · muted · ranked last");
    }

    const markEl = rowEl.createDiv({
      cls: marked ? "bob-cnp-mark is-marked" : "bob-cnp-mark",
      attr: {
        "aria-hidden": "true",
      },
    });
    if (marked) {
      markEl.setText("✓");
    }

    rowEl.createDiv({
      cls: `bob-cnp-status-pill bob-cnp-dep-status is-${taskStatusClass(item.status)}`,
      text: taskStatusLabel(item.status),
    });

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text bob-cnp-dep-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.displayText, query);

    const metaEl = textEl.createDiv({ cls: "bob-cnp-row-meta bob-cnp-dep-meta" });
    // Cross-note rows name their note (`↗ note`); the badge below always
    // shows the block id, never the path-encoded id (§6.3).
    const metaBits = [];
    if (item.noteLabel) {
      metaBits.push(`↗ ${item.noteLabel}`);
    }
    if (Number.isInteger(item.line) && item.line >= 0) {
      metaBits.push(`Line ${item.line + 1}`);
    }
    if (item.cycle && item.cycle.length > 0) {
      metaBits.push(`⟲ ${item.cycle.length - 1} back-link${item.cycle.length - 1 === 1 ? "" : "s"}`);
    }
    metaEl.createSpan({
      text:
        metaBits.join(" · ") ||
        (item.missing ? "missing link · removable" : ""),
    });
    if (item.disabled && item.disabledReason) {
      const guardEl = metaEl.createSpan({
        cls: "bob-cnp-row-guard bob-cnp-dep-guard",
        text: item.disabledReason,
      });
      // Disabled rows expose the cycle path in the tooltip when present:
      // task descriptions joined by `→`, with raw keys only where no row
      // names the key.
      if (item.cycle && item.cycle.length > 0 && guardEl) {
        try {
          const path =
            item.cycleLabels && item.cycleLabels.length === item.cycle.length
              ? item.cycleLabels
              : item.cycle;
          guardEl.setAttribute("title", path.join(" → "));
        } catch (_guardTitleError) {
          // Best-effort tooltip only.
        }
      }
    }

    const badgeClasses = [
      "bob-cnp-task-badge",
      markedRemove
        ? "is-marked-remove"
        : markedNeedsId
          ? "is-marked-id-needed"
          : markedAdd
            ? "is-marked-add"
            : item.alreadyLinked
              ? "is-linked"
              : item.needsBlockIdPrompt
                ? "is-create"
                : "is-existing",
    ];
    const badgeEl = rowEl.createDiv({ cls: `bob-cnp-dep-badge ${badgeClasses.join(" ")}` });
    if (markedRemove) {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: "− remove",
      });
    } else if (markedNeedsId) {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋ id" });
    } else if (markedAdd) {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋ add" });
    } else if (
      item.stageSection === "blocked" &&
      (typeof item.blockedBadge === "string" || Number.isInteger(item.waitsOn))
    ) {
      // BLOCKED rows name what blocks them: `🔒 waits on N` (N >= 1), else
      // `🔒 scheduled YYYY-MM-DD`, else `🔒 blocked`.
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action bob-cnp-dep-waits",
        text:
          typeof item.blockedBadge === "string"
            ? item.blockedBadge
            : `🔒 waits on ${item.waitsOn}`,
      });
    } else if (item.alreadyLinked) {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: "−",
      });
    } else if (item.linkState === "mixed") {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: `${item.linkedSourceCount}/${item.sourceCount} depend`,
      });
    } else if (item.needsBlockIdPrompt) {
      // Unmarked, not yet linked, and missing a trailing block ID: pressing
      // Enter prompts for one before linking.
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋ id" });
    } else {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋" });
    }
  }

  renderBlockIdPreviewItem(item, rowEl, query) {
    addElementClasses(
      rowEl,
      "bob-cnp-blockid-preview-row",
      `is-${item.state}`,
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, item.valid ? "check-circle-2" : "alert-triangle");

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.id || "(type an id)", query);

    textEl.createDiv({
      cls: "bob-cnp-row-meta",
      text: item.message,
    });

    const taskTitle =
      item.task && item.task.displayText
        ? item.task.displayText
        : "(untitled task)";
    const existingIdField =
      item.task && item.task.existingIdField
        ? normalizeBulletPropertyValue(item.task.existingIdField)
        : "";
    const idDisplay = item.id || "id";
    // Confirmation appends the trailing `^id` block target and replaces an
    // existing dependency value with the canonical path-qualified ID.
    const previewText = existingIdField
      ? `Appends ^${idDisplay}; replaces [id:: ${existingIdField}] with the canonical ID on: ${taskTitle}`
      : `Adds [id:: ${idDisplay}] ^${idDisplay} to: ${taskTitle}`;
    textEl.createDiv({
      cls: "bob-cnp-blockid-preview",
      text: previewText,
    });
  }

  async chooseTaskDependency(item) {
    if (!this.selectedPropertyItem) {
      return false;
    }

    if (this.isCountedSession()) {
      return this.chooseCountedTaskDependency(item);
    }

    if (!item) {
      return false;
    }

    if (this.getMarkedCount() > 0) {
      return this.commitMarkedDependencies();
    }

    // Guarded rows are disabled with their reason; removing a CURRENT link
    // is always allowed, so CURRENT rows are never disabled.
    if (item.disabled) {
      new Notice(item.disabledReason || "That task cannot be linked");
      return false;
    }

    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }

    // CURRENT rows toggle off: ↵ removes that prerequisite. Cross-note rows
    // commit through the vault path with a stale re-read.
    if (item.stageSection === "current" && item.alreadyLinked) {
      return this.removeSingleDependency(item);
    }
    if (
      item.path &&
      normalizeVaultRelativePath(item.path) !==
        normalizeVaultRelativePath(this.filePath)
    ) {
      return this.chooseVaultTaskDependency(item);
    }

    // Single-select path. Re-read the target so a stale row never writes:
    // refuse with `changed — reopen`, then reopen the stage fresh (§6.4).
    const targetLine = getEditorLine(this.editor, item.line);
    if (targetLine !== item.rawLine) {
      return this.refuseDependencyStale();
    }
    if (!isObsidianTaskAtLine(this.getEditorContent(), item.line)) {
      return this.refuseDependencyStale();
    }

    // A missing trailing block ID always prompts, even when an `[id:: value]`
    // is already present; confirmation replaces it with the canonical ID.
    const resolved = resolveTargetTaskIdentity(targetLine, {
      promptWhenBlockIdMissing: true,
      filePath: this.filePath,
    });
    if (resolved.needsBlockIdPrompt) {
      this.showBlockIdStage(item, { mode: "single" });
      return false;
    }

    if (!resolved.value) {
      new Notice("Could not identify task");
      return false;
    }

    // An existing valid `[id::]` is never rewritten (§3): the missing-id
    // edit folds into the writer's one transaction below (one Ctrl+Z). The
    // planner resolves the kept id for the field.
    const missingIdEdits = resolved.targetEdits.filter(
      (edit) => edit.kind === "add-id-field",
    );
    const pendingTargetLine =
      missingIdEdits.length > 0
        ? {
            line: item.line,
            expected: targetLine,
            text: missingIdEdits[missingIdEdits.length - 1].line,
          }
        : null;

    return this.plugin.setLocalTaskDependency(
      this.editor,
      this.cursor,
      this.selectedPropertyItem.property.name,
      resolved.value,
      {
        linkBlockId: resolved.linkBlockId,
        filePath: this.filePath,
        pendingTargetLine,
      },
    );
  }

}
