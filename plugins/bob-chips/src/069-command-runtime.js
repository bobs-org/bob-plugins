// The plugin-owned command-chip runtime: the shared run store, a bounded
// resolve cache, and one catalog-change subscription fanned out to every
// renderer. Painting reads only cached, synchronous data: it never starts a
// catalog load, never spawns, and never writes.
const COMMAND_CHIP_RESOLVE_CACHE_MAX = 512;
const COMMAND_CHIP_CATALOG_EVENT = "bob-command-mode:catalog-changed";

function commandChipCatalogToken(engine) {
  try {
    if (engine && typeof engine.catalogInfo === "function") {
      const info = engine.catalogInfo();
      if (info && info.token !== undefined && info.token !== null) return String(info.token);
    }
  } catch (error) {
    // An unreadable token never matches a cached one.
  }
  return "";
}

// Resolve verdicts keyed by engine instance, catalog token, and exact
// payload. A `loading` verdict is never cached, so a chip repaints as soon
// as the catalog arrives; a new engine or token drops every entry.
class CommandChipResolveCache {
  constructor(max) {
    this.max = Number(max) > 0 ? Number(max) : COMMAND_CHIP_RESOLVE_CACHE_MAX;
    this.engine = null;
    this.token = null;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(engine, text) {
    try {
      if (!engine || typeof engine.resolve !== "function" || typeof text !== "string") return null;
      const token = commandChipCatalogToken(engine);
      if (engine !== this.engine || token !== this.token) {
        this.map.clear();
        this.engine = engine;
        this.token = token;
      }
      if (this.map.has(text)) {
        const cached = this.map.get(text);
        this.map.delete(text);
        this.map.set(text, cached);
        this.hits += 1;
        return cached;
      }
      this.misses += 1;
      const verdict = commandChipFreshResolve(engine, text);
      if (verdict.state !== "loading") {
        this.map.set(text, verdict);
        while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      }
      return verdict;
    } catch (error) {
      return null;
    }
  }

  clear() {
    this.map.clear();
    this.engine = null;
    this.token = null;
  }

  stats() {
    return copyChipFreeze({ hits: this.hits, misses: this.misses, size: this.map.size, token: this.token });
  }
}

// A fresh, uncached engine verdict. Never throws.
function commandChipFreshResolve(engine, text) {
  try {
    const verdict = engine.resolve(text);
    if (verdict && typeof verdict === "object" && typeof verdict.state === "string") return verdict;
  } catch (error) {
    // Fall through to the generic refusal.
  }
  return copyChipFreeze({
    ok: false,
    state: "invalid",
    signature: null,
    steps: copyChipFreeze([]),
    reason: "command could not be resolved",
    step: null,
  });
}

function commandChipRuntimeOf(plugin) {
  try {
    const runtime = plugin && plugin.commandChipRuntime;
    return runtime && !runtime.disposed ? runtime : null;
  } catch (error) {
    return null;
  }
}

function commandChipCatalogChanged(runtime, payload) {
  if (!runtime || runtime.disposed) return;
  runtime.cache.clear();
  for (const token of [...runtime.catalogListeners]) commandChipCallListener(token.listener, payload || null);
}

// Idempotent per plugin. `options.store` passes test timers to the store.
function commandChipRuntimeSetup(plugin, options) {
  try {
    if (!plugin) return null;
    const existing = commandChipRuntimeOf(plugin);
    if (existing) return existing;
    const opts = options && typeof options === "object" ? options : {};
    const runtime = {
      store: new CommandChipRunStore(opts.store),
      cache: new CommandChipResolveCache(opts.cacheMax),
      catalogListeners: new Set(),
      catalogRef: null,
      workspace: null,
      disposed: false,
    };
    plugin.commandChipRuntime = runtime;
    try {
      const workspace = plugin.app && plugin.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        const ref = workspace.on(COMMAND_CHIP_CATALOG_EVENT, (payload) => commandChipCatalogChanged(runtime, payload));
        runtime.catalogRef = ref || null;
        runtime.workspace = workspace;
        if (ref && typeof plugin.registerEvent === "function") plugin.registerEvent(ref);
      }
    } catch (error) {
      // Without the event, verdicts still refresh on token or engine change.
    }
    return runtime;
  } catch (error) {
    return null;
  }
}

