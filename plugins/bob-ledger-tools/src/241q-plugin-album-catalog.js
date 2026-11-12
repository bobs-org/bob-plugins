// Owner cards in Reading view and Live Preview share one album subscription.
let albumCatalogRefreshEffect = null;
function ensureAlbumCatalogRefresh() {
  if (!albumCatalogRefreshEffect && StateEffect?.define) albumCatalogRefreshEffect = StateEffect.define();
  return albumCatalogRefreshEffect;
}

class BobLedgerToolsAlbumCatalogMixin {
  setupAlbumCatalog() {
    this.albumCatalogActive = true;
    this.albumCatalogReading = new Set();
    this.albumCatalogEditors = new Set();
    this.albumCatalogRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderAlbumCatalogInReading(el, ctx), 51);
    const extension = this.createAlbumCatalogExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.albumCatalogUnsubscribe = this.apiAlbumSubscribe(() => this.scheduleAlbumCatalogRefresh());
  }

  teardownAlbumCatalog() {
    this.albumCatalogActive = false;
    this.albumCatalogUnsubscribe?.();
    this.albumCatalogUnsubscribe = null;
    this.albumClearTimeout(this.albumCatalogRefreshTimer);
    this.albumCatalogRefreshTimer = null;
    for (const widget of this.albumCatalogReading || []) albumCleanCatalogDom(widget.el);
    for (const view of this.albumCatalogEditors || []) albumCleanCatalogDom(view.dom);
    this.albumCatalogReading?.clear();
    this.albumCatalogEditors?.clear();
  }

  albumCatalogHandlers(sourcePath) {
    return {
      openGroup: (path, value, event) => { void this.apiAlbumOpenGroup(path, value, sourcePath, event); },
      retry: () => { void this.apiAlbumReport({ force: true }); },
      sync: () => { void this.apiAlbumSync({ automatic: false }); },
    };
  }

  albumCatalogOptions(sourcePath) {
    return { sourcePath, state: this.albumReportState(),
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      metadataCache: this.app?.metadataCache, vault: this.app?.vault,
      handlers: this.albumCatalogHandlers(sourcePath) };
  }

  paintAlbumCatalogReading(el, sourcePath, allowAnchor = true) {
    const options = this.albumCatalogOptions(sourcePath);
    const callouts = albumFindCallouts(el);
    for (const callout of callouts) albumPaintCallout(callout, options);
    const catalog = albumHostCatalog(options.state, sourcePath);
    // Missing catalogs have no callout. Their real heading, H1, or an H1-less
    // body fragment is the actionable anchor; non-hosts never get an anchor.
    if (allowAnchor && !callouts.length && catalog && catalog.state !== "current") {
      const heading = Array.from(el.querySelectorAll?.("h2") || []).find((head) =>
        !notebookInsideCode(head) && /^Albums\s*$/i.test(head.childNodes?.[0]?.textContent || head.textContent));
      const title = notebookFindHostTitle(el);
      const existing = el.querySelector?.(".bob-album-anchor");
      let host = heading || title || existing;
      if (!host && !el.closest?.(".markdown-embed, .cm-editor") && el.querySelector?.("p")) {
        host = notebookCreateEl(notebookDomDoc(el), "div", "bob-album-anchor");
        el.insertBefore(host, el.firstChild);
      }
      if (host) albumPaintStatus(host, albumCatalogStatus(options.state, sourcePath), options.handlers);
    } else {
      // Clear old missing-catalog fallback chrome without touching the callout.
      for (const status of Array.from(el.querySelectorAll?.(`.${ALBUM_STATUS}`) || [])) {
        if (!status.closest?.('[data-callout="albums"]')) status.remove();
      }
      notebookRemovePainted(el, "bob-album-anchor");
    }
  }

  renderAlbumCatalogInReading(el, ctx) {
    if (!this.albumCatalogActive || !ctx?.sourcePath || notebookInsideCode(el)) return;
    // CodeMirror owns its rendered callouts; its view plugin handles their
    // lifecycle so a postprocessor child cannot clean another pane's chrome.
    if (el.closest?.(".cm-editor")) return;
    const section = ctx.getSectionInfo?.(el);
    const anchorLine = section?.text ? albumCatalogAnchorLine(section.text) : null;
    const allowAnchor = anchorLine === null || (section.lineStart <= anchorLine && section.lineEnd >= anchorLine);
    this.paintAlbumCatalogReading(el, ctx.sourcePath, allowAnchor);
    const existing = Array.from(this.albumCatalogReading || []).find((widget) => widget.el === el);
    if (existing) {
      if (existing.path !== ctx.sourcePath) {
        albumCleanCatalogDom(el);
        this.paintAlbumCatalogReading(el, ctx.sourcePath, allowAnchor);
      }
      existing.path = ctx.sourcePath;
      existing.allowAnchor = allowAnchor;
      return;
    }
    const widget = { el, path: ctx.sourcePath, allowAnchor };
    this.albumCatalogReading.add(widget);
    if (ctx.addChild && typeof MarkdownRenderChild === "function") {
      const child = new MarkdownRenderChild(el);
      child.onunload = () => {
        albumCleanCatalogDom(el);
        this.albumCatalogReading?.delete(widget);
      };
      ctx.addChild(child);
    }
  }

  albumCatalogLivePath(view) {
    return this.albumCatalogActive ? this.notebookCatalogLivePath(view) : null;
  }

  paintAlbumCatalogEditor(view) {
    const path = this.albumCatalogLivePath(view);
    if (!path) { albumCleanCatalogDom(view.dom); return; }
    const options = this.albumCatalogOptions(path);
    for (const callout of albumFindCallouts(view.dom)) {
      // Embedded notes have their own source identity, never the outer editor's.
      if (!callout.closest?.(".markdown-embed")) albumPaintCallout(callout, options);
    }
  }

  buildAlbumCatalogDecorations(view) {
    const path = this.albumCatalogLivePath(view);
    if (!path || !Decoration || !WidgetType || !RangeSetBuilder) return Decoration?.none;
    const text = view.state.doc.toString();
    const regions = albumSourceRegions(text);
    const state = this.albumReportState();
    const catalog = albumHostCatalog(state, path);
    // Rendered callout titles hold their own status. Decorations are needed
    // only for missing regions and stay outside the editable frontmatter.
    if (regions.length || !catalog || catalog.state === "current") return Decoration.none;
    const model = albumCatalogStatus(state, path);
    if (!model.message && !model.action) return Decoration.none;
    const plugin = this;
    const key = JSON.stringify(model);
    const StatusWidget = class extends WidgetType {
      constructor() { super(); this.key = key; this.path = path; }
      eq(other) { return other?.key === this.key && other?.path === this.path; }
      toDOM() {
        const host = notebookCreateEl(typeof document !== "undefined" ? document : null, "span", "bob-album-anchor");
        if (host) albumPaintStatus(host, model, plugin.albumCatalogHandlers(path));
        return host;
      }
      ignoreEvent() { return true; }
    };
    const index = albumCatalogAnchorLine(text);
    const line = view.state.doc.line(Math.min(index + 1, view.state.doc.lines));
    const builder = new RangeSetBuilder();
    builder.add(line.to, line.to, Decoration.widget({ widget: new StatusWidget(), side: 1 }));
    return builder.finish();
  }

  createAlbumCatalogExtension() {
    if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
    const plugin = this;
    const refresh = ensureAlbumCatalogRefresh();
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.path = plugin.albumCatalogLivePath(view);
        this.decorations = plugin.buildAlbumCatalogDecorations(view);
        plugin.albumCatalogEditors.add(view);
        this.schedulePaint();
      }
      schedulePaint() {
        if (this.timer != null) return;
        this.timer = plugin.albumSetTimeout(() => {
          this.timer = null;
          if (plugin.albumCatalogActive) plugin.paintAlbumCatalogEditor(this.view);
        }, 0);
      }
      update(update) {
        const path = plugin.albumCatalogLivePath(update.view);
        const changed = path !== this.path;
        if (changed) albumCleanCatalogDom(update.view.dom);
        this.path = path;
        const notified = (update.transactions || []).some((tx) => (tx.effects || []).some((effect) => effect.is?.(refresh)));
        if (changed || update.docChanged || notified) this.decorations = plugin.buildAlbumCatalogDecorations(update.view);
        this.schedulePaint();
      }
      destroy() {
        plugin.albumClearTimeout(this.timer);
        albumCleanCatalogDom(this.view.dom);
        plugin.albumCatalogEditors.delete(this.view);
      }
    }, { decorations: (value) => value.decorations });
  }

  scheduleAlbumCatalogRefresh() {
    if (!this.albumCatalogActive || this.albumCatalogRefreshTimer != null) return;
    this.albumCatalogRefreshTimer = this.albumSetTimeout(() => {
      this.albumCatalogRefreshTimer = null;
      if (!this.albumCatalogActive) return;
      for (const widget of this.albumCatalogReading) this.paintAlbumCatalogReading(widget.el, widget.path, widget.allowAnchor);
      const effect = ensureAlbumCatalogRefresh();
      for (const view of this.albumCatalogEditors) {
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
        this.paintAlbumCatalogEditor(view);
      }
    }, 100);
  }

  async apiAlbumOpenGroup(path, value, sourcePath, event = {}) {
    if (this.albumCatalogActive === false) return { ok: false };
    const workspace = this.app?.workspace;
    const file = this.app?.vault?.getAbstractFileByPath?.(path);
    if (!file || !workspace?.openLinkText) return { ok: false };
    const album = this.albumReportState().report?.albumsByPath?.get(path);
    let target;
    try { target = albumGroupJumpTarget(await this.app.vault.cachedRead(file), album, value); }
    catch (_) { target = { line: 0, found: false, value, hint: "Opened the album. Its Records region could not be read." }; }
    if (this.albumCatalogActive === false) return { ok: false };
    const navigation = this.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
    let jump = null;
    try { jump = navigation?.captureGoToTaskJumpContext?.(); } catch (_) {}
    const newLeaf = event.ctrlKey || event.metaKey || event.button === 1 ? (event.shiftKey ? "split" : "tab") : false;
    try {
      await workspace.openLinkText(path, sourcePath || "", newLeaf, { eState: { line: target.line } });
      const view = workspace.activeLeaf?.view;
      if (view?.file?.path === path) {
        // records-cards implements this optional hook to expand only this
        // pane's target group before the native line jump scrolls into view.
        await this.albumRevealRecordGroup?.(view, { path, ...target });
        view.setEphemeralState?.({ line: target.line });
        if (jump) await navigation?.enqueueVimJumpContextTransition?.(jump,
          { path, line: target.line, ch: 0 }, { expectedPath: path });
      }
      if (!target.found) new Notice(target.hint);
      return { ok: true, ...target };
    } catch (_) {
      new Notice("Could not open the album's Records region.");
      return { ok: false };
    }
  }
}
