// Read-only Bank Period Charts painter. The pure model already decided
// visibility, copy, and ratios; this layer only builds DOM, wires the
// roving tab stop, dims siblings, fills the readout, and forwards
// read-only activations. It never adds money and never writes vault bytes.

const BANK_PERIOD_PLOT_BOTH_HEIGHT = 44;
const BANK_PERIOD_PLOT_SINGLE_HEIGHT = 62;
const BANK_PERIOD_WEEK_IN_BAND = 14;

const bankPeriodSeenHosts = typeof WeakSet === "function" ? new WeakSet() : null;
const bankPeriodSeenList = [];

function bankPeriodSeen(host) {
  try {
    if (bankPeriodSeenHosts) {
      if (bankPeriodSeenHosts.has(host)) return true;
      bankPeriodSeenHosts.add(host);
      return false;
    }
  } catch (error) {}
  if (bankPeriodSeenList.indexOf(host) !== -1) return true;
  bankPeriodSeenList.push(host);
  return false;
}

function bankPeriodActivate(node, action) {
  if (typeof bankBadgeActivate === "function") {
    bankBadgeActivate(node, action);
    return;
  }
  if (!node || typeof node.addEventListener !== "function" || typeof action !== "function") return;
  node.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", (event) => {
    const forced = Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    action(forced);
  });
}

function bankPeriodRenderHeader(doc, model, handlers, readoutRef) {
  const header = model.header || {};
  const wrap = statsEl(doc, "div", { class: "bob-bank-period-header" });
  if (!wrap) return null;
  const open = header.collapsed !== true;
  const disclosure = statsEl(doc, "span", {
    class: "bob-bank-period-disclosure",
    role: "button",
    tabindex: "0",
    "aria-expanded": open ? "true" : "false",
    title: open ? "Collapse bank charts" : "Expand bank charts",
  }, `${open ? "▾" : "▸"} BANK CHARTS`);
  if (disclosure) {
    bankPeriodActivate(disclosure, () => {
      if (handlers && typeof handlers.toggleCollapsed === "function") handlers.toggleCollapsed();
    });
    wrap.appendChild(disclosure);
  }
  if (header.switchShown === true) {
    const view = header.view || "both";
    const next = header.nextView || "cashflow";
    const labels = { both: "Both", cashflow: "In / Out", categories: "Categories" };
    const node = statsEl(doc, "span", {
      class: "bob-bank-period-switch",
      role: "button",
      tabindex: "0",
      "data-view": view,
      "aria-label": `Charts view: ${labels[view] || view}. Activate for ${labels[next] || next}.`,
      title: `Showing ${labels[view] || view} · click for ${labels[next] || next}`,
    });
    if (node) {
      const first = statsEl(doc, "span", {
        class: "bob-bank-period-switch-mark bob-bank-period-switch-mark-cashflow",
        "data-on": view === "both" || view === "cashflow" ? "true" : "false",
        "aria-hidden": "true",
      });
      const second = statsEl(doc, "span", {
        class: "bob-bank-period-switch-mark bob-bank-period-switch-mark-categories",
        "data-on": view === "both" || view === "categories" ? "true" : "false",
        "aria-hidden": "true",
      });
      if (first) node.appendChild(first);
      if (second) node.appendChild(second);
      bankPeriodActivate(node, () => {
        if (handlers && typeof handlers.setView === "function") handlers.setView(next);
      });
      wrap.appendChild(node);
    }
  }
  const readout = statsEl(doc, "span", {
    class: "bob-bank-period-readout",
    "aria-live": "polite",
  }, "");
  if (readout) {
    wrap.appendChild(readout);
    if (readoutRef) readoutRef.node = readout;
  }
  return wrap;
}

function bankPeriodPlotHeight(model) {
  const shown = (model.header && Array.isArray(model.header.shown) ? model.header.shown : []);
  return shown.length === 1 ? BANK_PERIOD_PLOT_SINGLE_HEIGHT : BANK_PERIOD_PLOT_BOTH_HEIGHT;
}

