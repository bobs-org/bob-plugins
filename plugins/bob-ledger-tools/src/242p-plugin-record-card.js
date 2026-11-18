// Keyboard-first Record Card modal: browse, choices, discrete writes, and
// the shared guarded record session. Typed stages other than choices belong
// to a later phase; this file leaves a single stage-open dispatch for them.
const RecordCardModalBase = typeof albumSchemaCardModalBase === "function"
  ? albumSchemaCardModalBase()
  : class RecordCardFallback { constructor(app) { this.app = app; } open() { this.onOpen?.(); } close() { this.onClose?.(); } };

class RecordCardModal extends RecordCardModalBase {
  constructor(app, options = {}) {
    super(app);
    this.recordPlugin = options.plugin || null;
    this.recordPath = recordCardPath(options.recordPath || "");
    this.albumPath = recordCardPath(options.albumPath || "");
    this.recordType = String(options.type || options.recordType || "");
    this.recordStem = String(options.stem || "");
    this.sheetModel = options.sheetModel || null;
    this.gate = options.gate || (this.sheetModel && this.sheetModel.gate) || null;
    this.latestReport = options.report || null;
    this.writable = recordCardWritable(this.gate) && options.writable !== false;
    this.capabilityOk = Boolean(this.gate && this.gate.capabilityOk);
    this.selectedKey = "";
    this.selectedIndex = 0;
    this.stage = null;
    this.choiceFilter = "";
    this.selectedChoice = "";
    this.stageDraft = "";
    this.stageCaret = null;
    this.stageDraftText = "";
    this.stageList = [];
    this.stageItemDraft = "";
    this.stagePreview = null;
    this.stageEnterSeq = 0;
    this.pendingTab = null;
    this.menuOpen = false;
    this.session = null;
    this.sessionState = null;
    this.readSeq = 0;
    this.closeToken = 0;
    this.pendingApply = false;
    this.closed = false;
    this.composing = false;
    this.statusKind = this.writable ? "reading" : (this.gate && this.gate.state === "broken" ? "broken" : "capability");
    this.refusalMessage = "";
    this.refusalHint = "";
    this.consequence = "";
    this.warning = (this.sheetModel && this.sheetModel.warning) || "";
    this.retainedOps = null;
    this.announce = "";
    this.ownWriteUntil = 0;
    this.refreshTimer = null;
    this.unsubscribeAlbum = null;
    this.unsubscribeVault = null;
    this.requestedField = typeof options.field === "string" ? options.field : "";
    this.requestedStage = options.stage || null;
    const targets = this.recordTargets();
    this.selectedKey = recordCardOpeningSelection(targets, this.requestedField);
    this.selectedIndex = Math.max(0, targets.findIndex((target) => target.key === this.selectedKey));
  }

  recordTargets() {
    return recordCardTargets(this.sheetModel, this.latestReport);
  }

  recordSelected() {
    return recordCardTargetByKey(this.recordTargets(), this.selectedKey);
  }

  recordStatusModel() {
    const target = this.recordSelected();
    const undo = this.sessionState && this.sessionState.undoAvailable;
    return {
      statusKind: this.statusKind,
      statusText: "",
      refusalMessage: this.refusalMessage,
      refusalHint: this.refusalHint,
      consequence: this.consequence,
      warning: this.warning,
      writable: this.writable,
      capabilityOk: this.capabilityOk,
      pendingApply: this.pendingApply,
      menuOpen: this.menuOpen,
      stage: this.stage,
      target,
      undoAvailable: Boolean(undo || (this.recordPlugin && this.recordPlugin.recordUpdateLastUndo?.(this.recordPath))),
    };
  }

  recordPaintOptions() {
    const target = this.recordSelected();
    const reportField = recordCardFieldFromReport(this.latestReport, target && target.key);
    const allChoices = target && target.kind === "choices"
      ? recordCardChoiceList(target.field, reportField)
      : [];
    const visibleChoices = recordCardFilterChoices(allChoices, this.choiceFilter);
    return {
      selectedKey: this.selectedKey,
      targets: this.recordTargets(),
      stage: this.stage,
      filter: this.choiceFilter,
      selectedChoice: this.selectedChoice,
      currentValue: target && target.value != null ? String(target.value) : "",
      visibleChoices,
      menuOpen: this.menuOpen,
      warning: this.warning,
      status: this.recordStatusModel(),
      announce: this.announce,
      handlers: {
        openPath: (href, event) => this.recordPlugin?.recordSheetOpenPath?.(href, this.recordPath, event),
        hoverLink: (event, el, linktext) => this.recordPlugin?.recordSheetHoverLink?.(event, el, linktext, this.recordPath),
      },
    };
  }

