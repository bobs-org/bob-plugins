// --- Task tag marks: pure mark-core -------------------------------------
// Owned by the `docs/task-tag-marks.md` display contract in bob-cli.
// Pure helpers only: `#task` token detection, the Live Preview range
// model, rendered-view eligibility, in-place annotation, a
// listener-free DOM builder, and the Live Preview widget. Every
// helper is synchronous and never throws; bad input yields null or an
// empty list. Mirrors the priority-mark code paths in
// `135-priority-marks.js` and reuses `freshnessTaskStatus` and
// `freshnessMarkPosInCode` (code exclusion) from the sibling
// fragments. The mark is truthful, never guessing: only exact, whole
// `#task` tags on task lines get a mark. A `#task` tag immediately
// followed by one whitespace run and `#ref` (any case) is a reference
// reading task and gets the open-book mark instead (contract:
// bob-cli `docs/task-tag-marks.md` "Reference reading tasks").

// The exact, case-sensitive tracked-task tag.
const TASK_TAG_MARK_TEXT = "#task";

// Tooltip lines joined with `\n`. Never contains `::`, because
// Dataview re-scans `innerHTML` for inline fields.
const TASK_TAG_MARK_TOOLTIP =
  "#task \u00b7 tracked task\nCtrl+Shift+] to demote to a bullet";

// The reference-task partner tag: `#ref` in any case (`#ref`, `#REF`,
// `#Ref`). Only meaningful directly after an exact `#task` tag.
const REF_TASK_TAG_TEXT = "#ref";

// Hover tooltip for the open-book mark. Never contains `::`, because
// Dataview re-scans `innerHTML` for inline fields.
const REF_TASK_MARK_TOOLTIP = "#task #ref \u00b7 reference reading task";

// Accessible label for the open-book mark (`role="img"` name).
const REF_TASK_MARK_LABEL = "Reference reading task";

// The ref variant class (always beside `bob-task-tag-mark`, so the
// shared host rules, toggle, teardown, and resting tones keep
// applying) and the class that hides a paired `#ref` anchor in place.
const REF_TASK_MARK_CLASS = "bob-ref-task-mark";
const REF_TASK_HIDDEN_CLASS = "bob-ref-task-hidden";

// A character that continues a tag: letters, numbers, `_`, `/`, `-`.
// Anything else (or the end of the text) ends the tag.
const TASK_TAG_MARK_TAG_CHAR_RE = /[\p{L}\p{N}_/-]/u;

// Boundary-only token ranges for `#task` in `text`: the exact,
// case-sensitive text `#task`, preceded by the start of the text or
// whitespace, and followed by the end of the text or a non-tag
// character. So `#tasks`, `#task/sub`, `#Task`, `foo#task`, and
// `(#task)` never match, while `#task!` does. Returns a frozen array
// of frozen `{ from, to }` in UTF-16 offsets. Never throws.
function taskTagMarkTokenRanges(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return Object.freeze([]);
    }
    const found = [];
    let index = text.indexOf(TASK_TAG_MARK_TEXT);
    while (index !== -1) {
      try {
        let ok = true;
        if (index > 0) {
          try {
            if (!/\s/.test(text[index - 1])) {
              ok = false;
            }
          } catch (error) {
            ok = false;
          }
        }
        if (ok) {
          const after = index + TASK_TAG_MARK_TEXT.length;
          if (after < text.length) {
            try {
              if (TASK_TAG_MARK_TAG_CHAR_RE.test(text[after])) {
                ok = false;
              }
            } catch (error) {
              ok = false;
            }
          }
        }
        if (ok) {
          found.push(
            Object.freeze({ from: index, to: index + TASK_TAG_MARK_TEXT.length }),
          );
        }
      } catch (error) {
        // One bad token never breaks the scan.
      }
      index = text.indexOf(TASK_TAG_MARK_TEXT, index + 1);
    }
    return Object.freeze(found);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The exclusive end offset of the `#ref` partner (any case) that
