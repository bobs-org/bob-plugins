// Editor-extension half of createPropertyCardHost: Prec.highest ViewPlugin,
// refresh-effect dispatch, editorAttributes restoration, and editor-scope
// class tracking. Split from 240c so each host fragment stays small.

function propertyCardHostCleanupEditorView(controller, options, view, path) {
  try {
    if (typeof options.cleanEditor === "function") options.cleanEditor(view);
    else controller.cleanEditor(view);
  } catch (_) {}
  try { controller.releaseKeys?.(view?.dom, path); } catch (_) {}
}

function propertyCardHostFallbackDecorations() {
  try {
    if (typeof Decoration !== "undefined" && Decoration?.none !== undefined) return Decoration.none;
  } catch (_) {}
  return null;
}

function propertyCardHostCreateExtension(controller, options, editors) {
  try {
    if (!ViewPlugin?.fromClass || !Decoration || !WidgetType || !RangeSetBuilder) return null;
    if (!editorInfoField || !editorLivePreviewField) return null;
    const PluginClass = class {
      constructor(view) {
        this.view = view;
        let path = null;
        try { path = controller.viewPath(view); } catch (_) { path = null; }
        this.path = path;
        let decorations = null;
        let failed = false;
        try {
          decorations = options.buildDecorations?.(view);
        } catch (_) {
          failed = true;
          decorations = null;
        }
        if (failed || decorations == null) {
          propertyCardHostCleanupEditorView(controller, options, view, path);
          if (decorations == null) decorations = propertyCardHostFallbackDecorations();
        }
        this.decorations = decorations;
        try { editors().add(view); } catch (_) {}
      }
      update(update) {
        const path = controller.viewPath(update.view);
        const effect = controller.ensureRefreshEffect();
        const notified = (update.transactions || []).some((tx) =>
          (tx.effects || []).some((item) => item.is?.(effect)));
        let extra = false;
        try { extra = options.shouldRebuild?.(update, this.path, path) === true; } catch (_) {}
        const rebuild = path !== this.path || notified || extra
          || update.docChanged || update.viewportChanged;
        this.path = path;
        if (rebuild) {
          let next = null;
          try {
            next = options.buildDecorations?.(update.view, update);
          } catch (error) {
            propertyCardHostCleanupEditorView(controller, options, update.view, path);
            this.decorations = propertyCardHostFallbackDecorations();
            throw error;
          }
          if (next == null) {
            propertyCardHostCleanupEditorView(controller, options, update.view, path);
            next = propertyCardHostFallbackDecorations();
          }
          this.decorations = next;
        }
      }
      destroy() {
        try {
          if (typeof options.cleanEditor === "function") options.cleanEditor(this.view);
          else controller.cleanEditor(this.view);
        } catch (_) {}
      }
    };
    const spec = { decorations: (value) => value.decorations };
    // Only adapters that pass editorAttributes (record) install this facet.
    // Album and bank never provided one, so they keep omitting it rather
    // than adding a Prec.highest provider to every markdown editor.
    if (typeof options.editorAttributes === "function"
        && EditorView?.editorAttributes && typeof EditorView.editorAttributes.of === "function") {
      spec.provide = () => EditorView.editorAttributes.of((view) => {
        try { return options.editorAttributes(view) || {}; } catch (_) { return {}; }
      });
    }
    const extension = ViewPlugin.fromClass(PluginClass, spec);
    return Prec?.highest ? Prec.highest(extension) : extension;
  } catch (_) {
    return null;
  }
}

function propertyCardHostRefreshEditors(controller, plugin, options, editors) {
  try {
    const effect = controller.ensureRefreshEffect();
    const views = new Set(editors() || []);
    for (const leaf of plugin.app?.workspace?.getLeavesOfType?.("markdown") || []) {
      const view = leaf?.view?.editor?.cm || null;
      if (view) views.add(view);
    }
    for (const view of views) {
      if (effect && view.dispatch) view.dispatch({ effects: effect.of(null) });
      else options.buildDecorations?.(view);
    }
  } catch (_) {}
}

function propertyCardHostSetEditorScope(controller, options, editors, editorScopes, view, enabled, extras) {
  const root = view?.dom;
  if (!root) return null;
  const scopes = editorScopes();
  let scope = root;
  try {
    const resolve = extras?.scopeOf || options.editorScopeOf;
    if (typeof resolve === "function") scope = resolve(root, view) || root;
  } catch (_) {
    scope = root;
  }
  const previous = scopes.get(view);
  const mark = extras?.mark || ((node, current, on) => {
    try { options.markEditorScope?.(node, current, on); } catch (_) {}
  });
  const unmark = extras?.unmark || ((node, current) => {
    try { options.markEditorScope?.(node, current, false); } catch (_) {}
  });
  if (previous && previous !== scope) {
    try { unmark(previous, view); } catch (_) {}
  }
  try {
    if (enabled) mark(scope, view, true);
    else unmark(scope, view);
  } catch (_) {}
  if (enabled) {
    scopes.set(view, scope);
    editors().add(view);
  } else {
    scopes.delete(view);
    editors().delete(view);
  }
  return scope;
}

function propertyCardHostCleanEditor(controller, options, editors, editorScopes, view, extras) {
  try {
    const scope = editorScopes().get(view) || view?.dom;
    try { extras?.unmark?.(scope, view); } catch (_) {}
    try { options.markEditorScope?.(scope, view, false); } catch (_) {}
    try { options.releaseKeys?.(view?.dom, extras?.path); } catch (_) {}
    editorScopes().delete(view);
  } catch (_) {}
  editors().delete(view);
}
