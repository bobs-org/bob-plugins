// Shared property-card title slot: mount one card node in Obsidian's own
// header slot, after the inline title and before native Properties, inside
// `.cm-editor > .cm-scroller > .cm-sizer` (Live Preview) or
// `.markdown-preview-view > .markdown-preview-sizer > .mod-header` (Reading).
// Desktop only. Source mode, embeds, hover popovers, canvas nodes, and
// print/export are denied, and a null return means "fall back to the body".
//
// One entry per native view scope, keyed in a Map so plugin unload can
// release every mount. Each mount gets a generation-bound release handle in
// the style of propertyCardOwnKeys: an old handle never clears a newer mount.
// A MutationObserver re-inserts the node when Obsidian re-renders the header
// (childList on the slot parent, the Reading sizer, and the Live Preview
// source view's class list; never subtree, so CodeMirror content edits never
// reach it). A ResizeObserver asks CodeMirror to re-measure after the card's
// height changes. Live Preview insertions and resizes also queue a Vim block-
// cursor redraw: the card moves .cm-content without changing CodeMirror
// geometry, so the cursor layer would otherwise stay at its old screen row.
// A re-insertion budget self-releases a slot that another
// writer keeps fighting over, and onLost(reason) tells the adapter to remount
// or fall back. Explicit releases never call onLost.
const PROPERTY_CARD_TITLE_SLOT_CLASS = "bob-property-card-title-slot";
const PROPERTY_CARD_TITLE_SLOT_REINSERT_BUDGET = 24;
const PROPERTY_CARD_TITLE_SLOT_REINSERT_WINDOW_MS = 1000;
const PROPERTY_CARD_TITLE_SLOT_MEASURE_BUDGET = 8;
const PROPERTY_CARD_TITLE_SLOT_MEASURE_WINDOW_MS = 1000;
const PROPERTY_CARD_TITLE_SLOT_ATTRIBUTES = ["data-title-slot-mode", "data-title-slot-kind"];

const propertyCardTitleSlots = new Map();
let propertyCardTitleSlotGeneration = 0;

function propertyCardTitleSlotChild(root, name) {
  if (!root) return null;
  try {
    return Array.from(root.children || []).find((node) => node?.classList?.contains(name)) || null;
  } catch (_) {
    return null;
  }
}

function propertyCardTitleSlotNow() {
  try { return Date.now(); } catch (_) { return 0; }
}

// Resolve the title slot for one native view scope, or null when denied.
// { mode: "live" | "reading", scope, parent, anchor, sizer, source }:
// parent is .cm-sizer or .mod-header and the card goes before anchor
// (null appends). Only direct children count, never nested descendants.
function propertyCardTitleSlotFor(scope) {
  try {
    if (!scope || typeof scope.closest !== "function") return null;
    if (scope.isConnected === false) return null;
    if (propertyCardScopeIsEmbed(scope)) return null;
    if (scope.closest(".canvas-node, .print")) return null;
    if (propertyCardDesktop() !== true) return null;
    const classes = scope.classList;
    if (classes?.contains("cm-editor")) {
      const source = scope.closest(".markdown-source-view");
      if (!source || !source.classList?.contains("is-live-preview")) return null;
      const sizer = propertyCardTitleSlotChild(propertyCardTitleSlotChild(scope, "cm-scroller"), "cm-sizer");
      const content = propertyCardTitleSlotChild(sizer, "cm-contentContainer");
      if (!sizer || !content) return null;
      const properties = propertyCardTitleSlotChild(sizer, "metadata-container");
      return { mode: "live", scope, parent: sizer, anchor: properties || content, sizer, source };
    }
    if (classes?.contains("markdown-preview-view")) {
      const sizer = propertyCardTitleSlotChild(scope, "markdown-preview-sizer");
      const header = propertyCardTitleSlotChild(sizer, "mod-header");
      if (!sizer || !header) return null;
      const properties = propertyCardTitleSlotChild(header, "metadata-container");
      return { mode: "reading", scope, parent: header, anchor: properties || null, sizer, source: null };
    }
  } catch (_) {
    return null;
  }
  return null;
}

function propertyCardTitleSlotPositioned(node, parent, anchor) {
  try {
    if (!node || node.parentNode !== parent) return false;
    if (anchor) return node.nextElementSibling === anchor;
    return node.nextElementSibling === null || node.nextElementSibling === undefined;
  } catch (_) {
    return false;
  }
}

