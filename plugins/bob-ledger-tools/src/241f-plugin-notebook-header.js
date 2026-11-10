// Linked notebook headers in Reading view and Live Preview, plus the
// persistent Notebook chips setting. Headers never write note text and
// never appear in Source mode.

const NOTEBOOK_HEADER_CLASS = "bob-notebook-header";
const NOTEBOOK_HEADER_NAV_CLASS = "bob-notebook-header-nav";
const NOTEBOOK_HEADER_CRUMB_CLASS = "bob-notebook-header-crumb";
const NOTEBOOK_HEADER_SEP = " › ";
const NOTEBOOK_HEADER_CHILDREN_CLASS = "bob-notebook-header-children";
const NOTEBOOK_HEADER_CHILD_CLASS = "bob-notebook-header-child";

function notebookHeaderChipsDefault() {
  return true;
}

function notebookHeaderReadChipsFlag(stored) {
  if (stored && typeof stored === "object" && stored.notebookChips === false) {
    return false;
  }
  return true;
}

class BobLedgerToolsNotebookHeaderMixin {
  notebookChipsVisible() {
    if (this.notebookChipsEnabledFlag === false) {
      return false;
    }
    return true;
  }

  async loadNotebookChipsSetting() {
    const epoch = this.notebookHeaderEpoch || 0;
    try {
      if (typeof this.loadData !== "function") {
        this.notebookChipsEnabledFlag = true;
        return true;
      }
      const stored = await this.loadData();
      if (this.notebookHeaderActive === false || (this.notebookHeaderEpoch || 0) !== epoch) {
        return this.notebookChipsEnabledFlag;
      }
      if (stored && typeof stored === "object") {
        this.notebookPluginData = { ...stored };
      } else {
        this.notebookPluginData = {};
      }
      this.notebookChipsEnabledFlag = notebookHeaderReadChipsFlag(stored);
      try {
        this.refreshNotebookHeaderAll();
      } catch (error) {
        // Header refresh is best-effort.
      }
      try {
        if (typeof this.refreshNotebookCatalogReading === "function") {
          this.refreshNotebookCatalogReading();
        }
        if (typeof this.refreshNotebookCatalogEditors === "function") {
          this.refreshNotebookCatalogEditors();
        }
      } catch (error) {
        // Catalog refresh is best-effort.
      }
      return this.notebookChipsEnabledFlag;
    } catch (error) {
      if (this.notebookHeaderActive === false || (this.notebookHeaderEpoch || 0) !== epoch) {
        return this.notebookChipsEnabledFlag;
      }
      this.notebookChipsEnabledFlag = true;
      return true;
    }
  }

  async saveNotebookChipsSetting(enabled) {
    const nextEnabled = enabled !== false;
    this.notebookChipsEnabledFlag = nextEnabled;
    try {
      if (typeof this.saveData === "function") {
        const base = this.notebookPluginData && typeof this.notebookPluginData === "object"
          ? this.notebookPluginData
          : {};
        const next = { ...base, notebookChips: nextEnabled };
        this.notebookPluginData = next;
        await this.saveData(next);
      }
    } catch (error) {
      // Persistence is best-effort; the in-memory flag still applies.
    }
    try {
      this.refreshNotebookHeaderAll();
    } catch (error) {
      // Refresh is best-effort.
    }
    try {
      if (typeof this.refreshNotebookCatalogReading === "function") {
        this.refreshNotebookCatalogReading();
      }
      if (typeof this.refreshNotebookCatalogEditors === "function") {
        this.refreshNotebookCatalogEditors();
      }
    } catch (error) {
      // Catalog refresh is best-effort.
    }
    return nextEnabled;
  }

