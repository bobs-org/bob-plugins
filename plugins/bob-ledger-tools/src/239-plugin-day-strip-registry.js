// Day strip registry and refresh policy: the strip record set, the
// synchronous cache-first paint, the visible/dirty/aged re-run gate
// behind the shared single-flight queue, rollover, and the host setup
// and teardown wired from `setupStatsBlock` / `teardownStatsBlock`.
class BobLedgerToolsDayStripMixin {
  dayStripViewsStore() {
    if (!(this.dayStripViews instanceof Set)) {
      this.dayStripViews = new Set();
    }
    return this.dayStripViews;
  }

  // False on mobile and wherever `bob` cannot spawn. Never throws.
  dayStripCanSpawn() {
    try {
      if (this.dayStripSpawnDisabled === true) {
        return false;
      }
      if (
        typeof Platform !== "undefined" &&
        Platform &&
        Platform.isDesktopApp === false
      ) {
        return false;
      }
    } catch (error) {
      return false;
    }
    try {
      const childProcess = planRequireOptionalNodeModule("child_process");
      if (
        !childProcess ||
        typeof childProcess.execFile !== "function"
      ) {
        return false;
      }
    } catch (error) {
      return false;
    }
    return true;
  }

  // Local today behind a seam tests stub to simulate rollover. Never
  // throws.
  dayStripLocalNow() {
    try {
      return dayStripLocalToday(new Date());
    } catch (error) {
      return "";
    }
  }

  // Per-device collapse, shared by every strip on this device. Vault
  // reads and writes never happen here. Never throws.
  dayStripIsCollapsed() {
    try {
      if (
        this.app &&
        typeof this.app.loadLocalStorage === "function"
      ) {
        const value = this.app.loadLocalStorage(DAY_STRIP_COLLAPSE_KEY);
        return value === true || value === "true";
      }
    } catch (error) {
      // Fall through to window storage below.
    }
    try {
      if (
        typeof window !== "undefined" &&
        window &&
        window.localStorage &&
        typeof window.localStorage.getItem === "function"
      ) {
        return window.localStorage.getItem(DAY_STRIP_COLLAPSE_KEY) === "true";
      }
    } catch (error) {
      // Storage is best-effort.
    }
    return false;
  }

