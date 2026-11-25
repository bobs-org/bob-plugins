// Last-confirmed metadata cache for property-card painters. Obsidian's
// getFileCache returns null between a vault write and the following
// `changed` event while the note re-parses. Card painters and the
// ownership gate read this hold instead of treating that gap as "not a
// card". Evidence still compares current source against a cache Obsidian
// produced; a real frontmatter change still mismatches and fails open.
// Never monkeypatches app.metadataCache.
const PROPERTY_CARD_SETTLED_CACHE_HOLD_MS = 2000;
const PROPERTY_CARD_SETTLED_CACHE_BOUND_FLAG = "_propertyCardSettledCacheBound";
const propertyCardSettledCaches = new Map();
const propertyCardSettledCacheFacades = new WeakMap();

function propertyCardSettledCachePath(file) {
  try { return String(file?.path || "").replace(/\\/g, "/"); } catch (_) { return ""; }
}

function propertyCardSettledCacheRemember(file, cache) {
  const path = propertyCardSettledCachePath(file);
  if (!path || cache == null) return;
  propertyCardSettledCaches.set(path, { file, cache, pendingSince: null });
}

function propertyCardSettledCacheDrop(path) {
  const key = String(path || "").replace(/\\/g, "/");
  if (key) propertyCardSettledCaches.delete(key);
}

function propertyCardSettledFileCache(app, file) {
  try {
    if (!file) return null;
    const live = app?.metadataCache?.getFileCache?.(file);
    if (live != null) {
      propertyCardSettledCacheRemember(file, live);
      return live;
    }
    const path = propertyCardSettledCachePath(file);
    const entry = path ? propertyCardSettledCaches.get(path) : null;
    if (!entry) return null;
    if (entry.file !== file) return null;
    if (app?.vault?.getAbstractFileByPath?.(file.path) !== file) return null;
    const now = Date.now();
    if (entry.pendingSince == null) entry.pendingSince = now;
    if (now - entry.pendingSince > PROPERTY_CARD_SETTLED_CACHE_HOLD_MS) return null;
    return entry.cache;
  } catch (_) {
    return null;
  }
}

function propertyCardSettledMetadataCache(app) {
  const real = app?.metadataCache;
  if (!real) return real;
  const existing = propertyCardSettledCacheFacades.get(real);
  if (existing) return existing;
  const facade = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "getFileCache") {
        return (file) => propertyCardSettledFileCache(app, file);
      }
      if (prop === "getCache") {
        return (path) => {
          try {
            const file = app?.vault?.getAbstractFileByPath?.(path);
            return file ? propertyCardSettledFileCache(app, file) : null;
          } catch (_) {
            return null;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  propertyCardSettledCacheFacades.set(real, facade);
  return facade;
}

function propertyCardSettledCacheBind(plugin) {
  if (!plugin || plugin[PROPERTY_CARD_SETTLED_CACHE_BOUND_FLAG] === true) return false;
  plugin[PROPERTY_CARD_SETTLED_CACHE_BOUND_FLAG] = true;
  const bindEvent = (emitter, name, handler) => {
    try {
      if (emitter && typeof emitter.on === "function" && typeof plugin.registerEvent === "function") {
        plugin.registerEvent(emitter.on(name, handler));
      }
    } catch (_) {}
  };
  bindEvent(plugin.app?.metadataCache, "changed", (file, _data, cache) => {
    try {
      const recorded = cache != null ? cache : plugin.app?.metadataCache?.getFileCache?.(file);
      propertyCardSettledCacheRemember(file, recorded);
    } catch (_) {}
  });
  bindEvent(plugin.app?.vault, "modify", (file) => {
    try {
      const live = plugin.app?.metadataCache?.getFileCache?.(file);
      if (live != null) propertyCardSettledCacheRemember(file, live);
    } catch (_) {}
  });
  bindEvent(plugin.app?.vault, "rename", (_file, oldPath) => {
    propertyCardSettledCacheDrop(oldPath);
  });
  bindEvent(plugin.app?.vault, "delete", (file) => {
    propertyCardSettledCacheDrop(file?.path);
  });
  return true;
}

function propertyCardSettledCacheReset() {
  propertyCardSettledCaches.clear();
}
