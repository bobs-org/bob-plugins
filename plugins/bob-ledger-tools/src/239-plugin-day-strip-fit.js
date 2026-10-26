// Measure-and-fit for the Day strip legend. The model returns every root
// in bar order with a static overflowDefault; this fragment decides how
// many of the top-ranked roots fit the legend's measured width and hides
// the rest behind one counter. Never throws into Obsidian's lifecycle.
function dayStripFitCount(widths, gap, counter, available) {
  try {
    const list = Array.isArray(widths) ? widths : [];
    const n = list.length;
    const safeGap = Number.isFinite(gap) ? gap : 0;
    const safeCounter = Number.isFinite(counter) ? counter : 0;
    const safeAvailable = Number.isFinite(available) ? available : 0;
    const sums = [0];
    for (let index = 0; index < n; index += 1) {
      const width = Number.isFinite(list[index]) ? list[index] : 0;
      sums.push(sums[index] + width);
    }
    for (let count = n; count >= 0; count -= 1) {
      let total = sums[count] + (count > 1 ? safeGap * (count - 1) : 0);
      if (count < n) {
        total += (count > 0 ? safeGap : 0) + safeCounter;
      }
      if (total <= safeAvailable + 0.5) return count;
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

// Pure fit: largest k whose top-k widths plus gaps plus (when k < n) one
// more gap and the counter fit. Names mode wins only when it names
// strictly more roots; otherwise values mode stays.
function dayStripLegendFit(input) {
  try {
    const safe = input && typeof input === "object" ? input : {};
    const full = Array.isArray(safe.full) ? safe.full : [];
    const names = Array.isArray(safe.names) ? safe.names : null;
    const gap = Number.isFinite(safe.gap) ? safe.gap : 0;
    const counter = Number.isFinite(safe.counter) ? safe.counter : 0;
    const available = Number.isFinite(safe.available) ? safe.available : 0;
    const valuesCount = dayStripFitCount(full, gap, counter, available);
    if (valuesCount >= full.length) {
      return { count: full.length, mode: "values" };
    }
    if (names && names.length === full.length) {
      const namesCount = dayStripFitCount(names, gap, counter, available);
      if (namesCount > valuesCount) {
        return { count: namesCount, mode: "names" };
      }
    }
    return { count: valuesCount, mode: "values" };
  } catch (error) {
    return { count: 0, mode: "values" };
  }
}

function dayStripFitViewOf(el) {
  try {
    if (el && el.ownerDocument && el.ownerDocument.defaultView) {
      return el.ownerDocument.defaultView;
    }
  } catch (error) {
    // Fall through to the global.
  }
  try {
    if (typeof globalThis !== "undefined") return globalThis;
  } catch (error) {
    // No global.
  }
  return null;
}

function dayStripFitFindByClass(root, wanted) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    try {
      const classes = typeof node.getAttribute === "function"
        ? String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)
        : [];
      if (classes.indexOf(wanted) >= 0) found.push(node);
    } catch (error) {
      // Ignore unreadable nodes.
    }
    let children = null;
    try {
      children = node.children;
    } catch (error) {
      children = null;
    }
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    } else if (children && typeof children.length === "number") {
      for (let index = 0; index < children.length; index += 1) {
        try {
          visit(children[index]);
        } catch (error) {
          // Ignore.
        }
      }
    }
  };
  visit(root);
  return found;
}

function dayStripFitLegendEl(legend) {
  return legend;
}

