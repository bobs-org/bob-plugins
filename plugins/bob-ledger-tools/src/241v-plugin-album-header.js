// Report-driven album headers in Reading view and Live Preview. The only
// editor decorations are widgets; no Markdown or frontmatter is rewritten.
class BobLedgerToolsAlbumHeaderMixin {
  albumPropertyCardHost() {
    if (this._albumPropertyCardHost) return this._albumPropertyCardHost;
    const plugin = this;
    this._albumPropertyCardHost = createPropertyCardHost({
      plugin,
      kind: "album",
      readingPriority: 49,
      allowEmbedDisplay: true,
      fields: {
        active: "albumHeaderActive",
        reading: "albumHeaderReading",
        readingPending: "albumHeaderReadingPending",
        readingTimers: "albumHeaderReadingTimers",
        editors: "albumHeaderEditors",
        editorScopes: "albumHeaderEditorScopes",
        refreshTimer: "albumHeaderRefreshTimer",
        keySlots: "albumHeaderKeySlots",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout?.(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout?.(id),
      pathOf: albumHeaderPath,
      readingRoot: (el) => plugin.albumHeaderReadingRoot(el),
      readingScope: (root) => plugin.albumHeaderReadingScope(root),
      acceptReading: (el, ctx) => Boolean(el && ctx?.sourcePath && !notebookInsideCode(el)),
      paintReading: (el, path) => plugin.paintAlbumHeaderReading(el, path),
      removeReading: (root, scope, path) => plugin.albumHeaderRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.albumHeaderRemoveStrays(widget.el, widget.path);
      },
      livePath: (view) => plugin.albumHeaderLivePath(view),
      buildDecorations: (view) => plugin.buildAlbumHeaderDecorations(view),
      cleanEditor: (view) => plugin.albumHeaderCleanEditor(view),
      ownKeys: (scope, path) => plugin.albumHeaderOwnKeys(scope, path),
      releaseKeys: (scope, path) => plugin.albumHeaderReleaseKeys(scope, path),
      onSetup: () => {
        if (!(plugin.albumHeaderExpanded instanceof Map)) plugin.albumHeaderExpanded = new Map();
        plugin.albumHeaderUnsubscribe = plugin.apiAlbumSubscribe?.((state) => {
          plugin.albumHeaderLastState = state;
          plugin.scheduleAlbumHeaderRefresh();
        }) || null;
      },
      onDisposeStart: () => {
        plugin.albumHeaderUnsubscribe?.();
        plugin.albumHeaderUnsubscribe = null;
        try { plugin.albumSchemaCardModal?.close?.(); } catch (_) {}
        plugin.albumSchemaCardModal = null;
      },
      onDisposeEnd: () => {
        plugin.albumHeaderExpanded?.clear?.();
      },
    });
    return this._albumPropertyCardHost;
  }

  setupAlbumHeader() {
    this.albumPropertyCardHost().setup();
  }

  teardownAlbumHeader() {
    this.albumPropertyCardHost().dispose();
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
    return propertyCardReadingRoot(el);
  }

  albumHeaderReadingScope(root) {
    return propertyCardReadingScope(root);
  }

  albumHeaderNodeBelongs(node, root) {
    return propertyCardNodeBelongs(node, root);
  }

  // A sourcePath releases only that path's mount: a pane reuses its scope, so
  // a stale binding for an earlier note must not unhide the current card.
  albumHeaderReleaseKeys(scope, sourcePath = "") {
    try { propertyCardSlotRelease(this.albumHeaderKeySlots, scope, albumHeaderPath(sourcePath)); } catch (_) {}
  }

  albumHeaderOwnKeys(scope, sourcePath = "") {
    try {
      if (!(this.albumHeaderKeySlots instanceof Map)) this.albumHeaderKeySlots = new Map();
      return propertyCardSlotOwn(this.albumHeaderKeySlots, scope, albumHeaderPath(sourcePath),
        propertyCardOwnAlbumKeys(scope, this.albumHeaderDesktop?.()));
    } catch (_) { return null; }
  }

  albumHeaderRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])) {
      if (!this.albumHeaderNodeBelongs(node, root)) continue;
      const ownedPath = albumHeaderPath(node.getAttribute?.("data-album-source") || "");
      if (sourcePath && ownedPath && ownedPath !== albumHeaderPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    this.albumHeaderReleaseKeys(scope, sourcePath);
    const anotherOwner = Array.from(this.albumHeaderReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
  }

  albumHeaderBuildEl(model, options, doc) {
    try {
      const header = notebookCreateEl(doc, "section", `${ALBUM_HEADER_CLASS} bob-property-card`);
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
    let model = null;
    try {
      model = this.albumHeaderModelFor(sourcePath, state);
    } catch (_) {
      model = null;
    }
    const doc = notebookDomDoc(root) || (typeof document !== "undefined" ? document : null);
    const old = Array.from(root.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])
      .find((node) => this.albumHeaderNodeBelongs(node, root));
    const active = doc?.activeElement;
    const focusKey = active && old?.contains?.(active)
      ? active.getAttribute?.("data-album-header-focus") : "";
    this.albumHeaderRemoveReading(root, scope, sourcePath);
    if (!model) return null;

    scope?.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS);
    let header = null;
    try {
      header = this.albumHeaderBuildEl(model, this.albumHeaderOptions(sourcePath, state, model), doc);
    } catch (_) {
      header = null;
    }
    if (!header) {
      this.albumHeaderReleaseKeys(scope);
      scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
      return null;
    }
    const anchor = this.albumHeaderReadingAnchor(root);
    try {
      if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
      else if (root.insertBefore) root.insertBefore(header, root.firstChild || null);
      else root.prepend?.(header);
    } catch (_) {
      this.albumHeaderReleaseKeys(scope);
      scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
      return null;
    }
    if (focusKey) {
      const next = header.querySelector?.(`[data-album-header-focus="${focusKey}"]`);
      next?.focus?.({ preventScroll: true });
    }
    this.albumHeaderOwnKeys(scope, sourcePath);
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
    this.albumPropertyCardHost().renderInReading(el, ctx);
  }

  albumHeaderBindReading(el, ctx, root) {
    return this.albumPropertyCardHost().bindReading(el, ctx, root);
  }

  refreshAlbumHeaderReading() {
    this.albumPropertyCardHost().refreshReading();
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
        this.albumHeaderReleaseKeys(view?.dom);
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      const state = this.albumHeaderState();
      const model = this.albumHeaderModelFor(path, state, text);
      this.albumHeaderSetEditorScope(view, Boolean(model));
      if (!model) {
        this.albumHeaderReleaseKeys(view?.dom);
        return Decoration.none;
      }
      const doc = notebookDomDoc(view.dom) || (typeof document !== "undefined" ? document : null);
      const options = this.albumHeaderOptions(path, state, model);
      const header = this.albumHeaderBuildEl(model, options, doc);
      if (!header) {
        this.albumHeaderReleaseKeys(view?.dom);
        return Decoration.none;
      }
      // Native Properties live under the CodeMirror editor, not the
      // .markdown-source-view that carries the surface class.
      this.albumHeaderOwnKeys(view?.dom, path);
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
    this.albumPropertyCardHost().setEditorScope(view, enabled, {
      scopeOf: (root) => {
        try {
          return root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
        } catch (_) {
          return root;
        }
      },
      mark: (scope) => { scope?.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS); },
      unmark: (scope) => { scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS); },
    });
  }

  albumHeaderCleanEditor(view) {
    this.albumPropertyCardHost().cleanEditor(view, {
      unmark: (scope) => { scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS); },
    });
  }

  createAlbumHeaderExtension() {
    return this.albumPropertyCardHost().createExtension();
  }

  refreshAlbumHeaderEditors() {
    this.albumPropertyCardHost().refreshEditors();
  }

  scheduleAlbumHeaderRefresh() {
    this.albumPropertyCardHost().scheduleRefresh();
  }
}
