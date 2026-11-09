// Linked notebook headers: Live Preview decorations and refresh fan-out.

class BobLedgerToolsNotebookHeaderLiveMixin {
  notebookHeaderLivePath(view) {
    try {
      if (typeof this.notebookCatalogLivePath === "function") {
        return this.notebookCatalogLivePath(view);
      }
      if (!editorInfoField || !editorLivePreviewField) {
        return null;
      }
      let live = null;
      try {
        live = view.state.field(editorLivePreviewField);
      } catch (error) {
        return null;
      }
      if (!live) {
        return null;
      }
      let info = null;
      try {
        info = view.state.field(editorInfoField);
      } catch (error) {
        return null;
      }
      const path = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      return path || null;
    } catch (error) {
      return null;
    }
  }

  notebookHeaderLiveAnchor(docText) {
    try {
      const text = String(docText === null || docText === undefined ? "" : docText);
      const lines = text.split("\n");
      let index = 0;
      if (lines.length > 1 && lines[0].trim() === "---") {
        let end = -1;
        for (let cursor = 1; cursor < lines.length; cursor += 1) {
          if (lines[cursor].trim() === "---" || lines[cursor].trim() === "...") {
            end = cursor;
            break;
          }
        }
        index = end >= 0 ? end + 1 : 1;
      }
      let fence = null;
      const toggle = typeof notebookSourceFenceToggle === "function" ? notebookSourceFenceToggle : null;
      for (; index < lines.length; index += 1) {
        const line = lines[index];
        if (toggle) {
          const next = toggle(line, fence);
          if (next !== fence) {
            fence = next;
            continue;
          }
        }
        if (fence) {
          continue;
        }
        if (/^#\s+\S/.test(line.trim())) {
          return index;
        }
      }
      return -1;
    } catch (error) {
      return -1;
    }
  }

  notebookHeaderFrontmatterEnd(docText) {
    try {
      const lines = String(docText === null || docText === undefined ? "" : docText).split("\n");
      if (lines.length > 1 && lines[0].trim() === "---") {
        for (let cursor = 1; cursor < lines.length; cursor += 1) {
          if (lines[cursor].trim() === "---" || lines[cursor].trim() === "...") {
            return cursor;
          }
        }
      }
      return -1;
    } catch (error) {
      return -1;
    }
  }

  buildNotebookHeaderDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) {
        return Decoration ? Decoration.none : null;
      }
      const filePath = this.notebookHeaderLivePath(view);
      if (!filePath) {
        return Decoration.none;
      }
      let docText = "";
      try {
        docText = view.state.doc && typeof view.state.doc.toString === "function"
          ? view.state.doc.toString()
          : String(view.state.doc || "");
      } catch (error) {
        return Decoration.none;
      }
      let state = null;
      try {
        state = typeof this.notebookCatalogState === "function"
          ? this.notebookCatalogState()
          : this.notebookHeaderLastState || null;
      } catch (error) {
        state = this.notebookHeaderLastState || null;
      }
      const model = this.notebookHeaderModelFor(filePath, state);
      if (!model) {
        return Decoration.none;
      }
      const options = this.notebookHeaderPaintOptions(filePath, state);
      const doc = typeof document !== "undefined" ? document : null;
      const headerEl = this.notebookHeaderBuildEl(model, options, doc);
      if (!headerEl) {
        return Decoration.none;
      }
      const anchor = this.notebookHeaderLiveAnchor(docText);
      const fallback = this.notebookHeaderFrontmatterEnd(docText);
      const plugin = this;
      const HeaderWidget = class extends WidgetType {
        constructor(el, path, signature) {
          super();
          this.el = el;
          this.path = path;
          this.signature = signature;
        }
        eq(other) {
          return Boolean(other && other.path === this.path && other.signature === this.signature);
        }
        toDOM() {
          return this.el;
        }
      };
      const signature = typeof notebookHeaderSignature === "function"
        ? notebookHeaderSignature(model)
        : String(filePath);
      const widget = new HeaderWidget(headerEl, filePath, signature);
      const pending = [];
      try {
        if (anchor >= 0) {
          const line = view.state.doc.line(anchor + 1);
          pending.push({
            from: line.to,
            to: line.to,
            spec: Decoration.widget({ widget, side: 1 }),
          });
        } else {
          const at = fallback >= 0 ? fallback + 1 : 0;
          if (at <= 0) {
            pending.push({
              from: 0,
              to: 0,
              spec: Decoration.widget({ widget, side: 1 }),
            });
          } else {
            try {
              const line = view.state.doc.line(at + 1);
              pending.push({
                from: line.from,
                to: line.from,
                spec: Decoration.widget({ widget, side: 0 }),
              });
            } catch (error) {
              pending.push({
                from: 0,
                to: 0,
                spec: Decoration.widget({ widget, side: 1 }),
              });
            }
          }
        }
      } catch (error) {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      for (const range of pending) {
        try {
          builder.add(range.from, range.to, range.spec);
        } catch (error) {
          // Skip one range.
        }
      }
      try {
        return builder.finish();
      } catch (error) {
        return Decoration.none;
      }
    } catch (error) {
      try {
        return Decoration ? Decoration.none : null;
      } catch (inner) {
        return null;
      }
    }
  }

  notebookHeaderPaintEditorDom(view) {
    try {
      if (this.notebookHeaderActive === false) {
        return false;
      }
      const filePath = this.notebookHeaderLivePath(view);
      if (!filePath || !view || !view.dom) {
        return false;
      }
      const root = view.dom;
      let state = null;
      try {
        state = typeof this.notebookCatalogState === "function"
          ? this.notebookCatalogState()
          : this.notebookHeaderLastState || null;
      } catch (error) {
        state = this.notebookHeaderLastState || null;
      }
      const model = this.notebookHeaderModelFor(filePath, state);
      const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(root) : null)
        || (typeof document !== "undefined" ? document : null);
      try {
        const stale = root.querySelectorAll
          ? Array.from(root.querySelectorAll(`.${NOTEBOOK_HEADER_CLASS}`) || [])
          : [];
        for (const node of stale) {
          if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
            if (node.getAttribute && node.getAttribute("data-cm-widget") === "true") {
              continue;
            }
            try {
              node.parentNode.removeChild(node);
            } catch (error) {
              // Best-effort.
            }
          }
        }
      } catch (error) {
        // Cleanup is best-effort.
      }
      if (!model) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  createNotebookHeaderExtension() {
    try {
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function") {
        return null;
      }
      if (!Decoration || !WidgetType || !RangeSetBuilder) {
        return null;
      }
      if (!editorInfoField || !editorLivePreviewField) {
        return null;
      }
      const plugin = this;
      const HeaderPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildNotebookHeaderDecorations(view);
          } catch (error) {
            this.decorations = Decoration ? Decoration.none : null;
          }
          this.lastPath = plugin.notebookHeaderLivePath(view);
        }
        update(u) {
          try {
            const nextPath = plugin.notebookHeaderLivePath(u.view);
            const pathChanged = nextPath !== this.lastPath;
            this.lastPath = nextPath;
            let rebuild = pathChanged;
            if (!rebuild && typeof plugin.notebookCatalogShouldRebuild === "function") {
              rebuild = plugin.notebookCatalogShouldRebuild(u);
            } else if (!rebuild && u && (u.docChanged || u.viewportChanged)) {
              rebuild = true;
            }
            if (rebuild) {
              this.decorations = plugin.buildNotebookHeaderDecorations(u.view);
            }
            plugin.notebookHeaderPaintEditorDom(u.view);
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      let extension = null;
      try {
        extension = ViewPlugin.fromClass(HeaderPluginClass, {
          decorations: (value) => value.decorations,
        });
      } catch (error) {
        return null;
      }
      try {
        return Prec && typeof Prec.highest === "function" ? Prec.highest(extension) : extension;
      } catch (error) {
        return extension;
      }
    } catch (error) {
      return null;
    }
  }

  refreshNotebookHeaderEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let refreshEffect = null;
      try {
        if (typeof ensureNotebookCatalogRefresh === "function") {
          refreshEffect = ensureNotebookCatalogRefresh();
        }
      } catch (error) {
        refreshEffect = null;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor ? leaf.view.editor.cm : null;
          if (cm && typeof cm.dispatch === "function" && refreshEffect) {
            cm.dispatch({ effects: refreshEffect.of(null) });
          }
          if (cm) {
            this.notebookHeaderPaintEditorDom(cm);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleNotebookHeaderRefresh() {
    if (this.notebookHeaderActive === false) {
      return;
    }
    if (this.notebookHeaderRefreshTimer !== null && this.notebookHeaderRefreshTimer !== undefined) {
      return;
    }
    const schedule = typeof this.notebookSetTimeout === "function"
      ? this.notebookSetTimeout.bind(this)
      : (callback, delay) => setTimeout(callback, delay);
    this.notebookHeaderRefreshTimer = schedule(() => {
      this.notebookHeaderRefreshTimer = null;
      try {
        this.refreshNotebookHeaderReading();
      } catch (error) {
        // Best-effort.
      }
      try {
        this.refreshNotebookHeaderEditors();
      } catch (error) {
        // Best-effort.
      }
    }, 150);
  }

  refreshNotebookHeaderAll() {
    try {
      this.refreshNotebookHeaderReading();
    } catch (error) {
      // Best-effort.
    }
    try {
      this.refreshNotebookHeaderEditors();
    } catch (error) {
      // Best-effort.
    }
  }
}
