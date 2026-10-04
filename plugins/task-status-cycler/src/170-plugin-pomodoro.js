class TaskStatusCyclerPomodoroMixin {
  // Resolves and writes every collected Task Link note group from a Pomodoro
  // close. Runs after applyPomodoroCompletionPlan has succeeded: resolution
  // re-reads live content (self-healing any line shift the plan caused) and
  // each group is resolved and written sequentially so a same-target second
  // group always sees the first group's insertion. Two sub-bullets can
  // resolve to the very same task; `priorInsertionsByTarget` threads that
  // first group's insertion point through so the second group's notes are
  // appended after it (source order) instead of independently prepending
  // above it (which would reverse them). Best effort per group — a broken
  // link, an unreadable file, or a failed write is logged and must not block
  // the other groups or undo the completion that already applied.
  async writePomodoroWorkLogNoteGroups(groups, context) {
    const dateString = this.getPomodoroWorkLogDateString(context.activePath);
    const activeNoteInsertions = [];
    const priorInsertionsByTarget = new Map();

    for (const group of groups) {
      let resolvedTarget;
      try {
        resolvedTarget = await this.resolveTranscludedBlockTarget(
          group.target,
          context,
          {
            linePredicate: isProperObsidianTaskLine,
            taskStatusPredicate: () => true,
          },
        );
      } catch (error) {
        console.error("Could not resolve Pomodoro Work Log target", error);
        continue;
      }
      if (!resolvedTarget || !resolvedTarget.file) {
        continue;
      }

      const targetKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
      try {
        const result = await this.writePomodoroWorkLogEntriesToTarget(
          resolvedTarget,
          group.descendantRoots,
          dateString,
          context,
          priorInsertionsByTarget.get(targetKey) || null,
        );
        if (!result) {
          continue;
        }
        priorInsertionsByTarget.set(targetKey, result.nextInsertion);
        if (this.fileMatchesPath(resolvedTarget.file, context.activePath)) {
          activeNoteInsertions.push({ line: result.line, count: result.count });
        }
      } catch (error) {
        console.error("Could not write Pomodoro Work Log entry", error);
      }
    }

    if (activeNoteInsertions.length > 0) {
      this.adjustCursorAfterActiveNoteInsertions(
        context.editor,
        context.cursorTargetLine,
        activeNoteInsertions,
        context.markdownView,
      );
    }
  }

  async writePomodoroWorkLogEntriesToTarget(
    resolvedTarget,
    descendantRoots,
    dateString,
    context,
    priorInsertion,
  ) {
    if (this.fileMatchesPath(resolvedTarget.file, context.activePath) && context.editor) {
      return this.writePomodoroWorkLogEntriesInEditor(
        context.editor,
        resolvedTarget.line,
        descendantRoots,
        dateString,
        priorInsertion,
      );
    }

    return this.writePomodoroWorkLogEntriesInVault(
      resolvedTarget.file,
      resolvedTarget.blockId,
      descendantRoots,
      dateString,
      priorInsertion,
    );
  }

  writePomodoroWorkLogEntriesInEditor(editor, taskLine, descendantRoots, dateString, priorInsertion) {
    const lines = this.getEditorLineTexts(editor);
    const plan = planPomodoroWorkLogGroupInsertion(
      lines,
      taskLine,
      descendantRoots,
      dateString,
      priorInsertion,
    );
    if (!plan) {
      return null;
    }

    this.insertEditorLines(plan.insertLine, plan.insertedLines, editor);
    return {
      line: plan.insertLine,
      count: plan.insertedLines.length,
      nextInsertion: plan.nextInsertion,
    };
  }

  async writePomodoroWorkLogEntriesInVault(file, blockId, descendantRoots, dateString, priorInsertion) {
    if (!this.app.vault) {
      return null;
    }

    let result = null;
    const updateSourceText = (sourceText) => {
      const text = String(sourceText || "");
      const sourceLines = splitTextByLineEndings(text);
      const lines = sourceLines.map((line) => line.text);
      const taskLine = priorInsertion ? null : findBlockLineInSourceText(text, blockId);
      if (!priorInsertion && taskLine === null) {
        return text;
      }

      const plan = planPomodoroWorkLogGroupInsertion(
        lines,
        taskLine,
        descendantRoots,
        dateString,
        priorInsertion,
      );
      if (!plan) {
        return text;
      }

      result = {
        line: plan.insertLine,
        count: plan.insertedLines.length,
        nextInsertion: plan.nextInsertion,
      };
      return insertLinesInSourceText(
        text,
        plan.insertLine,
        plan.insertedLines,
        sourceTextLineEnding(sourceLines),
      );
    };

    try {
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(file, updateSourceText);
        return result;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return null;
      }

      const sourceText = await this.app.vault.read(file);
      const nextSourceText = updateSourceText(sourceText);
      if (!result) {
        return null;
      }

      await this.app.vault.modify(file, nextSourceText);
      return result;
    } catch (error) {
      console.error("Could not write Pomodoro Work Log entries", error);
      return null;
    }
  }

  // applyPomodoroCompletionPlan already set and centered the cursor on
  // `cursorTargetLine` before these Work Log entries were inserted. An
  // insertion above that line in the active note shifts it; recompute from
  // every recorded active-note insertion, applied in the order they ran
  // (required for correctness when insertions shift each other), and only
  // re-set/re-center when the line actually moved.
  adjustCursorAfterActiveNoteInsertions(editor, cursorTargetLine, insertions, markdownView) {
    if (
      !editor ||
      typeof editor.setCursor !== "function" ||
      !Number.isInteger(cursorTargetLine)
    ) {
      return;
    }

    let nextCursorLine = cursorTargetLine;
    for (const { line, count } of insertions) {
      if (line <= nextCursorLine) {
        nextCursorLine += count;
      }
    }
    if (nextCursorLine === cursorTargetLine) {
      return;
    }

    const lineText =
      typeof editor.getLine === "function" ? editor.getLine(nextCursorLine) || "" : "";
    const targetCh = Math.min(Math.max(getPomodoroCursorTargetCh(lineText), 0), lineText.length);
    editor.setCursor({ line: nextCursorLine, ch: targetCh });
    this.scheduleCenterEditorLineInView(editor, nextCursorLine, targetCh, markdownView);
  }

  // Direct Pomodoro sub-bullet path: when the active line is an embedded
  // transcluded task link under a Pomodoro task, recursively force that selected
  // target tree to done, mirroring Pomodoro completion semantics (Todo, Next,
  // and In Progress targets -> Done; already-Done roots stay Done but are still
  // traversed for eligible descendants).
  // Unlike full Pomodoro completion this does not touch the local Pomodoro line,
  // create a placeholder, carry bullets forward, or move the cursor. Returns
  // true once the root target resolved as such a sub-bullet transclusion, even
  // if every task in the tree was already done, so the caller does not fall
  // through to the non-recursive toggle (which would reopen a done target).
  async completeActivePomodoroTranscludedTaskLine(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    if (!activePath) {
      return false;
    }

    const target = this.getActivePomodoroTranscludedTaskLineTarget(
      editor,
      activePath,
    );
    if (!target) {
      return false;
    }

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        target.candidate,
        context,
        {
          taskStatusPredicate: isTranscludedCompletionTraversableStatus,
        },
      );
    } catch (error) {
      return false;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return false;
    }

    // Fresh seen-set scopes cycle/dup detection to this single sub-bullet action.
    const seen = new Set();
    try {
      const result = await this.completeResolvedTranscludedTaskTargetTree(
        resolvedTarget,
        context,
        seen,
      );
      await this.finalizeClosedTasks(result.closed, context);
    } catch (error) {
      // Best effort: a mid-traversal failure still counts as handled because the
      // root target resolved as a Pomodoro sub-bullet transclusion.
    }
    return true;
  }

  async completeActivePomodoroTask(
    editor,
    activeFile,
    context = this.getActivePomodoroTaskContext(editor),
    markdownView = null,
  ) {
    const sourcePath = activeFile && activeFile.path;
    if (!sourcePath || !context) {
      return false;
    }

    const cursor =
      editor && typeof editor.getCursor === "function"
        ? editor.getCursor()
        : { line: context.pomodoroLine, ch: 0 };
    let lines = this.getEditorLineTexts(editor);
    let section = findPomodorosSectionInLines(lines);
    if (!isPomodoroTaskLine(lines, section, context.pomodoroLine)) {
      return false;
    }

    const subBulletRange = getSubBulletBlockRange(
      lines,
      context.pomodoroLine,
      section,
    );
    const subBullets = classifyPomodoroSubBullets(lines, subBulletRange);
    // Captured from this same pre-edit `lines` snapshot: the plan's marker
    // rewriting below can alter a descendant line that happens to contain a
    // link, so the note payload must be taken before any edits happen.
    const workLogNoteGroups = collectPomodoroWorkLogNoteGroups(
      lines,
      context.pomodoroLine,
      subBulletRange,
    );
    const closed = await this.completePomodoroTranscludedTaskBullets(
      subBullets.transcludedTaskLinkBullets,
      {
        editor,
        activePath: sourcePath,
        originPath: sourcePath,
      },
    );
    await this.startPomodoroNonTranscludedTaskBullets(
      subBullets.startableNonTranscludedTaskLinkBullets,
      {
        editor,
        activePath: sourcePath,
        originPath: sourcePath,
      },
    );

    lines = this.getEditorLineTexts(editor);
    section = findPomodorosSectionInLines(lines);
    const plan = buildPomodoroCompletionPlan(
      lines,
      section,
      context.pomodoroLine,
    );
    if (!plan) {
      return false;
    }

    const pomodoroIdentity = closedTaskIdentity(
      sourcePath,
      lines[context.pomodoroLine],
    );
    if (pomodoroIdentity) {
      closed.push(pomodoroIdentity);
    }
    const applied = this.applyPomodoroCompletionPlan(
      editor,
      plan,
      cursor,
      markdownView,
    );
    if (!applied) {
      return false;
    }
    if (workLogNoteGroups.length > 0) {
      await this.writePomodoroWorkLogNoteGroups(workLogNoteGroups, {
        editor,
        activePath: sourcePath,
        originPath: sourcePath,
        cursorTargetLine: plan.cursorTargetLine,
        markdownView,
      });
    }
    await this.finalizeClosedTasks(closed, {
      editor,
      activePath: sourcePath,
      originPath: sourcePath,
    });
    return true;
  }

  async reopenActivePomodoroTask(
    editor,
    activeFile,
    context = this.getActivePomodoroTaskContext(editor, undefined, "x"),
  ) {
    const sourcePath = activeFile && activeFile.path;
    if (!sourcePath || !context) {
      return false;
    }

    const lines = this.getEditorLineTexts(editor);
    const section = findPomodorosSectionInLines(lines);
    const pomodoroStatus = getTaskStatusForLine(
      lines[context.pomodoroLine],
      context.pomodoroLine,
    );
    if (
      !isPomodoroTaskLine(lines, section, context.pomodoroLine) ||
      !isTranscludedReopenableStatus(pomodoroStatus)
    ) {
      return false;
    }

    const subBulletRange = getSubBulletBlockRange(
      lines,
      context.pomodoroLine,
      section,
    );
    const candidates = subBulletRange
      ? collectTaskBlockLinkTargetsInLineRange(
        lines,
        sourcePath,
        subBulletRange.startLine,
        subBulletRange.endLine - 1,
      )
      : [];
    const targetContext = {
      editor,
      activePath: sourcePath,
      originPath: sourcePath,
    };
    const seen = new Set();

    for (const candidate of candidates) {
      try {
        const resolvedTarget = await this.resolveTranscludedBlockTarget(
          candidate,
          targetContext,
          { taskStatusPredicate: isOpenDoneTaskStatus },
        );
        if (!resolvedTarget || !resolvedTarget.file) {
          continue;
        }
        const key = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
          await this.reopenResolvedTranscludedTaskTarget(
            resolvedTarget,
            targetContext,
          );
        }
      } catch (error) {
        // Best effort: one stale or unreadable source must not block siblings or
        // the Pomodoro checkbox itself.
      }
    }

    const currentLineText = editor.getLine(context.pomodoroLine);
    const currentPomodoroStatus = getTaskStatusForLine(
      currentLineText,
      context.pomodoroLine,
    );
    if (!isTranscludedReopenableStatus(currentPomodoroStatus)) {
      return false;
    }
    const pomodoroIdentity = closedTaskIdentity(
      sourcePath,
      currentPomodoroStatus.lineText,
    );
    const reopened = this.setActiveCheckboxStatus(
      editor,
      currentPomodoroStatus,
      " ",
    );
    if (reopened && pomodoroIdentity) {
      await this.restoreReopenedTaskReferences(
        [pomodoroIdentity],
        targetContext,
      );
    }
    if (reopened) {
      this.clearReopenedPomodoroMarkers(editor, context.pomodoroLine);
    }
    return reopened;
  }

  clearReopenedPomodoroMarkers(editor, pomodoroLine) {
    if (!editor) {
      return false;
    }

    // Target reopening and reference restoration are asynchronous and may
    // rewrite this editor. Derive marker edits from the live text only after
    // those operations have completed so restored links are normalized too.
    const edits = buildPomodoroReopenMarkerEdits(
      this.getEditorLineTexts(editor),
      pomodoroLine,
    );
    const cursor =
      typeof editor.getCursor === "function" ? editor.getCursor() : null;
    for (const edit of edits.slice().sort((left, right) => right.line - left.line)) {
      this.replaceEditorLine(edit.line, edit.lineText, editor);
    }
    if (cursor && typeof editor.setCursor === "function") {
      const lineText = editor.getLine(cursor.line) || "";
      editor.setCursor({
        line: cursor.line,
        ch: Math.min(cursor.ch, lineText.length),
      });
    }
    return true;
  }

  async completePomodoroTranscludedTaskBullets(bullets, context) {
    // One shared seen-set across every immediate embedded target so the whole
    // Pomodoro operation dedupes targets and terminates on cycles.
    const seen = new Set();
    const closed = [];
    for (const bullet of Array.isArray(bullets) ? bullets : []) {
      for (const target of Array.isArray(bullet.targets) ? bullet.targets : []) {
        try {
          const result = await this.completeTranscludedTaskTargetTree(
            target,
            context,
            seen,
          );
          if (result && Array.isArray(result.closed)) {
            closed.push(...result.closed);
          }
        } catch (error) {
          // Best effort: one broken embed should not block Pomodoro completion.
        }
      }
    }
    return closed;
  }

  async startPomodoroNonTranscludedTaskBullets(bullets, context) {
    const seen = new Set();
    for (const bullet of Array.isArray(bullets) ? bullets : []) {
      for (const target of Array.isArray(bullet.targets) ? bullet.targets : []) {
        try {
          await this.startNonTranscludedTaskTarget(target, context, seen);
        } catch (error) {
          // Best effort: one broken link should not block Pomodoro completion.
        }
      }
    }
  }

  // Recursively forces an embedded transcluded task tree to done. The candidate
  // is resolved relative to context.originPath; descendant embedded
  // transclusions are followed with originPath rebased to the resolved file so
  // same-file `![[#^child]]` links resolve correctly. Already-done targets are
  // not rewritten but are still traversed for eligible descendants. The seen-set
  // (keyed by resolved `path#^block-id`) plus the depth/target caps keep cycles
  // and large accidental graphs bounded. Returns { visited, changed, closed }:
  // visited
  // is true once the candidate resolved to a fresh in-bounds target, changed is
  // true when this node or any descendant was forced to done.
  async completeTranscludedTaskTargetTree(candidate, context, seen, depth = 0) {
    if (depth > MAX_TRANSCLUDED_RECURSION_DEPTH) {
      return { visited: false, changed: false, closed: [] };
    }

    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(candidate, context, {
        taskStatusPredicate: isTranscludedCompletionTraversableStatus,
      });
    } catch (error) {
      return { visited: false, changed: false, closed: [] };
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false, closed: [] };
    }

    return this.completeResolvedTranscludedTaskTargetTree(
      resolvedTarget,
      context,
      seen,
      depth,
    );
  }

  // Resolved-target half of the recursive closure. Splitting it out lets a
  // direct sub-bullet caller resolve once, know the command was handled, and
  // avoid falling through to the non-recursive toggle when the root is already
  // done. The seen-check and seen-add live here so both the candidate entry
  // point and direct callers share identical cycle/dup and cap handling.
  async completeResolvedTranscludedTaskTargetTree(
    resolvedTarget,
    context,
    seen,
    depth = 0,
  ) {
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false, closed: [] };
    }

    const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
    if (seen.has(seenKey) || seen.size >= MAX_TRANSCLUDED_RECURSION_TARGETS) {
      return { visited: false, changed: false, closed: [] };
    }
    seen.add(seenKey);

    const childContext = {
      editor: context.editor,
      activePath: context.activePath,
      originPath: resolvedTarget.file.path,
    };
    const childTargets = collectEmbeddedTranscludedTaskTargetsInListItemBlock(
      resolvedTarget.sourceText,
      resolvedTarget.line,
    );
    let changed = false;
    const closed = [];
    for (const childTarget of childTargets) {
      try {
        const childResult = await this.completeTranscludedTaskTargetTree(
          childTarget,
          childContext,
          seen,
          depth + 1,
        );
        if (childResult && childResult.changed) {
          changed = true;
        }
        if (childResult && Array.isArray(childResult.closed)) {
          closed.push(...childResult.closed);
        }
      } catch (error) {
        // Best effort: one broken descendant should not block its siblings.
      }
    }

    // Done parents stay done; Todo, Next, and In Progress tasks are forced to
    // Done. The replacement path revalidates the line and block ID before
    // writing.
    if (isTranscludedCompletionClosableStatus(resolvedTarget.taskStatus)) {
      const wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        "x",
      );
      if (wrote) {
        changed = true;
        closed.push(
          closedTaskIdentity(
            resolvedTarget.file.path,
            resolvedTarget.taskStatus.lineText,
          ) || {
            path: resolvedTarget.file.path,
            blockId: resolvedTarget.blockId,
          },
        );
      }
    }

    return { visited: true, changed, closed };
  }

  // Starts a single strict bare non-transcluded Pomodoro link target. Unlike
  // embedded transclusions, non-transcluded starts deliberately treat the
  // resolved source task as a leaf and do not inspect its descendants.
  async startNonTranscludedTaskTarget(candidate, context, seen) {
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(candidate, context, {
        linePredicate: isProperObsidianTaskLine,
        taskStatusPredicate: isNonTranscludedStartResolvableStatus,
      });
    } catch (error) {
      return { visited: false, changed: false };
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    return this.startResolvedNonTranscludedTaskTarget(
      resolvedTarget,
      context,
      seen,
    );
  }

  async startResolvedNonTranscludedTaskTarget(
    resolvedTarget,
    context,
    seen,
  ) {
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
    if (seen && seen.has(seenKey)) {
      return { visited: false, changed: false };
    }
    if (seen) {
      seen.add(seenKey);
    }

    let changed = false;
    if (isNonTranscludedStartableStatus(resolvedTarget.taskStatus)) {
      const wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        "/",
      );
      if (wrote) {
        changed = true;
      }
    }

    return { visited: true, changed };
  }

}
