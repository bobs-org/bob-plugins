// DOM painter for the daily-note Stats receipt. The host element remains
// stable; each update replaces only its children from the current model.
function dayStripButton(doc, className, label, title) {
  const button = statsEl(doc, "button", {
    class: className,
    type: "button",
    title: title || null,
    "aria-label": label,
  });
  return button;
}

function dayStripAppend(parent, child) {
  if (parent && child && typeof parent.appendChild === "function") parent.appendChild(child);
  return child;
}

function dayStripActivate(button, action) {
  if (!button || typeof button.addEventListener !== "function") return;
  let suppressNativeKeyboardClick = false;
  const invoke = (event, forcedNewLeaf) => {
    if (event && event.preventDefault && event.type === "mousedown") event.preventDefault();
    const newLeaf = forcedNewLeaf || Boolean(event && (event.ctrlKey || event.metaKey || event.button === 1));
    if (typeof action === "function") action(newLeaf);
  };
  button.addEventListener("mousedown", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    if (suppressNativeKeyboardClick) {
      suppressNativeKeyboardClick = false;
      return;
    }
    invoke(event, false);
  });
  button.addEventListener("auxclick", (event) => {
    if (event && event.button === 1) {
      if (event.preventDefault) event.preventDefault();
      invoke(event, true);
    }
  });
  button.addEventListener("keydown", (event) => {
    if (!event || (event.key !== "Enter" && event.key !== " ")) return;
    if (event.preventDefault) event.preventDefault();
    suppressNativeKeyboardClick = true;
    invoke(event, false);
  });
}

function dayStripClassForMark(mark, kind) {
  if (!mark || mark.empty) return "bob-day-strip-mark bob-day-strip-mark-null";
  const classes = ["bob-day-strip-mark"];
  if (mark.isDay) classes.push("bob-day-strip-mark-day");
  else classes.push("bob-day-strip-mark-context");
  if (mark.provisional) classes.push("bob-day-strip-mark-provisional");
  if (kind === "dots") {
    classes.push(mark.met ? "bob-day-strip-mark-met" : mark.provisional ? "bob-day-strip-mark-pending" : "bob-day-strip-mark-missed");
  } else if (mark.zero) {
    classes.push("bob-day-strip-mark-zero");
  }
  return classes.join(" ");
}

function dayStripRenderMark(doc, mark, kind) {
  const node = statsEl(doc, "span", {
    class: dayStripClassForMark(mark, kind),
    title: mark && mark.title ? mark.title : null,
    "aria-hidden": "true",
  });
  if (kind === "bars" && mark && !mark.empty && !mark.zero && node && node.style) {
    node.style.height = Math.max(0.08, Math.min(1, Number(mark.height) || 0)) * 14 + "px";
  }
  if (node && typeof node.addEventListener === "function") {
    node.addEventListener("click", (event) => { if (event && event.stopPropagation) event.stopPropagation(); });
    node.addEventListener("auxclick", (event) => { if (event && event.stopPropagation) event.stopPropagation(); });
  }
  return node;
}

function dayStripRenderTile(doc, tile, model, handlers) {
  const skeleton = model.state === "skeleton";
  const button = dayStripButton(
    doc,
    "bob-day-strip-tile" + (skeleton ? " bob-day-strip-tile-skeleton" : ""),
    skeleton ? tile.label + ", loading" : tile.label + ": " + tile.display,
    tile.tooltip,
  );
  if (button) button.setAttribute("data-day-strip-metric", tile.id);
  const label = statsEl(doc, "span", { class: "bob-day-strip-label" }, tile.label);
  dayStripAppend(button, label);

  const valueRow = statsEl(doc, "span", { class: "bob-day-strip-value-row" });
  const value = skeleton
    ? statsEl(doc, "span", { class: "bob-day-strip-value bob-day-strip-value-skeleton", "aria-hidden": "true" })
    : statsEl(doc, "span", {
      class: "bob-day-strip-value" + (tile.display === "–" ? " bob-day-strip-value-empty" : ""),
      title: tile.quality === "not_tracked" && tile.since ? "Tracking since " + tile.since : null,
    }, tile.display);
  dayStripAppend(valueRow, value);
  const warning = statsEl(doc, "span", {
    class: "bob-day-strip-warning",
    title: tile.warning || null,
    "aria-hidden": "true",
  }, "⚠");
  if (!tile.warning || skeleton) warning.setAttribute("hidden", "true");
  dayStripAppend(valueRow, warning);
  dayStripAppend(button, valueRow);

  const marks = statsEl(doc, "span", { class: "bob-day-strip-marks", "aria-hidden": "true" });
  for (const mark of tile.marks || []) dayStripAppend(marks, dayStripRenderMark(doc, mark, tile.kind));
  dayStripAppend(button, marks);
  dayStripActivate(button, (newLeaf) => {
    if (typeof handlers.openStats === "function") {
      handlers.openStats({ day: model.day, metric: tile.id, newLeaf });
    }
  });
  return button;
}

