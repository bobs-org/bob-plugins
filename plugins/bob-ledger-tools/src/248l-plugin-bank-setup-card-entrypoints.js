// Bank Setup card entry points, lifecycle, and its branch of the shared
// album/bank YAML excursion. The palette command stays an object literal so
// the generated command inventory can describe it.
class BobLedgerToolsBankSetupCardMixin {
  setupBankSetupCard() {
    this.bankSetupCardModal = null;
    this.bankSetupCardActive = true;
    try {
      this.addCommand({
        id: "edit-bank-setup",
        name: "Edit bank setup",
        callback: () => { void this.openBankSetupCard(); },
      });
    } catch (_) {}
  }

  teardownBankSetupCard() {
    this.bankSetupCardActive = false;
    try { this.bankSetupCardModal?.close?.(); } catch (_) {}
    this.bankSetupCardModal = null;
  }

  bankSetupCardModalClosed(modal) {
    if (this.bankSetupCardModal === modal) this.bankSetupCardModal = null;
  }

  async openBankSetupCard(options = {}) {
    if (typeof this.bankSetupDesktop === "function" && !this.bankSetupDesktop()) {
      try { new Notice("Bank setup editing needs desktop Obsidian."); } catch (_) {}
      return { ok: false, reason: "mobile" };
    }
    if (this.bankSetupCardActive === false) return { ok: false, reason: "unloaded" };
    try { this.bankSetupCardModal?.close?.(); } catch (_) {}
    const cached = options.report || this.bankSetupEntry?.().report || null;
    const modal = new BankSetupCardModal(this.app, {
      plugin: this,
      report: cached,
      section: options.section,
      selection: options.selection,
    });
    this.bankSetupCardModal = modal;
    if (!cached) modal.errorMessage = "Loading the current bank config…";
    modal.open();
    let result = null;
    try { result = await this.apiBankRefresh({ command: "config", force: true, wait: true }); } catch (error) {
      result = { report: null, error: { message: String(error?.message || error), code: "failed" } };
    }
    if (this.bankSetupCardModal !== modal || modal.closed) return { ok: false, reason: "closed" };
    if (result?.report) {
      modal.errorMessage = "";
      modal.setReport(result.report, { force: true, initial: !cached });
    } else {
      const code = result?.error?.code || "unavailable";
      const hint = bankConfigUpdateErrorModel({ ...result?.error, code }).hint;
      modal.errorMessage = hint || "The bank config report is unavailable.";
      modal.paint();
    }
    return { ok: Boolean(result?.report), modal, report: result?.report || null };
  }

  async bankSetupStartYamlExcursion(options = {}) {
    const path = bankSetupHubPath(options.sourcePath || BANK_SETUP_HUB_PATH);
    if (!path || !this.bankSetupDesktop()) {
      if (!this.bankSetupDesktop()) return this.bankSetupJumpYaml(path || BANK_SETUP_HUB_PATH, options.line);
      return { ok: false, reason: "missing-path" };
    }
    const leaf = this.bankSetupMarkdownLeaf(path);
    if (!leaf) return this.bankSetupJumpYaml(path, options.line);
    let viewState = null;
    try { viewState = typeof leaf.getViewState === "function" ? leaf.getViewState() : null; } catch (_) {}
    const currentReport = options.report || this.bankSetupEntry?.().report || null;
    const selection = options.selection || null;
    const record = this.albumYamlExcursionBegin(leaf, {
      kind: "bank",
      albumPath: path,
      viewState,
      selectedKey: selection?.id || "",
      selectedSection: options.section || "categories",
      selection,
      fingerprint: bankConfigFingerprintFromReport(currentReport),
      reopenCard: options.fromCard === true,
    });
    if (!record) return this.bankSetupJumpYaml(path, options.line);
    return this.bankSetupJumpYaml(path, options.line);
  }

  async bankSetupYamlDoneAttempt(leaf, record) {
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let save = { ok: true };
    try { save = await this.albumYamlSaveExcursionEditors([record.albumPath]); }
    catch (error) { save = { ok: false, code: "save-failed", message: String(error?.message || error) }; }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    if (!save || save.ok !== true) {
      try { new Notice(save?.message || "Saving bank.md failed — fix it before Done."); } catch (_) {}
      return { ok: false, reason: save?.code || "save-failed" };
    }
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { result = await this.apiBankRefresh({ command: "config", force: true, wait: true }); }
      catch (_) { result = null; }
      if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
      const report = result?.report || null;
      const fresh = report && result.stale !== true && !result.error &&
        (!Number.isInteger(result.generation) || !Number.isInteger(report.generation) || report.generation >= result.generation);
      if (fresh) break;
    }
    const report = result?.report || null;
    if (!report || result.stale === true || result.error) {
      try { new Notice(result?.error?.message || "Bank config is unavailable — fix sync before Done."); } catch (_) {}
      return { ok: false, reason: "unavailable" };
    }
    if (report.state !== "valid") {
      const findings = Array.isArray(report.findings) ? report.findings : [];
      const firstError = findings.find((finding) => finding && finding.severity !== "warning") || findings[0] || null;
      const line = Number.isInteger(firstError?.line) && firstError.line > 0
        ? firstError.line
        : Number.isInteger(report.line) && report.line > 0 ? report.line : 1;
      try {
        const editor = leaf?.view?.editor;
        const cursor = { line: line - 1, ch: 0 };
        editor?.setCursor?.(cursor);
        editor?.scrollIntoView?.({ from: cursor, to: cursor }, true);
      } catch (_) {}
      const message = firstError?.message || (report.state === "missing" ? "bank: mapping is missing." : "The bank config is invalid.");
      try { new Notice(`${message} Fix the highlighted line before Done.`); } catch (_) {}
      return { ok: false, reason: report.state === "missing" ? "missing-mapping" : "invalid-config", focus: { line } };
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let restoreError = null;
    try {
      record.restoring = true;
      if (record.viewState && typeof leaf.setViewState === "function") await leaf.setViewState(record.viewState);
      else if (record.viewState?.state && typeof leaf.openFile === "function") {
        const file = this.app?.vault?.getAbstractFileByPath?.(record.albumPath) || { path: record.albumPath };
        await leaf.openFile(file, { state: { ...record.viewState.state, file: record.albumPath } });
      }
    } catch (error) { restoreError = error; }
    record.restoring = false;
    if (this.albumYamlExcursionForLeaf(leaf) !== record && !restoreError) return { ok: false, reason: "stale-excursion" };
    if (restoreError) return { ok: false, reason: "restore-failed", message: String(restoreError.message || restoreError) };
    this.albumYamlExcursionClear(leaf);
    if (record.reopenCard) {
      const opened = await this.openBankSetupCard({
        report,
        section: record.selectedSection,
        selection: record.selection || null,
      });
      return { ok: true, reopened: Boolean(opened?.modal) };
    }
    return { ok: true, reopened: false };
  }
}
