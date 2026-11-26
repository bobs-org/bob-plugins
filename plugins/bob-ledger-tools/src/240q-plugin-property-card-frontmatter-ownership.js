// Property-card kit: whole-container frontmatter ownership. Production
// adapters acquire through the mount coordinator below, after card and foot
// mounts succeed and source/cache/capability evidence is current.
// propertyCardOwnFrontmatter(scope, { path, view }) adds
// bob-property-card-owns-frontmatter to the view scope. Kit CSS sets
// Obsidian's --metadata-display-editing / --metadata-display-reading to
// none and hides the exact native paths propertyCardNativeContainer uses.
// The node stays in the DOM (it is the title-slot anchor) with inert plus
// aria-hidden, and a focusin guard returns focus to the editor. Live
// Preview uses a lazy StateField plus editorAttributes (modeled on 240i);
// Reading uses a generation-bound class. A metadata change re-checks
// evidence and releases only mounts whose source no longer matches the
// cache. Ownership also drops on release, a newer owner, Source mode,
// rename/delete, plugin disable, or unload. Never throws. Adapters must
// use the coordinator rather than call this directly so invalidation and
// generation-bound cleanup stay shared.
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
    const mounted = propertyCardFrontmatterMountOwners.get(view.dom);
    if (mounted && !propertyCardFrontmatterRecordEligible(mounted.plugin, mounted.options)) {
      propertyCardFrontmatterReleaseMounted(view.dom, {
        plugin: mounted.plugin, kind: mounted.kind, path: mounted.path,
      });
    }
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
          const mounted = propertyCardFrontmatterMountOwners.get(scope);
          if (mounted && !propertyCardFrontmatterRecordEligible(mounted.plugin, mounted.options)) {
            propertyCardFrontmatterReleaseMounted(scope, {
              plugin: mounted.plugin, kind: mounted.kind, path: mounted.path,
            });
            return;
          }
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

const propertyCardFrontmatterMountOwners = new Map();
const propertyCardFrontmatterCoordinatorBindings = new WeakMap();
let propertyCardFrontmatterMountGeneration = 0;

function propertyCardFrontmatterStableValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { invalidDate: true } : { date: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(propertyCardFrontmatterStableValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = propertyCardFrontmatterStableValue(value[key]);
    return out;
  }
  return value;
}

// Source must contain one closed, duplicate-free YAML mapping whose parsed
// keys and values match the current note's metadata cache. Obsidian's
// synthetic frontmatter position is excluded from the cache comparison.
function propertyCardFrontmatterCacheEvidence(sourceText, cachedFrontmatter, parser = parseYaml) {
  try {
    if (typeof sourceText !== "string" || !cachedFrontmatter
      || typeof cachedFrontmatter !== "object" || Array.isArray(cachedFrontmatter)) return false;
    if (typeof propertyCardScanFrontmatter !== "function"
      || typeof propertyCardInventoryParserResult !== "function") return false;
    const scan = propertyCardScanFrontmatter(sourceText);
    if (scan?.state !== "closed") return false;
    const duplicates = typeof propertyCardInventoryTopLevelDuplicates === "function"
      ? propertyCardInventoryTopLevelDuplicates(scan.entries || []) : [];
    if (duplicates.length) return false;
    if (typeof parser !== "function") return false;
    const parsed = propertyCardInventoryParserResult(parser, scan.yaml);
    if (!parsed?.ok || parsed.duplicateOnly === true) return false;
    const source = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? parsed.value : {};
    const sourceKeys = Object.keys(source).sort();
    const cacheKeys = typeof propertyCardInventoryCacheKeys === "function"
      ? propertyCardInventoryCacheKeys(cachedFrontmatter).sort()
      : Object.keys(cachedFrontmatter).filter((key) => key !== "position").sort();
    if (sourceKeys.length !== cacheKeys.length
      || sourceKeys.some((key, index) => key !== cacheKeys[index])) return false;
    return JSON.stringify(propertyCardFrontmatterStableValue(source))
      === JSON.stringify(propertyCardFrontmatterStableValue(Object.fromEntries(
        cacheKeys.map((key) => [key, cachedFrontmatter[key]]),
      )));
  } catch (_) {
    return false;
  }
}

