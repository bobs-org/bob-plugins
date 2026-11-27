// Album Records cabinet (bob-cli-qq records-cabinet): the open-by-default
// content provider for album cards. The summary is the stored `[!records]`
// head tally plus grouping; the body runs the existing records painter over
// the stored callout through the generic catalog body renderer, so group
// folds, facets, date chips, the empty-album teaching line, and the
// subscriptions decoration all match the inline index. Claims and painter
// stand-down follow the host-cabinets pattern; the group jump retargets into
// the cabinet. Never throws, never writes the vault, never spawns bob.
const CABINET_RECORDS_KIND = "records";
const CABINET_RECORDS_NULL_VIEW = "__cabinet_records_null_view__";
const CABINET_RECORDS_JUMP_RETRIES = 8;
const CABINET_RECORDS_JUMP_RETRY_MS = 125;

// Last validated applies result per album path: fingerprint, plan, summary,
// and report revision. `paintKey` and `buildBody` read it so all three agree
// on one validated region without re-scanning.
const cabinetRecordsLastApplies = new Map();

// Live body entries per album path: Map(view|NULL -> entry). An entry holds
// the claim release, the editor absorb handle, the Reading tagged nodes, and
// the validated plan, so close, rebuild, and teardown all unhide.
const cabinetRecordsBodies = new Map();

function cabinetRecordsBodyKey(view) {
  return view || CABINET_RECORDS_NULL_VIEW;
}

function cabinetRecordsBodiesFor(path, create) {
  let scoped = cabinetRecordsBodies.get(path);
  if (!scoped && create) {
    scoped = new Map();
    cabinetRecordsBodies.set(path, scoped);
  }
  return scoped || null;
}

function cabinetRecordsSweepDisconnected() {
  try {
    for (const [path, scoped] of Array.from(cabinetRecordsBodies.entries())) {
      for (const [key, entry] of Array.from(scoped.entries())) {
        const scope = entry && entry.scope;
        if (scope && typeof scope.isConnected === "boolean" && scope.isConnected) continue;
        if (scope && scope.isConnected !== false) continue;
        try { cabinetRecordsReleaseEntry(entry); } catch (_) {}
        scoped.delete(key);
      }
      if (scoped.size === 0) cabinetRecordsBodies.delete(path);
    }
  } catch (_) {}
}

function cabinetRecordsReleaseEntry(entry) {
  if (!entry || entry.released) return;
  entry.released = true;
  try {
    if (typeof entry.editorHandle === "function") entry.editorHandle();
  } catch (_) {}
  try {
    if (typeof propertyCardCabinetAbsorbUntagReading === "function") {
      propertyCardCabinetAbsorbUntagReading(entry.tagged);
    }
  } catch (_) {}
  try {
    if (typeof entry.releaseClaim === "function") entry.releaseClaim();
  } catch (_) {}
  entry.tagged = [];
}

function cabinetRecordsReleaseBody(view, path) {
  try {
    const scoped = cabinetRecordsBodiesFor(path, false);
    if (!scoped) return false;
    const key = cabinetRecordsBodyKey(view);
    const entry = scoped.get(key);
    if (!entry) return false;
    cabinetRecordsReleaseEntry(entry);
    scoped.delete(key);
    if (scoped.size === 0) cabinetRecordsBodies.delete(path);
    return true;
  } catch (_) {
    return false;
  }
}

function cabinetRecordsReleasePlugin(plugin) {
  let count = 0;
  try {
    for (const [path, scoped] of Array.from(cabinetRecordsBodies.entries())) {
      for (const [key, entry] of Array.from(scoped.entries())) {
        if (plugin && entry && entry.plugin && entry.plugin !== plugin) continue;
        cabinetRecordsReleaseEntry(entry);
        scoped.delete(key);
        count += 1;
      }
      if (scoped.size === 0) cabinetRecordsBodies.delete(path);
    }
  } catch (_) {}
  try {
    if (plugin && plugin.cabinetRecordsUnregister) {
      const unregister = plugin.cabinetRecordsUnregister;
      plugin.cabinetRecordsUnregister = null;
      if (typeof unregister === "function" && unregister() === true) count += 1;
    } else if (typeof propertyCardCabinetProvidersReleasePlugin === "function" && plugin) {
      count += propertyCardCabinetProvidersReleasePlugin(plugin);
    }
  } catch (_) {}
  return count;
}

