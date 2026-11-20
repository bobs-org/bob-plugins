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
      // Day and period cards own the note title in the title slot; the host
      // registers the kit field once and releases every title on dispose.
      titleOwnership: true,
      workspaceEvents: ["layout-change", "file-open", "active-leaf-change"],
      onWorkspaceEvent: () => plugin.intentionCardScheduleReadingViewMount(),
      onRefresh: () => plugin.intentionCardSweepTitleSlots(),
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
    try { this.intentionCardSlotReleaseAll?.(); } catch (_) {}
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
    if (!model) return null;
    model = { ...model };
    // The title recognizer reads the alias from metadataCache (the overlay
    // never changes aliases); the rail reads the same source text.
    const aliasSource = this.intentionCardCache(key)?.cache?.frontmatter || own.frontmatter;
    const recognizer = typeof intentionCardTitleRecognizer === "function"
      ? intentionCardTitleRecognizer(model.subject, aliasSource, today) : null;
    model.today = today;
    model.identity = typeof intentionCardIdentity === "function" ? intentionCardIdentity(model.subject) : null;
    model.rail = recognizer && typeof intentionCardRailModel === "function"
      ? intentionCardRailModel(current.source, model.subject, recognizer, today) : null;
    model.ghost = typeof intentionCardShowsGhost === "function" ? intentionCardShowsGhost(model) : false;
    model.recognizerKey = recognizer?.key || "";
    model.signature = this.intentionCardModelSignature(model);
    return { model, source: current.source, placement, subject, recognizer };
  }

  // Repaint dedupe: everything the card DOM shows, including which link
  // targets resolve (a new daily note un-strikes its rail item).
  intentionCardModelSignature(model) {
    const rail = model.rail || null;
    const targets = [
      ...(model.identity?.kicker || []).map((part) => part.target),
      rail?.prev?.target, rail?.parent?.target, rail?.next?.target,
      ...(rail?.children || []).map((child) => child.target),
      model.subject?.parent && model.parentIntentions?.length ? intentionCardLinkTarget(model.subject.parent.path) : "",
    ].filter(Boolean);
    let links = "";
    for (const target of targets) {
      let ok = false;
      try { ok = intentionCardDomTargetExists(this, target, model.path).ok === true; } catch (_) { ok = false; }
      links += ok ? "1" : "0";
    }
    try {
      return JSON.stringify({
        path: model.path, today: model.today, kind: model.kind, label: model.label, state: model.subject?.state,
        intentions: model.intentions, summary: model.summary, summaryState: model.summaryState,
        summaryDrafted: model.summaryDrafted, reflection: model.reflection,
        parentIntentions: model.parentIntentions, missingBands: model.missingBands,
        identity: model.identity, ghost: model.ghost, hasContent: model.hasContent,
        rail: rail ? { prev: rail.prev, parent: rail.parent, next: rail.next, children: rail.children } : null,
        recognizer: model.recognizerKey, links,
      });
    } catch (_) {
      return `${model.path}:${Date.now()}`;
    }
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

  // Remove the path's cards under root, except keep (the mounted slot card).
  intentionCardRemoveNodes(root, path = "", keep = null) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${INTENTION_CARD_CLASS}`) || [])) {
      if (keep && node === keep) continue;
      const owned = intentionCardFilePath(node.getAttribute?.("data-intention-source") || "");
      if (path && owned && owned !== intentionCardFilePath(path)) continue;
      intentionCardDomRelease(node);
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
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

  // Body fallback in Live Preview. CodeMirror refuses block decorations from
  // a ViewPlugin, so the card is an inline widget at the end of the line just
  // before the first unrelated block (side 1), like the album and bank
  // headers; CSS makes it a block. A note without an H1 puts it at the start
  // of its first body line (side -1), or at the end of the document (side 1)
  // when there is no body line.
  intentionCardLiveAnchor(text, subject) {
    const placement = intentionCardPlacement(text, subject, this.intentionCardToday());
    if (!placement) return null;
    const source = String(text || "");
    const lines = source.split(/\r\n|\r|\n/);
    if (placement.headingLine < 0) {
      if (placement.insertBeforeLine >= lines.length) {
        return { placement, lineIndex: lines.length - 1, offset: source.length, side: 1 };
      }
      let start = 0;
      for (let index = 0; index < placement.insertBeforeLine; index += 1) start += (lines[index] || "").length + 1;
      return { placement, lineIndex: placement.insertBeforeLine, offset: Math.min(start, source.length), side: -1 };
    }
    const lineIndex = Math.max(placement.headingLine, placement.insertBeforeLine - 1);
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      offset += (lines[index] || "").length + 1;
    }
    offset += (lines[lineIndex] || "").length;
    return { placement, lineIndex, offset: Math.min(offset, source.length), side: 1 };
  }
}
