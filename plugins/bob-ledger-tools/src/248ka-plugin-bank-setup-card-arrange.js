// Bank setup arrangement controller: local projection, gestures, and the
// one-envelope save pipeline. Moves no longer open confirm stages; bob
// still owns the only write through the guarded config session.
Object.assign(BankSetupCardModal.prototype, {
  bankArrangeScopes() {
    const model = this.model || bankSetupCardModel(this.report, this.selection);
    return typeof bankSetupCardArrangeScopes === "function" ? bankSetupCardArrangeScopes(model) : {};
  },

  bankArrangeFixed() {
    const model = this.model || bankSetupCardModel(this.report, this.selection);
    return typeof bankSetupCardArrangeFixed === "function" ? bankSetupCardArrangeFixed(model) : {};
  },

  bankArrangeFingerprint() {
    return typeof bankConfigFingerprintFromReport === "function"
      ? String(bankConfigFingerprintFromReport(this.report) || "")
      : String(this.report?.fingerprint || this.report?.config_fingerprint || "");
  },

  bankEnsureArrangement() {
    try {
      const fingerprint = this.bankArrangeFingerprint();
      const scopes = this.bankArrangeScopes();
      const fixed = this.bankArrangeFixed();
      if (!this.bankArrangement || this.bankArrangeBaseFingerprint !== fingerprint) {
        this.bankArrangement = typeof createArrangement === "function"
          ? createArrangement({ scopes, fixed })
          : null;
        this.bankArrangeBaseFingerprint = fingerprint;
        this.bankHintMode = null;
        this.bankArrangeConfirm = false;
      } else {
        const current = typeof this.bankArrangement.scopeIds === "function"
          ? this.bankArrangement.scopeIds() : [];
        const wanted = Object.keys(scopes);
        const same = current.length === wanted.length && wanted.every((key) => current.includes(key));
        if (!same) {
          this.bankArrangement = typeof createArrangement === "function"
            ? createArrangement({ scopes, fixed })
            : null;
          this.bankHintMode = null;
          this.bankArrangeConfirm = false;
        }
      }
    } catch (_) {
      this.bankArrangement = null;
    }
    return this.bankArrangement;
  },

  bankArrangeDirty() {
    try {
      this.bankEnsureArrangement();
      return Boolean(this.bankArrangement?.dirty?.());
    } catch (_) {
      return false;
    }
  },

  bankArrangeSelectedScope() {
    try {
      const item = this.selectedItem();
      if (!item) return null;
      if (item.type === "group" && item.hidden !== true && item.group) {
        return { scope: "groups", id: String(item.group) };
      }
      if (item.type === "category" && item.entry?.hidden !== true && item.key) {
        const group = String(item.entry?.group || item.group || "");
        if (!group) return null;
        return { scope: `group:${group}`, id: String(item.key) };
      }
      if (item.type === "rule" && item.id) {
        return { scope: "rules", id: String(item.id) };
      }
      return null;
    } catch (_) {
      return null;
    }
  },

  bankArrangeFlashPending() {
    try {
      this.paint?.("session");
      const text = typeof schemaArrangePendingText === "function"
        ? schemaArrangePendingText(this.bankArrangement, this.model, {
          labelFor: (scope, id) => schemaArrangeBankLabelFor(this.model, scope, id),
          stepLabel: "Ctrl+Z step back",
        })
        : "";
      schemaArrangeAnnounce?.(this.contentEl, text || "Save or revert the pending arrangement first.");
    } catch (_) {}
  },

  bankArrangeNudge(direction, options = {}) {
    const started = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : 0;
    try {
      if (this.stage || this.readOnly || this.sessionState?.status === "applying") return false;
      const selected = this.bankArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.bankEnsureArrangement();
      if (!this.bankArrangement) return false;
      const step = Number(direction);
      if (!Number.isFinite(step) || step === 0) return false;
      const before = typeof schemaArrangeCollectRects === "function"
        ? schemaArrangeCollectRects(this.contentEl) : null;
      const result = this.bankArrangement.nudge(selected.scope, selected.id, step, {
        coalesceKey: options.coalesceKey || null,
      });
      this.bankHintMode = null;
      if (result && result.ok && !result.clamped) {
        this.bankArrangeConfirm = false;
        this.bankClearEnterLatch?.();
        this.bankArrangeSyncDraft();
        this.paint?.("body");
        schemaArrangePlayFlip?.(this.contentEl, before);
        const projected = this.bankArrangement.projected(selected.scope) || [];
        const index = projected.indexOf(selected.id);
        if (index >= 0) {
          const label = schemaArrangeBankLabelFor(this.model, selected.scope, selected.id);
          schemaArrangeAnnounce?.(this.contentEl, `${label}, position ${index + 1} of ${projected.length}`);
        }
      } else if (result && result.clamped) {
        const categoryEdge = String(selected.scope || "").startsWith("group:");
        schemaArrangeAnnounce?.(this.contentEl, categoryEdge ? "⏎ edit to change group" : (step < 0 ? "Already first." : "Already last."));
        try {
          const node = this.contentEl?.querySelector?.(`[data-arrange-id="${selected.scope}:${selected.id}"]`);
          if (node?.animate) {
            node.animate(
              [{ transform: "translateX(0)" }, { transform: `translateX(${step > 0 ? 3 : -3}px)` }, { transform: "translateX(0)" }],
              { duration: 90, easing: "ease-out" },
            );
          }
        } catch (_) {}
      }
      try { bankSetupRecordTiming?.(this.pluginRef, "nudge-paint", started ? performance.now() - started : 0); } catch (_) {}
      return Boolean(result && result.ok && !result.clamped);
    } catch (_) {
      return false;
    }
  },

  bankArrangeToEdge(edge) {
    try {
      if (this.stage || this.readOnly || this.sessionState?.status === "applying") return false;
      const selected = this.bankArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.bankEnsureArrangement();
      if (!this.bankArrangement) return false;
      const before = typeof schemaArrangeCollectRects === "function"
        ? schemaArrangeCollectRects(this.contentEl) : null;
      const result = this.bankArrangement.toEdge(selected.scope, selected.id, edge);
      this.bankHintMode = null;
      if (result && result.ok && !result.clamped) {
        this.bankArrangeConfirm = false;
        this.bankClearEnterLatch?.();
        this.bankArrangeSyncDraft();
        this.paint?.("body");
        schemaArrangePlayFlip?.(this.contentEl, before);
        return true;
      }
      const categoryEdge = String(selected.scope || "").startsWith("group:");
      schemaArrangeAnnounce?.(this.contentEl, categoryEdge ? "⏎ edit to change group" : (edge === "first" ? "Already first." : "Already last."));
      return false;
    } catch (_) {
      return false;
    }
  },

  bankArrangeEnterHintMode() {
    try {
      if (this.stage || this.readOnly || this.sessionState?.status === "applying") return false;
      const selected = this.bankArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.bankEnsureArrangement();
      if (!this.bankArrangement) return false;
      const gaps = typeof this.bankArrangement.legalGaps === "function"
        ? this.bankArrangement.legalGaps(selected.scope, selected.id) : [];
      if (!gaps.length) {
        schemaArrangeAnnounce?.(this.contentEl, "No legal gaps for this item.");
        return false;
      }
      const labels = typeof schemaArrangeGapBadges === "function" ? schemaArrangeGapBadges(gaps.length) : [];
      this.bankHintMode = { scope: selected.scope, id: selected.id, gaps: gaps.slice(), labels };
      this.paint?.("body");
      schemaArrangeAnnounce?.(this.contentEl,
        `Move to… type a gap badge for ${schemaArrangeBankLabelFor(this.model, selected.scope, selected.id)}. Esc leaves hint mode.`);
      return true;
    } catch (_) {
      return false;
    }
  },

  bankArrangeHintKey(key) {
    try {
      const mode = this.bankHintMode;
      if (!mode) return false;
      const typed = String(key || "").toLowerCase();
      if (!typed) return false;
      if (typed === "escape") {
        this.bankHintMode = null;
        this.paint?.("body");
        return true;
      }
      const index = (mode.labels || []).indexOf(typed);
      if (index < 0) {
        const prefix = (mode.labels || []).filter((label) => label.startsWith(typed));
        return prefix.length > 0;
      }
      const gap = (mode.gaps || [])[index];
      if (!Number.isInteger(gap)) return false;
      this.bankEnsureArrangement();
      const before = typeof schemaArrangeCollectRects === "function"
        ? schemaArrangeCollectRects(this.contentEl) : null;
      const result = this.bankArrangement.placeAtGap(mode.scope, mode.id, gap);
      this.bankHintMode = null;
      if (result && result.ok) {
        this.bankArrangeConfirm = false;
        this.bankClearEnterLatch?.();
        this.bankArrangeSyncDraft();
        this.paint?.("body");
        schemaArrangePlayFlip?.(this.contentEl, before);
        return true;
      }
      this.paint?.("body");
      return true;
    } catch (_) {
      return false;
    }
  },

  bankArrangeSyncDraft() {
    try {
      if (!this.session) return;
      if (this.sessionState?.status === "applying") return;
      this.bankEnsureArrangement();
      if (!this.bankArrangement) return;
      if (!this.bankArrangement.dirty()) {
        const current = this.session.getState?.().draftOps || [];
        if (current.length && !this.stage) {
          this.sessionState = this.session.setDraft([]);
          this.bankArrangeConfirm = false;
          this.bankClearEnterLatch?.();
        }
        return;
      }
      const compiled = typeof compileBankArrangement === "function"
        ? compileBankArrangement(this.bankArrangement, {
          categories: this.categories || this.model?.categories || [],
          rules: this.report?.rules || this.model?.rules || [],
        })
        : { ok: false, code: "compile-mismatch" };
      if (!compiled || compiled.ok === false || !Array.isArray(compiled)) return;
      this.sessionState = this.session.setDraft(compiled);
      this.bankArrangeConfirm = false;
    } catch (_) {}
  },

  bankArrangeRevert() {
    try {
      this.bankEnsureArrangement();
      if (!this.bankArrangement || !this.bankArrangement.dirty()) return false;
      this.bankArrangement.revert();
      this.bankHintMode = null;
      this.bankArrangeConfirm = false;
      this.bankClearEnterLatch?.();
      if (this.session && this.sessionState?.status !== "applying" && !this.stage) {
        try { this.sessionState = this.session.setDraft([]); } catch (_) {}
      }
      this.paint?.("body");
      schemaArrangeAnnounce?.(this.contentEl, "Reverted pending moves. Nothing was written.");
      return true;
    } catch (_) {
      return false;
    }
  },

  bankArrangeStepBackOrUndo() {
    try {
      this.bankEnsureArrangement();
      if (this.bankArrangement && this.bankArrangement.dirty()) {
        const stepped = this.bankArrangement.stepBack();
        if (!stepped) return false;
        this.bankHintMode = null;
        this.bankArrangeConfirm = false;
        this.bankClearEnterLatch?.();
        this.bankArrangeSyncDraft();
        this.paint?.("body");
        return true;
      }
      if (this.stage) return false;
      const result = this.session?.stageUndo?.();
      if (result?.ok) {
        try { this.sessionState = this.session.getState(); } catch (_) {}
        this.bankUndoStaged = true;
        this.stage = {
          kind: "undo",
          title: "Undo last bank setup edit",
          confirmation: "Preview the inverse operation. Enter applies the undo as one normal edit.",
        };
        this.bankArrangePaintUndoProjection();
        this.paint?.("body");
        schemaArrangeAnnounce?.(this.contentEl, "Undo staged. Press Enter to apply.");
        return true;
      }
      this.errorMessage = result?.message || "There is no bank config edit to undo.";
      this.paint?.("session");
      return false;
    } catch (_) {
      return false;
    }
  },

  bankArrangePaintUndoProjection() {
    try {
      const ops = this.session?.getState?.()?.draftOps || [];
      if (!ops.length || typeof simulateBankOps !== "function") {
        this.bankUndoView = null;
        return;
      }
      const groups = this.bankArrangement?.saved?.("groups") || this.bankArrangeScopes().groups || [];
      const sim = simulateBankOps({
        groups,
        categories: (this.categories || []).map((row) => ({ ...row })),
        rules: (this.report?.rules || []).map((row) => ({ ...row })),
      }, ops, { rules: this.report?.rules || [] });
      this.bankUndoView = sim && sim.ok !== false ? sim : null;
    } catch (_) {
      this.bankUndoView = null;
    }
  },

  bankArrangeIsLoud() {
    try {
      const report = this.sessionState?.preview || this.session?.getState?.()?.preview || null;
      return schemaArrangeIsLoudBankReport(report, this.bankArrangement);
    } catch (_) {
      return { loud: false, reasons: [] };
    }
  },

  bankArrangeOrderBlocked() {
    try {
      const report = this.sessionState?.preview || this.session?.getState?.()?.preview || null;
      return typeof schemaArrangeBankOrderDisagrees === "function"
        ? schemaArrangeBankOrderDisagrees(report, this.bankArrangement, this.categories || [])
        : false;
    } catch (_) {
      return false;
    }
  },

  bankArrangeEnter() {
    try {
      if (this.stage) {
        void this.applyStage?.();
        return true;
      }
      this.bankEnsureArrangement();
      if (!this.bankArrangement || !this.bankArrangement.dirty()) {
        this.beginSelectedGesture?.("edit");
        return true;
      }
      const state = this.session?.getState?.() || {};
      this.sessionState = state;
      if (state.lockWait) {
        this.paint?.("session");
        return true;
      }
      if (state.status === "preview-pending" || state.busy || state.status === "applying") {
        this.bankArmEnterLatch?.();
        this.paint?.("session");
        return true;
      }
      if (!state.canApply) {
        if ((state.draftOps || []).length && !state.refusal) {
          try { this.session?.previewNow?.(); } catch (_) {}
          this.bankArmEnterLatch?.();
        } else {
          this.paint?.("session");
        }
        return true;
      }
      if (this.bankArrangeOrderBlocked()) {
        this.errorMessage = "bob disagrees with this order";
        this.paint?.("session");
        return true;
      }
      const { loud } = this.bankArrangeIsLoud();
      if (loud && !this.bankArrangeConfirm) {
        this.bankArrangeConfirm = true;
        this.paint?.("session");
        schemaArrangeAnnounce?.(this.contentEl, "Loud arrangement. Press Enter again to confirm the save.");
        return true;
      }
      this.bankArrangeConfirm = false;
      return this.bankArrangeApply();
    } catch (_) {
      return false;
    }
  },

  async bankArrangeApply() {
    if (this.bankApplyPromise) return this.bankApplyPromise;
    const work = this.bankArrangeApplyCurrent();
    const guarded = work.finally(() => {
      if (this.bankApplyPromise === guarded) this.bankApplyPromise = null;
    });
    this.bankApplyPromise = guarded;
    return guarded;
  },

  async bankArrangeApplyCurrent() {
    try {
      if (!this.session) return { ok: false, code: "unavailable" };
      this.bankEnsureArrangement();
      let current = this.session.getState();
      this.sessionState = current;
      if (!current.canApply) {
        this.paint?.("session");
        return { ok: false, code: "not-previewed", message: "Enter is inert until a current preview succeeds." };
      }
      if (this.bankArrangeOrderBlocked()) {
        this.errorMessage = "bob disagrees with this order";
        this.paint?.("session");
        return { ok: false, code: "order-mismatch" };
      }
      const started = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now() : 0;
      try { this.bankArrangement?.beginSave?.(); } catch (_) {}
      this.bankSaving = true;
      this.bankClosedDuringSave = false;
      this.paint?.("session");
      const result = await this.session.apply();
      this.sessionState = this.session.getState();
      this.bankSaving = false;
      try { bankSetupRecordTiming?.(this.pluginRef, "apply", started ? performance.now() - started : 0); } catch (_) {}
      if (result?.ok && result.changed) {
        try { this.bankArrangement?.settleSave?.(true); } catch (_) {}
        const report = result.report || this.sessionState?.preview || null;
        const inverseOps = Array.isArray(report?.inverse_ops) ? report.inverse_ops : [];
        const afterFingerprint = String(report?.after_fingerprint || this.sessionState?.expect || "");
        try { bankSetupRememberUndo?.(this.pluginRef, inverseOps, afterFingerprint); } catch (_) {}
        this.stage = null;
        this.bankHintMode = null;
        this.bankArrangeConfirm = false;
        this.bankUndoStaged = false;
        this.bankUndoView = null;
        this.savedMessage = "Saved · Ctrl+Z undo";
        const closed = this.bankClosedDuringSave === true || !this.contentEl?.parentNode;
        try {
          const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
          if (typeof NoticeCtor === "function") {
            new NoticeCtor(closed ? "Bank setup saved." : "Bank setup saved. Press Ctrl+Z to preview Undo.");
          }
        } catch (_) {}
        const refreshed = result.refreshed && result.refreshed.report ? result.refreshed.report : null;
        if (refreshed && refreshed.state === "valid") {
          this.report = refreshed;
          if (Array.isArray(refreshed.categories)) this.categories = refreshed.categories;
        } else if (report) {
          if (Array.isArray(report.categories)) this.categories = report.categories;
          this.report = { ...this.report, ...report, state: this.report?.state || "valid" };
          const after = typeof report.after_fingerprint === "string" ? report.after_fingerprint : "";
          if (after) {
            this.report.config_fingerprint = after;
            this.report.fingerprint = after;
          }
        }
        // Rule ids name indices in the saved report. Once bob has reordered
        // that report, keep selection on the moved rule and seed the next
        // arrangement from the new indices instead of reusing the old ids.
        if (refreshed && this.selection?.type === "rule") {
          const index = (this.bankArrangement?.saved?.("rules") || []).indexOf(this.selection.id);
          if (index >= 0) this.selection = { ...this.selection, index, id: `rule:${index}` };
        }
        this.bankArrangement = null;
        this.bankArrangeBaseFingerprint = "";
        if (closed) {
          try { this.session?.close?.(); } catch (_) {}
          this.session = null;
        } else {
          this.paint?.("body");
          schemaArrangeAnnounce?.(this.contentEl, "Bank setup saved. Press Ctrl+Z to preview Undo.");
        }
      } else {
        try { this.bankArrangement?.settleSave?.(false); } catch (_) {}
        if (result && !result.ok && result.code !== "superseded") {
          const closed = this.bankClosedDuringSave === true || !this.contentEl?.parentNode;
          if (closed) {
            try {
              const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
              if (typeof NoticeCtor === "function") {
                new NoticeCtor(`Bank setup not saved: ${result.message || result.code || "refused"}`);
              }
            } catch (_) {}
          } else {
            this.errorMessage = result?.message || "The bank config edit was refused.";
            this.paint?.("session");
          }
        } else if (this.contentEl?.parentNode) {
          this.paint?.("session");
        }
      }
      if (this.bankClosedDuringSave === true) {
        try { this.session?.close?.(); } catch (_) {}
        this.session = null;
      }
      return result;
    } catch (error) {
      try { this.bankArrangement?.settleSave?.(false); } catch (_) {}
      this.bankSaving = false;
      try { this.paint?.("session"); } catch (_) {}
      return { ok: false, code: "failed", message: String(error?.message || error) };
    }
  },
});

