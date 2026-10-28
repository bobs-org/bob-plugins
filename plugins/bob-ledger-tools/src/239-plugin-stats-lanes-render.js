// Stats window time bars: two Day-strip-style lanes between the header
// and the tiles. The model owns values; this painter lays them out,
// fits the legends, morphs on a window change, and activates the panel.

function statsLanesViewOf(host) {
  try {
    if (host && host.ownerDocument && host.ownerDocument.defaultView) {
      return host.ownerDocument.defaultView;
    }
  } catch (error) {
    // Fall through.
  }
  try {
    if (typeof globalThis !== "undefined") return globalThis;
  } catch (error) {
    // No global.
  }
  return null;
}

function statsLanesHasLayout(host) {
  try {
    if (host && typeof host.getBoundingClientRect === "function") {
      const rect = host.getBoundingClientRect();
      if (rect && Number.isFinite(rect.width) && rect.width > 0) return true;
    }
  } catch (error) {
    // Fall through.
  }
  try {
    if (host && Number.isFinite(host.clientWidth) && host.clientWidth > 0) return true;
  } catch (error) {
    // No layout.
  }
  return false;
}

function statsLanesPrefersReducedMotion(host) {
  try {
    const view = statsLanesViewOf(host);
    if (view && typeof view.matchMedia === "function") {
      return Boolean(view.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  } catch (error) {
    // Assume motion is allowed.
  }
  return false;
}

function statsLanesRaf(host) {
  try {
    const view = statsLanesViewOf(host);
    if (view && typeof view.requestAnimationFrame === "function") {
      return view.requestAnimationFrame.bind(view);
    }
  } catch (error) {
    // Fall through.
  }
  try {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame;
  } catch (error) {
    // No rAF.
  }
  return null;
}

function statsLanesMemoryPairs(lane) {
  const segments = lane && Array.isArray(lane.segments) ? lane.segments : [];
  return segments.map((segment) => [segment.key, segment.value]);
}

function statsLanesOldValue(pairs, key) {
  if (!Array.isArray(pairs)) return null;
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair[0] === key) return pair[1];
  }
  return null;
}

function statsLanesShouldMorph(host, model, memory) {
  if (!model || !memory || memory.windowKey === model.windowKey) return false;
  if (!statsLanesHasLayout(host)) return false;
  if (statsLanesPrefersReducedMotion(host)) return false;
  return typeof statsLanesRaf(host) === "function";
}

function statsLanesSetGrow(node, value) {
  try {
    if (node && node.style) node.style.flexGrow = String(Math.max(0, Number(value) || 0));
  } catch (error) {
    // Best-effort.
  }
}

function statsLanesClosest(node, predicate) {
  let current = node;
  while (current) {
    try {
      if (predicate(current)) return current;
    } catch (error) {
      // Keep walking.
    }
    current = current.parentNode || null;
  }
  return null;
}

function statsLanesClassList(node) {
  try {
    if (typeof node.getAttribute === "function") {
      return String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    }
  } catch (error) {
    // Empty.
  }
  return [];
}

function statsLanesHasClass(node, name) {
  return statsLanesClassList(node).includes(name);
}

function statsLanesHiddenKeys(lane) {
  const keys = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (statsLanesHasClass(node, "bob-day-strip-legend-item")) {
      const hidden = (typeof node.hasAttribute === "function" && node.hasAttribute("hidden"))
        || node.hidden === true
        || (typeof node.getAttribute === "function" && node.getAttribute("hidden") !== null);
      const key = typeof node.getAttribute === "function" ? node.getAttribute("data-key") : null;
      if (hidden && key) keys.push(key);
    }
    const children = node.children || [];
    for (const child of children) visit(child);
  };
  visit(lane);
  return keys;
}

function statsLanesClearHot(lane) {
  if (!lane) return;
  try {
    if (typeof lane.removeAttribute === "function") lane.removeAttribute("data-hot");
  } catch (error) {
    // Best-effort.
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    try {
      if (typeof node.removeAttribute === "function" && node.getAttribute && node.getAttribute("data-hot") === "true") {
        node.removeAttribute("data-hot");
      }
    } catch (error) {
      // Best-effort.
    }
    const children = node.children || [];
    for (const child of children) visit(child);
  };
  visit(lane);
}

