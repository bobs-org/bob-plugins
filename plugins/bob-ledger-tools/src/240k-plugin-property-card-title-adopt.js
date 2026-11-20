// Property-card adopter glue (bob-cli-o6 collection-cards): one call mounts a
// card node in the title slot (240e) and owns the note's title (240i), or
// reports "fallback" so the adapter keeps its body placement. Generic in
// kind and recognizer, so every species adapter reuses it unchanged.
//
//   propertyCardAdoptTitle(scope, node, { path, kind, view, recognizer,
//     currentPath, onLost, defer }) -> { mode: "slot" | "fallback", release }
//
// Reading mounts synchronously. Live Preview returns "slot" at once and
// mounts and owns in a deferred callback (default queueMicrotask), because
// nothing may mutate the DOM or dispatch inside a CodeMirror update; a
// deferred mount that fails calls onLost("insert-failed"). When the slot is
// lost, title ownership is released in the same frame, the heading demotes,
// and the adapter's onLost(reason) runs deferred so it can remount through
// its refresh. Paths that came back unstable or insert-failed stay in the
// fallback until the scope sees a new path or an explicit release.
//
// The kit heading (.bob-property-card-title, role=heading, aria-level=1) is
// promoted only while ownership is held; every other state demotes it, so a
// card never doubles a visible H1. release() is idempotent and
// generation-bound and never calls onLost. Never throws.
const PROPERTY_CARD_TITLE_HEADING_CLASS = "bob-property-card-title";
const PROPERTY_CARD_ADOPT_STICKY_REASONS = Object.freeze(["unstable", "insert-failed"]);

const propertyCardAdoptions = new Map();
const propertyCardAdoptMemory = new Map();
let propertyCardAdoptGeneration = 0;

function propertyCardAdoptNoop() {}

function propertyCardAdoptDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

function propertyCardTitleHeadings(node) {
  if (!node) return [];
  const found = [];
  try {
    if (node.classList?.contains(PROPERTY_CARD_TITLE_HEADING_CLASS)) found.push(node);
    for (const item of Array.from(node.querySelectorAll?.(`.${PROPERTY_CARD_TITLE_HEADING_CLASS}`) || [])) {
      if (!found.includes(item)) found.push(item);
    }
  } catch (_) {}
  return found;
}

// The kit builds title headings promoted. Demote drops role and aria-level
// so a card that does not own the title (embed, body fallback, failed
// ownership) is never announced as a second level-one heading.
function propertyCardDemoteTitleHeading(node) {
  for (const heading of propertyCardTitleHeadings(node)) {
    try { heading.removeAttribute?.("role"); } catch (_) {}
    try { heading.removeAttribute?.("aria-level"); } catch (_) {}
  }
  return node || null;
}

function propertyCardPromoteTitleHeading(node) {
  for (const heading of propertyCardTitleHeadings(node)) {
    try { heading.setAttribute?.("role", "heading"); } catch (_) {}
    try { heading.setAttribute?.("aria-level", "1"); } catch (_) {}
  }
  return node || null;
}

function propertyCardSyncTitleHeading(node, owned) {
  return owned ? propertyCardPromoteTitleHeading(node) : propertyCardDemoteTitleHeading(node);
}

function propertyCardAdoptRemembered(scope, path) {
  const memory = propertyCardAdoptMemory.get(scope);
  if (!memory) return false;
  if (memory.path === path) return true;
  propertyCardAdoptMemory.delete(scope);
  return false;
}

function propertyCardAdoptForget(scope, path) {
  const memory = propertyCardAdoptMemory.get(scope);
  if (memory && (path === undefined || path === null || path === "" || memory.path === path)) {
    propertyCardAdoptMemory.delete(scope);
  }
}

function propertyCardAdoptCall(callback, ...args) {
  if (typeof callback !== "function") return;
  try { callback(...args); } catch (_) {}
}

// Drop one entry: title ownership first, then the slot (the node leaves the
// slot unless keepNode), then demote. Never calls onLost.
function propertyCardAdoptDrop(scope, entry, keepNode = false) {
  if (!entry || entry.released) return;
  entry.released = true;
  if (propertyCardAdoptions.get(scope) === entry) propertyCardAdoptions.delete(scope);
  propertyCardAdoptCall(entry.titleRelease);
  entry.titleRelease = null;
  entry.owned = false;
  if (!keepNode) propertyCardAdoptCall(entry.slotRelease);
  entry.slotRelease = null;
  propertyCardDemoteTitleHeading(entry.node);
}

function propertyCardAdoptOwn(scope, entry) {
  let handle = null;
  try {
    handle = propertyCardOwnTitle(scope, {
      path: entry.path, recognizer: entry.recognizer, view: entry.view, defer: entry.defer,
    });
  } catch (_) {
    handle = null;
  }
  entry.titleRelease = typeof handle === "function" ? handle : null;
  entry.owned = Boolean(entry.titleRelease);
  entry.titleKey = entry.recognizer && typeof entry.recognizer.key === "string" ? entry.recognizer.key : "";
  propertyCardSyncTitleHeading(entry.node, entry.owned);
}

