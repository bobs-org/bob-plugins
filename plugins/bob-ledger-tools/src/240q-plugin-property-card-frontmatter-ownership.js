// Property-card kit: whole-container frontmatter ownership (unwired).
// propertyCardOwnFrontmatter(scope, { path, view }) adds
// bob-property-card-owns-frontmatter to the view scope. Kit CSS sets
// Obsidian's --metadata-display-editing / --metadata-display-reading to
// none and hides the exact native paths propertyCardNativeContainer uses.
// The node stays in the DOM (it is the title-slot anchor) with inert plus
// aria-hidden, and a focusin guard returns focus to the editor. Live
// Preview uses a lazy StateField plus editorAttributes (modeled on 240i);
// Reading uses a generation-bound class. Ownership drops on release, a
// newer owner, Source mode, a file change, plugin disable, or unload.
// Never throws. Adapters must not call this yet (takeover wires it).
const PROPERTY_CARD_OWNS_FRONTMATTER_CLASS = "bob-property-card-owns-frontmatter";
const PROPERTY_CARD_FRONTMATTER_REGISTERED_FLAG = "_propertyCardFrontmatterOwnershipRegistered";
const PROPERTY_CARD_FRONTMATTER_OWNS_ATTRS = Object.freeze({ class: PROPERTY_CARD_OWNS_FRONTMATTER_CLASS });
const PROPERTY_CARD_FRONTMATTER_NO_ATTRS = Object.freeze({});

let propertyCardFrontmatterEffectType = null;
let propertyCardFrontmatterFieldType = null;
let propertyCardFrontmatterGeneration = 0;
const propertyCardFrontmatterEditorOwners = new WeakMap();
const propertyCardFrontmatterOwnedViews = new Set();
const propertyCardFrontmatterReadingOwners = new WeakMap();
const propertyCardFrontmatterReadingScopes = new Set();
const propertyCardFrontmatterPainted = new WeakMap();

function propertyCardFrontmatterScopeDenied(scope) {
  if (propertyCardDeniedScope(scope)) return true;
  try {
    return Boolean(scope.closest(".canvas-node, .canvas-node-content, .print"));
  } catch (_) {
    return true;
  }
}

function propertyCardFrontmatterEnsureEffect() {
  if (!propertyCardFrontmatterEffectType) {
    try {
      if (StateEffect && typeof StateEffect.define === "function") propertyCardFrontmatterEffectType = StateEffect.define();
    } catch (_) {
      propertyCardFrontmatterEffectType = null;
    }
  }
  return propertyCardFrontmatterEffectType;
}

function propertyCardFrontmatterFieldCreate() {
  return { owner: null };
}

function propertyCardFrontmatterStateField(state, field) {
  if (!field || !state || typeof state.field !== "function") return undefined;
  try { return state.field(field, false); } catch (_) { return undefined; }
}

// Pure reducer behind the StateField. tr needs effects, state
// ({ field }), and startState. deps may inject { effect, livePreviewField,
// infoField } for tests. Drops the owner in the same transaction as a
// Source toggle or a file change.
function propertyCardFrontmatterFieldReduce(value, tr, deps = {}) {
  const current = value && typeof value === "object" ? value : propertyCardFrontmatterFieldCreate();
  try {
    const effectType = deps.effect || propertyCardFrontmatterEffectType;
    const liveField = Object.prototype.hasOwnProperty.call(deps, "livePreviewField") ? deps.livePreviewField : editorLivePreviewField;
    const infoField = Object.prototype.hasOwnProperty.call(deps, "infoField") ? deps.infoField : editorInfoField;
    let owner = current.owner;
    for (const effect of tr?.effects || []) {
      if (!effectType || typeof effect?.is !== "function" || !effect.is(effectType)) continue;
      const payload = effect.value || {};
      if (payload.own && typeof payload.own.path === "string") {
        owner = { path: payload.own.path, generation: payload.own.generation };
      } else if (payload.release !== undefined && owner && owner.generation === payload.release) {
        owner = null;
      }
    }
    const state = tr?.state;
    if (owner) {
      if (propertyCardFrontmatterStateField(state, liveField) === false) owner = null;
    }
    if (owner) {
      const info = propertyCardFrontmatterStateField(state, infoField);
      if (info && (info.file?.path ?? null) !== owner.path) owner = null;
    }
    if (owner === current.owner) return current;
    return { owner };
  } catch (_) {
    return propertyCardFrontmatterFieldCreate();
  }
}

