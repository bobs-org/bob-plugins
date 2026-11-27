// Shared property-card host: one Reading/Live Preview lifecycle for album,
// record, and bank adapters. createPropertyCardHost({...}) returns a
// controller with setup/dispose, refresh, scheduleRefresh, Reading mounting,
// and editor-extension hooks. Adapters keep their models, gates, builders,
// anchors, and post-paint behavior.
//
// Failure contract: paintReading owns its mount. When it throws, the host
// removes that mount through the adapter's path-bound removeReading and
// releases only that mount's generation/path-bound ownership, so native
// Properties are exposed. The widget stays tracked so a later successful
// refresh recovers. Editor construction/rebuild failures clear stale
// decorations and release the same view's ownership the same way.
//
// Options (final API):
//   plugin, kind, readingPriority,
//   fields: { active, reading, readingPending, readingTimers, editors,
//             editorScopes, refreshTimer, keySlots? },
//   setTimeout, clearTimeout, pathOf(path),
//   readingRoot(el), readingScope(root),
//   acceptReading(el, ctx), paintReading(el, path) (throwing paint counts as
//     a failed mount; a null return means no card and stays native),
//   removeReading(root, scope, path) (path-bound DOM removal plus that
//     mount's ownership release; must stay idempotent),
//   onBind(widget, el, ctx, root), onUnbind(widget),
//   afterRefreshReading(),
//   allowEmbedDisplay (default false; album/record/bank pass true),
//   livePath(view), sourcePath(view), viewPath(view),
//   buildDecorations(view, update?), shouldRebuild(update, prevPath, nextPath),
//   editorAttributes(view) (optional; omit to skip the CodeMirror facet),
//   cleanEditor(view),
//   ownKeys(scope, path), releaseKeys(scope, path) (wrap the adapter's
//     property-card slot; controller.commitMount(scope, path, mounted) owns
//     after a successful mount and releases after a failed one for generic
//     hosts — production adapters own directly inside paint/build and the
//     host calls their remove/clean hooks on failure),
//   editorScopeOf(root, view), markEditorScope(scope, view, enabled),
//   workspaceEvents: string[] (each schedules refresh() unless
//     onWorkspaceEvent(name, controller) is given, which replaces it),
//   titleOwnership (default false; true registers the identity kit's title
//     ownership StateField once per plugin instance, and dispose() releases
//     every owned title through propertyCardTitleReleaseAll()),
//   onSetup(), onDisposeStart(), onDisposeEnd(), onRefresh().
const PROPERTY_CARD_HOST_REFRESH_MS = 100;
const PROPERTY_CARD_HOST_SURFACE_RETRY_LIMIT = 8;
const PROPERTY_CARD_HOSTS = new WeakMap();

function propertyCardHostsOf(plugin) {
  if (!plugin) return null;
  let hosts = PROPERTY_CARD_HOSTS.get(plugin);
  if (!hosts) {
    hosts = new Set();
    PROPERTY_CARD_HOSTS.set(plugin, hosts);
  }
  return hosts;
}

function propertyCardHostElDetached(el) {
  try {
    if (!el) return true;
    if (el.isConnected === false) return true;
    return false;
  } catch (_) {
    return true;
  }
}

function propertyCardHostLeafPath(leaf) {
  try {
    return String(leaf?.view?.file?.path || "");
  } catch (_) {
    return "";
  }
}

function propertyCardHostLeafIsPreview(leaf) {
  const view = leaf?.view;
  if (!view) return false;
  try {
    if (typeof view.getMode === "function" && view.getMode() === "preview") return true;
  } catch (_) {}
  try {
    if (view.currentMode && view.previewMode && view.currentMode === view.previewMode) return true;
  } catch (_) {}
  return false;
}

function propertyCardHostPreviewLeaves(plugin, path) {
  const found = [];
  const seen = new Set();
  const add = (leaf) => {
    try {
      if (!leaf || seen.has(leaf)) return;
      if (!propertyCardHostLeafIsPreview(leaf)) return;
      if (path && propertyCardHostLeafPath(leaf) !== path) return;
      seen.add(leaf);
      found.push(leaf);
    } catch (_) {}
  };
  try {
    for (const leaf of plugin?.app?.workspace?.getLeavesOfType?.("markdown") || []) add(leaf);
  } catch (_) {}
  try { add(plugin?.app?.workspace?.activeLeaf); } catch (_) {}
  try { plugin?.app?.workspace?.iterateAllLeaves?.((leaf) => add(leaf)); } catch (_) {}
  return found;
}

