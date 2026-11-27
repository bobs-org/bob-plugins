// Shared property-card fold state, view-local target registry, and disclosure
// row. Fold state belongs to a session, never to frontmatter or settings.
function propertyCardFoldPath(value) {
  try {
    if (typeof propertyCardFootPath === "function") return propertyCardFootPath(value);
  } catch (_) {}
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
}

function propertyCardFoldChoice(open, problems = "") {
  return { open: open === true, problems: typeof problems === "string" ? problems : "" };
}

// Session maps used to store a boolean collapsed flag. true means shut.
function propertyCardFoldChoiceFromStored(stored) {
  if (stored && typeof stored === "object" && typeof stored.open === "boolean") return stored;
  if (stored === true) return propertyCardFoldChoice(false, "");
  if (stored === false) return propertyCardFoldChoice(true, "");
  return null;
}

function propertyCardFoldHiddenBody(doc, bodyId) {
  const id = typeof bodyId === "string" ? bodyId : "";
  if (!id) return null;
  const shell = propertyCardFoldElement(doc, "div", "bob-property-card-fold-shell");
  if (!shell) return null;
  shell.setAttribute("id", id);
  shell.setAttribute("hidden", "");
  return shell;
}

// Healthy paint clears a stale problem stamp without changing the user's
// open/closed choice. The adapter writes this returned value to its session Map.
function propertyCardFoldRestamp(choice, problems = "") {
  if (!choice || typeof choice !== "object" || problems !== "") return choice;
  if (choice.problems === "") return choice;
  return propertyCardFoldChoice(choice.open, "");
}

// A new or changed blocking problem resurfaces the fold. An explicit choice
// for the current signature always wins, including a request to close it.
function propertyCardFoldResolve({ choice, problems = "", foldDefault = false } = {}) {
  const signature = typeof problems === "string" ? problems : "";
  if (!signature) {
    return choice && typeof choice.open === "boolean" ? choice.open : foldDefault === true;
  }
  return choice && choice.problems === signature && typeof choice.open === "boolean"
    ? choice.open
    : true;
}

const propertyCardFoldKinds = new Map();
const propertyCardFoldPendingReveal = new Set();
let propertyCardFoldId = 0;

function propertyCardRegisterFoldKind(plugin, kind, spec = {}) {
  if (!plugin || typeof kind !== "string" || !kind || typeof spec.toggle !== "function") return () => {};
  const entry = { plugin, toggle: spec.toggle };
  propertyCardFoldKinds.set(kind, entry);
  return () => {
    if (propertyCardFoldKinds.get(kind) !== entry) return false;
    propertyCardFoldKinds.delete(kind);
    return true;
  };
}

function propertyCardFoldNextId() {
  propertyCardFoldId += 1;
  return `bob-property-fold-${propertyCardFoldId}`;
}

function propertyCardFoldScopes(view) {
  const scopes = [];
  for (const scope of [view?.dom, view?.containerEl, view?.contentEl]) {
    if (!scope || scopes.includes(scope)) continue;
    scopes.push(scope);
  }
  return scopes;
}

function propertyCardFoldVisible(node) {
  if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== "function") return false;
  try {
    const rect = node.getBoundingClientRect();
    return Boolean(rect && (Number(rect.width) > 0 || Number(rect.height) > 0));
  } catch (_) {
    return false;
  }
}

function propertyCardFoldTarget(view) {
  const path = propertyCardFoldPath(typeof propertyCardFootViewPath === "function"
    ? propertyCardFootViewPath(view) : "");
  if (!path) return null;
  const seen = new Set();
  for (const scope of propertyCardFoldScopes(view)) {
    let nodes = [];
    try {
      if (scope.matches?.("[data-card-fold]")) nodes.push(scope);
      nodes.push(...Array.from(scope.querySelectorAll?.("[data-card-fold]") || []));
    } catch (_) {
      nodes = [];
    }
    for (const node of nodes) {
      if (!node || seen.has(node)) continue;
      seen.add(node);
      const kind = node.getAttribute?.("data-card-fold") || "";
      const source = propertyCardFoldPath(node.getAttribute?.("data-card-fold-source") || "");
      const expanded = node.getAttribute?.("aria-expanded");
      if (!kind || !propertyCardFoldKinds.has(kind) || source !== path) continue;
      // With cabinets live, `_` owns only the compact, card-details control.
      // Cabinet disclosures are routed by semantic kind through the cabinet
      // router, never by whichever header happens to appear first in the DOM.
      if (propertyCardCabinetsGateLive?.() === true
        && node.getAttribute?.("data-card-fold-role") !== "details") continue;
      if (expanded !== "true" && expanded !== "false") continue;
      if (node.disabled === true || node.getAttribute?.("aria-disabled") === "true") continue;
      if (!propertyCardFoldVisible(node)) continue;
      return { element: node, kind, path, open: expanded === "true", registration: propertyCardFoldKinds.get(kind) };
    }
  }
  return null;
}

