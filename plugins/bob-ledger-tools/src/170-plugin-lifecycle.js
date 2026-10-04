class BobLedgerToolsPlugin extends Plugin {
  onload() {
    this.vimMappingsRegistered = false;
    this.pendingCenterDeferred = null;
    this.dailyLocations = new Map();
    this.dailyNavigationActionId = 0;
    this.dailyLocationRestoreToken = 0;
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.pendingDailyLocationCaptureDeferred = null;
    this.activeDailyScrollDOM = null;
    this.activeDailyScrollHandler = null;
    this.isRestoringDailyLocation = false;
    // Task freshness (api v3, freshness namespace v6): memoized
    // tiered review queue plus status bar.
    this.freshnessMemo = null;
    this.freshnessFrontGen = 0;
    // Freshness config snapshot cache (`{ path, statKey, checkedAt,
    // config, invalid }`): the file is stat-checked at most once per
    // 60-second tick and reparsed only on change.
    this.freshnessConfigCache = null;
    // Tasks cache generation observed by this plugin: bumped on every
    // `obsidian-tasks-plugin:cache-update`, so a cache update that
    // reuses the same array object still invalidates the memo.
    this.freshnessTasksGen = 0;
    // Per-note Ready cap (api.noteReady v1): memoized snapshot plus the
    // per-path eligibility fingerprints (`{ fingerprint, entry }`) and
    // their generation. The generation bumps only when a fingerprint
    // changes, so the snapshot rebuilds only then.
    this.noteReadyMemo = null;
    this.noteReadyFrontGen = 0;
    this.noteReadyFrontByPath = new Map();
    // Eligibility is built once (or when marked dirty), then maintained
    // incrementally. Vault create/delete/rename events are ignored until
    // layout ready so Obsidian's startup scan cannot storm the snapshot.
    this.noteReadyEligibilityReady = false;
    this.noteReadyEligibilityDirty = false;
    this.noteReadyEligibilityEntriesCache = null;
    this.noteReadyEligibilityEntriesGen = -1;
    this.noteReadyResolvedSeen = false;
    // Shared NEW/ROTTEN review chips (dashboard and rotten summary use
    // the same live models). Mirrors `readyWidgets` below.
    this.reviewWidgets = new Set();
    this.reviewRefreshTimer = null;
    this.freshnessFrontValues = new Map();
    this.freshnessStatusTimer = null;
    this.freshnessFooterContextTimer = null;
    this.freshnessStatusEl = null;
    this.freshnessFooterParts = null;
    this.freshnessFooterObserver = null;
    this.freshnessFooterClickBound = null;
    this.freshnessFooterPaintKey = "";
    this.freshnessFooterLastView = null;
    // Freshness marks (mark-surfaces): session toggle plus a
    // filesystem-free cached snapshot refreshed on the status bar paths.
    this.freshnessMarksEnabled = true;
    this.freshnessMarkSnapshot = null;
    this.freshnessMarksTimer = null;
    // Dependency chips (bob-cli-3n chips): session toggle; the
    // Tasks-memo index lives on the freshness memo itself.
    this.dependencyChipsEnabled = true;
    this.dependencyChipsTimer = null;

    this.addCommand({
      id: "expand-ledger-time-range-snippet",
      name: "Expand Bob snippet",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView && this.expandFromEditor(editor)) {
          return;
        }

        new Notice("No Bob snippet at cursor");
      },
    });

    this.addCommand({
      id: "open-today-daily-note",
      name: "Open today's daily note",
      callback: async () => {
        const view = await openTodayDailyNote(this.app);
        if (!view) {
          new Notice("Could not open daily note");
        }
      },
    });

    this.addCommand({
      id: "jump-to-current-pomodoro",
      name: "Jump to current Pomodoro line",
      hotkeys: [{ modifiers: ["Ctrl"], key: "9" }],
      callback: () => {
        const view = getActiveMarkdownView(this.app);
        if (!view || !view.editor) {
          new Notice("No active markdown editor");
          return;
        }
        this.jumpToCurrentPomodoro(view.editor);
      },
    });

    this.registerEditorExtension(
      Prec.highest(
        keymap.of([
          {
            key: "Tab",
            run: (cmView) => this.expandFromActiveEditor(cmView),
          },
        ]),
      ),
    );

    if (
      EditorView &&
      EditorView.updateListener &&
      typeof EditorView.updateListener.of === "function"
    ) {
      this.registerEditorExtension(
        EditorView.updateListener.of((update) =>
          this.trackDailyLocationUpdate(update),
        ),
      );
      this.registerEditorExtension(
        EditorView.updateListener.of((update) =>
          this.trackFreshnessFooterUpdate(update),
        ),
      );
    }

    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      this.registerEvent(
        workspace.on("active-leaf-change", () =>
          this.handleActiveDailyViewChange(),
        ),
      );
      this.registerEvent(
        workspace.on("file-open", () => this.handleActiveDailyViewChange()),
      );
    }

    // Live plan budget: a ```bob-plan block plus the versioned `api` the dash
    // and the other plugins call instead of re-implementing docs/plan.md.
    this.planBlockViews = new Set();
    this.planBlockRerenderTimer = null;
    // Shared READY backlog widgets (daily `bob-plan` chips and dashboard
    // `renderReadyBadge` anchors). Reuses one batch state so reopening a
    // note never accumulates widgets, listeners, or timers.
    this.readyWidgets = new Set();
    this.readyRefreshTimer = null;
    this.readyLastCapsKey = null;
    this.readyLastDay = null;
    this.dashboardLaneWidgets = new Set();
    this.dashboardLaneRefreshTimer = null;
    // Per-note Ready cap views (ledger-views): dash CROWDED chips,
    // `bob-ready-notes` blocks, and `## Tasks` heading chips (Live
    // Preview plus Reading view).
    this.crowdedWidgets = new Set();
    this.crowdedRefreshTimer = null;
    // Dashboard collections (dashboardCollections v1): Browse-row
    // PROJECTS / REFERENCES chips. One shared widget set keyed by
    // owning component and kind, one debounced refresh, async Base
    // contracts outside the synchronous snapshot.
    this.dashboardCollectionWidgets = new Set();
    this.dashboardCollectionsRefreshTimer = null;
    this.dashboardCollectionsBase = null;
    this.dashboardCollectionsBaseKey = null;
    this.dashboardCollectionsBaseToken = 0;
    this.readyNotesViews = new Set();
    this.readyNotesRefreshTimer = null;
    this.noteReadyReadingWidgets = new Set();
    this.noteReadyHeadingsRefreshTimer = null;
    this.liveWidgetRefreshTimer = null;
    this.planPaintGen = 0;
    this.planPaintGens = new Map();
    // Synchronous Today cache: `{ date, dailyPath, keys, rank }`. Built
    // from the daily note's text (never awaited inside the api); before
    // the first build `isToday` returns false for every task.
    this.todayCache = { date: null, dailyPath: null, keys: [], rank: new Map() };
    this.api = Object.freeze({
      version: 3,
      caps: () => loadPlanCaps().caps,
      planBudget: (options = {}) => this.planBudgetForCallers(options),
      todayKeys: () => this.todayKeys(),
      isToday: (task) => this.isTodayTask(task),
      todayRank: (task) => this.todayRankOfTask(task),
      nextBudget: () => {
        const { caps } = loadPlanCaps();
        return laneBudgetFromTasks(
          planBlockTasks(this.app) || [],
          new Date(),
          caps,
          "next",
        );
      },
      pendingBudget: () => {
        const { caps } = loadPlanCaps();
        return laneBudgetFromTasks(
          planBlockTasks(this.app) || [],
          new Date(),
          caps,
          "pending",
        );
      },
      dashboardLaneBudget: (lane) => this.dashboardLaneBudget(lane),
      renderDashboardLaneBadge: (parent, options = {}) =>
        this.renderDashboardLaneBadge(parent, options),
      readyBudget: () => this.readyBudget(),
      renderReadyBadge: (parent, options = {}) =>
        this.renderReadyBadge(parent, options),
      renderReviewChip: (parent, options = {}) =>
        this.renderReviewChip(parent, options),
      // Task freshness (freshness namespace v6: date-independent
      // decide/config contract; counting and `keepLine` remain
      // available from v5. Tiered walk NEW → PROJECTS → PENDING →
      // NEXT → RETURNED → REFERENCES → ROTTEN with daily lane review;
      // `state`/`bucket`/`counts`/`config` keep the rotten vocabulary;
      // the removed `stale_daily_budget` key still parses for one
      // release with a deprecation lint. Keep streaks (`keeps`,
      // `decay`, `decide`) mirror `docs/freshness.md` §§2a/4/7/11-12;
      // `keepLine` is the sole increment helper and every generic
      // stamper clears. Tracker review rides the same namespace with
      // the explicit `trackerReview` capability: exact `^ref`
      // trackers bypass `#hide`, visible `^prj` rows use the ordinary
      // predicate, and the PROJECTS/REFERENCES tiers walk with
      // `projectsDue`/`referencesDue` and the seven-key `byTier`
      // histogram. The explicit `referenceReview` capability tells
      // consumers the queue may carry `references` entries.
      // Top-level api stays v3).
      // `freshness` mirrors `docs/freshness.md` §4 in bob-cli. Every
      // member is synchronous, never awaits and never throws. Missing
      // or old freshness namespaces degrade vault queries to the
      // legacy READY visibility: guard calls with try/catch as well as
      // optional chaining, since optional chaining alone does not
      // catch a throwing api. `reviewEntryView` is additive under
      // namespace v5: it formats already-evaluated queue entries.
      freshness: Object.freeze({
        version: 6,
        trackerReview: true,
        referenceReview: true,
        config: () => this.apiFreshnessConfig(),
        stampLine: (line, dateText) =>
          this.apiFreshnessStampLine(line, dateText),
        setRefreshLine: (line, days, dateText) =>
          this.apiFreshnessSetRefreshLine(line, days, dateText),
        keepLine: (line, dateText, options) =>
          this.apiFreshnessKeepLine(line, dateText, options),
        state: (task) => this.apiFreshnessState(task),
        bucket: (task) => this.apiFreshnessBucket(task),
        reviewModel: () => this.freshnessReviewModel(),
        isDue: (task) => this.apiFreshnessIsDue(task),
        tier: (task) => this.apiFreshnessTier(task),
        rank: (task) => this.apiFreshnessRank(task),
        intervalFor: (task) => this.apiFreshnessIntervalFor(task),
        intervalForLine: (line, noteRefreshRaw) =>
          this.apiFreshnessIntervalForLine(line, noteRefreshRaw),
        queue: () => this.apiFreshnessQueue(),
        counts: () => this.apiFreshnessCounts(),
        lints: () => this.apiFreshnessLints(),
        reviewEntryView: (entry, viewOptions) =>
          this.apiFreshnessReviewEntryView(entry, viewOptions),
      }),
      // Per-note Ready cap (`docs/plan.md`, "Ready cap per note" in
      // bob-cli): read-only lane counts per area/project note against
      // the per-note cap. Top-level api stays v3 (additive). Every
      // member is synchronous and never throws: guard calls with
      // try/catch as well as optional chaining.
      noteReady: Object.freeze({
        version: 1,
        snapshot: (now) => this.apiNoteReadySnapshot(now),
        forNote: (path) => this.apiNoteReadyForNote(path),
        counted: (task) => this.apiNoteReadyCounted(task),
        inCrowdedNote: (task) => this.apiNoteReadyInCrowdedNote(task),
        groupLabel: (task) => this.apiNoteReadyGroupLabel(task),
        renderCrowdedChip: (host, options = {}) =>
          this.renderCrowdedChip(host, options),
      }),
      // Dashboard collections (dashboardCollections namespace v1):
      // live PROJECTS / REFERENCES badges. Additive: top-level api
      // stays v3. Every member is synchronous and never throws: guard
      // calls with try/catch as well as optional chaining.
      dashboardCollections: Object.freeze({
        version: DASHBOARD_COLLECTIONS_VERSION,
        snapshot: () => this.dashboardCollectionsSnapshot(),
        renderChip: (host, options = {}) =>
          this.dashboardCollectionsRenderChip(host, options),
      }),
    });
    if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
      this.registerMarkdownCodeBlockProcessor("bob-plan", (source, el, ctx) =>
        this.renderPlanBlock(el, ctx),
      );
      this.registerMarkdownCodeBlockProcessor(
        "bob-ready-notes",
        (source, el, ctx) => this.renderReadyNotesBlock(el, ctx),
      );
    }
    try {
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderNoteReadyHeadingInReading(el, ctx),
          50,
        );
      }
    } catch (error) {
      // Reading heading chips are best-effort.
    }
    try {
      const headingExtension = this.createNoteReadyHeadingExtension();
      if (
        headingExtension &&
        typeof this.registerEditorExtension === "function"
      ) {
        this.registerEditorExtension(headingExtension);
      }
    } catch (error) {
      // Live Preview heading chips are best-effort.
    }
    const metadataCache = this.app && this.app.metadataCache;
    if (metadataCache && typeof metadataCache.on === "function") {
      this.registerEvent(
        metadataCache.on("changed", (file, data) => {
          this.schedulePlanBlockRerenderForFile(file);
          this.refreshTodayCacheForChangedFile(file, data);
          this.refreshFreshnessForChangedFile(file, data);
          this.refreshNoteReadyForChangedFile(file);
          this.scheduleDashboardCollectionsRefresh();
          try {
            const path = file && typeof file.path === "string" ? file.path : "";
            if (/(^|\/)(projects\.base|refs\.base)$/.test(path)) {
              void this.dashboardCollectionsEnsureBaseContracts();
            }
          } catch (error) {
            // Best-effort Base reload only.
          }
        }),
      );
      this.registerEvent(
        metadataCache.on("deleted", (file) => {
          this.refreshNoteReadyForDeletedPath(file && file.path);
          this.scheduleDashboardCollectionsRefresh();
        }),
      );
      this.registerEvent(
        metadataCache.on("resolved", () => {
          this.refreshTodayCacheFromDaily();
          this.scheduleDashboardCollectionsRefresh();
          if (!this.noteReadyResolvedSeen) {
            this.noteReadyResolvedSeen = true;
            this.noteReadyEligibilityDirty = true;
          }
          try {
            void this.dashboardCollectionsEnsureBaseContracts();
          } catch (error) {
            // Best-effort Base reload only.
          }
        }),
      );
    }
    const vault = this.app && this.app.vault;
    if (vault && typeof vault.on === "function") {
      for (const event of ["create", "delete", "rename"]) {
        this.registerEvent(
          vault.on(event, (file) => this.refreshTodayCacheForVaultEvent(file)),
        );
      }
      for (const event of ["create", "delete", "rename"]) {
        this.registerEvent(
          vault.on(event, (file, oldPath) =>
            this.refreshNoteReadyForVaultEvent(event, file, oldPath),
          ),
        );
      }
      for (const event of ["create", "delete", "rename", "modify"]) {
        this.registerEvent(
          vault.on(event, (file, oldPath) =>
            this.refreshDashboardCollectionsForFileEvent(file, oldPath),
          ),
        );
      }
    }
    try {
      void this.dashboardCollectionsEnsureBaseContracts();
    } catch (error) {
      // Base contracts load asynchronously; the snapshot stays
      // unavailable until they resolve.
    }
    if (
      typeof this.registerInterval === "function" &&
      typeof window !== "undefined" &&
      typeof window.setInterval === "function"
    ) {
      // Local-midnight rollover: rebuild once the daily path changes.
      // The same minute tick picks up a changed `max_ready` (or day)
      // within 60 seconds without a plugin reload or a per-badge poller,
      // and refreshes READY even when no daily note exists and the Today
      // key set remains empty.
      this.registerInterval(
        window.setInterval(() => {
          const rolled = this.refreshTodayCacheForRollover();
          this.refreshFreshnessForRollover();
          const capsChanged = this.checkReadyCapsAndDay(new Date());
          if (!rolled && !capsChanged) {
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
          }
          // Calendar-derived labels and escalation refresh each day
          // even when every due task remains due.
          try {
            this.refreshReviewChips(new Date());
          } catch (error) {
            // Best-effort refresh only.
          }
          try {
            this.refreshDashboardCollectionChips(new Date());
          } catch (error) {
            // Best-effort refresh only.
          }
        }, 60 * 1000),
      );
    }
    const planWorkspace = this.app && this.app.workspace;
    if (planWorkspace && typeof planWorkspace.on === "function") {
      // The vault runs Tasks 8.4.0, which fires this on every cache update.
      // A Ready task being linked or unlinked from Today refreshes both
      // badges even if its checkbox has not yet reconciled.
      this.registerEvent(
        planWorkspace.on("obsidian-tasks-plugin:cache-update", () => {
          // Bump the observed Tasks generation first: a cache update
          // may reuse the same array object, and the freshness memo
          // must still rebuild on the next read.
          this.freshnessTasksGen = (this.freshnessTasksGen || 0) + 1;
          this.schedulePlanBlockRerender();
          this.scheduleLiveWidgetRefresh();
        }),
      );
    }
    const tasksPluginLoaded = Boolean(
      this.app &&
        this.app.plugins &&
        this.app.plugins.plugins &&
        this.app.plugins.plugins["obsidian-tasks-plugin"],
    );
    if (
      !tasksPluginLoaded &&
      typeof this.registerInterval === "function" &&
      typeof window !== "undefined" &&
      typeof window.setInterval === "function"
    ) {
      // Poll only when the Tasks plugin is not loaded; otherwise the
      // cache-update event above keeps the blocks fresh.
      this.registerInterval(
        window.setInterval(() => this.rerenderPlanBlocks(), 5000),
      );
    }

    this.app.workspace.onLayoutReady(() => {
      this.noteReadyEligibilityDirty = true;
      this.refreshDailyScrollCaptureTarget();
      this.captureActiveDailyLocation();
      this.refreshTodayCacheFromDaily();
      if (this.registerVimMappings()) {
        return;
      }

      const ref = this.app.workspace.on("active-leaf-change", () => {
        if (this.registerVimMappings()) {
          this.app.workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });

    this.setupFreshnessStatusBar();
    this.scheduleFreshnessStatusBar();
    this.setupFreshnessMarks();
    this.scheduleFreshnessMarksRefresh();
    this.setupDependencyChips();
    this.scheduleDependencyChipsRefresh();
  }

  onunload() {
    if (
      this.planBlockRerenderTimer !== null &&
      this.planBlockRerenderTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.planBlockRerenderTimer);
    }
    this.planBlockRerenderTimer = null;
    if (this.planBlockViews) {
      this.planBlockViews.clear();
    }
    if (
      this.readyRefreshTimer !== null &&
      this.readyRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.readyRefreshTimer);
    }
    this.readyRefreshTimer = null;
    if (this.readyWidgets) {
      this.readyWidgets.clear();
    }
    if (
      this.dashboardLaneRefreshTimer !== null &&
      this.dashboardLaneRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.dashboardLaneRefreshTimer);
    }
    this.dashboardLaneRefreshTimer = null;
    if (this.dashboardLaneWidgets) {
      this.dashboardLaneWidgets.clear();
    }
    if (
      this.dashboardCollectionsRefreshTimer !== null &&
      this.dashboardCollectionsRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.dashboardCollectionsRefreshTimer);
    }
    this.dashboardCollectionsRefreshTimer = null;
    if (this.dashboardCollectionWidgets) {
      this.dashboardCollectionWidgets.clear();
    }
    this.dashboardCollectionsBase = null;
    this.dashboardCollectionsBaseKey = null;
    this.dashboardCollectionsBaseToken = 0;
    if (
      this.reviewRefreshTimer !== null &&
      this.reviewRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.reviewRefreshTimer);
    }
    this.reviewRefreshTimer = null;
    if (this.reviewWidgets) {
      this.reviewWidgets.clear();
    }
    this.freshnessConfigCache = null;
    this.freshnessTasksGen = 0;
    this.noteReadyMemo = null;
    this.noteReadyFrontGen = 0;
    this.noteReadyEligibilityReady = false;
    this.noteReadyEligibilityDirty = false;
    this.noteReadyEligibilityEntriesCache = null;
    this.noteReadyEligibilityEntriesGen = -1;
    this.noteReadyResolvedSeen = false;
    if (this.noteReadyFrontByPath instanceof Map) {
      this.noteReadyFrontByPath.clear();
    }
    this.readyLastCapsKey = null;
    this.readyLastDay = null;
    if (this.planPaintGens) {
      this.planPaintGens.clear();
    }
    this.todayCache = { date: null, dailyPath: null, keys: [], rank: new Map() };
    if (
      this.freshnessStatusTimer !== null &&
      this.freshnessStatusTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.freshnessStatusTimer);
    }
    this.freshnessStatusTimer = null;
    if (
      this.freshnessFooterContextTimer !== null &&
      this.freshnessFooterContextTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.freshnessFooterContextTimer);
    }
    this.freshnessFooterContextTimer = null;
    try {
      if (
        this.freshnessFooterObserver &&
        typeof this.freshnessFooterObserver.disconnect === "function"
      ) {
        this.freshnessFooterObserver.disconnect();
      }
    } catch (error) {
      // Observer cleanup is best-effort.
    }
    this.freshnessFooterObserver = null;
    try {
      const host = this.freshnessStatusEl;
      const button =
        this.freshnessFooterParts && this.freshnessFooterParts.button;
      if (
        host &&
        this.freshnessFooterClickBound &&
        typeof host.removeEventListener === "function"
      ) {
        host.removeEventListener("click", this.freshnessFooterClickBound);
      }
      if (
        button &&
        this.freshnessFooterClickBound &&
        typeof button.removeEventListener === "function"
      ) {
        button.removeEventListener("click", this.freshnessFooterClickBound);
      }
    } catch (error) {
      // Click cleanup is best-effort.
    }
    this.freshnessFooterClickBound = null;
    this.freshnessFooterParts = null;
    this.freshnessFooterPaintKey = "";
    this.freshnessFooterLastView = null;
    this.freshnessMemo = null;
    if (this.freshnessFrontValues) {
      this.freshnessFrontValues.clear();
    }
    this.freshnessStatusEl = null;
    if (
      this.freshnessMarksTimer !== null &&
      this.freshnessMarksTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.freshnessMarksTimer);
    }
    this.freshnessMarksTimer = null;
    this.freshnessMarkSnapshot = null;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-fresh-marks");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
    if (
      this.dependencyChipsTimer !== null &&
      this.dependencyChipsTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.dependencyChipsTimer);
    }
    this.dependencyChipsTimer = null;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-dep-chips");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
    cancelDeferred(this.pendingCenterDeferred);
    this.pendingCenterDeferred = null;
    this.dailyNavigationActionId += 1;
    this.cancelPendingDailyLocationRestore();
    this.cancelPendingDailyLocationCapture();
    this.clearDailyScrollCaptureTarget();
    if (this.dailyLocations) {
      this.dailyLocations.clear();
    }
  }

}
