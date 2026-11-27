// Ref Card Vim navigation (bob-cli-qp ref-acceptance repair). Like the home
// card (249db), keep `gg`, `k`, and Up out of the hidden frontmatter, its
// separator, and an adopted title while a Ref Card owns those editor regions.
// The first visible body line comes from the shared homeCardVisibleBodyLine.
// Obsidian's Vim sees keydown before any plugin editor handler, so the guard
// listens in the capture phase, lets Vim finish its own motion (its pending
// key state stays consistent), and moves the cursor to the body start on the
// next frame when the motion landed above it.
const refNoteCardVimNavigationState = new WeakMap();

Object.assign(BobLedgerToolsRefNoteCardMixin.prototype, {
  // True only while this view's Ref Card owns the hidden frontmatter.
  refNoteCardNavigationOwned(view, path) {
    try {
      const scope = view?.dom;
      return Boolean(path && scope?.classList?.contains?.("bob-property-card-owns-frontmatter")
        && refNoteCardMountedInSurface(scope, path));
    } catch (_) {
      return false;
    }
  },

  refNoteCardNavigationDeferred(callback) {
    try {
      if (typeof this.refNoteCardNavigationDefer === "function") return this.refNoteCardNavigationDefer(callback);
      if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    } catch (_) {}
    return setTimeout(callback, 0);
  },

  // After the editor's own motion: land on the body start when the cursor
  // ended above it (`always` for gg, whose target is the top of the note).
  refNoteCardClampToBody(view, bodyFrom, always) {
    this.refNoteCardNavigationDeferred(() => {
      try {
        const head = view?.state?.selection?.main?.head;
        if (!Number.isInteger(head) || (!always && head >= bodyFrom)) return;
        if (head === bodyFrom) return;
        view.dispatch({ selection: { anchor: bodyFrom }, scrollIntoView: true });
      } catch (_) {}
    });
  },

  refNoteCardHandleVisibleBodyNavigation(event, view) {
    try {
      if (!event || event.isComposing || event.keyCode === 229) return false;
      const path = this.refNoteCardLivePath(view);
      if (!path || !this.refNoteCardNavigationOwned(view, path)) {
        if (view) refNoteCardVimNavigationState.delete(view);
        return false;
      }
      try {
        const title = propertyCardTitleStateField(view.state, propertyCardTitleFieldType);
        if (title?.revealed === true) return false;
      } catch (_) {}
      const bodyLine = typeof this.homeCardVisibleBodyLine === "function"
        ? this.homeCardVisibleBodyLine(view, path) : null;
      if (!bodyLine || !Number.isInteger(bodyLine.from)) return false;

      let vimEnabled = false;
      try { vimEnabled = this.app?.vault?.getConfig?.("vimMode") === true; } catch (_) {}
      const nav = refNoteCardVimNavigationState.get(view) || { normal: vimEnabled, lastG: 0 };
      if (event.key === "Escape" && vimEnabled) {
        nav.normal = true;
        nav.lastG = 0;
        refNoteCardVimNavigationState.set(view, nav);
        return false;
      }
      if (vimEnabled && ["i", "I", "a", "A", "o", "O", "s", "S", "c", "C", "R"].includes(event.key)) {
        nav.normal = false;
        nav.lastG = 0;
        refNoteCardVimNavigationState.set(view, nav);
        return false;
      }
      if (vimEnabled && nav.normal && event.key === "g" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        const secondG = nav.lastG && now - nav.lastG <= 1500;
        nav.lastG = secondG ? 0 : now;
        refNoteCardVimNavigationState.set(view, nav);
        if (!secondG) return false;
        this.refNoteCardClampToBody(view, bodyLine.from, true);
        return true;
      }
      nav.lastG = 0;
      refNoteCardVimNavigationState.set(view, nav);
      const movesUp = event.key === "ArrowUp" || (vimEnabled && nav.normal && event.key === "k");
      // Any upward motion from the body-start line lands in hidden content.
      const bodyEnd = Number.isInteger(bodyLine.to) ? bodyLine.to : bodyLine.from;
      if (!movesUp || view.state.selection?.main?.head > bodyEnd) return false;
      this.refNoteCardClampToBody(view, bodyLine.from, false);
      return true;
    } catch (_) {
      return false;
    }
  },

  refNoteCardVisibleBodyKeydown(event) {
    try {
      const root = event?.target?.closest?.(".cm-editor");
      const view = root && typeof EditorView?.findFromDOM === "function" ? EditorView.findFromDOM(root) : null;
      return view ? this.refNoteCardHandleVisibleBodyNavigation(event, view) : false;
    } catch (_) {
      return false;
    }
  },

  refNoteCardRegisterVisibleBodyNavigation() {
    try {
      if (this.refNoteCardVisibleBodyNavigationRegistered === true) return true;
      const doc = typeof activeDocument !== "undefined" && activeDocument ? activeDocument
        : typeof document !== "undefined" ? document : null;
      if (!doc || typeof EditorView?.findFromDOM !== "function" || typeof this.registerDomEvent !== "function") return false;
      const plugin = this;
      this.registerDomEvent(doc, "keydown", (event) => { plugin.refNoteCardVisibleBodyKeydown(event); }, { capture: true });
      this.refNoteCardVisibleBodyNavigationRegistered = true;
      return true;
    } catch (_) {
      return false;
    }
  },
});
