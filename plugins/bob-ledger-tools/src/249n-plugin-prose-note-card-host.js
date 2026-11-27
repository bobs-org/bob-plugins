// Prose Card host (bob-cli-qm prose-card). Identity paints from local data;
// the title slot and native-Properties coordinator remain independently
// fail-open. This adapter never formats or writes note content.
const PROSE_NOTE_CARD_HOST_KIND = "prose";
const PROSE_NOTE_CARD_MOUNT_ATTR = "data-prose-source";
const PROSE_NOTE_CARD_READING_PRIORITY = 48;
const PROSE_NOTE_CARD_SURFACE_MARK = "bob-prose-note-card-surface";
const PROSE_NOTE_CARD_SNAPSHOT_WAIT_MS = 1600;
const proseNoteCardNodeSignatures = new WeakMap();
const PROSE_NOTE_CARD_NUMBERING_COMMAND = "bob-articles:toggle-section-numbers";

function proseNoteCardFrontmatterFromText(sourceText) {
  if (typeof sourceText !== "string") return null;
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(sourceText);
  if (!match) return null;
  try {
    const parsed = typeof parseYaml === "function" ? parseYaml(match[1]) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function proseNoteCardScopeDenied(scope, root) {
  if (typeof propertyCardScopeIsEmbed === "function" && propertyCardScopeIsEmbed(scope || root)) return true;
  for (const node of [scope, root]) {
    try {
      if (node?.closest?.(".hover-popover, .canvas-node, .canvas-node-content, .print")) return true;
    } catch (_) { return true; }
  }
  return false;
}

class BobLedgerToolsProseNoteCardMixin {
  proseNoteCardHost() {
    if (this._proseNoteCardHost) return this._proseNoteCardHost;
    const plugin = this;
    this._proseNoteCardHost = createPropertyCardHost({
      plugin,
      kind: PROSE_NOTE_CARD_HOST_KIND,
      readingPriority: PROSE_NOTE_CARD_READING_PRIORITY,
      allowEmbedDisplay: false,
      titleOwnership: true,
      fields: {
        active: "proseNoteCardActive",
        reading: "proseNoteCardReading",
        readingPending: "proseNoteCardReadingPending",
        readingTimers: "proseNoteCardReadingTimers",
        editors: "proseNoteCardEditors",
        editorScopes: "proseNoteCardEditorScopes",
        refreshTimer: "proseNoteCardRefreshTimer",
      },
      setTimeout: (fn, ms) => (typeof plugin.albumSetTimeout === "function"
        ? plugin.albumSetTimeout(fn, ms) : setTimeout(fn, ms)),
      clearTimeout: (id) => { try { plugin.albumClearTimeout?.(id); } catch (_) {} },
      pathOf: proseNoteCardPath,
      acceptReading: (el, ctx) => {
        const path = proseNoteCardPath(ctx?.sourcePath);
        const fm = plugin.proseNoteCardFrontmatter(path);
        return Boolean(el && path && !notebookInsideCode?.(el)
          && !proseNoteCardScopeDenied(el, el)
          && propertyCardNoteSpecies({ path, frontmatter: fm }) === PROSE_NOTE_CARD_KIND);
      },
      paintReading: (el, path) => plugin.paintProseNoteCardReading(el, path),
      removeReading: (root, scope, path) => plugin.proseNoteCardRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.proseNoteCardRemoveStrays(widget.el, widget.path);
      },
      afterRefreshReading: () => plugin.proseNoteCardSyncSurfaces(),
      livePath: (view) => plugin.proseNoteCardLivePath(view),
      sourcePath: (view) => plugin.proseNoteCardSourcePath(view),
      viewPath: (view) => plugin.proseNoteCardLivePath(view) || plugin.proseNoteCardSourcePath(view),
      buildDecorations: (view) => plugin.buildProseNoteCardDecorations(view),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.proseNoteCardCleanEditor(view),
      workspaceEvents: ["layout-change", "file-open", "active-leaf-change"],
      onSetup: () => plugin.proseNoteCardOnSetup(),
      onDisposeStart: () => plugin.proseNoteCardOnDisposeStart(),
      onDisposeEnd: () => plugin.proseNoteCardOnDisposeEnd(),
    });
    return this._proseNoteCardHost;
  }

  setupProseNoteCard() { this.proseNoteCardHost().setup(); }
  teardownProseNoteCard() { this.proseNoteCardHost().dispose(); }

  proseNoteCardOnSetup() {
    this.proseNoteCardActive = true;
    this.proseNoteCardEpoch = (this.proseNoteCardEpoch || 0) + 1;
    if (!(this.proseNoteCardExpanded instanceof Map)) this.proseNoteCardExpanded = new Map();
    if (!(this.proseNoteCardSurfaceScopes instanceof Set)) this.proseNoteCardSurfaceScopes = new Set();
    try { propertyCardFrontmatterCoordinatorBind?.(this, PROSE_NOTE_CARD_HOST_KIND); } catch (_) {}
    try {
      this.proseNoteCardFoldUnregister = propertyCardRegisterFoldKind(this, PROSE_NOTE_CARD_HOST_KIND, {
        toggle: (path) => {
          this.proseNoteCardSetExpanded(path, !this.proseNoteCardIsExpanded(path));
          return true;
        },
      });
    } catch (_) { this.proseNoteCardFoldUnregister = null; }
    try {
      this.proseNoteCardPropertyRegistered = this.registerPropertyCard?.({
        kind: PROSE_NOTE_CARD_HOST_KIND,
        match: ({ path, frontmatter } = {}) => propertyCardNoteSpecies({ path, frontmatter }) === PROSE_NOTE_CARD_KIND,
        open: ({ path } = {}) => {
          if (typeof this.openPropertyEditor === "function") {
            void this.openPropertyEditor({ filePath: path, key: "title" });
          }
        },
      }) === true;
    } catch (_) { this.proseNoteCardPropertyRegistered = false; }
    try { this.proseNoteCardFootBind(); } catch (_) {}
    this.proseNoteCardBindProviderEvents();
    this.proseNoteCardEnsureApiSubscription();
  }

  proseNoteCardOnDisposeStart() {
    this.proseNoteCardActive = false;
    this.proseNoteCardEpoch = (this.proseNoteCardEpoch || 0) + 1;
    try { this.proseNoteCardFoldUnregister?.(); } catch (_) {}
    this.proseNoteCardFoldUnregister = null;
    if (this.proseNoteCardPropertyRegistered) {
      try { this.unregisterPropertyCard?.(PROSE_NOTE_CARD_HOST_KIND); } catch (_) {}
    }
    this.proseNoteCardPropertyRegistered = false;
    try { propertyCardFrontmatterCoordinatorReleaseKind?.(this, PROSE_NOTE_CARD_HOST_KIND); } catch (_) {}
    try { this.proseNoteCardFootUnbind(); } catch (_) {}
    this.proseNoteCardUnbindApiSubscription();
  }

  proseNoteCardOnDisposeEnd() {
    this.proseNoteCardExpanded?.clear?.();
    this.proseNoteCardSourceCache?.clear?.();
    this.proseNoteCardSourceFlights?.clear?.();
    this.proseNoteCardFootTracked?.clear?.();
    this.proseNoteCardSnapshotSettled?.clear?.();
    for (const path of Array.from(this.proseNoteCardSnapshotTimers?.keys?.() || [])) {
      this.proseNoteCardClearSnapshotWait(path);
    }
    this.proseNoteCardPluginEventsBound = false;
  }

  proseNoteCardDesktop() {
    try { return Platform?.isDesktopApp === true; } catch (_) { return false; }
  }

  proseNoteCardFrontmatter(path) {
    try { return this.homeCardFrontmatter?.(proseNoteCardPath(path)) || {}; } catch (_) { return {}; }
  }

  proseNoteCardModelFor(path, sourceText) {
    const key = proseNoteCardPath(path);
    if (!key) return null;
    const fromSource = proseNoteCardFrontmatterFromText(sourceText);
    const frontmatter = fromSource || this.proseNoteCardFrontmatter(key);
    return proseNoteCardModel({
      path: key,
      frontmatter,
      resolveParent: (target, fromPath) => this.homeCardResolveParent?.(target, fromPath) || null,
    });
  }

  proseNoteCardExpandedMap() {
    if (!(this.proseNoteCardExpanded instanceof Map)) this.proseNoteCardExpanded = new Map();
    return this.proseNoteCardExpanded;
  }

  proseNoteCardIsExpanded(path) {
    const key = proseNoteCardPath(path);
    const stored = key ? this.proseNoteCardExpandedMap().get(key) : null;
    const choice = typeof propertyCardFoldRestamp === "function"
      ? propertyCardFoldRestamp(propertyCardFoldChoiceFromStored(stored), "")
      : propertyCardFoldChoiceFromStored(stored);
    if (key && choice && choice !== stored) this.proseNoteCardExpandedMap().set(key, choice);
    return propertyCardFoldResolve({
      choice,
      problems: "",
      foldDefault: propertyCardSpecies(PROSE_NOTE_CARD_KIND)?.foldDefault,
    });
  }

  proseNoteCardSetExpanded(path, expanded) {
    const key = proseNoteCardPath(path);
    if (!key) return false;
    this.proseNoteCardExpandedMap().set(key, propertyCardFoldChoice(expanded === true, ""));
    this.scheduleProseNoteCardRefresh();
    return true;
  }

  proseNoteCardNumberingCommandAvailable() {
    try {
      const commands = this.app?.commands;
      if (commands?.commands && commands.commands[PROSE_NOTE_CARD_NUMBERING_COMMAND]) return true;
      return typeof commands?.findCommand === "function"
        ? Boolean(commands.findCommand(PROSE_NOTE_CARD_NUMBERING_COMMAND)) : false;
    } catch (_) { return false; }
  }

  proseNoteCardProviderApi() {
    try {
      const api = this.app?.plugins?.getPlugin?.("bob-articles")?.api?.prose;
      return api && api.version === 1 && typeof api.snapshot === "function"
        && typeof api.subscribe === "function" ? api : null;
    } catch (_) {
      return null;
    }
  }

  proseNoteCardEnsureApiSubscription() {
    const api = this.proseNoteCardProviderApi();
    if (this.proseNoteCardSubscribedApi === api) return api;
    this.proseNoteCardUnbindApiSubscription();
    if (!api) return null;
    try {
      const unsubscribe = api.subscribe((path) => {
        if (this.proseNoteCardActive !== true || this.proseNoteCardSubscribedApi !== api
          || typeof path !== "string") return;
        this.proseNoteCardClearSnapshotWait(path);
        let snapshot = null;
        try { snapshot = api.snapshot(path); } catch (_) {}
        if (snapshot) this.proseNoteCardSnapshotSettled?.delete?.(path);
        else this.proseNoteCardSnapshotSettled?.add?.(path);
        this.scheduleProseNoteCardRefresh();
      });
      if (typeof unsubscribe === "function") {
        this.proseNoteCardSubscribedApi = api;
        this.proseNoteCardApiUnsubscribe = unsubscribe;
      }
      return api;
    } catch (_) {
      return null;
    }
  }

  proseNoteCardUnbindApiSubscription() {
    try { this.proseNoteCardApiUnsubscribe?.(); } catch (_) {}
    this.proseNoteCardApiUnsubscribe = null;
    this.proseNoteCardSubscribedApi = null;
    for (const path of Array.from(this.proseNoteCardSnapshotTimers?.keys?.() || [])) {
      this.proseNoteCardClearSnapshotWait(path);
    }
    this.proseNoteCardSnapshotSettled?.clear?.();
  }

  proseNoteCardClearSnapshotWait(path) {
    const timers = this.proseNoteCardSnapshotTimers;
    if (!(timers instanceof Map) || !timers.has(path)) return;
    try { clearTimeout(timers.get(path)); } catch (_) {}
    timers.delete(path);
  }

  proseNoteCardScheduleSnapshotWait(path, api) {
    if (!path) return;
    if (!(this.proseNoteCardSnapshotSettled instanceof Set)) this.proseNoteCardSnapshotSettled = new Set();
    if (!(this.proseNoteCardSnapshotTimers instanceof Map)) this.proseNoteCardSnapshotTimers = new Map();
    if (this.proseNoteCardSnapshotSettled.has(path) || this.proseNoteCardSnapshotTimers.has(path)) return;
    const timer = setTimeout(() => {
      this.proseNoteCardSnapshotTimers.delete(path);
      if (this.proseNoteCardActive !== true || this.proseNoteCardSubscribedApi !== api) return;
      let snapshot = null;
      try { snapshot = api.snapshot(path); } catch (_) {}
      if (snapshot) return;
      this.proseNoteCardSnapshotSettled.add(path);
      this.scheduleProseNoteCardRefresh();
    }, PROSE_NOTE_CARD_SNAPSHOT_WAIT_MS);
    this.proseNoteCardSnapshotTimers.set(path, timer);
  }

  proseNoteCardBindProviderEvents() {
    if (this.proseNoteCardPluginEventsBound) return;
    this.proseNoteCardPluginEventsBound = true;
    const plugins = this.app?.plugins;
    if (!plugins || typeof plugins.on !== "function" || typeof this.registerEvent !== "function") return;
    for (const eventName of ["plugin-loaded", "plugin-unloaded"]) {
      try {
        this.registerEvent(plugins.on(eventName, () => {
          this.proseNoteCardEnsureApiSubscription();
          this.scheduleProseNoteCardRefresh();
        }));
      } catch (_) {}
    }
  }

  proseNoteCardSnapshot(path) {
    const key = proseNoteCardPath(path);
    const api = this.proseNoteCardEnsureApiSubscription();
    if (!key || !api) return null;
    try {
      const snapshot = api.snapshot(key);
      if (snapshot && snapshot.path === key) {
        this.proseNoteCardClearSnapshotWait(key);
        this.proseNoteCardSnapshotSettled?.delete?.(key);
        return snapshot;
      }
      this.proseNoteCardScheduleSnapshotWait(key, api);
      return null;
    } catch (_) {
      this.proseNoteCardScheduleSnapshotWait(key, api);
      return null;
    }
  }

  proseNoteCardToggleNumbering() {
    if (!this.proseNoteCardNumberingCommandAvailable()) return false;
    try {
      return this.app?.commands?.executeCommandById?.(PROSE_NOTE_CARD_NUMBERING_COMMAND) !== false;
    } catch (_) { return false; }
  }

  proseNoteCardOpenOptions(path, model, surface) {
    const sourcePath = proseNoteCardPath(path);
    const api = this.proseNoteCardEnsureApiSubscription();
    const snapshot = this.proseNoteCardSnapshot(sourcePath);
    return {
      expanded: this.proseNoteCardIsExpanded(sourcePath),
      keyLive: propertyCardFoldKeyLive(this, surface),
      numberingCommandAvailable: this.proseNoteCardNumberingCommandAvailable(),
      proseApiAvailable: Boolean(api),
      snapshot,
      snapshotPending: Boolean(api && !snapshot && !this.proseNoteCardSnapshotSettled?.has?.(sourcePath)),
      reducedMotion: propertyCardFootReducedMotion?.() === true,
      onToggleOutline: (next) => this.proseNoteCardSetExpanded(sourcePath, next),
      onToggleNumbering: () => this.proseNoteCardToggleNumbering(),
      onJumpSection: (section, index) => this.proseNoteCardJumpSection(sourcePath, section, index),
      onJumpFinding: (line) => this.proseNoteCardJumpFinding(sourcePath, line),
      onLink: (target, event) => { void this.homeCardOpenPath?.(target, sourcePath, event); },
    };
  }

  proseNoteCardSignature(model, extra, options) {
    try {
      return JSON.stringify([
        model,
        extra?.footDigest || "",
        extra?.footOpen === true,
        options?.expanded === true,
        options?.keyLive === true,
        options?.numberingCommandAvailable === true,
        options?.proseApiAvailable === true,
        options?.snapshot || null,
      ]);
    } catch (_) { return ""; }
  }

  proseNoteCardBuildMounted(model, options, doc, footSpec) {
    const card = proseNoteCardBuildEl(doc, model, options);
    if (!card) return null;
    card.setAttribute(PROSE_NOTE_CARD_MOUNT_ATTR, model.path);
    if (options.reducedMotion) card.classList?.add?.("is-reduced-motion");
    try {
      proseNoteCardPaintSnapshot(card, options.snapshot, {
        pending: options.snapshotPending === true,
        expanded: options.expanded === true,
        onToggleOutline: options.onToggleOutline,
        onJumpSection: options.onJumpSection,
        onJumpFinding: options.onJumpFinding,
      });
    } catch (_) {}
    try { this.proseNoteCardAppendFoot(card, model.path, model, doc, footSpec, options); } catch (_) {}
    return card;
  }

  proseNoteCardOwnMounted(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const plugin = this;
    const sourceFor = () => {
      try {
        if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      } catch (_) {}
      return plugin.proseNoteCardSourceCache?.get?.(proseNoteCardPath(path));
    };
    return propertyCardFrontmatterOwnMounted(plugin, {
      scope,
      view: view && view.dom === scope ? view : null,
      path: proseNoteCardPath(path),
      kind: PROSE_NOTE_CARD_HOST_KIND,
      mount,
      sourceText,
      getSource: sourceFor,
      currentPath,
      isCurrent: () => {
        const text = sourceFor();
        return Boolean(plugin.proseNoteCardActive === true
          && plugin.proseNoteCardModelFor(path, text));
      },
      active: () => plugin.proseNoteCardActive === true,
    });
  }

  proseNoteCardReleaseFrontmatter(scope, path) {
    try { return propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: PROSE_NOTE_CARD_HOST_KIND, path }); }
    catch (_) { return false; }
  }

  proseNoteCardReadingRoot(el) {
    try { return propertyCardReadingRoot(el); } catch (_) { return null; }
  }

  proseNoteCardReadingScope(root) {
    try { return propertyCardReadingScope(root); } catch (_) { return root; }
  }

  proseNoteCardReadingView(scope) {
    try { return propertyCardReadingViewFor(this.app, scope); } catch (_) { return null; }
  }

  proseNoteCardReadingAnchor(root) {
    try {
      return Array.from(root?.querySelectorAll?.("h1") || []).find((node) => !notebookInsideCode(node)) || null;
    } catch (_) { return null; }
  }

  proseNoteCardReadingCards(root, path) {
    const key = proseNoteCardPath(path);
    return Array.from(root?.querySelectorAll?.(`.${PROSE_NOTE_CARD_SURFACE_CLASS}`) || []).filter((node) => {
      if (!propertyCardNodeBelongs(node, root)) return false;
      const owner = proseNoteCardPath(node.getAttribute?.(PROSE_NOTE_CARD_MOUNT_ATTR));
      return !key || !owner || owner === key;
    });
  }

  paintProseNoteCardReading(el, sourcePath) {
    const path = proseNoteCardPath(sourcePath);
    const root = this.proseNoteCardReadingRoot(el);
    const scope = this.proseNoteCardReadingScope(root);
    if (!root || !scope || !path || !this.proseNoteCardDesktop()
      || proseNoteCardScopeDenied(scope, root)) {
      this.proseNoteCardRemoveReading(root, scope, path);
      return null;
    }
    let sourceText = this.proseNoteCardSourceCache?.get?.(path);
    const model = this.proseNoteCardModelFor(path, sourceText);
    const reading = scope.classList?.contains?.("markdown-preview-view")
      ? this.proseNoteCardReadingView(scope) : null;
    const leafPath = reading?.currentPath?.() || "";
    if (!model || (leafPath && proseNoteCardPath(leafPath) !== path)) {
      this.proseNoteCardRemoveReading(root, scope, path);
      return null;
    }
    const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createElement !== "function") {
      this.proseNoteCardRemoveReading(root, scope, path);
      return null;
    }
    const extra = this.proseNoteCardFootExtra(path, model);
    const options = { ...this.proseNoteCardOpenOptions(path, model, "reading"), sourcePath: path };
    const signature = this.proseNoteCardSignature(model, extra, options);
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === path && adopted.kind === PROSE_NOTE_CARD_HOST_KIND
      && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.proseNoteCardReadingCards(root, path).filter((node) => node !== slotNode);
    let card = slotNode || bodyNodes[0] || null;
    if (!card || proseNoteCardNodeSignatures.get(card) !== signature) {
      const fresh = this.proseNoteCardBuildMounted(model, options, doc, extra?.footSpec);
      if (!fresh) {
        this.proseNoteCardRemoveReading(root, scope, path);
        return null;
      }
      card = card ? propertyCardAdoptPatch(card, fresh) : fresh;
      proseNoteCardNodeSignatures.set(card, signature);
    }
    for (const node of bodyNodes) {
      if (node !== card) {
        try { node.remove?.(); } catch (_) {}
      }
    }
    const plugin = this;
    const adoption = propertyCardAdoptTitle(scope, card, {
      path,
      kind: PROSE_NOTE_CARD_HOST_KIND,
      view: reading?.view || null,
      currentPath: reading?.currentPath || null,
      recognizer: propertyCardNeverTitleRecognizer(PROSE_NOTE_CARD_KIND),
      onLost: () => this.scheduleProseNoteCardRefresh(),
      onMount: (mount) => {
        const text = plugin.proseNoteCardSourceCache?.get?.(path) || sourceText;
        plugin.proseNoteCardOwnMounted(scope, reading?.view || null, path, mount, text, reading?.currentPath || (() => ""));
      },
    });
    if (adoption.mode === "slot") {
      sourceText = this.proseNoteCardSourceCache?.get?.(path) || sourceText;
      this.proseNoteCardOwnMounted(scope, reading?.view || null, path, card, sourceText, reading?.currentPath || (() => ""));
    } else {
      this.proseNoteCardReleaseFrontmatter(scope, path);
      propertyCardDemoteTitleHeading(card);
      const anchor = this.proseNoteCardReadingAnchor(root);
      try {
        if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(card, anchor);
        else if (root.insertBefore) root.insertBefore(card, root.firstChild || null);
        else root.prepend?.(card);
      } catch (_) {
        this.proseNoteCardRemoveReading(root, scope, path);
        return null;
      }
    }
    scope.classList?.add?.(PROSE_NOTE_CARD_SURFACE_MARK);
    this.proseNoteCardSurfaceScopes?.add?.(scope);
    this.proseNoteCardTrackFoot(scope, path, card);
    void this.proseNoteCardEnsureSource(path);
    return card;
  }

  proseNoteCardRemoveReading(root, scope = root, sourcePath = "") {
    const path = proseNoteCardPath(sourcePath);
    if (!root && !scope) return;
    try { this.proseNoteCardTrackFoot(scope, path, null); } catch (_) {}
    try { propertyCardAdoptRelease(scope, path || undefined, PROSE_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { this.proseNoteCardReleaseFrontmatter(scope, path); } catch (_) {}
    for (const node of this.proseNoteCardReadingCards(root, path)) {
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    const anotherOwner = Array.from(this.proseNoteCardReading || []).some((item) => item.surface === root && item.path !== path);
    if (!anotherOwner) scope?.classList?.remove?.(PROSE_NOTE_CARD_SURFACE_MARK);
    if (!anotherOwner) this.proseNoteCardSurfaceScopes?.delete?.(scope);
  }

  proseNoteCardJumpSection(path, section, index) {
    return proseNoteCardJumpToSection(this, path, section, index);
  }

  proseNoteCardJumpFinding(path, line) {
    return proseNoteCardJumpToLine(this, path, line);
  }

  proseNoteCardRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${PROSE_NOTE_CARD_SURFACE_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") !== "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (proseNoteCardPath(node.getAttribute?.(PROSE_NOTE_CARD_MOUNT_ATTR)) !== proseNoteCardPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) {}
    }
  }

  proseNoteCardLivePath(view) {
    if (this.proseNoteCardActive !== true || !this.proseNoteCardDesktop()) return null;
    try { if (view?.dom?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node, .print")) return null; }
    catch (_) { return null; }
    try { return this.notebookCatalogLivePath?.(view) || null; } catch (_) { return null; }
  }

  proseNoteCardSourcePath(view) {
    if (this.proseNoteCardActive !== true || !this.proseNoteCardDesktop()) return null;
    try {
      if (view?.dom?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node, .print")) return null;
    } catch (_) { return null; }
    try {
      const info = view?.state?.field?.(editorInfoField, false);
      return typeof info?.file?.path === "string" && info.file.path ? info.file.path : null;
    } catch (_) { return null; }
  }

  proseNoteCardLiveCurrentPath(view) {
    return this.proseNoteCardLivePath(view) || "";
  }

  proseNoteCardFallbackAnchor(text) {
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

  buildProseNoteCardDecorations(view) {
    const path = this.proseNoteCardLivePath(view);
    if (!path) {
      this.proseNoteCardCleanEditor(view);
      return Decoration?.none || null;
    }
    let text = "";
    try { text = view.state.doc.toString(); } catch (_) {}
    if (!text) {
      this.proseNoteCardCleanEditor(view);
      return Decoration?.none || null;
    }
    this.proseNoteCardRememberSource(path, text);
    const model = this.proseNoteCardModelFor(path, text);
    this.proseNoteCardSetEditorScope(view, Boolean(model));
    if (!model) {
      try { propertyCardAdoptRelease(view.dom, path, PROSE_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
      try { this.proseNoteCardReleaseFrontmatter(view.dom, path); } catch (_) {}
      try { this.proseNoteCardTrackFoot(view.dom, path, null); } catch (_) {}
      return Decoration?.none || null;
    }
    if (!Decoration || !WidgetType || !RangeSetBuilder) return Decoration?.none || null;
    const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
    const extra = this.proseNoteCardFootExtra(path, model);
    const options = {
      ...this.proseNoteCardOpenOptions(path, model, "live-preview"),
      sourcePath: path,
      view,
      component: this,
      sourceText: text,
    };
    const signature = this.proseNoteCardSignature(model, extra, options);
    const adopted = propertyCardAdoptedEntry(view.dom);
    let card = adopted && adopted.path === path && adopted.kind === PROSE_NOTE_CARD_HOST_KIND
      && adopted.mode === "slot" ? adopted.node : null;
    if (!card || proseNoteCardNodeSignatures.get(card) !== signature) {
      const fresh = this.proseNoteCardBuildMounted(model, options, doc, extra?.footSpec);
      if (!fresh) {
        this.proseNoteCardCleanEditor(view);
        return Decoration.none;
      }
      if (card) this.proseNoteCardPatchLive(view, adopted, fresh, signature);
      else {
        card = fresh;
        proseNoteCardNodeSignatures.set(card, signature);
      }
    }
    const plugin = this;
    const adoption = propertyCardAdoptTitle(view.dom, card, {
      path,
      kind: PROSE_NOTE_CARD_HOST_KIND,
      view,
      recognizer: propertyCardNeverTitleRecognizer(PROSE_NOTE_CARD_KIND),
      currentPath: () => plugin.proseNoteCardLiveCurrentPath(view),
      onLost: () => this.scheduleProseNoteCardRefresh(),
      onMount: (mount) => {
        const source = view?.state?.doc?.toString?.() || text;
        plugin.proseNoteCardOwnMounted(view.dom, view, path, mount, source, () => plugin.proseNoteCardLiveCurrentPath(view));
      },
    });
    try { this.proseNoteCardTrackFoot(view.dom, path, card); } catch (_) {}
    if (adoption.mode === "slot") {
      try {
        this.proseNoteCardOwnMounted(view.dom, view, path, card, text, () => this.proseNoteCardLiveCurrentPath(view));
      } catch (_) {}
      try { propertyCardFrontmatterCoordinatorReconcile?.(this); } catch (_) {}
      return Decoration.none;
    }
    this.proseNoteCardReleaseFrontmatter(view.dom, path);
    propertyCardDemoteTitleHeading(card);
    card.setAttribute?.("data-cm-widget", "true");
    const anchor = this.proseNoteCardFallbackAnchor(text);
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
        card.setAttribute?.(PROSE_NOTE_CARD_MOUNT_ATTR, path);
        return card;
      }
    }();
    const builder = new RangeSetBuilder();
    builder.add(at, at, Decoration.widget({ widget, side: -1 }));
    return builder.finish();
  }

  proseNoteCardPatchLive(view, adopted, fresh, signature) {
    const target = adopted?.node;
    const generation = adopted?.generation;
    proseNoteCardDefer(() => {
      const current = propertyCardAdoptedEntry(view?.dom);
      if (!current || current.node !== target || current.generation !== generation) return;
      propertyCardAdoptPatch(target, fresh);
      proseNoteCardNodeSignatures.set(target, signature);
      propertyCardSyncTitleHeading(target, current.owned === true);
      try { this.proseNoteCardTrackFoot(view.dom, current.path, target); } catch (_) {}
    });
  }

  proseNoteCardSetEditorScope(view, enabled) {
    try {
      return this.proseNoteCardHost().setEditorScope(view, enabled, {
        scopeOf: (root) => root?.closest?.(".markdown-source-view") || root,
        mark: (scope) => scope?.classList?.add?.(PROSE_NOTE_CARD_SURFACE_MARK),
        unmark: (scope) => scope?.classList?.remove?.(PROSE_NOTE_CARD_SURFACE_MARK),
      });
    } catch (_) { return null; }
  }

  proseNoteCardCleanEditor(view) {
    const path = this.proseNoteCardLivePath(view) || this.proseNoteCardSourcePath(view) || "";
    try { this.proseNoteCardTrackFoot(view?.dom, path, null); } catch (_) {}
    try { propertyCardAdoptRelease(view?.dom, path || undefined, PROSE_NOTE_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) {}
    try { this.proseNoteCardReleaseFrontmatter(view?.dom, path); } catch (_) {}
    try {
      return this.proseNoteCardHost().cleanEditor(view, {
        unmark: (scope) => scope?.classList?.remove?.(PROSE_NOTE_CARD_SURFACE_MARK),
      });
    } catch (_) { return null; }
  }

  proseNoteCardRemoveStrayScope(scope) {
    try {
      if (!scope?.querySelectorAll) return;
      for (const node of scope.querySelectorAll(`.${PROSE_NOTE_CARD_SURFACE_CLASS}`)) {
        node.remove?.();
      }
    } catch (_) {}
  }

  proseNoteCardSyncSurfaces() {
    try {
      for (const scope of this.proseNoteCardSurfaceScopes || []) {
        if (!scope?.querySelector?.(`.${PROSE_NOTE_CARD_SURFACE_CLASS}`)) {
          scope.classList?.remove?.(PROSE_NOTE_CARD_SURFACE_MARK);
        }
      }
    } catch (_) {}
  }

  scheduleProseNoteCardRefresh() {
    try { this.proseNoteCardHost().scheduleRefresh(); } catch (_) {}
  }

  refreshProseNoteCardReading() {
    try { this.proseNoteCardHost().refreshReading(); } catch (_) {}
  }

  refreshProseNoteCardEditors() {
    try { this.proseNoteCardHost().refreshEditors(); } catch (_) {}
  }
}

function proseNoteCardDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}
