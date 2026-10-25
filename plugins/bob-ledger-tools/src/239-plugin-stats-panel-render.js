// Family context panels for Stats: theme breakdowns, task flow,
// review counterweights, checklist calendars, and chore grids.
// Dispatch is on metric.kind with the built-in `net` id as the
// explicit formula exception; every other field/formula metric keeps
// only the focus chart and table. Panels reuse the focus chart
// geometry, day selection, tooltip-order text, and keyboard model.
let statsPanelSerial = 0;

class BobLedgerToolsStatsPanelsMixin {
  statsRenderContextPanels(doc, view, report, metric) {
    if (!doc || !view || !report || !metric) {
      return null;
    }
    const family = statsPanelFamily(metric);
    if (!family) {
      return null;
    }
    const section = statsEl(doc, "section", {
      class: "bob-stats-panel bob-stats-hue-" + statsChartMetricColor(metric),
      "aria-label": (metric.label || metric.id) + " context",
    });
    const builders = {
      pomodoro: this.statsPanelPomodoro,
      tasks: this.statsPanelTasks,
      flow: this.statsPanelFlow,
      answers: this.statsPanelAnswers,
      keep: this.statsPanelKeep,
      checklist: this.statsPanelChecklist,
    };
    const build = builders[family];
    if (typeof build !== "function") {
      return null;
    }
    const empty = build.call(this, doc, view, report, metric, section);
    if (empty === false || !section.children.length) {
      return null;
    }
    return section;
  }