function propertyCardHostElInLeaf(el, leaf) {
  try {
    if (!el || !leaf) return false;
    const container = leaf?.view?.previewMode?.containerEl;
    if (!container) return false;
    if (container === el || container.contains?.(el) || el.contains?.(container)) return true;
    const pane = el.closest?.(".markdown-preview-view");
    return Boolean(pane && (container === pane || container.contains?.(pane)));
  } catch (_) {
    return false;
  }
}

// Rebound widgets pin `el` to the long-lived preview-view. That node stays
// connected when the leaf opens another note, so a leftover eat.md widget
// would keep the new note's sizer and skip (or wipe) the new card.
function propertyCardHostPaneMovedOn(plugin, widget) {
  try {
    if (!widget || propertyCardHostElDetached(widget.el)) return false;
    if (propertyCardHostPreviewLeaves(plugin, widget.path).some((leaf) => propertyCardHostElInLeaf(widget.el, leaf))) {
      return false;
    }
    for (const leaf of propertyCardHostPreviewLeaves(plugin, "")) {
      if (!propertyCardHostElInLeaf(widget.el, leaf)) continue;
      const leafPath = propertyCardHostLeafPath(leaf);
      return Boolean(leafPath && widget.path && leafPath !== widget.path);
    }
  } catch (_) {}
  return false;
}

function propertyCardHostLiveReadingSurface(plugin, path, readingRootFn) {
  const resolve = (el) => {
    if (!el || propertyCardHostElDetached(el)) return null;
    try {
      const root = typeof readingRootFn === "function"
        ? readingRootFn(el)
        : propertyCardReadingRoot(el);
      if (root && !propertyCardHostElDetached(root)) return { el, root };
    } catch (_) {}
    return null;
  };
  try {
    for (const leaf of propertyCardHostPreviewLeaves(plugin, path)) {
      const container = leaf?.view?.previewMode?.containerEl;
      const candidates = [];
      if (container) candidates.push(container);
      try {
        for (const node of container?.querySelectorAll?.(".markdown-preview-view, .markdown-preview-sizer") || []) {
          candidates.push(node);
        }
      } catch (_) {}
      for (const candidate of candidates) {
        const found = resolve(candidate);
        if (!found) continue;
        let el = found.el;
        try { el = found.el.closest?.(".markdown-preview-view") || found.el; } catch (_) {}
        return { leaf, el, root: found.root };
      }
    }
  } catch (_) {}
  return null;
}

function propertyCardHostPreviewHasCard(container) {
  try {
    if (!container) return false;
    if (container.querySelector?.(".bob-property-card")) return true;
    const walk = (node) => {
      try {
        if (node?.classList?.contains?.("bob-property-card")) return true;
        if (node?.getAttribute?.("data-card-kind")) return true;
      } catch (_) {}
      return (node?.children || []).some(walk);
    };
    return walk(container);
  } catch (_) {
    return false;
  }
}

