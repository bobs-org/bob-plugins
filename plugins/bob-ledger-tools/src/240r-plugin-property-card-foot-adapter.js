// Shared property-card foot adapter helpers (bob-cli-pf adapters).
// Album, day/week/quarter/year, and bank setup reuse these so each mixin
// only declares truthful where-marks, nested openers, and species jumps.
function propertyCardFootAdapterPath(value) {
  return typeof propertyCardFootPath === "function"
    ? propertyCardFootPath(value)
    : (typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "");
}

function propertyCardFootAdapterPendingInventory(reason = "kit-unavailable") {
  return { state: "pending", reason, rows: [], groups: [], count: 0, issues: [], recovery: null };
}

function propertyCardFootAdapterFrontmatter(plugin, path) {
  try {
    const key = propertyCardFootAdapterPath(path);
    const file = plugin?.app?.vault?.getAbstractFileByPath?.(key);
    const cache = file ? plugin.app?.metadataCache?.getFileCache?.(file) : null;
    const fm = cache?.frontmatter;
    return fm && typeof fm === "object" && !Array.isArray(fm) ? fm : {};
  } catch (_) {
    return {};
  }
}

function propertyCardFootAdapterCanRead(plugin) {
  try {
    if (plugin?.app?.vault && typeof plugin.app.vault.read === "function") return true;
  } catch (_) {}
  try {
    if (plugin?.app?.vault?.adapter && typeof plugin.app.vault.adapter.read === "function") return true;
  } catch (_) {}
  return false;
}

function propertyCardFootAdapterReadSource(plugin, path) {
  const key = propertyCardFootAdapterPath(path);
  return Promise.resolve().then(async () => {
    try {
      const file = plugin?.app?.vault?.getAbstractFileByPath?.(key);
      if (file && plugin.app?.vault && typeof plugin.app.vault.read === "function") {
        return await plugin.app.vault.read(file);
      }
    } catch (_) {}
    try {
      const adapter = plugin?.app?.vault?.adapter;
      if (adapter && typeof adapter.read === "function") return await adapter.read(key);
    } catch (_) {}
    return null;
  });
}

function propertyCardFootAdapterRememberSource(cache, path, text) {
  const key = propertyCardFootAdapterPath(path);
  if (!key || typeof text !== "string" || !(cache instanceof Map)) return text;
  cache.set(key, text);
  return text;
}

function propertyCardFootAdapterEnsureSource(plugin, path, maps) {
  const key = propertyCardFootAdapterPath(path);
  if (!key || !maps || !(maps.cache instanceof Map) || !(maps.flights instanceof Map)) return null;
  if (maps.cache.has(key)) return Promise.resolve(maps.cache.get(key));
  if (maps.flights.has(key)) return maps.flights.get(key);
  if (typeof maps.canRead === "function" ? !maps.canRead() : !propertyCardFootAdapterCanRead(plugin)) return null;
  const flight = Promise.resolve()
    .then(() => (typeof maps.read === "function" ? maps.read(key) : propertyCardFootAdapterReadSource(plugin, key)))
    .then((source) => {
      if (typeof maps.active === "function" && maps.active() === false) return "";
      if (maps.flights.get(key) !== flight) return "";
      if (source == null) return "";
      const text = String(source);
      const previous = maps.cache.has(key) ? maps.cache.get(key) : undefined;
      maps.cache.set(key, text);
      if (!(previous === undefined && text === "")) maps.refresh?.();
      return text;
    })
    .catch(() => "")
    .finally(() => {
      if (maps.flights.get(key) === flight) maps.flights.delete(key);
    });
  maps.flights.set(key, flight);
  return flight;
}

