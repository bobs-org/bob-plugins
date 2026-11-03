// DOM painter for the week member of the period stats strip. The host element
// stays stable; each update replaces only its children from the current model.
// Interactive targets are spans with role="link": Obsidian's global button rules
// must never be able to resize the strip again. Facts and lanes reuse the Day
// strip's shared builders; the parts row is painted by
// `paintPeriodStripParts`.
function periodStripLink(doc, className, label, title) {
  return statsEl(doc, "span", {
    class: className,
    role: "link",
    tabindex: "0",
    title: title || null,
    "aria-label": label,
  });
}

function periodStripActivate(node, action) {
  if (!node || typeof node.addEventListener !== "function") return;
  const invoke = (event, forcedNewLeaf) => {
    if (event && event.preventDefault && event.type === "mousedown") event.preventDefault();
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    if (typeof action === "function") action(newLeaf);
  };
  node.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", (event) => invoke(event, false));
  node.addEventListener("auxclick", (event) => {
    if (event && event.button === 1) {
      if (event.preventDefault) event.preventDefault();
      invoke(event, true);
    }
  });
  node.addEventListener("keydown", (event) => {
    if (!event || (event.key !== "Enter" && event.key !== " ")) return;
    if (event.preventDefault) event.preventDefault();
    invoke(event, false);
  });
}

function periodStripRefMark(doc, mark) {
  if (mark !== "above" && mark !== "below" && mark !== "equal") return null;
  if (typeof dayStripRenderRefMark === "function") {
    try {
      const host = { facts: [{ ref: { mark } }] };
      void host;
    } catch (error) {
      // Fall through to the local mark.
    }
  }
  const svg = statsSvgEl(doc, "svg", {
    class: "bob-period-strip-ref-mark",
    viewBox: "0 0 10 10",
    "aria-hidden": "true",
    focusable: "false",
  });
  if (!svg) return null;
  const append = (child) => {
    try {
      if (svg.appendChild && child) svg.appendChild(child);
    } catch (error) {
      // Best-effort.
    }
  };
  if (mark === "above") append(statsSvgEl(doc, "path", { d: "M5 1.6 L8.8 8 H1.2 Z" }));
  else if (mark === "below") append(statsSvgEl(doc, "path", { d: "M1.2 2 H8.8 L5 8.4 Z" }));
  else append(statsSvgEl(doc, "path", { d: "M1.5 2.9h7v1.5h-7z M1.5 5.6h7v1.5h-7z" }));
  return svg;
}

function periodStripRenderRef(doc, fact) {
  const ref = fact && fact.ref && typeof fact.ref === "object" ? fact.ref : { state: "blank" };
  const state = ref.state === "ready" || ref.state === "short" ? ref.state : "blank";
  const node = statsEl(doc, "span", { class: "bob-period-strip-ref", "aria-hidden": "true" });
  if (!node) return null;
  if (node.setAttribute) {
    node.setAttribute("data-ref-state", state);
    if (ref.mark) node.setAttribute("data-ref-mark", ref.mark);
  }
  if (state === "ready" || state === "short") {
    if (state === "ready") {
      const markNode = periodStripRefMark(doc, ref.mark);
      if (markNode && node.appendChild) node.appendChild(markNode);
    }
    if (node.appendChild) {
      node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-ref-word" }, "typical"));
      node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-ref-num" }, ref.display));
    }
  }
  return node;
}