function propertyCardCanToggleDetails(view) {
  return Boolean(propertyCardFoldTarget(view));
}

function propertyCardToggleDetails(view) {
  const target = propertyCardFoldTarget(view);
  if (!target || typeof target.registration?.toggle !== "function") return false;
  if (!target.open) propertyCardFoldPendingReveal.add(target.path);
  else propertyCardFoldPendingReveal.delete(target.path);
  try {
    const result = target.registration.toggle(target.path, view);
    if (result === false) {
      propertyCardFoldPendingReveal.delete(target.path);
      return false;
    }
    return true;
  } catch (_) {
    propertyCardFoldPendingReveal.delete(target.path);
    return false;
  }
}

function propertyCardFoldConsumePendingReveal(path, open) {
  const key = propertyCardFoldPath(path);
  if (!key || open !== true || !propertyCardFoldPendingReveal.has(key)) return false;
  propertyCardFoldPendingReveal.delete(key);
  return true;
}

function propertyCardFoldClearPendingReveal(path) {
  const key = propertyCardFoldPath(path);
  return key ? propertyCardFoldPendingReveal.delete(key) : false;
}

function propertyCardFoldKeyLive(plugin, surface) {
  const livePreview = surface === "live-preview" || surface?.livePreview === true;
  if (!livePreview) return false;
  try {
    return Platform?.isDesktopApp === true
      && plugin?.app?.vault?.getConfig?.("vimMode") === true;
  } catch (_) {
    return false;
  }
}

function propertyCardFoldElement(doc, tag, className) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function propertyCardFoldSetText(node, text) {
  if (!node) return;
  node.textContent = text === null || text === undefined ? "" : String(text);
}

function propertyCardFoldAddKeycap(button, doc, keyLive, key = "_") {
  const existing = button.querySelector?.(".bob-property-card-fold-keycap");
  if (!keyLive) {
    existing?.remove?.();
    return null;
  }
  if (existing) {
    propertyCardFoldSetText(existing, key);
    return existing;
  }
  const keycap = propertyCardFoldElement(doc, "kbd", "bob-property-card-fold-keycap");
  if (!keycap) return null;
  propertyCardFoldSetText(keycap, key);
  keycap.setAttribute("aria-hidden", "true");
  button.appendChild(keycap);
  return keycap;
}

function propertyCardFoldRevealIfPending(button, path, open) {
  if (!button || !propertyCardFoldConsumePendingReveal(path, open === true)) return false;
  const reveal = () => {
    try { button.scrollIntoView?.({ block: "nearest" }); } catch (_) {}
  };
  if (typeof queueMicrotask === "function") queueMicrotask(reveal);
  else Promise.resolve().then(reveal);
  return true;
}

