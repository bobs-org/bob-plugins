// Today marks in Live Preview (today-mark-v1).
// The Today cache is the sole membership source. This mixin only
// decorates exact task lines in Live Preview and opens the existing
// daily note for an explicit click or command.
class BobLedgerToolsTodayMarksMixin {
  setupTodayMarks() {
    try {
      if (typeof this.todayMarksEnabled !== "boolean") {
        this.todayMarksEnabled = true;
      }
      if (typeof this.todayJumpInFlight !== "boolean") {
        this.todayJumpInFlight = false;
      }
      try {
        const body =
          typeof document !== "undefined" && document ? document.body : null;
        if (body && body.classList) {
          if (this.todayMarksEnabled) {
            body.classList.remove("bob-today-marks-off");
          } else {
            body.classList.add("bob-today-marks-off");
          }
        }
      } catch (error) {
        // The opt-out class is best-effort; JavaScript gating is authoritative.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-today-marks",
            name: "Toggle Today marks",
            callback: () => this.toggleTodayMarks(),
          });
          this.addCommand({
            id: "go-to-today-task-link",
            name: "Go to today's Task Link",
            editorCallback: (editor, view) =>
              this.goToTodayTaskLink(editor, view),
          });
        }
      } catch (error) {
        // Commands are best-effort on limited test hosts.
      }
      try {
        const extension = this.createTodayMarkExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      this.scheduleTodayMarksRefresh();
    } catch (error) {
      // Setup never breaks plugin startup.
    }
  }

  todayMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          TodayMarkWidget &&
          ensureTodayMarksRefresh(),
      );
    } catch (error) {
      return false;
    }
  }

  createTodayMarkExtension() {
    try {
      if (
        !this.todayMarksAvailable() ||
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildTodayMarkDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.todayMarkShouldRebuild(update)) {
              this.decorations =
                plugin.buildTodayMarkDecorations(update.view);
            }
          } catch (error) {
            // A failed rebuild leaves the last valid decorations in place.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(MarkPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  todayMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      const refresh = ensureTodayMarksRefresh();
      const transactions = update.transactions || [];
      for (const transaction of transactions) {
        const effects =
          transaction && transaction.effects !== undefined
            ? transaction.effects
            : null;
        const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
        for (const effect of list) {
          if (
            effect === refresh ||
            (refresh &&
              effect &&
              typeof effect.is === "function" &&
              effect.is(refresh))
          ) {
            return true;
          }
        }
      }
      if (editorLivePreviewField && update.startState && update.state) {
        try {
          if (
            update.startState.field(editorLivePreviewField) !==
            update.state.field(editorLivePreviewField)
          ) {
            return true;
          }
        } catch (error) {
          // Field comparison is best-effort.
        }
      }
      if (editorInfoField && update.startState && update.state) {
        try {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          const beforePath =
            before && before.file ? before.file.path : null;
          const afterPath =
            after && after.file ? after.file.path : null;
          if (beforePath !== afterPath) {
            return true;
          }
        } catch (error) {
          // Field comparison is best-effort.
        }
      }
      // selectionSet is deliberately ignored: the mark stays visible
      // under the caret and never changes Vim motion positions.
      return false;
    } catch (error) {
      return false;
    }
  }

  buildTodayMarkDecorations(view) {
    try {
      if (
        !this.todayMarksEnabled ||
        !this.todayCache ||
        !(this.todayCache.rank instanceof Map) ||
        typeof this.isTodayCacheReady !== "function" ||
        !this.isTodayCacheReady(new Date()) ||
        !Decoration ||
        !RangeSetBuilder ||
        !TodayMarkWidget ||
        !editorInfoField ||
        !editorLivePreviewField ||
        !view ||
        !view.state
      ) {
        return Decoration.none;
      }
      let live = false;
      let info = null;
      try {
        live = view.state.field(editorLivePreviewField) === true;
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      if (!live) {
        return Decoration.none;
      }
      const filePath =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : "";
      if (!filePath || PLAN_DAILY_PATH_RE.test(filePath)) {
        return Decoration.none;
      }

      let tree = null;
      try {
        if (typeof syntaxTree === "function") {
          tree = syntaxTree(view.state);
        } else if (
          syntaxTree &&
          typeof syntaxTree.resolveInner === "function"
        ) {
          tree = syntaxTree;
        }
      } catch (error) {
        tree = null;
      }
      // Without a syntax tree we cannot distinguish inline/fenced code,
      // so stay neutral until the Live Preview parser is ready.
      if (!tree || typeof tree.resolveInner !== "function") {
        return Decoration.none;
      }

      const doc = view.state.doc;
      if (
        !doc ||
        typeof doc.lineAt !== "function" ||
        typeof doc.line !== "function" ||
        !Number.isInteger(doc.lines) ||
        doc.lines < 1
      ) {
        return Decoration.none;
      }
      const visible = (view.visibleRanges || []).slice();
      const candidates = [];
      const seenLines = new Set();
      const wantedIds = [];
      for (const range of visible) {
        if (!range || typeof range.from !== "number") {
          continue;
        }
        let position = Math.max(0, range.from);
        const end =
          typeof range.to === "number"
            ? Math.min(range.to, doc.length)
            : doc.length;
        let guard = 0;
        while (position <= end && guard < 10000) {
          guard += 1;
          let line = null;
          try {
            line = doc.lineAt(position);
          } catch (error) {
            break;
          }
          if (!line || typeof line.text !== "string") {
            break;
          }
          if (!seenLines.has(line.from)) {
            seenLines.add(line.from);
            if (line.text.indexOf("#task") !== -1) {
              const candidate = todayMarkLineCandidate(line.text);
              if (candidate) {
                candidates.push({ line, candidate });
                wantedIds.push(candidate.blockId);
              }
            }
          }
          if (
            typeof line.to !== "number" ||
            line.to >= end ||
            line.to < position
          ) {
            break;
          }
          position = line.to + 1;
        }
      }
      if (candidates.length === 0) {
        return Decoration.none;
      }

      const allLines = [];
      for (let number = 1; number <= doc.lines; number += 1) {
        try {
          const line = doc.line(number);
          allLines.push(line && typeof line.text === "string" ? line.text : "");
        } catch (error) {
          allLines.push("");
        }
      }
      const duplicateIds = new Set(
        todayMarkDuplicateIds(allLines, wantedIds),
      );
      const builder = new RangeSetBuilder();
      const path = /\.md$/i.test(filePath) ? filePath : filePath + ".md";
      const nowMs = Date.now();
      for (const item of candidates) {
        try {
          const line = item.line;
          const candidate = item.candidate;
          if (duplicateIds.has(candidate.blockId)) {
            continue;
          }
          if (
            freshnessMarkPosInCode(
              tree,
              line.from + candidate.tagFrom + 1,
            )
          ) {
            continue;
          }
          const key = path + "#" + candidate.blockId;
          if (!this.todayCache.rank.has(key)) {
            continue;
          }
          const details =
            typeof this.todayDetailsForKey === "function"
              ? this.todayDetailsForKey(key)
              : [];
          const tooltip = todayMarkTooltip(details, {
            platform: Platform && Platform.isMobile
              ? "mobile"
              : Platform && Platform.isMacOS
                ? "mac"
                : "other",
          });
          const enteredAt =
            typeof this.todayMarkEnteredAt === "function"
              ? this.todayMarkEnteredAt(key)
              : null;
          const widget = new TodayMarkWidget(
            key,
            tooltip,
            todayMarkEntering(enteredAt, nowMs),
            (clickedKey) => {
              void this.jumpTodayTaskLink(clickedKey);
            },
          );
          builder.add(
            line.from + candidate.insertCh,
            line.from + candidate.insertCh,
            Decoration.widget({ widget, side: -1 }),
          );
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  refreshTodayMarkEditors() {
    try {
      const refresh = ensureTodayMarksRefresh();
      const workspace = this.app && this.app.workspace;
      if (
        !refresh ||
        !workspace ||
        typeof workspace.getLeavesOfType !== "function"
      ) {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function") {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }

  scheduleTodayMarksRefresh() {
    try {
      if (
        this.todayMarksTimer !== null &&
        this.todayMarksTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        window &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : typeof setTimeout === "function"
            ? setTimeout
            : null;
      if (!schedule) {
        this.refreshTodayMarkEditors();
        return;
      }
      this.todayMarksTimer = schedule(() => {
        this.todayMarksTimer = null;
        this.refreshTodayMarkEditors();
      }, 150);
    } catch (error) {
      this.refreshTodayMarkEditors();
    }
  }

  toggleTodayMarks() {
    try {
      this.todayMarksEnabled = !this.todayMarksEnabled;
      const enabled = this.todayMarksEnabled;
      try {
        const body =
          typeof document !== "undefined" && document ? document.body : null;
        if (body && body.classList) {
          if (enabled) {
            body.classList.remove("bob-today-marks-off");
          } else {
            body.classList.add("bob-today-marks-off");
          }
        }
      } catch (error) {
        // JavaScript gating remains authoritative.
      }
      this.refreshTodayMarkEditors();
      try {
        new Notice(enabled ? "Today marks on" : "Today marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.todayMarksEnabled;
    }
  }

  todayMarksEditorLine(editor, lineNumber) {
    try {
      if (
        editor &&
        typeof editor.getLine === "function" &&
        Number.isInteger(lineNumber) &&
        lineNumber >= 0
      ) {
        return editor.getLine(lineNumber);
      }
      const cm = getEditorViewFromEditor(editor);
      const line = cm && cm.state && cm.state.doc
        ? cm.state.doc.line(lineNumber + 1)
        : null;
      return line && typeof line.text === "string" ? line.text : null;
    } catch (error) {
      return null;
    }
  }

  todayMarksDocumentLines(cm) {
    try {
      const doc = cm && cm.state ? cm.state.doc : null;
      if (!doc || typeof doc.line !== "function" || !Number.isInteger(doc.lines)) {
        return [];
      }
      const lines = [];
      for (let number = 1; number <= doc.lines; number += 1) {
        const line = doc.line(number);
        lines.push(line && typeof line.text === "string" ? line.text : "");
      }
      return lines;
    } catch (error) {
      return [];
    }
  }

  todayMarksTaskAtCursor(editor, markdownView) {
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
      const duplicates = todayMarkDuplicateIds(
        this.todayMarksDocumentLines(cm),
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
      const path = /\.md$/i.test(filePath) ? filePath : filePath + ".md";
      return { key: path + "#" + blockId };
    } catch (error) {
      return null;
    }
  }

  goToTodayTaskLink(editor, markdownView) {
    try {
      const task = this.todayMarksTaskAtCursor(editor, markdownView);
      if (!task) {
        new Notice("No task on this line");
        return false;
      }
      if (
        task.ambiguous ||
        !this.todayCache ||
        !(this.todayCache.rank instanceof Map) ||
        typeof this.isTodayCacheReady !== "function" ||
        !this.isTodayCacheReady(new Date()) ||
        !this.todayCache.rank.has(task.key)
      ) {
        new Notice("Not on today's plan");
        return false;
      }
      void this.jumpTodayTaskLink(task.key);
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

  todayMarksFindOpenLink(content, dailyPath, key) {
    try {
      const links = computeTodayLinks(content, dailyPath);
      const resolved = resolveTodayLinkKeys(
        links,
        dailyPath,
        (target, daily) => this.resolveTodayLink(target, daily),
      );
      const runningLine = todayRunningEntryLine(todayOpenEntries(content));
      const matches = [];
      for (const item of resolved) {
        if (!item || item.key !== key || !item.link) {
          continue;
        }
        const sourceLines = String(content || "").split(/\r?\n/);
        const source = sourceLines[item.link.ledgerLine - 1] || "";
        const token = todayWikilinkTokens(source).find(
          (candidate) =>
            candidate.blockId === item.link.blockId &&
            candidate.pathPart === item.link.target,
        );
        if (token) {
          matches.push({ link: item.link, token });
        }
      }
      matches.sort((left, right) => {
        const leftRunning = left.link.entryLine === runningLine;
        const rightRunning = right.link.entryLine === runningLine;
        if (leftRunning !== rightRunning) {
          return leftRunning ? -1 : 1;
        }
        return left.link.ledgerLine - right.link.ledgerLine;
      });
      return matches;
    } catch (error) {
      return [];
    }
  }

  async jumpTodayTaskLink(key) {
    if (this.todayJumpInFlight) {
      return false;
    }
    this.todayJumpInFlight = true;
    try {
      if (
        typeof key !== "string" ||
        !key ||
        !this.todayCache ||
        !(this.todayCache.rank instanceof Map) ||
        typeof this.isTodayCacheReady !== "function" ||
        !this.isTodayCacheReady(new Date())
      ) {
        return false;
      }
      if (!this.todayCache.rank.has(key)) {
        new Notice("This task's Task Link is no longer in today's note");
        return false;
      }
      const dailyPath =
        typeof this.todayCache.dailyPath === "string"
          ? this.todayCache.dailyPath
          : "";
      if (!dailyPath) {
        return false;
      }
      const details =
        typeof this.todayDetailsForKey === "function"
          ? this.todayDetailsForKey(key)
          : [];
      const cachedLine =
        details[0] && Number.isInteger(details[0].ledgerLine)
          ? details[0].ledgerLine
          : null;
      let markdownView = null;
      const existing = findOpenMarkdownLeafByPath(this.app, dailyPath);
      if (existing) {
        markdownView = await activateMarkdownLeaf(this.app, existing, {
          path: dailyPath,
        });
      } else {
        const opened = await openTodayDailyNoteWithState(this.app);
        markdownView = opened && opened.view ? opened.view : null;
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
        new Notice("This task's Task Link is no longer in today's note");
        return false;
      }
      const matches = this.todayMarksFindOpenLink(content, dailyPath, key);
      const chosen =
        matches.find((item) => item.link.ledgerLine === cachedLine) ||
        matches[0] ||
        null;
      if (!chosen) {
        new Notice("This task's Task Link is no longer in today's note");
        return false;
      }

      const lineNumber = chosen.link.ledgerLine - 1;
      const cursor = { line: lineNumber, ch: chosen.token.start };
      try {
        if (typeof markdownView.editor.setCursor === "function") {
          markdownView.editor.setCursor(cursor);
        } else {
          const cm = getEditorViewFromEditor(markdownView.editor);
          const line =
            cm && cm.state && cm.state.doc
              ? cm.state.doc.line(lineNumber + 1)
              : null;
          if (line && cm && typeof cm.dispatch === "function") {
            cm.dispatch({
              selection: { anchor: line.from + chosen.token.start },
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
          lineNumber,
          chosen.token.start,
        );
      } catch (error) {
        centered = false;
      }
      if (!centered) {
        try {
          scrollEditorIntoView(markdownView.editor, lineNumber, chosen.token.start);
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
    } finally {
      this.todayJumpInFlight = false;
    }
  }
}

