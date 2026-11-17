// Stable Bank setup card regions, status line, hint strip, and Enter latch.
// Painters refill one region at a time so session previews never rebuild
// the shell or open stage inputs.

function bankSetupCardRegionEmpty(node) {
  if (!node) return;
  try {
    if (typeof node.empty === "function") {
      node.empty();
      return;
    }
  } catch (_) {}
  try {
    if (typeof node.textContent === "string") node.textContent = "";
  } catch (_) {}
  try {
    while (node.firstChild) node.removeChild(node.firstChild);
  } catch (_) {}
}

function bankSetupCardRegion(card, name) {
  if (!card || !name) return null;
  const nodes = card.querySelectorAll?.("[data-setup-region]") || [];
  for (const node of nodes) {
    if (node.getAttribute?.("data-setup-region") === name) return node;
  }
  return null;
}

function bankSetupCardStageKey(stage) {
  if (!stage) return "";
  const id = stage.entry?.key || stage.entry?.alias || stage.entry?.index || stage.group || "";
  return `${stage.kind}:${id}`;
}

function bankSetupCardBuildShell(doc) {
  const host = doc && typeof doc.createElement === "function" ? doc.createElement("div") : null;
  if (!host) return null;
  host.className = "bob-bank-setup-card";
  host.setAttribute("data-bank-setup-card", "true");
  host.setAttribute("role", "document");
  host.setAttribute("aria-label", "Bank setup editor");
  const regions = [
    ["header", "bob-bank-setup-card-header"],
    ["tabs", "bob-bank-setup-card-tabs-host"],
    ["panel", "bob-bank-setup-card-panel"],
    ["selection", "bob-bank-setup-card-selection-host"],
    ["stage", "bob-bank-setup-card-stage-host"],
    ["status", "bob-bank-setup-card-status-host"],
    ["hints", "bob-bank-setup-card-hints"],
    ["live", "bob-bank-setup-card-live"],
  ];
  for (const [name, className] of regions) {
    const region = doc.createElement("div");
    region.className = className;
    region.setAttribute("data-setup-region", name);
    if (name === "panel") {
      region.id = "bob-bank-setup-card-panel";
      region.setAttribute("role", "tabpanel");
    }
    if (name === "status") {
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
    }
    if (name === "live") {
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
    }
    host.appendChild(region);
  }
  return host;
}

function bankSetupCardPaintHeader(card) {
  const host = bankSetupCardRegion(card, "header");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  bankSetupCardAppend(host, "h2", "bob-bank-setup-card-title", "🏦 Bank setup");
}

function bankSetupCardPaintTabsRegion(card, modal, model) {
  const host = bankSetupCardRegion(card, "tabs");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  bankSetupCardPaintTabs(host, modal, model);
}

function bankSetupCardPaintPanel(card, modal, model, doc) {
  const host = bankSetupCardRegion(card, "panel");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  host.setAttribute("aria-label", BANK_SETUP_CARD_SECTION_LABELS[modal.section] || "Categories");
  if (modal.section === "categories") bankSetupCardPaintCategories(host, modal, model, doc);
  else if (modal.section === "accounts") bankSetupCardPaintAccounts(host, modal, model);
  else if (modal.section === "rules") bankSetupCardPaintRules(host, modal, model);
  else bankSetupCardPaintChecks(host, modal, model);
}

function bankSetupCardPaintSelectionRegion(card, modal, model) {
  const host = bankSetupCardRegion(card, "selection");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  bankSetupCardPaintSelection(host, modal, model);
}

function bankSetupCardPaintStageRegion(card, modal, doc, force) {
  const host = bankSetupCardRegion(card, "stage");
  if (!host) return;
  const key = bankSetupCardStageKey(modal.stage);
  if (!force && key && key === modal.bankStagePaintKey && host.firstChild) {
    bankSetupCardPaintStageStatus(host, modal);
    return;
  }
  bankSetupCardRegionEmpty(host);
  if (modal.stage) bankSetupCardPaintStage(host, modal, doc);
  modal.bankStagePaintKey = key;
}

