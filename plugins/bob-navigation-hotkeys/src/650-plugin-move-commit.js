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

  // Review-walk (nav-gestures): the origin rides in on
  // `session.reviewOrigin` and is settled exactly once — parked on success,
  // settled without advancing on every refusal or failure. A move never
  // advances. `taskMoveReviewCommitStarted` is set synchronously so the
  // picker's `onClose` (which ran before this commit) knows not to settle.
  async commitTaskMoveSession(session, destinationEntry) {
    const reviewOrigin =
      session && session.reviewOrigin ? session.reviewOrigin : null;
    this.taskMoveReviewCommitStarted = true;
    let reviewSettled = false;
    const settleMoveReview = (outcome) => {
      if (reviewSettled || !reviewOrigin) {
        return;
      }
      reviewSettled = true;
      try {
        void this.continueReviewWalkAfter(reviewOrigin, outcome);
      } catch (error) {
        // `continueReviewWalkAfter` never throws; best effort only.
      }
    };
    const parkMoveReview = (handledRefs) => {
      if (reviewSettled || !reviewOrigin) {
        return;
      }
      reviewSettled = true;
      try {
        this.parkReviewWalkAfterMove(reviewOrigin, handledRefs);
      } catch (error) {
        // `parkReviewWalkAfterMove` never throws; best effort only.
      }
    };
    try {
      return await this.commitTaskMoveSessionWrite(session, destinationEntry, {
        reviewOrigin,
        reviewPark: parkMoveReview,
      });
    } finally {
      settleMoveReview(null);
    }
  }

  // Ctrl+Shift+M commit: the shared `planAndWriteTaskMoveFiles` core
  // (in `655-plugin-inbox-route.js`) plans, writes, and rolls back and
  // returns a structured result; this wrapper keeps the move's park, focus,
  // and notice behavior. A move never advances the walk.
  async commitTaskMoveSessionWrite(session, destinationEntry, moveOptions = {}) {
    const reviewPark =
      moveOptions && typeof moveOptions.reviewPark === "function"
        ? moveOptions.reviewPark
        : null;
    const reviewOrigin =
      moveOptions && moveOptions.reviewOrigin ? moveOptions.reviewOrigin : null;
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

    const result = await this.planAndWriteTaskMoveFiles({
      sourcePath: session.sourcePath,
      sourceContent: session.sourceContent,
      editor: session.editor,
      cursor: session.cursor,
      targets: session.discovery.targets,
      destinationPath: destinationFile.path,
    });
    if (!result || result.ok !== true) {
      this.restoreTaskMoveSourceContext(session);
      new Notice(
        result && result.reason
          ? result.reason
          : "Task move failed; completed writes were rolled back and source tasks were retained",
      );
      return false;
    }
    const plan = result.plan;
    const finalCursor = result.finalCursor;

    // Review-walk (nav-gestures): a move never advances. Park the walk
    // before focusing, because the destination's `file-open` runs
    // `trackOpenedFile`, which would clear the landing and make the park
    // read stale. Then always focus the destination and show the plain
    // move notice.
    if (reviewOrigin && reviewPark) {
      const sourceLines = String(session.sourceContent || "").split(/\r?\n/);
      reviewPark(
        (session.discovery.targets || [])
          .filter((target) => target && Number.isInteger(target.line))
          .map((target) =>
            Object.freeze({
              path: session.sourcePath,
              line: target.line,
              raw: String(sourceLines[target.line] ?? target.rawLine ?? ""),
            }),
          ),
      );
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
          result.destinationFile,
          {
            line: plan.destinationLine,
            text: plan.destinationAnchorText,
            blockId: plan.destinationBlockId,
          },
          vimJumpContext,
        );
      } else {
        await this.focusTaskMoveDestination(result.destinationFile, {
          line: plan.destinationLine,
          text: plan.destinationAnchorText,
          blockId: plan.destinationBlockId,
        });
      }
    } catch (error) {
      // Destination navigation and history are best-effort after commit.
    }
    const count = session.discovery.actualCount;
    const destinationName = result.destinationName;
    const clamped = session.discovery.clamped
      ? ` (requested ${session.discovery.requestedCount}; reached end of note)`
      : "";
    const moveNoticeText =
      `Moved ${count} task${count === 1 ? "" : "s"} to ${destinationName}${clamped}`;
    new Notice(moveNoticeText);
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
