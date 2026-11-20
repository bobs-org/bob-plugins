// Intention-card display adapter for the shared property-card host.
const INTENTION_CARD_CLASS = "bob-intention-card";
const INTENTION_CARD_REFRESH_MS = 100;
// Reading view can bind a note before its H1 and navigation sections attach
// (an LP → Reading switch re-renders only changed sections). A surface with no
// anchor yet retries through the host refresh, bounded per surface.
const INTENTION_CARD_READING_RETRIES = 30;

function intentionCardFilePath(value) {
  return intentionCardPath(value);
}

class BobLedgerToolsIntentionCardMixin {
  intentionCardHost() {
    if (this._intentionCardHost) return this._intentionCardHost;
    const plugin = this;
    this._intentionCardHost = createPropertyCardHost({
      plugin,
      kind: "intentions",
      readingPriority: 48,
      allowEmbedDisplay: false,
      fields: {
        active: "intentionCardActive",
        reading: "intentionCardReading",
        readingPending: "intentionCardReadingPending",
        readingTimers: "intentionCardReadingTimers",
        editors: "intentionCardEditors",
        editorScopes: "intentionCardEditorScopes",
        refreshTimer: "intentionCardRefreshTimer",
        keySlots: "intentionCardKeySlots",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout ? plugin.albumSetTimeout(fn, ms) : setTimeout(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout ? plugin.albumClearTimeout(id) : clearTimeout(id),
      pathOf: intentionCardFilePath,
      readingRoot: (el) => propertyCardReadingRoot(el),
      readingScope: (root) => propertyCardReadingScope(root),
      acceptReading: (el, ctx) => plugin.intentionCardCanDisplay(ctx?.sourcePath, el),
      paintReading: (el, path) => plugin.paintIntentionCardReading(el, path),
      removeReading: (root, scope, path) => plugin.removeIntentionCardReading(root, scope, path),
      ownKeys: (scope, path) => plugin.intentionCardOwn(scope, path),
      releaseKeys: (scope, path) => plugin.intentionCardRelease(scope, path),
      livePath: (view) => plugin.intentionCardLivePath(view),
      buildDecorations: (view) => plugin.buildIntentionCardDecorations(view),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.intentionCardCleanEditor(view),
      workspaceEvents: ["layout-change", "file-open"],
      onWorkspaceEvent: () => plugin.intentionCardScheduleReadingViewMount(),
      onSetup: () => plugin.intentionCardOnSetup(),
      onDisposeStart: () => plugin.intentionCardOnDisposeStart(),
      onDisposeEnd: () => plugin.intentionCardOnDisposeEnd(),
    });
    return this._intentionCardHost;
  }

  setupIntentionCard() {
    this.intentionCardHost().setup();
  }

  teardownIntentionCard() {
    this.intentionCardHost().dispose();
  }

  intentionCardDesktop() {
    return typeof propertyCardDesktop === "function" ? propertyCardDesktop() : true;
  }

  intentionCardCanDisplay(path, surface) {
    if (!this.intentionCardActive || !this.intentionCardDesktop()) return false;
    if (!intentionCardSubjectForPath(path, this.intentionCardToday())) return false;
    if (surface?.closest?.(".cm-editor, .markdown-embed, .internal-embed, .hover-popover, pre, code")) return false;
    if (surface?.closest?.(`[${INTENTION_CARD_RENDER_ATTR}], .bob-property-card`)) return false;
    return true;
  }

  intentionCardToday(now = new Date()) {
    return typeof dayStripLocalToday === "function" ? dayStripLocalToday(now) : intentionCardDateText(now);
  }

  intentionCardLivePath(view) {
    if (!this.intentionCardActive || !this.intentionCardDesktop() || !this.intentionCardLivePreview(view)) return null;
    try {
      if (view?.dom?.closest?.(".markdown-embed, .internal-embed, .hover-popover")) return null;
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) { return null; }
  }

  intentionCardLivePreview(view) {
    try { return Boolean(editorLivePreviewField && view?.state?.field?.(editorLivePreviewField) === true); }
    catch (_) { return false; }
  }

  intentionCardOnSetup() {
    this.intentionCardEnsureMaps();
    this.intentionCardDay = this.intentionCardToday();
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(cache.on("changed", (file) => this.intentionCardOnMetadata(file)));
      }
    } catch (_) {}
    this.intentionCardScheduleMidnight();
  }