function bankSetupCardPaintStageStatus(host, modal) {
  if (!host) return;
  const state = modal.sessionState || {};
  const latched = Boolean(modal.bankEnterLatch);
  const owner = host.querySelector?.("[data-setup-stage-owner]");
  if (owner && modal.stage?.kind === "new") {
    const status = typeof bankCategoryNewHotkeyStatus === "function"
      ? bankCategoryNewHotkeyStatus(modal.categories, modal.stage.hotkey)
      : { text: "" };
    try {
      if (typeof notebookSetText === "function") notebookSetText(owner, status.text || "");
      else owner.textContent = status.text || "";
    } catch (_) {}
  }
  const apply = host.querySelector?.('[data-setup-action="apply"]');
  if (apply) {
    apply.disabled = modal.busy || modal.readOnly || (state.canApply !== true && !latched);
    const label = latched ? "Saving as soon as bob confirms…" : (modal.stage?.kind === "undo" ? "Undo" : "Apply");
    try {
      if (typeof notebookSetText === "function") notebookSetText(apply, label);
      else apply.textContent = label;
    } catch (_) {}
  }
  const pending = host.querySelector?.(".bob-bank-setup-card-consequence.is-pending");
  if (latched && !pending) {
    bankSetupCardAppend(host, "p", "bob-bank-setup-card-consequence is-pending", "Saving as soon as bob confirms…", {
      role: "status",
      "aria-live": "polite",
    });
  }
}

function bankSetupCardStatusText(modal) {
  const state = modal.sessionState || {};
  const arrange = modal.bankPaintArrange || {};
  if (modal.bankEnterLatch) return "Saving as soon as bob confirms…";
  if (arrange.saving) return `Saving… · ${arrange.pendingText || "Saving…"}`;
  if (modal.errorMessage) return modal.errorMessage;
  if (state.refusal) return state.refusal.message || "bob refused this edit.";
  if (arrange.orderBlocked) return "bob disagrees with this order";
  if (arrange.dirty && arrange.confirm) return "Loud arrangement. Press Enter again to confirm the save.";
  if (arrange.dirty && arrange.pendingText) return arrange.pendingText;
  if (arrange.shifted && arrange.shifted.length) {
    const first = arrange.shifted[0];
    const badge = typeof schemaArrangeHotkeyShiftBadge === "function"
      ? schemaArrangeHotkeyShiftBadge(first)
      : "";
    return badge ? `Hotkey shift ${badge}` : "Hotkeys will shift.";
  }
  if (state.consequence) return state.consequence;
  if (modal.savedMessage) return modal.savedMessage;
  if (modal.staleMessage) return modal.staleMessage;
  return "";
}

function bankSetupCardStatusTone(modal) {
  const state = modal.sessionState || {};
  const arrange = modal.bankPaintArrange || {};
  if (modal.bankEnterLatch || arrange.saving || state.status === "preview-pending" || state.busy) return "is-previewing";
  if (modal.errorMessage || state.refusal || arrange.orderBlocked) return "is-refused";
  if (arrange.dirty && arrange.loud && state.canApply) return "is-confirm";
  if (modal.savedMessage) return "is-saved";
  if (state.canApply) return "is-ready";
  return "";
}

function bankSetupCardPaintStatusRegion(card, modal) {
  const host = bankSetupCardRegion(card, "status");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  const text = bankSetupCardStatusText(modal);
  host.className = `bob-bank-setup-card-status-host ${bankSetupCardStatusTone(modal)}`.trim();
  if (!text) return;
  bankSetupCardAppend(host, "p", "bob-bank-setup-card-status-line", text, { role: "status" });
}

