class BobLedgerToolsTodayLocationMixin {
  resolveTodayLink(target, dailyPath) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      return metadataCache.getFirstLinkpathDest(target, dailyPath);
    } catch (error) {
      return null;
    }
  }

  // Rebuild the cache from daily-note text. When the key set changes,
  // every open Tasks query re-reads via TODAY_RELOAD_EVENT and the
  // bob-plan blocks re-render (debounced, like the existing re-render).
  // Becoming ready for the current day (including an empty TODAY set)
  // also schedules that refresh so daily section badges can leave `–`.
  // Returns true when the membership keys changed.
  rebuildTodayCache(content, dailyPath, now = new Date()) {
    if (!this.todayCache || !(this.todayCache.rank instanceof Map)) {
      this.todayCache = {
        date: null,
        dailyPath: null,
        keys: [],
        rank: new Map(),
      };
    }
    const wasReady = this.isTodayCacheReady(now);
    const links = computeTodayLinks(content, dailyPath);
    const keys = resolveTodayKeys(links, dailyPath, (target, daily) =>
      this.resolveTodayLink(target, daily),
    );
    const previous = this.todayCache.keys || [];
    const changed =
      previous.length !== keys.length ||
      previous.some((key, index) => key !== keys[index]);
    this.todayCache = {
      date: this.todayLocalDate(now),
      dailyPath,
      keys,
      rank: new Map(keys.map((key, index) => [key, index])),
    };
    const becameReady = !wasReady && this.isTodayCacheReady(now);
    if (changed || becameReady) {
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // The cache is still correct; only the live refresh is skipped.
      }
      this.schedulePlanBlockRerender();
      this.scheduleFreshnessStatusBar();
      this.scheduleFreshnessMarksRefresh();
    }
    return changed;
  }

  currentTodayDailyPath(now = new Date()) {
    try {
      return todayDailyPath(now, getDailyNotesOptions(this.app));
    } catch (error) {
      return null;
    }
  }

  refreshTodayCacheFromDaily(now = new Date()) {
    const dailyPath = this.currentTodayDailyPath(now);
    if (!dailyPath) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.readPlanBlockContent(dailyPath)).then(
      (content) => {
        // A missing daily note means an empty Today, not an error.
        if (typeof content !== "string") {
          return this.rebuildTodayCache("", dailyPath, now);
        }
        return this.rebuildTodayCache(content, dailyPath, now);
      },
    );
  }

  refreshTodayCacheForChangedFile(file, data, now = new Date()) {
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath) {
      return false;
    }
    if (!sameVaultPath(changedPath, this.currentTodayDailyPath(now))) {
      return false;
    }
    if (typeof data === "string") {
      this.rebuildTodayCache(data, changedPath, now);
      return true;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
  }

  refreshTodayCacheForVaultEvent(file, now = new Date()) {
    const workspace = this.app && this.app.workspace;
    if (workspace && workspace.layoutReady === false) {
      return false;
    }
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath) {
      return false;
    }
    const candidates = [this.currentTodayDailyPath(now)];
    if (
      this.todayCache &&
      typeof this.todayCache.dailyPath === "string" &&
      this.todayCache.dailyPath
    ) {
      candidates.push(this.todayCache.dailyPath);
    }
    if (!candidates.some((candidate) => sameVaultPath(changedPath, candidate))) {
      return false;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
  }

  refreshTodayCacheForRollover(now = new Date()) {
    const dailyPath = this.currentTodayDailyPath(now);
    if (!dailyPath) {
      return false;
    }
    if (
      this.todayCache &&
      sameVaultPath(this.todayCache.dailyPath || "", dailyPath)
    ) {
      return false;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
  }

  schedulePlanBlockRerenderForFile(file) {
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath || !this.planBlockViews) {
      return;
    }
    for (const view of this.planBlockViews) {
      const target = planBlockTargetPath(this.app, view.sourcePath);
      if (target === changedPath) {
        this.schedulePlanBlockRerender();
        return;
      }
    }
  }

  schedulePlanBlockRerender() {
    if (
      this.planBlockRerenderTimer !== null &&
      this.planBlockRerenderTimer !== undefined
    ) {
      this.scheduleReadyRefresh();
      this.scheduleDashboardLaneRefresh();
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.planBlockRerenderTimer = schedule(() => {
      this.planBlockRerenderTimer = null;
      this.rerenderPlanBlocks();
    }, 150);
    this.scheduleReadyRefresh();
    this.scheduleDashboardLaneRefresh();
  }

  rerenderPlanBlocks() {
    if (!this.planBlockViews) {
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
      return;
    }
    for (const view of Array.from(this.planBlockViews)) {
      try {
        this.paintPlanBlock(view.el, view.sourcePath);
      } catch (error) {
        // One stale block never breaks the others.
      }
    }
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

  renderPlanBlock(el, ctx) {
    if (!el) {
      return;
    }
    const sourcePath = ctx && ctx.sourcePath;
    if (!this.planBlockViews) {
      this.planBlockViews = new Set();
    }
    const view = { el, sourcePath };
    this.planBlockViews.add(view);
    if (ctx && typeof ctx.addChild === "function") {
      // Unregister the view when the markdown preview drops the block.
      // Obsidian calls child.load() on the added child, so use a real
      // MarkdownRenderChild with a guarded fallback for test harnesses.
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = () => {
            if (this.planBlockViews) {
              this.planBlockViews.delete(view);
            }
            if (this.planPaintGens) {
              this.planPaintGens.delete(el);
            }
          };
        }
      } catch (error) {
        child = null;
      }
      if (!child) {
        child = {
          unload: () => {
            if (this.planBlockViews) {
              this.planBlockViews.delete(view);
            }
            if (this.planPaintGens) {
              this.planPaintGens.delete(el);
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
    this.paintPlanBlock(el, sourcePath);
  }

  paintPlanBlock(el, sourcePath) {
    const targetPath = planBlockTargetPath(this.app, sourcePath);
    if (!this.planPaintGens) {
      this.planPaintGens = new Map();
    }
    const paintGen = (this.planPaintGens.get(el) || 0) + 1;
    this.planPaintGens.set(el, paintGen);
    Promise.resolve(this.readPlanBlockContent(targetPath))
      .then((content) => {
        if (this.planPaintGens.get(el) !== paintGen) {
          return;
        }
        if (!el || typeof el.empty !== "function") {
          return;
        }
        const paintDay = new Date();
        const { caps, invalid } = loadPlanCaps();
        const tasks = planBlockTasks(this.app);
        const nextDashboard = this.dashboardLaneBudget("next", paintDay);
        const pendingDashboard = this.dashboardLaneBudget(
          "pending",
          paintDay,
        );
        if (this.planPaintGens.get(el) !== paintGen) {
          return;
        }
        el.empty();
        // Gate READY from one validated snapshot; a missing snapshot
        // keeps the legacy ungated count and tooltip.
        let planGate = null;
        let planReview = null;
        try {
          const gateMemo = this.freshnessEnsureMemo(paintDay);
          if (gateMemo && gateMemo.tasksAvailable) {
            planGate = this.freshnessReviewPredicate(gateMemo);
            planReview = {
              new: gateMemo.counts.new,
              rotten:
                gateMemo.counts.resurfaced + gateMemo.counts.rotten,
            };
          }
        } catch (error) {
          planGate = null;
          planReview = null;
        }
        const model = planBlockModel({
          content,
          tasks,
          today: paintDay,
          caps,
          sourcePath,
          app: this.app,
          isToday: (task) => this.isTodayTask(task),
          isReviewBucket: planGate,
          review: planReview,
          nextDashboard,
          pendingDashboard,
        });
        const container = el.createDiv({ cls: "bob-plan" });
        container.setAttribute("role", "status");
        container.setAttribute(
          "aria-label",
          `${model.planText}, ${model.pendingText}, ${model.nextText}, ${model.readyText}${
            model.budget.status === "over" ? ", over plan" : ""
          }`,
        );
        const todayToneCls = workToneClass(model.todayTone !== undefined ? model.todayTone : todayBadgeTone(model.budget));
        const planBaseCls = `bob-plan-chip bob-plan-plan${
          model.budget.status === "over" ? " bob-plan-over" : ""
        }${!model.budget.hasSection ? " bob-plan-unavailable" : ""}`;
        const planChip = container.createEl("span", {
          cls: todayToneCls ? `${planBaseCls} ${todayToneCls}` : planBaseCls,
          text: model.planText,
          title: model.planTitle,
        });
        planChip.setAttribute("aria-label", `TODAY: ${model.planTitle}`);
        const paintSource =
          typeof sourcePath === "string" ? sourcePath : "";
        try {
          this.paintDashboardLaneElement(
            container,
            "pending",
            pendingDashboard,
            { sourcePath: paintSource, invalid },
          );
        } catch (error) {
          // The PENDING badge degrades; other chips stay.
        }
        try {
          this.paintDashboardLaneElement(
            container,
            "next",
            nextDashboard,
            { sourcePath: paintSource, invalid },
          );
        } catch (error) {
          // The NEXT badge degrades; other chips stay.
        }
        try {
          this.paintReadyElement(container, model.ready ? { count: model.ready.count, cap: model.ready.cap, over: model.ready.over, lane: model.lane || null } : { count: null, cap: effectivePlanCaps(caps).maxReady }, {
            sourcePath: paintSource,
            invalid,
          });
        } catch (error) {
          // The READY badge degrades to a placeholder; other chips stay.
        }
        if (model.themesText) {
          container.createEl("span", {
            cls: "bob-plan-themes",
            text: model.themesText,
          });
        }
        for (const lint of model.lints) {
          container.createEl("div", {
            cls: "bob-plan-lint",
            text: lint,
          });
        }
        if (invalid) {
          container.createEl("div", {
            cls: "bob-plan-lint",
            text: "plan config invalid, using defaults",
          });
        }
      })
      .catch(() => {
        // The block shows `–` values, never an error; a failed paint keeps
        // the previous render.
      });
  }

  dailyLocationMap() {
    if (!(this.dailyLocations instanceof Map)) {
      this.dailyLocations = new Map();
    }
    return this.dailyLocations;
  }

  getRememberedDailyLocation(path) {
    const dailyPath = normalizeVaultPath(path);
    const remembered = normalizeDailyLocation(
      this.dailyLocationMap().get(dailyPath),
    );
    return remembered
      ? {
          ...remembered,
          ...(remembered.cursor ? { cursor: { ...remembered.cursor } } : {}),
        }
      : null;
  }

  isCurrentDailyView(view, expectedPath = this.currentDailyPath()) {
    return !!(
      view &&
      view.file &&
      view.editor &&
      sameVaultPath(view.file.path, expectedPath)
    );
  }

  handleActiveDailyViewChange() {
    const activeFile = getActiveFile(this.app);
    const activePath = activeFile && activeFile.path;
    if (
      this.pendingDailyLocationRestorePath &&
      !sameVaultPath(activePath, this.pendingDailyLocationRestorePath)
    ) {
      this.cancelPendingDailyLocationRestore();
    }

    this.cancelPendingDailyLocationCapture();
    this.refreshDailyScrollCaptureTarget();
    this.captureActiveDailyLocation();
    this.scheduleFreshnessFooterContext();
  }

  refreshDailyScrollCaptureTarget(view = getActiveMarkdownView(this.app)) {
    const dailyPath = this.currentDailyPath();
    const editorView = this.isCurrentDailyView(view, dailyPath)
      ? getEditorViewFromEditor(view.editor)
      : null;
    const scrollDOM = editorView && editorView.scrollDOM;
    if (scrollDOM && scrollDOM === this.activeDailyScrollDOM) {
      return true;
    }

    this.clearDailyScrollCaptureTarget();
    if (!scrollDOM || typeof scrollDOM.addEventListener !== "function") {
      return false;
    }

    const handler = () => this.scheduleDailyLocationCapture();
    try {
      scrollDOM.addEventListener("scroll", handler, { passive: true });
    } catch (error) {
      scrollDOM.addEventListener("scroll", handler);
    }
    this.activeDailyScrollDOM = scrollDOM;
    this.activeDailyScrollHandler = handler;
    return true;
  }

  clearDailyScrollCaptureTarget() {
    if (
      this.activeDailyScrollDOM &&
      this.activeDailyScrollHandler &&
      typeof this.activeDailyScrollDOM.removeEventListener === "function"
    ) {
      try {
        this.activeDailyScrollDOM.removeEventListener(
          "scroll",
          this.activeDailyScrollHandler,
        );
      } catch (error) {
        // Best-effort cleanup only.
      }
    }

    this.activeDailyScrollDOM = null;
    this.activeDailyScrollHandler = null;
  }

  scheduleDailyLocationCapture() {
    if (this.isRestoringDailyLocation) {
      return false;
    }

    this.cancelPendingDailyLocationCapture();
    this.pendingDailyLocationCaptureDeferred = deferToNextFrame(() => {
      this.pendingDailyLocationCaptureDeferred = null;
      if (!this.isRestoringDailyLocation) {
        this.captureActiveDailyLocation();
      }
    });
    return true;
  }

  cancelPendingDailyLocationCapture() {
    cancelDeferred(this.pendingDailyLocationCaptureDeferred);
    this.pendingDailyLocationCaptureDeferred = null;
  }

  trackDailyLocationUpdate(update) {
    if (
      this.isRestoringDailyLocation ||
      !update ||
      (!update.selectionSet && !update.docChanged && !update.viewportChanged)
    ) {
      return false;
    }

    const view = getActiveMarkdownView(this.app);
    if (!this.isCurrentDailyView(view)) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    if (update.view && (!editorView || update.view !== editorView)) {
      return false;
    }

    this.refreshDailyScrollCaptureTarget(view);
    const cursor =
      update.selectionSet || update.docChanged
        ? positionFromCodeMirrorUpdate(update)
        : null;
    return this.captureDailyLocationFromView(view, { cursor });
  }

  captureActiveDailyLocation() {
    return this.captureDailyLocationFromView(getActiveMarkdownView(this.app));
  }

  captureDailyLocationFromView(view, options = {}) {
    const dailyPath = this.currentDailyPath();
    if (
      !this.isCurrentDailyView(view, dailyPath) ||
      (this.isRestoringDailyLocation && !options.force)
    ) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const cursor =
      normalizeEditorPosition(options.cursor) ||
      (typeof view.editor.getCursor === "function"
        ? normalizeEditorPosition(view.editor.getCursor())
        : null);
    const location = {};
    if (cursor) {
      location.cursor = cursor;
    }
    if (scrollDOM) {
      const scrollTop = finiteNumberOrNull(scrollDOM.scrollTop);
      const scrollLeft = finiteNumberOrNull(scrollDOM.scrollLeft);
      if (scrollTop !== null) {
        location.scrollTop = Math.max(0, scrollTop);
      }
      if (scrollLeft !== null) {
        location.scrollLeft = Math.max(0, scrollLeft);
      }
    }

    const normalized = normalizeDailyLocation(location);
    if (!normalized) {
      return false;
    }
    this.dailyLocationMap().set(dailyPath, normalized);
    return true;
  }

  restoreOrDeferDailyLocation(
    path,
    location,
    retriesRemaining = DAILY_LOCATION_RESTORE_RETRIES,
  ) {
    const dailyPath = normalizeVaultPath(path);
    const normalized = normalizeDailyLocation(location);
    if (!dailyPath || !normalized) {
      return false;
    }

    this.cancelPendingDailyLocationCapture();
    this.cancelPendingDailyLocationRestore();
    this.isRestoringDailyLocation = true;
    this.pendingDailyLocationRestorePath = dailyPath;
    const token = this.dailyLocationRestoreToken;
    const state = {
      cursorApplied: !normalized.cursor,
      scrollApplied:
        normalized.scrollTop === undefined &&
        normalized.scrollLeft === undefined,
      assertFramesRemaining: DAILY_LOCATION_RESTORE_ASSERT_FRAMES,
    };

    return this.restoreOrDeferDailyLocationInternal(
      dailyPath,
      normalized,
      Math.max(0, Math.floor(numericOrDefault(retriesRemaining, 0))),
      state,
      token,
      false,
    );
  }

  restoreOrDeferDailyLocationInternal(
    path,
    location,
    retriesRemaining,
    state,
    token,
    assertScroll,
  ) {
    if (token !== this.dailyLocationRestoreToken) {
      return false;
    }

    const result = this.restoreActiveDailyLocation(
      path,
      location,
      state,
      { assertScroll },
    );
    if (!result.active) {
      const activeFile = getActiveFile(this.app);
      const activePath = activeFile && activeFile.path;
      if (!sameVaultPath(activePath, path) || retriesRemaining <= 0) {
        this.finishDailyLocationRestore(token);
        return false;
      }
    }

    const ready = state.cursorApplied && state.scrollApplied;
    const shouldAssert = ready && state.assertFramesRemaining > 0;
    const shouldRetry = !ready && retriesRemaining > 0;
    if (!shouldAssert && !shouldRetry) {
      this.finishDailyLocationRestore(token);
      return result.applied;
    }

    if (shouldAssert) {
      state.assertFramesRemaining -= 1;
    }
    this.pendingDailyLocationRestoreDeferred = deferToNextFrame(() => {
      this.pendingDailyLocationRestoreDeferred = null;
      this.restoreOrDeferDailyLocationInternal(
        path,
        location,
        shouldRetry ? retriesRemaining - 1 : retriesRemaining,
        state,
        token,
        shouldAssert,
      );
    });
    return result.applied;
  }

  restoreActiveDailyLocation(path, location, state, options = {}) {
    const result = { active: false, applied: false };
    const view = getActiveMarkdownView(this.app);
    if (!this.isCurrentDailyView(view, path)) {
      return result;
    }
    result.active = true;
    this.refreshDailyScrollCaptureTarget(view);

    if (!state.cursorApplied && location.cursor) {
      const cursor = clampEditorPosition(view.editor, location.cursor);
      if (
        cursor &&
        setEditorCursor(view.editor, cursor.line, cursor.ch, { scroll: false })
      ) {
        state.cursorApplied = true;
        result.applied = true;
      }
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const needsScroll =
      location.scrollTop !== undefined || location.scrollLeft !== undefined;
    if (
      scrollDOM &&
      needsScroll &&
      (!state.scrollApplied || options.assertScroll)
    ) {
      const scrollTop =
        location.scrollTop !== undefined
          ? location.scrollTop
          : finiteNumberOrNull(scrollDOM.scrollTop) || 0;
      const scrollLeft =
        location.scrollLeft !== undefined
          ? location.scrollLeft
          : finiteNumberOrNull(scrollDOM.scrollLeft) || 0;
      if (setScrollDOMPosition(scrollDOM, scrollTop, scrollLeft)) {
        state.scrollApplied = true;
        result.applied = true;
      }
    }
    return result;
  }

  finishDailyLocationRestore(token) {
    if (token !== this.dailyLocationRestoreToken) {
      return;
    }

    const path = this.pendingDailyLocationRestorePath;
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.isRestoringDailyLocation = false;
    const view = getActiveMarkdownView(this.app);
    if (this.isCurrentDailyView(view, path)) {
      this.captureDailyLocationFromView(view, { force: true });
    }
  }

  cancelPendingDailyLocationRestore() {
    cancelDeferred(this.pendingDailyLocationRestoreDeferred);
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.isRestoringDailyLocation = false;
    this.dailyLocationRestoreToken =
      Math.floor(numericOrDefault(this.dailyLocationRestoreToken, 0)) + 1;
  }

}
