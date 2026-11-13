// Category card lifecycle, version-2 bank API actions, and the note-local
// filing walk. Bob supplies suggestions and totals; the editor changes one row.

class BobLedgerToolsBankCategoryMixin {
  setupBankCategoryUi() {
    this.bankCategoryModal = null;
    this.bankCategorySession = null;
  }

  teardownBankCategoryUi() {
    try { this.bankCategoryModal?.close?.(); } catch (_) {}
    this.bankCategoryModal = null;
    this.bankCategorySession = null;
  }

  bankCategoryModalClosed(modal) {
    if (this.bankCategoryModal === modal) this.bankCategoryModal = null;
  }

  bankCategoryClaimRowClose(editor, view) {
    return this.bankCategoryOpenAtCursor(editor, view, "close", true);
  }

  bankCategorySetCategory(editor, view) {
    return this.bankCategoryOpenAtCursor(editor, view, "set", false);
  }

  bankCategoryContextAt(editor, view, lineNumber) {
    const path = this.bankActiveFilePath(view);
    if (!editor || typeof editor.getValue !== "function" || bankMonthFromPath(path) === null) return null;
    const source = editor.getValue();
    const current = bankCategoryCurrentToken(path, source, lineNumber);
    if (!current || !current.token || !current.row) return null;
    const token = current.token;
    const row = current.row;
    const cardRow = {
      path,
      line: row.line,
      date: row.date,
      cents: token.cents,
      payee: token.payee,
      category: token.category && token.category.key ? token.category.key : null,
      account: token.account && token.account.alias ? token.account.alias : null,
      flagged: token.flagged === true,
      acknowledged: token.acknowledged === true,
      id: row.ackId || null,
    };
    return {
      path,
      month: bankMonthFromPath(path).key,
      source,
      scan: current.scan,
      row: cardRow,
      token,
      capture: bankCategoryCapture({ path, line: row.line, lineText: current.raw }),
    };
  }

