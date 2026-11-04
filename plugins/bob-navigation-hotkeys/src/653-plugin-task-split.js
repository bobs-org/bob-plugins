// Ctrl+Shift+T task-split gesture: cursor, counted, and visual-selection
// splits through the `planSplitBullets` twin (256/257), with one-transaction
// same-note writes, cursor landing with a Vim jump context, and an Undo
// notice for cross-note splits. The Tab-mark picker on task lines and drawer
// titles lands in the next phase; here those rows get the planner's teaching
// notice. Never touches the review walk: `captureReviewGesture` busy handling
// is the only interaction.

// Pure gesture description for tests and the command route. `gesture` carries
// 0-based lines: { cursorLine, anchorLine, headLine, countExplicit,
// additionalCount }. Returns { ownerKind, ownerLine, selection } or
// { refuse, message }.
function describeTaskSplitGesture(content, gesture) {
  const text = String(content || "");
  const info = gesture && typeof gesture === "object" ? gesture : {};
  const cursorLine = Math.max(0, Math.floor(info.cursorLine || 0));
  const anchorLine = Number.isInteger(info.anchorLine)
    ? info.anchorLine
    : cursorLine;
  const headLine = Number.isInteger(info.headLine) ? info.headLine : cursorLine;
  const visual =
    Math.min(anchorLine, headLine) !== Math.max(anchorLine, headLine);
  if (visual) {
    const from = Math.max(0, Math.min(anchorLine, headLine));
    const to = Math.max(anchorLine, headLine);
    const ownerA = findTaskSplitGestureOwner(text, from);
    const ownerB = findTaskSplitGestureOwner(text, to);
    if (
      !ownerA ||
      !ownerB ||
      ownerA.kind !== ownerB.kind ||
      ownerA.line !== ownerB.line
    ) {
      return {
        refuse: "split_crosses_owners",
        message:
          "Split stays inside one task — select bullets under the same task",
      };
    }
    const listed = listTaskSplitCandidates(
      { "note.md": text },
      { ownerPath: "note.md", ownerLine: ownerA.line + 1, selection: {} },
    );
    if (!listed.ok) {
      return { refuse: listed.code, message: listed.message };
    }
    const picks = listed.candidates
      .filter(
        (candidate) => candidate.line - 1 >= from && candidate.line - 1 <= to,
      )
      .map((candidate) => candidate.ordinal);
    if (picks.length === 0) {
      return {
        refuse: "split_not_splittable",
        message: "That line is not a splittable note",
      };
    }
    return {
      ownerKind: ownerA.kind,
      ownerLine: ownerA.line,
      selection: { kind: "nth", picks },
    };
  }
  const owner = findTaskSplitGestureOwner(text, cursorLine);
  if (!owner) {
    return {
      refuse: "split_owner_missing",
      message: "Place the cursor on a task note or section bullet",
    };
  }
  if (info.countExplicit === true && (info.additionalCount || 0) > 0) {
    return {
      ownerKind: owner.kind,
      ownerLine: owner.line,
      selection: {
        kind: "count",
        line: cursorLine + 1,
        count: (info.additionalCount || 0) + 1,
      },
    };
  }
  return {
    ownerKind: owner.kind,
    ownerLine: owner.line,
    selection: { kind: "cursor", line: cursorLine + 1 },
  };
}

