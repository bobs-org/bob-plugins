class BobNavigationHotkeysLeafMixin {

  createVimJumpContextWithOrigin(origin) {
    this.ensureVimJumpHistory();
    const normalized = normalizeVimJumpLocation(origin);
    if (!normalized) {
      return null;
    }

    const token = ++this.vimJumpOperationToken;
    return Object.freeze({
      origin: Object.freeze({ ...normalized }),
      token,
    });
  }

  enqueueVimJumpContextTransition(jumpContext, destination, options = {}) {
    const normalizedOrigin = normalizeVimJumpLocation(
      jumpContext && jumpContext.origin,
    );
    const normalizedDestination = normalizeVimJumpLocation(destination);
    if (!normalizedOrigin || !normalizedDestination) {
      return Promise.resolve(false);
    }

    if (vimJumpLocationsEqual(normalizedOrigin, normalizedDestination)) {
      return Promise.resolve(false);
    }

    const expectedPath =
      options && typeof options.expectedPath === "string"
        ? options.expectedPath
        : null;
    // Serialize with traversal so overlapping navigations cannot race the index.
    return this.enqueueVimJumpOperation(() => {
      if (jumpContext.token !== this.vimJumpOperationToken) {
        // A newer navigation began while this destination was settling.
        // Drop the stale context rather than racing the history index.
        return false;
      }

      if (expectedPath) {
        try {
          const active = this.getActiveMarkdownView();
          if (!active || !active.file || active.file.path !== expectedPath) {
            return false;
          }
        } catch (error) {
          return false;
        }
      }

      this.ensureVimJumpHistory();
      const recorded = recordVimJumpTransition(
        this.vimJumpHistory,
        normalizedOrigin,
        normalizedDestination,
      );
      // Advance the token so a late duplicate callback for the same context
      // cannot record twice.
      if (recorded) {
        this.vimJumpOperationToken += 1;
      }
      return recorded;
    });
  }

  beginVimLinkJump(cm) {
    try {
      this.cancelPendingTaskMoveJump();
    } catch (error) {
      // Best-effort cancellation only.
    }
    this.ensureVimJumpHistory();
    let origin = null;
    try {
      const view = this.getActiveMarkdownView();
      if (view && view.file) {
        let cursor = null;
        if (cm && typeof cm.getCursor === "function") {
          cursor = normalizePosition(cm.getCursor());
        }
        if (!cursor && view.editor && typeof view.editor.getCursor === "function") {
          cursor = normalizePosition(view.editor.getCursor());
        }
        if (cursor) {
          origin = { path: view.file.path, line: cursor.line, ch: cursor.ch };
        }
      }
    } catch (error) {
      origin = null;
    }

    return this.createVimJumpContextWithOrigin(origin);
  }

  async finishVimLinkJump(jumpContext, expectedPath) {
    if (!jumpContext || !jumpContext.origin) {
      return false;
    }

    const normalizedOrigin = normalizeVimJumpLocation(jumpContext.origin);
    if (!normalizedOrigin) {
      return false;
    }

    if (typeof expectedPath !== "string" || !expectedPath) {
      return false;
    }

    // Destination readiness is tied to the expected file/leaf and the
    // operation token: never capture an unrelated active note and never run a
    // late recording into a newer navigation.
    const settled = await this.waitForVimJumpDestination(
      expectedPath,
      jumpContext.token,
    );
    if (!settled || !settled.editor) {
      return false;
    }

    if (jumpContext.token !== this.vimJumpOperationToken) {
      return false;
    }

    let destination = null;
    try {
      const cursor = normalizePosition(settled.editor.getCursor());
      if (cursor) {
        destination = { path: expectedPath, line: cursor.line, ch: cursor.ch };
      }
    } catch (error) {
      destination = null;
    }

    if (!normalizeVimJumpLocation(destination)) {
      return false;
    }

    if (vimJumpLocationsEqual(normalizedOrigin, destination)) {
      return false;
    }

    // Serialize with traversal so overlapping link opens cannot race the index.
    return this.enqueueVimJumpContextTransition(jumpContext, destination);
  }

  getLeafViewState(leaf) {
    if (!leaf || typeof leaf.getViewState !== "function") {
      return null;
    }

    try {
      return leaf.getViewState();
    } catch (error) {
      return null;
    }
  }

  cloneViewState(viewState) {
    if (!viewState || typeof viewState !== "object") {
      return null;
    }

    if (typeof structuredClone === "function") {
      try {
        return structuredClone(viewState);
      } catch (error) {
        // Fall through to the JSON or shallow clone.
      }
    }

    try {
      return JSON.parse(JSON.stringify(viewState));
    } catch (error) {
      return {
        ...viewState,
        state:
          viewState.state && typeof viewState.state === "object"
            ? Array.isArray(viewState.state)
              ? [...viewState.state]
              : { ...viewState.state }
            : viewState.state,
      };
    }
  }

  createNewTabLeaf(workspace, sourceLeaf) {
    if (!workspace || typeof workspace.getLeaf !== "function") {
      return null;
    }

    try {
      const tabLeaf = workspace.getLeaf("tab");
      if (tabLeaf && tabLeaf !== sourceLeaf) {
        return tabLeaf;
      }
    } catch (error) {
      // Fall through to the older new-leaf API.
    }

    try {
      const fallbackLeaf = workspace.getLeaf(true);
      return fallbackLeaf && fallbackLeaf !== sourceLeaf ? fallbackLeaf : null;
    } catch (error) {
      return null;
    }
  }

  async openMarkdownFileInLeaf(leaf, file) {
    if (
      !leaf ||
      !this.isMarkdownFile(file) ||
      typeof leaf.openFile !== "function"
    ) {
      return false;
    }

    try {
      await leaf.openFile(file);
      return true;
    } catch (error) {
      return false;
    }
  }

  async focusWorkspaceLeaf(leaf) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || !leaf) {
      return false;
    }

    if (typeof workspace.revealLeaf === "function") {
      try {
        await workspace.revealLeaf(leaf);
      } catch (error) {
        // Fall through to direct activation.
      }
    }

    let focused = false;
    if (typeof workspace.setActiveLeaf === "function") {
      try {
        workspace.setActiveLeaf(leaf, { focus: true });
        focused = true;
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
          focused = true;
        } catch (ignoredError) {
          // Try the leaf-level focus API below.
        }
      }
    }

    if (typeof leaf.focus === "function") {
      try {
        leaf.focus();
        focused = true;
      } catch (error) {
        return focused;
      }
    }

    return focused;
  }

  placeDuplicateTabAfterSource(sourceLeaf, targetLeaf) {
    if (!sourceLeaf || !targetLeaf || sourceLeaf === targetLeaf) {
      return false;
    }

    const workspace = this.app && this.app.workspace;
    const parent = sourceLeaf.parent || sourceLeaf.parentSplit;
    const targetParent = targetLeaf.parent || targetLeaf.parentSplit;
    const children = parent && parent.children;
    if (
      !workspace ||
      !parent ||
      parent !== targetParent ||
      !Array.isArray(children)
    ) {
      return false;
    }

    const sourcePos = children.indexOf(sourceLeaf);
    const targetPos = children.indexOf(targetLeaf);
    if (sourcePos === -1 || targetPos === -1) {
      return false;
    }

    try {
      children.splice(targetPos, 1);
      const newSourcePos = children.indexOf(sourceLeaf);
      if (newSourcePos === -1) {
        children.splice(targetPos, 0, targetLeaf);
        return false;
      }
      children.splice(newSourcePos + 1, 0, targetLeaf);
    } catch (error) {
      return false;
    }

    if (typeof parent.selectTab === "function") {
      try {
        parent.selectTab(targetLeaf);
        return true;
      } catch (error) {
        // Fall through to the generic workspace-split update path.
      }
    }

    const sourceEl = sourceLeaf.containerEl;
    const targetEl = targetLeaf.containerEl;
    if (
      sourceEl &&
      targetEl &&
      sourceEl.parentElement &&
      sourceEl.parentElement === targetEl.parentElement &&
      sourceEl.nextSibling !== targetEl
    ) {
      sourceEl.parentElement.insertBefore(targetEl, sourceEl.nextSibling);
    }

    if (typeof parent.recomputeChildrenDimensions === "function") {
      parent.recomputeChildrenDimensions();
    }
    if (typeof targetLeaf.onResize === "function") {
      targetLeaf.onResize();
    }
    if (typeof workspace.onLayoutChange === "function") {
      workspace.onLayoutChange();
    }

    return true;
  }

  async cleanupFailedDuplicateTab(sourceLeaf, targetLeaf) {
    if (targetLeaf && targetLeaf !== sourceLeaf) {
      await this.detachWorkspaceLeaf(targetLeaf);
    }

    await this.focusWorkspaceLeaf(sourceLeaf);
  }

  async detachWorkspaceLeaf(leaf) {
    if (!leaf || typeof leaf.detach !== "function") {
      return false;
    }

    try {
      const result = leaf.detach();
      if (result && typeof result.then === "function") {
        await result;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  moveActiveTab(offset) {
    const workspace = this.app && this.app.workspace;
    const leaf = workspace && workspace.activeLeaf;
    if (!workspace || !leaf) {
      return false;
    }

    const parent = leaf.parent || leaf.parentSplit;
    const children = parent && parent.children;
    if (!Array.isArray(children) || children.length < 2) {
      return false;
    }

    const fromPos = children.indexOf(leaf);
    if (fromPos === -1) {
      return false;
    }

    const toPos = fromPos + offset;
    if (toPos < 0 || toPos >= children.length) {
      return false;
    }

    const displacedLeaf = children[toPos];
    children.splice(fromPos, 1);
    children.splice(toPos, 0, leaf);

    if (typeof parent.selectTab === "function") {
      try {
        parent.selectTab(leaf);
        return true;
      } catch (error) {
        // Fall through to the generic workspace-split update path.
      }
    }

    const leafEl = leaf.containerEl;
    const displacedEl = displacedLeaf && displacedLeaf.containerEl;
    if (
      leafEl &&
      displacedEl &&
      leafEl.parentElement &&
      leafEl.parentElement === displacedEl.parentElement
    ) {
      const containerEl = leafEl.parentElement;
      if (offset > 0) {
        containerEl.insertBefore(leafEl, displacedEl.nextSibling);
      } else {
        containerEl.insertBefore(leafEl, displacedEl);
      }
    }

    if (typeof parent.recomputeChildrenDimensions === "function") {
      parent.recomputeChildrenDimensions();
    }
    if (typeof leaf.onResize === "function") {
      leaf.onResize();
    }
    if (typeof workspace.onLayoutChange === "function") {
      workspace.onLayoutChange();
    }

    if (typeof workspace.setActiveLeaf === "function") {
      try {
        workspace.setActiveLeaf(leaf, { focus: true });
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
        } catch (ignoredError) {
          return false;
        }
      }
    }

    return true;
  }

  async closeSiblingTabs(scope) {
    const workspace = this.app && this.app.workspace;
    const activeLeaf = workspace && workspace.activeLeaf;
    if (!workspace || !activeLeaf) {
      return false;
    }

    const parent = activeLeaf.parent || activeLeaf.parentSplit;
    const children = parent && parent.children;
    if (!Array.isArray(children) || children.length < 2) {
      return false;
    }

    // Snapshot the sibling list before detaching anything: detaching a leaf
    // mutates parent.children, so iterating the live array would skip leaves.
    const snapshot = children.slice();
    const activeIndex = snapshot.indexOf(activeLeaf);
    if (activeIndex === -1) {
      return false;
    }

    let leavesToClose;
    if (scope === "left") {
      leavesToClose = snapshot.slice(0, activeIndex);
    } else if (scope === "right") {
      leavesToClose = snapshot.slice(activeIndex + 1);
    } else if (scope === "others") {
      leavesToClose = snapshot.filter((leaf) => leaf !== activeLeaf);
    } else {
      return false;
    }

    leavesToClose = leavesToClose.filter(
      (leaf) => !this.isWorkspaceLeafPinned(leaf),
    );
    if (leavesToClose.length === 0) {
      return false;
    }

    // Detach sequentially: each detach mutates the workspace layout, so closing
    // siblings one at a time keeps the operation predictable.
    for (const leaf of leavesToClose) {
      await this.detachWorkspaceLeaf(leaf);
    }

    await this.focusWorkspaceLeaf(activeLeaf);
    return true;
  }

  jumpOrDeferDashTasks(retriesRemaining = DASH_TASKS_JUMP_RETRIES) {
    this.cancelPendingDashLocationRestore();
    this.cancelPendingDashTasksJump();

    if (this.jumpToActiveDashTasks()) {
      return true;
    }

    if (retriesRemaining <= 0) {
      new Notice("No active markdown editor");
      return false;
    }

    this.pendingDashTasksDeferred = deferToNextFrame(() => {
      this.pendingDashTasksDeferred = null;
      this.jumpOrDeferDashTasks(retriesRemaining - 1);
    });

    return false;
  }

  jumpToActiveDashTasks() {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor ||
      typeof view.editor.getValue !== "function"
    ) {
      return false;
    }

    const targetLine = getDashTasksHeaderLine(
      String(view.editor.getValue()).split(/\r?\n/),
    );
    if (targetLine === null) {
      new Notice(`No "${DASH_TASKS_HEADER}" header in ${DASH_FILE_PATH}`);
      return true;
    }

    if (!setEditorCursor(view.editor, { line: targetLine, ch: 0 })) {
      return false;
    }

    if (scrollEditorLineToTop(view.editor, targetLine)) {
      this.scheduleDashTasksScrollAssert(targetLine);
    }
    return true;
  }

  scheduleDashTasksScrollAssert(targetLine, options = {}) {
    return scheduleDashTasksScrollAssert(this, targetLine, options);
  }

  cancelPendingDashTasksJump() {
    cancelDeferred(this.pendingDashTasksDeferred);
    this.pendingDashTasksDeferred = null;
    cancelDeferred(this.pendingDashTasksScrollDeferred);
    this.pendingDashTasksScrollDeferred = null;
  }

  getRememberedDashLocation() {
    const remembered = normalizeDashLocation(this.dashLocation);
    if (remembered) {
      return remembered;
    }

    const sourcePosition = normalizePosition(
      this.filePositions.get(DASH_FILE_PATH),
    );
    return sourcePosition ? { sourcePosition } : null;
  }

  refreshDashScrollCaptureTarget(view = this.getActiveMarkdownView()) {
    const isDashView =
      view &&
      view.file &&
      view.file.path === DASH_FILE_PATH &&
      view.editor;
    const editorView = isDashView ? getEditorViewFromEditor(view.editor) : null;
    const scrollDOM = editorView && editorView.scrollDOM;

    if (scrollDOM && scrollDOM === this.activeDashScrollDOM) {
      return true;
    }

    this.clearDashScrollCaptureTarget();
    if (!scrollDOM || typeof scrollDOM.addEventListener !== "function") {
      return false;
    }

    const handler = () => this.scheduleDashLocationCapture();
    try {
      scrollDOM.addEventListener("scroll", handler, { passive: true });
    } catch (error) {
      scrollDOM.addEventListener("scroll", handler);
    }

    this.activeDashScrollDOM = scrollDOM;
    this.activeDashScrollHandler = handler;
    return true;
  }

  clearDashScrollCaptureTarget() {
    if (
      this.activeDashScrollDOM &&
      this.activeDashScrollHandler &&
      typeof this.activeDashScrollDOM.removeEventListener === "function"
    ) {
      try {
        this.activeDashScrollDOM.removeEventListener(
          "scroll",
          this.activeDashScrollHandler,
        );
      } catch (error) {
        // Best-effort cleanup only.
      }
    }

    this.activeDashScrollDOM = null;
    this.activeDashScrollHandler = null;
  }

  scheduleDashLocationCapture() {
    if (this.isRestoringDashLocation) {
      return false;
    }

    this.cancelPendingDashLocationCapture();
    this.pendingDashLocationCaptureDeferred = deferToNextFrame(() => {
      this.pendingDashLocationCaptureDeferred = null;
      if (!this.isRestoringDashLocation) {
        this.captureActiveDashLocation();
      }
    });

    return true;
  }

  cancelPendingDashLocationCapture() {
    cancelDeferred(this.pendingDashLocationCaptureDeferred);
    this.pendingDashLocationCaptureDeferred = null;
  }

  captureActiveDashLocation() {
    const view = this.getActiveMarkdownView();
    return this.captureDashLocationFromView(view);
  }

  captureDashLocationFromView(view, options = {}) {
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      return false;
    }

    if (this.isRestoringDashLocation && !options.force) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const sourcePosition =
      normalizePosition(options.position) ||
      (typeof view.editor.getCursor === "function"
        ? normalizePosition(view.editor.getCursor())
        : null) ||
      normalizePosition(this.filePositions.get(DASH_FILE_PATH));
    const location = {};

    if (sourcePosition) {
      location.sourcePosition = sourcePosition;
      this.filePositions.set(DASH_FILE_PATH, sourcePosition);
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

      const renderedTasksQuery = getDashboardRenderedTasksQuerySnapshot(
        editorView,
        scrollDOM,
      );
      if (renderedTasksQuery) {
        location.renderedTasksQuery = renderedTasksQuery;
      }
    }

    const normalized = normalizeDashLocation(location);
    if (!normalized) {
      return false;
    }

    this.dashLocation = normalized;
    return true;
  }

  restoreOrDeferDashLocation(
    location,
    retriesRemaining = DASH_LOCATION_RESTORE_RETRIES,
  ) {
    const normalized = normalizeDashLocation(location);
    if (!normalized) {
      return false;
    }

    this.cancelPendingDashTasksJump();
    this.cancelPendingDashLocationRestore();
    this.isRestoringDashLocation = true;
    const restoreState = {
      cursorApplied: false,
      rawScrollApplied: false,
      anchoredWriteSucceeded: false,
      assertFramesRemaining: 0,
      initialActivePath:
        this.app.workspace &&
        typeof this.app.workspace.getActiveFile === "function"
          ? this.app.workspace.getActiveFile()?.path || null
          : null,
      activeFileChanged: false,
    };
    return this.restoreOrDeferDashLocationInternal(
      normalized,
      retriesRemaining,
      restoreState,
    );
  }

  restoreOrDeferDashLocationInternal(
    location,
    retriesRemaining,
    restoreState,
  ) {
    const currentActivePath =
      this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()?.path || null
        : null;
    if (currentActivePath !== restoreState.initialActivePath) {
      restoreState.activeFileChanged = true;
    }
    const isAssertFrame =
      restoreState.anchoredWriteSucceeded &&
      restoreState.assertFramesRemaining > 0;
    if (isAssertFrame) {
      restoreState.assertFramesRemaining -= 1;
    }

    const result = this.restoreActiveDashLocation(location, restoreState);
    const needsInitialRetry =
      !restoreState.anchoredWriteSucceeded &&
      (!result.active || result.needsQueryRetry);
    const shouldRetry = needsInitialRetry && retriesRemaining > 0;
    const shouldAssert =
      restoreState.anchoredWriteSucceeded &&
      restoreState.assertFramesRemaining > 0;

    if (!shouldRetry && !shouldAssert) {
      this.isRestoringDashLocation = false;
      if (
        !result.active &&
        !restoreState.anchoredWriteSucceeded &&
        retriesRemaining <= 0 &&
        !restoreState.activeFileChanged
      ) {
        new Notice("No active markdown editor");
      }
      return result.applied;
    }

    this.pendingDashLocationRestoreDeferred = deferToNextFrame(() => {
      this.pendingDashLocationRestoreDeferred = null;
      this.restoreOrDeferDashLocationInternal(
        location,
        shouldRetry ? retriesRemaining - 1 : retriesRemaining,
        restoreState,
      );
    });

    return result.applied;
  }

  restoreActiveDashLocation(location, restoreState) {
    const normalized = normalizeDashLocation(location);
    const state = restoreState || {
      cursorApplied: false,
      rawScrollApplied: false,
      anchoredWriteSucceeded: false,
      assertFramesRemaining: 0,
    };
    const result = {
      active: false,
      applied: false,
      needsQueryRetry: false,
    };
    if (!normalized) {
      return result;
    }

    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      result.needsQueryRetry = !!normalized.renderedTasksQuery;
      return result;
    }

    result.active = true;
    this.refreshDashScrollCaptureTarget(view);

    if (normalized.sourcePosition && !state.cursorApplied) {
      const target = clampPositionToEditor(view.editor, normalized.sourcePosition);
      if (target && setEditorCursorWithoutScroll(view.editor, target)) {
        state.cursorApplied = true;
        this.filePositions.set(DASH_FILE_PATH, target);
        result.applied = true;
      }
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    if (!scrollDOM) {
      result.needsQueryRetry =
        !!normalized.renderedTasksQuery ||
        (!state.rawScrollApplied &&
          (normalized.scrollTop !== undefined ||
            normalized.scrollLeft !== undefined));
      return result;
    }

    if (
      !state.rawScrollApplied &&
      !state.anchoredWriteSucceeded &&
      (normalized.scrollTop !== undefined ||
        normalized.scrollLeft !== undefined)
    ) {
      const targetScrollTop =
        normalized.scrollTop !== undefined
          ? normalized.scrollTop
          : finiteNumberOrNull(scrollDOM.scrollTop) || 0;
      const targetScrollLeft =
        normalized.scrollLeft !== undefined
          ? normalized.scrollLeft
          : finiteNumberOrNull(scrollDOM.scrollLeft) || 0;
      if (setScrollDOMPosition(scrollDOM, targetScrollTop, targetScrollLeft)) {
        state.rawScrollApplied = true;
        result.applied = true;
      }
    }

    if (normalized.renderedTasksQuery) {
      const queryScrollTop = getDashboardQueryRestoreScrollTop(
        normalized.renderedTasksQuery,
        editorView,
        scrollDOM,
      );
      if (queryScrollTop === null) {
        result.needsQueryRetry = true;
        if (normalized.renderedTasksQuery.sourceLine !== null) {
          scrollEditorLineToTop(
            view.editor,
            normalized.renderedTasksQuery.sourceLine,
          );
        }
      } else if (
        setScrollDOMPosition(
          scrollDOM,
          queryScrollTop,
          normalized.scrollLeft !== undefined
            ? normalized.scrollLeft
            : finiteNumberOrNull(scrollDOM.scrollLeft) || 0,
        )
      ) {
        if (!state.anchoredWriteSucceeded) {
          state.anchoredWriteSucceeded = true;
          state.assertFramesRemaining = DASH_LOCATION_RESTORE_ASSERT_FRAMES;
        }
        result.applied = true;
        result.needsQueryRetry = false;
      }
    }

    this.dashLocation = normalized;
    return result;
  }

  cancelPendingDashLocationRestore() {
    cancelDeferred(this.pendingDashLocationRestoreDeferred);
    this.pendingDashLocationRestoreDeferred = null;
    this.isRestoringDashLocation = false;
  }

  async openParentNote() {
    await this.openFrontmatterLink(
      "parent",
      "No parent link found",
      "Parent note not found",
    );
  }

  async openTemplateNote() {
    await this.openFrontmatterLink(
      "template",
      "No template link found",
      "Template note not found",
    );
  }

  async openAltFileNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const fieldName = this.getFrontmatterLink(frontmatter, "alt_file")
      ? "alt_file"
      : "type";
    const notFoundMessage =
      fieldName === "alt_file"
        ? "Alt file note not found"
        : "Type note not found";

    await this.openFrontmatterLink(
      fieldName,
      "No alt_file or type link found",
      notFoundMessage,
    );
  }

  async openChildNotePicker() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const children = this.collectChildNotes(file);
    if (children.length === 0) {
      new Notice("No child notes found");
      return;
    }

    if (children.length === 1) {
      await this.openChildNote(children[0]);
      return;
    }

    new ChildNotePickerModal(this.app, this, children, file).open();
  }
}