function bankPeriodColumnBarHeights(column, cashflow, height) {
  if (!column || column.ghost) return { inPx: 0, outPx: 0, ghostPx: 0 };
  if (cashflow.encoding === "markers") {
    const outBand = Math.max(0, height - BANK_PERIOD_WEEK_IN_BAND);
    return { inPx: 0, outPx: (column.outRatio || 0) * outBand, ghostPx: 0.35 * outBand };
  }
  const ratio = typeof cashflow.inBandRatio === "number" ? cashflow.inBandRatio : 0;
  const inBand = height * ratio;
  const outBand = height - inBand;
  return {
    inPx: (column.inRatio || 0) * inBand,
    outPx: (column.outRatio || 0) * outBand,
    ghostPx: 0.35 * outBand,
  };
}

function bankPeriodZeroPx(cashflow, height) {
  if (!cashflow || cashflow.encoding === "markers") return BANK_PERIOD_WEEK_IN_BAND;
  const ratio = typeof cashflow.inBandRatio === "number" ? cashflow.inBandRatio : 0.5;
  return Math.round(height * Math.max(0, Math.min(1, ratio)));
}

function bankPeriodPlaceTop(node, top, height) {
  if (!node) return;
  try {
    if (node.style) {
      node.style.top = `${Math.round(top)}px`;
      if (height != null) node.style.height = `${Math.max(0, height)}px`;
    }
  } catch (error) {}
}

function bankPeriodRenderPlot(doc, columns, cashflow, height) {
  const plot = statsEl(doc, "div", { class: "bob-bank-period-plot", "aria-hidden": "true" });
  if (!plot) return null;
  try {
    if (plot.style) plot.style.height = `${height}px`;
  } catch (error) {}
  const zeroPx = bankPeriodZeroPx(cashflow, height);
  const zero = statsEl(doc, "span", { class: "bob-bank-period-zero", "aria-hidden": "true" });
  if (zero) {
    bankPeriodPlaceTop(zero, zeroPx, null);
    plot.appendChild(zero);
  }
  const list = Array.isArray(columns) ? columns : [];
  for (const column of list) {
    const heights = bankPeriodColumnBarHeights(column, cashflow, height);
    const cell = statsEl(doc, "span", {
      class: "bob-bank-period-plot-cell"
        + (column.ghost ? " bob-bank-period-plot-ghost" : "")
        + (column.state === "future" ? " bob-bank-period-plot-future" : ""),
      "data-column": column.id || "",
    });
    if (!cell) continue;
    if (column.ghost) {
      const ghost = statsEl(doc, "span", { class: "bob-bank-period-ghost-bar", "aria-hidden": "true" });
      if (ghost) {
        bankPeriodPlaceTop(ghost, zeroPx, Math.round(heights.ghostPx || height * 0.35));
        cell.appendChild(ghost);
      }
      plot.appendChild(cell);
      continue;
    }
    if (cashflow.encoding === "markers" && column.marker) {
      const marker = statsEl(doc, "span", { class: "bob-bank-period-in-marker", "aria-hidden": "true" });
      if (marker) {
        bankPeriodPlaceTop(marker, zeroPx - BANK_PERIOD_WEEK_IN_BAND + Math.round((BANK_PERIOD_WEEK_IN_BAND - 8) / 2), 8);
        cell.appendChild(marker);
      }
    }
    if (cashflow.encoding === "mirrored" && heights.inPx > 0) {
      const inBar = statsEl(doc, "span", { class: "bob-bank-period-in-bar", "aria-hidden": "true" });
      if (inBar) {
        try {
          if (inBar.style) {
            inBar.style.bottom = `${Math.round(height - zeroPx)}px`;
            inBar.style.height = `${heights.inPx}px`;
          }
        } catch (error) {}
        cell.appendChild(inBar);
      }
    }
    if (heights.outPx > 0) {
      const outBar = statsEl(doc, "span", { class: "bob-bank-period-out-bar", "aria-hidden": "true" });
      if (outBar) {
        bankPeriodPlaceTop(outBar, zeroPx, heights.outPx);
        cell.appendChild(outBar);
      }
    } else if (column.state === "untracked") {
      const ghost = statsEl(doc, "span", { class: "bob-bank-period-ghost-bar", "aria-hidden": "true" });
      if (ghost) {
        bankPeriodPlaceTop(ghost, zeroPx, Math.round(heights.ghostPx));
        cell.appendChild(ghost);
      }
    } else if (column.state === "awaiting_import") {
      const hatch = statsEl(doc, "span", { class: "bob-bank-period-hatch", "aria-hidden": "true" });
      if (hatch) {
        bankPeriodPlaceTop(hatch, zeroPx, Math.max(2, Math.round((height - zeroPx) * 0.5)));
        cell.appendChild(hatch);
      }
    } else if (column.state === "partial") {
      const cap = statsEl(doc, "span", { class: "bob-bank-period-partial-cap", "aria-hidden": "true" });
      if (cap) {
        bankPeriodPlaceTop(cap, zeroPx + heights.outPx, null);
        cell.appendChild(cap);
      }
    } else if (column.state === "future") {
      const stub = statsEl(doc, "span", { class: "bob-bank-period-future-stub", "aria-hidden": "true" });
      if (stub) {
        bankPeriodPlaceTop(stub, zeroPx, null);
        cell.appendChild(stub);
      }
    }
    if (column.extremeOut && column.extremeOutLabel) {
      const clearance = height - zeroPx - heights.outPx;
      if (clearance >= 12) {
        const extreme = statsEl(doc, "span", { class: "bob-bank-period-extreme", "aria-hidden": "true" }, column.extremeOutLabel);
        if (extreme) {
          bankPeriodPlaceTop(extreme, zeroPx + heights.outPx + 2, null);
          cell.appendChild(extreme);
        }
      }
    } else if (column.extremeIn && column.extremeInLabel) {
      if (cashflow.encoding === "mirrored") {
        const clearance = zeroPx - heights.inPx;
        if (clearance >= 10) {
          const extreme = statsEl(doc, "span", { class: "bob-bank-period-extreme bob-bank-period-extreme-in", "aria-hidden": "true" }, column.extremeInLabel);
          if (extreme) {
            try {
              if (extreme.style) extreme.style.bottom = `${Math.round(height - zeroPx + heights.inPx + 2)}px`;
            } catch (error) {}
            cell.appendChild(extreme);
          }
        }
      } else if (!column.marker) {
        const extreme = statsEl(doc, "span", { class: "bob-bank-period-extreme bob-bank-period-extreme-in", "aria-hidden": "true" }, column.extremeInLabel);
        if (extreme) {
          bankPeriodPlaceTop(extreme, 0, null);
          cell.appendChild(extreme);
        }
      } else {
        const extreme = statsEl(doc, "span", { class: "bob-bank-period-extreme bob-bank-period-extreme-in", "aria-hidden": "true" }, column.extremeInLabel);
        if (extreme) {
          try {
            if (extreme.style) {
              extreme.style.top = "0px";
              extreme.style.marginLeft = "12px";
            }
          } catch (error) {}
          cell.appendChild(extreme);
        }
      }
    }
    plot.appendChild(cell);
  }
  return plot;
}

