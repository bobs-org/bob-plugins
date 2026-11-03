// Week parts-row renderer: seven day columns bottom-aligned on a hairline,
// each stacking root-parent minutes in lane order with 1 px note-background
// gaps, plus captions, closeout marks, and roving-tabindex keyboard. Hues come
// from the model so lanes and columns share one assignment per strip.
function periodStripPartsActivate(node, action) {
  if (!node || typeof action !== "function" || typeof node.addEventListener !== "function") return;
  const invoke = (event, forcedNewLeaf, alt) => {
    if (event && event.preventDefault && event.type === "mousedown") event.preventDefault();
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    const useAlt = alt || Boolean(event && event.altKey);
    action(newLeaf, useAlt);
  };
  node.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", (event) => invoke(event, false, false));
  node.addEventListener("auxclick", (event) => {
    if (event && event.button === 1) {
      if (event.preventDefault) event.preventDefault();
      invoke(event, true, false);
    }
  });
  node.addEventListener("keydown", (event) => {
    if (!event) return;
    if (event.key === "Enter" && event.altKey) {
      if (event.preventDefault) event.preventDefault();
      invoke(event, false, true);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.preventDefault) event.preventDefault();
    invoke(event, false, false);
  });
}

function periodStripCloseoutGlyph(mark) {
  if (mark === "met") return "✓";
  if (mark === "missed") return "✕";
  if (mark === "open") return "◐";
  if (mark === "reflected") return "✓";
  if (mark === "drafted" || mark === "edited") return "·";
  return "";
}

function periodStripColumnBar(doc, column, tallest) {
  const bar = statsEl(doc, "span", { class: "bob-period-strip-column-bar", "aria-hidden": "true" });
  if (!bar) return null;
  if (column.missing || column.state === "future" || !column.worked || typeof column.worked.value !== "number" || tallest <= 0) {
    return bar;
  }
  const total = column.worked.value;
  for (const entry of column.stack) {
    const height = total > 0 ? (entry.minutes / tallest) * 100 : 0;
    const piece = statsEl(doc, "span", {
      class: "bob-period-strip-column-piece bob-day-strip-hue-" + (entry.hue || "gray"),
      "data-key": entry.key,
    });
    if (piece && piece.style) {
      try {
        piece.style.height = String(Math.max(0, height)) + "%";
      } catch (error) {
        // Height is best-effort.
      }
    }
    if (bar.appendChild && piece) bar.appendChild(piece);
  }
  return bar;
}

// One column: a roving-tabindex link with the bar, closeout mark, caption,
// and value. Future columns are dashed outline ghosts, missing columns are
// hatched ghosts, and the current column carries a dashed full-height outline
// with `so far` in its caption. Never a <button>. Never throws.
function periodStripRenderColumn(doc, column, index, model, handlers) {
  const state = column.state || "closed";
  const label = (column.label || column.id || "Day") + " · Worked " + ((column.worked && column.worked.display) || "–") + (state === "current" ? " so far" : "");
  const node = statsEl(doc, "span", {
    class: "bob-period-strip-column"
      + (column.missing ? " bob-period-strip-column-missing" : "")
      + (state === "future" ? " bob-period-strip-column-future" : "")
      + (state === "current" ? " bob-period-strip-column-current" : ""),
    role: "link",
    tabindex: index === 0 ? "0" : "-1",
    title: column.tooltip || null,
    "aria-label": label,
    "data-period-strip-column": column.id || "",
    "data-column-state": state,
  });
  if (!node) return null;
  if (column.tick) {
    const tick = statsEl(doc, "span", { class: "bob-period-strip-column-tick", "aria-hidden": "true" });
    if (tick) {
      tick.appendChild(statsEl(doc, "span", { class: "bob-period-strip-column-tick-rule" }));
      tick.appendChild(statsEl(doc, "span", {}, column.tick));
      node.appendChild(tick);
    }
  }
  const bar = periodStripColumnBar(doc, column, periodStripTallest(model));
  if (bar && node.appendChild) node.appendChild(bar);
  const glyph = periodStripCloseoutGlyph(column.mark);
  const markText = state === "future" ? "" : glyph;
  const mark = statsEl(doc, "span", {
    class: "bob-period-strip-column-mark" + (column.mark === "drafted" || column.mark === "edited" ? " bob-period-strip-column-mark-draft" : ""),
    "data-mark": column.mark || "none",
    "aria-hidden": "true",
  }, markText);
  if (mark && node.appendChild) node.appendChild(mark);
  const caption = statsEl(doc, "span", { class: "bob-period-strip-column-caption" },
    (column.caption || "") + (state === "current" ? " · so far" : "") + (column.partial ? " · " + column.partial : ""));
  if (caption && node.appendChild) node.appendChild(caption);
  const value = statsEl(doc, "span", { class: "bob-period-strip-column-value" },
    (column.worked && column.worked.display) || (state === "future" ? "" : "–"));
  if (value && node.appendChild) node.appendChild(value);
  periodStripPartsActivate(node, (newLeaf, alt) => {
    if (alt) {
      if (handlers && typeof handlers.openStatsForColumn === "function") handlers.openStatsForColumn(column, newLeaf);
      return;
    }
    if (handlers && typeof handlers.openColumn === "function") handlers.openColumn(column, newLeaf);
  });
  return node;
}

