// Shared read-only Bank Badge host lifecycle and painter wiring. Every stats
// strip host registers here so one bank refresh updates all of them.

function bankBadgeActivate(node, action) {
  if (!node || typeof node.addEventListener !== "function" || typeof action !== "function") return;
  const invoke = (event, forcedNewLeaf = false) => {
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    action(newLeaf);
  };
  node.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", (event) => invoke(event));
  node.addEventListener("auxclick", (event) => {
    if (event && event.button === 1) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      invoke(event, true);
    }
  });
  node.addEventListener("keydown", (event) => {
    if (!event || (event.key !== "Enter" && event.key !== " ")) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    invoke(event);
  });
}

function bankBadgePaintPart(doc, modelPart) {
  const part = statsEl(doc, "span", { class: `bob-bank-badge-part bob-bank-badge-part-${modelPart.key}` });
  if (!part) return null;
  const add = (className, value) => {
    if (!value) return;
    const node = statsEl(doc, "span", { class: className }, value);
    if (node && typeof part.appendChild === "function") part.appendChild(node);
  };
  if (modelPart.amountFirst) {
    add("bob-bank-badge-amount", modelPart.amount);
    add("bob-bank-badge-words", modelPart.words);
  } else {
    add("bob-bank-badge-words", modelPart.words);
    add("bob-bank-badge-amount", modelPart.amount);
  }
  return part;
}

function bankBadgePaint(host, model, handlers = {}) {
  if (!host) return null;
  bankCardClear(host);
  if (!model || model.state === "hidden" || model.state === "loading") return null;
  const doc = statsDocFor(host);
  if (model.state === "unavailable") {
    return bankCardAppend(host, "span", {
      class: "bob-bank-badge-unavailable",
      role: "status",
      title: model.hint || "The bank report could not be read.",
    }, "Bank unavailable");
  }
  if (model.state !== "badge") return null;

  const badge = bankCardAppend(host, "span", {
    class: "bob-bank-badge",
    role: "link",
    tabindex: "0",
    "aria-label": model.ariaLabel,
    title: model.tooltip,
    "data-tone": model.tone,
    "data-kind": model.kind,
    "data-stale": model.stale ? "true" : "false",
  });
  if (!badge) return null;
  const label = statsEl(doc, "span", { class: "bob-bank-badge-label" }, model.label || "BANK");
  if (label) badge.appendChild(label);
  for (const partModel of Array.isArray(model.parts) ? model.parts : []) {
    const separator = statsEl(doc, "span", { class: "bob-bank-badge-separator", "aria-hidden": "true" }, "·");
    if (separator) badge.appendChild(separator);
    const part = bankBadgePaintPart(doc, partModel);
    if (part) badge.appendChild(part);
  }
  bankBadgeActivate(badge, (newLeaf) => {
    if (typeof handlers.activate === "function") handlers.activate(model.target, newLeaf);
  });
  return badge;
}

