// Keyboard-first Bank setup modal. The card stages one op, asks bob to
// preview it, and applies only through the shared guarded config session.
class BankSetupCardModal extends bankCategoryCardModalBase() {
  constructor(app, options = {}) {
    super(app);
    this.pluginRef = options.plugin || null;
    this.report = options.report || null;
    this.error = options.error || null;
    this.categories = Array.isArray(this.report?.categories) ? this.report.categories : [];
    this.section = BANK_SETUP_CARD_SECTION_ORDER.includes(options.section)
      ? options.section
      : this.report?.state === "invalid" ? "checks" : "categories";
    this.selection = options.selection || null;
    this.model = null;
    this.session = null;
    this.sessionState = null;
    this.stage = null;
    this.closed = false;
    this.busy = false;
    this.readOnly = true;
    this.didInteract = false;
    this.staleMessage = "";
    this.savedMessage = "";
    this.errorMessage = "";
    this.syncWarning = null;
    this.liveText = "";
    this.liveRegion = null;
    this.staleRefreshFlight = null;
    this.clickListener = (event) => this.onClick(event);
    this.keyListener = (event) => { void this.onKeyDown(event); };
  }

  onOpen() {
    try {
      this.modalEl?.addClass?.("bob-bank-setup-card-modal");
      this.modalEl?.setAttribute?.("role", "dialog");
      this.modalEl?.setAttribute?.("aria-modal", "true");
      this.modalEl?.setAttribute?.("aria-label", "Bank setup");
      this.contentEl?.addClass?.("bob-bank-setup-card-dialog");
      this.contentEl?.addEventListener?.("click", this.clickListener);
      this.contentEl?.addEventListener?.("keydown", this.keyListener, true);
    } catch (_) {}
    if (!this.setReport(this.report, { initial: true })) this.paint();
  }

  onClose() {
    this.closed = true;
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
    this.stage = null;
    try { this.contentEl?.removeEventListener?.("click", this.clickListener); } catch (_) {}
    try { this.contentEl?.removeEventListener?.("keydown", this.keyListener, true); } catch (_) {}
    try { this.pluginRef?.bankSetupCardModalClosed?.(this); } catch (_) {}
  }

  setReport(report, options = {}) {
    if (!report || this.closed) return false;
    const hasDraft = Boolean(this.stage && this.sessionState?.draftOps?.length);
    if (hasDraft && options.force !== true) return false;
    this.report = report;
    this.categories = Array.isArray(report.categories) ? report.categories : [];
    const model = bankSetupCardModel(report, this.selection);
    if (model.selection) this.selection = model.selection;
    this.readOnly = model.state !== "valid";
    const fingerprint = bankConfigFingerprintFromReport(report);
    if (model.state === "valid" && fingerprint) {
      if (!this.session) this.createSession(fingerprint);
      else if (!hasDraft) this.session.rebase(fingerprint);
    }
    if (!hasDraft || options.initial === true) {
      if (report.state === "invalid" || report.state === "missing") this.section = "checks";
      else if (options.initial === true) this.section = "categories";
    }
    this.sessionState = this.session?.getState?.() || null;
    this.paint();
    return true;
  }

  createSession(fingerprint) {
    if (!this.pluginRef || typeof createBankConfigUpdateSession !== "function") return null;
    this.session = createBankConfigUpdateSession(
      { expect: fingerprint },
      bankConfigUpdateServiceDeps(this.pluginRef, { onChange: (state) => this.onSessionChange(state) }),
    );
    this.sessionState = this.session.getState();
    return this.session;
  }

  onSessionChange(state) {
    if (this.closed) return;
    this.sessionState = state || null;
    if (state?.syncWarning) this.syncWarning = { ...state.syncWarning };
    if (state?.refusal?.kind === "stale" || state?.refusal?.code === "stale_config") {
      void this.refreshStaleDraft();
    }
    this.paint();
  }

