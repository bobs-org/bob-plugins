// Bank setup header shared-foot adapter (bob-cli-pf adapters). The foot
// appends after bankSetupBuildEl so collapsed, loading, and mobile states
// still carry it. Fence, category, and modal surfaces stay foot-free.
class BobLedgerToolsBankSetupFootMixin {
  bankSetupFootBind() {
    if (!(this.bankSetupSourceCache instanceof Map)) this.bankSetupSourceCache = new Map();
    if (!(this.bankSetupSourceFlights instanceof Map)) this.bankSetupSourceFlights = new Map();
    if (!(this.bankSetupFootTracked instanceof Set)) this.bankSetupFootTracked = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "bankSetupFootPendingScroll",
      untoggleKey: "bankSetupFootUntoggle",
      unresolverKey: "bankSetupFootUnresolver",
      refresh: () => this.scheduleBankSetupRefresh(),
      livePath: (view) => this.bankSetupLivePath(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.bankSetupFootMetaBound) {
        this.bankSetupFootMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = bankSetupHubPath(file?.path);
          if (!path || !bankSetupIsHubPath(path)) return;
          this.bankSetupSourceCache?.delete?.(path);
          this.bankSetupSourceFlights?.delete?.(path);
          this.scheduleBankSetupRefresh();
        }));
      }
    } catch (_) {}
  }

  bankSetupFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "bankSetupFootPendingScroll",
      untoggleKey: "bankSetupFootUntoggle",
      unresolverKey: "bankSetupFootUnresolver",
      tracked: this.bankSetupFootTracked,
      cache: this.bankSetupSourceCache,
      flights: this.bankSetupSourceFlights,
    });
  }

  bankSetupRememberSource(path, text) {
    if (!(this.bankSetupSourceCache instanceof Map)) this.bankSetupSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.bankSetupSourceCache, path, text);
  }

  bankSetupEnsureSource(path) {
    if (!(this.bankSetupSourceCache instanceof Map)) this.bankSetupSourceCache = new Map();
    if (!(this.bankSetupSourceFlights instanceof Map)) this.bankSetupSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.bankSetupSourceCache,
      flights: this.bankSetupSourceFlights,
      active: () => this.bankSetupActive !== false,
      refresh: () => this.scheduleBankSetupRefresh(),
    });
  }

  bankSetupFootSpec(path) {
    const filePath = bankSetupHubPath(path) || BANK_SETUP_HUB_PATH;
    const nested = {};
    if (this.bankSetupDesktop?.() !== false) nested.bank = "setup";
    return propertyCardFootAdapterSpec({
      path: filePath,
      kind: "bank",
      sourceText: this.bankSetupSourceCache?.get?.(filePath),
      frontmatter: propertyCardFootAdapterFrontmatter(this, filePath),
      where: { bank: "card", created: "foot" },
      nested,
    });
  }

  bankSetupFootExtra(path) {
    let spec = null;
    try { spec = this.bankSetupFootSpec(path); } catch (_) { spec = null; }
    if (!spec) {
      spec = {
        path: bankSetupHubPath(path) || BANK_SETUP_HUB_PATH,
        inventory: propertyCardFootAdapterPendingInventory(),
        stamp: null,
      };
    }
    return propertyCardFootAdapterExtra(path, spec);
  }

  bankSetupFootHandlers(path) {
    const filePath = bankSetupHubPath(path) || BANK_SETUP_HUB_PATH;
    return propertyCardFootAdapterHandlers(this, filePath, {
      pendingScroll: this.bankSetupFootPendingScroll,
      refresh: () => this.scheduleBankSetupRefresh(),
      hoverSource: "bob-bank-setup",
      jumpYaml: (key, line) => { void this.bankSetupJumpYaml(filePath, line); },
      jumpRecovery: () => { void this.bankSetupJumpYaml(filePath, 1); },
      openPath: (target, event) => {
        try {
          const workspace = this.app?.workspace;
          if (workspace && typeof workspace.openLinkText === "function") {
            const pane = typeof albumHeaderLinkPane === "function"
              ? albumHeaderLinkPane(event)
              : Boolean(event?.ctrlKey || event?.metaKey);
            void workspace.openLinkText(String(target || "").replace(/\.md$/i, ""), filePath, pane);
          }
        } catch (_) {}
      },
      openNested: this.bankSetupDesktop?.() === false ? null : (key) => {
        if (key === "bank") void this.openBankSetupCard?.({ sourcePath: filePath });
      },
    });
  }

  bankSetupTrackFoot(container, path, header) {
    return propertyCardFootAdapterTrack(container, path, header, this.bankSetupFootTracked);
  }

  bankSetupAppendFoot(header, path, doc, footSpec) {
    const filePath = bankSetupHubPath(path) || BANK_SETUP_HUB_PATH;
    const spec = footSpec || this.bankSetupFootSpec(filePath);
    return propertyCardFootAdapterAppend(
      header, filePath, doc, spec, this.bankSetupFootHandlers(filePath), this.bankSetupFootPendingScroll,
    );
  }

  bankSetupFootSignature(model, extra, options) {
    const base = typeof bankSetupSignature === "function"
      ? bankSetupSignature(model, options)
      : (model && model.signature);
    return [base, extra?.footDigest || "", extra?.footOpen === true].join("::");
  }
}