function findTaskSplitGestureOwner(content, line) {
  const text = String(content || "");
  const lines = taskSplitLines(text);
  if (lines.length === 0) {
    return null;
  }
  const index = Math.min(Math.max(0, line), lines.length - 1);
  const stripped = lines.map((entry) => taskSplitStripEnding(entry));
  const frontmatterEnd = taskSplitFrontmatterEnd(stripped);
  const fenced = taskSplitFencedLines(
    stripped,
    frontmatterEnd === -1 ? 0 : frontmatterEnd + 1,
  );
  const isTaskLine = (candidate) =>
    candidate >= 0 &&
    candidate < lines.length &&
    !fenced.has(candidate) &&
    (frontmatterEnd === -1 || candidate > frontmatterEnd) &&
    taskSplitParseTaskLine(lines[candidate]) !== null;
  if (isTaskLine(index)) {
    return { kind: "task", line: index };
  }
  let current = index;
  for (;;) {
    const parent = taskSplitParentListLine(stripped, current, 0);
    if (parent === null) {
      break;
    }
    current = parent;
    if (isTaskLine(current)) {
      return { kind: "task", line: current };
    }
  }
  if (
    taskSplitListBody(lines[current]) !== null &&
    taskSplitIndentOf(stripped[current]) === ""
  ) {
    const section = taskSplitSectionOwnerForBullet(lines, current);
    if (section) {
      return { kind: "section", line: section.line };
    }
  }
  return null;
}

function formatTaskSplitGestureNotice(plan) {
  const base = String((plan && plan.notice) || "");
  if (plan && plan.clamped) {
    return `${base} · clamped to ${plan.clamped.split} of ${plan.clamped.requested}`;
  }
  return base;
}

