// Area/project host catalogs rendered as lazy property-card cabinets. The
// providers reuse each catalog's report model, painter, and explicit Sync
// gesture; they never write note bytes during paint.
const PROPERTY_CARD_HOST_CATALOG_KINDS = Object.freeze(["areas", "projects", "notebooks", "albums"]);
const PROPERTY_CARD_HOST_CATALOG_HEADINGS = Object.freeze({
  areas: "Areas",
  projects: "Projects",
  notebooks: "Notebooks",
  albums: "Albums",
});

function propertyCardCabinetHostReportState(plugin, kind) {
  try {
    if (kind === "areas") return plugin?.areasCatalogState?.() || { report: null };
    if (kind === "projects") return plugin?.projectsReportState?.() || { report: null };
    if (kind === "notebooks") return plugin?.notebookCatalogState?.() || { report: null };
    if (kind === "albums") return plugin?.albumReportState?.() || { report: null };
  } catch (_) {}
  return { report: null };
}

function propertyCardCabinetHostCatalog(state, kind, path) {
  try {
    if (kind === "areas") return areasCardHost(state, path);
    if (kind === "projects") return projectsCardHost(state, path);
    if (kind === "notebooks") return notebookHostCatalog(state, path);
    if (kind === "albums") return albumHostCatalog(state, path);
  } catch (_) {}
  return null;
}

function propertyCardCabinetHostSourceCounts(region) {
  const result = { direct: 0, nested: 0 };
  try {
    const lines = Array.isArray(region?.lines) ? region.lines.slice(1) : [];
    for (const raw of lines) {
      const line = String(raw).replace(/^ {0,3}>\s?/, "");
      const match = /^(\s*)[-+*]\s+.*\[\[[^\]]+\]\]/.exec(line);
      if (!match) continue;
      if (match[1].length === 0) result.direct += 1;
      else result.nested += 1;
    }
  } catch (_) {}
  return result;
}

function propertyCardCabinetHostReportRows(plugin, kind, state, path) {
  try {
    if (kind === "areas") return areasCardRows(state, path);
    if (kind === "projects") return projectsCardRowEntries(state, path);
    if (kind === "notebooks") {
      return [];
    }
    if (kind === "albums") {
      return [];
    }
  } catch (_) {}
  void plugin;
  return [];
}

function propertyCardCabinetHostReportTally(kind, state, path, rows) {
  try {
    if (kind === "areas") {
      const catalog = propertyCardCabinetHostCatalog(state, kind, path);
      const direct = rows.filter((row) => Number(row?.depth || 0) === 0).length;
      const nested = rows.length - direct;
      if (rows.length) return { direct, nested, meta: nested ? `${direct} direct · ${nested} nested` : "" };
      const stored = Number.isInteger(catalog?.rows?.length) ? catalog.rows.length : null;
      return stored === null ? null : { direct: stored, nested: 0, meta: "" };
    }
    if (kind === "projects") {
      const tally = projectsCardTally(projectsCardPartition(rows));
      return { direct: rows.length, nested: 0, meta: rows.length ? tally.full : "" };
    }
    if (kind === "notebooks") {
      const catalog = propertyCardCabinetHostCatalog(state, kind, path);
      return Number.isInteger(catalog?.notebooks)
        ? { direct: catalog.notebooks, nested: 0, meta: "" } : null;
    }
    if (kind === "albums") {
      const catalog = propertyCardCabinetHostCatalog(state, kind, path);
      return Number.isInteger(catalog?.albums)
        ? { direct: catalog.albums, nested: 0, meta: "" } : null;
    }
  } catch (_) {}
  return null;
}

function propertyCardCabinetHostStatus(plugin, kind, state, path) {
  try {
    if (kind === "areas") return areasCardStatus(state, path);
    if (kind === "projects") return projectsCardStatus(state, path);
    if (kind === "notebooks") return notebookStatusModel(state);
    if (kind === "albums") return albumCatalogStatus(state, path);
  } catch (_) {}
  void plugin;
  return null;
}

