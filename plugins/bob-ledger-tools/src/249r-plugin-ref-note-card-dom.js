// Ref Card title shell. All note and report values enter through text nodes;
// this fragment never parses HTML, starts bob, or writes the vault.
const REF_NOTE_CARD_SURFACE_CLASS = "bob-ref-card";
const REF_NOTE_CARD_READOUT_ATTR = "data-ref-readouts";

function refNoteCardDomEl(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function refNoteCardDomText(doc, node, value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text) node.appendChild(doc.createTextNode(text));
  return node;
}

function refNoteCardFoldButton(doc, model, options, bodyId) {
  const collapsed = options?.collapsed === true;
  const button = refNoteCardDomEl(doc, "button", "bob-ref-card-fold bob-home-card-collapse");
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", collapsed ? "Expand Ref Card details" : "Compact Ref Card");
  button.setAttribute("title", "Toggle Ref Card details (_)");
  button.setAttribute("aria-controls", bodyId);
  refNoteCardDomText(doc, button, collapsed ? "▸" : "▾");
  try {
    propertyCardDecorateFoldControl?.(button, {
      kind: model.kind,
      path: model.path,
      open: !collapsed,
      bodyId,
      tooltip: "Toggle Ref Card details (_)",
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

function refNoteCardLaneSlot(doc) {
  const slot = refNoteCardDomEl(doc, "span", "bob-ref-card-lane");
  slot.setAttribute("data-ref-lane", "true");
  slot.setAttribute("data-state", "waiting");
  slot.setAttribute("aria-live", "polite");
  slot.setAttribute("aria-hidden", "true");
  return slot;
}

function refNoteCardVersionSlot(doc, titleRow) {
  const slot = refNoteCardDomEl(doc, "span", "bob-ref-card-version");
  slot.setAttribute("data-ref-version", "true");
  slot.setAttribute("data-state", "waiting");
  slot.setAttribute("aria-live", "polite");
  slot.setAttribute("aria-hidden", "true");
  titleRow.appendChild(slot);
  return slot;
}

function refNoteCardByline(doc, model) {
  const row = refNoteCardDomEl(doc, "div", "bob-ref-card-byline");
  row.setAttribute("data-ref-byline", "true");
  const parts = Array.isArray(model.byline) ? model.byline : [];
  for (const [index, part] of parts.entries()) {
    if (index) refNoteCardDomText(doc, row, " · ");
    if (part.kind === "source" && part.href) {
      const link = refNoteCardDomEl(doc, "a", "bob-ref-card-byline-source");
      link.setAttribute("href", part.href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("aria-label", `Open source at ${part.text}`);
      refNoteCardDomText(doc, link, `${part.text} ↗`);
      row.appendChild(link);
    } else {
      const node = refNoteCardDomEl(doc, "span", `bob-ref-card-byline-${part.kind || "detail"}`);
      refNoteCardDomText(doc, node, part.text);
      row.appendChild(node);
    }
  }
  if (parts.length) {
    const identifiers = refNoteCardDomEl(doc, "span", "bob-ref-card-identifiers");
    identifiers.setAttribute("data-ref-identifiers", "true");
    identifiers.setAttribute("data-state", "waiting");
    identifiers.setAttribute("aria-live", "polite");
    identifiers.setAttribute("aria-hidden", "true");
    row.appendChild(identifiers);
  }
  return parts.length ? row : null;
}

function refNoteCardAccessButton(doc, label, glyph, marker, target, callback) {
  const button = refNoteCardDomEl(doc, "button", "bob-ref-card-access");
  button.setAttribute("type", "button");
  button.setAttribute(marker, target);
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  refNoteCardDomText(doc, button, `${glyph} ${label}`);
  button.addEventListener?.("click", (event) => {
    try { event?.preventDefault?.(); } catch (_) {}
    try { callback?.(target, event); } catch (_) {}
  });
  return button;
}

function refNoteCardAccessRow(doc, model, options) {
  if (model.hasAccess !== true) return null;
  const row = refNoteCardDomEl(doc, "div", "bob-ref-card-access-row");
  row.setAttribute("data-ref-access-row", "true");
  if (model.sourcePdf) {
    const pdfLabel = options.pdfMode === "highlights" ? "Open source PDF in Highlights" : "Open source PDF in Obsidian";
    row.appendChild(refNoteCardAccessButton(doc, pdfLabel, "▤", "data-ref-pdf", model.sourcePdf, options.onOpenPdf));
  }
  if (model.audio) {
    row.appendChild(refNoteCardAccessButton(doc, "Listen to companion audio", "♫", "data-ref-audio", model.audio, options.onListen));
  }
  const readouts = refNoteCardDomEl(doc, "div", "bob-ref-card-readouts");
  readouts.setAttribute(REF_NOTE_CARD_READOUT_ATTR, "true");
  readouts.setAttribute("data-state", "reserved");
  readouts.setAttribute("aria-live", "polite");
  const annotations = refNoteCardDomEl(doc, "span", "bob-ref-card-annotations");
  annotations.setAttribute("data-ref-annotations", "true");
  annotations.setAttribute("data-state", "waiting");
  annotations.setAttribute("aria-hidden", "true");
  readouts.appendChild(annotations);
  row.appendChild(readouts);
  return row;
}

function refNoteCardBuildEl(doc, model, options = {}) {
  try {
    if (!doc || typeof doc.createElement !== "function" || typeof doc.createTextNode !== "function"
      || !model || model.kind !== REF_NOTE_CARD_KIND || !String(model.title?.text || "").trim()
      || typeof propertyCardBuildTitleBlock !== "function") return null;
    const card = refNoteCardDomEl(doc, "section", `${REF_NOTE_CARD_SURFACE_CLASS} bob-property-card`);
    card.setAttribute("data-ref-card", "true");
    card.setAttribute("data-ref-source", model.path);
    card.setAttribute("data-ref-kind", model.refType || "other");
    card.setAttribute("data-tone", model.tone || "quiet");
    if (options.collapsed === true) card.classList?.add?.("is-collapsed");
    if (options.reducedMotion === true) card.classList?.add?.("is-reduced-motion");
    if (model.hue) card.setAttribute("data-root-hue", model.hue);
    else card.setAttribute("data-home-hue", "neutral");
    propertyCardApplyIdentity?.(card, { kind: REF_NOTE_CARD_KIND, title: model.title.text });

    const kicker = [{ text: model.kindWord || "Ref" }, ...(Array.isArray(model.crumbs) ? model.crumbs : [])];
    const block = propertyCardBuildTitleBlock(doc, {
      kind: REF_NOTE_CARD_KIND,
      title: model.title.text,
      kicker,
      icon: model.icon || "bookmark",
      subtitle: model.dek || "",
      onLink: (target, event) => { try { options.onLink?.(target, event); } catch (_) {} },
    });
    if (!block) return null;
    block.kicker.appendChild(refNoteCardLaneSlot(doc));
    const titleRow = block.heading?.parentNode || block.heading;
    if (titleRow) refNoteCardVersionSlot(doc, titleRow);
    if (block.subtitle) block.subtitle.classList?.add?.("bob-ref-card-dek");
    if (model.title.fromStem === true) {
      block.heading.setAttribute("title", "Title from the file name · press = to add a title");
    }
    const bodyId = typeof propertyCardFoldNextId === "function"
      ? propertyCardFoldNextId() : `bob-ref-card-body-${String(model.path).replace(/[^a-z0-9_-]/gi, "-")}`;
    block.actions?.appendChild?.(refNoteCardFoldButton(doc, model, options, bodyId));
    card.appendChild(block.element);

    const details = refNoteCardDomEl(doc, "div", "bob-ref-card-details bob-home-card-collapsible");
    const byline = refNoteCardByline(doc, model);
    if (byline) details.appendChild(byline);
    const access = refNoteCardAccessRow(doc, model, options);
    if (access) details.appendChild(access);
    details.setAttribute("id", bodyId);
    if (options.collapsed === true) details.setAttribute("hidden", "");
    card.appendChild(details);
    try { options.appendFoot?.(card, model, doc); } catch (_) {}
    return card;
  } catch (_) {
    return null;
  }
}
