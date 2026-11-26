// Property-card identity kit (bob-cli-o6 identity-kit): DOM builders for the
// glyph tile, the title block (tile, kicker, title row, subtitle, actions),
// and the docked rail. Every builder takes an ownerDocument and a spec,
// returns null instead of throwing, and writes text only through text nodes.
// Link handling is injected (onLink/onNavigate) so adapters keep modifier
// keys and jump history; the kit never adds Obsidian's internal-link class.
// `setIcon` is captured from `obsidian` at load time; tests leave the glyph
// empty and read data-icon instead.

let PropertyCardObsidianSetIcon = null;
try {
  const obsidianMod = require("obsidian");
  PropertyCardObsidianSetIcon = obsidianMod && typeof obsidianMod.setIcon === "function"
    ? obsidianMod.setIcon
    : null;
} catch (_) {
  PropertyCardObsidianSetIcon = null;
}

const PROPERTY_CARD_RAIL_DIRECTIONS = Object.freeze(["prev", "parent", "next"]);

function propertyCardKitText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function propertyCardKitEl(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function propertyCardKitAppendText(doc, node, text) {
  const value = propertyCardKitText(text);
  if (value) node.appendChild(doc.createTextNode(value));
  return node;
}

function propertyCardKitSpan(doc, className, text) {
  return propertyCardKitAppendText(doc, propertyCardKitEl(doc, "span", className), text);
}

function propertyCardKitAddClass(node, name) {
  try { node.classList?.add(name); } catch (_) {}
}

function propertyCardKitDocOk(doc) {
  return Boolean(doc && typeof doc.createElement === "function" && typeof doc.createTextNode === "function");
}

// Bind click (and middle-click) to an injected handler. The handler sees the
// raw event so adapters can honor Mod/Alt/Shift for tabs and splits.
function propertyCardKitBindLink(node, handler) {
  const open = (event) => {
    if (event?.type === "auxclick" && event.button !== 1) return;
    try { event?.preventDefault?.(); } catch (_) {}
    if (typeof handler === "function") {
      try { handler(event); } catch (_) {}
    }
  };
  try {
    node.addEventListener?.("click", open);
    node.addEventListener?.("auxclick", open);
  } catch (_) {}
}

function propertyCardKitLink(doc, className, target, unresolved) {
  const link = propertyCardKitEl(doc, "a", className);
  const href = propertyCardKitText(target);
  link.setAttribute("data-href", href);
  link.setAttribute("href", href);
  if (unresolved) propertyCardKitAddClass(link, "is-unresolved");
  return link;
}

// span.bob-property-card-tile[data-tile-form][aria-hidden]. Stack, sheet, and
// plain tiles show the emoji, else the species (or given) icon. A leaf tile
// shows a band (weekday or WEEK/QTR/YEAR) over a large value. A folio tile
// (prose) shows a value — the title initial — else the species icon, so the
// prose initial reads as a species in grayscale. A spine tile (notebook)
// needs no extra node: CSS paints its bound edge.
function propertyCardBuildGlyphTile(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const species = propertyCardSpecies(spec?.kind);
    if (!species) return null;
    const tile = propertyCardKitEl(doc, "span", "bob-property-card-tile");
    tile.setAttribute("data-tile-form", species.tile);
    tile.setAttribute("aria-hidden", "true");
    if (species.tile === "leaf") {
      const band = propertyCardKitText(spec.band).trim() || species.band;
      tile.appendChild(propertyCardKitSpan(doc, "bob-property-card-tile-band", band));
      const valueText = propertyCardKitText(spec.value).trim();
      const value = propertyCardKitSpan(doc, "bob-property-card-tile-value", valueText);
      // CSS shrinks long values (a year) so they fit the square tile.
      value.setAttribute("data-value-length", String(Array.from(valueText).length));
      tile.appendChild(value);
      return tile;
    }
    if (species.tile === "folio") {
      const valueText = propertyCardKitText(spec.value).trim();
      if (valueText) {
        const value = propertyCardKitSpan(doc, "bob-property-card-tile-value", valueText);
        value.setAttribute("data-value-length", String(Array.from(valueText).length));
        value.setAttribute("data-glyph", "initial");
        tile.appendChild(value);
        return tile;
      }
    }
    const glyph = propertyCardKitEl(doc, "span", "bob-property-card-tile-glyph");
    const emoji = propertyCardKitText(spec.emoji).trim();
    if (emoji) {
      glyph.setAttribute("data-glyph", "emoji");
      propertyCardKitAppendText(doc, glyph, emoji);
    } else {
      const icon = propertyCardKitText(spec.icon).trim() || species.icon;
      glyph.setAttribute("data-glyph", "icon");
      glyph.setAttribute("data-icon", icon);
      if (PropertyCardObsidianSetIcon) {
        try { PropertyCardObsidianSetIcon(glyph, icon); } catch (_) {}
      }
    }
    tile.appendChild(glyph);
    return tile;
  } catch (_) {
    return null;
  }
}

