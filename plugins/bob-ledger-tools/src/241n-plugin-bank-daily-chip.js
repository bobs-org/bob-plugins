// A small report-driven chip inside canonical daily-note `bob-plan` blocks.
// Its persistent `stats.bank_chip` preference is read and cached at setup or
// on the config poll, never from a Markdown paint callback.

class BobLedgerToolsBankDailyChipMixin {
  setupBankDailyChip() {
    this.bankDailyChipConfigLastEnabled = this.bankDailyChipConfigEnabled();
    this.bankDailyChipTimer = null;
    this.bankDailyChipViews = new Set();
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "delete", "rename", "modify"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => {
            if (bankRelevantPath(file) || bankIsHubPath(oldPath || "")) this.bankRefreshPlanHosts();
          }));
        }
      }
    } catch (error) {
      // The bank data service owns refresh; this listener only updates hub visibility.
    }
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file) => {
          if (bankIsHubPath(file || "")) this.bankRefreshPlanHosts();
        }));
      }
    } catch (error) {}
    try {
      const hasTimerHost = Boolean(
        (this.bankTimers && typeof this.bankTimers === "object") ||
        (typeof window !== "undefined" && window),
      );
      const timers = hasTimerHost ? this.bankTimerApi() : null;
      if (timers && typeof timers.setInterval === "function") {
        this.bankDailyChipTimer = timers.setInterval(() => this.bankDailyChipCheckConfig(), 60 * 1000);
        if (typeof this.registerInterval === "function") this.registerInterval(this.bankDailyChipTimer);
      }
    } catch (error) {
      this.bankDailyChipTimer = null;
    }
    this.bankDailyChipViewsStore();
  }

  bankDailyChipConfigEnabled() {
    try {
      return statsReadConfigValue("bank_chip") !== false;
    } catch (error) {
      return true;
    }
  }

  bankDailyChipEnabled() {
    if (typeof this.bankDailyChipConfigLastEnabled !== "boolean") {
      this.bankDailyChipConfigLastEnabled = this.bankDailyChipConfigEnabled();
    }
    return this.bankDailyChipConfigLastEnabled;
  }

  bankDailyChipCheckConfig() {
    try {
      const enabled = this.bankDailyChipConfigEnabled();
      if (enabled === this.bankDailyChipConfigLastEnabled) return false;
      this.bankDailyChipConfigLastEnabled = enabled;
      this.bankRefreshPlanHosts();
      return true;
    } catch (error) {
      return false;
    }
  }

  bankDailyChipViewsStore() {
    if (!(this.bankDailyChipViews instanceof Set)) this.bankDailyChipViews = new Set();
    return this.bankDailyChipViews;
  }

  bankDailyHubExists() {
    try {
      const vault = this.app && this.app.vault;
      return Boolean(vault && typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath("bank.md"));
    } catch (error) {
      return false;
    }
  }

  bankDailyChipLocalToday() {
    return bankLocalDate();
  }

  bankPlanHostForRepaint(el) {
    try {
      if (!el) return null;
      const view = this.dayStripPlanHostViewFor(el);
      if (view && view.bankDailyHost && view.bankDailyHost.parentNode === el) return view.bankDailyHost;
      if (typeof el.querySelector === "function") return el.querySelector(".bob-bank-daily-plan-host");
      if (Array.isArray(el.children)) {
        return el.children.find((child) => {
          const classes = (child && typeof child.getAttribute === "function" ? child.getAttribute("class") : child && child.cls) || "";
          return String(classes).split(/\s+/).includes("bob-bank-daily-plan-host");
        }) || null;
      }
    } catch (error) {}
    return null;
  }

  bankSyncPlanHost(view) {
    if (!view || !view.el) return;
    const day = dayStripDayForPath(view.sourcePath || "");
    const today = this.bankDailyChipLocalToday();
    if (
      !day ||
      (today && day > today) ||
      !this.bankDailyChipEnabled() ||
      !this.bankDailyHubExists() ||
      this.bankDataActive === false
    ) {
      this.bankReleasePlanHost(view);
      return;
    }
    const existing = view.bankDailyRecord || null;
    if (existing && existing.day === day && existing.host && existing.host.parentNode === view.el) {
      existing.day = day;
      this.bankDailyChipPaint(existing);
      return;
    }
    this.bankReleasePlanHost(view);
    let host = null;
    try {
      host = statsEl(statsDocFor(view.el), "div", { class: "bob-bank-daily-plan-host" });
    } catch (error) {
      host = null;
    }
    if (!host) return;
    try {
      const hue = typeof this.bankCardRootHue === "function" ? this.bankCardRootHue("bank.md") : "magenta";
      if (hue) host.setAttribute("data-root-hue", hue);
    } catch (error) {}
    const stripHost = view.dayStripHost || (view.dayStripRecord && view.dayStripRecord.el) || null;
    let attached = false;
    try {
      if (stripHost && stripHost.parentNode === view.el && typeof view.el.insertBefore === "function") {
        let next = stripHost.nextSibling || null;
        if (!next && Array.isArray(view.el.children)) {
          const index = view.el.children.indexOf(stripHost);
          next = index >= 0 ? view.el.children[index + 1] || null : null;
        }
        view.el.insertBefore(host, next);
        attached = true;
      }
    } catch (error) {
      attached = false;
    }
    if (!attached) {
      try {
        if (Array.isArray(view.el.children)) {
          const index = stripHost ? view.el.children.indexOf(stripHost) : -1;
          host.parentNode = view.el;
          if (index >= 0) view.el.children.splice(index + 1, 0, host);
          else view.el.children.unshift(host);
          attached = true;
        } else if (typeof view.el.prepend === "function") {
          view.el.prepend(host);
          attached = true;
        } else if (typeof view.el.insertBefore === "function") {
          view.el.insertBefore(host, view.el.firstChild || null);
          attached = true;
        }
      } catch (error) {
        attached = false;
      }
    }
    if (!attached) return;
    const key = bankCacheKey(bankBuildArgs({ command: "report", date: day }));
    const record = { host, day, path: view.sourcePath, key, view, unsubscribe: null, result: null, state: null, unloaded: false };
    view.bankDailyHost = host;
    view.bankDailyRecord = record;
    this.bankDailyChipViewsStore().add(record);
    record.unsubscribe = this.apiBankSubscribe({ command: "report", date: day }, (state) => {
      if (record.unloaded || view.unloaded) return;
      record.state = state;
      record.result = state && state.results ? state.results[key] || null : null;
      this.bankDailyChipPaint(record);
    });
  }

  bankDailyChipPaint(record) {
    if (!record || record.unloaded || !record.host) return;
    const host = record.host;
    bankCardClear(host);
    const result = record.result;
    if (!result || !result.report) {
      if (result && result.error) {
        const error = bankErrorModel(result.error);
        bankCardAppend(host, "span", { class: "bob-plan-chip bob-bank-daily-chip bob-bank-chip-error", role: "status", title: error.hint }, "Bank unavailable");
      } else {
        bankCardAppend(host, "span", { class: "bob-plan-chip bob-bank-daily-chip bob-bank-chip-loading", role: "status" }, "Bank · loading");
      }
      return;
    }
    if (result.report.teaching_empty === true) return;
    const model = bankCardDailyChipModel(result.report, record.day, record.state && record.state.today || bankLocalDate());
    if (model.kind !== "day") {
      bankCardAppend(host, "span", { class: "bob-plan-chip bob-bank-daily-chip bob-bank-chip-error", role: "status" }, "Bank · unavailable");
      return;
    }
    const out = bankCardDisplayCents(Math.abs(model.outCents));
    const incoming = bankCardDisplayCents(Math.abs(model.inCents), true);
    const text = `BANK · out ${out} · in ${incoming}${model.waitingAll === null ? "" : ` · ${model.waitingAll} waiting`}`;
    const button = bankCardAppend(host, "button", {
      type: "button",
      class: "bob-plan-chip bob-bank-daily-chip",
      "aria-label": `Open bank rows for ${record.day}; out ${out}; in ${incoming}${model.waitingAll === null ? "" : `; ${model.waitingAll} waiting across all months`}`,
      title: result.stale ? "Bank values are being refreshed; last good values shown" : `Open ${record.day} in the bank month note`,
    }, text);
    if (button) {
      if (result.stale) bankCardSetData(button, "stale", "true");
      bankCardListen(button, "click", () => {
        if (!record.unloaded) void this.bankApi().ensureOpenDay(record.day);
      });
    }
    if (result.error) {
      bankCardAppend(host, "span", { class: "bob-bank-chip-refresh-error", role: "status" }, "Refresh failed; values may be stale");
    }
  }

  bankRefreshPlanHosts() {
    try {
      if (!(this.planBlockViews instanceof Set)) return;
      for (const view of this.planBlockViews) this.bankSyncPlanHost(view);
    } catch (error) {
      // One note never interrupts another plan block.
    }
  }

  bankReleasePlanHost(view) {
    if (!view) return;
    const record = view.bankDailyRecord || null;
    if (record) {
      record.unloaded = true;
      try { if (typeof record.unsubscribe === "function") record.unsubscribe(); } catch (error) {}
      if (this.bankDailyChipViews instanceof Set) this.bankDailyChipViews.delete(record);
    }
    const host = view.bankDailyHost || (record && record.host) || null;
    if (host && host.parentNode === view.el) dayStripPlanHostRemoveNode(host);
    view.bankDailyRecord = null;
    view.bankDailyHost = null;
  }

  teardownBankDailyChip() {
    if (this.planBlockViews instanceof Set) {
      for (const view of this.planBlockViews) this.bankReleasePlanHost(view);
    }
    if (this.bankDailyChipViews instanceof Set) {
      for (const record of this.bankDailyChipViews) {
        record.unloaded = true;
        try { if (typeof record.unsubscribe === "function") record.unsubscribe(); } catch (error) {}
      }
      this.bankDailyChipViews.clear();
    }
    if (this.bankDailyChipTimer !== null && this.bankDailyChipTimer !== undefined) {
      try {
        const hasTimerHost = Boolean(
          (this.bankTimers && typeof this.bankTimers === "object") ||
          (typeof window !== "undefined" && window),
        );
        const timers = hasTimerHost ? this.bankTimerApi() : null;
        if (timers && typeof timers.clearInterval === "function") timers.clearInterval(this.bankDailyChipTimer);
      } catch (error) {}
    }
    this.bankDailyChipTimer = null;
    this.bankDailyChipConfigLastEnabled = null;
  }
}
