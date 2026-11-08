// --- Mail link marks: reply badge pure core --------------------------------
// Owned by bob-cli `docs/mail-link-marks.md`. Display-only: reads mail
// note frontmatter through the metadata cache and never writes. Every
// helper is synchronous and never throws.

const MAIL_REPLY_BADGE_SIDE = 1;
const MAIL_REPLY_BADGE_CLASS = "bob-mail-reply-badge";

function mailLinkMarkTokens(lineText) {
  try {
    const text = String(lineText || "");
    if (text.indexOf("[[") === -1) return Object.freeze([]);
    const visible = typeof blockMarkMaskInlineCode === "function"
      ? blockMarkMaskInlineCode(text)
      : text;
    const tokens = [];
    const matcher = /\[\[([^\[\]|#^\r\n]+)(?:[#^][^\[\]|\r\n]*)?(?:\|[^\[\]\r\n]*)?\]\]/g;
    let match = matcher.exec(visible);
    while (match !== null) {
      try {
        const start = match.index;
        const end = start + match[0].length;
        if (start > 0 && text[start - 1] === "!") {
          match = matcher.exec(visible);
          continue;
        }
        let pathPart = String(match[1] || "").trim();
        if (/\.md$/i.test(pathPart)) pathPart = pathPart.slice(0, -3);
        if (pathPart) {
          tokens.push(Object.freeze({ start, end, pathPart }));
        }
      } catch (error) {
        // One bad token never breaks the scan.
      }
      match = matcher.exec(visible);
    }
    return Object.freeze(tokens);
  } catch (error) {
    return Object.freeze([]);
  }
}

function mailLinkMarkDateOf(value) {
  try {
    const text = String(value || "").trim();
    if (text.length < 10) return null;
    return typeof parseFreshDateStrict === "function"
      ? parseFreshDateStrict(text.slice(0, 10))
      : /^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10))
        ? text.slice(0, 10)
        : null;
  } catch (error) {
    return null;
  }
}

function mailLinkMarkAge(turnSince, now) {
  try {
    const then = Date.parse(String(turnSince || "").replace(" ", "T"));
    if (!Number.isFinite(then)) return "";
    const stamp = now instanceof Date ? now.getTime() : Date.now();
    if (!Number.isFinite(stamp)) return "";
    const minutes = Math.max(0, Math.round((stamp - then) / 60000));
    if (minutes < 1) return "now";
    if (minutes < 60) return String(minutes) + "m";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return String(hours) + "h";
    const days = Math.round(hours / 24);
    return String(days) + "d";
  } catch (error) {
    return "";
  }
}

function mailLinkMarkFreshFacts(lineText, today) {
  try {
    if (typeof readFreshness !== "function") {
      return Object.freeze({ fresh: null, unblocked: null });
    }
    const facts = readFreshness(lineText, today);
    return Object.freeze({
      fresh: facts && facts.fresh ? String(facts.fresh) : null,
      unblocked: facts && facts.unblocked ? String(facts.unblocked) : null,
    });
  } catch (error) {
    return Object.freeze({ fresh: null, unblocked: null });
  }
}

function mailReplyBadgeShouldShow(lineText, mail, today) {
  try {
    if (!mail || mail.turn !== "yours") return false;
    try {
      if (typeof freshnessTaskStatus === "function" && freshnessTaskStatus(lineText) === null) {
        return false;
      }
    } catch (error) {
      return false;
    }
    const dates = mailLinkMarkFreshFacts(lineText, today);
    if (!dates.fresh) return true;
    const since = mailLinkMarkDateOf(mail.turnSince);
    if (!since) return false;
    if (since > dates.fresh) return true;
    if (since === dates.fresh) {
      const todayDate = typeof parseFreshDateStrict === "function"
        ? parseFreshDateStrict(String(today || ""))
        : String(today || "");
      return Boolean(todayDate && dates.unblocked === todayDate);
    }
    return false;
  } catch (error) {
    return false;
  }
}

function mailReplyBadgeText(who, age) {
  try {
    const name = typeof blockMarkAwaitingWho === "function"
      ? blockMarkAwaitingWho(who)
      : String(who || "").trim();
    const elapsed = String(age || "").trim();
    if (name && elapsed) return "\u21a9 " + name + " \u00b7 " + elapsed;
    if (name) return "\u21a9 " + name;
    if (elapsed) return "\u21a9 " + elapsed;
    return "\u21a9";
  } catch (error) {
    return "\u21a9";
  }
}

function mailReplyBadgeModel(lineText, mail, today, now) {
  try {
    if (!mailReplyBadgeShouldShow(lineText, mail, today)) return null;
    const who = mail && typeof mail.who === "string" ? mail.who : "";
    const age = mailLinkMarkAge(mail && mail.turnSince, now);
    const text = mailReplyBadgeText(who, age);
    const name = typeof blockMarkAwaitingWho === "function"
      ? blockMarkAwaitingWho(who)
      : String(who || "").trim();
    const tooltip = name ? name + " replied" + (age ? " \u00b7 " + age : "") : text;
    return Object.freeze({
      text,
      tooltip: tooltip.replace(/::/g, ":"),
      who: name,
      age,
    });
  } catch (error) {
    return null;
  }
}

function mailNoteFactsFromFrontmatter(frontmatter) {
  try {
    if (typeof blockMarkIsMailFrontmatter !== "function") return null;
    if (!blockMarkIsMailFrontmatter(frontmatter)) return null;
    const who = typeof frontmatter.who === "string" ? frontmatter.who : "";
    const turn = typeof frontmatter.turn === "string" ? frontmatter.turn.trim() : "";
    const turnSince = typeof frontmatter.turn_since === "string"
      ? frontmatter.turn_since
      : typeof frontmatter.turnSince === "string"
        ? frontmatter.turnSince
        : "";
    return Object.freeze({ who, turn, turnSince });
  } catch (error) {
    return null;
  }
}

function buildMailReplyBadgeElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.text) {
      return null;
    }
    const host = doc.createElement("span");
    host.setAttribute("class", MAIL_REPLY_BADGE_CLASS);
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip || model.text));
    host.setAttribute("data-tooltip-position", "top");
    host.textContent = String(model.text);
    return host;
  } catch (error) {
    return null;
  }
}

let MailReplyBadgeWidget = null;
if (typeof WidgetType === "function") {
  MailReplyBadgeWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model && typeof model === "object" ? { ...model } : {};
      this.key = String(this.model.text || "") + "\u0000" + String(this.model.tooltip || "");
    }

    eq(other) {
      return Boolean(other && other instanceof MailReplyBadgeWidget && other.key === this.key);
    }

    toDOM() {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildMailReplyBadgeElement(doc, this.model);
      if (dom) return dom;
      try {
        return doc && typeof doc.createElement === "function" ? doc.createElement("span") : null;
      } catch (error) {
        return null;
      }
    }
  };
}