function propertyCardFrontmatterFieldAttributes(value) {
  return value?.owner ? PROPERTY_CARD_FRONTMATTER_OWNS_ATTRS : null;
}

function propertyCardFrontmatterClearContainer(container) {
  if (!container) return;
  try { container.inert = false; } catch (_) {}
  try { container.removeAttribute?.("inert"); } catch (_) {}
  try { container.removeAttribute?.("aria-hidden"); } catch (_) {}
}

function propertyCardFrontmatterGuardFocus(event, scope, entry) {
  try {
    const painted = propertyCardFrontmatterPainted.get(scope);
    const container = propertyCardNativeContainer(scope) || painted?.container;
    const target = event?.target;
    if (!container || !target) return;
    const inside = target === container
      || (typeof container.contains === "function" && container.contains(target));
    if (!inside) return;
    try { event.preventDefault?.(); } catch (_) {}
    try { event.stopPropagation?.(); } catch (_) {}
    const view = entry?.view;
    if (view && typeof view.focus === "function") {
      view.focus();
      return;
    }
    const content = view?.contentDOM || scope.querySelector?.(".cm-content");
    if (content && typeof content.focus === "function") {
      try { content.focus({ preventScroll: true }); } catch (_) { content.focus(); }
      return;
    }
    if (typeof scope.focus === "function") {
      try { scope.focus({ preventScroll: true }); } catch (_) { scope.focus(); }
    }
  } catch (_) {}
}

function propertyCardFrontmatterUnpaintScope(scope) {
  const prev = propertyCardFrontmatterPainted.get(scope);
  if (!prev) return;
  try { scope.removeEventListener?.("focusin", prev.onFocusIn, true); } catch (_) {}
  propertyCardFrontmatterClearContainer(prev.container);
  propertyCardFrontmatterPainted.delete(scope);
}

function propertyCardFrontmatterPaintScope(scope, entry) {
  if (!scope || !entry) return;
  const container = propertyCardNativeContainer(scope);
  const prev = propertyCardFrontmatterPainted.get(scope);
  if (prev && prev.container && prev.container !== container) {
    propertyCardFrontmatterClearContainer(prev.container);
  }
  if (container) {
    try { container.inert = true; } catch (_) {}
    try { container.setAttribute?.("inert", ""); } catch (_) {}
    try { container.setAttribute?.("aria-hidden", "true"); } catch (_) {}
  }
  if (prev && prev.entry === entry && prev.onFocusIn) {
    propertyCardFrontmatterPainted.set(scope, { container, onFocusIn: prev.onFocusIn, entry });
    return;
  }
  if (prev?.onFocusIn) {
    try { scope.removeEventListener?.("focusin", prev.onFocusIn, true); } catch (_) {}
  }
  const onFocusIn = (event) => propertyCardFrontmatterGuardFocus(event, scope, entry);
  try { scope.addEventListener?.("focusin", onFocusIn, true); } catch (_) {}
  propertyCardFrontmatterPainted.set(scope, { container, onFocusIn, entry });
}

function propertyCardFrontmatterSyncEditor(view) {
  try {
    if (!view?.dom) return;
    const value = propertyCardFrontmatterStateField(view.state, propertyCardFrontmatterFieldType);
    const entry = propertyCardFrontmatterEditorOwners.get(view);
    if (value?.owner && entry && !entry.released && value.owner.generation === entry.generation) {
      propertyCardFrontmatterPaintScope(view.dom, entry);
    } else if (!value?.owner) {
      propertyCardFrontmatterUnpaintScope(view.dom);
    }
  } catch (_) {}
}

function propertyCardFrontmatterViewPlugin() {
  try {
    if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function") return null;
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        propertyCardFrontmatterSyncEditor(view);
      }
      update() {
        propertyCardFrontmatterSyncEditor(this.view);
      }
      destroy() {
        propertyCardFrontmatterUnpaintScope(this.view?.dom);
      }
    });
  } catch (_) {
    return null;
  }
}

