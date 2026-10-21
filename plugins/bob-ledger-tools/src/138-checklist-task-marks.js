// --- PRE/POST checklist task marks: shared membership and glyph core --------
// Owned by `docs/task-tag-marks.md` in bob-cli. These helpers recognize
// exact checklist tags and the canonical identity run used by the task
// tag mark and recurrence display contracts. They are synchronous,
// defensive, and never mutate source text.

const CHECKLIST_TAG_TOKEN_RE = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;
const CHECKLIST_TASK_MARK_CLASSES = Object.freeze({
  pre: "bob-pre-task-mark",
  post: "bob-post-task-mark",
});
const CHECKLIST_TASK_MARK_LABELS = Object.freeze({
  pre: "PRE opening checklist task",
  post: "POST closing checklist task",
});
const CHECKLIST_TASK_MARK_TOOLTIPS = Object.freeze({
  pre: "#task #gtd #pre \u00b7 PRE opening checklist\nOpens the ]s walk \u00b7 Ctrl+Enter when done",
  post: "#task #gtd #post \u00b7 POST closing checklist\nCloses the ]s walk (]S) \u00b7 Ctrl+Enter when done",
});
const CHECKLIST_TASK_HIDDEN_CLASS = "bob-checklist-task-hidden";

// Whole-tag tokens in `text`, lowercased. A token begins at the text
// start or after whitespace and consumes letters, numbers, `_`, `/`,
// and `-`, matching the task-tag mark grammar. Never throws.
function checklistTagTokens(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return Object.freeze([]);
    }
    const tokens = [];
    const matcher = new RegExp(CHECKLIST_TAG_TOKEN_RE.source, "gu");
    let match = null;
    while ((match = matcher.exec(text)) !== null) {
      try {
        if (typeof match[2] === "string") {
          tokens.push(match[2].toLowerCase());
        }
      } catch (error) {
        // Skip one malformed token and keep scanning.
      }
      if (match[0] === "") {
        matcher.lastIndex += 1;
      }
    }
    return Object.freeze(tokens);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The checklist membership evaluator is the authority: PRE wins a
// conflict and nested tags such as `#gtd/pre` are not membership.
function checklistKindForText(text) {
  try {
    return freshnessChecklistForTags(checklistTagTokens(text));
  } catch (error) {
    return null;
  }
}

// True when the text contains both exact PRE and POST tags. Never
// throws.
function checklistTagConflict(text) {
  try {
    const tokens = new Set(checklistTagTokens(text));
    return tokens.has("#pre") && tokens.has("#post");
  } catch (error) {
    return false;
  }
}

function checklistReadTagToken(text, from) {
  try {
    if (typeof text !== "string" || typeof from !== "number" || text[from] !== "#") {
      return null;
    }
    let to = from + 1;
    while (to < text.length) {
      try {
        if (!TASK_TAG_MARK_TAG_CHAR_RE.test(text[to])) {
          break;
        }
      } catch (error) {
        return null;
      }
      to += 1;
    }
    if (to === from + 1) {
      return null;
    }
    return Object.freeze({ text: text.slice(from, to).toLowerCase(), to });
  } catch (error) {
    return null;
  }
}

function checklistSkipWhitespace(text, from) {
  try {
    let to = from;
    while (to < text.length && /\s/.test(text[to])) {
      to += 1;
    }
    return to > from ? to : -1;
  } catch (error) {
    return -1;
  }
}

// Match the two checklist partner tags immediately after `#task`.
// There must be one whitespace run between each token, either tag
// order is accepted, and any PRE/POST conflict on the line rejects it.
// Returns the exclusive end and kind, or null. Never throws.
function checklistTaskRunEnd(lineText, taskTo) {
  try {
    if (
      typeof lineText !== "string" ||
      typeof taskTo !== "number" ||
      taskTo < TASK_TAG_MARK_TEXT.length ||
      lineText.slice(taskTo - TASK_TAG_MARK_TEXT.length, taskTo) !== TASK_TAG_MARK_TEXT ||
      checklistTagConflict(lineText)
    ) {
      return null;
    }
    const firstStart = checklistSkipWhitespace(lineText, taskTo);
    if (firstStart < 0) {
      return null;
    }
    const first = checklistReadTagToken(lineText, firstStart);
    if (!first) {
      return null;
    }
    const secondStart = checklistSkipWhitespace(lineText, first.to);
    if (secondStart < 0) {
      return null;
    }
    const second = checklistReadTagToken(lineText, secondStart);
    if (!second) {
      return null;
    }
    const pair = new Set([first.text, second.text]);
    if (pair.size !== 2 || !pair.has("#gtd")) {
      return null;
    }
    const kind = pair.has("#pre") ? "pre" : pair.has("#post") ? "post" : null;
    return kind ? Object.freeze({ to: second.to, kind }) : null;
  } catch (error) {
    return null;
  }
}

