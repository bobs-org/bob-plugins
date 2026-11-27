// One ordered stack per property card. Config folds keep their existing state
// owners; this layer gathers their heads and bodies beside Properties and
// mounts provider bodies only when their cabinet first opens.
const propertyCardCabinetBodyCaches = new WeakMap();

function propertyCardCabinetFindCardRoot(parent) {
  try {
    if (parent?.matches?.("[data-card-kind]")) return parent;
    return parent?.closest?.("[data-card-kind]") || parent;
  } catch (_) {
    return parent || null;
  }
}

function propertyCardCabinetFindId(root, id) {
  if (!root || !id) return null;
  try {
    if (root.getAttribute?.("id") === id) return root;
    return Array.from(root.querySelectorAll?.("[id]") || [])
      .find((node) => node.getAttribute?.("id") === id) || null;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetWrapExisting(kind, path, button, head, body, doc) {
  const panel = propertyCardCabinetCreateEl(doc, "section", `bob-cabinet-panel bob-cabinet-panel-${kind}`);
  if (!panel) return null;
  panel.setAttribute("data-cabinet-kind", kind);
  panel.setAttribute("data-cabinet-source", path);
  const problems = button?.getAttribute?.("data-cabinet-problems")
    || head?.getAttribute?.("data-cabinet-problems") || "";
  if (problems) panel.setAttribute("data-cabinet-problems", problems);
  const drawer = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-drawer");
  const inner = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-drawer-inner");
  const bodyId = button?.getAttribute?.("aria-controls") || propertyCardFoldNextId();
  drawer?.setAttribute?.("id", bodyId);
  drawer?.setAttribute?.("data-open", button?.getAttribute?.("aria-expanded") === "true" ? "true" : "false");
  if (body) {
    body.removeAttribute?.("id");
    body.removeAttribute?.("hidden");
    body.classList?.add?.("bob-cabinet-content");
    inner.appendChild(body);
  }
  if (button?.getAttribute?.("aria-expanded") !== "true") inner?.setAttribute?.("inert", "");
  if (drawer && inner) drawer.appendChild(inner);
  if (head) panel.appendChild(head);
  else panel.appendChild(button);
  if (drawer) panel.appendChild(drawer);
  button?.setAttribute?.("aria-controls", bodyId);
  return panel;
}

function propertyCardCabinetContextSource(context, path) {
  if (typeof context?.source === "string") return context.source;
  if (typeof context?.spec?.sourceText === "string") return context.spec.sourceText;
  try {
    const doc = context?.view?.state?.doc;
    if (doc && typeof doc.toString === "function") return doc.toString();
  } catch (_) {}
  try {
    const file = context?.plugin?.app?.vault?.getAbstractFileByPath?.(path);
    const cached = context?.plugin?.homeCardSourceCache?.get?.(path)
      ?? context?.plugin?.albumHeaderSourceCache?.get?.(path);
    if (typeof cached === "string") return cached;
    if (file && typeof context?.plugin?.app?.metadataCache?.getFileCache === "function") {
      const cache = context.plugin.app.metadataCache.getFileCache(file);
      if (typeof cache?.frontmatter?.source === "string") return cache.frontmatter.source;
    }
  } catch (_) {}
  return "";
}

function propertyCardCabinetProviderCache(view) {
  if (!view || (typeof view !== "object" && typeof view !== "function")) return null;
  let cache = propertyCardCabinetBodyCaches.get(view);
  if (!cache) {
    cache = new Map();
    propertyCardCabinetBodyCaches.set(view, cache);
  }
  return cache;
}

function propertyCardCabinetProviderBody(panel, provider, context, kind, path, paintKey, open) {
  const doc = panel?.ownerDocument;
  const drawer = panel?.querySelector?.(".bob-cabinet-drawer");
  const inner = drawer?.querySelector?.(".bob-cabinet-drawer-inner");
  if (!drawer || !inner) return null;
  drawer.setAttribute("data-open", open ? "true" : "false");
  const key = `${path}\u0000${kind}`;
  const cache = propertyCardCabinetProviderCache(context?.view);
  let body = inner.querySelector?.(".bob-cabinet-provider-content") || null;
  let state = cache?.get(key) || body?.__bobCabinetBodyState || null;
  if (state && state.paintKey === paintKey) {
    body = state.container;
    if (body && body.parentNode !== inner) {
      try { inner.appendChild(body); } catch (_) {}
    }
  } else {
    try { body?.remove?.(); } catch (_) {}
    body = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-provider-content");
    if (body) inner.appendChild(body);
    state = { paintKey, container: body, built: false, pending: false, error: false };
    if (body) body.__bobCabinetBodyState = state;
    if (cache) cache.set(key, state);
  }
  if (!body) return null;
  if (!open || state.built || state.pending) return state;
  state.pending = true;
  const fail = (error) => {
    state.pending = false;
    state.error = true;
    state.built = true;
    try { provider.onBuildError?.({ path, kind, view: context?.view || null, error }); } catch (_) {}
    while (body.firstChild) body.removeChild(body.firstChild);
    const message = propertyCardCabinetCreateEl(doc, "p", "bob-cabinet-render-error");
    propertyCardCabinetSetText(message, "Couldn't render — showing the note's section");
    if (message) body.appendChild(message);
  };
  try {
    const result = provider.buildBody({
      doc,
      path,
      view: context?.view || null,
      component: context?.component || context?.plugin || null,
      container: body,
    });
    Promise.resolve(result).then(() => {
      state.pending = false;
      state.built = true;
    }, fail);
  } catch (_) {
    fail();
  }
  return state;
}

function propertyCardCabinetBuildProviderPanel(doc, path, species, kind, providerContext, context) {
  const applied = propertyCardCabinetProviderApplies(kind, providerContext);
  if (!applied || applied === false) return null;
  const provider = propertyCardCabinetProviderFor(kind);
  if (!provider) return null;
  const summary = applied.summary === null || applied.summary === undefined ? "" : String(applied.summary);
  const problems = typeof applied.problems === "string" ? applied.problems : "";
  const open = propertyCardCabinetIsOpen(path, kind, { problems });
  const bodyId = propertyCardFoldNextId();
  const panel = propertyCardCabinetCreateEl(doc, "section", `bob-cabinet-panel bob-cabinet-panel-${kind}`);
  if (!panel) return null;
  panel.setAttribute("data-cabinet-kind", kind);
  panel.setAttribute("data-cabinet-source", path);
  if (problems) panel.setAttribute("data-cabinet-problems", problems);
  let paintKey = "";
  try { paintKey = String(provider.paintKey(path) || ""); } catch (_) {}
  const head = propertyCardCabinetBuildHead(doc, {
    kind, path, bodyId, noun: PROPERTY_CARD_CABINET_KINDS[kind]?.noun,
    summary, meta: applied.meta, metaTitle: applied.metaTitle,
    attention: applied.attention, actions: applied.actions,
    open, keyLive: context?.keyLive === true || context?.spec?.keyLive === true, restKey: "_",
    tooltip: `Toggle ${PROPERTY_CARD_CABINET_KINDS[kind]?.noun || kind} cabinet (_)`,
    onToggle: (next) => {
      const previous = propertyCardCabinetIsOpen(path, kind, { problems });
      if (previous === next) return;
      propertyCardCabinetSetOpen(path, kind, next, { problems });
      const bodyState = propertyCardCabinetProviderBody(panel, provider, context, kind, path, paintKey, next);
      try {
        if (next && !bodyState?.wasOpen) provider.onOpen?.({ path, view: context?.view || null });
        else if (!next && bodyState?.wasOpen) provider.onClose?.({ path, view: context?.view || null });
      } catch (_) {}
      if (bodyState) bodyState.wasOpen = next;
      propertyCardCabinetSetDrawerOpen(panel, next);
      if (typeof context?.repaint === "function") {
        try { context.repaint({ path, kind }); } catch (_) {}
      }
    },
  });
  const drawer = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-drawer");
  const inner = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-drawer-inner");
  drawer?.setAttribute?.("id", bodyId);
  drawer?.setAttribute?.("data-open", open ? "true" : "false");
  if (!open) inner?.setAttribute?.("inert", "");
  if (inner) drawer.appendChild(inner);
  if (head?.element) panel.appendChild(head.element);
  if (drawer) panel.appendChild(drawer);
  if (open) {
    const bodyState = propertyCardCabinetProviderBody(panel, provider, context, kind, path, paintKey, true);
    if (bodyState && !bodyState.wasOpen) {
      try { provider.onOpen?.({ path, view: context?.view || null }); } catch (_) {}
      bodyState.wasOpen = true;
    }
  } else {
    const bodyState = propertyCardCabinetProviderBody(panel, provider, context, kind, path, paintKey, false);
    if (bodyState?.wasOpen) {
      try { provider.onClose?.({ path, view: context?.view || null }); } catch (_) {}
      bodyState.wasOpen = false;
    }
  }
  return panel;
}

function propertyCardCabinetsAssemble(parent, pathValue, footEl, context = {}) {
  try {
    if (propertyCardCabinetsGateLive?.() !== true || !parent || !footEl) return null;
    const path = propertyCardCabinetPath(pathValue);
    if (!path) return null;
    const card = propertyCardCabinetFindCardRoot(parent);
    const doc = card?.ownerDocument || parent.ownerDocument;
    if (!card || !doc) return null;
    const stack = propertyCardCabinetCreateEl(doc, "div", PROPERTY_CARD_CABINET_STACK_CLASS);
    if (!stack) return null;
    stack.setAttribute("role", "group");
    stack.setAttribute("aria-label", "Cabinets");
    stack.setAttribute("data-cabinet-source", path);

    const panels = [];
    const claimed = new Set();
    const controls = Array.from(card.querySelectorAll?.("[data-card-fold-role='cabinet'][data-card-fold]") || []);
    for (const button of controls) {
      const foldKind = button.getAttribute?.("data-card-fold") || "";
      const kind = propertyCardCabinetKindForFold(foldKind);
      if (!kind || claimed.has(kind) || propertyCardCabinetPath(button.getAttribute?.("data-card-fold-source") || "") !== path) continue;
      const existingStack = button.closest?.(`.${PROPERTY_CARD_CABINET_STACK_CLASS}`);
      if (existingStack) continue;
      claimed.add(kind);
      const head = button.closest?.(".bob-cabinet-head") || button;
      const bodyId = button.getAttribute?.("aria-controls") || "";
      const body = propertyCardCabinetFindId(card, bodyId);
      const panel = propertyCardCabinetWrapExisting(kind, path, button, head, body, doc);
      if (panel) panels.push({ kind, panel });
    }

    const species = card.getAttribute?.("data-card-kind") || "";
    const source = propertyCardCabinetContextSource({ ...context, spec: context.spec }, path);
    const frontmatter = context?.frontmatter || context?.spec?.frontmatter || {};
    const providerContext = { path, species, source, frontmatter };
    for (const kind of propertyCardCabinetOrder(Object.keys(PROPERTY_CARD_CABINET_KINDS))) {
      if (PROPERTY_CARD_CABINET_KINDS[kind].role !== "content" || claimed.has(kind)) continue;
      const panel = propertyCardCabinetBuildProviderPanel(doc, path, species, kind, providerContext, context);
      if (panel) {
        claimed.add(kind);
        panels.push({ kind, panel });
      }
    }

    let properties = footEl;
    if (properties.getAttribute?.("data-cabinet-kind") !== "properties") {
      properties.setAttribute?.("data-cabinet-kind", "properties");
      properties.setAttribute?.("data-cabinet-source", path);
    }
    panels.push({ kind: "properties", panel: properties });
    const orderedKinds = propertyCardCabinetOrder(panels.map((row) => row.kind));
    const ordered = orderedKinds.map((kind) => panels.find((row) => row.kind === kind)).filter(Boolean);
    for (const row of ordered) stack.appendChild(row.panel);

    const extras = orderedKinds.filter((kind) => kind !== "properties");
    const numbering = propertyCardCabinetNumbering(extras);
    propertyCardCabinetPaintRestKeys(
      stack,
      numbering,
      context?.keyLive === true || context?.spec?.keyLive === true,
    );
    if (extras.length) {
      for (const button of Array.from(card.querySelectorAll?.(".bob-property-card-fold-compact") || [])) {
        button.querySelector?.(".bob-property-card-fold-keycap")?.remove?.();
        const title = button.getAttribute?.("title") || "";
        if (title) button.setAttribute("title", title.replace(/\s*\(_\)\s*$/, ""));
        button.removeAttribute?.("aria-keyshortcuts");
      }
    }
    card.appendChild(stack);

    const view = context?.view || null;
    if (view && context?.plugin && typeof propertyCardCabinetRegisterMount === "function") {
      const repaint = typeof context.repaint === "function" ? context.repaint : null;
      const release = propertyCardCabinetRegisterMount(context.plugin, view, path, stack, repaint);
      try { context.component?.register?.(release); } catch (_) {}
    }
    return stack;
  } catch (_) {
    return null;
  }
}
