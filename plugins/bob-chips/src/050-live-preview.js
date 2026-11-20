// Live Preview chips: guarded ViewPlugin + WidgetType.
// Decorates whole eligible code spans inside visibleRanges only. One pass
// emits copy widgets and command-chip widgets (051-live-command-widget.js).
let copyChipLiveRefreshEffect = null;
function copyChipEnsureLiveRefresh() {
  if (copyChipLiveRefreshEffect) return copyChipLiveRefreshEffect;
  try {
    if (CopyChipsStateEffect && typeof CopyChipsStateEffect.define === "function") {
      copyChipLiveRefreshEffect = CopyChipsStateEffect.define();
    }
  } catch (error) {
    copyChipLiveRefreshEffect = null;
  }
  return copyChipLiveRefreshEffect;
}

let copyChipSourceFlashEffect = null;
function copyChipEnsureSourceFlash() {
  if (copyChipSourceFlashEffect) return copyChipSourceFlashEffect;
  try {
    if (CopyChipsStateEffect && typeof CopyChipsStateEffect.define === "function") {
      copyChipSourceFlashEffect = CopyChipsStateEffect.define();
    }
  } catch (error) {
    copyChipSourceFlashEffect = null;
  }
  return copyChipSourceFlashEffect;
}

// Closed-boundary reveal: any selection touching [from, to] reveals source.
// `selections` are {from, to} document offsets. Never throws.
function copyChipLiveShouldReveal(spanFrom, spanTo, selections) {
  try {
    const list = Array.isArray(selections) ? selections : [];
    for (const sel of list) {
      try {
        if (!sel || typeof sel !== "object") continue;
        const from = Number(sel.from);
        const to = Number(sel.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        if (lo <= spanTo && hi >= spanFrom) return true;
      } catch (error) {
        continue;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Gesture rule: primary-button release inside the same chip copies only when
// total movement stayed below 4px. Drags, cancellations, releases outside,
// and secondary buttons never copy. Never throws.
function copyChipLiveGestureShouldCopy(start, end, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    if (opts.alt === true) return false;
    if (opts.cancelled === true) return false;
    if (opts.releasedInside !== true) return false;
    if (Number(opts.button) !== 0 && opts.button !== undefined && opts.button !== null) {
      // Touch taps arrive with button undefined/null and pointerType touch.
      const pointer = String(opts.pointerType || "");
      if (pointer !== "touch") return false;
    }
    const sx = Number(start && start.x);
    const sy = Number(start && start.y);
    const ex = Number(end && end.x);
    const ey = Number(end && end.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
      return false;
    }
    const dx = ex - sx;
    const dy = ey - sy;
    return dx * dx + dy * dy < 16;
  } catch (error) {
    return false;
  }
}

function copyChipLiveGestureShouldEdit(start, end, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    if (opts.alt !== true) return false;
    const copyOpts = {};
    for (const key in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, key) && key !== "alt") copyOpts[key] = opts[key];
    }
    copyOpts.alt = false;
    return copyChipLiveGestureShouldCopy(start, end, copyOpts);
  } catch (error) {
    return false;
  }
}

function copyChipLiveTableForLine(lineText) {
  try {
    return String(lineText || "").indexOf("|") !== -1;
  } catch (error) {
    return false;
  }
}

// Returns true when the Obsidian syntax tree places `pos` inside an
// inline-code node. Unknown node names fail open (handled by the caller
// which still applies the grammar + inert filters).
function copyChipLivePosIsInlineCode(tree, pos) {
  try {
    if (!tree || typeof tree.resolveInner !== "function") return true;
    const resolved = tree.resolveInner(pos, 0);
    let node = resolved;
    let guard = 0;
    while (node && guard < 25) {
      guard += 1;
      const name = String((node && node.name) || (node && node.type && node.type.name) || "");
      if (/inline-?code/i.test(name)) return true;
      // Exclude contexts that must stay plain code.
      if (/link|wiki|math|comment|frontmatter|fence|codeblock|code-block/i.test(name)) {
        return false;
      }
      node = node.parent;
      if (!node) break;
    }
    // When the parser shape is unknown, fail open and let the grammar and
    // link/wikilink filters decide; the real-app harness pins the names.
    return true;
  } catch (error) {
    return true;
  }
}

function copyChipLiveLineIsIndentedCode(lineText) {
  try {
    const line = String(lineText || "");
    if (/^(?: {4}|\t)\S/.test(line)) return true;
    return false;
  } catch (error) {
    return false;
  }
}

// Pure per-line discovery of both kinds for one visible document line: one
// chipScanLine call, then table inference and the inert filters. Each chip
// is `{ kind, label, text, raw, lineFrom, from, to, lineText }` with
// absolute offsets. `tree` may be null in tests.
function chipLiveChipsForLine(lineText, lineFrom, tree, tableHint) {
  try {
    if (typeof lineText !== "string" || lineText === "") return [];
    if (copyChipLiveLineIsIndentedCode(lineText)) return [];
    // Physical multiline spans never decorate in Live Preview.
    const table = typeof tableHint === "boolean" ? tableHint : copyChipLiveTableForLine(lineText);
    let chips = null;
    try {
      chips = chipScanLine(lineText, { table });
    } catch (error) {
      return [];
    }
    if (!chips || chips.length === 0) return [];
    const out = [];
    for (const chip of chips) {
      try {
        const absFrom = lineFrom + chip.from;
        const absTo = lineFrom + chip.to;
        if (tree && typeof tree.resolveInner === "function") {
          let ok = true;
          // Sample the span interior; delimiters belong to CodeMark nodes.
          const sample = absFrom + 1 < absTo ? absFrom + 1 : absFrom;
          if (!copyChipLivePosIsInlineCode(tree, sample)) ok = false;
          if (ok) {
            try {
              // Exclude spans whose interior resolves inside a link.
              const resolved = tree.resolveInner(sample, 0);
              let cursor = resolved;
              let guard = 0;
              while (cursor && guard < 25) {
                guard += 1;
                const name = String((cursor && cursor.name) || (cursor && cursor.type && cursor.type.name) || "");
                if (/link|wiki|math/i.test(name)) {
                  ok = false;
                  break;
                }
                cursor = cursor.parent;
                if (!cursor) break;
              }
            } catch (error) {
              // Link exclusion is best-effort.
            }
          }
          if (!ok) continue;
        }
        out.push({
          kind: chip.kind,
          label: chip.label,
          text: chip.text,
          raw: chip.raw,
          lineFrom,
          from: absFrom,
          to: absTo,
          lineText,
        });
      } catch (error) {
        continue;
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

// The copy-kind view of chipLiveChipsForLine in its original shape.
function copyChipLiveChipsForLine(lineText, lineFrom, docOffsetBase, tree, tableHint) {
  const out = [];
  for (const chip of chipLiveChipsForLine(lineText, lineFrom, tree, tableHint)) {
    if (chip.kind !== "copy") continue;
    out.push({
      label: chip.label,
      text: chip.text,
      lineFrom: chip.lineFrom,
      from: chip.from,
      to: chip.to,
      lineText: chip.lineText,
    });
  }
  return out;
}

let CopyChipLiveWidgetClass = null;
function copyChipEnsureLiveWidget() {
  if (CopyChipLiveWidgetClass) return CopyChipLiveWidgetClass;
  try {
    if (!CopyChipsWidgetType || typeof CopyChipsWidgetType !== "function") return null;
    CopyChipLiveWidgetClass = class extends CopyChipsWidgetType {
      constructor(model) {
        super();
        this.model = model && typeof model === "object" ? model : {};
        this.label = this.model.label !== undefined ? this.model.label : null;
        this.text = String(this.model.text || "");
        this.spanFrom = Number(this.model.from);
        this.spanTo = Number(this.model.to);
        this.plugin = this.model.plugin || null;
        this.gesture = null;
      }

      eq(other) {
        try {
          return Boolean(
            other &&
              other instanceof CopyChipLiveWidgetClass &&
              other.label === this.label &&
              other.text === this.text &&
              other.spanFrom === this.spanFrom &&
              other.spanTo === this.spanTo,
          );
        } catch (error) {
          return false;
        }
      }

      ignoreEvent() {
        return true;
      }

      toDOM(view) {
        try {
          const ownerDoc =
            (view && view.dom && view.dom.ownerDocument) ||
            (typeof document !== "undefined" ? document : null);
          const host = copyChipBuildInline(
            ownerDoc,
            { label: this.label, text: this.text },
            { interactive: false, editHint: true },
          );
          if (!host) {
            const fallback = ownerDoc ? ownerDoc.createElement("span") : null;
            if (fallback) {
              try {
                fallback.textContent = this.label == null ? this.text : String(this.label);
              } catch (error) {
                // Fallback text is best-effort.
              }
              return fallback;
            }
            return ownerDoc.createElement("span");
          }
          try {
            host.setAttribute("tabindex", "0");
          } catch (error) {
            // Focusability is best-effort.
          }
          try {
            if (typeof copyChipNoteWidgetPosition === "function") {
              copyChipNoteWidgetPosition(host, this.spanFrom, this.spanTo);
            }
          } catch (error) {
            // Position bookkeeping is best-effort.
          }
          const widget = this;
          const getPos = (event) => {
            try {
              const touch =
                (event && event.touches && event.touches[0]) ||
                (event && event.changedTouches && event.changedTouches[0]) ||
                null;
              if (touch) return { x: touch.clientX, y: touch.clientY };
              return { x: event.clientX, y: event.clientY };
            } catch (error) {
              return { x: 0, y: 0 };
            }
          };
          try {
            if (host.addEventListener) {
              host.addEventListener("mousedown", (event) => {
                try {
                  if (event && event.button !== 0) {
                    widget.gesture = null;
                    return;
                  }
                  try {
                    event.preventDefault();
                  } catch (error) {
                    // Caret suppression is best-effort.
                  }
                  widget.gesture = {
                    start: getPos(event),
                    button: event.button,
                    pointerType: "mouse",
                    alt: Boolean(event && event.altKey),
                  };
                } catch (error) {
                  widget.gesture = null;
                }
              });
              host.addEventListener("mouseup", (event) => {
                try {
                  const start = widget.gesture && widget.gesture.start;
                  const alt = Boolean((widget.gesture && widget.gesture.alt) || (event && event.altKey));
                  const gestureOpts = {
                    button: event ? event.button : 0,
                    releasedInside: true,
                    pointerType: "mouse",
                    alt,
                  };
                  const shouldEdit = copyChipLiveGestureShouldEdit(start, getPos(event), gestureOpts);
                  const should = copyChipLiveGestureShouldCopy(start, getPos(event), gestureOpts);
                  widget.gesture = null;
                  if (shouldEdit) {
                    try {
                      event.preventDefault();
                    } catch (error) {
                      // Default suppression is best-effort.
                    }
                    try {
                      copyChipAuthorOpenFromWidget(
                        widget.plugin,
                        view,
                        widget.spanFrom,
                        widget.spanTo,
                        { label: widget.label, text: widget.text },
                      );
                    } catch (error) {
                      // Author open is best-effort.
                    }
                    return;
                  }
                  if (!should) return;
                  try {
                    event.preventDefault();
                  } catch (error) {
                    // Default suppression is best-effort.
                  }
                  copyChipWrite(widget.text).then((result) => {
                    try {
                      if (result && result.ok) copyChipShowFeedback(host, "success");
                      else copyChipFail(host, (result && result.reason) || "copy failed");
                    } catch (error) {
                      // Feedback is best-effort.
                    }
                  });
                } catch (error) {
                  widget.gesture = null;
                }
              });
              host.addEventListener("touchstart", (event) => {
                try {
                  widget.gesture = { start: getPos(event), button: 0, pointerType: "touch" };
                } catch (error) {
                  widget.gesture = null;
                }
              }, { passive: true });
              host.addEventListener("touchend", (event) => {
                try {
                  const start = widget.gesture && widget.gesture.start;
                  const should = copyChipLiveGestureShouldCopy(start, getPos(event), {
                    button: 0,
                    releasedInside: true,
                    pointerType: "touch",
                  });
                  widget.gesture = null;
                  if (!should) return;
                  try {
                    event.preventDefault();
                  } catch (error) {
                    // Default suppression is best-effort.
                  }
                  copyChipWrite(widget.text).then((result) => {
                    try {
                      if (result && result.ok) copyChipShowFeedback(host, "success");
                      else copyChipFail(host, (result && result.reason) || "copy failed");
                    } catch (error) {
                      // Feedback is best-effort.
                    }
                  });
                } catch (error) {
                  widget.gesture = null;
                }
              });
              host.addEventListener("keydown", (event) => {
                try {
                  if (!event || (event.key !== "Enter" && event.key !== " ")) return;
                  try {
                    event.preventDefault();
                  } catch (error) {
                    // Default suppression is best-effort.
                  }
                  copyChipWrite(widget.text).then((result) => {
                    try {
                      if (result && result.ok) copyChipShowFeedback(host, "success");
                      else copyChipFail(host, (result && result.reason) || "copy failed");
                    } catch (error) {
                      // Feedback is best-effort.
                    }
                  });
                } catch (error) {
                  // Keyboard activation never throws.
                }
              });
            }
          } catch (error) {
            // Gesture wiring is best-effort.
          }
          return host;
        } catch (error) {
          try {
            const ownerDoc = (view && view.dom && view.dom.ownerDocument) || document;
            const fallback = ownerDoc.createElement("span");
            fallback.textContent = String(this.text || "");
            return fallback;
          } catch (inner) {
            throw error;
          }
        }
      }

      destroy(dom) {
        try {
          copyChipClearFeedback(dom);
        } catch (error) {
          // Widget teardown never throws.
        }
      }
    };
    return CopyChipLiveWidgetClass;
  } catch (error) {
    return null;
  }
}

function copyChipBuildLiveDecorations(view, plugin) {
  try {
    if (
      !view ||
      !view.state ||
      !CopyChipsDecoration ||
      typeof CopyChipsDecoration.replace !== "function" ||
      !CopyChipsRangeSetBuilder
    ) {
      return null;
    }
    let live = false;
    try {
      live =
        CopyChipsEditorLivePreviewField &&
        typeof view.state.field === "function" &&
        view.state.field(CopyChipsEditorLivePreviewField) === true;
    } catch (error) {
      return CopyChipsDecoration.none;
    }
    if (!live) return CopyChipsDecoration.none;
    const doc = view.state.doc;
    if (!doc || typeof doc.lineAt !== "function" || typeof doc.sliceString !== "function") {
      return CopyChipsDecoration.none;
    }
    let tree = null;
    try {
      if (typeof CopyChipsSyntaxTree === "function") tree = CopyChipsSyntaxTree(view.state);
      else if (CopyChipsSyntaxTree && typeof CopyChipsSyntaxTree.resolveInner === "function") {
        tree = CopyChipsSyntaxTree;
      }
    } catch (error) {
      tree = null;
    }
    let selections = [];
    try {
      if (view.state.selection && Array.isArray(view.state.selection.ranges)) {
        selections = view.state.selection.ranges.map((range) => ({
          from: range.from,
          to: range.to,
        }));
      }
    } catch (error) {
      selections = [];
    }
    // Full-document line split only feeds fence/frontmatter state; chip
    // discovery stays inside visibleRanges.
    let allLines = null;
    try {
      allLines = doc.toString().split("\n");
    } catch (error) {
      allLines = null;
    }
    const seen = new Set();
    const found = [];
    const ranges = Array.isArray(view.visibleRanges) ? view.visibleRanges : [];
    for (const range of ranges) {
      try {
        if (!range || typeof range.from !== "number" || typeof range.to !== "number") continue;
        let pos = Math.max(0, range.from);
        const end = Math.min(range.to, typeof doc.length === "number" ? doc.length : range.to);
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
          const lineNo = typeof line.number === "number" ? line.number - 1 : null;
          const key = line.from + ":" + line.to;
          if (!seen.has(key)) {
            seen.add(key);
            let fenced = false;
            try {
              if (allLines && Number.isInteger(lineNo)) {
                fenced =
                  copyChipCursorLineIsFenced(allLines, lineNo) ||
                  copyChipCursorInFrontmatter(allLines, lineNo);
              }
            } catch (error) {
              fenced = false;
            }
            if (!fenced && !copyChipLiveLineIsIndentedCode(line.text)) {
              const chips = chipLiveChipsForLine(line.text, line.from, tree, undefined);
              for (const chip of chips) {
                try {
                  if (copyChipLiveShouldReveal(chip.from, chip.to, selections)) continue;
                  chip.line = lineNo;
                  found.push(chip);
                } catch (error) {
                  continue;
                }
              }
            }
          }
          if (line.to >= end || line.to < pos) break;
          pos = line.to + 1;
        }
      } catch (error) {
        continue;
      }
    }
    found.sort((a, b) => a.from - b.from);
    const WidgetClass = copyChipEnsureLiveWidget();
    if (!WidgetClass) return CopyChipsDecoration.none;
    const RunWidgetClass = typeof commandChipEnsureLiveWidget === "function" ? commandChipEnsureLiveWidget() : null;
    const builder = new CopyChipsRangeSetBuilder();
    for (const chip of found) {
      try {
        let widget = null;
        if (chip.kind === "run") {
          if (!RunWidgetClass) continue;
          widget = new RunWidgetClass({
            label: chip.label,
            text: chip.text,
            raw: chip.raw,
            from: chip.from,
            to: chip.to,
            lineFrom: chip.lineFrom,
            line: chip.line,
            plugin: plugin || null,
          });
        } else {
          widget = new WidgetClass({
            label: chip.label,
            text: chip.text,
            from: chip.from,
            to: chip.to,
            plugin: plugin || null,
          });
        }
        builder.add(chip.from, chip.to, CopyChipsDecoration.replace({ widget }));
      } catch (error) {
        continue;
      }
    }
    try {
      return builder.finish();
    } catch (error) {
      return CopyChipsDecoration.none;
    }
  } catch (error) {
    try {
      return CopyChipsDecoration ? CopyChipsDecoration.none : null;
    } catch (inner) {
      return null;
    }
  }
}

function copyChipLiveShouldRebuild(update) {
  try {
    if (!update || typeof update !== "object") return false;
    if (update.docChanged === true || update.viewportChanged === true) return true;
    if (update.selectionSet === true) return true;
    try {
      const refresh = copyChipEnsureLiveRefresh();
      const transactions = update.transactions || [];
      for (const tr of transactions) {
        const effects = tr && tr.effects;
        const list = !effects ? [] : Array.isArray(effects) ? effects : [effects];
        for (const effect of list) {
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
      if (
        CopyChipsEditorLivePreviewField &&
        update.startState &&
        update.state &&
        typeof update.startState.field === "function" &&
        typeof update.state.field === "function"
      ) {
        if (update.startState.field(CopyChipsEditorLivePreviewField) !== update.state.field(CopyChipsEditorLivePreviewField)) {
          return true;
        }
      }
    } catch (error) {
      // Mode comparison is best-effort.
    }
    return false;
  } catch (error) {
    return false;
  }
}

function copyChipCreateLiveExtension(plugin) {
  try {
    if (!copyChipsEditorAvailable()) return null;
    if (!CopyChipsViewPlugin || typeof CopyChipsViewPlugin.fromClass !== "function") return null;
    const host = plugin || null;
    const PluginClass = class {
      constructor(view) {
        this.view = view;
        try {
          if (host && host.copyChipEditorViews instanceof Set) {
            host.copyChipEditorViews.add(view);
          }
        } catch (error) {
          // View tracking is best-effort.
        }
        try {
          this.decorations = copyChipBuildLiveDecorations(view, host);
        } catch (error) {
          this.decorations = CopyChipsDecoration.none;
        }
      }

      update(update) {
        try {
          if (copyChipLiveShouldRebuild(update)) {
            this.decorations = copyChipBuildLiveDecorations(update.view, host);
          }
        } catch (error) {
          // Keep the previous valid decorations on failure.
        }
      }

      destroy() {
        try {
          if (host && host.copyChipEditorViews instanceof Set) {
            host.copyChipEditorViews.delete(this.view);
          }
        } catch (error) {
          // View cleanup is best-effort.
        }
      }
    };
    const extension = CopyChipsViewPlugin.fromClass(PluginClass, {
      decorations: (value) => value.decorations,
    });
    try {
      if (CopyChipsPrec && typeof CopyChipsPrec.highest === "function") {
        return CopyChipsPrec.highest(extension);
      }
    } catch (error) {
      // Precedence is best-effort.
    }
    return extension;
  } catch (error) {
    return null;
  }
}

let copyChipSourceFlashField = null;
function copyChipCreateSourceFlashField() {
  if (copyChipSourceFlashField) return copyChipSourceFlashField;
  try {
    if (
      !CopyChipsStateField ||
      typeof CopyChipsStateField.define !== "function" ||
      !CopyChipsDecoration ||
      typeof CopyChipsDecoration.mark !== "function" ||
      !CopyChipsEditorView ||
      !CopyChipsRangeSetBuilder
    ) {
      return null;
    }
    const flashEffect = copyChipEnsureSourceFlash();
    if (!flashEffect) return null;
    copyChipSourceFlashField = CopyChipsStateField.define({
      create() {
        return CopyChipsDecoration.none;
      },
      update(value, tr) {
        try {
          let next = value;
          try {
            if (tr.docChanged && next && typeof next.map === "function") {
              try {
                next = next.map(tr.changes);
              } catch (error) {
                next = CopyChipsDecoration.none;
              }
            } else if (tr.docChanged) {
              next = CopyChipsDecoration.none;
            }
          } catch (error) {
            next = CopyChipsDecoration.none;
          }
          const effects = tr && tr.effects;
          const list = !effects ? [] : Array.isArray(effects) ? effects : [effects];
          for (const effect of list) {
            try {
              const isOurs =
                effect === flashEffect ||
                (flashEffect && typeof flashEffect.is === "function" && effect && effect.is
                  ? (() => {
                      try {
                        return effect.is(flashEffect);
                      } catch (ignore) {
                        return false;
                      }
                    })()
                  : false);
              if (!isOurs) continue;
              const payload = effect && effect.value;
              if (!payload || typeof payload.from !== "number" || typeof payload.to !== "number") {
                next = CopyChipsDecoration.none;
              } else {
                const builder = new CopyChipsRangeSetBuilder();
                try {
                  builder.add(
                    payload.from,
                    payload.to,
                    CopyChipsDecoration.mark({ class: "bob-copy-chip-source-flash" }),
                  );
                  next = builder.finish();
                } catch (error) {
                  next = CopyChipsDecoration.none;
                }
              }
            } catch (error) {
              continue;
            }
          }
          return next;
        } catch (error) {
          return CopyChipsDecoration.none;
        }
      },
      provide(field) {
        try {
          return CopyChipsEditorView.decorations.from(field);
        } catch (error) {
          return null;
        }
      },
    });
    return copyChipSourceFlashField;
  } catch (error) {
    return null;
  }
}