function propertyCardKitKickerPip(doc, part) {
  const hue = propertyCardKitText(part?.pip).trim();
  if (!hue) return null;
  const pip = propertyCardKitEl(doc, "span", "bob-property-card-kicker-pip");
  pip.setAttribute("aria-hidden", "true");
  pip.setAttribute("data-root-hue", hue);
  return pip;
}

function propertyCardKitKickerPart(doc, part, onLink) {
  const text = propertyCardKitText(part?.text).trim();
  if (!text) return null;
  const target = propertyCardKitText(part?.target).trim();
  const node = target
    ? propertyCardKitLink(doc, "bob-property-card-kicker-link", target, part.unresolved === true)
    : propertyCardKitEl(doc, "span", "bob-property-card-kicker-part");
  const pip = propertyCardKitKickerPip(doc, part);
  if (pip) node.appendChild(pip);
  propertyCardKitAppendText(doc, node, text);
  const tooltip = propertyCardKitText(part?.tooltip).trim();
  if (tooltip) node.setAttribute("title", tooltip);
  if (part?.ellipsis === true) node.setAttribute("aria-hidden", "true");
  if (target) {
    propertyCardKitBindLink(node, (event) => {
      if (typeof onLink === "function") onLink(target, event);
    });
  }
  return node;
}

// { element, tile, kicker, heading, pill, subtitle, actions } or null.
// spec: { kind, title, kicker = [{ text, target?, unresolved? }],
//         pill?: { text, tone: "solid" | "outline" }, subtitle?,
//         tile = {}, onLink?(target, event) }.
// The heading is a div[role=heading][aria-level=1]; the actions slot is
// always present (empty) so adapters can append buttons without reflow.
function propertyCardBuildTitleBlock(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const species = propertyCardSpecies(spec?.kind);
    if (!species) return null;
    const title = propertyCardKitText(spec.title).trim();
    if (!title) return null;
    const element = propertyCardKitEl(doc, "div", "bob-property-card-title-block");
    element.setAttribute(PROPERTY_CARD_KIND_ATTR, species.kind);

    const tileSpec = spec.tile && typeof spec.tile === "object" ? spec.tile : {};
    const tile = propertyCardBuildGlyphTile(doc, { ...tileSpec, kind: species.kind });
    if (tile) element.appendChild(tile);

    const main = propertyCardKitEl(doc, "div", "bob-property-card-title-main");
    const kickerRow = propertyCardKitEl(doc, "div", "bob-property-card-kicker-row");
    const kicker = propertyCardKitEl(doc, "span", "bob-property-card-kicker");
    kicker.appendChild(propertyCardKitSpan(doc, "bob-property-card-kicker-species", species.word));
    for (const part of Array.isArray(spec.kicker) ? spec.kicker : []) {
      const node = propertyCardKitKickerPart(doc, part, spec.onLink);
      if (!node) continue;
      const sep = propertyCardKitSpan(doc, "bob-property-card-kicker-sep", "·");
      sep.setAttribute("aria-hidden", "true");
      kicker.appendChild(sep);
      kicker.appendChild(node);
    }
    kickerRow.appendChild(kicker);
    const actions = propertyCardKitEl(doc, "span", "bob-property-card-actions");
    kickerRow.appendChild(actions);
    main.appendChild(kickerRow);

    const titleRow = propertyCardKitEl(doc, "div", "bob-property-card-title-row");
    const heading = propertyCardKitEl(doc, "div", "bob-property-card-title");
    heading.setAttribute("role", "heading");
    heading.setAttribute("aria-level", "1");
    propertyCardKitAppendText(doc, heading, title);
    titleRow.appendChild(heading);
    let pill = null;
    const pillText = propertyCardKitText(spec.pill?.text).trim();
    if (pillText) {
      pill = propertyCardKitSpan(doc, "bob-property-card-pill", pillText);
      pill.setAttribute("data-pill-tone", spec.pill.tone === "outline" ? "outline" : "solid");
      titleRow.appendChild(pill);
    }
    main.appendChild(titleRow);

    let subtitle = null;
    const subtitleText = propertyCardKitText(spec.subtitle).trim();
    if (subtitleText) {
      subtitle = propertyCardKitEl(doc, "div", "bob-property-card-subtitle");
      propertyCardKitAppendText(doc, subtitle, subtitleText);
      main.appendChild(subtitle);
    }
    element.appendChild(main);
    return { element, tile, kicker, heading, pill, subtitle, actions };
  } catch (_) {
    return null;
  }
}

function propertyCardKitRailItemOk(item) {
  return Boolean(item && typeof item === "object"
    && propertyCardKitText(item.label).trim()
    && propertyCardKitText(item.target).trim());
}