  setupNotebookHeaderSettingsTab() {
    try {
      if (typeof PluginSettingTab !== "function" || typeof Setting !== "function") {
        return false;
      }
      if (typeof this.addSettingTab !== "function") {
        return false;
      }
      const plugin = this;
      const TabClass = class extends PluginSettingTab {
        constructor(app, target) {
          super(app, target);
          this.target = target;
        }
        display() {
          try {
            const { containerEl } = this;
            if (containerEl && typeof containerEl.empty === "function") {
              containerEl.empty();
            } else if (containerEl) {
              containerEl.innerHTML = "";
            }
            if (containerEl && typeof containerEl.createEl === "function") {
              containerEl.createEl("h2", { text: "Bob Ledger Tools" });
            }
            const setting = new Setting(containerEl)
              .setName("Notebook chips")
              .setDesc(
                "Show live counts, age, add-summary and sync chips on notebook catalogs and child-notebook chips in headers. Ancestry links and catalog cards stay on. Sync still runs automatically.",
              );
            if (setting && typeof setting.addToggle === "function") {
              setting.addToggle((toggle) => toggle
                .setValue(plugin.notebookChipsVisible())
                .onChange(async (value) => {
                  await plugin.saveNotebookChipsSetting(value !== false);
                }));
            }
          } catch (error) {
            // Settings display is best-effort.
          }
        }
      };
      this.addSettingTab(new TabClass(this.app, this));
      return true;
    } catch (error) {
      return false;
    }
  }

  notebookHeaderHandlers(sourcePath) {
    const plugin = this;
    return {
      openPath: (path) => {
        void plugin.notebookHeaderOpenPath(path, sourcePath);
      },
    };
  }

