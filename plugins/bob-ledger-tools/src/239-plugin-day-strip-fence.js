// Day strip fence and Stats hand-off: the `bob-day-stats` code block
// host and `openStatsForDay`, which opens Stats with the day pinned.
class BobLedgerToolsDayStripFenceMixin {
  // The `bob-day-stats` fence: an optional `day: YYYY-MM-DD` body, else
  // the note's own date. A fence placed inside a daily note simply
  // renders its own strip. Nothing on mobile or wherever `bob` cannot
  // spawn, and never an error card there. Never throws.
  renderDayStripFence(el, ctx, source) {
    if (!el) {
      return;
    }
    try {
      try {
        if (el.closest && typeof el.closest === "function") {
          if (el.closest(".hover-popover, .markdown-embed")) {
            return;
          }
        }
      } catch (error) {
        // Hover/embed detection is best-effort.
      }
      const sourcePath =
        ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      let day = dayStripParseFenceDay(source);
      if (!day) {
        day = dayStripDayForPath(sourcePath);
      }
      if (!day) {
        try {
          if (typeof el.empty === "function") {
            el.empty();
          } else {
            el.textContent = "";
          }
          const doc = statsDocFor(el);
          const note = statsEl(
            doc,
            "div",
            { class: "bob-day-strip-fence-note" },
            "bob-day-stats needs a daily note or a day: YYYY-MM-DD line.",
          );
          if (note) {
            el.appendChild(note);
          }
        } catch (error) {
          // Muted-line fallback is best-effort.
        }
        return;
      }
      if (!this.dayStripCanSpawn()) {
        return;
      }
      const record = {
        el,
        day,
        path: sourcePath,
        kind: "fence",
        observer: null,
        visible: true,
      };
      this.dayStripViewsStore().add(record);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              this.dayStripReleaseRecord(record);
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              this.dayStripReleaseRecord(record);
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject the child; the set clears on unload.
        }
      }
      this.dayStripObserve(record);
      this.dayStripPaint(record);
      this.dayStripCheck(record);
    } catch (error) {
      // Fence rendering never breaks the note.
    }
  }

  // Open Stats with D pinned (and `metric` focused): resolve `dash_stats`
  // against `sourcePath`, write that path's view state, keep the page's
  // window when it already shows D (else a 28-day window ending on D),
  // scroll a requested panel into view on first paint, repaint a mounted
  // view, then reveal the open leaf or open it like a link click.
  // An explicit `clock` ("worked", "off-clock", "total") selects that
  // lens for this navigation through the Stats clock controller and
  // persists it as the device preference; calls without one retain the
  // saved dash preference. Ordinary Day strip facts and lanes pass
  // `clock: "worked"` so a remembered Off-clock choice never changes
  // their meaning. Never clears the pin while capability resolves.
  // Returns true when Stats was revealed or opened. Never throws.
  async openStatsForDay(options) {
    const opts = options && typeof options === "object" ? options : {};
    const day = typeof opts.day === "string" ? opts.day : "";
    const sourcePath =
      typeof opts.sourcePath === "string" ? opts.sourcePath : "";
    try {
      if (!dayStripDateParts(day)) {
        throw new Error("Day strip needs a valid day to open Stats.");
      }
      let dashPath = "dash_stats";
      try {
        const metadataCache = this.app && this.app.metadataCache;
        if (
          metadataCache &&
          typeof metadataCache.getFirstLinkpathDest === "function"
        ) {
          const dest = metadataCache.getFirstLinkpathDest(
            "dash_stats",
            sourcePath,
          );
          if (dest && typeof dest.path === "string" && dest.path) {
            dashPath = dest.path;
          }
        }
      } catch (error) {
        // Link resolution is best-effort.
      }
      const state = this.statsViewStateFor(dashPath);
      state.pinnedDay = day;
      state.pinnedBucket = null;
      if (typeof opts.metric === "string" && opts.metric) {
        state.focus = opts.metric;
      }
      try {
        const explicit = typeof statsNormalizeClock === "function"
          ? statsNormalizeClock(opts.clock, null)
          : (typeof opts.clock === "string" && (opts.clock === "worked" || opts.clock === "off-clock" || opts.clock === "total") ? opts.clock : null);
        if (explicit) {
          state.clock = explicit;
          try {
            this.statsClockPreference = explicit;
            this.statsClockPreferenceLoaded = true;
            const app = this.app;
            if (app && typeof app.saveLocalStorage === "function") {
              app.saveLocalStorage(STATS_CLOCK_STORAGE_KEY, explicit);
            }
          } catch (error) {
            // Preference persistence is best-effort.
          }
          try {
            if (this.statsBlockViews instanceof Set) {
              for (const view of this.statsBlockViews) {
                if (view && view.sourcePath === dashPath) {
                  view.statsClockPreferenceApplied = true;
                }
              }
            }
          } catch (error) {
            // Preference-applied marking is best-effort.
          }
        }
      } catch (error) {
        // Explicit clock handling never breaks the hand-off.
      }
      let inside = false;
      try {
        let report = null;
        if (this.statsBlockViews instanceof Set) {
          for (const view of this.statsBlockViews) {
            if (view && view.sourcePath === dashPath && view.report) {
              report = view.report;
              break;
            }
          }
        }
        inside = dayStripDayInReportWindow(day, report);
      } catch (error) {
        inside = false;
      }
      if (!inside) {
        state.range = dayStripShiftDay(day, -27) + ".." + day;
        state.offset = 0;
      }
      if (opts.panel === "themes") {
        state.revealPanel = "homes";
        state.homesView = "themes";
      } else if (opts.panel === "homes") {
        state.revealPanel = "homes";
        state.homesView = "roots";
      }
      try {
        if (this.statsBlockViews instanceof Set) {
          for (const view of Array.from(this.statsBlockViews)) {
            if (view && view.sourcePath === dashPath) {
              try {
                this.paintStatsBlock(view);
              } catch (error) {
                // One stale block never breaks the hand-off.
              }
            }
          }
        }
      } catch (error) {
        // Repaint is best-effort.
      }
      const workspace = this.app && this.app.workspace;
      let leaf = null;
      try {
        leaf = findOpenMarkdownLeafByPath(this.app, dashPath);
      } catch (error) {
        leaf = null;
      }
      if (leaf && workspace && opts.newLeaf !== true) {
        try {
          if (typeof workspace.revealLeaf === "function") {
            await workspace.revealLeaf(leaf);
          }
          if (typeof workspace.setActiveLeaf === "function") {
            await workspace.setActiveLeaf(leaf, { focus: true });
          }
          return true;
        } catch (error) {
          // Fall through to openLinkText below.
        }
      }
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(
          "dash_stats",
          sourcePath,
          opts.newLeaf === true,
        );
        return true;
      }
      throw new Error("Stats cannot be opened from here.");
    } catch (error) {
      try {
        new Notice("Could not open Stats");
      } catch (inner) {
        // Notice is best-effort.
      }
      return false;
    }
  }
}