function propertyCardHostWidgetIsLive(widget, readingRootFn) {
  try {
    if (!widget?.surface || propertyCardHostElDetached(widget.el)) return false;
    if (propertyCardHostElDetached(widget.surface)) return false;
    if (typeof readingRootFn === "function") return Boolean(readingRootFn(widget.el));
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardHostHasCardedPath(plugin, path, exceptHost) {
  try {
    for (const leaf of propertyCardHostPreviewLeaves(plugin, path)) {
      if (propertyCardHostPreviewHasCard(leaf?.view?.previewMode?.containerEl)) return true;
    }
  } catch (_) {}
  try {
    const hosts = propertyCardHostsOf(plugin);
    if (!hosts) return false;
    for (const host of hosts) {
      if (host === exceptHost) continue;
      try {
        for (const widget of host.reading?.() || []) {
          if (widget.path !== path) continue;
          if (propertyCardHostWidgetIsLive(widget, host.readingRoot)) return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

function propertyCardHostNoteEligible(plugin, path) {
  try {
    if (!plugin || !path) return false;
    const file = plugin.app?.vault?.getAbstractFileByPath?.(path);
    const cache = file ? plugin.app?.metadataCache?.getFileCache?.(file) : null;
    const kind = typeof propertyCardNoteSpecies === "function"
      ? propertyCardNoteSpecies({ path, frontmatter: cache?.frontmatter || {} })
      : null;
    if (!kind) return false;
    if (typeof propertyCardSpecies === "function") return Boolean(propertyCardSpecies(kind));
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardHostCachedSource(plugin, path) {
  const maps = [
    plugin?.homeCardSourceCache,
    plugin?.albumHeaderSourceCache,
    plugin?.recordSheetSourceCache,
    plugin?.notebookCardSourceCache,
    plugin?.proseNoteCardSourceCache,
    plugin?.refNoteCardSourceCache,
    plugin?.bankSetupSourceCache,
  ];
  for (const map of maps) {
    try {
      const text = map?.get?.(path);
      if (typeof text === "string" && text) return text;
    } catch (_) {}
  }
  return "";
}

function propertyCardHostRescanReadingAbsorption(plugin, path, scope) {
  try {
    if (!scope || typeof propertyCardCabinetAbsorbRescanReading !== "function") return [];
    const listed = typeof propertyCardCatalogClaimsForPath === "function"
      ? propertyCardCatalogClaimsForPath(path)
      : [];
    if (!listed.length) return [];
    const text = propertyCardHostCachedSource(plugin, path);
    if (!text || typeof propertyCardCatalogRegionForHide !== "function") return [];
    const claims = [];
    for (const claim of listed) {
      try {
        const plan = propertyCardCatalogRegionForHide(text, claim.kind);
        if (plan && !plan.damage) claims.push({ plan });
      } catch (_) {}
    }
    if (!claims.length) return [];
    const previous = [];
    try { previous.push(...(scope.querySelectorAll?.(".bob-cabinet-absorbed") || [])); } catch (_) {}
    return propertyCardCabinetAbsorbRescanReading(scope, claims, previous);
  } catch (_) {
    return [];
  }
}

function propertyCardReadingRoot(el) {
  try {
    if (!el || el.closest?.(".cm-editor")) return null;
    const attached = el.closest?.(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed, .internal-embed");
    if (!attached) return null;
    const root = typeof notebookHeaderReadingSurface === "function"
      ? notebookHeaderReadingSurface(el)
      : attached;
    if (root.matches?.(".markdown-preview-view")) {
      const sizer = root.querySelector?.(".markdown-preview-sizer");
      if (sizer?.closest?.(".markdown-preview-view") === root
        && sizer.closest?.(".markdown-embed, .internal-embed") === root.closest?.(".markdown-embed, .internal-embed")) {
        return sizer;
      }
    }
    return root;
  } catch (_) {
    return null;
  }
}

function propertyCardReadingScope(root) {
  try {
    const embed = root?.closest?.(".markdown-embed, .internal-embed");
    if (embed) return embed;
    return root?.closest?.(".markdown-preview-view") || root;
  } catch (_) {
    return root;
  }
}

function propertyCardNodeBelongs(node, root) {
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

function propertyCardHostEnsure(plugin, name, create, type) {
  const current = plugin[name];
  if (!(current instanceof type)) plugin[name] = create();
  return plugin[name];
}

function createPropertyCardHost(options) {
  const plugin = options.plugin;
  const fields = options.fields || {};
  const kind = options.kind || "property-card";
  const allowEmbedDisplay = options.allowEmbedDisplay === true;
  const titleOwnership = options.titleOwnership === true;
  let registered = false;
  let extrasLive = false;
  let refreshEffect = null;
  const rerenderedPaths = new Set();

  function isActive() {
    return plugin[fields.active] === true;
  }

  function setActive(value) {
    plugin[fields.active] = value === true;
  }

  function reading() {
    return propertyCardHostEnsure(plugin, fields.reading, () => new Set(), Set);
  }

  function pending() {
    return propertyCardHostEnsure(plugin, fields.readingPending, () => new Map(), Map);
  }

  function timers() {
    return propertyCardHostEnsure(plugin, fields.readingTimers, () => new Map(), Map);
  }

  function editors() {
    return propertyCardHostEnsure(plugin, fields.editors, () => new Set(), Set);
  }

  function editorScopes() {
    return propertyCardHostEnsure(plugin, fields.editorScopes, () => new Map(), Map);
  }

  function keySlots() {
    if (!fields.keySlots) return null;
    return propertyCardHostEnsure(plugin, fields.keySlots, () => new Map(), Map);
  }

  function schedule(fn, ms) {
    const run = options.setTimeout
      || ((callback, delay) => (plugin.albumSetTimeout
        ? plugin.albumSetTimeout(callback, delay)
        : setTimeout(callback, delay)));
    return run(fn, ms);
  }

  function unschedule(id) {
    if (id == null) return;
    const clear = options.clearTimeout
      || ((timer) => plugin.albumClearTimeout?.(timer));
    try { clear(id); } catch (_) {}
  }

  // Obsidian can invoke a Markdown postprocessor before its preview surface
  // has been attached. Keep the widget and retry a few times so that a late
  // attachment still receives its card without polling indefinitely. When
  // the postprocessed el is detached, or those retries are exhausted, resolve
  // the live markdown preview leaf for the same path instead of giving up.
  function clearReadingSurfaceRetry(widget) {
    if (!widget) return;
    unschedule(widget.surfaceRetryTimer);
    widget.surfaceRetryTimer = null;
  }

  function dropStaleDetachedWidgets(path, keep) {
    const items = reading();
    for (const widget of Array.from(items)) {
      if (widget === keep || widget.path !== path) continue;
      if (!propertyCardHostElDetached(widget.el)) continue;
      clearReadingSurfaceRetry(widget);
      widget.binding = {};
      items.delete(widget);
      try { options.onUnbind?.(widget); } catch (_) {}
    }
  }

  function rebindWidgetToLive(widget, live) {
    if (!widget || !live) return;
    widget.binding = {};
    widget.el = live.el;
    widget.surface = live.root;
    widget.scope = readingScope(live.root);
    widget.surfaceRetryCount = 0;
    widget.rerenderRequested = false;
    clearReadingSurfaceRetry(widget);
    try { rerenderedPaths.delete(widget.path); } catch (_) {}
    dropStaleDetachedWidgets(widget.path, widget);
  }

  function resolveReadingSurface(widget) {
    if (!widget) return null;
    const ownRoot = readingRoot(widget.el);
    const ownDead = propertyCardHostElDetached(widget.el)
      || (ownRoot ? propertyCardHostElDetached(ownRoot) : true);
    const live = propertyCardHostLiveReadingSurface(plugin, widget.path, readingRoot);
    if (live) {
      const liveDifferent = !ownRoot || live.root !== ownRoot;
      if (!ownRoot || (ownDead && liveDifferent)) {
        rebindWidgetToLive(widget, live);
        return live.root;
      }
    }
    // Keep a parented preview ancestor even when FakeNode `isConnected`
    // walks to `.root` and reports false. Rebind already took over when a
    // different live workspace leaf exists. A connected pane that now
    // shows another path is not ours.
    if (ownRoot && !propertyCardHostPaneMovedOn(plugin, widget)) return ownRoot;
    return null;
  }

  function requestTargetedRerender(widget) {
    if (!widget || !isActive()) return false;
    const path = widget.path;
    if (!path || widget.rerenderRequested || rerenderedPaths.has(path)) return false;
    if (propertyCardHostHasCardedPath(plugin, path, controller)) return false;
    if (!propertyCardHostNoteEligible(plugin, path)) return false;
    const leaves = propertyCardHostPreviewLeaves(plugin, path);
    if (!leaves.length) return false;
    widget.rerenderRequested = true;
    rerenderedPaths.add(path);
    for (const leaf of leaves) {
      try {
        const preview = leaf.view?.previewMode;
        if (preview && typeof preview.rerender === "function") preview.rerender(true);
      } catch (_) {}
    }
    schedule(() => {
      if (!isActive()) return;
      for (const leaf of leaves) {
        try {
          const scope = leaf.view?.previewMode?.containerEl;
          propertyCardHostRescanReadingAbsorption(plugin, path, scope);
        } catch (_) {}
      }
      controller.refreshReading();
    }, 0);
    return true;
  }

  function scheduleReadingSurfaceRetry(widget) {
    if (!widget || widget.surfaceRetryTimer != null || !isActive()) return;
    const attempt = Number(widget.surfaceRetryCount || 0) + 1;
    if (attempt > PROPERTY_CARD_HOST_SURFACE_RETRY_LIMIT) {
      const root = resolveReadingSurface(widget);
      if (root) {
        widget.surfaceRetryCount = 0;
        widget.surface = root;
        widget.scope = readingScope(root);
        controller.refreshReading();
        return;
      }
      const rerendered = requestTargetedRerender(widget);
      if (rerendered || attempt > PROPERTY_CARD_HOST_SURFACE_RETRY_LIMIT + 16) return;
      widget.surfaceRetryCount = attempt;
      widget.surfaceRetryTimer = schedule(() => {
        widget.surfaceRetryTimer = null;
        if (!isActive() || !reading().has(widget)) return;
        scheduleReadingSurfaceRetry(widget);
      }, 320);
      return;
    }
    widget.surfaceRetryTimer = schedule(() => {
      widget.surfaceRetryTimer = null;
      if (!isActive() || !reading().has(widget)) return;
      const root = resolveReadingSurface(widget);
      if (!root) {
        widget.surfaceRetryCount = attempt;
        scheduleReadingSurfaceRetry(widget);
        return;
      }
      widget.surfaceRetryCount = 0;
      widget.surface = root;
      widget.scope = readingScope(root);
      controller.refreshReading();
    }, Math.min(40 * attempt, 320));
  }

  function pathOf(value) {
    try {
      if (typeof options.pathOf === "function") return options.pathOf(value);
    } catch (_) {}
    return typeof value === "string" ? value : "";
  }

  function readingRoot(el) {
    try {
      if (typeof options.readingRoot === "function") return options.readingRoot(el);
    } catch (_) {}
    return propertyCardReadingRoot(el);
  }

  function readingScope(root) {
    try {
      if (typeof options.readingScope === "function") return options.readingScope(root);
    } catch (_) {}
    return propertyCardReadingScope(root);
  }

  function acceptReading(el, ctx) {
    try {
      if (typeof options.acceptReading === "function") return options.acceptReading(el, ctx) === true;
    } catch (_) {
      return false;
    }
    return Boolean(el && ctx?.sourcePath);
  }

  const controller = {
    kind,

    isActive,
    reading,
    editors,
    editorScopes,
    keySlots,

    setup() {
      setActive(true);
      try { propertyCardHostsOf(plugin)?.add(controller); } catch (_) {}
      reading();
      pending();
      timers();
      editors();
      editorScopes();
      keySlots();
      try { propertyCardSettledCacheBind?.(plugin); } catch (_) {}
      if (!registered) {
        try {
          plugin.registerMarkdownPostProcessor?.(
            (el, ctx) => controller.renderInReading(el, ctx),
            options.readingPriority,
          );
        } catch (_) {}
        try {
          const extension = controller.createExtension();
          if (extension) plugin.registerEditorExtension?.(extension);
        } catch (_) {}
        if (titleOwnership && typeof propertyCardHostRegisterTitleOwnership === "function") {
          try { propertyCardHostRegisterTitleOwnership(plugin); } catch (_) {}
        }
        const events = Array.isArray(options.workspaceEvents) ? options.workspaceEvents : [];
        try {
          const workspace = plugin.app?.workspace;
          if (events.length && workspace && typeof workspace.on === "function"
            && typeof plugin.registerEvent === "function") {
            for (const name of events) {
              plugin.registerEvent(workspace.on(name, () => {
                if (!isActive()) return;
                // An adapter handler replaces the default refresh. Record only
                // schedules its Reading-view fallback here, as before the host;
                // a full refresh on every file-open broke the bank walk e2e
                // (walk-real-key-swallowed: the category card never opened).
                if (typeof options.onWorkspaceEvent === "function") {
                  try { options.onWorkspaceEvent(name, controller); } catch (_) {}
                  return;
                }
                controller.scheduleRefresh();
              }));
            }
          }
        } catch (_) {}
        registered = true;
      }
      if (!extrasLive) {
        try { options.onSetup?.(); } catch (_) {}
        extrasLive = true;
      }
      return controller;
    },

    dispose() {
      setActive(false);
      try { propertyCardHostsOf(plugin)?.delete(controller); } catch (_) {}
      rerenderedPaths.clear();
      try { options.onDisposeStart?.(); } catch (_) {}
      unschedule(plugin[fields.refreshTimer]);
      plugin[fields.refreshTimer] = null;
      for (const timer of timers().values()) unschedule(timer);
      timers().clear();
      pending().clear();
      for (const widget of Array.from(reading())) {
        clearReadingSurfaceRetry(widget);
        try { options.removeReading?.(widget.surface, widget.scope, widget.path); } catch (_) {}
      }
      for (const view of Array.from(editors())) {
        try {
          if (typeof options.cleanEditor === "function") options.cleanEditor(view);
          else controller.cleanEditor(view);
        } catch (_) {}
      }
      const slots = keySlots();
      if (slots) {
        try { propertyCardSlotReleaseAll(slots); } catch (_) {}
      }
      if (titleOwnership && typeof propertyCardTitleReleaseAll === "function") {
        try { propertyCardTitleReleaseAll(); } catch (_) {}
      }
      reading().clear();
      editors().clear();
      editorScopes().clear();
      extrasLive = false;
      try { propertyCardSettledCacheReset?.(); } catch (_) {}
      try { options.onDisposeEnd?.(); } catch (_) {}
      return controller;
    },

    renderInReading(el, ctx) {
      if (!isActive() || !acceptReading(el, ctx)) return;
      if (el.closest?.(".cm-editor")) return;
      const path = ctx.sourcePath;
      const batch = pending().get(path) || [];
      batch.push({ el, ctx });
      pending().set(path, batch);
      unschedule(timers().get(path));
      timers().set(path, schedule(() => {
        timers().delete(path);
        const queued = pending().get(path) || [];
        pending().delete(path);
        if (!isActive()) return;
        const surfaces = new Set();
        for (const item of queued) {
          const root = readingRoot(item.el);
          const key = root || item.el;
          if (surfaces.has(key)) continue;
          surfaces.add(key);
          controller.bindReading(item.el, item.ctx, root);
        }
        controller.refreshReading();
      }, 0));
    },

    bindReading(el, ctx, root) {
      const items = reading();
      let widget = Array.from(items).find((item) =>
        item.el === el || (root && item.surface === root));
      if (!widget) {
        widget = { el, path: ctx.sourcePath, surface: root, scope: readingScope(root), surfaceRetryCount: 0 };
        items.add(widget);
      } else if (widget.path !== ctx.sourcePath) {
        clearReadingSurfaceRetry(widget);
        try { options.removeReading?.(widget.surface, widget.scope, widget.path); } catch (_) {}
      }
      widget.el = el;
      widget.path = ctx.sourcePath;
      widget.surface = root;
      widget.scope = readingScope(root);
      if (root) {
        clearReadingSurfaceRetry(widget);
        widget.surfaceRetryCount = 0;
      } else {
        scheduleReadingSurfaceRetry(widget);
      }
      const binding = {};
      widget.binding = binding;
      try { options.onBind?.(widget, el, ctx, root); } catch (_) {}
      const child = typeof MarkdownRenderChild === "function" ? new MarkdownRenderChild(el) : {};
      child.onunload = () => {
        if (!isActive()) return;
        if (widget.binding !== binding) return;
        clearReadingSurfaceRetry(widget);
        items.delete(widget);
        const anotherOwner = Array.from(items).some((item) =>
          item.surface === widget.surface && item.path === widget.path);
        if (!anotherOwner) {
          try { options.removeReading?.(widget.surface, widget.scope, widget.path); } catch (_) {}
        }
        try { options.onUnbind?.(widget); } catch (_) {}
      };
      try { ctx.addChild?.(child); } catch (_) {}
      return widget;
    },

    refreshReading() {
      if (!isActive()) return;
      const items = reading();
      for (const widget of Array.from(items)) {
        try {
          const root = resolveReadingSurface(widget);
          if (widget.surface && widget.surface !== root) {
            options.removeReading?.(widget.surface, widget.scope, widget.path);
          }
          if (!root) {
            widget.surface = null;
            widget.scope = null;
            if (propertyCardHostPaneMovedOn(plugin, widget)) {
              clearReadingSurfaceRetry(widget);
              widget.binding = {};
              items.delete(widget);
              try { options.onUnbind?.(widget); } catch (_) {}
              continue;
            }
            scheduleReadingSurfaceRetry(widget);
            continue;
          }
          clearReadingSurfaceRetry(widget);
          widget.surfaceRetryCount = 0;
          widget.surface = root;
          widget.scope = readingScope(root);
          try { options.onResolveSurface?.(widget, root); } catch (_) {}
        } catch (_) {}
      }
      const painted = new Set();
      for (const widget of items) {
        if (!widget.surface || painted.has(widget.surface)) continue;
        if (!allowEmbedDisplay && propertyCardScopeIsEmbed(widget.scope || widget.surface)) continue;
        painted.add(widget.surface);
        try {
          options.paintReading?.(widget.el, widget.path);
        } catch (_) {
          // Failed repaint: remove this mount's DOM and release only its
          // generation/path-bound ownership. The adapter hook already owns
          // the path check, so a stale callback cannot clear a newer mount
          // in the same scope. Keep the widget tracked for recovery.
          try { options.removeReading?.(widget.surface, widget.scope, widget.path); } catch (_) {}
          try { controller.releaseKeys?.(widget.scope, widget.path); } catch (_) {}
        }
      }
      for (const widget of Array.from(items)) {
        if (widget.surface) continue;
        const detached = propertyCardHostElDetached(widget.el);
        const exhausted = Number(widget.surfaceRetryCount || 0) >= PROPERTY_CARD_HOST_SURFACE_RETRY_LIMIT;
        if (detached || exhausted) requestTargetedRerender(widget);
      }
      try { options.afterRefreshReading?.(); } catch (_) {}
    },

    scheduleRefresh() {
      if (!isActive() || plugin[fields.refreshTimer] != null) return;
      plugin[fields.refreshTimer] = schedule(() => {
        plugin[fields.refreshTimer] = null;
        if (!isActive()) return;
        controller.refresh();
      }, PROPERTY_CARD_HOST_REFRESH_MS);
    },

    refresh() {
      if (!isActive()) return;
      controller.refreshReading();
      controller.refreshEditors();
      try { options.onRefresh?.(); } catch (_) {}
    },

    ownKeys(scope, path) {
      try { return options.ownKeys?.(scope, path); } catch (_) { return null; }
    },

    releaseKeys(scope, path) {
      try { return options.releaseKeys?.(scope, path); } catch (_) { return false; }
    },

    commitMount(scope, path, mounted) {
      if (mounted) controller.ownKeys(scope, path);
      else controller.releaseKeys(scope, path);
      return Boolean(mounted);
    },

    pathOf,
    readingRoot,
    readingScope,
    allowEmbedDisplay,
    titleOwnership,
    ensureRefreshEffect() {
      if (!refreshEffect && StateEffect?.define) {
        try { refreshEffect = StateEffect.define(); } catch (_) { refreshEffect = null; }
      }
      return refreshEffect;
    },
  };

  controller.createExtension = function createExtension() {
    return propertyCardHostCreateExtension(controller, options, editors);
  };
  controller.refreshEditors = function refreshEditors() {
    return propertyCardHostRefreshEditors(controller, plugin, options, editors);
  };
  controller.setEditorScope = function setEditorScope(view, enabled, extras) {
    return propertyCardHostSetEditorScope(controller, options, editors, editorScopes, view, enabled, extras);
  };
  controller.cleanEditor = function cleanEditor(view, extras) {
    return propertyCardHostCleanEditor(controller, options, editors, editorScopes, view, extras);
  };
  controller.editorAttributes = function editorAttributes(view) {
    try { return options.editorAttributes?.(view) || {}; } catch (_) { return {}; }
  };
  controller.viewPath = function viewPath(view) {
    try {
      if (typeof options.viewPath === "function") return options.viewPath(view);
    } catch (_) {}
    try {
      return options.livePath?.(view) || options.sourcePath?.(view) || null;
    } catch (_) {
      return null;
    }
  };

  return controller;
}
