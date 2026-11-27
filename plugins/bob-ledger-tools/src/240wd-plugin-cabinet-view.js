// Collect the one visible cabinet stack belonging to a Markdown view. Stale
// panes, hidden embeds, disabled controls, and malformed stack order fail
// closed so keyboard dispatch cannot act on another card.
const PROPERTY_CARD_CABINET_STACK_CLASS = "bob-property-card-cabinets";
const PROPERTY_CARD_CABINET_KIND_ATTR = "data-cabinet-kind";

function propertyCardCabinetViewScopes(view) {
  return typeof propertyCardFoldScopes === "function"
    ? propertyCardFoldScopes(view)
    : [view?.dom, view?.containerEl, view?.contentEl].filter(Boolean);
}

function propertyCardCabinetViewPath(view) {
  try {
    const raw = typeof propertyCardFootViewPath === "function"
      ? propertyCardFootViewPath(view)
      : view?.file?.path;
    return propertyCardCabinetPath(raw);
  } catch (_) {
    return "";
  }
}

function propertyCardCabinetStackCandidates(view) {
  const selector = `.${PROPERTY_CARD_CABINET_STACK_CLASS}`;
  const found = [];
  const seen = new Set();
  for (const scope of propertyCardCabinetViewScopes(view)) {
    try {
      if (scope.matches?.(selector) && !seen.has(scope)) {
        seen.add(scope);
        found.push(scope);
      }
      for (const node of Array.from(scope.querySelectorAll?.(selector) || [])) {
        if (!seen.has(node)) {
          seen.add(node);
          found.push(node);
        }
      }
    } catch (_) {}
  }
  return found;
}

