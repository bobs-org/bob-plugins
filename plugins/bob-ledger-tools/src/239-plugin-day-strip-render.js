// DOM painter for the daily-note Day strip. The host element remains
// stable; each update replaces only its children from the current model.
// Interactive targets are spans with role="link": Obsidian's global
// button rules must never be able to resize the strip again.
// Last ready-paint marks per host, so a pending→met flip on the same
// day can draw the check in once. Skeleton and non-ready paints never
// write it.
const dayStripMarkMemory = new WeakMap();
// Last {day, view, shown} per host for the lane-enter animation. Written
// only on ready paints (stale included); skeleton and other states never
// write it, so skeleton to ready never animates.
const dayStripLaneMemory = new WeakMap();
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

// Lane-switch activation: click, Enter, and Space advance the cycle once.
// The handler learns whether the switch had keyboard focus from the
// document's active element. A click never steals editor focus, and
// Ctrl/Cmd and middle-click do nothing special. Never a <button>.
function dayStripLanesSwitchActivate(node, doc, handlers) {
  if (!node || typeof node.addEventListener !== "function") return;
  const isFocused = () => {
    try {
      return Boolean(doc) && doc.activeElement === node;
    } catch (error) {
      return false;
    }
  };
  node.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  node.addEventListener("click", () => {
    try {
      if (typeof handlers.cycleLanes === "function") handlers.cycleLanes({ focused: isFocused() });
    } catch (error) {
      // Switching is best-effort.
    }
  });
  node.addEventListener("keydown", (event) => {
    try {
      if (!event || (event.key !== "Enter" && event.key !== " ")) return;
      if (event.preventDefault) event.preventDefault();
      if (typeof handlers.cycleLanes === "function") handlers.cycleLanes({ focused: isFocused() });
    } catch (error) {
      // Switching is best-effort.
    }
  });
}

function dayStripRenderLanesSwitch(doc, model, handlers) {
  try {
    const lanes = model && model.lanes && typeof model.lanes === "object" ? model.lanes : null;
    const view = lanes && typeof lanes.view === "string" ? lanes.view : "both";
    const skeleton = model && model.state === "skeleton";
    const switchable = Boolean(lanes && lanes.switchable);
    if (!switchable && !skeleton) return null;
    if (skeleton && !switchable) {
      // Skeleton without two lanes still needs its geometry; the caller
      // only asks for the switch on the top row when lanes exist.
    }
    const rootsOn = view === "both" || view === "roots";
    const themesOn = view === "both" || view === "themes";
    const node = statsEl(doc, "span", { class: "bob-day-strip-lanes" });
    if (!node) return null;
    if (node.setAttribute) node.setAttribute("data-view", view);
    if (skeleton) {
      if (node.setAttribute) node.setAttribute("aria-hidden", "true");
      // Inert placeholder: no role, no tabindex, no listeners, hidden by CSS.
    } else {
      if (node.setAttribute) {
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", (lanes && lanes.ariaLabel) || "Day stats bars");
        node.setAttribute("title", (lanes && lanes.title) || "");
      }
      dayStripLanesSwitchActivate(node, doc, handlers || {});
    }
    const rootsMark = statsEl(doc, "span", {
      class: "bob-day-strip-lanes-mark bob-day-strip-lanes-mark-roots",
      "aria-hidden": "true",
    });
    if (rootsMark && rootsMark.setAttribute) rootsMark.setAttribute("data-on", rootsOn ? "true" : "false");
    dayStripAppend(node, rootsMark);
    const themesMark = statsEl(doc, "span", {
      class: "bob-day-strip-lanes-mark bob-day-strip-lanes-mark-themes",
      "aria-hidden": "true",
    });
    if (themesMark && themesMark.setAttribute) themesMark.setAttribute("data-on", themesOn ? "true" : "false");
    dayStripAppend(node, themesMark);
    return node;
  } catch (error) {
    return null;
  }
}