function propertyCardCabinetHostAction(action, handlers) {
  if (!action || !handlers) return null;
  const kind = typeof action.kind === "string" ? action.kind : "";
  const onClick = kind && typeof handlers[kind] === "function" ? handlers[kind] : null;
  if (!onClick || !action.label) return null;
  return {
    label: action.label,
    title: action.hint || action.label,
    ariaLabel: action.hint || action.label,
    disabled: action.disabled === true,
    onClick,
  };
}

function propertyCardCabinetHostStatusParts(plugin, kind, state, path, catalog, regionScan, reportCount, handlers) {
  const status = propertyCardCabinetHostStatus(plugin, kind, state, path) || {};
  const actions = [];
  const seen = new Set();
  const append = (action) => {
    const built = propertyCardCabinetHostAction(action, handlers);
    const key = action?.kind || built?.label;
    if (!built || seen.has(key)) return;
    seen.add(key);
    actions.push(built);
  };
  append(status.action);
  append(status.retry);
  if (status.copy && typeof handlers?.copy === "function") {
    append({ kind: "copy", label: status.copy.label, hint: status.copy.hint });
  }

  const catalogState = String(catalog?.state || "");
  const missing = !regionScan?.regions?.length
    && (reportCount > 0 || catalogState === "missing");
  const damaged = Boolean(regionScan?.damage || catalogState === "damaged");
  const stale = !damaged && !missing && (catalogState === "stale" || state?.stale === true);
  const needsSync = damaged || missing || catalogState === "missing" || catalogState === "stale";
  if (needsSync && typeof handlers?.sync === "function") {
    const reason = damaged ? "This catalog is damaged. Review the note, then sync it."
      : missing ? "This catalog is missing. Sync to write it."
        : `This catalog is ${catalogState || "stale"}. Sync to refresh it.`;
    const busy = state?.syncBusy === true;
    append({ kind: "sync", label: busy ? "Syncing…" : "↻ Sync", hint: reason, disabled: busy });
  }
  let attention = null;
  if (damaged || missing || stale) {
    const word = damaged ? "damaged" : missing ? "missing" : "stale";
    attention = {
      icon: "⚠",
      word,
      tone: damaged ? "error" : "warning",
      title: regionScan?.damage?.message || status.message || reasonForCabinetAttention(word),
      ariaLabel: `${word} catalog`,
    };
  } else if (state?.errorModel && !state?.report) {
    attention = { icon: "⚠", word: "unavailable", tone: "warning", title: state.errorModel.hint || "Catalog data is unavailable." };
  }
  const problems = [
    damaged ? "damaged" : missing ? "missing" : stale ? "stale" : "",
    catalogState && catalogState !== "current" ? catalogState : "",
    state?.stale ? "report-stale" : "",
  ]
    .filter(Boolean).join(":");
  return { attention, actions, problems, status };
}

function reasonForCabinetAttention(word) {
  return `${word} catalog; use Sync to refresh the generated section.`;
}