class BobLedgerToolsBankBadgeMixin {
  setupBankBadge() {
    this.bankBadgeConfigLastEnabled = this.bankBadgeConfigEnabled();
    this.bankBadgeTimer = null;
    this.bankBadgeHostsStore();
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "delete", "rename", "modify"]) {
          this.registerEvent(vault.on(event, (file, oldPath) => {
            if (bankRelevantPath(file) || bankIsHubPath(oldPath || "")) this.bankRefreshBadgeHosts();
          }));
        }
      }
    } catch (error) {
      // The bank data service owns refresh; this listener only updates host visibility.
    }
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file) => {
          if (bankIsHubPath(file || "")) this.bankRefreshBadgeHosts();
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
        this.bankBadgeTimer = timers.setInterval(() => this.bankBadgeCheckConfig(), 60 * 1000);
        if (typeof this.registerInterval === "function") this.registerInterval(this.bankBadgeTimer);
      }
    } catch (error) {
      this.bankBadgeTimer = null;
    }
  }

  bankBadgeConfigEnabled() {
    try {
      const badge = statsReadConfigValue("bank_badge");
      if (typeof badge === "boolean") return badge;
      const legacy = statsReadConfigValue("bank_chip");
      return typeof legacy === "boolean" ? legacy : true;
    } catch (error) {
      return true;
    }
  }

  bankBadgeEnabled() {
    if (typeof this.bankBadgeConfigLastEnabled !== "boolean") {
      this.bankBadgeConfigLastEnabled = this.bankBadgeConfigEnabled();
    }
    return this.bankBadgeConfigLastEnabled;
  }

  bankBadgeCheckConfig() {
    try {
      const enabled = this.bankBadgeConfigEnabled();
      if (enabled === this.bankBadgeConfigLastEnabled) return false;
      this.bankBadgeConfigLastEnabled = enabled;
      this.bankRefreshBadgeHosts();
      return true;
    } catch (error) {
      return false;
    }
  }

  bankBadgeHostsStore() {
    if (!(this.bankBadgeHosts instanceof Set)) this.bankBadgeHosts = new Set();
    return this.bankBadgeHosts;
  }

  bankBadgeRegisterHost(record) {
    if (!record || typeof record.sync !== "function") return false;
    this.bankBadgeHostsStore().add(record);
    return true;
  }

  bankBadgeUnregisterHost(record) {
    if (this.bankBadgeHosts instanceof Set) this.bankBadgeHosts.delete(record);
  }

  bankBadgeHostForRepaint(el) {
    try {
      if (!el) return null;
      const view = this.dayStripPlanHostViewFor(el);
      if (view && view.bankBadgeHost && view.bankBadgeHost.parentNode === el) return view.bankBadgeHost;
      if (typeof el.querySelector === "function") return el.querySelector(".bob-bank-badge-host");
      if (Array.isArray(el.children)) {
        return el.children.find((child) => {
          const classes = (child && typeof child.getAttribute === "function" ? child.getAttribute("class") : child && child.cls) || "";
          return String(classes).split(/\s+/).includes("bob-bank-badge-host");
        }) || null;
      }
    } catch (error) {}
    return null;
  }

  bankBadgeHubExists() {
    try {
      const vault = this.app && this.app.vault;
      return Boolean(vault && typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath("bank.md"));
    } catch (error) {
      return false;
    }
  }

  bankBadgeLocalToday() {
    return bankLocalDate();
  }

  bankSyncPlanHost(view) {
    if (!view || !view.el) return;
    const day = dayStripDayForPath(view.sourcePath || "");
    const today = this.bankBadgeLocalToday();
    let excluded = false;
    try {
      excluded = dayStripPlanHostExcluded(view.el) || dayStripPlanHostExcluded(view.containerEl);
    } catch (error) {}
    if (
      !day ||
      (today && day > today) ||
      !this.bankBadgeEnabled() ||
      !this.bankBadgeHubExists() ||
      (typeof this.dayStripCanSpawn === "function" && !this.dayStripCanSpawn()) ||
      excluded ||
      this.bankDataActive === false
    ) {
      this.bankReleasePlanHost(view);
      return;
    }
    const existing = view.bankBadgeRecord || null;
    if (existing && existing.day === day && existing.host && existing.host.parentNode === view.el) return;

    this.bankReleasePlanHost(view);
    let host = null;
    try {
      host = statsEl(statsDocFor(view.el), "div", { class: "bob-bank-badge-host" });
    } catch (error) {
      host = null;
    }
    if (!host) return;
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

    const spec = { command: "report", date: day };
    const key = bankCacheKey(bankBuildArgs(spec));
    const record = {
      host, day, path: view.sourcePath, key, view,
      unsubscribe: null, result: null, state: null, unloaded: false,
      sync: () => this.bankBadgePaintRecord(record),
    };
    view.bankBadgeHost = host;
    view.bankBadgeRecord = record;
    this.bankBadgeRegisterHost(record);
    record.unsubscribe = this.apiBankSubscribe(spec, (state) => {
      if (record.unloaded || view.unloaded) return;
      record.state = state;
      record.result = state && state.results ? state.results[key] || null : null;
      record.sync();
    });
  }

  bankBadgePaintRecord(record) {
    if (!record || record.unloaded || !record.host) return;
    const result = record.result;
    if (!result || !result.report) {
      const model = result && result.error
        ? { state: "unavailable", reason: "fetch-failed", hint: bankErrorModel(result.error).hint }
        : null;
      bankBadgePaint(record.host, model);
      return;
    }
    const model = bankBadgeModel(result.report, {
      kind: "day",
      day: record.day,
      today: record.state && record.state.today || bankLocalDate(),
      stale: result.stale === true,
      refreshFailed: Boolean(result.error),
    });
    bankBadgePaint(record.host, model, {
      activate: (target, newLeaf) => {
        if (!record.unloaded) void this.bankBadgeNavigate(target, newLeaf);
      },
    });
  }

  async bankBadgeNavigate(target, newLeaf = false) {
    const path = target && typeof target.path === "string" ? target.path : "bank.md";
    const vault = this.app && this.app.vault;
    const file = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(path)
      : null;
    if (!file) {
      new Notice(`Bank: could not find ${path}`);
      return false;
    }
    const line = target && Number.isInteger(target.line) && target.line > 0 ? target.line : 1;
    const opened = await this.bankOpenMonthPathAtLine(path, line, 0, { newLeaf, skipPendingSave: true });
    if (!opened) new Notice(`Bank: could not open ${path}`);
    return Boolean(opened);
  }

  bankRefreshBadgeHosts() {
    try {
      if (this.planBlockViews instanceof Set) {
        for (const view of Array.from(this.planBlockViews)) this.bankSyncPlanHost(view);
      }
      for (const record of Array.from(this.bankBadgeHostsStore())) {
        try { record.sync(); } catch (error) {}
      }
    } catch (error) {
      // One detached host never interrupts another badge.
    }
  }

  // Kept as an internal compatibility name for existing plan-host callers.
  bankRefreshPlanHosts() {
    this.bankRefreshBadgeHosts();
  }

  bankReleasePlanHost(view) {
    if (!view) return;
    const record = view.bankBadgeRecord || null;
    if (record) {
      record.unloaded = true;
      this.bankBadgeUnregisterHost(record);
      try { if (typeof record.unsubscribe === "function") record.unsubscribe(); } catch (error) {}
    }
    const host = view.bankBadgeHost || (record && record.host) || null;
    if (host && host.parentNode === view.el) dayStripPlanHostRemoveNode(host);
    view.bankBadgeRecord = null;
    view.bankBadgeHost = null;
  }

  teardownBankBadge() {
    if (this.planBlockViews instanceof Set) {
      for (const view of this.planBlockViews) this.bankReleasePlanHost(view);
    }
    if (this.bankBadgeHosts instanceof Set) {
      for (const record of this.bankBadgeHosts) {
        record.unloaded = true;
        try { if (typeof record.unsubscribe === "function") record.unsubscribe(); } catch (error) {}
      }
      this.bankBadgeHosts.clear();
    }
    if (this.bankBadgeTimer !== null && this.bankBadgeTimer !== undefined) {
      try {
        const hasTimerHost = Boolean(
          (this.bankTimers && typeof this.bankTimers === "object") ||
          (typeof window !== "undefined" && window),
        );
        const timers = hasTimerHost ? this.bankTimerApi() : null;
        if (timers && typeof timers.clearInterval === "function") timers.clearInterval(this.bankBadgeTimer);
      } catch (error) {}
    }
    this.bankBadgeTimer = null;
    this.bankBadgeConfigLastEnabled = null;
  }
}
