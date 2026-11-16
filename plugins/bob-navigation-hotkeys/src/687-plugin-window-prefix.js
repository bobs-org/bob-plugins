// Ctrl+W window-prefix state machine. Arms a catch-all keymap Scope, paints
// the two-tier hint, and dispatches through the layout planner/executor.
const WINDOW_PREFIX_OVERLAY_SELECTORS = Object.freeze({
  inModal: ".modal",
  inPrompt: ".prompt",
  inMenu: ".menu",
  inSuggestion: ".suggestion-container, .suggestion",
  inHoverPopover: ".hover-popover, .popover.hover-popover",
  inCommandMode: ".bob-command-mode, [data-bob-command-mode], .bob-cm-sheet",
  inBobCard: [
    ".bob-copy-card",
    ".bob-copy-card-modal",
    ".bob-task-card",
    ".bob-decay-card",
    ".bob-key-card-modal",
  ].join(", "),
});
const WINDOW_PREFIX_HINT_HOST_SELECTOR = "[data-bob-wp='host'], .bob-wp-host, .bob-wp-card";

function windowPrefixConsumeEvent(event) {
  if (!event) return;
  try { if (typeof event.preventDefault === "function") event.preventDefault(); } catch (_error) { /* best effort */ }
  try { if (typeof event.stopPropagation === "function") event.stopPropagation(); } catch (_error) { /* best effort */ }
  try {
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  } catch (_error) {
    // Some synthetic events only expose preventDefault.
  }
}

function windowPrefixMarkHandled(set, event) {
  if (set && event && typeof set.add === "function") {
    try { set.add(event); } catch (_error) { /* WeakSet rejects non-objects */ }
  }
}

function windowPrefixAlreadyHandled(set, event) {
  return Boolean(set && event && typeof set.has === "function" && set.has(event));
}

function windowPrefixScopeConstructor(app) {
  if (typeof Scope === "function") return Scope;
  try {
    const ctor = app && app.scope && app.scope.constructor;
    if (typeof ctor === "function") return ctor;
  } catch (_error) {
    // Test stubs and older Obsidian builds may omit app.scope.
  }
  return null;
}

function windowPrefixIsMacPlatform() {
  try {
    if (Platform && Platform.isMacOS === true) return true;
  } catch (_error) {
    // Platform is optional so existing test stubs keep loading.
  }
  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    return Boolean(nav && /Mac|iPhone|iPad/.test(String(nav.platform || nav.userAgent || "")));
  } catch (_error) {
    return false;
  }
}

function windowPrefixClosest(target, selector) {
  if (!target || typeof target.closest !== "function" || !selector) return null;
  try { return target.closest(selector); } catch (_error) { return null; }
}

function windowPrefixQuery(root, selector) {
  if (!root || typeof root.querySelector !== "function" || !selector) return null;
  try { return root.querySelector(selector); } catch (_error) { return null; }
}

function windowPrefixEventElement(target) {
  if (!target) return null;
  try {
    if (target.nodeType === 3) return target.parentElement || null;
  } catch (_error) {
    return target;
  }
  return target;
}

function windowPrefixNormalizeVimMode(mode, vimState) {
  if (mode === "visual-line" || mode === "visual-block") return "visual";
  if ((mode == null || mode === "") && vimState) return "normal";
  return mode == null ? null : mode;
}

function windowPrefixTargetIsEditable(target) {
  const el = windowPrefixEventElement(target);
  if (!el) return null;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable === true) return true;
  if (windowPrefixClosest(el, "input, textarea, select, [contenteditable='true'], [contenteditable='']")) {
    return true;
  }
  return false;
}

function windowPrefixOverlayFlags(plugin, target) {
  const doc = (target && target.ownerDocument) ||
    (plugin && plugin.windowPrefixDocument) ||
    (typeof document !== "undefined" ? document : null);
  const flags = {
    inModal: false,
    inPrompt: false,
    inMenu: false,
    inSuggestion: false,
    inHoverPopover: false,
    inCommandMode: false,
    inBobCard: false,
  };
  for (const [name, selector] of Object.entries(WINDOW_PREFIX_OVERLAY_SELECTORS)) {
    flags[name] = Boolean(
      windowPrefixClosest(target, selector) || windowPrefixQuery(doc, selector),
    );
  }
  if (windowPrefixClosest(target, WINDOW_PREFIX_HINT_HOST_SELECTOR)) {
    flags.inModal = false;
    flags.inBobCard = false;
  }
  if (plugin) {
    if (plugin.activeFreshnessDecayCard || plugin.activeImageZoomModal ||
        plugin.activeTaskMoveDestinationPicker || plugin.activeBulletPropertyPicker ||
        plugin.activeSuccessorPicker || plugin.activeParentNotePicker ||
        plugin.activeNotebookCreateModal || plugin.activeCopyCard) {
      flags.inBobCard = true;
    }
  }
  return flags;
}

