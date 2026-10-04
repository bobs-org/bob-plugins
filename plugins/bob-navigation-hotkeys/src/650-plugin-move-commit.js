class BobNavigationHotkeysMoveCommitMixin {

  async commitPomodoroBulletMoveSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was moved");
      return false;
    }

    let destination;
    let destinationLabel;
    if (row && row.kind === "existing") {
      destination = {
        kind: "existing",
        entryLine: row.entry && row.entry.entryLine,
      };
      destinationLabel = getPomodoroBulletMoveDestinationLabel(row.entry);
    } else if (row && row.kind === "new") {
      destination = { kind: "new", name: row.name };
      destinationLabel = row.name;
    } else {
      return false;
    }

    const plan = planPomodoroBulletMove(session.sourceContent, {
      targets: session.discovery.targets,
      sourceEntryLine: session.discovery.entryLine,
      destination,
    });
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const firstMovedLine = Math.min(
      Math.max(
        Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0,
        0,
      ),
      Math.max(afterLines.length - 1, 0),
    );
    const sourceCursor = normalizePosition(session.cursor) || {
      line: firstMovedLine,
      ch: 0,
    };
    const finalCursor = {
      line: firstMovedLine,
      ch: Math.min(
        sourceCursor.ch,
        String(afterLines[firstMovedLine] || "").length,
      ),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro bullet move failed; nothing was moved");
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(
      buildPomodoroBulletMoveNotice(
        plan,
        session.discovery,
        destinationLabel,
      ),
    );
    return true;
  }

  async commitPomodoroBulletSplitSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was split");
      return false;
    }
    if (!row || row.kind !== "split") {
      new Notice("Select the split row to split a merged Pomodoro; nothing was split");
      return false;
    }

    const sourceLines = splitMarkdownContent(session.sourceContent).lines;
    const sourceEntryLine = session.discovery.entryLine;
    const plan = planPomodoroBulletSplit(session.sourceContent, {
      targets: session.discovery.targets,
      sourceEntryLine,
      sourceRawLine: String(sourceLines[sourceEntryLine] || ""),
      splitName: row.name,
    });
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was split`);
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const firstMovedLine = Math.min(
      Math.max(
        Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0,
        0,
      ),
      Math.max(afterLines.length - 1, 0),
    );
    const sourceCursor = normalizePosition(session.cursor) || {
      line: firstMovedLine,
      ch: 0,
    };
    const finalCursor = {
      line: firstMovedLine,
      ch: Math.min(
        sourceCursor.ch,
        String(afterLines[firstMovedLine] || "").length,
      ),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro split failed; nothing was split");
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(buildPomodoroBulletSplitNotice(plan, session.discovery));
    return true;
  }

  async commitPomodoroEntryMoveSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was moved");
      return false;
    }

    const isRename = Boolean(row && row.kind === "rename");
    const isMove = Boolean(row && row.kind === "existing");
    if (!isRename && !isMove) {
      return false;
    }

    const sourceEntryLine = session.discovery.entryLine;
    const sourceRawLine = session.discovery.rawEntryLine;
    const destinationLabel = isMove
      ? getPomodoroBulletMoveDestinationLabel(row.entry)
      : null;
    const plan = isMove
      ? planPomodoroBulletMove(session.sourceContent, {
          scope: "entry",
          targets: session.discovery.targets,
          sourceEntryLine,
          sourceRawLine,
          destination: {
            kind: "existing",
            entryLine: row.entry && row.entry.entryLine,
          },
        })
      : planPomodoroEntryRename(session.sourceContent, {
          sourceEntryLine,
          sourceRawLine,
          name: row.name,
        });

    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }
    if (isRename && plan.unchanged) {
      new Notice(
        `Pomodoro #${session.sourceEntry.position} is already named ${plan.name}`,
      );
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    let finalCursor;
    if (isMove) {
      const firstMovedLine = Math.min(
        Math.max(
          Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0,
          0,
        ),
        Math.max(afterLines.length - 1, 0),
      );
      const sourceCursor = normalizePosition(session.cursor) || {
        line: firstMovedLine,
        ch: 0,
      };
      finalCursor = {
        line: firstMovedLine,
        ch: Math.min(
          sourceCursor.ch,
          String(afterLines[firstMovedLine] || "").length,
        ),
      };
    } else {
      const sourceCursor = normalizePosition(session.cursor) || {
        line: sourceEntryLine,
        ch: 0,
      };
      finalCursor = {
        line: sourceEntryLine,
        ch: Math.min(
          sourceCursor.ch,
          String(afterLines[sourceEntryLine] || "").length,
        ),
      };
    }

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice(
        isRename
          ? "Pomodoro rename failed; nothing was changed"
          : "Pomodoro entry move failed; nothing was moved",
      );
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(
      isRename
        ? `Renamed Pomodoro #${session.sourceEntry.position} to ${plan.name}`
        : buildPomodoroEntryMoveNotice(plan, session.discovery, destinationLabel),
    );
    return true;
  }

  async commitPomodoroEntryMergeSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was merged");
      return false;
    }
    if (!row || row.kind !== "existing") {
      new Notice("Select an existing Pomodoro to merge; nothing was merged");
      return false;
    }

    const plan = planPomodoroEntryMerge(
      session.sourceContent,
      buildPomodoroEntryMergeOptions(session, row),
    );
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was merged`);
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const survivorEntryLine = Math.min(
      Math.max(
        Number.isInteger(plan.survivorEntryLine) ? plan.survivorEntryLine : 0,
        0,
      ),
      Math.max(afterLines.length - 1, 0),
    );
    const sourceCursor = normalizePosition(session.cursor) || {
      line: survivorEntryLine,
      ch: 0,
    };
    const finalCursor = {
      line: survivorEntryLine,
      ch: Math.min(
        sourceCursor.ch,
        String(afterLines[survivorEntryLine] || "").length,
      ),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro merge failed; nothing was merged");
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(buildPomodoroEntryMergeNotice(plan));
    return true;
  }

  async commitTaskMoveSession(session, destinationEntry) {
    const destinationFile = destinationEntry && destinationEntry.file;
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !activeView ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      !this.isMarkdownFile(destinationFile)
    ) {
      new Notice("Source task note is no longer active; nothing was moved");
      return false;
    }
    if (
      destinationFile.path === session.sourcePath ||
      TASK_MOVE_TEMPLATE_PATHS.has(destinationFile.path)
    ) {
      new Notice("Selected task destination is not eligible");
      return false;
    }
    if (String(session.editor.getValue() || "") !== session.sourceContent) {
      new Notice("A selected task changed while the destination picker was open");
      return false;
    }

    const vault = this.app && this.app.vault;
    if (
      !vault ||
      typeof vault.getMarkdownFiles !== "function" ||
      typeof vault.process !== "function"
    ) {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    const snapshots = new Map();
    const filesByPath = new Map();
    try {
      for (const file of vault.getMarkdownFiles()) {
        if (!this.isMarkdownFile(file)) {
          continue;
        }
        const snapshot = await this.getTaskMoveFileSnapshot(file);
        snapshots.set(file.path, snapshot.content);
        filesByPath.set(file.path, file);
      }
    } catch (error) {
      new Notice("Could not read every affected note; nothing was moved");
      return false;
    }
    if (
      snapshots.get(session.sourcePath) !== session.sourceContent ||
      !snapshots.has(destinationFile.path)
    ) {
      new Notice("Task move source or destination changed; nothing was moved");
      return false;
    }

    const destinationContent = snapshots.get(destinationFile.path);
    const otherContents = new Map(snapshots);
    otherContents.delete(session.sourcePath);
    otherContents.delete(destinationFile.path);
    const plan = planTaskMoveAcrossFiles({
      sourcePath: session.sourcePath,
      destinationPath: destinationFile.path,
      sourceContent: session.sourceContent,
      destinationContent,
      otherContents,
      targets: session.discovery.targets,
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }

    const sourceChange = plan.changes.get(session.sourcePath);
    const sourceLines = splitMarkdownContent(sourceChange.after).lines;
    const sourceLine = Math.min(
      plan.nextSourceLine,
      Math.max(sourceLines.length - 1, 0),
    );
    const finalCursor = {
      line: sourceLine,
      ch: Math.min(
        session.cursor.ch,
        String(sourceLines[sourceLine] || "").length,
      ),
    };
    const auxiliaryPaths = Array.from(plan.changes.keys())
      .filter(
        (path) =>
          path !== destinationFile.path && path !== session.sourcePath,
      )
      .sort();
    const writeOrder = [
      destinationFile.path,
      ...auxiliaryPaths,
      session.sourcePath,
    ];
    const written = [];
    try {
      for (const path of writeOrder) {
        const change = plan.changes.get(path);
        if (!change || change.before === change.after) {
          continue;
        }
        if (
          path === session.sourcePath &&
          (this.getActiveMarkdownView()?.editor !== session.editor ||
            String(session.editor.getValue() || "") !== change.before)
        ) {
          throw new Error("Source editor changed before final removal");
        }
        const file = filesByPath.get(path);
        if (!this.isMarkdownFile(file)) {
          throw new Error(`Affected Markdown file disappeared: ${path}`);
        }
        written.push(
          await this.writeTaskMoveChange(
            path,
            change,
            file,
            session,
            path === session.sourcePath ? finalCursor : null,
          ),
        );
      }
    } catch (error) {
      if (
        error &&
        error.taskMoveAppliedEntry &&
        !written.some((entry) => entry.path === error.taskMoveAppliedEntry.path)
      ) {
        written.push(error.taskMoveAppliedEntry);
      }
      const failedRollbacks = await this.rollbackTaskMoveChanges(written);
      this.restoreTaskMoveSourceContext(session);
      if (failedRollbacks.length > 0) {
        new Notice(
          `Task move could not finish; recoverable duplicates may need repair in ${failedRollbacks.join(", ")}`,
        );
      } else {
        new Notice("Task move failed; completed writes were rolled back and source tasks were retained");
      }
      return false;
    }

    let vimJumpContext = null;
    try {
      vimJumpContext = this.createVimJumpContextWithOrigin({
        path: session.sourcePath,
        line: finalCursor.line,
        ch: finalCursor.ch,
      });
    } catch (error) {
      vimJumpContext = null;
    }
    try {
      if (vimJumpContext) {
        await this.focusTaskMoveDestination(
          destinationFile,
          {
            line: plan.destinationLine,
            text: plan.destinationAnchorText,
            blockId: plan.destinationBlockId,
          },
          vimJumpContext,
        );
      } else {
        await this.focusTaskMoveDestination(destinationFile, {
          line: plan.destinationLine,
          text: plan.destinationAnchorText,
          blockId: plan.destinationBlockId,
        });
      }
    } catch (error) {
      // Destination navigation and history are best-effort after commit.
    }
    const count = session.discovery.actualCount;
    const destinationName =
      destinationFile.basename ||
      getVaultPathBasenameWithoutExtension(destinationFile.path);
    const clamped = session.discovery.clamped
      ? ` (requested ${session.discovery.requestedCount}; reached end of note)`
      : "";
    new Notice(
      `Moved ${count} task${count === 1 ? "" : "s"} to ${destinationName}${clamped}`,
    );
    return true;
  }

  async focusTaskMoveDestination(file, anchor, vimJumpContext = null) {
    this.captureActiveFilePosition();

    const destinationName =
      file.basename || getVaultPathBasenameWithoutExtension(file.path);
    let opened = false;
    try {
      opened = await this.openMarkdownFileWithLeafReuse(
        file,
        `Moved tasks, but could not open ${destinationName}`,
      );
    } catch (error) {
      opened = false;
    }
    if (!opened) {
      return false;
    }

    const hasMoveContext =
      vimJumpContext &&
      vimJumpContext.origin &&
      normalizeVimJumpLocation(vimJumpContext.origin);
    if (!hasMoveContext) {
      return this.jumpOrDeferTaskMoveDestination(file.path, anchor);
    }

    if (vimJumpContext.token !== this.vimJumpOperationToken) {
      return false;
    }

    let settleCompletion = null;
    const completionPromise = new Promise((resolve) => {
      settleCompletion = resolve;
    });
    const completion = {
      resolve: (result) => {
        try {
          settleCompletion(result);
        } catch (error) {
          // Best-effort settle only.
        }
      },
      token: vimJumpContext.token,
    };

    try {
      this.jumpOrDeferTaskMoveDestination(
        file.path,
        anchor,
        TASK_MOVE_DESTINATION_JUMP_RETRIES,
        completion,
      );
    } catch (error) {
      try {
        settleCompletion({ ok: false, reason: "error" });
      } catch (ignoredError) {
        // Best-effort settle only.
      }
    }

    let landing = null;
    try {
      landing = await completionPromise;
    } catch (error) {
      landing = { ok: false, reason: "error" };
    }

    if (!landing || !landing.ok || !landing.destination) {
      return Boolean(landing && landing.ok);
    }

    try {
      await this.enqueueVimJumpContextTransition(
        vimJumpContext,
        landing.destination,
        { expectedPath: file.path },
      );
    } catch (error) {
      // History is best-effort after a committed move.
    }
    return true;
  }

  jumpOrDeferTaskMoveDestination(
    path,
    anchor,
    retriesRemaining = TASK_MOVE_DESTINATION_JUMP_RETRIES,
    completion = null,
  ) {
    let retries = retriesRemaining;
    let completionHolder = completion;
    if (
      retries !== null &&
      typeof retries === "object" &&
      completionHolder === null
    ) {
      completionHolder = retries;
      retries = TASK_MOVE_DESTINATION_JUMP_RETRIES;
    }
    retries = Math.max(
      0,
      Math.floor(numericOrDefault(retries, TASK_MOVE_DESTINATION_JUMP_RETRIES)),
    );

    this.cancelPendingTaskMoveJump();

    let landing = null;
    if (
      completionHolder &&
      typeof completionHolder === "object" &&
      typeof completionHolder.resolve === "function" &&
      typeof completionHolder.token === "number"
    ) {
      this.taskMoveLandingSeq = Math.floor(
        numericOrDefault(this.taskMoveLandingSeq, 0),
      ) + 1;
      landing = {
        id: this.taskMoveLandingSeq,
        completion: completionHolder,
        token: completionHolder.token,
        path,
      };
      this.pendingTaskMoveJumpLandingId = landing.id;
      this.pendingTaskMoveJumpCompletion = landing;
    } else if (typeof completionHolder === "function") {
      this.taskMoveLandingSeq = Math.floor(
        numericOrDefault(this.taskMoveLandingSeq, 0),
      ) + 1;
      landing = {
        id: this.taskMoveLandingSeq,
        completion: { resolve: completionHolder, token: this.vimJumpOperationToken },
        token: this.vimJumpOperationToken,
        path,
      };
      this.pendingTaskMoveJumpLandingId = landing.id;
      this.pendingTaskMoveJumpCompletion = landing;
    } else {
      this.pendingTaskMoveJumpLandingId = null;
      this.pendingTaskMoveJumpCompletion = null;
    }

    return this.attemptTaskMoveDestination(path, anchor, retries, landing);
  }

  attemptTaskMoveDestination(path, anchor, retriesRemaining, landing) {
    const retries = Math.max(
      0,
      Math.floor(numericOrDefault(retriesRemaining, 0)),
    );

    if (landing && landing.token !== this.vimJumpOperationToken) {
      const settled = landing.completion;
      if (this.pendingTaskMoveJumpLandingId === landing.id) {
        this.pendingTaskMoveJumpLandingId = null;
        this.pendingTaskMoveJumpCompletion = null;
      }
      try {
        if (settled && typeof settled.resolve === "function") {
          settled.resolve({ ok: false, reason: "superseded" });
        } else if (typeof settled === "function") {
          settled(null, { ok: false, reason: "superseded" });
        }
      } catch (error) {
        // Best-effort settle only.
      }
      return false;
    }

    let placed = false;
    try {
      placed = this.jumpToActiveTaskMoveDestination(
        path,
        anchor,
        landing ? { suppressNativeMirror: true } : null,
      );
    } catch (error) {
      placed = false;
    }

    if (placed) {
      let snapshot = null;
      try {
        const view = this.getActiveMarkdownView();
        if (view && view.file && view.file.path === path && view.editor) {
          const cursor = normalizePosition(view.editor.getCursor());
          if (cursor) {
            snapshot = { path, line: cursor.line, ch: cursor.ch };
          }
        }
      } catch (error) {
        snapshot = null;
      }

      if (landing) {
        const settled = landing.completion;
        if (this.pendingTaskMoveJumpLandingId === landing.id) {
          this.pendingTaskMoveJumpLandingId = null;
          this.pendingTaskMoveJumpCompletion = null;
        }
        try {
          if (settled && typeof settled.resolve === "function") {
            settled.resolve({ ok: true, destination: snapshot });
          } else if (typeof settled === "function") {
            settled(null, { ok: true, destination: snapshot });
          }
        } catch (error) {
          // Best-effort settle only.
        }
      }
      return true;
    }

    if (retries <= 0) {
      if (landing) {
        const settled = landing.completion;
        if (this.pendingTaskMoveJumpLandingId === landing.id) {
          this.pendingTaskMoveJumpLandingId = null;
          this.pendingTaskMoveJumpCompletion = null;
        }
        try {
          if (settled && typeof settled.resolve === "function") {
            settled.resolve({ ok: false, reason: "exhausted" });
          } else if (typeof settled === "function") {
            settled(null, { ok: false, reason: "exhausted" });
          }
        } catch (error) {
          // Best-effort settle only.
        }
      }
      return false;
    }

    this.pendingTaskMoveJumpDeferred = deferToNextFrame(() => {
      this.pendingTaskMoveJumpDeferred = null;
      if (landing) {
        if (
          this.pendingTaskMoveJumpLandingId !== landing.id ||
          landing.token !== this.vimJumpOperationToken
        ) {
          if (this.pendingTaskMoveJumpLandingId === landing.id) {
            this.pendingTaskMoveJumpLandingId = null;
            this.pendingTaskMoveJumpCompletion = null;
          }
          try {
            const settled = landing.completion;
            if (settled && typeof settled.resolve === "function") {
              settled.resolve({ ok: false, reason: "superseded" });
            } else if (typeof settled === "function") {
              settled(null, { ok: false, reason: "superseded" });
            }
          } catch (error) {
            // Best-effort settle only.
          }
          return;
        }
      }
      try {
        this.attemptTaskMoveDestination(path, anchor, retries - 1, landing);
      } catch (error) {
        if (landing) {
          const settled = landing.completion;
          if (this.pendingTaskMoveJumpLandingId === landing.id) {
            this.pendingTaskMoveJumpLandingId = null;
            this.pendingTaskMoveJumpCompletion = null;
          }
          try {
            if (settled && typeof settled.resolve === "function") {
              settled.resolve({ ok: false, reason: "error" });
            } else if (typeof settled === "function") {
              settled(null, { ok: false, reason: "error" });
            }
          } catch (ignoredError) {
            // Best-effort settle only.
          }
        }
      }
    });

    return false;
  }

  jumpToActiveTaskMoveDestination(path, anchor, options = null) {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== path ||
      !view.editor ||
      typeof view.editor.getValue !== "function"
    ) {
      return false;
    }

    const resolved = resolveTaskMoveDestinationLine(
      view.editor.getValue(),
      anchor,
    );
    const suppress =
      options &&
      typeof options === "object" &&
      options.suppressNativeMirror === true;
    let previousSuppress = false;
    if (suppress) {
      previousSuppress = this.vimJumpSuppressNativeMirror;
      this.vimJumpSuppressNativeMirror = true;
    }
    try {
      if (!setEditorCursor(view.editor, { line: resolved.line, ch: 0 })) {
        return false;
      }
    } finally {
      if (suppress) {
        this.vimJumpSuppressNativeMirror = previousSuppress;
      }
    }

    scheduleOpenTaskJumpCenter(this, view.editor, resolved.line, 0);
    return true;
  }

  cancelPendingTaskMoveJump() {
    cancelDeferred(this.pendingTaskMoveJumpDeferred);
    this.pendingTaskMoveJumpDeferred = null;
    const pending = this.pendingTaskMoveJumpCompletion;
    this.pendingTaskMoveJumpCompletion = null;
    this.pendingTaskMoveJumpLandingId = null;
    if (pending && pending.completion) {
      try {
        const settled = pending.completion;
        if (settled && typeof settled.resolve === "function") {
          settled.resolve({ ok: false, reason: "cancelled" });
        } else if (typeof settled === "function") {
          settled(null, { ok: false, reason: "cancelled" });
        }
      } catch (error) {
        // Best-effort settle only.
      }
    }
  }
}
