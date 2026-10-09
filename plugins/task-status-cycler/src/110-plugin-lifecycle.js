class TaskStatusCyclerPlugin extends Plugin {
  onload() {
    // Handle for a deferred `zz`-style center of the newly created Pomodoro
    // placeholder after a completion keymap. Tracked so repeated presses cancel
    // the previous pending center instead of stacking stale scrolls.
    this.pendingPomodoroCenterDeferred = null;
    this.pendingRenderedTasksScrollDeferred = null;
    this.referenceMutationQueue = Promise.resolve();
    this.demotionSectionPicker = null;
    // Cross-plugin surface (plugins never import one another's `main.js`).
    // Keep the shape additive: bump `version` whenever a method is added.
    this.api = Object.freeze({
      version: 2,
      recoverBlockedDependents: (closedIdentities, context) =>
        this.recoverBlockedDependents(closedIdentities, context),
      completeTaskAtCursor: (editor) => this.completeTaskAtCursor(editor),
    });

    this.addCommand({
      id: "cycle-task-status-forward",
      name: "Cycle task status forward",
      editorCheckCallback: (checking, editor, view) =>
        this.handleCycleCommand(checking, editor, view, 1),
    });

    this.addCommand({
      id: "cycle-task-status-backward",
      name: "Cycle task status backward",
      editorCheckCallback: (checking, editor, view) =>
        this.handleCycleCommand(checking, editor, view, -1),
    });

    this.addCommand({
      id: "open-child-bullet-line-below",
      name: "Open child bullet line below",
      editorCheckCallback: (checking, editor, view) =>
        this.handleOpenChildBulletLineCommand(checking, editor, view, "below"),
    });

    this.addCommand({
      id: "open-child-bullet-line-above",
      name: "Open child bullet line above",
      editorCheckCallback: (checking, editor, view) =>
        this.handleOpenChildBulletLineCommand(checking, editor, view, "above"),
    });

    this.addCommand({
      id: "toggle-pomodoro-bullet",
      name: "Toggle Pomodoro placeholder/sub-bullet",
      hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "]" }],
      editorCheckCallback: (checking, editor, view) =>
        this.handlePomodoroBulletToggleCommand(checking, editor, view),
    });

    this.registerChildBulletInputListeners();
    this.registerPomodoroBulletToggleInputListeners();
    this.registerCountedTaskCycleInputListeners();

    this.addCommand({
      id: "toggle-task-open-done",
      name: "Toggle task open/done",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleOpenDoneCommand(checking, editor, view),
    });

    this.addCommand({
      id: "toggle-task-checkbox-marker",
      name: "Toggle task checkbox marker",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleCheckboxMarkerCommand(checking, editor, view),
    });

    this.addCommand({
      id: "toggle-obsidian-task",
      name: "Toggle Obsidian task",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleObsidianTaskCommand(checking, editor, view),
    });

    // Normalize Tasks-generated dependency IDs to block IDs after Tasks writes
    // `[id::]`/`[dependsOn::]`. The active editor handles the common same-file
    // flow; vault modify events cover cross-file dependency creation.
    this.activeEditorDependencyTimer = null;
    this.vaultDependencyTimers = new Map();
    this.renamedDependencyTimers = new Map();
    this.dependencyAmbiguityCache = new Map();
    this.dependencyIssueStates = new Map();
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        this.scheduleActiveEditorDependencyNormalize(editor, info);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.scheduleVaultFileDependencyNormalize(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        Promise.resolve(this.reconcileRenamedDependencyIds(file, oldPath)).catch(
          (error) => {
            console.error("Could not reconcile renamed dependency IDs", error);
            new Notice(error.message || String(error));
          },
        );
      }),
    );

    this.vimMappingsRegistered = false;
    this.app.workspace.onLayoutReady(() => {
      if (this.registerVimMappings()) {
        return;
      }

      const ref = this.app.workspace.on("active-leaf-change", () => {
        if (this.registerVimMappings()) {
          this.app.workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });
  }

  onunload() {
    if (this.pendingPomodoroCenterDeferred) {
      cancelDeferred(this.pendingPomodoroCenterDeferred);
      this.pendingPomodoroCenterDeferred = null;
    }
    if (this.pendingRenderedTasksScrollDeferred) {
      cancelDeferred(this.pendingRenderedTasksScrollDeferred);
      this.pendingRenderedTasksScrollDeferred = null;
    }
    if (this.activeEditorDependencyTimer) {
      window.clearTimeout(this.activeEditorDependencyTimer);
      this.activeEditorDependencyTimer = null;
    }
    if (this.vaultDependencyTimers) {
      for (const timer of this.vaultDependencyTimers.values()) {
        window.clearTimeout(timer);
      }
      this.vaultDependencyTimers.clear();
    }
    if (this.renamedDependencyTimers) {
      for (const timer of this.renamedDependencyTimers.values()) {
        window.clearTimeout(timer);
      }
      this.renamedDependencyTimers.clear();
    }
    if (this.demotionSectionPicker) {
      this.demotionSectionPicker.close();
      this.demotionSectionPicker = null;
    }
    // `cycler_polish`: reopen receipts are in-memory only and die with the
    // plugin (they also expire at local midnight on next use).
    if (this.successorReopenReceiptStore) {
      this.successorReopenReceiptStore.clear();
    }
  }

}
