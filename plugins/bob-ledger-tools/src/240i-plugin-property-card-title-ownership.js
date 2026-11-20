// Property-card identity kit (bob-cli-o6 identity-kit): title ownership.
// While a mounted card owns its note's title, the owning view scope carries
// bob-property-card-owns-title (kit CSS hides that view's inline title) and
// the recognized source title range is hidden at render time:
//   - Live Preview: one kit StateField supplies a block replace decoration
//     over the range. Ownership arrives through a deferred effect (dispatching
//     inside an update is illegal), and any selection touching the range
//     (inclusive) reveals the raw Markdown for editing.
//   - Reading: the recognized h1 and nav/child-link p elements get a kit
//     class; section wrappers, cards, and embeds are never tagged.
// Ownership drops on release, a newer owner, Source mode, a file change,
// plugin disable, or unload; native rendering returns in the same frame. No
// note bytes change. Title ownership is separate from Properties row
// ownership (240b). Never throws.
const PROPERTY_CARD_OWNS_TITLE_CLASS = "bob-property-card-owns-title";
const PROPERTY_CARD_TITLE_SOURCE_CLASS = "bob-property-card-title-source";
const PROPERTY_CARD_TITLE_SOURCE_ATTR = "data-bob-title-source";
const PROPERTY_CARD_TITLE_REGISTERED_FLAG = "_propertyCardTitleOwnershipRegistered";
const PROPERTY_CARD_TITLE_OWNS_ATTRS = Object.freeze({ class: PROPERTY_CARD_OWNS_TITLE_CLASS });
const PROPERTY_CARD_TITLE_NO_ATTRS = Object.freeze({});
const PROPERTY_CARD_TITLE_SKIP_SECTIONS = Object.freeze([
  "mod-header", "mod-frontmatter", "markdown-preview-pusher", "mod-footer",
]);

// Lazy CodeMirror pieces: the freshness-mark suite asserts one eager
// StateEffect.define() at module load, so these are created on first use.
let propertyCardTitleEffectType = null;
let propertyCardTitleFieldType = null;
let propertyCardTitleGeneration = 0;
const propertyCardTitleEditorOwners = new WeakMap();
const propertyCardTitleOwnedViews = new Set();
const propertyCardTitleReadingOwners = new WeakMap();
const propertyCardTitleReadingScopes = new Set();

function propertyCardTitleScopeDenied(scope) {
  if (propertyCardDeniedScope(scope)) return true;
  try {
    return Boolean(scope.closest(".canvas-node, .canvas-node-content, .print"));
  } catch (_) {
    return true;
  }
}

function propertyCardTitleEnsureEffect() {
  if (!propertyCardTitleEffectType) {
    try {
      if (StateEffect && typeof StateEffect.define === "function") propertyCardTitleEffectType = StateEffect.define();
    } catch (_) {
      propertyCardTitleEffectType = null;
    }
  }
  return propertyCardTitleEffectType;
}

function propertyCardTitleFieldCreate() {
  return { owner: null, range: null, revealed: false };
}

function propertyCardTitleStateField(state, field) {
  if (!field || !state || typeof state.field !== "function") return undefined;
  try { return state.field(field, false); } catch (_) { return undefined; }
}

function propertyCardTitleDocRange(doc, recognizer) {
  if (!doc || typeof doc.line !== "function" || !recognizer) return null;
  return propertyCardTitleSourceRangeFromLines((index) => {
    const line = doc.line(index + 1);
    return { text: line.text, from: line.from, to: line.to };
  }, doc.lines, recognizer);
}