  async refreshStaleDraft() {
    if (this.staleRefreshFlight || this.closed || !this.pluginRef) return this.staleRefreshFlight;
    this.staleMessage = "The bank config changed. Your draft is kept; explicitly re-preview before applying.";
    this.staleRefreshFlight = (async () => {
      let result = null;
      try { result = await this.pluginRef.apiBankRefresh({ command: "config", force: true, wait: true }); } catch (_) {}
      if (this.closed) return null;
      const report = result?.report || null;
      const fingerprint = bankConfigFingerprintFromReport(report);
      if (!report || !fingerprint || report.state !== "valid") {
        this.errorMessage = "The refreshed bank config is unavailable or invalid. Open YAML and reconcile it before applying.";
        this.paint();
        return null;
      }
      this.report = report;
      this.categories = Array.isArray(report.categories) ? report.categories : [];
      this.readOnly = false;
      this.session?.rebase?.(fingerprint);
      this.sessionState = this.session?.getState?.() || null;
      this.paint();
      return report;
    })();
    try { return await this.staleRefreshFlight; }
    finally { this.staleRefreshFlight = null; }
  }

  async repreview() {
    if (!this.session || this.busy || this.readOnly) return false;
    this.staleMessage = "";
    this.errorMessage = "";
    this.busy = true;
    this.paint();
    try {
      const result = await this.session.previewNow();
      if (!result || result.ok !== true) this.errorMessage = result?.message || "The draft preview failed.";
      return Boolean(result && result.ok === true);
    } finally {
      this.busy = false;
      this.sessionState = this.session?.getState?.() || null;
      this.paint();
    }
  }

  paint() {
    try { return bankSetupCardPaint(this); } catch (_) { return null; }
  }

  footerText() {
    const mod = typeof Platform !== "undefined" && Platform?.isMacOS === true ? "⌘" : "Ctrl";
    if (this.stage) return `Enter apply · Esc/q cancel stage · ${mod}+E YAML`;
    if (this.section === "accounts") return `Enter relabel · + add · ${mod}+D remove · ${mod}+E YAML · ${mod}+Z undo · Esc/q close`;
    if (this.section === "rules") return `Enter edit · + new · Alt+J/K move · ${mod}+D remove · ${mod}+E YAML · ${mod}+Z undo · Esc/q close`;
    if (this.section === "checks") return `Enter open line · ${mod}+E YAML · Esc/q close`;
    return `Enter edit · + new · Alt+J/K move · ${mod}+H hide · ${mod}+D remove · ${mod}+E YAML · ${mod}+Z undo · Esc/q close`;
  }

  setSection(section) {
    if (!BANK_SETUP_CARD_SECTION_ORDER.includes(section)) return false;
    this.section = section;
    this.didInteract = true;
    this.paint();
    return true;
  }

  selectItem(id) {
    if (this.busy || this.stage) return false;
    this.selection = bankSetupCardSelection(this.model, id);
    if (!this.selection) return false;
    this.didInteract = true;
    this.savedMessage = "";
    this.paint();
    return true;
  }

  selectedItem() {
    return this.model?.selectedItem || null;
  }

  focusSelection() {
    const item = this.selectedItem();
    if (!item) return false;
    let attr = "data-setup-card-group";
    let wanted = item.hidden ? "__hidden__" : item.group;
    if (item.type === "category") { attr = "data-setup-card-category"; wanted = item.key; }
    else if (item.type === "account") { attr = "data-setup-card-account"; wanted = item.alias; }
    else if (item.type === "rule") { attr = "data-setup-card-rule"; wanted = String(item.entry?.index ?? item.index ?? ""); }
    else if (item.type === "finding") { attr = "data-setup-card-finding"; wanted = String(item.index ?? ""); }
    const nodes = Array.from(this.contentEl?.querySelectorAll?.(`[${attr}]`) || []);
    const node = nodes.find((candidate) => candidate.getAttribute?.(attr) === wanted);
    try { node?.focus?.(); } catch (_) {}
    return Boolean(node);
  }

  selectionSummary() {
    const item = this.selectedItem();
    return item?.type === "category" ? item.entry : null;
  }

