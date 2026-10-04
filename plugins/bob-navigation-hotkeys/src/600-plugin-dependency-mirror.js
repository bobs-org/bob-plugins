class BobNavigationHotkeysDependencyMirrorMixin {

  setLocalTaskDependency(cm, cursor, name, id, options = {}) {
    const parentValidation = validateDependencyParentForEditor(
      cm,
      cursor,
      options.expectedParentLine === undefined
        ? null
        : options.expectedParentLine,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    if (normalizeBulletPropertyName(name) === "dependsOn") {
      return this.setLocalTaskDependencyLink(cm, cursor, id, options);
    }
    const lineText = parentValidation.line;

    const result = upsertLocalTaskIdValue(lineText, name, id);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (result.reason === "empty-id") {
      new Notice("Task has no dependency ID");
      return false;
    }

    // Freshness is the last transformation of the parent task line (nav-stamps).
    let depParentLine = result.line;
    if (result.changed) {
      const depStamper = this.getFreshnessStampLine();
      if (typeof depStamper === "function") {
        depParentLine = applyFreshStampLine(depParentLine, depStamper, this.getFreshnessDateText());
      }
    }

    if (
      result.changed &&
      !replaceEditorLine(cm, cursor.line, lineText, depParentLine)
    ) {
      new Notice("Could not update bullet property");
      return false;
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), depParentLine.length),
    );

    if (options.showNotice !== false) {
      new Notice(
        buildLocalTaskDependencyNotice({
          name,
          id,
          dependencyAlreadyPresent: result.alreadyPresent,
          navigationResult: null,
          navigationConsolidated: false,
        }),
      );
    }
    return true;
  }

  // Single-select Depends-On write through the pure planner: one gesture
  // writes the line, the field, same-note target ids, status effects, and
  // legacy folding in one editor transaction (one Ctrl+Z), with `[fresh::
  // today]` stamped last. `options.linkBlockId` is the target's `^block-id`
  // in this note; `options.filePath` overrides the active file.
  // `options.pendingTargetLine` (`{line, expected, text}`) folds a same-note
  // target `^id` / `[id::]` write into that one transaction instead of a
  // separate edit.
  setLocalTaskDependencyLink(cm, cursor, id, options = {}) {
    const originalContent =
      cm && typeof cm.getValue === "function"
        ? String(cm.getValue() || "")
        : null;
    if (originalContent === null) {
      new Notice("No active markdown editor");
      return false;
    }
    let content = originalContent;
    const pendingTarget = options.pendingTargetLine || null;
    if (pendingTarget) {
      const pendingLines = content.split(/\r?\n/);
      if (
        !Number.isInteger(pendingTarget.line) ||
        pendingLines[pendingTarget.line] !== pendingTarget.expected
      ) {
        new Notice("Task changed; dependency not added");
        return false;
      }
      pendingLines[pendingTarget.line] = pendingTarget.text;
      content = pendingLines.join(content.includes("\r\n") ? "\r\n" : "\n");
    }
    const depValue = normalizeBulletPropertyValue(id);
    if (!depValue) {
      new Notice("Task has no dependency ID");
      return false;
    }
    const linkBlockId = normalizeBulletPropertyValue(options.linkBlockId);
    if (!linkBlockId) {
      new Notice("Task has no dependency link target");
      return false;
    }
    const activeFile =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null;
    const filePath = normalizeVaultRelativePath(
      options.filePath || (activeFile && activeFile.path) || "",
    );
    if (!filePath) {
      new Notice("Could not identify the current note");
      return false;
    }
    const plan = planDependencyEdit({
      content,
      parentLine: cursor.line,
      parentPath: filePath,
      add: [{ path: filePath, blockId: linkBlockId }],
      remove: [],
      files: { [filePath]: content },
      vaultFiles: this.readDependencyVaultFileList(),
      resolveLinkpath: this.dependencyLinkpathResolver(),
    });
    if (!plan.ok) {
      new Notice(dependencyPlanFailureNotice(plan.reason, "add"));
      return false;
    }
    let nextContent = plan.nextContent;
    if (plan.changed) {
      nextContent = this.stampDependencyParentLine(
        nextContent,
        cursor.line,
        undefined,
        undefined,
      );
    }
    if (nextContent !== originalContent) {
      if (!applyEditorContentTransaction(cm, originalContent, nextContent)) {
        new Notice("Could not update bullet property");
        return false;
      }
    }
    const nextLines = nextContent.split(/\r?\n/);
    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(
        Math.max(cursor.ch, 0),
        String(nextLines[cursor.line] || "").length,
      ),
    );
    if (options.showNotice !== false) {
      new Notice(plan.notice);
    }
    return true;
  }

  // Ctrl+D on the Depends on row (`docs/task-dependencies.md` §7): delete the
  // task's Depends-On line, its `[dependsOn::]` field, and any legacy children
  // in one writer transaction, with ADJ-8 recovery. Clearing removes every
  // current target, so the line empties even when a link no longer resolves.
  async deleteDependencyLineAndField(cm, cursor, options = {}, validatedContext = null) {
    const writeContext =
      validatedContext && validatedContext.valid
        ? validatedContext
        : this.getInlinePropertyWriteContext(cm, cursor, options);
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    const content = writeContext.content;
    const lines = content.split(/\r?\n/);
    const owning = findOwningTaskLine(lines, cursor.line);
    if (owning === null) {
      new Notice("Cursor is not on a task");
      return null;
    }
    if (isBlockquotedMarkdownLine(lines[owning])) {
      new Notice("⛓ Dependencies can't be edited inside a blockquote");
      return null;
    }
    const activeFile =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null;
    const parentPath = normalizeVaultRelativePath(
      options.filePath ||
        writeContext.filePath ||
        (activeFile && activeFile.path) ||
        "",
    );
    if (!parentPath) {
      new Notice("Could not identify the current note");
      return null;
    }
    const collection = collectDependencyNavigationBullets(content, owning);
    if (collection.reason) {
      new Notice("Could not delete task dependencies");
      return null;
    }
    const field = findBulletPropertyField(lines[owning], "dependsOn");
    const resolveLinkpath = this.dependencyLinkpathResolver();
    const remove = collection.targets.map((target) => ({
      path: dependencyPathForLinkNote(target.note, parentPath, resolveLinkpath),
      blockId: target.blockId,
    }));
    if (remove.length === 0 && !field) {
      new Notice("dependsOn is not set on this bullet");
      setEditorCursorSafely(
        cm,
        cursor.line,
        Math.min(
          Math.max(cursor.ch, 0),
          String(lines[cursor.line] || "").length,
        ),
      );
      return { deleted: false, line: lines[cursor.line] };
    }
    const outcome = await this.applyDependencyEdit({
      editor: cm,
      parentPath,
      parentLine: owning,
      add: [],
      remove,
    });
    if (!outcome.ok) {
      new Notice(
        outcome.reason === "in-blockquote"
          ? "⛓ Dependencies can't be edited inside a blockquote"
          : `⛓ Could not clear dependencies (${outcome.reason})`,
      );
      return null;
    }
    const nextLines = String(cm.getValue() || "").split(/\r?\n/);
    const anchor = Math.max(0, Math.min(owning, nextLines.length - 1));
    setEditorCursorSafely(
      cm,
      anchor,
      Math.min(
        Math.max(cursor.ch, 0),
        String(nextLines[anchor] || "").length,
      ),
    );
    if (outcome.notice) {
      new Notice(
        outcome.reason === "unchanged"
          ? "dependsOn is not set on this bullet"
          : outcome.notice,
      );
    }
    return {
      deleted: outcome.reason !== "unchanged",
      line: nextLines[anchor],
    };
  }

  // Ctrl+D on the Depends on row in a counted (`N<Ctrl+Shift+P>`) session:
  // clear every targeted task bottom-up so earlier line numbers stay valid,
  // planned against one working copy and committed in one editor transaction
  // (one Ctrl+Z) with one summary notice.
  async deleteCountedDependencyLinesAndFields(cm, cursor, filePath, session) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    const parentPath = normalizeVaultRelativePath(filePath);
    const originalContent = writeContext.content;
    const ordered = (session.targets || []).slice().sort((a, b) => b.line - a.line);
    const resolveLinkpath = this.dependencyLinkpathResolver();
    const vaultFiles = this.readDependencyVaultFileList();
    const registry = await readTasksStatusRegistry(this.app);
    const deleteNeedsSnapshot = String(originalContent || "")
      .split(/\r?\n/)
      .some((line, index) => {
        if (!(session.targets || []).some((target) => target.line === index)) {
          return false;
        }
        return getObsidianTaskCheckboxStatus(String(line || "")) === "?";
      });
    const baseVaultContents = deleteNeedsSnapshot
      ? await this.readDependencyRecoveryVaultContents(
          parentPath,
          originalContent,
        )
      : null;
    const today = new Date();
    let working = originalContent;
    let cleared = 0;
    let unchanged = 0;
    const preparations = [];
    for (const target of ordered) {
      if (!Number.isInteger(target.line)) {
        continue;
      }
      const workingLines = working.split(/\r?\n/);
      if (target.line < 0 || target.line >= workingLines.length) {
        continue;
      }
      const owning = findOwningTaskLine(workingLines, target.line);
      if (owning === null) {
        continue;
      }
      if (isBlockquotedMarkdownLine(workingLines[owning])) {
        new Notice("⛓ Dependencies can't be edited inside a blockquote; no tasks were updated");
        return null;
      }
      const collection = collectDependencyNavigationBullets(working, owning);
      if (collection.reason) {
        new Notice("Could not delete task dependencies; no tasks were updated");
        return null;
      }
      const field = findBulletPropertyField(workingLines[owning], "dependsOn");
      const remove = collection.targets.map((entry) => ({
        path: dependencyPathForLinkNote(entry.note, parentPath, resolveLinkpath),
        blockId: entry.blockId,
      }));
      if (remove.length === 0 && !field) {
        unchanged += 1;
        continue;
      }
      const files = new Map();
      files.set(parentPath, working);
      const plan = planDependencyEdit({
        content: working,
        parentLine: owning,
        parentPath,
        add: [],
        remove,
        files,
        vaultFiles,
        resolveLinkpath,
        recovery: { registry, today, vaultContents: baseVaultContents },
      });
      if (!plan.ok) {
        new Notice(
          plan.reason === "in-blockquote"
            ? "⛓ Dependencies can't be edited inside a blockquote; no tasks were updated"
            : "Could not delete task dependencies; no tasks were updated",
        );
        return null;
      }
      for (const preparation of plan.preparations || []) {
        preparations.push(preparation);
      }
      if (!plan.changed) {
        unchanged += 1;
        continue;
      }
      // Freshness stays the last transformation of the rewritten task line
      // (nav-stamps), as in the single Ctrl+D commit.
      working = this.stampDependencyParentLine(plan.nextContent, owning);
      cleared += 1;
    }
    for (const preparation of preparations) {
      let result = null;
      try {
        result = await this.prepareDependencyTargetNote(
          preparation.path,
          preparation,
        );
      } catch (_error) {
        result = { ok: false, reason: "target-preparation-threw" };
      }
      if (!result || result.ok !== true) {
        new Notice("Could not delete task dependencies; no tasks were updated");
        return null;
      }
    }
    if (working === originalContent) {
      return { deleted: cleared > 0, cleared, unchanged };
    }
    if (String(cm.getValue() || "") !== originalContent) {
      new Notice("Active note changed; no tasks were updated");
      return null;
    }
    const finalLines = working.split(/\r?\n/);
    const anchor = Math.max(0, Math.min(cursor.line, finalLines.length - 1));
    if (
      !applyEditorContentTransaction(cm, originalContent, working, {
        line: anchor,
        ch: Math.min(
          Math.max(cursor.ch, 0),
          String(finalLines[anchor] || "").length,
        ),
      })
    ) {
      new Notice("Could not delete task dependencies; no tasks were updated");
      return null;
    }
    new Notice(
      `⛓ Cleared dependencies from ${cleared} ${cleared === 1 ? "task" : "tasks"}` +
        (unchanged > 0 ? ` (${unchanged} unchanged)` : ""),
    );
    return { deleted: cleared > 0, cleared, unchanged };
  }


  // Hand-edit mirror (`docs/task-dependencies.md` §7). The scheduler calls
  // this once the cursor has left the edited line: R1 projects the line into
  // the field (and canonicalises it) through the writer, R9 drops a linkless
  // line and the field, and a deleted line clears the field. Malformed lines
  // are left alone. `options.registry` overrides the Tasks registry (tests).
  async mirrorDependencyHandEdit(editor, parentPath, oldContent, editedLine, removedText, options = {}) {
    const content =
      editor && typeof editor.getValue === "function"
        ? String(editor.getValue() || "")
        : null;
    if (content === null) {
      return Object.freeze({ mirrored: false });
    }
    const opts = options && typeof options === "object" ? options : {};
    const plan = planDependencyHandEditMirror(
      oldContent === undefined ? content : oldContent,
      content,
      editedLine,
      removedText,
      Number.isInteger(opts.baselineLine) ? opts.baselineLine : editedLine,
    );
    if (!plan) {
      return Object.freeze({ mirrored: false });
    }
    if (plan.kind === "touch") {
      // A touch projects the hand-edited line into the field with the same
      // status effects as the stage (block on a hand-added open
      // prerequisite, recover when none remains), except commitment
      // transfer, and never stamps freshness or writes cross-note `[id::]`.
      const outcome = await this.applyDependencyEdit({
        editor,
        parentPath,
        parentLine: plan.owning,
        add: [],
        remove: [],
        mirrorTouch: true,
      });
      if (!outcome.ok) {
        return Object.freeze({ mirrored: false, reason: outcome.reason });
      }
      return Object.freeze({ mirrored: outcome.reason !== "unchanged" });
    }
    return this.applyDependencyHandEditClear(editor, parentPath, plan, options);
  }

  // R9 half of the hand-edit mirror: drop the linkless line(s) and the field,
  // then recover immediately (ADJ-8) when no open prerequisite remains.
  async applyDependencyHandEditClear(editor, parentPath, plan, options = {}) {
    const content = String(editor.getValue() || "");
    const { lines, lineEnding } = splitMarkdownContent(content);
    const owning = plan.owning;
    if (!Number.isInteger(owning) || owning < 0 || owning >= lines.length) {
      return Object.freeze({ mirrored: false });
    }
    if (isBlockquotedMarkdownLine(lines[owning])) {
      return Object.freeze({ mirrored: false });
    }
    const next = lines.slice();
    if (plan.kind === "clear-empty" && Array.isArray(plan.emptyLines)) {
      const dels = plan.emptyLines
        .filter((line) => line !== owning)
        .sort((a, b) => b - a);
      for (const line of dels) {
        if (line >= 0 && line < next.length) {
          next.splice(line, 1);
        }
      }
    }
    let parentText = deleteBulletProperty(String(next[owning] || ""), "dependsOn").line;
    const registry =
      options.registry || (await readTasksStatusRegistry(this.app));
    const preview = next.slice();
    preview[owning] = parentText;
    const previewContent = preview.join(lineEnding);
    const recoveryToday = options.today || new Date();
    // The snapshot costs a whole-vault read, so build it only for a `[?]`
    // dependent: recovery can never fire otherwise (same gate as
    // `needsDependencyRecoverySnapshot`; adds never reach this clear path).
    const clearNeedsSnapshot =
      getObsidianTaskCheckboxStatus(String(lines[owning] || "")) === "?";
    let recoverySnapshot = options.vaultContents !== undefined ? options.vaultContents : null;
    if (options.vaultContents === undefined && clearNeedsSnapshot && typeof this.readDependencyRecoveryVaultContents === "function") {
      try {
        recoverySnapshot = await this.readDependencyRecoveryVaultContents(parentPath, previewContent);
      } catch (_snapshotError) {
        recoverySnapshot = null;
      }
    }
    const recoveryNotes = [];
    if (recoverySnapshot instanceof Map) {
      for (const [filePath, fileContent] of recoverySnapshot) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (!normalized) {
          continue;
        }
        recoveryNotes.push({
          path: normalized,
          content: normalized === normalizeVaultRelativePath(parentPath) ? previewContent : String(fileContent || ""),
        });
      }
    } else if (recoverySnapshot && typeof recoverySnapshot === "object") {
      for (const filePath of Object.keys(recoverySnapshot)) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (!normalized) {
          continue;
        }
        recoveryNotes.push({
          path: normalized,
          content: normalized === normalizeVaultRelativePath(parentPath) ? previewContent : String(recoverySnapshot[filePath] || ""),
        });
      }
    }
    if (!recoveryNotes.some((note) => normalizeVaultRelativePath(note.path) === normalizeVaultRelativePath(parentPath))) {
      recoveryNotes.push({ path: parentPath, content: previewContent });
    }
    const recoveryIndex = buildScheduledRecoveryIndex(
      recoveryNotes,
      registry,
      recoveryToday,
    );
    const metadata = getScheduledRecoveryMetadata(
      recoveryIndex,
      parentPath,
      owning,
    );
    const reconciled = reconcileBlockedScheduledTaskLine(parentText, metadata);
    parentText = reconciled.line;
    // The hand-edit mirror never stamps freshness.
    next[owning] = parentText;
    const nextContent = next.join(lineEnding);
    if (nextContent === content) {
      return Object.freeze({ mirrored: false });
    }
    const cursor = getEditorCursor(editor);
    if (
      !applyEditorContentTransaction(editor, content, nextContent, {
        line: cursor ? cursor.line : owning,
        ch: cursor ? cursor.ch : 0,
      })
    ) {
      new Notice("Could not mirror dependency edit");
      return Object.freeze({ mirrored: false });
    }
    return Object.freeze({ mirrored: true });
  }

  // CM6 update-listener entry for the hand-edit mirror: reads the real
  // changed ranges from the update (never `editor-change`, which carries no
  // change object). Skips IME composition and open modals.
  scheduleDependencyHandEditMirrorFromUpdate(update) {
    if (!update || !update.docChanged) {
      return;
    }
    const view = update.view || null;
    if (view && view.composing) {
      return;
    }
    if (typeof document !== "undefined" && document) {
      try {
        if (
          typeof document.querySelector === "function" &&
          document.querySelector(".modal-container")
        ) {
          return;
        }
      } catch (_error) {
        // A DOM lookup must never break the scheduler.
      }
    }
    const activeView =
      typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : null;
    if (!activeView || !activeView.file || !activeView.editor) {
      return;
    }
    if (
      view &&
      activeView.editor.cm &&
      activeView.editor.cm !== view
    ) {
      return;
    }
    const editor = activeView.editor;
    if (typeof editor.getValue !== "function") {
      return;
    }
    const parentPath = normalizeVaultRelativePath(activeView.file.path);
    const newContent = String(editor.getValue() || "");
    let editedLine = null;
    let baselineEditedLine = null;
    try {
      if (update.changes && typeof update.changes.iterChangedRanges === "function") {
        update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
          try {
            const doc = update.state && update.state.doc;
            const line =
              doc && typeof doc.lineAt === "function"
                ? doc.lineAt(Math.max(0, fromB)).number - 1
                : null;
            if (Number.isInteger(line) && (editedLine === null || line < editedLine)) {
              editedLine = line;
            }
          } catch (_rangeError) {
            // One unreadable range must not drop the others.
          }
          try {
            // Baseline coordinates come from the first update's pre-change
            // document: the owner is identified there, never by indexing
            // the baseline with a current-document line.
            const startDoc = update.startState && update.startState.doc;
            const baselineLine =
              startDoc && typeof startDoc.lineAt === "function"
                ? startDoc.lineAt(Math.max(0, fromA)).number - 1
                : null;
            if (
              Number.isInteger(baselineLine) &&
              (baselineEditedLine === null || baselineLine < baselineEditedLine)
            ) {
              baselineEditedLine = baselineLine;
            }
          } catch (_baselineRangeError) {
            // One unreadable range must not drop the others.
          }
        });
      }
    } catch (_error) {
      // An unreadable changeset falls back to the cursor line below.
    }
    if (editedLine === null) {
      const cursor = getEditorCursor(editor);
      editedLine = cursor ? cursor.line : 0;
    }
    // The burst baseline is the update's pre-change document: the first
    // update after a note opens (or after the last mirror ran) seeds the
    // mirror even though nothing cached the opened content. Later updates
    // in the same burst keep that baseline and only move the owner.
    let baseline = null;
    try {
      const startDoc = update.startState && update.startState.doc;
      if (startDoc && typeof startDoc.toString === "function") {
        baseline = String(startDoc.toString());
      }
    } catch (_baselineError) {
      // An unreadable pre-change document falls back to the cache below.
    }
    this.enqueueDependencyHandEditMirror(editor, parentPath, newContent, editedLine, {
      baseline,
      baselineEditedLine,
      changes:
        update.changes && typeof update.changes.mapPos === "function"
          ? update.changes
          : null,
    });
  }

  // Queue one trailing mirror pass per note. The pre-change content from the
  // first update's start state is the baseline for the whole burst: later
  // updates refresh the removed-text against the latest content but never
  // reset the baseline, so a first-edit deletion (including vim `dd`, which
  // shifts every line below it) is never mistaken for a sibling touch. The
  // owner is a baseline-anchored offset mapped forward through each update's
  // `ChangeSet.mapPos` (never the latest edited line); the baseline line
  // identifies the owner in the old content and the mapped line locates that
  // same task in the current document.
  enqueueDependencyHandEditMirror(editor, parentPath, newContent, editedLine, options = {}) {
    if (!this.dependencyMirrorByPath) {
      this.dependencyMirrorByPath = new Map();
    }
    const previous = this.dependencyMirrorByPath.get(parentPath);
    this.dependencyMirrorByPath.set(parentPath, newContent);
    if (previous === newContent) {
      return;
    }
    const opts = options && typeof options === "object" ? options : {};
    const pending =
      this.pendingDependencyMirrorSnapshot &&
      this.pendingDependencyMirrorSnapshot.parentPath === parentPath
        ? this.pendingDependencyMirrorSnapshot
        : null;
    let oldContent;
    let baselineEditedLine = null;
    let ownerLine = editedLine;
    let ownerPos = dependencyMirrorOffsetOfLine(newContent, editedLine);
    if (pending) {
      oldContent = pending.oldContent;
      baselineEditedLine = pending.baselineEditedLine;
      // Map the first-change owner through this update instead of adopting
      // the latest edited line. Without a `mapPos` changeset the first
      // owner simply stays.
      if (
        opts.changes &&
        Number.isInteger(pending.ownerPos) &&
        pending.ownerPos >= 0
      ) {
        let mapped = null;
        try {
          mapped = opts.changes.mapPos(pending.ownerPos);
        } catch (_mapError) {
          mapped = null;
        }
        if (Number.isInteger(mapped) && mapped >= 0) {
          ownerPos = mapped;
          const lineOf = dependencyMirrorLineOfOffset(newContent, mapped);
          if (lineOf !== null) {
            ownerLine = lineOf;
          } else if (Number.isInteger(pending.ownerLine)) {
            ownerLine = pending.ownerLine;
          } else {
            ownerLine = pending.editedLine;
          }
        } else if (Number.isInteger(pending.ownerLine)) {
          ownerLine = pending.ownerLine;
        } else {
          ownerLine = pending.editedLine;
        }
      } else {
        ownerLine = pending.editedLine;
      }
      if (!Number.isInteger(ownerPos) || ownerPos < 0) {
        ownerPos = dependencyMirrorOffsetOfLine(newContent, ownerLine);
      }
    } else if (typeof opts.baseline === "string") {
      oldContent = opts.baseline;
      baselineEditedLine = Number.isInteger(opts.baselineEditedLine)
        ? opts.baselineEditedLine
        : editedLine;
      // Anchor the owning task (not the edited line) in the baseline, then
      // map it through this update's own changeset into the current
      // document: later updates keep mapping it forward, so an insertion
      // above the owner can never re-aim the old-content lookup at the
      // next sibling. Deleting a Depends-On line anchors its parent task,
      // whose offset survives the deletion below/above it via `mapPos`.
      const baselineLines = String(oldContent).split(/\r?\n/);
      const baselineOwning =
        findOwningTaskLine(
          baselineLines,
          Math.max(0, Math.min(baselineEditedLine, baselineLines.length - 1)),
        ) ?? baselineEditedLine;
      let baselinePos = dependencyMirrorOffsetOfLine(oldContent, baselineOwning);
      if (opts.changes && Number.isInteger(baselinePos) && baselinePos >= 0) {
        try {
          const mappedFirst = opts.changes.mapPos(baselinePos);
          if (Number.isInteger(mappedFirst) && mappedFirst >= 0) {
            baselinePos = mappedFirst;
          }
        } catch (_firstMapError) {
          // An unreadable changeset keeps the baseline anchor.
        }
      }
      if (Number.isInteger(baselinePos) && baselinePos >= 0) {
        ownerPos = baselinePos;
        const lineOf = dependencyMirrorLineOfOffset(newContent, baselinePos);
        if (lineOf !== null) {
          ownerLine = lineOf;
        }
      }
    } else {
      oldContent = previous;
      baselineEditedLine = Number.isInteger(opts.baselineEditedLine)
        ? opts.baselineEditedLine
        : editedLine;
    }
    const removedText =
      oldContent === undefined ? "" : findRemovedLineText(oldContent, newContent);
    this.pendingDependencyMirrorSnapshot = {
      editor,
      parentPath,
      oldContent,
      // The latest edited line (current-document) re-arms the pass while
      // the cursor stays on it; the mapped owner line below is what the
      // plan runs on.
      editedLine,
      ownerLine,
      baselineEditedLine,
      ownerPos,
      removedText,
    };
    if (this.pendingDependencyMirror) {
      clearTimeout(this.pendingDependencyMirror);
      this.pendingDependencyMirror = null;
    }
    const snapshot = this.pendingDependencyMirrorSnapshot;
    this.pendingDependencyMirror = setTimeout(() => {
      this.pendingDependencyMirror = null;
      this.fireDependencyHandEditMirror(snapshot);
    }, DEPENDENCY_MIRROR_DEBOUNCE_MS);
  }

  async fireDependencyHandEditMirror(snapshot) {
    try {
      const cursor = snapshot.editor ? getEditorCursor(snapshot.editor) : null;
      if (cursor && cursor.line === snapshot.editedLine) {
        // Still on the edited line: re-arm until the cursor leaves, keeping
        // the first-change baseline and refreshing the removed text against
        // the latest content.
        if (typeof snapshot.editor.getValue === "function") {
          const latest = String(snapshot.editor.getValue() || "");
          if (!this.dependencyMirrorByPath) {
            this.dependencyMirrorByPath = new Map();
          }
          this.dependencyMirrorByPath.set(snapshot.parentPath, latest);
          snapshot.removedText =
            snapshot.oldContent === undefined
              ? ""
              : findRemovedLineText(snapshot.oldContent, latest);
        }
        this.pendingDependencyMirror = setTimeout(() => {
          this.pendingDependencyMirror = null;
          this.fireDependencyHandEditMirror(snapshot);
        }, DEPENDENCY_MIRROR_DEBOUNCE_MS);
        return;
      }
      await this.mirrorDependencyHandEdit(
        snapshot.editor,
        snapshot.parentPath,
        snapshot.oldContent,
        Number.isInteger(snapshot.ownerLine) ? snapshot.ownerLine : snapshot.editedLine,
        snapshot.removedText,
        { baselineLine: snapshot.baselineEditedLine },
      );
    } catch (_error) {
      // A timer must never throw: the next edit re-arms the mirror.
    } finally {
      if (this.pendingDependencyMirrorSnapshot === snapshot) {
        this.pendingDependencyMirrorSnapshot = null;
      }
      if (snapshot.editor && typeof snapshot.editor.getValue === "function") {
        if (!this.dependencyMirrorByPath) {
          this.dependencyMirrorByPath = new Map();
        }
        this.dependencyMirrorByPath.set(
          snapshot.parentPath,
          String(snapshot.editor.getValue() || ""),
        );
      }
    }
  }
}
