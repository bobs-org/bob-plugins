// --- Blocked-reason marks: session gate and refresh lifecycle -------------
// The editor decorations live in `142f-block-marks-editor.js`. This runtime
// keeps model inputs warm outside the rendering path and coalesces refreshes
// from Tasks, config, local-midnight, and app-resume events.
let blockMarksRefreshEffect = null;
function ensureBlockMarksRefresh() {
  if (blockMarksRefreshEffect) return blockMarksRefreshEffect;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      blockMarksRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    blockMarksRefreshEffect = null;
  }
  return blockMarksRefreshEffect;
}

class BobLedgerToolsBlockMarksRuntimeMixin {
  setupBlockMarks() {
    try {
      if (typeof this.blockMarksEnabled !== "boolean") this.blockMarksEnabled = true;
      if (!(this.blockMarkEditorViews instanceof Set)) this.blockMarkEditorViews = new Set();
      if (!(this.blockMarkTooltipBindings instanceof Map)) this.blockMarkTooltipBindings = new Map();
      if (!(this.blockMarkResumeDocuments instanceof WeakSet)) this.blockMarkResumeDocuments = new WeakSet();
      if (!(this.blockMarkResumeWindows instanceof WeakSet)) this.blockMarkResumeWindows = new WeakSet();
      if (this.blockMarksTimer === undefined) this.blockMarksTimer = null;

      this.applyMarkGateClass("bob-block-marks", this.blockMarksEnabled);
      this.registerMarkGatePopoutSync("bob-block-marks", () => this.blockMarksEnabled);
      this.refreshBlockMarksLadder(false);
      try {
        this.blockMarksDay = this.dateMarksToday();
      } catch (error) {
        this.blockMarksDay = null;
      }

      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-block-marks",
            name: "Toggle blocked-reason marks",
            callback: () => this.toggleBlockMarks(),
          });
        }
      } catch (error) {
        // Command registration is best-effort on limited test hosts.
      }
      try {
        if (typeof this.setupBlockMarkFolds === "function") {
          this.setupBlockMarkFolds();
        }
      } catch (error) {
        // Redundancy folds are best-effort.
      }
      try {
        const extension = this.createBlockMarkExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      try {
        this.setupBlockMarkRefreshListeners();
      } catch (error) {
        // Cache liveness is best-effort.
      }
      try {
        if (typeof this.setupBlockMarksReading === "function") {
          this.setupBlockMarksReading();
        }
      } catch (error) {
        // Rendered-view adapter is best-effort.
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => {
            this.cancelBlockMarksRefresh();
            this.restoreAllBlockMarkTooltips();
            if (typeof this.teardownBlockMarksReading === "function") {
              this.teardownBlockMarksReading();
            }
            this.applyMarkGateClass("bob-block-marks", false);
            if (this.blockMarkEditorViews instanceof Set) {
              this.blockMarkEditorViews.clear();
            }
          });
        }
      } catch (error) {
        // Unload cleanup is best-effort.
      }
    } catch (error) {
      // Marks setup never breaks plugin startup.
    }
  }

  setupBlockMarkRefreshListeners() {
    try {
      if (typeof this.registerEvent !== "function") return;
      const schedule = () => this.scheduleBlockMarksRefresh();
      const cache = this.app && this.app.metadataCache;
      if (cache && typeof cache.on === "function") {
        this.registerEvent(cache.on("changed", schedule));
        this.registerEvent(cache.on("resolved", schedule));
      }
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        this.registerEvent(vault.on("rename", schedule));
        this.registerEvent(vault.on("delete", schedule));
      }
    } catch (error) {
      // Listeners are best-effort.
    }
  }

  blockMarkTimerHost() {
    try {
      const injected = this.blockMarksTimers;
      if (injected && typeof injected.set === "function" && typeof injected.clear === "function") {
        return injected;
      }
    } catch (error) {
      // Use the host timers below.
    }
    const host = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window : null;
    return {
      set: (fn, ms) => (host ? host.setTimeout(fn, ms) : setTimeout(fn, ms)),
      clear: (handle) => (host ? host.clearTimeout(handle) : clearTimeout(handle)),
    };
  }

  scheduleBlockMarksRefresh() {
    try {
      if (this.blockMarksTimer !== null && this.blockMarksTimer !== undefined) return;
      this.blockMarksTimer = this.blockMarkTimerHost().set(() => {
        this.blockMarksTimer = null;
        this.runBlockMarksRefresh(true);
      }, 120);
    } catch (error) {
      this.blockMarksTimer = null;
    }
  }

  cancelBlockMarksRefresh() {
    try {
      if (this.blockMarksTimer !== null && this.blockMarksTimer !== undefined) {
        this.blockMarkTimerHost().clear(this.blockMarksTimer);
      }
    } catch (error) {
      // Timer cancellation is best-effort.
    }
    this.blockMarksTimer = null;
  }

  runBlockMarksRefresh(allowSwap = false) {
    try {
      this.refreshBlockMarkEditors();
    } catch (error) {
      // Editor refresh is best-effort.
    }
    try {
      if (typeof this.refreshPriorityMarkEditors === "function") {
        this.refreshPriorityMarkEditors();
      }
    } catch (error) {
      // Digit-row bar folds rebuild with the block-marks gate.
    }
    try {
      // The rendered-view phase supplies this hook; the Live Preview phase
      // remains independently runnable before that adapter is installed.
      if (typeof this.sweepBlockMarksReading === "function") {
        this.sweepBlockMarksReading({ allowSwap });
      }
    } catch (error) {
      // Rendered hosts are best-effort.
    }
    try {
      if (typeof this.sweepBlockMarkFoldsReading === "function") {
        this.sweepBlockMarkFoldsReading();
      }
    } catch (error) {
      // Project-tag folds are best-effort.
    }
    try {
      if (typeof this.refreshDependencyChipEditors === "function") {
        this.refreshDependencyChipEditors();
      }
    } catch (error) {
      // Chip marks rebuild with the block-marks gate.
    }
  }

  refreshBlockMarkEditors() {
    try {
      const effect = ensureBlockMarksRefresh();
      if (!effect) return;
      const views = this.blockMarkEditorViews instanceof Set
        ? Array.from(this.blockMarkEditorViews)
        : [];
      for (const view of views) {
        try {
          if (view && typeof view.dispatch === "function") {
            view.dispatch({ effects: effect.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  refreshBlockMarksLadder(force = false) {
    try {
      if (force && this.priorityLadderCache && typeof this.priorityLadderCache === "object") {
        this.priorityLadderCache.checkedAt = Number.NEGATIVE_INFINITY;
      }
      const snapshot = typeof this.priorityLadderSnapshot === "function"
        ? this.priorityLadderSnapshot()
        : null;
      const ladder = snapshot && Array.isArray(snapshot.ladder) ? snapshot.ladder : null;
      const signature = JSON.stringify(
        Array.isArray(ladder)
          ? ladder
              .map((entry) => [String(entry && entry.value || ""), String(entry && entry.label || "")])
              .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
          : null,
      );
      const changed = this.blockMarksLadderReady === true && signature !== this.blockMarksLadderSignature;
      this.blockMarksLadder = ladder;
      this.blockMarksLadderSignature = signature;
      this.blockMarksLadderReady = true;
      if (changed) this.scheduleBlockMarksRefresh();
      return changed;
    } catch (error) {
      return false;
    }
  }

  blockMarkLadderForRender() {
    try {
      if (this.blockMarksLadderReady === true) return this.blockMarksLadder;
      const cache = this.priorityLadderCache;
      return cache && Array.isArray(cache.ladder) ? cache.ladder : null;
    } catch (error) {
      return null;
    }
  }

  refreshBlockMarksForRollover(now = new Date()) {
    try {
      let day = null;
      try {
        day = typeof formatLocalDate === "function"
          ? formatLocalDate(now instanceof Date ? now : new Date())
          : this.dateMarksToday();
      } catch (error) {
        day = null;
      }
      if (!day) return false;
      if (this.blockMarksDay === null || this.blockMarksDay === undefined) {
        this.blockMarksDay = day;
        return false;
      }
      if (this.blockMarksDay === day) return false;
      this.blockMarksDay = day;
      this.scheduleBlockMarksRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

  registerBlockMarksResumeHooks(view) {
    try {
      const root = view && view.dom;
      const doc = root && root.ownerDocument;
      if (doc && typeof doc === "object" && !this.blockMarkResumeDocuments.has(doc)) {
        this.blockMarkResumeDocuments.add(doc);
        if (typeof this.registerDomEvent === "function") {
          this.registerDomEvent(doc, "visibilitychange", () => {
            try {
              if (doc.visibilityState === "visible") this.blockMarksOnResume();
            } catch (error) {
              // A closed popout is ignored.
            }
          });
        }
      }
      const win = doc && doc.defaultView;
      if (win && typeof win === "object" && !this.blockMarkResumeWindows.has(win)) {
        this.blockMarkResumeWindows.add(win);
        if (typeof this.registerDomEvent === "function") {
          this.registerDomEvent(win, "focus", () => this.blockMarksOnResume());
        }
      }
    } catch (error) {
      // Resume hooks are best-effort.
    }
  }

  blockMarksOnResume() {
    try {
      this.refreshBlockMarksLadder(true);
    } catch (error) {
      // Continue with the current in-memory ladder.
    }
    this.scheduleBlockMarksRefresh();
  }

  toggleBlockMarks() {
    try {
      this.blockMarksEnabled = this.blockMarksEnabled !== true;
      const enabled = this.blockMarksEnabled;
      this.applyMarkGateClass("bob-block-marks", enabled);
      this.runBlockMarksRefresh(true);
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // Tasks rerender is best-effort.
      }
      try {
        new Notice(enabled ? "Blocked-reason marks on" : "Blocked-reason marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.blockMarksEnabled === true;
    }
  }
}
