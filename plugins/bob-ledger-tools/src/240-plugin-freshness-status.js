class BobLedgerToolsFreshnessStatusMixin {
  // --- Task freshness: status bar -----------------------------------------
  // Desktop only: a compact live review footer that appears while a
  // trustworthy nonempty queue remains. Empty groups are omitted;
  // an empty queue removes the whole item, including the upkeep meter.
  // The main button runs
  // `bob-navigation-hotkeys:jump-to-next-due-task`, falling back to
  // opening `rotten`.

  setupFreshnessStatusBar() {
    try {
      const platform =
        typeof Platform !== "undefined" ? Platform : null;
      if (platform && platform.isDesktopApp === false) {
        return;
      }
      if (platform && platform.isMobile === true) {
        return;
      }
      if (typeof this.addStatusBarItem !== "function") {
        return;
      }
      if (this.freshnessStatusEl) {
        return;
      }
      const el = this.addStatusBarItem();
      if (!el) {
        return;
      }
      this.freshnessStatusEl = el;
      try {
        if (typeof el.addClass === "function") {
          el.addClass("bob-freshness");
          el.addClass("bob-freshness-hidden");
        } else if (el.classList && typeof el.classList.add === "function") {
          el.classList.add("bob-freshness");
          el.classList.add("bob-freshness-hidden");
        } else if (typeof el.className === "string") {
          el.className = (el.className + " bob-freshness bob-freshness-hidden").trim();
        }
        if (typeof el.setAttribute === "function") {
          el.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Cosmetic only; the paint below still applies.
      }
      const parts = freshnessFooterEnsureDom(el);
      this.freshnessFooterParts = parts;
      const self = this;
      const onActivate = (event) => {
        try {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
        } catch (error) {
          // Best-effort.
        }
        self.freshnessStatusClicked();
      };
      this.freshnessFooterClickBound = onActivate;
      try {
        const button = parts && parts.button;
        if (button && typeof button.addEventListener === "function") {
          button.addEventListener("click", onActivate);
        } else if (typeof el.addEventListener === "function") {
          el.addEventListener("click", onActivate);
        } else {
          el.onclick = onActivate;
        }
      } catch (error) {
        // A status bar without a click still shows the counts.
      }
      this.observeFreshnessFooterWidth(el);
    } catch (error) {
      this.freshnessStatusEl = null;
      this.freshnessFooterParts = null;
    }
  }

  observeFreshnessFooterWidth(el) {
    try {
      if (
        this.freshnessFooterObserver &&
        typeof this.freshnessFooterObserver.disconnect === "function"
      ) {
        this.freshnessFooterObserver.disconnect();
      }
    } catch (error) {
      // Replace below.
    }
    this.freshnessFooterObserver = null;
    try {
      if (typeof ResizeObserver !== "function" || !el) {
        return;
      }
      const self = this;
      const observer = new ResizeObserver(() => {
        try {
          const host = self.freshnessStatusEl;
          const parts = self.freshnessFooterParts || (host && host._bobFreshnessParts);
          if (!host || !parts) {
            return;
          }
          const view = self.freshnessFooterLastView;
          if (view && view.visible) {
            freshnessFooterFit(host, parts, view);
          }
        } catch (error) {
          // Width fitting is best-effort.
        }
      });
      observer.observe(el);
      this.freshnessFooterObserver = observer;
    } catch (error) {
      this.freshnessFooterObserver = null;
    }
  }

  scheduleFreshnessStatusBar() {
    try {
      if (
        this.freshnessStatusTimer !== null &&
        this.freshnessStatusTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.freshnessStatusTimer = schedule(() => {
        self.freshnessStatusTimer = null;
        self.updateFreshnessStatusBar();
      }, 150);
    } catch (error) {
      // No timer host (or no status bar); nothing to schedule.
    }
  }

  scheduleFreshnessFooterContext() {
    try {
      if (
        this.freshnessFooterContextTimer !== null &&
        this.freshnessFooterContextTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.freshnessFooterContextTimer = schedule(() => {
        self.freshnessFooterContextTimer = null;
        self.updateFreshnessStatusBar({ contextOnly: true });
      }, 50);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  trackFreshnessFooterUpdate(update) {
    try {
      if (!update || !(update.selectionSet || update.docChanged)) {
        return;
      }
      this.scheduleFreshnessFooterContext();
    } catch (error) {
      // Cursor tracking is best-effort.
    }
  }

  freshnessNavigationAvailable() {
    try {
      const commands = this.app && this.app.commands;
      const commandId = "bob-navigation-hotkeys:jump-to-next-due-task";
      if (commands && commands.commands && commands.commands[commandId]) {
        return true;
      }
      if (commands && typeof commands.findCommand === "function") {
        return Boolean(commands.findCommand(commandId));
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  freshnessFooterCursor(needSourceLines) {
    try {
      const view = getActiveMarkdownView(this.app);
      if (!view || !view.editor || !view.file) {
        return null;
      }
      const line0 = getEditorCursorLine(view.editor);
      if (!Number.isInteger(line0) || line0 < 0) {
        return null;
      }
      const sourceLine =
        typeof view.editor.getLine === "function"
          ? view.editor.getLine(line0)
          : null;
      let sourceLines = null;
      if (needSourceLines && typeof view.editor.getValue === "function") {
        sourceLines = String(view.editor.getValue() || "").split(/\r?\n/);
      }
      return {
        path: view.file.path,
        line0,
        sourceLine: sourceLine == null ? null : String(sourceLine),
        sourceLines,
      };
    } catch (error) {
      return null;
    }
  }

  freshnessFooterCurrentEntry(queue) {
    const list = Array.isArray(queue) ? queue : [];
    if (list.length === 0) {
      return null;
    }
    let cursor = this.freshnessFooterCursor(false);
    let current = freshnessMatchQueueCursor(list, cursor);
    if (current) {
      return current;
    }
    cursor = this.freshnessFooterCursor(true);
    return freshnessMatchQueueCursor(list, cursor);
  }

  updateFreshnessStatusBar(options = {}) {
    const el = this.freshnessStatusEl;
    if (!el) {
      return;
    }
    try {
      const contextOnly = options && options.contextOnly === true;
      let memo = null;
      if (contextOnly) {
        memo = this.freshnessMemo;
        if (!memo || memo.tasksAvailable === false) {
          return;
        }
      } else {
        try {
          memo = this.freshnessEnsureMemo();
        } catch (error) {
          memo = null;
        }
      }
      if (!memo || memo.tasksAvailable === false) {
        const hidden = freshnessFooterHiddenView();
        this.freshnessFooterLastView = hidden;
        this.freshnessFooterParts = freshnessFooterPaint(el, hidden);
        this.freshnessFooterPaintKey = "hidden";
        return;
      }
      let mostOverdue = null;
      const queue = Array.isArray(memo.queue) ? memo.queue : [];
      for (const entry of queue) {
        if (
          Number.isInteger(entry.daysOverdue) &&
          (mostOverdue === null || entry.daysOverdue > mostOverdue)
        ) {
          mostOverdue = entry.daysOverdue;
        }
      }
      const current = this.freshnessFooterCurrentEntry(queue);
      const view = freshnessFooterView(memo, {
        current,
        navAvailable: this.freshnessNavigationAvailable(),
        todayText: memo.dateText,
        mostOverdue,
        queue,
      });
      const paintKey = [
        view.visible ? "1" : "0",
        view.mode,
        view.dueText,
        view.contextText,
        view.detailText,
        view.hintText,
        view.groupsText,
        view.meterText,
        view.action,
      ].join("\0");
      if (paintKey === this.freshnessFooterPaintKey && this.freshnessFooterParts) {
        return;
      }
      this.freshnessFooterLastView = view;
      this.freshnessFooterPaintKey = paintKey;
      this.freshnessFooterParts = freshnessFooterPaint(el, view);
    } catch (error) {
      try {
        const hidden = freshnessFooterHiddenView();
        this.freshnessFooterLastView = hidden;
        this.freshnessFooterParts = freshnessFooterPaint(el, hidden);
        this.freshnessFooterPaintKey = "hidden-error";
      } catch (inner) {
        // The status bar never throws.
      }
    }
  }

  freshnessStatusClicked() {
    try {
      const commands = this.app && this.app.commands;
      const commandId = "bob-navigation-hotkeys:jump-to-next-due-task";
      let exists = false;
      try {
        if (commands && commands.commands && commands.commands[commandId]) {
          exists = true;
        } else if (commands && typeof commands.findCommand === "function") {
          exists = Boolean(commands.findCommand(commandId));
        }
      } catch (error) {
        exists = false;
      }
      if (exists && typeof commands.executeCommandById === "function") {
        commands.executeCommandById(commandId);
        return;
      }
    } catch (error) {
      // Fall through to opening rotten.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        workspace.openLinkText("rotten", "", false);
      }
    } catch (error) {
      // Nothing to fall back to.
    }
  }

  // --- Task freshness marks: Live Preview + rendered views (mark-surfaces)
  // Display-only; nothing ever writes. The mark snapshot is a
  // filesystem-free cache (`{ dateText, config, memo, index }`) built from
  // one `freshnessEnsureMemo()` call and refreshed on the status bar
  // paths. Decoration builds reuse it and never touch the filesystem.

}
