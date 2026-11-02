// --- Blocked-reason marks: Live Preview decorations and lazy tooltips ------
class BobLedgerToolsBlockMarksEditorMixin {
  blockMarksEditorAvailable() {
    try {
      return Boolean(
        ViewPlugin && Decoration && RangeSetBuilder && StateEffect &&
          typeof StateEffect.define === "function" && editorInfoField &&
          editorLivePreviewField && typeof taskTagMarkTokenRanges === "function" &&
          typeof blockMarkModel === "function",
      );
    } catch (error) {
      return false;
    }
  }

  createBlockMarkExtension() {
    try {
      if (
        !this.blockMarksEditorAvailable() || !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" || !Prec ||
        typeof Prec.highest !== "function"
      ) return null;
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          this.view = view;
          this.onMouseOver = (event) => plugin.handleBlockMarkMouseOver(view, event);
          try {
            if (view && view.dom && typeof view.dom.addEventListener === "function") {
              view.dom.addEventListener("mouseover", this.onMouseOver, true);
            }
          } catch (error) {
            // Lazy tooltip attachment is best-effort.
          }
          try {
            plugin.blockMarkEditorViews.add(view);
            plugin.registerBlockMarksResumeHooks(view);
          } catch (error) {
            // Editor tracking is best-effort.
          }
          try {
            this.decorations = plugin.buildBlockMarkDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
          try {
            plugin.scheduleBlockMarkTooltipMeasure(view);
          } catch (error) {
            // Write-pass tooltip attachment is best-effort.
          }
        }

        update(update) {
          try {
            if (plugin.blockMarkShouldRebuild(update)) {
              this.decorations = plugin.buildBlockMarkDecorations(update.view);
              plugin.refreshBlockMarkTooltipsForView(update.view);
              plugin.scheduleBlockMarkTooltipMeasure(update.view);
            }
          } catch (error) {
            // Keep the previous valid decorations on a failed rebuild.
          }
        }

        destroy() {
          try {
            if (this.view && this.view.dom && typeof this.view.dom.removeEventListener === "function") {
              this.view.dom.removeEventListener("mouseover", this.onMouseOver, true);
            }
          } catch (error) {
            // A closing editor may already have detached its DOM.
          }
          try {
            plugin.restoreBlockMarkTooltipsForView(this.view);
            plugin.blockMarkEditorViews.delete(this.view);
          } catch (error) {
            // View cleanup is best-effort.
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

  blockMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged) return true;
      try {
        const refresh = ensureBlockMarksRefresh();
        for (const transaction of update.transactions || []) {
          const effects = transaction && transaction.effects;
          for (const effect of !effects ? [] : Array.isArray(effects) ? effects : [effects]) {
            try {
              if (effect && (effect === refresh || (refresh && typeof effect.is === "function" && effect.is(refresh)))) {
                return true;
              }
            } catch (error) {
              continue;
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
        // Field comparisons are best-effort.
      }
      // Selection-only changes do not change marks or tooltip ownership.
      return false;
    } catch (error) {
      return false;
    }
  }

  blockMarkVisibleTaskTag(lineText, tree, lineFrom) {
    try {
      if (!tree || typeof tree.resolveInner !== "function") return false;
      const ranges = taskTagMarkTokenRanges(String(lineText || ""));
      for (const range of ranges) {
        try {
          if (!freshnessMarkPosInCode(tree, lineFrom + range.from)) return true;
        } catch (error) {
          continue;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  blockMarkModelForEditorLine(path, line, tree) {
    try {
      if (!line || typeof line.text !== "string" || !this.blockMarksEnabled) return null;
      if (!this.blockMarkVisibleTaskTag(line.text, tree, line.from)) return null;
      return this.blockMarkModelForLine(path, line.text);
    } catch (error) {
      return null;
    }
  }

  buildBlockMarkDecorations(view) {
    try {
      if (!this.blockMarksEnabled || !view || !view.state || !Decoration ||
          typeof Decoration.line !== "function" || !RangeSetBuilder ||
          !editorInfoField || !editorLivePreviewField) return Decoration.none;
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

      let tree = null;
      try {
        if (typeof syntaxTree === "function") tree = syntaxTree(view.state);
        else if (syntaxTree && typeof syntaxTree.resolveInner === "function") tree = syntaxTree;
      } catch (error) {
        tree = null;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      const marks = new Map();
      for (const range of view.visibleRanges || []) {
        try {
          if (!range || typeof range.from !== "number") continue;
          let pos = Math.max(0, range.from);
          const end = Math.min(typeof range.to === "number" ? range.to : docLength, docLength);
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            let line = null;
            try {
              line = doc.lineAt(pos);
            } catch (error) {
              break;
            }
            if (!line || typeof line.text !== "string") break;
            if (!marks.has(line.from)) {
              const model = this.blockMarkModelForEditorLine(path, line, tree);
              if (model) marks.set(line.from, model);
            }
            if (line.to >= end || line.to < pos) break;
            pos = line.to + 1;
          }
        } catch (error) {
          continue;
        }
      }

      const builder = new RangeSetBuilder();
      const ordered = Array.from(marks.entries()).sort((a, b) => a[0] - b[0]);
      for (const [from, model] of ordered) {
        try {
          const attributes = {
            "data-bob-block": String(model.key),
            "data-bob-block-family": String(model.family),
          };
          if (model.more) attributes["data-bob-block-more"] = String(model.more);
          builder.add(from, from, Decoration.line({ attributes }));
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration ? Decoration.none : null;
      } catch (inner) {
        return null;
      }
    }
  }

  blockMarkEditorRowForInput(view, input) {
    try {
      if (!view || !view.dom || !input) return null;
      let row = null;
      for (let node = input; node && node !== view.dom; node = node.parentElement) {
        try {
          if (node.classList && node.classList.contains("HyperMD-task-line")) {
            row = node;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      if (!row) return null;
      let pos = null;
      try {
        if (typeof view.posAtDOM === "function") pos = view.posAtDOM(input, 0);
      } catch (error) {
        pos = null;
      }
      if (!Number.isInteger(pos)) {
        try {
          if (typeof view.posAtDOM === "function") pos = view.posAtDOM(row, 0);
        } catch (error) {
          pos = null;
        }
      }
      if (!Number.isInteger(pos) || !view.state || !view.state.doc || typeof view.state.doc.lineAt !== "function") return null;
      if (view.state.field(editorLivePreviewField) !== true) return null;
      const line = view.state.doc.lineAt(pos);
      let info = null;
      try {
        info = view.state.field(editorInfoField);
      } catch (error) {
        info = null;
      }
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      const tree = typeof syntaxTree === "function" ? syntaxTree(view.state) : null;
      return { row, line, model: this.blockMarkModelForEditorLine(path, line, tree) };
    } catch (error) {
      return null;
    }
  }

  handleBlockMarkMouseOver(view, event) {
    try {
      const input = event && event.target;
      if (!input || String(input.tagName || "").toUpperCase() !== "INPUT") return;
      let checkbox = false;
      try {
        checkbox = Boolean(input.classList && input.classList.contains("task-list-item-checkbox"));
      } catch (error) {
        checkbox = false;
      }
      if (!checkbox) return;
      const resolved = this.blockMarkEditorRowForInput(view, input);
      this.setBlockMarkTooltipInput(input, view, resolved && resolved.model);
    } catch (error) {
      // Tooltip metadata is best-effort and never changes checkbox behavior.
    }
  }

  setBlockMarkTooltipInput(input, view, model) {
    try {
      if (!input || !this.blockMarkTooltipBindings) return;
      const tooltip = model && typeof model.tooltip === "string" ? model.tooltip : "";
      if (!tooltip) {
        this.restoreBlockMarkTooltipInput(input);
        return;
      }
      let record = this.blockMarkTooltipBindings.get(input);
      if (!record) {
        record = {
          view,
          originalAria: input.getAttribute("aria-label"),
          originalPosition: input.getAttribute("data-tooltip-position"),
          appliedAria: null,
          appliedPosition: null,
        };
        this.blockMarkTooltipBindings.set(input, record);
      } else {
        record.view = view;
      }
      const currentAria = input.getAttribute("aria-label");
      const currentPosition = input.getAttribute("data-tooltip-position");
      if (record.appliedAria !== null && currentAria !== record.appliedAria) record.originalAria = currentAria;
      if (record.appliedPosition !== null && currentPosition !== record.appliedPosition) record.originalPosition = currentPosition;
      input.setAttribute("aria-label", tooltip);
      input.setAttribute("data-tooltip-position", "top");
      record.appliedAria = tooltip;
      record.appliedPosition = "top";
    } catch (error) {
      // Metadata attachment cannot interfere with the input.
    }
  }

  restoreBlockMarkTooltipInput(input) {
    try {
      const bindings = this.blockMarkTooltipBindings;
      const record = bindings instanceof Map ? bindings.get(input) : null;
      if (!record) return;
      try {
        if (input.getAttribute("aria-label") === record.appliedAria) {
          if (record.originalAria === null) input.removeAttribute("aria-label");
          else input.setAttribute("aria-label", record.originalAria);
        }
        if (input.getAttribute("data-tooltip-position") === record.appliedPosition) {
          if (record.originalPosition === null) input.removeAttribute("data-tooltip-position");
          else input.setAttribute("data-tooltip-position", record.originalPosition);
        }
      } catch (error) {
        // Detached inputs are still removed from the ownership map.
      }
      bindings.delete(input);
    } catch (error) {
      // Cleanup never throws.
    }
  }

  refreshBlockMarkTooltipsForView(view) {
    try {
      const bindings = this.blockMarkTooltipBindings;
      if (!(bindings instanceof Map)) return;
      for (const [input, record] of Array.from(bindings.entries())) {
        if (!record || record.view !== view) continue;
        const connected = typeof input.isConnected !== "boolean" || input.isConnected;
        const resolved = connected ? this.blockMarkEditorRowForInput(view, input) : null;
        this.setBlockMarkTooltipInput(input, view, resolved && resolved.model);
      }
    } catch (error) {
      // Existing tooltips are refreshed best-effort.
    }
  }

  restoreBlockMarkTooltipsForView(view) {
    try {
      const bindings = this.blockMarkTooltipBindings;
      if (!(bindings instanceof Map)) return;
      for (const [input, record] of Array.from(bindings.entries())) {
        if (record && record.view === view) this.restoreBlockMarkTooltipInput(input);
      }
    } catch (error) {
      // View cleanup is best-effort.
    }
  }

  restoreAllBlockMarkTooltips() {
    try {
      const bindings = this.blockMarkTooltipBindings;
      if (!(bindings instanceof Map)) return;
      for (const input of Array.from(bindings.keys())) this.restoreBlockMarkTooltipInput(input);
    } catch (error) {
      // Plugin cleanup is best-effort.
    }
  }

  collectBlockMarkTooltipTargets(view) {
    const found = [];
    try {
      if (!view || !view.dom || typeof view.dom.querySelectorAll !== "function") {
        return { targets: found, scanned: false };
      }
      const inputs = Array.from(view.dom.querySelectorAll("input.task-list-item-checkbox"));
      for (const input of inputs) {
        try {
          const resolved = this.blockMarkEditorRowForInput(view, input);
          found.push({ input, model: resolved && resolved.model });
        } catch (error) {
          continue;
        }
      }
      return { targets: found, scanned: true };
    } catch (error) {
      return { targets: found, scanned: false };
    }
  }

  applyBlockMarkTooltipTargets(view, collected) {
    try {
      const pack = collected && typeof collected === "object" ? collected : { targets: [], scanned: false };
      const targets = Array.isArray(pack.targets) ? pack.targets : [];
      const seen = new Set();
      for (const target of targets) {
        if (!target || !target.input) continue;
        seen.add(target.input);
        this.setBlockMarkTooltipInput(target.input, view, target.model);
      }
      if (!pack.scanned) return;
      const bindings = this.blockMarkTooltipBindings;
      if (!(bindings instanceof Map)) return;
      for (const [input, record] of Array.from(bindings.entries())) {
        if (!record || record.view !== view) continue;
        if (!seen.has(input)) this.restoreBlockMarkTooltipInput(input);
      }
    } catch (error) {
      // Write-pass application is best-effort.
    }
  }

  scheduleBlockMarkTooltipMeasure(view) {
    try {
      if (!view) return;
      if (typeof view.requestMeasure === "function") {
        const plugin = this;
        view.requestMeasure({
          read(measuredView) {
            return plugin.collectBlockMarkTooltipTargets(measuredView || view);
          },
          write(collected, measuredView) {
            plugin.applyBlockMarkTooltipTargets(measuredView || view, collected);
          },
        });
        return;
      }
      this.applyBlockMarkTooltipTargets(view, this.collectBlockMarkTooltipTargets(view));
    } catch (error) {
      // Missing requestMeasure falls back to a synchronous write.
    }
  }
}