function periodStripRenderFact(doc, fact, model, handlers) {
  const skeleton = model.state === "skeleton";
  const node = periodStripLink(
    doc,
    "bob-period-strip-fact" + (skeleton ? " bob-period-strip-fact-skeleton" : ""),
    fact.ariaLabel || (skeleton ? fact.label + ", loading" : fact.label + " " + fact.display),
    fact.tooltip,
  );
  if (!node) return null;
  if (node.setAttribute) node.setAttribute("data-period-strip-metric", fact.id);
  const head = statsEl(doc, "span", { class: "bob-period-strip-head" });
  if (head) {
    head.appendChild(statsEl(doc, "span", { class: "bob-period-strip-label" }, fact.label));
    node.appendChild(head);
  }
  const runs = typeof dayStripValueRuns === "function" ? dayStripValueRuns(fact.display) : [{ kind: "word", text: fact.display }];
  const isWord = runs.length === 1 && runs[0].kind === "word";
  const value = statsEl(doc, "span", {
    class: "bob-period-strip-value"
      + (fact.display === "–" && !skeleton ? " bob-period-strip-value-empty" : isWord ? " bob-period-strip-value-word" : "")
      + (skeleton ? " bob-period-strip-value-skeleton" : ""),
  });
  if (value) {
    for (const run of runs) {
      value.appendChild(statsEl(doc, "span", { class: "bob-period-strip-" + run.kind }, run.text));
    }
    if (fact.soFar) value.appendChild(statsEl(doc, "span", { class: "bob-period-strip-so-far", "aria-hidden": "true" }, " so far"));
    node.appendChild(value);
  }
  const ref = periodStripRenderRef(doc, fact);
  if (ref) node.appendChild(ref);
  periodStripActivate(node, (newLeaf) => {
    if (handlers && typeof handlers.openStats === "function") {
      handlers.openStats({ metric: fact.id, panel: undefined, newLeaf });
    }
  });
  const hint = periodStripRenderOffClock(doc, fact, model, handlers);
  if (hint) {
    const wrap = statsEl(doc, "div", { class: "bob-period-strip-fact-wrap" });
    if (!wrap) return node;
    wrap.appendChild(node);
    wrap.appendChild(hint);
    return wrap;
  }
  return node;
}

function periodStripRenderOffClock(doc, fact, model, handlers) {
  try {
    if (!fact || fact.id !== "worked" || model.state === "skeleton") return null;
    const off = fact.offClock && typeof fact.offClock === "object" ? fact.offClock : null;
    const display = off && typeof off.display === "string" ? off.display.trim() : "";
    const value = off && typeof off.value === "number" ? off.value : 0;
    if (!display || !(value > 0)) return null;
    const label = "Off-clock " + display + " in " + (model.periodId || "this week") + ", open Stats";
    const node = periodStripLink(doc, "bob-period-strip-hint", label, "Open Stats on " + (model.periodId || "this week") + " off-clock");
    if (!node) return null;
    if (node.setAttribute) node.setAttribute("data-period-strip-hint", "worked");
    node.appendChild(statsEl(doc, "span", { class: "bob-period-strip-hint-text" }, "◌ +" + display + " off-clock"));
    periodStripActivate(node, (newLeaf) => {
      if (handlers && typeof handlers.openStats === "function") {
        handlers.openStats({ metric: "worked", panel: "homes", clock: "off-clock", newLeaf });
      }
    });
    return node;
  } catch (error) {
    return null;
  }
}

function periodStripLegendItem(doc, entry, lane) {
  const rank = entry && typeof entry.rank === "number" ? entry.rank : 0;
  const key = entry && typeof entry.key === "string" ? entry.key : "";
  const text = entry ? ((typeof entry.legendLabel === "string" && entry.legendLabel) || entry.label || "") : "";
  const title = entry && typeof entry.title === "string" && entry.title ? entry.title : (entry ? entry.label + " " + entry.display : null);
  const item = statsEl(doc, "span", { class: "bob-period-strip-legend-item", title });
  if (!item) return null;
  if (rank) item.setAttribute("data-rank", String(rank));
  if (key) item.setAttribute("data-key", key);
  const themes = lane === "themes";
  const markClass = themes
    ? "bob-period-strip-legend-swatch" + (entry ? " bob-period-strip-theme-hue-" + entry.hue : "")
    : "bob-period-strip-legend-dot" + (entry ? " bob-period-strip-hue-" + entry.hue : "");
  const mark = statsEl(doc, "span", { class: markClass, "aria-hidden": "true" });
  if (mark && themes && entry && typeof entry.shade === "number" && entry.shade > 0) mark.setAttribute("data-shade", String(entry.shade));
  if (mark && entry && typeof entry.tone === "string" && entry.tone) mark.setAttribute("data-tone", entry.tone);
  item.appendChild(mark);
  item.appendChild(statsEl(doc, "span", { class: "bob-period-strip-legend-label" }, text || ""));
  item.appendChild(statsEl(doc, "span", { class: "bob-period-strip-legend-value" }, entry ? entry.display : ""));
  if (!entry) item.setAttribute("hidden", "true");
  return item;
}

