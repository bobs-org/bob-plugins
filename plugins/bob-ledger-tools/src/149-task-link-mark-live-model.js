// --- Task link marks: Live Preview model, host builder, widget -----------
// Owned by the `docs/task-link-marks.md` display contract in bob-cli
// (bob-cli-f5 phase `live_preview`). The pure live-document model (the
// block-id -> line map and the per-document-version memo), the swap
// bookkeeping, the listener-free host element shared with the Reading
// view, and the zero-width Live Preview widget. `148-task-link-marks.js`
// owns the scanner, the line context, and the state/tooltip models;
// `284-plugin-task-link-marks.js` owns the editor extension. Every
// helper is synchronous and never throws.

// Lazy refresh effect: defined on first use so requiring the module
// never adds an eager `StateEffect.define()` call (the freshness-mark
// surfaces suite pins the eager count).
let taskLinkMarksRefresh = null;
function ensureTaskLinkMarksRefresh() {
  if (taskLinkMarksRefresh) {
    return taskLinkMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      taskLinkMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    taskLinkMarksRefresh = null;
  }
  return taskLinkMarksRefresh;
}

// How long a swapped ring keeps its `swap` flag (and so its stable
// widget identity) after the state change, and how many painted keys a
// view remembers.
const TASK_LINK_MARK_SWAP_MS = 400;
const TASK_LINK_MARK_PAINTED_MAX = 2000;

// The live-document model for one document version: split lines, the
// UTF-16 offset where each line starts, and the id -> line-index lists
// of every trailing standalone `^id` outside fences, comments, and
// frontmatter. A duplicate id lists two or more lines. `ctx` is the
// shared `taskLinkMarkDocContext`. Never throws; bad input yields an
// empty model.
function taskLinkMarkLiveDocModel(text, path) {
  try {
    const lines = String(text === undefined || text === null ? "" : text).split("\n");
    const starts = new Array(lines.length);
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
      starts[index] = offset;
      offset += lines[index].length + 1;
    }
    const ctx = taskLinkMarkDocContext(lines, path);
    const blocks = new Map();
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const line = lines[index];
        if (line.indexOf("^") === -1 || ctx.inert(index)) {
          continue;
        }
        const id = taskLinkMarkTrailingBlockId(line);
        if (id === null) {
          continue;
        }
        const seen = blocks.get(id);
        if (seen) {
          seen.push(index);
        } else {
          blocks.set(id, [index]);
        }
      } catch (error) {
        continue;
      }
    }
    return Object.freeze({ lines, starts, blocks, ctx });
  } catch (error) {
    return Object.freeze({
      lines: [],
      starts: [],
      blocks: new Map(),
      ctx: taskLinkMarkDocContext([], path),
    });
  }
}

// The line index containing document offset `pos` (the last start at
// or before it). Binary search over `model.starts`. Never throws.
function taskLinkMarkLineIndexAt(model, pos) {
  try {
    const starts = model && Array.isArray(model.starts) ? model.starts : [];
    let low = 0;
    let high = starts.length - 1;
    let found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= pos) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  } catch (error) {
    return 0;
  }
}

// Live lookup of `^blockId` in one live-document model: `{state, title}`
// when exactly one line carries the id and that line is a checkbox list
// item with an exact `#task` outside inline code; null otherwise
// (missing id, duplicate id, plain checklist, plain bullet, paragraph).
// `statusTypeFor(symbol)` supplies the Tasks status type for a symbol
// outside ` *\/?xX-`. Never throws.
function taskLinkMarkLiveLookup(model, blockId, statusTypeFor) {
  try {
    if (!model || !(model.blocks instanceof Map) || !Array.isArray(model.lines)) {
      return null;
    }
    const hits = model.blocks.get(String(blockId || ""));
    if (!hits || hits.length !== 1) {
      return null;
    }
    const line = model.lines[hits[0]];
    const parsed = taskLinkMarkParseTaskLine(line);
    if (!parsed || !parsed.hasTask) {
      return null;
    }
    let statusType = null;
    try {
      if (typeof statusTypeFor === "function" && !/^[ *\/?xX-]$/.test(parsed.symbol)) {
        statusType = statusTypeFor(parsed.symbol);
      }
    } catch (error) {
      statusType = null;
    }
    const state = taskLinkMarkStateFromSymbol(parsed.symbol, statusType);
    if (!state) {
      return null;
    }
    return Object.freeze({ state, title: line });
  } catch (error) {
    return null;
  }
}

// Per-view bookkeeping behind the swap animation: a bounded LRU of the
// last painted state per target key plus the clock stamp of the most
// recent state change per key. Never throws.
function taskLinkMarkNewViewState() {
  return { painted: new Map(), swaps: new Map() };
}

