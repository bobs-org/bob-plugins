// --- Task link marks: Live Preview extension, refresh, and toggle --------
// `BobLedgerToolsTaskLinkMarksMixin`, installed in `310-install-methods.js`
// after the Today-marks mixins. Owned by the `docs/task-link-marks.md`
// display contract in bob-cli (bob-cli-f5 phase `live_preview`). The
// resolver lives in `284a-plugin-task-link-marks-resolve.js`, the pure
// core in `148-task-link-marks.js`, and the widget and live-document
// model in `149-task-link-mark-live-model.js`. Mirrors
// `268-plugin-progress-marks.js` (setup, extension, toggle) with one
// coalesced refresh (`scheduleTaskLinkMarksRefresh`) that rebuilds every
// Live Preview editor and, once the Reading-view phase installs
// `sweepTaskLinkMarksReading`, sweeps rendered anchors too. Every method
// is synchronous and never throws.

// One live-document model per document version: CM6 documents are
// immutable, so the `doc` object itself keys the memo.
const TASK_LINK_MARK_DOC_MEMO = new WeakMap();
const TASK_LINK_MARK_LINE_PREFILTER = /#(?:\^|%5e)/i;

class BobLedgerToolsTaskLinkMarksMixin {
  // The one place the mark families are set up, so `170-plugin-lifecycle.js`
  // calls a single method (it sits at the fragment size limit). The order
  // is the order the calls had inline, with task link marks last.
  setupMarkFamilies() {
    this.setupFreshnessMarks();
    this.setupTaskTagMarks();
    this.setupPriorityMarks();
    this.setupDateMarks();
    this.setupProgressMarks();
    this.setupLedgerTypeMarks();
    this.setupTodayMarks();
    this.setupTaskLinkMarks();
    this.setupOffClockLinkChips();
    this.setupBlockMarks();
  }