// follows the `#task` token ending at `taskTo`, or -1 when there is
// none: exactly one whitespace run, then `#ref`, then a tag boundary.
// So `#task #ref` and `#task   #REF` pair, while `#task #references`,
// `#task#ref`, and a trailing `#ref` on the next line never do.
// Never throws.
function refTaskPairEnd(text, taskTo) {
  try {
    if (typeof text !== "string" || typeof taskTo !== "number") {
      return -1;
    }
    let cursor = taskTo;
    let sawGap = false;
    while (cursor < text.length) {
      let ch = "";
      try {
        ch = text[cursor];
      } catch (error) {
        return -1;
      }
      if (!/\s/.test(ch)) {
        break;
      }
      sawGap = true;
      cursor += 1;
    }
    if (!sawGap) {
      return -1;
    }
    let refText = "";
    try {
      refText = text.slice(cursor, cursor + REF_TASK_TAG_TEXT.length);
    } catch (error) {
      return -1;
    }
    if (refText.length !== REF_TASK_TAG_TEXT.length) {
      return -1;
    }
    if (refText.toLowerCase() !== REF_TASK_TAG_TEXT) {
      return -1;
    }
    const after = cursor + REF_TASK_TAG_TEXT.length;
    if (after < text.length) {
      try {
        if (TASK_TAG_MARK_TAG_CHAR_RE.test(text[after])) {
          return -1;
        }
      } catch (error) {
        return -1;
      }
    }
    return after;
  } catch (error) {
    return -1;
  }
}

// A Live Preview line's task-tag-mark ranges, in line order: the
// boundary tokens gated by the task-line check
// (`freshnessTaskStatus(lineText) !== null`, quote-aware, so
// callouts and numbered lists count). Every eligible token on the
// line gets its own mark, except an exact `#task` token immediately
// followed by one whitespace run and `#ref` (any case): that pair
// yields one `ref` range spanning both tokens, so Live Preview draws
// a single open-book glyph (TT20-TT23). Code exclusion is NOT applied
// here: the decoration builder drops tokens inside code via
// `freshnessMarkPosInCode`, so ``- [ ] Note `the #task tag` here``
// still reports `[16,21)` from the core (TT10). Plain bullets,
// paragraphs, and headings yield no ranges. Returns a frozen array
// of frozen `{ from, to, kind }` in UTF-16 line offsets, where `kind`
// is `"task"` or `"ref"`. Never throws.
function taskTagMarkRanges(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return Object.freeze([]);
    }
    if (lineText.indexOf(TASK_TAG_MARK_TEXT) === -1) {
      return Object.freeze([]);
    }
    try {
      if (freshnessTaskStatus(lineText) === null) {
        return Object.freeze([]);
      }
    } catch (error) {
      return Object.freeze([]);
    }
    const tokens = taskTagMarkTokenRanges(lineText);
    const found = [];
    for (const token of tokens) {
      try {
        if (!token || typeof token.from !== "number" || typeof token.to !== "number") {
          continue;
        }
        const pairEnd = refTaskPairEnd(lineText, token.to);
        if (pairEnd !== -1) {
          found.push(Object.freeze({ from: token.from, to: pairEnd, kind: "ref" }));
        } else {
          found.push(Object.freeze({ from: token.from, to: token.to, kind: "task" }));
        }
      } catch (error) {
        // One bad token never breaks the scan.
      }
    }
    return Object.freeze(found);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Whether `node` is an eligible rendered-view task-tag host: an
