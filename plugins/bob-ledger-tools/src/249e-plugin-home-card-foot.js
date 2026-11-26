// Home-card shared-foot adapter (bob-cli-pl.4.1 mount-foot). Truthful
// where-marks from the pure model, managed fold for home housekeeping keys,
// and the kit append below card content. Never hides native Properties,
// never writes, never spawns bob.
class BobLedgerToolsHomeCardFootMixin {
  homeCardFootBind() {
    if (!(this.homeCardSourceCache instanceof Map)) this.homeCardSourceCache = new Map();
    if (!(this.homeCardSourceFlights instanceof Map)) this.homeCardSourceFlights = new Map();
    if (!(this.homeCardFootTracked instanceof Set)) this.homeCardFootTracked = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "homeCardFootPendingScroll",
      untoggleKey: "homeCardFootUntoggle",
      unresolverKey: "homeCardFootUnresolver",
      refresh: () => this.scheduleHomeCardRefresh(),
      livePath: (view) => this.homeCardLivePath(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.homeCardFootMetaBound) {
        this.homeCardFootMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = homeCardPath(file?.path);
          if (!path) return;
          this.homeCardSourceCache?.delete?.(path);
          this.homeCardSourceFlights?.delete?.(path);
          this.scheduleHomeCardRefresh();
        }));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.homeCardFootVaultBound) {
        this.homeCardFootVaultBound = true;
        this.registerEvent(vault.on("rename", (file, oldPath) => {
          try {
            if (typeof propertyCardFootRenamePath === "function") propertyCardFootRenamePath(oldPath, file?.path);
          } catch (_) {}
          try {
            const next = homeCardPath(file?.path);
            const prev = homeCardPath(oldPath);
            if (prev && prev !== next) {
              this.homeCardSourceCache?.delete?.(prev);
              this.homeCardSourceFlights?.delete?.(prev);
              this.homeCardCollapsed?.delete?.(prev);
            }
          } catch (_) {}
          this.scheduleHomeCardRefresh();
        }));
        this.registerEvent(vault.on("delete", (file) => {
          try {
            if (typeof propertyCardFootReleasePath === "function") propertyCardFootReleasePath(file?.path);
          } catch (_) {}
          try {
            const path = homeCardPath(file?.path);
            this.homeCardSourceCache?.delete?.(path);
            this.homeCardSourceFlights?.delete?.(path);
          } catch (_) {}
          this.scheduleHomeCardRefresh();
        }));
      }
    } catch (_) {}
  }

  homeCardFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "homeCardFootPendingScroll",
      untoggleKey: "homeCardFootUntoggle",
      unresolverKey: "homeCardFootUnresolver",
      tracked: this.homeCardFootTracked,
      cache: this.homeCardSourceCache,
      flights: this.homeCardSourceFlights,
    });
    this.homeCardFootMetaBound = false;
    this.homeCardFootVaultBound = false;
  }

  homeCardRememberSource(path, text) {
    if (!(this.homeCardSourceCache instanceof Map)) this.homeCardSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.homeCardSourceCache, path, text);
  }

  homeCardEnsureSource(path) {
    if (!(this.homeCardSourceCache instanceof Map)) this.homeCardSourceCache = new Map();
    if (!(this.homeCardSourceFlights instanceof Map)) this.homeCardSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.homeCardSourceCache,
      flights: this.homeCardSourceFlights,
      active: () => this.homeCardActive !== false,
      refresh: () => this.scheduleHomeCardRefresh(),
    });
  }

  homeCardFrontmatter(path) {
    try {
      return propertyCardFootAdapterFrontmatter(this, path) || {};
    } catch (_) {
      return {};
    }
  }

  homeCardFootContract(model) {
    try {
      const contract = model && typeof model === "object" && model.contract
        && typeof model.contract === "object" ? model.contract : null;
      const issues = contract && Array.isArray(contract.issues) ? contract.issues : [];
      const clean = [];
      for (const issue of issues) {
        if (!issue || typeof issue !== "object") continue;
        const code = typeof issue.code === "string" ? issue.code.trim() : "";
        const message = typeof issue.message === "string" ? issue.message.trim() : "";
        if (!code || !message) continue;
        clean.push({
          code,
          severity: typeof issue.severity === "string" && issue.severity ? issue.severity : "warning",
          message,
          setting: typeof issue.setting === "string" ? issue.setting : "",
        });
      }
      if (!clean.length) return null;
      let firstSetting = "";
      try {
        firstSetting = typeof contract.firstSetting === "string" ? contract.firstSetting : "";
        if (!firstSetting) {
          const named = clean.find((issue) => issue.setting);
          firstSetting = named ? named.setting : "";
        }
      } catch (_) {
        firstSetting = "";
      }
      return { issues: clean, firstSetting };
    } catch (_) {
      return null;
    }
  }

  // One foot computation per paint: signature, mount, and drawer share it.
  // where comes from the pure model so the drawer never claims a field the
  // card does not paint; managed folds the five home housekeeping keys.
  // contractIssues carries the report row's setting lint for the kit chip.
  homeCardFootSpec(path, model) {
    const filePath = homeCardPath(path);
    const frontmatter = this.homeCardFrontmatter(filePath);
    const where = model && model.where && typeof model.where === "object" ? { ...model.where } : {};
    const nested = {};
    if (filePath === "bank.md") {
      let bankModel = null;
      try { bankModel = this.bankSetupModelFor?.(filePath) || null; } catch (_) {}
      if (bankModel?.expanded === true) where.bank = "setup";
      try {
        if (this.bankSetupDesktop?.() !== false) nested.bank = "setup";
      } catch (_) { nested.bank = "setup"; }
    }
    let managed = null;
    try {
      managed = model && model.managed && typeof model.managed === "object" ? model.managed : homeCardManagedMap();
    } catch (_) {
      managed = null;
    }
    if (!managed) {
      try { managed = homeCardManagedMap(); } catch (_) { managed = {}; }
    }
    let contract = null;
    try { contract = this.homeCardFootContract(model); } catch (_) { contract = null; }
    return propertyCardFootAdapterSpec({
      path: filePath,
      kind: (model && model.kind) || "",
      sourceText: this.homeCardSourceCache?.get?.(filePath),
      frontmatter,
      where,
      nested,
      legacy: {},
      managed,
      contractIssues: contract ? contract.issues : [],
      firstSetting: contract ? contract.firstSetting : "",
    });
  }

  homeCardFootExtra(path, model) {
    let spec = null;
    try { spec = this.homeCardFootSpec(path, model); } catch (_) { spec = null; }
    if (!spec) {
      spec = {
        path: homeCardPath(path),
        inventory: propertyCardFootAdapterPendingInventory(),
        stamp: null,
      };
    }
    return propertyCardFootAdapterExtra(path, spec);
  }

  homeCardFootHandlers(path) {
    const filePath = homeCardPath(path);
    return propertyCardFootAdapterHandlers(this, filePath, {
      pendingScroll: this.homeCardFootPendingScroll,
      refresh: () => this.scheduleHomeCardRefresh(),
      hoverSource: "bob-home-card",
      jumpYaml: (key, line) => { void this.homeCardJumpYaml(filePath, key, line); },
      jumpRecovery: () => { void this.homeCardJumpYaml(filePath, "", 1); },
      openPath: (target, event) => { void this.homeCardOpenPath(target, filePath, event); },
      openSetting: (setting) => { void this.homeCardOpenSetting(filePath, setting || undefined); },
      openNested: filePath === "bank.md" && this.bankSetupDesktop?.() !== false
        ? (key) => { if (key === "bank") void this.openBankSetupCard?.({ sourcePath: filePath }); }
        : null,
    });
  }

  homeCardTrackFoot(container, path, card) {
    return propertyCardFootAdapterTrack(container, path, card, this.homeCardFootTracked);
  }

  // Append the shared foot after content, outside the collapsible body.
  homeCardAppendFoot(card, path, model, doc, footSpec, options) {
    const key = homeCardPath(path);
    if (!card || !key) return null;
    const spec = footSpec || this.homeCardFootSpec(key, model);
    return propertyCardFootAdapterAppend(
      card, key, doc,
      spec && options?.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.homeCardFootHandlers(key), this.homeCardFootPendingScroll,
    );
  }
}
