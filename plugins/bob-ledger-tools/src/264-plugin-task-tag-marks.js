// --- Task tag marks: Live Preview, rendered views, toggle -----------------
// `BobLedgerToolsTaskTagMarksMixin`, installed in
// `310-install-methods.js` before the priority-mark mixin. Mirrors
// `265-plugin-priority-marks.js` (setup, extension, toggle) but the
// model is trivial: every exact `#task` tag on a task line gets the
// same quiet hash glyph. Every method is synchronous and never
// throws.
class BobLedgerToolsTaskTagMarksMixin {
  setupTaskTagMarks() {
    try {
      if (typeof this.taskTagMarksEnabled !== "boolean") {
        this.taskTagMarksEnabled = true;
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.taskTagMarksEnabled) {
            document.body.classList.add("bob-task-tag-marks");
          } else {
            document.body.classList.remove("bob-task-tag-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-task-tag-marks",
            name: "Toggle task tag marks",
            callback: () => this.toggleTaskTagMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createTaskTagMarkExtension();
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
            (el, ctx) => this.renderTaskTagMarksIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Rendered-view marks are best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  taskTagMarksAvailable() {
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
          TaskTagMarkWidget &&
          RefTaskMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createTaskTagMarkExtension() {
    try {
      if (!this.taskTagMarksAvailable()) {
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
            this.decorations = plugin.buildTaskTagMarkDecorations(view);
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
            if (plugin.taskTagMarkShouldRebuild(u)) {
              this.decorations =
                plugin.buildTaskTagMarkDecorations(u.view);
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

  taskTagMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
        const refresh = ensureTaskTagMarksRefresh();
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

  buildTaskTagMarkDecorations(view) {
    try {
      if (!this.taskTagMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !TaskTagMarkWidget || !RefTaskMarkWidget) {
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
      const ranges = (view && view.visibleRanges) || [];
      let selectionRanges = [];
      try {
        selectionRanges =
          (view.state.selection && view.state.selection.ranges) || [];
      } catch (error) {
        selectionRanges = [];
      }
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) {
          tree = syntaxTree(view.state);
        } else if (
          syntaxTree &&
          typeof syntaxTree.resolveInner === "function"
        ) {
          tree = syntaxTree;
        }
      } catch (error) {
        tree = null;
      }
      const builder = new RangeSetBuilder();
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") {
        return builder.finish();
      }
      const docLength =
        typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      for (const range of ranges) {
        try {
          if (!range || typeof range.from !== "number") {
            continue;
          }
          let pos = Math.max(0, range.from);
          const end = Math.min(
            typeof range.to === "number" ? range.to : docLength,
            docLength,
          );
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            let line = null;
            try {
              line = doc.lineAt(pos);
            } catch (error) {
              break;
            }
            if (!line || typeof line.text !== "string") {
              break;
            }
            try {
              if (line.text.indexOf("#task") !== -1) {
                const sources = taskTagMarkRanges(line.text);
                for (const source of sources) {
                  try {
                    if (
                      !source ||
                      typeof source.from !== "number" ||
                      typeof source.to !== "number"
                    ) {
                      continue;
                    }
                    const absFrom = line.from + source.from;
                    const absTo = line.from + source.to;
                    let revealed = false;
                    for (const selection of selectionRanges) {
                      try {
                        if (
                          selection &&
                          typeof selection.from === "number" &&
                          typeof selection.to === "number" &&
                          selection.from <= absTo &&
                          selection.to >= absFrom
                        ) {
                          revealed = true;
                          break;
                        }
                      } catch (error) {
                        continue;
                      }
                    }
                    if (revealed) {
                      continue;
                    }
                    let inCode = false;
                    try {
                      if (tree) {
                        inCode = freshnessMarkPosInCode(tree, absFrom + 1);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (inCode) {
                      continue;
                    }
                    // A `ref` range spans the whole `#task #ref` pair,
                    // so one open-book decoration replaces both tags
                    // and one cursor touch reveals both.
                    const widget =
                      source && source.kind === "ref"
                        ? new RefTaskMarkWidget()
                        : new TaskTagMarkWidget();
                    builder.add(
                      absFrom,
                      absTo,
                      Decoration.replace({
                        widget,
                      }),
                    );
                  } catch (error) {
                    continue;
                  }
                }
              }
            } catch (error) {
              // One bad line never breaks the build.
            }
            if (typeof line.to !== "number" || line.to >= end) {
              break;
            }
            if (line.to < pos) {
              break;
            }
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

  taskTagMarkCandidateAnchors(el) {
    try {
      if (!el || typeof el !== "object") {
        return [];
      }
      try {
        if (typeof el.querySelectorAll === "function") {
          return Array.prototype.slice.call(
            el.querySelectorAll("a.tag"),
          );
        }
      } catch (error) {
        // Fall through to the manual walk.
      }
      const found = [];
      try {
        const stack = [el];
        let guard = 0;
        while (stack.length > 0 && guard < 10000) {
          guard += 1;
          const top = stack.pop();
          try {
            const children = (top && top.childNodes) || [];
            for (let index = children.length - 1; index >= 0; index -= 1) {
              const child = children[index];
              if (!child) {
                continue;
              }
              if (child.nodeType === 1) {
                try {
                  const tag = String(
                    child.tagName || child.nodeName || "",
                  ).toUpperCase();
                  if (tag === "CODE" || tag === "PRE") {
                    continue;
                  }
                  if (tag === "A") {
                    found.push(child);
                  }
                } catch (error) {
                  // Keep walking on per-node failure.
                }
                stack.push(child);
              }
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        return [];
      }
      return found;
    } catch (error) {
      return [];
    }
  }

  // Annotate one eligible `#task` anchor: a `#task #ref` pair
  // becomes the open-book mark (and hides the `#ref` partner), any
  // other eligible anchor becomes the hash. Returns true on success,
  // false otherwise. Never throws.
  annotateTaskTagAnchor(anchor) {
    try {
      if (!anchor || typeof anchor !== "object") {
        return false;
      }
      let partner = null;
      try {
        partner = refTaskPairAnchor(anchor);
      } catch (error) {
        partner = null;
      }
      if (partner) {
        return annotateRefTaskMark(anchor, partner);
      }
      return annotateTaskTagMark(anchor);
    } catch (error) {
      return false;
    }
  }

  renderTaskTagMarksIn(el, ctx) {
    try {
      if (!this.taskTagMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const anchors = this.taskTagMarkCandidateAnchors(el);
      for (const anchor of anchors) {
        try {
          if (!anchor) {
            continue;
          }
          if (!taskTagMarkElementEligible(anchor, el)) {
            continue;
          }
          this.annotateTaskTagAnchor(anchor);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  annotateTaskTagMarksInDocument() {
    try {
      if (typeof document === "undefined" || !document) {
        return 0;
      }
      const root = document.body || document;
      if (!root) {
        return 0;
      }
      let count = 0;
      const anchors = this.taskTagMarkCandidateAnchors(root);
      for (const anchor of anchors) {
        try {
          if (taskTagMarkElementEligible(anchor, root)) {
            if (this.annotateTaskTagAnchor(anchor)) {
              count += 1;
            }
          }
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  stripTaskTagMarksInDocument() {
    try {
      if (typeof document === "undefined" || !document) {
        return 0;
      }
      const root = document.body || document;
      if (!root) {
        return 0;
      }
      let candidates = [];
      let hidden = [];
      try {
        if (root.querySelectorAll && typeof root.querySelectorAll === "function") {
          candidates = Array.prototype.slice.call(
            root.querySelectorAll("a.tag.bob-task-tag-mark"),
          );
          hidden = Array.prototype.slice.call(
            root.querySelectorAll("a.tag." + REF_TASK_HIDDEN_CLASS),
          );
        } else if (
          typeof document.querySelectorAll === "function" &&
          root === document.body
        ) {
          candidates = Array.prototype.slice.call(
            document.querySelectorAll("a.tag.bob-task-tag-mark"),
          );
          hidden = Array.prototype.slice.call(
            document.querySelectorAll("a.tag." + REF_TASK_HIDDEN_CLASS),
          );
        }
      } catch (error) {
        candidates = [];
        hidden = [];
      }
      if (candidates.length === 0 && hidden.length === 0) {
        try {
          const stack = [root];
          let guard = 0;
          while (stack.length > 0 && guard < 10000) {
            guard += 1;
            const top = stack.pop();
            try {
              const children = (top && top.childNodes) || [];
              for (let index = children.length - 1; index >= 0; index -= 1) {
                const child = children[index];
                if (!child || child.nodeType !== 1) {
                  continue;
                }
                try {
                  const classText =
                    typeof child.className === "string"
                      ? child.className
                      : typeof child.getAttribute === "function"
                        ? child.getAttribute("class") || ""
                        : "";
                  if (typeof classText === "string" && classText !== "") {
                    const parts = classText.split(/\s+/);
                    if (parts.indexOf("bob-task-tag-mark") !== -1) {
                      candidates.push(child);
                    } else if (parts.indexOf(REF_TASK_HIDDEN_CLASS) !== -1) {
                      hidden.push(child);
                    }
                  }
                } catch (error) {
                  // Keep walking on per-node failure.
                }
                stack.push(child);
              }
            } catch (error) {
              continue;
            }
          }
        } catch (error) {
          // Best-effort walk only.
        }
      }
      let count = 0;
      for (const candidate of candidates) {
        try {
          if (stripTaskTagMark(candidate)) {
            count += 1;
          }
        } catch (error) {
          continue;
        }
      }
      // A book-annotated `#task` anchor is restored by the loop above
      // (it carries `bob-task-tag-mark` too); its hidden `#ref`
      // partner needs its own reveal.
      for (const partner of hidden) {
        try {
          if (stripRefTaskHidden(partner)) {
            count += 1;
          }
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  toggleTaskTagMarks() {
    try {
      this.taskTagMarksEnabled = !this.taskTagMarksEnabled;
      const enabled = this.taskTagMarksEnabled;
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList
        ) {
          if (enabled) {
            if (typeof document.body.classList.add === "function") {
              document.body.classList.add("bob-task-tag-marks");
            }
          } else if (typeof document.body.classList.remove === "function") {
            document.body.classList.remove("bob-task-tag-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (enabled) {
          this.annotateTaskTagMarksInDocument();
        } else {
          this.stripTaskTagMarksInDocument();
        }
      } catch (error) {
        // Document re-annotation is best-effort.
      }
      try {
        this.refreshTaskTagMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // Tasks re-render is best-effort.
      }
      try {
        new Notice(
          enabled ? "Task tag marks on" : "Task tag marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.taskTagMarksEnabled;
    }
  }

  refreshTaskTagMarkEditors() {
    try {
      const refresh = ensureTaskTagMarksRefresh();
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
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
}