  startStage(stage, op) {
    if (this.closed || this.busy || this.readOnly || !this.session || !stage) return false;
    this.stage = stage;
    this.didInteract = true;
    this.savedMessage = "";
    this.staleMessage = "";
    this.errorMessage = "";
    if (op) this.session.setDraft([op]);
    else this.session.setDraft([]);
    this.sessionState = this.session.getState();
    this.paint();
    const focus = stage.focus || (stage.kind === "rename-group" ? "group-name"
      : stage.kind === "confirm" || stage.kind === "undo" ? "apply" : "label");
    try { this.contentEl?.querySelector?.(`[data-setup-card-focus="${focus}"]`)?.focus?.(); } catch (_) {}
    return true;
  }

  openEditStage(entry) {
    if (!entry || this.readOnly || entry.builtin && entry.declared === false) return false;
    return this.startStage({
      kind: "edit", title: `Edit ${entry.label || entry.key}`, entry,
      label: entry.label || entry.key,
      emoji: entry.emoji || "",
      group: entry.group || "",
      hotkey: entry.hotkey || "",
      hotkeyTouched: false,
      focus: "label",
    }, null);
  }

  openGroupRenameStage(group) {
    if (!group || group === BANK_SETUP_MONEY_GROUP || this.readOnly) return false;
    return this.startStage({ kind: "rename-group", title: `Rename ${group}`, group, to: group, focus: "group-name" }, null);
  }

  openNewCategoryStage() {
    if (this.readOnly || this.busy || this.stage) return false;
    const selected = this.selection?.type === "category" ? this.selection.key : "";
    const stage = bankCategoryNewStageInit(this.categories, selected);
    return this.startStage({ kind: "new", title: "New category", ...stage }, null);
  }

  openNewAccountStage() {
    if (this.readOnly || this.busy || this.stage) return false;
    return this.startStage({
      kind: "new-account", title: "New account",
      label: "", kindValue: "", start: "", alias: "",
      focus: "label",
    }, null);
  }

  openEditAccountStage(entry) {
    if (!entry || typeof entry.alias !== "string" || !entry.alias || this.readOnly) return false;
    return this.startStage({
      kind: "edit-account", title: `Rename ${entry.label || entry.alias}`, entry,
      label: entry.label || entry.alias,
      focus: "label",
    }, null);
  }

  openNewRuleStage() {
    if (this.readOnly || this.busy || this.stage) return false;
    return this.startStage({
      kind: "new-rule", title: "New rule",
      match: "", cat: "", payee: "", link: "",
      focus: "match",
    }, null);
  }

  openEditRuleStage(entry) {
    if (!entry || !Number.isInteger(entry.index) || this.readOnly) return false;
    return this.startStage({
      kind: "edit-rule", title: `Edit rule ${entry.index + 1}`, entry,
      match: entry.match || "",
      cat: entry.cat || "",
      payee: entry.payee || "",
      link: entry.link || "",
      focus: "match",
    }, null);
  }

  openStaleAfterStage() {
    if (this.readOnly || this.busy || this.stage) return false;
    const days = this.model?.staleAfter?.days;
    return this.startStage({
      kind: "stale-after", title: "Balances go stale after",
      days: Number.isInteger(days) ? String(days) : "10",
      focus: "stale-after",
    }, null);
  }

  beginGesture(op, title, confirmation = "Review bob's consequence, then press Enter to apply.") {
    if (!op || this.readOnly || this.busy || this.stage) return false;
    return this.startStage({ kind: "confirm", title, confirmation }, op);
  }