// The StateField that owns frontmatter in every Live Preview editor.
// Returns null (the caller registers nothing) when CodeMirror is missing.
function propertyCardFrontmatterOwnershipExtension() {
  try {
    if (propertyCardFrontmatterFieldType) return propertyCardFrontmatterFieldType;
    if (!StateField || typeof StateField.define !== "function") return null;
    if (typeof EditorView === "undefined" || !EditorView) return null;
    if (typeof EditorView.editorAttributes?.from !== "function") return null;
    if (!propertyCardFrontmatterEnsureEffect()) return null;
    const viewPlugin = propertyCardFrontmatterViewPlugin();
    propertyCardFrontmatterFieldType = StateField.define({
      create: () => propertyCardFrontmatterFieldCreate(),
      update: (value, tr) => propertyCardFrontmatterFieldReduce(value, tr),
      provide: (field) => {
        const extensions = [
          EditorView.editorAttributes.from(field, (value) => propertyCardFrontmatterFieldAttributes(value) || PROPERTY_CARD_FRONTMATTER_NO_ATTRS),
        ];
        if (viewPlugin) extensions.push(viewPlugin);
        return extensions;
      },
    });
    return propertyCardFrontmatterFieldType;
  } catch (_) {
    propertyCardFrontmatterFieldType = null;
    return null;
  }
}

function propertyCardFrontmatterDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

function propertyCardFrontmatterEditorFieldGeneration(view) {
  if (!propertyCardFrontmatterFieldType) return { installed: false, generation: undefined };
  if (typeof view?.state?.field !== "function") return { installed: true, generation: undefined };
  const value = propertyCardFrontmatterStateField(view.state, propertyCardFrontmatterFieldType);
  if (value === undefined) return { installed: false, generation: undefined };
  return { installed: true, generation: value?.owner?.generation };
}

function propertyCardFrontmatterEditorDispatch(entry, payload) {
  const effect = propertyCardFrontmatterEnsureEffect();
  if (!effect) return;
  try { entry.view.dispatch({ effects: effect.of(payload) }); } catch (_) {}
  try { propertyCardFrontmatterSyncEditor(entry.view); } catch (_) {}
}

function propertyCardFrontmatterEditorScheduleOwn(entry) {
  entry.pending = true;
  entry.defer(() => {
    entry.pending = false;
    if (entry.released || propertyCardFrontmatterEditorOwners.get(entry.view) !== entry) return;
    propertyCardFrontmatterEditorDispatch(entry, {
      own: { path: entry.path, generation: entry.generation },
    });
  });
}

function propertyCardFrontmatterEditorRelease(entry) {
  if (!entry || entry.released) return;
  entry.released = true;
  if (propertyCardFrontmatterEditorOwners.get(entry.view) !== entry) return;
  propertyCardFrontmatterEditorOwners.delete(entry.view);
  propertyCardFrontmatterOwnedViews.delete(entry.view);
  propertyCardFrontmatterUnpaintScope(entry.view?.dom);
  entry.defer(() => propertyCardFrontmatterEditorDispatch(entry, { release: entry.generation }));
}

function propertyCardFrontmatterReadingDrop(scope, entry) {
  if (!entry) return;
  try { entry.observer?.disconnect(); } catch (_) {}
  entry.observer = null;
  propertyCardFrontmatterUnpaintScope(scope);
  try { scope.classList?.remove(PROPERTY_CARD_OWNS_FRONTMATTER_CLASS); } catch (_) {}
  if (propertyCardFrontmatterReadingOwners.get(scope) === entry) {
    propertyCardFrontmatterReadingOwners.delete(scope);
    propertyCardFrontmatterReadingScopes.delete(scope);
  }
}

