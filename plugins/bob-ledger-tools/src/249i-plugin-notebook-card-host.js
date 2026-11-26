// Notebook Card host (bob-cli-qm notebook-card). The shared property-card
// host owns Reading/Live Preview lifecycle and title adoption. The adapter
// paints local identity only; the notebook report phase fills the reserved
// readout slot through the already-shared data service.
const NOTEBOOK_CARD_HOST_KIND = "notebook";
const NOTEBOOK_CARD_MOUNT_ATTR = "data-notebook-source";
const NOTEBOOK_CARD_HOST_SURFACE_CLASS = "bob-notebook-card-surface";
const notebookCardNodeSignatures = new WeakMap();

function notebookCardMountedInSurface(root, sourcePath) {
  const path = notebookCardPath(sourcePath);
  if (!root || !path) return false;
  try {
    for (const node of Array.from(root.querySelectorAll?.(`.${NOTEBOOK_CARD_SURFACE_CLASS}`) || [])) {
      if (notebookCardPath(node.getAttribute?.(NOTEBOOK_CARD_MOUNT_ATTR)) !== path) continue;
      if (node.getAttribute?.("data-cm-widget") === "true") {
        if (root.matches?.(".cm-editor") && root.contains?.(node)) return true;
        continue;
      }
      if (propertyCardNodeBelongs(node, root)) return true;
    }
  } catch (_) {}
  return false;
}

function notebookCardScopeDenied(scope, root) {
  for (const node of [scope, root]) {
    if (!node || typeof node.closest !== "function") continue;
    try {
      if (node.closest(".markdown-embed, .internal-embed, .hover-popover, .canvas-node, .print")) return true;
    } catch (_) {}
  }
  return false;
}

