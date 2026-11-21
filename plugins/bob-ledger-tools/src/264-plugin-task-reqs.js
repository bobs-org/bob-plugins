// --- Task requirements: Live Preview and Reading view -------------------
// Display-only twin of bob-cli's task-requirement recognizer. The checkbox
// stays in the DOM; attributes and CSS draw the depth run in its place.

const TASK_REQ_TOOLTIP_PREFIX = "Requirement";
const TASK_REQ_DOC_FORESTS = new WeakMap();

class BobLedgerToolsTaskReqMarksMixin {
  setupTaskReqMarks() {
    try {
      this.taskReqCheckboxesByView = new Map();
      this.taskReqCheckboxOriginals = new WeakMap();
      this.taskReqDestroyedViews = new WeakSet();
      this.taskReqRenderedOriginals = new WeakMap();
      this.taskReqRenderedInputOriginals = new WeakMap();
      const extension = this.createTaskReqMarkExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderTaskReqsIn(el, ctx),
          51,
        );
      }
      if (typeof this.register === "function") {
        this.register(() => this.taskReqRestoreCheckboxInputs());
      }
    } catch (error) {
      // Requirement marks never break plugin startup.
    }
  }

  taskReqMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          typeof taskReqForest === "function",
      );
    } catch (error) {
      return false;
    }
  }

  createTaskReqMarkExtension() {
    try {
      if (
        !this.taskReqMarksAvailable() ||
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const RequirementMarkPlugin = class {
        constructor(view) {
          this.view = view;
          this.decorations = plugin.buildTaskReqDecorations(view);
          plugin.taskReqScheduleCheckboxInputSync(view);
        }

        update(update) {
          try {
            if (plugin.taskReqMarkShouldRebuild(update)) {
              this.decorations = plugin.buildTaskReqDecorations(update.view);
              plugin.taskReqScheduleCheckboxInputSync(update.view);
            }
          } catch (error) {
            // Keep the last valid decoration set if a refresh fails.
          }
        }

        destroy() {
          plugin.taskReqDestroyedViews.add(this.view);
          plugin.taskReqRestoreCheckboxInputs(this.view);
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(RequirementMarkPlugin, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  taskReqMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      try {
        const refresh = ensureTaskTagMarksRefresh();
        for (const transaction of update.transactions || []) {
          const effects = transaction && transaction.effects;
          for (const effect of !effects ? [] : Array.isArray(effects) ? effects : [effects]) {
            if (effect && (effect === refresh || (refresh && typeof effect.is === "function" && effect.is(refresh)))) {
              return true;
            }
          }
        }
      } catch (error) {
        // Effect inspection is best-effort.
      }
      try {
        if (editorLivePreviewField && update.startState && update.state) {
          if (update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return true;
        }
        if (editorInfoField && update.startState && update.state) {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          const beforePath = before && before.file ? before.file.path : null;
          const afterPath = after && after.file ? after.file.path : null;
          if (beforePath !== afterPath) return true;
        }
      } catch (error) {
        // State fields are best-effort.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  taskReqRowsForDoc(doc) {
    try {
      if (!doc || (typeof doc !== "object" && typeof doc !== "function")) return [];
      const cached = TASK_REQ_DOC_FORESTS.get(doc);
      if (cached) return cached;
      const source = typeof doc.toString === "function" ? doc.toString() : "";
      const rows = taskReqForest(source);
      TASK_REQ_DOC_FORESTS.set(doc, rows);
      return rows;
    } catch (error) {
      return [];
    }
  }

  taskReqTooltip(row, rows) {
    try {
      if (!row) return "";
      const state = String(row.state || "pending");
      const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
      let text = `${TASK_REQ_TOOLTIP_PREFIX} · level ${row.depth} of “${row.ownerName || "Task"}” · ${stateLabel}`;
      if (state === "excluded" && Number.isInteger(row.excludedBy)) {
        const ancestor = (rows || []).find((candidate) => candidate.line === row.excludedBy);
        if (ancestor) text += ` · goes with “${ancestor.text || "requirement"}”`;
      }
      return text + "\n" + TASK_REQ_TEACHING_COPY;
    } catch (error) {
      return TASK_REQ_TOOLTIP_PREFIX + "\n" + TASK_REQ_TEACHING_COPY;
    }
  }

  taskReqTypeAttrs(identity) {
    try {
      const attributes = {};
      const sink = {
        setAttribute: (name, value) => { attributes[name] = String(value); },
        removeAttribute: (name) => { delete attributes[name]; },
      };
      if (typeof applyTaskTagTypeAttrs === "function") {
        applyTaskTagTypeAttrs(sink, identity, true);
      }
      return attributes;
    } catch (error) {
      return {};
    }
  }

  taskReqOwnerIdentity(row, path) {
    try {
      if (!row || typeof this.taskTagIdentityForLine !== "function") return null;
      return this.taskTagIdentityForLine(row.ownerText, path);
    } catch (error) {
      return null;
    }
  }

  taskReqSelectionTouchesMarker(selectionRanges, lineFrom, row) {
    try {
      const from = lineFrom + row.markerFrom;
      const to = lineFrom + row.markerTo;
      for (const selection of selectionRanges || []) {
        if (selection && selection.from <= to && selection.to >= from) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildTaskReqDecorations(view) {
    try {
      if (
        !this.taskTagMarksEnabled ||
        !view ||
        !view.state ||
        !view.state.doc ||
        !Decoration ||
        typeof Decoration.line !== "function" ||
        !RangeSetBuilder ||
        !editorInfoField ||
        !editorLivePreviewField
      ) {
        return Decoration && Decoration.none ? Decoration.none : null;
      }
      let live = false;
      let info = null;
      try {
        live = view.state.field(editorLivePreviewField) === true;
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!live || !path) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      const rows = this.taskReqRowsForDoc(doc);
      if (!rows.length) return Decoration.none;
      const byLine = new Map(rows.map((row) => [row.lineIndex, row]));
      const selections = view.state.selection && view.state.selection.ranges || [];
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
              if (!this.taskReqSelectionTouchesMarker(selections, line.from, row)) {
                const tooltip = this.taskReqTooltip(row, rows);
                const identity = this.taskReqOwnerIdentity(row, path);
                const attributes = {
                  "data-bob-req": "true",
                  "data-bob-req-depth": String(row.depth),
                  "data-bob-req-state": row.state,
                  "data-bob-req-label": tooltip,
                  title: tooltip,
                  ...this.taskReqTypeAttrs(identity),
                };
                builder.add(line.from, line.from, Decoration.line({ attributes }));
              }
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
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  taskReqReadAttr(node, name) {
    try {
      return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
    } catch (error) {
      return null;
    }
  }

  taskReqSetAttr(node, name, value) {
    try {
      if (node && typeof node.setAttribute === "function") node.setAttribute(name, value);
    } catch (error) {
      // Attribute writes are best-effort.
    }
  }

  taskReqRestoreCheckboxInputs() {
    try {
      const views = arguments.length ? [arguments[0]] : Array.from(this.taskReqCheckboxesByView?.keys?.() || []);
      for (const view of views) {
        const inputs = this.taskReqCheckboxesByView && this.taskReqCheckboxesByView.get(view);
        for (const input of inputs || []) {
          const original = this.taskReqCheckboxOriginals && this.taskReqCheckboxOriginals.get(input);
          if (!original) continue;
          for (const [name, value] of Object.entries(original)) {
            if (value === null || value === undefined) {
              if (typeof input.removeAttribute === "function") input.removeAttribute(name);
            } else {
              this.taskReqSetAttr(input, name, value);
            }
          }
        }
        if (this.taskReqCheckboxesByView) this.taskReqCheckboxesByView.delete(view);
      }
    } catch (error) {
      // Teardown and state restoration are best-effort.
    }
  }

  taskReqScheduleCheckboxInputSync(view) {
    try {
      const sync = () => {
        if (this.taskReqDestroyedViews && this.taskReqDestroyedViews.has(view)) return;
        this.taskReqAnnotateCheckboxInputs(view);
      };
      if (typeof queueMicrotask === "function") queueMicrotask(sync);
      else Promise.resolve().then(sync);
    } catch (error) {
      this.taskReqAnnotateCheckboxInputs(view);
    }
  }

  taskReqAnnotateCheckboxInputs(view) {
    try {
      this.taskReqRestoreCheckboxInputs(view);
      const root = view && view.dom;
      if (!root || typeof root.querySelectorAll !== "function") return;
      const inputs = root.querySelectorAll(".HyperMD-task-line[data-bob-req] input.task-list-item-checkbox");
      const owned = new Set();
      for (const input of inputs || []) {
        const line = input.parentNode;
        const label = this.taskReqReadAttr(line, "data-bob-req-label");
        if (!label) continue;
        this.taskReqCheckboxOriginals.set(input, {
          title: this.taskReqReadAttr(input, "title"),
          "aria-label": this.taskReqReadAttr(input, "aria-label"),
          "data-tooltip-position": this.taskReqReadAttr(input, "data-tooltip-position"),
        });
        this.taskReqSetAttr(input, "title", label);
        this.taskReqSetAttr(input, "aria-label", label);
        this.taskReqSetAttr(input, "data-tooltip-position", "top");
        owned.add(input);
      }
      if (this.taskReqCheckboxesByView) this.taskReqCheckboxesByView.set(view, owned);
    } catch (error) {
      // Checkbox labels are best-effort; line attributes remain available.
    }
  }

  taskReqRenderedRows(root) {
    try {
      const rows = [];
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!node || node.nodeType !== 1) continue;
        const isTaskRow = String(node.tagName || node.nodeName || "").toUpperCase() === "LI" &&
          (node.classList && typeof node.classList.contains === "function"
            ? node.classList.contains("task-list-item")
            : String(node.className || "").split(/\s+/).includes("task-list-item"));
        if (isTaskRow) rows.push(node);
        const children = node.childNodes || [];
        for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      }
      return rows;
    } catch (error) {
      return [];
    }
  }

  taskReqReadingSectionLine(li, info, lines) {
    try {
      if (!info || !Array.isArray(lines)) return null;
      const status = this.taskReqReadAttr(li, "data-task");
      if (status === null) return null;
      const raw = this.taskReqReadAttr(li, "data-line");
      const dataLine = Number(raw);
      if (!Number.isInteger(dataLine) || dataLine < 0) return null;
      const lineStart = Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const lineEnd = Number.isInteger(info.lineEnd) ? info.lineEnd : lineStart + lines.length - 1;
      const fileLine = lineStart + dataLine;
      const index = lines.length === lineEnd - lineStart + 1 ? fileLine - lineStart : fileLine;
      const sourceLine = lines[index];
      const item = taskReqListItem(sourceLine);
      const checkbox = item && taskReqParseCheckbox(item.body);
      if (!checkbox || checkbox.mark !== String(status)) return null;
      return { sourceLine, lineIndex: index };
    } catch (error) {
      return null;
    }
  }

  taskReqClearRenderedRow(li) {
    try {
      for (const name of [
        "data-bob-req",
        "data-bob-req-depth",
        "data-bob-req-state",
        "data-bob-req-label",
      ]) {
        if (li && typeof li.removeAttribute === "function") li.removeAttribute(name);
      }
      const original = this.taskReqRenderedOriginals && this.taskReqRenderedOriginals.get(li);
      if (original) {
        for (const [name, value] of Object.entries(original)) {
          if (value === null || value === undefined) li.removeAttribute(name);
          else li.setAttribute(name, value);
        }
        this.taskReqRenderedOriginals.delete(li);
      }
      const input = li && typeof li.querySelector === "function" ? li.querySelector("input.task-list-item-checkbox") : null;
      const inputOriginal = input && this.taskReqRenderedInputOriginals && this.taskReqRenderedInputOriginals.get(input);
      if (input && inputOriginal) {
        for (const [name, value] of Object.entries(inputOriginal)) {
          if (value === null || value === undefined) input.removeAttribute(name);
          else input.setAttribute(name, value);
        }
        this.taskReqRenderedInputOriginals.delete(input);
      }
    } catch (error) {
      // Clearing stale attributes is best-effort.
    }
  }

  renderTaskReqsIn(root, ctx) {
    try {
      if (!this.taskTagMarksEnabled || !root || !ctx || typeof ctx.getSectionInfo !== "function") return;
      const path = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const inheritedEnabled = true;
      const sectionCache = new Map();
      for (const li of this.taskReqRenderedRows(root)) {
        this.taskReqClearRenderedRow(li);
        let info = null;
        try { info = ctx.getSectionInfo(li) || null; } catch (error) { info = null; }
        if (!info || typeof info.text !== "string") continue;
        const cacheKey = `${info.lineStart || 0}\0${info.lineEnd || ""}\0${info.text}`;
        let model = sectionCache.get(cacheKey);
        if (!model) {
          const lines = info.text.split(/\r?\n/);
          const rows = taskReqForest(info.text);
          model = { lines, rows, byLine: new Map(rows.map((row) => [row.lineIndex, row])) };
          sectionCache.set(cacheKey, model);
        }
        const mapped = this.taskReqReadingSectionLine(li, info, model.lines);
        if (!mapped) continue;
        const row = model.byLine.get(mapped.lineIndex);
        if (!row) continue;
        const tooltip = this.taskReqTooltip(row, model.rows);
        const identity = this.taskReqOwnerIdentity(row, path);
        this.taskReqRenderedOriginals.set(li, {
          title: this.taskReqReadAttr(li, "title"),
          "data-bob-type": this.taskReqReadAttr(li, "data-bob-type"),
          "data-bob-type-hue": this.taskReqReadAttr(li, "data-bob-type-hue"),
          "data-bob-type-state": this.taskReqReadAttr(li, "data-bob-type-state"),
        });
        this.taskReqSetAttr(li, "data-bob-req", "true");
        this.taskReqSetAttr(li, "data-bob-req-depth", String(row.depth));
        this.taskReqSetAttr(li, "data-bob-req-state", row.state);
        this.taskReqSetAttr(li, "data-bob-req-label", tooltip);
        this.taskReqSetAttr(li, "title", tooltip);
        if (typeof applyTaskTagTypeAttrs === "function") {
          applyTaskTagTypeAttrs(li, identity, inheritedEnabled);
        }
        const input = li && typeof li.querySelector === "function" ? li.querySelector("input.task-list-item-checkbox") : null;
        if (input) {
          this.taskReqRenderedInputOriginals.set(input, {
            title: this.taskReqReadAttr(input, "title"),
            "aria-label": this.taskReqReadAttr(input, "aria-label"),
            "data-tooltip-position": this.taskReqReadAttr(input, "data-tooltip-position"),
          });
          this.taskReqSetAttr(input, "title", tooltip);
          this.taskReqSetAttr(input, "aria-label", tooltip);
          this.taskReqSetAttr(input, "data-tooltip-position", "top");
        }
      }
    } catch (error) {
      // A bad rendered row never breaks the post-processor.
    }
  }
}
