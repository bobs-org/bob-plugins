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
    try {
      if (typeof this.loadData !== "function") {
        this.notebookChipsEnabledFlag = true;
        return true;
      }
      const stored = await this.loadData();
      if (stored && typeof stored === "object") {
        this.notebookPluginData = { ...stored };
      } else {
        this.notebookPluginData = {};
      }
      this.notebookChipsEnabledFlag = notebookHeaderReadChipsFlag(stored);
      return this.notebookChipsEnabledFlag;
    } catch (error) {
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
      try {
        void this.loadNotebookChipsSetting().then(() => {
          try {
            this.refreshNotebookHeaderAll();
          } catch (error) {
            // Initial refresh is best-effort.
          }
        });
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
    if (this.notebookHeaderReadingWidgets instanceof Set) {
      this.notebookHeaderReadingWidgets.clear();
    }
  }

  notebookHeaderReadingRoot(el) {
    try {
      if (el && typeof el.closest === "function") {
        const root = el.closest(".markdown-preview-view");
        if (root) {
          return root;
        }
      }
    } catch (error) {
      // Fall through to el.
    }
    return el;
  }

  notebookHeaderModelFor(sourcePath, state) {
    try {
      const report = state && state.report
        ? state.report
        : (typeof this.notebookCatalogState === "function" ? this.notebookCatalogState().report : null);
      if (!report) {
        return null;
      }
      return notebookHeaderModel(report, sourcePath);
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
    try {
      if (typeof notebookRemovePainted === "function") {
        notebookRemovePainted(root, NOTEBOOK_HEADER_CLASS);
      } else if (root && typeof root.querySelectorAll === "function") {
        const stale = Array.from(root.querySelectorAll(`.${NOTEBOOK_HEADER_CLASS}`) || []);
        for (const node of stale) {
          if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
            node.parentNode.removeChild(node);
          }
        }
      }
    } catch (error) {
      // Cleanup is best-effort.
    }
    const model = this.notebookHeaderModelFor(sourcePath, state);
    if (!model) {
      return null;
    }
    const header = this.notebookHeaderBuildEl(model, options, doc);
    if (!header) {
      return null;
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
        }
      } catch (error) {
        // Focus restore is best-effort.
      }
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
      const isSelf = crumb.kind === "self" || index === crumbs.length - 1;
      if (isSelf) {
        const self = create ? create(doc, "span", `${NOTEBOOK_HEADER_CRUMB_CLASS} bob-notebook-header-self`) : null;
        const target = self || (doc ? doc.createElement("span") : null);
        if (target) {
          if (setText) {
            setText(target, crumb.title || crumb.stem || "");
          }
          try {
            if (typeof target.setAttribute === "function") {
              target.setAttribute("aria-current", "page");
            }
          } catch (error) {
            // Aria is best-effort.
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
          link.setAttribute("class", `internal-link ${NOTEBOOK_HEADER_CRUMB_CLASS}`);
          const resolved = this.notebookHeaderLinkTarget(crumb, sourcePath, metadataCache, vault);
          if (resolved) {
            link.setAttribute("data-href", resolved);
            link.setAttribute("href", resolved);
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
        const target = this.notebookHeaderLinkTarget(crumb, sourcePath, metadataCache, vault);
        notebookBindAction(link, () => handlers.openPath(target || crumb.path || crumb.stem));
      } else if (typeof link.addEventListener === "function" && typeof handlers.openPath === "function") {
        const target = this.notebookHeaderLinkTarget(crumb, sourcePath, metadataCache, vault);
        link.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
          } catch (error) {
            // Best-effort.
          }
          handlers.openPath(target || crumb.path || crumb.stem);
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
      this.paintNotebookHeaderReading(el, sourcePath);
      if (!(this.notebookHeaderReadingWidgets instanceof Set)) {
        this.notebookHeaderReadingWidgets = new Set();
      }
      for (const existing of this.notebookHeaderReadingWidgets) {
        if (existing.el === el) {
          existing.ctx = ctx;
          existing.path = sourcePath;
          return;
        }
      }
      const widget = { el, ctx, path: sourcePath };
      this.notebookHeaderReadingWidgets.add(widget);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              if (this.notebookHeaderReadingWidgets) {
                this.notebookHeaderReadingWidgets.delete(widget);
              }
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
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject the child.
        }
      }
    } catch (error) {
      // Reading header paint never throws.
    }
  }

  refreshNotebookHeaderReading() {
    if (!(this.notebookHeaderReadingWidgets instanceof Set) || this.notebookHeaderReadingWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    for (const widget of Array.from(this.notebookHeaderReadingWidgets)) {
      try {
        this.paintNotebookHeaderReading(widget.el, widget.path);
        refreshed = true;
      } catch (error) {
        // One stale view never breaks the others.
      }
    }
    return refreshed;
  }
}