  beginSelectedGesture(kind, direction = "") {
    const item = this.selectedItem();
    if (!item || this.readOnly) return false;
    if (kind === "edit") {
      if (item.type === "group") return this.openGroupRenameStage(item.group);
      if (item.type === "account") return this.openEditAccountStage(item.entry);
      if (item.type === "rule") return this.openEditRuleStage(item.entry);
      if (item.type === "finding") {
        const line = Number.isInteger(item.entry?.line) && item.entry.line > 0 ? item.entry.line : null;
        if (line) { void this.openYaml(line); return true; }
        return false;
      }
      return this.openEditStage(item.entry);
    }
    if (kind === "hide" && item.type === "category") {
      const op = bankSetupCardHiddenOp(item.entry);
      return this.beginGesture(op, item.entry.hidden ? "Unhide category" : "Hide category");
    }
    if (kind === "remove") {
      if (item.type === "account") {
        const op = typeof bankSetupCardAccountRemoveOp === "function" ? bankSetupCardAccountRemoveOp(item.entry) : null;
        return this.beginGesture(op, `Remove ${item.entry?.label || item.alias || "account"}`, "Bob checks rows and journal events before removing this account.");
      }
      if (item.type === "rule") {
        const op = typeof bankSetupCardRuleRemoveOp === "function" ? bankSetupCardRuleRemoveOp(item.entry) : null;
        const position = (this.model?.ruleItems || []).findIndex((candidate) => candidate.id === item.id);
        return this.beginGesture(op, `Remove rule ${position >= 0 ? position + 1 : item.entry?.index + 1}`, "Filed rows keep their categories; only future imports and hints change.");
      }
      if (item.type === "category") {
        const op = bankSetupCardRemoveOp(item.entry);
        return this.beginGesture(op, `Remove ${item.entry.label || item.key}`, "Bob checks row and rule use before removing this category.");
      }
      return false;
    }
    if (kind === "restore" && item.type === "category") {
      const op = bankSetupCardRestoreOp(item.entry);
      return this.beginGesture(op, `Restore ${item.entry.label || item.key}`, "Restore this built-in category to bob's default.");
    }
    if (kind === "move") {
      if (item.type === "rule") {
        const op = typeof bankSetupCardRuleMoveOp === "function"
          ? bankSetupCardRuleMoveOp(this.report?.rules || this.model?.rules || [], item.entry?.index, direction)
          : null;
        return this.beginGesture(op, `Move rule ${item.entry?.index + 1}`);
      }
      const op = item.type === "group"
        ? bankSetupCardGroupMoveOp(this.categories, item.group, direction)
        : bankSetupCardCategoryMoveOp(this.categories, item.key, direction);
      return this.beginGesture(op, item.type === "group" ? `Move ${item.group} group` : `Move ${item.entry.label || item.key}`);
    }
    return false;
  }

  onFieldInput(field, value) {
    if (!this.stage || this.busy) return;
    const text = String(value ?? "");
    if (field === "group-name") this.stage.to = text;
    else if (field === "kind") this.stage.kindValue = text;
    else if (field === "stale-after") this.stage.days = text;
    else if (field === "hotkey") {
      this.stage.hotkey = text.slice(-1).toLowerCase();
      if (this.stage.kind === "edit") this.stage.hotkeyTouched = true;
    } else this.stage[field] = text;
    this.didInteract = true;
    this.errorMessage = "";
    const op = this.stageDraftOp();
    if (op) this.session?.setDraft?.([op]);
    else this.session?.setDraft?.([]);
    this.sessionState = this.session?.getState?.() || null;
    this.paint(field === "emoji" ? "session" : "full");
    if (field === "emoji") return;
    try { this.contentEl?.querySelector?.(`[data-setup-card-focus="${field}"]`)?.focus?.(); } catch (_) {}
  }

