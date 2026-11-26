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
  if (!path || propertyCardCabinetsGateLive?.() !== true) return result;
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
