class BobLedgerToolsBlocksModelMixin {
  blocksChipModelForLine({ path, text, owner }) {
    try {
      const memo = this.freshnessEnsureMemo();
      const sourcePath = String(path || "");
      let ownerTask = owner || null;
      if (!ownerTask) {
        const parsedOwner = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(String(text || ""));
        if (parsedOwner) {
          const index = this.dependencyTasksIndex();
          ownerTask = index.get(sourcePath + "\u0000" + parsedOwner[1]) || null;
        }
      }
      if (!ownerTask) {
        return null;
      }
      const index = this.dependencyTasksIndex();
      const self = this;
      const lookup = (linkpath, blockId) => {
        try {
          const resolved = self.dependencyResolveLink(linkpath, sourcePath);
          const key = String(resolved.path || "") + "\u0000" + String(blockId || "");
          return index.has(key) ? index.get(key) : null;
        } catch (error) {
          return null;
        }
      };
      return blocksChipModel(String(text || ""), sourcePath, ownerTask, memo, lookup, memo && memo.dateText);
    } catch (error) {
      return null;
    }
  }

  blocksChipsAvailable() {
    try {
      return Boolean(ViewPlugin && Decoration && WidgetType && RangeSetBuilder && editorInfoField && editorLivePreviewField && BlocksChipWidget);
    } catch (error) {
      return false;
    }
  }

  createBlocksChipExtension() {
    try {
      if (!this.blocksChipsAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const BlocksPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildBlocksChipDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.blocksChipShouldRebuild(update)) {
              this.decorations = plugin.buildBlocksChipDecorations(update.view);
            }
          } catch (error) {
            // Keep the previous decorations if a single refresh fails.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(BlocksPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  blocksChipShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        return true;
      }
      const refresh = ensureDependencyChipsRefresh();
      const transactions = update.transactions || [];
      for (const transaction of transactions) {
        const effects = transaction && transaction.effects;
        for (const effect of Array.isArray(effects) ? effects : (effects ? [effects] : [])) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) {
            return true;
          }
        }
      }
      if (editorLivePreviewField && update.startState && update.state) {
        try {
          if (update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) {
            return true;
          }
        } catch (error) {
          // A missing field is not a reason to force a rebuild.
        }
      }
      if (editorInfoField && update.startState && update.state) {
        try {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) {
            return true;
          }
        } catch (error) {
          // A missing field is not a reason to force a rebuild.
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildBlocksChipDecorations(view) {
    try {
      if (!this.dependencyChipsEnabled || !Decoration || !RangeSetBuilder || !BlocksChipWidget || !editorInfoField || !editorLivePreviewField) {
        return Decoration.none;
      }
      const live = view.state.field(editorLivePreviewField);
      if (!live) {
        return Decoration.none;
      }
      const info = view.state.field(editorInfoField);
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!path) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      const ranges = Array.isArray(view.visibleRanges) ? view.visibleRanges : [];
      const selections = view.state.selection && view.state.selection.ranges || [];
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      let tree = null;
      try {
        tree = syntaxTree && typeof syntaxTree === "function" ? syntaxTree(view.state) : syntaxTree;
      } catch (error) {
        tree = null;
      }
      for (const range of ranges) {
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
            if (line.text.indexOf("BLOCKS") !== -1 || line.text.indexOf("BLOCKING") !== -1) {
              const parsed = parseBlocksLine(line.text);
              if (parsed && (parsed.verdict === "accept" || parsed.verdict === "empty")) {
                const number = typeof line.number === "number" ? line.number : null;
                const owned = number !== null && dependencyChipLineOwnedByTaskAtDoc(doc, number);
                const revealed = selections.some((selection) => selection && selection.from <= line.to && selection.to >= line.from);
                const inCode = tree ? freshnessMarkPosInCode(tree, line.from) : false;
                if (owned && !revealed && !inCode) {
                  const ownerLine = blocksOwnerTaskLineAtDoc(doc, number);
                  const id = blocksMarkdownBlockId(ownerLine && ownerLine.text);
                  const owner = id ? this.dependencyTasksIndex().get(path + "\u0000" + id) : null;
                  const model = owner ? this.blocksChipModelForLine({ path, text: line.text, owner }) : null;
                  if (model && model.chips.length > 0) {
                    const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line.text);
                    const from = line.from + (marker ? marker[0].length : 0);
                    builder.add(from, line.to, Decoration.replace({
                      widget: new BlocksChipWidget(model, { plugin: this, sourcePath: path, lineNumber: number === null ? null : number - 1 }),
                    }));
                  }
                }
              }
            }
          } catch (error) {
            // Ignore a single row and continue through the visible range.
          }
          if (typeof line.to !== "number" || line.to >= end || line.to < pos) {
            break;
          }
          pos = line.to + 1;
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
}

function blocksMarkdownBlockId(taskLine) {
  const match = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(String(taskLine || ""));
  return match ? match[1] : null;
}

// Return the nearest list-item parent line for a managed child row.
function blocksOwnerTaskLineAtDoc(doc, lineNumber) {
  try {
    if (!doc || typeof doc.line !== "function" || !Number.isInteger(lineNumber)) {
      return null;
    }
    const child = doc.line(lineNumber);
    const childIndent = /^\s*/.exec(child.text)[0].replace(/\t/g, "    ").length;
    for (let current = lineNumber - 1; current >= 1; current -= 1) {
      const line = doc.line(current);
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line.text)) {
        continue;
      }
      const indent = /^\s*/.exec(line.text)[0].replace(/\t/g, "    ").length;
      if (indent < childIndent) {
        return /#task(?![A-Za-z0-9_/-])/.test(line.text) ? line : null;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}