function periodStripRenderMix(doc, model, handlers, lane) {
  const mix = lane === "themes" ? model.themes : model.roots;
  const skeleton = model.state === "skeleton";
  const sentence = lane === "themes" ? "Time by type" : "Time by root parent";
  const node = periodStripLink(doc, "bob-period-strip-mix", sentence, (mix && mix.title) || sentence);
  if (!node) return null;
  const legend = statsEl(doc, "span", { class: "bob-period-strip-legend" });
  if (legend) {
    const entries = (mix && Array.isArray(mix.legend) ? mix.legend : []).slice(0, 3);
    for (const entry of entries) {
      const item = periodStripLegendItem(doc, entry, lane);
      if (item) legend.appendChild(item);
    }
    const overflow = mix && mix.overflowDefault && typeof mix.overflowDefault.count === "number" ? mix.overflowDefault.count : 0;
    if (overflow > 0 && !skeleton) {
      legend.appendChild(statsEl(doc, "span", { class: "bob-period-strip-overflow", title: (mix.overflowDefault && mix.overflowDefault.title) || null }, "+" + overflow));
    }
    node.appendChild(legend);
  }
  periodStripActivate(node, (newLeaf) => {
    if (handlers && typeof handlers.openStats === "function") {
      handlers.openStats({ metric: "worked", panel: lane === "themes" ? "themes" : "homes", newLeaf });
    }
  });
  return node;
}

