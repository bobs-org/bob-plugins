// Record-note subscription header in Reading view and Live Preview.
// One shared `bob bank subscriptions -a` fetch feeds the strip, the
// album card, and records-index pretty labels. Nothing writes notes.

let subscriptionHeaderRefreshEffect = null;
function ensureSubscriptionHeaderRefresh() {
  if (!subscriptionHeaderRefreshEffect && StateEffect?.define) {
    subscriptionHeaderRefreshEffect = StateEffect.define();
  }
  return subscriptionHeaderRefreshEffect;
}

class BobLedgerToolsSubscriptionSurfacesMixin {
  setupSubscriptionSurfaces() {
    this.subscriptionSurfacesActive = true;
    this.subscriptionSurfacesReading = new Set();
    this.subscriptionSurfacesEditors = new Set();
    this.subscriptionSurfacesReport = null;
    this.subscriptionSurfacesRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderSubscriptionHeaderInReading(el, ctx), 51);
    const extension = this.createSubscriptionHeaderExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.ensureSubscriptionSurfacesSubscribe();
  }

  teardownSubscriptionSurfaces() {
    this.subscriptionSurfacesActive = false;
    this.subscriptionSurfacesUnsubscribe?.();
    this.subscriptionSurfacesUnsubscribe = null;
    this.albumClearTimeout?.(this.subscriptionSurfacesRefreshTimer);
    this.subscriptionSurfacesRefreshTimer = null;
    for (const widget of this.subscriptionSurfacesReading || []) {
      albumCleanSubscriptionHeader(widget.surface || widget.el);
    }
    for (const view of this.subscriptionSurfacesEditors || []) {
      albumCleanSubscriptionHeader(view.dom);
    }
    this.subscriptionSurfacesReading?.clear();
    this.subscriptionSurfacesEditors?.clear();
    this.subscriptionSurfacesReport = null;
  }

  ensureSubscriptionSurfacesSubscribe() {
    if (!this.subscriptionSurfacesActive) return;
    if (typeof this.subscriptionSurfacesUnsubscribe === "function") return;
    if (typeof this.apiBankSubscribe !== "function") return;
    this.subscriptionSurfacesUnsubscribe = this.apiBankSubscribe(
      { command: "subscriptions", all: true },
      (state) => {
        if (!this.subscriptionSurfacesActive) return;
        const key = typeof bankCacheKey === "function"
          ? bankCacheKey(bankBuildArgs({ command: "subscriptions", all: true }))
          : null;
        const result = state && state.results && key ? state.results[key] : null;
        this.subscriptionSurfacesReport = result && result.report ? result.report : null;
        this.scheduleSubscriptionSurfacesRefresh();
      },
    );
  }

  subscriptionSurfacesHue(path) {
    try {
      return typeof notebookHostHueName === "function"
        ? notebookHostHueName(path, this.app?.metadataCache, this.app?.vault)
        : "";
    } catch (_) {
      return "";
    }
  }

  paintSubscriptionHeaderReading(el, sourcePath) {
    const root = this.albumHeaderReadingRoot?.(el) || el;
    if (!root || !sourcePath) return null;
    albumCleanSubscriptionHeader(root);
    if (!bankSubscriptionIsRecordPath(sourcePath)) return null;
    this.ensureSubscriptionSurfacesSubscribe();
    const model = bankSubscriptionHeaderModel(this.subscriptionSurfacesReport, sourcePath);
    if (!model || model.kind !== "header") return null;
    const header = bankSubscriptionPaintHeader(root, model, {
      hue: this.subscriptionSurfacesHue(sourcePath),
      sourcePath,
    });
    if (!header) return null;
    const anchor = this.albumHeaderReadingAnchor?.(root) || this.notebookHeaderReadingAnchor?.(root);
    if (anchor?.parentNode?.insertBefore) {
      header.remove?.();
      anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
    } else if (root.insertBefore && header.parentNode === root && root.firstChild !== header) {
      root.insertBefore(header, root.firstChild || null);
    }
    return header;
  }

  renderSubscriptionHeaderInReading(el, ctx) {
    if (!this.subscriptionSurfacesActive || !el || !ctx?.sourcePath || notebookInsideCode(el)) return;
    if (el.closest?.(".cm-editor")) return;
    if (!bankSubscriptionIsRecordPath(ctx.sourcePath)) return;
    const root = this.albumHeaderReadingRoot?.(el) || el;
    let widget = Array.from(this.subscriptionSurfacesReading || []).find((item) => (
      item.el === el || (root && item.surface === root)
    ));
    if (!widget) {
      widget = { el, path: ctx.sourcePath, surface: root };
      this.subscriptionSurfacesReading.add(widget);
    } else {
      if (widget.path !== ctx.sourcePath) albumCleanSubscriptionHeader(widget.surface || widget.el);
      widget.el = el;
      widget.path = ctx.sourcePath;
      widget.surface = root;
    }
    this.paintSubscriptionHeaderReading(el, ctx.sourcePath);
    if (ctx.addChild && typeof MarkdownRenderChild === "function") {
      const child = new MarkdownRenderChild(el);
      child.onunload = () => {
        albumCleanSubscriptionHeader(widget.surface || el);
        this.subscriptionSurfacesReading?.delete(widget);
      };
      try { ctx.addChild(child); } catch (_) {}
    }
  }

  subscriptionHeaderLivePath(view) {
    try {
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) {
      return null;
    }
  }

  buildSubscriptionHeaderDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const path = this.subscriptionHeaderLivePath(view);
      if (!path || !bankSubscriptionIsRecordPath(path) || !view?.state?.doc) {
        return Decoration.none;
      }
      this.ensureSubscriptionSurfacesSubscribe();
      const model = bankSubscriptionHeaderModel(this.subscriptionSurfacesReport, path);
      if (!model || model.kind !== "header") return Decoration.none;
      const doc = notebookDomDoc(view.dom) || (typeof document !== "undefined" ? document : null);
      const holder = typeof notebookCreateEl === "function"
        ? notebookCreateEl(doc, "div")
        : (doc && typeof doc.createElement === "function" ? doc.createElement("div") : null);
      const header = bankSubscriptionPaintHeader(holder || view.dom, model, {
        hue: this.subscriptionSurfacesHue(path),
        sourcePath: path,
      });
      if (!header) return Decoration.none;
      if (header.parentNode && header.parentNode !== holder) header.parentNode.removeChild(header);
      const text = view.state.doc.toString();
      const signature = bankSubscriptionHeaderSignature(model);
      const widget = new class extends WidgetType {
        constructor() {
          super();
          this.path = path;
          this.signature = signature;
        }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          header.setAttribute?.("data-cm-widget", "true");
          return header;
        }
      }();
      const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
      const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
      let at = 0;
      let side = 1;
      if (anchor >= 0) {
        at = view.state.doc.line(anchor + 1).to;
      } else if (frontmatterEnd >= 0) {
        const nextLine = frontmatterEnd + 2;
        at = nextLine <= (view.state.doc.lines || 0)
          ? view.state.doc.line(nextLine).from
          : (view.state.doc.length || 0);
      }
      const builder = new RangeSetBuilder();
      builder.add(at, at, Decoration.widget({ widget, side }));
      this.subscriptionSurfacesEditors.add(view);
      return builder.finish();
    } catch (_) {
      return Decoration?.none || null;
    }
  }

  createSubscriptionHeaderExtension() {
    try {
      if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
      const plugin = this;
      const refresh = ensureSubscriptionHeaderRefresh();
      return ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.decorations = plugin.buildSubscriptionHeaderDecorations(view);
        }
        update(update) {
          const notified = (update.transactions || []).some((tx) => (
            (tx.effects || []).some((effect) => effect.is?.(refresh))
          ));
          if (notified || update.docChanged || update.viewportChanged) {
            this.decorations = plugin.buildSubscriptionHeaderDecorations(update.view);
          }
        }
        destroy() {
          plugin.subscriptionSurfacesEditors.delete(this.view);
        }
      }, { decorations: (value) => value.decorations });
    } catch (_) {
      return null;
    }
  }

  scheduleSubscriptionSurfacesRefresh() {
    if (!this.subscriptionSurfacesActive || this.subscriptionSurfacesRefreshTimer != null) return;
    this.subscriptionSurfacesRefreshTimer = this.albumSetTimeout(() => {
      this.subscriptionSurfacesRefreshTimer = null;
      if (!this.subscriptionSurfacesActive) return;
      for (const widget of this.subscriptionSurfacesReading || []) {
        this.paintSubscriptionHeaderReading(widget.el, widget.path);
      }
      const effect = ensureSubscriptionHeaderRefresh();
      for (const view of this.subscriptionSurfacesEditors || []) {
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
      }
      if (typeof this.scheduleAlbumRecordsRefresh === "function") {
        this.scheduleAlbumRecordsRefresh();
      }
    }, 100);
  }
}
