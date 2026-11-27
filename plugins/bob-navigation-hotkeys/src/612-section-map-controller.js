// Section Map controller: pane-local singleton card, Ctrl tracker, activity
// dismissal, doc-keyed heading cache, per-frame paint coalescing, and the
// coalesced aria-live sentence. Mixes onto the plugin; owns no jump logic.
const SECTION_MAP_MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "Hyper",
  "OS",
  "CapsLock",
]);

// Same clock as KeyboardEvent.timeStamp, so the capture keydown handler can
// tell the dispatch that just ran a section command from a later press.
function sectionMapNow() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch (_error) {
    // Fall through to the wall clock.
  }
  return Date.now();
}

function sectionMapIsMobile() {
  try {
    return Boolean(typeof Platform !== "undefined" && Platform && Platform.isMobile);
  } catch (_error) {
    return false;
  }
}

function sectionMapIsMarkdownView(view) {
  if (!view) return false;
  try {
    if (typeof MarkdownView === "function" && view instanceof MarkdownView) return true;
  } catch (_error) {
    // Test stubs may throw on instanceof.
  }
  if (typeof view.getViewType === "function") {
    try {
      if (view.getViewType() === "markdown") return true;
    } catch (_error) {
      // Fall through to shape checks.
    }
  }
  return Boolean(view.editor && (view.contentEl || view.containerEl));
}

function sectionMapEventWindows(plugin) {
  const windows = [];
  const seen = new Set();
  const add = (win) => {
    if (!win || typeof win.addEventListener !== "function" || seen.has(win)) return;
    seen.add(win);
    windows.push(win);
  };
  add(typeof window !== "undefined" ? window : null);
  try {
    const workspace = plugin && plugin.app && plugin.app.workspace;
    const root = workspace && workspace.containerEl;
    add(root && root.ownerDocument && root.ownerDocument.defaultView);
    if (workspace && typeof workspace.iterateAllLeaves === "function") {
      workspace.iterateAllLeaves((leaf) => {
        const el =
          (leaf && leaf.view && (leaf.view.contentEl || leaf.view.containerEl)) ||
          (leaf && leaf.containerEl);
        add(el && el.ownerDocument && el.ownerDocument.defaultView);
      });
    }
  } catch (_error) {
    // Pop-out discovery is best-effort; the main window still tracks Ctrl.
  }
  if (plugin && plugin.sectionMapView) {
    const el = plugin.sectionMapView.contentEl || plugin.sectionMapView.containerEl;
    add(el && el.ownerDocument && el.ownerDocument.defaultView);
  }
  return windows;
}

function sectionMapRectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  try {
    const rect = element.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
    const width = Number.isFinite(rect.width)
      ? rect.width
      : Number(rect.right) - Number(rect.left);
    const height = Number.isFinite(rect.height)
      ? rect.height
      : Number(rect.bottom) - Number(rect.top);
    return {
      left: Number(rect.left),
      top: Number(rect.top),
      width,
      height,
      right: Number.isFinite(rect.right) ? Number(rect.right) : Number(rect.left) + width,
      bottom: Number.isFinite(rect.bottom) ? Number(rect.bottom) : Number(rect.top) + height,
    };
  } catch (_error) {
    return null;
  }
}

function sectionMapNoticeRects(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  try {
    const nodes = doc.querySelectorAll(".notice");
    const rects = [];
    for (const node of nodes) {
      const rect = sectionMapRectOf(node);
      if (rect) rects.push(rect);
    }
    return rects;
  } catch (_error) {
    return [];
  }
}

function sectionMapSelectionLine(update, editor) {
  try {
    const state = (update && update.state) || (update && update.view && update.view.state);
    const selection = state && state.selection;
    const main = selection && (selection.main || (selection.ranges && selection.ranges[0]));
    const head = main && Number.isFinite(main.head) ? main.head : null;
    if (head != null && state && state.doc) {
      if (typeof state.doc.lineAt === "function") {
        const line = state.doc.lineAt(head);
        if (line && Number.isFinite(line.number)) return line.number - 1;
      }
      if (typeof state.doc.line === "function" && Number.isFinite(state.doc.lines)) {
        // Best-effort: tests that only expose `line(n)` still report a head line
        // through the editor cursor below.
      }
    }
  } catch (_error) {
    // Fall through to the editor cursor.
  }
  const cursor = getEditorCursor(editor);
  return cursor && Number.isFinite(cursor.line) ? cursor.line : null;
}