function periodStripTallest(model) {
  try {
    let tallest = 0;
    for (const column of (model && model.columns) || []) {
      const value = column && column.worked && typeof column.worked.value === "number" ? column.worked.value : 0;
      if (value > tallest) tallest = value;
    }
    return tallest;
  } catch (error) {
    return 0;
  }
}

// The week parts row: one roving-tabindex group. ←/→ move, Home/End jump,
// Enter opens the day note, Alt+Enter opens Stats pinned to that day. Never
// throws.
function periodStripRenderWeekRow(doc, model, handlers) {
  const row = statsEl(doc, "span", {
    class: "bob-period-strip-parts",
    role: "group",
    "aria-label": "Days of " + ((model && model.periodId) || "week"),
    "data-period-parts": "week",
  });
  if (!row) return null;
  const columns = (model && Array.isArray(model.columns) ? model.columns : []).filter(Boolean);
  const rendered = [];
  columns.forEach((column, index) => {
    const node = periodStripRenderColumn(doc, column, index, model, handlers);
    if (node && row.appendChild) {
      row.appendChild(node);
      rendered.push(node);
    }
  });
  if (row.addEventListener) {
    row.addEventListener("keydown", (event) => {
      try {
        if (!event || !event.target) return;
        const current = rendered.indexOf(event.target);
        if (current < 0) return;
        let next = -1;
        if (event.key === "ArrowRight") next = Math.min(rendered.length - 1, current + 1);
        else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = rendered.length - 1;
        else return;
        if (event.preventDefault) event.preventDefault();
        for (const node of rendered) {
          try {
            if (node.setAttribute) node.setAttribute("tabindex", "-1");
          } catch (error) {
            // Tabindex reset is best-effort.
          }
        }
        const target = rendered[next];
        try {
          if (target.setAttribute) target.setAttribute("tabindex", "0");
          if (target.focus) target.focus();
        } catch (error) {
          // Focus is best-effort.
        }
      } catch (error) {
        // Roving is best-effort.
      }
    });
  }
  return row;
}

function periodStripGroupedColumns(columns, groups) {
  const grouped = new Map();
  for (const column of columns || []) {
    const key = column && column.group !== null && column.group !== undefined ? String(column.group) : "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(column);
  }
  if (!grouped.has("")) return Array.from(grouped.entries());
  return Array.from(grouped.entries());
}

function periodStripGroupCaption(group, groups, kind) {
  const key = String(group || "");
  const found = (groups || []).find((row) => row && String(row.key) === key);
  if (kind === "year" || kind === "all") {
    const label = found && typeof found.label === "string" ? found.label : key;
    const worked = found && typeof found.worked_display === "string" ? found.worked_display : "";
    return label + (worked && worked !== "–" ? " · " + worked : "");
  }
  return key;
}

