// Property capability routing: session-and-bob-path capability cache,
// actual-ownership query, and the native Add file property entry route
// (bob-cli-pf.6.1.2 capability-routing). Adapters stay unwired: nothing here
// acquires ownership; it only observes it and routes native entries.
//
// The controller caches one outcome per resolved bob path for the plugin
// session: confirmed (bob answered props_v1), absent (unknown subcommand),
// or unconfirmed (transient note, I/O, or shape failures keep native
// available without revoking a confirmed path). Probes are read-only
// `bob props show` runs scheduled from setup and workspace lifecycle events
// only, never from paint or build functions, with one in-flight probe per
// key, bounded retries, and stale/path-changed results discarded.
//
// The Add file property command wrapper (S1 id
// `markdown:add-metadata-property`) routes currently owned document scopes
// to openPropertyEditor({ filePath, mode: "add" }) and delegates untouched
// scopes to the original callback with its context, arguments, and check
// semantics intact. If the opener fails on an owned scope, the scope is
// released before the native fallback so the focused input is visible.
// Teardown restores only this wrapper, preserving wrappers installed later
// by another plugin.
const PROPERTY_CAPABILITY_COMMAND_ID = "markdown:add-metadata-property";
const PROPERTY_CAPABILITY_COMMAND_NAME = "Add file property";
const PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS = 3;

// Normalize one resolved bob path to its session cache key. Never throws.
function propertyCapabilityBobKey(resolved) {
  try {
    const path = resolved && typeof resolved.path === "string" && resolved.path
      ? resolved.path
      : "bob";
    const source = resolved && typeof resolved.source === "string" && resolved.source
      ? resolved.source
      : "path";
    return `${source}:${path}`;
  } catch (_) {
    return "path:bob";
  }
}

// Classify one show probe outcome without touching the cache. Unknown
// subcommand output means an old bob (absent); malformed reports and
// transient note or I/O failures stay unconfirmed and keep native.
function propertyCapabilityClassifyProbe(outcome) {
  try {
    if (!outcome || typeof outcome !== "object") return { status: "unconfirmed", reason: "no-outcome" };
    if (outcome.ok === true && outcome.report && typeof outcome.report === "object") {
      if (outcome.report.ok === true) {
        return typeof propertyHasCapability === "function" && propertyHasCapability(outcome.report)
          ? { status: "confirmed" }
          : { status: "absent", reason: "missing-capability" };
      }
      const code = outcome.report.error && outcome.report.error.code;
      return { status: "unconfirmed", reason: typeof code === "string" && code ? code : "report-error" };
    }
    if (outcome.code === "needs-bob") return { status: "absent", reason: "needs-bob" };
    return { status: "unconfirmed", reason: typeof outcome.code === "string" && outcome.code ? outcome.code : "probe-failed" };
  } catch (_) {
    return { status: "unconfirmed", reason: "classify-failed" };
  }
}

// The read-only probe argv. Painting never spawns; this runs only from
// lifecycle scheduling.
function propertyCapabilityProbeArgs(notePath) {
  try {
    if (typeof propertyShowArgs === "function") return propertyShowArgs(notePath);
  } catch (_) {}
  return ["props", "show", String(notePath || ""), "-f", "json"];
}

