// Live Preview widget for one task's aggregated `🪢 links` block (full
// mode on the first relation line, continuation mode on the second).
// Navigation (click / Mod-click / hover preview) always works; ＋ /
// hover × appear only when `meta.interactive` is set (nav
// `api.relations`). Stale, broken, archived, and muted chips stay
// navigation-only.
let RelationChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  RelationChipWidget = class extends WidgetType {
    constructor(model, meta) {
      super();
      this.model = model;
      this.meta = meta && typeof meta === "object" ? meta : {};
      try {
        this.key = JSON.stringify([
          model,
          this.meta.sourcePath || "",
          this.meta.lineNumber === undefined ? null : this.meta.lineNumber,
          Boolean(this.meta.interactive),
          this.meta.mode || "full",
        ]);
      } catch (error) {
        this.key = String((model && model.label) || "");
      }
    }

    eq(other) {
      return Boolean(other && other instanceof RelationChipWidget && other.key === this.key);
    }

    toDOM(view) {
      const plugin = this.meta.plugin;
      const sourcePath = this.meta.sourcePath || "";
      const interactive = Boolean(this.meta.interactive);
      const dom = buildRelationBlockElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        {
          plugin,
          sourcePath,
          mode: this.meta.mode === "continuation" ? "continuation" : "full",
          interactive,
          onOpen: (linktext, event) => {
            try {
              if (plugin && typeof plugin.dependencyOpenTarget === "function") {
                plugin.dependencyOpenTarget(linktext, sourcePath, event);
              }
            } catch (error) {
              // Best-effort only.
            }
          },
          onHover: (linktext, event, chipEl) => {
            try {
              if (plugin && typeof plugin.dependencyHoverTarget === "function") {
                plugin.dependencyHoverTarget(linktext, sourcePath, event, chipEl || dom, dom);
              }
            } catch (error) {
              // Best-effort only.
            }
          },
          onRemove: (chip) => {
            try {
              if (plugin && typeof plugin.relationRemoveLink === "function") {
                plugin.relationRemoveLink(chip, sourcePath, this.meta);
              }
            } catch (error) {
              // Best-effort only.
            }
          },
          onAdd: () => {
            try {
              if (plugin && typeof plugin.relationOpenStage === "function") {
                plugin.relationOpenStage(sourcePath, this.meta);
              }
            } catch (error) {
              // Best-effort only.
            }
          },
        },
      );
      if (!dom) {
        try {
          return typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        } catch (error) {
          return null;
        }
      }
      try {
        if (typeof dom.addEventListener === "function") {
          dom.addEventListener("mousedown", (event) => {
            try {
              const target = event && event.target ? event.target : null;
              let interactiveTarget = false;
              try {
                if (target && typeof target.closest === "function") {
                  interactiveTarget = Boolean(target.closest(".bob-dep-chip,.bob-dep-add,.bob-dep-chip-remove"));
                } else {
                  let node = target;
                  let guard = 0;
                  while (node && node !== dom && guard < 6) {
                    guard += 1;
                    const cls = node.className || "";
                    if (typeof cls === "string" && (cls.indexOf("bob-dep-chip") !== -1 || cls.indexOf("bob-dep-add") !== -1)) {
                      interactiveTarget = true;
                      break;
                    }
                    node = node.parentNode || null;
                  }
                }
              } catch (error) {
                interactiveTarget = false;
              }
              if (interactiveTarget) {
                return;
              }
              if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              let anchor = null;
              try {
                anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(dom) : null;
              } catch (error) {
                anchor = null;
              }
              if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
                view.dispatch({ selection: { anchor } });
              }
              if (view && typeof view.focus === "function") {
                view.focus();
              }
            } catch (error) {
              // Reveal is best-effort.
            }
          });
        }
      } catch (error) {
        // A listener-free row still renders.
      }
      return dom;
    }
  };
}
