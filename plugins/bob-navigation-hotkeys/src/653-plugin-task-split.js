// Ctrl+Shift+T task-split gesture: cursor, counted, visual-selection, and
// Tab-mark picker splits through the `planSplitBullets` twin (256/257), with
// one-transaction same-note writes, guarded cross-note writes, and one
// reusable Undo notice action. Never touches the review walk:
// `captureReviewGesture` busy handling is the only interaction.

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
    const ownerRequestLine =
      ownerA.kind === "section"
        ? taskSplitSectionBulletInRange(text, ownerA.line, from, to)
        : ownerA.line;
    if (ownerRequestLine < 0) {
      return {
        refuse: "split_not_splittable",
        message: "That line is not a splittable note",
      };
    }
    const listed = listTaskSplitCandidates(
      { "note.md": text },
      { ownerPath: "note.md", ownerLine: ownerRequestLine + 1, selection: {} },
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
      ownerLine: ownerRequestLine,
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
  if (owner.kind === "task" && cursorLine === owner.line) {
    return {
      ownerKind: owner.kind,
      ownerLine: owner.line,
      picker: { scope: "task" },
    };
  }
  if (owner.kind === "task") {
    const drawerTitle = taskSplitDrawerTitleAt(text, owner.line, cursorLine);
    if (drawerTitle) {
      return {
        ownerKind: owner.kind,
        ownerLine: owner.line,
        picker: { scope: "drawer", title: drawerTitle },
      };
    }
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
    ownerLine: owner.kind === "section" ? cursorLine : owner.line,
    selection: { kind: "cursor", line: cursorLine + 1 },
  };
}

function taskSplitSectionBulletInRange(content, sectionLine, from, to) {
  const lines = taskSplitLines(String(content || ""));
  const first = Math.max(0, from);
  const last = Math.min(lines.length - 1, to);
  for (let line = first; line <= last; line += 1) {
    if (taskSplitSectionOwnerForBullet(lines, line)?.line === sectionLine) {
      return line;
    }
  }
  return -1;
}

