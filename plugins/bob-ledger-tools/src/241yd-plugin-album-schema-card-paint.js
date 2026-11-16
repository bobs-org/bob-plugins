// Region paint and Enter-latch methods for AlbumSchemaCardModal. Kept in
// their own fragment so the card class stays at or below 1000 lines.
Object.assign(AlbumSchemaCardModal.prototype, {
  schemaPaintOptions() {
    const state = this.schemaState();
    let arrange = null;
    try {
      const dirty = typeof this.schemaArrangeDirty === "function" ? this.schemaArrangeDirty() : false;
      const loud = typeof this.schemaArrangeIsLoud === "function" ? this.schemaArrangeIsLoud() : { loud: false, reasons: [] };
      let pendingText = "";
      let projected = null;
      let deltas = null;
      try {
        if (dirty && this.schemaArrangement) {
          pendingText = schemaArrangePendingText(this.schemaArrangement, this.schemaModel);
          projected = this.schemaArrangement.scopes();
          deltas = {};
          for (const scope of this.schemaArrangement.scopeIds()) {
            for (const id of this.schemaArrangement.projected(scope)) {
              const delta = this.schemaArrangement.delta(scope, id);
              if (Number.isInteger(delta) && delta !== 0) deltas[`${scope}:${id}`] = delta;
            }
          }
        }
      } catch (_) {}
      arrange = {
        dirty: dirty === true,
        loud: Boolean(loud?.loud),
        loudReasons: Array.isArray(loud?.reasons) ? loud.reasons : [],
        confirm: this.schemaArrangeConfirm === true,
        saving: this.schemaSaving === true,
        hintMode: this.schemaHintMode || null,
        pendingText,
        projected,
        deltas: deltas || {},
        savedFlash: Boolean(this.schemaSavedAt && Date.now() - this.schemaSavedAt < 3000),
      };
    } catch (_) {
      arrange = null;
    }
    return {
      selectedKey: this.selectedKey,
      selectedIndex: this.selectedIndex,
      desktop: true,
      editable: Boolean(this.session),
      fresh: this.schemaFresh(),
      editingUnavailable: this.schemaUnavailable || (!this.schemaFresh()
        ? this.schemaApplyNotice || "Editing waits for a fresh album report."
        : ""),
      state,
      stage: this.stage,
      stageDraft: this.stageDraft,
      stageLocked: state.status === "applying" || !this.schemaFresh(),
      hasFreshReplacement: Boolean(this.latestSchemaModel?.schemaFingerprint),
      enterLatched: Boolean(this.schemaEnterLatch),
      moreOpen: this.schemaMoreOpen === true,
      arrange,
      handlers: {
        jumpYaml: (line) => this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line),
      },
    };
  },

  schemaCardEl() {
    return this.contentEl?.querySelector?.(".bob-album-schema-dialog") || null;
  },

  schemaFocusAfterPaint(force = false) {
    const host = this.contentEl;
    if (!host || this.schemaComposing) return;
    const active = host.ownerDocument?.activeElement;
    const activeInCard = Boolean(active && (active === host || host.contains?.(active)));
    if (this.stage) {
      const wanted = this.stageDraft?.focusName;
      const input = wanted
        ? host.querySelector?.(`[data-schema-input="${wanted}"]`)
        : host.querySelector?.("[data-schema-input]");
      if (!force && activeInCard && active?.getAttribute?.("data-schema-input")) return;
      try { input?.focus?.({ preventScroll: true }); } catch (_) {}
      if (input && this.stageDraft && Number.isInteger(this.stageDraft.selectionStart) &&
          typeof input.setSelectionRange === "function") {
        try {
          input.setSelectionRange(
            this.stageDraft.selectionStart,
            this.stageDraft.selectionEnd,
            this.stageDraft.selectionDirection || "none",
          );
        } catch (_) {}
      }
      return;
    }
    if (!force && activeInCard && active?.getAttribute?.("data-target-key") === this.selectedKey) return;
    const selected = host.querySelector?.(`[data-target-key="${this.selectedKey}"]`)
      || host.querySelector?.(".bob-album-schema-field")
      || host.querySelector?.(".bob-album-schema-issue");
    try { selected?.focus?.({ preventScroll: true }); } catch (_) {}
  },

  paintSchemaCard(reason = "full") {
    const host = this.contentEl;
    if (!host) return;
    const targets = this.schemaTargets();
    if (targets.length && !targets.some((target) => target.key === this.selectedKey)) {
      const index = Math.min(this.selectedIndex || 0, targets.length - 1);
      this.selectedKey = targets[index].key;
      this.selectedIndex = index;
    }
    const doc = notebookDomDoc(host) || host.ownerDocument || (typeof document !== "undefined" ? document : null);
    const options = this.schemaPaintOptions();
    let card = this.schemaCardEl();
    const composing = this.schemaComposing === true;
    if (!card || reason === "full" || !card.parentNode) {
      try { host.empty?.(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
      card = albumSchemaCardBuildEl(this.schemaModel, options, doc);
      if (card) host.appendChild(card);
      this.schemaStagePaintKey = albumSchemaCardStageKey(this.stage);
      this.schemaFocusAfterPaint(true);
      return;
    }
    if (composing && (reason === "full" || reason === "stage" || reason === "body")) {
      albumSchemaCardPaintStatus(card, options, doc);
      albumSchemaCardPaintHints(card, this.schemaModel, options, doc);
      return;
    }
    if (reason === "select") {
      albumSchemaCardPaintSelection(card, this.selectedKey);
      albumSchemaCardPaintHints(card, this.schemaModel, options, doc);
      this.schemaFocusAfterPaint(false);
      return;
    }
    if (reason === "session") {
      albumSchemaCardPaintStatus(card, options, doc);
      albumSchemaCardPaintHints(card, this.schemaModel, options, doc);
      const stageKey = albumSchemaCardStageKey(this.stage);
      if (stageKey !== this.schemaStagePaintKey) {
        albumSchemaCardPaintStage(card, this.schemaModel, options, doc);
        this.schemaStagePaintKey = stageKey;
      } else {
        albumSchemaCardPaintStageStatus(card, options);
      }
      return;
    }
    if (reason === "stage") {
      albumSchemaCardPaintStage(card, this.schemaModel, options, doc);
      this.schemaStagePaintKey = albumSchemaCardStageKey(this.stage);
      albumSchemaCardPaintStatus(card, options, doc);
      albumSchemaCardPaintHints(card, this.schemaModel, options, doc);
      this.schemaFocusAfterPaint(true);
      return;
    }
    albumSchemaCardPaintHeader(card, this.schemaModel, options, doc);
    albumSchemaCardPaintLint(card, this.schemaModel, options, doc);
    albumSchemaCardPaintBody(card, this.schemaModel, options, doc);
    albumSchemaCardPaintStage(card, this.schemaModel, options, doc);
    albumSchemaCardPaintStatus(card, options, doc);
    albumSchemaCardPaintHints(card, this.schemaModel, options, doc);
    this.schemaStagePaintKey = albumSchemaCardStageKey(this.stage);
    this.schemaFocusAfterPaint(reason === "body");
  },

  schemaClearEnterLatch() {
    if (!this.schemaEnterLatch) return;
    this.schemaEnterLatch = null;
  },

  schemaArmEnterLatch() {
    const state = this.session?.getState?.() || {};
    this.schemaEnterLatch = { revision: state.revision, expect: state.expect };
    this.paintSchemaCard("session");
  },

  schemaLatchShouldFire(state) {
    const latch = this.schemaEnterLatch;
    if (!latch || !state) return false;
    if (state.revision !== latch.revision) return false;
    return state.canApply === true;
  },

  schemaLatchShouldClear(state) {
    const latch = this.schemaEnterLatch;
    if (!latch || !state) return false;
    if (state.revision !== latch.revision) return true;
    if (state.status === "preview-pending" || state.status === "applying" || state.busy) return false;
    return state.canApply !== true;
  },

  schemaMaybeFireEnterLatch(state) {
    const current = state || this.session?.getState?.() || {};
    if (this.schemaLatchShouldFire(current)) {
      this.schemaClearEnterLatch();
      void this.schemaApply();
      return true;
    }
    if (this.schemaLatchShouldClear(current)) {
      this.schemaClearEnterLatch();
      this.paintSchemaCard("session");
    }
    return false;
  },
});
