function isQuickRollKeydown(event) {
  return Boolean(
    event &&
      event.isComposing !== true &&
      event.keyCode !== 229 &&
      event.altKey === true &&
      event.ctrlKey !== true &&
      event.metaKey !== true &&
      event.shiftKey !== true &&
      event.code === "KeyP",
  );
}

class BulletPropertyPickerQuickRollMixin extends FilteredPickerModal {
  revealQuickRollCard() {
    if (this.quickRollCardPending !== true) {
      return false;
    }
    this.quickRollCardPending = false;
    try {
      if (this.modalEl && typeof this.modalEl.removeClass === "function") {
        this.modalEl.removeClass("bob-task-card-quick-pending");
      } else if (this.modalEl && this.modalEl.classList) {
        this.modalEl.classList.remove("bob-task-card-quick-pending");
      }
    } catch (_error) {
      // Revealing is best-effort; it never blocks the pending action.
    }
    return true;
  }

  dispatchInitialTaskCardIntent() {
    if (this.initialTaskCardIntent !== "apply-recommendation") {
      return;
    }
    this.initialTaskCardIntent = null;
    if (
      !this.hasTaskCard ||
      !this.pickerOpen ||
      this.stage !== "task-card" ||
      !this.taskCardModel ||
      this.linkResolving
    ) {
      this.revealQuickRollCard();
      return;
    }

    const recommendation = this.taskCardModel.recommendation;
    if (!recommendation || recommendation.available !== true) {
      this.revealQuickRollCard();
      const priorityStrip = this.taskCardModel.priorityStrip || null;
      const targets = Array.isArray(priorityStrip && priorityStrip.targets)
        ? priorityStrip.targets
        : [];
      const hasNoPriority =
        Boolean(priorityStrip && priorityStrip.propertyName) &&
        targets.length > 0 &&
        targets.every((target) => !String((target && target.currentValue) || "").trim());
      const reason = hasNoPriority
        ? "No priority to roll — pick a level (1–4)"
        : (recommendation && recommendation.unavailableReason) ||
          (priorityStrip && priorityStrip.unavailableReason) ||
          "No recommendation is available";
      new Notice(reason);
      return;
    }

    const effects = recommendation.effects || {};
    if (Number(effects.cancel || 0) > 0) {
      this.revealQuickRollCard();
      return;
    }

    Promise.resolve(
      this.dispatchTaskCardIntent({ type: "apply-recommendation" }),
    )
      .catch(() => {
        new Notice("Could not apply Task Card action");
      })
      .finally(() => {
        if (this.pickerOpen) {
          this.revealQuickRollCard();
        }
      });
  }
}