  intentionCardEnsureMaps() {
    if (!(this.intentionCardSourceCache instanceof Map)) this.intentionCardSourceCache = new Map();
    if (!(this.intentionCardSourceFlights instanceof Map)) this.intentionCardSourceFlights = new Map();
    if (!(this.intentionCardSourceEpochs instanceof Map)) this.intentionCardSourceEpochs = new Map();
    if (!(this.intentionCardUnconfirmedSource instanceof Map)) this.intentionCardUnconfirmedSource = new Map();
    if (!(this.intentionCardKeySlots instanceof Map)) this.intentionCardKeySlots = new Map();
    if (!Number.isInteger(this.intentionCardSourceGeneration)) this.intentionCardSourceGeneration = 0;
  }

  // Every invalidation (metadata change, unload) advances the path epoch, so
  // a read that started earlier can never write its old source back.
  intentionCardSourceEpoch(path) {
    return `${this.intentionCardSourceGeneration || 0}:${this.intentionCardSourceEpochs?.get?.(path) || 0}`;
  }

  intentionCardInvalidateSource(path) {
    this.intentionCardEnsureMaps();
    this.intentionCardSourceEpochs.set(path, (this.intentionCardSourceEpochs.get(path) || 0) + 1);
    this.intentionCardSourceCache.delete(path);
    this.intentionCardUnconfirmedSource.delete(path);
    this.intentionCardSourceFlights.delete(path);
  }

  intentionCardOnDisposeStart() {
    if (this.intentionCardMidnightTimer != null) {
      if (this.albumClearTimeout) this.albumClearTimeout(this.intentionCardMidnightTimer);
      else clearTimeout(this.intentionCardMidnightTimer);
    }
    this.intentionCardMidnightTimer = null;
    this.intentionCardSourceGeneration = (this.intentionCardSourceGeneration || 0) + 1;
    this.intentionCardSourceFlights?.clear?.();
  }

  intentionCardOnDisposeEnd() {
    this.intentionCardSourceCache?.clear?.();
    this.intentionCardUnconfirmedSource?.clear?.();
    this.intentionCardSourceEpochs?.clear?.();
    this.intentionCardKeySlots?.clear?.();
    this.intentionCardDay = "";
  }

  intentionCardScheduleMidnight(now = new Date()) {
    if (this.intentionCardMidnightTimer != null) {
      if (this.albumClearTimeout) this.albumClearTimeout(this.intentionCardMidnightTimer);
      else clearTimeout(this.intentionCardMidnightTimer);
    }
    const next = new Date(now.getTime());
    next.setHours(24, 0, 100, 0);
    const delay = Math.max(50, next.getTime() - now.getTime());
    const tick = () => {
      this.intentionCardMidnightTimer = null;
      const today = this.intentionCardToday();
      if (today !== this.intentionCardDay) {
        this.intentionCardDay = today;
        this.intentionCardHost().scheduleRefresh();
      }
      this.intentionCardScheduleMidnight();
    };
    this.intentionCardMidnightTimer = this.albumSetTimeout
      ? this.albumSetTimeout(tick, delay)
      : setTimeout(tick, delay);
    this.intentionCardMidnightTimer?.unref?.();
  }

  // Metadata settles the path's applied overlay (match, still-prior, or
  // conflict), invalidates its source epoch, and re-reads at once so the next
  // paint finds confirmed source instead of flashing native Properties.
  intentionCardOnMetadata(file) {
    if (!this.intentionCardActive) return;
    const path = intentionCardFilePath(file?.path);
    if (!path || !intentionCardSubjectForPath(path, this.intentionCardToday())) return;
    try {
      if (typeof this.intentionCardSettleOverlay === "function") {
        this.intentionCardSettleOverlay(path, this.intentionCardCache(path)?.cache?.frontmatter || {});
      }
    } catch (_) {}
    try { this.intentionCardEditorModal?.intentionOnMetadata?.(path); } catch (_) {}
    this.intentionCardInvalidateSource(path);
    void this.intentionCardEnsureSource(path);
    this.intentionCardHost().scheduleRefresh();
  }