// Mouse-only activation for the full-width bar: a second target for the
// legend's action with no keyboard stop. Never a <button>.
function dayStripBarActivate(node, action) {
  if (!node || typeof node.addEventListener !== "function") return;
  const invoke = (event, forcedNewLeaf) => {
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    if (typeof action === "function") action(newLeaf);
  };
  node.addEventListener("mousedown", (event) => {
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
}

// Bob's numeric displays ("3h 05m", "45m", "12", "+3", "−5m", "75%")
// split into numeral and unit runs so the numerals carry the weight;
// any other display (words, "–") stays one word run. The runs only
// style bob's string: their joined text is always the display itself.
const DAY_STRIP_NUMERIC_DISPLAY = /^[+−-]?\d+(?:[.,]\d+)?[a-z%]*(?: \d+(?:[.,]\d+)?[a-z%]*)*$/;

function dayStripValueRuns(display) {
  const text = typeof display === "string" ? display : "";
  if (!text || !DAY_STRIP_NUMERIC_DISPLAY.test(text)) return [{ kind: "word", text }];
  const runs = [];
  const pattern = /([+−-]?\d+(?:[.,]\d+)?)|([a-z%]+)|( )/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[1]) runs.push({ kind: "num", text: match[1] });
    else if (match[2]) runs.push({ kind: "unit", text: match[2] });
    else runs.push({ kind: "space", text: match[3] });
  }
  return runs;
}

function dayStripRenderMark(doc, state) {
  const svg = statsSvgEl(doc, "svg", {
    class: "bob-day-strip-mark",
    viewBox: "0 0 16 16",
    "aria-hidden": "true",
    focusable: "false",
  });
  if (!svg) return null;
  dayStripAppend(svg, statsSvgEl(doc, "circle", {
    class: "bob-day-strip-mark-disc",
    cx: "8",
    cy: "8",
    r: "7.1",
  }));
  if (state === "pending") {
    dayStripAppend(svg, statsSvgEl(doc, "circle", {
      class: "bob-day-strip-mark-ring",
      cx: "8",
      cy: "8",
      r: "6.05",
      fill: "none",
    }));
    dayStripAppend(svg, statsSvgEl(doc, "path", {
      class: "bob-day-strip-mark-half",
      d: "M8 4.1A3.9 3.9 0 0 1 8 11.9Z",
    }));
  } else {
    dayStripAppend(svg, statsSvgEl(doc, "circle", {
      class: "bob-day-strip-mark-rim",
      cx: "8",
      cy: "8",
      r: "6.6",
      fill: "none",
    }));
    dayStripAppend(svg, statsSvgEl(doc, "path", {
      class: "bob-day-strip-mark-glyph",
      d: state === "met" ? "M4.75 8.35l2.1 2.1 4.4-4.65" : "M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8",
      fill: "none",
      pathLength: "1",
    }));
  }
  return svg;
}

function dayStripArriveIds(el, model) {
  const arriving = Object.create(null);
  if (!el || !model || model.state !== "ready" || model.stale) return arriving;
  let prev = null;
  try {
    prev = dayStripMarkMemory.get(el);
  } catch (error) {
    return arriving;
  }
  if (!prev || prev.day !== model.day || !prev.marks) return arriving;
  for (const fact of model.facts || []) {
    if (fact && fact.mark === "met" && prev.marks[fact.id] === "pending") arriving[fact.id] = true;
  }
  return arriving;
}

function dayStripRememberMarks(el, model) {
  if (!el || !model || model.state !== "ready") return;
  const marks = Object.create(null);
  for (const fact of model.facts || []) {
    if (fact && fact.id) marks[fact.id] = fact.mark || null;
  }
  try {
    dayStripMarkMemory.set(el, { day: model.day, marks });
  } catch (error) {
    // Host memory is best-effort.
  }
}

function dayStripRenderRefMark(doc, mark) {
  if (mark !== "above" && mark !== "below" && mark !== "equal") return null;
  const svg = statsSvgEl(doc, "svg", {
    class: "bob-day-strip-ref-mark",
    viewBox: "0 0 10 10",
    "aria-hidden": "true",
    focusable: "false",
  });
  if (!svg) return null;
  if (mark === "above") {
    dayStripAppend(svg, statsSvgEl(doc, "path", { d: "M5 1.6 L8.8 8 H1.2 Z" }));
  } else if (mark === "below") {
    dayStripAppend(svg, statsSvgEl(doc, "path", { d: "M1.2 2 H8.8 L5 8.4 Z" }));
  } else {
    dayStripAppend(svg, statsSvgEl(doc, "path", { d: "M1.5 2.9h7v1.5h-7z M1.5 5.6h7v1.5h-7z" }));
  }
  return svg;
}

