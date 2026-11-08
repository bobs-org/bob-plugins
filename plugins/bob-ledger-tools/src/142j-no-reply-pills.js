// --- No-reply pill: task-tag-marks family ----------------------------------
// Owned by bob-cli `docs/mail-link-marks.md` and the no-reply section of
// `docs/task-tag-marks.md`. Replaces `#awaiting_reply` on Ready overdue
// rows. Display-only. Every helper is synchronous and never throws.

const NO_REPLY_PILL_CLASS = "bob-no-reply-pill";

function noReplyPillScheduledDate(lineText) {
  try {
    if (typeof dateMarkCanonicalFields !== "function") return null;
    const fields = dateMarkCanonicalFields(lineText);
    const scheduled = fields.find((field) => field && field.field === "scheduled");
    return scheduled && scheduled.date ? String(scheduled.date) : null;
  } catch (error) {
    return null;
  }
}

function noReplyPillModel(lineText, ctx) {
  try {
    const context = ctx && typeof ctx === "object" ? ctx : {};
    try {
      if (typeof freshnessTaskStatus !== "function" || freshnessTaskStatus(lineText) !== " ") {
        return null;
      }
    } catch (error) {
      return null;
    }
    const source = typeof blockMarkAwaitingTagSource === "function"
      ? blockMarkAwaitingTagSource(lineText)
      : null;
    if (!source || typeof source.tagStart !== "number" || typeof source.tagEnd !== "number") {
      return null;
    }
    const scheduled = noReplyPillScheduledDate(lineText);
    const today = typeof parseFreshDateStrict === "function"
      ? parseFreshDateStrict(String(context.today || ""))
      : String(context.today || "");
    if (!scheduled || !today || scheduled > today) return null;
    const since = mailLinkMarkDateOf(context.turnSince);
    const label = since && typeof freshnessShortDate === "function"
      ? freshnessShortDate(since, today)
      : since;
    const text = label
      ? "\u2708 no reply since " + label
      : "\u2708 no reply yet";
    return Object.freeze({
      text,
      tooltip: text.replace(/::/g, ":"),
      from: source.tagStart,
      to: source.tagEnd,
    });
  } catch (error) {
    return null;
  }
}

function buildNoReplyPillElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.text) {
      return null;
    }
    const host = doc.createElement("span");
    host.setAttribute("class", NO_REPLY_PILL_CLASS);
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip || model.text));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-bob-no-reply", String(model.text));
    host.textContent = String(model.text);
    return host;
  } catch (error) {
    return null;
  }
}

function annotateNoReplyPill(el, model) {
  try {
    if (!el || typeof el !== "object" || !model || !model.text) return false;
    try {
      if (el.classList && typeof el.classList.add === "function") {
        el.classList.add(NO_REPLY_PILL_CLASS);
      } else if (typeof el.className === "string") {
        const parts = el.className.split(/\s+/).filter((part) => part !== "");
        if (parts.indexOf(NO_REPLY_PILL_CLASS) === -1) parts.push(NO_REPLY_PILL_CLASS);
        el.className = parts.join(" ");
      } else if (typeof el.setAttribute === "function") {
        el.setAttribute("class", NO_REPLY_PILL_CLASS);
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
    try {
      if (typeof el.setAttribute === "function") {
        el.setAttribute("aria-label", String(model.tooltip || model.text));
        el.setAttribute("data-tooltip-position", "top");
        el.setAttribute("data-bob-no-reply", String(model.text));
      }
    } catch (error) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function stripNoReplyPill(el) {
  try {
    if (!el || typeof el !== "object") return false;
    let changed = false;
    try {
      if (el.classList && typeof el.classList.remove === "function") {
        if (el.classList.contains(NO_REPLY_PILL_CLASS)) {
          el.classList.remove(NO_REPLY_PILL_CLASS);
          changed = true;
        }
      } else if (typeof el.className === "string") {
        const parts = el.className.split(/\s+/).filter((part) => part && part !== NO_REPLY_PILL_CLASS);
        if (parts.join(" ") !== el.className) {
          el.className = parts.join(" ");
          changed = true;
        }
      }
    } catch (error) {
      // Class strip is best-effort.
    }
    try {
      if (typeof el.removeAttribute === "function") {
        el.removeAttribute("data-bob-no-reply");
        el.removeAttribute("aria-label");
        el.removeAttribute("data-tooltip-position");
        changed = true;
      }
    } catch (error) {
      // Attribute strip is best-effort.
    }
    return changed;
  } catch (error) {
    return false;
  }
}

function isNoReplyTagAnchor(node) {
  try {
    if (!node || typeof node !== "object") return false;
    const tag = String(node.tagName || node.nodeName || "").toUpperCase();
    if (tag !== "A") return false;
    let text = "";
    try {
      text = typeof node.textContent === "string" ? node.textContent : "";
    } catch (error) {
      text = "";
    }
    if (text !== "#awaiting_reply") return false;
    try {
      if (typeof node.getAttribute === "function") {
        const href = node.getAttribute("href");
        if (href !== null && href !== undefined && href !== "" && String(href) !== "#awaiting_reply") {
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

let NoReplyPillWidget = null;
if (typeof WidgetType === "function") {
  NoReplyPillWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model && typeof model === "object" ? { ...model } : {};
      this.key = String(this.model.text || "");
    }

    eq(other) {
      return Boolean(other && other instanceof NoReplyPillWidget && other.key === this.key);
    }

    toDOM(view) {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildNoReplyPillElement(doc, this.model);
      if (!dom) {
        try {
          return doc && typeof doc.createElement === "function" ? doc.createElement("span") : null;
        } catch (error) {
          return null;
        }
      }
      if (typeof addTaskTagMarkReveal === "function") {
        try {
          addTaskTagMarkReveal(dom, view);
        } catch (error) {
          // Reveal is best-effort.
        }
      }
      return dom;
    }
  };
}