// Pure reducer behind the StateField. tr needs effects, docChanged, state
// ({ doc, selection, field }), and startState. deps may inject { effect,
// livePreviewField, infoField } for tests.
function propertyCardTitleFieldReduce(value, tr, deps = {}) {
  const current = value && typeof value === "object" ? value : propertyCardTitleFieldCreate();
  try {
    const effectType = deps.effect || propertyCardTitleEffectType;
    const liveField = Object.prototype.hasOwnProperty.call(deps, "livePreviewField") ? deps.livePreviewField : editorLivePreviewField;
    const infoField = Object.prototype.hasOwnProperty.call(deps, "infoField") ? deps.infoField : editorInfoField;
    let owner = current.owner;
    for (const effect of tr?.effects || []) {
      if (!effectType || typeof effect?.is !== "function" || !effect.is(effectType)) continue;
      const payload = effect.value || {};
      if (payload.own && typeof payload.own.path === "string" && payload.own.recognizer) {
        owner = { path: payload.own.path, generation: payload.own.generation, recognizer: payload.own.recognizer };
      } else if (payload.release !== undefined && owner && owner.generation === payload.release) {
        owner = null;
      }
    }
    const state = tr?.state;
    if (owner) {
      if (propertyCardTitleStateField(state, liveField) === false) owner = null;
    }
    if (owner) {
      const info = propertyCardTitleStateField(state, infoField);
      if (info && (info.file?.path ?? null) !== owner.path) owner = null;
    }
    let range = current.range;
    if (!owner) range = null;
    else if (owner !== current.owner || tr?.docChanged) range = propertyCardTitleDocRange(state?.doc, owner.recognizer);
    const revealed = range ? propertyCardSelectionTouches(state?.selection, range) : false;
    if (owner === current.owner && range === current.range && revealed === current.revealed) return current;
    return { owner, range, revealed };
  } catch (_) {
    return propertyCardTitleFieldCreate();
  }
}

function propertyCardTitleFieldDecorations(value) {
  const none = Decoration && Decoration.none !== undefined ? Decoration.none : null;
  try {
    if (!value?.owner || !value.range || value.revealed) return none;
    const replace = Decoration.replace({ block: true });
    if (typeof Decoration.set === "function") return Decoration.set([replace.range(value.range.from, value.range.to)]);
    const builder = new RangeSetBuilder();
    builder.add(value.range.from, value.range.to, replace);
    return builder.finish();
  } catch (_) {
    return none;
  }
}

function propertyCardTitleFieldAttributes(value) {
  return value?.owner ? PROPERTY_CARD_TITLE_OWNS_ATTRS : null;
}

// The StateField that owns titles in every Live Preview editor. Returns null
// (the caller registers nothing) when any CodeMirror piece is missing.
function propertyCardTitleOwnershipExtension() {
  try {
    if (propertyCardTitleFieldType) return propertyCardTitleFieldType;
    if (!StateField || typeof StateField.define !== "function") return null;
    if (!Decoration || typeof Decoration.replace !== "function") return null;
    if (typeof EditorView === "undefined" || !EditorView) return null;
    if (typeof EditorView.decorations?.from !== "function") return null;
    if (typeof EditorView.editorAttributes?.from !== "function") return null;
    if (!propertyCardTitleEnsureEffect()) return null;
    propertyCardTitleFieldType = StateField.define({
      create: () => propertyCardTitleFieldCreate(),
      update: (value, tr) => propertyCardTitleFieldReduce(value, tr),
      provide: (field) => [
        EditorView.decorations.from(field, (value) => propertyCardTitleFieldDecorations(value)),
        EditorView.editorAttributes.from(field, (value) => propertyCardTitleFieldAttributes(value) || PROPERTY_CARD_TITLE_NO_ATTRS),
      ],
    });
    return propertyCardTitleFieldType;
  } catch (_) {
    propertyCardTitleFieldType = null;
    return null;
  }
}

function propertyCardTitleDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

// Whether this view carries the kit field, and which generation it holds.
// No field (no host opted in, or not yet reconfigured) means no ownership.
function propertyCardTitleEditorFieldGeneration(view) {
  if (!propertyCardTitleFieldType) return { installed: false, generation: undefined };
  if (typeof view?.state?.field !== "function") return { installed: true, generation: undefined };
  const value = propertyCardTitleStateField(view.state, propertyCardTitleFieldType);
  if (value === undefined) return { installed: false, generation: undefined };
  return { installed: true, generation: value?.owner?.generation };
}

