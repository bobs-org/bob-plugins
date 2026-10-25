// DOM painter for the daily-note Day strip. The host element remains
// stable; each update replaces only its children from the current model.
// Interactive targets are spans with role="link": Obsidian's global
// button rules must never be able to resize the strip again.
function dayStripLink(doc, className, label, title) {
  return statsEl(doc, "span", {
    class: className,
    role: "link",
    tabindex: "0",
    title: title || null,
    "aria-label": label,
  });
}

function dayStripAppend(parent, child) {
  if (parent && child && typeof parent.appendChild === "function") parent.appendChild(child);
  return child;
}

function dayStripActivate(node, action) {
  if (!node || typeof node.addEventListener !== "function") return;
  const invoke = (event, forcedNewLeaf) => {
    if (event && event.preventDefault && event.type === "mousedown") event.preventDefault();
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    if (typeof action === "function") action(newLeaf);
  };
  node.addEventListener("mousedown", (event) => {
    // A click never steals focus from the editor, so vim keeps working.
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", (event) => {
    invoke(event, false);
  });
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

function dayStripRenderFact(doc, fact, model, handlers) {
  const skeleton = model.state === "skeleton";
  const node = dayStripLink(
    doc,
    "bob-day-strip-fact" + (skeleton ? " bob-day-strip-fact-skeleton" : ""),
    skeleton ? fact.label + ", loading" : fact.label + " " + fact.display,
    fact.tooltip,
  );
  if (node) node.setAttribute("data-day-strip-metric", fact.id);
  dayStripAppend(node, statsEl(doc, "span", { class: "bob-day-strip-label" }, fact.label));
  dayStripAppend(node, statsEl(doc, "span", {
    class: "bob-day-strip-value" + (fact.display === "–" && !skeleton ? " bob-day-strip-value-empty" : "") + (skeleton ? " bob-day-strip-value-skeleton" : ""),
    title: fact.quality === "not_tracked" && fact.since ? "Tracking since " + fact.since : null,
  }, fact.display));
  if (fact.warning && !skeleton) {
    dayStripAppend(node, statsEl(doc, "span", {
      class: "bob-day-strip-warning",
      title: fact.warning,
      "aria-hidden": "true",
    }, "⚠"));
  }
  dayStripActivate(node, (newLeaf) => {
    if (typeof handlers.openStats === "function") {
      handlers.openStats({ day: model.day, metric: fact.id, newLeaf });
    }
  });
  return node;
}

function dayStripLegendItem(doc, entry) {
  const item = statsEl(doc, "span", {
    class: "bob-day-strip-legend-item",
    title: entry ? entry.label + " " + entry.display : null,
  });
  const dot = statsEl(doc, "span", {
    class: "bob-day-strip-legend-dot" + (entry ? " bob-day-strip-hue-" + entry.hue : ""),
    "aria-hidden": "true",
  });
  dayStripAppend(item, dot);
  dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-label" }, entry ? entry.label : ""));
  dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-value" }, entry ? entry.display : ""));
  if (!entry) item.setAttribute("hidden", "true");
  return item;
}

// Fixed slots (8 bar segments, 3 legend items) keep the skeleton and the
// loaded strip structurally identical; missing slots stay hidden.
function dayStripRenderMix(doc, model, handlers) {
  const mix = model.mix || { segments: [], legend: [], overflow: [], omitted: true };
  const skeleton = model.state === "skeleton";
  const node = dayStripLink(doc, "bob-day-strip-mix", "Time by area", mix.title);
  const bar = statsEl(doc, "span", {
    class: "bob-day-strip-mix-bar",
    "aria-hidden": "true",
  });
  const segments = skeleton ? [] : Array.isArray(mix.segments) ? mix.segments : [];
  const slots = Math.max(8, segments.length);
  for (let index = 0; index < slots; index += 1) {
    const segment = segments[index];
    const part = statsEl(doc, "span", {
      class: "bob-day-strip-mix-segment" + (segment ? " bob-day-strip-hue-" + segment.hue : "") + (segment && segment.bucket ? " bob-day-strip-mix-bucket" : ""),
      title: segment ? segment.label + " " + segment.display : null,
    });
    if (part && part.style && segment) part.style.flexGrow = String(Math.max(0, Number(segment.value) || 0));
    if (!segment) part.setAttribute("hidden", "true");
    dayStripAppend(bar, part);
  }
  dayStripAppend(node, bar);

  const legend = statsEl(doc, "span", { class: "bob-day-strip-legend" });
  const entries = skeleton
    ? [{ label: "Area", display: "0m" }, { label: "Area", display: "0m" }, { label: "Area", display: "0m" }]
    : Array.isArray(mix.legend) ? mix.legend : [];
  for (let index = 0; index < 3; index += 1) {
    dayStripAppend(legend, dayStripLegendItem(doc, skeleton ? entries[index] : entries[index] || null));
  }
  const noPomodoros = statsEl(doc, "span", { class: "bob-day-strip-no-pomodoros" }, "no Pomodoros");
  if (!mix.empty && !skeleton) noPomodoros.setAttribute("hidden", "true");
  dayStripAppend(legend, noPomodoros);
  const overflow = statsEl(doc, "span", {
    class: "bob-day-strip-overflow",
    title: mix.overflow && mix.overflow.length ? mix.overflow.map((segment) => segment.label + " " + segment.display).join("\n") : null,
  }, mix.overflow && mix.overflow.length && !skeleton ? "+" + mix.overflow.length : "+N");
  if (!mix.overflow || !mix.overflow.length || skeleton) overflow.setAttribute("hidden", "true");
  dayStripAppend(legend, overflow);
  dayStripAppend(node, legend);
  dayStripActivate(node, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, metric: "worked", panel: "homes", newLeaf });
  });
  return node;
}