function statsLanesMarkHot(lane, keys) {
  statsLanesClearHot(lane);
  if (!lane || !Array.isArray(keys) || !keys.length) return;
  const wanted = new Set(keys);
  try {
    if (typeof lane.setAttribute === "function") lane.setAttribute("data-hot", "true");
  } catch (error) {
    // Best-effort.
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    try {
      const key = typeof node.getAttribute === "function" ? node.getAttribute("data-key") : null;
      if (key && wanted.has(key) && typeof node.setAttribute === "function") {
        node.setAttribute("data-hot", "true");
      }
    } catch (error) {
      // Best-effort.
    }
    const children = node.children || [];
    for (const child of children) visit(child);
  };
  visit(lane);
}

function statsLanesBindHover(lane) {
  if (!lane || typeof lane.addEventListener !== "function") return;
  lane.addEventListener("pointerover", (event) => {
    const target = event && event.target;
    const overflow = statsLanesClosest(target, (node) => statsLanesHasClass(node, "bob-day-strip-overflow"));
    if (overflow) {
      const keys = statsLanesHiddenKeys(lane);
      statsLanesMarkHot(lane, keys);
      try {
        if (typeof overflow.setAttribute === "function") overflow.setAttribute("data-hot", "true");
      } catch (error) {
        // Best-effort.
      }
      return;
    }
    const keyed = statsLanesClosest(target, (node) => {
      try {
        return Boolean(node && typeof node.getAttribute === "function" && node.getAttribute("data-key"));
      } catch (error) {
        return false;
      }
    });
    if (!keyed) return;
    const key = keyed.getAttribute("data-key");
    if (key) statsLanesMarkHot(lane, [key]);
  });
  lane.addEventListener("pointerleave", () => {
    statsLanesClearHot(lane);
  });
}

function statsLanesActivate(node, action) {
  if (!node || typeof node.addEventListener !== "function") return;
  const invoke = (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (typeof action === "function") action();
  };
  node.addEventListener("click", invoke);
  node.addEventListener("keydown", (event) => {
    if (!event || (event.key !== "Enter" && event.key !== " ")) return;
    invoke(event);
  });
}

function statsLanesActivateBar(node, action) {
  if (!node || typeof node.addEventListener !== "function") return;
  node.addEventListener("click", () => {
    if (typeof action === "function") action();
  });
}

function statsWindowLanesPaintLegend(doc, laneModel, laneName, skeleton) {
  const legend = statsEl(doc, "span", { class: "bob-day-strip-legend" });
  const entries = skeleton
    ? [
      { label: "Area", legendLabel: "Area", display: "0m", rank: 1 },
      { label: "Area", legendLabel: "Area", display: "0m", rank: 2 },
      { label: "Area", legendLabel: "Area", display: "0m", rank: 3 },
    ]
    : (laneModel && Array.isArray(laneModel.legend) ? laneModel.legend : []);
  for (const entry of entries) {
    const item = dayStripLegendItem(doc, entry, laneName);
    if (!skeleton && entry && typeof entry.rank === "number" && entry.rank > 3 && item) {
      item.setAttribute("hidden", "true");
    }
    dayStripAppend(legend, item);
  }
  if (laneName !== "themes") {
    const empty = statsEl(doc, "span", { class: "bob-day-strip-no-pomodoros" }, "no Pomodoros");
    if (!skeleton && !(laneModel && laneModel.empty) && empty) empty.setAttribute("hidden", "true");
    dayStripAppend(legend, empty);
  }
  const overflowInfo = (laneModel && laneModel.overflowDefault) || { count: Math.max(0, entries.length - 3), title: "" };
  dayStripAppend(legend, dayStripOverflowCounter(doc, overflowInfo, skeleton));
  return legend;
}

