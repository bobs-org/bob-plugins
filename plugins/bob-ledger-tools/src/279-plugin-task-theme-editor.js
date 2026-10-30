// --- Task theme marks: Live Preview, toggle, api --------------------------
// `BobLedgerToolsTaskThemeEditorMixin`, installed in
// `310-install-methods.js` after the task-theme suggest mixin. Mirrors
// `265-plugin-priority-marks.js` (setup, extension, toggle) and
// `266-plugin-date-marks.js` (folded replace ranges, rebuild triggers),
// but the model is the canonical explicit-field model in
// `279-plugin-task-theme-marks.js` plus the semantic scanner from the
// theme-api phase. Every method is synchronous and never throws.
//
// A line gets a pill only for an explicit field: no field means no mark
// even when a note, reading, or review default exists. Repair stays
// visible as repair and never presents as a trustworthy pill. Closed
// tasks keep their historical pill. Folding uses `dateMarkSelectionFold`:
// touching the field reveals source, and a selection endpoint in any
// folded whitespace keeps that endpoint unfolded. Clicking the widget
// places the caret in the field and reveals it. Tooltips resolve lazily
// on hover/focus via the shared reason phrases, never while building
// decorations, and never contain `::`.
class BobLedgerToolsTaskThemeEditorMixin {
  setupTaskThemeMarks() {
    try {
      try {
        this.setupTaskRootMarks();
      } catch (error) {
        // Root marks are a sibling display-only gate.
      }
      if (typeof this.taskThemeMarksEnabled !== "boolean") {
        this.taskThemeMarksEnabled = true;
      }
      this.applyMarkGateClass(
        "bob-task-theme-marks",
        this.taskThemeMarksEnabled,
      );
      this.registerMarkGatePopoutSync(
        "bob-task-theme-marks",
        () => this.taskThemeMarksEnabled,
      );
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-task-theme-marks",
            name: "Toggle task type marks",
            callback: () => this.toggleTaskThemeMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createTaskThemeMarkExtension();
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
            (el, ctx) => {
              this.renderTaskThemeMarksIn(el, ctx);
              this.renderRootMarksIn(el, ctx);
            },
            50,
          );
        }
      } catch (error) {
        // Rendered-view marks are best-effort.
      }
      try {
        this.taskThemeEnsureHoverForDocuments();
      } catch (error) {
        // Reading-view hover hosts are best-effort.
      }
      try {
        this.taskThemeWireRefreshEvents();
      } catch (error) {
        // Refresh wiring is best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  taskThemeMarksAvailable() {
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
          TaskThemeMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createTaskThemeMarkExtension() {
    try {
      if (!this.taskThemeMarksAvailable()) {
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
          this.view = view;
          try {
            this.decorations = plugin.buildTaskThemeMarkDecorations(view);
          } catch (error) {
            try {
              this.decorations = Decoration.none;
            } catch (inner) {
              this.decorations = null;
            }
          }
          try {
            plugin.taskThemeEnsureHoverForView(view);
          } catch (error) {
            // Hover enrichment is best-effort.
          }
        }

        update(u) {
          try {
            if (plugin.taskThemeMarkShouldRebuild(u)) {
              this.decorations = plugin.buildTaskThemeMarkDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
          try {
            if (u && u.view) {
              this.view = u.view;
              plugin.taskThemeEnsureHoverForView(u.view);
            }
          } catch (error) {
            // Hover enrichment is best-effort.
          }
        }

        destroy() {
          try {
            plugin.taskThemeUntrackHoverRoot(this.view && this.view.dom);
          } catch (error) {
            // Editor hover cleanup is best-effort.
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

  taskThemeMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
        const refresh = ensureTaskThemeMarksRefresh();
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

  taskThemeContentStart(lineText) {
    try {
      if (typeof dateMarkContentStart === "function") {
        return dateMarkContentStart(lineText);
      }
    } catch (error) {
      // Fall through to the local scan.
    }
    try {
      const text = String(lineText || "");
      if (text === "") {
        return 0;
      }
      const stripped =
        typeof freshnessStripBlockquotePrefix === "function"
          ? freshnessStripBlockquotePrefix(text)
          : text;
      const offset = text.length - stripped.length;
      let index = 0;
      while (stripped[index] === " " || stripped[index] === "\t") {
        index += 1;
      }
      let after = null;
      try {
        after =
          typeof freshnessAfterListMarker === "function"
            ? freshnessAfterListMarker(stripped, index)
            : null;
      } catch (error) {
        after = null;
      }
      if (after === null) {
        return 0;
      }
      index = after;
      while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
        index += 1;
      }
      return offset + index;
    } catch (error) {
      return 0;
    }
  }

  taskThemeFoldLength(lineText, fieldStart, contentStart) {
    try {
      if (typeof dateMarkFoldLength === "function") {
        return dateMarkFoldLength(lineText, fieldStart, contentStart);
      }
    } catch (error) {
      // Fall through to the local run.
    }
    try {
      if (typeof lineText !== "string") {
        return 0;
      }
      if (fieldStart <= contentStart) {
        return 0;
      }
      let run = 0;
      let index = fieldStart - 1;
      while (index >= contentStart && lineText[index] === " ") {
        run += 1;
        index -= 1;
      }
      return run;
    } catch (error) {
      return 0;
    }
  }

  taskThemeResolveModel(source, lineText) {
    try {
      if (!source || typeof source !== "object") {
        return null;
      }
      if (source.state === "repair") {
        const raw =
          typeof source.rawValue === "string"
            ? source.rawValue
            : typeof lineText === "string" &&
                Number.isFinite(Number(source.fieldStart)) &&
                Number.isFinite(Number(source.fieldEnd))
              ? lineText.slice(source.fieldStart, source.fieldEnd)
              : "";
        return taskThemeMarkModel(
          {
            state: "repair",
            repair: source.repair || "invalid",
            fields: [{ value: raw }],
          },
          { known: false, hue: null, hueSource: null },
        );
      }
      if (source.state !== "set") {
        return null;
      }
      let known = true;
      let hue = null;
      let hueSource = null;
      try {
        if (typeof this.pomodoroThemeIsKnown === "function") {
          known = this.pomodoroThemeIsKnown(source.key) !== false;
        }
      } catch (error) {
        known = true;
      }
      if (known) {
        try {
          if (typeof this.pomodoroThemeHueFor === "function") {
            const resolved = this.pomodoroThemeHueFor(
              source.key,
              source.value,
            );
            if (resolved && typeof resolved === "object") {
              if (typeof resolved.hue === "string" && resolved.hue) {
                hue = resolved.hue;
              }
              if (
                typeof resolved.hue_source === "string" &&
                resolved.hue_source
              ) {
                hueSource = resolved.hue_source;
              } else if (
                typeof resolved.hueSource === "string" &&
                resolved.hueSource
              ) {
                hueSource = resolved.hueSource;
              }
            }
          }
        } catch (error) {
          hue = null;
          hueSource = null;
        }
      }
      let value = source.value;
      try {
        if (known && typeof this.pomodoroThemeCatalogSpelling === "function") {
          const catalogName = this.pomodoroThemeCatalogSpelling(source.key);
          if (typeof catalogName === "string" && catalogName) {
            value = catalogName;
          }
        }
      } catch (error) {
        value = source.value;
      }
      return taskThemeMarkModel(
        { state: "set", value, key: source.key },
        { known, hue, hueSource },
      );
    } catch (error) {
      return null;
    }
  }

  buildTaskThemeMarkDecorations(view) {
    try {
      if (!this.taskThemeMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !TaskThemeMarkWidget) {
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
              const sources =
                typeof taskThemeMarkSourcesInText === "function"
                  ? taskThemeMarkSourcesInText(line.text)
                  : [];
              const lineSource =
                typeof taskThemeMarkSource === "function"
                  ? taskThemeMarkSource(line.text)
                  : null;
              if (lineSource && sources.length > 0) {
                for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
                  const source = sources[sourceIndex];
                  if (!source) {
                    continue;
                  }
                  const absFrom = line.from + source.fieldStart;
                  const absTo = line.from + source.fieldEnd;
                  const contentStart =
                    line.from +
                    this.taskThemeContentStart(line.text);
                  const foldLength = this.taskThemeFoldLength(
                    line.text,
                    source.fieldStart,
                    contentStart - line.from,
                  );
                  // Reveal per field, and never hide a caret in the
                  // folded run (see `dateMarkSelectionFold`).
                  let fold = foldLength;
                  try {
                    if (typeof dateMarkSelectionFold === "function") {
                      fold = dateMarkSelectionFold(
                        absFrom,
                        absTo,
                        foldLength,
                        selectionRanges,
                      );
                    } else {
                      fold = taskThemeFallbackFold(
                        absFrom,
                        absTo,
                        foldLength,
                        selectionRanges,
                      );
                    }
                  } catch (error) {
                    fold = foldLength;
                  }
                  if (fold !== null) {
                    let inCode = false;
                    try {
                      if (tree) {
                        inCode = freshnessMarkPosInCode(tree, absFrom);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (!inCode) {
                      const model = this.taskThemeResolveModel(
                        source,
                        line.text,
                      );
                      if (model) {
                        const from = absFrom - fold;
                        builder.add(
                          from,
                          absTo,
                          Decoration.replace({
                            widget: new TaskThemeMarkWidget(
                              model,
                              fold,
                              this.taskThemeMarksGeneration || 0,
                            ),
                          }),
                        );
                      }
                    }
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

  // Delegated lazy hover/focus enrichment for one editor view's DOM. One
  // `mouseover` + one `focusin` listener per `view.dom` (guarded by a
  // marker property) resolves the inherited reason only for the hovered
  // pill and writes its `aria-label`/`title` in place. Delegation keeps
  // the same model working after Dataview DOM cloning in the Reading
  // phase: the next phase reuses `taskThemeEnrichMarkElement` on its own
  // roots. Never throws.
  taskThemeEnsureHoverForView(view) {
    try {
      const dom = view && view.dom ? view.dom : null;
      if (!dom || typeof dom.addEventListener !== "function") {
        return false;
      }
      if (dom.__bobTaskThemeHover) {
        return true;
      }
      const plugin = this;
      const onHover = (event) => {
        try {
          plugin.taskThemeEnrichFromEvent(view, event);
        } catch (error) {
          // Enrichment is best-effort.
        }
      };
      try {
        dom.addEventListener("mouseover", onHover);
      } catch (error) {
        return false;
      }
      try {
        dom.addEventListener("focusin", onHover);
      } catch (error) {
        // Mouse hover alone still enriches.
      }
      try {
        dom.__bobTaskThemeHover = true;
      } catch (error) {
        // The marker is best-effort; duplicate listeners stay harmless.
      }
      if (!Array.isArray(this.taskThemeHoverRoots)) {
        this.taskThemeHoverRoots = [];
      }
      try {
        this.taskThemeHoverRoots.push({ root: dom, onHover });
      } catch (error) {
        // Tracking is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeEnrichFromEvent(view, event) {
    try {
      const target =
        event && event.target
          ? event.target
          : event && event.relatedTarget
            ? event.relatedTarget
            : null;
      if (!target || typeof target.closest !== "function") {
        return false;
      }
      const mark = target.closest(
        ".bob-pomo-theme[data-task-theme-kind]",
      );
      if (!mark) {
        return false;
      }
      return this.taskThemeEnrichMarkElement(view, mark);
    } catch (error) {
      return false;
    }
  }

  // Resolve and write the lazy tooltip for one pill element. Shared with
  // the Reading-view phase: given any host `view` (or null) and a
  // `.bob-pomo-theme[data-task-theme-kind]` element, derive the file path
  // and line from the editor position when possible, call the synchronous
  // suggestion API, and set `aria-label`/`title` from
  // `taskThemeTooltipText`. Elements already enriched (or without a
  // resolvable context) are left alone. Never throws, never writes.
  taskThemeEnrichMarkElement(view, mark) {
    try {
      if (!mark || typeof mark.getAttribute !== "function") {
        return false;
      }
      try {
        if (mark.getAttribute("data-task-theme-enriched") === "true") {
          return true;
        }
      } catch (error) {
        // Enrichment proceeds without the marker.
      }
      const kind = mark.getAttribute("data-task-theme-kind") || "pill";
      let value = null;
      try {
        value =
          (mark.textContent !== undefined && mark.textContent !== null
            ? String(mark.textContent)
            : "") || null;
      } catch (error) {
        value = null;
      }
      if (!value) {
        try {
          value = mark.getAttribute("data-theme-key") || "theme";
        } catch (error) {
          value = "theme";
        }
      }
      // Repair and unknown pills keep their status copy: no vault read.
      if (kind === "repair") {
        const tooltip = taskThemeTooltipText(value, "repair", null);
        try {
          mark.setAttribute("aria-label", tooltip);
          mark.setAttribute("title", tooltip);
          mark.setAttribute("data-task-theme-enriched", "true");
        } catch (error) {
          // Attribute writes are best-effort.
        }
        return true;
      }
      if (kind === "unknown") {
        const tooltip = taskThemeTooltipText(value, "unknown", null);
        try {
          mark.setAttribute("aria-label", tooltip);
          mark.setAttribute("title", tooltip);
          mark.setAttribute("data-task-theme-enriched", "true");
        } catch (error) {
          // Attribute writes are best-effort.
        }
        return true;
      }
      let reason = undefined;
      try {
        reason = this.taskThemeReasonForPosition(view, mark);
      } catch (error) {
        reason = undefined;
      }
      if (reason === undefined) {
        return false;
      }
      const tooltip = taskThemeTooltipText(value, "pill", reason);
      try {
        mark.setAttribute("aria-label", tooltip);
        mark.setAttribute("title", tooltip);
        mark.setAttribute("data-task-theme-enriched", "true");
      } catch (error) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeReasonForPosition(view, mark) {
    try {
      if (typeof this.pomodoroThemeSuggestFor !== "function") {
        return null;
      }
      if (!view || !view.state) {
        return this.taskThemeReasonForMarkOrigin
          ? this.taskThemeReasonForMarkOrigin(mark)
          : null;
      }
      let pos = null;
      try {
        pos =
          view && typeof view.posAtDOM === "function"
            ? view.posAtDOM(mark)
            : null;
      } catch (error) {
        pos = null;
      }
      if (typeof pos !== "number") {
        return this.taskThemeReasonForMarkOrigin
          ? this.taskThemeReasonForMarkOrigin(mark)
          : null;
      }
      let info = null;
      try {
        info =
          view.state && editorInfoField
            ? view.state.field(editorInfoField)
            : null;
      } catch (error) {
        info = null;
      }
      const path =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : null;
      if (!path) {
        return this.taskThemeReasonForMarkOrigin
          ? this.taskThemeReasonForMarkOrigin(mark)
          : null;
      }
      let lineNumber = null;
      let docText = null;
      try {
        const doc = view.state.doc;
        if (doc && typeof doc.lineAt === "function") {
          lineNumber = doc.lineAt(pos).number;
        }
        if (doc && typeof doc.toString === "function") {
          docText = doc.toString();
        }
      } catch (error) {
        lineNumber = null;
      }
      if (!Number.isInteger(lineNumber) || lineNumber < 1) {
        return undefined;
      }
      const suggestion = this.pomodoroThemeSuggestFor({
        path,
        line: lineNumber,
        text: typeof docText === "string" ? docText : undefined,
      });
      if (!suggestion || typeof suggestion !== "object") {
        return null;
      }
      const inherited =
        suggestion.inherited && typeof suggestion.inherited === "object"
          ? suggestion.inherited
          : suggestion.source === "task"
            ? null
            : suggestion;
      if (!inherited) {
        return null;
      }
      if (typeof taskThemeReasonFor === "function") {
        return taskThemeReasonFor(inherited);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  toggleTaskThemeMarks() {
    try {
      this.taskThemeMarksEnabled = !this.taskThemeMarksEnabled;
      const enabled = this.taskThemeMarksEnabled;
      this.applyMarkGateClass("bob-task-theme-marks", enabled);
      try {
        this.taskThemeSyncNativeAccessibility();
      } catch (error) {
        // Native aria updates are best-effort.
      }
      if (!enabled) {
        try {
          this.taskThemeCancelScheduledWork();
        } catch (error) {
          // Queue drop is best-effort.
        }
      }
      try {
        this.refreshTaskThemeMarkEditors();
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
        new Notice(enabled ? "Task type marks on" : "Task type marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.taskThemeMarksEnabled;
    }
  }

  // Unload cleanup for both task-theme gates (visibility + ledger tint).
  // Restores native Reading/query field content, drops queued frames, and
  // removes delegated hover hosts. Never throws.
  teardownTaskThemeMarksAndColors() {
    try {
      try {
        this.teardownTaskRootMarks();
      } catch (error) {
        // Root mark cleanup is best-effort.
      }
      try {
        this.taskThemeCancelScheduledWork();
      } catch (error) {
        // Queue drop is best-effort.
      }
      try {
        this.taskThemeRestoreRenderedHosts();
      } catch (error) {
        // Native restoration is best-effort.
      }
      try {
        this.taskThemeTeardownHover();
      } catch (error) {
        // Hover teardown is best-effort.
      }
      this.taskThemeMarksEnabled = false;
      this.pomodoroThemeColorsEnabled = false;
      if (typeof this.applyMarkGateClass === "function") {
        this.applyMarkGateClass("bob-task-theme-marks", false);
        this.applyMarkGateClass("bob-pomo-theme-colors", false);
        return;
      }
      const body =
        typeof document !== "undefined" && document ? document.body : null;
      const classes = body && body.classList;
      if (classes && typeof classes.remove === "function") {
        classes.remove("bob-task-theme-marks");
        classes.remove("bob-pomo-theme-colors");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
    }
  }
}

// Fallback fold when `dateMarkSelectionFold` is unavailable (isolated
// unit tests): touching the field reveals source; an endpoint in the
// folded run keeps that endpoint unfolded. Never throws.
function taskThemeFallbackFold(fieldStart, fieldEnd, foldLength, selectionRanges) {
  try {
    const start = Number(fieldStart);
    const end = Number(fieldEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return 0;
    }
    let folds = Number(foldLength) || 0;
    if (!Number.isFinite(folds) || folds < 0) {
      folds = 0;
    }
    folds = Math.floor(folds);
    const ranges = Array.isArray(selectionRanges) ? selectionRanges : [];
    for (const selection of ranges) {
      try {
        if (
          !selection ||
          typeof selection.from !== "number" ||
          typeof selection.to !== "number"
        ) {
          continue;
        }
        if (selection.from <= end && selection.to >= start) {
          return null;
        }
      } catch (error) {
        continue;
      }
    }
    const runStart = start - folds;
    for (const selection of ranges) {
      try {
        if (
          !selection ||
          typeof selection.from !== "number" ||
          typeof selection.to !== "number"
        ) {
          continue;
        }
        if (
          (selection.from > runStart && selection.from < start) ||
          (selection.to > runStart && selection.to < start)
        ) {
          return 0;
        }
      } catch (error) {
        continue;
      }
    }
    return folds;
  } catch (error) {
    return 0;
  }
}
