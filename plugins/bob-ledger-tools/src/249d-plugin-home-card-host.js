// Home-card host (bob-cli-pl.4.1 mount-foot). One shared adapter mounts the
// pure Area/Project presentation in desktop Live Preview and Reading through
// the shared host and title kit, with the property foot and local
// invalidation. Native Properties stays wholly visible: this adapter never
// calls propertyCardFrontmatterOwnMounted, propertyCardOwnFrontmatter, or
// any whole-block/per-key Properties hiding. Painting reads only the
// metadata cache, confirmed source bytes, the local home resolver, and
// api.noteReady. It never subscribes to report services, never starts a
// per-card fetch, and never spawns bob or writes the vault.
const HOME_CARD_HOST_KIND = "home";
const HOME_CARD_READING_PRIORITY = 46;
const HOME_CARD_SURFACE_CLASS = "bob-home-card-surface";
const homeCardNodeSignatures = new WeakMap();

let HomeCardObsidianKeymap = null;
try {
  HomeCardObsidianKeymap = require("obsidian").Keymap || null;
} catch (_) {
  HomeCardObsidianKeymap = null;
}

function homeCardDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

// Modifier-aware like a Markdown link: Mod opens a tab, Mod+Alt a split,
// middle-click a tab.
function homeCardLinkPane(event) {
  if (!event) return false;
  let pane = Boolean(event.ctrlKey || event.metaKey);
  if (event.type === "auxclick" && event.button === 1) pane = "tab";
  try {
    if (HomeCardObsidianKeymap && typeof HomeCardObsidianKeymap.isModEvent === "function") {
      pane = HomeCardObsidianKeymap.isModEvent(event);
    }
  } catch (_) {}
  return pane || false;
}

function homeCardIsDesktopPlatform(platform) {
  try {
    const host = platform === undefined ? Platform : platform;
    return Boolean(host && host.isDesktopApp === true);
  } catch (_) {
    return false;
  }
}

function homeCardScopeDenied(scope, root) {
  for (const node of [scope, root]) {
    if (!node || typeof node.closest !== "function") continue;
    try {
      if (node.closest(".markdown-embed, .internal-embed, .hover-popover, .canvas-node, .print")) return true;
    } catch (_) {}
  }
  return false;
}

