// Snooze definition jumps: exact row and section navigation ----------
// Split from `277a-plugin-snooze-marks.js` to keep each fragment at or
// below 1000 lines. `jumpToDailyNoteLine` is the shared row/section
// jump helper the later display phases reuse: woken pills jump to
// struck history rows and the plan chip jumps to the `## Snoozed`
// heading through this same path. Contract: bob-cli
// `docs/snooze-marks.md`.

class BobLedgerToolsSnoozeMarksJumpMixin {
  snoozeMarksTaskAtCursor(editor, markdownView) {
    try {
      if (
        !editor ||
        typeof editor.getCursor !== "function" ||
        typeof editor.getLine !== "function"
      ) {
        return null;
      }
      const cursor = editor.getCursor();
      if (!cursor || !Number.isInteger(cursor.line)) {
        return null;
      }
      const lineText = editor.getLine(cursor.line);
      if (typeof lineText !== "string" || lineText.indexOf("#task") === -1) {
        return null;
      }
      const ranges = taskTagMarkRanges(lineText);
      const blockId = todayMarkTrailingBlockId(lineText);
      if (!ranges.length || !blockId) {
        return null;
      }
      const cm = getEditorViewFromEditor(editor);
      if (!cm || !cm.state) {
        return null;
      }
      let tree = null;
      try {
        tree = typeof syntaxTree === "function" ? syntaxTree(cm.state) : null;
      } catch (error) {
        tree = null;
      }
      if (!tree || typeof tree.resolveInner !== "function") {
        return null;
      }
      const line = cm.state.doc.line(cursor.line + 1);
      if (
        freshnessMarkPosInCode(tree, line.from + ranges[0].from + 1)
      ) {
        return null;
      }
      let candidate = null;
      try {
        candidate = todayMarkLineCandidate(lineText);
      } catch (error) {
        candidate = null;
      }
      if (!candidate) {
        return { ambiguous: true };
      }
      const duplicates = todayMarkDuplicateIds(
        todayMarkAllDocLines(cm.state.doc),
        [blockId],
      );
      if (duplicates.indexOf(blockId) !== -1) {
        return { ambiguous: true };
      }
      const view =
        markdownView ||
        (typeof getActiveMarkdownView === "function"
          ? getActiveMarkdownView(this.app)
          : null);
      const filePath =
        view && view.file && typeof view.file.path === "string"
          ? view.file.path
          : "";
      if (!filePath) {
        return null;
      }
      if (PLAN_DAILY_PATH_RE.test(filePath)) {
        return { ambiguous: true };
      }
      const path = /\.md$/i.test(filePath) ? filePath : filePath + ".md";
      return { key: path + "#" + blockId };
    } catch (error) {
      return null;
    }
  }

