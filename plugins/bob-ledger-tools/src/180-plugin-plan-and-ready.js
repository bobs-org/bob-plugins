class BobLedgerToolsPlanAndReadyMixin {
  currentDailyPath() {
    return todayDailyPath(new Date(), getDailyNotesOptions(this.app));
  }

  // Supported `api.planBudget` input: `{ path?, content? }`. The `content`
  // option lets callers budget post-write text synchronously; otherwise the
  // target note is read and a Promise is returned. Never rejects: missing
  // notes degrade to `–` placeholders.
  planBudgetForCallers(options = {}) {
    const { caps } = loadPlanCaps();
    if (options && typeof options.content === "string") {
      const daily = typeof options.path === "string" ? options.path : null;
      return computePlanBudget(options.content, caps, daily);
    }
    return (async () => {
      try {
        const sourcePath =
          options && typeof options.path === "string" ? options.path : null;
        const targetPath = planBlockTargetPath(this.app, sourcePath);
        const content = await this.readPlanBlockContent(targetPath);
        return computePlanBudget(
          typeof content === "string" ? content : "",
          caps,
          targetPath,
        );
      } catch (error) {
        return emptyPlanBudget(caps);
      }
    })();
  }

  readPlanBlockContent(targetPath) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") {
        return Promise.resolve(null);
      }
      const file = vault.getAbstractFileByPath(targetPath);
      if (!file) {
        return Promise.resolve(null);
      }
      if (typeof vault.cachedRead === "function") {
        return vault.cachedRead(file).catch(() => null);
      }
      if (typeof vault.read === "function") {
        return vault.read(file).catch(() => null);
      }
    } catch (error) {
      // Fall through to null below.
    }
    return Promise.resolve(null);
  }

  // --- Synchronous Today cache -----------------------------------------

  todayLocalDate(now = new Date()) {
    const date = now instanceof Date ? now : new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  todayCacheKey(task) {
    if (!task || typeof task !== "object") {
      return null;
    }
    const rawPath = planTaskPath(task);
    if (typeof rawPath !== "string" || !rawPath) {
      return null;
    }
    const blockId = planTaskBlockId(task);
    if (!blockId) {
      return null;
    }
    const path = /\.md$/i.test(rawPath) ? rawPath : `${rawPath}.md`;
    return `${path}#${blockId}`;
  }

  todayKeys() {
    const keys = (this.todayCache && this.todayCache.keys) || [];
    return [...keys];
  }

  isTodayTask(task) {
    const key = this.todayCacheKey(task);
    if (!key || !this.todayCache || !(this.todayCache.rank instanceof Map)) {
      return false;
    }
    return this.todayCache.rank.has(key);
  }

  todayRankOfTask(task) {
    const key = this.todayCacheKey(task);
    if (!key || !this.todayCache || !(this.todayCache.rank instanceof Map)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const rank = this.todayCache.rank.get(key);
    return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
  }

  // --- READY backlog (api v3, additive) ----------------------------------
  // Synchronous, guarded `{ count, cap, over }`. `count` is `null` when
  // unavailable (no Tasks data, a non-Warm cache, no initial Today build,
  // or a failed evaluation) and `over` is false in that case. Zero is
  // reserved for a successfully evaluated empty queue.
  tasksCacheState() {
    try {
      const plugins =
        this.app && this.app.plugins && this.app.plugins.plugins;
      const tasks = plugins && plugins[PLAN_TASKS_PLUGIN_ID];
      if (tasks && typeof tasks.getState === "function") {
        return tasks.getState();
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  isTodayCacheReady(now = new Date()) {
    try {
      const expectedDate = this.todayLocalDate(now);
      const expectedPath = this.currentTodayDailyPath(now);
      if (!expectedPath) {
        return false;
      }
      const cache = this.todayCache;
      if (!cache || !(cache.rank instanceof Map)) {
        return false;
      }
      if (cache.date !== expectedDate) {
        return false;
      }
      if (!sameVaultPath(cache.dailyPath || "", expectedPath)) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  readyBudget(now = new Date()) {
    try {
      const loaded = loadPlanCaps();
      const caps = loaded.caps;
      const effective = effectivePlanCaps(caps);
      const cap = planReadyCapOrDefault(
        effective.maxReady,
        READY_FALLBACK_CAP,
      );
      const unavailable = { count: null, cap, over: false };
      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks)) {
        return unavailable;
      }
      const state = this.tasksCacheState();
      if (typeof state === "string" && state !== "Warm") {
        return unavailable;
      }
      if (!this.isTodayCacheReady(now)) {
        return unavailable;
      }
      // Gate the shared READY count from one validated freshness
      // snapshot. A missing or throwing snapshot degrades to the
      // legacy ungated count, never a partially gated one.
      let gate = null;
      let gateMemo = null;
      try {
        gateMemo = this.freshnessEnsureMemo(now);
        if (gateMemo && gateMemo.tasksAvailable) {
          gate = this.freshnessReviewPredicate(gateMemo);
        }
      } catch (error) {
        gate = null;
        gateMemo = null;
      }
      let count;
      try {
        count = readyCountFromTasks(
          tasks,
          now,
          (task) => this.isTodayTask(task),
          gate,
        );
      } catch (error) {
        return unavailable;
      }
      if (!Number.isInteger(count) || count < 0) {
        return unavailable;
      }
      // Total lane pressure for the gated tooltip: the gated count
      // plus the NEW and ROTTEN buckets behind it.
      let lane = null;
      try {
        if (
          gateMemo &&
          gateMemo.tasksAvailable &&
          gateMemo.counts &&
          Number.isInteger(gateMemo.counts.new) &&
          Number.isInteger(gateMemo.counts.resurfaced) &&
          Number.isInteger(gateMemo.counts.rotten)
        ) {
          const rotten =
            gateMemo.counts.resurfaced + gateMemo.counts.rotten;
          lane = {
            total: gateMemo.counts.new + rotten + count,
            new: gateMemo.counts.new,
            rotten,
            ready: count,
          };
        }
      } catch (error) {
        lane = null;
      }
      return { count, cap, over: count > cap, lane };
    } catch (error) {
      return {
        count: null,
        cap: READY_FALLBACK_CAP,
        over: false,
      };
    }
  }

  // Dashboard PENDING/NEXT section budget (api v3, additive). The
  // section count excludes TODAY (and dash.md itself) and is shared by
  // dashboard badges and daily `bob-plan` PENDING/NEXT chips; the
  // whole-lane count and cap keep their existing semantics for tooltips,
  // cap warnings, and non-dashboard callers. `count`/`section` is null
  // when unavailable (no Tasks data, a non-Warm cache, no initial Today
  // build, or a failed evaluation); unavailable never becomes zero.
  dashboardLaneBudget(lane, now = new Date()) {
    try {
      const normalized = lane === "next" ? "next" : lane === "pending" ? "pending" : null;
      if (!normalized) {
        return { section: null, lane: null, count: null, cap: 10, over: false, today: null };
      }
      const loaded = loadPlanCaps();
      const caps = loaded.caps;
      const effective = effectivePlanCaps(caps);
      const fallbackCap =
        normalized === "next" ? effective.maxNext : effective.maxPending;
      const unavailable = {
        section: null,
        lane: null,
        count: null,
        laneCount: null,
        cap: fallbackCap,
        over: false,
        today: null,
      };
      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks)) {
        return unavailable;
      }
      const state = this.tasksCacheState();
      if (typeof state === "string" && state !== "Warm") {
        return unavailable;
      }
      if (!this.isTodayCacheReady(now)) {
        return unavailable;
      }
      let result = null;
      try {
        result = dashboardLaneBudgetFromTasks(
          tasks,
          now,
          caps,
          normalized,
          (task) => this.isTodayTask(task),
        );
      } catch (error) {
        return unavailable;
      }
      if (
        !result ||
        !Number.isInteger(result.section) ||
        result.section < 0 ||
        !Number.isInteger(result.lane) ||
        result.lane < 0
      ) {
        return unavailable;
      }
      return result;
    } catch (error) {
      return { section: null, lane: null, count: null, cap: 10, over: false, today: null };
    }
  }

  paintDashboardLaneElement(host, lane, budget, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const normalized = lane === "next" ? "next" : "pending";
      const label = normalized === "next" ? "NEXT" : "PENDING";
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const invalid = Boolean(options.invalid);
      const model = dashboardLaneBadgeModel(budget, normalized);
      const tooltip = model.tooltip + (invalid ? " Plan config invalid, using defaults." : "");
      const anchor = host.createEl("a", {
        cls: `bob-plan-chip bob-plan-${normalized}${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`,
        title: tooltip,
        href: `dash#${label} Tasks`,
      });
      setReadyAnchorContent(
        anchor,
        {
          ...model,
          count: model.section,
          cap: model.cap,
        },
        { kind: normalized, label },
      );
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", model.aria);
        anchor.setAttribute("role", "link");
        if (!anchor.hasAttribute("tabindex")) {
          anchor.setAttribute("tabindex", "0");
        }
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (workspace && typeof workspace.openLinkText === "function") {
            const newLeaf = Boolean(event && (event.ctrlKey || event.metaKey));
            workspace.openLinkText(`dash#${label} Tasks`, sourcePath, newLeaf);
          }
        } catch (error) {
          // The badge still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            open(event);
          }
        });
        anchor.addEventListener("mouseover", (event) => {
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.trigger === "function") {
              workspace.trigger("hover-link", {
                event,
                source: "bob-plan",
                hoverParent: host,
                targetEl: anchor,
                linktext: `dash#${label} Tasks`,
                sourcePath,
              });
            }
          } catch (error) {
            // Hover preview is best-effort only.
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  renderDashboardLaneBadge(parent, options = {}) {
    try {
      const lane = options.lane === "next" ? "next" : options.lane === "pending" ? "pending" : null;
      if (!lane) {
        return null;
      }
      if (!parent || typeof parent.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.dashboardLaneWidgets) {
        this.dashboardLaneWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.dashboardLaneWidgets)) {
          if (widget.component === component && widget.lane === lane) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (widget.el && typeof widget.el.remove === "function") {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.dashboardLaneWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.dashboardLaneWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!parent.contains || !parent.contains(el)) {
              this.dashboardLaneWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      const loaded = loadPlanCaps();
      const budget = this.dashboardLaneBudget(lane, new Date());
      const anchor = this.paintDashboardLaneElement(parent, lane, budget, {
        sourcePath,
        invalid: loaded.invalid,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, lane, sourcePath, component };
      this.dashboardLaneWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.dashboardLaneWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  refreshDashboardLaneBadges(now = new Date()) {
    if (!this.dashboardLaneWidgets || this.dashboardLaneWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    const loaded = loadPlanCaps();
    for (const widget of Array.from(this.dashboardLaneWidgets)) {
      try {
        const el = widget.el;
        const lane = widget.lane === "next" ? "next" : "pending";
        const label = lane === "next" ? "NEXT" : "PENDING";
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.dashboardLaneWidgets.delete(widget);
          }
          continue;
        }
        const budget = this.dashboardLaneBudget(lane, now);
        const model = dashboardLaneBadgeModel(budget, lane);
        const tooltip = model.tooltip + (loaded.invalid ? " Plan config invalid, using defaults." : "");
        if (el && typeof el.setAttribute === "function") {
          try {
            el.setAttribute("title", tooltip);
            el.setAttribute("aria-label", model.aria);
            el.setAttribute(
              "class",
              `bob-plan-chip bob-plan-${lane}${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`,
            );
          } catch (error) {
            // Best-effort label refresh only.
          }
        }
        try {
          if (el && typeof el.cls === "string") {
            el.cls =
              `bob-plan-chip bob-plan-${lane}${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`;
          }
        } catch (error) {
          // Best-effort class refresh only.
        }
        try {
          const labelSpan = findReadySpan(el, READY_LABEL_CLS);
          if (labelSpan) {
            setReadySpanText(labelSpan, label);
          }
          const valueSpan = findReadySpan(el, READY_VALUE_CLS);
          if (valueSpan) {
            setReadySpanText(
              valueSpan,
              model.placeholder ? "–" : `${model.section}/${model.cap}`,
            );
          }
        } catch (error) {
          // One stale widget never breaks the others.
        }
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleDashboardLaneRefresh() {
    if (
      this.dashboardLaneRefreshTimer !== null &&
      this.dashboardLaneRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.dashboardLaneRefreshTimer = schedule(() => {
      this.dashboardLaneRefreshTimer = null;
      try {
        this.refreshDashboardLaneBadges(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  // Shared READY element renderer used by both the daily `bob-plan`
  // block and the dashboard. Returns the anchor element or null. The
  // element structure (separate READY label and count/cap value spans),
  // classes, fraction, over state, tooltip, and destination are shared;
  // each host page styles them in its own chip language through
  // `styles.css` (single-tone inside the daily block, two-tone on the
  // dashboard).
  paintReadyElement(host, budget, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const invalid = Boolean(options.invalid);
      const model = readyBadgeModel(budget, {
        invalid,
        lane: budget && budget.lane ? budget.lane : null,
      });
      const anchor = host.createEl("a", {
        cls: `bob-plan-chip bob-plan-ready${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`,
        title: model.tooltip,
        href: "dash#READY Tasks",
      });
      setReadyAnchorContent(anchor, model, { kind: "ready", label: "READY" });
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", model.aria);
        anchor.setAttribute("role", "link");
        if (!anchor.hasAttribute("tabindex")) {
          anchor.setAttribute("tabindex", "0");
        }
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText("dash#READY Tasks", sourcePath, newLeaf);
          }
        } catch (error) {
          // The badge still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (
            event &&
            (event.key === "Enter" || event.key === " ")
          ) {
            open(event);
          }
        });
        anchor.addEventListener("mouseover", (event) => {
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.trigger === "function") {
              workspace.trigger("hover-link", {
                event,
                source: "bob-plan",
                hoverParent: host,
                targetEl: anchor,
                linktext: "dash#READY Tasks",
                sourcePath,
              });
            }
          } catch (error) {
            // Hover preview is best-effort only.
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  // Dashboard entry point: `api.renderReadyBadge(parent, { sourcePath,
  // component })`. Uses the shared element renderer and registers
  // lifecycle-owned live updates. Replaces a component's old widget on
  // Dataview rerender and prunes detached nodes.
  renderReadyBadge(parent, options = {}) {
    try {
      if (!parent || typeof parent.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.readyWidgets) {
        this.readyWidgets = new Set();
      }
      // Replace this component's old widget on Dataview rerender.
      if (component) {
        for (const widget of Array.from(this.readyWidgets)) {
          if (widget.component === component) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.readyWidgets.delete(widget);
          }
        }
      }
      // Prune detached nodes before adding.
      for (const widget of Array.from(this.readyWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            // Only prune nodes that are truly detached and parentless;
            // freshly created anchors not yet attached are kept by the
            // caller adding them below.
            if (!parent.contains || !parent.contains(el)) {
              this.readyWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      const loaded = loadPlanCaps();
      const budget = this.readyBudget(new Date());
      const anchor = this.paintReadyElement(parent, budget, {
        sourcePath,
        invalid: loaded.invalid,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, sourcePath, component };
      this.readyWidgets.add(widget);
      if (
        component &&
        typeof component.register === "function"
      ) {
        try {
          component.register(() => {
            this.readyWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      this.rememberReadyCaps(new Date());
      return anchor;
    } catch (error) {
      return null;
    }
  }

  rememberReadyCaps(now = new Date()) {
    try {
      const { caps } = loadPlanCaps();
      const effective = effectivePlanCaps(caps);
      this.readyLastCapsKey = JSON.stringify(effective);
      this.readyLastDay = this.todayLocalDate(now);
    } catch (error) {
      // Best-effort snapshot only.
    }
  }

  refreshReadyBadges(now = new Date()) {
    if (!this.readyWidgets || this.readyWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    const loaded = loadPlanCaps();
    const budget = this.readyBudget(now);
    for (const widget of Array.from(this.readyWidgets)) {
      try {
        const el = widget.el;
        if (!el || typeof el.empty === "function") {
          // Dataview container anchors are replaced in place.
        }
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          // Prune widgets whose host is gone.
          if (!el || !el.isConnected) {
            this.readyWidgets.delete(widget);
          }
          continue;
        }
        const model = readyBadgeModel(budget, {
          invalid: loaded.invalid,
          lane: budget && budget.lane ? budget.lane : null,
        });
        // One shared routine keeps the label/value spans (and the
        // model-dependent title, aria label, and state classes) current
        // without replacing the anchor or flattening it to plain text,
        // so listeners and widget registration survive live updates.
        setReadyAnchorContent(el, model);
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    this.rememberReadyCaps(now);
    return refreshed;
  }

  scheduleReadyRefresh() {
    if (
      this.readyRefreshTimer !== null &&
      this.readyRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.readyRefreshTimer = schedule(() => {
      this.readyRefreshTimer = null;
      try {
        this.refreshReadyBadges(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
      try {
        this.refreshDashboardLaneBadges(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
      try {
        this.rerenderPlanBlocks();
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  checkReadyCapsAndDay(now = new Date()) {
    try {
      const { caps } = loadPlanCaps();
      const key = JSON.stringify(effectivePlanCaps(caps));
      const day = this.todayLocalDate(now);
      if (this.readyLastCapsKey === null || this.readyLastDay === null) {
        this.readyLastCapsKey = key;
        this.readyLastDay = day;
        return false;
      }
      if (key !== this.readyLastCapsKey || day !== this.readyLastDay) {
        this.readyLastCapsKey = key;
        this.readyLastDay = day;
        this.refreshReadyBadges(now);
        this.refreshDashboardLaneBadges(now);
        this.schedulePlanBlockRerender();
        try {
          this.noteReadyEnsureSnapshot(now);
        } catch (error) {
          // The snapshot rebuilds on next access; only the eager
          // query-refresh trigger is skipped.
        }
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

}
