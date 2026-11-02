// Stats clock selection, compatibility, and device preference. Clock values
// are report-driven; this fragment never derives a metric or its breakdown.
const STATS_CLOCK_VALUES = ["worked", "off-clock", "total"];
const STATS_CLOCK_GLYPHS = {
  worked: "●",
  "off-clock": "◌",
  total: "◐",
};
const STATS_CLOCK_STORAGE_KEY = "bob-ledger-tools-stats-clock";

function statsNormalizeClock(value, fallback = "worked") {
  try {
    const text = typeof value === "string" ? value.trim() : "";
    return STATS_CLOCK_VALUES.includes(text) ? text : fallback;
  } catch (error) {
    return fallback;
  }
}

// A report is clock-capable only when it contains all three report-authored
// options and a real adoption date. Older schema-1 reports remain usable.
function statsClockCapability(report) {
  try {
    const clock = report && typeof report === "object" ? report.clock : null;
    if (!clock || typeof clock !== "object" || !statsNormalizeClock(clock.value, null) ||
        typeof clock.since !== "string" || !clock.since.trim()) {
      return null;
    }
    const raw = Array.isArray(clock.options) ? clock.options : [];
    const seen = new Set();
    const options = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const value = statsNormalizeClock(item.value, null);
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      options.push({
        value,
        label: typeof item.label === "string" ? item.label : "",
        description: typeof item.description === "string" ? item.description : "",
        display: typeof item.display === "string" ? item.display : "",
      });
    }
    if (STATS_CLOCK_VALUES.some((value) => !seen.has(value))) {
      return null;
    }
    return { since: clock.since, options };
  } catch (error) {
    return null;
  }
}

// Wrap long clock values only at their " · " separators: each segment keeps
// non-breaking spaces so "1h 05m" never splits, while the row may break
// between segments. This shrinks min-content so 360 px viewports fit.
function statsClockWrapValue(text) {
  try {
    if (typeof text !== "string" || !text) return text;
    return text
      .split(" · ")
      .map((segment) => segment.replace(/ /g, "\u00A0"))
      .join(" · ");
  } catch (error) {
    return text;
  }
}

function statsMetricEffectiveClock(metric, report) {
  try {
    const safe = metric && typeof metric === "object" ? metric : {};
    if (safe.kind !== "pomodoro") {
      return null;
    }
    const parameters = safe.parameters && typeof safe.parameters === "object" ? safe.parameters : {};
    const pinned = parameters.clock && typeof parameters.clock === "object"
      ? parameters.clock.value
      : parameters.clock;
    const pinnedClock = statsNormalizeClock(pinned, null);
    if (pinnedClock) {
      return pinnedClock;
    }
    const topLevel = report && report.clock && typeof report.clock === "object"
      ? statsNormalizeClock(report.clock.value, null)
      : null;
    return topLevel || "worked";
  } catch (error) {
    return metric && metric.kind === "pomodoro" ? "worked" : null;
  }
}

// Keep Bob's values and display strings intact. Invalid or incomplete detail
// is absent; callers must never turn it into an inferred zero split.
function statsClockBreakdown(value) {
  try {
    const safe = value && typeof value === "object" ? value : null;
    if (!safe) {
      return null;
    }
    const component = (raw) => {
      if (!raw || typeof raw !== "object" || typeof raw.value !== "number" ||
          !Number.isFinite(raw.value) || raw.value < 0 ||
          typeof raw.display !== "string" || !raw.display.trim()) {
        return null;
      }
      return { value: raw.value, display: raw.display };
    };
    const worked = component(safe.worked);
    const offClock = component(safe.off_clock);
    return worked && offClock ? { worked, off_clock: offClock } : null;
  } catch (error) {
    return null;
  }
}

