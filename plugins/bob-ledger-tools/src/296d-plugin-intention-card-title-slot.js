// Day and period cards as the note's title block (bob-cli-o6
// day-period-cards). With the title-slot verdict GO, the card mounts in
// Obsidian's own title slot (after the hidden inline title, before native
// Properties) in Live Preview and Reading, and owns the note title: the kit
// hides the inline title and the recognized H1, nav, and child-link lines at
// render time, with reveal on cursor touch. Bytes never change.
//
// The body mount from before stays as the fallback, used only when the slot
// primitive returns null or reports `unstable` / `insert-failed`. A fallback
// card never owns the title (today's layout plus the card), and fallback is
// sticky per scope and path until a path or mode change clears it. Owned
// Properties rows stay content-gated: an identity-only card owns none.
//
// State: this.intentionCardSlots, a Map from native view scope (.cm-editor or
// .markdown-preview-view) to { scope, mode, path, signature, node,
// slotRelease, titleRelease, titleKey, titlePath, fallback, generation }.
const INTENTION_CARD_SLOT_FALLBACK_REASONS = Object.freeze(["unstable", "insert-failed"]);

let IntentionCardObsidianKeymap = null;
try {
  const obsidianMod = require("obsidian");
  IntentionCardObsidianKeymap = (obsidianMod && obsidianMod.Keymap) || null;
} catch (_) {
  IntentionCardObsidianKeymap = null;
}

function intentionCardSlotDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

// Obsidian's pane type for a link click: Keymap.isModEvent when available
// (tab, split, or window), else Ctrl/Cmd/Shift. A middle click opens a tab.
function intentionCardLinkPaneType(event) {
  if (!event) return false;
  if (event.button === 1 || (event.type === "auxclick" && event.button === 1)) return "tab";
  try {
    if (IntentionCardObsidianKeymap && typeof IntentionCardObsidianKeymap.isModEvent === "function") {
      return IntentionCardObsidianKeymap.isModEvent(event) || false;
    }
  } catch (_) {}
  return Boolean(event.ctrlKey || event.metaKey || event.shiftKey);
}

function intentionCardLinkModified(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
    || event.button === 1 || event.type === "auxclick"));
}

function intentionCardChildByClass(node, name) {
  try {
    return Array.from(node?.children || []).find((child) => child?.classList?.contains?.(name)) || null;
  } catch (_) {
    return null;
  }
}

// "reading", "source", or "live" for a MarkdownView; "" when unknown.
function intentionCardLeafMode(view) {
  try {
    if (!view) return "";
    const mode = typeof view.getMode === "function" ? view.getMode()
      : view.currentMode && view.currentMode === view.previewMode ? "preview" : "source";
    if (mode === "preview") return "reading";
    const state = typeof view.getState === "function" ? view.getState() : null;
    return state && state.source === true ? "source" : "live";
  } catch (_) {
    return "";
  }
}

// The .markdown-preview-view scope of a MarkdownView's Reading mode.
function intentionCardLeafReadingScope(view) {
  const container = view?.previewMode?.containerEl;
  if (!container) return null;
  if (container.classList?.contains?.("markdown-preview-view")) return container;
  return intentionCardChildByClass(container, "markdown-preview-view");
}

// Reading virtualizes .mod-header away when scrolled far: a parked header is
// neither a slot nor a reason to fall back.
function intentionCardReadingHeaderParked(scope) {
  const sizer = intentionCardChildByClass(scope, "markdown-preview-sizer");
  return Boolean(sizer && !intentionCardChildByClass(sizer, "mod-header"));
}

function intentionCardEditorFilePath(view) {
  try {
    if (typeof editorInfoField === "undefined" || !editorInfoField) return "";
    return String(view?.state?.field?.(editorInfoField, false)?.file?.path || "");
  } catch (_) {
    return "";
  }
}

