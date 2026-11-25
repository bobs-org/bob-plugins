// --- Task drawer marks: Live Preview and Reading view ---------------------
// Display-only attributes on source-recognized drawer headers. Markdown is
// never rewritten and the stored bold delimiters remain Obsidian-owned.
// Stable bundle marker: bob-task-drawer-render-v1

const TASK_DRAWER_MARK_ATTRS = Object.freeze([
  "data-bob-drawer",
  "data-bob-drawer-key",
  "data-bob-drawer-count",
  "data-bob-drawer-empty",
  "data-bob-drawer-owner-state",
  "data-bob-type",
  "data-bob-type-hue",
  "data-bob-type-state",
  "title",
  "aria-label",
]);
const TASK_DRAWER_DATA_ATTRS = Object.freeze(TASK_DRAWER_MARK_ATTRS.slice(0, 5));

class BobLedgerToolsTaskDrawerMarksMixin {
  async loadLedgerToolsPluginData() {
    if (this.ledgerToolsPluginDataLoadPromise) return this.ledgerToolsPluginDataLoadPromise;
    const revision = this.ledgerToolsPluginDataRevision || 0;
    const load = (async () => {
      let stored = {};
      try {
        if (typeof this.loadData === "function") {
          const value = await this.loadData();
          if (value && typeof value === "object" && !Array.isArray(value)) stored = { ...value };
        }
      } catch (error) {
        // Missing or unreadable plugin settings use their documented defaults.
      }
      this.ledgerToolsPluginDataLoaded = true;
      if ((this.ledgerToolsPluginDataRevision || 0) === revision) {
        this.ledgerToolsPluginData = stored;
        this.notebookPluginData = stored;
      }
      return this.ledgerToolsPluginData || stored;
    })();
    this.ledgerToolsPluginDataLoadPromise = load;
    try {
      return await load;
    } finally {
      if (this.ledgerToolsPluginDataLoadPromise === load) this.ledgerToolsPluginDataLoadPromise = null;
    }
  }

