// --- Task date marks: Live Preview, rendered views, toggle, api ----------
// `BobLedgerToolsDateMarksMixin` (see `310-install-methods.js`).
// Synchronous throughout; never throws.
class BobLedgerToolsDateMarksMixin {
  setupDateMarks() {
    try {
      if (typeof this.dateMarksEnabled !== "boolean") {
        this.dateMarksEnabled = true;
      }
      try {
        const body =
          typeof document !== "undefined" && document
            ? document.body
            : null;
        if (body && body.classList) {
          if (this.dateMarksEnabled) {
            body.classList.add("bob-date-marks");
          } else {
            body.classList.remove("bob-date-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-date-marks",
            name: "Toggle task date marks",
            callback: () => this.toggleDateMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createDateMarkExtension();
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
            (el, ctx) => this.renderDateMarksIn(el, ctx),
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

  dateMarksAvailable() {
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
          DateMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createDateMarkExtension() {
    try {
      if (!this.dateMarksAvailable()) {
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
            this.decorations = plugin.buildDateMarkDecorations(view);
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
            if (plugin.dateMarkShouldRebuild(u)) {
              this.decorations = plugin.buildDateMarkDecorations(u.view);
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

  dateMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
        const refresh = ensureDateMarksRefresh();
        const transactions = u.transactions || [];
        for (const transaction of transactions) {
          try {
            const effects =
              transaction && transaction.effects !== undefined
                ? transaction.effects
                : null;
            const list = !effects
              ? []
              : Array.isArray(effects)
                ? effects
                : [effects];
            for (const effect of list) {
              try {
                if (!effect || !refresh) {
                  continue;
                }
                if (
                  effect === refresh ||
                  (typeof effect.is === "function" && effect.is(refresh))
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

  buildDateMarkDecorations(view) {
    try {
      if (!this.dateMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !DateMarkWidget) {
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
      let today = null;
      try {
        today = this.dateMarksToday();
      } catch (error) {
        today = null;
      }
      if (!today) {
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
              if (line.text.indexOf("::") !== -1) {
                const sources = dateMarkSources(line.text);
                for (const source of sources) {
                  try {
                    const absFrom = line.from + source.fieldStart;
                    const absTo = line.from + source.fieldEnd;
                    // Reveal per field: hide while any selection
                    // overlaps this field span (fold excluded).
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
                        inCode = freshnessMarkPosInCode(tree, absFrom);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (inCode) {
                      continue;
                    }
                    const model = dateMarkModel(
                      source.field,
                      source.date,
                      today,
                    );
                    if (!model) {
                      continue;
                    }
                    const from = absFrom - source.foldLength;
                    builder.add(
                      from,
                      absTo,
                      Decoration.replace({
                        widget: new DateMarkWidget(
                          model,
                          source.foldLength,
                        ),
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

  dateMarkExcludedAncestor(node, root) {
    try {
      let current = node && node.parentNode ? node.parentNode : null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const tag =
            current.tagName || current.nodeName
              ? String(current.tagName || current.nodeName)
              : "";
          if (
            tag === "CODE" ||
            tag === "code" ||
            tag === "PRE" ||
            tag === "pre"
          ) {
            return true;
          }
          let classText = "";
          try {
            if (
              current.classList &&
              typeof current.classList.contains === "function"
            ) {
              if (current.classList.contains("bob-date-mark")) {
                return true;
              }
              if (current.classList.contains("bob-priority-mark")) {
                return true;
              }
              if (current.classList.contains("bob-fresh-mark")) {
                return true;
              }
              if (
                current.classList.contains("dataview") &&
                current.classList.contains("inline-field")
              ) {
                return true;
              }
            }
            if (typeof current.className === "string") {
              classText = current.className;
            } else if (typeof current.getAttribute === "function") {
              classText = current.getAttribute("class") || "";
            }
          } catch (error) {
            classText = "";
          }
          if (
            classText &&
            (classText.indexOf("bob-date-mark") !== -1 ||
              classText.indexOf("bob-priority-mark") !== -1 ||
              classText.indexOf("bob-fresh-mark") !== -1 ||
              (classText.indexOf("dataview") !== -1 &&
                classText.indexOf("inline-field") !== -1))
          ) {
            return true;
          }
        } catch (error) {
          // Keep walking on per-ancestor failure.
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  renderDateMarksIn(el, ctx) {
    try {
      if (!this.dateMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      let today = null;
      try {
        today = this.dateMarksToday();
      } catch (error) {
        today = null;
      }
      if (!today) {
        return;
      }
      const textNodes = [];
      try {
        const docNode =
          (el.ownerDocument && el.ownerDocument) ||
          (typeof document !== "undefined" ? document : null);
        const showText =
          (docNode &&
            docNode.defaultView &&
            docNode.defaultView.NodeFilter &&
            docNode.defaultView.NodeFilter.SHOW_TEXT) ||
          (typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4);
        let walker = null;
        try {
          const creator =
            docNode && typeof docNode.createTreeWalker === "function"
              ? docNode
              : typeof document !== "undefined" &&
                  typeof document.createTreeWalker === "function"
                ? document
                : null;
          if (creator) {
            walker = creator.createTreeWalker(el, showText, {
              acceptNode: (node) => {
                try {
                  if (this.dateMarkExcludedAncestor(node, el)) {
                    return 2;
                  }
                  return 1;
                } catch (error) {
                  return 1;
                }
              },
            });
          }
        } catch (error) {
          walker = null;
        }
        if (walker) {
          let current = null;
          try {
            current = walker.nextNode();
          } catch (error) {
            current = null;
          }
          let guard = 0;
          while (current && guard < 10000) {
            guard += 1;
            try {
              const value =
                typeof current.nodeValue === "string"
                  ? current.nodeValue
                  : typeof current.textContent === "string"
                    ? current.textContent
                    : "";
              if (value.indexOf("::") !== -1) {
                textNodes.push(current);
              }
            } catch (error) {
              // Skip unreadable nodes.
            }
            try {
              current = walker.nextNode();
            } catch (error) {
              break;
            }
          }
        } else {
          // No TreeWalker (non-DOM tests): a compact manual descent.
          const stack = [el];
          let guard = 0;
          while (stack.length > 0 && guard < 10000) {
            guard += 1;
            const top = stack.pop();
            try {
              const children = (top && top.childNodes) || [];
              for (let index = children.length - 1; index >= 0; index -= 1) {
                const child = children[index];
                if (!child || this.dateMarkExcludedAncestor(child, el)) {
                  continue;
                }
                if (child.nodeType === 3) {
                  const value =
                    typeof child.nodeValue === "string"
                      ? child.nodeValue
                      : typeof child.textContent === "string"
                        ? child.textContent
                        : "";
                  if (value.indexOf("::") !== -1) {
                    textNodes.push(child);
                  }
                } else if (child.nodeType === 1) {
                  const tag = String(child.tagName || child.nodeName || "");
                  if (
                    tag !== "CODE" &&
                    tag !== "code" &&
                    tag !== "PRE" &&
                    tag !== "pre"
                  ) {
                    stack.push(child);
                  }
                }
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        return;
      }
      for (const textNode of textNodes) {
        try {
          if (!textNode || !textNode.parentNode) {
            continue;
          }
          if (this.dateMarkExcludedAncestor(textNode, el)) {
            continue;
          }
          const value =
            typeof textNode.nodeValue === "string"
              ? textNode.nodeValue
              : typeof textNode.textContent === "string"
                ? textNode.textContent
                : "";
          if (!value || value.indexOf("::") === -1) {
            continue;
          }
          // No line-type gate: any canonical field outside code marks.
          const sources = dateMarkSourcesInText(value);
          if (!sources || sources.length === 0) {
            continue;
          }
          const parent = textNode.parentNode;
          if (!parent) {
            continue;
          }
          const docNode =
            textNode.ownerDocument ||
            (typeof document !== "undefined" ? document : null);
          if (!docNode) {
            continue;
          }
          const marks = [];
          let usable = true;
          for (const source of sources) {
            try {
              const model = dateMarkModel(
                source.field,
                source.date,
                today,
              );
              if (!model) {
                usable = false;
                break;
              }
              const markEl = buildDateMarkElement(docNode, model, {
                foldSpace: false,
                rendered: true,
              });
              if (!markEl) {
                usable = false;
                break;
              }
              marks.push({ source, element: markEl });
            } catch (error) {
              usable = false;
              break;
            }
          }
          if (!usable || marks.length === 0) {
            continue;
          }
          try {
            let cursor = 0;
            for (const mark of marks) {
              try {
                const beforeText = value.slice(
                  cursor,
                  mark.source.fieldStart,
                );
                if (beforeText) {
                  parent.insertBefore(
                    docNode.createTextNode(beforeText),
                    textNode,
                  );
                }
                parent.insertBefore(mark.element, textNode);
                cursor = mark.source.fieldEnd;
              } catch (error) {
                usable = false;
                break;
              }
            }
            if (!usable) {
              continue;
            }
            const afterText = value.slice(cursor);
            if (afterText) {
              parent.insertBefore(
                docNode.createTextNode(afterText),
                textNode,
              );
            }
            parent.removeChild(textNode);
          } catch (error) {
            continue;
          }
        } catch (error) {
          continue;
        }
      }
      // Tasks renders every description through `MarkdownRenderer`,
      // so this fires once per result row; the 267 mixin schedules
      // the narrow frame pass from here.
      try {
        if (typeof this.scheduleTasksResultDateMarks === "function") {
          this.scheduleTasksResultDateMarks(el);
        }
      } catch (error) {
        // Tasks-result scheduling is best-effort.
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  toggleDateMarks() {
    try {
      this.dateMarksEnabled = !this.dateMarksEnabled;
      const enabled = this.dateMarksEnabled;
      try {
        const body =
          typeof document !== "undefined" && document
            ? document.body
            : null;
        if (body && body.classList) {
          if (enabled) {
            body.classList.add("bob-date-marks");
          } else {
            body.classList.remove("bob-date-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshDateMarkEditors();
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
          enabled ? "Date marks on" : "Date marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.dateMarksEnabled;
    }
  }

  refreshDateMarkEditors() {
    try {
      const refresh = ensureDateMarksRefresh();
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

  // Today's local date for the label grammar. Never throws.
  dateMarksToday() {
    try {
      return formatLocalDate(new Date());
    } catch (error) {
      return null;
    }
  }

  // Midnight rollover: refresh editors and relabel rendered marks
  // in place on a day change. Never throws.
  refreshDateMarksForRollover(now) {
    try {
      let day = null;
      try {
        day = formatLocalDate(now instanceof Date ? now : new Date());
      } catch (error) {
        day = null;
      }
      if (!day) {
        return false;
      }
      if (this.dateMarksDay === null || this.dateMarksDay === undefined) {
        this.dateMarksDay = day;
        return false;
      }
      if (this.dateMarksDay === day) {
        return false;
      }
      this.dateMarksDay = day;
      try {
        this.refreshDateMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        this.relabelRenderedDateMarks(day);
      } catch (error) {
        // In-place relabel is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Relabel every rendered mark in place. Returns the count.
  // Never throws.
  relabelRenderedDateMarks(todayText) {
    try {
      let today = null;
      try {
        today =
          parseFreshDateStrict(String(todayText || "")) ||
          freshnessNormalizeDateText(todayText);
      } catch (error) {
        today = null;
      }
      if (!today) {
        return 0;
      }
      const root =
        typeof document !== "undefined" ? document : null;
      if (!root || typeof root.querySelectorAll !== "function") {
        return 0;
      }
      let nodes = null;
      try {
        nodes = root.querySelectorAll(
          '.bob-date-mark[data-rendered="true"]',
        );
      } catch (error) {
        return 0;
      }
      if (!nodes) {
        return 0;
      }
      const list = typeof nodes.length === "number" ? nodes : [];
      let count = 0;
      for (const node of list) {
        try {
          const get =
            node && typeof node.getAttribute === "function"
              ? (name) => node.getAttribute(name)
              : () => null;
          const model = dateMarkModel(get("data-field"), get("data-date"), today);
          if (!model) {
            continue;
          }
          // Label text, `aria-label`, and `data-when`: each write is
          // best-effort, so a partial DOM never breaks the loop.
          try {
            const labelEl =
              node && typeof node.querySelector === "function"
                ? node.querySelector(".bob-date-mark-label")
                : null;
            const owner =
              (node && node.ownerDocument) ||
              (typeof document !== "undefined" ? document : null);
            if (labelEl && owner && typeof owner.createTextNode === "function") {
              while (labelEl.firstChild) {
                labelEl.removeChild(labelEl.firstChild);
              }
              labelEl.appendChild(owner.createTextNode(model.label));
            }
          } catch (error) {
            // Label text is best-effort.
          }
          try {
            if (node && typeof node.setAttribute === "function") {
              node.setAttribute("data-when", model.when);
              const hidden =
                typeof node.hasAttribute === "function" &&
                node.hasAttribute("aria-hidden");
              if (!hidden) {
                node.setAttribute("aria-label", model.tooltip);
              }
            }
          } catch (error) {
            // Attributes are best-effort.
          }
          count += 1;
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  // Additive `api.dateMarks` v1 namespace. Synchronous and never
  // throwing; the top-level api stays v3.
  dateMarksApi() {
    try {
      const plugin = this;
      return Object.freeze({
        version: 1,
        fields: Object.freeze([
          "created",
          "scheduled",
          "completion",
          "cancelled",
        ]),
        model: (field, dateText) => {
          try {
            let today = null;
            try {
              today = plugin.dateMarksToday();
            } catch (error) {
              today = null;
            }
            return dateMarkModel(field, dateText, today);
          } catch (error) {
            return null;
          }
        },
        render: (host, field, dateText, options) => {
          try {
            if (!host || typeof host.appendChild !== "function") {
              return null;
            }
            let today = null;
            try {
              today = plugin.dateMarksToday();
            } catch (error) {
              today = null;
            }
            const model = dateMarkModel(field, dateText, today);
            if (!model) {
              return null;
            }
            const docNode =
              (host.ownerDocument && host.ownerDocument) ||
              (typeof document !== "undefined" ? document : null);
            if (!docNode) {
              return null;
            }
            const settings =
              options && typeof options === "object" ? options : {};
            const el = buildDateMarkElement(docNode, model, {
              foldSpace: false,
              decorative: Boolean(settings.decorative),
              inheritColor: Boolean(settings.inheritColor),
            });
            if (!el) {
              return null;
            }
            host.appendChild(el);
            return el;
          } catch (error) {
            return null;
          }
        },
      });
    } catch (error) {
      return Object.freeze({
        version: 1,
        fields: Object.freeze([
          "created",
          "scheduled",
          "completion",
          "cancelled",
        ]),
        model: () => null,
        render: () => null,
      });
    }
  }
}
