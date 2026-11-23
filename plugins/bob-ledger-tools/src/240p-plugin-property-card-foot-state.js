// Shared property-card foot runtime (bob-cli-pf drawer-record): per-note
// session state and mount lifecycle for the lazy accessible foot.
//
// drawer_memory = note: session-only state is keyed by normalized note path
// and shared by every mount of that note. A different note starts closed.
// Per-path open state survives refresh, card-body collapse, and revisiting
// the note, but never survives plugin reload: adapters reset on dispose.
// Per-path state is separate from per-mount disclosure IDs, which stay unique
// even for two panes showing one note.
//
// propertyCardToggleProperties(view) returns whether it acted: it resolves a
// live, path-matching mount in the supplied view and never toggles a hidden
// or stale mount left by a previous file, another pane, or an embed.
function propertyCardFootPath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
}

const propertyCardFootOpenStates = new Map();
const propertyCardFootMounts = new Map();
const propertyCardFootMountByNode = new WeakMap();
const propertyCardFootToggleListeners = new Set();
const propertyCardFootPathResolvers = [];
let propertyCardFootMountSeq = 0;
let propertyCardFootEditorHook = null;

function propertyCardFootIsOpen(path) {
  const key = propertyCardFootPath(path);
  if (!key) return false;
  return propertyCardFootOpenStates.get(key) === true;
}

// Flip open state for one path and notify adapter listeners so the affected
// mounts repaint. Returns the new open state.
function propertyCardFootToggle(path) {
  const key = propertyCardFootPath(path);
  if (!key) return false;
  const next = propertyCardFootOpenStates.get(key) !== true;
  if (next) propertyCardFootOpenStates.set(key, true);
  else propertyCardFootOpenStates.delete(key);
  for (const listener of Array.from(propertyCardFootToggleListeners)) {
    try { listener(key, next); } catch (_) {}
  }
  return next;
}

function propertyCardFootSetOpen(path, open) {
  const key = propertyCardFootPath(path);
  if (!key) return false;
  const next = open === true;
  const current = propertyCardFootOpenStates.get(key) === true;
  if (current === next) return next;
  if (next) propertyCardFootOpenStates.set(key, true);
  else propertyCardFootOpenStates.delete(key);
  for (const listener of Array.from(propertyCardFootToggleListeners)) {
    try { listener(key, next); } catch (_) {}
  }
  return next;
}

// Adapters repaint through this subscription; the entrypoints phase's `-`
// arm reaches mounts through propertyCardToggleProperties below.
function propertyCardFootOnToggle(listener) {
  if (typeof listener !== "function") return () => {};
  propertyCardFootToggleListeners.add(listener);
  return () => { propertyCardFootToggleListeners.delete(listener); };
}

// Mount registry: one entry per mounted foot node. Disclosure IDs come from
// a session counter so two panes on one note never share an ID. Claim an ID
// before building so the builder never derives one from the path.
function propertyCardFootNextDisclosureId() {
  propertyCardFootMountSeq += 1;
  return `bob-property-foot-${propertyCardFootMountSeq}`;
}

function propertyCardFootRegisterMount(node, path, disclosureId) {
  const key = propertyCardFootPath(path);
  if (!node || !key) return null;
  const existing = propertyCardFootMountByNode.get(node);
  if (existing && propertyCardFootMounts.has(existing.id)) {
    existing.path = key;
    if (disclosureId) existing.disclosureId = disclosureId;
    return { id: existing.id, disclosureId: existing.disclosureId };
  }
  propertyCardFootMountSeq += 1;
  const id = `foot-${propertyCardFootMountSeq}`;
  const entry = { id, node, path: key, disclosureId: disclosureId || `bob-property-foot-${propertyCardFootMountSeq}` };
  propertyCardFootMounts.set(id, entry);
  try { propertyCardFootMountByNode.set(node, entry); } catch (_) {}
  return { id: entry.id, disclosureId: entry.disclosureId };
}

function propertyCardFootUnregisterMount(id) {
  const entry = propertyCardFootMounts.get(id);
  if (!entry) return false;
  propertyCardFootMounts.delete(id);
  try { if (propertyCardFootMountByNode.get(entry.node) === entry) propertyCardFootMountByNode.delete(entry.node); } catch (_) {}
  return true;
}

