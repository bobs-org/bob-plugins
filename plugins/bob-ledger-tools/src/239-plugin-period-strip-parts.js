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
  const bar = periodStripColumnBar(doc, column, periodStripTallest(model));
  if (bar && node.appendChild) node.appendChild(bar);
  const glyph = periodStripCloseoutGlyph(column.mark);
  const markText = state === "future" ? "" : glyph;
  const mark = statsEl(doc, "span", {
    class: "bob-period-strip-column-mark",
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

function paintPeriodStripParts(doc, host, model, handlers) {
  try {
    if (!host || !model) return null;
    const row = periodStripRenderWeekRow(doc, model, handlers || {});
    if (!row) return null;
    if (typeof host.appendChild === "function") host.appendChild(row);
    return row;
  } catch (error) {
    return null;
  }
}