// Pick the usable open Markdown note for the probe without manufacturing
// one and without walking the vault: an explicit usable path wins, then the
// active note. Returns "" when no note is open yet; the scheduler retries on
// a later lifecycle event. Vault walks are forbidden here so setup-time
// scheduling never perturbs vault-walk budgets.
function propertyCapabilityEligibleNotePath(app, preferredPath) {
  const isMarkdown = (value) => typeof value === "string" && /\.md$/i.test(value);
  const normalize = (value) => {
    try {
      if (typeof propertyNotePath === "function") return propertyNotePath(value);
    } catch (_) {}
    return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  };
  const exists = (path) => {
    try {
      return Boolean(path && app && app.vault && typeof app.vault.getAbstractFileByPath === "function"
        && app.vault.getAbstractFileByPath(path));
    } catch (_) {
      return false;
    }
  };
  try {
    if (isMarkdown(preferredPath)) {
      const path = normalize(preferredPath);
      if (path && exists(path)) return path;
    }
  } catch (_) {}
  try {
    let active = "";
    try {
      const view = typeof getActiveMarkdownView === "function" ? getActiveMarkdownView(app) : null;
      active = (view && view.file && view.file.path) || "";
    } catch (_) {
      active = "";
    }
    if (!active) {
      try {
        active = (app && app.workspace && app.workspace.activeLeaf
          && app.workspace.activeLeaf.view && app.workspace.activeLeaf.view.file
          && app.workspace.activeLeaf.view.file.path) || "";
      } catch (_) {
        active = "";
      }
    }
    if (isMarkdown(active)) {
      const path = normalize(active);
      if (path && exists(path)) return path;
    }
  } catch (_) {}
  return "";
}

// Locate the registered Add file property command. Never throws.
function propertyCapabilityCommandTarget(app) {
  try {
    const commands = app && app.commands;
    const table = commands && commands.commands;
    if (!commands || !table) return null;
    const command = table[PROPERTY_CAPABILITY_COMMAND_ID];
    if (!command) return null;
    return { commands, command };
  } catch (_) {
    return null;
  }
}