  intentionCardCache(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      return file ? { file, cache: this.app?.metadataCache?.getFileCache?.(file) || null } : null;
    } catch (_) { return null; }
  }

  async intentionCardEnsureSource(path) {
    this.intentionCardEnsureMaps();
    const key = intentionCardFilePath(path);
    if (!key) return null;
    const cached = this.intentionCardSourceCache?.get?.(key);
    if (cached) return cached;
    const flight = this.intentionCardSourceFlights?.get?.(key);
    if (flight) return flight;
    const epoch = this.intentionCardSourceEpoch(key);
    const current = () => this.intentionCardActive !== false && this.intentionCardSourceEpoch(key) === epoch;
    let promise = null;
    promise = (async () => {
      const fileInfo = this.intentionCardCache(key);
      if (!fileInfo?.file || !fileInfo.cache || typeof this.app?.vault?.read !== "function") return null;
      let source = "";
      try { source = await this.app.vault.read(fileInfo.file); } catch (_) { return null; }
      // Pinned to the path epoch: a read that outlived a metadata change or
      // unload never resurrects its old content.
      if (!current()) return null;
      const latest = this.intentionCardCache(key)?.cache || fileInfo.cache;
      const evidence = intentionCardFrontmatterEvidence(source, latest.frontmatter || {});
      if (!evidence.ok) {
        // Metadata lags a write: keep the parsed source only as the base an
        // applied overlay may paint over. It never paints on its own.
        const parsed = evidence.reason === "stale-metadata-cache" ? intentionCardParseFrontmatter(source) : null;
        if (parsed?.ok) {
          this.intentionCardUnconfirmedSource.set(key, { path: key, source, frontmatter: parsed.frontmatter });
          if (this.intentionCardOverlayFor?.(key)) this.intentionCardHost().scheduleRefresh();
        }
        return null;
      }
      const entry = { path: key, source, frontmatter: evidence.frontmatter };
      this.intentionCardSourceCache.set(key, entry);
      this.intentionCardUnconfirmedSource.delete(key);
      this.intentionCardHost().scheduleRefresh();
      return entry;
    })().finally(() => {
      if (this.intentionCardSourceFlights?.get?.(key) === promise) this.intentionCardSourceFlights.delete(key);
    });
    this.intentionCardSourceFlights.set(key, promise);
    return promise;
  }

  // Source an applied overlay may paint over when metadata has not caught up
  // with the write. Malformed source stays a fail-open refusal.
  intentionCardOverlaySource(path, sourceText) {
    if (typeof sourceText === "string") {
      const parsed = intentionCardParseFrontmatter(sourceText);
      return parsed.ok ? { path, source: sourceText, frontmatter: parsed.frontmatter } : null;
    }
    return this.intentionCardSourceCache?.get?.(path) || this.intentionCardUnconfirmedSource?.get?.(path) || null;
  }

  intentionCardOverlayFrontmatterFor(path, frontmatter) {
    const overlay = typeof this.intentionCardOverlayFor === "function" ? this.intentionCardOverlayFor(path) : null;
    if (!overlay || typeof intentionCardOverlayFrontmatter !== "function") return { overlay: null, frontmatter };
    return { overlay, frontmatter: intentionCardOverlayFrontmatter(frontmatter, overlay) };
  }

  intentionCardConfirmedSource(path, sourceText) {
    this.intentionCardEnsureMaps();
    const key = intentionCardFilePath(path);
    if (typeof sourceText !== "string") return this.intentionCardSourceCache?.get?.(key) || null;
    const info = this.intentionCardCache(key);
    if (!info?.file || !info.cache) return null;
    const evidence = intentionCardFrontmatterEvidence(sourceText, info.cache.frontmatter || {});
    if (!evidence.ok) {
      void this.intentionCardEnsureSource(key);
      return null;
    }
    const entry = { path: key, source: sourceText, frontmatter: evidence.frontmatter };
    this.intentionCardSourceCache.set(key, entry);
    return entry;
  }

  // The display model reads metadata-confirmed source; an applied overlay
  // (never a pending preview) bridges metadata that lags its write, including
  // the first field on an empty note and removing the last one. Gates stay:
  // malformed source, Source mode, embeds, and mobile never reach here.
  intentionCardModelFor(path, sourceText) {
    this.intentionCardEnsureMaps();
    const today = this.intentionCardToday();
    const key = intentionCardFilePath(path);
    let current = this.intentionCardConfirmedSource(path, sourceText);
    const hasOverlay = Boolean(typeof this.intentionCardOverlayFor === "function" && this.intentionCardOverlayFor(key));
    if (!current && hasOverlay) current = this.intentionCardOverlaySource(key, sourceText);
    if (!current) {
      void this.intentionCardEnsureSource(path);
      return null;
    }
    const subject = intentionCardSubjectForPath(path, today);
    const placement = intentionCardPlacement(current.source, subject, today);
    if (!subject || !placement) return null;
    let parentFrontmatter = null;
    if (subject.parent) {
      const parentPath = subject.parent.path;
      const parent = this.intentionCardSourceCache?.get?.(parentPath)
        || (this.intentionCardOverlayFor?.(parentPath) ? this.intentionCardUnconfirmedSource?.get?.(parentPath) : null)
        || null;
      if (!parent) void this.intentionCardEnsureSource(parentPath);
      const merged = this.intentionCardOverlayFrontmatterFor(parentPath, parent?.frontmatter || null);
      parentFrontmatter = parent || merged.overlay ? merged.frontmatter : null;
    }
    const own = this.intentionCardOverlayFrontmatterFor(key, current.frontmatter);
    let model = intentionCardModelFor(path, own.frontmatter, today, parentFrontmatter);
    if (model && own.overlay) model = intentionCardOverlayModel(model, own.overlay, own.frontmatter);
    return model ? { model, source: current.source, placement, subject } : null;
  }

  intentionCardOwn(scope, path) {
    if (!scope || !path) return null;
    let release = null;
    try { release = propertyCardOwnKeys(scope, INTENTION_CARD_OWNED_KEYS); } catch (_) {}
    return propertyCardSlotOwn(this.intentionCardKeySlots, scope, path, release);
  }

  intentionCardRelease(scope, path = "") {
    return propertyCardSlotRelease(this.intentionCardKeySlots, scope, path);
  }

  intentionCardRemoveNodes(root, path = "") {
    for (const node of Array.from(root?.querySelectorAll?.(`.${INTENTION_CARD_CLASS}`) || [])) {
      const owned = intentionCardFilePath(node.getAttribute?.("data-intention-source") || "");
      if (path && owned && owned !== intentionCardFilePath(path)) continue;
      intentionCardDomRelease(node);
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
  }

  removeIntentionCardReading(root, scope = root, sourcePath = "") {
    this.intentionCardRemoveNodes(root, sourcePath);
    this.intentionCardRelease(scope, sourcePath);
  }

  paintIntentionCardReading(el, sourcePath) {
    const root = propertyCardReadingRoot(el);
    const scope = propertyCardReadingScope(root);
    if (!root || !sourcePath || !this.intentionCardCanDisplay(sourcePath, el)) {
      this.removeIntentionCardReading(root, scope, sourcePath);
      return null;
    }
    this.intentionCardRemoveNodes(root, sourcePath);
    this.intentionCardRelease(scope, sourcePath);
    const prepared = this.intentionCardModelFor(sourcePath);
    if (!prepared) return null;
    const anchor = intentionCardDomAnchor(root, prepared.subject, this.intentionCardToday());
    if (!anchor) {
      this.intentionCardRetryReading(root);
      return null;
    }
    this.intentionCardReadingRetries?.delete?.(root);
    const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    const card = intentionCardBuildDom(prepared.model, this, doc);
    if (!card) return null;
    // Obsidian's preview renderer owns the sizer's direct children and prunes
    // foreign ones, so a section-level anchor hosts the card inside itself,
    // after its own content (as the notebook header does inside the H1 section).
    if (anchor.parentNode === root && typeof anchor.appendChild === "function") anchor.appendChild(card);
    else if (anchor.parentNode?.insertBefore) anchor.parentNode.insertBefore(card, anchor.nextElementSibling || null);
    else if (root.insertBefore) root.insertBefore(card, anchor.nextElementSibling || null);
    else root.appendChild?.(card);
    if (!card.parentNode) return null;
    this.intentionCardHost().commitMount(scope, sourcePath, true);
    return card;
  }

  intentionCardRetryReading(root) {
    if (!root) return;
    if (!(this.intentionCardReadingRetries instanceof WeakMap)) this.intentionCardReadingRetries = new WeakMap();
    const count = this.intentionCardReadingRetries.get(root) || 0;
    if (count >= INTENTION_CARD_READING_RETRIES) return;
    this.intentionCardReadingRetries.set(root, count + 1);
    this.intentionCardHost().scheduleRefresh();
  }

  intentionCardScheduleReadingViewMount() {
    this.intentionCardHost().scheduleRefresh();
  }

  // CodeMirror refuses block decorations from a ViewPlugin, so the card is an
  // inline widget at the end of the line just before the first unrelated
  // block (side 1), like the album and bank headers; CSS makes it a block.
  intentionCardLiveAnchor(text, subject) {
    const placement = intentionCardPlacement(text, subject, this.intentionCardToday());
    if (!placement) return null;
    const lines = String(text || "").split(/\r\n|\r|\n/);
    const lineIndex = Math.max(placement.headingLine, placement.insertBeforeLine - 1);
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      offset += (lines[index] || "").length + 1;
    }
    offset += (lines[lineIndex] || "").length;
    return { placement, lineIndex, offset: Math.min(offset, String(text || "").length) };
  }

  buildIntentionCardDecorations(view) {
    const plugin = this;
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType || !view?.state?.doc) return Decoration?.none || null;
      const path = this.intentionCardLivePath(view);
      if (!path) {
        this.intentionCardHost().setEditorScope(view, false);
        this.intentionCardRelease(view?.dom);
        return Decoration.none;
      }
      const source = view.state.doc.toString();
      const prepared = this.intentionCardModelFor(path, source);
      if (!prepared) {
        this.intentionCardHost().setEditorScope(view, false);
        this.intentionCardRelease(view?.dom);
        return Decoration.none;
      }
      const anchor = this.intentionCardLiveAnchor(source, prepared.subject);
      if (!anchor) {
        this.intentionCardHost().setEditorScope(view, false);
        this.intentionCardRelease(view?.dom);
        return Decoration.none;
      }
      this.intentionCardHost().setEditorScope(view, true);
      const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) {
        this.intentionCardRelease(view?.dom);
        return Decoration.none;
      }
      const model = prepared.model;
      const signature = JSON.stringify([path, anchor.offset, model]);
      // Built lazily: CodeMirror discards an equal widget without toDOM, and
      // destroy() unloads the card's render component with its DOM.
      const Widget = class extends WidgetType {
        constructor() { super(); this.signature = signature; this.path = path; }
        eq(other) { return other?.signature === signature && other?.path === path; }
        toDOM() {
          const element = intentionCardBuildDom(model, plugin, doc) || doc.createElement("span");
          element.setAttribute("data-cm-widget", "true");
          plugin.intentionCardHost().commitMount(view.dom, path, true);
          return element;
        }
        destroy(dom) { intentionCardDomRelease(dom); }
        ignoreEvent() { return true; }
      };
      const widget = new Widget();
      const decoration = Decoration.widget({ widget, side: 1 });
      const builder = new RangeSetBuilder();
      builder.add(anchor.offset, anchor.offset, decoration);
      return builder.finish();
    } catch (_) {
      return Decoration?.none || null;
    }
  }

  intentionCardCleanEditor(view) {
    this.intentionCardHost().cleanEditor(view);
    this.intentionCardRelease(view?.dom);
  }
}