function propertyCardAdoptLost(scope, entry, reason) {
  if (entry.released || propertyCardAdoptions.get(scope) !== entry) return;
  entry.released = true;
  propertyCardAdoptions.delete(scope);
  // The primitive already took the node out of the slot. Ownership drops in
  // the same frame so the inline title and the H1 return at once.
  propertyCardAdoptCall(entry.titleRelease);
  entry.titleRelease = null;
  entry.owned = false;
  entry.slotRelease = null;
  propertyCardDemoteTitleHeading(entry.node);
  if (PROPERTY_CARD_ADOPT_STICKY_REASONS.includes(reason)) {
    propertyCardAdoptMemory.set(scope, { path: entry.path, reason });
  }
  entry.defer(() => propertyCardAdoptCall(entry.onLost, reason));
}

// Mount the entry's node now. Returns true when the slot holds it.
function propertyCardAdoptMount(scope, entry) {
  if (entry.released || propertyCardAdoptions.get(scope) !== entry) return false;
  entry.pending = false;
  let release = null;
  try {
    release = propertyCardMountInTitleSlot(scope, entry.node, {
      path: entry.path,
      kind: entry.kind,
      view: entry.view,
      currentPath: entry.currentPath,
      onLost: (reason) => propertyCardAdoptLost(scope, entry, reason),
    });
  } catch (_) {
    release = null;
  }
  if (typeof release !== "function") {
    entry.released = true;
    propertyCardAdoptions.delete(scope);
    propertyCardAdoptMemory.set(scope, { path: entry.path, reason: "insert-failed" });
    propertyCardDemoteTitleHeading(entry.node);
    return false;
  }
  entry.slotRelease = release;
  propertyCardAdoptOwn(scope, entry);
  return true;
}

function propertyCardAdoptOptions(options) {
  const opts = options && typeof options === "object" ? options : {};
  return {
    path: opts.path == null ? "" : String(opts.path),
    kind: opts.kind == null ? "" : String(opts.kind),
    view: opts.view || null,
    recognizer: opts.recognizer || null,
    currentPath: typeof opts.currentPath === "function" ? opts.currentPath : null,
    onLost: typeof opts.onLost === "function" ? opts.onLost : null,
    defer: typeof opts.defer === "function" ? opts.defer : propertyCardAdoptDefer,
  };
}

function propertyCardAdoptHandle(scope, entry) {
  return () => {
    if (propertyCardAdoptions.get(scope) !== entry) return;
    propertyCardAdoptDrop(scope, entry);
  };
}

function propertyCardAdoptFallback(scope, node) {
  const previous = propertyCardAdoptions.get(scope);
  if (previous) propertyCardAdoptDrop(scope, previous);
  propertyCardDemoteTitleHeading(node);
  return { mode: "fallback", release: propertyCardAdoptNoop };
}

// Mount node in scope's title slot and own the title, or report fallback.
function propertyCardAdoptTitle(scope, node, options = {}) {
  try {
    const opts = propertyCardAdoptOptions(options);
    if (!scope || !node) return propertyCardAdoptFallback(scope, node);
    const existing = propertyCardAdoptions.get(scope);
    if (existing && existing.node === node && existing.path === opts.path && !existing.released
      && (existing.pending || propertyCardTitleSlotMountedNode(scope) === node)) {
      // Same node, same path, still mounted: never remount. Keep the newest
      // callbacks and re-own only when the recognizer key changed (or
      // ownership was refused before).
      existing.onLost = opts.onLost;
      existing.currentPath = opts.currentPath;
      existing.defer = opts.defer;
      if (opts.view) existing.view = opts.view;
      const key = opts.recognizer && typeof opts.recognizer.key === "string" ? opts.recognizer.key : "";
      if (opts.recognizer) existing.recognizer = opts.recognizer;
      if (!existing.pending && (key !== existing.titleKey || !existing.owned)) propertyCardAdoptOwn(scope, existing);
      propertyCardSyncTitleHeading(node, existing.owned);
      return { mode: "slot", release: existing.handle };
    }
    if (propertyCardAdoptRemembered(scope, opts.path) || !propertyCardTitleSlotFor(scope)) {
      return propertyCardAdoptFallback(scope, node);
    }
    if (existing) propertyCardAdoptDrop(scope, existing, existing.node === node);
    propertyCardAdoptGeneration += 1;
    const entry = {
      generation: propertyCardAdoptGeneration,
      node,
      ...opts,
      mode: "slot",
      slotRelease: null,
      titleRelease: null,
      titleKey: "",
      owned: false,
      pending: false,
      released: false,
      handle: null,
    };
    entry.handle = propertyCardAdoptHandle(scope, entry);
    propertyCardAdoptions.set(scope, entry);
    propertyCardDemoteTitleHeading(node);
    if (scope.classList?.contains("cm-editor")) {
      entry.pending = true;
      entry.defer(() => {
        if (entry.released || propertyCardAdoptions.get(scope) !== entry) return;
        if (!propertyCardAdoptMount(scope, entry)) propertyCardAdoptCall(entry.onLost, "insert-failed");
      });
      return { mode: "slot", release: entry.handle };
    }
    if (!propertyCardAdoptMount(scope, entry)) return { mode: "fallback", release: propertyCardAdoptNoop };
    return { mode: "slot", release: entry.handle };
  } catch (_) {
    try { propertyCardDemoteTitleHeading(node); } catch (__) {}
    return { mode: "fallback", release: propertyCardAdoptNoop };
  }
}