  stageDraftOp() {
    if (!this.stage) return null;
    if (this.stage.kind === "edit") {
      const status = bankSetupCardHotkeyStatus(this.categories, this.stage.hotkey, this.stage.entry.key);
      if (this.stage.hotkeyTouched && !status.canApply) return null;
      return bankSetupCardSetCategoryOp(this.stage.entry, this.stage);
    }
    if (this.stage.kind === "new") {
      const status = bankCategoryNewHotkeyStatus(this.categories, this.stage.hotkey);
      if (!status.canApply) return null;
      return bankCategoryNewDraftOp(this.stage);
    }
    if (this.stage.kind === "rename-group") return bankSetupCardGroupRenameOp(this.stage.group, this.stage.to);
    if (this.stage.kind === "edit-account") {
      return typeof bankSetupCardAccountSetOp === "function"
        ? bankSetupCardAccountSetOp(this.stage.entry, this.stage)
        : null;
    }
    if (this.stage.kind === "new-account") {
      if (typeof bankSetupCardAccountAddOp !== "function") return null;
      return bankSetupCardAccountAddOp({
        label: this.stage.label,
        kind: this.stage.kindValue,
        start: this.stage.start,
        alias: this.stage.alias,
      });
    }
    if (this.stage.kind === "new-rule") {
      if (typeof bankSetupCardRuleAddOp !== "function") return null;
      const status = bankSetupCardRuleAddOp(this.stage, this.categories);
      if (!status) return null;
      return status;
    }
    if (this.stage.kind === "edit-rule") {
      if (typeof bankSetupCardRuleSetOp !== "function") return null;
      return bankSetupCardRuleSetOp(this.stage.entry, this.stage, this.categories);
    }
    if (this.stage.kind === "stale-after") {
      if (typeof bankSetupCardStaleAfterOp !== "function") return null;
      return bankSetupCardStaleAfterOp(this.stage.days);
    }
    if (this.stage.kind === "undo") return null;
    return null;
  }

  cycleGroup(direction) {
    if (!this.stage || !["new", "edit"].includes(this.stage.kind)) return false;
    this.stage.group = bankCategoryNewCycleGroup(this.stage, direction);
    this.onFieldInput("group", this.stage.group);
    return true;
  }

  async applyStage() {
    if (!this.stage || this.busy || this.readOnly || !this.session) return false;
    if (this.stage.kind === "new") {
      const status = bankCategoryNewHotkeyStatus(this.categories, this.stage.hotkey);
      if (!status.canApply) {
        this.errorMessage = status.text;
        this.paint();
        return false;
      }
    }
    if (this.stage.kind === "edit" && this.stage.hotkeyTouched) {
      const status = bankSetupCardHotkeyStatus(this.categories, this.stage.hotkey, this.stage.entry.key);
      if (!status.canApply) {
        this.errorMessage = status.text;
        this.paint();
        return false;
      }
    }
    if (this.stage.kind === "new-account") {
      const op = typeof bankSetupCardAccountAddOp === "function"
        ? bankSetupCardAccountAddOp({ label: this.stage.label, kind: this.stage.kindValue, start: this.stage.start, alias: this.stage.alias })
        : null;
      if (!op) {
        this.errorMessage = "Name the account, pick a kind, and give a start date (cash needs none).";
        this.paint();
        return false;
      }
    }
    if (this.stage.kind === "new-rule" || this.stage.kind === "edit-rule") {
      if (!this.stageDraftOp()) {
        this.errorMessage = this.stage.kind === "new-rule"
          ? "Give the rule a match and a known category."
          : "Change the match, category, payee, or link first.";
        this.paint();
        return false;
      }
    }
    if (this.stage.kind === "stale-after") {
      if (typeof bankSetupCardStaleAfterOp === "function" && !bankSetupCardStaleAfterOp(this.stage.days)) {
        this.errorMessage = "Use a non-negative number of days.";
        this.paint();
        return false;
      }
    }
    if (!this.session.getState().canApply) return false;
    this.busy = true;
    this.errorMessage = "";
    this.paint();
    let result;
    try { result = await this.session.apply(); }
    catch (error) { result = { ok: false, message: String(error?.message || error) }; }
    if (this.closed) return false;
    this.busy = false;
    this.sessionState = this.session.getState();
    if (!result || result.ok !== true) {
      this.errorMessage = result?.message || "The bank config edit was refused.";
      if (result?.code === "undo_blocked") this.errorMessage = result.message || "Undo is blocked by a later bank config change.";
      this.paint();
      return false;
    }
    const priorStage = this.stage;
    const refreshed = result.refreshed && result.refreshed.report ? result.refreshed.report : null;
    const report = result.report || null;
    if (refreshed && refreshed.state === "valid") {
      this.report = refreshed;
      if (Array.isArray(refreshed.categories)) this.categories = refreshed.categories;
    } else {
      if (report && Array.isArray(report.categories)) this.categories = report.categories;
      if (report) {
        this.report = { ...this.report, ...report, state: this.report?.state || "valid" };
        const after = typeof report.after_fingerprint === "string" ? report.after_fingerprint : "";
        if (after) {
          this.report.config_fingerprint = after;
          this.report.fingerprint = after;
        }
      }
    }
    const opResult = Array.isArray(report?.per_op) ? report.per_op[0] : null;
    const changedKey = opResult && typeof opResult.key === "string" ? opResult.key : "";
    if (changedKey && this.categories.some((entry) => entry.key === changedKey)) {
      this.selection = { type: "category", key: changedKey, group: "", id: `category:${changedKey}` };
    } else if (changedKey) {
      const accountHit = (this.report?.accounts || []).find((entry) => entry && entry.alias === changedKey);
      if (accountHit) this.selection = { type: "account", key: null, group: null, alias: changedKey, index: null, id: `account:${changedKey}` };
    }
    this.sessionState = this.session.getState();
    this.syncWarning = this.sessionState?.syncWarning || null;
    this.stage = null;
    this.staleMessage = "";
    this.errorMessage = "";
    this.savedMessage = result.changed === false ? "No change." : "Saved · Ctrl+Z undo";
    if (priorStage?.kind === "new" && !changedKey) this.savedMessage = "Saved · refresh the bank report to confirm the new category.";
    this.paint();
    this.focusSelection();
    return true;
  }