function propertyCardTitleSlotStrip(node) {
  if (!node) return;
  try { node.classList?.remove(PROPERTY_CARD_TITLE_SLOT_CLASS); } catch (_) {}
  for (const name of PROPERTY_CARD_TITLE_SLOT_ATTRIBUTES) {
    try { node.removeAttribute?.(name); } catch (_) {}
  }
}

function propertyCardTitleSlotDetach(node) {
  if (!node) return;
  try {
    if (typeof node.remove === "function") node.remove();
    else node.parentNode?.removeChild?.(node);
  } catch (_) {}
}

function propertyCardTitleSlotDisconnect(entry) {
  for (const observer of entry?.observers || []) {
    try { observer.disconnect(); } catch (_) {}
  }
  if (entry) entry.observers = [];
}

// Live Preview: CodeMirror marks itself out of view while its whole content
// sits below the visible scroller, and then drops a pending scroll target
// (heading and block links, search jumps). Native Properties taller than the
// pane do the same. This read/write pair brings the content top into view and
// keeps the measure loop running, so CodeMirror honors the target. It reads
// CodeMirror's view state defensively; without it, it is a plain measure.
const PROPERTY_CARD_TITLE_SLOT_RESCUE_KEY = Object.freeze({ titleSlot: "rescue" });
const PROPERTY_CARD_TITLE_SLOT_CONTINUE_KEY = Object.freeze({ titleSlot: "continue" });

function propertyCardTitleSlotRescueRead(view) {
  try {
    if (!view?.viewState?.scrollTarget) return null;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    if (content.top < scroller.bottom - 1) return null;
    return content.top - scroller.top;
  } catch (_) {
    return null;
  }
}

function propertyCardTitleSlotRescueWrite(shift, view) {
  if (!(shift > 0)) return;
  try {
    view.scrollDOM.scrollTop += shift;
    view.requestMeasure({ key: PROPERTY_CARD_TITLE_SLOT_CONTINUE_KEY, read: () => null });
  } catch (_) {}
}

// Registered once for every editor. A transaction that leaves CodeMirror a
// pending scroll target (heading or block link, restored scroll, search jump)
// in an editor with a mounted Live Preview card arms the rescue for that
// measure. A bare size check keeps it inert while no card is mounted.
function propertyCardTitleSlotOnEditorUpdate(update) {
  if (propertyCardTitleSlots.size === 0) return;
  try {
    const view = update?.view;
    const target = view?.viewState?.scrollTarget;
    if (!target) return;
    for (const entry of propertyCardTitleSlots.values()) {
      if (entry.mode === "live" && entry.view === view) {
        // The same pending target must not re-arm: a tall slot card plus
        // setCursor leaves scrollTarget set, and requestMeasure would loop.
        if (entry.rescueTarget === target) return;
        entry.rescueTarget = target;
        propertyCardTitleSlotMeasure(entry);
        return;
      }
    }
  } catch (_) {}
}

function propertyCardTitleSlotEditorExtension() {
  try {
    if (EditorView?.updateListener && typeof EditorView.updateListener.of === "function") {
      return EditorView.updateListener.of(propertyCardTitleSlotOnEditorUpdate);
    }
  } catch (_) {}
  return [];
}

