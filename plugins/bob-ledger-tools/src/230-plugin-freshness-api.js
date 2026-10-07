class BobLedgerToolsFreshnessApiMixin {
  // --- Task freshness (freshness namespace v8) --------------------------
  // Rows come from the Tasks cache (`planBlockTasks`); `fresh` /
  // `refresh`/`created` come from `originalMarkdown`; frontmatter comes
  // from `metadataCache.getCache(path)?.frontmatter?.task_refresh`.
  // Ready visibility is `planLaneVisible` plus status type TODO,
  // `!task.recurrence`, not a canonical daily-note path, and
  // `!isTodayTask`; lane rows (`/` pending, `*` next) walk the same
  // predicate with their lane interval. The evaluated rows and tiered
  // queue are memoized on the identity of the array `getTasks()`
  // returns, the local date, a frontmatter generation, and the config
  // (including lane intervals) — so `rank(task)` stays O(1) inside
  // Tasks' `sort by function`.

  freshnessTodayText(now = new Date()) {
    try {
      return this.todayLocalDate(now);
    } catch (error) {
      return formatLocalDate(new Date());
    }
  }

  // Cached freshness config snapshot: the config path plus its
  // mtime/size is checked at most once per 60-second tick (or on
  // explicit invalidation via `refreshFreshnessConfig`), and the file
  // is reparsed only when the check differs. Creation, deletion,
  // invalid edits and recovery, environment path overrides, and
  // mobile's default-config behavior all flow through the same key, so
  // a config edit is visible within the existing 60-second tick with
  // no per-task disk reads or YAML parses.
  freshnessConfigSnapshot(now = new Date()) {
    const fallback = () => ({
      config: { ...defaultFreshnessConfig(), intervalFromConfig: false },
      invalid: false,
    });
    try {
      const configPath = planConfigPath();
      const cached = this.freshnessConfigCache;
      let nowMs = NaN;
      try {
        nowMs =
          now instanceof Date
            ? now.getTime()
            : Number.isFinite(Number(now))
              ? Number(now)
              : Date.now();
      } catch (error) {
        nowMs = Date.now();
      }
      if (
        cached &&
        cached.path === configPath &&
        Number.isFinite(nowMs) &&
        Number.isFinite(cached.checkedAt) &&
        nowMs - cached.checkedAt < 60 * 1000
      ) {
        return { config: cached.config, invalid: cached.invalid };
      }
      // One stat per check: missing-file errors become part of the key
      // so creation and deletion invalidate like edits do.
      let statKey = null;
      try {
        const fsModule = planRequireOptionalNodeModule("fs");
        if (fsModule && typeof fsModule.statSync === "function") {
          try {
            const stat = fsModule.statSync(configPath);
            const mtime =
              stat && typeof stat.mtimeMs === "number"
                ? stat.mtimeMs
                : String(stat && stat.mtime);
            statKey = mtime + ":" + String(stat && stat.size);
          } catch (statError) {
            statKey =
              "missing:" +
              String(
                (statError && statError.code) || "error",
              );
          }
        }
      } catch (error) {
        statKey = null;
      }
      if (
        cached &&
        cached.path === configPath &&
        statKey !== null &&
        cached.statKey === statKey
      ) {
        cached.checkedAt = nowMs;
        return { config: cached.config, invalid: cached.invalid };
      }
      const loaded = loadFreshnessConfig();
      this.freshnessConfigCache = {
        path: configPath,
        statKey,
        checkedAt: nowMs,
        config: loaded.config,
        invalid: Boolean(loaded.invalid),
      };
      return {
        config: loaded.config,
        invalid: Boolean(loaded.invalid),
      };
    } catch (error) {
      return fallback();
    }
  }

  // Explicit config invalidation: drop the cached snapshot so the next
  // read re-stats and reparses. Returns true when a cache entry existed.
  refreshFreshnessConfig() {
    try {
      const had =
        this.freshnessConfigCache !== null &&
        this.freshnessConfigCache !== undefined;
      this.freshnessConfigCache = null;
      return had;
    } catch (error) {
      return false;
    }
  }

  freshnessFrontValueKey(value) {
    if (value === undefined) {
      return "u";
    }
    return typeof value + ":" + String(value);
  }

  // One shared frontmatter reader (bob-cli-3e fix): every per-note
  // frontmatter lookup resolves through here.
  noteFrontmatter(pathOrFile) {
    return noteFrontmatterFor(this.app, pathOrFile);
  }

  // The note's raw `task_refresh` frontmatter value, cached per path.
  noteFreshnessRawFor(path) {
    const key = String(path || "");
    if (!key) {
      return undefined;
    }
    try {
      if (
        this.freshnessFrontValues &&
        this.freshnessFrontValues instanceof Map &&
        this.freshnessFrontValues.has(key)
      ) {
        return this.freshnessFrontValues.get(key);
      }
      const frontmatter = this.noteFrontmatter(key);
      const value =
        frontmatter && typeof frontmatter === "object"
          ? frontmatter.task_refresh
          : undefined;
      if (this.freshnessFrontValues instanceof Map) {
        this.freshnessFrontValues.set(key, value);
      }
      return value;
    } catch (error) {
      return undefined;
    }
  }

  freshnessContextFor(list, todayText, todayDay) {
    const self = this;
    return {
      list,
      todayDay,
      noteRefreshRawFor: (path) => self.noteFreshnessRawFor(path),
      isToday: (task) => self.isTodayTask(task),
    };
  }

  freshnessBuildMemo(tasks, dateText, snapshot, todayStamp) {
    const list = Array.isArray(tasks) ? tasks : [];
    // One supplied local date throughout the rebuild: the snapshot's
    // date text drives lane visibility too, never a second `new Date()`.
    const todayDay = freshnessDayNumberForDateText(dateText);
    const context = this.freshnessContextFor(list, dateText, todayDay);
    const rows = list.map((task, index) =>
      freshnessRowFromTask(task, index, context),
    );
    const queue = freshnessQueue(rows, dateText, snapshot.config);
    const counts = freshnessCounts(rows, dateText, snapshot.config);
    const lints = freshnessCollectLints(rows, dateText, snapshot.config);
    // One deprecation diagnostic per loaded config — never one per
    // task — when the removed `stale_daily_budget` key supplied the
    // budget or was ignored beside the canonical key.
    if (snapshot.config && snapshot.config.deprecatedStaleBudget) {
      let configPath = "";
      try {
        configPath =
          typeof planConfigPath === "function" ? planConfigPath() : "";
      } catch (error) {
        configPath = "";
      }
      lints.unshift({
        code: "freshness_stale_daily_budget_deprecated",
        path: String(configPath || ""),
        line: null,
        message:
          FRESHNESS_LINT_MESSAGES[
            "freshness_stale_daily_budget_deprecated"
          ] || "freshness_stale_daily_budget_deprecated",
      });
    }
    const rank = new Map(queue.map((entry, index) => [entry.key, index]));
    // Key-to-evaluated-result map built once per snapshot, covering
    // FRESH and out-of-scope rows too — not just the review queue — so
    // warm per-row lookups never re-parse a task or re-read the config.
    // A miss (a task object outside the snapshot) falls back to the
    // per-row evaluator with this memo's config, never a second
    // `ensure` call or a normal-path linear `indexOf` scan.
    const indexByTask = new Map();
    for (let index = 0; index < list.length; index += 1) {
      const task = list[index];
      if (task && typeof task === "object" && !indexByTask.has(task)) {
        indexByTask.set(task, index);
      }
    }
    // Per-row evaluated results aligned with `rows`, so a task object
    // already in the snapshot always serves its own row even when its
    // rank key collides with another row (duplicate block IDs). The
    // key map below only carries unambiguous keys: an ambiguous or
    // missing identity never borrows another row's classification and
    // instead falls back to the per-row evaluator (the neutral policy
    // for genuinely unresolved identity).
    const keyCounts = new Map();
    for (const row of rows) {
      const key = freshnessRowKey(row);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    const evaluatedByIndex = [];
    const evaluatedByKey = new Map();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      try {
        const evaluated = freshnessEvaluate(row, dateText, snapshot.config);
        const entry = {
          state: evaluated.state,
          bucket: freshnessBucketForState(evaluated.state),
          tier: evaluated.tier || null,
          lane: evaluated.lane || null,
          fresh: evaluated.fresh,
          dueOn: evaluated.dueOn,
          daysOverdue: evaluated.daysOverdue,
          intervalDays: evaluated.intervalDays,
          intervalSource: evaluated.intervalSource,
        };
        evaluatedByIndex[rowIndex] = entry;
        if (keyCounts.get(freshnessRowKey(row)) === 1) {
          evaluatedByKey.set(freshnessRowKey(row), entry);
        }
      } catch (error) {
        // One bad row never breaks the snapshot; lookups miss and use
        // the per-row fallback instead.
      }
    }
    return {
      tasks,
      dateText,
      frontGen: this.freshnessFrontGen || 0,
      configKey: JSON.stringify([snapshot.config, snapshot.invalid]),
      config: snapshot.config,
      invalid: snapshot.invalid,
      todayStamp:
        typeof todayStamp === "string" ? todayStamp : null,
      tasksGen: this.freshnessTasksGen || 0,
      tasksAvailable: Array.isArray(tasks),
      rows,
      indexByTask,
      evaluatedByIndex,
      evaluatedByKey,
      queue,
      counts,
      lints,
      rank,
      dueKeys: queue.map((entry) => entry.key),
    };
  }

  // Snapshot key for Today membership and readiness: the cache's
  // date, daily path, and link keys. Any Today change (link, unlink,
  // daily rebuild, rollover) invalidates the memo, because rows bake
  // the membership in at build time.
  freshnessTodayStamp() {
    try {
      const cache = this.todayCache;
      if (!cache || !(cache.rank instanceof Map)) {
        return JSON.stringify([null, null, null]);
      }
      return JSON.stringify([
        cache.date || null,
        cache.dailyPath || null,
        Array.isArray(cache.keys) ? cache.keys : [],
      ]);
    } catch (error) {
      return JSON.stringify(["error", "error", "error"]);
    }
  }

  // Rebuild the memoized rows when the Tasks array identity or
  // generation, the local date, the frontmatter generation, the
  // config, or Today membership/readiness changed. When the queue keys
  // or any row's state/bucket change because of rollover, a
  // frontmatter change, a config change, or a Today-link-only change
  // (not task edits, which Tasks re-renders itself), every open Tasks
  // query re-reads via TODAY_RELOAD_EVENT and the badges, status bar,
  // marks, and review chips refresh on the existing debounce paths.
  freshnessEnsureMemo(now = new Date()) {
    const tasks = planBlockTasks(this.app);
    const dateText = this.freshnessTodayText(now);
    const snapshot = this.freshnessConfigSnapshot(now);
    const configKey = JSON.stringify([snapshot.config, snapshot.invalid]);
    const todayStamp = this.freshnessTodayStamp();
    const tasksGen = this.freshnessTasksGen || 0;
    const memo = this.freshnessMemo;
    if (
      memo &&
      memo.tasks === tasks &&
      memo.dateText === dateText &&
      (memo.frontGen || 0) === (this.freshnessFrontGen || 0) &&
      memo.configKey === configKey &&
      (memo.todayStamp || null) === (todayStamp || null) &&
      (memo.tasksGen || 0) === tasksGen
    ) {
      return memo;
    }
    const previousDueKeys = memo && Array.isArray(memo.dueKeys)
      ? memo.dueKeys
      : null;
    const previousEvaluated =
      memo && memo.evaluatedByKey instanceof Map
        ? memo.evaluatedByKey
        : null;
    const tasksOnlyChange =
      Boolean(memo) &&
      previousDueKeys !== null &&
      (memo.tasks !== tasks || (memo.tasksGen || 0) !== tasksGen) &&
      memo.dateText === dateText &&
      (memo.frontGen || 0) === (this.freshnessFrontGen || 0) &&
      memo.configKey === configKey &&
      (memo.todayStamp || null) === (todayStamp || null);
    const next = this.freshnessBuildMemo(
      tasks,
      dateText,
      snapshot,
      todayStamp,
    );
    this.freshnessMemo = next;
    if (
      !tasksOnlyChange &&
      previousDueKeys !== null &&
      freshnessMemoReviewChanged(previousDueKeys, previousEvaluated, next)
    ) {
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // The memo is still correct; only the live refresh is skipped.
      }
      try {
        this.scheduleLiveWidgetRefresh();
      } catch (error) {
        // One missed schedule never breaks the memo.
      }
    }
    return next;
  }

  freshnessMemoRankKey(task) {
    try {
      if (!task || typeof task !== "object") {
        return null;
      }
      const path = planTaskPath(task) || "";
      if (!path) {
        return null;
      }
      const blockId = planTaskBlockId(task);
      if (blockId) {
        return path + "#" + blockId;
      }
      const line = Number.isInteger(task.lineNumber) ? task.lineNumber + 1 : 1;
      return path + ":" + line;
    } catch (error) {
      return null;
    }
  }

  apiFreshnessConfig() {
    try {
      const snapshot = this.freshnessConfigSnapshot();
      const pendingInterval =
        snapshot.config.pendingInterval !== undefined
          ? snapshot.config.pendingInterval
          : 1;
      const nextInterval =
        snapshot.config.nextInterval !== undefined
          ? snapshot.config.nextInterval
          : 1;
      const projectInterval =
        snapshot.config.projectInterval !== undefined
          ? snapshot.config.projectInterval
          : null;
      const referenceInterval =
        snapshot.config.referenceInterval !== undefined
          ? snapshot.config.referenceInterval
          : null;
      const rawDecay =
        snapshot.config.decay && typeof snapshot.config.decay === "object"
          ? snapshot.config.decay
          : { enabled: true, keeps: 3, enter: null };
      return {
        interval: snapshot.config.interval,
        pendingInterval,
        nextInterval,
        projectInterval,
        referenceInterval,
        rottenDailyBudget: snapshot.config.rottenDailyBudget,
        intervalFromConfig: Boolean(snapshot.config.intervalFromConfig),
        invalid: snapshot.invalid,
        deprecatedStaleBudget: Boolean(
          snapshot.config.deprecatedStaleBudget,
        ),
        decay: {
          enabled: rawDecay.enabled !== false,
          keeps:
            Number.isInteger(rawDecay.keeps) && rawDecay.keeps >= 0
              ? rawDecay.keeps
              : 3,
          enter:
            typeof rawDecay.enter === "string" && rawDecay.enter !== ""
              ? rawDecay.enter
              : null,
        },
      };
    } catch (error) {
      return {
        interval: 7,
        pendingInterval: 1,
        nextInterval: 1,
        projectInterval: null,
        referenceInterval: null,
        rottenDailyBudget: null,
        intervalFromConfig: false,
        invalid: false,
        deprecatedStaleBudget: false,
        decay: { enabled: true, keeps: 3, enter: null },
      };
    }
  }

  apiFreshnessStampLine(line, dateText) {
    try {
      const day =
        parseFreshDateStrict(dateText) || this.freshnessTodayText();
      return freshnessStampLine(line, day).line;
    } catch (error) {
      return String(line || "");
    }
  }

  apiFreshnessSetRefreshLine(line, days, dateText) {
    try {
      const day =
        parseFreshDateStrict(dateText) || this.freshnessTodayText();
      return freshnessSetRefreshLine(line, days, day).line;
    } catch (error) {
      return String(line || "");
    }
  }

  apiFreshnessKeepLine(line, dateText, options) {
    try {
      const day =
        parseFreshDateStrict(dateText) || this.freshnessTodayText();
      return freshnessKeepLine(line, day, options).line;
    } catch (error) {
      return String(line || "");
    }
  }

  // Snapshot context for a per-row fallback: the already-acquired
  // memo's date and config, never a second `ensure` call.
  freshnessFallbackContext(memo) {
    const list =
      memo && Array.isArray(memo.tasks) ? memo.tasks : [];
    return this.freshnessContextFor(
      list,
      (memo && memo.dateText) || this.freshnessTodayText(),
      freshnessDayNumberForDateText((memo && memo.dateText) || ""),
    );
  }

  apiFreshnessRowFor(task, memo) {
    const active = memo || this.freshnessEnsureMemo();
    const index =
      active && active.indexByTask instanceof Map
        ? active.indexByTask.get(task)
        : undefined;
    if (Number.isInteger(index) && active.rows[index]) {
      return active.rows[index];
    }
    // Miss (a task object outside the snapshot): evaluate this row
    // alone with the memo's config, not a second `ensure` call or a
    // linear `indexOf` scan.
    const fallbackIndex =
      task && Number.isInteger(task.lineNumber) ? task.lineNumber : 0;
    return freshnessRowFromTask(
      task,
      fallbackIndex,
      this.freshnessFallbackContext(active),
    );
  }

  // Evaluated `{ state, bucket, tier, lane, ... }` for one task: a
  // warm map hit inside the snapshot, or the per-row evaluator with
  // the memo's config on a miss. Throws only when the memo itself is
  // unusable, so the gated READY count can fall back to the legacy
  // count. `state`/`bucket` stay byte-for-byte; `tier` drives
  // `isDue` and the walk.
  freshnessEvaluatedFor(task, memo) {
    const active = memo || this.freshnessEnsureMemo();
    // A task object already in the snapshot serves its own row's
    // cached result first, so a duplicate block ID (or any other key
    // collision) can never borrow another row's classification.
    if (active && active.indexByTask instanceof Map) {
      const index = active.indexByTask.get(task);
      if (
        Number.isInteger(index) &&
        Array.isArray(active.evaluatedByIndex) &&
        active.evaluatedByIndex[index]
      ) {
        return active.evaluatedByIndex[index];
      }
    }
    // Cloned Tasks query objects (same key, new identity) share the
    // unambiguous key's cached result; ambiguous keys are absent from
    // the map and fall through to the per-row evaluator below.
    const key = this.freshnessMemoRankKey(task);
    if (
      key &&
      active &&
      active.evaluatedByKey instanceof Map &&
      active.evaluatedByKey.has(key)
    ) {
      return active.evaluatedByKey.get(key);
    }
    const row = this.apiFreshnessRowFor(task, active);
    const evaluated = freshnessEvaluate(
      row,
      (active && active.dateText) || this.freshnessTodayText(),
      (active && active.config) || { interval: 7 },
    );
    return {
      state: evaluated.state,
      bucket: freshnessBucketForState(evaluated.state),
      tier: evaluated.tier || null,
      lane: evaluated.lane || null,
      fresh: evaluated.fresh,
      dueOn: evaluated.dueOn,
      daysOverdue: evaluated.daysOverdue,
      intervalDays: evaluated.intervalDays,
      intervalSource: evaluated.intervalSource,
    };
  }

  apiFreshnessState(task) {
    try {
      return this.freshnessEvaluatedFor(task).state;
    } catch (error) {
      return null;
    }
  }

  apiFreshnessBucket(task) {
    try {
      return this.freshnessEvaluatedFor(task).bucket;
    } catch (error) {
      return null;
    }
  }

  // Snapshot-backed READY gate: true when the task sits in NEW or
  // ROTTEN review. Bound to one validated snapshot by the caller.
  freshnessReviewPredicate(memo) {
    const active = memo || this.freshnessMemo;
    return (task) =>
      this.freshnessEvaluatedFor(task, active).bucket !== null;
  }

  // Shared NEW/ROTTEN review model with an explicit availability bit.
  // Unavailable while Tasks data, a Warm cache, or Today is missing —
  // never an empty success.
  freshnessReviewModel(now = new Date()) {
    try {
      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks)) {
        return freshnessReviewUnavailable();
      }
      const state = this.tasksCacheState();
      if (typeof state === "string" && state !== "Warm") {
        return freshnessReviewUnavailable();
      }
      if (!this.isTodayCacheReady(now)) {
        return freshnessReviewUnavailable();
      }
      const memo = this.freshnessEnsureMemo(now);
      // Visible-pool projection for the dashboard NEW/ROTTEN chips:
      // the same memoized evaluated states projected onto the existing
      // visible Ready pool (strict lane visibility, hide excluded), so
      // hidden review-only rows never feed a badge for a section that
      // excludes them. The full `freshness.counts()`/CLI review counts
      // intentionally differ; hidden references still walk through
      // `]s`, the status bar, and the CLI.
      return freshnessReviewModel(
        memo.counts,
        memo.queue,
        this.freshnessVisibleReviewInputs(memo),
      );
    } catch (error) {
      return freshnessReviewUnavailable();
    }
  }

  // Project the memoized evaluated states onto the visible Ready pool
  // for dashboard chips: `{ counts, queue }` over strictly-visible
  // rows only. Never throws; a miss falls back to the full inputs.
  freshnessVisibleReviewInputs(memo) {
    try {
      if (!memo || !Array.isArray(memo.rows) || !Array.isArray(memo.queue)) {
        return null;
      }
      const tasks = Array.isArray(memo.tasks) ? memo.tasks : [];
      const todayDay = freshnessDayNumberForDateText(memo.dateText);
      const visibleKeys = new Set();
      let freshNew = 0;
      let resurfaced = 0;
      let rotten = 0;
      for (let index = 0; index < memo.rows.length; index += 1) {
        const row = memo.rows[index];
        const task = tasks[index];
        if (!row || typeof row !== "object") {
          continue;
        }
        // Strict dashboard visibility (hide excluded): hidden
        // review-only tracker rows never enter the badge pool.
        let visible = false;
        try {
          visible = Boolean(
            task &&
              typeof task === "object" &&
              planLaneVisible(task, tasks, todayDay ?? null),
          );
        } catch (error) {
          visible = false;
        }
        if (!visible) {
          continue;
        }
        visibleKeys.add(freshnessRowKey(row));
        const evaluated =
          memo.evaluatedByIndex && memo.evaluatedByIndex[index] !== undefined
            ? memo.evaluatedByIndex[index]
            : null;
        const st = evaluated ? evaluated.state : null;
        if (st === "new") {
          freshNew += 1;
        } else if (st === "resurfaced") {
          resurfaced += 1;
        } else if (st === "rotten") {
          rotten += 1;
        }
      }
      const queue = memo.queue.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          visibleKeys.has(entry.key) &&
          (entry.state === "resurfaced" || entry.state === "rotten"),
      );
      return {
        counts: {
          ...memo.counts,
          new: freshNew,
          resurfaced,
          rotten,
        },
        queue,
      };
    } catch (error) {
      return null;
    }
  }

  apiFreshnessIsDue(task) {
    try {
      const evaluated = this.freshnessEvaluatedFor(task);
      return (
        evaluated !== null &&
        evaluated !== undefined &&
        evaluated.tier !== null &&
        evaluated.tier !== undefined
      );
    } catch (error) {
      return false;
    }
  }

  apiFreshnessTier(task) {
    try {
      const evaluated = this.freshnessEvaluatedFor(task);
      const tier =
        evaluated !== null && evaluated !== undefined
          ? evaluated.tier
          : null;
      return typeof tier === "string" ? tier : null;
    } catch (error) {
      return null;
    }
  }

  apiFreshnessRank(task) {
    try {
      const memo = this.freshnessEnsureMemo();
      const key = this.freshnessMemoRankKey(task);
      if (!key || !(memo.rank instanceof Map)) {
        return Number.MAX_SAFE_INTEGER;
      }
      const rank = memo.rank.get(key);
      return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
    } catch (error) {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  apiFreshnessIntervalFor(task) {
    try {
      // One memo acquisition, then the same evaluated result used for
      // state/bucket: the cached interval, never a warm row reparse,
      // re-evaluation, or config re-read. A miss still evaluates the
      // row once through the shared path with the acquired memo.
      const memo = this.freshnessEnsureMemo();
      const evaluated = this.freshnessEvaluatedFor(task, memo);
      if (
        evaluated &&
        Number.isInteger(evaluated.intervalDays) &&
        evaluated.intervalDays >= 1 &&
        typeof evaluated.intervalSource === "string"
      ) {
        return {
          days: evaluated.intervalDays,
          source: evaluated.intervalSource,
        };
      }
      return { days: 7, source: "default" };
    } catch (error) {
      return { days: 7, source: "default" };
    }
  }

  apiFreshnessQueue() {
    try {
      const memo = this.freshnessEnsureMemo();
      return memo.queue.map((entry) => ({ ...entry }));
    } catch (error) {
      return [];
    }
  }

  apiFreshnessIntervalForLine(line, noteRefreshRaw) {
    try {
      const snapshot = this.freshnessConfigSnapshot();
      const config =
        snapshot && snapshot.config ? snapshot.config : defaultFreshnessConfig();
      return freshnessIntervalForLine(line, noteRefreshRaw, config);
    } catch (error) {
      return {
        days: 7,
        source: "default",
        ready: { days: 7, source: "default" },
      };
    }
  }

  apiFreshnessCounts() {
    try {
      const memo = this.freshnessEnsureMemo();
      const counts = { ...memo.counts };
      if (counts.byTier && typeof counts.byTier === "object") {
        counts.byTier = { ...counts.byTier };
      }
      return counts;
    } catch (error) {
      return {
        due: 0,
        new: 0,
        resurfaced: 0,
        rotten: 0,
        fresh: 0,
        pendingDue: 0,
        nextDue: 0,
        projectsDue: 0,
        referencesDue: 0,
        preDue: 0,
        postDue: 0,
        byTier: {
          pre: 0,
          new: 0,
          projects: 0,
          pending: 0,
          next: 0,
          tickler: 0,
          references: 0,
          rotten: 0,
          post: 0,
        },
        walk: 0,
        decide: 0,
        refreshedToday: 0,
        upkeepToday: 0,
        budget: null,
        budgetMet: false,
      };
    }
  }

  apiFreshnessLints() {
    try {
      const memo = this.freshnessEnsureMemo();
      return memo.lints.map((lint) => ({ ...lint }));
    } catch (error) {
      return [];
    }
  }

  apiFreshnessReviewEntryView(entry, options = {}) {
    try {
      return freshnessReviewEntryView(entry, options);
    } catch (error) {
      return freshnessReviewEntryViewEmpty();
    }
  }

  // Bump the frontmatter generation when a note's `task_refresh`
  // differs, and re-read the config on bumps and at rollover.
  // Returns true when the generation changed.
  refreshFreshnessForChangedFile(file, data) {
    try {
      const changedPath =
        file && typeof file.path === "string" ? file.path : null;
      if (!changedPath) {
        return false;
      }
      let current = undefined;
      try {
        const frontmatter = this.noteFrontmatter(file);
        current =
          frontmatter && typeof frontmatter === "object"
            ? frontmatter.task_refresh
            : undefined;
      } catch (error) {
        current = undefined;
      }
      if (!(this.freshnessFrontValues instanceof Map)) {
        this.freshnessFrontValues = new Map();
      }
      const had = this.freshnessFrontValues.has(changedPath);
      const previous = had ? this.freshnessFrontValues.get(changedPath) : undefined;
      if (
        had &&
        this.freshnessFrontValueKey(previous) ===
          this.freshnessFrontValueKey(current)
      ) {
        return false;
      }
      if (!had && current === undefined) {
        return false;
      }
      this.freshnessFrontValues.set(changedPath, current);
      this.freshnessFrontGen = (this.freshnessFrontGen || 0) + 1;
      try {
        this.freshnessEnsureMemo();
      } catch (error) {
        // The generation still counts; the memo rebuilds on next access.
      }
      this.scheduleLiveWidgetRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Local-midnight rollover for the review queue. Returns true when the
  // date changed.
  refreshFreshnessForRollover(now = new Date()) {
    try {
      const dateText = this.freshnessTodayText(now);
      if (
        this.freshnessMemo &&
        this.freshnessMemo.dateText === dateText
      ) {
        return false;
      }
      try {
        this.freshnessEnsureMemo(now);
      } catch (error) {
        // The memo rebuilds on next access.
      }
      this.scheduleLiveWidgetRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

}