function bankPeriodRenderGroups(doc, columns) {
  const list = Array.isArray(columns) ? columns : [];
  const groups = [];
  for (const column of list) {
    if (column.ghost || !column.group) continue;
    if (!groups.length || groups[groups.length - 1].key !== column.group) {
      groups.push({ key: column.group, count: 1 });
    } else {
      groups[groups.length - 1].count += 1;
    }
  }
  if (!groups.length) return null;
  const row = statsEl(doc, "div", { class: "bob-bank-period-groups", "aria-hidden": "true" });
  if (!row) return null;
  try {
    if (row.style) row.style.gridTemplateColumns = `repeat(${list.length}, minmax(0, 1fr))`;
  } catch (error) {}
  let cursor = 0;
  for (const group of groups) {
    const caption = statsEl(doc, "span", {
      class: "bob-bank-period-group-caption",
      "data-group": group.key,
    }, group.key);
    if (caption) {
      try {
        if (caption.style) caption.style.gridColumn = `${cursor + 1} / span ${group.count}`;
      } catch (error) {}
      row.appendChild(caption);
    }
    cursor += group.count;
  }
  return row;
}

function bankPeriodRenderAxis(doc, columns, cashflow, handlers, context, options = {}) {
  const list = Array.isArray(columns) ? columns : [];
  const bareCaptions = options && options.bareCaptions === true;
  const row = statsEl(doc, "div", {
    class: "bob-bank-period-axis",
    role: "group",
    "aria-label": "Child periods",
  });
  if (!row) return { row: null, nodes: [], plots: [] };
  try {
    if (row.style) row.style.gridTemplateColumns = `repeat(${Math.max(1, list.length)}, minmax(0, 1fr))`;
  } catch (error) {}
  const nodes = [];
  list.forEach((column, index) => {
    if (column.ghost) {
      const ghost = statsEl(doc, "span", {
        class: "bob-bank-period-column bob-bank-period-column-ghost",
        role: "presentation",
        "aria-label": column.aria || column.label || "",
        title: column.tooltip || null,
        "data-column-state": "ghost",
      });
      if (ghost) {
        ghost.appendChild(statsEl(doc, "span", { class: "bob-bank-period-column-caption", "aria-hidden": "true" }, ""));
        ghost.appendChild(statsEl(doc, "span", { class: "bob-bank-period-column-value bob-bank-period-ghost-label" }, column.label || ""));
        row.appendChild(ghost);
      }
      nodes.push(null);
      return;
    }
    const node = statsEl(doc, "span", {
      class: "bob-bank-period-column"
        + (column.state === "future" ? " bob-bank-period-column-future" : "")
        + (column.soFar ? " bob-bank-period-column-current" : ""),
      role: "link",
      tabindex: index === 0 ? "0" : "-1",
      title: column.tooltip || null,
      "aria-label": column.aria || column.readout || column.label || column.id || "",
      "data-column": column.id || "",
      "data-column-index": String(index),
      "data-column-state": column.state || "",
    });
    if (!node) {
      nodes.push(null);
      return;
    }
    node.appendChild(statsEl(doc, "span", { class: "bob-bank-period-column-caption" }, bareCaptions ? "" : (column.label || column.id || "")));
    if (column.waiting > 0) {
      node.appendChild(statsEl(doc, "span", { class: "bob-bank-period-waiting-dot", "aria-hidden": "true" }));
    }
    bankPeriodActivate(node, (newLeaf) => {
      if (handlers && typeof handlers.activateBucket === "function") {
        handlers.activateBucket(column.target || null, column, newLeaf);
      }
    });
    const setActive = (active) => {
      context.setActive(index, active);
      context.setReadout(active ? column.readout || "" : "");
    };
    node.addEventListener("mouseenter", () => setActive(true));
    node.addEventListener("mouseleave", () => setActive(false));
    node.addEventListener("focus", () => setActive(true));
    node.addEventListener("blur", () => setActive(false));
    nodes.push(node);
    row.appendChild(node);
  });
  row.addEventListener("keydown", (event) => {
    if (!event) return;
    if (event.key === "Escape") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      context.setActive(-1, false);
      context.setReadout("");
      return;
    }
    const current = nodes.indexOf(event.target);
    if (current < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = Math.min(nodes.length - 1, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    else return;
    while (next >= 0 && next < nodes.length && !nodes[next]) {
      next += (next > current ? 1 : -1);
    }
    if (next < 0 || next >= nodes.length || !nodes[next]) return;
    if (event.preventDefault) event.preventDefault();
    nodes.forEach((entry) => {
      if (entry && entry.setAttribute) entry.setAttribute("tabindex", "-1");
    });
    nodes[next].setAttribute("tabindex", "0");
    if (typeof nodes[next].focus === "function") nodes[next].focus();
  });
  return { row, nodes, plots: [] };
}

function bankPeriodRenderCashflow(doc, columns, cashflow, model, handlers, readoutRef, variant, options = {}) {
  const many = (options && options.many === true) || (Array.isArray(columns) && columns.length > 20);
  const frame = statsEl(doc, "div", {
    class: `bob-bank-period-cashflow bob-bank-period-cashflow-${variant || "detailed"}`
      + (many ? " bob-bank-period-cashflow-many" : ""),
    "data-variant": variant || "detailed",
    "data-encoding": cashflow.encoding || "",
  });
  if (!frame) return null;
  const height = bankPeriodPlotHeight(model);
  const heading = statsEl(doc, "div", { class: "bob-bank-period-chart-heading" }, "IN / OUT");
  if (heading) frame.appendChild(heading);
  const plot = bankPeriodRenderPlot(doc, columns, cashflow, height);
  if (plot) frame.appendChild(plot);
  const groups = bankPeriodRenderGroups(doc, columns);
  if (groups) frame.appendChild(groups);
  const context = {
    setReadout: (text) => {
      if (readoutRef && readoutRef.node) {
        try {
          readoutRef.node.textContent = text;
        } catch (error) {}
      }
    },
  };
  const axis = bankPeriodRenderAxis(doc, columns, cashflow, handlers, {
    setReadout: context.setReadout,
    setActive: (index, active) => {
      const axisNodes = (axisRef.nodes || []).filter(Boolean);
      const plotCells = plot && Array.isArray(plot.children) ? plot.children : [];
      if (!active || index < 0) {
        for (const entry of axisNodes) {
          try {
            if (entry.style) entry.style.opacity = "";
          } catch (error) {}
        }
        for (const cell of plotCells) {
          try {
            if (cell && cell.style) cell.style.opacity = "";
          } catch (error) {}
        }
        return;
      }
      axisNodes.forEach((entry, position) => {
        try {
          if (entry.style) entry.style.opacity = position === index ? "" : "0.35";
        } catch (error) {}
      });
      plotCells.forEach((cell, position) => {
        try {
          if (cell && cell.style) cell.style.opacity = position === index ? "" : "0.35";
        } catch (error) {}
      });
    },
  }, options);
  const axisRef = axis;
  if (axis && axis.row) frame.appendChild(axis.row);
  return frame;
}

function bankPeriodRenderCategories(doc, model) {
  const categories = model.categories;
  if (!categories || !Array.isArray(categories.rows) || !categories.rows.length) return null;
  const wrap = statsEl(doc, "div", { class: "bob-bank-period-categories" });
  if (!wrap) return null;
  const heading = statsEl(doc, "div", { class: "bob-bank-period-chart-heading" }, "OUT BY CATEGORY");
  if (heading) wrap.appendChild(heading);
  for (const entry of categories.rows) {
    const rowNode = statsEl(doc, "div", {
      class: "bob-bank-period-category-row" + (entry.rest ? " bob-bank-period-category-rest" : ""),
      "data-key": entry.key || "",
      "data-kind": entry.kind || "",
      title: entry.tooltip || null,
    });
    if (!rowNode) continue;
    if (entry.amber) {
      const dot = statsEl(doc, "span", { class: "bob-bank-period-amber-dot", "aria-hidden": "true" });
      if (dot) rowNode.appendChild(dot);
    }
    if (entry.emoji) {
      const emoji = statsEl(doc, "span", { class: "bob-bank-period-category-emoji", "aria-hidden": "true" }, entry.emoji);
      if (emoji) rowNode.appendChild(emoji);
    }
    const label = statsEl(doc, "span", { class: "bob-bank-period-category-label" }, entry.label || "");
    if (label) rowNode.appendChild(label);
    const track = statsEl(doc, "span", { class: "bob-bank-period-category-track", "aria-hidden": "true" });
    if (track) {
      const fill = statsEl(doc, "span", { class: "bob-bank-period-category-fill", "aria-hidden": "true" });
      if (fill) {
        try {
          if (fill.style) fill.style.width = `${Math.max(0, Math.min(1, Number(entry.share) || 0)) * 100}%`;
        } catch (error) {}
        track.appendChild(fill);
      }
      rowNode.appendChild(track);
    }
    const amount = statsEl(doc, "span", { class: "bob-bank-period-category-amount" }, entry.amount || "");
    if (amount) rowNode.appendChild(amount);
    const percent = statsEl(doc, "span", { class: "bob-bank-period-category-percent" }, entry.percent || "");
    if (percent) rowNode.appendChild(percent);
    wrap.appendChild(rowNode);
  }
  return wrap;
}

function bankPeriodRenderNotCounted(doc, model, handlers) {
  const parts = Array.isArray(model.notCounted) ? model.notCounted : [];
  if (!parts.length) return null;
  const line = statsEl(doc, "div", { class: "bob-bank-period-notcounted" });
  if (!line) return null;
  parts.forEach((part, index) => {
    if (index > 0) {
      const separator = statsEl(doc, "span", { class: "bob-bank-period-notcounted-separator", "aria-hidden": "true" }, " · ");
      if (separator) line.appendChild(separator);
    }
    if (part.key === "waiting" && part.target) {
      const link = statsEl(doc, "span", {
        class: "bob-bank-period-notcounted-part bob-bank-period-notcounted-waiting",
        role: "link",
        tabindex: "0",
        "data-key": "waiting",
      }, part.text || "");
      if (link) {
        bankPeriodActivate(link, (newLeaf) => {
          if (handlers && typeof handlers.openWaiting === "function") handlers.openWaiting(part.target, newLeaf);
        });
        line.appendChild(link);
      }
      return;
    }
    const span = statsEl(doc, "span", {
      class: "bob-bank-period-notcounted-part",
      "data-key": part.key || "",
    }, part.text || "");
    if (span) line.appendChild(span);
  });
  return line;
}

function bankPeriodRenderTable(doc, captionText, columns, rows) {
  const table = statsEl(doc, "table", { class: "bob-bank-period-sr" });
  if (!table) return null;
  const caption = statsEl(doc, "caption", {}, captionText);
  if (caption) table.appendChild(caption);
  const head = statsEl(doc, "thead", {});
  if (head) {
    const headRow = statsEl(doc, "tr", {});
    if (headRow) {
      for (const name of columns) {
        const cell = statsEl(doc, "th", { scope: "col" }, name);
        if (cell) headRow.appendChild(cell);
      }
      head.appendChild(headRow);
    }
    table.appendChild(head);
  }
  const body = statsEl(doc, "tbody", {});
  if (body) {
    for (const entry of rows) {
      const line = statsEl(doc, "tr", {});
      if (!line) continue;
      for (const name of columns) {
        const key = ({ period: "period", in: "in", out: "out", net: "net", waiting: "waiting", rows: "rows", state: "state", category: "category", share: "share" })[name] || name;
        const cell = statsEl(doc, "td", {}, entry[key] != null ? String(entry[key]) : "");
        if (cell) line.appendChild(cell);
      }
      body.appendChild(line);
    }
    table.appendChild(body);
  }
  return table;
}

function bankPeriodRenderTables(doc, model) {
  const tables = model.tables || {};
  const wrap = statsEl(doc, "div", { class: "bob-bank-period-tables", "aria-hidden": "false" });
  if (!wrap) return null;
  let painted = 0;
  if (tables.cashflow) {
    const table = bankPeriodRenderTable(doc, tables.cashflow.caption || "In and out by period", tables.cashflow.columns || [], tables.cashflow.rows || []);
    if (table) {
      wrap.appendChild(table);
      painted += 1;
    }
  }
  if (tables.categories) {
    const table = bankPeriodRenderTable(doc, tables.categories.caption || "Out by category", tables.categories.columns || [], tables.categories.rows || []);
    if (table) {
      wrap.appendChild(table);
      painted += 1;
    }
  }
  return painted ? wrap : null;
}

function bankPeriodPaint(host, model, handlers = {}) {
  if (!host) return null;
  const clear = typeof bankCardClear === "function"
    ? () => bankCardClear(host)
    : () => {
      try {
        if (typeof host.replaceChildren === "function") host.replaceChildren();
        else host.textContent = "";
      } catch (error) {}
    };
  if (!model || model.state === "hidden") {
    clear();
    return null;
  }
  const doc = statsDocFor(host);
  if (!doc) return null;
  if (model.state === "unavailable") {
    clear();
    const line = typeof bankCardAppend === "function"
      ? bankCardAppend(host, "span", {
        class: "bob-bank-period-unavailable",
        role: "status",
        title: model.hint || "The bank charts could not be read.",
      }, "Bank charts unavailable")
      : statsEl(doc, "span", {
        class: "bob-bank-period-unavailable",
        role: "status",
        title: model.hint || "The bank charts could not be read.",
      }, "Bank charts unavailable");
    if (line && line.parentNode !== host && typeof host.appendChild === "function") {
      try {
        host.appendChild(line);
      } catch (error) {}
    }
    return line;
  }
  if (model.state === "waiting") {
    clear();
    const waiting = model.waitingLine || {};
    const line = statsEl(doc, "div", { class: "bob-bank-period-waiting" });
    if (!line) return null;
    const text = waiting.text || "";
    if (waiting.target && handlers && typeof handlers.openWaiting === "function") {
      const link = statsEl(doc, "span", {
        class: "bob-bank-period-waiting-link",
        role: "link",
        tabindex: "0",
        title: text,
      }, text);
      if (link) {
        bankPeriodActivate(link, (newLeaf) => handlers.openWaiting(waiting.target, newLeaf));
        line.appendChild(link);
      }
    } else {
      line.appendChild(statsEl(doc, "span", { class: "bob-bank-period-waiting-text" }, text));
    }
    try {
      host.appendChild(line);
    } catch (error) {
      return null;
    }
    return line;
  }
  if (model.state !== "charts") {
    clear();
    return null;
  }
  clear();
  const header = model.header || {};
  const shown = Array.isArray(header.shown) ? header.shown : [];
  const root = statsEl(doc, "div", {
    class: "bob-bank-period"
      + (header.collapsed ? " bob-bank-period-collapsed" : "")
      + (model.stale ? " bob-bank-period-stale" : ""),
    role: "group",
    "aria-label": model.ariaLabel || "Bank period charts",
    "data-state": "charts",
    "data-stale": model.stale ? "true" : "false",
    "data-view": header.view || "both",
    "data-shown": shown.join("+") || "none",
    title: model.stale && model.hint ? model.hint : null,
  });
  if (!root) return null;
  try {
    if (!bankPeriodSeen(host)) root.setAttribute("class", `${root.getAttribute("class")} bob-bank-period-enter`);
  } catch (error) {}
  const readoutRef = { node: null };
  const headerNode = bankPeriodRenderHeader(doc, model, handlers, readoutRef);
  if (headerNode) root.appendChild(headerNode);
  if (!header.collapsed) {
    const cashflowForBody = model.cashflow;
    const hasFallback = shown.includes("cashflow") && cashflowForBody
      && Array.isArray(cashflowForBody.fallbackColumns) && cashflowForBody.fallbackColumns.length > 0;
    const body = statsEl(doc, "div", {
      class: "bob-bank-period-body" + (hasFallback ? " bob-bank-period-body-year" : ""),
    });
    if (body) {
      if (shown.includes("cashflow") && model.cashflow) {
        const cashflow = model.cashflow;
        const fallback = Array.isArray(cashflow.fallbackColumns) ? cashflow.fallbackColumns : [];
        if (fallback.length) {
          const year = statsEl(doc, "div", { class: "bob-bank-period-year" });
          if (year) {
            const detailed = bankPeriodRenderCashflow(doc, cashflow.columns, cashflow, model, handlers, readoutRef, "detailed", { bareCaptions: true, many: true });
            if (detailed) year.appendChild(detailed);
            const fallbackModel = { ...model, cashflow: { ...cashflow, columns: fallback } };
            const fallbackNode = bankPeriodRenderCashflow(doc, fallback, { ...cashflow, columns: fallback }, fallbackModel, handlers, readoutRef, "fallback");
            if (fallbackNode) year.appendChild(fallbackNode);
            body.appendChild(year);
          }
        } else {
          const single = bankPeriodRenderCashflow(doc, cashflow.columns, cashflow, model, handlers, readoutRef, "detailed");
          if (single) body.appendChild(single);
        }
      }
      if (shown.includes("categories")) {
        const categories = bankPeriodRenderCategories(doc, model);
        if (categories) body.appendChild(categories);
      }
      if (body.children && body.children.length) root.appendChild(body);
      else if (typeof body.childNodes !== "undefined") root.appendChild(body);
    }
    const notCounted = bankPeriodRenderNotCounted(doc, model, handlers);
    if (notCounted) root.appendChild(notCounted);
    const tables = bankPeriodRenderTables(doc, model);
    if (tables) root.appendChild(tables);
  }
  try {
    host.appendChild(root);
  } catch (error) {
    return null;
  }
  return root;
}
