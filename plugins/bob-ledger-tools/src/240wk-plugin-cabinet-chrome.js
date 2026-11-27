// Shared, accessible cabinet header chrome. Fold-row owners still own their
// state and bodies; this fragment only gives their controls the common shape.
function propertyCardCabinetCreateEl(doc, tag, className) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function propertyCardCabinetSetText(node, value) {
  if (node) node.textContent = value === null || value === undefined ? "" : String(value);
}

function propertyCardCabinetAddAttention(doc, trail, attention) {
  if (!attention || (!attention.icon && !attention.word && !attention.count)) return null;
  const chip = propertyCardCabinetCreateEl(doc, "span", `bob-cabinet-attention${attention.tone ? ` is-${attention.tone}` : ""}`);
  if (!chip) return null;
  const appendPart = (className, text) => {
    if (!text) return;
    const part = propertyCardCabinetCreateEl(doc, "span", className);
    propertyCardCabinetSetText(part, text);
    if (part) chip.appendChild(part);
  };
  appendPart("bob-cabinet-attention-icon", attention.icon || "");
  appendPart("bob-cabinet-attention-word", attention.word || "");
  appendPart("bob-cabinet-attention-count", Number.isInteger(attention.count) && attention.count > 0 ? `+${attention.count}` : "");
  if (attention.title) chip.setAttribute("title", String(attention.title));
  if (attention.ariaLabel) chip.setAttribute("aria-label", String(attention.ariaLabel));
  trail?.appendChild?.(chip);
  return chip;
}

function propertyCardCabinetAppendActions(doc, trail, actions) {
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  for (const action of list) {
    if (!action) continue;
    if (action.nodeType === 1 || typeof action.addEventListener === "function") {
      trail?.appendChild?.(action);
      continue;
    }
    if (typeof action !== "object" || !action.label || typeof action.onClick !== "function") continue;
    const button = propertyCardCabinetCreateEl(doc, "button", "bob-cabinet-action");
    if (!button) continue;
    button.setAttribute("type", "button");
    if (action.title) button.setAttribute("title", String(action.title));
    if (action.ariaLabel) button.setAttribute("aria-label", String(action.ariaLabel));
    propertyCardCabinetSetText(button, action.label);
    button.addEventListener("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      try { event?.stopPropagation?.(); } catch (_) {}
      try { action.onClick(event); } catch (_) {}
    });
    trail?.appendChild?.(button);
  }
}