// `a.tag` whose `textContent` is exactly `#task` (and whose `href`,
// if present, is `#task`), whose nearest `li` ancestor within `root`
// carries `task-list-item`, and which sits under no `code`/`pre`
// ancestor and no Tasks result row (`.plugin-tasks-list-item`,
// `.tasks-list-text`, or `.task-description`). A nested plain child
// bullet under a task gets no mark, while a task nested under a
// plain bullet does. With no `li` ancestor (a detached element),
// there is no mark. Never throws.
function taskTagMarkElementEligible(node, root) {
  try {
    if (!node || typeof node !== "object") {
      return false;
    }
    let tag = "";
    try {
      tag = String(node.tagName || node.nodeName || "").toUpperCase();
    } catch (error) {
      return false;
    }
    if (tag !== "A") {
      return false;
    }
    let text = null;
    try {
      text =
        typeof node.textContent === "string"
          ? node.textContent
          : typeof node.nodeValue === "string"
            ? node.nodeValue
            : null;
    } catch (error) {
      text = null;
    }
    if (text !== TASK_TAG_MARK_TEXT) {
      return false;
    }
    try {
      if (node && typeof node.getAttribute === "function") {
        const href = node.getAttribute("href");
        if (href !== null && href !== undefined && href !== "") {
          if (String(href) !== TASK_TAG_MARK_TEXT) {
            return false;
          }
        }
      } else if (node.href !== undefined && node.href !== null && node.href !== "") {
        if (String(node.href) !== TASK_TAG_MARK_TEXT) {
          return false;
        }
      }
    } catch (error) {
      return false;
    }
    let nearestLi = null;
    try {
      let current = node.parentNode || null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const ancestorTag = String(
            current.tagName || current.nodeName || "",
          ).toUpperCase();
          if (ancestorTag === "CODE" || ancestorTag === "PRE") {
            return false;
          }
          let classText = "";
          try {
            if (
              current.classList &&
              typeof current.classList.contains === "function"
            ) {
              if (
                current.classList.contains("plugin-tasks-list-item") ||
                current.classList.contains("tasks-list-text") ||
                current.classList.contains("task-description")
              ) {
                return false;
              }
            }
            if (typeof current.className === "string") {
              classText = current.className;
            } else if (typeof current.getAttribute === "function") {
              classText = current.getAttribute("class") || "";
            }
          } catch (error) {
            classText = "";
          }
          if (typeof classText === "string" && classText !== "") {
            const parts = classText.split(/\s+/);
            if (
              parts.indexOf("plugin-tasks-list-item") !== -1 ||
              parts.indexOf("tasks-list-text") !== -1 ||
              parts.indexOf("task-description") !== -1
            ) {
              return false;
            }
          }
          if (ancestorTag === "LI" && nearestLi === null) {
            nearestLi = current;
          }
        } catch (error) {
          // Keep walking on per-ancestor failure.
        }
        current = current.parentNode || null;
      }
    } catch (error) {
      return false;
    }
    if (!nearestLi) {
      return false;
    }
    try {
      if (
        nearestLi.classList &&
        typeof nearestLi.classList.contains === "function" &&
        nearestLi.classList.contains("task-list-item")
      ) {
        return true;
      }
      const classText =
        typeof nearestLi.className === "string"
          ? nearestLi.className
          : typeof nearestLi.getAttribute === "function"
            ? nearestLi.getAttribute("class") || ""
            : "";
      return (
        typeof classText === "string" &&
        classText.split(/\s+/).indexOf("task-list-item") !== -1
      );
    } catch (error) {
      return false;
    }
  } catch (error) {
    return false;
  }
}