function bankSetupCardHintItems(modal) {
  const mod = typeof Platform !== "undefined" && Platform?.isMacOS === true ? "⌘" : "Ctrl";
  const arrange = modal.bankPaintArrange || {};
  const items = [];
  if (arrange.saving) {
    return [{ keys: "Saving…", label: (arrange.pendingText || "Saving…").slice(0, 80) }];
  }
  if (arrange.hintMode && !modal.stage) {
    items.push({ keys: "a–z", label: "pick gap" });
    items.push({ keys: "esc", label: "leave hint mode" });
    return items;
  }
  if (arrange.dirty && !modal.stage) {
    items.push({ keys: "⏎", label: arrange.confirm ? "confirm save" : "save" });
    items.push({ keys: "esc", label: "revert" });
    items.push({ keys: `${mod}+Z`, label: "step back" });
    items.push({ keys: "⌥M", label: "move to…" });
    return items;
  }
  if (modal.stage) {
    items.push({ keys: "⏎", label: modal.bankEnterLatch ? "saving" : "apply" });
    items.push({ keys: "esc", label: "cancel" });
    items.push({ keys: `${mod}+E`, label: "YAML" });
    return items;
  }
  if (modal.section === "accounts") {
    items.push({ keys: "⏎", label: "relabel" });
    items.push({ keys: "+", label: "add" });
    items.push({ keys: `${mod}+D`, label: "remove" });
  } else if (modal.section === "rules") {
    items.push({ keys: "⏎", label: "edit" });
    items.push({ keys: "+", label: "new" });
    items.push({ keys: "⌥J/K", label: "move" });
    items.push({ keys: `${mod}+D`, label: "remove" });
  } else if (modal.section === "checks") {
    items.push({ keys: "⏎", label: "open line" });
  } else {
    items.push({ keys: "⏎", label: "edit" });
    items.push({ keys: "+", label: "new" });
    items.push({ keys: "⌥J/K", label: "move" });
    items.push({ keys: "⌥M", label: "move to…" });
    items.push({ keys: `${mod}+H`, label: "hide" });
    items.push({ keys: `${mod}+D`, label: "remove" });
  }
  items.push({ keys: `${mod}+E`, label: "YAML" });
  if (modal.sessionState?.undoAvailable || modal.pluginRef?.bankSetupUndoRecord) {
    items.push({ keys: `${mod}+Z`, label: "undo" });
  }
  items.push({ keys: "esc", label: "close" });
  return items;
}

function bankSetupCardPaintHintsRegion(card, modal, doc) {
  const host = bankSetupCardRegion(card, "hints");
  if (!host) return;
  bankSetupCardRegionEmpty(host);
  const strip = bankSetupCardAppend(host, "div", "bob-bank-setup-card-hint-strip");
  for (const item of bankSetupCardHintItems(modal)) {
    const row = bankSetupCardAppend(strip, "span", "bob-bank-setup-card-hint");
    bankSetupCardAppend(row, "kbd", "", item.keys);
    if (typeof doc?.createTextNode === "function") {
      try { row.appendChild(doc.createTextNode(" ")); } catch (_) {}
    }
    bankSetupCardAppend(row, "span", "bob-bank-setup-card-hint-label", item.label);
  }
}

function bankSetupCardPaintLive(card, modal) {
  const host = bankSetupCardRegion(card, "live");
  if (!host) return;
  try {
    if (typeof notebookSetText === "function") notebookSetText(host, modal.liveText || "");
    else host.textContent = modal.liveText || "";
  } catch (_) {}
  modal.liveRegion = host;
}

