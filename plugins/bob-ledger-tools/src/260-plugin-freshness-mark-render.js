class BobLedgerToolsFreshnessMarkRenderMixin {
  freshnessMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
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
                if (effect === freshnessMarksRefresh) {
                  return true;
                }
                if (
                  freshnessMarksRefresh &&
                  typeof effect.is === "function" &&
                  effect.is(freshnessMarksRefresh)
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

  buildFreshnessMarkDecorations(view) {
    try {
      if (!this.freshnessMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !FreshnessMarkWidget) {
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
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return Decoration.none;
      }
      const ranges =
        (view && view.visibleRanges) || [];
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
              if (line.text.indexOf("fresh::") !== -1) {
                const source = freshnessMarkSource(
                  line.text,
                  snapshot.dateText,
                );
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
                      const model = this.freshnessMarkModelForLine({
                        path: filePath,
                        lineNumber:
                          typeof line.number === "number"
                            ? line.number - 1
                            : null,
                        text: line.text,
                        source,
                      });
                      if (model) {
                        const from =
                          line.from +
                          source.fieldStart -
                          (source.foldSpace ? 1 : 0);
                        builder.add(
                          from,
                          absTo,
                          Decoration.replace({
                            widget: new FreshnessMarkWidget(
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

  freshnessMarkExcludedAncestor(node, root) {
    try {
      let current =
        node && node.parentNode ? node.parentNode : null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const tag =
            current.tagName || current.nodeName
              ? String(current.tagName || current.nodeName)
              : "";
          if (tag === "CODE" || tag === "code" || tag === "PRE" || tag === "pre") {
            return true;
          }
          let classText = "";
          try {
            if (
              current.classList &&
              typeof current.classList.contains === "function"
            ) {
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

  renderFreshnessMarksIn(el, ctx) {
    try {
      if (!this.freshnessMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const path =
        typeof ctx.sourcePath === "string"
          ? ctx.sourcePath
          : ctx.sourcePath === null || ctx.sourcePath === undefined
            ? ""
            : String(ctx.sourcePath);
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
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
                  if (this.freshnessMarkExcludedAncestor(node, el)) {
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
              if (value.indexOf("fresh::") !== -1) {
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
              const children =
                (top && top.childNodes) || [];
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
                    value.indexOf("fresh::") !== -1 &&
                    !this.freshnessMarkExcludedAncestor(child, el)
                  ) {
                    textNodes.push(child);
                  }
                } else if (nodeType === 1) {
                  if (!this.freshnessMarkExcludedAncestor(child, el)) {
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
          if (this.freshnessMarkExcludedAncestor(textNode, el)) {
            continue;
          }
          const value =
            typeof textNode.nodeValue === "string"
              ? textNode.nodeValue
              : typeof textNode.textContent === "string"
                ? textNode.textContent
                : "";
          if (!value || value.indexOf("fresh::") === -1) {
            continue;
          }
          const source = freshnessMarkSourceInText(value, snapshot.dateText);
          if (!source) {
            continue;
          }
          const model = this.freshnessMarkModelForText({ path, source });
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
          const markEl = buildFreshnessMarkElement(docNode, model, {
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

  toggleFreshnessMarks() {
    try {
      this.freshnessMarksEnabled = !this.freshnessMarksEnabled;
      const enabled = this.freshnessMarksEnabled;
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList
        ) {
          if (enabled) {
            if (typeof document.body.classList.add === "function") {
              document.body.classList.add("bob-fresh-marks");
            }
          } else if (typeof document.body.classList.remove === "function") {
            document.body.classList.remove("bob-fresh-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshFreshnessMarkEditors();
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
          enabled ? "Freshness marks on" : "Freshness marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.freshnessMarksEnabled;
    }
  }

  refreshFreshnessMarkEditors() {
    try {
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
          if (cm && typeof cm.dispatch === "function" && freshnessMarksRefresh) {
            cm.dispatch({ effects: freshnessMarksRefresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleFreshnessMarksRefresh() {
    try {
      if (
        this.freshnessMarksTimer !== null &&
        this.freshnessMarksTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.freshnessMarksTimer = schedule(() => {
        self.freshnessMarksTimer = null;
        try {
          self.rebuildFreshnessMarkSnapshot();
        } catch (error) {
          // Rebuild is best-effort.
        }
        try {
          self.refreshFreshnessMarkEditors();
        } catch (error) {
          // Refresh is best-effort.
        }
      }, 150);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  // __FRESHNESS_E1_END__

}
