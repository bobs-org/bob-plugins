// Visibility-gated hosts for the read-only Bank Period Charts panel. This
// fetch has its own -c cache key and never shares the badge's result.
const BANK_PERIOD_VIEW_STORAGE_KEY = "bob-ledger-tools-bank-period-view";

function bankPeriodStoredViewState(value) {
  let stored = value;
  if (typeof stored === "string") {
    try { stored = JSON.parse(stored); } catch (error) { stored = null; }
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
  return {
    view: bankPeriodViewOf(stored.view),
    collapsed: stored.collapsed === true,
  };
}

class BobLedgerToolsBankPeriodHostsMixin {
  bankPeriodConfigEnabled() {
    try {
      const configured = statsReadConfigValue("bank_period");
      return typeof configured === "boolean" ? configured : true;
    } catch (error) {
      return true;
    }
  }

  bankPeriodViewState() {
    if (this.bankPeriodViewLoaded === true) return this.bankPeriodView;
    let stored = null;
    try {
      if (this.app && typeof this.app.loadLocalStorage === "function") {
        stored = this.app.loadLocalStorage(BANK_PERIOD_VIEW_STORAGE_KEY);
      }
    } catch (error) {
      stored = null;
    }
    this.bankPeriodView = bankPeriodStoredViewState(stored);
    this.bankPeriodViewLoaded = true;
    return this.bankPeriodView;
  }

  bankPeriodSaveViewState(next) {
    const state = bankPeriodStoredViewState(next);
    this.bankPeriodView = state;
    this.bankPeriodViewLoaded = true;
    try {
      if (this.app && typeof this.app.saveLocalStorage === "function") {
        this.app.saveLocalStorage(BANK_PERIOD_VIEW_STORAGE_KEY, { ...state });
      }
    } catch (error) {
      // The current process still keeps the preference when storage is absent.
    }
    this.bankPeriodRepaintHosts();
    return state;
  }

  bankPeriodSetView(view) {
    const current = this.bankPeriodViewState();
    return this.bankPeriodSaveViewState({ ...current, view: bankPeriodViewOf(view) });
  }

  bankPeriodToggleCollapsed() {
    const current = this.bankPeriodViewState();
    return this.bankPeriodSaveViewState({ ...current, collapsed: !current.collapsed });
  }

  bankPeriodRepaintHosts() {
    try {
      const records = this.periodStripViews instanceof Set ? Array.from(this.periodStripViews) : [];
      for (const record of records) {
        if (!record || record.surface === "table" || !record.periodHost) continue;
        const panel = record.bankPeriodRecord;
        if (!panel || panel.unloaded) continue;
        panel.lastDigest = null;
        try { this.bankPeriodPaintFenceRecord(panel); } catch (error) {}
      }
    } catch (error) {
      // One detached period panel never interrupts another.
    }
  }

  bankSyncFencePeriod(record) {
    if (!record || !record.periodHost || record.surface === "table") return;
    const kind = record.kind;
    const id = record.periodId || record.badgeId;
    const today = typeof this.bankBadgeLocalToday === "function" ? this.bankBadgeLocalToday() : bankLocalDate();
    const start = bankBadgePeriodStart(kind, id);
    const future = Boolean(start && today && start > today);
    const spawnOk = typeof this.periodStripCanSpawn === "function"
      ? this.periodStripCanSpawn()
      : (typeof this.dayStripCanSpawn !== "function" || this.dayStripCanSpawn());
    const gatedOff = !["week", "quarter", "year", "all", "all_time"].includes(kind)
      || future
      || !this.bankPeriodConfigEnabled()
      || !this.bankBadgeHubExists()
      || !spawnOk
      || this.bankDataActive === false
      || !this.bankBadgeFenceIsVisible(record);
    if (gatedOff) {
      this.bankReleaseFencePeriod(record, { keepHost: true });
      return;
    }
    const spec = bankPeriodSpecForStrip(kind, id);
    if (!spec) {
      this.bankReleaseFencePeriod(record, { keepHost: true });
      return;
    }
    const key = bankCacheKey(bankBuildArgs(spec));
    const existing = record.bankPeriodRecord || null;
    if (existing && existing.key === key && existing.host === record.periodHost && existing.unloaded !== true) return;

    this.bankReleaseFencePeriod(record, { keepHost: true });
    const panel = {
      host: record.periodHost,
      kind,
      id,
      key,
      spec,
      parent: record,
      unsubscribe: null,
      result: null,
      state: null,
      unloaded: false,
      lastDigest: null,
      sync: () => this.bankPeriodPaintFenceRecord(panel),
    };
    record.bankPeriodRecord = panel;
    this.bankBadgeRegisterHost(panel);
    if (typeof this.apiBankSubscribe !== "function") return;
    panel.unsubscribe = this.apiBankSubscribe(spec, (state) => {
      if (panel.unloaded) return;
      panel.state = state;
      panel.result = state && state.results ? state.results[key] || null : null;
      panel.sync();
    });
  }

  bankPeriodPaintFenceRecord(panel) {
    if (!panel || panel.unloaded || !panel.host) return;
    const result = panel.result;
    const args = panel.spec ? bankBuildArgs(panel.spec) : [];
    if (result && result.error && bankPeriodOlderBobRefusal(result.error, args)) {
      if (this.bankPeriodOlderBobWarned !== true) {
        this.bankPeriodOlderBobWarned = true;
        try { console.warn("Bank Period Charts need a bob with `bank report -c`; the Bank Badge remains available."); } catch (error) {}
      }
      bankPeriodPaint(panel.host, { state: "hidden", reason: "older-bob" });
      panel.lastDigest = "hidden:older-bob";
      return;
    }
    if (!result) {
      bankPeriodPaint(panel.host, null);
      panel.lastDigest = "loading";
      return;
    }
    const prefs = this.bankPeriodViewState();
    const context = {
      kind: panel.kind,
      periodId: panel.id,
      today: panel.state && panel.state.today || bankLocalDate(),
      stale: result.stale === true,
      refreshFailed: Boolean(result.error),
      badgeEnabled: typeof this.bankBadgeEnabled === "function" ? this.bankBadgeEnabled() : true,
      view: prefs.view,
      collapsed: prefs.collapsed,
    };
    const model = bankPeriodChartsModel(result.report || null, context);
    if (panel.lastDigest === model.digest) return;
    bankPeriodPaint(panel.host, model, {
      activateBucket: (target, column, newLeaf) => {
        if (!panel.unloaded) void this.bankPeriodNavigateBucket(target, column, newLeaf);
      },
      openWaiting: (target, newLeaf) => {
        if (!panel.unloaded) void this.bankBadgeNavigate(target, newLeaf);
      },
      setView: (view) => {
        if (!panel.unloaded) this.bankPeriodSetView(view);
      },
      toggleCollapsed: () => {
        if (!panel.unloaded) this.bankPeriodToggleCollapsed();
      },
    });
    panel.lastDigest = model.digest || model.state;
  }

  async bankPeriodNavigateBucket(target, column, newLeaf = false) {
    if (!target || typeof target.path !== "string" || !target.path) return false;
    if (column && column.kind === "day" && typeof this.bankBadgeNavigate === "function") {
      return this.bankBadgeNavigate(target, newLeaf);
    }
    const label = column && (column.label || column.id) || target.path;
    const vault = this.app && this.app.vault;
    let file = null;
    try {
      if (vault && typeof vault.getAbstractFileByPath === "function") file = vault.getAbstractFileByPath(target.path);
    } catch (error) {
      file = null;
    }
    if (!file) {
      try { new Notice(`No note for ${label} yet`); } catch (error) {}
      return false;
    }
    const line = Number.isInteger(target.line) && target.line > 0 ? target.line : 1;
    const opened = await this.bankOpenMonthPathAtLine(target.path, line, 0, { newLeaf, skipPendingSave: true });
    if (!opened) {
      try { new Notice(`Bank: could not open ${target.path}`); } catch (error) {}
    }
    return Boolean(opened);
  }

  bankReleaseFencePeriod(record, options = {}) {
    if (!record) return;
    const panel = record.bankPeriodRecord || null;
    if (panel) {
      panel.unloaded = true;
      this.bankBadgeUnregisterHost(panel);
      try { if (typeof panel.unsubscribe === "function") panel.unsubscribe(); } catch (error) {}
    }
    record.bankPeriodRecord = null;
    if (options.keepHost === true && record.periodHost) {
      try { bankCardClear(record.periodHost); } catch (error) {}
    }
  }

  teardownBankPeriodHosts() {
    if (this.periodStripViews instanceof Set) {
      for (const record of Array.from(this.periodStripViews)) this.bankReleaseFencePeriod(record);
    }
    this.bankPeriodView = null;
    this.bankPeriodViewLoaded = false;
    this.bankPeriodOlderBobWarned = null;
    this.bankPeriodConfigLastEnabled = null;
  }
}