  goToSnoozedRow(editor, markdownView) {
    try {
      if (typeof editor === "string") {
        void this.jumpSnoozedRow(editor);
        return true;
      }
      const task = this.snoozeMarksTaskAtCursor(editor, markdownView);
      if (!task) {
        new Notice("No task on this line");
        return false;
      }
      let clock = null;
      try {
        clock = this.snoozeMarksNow();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      if (
        task.ambiguous ||
        typeof this.isSnoozedCacheReady !== "function" ||
        !this.isSnoozedCacheReady(clock) ||
        !this.snoozeSnapshotForKey(task.key)
      ) {
        new Notice("Not snoozed for today");
        return false;
      }
      void this.jumpSnoozedRow(task.key);
      return true;
    } catch (error) {
      try {
        new Notice("No task on this line");
      } catch (inner) {
        // Keep command failures quiet on test hosts.
      }
      return false;
    }
  }

  snoozeMarksFindRowLine(content, blockId, hintLine) {
    try {
      if (typeof content !== "string" || typeof blockId !== "string") {
        return null;
      }
      const lines = content.split(/\r?\n/);
      const caret = "^" + blockId;
      if (Number.isInteger(hintLine) && hintLine >= 0 && hintLine < lines.length) {
        try {
          if (
            String(lines[hintLine]).indexOf(caret) !== -1 &&
            todayMarkTrailingBlockId(String(lines[hintLine])) !== null
          ) {
            return hintLine;
          }
        } catch (error) {
          // A stale hint rescans below.
        }
      }
      // Exact row mapping first: the shared Snoozed parser resolves
      // the active row for this identity, so a moved row is found at
      // its current line.
      try {
        if (snoozeModel && typeof snoozeModel.parseSection === "function") {
          const parsed = snoozeModel.parseSection(content);
          const rows = parsed && Array.isArray(parsed.rows)
            ? parsed.rows
            : [];
          for (const row of rows) {
            try {
              if (
                row &&
                row.kind === "active" &&
                row.blockId === blockId &&
                Number.isInteger(row.line)
              ) {
                return row.line - 1;
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        // Parser failures fall through to the caret scan.
      }
      for (let index = 0; index < lines.length; index += 1) {
        try {
          if (String(lines[index]).indexOf(caret) === -1) {
            continue;
          }
          if (todayMarkTrailingBlockId(String(lines[index])) === blockId) {
            return index;
          }
        } catch (error) {
          continue;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Shared daily-note jump used by the definition clock, and later by
  // woken pills and the plan chip: open (or reuse) the daily leaf,
  // move the cursor to an exact 0-based line, center, and focus.
  // `notices.vanished` names the teaching Notice when the line is
  // gone; the jump never lands on a stale unrelated line. Returns
  // true only when the cursor moved.
  async jumpToDailyNoteLine(dailyPath, lineNumber, ch, notices) {
    try {
      if (
        typeof dailyPath !== "string" ||
        !dailyPath ||
        !Number.isInteger(lineNumber) ||
        lineNumber < 0
      ) {
        return false;
      }
      const column = Number.isInteger(ch) && ch >= 0 ? ch : 0;
      let markdownView = null;
      const existing = findOpenMarkdownLeafByPath(this.app, dailyPath);
      if (existing) {
        markdownView = await activateMarkdownLeaf(this.app, existing, {
          path: dailyPath,
        });
      } else {
        const file = this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(dailyPath)
          : null;
        const workspace = this.app && this.app.workspace;
        if (file && workspace && typeof workspace.getLeaf === "function") {
          const leaf = workspace.getLeaf("tab");
          if (leaf && typeof leaf.openFile === "function") {
            await leaf.openFile(file);
            markdownView = leaf.view || null;
          }
        } else {
          let isToday = false;
          try { isToday = snoozedNoteDateFromDailyPath(dailyPath) === formatLocalDate(new Date()); }
          catch (error) { isToday = false; }
          if (isToday) {
            const opened = await openTodayDailyNoteWithState(this.app);
            markdownView = opened && opened.view ? opened.view : null;
          }
        }
      }
      if (!markdownView || !markdownView.editor) {
        new Notice("Could not open daily note");
        return false;
      }
      let content = null;
      try {
        if (typeof markdownView.editor.getValue === "function") {
          content = markdownView.editor.getValue();
        } else {
          const cm = getEditorViewFromEditor(markdownView.editor);
          if (cm && cm.state && cm.state.doc) {
            content = cm.state.doc.toString();
          }
        }
      } catch (error) {
        content = null;
      }
      if (typeof content !== "string") {
        new Notice(
          (notices && notices.vanished) ||
            "This task's Snoozed row is no longer in today's note",
        );
        return false;
      }
      let targetLine = lineNumber;
      if (notices && typeof notices.findLine === "function") {
        try { targetLine = notices.findLine(content, lineNumber); }
        catch (error) { targetLine = null; }
      }
      const lines = content.split(/\r?\n/);
      if (!Number.isInteger(targetLine) || targetLine < 0 || targetLine >= lines.length) {
        new Notice(
          (notices && notices.vanished) ||
            "This task's Snoozed row is no longer in today's note",
        );
        return false;
      }
      const cursor = { line: targetLine, ch: column };
      try {
        if (typeof markdownView.editor.setCursor === "function") {
          markdownView.editor.setCursor(cursor);
        } else {
          const cm = getEditorViewFromEditor(markdownView.editor);
          const line =
            cm && cm.state && cm.state.doc
              ? cm.state.doc.line(targetLine + 1)
              : null;
          if (line && cm && typeof cm.dispatch === "function") {
            cm.dispatch({
              selection: { anchor: line.from + column },
            });
          }
        }
      } catch (error) {
        // Cursor placement is best-effort.
      }
      let centered = false;
      try {
        centered = centerEditorViewOnPosition(
          getEditorViewFromEditor(markdownView.editor),
          targetLine,
          column,
        );
      } catch (error) {
        centered = false;
      }
      if (!centered) {
        try {
          scrollEditorIntoView(markdownView.editor, targetLine, column);
        } catch (error) {
          // Scrolling is best-effort.
        }
      }
      try {
        focusEditor(markdownView.editor);
      } catch (error) {
        // Focus is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async jumpSnoozedRow(key) {
    if (this.snoozeJumpInFlight) {
      return false;
    }
    this.snoozeJumpInFlight = true;
    try {
      let clock = null;
      try {
        clock = this.snoozeMarksNow();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      if (
        typeof key !== "string" ||
        !key ||
        typeof this.isSnoozedCacheReady !== "function" ||
        !this.isSnoozedCacheReady(clock)
      ) {
        return false;
      }
      const snapshot = this.snoozeSnapshotForKey(key);
      if (!snapshot) {
        new Notice("This task's Snoozed row is no longer in today's note");
        return false;
      }
      const dailyPath =
        this.snoozedCache &&
        typeof this.snoozedCache.dailyPath === "string"
          ? this.snoozedCache.dailyPath
          : "";
      if (!dailyPath) {
        return false;
      }
      const hash = key.lastIndexOf("#");
      const blockId = hash === -1 ? "" : key.slice(hash + 1);
      if (!blockId) {
        return false;
      }
      // Revalidate the target against the open note: the cached line
      // is only a hint, and a moved row is rescanned before jumping.
      let content = null;
      try {
        const existing = findOpenMarkdownLeafByPath(this.app, dailyPath);
        if (existing && existing.view && existing.view.editor) {
          if (typeof existing.view.editor.getValue === "function") {
            content = existing.view.editor.getValue();
          } else {
            const cm = getEditorViewFromEditor(existing.view.editor);
            if (cm && cm.state && cm.state.doc) {
              content = cm.state.doc.toString();
            }
          }
        } else if (
          this.app &&
          this.app.vault &&
          typeof this.app.vault.cachedRead === "function"
        ) {
          const file =
            typeof this.app.vault.getAbstractFileByPath === "function"
              ? this.app.vault.getAbstractFileByPath(dailyPath)
              : { path: dailyPath };
          content = await this.app.vault.cachedRead(file);
        }
      } catch (error) {
        content = null;
      }
      if (typeof content !== "string") {
        new Notice("This task's Snoozed row is no longer in today's note");
        return false;
      }
      const hintLine =
        Number.isInteger(snapshot.line) && snapshot.line > 0
          ? snapshot.line - 1
          : null;
      const lineNumber = this.snoozeMarksFindRowLine(
        content,
        blockId,
        hintLine,
      );
      if (lineNumber === null) {
        new Notice("This task's Snoozed row is no longer in today's note");
        return false;
      }
      const text = content.split(/\r?\n/)[lineNumber] || "";
      let column = text.indexOf("^" + blockId);
      if (column < 0) {
        column = 0;
      }
      return await this.jumpToDailyNoteLine(
        dailyPath,
        lineNumber,
        column,
        {
          vanished:
            "This task's Snoozed row is no longer in today's note",
        },
      );
    } catch (error) {
      return false;
    } finally {
      this.snoozeJumpInFlight = false;
    }
  }
}
