// Report-driven album headers in Reading view and Live Preview. The only
// editor decorations are widgets; no Markdown or frontmatter is rewritten.
let albumHeaderRefreshEffect = null;
function ensureAlbumHeaderRefresh() {
  if (!albumHeaderRefreshEffect && StateEffect?.define) albumHeaderRefreshEffect = StateEffect.define();
  return albumHeaderRefreshEffect;
}

class BobLedgerToolsAlbumHeaderMixin {
  setupAlbumHeader() {
    this.albumHeaderActive = true;
    this.albumHeaderReading = new Set();
    this.albumHeaderReadingPending = new Map();
    this.albumHeaderReadingTimers = new Map();
    this.albumHeaderEditors = new Set();
    this.albumHeaderEditorScopes = new Map();
    this.albumHeaderExpanded = new Map();
    this.albumHeaderRefreshTimer = null;
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderAlbumHeaderInReading(el, ctx), 49);
    const extension = this.createAlbumHeaderExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.albumHeaderUnsubscribe = this.apiAlbumSubscribe?.((state) => {
      this.albumHeaderLastState = state;
      this.scheduleAlbumHeaderRefresh();
    }) || null;
  }

  teardownAlbumHeader() {
    this.albumHeaderActive = false;
    this.albumHeaderUnsubscribe?.();
    this.albumHeaderUnsubscribe = null;
    this.albumClearTimeout?.(this.albumHeaderRefreshTimer);
    this.albumHeaderRefreshTimer = null;
    for (const timer of this.albumHeaderReadingTimers?.values?.() || []) this.albumClearTimeout?.(timer);
    this.albumHeaderReadingTimers?.clear();
    this.albumHeaderReadingPending?.clear();
    try { this.albumSchemaCardModal?.close?.(); } catch (_) {}
    this.albumSchemaCardModal = null;
    for (const widget of this.albumHeaderReading || []) {
      this.albumHeaderRemoveReading(widget.surface, widget.scope, widget.path);
    }
    for (const view of this.albumHeaderEditors || []) this.albumHeaderCleanEditor(view);
    this.albumHeaderReading?.clear();
    this.albumHeaderEditors?.clear();
    this.albumHeaderExpanded?.clear?.();
  }

  albumHeaderDesktop() {
    return albumHeaderIsDesktopPlatform();
  }

  albumHeaderExpandedMap() {
    if (!(this.albumHeaderExpanded instanceof Map)) this.albumHeaderExpanded = new Map();
    return this.albumHeaderExpanded;
  }

  albumHeaderIsExpanded(path, model) {
    const key = albumHeaderPath(path);
    const map = this.albumHeaderExpandedMap();
    if (key && map.has(key)) return map.get(key) === true;
    return albumHeaderDefaultExpanded(model);
  }

  albumHeaderSetExpanded(path, expanded) {
    const key = albumHeaderPath(path);
    if (key) this.albumHeaderExpandedMap().set(key, expanded === true);
    this.refreshAlbumHeaderReading();
    this.refreshAlbumHeaderEditors();
  }

  albumHeaderState() {
    try {
      return typeof this.albumReportState === "function"
        ? this.albumReportState()
        : this.albumHeaderLastState || null;
    } catch (_) {
      return this.albumHeaderLastState || null;
    }
  }

  albumHeaderOptions(sourcePath, state, model) {
    const desktop = this.albumHeaderDesktop();
    const expanded = this.albumHeaderIsExpanded(sourcePath, model);
    return {
      sourcePath,
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      desktop,
      expanded,
      handlers: {
        openPath: (path) => { void this.albumHeaderOpenPath(path, sourcePath); },
        copyCapture: (item) => this.albumHeaderCopyCapture(item),
        toggleSchema: (next) => this.albumHeaderSetExpanded(sourcePath, next),
        openSchemaCard: (item) => (typeof this.openAlbumSchemaEntry === "function" ? this.openAlbumSchemaEntry({ filePath: sourcePath }) : this.openAlbumSchemaCard?.(item, sourcePath)),
        jumpYaml: (line) => { void this.albumHeaderJumpYaml(sourcePath, line); },
      },
      state,
    };
  }

  albumHeaderModelFor(sourcePath, state, sourceText) {
    try {
      const current = state || this.albumHeaderState();
      const report = current?.report || null;
      return albumHeaderModel(report, sourcePath, {
        sourceText,
        sourcePath,
        metadataCache: this.app?.metadataCache,
        vault: this.app?.vault,
      });
    } catch (_) {
      return null;
    }
  }

  async albumHeaderCopyCapture(model) {
    const value = String(model?.captureText || "");
    if (!value) return { ok: false, reason: model?.routeReason || "The capture route is unavailable." };
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
      try { new Notice("Could not copy the album capture route."); } catch (_) {}
      return { ok: false, reason: "clipboard write failed" };
    }
  }

  async albumHeaderOpenPath(path, sourcePath) {
    const target = albumHeaderPath(path);
    if (!target) return { ok: false };
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(target.replace(/\.md$/i, ""), sourcePath || "", false);
        return { ok: true };
      }
    } catch (_) {}
    try { new Notice("Could not open the album owner."); } catch (_) {}
    return { ok: false };
  }

  albumHeaderMarkdownLeaf(path) {
    const target = albumHeaderPath(path);
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      return leaves.find((leaf) => albumHeaderPath(leaf?.view?.file?.path) === target)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
    } catch (_) {
      return null;
    }
  }

  async albumHeaderJumpYaml(sourcePath, line) {
    const path = albumHeaderPath(sourcePath);
    if (!path) return { ok: false, reason: "missing path" };
    const targetLine = Number.isInteger(line) && line > 0 ? line : albumHeaderYamlLine(
      this.albumHeaderModelFor(path),
      { line },
    );
    try {
      this.albumSchemaCardModal?.close?.();
    } catch (_) {}
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaf = this.albumHeaderMarkdownLeaf(path);
      let excursionViewState = null;
      let excursionSelectedKey = "stats";
      let excursionFingerprint = "";
      try {
        excursionViewState = typeof leaf?.getViewState === "function" ? leaf.getViewState() : null;
        excursionSelectedKey = String(this.albumSchemaCardModal?.selectedKey || "stats");
        excursionFingerprint = String(this.albumSchemaCardModal?.schemaModel?.schemaFingerprint || this.albumHeaderModelFor(path)?.schemaFingerprint || "");
      } catch (_) {}
      if (leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(file, { state: { mode: "source" } });
      } else if (leaf && typeof leaf.setViewState === "function") {
        const current = typeof leaf.getViewState === "function" ? leaf.getViewState() : { type: "markdown", state: {} };
        const next = {
          ...(current || {}),
          type: "markdown",
          state: { ...((current && current.state) || {}), mode: "source", file: path },
        };
        await leaf.setViewState(next);
      } else if (this.app?.workspace?.openLinkText) {
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), path, false);
      }
      const editor = leaf?.view?.editor;
      const cursorLine = Number.isInteger(targetLine) && targetLine > 0 ? targetLine - 1 : 0;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      try {
        if (leaf && typeof this.albumYamlExcursionBegin === "function") {
          this.albumYamlExcursionBegin(leaf, { albumPath: path, viewState: excursionViewState, selectedKey: excursionSelectedKey, fingerprint: excursionFingerprint });
        }
      } catch (_) {}
      return { ok: true, line: cursorLine + 1 };
    } catch (_) {
      try { new Notice("Could not open the album schema in Source mode."); } catch (__) {}
      return { ok: false, reason: "source jump failed" };
    }
  }

  albumHeaderReadingRoot(el) {
    try {
      if (!el || el.closest?.(".cm-editor")) return null;
      const attached = el.closest?.(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed, .internal-embed");
      if (!attached) return null;
      const root = typeof notebookHeaderReadingSurface === "function"
        ? notebookHeaderReadingSurface(el)
        : attached;
      // Calls on the preview and its sizer must share the same identity.
      if (root.matches?.(".markdown-preview-view")) {
        const sizer = root.querySelector?.(".markdown-preview-sizer");
        if (sizer?.closest?.(".markdown-preview-view") === root
          && sizer.closest?.(".markdown-embed, .internal-embed") === root.closest?.(".markdown-embed, .internal-embed")) return sizer;
      }
      return root;
    } catch (_) {
      return null;
    }
  }

  albumHeaderReadingScope(root) {
    try {
      const embed = root?.closest?.(".markdown-embed, .internal-embed");
      if (embed) return embed;
      return root?.closest?.(".markdown-preview-view") || root;
    } catch (_) {
      return root;
    }
  }

  albumHeaderNodeBelongs(node, root) {
    if (!node || !root) return false;
    try {
      if (node.getAttribute?.("data-cm-widget") === "true" || node.closest?.(".cm-widgetBuffer, .cm-content")) return false;
      const nested = node.closest?.(".markdown-embed, .internal-embed");
      const ownedEmbed = root.closest?.(".markdown-embed, .internal-embed");
      if (nested && nested !== root && nested !== ownedEmbed) return false;
      return typeof root.contains === "function" ? root.contains(node) : true;
    } catch (_) {
      return false;
    }
  }

  albumHeaderRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])) {
      if (!this.albumHeaderNodeBelongs(node, root)) continue;
      const ownedPath = albumHeaderPath(node.getAttribute?.("data-album-source") || "");
      if (sourcePath && ownedPath && ownedPath !== albumHeaderPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    const anotherOwner = Array.from(this.albumHeaderReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
  }

  albumHeaderBuildEl(model, options, doc) {
    try {
      const header = notebookCreateEl(doc, "section", ALBUM_HEADER_CLASS);
      if (!header) return null;
      header.setAttribute?.("data-album-header", "true");
      header.setAttribute?.("data-album-source", model.path);
      header.setAttribute?.("aria-label", `${model.title} album details`);
      if (options?.hue) header.setAttribute?.("data-root-hue", options.hue);

      const nav = notebookCreateEl(doc, "nav", "bob-album-header-nav");
      nav.setAttribute?.("aria-label", "Album location");
      const crumbs = Array.isArray(model.crumbs) ? model.crumbs : [];
      crumbs.forEach((crumb, index) => {
        if (index > 0) nav.appendChild(doc.createTextNode(" › "));
        const current = crumb.current === true;
        const resolved = albumHeaderPath(crumb.path);
        const node = !current && resolved && doc?.createElement ? doc.createElement("a") : doc?.createElement?.("span");
        if (!node) return;
        if (!current && resolved) {
          node.setAttribute("class", `internal-link ${ALBUM_HEADER_CRUMB_CLASS}`);
          node.setAttribute("data-href", resolved);
          node.setAttribute("href", resolved);
          const open = () => options?.handlers?.openPath?.(resolved);
          if (typeof notebookBindAction === "function") notebookBindAction(node, open);
          else node.addEventListener?.("click", (event) => { event.preventDefault?.(); open(); });
        } else {
          node.setAttribute("class", `${ALBUM_HEADER_CRUMB_CLASS} bob-album-header-current`);
          node.setAttribute("aria-current", "page");
        }
        notebookSetText(node, crumb.title || crumb.stem || "");
        nav.appendChild(node);
      });
      header.appendChild(nav);

      if (model.ancestryMessage) {
        const note = notebookCreateEl(doc, "p", "bob-album-header-ancestry-note");
        notebookSetText(note, model.ancestryMessage);
        note.setAttribute?.("role", "note");
        header.appendChild(note);
      }

      const actionRow = notebookCreateEl(doc, "div", "bob-album-header-actions");
      const copy = notebookCreateEl(doc, "button", "bob-album-header-copy");
      copy.setAttribute?.("type", "button");
      copy.setAttribute?.("data-album-header-focus", "copy");
      const disabledReason = model.routeReason || "";
      copy.disabled = Boolean(disabledReason);
      copy.setAttribute?.("aria-disabled", copy.disabled ? "true" : "false");
      copy.setAttribute?.("title", disabledReason || `Copy ${model.captureText}`);
      copy.setAttribute?.("aria-label", disabledReason
        ? `Copy capture route unavailable: ${disabledReason}`
        : `Copy ${model.captureLabel} capture route`);
      notebookSetText(copy, disabledReason ? `＋ ${model.captureLabel || "record"}` : `＋ ${model.captureLabel}`);
      copy.addEventListener?.("click", (event) => {
        event.preventDefault?.();
        if (!copy.disabled) options?.handlers?.copyCapture?.(model);
      });
      actionRow.appendChild(copy);
      if (options?.desktop !== false) {
        const schema = notebookCreateEl(doc, "button", "bob-album-header-schema");
        schema.setAttribute?.("type", "button");
        schema.setAttribute?.("data-album-header-focus", "schema");
        schema.setAttribute?.("aria-label", "Open schema card");
        notebookSetText(schema, "⊞ Schema");
        schema.addEventListener?.("click", (event) => {
          event.preventDefault?.();
          options?.handlers?.openSchemaCard?.(model);
        });
        actionRow.appendChild(schema);
      }
      header.appendChild(actionRow);
      albumSchemaHeaderAppend(header, model, options, doc);
      return header;
    } catch (_) {
      return null;
    }
  }

  albumHeaderReadingAnchor(root) {
    try {
      const h1 = Array.from(root?.querySelectorAll?.("h1") || [])
        .find((node) => !notebookInsideCode(node));
      return h1 || null;
    } catch (_) {
      return null;
    }
  }

  paintAlbumHeaderReading(el, sourcePath, state) {
    const root = this.albumHeaderReadingRoot(el);
    const scope = this.albumHeaderReadingScope(root);
    if (!root || !sourcePath) return null;
    // Remove old reading chrome stranded in editor callout chunks, while
    // leaving the legitimate CodeMirror decoration and other sources alone.
    this.albumHeaderRemoveStrays(root, sourcePath);
    const model = this.albumHeaderModelFor(sourcePath, state);
    const doc = notebookDomDoc(root) || (typeof document !== "undefined" ? document : null);
    const old = Array.from(root.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])
      .find((node) => this.albumHeaderNodeBelongs(node, root));
    const active = doc?.activeElement;
    const focusKey = active && old?.contains?.(active)
      ? active.getAttribute?.("data-album-header-focus") : "";
    this.albumHeaderRemoveReading(root, scope, sourcePath);
    if (!model) return null;

    scope?.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS);
    const header = this.albumHeaderBuildEl(model, this.albumHeaderOptions(sourcePath, state, model), doc);
    if (!header) {
      scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
      return null;
    }
    const anchor = this.albumHeaderReadingAnchor(root);
    if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
    else if (root.insertBefore) root.insertBefore(header, root.firstChild || null);
    else root.prepend?.(header);
    if (focusKey) {
      const next = header.querySelector?.(`[data-album-header-focus="${focusKey}"]`);
      next?.focus?.({ preventScroll: true });
    }
    return header;
  }

  albumHeaderRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") === "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (albumHeaderPath(node.getAttribute?.("data-album-source")) !== albumHeaderPath(sourcePath)) continue;
      node.remove?.();
    }
  }

  renderAlbumHeaderInReading(el, ctx) {
    if (!this.albumHeaderActive || !el || !ctx?.sourcePath || notebookInsideCode(el)) return;
    if (el.closest?.(".cm-editor")) return;
    if (!(this.albumHeaderReadingPending instanceof Map)) this.albumHeaderReadingPending = new Map();
    if (!(this.albumHeaderReadingTimers instanceof Map)) this.albumHeaderReadingTimers = new Map();
    const path = ctx.sourcePath;
    const batch = this.albumHeaderReadingPending.get(path) || [];
    batch.push({ el, ctx });
    this.albumHeaderReadingPending.set(path, batch);
    this.albumClearTimeout(this.albumHeaderReadingTimers.get(path));
    this.albumHeaderReadingTimers.set(path, this.albumSetTimeout(() => {
      this.albumHeaderReadingTimers.delete(path);
      const pending = this.albumHeaderReadingPending.get(path) || [];
      this.albumHeaderReadingPending.delete(path);
      if (!this.albumHeaderActive) return;
      const surfaces = new Set();
      for (const item of pending) {
        const root = this.albumHeaderReadingRoot(item.el);
        // Keep detached elements registered for late attachment, but never
        // paint into them. Separate panes/embeds each own one surface.
        const key = root || item.el;
        if (surfaces.has(key)) continue;
        surfaces.add(key);
        this.albumHeaderBindReading(item.el, item.ctx, root);
      }
      this.refreshAlbumHeaderReading();
    }, 0));
  }

  albumHeaderBindReading(el, ctx, root) {
    let widget = Array.from(this.albumHeaderReading || []).find((item) =>
      item.el === el || (root && item.surface === root));
    if (!widget) {
      widget = { el, path: ctx.sourcePath, surface: root, scope: this.albumHeaderReadingScope(root) };
      this.albumHeaderReading.add(widget);
    } else if (widget.path !== ctx.sourcePath) {
      this.albumHeaderRemoveReading(widget.surface, widget.scope, widget.path);
    }
    widget.el = el;
    widget.path = ctx.sourcePath;
    // Rebinding makes an earlier chunk's unload harmless after rerender.
    const binding = {};
    widget.binding = binding;
    const child = typeof MarkdownRenderChild === "function"
      ? new MarkdownRenderChild(el) : {};
    child.onunload = () => {
      if (widget.binding !== binding) return;
      this.albumHeaderReading?.delete(widget);
      const anotherOwner = Array.from(this.albumHeaderReading || []).some((item) =>
        item.surface === widget.surface && item.path === widget.path);
      if (!anotherOwner) this.albumHeaderRemoveReading(widget.surface, widget.scope, widget.path);
    };
    try { ctx.addChild?.(child); } catch (_) {}
  }

  refreshAlbumHeaderReading() {
    // Re-resolve every binding before painting: a later detached binding
    // must not erase a surface already repainted by an earlier one.
    for (const widget of this.albumHeaderReading || []) {
      try {
        const root = this.albumHeaderReadingRoot(widget.el);
        if (widget.surface && widget.surface !== root) {
          this.albumHeaderRemoveReading(widget.surface, widget.scope, widget.path);
        }
        widget.surface = root;
        widget.scope = this.albumHeaderReadingScope(root);
        if (!root) this.albumHeaderRemoveStrays(widget.el, widget.path);
      } catch (_) {}
    }
    const painted = new Set();
    for (const widget of this.albumHeaderReading || []) {
      if (!widget.surface || painted.has(widget.surface)) continue;
      painted.add(widget.surface);
      try { this.paintAlbumHeaderReading(widget.el, widget.path); } catch (_) {}
    }
  }

  albumHeaderLivePath(view) {
    try {
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) {
      return null;
    }
  }

  buildAlbumHeaderDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const path = this.albumHeaderLivePath(view);
      if (!path || !view?.state?.doc) {
        this.albumHeaderSetEditorScope(view, false);
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      const state = this.albumHeaderState();
      const model = this.albumHeaderModelFor(path, state, text);
      this.albumHeaderSetEditorScope(view, Boolean(model));
      if (!model) return Decoration.none;
      const doc = notebookDomDoc(view.dom) || (typeof document !== "undefined" ? document : null);
      const options = this.albumHeaderOptions(path, state, model);
      const header = this.albumHeaderBuildEl(model, options, doc);
      if (!header) return Decoration.none;
      const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
      const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
      const widget = new class extends WidgetType {
        constructor() {
          super();
          this.path = path;
          this.signature = albumHeaderSignature(model, {
            expanded: options.expanded,
            desktop: options.desktop,
          });
        }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          header.setAttribute?.("data-cm-widget", "true");
          header.setAttribute?.("data-album-source", path);
          return header;
        }
      }();
      let at = 0;
      let side = 1;
      if (anchor >= 0) {
        at = view.state.doc.line(anchor + 1).to;
      } else if (frontmatterEnd >= 0) {
        const nextLine = frontmatterEnd + 2;
        at = nextLine <= (view.state.doc.lines || 0)
          ? view.state.doc.line(nextLine).from
          : (view.state.doc.length || 0);
        side = 1;
      }
      const builder = new RangeSetBuilder();
      builder.add(at, at, Decoration.widget({ widget, side }));
      return builder.finish();
    } catch (_) {
      return Decoration?.none || null;
    }
  }

  albumHeaderSetEditorScope(view, enabled) {
    const root = view?.dom;
    if (!root) return;
    if (!(this.albumHeaderEditorScopes instanceof Map)) this.albumHeaderEditorScopes = new Map();
    let scope = root;
    try {
      scope = root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
    } catch (_) {}
    const previous = this.albumHeaderEditorScopes?.get(view);
    if (previous && previous !== scope) previous.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
    if (enabled) scope.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS);
    else scope.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
    if (enabled) this.albumHeaderEditorScopes?.set(view, scope);
    else this.albumHeaderEditorScopes?.delete(view);
    if (enabled) this.albumHeaderEditors?.add(view);
    else this.albumHeaderEditors?.delete(view);
  }

  albumHeaderCleanEditor(view) {
    try {
      const scope = this.albumHeaderEditorScopes?.get(view) || view?.dom;
      scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
      this.albumHeaderEditorScopes?.delete(view);
    } catch (_) {}
    this.albumHeaderEditors?.delete(view);
  }

  createAlbumHeaderExtension() {
    try {
      if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
      if (!editorInfoField || !editorLivePreviewField) return null;
      const plugin = this;
      const HeaderPlugin = class {
        constructor(view) {
          this.view = view;
          this.path = plugin.albumHeaderLivePath(view);
          this.decorations = plugin.buildAlbumHeaderDecorations(view);
          plugin.albumHeaderEditors?.add(view);
        }
        update(update) {
          const path = plugin.albumHeaderLivePath(update.view);
          const rebuild = path !== this.path || update.docChanged || update.viewportChanged
            || (update.transactions || []).some((tx) => (tx.effects || []).some((effect) =>
              effect.is?.(ensureAlbumHeaderRefresh())));
          this.path = path;
          if (rebuild) this.decorations = plugin.buildAlbumHeaderDecorations(update.view);
        }
        destroy() { plugin.albumHeaderCleanEditor(this.view); }
      };
      return Prec?.highest ? Prec.highest(ViewPlugin.fromClass(HeaderPlugin, {
        decorations: (value) => value.decorations,
      })) : ViewPlugin.fromClass(HeaderPlugin, { decorations: (value) => value.decorations });
    } catch (_) {
      return null;
    }
  }

  refreshAlbumHeaderEditors() {
    try {
      const effect = ensureAlbumHeaderRefresh();
      for (const leaf of this.app?.workspace?.getLeavesOfType?.("markdown") || []) {
        const view = leaf?.view?.editor?.cm;
        if (!view) continue;
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
        else this.buildAlbumHeaderDecorations(view);
      }
    } catch (_) {}
  }

  scheduleAlbumHeaderRefresh() {
    if (!this.albumHeaderActive || this.albumHeaderRefreshTimer != null) return;
    this.albumHeaderRefreshTimer = this.albumSetTimeout(() => {
      this.albumHeaderRefreshTimer = null;
      if (!this.albumHeaderActive) return;
      this.refreshAlbumHeaderReading();
      this.refreshAlbumHeaderEditors();
    }, 100);
  }
}