// Records the state painted for `key` and reports whether the ring
// should play the swap animation: only when `allowSwap` holds, the key
// was already painted in this view with a different state, or its swap
// stamp is still inside the swap window (so the widget identity stays
// stable while the animation plays). Never throws.
function taskLinkMarkSwapFor(viewState, key, state, nowMs, allowSwap) {
  try {
    if (!viewState || !(viewState.painted instanceof Map) || !(viewState.swaps instanceof Map)) {
      return false;
    }
    const previous = viewState.painted.get(key);
    if (previous !== undefined) {
      viewState.painted.delete(key);
    }
    viewState.painted.set(key, state);
    while (viewState.painted.size > TASK_LINK_MARK_PAINTED_MAX) {
      const oldest = viewState.painted.keys().next().value;
      viewState.painted.delete(oldest);
      viewState.swaps.delete(oldest);
    }
    if (allowSwap && previous !== undefined && previous !== state) {
      viewState.swaps.set(key, nowMs);
      return true;
    }
    const stamp = viewState.swaps.get(key);
    if (typeof stamp === "number") {
      if (nowMs - stamp < TASK_LINK_MARK_SWAP_MS && previous === state) {
        return true;
      }
      viewState.swaps.delete(key);
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Listener-free ring host, shared by the Live Preview widget and the
// Reading-view post-processor, so it survives Dataview's `innerHTML`
// round-trip. Produces an empty
// `span.bob-task-link-mark[data-state][role=img][aria-label][data-tooltip-position=top]`
// (plus `bob-task-link-mark-swap` while the swap plays). There is no
// `title`, no text, and no listeners; the tooltip never carries `::`.
// `doc` provides `createElement` so tests can pass a fake document.
// Never throws: bad input yields null.
function buildTaskLinkMarkElement(doc, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const opts = options && typeof options === "object" ? options : {};
    const state = typeof opts.state === "string" ? opts.state : "";
    if (!["ready", "next", "in-progress", "blocked", "done", "cancelled"].includes(state)) {
      return null;
    }
    const tooltip = String(
      typeof opts.tooltip === "string" && opts.tooltip.trim() !== ""
        ? opts.tooltip
        : taskLinkMarkStateLabel(state),
    ).replace(/::/g, ":");
    const span = doc.createElement("span");
    span.setAttribute(
      "class",
      "bob-task-link-mark" + (opts.swap === true ? " bob-task-link-mark-swap" : ""),
    );
    span.setAttribute("data-state", state);
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", tooltip);
    span.setAttribute("data-tooltip-position", "top");
    try {
      span.textContent = "";
    } catch (error) {
      // An empty host still renders.
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one ring. Zero-width and position-free: it
// sits at the link token start and covers no text. `eq` compares the
// key, state, tooltip, and swap flag (plus the click target, so a reused
// DOM never carries a stale link). Plain mousedown places the caret just
// before the link and focuses the editor; Mod+mousedown behaves exactly
// like Mod+clicking the link text through `onOpen`. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let TaskLinkMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  TaskLinkMarkWidget = class extends WidgetType {
    constructor(model, onOpen) {
      super();
      const input = model && typeof model === "object" ? model : {};
      this.key = String(input.key || "");
      this.state = String(input.state || "");
      this.tooltip = String(input.tooltip || "");
      this.swap = input.swap === true;
      this.linktext = String(input.linktext || "");
      this.sourcePath = String(input.sourcePath || "");
      this.onOpen = typeof onOpen === "function" ? onOpen : null;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof TaskLinkMarkWidget &&
        other.key === this.key &&
        other.state === this.state &&
        other.tooltip === this.tooltip &&
        other.swap === this.swap &&
        other.linktext === this.linktext &&
        other.sourcePath === this.sourcePath
      );
    }

    toDOM(view) {
      const dom = buildTaskLinkMarkElement(
        typeof document !== "undefined" ? document : null,
        { state: this.state, tooltip: this.tooltip, swap: this.swap },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildTaskLinkMarkElement` directly; never throw here.
      if (!dom) {
        return typeof document !== "undefined" && document
          ? document.createElement("span")
          : null;
      }
      try {
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && event.button !== undefined && event.button !== null && event.button !== 0) {
              return;
            }
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let isMac = false;
            try {
              isMac = Boolean(Platform && Platform.isMacOS);
            } catch (error) {
              isMac = false;
            }
            if (todayMarkModifierPressed(event, isMac)) {
              if (this.onOpen) {
                try {
                  this.onOpen(this.linktext, this.sourcePath);
                } catch (error) {
                  // An open failure never breaks the editor.
                }
              }
              return;
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
            // Placing the cursor is best-effort; the ring renders.
          }
        });
      } catch (error) {
        // A listener-free ring still renders.
      }
      return dom;
    }
  };
}