function statsWindowLanesPaintBar(doc, laneModel, laneName, oldPairs, morph) {
  const themes = laneName === "themes";
  const bar = statsEl(doc, "div", {
    class: "bob-stats-lane-bar" + (themes ? " bob-stats-lane-themes" : ""),
    "aria-hidden": "true",
  });
  if (!bar) return bar;
  const segments = laneModel && Array.isArray(laneModel.segments) ? laneModel.segments : [];
  for (const segment of segments) {
    if (!segment || !timeLanePositive(segment.value)) continue;
    const hueClass = themes
      ? " bob-day-strip-theme-hue-" + segment.hue
      : " bob-day-strip-hue-" + segment.hue;
    const part = statsEl(doc, "span", {
      class: "bob-stats-lane-segment" + hueClass,
      title: segment.title || (segment.label + " · " + segment.display),
      "data-key": segment.key,
      "data-tone": segment.tone || "hue",
    });
    if (part && themes && typeof segment.shade === "number" && segment.shade > 0) {
      part.setAttribute("data-shade", String(segment.shade));
    }
    const start = morph ? statsLanesOldValue(oldPairs, segment.key) : segment.value;
    statsLanesSetGrow(part, start === null || start === undefined ? 0 : start);
    if (!morph) statsLanesSetGrow(part, segment.value);
    dayStripAppend(bar, part);
  }
  return bar;
}

function statsWindowLanesPaintLane(doc, model, laneName, handlers, memory, morph) {
  const laneModel = laneName === "themes" ? model.themes : model.roots;
  if (!laneModel || laneModel.omitted) return null;
  const lane = statsEl(doc, "div", {
    class: "bob-stats-lane",
    "data-lane": laneName,
  });
  const row = statsEl(doc, "div", { class: "bob-stats-lane-row" });
  const legendWrap = statsEl(doc, "span", {
    class: "bob-stats-lane-legend",
    role: "button",
    tabindex: "0",
    "data-stats-focus-key": laneName === "themes" ? "lanes-themes" : "lanes-roots",
    "aria-label": laneModel.ariaLabel || laneModel.sentence,
  });
  dayStripAppend(legendWrap, statsWindowLanesPaintLegend(doc, laneModel, laneName, false));
  statsLanesActivate(legendWrap, () => {
    if (typeof handlers.activate === "function") handlers.activate(laneModel.panelView);
  });
  dayStripAppend(row, legendWrap);
  const firstShown = (laneName === "roots" && !laneModel.omitted)
    || (laneName === "themes" && model.roots && model.roots.omitted);
  if (firstShown && model.meta && model.meta.text) {
    dayStripAppend(row, statsEl(doc, "span", {
      class: "bob-stats-lane-meta",
      title: model.meta.title || null,
    }, model.meta.text));
  }
  dayStripAppend(lane, row);
  const oldPairs = memory && (laneName === "themes" ? memory.themes : memory.roots);
  const bar = statsWindowLanesPaintBar(doc, laneModel, laneName, oldPairs, morph);
  statsLanesActivateBar(bar, () => {
    if (typeof handlers.activate === "function") handlers.activate(laneModel.panelView);
  });
  dayStripAppend(lane, bar);
  statsLanesBindHover(lane);
  return lane;
}

function statsWindowLanesApplyFinalGrow(host, model) {
  const apply = (laneName, laneModel) => {
    if (!laneModel || laneModel.omitted) return;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      try {
        if (statsLanesHasClass(node, "bob-stats-lane-segment")) {
          const key = node.getAttribute && node.getAttribute("data-key");
          const segment = (laneModel.segments || []).find((item) => item.key === key);
          if (segment) statsLanesSetGrow(node, segment.value);
        }
      } catch (error) {
        // Best-effort.
      }
      const children = node.children || [];
      for (const child of children) visit(child);
    };
    const lanes = host && host.children ? host.children : [];
    for (const child of lanes) {
      try {
        if (child && child.getAttribute && child.getAttribute("data-lane") === laneName) visit(child);
      } catch (error) {
        // Best-effort.
      }
    }
  };
  apply("roots", model.roots);
  apply("themes", model.themes);
}

