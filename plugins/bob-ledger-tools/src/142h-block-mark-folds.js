// --- Blocked-reason marks: redundancy-fold widgets ------------------------
// Empty Live Preview widgets for the tag pill the box already says: the
// `#prj_is_blocked` pill on `prj` rows and the `#awaiting_reply` pill on
// `awaiting` rows. Digit-row priority bars reuse `PriorityMarkWidget`
// with `data-folded="true"`. Every helper is synchronous and never
// throws.

function buildBlockMarkPrjFoldElement(doc, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const settings = options && typeof options === "object" ? options : {};
    const foldSpace = Boolean(settings.foldSpace);
    const tag = typeof settings.tag === "string" && settings.tag
      ? settings.tag
      : "#prj_is_blocked";
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-block-prj-fold");
    span.setAttribute("data-folded", "true");
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    span.setAttribute("data-fold-tag", tag);
    span.setAttribute("aria-hidden", "true");
    return span;
  } catch (error) {
    return null;
  }
}

let BlockMarkPrjFoldWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  BlockMarkPrjFoldWidget = class extends WidgetType {
    constructor(foldSpace, tag) {
      super();
      this.foldSpace = Boolean(foldSpace);
      this.tag = typeof tag === "string" && tag ? tag : "#prj_is_blocked";
      this.key = (this.foldSpace ? "1" : "0") + this.tag;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof BlockMarkPrjFoldWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildBlockMarkPrjFoldElement(
        typeof document !== "undefined" ? document : null,
        { foldSpace: this.foldSpace, tag: this.tag },
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
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
              view.dispatch({
                selection: { anchor: anchor + (self.foldSpace ? 1 : 0) },
              });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Reveal is best-effort.
          }
        });
      } catch (error) {
        // A listener-free fold still occupies the range.
      }
      return dom;
    }
  };
}
