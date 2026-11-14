// Keep the lifecycle entrypoint focused; preserve the existing teardown order.
BobLedgerToolsPlugin.prototype.teardownLedgerToolsSurfaces = function () {
    this.teardownCalendarEventPainting();
    this.teardownRelationIndex();
    if (
      this.todayMarksTimer !== null &&
      this.todayMarksTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.todayMarksTimer);
    }
    this.todayMarksTimer = null;
    this.todayJumpInFlight = false;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-today-marks-off");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
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
    try {
      this.teardownStatsBlock();
    } catch (error) {
      // Stats teardown is best-effort.
    }
    try {
      this.teardownReadingBoardBlock();
    } catch (error) {
      // Reading Board block teardown is best-effort.
    }
    try {
      this.teardownReadingBoardData(); this.teardownBankCards(); this.teardownBankDailyChip(); this.teardownBankMarks(); this.teardownBankData(); this.teardownBankActions();
    } catch (error) {
      // Reading Board data teardown is best-effort.
    }
    try { this.teardownAlbumHeader(); this.teardownNotebookHeader(); this.teardownAlbumYamlExcursion?.(); this.teardownAlbumSchemaEntrypoints?.(); } catch (error) {}
    try {
      this.teardownAlbumRecords(); this.teardownProjectsCatalog(); this.teardownAlbumCatalog(); this.teardownNotebookCatalog(); this.teardownNotebookData(); this.teardownAlbumData(); this.teardownProjectsData();
    } catch (error) {
      // Notebook catalog/data and album data teardown is best-effort.
    }
    this.todayCache = emptyTodayCache();
    this.todayCacheGen = 0;
    this.laneWalkMemo = null;
    this.todayEnteredAt = new Map();
    this.todayRevalidateAt = 0;
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
    this.taskTagMarksEnabled = false;
    try {
      if (typeof this.stripTaskTagMarksInDocument === "function") {
        this.stripTaskTagMarksInDocument();
      }
    } catch (error) {
      // Annotation cleanup is best-effort.
    }
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-task-tag-marks");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
    this.priorityLadderCache = null;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-priority-marks");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
    this.dateMarksDay = null;
    this.dateMarksEnabled = false;
    this.tasksDateMarksQueue = [];
    this.tasksDateMarksPending = false;
    this.tasksDateMarksDoneSet = null;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-date-marks");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
    try {
      this.teardownTaskThemeMarksAndColors();
    } catch (error) {
      // Task-theme gate cleanup is best-effort.
    }
    if (
      this.pomodoroHomeChipRefreshTimer !== null &&
      this.pomodoroHomeChipRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.pomodoroHomeChipRefreshTimer);
    }
    this.pomodoroHomeChipRefreshTimer = null;
    if (this.pomodoroHomeChipReadingWidgets) {
      this.pomodoroHomeChipReadingWidgets.clear();
    }
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-pomodoro-home-chips");
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
};
