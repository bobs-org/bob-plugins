class BlockIdPromptPlugin extends Plugin {
  onload() {
    this.promptOpen = false;
    this.scanTimer = null;
    this.scanView = null;
    this.suppressUntil = 0;
    this.lastPromptKey = null;

    this.addCommand({
      id: "rename-selected-block-id",
      name: "Rename selected block ID",
      hotkeys: [{ modifiers: ["Ctrl"], key: "6" }],
      editorCallback: (editor, view) =>
        this.openSelectedBlockIdPrompt(editor, view),
    });

    this.addCommand({
      id: "link-task-to-pomodoro",
      name: "Toggle task Pomodoro link",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "Enter" }],
      editorCallback: (editor, view) =>
        this.openPomodoroTaskLink(editor, view),
    });

    this.registerEditorExtension(
      EditorView.updateListener.of((update) => this.scheduleScan(update)),
    );

    this.register(() => {
      if (this.scanTimer !== null) {
        window.clearTimeout(this.scanTimer);
      }
    });
  }

  scheduleScan(update) {
    if (!update.docChanged) {
      return;
    }

    if (this.promptOpen) {
      return;
    }

    this.scanView = update.view;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
    }

    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      this.inspectActiveEditor(this.scanView);
      this.scanView = null;
    }, SCAN_DEBOUNCE_MS);
  }

  inspectActiveEditor(cmView) {
    if (this.promptOpen) {
      return;
    }

    const scansSuppressed = Date.now() < this.suppressUntil;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(view instanceof MarkdownView) || !view.editor) {
      return;
    }

    if (view.editor.cm && cmView && view.editor.cm !== cmView) {
      return;
    }

    if (!this.hasSingleCursor(view.editor)) {
      return;
    }

    const file = view.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    const cursor = view.editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) {
      return;
    }

    const lineText = view.editor.getLine(cursor.line) || "";
    const taskMarker = findTaskPickerMarkerNearCursor(lineText, cursor.ch || 0);
    if (taskMarker) {
      if (lineIsInsideCodeFence(view.editor, cursor.line)) {
        return;
      }

      void this.openTaskLinkPicker({
        ...taskMarker,
        editor: view.editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    if (scansSuppressed) {
      return;
    }

    const marker = findMarkerLinkNearCursor(lineText, cursor.ch || 0);
    if (!marker) {
      this.lastPromptKey = null;
      return;
    }

    if (lineIsInsideCodeFence(view.editor, cursor.line)) {
      return;
    }

    if (marker.kind === "file-link-jump") {
      this.applyFileLinkJumpMarker(marker, view.editor, cursor.line);
      return;
    }

    const source = {
      ...marker,
      editor: view.editor,
      sourcePath: file.path,
      line: cursor.line,
    };
    this.openBlockIdPrompt(source);
  }

  openSelectedBlockIdPrompt(editor, view) {
    if (this.promptOpen) {
      return;
    }

    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("No active Markdown block selected");
      return;
    }

    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No active Markdown block selected");
      return;
    }

    if (!this.hasSingleCursor(editor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return;
    }

    const lineText = editor.getLine(cursor.line) || "";
    const blockReference = findBlockReferenceOnLine(
      lineText,
      cursor.ch || 0,
    );
    if (blockReference) {
      this.openBlockIdPrompt({
        ...blockReference,
        editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    const result = discoverSelectedBlockIdSource(editor, file);
    if (!result || !result.source) {
      new Notice(
        (result && result.notice) || "No active Markdown block selected",
      );
      return;
    }

    this.openBlockIdPrompt(result.source);
  }

  openBlockIdPrompt(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;
    new BlockIdPromptModal(this.app, this, source).open();
  }

  async openTaskLinkPicker(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination) {
        new Notice("Task link blocked: target note could not be resolved");
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (destination.content === null) {
        new Notice(`Task link blocked: ${destination.file.path} could not be read`);
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (!this.sourceMarkerStillPresent(source, { quiet: true })) {
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      const tasks = collectTaskPickerItems(destination.content);
      new TaskLinkPickerModal(
        this.app,
        this,
        {
          ...source,
          destinationPath: destination.file.path,
        },
        tasks,
        destination.file,
      ).open();
    } catch (error) {
      console.error("Block ID Prompt failed to open task link picker", error);
      new Notice("Task link blocked: target note could not be read");
      this.lastPromptKey = null;
      this.promptOpen = false;
    }
  }

  cancelTaskLinkPicker(source) {
    this.revertTaskPickerMarker(source, { quiet: true });
  }

  async selectTaskLinkTask(source, task) {
    if (task.existingId) {
      return this.completeTaskLinkWithExistingId(source, task);
    }

    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    return {
      promptSource: {
        ...source,
        kind: "link-task-complete",
        task: { ...task },
        previewText: task.displayText,
        prefillId: false,
      },
    };
  }

  async completeTaskLinkWithExistingId(source, task) {
    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return null;
    }

    if (!this.taskLineStillPresent(destination.content, task, destination.file.path)) {
      return null;
    }

    const currentId = getTrailingBlockId(task.rawLine);
    if (currentId !== task.existingId) {
      new Notice("Task link blocked: selected task block ID changed");
      return null;
    }

    const activationEligible = sourceQualifiesForPomodoroActivation(source);
    const plan = planTargetTaskUpdate(destination.content, task.line, {
      activationEligible,
      now: this.now(),
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${destination.file.path}`);
      return null;
    }

    if (plan.hasChanges) {
      if (
        !(await this.applyTargetTaskPlan(destination.file, source, plan, destination.content))
      ) {
        return null;
      }
    }

    const completionSource = this.adjustSourceForPlan(source, destination.file.path, plan);
    const completion = this.completeTaskSourceLink(
      completionSource,
      task.existingId,
      destination.file.path,
    );
    if (!completion) {
      if (plan.hasChanges) {
        const parts = activationPartialFailureParts(plan);
        new Notice(
          `Task ${parts.length ? parts.join(", ") : "linked"}, but the source link changed before completion`,
        );
      }
      return null;
    }

    new Notice(
      `Linked task block${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(completion.removedCount)}`,
    );
    return { completed: true };
  }

  hasSingleCursor(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    if (typeof editor.listSelections !== "function") {
      return true;
    }

    const selections = editor.listSelections();
    return Array.isArray(selections) && selections.length === 1;
  }

  cancelBlockIdPrompt(source) {
    if (source.kind === "link-task-complete") {
      this.revertTaskPickerMarker(source, { quiet: true });
      return;
    }

    if (source.kind === "link-task-pomodoro") {
      // A cancelled block-ID prompt stays: settle without advancing.
      this.settleLinkReviewOrigin(source, null);
      return;
    }

    if (
      source.kind === "direct-add" ||
      source.kind === "direct-rename" ||
      source.kind === "link-block"
    ) {
      return;
    }

    this.replaceSourceLink(source, source.oldId, { quiet: true });
  }

  applyFileLinkJumpMarker(marker, editor, line) {
    if (!editor || typeof editor.getLine !== "function") {
      return false;
    }

    const lineText = editor.getLine(line) || "";
    if (lineText.slice(marker.startCh, marker.endCh) !== marker.raw) {
      return false;
    }

    this.suppressEditorScans();
    if (!dispatchFileLinkBlockCompletion(editor, line, marker)) {
      applyFileLinkBlockCompletionWithEditorApi(editor, line, marker);
    }
    this.lastPromptKey = null;
    return true;
  }
}