// Own the native Properties container in one Live Preview editor. Returns
// an idempotent, generation-bound release function (with .generation), or
// null when the scope is denied, the view is in Source mode, or the field
// is missing. Re-owning the same path returns the existing handle.
function propertyCardOwnFrontmatterInEditor(view, options = {}) {
  try {
    if (!view || typeof view.dispatch !== "function") return null;
    if (propertyCardFrontmatterScopeDenied(view.dom)) return null;
    const path = String(options?.path || "");
    if (!path) return null;
    if (!propertyCardFrontmatterEnsureEffect()) return null;
    if (propertyCardFrontmatterStateField(view.state, editorLivePreviewField) === false) return null;
    const field = propertyCardFrontmatterEditorFieldGeneration(view);
    if (!field.installed) return null;
    const defer = typeof options.defer === "function" ? options.defer : propertyCardFrontmatterDefer;
    const current = propertyCardFrontmatterEditorOwners.get(view);
    if (current && !current.released && current.path === path) {
      propertyCardFrontmatterPaintScope(view.dom, current);
      if (field.generation === current.generation) {
        current.rearmed = false;
        return current.handle;
      }
      if (current.pending) return current.handle;
      if (current.rearmed) return current.handle;
      current.rearmed = true;
      current.defer = defer;
      propertyCardFrontmatterEditorScheduleOwn(current);
      return current.handle;
    }
    propertyCardFrontmatterGeneration += 1;
    const entry = {
      view, path, defer,
      generation: propertyCardFrontmatterGeneration, pending: false, released: false, handle: null,
      rearmed: false,
    };
    if (current && !current.released) {
      current.released = true;
      propertyCardFrontmatterUnpaintScope(current.view?.dom);
      current.defer(() => propertyCardFrontmatterEditorDispatch(current, { release: current.generation }));
    }
    const handle = () => propertyCardFrontmatterEditorRelease(entry);
    handle.generation = entry.generation;
    entry.handle = handle;
    propertyCardFrontmatterEditorOwners.set(view, entry);
    propertyCardFrontmatterOwnedViews.add(view);
    propertyCardFrontmatterPaintScope(view.dom, entry);
    propertyCardFrontmatterEditorScheduleOwn(entry);
    return handle;
  } catch (_) {
    try { propertyCardFrontmatterUnpaintScope(view?.dom); } catch (__) {}
    return null;
  }
}

// Own the native Properties container in one Reading view scope. Every
// call is a new generation: a newer owner replaces the old tags, and an
// old handle can never clear it. A MutationObserver re-applies inert when
// Obsidian re-renders the header. Returns a release function or null.
function propertyCardOwnFrontmatterInReading(scope, options = {}) {
  try {
    if (propertyCardFrontmatterScopeDenied(scope)) return null;
    if (!scope.classList?.contains("markdown-preview-view")) return null;
    const path = String(options?.path || "");
    if (!path) return null;
    const previous = propertyCardFrontmatterReadingOwners.get(scope);
    if (previous) propertyCardFrontmatterReadingDrop(scope, previous);
    propertyCardFrontmatterGeneration += 1;
    const entry = {
      generation: propertyCardFrontmatterGeneration, path, view: null, observer: null,
    };
    propertyCardFrontmatterReadingOwners.set(scope, entry);
    propertyCardFrontmatterReadingScopes.add(scope);
    scope.classList.add(PROPERTY_CARD_OWNS_FRONTMATTER_CLASS);
    propertyCardFrontmatterPaintScope(scope, entry);
    try {
      const Observer = scope.ownerDocument?.defaultView?.MutationObserver;
      if (Observer) {
        entry.observer = new Observer(() => {
          if (propertyCardFrontmatterReadingOwners.get(scope) !== entry) return;
          propertyCardFrontmatterPaintScope(scope, entry);
        });
        entry.observer.observe(scope, { childList: true, subtree: true });
      }
    } catch (_) {
      entry.observer = null;
    }
    const handle = () => {
      if (propertyCardFrontmatterReadingOwners.get(scope) !== entry) return;
      propertyCardFrontmatterReadingDrop(scope, entry);
    };
    handle.generation = entry.generation;
    return handle;
  } catch (_) {
    try { propertyCardFrontmatterUnpaintScope(scope); } catch (__) {}
    try { scope?.classList?.remove(PROPERTY_CARD_OWNS_FRONTMATTER_CLASS); } catch (__) {}
    return null;
  }
}

// Unified entry: .cm-editor scopes with a view go through the Live Preview
// field; .markdown-preview-view scopes go through Reading tags.
function propertyCardOwnFrontmatter(scope, options = {}) {
  try {
    if (scope?.classList?.contains("cm-editor") && options?.view) {
      if (options.view.dom && options.view.dom !== scope) return null;
      return propertyCardOwnFrontmatterInEditor(options.view, options);
    }
    if (scope?.classList?.contains("markdown-preview-view")) return propertyCardOwnFrontmatterInReading(scope, options);
  } catch (_) {}
  return null;
}

// The painted owner entry for one scope, or null. The paint map mirrors
// live ownership: own paints synchronously and release unpaints, so the
// entry carries the same path, generation, and editor view the field
// dispatch settled. Callers that only hold a MarkdownView (focus helpers,
// command dispatch) reach the editor entry through the scope.
function propertyCardFrontmatterPaintedOwner(scope) {
  try {
    const painted = propertyCardFrontmatterPainted.get(scope);
    const entry = painted && painted.entry;
    if (!entry || entry.released === true) return null;
    return entry;
  } catch (_) {
    return null;
  }
}

