// --- Daily Stats page block (bob-cli-6l page) --------------------------------
// The `bob-stats` code block: header controls, tile row, table view, and
// footer with every honest state. The focus chart, context panels, and
// day interaction below the tile row belong to the charts phase; tiles
// already record the selected focus id in session state for it.
class BobLedgerToolsStatsBlockMixin {
  statsViewStateFor(sourcePath) {
    try {
      if (!(this.statsViewStates instanceof Map)) {
        this.statsViewStates = new Map();
      }
      const key = typeof sourcePath === "string" ? sourcePath : "";
      let state = this.statsViewStates.get(key);
      if (!state) {
        state = statsDefaultViewState();
        this.statsViewStates.set(key, state);
      }
      return state;
    } catch (error) {
      return statsDefaultViewState();
    }
  }

  setupStatsBlock() {
    try {
      if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
        this.registerMarkdownCodeBlockProcessor("bob-stats", (source, el, ctx) =>
          this.renderStatsBlock(el, ctx, source),
        );
      }
    } catch (error) {
      // Block registration is best-effort.
    }
    try {
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "open-stats",
          name: "Open Stats",
          callback: () => {
            try {
              const workspace = this.app && this.app.workspace;
              if (workspace && typeof workspace.openLinkText === "function") {
                void workspace.openLinkText("dash_stats", "", false);
                return;
              }
            } catch (error) {
              // Fall through to the Notice below.
            }
            try {
              new Notice("Could not open Stats");
            } catch (error) {
              // Notice is best-effort.
            }
          },
        });
      }
    } catch (error) {
      // Command registration is best-effort.
    }
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        // Ledger rows are not Tasks lines, so Tasks `cache-update`
        // alone is not enough: any metadata change may move a stat.
        this.registerEvent(
          metadataCache.on("changed", () => this.scheduleStatsRevalidateForFile({})),
        );
      }
    } catch (error) {
      // Revalidation wiring is best-effort.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "delete", "rename"]) {
          this.registerEvent(
            vault.on(event, (file) => this.scheduleStatsRevalidateForFile(file)),
          );
        }
      }
    } catch (error) {
      // Revalidation wiring is best-effort.
    }
    try {
      if (
        typeof this.registerInterval === "function" &&
        typeof window !== "undefined" &&
        typeof window.setInterval === "function"
      ) {
        // Local-date rollover: revalidate mounted Stats views once the
        // day changes.
        this.registerInterval(
          window.setInterval(() => {
            try {
              this.refreshStatsBlocksForRollover(new Date());
            } catch (error) {
              // Rollover is best-effort.
            }
          }, 60 * 1000),
        );
      }
    } catch (error) {
      // Rollover wiring is best-effort.
    }
  }

  teardownStatsBlock() {
    try {
      if (this.statsRevalidateTimer !== null && this.statsRevalidateTimer !== undefined) {
        const clear =
          typeof window !== "undefined" && typeof window.clearTimeout === "function"
            ? window.clearTimeout
            : clearTimeout;
        clear(this.statsRevalidateTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    this.statsRevalidateTimer = null;
    if (this.statsBlockViews instanceof Set) {
      for (const view of this.statsBlockViews) {
        this.statsReleaseChartView(view);
      }
      this.statsBlockViews.clear();
    }
    if (this.statsPaintGens instanceof Map) {
      this.statsPaintGens.clear();
    }
    if (this.statsViewStates instanceof Map) {
      this.statsViewStates.clear();
    }
    if (this.statsCache instanceof Map) {
      this.statsCache.clear();
    }
    this.statsFlight = null;
    this.statsPendingFetch = null;
    this.statsBlockDay = null;
  }

  refreshStatsBlocksForRollover(now) {
    try {
      const day =
        now instanceof Date
          ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
          : "";
      if (!day) {
        return;
      }
      if (this.statsBlockDay === null || this.statsBlockDay === undefined) {
        this.statsBlockDay = day;
        return;
      }
      if (this.statsBlockDay !== day) {
        this.statsBlockDay = day;
        this.revalidateStatsBlocks();
      }
    } catch (error) {
      // Rollover is best-effort.
    }
  }

  renderStatsBlock(el, ctx, source) {
    if (!el) {
      return;
    }
    const sourcePath = ctx && ctx.sourcePath;
    if (!(this.statsBlockViews instanceof Set)) {
      this.statsBlockViews = new Set();
    }
    const fence = statsParseFenceOptions(source);
    const view = { el, sourcePath, fence };
    this.statsBlockViews.add(view);
    if (ctx && typeof ctx.addChild === "function") {
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = () => {
            this.statsReleaseChartView(view);
            if (this.statsBlockViews) {
              this.statsBlockViews.delete(view);
            }
            if (this.statsPaintGens) {
              this.statsPaintGens.delete(el);
            }
          };
        }
      } catch (error) {
        child = null;
      }
      if (!child) {
        child = {
          unload: () => {
            this.statsReleaseChartView(view);
            if (this.statsBlockViews) {
              this.statsBlockViews.delete(view);
            }
            if (this.statsPaintGens) {
              this.statsPaintGens.delete(el);
            }
          },
        };
      }
      try {
        ctx.addChild(child);
      } catch (error) {
        // Older hosts may reject the child; the Set is cleared on unload.
      }
    }
    this.paintStatsBlock(view);
  }

  statsFetchArgsFor(view) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const fence = (view && view.fence) || {};
    const range = state.range || fence.range || undefined;
    return {
      range,
      offset: range === "all" ? 0 : state.offset || 0,
      compare: state.compare === true,
    };
  }

  paintStatsBlock(view) {
    if (!view || !view.el) {
      return;
    }
    if (!(this.statsPaintGens instanceof Map)) {
      this.statsPaintGens = new Map();
    }
    view.pendingStatsFocusKey = view.pendingStatsFocusKey || statsChartActiveFocusKey(view.el);
    const paintGen = (this.statsPaintGens.get(view.el) || 0) + 1;
    this.statsPaintGens.set(view.el, paintGen);
    this.paintStatsSkeleton(view);
    // A rejecting fetch still renders an error card, never an empty block.
    Promise.resolve()
      .then(() =>
        typeof this.apiStatsFetch === "function"
          ? this.apiStatsFetch(this.statsFetchArgsFor(view))
          : { report: null, stale: false, error: { code: "unavailable" } },
      )
      .then(
        (result) => {
          if (this.statsPaintGens.get(view.el) !== paintGen) {
            return;
          }
          this.renderStatsResult(view, result || { report: null });
          statsChartRestoreFocus(view.el, view.pendingStatsFocusKey);
          view.pendingStatsFocusKey = null;
        },
        (error) => {
          if (this.statsPaintGens.get(view.el) !== paintGen) {
            return;
          }
          this.renderStatsResult(view, {
            report: null,
            stale: false,
            error: {
              code: "failed",
              message: String((error && error.message) || error),
              detail: "",
            },
          });
          statsChartRestoreFocus(view.el, view.pendingStatsFocusKey);
          view.pendingStatsFocusKey = null;
        },
      );
  }

  repaintStatsBlocks() {
    try {
      if (!(this.statsBlockViews instanceof Set)) {
        return;
      }
      for (const view of Array.from(this.statsBlockViews)) {
        try {
          this.paintStatsBlock(view);
        } catch (error) {
          // One stale block never breaks the others.
        }
      }
    } catch (error) {
      // Repaint is best-effort.
    }
  }

  revalidateStatsBlocks() {
    // Revalidating keeps the previous frame at reduced opacity until
    // the new one swaps in (see `renderStatsResult`).
    try {
      if (!(this.statsBlockViews instanceof Set) || this.statsBlockViews.size === 0) {
        return;
      }
      for (const view of Array.from(this.statsBlockViews)) {
        try {
          if (view.el && typeof view.el.addClass === "function") {
            view.el.addClass("bob-stats-revalidating");
          } else if (view.el && view.el.classList) {
            view.el.classList.add("bob-stats-revalidating");
          }
        } catch (error) {
          // Opacity marking is best-effort.
        }
      }
      this.repaintStatsBlocks();
    } catch (error) {
      // Revalidation is best-effort.
    }
  }

  paintStatsSkeleton(view) {
    try {
      const doc = statsDocFor(view.el);
      if (!doc) {
        return;
      }
      if (this.statsPaintGens.get(view.el) === undefined) {
        return;
      }
      // Keep an existing frame (revalidation); skeleton only on first paint.
      if (view.el.querySelector && view.el.querySelector(".bob-stats")) {
        return;
      }
      if (typeof view.el.empty === "function") {
        view.el.empty();
      } else {
        view.el.textContent = "";
      }
      const root = statsEl(doc, "div", { class: "bob-stats bob-stats-loading" });
      const tiles = statsEl(doc, "div", { class: "bob-stats-tiles", role: "status", "aria-label": "Stats loading" });
      for (let index = 0; index < STATS_DEFAULT_TILE_COUNT; index += 1) {
        const tile = statsEl(doc, "div", { class: "bob-stats-tile bob-stats-skeleton" });
        tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-label" }, " "));
        tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-value" }, " "));
        tiles.appendChild(tile);
      }
      root.appendChild(tiles);
      view.el.appendChild(root);
    } catch (error) {
      // Skeleton is best-effort.
    }
  }

  renderStatsResult(view, result) {
    try {
      const doc = statsDocFor(view.el);
      if (!doc) {
        return;
      }
      const clearRevalidating = () => {
        try {
          if (view.el && typeof view.el.removeClass === "function") {
            view.el.removeClass("bob-stats-revalidating");
          } else if (view.el && view.el.classList) {
            view.el.classList.remove("bob-stats-revalidating");
          }
        } catch (error) {
          // Class cleanup is best-effort.
        }
      };
      clearRevalidating();
      this.statsReleaseChartView(view);
      if (typeof view.el.empty === "function") {
        view.el.empty();
      } else {
        view.el.textContent = "";
      }
      const root = statsEl(doc, "div", {
        class: "bob-stats",
        role: "region",
        tabindex: "0",
        "aria-label": "Daily Stats",
        "data-stats-focus-key": "stats-root",
      });
      view.el.appendChild(root);
      const report = result && result.report;
      if (!report) {
        view.report = null;
        root.appendChild(this.statsErrorCard(doc, result && result.error, view));
        return;
      }
      view.report = report;
      if (!view.chartId) {
        statsChartSerial += 1;
        view.chartId = "bob-stats-chart-" + statsChartSerial;
      }
      const state = this.statsViewStateFor(view.sourcePath);
      const fence = view.fence || {};
      const ids = statsOverviewIds(report, fence.metrics);
      const metrics = Array.isArray(report.metrics) ? report.metrics.filter((metric) => metric && typeof metric.id === "string") : [];
      const allIds = metrics.map((metric) => metric.id);
      if (!allIds.includes(state.focus)) {
        state.focus = fence.focus && allIds.includes(fence.focus) ? fence.focus : ids[0] || allIds[0] || null;
      }
      root.appendChild(this.statsHeader(doc, view, report));
      root.appendChild(this.statsTiles(doc, view, report));
      const focusMetric = metrics.find((metric) => metric.id === state.focus) || null;
      if (focusMetric) {
        root.appendChild(this.statsChartDrawMetric(doc, view, report, focusMetric));
        const panels = this.statsRenderContextPanels(doc, view, report, focusMetric);
        if (panels) {
          root.appendChild(panels);
        }
      }
      if (state.table) {
        root.appendChild(this.statsTable(doc, view, report));
      }
      this.statsInstallChartKeyboard(root, view, report);
      root.appendChild(this.statsFooter(doc, report));
    } catch (error) {
      // A failed render never leaves an empty block: fall back to text.
      try {
        view.el.textContent = "Stats unavailable.";
      } catch (inner) {
        // Last-resort text is best-effort.
      }
    }
  }

  statsHeader(doc, view, report) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const fence = (view && view.fence) || {};
    const header = statsEl(doc, "div", { class: "bob-stats-header" });
    const title = statsEl(doc, "div", { class: "bob-stats-title" }, "Stats");
    header.appendChild(title);
    const controls = statsEl(doc, "div", { class: "bob-stats-controls", role: "group", "aria-label": "Stats range controls" });
    const activeRange = state.range || fence.range || (report.range && report.range.preset) || STATS_DEFAULT_RANGE;
    for (const chip of STATS_RANGE_CHIPS) {
      const button = statsEl(
        doc,
        "button",
        {
          class: `bob-stats-chip${activeRange === chip.id ? " bob-stats-chip-active" : ""}`,
          type: "button",
          "aria-pressed": activeRange === chip.id ? "true" : "false",
          "data-stats-focus-key": "range-" + chip.id,
        },
        chip.label,
      );
      button.addEventListener("click", () => {
        state.range = chip.id;
        state.offset = 0;
        this.paintStatsBlock(view);
      });
      controls.appendChild(button);
    }
    const custom = statsEl(doc, "button", { class: "bob-stats-chip", type: "button", "data-stats-focus-key": "range-custom" }, "Custom…");
    custom.addEventListener("click", () => {
      this.statsCustomRange(doc, view, controls);
    });
    controls.appendChild(custom);
    const canShift = activeRange !== "all";
    const prev = statsEl(doc, "button", { class: "bob-stats-nav", type: "button", "aria-label": "Previous window", disabled: !canShift, "data-stats-focus-key": "range-previous" }, "‹");
    prev.addEventListener("click", () => {
      state.offset = (state.offset || 0) + 1;
      this.paintStatsBlock(view);
    });
    controls.appendChild(prev);
    const next = statsEl(doc, "button", { class: "bob-stats-nav", type: "button", "aria-label": "Next window", disabled: !canShift || (state.offset || 0) <= 0, "data-stats-focus-key": "range-next" }, "›");
    next.addEventListener("click", () => {
      state.offset = Math.max(0, (state.offset || 0) - 1);
      this.paintStatsBlock(view);
    });
    controls.appendChild(next);
    const compare = statsEl(
      doc,
      "button",
      {
        class: `bob-stats-toggle${state.compare ? " bob-stats-toggle-on" : ""}`,
        type: "button",
        "aria-pressed": state.compare ? "true" : "false",
        "data-stats-focus-key": "compare-toggle",
      },
      "☐ vs prior",
    );
    compare.addEventListener("click", () => {
      state.compare = !state.compare;
      this.paintStatsBlock(view);
    });
    controls.appendChild(compare);
    const table = statsEl(
      doc,
      "button",
      {
        class: `bob-stats-toggle${state.table ? " bob-stats-toggle-on" : ""}`,
        type: "button",
        "aria-pressed": state.table ? "true" : "false",
        "data-stats-focus-key": "table-toggle",
      },
      "▦ Table",
    );
    table.addEventListener("click", () => {
      state.table = !state.table;
      this.statsRenderLocally(view, "table-toggle");
    });
    controls.appendChild(table);
    header.appendChild(controls);
    const windowLabel = statsEl(doc, "div", { class: "bob-stats-window" }, statsWindowLabel(report));
    header.appendChild(windowLabel);
    return header;
  }

  statsCustomRange(doc, view, anchor) {
    try {
      const state = this.statsViewStateFor(view && view.sourcePath);
      if (anchor && anchor.querySelector && anchor.querySelector(".bob-stats-custom")) {
        return;
      }
      const popover = statsEl(doc, "div", { class: "bob-stats-custom", role: "dialog", "aria-label": "Custom range" });
      const start = statsEl(doc, "input", { class: "bob-stats-date", type: "date", "data-stats-focus-key": "range-custom-start" });
      const end = statsEl(doc, "input", { class: "bob-stats-date", type: "date", "data-stats-focus-key": "range-custom-end" });
      const apply = statsEl(doc, "button", { class: "bob-stats-chip", type: "button", "data-stats-focus-key": "range-custom-apply" }, "Apply");
      apply.addEventListener("click", () => {
        const from = start.value || (start.getAttribute && start.getAttribute("value")) || "";
        const to = end.value || (end.getAttribute && end.getAttribute("value")) || "";
        const normalized = statsNormalizeRange(`${from}..${to}`, "");
        if (normalized) {
          state.range = normalized;
          state.offset = 0;
          view.pendingStatsFocusKey = "range-custom";
          this.paintStatsBlock(view);
        }
        try {
          popover.remove();
        } catch (error) {
          // Popover cleanup is best-effort.
        }
      });
      popover.appendChild(start);
      popover.appendChild(end);
      popover.appendChild(apply);
      anchor.appendChild(popover);
    } catch (error) {
      // Custom range is best-effort.
    }
  }

  statsTiles(doc, view, report) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const fence = (view && view.fence) || {};
    const ids = statsOverviewIds(report, fence.metrics);
    const byId = new Map(
      (report.metrics || [])
        .filter((metric) => metric && typeof metric.id === "string")
        .map((metric) => [metric.id, metric]),
    );
    const row = statsEl(doc, "div", { class: "bob-stats-tiles" });
    for (const id of ids) {
      const model = statsTileModel(byId.get(id));
      const selected = state.focus === id;
      const tile = statsEl(doc, "div", {
        class: `bob-stats-tile bob-stats-hue-${model.color}${selected ? " bob-stats-tile-selected" : ""}`,
        role: "button",
        tabindex: "0",
        "data-stats-focus-key": "tile:" + id,
        "aria-label": `${model.label}: ${model.headline}${model.deltaWords ? `, ${model.deltaWords}` : ""}`,
      });
      tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-label" }, model.label.toUpperCase()));
      tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-value" }, model.headline));
      if (model.suffix) {
        tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-suffix" }, model.suffix));
      }
      if (model.delta) {
        tile.appendChild(statsEl(doc, "div", { class: "bob-stats-tile-delta" }, model.delta));
      } else if (model.quality === "not_tracked") {
        const since = statsTrackingSince(report);
        tile.appendChild(
          statsEl(doc, "div", { class: "bob-stats-tile-delta" }, since ? `Tracking since ${since}` : "Not tracked yet"),
        );
      }
      const spark = statsEl(doc, "div", { class: "bob-stats-spark", "aria-hidden": "true" });
      for (const bar of statsSparkBars(model.spark)) {
        const classes = ["bob-stats-bar"];
        if (bar.empty) {
          classes.push("bob-stats-bar-null");
        }
        if (bar.zero) {
          classes.push("bob-stats-bar-zero");
        }
        if (bar.provisional) {
          classes.push("bob-stats-bar-today");
        }
        const node = statsEl(doc, "div", { class: classes.join(" ") });
        if (!bar.empty && !bar.zero) {
          try {
            node.setAttribute("style", `height: ${Math.round(bar.height * 100)}%`);
          } catch (error) {
            // Bar height is best-effort.
          }
        }
        spark.appendChild(node);
      }
      tile.appendChild(spark);
      const select = () => {
        state.focus = id;
        this.statsRenderLocally(view, "tile:" + id);
      };
      tile.addEventListener("click", select);
      tile.addEventListener("keydown", (event) => {
        if ((event && event.key === "Enter") || (event && event.key === " ")) {
          if (event.preventDefault) {
            event.preventDefault();
          }
          select();
        }
      });
      row.appendChild(tile);
    }
    return row;
  }

  statsTable(doc, view, report) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const metric = (report.metrics || []).find((entry) => entry && entry.id === state.focus) || null;
    const wrap = statsEl(doc, "div", { class: "bob-stats-table-wrap" });
    if (!metric) {
      wrap.appendChild(statsEl(doc, "div", { class: "bob-stats-table-empty" }, "No data."));
      return wrap;
    }
    const table = statsEl(doc, "table", { class: "bob-stats-table" });
    const head = statsEl(doc, "thead", {});
    const headRow = statsEl(doc, "tr", {});
    for (const label of ["Date", "Value", "Quality", "Top parts"]) {
      headRow.appendChild(statsEl(doc, "th", {}, label));
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = statsEl(doc, "tbody", {});
    for (const row of statsTableRows(metric, undefined, report)) {
      const line = statsEl(doc, "tr", {});
      line.appendChild(statsEl(doc, "td", {}, row.date + (row.provisional ? " (today)" : "")));
      line.appendChild(statsEl(doc, "td", {}, row.display));
      const qualityText = row.quality === "ok" ? "ok" : `${row.quality}${row.reason ? ` — ${row.reason}` : ""}`;
      line.appendChild(statsEl(doc, "td", {}, qualityText));
      const partsText = row.topParts
        .map((part) => `${part.dimension}:${part.label || part.key} ${part.value}`)
        .join(" · ");
      line.appendChild(statsEl(doc, "td", {}, partsText));
      body.appendChild(line);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    const copy = statsEl(doc, "button", { class: "bob-stats-chip", type: "button", "data-stats-focus-key": "copy-csv" }, "Copy CSV");
    copy.addEventListener("click", async () => {
      try {
        const csv = statsCsv(report);
        const clipboard =
          (typeof navigator !== "undefined" && navigator.clipboard) || null;
        if (clipboard && typeof clipboard.writeText === "function") {
          await clipboard.writeText(csv);
          new Notice("Stats CSV copied");
        }
      } catch (error) {
        try {
          new Notice("Could not copy Stats CSV");
        } catch (inner) {
          // Notice is best-effort.
        }
      }
    });
    wrap.appendChild(copy);
    return wrap;
  }

  statsFooter(doc, report) {
    const footer = statsEl(doc, "div", { class: "bob-stats-footer" });
    const hosts =
      report && report.health && report.health.journal && Array.isArray(report.health.journal.hosts)
        ? report.health.journal.hosts
        : [];
    const hostText = hosts
      .map((host) => {
        const name = host && typeof host.host === "string" ? host.host : "?";
        const last = host && typeof host.last_ts === "string" ? host.last_ts : "";
        return last ? `${name} ${last}` : `${name}`;
      })
      .join(" · ");
    footer.appendChild(
      statsEl(doc, "div", { class: "bob-stats-provenance" }, `Derived by bob stats${hostText ? ` · journal: ${hostText}` : ""}`),
    );
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];
    if (warnings.length > 0) {
      const list = statsEl(doc, "ul", { class: "bob-stats-warnings" });
      for (const warning of warnings) {
        if (!warning || typeof warning !== "object") {
          continue;
        }
        const code = typeof warning.code === "string" ? warning.code : "warning";
        const message = typeof warning.message === "string" ? warning.message : "";
        list.appendChild(statsEl(doc, "li", {}, message ? `${message} (${code})` : code));
      }
      footer.appendChild(list);
    }
    return footer;
  }

  statsErrorCard(doc, error, view) {
    const tried =
      error && Array.isArray(error.tried) ? error.tried : statsBobTriedList({});
    const model = statsErrorModel(error || { code: "failed" }, { tried });
    const card = statsEl(doc, "div", { class: "bob-stats-error", role: "alert" });
    card.appendChild(statsEl(doc, "div", { class: "bob-stats-error-title" }, model.title));
    card.appendChild(statsEl(doc, "div", { class: "bob-stats-error-hint" }, model.hint));
    if (model.retry) {
      const retry = statsEl(doc, "button", { class: "bob-stats-chip", type: "button" }, "Retry");
      retry.addEventListener("click", () => {
        this.paintStatsBlock(view);
      });
      card.appendChild(retry);
    }
    return card;
  }
}
