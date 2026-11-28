// Notebook Card shared foot adapter: created stamp, copy-only capture route,
// lint slot, and the full Properties drawer. Zorg provenance and template
// keys fold under the kit's closed Managed group.
const NOTEBOOK_CARD_FOOT_KIND = "notebook";
class BobLedgerToolsNotebookCardFootMixin {
  notebookCardFootBind() {
    if (!(this.notebookCardSourceCache instanceof Map)) this.notebookCardSourceCache = new Map();
    if (!(this.notebookCardSourceFlights instanceof Map)) this.notebookCardSourceFlights = new Map();
    if (!(this.notebookCardFootTracked instanceof Set)) this.notebookCardFootTracked = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "notebookCardFootPendingScroll",
      untoggleKey: "notebookCardFootUntoggle",
      unresolverKey: "notebookCardFootUnresolver",
      refresh: () => this.scheduleNotebookCardRefresh?.(),
      livePath: (view) => this.notebookCardLivePath?.(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.notebookCardFootMetaBound) {
        this.notebookCardFootMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = notebookCardPath(file?.path);
          if (!path) return;
          this.notebookCardSourceCache?.delete?.(path);
          this.notebookCardSourceFlights?.delete?.(path);
          this.scheduleNotebookCardRefresh?.();
        }));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.notebookCardFootVaultBound) {
        this.notebookCardFootVaultBound = true;
        this.registerEvent(vault.on("rename", (file, oldPath) => {
          try { propertyCardFootRenamePath?.(oldPath, file?.path); } catch (_) {}
          const next = notebookCardPath(file?.path);
          const previous = notebookCardPath(oldPath);
          if (previous && previous !== next) {
            this.notebookCardSourceCache?.delete?.(previous);
            this.notebookCardSourceFlights?.delete?.(previous);
            this.notebookCardCollapsed?.delete?.(previous);
          }
          this.scheduleNotebookCardRefresh?.();
        }));
        this.registerEvent(vault.on("delete", (file) => {
          try { propertyCardFootReleasePath?.(file?.path); } catch (_) {}
          const path = notebookCardPath(file?.path);
          this.notebookCardSourceCache?.delete?.(path);
          this.notebookCardSourceFlights?.delete?.(path);
          this.notebookCardCollapsed?.delete?.(path);
          this.scheduleNotebookCardRefresh?.();
        }));
      }
    } catch (_) {}
  }

  notebookCardFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "notebookCardFootPendingScroll",
      untoggleKey: "notebookCardFootUntoggle",
      unresolverKey: "notebookCardFootUnresolver",
      tracked: this.notebookCardFootTracked,
      cache: this.notebookCardSourceCache,
      flights: this.notebookCardSourceFlights,
    });
    this.notebookCardFootMetaBound = false;
    this.notebookCardFootVaultBound = false;
  }

  notebookCardRememberSource(path, text) {
    if (!(this.notebookCardSourceCache instanceof Map)) this.notebookCardSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.notebookCardSourceCache, path, text);
  }

  notebookCardEnsureSource(path) {
    if (!(this.notebookCardSourceCache instanceof Map)) this.notebookCardSourceCache = new Map();
    if (!(this.notebookCardSourceFlights instanceof Map)) this.notebookCardSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.notebookCardSourceCache,
      flights: this.notebookCardSourceFlights,
      active: () => this.notebookCardActive === true,
      refresh: () => this.scheduleNotebookCardRefresh?.(),
    });
  }

  notebookCardFrontmatter(path) {
    try { return propertyCardFootAdapterFrontmatter(this, path) || {}; } catch (_) { return {}; }
  }

  notebookCardFootSpec(path, model) {
    const filePath = notebookCardPath(path);
    const frontmatter = this.notebookCardFrontmatter(filePath);
    const managed = { ...NOTEBOOK_CARD_MANAGED_KEYS };
    for (const key of Object.keys(frontmatter)) {
      if (/^zorg_/i.test(key) || /^generated_from_zorg/i.test(key)) managed[key] = true;
    }
    // Report-backed warnings join the kit lint chip. Errors stay a visible
    // pill in the readout slot; the chip only names warnings.
    let contractIssues = [];
    try {
      const readout = typeof this.notebookCardReadoutFor === "function"
        ? this.notebookCardReadoutFor(filePath) : null;
      contractIssues = typeof notebookCardReadoutFootWarnings === "function"
        ? notebookCardReadoutFootWarnings(readout) : [];
    } catch (_) {
      contractIssues = [];
    }
    return propertyCardFootAdapterSpec({
      path: filePath,
      kind: "notebook",
      sourceText: this.notebookCardSourceCache?.get?.(filePath),
      frontmatter,
      where: model?.where || {},
      managed,
      contractIssues,
    });
  }

  notebookCardFootExtra(path, model) {
    try {
      return propertyCardFootAdapterExtra(path, this.notebookCardFootSpec(path, model));
    } catch (_) {
      return propertyCardFootAdapterExtra(path, {
        path: notebookCardPath(path), inventory: propertyCardFootAdapterPendingInventory(), stamp: null,
      });
    }
  }

  notebookCardFootHandlers(path) {
    const filePath = notebookCardPath(path);
    return propertyCardFootAdapterHandlers(this, filePath, {
      species: "notebook",
      pendingScroll: this.notebookCardFootPendingScroll,
      refresh: () => this.scheduleNotebookCardRefresh?.(),
      hoverSource: "bob-notebook-card",
      jumpYaml: (key, line) => { void this.notebookCardJumpYaml?.(filePath, key, line); },
      jumpRecovery: () => { void this.notebookCardJumpYaml?.(filePath, "", 1); },
      openPath: (target, event) => { void this.notebookHeaderOpenPath?.(target, filePath, event); },
    });
  }

  notebookCardTrackFoot(container, path, card) {
    return propertyCardFootAdapterTrack(container, path, card, this.notebookCardFootTracked, "notebook");
  }

  notebookCardCopyRoute(route) {
    const token = String(route || "").trim();
    if (!token) return false;
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    void Promise.resolve(clipboard.writeText(token)).then(() => {
      try { new Notice(`Copied ${token}`); } catch (_) {}
    }, () => {
      try { new Notice("Could not copy the notebook route."); } catch (_) {}
    });
    return true;
  }

  notebookCardAppendFoot(card, path, model, doc, footSpec, options = {}) {
    const filePath = notebookCardPath(path);
    const spec = footSpec || this.notebookCardFootSpec(filePath, model);
    const built = propertyCardFootAdapterAppend(
      card, filePath, doc, options.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.notebookCardFootHandlers(filePath), this.notebookCardFootPendingScroll,
      { species: "notebook" },
    );
    if (!built?.element || !model?.route) return built;
    const route = notebookCardDomEl(doc, "button", "bob-notebook-card-route");
    route.setAttribute("type", "button");
    route.setAttribute("data-notebook-route", model.route);
    route.setAttribute("aria-label", `Copy notebook capture route ${model.route}`);
    route.setAttribute("title", "Copy notebook capture route");
    notebookCardDomText(doc, route, model.route);
    route.addEventListener?.("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      this.notebookCardCopyRoute(model.route);
    });
    try { built.element.insertBefore(route, built.disclosure || built.element.firstChild || null); } catch (_) {
      built.element.appendChild(route);
    }
    return built;
  }
}
