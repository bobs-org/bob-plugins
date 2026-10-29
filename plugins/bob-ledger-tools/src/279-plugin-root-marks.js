// --- Task root marks: editor, Reading view, Tasks, and toggle -------------
// One plugin mixin owns the surfaces for explicit root fields. The pure
// state/resolver/DOM contract lives in 279-plugin-root-marks-model.js.

let rootMarksRefreshEffect = null;

function ensureRootMarksRefresh() {
  try {
    if (!rootMarksRefreshEffect && StateEffect && typeof StateEffect.define === "function") {
      rootMarksRefreshEffect = StateEffect.define({});
    }
    return rootMarksRefreshEffect;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsTaskRootMarksMixin {
  setupTaskRootMarks() {
    try {
      this.taskRootMarksEnabled = true;
      this.applyMarkGateClass("bob-root-marks", true);
      this.registerMarkGatePopoutSync("bob-root-marks", () => this.taskRootMarksEnabled);
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "toggle-root-marks",
          name: "Toggle root marks",
          callback: () => this.toggleTaskRootMarks(),
        });
      }
      const extension = this.createRootMarkExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      this.rootMarkEnsureRenderedEvents();
      this.rootMarkWireRefreshEvents();
      return true;
    } catch (error) {
      return false;
    }
  }

  rootMarkSource(line) {
    try {
      if (typeof line !== "string" || !line) return null;
      if (typeof freshnessTaskStatus === "function" && freshnessTaskStatus(line) === null) return null;
      const state = rootMarkFieldState(line);
      if (state.state !== "set" && state.state !== "repair") return null;
      const field = state.fields[0];
      return {
        state: state.state,
        repair: state.repair || null,
        raw: field && typeof field.value === "string" ? field.value.trim() : "",
        fieldStart: Number(field && field.start),
        fieldEnd: Number(field && field.end),
        foldSpace: Boolean(field && field.start > 0 && line[field.start - 1] === " "),
      };
    } catch (error) {
      return null;
    }
  }

  rootMarkContext(sourcePath) {
    return {
      sourcePath: String(sourcePath || ""),
      metadataCache: this.app && this.app.metadataCache,
      vault: this.app && this.app.vault,
    };
  }

  rootMarkResolveModel(line, sourcePath) {
    return rootMarkModel(line, this.rootMarkContext(sourcePath));
  }

  createRootMarkExtension() {
    try {
      if (!ViewPlugin || !Decoration || !WidgetType || !RangeSetBuilder || !RootMarkWidget) return null;
      if (typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") return null;
      const plugin = this;
      class RootMarkViewPlugin {
        constructor(view) {
          this.view = view;
          this.decorations = plugin.buildRootMarkDecorations(view);
        }
        update(update) {
          try {
            if (plugin.rootMarkShouldRebuild(update)) this.decorations = plugin.buildRootMarkDecorations(update.view);
          } catch (error) {
            // Keep the last valid decorations on one bad update.
          }
          this.view = update && update.view ? update.view : this.view;
        }
      }
      return Prec.highest(ViewPlugin.fromClass(RootMarkViewPlugin, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  rootMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const effects = (update.transactions || []).flatMap((transaction) => {
        const list = transaction && transaction.effects;
        return Array.isArray(list) ? list : list ? [list] : [];
      });
      const refresh = ensureRootMarksRefresh();
      return Boolean(refresh && effects.some((effect) => effect === refresh || (effect && typeof effect.is === "function" && effect.is(refresh))));
    } catch (error) {
      return false;
    }
  }

  buildRootMarkDecorations(view) {
    try {
      if (!this.taskRootMarksEnabled || !view || !view.state || !view.visibleRanges || !RangeSetBuilder || !Decoration) return Decoration.none;
      if (editorLivePreviewField) {
        try { if (!view.state.field(editorLivePreviewField)) return Decoration.none; } catch (error) { return Decoration.none; }
      }
      const info = editorInfoField ? view.state.field(editorInfoField, false) : null;
      const sourcePath = info && info.file && info.file.path ? info.file.path : "";
      const doc = view.state.doc;
      const builder = new RangeSetBuilder();
      const selection = view.state.selection && view.state.selection.ranges ? view.state.selection.ranges : [];
      const tree = typeof syntaxTree === "function" ? syntaxTree(view.state) : null;
      for (const range of view.visibleRanges) {
        let pos = range.from;
        while (pos <= range.to) {
          const line = doc.lineAt(pos);
          const source = this.rootMarkSource(line.text);
          if (source) {
            const model = this.rootMarkResolveModel(line.text, sourcePath);
            if (model) {
              let fold = dateMarkFoldLength(line.text, source.fieldStart, dateMarkContentStart(line.text));
              fold = dateMarkSelectionFold(line.from + source.fieldStart, line.from + source.fieldEnd, fold, selection);
              let inCode = false;
              try { inCode = Boolean(tree && freshnessMarkPosInCode(tree, line.from + source.fieldStart)); } catch (error) {}
              if (fold !== null && !inCode) {
                const widget = new RootMarkWidget(model, fold, this.app);
                builder.add(line.from + source.fieldStart - fold, line.from + source.fieldEnd, Decoration.replace({ widget }));
              }
            }
          }
          if (line.to >= range.to) break;
          pos = line.to + 1;
        }
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  rootMarkWireRefreshEvents() {
    try {
      if (this.rootMarkRefreshWired) return;
      this.rootMarkRefreshWired = true;
      const cache = this.app && this.app.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(cache.on("changed", () => this.scheduleRootMarkRefresh()));
        this.registerEvent(cache.on("resolved", () => this.scheduleRootMarkRefresh()));
      }
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(workspace.on("layout-change", () => this.rootMarkEnsureRenderedEvents()));
      }
    } catch (error) {
      // Cache notifications are best-effort.
    }
  }

  scheduleRootMarkRefresh() {
    try {
      if (this.rootMarkRefreshTimer) return;
      this.rootMarkRefreshTimer = setTimeout(() => {
        this.rootMarkRefreshTimer = null;
        this.refreshRootMarks();
      }, 40);
    } catch (error) {
      this.refreshRootMarks();
    }
  }

  refreshRootMarks() {
    try {
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function" ? workspace.getLeavesOfType("markdown") || [] : [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          const refresh = ensureRootMarksRefresh();
          if (refresh && cm && typeof cm.dispatch === "function") cm.dispatch({ effects: refresh.of(null) });
          const container = leaf && leaf.view && leaf.view.containerEl;
          const file = leaf && leaf.view && leaf.view.file;
          if (container) {
            this.rootMarkRestoreHosts(container);
            this.renderRootMarksIn(container, { sourcePath: file && file.path ? file.path : "" });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Re-render is best-effort.
    }
  }

  rootMarkRows(el) {
    try {
      if (!el) return [];
      const rows = [];
      if (taskThemeLiIsTask(el) || taskThemeHasClass(el, "plugin-tasks-list-item")) rows.push(el);
      if (typeof el.querySelectorAll === "function") {
        for (const row of el.querySelectorAll("li.task-list-item, li.plugin-tasks-list-item")) {
          if (!rows.includes(row)) rows.push(row);
        }
      }
      return rows;
    } catch (error) {
      return [];
    }
  }

  renderRootMarksIn(el, ctx) {
    try {
      if (!this.taskRootMarksEnabled || !el || !el.ownerDocument) return false;
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const rows = this.rootMarkRows(el);
      for (const row of rows) {
        try {
          if (taskThemeHasClass(row, "plugin-tasks-list-item") || taskThemeQueryAncestor(row, null)) {
            this.scheduleRootMarkRow(row, ctx);
          } else {
            this.decorateRootMarkRow(row, ctx, sourcePath);
          }
        } catch (error) {
          continue;
        }
      }
      return rows.length > 0;
    } catch (error) {
      return false;
    }
  }

  scheduleRootMarkRow(row, ctx) {
    try {
      if (!Array.isArray(this.rootMarkQueue)) this.rootMarkQueue = [];
      this.rootMarkQueue.push({ row, ctx: ctx || null, tries: 0 });
      if (this.rootMarkFramePending) return;
      this.rootMarkFramePending = true;
      const run = () => this.runRootMarkFrame();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 16);
    } catch (error) {
      this.rootMarkFramePending = false;
    }
  }

  runRootMarkFrame() {
    try {
      this.rootMarkFramePending = false;
      const queue = Array.isArray(this.rootMarkQueue) ? this.rootMarkQueue.splice(0, 100) : [];
      const retry = [];
      for (const item of queue) {
        const row = item && item.row;
        if (!row) continue;
        if (row.isConnected === false && item.tries < 3) {
          item.tries += 1;
          retry.push(item);
          continue;
        }
        const ctx = item.ctx || {};
        const origin = taskThemeOriginFromContext(row, row, ctx, this.app && this.app.metadataCache);
        this.decorateRootMarkRow(row, ctx, origin && origin.path ? origin.path : ctx.sourcePath || "");
      }
      this.rootMarkQueue = (this.rootMarkQueue || []).concat(retry);
      if (this.rootMarkQueue.length > 0) {
        this.rootMarkFramePending = true;
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => this.runRootMarkFrame());
        else setTimeout(() => this.runRootMarkFrame(), 16);
      }
    } catch (error) {
      this.rootMarkFramePending = false;
    }
  }

  decorateRootMarkRow(row, ctx, sourcePath) {
    try {
      if (!row || typeof row.querySelectorAll !== "function") return false;
      if (row.querySelector(".bob-root-mark-host")) return false;
      const metadataCache = this.app && this.app.metadataCache;
      const origin = taskThemeOriginFromContext(row, row, ctx || {}, metadataCache);
      const taskPath = origin && origin.path ? origin.path : sourcePath;
      const text = this.rootMarkOwnTaskText(row);
      const state = rootMarkFieldState(text);
      if (state.state === "set" || state.state === "repair") {
        const model = this.rootMarkResolveModel(text, taskPath);
        const field = state.fields[0];
        if (model && field) return this.rootMarkReplaceTextRange(row, text, field, model);
      }
      const nativeFields = Array.from(row.querySelectorAll(".dataview.inline-field"));
      for (const node of nativeFields) {
        if (taskThemeNearestLi(node, row) && taskThemeNearestLi(node, row) !== row) continue;
        if (!this.rootMarkIsRootInlineField(node)) continue;
        const value = this.rootMarkInlineValue(node);
        const synthetic = `- [ ] #task [root:: ${value}]`;
        const model = this.rootMarkResolveModel(synthetic, taskPath);
        if (model) return this.rootMarkWrapNativeField(node, model);
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  rootMarkOwnTaskText(row) {
    try {
      const doc = row && row.ownerDocument;
      if (!doc || typeof doc.createTreeWalker !== "function") return String(taskThemeNodeText(row) || "");
      const walker = doc.createTreeWalker(row, 4);
      let output = "";
      let node = null;
      while ((node = walker.nextNode())) {
        const nearest = taskThemeNearestLi(node, row);
        if (nearest && nearest !== row) continue;
        if (taskThemeExcludedAncestor(node, row)) continue;
        output += String(node.nodeValue || "");
      }
      return output;
    } catch (error) {
      return String(taskThemeNodeText(row) || "");
    }
  }

  rootMarkReplaceTextRange(row, line, field, model) {
    try {
      const walker = row.ownerDocument.createTreeWalker(row, 4);
      let node = null;
      let offset = 0;
      while ((node = walker.nextNode())) {
        const nearest = taskThemeNearestLi(node, row);
        if ((nearest && nearest !== row) || taskThemeExcludedAncestor(node, row)) continue;
        const value = String(node.nodeValue || "");
        const start = value.search(/\[(?:root)\s*::|\((?:root)\s*::/u);
        if (start >= 0) {
          const match = /\[(?:root)\s*::[^\]]*\]|\((?:root)\s*::[^)]*\)/u.exec(value.slice(start));
          if (!match) continue;
          const localStart = start;
          const localEnd = start + match[0].length;
          const localField = { ...field, start: localStart, end: localEnd };
          return this.rootMarkWrapTextNode(node, localField, model);
        }
        offset += value.length;
      }
      // Some renderers keep the inline field as a single native node.
      const nativeFields = Array.from(row.querySelectorAll(".dataview.inline-field"));
      for (const native of nativeFields) {
        if (taskThemeNearestLi(native, row) && taskThemeNearestLi(native, row) !== row) continue;
        if (this.rootMarkIsRootInlineField(native)) return this.rootMarkWrapNativeField(native, model);
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  rootMarkWrapTextNode(node, field, model) {
    try {
      const parent = node && node.parentNode;
      const doc = node && node.ownerDocument;
      if (!parent || !doc || !doc.createElement) return false;
      const text = String(node.nodeValue || "");
      const start = Math.max(0, Number(field.start) || 0);
      const end = Math.min(text.length, Number(field.end) || 0);
      if (end <= start) return false;
      const host = doc.createElement("span");
      host.setAttribute("class", "bob-root-mark-host");
      const native = doc.createElement("span");
      native.setAttribute("class", "bob-root-mark-native");
      native.appendChild(doc.createTextNode(text.slice(start, end)));
      const mark = buildRootMarkElement(doc, model, {});
      if (!mark) return false;
      host.appendChild(native);
      host.appendChild(mark);
      if (start > 0) parent.insertBefore(doc.createTextNode(text.slice(0, start)), node);
      parent.insertBefore(host, node);
      if (end < text.length) parent.insertBefore(doc.createTextNode(text.slice(end)), node);
      parent.removeChild(node);
      return true;
    } catch (error) {
      return false;
    }
  }

  rootMarkIsRootInlineField(node) {
    try {
      if (!taskThemeHasClass(node, "dataview") || !taskThemeHasClass(node, "inline-field")) return false;
      const stack = taskThemeChildList(node);
      let guard = 0;
      while (stack.length && guard++ < 500) {
        const current = stack.pop();
        const key = String(taskThemeAttr(current, "data-dv-norm-key") || taskThemeAttr(current, "data-dv-key") || "").toLowerCase();
        if (key === "root") return true;
        stack.push(...taskThemeChildList(current));
      }
      return String(taskThemeAttr(node, "data-dv-norm-key") || "").toLowerCase() === "root";
    } catch (error) {
      return false;
    }
  }

  rootMarkInlineValue(node) {
    try {
      if (typeof node.querySelector === "function") {
        const value = node.querySelector(".inline-field-value, [data-dv-norm-key='root']");
        if (value && value.textContent) return String(value.textContent).replace(/^\s*root\s*::?\s*/i, "").trim();
      }
      return String(taskThemeNodeText(node) || "").replace(/^\s*root\s*::?\s*/i, "").trim();
    } catch (error) {
      return "";
    }
  }

  rootMarkWrapNativeField(node, model) {
    try {
      const parent = node && node.parentNode;
      const doc = node && node.ownerDocument;
      if (!parent || !doc || !doc.createElement) return false;
      const host = doc.createElement("span");
      host.setAttribute("class", "bob-root-mark-host");
      const native = doc.createElement("span");
      native.setAttribute("class", "bob-root-mark-native");
      const mark = buildRootMarkElement(doc, model, {});
      if (!mark) return false;
      parent.insertBefore(host, node);
      host.appendChild(native);
      native.appendChild(node);
      host.appendChild(mark);
      return true;
    } catch (error) {
      return false;
    }
  }

  rootMarkRestoreHosts(root) {
    try {
      if (!root || typeof root.querySelectorAll !== "function") return;
      for (const host of Array.from(root.querySelectorAll(".bob-root-mark-host"))) {
        const parent = host.parentNode;
        const native = host.querySelector(".bob-root-mark-native");
        if (!parent || !native) continue;
        while (native.firstChild) parent.insertBefore(native.firstChild, host);
        parent.removeChild(host);
      }
    } catch (error) {
      // Restoration is best-effort per rendered host.
    }
  }

  rootMarkDocuments() {
    try {
      if (typeof this.markGateDocuments === "function") return this.markGateDocuments();
      return typeof document !== "undefined" && document ? [document] : [];
    } catch (error) {
      return [];
    }
  }

  rootMarkEnsureRenderedEvents() {
    try {
      const docs = this.rootMarkDocuments();
      if (!Array.isArray(this.rootMarkEventRoots)) this.rootMarkEventRoots = [];
      for (const doc of Array.isArray(docs) ? docs : []) {
        const root = doc && (doc.body || doc.documentElement || doc);
        if (!root || typeof root.addEventListener !== "function" || root.__bobRootMarkClick) continue;
        const onClick = (event) => {
          try {
            let mark = event && event.target ? event.target : null;
            let guard = 0;
            while (mark && guard++ < 20 && !taskThemeHasClass(mark, "bob-root-mark")) mark = mark.parentNode || null;
            if (!mark) return;
            const target = taskThemeAttr(mark, "data-root-target");
            const source = taskThemeAttr(mark, "data-root-source") || "";
            if (event && (event.metaKey || event.ctrlKey)) {
              if (typeof event.preventDefault === "function") event.preventDefault();
              const workspace = this.app && this.app.workspace;
              if (workspace && typeof workspace.openLinkText === "function" && target) workspace.openLinkText(target, source, true);
              return;
            }
            // In rendered views a click reveals the raw field in place. The
            // editable Live Preview widget places its own caret in the field.
            const host = mark.parentNode;
            const native = host && typeof host.querySelector === "function" ? host.querySelector(".bob-root-mark-native") : null;
            const parent = host && host.parentNode;
            if (!native || !parent) return;
            while (native.firstChild) parent.insertBefore(native.firstChild, host);
            parent.removeChild(host);
          } catch (error) {
            // Rendered clicks are best-effort.
          }
        };
        root.addEventListener("click", onClick);
        root.__bobRootMarkClick = onClick;
        this.rootMarkEventRoots.push({ root, onClick });
      }
    } catch (error) {
      // Rendered event delegation is best-effort.
    }
  }

  rootMarkTeardownRenderedEvents() {
    try {
      for (const entry of Array.isArray(this.rootMarkEventRoots) ? this.rootMarkEventRoots : []) {
        const root = entry && entry.root;
        const onClick = entry && entry.onClick;
        if (root && typeof root.removeEventListener === "function" && onClick) root.removeEventListener("click", onClick);
        if (root) root.__bobRootMarkClick = null;
      }
      this.rootMarkEventRoots = [];
    } catch (error) {
      this.rootMarkEventRoots = [];
    }
  }

  toggleTaskRootMarks() {
    try {
      this.taskRootMarksEnabled = !this.taskRootMarksEnabled;
      this.applyMarkGateClass("bob-root-marks", this.taskRootMarksEnabled);
      this.refreshRootMarks();
      try { new Notice(this.taskRootMarksEnabled ? "Root marks on" : "Root marks off"); } catch (error) {}
      return this.taskRootMarksEnabled;
    } catch (error) {
      return Boolean(this.taskRootMarksEnabled);
    }
  }

  teardownTaskRootMarks() {
    try {
      this.taskRootMarksEnabled = false;
      if (this.rootMarkRefreshTimer) clearTimeout(this.rootMarkRefreshTimer);
      this.rootMarkRefreshTimer = null;
      this.rootMarkQueue = [];
      this.rootMarkFramePending = false;
      this.rootMarkTeardownRenderedEvents();
      for (const doc of this.rootMarkDocuments()) {
        const root = doc && (doc.body || doc.documentElement || doc);
        this.rootMarkRestoreHosts(root);
      }
      this.applyMarkGateClass("bob-root-marks", false);
    } catch (error) {
      // Teardown is best-effort.
    }
  }
}