// Paint the week member: facts, typical lines, meta + lanes switch on the top
// row, both lanes, then the seven-day parts row. No cards, borders,
// backgrounds, shadows, or buttons; hue appears only in bars and stacks.
// Never throws.
function paintPeriodStrip(host, model, handlers) {
  try {
    if (!host || !model) return null;
    const doc = host.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const root = statsEl(doc, "div", {
      class: "bob-period-strip bob-period-strip-kind-week bob-period-strip-state-" + model.state,
      "aria-label": model.ariaLabel || ("Week stats for " + (model.periodId || "week")),
    });
    if (!root) return null;
    host.appendChild(root);
    if (model.state === "hidden") return root;
    if (model.state === "future") {
      const line = statsEl(doc, "div", { class: "bob-period-strip-future" }, "Starts " + periodStripFutureWords(model));
      if (line) root.appendChild(line);
      return root;
    }
    if (model.state === "older-bob") {
      const line = statsEl(doc, "div", { class: "bob-period-strip-note" }, "Period stats need a newer bob (bob periods not found).");
      if (line) root.appendChild(line);
      return root;
    }
    if (model.state === "queued") {
      const line = statsEl(doc, "div", { class: "bob-period-strip-note" }, "Quarter, year, and all-time strips arrive with the parts phase.");
      if (line) root.appendChild(line);
      return root;
    }
    if (model.state === "unavailable") {
      const error = model.error || {};
      const line = statsEl(doc, "div", { class: "bob-period-strip-note" }, "Period stats unavailable — " + (error.title || "bob periods failed") + ".");
      if (line) root.appendChild(line);
      if (error.hint) {
        const retry = periodStripLink(doc, "bob-period-strip-retry", "Retry period stats", error.hint);
        if (retry) {
          retry.appendChild(statsEl(doc, "span", {}, "Retry"));
          periodStripActivate(retry, () => {
            if (handlers && typeof handlers.retry === "function") handlers.retry();
          });
          root.appendChild(retry);
        }
      } else {
        const retry = periodStripLink(doc, "bob-period-strip-retry", "Retry period stats", "Retry");
        if (retry) {
          retry.appendChild(statsEl(doc, "span", {}, "Retry"));
          periodStripActivate(retry, () => {
            if (handlers && typeof handlers.retry === "function") handlers.retry();
          });
          root.appendChild(retry);
        }
      }
      return root;
    }
    const facts = statsEl(doc, "div", { class: "bob-period-strip-facts" });
    if (facts) {
      for (const fact of model.facts || []) {
        const node = periodStripRenderFact(doc, fact, model, handlers || {});
        if (node) facts.appendChild(node);
      }
      root.appendChild(facts);
    }
    const lanesRow = statsEl(doc, "div", { class: "bob-period-strip-lanes-row" });
    if (lanesRow) {
      if (model.metaText) lanesRow.appendChild(statsEl(doc, "span", { class: "bob-period-strip-meta" }, model.metaText));
      if (model.stale) lanesRow.appendChild(statsEl(doc, "span", { class: "bob-period-strip-stale", title: model.staleTitle || "Refresh failed" }, "refresh failed"));
      const shown = (model.lanes && Array.isArray(model.lanes.shown) ? model.lanes.shown : ["roots", "themes"]);
      for (const lane of shown) {
        const node = periodStripRenderMix(doc, model, handlers || {}, lane);
        if (node) lanesRow.appendChild(node);
      }
      const view = model.lanes && typeof model.lanes.view === "string" ? model.lanes.view : "both";
      const switchable = Boolean(model.lanes && model.lanes.switchable);
      if (switchable) {
        const sw = statsEl(doc, "span", {
          class: "bob-period-strip-lanes-switch",
          role: "button",
          tabindex: "0",
          title: (model.lanes && model.lanes.title) || "Cycle period bars",
          "aria-label": (model.lanes && model.lanes.ariaLabel) || "Period stats bars",
          "data-view": view,
        });
        if (sw) {
          const activate = () => {
            if (handlers && typeof handlers.cycleLanes === "function") handlers.cycleLanes({});
          };
          sw.addEventListener("mousedown", (event) => {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
          });
          sw.addEventListener("click", activate);
          sw.addEventListener("keydown", (event) => {
            if (!event || (event.key !== "Enter" && event.key !== " ")) return;
            if (event.preventDefault) event.preventDefault();
            activate();
          });
          lanesRow.appendChild(sw);
        }
      }
      root.appendChild(lanesRow);
    }
    const partsHost = statsEl(doc, "div", { class: "bob-period-strip-parts-host" });
    if (partsHost) {
      root.appendChild(partsHost);
      try {
        paintPeriodStripParts(doc, partsHost, model, {
          openColumn: (column, newLeaf) => {
            if (handlers && typeof handlers.openColumn === "function") handlers.openColumn(column, newLeaf);
          },
          openStatsForColumn: (column, newLeaf) => {
            if (handlers && typeof handlers.openStatsForColumn === "function") handlers.openStatsForColumn(column, newLeaf);
          },
        });
      } catch (error) {
        // Parts are best-effort; facts and lanes already painted.
      }
    }
    return root;
  } catch (error) {
    return null;
  }
}

function periodStripFutureWords(model) {
  try {
    const period = model && typeof model.period === "object" ? model.period : {};
    const start = typeof period.start === "string" ? period.start : "";
    const parts = dayStripDateParts(start);
    if (!parts) return "soon";
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return weekdays[parts.value.getDay()] + " " + months[parts.month - 1] + " " + parts.date;
  } catch (error) {
    return "soon";
  }
}