// Unload: stop every timer, latch, listener, and the catalog subscription.
// In-flight engine callbacks become no-ops; runs themselves continue.
function commandChipRuntimeDispose(plugin) {
  try {
    const runtime = plugin && plugin.commandChipRuntime;
    if (!runtime) return;
    plugin.commandChipRuntime = null;
    if (runtime.disposed) return;
    runtime.disposed = true;
    try {
      if (runtime.catalogRef && runtime.workspace && typeof runtime.workspace.offref === "function") {
        runtime.workspace.offref(runtime.catalogRef);
      }
    } catch (error) {
      // Obsidian's registerEvent also detaches the ref on unload.
    }
    runtime.catalogRef = null;
    runtime.workspace = null;
    runtime.catalogListeners.clear();
    runtime.cache.clear();
    runtime.store.dispose();
  } catch (error) {
    // Disposal never throws.
  }
}

// Renderers repaint loading and refused faces here. One plugin-level
// subscription feeds every listener; returns an idempotent unsubscribe.
function commandChipOnCatalogChanged(plugin, listener) {
  const runtime = commandChipRuntimeOf(plugin);
  if (!runtime || typeof listener !== "function") return () => {};
  const token = { listener };
  runtime.catalogListeners.add(token);
  return () => {
    runtime.catalogListeners.delete(token);
  };
}

function commandChipStoreOf(plugin) {
  const runtime = commandChipRuntimeOf(plugin);
  return runtime ? runtime.store : null;
}

// The face a chip shows, from data already in hand. `copy` wins (the click
// copies); recorded run ink comes next, so a run started before a catalog
// change still shows; then the verdict: `loading`, `unavailable` (invalid or
// unavailable, click explains), or `ready` / `armed`. `pending` paints as
// resting: a card handoff never shows a spinner.
function commandChipFaceState(model) {
  try {
    const m = model && typeof model === "object" ? model : {};
    if (!m.policy || m.policy.mode !== "run") return "copy";
    const state = m.snapshot && m.snapshot.state;
    if (state === "queued" || state === "running" || state === "completed" || state === "attention" || state === "failed") {
      return state;
    }
    const verdict = m.verdict;
    if (!verdict || verdict.state === "loading") return "loading";
    if (verdict.state !== "ready") return "unavailable";
    return m.armed ? "armed" : "ready";
  } catch (error) {
    return "copy";
  }
}

// Everything one face needs for `chip` ({ label, text, form, line, from,
// to, fence? }) in activation context `ctx`, computed without side effects:
// frozen `{ face, mode, reason, verdict, key, snapshot, armed, sourcePath }`.
// `reason` explains copy-only or unavailable faces. Renderers subscribe to
// `key` in the store and to commandChipOnCatalogChanged, then call this
// again to repaint.
function commandChipPaintModel(plugin, chip, ctx) {
  try {
    const runtime = commandChipRuntimeOf(plugin);
    const text = chip && typeof chip.text === "string" ? chip.text : "";
    const app = plugin && plugin.app;
    const policy = runtime ? commandChipEligibility(app, ctx) : copyChipFreeze({
      mode: "copy", reason: "Bob Chips is not loaded", sourcePath: null, engine: null,
    });
    const verdict = policy.mode === "run" ? runtime.cache.get(policy.engine, text) : null;
    const key = commandChipStoreKey(verdict, text);
    const store = runtime ? runtime.store : null;
    const snapshot = store ? store.snapshot(key) : null;
    const identity = chip && typeof chip === "object" ? { ...chip, sourcePath: policy.sourcePath } : null;
    const armed = Boolean(store && policy.mode === "run" && store.isArmed(identity));
    const face = commandChipFaceState({ policy, verdict, snapshot, armed });
    let reason = null;
    if (face === "copy") reason = policy.reason;
    else if (face === "unavailable") reason = verdict && verdict.reason ? String(verdict.reason) : null;
    else if (face === "failed" || face === "attention") reason = snapshot && snapshot.reason;
    return copyChipFreeze({
      face,
      mode: policy.mode,
      reason: reason === undefined ? null : reason,
      verdict,
      key,
      snapshot,
      armed,
      sourcePath: policy.sourcePath,
    });
  } catch (error) {
    return copyChipFreeze({
      face: "copy",
      mode: "copy",
      reason: COMMAND_CHIP_SOURCE_UNKNOWN,
      verdict: null,
      key: commandChipStoreKey(null, chip && chip.text),
      snapshot: null,
      armed: false,
      sourcePath: null,
    });
  }
}