// Read-only actual-ownership query for capability routing and native
// entry points (bob-cli-pf.6.1.2). Observes the live owner entry, not card
// eligibility, a global Boolean, or a stale class: the Live Preview entry
// must match the field's current owner generation, and the Reading entry
// must still hold the scope tag. Denied scopes never read as owned.
function propertyCardFrontmatterActualOwnership(scope, options = {}) {
  const none = { owned: false };
  try {
    if (!scope || typeof scope.classList?.contains !== "function") return none;
    const path = String(options?.path || "");
    if (!path) return none;
    if (propertyCardFrontmatterScopeDenied(scope)) return none;
    if (scope.classList.contains("cm-editor")) {
      const entry = propertyCardFrontmatterPaintedOwner(scope);
      if (!entry) return none;
      if (entry.path !== path) return none;
      const candidate = options?.view;
      const view = candidate && typeof candidate.dispatch === "function" ? candidate : entry.view;
      if (!view || typeof view.dispatch !== "function") return none;
      if (view.dom && view.dom !== scope) return none;
      const field = propertyCardFrontmatterEditorFieldGeneration(view);
      if (field.installed !== true || field.generation !== entry.generation) return none;
      return { owned: true, mode: "live", path, generation: entry.generation };
    }
    if (scope.classList.contains("markdown-preview-view")) {
      const entry = propertyCardFrontmatterReadingOwners.get(scope);
      if (!entry) return none;
      if (entry.path !== path) return none;
      if (scope.classList.contains(PROPERTY_CARD_OWNS_FRONTMATTER_CLASS) !== true) return none;
      return { owned: true, mode: "reading", path, generation: entry.generation };
    }
  } catch (_) {
    return none;
  }
  return none;
}

// Release one scope (and its editor entry) without touching other mounts.
// Capability routing calls this before a native fallback after a failed
// opener, so the native input it focuses is visible again. Never throws.
function propertyCardFrontmatterReleaseScope(scope, view) {
  let released = false;
  try {
    if (view && typeof view.dispatch === "function") {
      const entry = propertyCardFrontmatterEditorOwners.get(view);
      if (entry && entry.released !== true && (!scope || view.dom === scope)) {
        propertyCardFrontmatterEditorRelease(entry);
        released = true;
      }
    }
  } catch (_) {}
  try {
    if (scope && typeof scope.classList?.contains === "function") {
      const painted = propertyCardFrontmatterPaintedOwner(scope);
      if (painted) {
        propertyCardFrontmatterEditorRelease(painted);
        released = true;
      }
      const entry = propertyCardFrontmatterReadingOwners.get(scope);
      if (entry) {
        propertyCardFrontmatterReadingDrop(scope, entry);
        released = true;
      }
    }
  } catch (_) {}
  return released;
}

// Release every owned editor and Reading scope (host dispose, plugin unload).
function propertyCardFrontmatterReleaseAll() {
  for (const view of Array.from(propertyCardFrontmatterOwnedViews)) {
    const entry = propertyCardFrontmatterEditorOwners.get(view);
    if (entry) propertyCardFrontmatterEditorRelease(entry);
    else propertyCardFrontmatterOwnedViews.delete(view);
  }
  for (const scope of Array.from(propertyCardFrontmatterReadingScopes)) {
    propertyCardFrontmatterReadingDrop(scope, propertyCardFrontmatterReadingOwners.get(scope));
    propertyCardFrontmatterReadingScopes.delete(scope);
  }
}

// Register the field once per plugin. Idle editors carry no owner class.
function propertyCardHostRegisterFrontmatterOwnership(plugin) {
  try {
    if (!plugin || plugin[PROPERTY_CARD_FRONTMATTER_REGISTERED_FLAG] === true) return false;
    const extension = propertyCardFrontmatterOwnershipExtension();
    if (!extension || typeof plugin.registerEditorExtension !== "function") return false;
    plugin.registerEditorExtension(extension);
    plugin[PROPERTY_CARD_FRONTMATTER_REGISTERED_FLAG] = true;
    return true;
  } catch (_) {
    return false;
  }
}