class BobLedgerToolsNotebookCardMixin {
  notebookCardPropertyHost() {
    if (this._notebookCardPropertyHost) return this._notebookCardPropertyHost;
    const plugin = this;
    this._notebookCardPropertyHost = createPropertyCardHost({
      plugin,
      kind: NOTEBOOK_CARD_HOST_KIND,
      readingPriority: 47,
      allowEmbedDisplay: false,
      titleOwnership: true,
      fields: {
        active: "notebookCardActive",
        reading: "notebookCardReading",
        readingPending: "notebookCardReadingPending",
        readingTimers: "notebookCardReadingTimers",
        editors: "notebookCardEditors",
        editorScopes: "notebookCardEditorScopes",
        refreshTimer: "notebookCardRefreshTimer",
        keySlots: "notebookCardKeySlots",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout?.(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout?.(id),
      pathOf: notebookCardPath,
      readingRoot: (el) => plugin.notebookCardReadingRoot(el),
      readingScope: (root) => plugin.notebookCardReadingScope(root),
      acceptReading: (el, ctx) => Boolean(el && ctx?.sourcePath && !notebookInsideCode(el)),
      paintReading: (el, path) => plugin.paintNotebookCardReading(el, path),
      removeReading: (root, scope, path) => plugin.notebookCardRemoveReading(root, scope, path),
      livePath: (view) => plugin.notebookCardLivePath(view),
      buildDecorations: (view, update) => plugin.buildNotebookCardDecorations(view, update),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.notebookCardCleanEditor(view),
      workspaceEvents: ["layout-change", "file-open", "active-leaf-change"],
      onSetup: () => plugin.notebookCardOnSetup(),
      onDisposeStart: () => plugin.notebookCardOnDisposeStart(),
      onDisposeEnd: () => plugin.notebookCardOnDisposeEnd(),
    });
    return this._notebookCardPropertyHost;
  }

  setupNotebookCard() {
    this.notebookCardPropertyHost().setup();
  }

  teardownNotebookCard() {
    this.notebookCardPropertyHost().dispose();
  }

  notebookCardDesktop() {
    try { return typeof propertyCardDesktop === "function" && propertyCardDesktop() === true; }
    catch (_) { return false; }
  }

  notebookCardReadingRoot(el) {
    try { return propertyCardReadingRoot(el); } catch (_) { return null; }
  }

  notebookCardReadingScope(root) {
    try { return propertyCardReadingScope(root); } catch (_) { return root; }
  }

  notebookCardFrontmatterFor(path) {
    try { return this.notebookCardFrontmatter(path) || {}; } catch (_) { return {}; }
  }

  notebookCardEligible(path, frontmatter) {
    const key = notebookCardPath(path);
    if (!key || noteCardPathExcluded(key) || propertyCardKindLive(this, NOTEBOOK_CARD_HOST_KIND) !== true) return false;
    try {
      return propertyCardNoteSpecies({ path: key, frontmatter: frontmatter || this.notebookCardFrontmatterFor(key) }) === NOTEBOOK_CARD_HOST_KIND;
    } catch (_) { return false; }
  }

  notebookCardLivePath(view) {
    if (this.notebookCardActive !== true || !this.notebookCardDesktop()) return null;
    try {
      if (view?.dom?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node")) return null;
    } catch (_) {}
    let path = "";
    try { path = notebookCardPath(this.notebookCatalogLivePath?.(view) || ""); } catch (_) {}
    if (!path || !this.notebookCardEligible(path, this.notebookCardFrontmatterFor(path))) return null;
    return path;
  }

  notebookCardHeaderModel(path) {
    try {
      const state = typeof this.notebookCatalogState === "function"
        ? this.notebookCatalogState()
        : this.notebookHeaderLastState || null;
      if (!state?.report || state.stale === true || state.unavailable === true) return null;
      return this.notebookHeaderModelFor(path, state);
    } catch (_) { return null; }
  }

  notebookCardHue(path) {
    try {
      if (typeof this.notebookHeaderHue === "function") return this.notebookHeaderHue(path) || "";
      return notebookHostHueName(path, this.app?.metadataCache, this.app?.vault) || "";
    } catch (_) { return ""; }
  }

  notebookCardModelFor(path, sourceText) {
    const key = notebookCardPath(path);
    if (!this.notebookCardEligible(key, this.notebookCardFrontmatterFor(key))) return null;
    const cache = typeof propertyCardSettledMetadataCache === "function"
      ? propertyCardSettledMetadataCache(this.app) : this.app?.metadataCache;
    try {
      return notebookCardModel({
        path: key,
        frontmatter: this.notebookCardFrontmatterFor(key),
        sourceText: typeof sourceText === "string" ? sourceText : this.notebookCardSourceCache?.get?.(key),
        headerModel: this.notebookCardHeaderModel(key),
        metadataCache: cache,
        vault: this.app?.vault,
        hue: this.notebookCardHue(key),
      });
    } catch (_) { return null; }
  }

  notebookCardIsCollapsed(path) {
    const key = notebookCardPath(path);
    if (!(this.notebookCardCollapsed instanceof Map)) this.notebookCardCollapsed = new Map();
    const stored = key && this.notebookCardCollapsed.has(key) ? this.notebookCardCollapsed.get(key) : null;
    let open = stored !== false;
    try {
      const choice = propertyCardFoldChoiceFromStored(stored);
      open = propertyCardFoldResolve({
        choice,
        problems: "",
        foldDefault: propertyCardSpecies(NOTEBOOK_CARD_HOST_KIND)?.foldDefault,
      }) === true;
    } catch (_) {}
    return !open;
  }

  notebookCardSetCollapsed(path, collapsed) {
    const key = notebookCardPath(path);
    if (!(this.notebookCardCollapsed instanceof Map)) this.notebookCardCollapsed = new Map();
    if (key) this.notebookCardCollapsed.set(key, propertyCardFoldChoice(collapsed !== true, ""));
    this.scheduleNotebookCardRefresh();
  }

  notebookCardRegisterFolds() {
    const unregister = propertyCardRegisterFoldKind(this, NOTEBOOK_CARD_HOST_KIND, {
      toggle: (path) => {
        this.notebookCardSetCollapsed(path, !this.notebookCardIsCollapsed(path));
        return true;
      },
    });
    return typeof unregister === "function" ? unregister : () => {};
  }

  notebookCardOpenSummary(path) {
    const filePath = notebookCardPath(path);
    if (!filePath || typeof this.openPropertyEditor !== "function") return false;
    try { return this.openPropertyEditor({ filePath, key: "summary" }); } catch (_) { return false; }
  }

  notebookCardRegisterSummaryKey() {
    if (this.notebookCardSummaryKeyRegistered === true) return true;
    if (typeof this.registerPropertyCard !== "function") return false;
    this.notebookCardSummaryKeyRegistered = this.registerPropertyCard({
      kind: NOTEBOOK_CARD_HOST_KIND,
      match: ({ path, frontmatter } = {}) => this.notebookCardEligible(path, frontmatter),
      open: ({ path } = {}) => { void this.notebookCardOpenSummary(path); },
    });
    return this.notebookCardSummaryKeyRegistered;
  }

  notebookCardUnregisterSummaryKey() {
    if (this.notebookCardSummaryKeyRegistered === true) {
      try { this.unregisterPropertyCard?.(NOTEBOOK_CARD_HOST_KIND); } catch (_) {}
    }
    this.notebookCardSummaryKeyRegistered = false;
  }

  notebookCardOnSetup() {
    if (!(this.notebookCardCollapsed instanceof Map)) this.notebookCardCollapsed = new Map();
    this.notebookCardFoldUnregister = this.notebookCardRegisterFolds();
    try { propertyCardFrontmatterCoordinatorBind?.(this, NOTEBOOK_CARD_HOST_KIND); } catch (_) {}
    try { this.notebookCardFootBind?.(); } catch (_) {}
    try { this.notebookCardReadoutsBind?.(); } catch (_) {}
    this.notebookCardRegisterSummaryKey();
    try {
      if (!this.notebookCardPreviewLoadStarted) {
        this.notebookCardPreviewLoadStarted = true;
        void propertyCardPreviewLoad(this).then(() => {
          if (this.notebookCardActive !== true) return;
          this.scheduleNotebookCardRefresh();
          this.scheduleNotebookHeaderRefresh?.();
        });
      }
    } catch (_) {}
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.notebookCardMetaBound) {
        this.notebookCardMetaBound = true;
        this.registerEvent(cache.on("resolved", () => this.scheduleNotebookCardRefresh()));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.notebookCardVaultBound) {
        this.notebookCardVaultBound = true;
        for (const name of ["create", "modify"]) {
          this.registerEvent(vault.on(name, () => this.scheduleNotebookCardRefresh()));
        }
      }
    } catch (_) {}
  }

  notebookCardOnDisposeStart() {
    try { this.notebookCardReleaseFrontmatterKind?.(); } catch (_) {}
    try { this.notebookCardFoldUnregister?.(); } catch (_) {}
    this.notebookCardFoldUnregister = null;
    try { this.notebookCardFootUnbind?.(); } catch (_) {}
    try { this.notebookCardReadoutsUnbind?.(); } catch (_) {}
    this.notebookCardUnregisterSummaryKey();
  }

  notebookCardOnDisposeEnd() {
    try { this.notebookCardCollapsed?.clear?.(); } catch (_) {}
    this.notebookCardMetaBound = false;
    this.notebookCardVaultBound = false;
    this.notebookCardPreviewLoadStarted = false;
  }

  notebookCardReleaseFrontmatterKind() {
    try { return propertyCardFrontmatterCoordinatorReleaseKind?.(this, NOTEBOOK_CARD_HOST_KIND) || 0; }
    catch (_) { return 0; }
  }

  notebookCardOwnMountedFrontmatter(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const plugin = this;
    const sourceFor = () => {
      if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      return plugin.notebookCardSourceCache?.get?.(notebookCardPath(path));
    };
    return propertyCardFrontmatterOwnMounted(plugin, {
      scope,
      view: view && view.dom === scope ? view : null,
      path,
      kind: NOTEBOOK_CARD_HOST_KIND,
      mount,
      sourceText,
      getSource: sourceFor,
      currentPath,
      isCurrent: () => {
        const source = sourceFor();
        return Boolean(source && plugin.notebookCardModelFor(path, source));
      },
      active: () => plugin.notebookCardActive === true,
    });
  }

  notebookCardBuildMounted(model, options, doc, footSpec) {
    let card = null;
    try { card = notebookCardBuildEl(doc, model, options); } catch (_) {}
    if (!card) return null;
    try { card.setAttribute("data-notebook-source", model.path); } catch (_) {}
    // The foot is appended once by notebookCardBuildEl through
    // options.appendFoot; a second append here doubled every foot.
    return card;
  }

  notebookCardSignature(model, extra = {}) {
    try {
      return JSON.stringify([
        model,
        extra?.footDigest || "",
        extra?.readoutDigest || "",
        extra?.footOpen === true,
        extra?.collapsed === true,
        extra?.editorAvailable === true,
        extra?.keyLive === true,
      ]);
    } catch (_) { return ""; }
  }

  notebookCardReadoutDigestFor(path, collapsed) {
    try {
      if (typeof this.notebookCardReadoutFor !== "function") return "none";
      if (typeof notebookCardReadoutDigest !== "function") return "readout";
      return notebookCardReadoutDigest(this.notebookCardReadoutFor(path, { collapsed: collapsed === true }));
    } catch (_) {
      return "readout";
    }
  }

  notebookCardFocusKey(node, doc) {
    try {
      const active = doc?.activeElement;
      if (!active || !node?.contains?.(active)) return "";
      for (const name of ["data-foot-focus", "data-notebook-route"]) {
        const value = active.getAttribute?.(name);
        if (value) return `${name}:${value}`;
      }
      return active.getAttribute?.("aria-label") || "";
    } catch (_) { return ""; }
  }

  notebookCardRestoreFocus(node, key) {
    if (!key || !node?.querySelector) return;
    try {
      const separator = key.indexOf(":");
      const name = separator >= 0 ? key.slice(0, separator) : "aria-label";
      const value = separator >= 0 ? key.slice(separator + 1) : key;
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
      node.querySelector(`[${name}="${escaped}"]`)?.focus?.();
    } catch (_) {}
  }

  notebookCardReadingAnchor(root) {
    try {
      return Array.from(root?.querySelectorAll?.("h1") || []).find((node) => !notebookInsideCode(node)) || null;
    } catch (_) { return null; }
  }

  notebookCardBodyNodes(root, sourcePath, exclude = null) {
    const path = notebookCardPath(sourcePath);
    return Array.from(root?.querySelectorAll?.(`.${NOTEBOOK_CARD_SURFACE_CLASS}`) || []).filter((node) => {
      if (node === exclude || !propertyCardNodeBelongs(node, root) || node.getAttribute?.("data-cm-widget") === "true") return false;
      const ownedPath = notebookCardPath(node.getAttribute?.(NOTEBOOK_CARD_MOUNT_ATTR));
      return !path || !ownedPath || ownedPath === path;
    });
  }

  notebookCardRemoveStrays(root, sourcePath) {
    const path = notebookCardPath(sourcePath);
    for (const node of Array.from(root?.querySelectorAll?.(`.${NOTEBOOK_CARD_SURFACE_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") !== "true") continue;
      if (notebookCardPath(node.getAttribute?.(NOTEBOOK_CARD_MOUNT_ATTR)) !== path) continue;
      try { node.remove?.(); } catch (_) {}
    }
  }

  paintNotebookCardReading(el, sourcePath) {
    const path = notebookCardPath(sourcePath);
    const root = this.notebookCardReadingRoot(el);
    const scope = this.notebookCardReadingScope(root);
    if (!root || !path) return null;
    if (notebookCardScopeDenied(scope, root) || !this.notebookCardDesktop()) {
      this.notebookCardRemoveReading(root, scope, path);
      return null;
    }
    this.notebookCardRemoveStrays(root, path);
    void this.notebookCardEnsureSource?.(path);
    const sourceText = this.notebookCardSourceCache?.get?.(path);
    const model = this.notebookCardModelFor(path, sourceText);
    const reading = scope?.classList?.contains?.("markdown-preview-view")
      ? propertyCardReadingViewFor(this.app, scope) : null;
    if (!model || (reading?.currentPath?.() && notebookCardPath(reading.currentPath()) !== path)) {
      this.notebookCardRemoveReading(root, scope, path);
      return null;
    }
    const doc = (typeof document !== "undefined" ? document : null) || root?.ownerDocument || null;
    if (!doc || typeof doc.createElement !== "function") {
      this.notebookCardRemoveReading(root, scope, path);
      return null;
    }
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === path && adopted.kind === NOTEBOOK_CARD_HOST_KIND && adopted.mode === "slot"
      ? adopted.node : null;
    const bodyNodes = this.notebookCardBodyNodes(root, path, slotNode);
    let card = slotNode || bodyNodes[0] || null;
    const focusKey = this.notebookCardFocusKey(card, doc);
    const extra = this.notebookCardFootExtra(path, model);
    const options = {
      collapsed: this.notebookCardIsCollapsed(path),
      reducedMotion: propertyCardFootReducedMotion?.() === true,
      keyLive: false,
      onToggleFold: (collapsed) => this.notebookCardSetCollapsed(path, collapsed),
      onAddSummary: () => { void this.notebookCardOpenSummary(path); },
      onLink: (target, event) => { void this.notebookHeaderOpenPath?.(target, path, event); },
      footSpec: extra?.footSpec,
      appendFoot: (parent, currentModel, ownerDoc) => this.notebookCardAppendFoot(parent, path, currentModel, ownerDoc, extra?.footSpec, options),
    };
    const signature = this.notebookCardSignature(model, {
      ...extra,
      readoutDigest: this.notebookCardReadoutDigestFor(path, options.collapsed),
      collapsed: options.collapsed,
      editorAvailable: typeof this.openPropertyEditor === "function",
    });
    if (!card || notebookCardNodeSignatures.get(card) !== signature) {
      let fresh = null;
      try { fresh = this.notebookCardBuildMounted(model, options, doc, extra?.footSpec); } catch (_) {}
      if (!fresh) {
        this.notebookCardRemoveReading(root, scope, path);
        return null;
      }
      card = card ? propertyCardAdoptPatch(card, fresh) : fresh;
      notebookCardNodeSignatures.set(card, signature);
    }
    for (const node of bodyNodes) if (node !== card) { try { node.remove?.(); } catch (_) {} }

    const plugin = this;
    const currentPath = reading?.currentPath || (() => "");
    const ownFrontmatter = (mount) => plugin.notebookCardOwnMountedFrontmatter(
      scope, reading?.view || null, path, mount, plugin.notebookCardSourceCache?.get?.(path), currentPath,
    );
    const adoption = propertyCardAdoptTitle(scope, card, {
      path,
      kind: NOTEBOOK_CARD_HOST_KIND,
      view: reading?.view || null,
      currentPath,
      recognizer: propertyCardHomeTitleRecognizer(model.title.text),
      onLost: () => this.scheduleNotebookCardRefresh(),
      onMount: (mount) => {
        void ownFrontmatter(mount);
        try { plugin.notebookHeaderRemoveOwned?.(root, path); } catch (_) {}
        try { plugin.scheduleNotebookHeaderRefresh?.(); } catch (_) {}
      },
    });
    if (adoption.mode !== "slot") {
      try {
        const anchor = this.notebookCardReadingAnchor(root);
        if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(card, anchor.nextSibling || null);
        else if (root.insertBefore) root.insertBefore(card, root.firstChild || null);
        else root.prepend?.(card);
      } catch (_) {
        this.notebookCardRemoveReading(root, scope, path);
        return null;
      }
      propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: NOTEBOOK_CARD_HOST_KIND, path });
      try { this.notebookHeaderRemoveOwned?.(root, path); } catch (_) {}
      try { this.scheduleNotebookHeaderRefresh?.(); } catch (_) {}
    } else {
      void ownFrontmatter(card);
    }
    scope?.classList?.add?.(NOTEBOOK_CARD_HOST_SURFACE_CLASS);
    this.notebookCardTrackFoot?.(scope || root, path, card);
    try {
      this.notebookCardPaintReadouts?.(card, path, doc, {
        scope, view: reading?.view || null, collapsed: options.collapsed,
      });
    } catch (_) {}
    this.notebookCardRestoreFocus(card, focusKey);
    void this.notebookCardEnsureSource?.(path);
    return card;
  }

  notebookCardRemoveReading(root, scope = root, sourcePath = "") {
    const path = notebookCardPath(sourcePath);
    if (!root) return;
    const hadCard = notebookCardMountedInSurface(root, path);
    try { this.notebookCardTrackFoot?.(scope, path, null); } catch (_) {}
    try { propertyCardAdoptRelease?.(scope, path || undefined, NOTEBOOK_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: NOTEBOOK_CARD_HOST_KIND, path }); } catch (_) {}
    for (const node of Array.from(root.querySelectorAll?.(`.${NOTEBOOK_CARD_SURFACE_CLASS}`) || [])) {
      if (!propertyCardNodeBelongs(node, root)) continue;
      const ownedPath = notebookCardPath(node.getAttribute?.(NOTEBOOK_CARD_MOUNT_ATTR));
      if (path && ownedPath && ownedPath !== path) continue;
      try { node.remove?.(); } catch (_) { try { node.parentNode?.removeChild?.(node); } catch (__) {} }
    }
    if (!Array.from(this.notebookCardReading || []).some((item) => item.surface === root && item.path !== path)) {
      scope?.classList?.remove?.(NOTEBOOK_CARD_HOST_SURFACE_CLASS);
    }
    if (hadCard) {
      try { this.scheduleNotebookHeaderRefresh?.(); } catch (_) {}
    }
  }

  notebookCardSetEditorScope(view, enabled) {
    try {
      return this.notebookCardPropertyHost().setEditorScope(view, enabled, {
        scopeOf: (root) => root?.closest?.(".markdown-source-view") || root?.closest?.(".markdown-preview-view") || root,
        mark: (scope) => scope?.classList?.add?.(NOTEBOOK_CARD_HOST_SURFACE_CLASS),
        unmark: (scope) => scope?.classList?.remove?.(NOTEBOOK_CARD_HOST_SURFACE_CLASS),
      });
    } catch (_) { return null; }
  }

  notebookCardCleanEditor(view) {
    const scope = view?.dom || null;
    const path = notebookCardPath(this.notebookCardLivePath(view) || "");
    try { this.notebookCardTrackFoot?.(scope, path, null); } catch (_) {}
    try { propertyCardAdoptRelease?.(scope, path || undefined, NOTEBOOK_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: NOTEBOOK_CARD_HOST_KIND, path }); } catch (_) {}
    try { this.notebookCardPropertyHost().cleanEditor(view, { unmark: (root) => root?.classList?.remove?.(NOTEBOOK_CARD_HOST_SURFACE_CLASS) }); } catch (_) {}
  }

  notebookCardReadingMounted(view, path) {
    return notebookCardMountedInSurface(view?.dom, path);
  }

  buildNotebookCardDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType || !view?.state?.doc) return Decoration?.none || null;
      const path = this.notebookCardLivePath(view);
      if (!path) {
        this.notebookCardCleanEditor(view);
        return Decoration.none;
      }
      const sourceText = view.state.doc.toString();
      this.notebookCardRememberSource(path, sourceText);
      const model = this.notebookCardModelFor(path, sourceText);
      if (!model) {
        this.notebookCardCleanEditor(view);
        return Decoration.none;
      }
      const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
      const extra = this.notebookCardFootExtra(path, model);
      const options = {
        collapsed: this.notebookCardIsCollapsed(path),
        reducedMotion: propertyCardFootReducedMotion?.() === true,
        keyLive: propertyCardFoldKeyLive?.(this, "live-preview") === true,
        onToggleFold: (collapsed) => this.notebookCardSetCollapsed(path, collapsed),
        onAddSummary: () => { void this.notebookCardOpenSummary(path); },
        onLink: (target, event) => { void this.notebookHeaderOpenPath?.(target, path, event); },
      };
      const signature = this.notebookCardSignature(model, {
        ...extra,
        readoutDigest: this.notebookCardReadoutDigestFor(path, options.collapsed),
        collapsed: options.collapsed,
        editorAvailable: typeof this.openPropertyEditor === "function",
        keyLive: options.keyLive,
      });
      const adopted = propertyCardAdoptedEntry(view.dom);
      let card = adopted && adopted.path === path && adopted.kind === NOTEBOOK_CARD_HOST_KIND && adopted.mode === "slot"
        ? adopted.node : null;
      if (!card || notebookCardNodeSignatures.get(card) !== signature) {
        const fresh = this.notebookCardBuildMounted(model, {
          ...options,
          appendFoot: (parent, currentModel, ownerDoc) => this.notebookCardAppendFoot(parent, path, currentModel, ownerDoc, extra?.footSpec, options),
        }, doc, extra?.footSpec);
        if (!fresh) {
          this.notebookCardCleanEditor(view);
          return Decoration.none;
        }
        if (card) this.notebookCardPatchLive(view, adopted, fresh, signature);
        else { card = fresh; notebookCardNodeSignatures.set(card, signature); }
      }
      const plugin = this;
      const currentPath = () => plugin.notebookCardLivePath(view) || "";
      const adoption = propertyCardAdoptTitle(view.dom, card, {
        path,
        kind: NOTEBOOK_CARD_HOST_KIND,
        view,
        currentPath,
        recognizer: propertyCardHomeTitleRecognizer(model.title.text),
        onLost: () => this.scheduleNotebookCardRefresh(),
        onMount: (mount) => {
          const text = view?.state?.doc?.toString?.() || sourceText;
          void plugin.notebookCardOwnMountedFrontmatter(view.dom, view, path, mount, text, currentPath);
          try { plugin.scheduleNotebookHeaderRefresh?.(); } catch (_) {}
        },
      });
      this.notebookCardTrackFoot?.(view.dom, path, card);
      try {
        this.notebookCardPaintReadouts?.(card, path, doc, {
          scope: view.dom, view, editor: view.editor, collapsed: options.collapsed,
        });
      } catch (_) {}
      if (adoption.mode === "slot") {
        void this.notebookCardOwnMountedFrontmatter(view.dom, view, path, card, sourceText, currentPath);
        this.notebookCardEnsureSource(path);
        return Decoration.none;
      }
      let anchor = -1;
      let frontmatterEnd = -1;
      try { anchor = this.notebookHeaderLiveAnchor(sourceText); } catch (_) {}
      try { frontmatterEnd = this.notebookHeaderFrontmatterEnd(sourceText); } catch (_) {}
      const widget = new class extends WidgetType {
        constructor() { super(); this.path = path; this.signature = signature; }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          card.setAttribute?.("data-cm-widget", "true");
          card.setAttribute?.(NOTEBOOK_CARD_MOUNT_ATTR, path);
          try { plugin.scheduleNotebookHeaderRefresh?.(); } catch (_) {}
          return card;
        }
        destroy() {}
      }();
      let at = 0;
      if (anchor >= 0) {
        try { at = view.state.doc.line(anchor + 1).to; } catch (_) {}
      } else if (frontmatterEnd >= 0) {
        try {
          const nextLine = frontmatterEnd + 2;
          at = nextLine <= (view.state.doc.lines || 0)
            ? view.state.doc.line(nextLine).from : view.state.doc.length || 0;
        } catch (_) {}
      }
      const builder = new RangeSetBuilder();
      builder.add(at, at, Decoration.widget({ widget, side: 1 }));
      this.notebookCardEnsureSource(path);
      return builder.finish();
    } catch (_) {
      try { this.notebookCardCleanEditor(view); } catch (__) {}
      return Decoration?.none || null;
    }
  }

  notebookCardPatchLive(view, adopted, fresh, signature) {
    try {
      const patched = propertyCardAdoptPatch(adopted.node, fresh);
      notebookCardNodeSignatures.set(patched, signature);
      if (adopted.pending === true) return true;
      const effect = this.notebookCardPropertyHost().ensureRefreshEffect();
      if (effect && typeof view.dispatch === "function") view.dispatch({ effects: effect.of({ refresh: true }) });
      else this.scheduleNotebookCardRefresh();
      return true;
    } catch (_) { return false; }
  }

  notebookCardJumpYaml(path, key, line) {
    try {
      if (typeof this.homeCardJumpYaml === "function") return this.homeCardJumpYaml(path, key, line);
    } catch (_) {}
    return false;
  }

  scheduleNotebookCardRefresh() {
    try { this.notebookCardPropertyHost()?.scheduleRefresh?.(); } catch (_) {}
  }
}
