// Pure painter for the Ctrl+J / Ctrl+K Section Map card. Renders only from the
// Section Map model plus placement rects; no workspace access. Reuses one DOM
// tree with keyed in-place reconciliation and never throws.
const SECTION_MAP_ROW_HEIGHT = 24;
const SECTION_MAP_HEADER_RESERVE = 64;
const SECTION_MAP_GUTTER_MIN = 252;
const SECTION_MAP_CARD_MAX_WIDTH = 300;
const SECTION_MAP_CARD_MIN_WIDTH = 220;
const SECTION_MAP_CARD_TOP_OFFSET = 12;
const SECTION_MAP_CARD_INSET = 12;
const SECTION_MAP_COMPACT_MAX_WIDTH = 480;
const SECTION_MAP_COMPACT_MAX_HEIGHT = 168;
const SECTION_MAP_COMPACT_STRIP_HEIGHT = 24;
// Card chrome around the compact strip: 8 px padding on each side plus the
// 1 px border, from the .bob-section-map rule in styles.css.
const SECTION_MAP_CARD_CHROME = 18;
const SECTION_MAP_INDENT = 12;
const SECTION_MAP_MAX_DEPTH = 4;

function sectionMapText(value) {
  if (value == null) return "";
  return String(value);
}

function sectionMapNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sectionMapRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const left = sectionMapNum(rect.left, Number.NaN);
  const top = sectionMapNum(rect.top, Number.NaN);
  const width = Number.isFinite(rect.width)
    ? sectionMapNum(rect.width)
    : sectionMapNum(rect.right) - left;
  const height = Number.isFinite(rect.height)
    ? sectionMapNum(rect.height)
    : sectionMapNum(rect.bottom) - top;
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    return null;
  }
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function sectionMapRectsOverlap(left, right) {
  if (!left || !right) return false;
  return left.left < right.right && right.left < left.right &&
    left.top < right.bottom && right.top < left.bottom;
}

function sectionMapEmpty(node) {
  if (!node) return;
  if (typeof node.empty === "function") {
    node.empty();
    return;
  }
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) child.parent = null;
    node.children = [];
    node.textContent = "";
  }
}

function sectionMapDetach(node) {
  if (!node) return;
  if (typeof node.remove === "function") {
    try {
      node.remove();
      return;
    } catch (_error) {
      // Fall through to parent unlink.
    }
  }
  const parent = node.parent || node.parentNode;
  if (parent && Array.isArray(parent.children)) {
    parent.children = parent.children.filter((child) => child !== node);
    node.parent = null;
    return;
  }
  if (parent && typeof parent.removeChild === "function") {
    try {
      parent.removeChild(node);
    } catch (_error) {
      // Already detached.
    }
  }
}

function sectionMapAddClass(node, name) {
  if (!node || !name) return;
  if (node.classList && typeof node.classList.add === "function") {
    node.classList.add(name);
    return;
  }
  const current = sectionMapText(node.className);
  if (!current.split(/\s+/).includes(name)) node.className = `${current} ${name}`.trim();
}

function sectionMapRemoveClass(node, name) {
  if (!node || !name) return;
  if (node.classList && typeof node.classList.remove === "function") {
    node.classList.remove(name);
    return;
  }
  const next = sectionMapText(node.className)
    .split(/\s+/)
    .filter((item) => item && item !== name);
  node.className = next.join(" ");
}

function sectionMapHasClass(node, name) {
  if (!node || !name) return false;
  if (node.classList && typeof node.classList.contains === "function") {
    return node.classList.contains(name);
  }
  return sectionMapText(node.className).split(/\s+/).includes(name);
}

function sectionMapSetText(node, text) {
  if (!node) return;
  const value = sectionMapText(text);
  if (typeof node.setText === "function") node.setText(value);
  else node.textContent = value;
}

