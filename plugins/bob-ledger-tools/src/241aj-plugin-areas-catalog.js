// Reading and Live Preview renderers for the display-only Areas card.
let areasCatalogRefreshEffect = null;
function ensureAreasCatalogRefresh() {
  if (areasCatalogRefreshEffect) return areasCatalogRefreshEffect;
  try { if (StateEffect?.define) areasCatalogRefreshEffect = StateEffect.define(); }
  catch (_error) { areasCatalogRefreshEffect = null; }
  return areasCatalogRefreshEffect;
}

class BobLedgerToolsAreasCatalogMixin {
  setupAreasCatalog() {
    this.areasCatalogActive = true;
    this.areasCatalogReading = new Set();
    this.areasCatalogEditors = new Set();
    this.areasCatalogRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderAreasCatalogInReading(el, ctx), 52);
    const extension = this.createAreasCatalogExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.areasCatalogUnsubscribe = this.apiAreasSubscribe((state) => {
      this.areasCatalogLastState = state;
      this.scheduleAreasCatalogRefresh();
    });
  }

  teardownAreasCatalog() {
    this.areasCatalogActive = false;
    this.areasCatalogUnsubscribe?.();
    this.areasCatalogUnsubscribe = null;
    this.areasClearTimeout(this.areasCatalogRefreshTimer);
    this.areasCatalogRefreshTimer = null;
    for (const widget of this.areasCatalogReading || []) areasCleanCatalogDom(widget.el);
    for (const view of this.areasCatalogEditors || []) areasCleanCatalogDom(view.dom);
    this.areasCatalogReading?.clear();
    this.areasCatalogEditors?.clear();
  }

  areasCatalogState() {
    try { return this.areasReportState(); }
    catch (_error) { return this.areasCatalogLastState || { report: null, unavailable: true, today: areasLocalDate() }; }
  }

  areasCatalogHandlers(sourcePath) {
    return {
      retry: () => { void this.apiAreasReport({ force: true }); },
      sync: () => { void this.apiAreasSync(); },
    };
  }

  areasCatalogOptions(sourcePath, state = null) {
    const current = state || this.areasCatalogState();
    return {
      state: current,
      sourcePath,
      catalog: areasCardHost(current, sourcePath),
      rows: areasCardRows(current, sourcePath),
      hue: areasCardHostHue(current, sourcePath),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      handlers: this.areasCatalogHandlers(sourcePath),
    };
  }

  areasCatalogCleanAnchor(el) {
    const anchor = Array.from(el?.querySelectorAll?.(`.${AREAS_ANCHOR_CLASS}`) || [])[0];
    anchor?.remove?.();
  }

  areasCatalogEnsureAnchor(el, heading = null) {
    let anchor = Array.from(el?.querySelectorAll?.(`.${AREAS_ANCHOR_CLASS}`) || [])[0] || null;
    if (!anchor) {
      anchor = notebookCreateEl(notebookDomDoc(el), "div", AREAS_ANCHOR_CLASS);
      if (!anchor) return null;
    }
    if (heading?.parentNode) {
      const next = heading.nextSibling || null;
      if (anchor.parentNode !== heading.parentNode || (next !== anchor && anchor.previousSibling !== heading)) heading.parentNode.insertBefore(anchor, next);
    } else if (anchor.parentNode !== el) {
      el.insertBefore?.(anchor, el.firstChild || null);
    }
    return anchor;
  }

  areasPaintReading(el, sourcePath, allowAnchor = true) {
    const options = this.areasCatalogOptions(sourcePath);
    const callouts = areasFindCallouts(el);
    for (const callout of callouts) areasPaintCallout(callout, options);
    const catalog = options.catalog;
    if (!catalog || callouts.length || !allowAnchor) {
      this.areasCatalogCleanAnchor(el);
      return;
    }
    const heading = Array.from(el.querySelectorAll?.("h2") || []).find((head) =>
      !notebookInsideCode(head) && /^Areas\s*$/i.test(head.childNodes?.[0]?.textContent || head.textContent || ""));
    const anchor = this.areasCatalogEnsureAnchor(el, heading || null);
    if (anchor) areasPaintStandalone(anchor, options);
  }

  renderAreasCatalogInReading(el, ctx) {
    if (!this.areasCatalogActive || !ctx?.sourcePath || notebookInsideCode(el)) return;
    const callouts = areasFindCallouts(el);
    if (el.closest?.(".cm-editor") || el.querySelector?.(".cm-editor") || callouts.some((callout) => callout.closest?.(".cm-editor"))) return;
    const section = ctx.getSectionInfo?.(el);
    const anchorLine = section?.text ? areasCardAnchorLine(section.text) : null;
    const allowAnchor = anchorLine === null || (section.lineStart <= anchorLine && section.lineEnd >= anchorLine);
    this.areasPaintReading(el, ctx.sourcePath, allowAnchor);
    let widget = Array.from(this.areasCatalogReading || []).find((item) => item.el === el);
    if (!widget) {
      widget = { el, path: ctx.sourcePath, allowAnchor };
      this.areasCatalogReading.add(widget);
      if (ctx.addChild && typeof MarkdownRenderChild === "function") {
        const child = new MarkdownRenderChild(el);
        child.onunload = () => {
          areasCleanCatalogDom(el);
          this.areasCatalogReading?.delete(widget);
        };
        ctx.addChild(child);
      }
    } else if (widget.path !== ctx.sourcePath) {
      areasCleanCatalogDom(el);
      widget.path = ctx.sourcePath;
      this.areasPaintReading(el, ctx.sourcePath, allowAnchor);
    }
    widget.allowAnchor = allowAnchor;
  }

  areasCatalogLivePath(view) {
    return this.areasCatalogActive ? this.notebookCatalogLivePath(view) : null;
  }

  areasPaintEditor(view) {
    const path = this.areasCatalogLivePath(view);
    if (!path) {
      areasCleanCatalogDom(view.dom);
      return;
    }
    const options = this.areasCatalogOptions(path);
    for (const callout of areasFindCallouts(view.dom)) {
      if (!callout.closest?.(".markdown-embed")) areasPaintCallout(callout, options);
    }
  }

  buildAreasCatalogDecorations(view) {
    const path = this.areasCatalogLivePath(view);
    if (!path || !Decoration || !WidgetType || !RangeSetBuilder) return Decoration?.none;
    const text = view.state.doc.toString();
    if (areasCardHasCallout(text)) return Decoration.none;
    const options = this.areasCatalogOptions(path);
    if (!options.catalog) return Decoration.none;
    const plugin = this;
    const key = JSON.stringify([path, options.catalog.state, options.rows, options.state.stale, options.state.error, options.state.syncBusy, options.state.syncError]);
    const AreaStatusWidget = class extends WidgetType {
      constructor() { super(); this.key = key; }
      eq(other) { return other?.key === this.key; }
      toDOM() {
        const host = notebookCreateEl(typeof document !== "undefined" ? document : null, "div", AREAS_ANCHOR_CLASS);
        if (host) areasPaintStandalone(host, plugin.areasCatalogOptions(path));
        return host;
      }
      ignoreEvent() { return true; }
    };
    const index = areasCardAnchorLine(text);
    const line = view.state.doc.line(Math.min(index + 1, view.state.doc.lines));
    const builder = new RangeSetBuilder();
    builder.add(line.to, line.to, Decoration.widget({ widget: new AreaStatusWidget(), side: 1 }));
    return builder.finish();
  }

  createAreasCatalogExtension() {
    if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
    const plugin = this;
    const refresh = ensureAreasCatalogRefresh();
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.path = plugin.areasCatalogLivePath(view);
        this.decorations = plugin.buildAreasCatalogDecorations(view);
        plugin.areasCatalogEditors.add(view);
        this.schedulePaint();
      }
      schedulePaint() {
        if (this.timer != null) return;
        this.timer = plugin.areasSetTimeout(() => {
          this.timer = null;
          if (plugin.areasCatalogActive) plugin.areasPaintEditor(this.view);
        }, 0);
      }
      update(update) {
        const path = plugin.areasCatalogLivePath(update.view);
        const changed = path !== this.path;
        if (changed) areasCleanCatalogDom(update.view.dom);
        this.path = path;
        const notified = refresh && (update.transactions || []).some((tx) => (tx.effects || []).some((effect) => effect.is?.(refresh)));
        if (changed || update.docChanged || notified) this.decorations = plugin.buildAreasCatalogDecorations(update.view);
        this.schedulePaint();
      }
      destroy() {
        plugin.areasClearTimeout(this.timer);
        areasCleanCatalogDom(this.view.dom);
        plugin.areasCatalogEditors.delete(this.view);
      }
    }, { decorations: (value) => value.decorations });
  }

  scheduleAreasCatalogRefresh() {
    if (!this.areasCatalogActive || this.areasCatalogRefreshTimer !== null) return;
    this.areasCatalogRefreshTimer = this.areasSetTimeout(() => {
      this.areasCatalogRefreshTimer = null;
      if (!this.areasCatalogActive) return;
      for (const widget of this.areasCatalogReading || []) {
        if (!widget.el?.closest?.(".cm-editor")) this.areasPaintReading(widget.el, widget.path, widget.allowAnchor);
      }
      const effect = ensureAreasCatalogRefresh();
      for (const view of this.areasCatalogEditors || []) {
        try { if (effect) view.dispatch({ effects: effect.of(null) }); } catch (_error) { /* stale view */ }
        this.areasPaintEditor(view);
      }
    }, 0);
  }
}
