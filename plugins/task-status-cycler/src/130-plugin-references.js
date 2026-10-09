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
      // One gated dependency plan: the successor pass recovers and links
      // in a single Warm pass (anchors are read while the cursor link is
      // still unstruck and before embed retirement). No legacy full-scan
      // recovery follows it. Best-effort: a failure here never blocks the
      // close.
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
      // Recovery counts and failures propagate from that same plan: every
      // applied `?`-changing row counts as reopened, and a failed plan
      // reports the lookup as failed instead of scanning the vault again.
      // A gated plan (no `[id::]`) stays quiet: nothing was checkable.
      let reopened = 0;
      let recoveryFailures = [];
      if (successors && successors.gated === true) {
        successors = null;
      } else if (successors && Array.isArray(successors.unblocked)) {
        for (const row of successors.unblocked) {
          if (
            row && row.previous_status_symbol === "?" &&
            row.status_symbol !== "?" && row.not_linked !== "failed"
          ) {
            reopened += 1;
          }
        }
        if (successors.failure) {
          recoveryFailures = [
            successors.failure.reason || "blocked dependents could not be checked",
          ];
          new Notice("Closed tasks, but blocked dependents could not be checked.");
        }
      } else {
        recoveryFailures = ["blocked dependents could not be checked"];
        new Notice("Closed tasks, but blocked dependents could not be checked.");
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
        reopened,
        retired: retirement.retired,
        recoveryFailures,
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
    // builder would resolve zero closed ids), pure speed-up. The resolved
    // identities are kept for the Warm path's complete closed set below.
    let resolvedClosed = null;
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
        if (gate && Array.isArray(gate.identities)) {
          resolvedClosed = gate.identities;
        }
      }
    } catch (error) {
      // Best effort: fall through to the full recovery below.
      resolvedClosed = null;
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
    const recoveryToday =
      context && typeof context.today === "string" && context.today
        ? context.today
        : typeof this.getScheduleLogDateString === "function"
          ? this.getScheduleLogDateString()
          : formatLocalDate();

    // Warm fast path: the Tasks cache already indexes every task, so the
    // open set is complete without reading bodies, and only notes holding
    // a dependent of the closed set are read (open editor buffers first,
    // exactly like the cold scan). Recovery semantics are unchanged —
    // Ready recovery with no links — and an unready cache falls back to
    // the full scan below.
    let plan = null;
    let warm = false;
    try {
      if (
        typeof this.buildSuccessorPool === "function" && resolvedClosed
      ) {
        const closedIds = new Set();
        for (const identity of resolvedClosed) {
          if (identity && identity.taskId) {
            closedIds.add(String(identity.taskId));
          }
        }
        if (closedIds.size === 0) {
          return { reopened: 0, failures: [] };
        }
        const pool = await this.buildSuccessorPool(
          closedIds,
          context || {},
          new Map(),
        );
        if (pool && pool.warm && Array.isArray(pool.tasks)) {
          const openIds = new Set();
          const candidatePaths = new Set();
          for (const task of pool.tasks) {
            if (!task || typeof task !== "object") {
              continue;
            }
            if (
              task.taskId &&
              DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) &&
              !closedIds.has(String(task.taskId))
            ) {
              openIds.add(String(task.taskId));
            }
            if (
              task.path && Array.isArray(task.dependsOn) &&
              task.dependsOn.some((id) => closedIds.has(String(id)))
            ) {
              candidatePaths.add(String(task.path));
            }
          }
          for (const path of candidatePaths) {
            const text = pool.noteTexts.get(path);
            if (typeof text !== "string") {
              recordFailure(path, "note could not be read");
              continue;
            }
            documents.push({
              path,
              text,
              file: fileByPath.get(path) || null,
              editor: openEditors.get(path) || null,
            });
          }
          plan = buildBlockedDependentRecoveryPlan(
            documents,
            resolvedClosed,
            {
              today: recoveryToday,
              openIds: [...openIds],
              closedIds: [...closedIds],
            },
          );
          warm = true;
        }
      }
    } catch (error) {
      warm = false;
      plan = null;
    }
    if (!warm) {
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
      plan = buildBlockedDependentRecoveryPlan(documents, closedIdentities, {
        today: recoveryToday,
      });
    }
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

  // Sources that link any closed note, from the vault link index
  // (`metadataCache.resolvedLinks`/`unresolvedLinks`, inverted): the only
  // notes that can embed a closed task, plus the closed notes themselves
  // (mutual embeds), the active note, and every open editor buffer (newer
  // than the index). Null when the index is unavailable — callers keep the
  // conservative full scan so no retirement write is ever dropped to pass
  // a counter.
  retirementLinkerPaths(closedIdentities, context) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      const resolved = metadataCache && metadataCache.resolvedLinks;
      const unresolved = metadataCache && metadataCache.unresolvedLinks;
      if (
        (!resolved || typeof resolved !== "object") &&
        (!unresolved || typeof unresolved !== "object")
      ) {
        return null;
      }
      const wanted = new Set();
      for (const identity of normalizeTaskReferenceIdentities(closedIdentities)) {
        if (identity && identity.path) {
          wanted.add(String(identity.path));
        }
      }
      if (wanted.size === 0) {
        return new Set();
      }
      const linkers = new Set(wanted);
      for (const index of [resolved, unresolved]) {
        if (!index || typeof index !== "object") {
          continue;
        }
        for (const source of Object.keys(index)) {
          let dests = null;
          try {
            dests = index[source];
          } catch (error) {
            dests = null;
          }
          if (!dests || typeof dests !== "object") {
            continue;
          }
          for (const dest of Object.keys(dests)) {
            if (wanted.has(String(dest))) {
              linkers.add(String(source));
              break;
            }
          }
        }
      }
      const active = context && context.activePath;
      if (active) {
        linkers.add(String(active));
      }
      if (typeof this.getOpenMarkdownEditors === "function") {
        for (const path of this.getOpenMarkdownEditors(context || {}).keys()) {
          linkers.add(String(path));
        }
      }
      return linkers;
    } catch (error) {
      return null;
    }
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
        linkerPaths: this.retirementLinkerPaths(closedIdentities, context || {}),
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
    // Open buffers are read in memory: the active editor plus every other
    // open Markdown editor, which may be newer than the vault on disk.
    let openEditors = null;
    try {
      openEditors = typeof this.getOpenMarkdownEditors === "function"
        ? this.getOpenMarkdownEditors(context || {})
        : new Map();
    } catch (error) {
      openEditors = new Map();
    }
    if (editor && typeof editor.getValue === "function" && activePath) {
      openEditors.set(activePath, editor);
    }
    // A caller-supplied linker set restricts the scan to notes that can
    // hold a matching reference (plus open buffers, always eligible);
    // without one every note is visited, exactly as before.
    const linkerPaths = mutation && mutation.linkerPaths instanceof Set
      ? mutation.linkerPaths
      : null;

    const applyEditorBuffer = (buffer, bufferPath) => {
      const before = buffer.getValue();
      const result = mutation.transform(
        before,
        bufferPath,
        identities,
        resolveLinkPath,
      );
      if (result.changed) {
        const oldLines = splitTextByLineEndings(before).map((line) => line.text);
        const newLines = splitTextByLineEndings(result.text).map(
          (line) => line.text,
        );
        const cursor =
          typeof buffer.getCursor === "function" ? buffer.getCursor() : null;
        for (let line = oldLines.length - 1; line >= 0; line -= 1) {
          if (oldLines[line] !== newLines[line]) {
            this.replaceEditorLine(line, newLines[line], buffer);
          }
        }
        if (cursor && typeof buffer.setCursor === "function") {
          const lineText = buffer.getLine(cursor.line) || "";
          buffer.setCursor({
            line: cursor.line,
            ch: Math.min(cursor.ch, lineText.length),
          });
        }
      }
      count += result[mutation.countField];
    };

    for (const file of vault.getMarkdownFiles()) {
      if (!file || !file.path) {
        continue;
      }
      const openEditor = openEditors.get(file.path) || null;
      if (
        linkerPaths && !linkerPaths.has(file.path) && !openEditor
      ) {
        continue;
      }
      try {
        if (openEditor && typeof openEditor.getValue === "function") {
          applyEditorBuffer(openEditor, file.path);
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
