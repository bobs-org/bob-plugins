// --- Unblocked hand-off glyph: Live Preview, Reading view, api ---------
// `BobLedgerToolsUnblockedGlyphMixin`, installed in
// `310-install-methods.js` after the dependency render mixin. Owned by
// the epic plan `plan:202610/successor_links.md` (bob-cli-5w phase
// `ledger_glyph`). Mirrors `268-plugin-progress-marks.js` (setup,
// extension, toggle) and `269-plugin-progress-marks-reading.js`
// (post-processor shape, refresh), but the model is link-oriented:
// `unblockedTodayLinks` finds live Task Links under today's open
// Pomodoros whose Tasks-cache task had a prerequisite completed today,
// and the glyph is a faint read-time `🔓` after the link with a
// tooltip naming the prerequisite. Derived from the Tasks cache on
// every build; never written. Every method is synchronous and never
// throws.
class BobLedgerToolsUnblockedGlyphMixin {
  setupUnblockedGlyph() {
    try {
      if (typeof this.unblockedGlyphEnabled !== "boolean") {
        this.unblockedGlyphEnabled = true;
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.unblockedGlyphEnabled) {
            document.body.classList.add("bob-unblocked-glyphs");
          } else {
            document.body.classList.remove("bob-unblocked-glyphs");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-unblocked-glyph",
            name: "Toggle unblocked hand-off glyph",
            callback: () => this.toggleUnblockedGlyph(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createUnblockedGlyphExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview glyphs are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderUnblockedGlyphIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Reading-view glyphs are best-effort.
      }
    } catch (error) {
      // Glyph setup never throws.
    }
  }

  unblockedGlyphAvailable() {
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
          UnblockedGlyphWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createUnblockedGlyphExtension() {
    try {
      if (!this.unblockedGlyphAvailable()) {
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
      const GlyphPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildUnblockedGlyphDecorations(view);
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
            if (plugin.unblockedGlyphShouldRebuild(u)) {
              this.decorations =
                plugin.buildUnblockedGlyphDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(GlyphPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  // Rebuild on a doc change, a viewport change, a live-preview
  // toggle, or the lazily defined refresh effect. Never on
  // `selectionSet`: the glyph covers no source text, so it stays
  // visible while the cursor is on the line. Never throws.
  unblockedGlyphShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged) {
        return true;
      }
      try {
        const refresh = ensureUnblockedGlyphRefresh();
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

  // The line-relative offset just past the dedicated Task Link on
  // `lineText`, or null when the line carries no such link. The model
  // already validated the line; this re-derivation only maps it back
  // to a CodeMirror position. Never throws.
  unblockedGlyphLinkEndCh(lineText) {
    try {
      const bullet = todayBulletBody(String(lineText || ""));
      if (!bullet) {
        return null;
      }
      const match = progressMarkMatchFromBody(bullet.body);
      if (!match || !match.token) {
        return null;
      }
      return bullet.bodyStart + match.prefix + match.token.end;
    } catch (error) {
      return null;
    }
  }

  buildUnblockedGlyphDecorations(view) {
    try {
      if (!this.unblockedGlyphEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !UnblockedGlyphWidget) {
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
      let content = "";
      try {
        content = doc.toString();
      } catch (error) {
        return builder.finish();
      }
      // A cold Tasks cache draws nothing: the glyph is derived, never
      // stored, and recomputed on every `cache-update` fan-out.
      let tasks = null;
      try {
        tasks = planBlockTasks(this.app);
      } catch (error) {
        tasks = null;
      }
      if (!Array.isArray(tasks)) {
        return builder.finish();
      }
      let entries = [];
      try {
        entries = unblockedTodayLinks(content, tasks, new Date(), {
          dailyPath,
        });
      } catch (error) {
        entries = [];
      }
      const ranges = (view && view.visibleRanges) || [];
      for (const entry of entries) {
        try {
          if (!entry || typeof entry.blockId !== "string") {
            continue;
          }
          const tooltip = unblockedGlyphTooltip(entry.unblockedBy);
          let line = null;
          try {
            line = doc.line(entry.line + 1);
          } catch (error) {
            continue;
          }
          if (!line || typeof line.from !== "number") {
            continue;
          }
          const endCh = this.unblockedGlyphLinkEndCh(line.text);
          if (typeof endCh !== "number") {
            continue;
          }
          const pos = line.from + endCh;
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
              widget: new UnblockedGlyphWidget(tooltip),
              side: 1,
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

  toggleUnblockedGlyph() {
    try {
      this.unblockedGlyphEnabled = !this.unblockedGlyphEnabled;
      const enabled = this.unblockedGlyphEnabled;
      try {
        const body =
          typeof document !== "undefined" && document
            ? document.body
            : null;
        if (body && body.classList) {
          if (enabled) {
            body.classList.add("bob-unblocked-glyphs");
          } else {
            body.classList.remove("bob-unblocked-glyphs");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshUnblockedGlyphEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        new Notice(
          enabled ? "Unblocked glyph on" : "Unblocked glyph off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.unblockedGlyphEnabled;
    }
  }

  refreshUnblockedGlyphEditors() {
    try {
      const refresh = ensureUnblockedGlyphRefresh();
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
          // Only today's daily-note editors carry the glyph.
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

  scheduleUnblockedGlyphRefresh() {
    try {
      if (
        this.unblockedGlyphTimer !== null &&
        this.unblockedGlyphTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.unblockedGlyphTimer = schedule(() => {
        self.unblockedGlyphTimer = null;
        try {
          self.refreshUnblockedGlyphEditors();
        } catch (error) {
          // Refresh is best-effort.
        }
      }, 150);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  // The metadataCache `changed` handler calls this: schedule a glyph
  // refresh when the changed path is today's daily note. Prerequisite
  // completions arrive through the Tasks `cache-update` fan-out, so
  // only the link lines themselves need the file hook. Never throws.
  refreshUnblockedGlyphForChangedFile(file) {
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
          this.scheduleUnblockedGlyphRefresh();
        } catch (error) {
          // Scheduling is best-effort.
        }
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Midnight rollover: refresh the glyph once the daily path rolls
  // over. Never throws.
  refreshUnblockedGlyphForRollover(now) {
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
        this.unblockedGlyphDay === null ||
        this.unblockedGlyphDay === undefined
      ) {
        this.unblockedGlyphDay = dailyPath;
        return false;
      }
      if (sameVaultPath(this.unblockedGlyphDay, dailyPath)) {
        return false;
      }
      this.unblockedGlyphDay = dailyPath;
      try {
        this.refreshUnblockedGlyphEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // The Reading-view half: today's daily note only, one glyph after
  // each live Task Link row whose Tasks-cache task had a prerequisite
  // completed today. Row eligibility reuses the progress-marks
  // dedicated-link context (the same D3 live-link rules); the model is
  // the same Tasks-cache derivation as Live Preview. Synchronous
  // throughout; never throws.
  renderUnblockedGlyphIn(el, ctx) {
    try {
      if (!this.unblockedGlyphEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const sourcePath =
        typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath) {
        return;
      }
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (!dailyPath || !sameVaultPath(sourcePath, dailyPath)) {
        return;
      }
      // A cold Tasks cache draws nothing.
      let tasks = null;
      try {
        tasks = planBlockTasks(this.app);
      } catch (error) {
        tasks = null;
      }
      if (!Array.isArray(tasks)) {
        return;
      }
      let items = [];
      try {
        if (typeof el.querySelectorAll === "function") {
          const found = el.querySelectorAll("li");
          items = typeof found.length === "number" ? found : [];
        } else if (Array.isArray(el.children)) {
          items = el.children;
        }
      } catch (error) {
        return;
      }
      const docNode =
        (el.ownerDocument && el.ownerDocument) ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode) {
        return;
      }
      let index = null;
      try {
        index = unblockedGlyphIndex(tasks);
      } catch (error) {
        return;
      }
      let todayDay = null;
      try {
        todayDay = planDayNumber(new Date());
      } catch (error) {
        todayDay = null;
      }
      if (!Number.isInteger(todayDay)) {
        return;
      }
      for (const li of items) {
        try {
          if (!li || li.nodeType !== 1) {
            continue;
          }
          if (li.dataset && li.dataset.bobUnblockedProcessed === "1") {
            continue;
          }
          let context = null;
          try {
            if (typeof this.progressMarkReadingContext === "function") {
              context = this.progressMarkReadingContext(li, el);
            }
          } catch (error) {
            context = null;
          }
          if (!context) {
            continue;
          }
          const linked = unblockedGlyphLinkedTask(
            index,
            context.target,
            context.blockId,
            sourcePath,
          );
          if (!linked) {
            continue;
          }
          let open = false;
          try {
            open = !planTaskIsDone(linked);
          } catch (error) {
            open = false;
          }
          if (!open) {
            continue;
          }
          const names = unblockedGlyphDoneTodayNames(
            linked,
            index,
            todayDay,
          );
          if (names.length === 0) {
            continue;
          }
          const glyph = buildUnblockedGlyphElement(
            docNode,
            unblockedGlyphTooltip(names),
          );
          if (!glyph) {
            continue;
          }
          try {
            li.insertBefore(glyph, context.anchor.nextSibling || null);
          } catch (error) {
            continue;
          }
          try {
            if (li.dataset) {
              li.dataset.bobUnblockedProcessed = "1";
            } else if (typeof li.setAttribute === "function") {
              li.setAttribute("data-bob-unblocked-processed", "1");
            }
          } catch (error) {
            // Dedup flag is best-effort.
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Reading-view glyphs never throw.
    }
  }

  // Additive `api.unblockedGlyph` v1 namespace (`refresh`,
  // `isEnabled`). Synchronous and never throwing; the top-level api
  // stays v3.
  unblockedGlyphApi() {
    try {
      const plugin = this;
      return Object.freeze({
        version: 1,
        refresh() {
          try {
            plugin.scheduleUnblockedGlyphRefresh();
          } catch (error) {
            // Scheduling is best-effort.
          }
        },
        isEnabled() {
          try {
            return Boolean(plugin.unblockedGlyphEnabled);
          } catch (error) {
            return false;
          }
        },
      });
    } catch (error) {
      return Object.freeze({
        version: 1,
        refresh() {},
        isEnabled() {
          return false;
        },
      });
    }
  }
}
