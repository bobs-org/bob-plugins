// Live Preview widget for one generated BLOCKS row. Navigation always
// works; ＋ / hover × appear only when `meta.interactive` is set (open
// owner with nav `api.blocks` v1).
let BlocksChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  BlocksChipWidget = class extends WidgetType {
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
        ]);
      } catch (error) {
        this.key = String(model && model.summary || "");
      }
    }

    eq(other) {
      return Boolean(other && other instanceof BlocksChipWidget && other.key === this.key);
    }

    toDOM(view) {
      const plugin = this.meta.plugin;
      const sourcePath = this.meta.sourcePath || "";
      const interactive = Boolean(this.meta.interactive);
      const dom = buildBlocksChipElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        {
          plugin,
          sourcePath,
          interactive,
          onRemove: (chip) => {
            try {
              if (plugin && typeof plugin.blocksRemoveDependent === "function") {
                plugin.blocksRemoveDependent(chip, sourcePath, this.meta);
              }
            } catch (error) {
              // Best-effort only.
            }
          },
          onAdd: () => {
            try {
              if (plugin && typeof plugin.blocksOpenStage === "function") {
                plugin.blocksOpenStage(sourcePath, this.meta);
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
        const self = this;
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
              void self;
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
