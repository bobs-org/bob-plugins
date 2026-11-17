// Bank Emoji Slot host: vocabulary from the config report, fused bob labels,
// and capture-phase key isolation so an open panel never saves or files.

function bankCategoryEmojiVocabulary(categories) {
  const rows = [];
  const seen = new Set();
  for (const entry of Array.isArray(categories) ? categories : []) {
    const emoji = typeof entry?.emoji === "string" ? entry.emoji : "";
    const key = typeof albumEmojiSlotGlyphKey === "function" ? albumEmojiSlotGlyphKey(emoji) : emoji;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ emoji, label: String(entry.label || entry.key || "") });
  }
  return rows;
}

function bankCategoryEmojiSiblings(categories, ignoreKey = "") {
  const visible = typeof bankCategoryVisible === "function"
    ? bankCategoryVisible(categories)
    : (Array.isArray(categories) ? categories : []);
  return visible
    .filter((entry) => entry && entry.key !== ignoreKey)
    .map((entry) => ({ emoji: entry.emoji || "", label: entry.label || entry.key || "" }));
}

function bankCategoryEmojiSlotTarget(event) {
  return Boolean(event?.target?.closest?.(".bob-emoji-slot-panel, .bob-emoji-slot-search, [data-emoji-well]"));
}

function bankEmojiSlotInterceptKey(owner, event) {
  const slot = owner?.bankEmojiSlot;
  if (!slot || !event) return false;
  const inSlot = bankCategoryEmojiSlotTarget(event);
  const key = String(event.key || "");
  const consume = () => {
    if (typeof bankCategoryUiConsume === "function") bankCategoryUiConsume(event);
    else {
      try { event.preventDefault?.(); } catch (_) {}
      try { event.stopPropagation?.(); } catch (_) {}
    }
  };
  if (slot.isOpen) {
    if (key === "Escape") {
      consume();
      albumEmojiSlotClose(slot, { focusWell: true });
      return true;
    }
    try {
      const bracket = typeof bobCardCloseKey === "function"
        ? bobCardCloseKey(event) === "ctrl-bracket"
        : Boolean(event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
            (event.code === "BracketLeft" || event.key === "["));
      if (bracket) {
        consume();
        albumEmojiSlotClose(slot, { focusWell: true });
        return true;
      }
    } catch (_) {}
    if (key === "Enter") {
      consume();
      albumEmojiSlotHandleKeydown(slot, event);
      return true;
    }
    if (key === "Tab") {
      consume();
      albumEmojiSlotClose(slot, { focusWell: true });
      return true;
    }
    return true;
  }
  if (inSlot) return true;
  return false;
}

function bankCategoryEmojiSlotMount(host, labelInput, owner, options = {}) {
  if (!host || !labelInput || typeof albumEmojiSlotControl !== "function") return null;
  const doc = host.ownerDocument || owner?.contentEl?.ownerDocument || owner?.app?.document;
  const ignoreKey = options.ignoreKey || "";
  const slot = albumEmojiSlotControl(doc, host, options.caption || "Emoji", options.inputName || "emoji",
    options.emoji || "", labelInput, {
      app: owner.app,
      vocabularyTitle: "In your bank",
      getVocabulary: () => bankCategoryEmojiVocabulary(owner.categories),
      getSiblings: () => bankCategoryEmojiSiblings(owner.categories, ignoreKey),
      onPick: (name, glyph) => {
        if (typeof owner.onFieldInput === "function" && owner.stage) owner.onFieldInput(name, glyph);
        else if (typeof owner.onNewCategoryFieldInput === "function") owner.onNewCategoryFieldInput(name, glyph);
      },
      onOpen: (openSlot) => {
        if (owner.bankEmojiSlot && owner.bankEmojiSlot !== openSlot && owner.bankEmojiSlot.isOpen) {
          albumEmojiSlotClose(owner.bankEmojiSlot, { focusWell: false });
        }
        owner.bankEmojiSlot = openSlot;
      },
      onClose: () => {},
    }, { fused: true, disabled: options.disabled === true });
  owner.bankEmojiSlot = slot;
  const well = slot?.well;
  if (well?.setAttribute) {
    well.setAttribute("data-setup-card-focus", "emoji");
    well.setAttribute("data-bank-new-field", "emoji");
  }
  return slot;
}

{
  if (typeof BankSetupCardModal === "function") {
    const proto = BankSetupCardModal.prototype;
    const origKeyDown = proto.onKeyDown;
    const origBackOut = proto.bankSetupBackOut;
    const origCancel = proto.cancelStage;
    const origClose = proto.onClose;
    proto.onKeyDown = async function bankEmojiOnKeyDown(event) {
      if (bankEmojiSlotInterceptKey(this, event)) return;
      return origKeyDown.call(this, event);
    };
    if (typeof origBackOut === "function") {
      proto.bankSetupBackOut = function bankEmojiBackOut(...args) {
        try {
          if (this.bankEmojiSlot?.isOpen) {
            try { albumEmojiSlotClose(this.bankEmojiSlot, { focusWell: true }); } catch (_) {}
            return "stay";
          }
        } catch (_) {}
        return origBackOut.apply(this, args);
      };
    }
    proto.cancelStage = function bankEmojiCancelStage() {
      if (this.bankEmojiSlot?.isOpen) albumEmojiSlotClose(this.bankEmojiSlot, { focusWell: false });
      this.bankEmojiSlot = null;
      return origCancel.call(this);
    };
    proto.onClose = function bankEmojiOnClose() {
      if (this.bankEmojiSlot?.isOpen) albumEmojiSlotClose(this.bankEmojiSlot, { focusWell: false });
      this.bankEmojiSlot = null;
      return origClose.call(this);
    };
  }

  if (typeof BankCategoryCardModal === "function") {
    const proto = BankCategoryCardModal.prototype;
    const origRoute = proto.routeNewCategoryKey;
    const origCloseStage = proto.closeNewCategoryStage;
    const origClose = proto.onClose;
    proto.routeNewCategoryKey = async function bankEmojiRouteNewCategoryKey(event) {
      if (bankEmojiSlotInterceptKey(this, event)) return;
      return origRoute.call(this, event);
    };
    proto.closeNewCategoryStage = function bankEmojiCloseNewCategoryStage() {
      if (this.bankEmojiSlot?.isOpen) albumEmojiSlotClose(this.bankEmojiSlot, { focusWell: false });
      this.bankEmojiSlot = null;
      this.newStageForm = null;
      this.newStageHost = null;
      this.newStagePainted = false;
      return origCloseStage.call(this);
    };
    proto.onClose = function bankEmojiCategoryOnClose() {
      if (this.bankEmojiSlot?.isOpen) albumEmojiSlotClose(this.bankEmojiSlot, { focusWell: false });
      this.bankEmojiSlot = null;
      this.newStageForm = null;
      this.newStageHost = null;
      this.newStagePainted = false;
      return origClose.call(this);
    };
  }
}