function bankSetupCardArrangePaintState(modal) {
  const dirty = typeof modal.bankArrangeDirty === "function" ? modal.bankArrangeDirty() : false;
  const loud = typeof modal.bankArrangeIsLoud === "function" ? modal.bankArrangeIsLoud() : { loud: false, reasons: [] };
  let pendingText = "";
  let projected = null;
  let deltas = {};
  try {
    if (dirty && modal.bankArrangement) {
      pendingText = typeof schemaArrangePendingText === "function"
        ? schemaArrangePendingText(modal.bankArrangement, modal.model, {
          labelFor: (scope, id) => schemaArrangeBankLabelFor(modal.model, scope, id),
          stepLabel: "Ctrl+Z step back",
        })
        : "";
      projected = modal.bankArrangement.scopes();
      for (const scope of modal.bankArrangement.scopeIds()) {
        for (const id of modal.bankArrangement.projected(scope)) {
          const delta = modal.bankArrangement.delta(scope, id);
          if (Number.isInteger(delta) && delta !== 0) deltas[`${scope}:${id}`] = delta;
        }
      }
    } else if (modal.bankUndoView && modal.stage?.kind === "undo") {
      const view = modal.bankUndoView;
      projected = {
        groups: (view.groups || []).slice(),
        rules: (modal.model?.ruleItems || []).map((item) => item.id),
      };
      for (const group of projected.groups || []) {
        projected[`group:${group}`] = (view.categories || [])
          .filter((row) => String(row?.group || "") === group && row.hidden !== true)
          .map((row) => row.key);
      }
      if (Array.isArray(view.rules) && modal.model?.ruleItems) {
        const byIndex = new Map((modal.model.ruleItems || []).map((item) => [item.entry?.index, item.id]));
        projected.rules = view.rules.map((rule, index) => byIndex.get(rule.index) || `rule:${index}`).filter(Boolean);
      }
    }
  } catch (_) {}
  const preview = modal.sessionState?.preview || null;
  const shifted = Array.isArray(preview?.hotkeys?.shifted) ? preview.hotkeys.shifted : [];
  return {
    dirty: dirty === true,
    loud: Boolean(loud?.loud),
    loudReasons: Array.isArray(loud?.reasons) ? loud.reasons : [],
    confirm: modal.bankArrangeConfirm === true,
    saving: modal.bankSaving === true,
    hintMode: modal.bankHintMode || null,
    pendingText,
    projected,
    deltas,
    shifted,
    orderBlocked: typeof modal.bankArrangeOrderBlocked === "function" ? modal.bankArrangeOrderBlocked() : false,
  };
}