function checklistAnchorIsTag(anchor, expected) {
  try {
    if (!anchor || typeof anchor !== "object") {
      return false;
    }
    const tagName = String(anchor.tagName || anchor.nodeName || "").toUpperCase();
    if (tagName !== "A") {
      return false;
    }
    let isTag = false;
    try {
      isTag = Boolean(
        anchor.classList &&
          typeof anchor.classList.contains === "function" &&
          anchor.classList.contains("tag"),
      );
    } catch (error) {
      isTag = false;
    }
    if (!isTag) {
      const classes = String(anchor.className || "").split(/\s+/);
      isTag = classes.indexOf("tag") !== -1;
    }
    if (!isTag || String(anchor.textContent || "").trim().toLowerCase() !== expected) {
      return false;
    }
    if (typeof anchor.getAttribute === "function") {
      const href = anchor.getAttribute("href");
      if (href !== null && href !== undefined && href !== "") {
        return String(href).toLowerCase() === expected;
      }
    } else if (anchor.href !== undefined && anchor.href !== null && anchor.href !== "") {
      return String(anchor.href).toLowerCase() === expected;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function checklistNextAnchorSibling(anchor) {
  try {
    const parent = anchor && anchor.parentNode;
    const children = parent && parent.childNodes;
    if (!children) {
      return null;
    }
    let index = -1;
    for (let at = 0; at < children.length; at += 1) {
      if (children[at] === anchor) {
        index = at;
        break;
      }
    }
    if (index < 0) {
      return null;
    }
    for (let at = index + 1; at < children.length && at < index + 8; at += 1) {
      const sibling = children[at];
      if (!sibling || typeof sibling !== "object") {
        return null;
      }
      if (sibling.nodeType === 3) {
        const value =
          sibling.nodeValue !== undefined && sibling.nodeValue !== null
            ? String(sibling.nodeValue)
            : String(sibling.textContent || "");
        if (/^\s*$/.test(value)) {
          continue;
        }
        return null;
      }
      return sibling.nodeType === 1 ? sibling : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function checklistNearestTaskItem(anchor) {
  try {
    let current = anchor && anchor.parentNode;
    let guard = 0;
    while (current && guard < 100) {
      guard += 1;
      if (String(current.tagName || current.nodeName || "").toUpperCase() === "LI") {
        let hasClass = false;
        try {
          hasClass = Boolean(
            current.classList &&
              typeof current.classList.contains === "function" &&
              current.classList.contains("task-list-item"),
          );
        } catch (error) {
          hasClass = false;
        }
        if (!hasClass) {
          hasClass = String(current.className || "").split(/\s+/).indexOf("task-list-item") !== -1;
        }
        return hasClass ? current : null;
      }
      current = current.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function checklistLiHasConflict(li) {
  try {
    if (!li) {
      return false;
    }
    let hasPre = false;
    let hasPost = false;
    const stack = [];
    for (const child of li.childNodes || []) {
      stack.push(child);
    }
    let guard = 0;
    while (stack.length > 0 && guard < 10000) {
      guard += 1;
      const node = stack.pop();
      if (!node || typeof node !== "object") {
        continue;
      }
      if (node.nodeType === 1) {
        const tagName = String(node.tagName || node.nodeName || "").toUpperCase();
        if (tagName === "UL" || tagName === "OL" || tagName === "CODE" || tagName === "PRE") {
          continue;
        }
        let isTag = false;
        try {
          isTag = Boolean(
            node.classList &&
              typeof node.classList.contains === "function" &&
              node.classList.contains("tag"),
          );
        } catch (error) {
          isTag = false;
        }
        if (!isTag) {
          isTag = String(node.className || "").split(/\s+/).indexOf("tag") !== -1;
        }
        if (tagName === "A" && isTag) {
          const text = String(node.textContent || "").trim().toLowerCase();
          if (text === "#pre") {
            hasPre = true;
          } else if (text === "#post") {
            hasPost = true;
          }
          if (hasPre && hasPost) {
            return true;
          }
        }
      }
      for (const child of node.childNodes || []) {
        stack.push(child);
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Reading-view twin of `checklistTaskRunEnd`: the `#task` anchor is
// followed by the partner anchors in either order. Whitespace-only
// text nodes may separate them; any other intervening node rejects the
// run. Conflict detection reads the nearest task item's own tag text,
// skipping nested lists and code. Returns the partners as well as the
// kind so callers can hide them in place. Never throws.
function checklistTaskRunAnchors(taskAnchor) {
  try {
    if (!checklistAnchorIsTag(taskAnchor, TASK_TAG_MARK_TEXT)) {
      return null;
    }
    const first = checklistNextAnchorSibling(taskAnchor);
    const second = first ? checklistNextAnchorSibling(first) : null;
    if (!first || !second) {
      return null;
    }
    const firstText = String(first.textContent || "").trim().toLowerCase();
    const secondText = String(second.textContent || "").trim().toLowerCase();
    const pair = new Set([firstText, secondText]);
    if (!checklistAnchorIsTag(first, firstText) || !checklistAnchorIsTag(second, secondText)) {
      return null;
    }
    if (pair.size !== 2 || !pair.has("#gtd")) {
      return null;
    }
    const kind = pair.has("#pre") ? "pre" : pair.has("#post") ? "post" : null;
    if (!kind || checklistLiHasConflict(checklistNearestTaskItem(taskAnchor))) {
      return null;
    }
    return Object.freeze({ kind, anchors: Object.freeze([first, second]) });
  } catch (error) {
    return null;
  }
}

function checklistAddClass(el, className) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    if (el.classList && typeof el.classList.add === "function") {
      el.classList.add(className);
      return true;
    }
    if (typeof el.className === "string") {
      const parts = el.className.split(/\s+/).filter((part) => part !== "");
      if (parts.indexOf(className) === -1) {
        parts.push(className);
      }
      el.className = parts.join(" ");
      return true;
    }
    if (typeof el.setAttribute === "function") {
      const parts = String(el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      if (parts.indexOf(className) === -1) {
        parts.push(className);
      }
      el.setAttribute("class", parts.join(" "));
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Annotate the task hash as the PRE sunrise or POST flag and hide both
// partner anchors in place, retaining their text for copy, Dataview,
// and toggle restore. Never creates or removes nodes.
function annotateChecklistTaskMark(taskAnchor, run) {
  try {
    const kind = run && run.kind;
    if (!CHECKLIST_TASK_MARK_CLASSES[kind] || !annotateTaskTagMark(taskAnchor)) {
      return false;
    }
    if (!checklistAddClass(taskAnchor, CHECKLIST_TASK_MARK_CLASSES[kind])) {
      return false;
    }
    const label = CHECKLIST_TASK_MARK_LABELS[kind];
    const tooltip = CHECKLIST_TASK_MARK_TOOLTIPS[kind];
    try {
      if (typeof taskAnchor.setAttribute === "function") {
        taskAnchor.setAttribute("aria-label", label);
        taskAnchor.setAttribute("title", tooltip);
      } else {
        taskAnchor["aria-label"] = label;
        taskAnchor.title = tooltip;
      }
    } catch (error) {
      return false;
    }
    for (const partner of run.anchors || []) {
      checklistAddClass(partner, CHECKLIST_TASK_HIDDEN_CLASS);
    }
    return true;
  } catch (error) {
    return false;
  }
}

function checklistRemoveClass(el, className) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    if (el.classList && typeof el.classList.remove === "function") {
      el.classList.remove(className);
    } else if (typeof el.className === "string") {
      el.className = el.className
        .split(/\s+/)
        .filter((part) => part !== "" && part !== className)
        .join(" ");
    }
    return true;
  } catch (error) {
    return false;
  }
}

function stripChecklistTaskHidden(el) {
  return checklistRemoveClass(el, CHECKLIST_TASK_HIDDEN_CLASS);
}

// Live Preview widgets use the same listener-free host as task and ref
// marks. The constant kind key keeps decorations stable across rebuilds.
let ChecklistTaskMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  ChecklistTaskMarkWidget = class extends WidgetType {
    constructor(kind) {
      super();
      this.kind = kind === "post" ? "post" : "pre";
      this.key = this.kind + "-task-mark";
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof ChecklistTaskMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskTagMarkElement(
        typeof document !== "undefined" ? document : null,
        this.kind,
      );
      if (!dom) {
        return typeof document !== "undefined" && document
          ? document.createElement("span")
          : null;
      }
      addTaskTagMarkReveal(dom, view);
      return dom;
    }
  };
}
