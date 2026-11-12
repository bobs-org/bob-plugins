// Record index cards in Reading view and Live Preview. Folds and date
// chips are view state; only bob albums sync writes the stored index.
let albumRecordsRefreshEffect = null;
function ensureAlbumRecordsRefresh() {
  if (!albumRecordsRefreshEffect && StateEffect?.define) albumRecordsRefreshEffect = StateEffect.define();
  return albumRecordsRefreshEffect;
}

class BobLedgerToolsAlbumRecordsMixin {
  setupAlbumRecords() {
    this.albumRecordsActive = true;
    this.albumRecordsReading = new Set();
    this.albumRecordsEditors = new Set();
    this.albumRecordsFoldByView = new WeakMap();
    this.albumRecordsPendingExpand = null;
    this.albumRecordsRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderAlbumRecordsInReading(el, ctx), 52);
    const extension = this.createAlbumRecordsExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.albumRecordsUnsubscribe = this.apiAlbumSubscribe(() => this.scheduleAlbumRecordsRefresh());
  }

  teardownAlbumRecords() {
    this.albumRecordsActive = false;
    this.albumRecordsUnsubscribe?.();
    this.albumRecordsUnsubscribe = null;
    this.albumClearTimeout(this.albumRecordsRefreshTimer);
    this.albumRecordsRefreshTimer = null;
    this.albumRecordsPendingExpand = null;
    for (const widget of this.albumRecordsReading || []) albumCleanRecordsDom(widget.el);
    for (const view of this.albumRecordsEditors || []) albumCleanRecordsDom(view.dom);
    this.albumRecordsReading?.clear();
    this.albumRecordsEditors?.clear();
  }

  albumRecordsFoldMap(host) {
    if (!(this.albumRecordsFoldByView instanceof WeakMap)) this.albumRecordsFoldByView = new WeakMap();
    let folds = this.albumRecordsFoldByView.get(host);
    if (!(folds instanceof Map)) {
      folds = new Map();
      this.albumRecordsFoldByView.set(host, folds);
    }
    return folds;
  }

  albumRecordsApplyPending(path, folds, el) {
    const pending = this.albumRecordsPendingExpand;
    if (!pending || albumReportPath(pending.path) !== albumReportPath(path)) return;
    if (Date.now() - pending.at > 8000) return;
    if (pending.container && el && pending.container !== el) {
      if (typeof pending.container.contains !== "function" || !pending.container.contains(el)) return;
    }
    folds.set(albumRecordsFoldKey(path, pending.identity), false);
    if (pending.label && pending.label !== pending.identity) {
      folds.set(albumRecordsFoldKey(path, pending.label), false);
    }
  }

  albumRecordsLivePath(view) {
    return this.albumRecordsActive ? this.notebookCatalogLivePath(view) : null;
  }

  albumRecordsOptions(sourcePath, folds, handlers) {
    const state = this.albumReportState();
    return {
      sourcePath,
      state,
      album: albumRecordsSourceAlbum(state, sourcePath),
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      today: state.today,
      folds,
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      handlers,
    };
  }

  albumRecordsHandlers(sourcePath, folds, surface) {
    return {
      toggleFold: (identity, folded) => {
        folds.set(albumRecordsFoldKey(sourcePath, identity), Boolean(folded));
        if (surface && surface.view) this.paintAlbumRecordsEditor(surface.view);
        else if (surface && surface.el) this.paintAlbumRecordsReading(surface.el, sourcePath, folds);
      },
    };
  }

  paintAlbumRecordsReading(el, sourcePath, folds) {
    if (!albumRecordsShouldPaint(this.albumReportState(), sourcePath)) {
      albumCleanRecordsDom(el);
      return;
    }
    this.albumRecordsApplyPending(sourcePath, folds, el);
    const options = this.albumRecordsOptions(sourcePath, folds, this.albumRecordsHandlers(sourcePath, folds, { el }));
    for (const callout of albumFindRecordCallouts(el)) {
      if (!callout.closest?.(".cm-editor")) albumPaintRecordsCallout(callout, options);
    }
  }

  renderAlbumRecordsInReading(el, ctx) {
    if (!this.albumRecordsActive || !ctx?.sourcePath || notebookInsideCode(el)) return;
    if (el.closest?.(".cm-editor")) return;
    const folds = this.albumRecordsFoldMap(el);
    this.paintAlbumRecordsReading(el, ctx.sourcePath, folds);
    const existing = Array.from(this.albumRecordsReading || []).find((widget) => widget.el === el);
    if (existing) {
      if (existing.path !== ctx.sourcePath) {
        albumCleanRecordsDom(el);
        this.paintAlbumRecordsReading(el, ctx.sourcePath, folds);
      }
      existing.path = ctx.sourcePath;
      return;
    }
    const widget = { el, path: ctx.sourcePath, folds };
    this.albumRecordsReading.add(widget);
    if (ctx.addChild && typeof MarkdownRenderChild === "function") {
      const child = new MarkdownRenderChild(el);
      child.onunload = () => {
        albumCleanRecordsDom(el);
        this.albumRecordsReading?.delete(widget);
      };
      ctx.addChild(child);
    }
  }

  paintAlbumRecordsEditor(view) {
    const path = this.albumRecordsLivePath(view);
    if (!path || !albumRecordsShouldPaint(this.albumReportState(), path)) {
      albumCleanRecordsDom(view.dom);
      return;
    }
    const folds = this.albumRecordsFoldMap(view);
    this.albumRecordsApplyPending(path, folds, view.dom);
    const options = this.albumRecordsOptions(path, folds, this.albumRecordsHandlers(path, folds, { view }));
    for (const callout of albumFindRecordCallouts(view.dom)) {
      if (!callout.closest?.(".markdown-embed")) albumPaintRecordsCallout(callout, options);
    }
  }

  createAlbumRecordsExtension() {
    if (!ViewPlugin?.fromClass || !Decoration) return null;
    const plugin = this;
    const refresh = ensureAlbumRecordsRefresh();
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.path = plugin.albumRecordsLivePath(view);
        this.decorations = Decoration.none;
        plugin.albumRecordsEditors.add(view);
        this.schedulePaint();
      }
      schedulePaint() {
        if (this.timer != null) return;
        this.timer = plugin.albumSetTimeout(() => {
          this.timer = null;
          if (plugin.albumRecordsActive) plugin.paintAlbumRecordsEditor(this.view);
        }, 0);
      }
      update(update) {
        const path = plugin.albumRecordsLivePath(update.view);
        const changed = path !== this.path;
        if (changed) albumCleanRecordsDom(update.view.dom);
        this.path = path;
        const notified = (update.transactions || []).some((tx) => (tx.effects || []).some((effect) => effect.is?.(refresh)));
        if (changed || update.docChanged || notified) this.decorations = Decoration.none;
        this.schedulePaint();
      }
      destroy() {
        plugin.albumClearTimeout(this.timer);
        albumCleanRecordsDom(this.view.dom);
        plugin.albumRecordsEditors.delete(this.view);
      }
    }, { decorations: (value) => value.decorations });
  }

  scheduleAlbumRecordsRefresh() {
    if (!this.albumRecordsActive || this.albumRecordsRefreshTimer != null) return;
    this.albumRecordsRefreshTimer = this.albumSetTimeout(() => {
      this.albumRecordsRefreshTimer = null;
      if (!this.albumRecordsActive) return;
      for (const widget of this.albumRecordsReading) {
        this.paintAlbumRecordsReading(widget.el, widget.path, widget.folds);
      }
      const effect = ensureAlbumRecordsRefresh();
      for (const view of this.albumRecordsEditors) {
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
        this.paintAlbumRecordsEditor(view);
      }
    }, 100);
  }

  async albumRevealRecordGroup(view, target = {}) {
    if (this.albumRecordsActive === false || !target.path) return { ok: false };
    const identity = target.value || target.label;
    if (!identity) return { ok: false, ...target };
    this.albumRecordsPendingExpand = {
      path: albumReportPath(target.path),
      identity,
      label: target.label || "",
      at: Date.now(),
      container: view?.contentEl || view?.containerEl || view?.previewMode?.containerEl || view?.dom || null,
    };
    for (const widget of this.albumRecordsReading || []) {
      if (albumReportPath(widget.path) !== albumReportPath(target.path)) continue;
      this.albumRecordsApplyPending(widget.path, widget.folds, widget.el);
      this.paintAlbumRecordsReading(widget.el, widget.path, widget.folds);
    }
    for (const editor of this.albumRecordsEditors || []) {
      if (albumReportPath(this.albumRecordsLivePath(editor) || "") !== albumReportPath(target.path)) continue;
      this.paintAlbumRecordsEditor(editor);
    }
    if (view?.editor?.cm) this.paintAlbumRecordsEditor(view.editor.cm);
    return { ok: true, ...target };
  }
}
