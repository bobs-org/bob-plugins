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
  // attachment still receives its card without polling indefinitely.
  function clearReadingSurfaceRetry(widget) {
    if (!widget) return;
    unschedule(widget.surfaceRetryTimer);
    widget.surfaceRetryTimer = null;
  }

  function scheduleReadingSurfaceRetry(widget) {
    if (!widget || widget.surfaceRetryTimer != null || !isActive()) return;
    const attempt = Number(widget.surfaceRetryCount || 0) + 1;
    if (attempt > 8) return;
    widget.surfaceRetryTimer = schedule(() => {
      widget.surfaceRetryTimer = null;
      if (!isActive() || !reading().has(widget)) return;
      const root = readingRoot(widget.el);
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
      for (const widget of items) {
        try {
          const root = readingRoot(widget.el);
          if (widget.surface && widget.surface !== root) {
            options.removeReading?.(widget.surface, widget.scope, widget.path);
          }
          if (!root) {
            widget.surface = null;
            widget.scope = null;
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