class BobLedgerToolsIntentionCardTitleSlotMixin {
  intentionCardSlotMap() {
    if (!(this.intentionCardSlots instanceof Map)) this.intentionCardSlots = new Map();
    return this.intentionCardSlots;
  }

  intentionCardSlotNextGeneration() {
    this.intentionCardSlotGeneration = (this.intentionCardSlotGeneration || 0) + 1;
    return this.intentionCardSlotGeneration;
  }

  intentionCardSlotIsFallback(scope, path) {
    const entry = scope ? this.intentionCardSlotMap().get(scope) : null;
    return Boolean(entry && entry.fallback && entry.path === intentionCardFilePath(path));
  }

  // Slot handle, title handle, keys, and render component. Never onLost.
  intentionCardSlotTeardown(entry) {
    if (!entry) return;
    try {
      propertyCardFrontmatterReleaseMounted?.(entry.scope, {
        plugin: this, kind: entry.kind || "", path: entry.path,
      });
    } catch (_) {}
    try { entry.slotRelease?.(); } catch (_) {}
    try { entry.titleRelease?.(); } catch (_) {}
    entry.slotRelease = null;
    entry.titleRelease = null;
    if (entry.node) {
      intentionCardDomRelease(entry.node);
      try {
        if (entry.node.parentNode) {
          if (typeof entry.node.remove === "function") entry.node.remove();
          else entry.node.parentNode.removeChild?.(entry.node);
        }
      } catch (_) {}
    }
    try { this.intentionCardTrackFoot?.(entry.scope, entry.path, null); } catch (_) {}
    try { this.intentionCardRelease(entry.scope, entry.path); } catch (_) {}
  }

  // Release scope's entry; a nonempty path releases only that path's entry.
  intentionCardSlotRelease(scope, options = {}) {
    if (!scope) return false;
    const map = this.intentionCardSlotMap();
    const entry = map.get(scope);
    if (!entry) return false;
    const path = options && options.path ? intentionCardFilePath(options.path) : "";
    if (path && entry.path !== path) return false;
    map.delete(scope);
    this.intentionCardSlotTeardown(entry);
    return true;
  }

  intentionCardSlotReleaseAll() {
    const map = this.intentionCardSlotMap();
    for (const [scope, entry] of Array.from(map.entries())) {
      map.delete(scope);
      this.intentionCardSlotTeardown(entry);
    }
  }

