// --- Off-clock Task Link chips: Live Preview, toggle, and liveness ---------
// Reads the same per-link clock facts as `se<X>` and never writes vault text.
class BobLedgerToolsOffClockLinkChipsMixin {
  setupOffClockLinkChips() {
    try {
      if (typeof this.offClockLinkChipsEnabled !== "boolean") this.offClockLinkChipsEnabled = true;
      if (!(this.offClockLinkChipsReadingViews instanceof Map)) this.offClockLinkChipsReadingViews = new Map();
      this.applyMarkGateClass("bob-off-clock-link-chips", this.offClockLinkChipsEnabled);
      this.registerMarkGatePopoutSync("bob-off-clock-link-chips", () => this.offClockLinkChipsEnabled);
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-off-clock-link-chips",
            name: "Toggle Task Link off-clock chips",
            callback: () => this.toggleOffClockLinkChips(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createOffClockLinkChipsExtension();
        if (extension && typeof this.registerEditorExtension === "function") this.registerEditorExtension(extension);
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.setupOffClockLinkChipsReading === "function") this.setupOffClockLinkChipsReading();
      } catch (error) {
        // Reading view is best-effort.
      }
      this.setupOffClockLinkChipListeners();
      if (typeof this.register === "function") this.register(() => this.teardownOffClockLinkChips());
    } catch (error) {
      // Display-only setup never blocks plugin startup.
    }
  }

  setupOffClockLinkChipListeners() {
    try {
      if (typeof this.registerEvent !== "function") return;
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", (file, data) => this.offClockLinkChipsSourceChanged(file, data)));
        this.registerEvent(metadataCache.on("resolved", () => this.scheduleOffClockLinkChipsRefresh()));
      }
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function") {
        this.registerEvent(vault.on("rename", (file, oldPath) => {
          try {
            const cache = this.taskThemeSourceCacheStore();
            const old = normalizeVaultPath(String(oldPath || ""));
            if (cache instanceof Map && old) cache.delete(old);
          } catch (error) {
            // A moved note is re-read on demand.
          }
          this.scheduleOffClockLinkChipsRefresh();
        }));
        this.registerEvent(vault.on("delete", (file) => {
          try {
            const cache = this.taskThemeSourceCacheStore();
            const path = normalizeVaultPath(String(file && file.path || ""));
            if (cache instanceof Map && path) cache.delete(path);
          } catch (error) {
            // Cache cleanup is best-effort.
          }
          this.scheduleOffClockLinkChipsRefresh();
        }));
      }
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(workspace.on("layout-change", () => this.scheduleOffClockLinkChipsRefresh()));
      }
    } catch (error) {
      // Liveness listeners are best-effort.
    }
  }

  offClockLinkChipsSourceChanged(file, data) {
    try {
      const path = normalizeVaultPath(String(file && file.path || ""));
      const cache = this.taskThemeSourceCacheStore();
      if (path && typeof data === "string" && cache instanceof Map && cache.has(path)) {
        // Refresh an existing entry only; cache events never grow the LRU.
        this.taskThemeRememberSourceText(path, data);
      }
    } catch (error) {
      // Source-cache freshness is a best-effort mirror of Obsidian's event.
    }
    this.scheduleOffClockLinkChipsRefresh();
  }

  offClockLinkChipFactModel(lines, link, sourcePath, memo) {
    try {
      const key = `${String(link.pathPart || "")}\u0000${String(link.blockId || "")}`;
      if (memo && memo.has(key)) return memo.get(key);
      const facts = pomodoroClockLinkFacts(
        lines,
        [link],
        (item) => this.pomodoroClockResolveTaskLineFrom(item, sourcePath),
        (item, line) => this.pomodoroClockResolveLinkClockFrom(item, line, sourcePath),
      );
      const fact = facts && facts[0] ? { ...facts[0], blockId: link.blockId } : null;
      const model = offClockLinkChipModel(fact);
      if (memo) memo.set(key, model);
      return model;
    } catch (error) {
      return null;
    }
  }

  offClockLinkChipsAvailable() {
    try {
      return Boolean(ViewPlugin && Decoration && WidgetType && StateEffect &&
        typeof StateEffect.define === "function" && RangeSetBuilder && editorInfoField &&
        editorLivePreviewField && OffClockLinkChipWidget);
    } catch (error) {
      return false;
    }
  }

  createOffClockLinkChipsExtension() {
    try {
      if (!this.offClockLinkChipsAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") return null;
      const plugin = this;
      const ChipPluginClass = class {
        constructor(view) {
          try { this.decorations = plugin.buildOffClockLinkChipDecorations(view); }
          catch (error) { this.decorations = Decoration.none; }
        }
        update(update) {
          try {
            if (plugin.offClockLinkChipsShouldRebuild(update)) {
              this.decorations = plugin.buildOffClockLinkChipDecorations(update.view);
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(ChipPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  offClockLinkChipsShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged) return true;
      const refresh = ensureOffClockLinkChipsRefresh();
      for (const transaction of update.transactions || []) {
        for (const effect of (transaction && transaction.effects)
          ? (Array.isArray(transaction.effects) ? transaction.effects : [transaction.effects]) : []) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) return true;
        }
      }
      if (editorLivePreviewField && update.startState && update.state &&
        update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return true;
      if (editorInfoField && update.startState && update.state) {
        const before = update.startState.field(editorInfoField);
        const after = update.state.field(editorInfoField);
        if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildOffClockLinkChipDecorations(view) {
    try {
      if (!this.offClockLinkChipsEnabled || !Decoration || !RangeSetBuilder || !OffClockLinkChipWidget || !editorInfoField || !editorLivePreviewField) return Decoration.none;
      if (!view || !view.state || !view.state.field(editorLivePreviewField)) return Decoration.none;
      const info = view.state.field(editorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function" || typeof doc.line !== "function") return Decoration.none;
      const lines = doc.toString().split(/\r?\n/);
      const links = offClockLinkChipLinks(lines, sourcePath);
      const ranges = view.visibleRanges || [];
      const builder = new RangeSetBuilder();
      const memo = new Map();
      for (const link of links) {
        try {
          const line = doc.line(link.line + 1);
          if (!line || typeof line.from !== "number") continue;
          const pos = line.from + link.ch;
          if (!ranges.some((range) => range && typeof range.from === "number" && typeof range.to === "number" && pos >= range.from && pos <= range.to)) continue;
          const model = this.offClockLinkChipFactModel(lines, link, sourcePath, memo);
          if (!model) continue;
          const linktext = `${link.pathPart ? link.pathPart : ""}#^${link.blockId}`;
          builder.add(pos, pos, Decoration.widget({
            widget: new OffClockLinkChipWidget(model, sourcePath, linktext, this.app && this.app.workspace),
            side: 3,
          }));
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  toggleOffClockLinkChips() {
    try {
      this.offClockLinkChipsEnabled = !this.offClockLinkChipsEnabled;
      this.applyMarkGateClass("bob-off-clock-link-chips", this.offClockLinkChipsEnabled);
      this.refreshOffClockLinkChipsEditors();
      this.refreshOffClockLinkChipsReadingViews();
      return this.offClockLinkChipsEnabled;
    } catch (error) {
      return Boolean(this.offClockLinkChipsEnabled);
    }
  }

  refreshOffClockLinkChipsEditors() {
    try {
      const refresh = ensureOffClockLinkChipsRefresh();
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function" ? workspace.getLeavesOfType("markdown") || [] : [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view;
          const path = view && view.file && view.file.path;
          const cm = view && view.editor && view.editor.cm;
          if (path && PLAN_DAILY_PATH_RE.test(path) && cm && typeof cm.dispatch === "function" && refresh) cm.dispatch({ effects: refresh.of(null) });
        } catch (error) { continue; }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }

  scheduleOffClockLinkChipsRefresh() {
    try {
      if (this.offClockLinkChipsTimer !== null && this.offClockLinkChipsTimer !== undefined) return;
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : setTimeout;
      this.offClockLinkChipsTimer = schedule(() => {
        this.offClockLinkChipsTimer = null;
        this.refreshOffClockLinkChipsEditors();
        this.refreshOffClockLinkChipsReadingViews();
      }, 120);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  refreshOffClockLinkChipsForSourceText() {
    this.scheduleOffClockLinkChipsRefresh();
  }

  teardownOffClockLinkChips() {
    try {
      if (this.offClockLinkChipsTimer !== null && this.offClockLinkChipsTimer !== undefined) clearTimeout(this.offClockLinkChipsTimer);
      this.offClockLinkChipsTimer = null;
      if (this.offClockLinkChipsReadingViews instanceof Map) this.offClockLinkChipsReadingViews.clear();
      this.applyMarkGateClass("bob-off-clock-link-chips", false);
    } catch (error) {
      // Timer and body-gate cleanup are best-effort.
    }
  }
}
