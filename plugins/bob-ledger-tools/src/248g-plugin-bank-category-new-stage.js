// Category-card New category stage. Prototype methods on the existing
// modal: open/close, key pass-through, debounce dry-run, apply-then-file.
// Letters type while staged; they never file. Esc closes the stage first.
(function installBankCategoryNewStage() {
  if (typeof BankCategoryCardModal !== "function") return;
  const proto = BankCategoryCardModal.prototype;

  proto.shouldPassNewCategoryKey = function shouldPassNewCategoryKey(event) {
    if (!this.newStage || !event) return false;
    const key = typeof event.key === "string" ? event.key : "";
    if (!key || key === "Escape" || key === "Enter") return false;
    const target = event.target;
    const inInput = Boolean(target && typeof target.closest === "function"
      && target.closest("input,select,textarea"));
    if (inInput) return true;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return key.length === 1 || key === "Backspace" || key === "Delete" || key === "Tab";
  };

  proto.focusNewCategoryField = function focusNewCategoryField(field) {
    const wanted = field || (this.newStage && this.newStage.focus) || "label";
    if (this.newStage) this.newStage.focus = wanted;
    try {
      const root = this.contentEl;
      const node = root && typeof root.querySelector === "function"
        ? root.querySelector(`input[data-bank-new-field="${wanted}"]`)
        : null;
      if (node && typeof node.focus === "function") node.focus();
    } catch (_) {}
  };

  proto.syncNewCategoryDraft = function syncNewCategoryDraft() {
    if (!this.newStage || !this.newSession) return;
    const op = bankCategoryNewDraftOp(this.newStage);
    const hotkey = bankCategoryNewHotkeyStatus(this.categories, this.newStage.hotkey);
    if (!op || hotkey.canApply !== true) {
      this.newSession.setDraft([]);
      this.newStage.canApply = false;
      this.newStage.consequence = "";
      return;
    }
    this.newSession.setDraft([op]);
  };

  proto.onNewCategorySessionChange = function onNewCategorySessionChange(state) {
    if (!this.newStage || this.closed) return;
    this.newStage.canApply = Boolean(state && state.canApply);
    this.newStage.consequence = state && state.consequence ? String(state.consequence) : "";
    this.newStage.refusal = state && state.refusal ? { ...state.refusal } : null;
    if (state && state.syncWarning) this.syncWarning = { ...state.syncWarning };
    if (state && state.refusal && state.refusal.code === "stale_config") {
      void this.rebaseNewCategoryPreview();
      return;
    }
    try { this.paint(); } catch (_) {}
  };

  proto.rebaseNewCategoryPreview = async function rebaseNewCategoryPreview() {
    if (!this.newStage || !this.newSession || !this.pluginRef) return;
    let result = null;
    try {
      result = await this.pluginRef.apiBankRefresh({ command: "config", force: true });
    } catch (_) {
      result = null;
    }
    if (!this.newStage || this.closed) return;
    const fingerprint = bankConfigFingerprintFromReport(result && result.report);
    if (!fingerprint) return;
    this.configFingerprint = fingerprint;
    this.newSession.rebase(fingerprint);
    this.syncNewCategoryDraft();
  };

  proto.openNewCategoryStage = function openNewCategoryStage() {
    if (this.closed || this.busy || this.summary || this.waitingRefresh) return false;
    if (this.newStage) {
      this.focusNewCategoryField("label");
      return true;
    }
    const fingerprint = typeof this.configFingerprint === "string" ? this.configFingerprint : "";
    if (!fingerprint) {
      this.reason = BANK_CATEGORY_NEW_NEEDS_BOB;
      try { this.paint(); } catch (_) {}
      return false;
    }
    this.didInteract = true;
    this.newStage = bankCategoryNewStageInit(this.categories, this.highlightKey);
    const plugin = this.pluginRef;
    const deps = this.newSessionDeps || (plugin && typeof bankConfigUpdateServiceDeps === "function"
      ? bankConfigUpdateServiceDeps(plugin, {
        saveEditors: (paths) =>
          typeof albumSchemaSaveOpenEditors === "function"
            ? albumSchemaSaveOpenEditors(plugin, paths)
            : Promise.resolve({ ok: true }),
        timers: plugin.bankTimers,
        onChange: (state) => this.onNewCategorySessionChange(state),
      })
      : null);
    if (typeof createBankConfigUpdateSession === "function" && deps) {
      this.newSession = createBankConfigUpdateSession({ expect: fingerprint }, deps);
    } else {
      this.newSession = null;
    }
    this.syncNewCategoryDraft();
    try { this.paint(); } catch (_) {}
    this.focusNewCategoryField("label");
    return true;
  };

  proto.closeNewCategoryStage = function closeNewCategoryStage() {
    if (!this.newStage) return false;
    try { this.newSession?.close?.(); } catch (_) {}
    this.newSession = null;
    this.newStage = null;
    try { this.paint(); } catch (_) {}
    return true;
  };

  proto.appendNewCategoryChar = function appendNewCategoryChar(key) {
    const stage = this.newStage;
    if (!stage) return;
    const field = stage.focus || "label";
    if (key === "Backspace") {
      stage[field] = String(stage[field] || "").slice(0, -1);
    } else if (key === "Delete") {
      stage[field] = "";
    } else if (field === "hotkey") {
      if (key.length === 1) stage.hotkey = key.toLowerCase();
    } else {
      stage[field] = String(stage[field] || "") + key;
    }
    this.didInteract = true;
    this.syncNewCategoryDraft();
    try { this.paint(); } catch (_) {}
    this.focusNewCategoryField(field);
  };

  proto.routeNewCategoryKey = async function routeNewCategoryKey(event) {
    if (!this.newStage || !event) return;
    const key = bankCategoryUiEventKey(event);
    if (!key) return;
    const target = event.target;
    const inInput = Boolean(target && typeof target.closest === "function"
      && target.closest("input,select,textarea"));
    if (key === "Escape" || key === "q" || key === "Q" || key === "Ctrl+[") {
      bankCategoryUiConsume(event);
      this.closeNewCategoryStage();
      return;
    }
    if (this.newStage.applying || this.busy) {
      bankCategoryUiConsume(event);
      return;
    }
    if (key === "Enter" || key === "Ctrl+Enter") {
      bankCategoryUiConsume(event);
      await this.applyNewCategoryAndFile();
      return;
    }
    if (key === "Tab") {
      bankCategoryUiConsume(event);
      const order = ["label", "group", "hotkey"];
      const at = order.indexOf(this.newStage.focus || "label");
      const next = event.shiftKey
        ? order[(at - 1 + order.length) % order.length]
        : order[(at + 1) % order.length];
      this.focusNewCategoryField(next);
      try { this.paint(); } catch (_) {}
      return;
    }
    const groupFocused = (this.newStage.focus === "group") ||
      (inInput && target && target.getAttribute && target.getAttribute("data-bank-new-field") === "group");
    if (groupFocused && (key === "ArrowUp" || key === "ArrowDown" || key === "Ctrl+P" || key === "Ctrl+N")) {
      bankCategoryUiConsume(event);
      this.newStage.group = bankCategoryNewCycleGroup(
        this.newStage,
        key === "ArrowUp" || key === "Ctrl+P" ? "back" : "forward",
      );
      this.syncNewCategoryDraft();
      try { this.paint(); } catch (_) {}
      this.focusNewCategoryField("group");
      return;
    }
    if (inInput) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      bankCategoryUiConsume(event);
      return;
    }
    if (key.length === 1 || key === "Backspace" || key === "Delete") {
      bankCategoryUiConsume(event);
      this.appendNewCategoryChar(key);
    }
  };

  proto.applyNewCategoryAndFile = async function applyNewCategoryAndFile() {
    if (!this.newStage || this.closed || this.busy || this.summary) return false;
    const sessionState = this.newSession && typeof this.newSession.getState === "function"
      ? this.newSession.getState()
      : null;
    if (!bankCategoryNewCanApply(this.newStage, sessionState, this.categories)) return false;
    this.didInteract = true;
    this.busy = true;
    this.newStage.applying = true;
    try { this.paint(); } catch (_) {}
    let result;
    try {
      result = await this.newSession.apply();
    } catch (error) {
      result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "apply failed" };
    }
    if (this.closed) return false;
    if (!result || result.ok !== true) {
      this.newStage.applying = false;
      this.busy = false;
      this.newStage.refusal = result
        ? { code: result.code, message: result.message, hint: result.hint || "" }
        : { code: "failed", message: "The category apply failed." };
      try { this.paint(); } catch (_) {}
      return false;
    }
    const report = result.report || {};
    const addedKey = bankCategoryNewAddedKey(report);
    if (Array.isArray(report.categories)) this.setCategories(report.categories);
    if (sessionState && sessionState.syncWarning) {
      this.syncWarning = { ...sessionState.syncWarning };
    } else if (this.newSession && this.newSession.getState) {
      const after = this.newSession.getState();
      if (after && after.syncWarning) this.syncWarning = { ...after.syncWarning };
    }
    this.closeNewCategoryStage();
    if (!addedKey) {
      this.busy = false;
      try { this.paint(); } catch (_) {}
      return false;
    }
    this.busy = false;
    return this.choose(addedKey, "pick");
  };

  proto.onNewCategoryFieldInput = function onNewCategoryFieldInput(field, value) {
    if (!this.newStage) return;
    this.newStage.focus = field;
    if (field === "hotkey") {
      const text = String(value || "");
      this.newStage.hotkey = text ? text.slice(-1).toLowerCase() : "";
    } else {
      this.newStage[field] = String(value || "");
    }
    this.didInteract = true;
    this.syncNewCategoryDraft();
    try { this.paint(); } catch (_) {}
    this.focusNewCategoryField(field);
  };

  proto.paintNewCategoryTile = function paintNewCategoryTile(root, disabled) {
    const tile = bankCategoryNewTile();
    const row = bankCategoryUiAppend(root, "div", "bob-bank-category-tiles bob-bank-category-new-row", null, {
      role: "group",
    });
    if (!row) return;
    const button = bankCategoryUiAppend(row, "button",
      "bob-bank-category-tile bob-bank-category-new-tile",
      null, { type: "button", "data-bank-new-category": "true" });
    if (!button) return;
    button.disabled = disabled === true;
    bankCategoryUiAppend(button, "kbd", "bob-bank-category-keycap", tile.keycap);
    bankCategoryUiAppend(button, "span", "bob-bank-category-tile-label", tile.text);
  };

  proto.paintNewCategoryStage = function paintNewCategoryStage(root) {
    const stage = this.newStage;
    if (!stage) return;
    const form = bankCategoryUiAppend(root, "form", "bob-bank-category-stage", null, {
      autocomplete: "off",
    });
    if (!form) return;
    form.addEventListener?.("submit", (event) => {
      bankCategoryUiConsume(event);
      void this.applyNewCategoryAndFile();
    });
    const fields = [
      { field: "label", caption: "Label", placeholder: "e.g. 🍔 Fast food" },
      { field: "group", caption: "Group", placeholder: "e.g. Everyday" },
      { field: "hotkey", caption: "Key", placeholder: stage.suggestedHotkey || "free key" },
    ];
    for (const entry of fields) {
      const row = bankCategoryUiAppend(form, "label", "bob-bank-category-stage-row");
      if (!row) continue;
      bankCategoryUiAppend(row, "span", "bob-bank-category-stage-caption", entry.caption);
      const input = bankCategoryUiAppend(row, "input", "bob-bank-category-stage-input", null, {
        type: "text",
        "data-bank-new-field": entry.field,
        placeholder: entry.placeholder,
        value: stage[entry.field] || "",
        spellcheck: "false",
        autocomplete: "off",
      });
      if (input) {
        try { input.value = stage[entry.field] || ""; } catch (_) {}
        input.addEventListener?.("input", (event) => {
          this.onNewCategoryFieldInput(entry.field, event && event.target && event.target.value);
        });
        input.addEventListener?.("focus", () => {
          if (this.newStage) this.newStage.focus = entry.field;
        });
      }
    }
    const hotkey = bankCategoryNewHotkeyStatus(this.categories, stage.hotkey);
    if (hotkey.text) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-stage-owner", hotkey.text, { role: "status" });
    }
    if (stage.consequence) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-consequence", stage.consequence, { role: "status" });
    }
    if (stage.refusal && (stage.refusal.message || stage.refusal.hint)) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint",
        stage.refusal.hint || stage.refusal.message, { role: "status" });
    }
    if (this.syncWarning) {
      const warn = bankCategoryUiAppend(root, "p", "bob-bank-category-hint",
        this.syncWarning.message || "Saved locally; sync failed.", { role: "status" });
      const retry = bankCategoryUiAppend(root, "button", "bob-bank-category-retry", "Retry sync", {
        type: "button",
      });
      if (retry) {
        retry.addEventListener?.("click", () => { void this.retryBankConfigSync(); });
      }
      void warn;
    }
    bankCategoryUiAppend(root, "p", "bob-bank-category-keys", bankCategoryNewStageKeysText());
  };

  proto.retryBankConfigSync = async function retryBankConfigSync() {
    const plugin = this.pluginRef;
    if (!plugin || typeof plugin.apiBankConfigVaultSyncRetry !== "function") return false;
    const result = await plugin.apiBankConfigVaultSyncRetry();
    if (result && result.ok === true) this.syncWarning = null;
    try { this.paint(); } catch (_) {}
    return Boolean(result && result.ok === true);
  };
})();