// Quarter/year/all-time share one row painter. Group labels come directly
// from bob's `groups`; columns only scale their supplied root-parent stacks.
function periodStripRenderGroupedRow(doc, model, handlers, opts) {
  const options = opts || {};
  const kind = options.kind || model.kind;
  const row = statsEl(doc, "span", {
    class: "bob-period-strip-parts bob-period-strip-parts-" + kind + (options.fallback ? " bob-period-strip-parts-fallback" : " bob-period-strip-parts-detailed"),
    role: "group",
    "aria-label": (kind === "quarter" ? "Weeks of " : kind === "year" ? "Weeks of " : "Quarters of ") + ((model && model.periodId) || "period"),
    "data-period-parts": kind,
  });
  if (!row) return null;
  const columns = Array.isArray(options.columns) ? options.columns : (Array.isArray(model.columns) ? model.columns : []);
  const layoutModel = options.columns ? { ...model, columns } : model;
  const groups = periodStripGroupedColumns(columns, model.groups);
  let tabIndex = 0;
  const rendered = [];
  for (const [key, groupColumns] of groups) {
    const isGrouped = Boolean(key) && (kind === "year" || kind === "all");
    const group = isGrouped ? statsEl(doc, "span", { class: "bob-period-strip-column-group", "data-group": key }) : row;
    if (!group) continue;
    const columnWrap = isGrouped ? statsEl(doc, "span", { class: "bob-period-strip-column-group-columns" }) : group;
    if (!columnWrap) continue;
    for (const column of groupColumns) {
      const node = periodStripRenderColumn(doc, column, tabIndex++, layoutModel, handlers);
      if (!node) continue;
      if (columnWrap.appendChild) columnWrap.appendChild(node);
      rendered.push(node);
    }
    if (isGrouped) {
      group.appendChild(columnWrap);
      const caption = periodStripGroupCaption(key, model.groups, kind);
      const groupLabel = statsEl(doc, "span", { class: "bob-period-strip-group-caption" }, caption);
      if (groupLabel && group.appendChild) group.appendChild(groupLabel);
      if (row.appendChild) row.appendChild(group);
    }
  }
  if (row.addEventListener) {
    row.addEventListener("keydown", (event) => {
      try {
        if (!event || !event.target) return;
        const current = rendered.indexOf(event.target);
        if (current < 0) return;
        let next = -1;
        if (event.key === "ArrowRight") next = Math.min(rendered.length - 1, current + 1);
        else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = rendered.length - 1;
        else return;
        if (event.preventDefault) event.preventDefault();
        for (const node of rendered) if (node.setAttribute) node.setAttribute("tabindex", "-1");
        const target = rendered[next];
        if (target && target.setAttribute) target.setAttribute("tabindex", "0");
        if (target && target.focus) target.focus();
      } catch (error) {
        // Roving is best-effort.
      }
    });
  }
  return row;
}

function paintPeriodStripParts(doc, host, model, handlers) {
  try {
    if (!host || !model) return null;
    if (model.kind === "week") {
      const row = periodStripRenderWeekRow(doc, model, handlers || {});
      if (!row) return null;
      if (typeof host.appendChild === "function") host.appendChild(row);
      return row;
    }
    const frame = statsEl(doc, "div", { class: "bob-period-strip-parts-frame" });
    if (!frame || typeof host.appendChild !== "function") return null;
    host.appendChild(frame);
    const row = periodStripRenderGroupedRow(doc, model, handlers || {}, { kind: model.kind });
    if (row) frame.appendChild(row);
    if (model.kind === "year" && Array.isArray(model.quarterFallbackColumns) && model.quarterFallbackColumns.length) {
      const fallback = periodStripRenderGroupedRow(doc, model, handlers || {}, { kind: "year", columns: model.quarterFallbackColumns, fallback: true });
      if (fallback) frame.appendChild(fallback);
    }
    return row;
  } catch (error) {
    return null;
  }
}

function periodPartsTableMiniBar(doc, row, tallest) {
  const bar = statsEl(doc, "span", { class: "bob-period-parts-mini-bar", "aria-hidden": "true" });
  if (!bar || !row || !row.worked || !Array.isArray(row.stack) || tallest <= 0 || !(row.worked.value > 0)) return bar;
  if (bar.style) bar.style.width = String(Math.max(0, Math.min(100, row.worked.value / tallest * 100))) + "%";
  for (const entry of row.stack) {
    const piece = statsEl(doc, "span", { class: "bob-period-strip-column-piece bob-day-strip-hue-" + (entry.hue || "gray"), "data-key": entry.key });
    if (piece && piece.style && row.worked.value > 0) {
      piece.style.flex = "0 0 " + String(Math.max(0, entry.minutes / row.worked.value * 100)) + "%";
      piece.style.height = "3px";
    }
    if (piece && bar.appendChild) bar.appendChild(piece);
  }
  return bar;
}

function periodPartsReviewText(row) {
  if (row.kind === "day") return periodStripCloseoutGlyph(row.closeout) || "–";
  const state = row.review && typeof row.review.state === "string" ? row.review.state : "";
  if (state === "reflected") return "✓ reflected";
  if (state === "drafted") return "drafted";
  if (state === "edited") return "edited";
  return "–";
}