function propertyCardCabinetHostApply(plugin, kind, context = {}) {
  try {
    const path = String(context.path || "");
    const species = String(context.species || "");
    const source = typeof context.source === "string" ? context.source : null;
    if (!path || (species !== "area" && species !== "project") || source === null || source.trim() === "") return null;
    const scans = propertyCardCatalogRegions(source);
    const scan = scans?.[kind] || { regions: [], damage: null };
    const region = !scan.damage && Array.isArray(scan.regions) ? scan.regions[0] || null : null;
    const hidePlan = propertyCardCatalogRegionForHide(source, kind);
    const state = propertyCardCabinetHostReportState(plugin, kind);
    const catalog = propertyCardCabinetHostCatalog(state, kind, path);
    const rows = propertyCardCabinetHostReportRows(plugin, kind, state, path);
    const tally = propertyCardCabinetHostReportTally(kind, state, path, rows);
    const stored = propertyCardCabinetHostSourceCounts(region);
    const reportCount = tally ? tally.direct + tally.nested : 0;
    const storedCount = stored.direct + stored.nested;
    const hasUsefulRegion = Boolean(region && storedCount > 0);
    const hasReportChildren = reportCount > 0;
    const catalogState = String(catalog?.state || "");
    const damaged = Boolean(scan.damage || catalogState === "damaged");
    const needsRefresh = ["missing", "stale"].includes(catalogState);
    if (!hasUsefulRegion && !hasReportChildren && !damaged && !needsRefresh) return null;

    const counts = storedCount > 0 ? stored : (tally || { direct: reportCount, nested: 0 });
    const noun = kind === "areas" ? "area" : kind === "projects" ? "project" : kind === "notebooks" ? "notebook" : "album";
    const total = counts.direct + counts.nested;
    const phrase = `${total} ${total === 1 ? noun : `${noun}s`}`;
    const summary = counts.nested > 0 ? `${phrase} · ${counts.nested} nested` : phrase;
    const paintOptions = propertyCardCabinetHostPaintOptions(plugin, kind, path, null, state);
    const statusParts = propertyCardCabinetHostStatusParts(
      plugin, kind, state, path, catalog, scan, reportCount, paintOptions.handlers,
    );
    const meta = kind === "projects" && tally?.meta ? tally.meta : "";
    return {
      summary,
      meta,
      metaTitle: meta,
      attention: statusParts.attention,
      actions: statusParts.actions,
      problems: statusParts.problems,
      region,
      plan: hidePlan && !hidePlan.damage ? hidePlan : null,
      damage: scan.damage || hidePlan?.damage || null,
      state,
      catalog,
      rows,
      tally,
      reportCount,
      sourceCount: storedCount,
      status: statusParts.status,
    };
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetHostPaintOptions(plugin, kind, path, view, givenState) {
  const state = givenState || propertyCardCabinetHostReportState(plugin, kind);
  const editor = view && (typeof view === "object" || typeof view === "function") ? view : null;
  let options = {};
  try {
    if (kind === "areas") {
      const folds = editor ? plugin.areasCatalogFoldMap(editor) : new Map();
      options = plugin.areasCatalogOptions(path, folds, state) || {};
    } else if (kind === "projects") {
      const folds = editor ? plugin.projectsCatalogFoldMap(editor) : new Map();
      options = plugin.projectsCatalogOptions(path, folds) || {};
    } else if (kind === "notebooks") {
      options = plugin.notebookCatalogPaintOptions(path, state) || {};
    } else if (kind === "albums") {
      options = plugin.albumCatalogOptions(path) || {};
    }
  } catch (_) {}
  options.view = view || null;
  options.cabinetBody = true;
  return options;
}

// Digest memo (bob-cli-qq perf): one card paint asks for this digest once per
// provider paintKey and again for the foot signature, and each pass applies
// all four kinds and stringifies every full report. Reuse it while the source
// and every kind's report-state fields are unchanged; data services replace
// report and error objects on refresh, so identity is enough.
const PROPERTY_CARD_CABINET_HOST_DIGEST_MEMO_LIMIT = 40;

function propertyCardCabinetHostStateSignature(state) {
  if (!state || typeof state !== "object") return [null];
  return [
    state.report || null, state.stale === true, state.unavailable === true, state.refreshing === true,
    state.syncBusy === true, state.error || null, state.syncError || null, state.today ?? null,
    state.generation ?? null, state.reportGeneration ?? null,
  ];
}

function propertyCardCabinetHostSignaturesEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!propertyCardCabinetHostSignaturesEqual(a, b)) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}