Object.assign(BankSetupCardModal.prototype, {
  bankCardEl() {
    return this.contentEl?.querySelector?.("[data-bank-setup-card]") || null;
  },

  bankClearEnterLatch() {
    if (!this.bankEnterLatch) return;
    this.bankEnterLatch = null;
  },

  bankArmEnterLatch() {
    const state = this.session?.getState?.() || {};
    this.bankEnterLatch = { revision: state.revision, expect: state.expect };
    this.paint?.("session");
  },

  bankLatchShouldFire(state) {
    const latch = this.bankEnterLatch;
    if (!latch || !state) return false;
    if (state.revision !== latch.revision) return false;
    return state.canApply === true;
  },

  bankLatchShouldClear(state) {
    const latch = this.bankEnterLatch;
    if (!latch || !state) return false;
    if (state.revision !== latch.revision) return true;
    if (state.status === "preview-pending" || state.status === "applying" || state.busy) return false;
    return state.canApply !== true;
  },

  bankMaybeFireEnterLatch(state) {
    const current = state || this.session?.getState?.() || {};
    if (this.bankLatchShouldFire(current)) {
      this.bankClearEnterLatch();
      if (typeof this.bankArrangeDirty === "function" && this.bankArrangeDirty() && !this.stage) {
        void this.bankArrangeApply?.();
      } else {
        void this.applyStage?.();
      }
      return true;
    }
    if (this.bankLatchShouldClear(current)) {
      this.bankClearEnterLatch();
      this.paint?.("session");
    }
    return false;
  },

  bankFocusAfterPaint(force = false) {
    const host = this.contentEl;
    if (!host || this.bankComposing) return;
    const doc = host.ownerDocument;
    const active = doc?.activeElement;
    const activeInCard = Boolean(active && (active === host || host.contains?.(active)));
    if (this.stage) {
      const wanted = this.stage.focus;
      const input = wanted
        ? host.querySelector?.(`[data-setup-card-focus="${wanted}"]`)
        : host.querySelector?.(".bob-bank-setup-card-input");
      if (!force && activeInCard && active?.getAttribute?.("data-setup-card-focus")) return;
      try { input?.focus?.({ preventScroll: true }); } catch (_) {}
      return;
    }
    const focusId = this.selection?.type === "category" ? `category-${this.selection.key}`
      : this.selection?.type === "group" ? `group-${this.selection.group || "hidden"}`
      : this.selection?.type === "account" ? `account-${this.selection.alias || ""}`
      : this.selection?.type === "rule" ? `rule-${this.selection.index}`
      : "";
    if (!force && activeInCard && focusId && active?.getAttribute?.("data-setup-card-focus") === focusId) return;
    const selected = (focusId && host.querySelector?.(`[data-setup-card-focus="${focusId}"]`))
      || host.querySelector?.(".bob-bank-setup-card-tab.is-active");
    try { selected?.focus?.({ preventScroll: true }); } catch (_) {}
  },

  paint(reason = "full") {
    try {
      const content = this.contentEl;
      if (!content || typeof content.querySelector !== "function") {
        return bankSetupCardPaint(this);
      }
      const doc = content.ownerDocument || this.app?.document || (typeof document !== "undefined" ? document : null);
      const model = bankSetupCardModel(this.report, this.selection);
      this.model = model;
      this.readOnly = model.state !== "valid";
      this.selection = model.selection;
      this.bankPaintArrange = bankSetupCardArrangePaintState(this);
      let card = this.bankCardEl();
      const composing = this.bankComposing === true;
      if (!card || reason === "full" || !card.parentNode) {
        try {
          if (typeof content.empty === "function") content.empty();
          else content.textContent = "";
        } catch (_) {}
        card = bankSetupCardBuildShell(doc);
        if (card) content.appendChild(card);
        card.setAttribute?.("data-state", model.state);
        bankSetupCardPaintHeader(card);
        bankSetupCardPaintTabsRegion(card, this, model);
        bankSetupCardPaintPanel(card, this, model, doc);
        bankSetupCardPaintSelectionRegion(card, this, model);
        bankSetupCardPaintStageRegion(card, this, doc, true);
        bankSetupCardPaintStatusRegion(card, this);
        bankSetupCardPaintHintsRegion(card, this, doc);
        bankSetupCardPaintLive(card, this);
        this.bankStagePaintKey = bankSetupCardStageKey(this.stage);
        this.bankFocusAfterPaint(true);
        return model;
      }
      card.setAttribute?.("data-state", model.state);
      if (composing && (reason === "full" || reason === "stage" || reason === "body")) {
        bankSetupCardPaintStatusRegion(card, this);
        bankSetupCardPaintHintsRegion(card, this, doc);
        return model;
      }
      if (reason === "session") {
        bankSetupCardPaintStatusRegion(card, this);
        bankSetupCardPaintHintsRegion(card, this, doc);
        if (this.bankPaintArrange?.dirty || this.bankPaintArrange?.shifted?.length) {
          bankSetupCardPaintPanel(card, this, model, doc);
          bankSetupCardPaintSelectionRegion(card, this, model);
        }
        const stageKey = bankSetupCardStageKey(this.stage);
        if (stageKey !== this.bankStagePaintKey) {
          bankSetupCardPaintStageRegion(card, this, doc, true);
        } else {
          bankSetupCardPaintStageStatus(bankSetupCardRegion(card, "stage"), this);
        }
        return model;
      }
      if (reason === "stage") {
        bankSetupCardPaintStageRegion(card, this, doc, true);
        bankSetupCardPaintStatusRegion(card, this);
        bankSetupCardPaintHintsRegion(card, this, doc);
        this.bankFocusAfterPaint(true);
        return model;
      }
      bankSetupCardPaintHeader(card);
      bankSetupCardPaintTabsRegion(card, this, model);
      bankSetupCardPaintPanel(card, this, model, doc);
      bankSetupCardPaintSelectionRegion(card, this, model);
      bankSetupCardPaintStageRegion(card, this, doc, reason === "full");
      bankSetupCardPaintStatusRegion(card, this);
      bankSetupCardPaintHintsRegion(card, this, doc);
      bankSetupCardPaintLive(card, this);
      this.bankFocusAfterPaint(reason === "body");
      return model;
    } catch (_) {
      try { return bankSetupCardPaint(this); } catch (error) { return null; }
    }
  },
});