function propertyCardFootAdapterSpec(options = {}) {
  const path = propertyCardFootAdapterPath(options.path);
  const frontmatter = options.frontmatter && typeof options.frontmatter === "object" && !Array.isArray(options.frontmatter)
    ? options.frontmatter : {};
  const where = options.where && typeof options.where === "object" ? options.where : {};
  const nested = options.nested && typeof options.nested === "object" ? options.nested : {};
  const legacy = options.legacy && typeof options.legacy === "object" ? options.legacy : {};
  const sourceText = typeof options.sourceText === "string" ? options.sourceText : undefined;
  let inventory = null;
  try {
    inventory = typeof propertyCardInventory === "function"
      ? propertyCardInventory({
        path,
        sourcePath: options.sourcePath || (sourceText !== undefined ? path : ""),
        cachePath: options.cachePath || path,
        sourceText,
        frontmatter,
        parseYaml: typeof parseYaml === "function" ? parseYaml : null,
        where,
        nested,
        legacy,
      })
      : null;
  } catch (_) {
    inventory = null;
  }
  if (!inventory) inventory = propertyCardFootAdapterPendingInventory();
  const createdRow = Array.isArray(inventory.rows)
    ? inventory.rows.find((row) => row && row.key === "created")
    : null;
  let stamp = null;
  try {
    stamp = typeof propertyCardFormatCreatedStamp === "function"
      ? propertyCardFormatCreatedStamp({
        kind: options.kind || "",
        temporal: options.temporal === true,
        value: frontmatter.created,
        present: Object.prototype.hasOwnProperty.call(frontmatter, "created"),
        sourceScalar: createdRow ? createdRow.sourceScalar : "",
        noteDate: options.noteDate,
        clock: options.clock,
        now: options.now,
        timeZone: options.timeZone,
      })
      : null;
  } catch (_) {
    stamp = null;
  }
  return { path, inventory, stamp };
}

function propertyCardFootAdapterDigest(spec) {
  try {
    const rows = Array.isArray(spec?.inventory?.rows) ? spec.inventory.rows : [];
    return JSON.stringify({
      state: spec?.inventory?.state || "",
      stamp: spec?.stamp?.text || "",
      rows: rows.map((row) => [
        row.key,
        row.occurrence,
        row.line,
        row.valueState,
        typeof propertyCardFootRowText === "function" ? propertyCardFootRowText(row) : String(row.value),
      ]),
    });
  } catch (_) {
    return "";
  }
}

function propertyCardFootAdapterExtra(path, spec) {
  let open = false;
  try {
    open = typeof propertyCardFootIsOpen === "function" && propertyCardFootIsOpen(path);
  } catch (_) {}
  return { footOpen: open, footDigest: propertyCardFootAdapterDigest(spec), footSpec: spec };
}

