// Shared property-card ownership: one card mount owns selected native
// Properties rows in one native view scope. Desktop-only Reading or Live
// Preview, restricted to the exact successfully rendered card's native
// container. Source, embeds, hover popovers, failed mounts, and teardown
// keep native fields. Generalizes the record sheet observer.
const PROPERTY_CARD_OWNED_PROPERTY_CLASS = "bob-property-card-owned-property";
// Record compatibility: existing assertions expect this class on owned rows.
// The shared painter tags both classes so the generalized owner preserves
// the proven record selectors while album and bank hide through the shared
// class with bounded owned-row rules.
const PROPERTY_CARD_LEGACY_RECORD_OWNED_CLASS = "bob-record-sheet-owned-property";

const propertyCardOwnerships = new WeakMap();
let propertyCardOwnershipGeneration = 0;

function propertyCardScopeIsEmbed(node) {
  try {
    return Boolean(node && typeof node.closest === "function"
      && node.closest(".markdown-embed, .internal-embed, .hover-popover"));
  } catch (_) {
    return false;
  }
}

function propertyCardDesktop() {
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === false) return false;
  } catch (_) {}
  return true;
}

function propertyCardNativeContainer(scope) {
  const child = (root, name) => Array.from(root?.children || [])
    .find((node) => node.classList?.contains(name));
  try {
    if (scope?.classList?.contains("cm-editor")) {
      return child(child(child(scope, "cm-scroller"), "cm-sizer"), "metadata-container");
    }
    if (scope?.classList?.contains("markdown-preview-view")) {
      return child(child(child(scope, "markdown-preview-sizer"), "mod-header"), "metadata-container");
    }
  } catch (_) {
    return null;
  }
  return null;
}

function propertyCardDeniedScope(scope) {
  if (!scope || typeof scope.closest !== "function") return true;
  if (propertyCardScopeIsEmbed(scope)) return true;
  try {
    if (scope.classList?.contains("cm-editor")) return propertyCardDesktop() !== true;
    if (scope.classList?.contains("markdown-preview-view")) return propertyCardDesktop() !== true;
  } catch (_) {
    return true;
  }
  return true;
}

function propertyCardNormalizeKeys(keys) {
  const out = new Set();
  try {
    const list = keys instanceof Set ? Array.from(keys) : Array.from(keys || []);
    for (const key of list) {
      if (typeof key === "string" && key.length > 0) out.add(key);
    }
  } catch (_) {}
  return out;
}

function propertyCardUntag(rows) {
  for (const row of rows || []) {
    try { row.classList?.remove(PROPERTY_CARD_OWNED_PROPERTY_CLASS); } catch (_) {}
    try { row.classList?.remove(PROPERTY_CARD_LEGACY_RECORD_OWNED_CLASS); } catch (_) {}
  }
}

function propertyCardPaintScope(scope) {
  const entry = propertyCardOwnerships.get(scope);
  if (!entry) return;
  const container = propertyCardNativeContainer(scope);
  const next = new Set();
  try {
    for (const row of container?.querySelectorAll?.(".metadata-property") || []) {
      try {
        if (row.closest?.(".metadata-container") !== container) continue;
        if (propertyCardScopeIsEmbed(row)) continue;
        const key = row.getAttribute?.("data-property-key");
        if (!entry.keys.has(key)) continue;
        next.add(row);
        if (!row.classList?.contains(PROPERTY_CARD_OWNED_PROPERTY_CLASS)) row.classList?.add(PROPERTY_CARD_OWNED_PROPERTY_CLASS);
        if (!row.classList?.contains(PROPERTY_CARD_LEGACY_RECORD_OWNED_CLASS)) row.classList?.add(PROPERTY_CARD_LEGACY_RECORD_OWNED_CLASS);
      } catch (_) {}
    }
  } catch (_) {}
  for (const row of entry.rows) {
    if (!next.has(row)) {
      try { row.classList?.remove(PROPERTY_CARD_OWNED_PROPERTY_CLASS); } catch (_) {}
      try { row.classList?.remove(PROPERTY_CARD_LEGACY_RECORD_OWNED_CLASS); } catch (_) {}
    }
  }
  entry.rows = next;
}

function propertyCardReleaseScope(scope) {
  const entry = propertyCardOwnerships.get(scope);
  if (!entry) return;
  try { entry.observer?.disconnect(); } catch (_) {}
  propertyCardUntag(entry.rows);
  entry.rows = new Set();
  entry.keys = new Set();
  propertyCardOwnerships.delete(scope);
}

// Own one card mount's keys in one native view scope. New keys replace the
// owner's old set. Returns an idempotent release handle bound to this mount
// generation: an old unload/release cannot clear a newer mount.
function propertyCardOwnKeys(scope, keys) {
  const noop = () => {};
  const normalized = propertyCardNormalizeKeys(keys);
  if (propertyCardDeniedScope(scope)) {
    propertyCardReleaseScope(scope);
    return noop;
  }
  if (normalized.size === 0) {
    propertyCardReleaseScope(scope);
    return noop;
  }
  let entry = propertyCardOwnerships.get(scope);
  propertyCardOwnershipGeneration += 1;
  const generation = propertyCardOwnershipGeneration;
  if (!entry) {
    entry = { generation, rows: new Set(), keys: normalized, observer: null };
    propertyCardOwnerships.set(scope, entry);
    try {
      const Observer = scope.ownerDocument?.defaultView?.MutationObserver;
      if (Observer) {
        const seen = entry;
        seen.observer = new Observer(() => {
          const current = propertyCardOwnerships.get(scope);
          if (current !== seen) return;
          propertyCardPaintScope(scope);
        });
        seen.observer.observe(scope, {
          childList: true, subtree: true, attributes: true, attributeFilter: ["data-property-key"],
        });
      }
    } catch (_) {
      entry.observer = null;
    }
  } else {
    entry.generation = generation;
    entry.keys = normalized;
  }
  propertyCardPaintScope(scope);
  return () => {
    const current = propertyCardOwnerships.get(scope);
    if (!current || current.generation !== generation) return;
    try { current.observer?.disconnect(); } catch (_) {}
    propertyCardUntag(current.rows);
    current.rows = new Set();
    current.keys = new Set();
    propertyCardOwnerships.delete(scope);
  };
}

function propertyCardOwnAlbumKeys(scope, desktop) {
  try {
    if (desktop !== true) {
      try { propertyCardReleaseScope(scope); } catch (_) {}
      return null;
    }
    return propertyCardOwnKeys(scope, ["record"]);
  } catch (_) {
    try { propertyCardReleaseScope(scope); } catch (_) {}
    return null;
  }
}

function propertyCardOwnBankKeys(scope, desktop) {
  try {
    if (desktop !== true) {
      try { propertyCardReleaseScope(scope); } catch (_) {}
      return null;
    }
    return propertyCardOwnKeys(scope, ["bank"]);
  } catch (_) {
    try { propertyCardReleaseScope(scope); } catch (_) {}
    return null;
  }
}