(function bankArrangeWireCard() {
  try {
    const proto = BankSetupCardModal.prototype;
    if (!proto || proto.__bankArrangeWired) return;
    const origBegin = proto.beginSelectedGesture;
    const origKeyDown = proto.onKeyDown;
    const origSetReport = proto.setReport;
    const origOnClose = proto.onClose;
    const origApplyStage = proto.applyStage;
    const origCancelStage = proto.cancelStage;
    const origOpenNew = proto.openNewCategoryStage;
    const origOpenAccount = proto.openNewAccountStage;
    const origOpenRule = proto.openNewRuleStage;
    const origStageUndo = proto.stageUndo;
    const origOnOpen = proto.onOpen;

    proto.onOpen = function bankArrangeOnOpen() {
      origOnOpen.call(this);
      try {
        const host = this.contentEl;
        if (!host || this.__bankComposeBound) return;
        this.bankOnComposeStart = () => { this.bankComposing = true; };
        this.bankOnComposeEnd = () => { this.bankComposing = false; };
        host.addEventListener?.("compositionstart", this.bankOnComposeStart);
        host.addEventListener?.("compositionend", this.bankOnComposeEnd);
        this.__bankComposeBound = true;
      } catch (_) {}
    };

    proto.setReport = function bankArrangeSetReport(report, options = {}) {
      const hasDraft = Boolean(this.stage && this.sessionState?.draftOps?.length)
        || (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty());
      if (hasDraft && options.force !== true && report && this.closed !== true) {
        if (options.initial === true) return origSetReport.call(this, report, options);
        return false;
      }
      const result = origSetReport.call(this, report, options);
      try {
        if (result && !this.bankArrangeDirty()) this.bankEnsureArrangement?.();
      } catch (_) {}
      return result;
    };

    proto.createSession = function bankArrangeCreateSession(fingerprint) {
      if (!this.pluginRef || typeof createBankConfigUpdateSession !== "function") return null;
      let seedUndo = null;
      try {
        const last = typeof bankSetupLastUndo === "function" ? bankSetupLastUndo(this.pluginRef) : null;
        if (last && Array.isArray(last.inverseOps) && last.inverseOps.length
          && String(last.afterFingerprint || "") === String(fingerprint || "")
          && last.afterFingerprint) {
          seedUndo = last;
        }
      } catch (_) {}
      this.session = createBankConfigUpdateSession(
        { expect: fingerprint, undo: seedUndo },
        bankConfigUpdateServiceDeps(this.pluginRef, { onChange: (state) => this.onSessionChange(state) }),
      );
      this.sessionState = this.session.getState();
      return this.session;
    };

    proto.onSessionChange = function bankArrangeOnSessionChange(state) {
      if (this.closed && this.bankClosedDuringSave !== true) return;
      this.sessionState = state || null;
      if (state?.syncWarning) this.syncWarning = { ...state.syncWarning };
      if (state?.refusal?.kind === "stale" || state?.refusal?.code === "stale_config") {
        void this.refreshStaleDraft();
      }
      if (typeof this.bankMaybeFireEnterLatch === "function" && this.bankMaybeFireEnterLatch(state)) return;
      this.paint?.("session");
    };

    proto.onClose = function bankArrangeOnClose() {
      try {
        const status = this.session?.getState?.()?.status;
        if (status === "applying") {
          this.bankClosedDuringSave = true;
          try { this.contentEl?.removeEventListener?.("click", this.clickListener); } catch (_) {}
          try { this.contentEl?.removeEventListener?.("keydown", this.keyListener, true); } catch (_) {}
          try {
            this.contentEl?.removeEventListener?.("compositionstart", this.bankOnComposeStart);
            this.contentEl?.removeEventListener?.("compositionend", this.bankOnComposeEnd);
          } catch (_) {}
          try { this.pluginRef?.bankSetupCardModalClosed?.(this); } catch (_) {}
          return;
        }
      } catch (_) {}
      try {
        this.contentEl?.removeEventListener?.("compositionstart", this.bankOnComposeStart);
        this.contentEl?.removeEventListener?.("compositionend", this.bankOnComposeEnd);
      } catch (_) {}
      return origOnClose.call(this);
    };

    proto.beginSelectedGesture = function bankArrangeBeginSelected(kind, direction = "") {
      try {
        if (kind === "move") {
          if (this.readOnly || this.stage) return false;
          const step = direction === "back" ? -1 : 1;
          return this.bankArrangeNudge?.(step, { coalesceKey: null });
        }
        if (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()
          && (kind === "hide" || kind === "remove" || kind === "restore" || kind === "edit")) {
          if (kind === "edit") {
            this.bankArrangeEnter?.();
            return true;
          }
          this.bankArrangeFlashPending?.();
          return false;
        }
      } catch (_) {}
      return origBegin.call(this, kind, direction);
    };

    proto.openNewCategoryStage = function bankArrangeOpenNew() {
      try {
        if (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()) {
          this.bankArrangeFlashPending?.();
          return false;
        }
      } catch (_) {}
      return origOpenNew.call(this);
    };

    proto.openNewAccountStage = function bankArrangeOpenAccount() {
      try {
        if (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()) {
          this.bankArrangeFlashPending?.();
          return false;
        }
      } catch (_) {}
      return origOpenAccount.call(this);
    };

    proto.openNewRuleStage = function bankArrangeOpenRule() {
      try {
        if (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()) {
          this.bankArrangeFlashPending?.();
          return false;
        }
      } catch (_) {}
      return origOpenRule.call(this);
    };

    proto.stageUndo = function bankArrangeStageUndo() {
      try {
        if (typeof this.bankArrangeStepBackOrUndo === "function") {
          return this.bankArrangeStepBackOrUndo();
        }
      } catch (_) {}
      return origStageUndo.call(this);
    };

    proto.cancelStage = function bankArrangeCancelStage() {
      const wasUndo = this.stage?.kind === "undo";
      const result = origCancelStage.call(this);
      if (wasUndo) {
        this.bankUndoStaged = false;
        this.bankUndoView = null;
      }
      return result;
    };

    proto.applyStage = function bankArrangeApplyStage() {
      try {
        if (!this.stage && typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()) {
          return this.bankArrangeEnter?.();
        }
      } catch (_) {}
      return origApplyStage.call(this);
    };

    proto.onKeyDown = async function bankArrangeOnKeyDown(event) {
      try {
        if (!event || event.isComposing || event.keyCode === 229 || event.defaultPrevented) {
          return origKeyDown.call(this, event);
        }
        const key = String(event.key || "");
        const lower = key.toLowerCase();
        const mod = Boolean(event.ctrlKey || event.metaKey);
        const inInput = Boolean(event.target?.closest?.("input,select,textarea"));
        const altJ = event.altKey && (lower === "j" || event.code === "KeyJ");
        const altK = event.altKey && (lower === "k" || event.code === "KeyK");
        const altM = event.altKey && (lower === "m" || event.code === "KeyM");
        const consume = () => bankCategoryUiConsume(event);

        if (this.bankHintMode && !this.stage && this.sessionState?.status !== "applying") {
          if (key === "Escape") {
            consume();
            this.bankHintMode = null;
            this.paint?.("body");
            return;
          }
          if (!inInput && !mod && !event.altKey && key.length === 1) {
            if (this.bankArrangeHintKey?.(lower)) {
              consume();
              return;
            }
          }
        }

        if ((key === "Escape" || (lower === "q" && !mod && !event.altKey && !inInput))
          && !this.stage && typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()
          && this.sessionState?.status !== "applying") {
          consume();
          this.bankArrangeRevert?.();
          return;
        }

        if (!this.stage && !this.readOnly && this.sessionState?.status !== "applying") {
          if (altJ || altK) {
            consume();
            if (event.shiftKey) this.bankArrangeToEdge?.(altJ ? "last" : "first");
            else this.bankArrangeNudge?.(altJ ? 1 : -1, { coalesceKey: "alt-hold" });
            return;
          }
          if (altM && !inInput) {
            consume();
            this.bankArrangeEnterHintMode?.();
            return;
          }
        }

        if (mod && lower === "z" && !inInput) {
          consume();
          if (this.stage?.kind === "undo") void this.applyStage();
          else this.bankArrangeStepBackOrUndo?.();
          return;
        }

        if (key === "Enter" && !inInput && !this.stage
          && typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty()) {
          consume();
          this.bankArrangeEnter?.();
          return;
        }
      } catch (_) {}
      return origKeyDown.call(this, event);
    };

    try {
      Object.defineProperty(proto, "__bankArrangeWired", { value: true, configurable: true });
    } catch (_) {
      proto.__bankArrangeWired = true;
    }
  } catch (_) {}
})();
