class BobNavigationHotkeysCountedTaskMoveMixin {
  withPendingTaskMoveCount(editor, view, options = {}) {
    if (options.countExplicit === true) {
      return options;
    }
    const vimView = view || this.getActiveMarkdownView();
    if (!this.isVimNormalModeEditor(editor, vimView)) {
      return options;
    }
    const cm = this.resolveVimCodeMirror(editor, vimView);
    const pending = getPendingVimRepeat(cm);
    if (!pending.explicit) {
      return options;
    }
    resetPendingVimInputState(cm, "counted-task-move");
    return {
      ...options,
      countExplicit: true,
      additionalTaskCount: pending.repeat,
    };
  }

  // Obsidian >= 1.14 runs a bound hotkey first and only calls stopPropagation.
  // The command route consumes the Vim count itself (withPendingTaskMoveCount),
  // so this listener acts only when no Obsidian binding handled the chord, for
  // example after the hotkey is removed or on an older build.
  registerCountedTaskMoveInputListeners() {
    this.handledCountedTaskMoveEvents = new WeakSet();
    const keydownHandler = (event) =>
      this.handleCountedTaskMovePhysicalKeydown(event);
    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleCountedTaskMovePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedTaskMoveKeydown(event)) {
      return false;
    }
    if (event && event.defaultPrevented === true) {
      return false;
    }
    if (
      this.handledCountedTaskMoveEvents &&
      this.handledCountedTaskMoveEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledCountedTaskMoveEvents) {
      this.handledCountedTaskMoveEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-task-move");
    this.openTaskMoveOrPomodoroBulletPicker(view.editor, view, {
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    });
    return true;
  }

  isCountedTaskMoveKeydown(event) {
    return Boolean(
      event &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "KeyM" || event.key === "m" || event.key === "M"),
    );
  }
}