function propertyCardFootOpenTagSearch(app, tag) {
  const name = String(tag || "").trim().replace(/^#+/, "");
  if (!name) return false;
  const query = `tag:#${name}`;
  try {
    const globalSearch = app?.internalPlugins?.getPluginById?.("global-search")?.instance;
    const openGlobalSearch = globalSearch?.openGlobalSearch;
    if (typeof openGlobalSearch === "function") {
      openGlobalSearch.call(globalSearch, query);
      return true;
    }
  } catch (_) {}
  try {
    const commands = app?.commands;
    if (commands && typeof commands.executeCommandById === "function") {
      const opened = commands.executeCommandById("global-search:open");
      if (opened === false) return false;
      return true;
    }
  } catch (_) {}
  return false;
}

function propertyCardFootAdapterSearchTag(plugin, tag) {
  return propertyCardFootOpenTagSearch(plugin?.app, tag);
}

function propertyCardFootAdapterHoverLink(plugin, event, targetEl, linktext, sourcePath, source) {
  try {
    plugin?.app?.workspace?.trigger?.("hover-link", {
      event,
      source: source || "bob-property-card",
      hoverParent: targetEl,
      targetEl,
      linktext: String(linktext || ""),
      sourcePath: String(sourcePath || ""),
    });
  } catch (_) {}
}

function propertyCardFootAdapterHandlers(plugin, path, options = {}) {
  const refresh = typeof options.refresh === "function" ? options.refresh : () => {};
  const pending = options.pendingScroll;
  return {
    onToggle: (notePath, next) => {
      let decided = next;
      try {
        if (typeof propertyCardFootToggle === "function") {
          propertyCardFootToggle(notePath);
          decided = propertyCardFootIsOpen(notePath);
        }
      } catch (_) {}
      if (decided === true && pending instanceof Set) pending.add(propertyCardFootAdapterPath(notePath));
      refresh();
      return decided;
    },
    jumpYaml: (key, line) => { void options.jumpYaml?.(key, line); },
    jumpRecovery: () => { void options.jumpRecovery?.(); },
    openPath: (target, event) => { void options.openPath?.(target, event); },
    hoverLink: (event, targetEl, linktext) => {
      if (typeof options.hoverLink === "function") return options.hoverLink(event, targetEl, linktext);
      return propertyCardFootAdapterHoverLink(plugin, event, targetEl, linktext, path, options.hoverSource);
    },
    searchTag: (tag, event) => {
      if (typeof options.searchTag === "function") return options.searchTag(tag, event);
      return propertyCardFootAdapterSearchTag(plugin, tag);
    },
    openNested: typeof options.openNested === "function" ? options.openNested : null,
    onOpenEditor: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
      ? (key) => propertyCardFootOpenEditor(path, key)
      : null,
    onAddProperty: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
      ? () => propertyCardFootOpenEditor(path, undefined, "add")
      : null,
    onEditAll: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
      ? () => propertyCardFootOpenEditor(path, undefined, "browse")
      : null,
  };
}

function propertyCardFootAdapterTrack(container, path, card, tracked) {
  const key = propertyCardFootAdapterPath(path);
  try {
    if (typeof propertyCardFootReleaseScope === "function") {
      propertyCardFootReleaseScope(container || null, key);
    }
  } catch (_) {}
  if (!card || !key) return null;
  if (tracked instanceof Set) tracked.add(key);
  let foot = null;
  try {
    foot = typeof card.querySelector === "function"
      ? card.querySelector(`.${PROPERTY_CARD_FOOT_CLASS}`)
      : null;
  } catch (_) {
    foot = null;
  }
  if (!foot) return null;
  try {
    if (typeof propertyCardFootRegisterMount === "function") {
      const drawer = typeof foot.querySelector === "function"
        ? foot.querySelector(`.${PROPERTY_CARD_FOOT_DRAWER_CLASS}`)
        : null;
      const drawerId = drawer?.getAttribute?.("id") || "";
      const disclosureId = drawerId.endsWith("-drawer") ? drawerId.slice(0, -"-drawer".length) : "";
      return propertyCardFootRegisterMount(foot, key, disclosureId || undefined);
    }
  } catch (_) {}
  return null;
}

function propertyCardFootAdapterAppend(card, path, doc, spec, handlers, pendingScroll) {
  try {
    const key = propertyCardFootAdapterPath(path);
    if (!card || !key || typeof propertyCardFootBuildEl !== "function") return null;
    const open = typeof propertyCardFootIsOpen === "function" && propertyCardFootIsOpen(key);
    let disclosureId = "";
    try {
      disclosureId = typeof propertyCardFootNextDisclosureId === "function"
        ? propertyCardFootNextDisclosureId()
        : "";
    } catch (_) {
      disclosureId = "";
    }
    const built = propertyCardFootBuildEl(doc || card.ownerDocument, {
      path: key,
      disclosureId,
      open,
      inventory: spec?.inventory,
      stamp: spec?.stamp,
      handlers: handlers || {},
    });
    if (!built || !built.element) return null;
    if (doc && built.element.ownerDocument !== doc) {
      try { doc.adoptNode?.(built.element); } catch (_) {}
    }
    card.appendChild(built.element);
    if (open && pendingScroll instanceof Set && pendingScroll.has(key)) {
      pendingScroll.delete(key);
      try {
        if (typeof propertyCardFootReveal === "function") propertyCardFootReveal(built.element);
      } catch (_) {}
    }
    return built;
  } catch (_) {
    return null;
  }
}

function propertyCardFootAdapterBind(plugin, options = {}) {
  const pendingKey = options.pendingKey;
  const untoggleKey = options.untoggleKey;
  const unresolverKey = options.unresolverKey;
  if (pendingKey && !(plugin[pendingKey] instanceof Set)) plugin[pendingKey] = new Set();
  if (untoggleKey && !plugin[untoggleKey] && typeof propertyCardFootOnToggle === "function") {
    plugin[untoggleKey] = propertyCardFootOnToggle((path, open) => {
      if (open && pendingKey) plugin[pendingKey]?.add?.(propertyCardFootAdapterPath(path));
      options.refresh?.();
    });
  }
  if (unresolverKey && !plugin[unresolverKey] && typeof propertyCardFootRegisterPathResolver === "function") {
    plugin[unresolverKey] = propertyCardFootRegisterPathResolver((view) => {
      try { return options.livePath?.(view) || ""; } catch (_) { return ""; }
    });
  }
}

function propertyCardFootAdapterUnbind(plugin, options = {}) {
  try { plugin[options.untoggleKey]?.(); } catch (_) {}
  if (options.untoggleKey) plugin[options.untoggleKey] = null;
  try { plugin[options.unresolverKey]?.(); } catch (_) {}
  if (options.unresolverKey) plugin[options.unresolverKey] = null;
  plugin[options.pendingKey]?.clear?.();
  for (const path of Array.from(options.tracked || [])) {
    try {
      if (typeof propertyCardFootReleasePath === "function") propertyCardFootReleasePath(path);
    } catch (_) {}
  }
  if (options.tracked instanceof Set) options.tracked.clear();
  options.cache?.clear?.();
  options.flights?.clear?.();
}