  setupTaskLinkMarks() {
    try {
      if (typeof this.taskLinkMarksEnabled !== "boolean") {
        this.taskLinkMarksEnabled = true;
      }
      if (!(this.taskLinkMarkViews instanceof Set)) {
        this.taskLinkMarkViews = new Set();
      }
      if (!(this.taskLinkMarkTargets instanceof Set)) {
        this.taskLinkMarkTargets = new Set();
      }
      this.taskLinkMarkViewStates = new WeakMap();
      this.applyMarkGateClass("bob-task-link-marks", this.taskLinkMarksEnabled);
      this.registerMarkGatePopoutSync("bob-task-link-marks", () => this.taskLinkMarksEnabled);
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-task-link-marks",
            name: "Toggle task link marks",
            callback: () => this.toggleTaskLinkMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createTaskLinkMarkExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview rings are best-effort.
      }
      try {
        this.setupTaskLinkMarkListeners();
      } catch (error) {
        // Liveness is best-effort.
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => this.cancelTaskLinkMarksRefresh());
        }
      } catch (error) {
        // Unload cleanup is best-effort.
      }
      try {
        // The Reading-view phase installs its setup and sweep behind
        // these hooks; absent, the Live Preview rings stand alone.
        if (typeof this.setupTaskLinkMarksReading === "function") {
          this.setupTaskLinkMarksReading();
        }
      } catch (error) {
        // Reading-view rings are best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  // metadataCache `changed` / `resolved`, vault `rename` / `delete`, and
  // Tasks' TODAY_RELOAD_EVENT each schedule the one coalesced refresh.
  // Never throws.
  setupTaskLinkMarkListeners() {
    try {
      if (typeof this.registerEvent !== "function") {
        return;
      }
      const schedule = () => this.scheduleTaskLinkMarksRefresh();
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
      const workspace = this.app && this.app.workspace;
      if (
        workspace &&
        typeof workspace.on === "function" &&
        typeof TODAY_RELOAD_EVENT === "string"
      ) {
        try {
          this.registerEvent(workspace.on(TODAY_RELOAD_EVENT, schedule));
        } catch (error) {
          // Tasks query reload is best-effort.
        }
      }
    } catch (error) {
      // Liveness is best-effort.
    }
  }

  taskLinkMarksAvailable() {
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
          TaskLinkMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createTaskLinkMarkExtension() {
    try {
      if (!this.taskLinkMarksAvailable()) {
        return null;
      }
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function" || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          this.view = view;
          try {
            plugin.taskLinkMarkViews.add(view);
          } catch (error) {
            // View tracking is best-effort.
          }
          try {
            this.decorations = plugin.buildTaskLinkMarkDecorations(view, "init");
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
            const reason = plugin.taskLinkMarkRebuildReason(u);
            if (reason) {
              this.decorations = plugin.buildTaskLinkMarkDecorations(u.view, reason);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }

        destroy() {
          try {
            plugin.taskLinkMarkViews.delete(this.view);
          } catch (error) {
            // View tracking is best-effort.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(MarkPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  // Why an editor update must rebuild the rings, or null when it must
  // not. A refresh effect wins, then a document change, then a Live
  // Preview <-> source switch or a file switch ("mode"), then a viewport
  // change. Never on `selectionSet`: the ring covers no source text, so
  // it stays put while the cursor is on the line. Never throws.
  taskLinkMarkRebuildReason(u) {
    try {
      if (!u || typeof u !== "object") {
        return null;
      }
      try {
        const refresh = ensureTaskLinkMarksRefresh();
        for (const transaction of u.transactions || []) {
          const effects = transaction && transaction.effects !== undefined ? transaction.effects : null;
          if (!effects) {
            continue;
          }
          for (const effect of Array.isArray(effects) ? effects : [effects]) {
            try {
              if (effect && (effect === refresh || (refresh && typeof effect.is === "function" && effect.is(refresh)))) {
                return "refresh";
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        // Effect scan is best-effort.
      }
      if (u.docChanged) {
        return "doc";
      }
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
          if (before !== after) {
            return "mode";
          }
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
          if (pathOf(u.startState) !== pathOf(u.state)) {
            return "mode";
          }
        }
      } catch (error) {
        // Field comparison is best-effort.
      }
      return u.viewportChanged ? "viewport" : null;
    } catch (error) {
      return null;
    }
  }

  taskLinkMarkShouldRebuild(u) {
    return this.taskLinkMarkRebuildReason(u) !== null;
  }

  // The injected clock behind the swap window. Never throws.
  taskLinkMarksNow() {
    try {
      if (typeof this.taskLinkMarksClock === "function") {
        const value = Number(this.taskLinkMarksClock());
        if (Number.isFinite(value)) {
          return value;
        }
      }
      return Date.now();
    } catch (error) {
      return 0;
    }
  }

  taskLinkMarkViewStateFor(view) {
    try {
      if (!(this.taskLinkMarkViewStates instanceof WeakMap)) {
        this.taskLinkMarkViewStates = new WeakMap();
      }
      let state = this.taskLinkMarkViewStates.get(view);
      if (!state) {
        state = taskLinkMarkNewViewState();
        this.taskLinkMarkViewStates.set(view, state);
      }
      return state;
    } catch (error) {
      return taskLinkMarkNewViewState();
    }
  }

  // Mod+click on a ring behaves exactly like Mod+clicking the link
  // text: open the link target in a new tab. Never throws.
  taskLinkMarkOpenLink(linktext, sourcePath) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        const opened = workspace.openLinkText(String(linktext || ""), String(sourcePath || ""), "tab");
        if (opened && typeof opened.catch === "function") {
          opened.catch(() => {});
        }
      }
    } catch (error) {
      // Opening is best-effort.
    }
  }

  // The live-document model for `doc`, memoised per document version.
  // Never throws.
  taskLinkMarkDocModelFor(doc, path) {
    try {
      const known = TASK_LINK_MARK_DOC_MEMO.get(doc);
      if (known && known.path === path) {
        return known.model;
      }
      const model = taskLinkMarkLiveDocModel(doc.toString(), path);
      TASK_LINK_MARK_DOC_MEMO.set(doc, { path, model });
      return model;
    } catch (error) {
      return taskLinkMarkLiveDocModel("", path);
    }
  }

  // Builds the ring widgets over the visible ranges of one editor.
  // `reason` is `taskLinkMarkRebuildReason`'s verdict (or `init`); only
  // `refresh` and `doc` rebuilds may start the swap animation. Never
  // throws.
  buildTaskLinkMarkDecorations(view, reason) {
    try {
      if (!this.taskLinkMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !TaskLinkMarkWidget || !editorInfoField || !editorLivePreviewField) {
        return Decoration.none;
      }
      let live = null;
      try {
        live = view.state.field(editorLivePreviewField);
      } catch (error) {
        return Decoration.none;
      }
      if (!live) {
        return Decoration.none;
      }
      let filePath = null;
      try {
        const info = view.state.field(editorInfoField);
        filePath = info && info.file && typeof info.file.path === "string" ? info.file.path : null;
      } catch (error) {
        return Decoration.none;
      }
      if (!filePath) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function") {
        return Decoration.none;
      }
      if (!(this.taskLinkMarkTargets instanceof Set)) {
        this.taskLinkMarkTargets = new Set();
      }
      const model = this.taskLinkMarkDocModelFor(doc, filePath);
      const viewState = this.taskLinkMarkViewStateFor(view);
      const allowSwap = reason === "refresh" || reason === "doc";
      const nowMs = this.taskLinkMarksNow();
      // One resolution (and tooltip, and swap verdict) per unique link
      // target per build.
      const resolved = new Map();
      const entryFor = (span) => {
        const memoKey = span.linkpath + "\u0000" + span.blockId;
        if (resolved.has(memoKey)) {
          return resolved.get(memoKey);
        }
        let entry = null;
        const hit = this.taskLinkMarkResolve({
          linkpath: span.linkpath,
          blockId: span.blockId,
          sourcePath: filePath,
          liveDoc: model,
        });
        if (hit) {
          entry = {
            hit,
            swap: taskLinkMarkSwapFor(viewState, hit.key, hit.state, nowMs, allowSwap),
            tooltip: taskLinkMarkTooltip({
              title: hit.title,
              state: hit.state,
              targetPath: hit.targetPath,
              sourcePath: filePath,
            }),
          };
          this.taskLinkMarkTargets.add(hit.targetPath);
        }
        resolved.set(memoKey, entry);
        return entry;
      };
      const builder = new RangeSetBuilder();
      const ranges = Array.isArray(view.visibleRanges)
        ? view.visibleRanges.slice().sort((a, b) => a.from - b.from)
        : [];
      let lastLine = -1;
      for (const range of ranges) {
        if (!range || typeof range.from !== "number" || typeof range.to !== "number") {
          continue;
        }
        const first = Math.max(taskLinkMarkLineIndexAt(model, range.from), lastLine + 1);
        const last = taskLinkMarkLineIndexAt(model, range.to);
        for (let index = first; index <= last && index < model.lines.length; index += 1) {
          lastLine = index;
          const text = model.lines[index];
          if (!TASK_LINK_MARK_LINE_PREFILTER.test(text)) {
            continue;
          }
          const spans = taskLinkMarkSpans(text, model.ctx.excluded(index));
          if (spans.length === 0 || !model.ctx.eligible(index)) {
            continue;
          }
          for (const span of spans) {
            try {
              const entry = entryFor(span);
              if (!entry) {
                continue;
              }
              const pos = model.starts[index] + span.at;
              builder.add(
                pos,
                pos,
                // Side 0 sorts after the Today (-1) and In Progress (-1)
                // marks and the ledger type prefix (-2) at the same
                // offset, so the ring is last, closest to the link.
                Decoration.widget({
                  widget: new TaskLinkMarkWidget(
                    {
                      key: entry.hit.key,
                      state: entry.hit.state,
                      tooltip: entry.tooltip,
                      swap: entry.swap,
                      linktext: span.linkpath + "#^" + span.blockId,
                      sourcePath: filePath,
                    },
                    (linktext, source) => this.taskLinkMarkOpenLink(linktext, source),
                  ),
                  side: 0,
                }),
              );
            } catch (error) {
              continue;
            }
          }
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

  toggleTaskLinkMarks() {
    try {
      this.taskLinkMarksEnabled = !this.taskLinkMarksEnabled;
      const enabled = this.taskLinkMarksEnabled;
      this.applyMarkGateClass("bob-task-link-marks", enabled);
      // A toggle is a fresh start: no ring swaps for changes made while
      // the marks were off.
      this.taskLinkMarkViewStates = new WeakMap();
      this.runTaskLinkMarksRefresh(false);
      try {
        new Notice(enabled ? "Task link marks on" : "Task link marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.taskLinkMarksEnabled;
    }
  }

  // Every live editor view: the ones the extension tracks (which covers
  // popouts and canvas cards) plus each Markdown leaf's CodeMirror.
  taskLinkMarkEditorViews() {
    const views = new Set();
    try {
      if (this.taskLinkMarkViews instanceof Set) {
        this.taskLinkMarkViews.forEach((view) => views.add(view));
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
          if (cm) {
            views.add(cm);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Leaf enumeration is best-effort.
    }
    return views;
  }

  refreshTaskLinkMarkEditors() {
    try {
      const refresh = ensureTaskLinkMarksRefresh();
      if (!refresh) {
        return;
      }
      for (const view of this.taskLinkMarkEditorViews()) {
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

  // The timer host behind the coalesced refresh; tests inject
  // `taskLinkMarksTimers = {set, clear}`.
  taskLinkMarksTimerHost() {
    const injected = this.taskLinkMarksTimers;
    if (injected && typeof injected.set === "function" && typeof injected.clear === "function") {
      return injected;
    }
    const host = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window : null;
    return {
      set: (fn, ms) => (host ? host.setTimeout(fn, ms) : setTimeout(fn, ms)),
      clear: (handle) => (host ? host.clearTimeout(handle) : clearTimeout(handle)),
    };
  }

  // The one coalesced refresh (about 120 ms). Triggers: the live widget
  // fan-out, metadataCache `changed` / `resolved`, vault `rename` /
  // `delete`, and the toggle. Never throws.
  scheduleTaskLinkMarksRefresh() {
    try {
      if (this.taskLinkMarksTimer !== null && this.taskLinkMarksTimer !== undefined) {
        return;
      }
      this.taskLinkMarksTimer = this.taskLinkMarksTimerHost().set(() => {
        this.taskLinkMarksTimer = null;
        this.runTaskLinkMarksRefresh(true);
      }, 120);
    } catch (error) {
      this.taskLinkMarksTimer = null;
    }
  }

  cancelTaskLinkMarksRefresh() {
    try {
      if (this.taskLinkMarksTimer !== null && this.taskLinkMarksTimer !== undefined) {
        this.taskLinkMarksTimerHost().clear(this.taskLinkMarksTimer);
      }
    } catch (error) {
      // Cancelling is best-effort.
    }
    this.taskLinkMarksTimer = null;
  }

  // A refresh pass: rebuild every Live Preview editor and, when the
  // Reading-view phase is installed, sweep its stamped anchors. Never
  // throws.
  runTaskLinkMarksRefresh(allowSwap = false) {
    try {
      this.taskLinkMarkTargets = new Set();
      this.refreshTaskLinkMarkEditors();
      try {
        if (typeof this.sweepTaskLinkMarksReading === "function") {
          this.sweepTaskLinkMarksReading({ allowSwap });
        }
      } catch (error) {
        // The Reading sweep is best-effort.
      }
    } catch (error) {
      // A refresh pass never throws.
    }
  }
}