function dayStripRenderMix(doc, model, handlers) {
  const mix = model.mix || { segments: [], legend: [], overflow: [], omitted: true };
  const skeleton = model.state === "skeleton";
  const button = dayStripButton(doc, "bob-day-strip-mix-action", "Open Stats for time by area", mix.overflowTitle);
  if (mix.omitted && !skeleton) button.setAttribute("hidden", "true");
  const bar = statsEl(doc, "span", {
    class: "bob-day-strip-mix-bar" + (mix.empty ? " bob-day-strip-mix-empty" : "") + (skeleton ? " bob-day-strip-mix-skeleton" : ""),
    "aria-hidden": "true",
  });
  const segments = Array.isArray(mix.segments) ? mix.segments : [];
  const slots = Math.max(8, segments.length);
  for (let index = 0; index < slots; index += 1) {
    const segment = segments[index];
    const node = statsEl(doc, "span", {
      class: "bob-day-strip-mix-segment" + (segment ? " bob-day-strip-hue-" + segment.hue : "") + (segment && segment.bucket ? " bob-day-strip-mix-bucket" : "") + (!segment ? " bob-day-strip-mix-segment-placeholder" : ""),
      title: segment ? segment.label + " " + segment.display : null,
    });
    if (node && node.style && segment) node.style.flexGrow = String(Math.max(0, Number(segment.value) || 0));
    if (!segment) node.setAttribute("hidden", "true");
    dayStripAppend(bar, node);
  }
  dayStripAppend(button, bar);

  const legend = statsEl(doc, "span", { class: "bob-day-strip-legend" });
  const entries = Array.isArray(mix.legend) ? mix.legend : [];
  for (let index = 0; index < 3; index += 1) {
    const entry = entries[index];
    const item = statsEl(doc, "span", {
      class: "bob-day-strip-legend-item" + (entry ? "" : " bob-day-strip-legend-placeholder"),
      title: entry ? entry.label + " " + entry.display : null,
      "aria-hidden": skeleton && !entry ? "true" : null,
    });
    const dot = statsEl(doc, "span", {
      class: "bob-day-strip-legend-dot" + (entry ? " bob-day-strip-hue-" + entry.hue : ""),
      "aria-hidden": "true",
    });
    dayStripAppend(item, dot);
    dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-label" }, entry ? entry.label : skeleton ? "Area" : ""));
    dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-legend-value" }, entry ? entry.display : skeleton ? "0m" : ""));
    if (!entry && !skeleton) item.setAttribute("hidden", "true");
    dayStripAppend(legend, item);
  }
  const noPomodoros = mix.empty && !skeleton;
  const noPomodorosLabel = statsEl(doc, "span", { class: "bob-day-strip-no-pomodoros" }, noPomodoros ? "no Pomodoros" : skeleton ? "no Pomodoros" : "");
  if (skeleton) noPomodorosLabel.setAttribute("aria-hidden", "true");
  if (!noPomodoros && !skeleton) noPomodorosLabel.setAttribute("hidden", "true");
  dayStripAppend(legend, noPomodorosLabel);
  const overflow = statsEl(doc, "span", {
    class: "bob-day-strip-overflow",
    title: mix.overflowTitle || null,
    "aria-hidden": skeleton ? "true" : null,
  }, mix.overflow && mix.overflow.length ? "+" + mix.overflow.length : skeleton ? "+N" : "");
  if (!mix.overflow || !mix.overflow.length) overflow.setAttribute("hidden", "true");
  dayStripAppend(legend, overflow);
  dayStripAppend(button, legend);
  dayStripActivate(button, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, metric: "worked", panel: "homes", newLeaf });
  });
  return button;
}