function propertyCardTitleEditorDispatch(entry, payload) {
  const effect = propertyCardTitleEnsureEffect();
  if (!effect) return;
  try { entry.view.dispatch({ effects: effect.of(payload) }); } catch (_) {}
}

function propertyCardTitleEditorScheduleOwn(entry) {
  entry.pending = true;
  entry.defer(() => {
    entry.pending = false;
    if (entry.released || propertyCardTitleEditorOwners.get(entry.view) !== entry) return;
    propertyCardTitleEditorDispatch(entry, {
      own: { path: entry.path, generation: entry.generation, recognizer: entry.recognizer },
    });
  });
}

function propertyCardTitleEditorRelease(entry) {
  if (!entry || entry.released) return;
  entry.released = true;
  if (propertyCardTitleEditorOwners.get(entry.view) !== entry) return;
  propertyCardTitleEditorOwners.delete(entry.view);
  propertyCardTitleOwnedViews.delete(entry.view);
  entry.defer(() => propertyCardTitleEditorDispatch(entry, { release: entry.generation }));
}

// Own the title in one Live Preview editor. Returns an idempotent,
// generation-bound release function (with .generation), or null when the
// scope is denied, the view is in Source mode, or the field is missing.
// Re-owning with the same path and recognizer key returns the existing
// handle and dispatches nothing, so adapters may call this on every
// decoration rebuild; if the field dropped this owner (Source round trip),
// the same generation is re-dispatched.
function propertyCardOwnTitleInEditor(view, options = {}) {
  try {
    if (!view || typeof view.dispatch !== "function") return null;
    if (propertyCardTitleScopeDenied(view.dom)) return null;
    const path = String(options?.path || "");
    const recognizer = options?.recognizer;
    if (!path || !recognizer || typeof recognizer.key !== "string") return null;
    if (!propertyCardTitleEnsureEffect()) return null;
    if (propertyCardTitleStateField(view.state, editorLivePreviewField) === false) return null;
    const field = propertyCardTitleEditorFieldGeneration(view);
    if (!field.installed) return null;
    const defer = typeof options.defer === "function" ? options.defer : propertyCardTitleDefer;
    const current = propertyCardTitleEditorOwners.get(view);
    if (current && !current.released && current.path === path && current.key === recognizer.key) {
      if (current.pending || field.generation === current.generation) return current.handle;
      current.recognizer = recognizer;
      current.defer = defer;
      propertyCardTitleEditorScheduleOwn(current);
      return current.handle;
    }
    propertyCardTitleGeneration += 1;
    const entry = {
      view, path, key: recognizer.key, recognizer, defer,
      generation: propertyCardTitleGeneration, pending: false, released: false, handle: null,
    };
    // A replaced owner is released first (same queue, so the field sees the
    // release before the new own) so a new owner released before its own
    // effect lands can never strand the old range hidden.
    if (current && !current.released) {
      current.released = true;
      current.defer(() => propertyCardTitleEditorDispatch(current, { release: current.generation }));
    }
    const handle = () => propertyCardTitleEditorRelease(entry);
    handle.generation = entry.generation;
    entry.handle = handle;
    propertyCardTitleEditorOwners.set(view, entry);
    propertyCardTitleOwnedViews.add(view);
    propertyCardTitleEditorScheduleOwn(entry);
    return handle;
  } catch (_) {
    return null;
  }
}

// Reading line text: text nodes stay text, a[data-href] becomes
// [[data-href|text]], br becomes \n, other elements recurse.
function propertyCardReadingLineText(node) {
  try {
    if (!node) return "";
    if (node.nodeType === 3) return String(node.nodeValue ?? node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "BR") return "\n";
    if (tag === "A") {
      const href = node.getAttribute?.("data-href");
      if (href) return `[[${href}|${String(node.textContent ?? "").trim()}]]`;
    }
    const kids = node.childNodes || node.children || [];
    let out = "";
    for (const child of Array.from(kids)) out += propertyCardReadingLineText(child);
    return out;
  } catch (_) {
    return "";
  }
}

