// Local Area/Project card DOM (bob-cli-pl.4.1 presentation). Builds accessible
// chrome from a pure homeCardModel with injected callbacks. Does not mount a
// production host, own a title slot, or append a foot.

const HOME_CARD_CLASS = "bob-home-card";
const HOME_CARD_META_CLASS = "bob-home-card-meta";
const HOME_CARD_CHIP_CLASS = "bob-home-card-chip";
const HOME_CARD_READY_CLASS = "bob-home-card-ready";

let HomeCardObsidianSetIcon = null;
try {
  const obsidianMod = require("obsidian");
  HomeCardObsidianSetIcon = obsidianMod && typeof obsidianMod.setIcon === "function"
    ? obsidianMod.setIcon
    : null;
} catch (_) {
  HomeCardObsidianSetIcon = null;
}

function homeCardDomDocOk(doc) {
  return Boolean(doc && typeof doc.createElement === "function" && typeof doc.createTextNode === "function");
}

function homeCardDomEl(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function homeCardDomText(doc, node, text) {
  const value = text === null || text === undefined ? "" : String(text);
  if (value) node.appendChild(doc.createTextNode(value));
  return node;
}

function homeCardDomReducedMotion(options) {
  if (options && options.reducedMotion === true) return true;
  if (options && options.reducedMotion === false) return false;
  try {
    if (typeof propertyCardFootReducedMotion === "function") return propertyCardFootReducedMotion();
  } catch (_) {}
  return false;
}

function homeCardDomSetIcon(node, name) {
  if (!node || !name) return;
  node.setAttribute("data-icon", name);
  node.setAttribute("aria-hidden", "true");
  if (HomeCardObsidianSetIcon) {
    try { HomeCardObsidianSetIcon(node, name); } catch (_) {}
  }
}

function homeCardDomOpenEditor(options, model, key) {
  const open = options && options.onOpenEditor;
  if (typeof open !== "function") return false;
  try {
    open({ filePath: model.path, key: key || undefined, mode: "browse" });
  } catch (_) {}
  return true;
}

function homeCardDomAppendPills(slot, doc, model) {
  if (!slot) return;
  for (const pill of Array.isArray(model.pills) ? model.pills : []) {
    const text = String(pill && pill.text || "").trim();
    if (!text) continue;
    const node = homeCardDomEl(doc, "span", "bob-property-card-pill bob-home-card-pill");
    node.setAttribute("data-pill-tone", pill.id === "root" ? "outline" : "solid");
    node.setAttribute("data-home-pill", pill.id || "");
    if (pill.tooltip) node.setAttribute("title", String(pill.tooltip));
    homeCardDomText(doc, node, text);
    slot.appendChild(node);
  }
}

function homeCardDomAppendSettings(slot, doc, model, options) {
  if (!slot) return;
  const live = typeof options?.onOpenEditor === "function";
  const node = homeCardDomEl(doc, live ? "button" : "span", "bob-home-card-settings");
  if (live) {
    node.setAttribute("type", "button");
    node.setAttribute("aria-label", "Open Settings");
    node.addEventListener?.("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      homeCardDomOpenEditor(options, model, undefined);
    });
  } else {
    node.setAttribute("aria-label", "Settings");
  }
  homeCardDomText(doc, node, "⊞ ");
  const label = homeCardDomEl(doc, "span", "bob-home-card-settings-label");
  homeCardDomText(doc, label, "Settings");
  node.appendChild(label);
  slot.appendChild(node);
}

