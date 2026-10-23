const QUICK_ROLL_KEY_LABEL = "Alt+P";

class BobNavigationHotkeysQuickRollMixin {
  rollByRecommendation(cm, options = {}) {
    let activePicker = this.activeBulletPropertyPicker;
    if (
      activePicker &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(activePicker)
    ) {
      if (this.activeBulletPropertyPicker === activePicker) {
        this.activeBulletPropertyPicker = null;
      }
      activePicker = null;
    }
    if (activePicker && activePicker.pickerOpen === true) {
      return true;
    }

    let countExplicit = options.countExplicit === true;
    let additionalTaskCount = Math.max(
      0,
      Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
    );
    if (!countExplicit) {
      const view = this.getActiveMarkdownView();
      const editorForVim = view && view.editor === cm ? view.editor : cm;
      if (this.isVimNormalModeEditor(editorForVim, view)) {
        const vimCm = this.resolveVimCodeMirror(editorForVim, view);
        const pending = getPendingVimRepeat(vimCm);
        if (pending.explicit) {
          countExplicit = true;
          additionalTaskCount = Math.max(
            0,
            Math.floor(numericOrDefault(pending.repeat, 0)),
          );
          resetPendingVimInputState(vimCm, "quick-roll-recommendation");
        }
      }
    }
    return this.openBulletPropertyPicker(cm, {
      ...options,
      initialTaskCardIntent: "apply-recommendation",
      countExplicit,
      additionalTaskCount,
    });
  }
}
