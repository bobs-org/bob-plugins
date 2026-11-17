// Record Card entry points, palette command, lifecycle, and the record
// branch of the shared YAML excursion. Findings never block Done.
class BobLedgerToolsRecordCardMixin {
  setupRecordCard() {
    this.recordCardModal = null;
    this.recordCardActive = true;
    try {
      this.addCommand({
        id: "edit-record",
        name: "Edit record",
        callback: () => { void this.openRecordCard(); },
      });
    } catch (_) {}
  }

  teardownRecordCard() {
    this.recordCardActive = false;
    try { this.recordCardModal?.close?.(); } catch (_) {}
    this.recordCardModal = null;
  }

  recordCardActiveFilePath(overridePath = "") {
    if (overridePath) return recordCardPath(overridePath);
    try {
      const view = typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : this.app?.workspace?.getActiveViewOfType?.(MarkdownView);
      if (view && view.file && view.file.path) return recordCardPath(view.file.path);
    } catch (_) {}
    try {
      const file = this.app?.workspace?.activeLeaf?.view?.file;
      if (file && file.path) return recordCardPath(file.path);
    } catch (_) {}
    return "";
  }

  recordCardAlbumStem(gate) {
    const album = gate && gate.album;
    return String((album && album.stem) || "").trim();
  }

  recordCardStem(path) {
    const filePath = recordCardPath(path);
    const base = filePath.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  }

  async openRecordCard(options = {}) {
    if (this.recordCardActive === false) return { ok: false, reason: "unloaded" };
    const desktop = typeof this.recordSheetDesktop === "function"
      ? this.recordSheetDesktop()
      : (typeof albumHeaderIsDesktopPlatform === "function" ? albumHeaderIsDesktopPlatform() : false);
    if (desktop !== true) {
      try { new Notice(RECORD_CARD_MOBILE_NOTICE); } catch (_) {}
      return { ok: false, reason: "mobile" };
    }
    const filePath = this.recordCardActiveFilePath(options.filePath || "");
    if (!filePath) {
      try { new Notice(RECORD_CARD_NON_RECORD_NOTICE); } catch (_) {}
      return { ok: false, reason: "missing-path" };
    }
    let gate = null;
    try { gate = this.recordSheetGateFor(filePath); } catch (_) { gate = null; }
    if (!gate || gate.mount !== true) {
      const notice = recordCardGateNotice(gate);
      try { new Notice(notice.message); } catch (_) {}
      return { ok: false, reason: notice.reason };
    }
    let sheetModel = null;
    try { sheetModel = this.recordSheetModelFor(filePath); } catch (_) { sheetModel = null; }
    if (!sheetModel) {
      try { new Notice(RECORD_CARD_NON_RECORD_NOTICE); } catch (_) {}
      return { ok: false, reason: "missing-model" };
    }
    const writable = recordCardWritable(gate);
    try { this.recordCardModal?.close?.(); } catch (_) {}
    const modal = new RecordCardModal(this.app, {
      plugin: this,
      recordPath: filePath,
      albumPath: gate.albumPath,
      type: this.recordCardAlbumStem(gate),
      stem: this.recordCardStem(filePath),
      sheetModel,
      gate,
      writable,
      field: options.field,
      stage: options.stage,
    });
    this.recordCardModal = modal;
    try { modal.open(); } catch (_) {}
    return { ok: true, modal, readOnly: !writable };
  }

  recordCardMarkdownLeaf(path) {
    const target = recordCardPath(path);
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      return leaves.find((leaf) => recordCardPath(leaf?.view?.file?.path) === target)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
    } catch (_) {
      return null;
    }
  }

  async recordCardJumpSource(path, line) {
    if (typeof this.recordSheetOpenSource === "function") {
      return this.recordSheetOpenSource(path, line);
    }
    return { ok: false, reason: "missing-jump" };
  }

  async recordCardStartYamlExcursion(options = {}) {
    const recordPath = recordCardPath(options.recordPath || "");
    const albumPath = recordCardPath(options.albumPath || "");
    if (options.broken === true && albumPath) {
      const line = Number.isInteger(options.warningLine) && options.warningLine > 0 ? options.warningLine : 1;
      return this.recordCardJumpSource(albumPath, line);
    }
    if (!recordPath) return { ok: false, reason: "missing-path" };
    const leaf = this.recordCardMarkdownLeaf(recordPath);
    if (!leaf) return this.recordCardJumpSource(recordPath, recordCardYamlLine(options.target, options.report, ""));
    let viewState = null;
    try { viewState = typeof leaf.getViewState === "function" ? leaf.getViewState() : null; } catch (_) {}
    let source = "";
    try { source = await this.recordSheetReadSource?.(recordPath); } catch (_) { source = ""; }
    const line = recordCardYamlLine(options.target, options.report, source);
    const record = this.albumYamlExcursionBegin(leaf, {
      kind: "record",
      albumPath,
      recordPath,
      viewState,
      selectedKey: options.field || "",
      selectedField: options.field || "",
      reopenCard: true,
    });
    if (!record) return this.recordCardJumpSource(recordPath, line);
    return this.recordCardJumpSource(recordPath, line);
  }

  async recordCardYamlDoneAttempt(leaf, record) {
    const ownPath = albumYamlExcursionOwnPath(record);
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let save = { ok: true };
    try { save = await this.albumYamlSaveExcursionEditors([ownPath]); }
    catch (error) { save = { ok: false, code: "save-failed", message: String((error && error.message) || error) }; }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    if (!save || save.ok !== true) {
      try { new Notice(save?.message || "Saving the record pane failed — fix it before Done."); } catch (_) {}
      return { ok: false, reason: save?.code || "save-failed" };
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let restoreError = null;
    try {
      record.restoring = true;
      if (record.viewState && typeof leaf.setViewState === "function") await leaf.setViewState(record.viewState);
      else if (record.viewState?.state && typeof leaf.openFile === "function") {
        const file = this.app?.vault?.getAbstractFileByPath?.(ownPath) || { path: ownPath };
        await leaf.openFile(file, { state: { ...record.viewState.state, file: ownPath } });
      }
    } catch (error) { restoreError = error; }
    record.restoring = false;
    if (this.albumYamlExcursionForLeaf(leaf) !== record && !restoreError) return { ok: false, reason: "stale-excursion" };
    if (restoreError) return { ok: false, reason: "restore-failed", message: String(restoreError.message || restoreError) };
    this.albumYamlExcursionClear(leaf);
    if (record.reopenCard !== false) {
      const opened = await this.openRecordCard({
        filePath: record.recordPath || ownPath,
        field: record.selectedField || record.selectedKey,
      });
      return { ok: true, reopened: Boolean(opened?.modal) };
    }
    return { ok: true, reopened: false };
  }
}

