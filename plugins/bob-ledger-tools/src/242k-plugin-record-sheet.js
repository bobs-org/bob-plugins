// Record sheet chrome in Reading view and Live Preview. Widgets never
// rewrite Markdown; Source mode keeps native YAML.
let recordSheetRefreshEffect = null;
function ensureRecordSheetRefresh() {
  if (!recordSheetRefreshEffect && StateEffect?.define) recordSheetRefreshEffect = StateEffect.define();
  return recordSheetRefreshEffect;
}

// Embedded record sheets (hover popovers, embeds) always fail open: the
// hide class never applies inside an embed scope, so embedded notes keep
// their own Properties.
function recordSheetScopeIsEmbed(scope) {
  try {
    return Boolean(scope && typeof scope.closest === "function"
      && scope.closest(".markdown-embed, .internal-embed, .hover-popover"));
  } catch (_) {
    return false;
  }
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
    this.recordSheetSourceCache = new Map();
    this.recordSheetSourceFlights = new Map();
    this.recordSheetOwnedKey = "";
    this.recordSheetDomBuilds = 0;
    this.recordSheetRefreshTimer = null;
    this.recordSheetReadingViewMountTimer = null;
    this.recordSheetDay = this.recordSheetToday();
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
        this.registerEvent(cache.on("changed", (file) => {
          this.recordSheetOnMetadata(file);
          this.scheduleRecordSheetReadingViewMount();
        }));
      }
    } catch (_) {}
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        for (const event of ["layout-change", "file-open"]) {
          this.registerEvent(workspace.on(event, () => this.scheduleRecordSheetReadingViewMount()));
        }
      }
    } catch (_) {}
  }

  teardownRecordSheet() {
    this.recordSheetActive = false;
    this.recordSheetUnsubscribe?.();
    this.recordSheetUnsubscribe = null;
    this.albumClearTimeout?.(this.recordSheetRefreshTimer);
    this.recordSheetRefreshTimer = null;
    this.albumClearTimeout?.(this.recordSheetReadingViewMountTimer);
    this.recordSheetReadingViewMountTimer = null;
    for (const timer of this.recordSheetReadingTimers?.values?.() || []) this.albumClearTimeout?.(timer);
    this.recordSheetReadingTimers?.clear();
    this.recordSheetReadingPending?.clear();
    for (const widget of this.recordSheetReading || []) {
      this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
    }
    for (const view of this.recordSheetEditors || []) this.recordSheetCleanEditor(view);
    for (const scope of this.recordSheetNativePropertiesScopes?.keys() || []) this.recordSheetClearNativeProperties(scope);
    this.recordSheetReading?.clear();
    this.recordSheetEditors?.clear();
    this.recordSheetEditorScopes?.clear?.();
    this.recordSheetCollapsed?.clear?.();
    this.recordSheetFolds?.clear?.();
    for (const timer of this.recordSheetOverlayTimers?.values?.() || []) this.albumClearTimeout?.(timer);
    this.recordSheetOverlayTimers?.clear?.();
    this.recordSheetOverlays?.clear?.();
    this.recordSheetSourceCache?.clear?.();
    this.recordSheetSourceFlights?.clear?.();
    this.recordSheetOwnedKey = "";
  }

  refreshRecordSheetForRollover(now = new Date()) {
    if (!this.recordSheetActive) return false;
    const today = this.recordSheetToday(now);
    if (!today || today === this.recordSheetDay) return false;
    this.recordSheetDay = today;
    this.scheduleRecordSheetRefresh();
    return true;
  }

  recordSheetToday(now = new Date()) {
    return typeof albumLocalDate === "function" ? albumLocalDate(now) : "";
  }

  recordSheetOnMetadata(file) {
    if (!this.recordSheetActive) return;
    const path = recordSheetPath(file && file.path);
    if (!path) return;
    if (this.recordSheetOverlayMatchesFrontmatter(path)) {
      this.recordSheetPushOverlay(path, null);
    }
    const owns = this.recordSheetOwnsPath(path);
    const openPath = this.recordSheetHasOpenPath(path);
    if (owns || openPath) {
      this.recordSheetSourceCache?.delete?.(path);
      this.recordSheetSourceFlights?.delete?.(path);
      this.recordSheetEnsureWalkSource(path);
    }
    // A metadata edit can make an open ordinary note eligible for a Record
    // Card again. Keep observing the open path after the first edit removes
    // ownership so the inverse transition can rebuild its sheet and hide
    // class without requiring the user to reopen the note.
    if (owns || this.recordSheetWatchesParent(path) || openPath) {
      this.scheduleRecordSheetRefresh();
    }
  }

  recordSheetHasOpenPath(path) {
    const wanted = recordSheetPath(path);
    if (!wanted) return false;
    try {
      return (this.app?.workspace?.getLeavesOfType?.("markdown") || []).some((leaf) =>
        recordSheetPath(leaf?.view?.file?.path) === wanted);
    } catch (_) {
      return false;
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
    const state = this.recordSheetState();
    const currentSource = typeof sourceText === "string"
      ? sourceText
      : this.recordSheetSourceCache?.get?.(recordSheetPath(path));
    const heading = sourceText
      ? recordSheetFirstHeading(sourceText)
      : recordSheetHeadingFromCache(cache);
    const model = recordSheetModel({
      path,
      frontmatter: this.recordSheetFrontmatter(path) || {},
      report: state?.report || null,
      sourceText: currentSource,
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
    if (typeof recordWalkRequestSync === "function") recordWalkRequestSync(this, model?.walk);
    return model;
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
        openEdit: () => { void this.openRecordCard?.({ filePath: path }); },
        openField: (key) => { void this.openRecordCard?.({ filePath: path, field: key }); },
        openStage: (key) => { void this.openRecordCard?.({ filePath: path, field: key, stage: true }); },
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

  recordSheetEnsureWalkSource(path) {
    const key = recordSheetPath(path);
    if (!key || !this.recordSheetActive) return null;
    if (!(this.recordSheetSourceCache instanceof Map)) this.recordSheetSourceCache = new Map();
    if (!(this.recordSheetSourceFlights instanceof Map)) this.recordSheetSourceFlights = new Map();
    if (this.recordSheetSourceCache.has(key)) return Promise.resolve(this.recordSheetSourceCache.get(key));
    if (this.recordSheetSourceFlights.has(key)) return this.recordSheetSourceFlights.get(key);
    const flight = Promise.resolve()
      .then(() => this.recordSheetReadSource(key))
      .then((source) => {
        if (!this.recordSheetActive || this.recordSheetSourceFlights.get(key) !== flight) return "";
        const text = String(source == null ? "" : source);
        this.recordSheetSourceCache.set(key, text);
        this.scheduleRecordSheetRefresh();
        return text;
      })
      .catch(() => "")
      .finally(() => {
        if (this.recordSheetSourceFlights.get(key) === flight) this.recordSheetSourceFlights.delete(key);
      });
    this.recordSheetSourceFlights.set(key, flight);
    return flight;
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
    this.recordWalkRemoveReading(root, sourcePath);
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
    this.recordSheetClearNativeProperties(scope);
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
      this.recordWalkPaintReading(root, sourcePath, null);
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
    // The card is the record's rendered title surface, so keep it before an
    // authored legacy H1 instead of letting that heading precede the card.
    if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(sheet, anchor);
    else if (root.insertBefore) root.insertBefore(sheet, root.firstChild || null);
    else root.prepend?.(sheet);
    this.recordWalkPaintReading(root, sourcePath, sheet);
    if (focusKey) {
      const next = sheet.querySelector?.(`[data-record-sheet-focus="${focusKey}"]`);
      next?.focus?.({ preventScroll: true });
    }
    if (model.hideEligible === true && !recordSheetScopeIsEmbed(scope)) {
      scope?.classList?.add?.(RECORD_SHEET_HIDES_CLASS);
    }
    this.recordSheetSetNativeProperties(scope, model);
    this.recordSheetNotifyOwnership();
    return sheet;
  }

  recordSheetHasFrontmatterOnlyBody(source) {
    const text = String(source == null ? "" : source);
    const end = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
    if (end < 0) return false;
    return text.split(/\r?\n/).slice(end + 1).join("\n").trim() === "";
  }

  recordSheetReadingViewSurface(view) {
    try {
      const mode = typeof view?.getMode === "function" ? view.getMode() : "";
      if (mode && mode !== "preview") return null;
      const container = view?.containerEl || view?.contentEl || view?.dom;
      if (!container) return null;
      const preview = container.matches?.(".markdown-preview-view")
        ? container : container.querySelector?.(".markdown-preview-view");
      if (!preview) return null;
      const sizer = preview.querySelector?.(".markdown-preview-sizer");
      return this.recordSheetReadingRoot(sizer || preview);
    } catch (_) {
      return null;
    }
  }

  scheduleRecordSheetReadingViewMount() {
    if (!this.recordSheetActive || this.recordSheetReadingViewMountTimer != null) return;
    this.recordSheetReadingViewMountTimer = this.albumSetTimeout(() => {
      this.recordSheetReadingViewMountTimer = null;
      void this.mountRecordSheetFrontmatterOnlyViews();
    }, 0);
  }

  async mountRecordSheetFrontmatterOnlyViews() {
    if (!this.recordSheetActive) return;
    const workspace = this.app?.workspace;
    let leaves = [];
    try { leaves = workspace?.getLeavesOfType?.("markdown") || []; } catch (_) {}
    const seen = new Set();
    for (const leaf of leaves) {
      if (!this.recordSheetActive) return;
      const view = leaf?.view;
      const path = recordSheetPath(view?.file?.path);
      const surface = this.recordSheetReadingViewSurface(view);
      if (!path || !surface) continue;
      const source = await this.recordSheetReadSource(path);
      if (!this.recordSheetActive) return;
      if (!this.recordSheetHasFrontmatterOnlyBody(source)) continue;
      let widget = Array.from(this.recordSheetReading || []).find((item) =>
        item.viewFallback === true && item.view === view);
      if (widget && (widget.path !== path || widget.surface !== surface)) {
        this.recordSheetReading.delete(widget);
        this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
        widget = null;
      }
      const owner = Array.from(this.recordSheetReading || []).find((item) =>
        item.surface === surface && item.path === path);
      if (owner && owner !== widget) {
        seen.add(owner);
        continue;
      }
      if (!widget) {
        widget = { el: surface, path, surface, scope: this.recordSheetReadingScope(surface), view, viewFallback: true };
        this.recordSheetReading.add(widget);
      }
      seen.add(widget);
    }
    for (const widget of Array.from(this.recordSheetReading || [])) {
      if (widget.viewFallback !== true || seen.has(widget)) continue;
      this.recordSheetReading.delete(widget);
      this.recordSheetRemoveReading(widget.surface, widget.scope, widget.path);
    }
    this.refreshRecordSheetReading();
  }

  recordSheetSetEditorHide(view, model) {
    try {
      const scope = this.recordSheetEditorScopes?.get?.(view) || view?.dom;
      if (!scope || !scope.classList) return;
      if (model?.hideEligible === true && !recordSheetScopeIsEmbed(scope)) scope.classList.add?.(RECORD_SHEET_HIDES_CLASS);
      else scope.classList.remove?.(RECORD_SHEET_HIDES_CLASS);
      this.recordSheetSetNativeProperties(scope, model);
    } catch (_) {}
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
    widget.viewFallback = false;
    widget.albumPath = this.recordSheetGateFor(ctx.sourcePath)?.albumPath || "";
    this.recordSheetEnsureWalkSource(ctx.sourcePath);
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

  recordSheetSetEditorScope(view, enabled) {
    const root = view?.dom;
    if (!root) return;
    if (!(this.recordSheetEditorScopes instanceof Map)) this.recordSheetEditorScopes = new Map();
    let scope = root;
    try {
      // Live Preview's native Properties and inline title are nested below the
      // CodeMirror editor, not direct children of .markdown-source-view. Own
      // the exact editor node so the CSS can follow that observed path without
      // reaching into sibling editors or embedded notes.
      if (!root.matches?.(".cm-editor")) scope = root.closest?.(".cm-editor") || root;
    } catch (_) {}
    const previous = this.recordSheetEditorScopes?.get(view);
    if (previous && previous !== scope) {
      this.recordSheetClearNativeProperties(previous);
      previous.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
      previous.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    }
    if (enabled) scope.classList?.add?.(RECORD_SHEET_SURFACE_CLASS);
    else {
      this.recordSheetClearNativeProperties(scope);
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
      this.recordSheetClearNativeProperties(scope);
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
          const rebuild = path !== this.path || notified || liveChanged || update.docChanged || update.viewportChanged || update.selectionSet;
          this.path = path;
          if (rebuild) this.decorations = plugin.buildRecordSheetDecorations(update.view);
        }
        destroy() { plugin.recordSheetCleanEditor(this.view); }
      };
      const extension = ViewPlugin.fromClass(SheetPlugin, {
        decorations: (value) => value.decorations,
        provide: () => EditorView?.editorAttributes?.of((view) => plugin.recordSheetEditorAttributes(view)) || [],
      });
      return Prec?.highest ? Prec.highest(extension) : extension;
    } catch (_) {
      return null;
    }
  }

  recordSheetEditorAttributes(view) {
    // CodeMirror replaces the editor's class attribute on focus/tab changes.
    // Declare our existing ownership through its facet so a mounted sheet never
    // temporarily exposes duplicate native fields while waiting for a rebuild.
    const scope = this.recordSheetEditorScopes?.get(view);
    if (!this.recordSheetActive || !scope) return {};
    const classes = [RECORD_SHEET_SURFACE_CLASS];
    if (this.recordSheetNativePropertiesScopes?.has(scope)) classes.push(RECORD_SHEET_HIDES_CLASS);
    return { class: classes.join(" ") };
  }

  refreshRecordSheetEditors() {
    try {
      const effect = ensureRecordSheetRefresh();
      const views = new Set(this.recordSheetEditors || []);
      for (const leaf of this.app?.workspace?.getLeavesOfType?.("markdown") || []) {
        const view = leaf?.view?.editor?.cm || null;
        if (view?.dispatch) views.add(view);
      }
      for (const view of views) {
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