function homeCardFoldIsCollapsed(plugin, path) {
  const key = homeCardPath(path);
  const map = plugin.homeCardCollapsed instanceof Map ? plugin.homeCardCollapsed : new Map();
  plugin.homeCardCollapsed = map;
  const stored = key && map.has(key) ? map.get(key) : null;
  const choice = typeof propertyCardFoldRestamp === "function"
    ? propertyCardFoldRestamp(
      typeof propertyCardFoldChoiceFromStored === "function" ? propertyCardFoldChoiceFromStored(stored) : null,
      "",
    )
    : (typeof propertyCardFoldChoiceFromStored === "function" ? propertyCardFoldChoiceFromStored(stored) : null);
  if (key && choice && choice !== stored) map.set(key, choice);
  const open = typeof propertyCardFoldResolve === "function"
    ? propertyCardFoldResolve({
      choice,
      problems: "",
      foldDefault: typeof propertyCardSpecies === "function" ? propertyCardSpecies("area")?.foldDefault : true,
    })
    : stored !== true;
  return open !== true;
}

function homeCardFoldSetCollapsed(plugin, path, collapsed) {
  const key = homeCardPath(path);
  if (!(plugin.homeCardCollapsed instanceof Map)) plugin.homeCardCollapsed = new Map();
  if (key) {
    plugin.homeCardCollapsed.set(key, typeof propertyCardFoldChoice === "function"
      ? propertyCardFoldChoice(collapsed !== true, "")
      : collapsed === true);
  }
  plugin.scheduleHomeCardRefresh?.();
}

function homeCardRegisterFolds(plugin) {
  if (typeof propertyCardRegisterFoldKind !== "function") return () => {};
  const toggle = (path) => {
    plugin.homeCardSetCollapsed(path, !plugin.homeCardIsCollapsed(path));
    return true;
  };
  const unArea = propertyCardRegisterFoldKind(plugin, "area", { toggle });
  const unProject = propertyCardRegisterFoldKind(plugin, "project", { toggle });
  return () => {
    unArea?.();
    unProject?.();
    for (const path of plugin.homeCardCollapsed?.keys?.() || []) {
      try { propertyCardFoldClearPendingReveal?.(path); } catch (_) {}
    }
  };
}

function homeCardDomAppendCollapse(slot, doc, model, options) {
  if (!slot) return;
  const collapsed = options?.collapsed === true;
  const button = homeCardDomEl(doc, "button", "bob-home-card-collapse");
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", collapsed ? "Expand card details" : "Collapse card details");
  homeCardDomText(doc, button, collapsed ? "▸" : "▾");
  if (typeof propertyCardDecorateFoldControl === "function") {
    propertyCardDecorateFoldControl(button, {
      kind: model.kind,
      path: options?.sourcePath || model.path || "",
      open: collapsed !== true,
      bodyId: typeof propertyCardFoldNextId === "function" ? propertyCardFoldNextId() : "",
      tooltip: "Toggle card details (_)",
      keyLive: options?.keyLive === true,
      compact: true,
    });
  }
  button.addEventListener?.("click", (event) => {
    try { event?.preventDefault?.(); } catch (_) {}
    try { options?.onToggleCollapse?.(!collapsed); } catch (_) {}
  });
  slot.appendChild(button);
}

function homeCardDomReasonLink(doc, options, link) {
  const text = String((link && link.text) || "").trim();
  if (!text) return null;
  const open = options && options.onLink;
  const live = typeof open === "function" && String(link.target || "").trim();
  const node = homeCardDomEl(doc, live ? "a" : "span", "bob-home-card-reason-link internal-link");
  homeCardDomText(doc, node, text);
  if (live) {
    node.setAttribute("href", link.target);
    node.setAttribute("data-href", link.target);
    if (typeof node.addEventListener === "function") {
      node.addEventListener("click", (event) => {
        try { event?.preventDefault?.(); } catch (_) {}
        try { open(link.target, event); } catch (_) {}
      });
    }
  }
  return node;
}

