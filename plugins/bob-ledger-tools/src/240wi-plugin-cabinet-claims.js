// Cabinet ownership claims (bob-cli-qq absorption): fingerprinted claims
// that one mounted cabinet stands in for one stored catalog region in one
// view. Invariant: a valid stored catalog is never hidden without a working
// cabinet for it in that view. Claims are bound to a mount generation and
// released on unmount, file change, mode change, and unload; a fingerprint
// mismatch reads as unclaimed. Never throws.
const PROPERTY_CARD_CABINET_CLAIMS = new WeakMap();
const PROPERTY_CARD_CABINET_CLAIM_VIEWS = new Set();
const PROPERTY_CARD_CABINET_STAND_DOWN_CLASS = "bob-property-card-cabinets";

function propertyCardCatalogClaimStore(view, create) {
  if (!view || (typeof view !== "object" && typeof view !== "function")) return null;
  let store = PROPERTY_CARD_CABINET_CLAIMS.get(view);
  if (!store && create) {
    store = new Map();
    PROPERTY_CARD_CABINET_CLAIMS.set(view, store);
    PROPERTY_CARD_CABINET_CLAIM_VIEWS.add(view);
  }
  return store || null;
}

// Claim one region for one mounted cabinet. `reveal` opens the cabinet and
// scrolls its header into view. Returns a release function; releasing twice
// is a no-op. Never throws.
function propertyCardCatalogClaim(options) {
  const noop = () => {};
  try {
    const { view, path, kind, fingerprint, generation, reveal } = options || {};
    if (!view || typeof path !== "string" || typeof kind !== "string") return noop;
    const store = propertyCardCatalogClaimStore(view, true);
    if (!store) return noop;
    const key = `${path}\u0000${kind}`;
    const claim = {
      path,
      kind,
      fingerprint: fingerprint == null ? null : String(fingerprint),
      generation: generation == null ? null : generation,
      reveal: typeof reveal === "function" ? reveal : null,
      released: false,
    };
    store.set(key, claim);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try {
        claim.released = true;
        if (store.get(key) === claim) store.delete(key);
      } catch (_) {}
    };
  } catch (_) {
    return noop;
  }
}

function propertyCardCatalogClaimEntry(view, path, kind) {
  try {
    const store = propertyCardCatalogClaimStore(view, false);
    if (!store) return null;
    return store.get(`${path}\u0000${kind}`) || null;
  } catch (_) {
    return null;
  }
}

// True when a live claim covers `path`/`kind` in `view`: mounted, not
// released, generation matches, and fingerprint matches.
function propertyCardCatalogClaimed(view, path, kind, fingerprint, generation) {
  try {
    const claim = propertyCardCatalogClaimEntry(view, path, kind);
    if (!claim || claim.released) return false;
    if (generation !== undefined && claim.generation !== generation) return false;
    if (fingerprint != null && claim.fingerprint !== String(fingerprint)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// True when `view` (or an element inside it) has a live claim covering
// `path`/`kind`. Painters use this to stand down inline painting.
function propertyCardCatalogAbsorbed(viewOrEl, path, kind) {
  try {
    if (!viewOrEl) return false;
    if (PROPERTY_CARD_CABINET_CLAIMS.has(viewOrEl)) {
      return propertyCardCatalogClaimEntry(viewOrEl, path, kind) != null
        && !propertyCardCatalogClaimEntry(viewOrEl, path, kind).released;
    }
    if (typeof viewOrEl.closest === "function") {
      const view = viewOrEl.closest("[data-bob-cabinet-view]");
      if (view && propertyCardCatalogClaimEntry(view, path, kind)) {
        const claim = propertyCardCatalogClaimEntry(view, path, kind);
        return !claim.released;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

// The painter stand-down check: skip inline painting when the node already
// lives inside a cabinet body or an absorbed claim covers it.
function propertyCardCabinetStandDown(el, view, path, kind) {
  try {
    if (el && typeof el.closest === "function") {
      try {
        if (el.closest(`.${PROPERTY_CARD_CABINET_STAND_DOWN_CLASS}`)) return true;
      } catch (_) {}
    }
    if (view && path && kind) return propertyCardCatalogAbsorbed(view, path, kind);
    return false;
  } catch (_) {
    return false;
  }
}

// Run the claim's reveal (open the cabinet, scroll its head into view) for
// heading navigation into a hidden range. Returns whether it opened the cabinet.
function propertyCardCatalogRevealClaim(view, path, kind) {
  try {
    const claim = propertyCardCatalogClaimEntry(view, path, kind);
    if (!claim || claim.released || typeof claim.reveal !== "function") return false;
    return claim.reveal() === true;
  } catch (_) {
    return false;
  }
}

// Release every claim held for one view (unmount, file change, mode change).
function propertyCardCatalogReleaseScope(view) {
  try {
    const store = propertyCardCatalogClaimStore(view, false);
    if (!store) return 0;
    let count = 0;
    for (const claim of store.values()) {
      try {
        claim.released = true;
        count += 1;
      } catch (_) {}
    }
    store.clear();
    return count;
  } catch (_) {
    return 0;
  }
}

// Live claims for one note path across every tracked view. Used by the
// shared host to re-tag Reading absorption after a targeted preview
// re-render. Released claims are omitted. Never throws.
function propertyCardCatalogClaimsForPath(path) {
  const found = [];
  try {
    if (typeof path !== "string" || !path) return found;
    for (const view of [...PROPERTY_CARD_CABINET_CLAIM_VIEWS]) {
      const store = propertyCardCatalogClaimStore(view, false);
      if (!store) continue;
      for (const claim of store.values()) {
        if (!claim || claim.released) continue;
        if (claim.path === path) found.push(claim);
      }
    }
  } catch (_) {}
  return found;
}

// Release every claim everywhere (plugin unload). Returns the count.
function propertyCardCatalogReleaseAll() {
  try {
    let count = 0;
    for (const view of [...PROPERTY_CARD_CABINET_CLAIM_VIEWS]) {
      try {
        count += propertyCardCatalogReleaseScope(view);
      } catch (_) {}
    }
    return count;
  } catch (_) {
    return 0;
  }
}
