// Album arrangement controller: local projection, gestures, and the
// one-envelope save pipeline. The body paints the projection; bob owns
// the only write through the unchanged guarded session.
Object.assign(AlbumSchemaCardModal.prototype, {
  schemaArrangeScopes() {
    return schemaArrangeScopesFromAlbumModel(this.schemaModel);
  },

  schemaEnsureArrangement() {
    try {
      const fingerprint = String(this.schemaModel?.schemaFingerprint || "");
      const scopes = this.schemaArrangeScopes();
      if (!this.schemaArrangement || this.schemaArrangeBaseFingerprint !== fingerprint) {
        const known = this.schemaArrangement && this.schemaArrangeBaseFingerprint === fingerprint;
        if (!known) {
          this.schemaArrangement = typeof createArrangement === "function"
            ? createArrangement({ scopes })
            : null;
          this.schemaArrangeBaseFingerprint = fingerprint;
          this.schemaHintMode = null;
          this.schemaArrangeConfirm = false;
        }
      } else {
        const current = typeof this.schemaArrangement.scopeIds === "function"
          ? this.schemaArrangement.scopeIds() : [];
        const wanted = Object.keys(scopes);
        const same = current.length === wanted.length && wanted.every((key) => current.includes(key));
        if (!same) {
          this.schemaArrangement = typeof createArrangement === "function"
            ? createArrangement({ scopes })
            : null;
          this.schemaHintMode = null;
          this.schemaArrangeConfirm = false;
        }
      }
    } catch (_) {
      this.schemaArrangement = null;
    }
    return this.schemaArrangement;
  },

  schemaArrangeDirty() {
    try {
      this.schemaEnsureArrangement();
      return Boolean(this.schemaArrangement?.dirty?.());
    } catch (_) {
      return false;
    }
  },

  schemaArrangeSelectedScope() {
    try {
      const target = this.schemaSelectedTarget?.();
      if (!target) return null;
      if (target.kind === "field") {
        return { scope: "fields", id: String(target.field?.key || "") };
      }
      if (target.kind === "choice") {
        const fieldKey = String(target.field?.key || "");
        if (!fieldKey) return null;
        return { scope: `choices:${fieldKey}`, id: String(target.choice?.value ?? "") };
      }
      return null;
    } catch (_) {
      return null;
    }
  },

  schemaArrangeBlockedGesture() {
    return this.schemaArrangeDirty();
  },

  schemaArrangeFlashPending() {
    try {
      this.paintSchemaCard?.("session");
      const text = schemaArrangePendingText(this.schemaArrangement, this.schemaModel);
      schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, text || "Save or revert the pending arrangement first.");
    } catch (_) {}
  },

  schemaArrangeNudge(direction, options = {}) {
    const started = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : 0;
    try {
      if (this.stage || this.sessionState?.status === "applying" || !this.schemaFresh()) return false;
      const selected = this.schemaArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement) return false;
      const step = Number(direction);
      if (!Number.isFinite(step) || step === 0) return false;
      const before = schemaArrangeCollectRects(this.schemaCardEl?.() || this.contentEl);
      const result = this.schemaArrangement.nudge(selected.scope, selected.id, step, {
        coalesceKey: options.coalesceKey || null,
      });
      this.schemaHintMode = null;
      if (result && result.ok) {
        this.schemaArrangeConfirm = false;
        this.schemaClearEnterLatch?.();
        this.schemaArrangeSyncDraft();
        this.paintSchemaCard?.("body");
        schemaArrangePlayFlip(this.schemaCardEl?.() || this.contentEl, before);
        const projected = this.schemaArrangement.projected(selected.scope) || [];
        const index = projected.indexOf(selected.id);
        if (index >= 0) {
          const label = schemaArrangeAlbumLabelFor(this.schemaModel, selected.scope, selected.id);
          schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
            `${label}, position ${index + 1} of ${projected.length}`);
        }
      } else if (result && result.clamped) {
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, "Already first.");
        try {
          const card = this.schemaCardEl?.() || this.contentEl;
          const node = card?.querySelector?.(`[data-arrange-id="${selected.scope}:${selected.id}"]`);
          if (typeof schemaCardBump === "function") schemaCardBump(node, step > 0 ? 1 : -1, { axis: "x" });
        } catch (_) {}
      }
      try {
        const plugin = this.schemaPlugin;
        if (plugin && typeof plugin.albumSchemaRecordTiming === "function" && started) {
          plugin.albumSchemaRecordTiming("nudge-paint", performance.now() - started);
        }
      } catch (_) {}
      return Boolean(result && result.ok);
    } catch (_) {
      return false;
    }
  },

  schemaArrangeToEdge(edge) {
    try {
      if (this.stage || this.sessionState?.status === "applying" || !this.schemaFresh()) return false;
      const selected = this.schemaArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement) return false;
      const before = schemaArrangeCollectRects(this.schemaCardEl?.() || this.contentEl);
      const result = this.schemaArrangement.toEdge(selected.scope, selected.id, edge);
      this.schemaHintMode = null;
      if (result && result.ok) {
        this.schemaArrangeConfirm = false;
        this.schemaClearEnterLatch?.();
        this.schemaArrangeSyncDraft();
        this.paintSchemaCard?.("body");
        schemaArrangePlayFlip(this.schemaCardEl?.() || this.contentEl, before);
        const projected = this.schemaArrangement.projected(selected.scope) || [];
        const index = projected.indexOf(selected.id);
        if (index >= 0) {
          const label = schemaArrangeAlbumLabelFor(this.schemaModel, selected.scope, selected.id);
          schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
            `${label}, position ${index + 1} of ${projected.length}`);
        }
        return true;
      }
      if (result && result.clamped) {
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, edge === "first" ? "Already first." : "Already last.");
      }
      return false;
    } catch (_) {
      return false;
    }
  },

  schemaArrangeEnterHintMode() {
    try {
      if (this.stage || this.sessionState?.status === "applying" || !this.schemaFresh()) return false;
      const selected = this.schemaArrangeSelectedScope();
      if (!selected || !selected.id) return false;
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement) return false;
      const gaps = typeof this.schemaArrangement.legalGaps === "function"
        ? this.schemaArrangement.legalGaps(selected.scope, selected.id) : [];
      if (!gaps.length) {
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, "No legal gaps for this item.");
        return false;
      }
      const labels = schemaArrangeGapBadges(gaps.length);
      this.schemaHintMode = { scope: selected.scope, id: selected.id, gaps: gaps.slice(), labels };
      this.paintSchemaCard?.("body");
      schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
        `Move to… type a gap badge for ${schemaArrangeAlbumLabelFor(this.schemaModel, selected.scope, selected.id)}. Esc leaves hint mode.`);
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaArrangeHintKey(key) {
    try {
      const mode = this.schemaHintMode;
      if (!mode) return false;
      const typed = String(key || "").toLowerCase();
      if (!typed) return false;
      if (typed === "escape") {
        this.schemaHintMode = null;
        this.paintSchemaCard?.("body");
        return true;
      }
      const index = (mode.labels || []).indexOf(typed);
      if (index < 0) {
        const prefix = (mode.labels || []).filter((label) => label.startsWith(typed));
        if (!prefix.length) return false;
        return true;
      }
      const gap = (mode.gaps || [])[index];
      if (!Number.isInteger(gap)) return false;
      this.schemaEnsureArrangement();
      const before = schemaArrangeCollectRects(this.schemaCardEl?.() || this.contentEl);
      const result = this.schemaArrangement.placeAtGap(mode.scope, mode.id, gap);
      this.schemaHintMode = null;
      if (result && result.ok) {
        this.schemaArrangeConfirm = false;
        this.schemaClearEnterLatch?.();
        this.schemaArrangeSyncDraft();
        this.paintSchemaCard?.("body");
        schemaArrangePlayFlip(this.schemaCardEl?.() || this.contentEl, before);
        return true;
      }
      this.paintSchemaCard?.("body");
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaArrangeSyncDraft() {
    try {
      if (!this.session) return;
      if (this.sessionState?.status === "applying") return;
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement) return;
      if (!this.schemaArrangement.dirty()) {
        const current = this.session.getState?.().draftOps || [];
        if (current.length) {
          this.sessionState = this.session.setDraft([]);
          this.schemaArrangeConfirm = false;
          this.schemaClearEnterLatch?.();
        }
        return;
      }
      const compiled = typeof compileAlbumArrangement === "function"
        ? compileAlbumArrangement(this.schemaArrangement)
        : { ok: false, code: "compile-mismatch" };
      if (!compiled || compiled.ok === false || !Array.isArray(compiled)) {
        return;
      }
      this.sessionState = this.session.setDraft(compiled);
      this.schemaArrangeConfirm = false;
    } catch (_) {}
  },

  schemaArrangeRevert() {
    try {
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement || !this.schemaArrangement.dirty()) return false;
      this.schemaArrangement.revert();
      this.schemaHintMode = null;
      this.schemaArrangeConfirm = false;
      this.schemaClearEnterLatch?.();
      if (this.session && this.sessionState?.status !== "applying") {
        try { this.sessionState = this.session.setDraft([]); } catch (_) {}
      }
      this.paintSchemaCard?.("body");
      schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, "Reverted pending moves. Nothing was written.");
      return true;
    } catch (_) {
      return false;
    }
  },

  schemaArrangeStepBackOrUndo() {
    try {
      this.schemaEnsureArrangement();
      if (this.schemaArrangement && this.schemaArrangement.dirty()) {
        const stepped = this.schemaArrangement.stepBack();
        if (!stepped) return false;
        this.schemaHintMode = null;
        this.schemaArrangeConfirm = false;
        this.schemaClearEnterLatch?.();
        this.schemaArrangeSyncDraft();
        this.paintSchemaCard?.("body");
        return true;
      }
      const result = this.session?.stageUndo?.();
      if (result?.ok) {
        try { this.sessionState = this.session.getState(); } catch (_) {}
        this.paintSchemaCard?.("session");
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl, "Undo staged. Press Enter to apply.");
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  },

  schemaArrangeIsLoud() {
    try {
      const report = this.sessionState?.preview || this.session?.getState?.()?.preview || null;
      return schemaArrangeIsLoudAlbumReport(report);
    } catch (_) {
      return { loud: false, reasons: [] };
    }
  },

  schemaArrangeEnter() {
    try {
      if (this.stage) {
        this.schemaStageEnter?.();
        return true;
      }
      this.schemaEnsureArrangement();
      if (!this.schemaArrangement || !this.schemaArrangement.dirty()) {
        this.schemaEditSelected?.();
        return true;
      }
      const state = this.session?.getState?.() || {};
      this.sessionState = state;
      if (state.lockWait) {
        this.paintSchemaCard?.("session");
        return true;
      }
      if (state.status === "preview-pending" || state.busy || state.status === "applying") {
        this.schemaArmEnterLatch?.();
        this.paintSchemaCard?.("session");
        return true;
      }
      if (!state.canApply || !this.schemaFresh()) {
        if ((state.draftOps || []).length && !state.refusal) {
          try { this.session?.previewNow?.(); } catch (_) {}
          this.schemaArmEnterLatch?.();
        } else {
          this.paintSchemaCard?.("session");
        }
        return true;
      }
      const { loud } = this.schemaArrangeIsLoud();
      if (loud && !this.schemaArrangeConfirm) {
        this.schemaArrangeConfirm = true;
        this.paintSchemaCard?.("session");
        schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
          "Loud arrangement. Press Enter again to confirm the save.");
        return true;
      }
      this.schemaArrangeConfirm = false;
      void this.schemaArrangeApply();
      return true;
    } catch (_) {
      return false;
    }
  },

  async schemaArrangeApply() {
    if (this.schemaApplyPromise) return this.schemaApplyPromise;
    const work = this.schemaArrangeApplyCurrent();
    const guarded = work.finally(() => {
      if (this.schemaApplyPromise === guarded) this.schemaApplyPromise = null;
    });
    this.schemaApplyPromise = guarded;
    return guarded;
  },

  async schemaArrangeApplyCurrent() {
    try {
      if (!this.session) return { ok: false, code: "unavailable" };
      this.schemaEnsureArrangement();
      let current = this.session.getState();
      this.sessionState = current;
      if (!this.schemaFresh() || (current.status === "preview-ready" && !current.canApply)) {
        current = this.session.noteGenerationChanged?.() || this.session.getState();
        this.sessionState = current;
        this.schemaApplyNotice = current.refusal ? "" : "This preview is stale. Refresh the album report before applying.";
        void this.schemaRefreshAfterStale?.();
        this.paintSchemaCard?.("session");
        return { ok: false, code: "stale", message: current.refusal?.message || this.schemaApplyNotice };
      }
      if (!current.canApply || !this.schemaFresh()) {
        this.paintSchemaCard?.("session");
        return { ok: false, code: "not-previewed", message: "Enter is inert until a current preview succeeds." };
      }
      const started = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now() : 0;
      let snapshot = null;
      try {
        snapshot = this.schemaArrangement?.beginSave?.() || null;
        this.schemaArrangeSaveSnapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
      } catch (_) {
        this.schemaArrangeSaveSnapshot = null;
      }
      this.schemaSaving = true;
      this.schemaClosedDuringSave = false;
      this.paintSchemaCard?.("session");
      const result = await this.session.apply();
      this.sessionState = this.session.getState();
      this.schemaSaving = false;
      try {
        const plugin = this.schemaPlugin;
        if (plugin && typeof plugin.albumSchemaRecordTiming === "function" && started) {
          plugin.albumSchemaRecordTiming("apply", performance.now() - started);
        }
      } catch (_) {}
      if (result?.ok && result.changed) {
        try { this.schemaArrangement?.settleSave?.(true); } catch (_) {}
        const report = result.report || this.sessionState?.preview || null;
        const inverseOps = Array.isArray(report?.inverse_ops) ? report.inverse_ops : [];
        const afterFingerprint = String(report?.after_fingerprint || this.sessionState?.expect || "");
        try {
          this.schemaPlugin?.albumSchemaRememberUndo?.(this.schemaModel?.stem, inverseOps, afterFingerprint);
        } catch (_) {}
        this.stage = null;
        this.stageDraft = null;
        this.schemaMoreOpen = false;
        this.schemaHintMode = null;
        this.schemaArrangeConfirm = false;
        this.schemaSavedAt = Date.now();
        const closed = this.schemaClosedDuringSave === true || !this.contentEl?.parentNode;
        if (closed) {
          try {
            const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
            if (typeof NoticeCtor === "function") new NoticeCtor("Album schema saved.");
          } catch (_) {}
        } else {
          try {
            const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
            if (typeof NoticeCtor === "function") new NoticeCtor("Album schema saved. Press u to preview Undo.");
          } catch (_) {}
        }
        try {
          const state = this.schemaPlugin?.albumReportState?.();
          if (state) this.schemaAlbumState(state);
        } catch (_) {}
        if (!closed) {
          this.paintSchemaCard?.("body");
          try {
            const card = this.schemaCardEl?.() || this.contentEl;
            schemaArrangeAnnounce(card, "Album schema saved. Press u to preview Undo.");
            if (this.schemaSavedAt) {
              globalThis.setTimeout?.(() => {
                try {
                  if (Date.now() - (this.schemaSavedAt || 0) > 2800) this.paintSchemaCard?.("session");
                } catch (_) {}
              }, 3100);
            }
          } catch (_) {}
        }
      } else {
        try { this.schemaArrangement?.settleSave?.(false); } catch (_) {}
        if (result && !result.ok && result.code !== "superseded") {
          const closed = this.schemaClosedDuringSave === true || !this.contentEl?.parentNode;
          if (closed) {
            try {
              const NoticeCtor = typeof Notice !== "undefined" ? Notice : globalThis.Notice;
              if (typeof NoticeCtor === "function") {
                new NoticeCtor(`Album schema not saved: ${result.message || result.code || "refused"}`);
              }
            } catch (_) {}
          } else {
            this.paintSchemaCard?.("session");
          }
        } else if (!this.contentEl?.parentNode) {
        } else {
          this.paintSchemaCard?.("session");
        }
        if (this.sessionState?.refusal?.kind === "stale") void this.schemaRefreshAfterStale?.();
      }
      if (this.schemaClosedDuringSave === true) {
        try { this.session?.close?.(); } catch (_) {}
        this.session = null;
      }
      return result;
    } catch (error) {
      try { this.schemaArrangement?.settleSave?.(false); } catch (_) {}
      this.schemaSaving = false;
      try { this.paintSchemaCard?.("session"); } catch (_) {}
      return { ok: false, code: "failed", message: String(error?.message || error) };
    }
  },

  schemaArrangeCheckPredicted(snapshot, nextModel) {
    try {
      if (!snapshot) return;
      const expected = snapshot;
      const model = nextModel || this.schemaModel;
      if (!model) return;
      const actual = schemaArrangeScopesFromAlbumModel(model);
      for (const scope of Object.keys(expected)) {
        const want = expected[scope] || [];
        const got = actual[scope] || [];
        const same = want.length === got.length && want.every((id, index) => got[index] === id);
        if (!same) {
          try {
            // eslint-disable-next-line no-console
            console.warn("bob saved a different order; showing bob's.", { want, got, scope });
          } catch (_) {}
          schemaArrangeAnnounce(this.schemaCardEl?.() || this.contentEl,
            "bob saved a different order; showing bob's.");
          return;
        }
      }
    } catch (_) {}
  },

  schemaArrangeRebaseFromLatest() {
    try {
      if (!this.latestSchemaModel?.schemaFingerprint || !this.session) return false;
      const next = this.latestSchemaModel;
      const hadDirty = this.schemaArrangeDirty();
      this.schemaModel = next;
      this.latestSchemaModel = null;
      try { this.session.rebase?.(this.schemaModel.schemaFingerprint); } catch (_) {}
      this.schemaArrangeBaseFingerprint = String(this.schemaModel?.schemaFingerprint || "");
      if (hadDirty && this.schemaArrangement) {
        try {
          const scopes = this.schemaArrangeScopes();
          this.schemaArrangement.rebase(scopes);
        } catch (_) {}
        this.schemaArrangeSyncDraft();
      } else {
        this.schemaEnsureArrangement();
      }
      this.schemaRepairSelection?.();
      return true;
    } catch (_) {
      return false;
    }
  },
});

