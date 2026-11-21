// Record Card typed stages: seeding, list/suggest/link picks, and key dispatch.
Object.assign(RecordCardModal.prototype, {
  recordPaintOptions() {
    const target = this.recordSelected();
    const reportField = recordCardFieldFromReport(this.latestReport, target && target.key);
    const stageTarget = this.stage ? recordCardTargetByKey(this.recordTargets(), this.stage.field) : target;
    const stageReportField = stageTarget ? recordCardFieldFromReport(this.latestReport, stageTarget.key) : reportField;
    const choiceTarget = stageTarget && stageTarget.kind === "choices" ? stageTarget : target;
    const choiceReportField = choiceTarget
      ? recordCardFieldFromReport(this.latestReport, choiceTarget.key)
      : reportField;
    const allChoices = choiceTarget && choiceTarget.kind === "choices"
      ? recordCardChoiceList(choiceTarget.field, choiceReportField)
      : [];
    const visibleChoices = recordCardFilterChoices(allChoices, this.choiceFilter, this.choiceDigitPrefix);
    return {
      selectedKey: this.selectedKey,
      targets: this.recordTargets(),
      stage: this.stage,
      filter: this.choiceFilter,
      choiceDigitPrefix: this.choiceDigitPrefix,
      selectedChoice: this.selectedChoice,
      currentValue: target && target.value != null ? String(target.value) : "",
      visibleChoices,
      reportField: stageReportField,
      stageDraftText: this.stageDraftText,
      draftText: this.stageDraftText,
      stageList: this.stageList.slice ? this.stageList.slice() : [],
      draftList: this.stageList.slice ? this.stageList.slice() : [],
      stageItemDraft: this.stageItemDraft,
      draftItemDraft: this.stageItemDraft,
      stagePreview: this.stagePreview,
      stageCaret: this.stageCaret,
      composing: this.composing,
      linkBandOpen: typeof this.recordProseLinkOpen === "function" ? this.recordProseLinkOpen() : false,
      focusStage: true,
      recordPath: this.recordPath,
      plugin: this.recordPlugin,
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
,
  recordRestoreFocus() {
    try {
      const card = this.contentEl?.querySelector?.(".bob-record-card");
      if (!card) return;
      if (this.composing) return;
      const doc = this.recordDoc();
      const active = doc && doc.activeElement;
      if (this.stage && this.stage.kind === "choices") {
        const input = card.querySelector?.("[data-record-input='choice-filter']");
        if (input && typeof input.focus === "function" && active !== input) {
          if (active && active !== input && active.tagName === "INPUT" && this.statusKind !== "stale") return;
          input.focus();
          if (this.stageCaret && typeof input.setSelectionRange === "function") {
            try { input.setSelectionRange(this.stageCaret.start, this.stageCaret.end); } catch (_) {}
          }
          return;
        }
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        return;
      }
      if (this.stage) {
        const activeInput = active && active.getAttribute?.("data-record-input");
        if (activeInput && String(activeInput).startsWith("stage-")) return;
        const input = card.querySelector?.("[data-record-card-stage] [data-record-input^='stage-']")
          || card.querySelector?.("[data-record-card-stage-host] [data-record-input^='stage-']");
        if (input && typeof input.focus === "function") {
          input.focus();
          if (this.stageCaret && typeof input.setSelectionRange === "function" && input.value != null) {
            try { input.setSelectionRange(this.stageCaret.start, this.stageCaret.end ?? this.stageCaret.start); } catch (_) {}
          }
          return;
        }
      }
      if (active && active.tagName === "INPUT" && active.getAttribute?.("data-record-input")?.startsWith("stage-")) return;
      const row = card.querySelector?.(`[data-target-key="${this.selectedKey}"]`);
      if (row && typeof row.focus === "function" && active !== row) row.focus();
    } catch (_) {}
  }
,
  recordSelect(key) {
    const targets = this.recordTargets();
    const index = targets.findIndex((target) => target.key === key);
    if (index < 0) return;
    this.recordInvalidatePendingTab();
    if (this.selectedKey !== key) this.choiceDigitPrefix = "";
    this.selectedKey = key;
    this.selectedIndex = index;
    this.announce = recordCardLiveAnnouncement("select", targets[index]);
    this.paintRecordCard();
  }
,
  recordShiftStep(delta, event) {
    if (event && event.repeat) return true;
    const targets = this.recordTargets();
    const next = typeof recordCardShiftStep === "function"
      ? recordCardShiftStep(targets, this.selectedKey, delta)
      : null;
    const card = this.contentEl?.querySelector?.(".bob-record-card");
    const row = card?.querySelector?.(`[data-target-key="${this.selectedKey}"]`) || card;
    if (!next) {
      try { if (typeof schemaCardBump === "function") schemaCardBump(row, Number(delta) < 0 ? -1 : 1); } catch (_) {}
      const message = Number(delta) < 0 ? "No previous field" : "No next field";
      this.announce = message;
      try { if (typeof schemaArrangeAnnounce === "function") schemaArrangeAnnounce(card, message); } catch (_) {}
      this.paintRecordCard();
      return true;
    }
    const index = targets.findIndex((target) => target.key === next);
    this.recordInvalidatePendingTab();
    this.selectedKey = next;
    this.selectedIndex = Math.max(0, index);
    const target = targets[Math.max(0, index)];
    const total = targets.length;
    const message = typeof recordCardShiftAnnouncement === "function"
      ? recordCardShiftAnnouncement(target, Math.max(0, index), total)
      : `${target.label || target.key}, field ${index + 1} of ${total}`;
    this.announce = message;
    try { if (typeof schemaArrangeAnnounce === "function") schemaArrangeAnnounce(card, message); } catch (_) {}
    this.paintRecordCard();
    return true;
  }
,
  recordInvalidatePendingTab() {
    this.pendingTab = null;
  }
,
  recordTypedDraftFor(target) {
    return {
      text: String(this.stageDraftText || ""),
      list: Array.isArray(this.stageList) ? this.stageList.slice() : [],
      itemDraft: String(this.stageItemDraft || ""),
      selectedChoice: String(this.selectedChoice || ""),
    };
  }
,
  recordTypedChanged(target) {
    if (!target || !this.stage || this.stage.field !== target.key) return false;
    if (typeof recordCardDraftEqualsSeed === "function") {
      return !recordCardDraftEqualsSeed(target, this.recordTypedDraftFor(target));
    }
    return String(this.stageDraftText || "") !== (typeof recordCardSeedText === "function" ? recordCardSeedText(target) : "");
  }
,
  recordOpenStage(kind, fieldKey = this.selectedKey, options = {}) {
    const target = recordCardTargetByKey(this.recordTargets(), fieldKey);
    if (!target) return false;
    this.recordInvalidatePendingTab();
    this.selectedKey = fieldKey;
    this.selectedIndex = Math.max(0, this.recordTargets().findIndex((row) => row.key === fieldKey));
    const resolved = kind || target.stageKind;
    if (!resolved) {
      this.statusKind = "typed-stage";
      this.paintRecordCard();
      return false;
    }
    this.stage = { kind: resolved, field: fieldKey };
    this.menuOpen = false;
    this.stagePreview = null;
    this.stageEnterSeq = 0;
    if (resolved === "choices") {
      this.choiceFilter = options.filter || "";
      this.choiceDigitPrefix = options.prefix || options.choiceDigitPrefix || "";
      this.selectedChoice = options.selectedChoice || (target.value != null ? String(target.value) : "");
      const reportField = recordCardFieldFromReport(this.latestReport, target.key);
      const allChoices = recordCardChoiceList(target.field, reportField);
      const visibleChoices = recordCardFilterChoices(allChoices, this.choiceFilter, this.choiceDigitPrefix);
      if (!visibleChoices.some((choice) => choice.value === this.selectedChoice)) {
        this.selectedChoice = visibleChoices[0] ? visibleChoices[0].value : "";
      }
      this.stageDraft = options.draft || "";
      this.stageDraftText = "";
      this.stageList = [];
      this.stageItemDraft = "";
    } else if (resolved === "list") {
      this.choiceDigitPrefix = "";
      const seed = typeof recordCardSeedStage === "function" ? recordCardSeedStage(target) : { list: [] };
      this.stageList = Array.isArray(options.list) ? options.list.slice() : (seed.list || []).slice();
      this.stageItemDraft = options.itemDraft || "";
      this.stageDraftText = "";
      this.choiceFilter = "";
      this.selectedChoice = "";
    } else {
      this.choiceDigitPrefix = "";
      const seed = typeof recordCardSeedStage === "function" ? recordCardSeedStage(target) : { text: "" };
      this.stageDraftText = options.draft !== undefined ? String(options.draft) : String(seed.text || "");
      this.stageList = [];
      this.stageItemDraft = "";
      this.choiceFilter = options.filter || "";
      this.selectedChoice = "";
    }
    this.stageCaret = options.caret || null;
    if (this.session && this.writable) {
      try { this.session.setDraft([]); } catch (_) {}
      this.sessionState = this.session.getState?.() || this.sessionState;
    }
    if (this.statusKind === "stale" || this.statusKind === "refusal" || this.statusKind === "consequence" || this.statusKind === "saved" || this.statusKind === "previewing") {
      this.statusKind = this.writable ? "" : this.statusKind;
      this.refusalMessage = "";
      this.refusalHint = "";
      this.consequence = "";
    }
    this.paintRecordCard();
    return true;
  }
,
  recordCancelStage() {
    this.recordInvalidatePendingTab();
    this.stage = null;
    this.choiceFilter = "";
    this.choiceDigitPrefix = "";
    this.selectedChoice = "";
    this.stageDraft = "";
    this.stageCaret = null;
    this.stageDraftText = "";
    this.stageList = [];
    this.stageItemDraft = "";
    this.stagePreview = null;
    this.stageEnterSeq = 0;
    if (this.session && !this.closed) {
      try { this.session.setDraft([]); } catch (_) {}
      try { this.sessionState = this.session.getState?.() || this.sessionState; } catch (_) {}
    }
    if (this.statusKind === "refusal" || this.statusKind === "consequence" || this.statusKind === "stale" || this.statusKind === "previewing") {
      this.statusKind = this.writable ? "" : this.statusKind;
      this.refusalMessage = "";
      this.refusalHint = "";
      this.consequence = "";
    }
    this.paintRecordCard();
  }
,
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
    if (action === "next-field") { this.recordShiftStep(1, { repeat: false }); return; }
    if (action === "prev-field") { this.recordShiftStep(-1, { repeat: false }); return; }
    if (action === "save-stage") { void this.recordSaveTyped(0); return; }
    if (action === "save-next") { void this.recordSaveTyped(1); return; }
    if (action === "save-prev") { void this.recordSaveTyped(-1); return; }
    if (action === "pick-choice" || action === "apply-choice") {
      void this.recordApplyChoice(payload && payload.value);
      return;
    }
    if (action === "pick-suggest") {
      void this.recordPickSuggest(payload && payload.value);
      return;
    }
    if (action === "edit-chip") {
      this.recordEditChip(payload);
      return;
    }
    if (action === "remove-chip") {
      this.recordRemoveChip(payload);
      return;
    }
    if (action === "today") { void this.recordApplyToday(); return; }
    if (action === "clear") { void this.recordClear(); return; }
    if (action === "undo") { void this.recordUndo(); return; }
    if (action === "yaml") { void this.recordYaml(); return; }
    if (action === "schema") { void this.recordSchema(); return; }
    if (action === "retry") { void this.recordRetry(); return; }
  }
,
  recordOnClick(event) {
    const button = event?.target?.closest?.("button[data-record-action], button[data-target-key]");
    if (!button) return;
    const action = button.getAttribute("data-record-action");
    if (action) {
      event.preventDefault?.();
      void this.recordAction(action, {
        value: button.getAttribute("data-choice-value"),
        index: button.getAttribute("data-chip-index"),
        key: button.getAttribute("data-target-key"),
      });
      return;
    }
    const key = button.getAttribute("data-target-key");
    if (key) {
      if (this.stage) this.recordOpenStage(null, key);
      else this.recordSelect(key);
    }
  }
,
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
      // nav's LINK band (S15) sees every key first: Enter/Tab accept a row,
      // arrows and Ctrl+N/P move it, and a held Enter cannot then save.
      if (typeof this.recordProseOffer === "function" && this.recordProseOffer(event)) return;
      const inputKind = event.target?.getAttribute?.("data-record-input") || "";
      if (event.key === "Tab") {
        event.preventDefault?.();
        event.stopPropagation?.();
        void this.recordTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Enter") {
        if (event.repeat) { event.preventDefault?.(); return; }
        event.preventDefault?.();
        const target = this.recordSelected();
        if (this.stage && this.stage.kind === "choices") {
          void this.recordApplyChoice(this.selectedChoice || (target && target.value));
        } else if (this.stage && this.stage.kind === "list") {
          if (String(inputKind) === "stage-list-item") {
            if (String(this.stageItemDraft || "").trim() !== "") this.recordCommitListItem();
            else void this.recordSaveTyped(0);
          } else {
            void this.recordSaveTyped(0);
          }
        } else if (this.stage) {
          if (String(inputKind) === "choice-filter") {
            void this.recordApplyChoice(this.selectedChoice || (target && target.value));
          } else {
            void this.recordSaveTyped(0);
          }
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault?.();
        this.recordBackOut(event);
        return;
      }
      if (String(inputKind) === "stage-list-item" && event.key === "Backspace"
        && String(this.stageItemDraft || "") === "") {
        event.preventDefault?.();
        this.recordPopListChip();
        return;
      }
      if (String(inputKind) === "choice-filter" && this.stage && this.stage.kind === "choices") {
        if (event.key === "Backspace" && this.choiceDigitPrefix) {
          event.preventDefault?.();
          this.recordPopChoiceDigitPrefix();
          return;
        }
        if (this.recordBare(event) && /^\d$/.test(event.key || "")) {
          event.preventDefault?.();
          if (!event.repeat) this.recordDigit(event.key, true);
          return;
        }
      }
      if (String(inputKind) === "choice-filter" || (this.stage && this.stage.kind === "choices")) {
        const ctrlDelta = recordCardCtrlNavDelta(event);
        if (event.key === "ArrowDown" || ctrlDelta > 0) { event.preventDefault?.(); this.recordMoveChoice(1); return; }
        if (event.key === "ArrowUp" || ctrlDelta < 0) { event.preventDefault?.(); this.recordMoveChoice(-1); return; }
      }
      const suggestCtrlDelta = recordCardCtrlNavDelta(event);
      if (this.stage && (this.stage.kind === "suggest" || this.stage.kind === "link")
        && (event.key === "ArrowDown" || event.key === "ArrowUp" || suggestCtrlDelta)) {
        event.preventDefault?.();
        // The link stage's rows live in the LINK band; with it closed the
        // arrows stay inert instead of cycling a second candidate list.
        if (this.stage.kind === "suggest") {
          this.recordMoveSuggest(event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : suggestCtrlDelta);
        }
        return;
      }
      return;
    }
    if (this.stage && this.stage.kind === "choices") {
      if (event.key === "Enter") {
        event.preventDefault?.();
        void this.recordApplyChoice(this.selectedChoice);
        return;
      }
      const ctrlDelta = recordCardCtrlNavDelta(event);
      if (event.key === "ArrowDown" || (this.recordBare(event) && event.key === "j") || ctrlDelta > 0) {
        event.preventDefault?.();
        this.recordMoveChoice(1);
        return;
      }
      if (event.key === "ArrowUp" || (this.recordBare(event) && event.key === "k") || ctrlDelta < 0) {
        event.preventDefault?.();
        this.recordMoveChoice(-1);
        return;
      }
      if (event.key === "Backspace" && this.choiceDigitPrefix) {
        event.preventDefault?.();
        this.recordPopChoiceDigitPrefix();
        return;
      }
      if (this.recordBare(event) && /^\d$/.test(event.key || "")) {
        event.preventDefault?.();
        if (!event.repeat) this.recordDigit(event.key, true);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (event.repeat) return;
      if (this.stage) void this.recordTab(event.shiftKey ? -1 : 1);
      else this.recordMove(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.shiftKey && (event.key === "J" || event.key === "K")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!this.stage && !this.menuOpen && !this.composing && !event.isComposing && !this.recordInInput(event)) {
        this.recordShiftStep(event.key === "K" ? -1 : 1, event);
      }
      return;
    }
    if (this.stage && this.stage.kind !== "choices") {
      if (event.key === "Enter" && !event.repeat) {
        event.preventDefault?.();
        void this.recordSaveTyped(0);
        return;
      }
      return;
    }
    const browseCtrlDelta = recordCardCtrlNavDelta(event);
    if (browseCtrlDelta) { event.preventDefault?.(); this.recordMove(browseCtrlDelta); return; }
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
      if (event.repeat) return;
      this.recordAction("open-stage");
      return;
    }
    if (this.recordBare(event) && /^\d$/.test(event.key || "")) {
      event.preventDefault?.();
      if (event.repeat) return;
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
,
  recordDigit(digit, fromStage) {
    const target = fromStage && this.stage && this.stage.kind === "choices"
      ? recordCardTargetByKey(this.recordTargets(), this.stage.field)
      : this.recordSelected();
    if (!target) return;
    if (target.kind !== "choices") {
      if (!fromStage) {
        this.statusKind = "refusal";
        this.refusalMessage = typeof RECORD_CARD_DIGIT_TEACH !== "undefined"
          ? RECORD_CARD_DIGIT_TEACH
          : "Digits pick a choice on choice fields";
        this.refusalHint = "";
        this.announce = this.refusalMessage;
        this.paintRecordCard();
      }
      return;
    }
    const reportField = recordCardFieldFromReport(this.latestReport, target.key);
    const all = recordCardChoiceList(target.field, reportField);
    if (!fromStage && all.length >= 10 && target.stageKind !== "choices") return;
    const visible = fromStage
      ? recordCardFilterChoices(all, this.choiceFilter, this.choiceDigitPrefix)
      : all;
    const step = recordCardDigitStep({
      choices: all,
      visible,
      prefix: fromStage ? this.choiceDigitPrefix : "",
      digit,
    });
    if (step.kind === "none") {
      const range = recordCardChoiceRange(all) || "no choices";
      this.statusKind = "refusal";
      this.refusalMessage = `No choice ${step.typed} · choices are ${range}`;
      this.refusalHint = "";
      this.announce = recordCardLiveAnnouncement("refusal", { message: this.refusalMessage });
      this.paintRecordCard();
      return;
    }
    if (step.kind === "prefix") {
      if (!fromStage) {
        if (this.recordOpenStage("choices", target.key, { prefix: step.prefix })) {
          const narrowed = recordCardFilterChoices(all, this.choiceFilter, this.choiceDigitPrefix);
          this.announce = recordCardLiveAnnouncement("choice-prefix", {
            range: recordCardChoiceRange(narrowed),
          });
          this.paintRecordCard();
        }
      } else {
        this.choiceDigitPrefix = step.prefix;
        const narrowed = recordCardFilterChoices(all, this.choiceFilter, this.choiceDigitPrefix);
        if (!narrowed.some((choice) => choice.value === this.selectedChoice)) {
          this.selectedChoice = narrowed[0] ? narrowed[0].value : "";
        }
        this.statusKind = this.writable ? "" : this.statusKind;
        this.refusalMessage = "";
        this.refusalHint = "";
        this.announce = recordCardLiveAnnouncement("choice-prefix", {
          range: recordCardChoiceRange(narrowed),
        });
        this.paintRecordCard();
      }
      return;
    }
    const choice = step.choice;
    this.choiceDigitPrefix = "";
    this.selectedChoice = choice.value;
    if (this.stage && this.stage.kind === "list") {
      this.recordListPickChoice(choice.value);
      return;
    }
    void this.recordApplyChoice(choice.value);
  }
,
  recordPopChoiceDigitPrefix() {
    if (!this.stage || this.stage.kind !== "choices" || !this.choiceDigitPrefix) return;
    this.choiceDigitPrefix = this.choiceDigitPrefix.slice(0, -1);
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    const reportField = recordCardFieldFromReport(this.latestReport, target && target.key);
    const visible = recordCardFilterChoices(
      recordCardChoiceList(target && target.field, reportField),
      this.choiceFilter,
      this.choiceDigitPrefix,
    );
    if (!visible.some((choice) => choice.value === this.selectedChoice)) {
      this.selectedChoice = visible[0] ? visible[0].value : "";
    }
    this.announce = "";
    this.paintRecordCard();
  }
,
  recordMoveSuggest(delta) {
    if (!this.stage || this.stage.kind !== "suggest") return;
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    if (!target) return;
    const reportField = recordCardFieldFromReport(this.latestReport, target.key);
    const values = typeof recordCardSuggestValues === "function"
      ? recordCardSuggestValues(reportField, target.field) : [];
    const visible = typeof recordCardFilterSuggest === "function"
      ? recordCardFilterSuggest(values, this.stageDraftText || "") : values;
    if (!visible.length) return;
    const current = String(this.stageDraftText || "");
    let index = visible.findIndex((row) => String((row && row.value) || "") === current);
    if (index < 0) index = Number(delta) < 0 ? visible.length : -1;
    index = (index + (Number(delta) < 0 ? -1 : 1) + visible.length) % visible.length;
    this.stageDraftText = String(visible[index].value || "");
    this.stageCaret = { start: this.stageDraftText.length, end: this.stageDraftText.length };
    this.recordTypedInput();
  }
,
  recordCommitListItem() {
    const text = String(this.stageItemDraft || "").trim();
    if (!text) return;
    this.stageList = [...(this.stageList || []), text];
    this.stageItemDraft = "";
    this.stageCaret = null;
    this.recordTypedInput();
  }
,
  recordPopListChip() {
    if (!this.stageList || !this.stageList.length) return;
    const popped = this.stageList[this.stageList.length - 1];
    this.stageList = this.stageList.slice(0, -1);
    this.stageItemDraft = String(popped || "");
    this.recordTypedInput();
  }
,
  recordEditChip(payload) {
    const index = Number(payload && payload.index);
    if (!Number.isInteger(index) || index < 0 || !this.stageList || index >= this.stageList.length) return;
    this.stageItemDraft = String(this.stageList[index] || "");
    this.stageList = this.stageList.filter((_, at) => at !== index);
    this.recordTypedInput();
  }
,
  recordRemoveChip(payload) {
    const index = Number(payload && payload.index);
    if (!Number.isInteger(index) || index < 0 || !this.stageList || index >= this.stageList.length) return;
    this.stageList = this.stageList.filter((_, at) => at !== index);
    this.recordTypedInput();
  }
,
  recordListPickChoice(value) {
    if (!this.stage || this.stage.kind !== "list") return;
    const target = recordCardTargetByKey(this.recordTargets(), this.stage.field);
    if (!target) return;
    const scalarKind = String(target.field?.kind || "text").toLowerCase();
    void this.recordListPickValue(String(value), scalarKind);
  }
});
