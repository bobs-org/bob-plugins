// Ref Card host (bob-cli-qp ref-card). It mounts under the shared
// species-precedence result. Local identity paints
// in Reading and Live Preview; this adapter never asks the report service.
const REF_NOTE_CARD_HOST_KIND = "ref";
const REF_NOTE_CARD_MOUNT_ATTR = "data-ref-source";
const REF_NOTE_CARD_READING_PRIORITY = 46;
const REF_NOTE_CARD_HOST_SURFACE_CLASS = "bob-ref-card-surface";
const refNoteCardNodeSignatures = new WeakMap();

function refNoteCardScopeDenied(scope, root) {
  for (const node of [scope, root]) {
    try {
      if (node?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node, .canvas-node-content, .print")) return true;
    } catch (_) { return true; }
  }
  try { return typeof propertyCardScopeIsEmbed === "function" && propertyCardScopeIsEmbed(scope || root); }
  catch (_) { return true; }
}

function refNoteCardFrontmatterFromText(sourceText) {
  if (typeof sourceText !== "string") return null;
  try {
    const text = sourceText.replace(/^\uFEFF/, "");
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    if (!match || typeof parseYaml !== "function") return null;
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function refNoteCardMountedInSurface(root, sourcePath) {
  const path = refNoteCardPath(sourcePath);
  if (!root || !path) return false;
  try {
    for (const node of Array.from(root.querySelectorAll?.(`.${REF_NOTE_CARD_SURFACE_CLASS}`) || [])) {
      if (refNoteCardPath(node.getAttribute?.(REF_NOTE_CARD_MOUNT_ATTR)) !== path) continue;
      if (node.getAttribute?.("data-cm-widget") === "true") {
        if (root.matches?.(".cm-editor") && root.contains?.(node)) return true;
        continue;
      }
      if (propertyCardNodeBelongs(node, root)) return true;
    }
  } catch (_) {}
  return false;
}

class BobLedgerToolsRefNoteCardMixin {
  refNoteCardPropertyHost() {
    if (this._refNoteCardPropertyHost) return this._refNoteCardPropertyHost;
    const plugin = this;
    this._refNoteCardPropertyHost = createPropertyCardHost({
      plugin,
      kind: REF_NOTE_CARD_HOST_KIND,
      readingPriority: REF_NOTE_CARD_READING_PRIORITY,
      allowEmbedDisplay: false,
      titleOwnership: true,
      fields: {
        active: "refNoteCardActive",
        reading: "refNoteCardReading",
        readingPending: "refNoteCardReadingPending",
        readingTimers: "refNoteCardReadingTimers",
        editors: "refNoteCardEditors",
        editorScopes: "refNoteCardEditorScopes",
        refreshTimer: "refNoteCardRefreshTimer",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout?.(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout?.(id),
      pathOf: refNoteCardPath,
      readingRoot: (el) => plugin.refNoteCardReadingRoot(el),
      readingScope: (root) => plugin.refNoteCardReadingScope(root),
      acceptReading: (el, ctx) => {
        const path = refNoteCardPath(ctx?.sourcePath);
        return Boolean(el && path && !notebookInsideCode(el)
          && plugin.refNoteCardEligible(path, plugin.refNoteCardFrontmatter(path)));
      },
      paintReading: (el, path) => plugin.paintRefNoteCardReading(el, path),
      removeReading: (root, scope, path) => plugin.refNoteCardRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.refNoteCardRemoveStrays(widget.el, widget.path);
      },
      livePath: (view) => plugin.refNoteCardLivePath(view),
      buildDecorations: (view, update) => plugin.buildRefNoteCardDecorations(view, update),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.refNoteCardCleanEditor(view),
      workspaceEvents: ["layout-change", "file-open", "active-leaf-change"],
      onSetup: () => plugin.refNoteCardOnSetup(),
      onDisposeStart: () => plugin.refNoteCardOnDisposeStart(),
      onDisposeEnd: () => plugin.refNoteCardOnDisposeEnd(),
    });
    return this._refNoteCardPropertyHost;
  }

  setupRefNoteCard() { this.refNoteCardPropertyHost().setup(); }
  teardownRefNoteCard() { this.refNoteCardPropertyHost().dispose(); }

  refNoteCardDesktop() {
    try { return typeof propertyCardDesktop === "function" && propertyCardDesktop() === true; }
    catch (_) { return false; }
  }

  refNoteCardReadingRoot(el) {
    try { return propertyCardReadingRoot(el); } catch (_) { return null; }
  }

  refNoteCardReadingScope(root) {
    try { return propertyCardReadingScope(root); } catch (_) { return root; }
  }

  refNoteCardFrontmatter(path) {
    try { return this.homeCardFrontmatter?.(refNoteCardPath(path)) || this.refNoteCardFootFrontmatter?.(path) || {}; }
    catch (_) { return {}; }
  }

  refNoteCardEligible(path, frontmatter) {
    const key = refNoteCardPath(path);
    if (!key || this.refNoteCardActive !== true) return false;
    try {
      return propertyCardNoteSpecies({
        path: key,
        frontmatter: frontmatter || this.refNoteCardFrontmatter(key),
      }) === REF_NOTE_CARD_HOST_KIND;
    } catch (_) { return false; }
  }

  refNoteCardLivePath(view) {
    if (this.refNoteCardActive !== true || !this.refNoteCardDesktop()) return null;
    try {
      if (refNoteCardScopeDenied(view?.dom, view?.dom)) return null;
      const path = refNoteCardPath(this.notebookCatalogLivePath?.(view) || "");
      return path && this.refNoteCardEligible(path, this.refNoteCardFrontmatter(path)) ? path : null;
    } catch (_) { return null; }
  }

  refNoteCardModelFor(path, sourceText) {
    const key = refNoteCardPath(path);
    if (!this.refNoteCardEligible(key, this.refNoteCardFrontmatter(key))) return null;
    const frontmatter = refNoteCardFrontmatterFromText(sourceText) || this.refNoteCardFrontmatter(key);
    const cache = typeof propertyCardSettledMetadataCache === "function"
      ? propertyCardSettledMetadataCache(this.app) : this.app?.metadataCache;
    try {
      return refNoteCardModel({
        path: key,
        frontmatter,
        sourceText: typeof sourceText === "string" ? sourceText : this.refNoteCardSourceCache?.get?.(key),
        metadataCache: cache,
        vault: this.app?.vault,
        resolveParent: (target, fromPath) => this.homeCardResolveParent?.(target, fromPath) || null,
      });
    } catch (_) { return null; }
  }

  refNoteCardIsCollapsed(path) {
    const key = refNoteCardPath(path);
    if (!(this.refNoteCardCollapsed instanceof Map)) this.refNoteCardCollapsed = new Map();
    const stored = key && this.refNoteCardCollapsed.has(key) ? this.refNoteCardCollapsed.get(key) : null;
    try {
      return propertyCardFoldResolve({
        choice: propertyCardFoldChoiceFromStored(stored),
        problems: "",
        foldDefault: propertyCardSpecies(REF_NOTE_CARD_HOST_KIND)?.foldDefault,
      }) !== true;
    } catch (_) { return false; }
  }

  refNoteCardSetCollapsed(path, collapsed) {
    const key = refNoteCardPath(path);
    if (!key) return false;
    if (!(this.refNoteCardCollapsed instanceof Map)) this.refNoteCardCollapsed = new Map();
    this.refNoteCardCollapsed.set(key, propertyCardFoldChoice(collapsed !== true, ""));
    this.scheduleRefNoteCardRefresh();
    return true;
  }

  refNoteCardRegisterFold() {
    const unregister = propertyCardRegisterFoldKind(this, REF_NOTE_CARD_HOST_KIND, {
      toggle: (path) => this.refNoteCardSetCollapsed(path, !this.refNoteCardIsCollapsed(path)),
    });
    return typeof unregister === "function" ? unregister : () => {};
  }

  // `=` on a ref note: the Reference editor in settings mode when bob
  // reports `props_ref_contract_v1`, else qm.1 focus-or-add on `title`.
  // The route itself lives in 249v; this registration only owns the kind.
  refNoteCardRegisterTitleKey() {
    if (this.refNoteCardTitleKeyRegistered === true) return true;
    if (typeof this.registerPropertyCard !== "function") return false;
    this.refNoteCardTitleKeyRegistered = this.registerPropertyCard({
      kind: REF_NOTE_CARD_HOST_KIND,
      match: ({ path, frontmatter } = {}) => this.refNoteCardEligible(path, frontmatter),
      open: ({ path } = {}) => {
        if (typeof refNoteCardEditorOpen === "function") void refNoteCardEditorOpen(this, path);
      },
    });
    return this.refNoteCardTitleKeyRegistered;
  }

  refNoteCardUnregisterTitleKey() {
    if (this.refNoteCardTitleKeyRegistered === true) {
      try { this.unregisterPropertyCard?.(REF_NOTE_CARD_HOST_KIND); } catch (_) {}
    }
    this.refNoteCardTitleKeyRegistered = false;
  }

  refNoteCardOnSetup() {
    this.refNoteCardActive = true;
    this.refNoteCardEpoch = (this.refNoteCardEpoch || 0) + 1;
    if (!(this.refNoteCardCollapsed instanceof Map)) this.refNoteCardCollapsed = new Map();
    if (!(this.refNoteCardSurfaceScopes instanceof Set)) this.refNoteCardSurfaceScopes = new Set();
    try { propertyCardFrontmatterCoordinatorBind?.(this, REF_NOTE_CARD_HOST_KIND); } catch (_) {}
    try { this.refNoteCardFoldUnregister = this.refNoteCardRegisterFold(); } catch (_) { this.refNoteCardFoldUnregister = null; }
    try { this.refNoteCardFootBind?.(); } catch (_) {}
    this.refNoteCardRegisterTitleKey();
    try { this.refNoteCardRegisterVisibleBodyNavigation?.(); } catch (_) {}
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.refNoteCardResolvedBound) {
        this.refNoteCardResolvedBound = true;
        this.registerEvent(cache.on("resolved", () => this.scheduleRefNoteCardRefresh()));
      }
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.refNoteCardVaultCreateBound) {
        this.refNoteCardVaultCreateBound = true;
        for (const event of ["create", "modify"]) this.registerEvent(vault.on(event, () => this.scheduleRefNoteCardRefresh()));
      }
    } catch (_) {}
  }

  refNoteCardOnDisposeStart() {
    this.refNoteCardActive = false;
    this.refNoteCardEpoch = (this.refNoteCardEpoch || 0) + 1;
    try { propertyCardFrontmatterCoordinatorReleaseKind?.(this, REF_NOTE_CARD_HOST_KIND); } catch (_) {}
    try { this.refNoteCardFoldUnregister?.(); } catch (_) {}
    this.refNoteCardFoldUnregister = null;
    try { this.refNoteCardFootUnbind?.(); } catch (_) {}
    try { this.refNoteCardReadoutsUnbind?.(); } catch (_) {}
    this.refNoteCardUnregisterTitleKey();
  }

  refNoteCardOnDisposeEnd() {
    this.refNoteCardCollapsed?.clear?.();
    this.refNoteCardSourceCache?.clear?.();
    this.refNoteCardSourceFlights?.clear?.();
    this.refNoteCardResolvedBound = false;
    this.refNoteCardVaultCreateBound = false;
  }

  refNoteCardCleanEditor(view) {
    const scope = view?.dom || null;
    const path = refNoteCardPath(this.refNoteCardLivePath(view) || "");
    try { this.refNoteCardReadoutUnsubscribePath?.(path); } catch (_) {}
    try { this.refNoteCardTrackFoot?.(scope, path, null); } catch (_) {}
    try { propertyCardAdoptRelease?.(scope, path || undefined, REF_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: REF_NOTE_CARD_HOST_KIND, path }); } catch (_) {}
    try { this.refNoteCardPropertyHost().cleanEditor(view, { unmark: (root) => root?.classList?.remove?.(REF_NOTE_CARD_HOST_SURFACE_CLASS) }); } catch (_) {}
  }

  refNoteCardOwnMounted(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const plugin = this;
    const sourceFor = () => {
      try { if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString(); } catch (_) {}
      return plugin.refNoteCardSourceCache?.get?.(refNoteCardPath(path));
    };
    return propertyCardFrontmatterOwnMounted(plugin, {
      scope,
      view: view && view.dom === scope ? view : null,
      path: refNoteCardPath(path),
      kind: REF_NOTE_CARD_HOST_KIND,
      mount,
      sourceText,
      getSource: sourceFor,
      currentPath,
      isCurrent: () => Boolean(plugin.refNoteCardActive === true
        && plugin.refNoteCardModelFor(path, sourceFor())),
      active: () => plugin.refNoteCardActive === true,
    });
  }

  refNoteCardBuildMounted(model, options, doc, footSpec) {
    const card = refNoteCardBuildEl(doc, model, {
      ...options,
      appendFoot: (parent, currentModel, ownerDoc) => this.refNoteCardAppendFoot(
        parent, model.path, currentModel, ownerDoc, footSpec, options,
      ),
    });
    if (!card) return null;
    card.setAttribute(REF_NOTE_CARD_MOUNT_ATTR, model.path);
    return card;
  }

  refNoteCardReadOptions(path, model, keyLive) {
    return {
      collapsed: this.refNoteCardIsCollapsed(path),
      reducedMotion: propertyCardFootReducedMotion?.() === true,
      keyLive: keyLive === true,
      pdfMode: this.refNoteCardPdfMode(),
      onToggleFold: (collapsed) => this.refNoteCardSetCollapsed(path, collapsed),
      onLink: (target, event) => { void this.homeCardOpenPath?.(target, path, event); },
      onOpenPdf: (target) => { void this.refNoteCardOpenPdf(path, target); },
      onListen: (target) => { void this.refNoteCardOpenVaultPath(path, target); },
    };
  }

  refNoteCardSignature(model, extra, options) {
    try {
      let readoutDigest = "none";
      try {
        if (typeof this.refNoteCardReadoutFor === "function" && model && model.path) {
          readoutDigest = refNoteCardReadoutDigest(this.refNoteCardReadoutFor(model.path, model));
        }
      } catch (_) {
        readoutDigest = "readout";
      }
      return JSON.stringify([
        model,
        extra?.footDigest || "",
        extra?.footOpen === true,
        options?.collapsed === true,
        options?.keyLive === true,
        options?.pdfMode || "",
        typeof this.openPropertyEditor === "function",
        readoutDigest,
      ]);
    } catch (_) { return ""; }
  }

  refNoteCardModelWithTone(model, readout) {
    try {
      const tone = readout && typeof readout.tone === "string" ? readout.tone : "";
      if (!tone || !model || model.tone === tone) return model;
      return { ...model, tone };
    } catch (_) {
      return model;
    }
  }

  refNoteCardReadingView(scope) {
    try { return propertyCardReadingViewFor(this.app, scope); } catch (_) { return null; }
  }

  refNoteCardReadingCards(root, path, exclude = null) {
    const key = refNoteCardPath(path);
    return Array.from(root?.querySelectorAll?.(`.${REF_NOTE_CARD_SURFACE_CLASS}`) || []).filter((node) => {
      if (node === exclude || !propertyCardNodeBelongs(node, root) || node.getAttribute?.("data-cm-widget") === "true") return false;
      const owner = refNoteCardPath(node.getAttribute?.(REF_NOTE_CARD_MOUNT_ATTR));
      return !key || !owner || owner === key;
    });
  }

  refNoteCardRemoveStrays(root, path) {
    const key = refNoteCardPath(path);
    for (const node of Array.from(root?.querySelectorAll?.(`.${REF_NOTE_CARD_SURFACE_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") !== "true") continue;
      if (refNoteCardPath(node.getAttribute?.(REF_NOTE_CARD_MOUNT_ATTR)) !== key) continue;
      try { node.remove?.(); } catch (_) {}
    }
  }

  refNoteCardFocusKey(node, doc) {
    try {
      const active = doc?.activeElement;
      if (!active || !node?.contains?.(active)) return "";
      return active.getAttribute?.("data-foot-focus") || active.getAttribute?.("aria-label") || "";
    } catch (_) { return ""; }
  }

  refNoteCardRestoreFocus(node, key) {
    if (!key || !node?.querySelector) return;
    try {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/["\\]/g, "\\$&");
      node.querySelector(`[data-foot-focus="${escaped}"], [aria-label="${escaped}"]`)?.focus?.();
    } catch (_) {}
  }

  refNoteCardReadingAnchor(root) {
    try { return Array.from(root?.querySelectorAll?.("h1") || []).find((node) => !notebookInsideCode(node)) || null; }
    catch (_) { return null; }
  }

  paintRefNoteCardReading(el, sourcePath) {
    const path = refNoteCardPath(sourcePath);
    const root = this.refNoteCardReadingRoot(el);
    const scope = this.refNoteCardReadingScope(root);
    if (!root || !scope || !path || !this.refNoteCardDesktop() || refNoteCardScopeDenied(scope, root)
      || !this.refNoteCardEligible(path, this.refNoteCardFrontmatter(path))) {
      this.refNoteCardRemoveReading(root, scope, path);
      return null;
    }
    this.refNoteCardRemoveStrays(root, path);
    void this.refNoteCardEnsureSource?.(path);
    const sourceText = this.refNoteCardSourceCache?.get?.(path);
    const model = this.refNoteCardModelFor(path, sourceText);
    const reading = scope.classList?.contains?.("markdown-preview-view") ? this.refNoteCardReadingView(scope) : null;
    const currentPath = reading?.currentPath?.() || "";
    if (!model || (currentPath && refNoteCardPath(currentPath) !== path)) {
      this.refNoteCardRemoveReading(root, scope, path);
      return null;
    }
    const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createElement !== "function") {
      this.refNoteCardRemoveReading(root, scope, path);
      return null;
    }
    const extra = this.refNoteCardFootExtra(path, model);
    const options = this.refNoteCardReadOptions(path, model, false);
    const readout = this.refNoteCardReadoutFor?.(path, model) || null;
    const viewModel = this.refNoteCardModelWithTone(model, readout);
    const signature = this.refNoteCardSignature(viewModel, extra, options);
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === path && adopted.kind === REF_NOTE_CARD_HOST_KIND
      && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.refNoteCardReadingCards(root, path, slotNode);
    let card = slotNode || bodyNodes[0] || null;
    const focus = this.refNoteCardFocusKey(card, doc);
    if (!card || refNoteCardNodeSignatures.get(card) !== signature) {
      const fresh = this.refNoteCardBuildMounted(viewModel, options, doc, extra?.footSpec);
      if (!fresh) {
        this.refNoteCardRemoveReading(root, scope, path);
        return null;
      }
      card = card ? propertyCardAdoptPatch(card, fresh) : fresh;
      refNoteCardNodeSignatures.set(card, signature);
    }
    for (const node of bodyNodes) if (node !== card) { try { node.remove?.(); } catch (_) {} }
    const plugin = this;
    const current = reading?.currentPath || (() => "");
    const adoption = propertyCardAdoptTitle(scope, card, {
      path,
      kind: REF_NOTE_CARD_HOST_KIND,
      view: reading?.view || null,
      currentPath: current,
      recognizer: propertyCardHomeTitleRecognizer(model.title.text),
      onLost: () => this.scheduleRefNoteCardRefresh(),
      onMount: (mount) => plugin.refNoteCardOwnMounted(scope, reading?.view || null, path, mount, sourceText, current),
    });
    if (adoption.mode === "slot") {
      void this.refNoteCardOwnMounted(scope, reading?.view || null, path, card, sourceText, current);
    } else {
      propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: REF_NOTE_CARD_HOST_KIND, path });
      propertyCardDemoteTitleHeading?.(card);
      const anchor = this.refNoteCardReadingAnchor(root);
      try {
        if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(card, anchor);
        else if (root.insertBefore) root.insertBefore(card, root.firstChild || null);
        else root.prepend?.(card);
      } catch (_) {
        this.refNoteCardRemoveReading(root, scope, path);
        return null;
      }
    }
    scope.classList?.add?.(REF_NOTE_CARD_HOST_SURFACE_CLASS);
    this.refNoteCardSurfaceScopes?.add?.(scope);
    this.refNoteCardTrackFoot?.(scope, path, card);
    try { this.refNoteCardReadoutSubscribe?.(path); } catch (_) {}
    try {
      this.refNoteCardPaintReadouts?.(card, path, doc, {
        scope, view: reading?.view || null, collapsed: options.collapsed === true, model: viewModel,
      });
    } catch (_) {}
    this.refNoteCardRestoreFocus(card, focus);
    void this.refNoteCardEnsureSource?.(path);
    return card;
  }

  refNoteCardRemoveReading(root, scope = root, sourcePath = "") {
    const path = refNoteCardPath(sourcePath);
    try { this.refNoteCardReadoutUnsubscribePath?.(path); } catch (_) {}
    if (!root && !scope) return;
    try { this.refNoteCardTrackFoot?.(scope, path, null); } catch (_) {}
    try { propertyCardAdoptRelease?.(scope, path || undefined, REF_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: REF_NOTE_CARD_HOST_KIND, path }); } catch (_) {}
    for (const node of this.refNoteCardReadingCards(root, path)) {
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    const anotherOwner = Array.from(this.refNoteCardReading || []).some((item) => item.surface === root && item.path !== path);
    if (!anotherOwner) {
      scope?.classList?.remove?.(REF_NOTE_CARD_HOST_SURFACE_CLASS);
      this.refNoteCardSurfaceScopes?.delete?.(scope);
    }
  }

  refNoteCardSetEditorScope(view, enabled) {
    try {
      return this.refNoteCardPropertyHost().setEditorScope(view, enabled, {
        scopeOf: (root) => root?.closest?.(".markdown-source-view") || root,
        mark: (scope) => scope?.classList?.add?.(REF_NOTE_CARD_HOST_SURFACE_CLASS),
        unmark: (scope) => scope?.classList?.remove?.(REF_NOTE_CARD_HOST_SURFACE_CLASS),
      });
    } catch (_) { return null; }
  }

  refNoteCardFallbackAnchor(text) {
    try {
      const anchor = notebookHeaderLiveAnchor(text);
      if (Number.isInteger(anchor) && anchor >= 0) return { line: anchor, after: false };
    } catch (_) {}
    try {
      const end = notebookHeaderFrontmatterEnd(text);
      if (Number.isInteger(end) && end >= 0) return { line: end + 1, after: false };
    } catch (_) {}
    return null;
  }

  refNoteCardPatchLive(view, adopted, fresh, signature) {
    try {
      const patched = propertyCardAdoptPatch(adopted.node, fresh);
      refNoteCardNodeSignatures.set(patched, signature);
      if (adopted.pending === true) return true;
      const effect = this.refNoteCardPropertyHost().ensureRefreshEffect();
      if (effect && typeof view.dispatch === "function") view.dispatch({ effects: effect.of({ refresh: true }) });
      else this.scheduleRefNoteCardRefresh();
      return true;
    } catch (_) { return false; }
  }

  buildRefNoteCardDecorations(view) {
    const path = this.refNoteCardLivePath(view);
    if (!path) {
      this.refNoteCardCleanEditor(view);
      return Decoration?.none || null;
    }
    let sourceText = "";
    try { sourceText = view.state.doc.toString(); } catch (_) {}
    if (!sourceText) {
      this.refNoteCardCleanEditor(view);
      return Decoration?.none || null;
    }
    this.refNoteCardRememberSource(path, sourceText);
    const model = this.refNoteCardModelFor(path, sourceText);
    this.refNoteCardSetEditorScope(view, Boolean(model));
    if (!model) {
      try { propertyCardAdoptRelease?.(view.dom, path, REF_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
      try { propertyCardFrontmatterReleaseMounted?.(view.dom, { plugin: this, kind: REF_NOTE_CARD_HOST_KIND, path }); } catch (_) {}
      try { this.refNoteCardTrackFoot?.(view.dom, path, null); } catch (_) {}
      return Decoration?.none || null;
    }
    if (!Decoration || !WidgetType || !RangeSetBuilder) return Decoration?.none || null;
    const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
    const extra = this.refNoteCardFootExtra(path, model);
    const options = this.refNoteCardReadOptions(path, model, propertyCardFoldKeyLive?.(this, "live-preview") === true);
    const readout = this.refNoteCardReadoutFor?.(path, model) || null;
    const viewModel = this.refNoteCardModelWithTone(model, readout);
    const signature = this.refNoteCardSignature(viewModel, extra, options);
    const adopted = propertyCardAdoptedEntry(view.dom);
    let card = adopted && adopted.path === path && adopted.kind === REF_NOTE_CARD_HOST_KIND && adopted.mode === "slot"
      ? adopted.node : null;
    if (!card || refNoteCardNodeSignatures.get(card) !== signature) {
      const fresh = this.refNoteCardBuildMounted(viewModel, options, doc, extra?.footSpec);
      if (!fresh) {
        this.refNoteCardCleanEditor(view);
        return Decoration.none;
      }
      if (card) this.refNoteCardPatchLive(view, adopted, fresh, signature);
      else { card = fresh; refNoteCardNodeSignatures.set(card, signature); }
    }
    const plugin = this;
    const currentPath = () => plugin.refNoteCardLivePath(view) || "";
    const adoption = propertyCardAdoptTitle(view.dom, card, {
      path,
      kind: REF_NOTE_CARD_HOST_KIND,
      view,
      currentPath,
      recognizer: propertyCardHomeTitleRecognizer(model.title.text),
      onLost: () => this.scheduleRefNoteCardRefresh(),
      onMount: (mount) => plugin.refNoteCardOwnMounted(
        view.dom, view, path, mount, view?.state?.doc?.toString?.() || sourceText, currentPath,
      ),
    });
    this.refNoteCardTrackFoot?.(view.dom, path, card);
    try { this.refNoteCardReadoutSubscribe?.(path); } catch (_) {}
    try {
      this.refNoteCardPaintReadouts?.(card, path, doc, {
        scope: view.dom, view, editor: view.editor, collapsed: options.collapsed, model: viewModel,
      });
    } catch (_) {}
    if (adoption.mode === "slot") {
      void this.refNoteCardOwnMounted(view.dom, view, path, card, sourceText, currentPath);
      return Decoration.none;
    }
    propertyCardFrontmatterReleaseMounted?.(view.dom, { plugin: this, kind: REF_NOTE_CARD_HOST_KIND, path });
    propertyCardDemoteTitleHeading?.(card);
    const anchor = this.refNoteCardFallbackAnchor(sourceText);
    let at = 0;
    if (anchor && view.state.doc?.line) {
      try {
        const line = view.state.doc.line(anchor.line + 1);
        at = anchor.after ? line.to : line.from;
      } catch (_) {}
    }
    const widget = new class extends WidgetType {
      constructor() { super(); this.path = path; this.signature = signature; }
      eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
      toDOM() {
        card.setAttribute?.("data-cm-widget", "true");
        card.setAttribute?.(REF_NOTE_CARD_MOUNT_ATTR, path);
        return card;
      }
      destroy() {}
    }();
    const builder = new RangeSetBuilder();
    builder.add(at, at, Decoration.widget({ widget, side: -1 }));
    return builder.finish();
  }

  refNoteCardPdfMode() {
    try {
      const nav = this.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
      return Platform?.isMacOS === true && typeof nav?.api?.openReferencePdf === "function" ? "highlights" : "obsidian";
    } catch (_) { return "obsidian"; }
  }

  refNoteCardOpenVaultPath(notePath, target) {
    const path = refNoteCardPath(notePath);
    const file = refNoteCardVaultPath(target);
    if (!path || !file) return false;
    try {
      const open = this.app?.workspace?.openLinkText;
      if (typeof open !== "function") return false;
      void open.call(this.app.workspace, file, path, true);
      return true;
    } catch (_) { return false; }
  }

  refNoteCardOpenPdf(notePath, target) {
    const path = refNoteCardPath(notePath);
    const pdf = refNoteCardVaultPath(target, ".pdf");
    if (!path || !pdf) return false;
    try {
      const nav = this.app?.plugins?.plugins?.["bob-navigation-hotkeys"];
      const open = nav?.api?.openReferencePdf;
      if (Platform?.isMacOS === true && typeof open === "function") {
        Promise.resolve(open.call(nav.api, pdf)).catch(() => this.refNoteCardOpenVaultPath(path, pdf));
        return true;
      }
    } catch (_) {}
    return this.refNoteCardOpenVaultPath(path, pdf);
  }

  scheduleRefNoteCardRefresh() {
    try { this.refNoteCardPropertyHost()?.scheduleRefresh?.(); } catch (_) {}
  }
}
