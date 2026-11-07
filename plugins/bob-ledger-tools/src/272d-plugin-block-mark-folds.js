// --- Blocked-reason marks: fold what the box already says -----------------
// Digit rows fold their priority bars in `265-plugin-priority-marks.js`
// via `priorityMarkFoldedForLine`. This mixin folds the exact
// `#prj_is_blocked` token on `prj` rows and the exact `#awaiting_reply`
// token on `awaiting` rows in Live Preview and reading view
// (`blockMarkFoldTagForKey`), and keeps every fold gated on
// `blockMarksEnabled`. A row whose box shows another key keeps both
// pills.
const BLOCK_MARK_FOLDS_READING_PROCESSOR_ORDER = 45;

class BobLedgerToolsBlockMarkFoldsMixin {
  setupBlockMarkFolds() {
    try {
      try {
        const extension = this.createBlockMarkFoldExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview tag folds are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderBlockMarkFoldsIn(el, ctx),
            BLOCK_MARK_FOLDS_READING_PROCESSOR_ORDER,
          );
        }
      } catch (error) {
        // Reading-view tag folds are best-effort.
      }
    } catch (error) {
      // Fold setup never throws.
    }
  }

  priorityMarkFoldedForLine(path, lineText) {
    try {
      if (this.blockMarksEnabled === false) return false;
      if (typeof this.blockMarkModelForLine !== "function") return false;
      const model = this.blockMarkModelForLine(path || "", lineText);
      return typeof blockMarkIsDigitKey === "function"
        ? blockMarkIsDigitKey(model && model.key)
        : false;
    } catch (error) {
      return false;
    }
  }

  priorityMarkFoldedForRow(path, lineText, li) {
    try {
      if (this.blockMarksEnabled === false) return false;
      if (li && typeof this.blockMarkReadingInTasksQuery === "function") {
        if (this.blockMarkReadingInTasksQuery(li)) return false;
      }
      if (li && typeof li.getAttribute === "function") {
        const key = li.getAttribute("data-bob-block");
        if (typeof blockMarkIsDigitKey === "function" && blockMarkIsDigitKey(key)) {
          return true;
        }
        if (key) return false;
      }
      return this.priorityMarkFoldedForLine(path, lineText);
    } catch (error) {
      return false;
    }
  }

  blockMarksFoldsAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          typeof Decoration.replace === "function" &&
          RangeSetBuilder &&
          StateEffect &&
          typeof StateEffect.define === "function" &&
          editorInfoField &&
          editorLivePreviewField &&
          BlockMarkPrjFoldWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createBlockMarkFoldExtension() {
    try {
      if (
        !this.blockMarksFoldsAvailable() ||
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const FoldPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildBlockMarkFoldDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.blockMarkFoldShouldRebuild(update)) {
              this.decorations = plugin.buildBlockMarkFoldDecorations(update.view);
            }
          } catch (error) {
            // Keep the previous valid decorations on a failed rebuild.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(FoldPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  blockMarkFoldShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        return true;
      }
      return typeof this.blockMarkShouldRebuild === "function"
        ? this.blockMarkShouldRebuild(update)
        : false;
    } catch (error) {
      return false;
    }
  }

  buildBlockMarkFoldDecorations(view) {
    try {
      if (
        this.blockMarksEnabled === false ||
        !view ||
        !view.state ||
        !Decoration ||
        typeof Decoration.replace !== "function" ||
        !RangeSetBuilder ||
        !BlockMarkPrjFoldWidget ||
        !editorInfoField ||
        !editorLivePreviewField
      ) {
        return Decoration.none;
      }
      let live = false;
      let info = null;
      try {
        live = view.state.field(editorLivePreviewField) === true;
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const path =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : "";
      if (!live || !path) return Decoration.none;

      let tree = null;
      try {
        if (typeof syntaxTree === "function") tree = syntaxTree(view.state);
        else if (syntaxTree && typeof syntaxTree.resolveInner === "function") {
          tree = syntaxTree;
        }
      } catch (error) {
        tree = null;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      const docLength =
        typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      let selectionRanges = [];
      try {
        selectionRanges =
          (view.state.selection && view.state.selection.ranges) || [];
      } catch (error) {
        selectionRanges = [];
      }
      const builder = new RangeSetBuilder();
      for (const range of view.visibleRanges || []) {
        try {
          if (!range || typeof range.from !== "number") continue;
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
            if (!line || typeof line.text !== "string") break;
            try {
              const model =
                typeof this.blockMarkModelForEditorLine === "function"
                  ? this.blockMarkModelForEditorLine(path, line, tree)
                  : this.blockMarkModelForLine(path, line.text);
              const foldTag = model ? blockMarkFoldTagForKey(model.key) : null;
              if (foldTag) {
                const source = blockMarkTagSource(line.text, foldTag);
                if (source) {
                  const absFrom =
                    line.from + source.tagStart - (source.foldSpace ? 1 : 0);
                  const absTo = line.from + source.tagEnd;
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
                  if (!revealed) {
                    let inCode = false;
                    try {
                      if (tree && typeof freshnessMarkPosInCode === "function") {
                        inCode = freshnessMarkPosInCode(tree, absFrom);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (!inCode) {
                      builder.add(
                        absFrom,
                        absTo,
                        Decoration.replace({
                          widget: new BlockMarkPrjFoldWidget(
                            source.foldSpace,
                            foldTag,
                          ),
                        }),
                      );
                    }
                  }
                }
              }
            } catch (error) {
              // One bad line never breaks the build.
            }
            if (typeof line.to !== "number" || line.to >= end) break;
            if (line.to < pos) break;
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

  // True for the rendered `a.tag` pill of exactly `tagToken` (by `href`
  // or `data-tag-name`, with matching or empty text). Never throws.
  blockMarkFoldIsTag(node, tagToken) {
    try {
      if (!node || typeof tagToken !== "string" || !tagToken) return false;
      const tag = String(node.tagName || node.nodeName || "").toUpperCase();
      if (tag !== "A") return false;
      let isTag = false;
      try {
        if (node.classList && typeof node.classList.contains === "function") {
          isTag = node.classList.contains("tag");
        }
      } catch (error) {
        isTag = false;
      }
      if (!isTag) {
        const classText =
          typeof node.className === "string"
            ? node.className
            : typeof node.getAttribute === "function"
              ? node.getAttribute("class") || ""
              : "";
        isTag = String(classText).split(/\s+/).indexOf("tag") !== -1;
      }
      if (!isTag) return false;
      const href =
        typeof node.getAttribute === "function" ? node.getAttribute("href") : "";
      const dataName =
        typeof node.getAttribute === "function"
          ? node.getAttribute("data-tag-name")
          : "";
      if (href !== tagToken && dataName !== tagToken) {
        return false;
      }
      const text = String(node.textContent || "").trim();
      return text === "" || text === tagToken;
    } catch (error) {
      return false;
    }
  }

  // Fold the row's own pill for `foldTag` (or none when null) and unfold
  // every other foldable pill, so a key change never leaves a stale fold.
  blockMarkFoldApplyTags(li, foldTag) {
    try {
      const own =
        typeof this.blockMarkReadingOwnElements === "function"
          ? this.blockMarkReadingOwnElements(li)
          : [];
      for (const node of own) {
        try {
          let tag = null;
          for (const candidate of ["#prj_is_blocked", "#awaiting_reply"]) {
            if (this.blockMarkFoldIsTag(node, candidate)) {
              tag = candidate;
              break;
            }
          }
          if (!tag) continue;
          if (tag === foldTag) {
            if (typeof node.setAttribute === "function") {
              node.setAttribute("data-bob-block-folded", "true");
            }
          } else if (typeof node.removeAttribute === "function") {
            node.removeAttribute("data-bob-block-folded");
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Tag annotation is best-effort.
    }
  }

  renderBlockMarkFoldsIn(el) {
    try {
      if (!el) return;
      const rows =
        typeof this.blockMarkReadingCandidateRows === "function"
          ? this.blockMarkReadingCandidateRows(el)
          : [];
      for (const li of rows) {
        try {
          const key =
            typeof this.blockMarkReadingAttr === "function"
              ? this.blockMarkReadingAttr(li, "data-bob-block")
              : li && typeof li.getAttribute === "function"
                ? li.getAttribute("data-bob-block")
                : null;
          const foldTag = this.blockMarksEnabled !== false
            ? blockMarkFoldTagForKey(key)
            : null;
          this.blockMarkFoldApplyTags(li, foldTag);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // The post-processor is synchronous and never throws.
    }
  }

  sweepBlockMarkFoldsReading() {
    try {
      const hosts =
        this.blockMarkReadingHosts instanceof Set
          ? Array.from(this.blockMarkReadingHosts)
          : [];
      for (const rec of hosts) {
        try {
          if (!rec || !rec.el) continue;
          this.renderBlockMarkFoldsIn(rec.el);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // The rendered-host sweep is best-effort.
    }
  }
}