function statsPartsClockBreakdown(value) {
  try {
    const safe = value && typeof value === "object" ? value : null;
    if (!safe) {
      return null;
    }
    const result = {};
    for (const dimension of ["theme", "area", "root_parent", "project"]) {
      const entries = safe[dimension];
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        continue;
      }
      const parsed = {};
      for (const [key, breakdown] of Object.entries(entries)) {
        const clean = statsClockBreakdown(breakdown);
        if (clean) {
          parsed[key] = clean;
        }
      }
      if (Object.keys(parsed).length) {
        result[dimension] = parsed;
      }
    }
    return Object.keys(result).length ? result : null;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsStatsClockMixin {
  statsLoadClockPreference() {
    if (this.statsClockPreferenceLoaded === true) {
      return statsNormalizeClock(this.statsClockPreference);
    }
    this.statsClockPreferenceLoaded = true;
    this.statsClockPreference = "worked";
    try {
      const app = this.app;
      if (app && typeof app.loadLocalStorage === "function") {
        this.statsClockPreference = statsNormalizeClock(app.loadLocalStorage(STATS_CLOCK_STORAGE_KEY));
      }
    } catch (error) {
      // A blocked storage API leaves the in-memory Worked default usable.
    }
    this.statsClockPrefetchScheduled = new Map();
    this.statsClockIdleTasks = new Set();
    return this.statsClockPreference;
  }

  statsClockObserveReport(view, report, requestedClock) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const capability = statsClockCapability(report);
    if (!capability) {
      if (view) {
        view.statsClockSupported = false;
      }
      return statsNormalizeClock(requestedClock) === "worked" ? "ready" : "retry";
    }
    if (view) {
      view.statsClockSupported = true;
    }
    if (!view.statsClockPreferenceApplied) {
      view.statsClockPreferenceApplied = true;
      if (statsNormalizeClock(state.clock) === "worked" && this.statsClockPreference !== "worked") {
        state.clock = statsNormalizeClock(this.statsClockPreference);
      }
    }
    return statsNormalizeClock(state.clock) === statsNormalizeClock(requestedClock) ? "ready" : "retry";
  }

  statsSetClockForView(view, value, options = {}) {
    try {
      const clock = statsNormalizeClock(value, null);
      if (!clock || !view || view.statsClockSupported !== true || !statsClockCapability(view.report)) {
        return false;
      }
      const state = this.statsViewStateFor(view.sourcePath);
      if (state.clock === clock) {
        return false;
      }
      state.clock = clock;
      view.statsClockPreferenceApplied = true;
      this.statsClockPreference = clock;
      this.statsClockPreferenceLoaded = true;
      if (options.persist !== false) {
        try {
          const app = this.app;
          if (app && typeof app.saveLocalStorage === "function") {
            app.saveLocalStorage(STATS_CLOCK_STORAGE_KEY, clock);
          }
        } catch (error) {
          // Keep the in-memory preference operational when storage is blocked.
        }
      }
      if (options.paint !== false) {
        this.paintStatsBlock(view);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  statsClockControl(doc, view, report) {
    const capability = statsClockCapability(report);
    if (!capability) {
      return null;
    }
    const state = this.statsViewStateFor(view && view.sourcePath);
    const group = statsEl(doc, "fieldset", {
      class: "bob-stats-clock-control",
      "aria-label": "Stats clock",
    });
    group.appendChild(statsEl(doc, "legend", { class: "bob-stats-clock-legend" }, "Clock"));
    for (const option of capability.options) {
      const label = option.label || option.value;
      const detail = [label, option.description, option.display].filter(Boolean).join(" · ");
      const row = statsEl(doc, "label", {
        class: "bob-stats-clock-option",
        title: detail,
      });
      const radio = statsEl(doc, "input", {
        type: "radio",
        name: "stats-clock-" + String(view && view.chartId || "view"),
        value: option.value,
        "data-stats-focus-key": "clock-" + option.value,
        "aria-label": detail || label,
      });
      radio.checked = statsNormalizeClock(state.clock) === option.value;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.statsSetClockForView(view, option.value);
        }
      });
      row.appendChild(radio);
      row.appendChild(statsEl(doc, "span", { class: "bob-stats-clock-glyph", "aria-hidden": "true" }, STATS_CLOCK_GLYPHS[option.value]));
      row.appendChild(statsEl(doc, "span", { class: "bob-stats-clock-label" }, label));
      if (option.display) {
        row.appendChild(statsEl(doc, "span", { class: "bob-stats-clock-display" }, option.display));
      }
      group.appendChild(row);
    }
    return group;
  }

  statsInstallClockShortcut(root, view, report) {
    if (!root || typeof root.addEventListener !== "function") {
      return;
    }
    root.addEventListener("keydown", (event) => {
      if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      if (String(event.key || "").toLowerCase() !== "c") {
        return;
      }
      const target = event.target || null;
      const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button" ||
          (target && target.isContentEditable)) {
        return;
      }
      const capability = statsClockCapability(report);
      if (!capability || view.statsClockSupported !== true) {
        return;
      }
      const current = statsNormalizeClock(this.statsViewStateFor(view.sourcePath).clock);
      const index = STATS_CLOCK_VALUES.indexOf(current);
      const next = STATS_CLOCK_VALUES[(index + 1) % STATS_CLOCK_VALUES.length];
      if (this.statsSetClockForView(view, next)) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
      }
    });
  }

  statsScheduleClockPrefetch(view, report, request, enabled = true) {
    if (!enabled || !statsClockCapability(report) || !statsBlockViewIsShown(view)) {
      return;
    }
    try {
      const currentKey = statsRequestFor(this.statsFetchArgsFor(view)).key;
      if (currentKey !== request.key) {
        return;
      }
      const current = this.statsFetchArgsFor(view);
      for (const clock of STATS_CLOCK_VALUES) {
        if (clock === current.clock) {
          continue;
        }
        const options = { ...current, clock };
        const targetKey = statsRequestFor(options).key;
        const peek = this.statsPeek(options);
        if ((peek && !peek.dirty) || this.statsClockPrefetchScheduled.has(targetKey) ||
            (this.statsFlight && this.statsFlight.key === targetKey) ||
            this.statsPendingByKeyStore().has(targetKey)) {
          continue;
        }
        this.statsScheduleOneClockPrefetch(view, report, request.key, targetKey, options, 0);
      }
    } catch (error) {
      // Idle prefetch is optional; a failed eligibility check does not affect paint.
    }
  }

  statsScheduleOneClockPrefetch(view, report, sourceKey, targetKey, options, attempt) {
    const scheduled = this.statsClockPrefetchScheduled instanceof Map
      ? this.statsClockPrefetchScheduled
      : (this.statsClockPrefetchScheduled = new Map());
    if (scheduled.has(targetKey)) {
      return;
    }
    const record = { handle: null };
    scheduled.set(targetKey, record);
    const run = () => {
      if (record.handle && this.statsClockIdleTasks instanceof Set) {
        this.statsClockIdleTasks.delete(record.handle);
      }
      record.handle = null;
      if (scheduled.get(targetKey) !== record) {
        return;
      }
      try {
        if (!this.statsBlockViews || !this.statsBlockViews.has(view) || !statsBlockViewIsShown(view) ||
            statsRequestFor(this.statsFetchArgsFor(view)).key !== sourceKey ||
            !statsClockCapability(report)) {
          scheduled.delete(targetKey);
          return;
        }
        const cached = this.statsPeek(options);
        if (cached && !cached.dirty) {
          scheduled.delete(targetKey);
          return;
        }
        const busy = Boolean(this.statsFlight || this.statsPendingQueueStore().length);
        if (busy && attempt < 6) {
          scheduled.delete(targetKey);
          this.statsScheduleOneClockPrefetch(view, report, sourceKey, targetKey, options, attempt + 1);
          return;
        }
        scheduled.delete(targetKey);
        if (busy) {
          return;
        }
        void this.apiStatsFetch({ ...options, prefetch: true });
      } catch (error) {
        scheduled.delete(targetKey);
      }
    };
    const handle = { cancel: () => {} };
    record.handle = handle;
    if (!(this.statsClockIdleTasks instanceof Set)) {
      this.statsClockIdleTasks = new Set();
    }
    this.statsClockIdleTasks.add(handle);
    try {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(run, { timeout: 1500 });
        handle.cancel = () => {
          try {
            if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id);
          } catch (error) {
            // Cancellation is best-effort.
          }
        };
      } else {
        const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout.bind(window)
          : setTimeout;
        const clear = typeof window !== "undefined" && typeof window.clearTimeout === "function"
          ? window.clearTimeout.bind(window)
          : clearTimeout;
        const id = schedule(run, 100);
        handle.cancel = () => clear(id);
      }
    } catch (error) {
      this.statsClockIdleTasks.delete(handle);
      scheduled.delete(targetKey);
    }
  }

  statsCancelClockPrefetch() {
    try {
      for (const handle of this.statsClockIdleTasks instanceof Set ? this.statsClockIdleTasks : []) {
        try {
          handle.cancel();
        } catch (error) {
          // One timer failure does not block the rest.
        }
      }
      if (this.statsClockIdleTasks instanceof Set) this.statsClockIdleTasks.clear();
      if (this.statsClockPrefetchScheduled instanceof Map) this.statsClockPrefetchScheduled.clear();
      const queue = this.statsPendingQueueStore();
      const byKey = this.statsPendingByKeyStore();
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const entry = queue[index];
        if (!entry || entry.prefetch !== true) continue;
        queue.splice(index, 1);
        byKey.delete(entry.key);
        const cancelled = statsCancelledResult();
        for (const waiter of (entry.waiters || []).splice(0)) {
          try { waiter(cancelled); } catch (error) { /* best-effort */ }
        }
      }
    } catch (error) {
      // Teardown remains safe if idle APIs or cache internals are unavailable.
    }
  }
}