function propertyCardCabinetElementFor(panel) {
  if (!panel) return null;
  try {
    if (panel.matches?.("[data-card-fold]")) return panel;
    return panel.querySelector?.("[data-card-fold-role='cabinet'][data-card-fold]") || null;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetKindFromPanel(panel, element) {
  let kind = "";
  try {
    kind = panel?.getAttribute?.(PROPERTY_CARD_CABINET_KIND_ATTR)
      || element?.getAttribute?.(PROPERTY_CARD_CABINET_KIND_ATTR)
      || "";
  } catch (_) {}
  if (Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, kind)) return kind;
  try {
    const foldKind = element?.getAttribute?.("data-card-fold") || "";
    if (foldKind === "properties") return "properties";
    return propertyCardCabinetKindForFold(foldKind) || "";
  } catch (_) {
    return "";
  }
}

function propertyCardCabinetNodeVisible(node) {
  try {
    return typeof propertyCardFoldVisible === "function"
      ? propertyCardFoldVisible(node)
      : Boolean(node && node.isConnected !== false && node.getBoundingClientRect?.().height > 0);
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetStackForView(view, path = propertyCardCabinetViewPath(view)) {
  if (!path) return null;
  for (const stack of propertyCardCabinetStackCandidates(view)) {
    if (!propertyCardCabinetNodeVisible(stack)) continue;
    const stamped = propertyCardCabinetPath(stack.getAttribute?.("data-cabinet-source") || "");
    if (stamped && stamped !== path) continue;
    const panels = Array.from(stack.querySelectorAll?.(`[${PROPERTY_CARD_CABINET_KIND_ATTR}]`) || []);
    if (panels.some((panel) => {
      const element = propertyCardCabinetElementFor(panel);
      return element && propertyCardCabinetPath(element.getAttribute?.("data-card-fold-source") || stamped) === path;
    })) return stack;
    const controls = Array.from(stack.querySelectorAll?.("[data-card-fold-role='cabinet'][data-card-fold]") || []);
    if (controls.some((element) => propertyCardCabinetPath(element.getAttribute?.("data-card-fold-source") || stamped) === path)) return stack;
  }
  return null;
}

function propertyCardCabinetMounted(view, path, kind) {
  try {
    const normalized = propertyCardCabinetPath(path);
    if (!normalized || !kind) return false;
    const stack = propertyCardCabinetStackForView(view, normalized);
    if (!stack) return false;
    return Array.from(stack.querySelectorAll?.(`[${PROPERTY_CARD_CABINET_KIND_ATTR}]`) || []).some((panel) =>
      panel.getAttribute?.(PROPERTY_CARD_CABINET_KIND_ATTR) === kind
      && propertyCardCabinetPath(panel.getAttribute?.("data-cabinet-source") || "") === normalized);
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetMountedInRoot(root, path, kind) {
  try {
    const normalized = propertyCardCabinetPath(path);
    if (!root || !normalized || !kind) return false;
    const scopes = [root, root.closest?.(".markdown-preview-view"), root.closest?.(".markdown-source-view")]
      .filter((scope, index, all) => scope && all.indexOf(scope) === index);
    for (const scope of scopes) {
      const stacks = [];
      if (scope.matches?.(`.${PROPERTY_CARD_CABINET_STACK_CLASS}`)) stacks.push(scope);
      stacks.push(...Array.from(scope.querySelectorAll?.(`.${PROPERTY_CARD_CABINET_STACK_CLASS}`) || []));
      for (const stack of stacks) {
        if (propertyCardCabinetPath(stack.getAttribute?.("data-cabinet-source") || "") !== normalized) continue;
        if (Array.from(stack.querySelectorAll?.(`[${PROPERTY_CARD_CABINET_KIND_ATTR}]`) || []).some((panel) =>
          panel.getAttribute?.(PROPERTY_CARD_CABINET_KIND_ATTR) === kind
          && propertyCardCabinetPath(panel.getAttribute?.("data-cabinet-source") || "") === normalized)) return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetCollectRows(stack, path) {
  const rows = [];
  const panels = Array.from(stack?.querySelectorAll?.(`[${PROPERTY_CARD_CABINET_KIND_ATTR}]`) || []);
  const candidates = panels.length
    ? panels
    : Array.from(stack?.querySelectorAll?.("[data-card-fold-role='cabinet'][data-card-fold]") || []);
  const seen = new Set();
  for (const panel of candidates) {
    const element = panels.length ? propertyCardCabinetElementFor(panel) : panel;
    if (!element || seen.has(element)) continue;
    seen.add(element);
    if (element.getAttribute?.("data-card-fold-role") !== "cabinet") continue;
    const kind = propertyCardCabinetKindFromPanel(panel, element);
    if (!kind || !Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, kind)) continue;
    const source = propertyCardCabinetPath(element.getAttribute?.("data-card-fold-source")
      || panel.getAttribute?.("data-card-fold-source")
      || stack.getAttribute?.("data-cabinet-source") || "");
    if (source !== path) continue;
    const expanded = element.getAttribute?.("aria-expanded");
    if (expanded !== "true" && expanded !== "false") continue;
    if (element.disabled === true || element.getAttribute?.("aria-disabled") === "true") continue;
    if (!propertyCardCabinetNodeVisible(panel) || !propertyCardCabinetNodeVisible(element)) continue;
    rows.push({
      kind,
      open: expanded === "true",
      element,
      panel,
      problems: panel.getAttribute?.("data-cabinet-problems") || "",
    });
  }
  return rows;
}

function propertyCardCabinetsInView(view) {
  const path = propertyCardCabinetViewPath(view);
  const result = { path, extras: [], properties: null, details: null };
  if (!path) return result;
  let details = null;
  try { details = typeof propertyCardFoldTarget === "function" ? propertyCardFoldTarget(view) : null; } catch (_) {}
  result.details = details;
  const stack = propertyCardCabinetStackForView(view, path);
  if (!stack) return result;
  const rows = propertyCardCabinetCollectRows(stack, path);
  const actualKinds = rows.map((row) => row.kind);
  const canonicalKinds = propertyCardCabinetOrder(actualKinds);
  const orderValid = canonicalKinds.length === actualKinds.length
    && canonicalKinds.every((kind, index) => kind === actualKinds[index]);
  if (!orderValid || new Set(actualKinds).size !== actualKinds.length) return result;
  const properties = rows.find((row) => row.kind === "properties");
  if (properties) result.properties = { open: properties.open, element: properties.element };
  const extras = rows.filter((row) => row.kind !== "properties");
  const numbering = new Map(propertyCardCabinetNumbering(extras.map((row) => row.kind)).map((row) => [row.kind, row.number]));
  result.extras = extras
    .filter((row) => numbering.has(row.kind))
    .map((row) => ({ kind: row.kind, number: numbering.get(row.kind), open: row.open, element: row.element }));
  return result;
}

// Deferred inline paint for cabinet-owned Reading catalogs (bob-cli-qq perf):
// skip the synchronous inline painter on an eligible Reading surface, then
// repaint the native callout only if no cabinet absorption covers it.
// Returns true when the caller must skip its sync paint (the fallback paints
// later, or never when a cabinet owns the catalog). Embeds, hover, canvas,
// print, and Source/Live editors never defer, so fail-open still shows
// today's painted catalog.
// Never throws.
const PROPERTY_CARD_CABINET_INLINE_FALLBACK_MS = 150;
const PROPERTY_CARD_CABINET_INLINE_FALLBACK_RETRIES = 3;
let propertyCardCabinetInlineFallbackMs = PROPERTY_CARD_CABINET_INLINE_FALLBACK_MS;
let propertyCardCabinetInlineFallbackRetries = PROPERTY_CARD_CABINET_INLINE_FALLBACK_RETRIES;

function propertyCardCabinetInlineFallbackSetDelayForTests(ms) {
  const previous = propertyCardCabinetInlineFallbackMs;
  const next = Number(ms);
  if (Number.isFinite(next) && next >= 0) propertyCardCabinetInlineFallbackMs = next;
  return previous;
}

function propertyCardCabinetInlineFallbackResetForTests() {
  propertyCardCabinetInlineFallbackMs = PROPERTY_CARD_CABINET_INLINE_FALLBACK_MS;
  propertyCardCabinetInlineFallbackRetries = PROPERTY_CARD_CABINET_INLINE_FALLBACK_RETRIES;
  return true;
}

const PROPERTY_CARD_CABINET_INLINE_DENIED = ".cm-editor, .markdown-embed, .internal-embed, .canvas-node, .canvas-node-content, .print";

// Obsidian post-processes a Reading section before inserting it, so a
// detached section answers through its render container (`ctx.containerEl`)
// instead. A container inside a card or a cabinet body is our own render,
// and a hover popover is a fragment: neither ever defers.
function propertyCardCabinetInlineEligible(el, ctx) {
  try {
    if (!el || typeof el.closest !== "function") return false;
    if (el.closest(PROPERTY_CARD_CABINET_INLINE_DENIED)) return false;
    if (el.closest(".markdown-preview-view, .markdown-preview-sizer")) return true;
    if (el.isConnected === true) return false;
    const container = ctx?.containerEl;
    if (!container || typeof container.closest !== "function") return false;
    if (container.closest(`${PROPERTY_CARD_CABINET_INLINE_DENIED}, .hover-popover, .bob-property-card, .bob-cabinet-body-source`)) return false;
    return Boolean(container.closest(".markdown-preview-view, .markdown-preview-sizer"));
  } catch (_) {
    return false;
  }
}

// Only a note whose card can own the catalog defers: host catalogs live on
// area and project cards, Records on album cards. Unknown frontmatter paints
// at once as before.
const PROPERTY_CARD_CABINET_INLINE_HOST_TYPES = Object.freeze({
  projects: Object.freeze(["area", "project"]),
  records: Object.freeze(["album"]),
});

function propertyCardCabinetInlineHostTyped(ctx, kind) {
  try {
    const allowed = PROPERTY_CARD_CABINET_INLINE_HOST_TYPES[kind];
    if (!allowed) return false;
    const raw = ctx?.frontmatter?.type;
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some((value) => {
      if (typeof value !== "string") return false;
      const name = value.replace(/^\s*\[\[|\]\]\s*$/g, "").split("|")[0].split("/").pop().trim().toLowerCase();
      return allowed.includes(name);
    });
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetInlineAbsorbed(el, kind) {
  try {
    if (!el || !kind || typeof el.querySelector !== "function") return false;
    const selector = `.${PROPERTY_CARD_CABINET_ABSORBED_CLASS}[data-callout="${kind}"]`;
    if (typeof el.matches === "function" && el.matches(selector)) return true;
    return Boolean(el.querySelector(selector));
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetDeferInlinePaint(el, ctx, kind, paint) {
  try {
    if (!el || !ctx || !kind || typeof paint !== "function") return false;
    const path = String(ctx.sourcePath || "");
    if (!path) return false;
    if (!propertyCardCabinetInlineEligible(el, ctx)) return false;
    if (!propertyCardCabinetInlineHostTyped(ctx, kind)) return false;
    let attempts = 0;
    let timer = null;
    let done = false;
    const clear = () => {
      done = true;
      if (timer != null) {
        try { clearTimeout(timer); } catch (_) {}
        timer = null;
      }
    };
    const fire = () => {
      if (done) return;
      try {
        if (propertyCardCabinetInlineAbsorbed(el, kind)) { clear(); return; }
        attempts += 1;
        // A section Obsidian has not inserted yet gets the same bounded
        // retries; one it dropped is never shown, so it needs no paint.
        if (!el.isConnected) {
          if (attempts <= propertyCardCabinetInlineFallbackRetries) timer = setTimeout(fire, propertyCardCabinetInlineFallbackMs);
          else clear();
          return;
        }
        if (propertyCardCabinetMountedInRoot(el, path, kind) && attempts <= propertyCardCabinetInlineFallbackRetries) {
          timer = setTimeout(fire, propertyCardCabinetInlineFallbackMs);
          return;
        }
      } catch (_) {}
      clear();
      try { paint(); } catch (_) {}
    };
    timer = setTimeout(fire, propertyCardCabinetInlineFallbackMs);
    try {
      if (ctx.addChild && typeof MarkdownRenderChild === "function") {
        const child = new MarkdownRenderChild(el);
        const previous = child.onunload;
        child.onunload = () => {
          clear();
          try { if (typeof previous === "function") previous(); } catch (_) {}
        };
        ctx.addChild(child);
      }
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}
