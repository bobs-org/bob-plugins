// Record sheet chrome in Reading view and Live Preview. Widgets never
// rewrite Markdown; Source mode keeps native YAML.
let recordSheetRefreshEffect = null;
function ensureRecordSheetRefresh() {
  if (!recordSheetRefreshEffect && StateEffect?.define) recordSheetRefreshEffect = StateEffect.define();
  return recordSheetRefreshEffect;
}

class BobLedgerToolsRecordSheetMixin {
  setupRecordSheet() {
    this.recordSheetActive = true;
    this.recordSheetReading = new Set();
    this.recordSheetReadingPending = new Map();
    this.recordSheetReadingTimers = new Map();
    this.recordSheetEditors = new Set();
    this.recordSheetEditorScopes = new Map();
    this.recordSheetEditorCache = new WeakMap();
    this.recordSheetCollapsed = new Map();
    this.recordSheetFolds = new Map();
    this.recordSheetOverlays = new Map();
    this.recordSheetOverlayTimers = new Map();
    this.recordSheetOwnedKey = "";
    this.recordSheetDomBuilds = 0;
    this.recordSheetRefreshTimer = null;
    this.recordSheetDay = typeof albumLocalDate === "function" ? albumLocalDate() : "";
    this.registerMarkdownPostProcessor?.((el, ctx) => this.renderRecordSheetInReading(el, ctx), 49);
    const extension = this.createRecordSheetExtension();
    if (extension) this.registerEditorExtension?.(extension);
    this.recordSheetUnsubscribe = this.apiAlbumSubscribe?.((state) => {
      this.recordSheetLastState = state;
      const today = state && typeof state.today === "string" ? state.today : "";
      if (today) this.recordSheetDay = today;
      this.scheduleRecordSheetRefresh();
    }) || null;
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(cache.on("changed", (file) => this.recordSheetOnMetadata(file)));
      }
    } catch (_) {}
  }

  teardownRecordSheet() {
    this.recordSheetActive = false;
    this.recordSheetUnsubscribe?.();
    this.recordSheetUnsubscribe = null;
    this.albumClearTimeout?.(this.recordSheetRefreshTimer);
    this.recordSheetRefreshTimer = null;
    for (const timer of this.recordSheetReadingTimers?.values?.() || []) this.albumClearTimeout?.(timer);
    this.recordSheetReadingTimers?.clear();
    this.recordSheetReadingPending?.clear();
    for (const widget of this.recordSheetReading || []) {
      this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
    }
    for (const view of this.recordSheetEditors || []) this.recordSheetCleanEditor(view);
    this.recordSheetReading?.clear();
    this.recordSheetEditors?.clear();
    this.recordSheetEditorScopes?.clear?.();
    this.recordSheetCollapsed?.clear?.();
    this.recordSheetFolds?.clear?.();
    for (const timer of this.recordSheetOverlayTimers?.values?.() || []) this.albumClearTimeout?.(timer);
    this.recordSheetOverlayTimers?.clear?.();
    this.recordSheetOverlays?.clear?.();
    this.recordSheetOwnedKey = "";
  }

  refreshRecordSheetForRollover(now = new Date()) {
    if (!this.recordSheetActive) return false;
    const today = typeof albumLocalDate === "function" ? albumLocalDate(now) : "";
    if (!today || today === this.recordSheetDay) return false;
    this.recordSheetDay = today;
    this.scheduleRecordSheetRefresh();
    return true;
  }

  recordSheetOnMetadata(file) {
    if (!this.recordSheetActive) return;
    const path = recordSheetPath(file && file.path);
    if (!path) return;
    if (this.recordSheetOverlayMatchesFrontmatter(path)) {
      this.recordSheetPushOverlay(path, null);
    }
    if (this.recordSheetOwnsPath(path) || this.recordSheetWatchesParent(path)) {
      this.scheduleRecordSheetRefresh();
    }
  }

  recordSheetWatchesParent(path) {
    const want = recordSheetPath(path);
    for (const widget of this.recordSheetReading || []) {
      if (recordSheetPath(widget.albumPath) === want) return true;
    }
    for (const view of this.recordSheetEditors || []) {
      const cached = this.recordSheetEditorCache?.get?.(view);
      if (cached && recordSheetPath(cached.albumPath) === want) return true;
    }
    return false;
  }

  recordSheetState() {
    try {
      return typeof this.albumReportState === "function"
        ? this.albumReportState()
        : this.recordSheetLastState || null;
    } catch (_) {
      return this.recordSheetLastState || null;
    }
  }

  recordSheetDesktop() {
    return typeof albumHeaderIsDesktopPlatform === "function"
      ? albumHeaderIsDesktopPlatform()
      : false;
  }

  recordSheetFrontmatter(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      const cache = file ? this.app?.metadataCache?.getFileCache?.(file) : null;
      return cache && cache.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : null;
    } catch (_) {
      return null;
    }
  }

  recordSheetCache(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      return file ? this.app?.metadataCache?.getFileCache?.(file) : null;
    } catch (_) {
      return null;
    }
  }

  recordSheetGateFor(path) {
    const filePath = recordSheetPath(path);
    if (!filePath) return recordSheetFail("missing-path");
    return recordSheetGate({
      path: filePath,
      frontmatter: this.recordSheetFrontmatter(filePath),
      report: this.recordSheetState()?.report || null,
      desktop: this.recordSheetDesktop(),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
    });
  }

  recordSheetOwnsPath(path) {
    if (!this.recordSheetActive) return false;
    try {
      return this.recordSheetGateFor(path)?.mount === true;
    } catch (_) {
      return false;
    }
  }

  recordSheetIsCollapsed(path) {
    const key = recordSheetPath(path);
    const map = this.recordSheetCollapsed instanceof Map ? this.recordSheetCollapsed : new Map();
    this.recordSheetCollapsed = map;
    return key && map.has(key) ? map.get(key) === true : false;
  }

  recordSheetSetCollapsed(path, collapsed) {
    const key = recordSheetPath(path);
    if (key) this.recordSheetCollapsed.set(key, collapsed === true);
    this.scheduleRecordSheetRefresh();
  }

  recordSheetFoldOpen(path) {
    const key = recordSheetPath(path);
    const map = this.recordSheetFolds instanceof Map ? this.recordSheetFolds : new Map();
    this.recordSheetFolds = map;
    return key && map.has(key) ? map.get(key) === true : false;
  }

  recordSheetSetFold(path, open) {
    const key = recordSheetPath(path);
    if (key) this.recordSheetFolds.set(key, open === true);
    this.scheduleRecordSheetRefresh();
  }

  refreshRecordSheetOverlay(path, overlay) {
    const key = recordSheetPath(path);
    if (!key) return;
    if (!(this.recordSheetOverlays instanceof Map)) this.recordSheetOverlays = new Map();
    if (overlay) this.recordSheetOverlays.set(key, overlay);
    else this.recordSheetOverlays.delete(key);
    this.scheduleRecordSheetRefresh();
  }

  recordSheetPushOverlay(path, overlay, options = {}) {
    const key = recordSheetPath(path);
    if (!key) return null;
    if (!(this.recordSheetOverlayTimers instanceof Map)) this.recordSheetOverlayTimers = new Map();
    this.albumClearTimeout?.(this.recordSheetOverlayTimers.get(key));
    this.recordSheetOverlayTimers.delete(key);
    this.refreshRecordSheetOverlay(key, overlay || null);
    if (!overlay) return null;
    const ttl = Number.isFinite(options.ttlMs) && options.ttlMs >= 0
      ? options.ttlMs
      : RECORD_SHEET_OVERLAY_TTL_MS;
    if (ttl === 0) return overlay;
    const token = overlay;
    const timer = this.albumSetTimeout?.(() => {
      this.recordSheetOverlayTimers?.delete(key);
      if (this.recordSheetOverlays?.get?.(key) === token) {
        this.refreshRecordSheetOverlay(key, null);
      }
    }, ttl);
    if (timer !== undefined && timer !== null) this.recordSheetOverlayTimers.set(key, timer);
    return overlay;
  }

  recordSheetOverlayMatchesFrontmatter(path) {
    const key = recordSheetPath(path);
    const overlay = this.recordSheetOverlays?.get?.(key);
    if (!overlay || !overlay.properties || typeof overlay.properties !== "object") return false;
    const frontmatter = this.recordSheetFrontmatter(key) || {};
    const keys = new Set([
      ...Object.keys(overlay.properties),
      ...(Array.isArray(overlay.unsetKeys) ? overlay.unsetKeys.filter((item) => typeof item === "string") : []),
    ]);
    for (const propKey of keys) {
      const expected = Object.prototype.hasOwnProperty.call(overlay.properties, propKey)
        ? overlay.properties[propKey]
        : null;
      const actual = Object.prototype.hasOwnProperty.call(frontmatter, propKey) ? frontmatter[propKey] : null;
      const want = expected === undefined ? null : expected;
      const have = actual === undefined ? null : actual;
      if (JSON.stringify(want) !== JSON.stringify(have)) return false;
    }
    return keys.size > 0;
  }

  recordSheetHue(path) {
    try {
      return typeof notebookHostHueName === "function"
        ? notebookHostHueName(path, this.app?.metadataCache, this.app?.vault)
        : "";
    } catch (_) {
      return "";
    }
  }

  recordSheetSubscription(path) {
    if (typeof bankSubscriptionIsRecordPath === "function" && !bankSubscriptionIsRecordPath(path)) return null;
    if (typeof bankSubscriptionHeaderModel !== "function") return null;
    try { this.ensureSubscriptionSurfacesSubscribe?.(); } catch (_) {}
    try {
      return bankSubscriptionHeaderModel(this.subscriptionSurfacesReport, path);
    } catch (_) {
      return null;
    }
  }

  recordSheetNotifyOwnership() {
    const owned = new Set();
    for (const widget of this.recordSheetReading || []) {
      const path = recordSheetPath(widget.path);
      if (path && this.recordSheetOwnsPath(path)) owned.add(path);
    }
    for (const view of this.recordSheetEditors || []) {
      const cached = this.recordSheetEditorCache?.get?.(view);
      const path = recordSheetPath(cached?.path || this.recordSheetLivePath(view));
      if (path && this.recordSheetOwnsPath(path)) owned.add(path);
    }
    const next = [...owned].sort().join("\0");
    if (next === this.recordSheetOwnedKey) return;
    this.recordSheetOwnedKey = next;
    this.scheduleSubscriptionSurfacesRefresh?.();
  }

  recordSheetModelFor(path, sourceText) {
    const gate = this.recordSheetGateFor(path);
    if (!gate.mount) return null;
    const cache = this.recordSheetCache(path);
    const heading = sourceText
      ? recordSheetFirstHeading(sourceText)
      : recordSheetHeadingFromCache(cache);
    return recordSheetModel({
      path,
      frontmatter: this.recordSheetFrontmatter(path) || {},
      report: this.recordSheetState()?.report || null,
      heading,
      clock: { now: new Date(), today: this.recordSheetDay || undefined },
      overlay: this.recordSheetOverlays?.get?.(recordSheetPath(path)) || null,
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      collapsed: this.recordSheetIsCollapsed(path),
      foldOpen: this.recordSheetFoldOpen(path),
      hue: this.recordSheetHue(path),
      subscription: this.recordSheetSubscription(path),
      gate,
    });
  }

  recordSheetOptions(path, model) {
    return {
      sourcePath: path,
      hue: model?.hue || this.recordSheetHue(path),
      handlers: {
        openPath: (target, event) => { void this.recordSheetOpenPath(target, path, event); },
        hoverLink: (event, targetEl, linktext) => this.recordSheetHoverLink(event, targetEl, linktext, path),
        toggleCollapsed: (next) => this.recordSheetSetCollapsed(path, next),
        toggleFold: (next) => this.recordSheetSetFold(path, next),
        jumpYaml: (key) => { void this.recordSheetJumpYaml(path, key); },
        jumpAlbumYaml: (line) => { void this.recordSheetJumpAlbumYaml(model?.albumPath, line); },
      },
    };
  }

  async recordSheetOpenPath(target, sourcePath, event) {
    const path = recordSheetPath(target);
    if (!path) return { ok: false };
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const newLeaf = Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey);
        await workspace.openLinkText(path.replace(/\.md$/i, ""), sourcePath || "", newLeaf);
        return { ok: true };
      }
    } catch (_) {}
    return { ok: false };
  }

  recordSheetHoverLink(event, targetEl, linktext, sourcePath) {
    try {
      this.app?.workspace?.trigger?.("hover-link", {
        event,
        source: "bob-record-sheet",
        hoverParent: targetEl,
        targetEl,
        linktext: String(linktext || ""),
        sourcePath: String(sourcePath || ""),
      });
    } catch (_) {}
  }

  recordSheetMarkdownLeaf(path) {
    const target = recordSheetPath(path);
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      return leaves.find((leaf) => recordSheetPath(leaf?.view?.file?.path) === target)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
    } catch (_) {
      return null;
    }
  }

  async recordSheetReadSource(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      if (file && this.app?.vault && typeof this.app.vault.read === "function") {
        return await this.app.vault.read(file);
      }
    } catch (_) {}
    try {
      const adapter = this.app?.vault?.adapter;
      if (adapter && typeof adapter.read === "function") return await adapter.read(path);
    } catch (_) {}
    return "";
  }

  async recordSheetJumpYaml(recordPath, key) {
    const path = recordSheetPath(recordPath);
    if (!path) return { ok: false, reason: "missing path" };
    let line = 1;
    try {
      const source = await this.recordSheetReadSource(path);
      line = recordSheetYamlKeyLine(source, key);
    } catch (_) {
      line = 1;
    }
    return this.recordSheetOpenSource(path, line);
  }

  async recordSheetJumpAlbumYaml(albumPath, line) {
    const path = recordSheetPath(albumPath);
    if (!path) return { ok: false, reason: "missing path" };
    const targetLine = Number.isInteger(line) && line > 0 ? line : 1;
    return this.recordSheetOpenSource(path, targetLine);
  }

  async recordSheetOpenSource(path, line) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaf = this.recordSheetMarkdownLeaf(path);
      if (leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(file, { state: { mode: "source" } });
      } else if (leaf && typeof leaf.setViewState === "function") {
        const current = typeof leaf.getViewState === "function" ? leaf.getViewState() : { type: "markdown", state: {} };
        await leaf.setViewState({
          ...(current || {}),
          type: "markdown",
          state: { ...((current && current.state) || {}), mode: "source", file: path },
        });
      } else if (this.app?.workspace?.openLinkText) {
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), path, false);
      }
      const editor = leaf?.view?.editor;
      const cursorLine = Number.isInteger(line) && line > 0 ? line - 1 : 0;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      return { ok: true, line: cursorLine + 1 };
    } catch (_) {
      return { ok: false, reason: "source jump failed" };
    }
  }

  recordSheetReadingRoot(el) {
    return this.albumHeaderReadingRoot?.(el) || null;
  }

  recordSheetReadingScope(root) {
    return this.albumHeaderReadingScope?.(root) || root;
  }

  recordSheetNodeBelongs(node, root) {
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

  recordSheetRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll?.(`.${RECORD_SHEET_CLASS}`) || [])) {
      if (!this.recordSheetNodeBelongs(node, root)) continue;
      const ownedPath = recordSheetPath(node.getAttribute?.("data-record-source") || "");
      if (sourcePath && ownedPath && ownedPath !== recordSheetPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    const anotherOwner = Array.from(this.recordSheetReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
    scope?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    root?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
  }

  recordSheetRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${RECORD_SHEET_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") === "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (recordSheetPath(node.getAttribute?.("data-record-source")) !== recordSheetPath(sourcePath)) continue;
      node.remove?.();
    }
  }

  recordSheetBuildMounted(model, options, doc) {
    this.recordSheetDomBuilds = (this.recordSheetDomBuilds || 0) + 1;
    const sheet = recordSheetBuildEl(model, options, doc);
    if (sheet) recordSheetAppendSubscriptionBand(sheet, model, options);
    return sheet;
  }

  paintRecordSheetReading(el, sourcePath) {
    const root = this.recordSheetReadingRoot(el);
    const scope = this.recordSheetReadingScope(root);
    if (!root || !sourcePath) return null;
    this.recordSheetRemoveStrays(root, sourcePath);
    const model = this.recordSheetModelFor(sourcePath);
    const doc = recordSheetDomDoc(root) || (typeof document !== "undefined" ? document : null);
    const old = Array.from(root.querySelectorAll?.(`.${RECORD_SHEET_CLASS}`) || [])
      .find((node) => this.recordSheetNodeBelongs(node, root));
    const active = doc?.activeElement;
    const focusKey = active && old?.contains?.(active)
      ? active.getAttribute?.("data-record-sheet-focus") : "";
    this.recordSheetRemoveReading(root, scope, sourcePath);
    if (!model) {
      this.recordSheetNotifyOwnership();
      return null;
    }
    scope?.classList?.add?.(RECORD_SHEET_SURFACE_CLASS);
    const sheet = this.recordSheetBuildMounted(model, this.recordSheetOptions(sourcePath, model), doc);
    if (!sheet) {
      scope?.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
      return null;
    }
    const anchor = this.albumHeaderReadingAnchor?.(root);
    if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(sheet, anchor.nextSibling || null);
    else if (root.insertBefore) root.insertBefore(sheet, root.firstChild || null);
    else root.prepend?.(sheet);
    if (focusKey) {
      const next = sheet.querySelector?.(`[data-record-sheet-focus="${focusKey}"]`);
      next?.focus?.({ preventScroll: true });
    }
    this.recordSheetNotifyOwnership();
    return sheet;
  }

  renderRecordSheetInReading(el, ctx) {
    if (!this.recordSheetActive || !el || !ctx?.sourcePath || notebookInsideCode(el)) return;
    if (el.closest?.(".cm-editor")) return;
    if (!(this.recordSheetReadingPending instanceof Map)) this.recordSheetReadingPending = new Map();
    if (!(this.recordSheetReadingTimers instanceof Map)) this.recordSheetReadingTimers = new Map();
    const path = ctx.sourcePath;
    const batch = this.recordSheetReadingPending.get(path) || [];
    batch.push({ el, ctx });
    this.recordSheetReadingPending.set(path, batch);
    this.albumClearTimeout(this.recordSheetReadingTimers.get(path));
    this.recordSheetReadingTimers.set(path, this.albumSetTimeout(() => {
      this.recordSheetReadingTimers.delete(path);
      const pending = this.recordSheetReadingPending.get(path) || [];
      this.recordSheetReadingPending.delete(path);
      if (!this.recordSheetActive) return;
      const surfaces = new Set();
      for (const item of pending) {
        const root = this.recordSheetReadingRoot(item.el);
        const key = root || item.el;
        if (surfaces.has(key)) continue;
        surfaces.add(key);
        this.recordSheetBindReading(item.el, item.ctx, root);
      }
      this.refreshRecordSheetReading();
    }, 0));
  }

  recordSheetBindReading(el, ctx, root) {
    let widget = Array.from(this.recordSheetReading || []).find((item) =>
      item.el === el || (root && item.surface === root));
    if (!widget) {
      widget = { el, path: ctx.sourcePath, surface: root, scope: this.recordSheetReadingScope(root) };
      this.recordSheetReading.add(widget);
    } else if (widget.path !== ctx.sourcePath) {
      this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
    }
    widget.el = el;
    widget.path = ctx.sourcePath;
    widget.albumPath = this.recordSheetGateFor(ctx.sourcePath)?.albumPath || "";
    const binding = {};
    widget.binding = binding;
    const child = typeof MarkdownRenderChild === "function"
      ? new MarkdownRenderChild(el) : {};
    child.onunload = () => {
      if (!this.recordSheetActive) return;
      if (widget.binding !== binding) return;
      this.recordSheetReading?.delete(widget);
      const anotherOwner = Array.from(this.recordSheetReading || []).some((item) =>
        item.surface === widget.surface && item.path === widget.path);
      if (!anotherOwner) this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
      this.recordSheetNotifyOwnership();
    };
    try { ctx.addChild?.(child); } catch (_) {}
  }

  refreshRecordSheetReading() {
    if (!this.recordSheetActive) return;
    for (const widget of this.recordSheetReading || []) {
      try {
        const root = this.recordSheetReadingRoot(widget.el);
        if (widget.surface && widget.surface !== root) {
          this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
        }
        widget.surface = root;
        widget.scope = this.recordSheetReadingScope(root);
        if (!root) this.recordSheetRemoveStrays(widget.el, widget.path);
      } catch (_) {}
    }
    const painted = new Set();
    for (const widget of this.recordSheetReading || []) {
      if (!widget.surface || painted.has(widget.surface)) continue;
      painted.add(widget.surface);
      try { this.paintRecordSheetReading(widget.el, widget.path); } catch (_) {}
    }
  }

  recordSheetLivePath(view) {
    try {
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) {
      return null;
    }
  }

  recordSheetLivePreview(view) {
    try {
      if (editorLivePreviewField && view?.state?.field) {
        return view.state.field(editorLivePreviewField) === true;
      }
    } catch (_) {}
    return false;
  }

  recordSheetAnchor(view, text) {
    const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
    const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
    let at = 0;
    if (anchor >= 0) {
      at = view.state.doc.line(anchor + 1).to;
    } else if (frontmatterEnd >= 0) {
      const nextLine = frontmatterEnd + 2;
      at = nextLine <= (view.state.doc.lines || 0)
        ? view.state.doc.line(nextLine).from
        : (view.state.doc.length || 0);
    }
    return at;
  }

  buildRecordSheetDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const live = this.recordSheetLivePreview(view);
      const path = live ? this.recordSheetLivePath(view) : null;
      if (!path || !view?.state?.doc) {
        this.recordSheetSetEditorScope(view, false);
        this.recordSheetEditorCache?.delete?.(view);
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      const model = this.recordSheetModelFor(path, text);
      this.recordSheetSetEditorScope(view, Boolean(model));
      if (!model) {
        this.recordSheetEditorCache?.delete?.(view);
        this.recordSheetNotifyOwnership();
        return Decoration.none;
      }
      const at = this.recordSheetAnchor(view, text);
      const signature = recordSheetSignature(model);
      const previous = this.recordSheetEditorCache?.get?.(view);
      if (previous && previous.path === path && previous.signature === signature && previous.anchor === at) {
        return previous.decorations;
      }
      const doc = recordSheetDomDoc(view.dom) || (typeof document !== "undefined" ? document : null);
      const options = this.recordSheetOptions(path, model);
      const sheet = this.recordSheetBuildMounted(model, options, doc);
      if (!sheet) return Decoration.none;
      const widget = new class extends WidgetType {
        constructor() {
          super();
          this.path = path;
          this.signature = signature;
        }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          sheet.setAttribute?.("data-cm-widget", "true");
          sheet.setAttribute?.("data-record-source", path);
          return sheet;
        }
      }();
      const builder = new RangeSetBuilder();
      builder.add(at, at, Decoration.widget({ widget, side: 1 }));
      const decorations = builder.finish();
      this.recordSheetEditorCache?.set?.(view, {
        path,
        signature,
        anchor: at,
        decorations,
        albumPath: model.albumPath,
      });
      this.recordSheetNotifyOwnership();
      return decorations;
    } catch (_) {
      return Decoration?.none || null;
    }
  }

  recordSheetSetEditorScope(view, enabled) {
    const root = view?.dom;
    if (!root) return;
    if (!(this.recordSheetEditorScopes instanceof Map)) this.recordSheetEditorScopes = new Map();
    let scope = root;
    try {
      scope = root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
    } catch (_) {}
    const previous = this.recordSheetEditorScopes?.get(view);
    if (previous && previous !== scope) {
      previous.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
      previous.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    }
    if (enabled) scope.classList?.add?.(RECORD_SHEET_SURFACE_CLASS);
    else {
      scope.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
      scope.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    }
    if (enabled) this.recordSheetEditorScopes?.set(view, scope);
    else this.recordSheetEditorScopes?.delete(view);
    if (enabled) this.recordSheetEditors?.add(view);
    else this.recordSheetEditors?.delete(view);
  }

  recordSheetCleanEditor(view) {
    try {
      const scope = this.recordSheetEditorScopes?.get(view) || view?.dom;
      scope?.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
      scope?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
      this.recordSheetEditorScopes?.delete(view);
      this.recordSheetEditorCache?.delete?.(view);
    } catch (_) {}
    this.recordSheetEditors?.delete(view);
    this.recordSheetNotifyOwnership();
  }

  createRecordSheetExtension() {
    try {
      if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
      if (!editorInfoField || !editorLivePreviewField) return null;
      const plugin = this;
      const SheetPlugin = class {
        constructor(view) {
          this.view = view;
          this.path = plugin.recordSheetLivePath(view);
          this.decorations = plugin.buildRecordSheetDecorations(view);
          plugin.recordSheetEditors?.add(view);
        }
        update(update) {
          const path = plugin.recordSheetLivePath(update.view);
          const notified = (update.transactions || []).some((tx) => (
            (tx.effects || []).some((effect) => effect.is?.(ensureRecordSheetRefresh()))
          ));
          const liveChanged = editorLivePreviewField && update.startState && update.state
            ? (() => {
              try {
                return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField);
              } catch (_) {
                return false;
              }
            })()
            : false;
          const rebuild = path !== this.path || notified || liveChanged || update.docChanged || update.viewportChanged;
          this.path = path;
          if (rebuild) this.decorations = plugin.buildRecordSheetDecorations(update.view);
        }
        destroy() { plugin.recordSheetCleanEditor(this.view); }
      };
      return Prec?.highest ? Prec.highest(ViewPlugin.fromClass(SheetPlugin, {
        decorations: (value) => value.decorations,
      })) : ViewPlugin.fromClass(SheetPlugin, { decorations: (value) => value.decorations });
    } catch (_) {
      return null;
    }
  }

  refreshRecordSheetEditors() {
    try {
      const effect = ensureRecordSheetRefresh();
      for (const view of this.recordSheetEditors || []) {
        if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
        else this.buildRecordSheetDecorations(view);
      }
    } catch (_) {}
  }

  scheduleRecordSheetRefresh() {
    if (!this.recordSheetActive || this.recordSheetRefreshTimer != null) return;
    this.recordSheetRefreshTimer = this.albumSetTimeout(() => {
      this.recordSheetRefreshTimer = null;
      if (!this.recordSheetActive) return;
      this.refreshRecordSheetReading();
      this.refreshRecordSheetEditors();
      this.recordSheetNotifyOwnership();
    }, 100);
  }
}