function propertyCardTitleReadingElements(node) {
  return Array.from(node?.children || []).filter((child) => child && child.nodeType === 1);
}

function propertyCardTitleReadingIsCard(node) {
  try {
    return Boolean(node.classList?.contains("bob-property-card") || node.querySelector?.(".bob-property-card"));
  } catch (_) {
    return false;
  }
}

function propertyCardTitleReadingSectionEmpty(section) {
  if (propertyCardTitleReadingElements(section).length) return false;
  return !String(section.textContent ?? "").trim();
}

function propertyCardTitleReadingFollowerP(node, recognizer) {
  if (String(node.tagName || "").toUpperCase() !== "P" || typeof recognizer.follower !== "function") return false;
  const lines = propertyCardReadingLineText(node).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line, index) => recognizer.follower(line, index) === true);
}

// Collect the recognized h1 and follower p elements of a Reading scope.
function propertyCardTitleReadingTargets(scope, recognizer) {
  const found = [];
  const sizer = propertyCardTitleReadingElements(scope)
    .find((node) => node.classList?.contains("markdown-preview-sizer"));
  if (!sizer || !recognizer) return found;
  let started = false;
  for (const section of propertyCardTitleReadingElements(sizer)) {
    if (PROPERTY_CARD_TITLE_SKIP_SECTIONS.some((name) => section.classList?.contains(name))) continue;
    if (propertyCardTitleReadingSectionEmpty(section)) continue;
    if (!propertyCardNodeBelongs(section, scope) || propertyCardScopeIsEmbed(section)) return found;
    for (const node of propertyCardTitleReadingElements(section)) {
      if (propertyCardTitleReadingIsCard(node)) continue;
      if (!propertyCardNodeBelongs(node, scope) || propertyCardScopeIsEmbed(node)) return found;
      const tag = String(node.tagName || "").toUpperCase();
      if (!started) {
        if (tag === "H1") {
          const raw = propertyCardReadingLineText(node);
          const cleaned = propertyCardCleanInlineText(raw);
          if (typeof recognizer.heading !== "function" || recognizer.heading(cleaned, `# ${raw}`) !== true) return found;
        } else if (!(recognizer.requireHeading === false && propertyCardTitleReadingFollowerP(node, recognizer))) {
          return found;
        }
        started = true;
        found.push(node);
        continue;
      }
      if (!propertyCardTitleReadingFollowerP(node, recognizer)) return found;
      found.push(node);
    }
  }
  return found;
}

function propertyCardTitleReadingUntag(nodes) {
  for (const node of nodes || []) {
    try { node.classList?.remove(PROPERTY_CARD_TITLE_SOURCE_CLASS); } catch (_) {}
    try { node.removeAttribute?.(PROPERTY_CARD_TITLE_SOURCE_ATTR); } catch (_) {}
  }
}

function propertyCardTitleReadingPaint(scope, entry) {
  let next = [];
  try { next = propertyCardTitleReadingTargets(scope, entry.recognizer); } catch (_) { next = []; }
  const keep = new Set(next);
  propertyCardTitleReadingUntag(Array.from(entry.tagged).filter((node) => !keep.has(node)));
  for (const node of next) {
    try {
      node.classList?.add(PROPERTY_CARD_TITLE_SOURCE_CLASS);
      node.setAttribute?.(PROPERTY_CARD_TITLE_SOURCE_ATTR, entry.path);
    } catch (_) {}
  }
  entry.tagged = keep;
}

function propertyCardTitleReadingDrop(scope, entry) {
  if (!entry) return;
  try { entry.observer?.disconnect(); } catch (_) {}
  entry.observer = null;
  propertyCardTitleReadingUntag(entry.tagged);
  entry.tagged = new Set();
  try { scope.classList?.remove(PROPERTY_CARD_OWNS_TITLE_CLASS); } catch (_) {}
  if (propertyCardTitleReadingOwners.get(scope) === entry) {
    propertyCardTitleReadingOwners.delete(scope);
    propertyCardTitleReadingScopes.delete(scope);
  }
}