function dayStripRenderRef(doc, fact) {
  const ref = fact && fact.ref && typeof fact.ref === "object" ? fact.ref : { state: "blank" };
  const state = ref.state === "ready" || ref.state === "short" ? ref.state : "blank";
  const node = statsEl(doc, "span", {
    class: "bob-day-strip-ref",
    "aria-hidden": "true",
  });
  if (!node) return null;
  if (node.setAttribute) {
    node.setAttribute("data-ref-state", state);
    if (ref.mark) node.setAttribute("data-ref-mark", ref.mark);
  }
  if (state === "ready" || state === "short") {
    if (state === "ready") {
      const markNode = dayStripRenderRefMark(doc, ref.mark);
      if (markNode) dayStripAppend(node, markNode);
    }
    dayStripAppend(node, statsEl(doc, "span", { class: "bob-day-strip-ref-word" }, "typical"));
    dayStripAppend(node, statsEl(doc, "span", { class: "bob-day-strip-ref-num" }, ref.display));
  }
  return node;
}

function dayStripRenderFact(doc, fact, model, handlers, arrive) {
  const skeleton = model.state === "skeleton";
  const node = dayStripLink(
    doc,
    "bob-day-strip-fact" + (skeleton ? " bob-day-strip-fact-skeleton" : ""),
    fact.ariaLabel || (skeleton ? fact.label + ", loading" : fact.label + " " + fact.display),
    fact.tooltip,
  );
  if (node) node.setAttribute("data-day-strip-metric", fact.id);
  const head = statsEl(doc, "span", { class: "bob-day-strip-head" });
  dayStripAppend(head, statsEl(doc, "span", { class: "bob-day-strip-label" }, fact.label));
  if (fact.warning && !skeleton) {
    dayStripAppend(head, statsEl(doc, "span", {
      class: "bob-day-strip-warning",
      title: fact.warning,
      "aria-hidden": "true",
    }, "⚠"));
  }
  dayStripAppend(node, head);
  const runs = dayStripValueRuns(fact.display);
  const markNode = fact.mark ? dayStripRenderMark(doc, fact.mark) : null;
  const skeletonMark = skeleton && fact.unit === "bool";
  const isWord = !markNode && !skeletonMark && runs.length === 1 && runs[0].kind === "word";
  const isEmpty = fact.display === "–" && !skeleton;
  const value = statsEl(doc, "span", {
    class: "bob-day-strip-value"
      + (isEmpty ? " bob-day-strip-value-empty" : isWord ? " bob-day-strip-value-word" : "")
      + (skeleton ? " bob-day-strip-value-skeleton" : "")
      + (markNode || skeletonMark ? " bob-day-strip-value-mark" : "")
      + (markNode && arrive ? " bob-day-strip-mark-arrive" : ""),
    title: fact.quality === "not_tracked" && fact.since ? "Tracking since " + fact.since : null,
  });
  if (markNode) {
    if (value && value.setAttribute) value.setAttribute("data-mark", fact.mark);
    dayStripAppend(value, markNode);
    dayStripAppend(value, statsEl(doc, "span", { class: "bob-day-strip-mark-text" }, fact.display));
  } else if (skeletonMark) {
    dayStripAppend(value, statsEl(doc, "span", { class: "bob-day-strip-mark-skeleton" }));
  } else {
    for (const run of runs) {
      dayStripAppend(value, statsEl(doc, "span", { class: "bob-day-strip-" + run.kind }, run.text));
    }
  }
  dayStripAppend(node, value);
  dayStripAppend(node, dayStripRenderRef(doc, fact));
  dayStripActivate(node, (newLeaf) => {
    if (typeof handlers.openStats === "function") {
      handlers.openStats({ day: model.day, metric: fact.id, newLeaf });
    }
  });
  return node;
}