function dayStripRenderMeta(doc, model, handlers) {
  const meta = statsEl(doc, "span", { class: "bob-day-strip-meta" });
  const asOfText = model.asOf ? "so far · " + model.asOf : "so far · 00:00";
  const asOf = statsEl(doc, "span", { class: "bob-day-strip-as-of" }, asOfText);
  if (!model.asOf) asOf.setAttribute("hidden", "true");
  dayStripAppend(meta, asOf);
  const stale = statsEl(doc, "span", {
    class: "bob-day-strip-stale-dot",
    title: model.staleTitle || null,
    "aria-label": model.stale ? "Showing stale Stats" : null,
  }, "●");
  if (!model.stale) stale.setAttribute("hidden", "true");
  dayStripAppend(meta, stale);

  const stats = dayStripButton(doc, "bob-day-strip-stats-link", "Open Stats for " + model.day, "Open Stats for " + model.day);
  dayStripAppend(stats, statsEl(doc, "span", {}, "Stats ↗"));
  dayStripActivate(stats, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, newLeaf });
  });
  dayStripAppend(meta, stats);

  const collapsed = model.collapsed === true;
  const toggle = dayStripButton(doc, "bob-day-strip-collapse", collapsed ? "Expand Day stats" : "Collapse Day stats");
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  dayStripAppend(toggle, statsEl(doc, "span", { "aria-hidden": "true" }, collapsed ? "▸" : "▾"));
  dayStripActivate(toggle, () => {
    if (typeof handlers.toggleCollapsed === "function") handlers.toggleCollapsed();
  });
  dayStripAppend(meta, toggle);
  return meta;
}

function dayStripRenderUnavailable(doc, model, handlers) {
  const line = statsEl(doc, "span", { class: "bob-day-strip-unavailable" });
  const error = model.error || { title: "bob stats failed", hint: "" };
  const message = error.code === "bob-not-found"
    ? "Day stats unavailable — bob was not found. Set stats.bob_path, or open Stats."
    : "Day stats unavailable — " + error.title + ".";
  dayStripAppend(line, statsEl(doc, "span", { class: "bob-day-strip-unavailable-message" }, message));
  const retry = dayStripButton(doc, "bob-day-strip-retry", "Retry Day stats");
  dayStripAppend(retry, statsEl(doc, "span", {}, "Retry"));
  dayStripActivate(retry, () => {
    if (typeof handlers.retry === "function") handlers.retry();
  });
  dayStripAppend(line, retry);
  const stats = dayStripButton(doc, "bob-day-strip-stats-link", "Open Stats for " + model.day);
  dayStripAppend(stats, statsEl(doc, "span", {}, "Stats ↗"));
  dayStripActivate(stats, (newLeaf) => {
    if (typeof handlers.openStats === "function") handlers.openStats({ day: model.day, newLeaf });
  });
  dayStripAppend(line, stats);
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
    if (safeModel.collapsed) classes.push("bob-day-strip-collapsed");
    if (safeModel.stale) classes.push("bob-day-strip-stale");
    if (safeModel.provisional) classes.push("bob-day-strip-provisional");
    if (el.setAttribute) {
      el.setAttribute("class", classes.join(" "));
      el.setAttribute("data-day", safeModel.day || "");
      if (state !== "hidden" && state !== "future") {
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

    if (safeModel.collapsed && state !== "skeleton") {
      const summary = statsEl(doc, "span", { class: "bob-day-strip-summary" });
      for (const part of safeModel.collapsedText || []) {
        const item = statsEl(doc, "span", { class: "bob-day-strip-summary-item" });
        if (part.kind === "bool") {
          dayStripAppend(item, statsEl(doc, "strong", { class: "bob-day-strip-summary-value" }, part.label + " " + part.display));
        } else {
          dayStripAppend(item, statsEl(doc, "strong", { class: "bob-day-strip-summary-value" }, part.display));
          dayStripAppend(item, statsEl(doc, "span", { class: "bob-day-strip-summary-label" }, " " + part.label.toLowerCase()));
        }
        dayStripAppend(summary, item);
        if (part !== (safeModel.collapsedText || []).at(-1)) dayStripAppend(summary, statsEl(doc, "span", { class: "bob-day-strip-summary-separator", "aria-hidden": "true" }, " · "));
      }
      dayStripAppend(el, summary);
    } else {
      const tiles = statsEl(doc, "span", { class: "bob-day-strip-tiles" });
      for (const tile of safeModel.tiles || []) dayStripAppend(tiles, dayStripRenderTile(doc, tile, safeModel, safeHandlers));
      dayStripAppend(el, tiles);
      dayStripAppend(el, dayStripRenderMix(doc, safeModel, safeHandlers));
    }
    dayStripAppend(el, dayStripRenderMeta(doc, safeModel, safeHandlers));
    return el;
  } catch (error) {
    // A failed paint must not escape into Obsidian's render lifecycle.
    return el;
  }
}
