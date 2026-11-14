class BobLedgerToolsFreshnessStatusMixin {
  // --- Task freshness: status bar -----------------------------------------
  // Desktop only: a compact live review footer that appears while a
  // trustworthy nonempty queue remains. Empty groups are omitted. With no
  // due rows, a prioritized Alt+P preview can keep a hint-only item visible.
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
          el.addClass("bob-walker-footer");
        } else if (el.classList && typeof el.classList.add === "function") {
          el.classList.add("bob-freshness");
          el.classList.add("bob-freshness-hidden");
          el.classList.add("bob-walker-footer");
        } else if (typeof el.className === "string") {
          el.className = (el.className + " bob-freshness bob-freshness-hidden bob-walker-footer").trim();
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
      for (const [direction, button] of [
        ["prev", parts && parts.linkPrev],
        ["next", parts && parts.linkNext],
      ]) {
        try {
          if (!button || typeof button.addEventListener !== "function") {
            continue;
          }
          button.addEventListener("click", (event) => {
            try {
              if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              if (event && typeof event.stopPropagation === "function") {
                event.stopPropagation();
              }
            } catch (error) {
              // Best-effort.
            }
            const route = walkerFooterWalkMode(self);
            if (!route.legacy && route.mode === "b") {
              bankWalkerFooterActivate(self, direction);
            } else {
              linksWalkerFooterActivate(self, direction);
            }
          });
        } catch (error) {
          // A missing direction-button listener does not break the panel.
        }
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => linksWalkerFooterInvalidate(this));
        }
      } catch (error) {
        // Invalidation is repeated by every later family update.
      }
      try {
        if (typeof this.register === "function") {
          const selfClear = this;
          this.register(() => {
            try {
              const api =
                selfClear && typeof selfClear.dependencyNavApi === "function"
                  ? selfClear.dependencyNavApi()
                  : null;
              const walkMode = api && api.walkMode;
              if (
                !walkMode ||
                Number(walkMode.version) < 3 ||
                typeof walkMode.setAttention !== "function"
              ) {
                return;
              }
              walkMode.setAttention("s", null);
              if (Number(walkMode.version) >= 4) {
                walkMode.setAttention("b", null);
              }
            } catch (error) {
              // Unload clearing never throws.
            }
          });
        }
      } catch (error) {
        // Unload clearing is best-effort.
      }
      this.observeFreshnessFooterWidth(el);
      this.subscribeWalkerFooterDoorbell();
      this.subscribeBankWalkerFooter();
      this.refreshWalkerFooterOnLayoutReady();
    } catch (error) {
      this.freshnessStatusEl = null;
      this.freshnessFooterParts = null;
    }
  }

  // Walker-footer host (plan 202611/walker_footers.md, phase host): the
  // same status-bar item follows the persisted bracket family. Ledger
  // loads before nav, so the mode is resolved on layout-ready and on
  // every doorbell event; receivers re-read
  // `api.walkMode.current()`, so a stale payload can never win. A mode
  // event repaints synchronously, bypassing the data debounce.
  subscribeWalkerFooterDoorbell() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.on !== "function") {
        return;
      }
      const self = this;
      const ref = workspace.on(WALKER_FOOTER_DOORBELL_EVENT, () => {
        try {
          self.updateFreshnessStatusBar();
        } catch (error) {
          // A mode event never breaks the footer.
        }
      });
      if (ref && typeof this.registerEvent === "function") {
        try {
          this.registerEvent(ref);
        } catch (error) {
          // Obsidian still cleans up workspace events on unload.
        }
      }
    } catch (error) {
      // No doorbell, no gating: the legacy fallback still paints.
    }
  }

  subscribeBankWalkerFooter() {
    try {
      if (typeof this.onBankWalkChange !== "function") {
        return;
      }
      const self = this;
      const unsub = this.onBankWalkChange(() => {
        try {
          self.updateFreshnessStatusBar();
        } catch (error) {
          // Index change never breaks the footer.
        }
      });
      if (typeof this.register === "function" && typeof unsub === "function") {
        this.register(() => {
          try {
            unsub();
          } catch (error) {
            // Unload unsubscription is best-effort.
          }
        });
      }
    } catch (error) {
      // The coalesced editor-change path still repaints.
    }
  }

  refreshWalkerFooterOnLayoutReady() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.onLayoutReady !== "function") {
        return;
      }
      const self = this;
      workspace.onLayoutReady(() => {
        try {
          self.scheduleFreshnessStatusBar();
        } catch (error) {
          // Layout refresh is best-effort; cursor events still repaint.
        }
      });
    } catch (error) {
      // Layout refresh is best-effort.
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

  updateFreshnessStatusBar(options = {}) {
    const el = this.freshnessStatusEl;
    if (!el) {
      return;
    }
    try {
      const route = walkerFooterWalkMode(this);
      const contextOnly = options && options.contextOnly === true;
      let attentionMemo = this.freshnessMemo;
      if (!contextOnly || !attentionMemo) {
        try {
          attentionMemo = typeof this.freshnessEnsureMemo === "function"
            ? this.freshnessEnsureMemo()
            : attentionMemo;
        } catch (_error) {
          attentionMemo = null;
        }
      }
      walkerFooterPushReviewAttention(this, route, attentionMemo);
      let bankSnapshot = null;
      try {
        const bankWalk =
          typeof this.bankWalkApi === "function" ? this.bankWalkApi() : null;
        if (bankWalk && typeof bankWalk.snapshot === "function") {
          bankSnapshot = bankWalk.snapshot();
        }
      } catch (_error) {
        bankSnapshot = null;
      }
      walkerFooterPushBankAttention(this, route, bankSnapshot);
      if (!route.legacy && route.mode === "n") {
        linksWalkerFooterRequest(this);
        return;
      }
      linksWalkerFooterInvalidate(this);
      if (!route.legacy && route.mode === "w") {
        let queue = null;
        try {
          const laneApi =
            typeof this.laneWalkApi === "function" ? this.laneWalkApi() : null;
          if (
            laneApi &&
            Number(laneApi.version) >= 2 &&
            typeof laneApi.queue === "function"
          ) {
            // One immutable snapshot supplies both counts and positions.
            queue = laneApi.queue();
          }
        } catch (error) {
          queue = null;
        }
        let cursor = this.freshnessFooterCursor(false);
        const entries =
          queue && queue.available === true && Array.isArray(queue.entries)
            ? queue.entries
            : [];
        const current =
          cursor && typeof cursor.sourceLine === "string"
            ? freshnessMatchQueueCursor(entries, cursor)
            : null;
        const previewable = Boolean(
          cursor &&
            typeof cursor.sourceLine === "string" &&
            POMODORO_CLOCK_TASK_LINE_RE.test(cursor.sourceLine),
        );
        let workLog = null;
        let quickRoll = null;
        if (cursor && (current || previewable)) {
          const source = this.freshnessFooterCursor(true);
          if (
            source &&
            source.path === cursor.path &&
            source.line0 === cursor.line0 &&
            source.sourceLine === cursor.sourceLine &&
            Array.isArray(source.sourceLines)
          ) {
            cursor = source;
            if (current) {
              workLog = laneWalkerFooterReadLatestWorkLog(
                source.sourceLines,
                current.lineNumber,
              );
            }
            if (previewable) {
              try {
                const nav =
                  typeof this.dependencyNavApi === "function"
                    ? this.dependencyNavApi()
                    : null;
                const namespace =
                  nav && nav.quickRoll && typeof nav.quickRoll === "object"
                    ? nav.quickRoll
                    : null;
                if (
                  namespace &&
                  Number(namespace.version) >= 1 &&
                  typeof namespace.preview === "function"
                ) {
                  quickRoll = namespace.preview({
                    lines: source.sourceLines,
                    line: source.line0,
                    ...(current
                      ? { tier: freshnessReviewMachineTier(current) }
                      : {}),
                  });
                }
              } catch (error) {
                quickRoll = null;
              }
            }
          }
        }
        let caps = this.laneWalkerFooterCaps;
        if (!caps || !contextOnly) {
          try {
            caps = loadPlanCaps().caps;
          } catch (error) {
            caps = defaultPlanCaps();
          }
          this.laneWalkerFooterCaps = caps;
        }
        const view = laneWalkerFooterView(queue, {
          caps,
          cursor,
          workLog,
          quickRoll,
        });
        const paintKey = [
          "walker:w",
          view.visible ? "1" : "0",
          view.mode,
          view.dueText,
          view.contextText,
          view.detailText,
          view.hintText,
          view.groupsText,
          view.meterText,
          view.tooltip,
          view.current && view.current.key ? view.current.key : "",
        ].join("\0");
        if (paintKey === this.freshnessFooterPaintKey && this.freshnessFooterParts) {
          return;
        }
        this.freshnessFooterLastView = view;
        this.freshnessFooterPaintKey = paintKey;
        this.freshnessFooterParts = freshnessFooterPaint(
          this.freshnessStatusEl,
          view,
        );
        return;
      }
      if (!route.legacy && route.mode === "b") {
        bankWalkerFooterRequest(this);
        return;
      }
      if (!route.legacy && route.mode !== "s") {
        const key = "walker:" + String(route.mode) + ":hidden";
        if (key === this.freshnessFooterPaintKey && this.freshnessFooterParts) {
          return;
        }
        const hidden = freshnessFooterHiddenView();
        this.freshnessFooterLastView = hidden;
        this.freshnessFooterPaintKey = key;
        this.freshnessFooterParts = freshnessFooterPaint(el, hidden);
        return;
      }
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
      const cursor = this.freshnessFooterCursor(false);
      let sourceCursor = null;
      let current = queue.length > 0
        ? freshnessMatchQueueCursor(queue, cursor)
        : null;
      if (
        !current &&
        queue.length > 0 &&
        cursor &&
        typeof cursor.sourceLine === "string" &&
        POMODORO_CLOCK_TASK_LINE_RE.test(cursor.sourceLine)
      ) {
        sourceCursor = this.freshnessFooterCursor(true);
        current = freshnessMatchQueueCursor(queue, sourceCursor);
      }
      // Additive roll preview from nav `api.quickRoll` v1 (plan
      // 202610/quick_roll_alt_p.md, phase footer-preview). Queue rows keep
      // their tier-aware preview. Off-walk task lines preview without a tier;
      // the footer never throws.
      let quickRoll = null;
      try {
        const nav =
          typeof this.dependencyNavApi === "function"
            ? this.dependencyNavApi()
            : null;
        const namespace =
          nav && nav.quickRoll && typeof nav.quickRoll === "object"
            ? nav.quickRoll
            : null;
        if (
          namespace &&
          Number(namespace.version) >= 1 &&
          typeof namespace.preview === "function"
        ) {
          if (current) {
            const source = sourceCursor || this.freshnessFooterCursor(true);
            if (source && Array.isArray(source.sourceLines)) {
              quickRoll = namespace.preview({
                lines: source.sourceLines,
                line: source.line0,
                tier: freshnessReviewMachineTier(current),
              });
            }
          } else {
            if (
              cursor &&
              typeof cursor.sourceLine === "string" &&
              POMODORO_CLOCK_TASK_LINE_RE.test(cursor.sourceLine)
            ) {
              const source = sourceCursor || this.freshnessFooterCursor(true);
              if (source && Array.isArray(source.sourceLines)) {
                quickRoll = namespace.preview({
                  lines: source.sourceLines,
                  line: source.line0,
                });
              }
            }
          }
        }
      } catch (error) {
        quickRoll = null;
      }
      // Legacy fallback (A11): nav absent or older than walkMode v1
      // paints today's review footer exactly as now — ungated, with
      // `]s next` hints and hide-on-empty. The gated `s` panel routes
      // through the walker host for `]] next` hints and the clear state.
      const viewOptions = {
        current,
        navAvailable: this.freshnessNavigationAvailable(),
        todayText: memo.dateText,
        mostOverdue,
        queue,
        quickRoll,
      };
      const view = route.legacy
        ? freshnessFooterView(memo, viewOptions)
        : walkerFooterReviewView(memo, viewOptions);
      const paintKey = [
        route.legacy ? "legacy" : "s",
        view.visible ? "1" : "0",
        view.mode,
        view.dueText,
        view.contextText,
        view.detailText,
        view.hintText,
        view.groupsText,
        view.meterText,
        view.action,
        view.tooltip,
        view.answer ? view.answer.key : "",
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
      const route = walkerFooterWalkMode(this);
      if (!route.legacy && (route.mode === "n" || route.mode === "w" || route.mode === "b")) {
        const repeatId = "bob-navigation-hotkeys:repeat-next-bracket-walk";
        const repeatExists = Boolean(
          commands &&
            ((commands.commands && commands.commands[repeatId]) ||
              (typeof commands.findCommand === "function" &&
                commands.findCommand(repeatId))),
        );
        if (
          repeatExists &&
          typeof commands.executeCommandById === "function"
        ) {
          commands.executeCommandById(repeatId);
        }
        return;
      }
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