// Own the title in one Reading view scope. Every call is a new generation
// (like propertyCardOwnKeys): a newer owner replaces the old tags, and an old
// handle can never clear it. A MutationObserver re-tags lazily rendered
// sections. Returns a release function (with .generation) or null.
function propertyCardOwnTitleInReading(scope, options = {}) {
  try {
    if (propertyCardTitleScopeDenied(scope)) return null;
    if (!scope.classList?.contains("markdown-preview-view")) return null;
    const path = String(options?.path || "");
    const recognizer = options?.recognizer;
    if (!path || !recognizer || typeof recognizer.key !== "string") return null;
    const previous = propertyCardTitleReadingOwners.get(scope);
    if (previous) propertyCardTitleReadingDrop(scope, previous);
    propertyCardTitleGeneration += 1;
    const entry = {
      generation: propertyCardTitleGeneration, path, key: recognizer.key, recognizer,
      tagged: new Set(), observer: null,
    };
    propertyCardTitleReadingOwners.set(scope, entry);
    propertyCardTitleReadingScopes.add(scope);
    scope.classList.add(PROPERTY_CARD_OWNS_TITLE_CLASS);
    propertyCardTitleReadingPaint(scope, entry);
    try {
      const Observer = scope.ownerDocument?.defaultView?.MutationObserver;
      if (Observer) {
        entry.observer = new Observer(() => {
          if (propertyCardTitleReadingOwners.get(scope) !== entry) return;
          propertyCardTitleReadingPaint(scope, entry);
        });
        entry.observer.observe(scope, { childList: true, subtree: true });
      }
    } catch (_) {
      entry.observer = null;
    }
    const handle = () => {
      if (propertyCardTitleReadingOwners.get(scope) !== entry) return;
      propertyCardTitleReadingDrop(scope, entry);
    };
    handle.generation = entry.generation;
    return handle;
  } catch (_) {
    return null;
  }
}

// Unified entry: .cm-editor scopes with a view go through the Live Preview
// field; .markdown-preview-view scopes go through Reading tags.
function propertyCardOwnTitle(scope, options = {}) {
  try {
    if (scope?.classList?.contains("cm-editor") && options?.view) {
      if (options.view.dom && options.view.dom !== scope) return null;
      return propertyCardOwnTitleInEditor(options.view, options);
    }
    if (scope?.classList?.contains("markdown-preview-view")) return propertyCardOwnTitleInReading(scope, options);
  } catch (_) {}
  return null;
}

// Release every owned editor and Reading scope (host dispose, plugin unload).
function propertyCardTitleReleaseAll() {
  for (const view of Array.from(propertyCardTitleOwnedViews)) {
    const entry = propertyCardTitleEditorOwners.get(view);
    if (entry) propertyCardTitleEditorRelease(entry);
    else propertyCardTitleOwnedViews.delete(view);
  }
  for (const scope of Array.from(propertyCardTitleReadingScopes)) {
    propertyCardTitleReadingDrop(scope, propertyCardTitleReadingOwners.get(scope));
    propertyCardTitleReadingScopes.delete(scope);
  }
}

// Host opt-in (titleOwnership: true): register the field once per plugin.
function propertyCardHostRegisterTitleOwnership(plugin) {
  try {
    if (!plugin || plugin[PROPERTY_CARD_TITLE_REGISTERED_FLAG] === true) return false;
    const extension = propertyCardTitleOwnershipExtension();
    if (!extension || typeof plugin.registerEditorExtension !== "function") return false;
    plugin.registerEditorExtension(extension);
    plugin[PROPERTY_CARD_TITLE_REGISTERED_FLAG] = true;
    return true;
  } catch (_) {
    return false;
  }
}