function propertyCardCabinetHostDigest(plugin, path, source) {
  try {
    const currentSource = typeof source === "string" ? source : propertyCardCabinetHostSource(plugin, path, null);
    const signature = PROPERTY_CARD_HOST_CATALOG_KINDS
      .map((kind) => propertyCardCabinetHostStateSignature(propertyCardCabinetHostReportState(plugin, kind)));
    let memo = plugin?.cabinetHostDigestMemo;
    if (plugin && !(memo instanceof Map)) {
      memo = new Map();
      try { plugin.cabinetHostDigestMemo = memo; } catch (_) { memo = null; }
    }
    const key = String(path || "");
    const hit = memo instanceof Map ? memo.get(key) : null;
    if (hit && hit.source === currentSource && propertyCardCabinetHostSignaturesEqual(hit.signature, signature)) return hit.digest;
    const digest = propertyCardCabinetHostDigestCompute(plugin, path, currentSource);
    if (memo instanceof Map && digest) {
      memo.delete(key);
      memo.set(key, { source: currentSource, signature, digest });
      while (memo.size > PROPERTY_CARD_CABINET_HOST_DIGEST_MEMO_LIMIT) memo.delete(memo.keys().next().value);
    }
    return digest;
  } catch (_) {
    return "";
  }
}

function propertyCardCabinetHostDigestCompute(plugin, path, currentSource) {
  try {
    let species = "area";
    try { species = plugin?.homeCardCardModelFor?.(path, currentSource)?.kind || species; } catch (_) {}
    const digests = [];
    for (const kind of PROPERTY_CARD_HOST_CATALOG_KINDS) {
      const applied = propertyCardCabinetHostApply(plugin, kind, { path, species, source: currentSource });
      const state = propertyCardCabinetHostReportState(plugin, kind);
      const reportText = JSON.stringify(propertyCardCabinetHostStableValue({
        report: state?.report || null,
        stale: state?.stale === true,
        unavailable: state?.unavailable === true,
        refreshing: state?.refreshing === true,
        syncBusy: state?.syncBusy === true,
        errorModel: state?.errorModel || null,
        syncErrorModel: state?.syncErrorModel || null,
      }));
      digests.push([kind, propertyCardCabinetFingerprint(reportText || ""), applied?.summary || "", applied?.meta || "", applied?.problems || ""]);
    }
    return JSON.stringify([propertyCardCabinetFingerprint(currentSource || ""), digests]);
  } catch (_) {
    return "";
  }
}

function propertyCardCabinetHostStableValue(value, ancestors = new Set()) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[cycle]";
  const next = new Set(ancestors);
  next.add(value);
  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]) => [propertyCardCabinetHostStableValue(key, next), propertyCardCabinetHostStableValue(item, next)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value instanceof Set) {
    return Array.from(value.values())
      .map((item) => propertyCardCabinetHostStableValue(item, next))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (Array.isArray(value)) return value.map((item) => propertyCardCabinetHostStableValue(item, next));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = propertyCardCabinetHostStableValue(value[key], next);
  }
  return out;
}

function propertyCardCabinetHostSource(plugin, path, fallback) {
  try {
    if (typeof fallback === "string") return fallback;
    const live = plugin?.homeCardSourceCache?.get?.(path);
    if (typeof live === "string") return live;
    const album = plugin?.albumHeaderSourceCache?.get?.(path);
    if (typeof album === "string") return album;
  } catch (_) {}
  return "";
}

function propertyCardCabinetHostPaintKey(plugin, kind, path) {
  void kind;
  return propertyCardCabinetHostDigest(plugin, path, propertyCardCabinetHostSource(plugin, path, null));
}

function propertyCardCabinetHostRemoveInlineStatus(callout, kind) {
  try {
    const selector = kind === "areas" ? ".bob-areas-status" : kind === "projects" ? ".bob-projects-status" : "";
    if (!selector) return;
    for (const node of Array.from(callout?.querySelectorAll?.(selector) || [])) node.remove?.();
  } catch (_) {}
}