// The stored head title: everything after `> [!records]` and the optional
// fold sign. Empty when the head is malformed (never recognized then).
function cabinetRecordsHeadTitle(region) {
  try {
    const lines = region && Array.isArray(region.lines) ? region.lines : [];
    const match = /^ {0,3}> \[!records\][+-]?(.*)$/i.exec(String(lines[0] || ""));
    if (!match) return "";
    return String(match[1] || "").replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  } catch (_) {
    return "";
  }
}

function cabinetRecordsReportAlbum(plugin, path) {
  try {
    const state = typeof plugin?.albumReportState === "function" ? plugin.albumReportState() : null;
    const report = state && state.report ? state.report : null;
    const byPath = report && report.albumsByPath;
    if (byPath && typeof byPath.get === "function") {
      const album = byPath.get(typeof albumReportPath === "function" ? albumReportPath(path) : path);
      if (album && typeof album === "object") return album;
    }
  } catch (_) {}
  return null;
}

function cabinetRecordsGroupingSuffix(plugin, album) {
  try {
    const field = album && typeof album.group_field === "string" ? album.group_field.trim() : "";
    if (!field) return "";
    let label = field;
    try {
      if (typeof albumHeaderFieldLabel === "function") {
        label = albumHeaderFieldLabel(Array.isArray(album.fields) ? album.fields : [], field) || field;
      }
    } catch (_) {}
    return ` · by ${label}`;
  } catch (_) {
    return "";
  }
}

function cabinetRecordsReportMeta(plugin) {
  try {
    const state = typeof plugin?.albumReportState === "function" ? plugin.albumReportState() : null;
    return {
      stale: state ? state.stale === true : false,
      generation: state && state.reportGeneration != null ? String(state.reportGeneration) : "",
    };
  } catch (_) {
    return { stale: false, generation: "" };
  }
}

// The validated region plus hide plan for `source`, or null when no cabinet
// may stand in: missing region, damage, or an unhideable shape. Fails open.
function cabinetRecordsRegionForSource(source) {
  try {
    if (typeof propertyCardCatalogRegionForHide !== "function") return null;
    const plan = propertyCardCatalogRegionForHide(String(source || ""), CABINET_RECORDS_KIND);
    if (!plan || plan.startLine == null || plan.endLine == null || plan.damage) return null;
    if (!plan.fingerprint) return null;
    return plan;
  } catch (_) {
    return null;
  }
}

function cabinetRecordsSummaryFor(source, album, plugin) {
  const plan = cabinetRecordsRegionForSource(source);
  if (!plan) return null;
  const lines = String(source || "").split("\n");
  const regionLines = lines.slice(plan.startLine - 1, plan.endLine);
  const headTitle = cabinetRecordsHeadTitle({ lines: regionLines });
  const summary = `${headTitle}${cabinetRecordsGroupingSuffix(plugin, album)}`.replace(/^[ \t]+/, "");
  return { plan, summary: summary || "Records", fingerprint: plan.fingerprint, regionSource: regionLines.join("\n") };
}

// The provider applies result for one album card, or null when no cabinet
// applies. Synchronous over confirmed source and cached reports only.
function cabinetRecordsAppliesFor(plugin, context = {}) {
  try {
    if (typeof propertyCardCabinetsGateLive === "function" && propertyCardCabinetsGateLive() !== true) return null;
    const path = typeof context.path === "string" ? context.path : "";
    if (!path) return null;
    if (String(context.species || "") !== "album") return null;
    const source = typeof context.source === "string" ? context.source : "";
    if (!source) return null;
    const album = cabinetRecordsReportAlbum(plugin, path);
    const found = cabinetRecordsSummaryFor(source, album, plugin);
    if (!found) return null;
    const meta = cabinetRecordsReportMeta(plugin);
    const record = {
      fingerprint: found.fingerprint,
      plan: found.plan,
      summary: found.summary,
      regionSource: found.regionSource,
      generation: meta.generation,
      stale: meta.stale,
      subscription: false,
    };
    try {
      if (typeof bankSubscriptionIsAlbumSource === "function"
        && bankSubscriptionIsAlbumSource(path, album || undefined)) {
        record.subscription = true;
      }
    } catch (_) {}
    cabinetRecordsLastApplies.set(path, record);
    const result = { summary: found.summary };
    if (meta.stale) {
      result.attention = { icon: "⚠", word: "stale", title: "Albums report is stale; sync to refresh" };
      result.actions = [{
        label: "↻ Sync",
        title: "Sync albums now",
        ariaLabel: "Sync albums now",
        onClick: () => {
          try { plugin?.apiAlbumSync?.({ automatic: false }); } catch (_) {}
        },
      }];
    }
    return result;
  } catch (_) {
    return null;
  }
}