function propertyCardFootUnregisterNode(node) {
  if (!node) return false;
  let entry = null;
  try { entry = propertyCardFootMountByNode.get(node) || null; } catch (_) {}
  if (!entry) return false;
  return propertyCardFootUnregisterMount(entry.id);
}

// Release every mount under a removed root (path change, removal, failed
// paint). With a path, only that path's mounts release. Disconnected mounts
// for the path always release: a rebuilt mount leaves its predecessor
// detached, so repaint pruning keeps the registry from growing.
function propertyCardFootReleaseScope(root, path) {
  const key = path == null || path === "" ? "" : propertyCardFootPath(path);
  let released = 0;
  for (const entry of Array.from(propertyCardFootMounts.values())) {
    if (key && entry.path !== key) continue;
    let connected = true;
    try {
      connected = entry.node ? entry.node.isConnected !== false : false;
    } catch (_) {
      connected = true;
    }
    if (!connected) {
      if (propertyCardFootUnregisterMount(entry.id)) released += 1;
      continue;
    }
    let inside = false;
    try {
      inside = Boolean(root && (root === entry.node || (typeof root.contains === "function" && root.contains(entry.node))));
    } catch (_) {
      inside = false;
    }
    if (!inside) continue;
    if (propertyCardFootUnregisterMount(entry.id)) released += 1;
  }
  return released;
}

function propertyCardFootMountsFor(path) {
  const key = propertyCardFootPath(path);
  if (!key) return [];
  return Array.from(propertyCardFootMounts.values()).filter((entry) => entry.path === key);
}

function propertyCardFootLiveMountsFor(path) {
  return propertyCardFootMountsFor(path).filter((entry) => {
    try {
      return entry.node && entry.node.isConnected !== false;
    } catch (_) {
      return false;
    }
  });
}

// Rename/delete events must not leak old-path state: renames carry the open
// state to the new path, deletes drop the path's mounts and state.
function propertyCardFootRenamePath(oldPath, newPath) {
  const from = propertyCardFootPath(oldPath);
  const to = propertyCardFootPath(newPath);
  if (!from || !to || from === to) return false;
  if (propertyCardFootOpenStates.get(from) === true) {
    propertyCardFootOpenStates.set(to, true);
  }
  propertyCardFootOpenStates.delete(from);
  for (const entry of propertyCardFootMounts.values()) {
    if (entry.path === from) entry.path = to;
  }
  return true;
}

function propertyCardFootReleasePath(path) {
  const key = propertyCardFootPath(path);
  if (!key) return false;
  propertyCardFootOpenStates.delete(key);
  for (const entry of Array.from(propertyCardFootMounts.values())) {
    if (entry.path === key) propertyCardFootUnregisterMount(entry.id);
  }
  return true;
}

// Unload/tests: drop every open state, mount, listener, and the editor hook.
function propertyCardFootResetAll() {
  propertyCardFootOpenStates.clear();
  propertyCardFootMounts.clear();
  propertyCardFootToggleListeners.clear();
  propertyCardFootEditorHook = null;
}

// Future editor hook for `=+` (editor-core): key labels and Enter invoke it
// only when registered. Unset in this phase; value links keep navigating.
function propertyCardFootSetEditorHook(hook) {
  propertyCardFootEditorHook = typeof hook === "function" ? hook : null;
  return propertyCardFootEditorHook;
}

