// --- Ledger keep-moving marks: Live Preview mixin ------------------------
// `BobLedgerToolsKeepMovingMarksMixin` renders the quiet `⏭ N` mark after a
// Task Link whose close will really open a Keep-moving successor group.
// The pure gates, count, tooltip, and widget live in
// `141d-keep-moving-marks-model.js` / `141e-keep-moving-marks-render.js`;
// this mixin only wires them into Live Preview with the shared source-text
// cache. Reading view lives in `271h-plugin-keep-moving-marks-reading.js`.
// All methods are synchronous and defensive; the mark never writes vault text.
class BobLedgerToolsKeepMovingMarksMixin {
  setupKeepMovingMarks() {
    try {
      if (typeof this.keepMovingMarksEnabled !== "boolean") {
        this.keepMovingMarksEnabled = true;
      }
      if (this.keepMovingMarksTimer === undefined) {
        this.keepMovingMarksTimer = null;
      }
      if (this.keepMovingMarksRolloverTimer === undefined) {
        this.keepMovingMarksRolloverTimer = null;
      }
      if (!(this.keepMovingMarkCountsByEditor instanceof WeakMap)) {
        this.keepMovingMarkCountsByEditor = new WeakMap();
      }
      try {
        this.keepMovingMarkDay = this.currentTodayDailyPath(new Date());
      } catch (error) {
        this.keepMovingMarkDay = null;
      }
      this.applyMarkGateClass("bob-keep-moving-marks", this.keepMovingMarksEnabled);
      this.registerMarkGatePopoutSync(
        "bob-keep-moving-marks",
        () => this.keepMovingMarksEnabled,
      );
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-keep-moving-marks",
            name: "Toggle Task Link keep-moving marks",
            callback: () => this.toggleKeepMovingMarks(),
          });
        }
      } catch (error) {
        // The command is best-effort.
      }
      try {
        const extension = this.createKeepMovingMarksExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.setupKeepMovingMarksReading === "function") {
          this.setupKeepMovingMarksReading();
        }
      } catch (error) {
        // Reading view is best-effort.
      }
      try {
        const metadataCache = this.app && this.app.metadataCache;
        if (metadataCache && typeof metadataCache.on === "function") {
          this.registerEvent(
            metadataCache.on("changed", (file) =>
              this.refreshKeepMovingMarksForChangedFile(file),
            ),
          );
          this.registerEvent(
            metadataCache.on("resolved", () =>
              this.scheduleKeepMovingMarksRefresh(),
            ),
          );
        }
      } catch (error) {
        // The daily-note hook is best-effort.
      }
      try {
        const vault = this.app && this.app.vault;
        if (vault && typeof vault.on === "function") {
          this.registerEvent(
            vault.on("rename", (file, oldPath) => {
              try {
                const cache = this.taskThemeSourceCacheStore();
                const old = normalizeVaultPath(String(oldPath || ""));
                if (cache instanceof Map && old) cache.delete(old);
              } catch (error) {
                // A moved note is re-read on demand.
              }
              this.scheduleKeepMovingMarksRefresh();
            }),
          );
          this.registerEvent(
            vault.on("delete", (file) => {
              try {
                const cache = this.taskThemeSourceCacheStore();
                const filePath = normalizeVaultPath(String((file && file.path) || ""));
                if (cache instanceof Map && filePath) cache.delete(filePath);
              } catch (error) {
                // Cache cleanup is best-effort.
              }
              this.scheduleKeepMovingMarksRefresh();
            }),
          );
        }
      } catch (error) {
        // Vault hooks are best-effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (
          workspace &&
          typeof workspace.on === "function" &&
          typeof this.registerEvent === "function" &&
          !this.keepMovingMarksLayoutHooked
        ) {
          this.keepMovingMarksLayoutHooked = true;
          this.registerEvent(
            workspace.on("layout-change", () => this.scheduleKeepMovingMarksRefresh()),
          );
        }
      } catch (error) {
        // Layout-change refresh is best-effort.
      }
      try {
        if (typeof this.relationIndexApi === "function") {
          const api = this.relationIndexApi();
          if (api && typeof api.onChange === "function" && !this.keepMovingMarksRelationHooked) {
            this.keepMovingMarksRelationHooked = true;
            const unsubscribe = api.onChange(() => this.scheduleKeepMovingMarksRefresh());
            if (typeof this.register === "function" && typeof unsubscribe === "function") {
              this.register(unsubscribe);
            }
          }
        }
      } catch (error) {
        // Relation-index refresh is best-effort.
      }
      try {
        if (
          this.keepMovingMarksRolloverTimer === null &&
          typeof this.registerInterval === "function"
        ) {
          const interval = setInterval(
            () => this.refreshKeepMovingMarksForRollover(new Date()),
            60 * 1000,
          );
          this.keepMovingMarksRolloverTimer = interval;
          try {
            if (interval && typeof interval.unref === "function") {
              interval.unref();
            }
          } catch (error) {
            // A rollover poll must never keep a host process alive by itself.
          }
          this.registerInterval(interval);
        }
      } catch (error) {
        // The midnight rollover hook is best-effort.
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => this.teardownKeepMovingMarks());
        }
      } catch (error) {
        // Obsidian also runs onunload; explicit registration covers teardown paths.
      }
    } catch (error) {
      // Setup is display-only and never throws.
    }
  }

  keepMovingMarksAvailable() {
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
          KeepMovingMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createKeepMovingMarksExtension() {
    try {
      if (!this.keepMovingMarksAvailable()) {
        return null;
      }
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const KeepMovingMarksPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildKeepMovingMarkDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.keepMovingMarkShouldRebuild(update)) {
              this.decorations = plugin.buildKeepMovingMarkDecorations(
                update.view,
                { suppressMotion: Boolean(update.viewportChanged && !update.docChanged) },
              );
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(KeepMovingMarksPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  keepMovingMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      try {
        const refresh = ensureKeepMovingMarksRefresh();
        for (const transaction of update.transactions || []) {
          const effects = transaction && transaction.effects;
          if (!effects) {
            continue;
          }
          for (const effect of Array.isArray(effects) ? effects : [effect]) {
            try {
              if (
                effect === refresh ||
                (refresh && typeof effect.is === "function" && effect.is(refresh))
              ) {
                return true;
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        // Refresh effect scan is best-effort.
      }
      try {
        if (editorLivePreviewField && update.startState && update.state) {
          const before = update.startState.field(editorLivePreviewField);
          const after = update.state.field(editorLivePreviewField);
          if (before !== after) {
            return true;
          }
        }
        if (editorInfoField && update.startState && update.state) {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          const beforePath = before && before.file ? before.file.path : null;
          const afterPath = after && after.file ? after.file.path : null;
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

  keepMovingMarkEditorCounts(view) {
    try {
      if (!view || (typeof view !== "object" && typeof view !== "function")) {
        return null;
      }
      if (!(this.keepMovingMarkCountsByEditor instanceof WeakMap)) {
        this.keepMovingMarkCountsByEditor = new WeakMap();
      }
      let counts = this.keepMovingMarkCountsByEditor.get(view);
      if (!(counts instanceof Map)) {
        counts = new Map();
        this.keepMovingMarkCountsByEditor.set(view, counts);
      }
      return counts;
    } catch (error) {
      return null;
    }
  }

  rememberKeepMovingMarkCount(counts, key, count) {
    try {
      if (!(counts instanceof Map) || !key) {
        return { tick: false, previous: undefined };
      }
      const existed = counts.has(key);
      const previous = existed ? counts.get(key) : undefined;
      counts.delete(key);
      counts.set(key, count);
      while (counts.size > 2000) {
        const oldest = counts.keys().next().value;
        counts.delete(oldest);
      }
      return {
        tick: existed && previous !== count && count >= 1,
        previous,
      };
    } catch (error) {
      return { tick: false, previous: undefined };
    }
  }

  keepMovingMarkTodayString(memo) {
    try {
      if (memo && typeof memo.dateText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(memo.dateText)) {
        return memo.dateText;
      }
    } catch (error) {
      // Fall through to the local date.
    }
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // One ctx per build: the same accessors feed the Live Preview and Reading
  // sweeps, so both surfaces evaluate the same gates against the same
  // snapshots. A project note with no cached text is requested through the
  // shared source-text cache and reads as unknown until the fill fan-out
  // schedules a follow-up refresh.
  keepMovingMarkLoadConfig() {
    try {
      return loadKeepMovingMarkConfig();
    } catch (error) {
      return { keepMoving: true, linkUnblocked: true, successorLabels: [] };
    }
  }

  keepMovingMarkPluginContext(content) {
    const plugin = this;
    let config = null;
    try {
      config = plugin.keepMovingMarkLoadConfig();
    } catch (error) {
      config = null;
    }
    let relationIndex = null;
    try {
      relationIndex =
        typeof plugin.relationIndexApi === "function" ? plugin.relationIndexApi() : null;
    } catch (error) {
      relationIndex = null;
    }
    let dailyPath = null;
    try {
      dailyPath = plugin.currentTodayDailyPath(new Date());
    } catch (error) {
      dailyPath = null;
    }
    return {
      config: config || { keepMoving: true, linkUnblocked: true, successorLabels: [] },
      relationIndex,
      dailyPath,
      dayText: typeof content === "string" ? content : "",
      toggleOn: plugin.keepMovingMarksEnabled !== false,
      noteTextFor: (notePath) => {
        try {
          const text = plugin.taskThemeSourceTextFor(notePath);
          if (typeof text === "string") {
            return text;
          }
          try {
            plugin.taskThemeRequestSourceText(notePath);
          } catch (error) {
            // The fill fan-out refreshes once the text lands.
          }
        } catch (error) {
          // Unknown inputs render as nothing until the next refresh.
        }
        return "";
      },
      frontmatterFor: (notePath) => {
        try {
          const metadataCache = plugin.app && plugin.app.metadataCache;
          if (metadataCache && typeof metadataCache.getCache === "function") {
            const entry = metadataCache.getCache(notePath);
            if (entry && entry.frontmatter && typeof entry.frontmatter === "object") {
              return entry.frontmatter;
            }
          }
        } catch (error) {
          // The model falls back to parsing the note text.
        }
        return null;
      },
      markdownPaths: () => {
        try {
          const vault = plugin.app && plugin.app.vault;
          if (vault && typeof vault.getMarkdownFiles === "function") {
            return vault.getMarkdownFiles().map((file) => file && file.path).filter(Boolean);
          }
        } catch (error) {
          // An unreadable file list reads as ambiguous, never as a leaf.
        }
        return [];
      },
      resolveLinkpath: (target, sourcePath) => {
        try {
          const metadataCache = plugin.app && plugin.app.metadataCache;
          if (metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
            const file = metadataCache.getFirstLinkpathDest(
              String(target || ""),
              sourcePath || dailyPath,
            );
            if (file && typeof file.path === "string") {
              return file;
            }
          }
        } catch (error) {
          // Unresolvable parents read as ambiguous.
        }
        return null;
      },
    };
  }

  buildKeepMovingMarkDecorations(view, options) {
    try {
      if (
        !this.keepMovingMarksEnabled ||
        !Decoration ||
        !RangeSetBuilder ||
        !KeepMovingMarkWidget ||
        !editorInfoField ||
        !editorLivePreviewField
      ) {
        return Decoration.none;
      }
      let live = false;
      let info = null;
      try {
        live = Boolean(view.state.field(editorLivePreviewField));
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const filePath =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : null;
      if (!live || !filePath) {
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
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function" || typeof doc.line !== "function") {
        return Decoration.none;
      }
      const memo = this.freshnessEnsureMemo();
      if (!memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0) {
        return Decoration.none;
      }
      const content = doc.toString();
      const rows = content.replace(/\r\n/g, "\n").split("\n");
      const ranges = view.visibleRanges || [];
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
      const ctx = this.keepMovingMarkPluginContext(content);
      // The whole day is parsed so a link below the fold can still fail G4;
      // the count itself is evaluated once per project per build, and only
      // visible ranges grow widgets.
      const entries = keepMovingMarkCandidateLinks(content, memo, this.keepMovingMarkTodayString(memo), {
        ...ctx,
        dailyPath,
        isToday: true,
        isVisible,
      });
      const builder = new RangeSetBuilder();
      const counts = this.keepMovingMarkEditorCounts(view);
      const transitions = new Map();
      const workspace = this.app && this.app.workspace;
      for (const entry of entries) {
        try {
          const key = entry.ownerKey || entry.ownerPath + "\u0000" + entry.ownerBlockId;
          if (!transitions.has(key)) {
            transitions.set(
              key,
              this.rememberKeepMovingMarkCount(counts, key, entry.count),
            );
          }
          const transition = transitions.get(key);
          if (options && options.suppressMotion && transition) {
            transition.tick = false;
          }
          if (!entry || entry.state !== "positive" || !(entry.count >= 1)) {
            continue;
          }
          const lineText = rows[entry.line];
          if (typeof lineText !== "string") {
            continue;
          }
          const endCh = freesMarkLinkEndCh(lineText);
          if (!Number.isInteger(endCh)) {
            continue;
          }
          const line = doc.line(entry.line + 1);
          if (!line || typeof line.from !== "number") {
            continue;
          }
          const pos = line.from + endCh;
          if (!isVisible(entry.line, endCh)) {
            continue;
          }
          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new KeepMovingMarkWidget(
                { ...entry, tick: Boolean(transition && transition.tick) },
                filePath,
                workspace,
              ),
              side: 3,
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

  toggleKeepMovingMarks() {
    try {
      this.keepMovingMarksEnabled = !this.keepMovingMarksEnabled;
      const enabled = this.keepMovingMarksEnabled;
      this.applyMarkGateClass("bob-keep-moving-marks", enabled);
      this.refreshKeepMovingMarksEditors();
      this.refreshKeepMovingMarksReadingViews();
      try {
        new Notice(enabled ? "Keep-moving marks on" : "Keep-moving marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return Boolean(this.keepMovingMarksEnabled);
    }
  }

  refreshKeepMovingMarksEditors(allMarkdown) {
    try {
      const refresh = ensureKeepMovingMarksRefresh();
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
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const filePath = view && view.file && view.file.path;
          if (
            !allMarkdown &&
            filePath &&
            dailyPath &&
            !sameVaultPath(filePath, dailyPath)
          ) {
            continue;
          }
          const cm = view && view.editor && view.editor.cm;
          if (cm && typeof cm.dispatch === "function" && refresh) {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }

  scheduleKeepMovingMarksRefresh() {
    try {
      if (this.keepMovingMarksTimer !== null && this.keepMovingMarksTimer !== undefined) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.keepMovingMarksTimer = schedule(() => {
        this.keepMovingMarksTimer = null;
        try {
          this.refreshKeepMovingMarksEditors();
          this.refreshKeepMovingMarksReadingViews();
        } catch (error) {
          // One missed refresh never changes the ledger.
        }
      }, 120);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  teardownKeepMovingMarks() {
    try {
      if (
        this.keepMovingMarksTimer !== null &&
        this.keepMovingMarksTimer !== undefined &&
        typeof clearTimeout === "function"
      ) {
        clearTimeout(this.keepMovingMarksTimer);
      }
      this.keepMovingMarksTimer = null;
      if (
        this.keepMovingMarksRolloverTimer !== null &&
        this.keepMovingMarksRolloverTimer !== undefined &&
        typeof clearInterval === "function"
      ) {
        clearInterval(this.keepMovingMarksRolloverTimer);
      }
      this.keepMovingMarksRolloverTimer = null;
      if (this.keepMovingMarksReadingViews instanceof Map) {
        this.keepMovingMarksReadingViews.clear();
      }
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-keep-moving-marks");
      }
    } catch (error) {
      // Timer and body-gate cleanup are best-effort.
    }
  }

  refreshKeepMovingMarksForChangedFile(file) {
    try {
      const changedPath = file && typeof file.path === "string" ? file.path : "";
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
        this.scheduleKeepMovingMarksRefresh();
        return true;
      }
      // A project note behind today's live links can move a gate or the
      // count. Only notes the mark already reads (the shared source-text
      // cache) schedule a refresh; anything else is not our input.
      try {
        const cache = this.taskThemeSourceCacheStore();
        if (cache instanceof Map && cache.has(normalizeVaultPath(changedPath))) {
          this.scheduleKeepMovingMarksRefresh();
          return true;
        }
      } catch (error) {
        // Cache lookup is best-effort.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  refreshKeepMovingMarksForRollover(now) {
    try {
      const dailyPath = this.currentTodayDailyPath(
        now instanceof Date ? now : new Date(),
      );
      if (!dailyPath) {
        return false;
      }
      if (this.keepMovingMarkDay === null || this.keepMovingMarkDay === undefined) {
        this.keepMovingMarkDay = dailyPath;
        return false;
      }
      if (sameVaultPath(this.keepMovingMarkDay, dailyPath)) {
        return false;
      }
      this.keepMovingMarkDay = dailyPath;
      // A new daily note is a first paint. Drop prior counts so no mark
      // inherits a tick, and invalidate yesterday's editor so its marks
      // disappear without waiting for an edit or viewport update.
      this.keepMovingMarkCountsByEditor = new WeakMap();
      this.refreshKeepMovingMarksEditors(true);
      this.refreshKeepMovingMarksReadingViews();
      return true;
    } catch (error) {
      return false;
    }
  }
}
