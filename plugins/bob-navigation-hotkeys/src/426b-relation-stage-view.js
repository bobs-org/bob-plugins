// Relation-stage list, footer, subtitle, and strip view helpers.
// Split out of 426-picker-relation-stage.js to keep that fragment at or
// under the 1000-line cap. Installed as BulletPropertyPickerRelationStageViewMixin.
class BulletPropertyPickerRelationStageViewMixin {
  relationStageListOptions() {
    const title =
      (this.vaultStage && this.vaultStage.title) || "🪢 Links";
    return {
      items: this.vaultStage
        ? planRelationStageItemsFromVault(
            this.vaultStage,
            this.getQuery ? this.getQuery() : "",
            this.plugin,
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
    // §19: footer hints follow the selected row's kind — a mention row
    // opens instead of linking.
    if (item && item.mention === true && marked === 0) {
      const hints = [
        { keys: ["↑", "↓"], label: "navigate" },
        { keys: ["↵"], label: "open mention" },
        { keys: ["⌃↵"], label: "add relation" },
      ];
      if (!this.taskSession || this.taskSession.type === "single") {
        hints.push({ keys: ["~"], label: "flip direction" });
      }
      hints.push({ keys: ["esc"], label: "dismiss" });
      return hints;
    }
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
      { keys: ["⌃↵"], label: "with a relation" },
    ];
    if (!this.taskSession || this.taskSession.type === "single") {
      hints.push({ keys: ["~"], label: "flip direction" });
    }
    hints.push({ keys: ["esc"], label: "dismiss" });
    try {
      if (typeof tieGetArmed === "function" && tieGetArmed(this)) {
        return [...hints, { keys: ["↵"], label: "again to confirm" }];
      }
      if (marked === 0 && typeof tieChordHintsForItem === "function") {
        const chords = tieChordHintsForItem(this, item);
        if (chords.length > 0) {
          return [
            ...hints.filter((hint) => !hint.keys.includes("↑")),
            ...chords,
          ];
        }
      }
    } catch (_tieRelationFooterError) {}
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
    if (!this.isRelationStage() && this.stage !== "relation-label") {
      if (this.consequenceStripEl) this.consequenceStripEl.setText("");
      return;
    }
    const el = this.ensureRelationConsequenceStrip();
    if (!el) return;
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    if (this.stage === "relation-label") {
      if (item && item.configuredMerge === true) {
        const mergePreview = this.relationMergePreview || null;
        const mergeArmed = Boolean(mergePreview) &&
          this.relationMergeConfirmNonce === mergePreview.nonce;
        const mergeText = this.relationMergePreviewing === true
          ? "⤵ previewing…"
          : mergePreview
            ? formatTaskMergeConsequenceStrip(mergePreview)
            : "⤵ merges source · ↵ link & merge";
        el.empty();
        el.createSpan({
          cls: "bob-cnp-consequence-strip-text bob-cnp-relation-merge-effects",
          text: mergeArmed
            ? `${mergeText} — ${relationMergeConfirmBanner(mergePreview.count)}`
            : mergeText,
        });
        return;
      }
      const preview = item && (item.closePreview || item.cancelPreview)
        ? (item.closePreview || item.cancelPreview)
        : item && item.label
          ? this.relationCancelPreviewForLabel(item.label)
          : null;
      const counts = this.relationLabelCloseCounts(preview);
      const nonce = this.relationLabelCloseNonce(preview);
      const confirmBanner = nonce && this.relationCancelConfirmNonce === nonce
        ? relationCloseConfirmBanner(counts.cancelCount, counts.completeCount)
        : "";
      const text = relationLabelCancelConsequenceStrip(item, {
        preview,
        confirmBanner,
      });
      const completeCue = counts.completeCount > 0 && counts.cancelCount === 0;
      const cancelCue = counts.cancelCount > 0 && counts.completeCount === 0;
      const successorCaveat = Boolean(
        preview && preview.configuredSuccessor &&
        (preview.successorVerdict === "already_parked" ||
          preview.successorVerdict === "already_closed"),
      );
      el.empty();
      el.createSpan({
        cls: completeCue
          ? "bob-cnp-consequence-strip-text bob-cnp-relation-complete-effects"
          : cancelCue
            ? "bob-cnp-consequence-strip-text bob-cnp-relation-cancel-effects"
            : successorCaveat
              ? "bob-cnp-consequence-strip-text bob-cnp-relation-successor-caveat"
              : "bob-cnp-consequence-strip-text",
        text,
      });
      if (!confirmBanner && preview && preview.targetCancelledCaveat) {
        el.createSpan({
          cls: "bob-cnp-relation-complete-caveat",
          text: ` · ${preview.targetCancelledCaveat}`,
        });
      }
      return;
    }
    try {
      if (typeof tieGetArmed === "function" && typeof tieReleaseArmCopy === "function") {
        const armed = tieGetArmed(this);
        if (armed && item) {
          const refs = typeof tieChordOwnerOther === "function"
            ? tieChordOwnerOther(this, item)
            : null;
          if (refs && armed.key === tieArmedKey(refs.owner, refs.other, armed.to)) {
            el.empty();
            el.createSpan({
              cls: "bob-cnp-consequence-strip-text bob-cnp-tie-armed-effects",
              text: tieReleaseArmCopy(item),
            });
            return;
          }
        }
      }
    } catch (_tieArmedStripError) {}
    const text = relationStageConsequenceStrip(item, {
      marked: this.getMarkedTaskItems(),
      direction: this.relationStageDirection,
      cancelStayHint: this.relationCancelStayHintForItem(item),
    });
    el.empty();
    const releaseAlternative = /^(.*?)( · ⌃(?:⇧)?B reverses · .+)$/.exec(text);
    if (releaseAlternative) {
      el.createSpan({
        cls: "bob-cnp-consequence-strip-text",
        text: releaseAlternative[1],
      });
      el.createSpan({
        cls: "bob-cnp-tie-release-alternative",
        text: releaseAlternative[2],
      });
    } else {
      el.createSpan({ cls: "bob-cnp-consequence-strip-text", text });
    }
  }
}