function propertyCardFootOpenEditor(path, key, mode) {
  if (typeof propertyCardFootEditorHook !== "function") return false;
  try {
    propertyCardFootEditorHook(propertyCardFootPath(path), { key, mode });
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardFootRegisterPathResolver(resolver) {
  if (typeof resolver !== "function") return () => {};
  propertyCardFootPathResolvers.push(resolver);
  return () => {
    const index = propertyCardFootPathResolvers.indexOf(resolver);
    if (index >= 0) propertyCardFootPathResolvers.splice(index, 1);
  };
}

// Best-effort view path without an adapter resolver: Reading views carry
// the file; Source-mode fallbacks carry it in view state.
function propertyCardFootFallbackViewPath(view) {
  try {
    const direct = propertyCardFootPath(view?.file?.path);
    if (direct) return direct;
  } catch (_) {}
  try {
    const state = typeof view?.getState === "function" ? view.getState() : null;
    const fromState = propertyCardFootPath(state?.file);
    if (fromState) return fromState;
  } catch (_) {}
  return "";
}

function propertyCardFootViewPath(view) {
  for (const resolver of propertyCardFootPathResolvers) {
    try {
      const resolved = propertyCardFootPath(resolver(view));
      if (resolved) return resolved;
    } catch (_) {}
  }
  return propertyCardFootFallbackViewPath(view);
}

function propertyCardFootViewContains(view, node) {
  if (!view || !node) return false;
  const scopes = [view.dom, view.containerEl, view.contentEl];
  for (const scope of scopes) {
    if (!scope) continue;
    try {
      if (scope === node) return true;
      if (typeof scope.contains === "function" && scope.contains(node)) return true;
    } catch (_) {}
  }
  return false;
}

// Re-register a still-mounted foot the registry lost (teardown, split
// detach, transient model miss). Only connected feet inside this view whose
// foot-source matches the view path qualify, so hidden panes and stale
// mounts can never arm the toggle.
function propertyCardFootEnsureViewMount(view, path) {
  try {
    if (!view || !path) return false;
    if (propertyCardFootLiveMountsFor(path).some((entry) =>
      propertyCardFootViewContains(view, entry.node),
    )) return true;
    const scopes = [view.dom, view.containerEl, view.contentEl].filter(Boolean);
    if (!scopes.length) return false;
    let found = false;
    for (const scope of scopes) {
      let nodes = [];
      try {
        nodes = Array.from(scope.querySelectorAll?.(`.${PROPERTY_CARD_FOOT_CLASS}`) || []);
      } catch (_) {
        nodes = [];
      }
      try {
        if (scope.matches?.(`.${PROPERTY_CARD_FOOT_CLASS}`)) nodes.unshift(scope);
      } catch (_) {}
      for (const node of nodes) {
        try {
          if (!node || node.isConnected === false) continue;
          const rect = typeof node.getBoundingClientRect === "function" ? node.getBoundingClientRect() : null;
          if (!rect || rect.width <= 0 || rect.height <= 0) continue;
          if (propertyCardFootPath(node.getAttribute?.("data-foot-source") || "") !== path) continue;
        } catch (_) {
          continue;
        }
        try {
          propertyCardFootRegisterMount(node, path);
          found = true;
        } catch (_) {}
      }
      if (found) break;
    }
    return found;
  } catch (_) {
    return false;
  }
}

// The supplied view must itself contain a live foot for its current path.
// Another pane showing the same note is not enough to make a local gesture
// actionable, even though its open state is shared once either pane toggles.
// An orphaned mount (registry lost but foot still mounted) heals here so the
// toggle keeps working across teardowns that outlive the DOM.
function propertyCardCanToggleProperties(view) {
  try {
    if (!view) return false;
    const path = propertyCardFootViewPath(view);
    if (!path) return false;
    if (propertyCardFootLiveMountsFor(path).some((entry) =>
      propertyCardFootViewContains(view, entry.node),
    )) return true;
    if (!propertyCardFootEnsureViewMount(view, path)) return false;
    return propertyCardFootLiveMountsFor(path).some((entry) =>
      propertyCardFootViewContains(view, entry.node),
    );
  } catch (_) {
    return false;
  }
}

// Toggle the foot of the card mounted in the supplied view. Resolves the
// view's current path, then requires a connected mount carrying that path:
// mounts removed on replacement, path change, or failed paint are
// disconnected, and mounts from a previous file carry its old path, so
// neither can act. Open state is per path, so every live mount of the note
// (including a second pane) follows one toggle. Returns whether it acted.
function propertyCardToggleProperties(view) {
  try {
    if (!propertyCardCanToggleProperties(view)) return false;
    const path = propertyCardFootViewPath(view);
    propertyCardFootToggle(path);
    return true;
  } catch (_) {
    return false;
  }
}