  stageUndo() {
    if (this.stage || this.readOnly || !this.session) return false;
    const result = this.session.stageUndo();
    if (!result || result.ok !== true) {
      this.errorMessage = result?.message || "There is no bank config edit to undo.";
      this.paint();
      return false;
    }
    this.stage = { kind: "undo", title: "Undo last bank setup edit", confirmation: "Preview the inverse operation. Enter applies the undo as one normal edit." };
    this.savedMessage = "";
    this.staleMessage = "";
    this.sessionState = this.session.getState();
    this.paint();
    try { this.contentEl?.querySelector?.('[data-setup-card-focus="apply"]')?.focus?.(); } catch (_) {}
    return true;
  }

  cancelStage() {
    if (!this.stage || this.busy) return false;
    this.session?.setDraft?.([]);
    this.sessionState = this.session?.getState?.() || null;
    this.stage = null;
    this.staleMessage = "";
    this.errorMessage = "";
    this.paint();
    this.focusSelection();
    return true;
  }

  async retrySync() {
    if (!this.session || this.busy) return false;
    this.busy = true;
    this.paint();
    try {
      const result = await this.session.retrySync();
      this.sessionState = this.session.getState();
      this.syncWarning = this.sessionState.syncWarning || null;
      this.errorMessage = result?.ok ? "" : result?.message || "Sync retry failed.";
      return Boolean(result && result.ok);
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  async openYaml(line) {
    if (this.busy || !this.pluginRef || typeof this.pluginRef.bankSetupStartYamlExcursion !== "function") return false;
    let targetLine = line;
    if (!Number.isInteger(targetLine) || targetLine < 1) {
      const item = this.selectedItem();
      if (item?.type === "category" && Number.isInteger(item.tile?.line)) targetLine = item.tile.line;
      else if (item?.type === "account" && Number.isInteger(item.entry?.line)) targetLine = item.entry.line;
      else if (item?.type === "rule" && Number.isInteger(item.entry?.line)) targetLine = item.entry.line;
      else if (item?.type === "finding" && Number.isInteger(item.entry?.line)) targetLine = item.entry.line;
      else if (item?.type === "group") {
        const first = this.model?.items?.find((candidate) => candidate.type === "category" && candidate.entry?.group === item.group);
        if (Number.isInteger(first?.tile?.line)) targetLine = first.tile.line;
      }
      if (this.section === "accounts" && Number.isInteger(this.model?.staleAfter?.line)) {
        const staleLine = this.model.staleAfter.line;
        if ((!Number.isInteger(targetLine) || targetLine < 1) && staleLine) targetLine = staleLine;
      }
      if (!Number.isInteger(targetLine) || targetLine < 1) {
        const firstFinding = (this.model?.findingItems || [])[0]?.entry;
        if (this.section === "checks" && Number.isInteger(firstFinding?.line)) targetLine = firstFinding.line;
        else targetLine = this.report?.line || 1;
      }
    }
    const options = {
      sourcePath: BANK_SETUP_HUB_PATH,
      line: targetLine,
      fromCard: true,
      section: this.section,
      selection: this.selection,
    };
    this.close();
    return this.pluginRef.bankSetupStartYamlExcursion(options);
  }

  async onKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const mod = Boolean(event.ctrlKey || event.metaKey);
    const target = event.target;
    const inInput = Boolean(target?.closest?.("input,select,textarea"));
    const consume = () => bankCategoryUiConsume(event);
    if (key === "Escape" || (!inInput && !mod && !event.altKey && lower === "q")) {
      consume();
      if (this.busy) return;
      if (!this.cancelStage()) this.close();
      return;
    }
    if (mod && lower === "e") {
      consume();
      void this.openYaml(this.report?.line || 1);
      return;
    }
    if (inInput) {
      if (key === "Enter") {
        consume();
        void this.applyStage();
        return;
      }
      if (mod && lower === "z") return; // Native text undo owns input focus.
      if (this.stage && this.stage.focus === "group" && (key === "ArrowUp" || key === "ArrowDown")) {
        consume();
        this.cycleGroup(key === "ArrowUp" ? "back" : "forward");
      }
      return;
    }
    if (mod && lower === "z") {
      consume();
      if (this.stage?.kind === "undo") void this.applyStage();
      else if (!this.stage) this.stageUndo();
      return;
    }
    if (key === "Tab" && !this.stage) {
      consume();
      const at = BANK_SETUP_CARD_SECTION_ORDER.indexOf(this.section);
      const next = (at + (event.shiftKey ? -1 : 1) + BANK_SETUP_CARD_SECTION_ORDER.length) % BANK_SETUP_CARD_SECTION_ORDER.length;
      this.setSection(BANK_SETUP_CARD_SECTION_ORDER[next]);
      return;
    }
    if (this.stage) {
      if (key === "Enter") { consume(); void this.applyStage(); return; }
      if (key === "r" && this.staleMessage) { consume(); void this.repreview(); return; }
      return;
    }
    if (key === "Enter") {
      const category = target?.closest?.("[data-setup-card-category]");
      if (category) {
        consume();
        const id = `category:${category.getAttribute("data-setup-card-category")}`;
        if (this.selection?.id === id) this.beginSelectedGesture("edit");
        else this.selectItem(id);
        return;
      }
      const account = target?.closest?.("[data-setup-card-account]");
      if (account) {
        consume();
        const id = `account:${account.getAttribute("data-setup-card-account")}`;
        if (this.selection?.id === id) this.beginSelectedGesture("edit");
        else this.selectItem(id);
        return;
      }
      const rule = target?.closest?.("[data-setup-card-rule]");
      if (rule) {
        consume();
        const id = `rule:${rule.getAttribute("data-setup-card-rule")}`;
        if (this.selection?.id === id) this.beginSelectedGesture("edit");
        else this.selectItem(id);
        return;
      }
      const finding = target?.closest?.("[data-setup-card-finding]");
      if (finding) {
        consume();
        const id = `finding:${finding.getAttribute("data-setup-card-finding")}`;
        this.selectItem(id);
        const found = (this.model?.findingItems || []).find((candidate) => candidate.id === id) || this.selectedItem();
        const line = found && Number.isInteger(found.entry?.line) && found.entry.line > 0 ? found.entry.line : null;
        if (line) void this.openYaml(line);
        return;
      }
      const group = target?.closest?.("[data-setup-card-group]");
      if (group) {
        consume();
        const name = group.getAttribute("data-setup-card-group");
        const id = name === "__hidden__" ? "group:hidden" : `group:${name}`;
        if (this.selection?.id === id && name !== "__hidden__") this.beginSelectedGesture("edit");
        else this.selectItem(id);
        return;
      }
      if (target?.closest?.("[data-setup-section],[data-setup-new-category],[data-setup-new-account],[data-setup-new-rule],[data-setup-action],[data-setup-line]")) return;
      consume();
      this.beginSelectedGesture("edit");
      return;
    }
    if (mod && lower === "h") {
      if (this.section !== "categories") return;
      consume(); this.beginSelectedGesture("hide"); return;
    }
    if (mod && lower === "d") { consume(); this.beginSelectedGesture("remove"); return; }
    if (mod && lower === "n") { consume(); this.moveSelection("forward"); return; }
    if (mod && lower === "p") { consume(); this.moveSelection("back"); return; }
    if (event.altKey && (lower === "j" || event.code === "KeyJ")) { consume(); this.beginSelectedGesture("move", "forward"); return; }
    if (event.altKey && (lower === "k" || event.code === "KeyK")) { consume(); this.beginSelectedGesture("move", "back"); return; }
    if (key === "+" || key === "=" || key === "＋") {
      consume();
      if (this.section === "accounts") this.openNewAccountStage();
      else if (this.section === "rules") this.openNewRuleStage();
      else this.openNewCategoryStage();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowRight") { consume(); this.moveSelection("forward"); return; }
    if (key === "ArrowUp" || key === "ArrowLeft") { consume(); this.moveSelection("back"); return; }
    if (key.length === 1 && /[a-z0-9]/i.test(key) && this.section === "categories") {
      const selection = bankSetupCardSelectionByHotkey(this.categories, key);
      if (selection) { consume(); this.selection = selection; this.didInteract = true; this.paint(); }
    }
  }

  moveSelection(direction) {
    if (this.busy || this.stage) return false;
    let next = null;
    if (this.section === "accounts" && typeof bankSetupCardMoveAccountSelection === "function") {
      next = bankSetupCardMoveAccountSelection(this.model, this.selection, direction);
    } else if (this.section === "rules" && typeof bankSetupCardMoveRuleSelection === "function") {
      next = bankSetupCardMoveRuleSelection(this.model, this.selection, direction);
    } else if (this.section === "checks" && typeof bankSetupCardMoveFindingSelection === "function") {
      next = bankSetupCardMoveFindingSelection(this.model, this.selection, direction);
    } else if (this.section === "categories") {
      next = bankSetupCardMoveSelection(this.model, this.selection, direction);
    } else {
      return false;
    }
    if (!next) return false;
    this.selection = next;
    this.didInteract = true;
    this.paint();
    return true;
  }

  onClick(event) {
    const target = event?.target;
    const section = target?.closest?.("[data-setup-section]");
    if (section) { bankCategoryUiConsume(event); this.setSection(section.getAttribute("data-setup-section")); return; }
    const fresh = target?.closest?.("[data-setup-new-category]");
    if (fresh) { bankCategoryUiConsume(event); this.openNewCategoryStage(); return; }
    const freshAccount = target?.closest?.("[data-setup-new-account]");
    if (freshAccount) { bankCategoryUiConsume(event); this.openNewAccountStage(); return; }
    const freshRule = target?.closest?.("[data-setup-new-rule]");
    if (freshRule) { bankCategoryUiConsume(event); this.openNewRuleStage(); return; }
    const action = target?.closest?.("[data-setup-action]");
    if (action) {
      bankCategoryUiConsume(event);
      const kind = action.getAttribute("data-setup-action");
      if (kind === "apply") void this.applyStage();
      else if (kind === "cancel") this.cancelStage();
      else if (kind === "yaml") void this.openYaml(Number(action.getAttribute("data-setup-line")) || this.report?.line || 1);
      else if (kind === "repreview") void this.repreview();
      else if (kind === "retry-sync") void this.retrySync();
      else if (kind === "restore-default") this.beginSelectedGesture("restore");
      else if (kind === "stale-after") this.openStaleAfterStage();
      else if (kind === "stale-after-unset") {
        if (typeof bankSetupCardStaleAfterUnsetOp === "function") {
          this.beginGesture(bankSetupCardStaleAfterUnsetOp(), "Unset stale after", "Return to the default 10 days.");
        }
      }
      return;
    }
  }
}
