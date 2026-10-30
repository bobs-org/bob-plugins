// --- Ledger type-agreement marks: Live Preview -----------------------------
// `BobLedgerToolsLedgerTypeMarksMixin`. Prefixes disagreeing (and
// composite-agreeing) Task Links with `#TYPE` using cached
// `effectiveTypeFor` / `typeAgrees`. Never spawns bob per row. Stale
// cache yields no prefix rather than a confidently wrong type.
class BobLedgerToolsLedgerTypeMarksMixin {
  setupLedgerTypeMarks() {
    try {
      if (typeof this.ledgerTypeMarksEnabled !== "boolean") {
        this.ledgerTypeMarksEnabled = true;
      }
      if (!(this.ledgerTypeLineCache instanceof Map)) {
        try {
          this.ledgerTypeLineCache = new Map();
        } catch (error) {
          this.ledgerTypeLineCache = null;
        }
      }
      try {
        const extension = this.createLedgerTypeMarkExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
    } catch (error) {
      // Setup never throws.
    }
  }

  ledgerTypeMarksAvailable() {
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
          LedgerTypeMarkWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createLedgerTypeMarkExtension() {
    try {
      if (!this.ledgerTypeMarksAvailable()) {
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
            this.decorations = plugin.buildLedgerTypeMarkDecorations(view);
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
            if (
              u &&
              (u.docChanged || u.viewportChanged || u.selectionSet)
            ) {
              this.decorations = plugin.buildLedgerTypeMarkDecorations(u.view);
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

  ledgerTypeLineTextFor(target, blockId, dailyPath, liveDocText) {
    try {
      const resolved =
        typeof this.progressMarkResolveTarget === "function"
          ? this.progressMarkResolveTarget(target, dailyPath)
          : null;
      if (!resolved) {
        return null;
      }
      const id = String(blockId || "");
      if (!id) {
        return null;
      }
      const cacheKey = resolved + "#^" + id;
      if (
        this.ledgerTypeLineCache &&
        typeof this.ledgerTypeLineCache.get === "function" &&
        this.ledgerTypeLineCache.has(cacheKey)
      ) {
        return this.ledgerTypeLineCache.get(cacheKey);
      }
      const findLine = (text) => {
        if (typeof text !== "string" || text === "") {
          return null;
        }
        const escaped = progressMarkEscapeBlockId(id);
        const pattern = new RegExp(
          "(?:^|\\s)\\^" + escaped + "(?:\\s|$)",
        );
        const lines = text.replace(/\r\n/g, "\n").split("\n");
        for (const line of lines) {
          if (pattern.test(String(line || ""))) {
            return String(line);
          }
        }
        return null;
      };
      let lineText = null;
      try {
        if (
          typeof liveDocText === "string" &&
          liveDocText !== "" &&
          typeof sameVaultPath === "function" &&
          sameVaultPath(resolved, dailyPath)
        ) {
          lineText = findLine(liveDocText);
        }
      } catch (error) {
        lineText = null;
      }
      if (!lineText) {
        try {
          const workspace = this.app && this.app.workspace;
          const leaves =
            workspace && typeof workspace.getLeavesOfType === "function"
              ? workspace.getLeavesOfType("markdown") || []
              : [];
          for (const leaf of leaves) {
            try {
              const view = leaf && leaf.view;
              const filePath = view && view.file && view.file.path;
              const editor = view && view.editor;
              if (
                !editor ||
                typeof editor.getValue !== "function" ||
                typeof filePath !== "string" ||
                (typeof sameVaultPath === "function" &&
                  !sameVaultPath(filePath, resolved))
              ) {
                continue;
              }
              lineText = findLine(editor.getValue());
              if (lineText) {
                break;
              }
            } catch (error) {
              continue;
            }
          }
        } catch (error) {
          lineText = null;
        }
      }
      try {
        if (
          lineText &&
          this.ledgerTypeLineCache &&
          typeof this.ledgerTypeLineCache.set === "function"
        ) {
          this.ledgerTypeLineCache.set(cacheKey, lineText);
        }
      } catch (error) {
        // Cache writes are best-effort.
      }
      return lineText;
    } catch (error) {
      return null;
    }
  }

  buildLedgerTypeMarkDecorations(view) {
    try {
      if (!this.ledgerTypeMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !LedgerTypeMarkWidget) {
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
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function") {
        return Decoration.none;
      }
      const content = doc.toString();
      const dailyPath =
        typeof this.pomodoroThemeTodayPath === "function"
          ? this.pomodoroThemeTodayPath()
          : filePath;
      const links = ledgerTypeMarkLinks(content);
      if (!links.length) {
        return Decoration.none;
      }
      const sources =
        typeof this.taskTypeSources === "function"
          ? this.taskTypeSources()
          : { vocab: null, exempt: ["PLAN"], inventory: [] };
      const builder = new RangeSetBuilder();
      const ranges = (view && view.visibleRanges) || [];
      for (const link of links) {
        try {
          if (!link || typeof link.blockId !== "string") {
            continue;
          }
          const lineText = this.ledgerTypeLineTextFor(
            link.target,
            link.blockId,
            dailyPath,
            content,
          );
          if (!lineText) {
            continue;
          }
          const identity = this.taskTagIdentityForLine
            ? this.taskTagIdentityForLine(lineText, link.target || filePath)
            : null;
          const typeName =
            identity && typeof identity.type === "string" ? identity.type : "";
          const typeKey =
            identity && typeof identity.key === "string" ? identity.key : null;
          if (!typeName || identity.inherited === true) {
            continue;
          }
          const kind = ledgerTypeMarkKind(typeKey || typeName, link.entryName, sources);
          if (!kind) {
            continue;
          }
          let line = null;
          try {
            line = doc.line(link.line + 1);
          } catch (error) {
            continue;
          }
          if (!line || typeof line.from !== "number") {
            continue;
          }
          const pos = line.from + link.ch;
          let visible = false;
          for (const range of ranges) {
            try {
              if (
                range &&
                typeof range.from === "number" &&
                typeof range.to === "number" &&
                pos >= range.from &&
                pos <= range.to
              ) {
                visible = true;
                break;
              }
            } catch (error) {
              continue;
            }
          }
          if (!visible) {
            continue;
          }
          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new LedgerTypeMarkWidget({
                type: typeName,
                hue: identity.hue || null,
                kind,
                entryName: link.entryName,
              }),
              side: -2,
            }),
          );
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

  refreshLedgerTypeMarkEditors() {
    try {
      if (this.ledgerTypeLineCache && typeof this.ledgerTypeLineCache.clear === "function") {
        this.ledgerTypeLineCache.clear();
      }
      this.refreshTaskTagMarkEditors();
    } catch (error) {
      // Refresh never throws.
    }
  }
}
