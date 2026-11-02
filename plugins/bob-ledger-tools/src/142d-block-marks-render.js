// --- Blocked-reason marks: miniature renderer ------------------------------
// Owned by bob-cli `docs/blocked-marks.md`. `buildBlockMarkElement` is the
// shared listener-free miniature painted by the gated block-mark CSS: the
// same data attributes as marked rows, no children, no listeners. The
// plugin-gated `blockMarkRender` (exposed as `api.blockMarks.render`) is its
// thin wrapper; it never requires a source task, so synthetic digit models
// for the later Task Card phase render. Every function is synchronous and
// never throws.

const BLOCK_MARK_RENDER_KEYS = Object.freeze([
  "dep",
  "prj",
  "p1",
  "p2",
  "p3",
  "p4",
  "repeat",
  "date",
  "stale",
]);

const BLOCK_MARK_RENDER_FAMILIES = Object.freeze(["held", "waiting", "stale"]);

function blockMarkRenderKeyIsValid(key) {
  try {
    return (
      typeof key === "string" && BLOCK_MARK_RENDER_KEYS.indexOf(key) !== -1
    );
  } catch (error) {
    return false;
  }
}

function blockMarkRenderFamilyIsValid(family) {
  try {
    return (
      typeof family === "string" &&
      BLOCK_MARK_RENDER_FAMILIES.indexOf(family) !== -1
    );
  } catch (error) {
    return false;
  }
}

// Append-free pure builder: returns the `span.bob-block-mark` for `doc`
// without touching the host, so tests can use a foreign ownerDocument.
// Meaningful marks get `role="img"` plus the model tooltip as `aria-label`;
// `options.decorative` marks get `aria-hidden="true"` instead. Returns null
// for an unusable document, model, or tooltip host. Never throws and never
// attaches listeners or children: the gated CSS draws the glyph and pip.
function buildBlockMarkElement(doc, model, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    if (!model || typeof model !== "object") return null;
    if (!blockMarkRenderKeyIsValid(model.key)) return null;
    if (!blockMarkRenderFamilyIsValid(model.family)) return null;
    const opts = options && typeof options === "object" ? options : {};
    const decorative = Boolean(opts.decorative);
    let span = null;
    try {
      span = doc.createElement("span");
    } catch (error) {
      return null;
    }
    if (!span || typeof span.setAttribute !== "function") return null;
    try {
      span.setAttribute("class", "bob-block-mark");
      span.setAttribute("data-bob-block", String(model.key));
      span.setAttribute("data-bob-block-family", String(model.family));
      if (
        typeof model.more === "string" &&
        blockMarkRenderKeyIsValid(model.more)
      ) {
        span.setAttribute("data-bob-block-more", String(model.more));
      }
      if (decorative) {
        span.setAttribute("aria-hidden", "true");
      } else {
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", String(model.tooltip || ""));
      }
    } catch (error) {
      return null;
    }
    return span;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsBlockMarksRenderMixin {
  // Listener-free miniature for any host element: resolves the host's own
  // document (popout-safe), appends one `span.bob-block-mark`, and returns
  // it. Returns null for an invalid host or model, a disabled gate, or an
  // unavailable DOM. Synchronous and never throws.
  blockMarkRender(host, model, options) {
    try {
      if (this.blockMarksEnabled === false) return null;
      if (!host || typeof host !== "object") return null;
      let doc = null;
      try {
        doc = host.ownerDocument || null;
      } catch (error) {
        doc = null;
      }
      if (!doc && typeof document !== "undefined" && document) {
        doc = document;
      }
      const element = buildBlockMarkElement(doc, model, options);
      if (!element) return null;
      try {
        host.appendChild(element);
      } catch (error) {
        return null;
      }
      return element;
    } catch (error) {
      return null;
    }
  }
}
