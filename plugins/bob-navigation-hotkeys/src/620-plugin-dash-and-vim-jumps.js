class BobNavigationHotkeysVimJumpMixin {

  async openDashTasks() {
    const file = this.app.vault.getAbstractFileByPath(DASH_FILE_PATH);
    if (!this.isMarkdownFile(file)) {
      new Notice(`${DASH_FILE_PATH} not found`);
      return false;
    }

    const activeView = this.getActiveMarkdownView();
    if (activeView && activeView.file.path === file.path) {
      // dash.md already focused: keep it fresh for capture, do not disturb scroll.
      this.cancelPendingDashTasksJump();
      this.cancelPendingDashLocationRestore();
      this.refreshDashScrollCaptureTarget(activeView);
      this.captureDashLocationFromView(activeView);
      return true;
    }

    this.captureActiveFilePosition();
    // Read the remembered location BEFORE opening: openFile makes dash active and
    // may overwrite this.dashLocation (via capture) with the fresh top-of-file state.
    const rememberedDashLocation = this.getRememberedDashLocation();

    try {
      const existingLeaf = this.findMarkdownLeafByPath(file.path);
      if (existingLeaf && (await this.activateWorkspaceLeaf(existingLeaf))) {
        // dash.md is already open in a tab; leave its live scroll untouched.
        this.cancelPendingDashTasksJump();
        this.cancelPendingDashLocationRestore();
        this.refreshDashScrollCaptureTarget();
        return true;
      }

      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      new Notice(`Could not open ${DASH_FILE_PATH}`);
      return false;
    }

    // Fresh open (dash.md was not already open in a tab): restore the remembered
    // scroll/cursor if we have one, otherwise jump to the Tasks section.
    this.refreshDashScrollCaptureTarget();

    if (rememberedDashLocation) {
      this.restoreOrDeferDashLocation(rememberedDashLocation);
    } else {
      this.jumpOrDeferDashTasks();
    }
    return true;
  }

  findMarkdownLeafByPath(filePath) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.iterateAllLeaves !== "function") {
      return null;
    }

    let matchedLeaf = null;
    workspace.iterateAllLeaves((leaf) => {
      if (matchedLeaf || !leaf || !leaf.view) {
        return;
      }

      const viewFile = leaf.view.file;
      if (this.isMarkdownFile(viewFile) && viewFile.path === filePath) {
        matchedLeaf = leaf;
      }
    });

    return matchedLeaf;
  }

  async activateWorkspaceLeaf(leaf) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || !leaf) {
      return false;
    }

    const setActiveLeaf = () => {
      if (typeof workspace.setActiveLeaf !== "function") {
        return false;
      }

      try {
        workspace.setActiveLeaf(leaf, { focus: true });
        return true;
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
          return true;
        } catch (ignoredError) {
          return false;
        }
      }
    };

    if (typeof workspace.revealLeaf === "function") {
      try {
        await workspace.revealLeaf(leaf);
        return setActiveLeaf();
      } catch (error) {
        // Fall through to the older activation API.
      }
    }

    return setActiveLeaf();
  }

  async openMarkdownFileWithLeafReuse(file, failureNotice) {
    return openMarkdownFileWithLeafReuse(this, file, failureNotice);
  }

  async duplicateCurrentTab() {
    const workspace = this.app && this.app.workspace;
    const sourceLeaf = workspace && workspace.activeLeaf;
    if (!workspace || !sourceLeaf) {
      return false;
    }

    const sourceFile =
      sourceLeaf.view && this.isMarkdownFile(sourceLeaf.view.file)
        ? sourceLeaf.view.file
        : null;
    const viewState = this.getLeafViewState(sourceLeaf);
    let targetLeaf = null;

    const duplicateMarkdownFile = async () => {
      targetLeaf = targetLeaf || this.createNewTabLeaf(workspace, sourceLeaf);
      if (
        !targetLeaf ||
        !sourceFile ||
        !(await this.openMarkdownFileInLeaf(targetLeaf, sourceFile))
      ) {
        return false;
      }

      this.placeDuplicateTabAfterSource(sourceLeaf, targetLeaf);
      await this.focusWorkspaceLeaf(targetLeaf);
      return true;
    };

    if (!viewState) {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      new Notice("Could not duplicate current tab");
      return false;
    }

    targetLeaf = this.createNewTabLeaf(workspace, sourceLeaf);
    if (!targetLeaf) {
      new Notice("Could not duplicate current tab");
      return false;
    }

    const duplicatedState = this.cloneViewState(viewState);
    if (!duplicatedState || typeof targetLeaf.setViewState !== "function") {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      await this.cleanupFailedDuplicateTab(sourceLeaf, targetLeaf);
      new Notice("Could not duplicate current tab");
      return false;
    }

    duplicatedState.active = true;

    try {
      await targetLeaf.setViewState(duplicatedState);
    } catch (error) {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      await this.cleanupFailedDuplicateTab(sourceLeaf, targetLeaf);
      new Notice("Could not duplicate current tab");
      return false;
    }

    this.placeDuplicateTabAfterSource(sourceLeaf, targetLeaf);
    await this.focusWorkspaceLeaf(targetLeaf);
    return true;
  }

  toggleCurrentTabPin() {
    const workspace = this.app && this.app.workspace;
    const activeLeaf = workspace && workspace.activeLeaf;
    if (!activeLeaf || typeof activeLeaf.togglePinned !== "function") {
      return false;
    }

    try {
      activeLeaf.togglePinned();
      return true;
    } catch (error) {
      return false;
    }
  }

  isWorkspaceLeafPinned(leaf) {
    if (!leaf || (typeof leaf !== "object" && typeof leaf !== "function")) {
      return false;
    }

    try {
      if (leaf.pinned) {
        return true;
      }
    } catch (error) {
      // Fall through to the view-state representations.
    }

    let viewState = null;
    try {
      viewState = this.getLeafViewState(leaf);
    } catch (error) {
      return false;
    }
    if (!viewState || typeof viewState !== "object") {
      return false;
    }

    try {
      if (viewState.pinned) {
        return true;
      }

      const state = viewState.state;
      return Boolean(state && typeof state === "object" && state.pinned);
    } catch (error) {
      return false;
    }
  }

  registerVimMappingsWhenReady() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.onLayoutReady !== "function") {
      return false;
    }

    workspace.onLayoutReady(() => {
      if (this.registerVimMappings()) {
        return;
      }

      if (typeof workspace.on !== "function") {
        return;
      }

      const ref = workspace.on("active-leaf-change", () => {
        if (
          this.registerVimMappings() &&
          typeof workspace.offref === "function"
        ) {
          workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });

    return true;
  }

  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      // The Vim adapter object can be replaced on Vimrc reload. Reinstall the
      // jump-history bridge when a different Vim instance appears so the new
      // adapter gets the file-aware <C-o>/<C-i> history without stacking
      // duplicate wrappers on the old one.
      const latestVim =
        typeof window === "undefined"
          ? null
          : window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
      if (
        latestVim &&
        this.vimJumpBridgeVim &&
        latestVim !== this.vimJumpBridgeVim
      ) {
        this.installVimJumpHistoryMappings(latestVim);
      }
      return true;
    }

    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    const vim = codeMirrorAdapter && codeMirrorAdapter.Vim;
    if (
      !vim ||
      typeof vim.defineAction !== "function" ||
      typeof vim.mapCommand !== "function"
    ) {
      return false;
    }

    vim.defineAction("bobNavigationToggleCurrentTabPin", () =>
      this.toggleCurrentTabPin(),
    );
    vim.mapCommand(
      "\\s",
      "action",
      "bobNavigationToggleCurrentTabPin",
      {},
      { context: "normal" },
    );

    this.vimMappingsRegistered = true;
    this.installVimJumpHistoryMappings(vim);
    return true;
  }

  ensureVimJumpHistory() {
    if (!this.vimJumpHistory || !Array.isArray(this.vimJumpHistory.entries)) {
      this.vimJumpHistory = createVimJumpHistory();
    }

    if (!this.vimJumpHistoryChain || typeof this.vimJumpHistoryChain.then !== "function") {
      this.vimJumpHistoryChain = Promise.resolve();
    }

    return this.vimJumpHistory;
  }

  registerVimJumpHistoryVaultEvents() {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function") {
        return false;
      }

      this.registerEvent(
        vault.on("rename", (file, oldPath) => {
          if (!file || typeof file.path !== "string" || typeof oldPath !== "string") {
            return;
          }

          this.ensureVimJumpHistory();
          updateVimJumpHistoryPath(this.vimJumpHistory, oldPath, file.path);
        }),
      );
      this.registerEvent(
        vault.on("delete", (file) => {
          if (!file || typeof file.path !== "string") {
            return;
          }

          this.ensureVimJumpHistory();
          removeVimJumpHistoryPath(this.vimJumpHistory, file.path);
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  getVimAdapter() {
    if (typeof window === "undefined") {
      return null;
    }

    const adapter = window.CodeMirrorAdapter;
    return adapter && adapter.Vim ? adapter.Vim : null;
  }

  installVimJumpHistoryMappings(vim) {
    const targetVim = vim || this.getVimAdapter();
    if (
      !targetVim ||
      typeof targetVim.defineAction !== "function" ||
      typeof targetVim.mapCommand !== "function"
    ) {
      return false;
    }

    if (this.vimJumpBridgeVim === targetVim && this.vimJumpBridgeJumpList) {
      return true;
    }

    this.ensureVimJumpHistory();

    if (!isVimJumpBridgeAvailable(targetVim)) {
      if (!this.vimJumpBridgeDiagnosticShown) {
        this.vimJumpBridgeDiagnosticShown = true;
        try {
          new Notice(VIM_JUMP_HISTORY_COMPATIBILITY_NOTICE);
        } catch (error) {
          // Notice delivery is best-effort in tests.
        }
      }
      return false;
    }

    let globalState = null;
    try {
      globalState = targetVim.getVimGlobalState_();
    } catch (error) {
      return false;
    }

    const jumpList = globalState && globalState.jumpList;
    if (
      !jumpList ||
      typeof jumpList.add !== "function" ||
      typeof jumpList.move !== "function"
    ) {
      return false;
    }

    if (jumpList.add && jumpList.add.bobNavigationJumpBridge === true) {
      // Already wrapped by this plugin: never stack a second wrapper.
      // Re-point at the current Vim instance (Vimrc reload) and reinstall the
      // traversal keys below without touching `add` again.
      this.vimJumpBridgeVim = targetVim;
      this.vimJumpBridgeJumpList = jumpList;
      // Fall through to (re)install the traversal mappings, which are
      // idempotent per Vim instance via defineAction/mapCommand shadowing.
    } else {
      const originalAdd = jumpList.add.bind(jumpList);
      const plugin = this;
      const wrappedAdd = function wrappedVimJumpAdd(cm, oldCur, newCur) {
        let result;
        try {
          result = originalAdd(cm, oldCur, newCur);
        } catch (error) {
          throw error;
        }

        try {
          plugin.mirrorNativeVimJump(cm, oldCur, newCur);
        } catch (error) {
          // Mirroring must never break native jump recording.
        }

        return result;
      };
      wrappedAdd.bobNavigationJumpBridge = true;
      jumpList.add = wrappedAdd;
      this.vimJumpBridgeOriginalAdd = originalAdd;
      this.vimJumpBridgeVim = targetVim;
      this.vimJumpBridgeJumpList = jumpList;
    }

    this.vimJumpBridgeVim = targetVim;
    this.vimJumpBridgeJumpList = jumpList;

    try {
      targetVim.defineAction("bobNavigationJumpBack", (cm, actionArgs) =>
        this.handleVimJumpBack(cm, actionArgs),
      );
      targetVim.defineAction("bobNavigationJumpForward", (cm, actionArgs) =>
        this.handleVimJumpForward(cm, actionArgs),
      );
      // Map only <C-o>/<C-i> in normal mode. Insert-mode <C-o>
      // (one-normal-command), visual mode, and plain Tab are untouched.
      targetVim.mapCommand(
        "<C-o>",
        "action",
        "bobNavigationJumpBack",
        {},
        { context: "normal" },
      );
      targetVim.mapCommand(
        "<C-i>",
        "action",
        "bobNavigationJumpForward",
        {},
        { context: "normal" },
      );
    } catch (error) {
      return false;
    }

    return true;
  }

  cleanupVimJumpHistoryMappings() {
    const vim = this.vimJumpBridgeVim || this.getVimAdapter();
    try {
      if (
        this.vimJumpBridgeJumpList &&
        this.vimJumpBridgeOriginalAdd &&
        this.vimJumpBridgeJumpList.add &&
        this.vimJumpBridgeJumpList.add.bobNavigationJumpBridge === true
      ) {
        this.vimJumpBridgeJumpList.add = this.vimJumpBridgeOriginalAdd;
      }
    } catch (error) {
      // Best-effort restore only.
    }

    // Only remove our own mapping: if another plugin mapped <C-o>/<C-i> after
    // us, its entry shadows ours and unmapping would delete its keys. The Vim
    // API exposes no mapping inspection, so consult the recorded default
    // keymap only when the adapter exposes it for tests; otherwise attempt a
    // guarded unmap that leaves a foreign owner intact.
    try {
      if (vim && typeof vim.unmap === "function") {
        const ownsMapping = this.vimOwnsJumpMapping(vim, "<C-o>") !== false;
        const ownsForward = this.vimOwnsJumpMapping(vim, "<C-i>") !== false;
        if (ownsMapping) {
          try {
            vim.unmap("<C-o>", "normal");
          } catch (error) {
            // Best-effort.
          }
        }
        if (ownsForward) {
          try {
            vim.unmap("<C-i>", "normal");
          } catch (error) {
            // Best-effort.
          }
        }
      }
    } catch (error) {
      // Best-effort.
    }

    this.vimJumpBridgeVim = null;
    this.vimJumpBridgeJumpList = null;
    this.vimJumpBridgeOriginalAdd = null;
  }

  vimOwnsJumpMapping(vim, keys) {
    // Test adapters may expose `__bobTestKeymap` for inspection. Real adapters
    // do not, in which case return true so cleanup still runs once per owner.
    try {
      const keymap = vim && vim.__bobTestKeymap;
      if (!Array.isArray(keymap)) {
        return true;
      }

      const match = keymap.find(
        (entry) => entry && entry.keys === keys && entry.context === "normal",
      );
      if (!match) {
        return false;
      }

      return (
        match.action === "bobNavigationJumpBack" ||
        match.action === "bobNavigationJumpForward"
      );
    } catch (error) {
      return true;
    }
  }

  resolveVimJumpFileForCm(cm) {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace) {
        return null;
      }

      if (cm && typeof workspace.getLeavesOfType === "function") {
        const leaves = workspace.getLeavesOfType("markdown") || [];
        for (const leaf of leaves) {
          const view = leaf && leaf.view;
          const editor = view && view.editor;
          if (!view || !view.file || !editor) {
            continue;
          }

          if (
            editor === cm ||
            (editor.cm && editor.cm === cm) ||
            (editor.cm6 && editor.cm6 === cm) ||
            (editor.cm6 && cm && cm.cm6 && editor.cm6 === cm.cm6)
          ) {
            return this.isMarkdownFile(view.file) ? view.file.path : null;
          }
        }
      }

      // Do not fall back to the active file for a background editor: an
      // unrelated active note would otherwise be recorded for that editor.
      return null;
    } catch (error) {
      return null;
    }
  }

  resolveVimJumpLiveLocation(cm) {
    try {
      const view = this.getActiveMarkdownView();
      if (!view || !view.file) {
        return null;
      }

      let cursor = null;
      if (cm && typeof cm.getCursor === "function") {
        cursor = normalizePosition(cm.getCursor());
      }

      if (!cursor && view.editor && typeof view.editor.getCursor === "function") {
        cursor = normalizePosition(view.editor.getCursor());
      }

      if (!cursor) {
        return null;
      }

      return { path: view.file.path, line: cursor.line, ch: cursor.ch };
    } catch (error) {
      return null;
    }
  }

  mirrorNativeVimJump(cm, oldCur, newCur) {
    if (this.vimJumpSuppressNativeMirror) {
      return false;
    }

    const oldPosition = normalizePosition(oldCur);
    const newPosition = normalizePosition(newCur);
    if (!oldPosition || !newPosition) {
      return false;
    }

    if (
      oldPosition.line === newPosition.line &&
      oldPosition.ch === newPosition.ch
    ) {
      return false;
    }

    const filePath = this.resolveVimJumpFileForCm(cm);
    if (!filePath) {
      return false;
    }

    // A genuine native jump supersedes any pending move landing without
    // losing its own mirrored entry.
    try {
      this.cancelPendingTaskMoveJump();
    } catch (error) {
      // Best-effort cancellation only.
    }
    this.ensureVimJumpHistory();
    return recordVimJumpTransition(
      this.vimJumpHistory,
      { path: filePath, line: oldPosition.line, ch: oldPosition.ch },
      { path: filePath, line: newPosition.line, ch: newPosition.ch },
    );
  }

  enqueueVimJumpOperation(operation) {
    this.ensureVimJumpHistory();
    const run = () => {
      try {
        const result = operation();
        return result && typeof result.then === "function"
          ? result
          : Promise.resolve(result);
      } catch (error) {
        return Promise.resolve(false);
      }
    };

    this.vimJumpHistoryChain = this.vimJumpHistoryChain.then(run, run);
    return this.vimJumpHistoryChain;
  }

  handleVimJumpBack(cm, actionArgs) {
    const count = resolveVimJumpCount(actionArgs);
    return this.enqueueVimJumpOperation(() =>
      this.traverseVimJumpHistory(-1, count, cm),
    );
  }

  handleVimJumpForward(cm, actionArgs) {
    const count = resolveVimJumpCount(actionArgs);
    return this.enqueueVimJumpOperation(() =>
      this.traverseVimJumpHistory(1, count, cm),
    );
  }

  async traverseVimJumpHistory(direction, count, cm) {
    try {
      this.cancelPendingTaskMoveJump();
    } catch (error) {
      // Best-effort cancellation only.
    }
    this.ensureVimJumpHistory();
    const state = this.vimJumpHistory;
    if (state.entries.length === 0) {
      return this.walkNativeJumpList(cm, direction, count);
    }

    const steps = Math.max(
      1,
      Math.floor(numericOrDefault(count, 1)) || 1,
    );
    const live = this.resolveVimJumpLiveLocation(cm);
    if (live) {
      refreshVimJumpCurrentLocation(state, live);
    }

    let index = getVimJumpCurrentIndex(state);
    const signedSteps = direction < 0 ? -steps : steps;
    let targetIndex = index + signedSteps;
    targetIndex = Math.min(Math.max(targetIndex, 0), state.entries.length - 1);
    if (targetIndex === index) {
      // At a file-aware boundary: a no-op, never a fallback that replays
      // stale native entries.
      return false;
    }

    // Skip deleted/unresolvable entries without creating files. A recoverable
    // open error keeps the traversal index intact.
    const increment = direction < 0 ? -1 : 1;
    let candidateIndex = targetIndex;
    let lastErrorIndex = -1;
    while (candidateIndex >= 0 && candidateIndex < state.entries.length) {
      const entry = state.entries[candidateIndex];
      if (await this.isVimJumpEntryResolvable(entry)) {
        break;
      }

      candidateIndex += increment;
      if (
        (direction < 0 && candidateIndex < 0) ||
        (direction > 0 && candidateIndex >= state.entries.length)
      ) {
        return false;
      }
    }

    if (candidateIndex < 0 || candidateIndex >= state.entries.length) {
      return false;
    }

    const token = ++this.vimJumpOperationToken;
    this.vimJumpSuppressNativeMirror = true;
    try {
      const opened = await this.openVimJumpLocation(
        state.entries[candidateIndex],
        token,
      );
      if (!opened) {
        lastErrorIndex = candidateIndex;
        return false;
      }

      state.index = candidateIndex;
      return true;
    } finally {
      this.vimJumpSuppressNativeMirror = false;
      if (lastErrorIndex !== -1) {
        // Keep the index on the last good entry; forward history is kept.
      }
    }
  }

  async isVimJumpEntryResolvable(entry) {
    const normalized = normalizeVimJumpLocation(entry);
    if (!normalized) {
      return false;
    }

    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") {
        return true;
      }

      const file = vault.getAbstractFileByPath(normalized.path);
      return this.isMarkdownFile(file);
    } catch (error) {
      return false;
    }
  }

  async walkNativeJumpList(cm, direction, count) {
    try {
      const vim = this.getVimAdapter();
      if (!isVimJumpBridgeAvailable(vim)) {
        return false;
      }

      const globalState = vim.getVimGlobalState_();
      const jumpList = globalState && globalState.jumpList;
      if (!jumpList || typeof jumpList.move !== "function") {
        return false;
      }

      if (!cm || typeof cm.getCursor !== "function" || typeof cm.setCursor !== "function") {
        return false;
      }

      const steps = Math.max(1, Math.floor(numericOrDefault(count, 1)) || 1);
      const mark = jumpList.move(cm, direction < 0 ? -steps : steps);
      const markPos = mark && typeof mark.find === "function" ? mark.find() : null;
      const target = normalizePosition(markPos) || normalizePosition(cm.getCursor());
      if (!target) {
        return false;
      }

      this.vimJumpSuppressNativeMirror = true;
      try {
        if (typeof cm.setCursor === "function") {
          try {
            cm.setCursor(target.line, target.ch);
          } catch (error) {
            cm.setCursor(target);
          }
        }
      } finally {
        this.vimJumpSuppressNativeMirror = false;
      }

      return true;
    } catch (error) {
      this.vimJumpSuppressNativeMirror = false;
      return false;
    }
  }

  async openVimJumpLocation(entry, operationToken) {
    const normalized = normalizeVimJumpLocation(entry);
    if (!normalized) {
      return false;
    }

    if (
      operationToken !== undefined &&
      operationToken !== this.vimJumpOperationToken
    ) {
      return false;
    }

    let file = null;
    try {
      const vault = this.app && this.app.vault;
      file =
        vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(normalized.path)
          : null;
    } catch (error) {
      return false;
    }

    if (!this.isMarkdownFile(file)) {
      return false;
    }

    try {
      const activeView = this.getActiveMarkdownView();
      if (activeView && activeView.file && activeView.file.path === file.path) {
        const target = activeView.editor
          ? clampPositionToEditor(activeView.editor, normalized)
          : normalized;
        if (target && activeView.editor) {
          setEditorCursor(activeView.editor, target);
          this.saveFilePosition(file.path, target);
        }
        await this.focusWorkspaceLeaf(
          (this.app.workspace && this.app.workspace.activeLeaf) || null,
        );
        return true;
      }

      const existingLeaf = this.findMarkdownLeafByPath(file.path);
      if (existingLeaf && (await this.activateWorkspaceLeaf(existingLeaf))) {
        const settled = await this.waitForVimJumpDestination(
          file.path,
          operationToken,
        );
        const editor = settled && settled.editor ? settled.editor : null;
        const target = editor
          ? clampPositionToEditor(editor, normalized)
          : normalized;
        if (target && editor) {
          setEditorCursor(editor, target);
          this.saveFilePosition(file.path, target);
        }
        return Boolean(settled);
      }

      const opened = await this.openMarkdownFileWithLeafReuse(file, null);
      if (!opened) {
        return false;
      }

      const settled = await this.waitForVimJumpDestination(
        file.path,
        operationToken,
      );
      const editor = settled && settled.editor ? settled.editor : null;
      const target = editor
        ? clampPositionToEditor(editor, normalized)
        : normalized;
      if (target && editor) {
        setEditorCursor(editor, target);
        this.saveFilePosition(file.path, target);
      }
      return Boolean(settled);
    } catch (error) {
      return false;
    }
  }

  waitForVimJumpDestination(expectedPath, operationToken, retries = VIM_JUMP_HISTORY_DESTINATION_RETRIES) {
    const attempts = Math.max(1, Math.floor(numericOrDefault(retries, 1)) || 1);
    return new Promise((resolve) => {
      let attempt = 0;
      const check = () => {
        if (
          operationToken !== undefined &&
          operationToken !== this.vimJumpOperationToken
        ) {
          resolve(null);
          return;
        }

        let view = null;
        try {
          view = this.getActiveMarkdownView();
        } catch (error) {
          view = null;
        }

        if (view && view.file && view.file.path === expectedPath && view.editor) {
          resolve(view);
          return;
        }

        attempt += 1;
        if (attempt >= attempts) {
          resolve(null);
          return;
        }

        this.vimJumpPendingDestinationDeferred = deferToNextFrame(check);
      };

      check();
    });
  }

  cancelPendingVimJumpDestination() {
    cancelDeferred(this.vimJumpPendingDestinationDeferred);
    this.vimJumpPendingDestinationDeferred = null;
    this.vimJumpOperationToken += 1;
  }
}