function propertyCardFrontmatterMarkdownViewFor(app, scope) {
  try {
    for (const leaf of app?.workspace?.getLeavesOfType?.("markdown") || []) {
      const view = leaf?.view;
      const preview = view?.previewMode?.containerEl;
      if (scope && preview && (preview === scope || preview.contains?.(scope))) return view;
    }
  } catch (_) {}
  return null;
}

function propertyCardFrontmatterScopeMode(scope) {
  if (scope?.classList?.contains?.("cm-editor")) return "live";
  if (scope?.classList?.contains?.("markdown-preview-view")) return "reading";
  return "";
}

function propertyCardFrontmatterCurrentPath(view, options = {}) {
  try {
    if (typeof options.currentPath === "function") return String(options.currentPath() || "");
    if (typeof options.currentPath === "string") return options.currentPath;
    if (propertyCardFrontmatterScopeMode(options.scope) === "live") {
      const info = view?.state?.field?.(editorInfoField, false);
      return String(info?.file?.path || "");
    }
    return String(view?.file?.path || "");
  } catch (_) {
    return "";
  }
}

function propertyCardFrontmatterCacheFor(plugin, path) {
  try {
    const file = plugin?.app?.vault?.getAbstractFileByPath?.(path);
    if (!file || String(file.path || "").replace(/\\/g, "/") !== path) return null;
    const cache = typeof propertyCardSettledFileCache === "function"
      ? propertyCardSettledFileCache(plugin.app, file)
      : plugin.app?.metadataCache?.getFileCache?.(file);
    const frontmatter = cache?.frontmatter;
    return frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? frontmatter : null;
  } catch (_) {
    return null;
  }
}

function propertyCardFrontmatterCapabilityReady(plugin) {
  try {
    if (typeof plugin?.propertyCapabilityRoutingReady !== "function"
      || plugin.propertyCapabilityRoutingReady() !== true) return false;
    if (typeof plugin.propertyCapabilityCurrentBobKey !== "function"
      || typeof plugin.propertyCapabilityConfirmed !== "function") return false;
    const key = plugin.propertyCapabilityCurrentBobKey();
    return Boolean(key) && plugin.propertyCapabilityConfirmed(key) === true;
  } catch (_) {
    return false;
  }
}

// Species-specific contract requirement (bob-cli-pl.9.1.1 / .9.1.2):
// area/project cards and the bank hub need confirmed `props_contract_v1`
// evidence for the current bob path. Bank, album, record, temporal,
// notebook, and prose cards use the generic `props_v1` capability alone.
function propertyCardFrontmatterContractReady(plugin, kind, path) {
  try {
    if (kind !== "area" && kind !== "project") return true;
    if (typeof plugin?.propertyCapabilityContractConfirmed !== "function") return false;
    return plugin.propertyCapabilityContractConfirmed() === true;
  } catch (_) {
    return false;
  }
}

function propertyCardFrontmatterMountPath(mount, kind) {
  const attr = kind === "album" ? "data-album-source"
    : kind === "record" ? "data-record-source"
      : kind === "bank" ? "data-bank-setup-source"
        : kind === "area" || kind === "project" ? "data-home-source"
          : kind === "notebook" ? "data-notebook-source"
            : kind === "prose" ? "data-prose-source" : "data-intention-source";
  try { return String(mount?.getAttribute?.(attr) || "").replace(/\\/g, "/"); } catch (_) { return ""; }
}