// Re-measure the host after an insertion or a size change: CodeMirror's
// requestMeasure in Live Preview, the Reading renderer's updateHeader (its
// cached .mod-header height drives scroll restore and virtualization). A
// Live Preview card also shifts content without changing CodeMirror geometry,
// so ask codemirror-vim to redraw its block cursor after the layout settles.
function propertyCardTitleSlotRedrawCursor(view) {
  try {
    const blockCursor = view?.cm?.state?.vimPlugin?.blockCursor;
    if (typeof blockCursor?.scheduleRedraw !== "function") return false;
    blockCursor.scheduleRedraw();
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardTitleSlotMeasure(entry) {
  const view = entry?.view;
  if (!view) return;
  if (entry.mode === "live") propertyCardTitleSlotRedrawCursor(view);
  try {
    const now = propertyCardTitleSlotNow();
    if (!entry.measureBudget || now - entry.measureBudget.windowStart > PROPERTY_CARD_TITLE_SLOT_MEASURE_WINDOW_MS) {
      entry.measureBudget = { windowStart: now, count: 0 };
    }
    entry.measureBudget.count += 1;
    if (entry.measureBudget.count > PROPERTY_CARD_TITLE_SLOT_MEASURE_BUDGET) return;
    if (entry.mode === "live" && typeof view.requestMeasure === "function") {
      view.requestMeasure({
        key: PROPERTY_CARD_TITLE_SLOT_RESCUE_KEY,
        read: propertyCardTitleSlotRescueRead,
        write: propertyCardTitleSlotRescueWrite,
      });
    } else if (entry.mode === "reading" && typeof view.updateHeader === "function") {
      view.updateHeader();
    }
  } catch (_) {}
}

// Live Preview scrollers set overflow-anchor: none, so a card that appears or
// changes height while it sits wholly above the visible area would push the
// text the reader is looking at. Keep that text still by moving scrollTop by
// the same amount. Reading scrollers anchor natively; re-insertions of a card
// Obsidian just moved never adjust.
function propertyCardTitleSlotScroller(entry) {
  if (entry?.mode !== "live") return null;
  try {
    return entry.view?.scrollDOM || entry.node?.closest?.(".cm-scroller") || null;
  } catch (_) {
    return null;
  }
}

function propertyCardTitleSlotHeight(node) {
  try {
    const rect = node.getBoundingClientRect();
    return typeof rect?.height === "number" ? rect.height : null;
  } catch (_) {
    return null;
  }
}

function propertyCardTitleSlotMargin(node) {
  try {
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    const value = parseFloat(style?.marginBottom || "0") + parseFloat(style?.marginTop || "0");
    return Number.isFinite(value) ? value : 0;
  } catch (_) {
    return 0;
  }
}

function propertyCardTitleSlotAnchor(entry, delta) {
  if (!delta) return;
  const scroller = propertyCardTitleSlotScroller(entry);
  if (!scroller || !(scroller.scrollTop > 0)) return;
  try {
    const node = entry.node.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (node.bottom <= box.top + 1) scroller.scrollTop += delta;
  } catch (_) {}
}

// Size changes only: a detached (virtualized) card has no layout to report,
// and an unchanged height needs no re-measure.
function propertyCardTitleSlotResized(scope, entry) {
  if (propertyCardTitleSlots.get(scope) !== entry) return;
  try { if (entry.node.isConnected === false) return; } catch (_) { return; }
  const height = propertyCardTitleSlotHeight(entry.node);
  if (height !== null && entry.height !== null) {
    if (height === entry.height) return;
    // 0 px means the card had no layout (a hidden leaf), so this is not growth.
    if (height > 0 && entry.height > 0) propertyCardTitleSlotAnchor(entry, height - entry.height);
  }
  if (height !== null) entry.height = height;
  propertyCardTitleSlotMeasure(entry);
}

// Tear one entry down without onLost: observers off, node out, marks off.
// keepNode leaves a node another entry is about to adopt in the DOM.
function propertyCardTitleSlotDrop(scope, entry, keepNode = false) {
  if (!entry) return;
  if (propertyCardTitleSlots.get(scope) === entry) propertyCardTitleSlots.delete(scope);
  propertyCardTitleSlotDisconnect(entry);
  if (!keepNode) {
    propertyCardTitleSlotDetach(entry.node);
    propertyCardTitleSlotStrip(entry.node);
  }
}

function propertyCardTitleSlotLose(scope, entry, reason) {
  if (propertyCardTitleSlots.get(scope) !== entry) return;
  propertyCardTitleSlotDrop(scope, entry);
  if (typeof entry.onLost !== "function") return;
  try { entry.onLost(reason); } catch (_) {}
}

// Watch only the slot's own structure: the parent's direct children, the
// Reading sizer (catches .mod-header replacement), and the Live Preview
// source view's class list (catches a switch to Source). Never subtree.
function propertyCardTitleSlotObserve(scope, entry, slot) {
  const win = scope?.ownerDocument?.defaultView || null;
  const Mutation = win?.MutationObserver;
  if (typeof Mutation === "function") {
    try {
      const observer = new Mutation(() => propertyCardTitleSlotCheck(scope, entry));
      observer.observe(slot.parent, { childList: true });
      if (slot.mode === "reading" && slot.sizer) observer.observe(slot.sizer, { childList: true });
      if (slot.mode === "live" && slot.source) observer.observe(slot.source, { attributes: true, attributeFilter: ["class"] });
      entry.observers.push(observer);
      entry.mutationObserver = observer;
    } catch (_) {}
  }
  const Resize = win?.ResizeObserver;
  if (typeof Resize === "function") {
    try {
      const observer = new Resize(() => propertyCardTitleSlotResized(scope, entry));
      observer.observe(entry.node);
      entry.observers.push(observer);
    } catch (_) {}
  }
}

// Point the existing MutationObserver at a replaced slot parent.
function propertyCardTitleSlotRetarget(entry, slot) {
  const observer = entry.mutationObserver;
  entry.parent = slot.parent;
  if (!observer) return;
  try {
    observer.disconnect();
    observer.observe(slot.parent, { childList: true });
    if (slot.mode === "reading" && slot.sizer) observer.observe(slot.sizer, { childList: true });
    if (slot.mode === "live" && slot.source) observer.observe(slot.source, { attributes: true, attributeFilter: ["class"] });
  } catch (_) {}
}

function propertyCardTitleSlotSpend(entry) {
  const now = propertyCardTitleSlotNow();
  const budget = entry.budget;
  if (!(now - budget.windowStart < PROPERTY_CARD_TITLE_SLOT_REINSERT_WINDOW_MS)) {
    budget.windowStart = now;
    budget.count = 0;
  }
  if (budget.count >= PROPERTY_CARD_TITLE_SLOT_REINSERT_BUDGET) return false;
  budget.count += 1;
  return true;
}

// Reading virtualizes sections far above the viewport, .mod-header included:
// Obsidian detaches the header element (the card inside it) and re-attaches
// it as-is when the reader scrolls back. A parked header is not a lost slot.
function propertyCardTitleSlotParked(scope, entry) {
  if (entry?.mode !== "reading") return false;
  try {
    if (entry.node.parentNode !== entry.parent || entry.parent.isConnected !== false) return false;
    const sizer = propertyCardTitleSlotChild(scope, "markdown-preview-sizer");
    if (!sizer || propertyCardTitleSlotChild(sizer, "mod-header")) return false;
    if (propertyCardScopeIsEmbed(scope) || scope.closest(".canvas-node, .print")) return false;
    return propertyCardDesktop() === true;
  } catch (_) {
    return false;
  }
}

function propertyCardTitleSlotHandle(scope, generation) {
  return () => {
    const current = propertyCardTitleSlots.get(scope);
    if (!current || current.generation !== generation) return;
    propertyCardTitleSlotDrop(scope, current);
  };
}

// A Reading paint can see a detached cached card before this observer puts
// it back. Notify the adapter after the real mount, including a reattached
// virtualized header, so it can recheck ownership against current evidence.
function propertyCardTitleSlotNotifyMount(scope, entry) {
  if (propertyCardTitleSlots.get(scope) !== entry) return;
  try {
    if (entry.node.isConnected === false || !scope.contains?.(entry.node)) return;
    entry.onMount?.(entry.node);
  } catch (_) {}
}

// Observer callback: re-resolve, follow a replaced parent, and re-insert.
function propertyCardTitleSlotCheck(scope, entry) {
  if (propertyCardTitleSlots.get(scope) !== entry) return;
  let connected = true;
  try { connected = scope.isConnected !== false; } catch (_) { connected = false; }
  if (!connected) {
    propertyCardTitleSlotLose(scope, entry, "disconnected");
    return;
  }
  if (typeof entry.currentPath === "function") {
    let now = "";
    try { now = String(entry.currentPath() || ""); } catch (_) { now = ""; }
    if (now !== String(entry.path || "")) {
      propertyCardTitleSlotLose(scope, entry, "path-changed");
      return;
    }
  }
  const slot = propertyCardTitleSlotFor(scope);
  if (!slot && propertyCardTitleSlotParked(scope, entry)) return;
  if (!slot || slot.mode !== entry.mode) {
    propertyCardTitleSlotLose(scope, entry, "denied");
    return;
  }
  if (slot.parent !== entry.parent) propertyCardTitleSlotRetarget(entry, slot);
  if (propertyCardTitleSlotPositioned(entry.node, slot.parent, slot.anchor)) {
    propertyCardTitleSlotNotifyMount(scope, entry);
    return;
  }
  if (!propertyCardTitleSlotSpend(entry)) {
    propertyCardTitleSlotLose(scope, entry, "unstable");
    return;
  }
  try {
    slot.parent.insertBefore(entry.node, slot.anchor || null);
  } catch (_) {
    propertyCardTitleSlotLose(scope, entry, "insert-failed");
    return;
  }
  entry.reinserts += 1;
  propertyCardTitleSlotMeasure(entry);
  propertyCardTitleSlotNotifyMount(scope, entry);
}

function propertyCardTitleSlotOptions(opts) {
  return {
    path: opts.path == null ? "" : String(opts.path),
    kind: opts.kind == null ? "" : String(opts.kind),
    view: opts.view || null,
    currentPath: typeof opts.currentPath === "function" ? opts.currentPath : null,
    onLost: typeof opts.onLost === "function" ? opts.onLost : null,
    onMount: typeof opts.onMount === "function" ? opts.onMount : null,
  };
}

function propertyCardTitleSlotPrune() {
  for (const [scope, entry] of Array.from(propertyCardTitleSlots.entries())) {
    let gone = false;
    try { gone = !scope || scope.isConnected === false; } catch (_) { gone = true; }
    if (gone) propertyCardTitleSlotDrop(scope, entry);
  }
}

// Mount node as the first child after the inline title and before native
// Properties. Returns an idempotent, generation-bound release function, or
// null when the slot is unavailable or insertion fails (body fallback).
function propertyCardMountInTitleSlot(scope, node, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  propertyCardTitleSlotPrune();
  const slot = propertyCardTitleSlotFor(scope);
  if (!slot || !node) {
    const stale = propertyCardTitleSlots.get(scope);
    if (stale && node && stale.node === node && propertyCardTitleSlotParked(scope, stale)) {
      // Re-mounting the parked card: rebind its options under a new generation.
      propertyCardTitleSlotGeneration += 1;
      Object.assign(stale, propertyCardTitleSlotOptions(opts), { generation: propertyCardTitleSlotGeneration });
      return propertyCardTitleSlotHandle(scope, stale.generation);
    }
    if (stale) propertyCardTitleSlotDrop(scope, stale);
    return null;
  }
  for (const [other, entry] of Array.from(propertyCardTitleSlots.entries())) {
    if (other !== scope && entry.node === node) propertyCardTitleSlotDrop(other, entry, true);
  }
  const previous = propertyCardTitleSlots.get(scope);
  if (previous) propertyCardTitleSlotDrop(scope, previous, previous.node === node);
  try {
    node.classList?.add(PROPERTY_CARD_TITLE_SLOT_CLASS);
    node.setAttribute?.("data-title-slot-mode", slot.mode);
    if (opts.kind) node.setAttribute?.("data-title-slot-kind", String(opts.kind));
    else node.removeAttribute?.("data-title-slot-kind");
  } catch (_) {}
  let inserted = false;
  let fresh = false;
  try { fresh = !node.isConnected; } catch (_) { fresh = false; }
  if (!propertyCardTitleSlotPositioned(node, slot.parent, slot.anchor)) {
    try {
      slot.parent.insertBefore(node, slot.anchor || null);
      inserted = true;
    } catch (_) {
      propertyCardTitleSlotDetach(node);
      propertyCardTitleSlotStrip(node);
      return null;
    }
  }
  propertyCardTitleSlotGeneration += 1;
  const generation = propertyCardTitleSlotGeneration;
  const entry = {
    generation, node, mode: slot.mode, parent: slot.parent, ...propertyCardTitleSlotOptions(opts),
    observers: [], mutationObserver: null, reinserts: 0, height: null,
    budget: { windowStart: propertyCardTitleSlotNow(), count: 0 },
  };
  entry.height = propertyCardTitleSlotHeight(node);
  if (inserted && fresh && entry.height) propertyCardTitleSlotAnchor(entry, entry.height + propertyCardTitleSlotMargin(node));
  propertyCardTitleSlots.set(scope, entry);
  propertyCardTitleSlotObserve(scope, entry, slot);
  if (inserted) propertyCardTitleSlotMeasure(entry);
  propertyCardTitleSlotNotifyMount(scope, entry);
  return propertyCardTitleSlotHandle(scope, generation);
}

// Scope-wide release for tests and teardown. Never calls onLost.
function propertyCardTitleSlotRelease(scope) {
  const entry = propertyCardTitleSlots.get(scope);
  if (!entry) return false;
  propertyCardTitleSlotDrop(scope, entry);
  return true;
}

// Plugin unload: no slot node and no live observer may remain.
function propertyCardTitleSlotReleaseAll() {
  for (const [scope, entry] of Array.from(propertyCardTitleSlots.entries())) {
    propertyCardTitleSlotDrop(scope, entry);
  }
  propertyCardTitleSlots.clear();
}

function propertyCardTitleSlotMountedNode(scope) {
  return propertyCardTitleSlots.get(scope)?.node || null;
}

function propertyCardTitleSlotLiveCount() {
  return propertyCardTitleSlots.size;
}

// Introspection for tests and the real-Obsidian spike report.
function propertyCardTitleSlotStats(scope) {
  const entry = propertyCardTitleSlots.get(scope);
  if (!entry) return null;
  return {
    generation: entry.generation, mode: entry.mode, path: entry.path, kind: entry.kind,
    reinserts: entry.reinserts, observers: entry.observers.length,
  };
}
