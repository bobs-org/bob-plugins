// `bob-stats-strip` fence, registry, cache, and `openStatsForPeriod` for the
// week member of the period stats strip. A period note path (or a `period:`
// line) selects the period member; a canonical daily note path (or a `day:`
// line) renders the Day strip; anything else gets a muted line. Data is
// `bob periods show <id> -f json`, cached per period id and shared with the
// parts table, gated by visibility. Rendering never writes the note.
const PERIOD_STRIP_TODAY_MIN_AGE_MS = 30 * 1000;
const PERIOD_STRIP_PAST_MIN_AGE_MS = 10 * 60 * 1000;
const PERIOD_STRIP_FETCH_TIMEOUT_MS = 20000;

function periodStripDecodeShow(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined || stdout === null ? "" : stdout));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob periods show returned invalid JSON.", detail: statsFirstLine(stderr) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.schema_version !== 1) {
    return { ok: false, code: "bad-shape", message: "bob periods show returned an unexpected JSON shape.", detail: statsFirstLine(stderr) };
  }
  if (body.ok === true) return { ok: true, report: body };
  if (body.ok === false) {
    const failure = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code: typeof failure.code === "string" && failure.code ? failure.code : "bob-error",
      message: typeof failure.message === "string" && failure.message ? failure.message : "bob periods show failed.",
      detail: (typeof failure.hint === "string" && failure.hint) || statsFirstLine(stderr),
    };
  }
  return { ok: false, code: "bad-shape", message: "bob periods show returned an unexpected report.", detail: statsFirstLine(stderr) };
}

function periodStripShowArgs(periodId) {
  return ["periods", "show", String(periodId), "-f", "json"];
}

function periodStripPeriodIdForRecord(record) {
  try {
    if (record && typeof record.periodId === "string" && record.periodId) return record.periodId;
  } catch (error) {
    // Fall through.
  }
  return "";
}

class BobLedgerToolsPeriodStripMixin {
  periodStripViewsStore() {
    if (!(this.periodStripViews instanceof Set)) this.periodStripViews = new Set();
    return this.periodStripViews;
  }

  periodStripCacheStore() {
    if (!(this.periodStripCache instanceof Map)) this.periodStripCache = new Map();
    return this.periodStripCache;
  }

  periodStripPendingStore() {
    if (!(this.periodStripPending instanceof Map)) this.periodStripPending = new Map();
    return this.periodStripPending;
  }

  periodStripCanSpawn() {
    try {
      if (typeof this.dayStripCanSpawn === "function") return this.dayStripCanSpawn();
    } catch (error) {
      // Fall through to the local check.
    }
    try {
      if (typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === false) return false;
    } catch (error) {
      return false;
    }
    try {
      const childProcess = planRequireOptionalNodeModule("child_process");
      if (!childProcess || typeof childProcess.execFile !== "function") return false;
    } catch (error) {
      return false;
    }
    return true;
  }

  periodStripLocalNow() {
    try {
      if (typeof this.dayStripLocalNow === "function") return this.dayStripLocalNow();
    } catch (error) {
      // Fall through.
    }
    try {
      return dayStripLocalToday(new Date());
    } catch (error) {
      return "";
    }
  }