function sectionMapHostPrefersReducedMotion(view) {
  try {
    const doc =
      (view && view.contentEl && view.contentEl.ownerDocument) ||
      (view && view.containerEl && view.containerEl.ownerDocument) ||
      (typeof document !== "undefined" ? document : null);
    const win = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
    const media = win && typeof win.matchMedia === "function"
      ? win.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    return Boolean(media && media.matches);
  } catch (_error) {
    return false;
  }
}

class BobNavigationHotkeysSectionMapControllerMixin {
  ensureSectionMapController() {
    if (this.sectionMapControllerReady) return this.sectionMapLifecycle;
    this.sectionMapControllerReady = true;
    this.sectionMapHeadingCache = new WeakMap();
    this.sectionMapBoundWindows = new Set();
    this.sectionMapWindowCleanups = [];
    this.sectionMapCtrlDown = false;
    this.sectionMapKeyGeneration = 0;
    this.sectionMapLastCommandStamp = 0;
    const plugin = this;
    this.sectionMapLifecycle = createSectionMapLifecycle({
      onChange(snapshot) {
        plugin.handleSectionMapLifecycleChange(snapshot);
      },
    });
    this.bindSectionMapWindows();
    this.registerSectionMapWorkspaceEvents();
    this.registerSectionMapResizeWatcher();
    if (typeof this.register === "function") {
      this.register(() => this.teardownSectionMapController());
    }
    return this.sectionMapLifecycle;
  }

  registerSectionMapController() {
    this.ensureSectionMapController();
  }

  teardownSectionMapController() {
    if (this.sectionMapLifecycle) {
      try {
        this.sectionMapLifecycle.destroy();
      } catch (_error) {
        // Unload still releases the rest of the controller.
      }
    }
    this.clearSectionMapPaint();
    this.clearSectionMapAria();
    this.disconnectSectionMapResize();
    this.destroySectionMapHost();
    for (const cleanup of this.sectionMapWindowCleanups || []) {
      try {
        cleanup();
      } catch (_error) {
        // Window already gone.
      }
    }
    this.sectionMapWindowCleanups = [];
    this.sectionMapBoundWindows = new Set();
    this.sectionMapControllerReady = false;
    this.sectionMapLifecycle = null;
    this.sectionMapView = null;
    this.sectionMapEditor = null;
    this.sectionMapLeaf = null;
    this.sectionMapPlacement = null;
    this.sectionMapCtrlDown = false;
  }