function taskSplitDrawerTitleAt(content, ownerLine, line) {
  const lines = taskSplitLines(String(content || ""));
  if (line <= ownerLine || line >= lines.length) {
    return null;
  }
  const stripped = lines.map((entry) => taskSplitStripEnding(entry));
  if (taskSplitParentListLine(stripped, line, ownerLine) !== ownerLine) {
    return null;
  }
  const body = taskSplitListBody(lines[line]);
  if (body === null) {
    return null;
  }
  const classified = taskSplitClassifyChild(stripped[line]);
  return classified.kind === "drawer" ? classified.title : null;
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

const TASK_SPLIT_PICKER_HINTS = Object.freeze([
  { keys: ["↵"], label: "split" },
  { keys: ["⇥"], label: "mark" },
  { keys: ["esc"], label: "cancel" },
]);

function buildTaskSplitPickerRows(candidates, options = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const drawerTitle = String(options.drawerTitle || "").trim();
  return Object.freeze(
    rows
      .filter(
        (candidate) =>
          candidate &&
          (!drawerTitle || candidate.drawer === drawerTitle),
      )
      .map((candidate) => {
        const ordinal = Math.max(0, Math.floor(Number(candidate.ordinal) || 0));
        const line = Math.max(0, Math.floor(Number(candidate.line) || 0));
        const drawer = String(candidate.drawer || "");
        const childCount = Math.max(
          0,
          Math.floor(Number(candidate.child_lines) || 0),
        );
        return Object.freeze({
          key: String(line),
          ordinal,
          line,
          label: String(candidate.title || ""),
          detail: [
            drawer && !drawerTitle ? drawer : "",
            childCount > 0 ? `+${childCount}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          drawer,
          child_lines: childCount,
          selectable: ordinal > 0,
        });
      }),
  );
}

function taskSplitPickerPicks(rows, markedKeys, activeRow) {
  const allRows = Array.isArray(rows) ? rows : [];
  const marked = markedKeys instanceof Set ? markedKeys : new Set();
  const selected = allRows.filter(
    (row) => row && row.selectable && marked.has(row.key),
  );
  if (selected.length > 0) {
    return selected.map((row) => row.ordinal);
  }
  return activeRow && activeRow.selectable ? [activeRow.ordinal] : [];
}

class TaskSplitPickerModal extends FilteredPickerModal {
  constructor(app, options = {}) {
    const rows = Array.isArray(options.rows) ? options.rows : [];
    super(app, {
      items: rows,
      title: options.title || "Split notes into tasks",
      headerIcon: "split",
      inputLabel: "Filter notes to split",
      placeholder: "Filter notes",
      resultsLabel: "Notes to split into tasks",
      emptyText: "No splittable notes",
      footerHints: TASK_SPLIT_PICKER_HINTS.slice(),
      getSubtitle: () => options.subtitle || "",
      filterItem: (row, query) =>
        !query ||
        `${row && row.label || ""} ${row && row.detail || ""}`
          .toLowerCase()
          .includes(query),
      renderItem: (row, rowEl, query) => {
        const classes = ["bob-cnp-row", "bob-cnp-task-split-row"];
        if (row && row.key && this.markedKeys && this.markedKeys.has(row.key)) {
          classes.push("is-marked");
        }
        if (rowEl && rowEl.classList && typeof rowEl.classList.add === "function") {
          rowEl.classList.add(...classes);
        } else if (rowEl && typeof rowEl.addClass === "function") {
          classes.forEach((cls) => rowEl.addClass(cls));
        }
        const iconEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(iconEl, "split");
        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(
          titleEl,
          `${row && row.label || ""}${row && row.detail ? ` · ${row.detail}` : ""}`,
          query,
        );
        const markEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
        markEl.createDiv({
          cls: "bob-cnp-row-status",
          text: row && row.key && this.markedKeys && this.markedKeys.has(row.key)
            ? "☑"
            : "□",
          attr: { "aria-hidden": "true" },
        });
      },
    });
    this.markedKeys = new Set();
    this.splitResult = null;
    this.splitSettled = false;
    this.onSplitSettle =
      typeof options.onSettle === "function" ? options.onSettle : () => {};
  }

  toggleMark(key) {
    if (!key) {
      return;
    }
    if (this.markedKeys.has(key)) {
      this.markedKeys.delete(key);
    } else {
      this.markedKeys.add(key);
    }
    this.renderAll();
  }

  settle(result) {
    if (this.splitSettled) {
      return;
    }
    this.splitSettled = true;
    this.splitResult = result;
  }

  onClose() {
    try {
      super.onClose();
    } finally {
      this.onSplitSettle(this.splitResult);
    }
  }

  handleKeydown(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const active = this.visibleItems && this.visibleItems[this.selectedIndex];
      if (active && active.selectable) {
        this.toggleMark(active.key);
      }
      this.moveSelection(1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const active = this.visibleItems && this.visibleItems[this.selectedIndex];
      const picks = taskSplitPickerPicks(this.items, this.markedKeys, active);
      if (picks.length === 0) {
        return;
      }
      this.settle({ kind: "nth", picks });
      this.close();
      return;
    }
    super.handleKeydown(event);
  }
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
    let selection = described.selection;
    if (described.picker) {
      const listed = listTaskSplitCandidates(
        { [sourceFile.path]: sourceContent },
        {
          ownerPath: sourceFile.path,
          ownerLine: described.ownerLine + 1,
        },
      );
      if (!listed.ok) {
        new Notice(listed.message);
        return false;
      }
      const drawerTitle =
        described.picker.scope === "drawer" ? described.picker.title : "";
      const rows = buildTaskSplitPickerRows(listed.candidates, { drawerTitle });
      if (rows.length === 0) {
        new Notice(
          drawerTitle
            ? `${drawerTitle} has no splittable notes`
            : "This task has no splittable notes",
        );
        return true;
      }
      selection = await new Promise((settle) => {
        const modal = new TaskSplitPickerModal(this.app, {
          title: drawerTitle
            ? `Split ${drawerTitle} into tasks`
            : "Split notes into tasks",
          subtitle: drawerTitle ? `Drawer · ${drawerTitle}` : "",
          rows,
          onSettle: settle,
        });
        try {
          modal.open();
        } catch (_error) {
          settle(null);
        }
      });
      if (!selection) {
        return true;
      }
      if (String(editor.getValue() || "") !== sourceContent) {
        new Notice("Task changed while the picker was open; nothing was split");
        return false;
      }
    }
    const settings = {
      linked_from_mentions: loadRelationsLinkedFromMentionsEnabled(),
      linked_from_lines: loadRelationsLinkedFromLinesEnabled(),
      inbox_route: INBOX_NOTE_PATH,
    };
    const today = formatProjectTaskCreatedDate(new Date());
    const files = { [sourceFile.path]: sourceContent };
    let placement;
    try {
      const ownerForPlacement = {
        kind: described.ownerKind,
        line: described.ownerLine,
        end: described.ownerLine,
        title: "",
        blockId: null,
      };
      placement = taskSplitChoosePlacement(
        sourceFile.path,
        taskSplitLines(sourceContent),
        ownerForPlacement,
        INBOX_NOTE_PATH,
      );
      if (placement.path !== sourceFile.path) {
        const destinationFile = this.app.vault.getAbstractFileByPath(
          placement.path,
        );
        if (destinationFile && !this.isMarkdownFile(destinationFile)) {
          new Notice(`Split destination is not a Markdown note: ${placement.path}`);
          return false;
        }
        if (destinationFile && this.isMarkdownFile(destinationFile)) {
          files[placement.path] = String(
            (await this.app.vault.cachedRead(destinationFile)) || "",
          );
        }
      }
    } catch (_error) {
      new Notice("Could not read the split destination; nothing was changed");
      return false;
    }
    const plan = planSplitBullets(files, {
      ownerPath: sourceFile.path,
      ownerLine: described.ownerLine + 1,
      selection,
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
      sourceFile,
      sourceContent,
      cursor,
      plan,
      files,
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

  async applyTaskSplitCrossNote(
    editor,
    sourceFile,
    sourceContent,
    cursor,
    plan,
    plannedFiles,
  ) {
    const destinationPath = plan.cursor.path;
    const destinationAfter = plan.files[destinationPath];
    const sourceAfter = plan.files[sourceFile.path];
    if (typeof destinationAfter !== "string" || typeof sourceAfter !== "string") {
      new Notice("Split planned no change");
      return false;
    }
    const sourcePreimages = plannedFiles || {};
    const hadDestinationPreimage = Object.prototype.hasOwnProperty.call(
      sourcePreimages,
      destinationPath,
    );
    const destinationBefore = hadDestinationPreimage
      ? String(sourcePreimages[destinationPath])
      : "";
    const session = { sourcePath: sourceFile.path, editor };
    const written = [];
    try {
      const destinationFile = this.app.vault.getAbstractFileByPath(
        destinationPath,
      );
      if (destinationFile && this.isMarkdownFile(destinationFile)) {
        if (!hadDestinationPreimage) {
          new Notice("Split destination changed; nothing was written");
          return false;
        }
        written.push(
          await this.writeTaskMoveChange(
            destinationPath,
            { before: destinationBefore, after: destinationAfter },
            destinationFile,
            session,
          ),
        );
      } else if (!destinationFile) {
        if (hadDestinationPreimage) {
          new Notice("Split destination changed; nothing was written");
          return false;
        }
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
      const partial = error && error.taskMoveAppliedEntry;
      if (
        partial &&
        partial.path &&
        !written.some((entry) => entry.path === partial.path)
      ) {
        written.push(partial);
      }
      const failedPaths = await this.rollbackTaskMoveChanges(
        written.filter((entry) => !entry.created),
      );
      for (const entry of written.filter((entry) => entry.created)) {
        if (failedPaths.length > 0) {
          // Keep the destination copy if any source postimage could not be
          // restored. A duplicate is recoverable; deleting it could lose work.
          failedPaths.push(entry.path);
          continue;
        }
        try {
          const current = String(
            (await this.app.vault.cachedRead(entry.file)) || "",
          );
          if (current !== entry.change.after) {
            failedPaths.push(entry.path);
            continue;
          }
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
    this.showGuardedUndoNotice(
      formatTaskSplitGestureNotice(plan),
      written.map((entry) => ({
        path: entry.path,
        file: entry.file || null,
        before: entry.change.before,
        after: entry.change.after,
        created: entry.created === true,
      })),
      {
        actionLabel: "Undo split",
        successMessage: "Undid split",
        failureLabel: "Could not undo split",
      },
    );
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
        {
          path: destinationPath,
          line: Math.max(0, (plan.cursor.line || 1) - 1),
          ch: 0,
        },
      );
    } catch (_error) {
      // Cross-note navigation still succeeds if jump history is unavailable.
    }
    let opened = false;
    try {
      const destinationFile = this.app.vault.getAbstractFileByPath(
        destinationPath,
      );
      if (
        destinationFile &&
        typeof this.openMarkdownFileWithLeafReuse === "function"
      ) {
        opened = await this.openMarkdownFileWithLeafReuse(destinationFile, null);
      }
    } catch (_error) {
      opened = false;
    }
    if (opened) {
      try {
        const destinationView = this.getActiveMarkdownView();
        const destinationEditor =
          destinationView &&
          destinationView.file &&
          destinationView.file.path === destinationPath
            ? destinationView.editor
            : null;
        if (destinationEditor && typeof destinationEditor.setCursor === "function") {
          destinationEditor.setCursor(
            Math.max(0, (plan.cursor.line || 1) - 1),
            0,
          );
        }
      } catch (_error) {
        // The task landed; placing the cursor is a nicety after opening.
      }
    } else {
      new Notice(`Split completed in ${destinationPath}`);
    }
    return true;
  }
}