  async notebookHeaderOpenPath(path, sourcePath) {
    const target = String(path || "").trim();
    if (!target) {
      return { ok: false };
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(target.replace(/\.md$/i, ""), sourcePath || "", false);
        return { ok: true };
      }
    } catch (error) {
      // Navigation is best-effort.
    }
    try {
      new Notice("Could not open the notebook.");
    } catch (error) {
      // Notice is best-effort.
    }
    return { ok: false };
  }

  notebookHeaderPaintOptions(sourcePath, state) {
    const current = state || (typeof this.notebookCatalogState === "function"
      ? this.notebookCatalogState()
      : this.notebookHeaderLastState || { report: null, today: notebookLocalDate() });
    return {
      report: current.report || null,
      sourcePath,
      hue: this.notebookHeaderHue(sourcePath),
      chipsEnabled: this.notebookChipsVisible(),
      metadataCache: this.app && this.app.metadataCache,
      vault: this.app && this.app.vault,
      handlers: this.notebookHeaderHandlers(sourcePath),
    };
  }

  notebookHeaderHue(sourcePath) {
    try {
      if (typeof this.notebookCatalogHue === "function") {
        return this.notebookCatalogHue(sourcePath);
      }
      return notebookHostHueName(
        sourcePath,
        this.app && this.app.metadataCache,
        this.app && this.app.vault,
      );
    } catch (error) {
      return null;
    }
  }

  setupNotebookHeader() {
    try {
      this.notebookHeaderActive = true;
      this.notebookHeaderEpoch = (this.notebookHeaderEpoch || 0) + 1;
      this.notebookChipsEnabledFlag = true;
      this.notebookPluginData = {};
      if (!(this.notebookHeaderReadingWidgets instanceof Set)) {
        this.notebookHeaderReadingWidgets = new Set();
      }
      if (!(this.notebookHeaderReadingTimers instanceof Map)) {
        this.notebookHeaderReadingTimers = new Map();
      }
      if (!(this.notebookHeaderReadingPending instanceof Map)) {
        this.notebookHeaderReadingPending = new Map();
      }
      try {
        void this.loadNotebookChipsSetting();
      } catch (error) {
        // Settings load is best-effort.
      }
      try {
        this.setupNotebookHeaderSettingsTab();
      } catch (error) {
        // Settings tab is best-effort.
      }
      try {
        const extension = this.createNotebookHeaderExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderNotebookHeaderInReading(el, ctx),
            49,
          );
        }
      } catch (error) {
        // Reading view is best-effort.
      }
      try {
        this.notebookHeaderUnsubscribe = typeof this.apiNotebookSubscribe === "function"
          ? this.apiNotebookSubscribe((state) => {
            this.notebookHeaderLastState = state;
            this.scheduleNotebookHeaderRefresh();
          })
          : null;
      } catch (error) {
        this.notebookHeaderUnsubscribe = null;
      }
    } catch (error) {
      // Header setup never throws.
    }
  }

  teardownNotebookHeader() {
    this.notebookHeaderActive = false;
    this.notebookHeaderEpoch = (this.notebookHeaderEpoch || 0) + 1;
    try {
      if (typeof this.notebookHeaderUnsubscribe === "function") {
        this.notebookHeaderUnsubscribe();
      }
    } catch (error) {
      // Unsubscribe is best-effort.
    }
    this.notebookHeaderUnsubscribe = null;
    if (this.notebookHeaderRefreshTimer !== null && this.notebookHeaderRefreshTimer !== undefined) {
      try {
        this.notebookClearTimeout(this.notebookHeaderRefreshTimer);
      } catch (error) {
        // Timer cleanup is best-effort.
      }
    }
    this.notebookHeaderRefreshTimer = null;
    if (this.notebookHeaderReadingTimers && typeof this.notebookHeaderReadingTimers.values === "function") {
      for (const timer of this.notebookHeaderReadingTimers.values()) {
        try {
          this.notebookClearTimeout(timer);
        } catch (error) {
          // Timer cleanup is best-effort.
        }
      }
      try {
        this.notebookHeaderReadingTimers.clear();
      } catch (error) {
        // Map cleanup is best-effort.
      }
    }
    if (this.notebookHeaderReadingPending && typeof this.notebookHeaderReadingPending.clear === "function") {
      try {
        this.notebookHeaderReadingPending.clear();
      } catch (error) {
        // Map cleanup is best-effort.
      }
    }
    if (this.notebookHeaderReadingWidgets instanceof Set) {
      for (const widget of Array.from(this.notebookHeaderReadingWidgets)) {
        try {
          this.notebookHeaderRemoveOwned(widget.surface || widget.el, widget.path);
        } catch (error) {
          // Unload cleanup is best-effort.
        }
      }
      this.notebookHeaderReadingWidgets.clear();
    }
  }

  notebookHeaderReadingRoot(el) {
    try {
      if (typeof notebookHeaderReadingSurface === "function") {
        return notebookHeaderReadingSurface(el);
      }
    } catch (error) {
      // Fall through to el.
    }
    return el;
  }

  notebookHeaderBelongsTo(node, surface, sourcePath) {
    void sourcePath;
    if (!node) {
      return false;
    }
    try {
      try {
        if (typeof node.getAttribute === "function" && node.getAttribute("data-cm-widget") === "true") {
          return false;
        }
        if (typeof node.closest === "function" && node.closest(".cm-widgetBuffer, .cm-content")) {
          return false;
        }
      } catch (error) {
        // CodeMirror ownership is best-effort.
      }
      try {
        const nestedEmbed = typeof node.closest === "function"
          ? node.closest(".markdown-embed, .internal-embed")
          : null;
        const surfaceEmbed = surface && typeof surface.closest === "function"
          ? surface.closest(".markdown-embed, .internal-embed")
          : null;
        if (nestedEmbed && nestedEmbed !== surfaceEmbed && nestedEmbed !== surface) {
          return false;
        }
      } catch (error) {
        // Embed comparison is best-effort.
      }
      if (surface && typeof surface.contains === "function") {
        return surface.contains(node);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  notebookHeaderRemoveOwned(surface, sourcePath) {
    if (!surface) {
      return;
    }
    try {
      const nodes = typeof surface.querySelectorAll === "function"
        ? Array.from(surface.querySelectorAll(`.${NOTEBOOK_HEADER_CLASS}`) || [])
        : [];
      for (const node of nodes) {
        if (!this.notebookHeaderBelongsTo(node, surface, sourcePath)) {
          continue;
        }
        if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
          node.parentNode.removeChild(node);
        } else if (node && typeof node.remove === "function") {
          node.remove();
        }
      }
    } catch (error) {
      // Cleanup is best-effort.
    }
  }

  notebookHeaderModelFor(sourcePath, state) {
    try {
      const report = state && state.report
        ? state.report
        : (typeof this.notebookCatalogState === "function" ? this.notebookCatalogState().report : null);
      if (!report) {
        return null;
      }
      return notebookHeaderModel(report, sourcePath, {
        metadataCache: this.app && this.app.metadataCache,
        vault: this.app && this.app.vault,
        sourcePath,
      });
    } catch (error) {
      return null;
    }
  }

  paintNotebookHeaderReading(el, sourcePath) {
    let state = null;
    try {
      state = typeof this.notebookCatalogState === "function"
        ? this.notebookCatalogState()
        : this.notebookHeaderLastState || null;
    } catch (error) {
      state = this.notebookHeaderLastState || null;
    }
    const options = this.notebookHeaderPaintOptions(sourcePath, state);
    const root = this.notebookHeaderReadingRoot(el);
    const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(root) : null)
      || (typeof document !== "undefined" ? document : null);
    let focusedHref = "";
    try {
      const active = doc && doc.activeElement;
      if (active && root && typeof root.contains === "function" && root.contains(active)) {
        focusedHref = (active.getAttribute && active.getAttribute("data-href")) || "";
      }
    } catch (error) {
      focusedHref = "";
    }
    this.notebookHeaderRemoveOwned(root, sourcePath);
    const model = this.notebookHeaderModelFor(sourcePath, state);
    if (!model) {
      return null;
    }
    const header = this.notebookHeaderBuildEl(model, options, doc);
    if (!header) {
      return null;
    }
    try {
      if (typeof header.setAttribute === "function") {
        header.setAttribute("data-notebook-source", sourcePath);
      }
    } catch (error) {
      // Source identity is best-effort.
    }
    try {
      const anchor = this.notebookHeaderReadingAnchor(root);
      if (anchor && anchor.parentNode && typeof anchor.parentNode.insertBefore === "function") {
        anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
      } else if (root && typeof root.insertBefore === "function") {
        const first = root.firstChild || null;
        root.insertBefore(header, first);
      } else if (root && typeof root.prepend === "function") {
        root.prepend(header);
      } else if (root && typeof root.appendChild === "function") {
        root.appendChild(header);
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
    if (focusedHref) {
      try {
        const next = header.querySelector(`[data-href="${focusedHref}"]`);
        if (next && typeof next.focus === "function") {
          next.focus();
          this.notebookHeaderLastFocusHref = focusedHref;
        }
      } catch (error) {
        // Focus restore is best-effort.
      }
    }
    try {
      if (header && typeof header.addEventListener === "function") {
        header.addEventListener("focusin", (event) => {
          try {
            const target = event && event.target;
            const href = target && typeof target.getAttribute === "function"
              ? target.getAttribute("data-href")
              : "";
            if (href) {
              this.notebookHeaderLastFocusHref = href;
            }
          } catch (error) {
            // Last-focus tracking is best-effort.
          }
        });
      }
    } catch (error) {
      // Last-focus tracking is best-effort.
    }
    return header;
  }

  notebookHeaderReadingAnchor(root) {
    try {
      if (!root || typeof root.querySelectorAll !== "function") {
        return null;
      }
      const heads = Array.from(root.querySelectorAll("h1") || []);
      for (const head of heads) {
        try {
          if (typeof notebookInsideCode === "function" && notebookInsideCode(head)) {
            continue;
          }
        } catch (error) {
          // Fall through.
        }
        return head;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  notebookHeaderBuildEl(model, options, doc) {
    try {
      const create = typeof notebookCreateEl === "function" ? notebookCreateEl : null;
      const setText = typeof notebookSetText === "function" ? notebookSetText : null;
      const holder = create ? create(doc, "div", NOTEBOOK_HEADER_CLASS) : null;
      const header = holder || (doc && typeof doc.createElement === "function" ? doc.createElement("div") : null);
      if (!header) {
        return null;
      }
      try {
        if (typeof header.setAttribute === "function") {
          header.setAttribute("class", NOTEBOOK_HEADER_CLASS);
          header.setAttribute("data-notebook-header", "true");
          if (options && options.hue) {
            header.setAttribute("data-root-hue", options.hue);
          }
        }
        if (header.classList && typeof header.classList.add === "function") {
          header.classList.add(NOTEBOOK_HEADER_CLASS);
        }
      } catch (error) {
        // Chrome is best-effort.
      }
      const nav = create ? create(doc, "nav", NOTEBOOK_HEADER_NAV_CLASS) : null;
      const navEl = nav || (doc ? doc.createElement("nav") : null);
      if (navEl && typeof header.appendChild === "function") {
        header.appendChild(navEl);
        this.notebookHeaderFillAncestry(navEl, model, options, doc, create, setText);
      }
      if (options && options.chipsEnabled !== false) {
        const kids = Array.isArray(model.children) ? model.children : [];
        if (kids.length > 0 && typeof header.appendChild === "function") {
          const row = create ? create(doc, "div", NOTEBOOK_HEADER_CHILDREN_CLASS) : doc.createElement("div");
          if (row) {
            try {
              if (typeof row.setAttribute === "function") {
                row.setAttribute("class", NOTEBOOK_HEADER_CHILDREN_CLASS);
              }
            } catch (error) {
              // Class is best-effort.
            }
            this.notebookHeaderFillChildren(row, model, options, doc, create, setText);
            if (row.childNodes && row.childNodes.length > 0) {
              header.appendChild(row);
            } else if (row.children && row.children.length > 0) {
              header.appendChild(row);
            }
          }
        }
      }
      return header;
    } catch (error) {
      return null;
    }
  }

  notebookHeaderFillAncestry(navEl, model, options, doc, create, setText) {
    const crumbs = Array.isArray(model.crumbs) ? model.crumbs : [];
    const handlers = (options && options.handlers) || {};
    const metadataCache = options && options.metadataCache;
    const vault = options && options.vault;
    const sourcePath = (options && options.sourcePath) || "";
    const icon = create ? create(doc, "span", "bob-notebook-header-icon") : null;
    if (icon) {
      if (setText) {
        setText(icon, "📓 ");
      }
      if (typeof navEl.appendChild === "function") {
        navEl.appendChild(icon);
      }
    }
    crumbs.forEach((crumb, index) => {
      if (index > 0 && setText && doc) {
        const sep = doc.createTextNode ? doc.createTextNode(NOTEBOOK_HEADER_SEP) : null;
        if (sep && typeof navEl.appendChild === "function") {
          navEl.appendChild(sep);
        }
      }
      if (!crumb || crumb.ellipsis) {
        const dots = create ? create(doc, "span", NOTEBOOK_HEADER_CRUMB_CLASS) : null;
        const target = dots || (doc ? doc.createElement("span") : null);
        if (target && setText) {
          setText(target, "…");
          if (typeof navEl.appendChild === "function") {
            navEl.appendChild(target);
          }
        }
        return;
      }
      const resolved = this.notebookHeaderLinkTarget(crumb, sourcePath, metadataCache, vault);
      const isSelf = crumb.kind === "self" || index === crumbs.length - 1;
      if (!resolved || crumb.missing) {
        const inert = create
          ? create(doc, "span", `${NOTEBOOK_HEADER_CRUMB_CLASS}${isSelf ? " bob-notebook-header-self" : ""}`)
          : null;
        const target = inert || (doc ? doc.createElement("span") : null);
        if (target) {
          if (setText) {
            setText(target, crumb.title || crumb.stem || "");
          }
          if (isSelf && typeof target.setAttribute === "function") {
            try {
              target.setAttribute("aria-current", "page");
            } catch (error) {
              // Aria is best-effort.
            }
          }
          if (typeof navEl.appendChild === "function") {
            navEl.appendChild(target);
          }
        }
        return;
      }
      const link = doc && typeof doc.createElement === "function" ? doc.createElement("a") : null;
      if (!link) {
        return;
      }
      try {
        if (typeof link.setAttribute === "function") {
          link.setAttribute(
            "class",
            `internal-link ${NOTEBOOK_HEADER_CRUMB_CLASS}${isSelf ? " bob-notebook-header-self" : ""}`,
          );
          link.setAttribute("data-href", resolved);
          link.setAttribute("href", resolved);
          if (isSelf) {
            link.setAttribute("aria-current", "page");
          }
        }
        if (link.classList && typeof link.classList.add === "function") {
          link.classList.add("internal-link");
        }
      } catch (error) {
        // Link chrome is best-effort.
      }
      if (setText) {
        setText(link, crumb.title || crumb.stem || "");
      }
      if (typeof notebookBindAction === "function" && typeof handlers.openPath === "function") {
        notebookBindAction(link, () => handlers.openPath(resolved || crumb.path || crumb.stem));
      } else if (typeof link.addEventListener === "function" && typeof handlers.openPath === "function") {
        link.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
          } catch (error) {
            // Best-effort.
          }
          handlers.openPath(resolved || crumb.path || crumb.stem);
        });
      }
      if (typeof navEl.appendChild === "function") {
        navEl.appendChild(link);
      }
    });
  }

  notebookHeaderLinkTarget(crumb, sourcePath, metadataCache, vault) {
    try {
      if (!crumb) {
        return "";
      }
      if (crumb.kind === "notebook" || crumb.kind === "self") {
        return notebookHeaderReportPath(crumb.path || crumb.stem || "");
      }
      if (typeof notebookResolveLinkFile === "function") {
        const file = notebookResolveLinkFile(crumb.stem || crumb.title || "", sourcePath, metadataCache, vault);
        if (file && file.path) {
          return notebookHeaderReportPath(file.path);
        }
      }
      const fallback = String(crumb.path || crumb.stem || "").trim();
      return fallback ? notebookHeaderReportPath(fallback) : "";
    } catch (error) {
      return "";
    }
  }

  notebookHeaderFillChildren(row, model, options, doc, create, setText) {
    const kids = Array.isArray(model.children) ? model.children : [];
    const handlers = (options && options.handlers) || {};
    const metadataCache = options && options.metadataCache;
    const vault = options && options.vault;
    const sourcePath = (options && options.sourcePath) || "";
    for (const child of kids) {
      const link = doc && typeof doc.createElement === "function" ? doc.createElement("a") : null;
      if (!link) {
        continue;
      }
      try {
        if (typeof link.setAttribute === "function") {
          link.setAttribute("class", `internal-link ${NOTEBOOK_HEADER_CHILD_CLASS}`);
        }
        if (link.classList && typeof link.classList.add === "function") {
          link.classList.add("internal-link");
        }
      } catch (error) {
        // Class is best-effort.
      }
      let target = "";
      try {
        if (typeof notebookResolveLinkFile === "function") {
          const file = notebookResolveLinkFile(child.path || child.stem || "", sourcePath, metadataCache, vault);
          target = file && file.path ? notebookHeaderReportPath(file.path) : notebookHeaderReportPath(child.path);
        } else {
          target = notebookHeaderReportPath(child.path || child.stem);
        }
        if (typeof link.setAttribute === "function" && target) {
          link.setAttribute("data-href", target);
          link.setAttribute("href", target);
        }
      } catch (error) {
        // Target is best-effort.
      }
      if (setText) {
        setText(link, child.title || child.stem || target);
      } else {
        try {
          link.textContent = child.title || child.stem || target;
        } catch (error) {
          // Best-effort.
        }
      }
      if (typeof notebookBindAction === "function" && typeof handlers.openPath === "function") {
        const resolved = target || child.path || child.stem;
        notebookBindAction(link, () => handlers.openPath(resolved));
      } else if (typeof link.addEventListener === "function" && typeof handlers.openPath === "function") {
        const resolved = target || child.path || child.stem;
        link.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
          } catch (error) {
            // Best-effort.
          }
          handlers.openPath(resolved);
        });
      }
      if (typeof row.appendChild === "function") {
        row.appendChild(link);
      }
    }
  }

  renderNotebookHeaderInReading(el, ctx) {
    try {
      if (!el || this.notebookHeaderActive === false) {
        return;
      }
      if (typeof notebookInsideCode === "function" && notebookInsideCode(el)) {
        return;
      }
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath) {
        return;
      }
      if (!(this.notebookHeaderReadingWidgets instanceof Set)) {
        this.notebookHeaderReadingWidgets = new Set();
      }
      if (!this.notebookHeaderReadingTimers || typeof this.notebookHeaderReadingTimers.set !== "function") {
        this.notebookHeaderReadingTimers = new Map();
      }
      if (!this.notebookHeaderReadingPending || typeof this.notebookHeaderReadingPending.set !== "function") {
        this.notebookHeaderReadingPending = new Map();
      }
      const key = sourcePath;
      const pending = this.notebookHeaderReadingPending.get(key) || [];
      pending.push({ el, ctx });
      this.notebookHeaderReadingPending.set(key, pending);
      try {
        this.notebookClearTimeout(this.notebookHeaderReadingTimers.get(key));
      } catch (error) {
        // Coalesce is best-effort.
      }
      const paint = () => {
        try {
          this.notebookHeaderReadingTimers.delete(key);
        } catch (error) {
          // Map cleanup is best-effort.
        }
        const batch = this.notebookHeaderReadingPending.get(key) || [];
        try {
          this.notebookHeaderReadingPending.delete(key);
        } catch (error) {
          // Map cleanup is best-effort.
        }
        if (this.notebookHeaderActive === false) {
          return;
        }
        const chosen = this.notebookHeaderChooseReadingSurface(batch);
        const surface = chosen.surface;
        const chosenEl = chosen.el;
        const chosenCtx = chosen.ctx;
        this.paintNotebookHeaderReading(surface || chosenEl, sourcePath);
        for (const existing of this.notebookHeaderReadingWidgets) {
          if (
            existing.path === sourcePath
            && this.notebookHeaderSameSurface(existing.surface || existing.el, surface || chosenEl)
          ) {
            existing.el = chosenEl;
            existing.ctx = chosenCtx;
            existing.surface = surface || chosenEl;
            return;
          }
        }
        const widget = {
          el: chosenEl,
          ctx: chosenCtx,
          path: sourcePath,
          surface: surface || chosenEl,
        };
        this.notebookHeaderReadingWidgets.add(widget);
        this.notebookHeaderBindReadingChild(widget, chosenCtx, surface || chosenEl, sourcePath);
      };
      this.notebookHeaderReadingTimers.set(key, this.notebookSetTimeout(paint, 0));
    } catch (error) {
      // Reading paint never throws.
    }
  }

  notebookHeaderSameSurface(left, right) {
    if (!left || !right) {
      return false;
    }
    if (left === right) {
      return true;
    }
    try {
      if (typeof left.contains === "function" && left.contains(right)) {
        return true;
      }
      if (typeof right.contains === "function" && right.contains(left)) {
        return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  notebookHeaderChooseReadingSurface(batch) {
    const items = Array.isArray(batch) ? batch : [];
    const last = items.length ? items[items.length - 1] : { el: null, ctx: null };
    const pick = (el) => {
      if (!el) {
        return null;
      }
      try {
        const attached = typeof el.closest === "function"
          ? el.closest(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed, .internal-embed")
          : null;
        if (attached) {
          return this.notebookHeaderReadingRoot(attached) || attached;
        }
      } catch (error) {
        // Attached-surface lookup is best-effort.
      }
      return null;
    };
    for (const item of items) {
      const surface = pick(item && item.el);
      if (surface) {
        return { el: item.el, ctx: item.ctx, surface };
      }
    }
    return {
      el: last.el,
      ctx: last.ctx,
      surface: this.notebookHeaderReadingRoot(last.el) || last.el,
    };
  }

  notebookHeaderBindReadingChild(widget, ctx, surface, sourcePath) {
    if (!ctx || typeof ctx.addChild !== "function") {
      return;
    }
    const hostEl = widget && widget.el;
    let child = null;
    try {
      if (typeof MarkdownRenderChild === "function" && hostEl) {
        child = new MarkdownRenderChild(hostEl);
        child.onunload = () => {
          if (this.notebookHeaderReadingWidgets) {
            this.notebookHeaderReadingWidgets.delete(widget);
          }
          this.notebookHeaderRemoveOwned(surface, sourcePath);
        };
      }
    } catch (error) {
      child = null;
    }
    if (!child) {
      child = {
        unload: () => {
          if (this.notebookHeaderReadingWidgets) {
            this.notebookHeaderReadingWidgets.delete(widget);
          }
          this.notebookHeaderRemoveOwned(surface, sourcePath);
        },
      };
    }
    try {
      ctx.addChild(child);
    } catch (error) {
      // Older hosts may reject the child.
    }
  }

  refreshNotebookHeaderReading() {
    if (!(this.notebookHeaderReadingWidgets instanceof Set) || this.notebookHeaderReadingWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    for (const widget of Array.from(this.notebookHeaderReadingWidgets)) {
      try {
        this.paintNotebookHeaderReading(widget.surface || widget.el, widget.path);
        refreshed = true;
      } catch (error) {
        // One stale view never breaks the others.
      }
    }
    return refreshed;
  }
}