  statsPanelFocusMetric(view, report) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const metrics = (report && report.metrics) || [];
    return metrics.find((metric) => metric && metric.id === state.focus) || null;
  }

  statsPanelCursorDay(view) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    return state.pinnedDay || state.cursorDay || null;
  }

  statsPanelTitle(doc, text) {
    return statsEl(doc, "div", { class: "bob-stats-panel-title" }, text);
  }

  statsPanelNote(doc, text) {
    return statsEl(doc, "div", { class: "bob-stats-panel-note" }, text);
  }

  statsPanelFocusBucket(report, focusMetric, date) {
    const points = Array.isArray(focusMetric && focusMetric.points) ? focusMetric.points : [];
    return points.find((point) => point && point.date <= date && (point.end || point.date) >= date) || null;
  }

  statsPanelPinDay(doc, view, report, date, focusKey) {
    if (!statsChartValidDay(date)) {
      return;
    }
    const state = this.statsViewStateFor(view && view.sourcePath);
    const focusMetric = this.statsPanelFocusMetric(view, report);
    state.pinnedDay = date;
    state.cursorDay = date;
    const bucket = focusMetric ? this.statsPanelFocusBucket(report, focusMetric, date) : null;
    state.pinnedBucket = bucket
      ? { start: bucket.date, end: bucket.end || bucket.date }
      : { start: date, end: date };
    view.hoverBucket = null;
    this.statsRenderLocally(view, focusKey);
  }

  statsPanelHoverDay(doc, view, report, date, on) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const focusMetric = this.statsPanelFocusMetric(view, report);
    if (on && focusMetric && statsChartPointForDate(statsChartDailyPoints(focusMetric, report), date)) {
      state.hoverDay = date;
    } else if (!on && state.hoverDay === date) {
      state.hoverDay = null;
    } else if (on) {
      return;
    }
    if (focusMetric && view.chartDayDetail) {
      this.statsUpdateChartDayDetail(doc, view, report, focusMetric, view.chartDayDetail);
    }
    const live = view.chartLive;
    if (live && on && focusMetric) {
      const point = statsChartPointForDate(statsChartDailyPoints(focusMetric, report), date);
      if (point) {
        live.textContent = statsChartTooltip(focusMetric, point, report).replace(/\n/g, ", ");
      }
    }
  }

  // Interactive day cell with the focus chart's keyboard model: a
  // roving tab stop, Enter pins with propagation stopped, and hover
  // previews the shared day detail. Native buttons are avoided so the
  // chart's root arrow/j/k/h/l/t/Esc handling keeps working on focus.
  statsPanelDayCell(doc, view, report, options) {
    const settings = options && typeof options === "object" ? options : {};
    const date = typeof settings.date === "string" ? settings.date : "";
    const cursorDay = this.statsPanelCursorDay(view);
    const node = statsEl(doc, "div", {
      class: settings.className || "bob-stats-panel-cell",
      role: "button",
      tabindex: date && date === cursorDay ? 0 : -1,
      "aria-label": settings.label || date,
      "aria-pressed": this.statsViewStateFor(view && view.sourcePath).pinnedDay === date ? "true" : "false",
      "data-date": date,
      "data-stats-focus-key": settings.focusKey || ("panel:" + date),
    });
    if (settings.text !== undefined && settings.text !== null) {
      const inner = statsEl(doc, "span", { class: settings.innerClass || "", "aria-hidden": "true" }, String(settings.text));
      node.appendChild(inner);
    }
    node.addEventListener("pointerenter", () => this.statsPanelHoverDay(doc, view, report, date, true));
    node.addEventListener("pointerleave", () => this.statsPanelHoverDay(doc, view, report, date, false));
    node.addEventListener("focus", () => this.statsPanelHoverDay(doc, view, report, date, true));
    node.addEventListener("blur", () => this.statsPanelHoverDay(doc, view, report, date, false));
    node.addEventListener("click", () => this.statsPanelPinDay(doc, view, report, date, settings.focusKey));
    node.addEventListener("keydown", (event) => {
      if (event && event.key === "Enter") {
        if (event.preventDefault) {
          event.preventDefault();
        }
        if (event.stopPropagation) {
          event.stopPropagation();
        }
        this.statsPanelPinDay(doc, view, report, date, settings.focusKey);
      }
    });
    return node;
  }

  statsPanelRankedBars(doc, metric, dimension, heading) {
    const rows = statsPanelRankedDimension(metric, dimension);
    const wrap = statsEl(doc, "div", { class: "bob-stats-panel-group" });
    wrap.appendChild(statsEl(doc, "div", { class: "bob-stats-panel-heading" }, heading));
    if (!rows.length) {
      wrap.appendChild(this.statsPanelNote(doc, "No " + heading.toLowerCase() + " is in this report."));
      return wrap;
    }
    const max = Math.max(0, ...rows.map((row) => (statsFinite(row.value) ? row.value : 0)));
    const list = statsEl(doc, "ul", { class: "bob-stats-panel-bars", "aria-label": heading });
    for (const row of rows) {
      const item = statsEl(doc, "li", { class: "bob-stats-panel-bar-row" });
      const track = statsEl(doc, "span", { class: "bob-stats-panel-bar-track", "aria-hidden": "true" });
      const fill = statsEl(doc, "span", { class: "bob-stats-panel-bar-fill bob-stats-svg-hue-" + statsChartMetricColor(metric), "aria-hidden": "true" });
      if (max > 0 && statsFinite(row.value) && row.value > 0) {
        try {
          fill.setAttribute("style", "width: " + Math.max(4, Math.round((row.value / max) * 100)) + "%");
        } catch (error) {
          // Bar width is best-effort.
        }
      } else {
        try {
          fill.setAttribute("style", "width: 0%");
        } catch (error) {
          // Bar width is best-effort.
        }
      }
      track.appendChild(fill);
      item.appendChild(track);
      const share = row.share ? " (" + row.share + ")" : "";
      item.appendChild(statsEl(doc, "span", { class: "bob-stats-panel-bar-text" }, row.key + " — " + row.display + share));
      list.appendChild(item);
    }
    wrap.appendChild(list);
    return wrap;
  }

  statsPanelWidth(view) {
    const width = statsFinite(view && view.chartWidth) && view.chartWidth > 0 ? view.chartWidth : 720;
    return Math.max(300, width);
  }

  // Bar hue for one Themes-panel row: the theme's hue (the fetched
  // `bob themes` report wins inside `pomodoroThemeHueFor`, else the
  // local hash/area/journal mirror). Exempt themes and the "other"
  // bucket render gray. When theme-json adds a stats hue map beside
  // homes, prefer it here before the api lookup. Never throws.
  statsPanelThemeBarHue(key) {
    try {
      const slots = Array.isArray(
        typeof POMODORO_THEMES_HUE_SLOTS !== "undefined"
          ? POMODORO_THEMES_HUE_SLOTS
          : null,
      )
        ? POMODORO_THEMES_HUE_SLOTS
        : ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];
      if (String(key || "").toLowerCase() === "other") {
        return "gray";
      }
      const resolved =
        typeof this.pomodoroThemeHueFor === "function"
          ? this.pomodoroThemeHueFor(key)
          : null;
      const hue = resolved && resolved.hue ? resolved.hue : null;
      if (!hue || !slots.includes(hue)) {
        return "gray";
      }
      if (resolved.hue_source === "exempt") {
        return "gray";
      }
      return hue;
    } catch (error) {
      return "gray";
    }
  }

  // --- Pomodoro: Root parents, with Themes one click away -----------
  statsPanelPomodoro(doc, view, report, metric, section) {
    const viewModel = this.statsPanelHomeToggle(doc, view, report, metric);
    section.appendChild(viewModel.header);
    if (viewModel.hasRoots && viewModel.state.homesView === "roots") {
      return this.statsPanelHomeTable(doc, view, report, metric, section, { areaBar: true, sessions: true });
    }
    if (!viewModel.hasRoots && viewModel.state.homesView === "areas" && viewModel.available) {
      const rendered = this.statsPanelHomeTable(doc, view, report, metric, section, { areaBar: true, sessions: true });
      section.appendChild(this.statsPanelNote(doc, "Update bob to group by root parent."));
      return rendered;
    }
    if (!viewModel.available && !viewModel.hasRoots) {
      section.appendChild(this.statsPanelNote(doc, "Update bob for areas & projects."));
    }
    const point = statsPanelSelectedHomePoint(metric, report, viewModel.state);
    const model = statsPanelThemeRows(metric, point);
    if (!model.rows.length) {
      section.appendChild(this.statsPanelNote(doc, "No theme breakdown is in this report."));
      return true;
    }
    const max = Math.max(0, ...model.rows.map((row) => (statsFinite(row.value) ? row.value : 0)));
    const list = statsEl(doc, "ul", { class: "bob-stats-panel-bars", "aria-label": "Themes" });
    for (const row of model.rows) {
      const item = statsEl(doc, "li", { class: "bob-stats-panel-bar-row" });
      const track = statsEl(doc, "span", { class: "bob-stats-panel-bar-track bob-stats-panel-bar-thin", "aria-hidden": "true" });
      const fill = statsEl(doc, "span", { class: "bob-stats-panel-bar-fill bob-stats-theme-bar-" + this.statsPanelThemeBarHue(row.key), "aria-hidden": "true" });
      try {
        fill.setAttribute("style", "width: " + (max > 0 && statsFinite(row.value) ? Math.max(4, Math.round((row.value / max) * 100)) : 0) + "%");
      } catch (error) {
        // Bar width is best-effort.
      }
      track.appendChild(fill);
      item.appendChild(track);
      const share = row.share ? " (" + row.share + ")" : "";
      item.appendChild(statsEl(doc, "span", { class: "bob-stats-panel-bar-text" }, row.key + " — " + row.display + share));
      list.appendChild(item);
    }
    section.appendChild(list);
    return true;
  }

  // --- Tasks and Net: flow ----------------------------------------------
  statsPanelFlowTooltip(row) {
    const lines = [statsChartDateLabel({ date: row.date, end: row.end })];
    const part = (name, point) => {
      if (!point) {
        return name + ": – (not in this report)";
      }
      if (!statsFinite(point.value)) {
        return name + ": – (" + (point.reason || point.quality || "missing") + ")";
      }
      return name + ": " + (typeof point.display === "string" && point.display ? point.display : String(point.value));
    };
    lines.push(part("Created", row.created));
    lines.push(part("Done", row.done));
    lines.push(part("Dropped", row.dropped));
    lines.push(part("Net", row.net));
    if (row.provisional) {
      lines.push("Provisional today");
    }
    if (row.partial) {
      lines.push("Partial bucket");
    }
    return lines.join("\n");
  }

  statsPanelFlowSvg(doc, view, report, flow, group) {
    const width = this.statsPanelWidth(view);
    const height = width < 420 ? 200 : 240;
    const margin = { left: width < 420 ? 43 : 58, right: 12, top: 14, bottom: 34 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const domain = statsChartDomain(statsPanelFlowValues(flow.rows), "signed");
    const zeroY = statsChartY(0, domain, margin.top, plotHeight);
    const baseline = Math.max(margin.top, Math.min(margin.top + plotHeight, zeroY));
    const ticks = statsChartTicks(domain, "signed", width < 420 ? 3 : 5);
    const density = statsResponsiveLabelDensity(width, flow.rows.length);
    const slots = statsChartPointSlots(flow.rows.length, margin.left, plotWidth);
    statsPanelSerial += 1;
    const patternId = (view.chartId || "bob-stats-chart") + "-flow-" + statsPanelSerial;
    const svg = statsSvgEl(doc, "svg", {
      class: "bob-stats-panel-svg",
      width,
      height,
      viewBox: "0 0 " + width + " " + height,
      role: "group",
      "aria-label": "Task flow by " + group,
      focusable: "false",
    });
    const defs = statsSvgEl(doc, "defs", {});
    const pattern = statsSvgEl(doc, "pattern", { id: patternId, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.appendChild(statsSvgEl(doc, "line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--text-faint)", "stroke-width": 1, opacity: 0.45 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);
    const ticksToDraw = density.compact ? [ticks.values[ticks.values.length - 1]] : ticks.values;
    for (const tick of ticksToDraw) {
      const y = statsChartY(tick, domain, margin.top, plotHeight);
      svg.appendChild(statsSvgEl(doc, "line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "bob-stats-chart-gridline", "stroke-width": 1 }));
      svg.appendChild(statsSvgEl(doc, "text", { x: margin.left - 7, y: y + 4, "text-anchor": "end", class: "bob-stats-chart-axis" }, String(tick).replace(/^-/, "−")));
    }
    const downY = (magnitude) => statsChartY(-magnitude, domain, margin.top, plotHeight);
    const cursorDay = this.statsPanelCursorDay(view);
    for (let index = 0; index < flow.rows.length; index += 1) {
      const row = flow.rows[index];
      const slot = slots[index];
      if (row.empty) {
        svg.appendChild(statsSvgEl(doc, "rect", {
          x: slot.slotStart + 1, y: margin.top, width: Math.max(0.5, plotWidth / flow.rows.length - 2), height: plotHeight,
          fill: "url(#" + patternId + ")", class: "bob-stats-chart-missing",
        }));
        svg.appendChild(statsSvgEl(doc, "text", { x: slot.center, y: baseline - 5, "text-anchor": "middle", class: "bob-stats-chart-null-label" }, "–"));
      } else {
        if (row.created && statsFinite(row.created.value) && row.created.value !== 0) {
          const y = statsChartY(row.created.value, domain, margin.top, plotHeight);
          svg.appendChild(statsSvgEl(doc, "path", {
            d: statsRoundedTerminalBarPath(slot.x, baseline, y, Math.max(1, slot.width), 4),
            class: "bob-stats-chart-bar bob-stats-svg-hue-blue" + (row.provisional ? " bob-stats-chart-today" : ""),
          }));
        } else if (row.created && row.created.value === 0) {
          svg.appendChild(statsSvgEl(doc, "line", {
            x1: slot.center - Math.max(1, slot.width / 2), x2: slot.center + Math.max(1, slot.width / 2),
            y1: baseline, y2: baseline, class: "bob-stats-chart-zero bob-stats-svg-hue-blue", "stroke-width": 2,
          }));
        }
        const down = [];
        if (row.done && statsFinite(row.done.value) && row.done.value !== 0) {
          down.push({ value: row.done.value, color: "green", provisional: row.done.provisional === true });
        }
        if (row.dropped && statsFinite(row.dropped.value) && row.dropped.value !== 0) {
          down.push({ value: row.dropped.value, color: "gray", provisional: row.dropped.provisional === true });
        }
        let stacked = 0;
        for (let part = 0; part < down.length; part += 1) {
          const top = part === 0 ? baseline : downY(stacked);
          const bottom = downY(stacked + down[part].value);
          stacked += down[part].value;
          if (part === down.length - 1) {
            svg.appendChild(statsSvgEl(doc, "path", {
              d: statsRoundedTerminalBarPath(slot.x, top, bottom, Math.max(1, slot.width), 4),
              class: "bob-stats-chart-bar bob-stats-svg-hue-" + down[part].color + (row.provisional ? " bob-stats-chart-today" : ""),
            }));
          } else {
            svg.appendChild(statsSvgEl(doc, "rect", {
              x: slot.x, y: Math.min(top, bottom), width: Math.max(1, slot.width), height: Math.max(1, Math.abs(bottom - top)),
              class: "bob-stats-chart-bar bob-stats-svg-hue-" + down[part].color + (row.provisional ? " bob-stats-chart-today" : ""),
            }));
          }
        }
        if (row.provisional) {
          svg.appendChild(statsSvgEl(doc, "rect", {
            x: slot.slotStart + 1, y: margin.top + 1, width: Math.max(1, plotWidth / flow.rows.length - 2), height: Math.max(1, plotHeight - 2),
            class: "bob-stats-flow-today",
          }));
        }
      }
      const hit = statsSvgEl(doc, "rect", {
        x: slot.slotStart, y: margin.top, width: Math.max(1, plotWidth / flow.rows.length), height: plotHeight,
        fill: "transparent",
        class: "bob-stats-chart-hit" + (cursorDay && cursorDay >= row.date && cursorDay <= row.end ? " bob-stats-chart-hit-cursor" : ""),
        role: "button",
        tabindex: cursorDay && cursorDay >= row.date && cursorDay <= row.end ? 0 : (index === 0 && !cursorDay ? 0 : -1),
        "aria-label": this.statsPanelFlowTooltip(row).replace(/\n/g, ", "),
        "aria-pressed": this.statsViewStateFor(view && view.sourcePath).pinnedDay >= row.date && this.statsViewStateFor(view && view.sourcePath).pinnedDay <= row.end ? "true" : "false",
        "data-date": row.date,
        "data-end": row.end,
        "data-stats-focus-key": "panel:flow:" + (row.date || index),
      });
      const pin = (event) => {
        const daily = row.date;
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        this.statsPanelPinDay(doc, view, report, daily, "panel:flow:" + (row.date || index));
      };
      hit.addEventListener("click", pin);
      hit.addEventListener("keydown", (event) => {
        if (event && event.key === "Enter") {
          if (event.preventDefault) {
            event.preventDefault();
          }
          pin(event);
        }
      });
      hit.addEventListener("pointerenter", () => this.statsPanelHoverDay(doc, view, report, row.date, true));
      hit.addEventListener("pointerleave", () => this.statsPanelHoverDay(doc, view, report, row.date, false));
      hit.addEventListener("focus", () => this.statsPanelHoverDay(doc, view, report, row.date, true));
      hit.addEventListener("blur", () => this.statsPanelHoverDay(doc, view, report, row.date, false));
      svg.appendChild(hit);
    }
    const netPath = statsPanelValuePath(
      flow.rows.map((row) => row.net),
      slots.map((slot) => slot.center),
      (value) => statsChartY(value, domain, margin.top, plotHeight),
    );
    if (netPath) {
      svg.appendChild(statsSvgEl(doc, "path", { d: netPath, class: "bob-stats-flow-net", fill: "none", "aria-hidden": "true" }));
    }
    svg.appendChild(statsSvgEl(doc, "line", {
      x1: margin.left, y1: margin.top + plotHeight, x2: width - margin.right, y2: margin.top + plotHeight,
      class: "bob-stats-chart-axis-line", "stroke-width": 1,
    }));
    for (const index of density.xIndices) {
      const row = flow.rows[index];
      const slot = slots[index];
      svg.appendChild(statsSvgEl(doc, "text", {
        x: slot.center, y: height - 6,
        "text-anchor": index === 0 ? "start" : index === flow.rows.length - 1 ? "end" : "middle",
        class: "bob-stats-chart-axis bob-stats-chart-x-label",
      }, statsChartDateLabel({ date: row.date, end: row.end })));
    }
    return svg;
  }

  statsPanelTasks(doc, view, report, metric, section) {
    return this.statsPanelFlowFamily(doc, view, report, metric, section, false);
  }

  statsPanelFlow(doc, view, report, metric, section) {
    return this.statsPanelFlowFamily(doc, view, report, metric, section, true);
  }

  statsPanelFlowFamily(doc, view, report, metric, section, isNet) {
    const group = statsPanelGroup(report, metric);
    section.appendChild(this.statsPanelTitle(doc, "Task flow · " + group + " buckets"));
    const flow = statsPanelFlowRows(report);
    const missing = ["created", "done", "dropped", "net"].filter((id) => !flow.present[id]);
    if (!flow.rows.length) {
      section.appendChild(this.statsPanelNote(doc, "Task flow is unavailable: this report has no Created, Done, Dropped, or Net series."));
      return true;
    }
    if (missing.length) {
      const shown = ["created", "done", "dropped", "net"].filter((id) => flow.present[id]);
      const named = (id) => id[0].toUpperCase() + id.slice(1);
      section.appendChild(this.statsPanelNote(doc,
        "Showing " + shown.map(named).join(", ") + "; " + missing.map(named).join(", ") +
        (missing.length > 1 ? " are not in this report. " : " is not in this report. ") + "No values were invented."));
    }
    if (!isNet && metric.kind === "tasks" && !["created", "done", "dropped"].includes(metric.id)) {
      section.appendChild(this.statsPanelNote(doc,
        "Flow is the overall task flow; " + (metric.label || metric.id) + " is one filtered view of it."));
    }
    const wrap = statsEl(doc, "div", { class: "bob-stats-chart-wrap" });
    wrap.appendChild(this.statsPanelFlowSvg(doc, view, report, flow, group));
    section.appendChild(wrap);
    const legend = statsEl(doc, "div", { class: "bob-stats-chart-legend", "aria-label": "Flow legend" });
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-created" }, "Created up (blue)"));
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-done" }, "Done down (green)"));
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-dropped" }, "Dropped down (gray)"));
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-net" }, "Net line (ink)"));
    section.appendChild(legend);
    const notes = [];
    if (flow.rows.some((row) => row.provisional)) {
      notes.push("Today is provisional.");
    }
    if (flow.rows.some((row) => row.partial)) {
      notes.push("Partial buckets cover only part of a week or month.");
    }
    if (notes.length) {
      section.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-note" }, notes.join(" ")));
    }
    if (isNet) {
      for (const id of ["created", "done", "dropped"]) {
        const companion = statsPanelMetricById(report, id);
        if (!companion) {
          continue;
        }
        const label = companion.label || id;
        section.appendChild(this.statsPanelRankedBars(doc, companion, "kind", label + " by kind"));
        section.appendChild(this.statsPanelRankedBars(doc, companion, "note", label + " top notes"));
      }
      const total = statsPanelTotalDisplay(metric);
      if (total) {
        section.appendChild(statsEl(doc, "div", { class: "bob-stats-panel-total" }, "Net total: " + total));
      }
    } else {
      section.appendChild(this.statsPanelRankedBars(doc, metric, "kind", "By kind"));
      section.appendChild(this.statsPanelRankedBars(doc, metric, "note", "Top notes"));
      const total = statsPanelTotalDisplay(metric);
      if (total) {
        section.appendChild(statsEl(doc, "div", { class: "bob-stats-panel-total" }, "Total: " + total));
      }
    }
    if (!isNet && metric.kind === "tasks" && statsPanelHasHomes(metric)) {
      this.statsPanelHomeTable(doc, view, report, metric, section, { title: true });
    }
    return true;
  }

  // --- Journal: answers, review time, keep rate ---------------------------
  statsPanelReviewTime(doc, report) {
    const companion = statsPanelMetricById(report, "review_time");
    if (!companion) {
      return this.statsPanelNote(doc, "Review time is not in this report.");
    }
    const display = statsPanelTotalDisplay(companion);
    return statsEl(doc, "div", { class: "bob-stats-panel-total" }, "Review time: " + (display || "–") + " in total");
  }

  statsPanelKeepSvg(doc, view, report, metric) {
    const points = Array.isArray(metric.points) ? metric.points : [];
    const width = this.statsPanelWidth(view);
    const height = width < 420 ? 190 : 230;
    const margin = { left: width < 420 ? 48 : 58, right: 12, top: 14, bottom: 34 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const values = points.filter((point) => point && statsFinite(point.value)).map((point) => point.value);
    const domain = statsChartDomain(values, "ratio");
    const ticks = statsChartTicks(domain, "ratio", width < 420 ? 3 : 5);
    const density = statsResponsiveLabelDensity(width, points.length);
    const slots = statsChartPointSlots(points.length, margin.left, plotWidth);
    statsPanelSerial += 1;
    const patternId = (view.chartId || "bob-stats-chart") + "-keep-" + statsPanelSerial;
    const svg = statsSvgEl(doc, "svg", {
      class: "bob-stats-panel-svg",
      width,
      height,
      viewBox: "0 0 " + width + " " + height,
      role: "group",
      "aria-label": (metric.label || "Keep rate") + " with a 90 percent reopen-trigger reference",
      focusable: "false",
    });
    const defs = statsSvgEl(doc, "defs", {});
    const pattern = statsSvgEl(doc, "pattern", { id: patternId, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.appendChild(statsSvgEl(doc, "line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--text-faint)", "stroke-width": 1, opacity: 0.45 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);
    const ticksToDraw = density.compact ? [ticks.values[ticks.values.length - 1]] : ticks.values;
    for (const tick of ticksToDraw) {
      const y = statsChartY(tick, domain, margin.top, plotHeight);
      svg.appendChild(statsSvgEl(doc, "line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "bob-stats-chart-gridline", "stroke-width": 1 }));
      svg.appendChild(statsSvgEl(doc, "text", { x: margin.left - 7, y: y + 4, "text-anchor": "end", class: "bob-stats-chart-axis" }, statsChartFormatTick(tick, "ratio", ticks.step)));
    }
    const referenceY = statsChartY(STATS_PANEL_KEEP_REFERENCE, domain, margin.top, plotHeight);
    svg.appendChild(statsSvgEl(doc, "line", {
      x1: margin.left, y1: referenceY, x2: width - margin.right, y2: referenceY,
      class: "bob-stats-keep-reference", "stroke-width": 1.5, "stroke-dasharray": "6 4", "aria-hidden": "true",
    }));
    svg.appendChild(statsSvgEl(doc, "text", {
      x: width - margin.right, y: referenceY - 5, "text-anchor": "end", class: "bob-stats-keep-reference-label", "aria-hidden": "true",
    }, "reopen trigger 90%"));
    const color = statsChartMetricColor(metric);
    const cursorDay = this.statsPanelCursorDay(view);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index] && typeof points[index] === "object" ? points[index] : {};
      const slot = slots[index];
      const date = typeof point.date === "string" ? point.date : "";
      const end = typeof point.end === "string" ? point.end : date;
      if (!statsFinite(point.value)) {
        svg.appendChild(statsSvgEl(doc, "rect", {
          x: slot.slotStart + 1, y: margin.top, width: Math.max(0.5, plotWidth / points.length - 2), height: plotHeight,
          fill: "url(#" + patternId + ")", class: "bob-stats-chart-missing",
        }));
        svg.appendChild(statsSvgEl(doc, "text", { x: slot.center, y: margin.top + plotHeight - 5, "text-anchor": "middle", class: "bob-stats-chart-null-label" }, "–"));
      } else {
        const y = statsChartY(point.value, domain, margin.top, plotHeight);
        if (point.provisional === true) {
          svg.appendChild(statsSvgEl(doc, "circle", {
            cx: slot.center, cy: y, r: 5, class: "bob-stats-keep-today bob-stats-svg-hue-" + color, "aria-hidden": "true",
          }));
        } else {
          svg.appendChild(statsSvgEl(doc, "circle", {
            cx: slot.center, cy: y, r: 3.5, class: "bob-stats-keep-point bob-stats-svg-hue-" + color, "aria-hidden": "true",
          }));
        }
      }
      const hit = statsSvgEl(doc, "rect", {
        x: slot.slotStart, y: margin.top, width: Math.max(1, plotWidth / points.length), height: plotHeight,
        fill: "transparent",
        class: "bob-stats-chart-hit" + (cursorDay && cursorDay >= date && cursorDay <= end ? " bob-stats-chart-hit-cursor" : ""),
        role: "button",
        tabindex: cursorDay && cursorDay >= date && cursorDay <= end ? 0 : (index === 0 && !cursorDay ? 0 : -1),
        "aria-label": statsChartTooltip(metric, point, report).replace(/\n/g, ", "),
        "aria-pressed": this.statsViewStateFor(view && view.sourcePath).pinnedDay >= date && this.statsViewStateFor(view && view.sourcePath).pinnedDay <= end ? "true" : "false",
        "data-date": date,
        "data-end": end,
        "data-stats-focus-key": "panel:keep:" + (date || index),
      });
      hit.addEventListener("click", (event) => {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        this.statsPanelPinDay(doc, view, report, date, "panel:keep:" + (date || index));
      });
      hit.addEventListener("keydown", (event) => {
        if (event && event.key === "Enter") {
          if (event.preventDefault) {
            event.preventDefault();
          }
          if (event.stopPropagation) {
            event.stopPropagation();
          }
          this.statsPanelPinDay(doc, view, report, date, "panel:keep:" + (date || index));
        }
      });
      hit.addEventListener("pointerenter", () => this.statsPanelHoverDay(doc, view, report, date, true));
      hit.addEventListener("pointerleave", () => this.statsPanelHoverDay(doc, view, report, date, false));
      hit.addEventListener("focus", () => this.statsPanelHoverDay(doc, view, report, date, true));
      hit.addEventListener("blur", () => this.statsPanelHoverDay(doc, view, report, date, false));
      svg.appendChild(hit);
    }
    const path = statsPanelValuePath(points, slots.map((slot) => slot.center), (value) => statsChartY(value, domain, margin.top, plotHeight));
    if (path) {
      svg.appendChild(statsSvgEl(doc, "path", { d: path, class: "bob-stats-keep-line bob-stats-svg-hue-" + color, fill: "none", "aria-hidden": "true" }));
    }
    svg.appendChild(statsSvgEl(doc, "line", {
      x1: margin.left, y1: margin.top + plotHeight, x2: width - margin.right, y2: margin.top + plotHeight,
      class: "bob-stats-chart-axis-line", "stroke-width": 1,
    }));
    for (const index of density.xIndices) {
      const point = points[index];
      const slot = slots[index];
      svg.appendChild(statsSvgEl(doc, "text", {
        x: slot.center, y: height - 6,
        "text-anchor": index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        class: "bob-stats-chart-axis bob-stats-chart-x-label",
      }, statsChartDateLabel(point)));
    }
    return svg;
  }

  statsPanelAnswers(doc, view, report, metric, section) {
    section.appendChild(this.statsPanelTitle(doc, "Review answers · " + (metric.label || metric.id)));
    if (metric.id === "reviewed") {
      section.appendChild(this.statsPanelRankedBars(doc, metric, "tier", "Answers by tier"));
      section.appendChild(this.statsPanelRankedBars(doc, metric, "outcome", "Answers by outcome"));
    } else {
      const summary = metric.parts_summary && typeof metric.parts_summary === "object" ? metric.parts_summary : {};
      const dimensions = Object.keys(summary);
      if (!dimensions.length) {
        section.appendChild(this.statsPanelNote(doc, "No answer breakdown is in this report."));
      }
      for (const dimension of dimensions) {
        section.appendChild(this.statsPanelRankedBars(doc, metric, dimension, "Answers by " + dimension));
      }
    }
    section.appendChild(this.statsPanelReviewTime(doc, report));
    const keep = statsPanelMetricById(report, "keep_rate");
    if (keep && metric.id !== "keep_rate") {
      section.appendChild(this.statsPanelTitle(doc, "Keep rate"));
      const wrap = statsEl(doc, "div", { class: "bob-stats-chart-wrap" });
      wrap.appendChild(this.statsPanelKeepSvg(doc, view, report, keep));
      section.appendChild(wrap);
      section.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-note" },
        "The dashed line marks the 90% reopen trigger as a reference, not a target."));
    }
    return true;
  }

  statsPanelKeep(doc, view, report, metric, section) {
    section.appendChild(this.statsPanelTitle(doc, "Keep rate"));
    const wrap = statsEl(doc, "div", { class: "bob-stats-chart-wrap" });
    wrap.appendChild(this.statsPanelKeepSvg(doc, view, report, metric));
    section.appendChild(wrap);
    const legend = statsEl(doc, "div", { class: "bob-stats-chart-legend", "aria-label": "Keep rate legend" });
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-keep" }, "Keep rate"));
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item bob-stats-legend-reference" }, "Reopen trigger 90% (reference)"));
    section.appendChild(legend);
    section.appendChild(statsEl(doc, "div", { class: "bob-stats-chart-note" },
      "The line gaps on days without answers and today stays hollow. The 90% line is a reference, not a target."));
    section.appendChild(this.statsPanelReviewTime(doc, report));
    const reviewed = statsPanelMetricById(report, "reviewed");
    if (reviewed) {
      section.appendChild(this.statsPanelRankedBars(doc, reviewed, "tier", "Answers by tier"));
      section.appendChild(this.statsPanelRankedBars(doc, reviewed, "outcome", "Answers by outcome"));
    }
    return true;
  }

  // --- Checklist: calendar and chores --------------------------------------
  statsPanelChecklist(doc, view, report, metric, section) {
    section.appendChild(this.statsPanelTitle(doc, (metric.label || metric.id) + " calendar"));
    const calendar = statsPanelCalendar(metric, report);
    if (!calendar) {
      section.appendChild(this.statsPanelNote(doc,
        "The calendar needs daily checklist states; this report schema omits them, so only the focus chart and table are shown."));
    } else {
      const legend = statsEl(doc, "div", { class: "bob-stats-chart-legend", "aria-label": "Calendar legend" });
      for (const [state, text] of [["met", "Met (filled)"], ["missed", "Missed (outlined)"], ["not_due", "Not due (blank)"], ["missing", "Missing (hatched)"], ["not_tracked", "Not tracked (quiet)"]]) {
        const item = statsEl(doc, "span", { class: "bob-stats-legend-item" });
        item.appendChild(statsEl(doc, "span", { class: "bob-stats-cal-swatch bob-stats-cal-" + state, "aria-hidden": "true" }, " "));
        item.appendChild(statsEl(doc, "span", {}, text));
        legend.appendChild(item);
      }
      legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item" }, "Today is provisional."));
      section.appendChild(legend);
      const scroller = statsEl(doc, "div", {
        class: "bob-stats-panel-scroll",
        role: "group",
        tabindex: "0",
        "aria-label": "Checklist calendar. Scroll horizontally for more weeks.",
      });
      const table = statsEl(doc, "table", { class: "bob-stats-cal" });
      const head = statsEl(doc, "thead", {});
      const headRow = statsEl(doc, "tr", {});
      headRow.appendChild(statsEl(doc, "th", { scope: "col" }, "Day"));
      for (const week of calendar.weeks) {
        headRow.appendChild(statsEl(doc, "th", { scope: "col" }, week.label));
      }
      head.appendChild(headRow);
      table.appendChild(head);
      const body = statsEl(doc, "tbody", {});
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const row = statsEl(doc, "tr", {});
        row.appendChild(statsEl(doc, "th", { scope: "row" }, STATS_PANEL_WEEKDAYS[weekday]));
        for (const week of calendar.weeks) {
          const cell = week.slots[weekday];
          const holder = statsEl(doc, "td", {});
          if (cell) {
            const dayNumber = cell.date.length >= 10 ? String(Number(cell.date.slice(8, 10))) : cell.date;
            holder.appendChild(this.statsPanelDayCell(doc, view, report, {
              date: cell.date,
              label: statsPanelCalendarAriaLabel(cell),
              focusKey: "panel:cal:" + cell.date,
              className: "bob-stats-cal-cell bob-stats-cal-" + cell.state + (cell.provisional ? " bob-stats-cal-today" : ""),
              innerClass: "bob-stats-cal-day",
              text: dayNumber,
            }));
          } else {
            holder.appendChild(statsEl(doc, "span", { class: "bob-stats-cal-pad", "aria-hidden": "true" }, " "));
          }
          row.appendChild(holder);
        }
        body.appendChild(row);
      }
      table.appendChild(body);
      scroller.appendChild(table);
      section.appendChild(scroller);
    }
    const grid = statsPanelChoreGrid(metric, report);
    const group = statsPanelGroup(report, metric);
    if (!grid) {
      section.appendChild(this.statsPanelNote(doc, "No chore breakdown is in this report."));
      return true;
    }
    section.appendChild(this.statsPanelTitle(doc, "Chores"));
    if (group !== "day") {
      const list = statsEl(doc, "ul", { class: "bob-stats-panel-chores", "aria-label": "Chore summaries" });
      for (const chore of grid.chores) {
        list.appendChild(statsEl(doc, "li", {}, chore.key + " — " + (chore.display || "–")));
      }
      section.appendChild(list);
      section.appendChild(this.statsPanelNote(doc, "Day-by-day dots return on day grouping; grouped ranges list each chore's supplied days."));
      return true;
    }
    if (!grid.days.length) {
      section.appendChild(this.statsPanelNote(doc, "No chore days are in this range."));
      return true;
    }
    const scroller = statsEl(doc, "div", {
      class: "bob-stats-panel-scroll",
      role: "group",
      tabindex: "0",
      "aria-label": "Chore by day grid. Scroll horizontally for more days.",
    });
    const table = statsEl(doc, "table", { class: "bob-stats-chores" });
    const head = statsEl(doc, "thead", {});
    const headRow = statsEl(doc, "tr", {});
    headRow.appendChild(statsEl(doc, "th", { scope: "col" }, "Chore"));
    for (const day of grid.days) {
      headRow.appendChild(statsEl(doc, "th", { scope: "col" }, day.date.length >= 10 ? day.date.slice(5, 10).replace("-", "/") : day.date));
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = statsEl(doc, "tbody", {});
    for (const chore of grid.chores) {
      const row = statsEl(doc, "tr", {});
      const header = statsEl(doc, "th", { scope: "row" });
      header.appendChild(statsEl(doc, "span", {}, chore.key));
      if (chore.display) {
        header.appendChild(statsEl(doc, "span", { class: "bob-stats-panel-note" }, " · " + chore.display));
      }
      row.appendChild(header);
      for (const day of grid.days) {
        const holder = statsEl(doc, "td", {});
        const state = day.states[chore.key] || "unknown";
        const parts = [chore.key, day.date, day.display, "state: " + state.replace(/_/g, " ")];
        if (day.provisional) {
          parts.push("provisional today");
        }
        if (day.reason) {
          parts.push(day.reason);
        }
        holder.appendChild(this.statsPanelDayCell(doc, view, report, {
          date: day.date,
          label: parts.filter(Boolean).join(" · "),
          focusKey: "panel:chore:" + chore.key + ":" + day.date,
          className: "bob-stats-dot-cell bob-stats-dot-" + state + (day.provisional ? " bob-stats-cal-today" : ""),
          innerClass: "bob-stats-dot",
          text: "●",
        }));
        row.appendChild(holder);
      }
      body.appendChild(row);
    }
    table.appendChild(body);
    scroller.appendChild(table);
    section.appendChild(scroller);
    const legend = statsEl(doc, "div", { class: "bob-stats-chart-legend", "aria-label": "Chore grid legend" });
    legend.appendChild(statsEl(doc, "span", { class: "bob-stats-legend-item" }, "Filled met · outlined missed · blank not due · crossed unknown."));
    section.appendChild(legend);
    return true;
  }
}
