// --- Mail link marks: Reading view sweeps ----------------------------------
class BobLedgerToolsMailLinkMarksReadingMixin {
  setupMailLinkMarksReading() {
    try {
      if (!(this.mailLinkMarksReadingViews instanceof Map)) this.mailLinkMarksReadingViews = new Map();
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderMailLinkMarksIn(el, ctx), 62);
      }
    } catch (error) {
      // Reading-view setup is best-effort.
    }
  }

  renderMailLinkMarksIn(el, ctx) {
    try {
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!el || !sourcePath) return;
      if (!(this.mailLinkMarksReadingViews instanceof Map)) this.mailLinkMarksReadingViews = new Map();
      const record = { el, sourcePath, ctx };
      this.mailLinkMarksReadingViews.set(el, record);
      this.sweepMailLinkMarksReadingView(record);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => this.mailLinkMarksReadingViews && this.mailLinkMarksReadingViews.delete(el);
          }
        } catch (error) {
          child = null;
        }
        if (!child) child = { unload: () => this.mailLinkMarksReadingViews && this.mailLinkMarksReadingViews.delete(el) };
        try { ctx.addChild(child); } catch (error) { /* Optional cleanup hook. */ }
      }
    } catch (error) {
      // A Reading-view badge failure never affects Markdown rendering.
    }
  }

  removeMailReplyBadgeHost(host) {
    try {
      if (host && host.parentNode && typeof host.parentNode.removeChild === "function") {
        host.parentNode.removeChild(host);
      }
    } catch (error) {
      // A stale host is harmless.
    }
  }

  mailLinkMarkReadingAnchors(li) {
    try {
      const found = li && typeof li.querySelectorAll === "function"
        ? li.querySelectorAll("a.internal-link")
        : [];
      const anchors = [];
      for (const node of found || []) {
        let owner = node;
        let guard = 0;
        let mine = false;
        while (owner && guard++ < 40) {
          if (owner === li) { mine = true; break; }
          owner = owner.parentNode || null;
        }
        if (mine) anchors.push(node);
      }
      return anchors;
    } catch (error) {
      return [];
    }
  }

  mailLinkMarkReadingOwnedHosts(li) {
    try {
      const found = li && typeof li.querySelectorAll === "function"
        ? li.querySelectorAll("." + MAIL_REPLY_BADGE_CLASS)
        : [];
      const hosts = [];
      for (const host of found || []) {
        let owner = host;
        let guard = 0;
        while (owner && guard++ < 40) {
          if (owner === li) { hosts.push(host); break; }
          owner = owner.parentNode || null;
        }
      }
      return hosts;
    } catch (error) {
      return [];
    }
  }

  sweepMailLinkMarksReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String(record && record.sourcePath || "");
      if (!root || !sourcePath) return false;
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return false;
      const allHosts = typeof root.querySelectorAll === "function"
        ? Array.from(root.querySelectorAll("." + MAIL_REPLY_BADGE_CLASS))
        : [];
      if (!this.mailLinkMarksEnabled) {
        for (const host of allHosts) this.removeMailReplyBadgeHost(host);
        return true;
      }
      let today = null;
      try { today = this.dateMarksToday(); } catch (error) { today = null; }
      const now = new Date();
      const items = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("li.task-list-item")) : [];
      const seen = new Set();
      for (const li of items) {
        try {
          const existing = this.mailLinkMarkReadingOwnedHosts(li);
          const info = record.ctx && typeof record.ctx.getSectionInfo === "function"
            ? record.ctx.getSectionInfo(li) || record.ctx.getSectionInfo(root)
            : null;
          let lineText = info && typeof info.text === "string" ? info.text : "";
          if (!lineText && typeof li.textContent === "string") lineText = "- [ ] " + li.textContent;
          const facts = this.mailNoteFacts(lineText, sourcePath);
          const model = mailReplyBadgeModel(lineText, facts, today, now);
          if (!model) {
            for (const host of existing) this.removeMailReplyBadgeHost(host);
            continue;
          }
          const anchors = this.mailLinkMarkReadingAnchors(li);
          const anchor = anchors[0];
          if (!anchor) {
            for (const host of existing) this.removeMailReplyBadgeHost(host);
            continue;
          }
          let host = existing[0] || buildMailReplyBadgeElement(doc, model);
          if (!host) continue;
          host.setAttribute("aria-label", model.tooltip);
          host.textContent = model.text;
          const parent = anchor.parentNode;
          if (parent && typeof parent.insertBefore === "function" && host.previousSibling !== anchor) {
            parent.insertBefore(host, anchor.nextSibling || null);
          }
          seen.add(host);
          for (let index = 1; index < existing.length; index += 1) this.removeMailReplyBadgeHost(existing[index]);
        } catch (error) {
          continue;
        }
      }
      for (const host of allHosts) {
        if (!seen.has(host)) this.removeMailReplyBadgeHost(host);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  refreshMailLinkMarksReadingViews() {
    try {
      if (!(this.mailLinkMarksReadingViews instanceof Map)) return false;
      for (const [el, record] of Array.from(this.mailLinkMarksReadingViews.entries())) {
        if (!el) { this.mailLinkMarksReadingViews.delete(el); continue; }
        this.sweepMailLinkMarksReadingView(record);
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
