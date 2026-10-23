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

function setQuickRollPendingClass(picker, pending) {
  const element = picker && (picker.containerEl || picker.modalEl);
  if (!element) return;
  try {
    if (typeof element.addClass === "function" && pending) {
      element.addClass("bob-task-card-quick-pending");
    } else if (typeof element.removeClass === "function" && !pending) {
      element.removeClass("bob-task-card-quick-pending");
    } else if (element.classList) {
      if (pending) element.classList.add("bob-task-card-quick-pending");
      else element.classList.remove("bob-task-card-quick-pending");
    }
  } catch (_error) {
    // Visibility is best-effort for older modal hosts.
  }
}

class BulletPropertyPickerQuickRollMixin extends FilteredPickerModal {
  revealQuickRollCard() {
    if (this.quickRollCardPending !== true) {
      return false;
    }
    this.quickRollCardPending = false;
    setQuickRollPendingClass(this, false);
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
      const priorityStrip = this.taskCardModel.priorityStrip || null;
      const levels = Array.isArray(priorityStrip && priorityStrip.levels)
        ? priorityStrip.levels
        : [];
      const lastLevel = levels[levels.length - 1];
      const label =
        (lastLevel && lastLevel.label) ||
        (recommendation.source && recommendation.source.level && recommendation.source.level.label) ||
        "last level";
      const cancelCount = Math.max(1, Math.floor(Number(effects.cancel) || 1));
      const targetCount = Math.max(1, Math.floor(Number(recommendation.targetCount) || 1));
      const message = cancelCount === 1 && targetCount === 1
        ? `Decayed past ${label} — ${QUICK_ROLL_KEY_LABEL} again cancels it, Esc keeps it`
        : cancelCount === 1
          ? `One task in this batch decayed past ${label} — ${QUICK_ROLL_KEY_LABEL} again cancels it, Esc keeps it`
          : `${cancelCount} tasks in this batch decayed past ${label} — ${QUICK_ROLL_KEY_LABEL} again cancels them, Esc keeps them`;
      new Notice(message);
      return;
    }

    Promise.resolve()
      .then(() => this.dispatchTaskCardIntent({ type: "apply-recommendation" }))
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
