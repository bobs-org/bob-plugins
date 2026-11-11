// --- Project and hidden task-tag marks: pair + metadata core --------------
// Owned by the `docs/task-tag-marks.md` display contract in bob-cli.
// Pure helpers only: the `#task #prj` identity pair (one project glyph
// over both tokens) and an exact whole-token `#hide` metadata mark.
// Every helper is synchronous and never throws; bad input yields null
// or an empty list. Mirrors the `#task #ref` pair helpers in
// `138-task-tag-marks.js`. Fake-DOM friendly: walks
// `parentNode.childNodes`.

// The project-task partner tag: `#prj` in any case (`#prj`, `#PRJ`,
// `#Prj`). Only meaningful directly after an exact `#task` tag.
const PRJ_TASK_TAG_TEXT = "#prj";

// Hover tooltip for the project-target mark. Never contains `::`,
// because Dataview re-scans `innerHTML` for inline fields.
const PRJ_TASK_MARK_TOOLTIP =
  "#task #prj \u00b7 project lifecycle task\nStates what done means for this project";

// Accessible label for the project-target mark (`role="img"` name).
const PRJ_TASK_MARK_LABEL = "Project task";

// The prj variant class (always beside `bob-task-tag-mark`, so the
// shared host rules, toggle, teardown, and resting tones keep
// applying) and the class that hides a paired `#prj` anchor in place.
const PRJ_TASK_MARK_CLASS = "bob-prj-task-mark";
const PRJ_TASK_HIDDEN_CLASS = "bob-prj-task-hidden";

// The exact, case-sensitive hidden-from-review tag.
const HIDE_TAG_TEXT = "#hide";

// Hover tooltip for the eye-off mark. Never contains `::`.
const HIDE_TAG_MARK_TOOLTIP =
  "#hide \u00b7 hidden from review and lanes\nbob writes and removes this tag";

// Accessible label for the eye-off mark (`role="img"` name).
const HIDE_TAG_MARK_LABEL = "Hidden from review";

// The hide variant class (always beside `bob-task-tag-mark`). A hide
// mark never draws a type name.
const HIDE_TAG_MARK_CLASS = "bob-hide-tag-mark";

// The exclusive end offset of the `#prj` partner (any case) that
// follows the `#task` token ending at `taskTo`, or -1 when there is
// none: exactly one whitespace run, then `#prj`, then a tag boundary.
// So `#task #prj` and `#task   #PRJ` pair, while `#task #project`,
// `#task #prj_is_blocked`, `#task#prj`, and a trailing `#prj` on the
// next line never do. Never throws.
function prjTaskPairEnd(text, taskTo) {
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
    let prjText = "";
    try {
      prjText = text.slice(cursor, cursor + PRJ_TASK_TAG_TEXT.length);
    } catch (error) {
      return -1;
    }
    if (prjText.length !== PRJ_TASK_TAG_TEXT.length) {
      return -1;
    }
    if (prjText.toLowerCase() !== PRJ_TASK_TAG_TEXT) {
      return -1;
    }
    const after = cursor + PRJ_TASK_TAG_TEXT.length;
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

// Boundary-only token ranges for `#hide` in `text`: the exact,
// case-sensitive text `#hide`, preceded by the start of the text or
// whitespace, and followed by the end of the text or a non-tag
// character. So `#hidden`, `#hideaway`, `#hide/x`, `#Hide`,
// `foo#hide`, and `(#hide)` never match, while `#hide!` does.
// Returns a frozen array of frozen `{ from, to }` in UTF-16 offsets.
// Never throws.
function hideTagTokenRanges(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return Object.freeze([]);
    }
    const found = [];
    let index = text.indexOf(HIDE_TAG_TEXT);
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
          const after = index + HIDE_TAG_TEXT.length;
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
            Object.freeze({ from: index, to: index + HIDE_TAG_TEXT.length }),
          );
        }
      } catch (error) {
        // One bad token never breaks the scan.
      }
      index = text.indexOf(HIDE_TAG_TEXT, index + 1);
    }
    return Object.freeze(found);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Append `hide` ranges for every exact `#hide` token onto `found`.
