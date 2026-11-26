// Prose Card DOM (bob-cli-qm prose-card): a quiet title page plus reserved
// Bob Prose readout slots. All note-provided content is appended as text.
const PROSE_NOTE_CARD_SURFACE_CLASS = "bob-prose-note-card";

function proseNoteCardDomEl(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function proseNoteCardDomText(doc, node, value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text) node.appendChild(doc.createTextNode(text));
  return node;
}

function proseNoteCardNumberingNode(doc, model, options) {
  const numbering = model?.numbering || { state: "numbered" };
  const valid = numbering.state === "numbered" || numbering.state === "unnumbered";
  const live = valid && options.numberingCommandAvailable === true
    && typeof options.onToggleNumbering === "function";
  const node = proseNoteCardDomEl(doc, live ? "button" : "span", "bob-prose-note-card-numbering");
  const text = numbering.state === "invalid" ? "§ ⚠" : `§ ${numbering.state || "numbered"}`;
  proseNoteCardDomText(doc, node, text);
  node.setAttribute("data-numbering-state", numbering.state || "numbered");
  node.setAttribute("aria-label", numbering.state === "invalid"
    ? "Invalid section_numbers value"
    : `Section numbering: ${numbering.state || "numbered"}`);
  if (numbering.state === "invalid") {
    node.setAttribute("title", "Allowed values: true or false (default: true).");
  } else {
    node.setAttribute("title", live
      ? "Toggle section numbering through Bob Prose"
      : "Section numbering · Bob Prose command unavailable");
  }
  if (live) {
    node.setAttribute("type", "button");
    node.addEventListener?.("click", (event) => {
      try { event?.preventDefault?.(); } catch (_) {}
      try { options.onToggleNumbering(event); } catch (_) {}
    });
  }
  return node;
}

// Returns a card root with an empty measures slot and outline shell. The
// Bob Prose seam fills those regions later without replacing the title page.
function proseNoteCardBuildEl(doc, model, options = {}) {
  try {
    if (!doc || typeof doc.createElement !== "function" || typeof doc.createTextNode !== "function"
      || !model || model.kind !== PROSE_NOTE_CARD_KIND || !model.title?.text
      || typeof propertyCardBuildTitleBlock !== "function") return null;
    const card = proseNoteCardDomEl(doc, "section", `${PROSE_NOTE_CARD_SURFACE_CLASS} bob-property-card`);
    if (options.expanded !== true) card.classList?.add?.("is-collapsed");
    card.setAttribute("data-prose-kind", "prose");
    if (typeof propertyCardApplyIdentity === "function") {
      propertyCardApplyIdentity(card, { kind: "prose", title: model.title.text });
    }

    const block = propertyCardBuildTitleBlock(doc, {
      kind: "prose",
      title: model.title.text,
      kicker: Array.isArray(model.crumbs) ? model.crumbs : [],
      tile: { value: model.initial || "", icon: "pilcrow" },
      subtitle: model.dek || "",
      onLink: (target, event) => {
        try { options.onLink?.(target, event); } catch (_) {}
      },
    });
    if (!block) return null;
    if (model.title.fromStem === true) {
      block.heading.setAttribute("title", "Title from the file name — press == to set one");
    }
    if (block.subtitle) block.subtitle.classList?.add?.("bob-prose-note-card-dek");
    block.actions.appendChild(proseNoteCardNumberingNode(doc, model, options));
    card.appendChild(block.element);

    const measureRow = proseNoteCardDomEl(doc, "div", "bob-prose-note-card-measure-row");
    measureRow.setAttribute("aria-live", "polite");
    measureRow.setAttribute("data-prose-measure-row", "true");
    const measureSlot = proseNoteCardDomEl(doc, "div", "bob-prose-note-card-measures");
    measureSlot.setAttribute("data-prose-measures", "true");
    measureRow.appendChild(measureSlot);
    card.appendChild(measureRow);

    const fold = typeof propertyCardBuildFoldRow === "function"
      ? propertyCardBuildFoldRow(doc, {
        kind: PROSE_NOTE_CARD_HOST_KIND,
        path: model.path,
        noun: "Outline",
        open: options.expanded === true,
        keyLive: options.keyLive === true,
        tooltip: "Toggle the Prose outline (_)",
        onToggle: (next) => { try { options.onToggleOutline?.(next === true); } catch (_) {} },
      })
      : { element: null, bodyId: "" };
    if (fold.element) card.appendChild(fold.element);
    const outline = proseNoteCardDomEl(doc, "div", "bob-prose-note-card-outline");
    outline.setAttribute("data-prose-outline", "true");
    outline.setAttribute("data-prose-outline-slot", PROSE_NOTE_CARD_OUTLINE_SLOT);
    if (fold.bodyId) outline.setAttribute("id", fold.bodyId);
    if (options.expanded !== true) outline.setAttribute("hidden", "");
    card.appendChild(outline);
    return card;
  } catch (_) {
    return null;
  }
}