  intentionCardSlotMarkFallback(scope, mode, path) {
    try {
      propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kinds: ["day", "week", "quarter", "year"] });
    } catch (_) {}
    const entry = {
      scope, mode, path: intentionCardFilePath(path), signature: "", node: null, slotRelease: null,
      titleRelease: null, titleKey: "", titlePath: "", fallback: true, generation: this.intentionCardSlotNextGeneration(),
    };
    this.intentionCardSlotMap().set(scope, entry);
    return entry;
  }

  // Owned Properties rows follow content, exactly as before the title block:
  // the seven keys hide only while intentions, summary, or reflection exist.
  intentionCardCommitKeys(scope, path, model) {
    const key = intentionCardFilePath(path);
    if (!scope || !key) return false;
    if (model && model.hasContent) {
      const owned = this.intentionCardKeySlots instanceof Map ? this.intentionCardKeySlots.get(scope) : null;
      if (!owned || owned.path !== key) this.intentionCardOwn(scope, key);
      return true;
    }
    this.intentionCardRelease(scope, key);
    return false;
  }

  // Title ownership in slot mode. Live Preview re-owns idempotently (same
  // path and key keep the handle); Reading re-owns only on a path or key change.
  intentionCardSlotOwnTitle(entry, view, recognizer) {
    if (!entry || entry.fallback) return null;
    const drop = () => {
      try { entry.titleRelease?.(); } catch (_) {}
      entry.titleRelease = null;
      entry.titleKey = "";
      entry.titlePath = "";
      return null;
    };
    if (!recognizer || typeof recognizer.key !== "string") return drop();
    if (entry.mode === "live") {
      let handle = null;
      try {
        handle = typeof propertyCardOwnTitleInEditor === "function"
          ? propertyCardOwnTitleInEditor(view, { path: entry.path, recognizer }) : null;
      } catch (_) { handle = null; }
      if (!handle) return drop();
      entry.titleRelease = handle;
      entry.titleKey = recognizer.key;
      entry.titlePath = entry.path;
      return handle;
    }
    if (entry.titleRelease && entry.titleKey === recognizer.key && entry.titlePath === entry.path) return entry.titleRelease;
    drop();
    let handle = null;
    try {
      handle = typeof propertyCardOwnTitleInReading === "function"
        ? propertyCardOwnTitleInReading(entry.scope, { path: entry.path, recognizer }) : null;
    } catch (_) { handle = null; }
    entry.titleRelease = handle;
    entry.titleKey = handle ? recognizer.key : "";
    entry.titlePath = handle ? entry.path : "";
    return handle;
  }

  // Mount (or keep) the card in scope's title slot. Returns the card node, or
  // null after recording a sticky fallback (the caller paints the body).
  intentionCardSlotMount(scope, options = {}) {
    const mode = options.mode === "reading" ? "reading" : "live";
    const view = options.view || null;
    const prepared = options.prepared || null;
    const model = prepared?.model || null;
    const path = intentionCardFilePath(options.path);
    if (!scope || !path || !model) return null;
    const extra = typeof this.intentionCardFootExtra === "function" ? this.intentionCardFootExtra(path, model) : null;
    if (extra?.footSpec) model.footSpec = extra.footSpec;
    const signature = typeof this.intentionCardFootSignature === "function"
      ? this.intentionCardFootSignature(model, extra)
      : model.signature;
    const map = this.intentionCardSlotMap();
    const existing = map.get(scope) || null;
    const mounted = typeof propertyCardTitleSlotMountedNode === "function" ? propertyCardTitleSlotMountedNode(scope) : null;
    if (existing && !existing.fallback && existing.path === path && existing.mode === mode
      && existing.signature === signature && existing.node && mounted === existing.node) {
      existing.currentPath = typeof options.currentPath === "function" ? options.currentPath : null;
      existing.view = mode === "live" ? view : null;
      existing.kind = model.kind;
      this.intentionCardSlotOwnTitle(existing, view, prepared.recognizer);
      this.intentionCardCommitKeys(scope, path, model);
      try { this.intentionCardTrackFoot?.(scope, path, existing.node); } catch (_) {}
      this.intentionCardOwnMountedFrontmatter(existing);
      return existing.node;
    }
    const generation = this.intentionCardSlotNextGeneration();
    const entry = {
      scope, mode, path, signature, node: null, slotRelease: null,
      titleRelease: null, titleKey: "", titlePath: "", fallback: false, generation,
      view: mode === "live" ? view : null, kind: model.kind,
      currentPath: typeof options.currentPath === "function" ? options.currentPath : null,
    };
    if (existing && !existing.fallback && existing.path === path && existing.mode === mode) {
      entry.titleRelease = existing.titleRelease;
      entry.titleKey = existing.titleKey;
      entry.titlePath = existing.titlePath;
    } else if (existing) {
      try { existing.titleRelease?.(); } catch (_) {}
      if (existing.path !== path) this.intentionCardRelease(scope, existing.path);
    }
    let release = null;
    const available = typeof propertyCardMountInTitleSlot === "function"
      && (typeof propertyCardTitleSlotFor !== "function" || Boolean(propertyCardTitleSlotFor(scope)));
    if (available) {
      const doc = scope.ownerDocument || (typeof document !== "undefined" ? document : null);
      entry.node = intentionCardBuildDom(model, this, doc);
      if (entry.node) {
        try {
          release = propertyCardMountInTitleSlot(scope, entry.node, {
            path, kind: model.kind, view,
            currentPath: typeof options.currentPath === "function" ? options.currentPath : null,
            onLost: (reason) => this.intentionCardSlotLost(scope, generation, reason),
            onMount: () => {
              if (mode === "reading" && map.get(scope) === entry) this.intentionCardOwnMountedFrontmatter(entry);
            },
          });
        } catch (_) { release = null; }
      }
    }
    if (!release && typeof propertyCardTitleSlotRelease === "function"
      && typeof propertyCardTitleSlotMountedNode === "function" && propertyCardTitleSlotMountedNode(scope)) {
      try { propertyCardTitleSlotRelease(scope); } catch (_) {}
    }
    // The primitive detached the previous node for this scope.
    if (existing?.node && existing.node !== entry.node) intentionCardDomRelease(existing.node);
    if (!release) {
      if (entry.node) intentionCardDomRelease(entry.node);
      try { entry.titleRelease?.(); } catch (_) {}
      this.intentionCardRelease(scope, path);
      this.intentionCardSlotMarkFallback(scope, mode, path);
      return null;
    }
    entry.slotRelease = release;
    map.set(scope, entry);
    this.intentionCardSlotOwnTitle(entry, view, prepared.recognizer);
    this.intentionCardCommitKeys(scope, path, model);
    try { this.intentionCardTrackFoot?.(scope, path, entry.node); } catch (_) {}
    this.intentionCardOwnMountedFrontmatter(entry);
    return entry.node;
  }

  intentionCardOwnMountedFrontmatter(entry) {
    if (!entry || entry.fallback || typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const sourceFor = () => {
      const source = this.intentionCardFootSource?.(entry.path);
      return typeof source?.source === "string" ? source.source : undefined;
    };
    return propertyCardFrontmatterOwnMounted(this, {
      scope: entry.scope, view: entry.view || null, path: entry.path,
      kind: entry.kind, mount: entry.node, getSource: sourceFor,
      currentPath: entry.currentPath || (() => entry.view?.file?.path || ""),
      active: () => this.intentionCardActive === true,
      isCurrent: () => typeof sourceFor() === "string",
    });
  }

  // The primitive lost the slot. Only the current generation counts: drop
  // the entry and everything it owns, fall back on `unstable` or
  // `insert-failed`, then let a refresh remount or paint the body.
  intentionCardSlotLost(scope, generation, reason) {
    const map = this.intentionCardSlotMap();
    const entry = map.get(scope);
    if (!entry || entry.generation !== generation) return;
    map.delete(scope);
    entry.slotRelease = null;
    this.intentionCardSlotTeardown(entry);
    if (INTENTION_CARD_SLOT_FALLBACK_REASONS.includes(reason)) this.intentionCardSlotMarkFallback(scope, entry.mode, entry.path);
    try { this.intentionCardHost().scheduleRefresh(); } catch (_) {}
  }

  intentionCardMarkdownLeaves() {
    try { return this.app?.workspace?.getLeavesOfType?.("markdown") || []; } catch (_) { return []; }
  }

  // An editor whose pane shows Reading (or Source) never holds a slot card,
  // so a pane has exactly one aria-level=1 title. Unknown editors pass.
  intentionCardEditorShown(view) {
    for (const leaf of this.intentionCardMarkdownLeaves()) {
      if (leaf?.view?.editor?.cm === view) return intentionCardLeafMode(leaf.view) === "live";
    }
    return true;
  }

  intentionCardReadingLeaf(scope) {
    if (!scope) return null;
    for (const leaf of this.intentionCardMarkdownLeaves()) {
      const container = leaf?.view?.previewMode?.containerEl;
      try {
        if (container && (container === scope || container.contains?.(scope))) return leaf;
      } catch (_) {}
    }
    return null;
  }

  // ---- Live Preview --------------------------------------------------------

  buildIntentionCardDecorations(view) {
    try {
      if (!Decoration || !view?.state?.doc) return Decoration?.none || null;
      const path = this.intentionCardLivePath(view);
      if (!path) {
        this.intentionCardLiveRelease(view);
        return Decoration.none;
      }
      const source = view.state.doc.toString();
      const prepared = this.intentionCardModelFor(path, source);
      if (!prepared) {
        this.intentionCardLiveRelease(view);
        return Decoration.none;
      }
      this.intentionCardHost().setEditorScope(view, true);
      if (this.intentionCardSlotIsFallback(view.dom, path)) return this.intentionCardFallbackDecorations(view, path, source, prepared);
      // Mounting touches the DOM outside CodeMirror's content, so it runs
      // after this update, once per view.
      this.intentionCardSlotScheduleLive(view);
      return Decoration.none;
    } catch (_) {
      return Decoration?.none || null;
    }
  }

  intentionCardLiveRelease(view) {
    try { propertyCardFrontmatterReleaseMounted?.(view?.dom, { plugin: this, kinds: ["day", "week", "quarter", "year"] }); } catch (_) {}
    try { this.intentionCardHost().setEditorScope(view, false); } catch (_) {}
    try { this.intentionCardTrackFoot?.(view?.dom, this.intentionCardLivePath(view), null); } catch (_) {}
    this.intentionCardSlotRelease(view?.dom);
    this.intentionCardRelease(view?.dom);
  }

  // Body fallback: today's widget, with keys owned only while content exists.
  intentionCardFallbackDecorations(view, path, source, prepared) {
    try { propertyCardFrontmatterReleaseMounted?.(view?.dom, { plugin: this, kinds: ["day", "week", "quarter", "year"] }); } catch (_) {}
    const plugin = this;
    const anchor = this.intentionCardLiveAnchor(source, prepared.subject);
    const doc = view.dom?.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!anchor || !doc || !RangeSetBuilder || !WidgetType) {
      this.intentionCardRelease(view?.dom);
      return Decoration.none;
    }
    const model = prepared.model;
    const extra = typeof plugin.intentionCardFootExtra === "function" ? plugin.intentionCardFootExtra(path, model) : null;
    if (extra?.footSpec) model.footSpec = extra.footSpec;
    const signature = JSON.stringify([
      path, anchor.offset, anchor.side, model.signature, extra?.footDigest || "", extra?.footOpen === true,
    ]);
    // Built lazily: CodeMirror discards an equal widget without toDOM, and
    // destroy() unloads the card's render component with its DOM.
    const Widget = class extends WidgetType {
      constructor() { super(); this.signature = signature; this.path = path; }
      eq(other) { return other?.signature === signature && other?.path === path; }
      toDOM() {
        const element = intentionCardBuildDom(model, plugin, doc) || doc.createElement("span");
        element.setAttribute("data-cm-widget", "true");
        plugin.intentionCardCommitKeys(view.dom, path, model);
        try { plugin.intentionCardTrackFoot?.(view.dom, path, element); } catch (_) {}
        return element;
      }
      destroy(dom) {
        try { plugin.intentionCardTrackFoot?.(view.dom, path, null); } catch (_) {}
        intentionCardDomRelease(dom);
      }
      ignoreEvent() { return true; }
    };
    const builder = new RangeSetBuilder();
    builder.add(anchor.offset, anchor.offset, Decoration.widget({ widget: new Widget(), side: anchor.side }));
    return builder.finish();
  }

  intentionCardSlotScheduleLive(view) {
    if (!(this.intentionCardSlotPending instanceof WeakSet)) this.intentionCardSlotPending = new WeakSet();
    if (!view || this.intentionCardSlotPending.has(view)) return;
    this.intentionCardSlotPending.add(view);
    intentionCardSlotDefer(() => {
      try { this.intentionCardSlotPending?.delete?.(view); } catch (_) {}
      try { this.intentionCardSlotMountLive(view); } catch (_) {}
    });
  }

  intentionCardSlotMountLive(view) {
    if (!this.intentionCardActive) return null;
    const scope = view?.dom;
    let connected = false;
    try { connected = Boolean(scope) && scope.isConnected !== false; } catch (_) { connected = false; }
    if (!connected) return null;
    const path = this.intentionCardLivePath(view);
    if (!path || !this.intentionCardEditorShown(view)) {
      this.intentionCardSlotRelease(scope);
      this.intentionCardRelease(scope);
      return null;
    }
    const prepared = this.intentionCardModelFor(path, view.state.doc.toString());
    if (!prepared) {
      this.intentionCardSlotRelease(scope);
      this.intentionCardRelease(scope);
      return null;
    }
    if (this.intentionCardSlotIsFallback(scope, path)) return null;
    const node = this.intentionCardSlotMount(scope, {
      mode: "live", view, path, prepared, currentPath: () => intentionCardEditorFilePath(view),
    });
    if (!node) this.intentionCardSlotRefreshView(view);
    return node;
  }

  // Rebuild one view's decorations (with the fallback widget), never inside
  // an update.
  intentionCardSlotRefreshView(view) {
    intentionCardSlotDefer(() => {
      try {
        const effect = this.intentionCardHost().ensureRefreshEffect();
        if (effect && typeof view?.dispatch === "function") view.dispatch({ effects: effect.of(null) });
      } catch (_) {}
    });
  }

  intentionCardCleanEditor(view) {
    try { propertyCardFrontmatterReleaseMounted?.(view?.dom, { plugin: this, kinds: ["day", "week", "quarter", "year"] }); } catch (_) {}
    this.intentionCardHost().cleanEditor(view);
    this.intentionCardSlotRelease(view?.dom);
    this.intentionCardRelease(view?.dom);
  }

  // ---- Reading -------------------------------------------------------------

  paintIntentionCardReading(el, sourcePath) {
    const root = propertyCardReadingRoot(el);
    const scope = propertyCardReadingScope(root);
    try {
      if (!root || !sourcePath || !this.intentionCardCanDisplay(sourcePath, el)) {
        this.intentionCardReadingDrop(root, scope, sourcePath);
        return null;
      }
      const leaf = this.intentionCardReadingLeaf(scope);
      if (leaf && intentionCardLeafMode(leaf.view) !== "reading") {
        this.intentionCardReadingDrop(root, scope, sourcePath);
        return null;
      }
      const prepared = this.intentionCardModelFor(sourcePath);
      if (!prepared) {
        this.intentionCardReadingDrop(root, scope, sourcePath);
        return null;
      }
      if (!this.intentionCardSlotIsFallback(scope, sourcePath)) {
        if (intentionCardReadingHeaderParked(scope)) {
          const entry = this.intentionCardSlotMap().get(scope);
          if (entry && !entry.fallback && entry.path === intentionCardFilePath(sourcePath)) {
            try { this.intentionCardTrackFoot?.(scope, sourcePath, entry.node); } catch (_) {}
            return entry.node;
          }
          this.intentionCardRetryReading(root);
          return null;
        }
        const node = this.intentionCardSlotMount(scope, {
          mode: "reading", view: leaf?.view?.previewMode?.renderer || null, path: sourcePath, prepared,
          currentPath: leaf ? () => String(leaf.view?.file?.path || "") : null,
        });
        if (node) {
          this.intentionCardReadingRetries?.delete?.(root);
          this.intentionCardRemoveNodes(root, sourcePath, node);
          try { this.intentionCardTrackFoot?.(scope, sourcePath, node); } catch (_) {}
          return node;
        }
      }
      return this.intentionCardPaintReadingBody(root, scope, sourcePath, prepared);
    } catch (error) {
      this.intentionCardReadingDrop(root, scope, sourcePath);
      throw error;
    }
  }

  // Today's body layout: after the H1 and nav sections, or prepended inside
  // the first content section of a note without an H1. No title ownership.
  intentionCardPaintReadingBody(root, scope, sourcePath, prepared) {
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kinds: ["day", "week", "quarter", "year"], path: sourcePath }); } catch (_) {}
    this.intentionCardRemoveNodes(root, sourcePath);
    const noHeading = prepared.placement && prepared.placement.headingLine < 0;
    const anchor = noHeading ? intentionCardDomFirstSection(root)
      : intentionCardDomAnchor(root, prepared.subject, this.intentionCardToday());
    if (!anchor) {
      this.intentionCardRetryReading(root);
      return null;
    }
    this.intentionCardReadingRetries?.delete?.(root);
    const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    const card = intentionCardBuildDom(prepared.model, this, doc);
    if (!card) return null;
    if (noHeading) {
      if (typeof anchor.insertBefore === "function") anchor.insertBefore(card, anchor.firstChild || null);
      else anchor.appendChild?.(card);
    } else if (anchor.parentNode === root && typeof anchor.appendChild === "function") {
      // Obsidian's preview renderer owns the sizer's direct children and
      // prunes foreign ones, so a section-level anchor hosts the card inside
      // itself, after its own content.
      anchor.appendChild(card);
    } else if (anchor.parentNode?.insertBefore) anchor.parentNode.insertBefore(card, anchor.nextElementSibling || null);
    else if (root.insertBefore) root.insertBefore(card, anchor.nextElementSibling || null);
    else root.appendChild?.(card);
    if (!card.parentNode) return null;
    this.intentionCardCommitKeys(scope, sourcePath, prepared.model);
    try { this.intentionCardTrackFoot?.(scope, sourcePath, card); } catch (_) {}
    return card;
  }

  // Remove every display this scope holds for the path: slot entry (title and
  // keys with it), body cards, and keys.
  intentionCardReadingDrop(root, scope, sourcePath = "") {
    try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kinds: ["day", "week", "quarter", "year"], path: sourcePath }); } catch (_) {}
    try { this.intentionCardTrackFoot?.(scope, sourcePath, null); } catch (_) {}
    this.intentionCardSlotRelease(scope, { path: sourcePath });
    this.intentionCardRemoveNodes(root, sourcePath);
    this.intentionCardRelease(scope, sourcePath);
  }

  intentionCardReadingStillShows(scope, sourcePath) {
    if (!this.intentionCardActive || !scope || !sourcePath) return false;
    try { if (scope.isConnected === false) return false; } catch (_) { return false; }
    const leaf = this.intentionCardReadingLeaf(scope);
    return Boolean(leaf && intentionCardLeafMode(leaf.view) === "reading"
      && intentionCardFilePath(leaf.view?.file?.path) === intentionCardFilePath(sourcePath));
  }

  // Host hook (section unbind, failed repaint, dispose). A section that
  // re-renders while its pane still shows the note in Reading keeps the title
  // block, so the title never flashes; the refresh repaints it.
  removeIntentionCardReading(root, scope = root, sourcePath = "") {
    const entry = scope ? this.intentionCardSlotMap().get(scope) : null;
    if (entry && !entry.fallback && entry.path === intentionCardFilePath(sourcePath)
      && this.intentionCardReadingStillShows(scope, sourcePath)) {
      this.intentionCardRemoveNodes(root, sourcePath, entry.node);
      try { this.intentionCardHost().scheduleRefresh(); } catch (_) {}
      return;
    }
    this.intentionCardReadingDrop(root, scope, sourcePath);
  }

  // ---- Sweep ---------------------------------------------------------------

  // Host onRefresh: prune disconnected scopes, release cards a pane no longer
  // shows (the hidden Reading card while editing, a switched file, Source
  // mode), and paint Reading panes whose post-processor never fired. O(leaves).
  intentionCardSweepTitleSlots() {
    try {
      if (!this.intentionCardActive) return;
      const map = this.intentionCardSlotMap();
      for (const [scope, entry] of Array.from(map.entries())) {
        let gone = false;
        try { gone = !scope || scope.isConnected === false; } catch (_) { gone = true; }
        if (gone) {
          map.delete(scope);
          this.intentionCardSlotTeardown(entry);
        }
      }
      for (const leaf of this.intentionCardMarkdownLeaves()) {
        try { this.intentionCardSweepLeaf(leaf); } catch (_) {}
      }
    } catch (_) {}
  }

  intentionCardSweepLeaf(leaf) {
    const view = leaf?.view;
    if (!view) return;
    const map = this.intentionCardSlotMap();
    const path = intentionCardFilePath(view.file?.path || "");
    const mode = intentionCardLeafMode(view);
    const live = view.editor?.cm?.dom || null;
    const reading = intentionCardLeafReadingScope(view);
    const wanted = mode === "reading" ? reading : mode === "live" ? live : null;
    for (const scope of [live, reading]) {
      const entry = scope ? map.get(scope) : null;
      if (entry && (scope !== wanted || entry.path !== path)) this.intentionCardSlotRelease(scope);
    }
    if (mode !== "reading" || !reading || !path || !this.intentionCardCanDisplay(path, reading)) return;
    const entry = map.get(reading);
    if (entry && entry.fallback) return;
    const sizer = intentionCardChildByClass(reading, "markdown-preview-sizer");
    if (sizer) this.paintIntentionCardReading(sizer, path);
  }

  // ---- Actions -------------------------------------------------------------

  // One helper for kicker links, the parent link, and chips: Markdown link
  // behavior, including Mod/Alt for tabs and splits.
  intentionCardOpenLink(target, sourcePath, event) {
    const link = String(target || "").replace(/\.md$/i, "");
    if (!link) return false;
    try {
      const opened = this.app?.workspace?.openLinkText?.(link, String(sourcePath || ""), intentionCardLinkPaneType(event));
      Promise.resolve(opened).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  intentionCardLeafForEvent(event, sourcePath) {
    const leaves = this.intentionCardMarkdownLeaves();
    const target = event?.target || null;
    if (target) {
      for (const leaf of leaves) {
        try { if (leaf?.view?.containerEl?.contains?.(target)) return leaf; } catch (_) {}
      }
    }
    const path = intentionCardFilePath(sourcePath);
    return leaves.find((leaf) => intentionCardFilePath(leaf?.view?.file?.path) === path) || null;
  }

  // Rail prev and next run bob-navigation-hotkeys' open-prev-link /
  // open-next-link in the card's own pane, so jump history matches [n / ]n
  // (as the record walk rail does). Those commands follow the note's first
  // rendered link labelled `prev`/`next` (daily) or `‹ …`/`… ›` (period),
  // and fall back to the derived calendar stops when the note has none. The
  // rail paints its step row from a recognized nav line at the top of the
  // body, or, when no nav line exists, a derived step row from the same
  // walkMode.links calendar stops, so the command and the rail still pick
  // the same stop. Everything else, and any modified click, opens like the
  // Markdown link.
  async intentionCardRailNavigate(direction, item, sourcePath, event) {
    if ((direction === "prev" || direction === "next") && !intentionCardLinkModified(event)) {
      const commandId = `bob-navigation-hotkeys:open-${direction}-link`;
      const commands = this.app?.commands;
      let command = null;
      try { command = commands?.commands?.[commandId] || commands?.findCommand?.(commandId) || null; } catch (_) { command = null; }
      const leaf = this.intentionCardLeafForEvent(event, sourcePath);
      if (command && typeof commands?.executeCommandById === "function" && leaf
        && intentionCardFilePath(leaf.view?.file?.path) === intentionCardFilePath(sourcePath)) {
        try {
          this.app.workspace.setActiveLeaf?.(leaf, { focus: true });
          commands.executeCommandById(commandId);
          return true;
        } catch (_) {}
      }
    }
    return this.intentionCardOpenLink(item?.target, sourcePath, event);
  }

  // The ghost opens the card editor on the intention stage.
  intentionCardOpenGhost(path) {
    if (typeof this.openIntentionCard !== "function") return null;
    return this.openIntentionCard({ filePath: path, initialStage: "add" });
  }
}