class BobLedgerToolsHomeCardMixin {
  homePropertyCardHost() {
    if (this._homePropertyCardHost) return this._homePropertyCardHost;
    const plugin = this;
    this._homePropertyCardHost = createPropertyCardHost({
      plugin,
      kind: HOME_CARD_HOST_KIND,
      readingPriority: HOME_CARD_READING_PRIORITY,
      allowEmbedDisplay: false,
      titleOwnership: true,
      fields: {
        active: "homeCardActive",
        reading: "homeCardReading",
        readingPending: "homeCardReadingPending",
        readingTimers: "homeCardReadingTimers",
        editors: "homeCardEditors",
        editorScopes: "homeCardEditorScopes",
        refreshTimer: "homeCardRefreshTimer",
        keySlots: "homeCardKeySlots",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout?.(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout?.(id),
      pathOf: homeCardPath,
      readingRoot: (el) => plugin.homeCardReadingRoot(el),
      readingScope: (root) => plugin.homeCardReadingScope(root),
      acceptReading: (el, ctx) => Boolean(el && ctx?.sourcePath && !notebookInsideCode(el)),
      paintReading: (el, path) => plugin.paintHomeCardReading(el, path),
      removeReading: (root, scope, path) => plugin.homeCardRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.homeCardRemoveStrays(widget.el, widget.path);
      },
      livePath: (view) => plugin.homeCardLivePath(view),
      buildDecorations: (view, update) => plugin.buildHomeCardDecorations(view, update),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.homeCardCleanEditor(view),
      // Intentionally no ownKeys/releaseKeys ownership of Properties rows
      // and no frontmatter coordinator: native Properties stays visible.
      ownKeys: () => null,
      releaseKeys: () => false,
      workspaceEvents: ["layout-change", "file-open", "active-leaf-change"],
      onSetup: () => plugin.homeCardOnSetup(),
      onDisposeStart: () => plugin.homeCardOnDisposeStart(),
      onDisposeEnd: () => plugin.homeCardOnDisposeEnd(),
    });
    return this._homePropertyCardHost;
  }

  setupHomeCard() {
    this.homePropertyCardHost().setup();
  }

  teardownHomeCard() {
    this.homePropertyCardHost().dispose();
  }

  homeCardDesktop() {
    try {
      if (typeof propertyCardDesktop === "function") return propertyCardDesktop() === true;
    } catch (_) {}
    return homeCardIsDesktopPlatform();
  }

  homeCardReadingRoot(el) {
    try {
      return propertyCardReadingRoot(el);
    } catch (_) {
      return null;
    }
  }

  homeCardReadingScope(root) {
    try {
      return propertyCardReadingScope(root);
    } catch (_) {
      return root;
    }
  }

  homeCardLivePreview(view) {
    try { return Boolean(editorLivePreviewField && view?.state?.field?.(editorLivePreviewField) === true); }
    catch (_) { return false; }
  }

  homeCardLivePath(view) {
    if (this.homeCardActive !== true || !this.homeCardDesktop() || !this.homeCardLivePreview(view)) return null;
    try {
      if (view?.dom?.closest?.(".markdown-embed, .internal-embed, .hover-popover, .canvas-node")) return null;
    } catch (_) {}
    try {
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) {
      return null;
    }
  }

  homeCardFrontmatterFor(path) {
    try {
      return this.homeCardFrontmatter(homeCardPath(path)) || {};
    } catch (_) {
      return {};
    }
  }

  homeCardIsInboxNote(path) {
    const key = homeCardPath(path);
    if (!key) return false;
    try {
      const plugins = this.app?.plugins?.plugins;
      const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
      const route = nav && nav.api && nav.api.inboxRoute ? nav.api.inboxRoute : null;
      if (route && typeof route.isInboxNote === "function") {
        return route.isInboxNote(key) === true;
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  homeCardHueFor(path) {
    try {
      if (typeof notebookHostHueName === "function") {
        return notebookHostHueName(homeCardPath(path), this.app?.metadataCache, this.app?.vault) || "";
      }
    } catch (_) {}
    return "";
  }

  homeCardReadyFor(path) {
    try {
      const snapshot = typeof this.apiNoteReadySnapshot === "function"
        ? this.apiNoteReadySnapshot()
        : (this.api && this.api.noteReady && typeof this.api.noteReady.snapshot === "function"
          ? this.api.noteReady.snapshot()
          : null);
      if (!snapshot || snapshot.available !== true) return null;
    } catch (_) {
      return null;
    }
    try {
      if (typeof this.apiNoteReadyForNote === "function") {
        const entry = this.apiNoteReadyForNote(homeCardPath(path));
        if (entry && typeof entry === "object") return entry;
      }
    } catch (_) {}
    try {
      const api = this.api && this.api.noteReady ? this.api.noteReady : null;
      if (api && typeof api.forNote === "function") {
        const entry = api.forNote(homeCardPath(path));
        if (entry && typeof entry === "object") return entry;
      }
    } catch (_) {}
    return null;
  }

  homeCardThemeHue(name) {
    const raw = homeCardText(name).trim();
    if (!raw) return null;
    let key = raw;
    try {
      if (typeof pomodoroThemeNormalizeKey === "function") {
        key = pomodoroThemeNormalizeKey(raw) || raw;
      }
    } catch (_) {}
    try {
      if (typeof this.pomodoroThemeHueFor === "function") {
        const resolved = this.pomodoroThemeHueFor(key, raw);
        if (resolved !== undefined) return resolved;
      }
    } catch (_) {}
    try {
      const local = this.api && this.api.themes;
      if (local && typeof local.hueFor === "function") return local.hueFor(key, raw);
    } catch (_) {}
    try {
      const plugins = this.app?.plugins?.plugins;
      const ledger = plugins ? plugins["bob-ledger-tools"] : null;
      const api = ledger && ledger.api && ledger.api.themes ? ledger.api.themes : null;
      if (api && typeof api.hueFor === "function") return api.hueFor(key, raw);
    } catch (_) {}
    return null;
  }

  homeCardResolveParent(target, fromPath) {
    const raw = homeCardText(target).trim();
    if (!raw) return null;
    const source = homeCardPath(fromPath);
    let file = null;
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.getFirstLinkpathDest === "function") {
        file = cache.getFirstLinkpathDest(raw, source) || null;
      }
    } catch (_) {
      file = null;
    }
    if (!file && typeof notebookResolveLinkFile === "function") {
      try {
        file = notebookResolveLinkFile(raw, source, this.app?.metadataCache, this.app?.vault) || null;
      } catch (_) {
        file = null;
      }
    }
    const path = file && file.path ? homeCardPath(file.path) : "";
    if (!path) return null;
    let frontmatter = {};
    try {
      const cache = this.app?.metadataCache;
      const entry = file && cache && typeof cache.getFileCache === "function" ? cache.getFileCache(file) : null;
      const fm = entry && entry.frontmatter ? entry.frontmatter : null;
      if (fm && typeof fm === "object" && !Array.isArray(fm)) frontmatter = fm;
    } catch (_) {
      frontmatter = {};
    }
    let kind = "";
    try {
      kind = homeCardKindFromFrontmatter(frontmatter) || "";
    } catch (_) {
      kind = "";
    }
    if (kind !== "area" && kind !== "project") return null;
    const stem = homeCardStem(path);
    let title = stem;
    try {
      const aliases = frontmatter && frontmatter.aliases;
      const first = Array.isArray(aliases) ? String(aliases[0] || "").trim() : String(aliases || "").trim();
      if (first) title = first;
    } catch (_) {}
    let hue = "";
    try {
      if (typeof notebookHostHueName === "function") {
        hue = notebookHostHueName(path, this.app?.metadataCache, this.app?.vault) || "";
      }
    } catch (_) {}
    return { path, stem, title, kind, hue, parent: frontmatter.parent, frontmatter };
  }

  homeCardModelFor(path, sourceText) {
    const key = homeCardPath(path);
    if (!key) return null;
    let frontmatter = {};
    try {
      frontmatter = this.homeCardFrontmatter(key) || {};
    } catch (_) {
      frontmatter = {};
    }
    // Eligibility must match in both surfaces: untyped homes, type notes,
    // archives, templates, and conflicts never build a model.
    let eligible = null;
    try {
      eligible = homeCardEligible(key, frontmatter);
    } catch (_) {
      eligible = null;
    }
    if (!eligible) return null;
    const ready = this.homeCardReadyFor(key);
    let hue = "";
    try {
      hue = this.homeCardHueFor(key);
    } catch (_) {
      hue = "";
    }
    const resolveParent = (target, from) => {
      try { return this.homeCardResolveParent(target, from); } catch (_) { return null; }
    };
    try {
      const model = homeCardModel({
        path: key,
        frontmatter,
        sourceText,
        hue,
        ready,
        clock: () => new Date(),
        isInboxNote: (note) => this.homeCardIsInboxNote(note),
        resolveParent,
        themeHue: (name) => this.homeCardThemeHue(name),
      });
      if (!model) return null;
      // Report-backed parts patch in place from the already-cached areas and
      // projects snapshots. The lookup is a synchronous cache read: paint
      // never starts a fetch or spawns bob.
      try {
        if (typeof this.homeCardLivePatchFor === "function" && typeof homeCardApplyLivePatch === "function") {
          const live = this.homeCardLivePatchFor(key, eligible.kind, model);
          if (live) return homeCardApplyLivePatch(model, live);
        }
      } catch (_) {}
      return model;
    } catch (_) {
      return null;
    }
  }

  homeCardIsCollapsed(path) {
    const key = homeCardPath(path);
    const map = this.homeCardCollapsed instanceof Map ? this.homeCardCollapsed : new Map();
    this.homeCardCollapsed = map;
    return key && map.has(key) ? map.get(key) === true : false;
  }

  homeCardSetCollapsed(path, collapsed) {
    const key = homeCardPath(path);
    if (!(this.homeCardCollapsed instanceof Map)) this.homeCardCollapsed = new Map();
    if (key) this.homeCardCollapsed.set(key, collapsed === true);
    this.scheduleHomeCardRefresh();
  }

  // Small callback seam for the later editor-settings phase: policy chips
  // route here by setting id, and today this opens the landed browse modal.
  homeCardOpenSetting(filePath, key) {
    const target = homeCardPath(filePath);
    if (!target) return { ok: false, reason: "missing-path" };
    try {
      if (typeof this.openPropertyEditor === "function") {
        return this.openPropertyEditor({ filePath: target, key: key || undefined, mode: "browse" });
      }
    } catch (_) {}
    return { ok: false, reason: "editor-unavailable" };
  }

  homeCardOpenEditorRequest(filePath, key) {
    try {
      if (typeof this.openPropertyEditor !== "function") return false;
      this.homeCardOpenSetting(filePath, key || undefined);
      return true;
    } catch (_) {
      return false;
    }
  }

  homeCardOptions(sourcePath, model) {
    const editor = typeof this.openPropertyEditor === "function"
      ? (request) => this.homeCardOpenEditorRequest(request?.filePath || sourcePath, request?.key)
      : undefined;
    return {
      sourcePath,
      collapsed: this.homeCardIsCollapsed(sourcePath),
      reducedMotion: this.homeCardReducedMotion(),
      onToggleCollapse: (next) => this.homeCardSetCollapsed(sourcePath, next),
      onOpenEditor: editor,
      onLink: (target, event) => { void this.homeCardOpenPath(target, sourcePath, event); },
    };
  }

  homeCardReducedMotion() {
    try {
      if (typeof propertyCardFootReducedMotion === "function") return propertyCardFootReducedMotion() === true;
    } catch (_) {}
    return false;
  }

  async homeCardOpenPath(target, sourcePath, event) {
    const next = homeCardPath(target);
    if (!next) return { ok: false };
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(next.replace(/\.md$/i, ""), sourcePath || "", homeCardLinkPane(event));
        return { ok: true };
      }
    } catch (_) {}
    try { new Notice("Could not open the linked note."); } catch (_) {}
    return { ok: false };
  }

