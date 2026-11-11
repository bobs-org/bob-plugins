// --- Off-clock Task Link chips: Reading view sweeps -----------------------
// Reconciles display-only chip hosts against the current note text and clock
// facts. It records roots from every window and also discovers open leaves.
class BobLedgerToolsOffClockLinkChipsReadingMixin {
  setupOffClockLinkChipsReading() {
    try {
      if (!(this.offClockLinkChipsReadingViews instanceof Map)) this.offClockLinkChipsReadingViews = new Map();
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderOffClockLinkChipsIn(el, ctx), 61);
      }
    } catch (error) {
      // Reading-view setup is best-effort.
    }
  }

  renderOffClockLinkChipsIn(el, ctx) {
    try {
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!el || !sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) return;
      if (!(this.offClockLinkChipsReadingViews instanceof Map)) this.offClockLinkChipsReadingViews = new Map();
      const record = { el, sourcePath };
      this.offClockLinkChipsReadingViews.set(el, record);
      this.sweepOffClockLinkChipsReadingView(record);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => this.offClockLinkChipsReadingViews && this.offClockLinkChipsReadingViews.delete(el);
          }
        } catch (error) { child = null; }
        if (!child) child = { unload: () => this.offClockLinkChipsReadingViews && this.offClockLinkChipsReadingViews.delete(el) };
        try { ctx.addChild(child); } catch (error) { /* Optional cleanup hook. */ }
      }
    } catch (error) {
      // A Reading-view chip failure never affects Markdown rendering.
    }
  }

  offClockLinkChipPreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function" ? workspace.getLeavesOfType("markdown") || [] : [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view;
          const sourcePath = view && view.file && typeof view.file.path === "string" ? view.file.path : "";
          if (!sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) continue;
          const container = (view.previewMode && view.previewMode.containerEl) || view.contentEl || view.containerEl || null;
          if (!container || typeof container.querySelector !== "function") continue;
          const root = container.querySelector(".markdown-preview-view, .markdown-reading-view") || container;
          if (root) records.push({ el: root, sourcePath });
        } catch (error) { continue; }
      }
    } catch (error) {
      return records;
    }
    return records;
  }

  refreshOffClockLinkChipsReadingViews() {
    try {
      let refreshed = false;
      if (this.offClockLinkChipsReadingViews instanceof Map) {
        for (const [el, record] of Array.from(this.offClockLinkChipsReadingViews.entries())) {
          if (!el) { this.offClockLinkChipsReadingViews.delete(el); continue; }
          this.sweepOffClockLinkChipsReadingView(record);
          refreshed = true;
        }
      }
      for (const record of this.offClockLinkChipPreviewRecords()) {
        this.sweepOffClockLinkChipsReadingView(record);
        refreshed = true;
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }

  offClockLinkChipReadingOwnedHosts(li, root) {
    try {
      const found = li && typeof li.querySelectorAll === "function" ? li.querySelectorAll(".bob-off-clock-link-chip") : [];
      const hosts = [];
      for (const host of found || []) {
        let node = host && host.parentNode;
        let owner = null;
        let guard = 0;
        while (node && node !== root && guard++ < 100) {
          if (String(node.tagName || node.nodeName || "").toUpperCase() === "LI") { owner = node; break; }
          node = node.parentNode || null;
        }
        if (owner === li) hosts.push(host);
      }
      return hosts;
    } catch (error) {
      return [];
    }
  }

  removeOffClockLinkChipHost(host) {
    try {
      if (host && host.parentNode && typeof host.parentNode.removeChild === "function") host.parentNode.removeChild(host);
    } catch (error) {
      // A stale read-time host is harmless.
    }
  }

  paintOffClockLinkChipHost(host, model) {
    try {
      if (!host || !model || !model.tooltip) return false;
      host.setAttribute("class", "bob-off-clock-link-chip");
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", model.tooltip);
      host.setAttribute("data-tooltip-position", "top");
      host.setAttribute("data-clock-source", model.source);
      host.setAttribute("data-block-id", model.blockId || "");
      if (typeof host.removeAttribute === "function") host.removeAttribute("title");
      host.textContent = "off";
      return true;
    } catch (error) {
      return false;
    }
  }

  offClockLinkChipReadingInsertAfter(anchor) {
    try {
      if (!anchor) return null;
      let after = anchor;
      const wrapper = anchor.parentNode || null;
      const wrapperTag = String(wrapper && (wrapper.tagName || wrapper.nodeName) || "").toUpperCase();
      const children = wrapper && wrapper.childNodes || [];
      if (["DEL", "S", "STRIKE"].includes(wrapperTag) && children.length === 1 && children[0] === anchor) after = wrapper;
      const markClasses = new Set(["bob-unblocked-glyph", "bob-frees-mark", "bob-keep-moving-mark"]);
      let next = after.nextSibling || null;
      let guard = 0;
      while (next && guard++ < 20) {
        const names = String(next.className || (next.getAttribute && next.getAttribute("class")) || "").split(/\s+/);
        if (names.includes("bob-off-clock-link-chip")) { next = next.nextSibling || null; continue; }
        if (!names.some((name) => markClasses.has(name))) break;
        after = next;
        next = after.nextSibling || null;
      }
      return after;
    } catch (error) {
      return anchor || null;
    }
  }

  sweepOffClockLinkChipsReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String(record && record.sourcePath || "");
      if (!root || !sourcePath) return false;
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return false;
      const allHosts = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll(".bob-off-clock-link-chip")) : [];
      const removeAll = () => { for (const host of allHosts) this.removeOffClockLinkChipHost(host); };
      if (!this.offClockLinkChipsEnabled || !PLAN_DAILY_PATH_RE.test(sourcePath)) { removeAll(); return true; }
      let content = null;
      try { content = this.taskThemeSourceTextFor(sourcePath); } catch (error) { content = null; }
      if (typeof content !== "string") {
        try { this.taskThemeRequestSourceText(sourcePath); } catch (error) { /* cache fill is best-effort */ }
        removeAll();
        return true;
      }
      const lines = content.split(/\r?\n/);
      const memo = new Map();
      const seenHosts = new Set();
      const items = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("li")) : [];
      for (const li of items) {
        try {
          const existing = this.offClockLinkChipReadingOwnedHosts(li, root);
          let context = null;
          try {
            context = this.progressMarkReadingContext(li, root, {
              includeStruck: true,
              includeClosedEntry: true,
              allowLedgerMarks: true,
            });
          } catch (error) { context = null; }
          let model = null;
          if (context && context.blockId) {
            const link = { pathPart: String(context.target || ""), blockId: String(context.blockId), token: "" };
            model = this.offClockLinkChipFactModel(lines, link, sourcePath, memo);
          }
          if (!model) {
            for (const host of existing) this.removeOffClockLinkChipHost(host);
            continue;
          }
          let host = existing[0] || buildOffClockLinkChipElement(doc, model);
          if (!host) continue;
          if (existing.length) this.paintOffClockLinkChipHost(host, model);
          const after = this.offClockLinkChipReadingInsertAfter(context.anchor);
          const parent = after && after.parentNode;
          if (parent && typeof parent.insertBefore === "function" && (host.parentNode !== parent || host.previousSibling !== after)) {
            parent.insertBefore(host, after.nextSibling || null);
          }
          seenHosts.add(host);
          for (const duplicate of existing.slice(1)) this.removeOffClockLinkChipHost(duplicate);
        } catch (error) { continue; }
      }
      for (const host of allHosts) if (!seenHosts.has(host)) this.removeOffClockLinkChipHost(host);
      return true;
    } catch (error) {
      return false;
    }
  }
}
