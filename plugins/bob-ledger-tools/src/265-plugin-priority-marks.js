// --- Task priority marks: Live Preview, rendered views, toggle, api --------
// `BobLedgerToolsPriorityMarksMixin`, installed in
// `310-install-methods.js` after the freshness-mark render mixin.
// Mirrors `250-plugin-freshness-mark-model.js` (setup, extension,
// toggle) and `260-plugin-freshness-mark-render.js` (rebuild,
// decorations, post-processor, refresh), but the model is pure:
// `priorityMarkModel(value, ladder)` needs no memo rows, only the
// cached ladder snapshot below. Every method is synchronous and
// never throws.
class BobLedgerToolsPriorityMarksMixin {
  setupPriorityMarks() {
    try {
      if (typeof this.priorityMarksEnabled !== "boolean") {
        this.priorityMarksEnabled = true;
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.priorityMarksEnabled) {
            document.body.classList.add("bob-priority-marks");
          } else {
            document.body.classList.remove("bob-priority-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-priority-marks",
            name: "Toggle task priority marks",
            callback: () => this.togglePriorityMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createPriorityMarkExtension();
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
            (el, ctx) => this.renderPriorityMarksIn(el, ctx),
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

  priorityMarksAvailable() {
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
          PriorityMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createPriorityMarkExtension() {
    try {
      if (!this.priorityMarksAvailable()) {
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
            this.decorations = plugin.buildPriorityMarkDecorations(view);
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
            if (plugin.priorityMarkShouldRebuild(u)) {
              this.decorations =
                plugin.buildPriorityMarkDecorations(u.view);
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

  priorityMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
        const refresh = ensurePriorityMarksRefresh();
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

  // Cached priority ladder snapshot: `{ path, statKey, checkedAt,
  // ladder }`. Reads `planConfigPath()` through the same optional
  // `fs` / `parseYaml` / `Platform.isDesktopApp` guards as
  // `loadFreshnessConfig`; the file is stat-checked at most once
  // per 60-second tick and reparsed only on change. Mobile and a
  // missing or unparsable file yield a null ladder (tooltips omit
  // P-labels instead of guessing). Never throws.
  priorityLadderSnapshot(now = new Date()) {
    const fallback = () => ({ ladder: null });
    try {
      const configPath =
        typeof planConfigPath === "function" ? planConfigPath() : "";
      const cached = this.priorityLadderCache;
      let nowMs = NaN;
      try {
        nowMs =
          now instanceof Date
            ? now.getTime()
            : Number.isFinite(Number(now))
              ? Number(now)
              : Date.now();
      } catch (error) {
        nowMs = Date.now();
      }
      if (
        cached &&
        cached.path === configPath &&
        Number.isFinite(nowMs) &&
        Number.isFinite(cached.checkedAt) &&
        nowMs - cached.checkedAt < 60 * 1000
      ) {
        return { ladder: cached.ladder };
      }
      // Mobile has no config file: unknown ladder, cached like any
      // other key so the check stays cheap.
      try {
        const platform =
          typeof Platform !== "undefined" ? Platform : null;
        if (platform && platform.isDesktopApp === false) {
          this.priorityLadderCache = {
            path: configPath,
            statKey: "mobile",
            checkedAt: nowMs,
            ladder: null,
          };
          return { ladder: null };
        }
      } catch (error) {
        // Fall through to the file read.
      }
      // One stat per check: missing-file errors become part of the
      // key so creation and deletion invalidate like edits do.
      let statKey = null;
      try {
        const fsModule =
          typeof planRequireOptionalNodeModule === "function"
            ? planRequireOptionalNodeModule("fs")
            : null;
        if (fsModule && typeof fsModule.statSync === "function") {
          try {
            const stat = fsModule.statSync(configPath);
            const mtime =
              stat && typeof stat.mtimeMs === "number"
                ? stat.mtimeMs
                : String(stat && stat.mtime);
            statKey = mtime + ":" + String(stat && stat.size);
          } catch (statError) {
            statKey =
              "missing:" +
              String((statError && statError.code) || "error");
          }
        }
      } catch (error) {
        statKey = null;
      }
      if (
        cached &&
        cached.path === configPath &&
        statKey !== null &&
        cached.statKey === statKey
      ) {
        cached.checkedAt = nowMs;
        return { ladder: cached.ladder };
      }
      let ladder = null;
      try {
        const fsModule =
          typeof planRequireOptionalNodeModule === "function"
            ? planRequireOptionalNodeModule("fs")
            : null;
        if (
          fsModule &&
          typeof fsModule.readFileSync === "function" &&
          typeof parseYaml === "function"
        ) {
          const raw = fsModule.readFileSync(configPath, "utf8");
          ladder = coercePriorityLadder(parseYaml(raw));
        }
      } catch (error) {
        ladder = null;
      }
      this.priorityLadderCache = {
        path: configPath,
        statKey,
        checkedAt: nowMs,
        ladder,
      };
      return { ladder };
    } catch (error) {
      return fallback();
    }
  }

  buildPriorityMarkDecorations(view) {
    try {
      if (!this.priorityMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !PriorityMarkWidget) {
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
      let ladder = null;
      try {
        ladder = this.priorityLadderSnapshot().ladder;
      } catch (error) {
        ladder = null;
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
              if (line.text.indexOf("priority::") !== -1) {
                const source = priorityMarkSource(line.text);
                if (source) {
                  const absFrom = line.from + source.fieldStart;
                  const absTo = line.from + source.fieldEnd;
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
                      if (tree) {
                        inCode = freshnessMarkPosInCode(tree, absFrom);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (!inCode) {
                      const model = priorityMarkModel(source.value, ladder);
                      if (model) {
                        const from =
                          line.from +
                          source.fieldStart -
                          (source.foldSpace ? 1 : 0);
                        builder.add(
                          from,
                          absTo,
                          Decoration.replace({
                            widget: new PriorityMarkWidget(
                              model,
                              source.foldSpace,
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

  priorityMarkExcludedAncestor(node, root) {
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
            classText.indexOf("bob-priority-mark") !== -1
          ) {
            return true;
          }
          if (
            classText &&
            classText.indexOf("bob-fresh-mark") !== -1
          ) {
            return true;
          }
          if (
            classText &&
            classText.indexOf("dataview") !== -1 &&
            classText.indexOf("inline-field") !== -1
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

  // The nearest `li` ancestor of `node` (up to `root`), or null.
  // Rendered-view marks need a `task-list-item` one. Never throws.
  priorityMarkNearestLi(node, root) {
    try {
      let current = node && node.parentNode ? node.parentNode : null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const tag = String(
            current.tagName || current.nodeName || "",
          ).toUpperCase();
          if (tag === "LI") {
            return current;
          }
        } catch (error) {
          // Keep walking on per-ancestor failure.
        }
        current = current.parentNode || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Whether `li` carries the `task-list-item` class. Never throws.
  priorityMarkLiIsTask(li) {
    try {
      if (!li) {
        return false;
      }
      if (
        li.classList &&
        typeof li.classList.contains === "function" &&
        li.classList.contains("task-list-item")
      ) {
        return true;
      }
      const classText =
        typeof li.className === "string"
          ? li.className
          : typeof li.getAttribute === "function"
            ? li.getAttribute("class") || ""
            : "";
      return (
        typeof classText === "string" &&
        classText.split(/\s+/).indexOf("task-list-item") !== -1
      );
    } catch (error) {
      return false;
    }
  }

  renderPriorityMarksIn(el, ctx) {
    try {
      if (!this.priorityMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      let ladder = null;
      try {
        ladder = this.priorityLadderSnapshot().ladder;
      } catch (error) {
        ladder = null;
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
                  if (this.priorityMarkExcludedAncestor(node, el)) {
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
              if (value.indexOf("priority::") !== -1) {
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
                const nodeType = child.nodeType;
                if (nodeType === 3) {
                  const value =
                    typeof child.nodeValue === "string"
                      ? child.nodeValue
                      : typeof child.textContent === "string"
                        ? child.textContent
                        : "";
                  if (
                    value.indexOf("priority::") !== -1 &&
                    !this.priorityMarkExcludedAncestor(child, el)
                  ) {
                    textNodes.push(child);
                  }
                } else if (nodeType === 1) {
                  if (!this.priorityMarkExcludedAncestor(child, el)) {
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
          if (this.priorityMarkExcludedAncestor(textNode, el)) {
            continue;
          }
          const li = this.priorityMarkNearestLi(textNode, el);
          if (!this.priorityMarkLiIsTask(li)) {
            continue;
          }
          const value =
            typeof textNode.nodeValue === "string"
              ? textNode.nodeValue
              : typeof textNode.textContent === "string"
                ? textNode.textContent
                : "";
          if (!value || value.indexOf("priority::") === -1) {
            continue;
          }
          const source = priorityMarkSourceInText(value);
          if (!source) {
            continue;
          }
          const model = priorityMarkModel(source.value, ladder);
          if (!model) {
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
          const beforeText = value.slice(0, source.fieldStart);
          const afterText = value.slice(source.fieldEnd);
          const markEl = buildPriorityMarkElement(docNode, model, {
            foldSpace: false,
          });
          if (!markEl) {
            continue;
          }
          try {
            if (beforeText) {
              parent.insertBefore(
                docNode.createTextNode(beforeText),
                textNode,
              );
            }
            parent.insertBefore(markEl, textNode);
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
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  togglePriorityMarks() {
    try {
      this.priorityMarksEnabled = !this.priorityMarksEnabled;
      const enabled = this.priorityMarksEnabled;
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList
        ) {
          if (enabled) {
            if (typeof document.body.classList.add === "function") {
              document.body.classList.add("bob-priority-marks");
            }
          } else if (typeof document.body.classList.remove === "function") {
            document.body.classList.remove("bob-priority-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshPriorityMarkEditors();
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
          enabled ? "Priority marks on" : "Priority marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.priorityMarksEnabled;
    }
  }

  refreshPriorityMarkEditors() {
    try {
      const refresh = ensurePriorityMarksRefresh();
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

  // Additive `api.priorityMarks` v1 namespace: `{ version: 1,
  // model(value), render(host, value, options) }`. Synchronous and
  // never throwing; `render` appends to `host` and returns the
  // element, or null for non-Tasks values. The top-level api stays
  // v3.
  priorityMarksApi() {
    try {
      const plugin = this;
      return Object.freeze({
        version: 1,
        model: (value) => {
          try {
            let ladder = null;
            try {
              ladder = plugin.priorityLadderSnapshot().ladder;
            } catch (error) {
              ladder = null;
            }
            return priorityMarkModel(value, ladder);
          } catch (error) {
            return null;
          }
        },
        render: (host, value, options) => {
          try {
            if (!host || typeof host.appendChild !== "function") {
              return null;
            }
            if (PRIORITY_MARK_VALUES.indexOf(value) === -1) {
              return null;
            }
            const docNode =
              (host.ownerDocument && host.ownerDocument) ||
              (typeof document !== "undefined" ? document : null);
            if (!docNode) {
              return null;
            }
            let ladder = null;
            try {
              ladder = plugin.priorityLadderSnapshot().ladder;
            } catch (error) {
              ladder = null;
            }
            const model = priorityMarkModel(value, ladder);
            if (!model) {
              return null;
            }
            const settings =
              options && typeof options === "object" ? options : {};
            const el = buildPriorityMarkElement(docNode, model, {
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
        model: () => null,
        render: () => null,
      });
    }
  }
}
