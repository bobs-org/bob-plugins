// Property capability routing: session-and-bob-path capability cache,
// actual-ownership query, and the native Add file property entry route
// (bob-cli-pf.6.1.2 capability-routing, bob-cli-pl.9.1.1 contract evidence).
// The shared frontmatter coordinator observes confirmed capability changes
// and reconciles mounted card adapters.
//
// The controller caches one outcome per resolved bob path for the plugin
// session: confirmed (bob answered props_v1), absent (unknown subcommand),
// or unconfirmed (transient note, I/O, or shape failures keep native
// available without revoking a confirmed path). Probes are read-only
// `bob props show` runs scheduled from setup and workspace lifecycle events
// only, never from paint or build functions, with one in-flight probe per
// key, bounded retries, and stale/path-changed results discarded.
//
// Area/project whole-frontmatter ownership additionally needs the typed
// settings contract (`props_contract_v1`). Contract evidence is tracked per
// bob path beside the generic outcome: a successful `bob __catalog
// --protocol 1` whose features include the contract confirms it, a
// successful catalog without the feature records absence (an old binary),
// and failures stay unconfirmed. A valid typed-note `props show` report that
// carries the contract is also positive evidence. An ordinary note's show
// report deliberately omits the settings capability, so it never establishes
// absence and never downgrades a confirmed contract. The catalog probe needs
// no open note and runs from the same lifecycle events (never paint).
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
// Typed settings contract required for area/project whole-frontmatter
// ownership (bob-cli-pl.9.1.1). The catalog advertises it in `features`.
const PROPERTY_CAPABILITY_CONTRACT = "props_contract_v1";

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

// The contract probe needs no open note: a read-only catalog read scheduled
// from the same lifecycle events. Painting never spawns.
function propertyCapabilityCatalogArgs() {
  return ["__catalog", "--protocol", "1"];
}

// Decode one `bob __catalog --protocol 1` run. Only a well-formed catalog
// document counts; anything else is a transient probe failure. The decoded
// catalog rides the shared outcome envelope's `report` slot (the spawn
// wrapper forwards only that slot alongside ok/exitCode).
function propertyDecodeCatalogReport(stdout, stderr = "", exitCode = null) {
  let body = null;
  try {
    body = typeof propertyParseJson === "function" ? propertyParseJson(stdout) : JSON.parse(stdout);
  } catch (error) {
    return typeof propertyDecodeFailure === "function"
      ? propertyDecodeFailure("bad-json", "bob __catalog returned invalid JSON.", stderr, exitCode)
      : { ok: false, code: "bad-json" };
  }
  if (!body || typeof body !== "object" || body.ok !== true || body.protocol !== 1 || !Array.isArray(body.features)) {
    return typeof propertyDecodeFailure === "function"
      ? propertyDecodeFailure("bad-shape", "bob __catalog returned an incomplete catalog.", stderr, exitCode)
      : { ok: false, code: "bad-shape" };
  }
  return { ok: true, report: body, exitCode };
}

// Classify one catalog probe outcome. A successful catalog whose features
// include the contract confirms it; a successful catalog without the
// feature means an old binary (absence). Failures stay unconfirmed and keep
// native available without revoking a confirmed path.
function propertyCapabilityClassifyCatalogOutcome(outcome) {
  try {
    if (!outcome || typeof outcome !== "object") return { status: "unconfirmed", reason: "no-outcome" };
    if (outcome.ok === true && outcome.report && typeof outcome.report === "object") {
      const features = Array.isArray(outcome.report.features) ? outcome.report.features : [];
      return features.includes(PROPERTY_CAPABILITY_CONTRACT)
        ? { status: "confirmed" }
        : { status: "absent", reason: "missing-contract" };
    }
    return { status: "unconfirmed", reason: typeof outcome.code === "string" && outcome.code ? outcome.code : "probe-failed" };
  } catch (_) {
    return { status: "unconfirmed", reason: "classify-failed" };
  }
}

