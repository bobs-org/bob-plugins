class TaskStatusCyclerReferencesMixin {
  retireClosedTaskReferences(closedIdentities, context) {
    const closed = normalizeTaskReferenceIdentities(closedIdentities);
    if (closed.length === 0) {
      return Promise.resolve({ retired: 0, failures: [] });
    }
    const run = () => this.retireClosedTaskReferencesNow(closed, context || {});
    return this.enqueueTaskReferenceMutation(run);
  }

  // Versioned cross-plugin API for keymaps that close tasks through their own
  // writes (e.g. the Ctrl+Shift+P cancel picker): recover Blocked dependents
  // of `closedIdentities` without retiring references. Resolves to
  // `{ reopened, failures }` and never throws; failures are returned, not
  // raised. Each identity is `{ path, blockId, taskId }` with at least one
  // of `blockId`/`taskId`. Exposed frozen as `this.api` (see `onload`).
  recoverBlockedDependents(closedIdentities, context) {
    const closed = normalizeClosedTaskIdentities(closedIdentities);
    if (closed.length === 0) {
      return Promise.resolve({ reopened: 0, failures: [] });
    }
    const run = async () => {
      try {
        return await this.recoverBlockedDependentsNow(closed, context || {});
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        return { reopened: 0, failures: [message] };
      }
    };
    return this.enqueueTaskReferenceMutation(run);
  }

  restoreReopenedTaskReferences(reopenedIdentities, context) {
    const reopened = normalizeTaskReferenceIdentities(reopenedIdentities);
    if (reopened.length === 0) {
      return Promise.resolve({ restored: 0, failures: [] });
    }
    const run = () =>
      this.restoreReopenedTaskReferencesNow(reopened, context || {});
    return this.enqueueTaskReferenceMutation(run);
  }

  enqueueTaskReferenceMutation(run) {
    const queued = (this.referenceMutationQueue || Promise.resolve()).then(
      run,
      run,
    );
    this.referenceMutationQueue = queued.catch(() => {});
    return queued;
  }

  finalizeClosedTasks(closedIdentities, context) {
    const closed = normalizeClosedTaskIdentities(closedIdentities);
    if (closed.length === 0) {
      return Promise.resolve({
        reopened: 0,
        retired: 0,
        recoveryFailures: [],
        retirementFailures: [],
        successors: null,
        successorNotice: null,
      });
    }
    return this.enqueueTaskReferenceMutation(async () => {
      // Successor pass first: anchors are read while the cursor link is
      // still unstruck (the strike lands after this job) and before embed
      // retirement. Best-effort: a failure here never blocks the close.
      let successors = null;
      try {
        successors = await this.planAndApplySuccessorsNow(
          closed,
          context || {},
        );
      } catch (error) {
        console.error("Could not plan successor links", error);
        successors = null;
      }
      let recovery;
      try {
        recovery = await this.recoverBlockedDependentsNow(
          closed,
          context || {},
        );
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        console.error("Could not recover blocked dependents", error);
        new Notice("Closed tasks, but blocked dependents could not be checked.");
        recovery = { reopened: 0, failures: [message] };
      }
      const retirement = await this.retireClosedTaskReferencesNow(
        normalizeTaskReferenceIdentities(closed),
        context || {},
      );
      let successorNotice = null;
      try {
        successorNotice = this.presentSuccessorModel(successors, context || {});
      } catch (error) {
        successorNotice = null;
      }
      return {
        reopened: recovery.reopened,
        retired: retirement.retired,
        recoveryFailures: recovery.failures,
        retirementFailures: retirement.failures,
        successors,
        successorNotice,
      };
    });
  }

  getOpenMarkdownEditors(context = {}) {
    const editors = new Map();
    const addView = (view) => {
      if (
        view &&
        view.file &&
        view.file.path &&
        view.editor &&
        typeof view.editor.getValue === "function"
      ) {
        editors.set(view.file.path, view.editor);
      }
    };
    if (
      context.activePath &&
      context.editor &&
      typeof context.editor.getValue === "function"
    ) {
      editors.set(context.activePath, context.editor);
    }
    const workspace = this.app && this.app.workspace;
    if (!workspace) {
      return editors;
    }
    if (typeof workspace.getActiveViewOfType === "function") {
      addView(workspace.getActiveViewOfType(MarkdownView));
    }
    if (typeof workspace.getLeavesOfType === "function") {
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        addView(leaf && leaf.view);
      }
    }
    return editors;
  }

  async recoverBlockedDependentsNow(closedIdentities, context) {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return { reopened: 0, failures: [] };
    }
    // Gate: with no `[id::]` in the closed set nothing can be blocked on
    // it, so skip the vault-wide scan entirely. Identical output (the plan
    // builder would resolve zero closed ids), pure speed-up.
    try {
      if (typeof this.resolveSuccessorClosedIdentities === "function") {
        const gate = await this.resolveSuccessorClosedIdentities(
          closedIdentities,
          context || {},
          new Map(),
        );
        if (gate && gate.gated) {
          return { reopened: 0, failures: [] };
        }
      }
    } catch (error) {
      // Best effort: fall through to the full recovery below.
    }
    const openEditors = this.getOpenMarkdownEditors(context || {});
    const files = vault.getMarkdownFiles().filter(
      (file) => file && file.path && MARKDOWN_EXTENSION_RE.test(file.path),
    );
    const fileByPath = new Map(files.map((file) => [file.path, file]));
    const documents = [];
    const failures = [];
    const failedPaths = new Set();
    const recordFailure = (path, message) => {
      const filePath = String(path || "(unknown note)");
      failures.push(`${filePath}: ${message}`);
      failedPaths.add(filePath);
    };

    for (const file of files) {
      try {
        const editor = openEditors.get(file.path);
        const text = editor
          ? editor.getValue()
          : typeof vault.cachedRead === "function"
            ? await vault.cachedRead(file)
            : typeof vault.read === "function"
              ? await vault.read(file)
              : null;
        if (typeof text !== "string") {
          recordFailure(file.path, "note could not be read");
          continue;
        }
        documents.push({ path: file.path, text, file, editor: editor || null });
      } catch (error) {
        recordFailure(file.path, error.message || String(error));
      }
    }

    const recoveryToday =
      context && typeof context.today === "string" && context.today
        ? context.today
        : typeof this.getScheduleLogDateString === "function"
          ? this.getScheduleLogDateString()
          : formatLocalDate();
    const plan = buildBlockedDependentRecoveryPlan(documents, closedIdentities, {
      today: recoveryToday,
    });
    const editsByPath = new Map();
    for (const edit of plan.edits) {
      if (!editsByPath.has(edit.path)) {
        editsByPath.set(edit.path, []);
      }
      editsByPath.get(edit.path).push(edit);
    }
    let reopened = 0;

    for (const [path, edits] of editsByPath) {
      const editor = openEditors.get(path);
      if (editor) {
        const cursor =
          typeof editor.getCursor === "function" ? editor.getCursor() : null;
        for (const edit of edits) {
          const currentLine =
            typeof editor.getLine === "function" ? editor.getLine(edit.line) : null;
          const task = currentLine === edit.sourceLineText
            ? parseTaskDependencyLine(currentLine, path, edit.line)
            : null;
          if (
            !task ||
            task.status !== "?" ||
            task.statusStart !== edit.statusStart ||
            typeof editor.replaceRange !== "function"
          ) {
            recordFailure(path, `line ${edit.line + 1} changed before recovery`);
            continue;
          }
          editor.replaceRange(
            " ",
            { line: edit.line, ch: task.statusStart },
            { line: edit.line, ch: task.statusStart + 1 },
          );
          reopened += 1;
        }
        if (cursor && typeof editor.setCursor === "function") {
          const cursorLine = editor.getLine(cursor.line) || "";
          editor.setCursor({
            line: cursor.line,
            ch: Math.min(cursor.ch, cursorLine.length),
          });
        }
        continue;
      }

      const file = fileByPath.get(path);
      if (!file) {
        recordFailure(path, "note disappeared before recovery");
        continue;
      }
      try {
        let result = { reopened: 0, stale: [], text: null };
        const transform = (text) => {
          result = applyBlockedDependentRecoveryEdits(text, edits);
          return result.text;
        };
        if (typeof vault.process === "function") {
          await vault.process(file, transform);
        } else if (
          typeof vault.read === "function" &&
          typeof vault.modify === "function"
        ) {
          const liveText = await vault.read(file);
          const nextText = transform(liveText);
          if (nextText !== liveText) {
            await vault.modify(file, nextText);
          }
        } else {
          recordFailure(path, "note cannot be updated safely");
          continue;
        }
        reopened += result.reopened;
        for (const stale of result.stale) {
          recordFailure(path, `line ${stale.line + 1} changed before recovery`);
        }
      } catch (error) {
        recordFailure(path, error.message || String(error));
      }
    }

    if (failures.length > 0) {
      console.error("Could not recover all blocked dependents", failures);
      new Notice(
        `Closed tasks, but ${failedPaths.size} note${failedPaths.size === 1 ? "" : "s"} could not be checked for blocked dependents.`,
      );
    }
    return { reopened, failures };
  }

  async retireClosedTaskReferencesNow(closedIdentities, context) {
    const result = await this.mutateTaskReferencesNow(
      closedIdentities,
      context,
      {
        transform: retireClosedTaskReferencesInText,
        countField: "retired",
        candidateText: "![[",
        concurrentChangeMessage: "note changed while retirement was planned",
        failureLog: "Could not retire all closed task references",
        failureNotice: (count) =>
          `Closed tasks, but ${count} note${count === 1 ? "" : "s"} could not be checked for references.`,
      },
    );
    return { retired: result.count, failures: result.failures };
  }

  async restoreReopenedTaskReferencesNow(reopenedIdentities, context) {
    const result = await this.mutateTaskReferencesNow(
      reopenedIdentities,
      context,
      {
        transform: restoreReopenedTaskReferencesInText,
        countField: "restored",
        candidateText: "[[",
        concurrentChangeMessage: "note changed while restoration was planned",
        failureLog: "Could not restore all reopened task references",
        failureNotice: (count) =>
          `Reopened tasks, but ${count} note${count === 1 ? "" : "s"} could not be checked for retired references.`,
      },
    );
    return { restored: result.count, failures: result.failures };
  }

  lineHasSelectedTaskBlockLink(lineText, selection) {
    if (!selection || typeof selection.blockId !== "string") {
      return false;
    }
    return getBlockLinkTokenCandidates(String(lineText || "")).some(
      (candidate) =>
        candidate.pathPart === selection.pathPart &&
        candidate.blockId === selection.blockId,
    );
  }

  findActiveSelectedTaskBlockLinkLine(editor, candidate) {
    const lines = this.getEditorLineTexts(editor);
    if (!candidate || !Number.isInteger(candidate.activeLine)) {
      return { lines, targetLine: null };
    }
    if (
      candidate.activeLine >= 0 &&
      candidate.activeLine < lines.length &&
      this.lineHasSelectedTaskBlockLink(lines[candidate.activeLine], candidate)
    ) {
      return { lines, targetLine: candidate.activeLine };
    }
    const exactMatches = [];
    for (let line = 0; line < lines.length; line += 1) {
      if (
        lines[line] === candidate.activeLineText &&
        this.lineHasSelectedTaskBlockLink(lines[line], candidate)
      ) {
        exactMatches.push(line);
      }
    }
    if (exactMatches.length === 1) {
      return { lines, targetLine: exactMatches[0] };
    }
    return { lines, targetLine: null };
  }

  async strikeActiveSelectedTaskBlockLink(editor, activePath, candidate) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function" ||
      !candidate
    ) {
      return false;
    }
    return this.enqueueTaskReferenceMutation(async () => {
      const located = this.findActiveSelectedTaskBlockLinkLine(editor, candidate);
      let targetLine = located.targetLine;
      let lines = located.lines;
      if (targetLine === null) {
        const retiredForms = new Set();
        for (const pomodoro of [true, false]) {
          try {
            const retired = strikeSelectedTaskBlockLinkInLine(
              candidate.activeLineText,
              candidate,
              { pomodoro },
            );
            if (retired && retired !== candidate.activeLineText) {
              retiredForms.add(retired);
            }
          } catch (error) {
            // Best effort: one pomodoro variant failing must not block the other.
          }
        }
        if (retiredForms.size > 0) {
          lines = this.getEditorLineTexts(editor);
          const retiredMatches = [];
          for (let line = 0; line < lines.length; line += 1) {
            if (
              retiredForms.has(lines[line]) &&
              this.lineHasSelectedTaskBlockLink(lines[line], candidate)
            ) {
              retiredMatches.push(line);
            }
          }
          if (retiredMatches.length === 1) {
            return false;
          }
        }
        return false;
      }
      lines = this.getEditorLineTexts(editor);
      if (targetLine < 0 || targetLine >= lines.length) {
        return false;
      }
      const fenced = getFencedLineNumbers(lines);
      if (fenced.has(targetLine)) {
        return false;
      }
      const pomodoros = findPomodorosSectionInLines(lines);
      const ancestry = hasEligibleRetirementAncestor(
        lines,
        targetLine,
        fenced,
        pomodoros,
      );
      const currentLineText = typeof editor.getLine === "function"
        ? editor.getLine(targetLine) || ""
        : lines[targetLine] || "";
      if (!this.lineHasSelectedTaskBlockLink(currentLineText, candidate)) {
        return false;
      }
      const nextLineText = strikeSelectedTaskBlockLinkInLine(
        currentLineText,
        candidate,
        { pomodoro: ancestry.pomodoro },
      );
      if (!nextLineText || nextLineText === currentLineText) {
        return false;
      }
      const cursor = typeof editor.getCursor === "function"
        ? editor.getCursor()
        : null;
      editor.replaceRange(
        nextLineText,
        { line: targetLine, ch: 0 },
        { line: targetLine, ch: currentLineText.length },
      );
      if (cursor && typeof editor.setCursor === "function") {
        const lineText = typeof editor.getLine === "function"
          ? editor.getLine(cursor.line) || ""
          : "";
        editor.setCursor({
          line: cursor.line,
          ch: Math.min(cursor.ch, lineText.length),
        });
      }
      return true;
    });
  }

  async unstrikeActiveSelectedTaskBlockLink(editor, activePath, candidate) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function" ||
      !candidate
    ) {
      return false;
    }
    return this.enqueueTaskReferenceMutation(async () => {
      const located = this.findActiveSelectedTaskBlockLinkLine(editor, candidate);
      let targetLine = located.targetLine;
      if (targetLine === null) {
        let restoredForm = null;
        try {
          restoredForm = unstrikeSelectedTaskBlockLinkInLine(
            candidate.activeLineText,
            candidate,
          );
        } catch (error) {
          restoredForm = null;
        }
        if (restoredForm && restoredForm !== candidate.activeLineText) {
          const lines = this.getEditorLineTexts(editor);
          const restoredMatches = [];
          for (let line = 0; line < lines.length; line += 1) {
            if (
              lines[line] === restoredForm &&
              this.lineHasSelectedTaskBlockLink(lines[line], candidate)
            ) {
              restoredMatches.push(line);
            }
          }
          if (restoredMatches.length === 1) {
            return false;
          }
        }
        return false;
      }
      const lines = this.getEditorLineTexts(editor);
      if (targetLine < 0 || targetLine >= lines.length) {
        return false;
      }
      if (getFencedLineNumbers(lines).has(targetLine)) {
        return false;
      }
      const currentLineText = typeof editor.getLine === "function"
        ? editor.getLine(targetLine) || ""
        : lines[targetLine] || "";
      if (!this.lineHasSelectedTaskBlockLink(currentLineText, candidate)) {
        return false;
      }
      const nextLineText = unstrikeSelectedTaskBlockLinkInLine(
        currentLineText,
        candidate,
      );
      if (!nextLineText || nextLineText === currentLineText) {
        return false;
      }
      const cursor = typeof editor.getCursor === "function"
        ? editor.getCursor()
        : null;
      editor.replaceRange(
        nextLineText,
        { line: targetLine, ch: 0 },
        { line: targetLine, ch: currentLineText.length },
      );
      if (cursor && typeof editor.setCursor === "function") {
        const lineText = typeof editor.getLine === "function"
          ? editor.getLine(cursor.line) || ""
          : "";
        editor.setCursor({
          line: cursor.line,
          ch: Math.min(cursor.ch, lineText.length),
        });
      }
      return true;
    });
  }

  async mutateTaskReferencesNow(identities, context, mutation) {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return { count: 0, failures: [] };
    }
    const editor = context && context.editor;
    const activePath = context && context.activePath;
    const resolveLinkPath = (pathPart, originPath) => {
      if (
        !this.app.metadataCache ||
        typeof this.app.metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      const file = this.app.metadataCache.getFirstLinkpathDest(
        pathPart,
        originPath,
      );
      return file && file.path;
    };
    let count = 0;
    const failures = [];

    for (const file of vault.getMarkdownFiles()) {
      if (!file || !file.path) {
        continue;
      }
      try {
        if (
          file.path === activePath &&
          editor &&
          typeof editor.getValue === "function"
        ) {
          const before = editor.getValue();
          const result = mutation.transform(
            before,
            file.path,
            identities,
            resolveLinkPath,
          );
          if (result.changed) {
            const oldLines = splitTextByLineEndings(before).map((line) => line.text);
            const newLines = splitTextByLineEndings(result.text).map(
              (line) => line.text,
            );
            const cursor =
              typeof editor.getCursor === "function" ? editor.getCursor() : null;
            for (let line = oldLines.length - 1; line >= 0; line -= 1) {
              if (oldLines[line] !== newLines[line]) {
                this.replaceEditorLine(line, newLines[line], editor);
              }
            }
            if (cursor && typeof editor.setCursor === "function") {
              const lineText = editor.getLine(cursor.line) || "";
              editor.setCursor({
                line: cursor.line,
                ch: Math.min(cursor.ch, lineText.length),
              });
            }
          }
          count += result[mutation.countField];
          continue;
        }

        let fileCount = 0;
        const snapshot =
          typeof vault.cachedRead === "function"
            ? await vault.cachedRead(file)
            : typeof vault.read === "function"
              ? await vault.read(file)
              : null;
        if (
          typeof snapshot !== "string" ||
          !snapshot.includes(mutation.candidateText) ||
          !identities.some((identity) =>
            snapshot.includes(`#^${identity.blockId}`),
          )
        ) {
          continue;
        }
        const transform = (text) => {
          const result = mutation.transform(
            text,
            file.path,
            identities,
            resolveLinkPath,
          );
          fileCount = result[mutation.countField];
          return result.text;
        };
        const planned = transform(snapshot);
        const plannedCount = fileCount;
        if (planned === snapshot) {
          continue;
        }
        fileCount = 0;
        if (typeof vault.process === "function") {
          await vault.process(file, transform);
        } else if (
          typeof vault.read === "function" &&
          typeof vault.modify === "function"
        ) {
          const next = planned;
          if (next !== snapshot) {
            const live = await vault.read(file);
            if (live !== snapshot) {
              throw new Error(mutation.concurrentChangeMessage);
            }
            await vault.modify(file, next);
            fileCount = plannedCount;
          }
        }
        count += fileCount;
      } catch (error) {
        failures.push(`${file.path}: ${error.message || String(error)}`);
      }
    }

    if (failures.length > 0) {
      console.error(mutation.failureLog, failures);
      new Notice(mutation.failureNotice(failures.length));
    }
    return { count, failures };
  }

}