  dayStripSetCollapsed(value) {
    const collapsed = value === true;
    try {
      if (this.app && typeof this.app.saveLocalStorage === "function") {
        this.app.saveLocalStorage(DAY_STRIP_COLLAPSE_KEY, collapsed);
      }
    } catch (error) {
      // Storage is best-effort.
    }
    try {
      if (
        typeof window !== "undefined" &&
        window &&
        window.localStorage &&
        typeof window.localStorage.setItem === "function"
      ) {
        window.localStorage.setItem(
          DAY_STRIP_COLLAPSE_KEY,
          collapsed ? "true" : "false",
        );
      }
    } catch (error) {
      // Storage is best-effort.
    }
    try {
      for (const record of Array.from(this.dayStripViewsStore())) {
        try {
          this.dayStripPaint(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
        try {
          if (
            record &&
            record.editorView &&
            typeof record.editorView.requestMeasure === "function"
          ) {
            record.editorView.requestMeasure();
          }
        } catch (error) {
          // Measuring is best-effort.
        }
      }
    } catch (error) {
      // Repaint is best-effort.
    }
  }

  setupDayStripHosts() {
    try {
      if (typeof this.setupDayStripMount === "function") {
        this.setupDayStripMount();
      }
    } catch (error) {
      // The Live Preview mount is best-effort.
    }
    try {
      this.dayStripViewsStore();
    } catch (error) {
      // Registry init is best-effort.
    }
    try {
      if (this.dayStripPaintsCached === undefined) {
        this.dayStripPaintsCached = 0;
      }
      if (this.dayStripPaintsSkeleton === undefined) {
        this.dayStripPaintsSkeleton = 0;
      }
      if (this.dayStripSpawns === undefined) {
        this.dayStripSpawns = 0;
      }
    } catch (error) {
      // Counter init is best-effort.
    }
    try {
      if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
        this.registerMarkdownCodeBlockProcessor("bob-day-stats", (source, el, ctx) =>
          this.renderDayStripFence(el, ctx, source),
        );
      }
    } catch (error) {
      // Fence registration is best-effort.
    }
    try {
      if (typeof this.statsOnCacheUpdate === "function") {
        try {
          if (typeof this.dayStripCacheUnsub === "function") {
            this.dayStripCacheUnsub();
          }
        } catch (error) {
          // Resubscribe is best-effort.
        }
        this.dayStripCacheUnsub = this.statsOnCacheUpdate((key) => {
          try {
            this.dayStripRepaintForKey(key);
          } catch (error) {
            // Subscriber repaint is best-effort.
          }
        });
      }
    } catch (error) {
      // Subscriber wiring is best-effort.
    }
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(
          metadataCache.on("changed", () => this.dayStripNoteChange()),
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
            vault.on(event, () => this.dayStripNoteChange()),
          );
        }
      }
    } catch (error) {
      // Revalidation wiring is best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(
          workspace.on("active-leaf-change", () => {
            try {
              this.dayStripCheckAll();
            } catch (error) {
              // Visibility flush is best-effort.
            }
          }),
        );
        this.registerEvent(
          workspace.on("layout-change", () => {
            try {
              this.dayStripCheckAll();
            } catch (error) {
              // Visibility flush is best-effort.
            }
          }),
        );
      }
    } catch (error) {
      // Visibility wiring is best-effort.
    }
    try {
      if (
        typeof this.registerDomEvent === "function" &&
        typeof document !== "undefined" &&
        document
      ) {
        this.registerDomEvent(document, "visibilitychange", () => {
          try {
            if (
              !document.visibilityState ||
              document.visibilityState === "visible"
            ) {
              this.dayStripCheckAll();
            }
          } catch (error) {
            // Visibility flush is best-effort.
          }
        });
      }
    } catch (error) {
      // Visibility wiring is best-effort.
    }
    try {
      if (
        typeof this.registerDomEvent === "function" &&
        typeof window !== "undefined" &&
        window
      ) {
        this.registerDomEvent(window, "focus", () => {
          try {
            this.dayStripCheckAll();
          } catch (error) {
            // Focus flush is best-effort.
          }
        });
      }
    } catch (error) {
      // Focus wiring is best-effort.
    }
  }

  teardownDayStripHosts() {
    try {
      const clear =
        typeof window !== "undefined" &&
        typeof window.clearTimeout === "function"
          ? window.clearTimeout
          : clearTimeout;
      if (
        this.dayStripRecheckTimer !== null &&
        this.dayStripRecheckTimer !== undefined
      ) {
        clear(this.dayStripRecheckTimer);
      }
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    this.dayStripRecheckTimer = null;
    try {
      if (typeof this.dayStripCacheUnsub === "function") {
        this.dayStripCacheUnsub();
      }
    } catch (error) {
      // Unsubscribe is best-effort.
    }
    this.dayStripCacheUnsub = null;
    try {
      for (const record of Array.from(this.dayStripViewsStore())) {
        try {
          this.dayStripReleaseRecord(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
      this.dayStripViewsStore().clear();
    } catch (error) {
      // Registry cleanup is best-effort.
    }
  }

  // A vault change landed: re-check every strip after a trailing 2 s
  // quiet window so a burst of review gestures coalesces. Never throws.
  dayStripNoteChange() {
    try {
      this.dayStripScheduleRecheck();
    } catch (error) {
      // Scheduling is best-effort.
    }
  }

  dayStripRecheckDelay() {
    try {
      const delay = Number(this.dayStripRecheckDelayMs);
      if (Number.isFinite(delay) && delay >= 0) {
        return delay;
      }
    } catch (error) {
      // Fall through to the default below.
    }
    return DAY_STRIP_RECHECK_DEBOUNCE_MS;
  }

  dayStripScheduleRecheck() {
    try {
      const clear =
        typeof window !== "undefined" &&
        typeof window.clearTimeout === "function"
          ? window.clearTimeout
          : clearTimeout;
      if (
        this.dayStripRecheckTimer !== null &&
        this.dayStripRecheckTimer !== undefined
      ) {
        try {
          clear(this.dayStripRecheckTimer);
        } catch (error) {
          // Timer reset is best-effort.
        }
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.dayStripRecheckTimer = schedule(() => {
        this.dayStripRecheckTimer = null;
        try {
          this.dayStripCheckAll();
        } catch (error) {
          // Re-checking is best-effort.
        }
      }, this.dayStripRecheckDelay());
    } catch (error) {
      // Scheduling is best-effort.
    }
  }

  dayStripCheckAll() {
    try {
      for (const record of Array.from(this.dayStripViewsStore())) {
        try {
          this.dayStripCheck(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
    } catch (error) {
      // Checking is best-effort.
    }
  }

  // True when the strip is on screen: the observer reports it
  // intersecting, the tab is visible, and its element is shown. Never
  // throws.
  dayStripRecordIsShown(record) {
    try {
      if (record && record.visible === false) {
        return false;
      }
    } catch (error) {
      // Fall through to the element checks.
    }
    try {
      return statsBlockViewIsShown({ el: record && record.el });
    } catch (error) {
      return true;
    }
  }

  dayStripOptionsForRecord(record, localToday) {
    try {
      const today =
        typeof localToday === "string" && localToday
          ? localToday
          : this.dayStripLocalNow();
      let peek = null;
      try {
        peek = this.statsPeek({});
      } catch (error) {
        peek = null;
      }
      const selection = dayStripRequestFor(
        record && record.day,
        today,
        peek,
      );
      if (selection.source === "default") {
        return { selection, options: {} };
      }
      if (selection.source === "range") {
        return { selection, options: selection.options };
      }
      return { selection, options: null };
    } catch (error) {
      return { selection: { source: "none" }, options: null };
    }
  }

  // Paint one strip synchronously from the cache in the mounting frame:
  // the ready frame, the skeleton on a miss, the one-line error when a
  // fetch failed with nothing cached, or nothing for future days. Never
  // spawns and never throws. `result` is an explicit fetch outcome that
  // wins over the cache peek.
  dayStripPaint(record, result) {
    try {
      if (!record || !record.el) {
        return null;
      }
      const localToday = this.dayStripLocalNow();
      const day = record.day;
      const collapsed = this.dayStripIsCollapsed();
      const handlers = {
        openStats: (opts) => {
          try {
            const safe = opts && typeof opts === "object" ? opts : {};
            void this.openStatsForDay({
              day:
                typeof safe.day === "string" && safe.day ? safe.day : day,
              metric: safe.metric,
              panel: safe.panel,
              newLeaf: safe.newLeaf,
              sourcePath: record.path,
            });
          } catch (error) {
            // Opening Stats is best-effort here; openStatsForDay Notices.
          }
        },
        toggleCollapsed: () => {
          try {
            this.dayStripSetCollapsed(!this.dayStripIsCollapsed());
          } catch (error) {
            // Collapse is best-effort.
          }
        },
        retry: () => {
          try {
            this.dayStripCheck(record, { force: true });
          } catch (error) {
            // Retry is best-effort.
          }
        },
      };
      const finish = (model, counter, stamp) => {
        try {
          const key = [
            model.state,
            model.day,
            localToday,
            String(stamp === undefined ? "" : stamp),
            model.stale,
            model.error ? model.error.code : "",
            collapsed,
            (model.tiles || []).map((tile) => tile.display).join(","),
          ].join("|");
          if (record.paintedKey === key) {
            return model;
          }
          record.paintedKey = key;
          paintDayStrip(record.el, model, handlers);
          if (counter === "cached") {
            this.dayStripPaintsCached = (Number(this.dayStripPaintsCached) || 0) + 1;
          } else if (counter === "skeleton") {
            this.dayStripPaintsSkeleton =
              (Number(this.dayStripPaintsSkeleton) || 0) + 1;
          }
        } catch (error) {
          // Painting is best-effort.
        }
        return model;
      };
      if (!day || !dayStripDateParts(day)) {
        return finish(
          dayStripModel(null, typeof day === "string" ? day : "", {
            localToday,
          }),
          null,
        );
      }
      if (localToday && day > localToday) {
        return finish(dayStripModel(null, day, { localToday }), null);
      }
      const { selection, options } = this.dayStripOptionsForRecord(
        record,
        localToday,
      );
      if (selection.source === "none" || !options) {
        return finish(dayStripModel(null, day, { localToday }), null);
      }
      const snapshot =
        result &&
        typeof result === "object" &&
        ("report" in result || "error" in result)
          ? result
          : null;
      let report = null;
      let fetchedAt = null;
      let stale = false;
      let error = null;
      if (snapshot) {
        report = snapshot.report || null;
        fetchedAt = snapshot.fetchedAt;
        stale = snapshot.stale === true;
        error = snapshot.error || null;
      } else {
        let peek = null;
        try {
          peek = this.statsPeek(options);
        } catch (peekError) {
          peek = null;
        }
        report = (peek && peek.report) || null;
        fetchedAt = peek ? peek.fetchedAt : null;
        stale = peek ? peek.stale === true : false;
        error = null;
      }
      if (!report) {
        return finish(
          dayStripModel(null, day, {
            localToday,
            fetchedAt,
            stale,
            error,
            collapsed,
          }),
          "skeleton",
          "miss",
        );
      }
      return finish(
        dayStripModel(report, day, {
          localToday,
          fetchedAt,
          stale,
          error,
          collapsed,
        }),
        "cached",
        fetchedAt,
      );
    } catch (error) {
      return null;
    }
  }

  // The re-run gate: spawn `bob stats` only while the strip is visible,
  // the entry is dirty (a change landed or it aged past 10 min), and it
  // aged past 30 s for today or 10 min for a past day. On a miss the
  // strip fetches once. Never throws.
  dayStripCheck(record, opts) {
    try {
      const force = Boolean(opts && opts.force === true);
      if (!record || !record.el) {
        return;
      }
      if (!this.dayStripCanSpawn()) {
        return;
      }
      const localToday = this.dayStripLocalNow();
      const day = record.day;
      if (!day || !dayStripDateParts(day)) {
        this.dayStripPaint(record);
        return;
      }
      if (localToday && day > localToday) {
        this.dayStripPaint(record);
        return;
      }
      if (!this.dayStripRecordIsShown(record)) {
        return;
      }
      const { selection, options } = this.dayStripOptionsForRecord(
        record,
        localToday,
      );
      if (selection.source === "none" || !options) {
        this.dayStripPaint(record);
        return;
      }
      let key = null;
      try {
        key = statsRequestFor(options).key;
      } catch (error) {
        key = null;
      }
      let entry = null;
      try {
        entry = key ? this.statsCacheGet(key) : null;
      } catch (error) {
        entry = null;
      }
      if (!entry || !entry.report) {
        this.dayStripFetch(record, options);
        return;
      }
      let now = 0;
      try {
        now = Date.now();
      } catch (error) {
        now = 0;
      }
      let gen = 0;
      try {
        gen = this.statsChangeGenValue();
      } catch (error) {
        gen = 0;
      }
      if (!statsCacheEntryIsDirty(entry, now, gen)) {
        return;
      }
      const age = now - Number(entry.fetchedAt);
      const minAge =
        day === localToday
          ? DAY_STRIP_TODAY_MIN_AGE_MS
          : DAY_STRIP_PAST_MIN_AGE_MS;
      if (force || (Number.isFinite(age) && age >= minAge)) {
        this.dayStripFetch(record, options);
      }
    } catch (error) {
      // Checking is best-effort.
    }
  }

  // Fetch one key for one strip behind the shared single-flight queue so
  // several strips and the page on one key cause exactly one spawn and
  // every waiter settles. A failure keeps the cached frame with the
  // stale dot, or the one-line error with nothing cached. Never throws.
  dayStripFetch(record, options) {
    try {
      const safe = options && typeof options === "object" ? options : {};
      let key = null;
      let args = null;
      try {
        const resolved = statsRequestFor(safe);
        key = resolved.key;
        args = resolved.args;
      } catch (error) {
        key = null;
        args = null;
      }
      if (!key || !args) {
        return;
      }
      const settled = (result) => this.dayStripSettled(record, safe, result);
      try {
        if (this.statsFlight && this.statsFlight.key === key) {
          this.statsFlight.waiters.push(settled);
          return;
        }
      } catch (error) {
        // Flight check is best-effort.
      }
      try {
        const queued =
          typeof this.statsPendingByKeyStore === "function"
            ? this.statsPendingByKeyStore().get(key)
            : null;
        if (queued) {
          queued.waiters.push(settled);
          return;
        }
      } catch (error) {
        // Queue check is best-effort.
      }
      let hadCached = false;
      try {
        const entry = this.statsCacheGet(key);
        hadCached = Boolean(entry && entry.report);
      } catch (error) {
        hadCached = false;
      }
      try {
        this.dayStripSpawns = (Number(this.dayStripSpawns) || 0) + 1;
      } catch (error) {
        this.dayStripSpawns = 1;
      }
      try {
        this.statsEnqueueFetch({
          key,
          args,
          opts: { ...safe },
          waiters: [settled],
          hadCached,
        });
      } catch (error) {
        // Enqueue is best-effort; waiters settle on unload.
      }
    } catch (error) {
      // Fetching is best-effort.
    }
  }

  dayStripSettled(record, options, result) {
    try {
      if (!record) {
        return;
      }
      try {
        if (!this.dayStripViewsStore().has(record)) {
          return;
        }
      } catch (error) {
        return;
      }
      this.dayStripPaint(record, result || { report: null });
    } catch (error) {
      // Settling is best-effort.
    }
  }

  // The shared-cache subscriber: every strip reading the updated key
  // repaints in place for free. Never throws.
  dayStripRepaintForKey(key) {
    try {
      if (typeof key !== "string" || !key) {
        return;
      }
      const localToday = this.dayStripLocalNow();
      for (const record of Array.from(this.dayStripViewsStore())) {
        try {
          const { options } = this.dayStripOptionsForRecord(
            record,
            localToday,
          );
          if (!options) {
            continue;
          }
          if (statsRequestFor(options).key !== key) {
            continue;
          }
          this.dayStripPaint(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
    } catch (error) {
      // Subscriber repaint is best-effort.
    }
  }

  // Across-midnight rollover: today becomes a past-day strip because its
  // D is fixed by its path, so repaint every strip (which re-keys today
  // to a past day and refetches) after the generation bump. Never
  // throws.
  dayStripHandleRollover() {
    try {
      for (const record of Array.from(this.dayStripViewsStore())) {
        try {
          record.paintedKey = null;
          this.dayStripPaint(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
      this.dayStripCheckAll();
      if (typeof this.refreshDayStripMountEditors === "function") {
        this.refreshDayStripMountEditors();
      }
    } catch (error) {
      // Rollover is best-effort.
    }
  }

  dayStripReleaseRecord(record) {
    try {
      try {
        if (
          record &&
          record.observer &&
          typeof record.observer.disconnect === "function"
        ) {
          record.observer.disconnect();
        }
      } catch (error) {
        // Observer cleanup is best-effort.
      }
      if (record) {
        record.observer = null;
      }
      this.dayStripViewsStore().delete(record);
    } catch (error) {
      // Release is best-effort.
    }
  }

  dayStripObserve(record) {
    try {
      if (!record) {
        return;
      }
      let Observer = null;
      try {
        Observer =
          typeof IntersectionObserver !== "undefined"
            ? IntersectionObserver
            : null;
      } catch (error) {
        Observer = null;
      }
      if (typeof Observer !== "function") {
        record.visible = true;
        return;
      }
      try {
        if (
          record.observer &&
          typeof record.observer.disconnect === "function"
        ) {
          record.observer.disconnect();
        }
      } catch (error) {
        // Observer reset is best-effort.
      }
      const observer = new Observer((entries) => {
        try {
          const list = Array.isArray(entries) ? entries : [];
          for (const entry of list) {
            if (entry && typeof entry.isIntersecting === "boolean") {
              record.visible = entry.isIntersecting;
            }
          }
          if (record.visible !== false) {
            record.visible = true;
            this.dayStripCheck(record);
          }
        } catch (error) {
          // Observation is best-effort.
        }
      });
      record.observer = observer;
      if (record.el && typeof observer.observe === "function") {
        observer.observe(record.el);
      }
    } catch (error) {
      try {
        record.visible = true;
      } catch (inner) {
        // Visibility is best-effort.
      }
    }
  }
}