// Positive contract evidence from an already obtained show report: only a
// typed-note report carries the contract. Ordinary notes omit it, so this
// reads as true only, never as absence.
function propertyCapabilityReportHasContract(report) {
  try {
    return Boolean(report && typeof report === "object"
      && Array.isArray(report.capabilities)
      && report.capabilities.includes(PROPERTY_CAPABILITY_CONTRACT));
  } catch (_) {
    return false;
  }
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
  // Schedule both probes from one lifecycle event: the show probe needs an
  // open note, the contract probe does not. Each deduplicates and bounds
  // its own retries; either may stay unconfirmed without affecting the
  // other. Never called from paint or build functions.
  schedulePropertyCapabilityProbes(reason, options = {}) {
    let show = "error";
    let contract = "error";
    try { show = this.schedulePropertyCapabilityProbe(reason, options); } catch (_) { show = "error"; }
    try { contract = this.schedulePropertyCapabilityContractProbe(reason, options); } catch (_) { contract = "error"; }
    return { show, contract };
  }

  setupPropertyCapabilityRouting() {
    if (this.propertyCapabilityRoutingActive === true) return;
    this.propertyCapabilityRoutingActive = true;
    this.propertyCapabilityGeneration = (this.propertyCapabilityGeneration || 0) + 1;
    this.propertyCapabilityByBobPath = new Map();
    this.propertyCapabilityFlight = null;
    this.propertyCapabilityProbePending = "";
    this.propertyCapabilityContractFlight = null;
    this.propertyCapabilityContractProbePending = "";
    this.propertyCapabilityCommandRoute = null;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(workspace.on("active-leaf-change", () => {
          try { this.schedulePropertyCapabilityProbes("active-leaf-change"); } catch (_) {}
        }));
        this.registerEvent(workspace.on("file-open", () => {
          try { this.schedulePropertyCapabilityProbes("file-open"); } catch (_) {}
        }));
      }
    } catch (_) {}
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => {
          try { this.schedulePropertyCapabilityProbes("layout-ready"); } catch (_) {}
        });
      }
    } catch (_) {}
    try { this.propertyCapabilityInstallCommandRoute(); } catch (_) {}
    try { this.schedulePropertyCapabilityProbes("setup"); } catch (_) {}
  }

  teardownPropertyCapabilityRouting() {
    this.propertyCapabilityRoutingActive = false;
    this.propertyCapabilityGeneration = (this.propertyCapabilityGeneration || 0) + 1;
    this.propertyCapabilityFlight = null;
    this.propertyCapabilityProbePending = "";
    this.propertyCapabilityContractFlight = null;
    this.propertyCapabilityContractProbePending = "";
    try { this.propertyCapabilityRestoreCommandRoute(); } catch (_) {}
    try {
      if (this.propertyCapabilityByBobPath instanceof Map) this.propertyCapabilityByBobPath.clear();
    } catch (_) {}
    this.propertyCapabilityByBobPath = new Map();
    this.propertyCapabilityCommandRoute = null;
    try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "inactive"); } catch (_) {}
  }

  propertyCapabilityCurrentBobKey() {
    try {
      const resolved = typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : null;
      return propertyCapabilityBobKey(resolved);
    } catch (_) {
      return "path:bob";
    }
  }

  // Ensure one cache entry per resolved bob path. Contract evidence rides
  // beside the generic outcome with its own retry budget: unknown by
  // default, confirmed by catalog or typed-note evidence, absent only from
  // binary-level evidence (a catalog without the feature, needs-bob).
  propertyCapabilityEntry(key) {
    try {
      const lookup = typeof key === "string" && key ? key : this.propertyCapabilityCurrentBobKey();
      if (!(this.propertyCapabilityByBobPath instanceof Map)) this.propertyCapabilityByBobPath = new Map();
      let entry = this.propertyCapabilityByBobPath.get(lookup);
      if (!entry || typeof entry !== "object") {
        entry = { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "" };
        this.propertyCapabilityByBobPath.set(lookup, entry);
      }
      if (entry.contract !== "confirmed" && entry.contract !== "absent" && entry.contract !== "unconfirmed") {
        entry.contract = "unknown";
      }
      if (!Number.isInteger(entry.contractAttempts)) entry.contractAttempts = 0;
      return { entry, key: lookup };
    } catch (_) {
      return { entry: null, key: "" };
    }
  }

  propertyCapabilityState(key) {
    try {
      const lookup = typeof key === "string" && key ? key : this.propertyCapabilityCurrentBobKey();
      const entry = this.propertyCapabilityByBobPath instanceof Map
        ? this.propertyCapabilityByBobPath.get(lookup)
        : null;
      if (!entry) return { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "", key: lookup };
      return {
        status: entry.status || "unknown",
        contract: entry.contract || "unknown",
        attempts: entry.attempts || 0,
        contractAttempts: entry.contractAttempts || 0,
        reason: entry.reason || "",
        key: lookup,
      };
    } catch (_) {
      return { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "", key: "" };
    }
  }

  propertyCapabilityConfirmed(key) {
    try {
      return this.propertyCapabilityState(key).status === "confirmed";
    } catch (_) {
      return false;
    }
  }

  // Contract evidence for area/project whole-frontmatter ownership. Reads
  // only the per-path cache; ordinary-note reports never write absence.
  propertyCapabilityContractConfirmed(key) {
    try {
      return this.propertyCapabilityState(key).contract === "confirmed";
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
  // here. A typed-note report carrying the contract also confirms contract
  // evidence; an ordinary note's report never establishes absence and never
  // downgrades a confirmed contract. When routing is inactive the legacy
  // single-value behavior applies unchanged.
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
      const ensured = typeof this.propertyCapabilityEntry === "function"
        ? this.propertyCapabilityEntry()
        : { entry: null, key: this.propertyCapabilityCurrentBobKey() };
      const key = ensured.key;
      const entry = ensured.entry || { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "" };
      if (!ensured.entry && this.propertyCapabilityByBobPath instanceof Map) {
        this.propertyCapabilityByBobPath.set(key, entry);
      }
      const classified = propertyCapabilityClassifyProbe(outcome);
      const report = outcome && outcome.ok === true && outcome.report && typeof outcome.report === "object"
        ? outcome.report
        : null;
      // needs-bob is binary-level evidence (an old binary without props),
      // so it records contract absence too. Any other report shape leaves
      // contract evidence alone.
      if (outcome && outcome.ok === false && outcome.code === "needs-bob") {
        entry.contract = "absent";
      } else if (report && report.ok === true && propertyCapabilityReportHasContract(report)) {
        entry.contract = "confirmed";
      }
      if (classified.status === "confirmed") {
        entry.status = "confirmed";
        try { this.propertyCapability = true; } catch (_) {}
        try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "confirmed"); } catch (_) {}
        return "confirmed";
      }
      if (classified.status === "absent") {
        entry.status = "absent";
        entry.attempts = (entry.attempts || 0) + 1;
        entry.reason = classified.reason || "";
        try { this.propertyCapability = false; } catch (_) {}
        try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "absent"); } catch (_) {}
        return "absent";
      }
      // Unconfirmed leaves the generic cache alone: a failed contact
      // attempt is not evidence, and incidental shows must never revoke a
      // confirmed path. The settle path counts probe attempts separately.
      // Contract evidence recorded above persists regardless.
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
          const ensured = typeof this.propertyCapabilityEntry === "function"
            ? this.propertyCapabilityEntry(key)
            : { entry: null };
          const entry = ensured.entry || { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "" };
          if (!ensured.entry && this.propertyCapabilityByBobPath instanceof Map) {
            this.propertyCapabilityByBobPath.set(key, entry);
          }
          // Preserve contract evidence: a failed show probe is not contract
          // evidence either way.
          entry.status = "unconfirmed";
          entry.attempts = (entry.attempts || 0) + 1;
          entry.reason = classified.reason || "";
        } catch (_) {}
        try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "unconfirmed"); } catch (_) {}
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

  // Schedule one read-only catalog probe from a lifecycle event. Needs no
  // open note and never runs from paint or build functions. Deduplicates
  // one in-flight probe per bob path, bounds retries, and discards stale,
  // superseded, unloaded, and path-changed results. Returns a short
  // disposition for tests.
  schedulePropertyCapabilityContractProbe(reason, options = {}) {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return "inactive";
      if (this.propertyUpdateActive === false) return "unloaded";
      const ensured = typeof this.propertyCapabilityEntry === "function"
        ? this.propertyCapabilityEntry()
        : { entry: null, key: this.propertyCapabilityCurrentBobKey() };
      const key = ensured.key;
      const entry = ensured.entry || { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "" };
      if (!ensured.entry && this.propertyCapabilityByBobPath instanceof Map) {
        this.propertyCapabilityByBobPath.set(key, entry);
      }
      if (entry.contract === "confirmed") return "confirmed";
      // Absence re-probes like the generic probe: an upgraded binary is
      // detected on a later lifecycle event.
      if (entry.contract === "unconfirmed" && entry.contractAttempts >= PROPERTY_CAPABILITY_MAX_PROBE_ATTEMPTS) {
        return "exhausted";
      }
      const flight = this.propertyCapabilityContractFlight;
      if (flight && flight.key === key && flight.generation === this.propertyCapabilityGeneration) return "in-flight";
      const generation = this.propertyCapabilityGeneration;
      const spawnOptions = options && typeof options === "object" ? options : {};
      let pending = null;
      try {
        pending = this.propertySpawnJson(
          propertyCapabilityCatalogArgs(),
          propertyDecodeCatalogReport,
          { ...spawnOptions, commandLabel: "bob __catalog" },
        );
      } catch (error) {
        pending = Promise.resolve({
          ok: false,
          code: "spawn-failed",
          message: String((error && error.message) || error),
        });
      }
      const flightRecord = { key, generation, promise: Promise.resolve(pending) };
      this.propertyCapabilityContractFlight = flightRecord;
      void flightRecord.promise.then((outcome) => {
        try { this.propertyCapabilitySettleContractProbe(key, generation, outcome); } catch (_) {}
        return undefined;
      }, () => {
        try { this.propertyCapabilitySettleContractProbe(key, generation, { ok: false, code: "probe-failed" }); } catch (_) {}
      });
      return "probing";
    } catch (_) {
      return "error";
    }
  }

  // Settle one catalog probe. Stale generations, superseded flights,
  // unloaded plugins, and path changes discard the result; a confirmed
  // contract schedules card refreshes so home mounts can acquire.
  propertyCapabilitySettleContractProbe(key, generation, outcome) {
    try {
      if (this.propertyCapabilityRoutingActive !== true) return "inactive";
      if (generation !== this.propertyCapabilityGeneration) return "stale";
      const flight = this.propertyCapabilityContractFlight;
      if (!flight || flight.key !== key || flight.generation !== generation) return "superseded";
      this.propertyCapabilityContractFlight = null;
      if (key !== this.propertyCapabilityCurrentBobKey()) return "path-changed";
      const classified = propertyCapabilityClassifyCatalogOutcome(outcome);
      const ensured = typeof this.propertyCapabilityEntry === "function"
        ? this.propertyCapabilityEntry(key)
        : { entry: null };
      const entry = ensured.entry || { status: "unknown", contract: "unknown", attempts: 0, contractAttempts: 0, reason: "" };
      if (!ensured.entry && this.propertyCapabilityByBobPath instanceof Map) {
        this.propertyCapabilityByBobPath.set(key, entry);
      }
      if (classified.status === "confirmed") {
        entry.contract = "confirmed";
        try {
          if (typeof this.propertyEditorRefreshDrawers === "function") this.propertyEditorRefreshDrawers();
        } catch (_) {}
        try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "confirmed"); } catch (_) {}
        return "confirmed";
      }
      if (classified.status === "absent") {
        entry.contract = "absent";
        entry.contractAttempts = (entry.contractAttempts || 0) + 1;
        try { propertyCardFrontmatterCoordinatorCapabilityChanged?.(this, "absent"); } catch (_) {}
        return "absent";
      }
      entry.contract = "unconfirmed";
      entry.contractAttempts = (entry.contractAttempts || 0) + 1;
      return "unconfirmed";
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