function dayStripRenderMixRow(doc, model, handlers) {
  const mix = model.mix || { omitted: true };
  const skeleton = model.state === "skeleton";
  const showMix = skeleton || !mix.omitted;
  const showMeta = skeleton || Boolean(model.metaText);
  if (!showMix && !showMeta) return null;
  const row = statsEl(doc, "div", { class: "bob-day-strip-mix-row" });
  if (showMix) dayStripAppend(row, dayStripRenderMix(doc, model, handlers));
  if (showMeta) {
    dayStripAppend(row, statsEl(doc, "span", {
      class: "bob-day-strip-meta",
      title: model.stale && model.staleTitle ? model.staleTitle : null,
    }, skeleton ? "so far · 00:00" : model.metaText));
  }
  return row;
}

function dayStripRenderUnavailable(doc, model, handlers) {
  const line = statsEl(doc, "div", { class: "bob-day-strip-unavailable" });
  const error = model.error || { title: "bob stats failed", hint: "" };
  const message = error.code === "bob-not-found"
    ? "Day stats unavailable — bob was not found. Set stats.bob_path."
    : "Day stats unavailable — " + error.title + ".";
  dayStripAppend(line, statsEl(doc, "span", { class: "bob-day-strip-unavailable-message" }, message));
  const retry = dayStripLink(doc, "bob-day-strip-retry", "Retry Day stats");
  dayStripAppend(retry, statsEl(doc, "span", {}, "Retry"));
  dayStripActivate(retry, () => {
    if (typeof handlers.retry === "function") handlers.retry();
  });
  dayStripAppend(line, retry);
  return line;
}

function paintDayStrip(el, model, handlers) {
  if (!el || !model) return el;
  const safeModel = model && typeof model === "object" ? model : {};
  const safeHandlers = handlers && typeof handlers === "object" ? handlers : {};
  const doc = statsDocFor(el);
  if (!doc) return el;
  try {
    if (typeof el.replaceChildren === "function") el.replaceChildren();
    else if (Array.isArray(el.children)) {
      for (const child of el.children) child.parentNode = null;
      el.children.length = 0;
      el.textContent = "";
    } else el.textContent = "";
    const state = ["ready", "skeleton", "unavailable", "future", "hidden"].includes(safeModel.state) ? safeModel.state : "hidden";
    const classes = ["bob-day-strip", "bob-day-strip-state-" + state];
    if (safeModel.stale) classes.push("bob-day-strip-stale");
    if (safeModel.provisional) classes.push("bob-day-strip-provisional");
    if (el.setAttribute) {
      el.setAttribute("class", classes.join(" "));
      el.setAttribute("data-day", safeModel.day || "");
      if (state === "ready" || state === "skeleton") {
        el.setAttribute("role", "group");
        el.setAttribute("aria-label", safeModel.ariaLabel || "Day stats for " + safeModel.day);
      } else {
        el.removeAttribute("role");
        el.removeAttribute("aria-label");
      }
    }
    if (state === "hidden" || state === "future") return el;
    if (state === "unavailable") {
      dayStripAppend(el, dayStripRenderUnavailable(doc, safeModel, safeHandlers));
      return el;
    }

    const facts = statsEl(doc, "div", { class: "bob-day-strip-facts" });
    for (const fact of safeModel.facts || []) dayStripAppend(facts, dayStripRenderFact(doc, fact, safeModel, safeHandlers));
    dayStripAppend(el, facts);
    const mixRow = dayStripRenderMixRow(doc, safeModel, safeHandlers);
    if (mixRow) dayStripAppend(el, mixRow);
    return el;
  } catch (error) {
    // A failed paint must not escape into Obsidian's render lifecycle.
    return el;
  }
}