// Items and chips take a missing-target state (240l): `state` of exists,
// creatable, or ghost, else the legacy `unresolved: true` as creatable.
// The rail never decides activation; onNavigate sees the stated item.
function propertyCardKitRailItem(doc, direction, item, onNavigate) {
  const target = propertyCardKitText(item.target).trim();
  const state = propertyCardTargetState(item);
  const stated = propertyCardKitStatedItem(item, state);
  const link = propertyCardKitLink(doc, "bob-property-card-rail-item", target, state !== "exists");
  link.setAttribute("data-rail", direction);
  const ariaLabel = propertyCardKitText(item.ariaLabel).trim();
  if (ariaLabel) link.setAttribute("aria-label", ariaLabel);
  const wide = propertyCardKitText(item.label).trim();
  const narrow = propertyCardKitText(item.shortLabel).trim() || wide;
  const glyph = (text) => {
    const node = propertyCardKitSpan(doc, "bob-property-card-rail-glyph", text);
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  if (direction === "prev") link.appendChild(glyph("‹ "));
  if (direction === "parent") link.appendChild(glyph("↑ "));
  link.appendChild(propertyCardKitSpan(doc, "bob-property-card-rail-label-wide", wide));
  link.appendChild(propertyCardKitSpan(doc, "bob-property-card-rail-label-narrow", narrow));
  for (const mark of propertyCardKitStateMarks(doc, link, item, state, false)) link.appendChild(mark);
  if (direction === "next") link.appendChild(glyph(" ›"));
  propertyCardKitBindTarget(link, state, (event) => {
    if (typeof onNavigate === "function") onNavigate(direction, stated, event);
  });
  return link;
}

function propertyCardKitRailChip(doc, child, onNavigate) {
  const target = propertyCardKitText(child.target).trim();
  const state = propertyCardTargetState(child);
  const stated = propertyCardKitStatedItem(child, state);
  const chip = propertyCardKitLink(doc, "bob-property-card-rail-chip", target, state !== "exists");
  chip.setAttribute("role", "listitem");
  if (child.current === true) {
    propertyCardKitAddClass(chip, "is-current");
    chip.setAttribute("aria-current", "true");
  }
  propertyCardKitAppendText(doc, chip, propertyCardKitText(child.label).trim());
  for (const mark of propertyCardKitStateMarks(doc, chip, child, state, true)) chip.appendChild(mark);
  propertyCardKitBindTarget(chip, state, (event) => {
    if (typeof onNavigate === "function") onNavigate("child", stated, event);
  });
  return chip;
}

// { element, items: { prev, parent, next }, children: [], group } or null
// when there is no item, child, or group row. Missing items keep their grid
// column with an empty gap span. spec.group (a group-row spec, 240l) renders
// between the step row and the children strip; with a group row and no step
// item the step row is left out. Children render as a wrapping chip strip;
// the current chip carries is-current and aria-current.
function propertyCardBuildRail(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    const children = (Array.isArray(options.children) ? options.children : []).filter(propertyCardKitRailItemOk);
    const present = PROPERTY_CARD_RAIL_DIRECTIONS.filter((direction) => propertyCardKitRailItemOk(options[direction]));
    const group = options.group && typeof options.group === "object" && typeof propertyCardBuildGroupRow === "function"
      ? propertyCardBuildGroupRow(doc, options.group)
      : null;
    if (!present.length && !children.length && !group) return null;
    const element = propertyCardKitEl(doc, "nav", "bob-property-card-rail");
    element.setAttribute("aria-label", propertyCardKitText(options.label).trim() || "Note navigation");
    const items = { prev: null, parent: null, next: null };
    if (present.length || !group) {
      const row = propertyCardKitEl(doc, "div", "bob-property-card-rail-row");
      for (const direction of PROPERTY_CARD_RAIL_DIRECTIONS) {
        const item = options[direction];
        if (propertyCardKitRailItemOk(item)) {
          items[direction] = propertyCardKitRailItem(doc, direction, item, options.onNavigate);
          row.appendChild(items[direction]);
        } else {
          const gap = propertyCardKitEl(doc, "span", "bob-property-card-rail-gap");
          gap.setAttribute("data-rail", direction);
          row.appendChild(gap);
        }
      }
      element.appendChild(row);
    }
    if (group) element.appendChild(group.element);
    const chips = [];
    if (children.length) {
      const strip = propertyCardKitEl(doc, "div", "bob-property-card-rail-children");
      strip.setAttribute("role", "list");
      for (const child of children) {
        const chip = propertyCardKitRailChip(doc, child, options.onNavigate);
        strip.appendChild(chip);
        chips.push(chip);
      }
      element.appendChild(strip);
    }
    return { element, items, children: chips, group: group || null };
  } catch (_) {
    return null;
  }
}