// Release-time repaint for the deferred inline paint (bob-cli-qq perf): a
// failed cabinet body releases its absorption claim, leaving the stored
// callout visible. Its inline paint was skipped, so repaint it through the
// kind's existing refresh loop (passive: never writes or spawns).
function propertyCardCabinetHostRepaintNative(plugin, kind) {
  try {
    if (!plugin || !kind) return;
    if (kind === "areas" && typeof plugin.scheduleAreasCatalogRefresh === "function") plugin.scheduleAreasCatalogRefresh();
    else if (kind === "projects" && typeof plugin.scheduleProjectsCatalogRefresh === "function") plugin.scheduleProjectsCatalogRefresh();
    else if (kind === "notebooks" && typeof plugin.scheduleNotebookCatalogRefresh === "function") plugin.scheduleNotebookCatalogRefresh();
    else if (kind === "albums" && typeof plugin.scheduleAlbumCatalogRefresh === "function") plugin.scheduleAlbumCatalogRefresh();
  } catch (_) {}
}

function propertyCardCabinetHostPainter(kind) {
  return kind === "areas" ? areasPaintCallout
    : kind === "projects" ? projectsPaintCallout
      : kind === "notebooks" ? notebookPaintCallout
        : kind === "albums" ? albumPaintCallout : null;
}

function propertyCardCabinetHostPaintMissing(plugin, kind, context, applied) {
  const { doc, path, container, view } = context;
  const options = propertyCardCabinetHostPaintOptions(plugin, kind, path, view, applied.state);
  const host = doc.createElement("div");
  host.setAttribute("class", "bob-cabinet-content bob-cabinet-provider-status");
  container.appendChild(host);
  if (kind === "areas") return areasPaintStandalone(host, options);
  if (kind === "projects") return projectsPaintStandalone(host, options);
  if (kind === "notebooks") {
    const state = applied.state || {};
    const status = notebookStatusModel(state) || {
      kind: applied.damage ? "damaged" : "missing",
      hint: applied.damage?.message || `The ${PROPERTY_CARD_HOST_CATALOG_HEADINGS[kind]} catalog is missing. Sync to write it.`,
    };
    return notebookPaintStatus(host, status, options.handlers, doc);
  }
  const model = albumCatalogStatus(applied.state || {}, path) || { message: "" };
  if (!model.action && applied.attention && typeof options.handlers?.sync === "function") {
    model.action = { kind: "sync", label: "↻ Sync", hint: applied.attention.title || "Sync this catalog.", disabled: false };
  }
  return albumPaintStatus(host, model, options.handlers);
}

async function propertyCardCabinetHostBuildBody(plugin, kind, context = {}) {
  const path = String(context.path || "");
  const source = propertyCardCabinetHostSource(plugin, path, context.source);
  const applied = propertyCardCabinetHostApply(plugin, kind, {
    path, species: context.species, source, frontmatter: context.frontmatter,
  });
  if (!applied || !context.doc || !context.container) return { failed: true };
  if (!applied.region) {
    propertyCardCabinetHostPaintMissing(plugin, kind, context, applied);
    return { failed: false };
  }
  const painter = propertyCardCabinetHostPainter(kind);
  const options = propertyCardCabinetHostPaintOptions(plugin, kind, path, context.view, applied.state);
  options.doc = context.doc;
  const result = await propertyCardCabinetRenderCatalog({
    plugin,
    doc: context.doc,
    container: context.container,
    path,
    component: context.component,
    paintKey: propertyCardCabinetHostPaintKey(plugin, kind, path),
    regionSource: applied.region.lines.join("\n"),
    nativeCallout: context.readingScope && typeof context.view?.dispatch !== "function"
      ? propertyCardCabinetReadingNativeCallout(context.readingScope, applied.plan) : null,
    calloutKind: kind,
    releaseClaim: context.releaseClaim,
    repaintNative: () => propertyCardCabinetHostRepaintNative(plugin, kind),
    paint: async (callout) => {
      if (!callout || callout.getAttribute?.("data-callout") !== kind || typeof painter !== "function") {
        throw new Error(`The ${kind} cabinet body did not render its stored callout.`);
      }
      options.view = context.view || null;
      options.cabinetBody = true;
      await painter(callout, options);
      propertyCardCabinetHostRemoveInlineStatus(callout, kind);
    },
  });
  if (result?.failed) {
    try { context.releaseClaim?.(); } catch (_) {}
    return result;
  }
  return result;
}

