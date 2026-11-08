// --- No-reply pill: Live Preview and reading view --------------------------
// Rides Toggle task tag marks. Owned by bob-cli `docs/mail-link-marks.md`
// and the no-reply section of `docs/task-tag-marks.md`.

let noReplyPillsRefreshEffect = null;
function ensureNoReplyPillsRefresh() {
  if (noReplyPillsRefreshEffect) return noReplyPillsRefreshEffect;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      noReplyPillsRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    noReplyPillsRefreshEffect = null;
  }
  return noReplyPillsRefreshEffect;
}

class BobLedgerToolsNoReplyPillsMixin {
  setupNoReplyPills() {
    try {
      try {
        const extension = this.createNoReplyPillExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor((el, ctx) => this.renderNoReplyPillsIn(el, ctx), 51);
        }
      } catch (error) {
        // Reading view is best-effort.
      }
    } catch (error) {
      // Display-only setup never blocks plugin startup.
    }
  }

  noReplyPillsAvailable() {
    try {
      return Boolean(
        ViewPlugin && Decoration && WidgetType && StateEffect &&
        typeof StateEffect.define === "function" && RangeSetBuilder &&
        editorInfoField && editorLivePreviewField && NoReplyPillWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createNoReplyPillExtension() {
    try {
      if (!this.noReplyPillsAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const PillPluginClass = class {
        constructor(view) {
          try { this.decorations = plugin.buildNoReplyPillDecorations(view); }
          catch (error) { this.decorations = Decoration.none; }
        }
        update(update) {
          try {
            if (plugin.noReplyPillsShouldRebuild(update)) {
              this.decorations = plugin.buildNoReplyPillDecorations(update.view);
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(PillPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  noReplyPillsShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const refresh = ensureNoReplyPillsRefresh();
      const tagRefresh = typeof ensureTaskTagMarksRefresh === "function" ? ensureTaskTagMarksRefresh() : null;
      for (const transaction of update.transactions || []) {
        for (const effect of (transaction && transaction.effects)
          ? (Array.isArray(transaction.effects) ? transaction.effects : [transaction.effects]) : []) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) return true;
          if (effect === tagRefresh || (tagRefresh && effect && typeof effect.is === "function" && effect.is(tagRefresh))) return true;
        }
      }
      if (editorLivePreviewField && update.startState && update.state &&
        update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return true;
      return false;
    } catch (error) {
      return false;
    }
  }

  buildNoReplyPillDecorations(view) {
    try {
      if (!this.taskTagMarksEnabled || !Decoration || !RangeSetBuilder || !NoReplyPillWidget) {
        return Decoration.none;
      }
      if (!editorInfoField || !editorLivePreviewField) return Decoration.none;
      if (!view || !view.state || !view.state.field(editorLivePreviewField)) return Decoration.none;
      const info = view.state.field(editorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      let today = null;
      try { today = this.dateMarksToday(); } catch (error) { today = null; }
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) tree = syntaxTree(view.state);
      } catch (error) {
        tree = null;
      }
      let selectionRanges = [];
      try { selectionRanges = (view.state.selection && view.state.selection.ranges) || []; } catch (error) {
        selectionRanges = [];
      }
      const ranges = view.visibleRanges || [];
      const builder = new RangeSetBuilder();
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      for (const range of ranges) {
        try {
          if (!range || typeof range.from !== "number") continue;
          let pos = Math.max(0, range.from);
          const end = Math.min(typeof range.to === "number" ? range.to : docLength, docLength);
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            let line = null;
            try { line = doc.lineAt(pos); } catch (error) { break; }
            if (!line || typeof line.text !== "string") break;
            try {
              if (line.text.indexOf("#awaiting_reply") !== -1) {
                const facts = typeof this.mailNoteFacts === "function"
                  ? this.mailNoteFacts(line.text, sourcePath)
                  : { turnSince: "" };
                const model = noReplyPillModel(line.text, {
                  today,
                  turnSince: facts && facts.turnSince,
                });
                if (model) {
                  const absFrom = line.from + model.from;
                  const absTo = line.from + model.to;
                  let revealed = false;
                  for (const selection of selectionRanges) {
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
                  }
                  let inCode = false;
                  try {
                    if (!revealed && tree && typeof freshnessMarkPosInCode === "function") {
                      inCode = freshnessMarkPosInCode(tree, absFrom + 1);
                    }
                  } catch (error) {
                    inCode = false;
                  }
                  if (!revealed && !inCode) {
                    builder.add(absFrom, absTo, Decoration.replace({
                      widget: new NoReplyPillWidget(model),
                    }));
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
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  renderNoReplyPillsIn(el, ctx) {
    try {
      if (!this.taskTagMarksEnabled || !el) return;
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      let today = null;
      try { today = this.dateMarksToday(); } catch (error) { today = null; }
      const anchors = typeof el.querySelectorAll === "function"
        ? Array.prototype.slice.call(el.querySelectorAll("a.tag"))
        : [];
      for (const anchor of anchors) {
        try {
          if (!isNoReplyTagAnchor(anchor)) continue;
          if (this.taskTagMarkQueryAncestor && this.taskTagMarkQueryAncestor(anchor, el)) continue;
          const host = typeof anchor.closest === "function" ? anchor.closest("li") || anchor : anchor;
          const info = ctx && typeof ctx.getSectionInfo === "function"
            ? ctx.getSectionInfo(host) || ctx.getSectionInfo(el)
            : null;
          let lineText = info && typeof info.text === "string" ? info.text : "";
          if (!lineText && typeof host.textContent === "string") {
            lineText = "- [ ] #task #awaiting_reply " + host.textContent;
          }
          const facts = typeof this.mailNoteFacts === "function"
            ? this.mailNoteFacts(lineText, sourcePath)
            : { turnSince: "" };
          const model = noReplyPillModel(lineText, {
            today,
            turnSince: facts && facts.turnSince,
          });
          if (model) annotateNoReplyPill(anchor, model);
          else stripNoReplyPill(anchor);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Rendered-view pills never throw.
    }
  }

  taskTagMarkQueryAncestor(node, root) {
    try {
      let current = node;
      let guard = 0;
      while (current && current !== root && guard++ < 80) {
        let classText = "";
        try {
          if (current.classList && typeof current.classList.contains === "function") {
            if (
              current.classList.contains("plugin-tasks-list-item") ||
              current.classList.contains("tasks-list-text") ||
              current.classList.contains("task-description")
            ) {
              return true;
            }
          }
          classText = typeof current.className === "string" ? current.className : "";
        } catch (error) {
          classText = "";
        }
        if (
          typeof classText === "string" &&
          (classText.indexOf("plugin-tasks-list-item") !== -1 ||
            classText.indexOf("task-description") !== -1)
        ) {
          return true;
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  refreshNoReplyPillsEditors() {
    try {
      const refresh = ensureNoReplyPillsRefresh();
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (cm && typeof cm.dispatch === "function" && refresh) cm.dispatch({ effects: refresh.of(null) });
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }
}
