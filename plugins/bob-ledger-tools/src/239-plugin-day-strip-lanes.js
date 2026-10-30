// Day strip lane switch: one global view (both, roots only, themes only)
// across every strip on this device. Pure layout plus a small mixin that
// owns the in-memory view, device persistence, and synchronous repaint.
// Never throws into Obsidian.
const DAY_STRIP_LANE_VIEWS = ["both", "roots", "themes"];
const DAY_STRIP_LANES_STORAGE_KEY = "bob-ledger-tools-day-strip-bars";

function dayStripLaneViewOf(value) {
  try {
    return DAY_STRIP_LANE_VIEWS.includes(value) ? value : "both";
  } catch (error) {
    return "both";
  }
}

function dayStripNextLaneView(view) {
  try {
    const current = dayStripLaneViewOf(view);
    const index = DAY_STRIP_LANE_VIEWS.indexOf(current);
    return DAY_STRIP_LANE_VIEWS[(index + 1) % DAY_STRIP_LANE_VIEWS.length];
  } catch (error) {
    return "roots";
  }
}

// Layout for the switch and the painted lanes. Never throws. On error it
// reports both with today's shown lanes and no switch.
function dayStripLaneLayout(input) {
  try {
    const safe = input && typeof input === "object" ? input : {};
    const state = typeof safe.state === "string" ? safe.state : "";
    const mix = safe.mix && typeof safe.mix === "object" ? safe.mix : null;
    const themes = safe.themes && typeof safe.themes === "object" ? safe.themes : null;
    const view = dayStripLaneViewOf(safe.view);
    const next = dayStripNextLaneView(view);
    const rootsAvailable = Boolean(mix && mix.omitted !== true);
    const themesAvailable = Boolean(themes && themes.omitted !== true);
    const rootsName = mix && mix.dimension === "area" ? "areas" : "root parents";
    let title = "";
    let ariaLabel = "";
    if (view === "both") {
      title = "Showing " + rootsName + " and types \u00b7 click for " + rootsName + " only";
      ariaLabel = "Day stats bars: " + rootsName + " and types. Activate for " + rootsName + " only.";
    } else if (view === "roots") {
      title = "Showing " + rootsName + " only \u00b7 click for types only";
      ariaLabel = "Day stats bars: " + rootsName + " only. Activate for types only.";
    } else {
      title = "Showing types only \u00b7 click for both";
      ariaLabel = "Day stats bars: types only. Activate for " + rootsName + " and types.";
    }
    if (state === "skeleton") {
      const shown = view === "both" ? ["roots", "themes"] : [view];
      return {
        view,
        shown,
        switchable: Boolean(rootsAvailable && themesAvailable),
        next,
        title,
        ariaLabel,
      };
    }
    if (state === "ready" || state === "stale") {
      const switchable = Boolean(rootsAvailable && themesAvailable);
      let shown = [];
      if (view === "both") {
        if (rootsAvailable) shown.push("roots");
        if (themesAvailable) shown.push("themes");
      } else if (view === "roots") {
        if (rootsAvailable) shown = ["roots"];
        else if (themesAvailable) shown = ["themes"];
      } else {
        if (themesAvailable) shown = ["themes"];
        else if (rootsAvailable) shown = ["roots"];
      }
      return { view, shown, switchable, next, title, ariaLabel };
    }
    return { view, shown: [], switchable: false, next, title, ariaLabel };
  } catch (error) {
    return {
      view: "both",
      shown: [],
      switchable: false,
      next: "roots",
      title: "Showing root parents and types \u00b7 click for root parents only",
      ariaLabel: "Day stats bars: root parents and types. Activate for root parents only.",
    };
  }
}

class BobLedgerToolsDayStripLanesMixin {
  dayStripLaneViewCurrent() {
    try {
      return dayStripLaneViewOf(this.dayStripLaneView);
    } catch (error) {
      return "both";
    }
  }

  dayStripLoadLaneView() {
    try {
      if (typeof this.dayStripLaneView !== "string") {
        this.dayStripLaneView = "both";
      }
      try {
        const app = this.app;
        if (!app || typeof app.loadLocalStorage !== "function") {
          return this.dayStripLaneViewCurrent();
        }
        const stored = app.loadLocalStorage(DAY_STRIP_LANES_STORAGE_KEY);
        this.dayStripLaneView = dayStripLaneViewOf(stored);
        return this.dayStripLaneView;
      } catch (error) {
        return this.dayStripLaneViewCurrent();
      }
    } catch (error) {
      return "both";
    }
  }

  dayStripSetLaneView(view, opts) {
    try {
      const sane = dayStripLaneViewOf(view);
      this.dayStripLaneView = sane;
      try {
        if (this.app && typeof this.app.saveLocalStorage === "function") {
          this.app.saveLocalStorage(DAY_STRIP_LANES_STORAGE_KEY, sane);
        }
      } catch (error) {
        // A missing API or a throwing write keeps the in-memory view silently.
      }
      try {
        const store = typeof this.dayStripViewsStore === "function"
          ? this.dayStripViewsStore()
          : this.dayStripViews;
        if (store && typeof store[Symbol.iterator] === "function") {
          for (const record of Array.from(store)) {
            try {
              if (record) record.paintedKey = null;
            } catch (error) {
              // Painted-key reset is best-effort.
            }
            try {
              this.dayStripPaint(record);
            } catch (error) {
              // One stale strip never breaks the others.
            }
          }
        }
      } catch (error) {
        // Repaint is best-effort.
      }
      try {
        const from = opts && opts.focusFrom ? opts.focusFrom : null;
        if (from) {
          let sw = null;
          try {
            if (from.querySelector && typeof from.querySelector === "function") {
              sw = from.querySelector(".bob-day-strip-lanes");
            }
          } catch (error) {
            sw = null;
          }
          if (!sw && typeof dayStripFitFindByClass === "function") {
            try {
              const found = dayStripFitFindByClass(from, "bob-day-strip-lanes");
              sw = (found && found[0]) || null;
            } catch (error) {
              sw = null;
            }
          }
          if (sw && typeof sw.focus === "function") {
            try {
              sw.focus({ preventScroll: true });
            } catch (error) {
              try {
                sw.focus();
              } catch (inner) {
                // Focus is best-effort.
              }
            }
          }
        }
      } catch (error) {
        // Focus restore is best-effort.
      }
      return sane;
    } catch (error) {
      return "both";
    }
  }

  dayStripCycleLaneView(opts) {
    try {
      const current = this.dayStripLaneViewCurrent();
      return this.dayStripSetLaneView(dayStripNextLaneView(current), opts);
    } catch (error) {
      return "both";
    }
  }
}