function propertyCardCabinetHostReveal(panel, path, kind) {
  try {
    if (!panel || panel.isConnected === false) return false;
    const control = panel?.querySelector?.(".bob-cabinet-toggle");
    if (!control) return false;
    if (control.getAttribute?.("aria-expanded") !== "true") control.click?.();
    if (control.getAttribute?.("aria-expanded") !== "true") return false;
    const head = panel.querySelector?.(".bob-cabinet-head") || control;
    head.scrollIntoView?.({ block: "nearest" });
    void path;
    void kind;
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetHostMountClaim(kind, plugin, context = {}) {
  try {
    const { path, view, panel, applied, source, readingScope } = context;
    if (!view || !panel || !applied?.plan || applied.plan.damage) return null;
    const liveSource = propertyCardCabinetHostSource(plugin, path, view?.state?.doc?.toString?.() || source);
    const plan = propertyCardCatalogRegionForHide(liveSource, kind);
    if (!plan || plan.damage || plan.fingerprint !== applied.plan.fingerprint) return null;
    let releaseAbsorption = null;
    let tagged = [];
    let reading = false;
    if (view?.state?.doc && typeof view.dispatch === "function") {
      releaseAbsorption = propertyCardCabinetAbsorbInEditor(view, {
        path, kind, fingerprint: plan.fingerprint,
      });
      if (typeof releaseAbsorption !== "function") return null;
    } else {
      const scope = readingScope || view?.containerEl || view?.contentEl || view?.dom || null;
      tagged = propertyCardCabinetAbsorbPaintReading(scope, plan, true);
      if (!tagged.length) return null;
      reading = true;
      releaseAbsorption = () => propertyCardCabinetAbsorbUntagReading(tagged);
    }
    let generation = releaseAbsorption.generation;
    if (generation == null) generation = `${Date.now()}:${Math.random()}`;
    const releaseClaim = propertyCardCatalogClaim({
      view,
      path,
      kind,
      fingerprint: plan.fingerprint,
      generation,
      reveal: () => propertyCardCabinetHostReveal(panel, path, kind),
    });
    return () => {
      try { releaseClaim(); } catch (_) {}
      // A replacement mount for the same view, note, and kind tags the same
      // rendered Reading nodes before the mount registry releases this
      // superseded one (240wl, 240wb). Its tags belong to the live claim, so a
      // superseded Reading release leaves them in place.
      let superseded = false;
      if (reading) {
        try {
          const live = propertyCardCatalogClaimEntry(view, path, kind);
          superseded = Boolean(live && !live.released);
        } catch (_) {
          superseded = false;
        }
      }
      if (!superseded) {
        try { releaseAbsorption(); } catch (_) {}
        try { if (tagged.length) propertyCardCabinetAbsorbUntagReading(tagged); } catch (_) {}
      }
      tagged = [];
    };
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetHostRevealNavigation(plugin, event) {
  try {
    const origin = event?.target?.nodeType === 1 ? event.target : event?.target?.parentElement;
    const target = origin?.closest?.("a.internal-link, a[data-href], .outline .tree-item-self, .outline .tree-item-inner");
    if (!target) return false;
    const MarkdownViewCtor = require("obsidian").MarkdownView;
    const active = plugin?.app?.workspace?.getActiveViewOfType?.(MarkdownViewCtor);
    const activePath = String(active?.file?.path || "");
    if (!activePath) return false;
    let heading = "";
    const href = target.getAttribute?.("data-href") || target.getAttribute?.("href") || "";
    if (href.includes("#")) heading = href.slice(href.indexOf("#") + 1).split("|")[0];
    else if (target.closest?.(".outline")) heading = target.textContent || "";
    try { heading = decodeURIComponent(heading).replace(/^#+/, "").trim(); } catch (_) {}
    const kind = Object.keys(PROPERTY_CARD_HOST_CATALOG_HEADINGS)
      .find((candidate) => PROPERTY_CARD_HOST_CATALOG_HEADINGS[candidate].toLowerCase() === heading.toLowerCase());
    if (!kind) return false;
    if (href.includes("#")) {
      const noteTarget = href.slice(0, href.indexOf("#")).trim();
      if (noteTarget) {
        const destination = plugin?.app?.metadataCache?.getFirstLinkpathDest?.(noteTarget, activePath);
        if (destination?.path && destination.path !== activePath) return false;
      }
    }
    // Prefer the active reading host's live panel. A reading-mode claim can
    // outlive a panel replacement, so its reveal closure may point at an
    // obsolete element even while it still reports a successful claim.
    const root = active?.previewMode?.containerEl || active?.containerEl;
    const panel = root?.querySelector?.(`.${PROPERTY_CARD_CABINET_STACK_CLASS} [data-cabinet-kind="${kind}"][data-cabinet-source="${activePath}"]`)
      || root?.querySelector?.(`[data-cabinet-kind="${kind}"][data-cabinet-source="${activePath}"]`);
    const storedRegion = root?.querySelector?.(`.bob-cabinet-absorbed[data-callout="${kind}"]`);
    if (panel && storedRegion && propertyCardCabinetHostReveal(panel, activePath, kind)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    const candidates = [active, active?.editor?.cm, active?.previewMode?.renderer].filter(Boolean);
    for (const view of candidates) {
      if (!propertyCardCatalogRevealClaim(view, activePath, kind)) continue;
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetHostInstall(plugin) {
  if (!plugin || plugin.cabinetHostCatalogsSetup === true) return false;
  plugin.cabinetHostCatalogsSetup = true;
  try {
    const extension = propertyCardCabinetAbsorbEditorExtension();
    if (extension) plugin.registerEditorExtension?.(extension);
  } catch (_) {}
  const registrations = [];
  for (const kind of PROPERTY_CARD_HOST_CATALOG_KINDS) {
    const provider = {
      applies: (context) => propertyCardCabinetHostApply(plugin, kind, context),
      paintKey: (path) => propertyCardCabinetHostPaintKey(plugin, kind, path),
      buildBody: (context) => propertyCardCabinetHostBuildBody(plugin, kind, context),
      // The claim lives in onMounted, so a hidden Live Preview body can wait
      // for its editor to show without leaving the stored section unclaimed.
      deferWhileHidden: true,
      onMounted: (context) => propertyCardCabinetHostMountClaim(kind, plugin, context),
      repaintNative: () => propertyCardCabinetHostRepaintNative(plugin, kind),
    };
    registrations.push(propertyCardRegisterCabinetProvider(plugin, kind, provider));
  }
  plugin.cabinetHostCatalogProviderReleases = registrations;
  const refreshCards = () => {
    try { plugin.scheduleHomeCardRefresh?.(); } catch (_) {}
  };
  for (const subscribe of [plugin.apiAreasSubscribe, plugin.apiProjectsSubscribe, plugin.apiNotebookSubscribe, plugin.apiAlbumSubscribe]) {
    if (typeof subscribe !== "function") continue;
    try {
      const release = subscribe.call(plugin, refreshCards);
      if (typeof release === "function") plugin.register?.(release);
    } catch (_) {}
  }
  try {
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && typeof plugin.registerDomEvent === "function") {
      plugin.registerDomEvent(doc, "click", (event) => propertyCardCabinetHostRevealNavigation(plugin, event), true);
    }
  } catch (_) {}
  return true;
}

class BobLedgerToolsCabinetHostCatalogsMixin {
  setupCabinetHostCatalogs() {
    return propertyCardCabinetHostInstall(this);
  }
}