  recordDoc() {
    return recordCardDomDoc(this.contentEl || this.modalEl || this.app?.document);
  }

  paintRecordCard() {
    if (this.closed) return;
    const doc = this.recordDoc();
    if (!doc) return;
    const options = this.recordPaintOptions();
    let card = this.contentEl?.querySelector?.(".bob-record-card");
    if (!card) {
      try { this.contentEl?.empty?.(); } catch (_) {}
      card = recordCardBuildEl(this.sheetModel, options, doc);
      if (card) this.contentEl?.appendChild?.(card);
      this.recordRestoreFocus();
      return;
    }
    recordCardPaintAll(card, this.sheetModel, options, doc);
    this.recordRestoreFocus();
  }

  recordRestoreFocus() {
    try {
      const card = this.contentEl?.querySelector?.(".bob-record-card");
      if (!card) return;
      if (this.stage && this.stage.kind === "choices") {
        const input = card.querySelector?.("[data-record-input='choice-filter']");
        if (input && typeof input.focus === "function") {
          input.focus();
          if (this.stageCaret && typeof input.setSelectionRange === "function") {
            input.setSelectionRange(this.stageCaret.start, this.stageCaret.end);
          }
          return;
        }
      }
      const row = card.querySelector?.(`[data-target-key="${this.selectedKey}"]`);
      if (row && typeof row.focus === "function") row.focus();
    } catch (_) {}
  }

  recordSelect(key) {
    const targets = this.recordTargets();
    const index = targets.findIndex((target) => target.key === key);
    if (index < 0) return;
    this.selectedKey = key;
    this.selectedIndex = index;
    this.announce = recordCardLiveAnnouncement("select", targets[index]);
    this.paintRecordCard();
  }

  recordMove(delta) {
    const next = recordCardNavigate(this.recordTargets(), this.selectedKey, delta);
    if (next) this.recordSelect(next);
  }

  recordOpenStage(kind, fieldKey = this.selectedKey, options = {}) {
    const target = recordCardTargetByKey(this.recordTargets(), fieldKey);
    if (!target) return false;
    this.selectedKey = fieldKey;
    const resolved = kind || target.stageKind;
    if (!resolved) {
      this.statusKind = "typed-stage";
      this.paintRecordCard();
      return false;
    }
    this.stage = { kind: resolved, field: fieldKey };
    this.choiceFilter = options.filter || "";
    this.selectedChoice = options.selectedChoice || (target.value != null ? String(target.value) : "");
    this.stageDraft = options.draft || "";
    this.menuOpen = false;
    this.paintRecordCard();
    return true;
  }

  recordCancelStage() {
    this.stage = null;
    this.choiceFilter = "";
    this.selectedChoice = "";
    this.stageDraft = "";
    this.stageCaret = null;
    this.paintRecordCard();
  }

  recordHandleEscape() {
    const action = recordCardEscLadder({
      pendingApply: this.pendingApply,
      menuOpen: this.menuOpen,
      stage: this.stage,
    });
    if (action === "ignore") return "ignore";
    if (action === "close-menu") {
      this.menuOpen = false;
      this.paintRecordCard();
      return "stay";
    }
    if (action === "cancel-stage") {
      this.recordCancelStage();
      return "stay";
    }
    return "close";
  }

  recordMarkEscapeHandled(event) {
    if (!event) return;
    try { event.preventDefault?.(); } catch (_) {}
    try { event.stopPropagation?.(); } catch (_) {}
    if (!event.defaultPrevented) {
      try { Object.defineProperty(event, "defaultPrevented", { value: true, configurable: true }); }
      catch (_) { try { event.defaultPrevented = true; } catch (_) {} }
    }
    try { event.__schemaEscapeHandled = true; } catch (_) {}
  }

  recordBackOut(event) {
    const action = this.recordHandleEscape();
    this.recordMarkEscapeHandled(event);
    if (action === "close") this.close();
    return action;
  }

