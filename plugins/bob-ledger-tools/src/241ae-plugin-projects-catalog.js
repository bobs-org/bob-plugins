// Projects catalog cards in Reading view and Live Preview share one
// projects report subscription. Folds live in per-pane state; painting never
// mutates the note and never steals focus through refreshes or remounts.
let projectsCatalogRefreshEffect = null;
function ensureProjectsCatalogRefresh() {
  if (!projectsCatalogRefreshEffect && StateEffect?.define) projectsCatalogRefreshEffect = StateEffect.define();
  return projectsCatalogRefreshEffect;
}

class BobLedgerToolsProjectsCatalogMixin {
  setupProjectsCatalog() {
    this.projectsCatalogActive = true;
    this.projectsCatalogReading = new Set();
    this.projectsCatalogEditors = new Set();
    this.projectsCatalogFoldByView = new WeakMap();
    this.projectsCatalogRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderProjectsCatalogInReading(el, ctx), 53);
    const extension = this.createProjectsCatalogExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.projectsCatalogUnsubscribe = this.apiProjectsSubscribe(() => this.scheduleProjectsCatalogRefresh());
  }

  teardownProjectsCatalog() {
    this.projectsCatalogActive = false;
    this.projectsCatalogUnsubscribe?.();
    this.projectsCatalogUnsubscribe = null;
    this.projectsClearTimeout(this.projectsCatalogRefreshTimer);
    this.projectsCatalogRefreshTimer = null;
    for (const widget of this.projectsCatalogReading || []) projectsCleanCatalogDom(widget.el);
    for (const view of this.projectsCatalogEditors || []) projectsCleanCatalogDom(view.dom);
    this.projectsCatalogReading?.clear();
    this.projectsCatalogEditors?.clear();
  }

  projectsCatalogFoldMap(host) {
    if (!(this.projectsCatalogFoldByView instanceof WeakMap)) this.projectsCatalogFoldByView = new WeakMap();
    let folds = this.projectsCatalogFoldByView.get(host);
    const surface = host?.dom || host;
    const editor = surface?.matches?.(".cm-editor") ? surface : surface?.closest?.(".cm-editor");
    const readingWidget = editor
      ? Array.from(this.projectsCatalogReading || []).find((widget) => widget.el?.closest?.(".cm-editor") === editor)
      : null;
    if (readingWidget) {
      if (!(folds instanceof Map) || (folds.size === 0 && readingWidget.folds instanceof Map && readingWidget.folds.size > 0)) {
        folds = readingWidget.folds instanceof Map ? readingWidget.folds : new Map();
        this.projectsCatalogFoldByView.set(host, folds);
      }
      // Obsidian can move a Markdown postprocessor node into CodeMirror after
      // its callback runs. Once its editor is known, the view plugin owns all
      // later paints for that surface.
      readingWidget.editorOwner = host;
    }
    if (!(folds instanceof Map)) {
      folds = new Map();
      this.projectsCatalogFoldByView.set(host, folds);
    }
    return folds;
  }

  projectsCatalogHandlers(sourcePath, folds) {
    // Fold state is per-pane: handlers repaint only the surfaces that share
    // this exact folds map, so split views of one note stay independent.
    const repaintSurface = () => {
      const paintedEditors = new Set();
      for (const widget of this.projectsCatalogReading || []) {
        if (widget.folds !== folds) continue;
        const editorDom = widget.el?.matches?.(".cm-editor") ? widget.el : widget.el?.closest?.(".cm-editor");
        const editorView = editorDom && Array.from(this.projectsCatalogEditors || []).find((view) => view.dom === editorDom);
        if (editorView) {
          const editorFolds = this.projectsCatalogFoldMap(editorView);
          if (editorFolds !== folds) {
            for (const [key, value] of folds) editorFolds.set(key, value);
          }
          widget.editorOwner = editorView;
          this.paintProjectsCatalogEditor(editorView);
          paintedEditors.add(editorView);
        } else if (!editorDom && !widget.editorOwner) {
          this.paintProjectsCatalogReading(widget.el, widget.path, widget.folds, widget.allowAnchor);
        }
      }
      for (const view of this.projectsCatalogEditors || []) {
        if (!paintedEditors.has(view) && this.projectsCatalogFoldByView instanceof WeakMap && this.projectsCatalogFoldByView.get(view) === folds) {
          this.paintProjectsCatalogEditor(view);
        }
      }
    };
    return {
      retry: () => { void this.apiProjectsReport({ force: true }); },
      sync: () => { void this.apiProjectsSync({ automatic: false }); },
      copy: () => { void this.apiProjectsCopyStarter(sourcePath); },
      toggleClosed: (folded) => {
        projectsCardFoldMap(folds).set(projectsCardClosedFoldKey(sourcePath), Boolean(folded));
        repaintSurface();
      },
      toggleChild: (childPath, expanded) => {
        projectsCardFoldMap(folds).set(projectsCardChildFoldKey(sourcePath, childPath), Boolean(expanded));
        repaintSurface();
      },
    };
  }

  projectsCatalogOptions(sourcePath, folds) {
    const state = this.projectsReportState();
    return {
      sourcePath,
      hostPath: sourcePath,
      state,
      catalog: projectsCardHost(state, sourcePath),
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      handlers: this.projectsCatalogHandlers(sourcePath, folds),
      folds,
    };
  }

  async apiProjectsCopyStarter(sourcePath) {
    if (this.projectsCatalogActive === false) return { ok: false };
    const state = this.projectsReportState();
    const value = projectsCardCopyText(projectsCardHost(state, sourcePath), sourcePath);
    if (!value) return { ok: false, reason: "No projects host is resolved for this note." };
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      try { new Notice("Clipboard is unavailable."); } catch (_) {}
      return { ok: false, reason: "clipboard is unavailable" };
    }
    try {
      await clipboard.writeText(value);
      try { new Notice(`Copied ${value}.`); } catch (_) {}
      return { ok: true, value };
    } catch (_) {
      try { new Notice("Could not copy the project starter."); } catch (_) {}
      return { ok: false, reason: "clipboard write failed" };
    }
  }

  paintProjectsCatalogReading(el, sourcePath, folds, allowAnchor = true) {
    const options = this.projectsCatalogOptions(sourcePath, folds);
    const callouts = projectsFindCallouts(el);
    for (const callout of callouts) projectsPaintCallout(callout, options);
    // Hosts without a stored callout get an actionable anchor at their
    // Projects heading, H1, or safe body position. With no children and a
    // current catalog, no empty card remains.
    const rows = projectsCardRowEntries(options.state, sourcePath);
    const catalog = options.catalog;
    const needsAnchor = allowAnchor && !callouts.length
      && ((catalog && catalog.state !== "current") || rows.length > 0);
    if (!needsAnchor) {
      // Clear stale standalone chrome only; callout chrome shares these
      // classes and must survive.
      for (const cls of [PROJECTS_STATUS_CLASS, PROJECTS_ANCHOR_CLASS, PROJECTS_HEADER_CLASS, PROJECTS_CLOSED_CLASS]) {
        for (const node of Array.from(el.querySelectorAll?.(`.${cls}`) || [])) {
          if (!node.closest?.('[data-callout="projects"]')) node.remove();
        }
      }
      return;
    }
    const heading = Array.from(el.querySelectorAll?.("h2") || []).find((head) =>
      !notebookInsideCode(head) && /^Projects\s*$/i.test(head.childNodes?.[0]?.textContent || head.textContent));
    const title = notebookFindHostTitle(el);
    const existing = el.querySelector?.(`.${PROJECTS_ANCHOR_CLASS}`);
    let host = heading || title || existing;
    if (!host && !el.closest?.(".markdown-embed, .cm-editor") && el.querySelector?.("p")) {
      host = notebookCreateEl(notebookDomDoc(el), "div", PROJECTS_ANCHOR_CLASS);
      el.insertBefore(host, el.firstChild);
    }
    if (host) {
      albumSetAttr(host, "data-bob-projects-card", "true");
      projectsPaintStandalone(host, options);
    }
  }

  renderProjectsCatalogInReading(el, ctx) {
    if (!this.projectsCatalogActive || !ctx?.sourcePath || notebookInsideCode(el)) return;
    // CodeMirror owns its rendered callouts; its view plugin handles their
    // lifecycle so a postprocessor child cannot clean another pane's chrome.
    const callouts = projectsFindCallouts(el);
    if (el.closest?.(".cm-editor") || el.querySelector?.(".cm-editor") || callouts.some((callout) => callout.closest?.(".cm-editor"))) return;
    const section = ctx.getSectionInfo?.(el);
    const anchorLine = section?.text ? projectsCardAnchorLine(section.text) : null;
    const allowAnchor = anchorLine === null || (section.lineStart <= anchorLine && section.lineEnd >= anchorLine);
    const folds = this.projectsCatalogFoldMap(el);
    this.paintProjectsCatalogReading(el, ctx.sourcePath, folds, allowAnchor);
    const existing = Array.from(this.projectsCatalogReading || []).find((widget) => widget.el === el);
    if (existing) {
      if (existing.path !== ctx.sourcePath) {
        projectsCleanCatalogDom(el);
        this.paintProjectsCatalogReading(el, ctx.sourcePath, folds, allowAnchor);
      }
      existing.path = ctx.sourcePath;
      existing.allowAnchor = allowAnchor;
      return;
    }
    const widget = { el, path: ctx.sourcePath, folds, allowAnchor };
    this.projectsCatalogReading.add(widget);
    if (ctx.addChild && typeof MarkdownRenderChild === "function") {
      const child = new MarkdownRenderChild(el);
      child.onunload = () => {
        projectsCleanCatalogDom(el);
        this.projectsCatalogReading?.delete(widget);
      };
      ctx.addChild(child);
    }
  }

  projectsCatalogLivePath(view) {
    return this.projectsCatalogActive ? this.notebookCatalogLivePath(view) : null;
  }

  paintProjectsCatalogEditor(view) {
    const path = this.projectsCatalogLivePath(view);
    if (!path) {
      projectsCleanCatalogDom(view.dom);
      return;
    }
    const options = this.projectsCatalogOptions(path, this.projectsCatalogFoldMap(view));
    for (const callout of projectsFindCallouts(view.dom)) {
      // Embedded notes have their own source identity, never the outer editor's.
      if (!callout.closest?.(".markdown-embed")) projectsPaintCallout(callout, options);
    }
  }

  buildProjectsCatalogDecorations(view) {
    const path = this.projectsCatalogLivePath(view);
    if (!path || !Decoration || !WidgetType || !RangeSetBuilder) return Decoration?.none;
    const text = view.state.doc.toString();
    const regions = projectsCardSourceRegions(text);
    const state = this.projectsReportState();
    const catalog = projectsCardHost(state, path);
    const rows = projectsCardRowEntries(state, path);
    // Rendered callout titles hold their own status. Decorations are needed
    // only for missing regions and stay outside the editable frontmatter.
    if (regions.length || !catalog || (catalog.state === "current" && rows.length > 0)) return Decoration.none;
    const standalone = projectsCardStatus(state, path);
    if (!standalone.message && !standalone.action) return Decoration.none;
    const plugin = this;
    const key = JSON.stringify(standalone);
    const StatusWidget = class extends WidgetType {
      constructor() { super(); this.key = key; this.path = path; }
      eq(other) { return other?.key === this.key && other?.path === this.path; }
      toDOM() {
        const host = notebookCreateEl(typeof document !== "undefined" ? document : null, "span", PROJECTS_ANCHOR_CLASS);
        if (host) {
          albumSetAttr(host, "data-bob-projects-card", "true");
          projectsPaintStandalone(host, plugin.projectsCatalogOptions(path, plugin.projectsCatalogFoldMap(view)));
        }
        return host;
      }
      ignoreEvent() { return true; }
    };
    const index = projectsCardAnchorLine(text);
    const line = view.state.doc.line(Math.min(index + 1, view.state.doc.lines));
    const builder = new RangeSetBuilder();
    builder.add(line.to, line.to, Decoration.widget({ widget: new StatusWidget(), side: 1 }));
    return builder.finish();
  }

  createProjectsCatalogExtension() {
    if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
    const plugin = this;
    const refresh = ensureProjectsCatalogRefresh();
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.path = plugin.projectsCatalogLivePath(view);
        this.decorations = plugin.buildProjectsCatalogDecorations(view);
        plugin.projectsCatalogEditors.add(view);
        this.schedulePaint();
      }
      schedulePaint() {
        if (this.timer != null) return;
        this.timer = plugin.projectsSetTimeout(() => {
          this.timer = null;
          if (plugin.projectsCatalogActive) plugin.paintProjectsCatalogEditor(this.view);
        }, 0);
      }
      update(update) {
        const path = plugin.projectsCatalogLivePath(update.view);
        const changed = path !== this.path;
        if (changed) projectsCleanCatalogDom(update.view.dom);
        this.path = path;
        const notified = (update.transactions || []).some((tx) => (tx.effects || []).some((effect) => effect.is?.(refresh)));
        if (changed || update.docChanged || notified) this.decorations = plugin.buildProjectsCatalogDecorations(update.view);
        this.schedulePaint();
      }
      destroy() {
        plugin.projectsClearTimeout(this.timer);
        projectsCleanCatalogDom(this.view.dom);
        plugin.projectsCatalogEditors.delete(this.view);
      }
    }, { decorations: (value) => value.decorations });
  }

  scheduleProjectsCatalogRefresh() {
    if (!this.projectsCatalogActive || this.projectsCatalogRefreshTimer != null) return;
    this.projectsCatalogRefreshTimer = this.projectsSetTimeout(() => {
      this.projectsCatalogRefreshTimer = null;
      if (!this.projectsCatalogActive) return;
      for (const widget of this.projectsCatalogReading) {
        if (!widget.editorOwner && !widget.el?.closest?.(".cm-editor")) {
          this.paintProjectsCatalogReading(widget.el, widget.path, widget.folds, widget.allowAnchor);
        }
      }
      const effect = ensureProjectsCatalogRefresh();
      for (const view of this.projectsCatalogEditors) {
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
        this.paintProjectsCatalogEditor(view);
      }
    }, 100);
  }
}
