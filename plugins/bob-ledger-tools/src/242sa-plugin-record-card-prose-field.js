// Record Card prose fields (S15). The text, suggest, and text-list item
// inputs complete `[[` and `((` inline through nav's proseField; the link
// stage (and link-list items) is a field-mode consumer of the same engine, so
// the whole value is one link target. The card is an explicit consumer: its Esc / q /
// Ctrl+[ ladder calls backOut() first, and its typed-stage key handler offers
// every key to the band before Enter save, Tab, list Enter, and suggest
// cycling. Typed stages keep their live input across repaints (242o/242q),
// so the band, caret, IME state, and native undo survive each keystroke.
// Without nav, or with an older nav, the stages stay plain typing.
function recordCardProseFieldApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
    const prose = nav && nav.api && nav.api.proseField;
    if (!prose || Number(prose.version) < 1 || typeof prose.attach !== "function") return null;
    return prose;
  } catch (_) {
    return null;
  }
}

function recordCardProseListen(modal, binding) {
  if (!binding || binding.kind !== "suggest") return;
  const input = binding.inputEl;
  if (!input || typeof input.addEventListener !== "function") return;
  // Registered after the controller's own listeners, so these run once the
  // band has settled and hand the combobox relationship back to the
  // suggestion list whenever the band is closed.
  const restore = () => {
    try { modal.recordProseRestoreAria(); } catch (_) {}
  };
  binding.restoreAria = restore;
  for (const type of ["input", "keyup", "blur"]) {
    try { input.addEventListener(type, restore); } catch (_) {}
  }
}

function recordCardProseUnlisten(binding) {
  const input = binding && binding.inputEl;
  const restore = binding && binding.restoreAria;
  if (!input || !restore || typeof input.removeEventListener !== "function") return;
  for (const type of ["input", "keyup", "blur"]) {
    try { input.removeEventListener(type, restore); } catch (_) {}
  }
  binding.restoreAria = null;
}

const recordCardPaintBeforeProse = RecordCardModal.prototype.paintRecordCard;
const recordCardHandleEscapeBeforeProse = RecordCardModal.prototype.recordHandleEscape;
const recordCardOnCloseBeforeProse = RecordCardModal.prototype.onClose;

