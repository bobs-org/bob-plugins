// Record Card typed preview/save/Tab and refresh: settlement, preview sync, save-and-advance, retry, and lifecycle.
Object.assign(RecordCardModal.prototype, {
  async recordListPickValue(value, scalarKind) {
    if (!this.stage) return null;
    this.stageList = [...(this.stageList || []), String(value)];
    this.stageItemDraft = "";
    return this.recordTypedInput();
  }
,
  async recordPickSuggest(value) {
    if (!value) return null;
    const target = this.stage ? recordCardTargetByKey(this.recordTargets(), this.stage.field) : this.recordSelected();
    if (!target) return null;
    if (this.stage && this.stage.kind === "list") {
      return this.recordListPickValue(String(value), "suggest");
    }
    const reportField = recordCardFieldFromReport(this.latestReport, target.key);
    const values = typeof recordCardSuggestValues === "function"
      ? recordCardSuggestValues(reportField, target.field) : [];
    const exact = typeof recordCardSuggestByValue === "function"
      ? recordCardSuggestByValue(values, String(value)) : null;
    if (exact && this.stage) {
      return this.recordApplyOps({ op: "field.set", field: target.key, value: String(exact.value) });
    }
    this.stageDraftText = String(value);
    return this.recordTypedInput();
  }
,
  async recordSettleApplyResult(result, ops, pending = this.pendingTab) {
    if (this.closed) return result;
    this.sessionState = this.session?.getState?.() || this.sessionState;
    if (result && result.ok === true && result.changed === true) {
      this.ownWriteUntil = Date.now() + 1500;
      this.retainedOps = null;
      this.recordConsumeApplied(result);
      this.recordInvalidatePendingTab();
      if (pending && (pending.direction === 1 || pending.direction === -1)) {
        const nextKey = recordCardNavigate(this.recordTargets(), pending.field, pending.direction);
        this.statusKind = "saved";
        this.announce = recordCardLiveAnnouncement("saved");
        if (nextKey) {
          const nextTarget = recordCardTargetByKey(this.recordTargets(), nextKey);
          this.selectedKey = nextKey;
          this.selectedIndex = Math.max(0, this.recordTargets().findIndex((row) => row.key === nextKey));
          if (nextTarget && nextTarget.stageKind) {
            this.stage = { kind: nextTarget.stageKind, field: nextKey };
            const seed = typeof recordCardSeedStage === "function" ? recordCardSeedStage(nextTarget) : { text: "" };
            if (nextTarget.stageKind === "list") {
              this.stageList = (seed.list || []).slice();
              this.stageItemDraft = "";
              this.stageDraftText = "";
            } else if (nextTarget.stageKind === "choices") {
              this.selectedChoice = nextTarget.value != null ? String(nextTarget.value) : "";
              this.choiceFilter = "";
              this.stageDraftText = "";
              this.stageList = [];
              this.stageItemDraft = "";
            } else {
              this.stageDraftText = String(seed.text || "");
              this.stageList = [];
              this.stageItemDraft = "";
            }
            this.stagePreview = null;
            this.stageNote = "";
            this.stageCaret = null;
            if (this.session) { try { this.session.setDraft([]); } catch (_) {} }
            this.statusKind = "saved";
          } else {
            this.stage = null;
      this.stageNote = "";
          }
        } else {
          this.stage = null;
      this.stageNote = "";
        }
        this.paintRecordCard();
        return result;
      }
      const wasTyped = Boolean(this.stage && this.stage.kind !== "choices");
      if (wasTyped) {
        this.stage = null;
      this.stageNote = "";
        this.stageDraftText = "";
        this.stageList = [];
        this.stageItemDraft = "";
        this.stagePreview = null;
      } else {
        this.recordCancelStageSilent();
      }
      this.statusKind = "saved";
      this.announce = recordCardLiveAnnouncement("saved");
      this.paintRecordCard();
      return result;
    }
    if (result && result.ok === true) {
      this.retainedOps = null;
      this.recordInvalidatePendingTab();
      if (pending && (pending.direction === 1 || pending.direction === -1)) {
        const nextKey = recordCardNavigate(this.recordTargets(), pending.field, pending.direction);
        if (nextKey) {
          const nextTarget = recordCardTargetByKey(this.recordTargets(), nextKey);
          if (nextTarget && nextTarget.stageKind) {
            this.selectedKey = nextKey;
            this.selectedIndex = Math.max(0, this.recordTargets().findIndex((row) => row.key === nextKey));
            this.recordOpenStage(nextTarget.stageKind, nextKey);
            this.statusKind = result.report && result.report.consequence ? "consequence" : "";
            this.consequence = (result.report && result.report.consequence) || "";
            this.paintRecordCard();
            return result;
          }
        }
        this.stage = null;
      this.stageNote = "";
        this.statusKind = result.report && result.report.consequence ? "consequence" : "";
        this.consequence = (result.report && result.report.consequence) || "";
        this.paintRecordCard();
        return result;
      }
      if (this.stage && this.stage.kind !== "choices") {
        this.stage = null;
      this.stageNote = "";
        this.stageDraftText = "";
        this.stageList = [];
        this.stageItemDraft = "";
        this.stagePreview = null;
      } else {
        this.recordCancelStageSilent();
      }
      this.statusKind = result.report && result.report.consequence ? "consequence" : "";
      this.consequence = (result.report && result.report.consequence) || "";
      this.paintRecordCard();
      return result;
    }
    const stale = Boolean(result && (
      result.kind === "stale" || result.code === "stale_record"
      || (result.report && result.error && result.report.error.code === "stale_record")
      || (result.report && result.report.error && result.report.error.code === "stale_record")
      || (result.code === "stale_generation" || result.code === "stale")
    ));
    if (stale) {
      this.retainedOps = this.recordOps(ops);
      this.recordInvalidatePendingTab();
      this.statusKind = "stale";
      this.announce = recordCardLiveAnnouncement("stale");
      this.stageEnterSeq += 1;
      await this.recordRefresh({ keepStage: true });
      return result;
    }
    this.recordInvalidatePendingTab();
    this.refusalMessage = (result && (result.message || (result.report && result.report.error && result.report.error.message))) || "The record update was refused.";
    this.refusalHint = (result && (result.hint || (result.report && result.report.error && result.report.error.hint))) || "";
    this.statusKind = "refusal";
    this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
    this.stageEnterSeq += 1;
    this.paintRecordCard();
    return result;
  }
,
  recordCancelStageSilent() {
    this.stage = null;
      this.stageNote = "";
    this.choiceFilter = "";
    this.choiceDigitPrefix = "";
    this.selectedChoice = "";
    this.stageDraft = "";
    this.stageCaret = null;
    this.stageDraftText = "";
    this.stageList = [];
    this.stageItemDraft = "";
    this.stagePreview = null;
    this.stageNote = "";
    this.stageEnterSeq = 0;
    this.recordInvalidatePendingTab();
    if (this.session && !this.closed) {
      try { this.session.setDraft([]); } catch (_) {}
      try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
    }
  }
,
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
    return this.recordSettleApplyResult(result, ops);
  }
,
  recordTypedInput() {
    if (this.closed || !this.stage || !this.writable || !this.session) {
      this.paintRecordCard();
      return null;
    }
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    if (!target) {
      this.statusKind = "refusal";
      this.refusalMessage = "That field is no longer in the schema — your draft is kept.";
      this.refusalHint = "";
      this.paintRecordCard();
      return null;
    }
    this.recordInvalidatePendingTabOnEdit();
    if (this.statusKind === "stale") {
      this.retainedOps = this.recordTypedOpsForRetry();
      this.paintRecordCard();
      return null;
    }
    if (!this.recordTypedChanged(target)) {
      try { this.session.setDraft([]); } catch (_) {}
      this.sessionState = this.session.getState?.() || this.sessionState;
      this.stagePreview = null;
      if (this.statusKind === "refusal" || this.statusKind === "consequence" || this.statusKind === "previewing") {
        this.statusKind = "";
        this.refusalMessage = "";
        this.refusalHint = "";
        this.consequence = "";
      }
      this.paintRecordCard();
      return null;
    }
    let built = null;
    try {
      built = typeof recordCardBuildOps === "function"
        ? recordCardBuildOps(target, this.recordTypedDraftFor(target))
        : null;
    } catch (error) {
      built = { ok: false, message: String((error && error.message) || error) };
    }
    if (!built || built.ok !== true) {
      try { this.session.setDraft([]); } catch (_) {}
      this.statusKind = "refusal";
      this.refusalMessage = (built && built.message) || "That value is required.";
      this.refusalHint = (built && built.hint) || "";
      this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      this.stagePreview = null;
      this.paintRecordCard();
      return built;
    }
    try { this.session.setDraft(built.ops); } catch (_) {}
    try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
    this.recordSyncSessionPreview();
    return built;
  }
,
  recordInvalidatePendingTabOnEdit() {
    this.pendingTab = null;
  }
,
  recordSyncSessionPreview() {
    if (this.closed || !this.session) return;
    try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
    const snapshot = this.sessionState;
    if (!snapshot || !this.stage) {
      this.paintRecordCard();
      return;
    }
    // Rebasing cancels the old preview; it does not acknowledge a stale draft.
    // Keep the warning through session notifications until the user retries.
    if (this.statusKind === "stale") {
      this.paintRecordCard();
      return;
    }
    const status = String(snapshot.status || "");
    if (status === "preview-pending" || status === "applying" || snapshot.busy === true) {
      const kind = this.pendingApply || status === "applying" ? "saving" : "previewing";
      if (this.statusKind !== kind) {
        this.statusKind = kind;
        this.paintRecordCard();
      }
      return;
    }
    if (status === "preview-ready" && snapshot.canApply) {
      const report = snapshot.preview;
      this.stagePreview = report || snapshot.preview || null;
      const consequence = String(snapshot.consequence || (report && report.consequence) || "");
      const warnings = (report && report.warnings) || (snapshot.preview && snapshot.preview.warnings) || [];
      this.consequence = consequence;
      this.refusalMessage = "";
      this.refusalHint = "";
      this.statusKind = consequence ? "consequence" : "";
      this.stagePreview = { consequence, warnings: Array.isArray(warnings) ? warnings : [] };
      const pending = this.pendingTab;
      if (pending && pending.enterSeq === this.stageEnterSeq && pending.field === (this.stage && this.stage.field)) {
        const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
        const draftIdentity = JSON.stringify(this.recordTypedDraftFor(target));
        if (pending.draftIdentity === draftIdentity) {
          const latched = pending;
          this.pendingTab = null;
          void this.recordApplyTyped(latched);
        }
      }
      this.paintRecordCard();
      return;
    }
    if (status === "refused" && snapshot.refusal) {
      const refusal = snapshot.refusal;
      if (refusal.kind === "stale" || refusal.code === "stale_record" || refusal.code === "stale_generation") {
        this.statusKind = "stale";
        this.announce = recordCardLiveAnnouncement("stale");
        this.stageEnterSeq += 1;
        this.recordInvalidatePendingTab();
        this.retainedOps = this.recordTypedOpsForRetry();
        void this.recordRefresh({ keepStage: true });
        return;
      }
      this.statusKind = "refusal";
      this.refusalMessage = String(refusal.message || "The record preview was refused.");
      this.refusalHint = String(refusal.hint || "");
      this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      this.stagePreview = null;
      this.stageEnterSeq += 1;
      this.recordInvalidatePendingTab();
      this.paintRecordCard();
      return;
    }
    this.paintRecordCard();
  }
,
  recordTypedOpsForRetry() {
    if (!this.stage) return null;
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    if (!target) return null;
    try {
      const built = typeof recordCardBuildOps === "function"
        ? recordCardBuildOps(target, this.recordTypedDraftFor(target)) : null;
      if (built && built.ok === true) return built.ops;
    } catch (_) {}
    return null;
  }
,
  async recordSaveTyped(direction) {
    if (this.closed || this.pendingApply) return null;
    if (!this.stage) return null;
    if (!this.writable || !this.session) return null;
    if (this.statusKind === "stale") return this.recordRetry();
    if (this.stage.kind === "choices") {
      return this.recordApplyChoice(this.selectedChoice);
    }
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    if (!target) return null;
    if (typeof recordCardBuildOps === "function") {
      let built = null;
      try { built = recordCardBuildOps(target, this.recordTypedDraftFor(target)); } catch (error) {
        built = { ok: false, message: String((error && error.message) || error) };
      }
      if (!built || built.ok !== true) {
        try { this.session.setDraft([]); } catch (_) {}
        this.statusKind = "refusal";
        this.refusalMessage = (built && built.message) || "That value is required.";
        this.refusalHint = (built && built.hint) || "";
        this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
        this.paintRecordCard();
        return built;
      }
    }
    if (!this.recordTypedChanged(target)) {
      if (direction === 1 || direction === -1) {
        const nextKey = recordCardNavigate(this.recordTargets(), this.stage.field, direction);
        if (nextKey) {
          const nextTarget = recordCardTargetByKey(this.recordTargets(), nextKey);
          this.selectedKey = nextKey;
          this.selectedIndex = Math.max(0, this.recordTargets().findIndex((row) => row.key === nextKey));
          if (nextTarget && nextTarget.stageKind) this.recordOpenStage(nextTarget.stageKind, nextKey);
          else this.recordSelect(nextKey);
        }
      }
      return { ok: true, changed: false, noOp: true };
    }
    if (direction === 1 || direction === -1) {
      this.pendingTab = {
        direction,
        field: this.stage.field,
        kind: this.stage.kind,
        draftIdentity: JSON.stringify(this.recordTypedDraftFor(target)),
        enterSeq: this.stageEnterSeq,
      };
    } else {
      this.recordInvalidatePendingTab();
    }
    try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
    const snapshot = this.sessionState;
    // Enter/Tab can arrive after validation has already finished. There is no
    // pending preview to settle then; retain its refusal and cancel navigation.
    if (snapshot && snapshot.status === "refused" && snapshot.refusal) {
      this.recordSyncSessionPreview();
      return snapshot.refusal;
    }
    if (snapshot && snapshot.canApply && String(snapshot.status || "") === "preview-ready") {
      const draftIdentity = JSON.stringify(this.recordTypedDraftFor(target));
      const previewOps = Array.isArray(snapshot.draftOps) ? snapshot.draftOps : [];
      let builtOps = null;
      try {
        const built = typeof recordCardBuildOps === "function"
          ? recordCardBuildOps(target, this.recordTypedDraftFor(target)) : null;
        if (built && built.ok === true) builtOps = built.ops;
      } catch (_) {}
      const matches = builtOps && JSON.stringify(previewOps) === JSON.stringify(builtOps);
      if (matches) {
        const latched = this.pendingTab && (direction === 1 || direction === -1) ? this.pendingTab : null;
        if (!latched) {
          return this.recordApplyTyped(null);
        }
        this.pendingTab = null;
        return this.recordApplyTyped(latched);
      }
    }
    this.statusKind = "previewing";
    this.paintRecordCard();
    return { ok: false, code: "preview-pending", message: "Waiting for a current preview before saving." };
  }
,
  async recordApplyTyped(latched) {
    if (this.closed || this.pendingApply) return null;
    if (!this.stage || !this.session) return null;
    const seqAtCall = this.stageEnterSeq;
    this.pendingApply = true;
    this.statusKind = "saving";
    this.paintRecordCard();
    let result = null;
    try {
      result = await this.session.apply();
    } catch (error) {
      result = { ok: false, code: "failed", message: String((error && error.message) || error) };
    }
    if (this.closed) return result;
    if (seqAtCall !== this.stageEnterSeq && !(latched && latched.direction)) {
      this.pendingApply = false;
      return result;
    }
    this.pendingApply = false;
    const ops = this.recordTypedOpsForRetry();
    // The preview handoff consumes pendingTab before applying. Carry that
    // specific save's navigation through settlement instead of reading it back.
    return this.recordSettleApplyResult(result, ops || [], latched);
  }
,
  async recordTab(direction) {
    if (this.closed) return null;
    if (!this.stage) {
      this.recordMove(direction);
      return { ok: true, moved: true };
    }
    if (this.stage.kind === "choices") {
      const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
      if (target && this.selectedChoice && String(this.selectedChoice) !== String(target.value || "")) {
        this.pendingTab = { direction, field: this.stage.field, kind: "choices", draftIdentity: String(this.selectedChoice), enterSeq: this.stageEnterSeq };
        return this.recordApplyChoice(this.selectedChoice);
      }
      const nextKey = recordCardNavigate(this.recordTargets(), this.stage.field, direction);
      if (nextKey) {
        const nextTarget = recordCardTargetByKey(this.recordTargets(), nextKey);
        if (nextTarget && nextTarget.stageKind) this.recordOpenStage(nextTarget.stageKind, nextKey);
        else this.recordSelect(nextKey);
      }
      return { ok: true, moved: true };
    }
    return this.recordSaveTyped(direction);
  }
,
  async recordRetry() {
    if (this.stage && this.stage.kind !== "choices") {
      const ops = this.recordTypedOpsForRetry();
      this.retainedOps = null;
      this.statusKind = "";
      if (!ops) return this.recordTypedInput();
      if (this.session && this.writable) {
        this.statusKind = "previewing";
        try { this.session.setDraft(ops); } catch (_) {}
        try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
        this.recordSyncSessionPreview();
        try {
          const snap = this.session.getState?.() || null;
          if (snap && snap.canApply) return this.recordApplyTyped(null);
        } catch (_) {}
        return { ok: false, code: "preview-pending" };
      }
      return this.recordRefresh({ keepStage: true });
    }
    if (!this.retainedOps) return this.recordRefresh({ keepStage: true });
    const ops = this.retainedOps;
    this.retainedOps = null;
    return this.recordApplyOps(ops, { retry: true });
  }
,
  async recordSchema() {
    const plugin = this.recordPlugin;
    const path = this.recordPath;
    const field = this.selectedKey || (this.stage && this.stage.field) || "";
    this.close();
    if (plugin && typeof plugin.openAlbumSchemaEntry === "function") {
      return plugin.openAlbumSchemaEntry({ filePath: path, field });
    }
    return null;
  }
,
  recordEnsureSession(fingerprint) {
    if (!this.writable || this.session || !fingerprint) return;
    const plugin = this.recordPlugin;
    const undo = plugin && typeof plugin.recordUpdateLastUndo === "function"
      ? plugin.recordUpdateLastUndo(this.recordPath)
      : null;
    const self = this;
    const deps = typeof recordUpdateServiceDeps === "function"
      ? recordUpdateServiceDeps(plugin, {
        type: this.recordType,
        stem: this.recordStem,
        recordPath: this.recordPath,
        albumPath: this.albumPath,
        onChange: (snapshot) => {
          if (self.closed) return;
          self.sessionState = snapshot;
          if (self.statusKind === "saving" && self.pendingApply) return;
          if (self.stage && self.stage.kind !== "choices") {
            self.recordSyncSessionPreview();
            return;
          }
          self.paintRecordCard();
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
,
  async recordRefresh(options = {}) {
    if (this.closed || this.pendingApply) return;
    if (this.session && options.keepStage !== true) {
      try { this.session.setDraft([]); } catch (_) {}
    }
    if (options.keepStage !== true) this.recordInvalidatePendingTab();
    try {
      this.gate = this.recordPlugin?.recordSheetGateFor?.(this.recordPath) || this.gate;
      this.sheetModel = this.recordPlugin?.recordSheetModelFor?.(this.recordPath) || this.sheetModel;
    } catch (_) {}
    const stillMount = Boolean(this.gate && this.gate.mount);
    if (!stillMount) {
      this.close();
      return;
    }
    const wasWritable = this.writable;
    this.writable = recordCardWritable(this.gate);
    this.capabilityOk = Boolean(this.gate && this.gate.capabilityOk);
    this.warning = (this.sheetModel && this.sheetModel.warning) || this.warning;
    if (!this.writable && wasWritable && this.stage) {
      this.recordInvalidatePendingTab();
      this.stagePreview = null;
      this.stageEnterSeq += 1;
      this.statusKind = this.gate && this.gate.state === "broken" ? "broken" : "capability";
      this.paintRecordCard();
      await this.recordRead();
      return;
    }
    const captured = options.keepStage ? {
      kind: this.stage && this.stage.kind,
      field: this.stage && this.stage.field,
      filter: this.choiceFilter,
      selectedChoice: this.selectedChoice,
      draft: this.stageDraft,
      caret: this.stageCaret,
      text: this.stageDraftText,
      list: Array.isArray(this.stageList) ? this.stageList.slice() : [],
      itemDraft: this.stageItemDraft,
    } : null;
    const targets = this.recordTargets();
    this.selectedKey = recordCardPreserveSelection(targets, this.selectedKey, this.selectedIndex);
    this.selectedIndex = Math.max(0, targets.findIndex((target) => target.key === this.selectedKey));
    let restored = null;
    if (captured && captured.field) {
      const stillThere = targets.some((target) => target.key === captured.field);
      if (!stillThere) {
        this.recordInvalidatePendingTab();
        this.stage = null;
      this.stageNote = "";
        this.stageDraftText = "";
        this.stageList = [];
        this.stageItemDraft = "";
        this.stagePreview = null;
        this.statusKind = "refusal";
        this.refusalMessage = "That field is no longer in the schema — your draft is kept.";
        this.refusalHint = "Pick another field; nothing was written.";
        this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      } else {
        const nextTarget = targets.find((target) => target.key === captured.field);
        if (nextTarget && captured.kind && nextTarget.stageKind !== captured.kind) {
          this.recordInvalidatePendingTab();
          this.stage = null;
      this.stageNote = "";
          this.stageDraftText = "";
          this.stageList = [];
          this.stageItemDraft = "";
          this.stagePreview = null;
          this.statusKind = "refusal";
          this.refusalMessage = "That field changed kind — your draft is kept.";
          this.refusalHint = "Reopen the field; nothing was written.";
        } else {
          this.stage = captured.kind ? { kind: captured.kind, field: captured.field } : null;
          this.choiceFilter = captured.filter || "";
          this.selectedChoice = captured.selectedChoice || "";
          this.stageDraft = captured.draft || "";
          this.stageDraftText = captured.text || "";
          this.stageList = Array.isArray(captured.list) ? captured.list.slice() : [];
          this.stageItemDraft = captured.itemDraft || "";
          this.stageCaret = captured.caret || null;
        }
        restored = { kind: captured.kind, field: captured.field };
      }
    } else if (!options.keepStage) {
      this.stage = null;
      this.stageNote = "";
      this.stageDraftText = "";
      this.stageList = [];
      this.stageItemDraft = "";
      this.stagePreview = null;
    }
    this.paintRecordCard();
    await this.recordRead();
    if (this.session && this.latestReport && recordCardShowRecord(this.latestReport)) {
      const fingerprint = recordCardShowRecord(this.latestReport).fingerprint;
      const snapshot = this.session.getState?.();
      const changed = snapshot && snapshot.expect !== fingerprint;
      // Read against the old targets to detect a draft even when the external
      // edit changed that very field to the same value as the user's draft.
      const previousTarget = this.stage && targets.find(target => target.key === this.stage.field);
      if (changed && options.keepStage && previousTarget && this.recordTypedChanged(previousTarget)) {
        this.retainedOps = this.recordTypedOpsForRetry();
        this.statusKind = "stale";
        this.announce = recordCardLiveAnnouncement("stale");
        this.stagePreview = null;
        this.stageEnterSeq += 1;
      }
      // An unchanged report must not invalidate a ready preview or queue it again.
      if (changed || this.statusKind === "stale") {
        this.recordInvalidatePendingTab();
        try { this.session.rebase?.(fingerprint); } catch (_) {}
      }
      try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
      this.paintRecordCard();
    }
  }
,
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
      const input = event?.target?.closest?.("[data-record-input]");
      if (!input) return;
      const kind = input.getAttribute?.("data-record-input") || "";
      if (kind === "choice-filter") {
        this.choiceFilter = String(input.value || "");
        this.choiceDigitPrefix = "";
        if (this.stage && this.stage.kind === "choices") {
          const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
          const reportField = recordCardFieldFromReport(this.latestReport, target && target.key);
          const visible = recordCardFilterChoices(
            recordCardChoiceList(target && target.field, reportField),
            this.choiceFilter,
          );
          if (!visible.some((choice) => choice.value === this.selectedChoice)) {
            this.selectedChoice = visible[0] ? visible[0].value : "";
          }
          if (this.statusKind === "refusal") {
            this.statusKind = this.writable ? "" : this.statusKind;
            this.refusalMessage = "";
            this.refusalHint = "";
          }
        }
        if (typeof input.selectionStart === "number") {
          this.stageCaret = { start: input.selectionStart, end: input.selectionEnd };
        }
        this.recordInvalidatePendingTab();
        this.paintRecordCard();
        return;
      }
      if (kind === "stage-text" || kind === "stage-suggest" || kind === "stage-date"
        || kind === "stage-number" || kind === "stage-url" || kind === "stage-link") {
        if (this.composing || (event && event.isComposing)) return;
        this.stageDraftText = String(input.value || "");
        if (typeof input.selectionStart === "number") {
          this.stageCaret = { start: input.selectionStart, end: input.selectionEnd };
        }
        void this.recordTypedInput();
        return;
      }
      if (kind === "stage-list-item") {
        if (this.composing || (event && event.isComposing)) return;
        this.stageItemDraft = String(input.value || "");
        if (typeof input.selectionStart === "number") {
          this.stageCaret = { start: input.selectionStart, end: input.selectionEnd };
        }
        this.recordInvalidatePendingTab();
        this.recordTypedInput();
        return;
      }
    };
    this.contentEl?.addEventListener?.("click", this.recordClickListener);
    this.contentEl?.addEventListener?.("keydown", this.recordKeyListener);
    this.contentEl?.addEventListener?.("input", this.recordInputListener);
    this.contentEl?.addEventListener?.("compositionstart", () => {
      this.composing = true;
      this.recordInvalidatePendingTab();
    });
    this.contentEl?.addEventListener?.("compositionend", (event) => {
      this.composing = false;
      const input = event?.target?.closest?.("[data-record-input]");
      if (input) {
        const kind = input.getAttribute?.("data-record-input") || "";
        if (kind.startsWith("stage-")) {
          if (kind === "stage-list-item") this.stageItemDraft = String(input.value || "");
          else this.stageDraftText = String(input.value || "");
          void this.recordTypedInput();
        }
      }
    });
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
,
  onClose() {
    this.closed = true;
    this.closeToken += 1;
    this.pendingApply = false;
    this.pendingTab = null;
    this.stageEnterSeq += 1;
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
});
