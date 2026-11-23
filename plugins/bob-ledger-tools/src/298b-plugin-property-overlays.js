// Confirmed post-image overlays for props writes. Null, empty string, empty
// list, false, zero, and absence stay distinct; deletions keep their keys
// rather than converting null to unset. Rendering never spawns bob or writes.
function propertyOverlayValuesEqual(left, right) {
  if (left === right) return true;
  if (left === undefined) left = null;
  if (right === undefined) right = null;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
}

function propertyOverlayCacheValue(frontmatter, key) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return { present: false, value: undefined };
  }
  if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
    return { present: false, value: undefined };
  }
  return { present: true, value: frontmatter[key] };
}

function propertyOverlayMatchesImage(overlay, image) {
  if (!overlay || !image) return false;
  const overlayRows = Array.isArray(overlay.properties) ? overlay.properties : [];
  const imageRows = Array.isArray(image.properties) ? image.properties : [];
  if (overlayRows.length !== imageRows.length) return false;
  for (let index = 0; index < overlayRows.length; index += 1) {
    const want = overlayRows[index];
    const have = imageRows[index];
    if (!want || !have || want.key !== have.key) return false;
    if (!propertyOverlayValuesEqual(want.value, have.value)) return false;
  }
  const overlayDeleted = Array.isArray(overlay.deletedKeys) ? overlay.deletedKeys : [];
  const imageDeleted = Array.isArray(image.deletedKeys) ? image.deletedKeys : [];
  if (overlayDeleted.length !== imageDeleted.length) return false;
  for (let index = 0; index < overlayDeleted.length; index += 1) {
    if (overlayDeleted[index] !== imageDeleted[index]) return false;
  }
  return true;
}

function propertyOverlayMatchesCache(overlay, frontmatter) {
  if (!overlay) return false;
  const rows = Array.isArray(overlay.properties) ? overlay.properties : [];
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || !row.key) continue;
    const actual = propertyOverlayCacheValue(frontmatter, row.key);
    if (!actual.present) return false;
    if (!propertyOverlayValuesEqual(row.value, actual.value)) return false;
  }
  for (const key of Array.isArray(overlay.deletedKeys) ? overlay.deletedKeys : []) {
    if (typeof key !== "string" || !key) continue;
    if (propertyOverlayCacheValue(frontmatter, key).present) return false;
  }
  return rows.length > 0 || (Array.isArray(overlay.deletedKeys) && overlay.deletedKeys.length > 0);
}

function createPropertyOverlayStore(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0
    ? options.ttlMs
    : PROPERTY_OVERLAY_TTL_MS;
  const setTimeoutFn = typeof options.setTimeout === "function" ? options.setTimeout : null;
  const clearTimeoutFn = typeof options.clearTimeout === "function" ? options.clearTimeout : null;
  const nowFn = typeof options.now === "function" ? options.now : () => Date.now();
  const overlays = new Map();
  const timers = new Map();
  const listeners = new Set();

  function keyOf(path) {
    return propertyNotePath(path);
  }

  function notify(path, overlay) {
    for (const listener of listeners) {
      try { listener(path, overlay || null); } catch (_) {}
    }
  }

  function clearTimer(key) {
    const timer = timers.get(key);
    timers.delete(key);
    if (timer === undefined || timer === null) return;
    if (clearTimeoutFn) {
      try { clearTimeoutFn(timer); } catch (_) {}
      return;
    }
    try { clearTimeout(timer); } catch (_) {}
  }

  function get(path) {
    const key = keyOf(path);
    if (!key) return null;
    return overlays.get(key) || null;
  }

  function retire(path, token) {
    const key = keyOf(path);
    if (!key) return null;
    const current = overlays.get(key);
    if (token && current && current.token !== token) return current;
    clearTimer(key);
    overlays.delete(key);
    notify(key, null);
    return null;
  }

  function push(path, overlay, extra = {}) {
    const key = keyOf(path);
    if (!key) return null;
    clearTimer(key);
    if (!overlay) {
      overlays.delete(key);
      notify(key, null);
      return null;
    }
    const token = extra.token || overlay.token || {};
    const record = {
      ...overlay,
      properties: propertyCloneJson(overlay.properties) || [],
      deletedKeys: Array.isArray(overlay.deletedKeys) ? overlay.deletedKeys.slice() : [],
      before: overlay.before ? {
        properties: propertyCloneJson(overlay.before.properties) || [],
        deletedKeys: Array.isArray(overlay.before.deletedKeys) ? overlay.before.deletedKeys.slice() : [],
      } : null,
      fingerprint: typeof overlay.fingerprint === "string" ? overlay.fingerprint : "",
      token,
      publishedAt: nowFn(),
    };
    overlays.set(key, record);
    notify(key, record);
    const ttl = Number.isFinite(extra.ttlMs) && extra.ttlMs >= 0 ? extra.ttlMs : ttlMs;
    if (ttl === 0) return record;
    const schedule = setTimeoutFn || setTimeout;
    const timer = schedule(() => {
      timers.delete(key);
      const current = overlays.get(key);
      if (current && current.token === token) {
        overlays.delete(key);
        notify(key, null);
      }
    }, ttl);
    if (timer !== undefined && timer !== null) timers.set(key, timer);
    return record;
  }

  function observeSource(path, properties) {
    const current = get(path);
    if (!current) return null;
    const rows = Array.isArray(properties) ? properties : [];
    const image = { properties: rows, deletedKeys: [] };
    if (propertyOverlayMatchesImage(current, image)) return retire(path, current.token);
    if (current.before && propertyOverlayMatchesImage(current.before, image)) return current;
    const frontmatter = {};
    for (const row of rows) {
      if (row && typeof row.key === "string" && row.key) frontmatter[row.key] = row.value;
    }
    return observeCache(path, frontmatter);
  }

  function observeCache(path, frontmatter) {
    const current = get(path);
    if (!current) return null;
    if (propertyOverlayMatchesCache(current, frontmatter)) return retire(path, current.token);
    if (current.before && propertyOverlayMatchesCache(current.before, frontmatter)) return current;
    return retire(path, current.token);
  }

  function migrate(fromPath, toPath) {
    const from = keyOf(fromPath);
    const to = keyOf(toPath);
    if (!from || from === to) return;
    const record = overlays.get(from);
    const timer = timers.get(from);
    overlays.delete(from);
    timers.delete(from);
    notify(from, null);
    if (!to) {
      if (timer !== undefined && timer !== null) {
        if (clearTimeoutFn) try { clearTimeoutFn(timer); } catch (_) {}
        else try { clearTimeout(timer); } catch (_) {}
      }
      return;
    }
    if (record) {
      overlays.set(to, record);
      if (timer !== undefined && timer !== null) timers.set(to, timer);
      notify(to, record);
    }
  }

  function release(path) {
    retire(path);
  }

  function clear() {
    for (const key of [...overlays.keys()]) retire(key);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return {
    ttlMs,
    get,
    push,
    retire,
    observeSource,
    observeCache,
    migrate,
    release,
    clear,
    subscribe,
  };
}
