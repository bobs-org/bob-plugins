class BobLedgerToolsDependencyModelMixin {
  // --- Dependency chips (bob-cli-3n chips) ------------------------------
  // Live status chips for `⛓️ **DEPENDS ON:**` lines. Data comes only from
  // the in-memory Tasks memo (`planBlockTasks`) plus the metadata cache
  // for linkpath resolution; never from disk during render.

  dependencyNavApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
      const api = nav ? nav.api : null;
      if (api && typeof api === "object" && Number(api.version) >= 1) {
        return api;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Depends-On chip lookup over the Tasks memo. The index lives on the
  // freshness memo itself, so it shares the memo's invalidation: a memo
  // rebuild drops the index with it (one cache, one lifecycle).
  dependencyTasksIndex() {
    try {
      // One cache with one invalidation: the index lives on the
      // freshness memo via `freshnessEnsureMemo`, so two passes over an
      // unchanged vault build it once and any freshness change drops it
      // with the memo.
      const memo = this.freshnessEnsureMemo();
      if (!memo || typeof memo !== "object") {
        return new Map();
      }
      if (memo.dependencyTasksIndex instanceof Map) {
        return memo.dependencyTasksIndex;
      }
      const map = new Map();
      const list = Array.isArray(memo.tasks) ? memo.tasks : [];
      for (const task of list) {
        try {
          if (!task || typeof task !== "object") {
            continue;
          }
          const path = planTaskPath(task) || task.path || "";
          const blockId = planTaskBlockId(task) || task.blockId || null;
          if (!path || !blockId) {
            continue;
          }
          const key = path + "\u0000" + String(blockId);
          if (!map.has(key)) {
            map.set(key, task);
          }
        } catch (error) {
          continue;
        }
      }
      try {
        memo.dependencyTasksIndex = map;
      } catch (error) {
        // An uncacheable memo still returns a correct index.
      }
      return map;
    } catch (error) {
      return new Map();
    }
  }

  dependencyResolveLink(linkpath, sourcePath) {
    try {
      const target = String(linkpath || "");
      if (!target) {
        return { path: String(sourcePath || "") };
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
        try {
          const dest = metadataCache.getFirstLinkpathDest(target, String(sourcePath || ""));
          if (dest && typeof dest.path === "string" && dest.path) {
            return { path: dest.path };
          }
        } catch (error) {
          // Fall through to the suffix fallback.
        }
      }
      const withMd = /\.md$/i.test(target) ? target : target + ".md";
      return { path: withMd };
    } catch (error) {
      return { path: String(sourcePath || "") };
    }
  }

  dependencyChipModelForLine({ path, text }) {
    try {
      const parsed = parseDependencyLine(String(text || ""));
      if (!parsed || parsed.verdict === "not-a-line" || parsed.verdict === "malformed") {
        return null;
      }
      const sourcePath = String(path || "");
      const index = this.dependencyTasksIndex();
      const self = this;
      const lookup = (linkpath, blockId) => {
        try {
          const resolved = self.dependencyResolveLink(linkpath, sourcePath);
          const key = String(resolved.path || "") + "\u0000" + String(blockId || "");
          if (index.has(key)) {
            return index.get(key);
          }
          try {
            const metadataCache = self.app && self.app.metadataCache;
            if (metadataCache && typeof metadataCache.getCache === "function" && resolved.path) {
              const cache = metadataCache.getCache(resolved.path);
              const blocks = cache && cache.blocks ? cache.blocks : null;
              if (blocks && Object.prototype.hasOwnProperty.call(blocks, String(blockId || ""))) {
                return { isTask: false, path: resolved.path };
              }
            }
          } catch (error) {
            // Missing stays missing.
          }
          return null;
        } catch (error) {
          return null;
        }
      };
      return dependencyChipModel(String(text || ""), sourcePath, lookup);
    } catch (error) {
      return null;
    }
  }

  dependencyChipsAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          StateEffect &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          DependencyChipWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createDependencyChipExtension() {
    try {
      if (!this.dependencyChipsAvailable()) {
        return null;
      }
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function" || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const ChipPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildDependencyChipDecorations(view);
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
            if (plugin.dependencyChipShouldRebuild(u)) {
              this.decorations = plugin.buildDependencyChipDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(ChipPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  dependencyChipShouldRebuild(u) {
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
            const effects = transaction && transaction.effects !== undefined ? transaction.effects : null;
            if (!effects) {
              continue;
            }
            const list = Array.isArray(effects) ? effects : [effects];
            const refresh = ensureDependencyChipsRefresh();
            for (const effect of list) {
              try {
                if (!effect) {
                  continue;
                }
                if (refresh && effect === refresh) {
                  return true;
                }
                if (refresh && typeof effect.is === "function" && effect.is(refresh)) {
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
            beforePath = beforeInfo && beforeInfo.file ? beforeInfo.file.path : null;
          } catch (error) {
            beforePath = null;
          }
          try {
            const afterInfo = u.state.field(editorInfoField);
            afterPath = afterInfo && afterInfo.file ? afterInfo.file.path : null;
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

  buildDependencyChipDecorations(view) {
    try {
      if (!this.dependencyChipsEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !DependencyChipWidget) {
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
      const filePath = info && info.file && typeof info.file.path === "string" ? info.file.path : null;
      if (!filePath) {
        return Decoration.none;
      }
      const ranges = (view && view.visibleRanges) || [];
      let selectionRanges = [];
      try {
        selectionRanges = (view.state.selection && view.state.selection.ranges) || [];
      } catch (error) {
        selectionRanges = [];
      }
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) {
          tree = syntaxTree(view.state);
        } else if (syntaxTree && typeof syntaxTree.resolveInner === "function") {
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
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      // Depends-On ownership (DP19/DP20/DP30) walks ancestors with line
      // lookups, touching only visible ranges (contract §7.4) instead of
      // copying every document line. When line access is unavailable the
      // ownership check fails open.
      const chipLineOwned = (lineNumber) => {
        try {
          if (typeof lineNumber !== "number") {
            return true;
          }
          return dependencyChipLineOwnedByTaskAtDoc(doc, lineNumber);
        } catch (error) {
          return true;
        }
      };
      const interactive = Boolean(this.dependencyNavApi());
      for (const range of ranges) {
        try {
          if (!range || typeof range.from !== "number") {
            continue;
          }
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
            if (!line || typeof line.text !== "string") {
              break;
            }
            try {
              if (line.text.indexOf("DEPENDS ON") !== -1 || line.text.indexOf("DEPENDENCIES") !== -1) {
                const parsed = parseDependencyLine(line.text);
                if (parsed && (parsed.verdict === "accept" || parsed.verdict === "empty")) {
                  // DP19/DP20/DP30: only a direct child of a #task line
                  // gets chips — never paragraphs, grandchildren, or Work
                  // Log lines. A DP30 line owned by a task nested under a
                  // Work Log entry counts. Ancestors walk with line
                  // lookups (contract §7.4); fails open when line access
                  // is unavailable.
                  let owned = true;
                  try {
                    if (typeof line.number === "number") {
                      owned = chipLineOwned(line.number);
                    }
                  } catch (error) {
                    owned = true;
                  }
                  let revealed = !owned;
                  for (const selection of selectionRanges) {
                    try {
                      if (selection && typeof selection.from === "number" && typeof selection.to === "number" && selection.from <= line.to && selection.to >= line.from) {
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
                        inCode = freshnessMarkPosInCode(tree, line.from);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (!inCode) {
                      const model = this.dependencyChipModelForLine({ path: filePath, text: line.text });
                      if (model) {
                        const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line.text);
                        const from = line.from + (marker ? marker[0].length : 0);
                        const lineNumber = typeof line.number === "number" ? line.number - 1 : null;
                        builder.add(from, line.to, Decoration.replace({
                          widget: new DependencyChipWidget(model, { plugin: this, sourcePath: filePath, lineNumber, interactive }),
                        }));
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

  dependencyExcludedAncestor(node, root) {
    try {
      let current = node && node.parentNode ? node.parentNode : null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const tag = current.tagName || current.nodeName ? String(current.tagName || current.nodeName) : "";
          if (tag === "CODE" || tag === "code" || tag === "PRE" || tag === "pre") {
            return true;
          }
          // DP29: a blockquoted row is never a Depends-On line.
          if (tag === "BLOCKQUOTE" || tag === "blockquote") {
            return true;
          }
        } catch (error) {
          // Keep walking.
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

}
