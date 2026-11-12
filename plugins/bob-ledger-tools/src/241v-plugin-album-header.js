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
    this.albumHeaderEditors = new Set();
    this.albumHeaderEditorScopes = new Map();
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
    for (const widget of this.albumHeaderReading || []) {
      this.albumHeaderRemoveReading(widget.surface, widget.scope, widget.path);
    }
    for (const view of this.albumHeaderEditors || []) this.albumHeaderCleanEditor(view);
    this.albumHeaderReading?.clear();
    this.albumHeaderEditors?.clear();
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

  albumHeaderOptions(sourcePath, state) {
    return {
      sourcePath,
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      handlers: {
        openPath: (path) => { void this.albumHeaderOpenPath(path, sourcePath); },
        copyCapture: (model) => this.albumHeaderCopyCapture(model),
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

  albumHeaderReadingRoot(el) {
    try {
      return typeof notebookHeaderReadingSurface === "function"
        ? notebookHeaderReadingSurface(el)
        : el;
    } catch (_) {
      return el;
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
      header.appendChild(actionRow);

      const card = notebookCreateEl(doc, "div", "bob-album-schema-card");
      card.setAttribute?.("aria-label", "Record schema");
      const heading = notebookCreateEl(doc, "h2", "bob-album-schema-title");
      notebookSetText(heading, "Record schema");
      card.appendChild(heading);
      if (model.emptySchema) {
        const empty = notebookCreateEl(doc, "p", "bob-album-schema-empty");
        notebookSetText(empty, "No fields are declared for this album.");
        card.appendChild(empty);
      } else {
        const list = notebookCreateEl(doc, "dl", "bob-album-schema-fields");
        for (const field of model.fields) {
          const row = notebookCreateEl(doc, "div", "bob-album-schema-field");
          const label = notebookCreateEl(doc, "dt", "bob-album-schema-label");
          notebookSetText(label, field.label);
          row.appendChild(label);
          const description = notebookCreateEl(doc, "dd", "bob-album-schema-detail");
          const kind = notebookCreateEl(doc, "span", "bob-album-schema-kind");
          notebookSetText(kind, field.kind);
          description.appendChild(kind);
          if (field.list) {
            const marker = notebookCreateEl(doc, "span", "bob-album-schema-list");
            notebookSetText(marker, "list");
            marker.setAttribute?.("aria-label", "list field");
            description.appendChild(marker);
          }
          if (field.required) {
            const required = notebookCreateEl(doc, "span", "bob-album-schema-required");
            notebookSetText(required, "required *");
            required.setAttribute?.("aria-label", "required");
            description.appendChild(required);
          }
          if (field.choices.length) {
            const choices = notebookCreateEl(doc, "span", "bob-album-schema-choices");
            notebookSetText(choices, field.choices.join(" · "));
            description.appendChild(choices);
          }
          row.appendChild(description);
          list.appendChild(row);
        }
        card.appendChild(list);
      }
      if (model.issues.length) {
        const issues = notebookCreateEl(doc, "ul", "bob-album-schema-issues");
        issues.setAttribute?.("aria-label", "Album schema issues");
        for (const issue of model.issues) {
          const item = notebookCreateEl(doc, "li", `bob-album-schema-issue is-${issue.severity}`);
          notebookSetText(item, issue.message || issue.code);
          issues.appendChild(item);
        }
        card.appendChild(issues);
      }
      header.appendChild(card);
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
    const header = this.albumHeaderBuildEl(model, this.albumHeaderOptions(sourcePath, state), doc);
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

  renderAlbumHeaderInReading(el, ctx) {
    if (!this.albumHeaderActive || !ctx?.sourcePath || notebookInsideCode(el)) return;
    if (el?.closest?.(".cm-editor")) return;
    const root = this.albumHeaderReadingRoot(el);
    const scope = this.albumHeaderReadingScope(root);
    let widget = Array.from(this.albumHeaderReading || []).find((item) => item.surface === root);
    if (!widget || widget.path !== ctx.sourcePath) {
      if (widget) this.albumHeaderRemoveReading(root, widget.scope, widget.path);
      this.paintAlbumHeaderReading(root, ctx.sourcePath);
    }
    if (!widget) {
      widget = { el, path: ctx.sourcePath, surface: root, scope };
      this.albumHeaderReading.add(widget);
      const boundPath = ctx.sourcePath;
      if (ctx.addChild) {
        const child = typeof MarkdownRenderChild === "function"
          ? new MarkdownRenderChild(el)
          : { onunload: null };
        child.onunload = () => {
          if (widget.path !== boundPath) return;
          this.albumHeaderRemoveReading(root, scope, boundPath);
          this.albumHeaderReading?.delete(widget);
        };
        try { ctx.addChild(child); } catch (_) {}
      }
    } else {
      widget.el = el;
      widget.path = ctx.sourcePath;
      widget.scope = scope;
    }
  }

  refreshAlbumHeaderReading() {
    for (const widget of this.albumHeaderReading || []) {
      try { this.paintAlbumHeaderReading(widget.surface, widget.path); } catch (_) {}
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
      const header = this.albumHeaderBuildEl(model, this.albumHeaderOptions(path, state), doc);
      if (!header) return Decoration.none;
      const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
      const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
      const widget = new class extends WidgetType {
        constructor() { super(); this.path = path; this.signature = albumHeaderSignature(model); }
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