function sectionMapMakeEl(parent, tag, options = {}) {
  if (parent && typeof parent.createEl === "function") {
    return parent.createEl(tag, options);
  }
  const doc = parent && (parent.ownerDocument || parent.document);
  const node = doc && typeof doc.createElement === "function"
    ? doc.createElement(tag)
    : null;
  if (!node) return null;
  if (options.cls) node.className = options.cls;
  if (options.text != null) sectionMapSetText(node, options.text);
  if (options.attr && typeof options.attr === "object") {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value == null) continue;
      if (typeof node.setAttribute === "function") node.setAttribute(key, String(value));
    }
  }
  if (parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function sectionMapPrefersReducedMotion(doc) {
  try {
    const media = doc?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    return Boolean(media && media.matches);
  } catch (_error) {
    return false;
  }
}

function sectionMapRowTop(rowEl, index) {
  const top = rowEl ? rowEl.offsetTop : Number.NaN;
  if (Number.isFinite(top)) return top;
  return index * SECTION_MAP_ROW_HEIGHT;
}

function sectionMapRowHeight(rowEl) {
  const height = rowEl ? rowEl.offsetHeight : Number.NaN;
  if (Number.isFinite(height) && height > 0) return height;
  return SECTION_MAP_ROW_HEIGHT;
}

// Pure placement: margin, overlay, then compact, in that order of preference.
// Recomputed only on pane resize or pane move; the card never chases the caret.
function computeSectionMapPlacement(input) {
  const source = input && typeof input === "object" ? input : {};
  const host = sectionMapRect(source.host);
  if (!host) {
    return {
      mode: "compact",
      left: 0,
      top: 0,
      width: SECTION_MAP_CARD_MIN_WIDTH,
      maxRows: 1,
    };
  }
  const scroller = sectionMapRect(source.scroller) || host;
  const textColumn = sectionMapRect(source.textColumn);
  const notices = Array.isArray(source.notices)
    ? source.notices.map(sectionMapRect).filter(Boolean)
    : [];
  if (host.width < SECTION_MAP_COMPACT_MAX_WIDTH || host.height < SECTION_MAP_COMPACT_MAX_HEIGHT) {
    return {
      mode: "compact",
      left: Math.round(host.left + SECTION_MAP_CARD_INSET),
      top: Math.round(
        host.bottom - SECTION_MAP_CARD_INSET - SECTION_MAP_COMPACT_STRIP_HEIGHT - SECTION_MAP_CARD_CHROME,
      ),
      width: Math.round(Math.max(0, host.width - 2 * SECTION_MAP_CARD_INSET)),
      maxRows: SECTION_MAP_FULL_ROWS,
    };
  }
  const anchorTop = scroller.top + SECTION_MAP_CARD_TOP_OFFSET;
  const available = Math.max(0, host.bottom - SECTION_MAP_CARD_INSET - anchorTop);
  const maxRows = Math.max(
    1,
    Math.min(
      SECTION_MAP_FULL_ROWS,
      Math.floor((available - SECTION_MAP_HEADER_RESERVE) / SECTION_MAP_ROW_HEIGHT),
    ),
  );
  let placement;
  const gutter = textColumn ? host.right - textColumn.right : 0;
  if (textColumn && gutter >= SECTION_MAP_GUTTER_MIN) {
    // The spec sizes the margin card at min(300, gutter - 32): a 16 px
    // breathing room on top of the 16 px card inset.
    const width = Math.min(SECTION_MAP_CARD_MAX_WIDTH, gutter - 32);
    placement = {
      mode: "margin",
      left: textColumn.right + (gutter - width) / 2,
      top: anchorTop,
      width,
      maxRows,
    };
  } else {
    const width = Math.max(
      SECTION_MAP_CARD_MIN_WIDTH,
      Math.min(SECTION_MAP_CARD_MAX_WIDTH, scroller.width * 0.3),
    );
    placement = {
      mode: "overlay",
      left: scroller.right - width - SECTION_MAP_CARD_INSET,
      top: anchorTop,
      width,
      maxRows,
    };
  }
  const estimatedHeight = SECTION_MAP_HEADER_RESERVE + placement.maxRows * SECTION_MAP_ROW_HEIGHT;
  const card = {
    left: placement.left,
    top: placement.top,
    right: placement.left + placement.width,
    bottom: placement.top + estimatedHeight,
  };
  for (const notice of notices) {
    if (sectionMapRectsOverlap(card, notice)) {
      placement = { ...placement, top: notice.bottom + 8 };
      break;
    }
  }
  return {
    mode: placement.mode,
    left: Math.round(placement.left),
    top: Math.round(placement.top),
    width: Math.round(placement.width),
    maxRows: placement.maxRows,
  };
}

function sectionMapRowDomKey(row) {
  return `sm:${sectionMapText(row && row.key)}`;
}

function sectionMapPaintHeadingRow(el, row) {
  const depth = Math.max(0, Math.min(SECTION_MAP_MAX_DEPTH, Math.floor(sectionMapNum(row.depth, 0))));
  if (el.style) el.style.paddingLeft = `${depth * SECTION_MAP_INDENT}px`;
  if (el.style) el.style.opacity = String(row.opacity == null ? 1 : row.opacity);
  const label = sectionMapText(row.label);
  const wasUntitled = sectionMapHasClass(el, "is-untitled");
  const isUntitled = label === "(untitled)";
  if (isUntitled && !wasUntitled) sectionMapAddClass(el, "is-untitled");
  if (!isUntitled && wasUntitled) sectionMapRemoveClass(el, "is-untitled");
  const isCurrent = row.current === true;
  const isFrom = row.from === true;
  const chips = Array.isArray(row.chips) ? row.chips : [];
  const hasChips = chips.length > 0;
  const flags = [
    ["is-current", isCurrent],
    ["is-from", isFrom],
    ["is-chip-target", row.chipTarget === true || hasChips],
  ];
  for (const [name, on] of flags) {
    const has = sectionMapHasClass(el, name);
    if (on && !has) sectionMapAddClass(el, name);
    if (!on && has) sectionMapRemoveClass(el, name);
  }
  const guides = el.guides || null;
  const depthAttr = el.getAttribute ? el.getAttribute("data-depth") : el.depthAttr;
  if (guides && String(depthAttr) !== String(depth)) {
    sectionMapEmpty(guides);
    for (let index = 0; index < depth; index += 1) {
      const guide = sectionMapMakeEl(guides, "span", { cls: "bob-section-map-guide" });
      if (guide && guide.style) guide.style.left = `${index * SECTION_MAP_INDENT + 5}px`;
    }
    if (el.setAttribute) el.setAttribute("data-depth", String(depth));
    else el.depthAttr = String(depth);
  }
  if (el.ring) {
    if (el.ring.style) el.ring.style.visibility = isFrom ? "visible" : "hidden";
  }
  if (el.label) sectionMapSetText(el.label, label);
  if (el.chips) {
    sectionMapEmpty(el.chips);
    for (const chip of chips) {
      if (!chip || typeof chip !== "object") continue;
      const text = `${sectionMapText(chip.shortcut)}${chip.wrapped === true ? "↻" : ""}`;
      if (!text) continue;
      sectionMapMakeEl(el.chips, "span", {
        cls: `bob-section-map-chip${chip.wrapped === true ? " is-wrap" : ""}`,
        text,
        attr: {
          "data-bob-section-map": "chip",
          "data-direction": sectionMapText(chip.direction),
        },
      });
    }
  }
}

function sectionMapPaintGapRow(el, row) {
  const count = Math.max(0, Math.floor(sectionMapNum(row.count, 0)));
  sectionMapSetText(el, `⋯ ${count} more`);
}

function sectionMapEnsureRow(parts, rowNodes, row) {
  const domKey = sectionMapRowDomKey(row);
  let el = rowNodes.get(domKey) || null;
  const isGap = row.type === "gap";
  if (!el) {
    if (isGap) {
      el = sectionMapMakeEl(parts.rows, "div", {
        cls: "bob-section-map-gap",
        attr: { "data-bob-section-map": "gap", "data-bob-section-map-key": domKey },
      });
    } else {
      el = sectionMapMakeEl(parts.rows, "div", {
        cls: "bob-section-map-row",
        attr: { "data-bob-section-map": "row", "data-bob-section-map-key": domKey },
      });
      if (el) {
        el.ring = sectionMapMakeEl(el, "span", {
          cls: "bob-section-map-ring",
          attr: { "data-bob-section-map": "ring" },
        });
        el.guides = sectionMapMakeEl(el, "span", {
          cls: "bob-section-map-guides",
          attr: { "data-bob-section-map": "guides" },
        });
        el.label = sectionMapMakeEl(el, "span", {
          cls: "bob-section-map-label",
          attr: { "data-bob-section-map": "label" },
        });
        el.chips = sectionMapMakeEl(el, "span", {
          cls: "bob-section-map-chips",
          attr: { "data-bob-section-map": "chips" },
        });
        if (el.ring && el.ring.style) el.ring.style.visibility = "hidden";
      }
    }
    if (el) rowNodes.set(domKey, el);
  }
  if (!el) return null;
  if (isGap) sectionMapPaintGapRow(el, row);
  else sectionMapPaintHeadingRow(el, row);
  return el;
}

function sectionMapPaintCompactStrip(parts, model) {
  const strip = parts.strip;
  if (!strip) return;
  sectionMapEmpty(strip);
  const previous = model && typeof model.previous === "object" ? model.previous : null;
  const next = model && typeof model.next === "object" ? model.next : null;
  const currentLabel = sectionMapText(model && model.currentLabel);
  const counter = sectionMapText(model && model.counter);
  let needsSep = false;
  function sep() {
    if (needsSep) sectionMapMakeEl(strip, "span", { cls: "bob-section-map-sep", text: "·" });
    needsSep = true;
  }
  if (previous && sectionMapText(previous.label)) {
    sep();
    sectionMapMakeEl(strip, "span", { cls: "bob-section-map-chip", text: "⌃K" });
    sectionMapMakeEl(strip, "span", { cls: "bob-section-map-compact-label", text: sectionMapText(previous.label) });
  }
  if (currentLabel) {
    sep();
    sectionMapMakeEl(strip, "span", { cls: "bob-section-map-rail", text: "┃" });
    sectionMapMakeEl(strip, "span", {
      cls: "bob-section-map-compact-label is-current",
      text: currentLabel,
    });
    if (counter) {
      sectionMapMakeEl(strip, "span", { cls: "bob-section-map-counter", text: counter });
    }
  }
  if (next && sectionMapText(next.label)) {
    sep();
    sectionMapMakeEl(strip, "span", { cls: "bob-section-map-compact-label", text: sectionMapText(next.label) });
    sectionMapMakeEl(strip, "span", { cls: "bob-section-map-chip", text: "⌃J" });
  }
}

function sectionMapPaintHeader(parts, model, state) {
  const wrap = parts.wrap;
  const wrapped = model.wrapped === true;
  if (wrap) {
    if (wrapped) {
      sectionMapSetText(wrap, "↻ wrapped");
      sectionMapRemoveClass(wrap, "is-hidden");
      if (state.lastWrapped !== true) sectionMapAddClass(wrap, "is-pop");
      else sectionMapRemoveClass(wrap, "is-pop");
    } else if (model.onlySection === true) {
      sectionMapSetText(wrap, "only section");
      sectionMapRemoveClass(wrap, "is-hidden");
      sectionMapRemoveClass(wrap, "is-pop");
    } else {
      sectionMapAddClass(wrap, "is-hidden");
      sectionMapRemoveClass(wrap, "is-pop");
    }
  }
  if (parts.countCurrent) {
    sectionMapSetText(
      parts.countCurrent,
      model.currentIndex >= 0 ? String(model.currentIndex + 1) : "–",
    );
  }
  if (parts.countTotal) sectionMapSetText(parts.countTotal, String(sectionMapNum(model.total, 0)));
}

function sectionMapPositionCard(parts, placement) {
  const card = parts.card;
  if (!card) return;
  const fallback = { left: 12, top: 12, width: SECTION_MAP_CARD_MIN_WIDTH };
  const rect = sectionMapRect(placement) || sectionMapRect({
    left: placement && placement.left != null ? placement.left : fallback.left,
    top: placement && placement.top != null ? placement.top : fallback.top,
    width: placement && placement.width != null ? placement.width : fallback.width,
    height: SECTION_MAP_ROW_HEIGHT,
  });
  const style = card.style || (card.style = {});
  style.position = "fixed";
  if (rect) {
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${Math.max(0, rect.width)}px`;
  } else {
    style.left = `${fallback.left}px`;
    style.top = `${fallback.top}px`;
    style.width = `${fallback.width}px`;
  }
  const mode = placement && (placement.mode === "margin" || placement.mode === "overlay" || placement.mode === "compact")
    ? placement.mode
    : "overlay";
  for (const name of ["is-margin", "is-overlay", "is-compact"]) {
    if (name === `is-${mode}`) sectionMapAddClass(card, name);
    else sectionMapRemoveClass(card, name);
  }
}

// The pure render core. state carries the reused DOM tree plus the last
// painted keys; it never throws and returns the (mutated) state.
function renderSectionMapCard(state, model, placement, options = {}) {
  if (!state || !state.doc) return state;
  const safe = model && typeof model === "object" ? model : null;
  const rows = safe && Array.isArray(safe.rows) ? safe.rows : [];
  const validRows = rows.filter((row) => row && (row.type === "heading" || row.type === "gap"));
  if (!safe || validRows.length === 0) {
    if (state.parts) sectionMapAddClass(state.parts.host, "is-hidden");
    state.visible = false;
    state.entered = false;
    state.painted = [];
    state.currentKey = null;
    return state;
  }
  const parts = state.parts || sectionMapEnsureParts(state);
  if (!parts) return state;
  const wasVisible = state.visible === true;
  sectionMapRemoveClass(parts.host, "is-hidden");
  const reduced = options.reducedMotion === true ||
    (options.reducedMotion !== false && sectionMapPrefersReducedMotion(state.doc));
  if (reduced) sectionMapAddClass(parts.host, "is-reduced");
  else sectionMapRemoveClass(parts.host, "is-reduced");
  sectionMapPositionCard(parts, placement);
  const compact = placement && placement.mode === "compact";
  sectionMapPaintHeader(parts, safe, state);
  const nextKeys = [];
  if (compact) {
    // The compact strip carries its own counter, so the header stays home:
    // the card is exactly one strip tall.
    sectionMapAddClass(parts.rows, "is-hidden");
    sectionMapAddClass(parts.header, "is-hidden");
    sectionMapRemoveClass(parts.strip, "is-hidden");
    sectionMapPaintCompactStrip(parts, safe);
  } else {
    sectionMapRemoveClass(parts.rows, "is-hidden");
    sectionMapRemoveClass(parts.header, "is-hidden");
    sectionMapAddClass(parts.strip, "is-hidden");
    validRows.forEach((row, index) => {
      const el = sectionMapEnsureRow(parts, state.rowNodes, row);
      if (!el) return;
      nextKeys.push(sectionMapRowDomKey(row));
      // Order in place against the next painted sibling, so the shared pill
      // node (the rows container's first child) is never moved.
      let before = null;
      for (let next = index + 1; next < validRows.length; next += 1) {
        const sibling = state.rowNodes.get(sectionMapRowDomKey(validRows[next]));
        if (sibling && sibling !== el) {
          before = sibling;
          break;
        }
      }
      if (typeof parts.rows.insertBefore === "function") {
        try {
          parts.rows.insertBefore(el, before);
        } catch (_error) {
          if (typeof parts.rows.appendChild === "function") parts.rows.appendChild(el);
        }
      } else if (typeof parts.rows.appendChild === "function") {
        parts.rows.appendChild(el);
      }
    });
    for (const key of [...state.rowNodes.keys()]) {
      if (!nextKeys.includes(key)) {
        sectionMapDetach(state.rowNodes.get(key));
        state.rowNodes.delete(key);
      }
    }
  }
  const currentRow = validRows.find((row) => row.type === "heading" && row.current === true) || null;
  const currentKey = currentRow ? sectionMapRowDomKey(currentRow) : null;
  if (parts.pill) {
    // In compact mode the strip carries its own rail, so the pill stays home.
    if (!currentKey || compact) {
      parts.pill.style.display = "none";
      state.lastTransition = "none";
    } else {
      const rowEl = state.rowNodes.get(currentKey) || null;
      parts.pill.style.display = "";
      const index = Math.max(0, nextKeys.indexOf(currentKey));
      const top = sectionMapRowTop(rowEl, compact ? 0 : index);
      const height = compact ? SECTION_MAP_ROW_HEIGHT : sectionMapRowHeight(rowEl);
      parts.pill.style.transform = `translateY(${top}px)`;
      parts.pill.style.height = `${height}px`;
      if (parts.pill.setAttribute) parts.pill.setAttribute("data-bob-section-map-line", currentKey);
      const wrapped = safe.wrapped === true;
      const oldPainted = state.painted.includes(state.currentKey);
      if (!wasVisible) {
        state.lastTransition = "enter";
        sectionMapRemoveClass(parts.card, "is-slide");
        sectionMapRemoveClass(parts.card, "is-crossfade");
      } else if (wrapped || state.currentKey == null || !oldPainted) {
        state.lastTransition = "crossfade";
        sectionMapRemoveClass(parts.card, "is-slide");
        sectionMapAddClass(parts.card, "is-crossfade");
      } else {
        state.lastTransition = "slide";
        sectionMapRemoveClass(parts.card, "is-crossfade");
        sectionMapAddClass(parts.card, "is-slide");
      }
    }
  }
  if (!wasVisible) sectionMapAddClass(parts.card, "is-entering");
  else sectionMapRemoveClass(parts.card, "is-entering");
  state.visible = true;
  state.entered = true;
  state.painted = compact ? [] : nextKeys;
  state.currentKey = currentKey;
  state.lastWrapped = safe.wrapped === true;
  return state;
}

function sectionMapEnsureParts(state) {
  const doc = state.doc;
  const body = doc.body || doc;
  const mount = state.mount && typeof state.mount.appendChild === "function" ? state.mount : body;
  const host = sectionMapMakeEl(mount, "div", {
    cls: "bob-section-map-host is-hidden",
    attr: { "data-bob-section-map": "host" },
  });
  if (!host) return null;
  const card = sectionMapMakeEl(host, "div", {
    cls: "bob-section-map is-overlay",
    attr: { "data-bob-section-map": "card" },
  });
  const header = sectionMapMakeEl(card, "div", {
    cls: "bob-section-map-header",
    attr: { "data-bob-section-map": "header" },
  });
  sectionMapMakeEl(header, "span", { cls: "bob-section-map-mark", text: "§" });
  sectionMapMakeEl(header, "span", { cls: "bob-section-map-title", text: "SECTIONS" });
  const wrap = sectionMapMakeEl(header, "span", {
    cls: "bob-section-map-wrap is-hidden",
    attr: { "data-bob-section-map": "wrap" },
  });
  const counter = sectionMapMakeEl(header, "span", {
    cls: "bob-section-map-counter",
    attr: { "data-bob-section-map": "counter" },
  });
  const countCurrent = sectionMapMakeEl(counter, "span", {
    cls: "bob-section-map-count-current",
    text: "–",
  });
  sectionMapMakeEl(counter, "span", { cls: "bob-section-map-count-sep", text: " / " });
  const countTotal = sectionMapMakeEl(counter, "span", {
    cls: "bob-section-map-count-total",
    text: "0",
  });
  const rows = sectionMapMakeEl(card, "div", {
    cls: "bob-section-map-rows",
    attr: { "data-bob-section-map": "rows", "aria-hidden": "true" },
  });
  // The pill lives inside the rows container (behind the rows) so a row's
  // offsetTop is already in the pill's coordinate space.
  const pill = sectionMapMakeEl(rows, "div", {
    cls: "bob-section-map-pill",
    attr: { "data-bob-section-map": "pill", "aria-hidden": "true" },
  });
  const strip = sectionMapMakeEl(card, "div", {
    cls: "bob-section-map-compact is-hidden",
    attr: { "data-bob-section-map": "compact", "aria-hidden": "true" },
  });
  const live = sectionMapMakeEl(card, "div", {
    cls: "bob-section-map-live",
    attr: {
      "data-bob-section-map": "live",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    },
  });
  state.parts = {
    host, card, pill, header, wrap, counter, countCurrent, countTotal, rows, strip, live,
  };
  state.rowNodes = new Map();
  return state.parts;
}

function createSectionMapHost(doc, options = {}) {
  const state = {
    doc: doc && typeof doc.createElement === "function" ? doc : doc?.ownerDocument || null,
    mount: options.mount || null,
    parts: null,
    rowNodes: new Map(),
    visible: false,
    entered: false,
    painted: [],
    currentKey: null,
    lastWrapped: false,
    lastTransition: "none",
  };
  if (state.doc && typeof state.doc.createElement !== "function" && state.doc.ownerDocument) {
    state.doc = state.doc.ownerDocument;
  }

  function wrap(fn) {
    return function sectionMapGuard(...args) {
      try {
        if (state.destroyed && fn !== destroyHost) return undefined;
        return fn(...args);
      } catch (_error) {
        return undefined;
      }
    };
  }

  function render(model, placement, renderOptions) {
    renderSectionMapCard(state, model, placement, renderOptions || {});
    return state;
  }

  function hide() {
    if (state.parts) sectionMapAddClass(state.parts.host, "is-hidden");
    state.visible = false;
    state.entered = false;
  }

  function setLiveText(text) {
    if (state.parts) sectionMapSetText(state.parts.live, text);
  }

  function isVisible() {
    return state.visible === true;
  }

  function destroyHost() {
    if (state.parts) sectionMapDetach(state.parts.host);
    state.parts = null;
    state.destroyed = true;
    state.visible = false;
    if (state.rowNodes) state.rowNodes.clear();
  }

  function setLeaving(kind) {
    if (!state.parts) return;
    if (kind === "fade" || kind === "dismiss") {
      sectionMapAddClass(state.parts.host, "is-leaving");
      if (kind === "dismiss") sectionMapAddClass(state.parts.host, "is-dismissing");
      else sectionMapRemoveClass(state.parts.host, "is-dismissing");
      return;
    }
    sectionMapRemoveClass(state.parts.host, "is-leaving");
    sectionMapRemoveClass(state.parts.host, "is-dismissing");
  }

  return {
    render: wrap(render),
    hide: wrap(hide),
    setLiveText: wrap(setLiveText),
    setLeaving: wrap(setLeaving),
    isVisible: wrap(isVisible),
    destroy: destroyHost,
  };
}