class BobNavigationHotkeysTaskSplitMixin {
  registerTaskSplitCommand() {
    this.addCommand({
      id: "split-bullets-into-tasks",
      name: "Split bullets into tasks",
      // Obsidian core claims Mod+Shift+T for `workspace:undo-close-pane`;
      // the vault rebinds that core chord so this literal Ctrl chord wins.
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "T" }],
      editorCallback: (editor, view) => this.splitBulletsIntoTasks(editor, view),
    });
  }

  withPendingTaskSplitCount(editor, view, options = {}) {
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
    resetPendingVimInputState(cm, "task-split");
    return {
      ...options,
      countExplicit: true,
      additionalTaskCount: pending.repeat,
    };
  }

  // Fallback for runtimes where no Obsidian binding handled the chord, mirroring
  // the counted task-move listeners: the command route consumes the Vim count
  // itself, so this acts only when the hotkey was removed or is unhandled.
  registerTaskSplitInputListeners() {
    this.handledTaskSplitEvents = new WeakSet();
    const keydownHandler = (event) => this.handleTaskSplitPhysicalKeydown(event);
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

  handleTaskSplitPhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isTaskSplitKeydown(event)) {
      return false;
    }
    if (event && event.defaultPrevented === true) {
      return false;
    }
    if (
      this.handledTaskSplitEvents &&
      this.handledTaskSplitEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView();
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledTaskSplitEvents) {
      this.handledTaskSplitEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "task-split");
    void this.splitBulletsIntoTasks(view.editor, view, {
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    });
    return true;
  }

  isTaskSplitKeydown(event) {
    return Boolean(
      event &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.code === "KeyT" || event.key === "t" || event.key === "T"),
    );
  }

  async splitBulletsIntoTasks(editor, view, options = {}) {
    const resolvedOptions = this.withPendingTaskSplitCount(editor, view, options);
    try {
      if (typeof this.captureReviewGesture === "function") {
        const captured = this.captureReviewGesture(editor);
        if (captured && captured.busy === true) {
          return true;
        }
      }
    } catch (error) {
      // A walk probe never blocks the split.
    }
    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown note before splitting bullets");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a splittable bullet");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    let anchorLine = cursor.line;
    let headLine = cursor.line;
    try {
      if (
        typeof editor.somethingSelected === "function" &&
        editor.somethingSelected() &&
        typeof editor.listSelections === "function"
      ) {
        const selections = editor.listSelections() || [];
        if (selections.length > 0) {
          let low = Number.POSITIVE_INFINITY;
          let high = Number.NEGATIVE_INFINITY;
          for (const selection of selections) {
            const anchor = selection && selection.anchor;
            const head = selection && selection.head;
            if (!anchor || !head) {
              continue;
            }
            low = Math.min(low, anchor.line, head.line);
            high = Math.max(high, anchor.line, head.line);
          }
          if (Number.isFinite(low) && Number.isFinite(high)) {
            anchorLine = low;
            headLine = high;
          }
        }
      }
    } catch (error) {
      anchorLine = cursor.line;
      headLine = cursor.line;
    }
    const described = describeTaskSplitGesture(sourceContent, {
      cursorLine: cursor.line,
      anchorLine,
      headLine,
      countExplicit: resolvedOptions.countExplicit === true,
      additionalCount: resolvedOptions.additionalTaskCount || 0,
    });
    if (described.refuse) {
      new Notice(described.message);
      return false;
    }
    const settings = {
      linked_from_mentions: loadRelationsLinkedFromMentionsEnabled(),
      linked_from_lines: loadRelationsLinkedFromLinesEnabled(),
      inbox_route: INBOX_NOTE_PATH,
    };
    const today = formatProjectTaskCreatedDate(new Date());
    const files = { [sourceFile.path]: sourceContent };
    try {
      const ownerForPlacement = {
        kind: described.ownerKind,
        line: described.ownerLine,
        end: described.ownerLine,
        title: "",
        blockId: null,
      };
      const placement = taskSplitChoosePlacement(
        sourceFile.path,
        taskSplitLines(sourceContent),
        ownerForPlacement,
        INBOX_NOTE_PATH,
      );
      if (placement.path !== sourceFile.path) {
        const destinationFile = this.app.vault.getAbstractFileByPath(
          placement.path,
        );
        if (destinationFile && this.isMarkdownFile(destinationFile)) {
          files[placement.path] = String(
            (await this.app.vault.cachedRead(destinationFile)) || "",
          );
        }
      }
    } catch (error) {
      // Destination pre-read is best-effort; the planner runs on the source.
    }
    const plan = planSplitBullets(files, {
      ownerPath: sourceFile.path,
      ownerLine: described.ownerLine + 1,
      selection: described.selection,
      today,
      settings,
    });
    if (!plan.ok) {
      new Notice(plan.message);
      return false;
    }
    if (plan.cursor.path === sourceFile.path) {
      return this.applyTaskSplitSameNote(editor, sourceFile, sourceContent, cursor, plan);
    }
    return this.applyTaskSplitCrossNote(
      editor,
      sourceView,
      sourceFile,
      sourceContent,
      plan,
    );
  }

  applyTaskSplitSameNote(editor, sourceFile, sourceContent, cursor, plan) {
    const after = plan.files[sourceFile.path];
    if (typeof after !== "string") {
      new Notice("Split planned no change");
      return false;
    }
    const landingLine = Math.max(0, (plan.cursor.line || 1) - 1);
    let applied = false;
    try {
      applied = applyEditorContentTransaction(editor, sourceContent, after, {
        line: landingLine,
        ch: 0,
      });
    } catch (error) {
      new Notice("Split failed to apply");
      return false;
    }
    if (!applied || String(editor.getValue() || "") !== after) {
      new Notice("Split failed to apply");
      return false;
    }
    try {
      if (typeof this.ensureVimJumpHistory === "function") {
        this.ensureVimJumpHistory();
      }
      recordVimJumpTransition(
        this.vimJumpHistory,
        {
          path: sourceFile.path,
          line: cursor.line,
          ch: cursor.ch || 0,
        },
        { path: sourceFile.path, line: landingLine, ch: 0 },
      );
    } catch (error) {
      // The Vim jump context is a nicety; the write already landed.
    }
    new Notice(formatTaskSplitGestureNotice(plan));
    return true;
  }

  async applyTaskSplitCrossNote(editor, sourceView, sourceFile, sourceContent, plan) {
    const destinationPath = plan.cursor.path;
    const destinationAfter = plan.files[destinationPath];
    const sourceAfter = plan.files[sourceFile.path];
    if (typeof destinationAfter !== "string" || typeof sourceAfter !== "string") {
      new Notice("Split planned no change");
      return false;
    }
    const session = { sourcePath: sourceFile.path, editor: null };
    const written = [];
    try {
      const destinationFile = this.app.vault.getAbstractFileByPath(
        destinationPath,
      );
      if (destinationFile && this.isMarkdownFile(destinationFile)) {
        const destinationBefore = String(
          (await this.app.vault.cachedRead(destinationFile)) || "",
        );
        written.push(
          await this.writeTaskMoveChange(
            destinationPath,
            { before: destinationBefore, after: destinationAfter },
            destinationFile,
            session,
          ),
        );
      } else if (!destinationFile) {
        const created = await this.app.vault.create(
          destinationPath,
          destinationAfter,
        );
        written.push({
          path: destinationPath,
          file: created,
          editor: null,
          change: { before: "", after: destinationAfter },
          created: true,
        });
      } else {
        new Notice(`Split destination is not a Markdown note: ${destinationPath}`);
        return false;
      }
      written.push(
        await this.writeTaskMoveChange(
          sourceFile.path,
          { before: sourceContent, after: sourceAfter },
          sourceFile,
          session,
        ),
      );
    } catch (error) {
      const failedPaths = await this.rollbackTaskMoveChanges(
        written.filter((entry) => !entry.created),
      );
      for (const entry of written.filter((entry) => entry.created)) {
        try {
          await this.app.vault.delete(entry.file);
        } catch (ignoredError) {
          failedPaths.push(entry.path);
        }
      }
      if (failedPaths.length > 0) {
        new Notice(`Split wrote partially — review: ${failedPaths.join(", ")}`);
      } else {
        new Notice("Split failed to apply");
      }
      return false;
    }
    this.showTaskSplitUndoNotice(
      formatTaskSplitGestureNotice(plan),
      written.map((entry) => ({
        path: entry.path,
        file: entry.file || null,
        before: entry.change.before,
        after: entry.change.after,
      })),
    );
    return true;
  }

  showTaskSplitUndoNotice(message, restores) {
    const notice = new Notice(String(message || ""), 15000);
    try {
      const container = notice && notice.noticeEl;
      if (container && typeof container.createEl === "function") {
        const button = container.createEl("button", { text: "Undo split" });
        button.addEventListener("click", () => {
          void this.restoreTaskSplitUndo(restores, notice);
        });
      }
    } catch (error) {
      // The notice text remains without the action.
    }
    return notice;
  }

  async restoreTaskSplitUndo(restores, notice) {
    const rows = Array.isArray(restores) ? restores.slice().reverse() : [];
    const refused = [];
    for (const restore of rows) {
      try {
        const editor =
          typeof this.getOpenMarkdownEditorForPath === "function"
            ? this.getOpenMarkdownEditorForPath(restore.path)
            : null;
        if (editor && typeof editor.getValue === "function") {
          if (String(editor.getValue() || "") !== restore.after) {
            refused.push(restore.path);
            continue;
          }
          if (
            !applyEditorContentTransaction(
              editor,
              restore.after,
              restore.before,
            ) ||
            String(editor.getValue() || "") !== restore.before
          ) {
            refused.push(restore.path);
          }
          continue;
        }
        const file =
          restore.file ||
          (this.app &&
            this.app.vault &&
            this.app.vault.getAbstractFileByPath(restore.path));
        if (!file) {
          refused.push(restore.path);
          continue;
        }
        const current = String(
          (await this.app.vault.cachedRead(file)) || "",
        );
        if (current !== restore.after) {
          refused.push(restore.path);
          continue;
        }
        await this.app.vault.modify(file, restore.before);
      } catch (error) {
        refused.push(restore.path);
      }
    }
    if (refused.length > 0) {
      new Notice(`Could not undo split — changed since: ${refused.join(", ")}`);
      return false;
    }
    try {
      if (notice && typeof notice.hide === "function") {
        notice.hide();
      }
    } catch (error) {
      // The success notice below is the signal.
    }
    new Notice("Undid split");
    return true;
  }
}
