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
// `#task` tags on task lines get a mark.

// The exact, case-sensitive tracked-task tag.
const TASK_TAG_MARK_TEXT = "#task";

// Tooltip lines joined with `\n`. Never contains `::`, because
// Dataview re-scans `innerHTML` for inline fields.
const TASK_TAG_MARK_TOOLTIP =
  "#task \u00b7 tracked task\nCtrl+Shift+] to demote to a bullet";

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

// A Live Preview line's task-tag-mark ranges, in line order: the
// boundary tokens gated by the task-line check
// (`freshnessTaskStatus(lineText) !== null`, quote-aware, so
// callouts and numbered lists count). Every eligible token on the
// line gets its own mark. Code exclusion is NOT applied here: the
// decoration builder drops tokens inside code via
// `freshnessMarkPosInCode`, so ``- [ ] Note `the #task tag` here``
// still reports `[16,21)` from the core (TT10). Plain bullets,
// paragraphs, and headings yield no ranges. Returns a frozen array
// of frozen `{ from, to }` in UTF-16 line offsets. Never throws.
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
    return taskTagMarkTokenRanges(lineText);
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

// Strip an annotation added by `annotateTaskTagMark`: remove the
// class, `aria-label`, and `data-tooltip-position`, so pills look
// and behave natively at once. Returns true on success, false
// otherwise. Never throws.
function stripTaskTagMark(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.remove === "function") {
        el.classList.remove("bob-task-tag-mark");
      } else if (typeof el.className === "string") {
        el.className = el.className
          .split(/\s+/)
          .filter((part) => part !== "" && part !== "bob-task-tag-mark")
          .join(" ");
      }
    } catch (error) {
      // Class removal is best-effort.
    }
    try {
      if (typeof el.removeAttribute === "function") {
        el.removeAttribute("aria-label");
        el.removeAttribute("data-tooltip-position");
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
// the single CSS-mask definition). `doc` provides `createElement` so
// tests can pass a fake document. Never throws: bad input yields
// null.
function buildTaskTagMarkElement(doc) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const span = doc.createElement("span");
    if (!span) {
      return null;
    }
    try {
      span.setAttribute("class", "bob-task-tag-mark");
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", TASK_TAG_MARK_TOOLTIP);
      span.setAttribute("data-tooltip-position", "top");
    } catch (error) {
      return null;
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one task tag mark. `eq` compares a
// constant key, so unchanged marks never flicker. `toDOM` builds the
// listener-free element and adds the reveal-on-click listener only.
// Defined only when `WidgetType` exists; otherwise null and the
// extension is not registered.
let TaskTagMarkWidget = null;
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
      return dom;
    }
  };
}
