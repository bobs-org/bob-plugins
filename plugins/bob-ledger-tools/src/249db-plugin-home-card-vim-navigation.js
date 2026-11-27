// Keep navigation out of hidden frontmatter and the visually replaced title
// while the Area/Project card owns those editor regions.
const homeCardVimNavigationState = new WeakMap();

function homeCardFirstVisibleBodyLineIndex(doc, frontmatterEndLine, titleEndLine) {
  try {
    if (!doc || !Number.isInteger(doc.lines) || typeof doc.line !== "function") return -1;
    let lineIndex = Number.isInteger(frontmatterEndLine) && frontmatterEndLine >= 0
      ? frontmatterEndLine + 1
      : 0;
    if (Number.isInteger(titleEndLine) && titleEndLine >= 0) {
      lineIndex = Math.max(lineIndex, titleEndLine + 1);
    }
    while (lineIndex < doc.lines && !String(doc.line(lineIndex + 1)?.text || "").trim()) lineIndex += 1;
    return lineIndex < doc.lines ? lineIndex : -1;
  } catch (_) {
    return -1;
  }
}

Object.assign(BobLedgerToolsHomeCardMixin.prototype, {
  homeCardVisibleBodyLine(view, path) {
    try {
      const doc = view?.state?.doc;
      if (!doc || typeof doc.lineAt !== "function") return null;
      let frontmatterEndLine = -1;
      try {
        const source = typeof doc.toString === "function" ? doc.toString() : "";
        const end = typeof this.notebookHeaderFrontmatterEnd === "function"
          ? this.notebookHeaderFrontmatterEnd(source)
          : -1;
        if (Number.isInteger(end)) frontmatterEndLine = end;
      } catch (_) {}
      let titleEndLine = -1;
      try {
        const title = propertyCardTitleStateField(view.state, propertyCardTitleFieldType);
        if (title?.owner?.path === path && title.range && title.revealed !== true) {
          titleEndLine = doc.lineAt(Math.max(title.range.from, title.range.to - 1)).number - 1;
        }
      } catch (_) {}
      const lineIndex = homeCardFirstVisibleBodyLineIndex(doc, frontmatterEndLine, titleEndLine);
      return lineIndex >= 0 ? doc.line(lineIndex + 1) : null;
    } catch (_) {
      return null;
    }
  },

  homeCardHandleVisibleBodyNavigation(event, view) {
    try {
      if (!event || event.isComposing || event.keyCode === 229) return false;
      const path = this.homeCardLivePath(view);
      // The ownership StateFields put their classes on CodeMirror's editor
      // element (`view.dom`), which also contains the mounted home-card widget.
      const editorRoot = view?.dom;
      const scope = editorRoot;
      if (!path || !scope?.classList?.contains?.("bob-property-card-owns-frontmatter")
        || !scope.classList.contains("bob-property-card-owns-title")
        || !scope.querySelector?.(".bob-home-card")) {
        if (view) homeCardVimNavigationState.delete(view);
        return false;
      }
      const title = propertyCardTitleStateField(view.state, propertyCardTitleFieldType);
      if (title?.revealed === true) return false;
      const bodyLine = this.homeCardVisibleBodyLine(view, path);
      if (!bodyLine || !Number.isInteger(bodyLine.from)) return false;

      let vimEnabled = false;
      try { vimEnabled = this.app?.vault?.getConfig?.("vimMode") === true; } catch (_) {}
      const nav = homeCardVimNavigationState.get(view) || { normal: vimEnabled, lastG: 0 };
      if (event.key === "Escape" && vimEnabled) {
        nav.normal = true;
        nav.lastG = 0;
        homeCardVimNavigationState.set(view, nav);
        return false;
      }
      if (vimEnabled && ["i", "I", "a", "A", "o", "O", "s", "S", "c", "C", "R"].includes(event.key)) {
        nav.normal = false;
        nav.lastG = 0;
        homeCardVimNavigationState.set(view, nav);
        return false;
      }
      if (vimEnabled && nav.normal && event.key === "g" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        const secondG = nav.lastG && now - nav.lastG <= 1500;
        nav.lastG = secondG ? 0 : now;
        homeCardVimNavigationState.set(view, nav);
        if (!secondG) return false;
        event.preventDefault?.();
        event.stopPropagation?.();
        view.dispatch({ selection: { anchor: bodyLine.from }, scrollIntoView: true });
        return true;
      }
      nav.lastG = 0;
      homeCardVimNavigationState.set(view, nav);
      const movesUp = event.key === "ArrowUp" || (vimEnabled && nav.normal && event.key === "k");
      if (!movesUp || view.state.selection?.main?.head > bodyLine.from) return false;
      event.preventDefault?.();
      event.stopPropagation?.();
      view.dispatch({ selection: { anchor: bodyLine.from }, scrollIntoView: true });
      return true;
    } catch (_) {
      return false;
    }
  },

  homeCardRegisterVisibleBodyNavigation() {
    try {
      if (this.homeCardVisibleBodyNavigationRegistered === true) return true;
      if (typeof EditorView?.domEventHandlers !== "function" || typeof this.registerEditorExtension !== "function") return false;
      const plugin = this;
      this.registerEditorExtension(Prec.highest(EditorView.domEventHandlers({
        keydown: (event, view) => plugin.homeCardHandleVisibleBodyNavigation(event, view),
      })));
      this.homeCardVisibleBodyNavigationRegistered = true;
      return true;
    } catch (_) {
      return false;
    }
  },
});
