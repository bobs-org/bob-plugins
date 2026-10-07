// --- Task Link In Progress marks: Live Preview, Reading view, api --------
// `BobLedgerToolsProgressMarksMixin`, installed in
// `310-install-methods.js` after the date-marks Tasks mixin. Owned by
// the epic plan `plan:202610/in_progress_task_link_marks.md`
// (bob-cli-56 phase `progress-marks`). Mirrors
// `265-plugin-priority-marks.js` (setup, extension, toggle) and
// `266-plugin-date-marks.js` (post-processor shape, refresh), but the
// model is link-oriented: `progressMarkLinks(content)` finds the D3
// candidate lines and `progressMarkStatusFor` reads each target's
// checkbox through the metadata cache (plus the live doc for
// same-note targets and short-lived optimistic hints). Every method
// is synchronous and never throws.
class BobLedgerToolsProgressMarksMixin {
  setupProgressMarks() {
    try {
      if (typeof this.progressMarksEnabled !== "boolean") {
        this.progressMarksEnabled = true;
      }
      if (!(this.progressMarkHints instanceof Map)) {
        try {
          this.progressMarkHints = new Map();
        } catch (error) {
          this.progressMarkHints = null;
        }
      }
      if (!(this.progressMarkLastTargets instanceof Set)) {
        try {
          this.progressMarkLastTargets = new Set();
        } catch (error) {
          this.progressMarkLastTargets = null;
        }
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.progressMarksEnabled) {
            document.body.classList.add("bob-progress-marks");
          } else {
            document.body.classList.remove("bob-progress-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-progress-marks",
            name: "Toggle Task Link In Progress marks",
            callback: () => this.toggleProgressMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createProgressMarkExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderProgressMarksIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Reading-view marks are best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  progressMarksAvailable() {
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
          ProgressMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createProgressMarkExtension() {
    try {
      if (!this.progressMarksAvailable()) {
        return null;
      }
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildProgressMarkDecorations(view);
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
            if (plugin.progressMarkShouldRebuild(u)) {
              this.decorations =
                plugin.buildProgressMarkDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
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

  // Rebuild on a doc change, a viewport change, a live-preview
  // toggle, or the lazily defined refresh effect. Never on
  // `selectionSet`: the mark covers no source text, so it stays
  // visible while the cursor is on the line. Never throws.
  progressMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged) {
        return true;
      }
      try {
        const refresh = ensureProgressMarksRefresh();
        const transactions = u.transactions || [];
        for (const transaction of transactions) {
          try {
            const effects =
              transaction && transaction.effects !== undefined
                ? transaction.effects
                : null;
            if (!effects) {
              continue;
            }
            const list = Array.isArray(effects) ? effects : [effects];
            for (const effect of list) {
              try {
                if (!effect) {
                  continue;
                }
                if (effect === refresh) {
                  return true;
                }
                if (
                  refresh &&
                  typeof effect.is === "function" &&
                  effect.is(refresh)
                ) {
                  return true;
                }
              } catch (error) {
                continue;
              }
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // Effect scan is best-effort.
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
            return true;
          }
        }
        if (editorInfoField && u.startState && u.state) {
          let beforePath = null;
          let afterPath = null;
          try {
            const beforeInfo = u.startState.field(editorInfoField);
            beforePath =
              beforeInfo && beforeInfo.file ? beforeInfo.file.path : null;
          } catch (error) {
            beforePath = null;
          }
          try {
            const afterInfo = u.state.field(editorInfoField);
            afterPath =
              afterInfo && afterInfo.file ? afterInfo.file.path : null;
          } catch (error) {
            afterPath = null;
          }
          if (beforePath !== afterPath) {
            return true;
          }
        }
      } catch (error) {
        // Field comparison is best-effort.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Resolve a link `target` against the daily note to a vault path
  // with `.md` (an empty target is the daily note itself), or null
  // when it does not resolve. Never throws.
  progressMarkResolveTarget(target, dailyPath) {
    try {
      const name = typeof target === "string" ? target : "";
      if (name === "") {
        return typeof dailyPath === "string" && dailyPath
          ? dailyPath
          : null;
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      let dest = null;
      try {
        dest = metadataCache.getFirstLinkpathDest(name, dailyPath);
      } catch (error) {
        return null;
      }
      const resolved =
        dest && typeof dest.path === "string" ? dest.path : null;
      if (!resolved) {
        return null;
      }
      return /\.md$/i.test(resolved) ? resolved : resolved + ".md";
    } catch (error) {
      return null;
    }
  }

  // The cached checkbox character of the task at `^blockId` in the
  // note at `resolvedPath`: look up `blocks` (the exact id, then the
  // lower-cased id), find the `listItems` entry starting on that
  // block's line, and read its `.task`. Any failure returns null.
  // Never throws.
  progressMarkCacheStatus(resolvedPath, blockId) {
    try {
      const path = String(resolvedPath || "");
      const id = String(blockId || "");
      if (path === "" || id === "") {
        return null;
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getCache !== "function"
      ) {
        return null;
      }
      let cache = null;
      try {
        cache = metadataCache.getCache(path);
      } catch (error) {
        return null;
      }
      const blocks = cache && cache.blocks ? cache.blocks : null;
      if (!blocks) {
        return null;
      }
      let block = null;
      try {
        if (Object.prototype.hasOwnProperty.call(blocks, id)) {
          block = blocks[id];
        } else if (
          Object.prototype.hasOwnProperty.call(blocks, id.toLowerCase())
        ) {
          block = blocks[id.toLowerCase()];
        }
      } catch (error) {
        return null;
      }
      if (!block) {
        return null;
      }
      let blockLine = null;
      try {
        const position = block && block.position ? block.position : null;
        const start = position && position.start ? position.start : null;
        if (start && Number.isInteger(start.line)) {
          blockLine = start.line;
        }
      } catch (error) {
        return null;
      }
      if (blockLine === null) {
        return null;
      }
      const items =
        cache && Array.isArray(cache.listItems) ? cache.listItems : [];
      for (const item of items) {
        try {
          if (!item || typeof item !== "object") {
            continue;
          }
          const position = item.position ? item.position : null;
          const start = position && position.start ? position.start : null;
          if (!start || start.line !== blockLine) {
            continue;
          }
          return typeof item.task === "string" && item.task !== ""
            ? item.task
            : null;
        } catch (error) {
          continue;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // A link target's current checkbox character, or null when it is
  // unknown. Resolution order: (1) resolve the target; (2) same-note
  // targets read the live doc text when it is available (P13); (3)
  // otherwise the metadata cache; (4) an unexpired optimistic hint
  // wins over the cache until the cache agrees or 4 s pass (P14).
  // Never throws.
  progressMarkStatusFor(target, blockId, dailyPath, liveDocText) {
    try {
      const id = String(blockId || "");
      if (id === "") {
        return null;
      }
      const resolved = this.progressMarkResolveTarget(target, dailyPath);
      if (!resolved) {
        return null;
      }
      const key = resolved + "\0" + id;
      let hint = null;
      try {
        if (
          this.progressMarkHints &&
          typeof this.progressMarkHints.get === "function"
        ) {
          hint = this.progressMarkHints.get(key) || null;
        }
      } catch (error) {
        hint = null;
      }
      const dropHint = () => {
        try {
          if (
            this.progressMarkHints &&
            typeof this.progressMarkHints.delete === "function"
          ) {
            this.progressMarkHints.delete(key);
          }
        } catch (error) {
          // Hint cleanup is best-effort.
        }
      };
      let fresh = null;
      try {
        if (
          typeof liveDocText === "string" &&
          liveDocText !== "" &&
          sameVaultPath(resolved, dailyPath)
        ) {
          fresh = progressMarkLiveStatus(liveDocText, id);
        } else {
          fresh = this.progressMarkCacheStatus(resolved, id);
        }
      } catch (error) {
        fresh = null;
      }
      if (hint && hint.status) {
        try {
          const expiresAt = Number(hint.expiresAt);
          if (Number.isFinite(expiresAt) && Date.now() < expiresAt) {
            if (fresh === hint.status) {
              dropHint();
              return fresh;
            }
            return hint.status;
          }
        } catch (error) {
          // A broken hint never wins.
        }
        dropHint();
      }
      return fresh;
    } catch (error) {
      return null;
    }
  }

  buildProgressMarkDecorations(view) {
    try {
      if (!this.progressMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !ProgressMarkWidget) {
        return Decoration.none;
      }
      if (!editorInfoField || !editorLivePreviewField) {
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
      let info = null;
      try {
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const filePath =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : null;
      if (!filePath) {
        return Decoration.none;
      }
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (!dailyPath || !sameVaultPath(filePath, dailyPath)) {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      const doc = view.state.doc;
      if (
        !doc ||
        typeof doc.toString !== "function" ||
        typeof doc.line !== "function"
      ) {
        return builder.finish();
      }
      // Parse the whole Pomodoros section once per doc version
      // (daily notes are small and the open/closed state needs the
      // entry lines), then emit widgets only inside visible ranges.
      let content = "";
      try {
        content = doc.toString();
      } catch (error) {
        return builder.finish();
      }
      let links = [];
      try {
        links = progressMarkLinks(content);
      } catch (error) {
        links = [];
      }
      // Track the last build's target paths so the metadataCache
      // `changed` handler can refresh when a target note changes.
      try {
        const seen = new Set();
        for (const link of links) {
          try {
            const resolved = this.progressMarkResolveTarget(
              link && link.target,
              dailyPath,
            );
            if (resolved) {
              seen.add(resolved);
            }
          } catch (error) {
            continue;
          }
        }
        this.progressMarkLastTargets = seen;
      } catch (error) {
        // Target tracking is best-effort.
      }
      const ranges = (view && view.visibleRanges) || [];
      for (const link of links) {
        try {
          if (!link || typeof link.blockId !== "string") {
            continue;
          }
          const status = this.progressMarkStatusFor(
            link.target,
            link.blockId,
            dailyPath,
            content,
          );
          if (status !== "/") {
            continue;
          }
          let line = null;
          try {
            line = doc.line(link.line + 1);
          } catch (error) {
            continue;
          }
          if (!line || typeof line.from !== "number") {
            continue;
          }
          const pos = line.from + link.ch;
          let visible = false;
          for (const range of ranges) {
            try {
              if (
                range &&
                typeof range.from === "number" &&
                typeof range.to === "number" &&
                pos >= range.from &&
                pos <= range.to
              ) {
                visible = true;
                break;
              }
            } catch (error) {
              continue;
            }
          }
          if (!visible) {
            continue;
          }
          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new ProgressMarkWidget(link.blockId),
              side: -1,
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

  toggleProgressMarks() {
    try {
      this.progressMarksEnabled = !this.progressMarksEnabled;
      const enabled = this.progressMarksEnabled;
      try {
        const body =
          typeof document !== "undefined" && document
            ? document.body
            : null;
        if (body && body.classList) {
          if (enabled) {
            body.classList.add("bob-progress-marks");
          } else {
            body.classList.remove("bob-progress-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshProgressMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        new Notice(
          enabled ? "In Progress marks on" : "In Progress marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.progressMarksEnabled;
    }
  }

  refreshProgressMarkEditors() {
    try {
      const refresh = ensureProgressMarksRefresh();
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const filePath =
            view && view.file && typeof view.file.path === "string"
              ? view.file.path
              : null;
          // Only today's daily-note editors carry the marks.
          if (
            filePath &&
            dailyPath &&
            !sameVaultPath(filePath, dailyPath)
          ) {
            continue;
          }
          const cm =
            view && view.editor && view.editor.cm
              ? view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function" && refresh) {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleProgressMarksRefresh() {
    try {
      if (
        this.progressMarksTimer !== null &&
        this.progressMarksTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.progressMarksTimer = schedule(() => {
        self.progressMarksTimer = null;
        try {
          self.refreshProgressMarkEditors();
        } catch (error) {
          // Refresh is best-effort.
        }
      }, 150);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  // The metadataCache `changed` handler calls this: schedule a mark
  // refresh when the changed path is today's daily note or one of
  // the last build's target paths. Never throws.
  refreshProgressMarksForChangedFile(file) {
    try {
      const changedPath =
        file && typeof file.path === "string" ? file.path : null;
      if (!changedPath) {
        return false;
      }
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (dailyPath && sameVaultPath(changedPath, dailyPath)) {
        try {
          this.scheduleProgressMarksRefresh();
        } catch (error) {
          // Scheduling is best-effort.
        }
        return true;
      }
      try {
        const targets = this.progressMarkLastTargets;
        if (
          targets &&
          typeof targets.has === "function" &&
          targets.has(changedPath)
        ) {
          try {
            this.scheduleProgressMarksRefresh();
          } catch (error) {
            // Scheduling is best-effort.
          }
          return true;
        }
      } catch (error) {
        // Target lookup is best-effort.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Midnight rollover: refresh the marks once the daily path rolls
  // over. Never throws.
  refreshProgressMarksForRollover(now) {
    try {
      let dailyPath = null;
      try {
        dailyPath =
          this.currentTodayDailyPath(now instanceof Date ? now : new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (!dailyPath) {
        return false;
      }
      if (
        this.progressMarksDay === null ||
        this.progressMarksDay === undefined
      ) {
        this.progressMarksDay = dailyPath;
        return false;
      }
      if (sameVaultPath(this.progressMarksDay, dailyPath)) {
        return false;
      }
      this.progressMarksDay = dailyPath;
      try {
        this.refreshProgressMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Additive `api.progressMarks` v1 namespace (`expect`, `refresh`,
  // `isEnabled`). Synchronous and never throwing; the top-level api
  // stays v3.
  progressMarksApi() {
    try {
      const plugin = this;
      return Object.freeze({
        version: 1,
        expect(entries) {
          try {
            if (!Array.isArray(entries)) {
              return;
            }
            if (
              !plugin.progressMarkHints ||
              !(plugin.progressMarkHints instanceof Map)
            ) {
              try {
                plugin.progressMarkHints = new Map();
              } catch (error) {
                return;
              }
            }
            let stored = 0;
            let nowMs = NaN;
            try {
              nowMs = Date.now();
            } catch (error) {
              nowMs = NaN;
            }
            if (!Number.isFinite(nowMs)) {
              return;
            }
            for (const entry of entries) {
              try {
                if (!entry || typeof entry !== "object") {
                  continue;
                }
                const path = entry.path;
                const blockId = entry.blockId;
                const status = entry.status;
                if (typeof path !== "string" || path === "") {
                  continue;
                }
                if (typeof blockId !== "string" || blockId === "") {
                  continue;
                }
                if (typeof status !== "string" || status === "") {
                  continue;
                }
                plugin.progressMarkHints.set(
                  path + "\0" + blockId,
                  { status, expiresAt: nowMs + 4000 },
                );
                stored += 1;
              } catch (error) {
                continue;
              }
            }
            // A fresh hint refreshes the mark editors immediately,
            // with no debounce.
            if (stored > 0) {
              try {
                plugin.refreshProgressMarkEditors();
              } catch (error) {
                // Editor refresh is best-effort.
              }
            }
          } catch (error) {
            // `expect` never throws.
          }
        },
        refresh() {
          try {
            plugin.scheduleProgressMarksRefresh();
          } catch (error) {
            // Scheduling is best-effort.
          }
        },
        isEnabled() {
          try {
            return Boolean(plugin.progressMarksEnabled);
          } catch (error) {
            return false;
          }
        },
      });
    } catch (error) {
      return Object.freeze({
        version: 1,
        expect() {},
        refresh() {},
        isEnabled() {
          return false;
        },
      });
    }
  }
}