// Whether `node` is a `#ref` partner anchor (any case): an `a.tag`
// whose `textContent` lowercases to `#ref` (and whose `href`, if
// present, lowercases to `#ref`). Never throws.
function isRefTaskTagAnchor(node) {
  try {
    if (!node || typeof node !== "object") {
      return false;
    }
    let tag = "";
    try {
      tag = String(node.tagName || node.nodeName || "").toUpperCase();
    } catch (error) {
      return false;
    }
    if (tag !== "A") {
      return false;
    }
    let text = null;
    try {
      text =
        typeof node.textContent === "string"
          ? node.textContent
          : typeof node.nodeValue === "string"
            ? node.nodeValue
            : null;
    } catch (error) {
      text = null;
    }
    if (typeof text !== "string" || text.toLowerCase() !== REF_TASK_TAG_TEXT) {
      return false;
    }
    try {
      if (node && typeof node.getAttribute === "function") {
        const href = node.getAttribute("href");
        if (href !== null && href !== undefined && href !== "") {
          if (String(href).toLowerCase() !== REF_TASK_TAG_TEXT) {
            return false;
          }
        }
      } else if (node.href !== undefined && node.href !== null && node.href !== "") {
        if (String(node.href).toLowerCase() !== REF_TASK_TAG_TEXT) {
          return false;
        }
      }
    } catch (error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// The adjacent `#ref` partner anchor for an eligible `#task` anchor,
// or null: the next element sibling, skipping whitespace-only text
// nodes, must itself be a `#ref` anchor. Anything else in between (a
// word, a pill, a non-whitespace gap) means the `#task` keeps the
// hash. Walks `parentNode.childNodes` so fake-DOM tests work like the
// real DOM. Never throws.
function refTaskPairAnchor(taskAnchor) {
  try {
    if (!taskAnchor || typeof taskAnchor !== "object") {
      return null;
    }
    const parent = taskAnchor.parentNode || null;
    if (!parent || typeof parent !== "object") {
      return null;
    }
    const kids = parent.childNodes || [];
    let index = -1;
    try {
      for (let at = 0; at < kids.length; at += 1) {
        if (kids[at] === taskAnchor) {
          index = at;
          break;
        }
      }
    } catch (error) {
      return null;
    }
    if (index === -1) {
      return null;
    }
    for (let at = index + 1; at < kids.length && at < index + 6; at += 1) {
      let kid = null;
      try {
        kid = kids[at];
      } catch (error) {
        return null;
      }
      if (!kid || typeof kid !== "object") {
        return null;
      }
      let nodeType = null;
      try {
        nodeType = kid.nodeType;
      } catch (error) {
        return null;
      }
      if (nodeType === 3) {
        let value = "";
        try {
          value =
            kid.nodeValue !== undefined && kid.nodeValue !== null
              ? String(kid.nodeValue)
              : String(kid.textContent || "");
        } catch (error) {
          value = "";
        }
        if (/^\s*$/.test(value)) {
          continue;
        }
        return null;
      }
      if (nodeType === 1) {
        return isRefTaskTagAnchor(kid) ? kid : null;
      }
      return null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Annotate an eligible `a.tag` in place: add the
// `bob-task-tag-mark` class plus `aria-label` and
// `data-tooltip-position`. Never creates or removes nodes, so it is
// idempotent and survives Dataview's `innerHTML` round trip. Returns
// true on success, false otherwise. Never throws.
function annotateTaskTagMark(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.add === "function") {
        el.classList.add("bob-task-tag-mark");
      } else if (typeof el.className === "string") {
        const parts = el.className.split(/\s+/).filter((part) => part !== "");
        if (parts.indexOf("bob-task-tag-mark") === -1) {
          parts.push("bob-task-tag-mark");
        }
        el.className = parts.join(" ");
      } else if (typeof el.setAttribute === "function") {
        el.setAttribute("class", "bob-task-tag-mark");
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
    try {
      if (typeof el.setAttribute === "function") {
        el.setAttribute("aria-label", TASK_TAG_MARK_TOOLTIP);
        el.setAttribute("data-tooltip-position", "top");
      } else {
        el["aria-label"] = TASK_TAG_MARK_TOOLTIP;
        el["data-tooltip-position"] = "top";
      }
    } catch (error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Annotate a `#task #ref` pair in place: the `#task` anchor keeps
// `bob-task-tag-mark` (so the shared host rules, toggle, teardown,
// and resting tones apply) and gains `bob-ref-task-mark` (the book),
// with the reference accessible label; the adjacent `#ref` anchor is
// hidden in place via `bob-ref-task-hidden` so it stays in the DOM
// for copy, Dataview's `innerHTML` round trip, and toggle restore.
// Never creates or removes nodes. Returns true on success, false
// otherwise. Never throws.
function annotateRefTaskMark(taskAnchor, refAnchor) {
  try {
    if (!taskAnchor || typeof taskAnchor !== "object") {
      return false;
    }
    if (!annotateTaskTagMark(taskAnchor)) {
      return false;
    }
    try {
      if (taskAnchor.classList && typeof taskAnchor.classList.add === "function") {
        taskAnchor.classList.add(REF_TASK_MARK_CLASS);
      } else if (typeof taskAnchor.className === "string") {
        const parts = taskAnchor.className.split(/\s+/).filter((part) => part !== "");
        if (parts.indexOf(REF_TASK_MARK_CLASS) === -1) {
          parts.push(REF_TASK_MARK_CLASS);
        }
        taskAnchor.className = parts.join(" ");
      }
    } catch (error) {
      return false;
    }
    try {
      if (typeof taskAnchor.setAttribute === "function") {
        taskAnchor.setAttribute("aria-label", REF_TASK_MARK_LABEL);
        taskAnchor.setAttribute("title", REF_TASK_MARK_TOOLTIP);
      } else {
        taskAnchor["aria-label"] = REF_TASK_MARK_LABEL;
        taskAnchor.title = REF_TASK_MARK_TOOLTIP;
      }
    } catch (error) {
      return false;
    }
    if (refAnchor && typeof refAnchor === "object") {
      try {
        if (refAnchor.classList && typeof refAnchor.classList.add === "function") {
          refAnchor.classList.add(REF_TASK_HIDDEN_CLASS);
        } else if (typeof refAnchor.className === "string") {
          const parts = refAnchor.className.split(/\s+/).filter((part) => part !== "");
          if (parts.indexOf(REF_TASK_HIDDEN_CLASS) === -1) {
            parts.push(REF_TASK_HIDDEN_CLASS);
          }
          refAnchor.className = parts.join(" ");
        } else if (typeof refAnchor.setAttribute === "function") {
          refAnchor.setAttribute("class", REF_TASK_HIDDEN_CLASS);
        }
      } catch (error) {
        // Hiding is best-effort; the book still renders.
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Reveal a hidden `#ref` partner anchor (undo the `annotateRefTaskMark`
// half): remove `bob-ref-task-hidden` so the pill reads natively at
// once. Returns true on success, false otherwise. Never throws.
function stripRefTaskHidden(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.remove === "function") {
        el.classList.remove(REF_TASK_HIDDEN_CLASS);
      } else if (typeof el.className === "string") {
        el.className = el.className
          .split(/\s+/)
          .filter((part) => part !== "" && part !== REF_TASK_HIDDEN_CLASS)
          .join(" ");
      }
    } catch (error) {
      // Class removal is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Strip an annotation added by `annotateTaskTagMark`: remove the
// class, `aria-label`, and `data-tooltip-position`, so pills look
// and behave natively at once. Also removes the ref variant class,
// so one call restores a book-annotated `#task` anchor too. Returns
// true on success, false otherwise. Never throws.
function stripTaskTagMark(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.remove === "function") {
        el.classList.remove("bob-task-tag-mark");
        el.classList.remove(REF_TASK_MARK_CLASS);
      } else if (typeof el.className === "string") {
        el.className = el.className
          .split(/\s+/)
          .filter(
            (part) =>
              part !== "" &&
              part !== "bob-task-tag-mark" &&
              part !== REF_TASK_MARK_CLASS,
          )
          .join(" ");
      }
    } catch (error) {
      // Class removal is best-effort.
    }
    try {
      if (typeof el.removeAttribute === "function") {
        el.removeAttribute("aria-label");
        el.removeAttribute("data-tooltip-position");
        el.removeAttribute("title");
      } else {
        try {
          delete el["aria-label"];
        } catch (error) {
          // Best-effort.
        }
        try {
          delete el["data-tooltip-position"];
        } catch (error) {
          // Best-effort.
        }
        try {
          delete el.title;
        } catch (error) {
          // Best-effort (`title` is only ours on ref marks).
        }
      }
    } catch (error) {
      // Attribute removal is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. Produces an empty
// `span.bob-task-tag-mark[role="img"]` with the tooltip `aria-label`
// and `data-tooltip-position="top"` (the glyph itself is drawn by
// the single CSS-mask definition). With `kind === "ref"` the span
// also carries `bob-ref-task-mark` (the book), the reference
// accessible label, and the reference tooltip as `title`.
// `doc` provides `createElement` so tests can pass a fake document.
// Never throws: bad input yields null.
function buildTaskTagMarkElement(doc, kind) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const span = doc.createElement("span");
    if (!span) {
      return null;
    }
    try {
      if (kind === "ref") {
        span.setAttribute("class", "bob-task-tag-mark " + REF_TASK_MARK_CLASS);
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", REF_TASK_MARK_LABEL);
        span.setAttribute("title", REF_TASK_MARK_TOOLTIP);
        span.setAttribute("data-tooltip-position", "top");
      } else {
        span.setAttribute("class", "bob-task-tag-mark");
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", TASK_TAG_MARK_TOOLTIP);
        span.setAttribute("data-tooltip-position", "top");
      }
    } catch (error) {
      return null;
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Reveal-on-click for one mark widget: mousedown places the cursor at
// the mark start and focuses the editor, which drops the decoration
// and exposes the raw tag(s). Never throws; the mark renders without
// the listener when anything is missing.
function addTaskTagMarkReveal(dom, view) {
  try {
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
        if (typeof anchor === "number") {
          view.dispatch({
            selection: { anchor },
          });
        }
        if (view && typeof view.focus === "function") {
          view.focus();
        }
      } catch (error) {
        // Reveal is best-effort; the mark itself still renders.
      }
    });
  } catch (error) {
    // A listener-free mark still renders.
  }
}

// Live Preview widgets: one hash mark per exact `#task` tag, one
// open-book mark per `#task #ref` pair. `eq` compares a constant key,
// so unchanged marks never flicker. `toDOM` builds the listener-free
// element and adds the reveal-on-click listener only. Defined only
// when `WidgetType` exists; otherwise null and the extension is not
// registered.
let TaskTagMarkWidget = null;
let RefTaskMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  TaskTagMarkWidget = class extends WidgetType {
    constructor() {
      super();
      this.key = "task-tag-mark";
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof TaskTagMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskTagMarkElement(
        typeof document !== "undefined" ? document : null,
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildTaskTagMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      addTaskTagMarkReveal(dom, view);
      return dom;
    }
  };
  RefTaskMarkWidget = class extends WidgetType {
    constructor() {
      super();
      this.key = "ref-task-mark";
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof RefTaskMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskTagMarkElement(
        typeof document !== "undefined" ? document : null,
        "ref",
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildTaskTagMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      addTaskTagMarkReveal(dom, view);
      return dom;
    }
  };
}
