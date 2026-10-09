class BobLedgerToolsHeadingReviewMixin {
  paintNoteReadyHeadingChip(chipEl, model, sourcePath) {
    try {
      if (!chipEl) {
        return null;
      }
      const safe =
        model && typeof model === "object"
          ? model
          : noteReadyHeadingChipModel(null);
      if (typeof chipEl.setAttribute === "function") {
        chipEl.setAttribute("title", safe.tooltip);
        chipEl.setAttribute("aria-label", safe.aria);
        chipEl.setAttribute(
          "class",
          `bob-plan-chip bob-note-ready-heading` +
            `${safe.over ? " bob-plan-over" : ""}` +
            `${safe.placeholder ? " bob-plan-unavailable" : ""}` +
            `${safe.exempt ? " is-exempt" : ""}`,
        );
        chipEl.setAttribute("role", "link");
        try {
          if (!chipEl.hasAttribute("tabindex")) {
            chipEl.setAttribute("tabindex", "0");
          }
        } catch (error) {
          // tabindex is best-effort only.
        }
      }
      if (chipEl && typeof chipEl.cls === "string") {
        chipEl.cls =
          `bob-plan-chip bob-note-ready-heading` +
          `${safe.over ? " bob-plan-over" : ""}` +
          `${safe.placeholder ? " bob-plan-unavailable" : ""}` +
          `${safe.exempt ? " is-exempt" : ""}`;
      }
      // Rewrite text without touching listeners. Never assigns
      // `.text` on a live element (it would wipe children); the chip
      // carries a single text span.
      try {
        if (typeof chipEl.setText === "function") {
          chipEl.setText(safe.text);
        } else if (
          chipEl &&
          Object.getOwnPropertyDescriptor(chipEl, "text") &&
          typeof chipEl.text === "string"
        ) {
          chipEl.text = safe.text;
        } else if (typeof chipEl.textContent === "string") {
          chipEl.textContent = safe.text;
        }
      } catch (error) {
        // Text rewrite is best-effort only.
      }
      return chipEl;
    } catch (error) {
      return null;
    }
  }

  makeNoteReadyHeadingAnchor(host, model, path, sourcePath) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const safe =
        model && typeof model === "object"
          ? model
          : noteReadyHeadingChipModel(null);
      const anchor = host.createEl("a", {
        cls:
          `bob-plan-chip bob-note-ready-heading` +
          `${safe.over ? " bob-plan-over" : ""}` +
          `${safe.placeholder ? " bob-plan-unavailable" : ""}` +
          `${safe.exempt ? " is-exempt" : ""}`,
        title: safe.tooltip,
        href: "crowded",
      });
      this.paintNoteReadyHeadingChip(anchor, safe, sourcePath);
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", safe.aria);
        anchor.setAttribute("role", "link");
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText("crowded", sourcePath || path, newLeaf);
          }
        } catch (error) {
          // The chip still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        // mousedown is prevented so the editor cursor doesn't jump;
        // the chip never edits the note.
        anchor.addEventListener("mousedown", (event) => {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
        });
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            open(event);
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  renderNoteReadyHeadingInReading(el, ctx) {
    try {
      if (!el || !ctx) {
        return;
      }
      const path =
        typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!path) {
        return;
      }
      const entry = this.noteReadyHeadingEntryForPath(path);
      if (!entry) {
        return;
      }
      const flags = this.noteReadyHeadingFlags();
      const model = noteReadyHeadingChipModel(entry, flags);
      let heads = [];
      try {
        if (typeof el.querySelectorAll === "function") {
          heads = Array.from(el.querySelectorAll("h2"));
        } else if (Array.isArray(el.children)) {
          heads = el.children.filter(
            (child) =>
              child &&
              (child.tagName === "H2" || child.tagName === "h2"),
          );
        }
      } catch (error) {
        heads = [];
      }
      let target = null;
      for (const head of heads) {
        try {
          const text =
            typeof head.textContent === "string"
              ? head.textContent.trim()
              : typeof head.text === "string"
                ? head.text.trim()
                : "";
          if (/^Tasks(?:\s.*)?$/i.test(text)) {
            target = head;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      if (!target) {
        return;
      }
      // Avoid doubling the chip on re-render.
      try {
        if (typeof target.querySelector === "function") {
          if (target.querySelector(".bob-note-ready-heading")) {
            return;
          }
        } else if (Array.isArray(target.children)) {
          const has = target.children.some(
            (child) =>
              child &&
              child.attrs &&
              typeof child.attrs.class === "string" &&
              child.attrs.class.indexOf("bob-note-ready-heading") !== -1,
          );
          if (has) {
            return;
          }
        }
      } catch (error) {
        // Dedup is best-effort only.
      }
      const chip = this.makeNoteReadyHeadingAnchor(
        target,
        model,
        path,
        path,
      );
      if (!chip) {
        return;
      }
      if (!this.noteReadyReadingWidgets) {
        this.noteReadyReadingWidgets = new Set();
      }
      const widget = { el: chip, head: target, path };
      this.noteReadyReadingWidgets.add(widget);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(target);
            child.onunload = () => {
              if (this.noteReadyReadingWidgets) {
                this.noteReadyReadingWidgets.delete(widget);
              }
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              if (this.noteReadyReadingWidgets) {
                this.noteReadyReadingWidgets.delete(widget);
              }
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject the child.
        }
      }
    } catch (error) {
      // Reading chips never throw.
    }
  }

  refreshNoteReadyReadingChips() {
    if (
      !this.noteReadyReadingWidgets ||
      this.noteReadyReadingWidgets.size === 0
    ) {
      return false;
    }
    let refreshed = false;
    const flags = this.noteReadyHeadingFlags();
    for (const widget of Array.from(this.noteReadyReadingWidgets)) {
      try {
        const entry = this.noteReadyHeadingEntryForPath(widget.path);
        if (!entry) {
          continue;
        }
        const model = noteReadyHeadingChipModel(entry, flags);
        this.paintNoteReadyHeadingChip(widget.el, model, widget.path);
        refreshed = true;
      } catch (error) {
        // One stale chip never breaks the others.
      }
    }
    return refreshed;
  }

  noteReadyHeadingShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged) {
        return true;
      }
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
              if (
                noteReadyRefresh &&
                typeof effect.is === "function" &&
                effect.is(noteReadyRefresh)
              ) {
                return true;
              }
              if (effect === noteReadyRefresh) {
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
      return false;
    } catch (error) {
      return false;
    }
  }

  buildNoteReadyHeadingDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) {
        return Decoration ? Decoration.none : null;
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
      // Source mode: no chip.
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
      let docText = "";
      try {
        docText =
          view.state.doc && typeof view.state.doc.toString === "function"
            ? view.state.doc.toString()
            : String(view.state.doc || "");
      } catch (error) {
        return Decoration.none;
      }
      const lineIndex = noteReadyFindTasksHeadingLine(docText);
      if (lineIndex < 0) {
        try {
          return Decoration.none;
        } catch (error) {
          return null;
        }
      }
      const entry = this.noteReadyHeadingEntryForPath(filePath);
      if (!entry) {
        return Decoration.none;
      }
      const flags = this.noteReadyHeadingFlags();
      const model = noteReadyHeadingChipModel(entry, flags);
      const plugin = this;
      let HeadingWidget = null;
      try {
        HeadingWidget = class extends WidgetType {
          constructor(chipModel, path) {
            super();
            this.chipModel = chipModel;
            this.key = chipModel.key;
            this.path = path;
          }

          eq(other) {
            try {
              return (
                Boolean(other) &&
                other instanceof HeadingWidget &&
                other.key === this.key
              );
            } catch (error) {
              return false;
            }
          }

          toDOM() {
            try {
              const holder =
                typeof document !== "undefined" &&
                typeof document.createElement === "function"
                  ? document.createElement("span")
                  : null;
              const host =
                holder && typeof holder.createEl === "function"
                  ? holder
                  : {
                      createEl: (tag, opts = {}) => {
                        if (
                          typeof document !== "undefined" &&
                          typeof document.createElement === "function"
                        ) {
                          const node = document.createElement(tag);
                          if (opts.cls) {
                            node.className = opts.cls;
                          }
                          if (opts.text) {
                            node.textContent = opts.text;
                          }
                          if (opts.title) {
                            node.title = opts.title;
                          }
                          if (opts.href) {
                            node.setAttribute("href", opts.href);
                          }
                          return node;
                        }
                        return null;
                      },
                    };
              const anchor = plugin.makeNoteReadyHeadingAnchor(
                host,
                this.chipModel,
                this.path,
                this.path,
              );
              if (anchor) {
                return anchor;
              }
              if (holder) {
                holder.textContent = this.chipModel.text;
                holder.className =
                  "bob-plan-chip bob-note-ready-heading";
                return holder;
              }
              return document.createElement("span");
            } catch (error) {
              try {
                const fallback = document.createElement("span");
                fallback.textContent = "ready –";
                return fallback;
              } catch (inner) {
                return null;
              }
            }
          }
        };
      } catch (error) {
        return Decoration.none;
      }
      let pos = null;
      try {
        const doc = view.state.doc;
        const line = doc.line(lineIndex + 1);
        pos = line.to;
      } catch (error) {
        return Decoration.none;
      }
      if (pos === null || pos === undefined) {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      try {
        builder.add(
          pos,
          pos,
          Decoration.widget({ widget: new HeadingWidget(model, filePath), side: 1 }),
        );
      } catch (error) {
        return Decoration.none;
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

  createNoteReadyHeadingExtension() {
    try {
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      if (!Decoration || !WidgetType || !StateEffect || !RangeSetBuilder) {
        return null;
      }
      if (!editorInfoField || !editorLivePreviewField) {
        return null;
      }
      const plugin = this;
      const HeadingPluginClass = class {
        constructor(view) {
          try {
            this.decorations =
              plugin.buildNoteReadyHeadingDecorations(view);
          } catch (error) {
            try {
              this.decorations = Decoration.none;
            } catch (inner) {
              this.decorations = null;
            }
          }
          try {
            const info = view.state.field(editorInfoField);
            this.lastPath =
              info && info.file && typeof info.file.path === "string"
                ? info.file.path
                : null;
          } catch (error) {
            this.lastPath = null;
          }
          try {
            this.lastLive = view.state.field(editorLivePreviewField);
          } catch (error) {
            this.lastLive = null;
          }
        }

        update(u) {
          try {
            let pathChanged = false;
            let liveChanged = false;
            try {
              const info = u.view.state.field(editorInfoField);
              const nextPath =
                info && info.file && typeof info.file.path === "string"
                  ? info.file.path
                  : null;
              pathChanged = nextPath !== this.lastPath;
              this.lastPath = nextPath;
            } catch (error) {
              // Path tracking is best-effort only.
            }
            try {
              const nextLive = u.view.state.field(editorLivePreviewField);
              liveChanged = nextLive !== this.lastLive;
              this.lastLive = nextLive;
            } catch (error) {
              // Live tracking is best-effort only.
            }
            if (
              pathChanged ||
              liveChanged ||
              plugin.noteReadyHeadingShouldRebuild(u)
            ) {
              this.decorations =
                plugin.buildNoteReadyHeadingDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      let extension = null;
      try {
        extension = ViewPlugin.fromClass(HeadingPluginClass, {
          decorations: (value) => value.decorations,
        });
      } catch (error) {
        return null;
      }
      try {
        return Prec.highest(extension);
      } catch (error) {
        return extension;
      }
    } catch (error) {
      return null;
    }
  }

  refreshNoteReadyHeadingEditors() {
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
      const refreshEffect = ensureNoteReadyRefresh();
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function" && refreshEffect) {
            cm.dispatch({ effects: refreshEffect.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleNoteReadyHeadingsRefresh() {
    if (
      this.noteReadyHeadingsRefreshTimer !== null &&
      this.noteReadyHeadingsRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.noteReadyHeadingsRefreshTimer = schedule(() => {
      this.noteReadyHeadingsRefreshTimer = null;
      try {
        this.refreshNoteReadyReadingChips();
      } catch (error) {
        // Best-effort refresh only.
      }
      try {
        this.refreshNoteReadyHeadingEditors();
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  // One consolidated live-refresh fan-out (ledger-views): the four
  // hand-maintained fan-out sites call this instead of scheduling
  // each family separately, so new widget families cannot miss a
  // site. No behavior change for existing widgets.
  scheduleLiveWidgetRefresh() {
    try {
      this.scheduleReadyRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleDashboardLaneRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleFreshnessStatusBar();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleFreshnessMarksRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleReviewChipsRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleCrowdedRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleReadyNotesRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleNoteReadyHeadingsRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleDependencyChipsRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleProgressMarksRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
    try {
      this.scheduleUnblockedGlyphRefresh();
    } catch (error) {
      // One missed schedule never breaks the fan-out.
    }
  }

  // --- NEW/ROTTEN review chips (freshness namespace v5) ----------------  // Lifecycle-owned live chips for DataviewJS surfaces (dash NEW, the
  // rotten summary): the same widget pattern as the READY badge — one
  // anchor per component, detached nodes pruned, refreshed on the same
  // debounce paths, subscriptions dropped when the component unloads.
  // Models come from `freshnessReviewModel` so dash and rotten share
  // counts, meter, tooltip, and severity.
  renderReviewChip(parent, options = {}) {
    try {
      if (!parent || typeof parent.createEl !== "function") {
        return null;
      }
      const kind =
        options.kind === "rotten" ? "rotten" : "new";
      const component = options.component || null;
      if (!this.reviewWidgets) {
        this.reviewWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.reviewWidgets)) {
          if (widget.component === component && widget.kind === kind) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.reviewWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.reviewWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!parent.contains || !parent.contains(el)) {
              this.reviewWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      const review = this.freshnessReviewModel(new Date());
      const anchor = paintReviewElement(parent, kind, review);
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, kind, component };
      this.reviewWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.reviewWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  refreshReviewChips(now = new Date()) {
    if (!this.reviewWidgets || this.reviewWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    let review = null;
    try {
      review = this.freshnessReviewModel(now);
    } catch (error) {
      return false;
    }
    for (const widget of Array.from(this.reviewWidgets)) {
      try {
        const el = widget.el;
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.reviewWidgets.delete(widget);
          }
          continue;
        }
        setReviewAnchorContent(el, widget.kind, review);
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleReviewChipsRefresh() {
    if (
      this.reviewRefreshTimer !== null &&
      this.reviewRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    const self = this;
    this.reviewRefreshTimer = schedule(() => {
      self.reviewRefreshTimer = null;
      try {
        self.refreshReviewChips(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

}