  resolveSectionMapView(editor, ctx) {
    if (sectionMapIsMarkdownView(ctx) && ctx.editor === editor) return ctx;
    const active =
      typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : null;
    if (active && active.editor === editor) return active;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.iterateAllLeaves === "function") {
        let found = null;
        workspace.iterateAllLeaves((leaf) => {
          if (found) return;
          const view = leaf && leaf.view;
          if (sectionMapIsMarkdownView(view) && view.editor === editor) found = view;
        });
        if (found) return found;
      }
    } catch (_error) {
      // Host resolution is best-effort; a missing view skips the map.
    }
    return null;
  }

  getSectionMapHeadingEntries(editor, lines) {
    const sourceLines = Array.isArray(lines)
      ? lines
      : String(editor && typeof editor.getValue === "function" ? editor.getValue() : "").split(/\r?\n/);
    const editorView = getEditorViewFromEditor(editor);
    const doc = editorView && editorView.state && editorView.state.doc;
    if (doc && this.sectionMapHeadingCache) {
      const cached = this.sectionMapHeadingCache.get(doc);
      if (cached) return cached;
      const entries = getSectionHeadingEntries(sourceLines);
      try {
        this.sectionMapHeadingCache.set(doc, entries);
      } catch (_error) {
        // WeakMap keys must be objects; generic editors just rescan.
      }
      return entries;
    }
    return getSectionHeadingEntries(sourceLines);
  }

  armSectionMapSelection(editor, line) {
    this.ensureSectionMapController();
    this.sectionMapEditor = editor;
    this.sectionMapAnchorLine = Number.isFinite(line) ? line : null;
  }

  showSectionMapAfterJump(editor, ctx, details = {}) {
    this.sectionMapLastCommandStamp = sectionMapNow();
    if (sectionMapIsMobile()) return false;
    const view = this.resolveSectionMapView(editor, ctx);
    if (!view) return false;
    this.ensureSectionMapController();
    this.sectionMapView = view;
    this.sectionMapEditor = editor;
    this.sectionMapLeaf = view.leaf || (this.app && this.app.workspace && this.app.workspace.activeLeaf) || null;
    this.sectionMapFromLine = details.fromLine;
    this.sectionMapAnchorLine =
      details.cursorLine != null ? details.cursorLine : this.sectionMapAnchorLine;
    this.sectionMapDirection = details.direction || 0;
    this.sectionMapWrapped = Boolean(details.wrapped);
    this.sectionMapSource = "jump";
    this.sectionMapEntries = details.entries || null;
    this.sectionMapLifecycle.showJump({ ctrlDown: this.sectionMapCtrlDown });
    this.bindSectionMapWindows();
    this.scheduleSectionMapPaint();
    return true;
  }

  showSectionMapPeek(editor, ctx, details = {}) {
    this.sectionMapLastCommandStamp = sectionMapNow();
    if (sectionMapIsMobile()) return false;
    const view = this.resolveSectionMapView(editor, ctx);
    if (!view) return false;
    this.ensureSectionMapController();
    this.sectionMapView = view;
    this.sectionMapEditor = editor;
    this.sectionMapLeaf = view.leaf || (this.app && this.app.workspace && this.app.workspace.activeLeaf) || null;
    this.sectionMapFromLine = null;
    this.sectionMapAnchorLine =
      details.cursorLine != null ? details.cursorLine : this.sectionMapAnchorLine;
    this.sectionMapDirection = 0;
    this.sectionMapWrapped = false;
    this.sectionMapSource = "peek";
    this.sectionMapEntries = details.entries || null;
    this.sectionMapLifecycle.showPeek();
    this.bindSectionMapWindows();
    this.scheduleSectionMapPaint();
    return true;
  }

  handleSectionMapLifecycleChange(snapshot) {
    if (!snapshot) return;
    if (snapshot.state === "hidden") {
      this.clearSectionMapAria();
      this.clearSectionMapPaint();
      if (this.sectionMapHostApi && typeof this.sectionMapHostApi.setLeaving === "function") {
        this.sectionMapHostApi.setLeaving(null);
      }
      if (this.sectionMapHostApi && typeof this.sectionMapHostApi.hide === "function") {
        this.sectionMapHostApi.hide();
      }
      this.sectionMapPlacement = null;
      return;
    }
    if (snapshot.state === "fading") {
      if (this.sectionMapHostApi && typeof this.sectionMapHostApi.setLeaving === "function") {
        this.sectionMapHostApi.setLeaving(
          snapshot.fadeKind === "dismiss" ? "dismiss" : "fade",
        );
      }
      return;
    }
    if (this.sectionMapHostApi && typeof this.sectionMapHostApi.setLeaving === "function") {
      this.sectionMapHostApi.setLeaving(null);
    }
    this.scheduleSectionMapPaint();
  }

  scheduleSectionMapPaint() {
    if (this.sectionMapPaintScheduled) return;
    const run = () => {
      this.sectionMapPaintScheduled = false;
      this.sectionMapPaintFrame = null;
      try {
        this.paintSectionMapNow();
      } catch (_error) {
        // Jump first, map second: a paint failure never becomes a toast.
      }
    };
    this.sectionMapPaintScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      this.sectionMapPaintFrame = requestAnimationFrame(run);
      return;
    }
    run();
  }

  clearSectionMapPaint() {
    this.sectionMapPaintScheduled = false;
    if (this.sectionMapPaintFrame != null && typeof cancelAnimationFrame === "function") {
      try {
        cancelAnimationFrame(this.sectionMapPaintFrame);
      } catch (_error) {
        // Frame already flushed.
      }
    }
    this.sectionMapPaintFrame = null;
  }

  paintSectionMapNow() {
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible() || lifecycle.getState() === "fading") return;
    if (sectionMapIsMobile()) return;
    const view = this.sectionMapView;
    const editor = this.sectionMapEditor;
    if (!view || !editor) return;
    const hostApi = this.ensureSectionMapHost(view, editor);
    if (!hostApi) return;
    const lines = String(typeof editor.getValue === "function" ? editor.getValue() : "").split(/\r?\n/);
    const entries = this.sectionMapEntries || this.getSectionMapHeadingEntries(editor, lines);
    if (!entries.length) {
      hostApi.hide();
      return;
    }
    if (!this.sectionMapPlacement) {
      this.sectionMapPlacement = this.computeLiveSectionMapPlacement(view, editor);
    }
    const placement = this.sectionMapPlacement;
    const model = buildSectionMapModel(lines, {
      headings: entries,
      cursorLine: this.sectionMapAnchorLine,
      fromLine: this.sectionMapFromLine,
      direction: this.sectionMapDirection,
      wrapped: this.sectionMapWrapped,
      maxRows: placement && placement.maxRows,
    });
    hostApi.render(model, placement, {
      reducedMotion: sectionMapHostPrefersReducedMotion(view),
    });
    this.scheduleSectionMapAria(model && model.ariaSentence);
  }

  scheduleSectionMapAria(sentence) {
    this.clearSectionMapAria();
    const text = sentence == null ? "" : String(sentence);
    const apply = () => {
      this.sectionMapAriaTimer = null;
      if (!this.sectionMapHostApi || typeof this.sectionMapHostApi.setLiveText !== "function") return;
      try {
        this.sectionMapHostApi.setLiveText(text);
      } catch (_error) {
        // Live region updates never block a jump.
      }
    };
    if (typeof setTimeout !== "function") {
      apply();
      return;
    }
    this.sectionMapAriaTimer = setTimeout(apply, SECTION_MAP_ARIA_SETTLE_MS);
  }

  clearSectionMapAria() {
    if (this.sectionMapAriaTimer != null) {
      try {
        clearTimeout(this.sectionMapAriaTimer);
      } catch (_error) {
        // Timer already gone.
      }
    }
    this.sectionMapAriaTimer = null;
  }

  ensureSectionMapHost(view, editor) {
    const mount = view && (view.contentEl || view.containerEl);
    if (!mount) return null;
    if (this.sectionMapHostApi && this.sectionMapMount === mount) return this.sectionMapHostApi;
    this.destroySectionMapHost();
    const doc =
      mount.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    // Mount at the document top level, not inside the pane: placement rects
    // are viewport-relative, and position:fixed only matches them when no
    // ancestor creates a containing block for fixed descendants. Obsidian's
    // .workspace does (CSS containment), which shifted an in-pane host right
    // by the ribbon width and clipped the card. Using the view's own
    // ownerDocument keeps pop-out windows working.
    const topMount =
      doc && doc.body && typeof doc.body.appendChild === "function" ? doc.body : mount;
    this.sectionMapMount = mount;
    this.sectionMapHostApi = createSectionMapHost(doc, { mount: topMount });
    this.sectionMapPlacement = null;
    this.observeSectionMapResize(view, editor);
    return this.sectionMapHostApi;
  }

  destroySectionMapHost() {
    this.disconnectSectionMapResize();
    if (this.sectionMapHostApi && typeof this.sectionMapHostApi.destroy === "function") {
      try {
        this.sectionMapHostApi.destroy();
      } catch (_error) {
        // Host already detached.
      }
    }
    this.sectionMapHostApi = null;
    this.sectionMapMount = null;
  }

  computeLiveSectionMapPlacement(view, editor) {
    const hostEl = view && (view.contentEl || view.containerEl);
    const editorView = getEditorViewFromEditor(editor);
    const scrollerEl =
      (editorView && editorView.scrollDOM) ||
      (hostEl && typeof hostEl.querySelector === "function"
        ? hostEl.querySelector(".cm-scroller")
        : null);
    const textEl =
      (editorView && editorView.contentDOM) ||
      (hostEl && typeof hostEl.querySelector === "function"
        ? hostEl.querySelector(".cm-content")
        : null);
    const doc = hostEl && hostEl.ownerDocument;
    return computeSectionMapPlacement({
      host: sectionMapRectOf(hostEl),
      scroller: sectionMapRectOf(scrollerEl) || sectionMapRectOf(hostEl),
      textColumn: sectionMapRectOf(textEl),
      notices: sectionMapNoticeRects(doc),
    });
  }

  observeSectionMapResize(view, editor) {
    this.disconnectSectionMapResize();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      this.sectionMapPlacement = null;
      if (this.sectionMapLifecycle && this.sectionMapLifecycle.isVisible()) {
        this.scheduleSectionMapPaint();
      }
    });
    const mount = view && (view.contentEl || view.containerEl);
    const editorView = getEditorViewFromEditor(editor);
    const scroller = editorView && editorView.scrollDOM;
    try {
      if (mount) observer.observe(mount);
    } catch (_error) {
      // Some test hosts are not Elements.
    }
    try {
      if (scroller && scroller !== mount) observer.observe(scroller);
    } catch (_error) {
      // Scroll DOM is optional.
    }
    this.sectionMapResizeObserver = observer;
  }

  disconnectSectionMapResize() {
    if (this.sectionMapResizeObserver && typeof this.sectionMapResizeObserver.disconnect === "function") {
      try {
        this.sectionMapResizeObserver.disconnect();
      } catch (_error) {
        // Observer already dead.
      }
    }
    this.sectionMapResizeObserver = null;
  }

  registerSectionMapResizeWatcher() {
    // ResizeObserver is attached when the host mounts; this hook exists so
    // onload has a single controller entry point.
  }

  bindSectionMapWindows() {
    const plugin = this;
    for (const win of sectionMapEventWindows(this)) {
      if (this.sectionMapBoundWindows.has(win)) continue;
      this.sectionMapBoundWindows.add(win);
      const onKeyDown = (event) => plugin.handleSectionMapCaptureKeydown(event);
      const onKeyUp = (event) => plugin.handleSectionMapCaptureKeyup(event);
      const onBlur = () => plugin.handleSectionMapWindowBlur();
      const onPointer = (event) => plugin.handleSectionMapPointerDown(event);
      try {
        win.addEventListener("keydown", onKeyDown, true);
        win.addEventListener("keyup", onKeyUp, true);
        win.addEventListener("blur", onBlur);
        win.addEventListener("pointerdown", onPointer, true);
      } catch (_error) {
        continue;
      }
      this.sectionMapWindowCleanups.push(() => {
        try { win.removeEventListener("keydown", onKeyDown, true); } catch (_error) { /* unload */ }
        try { win.removeEventListener("keyup", onKeyUp, true); } catch (_error) { /* unload */ }
        try { win.removeEventListener("blur", onBlur); } catch (_error) { /* unload */ }
        try { win.removeEventListener("pointerdown", onPointer, true); } catch (_error) { /* unload */ }
      });
    }
  }

  registerSectionMapWorkspaceEvents() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.on !== "function") return;
    const register = (name, handler) => {
      try {
        const ref = workspace.on(name, handler);
        if (typeof this.registerEvent === "function") this.registerEvent(ref);
      } catch (_error) {
        // Workspace stubs in tests may not implement EventRef.
      }
    };
    register("active-leaf-change", (leaf) => this.handleSectionMapLeafChange(leaf));
    register("file-open", (file) => this.handleSectionMapFileOpen(file));
    register("layout-change", () => this.handleSectionMapLayoutChange());
    register("window-open", (_workspaceWindow, win) => {
      if (win) this.bindSectionMapWindows();
    });
  }

  handleSectionMapCaptureKeydown(event) {
    if (!event) return;
    const key = event.key;
    if (key === "Control" || event.ctrlKey) this.sectionMapCtrlDown = true;
    if (key === "Control") return;
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible()) return;
    if (SECTION_MAP_MODIFIER_KEYS.has(key)) return;
    const eventStamp = typeof event.timeStamp === "number" ? event.timeStamp : null;
    const commandStamp = this.sectionMapLastCommandStamp || 0;
    if (eventStamp != null && commandStamp > 0 && commandStamp >= eventStamp - 1) {
      // This dispatch just ran a section command: Obsidian's window-capture
      // hotkey listener runs before ours, so the map the command showed is
      // already visible and no later jump can bump the generation. Never
      // dismiss on it. Reconcile Holding when Ctrl is still down: the tracker
      // above only learns the truth after the command already chose Lingering.
      if (event.ctrlKey === true && this.sectionMapSource === "jump" && lifecycle.getState() === "lingering") {
        lifecycle.showJump({ ctrlDown: true });
      }
      return;
    }
    const generation = lifecycle.getGeneration();
    const finish = () => {
      if (!this.sectionMapLifecycle || this.sectionMapLifecycle.getGeneration() !== generation) {
        return;
      }
      this.sectionMapLifecycle.dismiss();
    };
    if (typeof queueMicrotask === "function") queueMicrotask(finish);
    else setTimeout(finish, 0);
  }

  handleSectionMapCaptureKeyup(event) {
    if (!event) return;
    if (event.key === "Control") {
      this.sectionMapCtrlDown = false;
      if (this.sectionMapLifecycle) this.sectionMapLifecycle.ctrlReleased();
    }
  }

  handleSectionMapWindowBlur() {
    this.sectionMapCtrlDown = false;
    if (this.sectionMapLifecycle) this.sectionMapLifecycle.windowBlur();
  }

  handleSectionMapPointerDown(_event) {
    if (this.sectionMapLifecycle && this.sectionMapLifecycle.isVisible()) {
      this.sectionMapLifecycle.dismiss();
    }
  }

  handleSectionMapEditorUpdate(update) {
    if (!update) return;
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible()) return;
    const editorView = getEditorViewFromEditor(this.sectionMapEditor);
    if (update.view && editorView && update.view !== editorView) return;
    if (update.docChanged) {
      lifecycle.dismiss();
      return;
    }
    if (update.selectionSet) {
      const line = sectionMapSelectionLine(update, this.sectionMapEditor);
      if (line != null && line !== this.sectionMapAnchorLine) lifecycle.dismiss();
    }
  }

  handleSectionMapLeafChange(leaf) {
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible()) return;
    const current = this.sectionMapLeaf;
    if (!current) {
      lifecycle.dismiss();
      return;
    }
    if (leaf && leaf !== current) lifecycle.dismiss();
  }

  handleSectionMapFileOpen(_file) {
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible()) return;
    const view = this.sectionMapView;
    const active =
      typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : null;
    if (view && active && active !== view && active.leaf === view.leaf) {
      lifecycle.dismiss();
      return;
    }
    if (view && view.leaf && this.app && this.app.workspace && this.app.workspace.activeLeaf === view.leaf) {
      lifecycle.dismiss();
    }
  }

  handleSectionMapLayoutChange() {
    const lifecycle = this.sectionMapLifecycle;
    if (!lifecycle || !lifecycle.isVisible()) return;
    const mount = this.sectionMapMount;
    if (!mount) {
      lifecycle.dismiss();
      return;
    }
    const doc = mount.ownerDocument;
    const rooted =
      mount.isConnected === true ||
      (doc && doc.contains && typeof doc.contains === "function" && doc.contains(mount)) ||
      (mount.parent || mount.parentNode);
    if (!rooted) lifecycle.dismiss();
  }
}