function windowPrefixPrefersReducedMotion(doc) {
  try {
    const view = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
    const media = view && typeof view.matchMedia === "function"
      ? view.matchMedia("(prefers-reduced-motion: reduce)")
      : (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null);
    return Boolean(media && media.matches);
  } catch (_error) {
    return false;
  }
}

function windowPrefixBlockedMessage(plan, key) {
  if (!plan) return `${key ?? "key"} isn't a window key`;
  if (plan.action === "unmapped") {
    return `${plan.key ?? key ?? "key"} isn't a window key`;
  }
  if (plan.preview) return plan.preview;
  if (plan.reason === "at-left-edge") return "Already the leftmost split";
  if (plan.reason === "at-right-edge") return "Already the rightmost split";
  if (plan.reason === "only-tab-in-layout") return "only tab · v splits";
  if (plan.reason === "layout-api-changed") return "layout API changed";
  if (plan.reason === "layout-changed") return "Layout changed — try again";
  return plan.reason || "unavailable";
}

function windowPrefixBumpSide(plan) {
  if (!plan) return null;
  if (plan.reason === "at-left-edge" || plan.key === "h" || plan.key === "H") return "left";
  if (plan.reason === "at-right-edge" || plan.key === "l" || plan.key === "L") return "right";
  return null;
}

function windowPrefixMoveReceiptText(plan, result, snapshot) {
  if (!plan || (plan.action !== "join" && plan.action !== "create-split")) return null;
  const layout = typeof normalizeWindowPrefixSnapshot === "function"
    ? normalizeWindowPrefixSnapshot(snapshot)
    : snapshot;
  let title = plan.movedLeafId || plan.sourceLeafId || "tab";
  try {
    if (layout && typeof windowPrefixLeafLabel === "function") {
      title = windowPrefixLeafLabel(layout, plan.movedLeafId || plan.sourceLeafId);
    }
  } catch (_error) {
    // Fall through to the id.
  }
  if (plan.action === "create-split") {
    return `Moved “${title}” → new ${plan.direction} split`;
  }
  const destination = String(plan.preview || "").replace(/^join\s+/i, "") || "split";
  const closed = result && result.sourceCollapsed
    ? (plan.direction === "right" ? " · left split closed" : " · right split closed")
    : "";
  return `Moved “${title}” → ${destination}${closed}`;
}

function windowPrefixActiveSplitRect(plugin, snapshot) {
  const layout = typeof normalizeWindowPrefixSnapshot === "function"
    ? normalizeWindowPrefixSnapshot(snapshot)
    : snapshot;
  if (!layout) return null;
  const split = layout.splits.find((item) => item.id === layout.activeSplitId);
  return split && split.rect ? { ...split.rect } : null;
}