function dayStripLegendItem(doc, entry, lane) {
  const rank = entry && typeof entry.rank === "number" ? entry.rank : 0;
  const key = entry && typeof entry.key === "string" ? entry.key : "";
  const text = entry
    ? (typeof entry.legendLabel === "string" && entry.legendLabel ? entry.legendLabel : entry.label)
    : "";
  const title = entry && typeof entry.title === "string" && entry.title
    ? entry.title
    : (entry ? entry.label + " " + entry.display : null);
  const item = statsEl(doc, "span", {
    class: "bob-day-strip-legend-item",
    title,
  });
  if (item) {
    if (rank) item.setAttribute("data-rank", String(rank));
    if (key) item.setAttribute("data-key", key);
  }
  const themes = lane === "themes";
  const markClass = themes
    ? "bob-day-strip-legend-swatch" + (entry ? " bob-day-strip-theme-hue-" + entry.hue : "")
    : "bob-day-strip-legend-dot" + (entry ? " bob-day-strip-hue-" + entry.hue : "");
  const mark = statsEl(doc, "span", {
    class: markClass,
    "aria-hidden": "true",
  });
  if (mark && themes && entry && typeof entry.shade === "number" && entry.shade > 0) {
    mark.setAttribute("data-shade", String(entry.shade));
  }
  if (mark && entry && typeof entry.tone === "string" && entry.tone) {
    mark.setAttribute("data-tone", entry.tone);
  }
  dayStripAppend(item, mark);
  dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-label" }, text || ""));
  dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-value" }, entry ? entry.display : ""));
  if (!entry) item.setAttribute("hidden", "true");
  return item;
}

function dayStripOverflowCounter(doc, info, skeleton) {
  const count = info && typeof info.count === "number" ? info.count : 0;
  const node = statsEl(doc, "span", {
    class: "bob-day-strip-overflow",
    title: info && info.title ? info.title : null,
  }, count > 0 && !skeleton ? "+" + count : "+N");
  if (!count || skeleton) node.setAttribute("hidden", "true");
  return node;
}

function dayStripLaneMix(model, lane) {
  if (lane === "themes") return model.themes || { segments: [], legend: [], overflow: [], omitted: true };
  return model.mix || { segments: [], legend: [], overflow: [], omitted: true };
}

function dayStripLaneSentence(mix, lane) {
  if (lane === "themes") return "Time by theme";
  return mix && mix.dimension === "area" ? "Time by area" : "Time by root parent";
}

function dayStripLanePanel(lane) {
  return lane === "themes" ? "themes" : "homes";
}

// The legend link: one item per segment in bar order plus one overflow
// counter. The static pre-fit state shows ranks 1-3 so a host that
// cannot measure keeps today's look; the fitter refines it.
function dayStripRenderMix(doc, model, handlers, lane) {
  const mix = dayStripLaneMix(model, lane);
  const skeleton = model.state === "skeleton";
  const sentence = dayStripLaneSentence(mix, lane);
  const node = dayStripLink(doc, "bob-day-strip-mix", sentence, mix.title);
  const legend = statsEl(doc, "span", { class: "bob-day-strip-legend" });
  const skeletonLabel = lane === "themes" ? "Theme" : "Area";
  const entries = skeleton
    ? [
      { label: skeletonLabel, legendLabel: skeletonLabel, display: "0m", rank: 1 },
      { label: skeletonLabel, legendLabel: skeletonLabel, display: "0m", rank: 2 },
      { label: skeletonLabel, legendLabel: skeletonLabel, display: "0m", rank: 3 },
    ]
    : Array.isArray(mix.legend) ? mix.legend : [];
  for (const entry of entries) {
    const item = dayStripLegendItem(doc, entry, lane);
    if (!skeleton && entry && typeof entry.rank === "number" && entry.rank > 3) {
      item.setAttribute("hidden", "true");
    }
    dayStripAppend(legend, item);
  }
  if (lane !== "themes") {
    const noPomodoros = statsEl(doc, "span", { class: "bob-day-strip-no-pomodoros" }, "no Pomodoros");
    if (!mix.empty && !skeleton) noPomodoros.setAttribute("hidden", "true");
    dayStripAppend(legend, noPomodoros);
  }
  const overflowInfo = mix.overflowDefault
    || { count: Math.max(0, entries.length - 3), title: "" };
  dayStripAppend(legend, dayStripOverflowCounter(doc, overflowInfo, skeleton));
  dayStripAppend(node, legend);
  const panel = dayStripLanePanel(lane);
  dayStripActivate(node, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, metric: "worked", panel, newLeaf });
  });
  return node;
}