  recordCloseKind(event) {
    try {
      if (typeof bobCardCloseKey === "function") return bobCardCloseKey(event);
    } catch (_) {}
    return event && event.key === "Escape" ? "escape" : null;
  }

  recordShouldBackOut(kind, event) {
    if (kind !== "q" && kind !== "ctrl-bracket" && kind !== "escape") return false;
    if (kind === "q") {
      try {
        if (typeof bobCardTypesText === "function"
            && bobCardTypesText(event, this.modalEl || this.contentEl)) return false;
      } catch (_) {}
      return true;
    }
    return true;
  }

  onEscapeKey(event) {
    this.recordBackOut(event);
    return false;
  }

  recordBare(event) {
    return event && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  recordInInput(event) {
    const target = event && event.target;
    return Boolean(target && target.closest && target.closest("input,select,textarea,[contenteditable]"));
  }

  recordAction(action, payload) {
    if (!action || this.closed) return;
    if (action === "close") { this.close(); return; }
    if (action === "more") {
      this.menuOpen = !this.menuOpen;
      this.paintRecordCard();
      return;
    }
    if (action === "close-menu") {
      this.menuOpen = false;
      this.paintRecordCard();
      return;
    }
    if (action === "cancel-stage") { this.recordCancelStage(); return; }
    if (action === "open-stage") {
      const target = this.recordSelected();
      if (target && target.stageKind) this.recordOpenStage(target.stageKind, target.key);
      else if (target) {
        this.statusKind = "typed-stage";
        this.paintRecordCard();
      }
      return;
    }
    if (action === "pick-choice" || action === "apply-choice") {
      void this.recordApplyChoice(payload && payload.value);
      return;
    }
    if (action === "today") { void this.recordApplyToday(); return; }
    if (action === "clear") { void this.recordClear(); return; }
    if (action === "undo") { void this.recordUndo(); return; }
    if (action === "yaml") { void this.recordYaml(); return; }
    if (action === "schema") { void this.recordSchema(); return; }
    if (action === "retry") { void this.recordRetry(); return; }
  }

  recordOnClick(event) {
    const button = event?.target?.closest?.("button[data-record-action], button[data-target-key]");
    if (!button) return;
    const action = button.getAttribute("data-record-action");
    if (action) {
      event.preventDefault?.();
      void this.recordAction(action, { value: button.getAttribute("data-choice-value") });
      return;
    }
    const key = button.getAttribute("data-target-key");
    if (key) this.recordSelect(key);
  }

  recordOnKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229 || this.composing) return;
    if (event.defaultPrevented || event.__schemaEscapeHandled) return;
    if (this.pendingApply) return;
    const closeKind = this.recordCloseKind(event);
    if (closeKind && this.recordShouldBackOut(closeKind, event)) {
      this.recordBackOut(event);
      return;
    }
    if (this.recordInInput(event)) {
      if (event.key === "Enter") {
        event.preventDefault?.();
        const target = this.recordSelected();
        if (this.stage && this.stage.kind === "choices") {
          void this.recordApplyChoice(this.selectedChoice || (target && target.value));
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault?.();
        this.recordMoveChoice(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault?.();
        this.recordMoveChoice(-1);
      }
      return;
    }
    if (this.stage && this.stage.kind === "choices") {
      if (event.key === "Enter") {
        event.preventDefault?.();
        void this.recordApplyChoice(this.selectedChoice);
        return;
      }
      if (event.key === "ArrowDown" || (this.recordBare(event) && event.key === "j")) {
        event.preventDefault?.();
        this.recordMoveChoice(1);
        return;
      }
      if (event.key === "ArrowUp" || (this.recordBare(event) && event.key === "k")) {
        event.preventDefault?.();
        this.recordMoveChoice(-1);
        return;
      }
      if (this.recordBare(event) && /^[1-9]$/.test(event.key || "")) {
        event.preventDefault?.();
        this.recordDigit(event.key, true);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault?.();
      this.recordMove(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Home") { event.preventDefault?.(); this.recordSelect(recordCardHomeEnd(this.recordTargets(), "home")); return; }
    if (event.key === "End") { event.preventDefault?.(); this.recordSelect(recordCardHomeEnd(this.recordTargets(), "end")); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowRight" || (this.recordBare(event) && event.key === "j")) {
      event.preventDefault?.(); this.recordMove(1); return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft" || (this.recordBare(event) && event.key === "k")) {
      event.preventDefault?.(); this.recordMove(-1); return;
    }
    if (event.key === "Enter") {
      event.preventDefault?.();
      this.recordAction("open-stage");
      return;
    }
    if (this.recordBare(event) && /^[1-9]$/.test(event.key || "")) {
      event.preventDefault?.();
      this.recordDigit(event.key, false);
      return;
    }
    if (this.recordBare(event) && (event.key === "t" || event.key === "T")) {
      event.preventDefault?.();
      void this.recordApplyToday();
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "d" || event.key === "D")) {
      event.preventDefault?.();
      void this.recordClear();
      return;
    }
    if ((this.recordBare(event) && event.key === "u")
        || (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "z" || event.key === "Z"))) {
      event.preventDefault?.();
      void this.recordUndo();
      return;
    }
    if ((this.recordBare(event) && (event.key === "y" || event.key === "Y"))
        || (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "e" || event.key === "E"))) {
      event.preventDefault?.();
      void this.recordYaml();
      return;
    }
    if (this.recordBare(event) && event.key === "=") {
      event.preventDefault?.();
      void this.recordSchema();
    }
  }

  recordMoveChoice(delta) {
    const target = this.recordSelected();
    const reportField = recordCardFieldFromReport(this.latestReport, target && target.key);
    const visible = recordCardFilterChoices(
      recordCardChoiceList(target && target.field, reportField),
      this.choiceFilter,
    );
    if (!visible.length) return;
    let index = visible.findIndex((choice) => choice.value === this.selectedChoice);
    if (index < 0) index = 0;
    index = (index + delta + visible.length) % visible.length;
    this.selectedChoice = visible[index].value;
    this.paintRecordCard();
  }

  recordDigit(digit, fromStage) {
    const target = this.recordSelected();
    if (!target || target.kind !== "choices") return;
    const reportField = recordCardFieldFromReport(this.latestReport, target.key);
    const all = recordCardChoiceList(target.field, reportField);
    const choice = recordCardChoiceByDigit(all, digit);
    if (!choice) return;
    if (fromStage) {
      const visible = recordCardFilterChoices(all, this.choiceFilter);
      if (!visible.some((item) => item.value === choice.value)) return;
    }
    void this.recordApplyChoice(choice.value);
  }

  recordOps(op) {
    return Array.isArray(op) ? op : [op];
  }

  async recordApplyOps(ops, options = {}) {
    if (this.closed || this.pendingApply) return null;
    if (!this.writable || !this.session) return null;
    this.pendingApply = true;
    this.statusKind = "saving";
    this.paintRecordCard();
    let result = null;
    try {
      result = await this.session.applyOps(this.recordOps(ops));
    } catch (error) {
      result = { ok: false, code: "failed", message: String((error && error.message) || error) };
    }
    if (this.closed) return result;
    this.pendingApply = false;
    this.sessionState = this.session?.getState?.() || this.sessionState;
    if (result && result.ok === true && result.changed === true) {
      this.ownWriteUntil = Date.now() + 1500;
      this.retainedOps = null;
      this.recordConsumeApplied(result);
      this.recordCancelStage();
      this.statusKind = "saved";
      this.announce = recordCardLiveAnnouncement("saved");
      this.paintRecordCard();
      return result;
    }
    if (result && result.ok === true) {
      this.retainedOps = null;
      this.recordCancelStage();
      this.statusKind = result.report && result.report.consequence ? "consequence" : "";
      this.consequence = (result.report && result.report.consequence) || "";
      this.paintRecordCard();
      return result;
    }
    const stale = Boolean(result && (
      result.kind === "stale" || result.code === "stale_record"
      || (result.report && result.report.error && result.report.error.code === "stale_record")
    ));
    if (stale) {
      this.retainedOps = this.recordOps(ops);
      this.statusKind = "stale";
      this.announce = recordCardLiveAnnouncement("stale");
      await this.recordRefresh({ keepStage: true });
      return result;
    }
    this.refusalMessage = (result && result.message) || "The record update was refused.";
    this.refusalHint = (result && result.hint) || "";
    this.statusKind = "refusal";
    this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
    this.paintRecordCard();
    return result;
  }

  recordConsumeApplied(result) {
    const report = result && result.report;
    if (!report) return;
    if (report.record) this.latestReport = { ...(this.latestReport || {}), record: report.record, ok: true };
    else if (Array.isArray(report.properties) && this.latestReport && this.latestReport.record) {
      this.latestReport = {
        ...this.latestReport,
        record: { ...this.latestReport.record, properties: report.properties, fingerprint: report.fingerprint_after },
      };
    }
    try {
      this.sheetModel = this.recordPlugin?.recordSheetModelFor?.(this.recordPath) || this.sheetModel;
    } catch (_) {}
    const targets = this.recordTargets();
    this.selectedKey = recordCardPreserveSelection(targets, this.selectedKey, this.selectedIndex);
    this.selectedIndex = Math.max(0, targets.findIndex((target) => target.key === this.selectedKey));
  }

  async recordApplyChoice(value) {
    const target = this.recordSelected();
    if (!target || !value) return null;
    return this.recordApplyOps({ op: "field.set", field: target.key, value: String(value) });
  }

  async recordApplyToday() {
    const target = this.recordSelected();
    if (!target || target.kind !== "date") return null;
    const today = recordCardTodayValue({
      today: this.recordPlugin?.recordSheetDay,
      now: new Date(),
    });
    if (!today) return null;
    return this.recordApplyOps({ op: "field.set", field: target.key, value: today });
  }

  async recordClear() {
    const target = this.recordSelected();
    if (!target) return null;
    if (target.required) {
      this.statusKind = "refusal";
      this.refusalMessage = recordCardRequiredClearMessage(target);
      this.refusalHint = "";
      this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      this.paintRecordCard();
      return { ok: false, code: "required" };
    }
    return this.recordApplyOps({ op: "field.unset", field: target.key });
  }

  async recordUndo() {
    if (!this.session) return null;
    if (this.pendingApply) return null;
    this.pendingApply = true;
    this.statusKind = "saving";
    this.paintRecordCard();
    let result = null;
    try { result = await this.session.undo(); }
    catch (error) { result = { ok: false, message: String((error && error.message) || error) }; }
    if (this.closed) return result;
    this.pendingApply = false;
    this.sessionState = this.session?.getState?.() || this.sessionState;
    if (result && result.ok === true && result.changed === true) {
      this.ownWriteUntil = Date.now() + 1500;
      this.recordConsumeApplied(result);
      this.statusKind = "saved";
    } else if (result && result.ok === true) {
      this.statusKind = "";
    } else {
      this.statusKind = "refusal";
      this.refusalMessage = (result && result.message) || "There is no record edit to undo.";
      this.refusalHint = (result && result.hint) || "";
    }
    this.paintRecordCard();
    return result;
  }

  async recordRetry() {
    if (!this.retainedOps) return this.recordRefresh({ keepStage: true });
    const ops = this.retainedOps;
    this.retainedOps = null;
    return this.recordApplyOps(ops, { retry: true });
  }

  async recordYaml() {
    const field = this.selectedKey;
    const plugin = this.recordPlugin;
    this.close();
    if (plugin && typeof plugin.recordCardStartYamlExcursion === "function") {
      return plugin.recordCardStartYamlExcursion({
        recordPath: this.recordPath,
        albumPath: this.albumPath,
        field,
        report: this.latestReport,
        target: recordCardTargetByKey(recordCardTargets(this.sheetModel, this.latestReport), field),
        broken: this.gate && this.gate.state === "broken",
        warningLine: this.sheetModel && this.sheetModel.warningLine,
      });
    }
    return null;
  }

  async recordSchema() {
    const plugin = this.recordPlugin;
    const path = this.recordPath;
    this.close();
    if (plugin && typeof plugin.openAlbumSchemaEntry === "function") {
      return plugin.openAlbumSchemaEntry({ filePath: path });
    }
    return null;
  }

  recordEnsureSession(fingerprint) {
    if (!this.writable || this.session || !fingerprint) return;
    const plugin = this.recordPlugin;
    const undo = plugin && typeof plugin.recordUpdateLastUndo === "function"
      ? plugin.recordUpdateLastUndo(this.recordPath)
      : null;
    const deps = typeof recordUpdateServiceDeps === "function"
      ? recordUpdateServiceDeps(plugin, {
        type: this.recordType,
        stem: this.recordStem,
        recordPath: this.recordPath,
        albumPath: this.albumPath,
        onChange: (snapshot) => {
          if (this.closed) return;
          this.sessionState = snapshot;
          if (this.statusKind === "saving" && this.pendingApply) return;
          this.paintRecordCard();
        },
      })
      : {};
    this.session = createRecordUpdateSession({
      recordPath: this.recordPath,
      albumPath: this.albumPath,
      type: this.recordType,
      stem: this.recordStem,
      expect: fingerprint,
      undo: undo && undo.inverseOps ? { inverseOps: undo.inverseOps, afterFingerprint: undo.afterFingerprint } : undo,
    }, deps);
    this.sessionState = this.session.getState?.() || null;
  }

  async recordRead() {
    if (this.closed) return null;
    if (!this.writable && !(this.capabilityOk && this.gate && this.gate.state === "ready")) return null;
    const seq = ++this.readSeq;
    const token = this.closeToken;
    const plugin = this.recordPlugin;
    let result = null;
    try {
      result = await plugin.apiRecordShow(this.recordType, this.recordStem);
    } catch (error) {
      result = { ok: false, code: "failed", message: String((error && error.message) || error) };
    }
    if (this.closed || token !== this.closeToken || seq !== this.readSeq) return result;
    const report = result && result.ok && result.report ? result.report : null;
    const record = report && report.ok !== false && recordCardShowRecord(report);
    if (!record || !record.fingerprint) {
      const model = typeof recordUpdateErrorModel === "function" ? recordUpdateErrorModel(result) : null;
      this.statusKind = "refusal";
      this.refusalMessage = (result && result.message) || (report && report.error && report.error.message) || "The record could not be read.";
      this.refusalHint = (result && result.hint) || (model && model.hint) || (report && report.error && report.error.hint) || "";
      this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      this.paintRecordCard();
      return result;
    }
    this.latestReport = report;
    if (this.writable) this.recordEnsureSession(record.fingerprint);
    else if (this.session) {
      this.session.rebase?.(record.fingerprint);
    }
    if (this.statusKind === "reading" || this.statusKind === "stale") {
      if (this.statusKind !== "stale") this.statusKind = this.writable ? "" : (this.capabilityOk ? "" : "capability");
    }
    this.paintRecordCard();
    return result;
  }

  async recordRefresh(options = {}) {
    if (this.closed) return;
    try {
      this.gate = this.recordPlugin?.recordSheetGateFor?.(this.recordPath) || this.gate;
      this.sheetModel = this.recordPlugin?.recordSheetModelFor?.(this.recordPath) || this.sheetModel;
    } catch (_) {}
    const stillMount = Boolean(this.gate && this.gate.mount);
    if (!stillMount) {
      this.close();
      return;
    }
    this.writable = recordCardWritable(this.gate);
    this.capabilityOk = Boolean(this.gate && this.gate.capabilityOk);
    this.warning = (this.sheetModel && this.sheetModel.warning) || this.warning;
    const captured = options.keepStage ? recordCardCaptureStage({
      stage: this.stage, choiceFilter: this.choiceFilter, selectedChoice: this.selectedChoice,
      stageDraft: this.stageDraft, stageCaret: this.stageCaret,
    }) : null;
    const targets = this.recordTargets();
    this.selectedKey = recordCardPreserveSelection(targets, this.selectedKey, this.selectedIndex);
    this.selectedIndex = Math.max(0, targets.findIndex((target) => target.key === this.selectedKey));
    const restored = recordCardRestoreStage(captured, targets);
    if (restored) {
      this.stage = { kind: restored.kind, field: restored.field };
      this.choiceFilter = restored.filter || "";
      this.selectedChoice = restored.selectedChoice || "";
      this.stageDraft = restored.draft || "";
    } else if (!options.keepStage) {
      this.stage = null;
    }
    this.paintRecordCard();
    await this.recordRead();
    if (this.session && this.latestReport && recordCardShowRecord(this.latestReport)) {
      this.session.rebase?.(recordCardShowRecord(this.latestReport).fingerprint);
      this.sessionState = this.session.getState?.() || this.sessionState;
    }
  }

  recordScheduleRefresh() {
    if (this.closed) return;
    if (this.ownWriteUntil && Date.now() < this.ownWriteUntil) return;
    try { this.recordPlugin?.albumClearTimeout?.(this.refreshTimer); } catch (_) {}
    this.refreshTimer = this.recordPlugin?.albumSetTimeout?.(() => {
      void this.recordRefresh({ keepStage: true });
    }, 40) || setTimeout(() => { void this.recordRefresh({ keepStage: true }); }, 40);
  }

  onOpen() {
    try {
      this.modalEl?.addClass?.("bob-record-card-modal");
      this.modalEl?.setAttribute?.("role", "dialog");
      this.modalEl?.setAttribute?.("aria-modal", "true");
      this.modalEl?.setAttribute?.("aria-label", "Edit record");
      this.contentEl?.addClass?.("bob-record-card");
      this.contentEl?.addClass?.("bob-key-card");
    } catch (_) {}
    this.paintRecordCard();
    this.recordClickListener = (event) => this.recordOnClick(event);
    this.recordKeyListener = (event) => this.recordOnKeyDown(event);
    this.recordInputListener = (event) => {
      const input = event?.target?.closest?.("[data-record-input='choice-filter']");
      if (!input) return;
      this.choiceFilter = String(input.value || "");
      if (typeof input.selectionStart === "number") {
        this.stageCaret = { start: input.selectionStart, end: input.selectionEnd };
      }
      this.paintRecordCard();
    };
    this.contentEl?.addEventListener?.("click", this.recordClickListener);
    this.contentEl?.addEventListener?.("keydown", this.recordKeyListener);
    this.contentEl?.addEventListener?.("input", this.recordInputListener);
    this.contentEl?.addEventListener?.("compositionstart", () => { this.composing = true; });
    this.contentEl?.addEventListener?.("compositionend", () => { this.composing = false; });
    try {
      if (typeof bobCardWireCloseKeys === "function") {
        bobCardWireCloseKeys(this, { backOut: (event) => this.recordBackOut(event) });
      }
    } catch (_) {}
    try {
      const root = this.modalEl?.ownerDocument || this.contentEl?.ownerDocument;
      this.recordDomKeyListener = (event) => {
        if (this.closed || event?.__schemaEscapeHandled) return;
        const kind = this.recordCloseKind(event);
        if (kind && this.recordShouldBackOut(kind, event)) this.recordBackOut(event);
      };
      root?.addEventListener?.("keydown", this.recordDomKeyListener, true);
      this.recordDomKeyRoot = root;
    } catch (_) {}
    try {
      this.unsubscribeAlbum = this.recordPlugin?.apiAlbumSubscribe?.(() => this.recordScheduleRefresh()) || null;
    } catch (_) {}
    try {
      const cache = this.recordPlugin?.app?.metadataCache;
      if (cache && typeof cache.on === "function") {
        this.unsubscribeVault = cache.on("changed", (file) => {
          const path = recordCardPath(file && file.path);
          if (path === this.recordPath || path === this.albumPath) this.recordScheduleRefresh();
        });
        if (this.recordPlugin && typeof this.recordPlugin.registerEvent === "function" && this.unsubscribeVault) {
          this.recordPlugin.registerEvent(this.unsubscribeVault);
        }
      }
    } catch (_) {}
    if (this.requestedStage) this.recordOpenStage(this.requestedStage, this.selectedKey);
    void this.recordRead();
  }

  onClose() {
    this.closed = true;
    this.closeToken += 1;
    this.pendingApply = false;
    try { if (typeof bobCardUnwireCloseKeys === "function") bobCardUnwireCloseKeys(this); } catch (_) {}
    try { this.recordDomKeyRoot?.removeEventListener?.("keydown", this.recordDomKeyListener, true); } catch (_) {}
    try { this.unsubscribeAlbum?.(); } catch (_) {}
    this.unsubscribeAlbum = null;
    try { this.recordPlugin?.albumClearTimeout?.(this.refreshTimer); } catch (_) {}
    this.refreshTimer = null;
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
    try { this.contentEl?.empty?.(); } catch (_) {}
    if (this.recordPlugin && this.recordPlugin.recordCardModal === this) {
      this.recordPlugin.recordCardModal = null;
    }
  }
}
