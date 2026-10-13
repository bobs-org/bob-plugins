// Live Preview widget for one generated BLOCKS row. It has navigation only:
// no dependency-writing controls are exposed from the prerequisite side.
let BlocksChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  BlocksChipWidget = class extends WidgetType {
    constructor(model, meta) {
      super();
      this.model = model;
      this.meta = meta && typeof meta === "object" ? meta : {};
      try {
        this.key = JSON.stringify([model, this.meta.sourcePath || "", this.meta.lineNumber]);
      } catch (error) {
        this.key = String(model && model.summary || "");
      }
    }

    eq(other) {
      return Boolean(other && other instanceof BlocksChipWidget && other.key === this.key);
    }

    toDOM() {
      return buildBlocksChipElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { plugin: this.meta.plugin, sourcePath: this.meta.sourcePath || "" },
      );
    }
  };
}