function cabinetRecordsPaintKeyFor(plugin, path) {
  try {
    const record = cabinetRecordsLastApplies.get(path);
    const meta = cabinetRecordsReportMeta(plugin);
    const fingerprint = record && record.fingerprint ? record.fingerprint : "pending";
    const generation = record && record.generation !== undefined ? record.generation : meta.generation;
    const stale = record && record.stale !== undefined ? record.stale : meta.stale;
    const subscription = record && record.subscription ? "sub" : "nosub";
    return `${fingerprint} r${generation || "-"} ${stale ? "stale" : "fresh"} ${subscription}`;
  } catch (_) {
    return "pending";
  }
}

// The folds host shared by the cabinet body and the group jump: the Live
// Preview editor view when one is present, else the stable Reading scope so
// folds survive card rebuilds within one pane.
function cabinetRecordsFoldsHost(view, container) {
  try {
    if (view && typeof view.dispatch === "function" && view.state) return view;
  } catch (_) {}
  try {
    const scope = container && typeof container.closest === "function"
      ? container.closest(".markdown-preview-view")
      : null;
    if (scope) return scope;
  } catch (_) {}
  try {
    const scope = view && view.containerEl && typeof view.containerEl.querySelector === "function"
      ? view.containerEl.querySelector(".markdown-preview-view")
      : null;
    if (scope) return scope;
  } catch (_) {}
  return container || view || null;
}

function cabinetRecordsPaintOptions(plugin, path, folds, handlers) {
  try {
    if (plugin && typeof plugin.albumRecordsOptions === "function" && typeof plugin.albumRecordsHandlers === "function") {
      return plugin.albumRecordsOptions(path, folds, handlers);
    }
  } catch (_) {}
  return {
    sourcePath: path,
    state: { report: null },
    album: null,
    hue: "",
    today: "",
    folds: folds || new Map(),
    metadataCache: null,
    vault: null,
    handlers: handlers || {},
    subscriptionReport: null,
  };
}

// Paint one rendered records callout with the same options and fold map as
// the inline path. Returns true when chrome was applied.
function cabinetRecordsPaintCallout(plugin, calloutEl, path, folds, container) {
  try {
    if (!plugin || !calloutEl || typeof path !== "string" || !path) return false;
    if (typeof albumPaintRecordsCallout !== "function") return false;
    let shouldPaint = true;
    try {
      if (typeof plugin.albumReportState === "function" && typeof albumRecordsShouldPaint === "function") {
        shouldPaint = albumRecordsShouldPaint(plugin.albumReportState(), path) !== false;
      }
    } catch (_) {
      shouldPaint = true;
    }
    if (!shouldPaint) return false;
    const map = folds instanceof Map ? folds : new Map();
    const target = calloutEl;
    const repaint = () => {
      try {
        const options = cabinetRecordsPaintOptions(plugin, path, map, handlers);
        albumPaintRecordsCallout(target, options);
      } catch (_) {}
    };
    const handlers = {
      toggleFold: (identity, folded) => {
        try {
          if (typeof albumRecordsFoldKey === "function") {
            map.set(albumRecordsFoldKey(path, identity), Boolean(folded));
          }
        } catch (_) {}
        repaint();
      },
    };
    const options = cabinetRecordsPaintOptions(plugin, path, map, handlers);
    try {
      if (typeof plugin.albumRecordsApplyPending === "function") {
        plugin.albumRecordsApplyPending(path, map, container || target);
      }
    } catch (_) {}
    albumPaintRecordsCallout(target, options);
    return true;
  } catch (_) {
    return false;
  }
}