function paintStatsWindowLanes(host, model, handlers, memory) {
  if (!host || !model || model.state === "omitted") return host;
  try {
    if (typeof host.replaceChildren === "function") {
      host.replaceChildren();
    } else {
      host.textContent = "";
    }
  } catch (error) {
    try {
      host.textContent = "";
    } catch (inner) {
      // Best-effort.
    }
  }
  try {
    host.setAttribute("class", "bob-stats-lanes");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", model.ariaLabel || "Where the time went");
  } catch (error) {
    // Best-effort.
  }
  const morph = statsLanesShouldMorph(host, model, memory);
  const safeHandlers = handlers && typeof handlers === "object" ? handlers : {};
  const roots = statsWindowLanesPaintLane(host.ownerDocument || (typeof document !== "undefined" ? document : null), model, "roots", safeHandlers, memory, morph);
  const themes = statsWindowLanesPaintLane(host.ownerDocument || (typeof document !== "undefined" ? document : null), model, "themes", safeHandlers, memory, morph);
  dayStripAppend(host, roots);
  dayStripAppend(host, themes);
  if (morph) {
    try {
      const classes = statsLanesClassList(host);
      if (!classes.includes("bob-stats-lanes-morph")) classes.push("bob-stats-lanes-morph");
      host.setAttribute("class", classes.join(" "));
    } catch (error) {
      // Best-effort.
    }
    const raf = statsLanesRaf(host);
    raf(() => {
      statsWindowLanesApplyFinalGrow(host, model);
    });
  }
  return host;
}

function statsWindowLanesSkeleton(doc) {
  const host = statsEl(doc, "div", {
    class: "bob-stats-lanes bob-stats-lanes-skeleton",
    role: "group",
    "aria-label": "Where the time went",
    "aria-hidden": "true",
  });
  for (const laneName of ["roots", "themes"]) {
    const lane = statsEl(doc, "div", { class: "bob-stats-lane", "data-lane": laneName });
    const row = statsEl(doc, "div", { class: "bob-stats-lane-row" });
    dayStripAppend(row, statsWindowLanesPaintLegend(doc, null, laneName, true));
    dayStripAppend(lane, row);
    dayStripAppend(lane, statsEl(doc, "div", {
      class: "bob-stats-lane-bar",
      "aria-hidden": "true",
    }));
    dayStripAppend(host, lane);
  }
  return host;
}

class BobLedgerToolsStatsLanesMixin {
  statsWindowLanes(doc, view, report) {
    try {
      const fallback = typeof this.pomodoroThemeHueFor === "function"
        ? (themeKey, name) => this.pomodoroThemeHueFor(themeKey, name)
        : null;
      const model = typeof statsWindowLanesModel === "function"
        ? statsWindowLanesModel(report, { themeHueFor: fallback })
        : null;
      if (!model || model.state === "omitted") return null;
      const host = statsEl(doc, "div", {
        class: "bob-stats-lanes",
        role: "group",
        "aria-label": model.ariaLabel || "Where the time went",
      });
      if (!host) return null;
      paintStatsWindowLanes(host, model, {
        activate: (panelView) => this.statsWindowLanesActivate(view, panelView),
      }, view && view.statsLanesMemory);
      if (view) {
        view.statsLanesMemory = {
          windowKey: model.windowKey,
          roots: statsLanesMemoryPairs(model.roots),
          themes: statsLanesMemoryPairs(model.themes),
        };
        view.statsLanesHost = host;
      }
      try {
        if (typeof dayStripFitLegend === "function") dayStripFitLegend(host);
      } catch (error) {
        // Fit is best-effort.
      }
      try {
        if (typeof dayStripEnsureFitObserver === "function") dayStripEnsureFitObserver(host);
      } catch (error) {
        // Observer is best-effort.
      }
      return host;
    } catch (error) {
      return null;
    }
  }

  statsWindowLanesActivate(view, panelView) {
    try {
      const state = this.statsViewStateFor(view && view.sourcePath);
      state.focus = "worked";
      state.homesView = panelView === "areas" || panelView === "themes" ? panelView : "roots";
      state.pinnedDay = null;
      state.pinnedBucket = null;
      state.revealPanel = "homes";
      this.statsRenderLocally(view, "panel-home-view-" + state.homesView);
    } catch (error) {
      // Activation is best-effort.
    }
  }
}
