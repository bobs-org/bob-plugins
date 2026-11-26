class BlockIdPromptSnoozedLinkNowMixin {
  // Live ledger links keep the historical true/false toggle contract;
  // active Snoozed rows are reported separately so they link now.
  async pomodoroTaskLinkPresence(source, blockId) {
    const taskPath = source && source.taskSnapshot && source.taskSnapshot.path
      ? source.taskSnapshot.path
      : source.sourcePath;
    const taskFile = this.resolveTaskFile(taskPath);
    const dailyFile = this.resolveTodayDailyFile();
    if (!dailyFile) return false;
    const dailyContent = taskFile && dailyFile.path === taskFile.path
      ? source.editor.getValue()
      : await this.readFileSnapshot(dailyFile, source);
    if (dailyContent === null) {
      new Notice(`Task toggle blocked: ${dailyFile.path} could not be read`);
      return "blocked";
    }
    const cleanup = planAllOpenPomodoroLinkCleanup(dailyContent, {
      sourcePath: dailyFile.path,
      targetPath: taskFile ? taskFile.path : taskPath,
      targetBlockId: blockId,
      resolveTarget: (reference, referrerPath) =>
        this.resolveReferenceDestination(reference, referrerPath),
      resolveSnoozedTarget: (row, referrerPath) =>
        this.resolveUniqueSnoozedTarget(row.target, referrerPath),
    });
    if (cleanup.removedCount > 0) return true;
    if (cleanup.snoozedRemovedCount > 0) return "snoozed";
    return false;
  }

  selectedActiveSnoozedRow(editor) {
    if (!editor || typeof editor.getCursor !== "function" || typeof editor.getValue !== "function") {
      return null;
    }
    const cursor = editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) return null;
    const lineText = editor.getLine(cursor.line) || "";
    const selected = findSelectedTaskLinkOnLine(lineText, cursor.ch);
    if (!selected || !selected.link) return null;
    const section = snoozeModel.parseSection(editor.getValue());
    const row = section && section.rows.find((item) =>
      item.kind === "active" && item.lineIndex === cursor.line &&
      item.blockId === selected.link.oldId,
    );
    if (!row) return null;
    const parsed = snoozeBlockLinkSpans(lineText);
    if (parsed.length !== 1 || parsed[0].blockId !== row.blockId || parsed[0].target !== row.target) {
      return null;
    }
    return { row, link: selected.link, lineNumber: cursor.line, lineText };
  }

  resolveUniqueSnoozedTarget(target, sourcePath) {
    const value = String(target || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!value) return this.resolveTaskFile(sourcePath);
    const vault = this.app && this.app.vault;
    const files = vault && typeof vault.getMarkdownFiles === "function"
      ? vault.getMarkdownFiles().filter((file) => file && typeof file.path === "string")
      : null;
    if (!files) return null;
    const wanted = value.replace(/\.md$/i, "").toLocaleLowerCase();
    const hasPath = wanted.includes("/");
    const matches = files.filter((file) => {
      const path = String(file.path).replace(/\\/g, "/").replace(/\.md$/i, "").toLocaleLowerCase();
      return hasPath
        ? path === wanted
        : path.split("/").pop() === wanted;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async startSnoozedRowLinkNow(editor, file, selected) {
    const { row } = selected;
    const taskFile = this.resolveUniqueSnoozedTarget(row.target, file.path);
    if (!taskFile) {
      new Notice(`Task link blocked: Snoozed target is missing or ambiguous in ${file.path}`);
      return false;
    }
    const context = { editor, file, sourcePath: file.path };
    const target = await this.resolveTaskLinkTarget(selected.link, file.path, context);
    if (target.error || target.path !== taskFile.path) {
      new Notice(target.error || `Task link blocked: Snoozed target changed in ${file.path}`);
      return false;
    }
    const source = {
      kind: "link-task-pomodoro",
      editor,
      file,
      sourcePath: file.path,
      line: target.line,
      task: {
        line: target.line,
        rawLine: target.rawLine,
        status: target.status,
        existingId: target.id,
        displayText: target.displayText,
      },
      taskSnapshot: {
        path: target.path,
        line: target.line,
        rawLine: target.rawLine,
        content: target.content,
      },
      snoozedRow: row,
    };

    const presence = await this.pomodoroTaskLinkPresence(source, target.id);
    if (presence === "blocked") return false;
    if (presence !== "snoozed") {
      new Notice(`Task link stopped: Snoozed row changed in ${file.path}`);
      return false;
    }

    this.promptOpen = true;
    let routeGate;
    try {
      routeGate = await this.gatePomodoroToggleInboxRoute(source, "link to today", []);
    } finally {
      this.promptOpen = false;
    }
    if (!routeGate || routeGate.kind === "cancel") return false;
    if (revalidatePomodoroToggleSourceAfterRoute(source, {}) !== true) {
      new Notice(`Task link blocked: Snoozed row or target changed in ${file.path}`);
      return false;
    }
    source.inboxRouteGate = routeGate;
    const pomodoroTarget = await this.choosePomodoroLinkTarget(source);
    if (!pomodoroTarget) return false;
    source.pomodoroTarget = pomodoroTarget;

    this.promptOpen = true;
    try {
      return await this.completePomodoroTaskLink(source, target.id);
    } finally {
      this.promptOpen = false;
    }
  }
}
