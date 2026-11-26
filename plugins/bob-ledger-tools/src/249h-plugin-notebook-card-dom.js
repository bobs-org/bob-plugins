// Notebook Card DOM (bob-cli-qm notebook-card). Build an accessible title
// block and local identity from text nodes only. The readout slot is stable
// so the report phase can patch its rows without replacing the shell.
const NOTEBOOK_CARD_SURFACE_CLASS = "bob-notebook-card";
const NOTEBOOK_CARD_READOUT_MARKER = "data-notebook-readouts";

function notebookCardDomEl(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function notebookCardDomText(doc, node, value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text) node.appendChild(doc.createTextNode(text));
  return node;
}

function notebookCardFoldButton(doc, model, options, bodyId) {
  const collapsed = options?.collapsed === true;
  const button = notebookCardDomEl(doc, "button", "bob-notebook-card-fold bob-home-card-collapse");
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", collapsed ? "Expand notebook card details" : "Collapse notebook card details");
  button.setAttribute("title", "Toggle card details (_)");
  button.setAttribute("aria-controls", bodyId);
  notebookCardDomText(doc, button, collapsed ? "▸" : "▾");
  try {
    propertyCardDecorateFoldControl?.(button, {
      kind: model.kind,
      path: model.path,
      open: !collapsed,
      bodyId,
      tooltip: "Toggle card details (_)",
      keyLive: options?.keyLive === true,
      compact: true,
    });
  } catch (_) {}
  button.addEventListener?.("click", (event) => {
    try { event?.preventDefault?.(); } catch (_) {}
    try { options?.onToggleFold?.(!collapsed); } catch (_) {}
  });
  return button;
}

function notebookCardSummary(doc, model, options) {
  if (model.summaryMissing) {
    const ghost = notebookCardDomEl(doc, "button", "bob-notebook-card-summary bob-notebook-card-add-summary");
    ghost.setAttribute("type", "button");
    ghost.setAttribute("aria-label", "Add summary");
    ghost.setAttribute("title", "Add a notebook summary");
    notebookCardDomText(doc, ghost, "＋ Add summary");
    ghost.addEventListener?.("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      try { options?.onAddSummary?.(); } catch (_) {}
    });
    return ghost;
  }
  const summary = notebookCardDomEl(doc, "div", "bob-property-card-subtitle bob-notebook-card-summary");
  summary.setAttribute("title", model.summary);
  notebookCardDomText(doc, summary, model.summary);
  return summary;
}

function notebookCardReadoutSlot(doc) {
  const slot = notebookCardDomEl(doc, "div", "bob-notebook-card-readouts");
  slot.setAttribute(NOTEBOOK_CARD_READOUT_MARKER, "notebook-readouts");
  slot.setAttribute("data-state", "reserved");
  slot.setAttribute("aria-live", "polite");
  // Stable children are patched by the report-backed phase. Empty slots are
  // visually quiet and never imply that the report contains zeroes.
  for (const name of ["summary", "sections", "children", "findings"]) {
    const child = notebookCardDomEl(doc, "div", `bob-notebook-card-${name}`);
    child.setAttribute(`data-notebook-${name}`, "true");
    slot.appendChild(child);
  }
  return slot;
}

function notebookCardBuildEl(doc, model, options = {}) {
  try {
    if (!doc || typeof doc.createElement !== "function" || typeof doc.createTextNode !== "function") return null;
    if (!model || model.kind !== "notebook" || !String(model.title?.text || "").trim()) return null;
    if (typeof propertyCardBuildTitleBlock !== "function") return null;
    const card = notebookCardDomEl(doc, "section", `${NOTEBOOK_CARD_SURFACE_CLASS} bob-home-card bob-property-card`);
    card.setAttribute("data-notebook-card", "true");
    card.setAttribute("data-notebook-source", model.path);
    if (options.collapsed === true) card.classList?.add?.("is-collapsed");
    if (options.reducedMotion === true) card.classList?.add?.("is-reduced-motion");
    if (model.hue) card.setAttribute("data-root-hue", model.hue);
    else card.setAttribute("data-home-hue", "neutral");
    propertyCardApplyIdentity?.(card, { kind: "notebook", title: model.title.text });

    const block = propertyCardBuildTitleBlock(doc, {
      kind: "notebook",
      title: model.title.text,
      kicker: Array.isArray(model.crumbs) ? model.crumbs : [],
      onLink: (target, event) => { try { options.onLink?.(target, event); } catch (_) {} },
    });
    if (!block) return null;
    const bodyId = typeof propertyCardFoldNextId === "function"
      ? propertyCardFoldNextId() : `bob-notebook-card-body-${String(model.path).replace(/[^a-z0-9_-]/gi, "-")}`;
    block.actions?.appendChild?.(notebookCardFoldButton(doc, model, options, bodyId));
    card.appendChild(block.element);

    const body = notebookCardDomEl(doc, "div", "bob-notebook-card-details bob-home-card-collapsible");
    const contents = notebookCardDomEl(doc, "div", "bob-notebook-card-body");
    contents.appendChild(notebookCardSummary(doc, model, options));
    contents.appendChild(notebookCardReadoutSlot(doc));
    body.appendChild(contents);
    card.appendChild(body);
    try {
      const shell = propertyCardFoldHiddenBody?.(doc, bodyId);
      if (shell) card.appendChild(shell);
    } catch (_) {}

    try { options.appendFoot?.(card, model, doc); } catch (_) {}
    return card;
  } catch (_) {
    return null;
  }
}
