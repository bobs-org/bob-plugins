// Notebook catalog cards in Reading view and Live Preview. Decorations
// never write note text; only the shared sync subprocess writes catalogs.

let notebookCatalogRefreshEffect = null;
function ensureNotebookCatalogRefresh() {
  if (notebookCatalogRefreshEffect) {
    return notebookCatalogRefreshEffect;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      notebookCatalogRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    notebookCatalogRefreshEffect = null;
  }
  return notebookCatalogRefreshEffect;
}

class BobLedgerToolsNotebookCatalogMixin {
  setupNotebookCatalog() {
    try {
      this.notebookCatalogActive = true;
      this.notebookCatalogEpoch = (this.notebookCatalogEpoch || 0) + 1;
      if (!(this.notebookCatalogReadingWidgets instanceof Set)) {
        this.notebookCatalogReadingWidgets = new Set();
      }
      try {
        const extension = this.createNotebookCatalogExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderNotebookCatalogInReading(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Reading view is best-effort.
      }
      try {
        this.notebookCatalogUnsubscribe = this.apiNotebookSubscribe((state) => {
          this.notebookCatalogLastState = state;
          this.scheduleNotebookCatalogRefresh();
        });
      } catch (error) {
        this.notebookCatalogUnsubscribe = null;
      }
    } catch (error) {
      // Catalog setup never throws.
    }
  }

  teardownNotebookCatalog() {
    this.notebookCatalogActive = false;
    this.notebookCatalogEpoch = (this.notebookCatalogEpoch || 0) + 1;
    try {
      if (typeof this.notebookCatalogUnsubscribe === "function") {
        this.notebookCatalogUnsubscribe();
      }
    } catch (error) {
      // Unsubscribe is best-effort.
    }
    this.notebookCatalogUnsubscribe = null;
    if (this.notebookCatalogRefreshTimer !== null && this.notebookCatalogRefreshTimer !== undefined) {
      this.notebookClearTimeout(this.notebookCatalogRefreshTimer);
    }
    this.notebookCatalogRefreshTimer = null;
    if (this.notebookCatalogReadingWidgets instanceof Set) {
      this.notebookCatalogReadingWidgets.clear();
    }
  }

  notebookCatalogState() {
    try {
      return typeof this.notebookReportState === "function"
        ? this.notebookReportState()
        : this.notebookCatalogLastState || { report: null, today: notebookLocalDate(), syncBusy: false };
    } catch (error) {
      return { report: null, today: "", syncBusy: false };
    }
  }

  notebookCatalogHandlers(sourcePath) {
    const plugin = this;
    return {
      openSummary: (model) => {
        void plugin.apiNotebookOpenSummary(model && model.path, sourcePath);
      },
      sync: () => {
        void plugin.apiNotebookCatalogSync();
      },
    };
  }

  notebookCatalogHue(sourcePath) {
    try {
      return notebookHostHueName(
        sourcePath,
        this.app && this.app.metadataCache,
        this.app && this.app.vault,
      );
    } catch (error) {
      return null;
    }
  }

  notebookCatalogPaintOptions(sourcePath, state) {
    const current = state || this.notebookCatalogState();
    let chipsEnabled = true;
    try {
      if (typeof this.notebookChipsVisible === "function") {
        chipsEnabled = this.notebookChipsVisible() !== false;
      }
    } catch (error) {
      chipsEnabled = true;
    }
    return {
      report: current.report || null,
      sourcePath,
      today: current.today || notebookLocalDate(),
      hue: this.notebookCatalogHue(sourcePath),
      metadataCache: this.app && this.app.metadataCache,
      vault: this.app && this.app.vault,
      handlers: this.notebookCatalogHandlers(sourcePath),
      chipsEnabled,
    };
  }

  notebookCatalogSyncModel(sourcePath, state, headingPresent) {
    const current = state || this.notebookCatalogState();
    const catalog = notebookHostCatalog(current, sourcePath);
    const errorHint = current.syncErrorModel && current.syncErrorModel.hint
      ? current.syncErrorModel.hint
      : current.errorModel && current.errorModel.hint
        ? current.errorModel.hint
        : "";
    return notebookSyncActionModel(catalog, {
      busy: Boolean(current.syncBusy),
      errorHint,
      missingWithoutHeading: Boolean(catalog && catalog.state === "missing" && !headingPresent),
    });
  }

  paintNotebookCatalogReading(el, sourcePath) {
    const state = this.notebookCatalogState();
    const options = this.notebookCatalogPaintOptions(sourcePath, state);
    const callouts = notebookFindCallouts(el).filter((node) => !notebookInsideCode(node));
    for (const callout of callouts) {
      notebookPaintCallout(callout, options);
    }
    const heading = notebookFindNotebooksHeading(el);
    const title = heading ? null : notebookFindHostTitle(el);
    const syncHost = heading || title;
    const syncModel = this.notebookCatalogSyncModel(sourcePath, state, Boolean(heading));
    if (options.chipsEnabled === false) {
      if (syncHost) {
        notebookRemovePainted(syncHost, NOTEBOOK_SYNC_CLASS);
      }
    } else if (syncHost && syncModel && (heading || syncModel.state === "missing" || syncModel.busy)) {
      notebookPaintSyncAction(syncHost, syncModel, options.handlers, notebookDomDoc(syncHost));
    } else if (syncHost) {
      notebookRemovePainted(syncHost, NOTEBOOK_SYNC_CLASS);
    }
    return { callouts, heading, title };
  }

  renderNotebookCatalogInReading(el, ctx) {
    try {
      if (!el || this.notebookCatalogActive === false) {
        return;
      }
      if (notebookInsideCode(el)) {
        return;
      }
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath) {
        return;
      }
      this.paintNotebookCatalogReading(el, sourcePath);
      if (!(this.notebookCatalogReadingWidgets instanceof Set)) {
        this.notebookCatalogReadingWidgets = new Set();
      }
      for (const existing of this.notebookCatalogReadingWidgets) {
        if (existing.el === el) {
          existing.ctx = ctx;
          existing.path = sourcePath;
          return;
        }
      }
      const widget = { el, ctx, path: sourcePath };
      this.notebookCatalogReadingWidgets.add(widget);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              if (this.notebookCatalogReadingWidgets) {
                this.notebookCatalogReadingWidgets.delete(widget);
              }
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              if (this.notebookCatalogReadingWidgets) {
                this.notebookCatalogReadingWidgets.delete(widget);
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
      // Reading catalog paint never throws.
    }
  }

  refreshNotebookCatalogReading() {
    if (!(this.notebookCatalogReadingWidgets instanceof Set) || this.notebookCatalogReadingWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    for (const widget of Array.from(this.notebookCatalogReadingWidgets)) {
      try {
        this.paintNotebookCatalogReading(widget.el, widget.path);
        refreshed = true;
      } catch (error) {
        // One stale view never breaks the others.
      }
    }
    return refreshed;
  }

  notebookCatalogShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged) {
        return true;
      }
      const transactions = u.transactions || [];
      const effectType = ensureNotebookCatalogRefresh();
      for (const transaction of transactions) {
        const effects = transaction && transaction.effects !== undefined ? transaction.effects : null;
        if (!effects) {
          continue;
        }
        const list = Array.isArray(effects) ? effects : [effects];
        for (const effect of list) {
          if (!effect) {
            continue;
          }
          if (effectType && typeof effect.is === "function" && effect.is(effectType)) {
            return true;
          }
          if (effect === effectType) {
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  notebookCatalogLivePath(view) {
    try {
      if (!editorInfoField || !editorLivePreviewField) {
        return null;
      }
      let live = null;
      try {
        live = view.state.field(editorLivePreviewField);
      } catch (error) {
        return null;
      }
      if (!live) {
        return null;
      }
      let info = null;
      try {
        info = view.state.field(editorInfoField);
      } catch (error) {
        return null;
      }
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      return path || null;
    } catch (error) {
      return null;
    }
  }

  buildNotebookCatalogDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) {
        return Decoration ? Decoration.none : null;
      }
      const filePath = this.notebookCatalogLivePath(view);
      if (!filePath) {
        return Decoration.none;
      }
      let docText = "";
      try {
        docText = view.state.doc && typeof view.state.doc.toString === "function"
          ? view.state.doc.toString()
          : String(view.state.doc || "");
      } catch (error) {
        return Decoration.none;
      }
      const regions = notebookCatalogRegions(docText);
      const headingLine = notebookFindNotebooksHeadingLine(docText);
      const titleLine = headingLine < 0 ? notebookFindHostTitleLine(docText) : -1;
      const state = this.notebookCatalogState();
      const syncModel = this.notebookCatalogSyncModel(filePath, state, headingLine >= 0);
      const hue = this.notebookCatalogHue(filePath);
      const pending = [];
      const plugin = this;
      const SyncWidget = class extends WidgetType {
        constructor(model, path) {
          super();
          this.model = model;
          this.path = path;
          this.key = `${model.state}|${model.busy ? "busy" : "idle"}|${model.label}`;
        }
        eq(other) {
          return Boolean(other && other.key === this.key && other.path === this.path);
        }
        toDOM() {
          const doc = typeof document !== "undefined" ? document : null;
          const holder = notebookCreateEl(doc, "span", "bob-notebook-sync-host");
          const host = holder || {
            appendChild: () => {},
            ownerDocument: doc,
          };
          notebookPaintSyncAction(host, this.model, plugin.notebookCatalogHandlers(this.path), doc);
          if (holder && holder.firstChild) {
            return holder;
          }
          if (holder) {
            notebookSetText(holder, this.model.label);
            holder.className = NOTEBOOK_SYNC_CLASS;
            return holder;
          }
          try {
            return document.createElement("span");
          } catch (error) {
            return null;
          }
        }
      };
      const addWidget = (lineIndex, model) => {
        if (lineIndex < 0 || !model) {
          return;
        }
        try {
          const line = view.state.doc.line(lineIndex + 1);
          pending.push({
            from: line.to,
            to: line.to,
            spec: Decoration.widget({ widget: new SyncWidget(model, filePath), side: 1 }),
          });
        } catch (error) {
          // Skip one widget.
        }
      };
      let chipsEnabled = true;
      try {
        if (typeof this.notebookChipsVisible === "function") {
          chipsEnabled = this.notebookChipsVisible() !== false;
        }
      } catch (error) {
        chipsEnabled = true;
      }
      if (chipsEnabled && syncModel) {
        if (headingLine >= 0) {
          addWidget(headingLine, syncModel);
        } else if (syncModel.state === "missing" || syncModel.busy) {
          addWidget(titleLine, syncModel);
        }
      }
      if (hue && Decoration.line) {
        for (const region of regions) {
          if (region.calloutLine < 0) {
            continue;
          }
          try {
            const line = view.state.doc.line(region.calloutLine + 1);
            pending.push({
              from: line.from,
              to: line.from,
              spec: Decoration.line({
                attributes: { "data-root-hue": hue, class: "bob-notebook-callout-line" },
              }),
            });
          } catch (error) {
            // Line attributes are best-effort.
          }
        }
      }
      pending.sort((left, right) => left.from - right.from || left.to - right.to);
      const builder = new RangeSetBuilder();
      for (const range of pending) {
        try {
          builder.add(range.from, range.to, range.spec);
        } catch (error) {
          // Skip one range.
        }
      }
      try {
        return builder.finish();
      } catch (error) {
        return Decoration.none;
      }
    } catch (error) {
      try {
        return Decoration ? Decoration.none : null;
      } catch (inner) {
        return null;
      }
    }
  }

  notebookCatalogPaintEditorDom(view) {
    try {
      if (this.notebookCatalogActive === false) {
        return false;
      }
      const filePath = this.notebookCatalogLivePath(view);
      if (!filePath || !view || !view.dom) {
        return false;
      }
      const options = this.notebookCatalogPaintOptions(filePath);
      const callouts = notebookFindCallouts(view.dom).filter((node) => !notebookInsideCode(node));
      for (const callout of callouts) {
        notebookPaintCallout(callout, options);
      }
      return callouts.length > 0;
    } catch (error) {
      return false;
    }
  }

  createNotebookCatalogExtension() {
    try {
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function") {
        return null;
      }
      if (!Decoration || !WidgetType || !RangeSetBuilder) {
        return null;
      }
      if (!editorInfoField || !editorLivePreviewField) {
        return null;
      }
      const plugin = this;
      const CatalogPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildNotebookCatalogDecorations(view);
          } catch (error) {
            this.decorations = Decoration ? Decoration.none : null;
          }
          this.lastPath = plugin.notebookCatalogLivePath(view);
          try {
            plugin.notebookCatalogPaintEditorDom(view);
          } catch (error) {
            // DOM paint is best-effort.
          }
        }
        update(u) {
          try {
            const nextPath = plugin.notebookCatalogLivePath(u.view);
            const pathChanged = nextPath !== this.lastPath;
            this.lastPath = nextPath;
            if (pathChanged || plugin.notebookCatalogShouldRebuild(u)) {
              this.decorations = plugin.buildNotebookCatalogDecorations(u.view);
            }
            plugin.notebookCatalogPaintEditorDom(u.view);
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      let extension = null;
      try {
        extension = ViewPlugin.fromClass(CatalogPluginClass, {
          decorations: (value) => value.decorations,
        });
      } catch (error) {
        return null;
      }
      try {
        return Prec && typeof Prec.highest === "function" ? Prec.highest(extension) : extension;
      } catch (error) {
        return extension;
      }
    } catch (error) {
      return null;
    }
  }

  refreshNotebookCatalogEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      const refreshEffect = ensureNotebookCatalogRefresh();
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor ? leaf.view.editor.cm : null;
          if (cm && typeof cm.dispatch === "function" && refreshEffect) {
            cm.dispatch({ effects: refreshEffect.of(null) });
          }
          if (cm) {
            this.notebookCatalogPaintEditorDom(cm);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleNotebookCatalogRefresh() {
    if (this.notebookCatalogActive === false) {
      return;
    }
    if (this.notebookCatalogRefreshTimer !== null && this.notebookCatalogRefreshTimer !== undefined) {
      return;
    }
    this.notebookCatalogRefreshTimer = this.notebookSetTimeout(() => {
      this.notebookCatalogRefreshTimer = null;
      try {
        this.refreshNotebookCatalogReading();
      } catch (error) {
        // Best-effort.
      }
      try {
        this.refreshNotebookCatalogEditors();
      } catch (error) {
        // Best-effort.
      }
    }, 150);
  }

  apiNotebookCatalogSync() {
    if (this.notebookCatalogActive === false) {
      return Promise.resolve({ ok: false, error: { code: "unloaded" } });
    }
    if (this.notebookSyncBusy) {
      return this.notebookSyncFlight || Promise.resolve({ ok: false, error: { code: "busy" } });
    }
    this.scheduleNotebookCatalogRefresh();
    return this.apiNotebookSync({ automatic: false });
  }

  notebookFocusSummaryProperty(view, attemptedCommands) {
    try {
      const roots = [];
      if (view && view.contentEl) {
        roots.push(view.contentEl);
      }
      if (view && view.containerEl) {
        roots.push(view.containerEl);
      }
      if (typeof document !== "undefined" && document && document.body) {
        roots.push(document.body);
      }
      const selectors = [
        '.metadata-property[data-property-key="summary"] input',
        '.metadata-property[data-property-key="summary"] textarea',
        '.metadata-property[data-property-key="summary"] .metadata-input',
        '[data-property-key="summary"] input',
        '[data-property-key="summary"] textarea',
      ];
      for (const root of roots) {
        if (!root || typeof root.querySelector !== "function") {
          continue;
        }
        for (const selector of selectors) {
          const node = root.querySelector(selector);
          if (node && typeof node.focus === "function") {
            node.focus();
            if (typeof node.select === "function") {
              try {
                node.select();
              } catch (error) {
                // Select is optional.
              }
            }
            return true;
          }
        }
      }
      const editor = view && view.metadataEditor;
      if (editor && typeof editor.focus === "function") {
        editor.focus();
        return true;
      }
      const commands = this.app && this.app.commands;
      if (!attemptedCommands && commands && typeof commands.executeCommandById === "function") {
        for (const id of notebookPropertyCommandIds()) {
          try {
            if (commands.executeCommandById(id)) {
              return this.notebookFocusSummaryProperty(view, true);
            }
          } catch (error) {
            continue;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async apiNotebookOpenSummary(path, sourcePath) {
    const target = String(path || "").trim();
    if (!target) {
      return { ok: false, focused: false };
    }
    let opened = false;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(target.replace(/\.md$/i, ""), sourcePath || "", false);
        opened = true;
      }
    } catch (error) {
      opened = false;
    }
    let view = null;
    try {
      const workspace = this.app && this.app.workspace;
      view = workspace && typeof workspace.getActiveViewOfType === "function" && typeof MarkdownView === "function"
        ? workspace.getActiveViewOfType(MarkdownView)
        : workspace && workspace.getActiveViewOfType
          ? workspace.getActiveViewOfType("markdown")
          : null;
      if (!view && workspace && workspace.activeLeaf) {
        view = workspace.activeLeaf.view;
      }
    } catch (error) {
      view = null;
    }
    const focused = opened ? this.notebookFocusSummaryProperty(view) : false;
    if (!opened) {
      try {
        new Notice("Could not open the notebook to edit its summary.");
      } catch (error) {
        // Notice is best-effort.
      }
      return { ok: false, focused: false };
    }
    if (!focused) {
      try {
        new Notice("Opened the notebook. Edit its summary in Properties (the summary field).");
      } catch (error) {
        // Notice is best-effort.
      }
    }
    return { ok: true, focused };
  }
}