function homeCardDomReason(doc, model, options, row) {
  const reason = model && model.subtitle && model.subtitle.reason;
  const links = reason && Array.isArray(reason.links)
    ? reason.links.filter((link) => link && String(link.text || "").trim())
    : [];
  if (!links.length) return false;
  const detail = homeCardDomEl(doc, "span", "bob-home-card-lifecycle-detail");
  const lead = String(reason.lead || "").trim();
  homeCardDomText(doc, detail, lead ? `· ${lead} ` : "· ");
  links.forEach((link, index) => {
    if (index > 0) homeCardDomText(doc, detail, ", ");
    const node = homeCardDomReasonLink(doc, options, link);
    if (node) detail.appendChild(node);
    else homeCardDomText(doc, detail, String(link.text || "").trim());
  });
  const tail = String(reason.tail || "").trim();
  if (tail) homeCardDomText(doc, detail, ` ${tail}`);
  row.appendChild(detail);
  return true;
}

function homeCardDomSubtitle(doc, model, options) {
  const subtitle = model && model.subtitle;
  if (!subtitle || subtitle.pending || !subtitle.text) return null;
  const row = homeCardDomEl(doc, "div", subtitle.kind === "summary"
    ? "bob-property-card-subtitle bob-home-card-summary"
    : "bob-property-card-subtitle bob-home-card-lifecycle");
  if (subtitle.kind === "lifecycle") {
    if (subtitle.tone) row.setAttribute("data-lifecycle", subtitle.tone);
    if (subtitle.icon) {
      const glyph = homeCardDomEl(doc, "span", "bob-home-card-lifecycle-icon");
      homeCardDomSetIcon(glyph, subtitle.icon);
      row.appendChild(glyph);
    }
    const word = homeCardDomEl(doc, "span", "bob-home-card-lifecycle-word");
    homeCardDomText(doc, word, subtitle.word || subtitle.text);
    row.appendChild(word);
    if (!homeCardDomReason(doc, model, options, row) && subtitle.detail) {
      const detail = homeCardDomEl(doc, "span", "bob-home-card-lifecycle-detail");
      homeCardDomText(doc, detail, subtitle.detail);
      row.appendChild(detail);
    }
  } else {
    homeCardDomText(doc, row, subtitle.text);
  }
  if (subtitle.tooltip) row.setAttribute("title", subtitle.tooltip);
  return row;
}

function homeCardDomReportReadout(doc, text, tooltip, key) {
  const node = homeCardDomEl(doc, "span", "bob-home-card-report");
  if (key) node.setAttribute("data-home-report", key);
  if (tooltip) node.setAttribute("title", tooltip);
  homeCardDomText(doc, node, text);
  return node;
}

function homeCardDomMeta(doc, model, options) {
  const chips = Array.isArray(model.chips) ? model.chips : [];
  const ready = model.ready;
  const report = model.report && typeof model.report === "object" ? model.report : null;
  const open = report && Number.isInteger(report.open) && report.open >= 0 ? report.open : null;
  const today = report && Number.isInteger(report.today) && report.today >= 0 ? report.today : null;
  if (!chips.length && !ready && open == null && today == null) return null;
  const row = homeCardDomEl(doc, "div", HOME_CARD_META_CLASS);
  const cluster = homeCardDomEl(doc, "div", "bob-home-card-chips");
  for (const chip of chips) {
    const live = typeof options?.onOpenEditor === "function";
    const node = homeCardDomEl(doc, live ? "button" : "span", HOME_CARD_CHIP_CLASS);
    if (live) {
      node.setAttribute("type", "button");
      node.addEventListener?.("click", (event) => {
        try { event?.preventDefault?.(); } catch (_) {}
        homeCardDomOpenEditor(options, model, chip.settingKey || chip.key);
      });
    }
    if (chip.hue) node.setAttribute("data-root-hue", chip.hue);
    if (chip.warning) node.setAttribute("data-warning", "true");
    if (chip.tooltip) node.setAttribute("title", chip.tooltip);
    if (chip.key) node.setAttribute("data-home-chip", chip.key);
    homeCardDomText(doc, node, chip.text);
    if (chip.warning) {
      const mark = homeCardDomEl(doc, "span", "bob-home-card-chip-warning");
      mark.setAttribute("aria-hidden", "true");
      homeCardDomText(doc, mark, "⚠");
      node.appendChild(mark);
    }
    cluster.appendChild(node);
  }
  row.appendChild(cluster);
  if (ready) {
    const readout = homeCardDomEl(doc, "span", HOME_CARD_READY_CLASS);
    readout.setAttribute("data-ready-state", ready.state || "");
    if (ready.tooltip) readout.setAttribute("title", ready.tooltip);
    homeCardDomText(doc, readout, ready.text);
    row.appendChild(readout);
  }
  // Report-backed readouts paint only from a present snapshot: a missing
  // snapshot leaves them absent, never zero. Areas show direct today only
  // (decisions:card_structure_counts = no); terminal cards keep no readout.
  if (open != null && report.kind === "project") {
    row.appendChild(homeCardDomReportReadout(doc, `${open} open`,
      `Open tasks in this project: ${open}`, "open"));
  }
  if (today != null) {
    const scope = report.kind === "area" ? "directly in this area" : "in this project";
    row.appendChild(homeCardDomReportReadout(doc, `${today} today`,
      `Today tasks ${scope}: ${today}`, "today"));
  }
  return row;
}