// A full-width bar: one segment per root or theme. The themes bar, when
// present, is the strip's last line and a mouse-only second target for
// its legend's action.
function dayStripRenderBar(doc, model, handlers, lane) {
  const mix = dayStripLaneMix(model, lane);
  const skeleton = model.state === "skeleton";
  const themes = lane === "themes";
  const node = statsEl(doc, "div", {
    class: "bob-day-strip-bar" + (themes ? " bob-day-strip-bar-themes" : ""),
    "aria-hidden": "true",
  });
  if (!node) return null;
  node.setAttribute("data-lane", themes ? "themes" : "roots");
  const segments = skeleton ? [] : Array.isArray(mix.segments) ? mix.segments : [];
  const slots = Math.max(8, segments.length);
  for (let index = 0; index < slots; index += 1) {
    const segment = segments[index];
    const hueClass = segment
      ? (themes ? " bob-day-strip-theme-hue-" + segment.hue : " bob-day-strip-hue-" + segment.hue)
      : "";
    const part = statsEl(doc, "span", {
      class: "bob-day-strip-bar-segment" + hueClass + (segment && segment.bucket ? " bob-day-strip-bar-bucket" : ""),
      title: segment ? segment.label + " " + segment.display : null,
    });
    if (part && themes && segment && typeof segment.shade === "number" && segment.shade > 0) {
      part.setAttribute("data-shade", String(segment.shade));
    }
    if (part && part.style && segment) part.style.flexGrow = String(Math.max(0, Number(segment.value) || 0));
    if (!segment) part.setAttribute("hidden", "true");
    dayStripAppend(node, part);
  }
  const panel = dayStripLanePanel(lane);
  dayStripBarActivate(node, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, metric: "worked", panel, newLeaf });
  });
  return node;
}

function dayStripLaneShownFor(model) {
  try {
    const lanes = model && model.lanes && typeof model.lanes === "object" ? model.lanes : null;
    if (lanes && Array.isArray(lanes.shown)) return lanes.shown.filter((lane) => lane === "roots" || lane === "themes");
  } catch (error) {
    // Fall through to the availability fallback.
  }
  try {
    const skeleton = model && model.state === "skeleton";
    if (skeleton) return ["roots", "themes"];
    const mix = model ? dayStripLaneMix(model, "roots") : null;
    const themes = model ? dayStripLaneMix(model, "themes") : null;
    const shown = [];
    if (mix && !mix.omitted) shown.push("roots");
    if (themes && !themes.omitted) shown.push("themes");
    return shown;
  } catch (error) {
    return [];
  }
}