  bankCategoryOpenAtCursor(editor, view, mode, openedWithCtrlEnter) {
    const activeEditor = editor || this.bankActiveEditor(view);
    if (!activeEditor || typeof activeEditor.getCursor !== "function") return false;
    const cursor = activeEditor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) return false;
    const context = this.bankCategoryContextAt(activeEditor, view, cursor.line + 1);
    if (!context || (mode === "close" && context.row.acknowledged)) return false;
    if (this.bankCategoryModal) {
      try { this.bankCategoryModal.close(); } catch (_) {}
    }
    let session = null;
    let progress = null;
    if (mode === "close") {
      const now = Date.now();
      session = this.bankCategorySession;
      if (!session || session.path !== context.path || bankCategorySessionIdleExpired(session, now)) {
        session = bankCategorySessionStart(context.path, now);
      }
      this.bankCategorySession = session;
      progress = bankCategorySessionProgress(session, bankCategoryWaitingRows(context.scan).length);
    }
    const cached = this.bankCategoryCachedReport(context.month);
    const categories = cached && Array.isArray(cached.categories) ? cached.categories : null;
    const modal = new BankCategoryCardModal(this.app, {
      plugin: this,
      mode,
      context,
      categories,
      progress,
      openedWithCtrlEnter,
      onChoose: (categoryKey, kind, activeModal) =>
        this.bankCategoryCommit(activeModal, categoryKey, kind),
      onMonth: (path) => this.bankCategoryOpenWaitingMonth(path),
    });
    modal.editor = activeEditor;
    modal.session = session;
    modal.month = context.month;
    this.bankCategoryModal = modal;
    modal.open();
    if (cached) modal.setReport(cached);
    void Promise.resolve(this.apiBankRefresh({ command: "report", month: context.month }))
      .then((result) => {
        if (this.bankCategoryModal === modal && !modal.didInteract && result && result.report) {
          modal.setReport(result.report);
        }
      })
      .catch(() => {});
    return true;
  }

  bankCategoryCachedReport(month) {
    try {
      const key = bankCacheKey(bankBuildArgs({ command: "report", month }));
      return this.bankLastGoodReport(key);
    } catch (_) {
      return null;
    }
  }

  bankCategoryReportRows(report) {
    const out = [];
    for (const day of Array.isArray(report?.days) ? report.days : []) {
      for (const row of Array.isArray(day?.rows) ? day.rows : []) {
        out.push({ ...row, path: row.path || day.path, date: row.date || day.date });
      }
    }
    return out;
  }

  bankCategoryApplyEdits(editor, plan) {
    if (!editor || typeof editor.replaceRange !== "function" || !plan || plan.ok !== true) return false;
    const lineIndex = plan.line - 1;
    const raw = typeof editor.getLine === "function"
      ? editor.getLine(lineIndex)
      : String(editor.getValue() || "").split("\n")[lineIndex]?.replace(/\r$/, "");
    if (typeof raw !== "string") return false;
    const replacement = bankCategoryApplyLineEdits(raw, plan);
    if (replacement === null) return false;
    if (replacement !== raw) {
      // A single whole-line replacement joins checkbox and category edits into
      // one CodeMirror transaction and therefore one undo step.
      editor.replaceRange(replacement,
        { line: lineIndex, ch: 0 },
        { line: lineIndex, ch: raw.length });
    }
    return true;
  }

  async bankCategoryCommit(modal, categoryKey, kind) {
    if (!modal || modal.closed || modal !== this.bankCategoryModal) return false;
    const editor = modal.editor;
    if (!editor || typeof editor.getValue !== "function") {
      new Notice("Bank: the row is no longer open");
      return false;
    }
    const currentPath = this.bankActiveFilePath();
    const currentSource = editor.getValue();
    const plan = bankCategoryWritePlan({
      mode: modal.mode,
      capture: modal.context && modal.context.capture,
      currentPath,
      currentSource,
      categoryKey,
    });
    if (!plan.ok) {
      new Notice(plan.message || BANK_CATEGORY_WRITE_REFUSAL);
      return false;
    }
    if (!this.bankCategoryApplyEdits(editor, plan)) {
      new Notice(BANK_CATEGORY_WRITE_REFUSAL);
      return false;
    }
    if (modal.mode === "set") {
      modal.close();
      new Notice(plan.action === "noop" ? "Bank: row has no category" : "Bank: category updated");
      return true;
    }

    const now = Date.now();
    const session = bankCategorySessionRecord(modal.session, kind, now);
    modal.session = session;
    this.bankCategorySession = session;
    const source = editor.getValue();
    const scan = bankScanSource(modal.context.path, source);
    const next = bankCategoryNextWaiting({ scan, filedLine: plan.line });
    const month = modal.month;
    const refresh = Promise.resolve(this.apiBankRefresh({ command: "report", month }));
    if (!next) {
      await this.bankCategoryCompleteWalk(modal, session, refresh);
      return true;
    }

    const nextContext = this.bankCategoryContextAt(editor, { file: { path: modal.context.path } }, next.row.line);
    if (!nextContext) {
      new Notice(BANK_CATEGORY_WRITE_REFUSAL);
      modal.close();
      return false;
    }
    editor.setCursor?.({
      line: next.row.line - 1,
      ch: nextContext.token.payeeSpan ? nextContext.token.payeeSpan.start : 0,
    });
    const progress = bankCategorySessionProgress(session, bankCategoryWaitingRows(scan).length);
    modal.setNext(nextContext, progress, bankCategoryLockInit(Date.now()));
    const refreshResult = await Promise.race([
      refresh,
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
    if (this.bankCategoryModal !== modal || modal.closed) return true;
    modal.waitingRefresh = false;
    modal.busy = false;
    if (refreshResult && refreshResult.report) modal.setReport(refreshResult.report);
    modal.paint();
    if (!refreshResult) {
      void refresh.then((late) => {
        if (this.bankCategoryModal === modal && !modal.didInteract && late && late.report) {
          modal.setReport(late.report);
        }
      }).catch(() => {});
    }
    return true;
  }

  async bankCategoryCompleteWalk(modal, session, monthRefresh) {
    modal.waitingRefresh = true;
    modal.busy = false;
    modal.paint();
    const listPromise = Promise.resolve(this.apiBankRefresh({ command: "list", all: true }));
    const [monthResult, listResult] = await Promise.all([
      Promise.resolve(monthRefresh).catch(() => null),
      listPromise.catch(() => null),
    ]);
    if (this.bankCategoryModal !== modal || modal.closed) return;
    const report = monthResult && monthResult.report;
    const waitingByMonth = new Map();
    for (const day of Array.isArray(listResult?.report?.days) ? listResult.report.days : []) {
      for (const row of Array.isArray(day?.rows) ? day.rows : []) {
        if (!row || row.acknowledged !== false) continue;
        const path = row.path || day.path;
        const month = bankMonthFromPath(path);
        if (!month || path === modal.context.path) continue;
        const entry = waitingByMonth.get(path) || { month: month.key, path, waiting: 0 };
        entry.waiting += 1;
        waitingByMonth.set(path, entry);
      }
    }
    const summary = bankCategoryEndOfRunSummary({
      monthLabel: report?.period?.label || modal.month,
      filed: session.filed,
      elapsedMs: Date.now() - session.startedAt,
      accepted: session.accepted,
      picked: session.picked,
      noCategory: session.noCategory,
      accounts: report?.accounts || [],
      waitingByMonth: Array.from(waitingByMonth.values()).sort((left, right) => left.month.localeCompare(right.month)),
      bobReachable: Boolean(report && !monthResult?.error),
    });
    this.bankCategorySession = null;
    new Notice(summary.line1);
    modal.showSummary(summary);
  }

  async bankCategoryOpenWaitingMonth(path) {
    const month = bankMonthFromPath(path);
    if (!month) return false;
    const result = await this.apiBankFetch({ command: "report", month: month.key });
    const rows = this.bankCategoryReportRows(result && result.report);
    const first = rows.filter((row) => row.acknowledged === false)
      .sort((left, right) => Number(left.line) - Number(right.line))[0];
    if (!first) {
      new Notice("Bank: no waiting rows in that month");
      return false;
    }
    return this.bankCardNavigateRow(first);
  }
}
