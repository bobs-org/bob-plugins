// Pure painter for the Ctrl+W window-prefix hint. Renders only from the view
// model plus rects; no workspace access. Reuses one DOM tree, never throws.
const WINDOW_HINT_TAB_INSET = 36;
const WINDOW_HINT_RING_INSET = 4;
const WINDOW_HINT_CARD_WIDTH = 520;
const WINDOW_HINT_CARD_MARGIN = 16;
const WINDOW_HINT_MAX_COLUMNS = 4;
const WINDOW_HINT_NUDGE_MS = 160;
const WINDOW_HINT_BUMP_MS = 160;
const WINDOW_HINT_PULSE_MS = 220;
const WINDOW_HINT_RECEIPT_MS = 1600;
const WINDOW_HINT_GLYPHS = Object.freeze({
  h: "←",
  l: "→",
  w: "⇄",
  H: "←",
  L: "→",
  v: "◫",
});
const WINDOW_HINT_ICONS = Object.freeze({
  h: "arrow-left",
  l: "arrow-right",
  w: "arrow-left-right",
  H: "arrow-left",
  L: "arrow-right",
  v: "columns-2",
});
const WINDOW_HINT_FOCUS_KEYS = Object.freeze(["h", "l", "w"]);
const WINDOW_HINT_TAB_KEYS = Object.freeze(["H", "L", "v"]);
const WINDOW_HINT_TABS_ICON = "hash";
const WINDOW_HINT_TABS_FALLBACK = "#";

function windowHintText(value) {
  if (value == null) return "";
  return String(value);
}

function windowHintNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function windowHintRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const left = windowHintNum(rect.left, Number.NaN);
  const top = windowHintNum(rect.top, Number.NaN);
  const width = Number.isFinite(rect.width)
    ? windowHintNum(rect.width)
    : windowHintNum(rect.right) - left;
  const height = Number.isFinite(rect.height)
    ? windowHintNum(rect.height)
    : windowHintNum(rect.bottom) - top;
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    return null;
  }
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function windowHintEmpty(node) {
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

function windowHintDetach(node) {
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

function windowHintAddClass(node, name) {
  if (!node || !name) return;
  if (node.classList && typeof node.classList.add === "function") {
    node.classList.add(name);
    return;
  }
  const current = windowHintText(node.className);
  if (!current.split(/\s+/).includes(name)) node.className = `${current} ${name}`.trim();
}

function windowHintRemoveClass(node, name) {
  if (!node || !name) return;
  if (node.classList && typeof node.classList.remove === "function") {
    node.classList.remove(name);
    return;
  }
  const next = windowHintText(node.className)
    .split(/\s+/)
    .filter((item) => item && item !== name);
  node.className = next.join(" ");
}

function windowHintHasClass(node, name) {
  if (!node || !name) return false;
  if (node.classList && typeof node.classList.contains === "function") {
    return node.classList.contains(name);
  }
  return windowHintText(node.className).split(/\s+/).includes(name);
}

function windowHintSetText(node, text) {
  if (!node) return;
  const value = windowHintText(text);
  if (typeof node.setText === "function") node.setText(value);
  else node.textContent = value;
}

function windowHintMakeEl(parent, tag, options = {}) {
  if (parent && typeof parent.createEl === "function") {
    return parent.createEl(tag, options);
  }
  const doc = parent && (parent.ownerDocument || parent.document);
  const node = doc && typeof doc.createElement === "function"
    ? doc.createElement(tag)
    : null;
  if (!node) return null;
  if (options.cls) node.className = options.cls;
  if (options.text != null) windowHintSetText(node, options.text);
  if (options.attr && typeof options.attr === "object") {
    for (const [key, value] of Object.entries(options.attr)) {
      if (value == null) continue;
      if (typeof node.setAttribute === "function") node.setAttribute(key, String(value));
    }
  }
  if (parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function windowHintApplyRect(node, rect, inset = {}) {
  if (!node || !rect) return;
  const style = node.style || (node.style = {});
  const leftInset = windowHintNum(inset.left);
  const topInset = windowHintNum(inset.top);
  const rightInset = windowHintNum(inset.right);
  const bottomInset = windowHintNum(inset.bottom);
  style.position = "fixed";
  style.left = `${rect.left + leftInset}px`;
  style.top = `${rect.top + topInset}px`;
  style.width = `${Math.max(0, rect.width - leftInset - rightInset)}px`;
  style.height = `${Math.max(0, rect.height - topInset - bottomInset)}px`;
}

function windowHintPaintIcon(node, iconName, fallback, setIcon) {
  if (!node) return;
  windowHintEmpty(node);
  if (typeof setIcon === "function") {
    try {
      setIcon(node, iconName);
      const hasChild = (node.children && node.children.length > 0) ||
        (typeof node.childNodes !== "undefined" && node.childNodes.length > 0);
      if (hasChild || (typeof node.getAttribute === "function" && node.getAttribute("data-icon"))) {
        return;
      }
    } catch (_error) {
      windowHintEmpty(node);
    }
  }
  windowHintSetText(node, fallback);
}

function windowHintRowByKey(model, key) {
  const rows = Array.isArray(model?.rows) ? model.rows : [];
  return rows.find((row) => row && row.key === key) || null;
}

function windowHintChipLabel(consequence) {
  const text = windowHintText(consequence);
  if (!text) return "";
  if (/close/i.test(text)) return "closes split";
  return "";
}

function windowHintReasonText(row) {
  if (!row) return "";
  return windowHintText(row.preview || row.reason || "");
}

function windowHintDisplayText(row) {
  const preview = windowHintReasonText(row);
  const action = row?.plan?.action;
  const reason = windowHintText(row?.reason);
  if (row && row.available !== true) {
    if (reason === "at-left-edge" || /left edge/i.test(preview)) return "left edge";
    if (reason === "at-right-edge" || /right edge/i.test(preview)) return "right edge";
    if (reason === "only-one-split" || /^only split$/i.test(preview)) return "no other split";
    if (reason === "only-tab-in-layout" || /only tab/i.test(preview)) return "only tab · v splits";
    if (reason === "layout-api-changed" || /layout API changed/i.test(preview)) {
      return "layout API changed";
    }
    return preview;
  }
  if (action === "focus") return preview.replace(/^focus\s+/i, "");
  if (action === "create-split") return "new split";
  if (action === "duplicate") return "split right";
  return preview;
}

function windowHintIsMac(model, options, doc) {
  if (model?.platform === "mac" || options?.platform === "mac") return true;
  if (model?.platform === "other" || options?.platform === "other") return false;
  try {
    const navigator = doc?.defaultView?.navigator || (typeof globalThis !== "undefined" ? globalThis.navigator : null);
    const platform = windowHintText(navigator?.platform || navigator?.userAgent);
    return /Mac|iPhone|iPad/.test(platform);
  } catch (_error) {
    return false;
  }
}

function windowHintPrefersReducedMotion(doc) {
  try {
    const media = doc?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    return Boolean(media && media.matches);
  } catch (_error) {
    return false;
  }
}

function windowHintAreaFromModel(model) {
  const splits = Array.isArray(model?.splits) ? model.splits : [];
  const rects = splits.map((split) => windowHintRect(split.rect)).filter(Boolean);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top, right, bottom };
}

function windowHintActiveRect(model) {
  const splits = Array.isArray(model?.splits) ? model.splits : [];
  const active = splits.find((split) => split && split.active) || splits[0];
  return windowHintRect(active?.rect);
}

function windowHintClusterColumns(splits) {
  const items = (Array.isArray(splits) ? splits : [])
    .map((split, index) => ({ split, index, rect: windowHintRect(split?.rect) }))
    .filter((item) => item.split && item.rect);
  items.sort((left, right) =>
    left.rect.left - right.rect.left ||
    left.rect.top - right.rect.top ||
    left.index - right.index,
  );
  const columns = [];
  for (const item of items) {
    const column = columns.find((candidate) => {
      const overlap = Math.min(candidate.right, item.rect.right) - Math.max(candidate.left, item.rect.left);
      return overlap > 0;
    });
    if (column) {
      column.splits.push(item.split);
      column.left = Math.min(column.left, item.rect.left);
      column.right = Math.max(column.right, item.rect.right);
      column.width = Math.max(column.width, item.rect.width);
    } else {
      columns.push({
        splits: [item.split],
        left: item.rect.left,
        right: item.rect.right,
        width: item.rect.width,
      });
    }
  }
  for (const column of columns) {
    column.splits.sort((left, right) => {
      const leftTop = windowHintNum(left.rect?.top);
      const rightTop = windowHintNum(right.rect?.top);
      return leftTop - rightTop;
    });
    column.widthRatio = column.splits.reduce(
      (sum, split) => sum + windowHintNum(split.widthRatio, column.splits.length ? 1 / column.splits.length : 1),
      0,
    );
    column.active = column.splits.some((split) => split.active);
  }
  return columns;
}

function windowHintVisibleColumns(columns, activeIndex) {
  if (columns.length <= WINDOW_HINT_MAX_COLUMNS) {
    return { start: 0, end: columns.length, left: 0, right: 0 };
  }
  const active = Math.max(0, Math.min(columns.length - 1, activeIndex));
  let start = Math.max(0, active - 1);
  let end = Math.min(columns.length, active + 2);
  if (end - start < 3) {
    if (start === 0) end = Math.min(columns.length, start + 3);
    else start = Math.max(0, end - 3);
  }
  return { start, end, left: start, right: columns.length - end };
}

function windowHintCardSummary(model, tabNumbers) {
  const rows = Array.isArray(model?.rows) ? model.rows : [];
  const available = rows
    .filter((row) => row && row.available)
    .map((row) => `${row.key} ${windowHintReasonText(row)}`.trim());
  const count = windowHintNum(model?.splitCount, 0);
  const splits = count === 1 ? "1 split" : `${count} splits`;
  const parts = ["Window", splits, ...available];
  if (tabNumbers === true && model && model.tabs && Number.isFinite(model.tabs.numbered) && model.tabs.numbered >= 1) {
    const range = windowHintText(model.tabs.range);
    const spoken = range ? range.replace("–", " to ") : "";
    if (model.tabs.total === 1) parts.push("1 only tab");
    else if (spoken) parts.push(`${spoken} jump to that tab`);
  }
  parts.push("escape cancels");
  return parts.filter(Boolean).join(". ");
}

function windowHintTabsRowModel(model) {
  const tabs = model && typeof model.tabs === "object" ? model.tabs : null;
  if (!tabs) return null;
  const total = windowHintNum(tabs.total, 0);
  const numbered = windowHintNum(tabs.numbered, 0);
  const unnumbered = windowHintNum(tabs.unnumbered, 0);
  const range = windowHintText(tabs.range);
  if (total === 1) {
    return { key: "1", label: "only tab", aside: "", dimmed: true, numbersHidden: tabs.numbersHidden === true };
  }
  if (numbered < 1) {
    return { key: "", label: windowHintText(tabs.preview) || "no tabs", aside: windowHintText(tabs.aside), dimmed: true, numbersHidden: tabs.numbersHidden === true };
  }
  return {
    key: range || `1–${numbered}`,
    label: "jump to that tab",
    aside: unnumbered > 0 ? `${unnumbered} more unnumbered` : windowHintText(tabs.aside) === "only tab" ? "" : "it stays in its split",
    dimmed: false,
    numbersHidden: tabs.numbersHidden === true,
  };
}

function windowHintSchedule(store, key, callback, delay) {
  const timers = store.timers;
  if (timers[key] != null && typeof store.clearTimeout === "function") {
    store.clearTimeout(timers[key]);
    timers[key] = null;
  }
  if (typeof store.setTimeout !== "function") {
    callback();
    return;
  }
  timers[key] = store.setTimeout(() => {
    timers[key] = null;
    callback();
  }, delay);
}

function createWindowHintHost(doc, options = {}) {
  const setIcon = typeof options.setIcon === "function" ? options.setIcon : null;
  const documentRef = doc && typeof doc.createElement === "function" ? doc : doc?.ownerDocument;
  const body = documentRef?.body || doc;
  const view = documentRef?.defaultView;
  const setTimeoutFn = typeof options.setTimeout === "function"
    ? options.setTimeout
    : typeof view?.setTimeout === "function"
      ? view.setTimeout.bind(view)
      : typeof setTimeout === "function" ? setTimeout : null;
  const clearTimeoutFn = typeof options.clearTimeout === "function"
    ? options.clearTimeout
    : typeof view?.clearTimeout === "function"
      ? view.clearTimeout.bind(view)
      : typeof clearTimeout === "function" ? clearTimeout : null;
  const tabNumbers = options.tabNumbers === true;
  const state = {
    destroyed: false,
    parts: null,
    lastModel: null,
    lastRingRect: null,
    lastAreaRect: null,
    timers: Object.create(null),
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    tabNumbers,
  };

  function reduced() {
    if (options.reducedMotion === true) return true;
    if (options.reducedMotion === false) return false;
    return windowHintPrefersReducedMotion(documentRef);
  }

  function clearTimers() {
    if (typeof state.clearTimeout !== "function") return;
    for (const key of Object.keys(state.timers)) {
      if (state.timers[key] != null) state.clearTimeout(state.timers[key]);
      state.timers[key] = null;
    }
  }

  function ensure() {
    if (state.destroyed || !body) return null;
    if (state.parts) return state.parts;
    const host = windowHintMakeEl(body, "div", {
      cls: "bob-wp-host is-hidden",
      attr: { "data-bob-wp": "host" },
    });
    if (!host) return null;
    const ring = windowHintMakeEl(host, "div", {
      cls: "bob-wp-ring",
      attr: { "data-bob-wp": "ring", "aria-hidden": "true" },
    });
    const badge = windowHintMakeEl(ring, "span", {
      cls: "bob-key-card-key bob-wp-badge",
      attr: { "data-bob-wp": "badge" },
    });
    const card = windowHintMakeEl(host, "div", {
      cls: "bob-wp-card",
      attr: {
        "data-bob-wp": "card",
        role: "status",
      },
    });
    const header = windowHintMakeEl(card, "div", { cls: "bob-wp-header" });
    const headerKey = windowHintMakeEl(header, "span", {
      cls: "bob-key-card-key bob-wp-header-key",
      attr: { "data-bob-wp": "header-key" },
    });
    const title = windowHintMakeEl(header, "span", {
      cls: "bob-wp-title bob-key-card-title",
      text: "Window",
    });
    const splitCount = windowHintMakeEl(header, "span", {
      cls: "bob-wp-split-count",
      attr: { "data-bob-wp": "split-count" },
    });
    const esc = windowHintMakeEl(header, "span", {
      cls: "bob-key-card-key bob-wp-esc",
      text: "esc",
      attr: { "data-bob-wp": "esc" },
    });
    const minimap = windowHintMakeEl(card, "div", {
      cls: "bob-wp-minimap",
      attr: { "data-bob-wp": "minimap" },
    });
    const grid = windowHintMakeEl(card, "div", {
      cls: "bob-wp-grid",
      attr: { "data-bob-wp": "grid" },
    });
    const footer = windowHintMakeEl(card, "div", { cls: "bob-wp-footer" });
    const cancel = windowHintMakeEl(footer, "span", {
      cls: "bob-wp-cancel",
      text: "esc · q cancel",
    });
    const live = windowHintMakeEl(footer, "span", {
      cls: "bob-wp-message",
      attr: { "data-bob-wp": "message", "aria-live": "polite" },
    });
    const receipt = windowHintMakeEl(footer, "span", {
      cls: "bob-wp-receipt",
      attr: { "data-bob-wp": "receipt", "aria-live": "polite" },
    });
    state.parts = {
      host, ring, badge, card, header, headerKey, title, splitCount, esc,
      minimap, grid, tabsRow: null, footer, cancel, live, receipt, rows: Object.create(null),
    };
    return state.parts;
  }

  function paintBadge(model) {
    const parts = state.parts;
    if (!parts) return;
    const mac = windowHintIsMac(model, options, documentRef);
    windowHintSetText(parts.badge, mac ? "⌃W" : "Ctrl W");
    windowHintSetText(parts.headerKey, mac ? "⌃W" : "Ctrl W");
  }

  function positionCard(model, areaRect) {
    const parts = state.parts;
    if (!parts) return;
    const area = windowHintRect(areaRect) || windowHintAreaFromModel(model);
    if (!area) return;
    const width = Math.min(WINDOW_HINT_CARD_WIDTH, Math.max(160, area.width - 32));
    const left = area.left + (area.width - width) / 2;
    const style = parts.card.style || (parts.card.style = {});
    style.position = "fixed";
    style.left = `${Math.max(area.left + 8, left)}px`;
    style.width = `${width}px`;
    style.maxWidth = `min(${WINDOW_HINT_CARD_WIDTH}px, ${Math.max(0, area.width - 32)}px)`;
    if (width < 460) windowHintAddClass(parts.card, "is-narrow");
    else windowHintRemoveClass(parts.card, "is-narrow");
    const viewportH = windowHintNum(
      documentRef?.documentElement?.clientHeight ?? documentRef?.defaultView?.innerHeight,
    );
    if (viewportH > 0) {
      style.bottom = `${Math.max(8, viewportH - area.bottom + WINDOW_HINT_CARD_MARGIN)}px`;
      style.top = "auto";
    } else {
      style.bottom = `${WINDOW_HINT_CARD_MARGIN}px`;
      style.top = "auto";
    }
  }

  function paintMinimap(model) {
    const parts = state.parts;
    if (!parts) return;
    windowHintEmpty(parts.minimap);
    const splits = Array.isArray(model?.splits) ? model.splits : [];
    const columns = windowHintClusterColumns(splits);
    const activeIndex = Math.max(0, columns.findIndex((column) => column.active));
    const windowRange = windowHintVisibleColumns(columns, activeIndex);
    const focusLeft = windowHintRowByKey(model, "h");
    const focusRight = windowHintRowByKey(model, "l");
    const moveLeft = windowHintRowByKey(model, "H");
    const moveRight = windowHintRowByKey(model, "L");
    if (windowRange.left > 0) {
      windowHintMakeEl(parts.minimap, "div", {
        cls: "bob-wp-overflow is-left",
        text: `+${windowRange.left}`,
        attr: { "data-bob-wp": "overflow-left" },
      });
    }
    if (moveLeft?.plan?.action === "create-split") {
      windowHintMakeEl(parts.minimap, "div", {
        cls: "bob-wp-ghost",
        text: "H",
        attr: { "data-bob-wp": "ghost", "data-bob-wp-ghost": "H" },
      });
    }
    for (let index = windowRange.start; index < windowRange.end; index += 1) {
      const column = columns[index];
      const columnEl = windowHintMakeEl(parts.minimap, "div", {
        cls: `bob-wp-column${column.active ? " is-active" : ""}`,
        attr: { "data-bob-wp": "column" },
      });
      if (columnEl && columnEl.style) {
        columnEl.style.flexGrow = String(Math.max(0.35, column.widthRatio * 10));
        columnEl.style.flexBasis = "56px";
      }
      for (const split of column.splits) {
        const pill = windowHintMakeEl(columnEl, "div", {
          cls: `bob-wp-pill${split.active ? " is-active" : ""}`,
          attr: {
            "data-bob-wp": "pill",
            "data-bob-wp-split": windowHintText(split.id),
          },
        });
        windowHintMakeEl(pill, "span", {
          cls: "bob-wp-pill-title",
          text: windowHintText(split.label || "empty tab"),
        });
        if (state.tabNumbers && split.tabRange) {
          const range = split.tabRange;
          const countEl = windowHintMakeEl(pill, "span", {
            cls: "bob-wp-pill-count is-range",
            attr: {
              "data-bob-wp": "pill-range",
              "aria-label": windowHintText(range.ariaLabel || range.label || ""),
            },
          });
          const main = range.first != null && range.last != null
            ? (range.first === range.last ? String(range.first) : `${range.first}–${range.last}`)
            : "";
          if (main) {
            windowHintMakeEl(countEl, "span", {
              cls: "bob-wp-pill-range",
              text: main,
            });
          }
          if (windowHintNum(range.unnumbered, 0) > 0) {
            windowHintMakeEl(countEl, "span", {
              cls: "bob-wp-pill-extra",
              text: `${main ? " " : ""}+${windowHintNum(range.unnumbered, 0)}`,
            });
          }
          if (!main && windowHintNum(range.unnumbered, 0) <= 0) {
            windowHintSetText(countEl, windowHintText(range.label || String(windowHintNum(split.tabCount, 1))));
          }
        } else {
          const count = windowHintNum(split.tabCount, 1);
          windowHintMakeEl(pill, "span", {
            cls: "bob-wp-pill-count",
            text: String(count),
          });
        }
        const targetId = windowHintText(split.id);
        if (focusLeft?.available && windowHintText(focusLeft.plan?.targetSplitId) === targetId) {
          windowHintMakeEl(pill, "span", {
            cls: "bob-key-card-key bob-wp-pill-key",
            text: "h",
            attr: { "data-bob-wp": "pill-key" },
          });
        } else if (focusRight?.available && windowHintText(focusRight.plan?.targetSplitId) === targetId) {
          windowHintMakeEl(pill, "span", {
            cls: "bob-key-card-key bob-wp-pill-key",
            text: "l",
            attr: { "data-bob-wp": "pill-key" },
          });
        }
      }
    }
    if (moveRight?.plan?.action === "create-split") {
      windowHintMakeEl(parts.minimap, "div", {
        cls: "bob-wp-ghost",
        text: "L",
        attr: { "data-bob-wp": "ghost", "data-bob-wp-ghost": "L" },
      });
    }
    if (windowRange.right > 0) {
      windowHintMakeEl(parts.minimap, "div", {
        cls: "bob-wp-overflow is-right",
        text: `+${windowRange.right}`,
        attr: { "data-bob-wp": "overflow-right" },
      });
    }
  }

  function paintRow(parent, row) {
    if (!parent || !row) return null;
    const unavailable = row.available !== true;
    const rowEl = windowHintMakeEl(parent, "div", {
      cls: `bob-wp-row${unavailable ? " is-unavailable" : ""}`,
      attr: { "data-bob-wp": "row", "data-bob-wp-key": windowHintText(row.key) },
    });
    windowHintMakeEl(rowEl, "span", {
      cls: "bob-key-card-key bob-wp-row-key",
      text: windowHintText(row.key),
    });
    const glyph = windowHintMakeEl(rowEl, "span", {
      cls: "bob-wp-glyph",
      attr: { "data-bob-wp": "glyph" },
    });
    const fallback = WINDOW_HINT_GLYPHS[row.key] || "";
    const iconName = WINDOW_HINT_ICONS[row.key];
    if (iconName) windowHintPaintIcon(glyph, iconName, fallback, setIcon);
    else windowHintSetText(glyph, fallback);
    const target = windowHintMakeEl(rowEl, "span", {
      cls: unavailable ? "bob-wp-reason" : "bob-wp-target",
      text: windowHintDisplayText(row),
    });
    const chip = windowHintChipLabel(row.consequence);
    if (chip && !unavailable) {
      windowHintMakeEl(rowEl, "span", {
        cls: "bob-wp-chip",
        text: chip,
        attr: { "data-bob-wp": "chip" },
      });
    }
    if (unavailable) windowHintAddClass(target, "is-reason");
    state.parts.rows[row.key] = rowEl;
    return rowEl;
  }

  function paintGrid(model) {
    const parts = state.parts;
    if (!parts) return;
    windowHintEmpty(parts.grid);
    parts.rows = Object.create(null);
    windowHintMakeEl(parts.grid, "div", {
      cls: "bob-wp-col-header",
      text: "Focus",
      attr: { "data-bob-wp": "col-focus" },
    });
    windowHintMakeEl(parts.grid, "div", {
      cls: "bob-wp-col-header",
      text: "Tab",
      attr: { "data-bob-wp": "col-tab" },
    });
    for (let index = 0; index < WINDOW_HINT_FOCUS_KEYS.length; index += 1) {
      paintRow(parts.grid, windowHintRowByKey(model, WINDOW_HINT_FOCUS_KEYS[index]));
      paintRow(parts.grid, windowHintRowByKey(model, WINDOW_HINT_TAB_KEYS[index]));
    }
  }

  function paintTabsRow(model) {
    const parts = state.parts;
    if (!parts) return;
    if (parts.tabsRow) {
      windowHintDetach(parts.tabsRow);
      parts.tabsRow = null;
    }
    if (state.tabNumbers !== true) return;
    const row = windowHintTabsRowModel(model);
    if (!row) return;
    const card = parts.card;
    const footer = parts.footer;
    const rowEl = windowHintMakeEl(card, "div", {
      cls: `bob-wp-tabs-row${row.dimmed ? " is-dimmed" : ""}`,
      attr: { "data-bob-wp": "tabs-row" },
    });
    if (footer && typeof card.appendChild === "function" && rowEl) {
      try {
        if (rowEl.parentNode === card && footer.parentNode === card) {
          card.removeChild(rowEl);
          card.insertBefore(rowEl, footer);
        } else if (rowEl.parent && Array.isArray(rowEl.parent.children)) {
          rowEl.parent.children = rowEl.parent.children.filter((child) => child !== rowEl);
          const siblings = card.children || [];
          const at = siblings.indexOf(footer);
          if (at >= 0) siblings.splice(at, 0, rowEl);
          else siblings.push(rowEl);
          rowEl.parent = card;
        } else if (typeof card.insertBefore === "function") {
          card.insertBefore(rowEl, footer);
        }
      } catch (_error) {
        // Order repair is best-effort; the row still renders.
      }
    }
    if (row.key) {
      windowHintMakeEl(rowEl, "span", {
        cls: "bob-key-card-key bob-wp-tabs-key",
        text: row.key,
        attr: { "data-bob-wp": "tabs-key" },
      });
    }
    const glyph = windowHintMakeEl(rowEl, "span", {
      cls: "bob-wp-glyph bob-wp-tabs-glyph",
      attr: { "data-bob-wp": "tabs-glyph" },
    });
    windowHintPaintIcon(glyph, WINDOW_HINT_TABS_ICON, WINDOW_HINT_TABS_FALLBACK, setIcon);
    windowHintMakeEl(rowEl, "span", {
      cls: "bob-wp-tabs-label",
      text: row.label,
      attr: { "data-bob-wp": "tabs-label" },
    });
    const asideParts = [];
    if (row.aside) asideParts.push(row.aside);
    if (row.numbersHidden) asideParts.push("numbers hidden");
    if (asideParts.length) {
      windowHintMakeEl(rowEl, "span", {
        cls: "bob-wp-tabs-aside",
        text: asideParts.join(" · "),
        attr: { "data-bob-wp": "tabs-aside" },
      });
    }
    parts.tabsRow = rowEl;
  }

  function paintCard(model) {
    const parts = ensure();
    if (!parts || !model) return;
    const count = windowHintNum(model.splitCount, Array.isArray(model.splits) ? model.splits.length : 0);
    windowHintSetText(parts.splitCount, count === 1 ? "1 split" : `${count} splits`);
    paintBadge(model);
    paintMinimap(model);
    paintGrid(model);
    paintTabsRow(model);
    if (typeof parts.card.setAttribute === "function") {
      parts.card.setAttribute("aria-label", windowHintCardSummary(model, state.tabNumbers));
    }
  }

  function showHost(kind) {
    const parts = ensure();
    if (!parts) return null;
    windowHintRemoveClass(parts.host, "is-hidden");
    windowHintRemoveClass(parts.host, "is-leaving");
    if (reduced()) windowHintAddClass(parts.host, "is-reduced");
    else windowHintRemoveClass(parts.host, "is-reduced");
    if (kind === "armed" || kind === "card") windowHintAddClass(parts.host, "is-armed");
    if (kind === "card") windowHintAddClass(parts.host, "is-carded");
    return parts;
  }

  function showArmed(model, ringRect, areaRect) {
    const parts = showHost("armed");
    if (!parts) return;
    state.lastModel = model || state.lastModel;
    state.lastRingRect = windowHintRect(ringRect) || windowHintActiveRect(model) || state.lastRingRect;
    state.lastAreaRect = windowHintRect(areaRect) || windowHintAreaFromModel(model) || state.lastAreaRect;
    if (state.lastRingRect) {
      windowHintApplyRect(parts.ring, state.lastRingRect, {
        top: WINDOW_HINT_TAB_INSET,
        left: WINDOW_HINT_RING_INSET,
        right: WINDOW_HINT_RING_INSET,
        bottom: WINDOW_HINT_RING_INSET,
      });
    }
    paintBadge(state.lastModel);
    if (state.lastModel) {
      const count = windowHintNum(state.lastModel.splitCount, 0);
      windowHintSetText(parts.splitCount, count === 1 ? "1 split" : `${count} splits`);
    }
  }

  function showCard(model) {
    const next = model || state.lastModel;
    const parts = showHost("card");
    if (!parts) return;
    state.lastModel = next;
    paintCard(next);
    positionCard(next, state.lastAreaRect || windowHintAreaFromModel(next));
  }

  function nudge(key, message) {
    const parts = ensure();
    if (!parts) return;
    const text = windowHintText(message);
    windowHintSetText(parts.live, text);
    const normalized = windowHintText(key);
    if (state.tabNumbers === true && (normalized === "tabs" || /^[1-9]$/.test(normalized))) {
      if (parts.tabsRow) {
        windowHintAddClass(parts.tabsRow, "is-nudge");
        windowHintSchedule(state, "nudge", () => windowHintRemoveClass(parts.tabsRow, "is-nudge"), WINDOW_HINT_NUDGE_MS);
      }
      return;
    }
    const row = parts.rows[key] || parts.rows[normalized];
    if (row) {
      windowHintAddClass(row, "is-nudge");
      windowHintSchedule(state, "nudge", () => windowHintRemoveClass(row, "is-nudge"), WINDOW_HINT_NUDGE_MS);
    }
  }

  function bump(side) {
    const parts = ensure();
    if (!parts) return;
    const token = side === "right" ? "is-bump-right" : "is-bump-left";
    windowHintRemoveClass(parts.ring, "is-bump-left");
    windowHintRemoveClass(parts.ring, "is-bump-right");
    windowHintAddClass(parts.ring, token);
    windowHintSchedule(state, "bump", () => {
      windowHintRemoveClass(parts.ring, "is-bump-left");
      windowHintRemoveClass(parts.ring, "is-bump-right");
    }, WINDOW_HINT_BUMP_MS);
  }

  function pulse(rect) {
    const parts = ensure();
    if (!parts) return;
    const next = windowHintRect(rect) || state.lastRingRect;
    if (next) {
      state.lastRingRect = next;
      windowHintApplyRect(parts.ring, next, {
        top: WINDOW_HINT_TAB_INSET,
        left: WINDOW_HINT_RING_INSET,
        right: WINDOW_HINT_RING_INSET,
        bottom: WINDOW_HINT_RING_INSET,
      });
    }
    windowHintAddClass(parts.ring, "is-pulse");
    windowHintSchedule(state, "pulse", () => windowHintRemoveClass(parts.ring, "is-pulse"), WINDOW_HINT_PULSE_MS);
  }

  function receipt(text) {
    const parts = ensure();
    if (!parts) return;
    windowHintSetText(parts.receipt, text);
    windowHintSchedule(state, "receipt", () => windowHintSetText(parts.receipt, ""), WINDOW_HINT_RECEIPT_MS);
  }

  function message(text) {
    const parts = ensure();
    if (!parts) return;
    windowHintSetText(parts.live, text);
  }

  function hide() {
    const parts = state.parts;
    if (!parts) return;
    clearTimers();
    windowHintRemoveClass(parts.host, "is-armed");
    windowHintRemoveClass(parts.host, "is-carded");
    windowHintRemoveClass(parts.ring, "is-pulse");
    windowHintRemoveClass(parts.ring, "is-bump-left");
    windowHintRemoveClass(parts.ring, "is-bump-right");
    windowHintSetText(parts.live, "");
    windowHintSetText(parts.receipt, "");
    windowHintAddClass(parts.host, "is-hidden");
  }

  function destroy() {
    if (state.destroyed) return;
    clearTimers();
    windowHintDetach(state.parts?.host);
    state.parts = null;
    state.destroyed = true;
  }

  function wrap(fn) {
    return function windowHintGuard(...args) {
      try {
        if (state.destroyed && fn !== destroy) return undefined;
        return fn(...args);
      } catch (_error) {
        return undefined;
      }
    };
  }

  return {
    showArmed: wrap(showArmed),
    showCard: wrap(showCard),
    nudge: wrap(nudge),
    bump: wrap(bump),
    pulse: wrap(pulse),
    receipt: wrap(receipt),
    message: wrap(message),
    hide: wrap(hide),
    destroy: wrap(destroy),
  };
}