function cabinetRecordsReadingScope(container) {
  try {
    if (container && typeof container.closest === "function") {
      const scope = container.closest(".markdown-preview-view");
      if (scope) return scope;
    }
  } catch (_) {}
  return null;
}

// Claim one mounted cabinet body: fingerprinted ownership plus the Live
// Preview editor absorb and the Reading tags. The stored section hides only
// while this working body stands in for it. Returns a release function.
function cabinetRecordsClaimBody(plugin, parts = {}) {
  const noop = () => {};
  try {
    const view = parts.view || null;
    const container = parts.container || null;
    const path = typeof parts.path === "string" ? parts.path : "";
    const fingerprint = parts.fingerprint != null ? String(parts.fingerprint) : "";
    const plan = parts.plan || null;
    if (!path || !fingerprint || !plan) return noop;
    cabinetRecordsSweepDisconnected();
    let scoped = cabinetRecordsBodiesFor(path, true);
    const key = cabinetRecordsBodyKey(view && typeof view.dispatch === "function" ? view : null);
    const previous = scoped.get(key);
    if (previous) {
      cabinetRecordsReleaseEntry(previous);
      scoped.delete(key);
    }
    const entry = {
      plugin: plugin || null,
      view: view || null,
      path,
      fingerprint,
      plan,
      scope: cabinetRecordsReadingScope(container),
      tagged: [],
      editorHandle: null,
      releaseClaim: null,
      released: false,
    };
    scoped = cabinetRecordsBodiesFor(path, true);
    scoped.set(key, entry);
    let claimRelease = noop;
    try {
      if (typeof propertyCardCatalogClaim === "function") {
        claimRelease = propertyCardCatalogClaim({
          view: view || container,
          path,
          kind: CABINET_RECORDS_KIND,
          fingerprint,
          reveal: () => cabinetRecordsReveal(plugin, view, path),
        }) || noop;
      }
    } catch (_) {
      claimRelease = noop;
    }
    entry.releaseClaim = claimRelease;
    try {
      if (view && typeof view.dispatch === "function"
        && typeof propertyCardCabinetAbsorbInEditor === "function") {
        entry.editorHandle = propertyCardCabinetAbsorbInEditor(view, {
          path,
          kind: CABINET_RECORDS_KIND,
          fingerprint,
        });
      }
    } catch (_) {
      entry.editorHandle = null;
    }
    try {
      if (entry.scope && typeof propertyCardCabinetAbsorbPaintReading === "function") {
        entry.tagged = propertyCardCabinetAbsorbPaintReading(entry.scope, plan, true) || [];
      }
    } catch (_) {
      entry.tagged = [];
    }
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      try {
        const live = cabinetRecordsBodiesFor(path, false);
        if (live && live.get(key) === entry) live.delete(key);
      } catch (_) {}
      cabinetRecordsReleaseEntry(entry);
    };
    try {
      const component = parts.component;
      if (component && typeof component.register === "function") component.register(release);
    } catch (_) {}
    return release;
  } catch (_) {
    return noop;
  }
}