  async homeCardJumpYaml(sourcePath, key, line) {
    const path = homeCardPath(sourcePath);
    if (!path) return { ok: false, reason: "missing-path" };
    const cursorLine = Number.isInteger(line) && line > 0 ? line - 1 : 0;
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      const leaf = leaves.find((item) => homeCardPath(item?.view?.file?.path) === path)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
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
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      return { ok: true, line: cursorLine + 1 };
    } catch (_) {
      try { new Notice("Could not open the note in Source mode."); } catch (_) {}
      return { ok: false, reason: "open-failed" };
    }
  }

  homeCardOnSetup() {
    if (!(this.homeCardCollapsed instanceof Map)) this.homeCardCollapsed = new Map();
    try {
      if (typeof this.homeCardLiveSubscribe === "function") this.homeCardLiveSubscribe();
    } catch (_) {}
    try { this.homeCardFootBind?.(); } catch (_) {}
    this.homeCardDay = this.homeCardTodayText();
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.homeCardMetaBound) {
        this.homeCardMetaBound = true;
        this.registerEvent(cache.on("changed", () => this.scheduleHomeCardRefresh()));
        this.registerEvent(cache.on("resolved", () => this.scheduleHomeCardRefresh()));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.homeCardVaultBound) {
        this.homeCardVaultBound = true;
        for (const name of ["create", "modify", "delete", "rename"]) {
          this.registerEvent(vault.on(name, () => this.scheduleHomeCardRefresh()));
        }
      }
    } catch (_) {}
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function" && !this.homeCardTasksBound) {
        this.homeCardTasksBound = true;
        // Local Tasks/query refresh for the Ready readout: the existing
        // cache-update fan-out coalesces through the shared refresh timer.
        this.registerEvent(workspace.on("obsidian-tasks-plugin:cache-update", () => this.scheduleHomeCardRefresh()));
      }
    } catch (_) {}
    if (!this.homeCardDayTimer && typeof setInterval === "function") {
      try {
        this.homeCardDayTimer = setInterval(() => {
          try {
            const today = this.homeCardTodayText();
            if (today && today !== this.homeCardDay) {
              this.homeCardDay = today;
              this.scheduleHomeCardRefresh();
            }
          } catch (_) {}
        }, 60 * 1000);
      } catch (_) {
        this.homeCardDayTimer = null;
      }
    }
  }

  homeCardOnDisposeStart() {
    try {
      if (typeof this.homeCardLiveUnsubscribe === "function") this.homeCardLiveUnsubscribe();
    } catch (_) {}
    try { this.homeCardFootUnbind?.(); } catch (_) {}
    try {
      if (this.homeCardDayTimer && typeof clearInterval === "function") clearInterval(this.homeCardDayTimer);
    } catch (_) {}
    this.homeCardDayTimer = null;
  }

  homeCardOnDisposeEnd() {
    try { this.homeCardCollapsed?.clear?.(); } catch (_) {}
    this.homeCardMetaBound = false;
    this.homeCardVaultBound = false;
    this.homeCardTasksBound = false;
  }

  homeCardTodayText(now = new Date()) {
    try {
      const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${date.getFullYear()}-${month}-${day}`;
    } catch (_) {
      return "";
    }
  }

  homeCardFocusKey(node, doc) {
    const active = doc?.activeElement;
    if (!active || !node || typeof node.contains !== "function" || !node.contains(active)) return "";
    for (const name of ["data-home-chip", "data-home-pill", "aria-label"]) {
      try {
        const value = active.getAttribute?.(name) || "";
        if (value) return `${name}=${value}`;
      } catch (_) {}
    }
    return active.tagName || "";
  }

  homeCardRestoreFocus(node, focusKey) {
    if (!focusKey || !node) return;
    const [name, ...rest] = String(focusKey).split("=");
    const value = rest.join("=");
    let next = null;
    try {
      if (value) next = node.querySelector?.(`[${name}="${value}"]`);
      else if (name) next = node.querySelector?.(name.startsWith(".") ? name : `[aria-label="${name}"]`);
    } catch (_) {
      next = null;
    }
    try { next?.focus?.({ preventScroll: true }); } catch (_) {}
  }

  homeCardReadingAnchor(root) {
    try {
      const headings = Array.from(root?.querySelectorAll?.("h1") || [])
        .filter((node) => !notebookInsideCode(node));
      return headings[0] || null;
    } catch (_) {
      return null;
    }
  }

  homeCardBodyNodes(root, sourcePath, exclude = null) {
    const path = homeCardPath(sourcePath);
    return Array.from(root?.querySelectorAll?.(`.${HOME_CARD_CLASS}`) || []).filter((node) => {
      if (node === exclude || !propertyCardNodeBelongs(node, root)) return false;
      if (node.classList?.contains?.(PROPERTY_CARD_TITLE_SLOT_CLASS)) return false;
      const ownedPath = homeCardPath(node.getAttribute?.("data-home-source") || "");
      return !path || !ownedPath || ownedPath === path;
    });
  }

  homeCardReleaseAdoption(scope, sourcePath = "") {
    try { return propertyCardAdoptRelease(scope, sourcePath || undefined, HOME_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) { return false; }
  }

  // Path-bound Reading removal: releases this path's title/H1 in the same
  // frame so a failed mount, path change, or unload never leaves a hidden
  // title. Never touches another path's mount in the same scope.
  homeCardRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    try { this.homeCardClearGoal?.(root); } catch (_) {}
    try { this.homeCardTrackFoot?.(scope, sourcePath, null); } catch (_) {}
    this.homeCardReleaseAdoption(scope, sourcePath);
    for (const node of Array.from(root.querySelectorAll?.(`.${HOME_CARD_CLASS}`) || [])) {
      if (!propertyCardNodeBelongs(node, root)) continue;
      const ownedPath = homeCardPath(node.getAttribute?.("data-home-source") || "");
      if (sourcePath && ownedPath && ownedPath !== homeCardPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    try { this.homeCardReleaseKeys?.(scope, sourcePath); } catch (_) {}
    const anotherOwner = Array.from(this.homeCardReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS);
  }

  homeCardRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${HOME_CARD_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") === "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (homeCardPath(node.getAttribute?.("data-home-source")) !== homeCardPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) {}
    }
  }

  homeCardCardModelFor(sourcePath, sourceText) {
    try {
      return this.homeCardModelFor(sourcePath, sourceText);
    } catch (_) {
      return null;
    }
  }

  homeCardSignature(model, extra = {}) {
    try {
      return JSON.stringify([
        model,
        extra?.footDigest || "",
        extra?.footOpen === true,
        extra?.collapsed === true,
        extra?.editorAvailable === true,
      ]);
    } catch (_) {
      return "";
    }
  }

  homeCardBuildMounted(model, options, doc, footSpec) {
    let card = null;
    try {
      card = homeCardBuildEl(doc, model, options);
    } catch (_) {
      card = null;
    }
    if (!card) return null;
    try {
      card.setAttribute?.("data-home-source", model.path);
    } catch (_) {}
    try {
      this.homeCardAppendFoot?.(card, model.path, model, doc, footSpec);
    } catch (_) {}
    return card;
  }

  paintHomeCardReading(el, sourcePath, state) {
    const root = this.homeCardReadingRoot(el);
    const scope = this.homeCardReadingScope(root);
    if (!root || !sourcePath) return null;
    // Denied contexts (embeds, popovers, canvas, print, mobile) never show
    // this card and keep native chrome.
    if (homeCardScopeDenied(scope, root) || this.homeCardDesktop() !== true) {
      this.homeCardRemoveReading(root, scope, sourcePath);
      return null;
    }
    this.homeCardRemoveStrays(root, sourcePath);
    let model = null;
    try {
      model = this.homeCardCardModelFor(sourcePath, this.homeCardSourceCache?.get?.(sourcePath));
    } catch (_) {
      model = null;
    }
    const reading = scope?.classList?.contains?.("markdown-preview-view")
      ? propertyCardReadingViewFor(this.app, scope) : null;
    const leafPath = reading ? reading.currentPath() : "";
    // A stale binding for a note this leaf no longer shows paints nothing.
    if (!model || (leafPath && leafPath !== sourcePath)) {
      this.homeCardRemoveReading(root, scope, sourcePath);
      return null;
    }
    const doc = (typeof document !== "undefined" ? document : null) || root?.ownerDocument || null;
    if (!doc || typeof doc.createElement !== "function") {
      this.homeCardRemoveReading(root, scope, sourcePath);
      return null;
    }
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === sourcePath && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.homeCardBodyNodes(root, sourcePath, slotNode);
    let header = slotNode || bodyNodes[0] || null;
    const focusKey = this.homeCardFocusKey(header, doc);
    const extra = typeof this.homeCardFootExtra === "function" ? this.homeCardFootExtra(sourcePath, model) : null;
    const options = { ...this.homeCardOptions(sourcePath, model), footSpec: extra?.footSpec };
    const signature = this.homeCardSignature(model, {
      ...extra,
      collapsed: options.collapsed,
      editorAvailable: typeof options.onOpenEditor === "function",
    });
    if (!header || homeCardNodeSignatures.get(header) !== signature) {
      let fresh = null;
      try {
        fresh = this.homeCardBuildMounted(model, options, doc, extra?.footSpec);
      } catch (_) {
        fresh = null;
      }
      if (!fresh) {
        this.homeCardRemoveReading(root, scope, sourcePath);
        return null;
      }
      header = header ? propertyCardAdoptPatch(header, fresh) : fresh;
      homeCardNodeSignatures.set(header, signature);
    }
    for (const node of bodyNodes) {
      if (node !== header) {
        try { node.remove?.(); } catch (_) {}
      }
    }
    scope?.classList?.add?.(HOME_CARD_SURFACE_CLASS);
    const adoption = propertyCardAdoptTitle(scope, header, {
      path: sourcePath,
      kind: HOME_CARD_HOST_KIND,
      view: reading?.view || null,
      currentPath: reading?.currentPath || null,
      recognizer: propertyCardHomeTitleRecognizer(model.title?.text),
      onLost: () => this.scheduleHomeCardRefresh(),
    });
    if (adoption.mode !== "slot") {
      try {
        const anchor = this.homeCardReadingAnchor(root);
        if (anchor?.parentNode?.insertBefore) anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
        else if (root.insertBefore) root.insertBefore(header, root.firstChild || null);
        else root.prepend?.(header);
      } catch (_) {
        this.homeCardRemoveReading(root, scope, sourcePath);
        return null;
      }
    }
    this.homeCardPaintGoal(root, model);
    // Native Properties stays visible: no frontmatter or key ownership here.
    this.homeCardRestoreFocus(header, focusKey);
    try { this.homeCardTrackFoot?.(scope || root, sourcePath, header); } catch (_) {}
    try { this.homeCardEnsureSource?.(sourcePath); } catch (_) {}
    return header;
  }

  homeCardGoalClassName() {
    try {
      if (typeof HOME_CARD_LIVE_GOAL_CLASS === "string" && HOME_CARD_LIVE_GOAL_CLASS) return HOME_CARD_LIVE_GOAL_CLASS;
    } catch (_) {}
    return "bob-home-card-goal";
  }

  // Reading-view goal line: one class on the recognized ^prj row, applied
  // only while a project card is mounted. Stale classes strip first so a
  // goal that moves, closes, or unmounts never leaves a decorated row.
  homeCardClearGoal(root) {
    const goalClass = this.homeCardGoalClassName();
    try {
      const stale = root?.querySelectorAll ? Array.from(root.querySelectorAll(`.${goalClass}`)) : [];
      for (const node of stale) {
        try {
          if (node.classList && typeof node.classList.remove === "function") node.classList.remove(goalClass);
        } catch (_) {}
      }
    } catch (_) {}
  }

  homeCardPaintGoal(root, model) {
    this.homeCardClearGoal(root);
    try {
      if (typeof homeCardGoalLineNode !== "function") return;
      const node = homeCardGoalLineNode(root, model);
      if (!node) return;
      try {
        if (node.classList && typeof node.classList.add === "function") node.classList.add(this.homeCardGoalClassName());
      } catch (_) {}
    } catch (_) {}
  }

  homeCardPatchLive(view, adopted, fresh, signature) {
    const target = adopted.node;
    homeCardDefer(() => {
      const entry = propertyCardAdoptedEntry(view?.dom);
      if (!entry || entry.node !== target || entry.generation !== adopted.generation) return;
      const doc = target?.ownerDocument || (typeof document !== "undefined" ? document : null);
      const focusKey = this.homeCardFocusKey(target, doc);
      propertyCardAdoptPatch(target, fresh);
      homeCardNodeSignatures.set(target, signature);
      propertyCardSyncTitleHeading(target, entry.owned);
      this.homeCardRestoreFocus(target, focusKey);
    });
  }

  // The recognized ^prj goal line keeps a lazily computed line decoration:
  // no document change, no widget, so the cursor and IME never notice it.
  // It applies only while a project card is mounted for this view's path.
  // Returns a finished RangeSet, or null when no goal line decorates.
  homeCardGoalRange(view, model) {
    try {
      if (!Decoration || typeof Decoration.line !== "function") return null;
      if (typeof homeCardGoalLineFor !== "function") return null;
      const line = homeCardGoalLineFor(model);
      if (!line || !view?.state?.doc || typeof view.state.doc.line !== "function") return null;
      const total = view.state.doc.lines || 0;
      if (!Number.isInteger(total) || line > total) return null;
      const at = view.state.doc.line(line);
      if (!at || !Number.isInteger(at.from)) return null;
      const goalClass = typeof HOME_CARD_LIVE_GOAL_CLASS === "string"
        ? HOME_CARD_LIVE_GOAL_CLASS
        : "bob-home-card-goal";
      const builder = new RangeSetBuilder();
      builder.add(at.from, at.from, Decoration.line({ attributes: { class: goalClass } }));
      return builder.finish();
    } catch (_) {
      return null;
    }
  }

  buildHomeCardDecorations(view, update) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const path = this.homeCardLivePath(view);
      if (!path || !view?.state?.doc) {
        this.homeCardReleaseAdoption(view?.dom);
        this.homeCardSetEditorScope(view, false);
        try { this.homeCardTrackFoot?.(view?.dom, this.homeCardLivePath(view), null); } catch (_) {}
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      try { this.homeCardRememberSource?.(path, text); } catch (_) {}
      const model = this.homeCardCardModelFor(path, text);
      this.homeCardSetEditorScope(view, Boolean(model));
      if (!model) {
        this.homeCardReleaseAdoption(view?.dom);
        try { this.homeCardTrackFoot?.(view?.dom, path, null); } catch (_) {}
        return Decoration.none;
      }
      const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
      const extra = typeof this.homeCardFootExtra === "function" ? this.homeCardFootExtra(path, model) : null;
      const options = { ...this.homeCardOptions(path, model), footSpec: extra?.footSpec };
      const signature = this.homeCardSignature(model, {
        ...extra,
        collapsed: options.collapsed,
        editorAvailable: typeof options.onOpenEditor === "function",
      });
      const adopted = propertyCardAdoptedEntry(view.dom);
      let header = adopted && adopted.path === path && adopted.mode === "slot" ? adopted.node : null;
      if (!header || homeCardNodeSignatures.get(header) !== signature) {
        let fresh = null;
        try {
          fresh = this.homeCardBuildMounted(model, options, doc, extra?.footSpec);
        } catch (_) {
          fresh = null;
        }
        if (!fresh) {
          this.homeCardReleaseAdoption(view?.dom);
          try { this.homeCardTrackFoot?.(view?.dom, path, null); } catch (_) {}
          return Decoration.none;
        }
        if (header) this.homeCardPatchLive(view, adopted, fresh, signature);
        else {
          header = fresh;
          homeCardNodeSignatures.set(header, signature);
        }
      }
      const adoption = propertyCardAdoptTitle(view.dom, header, {
        path,
        kind: HOME_CARD_HOST_KIND,
        view,
        recognizer: propertyCardHomeTitleRecognizer(model.title?.text),
        currentPath: () => propertyCardLiveCurrentPath(view),
        onLost: () => this.scheduleHomeCardRefresh(),
      });
      // Native Properties stays visible: no frontmatter or key ownership.
      try { this.homeCardTrackFoot?.(view?.dom, path, header); } catch (_) {}
      if (adoption.mode === "slot") {
        try { this.homeCardEnsureSource?.(path); } catch (_) {}
        return this.homeCardGoalRange(view, model) || Decoration.none;
      }
      // Fallback: inline widget at the end of the first `# ` line. Live
      // Preview adoption is deferred to a microtask; DOM mutations and
      // dispatch never run inside the CodeMirror update.
      const plugin = this;
      let anchor = -1;
      let frontmatterEnd = -1;
      try {
        anchor = typeof this.notebookHeaderLiveAnchor === "function" ? this.notebookHeaderLiveAnchor(text) : -1;
      } catch (_) {
        anchor = -1;
      }
      try {
        frontmatterEnd = typeof this.notebookHeaderFrontmatterEnd === "function" ? this.notebookHeaderFrontmatterEnd(text) : -1;
      } catch (_) {
        frontmatterEnd = -1;
      }
      const widget = new class extends WidgetType {
        constructor() {
          super();
          this.path = path;
          this.signature = signature;
        }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          header.setAttribute?.("data-cm-widget", "true");
          header.setAttribute?.("data-home-source", path);
          return header;
        }
      }();
      let at = 0;
      const side = 1;
      if (anchor >= 0) {
        try {
          at = view.state.doc.line(anchor + 1).to;
        } catch (_) {
          at = 0;
        }
      } else if (frontmatterEnd >= 0) {
        try {
          const nextLine = frontmatterEnd + 2;
          at = nextLine <= (view.state.doc.lines || 0)
            ? view.state.doc.line(nextLine).from
            : (view.state.doc.length || 0);
        } catch (_) {
          at = 0;
        }
      }
      const builder = new RangeSetBuilder();
      try {
        if (typeof homeCardGoalLineFor === "function" && typeof Decoration.line === "function") {
          const goalLine = homeCardGoalLineFor(model);
          if (goalLine && view.state.doc.lines && goalLine <= view.state.doc.lines) {
            const goalAt = view.state.doc.line(goalLine);
            if (goalAt && Number.isInteger(goalAt.from)) {
              const goalClass = typeof HOME_CARD_LIVE_GOAL_CLASS === "string"
                ? HOME_CARD_LIVE_GOAL_CLASS
                : "bob-home-card-goal";
              builder.add(goalAt.from, goalAt.from, Decoration.line({ attributes: { class: goalClass } }));
            }
          }
        }
      } catch (_) {}
      builder.add(at, at, Decoration.widget({ widget, side }));
      return builder.finish();
    } catch (_) {
      try { this.homeCardReleaseAdoption(view?.dom); } catch (_) {}
      return Decoration?.none || null;
    }
  }

  homeCardSetEditorScope(view, enabled) {
    try {
      return this.homePropertyCardHost().setEditorScope(view, enabled, {
        scopeOf: (root) => {
          try {
            return root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
          } catch (_) {
            return root;
          }
        },
        mark: (scope) => { scope?.classList?.add?.(HOME_CARD_SURFACE_CLASS); },
        unmark: (scope) => { scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS); },
      });
    } catch (_) {
      return null;
    }
  }

  homeCardCleanEditor(view) {
    try { this.homeCardTrackFoot?.(view?.dom, this.homeCardLivePath(view), null); } catch (_) {}
    try { this.homeCardReleaseAdoption(view?.dom); } catch (_) {}
    try {
      return this.homePropertyCardHost().cleanEditor(view, {
        unmark: (scope) => { scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS); },
      });
    } catch (_) {}
  }

  createHomeCardExtension() {
    return this.homePropertyCardHost().createExtension();
  }

  refreshHomeCardReading() {
    this.homePropertyCardHost().refreshReading();
  }

  refreshHomeCardEditors() {
    this.homePropertyCardHost().refreshEditors();
  }

  scheduleHomeCardRefresh() {
    this.homePropertyCardHost().scheduleRefresh();
  }
}