  setupPeriodStripHosts() {
    try {
      this.periodStripViewsStore();
    } catch (error) {
      // Registry init is best-effort.
    }
    try {
      if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
        this.registerMarkdownCodeBlockProcessor("bob-stats-strip", (source, el, ctx) =>
          this.renderPeriodStripFence(el, ctx, source),
        );
        this.registerMarkdownCodeBlockProcessor("bob-period-parts", (source, el, ctx) =>
          this.renderPeriodStripFence(el, ctx, source, "table"),
        );
      }
    } catch (error) {
      // Fence registration is best-effort.
    }
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", () => this.periodStripNoteChange()));
      }
    } catch (error) {
      // Revalidation wiring is best-effort.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        for (const event of ["create", "delete", "rename"]) {
          this.registerEvent(vault.on(event, () => this.periodStripNoteChange()));
        }
      }
    } catch (error) {
      // Revalidation wiring is best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(workspace.on("active-leaf-change", () => {
          try {
            this.periodStripCheckAll();
          } catch (error) {
            // Visibility flush is best-effort.
          }
        }));
        this.registerEvent(workspace.on("layout-change", () => {
          try {
            this.periodStripCheckAll();
          } catch (error) {
            // Visibility flush is best-effort.
          }
        }));
      }
    } catch (error) {
      // Visibility wiring is best-effort.
    }
  }

  teardownPeriodStripHosts() {
    try {
      for (const record of Array.from(this.periodStripViewsStore())) {
        try {
          this.periodStripReleaseRecord(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
      this.periodStripViewsStore().clear();
    } catch (error) {
      // Registry cleanup is best-effort.
    }
  }

  // Shared cache peek by period id for the strip and the parts table. Never
  // throws; returns `{ report, fetchedAt, stale, error }` or null.
  periodStripPeek(periodId) {
    try {
      const store = this.periodStripCacheStore();
      const entry = store.get(String(periodId));
      if (!entry) return null;
      store.delete(String(periodId));
      store.set(String(periodId), entry);
      return { report: entry.report || null, fetchedAt: entry.fetchedAt, stale: entry.stale === true, error: entry.error || null };
    } catch (error) {
      return null;
    }
  }

  periodStripCacheSet(periodId, report, error) {
    try {
      const store = this.periodStripCacheStore();
      const key = String(periodId);
      if (store.has(key)) store.delete(key);
      let fetchedAt = null;
      try {
        fetchedAt = Date.now();
      } catch (error) {
        fetchedAt = 0;
      }
      store.set(key, { report: report || null, fetchedAt, stale: false, error: error || null });
      while (store.size > 16) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
      return fetchedAt;
    } catch (error) {
      return null;
    }
  }

  periodStripSpawnShow(periodId) {
    try {
      return bobSpawnJson(periodStripShowArgs(periodId), periodStripDecodeShow, {
        commandLabel: "bob periods show",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : { path: "bob", source: "path" },
        getVaultPath: () => (typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null),
        timeout: PERIOD_STRIP_FETCH_TIMEOUT_MS,
      });
    } catch (error) {
      return Promise.resolve({ ok: false, code: "spawn-failed", message: "bob periods show failed to run.", detail: "" });
    }
  }

  periodStripFetch(record) {
    try {
      const periodId = periodStripPeriodIdForRecord(record);
      if (!periodId) return;
      const pending = this.periodStripPendingStore();
      const existing = pending.get(periodId);
      if (existing) {
        existing.waiters.push((result) => this.periodStripSettled(record, result));
        return;
      }
      const waiters = [(result) => this.periodStripSettled(record, result)];
      pending.set(periodId, { waiters });
      void this.periodStripSpawnShow(periodId).then((result) => {
        let entry = null;
        try {
          entry = pending.get(periodId);
          pending.delete(periodId);
        } catch (error) {
          entry = null;
        }
        if (result && result.ok) {
          try {
            this.periodStripCacheSet(periodId, result.report, null);
          } catch (error) {
            // Cache write is best-effort.
          }
        }
        const settled = result && result.ok
          ? { report: result.report, fetchedAt: this.periodStripPeek(periodId)?.fetchedAt, stale: false, error: null }
          : { report: this.periodStripPeek(periodId)?.report || null, fetchedAt: this.periodStripPeek(periodId)?.fetchedAt, stale: true, error: result };
        const list = (entry && entry.waiters) || waiters;
        for (const waiter of list.splice(0)) {
          try {
            waiter(settled);
          } catch (error) {
            // Waiter delivery is best-effort.
          }
        }
      });
    } catch (error) {
      // Fetching is best-effort.
    }
  }

  periodStripSettled(record, result) {
    try {
      if (!record) return;
      try {
        if (!this.periodStripViewsStore().has(record)) return;
      } catch (error) {
        return;
      }
      this.periodStripPaint(record, result || { report: null });
    } catch (error) {
      // Settling is best-effort.
    }
  }

  periodStripNoteChange() {
    try {
      this.periodStripCheckAll();
    } catch (error) {
      // Scheduling is best-effort.
    }
  }

  periodStripCheckAll() {
    try {
      for (const record of Array.from(this.periodStripViewsStore())) {
        try {
          this.periodStripCheck(record);
        } catch (error) {
          // One stale strip never breaks the others.
        }
      }
    } catch (error) {
      // Checking is best-effort.
    }
  }

  periodStripRecordIsShown(record) {
    try {
      if (record && record.visible === false) return false;
    } catch (error) {
      // Fall through.
    }
    try {
      return statsBlockViewIsShown({ el: record && record.el });
    } catch (error) {
      return true;
    }
  }

  periodStripPaint(record, result) {
    try {
      if (!record || !record.el) return null;
      if (record.day) {
        return this.periodStripPaintDay(record, result);
      }
      const periodId = periodStripPeriodIdForRecord(record);
      const handlers = {
        openStats: (opts) => {
          try {
            const safe = opts && typeof opts === "object" ? opts : {};
            void this.openStatsForPeriod({
              period: periodId,
              metric: safe.metric,
              panel: safe.panel,
              clock: safe.clock,
              newLeaf: safe.newLeaf,
              sourcePath: record.path,
            });
          } catch (error) {
            // Opening Stats is best-effort.
          }
        },
        openColumn: (column, newLeaf) => {
          try {
            this.periodStripOpenColumn(column, record, newLeaf);
          } catch (error) {
            // Navigation is best-effort.
          }
        },
        openStatsForColumn: (column, newLeaf) => {
          try {
            const day = column && typeof column.start === "string" ? column.start : (column && column.id) || "";
            void this.openStatsForDay({ day, newLeaf, sourcePath: record.path });
          } catch (error) {
            // Opening Stats is best-effort.
          }
        },
        retry: () => {
          try {
            this.periodStripCheck(record, { force: true });
          } catch (error) {
            // Retry is best-effort.
          }
        },
      };
      const snapshot = result && typeof result === "object" && ("report" in result || "error" in result) ? result : null;
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
        const peek = this.periodStripPeek(periodId);
        report = (peek && peek.report) || null;
        fetchedAt = peek ? peek.fetchedAt : null;
        stale = peek ? peek.stale === true : false;
      }
      if (!report) {
        const model = periodStripModel(null, periodId, { fetchedAt, stale, error });
        return this.periodStripFinishPaint(record, model, handlers, fetchedAt);
      }
      const model = periodStripModel(report, periodId, {
        fetchedAt,
        stale,
        error,
        themeHueFor: (key, name) => {
          try {
            return typeof this.pomodoroThemeHueFor === "function" ? this.pomodoroThemeHueFor(key, name) : "gray";
          } catch (error) {
            return "gray";
          }
        },
      });
      return this.periodStripFinishPaint(record, model, handlers, fetchedAt);
    } catch (error) {
      return null;
    }
  }

  periodStripFinishPaint(record, model, handlers, stamp) {
    try {
      const key = [
        record.surface || "strip",
        model.state,
        model.periodId,
        String(stamp === undefined ? "" : stamp),
        model.stale,
        model.error ? model.error.code : "",
        (model.facts || []).map((fact) => [fact.display, (fact.ref && fact.ref.mark) || "", (fact.ref && fact.ref.display) || ""].join(":")).join(","),
        (model.columns || []).map((column) => [column.id, column.state, (column.worked && column.worked.display) || "", column.mark || ""].join(":")).join(","),
        (model.children || []).map((child) => [child.id, child.state, (child.worked && child.worked.display) || "", child.headline || "", child.mostly || ""].join(":")).join(","),
      ].join("|");
      if (record.paintedKey === key) return model;
      record.paintedKey = key;
      if (record.surface === "table") paintPeriodPartsTable(record.el, model);
      else paintPeriodStrip(record.el, model, handlers);
    } catch (error) {
      // Painting is best-effort.
    }
    return model;
  }

  // Day delegation for `bob-stats-strip` on a canonical daily note (or a
  // `day:` line): reuse the Day strip's model and painter on the same
  // element so the fence stays one family. Never throws.
  periodStripPaintDay(record, result) {
    try {
      if (typeof this.dayStripPaint === "function") {
        const dayRecord = { el: record.el, day: record.day, path: record.path, kind: "fence", observer: record.observer || null, visible: record.visible, paintedKey: record.paintedKey };
        const out = this.dayStripPaint(dayRecord, result);
        try {
          record.paintedKey = dayRecord.paintedKey;
        } catch (error) {
          // Painted-key sync is best-effort.
        }
        return out;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  periodStripCheck(record, opts) {
    try {
      const force = Boolean(opts && opts.force === true);
      if (!record || !record.el) return;
      if (!this.periodStripCanSpawn()) return;
      if (record.day) {
        if (typeof this.dayStripCheck === "function") {
          const dayRecord = { el: record.el, day: record.day, path: record.path, kind: "fence", observer: record.observer || null, visible: record.visible };
          this.dayStripCheck(dayRecord, opts);
        } else {
          this.periodStripPaint(record);
        }
        return;
      }
      const periodId = periodStripPeriodIdForRecord(record);
      if (!periodId) {
        this.periodStripPaint(record);
        return;
      }
      if (!this.periodStripRecordIsShown(record)) return;
      const peek = this.periodStripPeek(periodId);
      if (!peek || !peek.report) {
        this.periodStripFetch(record);
        return;
      }
      let now = 0;
      try {
        now = Date.now();
      } catch (error) {
        now = 0;
      }
      const classified = periodStripClassifyId(periodId);
      const age = now - Number(peek.fetchedAt);
      const isCurrent = peek.report && peek.report.period && peek.report.period.state === "current";
      const minAge = isCurrent ? PERIOD_STRIP_TODAY_MIN_AGE_MS : PERIOD_STRIP_PAST_MIN_AGE_MS;
      void classified;
      if (force || (Number.isFinite(age) && age >= minAge)) {
        this.periodStripFetch(record);
      }
    } catch (error) {
      // Checking is best-effort.
    }
  }

  periodStripOpenColumn(column, record, newLeaf) {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.openLinkText !== "function") return;
      const path = column && typeof column.path === "string" ? column.path : "";
      if (!path) return;
      const link = path.replace(/\.md$/, "");
      void workspace.openLinkText(link, (record && record.path) || "", newLeaf === true);
    } catch (error) {
      // Navigation is best-effort.
    }
  }

  // The `bob-stats-strip` fence: a period note path (or a `period:` line)
  // selects the period member; a canonical daily note path (or a `day:` line)
  // renders the Day strip; anything else gets a muted line. Nothing on
  // mobile or wherever `bob` cannot spawn. Never throws.
  renderPeriodStripFence(el, ctx, source, surface) {
    if (!el) return;
    try {
      try {
        if (el.closest && typeof el.closest === "function") {
          if (el.closest(".hover-popover, .markdown-embed")) return;
        }
      } catch (error) {
        // Hover/embed detection is best-effort.
      }
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const parsed = periodStripParseFencePeriod(source, sourcePath);
      if (!parsed) {
        try {
          if (typeof el.empty === "function") el.empty();
          else el.textContent = "";
          const doc = statsDocFor(el);
          const note = statsEl(doc, "div", { class: "bob-period-strip-fence-note" }, "bob-stats-strip needs a period note, a daily note, or a period: / day: line.");
          if (note) el.appendChild(note);
        } catch (error) {
          // Muted-line fallback is best-effort.
        }
        return;
      }
      if (surface === "table" && parsed.kind === "day") {
        try {
          if (typeof el.empty === "function") el.empty();
          else el.textContent = "";
          const doc = statsDocFor(el);
          const note = statsEl(doc, "div", { class: "bob-period-parts-note" }, "bob-period-parts needs a period note.");
          if (note) el.appendChild(note);
        } catch (error) {
          // Muted-line fallback is best-effort.
        }
        return;
      }
      if (parsed.kind === "day") {
        const day = dayStripDateParts(parsed.id) ? parsed.id : dayStripDayForPath(sourcePath);
        if (!day) {
          try {
            if (typeof el.empty === "function") el.empty();
            else el.textContent = "";
            const doc = statsDocFor(el);
            const note = statsEl(doc, "div", { class: "bob-period-strip-fence-note" }, "bob-stats-strip needs a period note, a daily note, or a period: / day: line.");
            if (note) el.appendChild(note);
          } catch (error) {
            // Muted-line fallback is best-effort.
          }
          return;
        }
        if (!this.periodStripCanSpawn()) return;
        const record = { el, day, path: sourcePath, kind: "fence", observer: null, visible: true };
        this.periodStripViewsStore().add(record);
        this.periodStripObserve(record);
        this.periodStripPaint(record);
        this.periodStripCheck(record);
        return;
      }
      if (!this.periodStripCanSpawn()) return;
      const record = { el, periodId: parsed.id, kind: parsed.kind, surface: surface === "table" ? "table" : "strip", path: sourcePath, observer: null, visible: true };
      this.periodStripViewsStore().add(record);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              this.periodStripReleaseRecord(record);
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              this.periodStripReleaseRecord(record);
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject the child.
        }
      }
      this.periodStripObserve(record);
      this.periodStripPaint(record);
      this.periodStripCheck(record);
    } catch (error) {
      // Fence rendering never breaks the note.
    }
  }

  // Open Stats with the period's exact dates: range = start..end, grouping by
  // kind (day for week, week for quarter/year, month for all time), the focus
  // metric, and the panel; clears pinnedDay and pinnedBucket. Plain click
  // reuses an open Stats tab; Ctrl/Cmd-click and middle-click open a new one.
  // Never clears the pin while capability resolves. Never throws.
  async openStatsForPeriod(options) {
    const opts = options && typeof options === "object" ? options : {};
    const periodId = typeof opts.period === "string" ? opts.period : "";
    const start = typeof opts.start === "string" ? opts.start : "";
    const end = typeof opts.end === "string" ? opts.end : "";
    const kind = typeof opts.kind === "string" ? opts.kind : "";
    const sourcePath = typeof opts.sourcePath === "string" ? opts.sourcePath : "";
    try {
      const classified = periodStripClassifyId(periodId);
      if (!classified) throw new Error("Period strip needs a valid period to open Stats.");
      let period = { start, end, kind: kind || classified.kind };
      const peek = this.periodStripPeek(periodId);
      if (peek && peek.report && peek.report.period) {
        const cached = peek.report.period;
        period = {
          start: start || cached.start || "",
          end: end || cached.end || "",
          kind: kind || cached.kind || classified.kind,
        };
      }
      if (!period.start || !period.end) {
        const result = await this.periodStripSpawnShow(periodId);
        if (result && result.ok && result.report && result.report.period) {
          period = {
            start: result.report.period.start || period.start,
            end: result.report.period.end || period.end,
            kind: result.report.period.kind || period.kind,
          };
          try {
            this.periodStripCacheSet(periodId, result.report, null);
          } catch (error) {
            // Cache write is best-effort.
          }
        }
      }
      if (!period.start || !period.end) throw new Error("Period strip needs a valid period to open Stats.");
      const group = period.kind === "week" ? "day" : period.kind === "all" ? "month" : "week";
      let dashPath = "dash_stats";
      try {
        const metadataCache = this.app && this.app.metadataCache;
        if (metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
          const dest = metadataCache.getFirstLinkpathDest("dash_stats", sourcePath);
          if (dest && typeof dest.path === "string" && dest.path) dashPath = dest.path;
        }
      } catch (error) {
        // Link resolution is best-effort.
      }
      const state = this.statsViewStateFor(dashPath);
      state.range = period.start + ".." + period.end;
      state.offset = 0;
      state.group = group;
      state.pinnedDay = null;
      state.pinnedBucket = null;
      if (typeof opts.metric === "string" && opts.metric) state.focus = opts.metric;
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
          if (typeof workspace.revealLeaf === "function") await workspace.revealLeaf(leaf);
          if (typeof workspace.setActiveLeaf === "function") await workspace.setActiveLeaf(leaf, { focus: true });
          return true;
        } catch (error) {
          // Fall through to openLinkText below.
        }
      }
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText("dash_stats", sourcePath, opts.newLeaf === true);
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

  periodStripReleaseRecord(record) {
    try {
      try {
        if (record && record.observer && typeof record.observer.disconnect === "function") {
          record.observer.disconnect();
        }
      } catch (error) {
        // Observer cleanup is best-effort.
      }
      if (record) record.observer = null;
      this.periodStripViewsStore().delete(record);
    } catch (error) {
      // Release is best-effort.
    }
  }

  periodStripObserve(record) {
    try {
      if (!record) return;
      let Observer = null;
      try {
        Observer = typeof IntersectionObserver !== "undefined" ? IntersectionObserver : null;
      } catch (error) {
        Observer = null;
      }
      if (typeof Observer !== "function") {
        record.visible = true;
        return;
      }
      try {
        if (record.observer && typeof record.observer.disconnect === "function") record.observer.disconnect();
      } catch (error) {
        // Observer reset is best-effort.
      }
      const observer = new Observer((entries) => {
        try {
          const list = Array.isArray(entries) ? entries : [];
          for (const entry of list) {
            if (entry && typeof entry.isIntersecting === "boolean") record.visible = entry.isIntersecting;
          }
          if (record.visible !== false) {
            record.visible = true;
            this.periodStripCheck(record);
          }
        } catch (error) {
          // Observation is best-effort.
        }
      });
      record.observer = observer;
      if (record.el && typeof observer.observe === "function") observer.observe(record.el);
    } catch (error) {
      try {
        record.visible = true;
      } catch (inner) {
        // Visibility is best-effort.
      }
    }
  }
}