function windowPrefixAreaRect(plugin, snapshot) {
  const layout = typeof normalizeWindowPrefixSnapshot === "function"
    ? normalizeWindowPrefixSnapshot(snapshot)
    : snapshot;
  const root = plugin && plugin.app && plugin.app.workspace && plugin.app.workspace.rootSplit;
  try {
    const rect = root && root.containerEl && root.containerEl.getBoundingClientRect &&
      root.containerEl.getBoundingClientRect();
    if (rect) {
      return {
        left: Number(rect.left),
        top: Number(rect.top),
        right: Number(rect.right),
        bottom: Number(rect.bottom),
        width: Number(rect.width),
        height: Number(rect.height),
      };
    }
  } catch (_error) {
    // Fall through to the snapshot bounds.
  }
  if (!layout || !layout.splits.length) return null;
  const left = Math.min(...layout.splits.map((split) => split.rect.left));
  const top = Math.min(...layout.splits.map((split) => split.rect.top));
  const right = Math.max(...layout.splits.map((split) => split.rect.right));
  const bottom = Math.max(...layout.splits.map((split) => split.rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

class BobNavigationHotkeysWindowPrefixMixin {
  registerWindowPrefixInputListeners() {
    this.windowPrefixState = "idle";
    this.windowPrefixQueue = Promise.resolve();
    this.windowPrefixHandledEvents = new WeakSet();
    this.windowPrefixScope = null;
    this.windowPrefixHintHost = this.windowPrefixHintHost || null;
    this.windowPrefixSourceLeaf = null;
    this.windowPrefixArmedSnapshot = null;
    this.windowPrefixArmedTabCatalog = null;
    this.windowPrefixArmGeneration = 0;
    this.windowPrefixSelfCaused = false;
    this.windowPrefixTimerIds = Object.create(null);

    const keydownHandler = (event) => this.handleWindowPrefixCaptureKeydown(event);
    for (const target of this.windowPrefixEventTargets()) {
      target.addEventListener("keydown", keydownHandler, true);
      if (typeof this.register === "function") {
        this.register(() => {
          try { target.removeEventListener("keydown", keydownHandler, true); } catch (_error) { /* unload */ }
        });
      }
    }
    this.registerWindowPrefixAuxiliaryListeners();
    this.registerWindowPrefixWorkspaceEvents();
    if (typeof this.register === "function") {
      this.register(() => this.teardownWindowPrefix());
    }
  }

  windowPrefixEventTargets() {
    const win = this.windowPrefixWindow || (typeof window !== "undefined" ? window : null);
    const doc = this.windowPrefixDocument || (typeof document !== "undefined" ? document : null);
    const targets = [];
    if (win && typeof win.addEventListener === "function") targets.push(win);
    if (doc && doc !== win && typeof doc.addEventListener === "function") targets.push(doc);
    return targets;
  }

  registerWindowPrefixAuxiliaryListeners() {
    const win = this.windowPrefixWindow || (typeof window !== "undefined" ? window : null);
    const doc = this.windowPrefixDocument || (typeof document !== "undefined" ? document : null);
    const onBlur = () => this.handleWindowPrefixCancelEvent("blur");
    const onVisibility = () => {
      if (doc && doc.hidden) this.handleWindowPrefixCancelEvent("visibilitychange");
    };
    const onMouseDown = (event) => this.handleWindowPrefixMouseDown(event);
    const onFocusIn = (event) => this.handleWindowPrefixFocusIn(event);
    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("blur", onBlur);
      if (typeof this.register === "function") {
        this.register(() => { try { win.removeEventListener("blur", onBlur); } catch (_error) { /* unload */ } });
      }
    }
    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("visibilitychange", onVisibility);
      doc.addEventListener("mousedown", onMouseDown, true);
      doc.addEventListener("focusin", onFocusIn, true);
      if (typeof this.register === "function") {
        this.register(() => {
          try { doc.removeEventListener("visibilitychange", onVisibility); } catch (_error) { /* unload */ }
          try { doc.removeEventListener("mousedown", onMouseDown, true); } catch (_error) { /* unload */ }
          try { doc.removeEventListener("focusin", onFocusIn, true); } catch (_error) { /* unload */ }
        });
      }
    }
  }

  registerWindowPrefixWorkspaceEvents() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.on !== "function") return;
    const onLayout = () => this.handleWindowPrefixWorkspaceEvent("layout-change");
    const onLeaf = () => this.handleWindowPrefixWorkspaceEvent("active-leaf-change");
    const layoutRef = workspace.on("layout-change", onLayout);
    const leafRef = workspace.on("active-leaf-change", onLeaf);
    if (typeof this.registerEvent === "function") {
      this.registerEvent(layoutRef);
      this.registerEvent(leafRef);
      return;
    }
    if (typeof this.register === "function") {
      this.register(() => {
        try { if (typeof workspace.off === "function") workspace.off("layout-change", onLayout); } catch (_error) { /* unload */ }
        try { if (typeof workspace.off === "function") workspace.off("active-leaf-change", onLeaf); } catch (_error) { /* unload */ }
      });
    }
  }

  teardownWindowPrefix() {
    this.disarmWindowPrefix({ silent: true });
    try { if (this.windowPrefixHintHost && typeof this.windowPrefixHintHost.destroy === "function") {
      this.windowPrefixHintHost.destroy();
    } } catch (_error) { /* painter never throws in production; tests may omit destroy */ }
    this.windowPrefixHintHost = null;
  }

  windowPrefixIsArmed() {
    return this.windowPrefixState === "armed" || this.windowPrefixState === "carded" ||
      this.windowPrefixState === "running";
  }

  getWindowPrefixDebugState() {
    const host = this.windowPrefixHintHost;
    const keymap = this.app && this.app.keymap;
    let scopeCount = null;
    try {
      if (Array.isArray(keymap && keymap.scopes)) scopeCount = keymap.scopes.length;
    } catch (_error) {
      scopeCount = null;
    }
    return {
      state: this.windowPrefixState || "idle",
      armed: this.windowPrefixIsArmed(),
      hasScope: Boolean(this.windowPrefixScope),
      scopeCount,
      hasHost: Boolean(host),
      lastVerdict: this.windowPrefixLastVerdict || null,
      lastDispatch: this.windowPrefixLastDispatch || null,
    };
  }

  scheduleWindowPrefixTimeout(callback, delay, key) {
    const setFn = this.windowPrefixSetTimeout ||
      (typeof setTimeout === "function" ? setTimeout : null);
    const clearFn = this.windowPrefixClearTimeout ||
      (typeof clearTimeout === "function" ? clearTimeout : null);
    if (!this.windowPrefixTimerIds) this.windowPrefixTimerIds = Object.create(null);
    if (key && this.windowPrefixTimerIds[key] != null && typeof clearFn === "function") {
      clearFn(this.windowPrefixTimerIds[key]);
      this.windowPrefixTimerIds[key] = null;
    }
    if (typeof setFn !== "function") return null;
    const id = setFn(() => {
      if (key) this.windowPrefixTimerIds[key] = null;
      callback();
    }, delay);
    if (key) this.windowPrefixTimerIds[key] = id;
    return id;
  }

  clearWindowPrefixTimer(key) {
    const clearFn = this.windowPrefixClearTimeout ||
      (typeof clearTimeout === "function" ? clearTimeout : null);
    if (!this.windowPrefixTimerIds) return;
    if (key) {
      if (this.windowPrefixTimerIds[key] != null && typeof clearFn === "function") {
        clearFn(this.windowPrefixTimerIds[key]);
      }
      this.windowPrefixTimerIds[key] = null;
      return;
    }
    for (const name of Object.keys(this.windowPrefixTimerIds)) {
      if (this.windowPrefixTimerIds[name] != null && typeof clearFn === "function") {
        clearFn(this.windowPrefixTimerIds[name]);
      }
      this.windowPrefixTimerIds[name] = null;
    }
  }

  enqueueWindowPrefix(task) {
    const run = () => Promise.resolve().then(task);
    this.windowPrefixQueue = (this.windowPrefixQueue || Promise.resolve())
      .then(run, run)
      .catch((error) => {
        try { console.warn("window prefix", error); } catch (_error) { /* tests */ }
      });
    return this.windowPrefixQueue;
  }

  handleWindowPrefixCaptureKeydown(event) {
    if (!event) return false;
    if (windowPrefixAlreadyHandled(this.windowPrefixHandledEvents, event)) return false;
    if (this.windowPrefixIsArmed()) {
      return this.handleWindowPrefixSuffix(event);
    }
    return this.tryArmWindowPrefix(event);
  }

  handleWindowPrefixScopeKey(event) {
    if (!event) return false;
    if (windowPrefixAlreadyHandled(this.windowPrefixHandledEvents, event)) return false;
    if (!this.windowPrefixIsArmed()) return true;
    return this.handleWindowPrefixSuffix(event);
  }

  tryArmWindowPrefix(event) {
    const context = this.collectWindowPrefixArmingContext(event);
    const verdict = getWindowPrefixArmingVerdict(context);
    this.windowPrefixLastVerdict = {
      allowed: Boolean(verdict && verdict.allowed),
      reason: verdict && verdict.reason,
      vimMode: context && context.vimMode,
      isMarkdownEditor: context && context.isMarkdownEditor,
      isEditable: context && context.isEditable,
      defaultPrevented: context && context.defaultPrevented,
    };
    if (!verdict || verdict.allowed !== true) {
      if (typeof this.scheduleWindowTabNumbersFromPreventedCtrlW === "function") {
        this.scheduleWindowTabNumbersFromPreventedCtrlW(verdict);
      }
      return false;
    }
    windowPrefixMarkHandled(this.windowPrefixHandledEvents, event);
    windowPrefixConsumeEvent(event);
    this.armWindowPrefix();
    return false;
  }

  collectWindowPrefixArmingContext(event) {
    const workspace = this.app && this.app.workspace;
    const activeLeaf = workspace && workspace.activeLeaf;
    const rootSplit = workspace && workspace.rootSplit;
    const mainDoc = (workspace && workspace.containerEl && workspace.containerEl.ownerDocument) ||
      this.windowPrefixDocument ||
      (typeof document !== "undefined" ? document : null);
    const eventView = event && (event.view ||
      (event.target && event.target.ownerDocument && event.target.ownerDocument.defaultView));
    const mainView = mainDoc && mainDoc.defaultView;
    const isMainWindow = !mainView || !eventView || eventView === mainView;
    const eventTarget = windowPrefixEventElement(event && event.target);
    const overlays = windowPrefixOverlayFlags(this, eventTarget);
    const markdownView = typeof this.getActiveMarkdownView === "function"
      ? this.getActiveMarkdownView()
      : null;
    const editorEvent = eventTarget && event && event.target !== eventTarget
      ? { target: eventTarget, view: event.view }
      : event;
    const inEditor = Boolean(
      markdownView &&
      typeof this.isEditorEventTarget === "function" &&
      this.isEditorEventTarget(editorEvent, markdownView),
    );
    let vimMode = null;
    let vimKeyBuffer = [];
    let vimOperatorPending = false;
    let vimCountPending = false;
    let pendingVimInput = false;
    if (inEditor && markdownView) {
      const cm = typeof this.resolveVimCodeMirror === "function"
        ? this.resolveVimCodeMirror(markdownView.editor, markdownView)
        : null;
      vimMode = typeof this.getCurrentVimMode === "function" ? this.getCurrentVimMode(cm) : null;
      const vimState = cm && cm.state && cm.state.vim;
      vimMode = windowPrefixNormalizeVimMode(vimMode, vimState);
      const inputState = vimState && vimState.inputState;
      vimKeyBuffer = (inputState && inputState.keyBuffer) || [];
      vimOperatorPending = Boolean(
        (vimState && vimState.operator) ||
        (inputState && (inputState.operator || inputState.operatorArgs)),
      );
      const pending = typeof getPendingVimRepeat === "function"
        ? getPendingVimRepeat(cm)
        : { explicit: false };
      vimCountPending = Boolean(pending && pending.explicit);
      pendingVimInput = vimOperatorPending || vimCountPending ||
        !windowPrefixVimBufferIsEmpty(vimKeyBuffer);
    }
    const editable = windowPrefixTargetIsEditable(eventTarget);
    return {
      key: event && event.key,
      code: event && event.code,
      ctrlKey: Boolean(event && event.ctrlKey),
      metaKey: Boolean(event && event.metaKey),
      altKey: Boolean(event && event.altKey),
      shiftKey: Boolean(event && event.shiftKey),
      repeat: Boolean(event && event.repeat),
      isComposing: Boolean(event && event.isComposing),
      keyCode: event && event.keyCode,
      defaultPrevented: Boolean(event && event.defaultPrevented),
      isMainWindow,
      activeLeafInRootSplit: windowPrefixIsInRoot(activeLeaf, rootSplit),
      ...overlays,
      isMarkdownEditor: inEditor,
      vimMode,
      vimOperatorPending,
      vimCountPending,
      pendingVimInput,
      vimKeyBuffer,
      isEditable: inEditor ? true : (editable == null ? undefined : editable),
    };
  }

  armWindowPrefix() {
    const workspace = this.app && this.app.workspace;
    this.windowPrefixSourceLeaf = workspace && workspace.activeLeaf;
    this.windowPrefixArmedSnapshot = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : null;
    this.windowPrefixState = "armed";
    if (typeof this.captureWindowPrefixArmedTabState === "function") {
      this.captureWindowPrefixArmedTabState();
    }
    this.pushWindowPrefixScope();
    this.showWindowPrefixArmedHint();
    this.showWindowPrefixCardSoon();
  }

  disarmWindowPrefix(options = {}) {
    const previous = this.windowPrefixState;
    this.windowPrefixState = "idle";
    this.windowPrefixSourceLeaf = null;
    this.windowPrefixArmedSnapshot = null;
    if (typeof this.releaseWindowPrefixArmedTabState === "function") {
      this.releaseWindowPrefixArmedTabState();
    }
    this.clearWindowPrefixTimer("card");
    this.clearWindowPrefixTimer("linger");
    this.popWindowPrefixScope();
    if (options.keepHint !== true) this.hideWindowPrefixHint();
    return previous;
  }

  pushWindowPrefixScope() {
    if (this.windowPrefixScope) return this.windowPrefixScope;
    const app = this.app;
    const keymap = app && app.keymap;
    const Ctor = windowPrefixScopeConstructor(app);
    if (!Ctor || !keymap || typeof keymap.pushScope !== "function") return null;
    let scope = null;
    try { scope = new Ctor(app && app.scope); } catch (_error) {
      try { scope = new Ctor(); } catch (_inner) { return null; }
    }
    if (!scope || typeof scope.register !== "function") return null;
    try {
      scope.register(null, null, (event) => this.handleWindowPrefixScopeKey(event));
    } catch (_error) {
      return null;
    }
    try { keymap.pushScope(scope); } catch (_error) { return null; }
    this.windowPrefixScope = scope;
    return scope;
  }

  popWindowPrefixScope() {
    const scope = this.windowPrefixScope;
    this.windowPrefixScope = null;
    if (!scope) return;
    const keymap = this.app && this.app.keymap;
    if (!keymap || typeof keymap.popScope !== "function") return;
    try { keymap.popScope(scope); } catch (_error) {
      // Spike finding 4(d): popScope of a non-top scope must not throw past here.
    }
  }

  handleWindowPrefixSuffix(event) {
    const resolved = normalizeWindowPrefixKeydown(event);
    if (!resolved || resolved.kind === "ignore") return true;
    windowPrefixMarkHandled(this.windowPrefixHandledEvents, event);
    if (resolved.kind === "pass-through") {
      this.disarmWindowPrefix();
      return true;
    }
    if (resolved.consume) windowPrefixConsumeEvent(event);
    if (resolved.kind === "cancel") {
      this.disarmWindowPrefix();
      return false;
    }
    if (this.windowPrefixState === "running") {
      const isReArmCtrlW = Boolean(event && event.ctrlKey) &&
        resolved && resolved.kind === "mapped" && resolved.key === "w";
      if (isReArmCtrlW) {
        this.enqueueWindowPrefix(() => {
          const liveContext = this.collectWindowPrefixArmingContext(event);
          if (liveContext && windowPrefixAlreadyHandled(this.windowPrefixHandledEvents, event)) {
            liveContext.defaultPrevented = false;
          }
          const liveVerdict = typeof getWindowPrefixArmingVerdict === "function"
            ? getWindowPrefixArmingVerdict(liveContext)
            : null;
          this.windowPrefixLastVerdict = {
            allowed: Boolean(liveVerdict && liveVerdict.allowed),
            reason: liveVerdict && liveVerdict.reason,
            vimMode: liveContext && liveContext.vimMode,
            isMarkdownEditor: liveContext && liveContext.isMarkdownEditor,
            isEditable: liveContext && liveContext.isEditable,
            defaultPrevented: liveContext && liveContext.defaultPrevented,
          };
          if (liveVerdict && liveVerdict.allowed === true) {
            this.armWindowPrefix();
          }
        });
        return false;
      }
      this.enqueueWindowPrefix(() => {
        if (!this.windowPrefixIsArmed() && this.windowPrefixState === "idle") {
          return this.tryArmWindowPrefix(event);
        }
        return this.dispatchWindowPrefixResolved(resolved);
      });
      return false;
    }
    this.dispatchWindowPrefixResolved(resolved);
    return false;
  }

  dispatchWindowPrefixResolved(resolved) {
    this.windowPrefixLastDispatch = {
      kind: resolved && resolved.kind,
      key: resolved && resolved.key,
    };
    if (resolved.kind === "unmapped") {
      this.presentWindowPrefixUnmapped(resolved.key);
      return false;
    }
    if (resolved.kind !== "mapped") return false;
    return this.runWindowPrefixMappedKey(resolved.key);
  }

  runWindowPrefixMappedKey(key) {
    const snapshot = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : this.windowPrefixArmedSnapshot;
    const armedCatalog = this.windowPrefixArmedTabCatalog;
    const generation = this.windowPrefixArmGeneration;
    const plan = planWindowPrefixKey(snapshot, key, armedCatalog ? { armedCatalog } : {});
    this.windowPrefixLastDispatch = {
      ...(this.windowPrefixLastDispatch || {}),
      key,
      action: plan && plan.action,
      available: plan && plan.available,
      reason: plan && plan.reason,
    };
    if (!plan || plan.ok !== true || plan.available !== true ||
        plan.action === "noop" || plan.action === "unmapped" || plan.action === "unavailable") {
      if (typeof this.handleWindowPrefixUnavailablePlan === "function" &&
          this.handleWindowPrefixUnavailablePlan(plan, key)) {
        return false;
      }
      this.presentWindowPrefixBlocked(plan, key);
      return false;
    }
    if (plan.action === "cancel") {
      this.disarmWindowPrefix();
      return false;
    }
    const executeOptions = typeof this.windowPrefixMappedExecuteOptions === "function"
      ? this.windowPrefixMappedExecuteOptions(generation)
      : {
        activeLeafId: this.windowPrefixArmedSnapshot && this.windowPrefixArmedSnapshot.activeLeafId,
        sourceSplitId: this.windowPrefixArmedSnapshot && this.windowPrefixArmedSnapshot.activeSplitId,
        armedCatalog,
        isCurrent: () => this.windowPrefixArmGeneration === generation,
      };
    this.windowPrefixState = "running";
    this.enqueueWindowPrefix(async () => {
      this.windowPrefixSelfCaused = true;
      let result;
      try {
        result = await this.executeWindowPrefixPlan(plan, executeOptions);
      } catch (error) {
        this.disarmWindowPrefix();
        throw error;
      } finally {
        this.windowPrefixSelfCaused = false;
      }
      this.windowPrefixLastDispatch = {
        ...(this.windowPrefixLastDispatch || {}),
        resultOk: Boolean(result && result.ok),
        resultReason: result && result.reason,
        resultAction: result && result.action,
        resultError: result && result.error || null,
        restored: result && result.restored,
        skipped: Boolean(result && result.skipped),
      };
      if (!result || result.ok !== true) {
        if (typeof this.handleWindowPrefixMappedFailure === "function" &&
            this.handleWindowPrefixMappedFailure(result, key)) {
          return;
        }
        if (result && result.reason === "layout-changed") {
          this.presentWindowPrefixBlocked({
            action: "noop",
            available: false,
            reason: "layout-changed",
            preview: "Layout changed — try again",
            key,
          }, key);
          this.disarmWindowPrefix({ keepHint: this.windowPrefixState === "carded" });
          this.scheduleWindowPrefixTimeout(() => this.hideWindowPrefixHint(), 900, "linger");
          return;
        }
        if (result && result.plan && result.plan.available !== true) {
          this.presentWindowPrefixBlocked(result.plan, key);
          this.windowPrefixState = this.windowPrefixHintHost ? "carded" : "armed";
          return;
        }
        this.disarmWindowPrefix();
        return;
      }
      if (result.skipped) {
        this.presentWindowPrefixBlocked(result.plan || plan, key);
        this.windowPrefixState = this.windowPrefixState === "running" ? "carded" : this.windowPrefixState;
        return;
      }
      await this.presentWindowPrefixSuccess(plan, result);
    });
    return false;
  }

  presentWindowPrefixBlocked(plan, key) {
    this.showWindowPrefixCardNow();
    const host = this.ensureWindowPrefixHintHost();
    const message = windowPrefixBlockedMessage(plan, key);
    const bump = windowPrefixBumpSide(plan);
    if (host) {
      if (typeof host.nudge === "function") host.nudge(plan && plan.key || key, message);
      if (bump && typeof host.bump === "function") host.bump(bump);
      if (typeof host.message === "function") host.message(message);
    }
    if (this.windowPrefixState === "running") this.windowPrefixState = "carded";
    else if (this.windowPrefixState === "armed") this.windowPrefixState = "carded";
  }

  presentWindowPrefixUnmapped(key) {
    this.showWindowPrefixCardNow();
    const host = this.ensureWindowPrefixHintHost();
    const message = `${key ?? "key"} isn't a window key`;
    if (host) {
      if (typeof host.message === "function") host.message(message);
      if (typeof host.nudge === "function") host.nudge(key, message);
    }
    if (this.windowPrefixState === "armed") this.windowPrefixState = "carded";
  }

  async presentWindowPrefixSuccess(plan, result) {
    if (typeof this.presentWindowPrefixJumpFeedback === "function") {
      this.presentWindowPrefixJumpFeedback(plan, result);
    }
    const after = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : null;
    const host = this.ensureWindowPrefixHintHost();
    const destRect = windowPrefixActiveSplitRect(this, after);
    const areaRect = windowPrefixAreaRect(this, after);
    const model = after && typeof buildWindowPrefixViewModel === "function"
      ? buildWindowPrefixViewModel(after)
      : null;
    if (host && typeof host.showArmed === "function") host.showArmed(model, destRect, areaRect);
    const receipt = windowPrefixMoveReceiptText(plan, result, this.windowPrefixArmedSnapshot);
    const linger = receipt ? 1600 : 220;
    if (receipt) {
      this.showWindowPrefixCardNow();
      if (host && typeof host.receipt === "function") host.receipt(receipt);
    }
    if (host && typeof host.pulse === "function") host.pulse(destRect);
    this.disarmWindowPrefix({ keepHint: true });
    this.scheduleWindowPrefixTimeout(() => this.hideWindowPrefixHint(), linger, "linger");
  }

  ensureWindowPrefixHintHost() {
    if (this.windowPrefixHintHost) return this.windowPrefixHintHost;
    const doc = (this.app && this.app.workspace && this.app.workspace.containerEl &&
      this.app.workspace.containerEl.ownerDocument) ||
      this.windowPrefixDocument ||
      (typeof document !== "undefined" ? document : null);
    if (!doc || typeof createWindowHintHost !== "function") return null;
    this.windowPrefixHintHost = createWindowHintHost(doc, {
      tabNumbers: true,
      setIcon: typeof setIcon === "function" ? setIcon : undefined,
      platform: windowPrefixIsMacPlatform() ? "mac" : "other",
      setTimeout: (callback, delay) => this.scheduleWindowPrefixTimeout(callback, delay),
      clearTimeout: (id) => {
        const clearFn = this.windowPrefixClearTimeout ||
          (typeof clearTimeout === "function" ? clearTimeout : null);
        if (typeof clearFn === "function") clearFn(id);
      },
    });
    return this.windowPrefixHintHost;
  }

  showWindowPrefixArmedHint() {
    const host = this.ensureWindowPrefixHintHost();
    const snapshot = this.windowPrefixArmedSnapshot ||
      (typeof this.snapshotWindowPrefixLayout === "function" ? this.snapshotWindowPrefixLayout() : null);
    const model = snapshot && typeof buildWindowPrefixViewModel === "function"
      ? buildWindowPrefixViewModel(snapshot)
      : null;
    const ring = windowPrefixActiveSplitRect(this, snapshot);
    const area = windowPrefixAreaRect(this, snapshot);
    if (host && typeof host.showArmed === "function") host.showArmed(model, ring, area);
  }

  showWindowPrefixCardSoon() {
    const delay = windowPrefixPrefersReducedMotion(
      this.windowPrefixDocument || (typeof document !== "undefined" ? document : null),
    ) ? 0 : WINDOW_PREFIX_HINT_DELAY_MS;
    this.scheduleWindowPrefixTimeout(() => {
      if (this.windowPrefixState === "armed") this.showWindowPrefixCardNow();
    }, delay, "card");
  }

  showWindowPrefixCardNow() {
    this.clearWindowPrefixTimer("card");
    const host = this.ensureWindowPrefixHintHost();
    const snapshot = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : this.windowPrefixArmedSnapshot;
    const model = snapshot && typeof buildWindowPrefixViewModel === "function"
      ? buildWindowPrefixViewModel(snapshot)
      : null;
    if (host && typeof host.showCard === "function") host.showCard(model);
    if (typeof this.lightWindowTabNumbers === "function") this.lightWindowTabNumbers();
    if (this.windowPrefixState === "armed") this.windowPrefixState = "carded";
  }

  hideWindowPrefixHint() {
    const host = this.windowPrefixHintHost;
    if (host && typeof host.hide === "function") host.hide();
    if (typeof this.unlightWindowTabNumbers === "function") this.unlightWindowTabNumbers();
  }

  handleWindowPrefixCancelEvent(_reason) {
    if (!this.windowPrefixIsArmed()) return;
    if (this.windowPrefixSelfCaused) return;
    this.disarmWindowPrefix();
  }

  handleWindowPrefixWorkspaceEvent(_kind) {
    if (!this.windowPrefixIsArmed()) return;
    if (this.windowPrefixSelfCaused) return;
    this.disarmWindowPrefix();
  }

  handleWindowPrefixMouseDown(event) {
    if (!this.windowPrefixIsArmed()) return;
    if (windowPrefixClosest(event && event.target, WINDOW_PREFIX_HINT_HOST_SELECTOR)) return;
    this.disarmWindowPrefix();
  }

  handleWindowPrefixFocusIn(event) {
    if (!this.windowPrefixIsArmed()) return;
    if (this.windowPrefixSelfCaused) return;
    const target = event && event.target;
    if (windowPrefixClosest(target, WINDOW_PREFIX_HINT_HOST_SELECTOR)) return;
    const overlays = windowPrefixOverlayFlags(this, target);
    if (overlays.inModal || overlays.inPrompt || overlays.inMenu || overlays.inSuggestion ||
        overlays.inHoverPopover || overlays.inCommandMode || overlays.inBobCard) {
      this.disarmWindowPrefix();
      return;
    }
    const workspace = this.app && this.app.workspace;
    const leaf = workspace && workspace.activeLeaf;
    const container = leaf && leaf.containerEl;
    if (container && target && typeof container.contains === "function" && container.contains(target)) {
      return;
    }
    if (windowPrefixTargetIsEditable(target)) {
      this.disarmWindowPrefix();
    }
  }
}