function propertyCardCabinetFocusHeadOnClose(head, drawer) {
  if (!head || !drawer) return false;
  try {
    const active = drawer.ownerDocument?.activeElement;
    if (!active || !(active === drawer || drawer.contains?.(active))) return false;
    const toggle = head.matches?.("button") ? head : head.querySelector?.(".bob-cabinet-toggle");
    toggle?.focus?.();
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetBuildHead(doc, spec = {}) {
  const kind = typeof spec.kind === "string" ? spec.kind : "";
  const foldKind = typeof spec.foldKind === "string" && spec.foldKind ? spec.foldKind : kind;
  const path = propertyCardCabinetPath(spec.path);
  const bodyId = String(spec.bodyId || propertyCardFoldNextId());
  if (!kind || !path) return null;
  const wrapper = propertyCardCabinetCreateEl(doc, "div", ["bob-cabinet-head", spec.headClass || ""].filter(Boolean).join(" "));
  const button = propertyCardCabinetCreateEl(doc, "button", ["bob-property-card-fold", "bob-cabinet-toggle", spec.className || ""].filter(Boolean).join(" "));
  const trail = propertyCardCabinetCreateEl(doc, "div", "bob-cabinet-trail");
  if (!wrapper || !button || !trail) return null;
  const open = spec.open === true;
  if (typeof propertyCardDecorateFoldControl === "function") {
    propertyCardDecorateFoldControl(button, {
      kind: foldKind, path, open, bodyId, role: "cabinet", tooltip: spec.tooltip,
      keyLive: false,
    });
  } else {
    button.setAttribute("type", "button");
    button.setAttribute("data-card-fold", foldKind);
    button.setAttribute("data-card-fold-role", "cabinet");
    button.setAttribute("data-card-fold-source", path);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-controls", bodyId);
  }
  button.setAttribute("aria-expanded", open ? "true" : "false");
  button.setAttribute("aria-controls", bodyId);
  if (spec.keyLive === true) button.setAttribute("data-key-live", "true");
  else button.removeAttribute?.("data-key-live");
  if (spec.ariaLabel) button.setAttribute("aria-label", String(spec.ariaLabel));
  if (spec.keyLive === true) button.setAttribute("aria-keyshortcuts", String(spec.restKey || "_"));
  else button.removeAttribute?.("aria-keyshortcuts");
  if (spec.tabIndex !== undefined) button.setAttribute("tabindex", String(spec.tabIndex));

  const chevron = propertyCardCabinetCreateEl(doc, "span", "bob-property-card-fold-chevron bob-cabinet-chevron");
  propertyCardCabinetSetText(chevron, "▸");
  chevron?.setAttribute?.("aria-hidden", "true");
  const noun = propertyCardCabinetCreateEl(doc, "span", "bob-property-card-fold-noun bob-cabinet-noun");
  propertyCardCabinetSetText(noun, spec.noun || PROPERTY_CARD_CABINET_KINDS[kind]?.noun || "Details");
  const summaryText = spec.summary === null || spec.summary === undefined ? "" : String(spec.summary).trim();
  const summary = summaryText ? propertyCardCabinetCreateEl(doc, "span", "bob-property-card-fold-summary bob-cabinet-summary") : null;
  if (summary) propertyCardCabinetSetText(summary, summaryText);
  button.appendChild(chevron);
  button.appendChild(doc.createTextNode(" "));
  button.appendChild(noun);
  if (summary) {
    button.appendChild(doc.createTextNode(" · "));
    button.appendChild(summary);
  }
  wrapper.appendChild(button);

  if (spec.meta) {
    const meta = propertyCardCabinetCreateEl(doc, "span", ["bob-cabinet-meta", spec.metaClass || ""].filter(Boolean).join(" "));
    propertyCardCabinetSetText(meta, spec.meta);
    if (spec.metaTitle) meta.setAttribute("title", String(spec.metaTitle));
    trail.appendChild(meta);
  }
  propertyCardCabinetAddAttention(doc, trail, spec.attention);
  propertyCardCabinetAppendActions(doc, trail, spec.actions);
  for (const extra of (Array.isArray(spec.extras) ? spec.extras : spec.extras ? [spec.extras] : [])) {
    if (extra) trail.appendChild(extra);
  }
  const keycap = propertyCardCabinetCreateEl(doc, "kbd", "bob-property-card-fold-keycap bob-cabinet-keycap");
  const restKey = String(spec.restKey || "");
  propertyCardCabinetSetText(keycap, spec.keyLive === true ? restKey : "");
  keycap?.setAttribute?.("aria-hidden", "true");
  keycap?.setAttribute?.("data-cabinet-keycap", "true");
  keycap?.setAttribute?.("data-cabinet-rest-key", restKey);
  if (spec.keyLive === true) keycap?.setAttribute?.("data-key-live", "true");
  if (keycap) trail.appendChild(keycap);
  wrapper.appendChild(trail);
  wrapper.setAttribute("data-cabinet-head-kind", kind);
  if (spec.onToggle) {
    button.addEventListener("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      const drawer = doc.getElementById?.(bodyId) || null;
      if (open) propertyCardCabinetFocusHeadOnClose(button, drawer);
      try { spec.onToggle(!open, event); } catch (_) {}
    });
  }
  return { element: wrapper, button, trail, keycap, bodyId };
}

// Called by the armed-pick UI. `numbering` is either the bottom-up array from
// propertyCardCabinetNumbering or null to clear every temporary badge.
function propertyCardCabinetPaintPick(stack, numbering) {
  if (!stack) return false;
  const armed = Array.isArray(numbering) && numbering.length > 0;
  try {
    if (armed) stack.setAttribute("data-cabinet-pick", "armed");
    else stack.removeAttribute?.("data-cabinet-pick");
    const numbers = new Map((armed ? numbering : []).map((row) => [row?.kind, row?.number]));
    const panels = Array.from(stack.querySelectorAll?.("[data-cabinet-kind]") || []);
    for (const panel of panels) {
      const kind = panel.getAttribute?.("data-cabinet-kind") || "";
      const keycap = panel.querySelector?.("[data-cabinet-keycap]");
      if (!keycap) continue;
      if (!armed) {
        propertyCardCabinetSetText(keycap, keycap.getAttribute?.("data-cabinet-rest-key") || "");
        keycap.removeAttribute?.("data-cabinet-picked");
        continue;
      }
      const value = kind === "properties" ? "-" : (numbers.has(kind) ? String(numbers.get(kind)) : "");
      propertyCardCabinetSetText(keycap, value);
      if (value) keycap.setAttribute("data-cabinet-picked", "true");
      else keycap.removeAttribute?.("data-cabinet-picked");
    }
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetPaintRestKeys(stack, numbering, keyLive) {
  if (!stack) return false;
  try {
    const numbers = new Map((Array.isArray(numbering) ? numbering : []).map((row) => [row?.kind, row?.number]));
    console.log("DEBUG REST", numbering, [...numbers], keyLive);
    for (const panel of Array.from(stack.querySelectorAll?.("[data-cabinet-kind]") || [])) {
      const kind = panel.getAttribute?.("data-cabinet-kind") || "";
      const keycap = panel.querySelector?.("[data-cabinet-keycap]");
      if (!keycap || kind === "properties") continue;
      const rest = numbers.size > 1 && numbers.has(kind) ? `_${numbers.get(kind)}` : "_";
      keycap.setAttribute("data-cabinet-rest-key", rest);
      if (keyLive === true && keycap.getAttribute?.("data-key-live") === "true") {
        propertyCardCabinetSetText(keycap, rest);
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function propertyCardFootBuildCabinetEl(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    const handlers = options.handlers || {};
    const inventory = options.inventory && typeof options.inventory === "object" ? options.inventory : null;
    const stamp = options.stamp && typeof options.stamp === "object" ? options.stamp : null;
    const path = propertyCardFootText(options.path).trim();
    const disclosureId = propertyCardFootText(options.disclosureId).trim()
      || `bob-property-foot-${path || "note"}`;
    const drawerId = `${disclosureId}-drawer`;
    const count = inventory && Number.isInteger(inventory.count) ? inventory.count : 0;
    const open = options.open === true;
    const foot = propertyCardCabinetCreateEl(doc, "div", `${PROPERTY_CARD_FOOT_CLASS} bob-cabinet-panel`);
    if (!foot) return null;
    foot.setAttribute("data-property-foot", "true");
    foot.setAttribute("data-cabinet-kind", "properties");
    foot.setAttribute("data-cabinet-source", path);
    if (path) foot.setAttribute("data-foot-source", path);
    const lint = propertyCardFootLint({
      inventory, stamp,
      contractIssues: Array.isArray(options.contractIssues) ? options.contractIssues : [],
      firstSetting: typeof options.firstSetting === "string" ? options.firstSetting : "",
    });
    const actions = [];
    if (lint.count > 0) {
      const opener = lint.firstSetting && typeof handlers.onOpenSetting === "function"
        ? handlers.onOpenSetting : null;
      const chip = propertyCardCabinetCreateEl(doc, opener ? "button" : "span", "bob-property-card-foot-lint-chip bob-cabinet-attention");
      propertyCardCabinetSetText(chip, `⚠ ${lint.count}`);
      chip?.setAttribute?.("title", lint.tooltip);
      chip?.setAttribute?.("aria-label", lint.tooltip || "Properties need attention");
      if (opener) {
        chip.setAttribute("type", "button");
        chip.addEventListener("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { event?.stopPropagation?.(); } catch (_) {}
          try { opener(lint.firstSetting); } catch (_) {}
        });
      } else {
        chip?.setAttribute?.("role", "status");
      }
      if (chip) actions.push(chip);
    }
    const head = propertyCardCabinetBuildHead(doc, {
      kind: "properties", foldKind: "properties", path, bodyId: drawerId,
      noun: "Properties", summary: String(count), open, keyLive: options.keyLive === true,
      restKey: "-", className: PROPERTY_CARD_FOOT_CLASS + "-disclosure",
      tooltip: "Toggle properties (-)",
      ariaLabel: `Toggle properties, ${count} ${count === 1 ? "property" : "properties"}`,
      meta: stamp?.text || "",
      metaClass: stamp?.state === "invalid" ? "bob-property-card-foot-stamp is-invalid" : "bob-property-card-foot-stamp",
      metaTitle: stamp?.tooltip || "", actions,
      onToggle: (next) => {
        let decided = next;
        if (typeof handlers.onToggle === "function") {
          try {
            const result = handlers.onToggle(path, next);
            if (typeof result === "boolean") decided = result;
          } catch (_) {}
        }
        if (decided) propertyCardFootReveal(foot);
        propertyCardCabinetSetDrawerOpen(foot, decided);
      },
    });
    if (!head) return null;
    head.button.setAttribute("data-foot-focus", "foot");
    const drawer = propertyCardCabinetCreateEl(doc, "div", `${PROPERTY_CARD_FOOT_DRAWER_CLASS} bob-cabinet-drawer`);
    const inner = propertyCardCabinetCreateEl(doc, "div", "bob-property-card-foot-drawer-body bob-cabinet-drawer-inner");
    drawer.setAttribute("id", drawerId);
    drawer.setAttribute("data-open", open ? "true" : "false");
    if (!open) inner.setAttribute("inert", "");
    if (open) propertyCardFootRenderDrawer(doc, inner, { ...options, handlers });
    drawer.appendChild(inner);
    foot.appendChild(head.element);
    foot.appendChild(drawer);
    return { element: foot, disclosure: head.button, drawer };
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetSetDrawerOpen(panel, open) {
  if (!panel) return false;
  const value = open === true;
  try {
    const control = panel.matches?.(".bob-cabinet-toggle") ? panel : panel.querySelector?.(".bob-cabinet-toggle");
    const drawer = panel.querySelector?.(".bob-cabinet-drawer");
    const inner = drawer?.querySelector?.(".bob-cabinet-drawer-inner");
    control?.setAttribute?.("aria-expanded", value ? "true" : "false");
    drawer?.setAttribute?.("data-open", value ? "true" : "false");
    if (value) inner?.removeAttribute?.("inert");
    else inner?.setAttribute?.("inert", "");
    return true;
  } catch (_) {
    return false;
  }
}
