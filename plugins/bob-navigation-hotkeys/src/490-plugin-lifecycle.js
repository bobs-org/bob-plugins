class BobNavigationHotkeysPlugin extends Plugin {
  onload() {
    this.taskCardPluginUnloading = false;
    this.activeImageZoomModal = null;
    this.reviewJournalPending = [];
    this.reviewJournalDraining = false;
    this.reviewJournalRetryTimer = null;
    this.reviewJournalBurst = false;
    this.reviewJournalMissingApiNoticed = false;
    this.reviewJournalDropped = 0;
    this.reviewJournalDropWarned = false;
    this.currentFilePath = null;
    this.alternateFilePath = null;
    this.filePositions = new Map();
    this.vimJumpHistory = createVimJumpHistory();
    this.vimJumpOperationToken = 0;
    this.vimJumpHistoryChain = Promise.resolve();
    this.vimJumpBridgeVim = null;
    this.vimJumpBridgeJumpList = null;
    this.vimJumpBridgeOriginalAdd = null;
    this.vimJumpBridgeDiagnosticShown = false;
    this.vimJumpSuppressNativeMirror = false;
    this.vimJumpPendingDestinationDeferred = null;
    this.pendingTaskMoveJumpCompletion = null;
    this.pendingTaskMoveJumpLandingId = null;
    this.taskMoveLandingSeq = 0;
    this.dashLocation = null;
    this.pendingRestoreDeferred = null;
    this.pendingDashTasksDeferred = null;
    this.pendingDashTasksScrollDeferred = null;
    this.pendingDashLocationRestoreDeferred = null;
    this.pendingDashLocationCaptureDeferred = null;
    this.activeDashScrollDOM = null;
    this.activeDashScrollHandler = null;
    this.isRestoringDashLocation = false;
    this.pendingOpenTaskJumpCenterDeferred = null;
    this.vimMappingsRegistered = false;
    // Shared guard for Ctrl+Shift+M task-note and Pomodoro-bullet pickers.
    this.activeTaskMoveDestinationPicker = null;
    this.activeBulletPropertyPicker = null;
    this.pendingTaskMoveJumpDeferred = null;

    this.addCommand({
      id: "open-parent-note",
      name: "Open parent note",
      callback: () => this.openParentNote(),
    });

    this.addCommand({
      id: "open-child-note",
      name: "Open child note",
      callback: () => this.openChildNotePicker(),
    });

    this.addCommand({
      id: "open-template-note",
      name: "Open template note",
      callback: () => this.openTemplateNote(),
    });

    this.addCommand({
      id: "open-alt-file-note",
      name: "Open alt file note",
      callback: () => this.openAltFileNote(),
    });

    // The vault hotkeys.json binds Meta+Enter; a default loses to Obsidian's built-in Mod+Enter.
    this.addCommand({
      id: "open-reference-pdf-in-highlights",
      name: "Open reference PDF in Highlights (or link in new tab)",
      callback: () => void this.openReferencePdfInHighlightsOrLink(),
    });

    // The vault vimrc maps normal-mode Z to this command; it has no default hotkey.
    this.addCommand({
      id: "zoom-image-on-line",
      name: "Zoom image on cursor line",
      editorCallback: (editor, view) => this.zoomImageOnLine(editor, view),
    });

    this.addCommand({
      id: "open-dash-tasks",
      name: "Open dash Tasks section",
      hotkeys: [{ modifiers: ["Ctrl"], key: "0" }],
      callback: () => this.openDashTasks(),
    });

    this.addCommand({
      id: "create-project-note",
      name: "Create project note",
      callback: () => this.createProjectNote(),
    });

    this.addCommand({
      id: "create-project-note-from-task",
      name: "Create project note from task",
      editorCallback: (editor, view) =>
        this.createProjectNoteFromTask(editor, view),
    });

    this.addCommand({
      id: "move-tasks-to-note",
      name: "Move tasks to note",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "M" }],
      editorCallback: (editor, view) =>
        this.openTaskMoveOrPomodoroBulletPicker(editor, view),
    });

    // No default hotkey: the manager is a browsing surface, not a cursor action.
    this.addCommand({
      id: "open-pomodoro-themes-manager",
      name: "Pomodoro themes",
      callback: () => this.openPomodoroThemesManager(),
    });

    this.addCommand({
      id: "open-relation-labels-manager",
      name: "Bob: Relation labels",
      callback: () => this.openRelationLabelsManager(),
    });

    this.addCommand({
      id: "open-next-link",
      name: "Open next link",
      callback: () => this.openLabeledBodyLink("next"),
    });

    this.addCommand({
      id: "open-prev-link",
      name: "Open previous link",
      callback: () => this.openLabeledBodyLink("prev"),
    });

    this.addCommand({
      id: "toggle-line-transclusions",
      name: "Toggle line transclusions",
      editorCallback: (editor) => this.toggleCurrentLineTransclusions(editor),
    });

    this.addCommand({
      id: "set-bullet-property",
      name: "Task card (set properties)",
      editorCallback: (editor) => this.openBulletPropertyPicker(editor),
    });

    this.addCommand({
      id: "roll-by-recommendation",
      name: "Task card: Roll by recommendation",
      hotkeys: [{ modifiers: ["Alt"], key: "P" }],
      editorCallback: (editor) => this.rollByRecommendation(editor),
    });

    this.addCommand({
      id: "task-card-depends-on",
      name: "Task card: Blocked by (Depends on)",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "B" }],
      editorCallback: (editor) =>
        this.openBulletPropertyPicker(editor, { initialTaskCardRow: "depends-on" }),
    });

    this.addCommand({
      id: "task-card-blocks",
      name: "Task card: Blocks (reverse Depends on)",
      hotkeys: [{ modifiers: ["Ctrl", "Shift", "Alt"], key: "B" }],
      editorCallback: (editor) =>
        this.openBulletPropertyPicker(editor, { initialTaskCardRow: "blocks" }),
    });

    // Neither Obsidian core nor this repo binds Ctrl+Shift+L: the vault
    // hotkeys.json carries no Shift+L chord and `⇧L` means "Less often"
    // only on the separate decay card, never as an app chord.
    this.addCommand({
      id: "task-card-links",
      name: "Task card: Links to (task relation)",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "L" }],
      editorCallback: (editor) => this.openLinksStageAtCursor(editor),
    });

    this.addCommand({
      id: "task-card-linked-from",
      name: "Task card: Linked from (task relation)",
      hotkeys: [{ modifiers: ["Ctrl", "Shift", "Alt"], key: "L" }],
      editorCallback: (editor) => this.openLinkedFromStageAtCursor(editor),
    });

    // No default hotkey (Q6): the vault-wide Depends on stage for the task
    // under the cursor (`docs/task-dependencies.md` §6.1).
    this.addCommand({
      id: "edit-task-dependencies",
      name: "Edit task dependencies",
      editorCallback: (editor) => this.openDependencyStageAtCursor(editor),
    });

    this.addCommand({
      id: "toggle-task-lane",
      name: "Commit to Next / release to Ready",
      hotkeys: [{ modifiers: ["Alt"], key: "N" }],
      editorCallback: (editor) => this.toggleTaskLane(editor),
    });

    this.addCommand({
      id: "jump-to-next-due-task",
      name: "Jump to next task due for freshness review",
      hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "J" }],
      callback: () => this.jumpToDueTask(1),
    });

    this.addCommand({
      id: "jump-to-prev-due-task",
      name: "Jump to previous task due for freshness review",
      hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "K" }],
      callback: () => this.jumpToDueTask(-1),
    });

    this.addCommand({
      id: "jump-to-first-due-task",
      name: "Jump to first task due for freshness review",
      callback: () => this.jumpToDueTask(1, { endpoint: "first" }),
    });

    this.addCommand({
      id: "jump-to-last-due-task",
      name: "Jump to last task due for freshness review",
      callback: () => this.jumpToDueTask(-1, { endpoint: "last" }),
    });

    this.addCommand({
      id: "refresh-task-freshness",
      name: "Refresh task freshness (confirm it still looks right)",
      hotkeys: [{ modifiers: ["Alt"], key: "F" }],
      editorCallback: (editor) => this.refreshTaskFreshness(editor, {}),
    });

    this.addCommand({
      id: "refresh-task-freshness-and-advance",
      name: "Refresh task freshness and jump to the next due task",
      hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "F" }],
      editorCallback: (editor) =>
        this.refreshTaskFreshness(editor, { advance: true }),
    });


    this.addCommand({
      id: "insert-blank-line-above",
      name: "Insert blank line above",
      editorCallback: (editor) => this.insertBlankLine(editor, "above"),
    });

    this.addCommand({
      id: "insert-blank-line-below",
      name: "Insert blank line below",
      editorCallback: (editor) => this.insertBlankLine(editor, "below"),
    });

    this.addCommand({
      id: "jump-to-next-section-header",
      name: "Jump to next section header",
      editorCallback: (editor) => this.jumpToSectionHeader(editor, 1),
    });

    this.addCommand({
      id: "jump-to-prev-section-header",
      name: "Jump to previous section header",
      editorCallback: (editor) => this.jumpToSectionHeader(editor, -1),
    });

    this.addCommand({
      id: "jump-to-next-open-task",
      name: "Jump to next open task or move a Pomodoro down",
      // Omitting repeat means "resolve the pending Vim count" in the shared
      // route; an explicit 1 would drop a typed count when this command wins
      // the dual-dispatch race.
      editorCallback: (editor) => this.jumpToOpenObsidianTask(editor, 1),
    });

    this.addCommand({
      id: "jump-to-prev-open-task",
      name: "Jump to previous open task or move a Pomodoro up",
      // Omitting repeat means "resolve the pending Vim count" in the shared
      // route; an explicit 1 would drop a typed count when this command wins
      // the dual-dispatch race.
      editorCallback: (editor) => this.jumpToOpenObsidianTask(editor, -1),
    });

    this.addCommand({
      id: "open-alternate-file",
      name: "Open alternate file",
      callback: () => this.openAlternateFile(),
    });

    this.addCommand({
      id: "delete-current-file",
      name: "Delete current file",
      callback: () => this.deleteCurrentFile(),
    });

    this.addCommand({
      id: "rename-current-file",
      name: "Rename current file",
      callback: () => this.openRenameCurrentFileModal(),
    });

    this.addCommand({
      id: "move-tab-left",
      name: "Move tab left",
      callback: () => this.moveActiveTab(-1),
    });

    this.addCommand({
      id: "move-tab-right",
      name: "Move tab right",
      callback: () => this.moveActiveTab(1),
    });

    this.addCommand({
      id: "duplicate-current-tab",
      name: "Duplicate current tab",
      callback: () => this.duplicateCurrentTab(),
    });

    this.addCommand({
      id: "toggle-current-tab-pin",
      name: "Toggle current tab pin",
      callback: () => this.toggleCurrentTabPin(),
    });

    this.addCommand({
      id: "close-tabs-left",
      name: "Close tabs to the left",
      callback: () => this.closeSiblingTabs("left"),
    });

    this.addCommand({
      id: "close-tabs-right",
      name: "Close tabs to the right",
      callback: () => this.closeSiblingTabs("right"),
    });

    this.addCommand({
      id: "close-other-tabs",
      name: "Close other tabs",
      callback: () => this.closeSiblingTabs("others"),
    });

    this.addCommand({
      id: "copy-active-file-path",
      name: "Copy active file path",
      hotkeys: [{ modifiers: ["Mod"], key: "Y" }],
      callback: () => this.openYankPathPicker(),
    });

    YANK_PATH_COMMANDS.forEach((command) => {
      this.addCommand({
        id: command.id,
        name: command.name,
        callback: () => this.yankActiveFilePath(command.kind),
      });
    });

    if (typeof this.registerObsidianProtocolHandler === "function") {
      this.registerObsidianProtocolHandler("bob-goto-task", (params) => {
        void this.handleGoToTaskUri(params);
      });
      this.registerObsidianProtocolHandler("bob-open-notes", (params) => {
        void this.enqueueBobOpenNotesUri(params);
      });
    }

    this.app.workspace.onLayoutReady(() => {
      const activeFile = this.app.workspace.getActiveFile();
      if (this.isMarkdownFile(activeFile)) {
        this.currentFilePath = activeFile.path;
        this.captureActiveFilePosition();
      }
      this.refreshDashScrollCaptureTarget();
      // Templater 2.25 made the trigger device-local (default off), and this restores the vault's folder-template intent on each device.
      this.ensureTemplaterNewNoteTrigger();
    });

    this.registerVimMappingsWhenReady();
    this.registerVimJumpHistoryVaultEvents();

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.trackOpenedFile(file)),
    );
    // Hand-edit mirror (`docs/task-dependencies.md` §8): once the cursor
    // leaves an edited line, R1/R9 sync the owning task's line and field.
    // The mirror reads real changed ranges from a CM6 update listener:
    // `editor-change` carries no change object, so the edited line was
    // always 0 and the mirror only ever acted on the task owning line 0.
    this.dependencyMirrorByPath = new Map();
    this.pendingDependencyMirror = null;
    this.pendingDependencyMirrorSnapshot = null;
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.refreshDashScrollCaptureTarget(),
      ),
    );

    if (
      EditorView &&
      EditorView.updateListener &&
      typeof EditorView.updateListener.of === "function"
    ) {
      this.registerEditorExtension(
        EditorView.updateListener.of((update) => {
          this.trackSelectionUpdate(update);
          this.scheduleDependencyHandEditMirrorFromUpdate(update);
        }),
      );
    }

    if (
      bobOpenNotesLandingFlashField &&
      typeof this.registerEditorExtension === "function"
    ) {
      this.registerEditorExtension(bobOpenNotesLandingFlashField);
    }

    this.reviewAnchor = null;
    this.reviewLanding = null;
    this.reviewWalkCurrent = null;
    // Review-walk auto-advance (`docs/freshness.md` §6): the landing epoch
    // and gesture sequence make stale callbacks refuse, and the lock
    // swallows double presses while an answer is in flight or settling.
    this.reviewLandingEpoch = 0;
    this.reviewGestureSeq = 0;
    this.reviewWalkLock = null;
    this.successorPickerUnavailable = false;
    this.activeSuccessorPicker = null;
    this.reviewSuccessorGestureOwner = null;
    this.reviewSuccessorWalkHold = null;
    this.reviewAnsweredKeys = { day: null, keys: new Set(), texts: new Map() };
    // At most one review-walk decision card at a time; the guard also
    // prevents nested cards.
    this.activeFreshnessDecayCard = null;
    // nav api v3 (`docs/task-dependencies.md` §9): frozen, versioned, never
    // throws. bob-ledger-tools feature-detects `api?.version >= 1`.
    this.api = createDependencyNavApi(this);
    this.registerOpenTaskJumpInputListeners();
    this.registerReviewRefreshInputListeners();
    this.registerCountedTransclusionToggleInputListeners();
    this.registerCountedBulletPropertyInputListeners();
    this.registerCountedTaskMoveInputListeners();
    this.registerCountedLaneToggleInputListeners();
    this.registerClearSearchHighlightInputListeners();

    this.register(() => {
      if (this.pendingDependencyMirror) {
        clearTimeout(this.pendingDependencyMirror);
        this.pendingDependencyMirror = null;
      }
      this.pendingDependencyMirrorSnapshot = null;
      this.cancelPendingRestore();
      this.cancelPendingDashTasksJump();
      this.cancelPendingDashLocationRestore();
      this.cancelPendingDashLocationCapture();
      this.clearDashScrollCaptureTarget();
      cancelDeferred(this.pendingOpenTaskJumpCenterDeferred);
      this.pendingOpenTaskJumpCenterDeferred = null;
      this.cancelPendingTaskMoveJump();
      this.cancelPendingVimJumpDestination();
      if (this.vimJumpHistory) {
        clearVimJumpHistory(this.vimJumpHistory);
      }
    });
  }

  onunload() {
    this.taskCardPluginUnloading = true;
    if (this.activeImageZoomModal) {
      try {
        this.activeImageZoomModal.close();
      } catch (_error) {
        this.activeImageZoomModal = null;
      }
      this.activeImageZoomModal = null;
    }
    this.successorPickerUnavailable = true;
    try {
      this.closeSuccessorPickerForUnload();
    } catch (_error) {
      this.activeSuccessorPicker = null;
      this.reviewSuccessorGestureOwner = null;
      this.reviewSuccessorWalkHold = null;
    }
    if (this.reviewJournalRetryTimer !== null) {
      clearTimeout(this.reviewJournalRetryTimer);
      this.reviewJournalRetryTimer = null;
    }
    this.reviewJournalDraining = false;
    this.reviewJournalBurst = false;
    this.reviewJournalDropWarned = false;
    this.linkPickerRequestToken = (this.linkPickerRequestToken || 0) + 1;
    if (this.activeBulletPropertyPicker) {
      try {
        this.activeBulletPropertyPicker.close();
      } catch (_error) {
        this.activeBulletPropertyPicker = null;
      }
    }
    // Inbox routing lifetime: unloading nav while a route is pending
    // cancels that route immediately, restoring/releasing its modal state
    // and clearing the shared destination-picker guard.
    if (this.activeTaskMoveDestinationPicker) {
      try {
        const active = this.activeTaskMoveDestinationPicker;
        if (active && typeof active.settleRoute === "function") {
          try {
            active.close();
          } catch (cancelError) {
            try {
              active.settleRoute({ kind: "cancel" });
            } catch (ignoredError) {
              // Cancel is best-effort during unload.
            }
          }
        } else if (active && typeof active.close === "function") {
          try {
            active.close();
          } catch (ignoredError) {
            // Close is best-effort during unload.
          }
        }
      } catch (_error) {
        // Cancellation never blocks unload.
      }
      this.activeTaskMoveDestinationPicker = null;
    }
    // Drop the decision-card capability first so ledger-tools marks stop
    // promising a leaf the moment this plugin unloads (mixed-version and
    // disable/enable sessions degrade to counting pips without a reset).
    try {
      this.activeFreshnessDecayCard = null;
      this.api = createDependencyNavApi(null);
    } catch (error) {
      // Best effort: Obsidian is tearing down.
    }
    this.cleanupVimJumpHistoryMappings();
    if (this.vimJumpHistory) {
      clearVimJumpHistory(this.vimJumpHistory);
    }
    this.cancelPendingTaskMoveJump();
    this.cancelPendingVimJumpDestination();
  }
}