function propertyCardDecorateFoldControl(button, spec = {}) {
  if (!button || typeof button.setAttribute !== "function") return false;
  const kind = typeof spec.kind === "string" ? spec.kind : "";
  const path = propertyCardFoldPath(spec.path);
  if (!kind || !path) return false;
  try {
    button.classList?.add?.("bob-property-card-fold");
    if (spec.compact === true) button.classList?.add?.("bob-property-card-fold-compact");
    button.setAttribute("type", "button");
    button.setAttribute("data-card-fold", kind);
    button.setAttribute("data-card-fold-source", path);
    if (propertyCardCabinetsGateLive?.() === true) {
      button.setAttribute("data-card-fold-role", spec.role || (spec.compact === true ? "details" : "cabinet"));
    } else {
      button.removeAttribute?.("data-card-fold-role");
    }
    button.setAttribute("aria-expanded", spec.open === true ? "true" : "false");
    button.setAttribute("aria-controls", spec.bodyId || propertyCardFoldNextId());
    button.setAttribute("aria-keyshortcuts", "_");
    button.setAttribute("title", String(spec.tooltip || "Toggle card details (_)"));
    propertyCardFoldAddKeycap(button, button.ownerDocument, spec.keyLive === true);
    propertyCardFoldRevealIfPending(button, path, spec.open === true);
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardFoldAppendNode(button, doc, node, separator) {
  if (!node) return;
  if (separator) button.appendChild(doc.createTextNode(" · "));
  button.appendChild(node);
}

// Shared full-width row. The caller owns the body shell and assigns bodyId to
// it, so aria-controls always resolves even while that shell is empty/hidden.
function propertyCardBuildFoldRow(doc, spec = {}) {
  const path = propertyCardFoldPath(spec.path);
  const bodyId = spec.bodyId || propertyCardFoldNextId();
  if (propertyCardCabinetsGateLive?.() === true
    && typeof propertyCardCabinetBuildHead === "function") {
    const kind = propertyCardCabinetKindForFold(spec.kind);
    if (kind) {
      const head = propertyCardCabinetBuildHead(doc, {
        kind,
        foldKind: spec.kind,
        path,
        bodyId,
        noun: spec.noun,
        summary: spec.summary,
        open: spec.open === true,
        attention: spec.attention,
        extras: Array.isArray(spec.extras) ? spec.extras : spec.extras ? [spec.extras] : [],
        keyLive: spec.keyLive === true,
        restKey: "_",
        className: spec.className,
        tooltip: spec.tooltip,
        onToggle: (next) => {
          const drawer = doc.getElementById?.(bodyId) || null;
          if (spec.open === true) propertyCardCabinetFocusHeadOnClose(head?.button, drawer);
          spec.onToggle?.(next);
        },
      });
      if (head?.element) return { element: head.element, bodyId, control: head.button };
    }
  }
  const button = propertyCardFoldElement(doc, "button", ["bob-property-card-fold", spec.className || ""].filter(Boolean).join(" "));
  if (!button || !path) return { element: null, bodyId };
  const open = spec.open === true;
  propertyCardDecorateFoldControl(button, {
    kind: spec.kind,
    path,
    open,
    bodyId,
    tooltip: spec.tooltip,
    keyLive: false,
  });

  const chevron = propertyCardFoldElement(doc, "span", "bob-property-card-fold-chevron");
  propertyCardFoldSetText(chevron, open ? "▾" : "▸");
  chevron?.setAttribute?.("aria-hidden", "true");
  if (chevron) button.appendChild(chevron);
  button.appendChild(doc.createTextNode(" "));

  const noun = propertyCardFoldElement(doc, "span", "bob-property-card-fold-noun");
  propertyCardFoldSetText(noun, spec.noun || "Details");
  propertyCardFoldAppendNode(button, doc, noun, false);

  if (spec.summary) {
    const summary = propertyCardFoldElement(doc, "span", "bob-property-card-fold-summary");
    propertyCardFoldSetText(summary, spec.summary);
    propertyCardFoldAppendNode(button, doc, summary, true);
  }

  const extras = Array.isArray(spec.extras) ? spec.extras : spec.extras ? [spec.extras] : [];
  for (const extra of extras) propertyCardFoldAppendNode(button, doc, extra, true);

  const attention = spec.attention;
  if (attention && (attention.icon || attention.word)) {
    const chip = propertyCardFoldElement(doc, "span", `bob-property-card-fold-attention${attention.tone ? ` is-${attention.tone}` : ""}`);
    const text = [attention.icon, attention.word, Number.isInteger(attention.count) && attention.count > 0 ? `+${attention.count}` : ""]
      .filter(Boolean).join(" ");
    propertyCardFoldSetText(chip, text);
    if (attention.title) chip?.setAttribute?.("title", String(attention.title));
    button.appendChild(doc.createTextNode(" "));
    if (chip) button.appendChild(chip);
  }

  if (spec.keyLive === true) button.appendChild(doc.createTextNode(" "));
  propertyCardFoldAddKeycap(button, doc, spec.keyLive === true);
  button.addEventListener?.("click", (event) => {
    event?.preventDefault?.();
    spec.onToggle?.(!open);
  });
  return { element: button, bodyId };
}