Object.assign(RecordCardModal.prototype, {
  paintRecordCard() {
    recordCardPaintBeforeProse.call(this);
    try {
      const card = this.contentEl?.querySelector?.(".bob-record-card");
      const input = card?.querySelector?.("[data-record-card-stage] [data-record-input='stage-text']")
        || card?.querySelector?.("[data-record-card-stage-host] [data-record-input='stage-text']");
      if (input && input.tagName === "TEXTAREA" && typeof bobSoftLineAttach === "function") {
        try {
          bobSoftLineAttach(input, {
            skip: () => {
              try { return this.recordProseBinding?.handle?.isNaming?.() === true; } catch (_) { return false; }
            },
            onFold: () => {
              try {
                const target = this.stage ? recordCardTargetByKey(this.recordTargets(), this.stage.field) : this.recordSelected();
                const label = (target && (target.label || target.key)) || "Field";
                this.stageNote = `Line breaks became spaces — ${label} is one line.`;
              } catch (_) {
                try { this.stageNote = "Line breaks became spaces — this field is one line."; } catch (_) {}
              }
              try { this.paintRecordCard(); } catch (_) {}
            },
          });
        } catch (_) {}
        try { if (typeof bobSoftLineAutosize === "function") bobSoftLineAutosize(input); } catch (_) {}
      }
    } catch (_) {}
    this.recordSyncProseField();
  }
,
  recordHandleEscape(event) {
    // First rung of the card's back-out ladder: an open LINK band closes
    // alone, one layer per press, before the stage or the card.
    if (this.recordProseBackOut(event)) return "stay";
    return recordCardHandleEscapeBeforeProse.call(this, event);
  }
,
  onClose() {
    this.recordDetachProseField();
    return recordCardOnCloseBeforeProse.call(this);
  }
,
  recordProseLinkOpen() {
    const binding = this.recordProseBinding;
    if (!binding || !binding.handle) return false;
    try { return binding.handle.isLinkOpen() === true; } catch (_) { return false; }
  }
,
  recordProseStageNodes(stage) {
    try {
      const card = this.contentEl?.querySelector?.(".bob-record-card");
      if (!card || !stage) return null;
      const host = card.querySelector?.("[data-record-card-stage]") || recordCardRegion(card, "stage");
      if (!host) return null;
      const input = host.querySelector?.(`[data-record-input='${recordCardStageInputKey(stage.kind)}']`);
      const band = host.querySelector?.("[data-record-band]");
      if (!input || !band) return null;
      if (input.getAttribute?.("data-target-key") !== stage.field) return null;
      return { input, band };
    } catch (_) {
      return null;
    }
  }
,
  recordSyncProseField() {
    if (this.closed) {
      this.recordDetachProseField();
      return;
    }
    const stage = this.stage;
    const target = stage ? recordCardTargetByKey(this.recordTargets(), stage.field) : null;
    const mode = stage && target ? recordCardStageProseMode(stage.kind, target.field) : null;
    const nodes = mode ? this.recordProseStageNodes(stage) : null;
    if (!mode || !nodes) {
      this.recordDetachProseField();
      return;
    }
    const binding = this.recordProseBinding;
    if (binding && binding.field === stage.field && binding.kind === stage.kind && binding.mode === mode) {
      if (binding.inputEl !== nodes.input || binding.bandHost !== nodes.band) {
        // Fallback for hosts that could not keep the element: carry the band
        // state onto the new input instead of reattaching.
        recordCardProseUnlisten(binding);
        try { binding.handle.rebind({ inputEl: nodes.input, bandHost: nodes.band }); } catch (_) {}
        binding.inputEl = nodes.input;
        binding.bandHost = nodes.band;
        recordCardProseListen(this, binding);
      }
      this.recordProseRestoreAria();
      return;
    }
    this.recordDetachProseField();
    const api = recordCardProseFieldApi(this.recordPlugin?.app || this.app);
    if (!api) return;
    let handle = null;
    try {
      handle = api.attach({
        inputEl: nodes.input,
        bandHost: nodes.band,
        sourcePath: () => this.recordPath || null,
        recall: null,
        links: true,
        tasks: true,
        mode,
        density: "roomy",
        ownKeys: false,
        arrowKeys: true,
      });
    } catch (_) {
      handle = null;
    }
    if (!handle || typeof handle.handleKeydown !== "function") return;
    this.recordProseBinding = {
      handle,
      field: stage.field,
      kind: stage.kind,
      mode,
      inputEl: nodes.input,
      bandHost: nodes.band,
      restoreAria: null,
    };
    recordCardProseListen(this, this.recordProseBinding);
    this.recordProseRestoreAria();
  }
,
  recordDetachProseField() {
    const binding = this.recordProseBinding;
    this.recordProseBinding = null;
    if (!binding) return;
    recordCardProseUnlisten(binding);
    try { binding.handle.detach(); } catch (_) {}
  }
,
  recordProseOffer(event) {
    const binding = this.recordProseBinding;
    if (!binding || !binding.handle || !event || event.target !== binding.inputEl) return false;
    let wasOpen = false;
    try { wasOpen = binding.handle.isLinkOpen() === true; } catch (_) { wasOpen = false; }
    let consumed = false;
    try { consumed = binding.handle.handleKeydown(event) === true; } catch (_) { consumed = false; }
    // An Enter the open band declined (Shift+Enter in the text textarea)
    // closes the band and stops there: it never saves a half-typed link.
    if (!consumed && wasOpen && event.key === "Enter") consumed = true;
    if (!consumed) return false;
    try { event.preventDefault?.(); } catch (_) {}
    try { event.stopPropagation?.(); } catch (_) {}
    this.recordProseSyncDraft(binding);
    this.recordProseRestoreAria();
    return true;
  }
,
  recordProseBackOut(event) {
    const binding = this.recordProseBinding;
    if (!binding || !binding.handle) return false;
    let consumed = false;
    try { consumed = binding.handle.backOut(event) === true; } catch (_) { consumed = false; }
    if (consumed) this.recordProseRestoreAria();
    return consumed;
  }
,
  recordProseSyncDraft(binding) {
    // Insertions normally arrive through an input event; this covers a
    // controller fallback that assigned the value without one.
    const input = binding && binding.inputEl;
    if (!input || !this.stage || this.closed) return;
    const value = String(input.value == null ? "" : input.value);
    const listItem = this.stage.kind === "list";
    const current = String((listItem ? this.stageItemDraft : this.stageDraftText) || "");
    if (value === current) return;
    if (listItem) this.stageItemDraft = value;
    else this.stageDraftText = value;
    if (typeof input.selectionStart === "number") {
      this.stageCaret = { start: input.selectionStart, end: input.selectionEnd };
    }
    this.recordInvalidatePendingTab();
    void this.recordTypedInput();
  }
,
  recordProseRestoreAria() {
    const binding = this.recordProseBinding;
    if (!binding || binding.kind !== "suggest") return;
    if (this.recordProseLinkOpen()) return;
    recordCardStageComboboxAria(binding.inputEl, binding.field, false);
  }
});