function periodPartsIsNotTracked(row) {
  return Boolean(row && row.state !== "future" && row.worked && row.worked.quality === "not_tracked");
}

function periodPartsChildLink(doc, row, model, handlers) {
  const isPreAdoptionYear = model.kind === "all" && row.kind === "year" && !row.exists;
  if (!row.path || isPreAdoptionYear) return statsEl(doc, "span", { class: "bob-period-parts-child-label" }, row.label || row.id);
  const target = row.path.replace(/\.md$/, "");
  const link = statsEl(doc, "a", {
    class: "internal-link bob-period-parts-child-link",
    href: target,
    "data-href": target,
    "aria-label": (row.label || row.id) + (row.rangeLabel ? ", " + row.rangeLabel : ""),
  }, row.label || row.id);
  if (link && row.path) {
    try { link.setAttribute("data-tooltip-position", "top"); } catch (error) { /* best-effort */ }
  }
  void handlers;
  return link;
}

// Paint bob-period-parts as a semantic, live table. It uses bob's report strings
// and the same hue catalog as the strip; future rows intentionally stop after
// Child and Dates.
function paintPeriodPartsTable(host, model) {
  try {
    if (!host || !model) return null;
    const doc = host.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const root = statsEl(doc, "div", { class: "bob-period-parts-table-host" });
    if (!root) return null;
    host.appendChild(root);
    if (model.state === "unavailable" || model.state === "older-bob") {
      root.appendChild(statsEl(doc, "div", { class: "bob-period-parts-note" }, model.state === "older-bob" ? "Period parts need a newer bob." : "Period parts unavailable — " + ((model.error && model.error.title) || "bob periods failed") + "."));
      return root;
    }
    if (model.stale) root.appendChild(statsEl(doc, "div", { class: "bob-period-parts-note", title: model.staleTitle || "Refresh failed" }, "refresh failed"));
    if (model.state === "skeleton") root.appendChild(statsEl(doc, "div", { class: "bob-period-parts-note" }, "Loading period parts…"));
    const rows = Array.isArray(model.children) ? model.children : [];
    const hasDone = model.kind === "week";
    const columns = ["Child", "Dates", "Worked", ...(hasDone ? ["Done"] : []), "Review", "Summary"];
    const table = statsEl(doc, "div", { class: "bob-period-parts-table bob-period-parts-table-kind-" + model.kind, role: "table", "aria-label": "Parts of " + (model.periodId || "period") });
    const header = statsEl(doc, "div", { class: "bob-period-parts-row bob-period-parts-header", role: "row" });
    for (const name of columns) header.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-" + name.toLowerCase(), role: "columnheader" }, name));
    table.appendChild(header);
    const numeric = rows.map((row) => row.worked && typeof row.worked.value === "number" ? row.worked.value : 0);
    const tallest = Math.max(0, ...numeric);
    for (const row of rows) {
      const future = row.state === "future";
      const notTracked = periodPartsIsNotTracked(row);
      const line = statsEl(doc, "div", { class: "bob-period-parts-row" + (future ? " bob-period-parts-row-future" : "") + (notTracked ? " bob-period-parts-row-not-tracked" : ""), role: "row", "data-state": row.state });
      line.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-child", role: "cell" }));
      const childCell = line.children[line.children.length - 1];
      childCell.appendChild(periodPartsChildLink(doc, row, model));
      line.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-dates", role: "cell" }, row.rangeLabel || ""));
      if (!future) {
        const workedText = notTracked ? "not tracked" : ((row.worked && row.worked.display) || "–") + (row.worked && row.worked.soFar ? " so far" : "");
        const workedCell = statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-worked", role: "cell", title: workedText });
        workedCell.appendChild(statsEl(doc, "span", { class: "bob-period-parts-worked-value" }, workedText));
        workedCell.appendChild(periodPartsTableMiniBar(doc, row, tallest));
        line.appendChild(workedCell);
        if (hasDone) line.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-done", role: "cell" }, row.done && typeof row.done.display === "string" ? row.done.display : "–"));
        line.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-review", role: "cell" }, periodPartsReviewText(row)));
        line.appendChild(statsEl(doc, "span", { class: "bob-period-parts-cell bob-period-parts-cell-summary " + (row.headline ? "bob-period-parts-summary-headline" : "bob-period-parts-summary-mostly"), role: "cell" }, row.headline || row.mostly || ""));
      }
      table.appendChild(line);
    }
    root.appendChild(table);
    return root;
  } catch (error) {
    return null;
  }
}