function homeCardBuildEl(doc, model, options = {}) {
  try {
    if (!homeCardDomDocOk(doc) || !model || (model.kind !== "area" && model.kind !== "project")) return null;
    const title = String(model.title && model.title.text || "").trim();
    if (!title || typeof propertyCardBuildTitleBlock !== "function") return null;
    const card = homeCardDomEl(doc, "section", `${HOME_CARD_CLASS} bob-property-card`);
    card.setAttribute("data-home-kind", model.kind);
    if (model.terminal) card.classList.add("is-terminal");
    if (options.collapsed === true) card.classList.add("is-collapsed");
    if (homeCardDomReducedMotion(options)) card.classList.add("is-reduced-motion");
    if (model.material && model.material.paper === "hue" && model.material.hue) {
      card.setAttribute("data-root-hue", model.material.hue);
    } else {
      card.setAttribute("data-home-hue", "neutral");
    }
    if (model.material) card.setAttribute("data-home-wash", String(model.material.wash));
    if (typeof propertyCardApplyIdentity === "function") {
      propertyCardApplyIdentity(card, { kind: model.kind, title });
    }
    const block = propertyCardBuildTitleBlock(doc, {
      kind: model.kind,
      title,
      kicker: Array.isArray(model.crumbs) ? model.crumbs : [],
      onLink: (target, event) => {
        try { options?.onLink?.(target, event); } catch (_) {}
      },
    });
    if (!block) return null;
    if (model.terminal && block.tile) block.tile.setAttribute("data-tile-outline", "true");
    homeCardDomAppendPills(block.actions, doc, model);
    homeCardDomAppendSettings(block.actions, doc, model, options);
    homeCardDomAppendCollapse(block.actions, doc, model, options);
    card.appendChild(block.element);
    const subtitle = homeCardDomSubtitle(doc, model, options);
    if (subtitle) {
      if (subtitle.classList?.contains?.("bob-home-card-summary")) {
        const wrap = homeCardDomEl(doc, "div", "bob-home-card-collapsible");
        wrap.appendChild(subtitle);
        block.element.querySelector?.(".bob-property-card-title-main")?.appendChild(wrap)
          || card.appendChild(wrap);
      } else {
        block.element.querySelector?.(".bob-property-card-title-main")?.appendChild(subtitle)
          || card.appendChild(subtitle);
      }
    }
    const meta = homeCardDomMeta(doc, model, options);
    if (meta) {
      const wrap = homeCardDomEl(doc, "div", "bob-home-card-collapsible");
      wrap.appendChild(meta);
      card.appendChild(wrap);
    }
    const foldId = card.querySelector?.(".bob-home-card-collapse")?.getAttribute?.("aria-controls");
    if (foldId && typeof propertyCardFoldHiddenBody === "function") {
      const shell = propertyCardFoldHiddenBody(doc, foldId);
      if (shell) card.appendChild(shell);
    }
    return card;
  } catch (_) {
    return null;
  }
}
