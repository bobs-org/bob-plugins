class TaskStatusCyclerOpenLineMixin {
  getCodeMirrorContents(cm) {
    if (!cm) return "";
    if (typeof cm.getValue === "function") {
      return String(cm.getValue() || "");
    }
    const lines = [];
    const last =
      typeof cm.lastLine === "function"
        ? cm.lastLine()
        : typeof cm.lineCount === "function"
          ? cm.lineCount() - 1
          : -1;
    if (last < 0 && typeof cm.getLine === "function") {
      let index = 0;
      while (typeof cm.getLine(index) === "string") {
        lines.push(cm.getLine(index));
        index += 1;
      }
      return lines.join("\n");
    }
    for (let index = 0; index <= last; index += 1) {
      lines.push(typeof cm.getLine === "function" ? cm.getLine(index) || "" : "");
    }
    return lines.join("\n");
  }

  getCodeMirrorLineCount(cm) {
    if (!cm) return 0;
    if (typeof cm.lineCount === "function") return cm.lineCount();
    if (typeof cm.lastLine === "function") return cm.lastLine() + 1;
    const contents = this.getCodeMirrorContents(cm);
    return taskReqDocument(contents).texts.length;
  }

  applyOpenLinePlanToCodeMirror(cm, plan) {
    if (!plan || plan.kind !== "insert" || !cm || typeof cm.replaceRange !== "function") {
      return false;
    }
    const inserted = plan.lines.join("\n");
    const lineCount = this.getCodeMirrorLineCount(cm);
    if (plan.insertBeforeLine >= lineCount) {
      const last = Math.max(lineCount - 1, 0);
      const lastText = typeof cm.getLine === "function" ? cm.getLine(last) || "" : "";
      cm.replaceRange(`\n${inserted}`, { line: last, ch: lastText.length });
    } else {
      cm.replaceRange(`${inserted}\n`, { line: plan.insertBeforeLine, ch: 0 });
    }
    if (typeof cm.setCursor === "function") {
      cm.setCursor(plan.cursorLine, plan.cursorCh);
    }
    return true;
  }

  recordOpenLineJump(plan, path) {
    if (!plan || !plan.recordJump || !path) return;
    const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
    const api = plugins && plugins["bob-navigation-hotkeys"] && plugins["bob-navigation-hotkeys"].api;
    if (!api || typeof api.recordJump !== "function") return;
    try {
      api.recordJump(
        { path, line: plan.originLine, ch: plan.originCh || 0 },
        { path, line: plan.cursorLine, ch: plan.cursorCh },
      );
    } catch (_error) {
      // Jump history is best-effort; the insert still lands.
    }
  }

  armOpenLineScaffold(cm, plan, path) {
    this.disarmOpenLineScaffold();
    if (!plan || plan.kind !== "insert" || !plan.scaffold) return;
    this.openLineScaffold = {
      cm,
      path: path || null,
      scaffold: plan.scaffold,
    };
    const onMode = (args) => {
      const mode = args && args.mode;
      if (mode && mode !== "insert" && mode !== "replace") {
        this.flushOpenLineScaffold("insert-leave");
      }
    };
    const onBlur = () => this.flushOpenLineScaffold("blur");
    this.openLineScaffold.onMode = onMode;
    this.openLineScaffold.onBlur = onBlur;
    if (cm && typeof cm.on === "function") {
      cm.on("vim-mode-change", onMode);
      cm.on("blur", onBlur);
    }
  }

  disarmOpenLineScaffold() {
    const pending = this.openLineScaffold;
    if (!pending) return;
    const cm = pending.cm;
    if (cm && typeof cm.off === "function") {
      if (pending.onMode) cm.off("vim-mode-change", pending.onMode);
      if (pending.onBlur) cm.off("blur", pending.onBlur);
    }
    this.openLineScaffold = null;
  }

  flushOpenLineScaffold(_reason) {
    const pending = this.openLineScaffold;
    if (!pending) return false;
    const view = this.app && this.app.workspace
      ? this.app.workspace.getActiveViewOfType(MarkdownView)
      : null;
    const file = view && view.file;
    if (pending.path && file && file.path !== pending.path) {
      this.disarmOpenLineScaffold();
      return false;
    }
    const cm = pending.cm;
    if (!cm || typeof cm.getLine !== "function" || typeof cm.replaceRange !== "function") {
      this.disarmOpenLineScaffold();
      return false;
    }
    const contents = this.getCodeMirrorContents(cm);
    const pruned = pruneOpenLineScaffold(contents, pending.scaffold);
    this.disarmOpenLineScaffold();
    if (pruned === null) return false;
    const last = this.getCodeMirrorLineCount(cm) - 1;
    const lastText = last >= 0 ? cm.getLine(last) || "" : "";
    cm.replaceRange(pruned, { line: 0, ch: 0 }, { line: Math.max(last, 0), ch: lastText.length });
    return true;
  }

  registerOpenLineScaffoldPrune() {
    if (!this.app || !this.app.workspace || typeof this.app.workspace.on !== "function") {
      return false;
    }
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.flushOpenLineScaffold("leaf")),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.flushOpenLineScaffold("file-open")),
    );
    return true;
  }

  applyVimOpenLine(cm, direction) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }
    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }
    const contents = this.getCodeMirrorContents(cm);
    const today =
      typeof this.getCreatedDateString === "function"
        ? this.getCreatedDateString()
        : formatLocalDate();
    const plan = planOpenLine(contents, cursor.line, direction, today);
    if (!plan || plan.kind === "refuse") {
      if (plan && plan.notice) new Notice(plan.notice);
      return;
    }
    if (!this.applyOpenLinePlanToCodeMirror(cm, plan)) return;
    const view = this.app && this.app.workspace
      ? this.app.workspace.getActiveViewOfType(MarkdownView)
      : null;
    const path = (view && view.file && view.file.path) || null;
    this.recordOpenLineJump(plan, path);
    this.armOpenLineScaffold(cm, plan, path);
    this.enterVimInsertMode(cm);
  }
}
