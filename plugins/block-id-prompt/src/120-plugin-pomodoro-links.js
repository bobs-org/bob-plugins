class BlockIdPromptPomodoroLinksMixin {
  // Ctrl+Shift+Enter: non-Next tasks link to today's current/next Pomodoro and
  // become Next; Next tasks become Open and lose current/future Pomodoro links.
  // Unlike the `^^` task-picker flow, this command already knows the task (the
  // cursor's own line) and has no marker text to complete or revert.
  //
  // When the cursor is not on an open `#task` line but the line holds a selected
  // Task Link (a wiki block link to a task, plain or embedded), the command
  // instead runs task-link mode: it deletes that link and sets the linked task
  // Open (see startTaskLinkOpen). Any `#task` line, open or closed, keeps the
  // task-line behavior above, so a task whose text contains links is unchanged.
  async openPomodoroTaskLink(editor, view) {
    if (this.promptOpen) {
      return;
    }

    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("No active Markdown task selected");
      return;
    }

    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No active Markdown task selected");
      return;
    }

    const resolved = this.resolvePomodoroLinkTaskFromEditor(editor);
    if (resolved.error) {
      if (resolved.error === NO_OPEN_TASK_NOTICE) {
        await this.startTaskLinkOpen(editor, file);
        return;
      }

      new Notice(resolved.error);
      return;
    }

    const { task } = resolved;
    const source = {
      kind: "link-task-pomodoro",
      editor,
      file,
      sourcePath: file.path,
      line: task.line,
      task: { ...task },
    };

    // Lane-preserving toggle: link presence decides, never the checkbox. A
    // task without a block ID is never linked; a task linked only under a
    // completed Pomodoro counts as unlinked and gets linked again.
    if (task.existingId) {
      const linked = await this.pomodoroTaskLinkPresence(source, task.existingId);
      if (linked === "blocked") {
        return;
      }

      if (linked) {
        if (task.status === "/") {
          this.openWorkSummaryPrompt(source);
          return;
        }

        this.promptOpen = true;
        try {
          await this.applyPomodoroTaskUnlink(source);
        } finally {
          this.promptOpen = false;
        }
        return;
      }
    }

    if (task.existingId) {
      this.promptOpen = true;
      try {
        await this.completePomodoroTaskLink(source, task.existingId);
      } finally {
        this.promptOpen = false;
      }
      return;
    }

    // A task without a block ID is never linked: prompt for one, then link.
    // Ready and Blocked become Next; Next and In Progress stay unchanged.
    this.openBlockIdPrompt({
      ...source,
      previewText: task.displayText,
      prefillId: false,
    });
  }

  // Whether the task's block ID currently has a live link under any open
  // Pomodoro of today's daily note: the same set
  // planAllOpenPomodoroLinkCleanup would remove. Returns true/false, or
  // "blocked" (with a Notice) when today's note cannot be read and null when
  // there is no daily note (the link path reports that itself).
  async pomodoroTaskLinkPresence(source, blockId) {
    const taskFile = this.resolveTaskFile(source.sourcePath);
    const dailyFile = this.resolveTodayDailyFile();
    if (!dailyFile) {
      return false;
    }

    const dailyContent =
      taskFile && dailyFile.path === taskFile.path
        ? source.editor.getValue()
        : await this.readFileSnapshot(dailyFile, source);
    if (dailyContent === null) {
      new Notice(`Task toggle blocked: ${dailyFile.path} could not be read`);
      return "blocked";
    }

    const cleanup = planAllOpenPomodoroLinkCleanup(dailyContent, {
      sourcePath: dailyFile.path,
      targetPath: taskFile ? taskFile.path : source.sourcePath,
      targetBlockId: blockId,
      resolveTarget: (reference, referrerPath) =>
        this.resolveReferenceDestination(reference, referrerPath),
    });
    return cleanup.removedCount > 0;
  }

  // The cursor/task-eligibility half of openPomodoroTaskLink, split out so it
  // is testable without an Obsidian MarkdownView/TFile: single cursor, not
  // fenced, an open task line (including a `#hide` project task) under it,
  // and — when that task already has a block ID — that the ID is not
  // duplicated elsewhere in this note. Returns `{ task }` or `{ error }`.
  resolvePomodoroLinkTaskFromEditor(editor) {
    if (!this.hasSingleCursor(editor)) {
      return { error: "No active Markdown task selected" };
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      return { error: "No active Markdown task selected" };
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return { error: "Cannot link a task inside a code block" };
    }

    const lineText = editor.getLine(cursor.line) || "";
    const task = findDirectPomodoroLinkTask(lineText, cursor.line);
    if (!task) {
      return { error: NO_OPEN_TASK_NOTICE };
    }

    if (task.existingId) {
      const duplicateMatches = blockTokenMatches(editor.getValue(), task.existingId);
      if (duplicateMatches.length !== 1) {
        return { error: `Block ID '${task.existingId}' is duplicated in this note` };
      }
    }

    return { task };
  }

  // The cursor half of task-link mode, split out like
  // resolvePomodoroLinkTaskFromEditor so it is testable without a MarkdownView:
  // single cursor, not fenced, not on a `#task` line of any status (those keep
  // the task-line behavior and its "No open task" notice), and exactly one
  // selectable Task Link. Returns `{ link, lineNumber, lineText }` or `{ error }`.
  resolveSelectedTaskLinkFromEditor(editor) {
    if (!this.hasSingleCursor(editor)) {
      return { error: "No active Markdown task selected" };
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      return { error: "No active Markdown task selected" };
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return { error: "Cannot link a task inside a code block" };
    }

    const lineText = editor.getLine(cursor.line) || "";
    const taskMatch = getObsidianTaskLineMatch(lineText);
    if (taskMatch && PROJECT_TASK_TAG_RE.test(taskMatch[2] || "")) {
      return { error: NO_OPEN_TASK_NOTICE };
    }

    const selected = findSelectedTaskLinkOnLine(lineText, cursor.ch);
    if (selected.ambiguous) {
      return { error: TASK_LINK_AMBIGUOUS_NOTICE };
    }

    if (!selected.link) {
      return { error: NO_OPEN_TASK_NOTICE };
    }

    return { link: selected.link, lineNumber: cursor.line, lineText };
  }

  // Resolve the task a Task Link points at: the file, its current snapshot, and
  // the unique `#task` line carrying the block ID. Returns `{ error }` (a
  // ready-to-show notice) or the target with its parsed status.
  async resolveTaskLinkTarget(link, activePath, source) {
    const file = this.resolveReferenceDestination(link, activePath);
    if (!file) {
      return { error: TASK_LINK_NOT_FOUND_NOTICE };
    }

    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      return { error: `Task link blocked: ${file.path} could not be read` };
    }

    const id = link.oldId;
    const matches = blockTokenMatches(content, id);
    if (matches.length !== 1) {
      return {
        error: `Task link target ^${id} is missing or duplicated in ${file.path}`,
      };
    }

    const lineIndex = content.slice(0, matches[0].start).split("\n").length - 1;
    const rawLine = content.split("\n")[lineIndex];
    const taskMatch = getObsidianTaskLineMatch(rawLine);
    const status = taskMatch ? taskMatch[1] : null;
    if (
      !taskMatch ||
      !PROJECT_TASK_TAG_RE.test(taskMatch[2] || "") ||
      getTrailingBlockId(rawLine) !== id ||
      !(OPEN_OBSIDIAN_TASK_STATUSES.has(status) || DONE_OBSIDIAN_TASK_STATUSES.has(status))
    ) {
      return { error: TASK_LINK_NOT_A_TASK_NOTICE };
    }

    if (DONE_OBSIDIAN_TASK_STATUSES.has(status)) {
      return { error: TASK_LINK_CLOSED_NOTICE };
    }

    return {
      file,
      path: file.path,
      content,
      line: lineIndex,
      rawLine,
      status,
      id,
      displayText: cleanTaskDisplayText(rawLine),
    };
  }

  // Task-link mode entry: pick the link under the cursor, resolve and vet its
  // target, then either apply immediately or, for an In Progress target, open
  // the work-summary prompt (which applies on submit). The reentrancy guard is
  // held while resolving/applying and handed to the modal for the prompt.
  async startTaskLinkOpen(editor, file) {
    const selection = this.resolveSelectedTaskLinkFromEditor(editor);
    if (selection.error) {
      new Notice(selection.error);
      return;
    }

    let promptSource = null;
    this.promptOpen = true;
    try {
      const { link, lineNumber, lineText } = selection;
      if (isTaskDependencyLine(lineText) || isMalformedTaskDependencyLine(lineText)) {
        new Notice(TASK_DEPENDENCY_LINE_NOTICE);
        return;
      }
      if (
        isDependencyTransclusionLink(editor.getValue().split("\n"), lineNumber, link)
      ) {
        new Notice(TASK_LINK_DEPENDENCY_NOTICE);
        return;
      }

      const source = { editor, file, sourcePath: file.path };
      const target = await this.resolveTaskLinkTarget(link, file.path, source);
      if (target.error) {
        new Notice(target.error);
        return;
      }

      const linkSource = {
        ...source,
        kind: TASK_LINK_OPEN_SOURCE_KIND,
        line: lineNumber,
        lineText,
        link,
        contextPath: target.path,
        task: { displayText: target.displayText },
        target: { path: target.path, rawLine: target.rawLine, status: target.status },
      };
      if (target.status === "/") {
        promptSource = linkSource;
      } else {
        await this.applyTaskLinkOpen(linkSource);
      }
    } finally {
      this.promptOpen = false;
    }

    if (promptSource) {
      this.openWorkSummaryPrompt(promptSource);
    }
  }

  resolveTodayDailyFile() {
    const vault = this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return null;
    }

    const dailyPath = todayDailyPath(this.now(), getDailyNotesOptions(this.app));
    const file = vault.getAbstractFileByPath(dailyPath);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  resolveTaskFile(sourcePath) {
    const vault = this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return null;
    }

    const file = vault.getAbstractFileByPath(sourcePath);
    return file instanceof TFile ? file : null;
  }

  buildPomodoroLinkTargetText(taskFile, dailyPath) {
    if (taskFile.path === dailyPath) {
      return "";
    }

    const metadataCache = this.app.metadataCache;
    if (metadataCache && typeof metadataCache.fileToLinktext === "function") {
      return metadataCache.fileToLinktext(taskFile, dailyPath, true);
    }

    return stripMarkdownExtension(taskFile.path);
  }

  async completePomodoroTaskLink(source, id) {
    return this.applyPomodoroTaskLink(source, id, false);
  }

  async submitPomodoroTaskLinkBlockId(source, newId) {
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    const duplicateMatches = blockTokenMatches(source.editor.getValue(), newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${source.sourcePath}`);
      return false;
    }

    return this.applyPomodoroTaskLink(source, newId, true);
  }

  openWorkSummaryPrompt(source) {
    if (this.promptOpen) {
      return;
    }

    this.promptOpen = true;
    new WorkSummaryPromptModal(this.app, this, source).open();
  }

  cancelWorkSummaryPrompt(_source) {
    // Cancellation intentionally leaves the selected task and daily note untouched.
  }

  // Work Log prompt submit for an In Progress unlink: a blank summary
  // unlinks without a log, a nonblank one is prepended to the task's Work
  // Log, and the lane never changes. Escape cancels via
  // cancelWorkSummaryPrompt, leaving everything untouched.
  async submitPomodoroWorkSummary(source, rawSummary, options = {}) {
    const normalizedSummary = normalizeWorkSummary(rawSummary);
    const workLogDate = normalizedSummary
      ? options.workLogDate || localTodayParts(this.now())
      : null;
    if (source.kind === TASK_LINK_OPEN_SOURCE_KIND) {
      return this.applyTaskLinkOpen(source, {
        workSummary: normalizedSummary,
        workLogDate,
      });
    }

    return this.applyPomodoroTaskUnlink(source, {
      workSummary: normalizedSummary,
      workLogDate,
    });
  }

  // Shared core for both the existing-ID (completePomodoroTaskLink) and
  // newly-prompted-ID (submitPomodoroTaskLinkBlockId) paths. Always
  // re-validates the task line and plans the daily-note edit BEFORE planning
  // or applying anything to the task note, so a missing/ambiguous Pomodoro
  // ledger stops the command with zero edits. When the task and the daily
  // note are the same file, every edit is merged into one editor transaction
  // against a single snapshot; otherwise the task note is written first
  // (guarded) and the daily note second (guarded), reporting the exact
  // partial result if the second write fails after the first succeeds.
  async applyPomodoroTaskLink(source, id, isNewId) {
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    const dailyFile = this.resolveTodayDailyFile();
    if (!dailyFile) {
      new Notice("Task link blocked: today's daily note could not be found");
      return false;
    }

    const taskFile = this.resolveTaskFile(source.sourcePath);
    if (!taskFile) {
      new Notice("Task link blocked: active note could not be resolved");
      return false;
    }

    const sameNote = dailyFile.path === taskFile.path;
    const taskContent = source.editor.getValue();
    const dailyContent = sameNote
      ? taskContent
      : await this.readFileSnapshot(dailyFile, source);
    if (dailyContent === null) {
      new Notice(`Task link blocked: ${dailyFile.path} could not be read`);
      return false;
    }

    const linkTargetText = sameNote
      ? ""
      : this.buildPomodoroLinkTargetText(taskFile, dailyFile.path);
    const linkText = sourceReplacement(
      { targetText: linkTargetText, aliasSuffix: "" },
      id,
      CANONICAL_BLOCK_LINK_PREFIX,
    );

    const pomodoroPlan = planPomodoroLinkInsertion(dailyContent, {
      blockId: id,
      targetPath: taskFile.path,
      sourcePath: dailyFile.path,
      resolveTarget: (reference, referrerPath) =>
        this.resolveReferenceDestination(reference, referrerPath),
      linkText,
    });
    if (pomodoroPlan.error) {
      new Notice(this.pomodoroPlanErrorNotice(pomodoroPlan.error, dailyFile.path));
      return false;
    }

    const plan = planTargetTaskUpdate(taskContent, source.line, {
      activationEligible: true,
      forceNext: true,
      newBlockId: isNewId ? id : null,
      now: this.now(),
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${source.sourcePath}`);
      return false;
    }

    if (sameNote) {
      const allEdits = [...plan.edits, ...pomodoroPlan.edits];
      if (
        !validateNonOverlappingEdits(allEdits) ||
        source.editor.getValue() !== taskContent
      ) {
        new Notice(`Task link stopped: ${source.sourcePath} changed before update`);
        return false;
      }

      this.suppressEditorScans();
      const sorted = [...allEdits].sort((left, right) => right.start - left.start);
      for (const edit of sorted) {
        source.editor.replaceRange(
          edit.replacement,
          indexToEditorPosition(taskContent, edit.start),
          indexToEditorPosition(taskContent, edit.end),
        );
      }

      this.reportPomodoroLinkOutcome(plan, pomodoroPlan, isNewId);
      return true;
    }

    if (plan.hasChanges) {
      if (!(await this.applyTargetTaskPlan(taskFile, source, plan, taskContent))) {
        return false;
      }
    }

    if (pomodoroPlan.hasChanges) {
      if (!(await this.applyTargetTaskPlan(dailyFile, source, pomodoroPlan, dailyContent))) {
        this.reportPomodoroLinkPartialFailure(plan, isNewId, dailyFile.path);
        return false;
      }
    }

    this.reportPomodoroLinkOutcome(plan, pomodoroPlan, isNewId);
    return true;
  }

  // Lane-preserving unlink: remove the task's links under today's open
  // Pomodoros and never write the checkbox. A nonblank work summary is
  // prepended to the task's Work Log; a blank one writes nothing.
  async applyPomodoroTaskUnlink(source, options = {}) {
    const normalizedSummary = normalizeWorkSummary(options.workSummary || "");
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Unlink blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    if (source.task.existingId) {
      const duplicateMatches = blockTokenMatches(
        source.editor.getValue(),
        source.task.existingId,
      );
      if (duplicateMatches.length !== 1) {
        new Notice(`Block ID '${source.task.existingId}' is duplicated in this note`);
        return false;
      }
    }

    const taskFile = source.file || this.resolveTaskFile(source.sourcePath);
    if (!taskFile) {
      new Notice("Unlink blocked: active note could not be resolved");
      return false;
    }

    const taskContent = source.editor.getValue();
    const originalCursor =
      typeof source.editor.getCursor === "function" ? source.editor.getCursor() : null;
    const taskMatch = getObsidianTaskLineMatch(currentLine);
    const status = taskMatch ? taskMatch[1] : source.task.status;

    let workLogPlan = null;
    if (normalizedSummary) {
      workLogPlan = planWorkLogInsertion(taskContent, source.line, normalizedSummary, {
        date: options.workLogDate || localTodayParts(this.now()),
      });
      if (!workLogPlan) {
        new Notice(`Unlink stopped: selected task changed in ${source.sourcePath}`);
        return false;
      }
    }

    let cleanupPlan = {
      edits: [],
      removedCount: 0,
      content: null,
      hasChanges: false,
    };
    let dailyFile = null;
    let dailyContent = null;

    if (source.task.existingId) {
      dailyFile = this.resolveTodayDailyFile();
      if (dailyFile) {
        const sameNote = dailyFile.path === taskFile.path;
        dailyContent = sameNote
          ? taskContent
          : await this.readFileSnapshot(dailyFile, source);
        if (dailyContent === null) {
          new Notice(`Unlink blocked: ${dailyFile.path} could not be read`);
          return false;
        }

        cleanupPlan = planAllOpenPomodoroLinkCleanup(dailyContent, {
          sourcePath: dailyFile.path,
          targetPath: taskFile.path,
          targetBlockId: source.task.existingId,
          resolveTarget: (reference, referrerPath) =>
            this.resolveReferenceDestination(reference, referrerPath),
        });

        if (sameNote) {
          const taskEdits = workLogPlan ? workLogPlan.edits : [];
          const allEdits = [...taskEdits, ...cleanupPlan.edits];
          if (
            !validateNonOverlappingEdits(allEdits) ||
            source.editor.getValue() !== taskContent
          ) {
            new Notice(`Unlink stopped: ${source.sourcePath} changed before update`);
            return false;
          }

          this.suppressEditorScans();
          const sorted = [...allEdits].sort((left, right) => right.start - left.start);
          for (const edit of sorted) {
            source.editor.replaceRange(
              edit.replacement,
              indexToEditorPosition(taskContent, edit.start),
              indexToEditorPosition(taskContent, edit.end),
            );
          }

          setEditorCursorIfPossible(source.editor, originalCursor);
          this.reportPomodoroUnlinkOutcome(cleanupPlan, workLogPlan || {}, status);
          return true;
        }
      }
    }

    if (cleanupPlan.hasChanges) {
      if (
        !(await this.applyTargetTaskPlan(
          dailyFile,
          source,
          cleanupPlan,
          dailyContent,
          { noticePrefix: "Unlink stopped" },
        ))
      ) {
        return false;
      }
    }

    if (workLogPlan && workLogPlan.hasChanges) {
      const workLogApplied = await this.applyTargetTaskPlan(
        taskFile,
        source,
        workLogPlan,
        taskContent,
        {
          noticePrefix: "Unlink stopped",
          quiet: cleanupPlan.removedCount > 0,
        },
      );
      if (!workLogApplied) {
        if (cleanupPlan.removedCount > 0) {
          this.reportPomodoroUnlinkPartialFailure(cleanupPlan, status, normalizedSummary);
        }
        return false;
      }
    }

    setEditorCursorIfPossible(source.editor, originalCursor);
    this.reportPomodoroUnlinkOutcome(cleanupPlan, workLogPlan || {}, status);
    return true;
  }

}