// The lazy provider body: claim, render the stored callout, paint it with
// the records painter. A paint failure releases the claim in the same frame
// so the stored section returns at once.
function cabinetRecordsBuildBody(plugin, options = {}) {
  const doc = options.doc || null;
  const container = options.container || null;
  const path = typeof options.path === "string" ? options.path : "";
  const view = options.view || null;
  const component = options.component || plugin || null;
  try {
    if (!plugin || !doc || !container || !path) return;
    let source = "";
    try {
      if (typeof propertyCardCabinetContextSource === "function") {
        source = propertyCardCabinetContextSource({ source: "", view, plugin }, path) || "";
      }
    } catch (_) {
      source = "";
    }
    if (!source && view) {
      try {
        const text = view.state && view.state.doc && typeof view.state.doc.toString === "function"
          ? view.state.doc.toString()
          : "";
        if (text) source = text;
      } catch (_) {}
    }
    const found = source ? cabinetRecordsSummaryFor(source, cabinetRecordsReportAlbum(plugin, path), plugin) : null;
    const record = cabinetRecordsLastApplies.get(path);
    const regionSource = (found && found.regionSource) || (record && record.regionSource) || "";
    const fingerprint = (found && found.fingerprint) || (record && record.fingerprint) || "";
    const plan = (found && found.plan) || (record && record.plan) || null;
    if (!regionSource || !fingerprint || !plan) {
      try {
        if (typeof propertyCardCabinetRenderFailureLine === "function") {
          const line = propertyCardCabinetRenderFailureLine(doc, "Couldn't render — showing the note's section");
          if (line) container.appendChild(line);
        }
      } catch (_) {}
      return;
    }
    cabinetRecordsLastApplies.set(path, {
      fingerprint,
      plan,
      summary: (found && found.summary) || (record && record.summary) || "Records",
      regionSource,
      generation: (record && record.generation) || "",
      stale: Boolean(record && record.stale),
      subscription: Boolean(record && record.subscription),
    });
    const releaseClaim = cabinetRecordsClaimBody(plugin, {
      view: view && typeof view.dispatch === "function" ? view : null,
      container,
      path,
      fingerprint,
      plan,
      component,
    });
    const foldsHost = cabinetRecordsFoldsHost(view, container);
    let folds = null;
    try {
      folds = typeof plugin.albumRecordsFoldMap === "function"
        ? plugin.albumRecordsFoldMap(foldsHost || container)
        : new Map();
    } catch (_) {
      folds = new Map();
    }
    const paint = (calloutEl) => {
      cabinetRecordsPaintCallout(plugin, calloutEl, path, folds, container);
    };
    const run = (() => {
      try {
        if (typeof propertyCardCabinetRenderCatalog !== "function") return null;
        return propertyCardCabinetRenderCatalog({
          plugin,
          doc,
          container,
          path,
          regionSource,
          paint,
          paintKey: cabinetRecordsPaintKeyFor(plugin, path),
          component: component || undefined,
          releaseClaim,
          repaintNative: () => {
            try {
              if (typeof plugin.scheduleAlbumRecordsRefresh === "function") plugin.scheduleAlbumRecordsRefresh();
            } catch (_) {}
          },
        });
      } catch (_) {
        return null;
      }
    })();
    if (run && typeof run.then === "function") {
      run.then(
        (outcome) => {
          if (outcome && outcome.failed) {
            try { releaseClaim(); } catch (_) {}
          }
        },
        () => {
          try { releaseClaim(); } catch (_) {}
        },
      );
    }
  } catch (_) {}
}