function propertyCardFrontmatterRecordEligible(plugin, options = {}) {
  try {
    const scope = options.scope;
    const mode = propertyCardFrontmatterScopeMode(scope);
    const path = String(options.path || "").replace(/\\/g, "/");
    const kind = options.kind;
    const mount = options.mount;
    if (!scope || !path || !["album", "record", "day", "week", "quarter", "year", "bank", "area", "project", "notebook", "prose"].includes(kind)) return false;
    if (options.active && options.active() !== true) return false;
    if (typeof propertyCardDesktop === "function" && propertyCardDesktop() !== true) return false;
    if (propertyCardFrontmatterScopeDenied(scope)) return false;
    if (mode !== "live" && mode !== "reading") return false;
    if (scope.isConnected === false || !mount || mount.isConnected === false || !mount.parentNode) return false;
    if (typeof scope.contains === "function" && !scope.contains(mount)) return false;
    if (propertyCardFrontmatterMountPath(mount, kind) !== path) return false;
    if (typeof mount.querySelector !== "function" || !mount.querySelector(".bob-property-card-foot")) return false;
    if (!propertyCardFrontmatterCapabilityReady(plugin)) return false;
    // Area/project mounts additionally need the typed settings contract;
    // without it the mount keeps native Properties (fail open).
    if (!propertyCardFrontmatterContractReady(plugin, kind, path)) return false;

    const view = options.view || (mode === "reading"
      ? propertyCardFrontmatterMarkdownViewFor(plugin?.app, scope) : null);
    if (mode === "live") {
      if (!view || view.dom !== scope || typeof view.state?.field !== "function") return false;
      if (view.state.field(editorLivePreviewField, false) !== true) return false;
    } else if (view) {
      let viewMode = "";
      try {
        viewMode = typeof view.getMode === "function" ? String(view.getMode() || "")
          : view.currentMode && view.previewMode ? (view.currentMode === view.previewMode ? "preview" : "source") : "";
      } catch (_) { viewMode = ""; }
      if (viewMode && viewMode !== "preview") return false;
    }
    if (propertyCardFrontmatterCurrentPath(view, { ...options, scope }) !== path) return false;

    const source = typeof options.getSource === "function" ? options.getSource() : options.sourceText;
    const cachedFrontmatter = propertyCardFrontmatterCacheFor(plugin, path);
    if (typeof source !== "string" || !cachedFrontmatter
      || !propertyCardFrontmatterCacheEvidence(source, cachedFrontmatter, options.parseYaml || parseYaml)) return false;
    if (typeof options.isCurrent === "function" && options.isCurrent() !== true) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardFrontmatterReleaseMounted(scope, filters = {}) {
  const entry = scope ? propertyCardFrontmatterMountOwners.get(scope) : null;
  if (!entry) return false;
  if (filters.plugin && entry.plugin !== filters.plugin) return false;
  if (filters.kind && entry.kind !== filters.kind) return false;
  if (Array.isArray(filters.kinds) && !filters.kinds.includes(entry.kind)) return false;
  if (filters.path && entry.path !== String(filters.path).replace(/\\/g, "/")) return false;
  if (filters.generation && entry.generation !== filters.generation) return false;
  propertyCardFrontmatterMountOwners.delete(scope);
  try { entry.primitiveRelease?.(); } catch (_) {}
  return true;
}

function propertyCardFrontmatterOwnMounted(plugin, options = {}) {
  const scope = options.scope;
  const kind = options.kind;
  const path = String(options.path || "").replace(/\\/g, "/");
  // A newer paint supersedes any detached Reading mount awaiting attachment.
  propertyCardFrontmatterCoordinatorBindings.get(plugin)?.pending?.delete?.(scope);
  if (!propertyCardFrontmatterRecordEligible(plugin, { ...options, scope, path, kind })) {
    propertyCardFrontmatterReleaseMounted(scope, { plugin, kind });
    // Obsidian can paint a cached Reading preview before reattaching its DOM.
    // Keep native Properties available now, then check the same mount once at
    // the next frame. Do not poll, retry other eligibility failures, or let a
    // detached/stale callback release a newer mount.
    const win = scope?.ownerDocument?.defaultView;
    const mount = options.mount;
    if (options.afterAttach !== true && propertyCardFrontmatterScopeMode(scope) === "reading"
      && (scope.isConnected === false || mount?.isConnected === false)
      && mount?.parentNode && scope.contains?.(mount)
      && typeof win?.requestAnimationFrame === "function") {
      propertyCardFrontmatterOwnMountedDeferred(plugin, {
        ...options, afterAttach: true,
        defer: (callback) => win.requestAnimationFrame(callback),
      });
    }
    return null;
  }
  const view = options.view || (propertyCardFrontmatterScopeMode(scope) === "reading"
    ? propertyCardFrontmatterMarkdownViewFor(plugin?.app, scope) : null);
  const existing = propertyCardFrontmatterMountOwners.get(scope);
  if (existing && existing.plugin === plugin && existing.kind === kind && existing.path === path
    && existing.view === view && existing.mount === options.mount) {
    existing.options = { ...options, scope, path, kind, view };
    return existing.release;
  }
  propertyCardFrontmatterReleaseMounted(scope);
  const primitiveRelease = propertyCardOwnFrontmatter(scope, { path, view });
  if (typeof primitiveRelease !== "function") return null;
  const entry = {
    plugin, kind, path, scope, view, mount: options.mount,
    options: { ...options, scope, path, kind, view }, primitiveRelease, generation: ++propertyCardFrontmatterMountGeneration,
    release: null,
  };
  entry.release = () => propertyCardFrontmatterReleaseMounted(scope, {
    plugin, kind, path, generation: entry.generation,
  });
  propertyCardFrontmatterMountOwners.set(scope, entry);
  return entry.release;
}

function propertyCardFrontmatterOwnMountedDeferred(plugin, options = {}) {
  const scope = options.scope;
  const kind = options.kind;
  const path = String(options.path || "").replace(/\\/g, "/");
  const defer = typeof options.defer === "function" ? options.defer : propertyCardFrontmatterDefer;
  const token = ++propertyCardFrontmatterMountGeneration;
  const current = propertyCardFrontmatterCoordinatorBindings.get(plugin) || {};
  if (!(current.pending instanceof WeakMap)) current.pending = new WeakMap();
  propertyCardFrontmatterCoordinatorBindings.set(plugin, current);
  current.pending.set(scope, token);
  defer(() => {
    if (current.pending.get(scope) !== token) return;
    current.pending.delete(scope);
    if (options.afterAttach === true && (scope?.isConnected === false
      || options.mount?.isConnected === false || !scope?.contains?.(options.mount))) return;
    const currentPath = propertyCardFrontmatterCurrentPath(options.view, { ...options, scope });
    if (currentPath !== path) {
      propertyCardFrontmatterReleaseMounted(scope, { plugin, kind, path });
      return;
    }
    propertyCardFrontmatterOwnMounted(plugin, options);
  });
  return token;
}

function propertyCardFrontmatterCoordinatorReleasePath(plugin, path) {
  const key = String(path || "").replace(/\\/g, "/");
  let released = 0;
  for (const [scope, entry] of Array.from(propertyCardFrontmatterMountOwners.entries())) {
    if (entry.plugin === plugin && (!key || entry.path === key)) {
      if (propertyCardFrontmatterReleaseMounted(scope, { plugin })) released += 1;
    }
  }
  return released;
}

function propertyCardFrontmatterCoordinatorRecheckPath(plugin, path) {
  const key = String(path || "").replace(/\\/g, "/");
  if (!key) return 0;
  let released = 0;
  for (const [scope, entry] of Array.from(propertyCardFrontmatterMountOwners.entries())) {
    if (entry.plugin !== plugin || entry.path !== key) continue;
    if (!propertyCardFrontmatterRecordEligible(plugin, entry.options)) {
      if (propertyCardFrontmatterReleaseMounted(scope, { plugin, kind: entry.kind, path: entry.path })) released += 1;
    }
  }
  return released;
}

function propertyCardFrontmatterCoordinatorReleaseKind(plugin, kind) {
  let released = 0;
  for (const [scope, entry] of Array.from(propertyCardFrontmatterMountOwners.entries())) {
    if (entry.plugin === plugin && entry.kind === kind) {
      if (propertyCardFrontmatterReleaseMounted(scope, { plugin, kind })) released += 1;
    }
  }
  const binding = propertyCardFrontmatterCoordinatorBindings.get(plugin);
  binding?.kinds?.delete?.(kind);
  return released;
}

function propertyCardFrontmatterCoordinatorReconcile(plugin) {
  let released = 0;
  for (const [scope, entry] of Array.from(propertyCardFrontmatterMountOwners.entries())) {
    if (entry.plugin !== plugin) continue;
    if (!propertyCardFrontmatterRecordEligible(plugin, entry.options)) {
      if (propertyCardFrontmatterReleaseMounted(scope, { plugin, kind: entry.kind, path: entry.path })) released += 1;
    }
  }
  // Reconcile releases ownership when a mounted surface becomes ineligible,
  // but there is no owner entry left to observe when the same surface becomes
  // eligible again. Repaint an open bank note on workspace/config transitions
  // so its adapter can reacquire the mounted Properties container.
  const binding = propertyCardFrontmatterCoordinatorBindings.get(plugin);
  if (binding?.kinds?.has?.("bank")) {
    let bankOpen = false;
    try {
      bankOpen = (plugin?.app?.workspace?.getLeavesOfType?.("markdown") || []).some((leaf) => {
        const markdown = leaf?.view;
        const editor = markdown?.editor?.cm;
        const paths = [
          plugin?.bankSetupLivePath?.(editor),
          plugin?.bankSetupSourcePath?.(editor),
          markdown?.file?.path,
        ];
        return paths.some((path) => {
          try {
            return typeof bankSetupIsHubPath === "function"
              ? bankSetupIsHubPath(path)
              : String(path || "").replace(/\\/g, "/") === "bank.md";
          } catch (_) { return false; }
        });
      });
    } catch (_) {}
    if (bankOpen) {
      try { plugin?.scheduleBankSetupRefresh?.(); } catch (_) {}
    }
  }
  return released;
}

function propertyCardFrontmatterCoordinatorCapabilityChanged(plugin, status) {
  const released = propertyCardFrontmatterCoordinatorReconcile(plugin);
  if (status === "confirmed" && propertyCardFrontmatterCapabilityReady(plugin)) {
    for (const method of ["scheduleAlbumHeaderRefresh", "scheduleRecordSheetRefresh", "scheduleIntentionCardRefresh", "scheduleBankSetupRefresh", "scheduleHomeCardRefresh"]) {
      try { plugin?.[method]?.(); } catch (_) {}
    }
    try { plugin?.intentionCardHost?.().scheduleRefresh?.(); } catch (_) {}
  }
  return released;
}

function propertyCardFrontmatterCoordinatorBind(plugin, kind) {
  if (!plugin || !kind) return false;
  // The shared ownership gate dispatches through its own Live Preview
  // StateField. Register it when the card adapters bind so a mounted card
  // cannot appear ready while that field is missing and silently stay native.
  try { propertyCardHostRegisterFrontmatterOwnership(plugin); } catch (_) {}
  let binding = propertyCardFrontmatterCoordinatorBindings.get(plugin);
  if (!binding || !(binding.kinds instanceof Set)) {
    binding = { kinds: new Set(), bound: false, pending: new WeakMap() };
    propertyCardFrontmatterCoordinatorBindings.set(plugin, binding);
  }
  binding.kinds.add(kind);
  if (binding.bound) return true;
  const bindEvent = (emitter, name, handler) => {
    try {
      if (emitter && typeof emitter.on === "function" && typeof plugin.registerEvent === "function") {
        plugin.registerEvent(emitter.on(name, handler));
      }
    } catch (_) {}
  };
  const workspace = plugin.app?.workspace;
  for (const name of ["file-open", "active-leaf-change", "layout-change", "config-changed"]) {
    bindEvent(workspace, name, () => propertyCardFrontmatterCoordinatorReconcile(plugin));
  }
  bindEvent(plugin.app?.metadataCache, "changed", (file) => {
    propertyCardFrontmatterCoordinatorRecheckPath(plugin, file?.path);
  });
  bindEvent(plugin.app?.vault, "rename", (_file, oldPath) => {
    propertyCardFrontmatterCoordinatorReleasePath(plugin, oldPath);
  });
  bindEvent(plugin.app?.vault, "delete", (file) => {
    propertyCardFrontmatterCoordinatorReleasePath(plugin, file?.path);
  });
  binding.bound = true;
  return true;
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