function dayStripFitGetGap(legend, view) {
  try {
    let computed = null;
    if (view && typeof view.getComputedStyle === "function") {
      computed = view.getComputedStyle(legend);
    } else if (typeof getComputedStyle === "function") {
      computed = getComputedStyle(legend);
    }
    if (!computed) return 0;
    const raw = computed.columnGap || computed.gap || "";
    const parsed = parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (error) {
    return 0;
  }
}

function dayStripFitClassNames(el) {
  try {
    return String((el && typeof el.getAttribute === "function" && el.getAttribute("class")) || "")
      .split(/\s+/)
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function dayStripFitSetNamesMode(legend, on) {
  try {
    const names = dayStripFitClassNames(legend);
    const has = names.indexOf("bob-day-strip-legend-names") >= 0;
    if (on && !has) {
      names.push("bob-day-strip-legend-names");
      legend.setAttribute("class", names.join(" "));
    } else if (!on && has) {
      legend.setAttribute(
        "class",
        names.filter((name) => name !== "bob-day-strip-legend-names").join(" "),
      );
    }
  } catch (error) {
    // Best-effort.
  }
}

// DOM glue: measure the legend and apply the fit. Never throws; returns
// null when there is no layout to measure.
function dayStripFitLegend(stripEl) {
  try {
    if (!stripEl || typeof stripEl !== "object") return null;
    let legend = null;
    try {
      if (typeof stripEl.querySelector === "function") {
        legend = stripEl.querySelector(".bob-day-strip-legend");
      }
    } catch (error) {
      legend = null;
    }
    if (!legend) {
      const matches = dayStripFitFindByClass(stripEl, "bob-day-strip-legend");
      legend = matches[0] || null;
    }
    if (!legend) return null;
    let items = [];
    try {
      if (typeof legend.querySelectorAll === "function") {
        items = Array.from(legend.querySelectorAll(".bob-day-strip-legend-item"));
      }
    } catch (error) {
      items = [];
    }
    if (!items.length) {
      items = dayStripFitFindByClass(legend, "bob-day-strip-legend-item");
    }
    if (!items.length) return null;
    let counter = null;
    try {
      if (typeof legend.querySelector === "function") {
        counter = legend.querySelector(".bob-day-strip-overflow");
      }
    } catch (error) {
      counter = null;
    }
    if (!counter) {
      const matches = dayStripFitFindByClass(legend, "bob-day-strip-overflow");
      counter = matches[0] || null;
    }
    if (!counter) return null;
    const available = Number(legend.clientWidth) || 0;
    if (!available) return null;
    let canMeasure = true;
    for (const item of items) {
      if (!item || typeof item.getBoundingClientRect !== "function") {
        canMeasure = false;
        break;
      }
    }
    if (!canMeasure || typeof counter.getBoundingClientRect !== "function") return null;
    const view = dayStripFitViewOf(stripEl);
    // Unhide every item so measured widths are intrinsic.
    for (const item of items) {
      try {
        item.removeAttribute("hidden");
      } catch (error) {
        // Best-effort.
      }
    }
    try {
      counter.removeAttribute("hidden");
    } catch (error) {
      // Best-effort.
    }
    // Values-mode widths in rank order.
    dayStripFitSetNamesMode(legend, false);
    const gap = dayStripFitGetGap(legend, view);
    const byRank = items.slice().sort((a, b) => {
      const ra = Number(a && typeof a.getAttribute === "function" ? a.getAttribute("data-rank") : 0) || 0;
      const rb = Number(b && typeof b.getAttribute === "function" ? b.getAttribute("data-rank") : 0) || 0;
      return ra - rb;
    });
    const full = byRank.map((item) => {
      try {
        return item.getBoundingClientRect().width || 0;
      } catch (error) {
        return 0;
      }
    });
    const n = byRank.length;
    const digits = String(Math.max(1, n)).length;
    const widest = "+" + "9".repeat(digits);
    let savedCounterText = "";
    try {
      savedCounterText = counter.textContent || "";
    } catch (error) {
      savedCounterText = "";
    }
    try {
      counter.textContent = widest;
    } catch (error) {
      // Best-effort.
    }
    let counterWidth = 0;
    try {
      counterWidth = counter.getBoundingClientRect().width || 0;
    } catch (error) {
      counterWidth = 0;
    }
    // Names-mode widths: values hidden, so items are narrower.
    let names = null;
    if (n > 0) {
      dayStripFitSetNamesMode(legend, true);
      try {
        names = byRank.map((item) => {
          try {
            return item.getBoundingClientRect().width || 0;
          } catch (error) {
            return 0;
          }
        });
      } catch (error) {
        names = null;
      }
      dayStripFitSetNamesMode(legend, false);
    }
    const fit = dayStripLegendFit({ full, names, gap, counter: counterWidth, available });
    const count = Math.max(0, Math.min(n, fit.count || 0));
    const mode = fit.mode === "names" ? "names" : "values";
    dayStripFitSetNamesMode(legend, mode === "names");
    // Hidden roots in bar order (DOM order) for the counter title.
    const rankOf = new Map();
    for (const item of items) {
      try {
        const rank = Number(item.getAttribute("data-rank")) || 0;
        const key = typeof item.getAttribute === "function" ? item.getAttribute("data-key") : "";
        rankOf.set(item, rank);
        void key;
      } catch (error) {
        rankOf.set(item, 0);
      }
    }
    const hiddenTitles = [];
    for (const item of items) {
      const rank = rankOf.get(item) || 0;
      const show = rank > 0 && rank <= count;
      try {
        if (show) {
          item.removeAttribute("hidden");
        } else {
          item.setAttribute("hidden", "true");
        }
      } catch (error) {
        // Best-effort.
      }
      if (!show) {
        try {
          const title = item.getAttribute("title") || "";
          if (title) hiddenTitles.push(title);
        } catch (error) {
          // Ignore.
        }
      }
    }
    try {
      if (count >= n) {
        counter.setAttribute("hidden", "true");
        counter.textContent = "+" + Math.max(0, n - count);
      } else {
        counter.removeAttribute("hidden");
        counter.textContent = "+" + (n - count);
      }
      if (hiddenTitles.length) {
        counter.setAttribute("title", hiddenTitles.join("\n"));
      } else {
        counter.removeAttribute("title");
      }
    } catch (error) {
      // Best-effort.
    }
    try {
      stripEl.__dayStripFitWidth = dayStripFitStripWidth(stripEl);
    } catch (error) {
      // Best-effort.
    }
    return { count, mode };
  } catch (error) {
    return null;
  }
}

function dayStripFitStripWidth(stripEl) {
  try {
    if (stripEl && typeof stripEl.getBoundingClientRect === "function") {
      const width = stripEl.getBoundingClientRect().width;
      if (Number.isFinite(width)) return width;
    }
  } catch (error) {
    // Fall through.
  }
  try {
    if (stripEl && Number.isFinite(stripEl.clientWidth)) return stripEl.clientWidth;
  } catch (error) {
    // Fall through.
  }
  return 0;
}

function dayStripFitObserverOf(stripEl) {
  try {
    const view = dayStripFitViewOf(stripEl);
    if (view && typeof view.ResizeObserver === "function") return view.ResizeObserver;
  } catch (error) {
    // Fall through.
  }
  try {
    if (typeof ResizeObserver === "function") return ResizeObserver;
  } catch (error) {
    // No observer.
  }
  return null;
}

// Idempotent: one observer per strip element. Its callback re-fits
// synchronously (ResizeObserver runs before paint) and only when the
// strip's inline size moved by at least half a pixel.
function dayStripEnsureFitObserver(el) {
  try {
    if (!el || typeof el !== "object") return null;
    if (el.__dayStripFitObserver) return el.__dayStripFitObserver;
    const Observer = dayStripFitObserverOf(el);
    if (typeof Observer !== "function") return null;
    const observer = new Observer(() => {
      try {
        const now = dayStripFitStripWidth(el);
        const last = Number.isFinite(el.__dayStripFitWidth) ? el.__dayStripFitWidth : NaN;
        if (Number.isFinite(last) && Math.abs(now - last) < 0.5) return;
        dayStripFitLegend(el);
      } catch (error) {
        // Never throw into the observer lifecycle.
      }
    });
    el.__dayStripFitObserver = observer;
    try {
      el.__dayStripFitWidth = dayStripFitStripWidth(el);
    } catch (error) {
      el.__dayStripFitWidth = 0;
    }
    try {
      if (typeof observer.observe === "function") observer.observe(el);
    } catch (error) {
      // Best-effort.
    }
    return observer;
  } catch (error) {
    return null;
  }
}

function dayStripReleaseFitObserver(el) {
  try {
    if (!el || typeof el !== "object") return;
    const observer = el.__dayStripFitObserver;
    if (observer && typeof observer.disconnect === "function") {
      try {
        observer.disconnect();
      } catch (error) {
        // Best-effort.
      }
    }
    el.__dayStripFitObserver = null;
  } catch (error) {
    // Best-effort.
  }
}