class BobLedgerToolsPropertyCapabilityRoutingMixin {
  setupPropertyCapabilityRouting() {
    if (this.propertyCapabilityRoutingActive === true) return;
    this.propertyCapabilityRoutingActive = true;
    this.propertyCapabilityGeneration = (this.propertyCapabilityGeneration || 0) + 1;
    this.propertyCapabilityByBobPath = new Map();
    this.propertyCapabilityFlight = null;
    this.propertyCapabilityProbePending = "";
    this.propertyCapabilityCommandRoute = null;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(workspace.on("active-leaf-change", () => {
          try { this.schedulePropertyCapabilityProbe("active-leaf-change"); } catch (_) {}
        }));
        this.registerEvent(workspace.on("file-open", () => {
          try { this.schedulePropertyCapabilityProbe("file-open"); } catch (_) {}
        }));
      }
    } catch (_) {}
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => {
          try { this.schedulePropertyCapabilityProbe("layout-ready"); } catch (_) {}
        });
      }
    } catch (_) {}
    try { this.propertyCapabilityInstallCommandRoute(); } catch (_) {}
    try { this.schedulePropertyCapabilityProbe("setup"); } catch (_) {}
  }

  teardownPropertyCapabilityRouting() {
    this.propertyCapabilityRoutingActive = false;
    this.propertyCapabilityGeneration = (this.propertyCapabilityGeneration || 0) + 1;
    this.propertyCapabilityFlight = null;
    this.propertyCapabilityProbePending = "";
    try { this.propertyCapabilityRestoreCommandRoute(); } catch (_) {}
    try {
      if (this.propertyCapabilityByBobPath instanceof Map) this.propertyCapabilityByBobPath.clear();
    } catch (_) {}
    this.propertyCapabilityByBobPath = new Map();
    this.propertyCapabilityCommandRoute = null;
  }

  propertyCapabilityCurrentBobKey() {
    try {
      const resolved = typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : null;
      return propertyCapabilityBobKey(resolved);
    } catch (_) {
      return "path:bob";
    }
  }

  propertyCapabilityState(key) {
    try {
      const lookup = typeof key === "string" && key ? key : this.propertyCapabilityCurrentBobKey();
      const entry = this.propertyCapabilityByBobPath instanceof Map
        ? this.propertyCapabilityByBobPath.get(lookup)
        : null;
      if (!entry) return { status: "unknown", attempts: 0, reason: "", key: lookup };
      return {
        status: entry.status || "unknown",
        attempts: entry.attempts || 0,
        reason: entry.reason || "",
        key: lookup,
      };
    } catch (_) {
      return { status: "unknown", attempts: 0, reason: "", key: "" };
    }
  }

  propertyCapabilityConfirmed(key) {
    try {
      return this.propertyCapabilityState(key).status === "confirmed";
    } catch (_) {
      return false;
    }
  }

  // Failure to establish routing must prevent ownership: adapters gate on
  // this, so a missing command or a superseded wrapper reads as not ready.
  propertyCapabilityRoutingReady() {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return false;
      const route = this.propertyCapabilityCommandRoute;
      if (!route || !route.wrapper) return false;
      const target = propertyCapabilityCommandTarget(this.app);
      const command = target && target.command;
      if (!command) return false;
      return (route.kind === "callback" ? command.callback : command.checkCallback) === route.wrapper;
    } catch (_) {
      return false;
    }
  }

  // Single write path for show outcomes: apiPropertyShow and the probe
  // settle here. Confirmed and absent update the current path entry and
  // mirror the legacy single value the editor display reads; unconfirmed
  // per-note failures never touch the cache, so they cannot revoke a
  // confirmed path. Probe attempts are counted by the settle path, not
  // here. When routing is inactive the legacy single-value behavior
  // applies unchanged.
  propertyCapabilityNoteShowOutcome(outcome) {
    try {
      if (this.propertyCapabilityRoutingActive !== true) {
        if (outcome && outcome.ok === false && outcome.code === "needs-bob") {
          try { this.propertyCapability = false; } catch (_) {}
        } else if (outcome && outcome.ok === true && outcome.report && outcome.report.ok === true) {
          try {
            if (typeof propertyHasCapability === "function") this.propertyCapability = propertyHasCapability(outcome.report);
          } catch (_) {}
        }
        return "legacy";
      }
      const key = this.propertyCapabilityCurrentBobKey();
      const classified = propertyCapabilityClassifyProbe(outcome);
      const prev = this.propertyCapabilityByBobPath instanceof Map
        ? this.propertyCapabilityByBobPath.get(key)
        : null;
      const attempts = (prev && prev.attempts) || 0;
      if (classified.status === "confirmed") {
        this.propertyCapabilityByBobPath.set(key, { status: "confirmed", attempts });
        try { this.propertyCapability = true; } catch (_) {}
        return "confirmed";
      }
      if (classified.status === "absent") {
        this.propertyCapabilityByBobPath.set(key, { status: "absent", attempts: attempts + 1, reason: classified.reason || "" });
        try { this.propertyCapability = false; } catch (_) {}
        return "absent";
      }
      // Unconfirmed leaves the cache alone: a failed contact attempt is
      // not evidence, and incidental shows must never revoke a confirmed
      // path. The settle path counts probe attempts separately.
      return "unconfirmed";
    } catch (_) {
      return "error";
    }
  }

  // Schedule one read-only probe from a lifecycle event. Never called from
  // paint or build functions. Returns a short disposition for tests.
  schedulePropertyCapabilityProbe(reason, options = {}) {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return "inactive";
      if (this.propertyUpdateActive === false) return "unloaded";
      const key = this.propertyCapabilityCurrentBobKey();
      let entry = this.propertyCapabilityByBobPath instanceof Map
        ? this.propertyCapabilityByBobPath.get(key)
        : null;
      if (!entry) {
        entry = { status: "unknown", attempts: 0 };
        this.propertyCapabilityByBobPath.set(key, entry);
      }
      if (entry.status === "confirmed") return "confirmed";
      if (entry.status === "unconfirmed" && entry.attempts >= PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS) return "exhausted";
      const flight = this.propertyCapabilityFlight;
      if (flight && flight.key === key && flight.generation === this.propertyCapabilityGeneration) return "in-flight";
      let preferred = "";
      try {
        const view = typeof getActiveMarkdownView === "function" ? getActiveMarkdownView(this.app) : null;
        preferred = (view && view.file && view.file.path) || "";
      } catch (_) {
        preferred = "";
      }
      if (!preferred) {
        try { preferred = (this.app && this.app.workspace && this.app.workspace.activeLeaf
          && this.app.workspace.activeLeaf.view && this.app.workspace.activeLeaf.view.file
          && this.app.workspace.activeLeaf.view.file.path) || ""; } catch (_) {
          preferred = "";
        }
      }
      const notePath = propertyCapabilityEligibleNotePath(this.app, preferred);
      if (!notePath) {
        this.propertyCapabilityProbePending = String(reason || "no-note");
        return "no-note";
      }
      this.propertyCapabilityProbePending = "";
      const generation = this.propertyCapabilityGeneration;
      const spawnOptions = options && typeof options === "object" ? options : {};
      let pending = null;
      try {
        pending = this.propertySpawnJson(
          propertyCapabilityProbeArgs(notePath),
          propertyDecodeShowReport,
          { ...spawnOptions, commandLabel: "bob props show" },
        );
      } catch (error) {
        pending = Promise.resolve({
          ok: false,
          code: "spawn-failed",
          message: String((error && error.message) || error),
        });
      }
      const flightRecord = { key, generation, notePath, promise: Promise.resolve(pending) };
      this.propertyCapabilityFlight = flightRecord;
      void flightRecord.promise.then((outcome) => {
        try { this.propertyCapabilitySettleProbe(key, generation, outcome); } catch (_) {}
        return undefined;
      }, () => {
        try { this.propertyCapabilitySettleProbe(key, generation, { ok: false, code: "probe-failed" }); } catch (_) {}
      });
      return "probing";
    } catch (_) {
      return "error";
    }
  }

  // Settle one probe. Stale generations, superseded flights, unloaded
  // plugins, and path changes discard the result; a confirmed path
  // schedules card refreshes.
  propertyCapabilitySettleProbe(key, generation, outcome) {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return "inactive";
      if (generation !== this.propertyCapabilityGeneration) return "stale";
      const flight = this.propertyCapabilityFlight;
      if (!flight || flight.key !== key || flight.generation !== generation) return "superseded";
      this.propertyCapabilityFlight = null;
      if (key !== this.propertyCapabilityCurrentBobKey()) return "path-changed";
      const classified = propertyCapabilityClassifyProbe(outcome);
      if (classified.status === "unconfirmed") {
        try {
          const entry = this.propertyCapabilityByBobPath instanceof Map
            ? this.propertyCapabilityByBobPath.get(key)
            : null;
          this.propertyCapabilityByBobPath.set(key, {
            status: "unconfirmed",
            attempts: ((entry && entry.attempts) || 0) + 1,
            reason: classified.reason || "",
          });
        } catch (_) {}
        return "unconfirmed";
      }
      if (this.propertyCapabilityNoteShowOutcome(outcome) === "confirmed") {
        try {
          if (typeof this.propertyEditorRefreshDrawers === "function") this.propertyEditorRefreshDrawers();
        } catch (_) {}
        return "confirmed";
      }
      return this.propertyCapabilityState(key).status;
    } catch (_) {
      return "error";
    }
  }

  // Find the ownership scope for a MarkdownView: the Live Preview editor
  // root first, then the Reading root. Skips embed, popover, and canvas
  // interiors. Returns null for sidebar and other non-document views.
  propertyCapabilityScopeForView(view) {
    try {
      if (!view || typeof view !== "object") return null;
      const roots = [];
      if (view.contentEl) roots.push(view.contentEl);
      if (view.containerEl) roots.push(view.containerEl);
      if (!roots.length) return null;
      const insideForeign = (node) => {
        try {
          return Boolean(node && typeof node.closest === "function"
            && node.closest(".markdown-embed, .internal-embed, .hover-popover, .canvas-node"));
        } catch (_) {
          return true;
        }
      };
      for (const root of roots) {
        try {
          const editor = root.querySelector && root.querySelector(".cm-editor");
          if (editor && !insideForeign(editor)) return editor;
        } catch (_) {}
      }
      for (const root of roots) {
        try {
          const preview = root.querySelector && root.querySelector(".markdown-preview-view");
          if (preview && !insideForeign(preview)) return preview;
        } catch (_) {}
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // Shared actual-ownership query keyed by originating view or scope and
  // the current note path. Observes active ownership only: a Live Preview
  // entry must match the field's current owner generation, a Reading entry
  // must still hold the scope tag, and denied scopes read as unowned. The
  // sidebar never reads as owned because its views carry no owned scope.
  propertyCardActualOwnership(input = {}) {
    const none = { owned: false, mode: null, path: "", generation: 0, scope: null, view: null };
    try {
      const opts = input && typeof input === "object" ? input : {};
      let view = opts.view || null;
      if (!view) {
        try {
          view = typeof getActiveMarkdownView === "function" ? getActiveMarkdownView(this.app) : null;
        } catch (_) {
          view = null;
        }
        if (!view) {
          try {
            view = (this.app && this.app.workspace && this.app.workspace.activeLeaf
              && this.app.workspace.activeLeaf.view) || null;
          } catch (_) {
            view = null;
          }
        }
      }
      const scope = opts.scope || this.propertyCapabilityScopeForView(view);
      if (!scope) return none;
      const normalize = (value) => {
        try {
          if (typeof propertyNotePath === "function") return propertyNotePath(value);
        } catch (_) {}
        const path = value && typeof value.path === "string" ? value.path : value;
        return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
      };
      const explicit = opts.path || opts.filePath || "";
      let path = explicit ? normalize(explicit) : "";
      if (!path) {
        try { path = normalize(view && view.file && view.file.path); } catch (_) { path = ""; }
      }
      if (!path || !/\.md$/i.test(path)) return none;
      try {
        const viewPath = normalize(view && view.file && view.file.path);
        if (view && viewPath && explicit && viewPath !== path) return none;
      } catch (_) {}
      if (typeof propertyCardFrontmatterActualOwnership !== "function") return none;
      const live = propertyCardFrontmatterActualOwnership(scope, { view, path });
      if (!live || live.owned !== true) return none;
      return {
        owned: true,
        mode: live.mode || null,
        path,
        generation: live.generation || 0,
        scope,
        view: view || null,
      };
    } catch (_) {
      return none;
    }
  }

  // Release one owned scope before a native fallback so the native input
  // the fallback focuses is visible again. Never throws.
  propertyCapabilityReleaseOwnedScope(scope, view) {
    try {
      if (typeof propertyCardFrontmatterReleaseScope === "function") {
        return propertyCardFrontmatterReleaseScope(scope, view);
      }
    } catch (_) {}
    return false;
  }

  propertyCapabilityInstallCommandRoute() {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return false;
      const target = propertyCapabilityCommandTarget(this.app);
      if (!target) return false;
      const { command } = target;
      const existing = this.propertyCapabilityCommandRoute;
      if (existing && existing.wrapper
        && (command.checkCallback === existing.wrapper || command.callback === existing.wrapper)) return true;
      const plugin = this;
      if (typeof command.checkCallback === "function") {
        const original = command.checkCallback;
        const callback = command.callback;
        const wrapper = function (checking, ...args) {
          return plugin.propertyCapabilityRouteAddProperty(this, checking, args);
        };
        command.checkCallback = wrapper;
        this.propertyCapabilityCommandRoute = {
          id: PROPERTY_CAPABILITY_COMMAND_ID,
          kind: "checkCallback",
          original: { checkCallback: original, callback },
          wrapper,
        };
        return true;
      }
      if (typeof command.callback === "function") {
        const original = command.callback;
        const wrapper = function (...args) {
          return plugin.propertyCapabilityRouteAddProperty(this, false, args);
        };
        command.callback = wrapper;
        this.propertyCapabilityCommandRoute = {
          id: PROPERTY_CAPABILITY_COMMAND_ID,
          kind: "callback",
          original: { checkCallback: null, callback: original },
          wrapper,
        };
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  propertyCapabilityRestoreCommandRoute() {
    try {
      const route = this.propertyCapabilityCommandRoute;
      this.propertyCapabilityCommandRoute = null;
      if (!route || !route.wrapper) return true;
      const target = propertyCapabilityCommandTarget(this.app);
      const command = target && target.command;
      if (!command) return false;
      const installed = route.kind === "callback" ? command.callback : command.checkCallback;
      if (installed !== route.wrapper) return false;
      try {
        if (route.kind === "callback") command.callback = route.original.callback;
        else command.checkCallback = route.original.checkCallback;
      } catch (_) {
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Dispatch point for the wrapped Add file property command. Owned
  // document scopes open the property editor in Add mode; every other scope
  // delegates to the original with its receiver, arguments, and check
  // semantics intact. A failed opener releases the scope first so the
  // native fallback lands on a visible input. Never throws.
  propertyCapabilityRouteAddProperty(receiver, checking, args) {
    const list = Array.isArray(args) ? args : [];
    try {
      let owned = null;
      try {
        if (this.propertyCapabilityRoutingActive === true
          && typeof this.propertyCardActualOwnership === "function") {
          owned = this.propertyCardActualOwnership({});
        }
      } catch (_) {
        owned = null;
      }
      if (owned && owned.owned === true) {
        if (checking === true) return true;
        if (typeof this.openPropertyEditor !== "function") {
          return this.propertyCapabilityOwnedOpenerFailed(receiver, list, owned);
        }
        let outcome = null;
        try {
          outcome = this.openPropertyEditor({ filePath: owned.path, mode: "add" });
        } catch (_) {
          return this.propertyCapabilityOwnedOpenerFailed(receiver, list, owned);
        }
        if (outcome && typeof outcome.then === "function") {
          void outcome.then((resolved) => {
            if (!resolved || resolved.ok !== true) {
              this.propertyCapabilityOwnedOpenerFailed(receiver, list, owned);
            }
            return undefined;
          }, () => {
            this.propertyCapabilityOwnedOpenerFailed(receiver, list, owned);
          });
          return true;
        }
        if (!outcome || outcome.ok !== true) {
          return this.propertyCapabilityOwnedOpenerFailed(receiver, list, owned);
        }
        return true;
      }
      return this.propertyCapabilityRunNativeFallback(receiver, checking, list);
    } catch (_) {
      try {
        return this.propertyCapabilityRunNativeFallback(receiver, checking, list);
      } catch (_) {
        return false;
      }
    }
  }

  propertyCapabilityOwnedOpenerFailed(receiver, args, owned) {
    try {
      if (owned) this.propertyCapabilityReleaseOwnedScope(owned.scope, owned.view);
    } catch (_) {}
    try {
      return this.propertyCapabilityRunNativeFallback(receiver, false, args);
    } catch (_) {
      return false;
    }
  }

  propertyCapabilityRunNativeFallback(receiver, checking, args) {
    const list = Array.isArray(args) ? args : [];
    try {
      const route = this.propertyCapabilityCommandRoute;
      const original = route && route.original;
      if (!original) return false;
      if (route.kind !== "callback" && typeof original.checkCallback === "function") {
        return original.checkCallback.apply(receiver, [checking, ...list]);
      }
      if (typeof original.callback === "function") {
        if (route.kind !== "callback" && checking === true) return true;
        return original.callback.apply(receiver, list);
      }
      return false;
    } catch (_) {
      return false;
    }
  }
}