  saveLedgerToolsPluginDataPatch(patch) {
    const previous = this.ledgerToolsPluginDataWriteQueue || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (!this.ledgerToolsPluginDataLoaded) await this.loadLedgerToolsPluginData();
      const current = this.ledgerToolsPluginData && typeof this.ledgerToolsPluginData === "object"
        ? this.ledgerToolsPluginData
        : {};
      const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
      this.ledgerToolsPluginDataRevision = (this.ledgerToolsPluginDataRevision || 0) + 1;
      this.ledgerToolsPluginData = next;
      this.notebookPluginData = next;
      if (typeof this.saveData === "function") await this.saveData(next);
      return next;
    });
    this.ledgerToolsPluginDataWriteQueue = write.catch(() => {});
    return write;
  }

  setupTaskDrawerMarks() {
    try {
      this.taskDrawerMarksActive = true;
      this.taskDrawerMarksEnabled = true;
      this.taskDrawerMarksEpoch = (this.taskDrawerMarksEpoch || 0) + 1;
      this.taskDrawerRenderedOriginals = new WeakMap();
      this.taskDrawerRenderedModels = new WeakMap();
      this.applyMarkGateClass("bob-task-drawer-marks", true);
      this.registerMarkGatePopoutSync("bob-task-drawer-marks", () => this.taskDrawerMarksEnabled);
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "toggle-task-drawer-marks",
          name: "Toggle task drawer marks",
          callback: () => this.toggleTaskDrawerMarks(),
        });
      }
      const extension = this.createTaskDrawerMarkExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderTaskDrawersIn(el, ctx), 52);
      }
      if (typeof this.register === "function") {
        this.register(() => {
          this.taskDrawerMarksActive = false;
          this.taskDrawerMarksEnabled = false;
          this.taskDrawerMarksEpoch = (this.taskDrawerMarksEpoch || 0) + 1;
          this.applyMarkGateClass("bob-task-drawer-marks", false);
          this.taskDrawerRefreshRenderedRows(false);
          this.refreshTaskTagMarkEditors();
        });
      }
      void this.loadTaskDrawerMarksSetting();
    } catch (error) {
      // Drawer marks never break plugin startup.
    }
  }

  async loadTaskDrawerMarksSetting() {
    const epoch = this.taskDrawerMarksEpoch || 0;
    try {
      const stored = await this.loadLedgerToolsPluginData();
      if (this.taskDrawerMarksActive === false || (this.taskDrawerMarksEpoch || 0) !== epoch) {
        return this.taskDrawerMarksEnabled;
      }
      this.taskDrawerMarksEnabled = !(stored && stored.taskDrawerMarks === false);
      this.applyMarkGateClass("bob-task-drawer-marks", this.taskDrawerMarksEnabled);
      this.taskDrawerRefreshRenderedRows(this.taskDrawerMarksEnabled);
      this.refreshTaskTagMarkEditors();
      return this.taskDrawerMarksEnabled;
    } catch (error) {
      return this.taskDrawerMarksEnabled !== false;
    }
  }

  async saveTaskDrawerMarksSetting(enabled) {
    const nextEnabled = enabled !== false;
    this.taskDrawerMarksEnabled = nextEnabled;
    this.taskDrawerMarksEpoch = (this.taskDrawerMarksEpoch || 0) + 1;
    this.applyMarkGateClass("bob-task-drawer-marks", nextEnabled);
    this.taskDrawerRefreshRenderedRows(nextEnabled);
    try {
      this.refreshTaskTagMarkEditors();
    } catch (error) {
      // Editor refresh is best-effort.
    }
    try {
      await this.saveLedgerToolsPluginDataPatch({ taskDrawerMarks: nextEnabled });
    } catch (error) {
      // The visible setting still applies if Obsidian cannot persist data.
    }
    return nextEnabled;
  }

  toggleTaskDrawerMarks() {
    return this.saveTaskDrawerMarksSetting(!this.taskDrawerMarksEnabled);
  }

  taskDrawerMarksAvailable() {
    try {
      return Boolean(ViewPlugin && Decoration && RangeSetBuilder && editorInfoField && editorLivePreviewField);
    } catch (error) {
      return false;
    }
  }

  createTaskDrawerMarkExtension() {
    try {
      if (!this.taskDrawerMarksAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function"
        || !Prec || typeof Prec.highest !== "function") return null;
      const plugin = this;
      const DrawerMarkPlugin = class {
        constructor(view) {
          this.view = view;
          this.decorations = plugin.buildTaskDrawerDecorations(view);
        }
        update(update) {
          try {
            if (plugin.taskDrawerMarkShouldRebuild(update)) {
              this.decorations = plugin.buildTaskDrawerDecorations(update.view);
            }
          } catch (error) {
            // Keep the last valid decoration set if a refresh fails.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(DrawerMarkPlugin, {
        decorations: (value) => value.decorations,
      }));
    } catch (error) {
      return null;
    }
  }

  taskDrawerMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const refresh = typeof ensureTaskTagMarksRefresh === "function" ? ensureTaskTagMarksRefresh() : null;
      for (const transaction of update.transactions || []) {
        const rawEffects = transaction && transaction.effects;
        const effects = !rawEffects ? [] : Array.isArray(rawEffects) ? rawEffects : [rawEffects];
        for (const effect of effects) {
          if (refresh && (effect === refresh || (typeof effect.is === "function" && effect.is(refresh)))) return true;
        }
      }
      if (editorLivePreviewField && update.startState && update.state
        && update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return true;
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

  taskDrawerOwnerIdentity(row, path) {
    try {
      return typeof this.taskReqOwnerIdentity === "function" ? this.taskReqOwnerIdentity(row, path) : null;
    } catch (error) {
      return null;
    }
  }

  taskDrawerTypeAttrs(row, path) {
    try {
      const identity = this.taskDrawerOwnerIdentity(row, path);
      return typeof this.taskReqTypeAttrs === "function" ? this.taskReqTypeAttrs(identity) : {};
    } catch (error) {
      return {};
    }
  }

  taskDrawerLabel(row) {
    try {
      const noun = row.count === 1 ? "note" : "notes";
      return `Drawer · ${row.title} · ${row.count} ${noun} · in ${row.ownerName || "Task"}`;
    } catch (error) {
      return "Task drawer";
    }
  }

  buildTaskDrawerDecorations(view) {
    try {
      if (!this.taskDrawerMarksActive || !this.taskDrawerMarksEnabled || !view || !view.state || !view.state.doc
        || !Decoration || typeof Decoration.line !== "function" || !RangeSetBuilder
        || !editorInfoField || !editorLivePreviewField) return Decoration && Decoration.none ? Decoration.none : null;
      let live = false;
      let info = null;
      try {
        live = view.state.field(editorLivePreviewField) === true;
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      const doc = view.state.doc;
      if (!live || !path || !doc || typeof doc.lineAt !== "function") return Decoration.none;
      const rows = taskDrawerForestForDoc(doc);
      if (!rows.length) return Decoration.none;
      const byLine = new Map(rows.map((row) => [row.lineIndex, row]));
      const builder = new RangeSetBuilder();
      const seen = new Set();
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      for (const range of view.visibleRanges || []) {
        try {
          if (!range || typeof range.from !== "number") continue;
          let pos = Math.max(0, range.from);
          const end = Math.min(typeof range.to === "number" ? range.to : docLength, docLength);
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            const line = doc.lineAt(pos);
            if (!line || typeof line.text !== "string") break;
            const row = byLine.get(line.number - 1);
            if (row && !seen.has(row.lineIndex)) {
              seen.add(row.lineIndex);
              const label = this.taskDrawerLabel(row);
              builder.add(line.from, line.from, Decoration.line({ attributes: {
                "data-bob-drawer": "true",
                "data-bob-drawer-key": row.key,
                "data-bob-drawer-count": String(row.count),
                "data-bob-drawer-empty": String(row.empty),
                "data-bob-drawer-owner-state": row.ownerState,
                title: label,
                "aria-label": label,
                ...this.taskDrawerTypeAttrs(row, path),
              } }));
            }
            if (line.to >= end || line.to < pos) break;
            pos = line.to + 1;
          }
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  taskDrawerReadAttr(node, name) {
    try {
      return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
    } catch (error) {
      return null;
    }
  }

  taskDrawerSetAttr(node, name, value) {
    try {
      if (!node) return;
      if (value === null || value === undefined || value === "") node.removeAttribute(name);
      else node.setAttribute(name, String(value));
    } catch (error) {
      // Rendered attributes are best-effort.
    }
  }

  taskDrawerRenderedRows(root) {
    try {
      const rows = [];
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!node || node.nodeType !== 1) continue;
        if (String(node.tagName || node.nodeName || "").toUpperCase() === "LI") rows.push(node);
        const children = node.childNodes || [];
        for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      }
      return rows;
    } catch (error) {
      return [];
    }
  }

  taskDrawerReadingSectionLine(li, info, lines) {
    try {
      if (!info || !Array.isArray(lines)) return null;
      const dataLine = Number(this.taskDrawerReadAttr(li, "data-line"));
      if (!Number.isInteger(dataLine) || dataLine < 0) return null;
      const lineStart = Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const lineEnd = Number.isInteger(info.lineEnd) ? info.lineEnd : lineStart + lines.length - 1;
      const fileLine = lineStart + dataLine;
      const index = lines.length === lineEnd - lineStart + 1 ? fileLine - lineStart : fileLine;
      const sourceLine = lines[index];
      return typeof sourceLine === "string" ? { sourceLine, lineIndex: index } : null;
    } catch (error) {
      return null;
    }
  }

  taskDrawerClearRenderedRow(li) {
    try {
      for (const name of TASK_DRAWER_DATA_ATTRS) li.removeAttribute(name);
      const original = this.taskDrawerRenderedOriginals && this.taskDrawerRenderedOriginals.get(li);
      if (!original) return;
      for (const [name, value] of Object.entries(original)) this.taskDrawerSetAttr(li, name, value);
      this.taskDrawerRenderedOriginals.delete(li);
    } catch (error) {
      // Only drawer-owned attributes and labels are cleared.
    }
  }

  taskDrawerApplyRenderedRow(li, row, path) {
    const label = this.taskDrawerLabel(row);
    const originals = {};
    for (const name of TASK_DRAWER_MARK_ATTRS) originals[name] = this.taskDrawerReadAttr(li, name);
    this.taskDrawerRenderedOriginals.set(li, originals);
    this.taskDrawerSetAttr(li, "data-bob-drawer", "true");
    this.taskDrawerSetAttr(li, "data-bob-drawer-key", row.key);
    this.taskDrawerSetAttr(li, "data-bob-drawer-count", row.count);
    this.taskDrawerSetAttr(li, "data-bob-drawer-empty", row.empty);
    this.taskDrawerSetAttr(li, "data-bob-drawer-owner-state", row.ownerState);
    this.taskDrawerSetAttr(li, "title", label);
    this.taskDrawerSetAttr(li, "aria-label", label);
    if (typeof applyTaskTagTypeAttrs === "function") {
      applyTaskTagTypeAttrs(li, this.taskDrawerOwnerIdentity(row, path), this.inheritedTaskTypesEnabled === true);
    }
  }

  renderTaskDrawersIn(root, ctx) {
    try {
      if (!root) return;
      if (!ctx || typeof ctx.getSectionInfo !== "function") {
        for (const li of this.taskDrawerRenderedRows(root)) this.taskDrawerClearRenderedRow(li);
        return;
      }
      const path = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const sectionCache = new Map();
      for (const li of this.taskDrawerRenderedRows(root)) {
        this.taskDrawerClearRenderedRow(li);
        this.taskDrawerRenderedModels.delete(li);
        let info = null;
        try { info = ctx.getSectionInfo(li) || null; } catch (error) { info = null; }
        if (!info || typeof info.text !== "string") continue;
        const cacheKey = `${info.lineStart || 0}\0${info.lineEnd || ""}\0${info.text}`;
        let model = sectionCache.get(cacheKey);
        if (!model) {
          const lines = info.text.split(/\r?\n/);
          const rows = taskDrawerForest(info.text);
          model = { lines, byLine: new Map(rows.map((row) => [row.lineIndex, row])) };
          sectionCache.set(cacheKey, model);
        }
        const mapped = this.taskDrawerReadingSectionLine(li, info, model.lines);
        if (!mapped) continue;
        const row = model.byLine.get(mapped.lineIndex);
        if (!row) continue;
        this.taskDrawerRenderedModels.set(li, { row, path });
        if (this.taskDrawerMarksActive && this.taskDrawerMarksEnabled) this.taskDrawerApplyRenderedRow(li, row, path);
      }
    } catch (error) {
      // One bad rendered row never breaks the post-processor.
    }
  }

  taskDrawerRefreshRenderedRows(enabled = this.taskDrawerMarksEnabled) {
    try {
      for (const doc of this.markGateDocuments()) {
        if (!doc || typeof doc.querySelectorAll !== "function") continue;
        for (const li of doc.querySelectorAll("li")) {
          this.taskDrawerClearRenderedRow(li);
          const model = this.taskDrawerRenderedModels && this.taskDrawerRenderedModels.get(li);
          if (enabled && model && this.taskDrawerMarksActive !== false) {
            this.taskDrawerApplyRenderedRow(li, model.row, model.path);
          }
        }
      }
    } catch (error) {
      // Detached or partially rendered panes are best-effort.
    }
  }
}

try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      TASK_DRAWER_MARK_ATTRS,
      BobLedgerToolsTaskDrawerMarksMixin,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