// { node, path, kind, mode, owned, pending, generation } or null.
function propertyCardAdoptedEntry(scope) {
  const entry = propertyCardAdoptions.get(scope);
  if (!entry || entry.released) return null;
  return {
    node: entry.node,
    path: entry.path,
    kind: entry.kind,
    mode: entry.mode,
    owned: entry.owned,
    pending: entry.pending,
    generation: entry.generation,
  };
}

// Scope-wide release, optionally bound to one path. Also clears that path's
// remembered fallback. Never calls onLost.
function propertyCardAdoptRelease(scope, path) {
  const bound = path === undefined || path === null || path === "" ? "" : String(path);
  propertyCardAdoptForget(scope, bound);
  const entry = propertyCardAdoptions.get(scope);
  if (!entry || (bound && entry.path !== bound)) return false;
  propertyCardAdoptDrop(scope, entry);
  return true;
}

// Plugin unload: no adopted node, ownership, or memory may remain.
function propertyCardAdoptReleaseAll() {
  for (const [scope, entry] of Array.from(propertyCardAdoptions.entries())) {
    propertyCardAdoptDrop(scope, entry);
  }
  propertyCardAdoptions.clear();
  propertyCardAdoptMemory.clear();
}

function propertyCardAdoptAttrNames(node) {
  try {
    if (typeof node.getAttributeNames === "function") return node.getAttributeNames();
  } catch (_) {}
  const bag = node?.attrs instanceof Map ? node.attrs : node?.attributes;
  if (bag instanceof Map) return Array.from(bag.keys());
  try {
    if (bag && typeof bag.length === "number") return Array.from(bag).map((attr) => attr.name);
  } catch (_) {}
  return [];
}

function propertyCardAdoptChildren(node) {
  return Array.from(node?.childNodes || node?.children || []);
}

// Patch a mounted card in place: fresh's children replace target's, and
// target's attributes follow fresh's, except the slot-owned class and
// data-title-slot-* attributes, which stay. A body or title update thus
// happens inside the same node with no remount. Returns target.
function propertyCardAdoptPatch(target, fresh) {
  if (!target || !fresh || target === fresh) return target || null;
  try {
    const keep = new Set(typeof PROPERTY_CARD_TITLE_SLOT_ATTRIBUTES !== "undefined" ? PROPERTY_CARD_TITLE_SLOT_ATTRIBUTES : []);
    const slotted = Boolean(target.classList?.contains(PROPERTY_CARD_TITLE_SLOT_CLASS));
    const wanted = new Set(propertyCardAdoptAttrNames(fresh));
    for (const name of propertyCardAdoptAttrNames(target)) {
      if (name === "class" || keep.has(name) || wanted.has(name)) continue;
      try { target.removeAttribute(name); } catch (_) {}
    }
    for (const name of wanted) {
      if (name === "class" || keep.has(name)) continue;
      try { target.setAttribute(name, fresh.getAttribute(name)); } catch (_) {}
    }
    const classes = String(fresh.getAttribute?.("class") || "").split(/\s+/).filter(Boolean);
    if (slotted && !classes.includes(PROPERTY_CARD_TITLE_SLOT_CLASS)) classes.push(PROPERTY_CARD_TITLE_SLOT_CLASS);
    try { target.setAttribute("class", classes.join(" ")); } catch (_) {}
    for (const child of propertyCardAdoptChildren(target)) {
      try { target.removeChild(child); } catch (_) {}
    }
    for (const child of propertyCardAdoptChildren(fresh)) {
      try { target.appendChild(child); } catch (_) {}
    }
  } catch (_) {}
  return target;
}

// The Reading renderer and current path of the markdown leaf whose preview
// container holds scope, or null (embeds, popovers, detached views).
function propertyCardReadingViewFor(app, scope) {
  try {
    if (!scope) return null;
    for (const leaf of app?.workspace?.getLeavesOfType?.("markdown") || []) {
      const preview = leaf?.view?.previewMode;
      const container = preview?.containerEl;
      if (!container || (container !== scope && !container.contains?.(scope))) continue;
      return {
        view: preview.renderer || null,
        currentPath: () => String(leaf.view?.file?.path || ""),
      };
    }
  } catch (_) {}
  return null;
}

// The Live Preview editor's file path (editorInfoField), or "".
function propertyCardLiveCurrentPath(view) {
  try {
    if (typeof editorInfoField === "undefined" || !editorInfoField) return "";
    const info = view?.state?.field?.(editorInfoField, false);
    return String(info?.file?.path || "");
  } catch (_) {
    return "";
  }
}