// Best-effort scroll of one mounted records cabinet head into view.
function cabinetRecordsScrollHead(scope, path) {
  try {
    const root = scope || (typeof document !== "undefined" ? document : null);
    if (!root || typeof root.querySelector !== "function") return false;
    const panels = root.querySelectorAll('[data-cabinet-kind="records"]');
    for (const panel of Array.from(panels || [])) {
      try {
        const source = panel.getAttribute && panel.getAttribute("data-cabinet-source");
        if (source && path && source !== path) continue;
        const head = panel.querySelector(".bob-cabinet-toggle");
        if (head && typeof head.scrollIntoView === "function") {
          head.scrollIntoView({ block: "nearest" });
          return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

// Scroll one expanded group row into view inside a mounted cabinet body.
// Matches the pending identity first, then the label. Returns true when the
// group was found and scrolled.
function cabinetRecordsScrollToGroup(scope, identity, label) {
  try {
    const root = scope || (typeof document !== "undefined" ? document : null);
    if (!root || typeof root.querySelectorAll !== "function") return false;
    const rows = root.querySelectorAll(".bob-property-card-cabinets li[data-bob-records-group]");
    const wantedIdentity = identity != null ? String(identity) : "";
    const wantedLabel = label != null ? String(label) : "";
    let fallback = null;
    for (const row of Array.from(rows || [])) {
      let value = "";
      let text = "";
      try {
        value = String(row.getAttribute("data-bob-records-group") || "");
        text = String(row.textContent || "");
      } catch (_) {}
      if (wantedIdentity && value === wantedIdentity) {
        if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
        return true;
      }
      if (!fallback && wantedLabel && text.replace(/\s+/g, " ").includes(wantedLabel)) fallback = row;
    }
    if (fallback) {
      if (typeof fallback.scrollIntoView === "function") fallback.scrollIntoView({ block: "nearest" });
      return true;
    }
  } catch (_) {}
  return false;
}

function cabinetRecordsLater(callback, ms) {
  try {
    if (typeof queueMicrotask === "function" && (!ms || ms <= 0)) {
      queueMicrotask(callback);
      return true;
    }
  } catch (_) {}
  try {
    setTimeout(callback, Math.max(0, ms || 0));
    return true;
  } catch (_) {
    return false;
  }
}

// Heading-navigation reveal: open Records and scroll its head into view.
function cabinetRecordsReveal(plugin, view, path) {
  try {
    if (typeof path !== "string" || !path) return false;
    if (typeof propertyCardCabinetSetOpen === "function") {
      propertyCardCabinetSetOpen(path, CABINET_RECORDS_KIND, true);
    }
    let requested = false;
    try {
      if (view && typeof propertyCardCabinetRequestRepaint === "function") {
        requested = propertyCardCabinetRequestRepaint(view, path, CABINET_RECORDS_KIND) === true;
      }
    } catch (_) {}
    if (!requested) {
      try { plugin?.scheduleAlbumHeaderRefresh?.(); } catch (_) {}
    }
    const scope = (() => {
      try {
        if (view && view.dom) return view.dom;
      } catch (_) {}
      try {
        if (view && view.containerEl) return view.containerEl;
      } catch (_) {}
      return null;
    })();
    cabinetRecordsLater(() => { cabinetRecordsScrollHead(scope, path); }, 60);
    return true;
  } catch (_) {
    return false;
  }
}

// Group-jump retarget (called from `apiAlbumOpenGroup` under the open gate):
// open the Records cabinet, expand the group through the existing pending
// path, and scroll the group into view. Returns true when the cabinet took
// the jump; the caller keeps today's line jump otherwise. Never throws.
async function cabinetRecordsRevealGroup(plugin, view, path, target = {}) {
  try {
    if (!plugin || !view || typeof path !== "string" || !path) return false;
    if (typeof propertyCardCabinetsGateLive === "function" && propertyCardCabinetsGateLive() !== true) return false;
    const identity = target.value || target.label;
    if (!identity) return false;
    try {
      await plugin.albumRevealRecordGroup?.(view, { ...target, path });
    } catch (_) {}
    try {
      if (typeof propertyCardCabinetSetOpen === "function") {
        propertyCardCabinetSetOpen(path, CABINET_RECORDS_KIND, true);
      }
    } catch (_) {}
    let requested = false;
    try {
      if (typeof propertyCardCabinetRequestRepaint === "function") {
        requested = propertyCardCabinetRequestRepaint(view, path, CABINET_RECORDS_KIND) === true;
      }
    } catch (_) {}
    if (!requested) {
      try { plugin.scheduleAlbumHeaderRefresh?.(); } catch (_) {}
    }
    const scope = (() => {
      try {
        if (view && view.containerEl) return view.containerEl;
      } catch (_) {}
      try {
        if (view && view.dom) return view.dom;
      } catch (_) {}
      return null;
    })();
    const attempt = () => {
      try {
        const cm = view && view.editor && view.editor.cm ? view.editor.cm : null;
        const host = cabinetRecordsFoldsHost(cm, scope);
        let folds = null;
        try {
          folds = typeof plugin.albumRecordsFoldMap === "function"
            ? plugin.albumRecordsFoldMap(host || scope || view)
            : null;
        } catch (_) {
          folds = null;
        }
        if (folds && typeof plugin.albumRecordsApplyPending === "function") {
          try { plugin.albumRecordsApplyPending(path, folds, scope); } catch (_) {}
        }
        if (folds && scope && typeof scope.querySelector === "function") {
          try {
            const callout = scope.querySelector('.bob-property-card-cabinets [data-callout="records"]');
            if (callout && folds) cabinetRecordsPaintCallout(plugin, callout, path, folds, scope);
          } catch (_) {}
        }
      } catch (_) {}
      return cabinetRecordsScrollToGroup(scope, identity, target.label || "");
    };
    if (attempt() === true) return true;
    let retries = 0;
    const retry = () => {
      if (retries >= CABINET_RECORDS_JUMP_RETRIES) return;
      retries += 1;
      if (attempt() === true) return;
      cabinetRecordsLater(retry, CABINET_RECORDS_JUMP_RETRY_MS);
    };
    cabinetRecordsLater(retry, CABINET_RECORDS_JUMP_RETRY_MS);
    return true;
  } catch (_) {
    return false;
  }
}

// The painter stand-down check for the 241t inline painters: skip callouts
// already inside a cabinet body, and skip absorbed callouts the cabinet
// stands in for. Reading and editor painters both route through here.
function albumRecordsCabinetStandDown(callout, view, path) {
  try {
    if (typeof propertyCardCabinetStandDown === "function"
      && propertyCardCabinetStandDown(callout, view, path, CABINET_RECORDS_KIND)) return true;
  } catch (_) {}
  try {
    if (callout && typeof callout.closest === "function" && callout.closest(".bob-cabinet-absorbed")) return true;
  } catch (_) {}
  return false;
}

// Register the records provider for one plugin instance. Idempotent per
// plugin; the unregister releases both the provider slot and live bodies.
function cabinetRecordsRegisterProvider(plugin) {
  try {
    if (!plugin || typeof plugin !== "object") return () => false;
    if (typeof propertyCardRegisterCabinetProvider !== "function") return () => false;
    if (typeof plugin.cabinetRecordsUnregister === "function") return plugin.cabinetRecordsUnregister;
    const provider = {
      applies: (context) => cabinetRecordsAppliesFor(plugin, context || {}),
      paintKey: (path) => cabinetRecordsPaintKeyFor(plugin, path),
      buildBody: ({ doc, path, view, component, container }) => {
        cabinetRecordsBuildBody(plugin, { doc, path, view, component, container });
      },
      onOpen: ({ path, view } = {}) => {
        try {
          const record = cabinetRecordsLastApplies.get(path);
          if (!record || !record.plan || !record.fingerprint) return;
          cabinetRecordsClaimBody(plugin, {
            view: view && typeof view.dispatch === "function" ? view : null,
            container: (() => {
              try {
                if (view && view.dom && typeof view.dom.querySelector === "function") {
                  const panel = view.dom.querySelector('[data-cabinet-kind="records"]');
                  if (panel) return panel;
                }
              } catch (_) {}
              return null;
            })(),
            path,
            fingerprint: record.fingerprint,
            plan: record.plan,
            component: plugin,
          });
        } catch (_) {}
      },
      onClose: ({ path, view } = {}) => {
        try { cabinetRecordsReleaseBody(view && typeof view.dispatch === "function" ? view : null, path); } catch (_) {}
      },
      onBuildError: ({ path, view } = {}) => {
        try { cabinetRecordsReleaseBody(view || null, path); } catch (_) {}
      },
      repaintNative: () => {
        try {
          if (typeof plugin.scheduleAlbumRecordsRefresh === "function") plugin.scheduleAlbumRecordsRefresh();
        } catch (_) {}
      },
    };
    const unregister = propertyCardRegisterCabinetProvider(plugin, CABINET_RECORDS_KIND, provider);
    if (typeof unregister !== "function") return () => false;
    const release = () => {
      let ok = false;
      try { ok = unregister() === true; } catch (_) {}
      try { cabinetRecordsReleasePlugin(plugin); } catch (_) {}
      try {
        if (plugin.cabinetRecordsUnregister === release) plugin.cabinetRecordsUnregister = null;
      } catch (_) {}
      return ok;
    };
    try {
      plugin.cabinetRecordsUnregister = release;
    } catch (_) {}
    return release;
  } catch (_) {
    return () => false;
  }
}

function cabinetRecordsTeardownPlugin(plugin) {
  try {
    cabinetRecordsReleasePlugin(plugin);
  } catch (_) {}
  try {
    if (plugin) {
      if (typeof plugin.cabinetRecordsUnregister === "function") {
        const release = plugin.cabinetRecordsUnregister;
        plugin.cabinetRecordsUnregister = null;
        try { release(); } catch (_) {}
      }
    }
  } catch (_) {}
}