// Mutates `found` in place. Never throws.
function appendHideTagMarkRanges(found, lineText) {
  try {
    if (!Array.isArray(found) || typeof lineText !== "string") {
      return;
    }
    const tokens = hideTagTokenRanges(lineText);
    for (const token of tokens) {
      try {
        if (
          !token ||
          typeof token.from !== "number" ||
          typeof token.to !== "number"
        ) {
          continue;
        }
        found.push(
          Object.freeze({
            from: token.from,
            to: token.to,
            kind: "hide",
          }),
        );
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    // Hide tokens are best-effort.
  }
}

// Whether `node` is a `#prj` partner anchor (any case): an `a.tag`
// whose `textContent` lowercases to `#prj` (and whose `href`, if
// present, lowercases to `#prj`). Never throws.
function isPrjTagAnchor(node) {
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
    if (typeof text !== "string" || text.toLowerCase() !== PRJ_TASK_TAG_TEXT) {
      return false;
    }
    try {
      if (node && typeof node.getAttribute === "function") {
        const href = node.getAttribute("href");
        if (href !== null && href !== undefined && href !== "") {
          if (String(href).toLowerCase() !== PRJ_TASK_TAG_TEXT) {
            return false;
          }
        }
      } else if (node.href !== undefined && node.href !== null && node.href !== "") {
        if (String(node.href).toLowerCase() !== PRJ_TASK_TAG_TEXT) {
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

// Whether `node` is an exact `#hide` anchor (case-sensitive): an
// `a.tag` whose `textContent` is exactly `#hide` (and whose `href`,
// if present, is `#hide`). Never throws.
function isHideTagAnchor(node) {
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
    if (text !== HIDE_TAG_TEXT) {
      return false;
    }
    try {
      if (node && typeof node.getAttribute === "function") {
        const href = node.getAttribute("href");
        if (href !== null && href !== undefined && href !== "") {
          if (String(href) !== HIDE_TAG_TEXT) {
            return false;
          }
        }
      } else if (node.href !== undefined && node.href !== null && node.href !== "") {
        if (String(node.href) !== HIDE_TAG_TEXT) {
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

// The adjacent `#prj` partner anchor for an eligible `#task` anchor,
// or null: the next element sibling, skipping whitespace-only text
// nodes, must itself be a `#prj` anchor. Anything else in between (a
// word, a pill, a non-whitespace gap) means the `#task` keeps the
// hash. Walks `parentNode.childNodes` so fake-DOM tests work like the
// real DOM. Never throws.
function prjTaskPairAnchor(taskAnchor) {
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
        return isPrjTagAnchor(kid) ? kid : null;
      }
      return null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Whether `node` is an eligible rendered-view hide-tag host: an
// `a.tag` whose `textContent` is exactly `#hide` (and whose `href`,
// if present, is `#hide`), whose nearest `li` ancestor within `root`
// carries `task-list-item`, and which sits under no `code`/`pre`
// ancestor and no Tasks result row. With no `li` ancestor (a
// detached element), there is no mark. Never throws.
function hideTagMarkElementEligible(node, root) {
  try {
    if (!isHideTagAnchor(node)) {
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

// Annotate a `#task #prj` pair in place: the `#task` anchor keeps
// `bob-task-tag-mark` and gains `bob-prj-task-mark` (the target),
// with the project accessible label; the adjacent `#prj` anchor is
// hidden in place via `bob-prj-task-hidden` so it stays in the DOM
// for copy, Dataview's `innerHTML` round trip, and toggle restore.
// Never creates or removes nodes. Returns true on success, false
// otherwise. Never throws.
function annotatePrjTaskMark(taskAnchor, prjAnchor, identity, inheritedEnabled) {
  try {
    if (!taskAnchor || typeof taskAnchor !== "object") {
      return false;
    }
    if (!annotateTaskTagMark(taskAnchor, identity, inheritedEnabled)) {
      return false;
    }
    try {
      if (taskAnchor.classList && typeof taskAnchor.classList.add === "function") {
        taskAnchor.classList.add(PRJ_TASK_MARK_CLASS);
      } else if (typeof taskAnchor.className === "string") {
        const parts = taskAnchor.className.split(/\s+/).filter((part) => part !== "");
        if (parts.indexOf(PRJ_TASK_MARK_CLASS) === -1) {
          parts.push(PRJ_TASK_MARK_CLASS);
        }
        taskAnchor.className = parts.join(" ");
      }
    } catch (error) {
      return false;
    }
    try {
      const shown = taskTagIdentityShown(identity, inheritedEnabled);
      const aria = shown ? taskTagIdentityAria(identity) : PRJ_TASK_MARK_LABEL;
      const tooltip = identity
        ? taskTagIdentityTooltip(identity)
        : PRJ_TASK_MARK_TOOLTIP;
      if (typeof taskAnchor.setAttribute === "function") {
        taskAnchor.setAttribute("aria-label", aria || PRJ_TASK_MARK_LABEL);
        taskAnchor.setAttribute("title", tooltip || PRJ_TASK_MARK_TOOLTIP);
      } else {
        taskAnchor["aria-label"] = aria || PRJ_TASK_MARK_LABEL;
        taskAnchor.title = tooltip || PRJ_TASK_MARK_TOOLTIP;
      }
    } catch (error) {
      return false;
    }
    if (prjAnchor && typeof prjAnchor === "object") {
      try {
        if (prjAnchor.classList && typeof prjAnchor.classList.add === "function") {
          prjAnchor.classList.add(PRJ_TASK_HIDDEN_CLASS);
        } else if (typeof prjAnchor.className === "string") {
          const parts = prjAnchor.className.split(/\s+/).filter((part) => part !== "");
          if (parts.indexOf(PRJ_TASK_HIDDEN_CLASS) === -1) {
            parts.push(PRJ_TASK_HIDDEN_CLASS);
          }
          prjAnchor.className = parts.join(" ");
        } else if (typeof prjAnchor.setAttribute === "function") {
          prjAnchor.setAttribute("class", PRJ_TASK_HIDDEN_CLASS);
        }
      } catch (error) {
        // Hiding is best-effort; the target still renders.
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Annotate an eligible `#hide` `a.tag` in place: add
// `bob-task-tag-mark` plus `bob-hide-tag-mark`, `aria-label`,
// `title`, and `data-tooltip-position`. Never creates or removes
// nodes and never sets type attributes (a hide mark never draws a
// type name). Returns true on success, false otherwise. Never throws.
function annotateHideTagMark(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.add === "function") {
        el.classList.add("bob-task-tag-mark");
        el.classList.add(HIDE_TAG_MARK_CLASS);
      } else if (typeof el.className === "string") {
        const parts = el.className.split(/\s+/).filter((part) => part !== "");
        if (parts.indexOf("bob-task-tag-mark") === -1) {
          parts.push("bob-task-tag-mark");
        }
        if (parts.indexOf(HIDE_TAG_MARK_CLASS) === -1) {
          parts.push(HIDE_TAG_MARK_CLASS);
        }
        el.className = parts.join(" ");
      } else if (typeof el.setAttribute === "function") {
        el.setAttribute("class", "bob-task-tag-mark " + HIDE_TAG_MARK_CLASS);
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
    try {
      if (typeof el.setAttribute === "function") {
        el.setAttribute("aria-label", HIDE_TAG_MARK_LABEL);
        el.setAttribute("title", HIDE_TAG_MARK_TOOLTIP);
        el.setAttribute("data-tooltip-position", "top");
      } else {
        el["aria-label"] = HIDE_TAG_MARK_LABEL;
        el.title = HIDE_TAG_MARK_TOOLTIP;
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

// Reveal a hidden `#prj` partner anchor (undo the `annotatePrjTaskMark`
// half): remove `bob-prj-task-hidden` so the pill reads natively at
// once. Returns true on success, false otherwise. Never throws.
function stripPrjTaskHidden(el) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    try {
      if (el.classList && typeof el.classList.remove === "function") {
        el.classList.remove(PRJ_TASK_HIDDEN_CLASS);
      } else if (typeof el.className === "string") {
        el.className = el.className
          .split(/\s+/)
          .filter((part) => part !== "" && part !== PRJ_TASK_HIDDEN_CLASS)
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

// Live Preview widgets: one project-target mark per `#task #prj`
// pair, one eye-off mark per exact `#hide` token. `eq` compares a
// constant key, so unchanged marks never flicker. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let PrjTaskMarkWidget = null;
let HideTagMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  PrjTaskMarkWidget = class extends WidgetType {
    constructor(identity, inheritedEnabled) {
      super();
      this.identity = identity || null;
      this.inheritedEnabled = inheritedEnabled === true;
      const type =
        this.identity && typeof this.identity.type === "string"
          ? this.identity.type
          : "";
      const hue =
        this.identity && typeof this.identity.hue === "string"
          ? this.identity.hue
          : "";
      const state =
        this.identity && typeof this.identity.state === "string"
          ? this.identity.state
          : "";
      this.key = "prj-task-mark|" + type + "|" + hue + "|" + state + "|" +
        String(this.inheritedEnabled);
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof PrjTaskMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskTagMarkElement(
        typeof document !== "undefined" ? document : null,
        "prj",
        this.identity,
        this.inheritedEnabled,
      );
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
  HideTagMarkWidget = class extends WidgetType {
    constructor() {
      super();
      this.key = "hide-tag-mark";
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof HideTagMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskTagMarkElement(
        typeof document !== "undefined" ? document : null,
        "hide",
      );
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
