// --- Ledger Event link times: Live Preview --------------------------------
// `BobLedgerToolsEventLinkTimesMixin`, installed in
// `310-install-methods.js` after the gcal mixins. The setup is called from
// `setupGcalEvents()` (`170-plugin-lifecycle.js` sits at the fragment size
// limit) and the teardown rides inside `teardownCalendarEventPainting()`.
// The pure core lives in `291d-event-link-times.js`; the Reading view in
// `291f-plugin-event-link-times-reading.js`. Every method is synchronous
// and never throws.
class BobLedgerToolsEventLinkTimesMixin {
  setupEventLinkTimes() {
    try {
      if (typeof this.eventLinkTimesEnabled !== "boolean") {
        this.eventLinkTimesEnabled = true;
      }
      if (!(this.eventLinkTimeViews instanceof Set)) {
        try {
          this.eventLinkTimeViews = new Set();
        } catch (error) {
          this.eventLinkTimeViews = null;
        }
      }
      this.eventLinkTimeScanCache = null;
      this.eventLinkTimesTimer = null;
      this.applyMarkGateClass("bob-event-link-times", this.eventLinkTimesEnabled);
      this.registerMarkGatePopoutSync("bob-event-link-times", () => this.eventLinkTimesEnabled);
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-event-link-times",
            name: "Toggle Task Link event times",
            callback: () => this.toggleEventLinkTimes(),
          });
        }
      } catch (error) {
        // The command is best-effort.
      }
      try {
        const extension = this.createEventLinkTimesExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview pills are best-effort.
      }
      try {
        this.setupEventLinkTimeListeners();
      } catch (error) {
        // Liveness is best-effort.
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => this.cancelEventLinkTimesRefresh());
        }
      } catch (error) {
        // Unload cleanup is best-effort.
      }
      try {
        if (typeof this.setupEventLinkTimesReading === "function") {
          this.setupEventLinkTimesReading();
        }
      } catch (error) {
        // Reading-view pills are best-effort.
      }
    } catch (error) {
      // Setup is display-only and never throws.
    }
  }

  eventLinkTimesAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          StateEffect &&
          typeof StateEffect.define === "function" &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          EventLinkTimeWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createEventLinkTimesExtension() {
    try {
      if (!this.eventLinkTimesAvailable()) return null;
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function" || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const PillPluginClass = class {
        constructor(view) {
          this.view = view;
          try {
            if (plugin.eventLinkTimeViews instanceof Set) plugin.eventLinkTimeViews.add(view);
          } catch (error) {
            // View tracking is best-effort.
          }
          try {
            this.decorations = plugin.buildEventLinkTimeDecorations(view, "init");
          } catch (error) {
            try {
              this.decorations = Decoration.none;
            } catch (inner) {
              this.decorations = null;
            }
          }
        }

        update(u) {
          try {
            const reason = plugin.eventLinkTimeRebuildReason(u);
            if (reason) {
              this.decorations = plugin.buildEventLinkTimeDecorations(u.view, reason);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }

        destroy() {
          try {
            if (plugin.eventLinkTimeViews instanceof Set) plugin.eventLinkTimeViews.delete(this.view);
          } catch (error) {
            // View tracking is best-effort.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(PillPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  // Why an editor update must rebuild the pills, or null when it must
  // not. A refresh effect wins (its own, or the calendar Event paint's —
  // the once-a-minute clock repaints both), then a document change, then
  // a Live Preview <-> source switch or a file switch ("mode"), then a
  // viewport change. Never on `selectionSet` alone: the pill covers no
  // source text and stays at the link start while the cursor is on the
  // row. Never throws.
  eventLinkTimeRebuildReason(u) {
    try {
      if (!u || typeof u !== "object") return null;
      try {
        const refresh = ensureEventLinkTimesRefresh();
        const gcalRefresh = typeof ensureGcalEventsRefreshEffect === "function"
          ? ensureGcalEventsRefreshEffect()
          : null;
        for (const transaction of u.transactions || []) {
          const effects = transaction && transaction.effects !== undefined ? transaction.effects : null;
          if (!effects) continue;
          for (const effect of Array.isArray(effects) ? effects : [effects]) {
            try {
              if (!effect) continue;
              const isOwn = refresh && (effect === refresh || (typeof effect.is === "function" && effect.is(refresh)));
              const isGcal = gcalRefresh && (effect === gcalRefresh || (typeof effect.is === "function" && effect.is(gcalRefresh)));
              if (isOwn || isGcal) return "refresh";
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        // Effect scan is best-effort.
      }
      if (u.docChanged) return "doc";
      try {
        if (editorLivePreviewField && u.startState && u.state) {
          let before = null;
          let after = null;
          try {
            before = u.startState.field(editorLivePreviewField);
          } catch (error) {
            before = null;
          }
          try {
            after = u.state.field(editorLivePreviewField);
          } catch (error) {
            after = null;
          }
          if (before !== after) return "mode";
        }
        if (editorInfoField && u.startState && u.state) {
          const pathOf = (state) => {
            try {
              const info = state.field(editorInfoField);
              return info && info.file ? info.file.path : null;
            } catch (error) {
              return null;
            }
          };
          if (pathOf(u.startState) !== pathOf(u.state)) return "mode";
        }
      } catch (error) {
        // Field comparison is best-effort.
      }
      return u.viewportChanged ? "viewport" : null;
    } catch (error) {
      return null;
    }
  }

  // The Event rows of one document version, indexed by block id. A block
  // id carried by two Event rows maps to null (ambiguous), so the pill
  // stays neutral. Never throws.
  eventLinkTimeScanForView(view, lines, path, isToday, nowMinutes) {
    try {
      const doc = view && view.state && view.state.doc ? view.state.doc : null;
      const sourcePath = typeof path === "string" ? path : "";
      const cache = this.eventLinkTimeScanCache;
      if (
        cache &&
        cache.doc === doc &&
        cache.path === sourcePath &&
        cache.isToday === isToday &&
        cache.nowMinutes === nowMinutes
      ) {
        return cache;
      }
      const rows = eventRunEventRows(Array.isArray(lines) ? lines : []);
      const byId = new Map();
      for (const row of rows) {
        try {
          if (!row || typeof row.blockId !== "string" || row.blockId === "") continue;
          if (byId.has(row.blockId)) byId.set(row.blockId, null);
          else byId.set(row.blockId, row);
        } catch (error) {
          continue;
        }
      }
      const starts = [];
      let offset = 0;
      for (const line of Array.isArray(lines) ? lines : []) {
        starts.push(offset);
        offset += String(line).length + 1;
      }
      const entry = { doc, path: sourcePath, isToday, nowMinutes, rows, byId, starts };
      this.eventLinkTimeScanCache = entry;
      return entry;
    } catch (error) {
      return { doc: null, path: "", isToday: false, nowMinutes: NaN, rows: [], byId: new Map(), starts: [] };
    }
  }

  // A same-note verdict for one ledger link: an empty linkpath is the
  // rendered note, otherwise the linkpath must resolve to it. Never
  // throws.
  eventLinkTimeIsSameNote(linkpath, sourcePath) {
    try {
      const raw = String(linkpath || "").trim();
      if (raw === "") return String(sourcePath || "") !== "";
      if (typeof this.taskLinkMarkResolvePath !== "function") return false;
      let resolved = null;
      try {
        resolved = this.taskLinkMarkResolvePath(raw, sourcePath);
      } catch (error) {
        return false;
      }
      if (!resolved) return false;
      if (typeof sameVaultPath === "function") {
        try {
          return sameVaultPath(resolved, sourcePath) === true;
        } catch (error) {
          return false;
        }
      }
      return String(resolved) === String(sourcePath);
    } catch (error) {
      return false;
    }
  }

  // Mod+click on a pill behaves exactly like Mod+clicking the link text:
  // open the link target in a new tab. Never throws.
  eventLinkTimeOpenLink(linktext, sourcePath) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const opened = workspace.openLinkText(String(linktext || ""), String(sourcePath || ""), "tab");
        if (opened && typeof opened.catch === "function") opened.catch(() => {});
      }
    } catch (error) {
      // Opening is best-effort.
    }
  }

  // Builds the pill widgets over the visible ranges of one editor. The
  // link pill needs both toggles: its own, and calendar Event painting
  // whose look it reuses. Never throws.
  buildEventLinkTimeDecorations(view) {
    try {
      if (!this.eventLinkTimesEnabled || !this.calendarEventsPaintEnabled) return Decoration.none;
      if (!Decoration || !RangeSetBuilder || !EventLinkTimeWidget || !editorInfoField || !editorLivePreviewField) {
        return Decoration.none;
      }
      let live = null;
      try {
        live = view.state.field(editorLivePreviewField);
      } catch (error) {
        return Decoration.none;
      }
      if (!live) return Decoration.none;
      let filePath = null;
      try {
        const info = view.state.field(editorInfoField);
        filePath = info && info.file && typeof info.file.path === "string" ? info.file.path : null;
      } catch (error) {
        return Decoration.none;
      }
      if (!filePath) return Decoration.none;
      try {
        if (typeof PLAN_DAILY_PATH_RE !== "undefined" && PLAN_DAILY_PATH_RE && !PLAN_DAILY_PATH_RE.test(filePath)) {
          return Decoration.none;
        }
      } catch (error) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function") return Decoration.none;
      const lines = doc.toString().replace(/\r\n/g, "\n").split("\n");
      let today = false;
      try {
        today = isTodayDailyFile(this.app, { path: filePath });
      } catch (error) {
        today = false;
      }
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const scan = this.eventLinkTimeScanForView(view, lines, filePath, today, nowMinutes);
      if (!scan.byId || scan.byId.size === 0) return Decoration.none;
      let hue = null;
      try {
        hue = typeof this.calendarEventMeetHue === "function" ? this.calendarEventMeetHue() : null;
      } catch (error) {
        hue = null;
      }
      const ranges = Array.isArray(view.visibleRanges)
        ? view.visibleRanges.slice().sort((left, right) => left.from - right.from)
        : [];
      const sameNoteCache = new Map();
      const isSameNote = (pathPart) => {
        const key = String(pathPart || "");
        if (sameNoteCache.has(key)) return sameNoteCache.get(key);
        const verdict = this.eventLinkTimeIsSameNote(key, filePath);
        sameNoteCache.set(key, verdict);
        return verdict;
      };
      const isVisible = (lineNumber, ch) => {
        try {
          const line = doc.line(lineNumber + 1);
          if (!line || typeof line.from !== "number") return false;
          const pos = line.from + ch;
          return ranges.some((range) =>
            range &&
            typeof range.from === "number" &&
            typeof range.to === "number" &&
            pos >= range.from &&
            pos <= range.to,
          );
        } catch (error) {
          return false;
        }
      };
      const links = eventLinkTimeLinks(lines, filePath, { isSameNote, isVisible });
      if (links.length === 0) return Decoration.none;
      const builder = new RangeSetBuilder();
      const models = new Map();
      const modelFor = (blockId) => {
        if (models.has(blockId)) return models.get(blockId);
        let model = null;
        try {
          const eventRow = scan.byId.get(blockId) || null;
          if (eventRow) {
            model = eventLinkTimeModel(eventRow, {
              isToday: today,
              nowMinutes,
              hue,
              line: lines[eventRow.lineIndex],
              path: filePath,
              metadataCache: this.app && this.app.metadataCache,
              vault: this.app && this.app.vault,
            });
          }
        } catch (error) {
          model = null;
        }
        models.set(blockId, model || null);
        return model;
      };
      for (const link of links) {
        try {
          const model = modelFor(link.blockId);
          if (!model) continue;
          const line = doc.line(link.line + 1);
          if (!line || typeof line.from !== "number") continue;
          const pos = line.from + link.ch;
          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new EventLinkTimeWidget(
                model,
                filePath,
                link.linktext,
                (linktext, source) => this.eventLinkTimeOpenLink(linktext, source),
              ),
              side: EVENT_LINK_TIME_SIDE,
            }),
          );
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  toggleEventLinkTimes() {
    try {
      this.eventLinkTimesEnabled = !this.eventLinkTimesEnabled;
      const enabled = this.eventLinkTimesEnabled;
      this.applyMarkGateClass("bob-event-link-times", enabled);
      this.refreshEventLinkTimesEditors();
      try {
        if (typeof this.refreshEventLinkTimesReadingViews === "function") {
          this.refreshEventLinkTimesReadingViews();
        }
      } catch (error) {
        // The Reading sweep is best-effort.
      }
      try {
        new Notice(enabled ? "Task Link event times on" : "Task Link event times off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return Boolean(this.eventLinkTimesEnabled);
    }
  }

  // Every live editor view: the ones the extension tracks (which covers
  // popouts and canvas cards) plus each Markdown leaf's CodeMirror.
  eventLinkTimeEditorViews() {
    const views = new Set();
    try {
      if (this.eventLinkTimeViews instanceof Set) {
        this.eventLinkTimeViews.forEach((view) => views.add(view));
      }
    } catch (error) {
      // Tracked views are best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      const leaves =
        workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown") || []
          : [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (cm) views.add(cm);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Leaf enumeration is best-effort.
    }
    return views;
  }

  refreshEventLinkTimesEditors() {
    try {
      const refresh = ensureEventLinkTimesRefresh();
      if (!refresh) return;
      for (const view of this.eventLinkTimeEditorViews()) {
        try {
          if (view && typeof view.dispatch === "function") {
            view.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  // metadataCache `changed` / `resolved` and vault `rename` / `delete`
  // each schedule the one coalesced refresh: an inheritance edit
  // (`offclock:`, `type:`, `parent:`) changes the pill without touching
  // the daily note. Never throws.
  setupEventLinkTimeListeners() {
    try {
      if (typeof this.registerEvent !== "function") return;
      const schedule = () => this.scheduleEventLinkTimesRefresh();
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
      // Liveness is best-effort.
    }
  }

  // The timer host behind the coalesced refresh; tests inject
  // `eventLinkTimesTimers = {set, clear}`.
  eventLinkTimesTimerHost() {
    const injected = this.eventLinkTimesTimers;
    if (injected && typeof injected.set === "function" && typeof injected.clear === "function") {
      return injected;
    }
    const host = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window : null;
    return {
      set: (fn, ms) => (host ? host.setTimeout(fn, ms) : setTimeout(fn, ms)),
      clear: (handle) => (host ? host.clearTimeout(handle) : clearTimeout(handle)),
    };
  }

  // The one coalesced refresh (about 120 ms). Triggers: the
  // metadataCache and vault hooks above, a source-text cache fill, and
  // either toggle. Never throws.
  scheduleEventLinkTimesRefresh() {
    try {
      if (this.eventLinkTimesTimer !== null && this.eventLinkTimesTimer !== undefined) return;
      this.eventLinkTimesTimer = this.eventLinkTimesTimerHost().set(() => {
        this.eventLinkTimesTimer = null;
        this.runEventLinkTimesRefresh();
      }, 120);
    } catch (error) {
      this.eventLinkTimesTimer = null;
    }
  }

  cancelEventLinkTimesRefresh() {
    try {
      if (this.eventLinkTimesTimer !== null && this.eventLinkTimesTimer !== undefined) {
        this.eventLinkTimesTimerHost().clear(this.eventLinkTimesTimer);
      }
    } catch (error) {
      // Cancelling is best-effort.
    }
    this.eventLinkTimesTimer = null;
  }

  // A refresh pass: rebuild every Live Preview editor and, when the
  // Reading-view phase is installed, sweep its rendered pills. Never
  // throws.
  runEventLinkTimesRefresh() {
    try {
      this.refreshEventLinkTimesEditors();
      try {
        if (typeof this.refreshEventLinkTimesReadingViews === "function") {
          this.refreshEventLinkTimesReadingViews();
        }
      } catch (error) {
        // The Reading sweep is best-effort.
      }
    } catch (error) {
      // A refresh pass never throws.
    }
  }

  teardownEventLinkTimes() {
    try {
      this.cancelEventLinkTimesRefresh();
      this.eventLinkTimeViews = null;
      this.eventLinkTimeScanCache = null;
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-event-link-times");
      }
    } catch (error) {
      // Timer and body-gate cleanup are best-effort.
    }
  }
}