// Wiring that keeps 241y under its line budget: thin overrides add the
// arrangement guards, gestures, save routing, and close-during-save on
// top of the card's original single-gesture methods.
(function schemaArrangeWireCard() {
  try {
    const proto = AlbumSchemaCardModal.prototype;
    if (!proto || proto.__schemaArrangeWired) return;
    const origStage = proto.schemaStage;
    const origQueueOp = proto.schemaQueueOp;
    const origEditSelected = proto.schemaEditSelected;
    const origMoveSelected = proto.schemaMoveSelected;
    const origRemove = proto.schemaRemoveSelected;
    const origToggle = proto.schemaToggleSelected;
    const origApply = proto.schemaApply;
    const origApplyCurrent = proto.schemaApplyCurrentPreview;
    const origRebase = proto.schemaRebaseAndPreview;
    const origEscape = proto.schemaHandleEscape;
    const origAction = proto.schemaAction;
    const origKeyDown = proto.schemaOnKeyDown;
    const origClose = proto.onClose;
    const origStartSession = proto.schemaStartSession;
    const origAlbumState = proto.schemaAlbumState;

    proto.schemaStartSession = function schemaStartSessionArrange() {
      const plugin = this.schemaPlugin;
      const model = this.schemaModel;
      if (!plugin || !model?.schemaFingerprint
        || typeof plugin.apiAlbumUpdatePreview !== "function"
        || typeof plugin.apiAlbumUpdateApply !== "function") {
        this.schemaUnavailable = "Schema editing is unavailable until bob-cli and the album report are current.";
        return;
      }
      if (!this.schemaFresh()) {
        this.schemaUnavailable = "Editing waits for a fresh album report.";
        return;
      }
      let seedUndo = null;
      try {
        const last = plugin.albumSchemaLastUndo?.(model.stem);
        if (last && Array.isArray(last.inverseOps) && last.inverseOps.length
          && String(last.afterFingerprint || "") === String(model.schemaFingerprint || "")
          && last.afterFingerprint) {
          seedUndo = last;
        }
      } catch (_) {}
      this.session = createAlbumUpdateSession({
        stem: model.stem,
        albumPath: model.path,
        expect: model.schemaFingerprint,
        undo: seedUndo,
      }, albumUpdateServiceDeps(plugin, {
        saveEditors: (paths) => albumSchemaSaveOpenEditors(plugin, paths),
        onChange: (state) => {
          this.sessionState = state;
          if (this.schemaMaybeFireEnterLatch(state)) return;
          this.paintSchemaCard("session");
          if (["stale", "timeout-unknown"].includes(state.refusal?.kind)) void this.schemaRefreshAfterStale();
        },
      }));
      this.sessionState = this.session.getState();
    };

    proto.schemaAlbumState = function schemaAlbumStateArrange(state) {
      try {
        if (!state || !this.schemaModel) return origAlbumState.call(this, state);
        const dirty = typeof this.schemaArrangeDirty === "function" ? this.schemaArrangeDirty() : false;
        if (!dirty) {
          try {
            if (this.schemaArrangeSaveSnapshot && state.report) {
              const next = albumHeaderModel(state.report, this.schemaSourcePath, {
                sourcePath: this.schemaSourcePath,
                metadataCache: this.schemaPlugin?.app?.metadataCache,
                vault: this.schemaPlugin?.app?.vault,
              });
              if (next && next.schemaFingerprint && next.schemaFingerprint !== this.schemaModel.schemaFingerprint) {
                try { this.schemaArrangeCheckPredicted(this.schemaArrangeSaveSnapshot, next); } catch (_) {}
                this.schemaArrangeSaveSnapshot = null;
              }
            }
          } catch (_) {}
          return origAlbumState.call(this, state);
        }
        this.session?.noteGenerationChanged?.();
        let rebuildBody = false;
        if (state.report) {
          const next = albumHeaderModel(state.report, this.schemaSourcePath, {
            sourcePath: this.schemaSourcePath,
            metadataCache: this.schemaPlugin?.app?.metadataCache,
            vault: this.schemaPlugin?.app?.vault,
          });
          if (next && next.schemaFingerprint && (
            next.schemaFingerprint !== this.schemaModel.schemaFingerprint ||
            ["stale", "timeout-unknown"].includes(this.session?.getState?.()?.refusal?.kind)
          )) {
            try {
              if (this.schemaArrangeSaveSnapshot) {
                try { this.schemaArrangeCheckPredicted(this.schemaArrangeSaveSnapshot, next); } catch (_) {}
                this.schemaArrangeSaveSnapshot = null;
              }
            } catch (_) {}
            this.latestSchemaModel = next;
            const session = this.session?.getState?.() || {};
            if (["browsing", "saved-with-sync-warning"].includes(session.status)
              && !session.draftOps?.length && this.schemaFresh(state) && !this.stage) {
              try {
                if (typeof this.schemaArrangeRebaseFromLatest === "function") {
                  if (this.schemaArrangeRebaseFromLatest()) rebuildBody = true;
                }
              } catch (_) {}
            }
          }
        }
        this.paintSchemaCard(rebuildBody ? "body" : "session");
      } catch (_) {
        try { return origAlbumState.call(this, state); } catch (_) {}
      }
    };

    proto.schemaStage = function schemaStageArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          this.schemaArrangeFlashPending?.();
          return false;
        }
      } catch (_) {}
      return origStage.apply(this, args);
    };

    proto.schemaQueueOp = function schemaQueueOpArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          this.schemaArrangeFlashPending?.();
          return { ok: false, code: "arrange-pending", message: "⏎ save or esc revert first" };
        }
      } catch (_) {}
      return origQueueOp.apply(this, args);
    };

    proto.schemaEditSelected = function schemaEditSelectedArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          if (typeof this.schemaArrangeEnter === "function") {
            this.schemaArrangeEnter();
            return;
          }
        }
      } catch (_) {}
      return origEditSelected.apply(this, args);
    };

    proto.schemaMoveSelected = function schemaMoveSelectedArrange(direction) {
      try {
        if (typeof this.schemaArrangeNudge === "function") {
          this.schemaArrangeNudge(Number(direction) || 0, { coalesceKey: null });
          return;
        }
      } catch (_) {}
      return origMoveSelected.call(this, direction);
    };

    proto.schemaRemoveSelected = function schemaRemoveSelectedArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          this.schemaArrangeFlashPending?.();
          return;
        }
      } catch (_) {}
      return origRemove.apply(this, args);
    };

    proto.schemaToggleSelected = function schemaToggleSelectedArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          this.schemaArrangeFlashPending?.();
          return;
        }
      } catch (_) {}
      return origToggle.apply(this, args);
    };

    proto.schemaApply = function schemaApplyArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          return this.schemaArrangeApply?.();
        }
      } catch (_) {}
      return origApply.apply(this, args);
    };

    proto.schemaApplyCurrentPreview = function schemaApplyCurrentArrange(...args) {
      try {
        if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          return this.schemaArrangeApplyCurrent?.();
        }
      } catch (_) {}
      return origApplyCurrent.apply(this, args);
    };

    proto.schemaRebaseAndPreview = async function schemaRebaseArrange(...args) {
      try {
        if (this.latestSchemaModel && typeof this.schemaArrangeRebaseFromLatest === "function") {
          const rebased = this.schemaArrangeRebaseFromLatest();
          if (rebased) {
            this.paintSchemaCard("body");
            try { await this.session.previewNow(); } catch (_) {}
            return;
          }
        }
      } catch (_) {}
      return origRebase.apply(this, args);
    };

    proto.schemaHandleEscape = function schemaHandleEscapeArrange(...args) {
      try {
        if (this.sessionState?.status !== "applying" && this.schemaHintMode) {
          this.schemaHintMode = null;
          this.paintSchemaCard("body");
          return "stay";
        }
      } catch (_) {}
      try {
        if (this.sessionState?.status !== "applying"
          && typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
          if (typeof this.schemaArrangeRevert === "function") this.schemaArrangeRevert();
          else {
            try { this.session.setDraft([]); } catch (_) {}
            try { this.sessionState = this.session.getState(); } catch (_) {}
            this.paintSchemaCard("session");
          }
          return "stay";
        }
      } catch (_) {}
      return origEscape.apply(this, args);
    };

    proto.schemaAction = function schemaActionArrange(action, ...rest) {
      try {
        if (!action) return origAction.call(this, action, ...rest);
        if (action === "move-first") {
          try { this.schemaArrangeToEdge?.("first"); } catch (_) {}
          return;
        }
        if (action === "move-last") {
          try { this.schemaArrangeToEdge?.("last"); } catch (_) {}
          return;
        }
        if (action === "move-to") {
          try { this.schemaArrangeEnterHintMode?.(); } catch (_) {}
          return;
        }
        if (action === "revert-arrange") {
          try { this.schemaArrangeRevert?.(); } catch (_) {}
          return;
        }
        if (action === "undo") {
          try {
            if (typeof this.schemaArrangeStepBackOrUndo === "function") {
              this.schemaArrangeStepBackOrUndo();
              return;
            }
          } catch (_) {}
        }
        if ((action === "apply" || action === "submit-stage") && !this.stage) {
          try {
            if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
              if (typeof this.schemaArrangeEnter === "function") {
                this.schemaArrangeEnter();
                return;
              }
            }
          } catch (_) {}
        }
        if ((action === "add-field" || action === "add-choice" || action === "edit") && !this.stage) {
          try {
            if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
              this.schemaArrangeFlashPending?.();
              return;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return origAction.call(this, action, ...rest);
    };

    proto.schemaOnKeyDown = function schemaOnKeyDownArrange(event) {
      try {
        if (!event || event.isComposing || event.keyCode === 229) return;
        if (event.defaultPrevented || event.__schemaEscapeHandled) return;
        const inInput = Boolean(event.target?.closest?.("input,select,textarea"));
        const altJ = event.altKey && (event.key === "j" || event.key === "J" || event.code === "KeyJ");
        const altK = event.altKey && (event.key === "k" || event.key === "K" || event.code === "KeyK");
        const altArrow = event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key);
        if ((altJ || altK || altArrow) && inInput) {
          try { event.preventDefault?.(); } catch (_) {}
          if (this.stage) return;
        }
        if (this.schemaHintMode && !this.stage && this.sessionState?.status !== "applying") {
          const hintCloseKind = typeof bobCardCloseKey === "function"
            ? bobCardCloseKey(event)
            : (event.key === "Escape" ? "escape" : null);
          if (hintCloseKind === "escape" || hintCloseKind === "ctrl-bracket" || hintCloseKind === "q") {
            this.schemaHintMode = null;
            this.paintSchemaCard("body");
            try { event.preventDefault?.(); } catch (_) {}
            try { event.stopPropagation?.(); } catch (_) {}
            try {
              if (typeof this.schemaMarkEscapeHandled === "function") this.schemaMarkEscapeHandled(event);
            } catch (_) {}
            return;
          }
          const key = String(event.key || "").toLowerCase();
          if (key && key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            try {
              if (typeof this.schemaArrangeHintKey === "function" && this.schemaArrangeHintKey(key)) {
                try { event.preventDefault?.(); } catch (_) {}
                return;
              }
            } catch (_) {}
          }
        }
        if (!this.stage && this.sessionState?.status !== "applying" && this.schemaFresh?.()) {
          if (altJ || altK) {
            try { event.preventDefault?.(); } catch (_) {}
            if (event.shiftKey) {
              try { this.schemaArrangeToEdge?.(altJ ? "last" : "first"); } catch (_) {}
            } else {
              try { this.schemaArrangeNudge?.(altJ ? 1 : -1, { coalesceKey: "alt-hold" }); } catch (_) {}
            }
            return;
          }
          if (altArrow) {
            try { event.preventDefault?.(); } catch (_) {}
            const down = event.key === "ArrowDown" || event.key === "ArrowRight";
            if (event.shiftKey) {
              try { this.schemaArrangeToEdge?.(down ? "last" : "first"); } catch (_) {}
            } else {
              try { this.schemaArrangeNudge?.(down ? 1 : -1, { coalesceKey: "alt-hold" }); } catch (_) {}
            }
            return;
          }
        }
        if (!this.stage && !inInput) {
          const key = String(event.key || "");
          const lower = key.toLowerCase();
          const ctrlJump = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (lower === "j" || lower === "k");
          if (this.schemaHintMode && (/^[0-9]$/.test(key) || key === "J" || key === "K" || key === "j" || key === "k" || ctrlJump)) {
            try { event.preventDefault?.(); } catch (_) {}
            return;
          }
        }
        if (!this.stage && !inInput && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const key = String(event.key || "");
          if ((key === "m" || key === "M") && (typeof this.schemaArrangeDirty === "function")) {
            try {
              if (this.schemaArrangeEnterHintMode?.()) {
                try { event.preventDefault?.(); } catch (_) {}
                return;
              }
            } catch (_) {}
          }
          if (key === "u" || key === "U") {
            try {
              if (typeof this.schemaArrangeStepBackOrUndo === "function") {
                this.schemaArrangeStepBackOrUndo();
                try { event.preventDefault?.(); } catch (_) {}
                return;
              }
            } catch (_) {}
          }
        }
        if (!this.stage && event.key === "Enter" && !inInput) {
          try {
            if (typeof this.schemaArrangeDirty === "function" && this.schemaArrangeDirty()) {
              try { event.preventDefault?.(); } catch (_) {}
              if (typeof this.schemaArrangeEnter === "function") this.schemaArrangeEnter();
              return;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return origKeyDown.call(this, event);
    };

    proto.onClose = function onCloseArrange(...args) {
      try {
        const status = this.session?.getState?.()?.status;
        if (status === "applying") {
          this.schemaClosedDuringSave = true;
          try {
            if (typeof bobCardUnwireCloseKeys === "function") bobCardUnwireCloseKeys(this);
          } catch (_) {}
          try { this.schemaUnsubscribe?.(); } catch (_) {}
          this.schemaUnsubscribe = null;
          try {
            if (this.schemaPlugin && this.schemaPlugin.albumSchemaCardModal === this) {
              this.schemaPlugin.albumSchemaCardModal = null;
            }
          } catch (_) {}
          return;
        }
      } catch (_) {}
      return origClose.apply(this, args);
    };

    try {
      Object.defineProperty(proto, "__schemaArrangeWired", { value: true, configurable: true });
    } catch (_) {
      proto.__schemaArrangeWired = true;
    }
  } catch (_) {}
})();
