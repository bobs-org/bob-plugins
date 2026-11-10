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
      const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(view.dom) : null)
        || (typeof document !== "undefined" ? document : null);
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
          try {
            if (this.el && typeof this.el.setAttribute === "function") {
              this.el.setAttribute("data-cm-widget", "true");
              this.el.setAttribute("data-notebook-source", this.path || "");
            }
          } catch (error) {
            // Ownership marking is best-effort.
          }
          return this.el;
        }
      };
      const signature = typeof notebookHeaderSignature === "function"
        ? notebookHeaderSignature(model, options)
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
            let cmOwned = false;
            try {
              cmOwned = Boolean(
                node.getAttribute && (
                  node.getAttribute("data-cm-widget") === "true"
                  || node.closest && node.closest(".cm-widgetBuffer, .cm-content")
                ),
              );
            } catch (error) {
              cmOwned = Boolean(node.getAttribute && node.getAttribute("data-cm-widget") === "true");
            }
            if (cmOwned) {
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

  notebookHeaderCaptureFocus() {
    try {
      const doc = typeof document !== "undefined" ? document : null;
      const fromNode = (node) => {
        if (!node || typeof node.getAttribute !== "function") {
          return "";
        }
        try {
          if (typeof node.closest === "function" && !node.closest(`.${NOTEBOOK_HEADER_CLASS}`)) {
            return "";
          }
        } catch (error) {
          return "";
        }
        return node.getAttribute("data-href") || "";
      };
      const fromActive = fromNode(doc && doc.activeElement);
      if (fromActive) {
        this.notebookHeaderLastFocusHref = fromActive;
        return fromActive;
      }
      const focused = doc && typeof doc.querySelector === "function"
        ? doc.querySelector(`.${NOTEBOOK_HEADER_CLASS} a.internal-link:focus, .${NOTEBOOK_HEADER_CLASS} a.internal-link:focus-visible`)
        : null;
      const fromFocus = fromNode(focused);
      if (fromFocus) {
        this.notebookHeaderLastFocusHref = fromFocus;
        return fromFocus;
      }
      return String(this.notebookHeaderLastFocusHref || "");
    } catch (error) {
      return String(this.notebookHeaderLastFocusHref || "");
    }
  }

  notebookHeaderRestoreFocus(href) {
    const wanted = String(href || "").trim();
    if (!wanted) {
      return false;
    }
    try {
      const doc = typeof document !== "undefined" ? document : null;
      if (!doc || typeof doc.querySelectorAll !== "function") {
        return false;
      }
      const safe = wanted.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const headers = Array.from(doc.querySelectorAll(`.${NOTEBOOK_HEADER_CLASS}`) || []);
      for (const header of headers) {
        try {
          if (typeof header.getAttribute === "function" && header.getAttribute("data-cm-widget") === "true") {
            continue;
          }
        } catch (error) {
          // CodeMirror widgets are skipped when marked.
        }
        const next = typeof header.querySelector === "function"
          ? header.querySelector(`[data-href="${safe}"]`)
          : null;
        if (next && typeof next.focus === "function") {
          next.focus();
          return true;
        }
      }
    } catch (error) {
      return false;
    }
    return false;
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
      const href = this.notebookHeaderCaptureFocus();
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
      this.notebookHeaderRestoreFocus(href);
    }, 150);
  }

  refreshNotebookHeaderAll() {
    const href = this.notebookHeaderCaptureFocus();
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
    this.notebookHeaderRestoreFocus(href);
  }
}
