// --- Ledger frees marks: Live Preview and Reading mixin ------------------
// `BobLedgerToolsFreesMarksMixin`, installed after the unblocked glyph
// mixin. The model reads `freshnessEnsureMemo()` so BLOCKS and this mark
// share one Tasks snapshot. All methods are synchronous and defensive.
class BobLedgerToolsFreesMarksMixin {
  setupFreesMarks() {
    try {
      if (typeof this.freesMarksEnabled !== "boolean") {
        this.freesMarksEnabled = true;
      }
      if (this.freesMarksTimer === undefined) {
        this.freesMarksTimer = null;
      }
      if (this.freesMarksRolloverTimer === undefined) {
        this.freesMarksRolloverTimer = null;
      }
      if (!(this.freesMarksReadingViews instanceof Map)) {
        this.freesMarksReadingViews = new Map();
      }
      if (!(this.freesMarkCountsByEditor instanceof WeakMap)) {
        this.freesMarkCountsByEditor = new WeakMap();
      }
      try {
        this.freesMarkDay = this.currentTodayDailyPath(new Date());
      } catch (error) {
        this.freesMarkDay = null;
      }
      this.applyMarkGateClass("bob-frees-marks", this.freesMarksEnabled);
      this.registerMarkGatePopoutSync(
        "bob-frees-marks",
        () => this.freesMarksEnabled,
      );
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-frees-marks",
            name: "Toggle Task Link frees marks",
            callback: () => this.toggleFreesMarks(),
          });
        }
      } catch (error) {
        // The command is best-effort.
      }
      try {
        const extension = this.createFreesMarksExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderFreesMarksIn(el, ctx),
            60,
          );
        }
      } catch (error) {
        // Reading view is best-effort.
      }
      try {
        const metadataCache = this.app && this.app.metadataCache;
        if (metadataCache && typeof metadataCache.on === "function") {
          this.registerEvent(
            metadataCache.on("changed", (file) =>
              this.refreshFreesMarksForChangedFile(file),
            ),
          );
        }
      } catch (error) {
        // The daily-note hook is best-effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (
          workspace &&
          typeof workspace.on === "function" &&
          typeof this.registerEvent === "function" &&
          !this.freesMarksLayoutHooked
        ) {
          this.freesMarksLayoutHooked = true;
          this.registerEvent(
            workspace.on("layout-change", () => this.scheduleFreesMarksRefresh()),
          );
        }
      } catch (error) {
        // Layout-change refresh is best-effort.
      }
      try {
        if (
          this.freesMarksRolloverTimer === null &&
          typeof this.registerInterval === "function"
        ) {
          const interval = setInterval(
            () => this.refreshFreesMarksForRollover(new Date()),
            60 * 1000,
          );
          this.freesMarksRolloverTimer = interval;
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
          this.register(() => this.teardownFreesMarks());
        }
      } catch (error) {
        // Obsidian also runs onunload; explicit registration covers teardown paths.
      }
    } catch (error) {
      // Setup is display-only and never throws.
    }
  }

  freesMarksAvailable() {
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
          FreesMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createFreesMarksExtension() {
    try {
      if (!this.freesMarksAvailable()) {
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
      const FreesMarksPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildFreesMarkDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.freesMarkShouldRebuild(update)) {
              this.decorations = plugin.buildFreesMarkDecorations(
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
        ViewPlugin.fromClass(FreesMarksPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  freesMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      try {
        const refresh = ensureFreesMarksRefresh();
        for (const transaction of update.transactions || []) {
          const effects = transaction && transaction.effects;
          if (!effects) {
            continue;
          }
          for (const effect of Array.isArray(effects) ? effects : [effects]) {
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

  freesMarkEditorCounts(view) {
    try {
      if (!view || (typeof view !== "object" && typeof view !== "function")) {
        return null;
      }
      if (!(this.freesMarkCountsByEditor instanceof WeakMap)) {
        this.freesMarkCountsByEditor = new WeakMap();
      }
      let counts = this.freesMarkCountsByEditor.get(view);
      if (!(counts instanceof Map)) {
        counts = new Map();
        this.freesMarkCountsByEditor.set(view, counts);
      }
      return counts;
    } catch (error) {
      return null;
    }
  }

  rememberFreesMarkCount(counts, key, count) {
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

  buildFreesMarkDecorations(view, options) {
    try {
      if (
        !this.freesMarksEnabled ||
        !Decoration ||
        !RangeSetBuilder ||
        !FreesMarkWidget ||
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
      const ranges = view.visibleRanges || [];
      const entries = freesMarkCandidateLinks(doc.toString(), memo, new Date(), {
        dailyPath,
        isVisible: (lineNumber, ch) => {
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
        },
      });
      const builder = new RangeSetBuilder();
      const counts = this.freesMarkEditorCounts(view);
      const transitions = new Map();
      for (const entry of entries) {
        try {
          const key = entry.ownerKey || entry.ownerPath + "\u0000" + entry.ownerBlockId;
          if (!transitions.has(key)) {
            transitions.set(
              key,
              this.rememberFreesMarkCount(counts, key, entry.count),
            );
          }
          const transition = transitions.get(key);
          if (options && options.suppressMotion && transition) {
            transition.tick = false;
          }
          if (entry.count < 1) {
            continue;
          }
          const line = doc.line(entry.line + 1);
          if (!line || typeof line.from !== "number") {
            continue;
          }
          const pos = line.from + entry.ch;
          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new FreesMarkWidget(
                entry,
                filePath,
                transition.tick,
                this.app && this.app.workspace,
              ),
              side: 2,
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

  toggleFreesMarks() {
    try {
      this.freesMarksEnabled = !this.freesMarksEnabled;
      const enabled = this.freesMarksEnabled;
      this.applyMarkGateClass("bob-frees-marks", enabled);
      this.refreshFreesMarksEditors();
      this.refreshFreesMarksReadingViews();
      try {
        new Notice(enabled ? "Frees marks on" : "Frees marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return Boolean(this.freesMarksEnabled);
    }
  }

  refreshFreesMarksEditors(allMarkdown) {
    try {
      const refresh = ensureFreesMarksRefresh();
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

  scheduleFreesMarksRefresh() {
    try {
      if (this.freesMarksTimer !== null && this.freesMarksTimer !== undefined) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.freesMarksTimer = schedule(() => {
        this.freesMarksTimer = null;
        try {
          this.refreshFreesMarksEditors();
          this.refreshFreesMarksReadingViews();
        } catch (error) {
          // One missed refresh never changes the ledger.
        }
      }, 120);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  teardownFreesMarks() {
    try {
      if (
        this.freesMarksTimer !== null &&
        this.freesMarksTimer !== undefined &&
        typeof clearTimeout === "function"
      ) {
        clearTimeout(this.freesMarksTimer);
      }
      this.freesMarksTimer = null;
      if (
        this.freesMarksRolloverTimer !== null &&
        this.freesMarksRolloverTimer !== undefined &&
        typeof clearInterval === "function"
      ) {
        clearInterval(this.freesMarksRolloverTimer);
      }
      this.freesMarksRolloverTimer = null;
      if (this.freesMarksReadingViews instanceof Map) {
        this.freesMarksReadingViews.clear();
      }
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-frees-marks");
      }
    } catch (error) {
      // Timer and body-gate cleanup are best-effort.
    }
  }

  refreshFreesMarksForChangedFile(file) {
    try {
      const changedPath = file && typeof file.path === "string" ? file.path : "";
      if (!changedPath) {
        return false;
      }
      const dailyPath = this.currentTodayDailyPath(new Date());
      if (!dailyPath || !sameVaultPath(changedPath, dailyPath)) {
        return false;
      }
      this.scheduleFreesMarksRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

  refreshFreesMarksForRollover(now) {
    try {
      const dailyPath = this.currentTodayDailyPath(
        now instanceof Date ? now : new Date(),
      );
      if (!dailyPath) {
        return false;
      }
      if (this.freesMarkDay === null || this.freesMarkDay === undefined) {
        this.freesMarkDay = dailyPath;
        return false;
      }
      if (sameVaultPath(this.freesMarkDay, dailyPath)) {
        return false;
      }
      this.freesMarkDay = dailyPath;
      // A new daily note is a first paint. Drop prior counts so no pill
      // inherits a tick, and invalidate yesterday's editor so its marks
      // disappear without waiting for an edit or viewport update.
      this.freesMarkCountsByEditor = new WeakMap();
      this.refreshFreesMarksEditors(true);
      this.refreshFreesMarksReadingViews();
      return true;
    } catch (error) {
      return false;
    }
  }

  renderFreesMarksIn(el, ctx) {
    try {
      if (!el || !ctx || typeof ctx.sourcePath !== "string") {
        return;
      }
      if (!(this.freesMarksReadingViews instanceof Map)) {
        this.freesMarksReadingViews = new Map();
      }
      const record = { el, ctx, sourcePath: ctx.sourcePath };
      this.freesMarksReadingViews.set(el, record);
      this.sweepFreesMarksReadingView(record);
      try {
        this.scheduleFreesMarksRefresh();
      } catch (error) {
        // A follow-up sweep covers a section that was still detaching.
      }
      if (typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              if (this.freesMarksReadingViews) {
                this.freesMarksReadingViews.delete(el);
              }
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              if (this.freesMarksReadingViews) {
                this.freesMarksReadingViews.delete(el);
              }
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject processor children.
        }
      }
    } catch (error) {
      // Reading-view marks never throw.
    }
  }

  freesMarkPreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return records;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const sourcePath =
            view && view.file && typeof view.file.path === "string"
              ? view.file.path
              : "";
          if (!sourcePath) {
            continue;
          }
          const container =
            (view.previewMode && view.previewMode.containerEl) ||
            view.contentEl ||
            view.containerEl ||
            null;
          if (!container || typeof container.querySelector !== "function") {
            continue;
          }
          const root =
            container.querySelector(
              ".markdown-preview-view, .markdown-reading-view",
            ) || container;
          if (root) {
            records.push({ el: root, sourcePath });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return records;
    }
    return records;
  }

  refreshFreesMarksReadingViews() {
    try {
      let refreshed = false;
      if (this.freesMarksReadingViews instanceof Map) {
        for (const [el, record] of Array.from(this.freesMarksReadingViews.entries())) {
          try {
            if (!el) {
              this.freesMarksReadingViews.delete(el);
              continue;
            }
            this.sweepFreesMarksReadingView(record);
            refreshed = true;
          } catch (error) {
            continue;
          }
        }
      }
      for (const record of this.freesMarkPreviewRecords()) {
        try {
          this.sweepFreesMarksReadingView(record);
          refreshed = true;
        } catch (error) {
          continue;
        }
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }

  freesMarkReadingOwnedHosts(li, root) {
    try {
      const found =
        li && typeof li.querySelectorAll === "function"
          ? li.querySelectorAll(".bob-frees-mark")
          : [];
      const hosts = [];
      for (const host of found || []) {
        try {
          let node = host.parentNode || null;
          let owner = null;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            const tag = String(node.tagName || node.nodeName || "").toUpperCase();
            if (tag === "LI") {
              owner = node;
              break;
            }
            node = node.parentNode || null;
          }
          if (owner === li) {
            hosts.push(host);
          }
        } catch (error) {
          continue;
        }
      }
      return hosts;
    } catch (error) {
      return [];
    }
  }

  removeFreesMarkHost(host) {
    try {
      if (host && host.parentNode && typeof host.parentNode.removeChild === "function") {
        host.parentNode.removeChild(host);
      }
    } catch (error) {
      // A stale Reading-view host is harmless.
    }
  }

  paintFreesMarkHost(host, doc, model) {
    try {
      if (!host || !doc || !model) {
        return false;
      }
      host.setAttribute("class", "bob-frees-mark");
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", freesMarkTooltip(model));
      host.setAttribute("data-tooltip-position", "top");
      host.setAttribute("data-count", String(model.count));
      host.setAttribute("data-block-id", String(model.blockId || ""));
      if (typeof host.removeAttribute === "function") {
        host.removeAttribute("title");
      }
      host.textContent = "";
      const key = doc.createElement("span");
      key.setAttribute("class", "bob-frees-mark-key");
      key.textContent = FREES_MARK_KEY;
      host.appendChild(key);
      if (typeof doc.createTextNode === "function") {
        host.appendChild(doc.createTextNode(String(model.count)));
      } else {
        const count = doc.createElement("span");
        count.textContent = String(model.count);
        host.appendChild(count);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  freesMarkReadingInsertAfter(anchor) {
    try {
      if (!anchor) {
        return null;
      }
      let base = anchor;
      const wrapper = anchor.parentNode || null;
      const wrapperTag = String(wrapper && (wrapper.tagName || wrapper.nodeName) || "").toUpperCase();
      const wrapperChildren = wrapper && wrapper.childNodes ? wrapper.childNodes : [];
      if (
        ["DEL", "S", "STRIKE"].includes(wrapperTag) &&
        wrapperChildren.length === 1 &&
        wrapperChildren[0] === anchor
      ) {
        base = wrapper;
      }
      const next = base.nextSibling || null;
      const nextClass = String(next && (next.className || ""));
      let isUnblocked = false;
      try {
        isUnblocked = Boolean(
          next &&
            ((next.classList && next.classList.contains("bob-unblocked-glyph")) ||
              nextClass.split(/\s+/).includes("bob-unblocked-glyph")),
        );
      } catch (error) {
        isUnblocked = nextClass.split(/\s+/).includes("bob-unblocked-glyph");
      }
      return isUnblocked ? next : base;
    } catch (error) {
      return anchor || null;
    }
  }

  sweepFreesMarksReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String(record && record.sourcePath || "");
      if (!root || !sourcePath) {
        return false;
      }
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) {
        return false;
      }
      const allHosts =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll(".bob-frees-mark"))
          : [];
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (
        !this.freesMarksEnabled ||
        !dailyPath ||
        !sameVaultPath(sourcePath, dailyPath)
      ) {
        for (const host of allHosts) {
          this.removeFreesMarkHost(host);
        }
        return true;
      }
      const memo = this.freshnessEnsureMemo();
      if (!memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0) {
        for (const host of allHosts) {
          this.removeFreesMarkHost(host);
        }
        return true;
      }
      const index = unblockedGlyphIndex(memo.tasks);
      const resolutions = new Map();
      const counts = new Map();
      const items =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll("li"))
          : [];
      for (const li of items) {
        try {
          const existing = this.freesMarkReadingOwnedHosts(li, root);
          let context = null;
          try {
            context = this.progressMarkReadingContext(li, root, {
              allowLedgerMarks: true,
            });
          } catch (error) {
            context = null;
          }
          let model = null;
          if (context) {
            const targetKey = String(context.target || "") + "\u0000" + String(context.blockId || "");
            let linked;
            if (resolutions.has(targetKey)) {
              linked = resolutions.get(targetKey);
            } else {
              linked = freesMarkLinkedTask(
                index,
                context.target,
                context.blockId,
                sourcePath,
              );
              resolutions.set(targetKey, linked || null);
            }
            if (linked && blocksTaskIsOpen(linked) && freesMarkTaskId(linked)) {
              const ownerPath = freesMarkTaskPath(linked);
              const ownerBlockId = freesMarkTaskBlockId(linked);
              const ownerKey = ownerPath && ownerBlockId
                ? ownerPath + "\u0000" + ownerBlockId
                : targetKey;
              let count;
              if (counts.has(ownerKey)) {
                count = counts.get(ownerKey);
              } else {
                count = freesMarkCount(linked, memo, new Date());
                counts.set(ownerKey, count || null);
              }
              if (count && count.count > 0) {
                model = {
                  ...count,
                  blockId: context.blockId,
                  ownerPath,
                  ownerBlockId,
                  ownerKey,
                  target: context.target,
                  linktext:
                    (String(context.target || "") ? String(context.target) : "") +
                    "#^" +
                    String(context.blockId || ""),
                  dailyPath,
                };
              }
            }
          }
          if (!model) {
            for (const host of existing) {
              this.removeFreesMarkHost(host);
            }
            continue;
          }
          let host = existing[0] || null;
          if (!host) {
            host = buildFreesMarkElement(doc, model);
          } else {
            this.paintFreesMarkHost(host, doc, model);
          }
          if (!host) {
            continue;
          }
          const after = this.freesMarkReadingInsertAfter(context.anchor);
          const parent = after && after.parentNode;
          if (parent && typeof parent.insertBefore === "function") {
            if (host.parentNode !== parent || host.previousSibling !== after) {
              parent.insertBefore(host, after.nextSibling || null);
            }
          }
          for (const duplicate of existing.slice(1)) {
            this.removeFreesMarkHost(duplicate);
          }
        } catch (error) {
          continue;
        }
      }
      // Remove orphaned hosts whose row is no longer inside a list item.
      for (const host of allHosts) {
        try {
          let node = host.parentNode || null;
          let inList = false;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            if (String(node.tagName || node.nodeName || "").toUpperCase() === "LI") {
              inList = true;
              break;
            }
            node = node.parentNode || null;
          }
          if (!inList) {
            this.removeFreesMarkHost(host);
          }
        } catch (error) {
          continue;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