function dayStripRenderMixRow(doc, model, handlers, lane, isFirst) {
  const mix = dayStripLaneMix(model, lane);
  const skeleton = model.state === "skeleton";
  const showMix = skeleton || !mix.omitted;
  const first = isFirst === undefined ? lane !== "themes" : Boolean(isFirst);
  const showMeta = first && (skeleton || Boolean(model.metaText));
  if (!showMix && !showMeta) return null;
  const themes = lane === "themes";
  const row = statsEl(doc, "div", {
    class: "bob-day-strip-mix-row" + (themes ? " bob-day-strip-lane-themes" : ""),
  });
  if (row) row.setAttribute("data-lane", themes ? "themes" : "roots");
  if (showMix) dayStripAppend(row, dayStripRenderMix(doc, model, handlers, lane));
  if (showMeta) {
    dayStripAppend(row, statsEl(doc, "span", {
      class: "bob-day-strip-meta",
      title: model.stale && model.staleTitle ? model.staleTitle : null,
    }, skeleton ? "so far · 00:00" : model.metaText));
  }
  if (first) {
    const lanes = model && model.lanes ? model.lanes : null;
    const switchable = Boolean(lanes && lanes.switchable);
    if (skeleton || switchable) {
      const sw = dayStripRenderLanesSwitch(doc, model, handlers);
      if (sw) dayStripAppend(row, sw);
    }
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

function dayStripLaneEntering(el, model, shown) {
  try {
    if (!el || !model || model.state !== "ready") return [];
    let wasSkeleton = false;
    try {
      const cls = typeof el.getAttribute === "function" ? el.getAttribute("class") : "";
      wasSkeleton = String(cls || "").split(/\s+/).includes("bob-day-strip-state-skeleton");
    } catch (error) {
      wasSkeleton = false;
    }
    if (wasSkeleton) return [];
    let prev = null;
    try {
      prev = dayStripLaneMemory.get(el);
    } catch (error) {
      return [];
    }
    if (!prev || !prev.day || prev.day !== model.day) return [];
    const prevView = prev.view || "both";
    const currentView = (model.lanes && model.lanes.view) || "both";
    if (prevView === currentView) return [];
    const prevShown = Array.isArray(prev.shown) ? prev.shown : [];
    return (Array.isArray(shown) ? shown : []).filter((lane) => !prevShown.includes(lane));
  } catch (error) {
    return [];
  }
}

function dayStripRememberLaneView(el, model, shown) {
  try {
    if (!el || !model || model.state !== "ready") return;
    dayStripLaneMemory.set(el, {
      day: model.day,
      view: (model.lanes && model.lanes.view) || "both",
      shown: Array.isArray(shown) ? shown.slice() : [],
    });
  } catch (error) {
    // Host memory is best-effort.
  }
}

function paintDayStrip(el, model, handlers) {
  if (!el || !model) return el;
  const safeModel = model && typeof model === "object" ? model : {};
  const safeHandlers = handlers && typeof handlers === "object" ? handlers : {};
  const doc = statsDocFor(el);
  if (!doc) return el;
  try {
    const arriveIds = dayStripArriveIds(el, safeModel);
    const shown = dayStripLaneShownFor(safeModel);
    const entering = dayStripLaneEntering(el, safeModel, shown);
    const enteringSet = new Set(entering);
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
    for (const fact of safeModel.facts || []) {
      dayStripAppend(facts, dayStripRenderFact(doc, fact, safeModel, safeHandlers, Boolean(arriveIds[fact.id])));
    }
    dayStripAppend(el, facts);
    if (shown.length > 0) {
      shown.forEach((lane, index) => {
        const isFirst = index === 0;
        const row = dayStripRenderMixRow(doc, safeModel, safeHandlers, lane, isFirst);
        if (row) {
          if (enteringSet.has(lane)) {
            try {
              const current = row.getAttribute("class") || "";
              row.setAttribute("class", (current ? current + " " : "") + "bob-day-strip-lane-enter");
            } catch (error) {
              // Enter class is best-effort.
            }
          }
          dayStripAppend(el, row);
        }
        const bar = dayStripRenderBar(doc, safeModel, safeHandlers, lane);
        if (bar) {
          if (enteringSet.has(lane)) {
            try {
              const current = bar.getAttribute("class") || "";
              bar.setAttribute("class", (current ? current + " " : "") + "bob-day-strip-lane-enter");
            } catch (error) {
              // Enter class is best-effort.
            }
          }
          dayStripAppend(el, bar);
        }
      });
    } else {
      const loneRow = dayStripRenderMixRow(doc, safeModel, safeHandlers, "roots", true);
      if (loneRow) dayStripAppend(el, loneRow);
    }
    const fitLanes = shown.length > 0;
    if ((state === "ready" || state === "skeleton") && fitLanes) {
      try {
        if (typeof dayStripFitLegend === "function") dayStripFitLegend(el);
      } catch (error) {
        // Fit is best-effort.
      }
      if (state === "skeleton") {
        try {
          const counters = [];
          if (el.querySelectorAll) {
            Array.prototype.push.apply(counters, el.querySelectorAll(".bob-day-strip-overflow"));
          } else if (typeof dayStripFitFindByClass === "function") {
            Array.prototype.push.apply(counters, dayStripFitFindByClass(el, "bob-day-strip-overflow"));
          }
          for (const counter of counters) {
            if (counter && counter.setAttribute) counter.setAttribute("hidden", "true");
          }
        } catch (error) {
          // Skeleton never shows its counter.
        }
      }
      try {
        if (typeof dayStripEnsureFitObserver === "function") dayStripEnsureFitObserver(el);
      } catch (error) {
        // Observer is best-effort.
      }
    }
    dayStripRememberMarks(el, safeModel);
    dayStripRememberLaneView(el, safeModel, shown);
    return el;
  } catch (error) {
    // A failed paint must not escape into Obsidian's render lifecycle.
    return el;
  }
}
