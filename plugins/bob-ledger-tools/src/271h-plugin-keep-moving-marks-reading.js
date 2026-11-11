// --- Keep-moving marks: Reading view sweeps -------------------------------
// Reconciles display-only `⏭ N` hosts against the current note text and the
// same pure count the Live Preview mixin uses. It records roots from every
// window and also discovers open leaves. The host stays listener-free like
// 🔑's, so Reading-view re-renders never drop it.
class BobLedgerToolsKeepMovingMarksReadingMixin {
  setupKeepMovingMarksReading() {
    try {
      if (!(this.keepMovingMarksReadingViews instanceof Map)) {
        this.keepMovingMarksReadingViews = new Map();
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderKeepMovingMarksIn(el, ctx), 63);
      }
    } catch (error) {
      // Reading-view setup is best-effort.
    }
  }

  renderKeepMovingMarksIn(el, ctx) {
    try {
      if (!el || !ctx || typeof ctx.sourcePath !== "string") {
        return;
      }
      if (!(this.keepMovingMarksReadingViews instanceof Map)) {
        this.keepMovingMarksReadingViews = new Map();
      }
      const record = { el, ctx, sourcePath: ctx.sourcePath };
      this.keepMovingMarksReadingViews.set(el, record);
      this.sweepKeepMovingMarksReadingView(record);
      try {
        this.scheduleKeepMovingMarksRefresh();
      } catch (error) {
        // A follow-up sweep covers a section that was still detaching.
      }
      if (typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            child.onunload = () => {
              if (this.keepMovingMarksReadingViews) {
                this.keepMovingMarksReadingViews.delete(el);
              }
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          child = {
            unload: () => {
              if (this.keepMovingMarksReadingViews) {
                this.keepMovingMarksReadingViews.delete(el);
              }
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject processor children.
        }
      }
    } catch (error) {
      // Reading-view marks never throw.
    }
  }

  keepMovingMarkPreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return records;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const sourcePath =
            view && view.file && typeof view.file.path === "string"
              ? view.file.path
              : "";
          if (!sourcePath) {
            continue;
          }
          const container =
            (view.previewMode && view.previewMode.containerEl) ||
            view.contentEl ||
            view.containerEl ||
            null;
          if (!container || typeof container.querySelector !== "function") {
            continue;
          }
          const root =
            container.querySelector(
              ".markdown-preview-view, .markdown-reading-view",
            ) || container;
          if (root) {
            records.push({ el: root, sourcePath });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return records;
    }
    return records;
  }

  refreshKeepMovingMarksReadingViews() {
    try {
      let refreshed = false;
      if (this.keepMovingMarksReadingViews instanceof Map) {
        for (const [el, record] of Array.from(this.keepMovingMarksReadingViews.entries())) {
          try {
            if (!el) {
              this.keepMovingMarksReadingViews.delete(el);
              continue;
            }
            this.sweepKeepMovingMarksReadingView(record);
            refreshed = true;
          } catch (error) {
            continue;
          }
        }
      }
      for (const record of this.keepMovingMarkPreviewRecords()) {
        try {
          this.sweepKeepMovingMarksReadingView(record);
          refreshed = true;
        } catch (error) {
          continue;
        }
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }

  keepMovingMarkReadingOwnedHosts(li, root) {
    try {
      const found =
        li && typeof li.querySelectorAll === "function"
          ? li.querySelectorAll(".bob-keep-moving-mark")
          : [];
      const hosts = [];
      for (const host of found || []) {
        try {
          let node = host.parentNode || null;
          let owner = null;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            const tag = String(node.tagName || node.nodeName || "").toUpperCase();
            if (tag === "LI") {
              owner = node;
              break;
            }
            node = node.parentNode || null;
          }
          if (owner === li) {
            hosts.push(host);
          }
        } catch (error) {
          continue;
        }
      }
      return hosts;
    } catch (error) {
      return [];
    }
  }

  removeKeepMovingMarkHost(host) {
    try {
      if (host && host.parentNode && typeof host.parentNode.removeChild === "function") {
        host.parentNode.removeChild(host);
      }
    } catch (error) {
      // A stale Reading-view host is harmless.
    }
  }

  paintKeepMovingMarkHost(host, doc, model) {
    try {
      if (!host || !doc || !model) {
        return false;
      }
      host.setAttribute("class", "bob-keep-moving-mark");
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", keepMovingMarkTooltip(model));
      host.setAttribute("data-tooltip-position", "top");
      host.setAttribute("data-count", String(model.count));
      host.setAttribute("data-block-id", String(model.blockId || ""));
      host.setAttribute("data-project", String(model.projectPath || ""));
      if (typeof host.removeAttribute === "function") {
        host.removeAttribute("title");
      }
      host.textContent = "";
      const glyph = doc.createElement("span");
      glyph.setAttribute("class", "bob-keep-moving-mark-glyph");
      glyph.setAttribute("aria-hidden", "true");
      host.appendChild(glyph);
      if (typeof doc.createTextNode === "function") {
        host.appendChild(doc.createTextNode(String(model.count)));
      } else {
        const count = doc.createElement("span");
        count.textContent = String(model.count);
        host.appendChild(count);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // KP3/KP4: after the last of the link's trailing unblocked glyph, mail
  // reply badge, and 🔑 siblings; always before the off-clock chip, which
  // stays last. With none of those, right after the link (or its sole
  // strike-through wrapper).
  keepMovingMarkReadingInsertAfter(anchor) {
    try {
      if (!anchor) {
        return null;
      }
      let after = anchor;
      const wrapper = anchor.parentNode || null;
      const wrapperTag = String(wrapper && (wrapper.tagName || wrapper.nodeName) || "").toUpperCase();
      const wrapperChildren = wrapper && wrapper.childNodes ? wrapper.childNodes : [];
      if (
        ["DEL", "S", "STRIKE"].includes(wrapperTag) &&
        wrapperChildren.length === 1 &&
        wrapperChildren[0] === anchor
      ) {
        after = wrapper;
      }
      const beforeClasses = new Set(["bob-unblocked-glyph", "bob-mail-reply-badge", "bob-frees-mark"]);
      let next = after.nextSibling || null;
      let guard = 0;
      while (next && guard < 20) {
        guard += 1;
        let names = [];
        try {
          names = String(
            (next.className !== undefined ? next.className : null) ??
              (next.getAttribute ? next.getAttribute("class") : "") ?? "",
          ).split(/\s+/).filter(Boolean);
        } catch (error) {
          names = [];
        }
        if (names.includes("bob-off-clock-link-chip")) {
          break;
        }
        if (names.includes("bob-keep-moving-mark")) {
          after = next;
          next = after.nextSibling || null;
          continue;
        }
        if (!names.some((name) => beforeClasses.has(name))) {
          break;
        }
        after = next;
        next = after.nextSibling || null;
      }
      return after;
    } catch (error) {
      return anchor || null;
    }
  }

  sweepKeepMovingMarksReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String((record && record.sourcePath) || "");
      if (!root || !sourcePath) {
        return false;
      }
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) {
        return false;
      }
      const allHosts =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll(".bob-keep-moving-mark"))
          : [];
      const removeAll = () => {
        for (const host of allHosts) {
          this.removeKeepMovingMarkHost(host);
        }
      };
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (
        this.keepMovingMarksEnabled === false ||
        !dailyPath ||
        !sameVaultPath(sourcePath, dailyPath)
      ) {
        removeAll();
        return true;
      }
      const memo = this.freshnessEnsureMemo();
      if (!memo || !Array.isArray(memo.tasks) || memo.tasks.length === 0) {
        removeAll();
        return true;
      }
      let content = null;
      try {
        content = this.taskThemeSourceTextFor(sourcePath);
      } catch (error) {
        content = null;
      }
      if (typeof content !== "string") {
        try {
          this.taskThemeRequestSourceText(sourcePath);
        } catch (error) {
          // The fill fan-out refreshes once the text lands.
        }
        removeAll();
        return true;
      }
      const ctx = this.keepMovingMarkPluginContext(content);
      ctx.memo = memo;
      ctx.dailyPath = dailyPath;
      const today = this.keepMovingMarkTodayString(memo);
      ctx.today = today;
      const index = unblockedGlyphIndex(memo.tasks);
      const resolutions = new Map();
      const counts = new Map();
      const items =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll("li"))
          : [];
      const seenHosts = new Set();
      for (const li of items) {
        try {
          const existing = this.keepMovingMarkReadingOwnedHosts(li, root);
          let context = null;
          try {
            context = this.progressMarkReadingContext(li, root, {
              allowLedgerMarks: true,
            });
          } catch (error) {
            context = null;
          }
          let model = null;
          if (context && context.target && context.blockId) {
            const targetKey = String(context.target || "") + "\u0000" + String(context.blockId || "");
            let linked;
            if (resolutions.has(targetKey)) {
              linked = resolutions.get(targetKey);
            } else {
              linked = freesMarkLinkedTask(
                index,
                context.target,
                context.blockId,
                sourcePath,
              );
              resolutions.set(targetKey, linked || null);
            }
            if (linked && keepMovingMarkTaskIsOpen(linked)) {
              const path = keepMovingMarkPath(planTaskPath(linked));
              const blockId = String(planTaskBlockId(linked) || "");
              const ownerKey = path && blockId ? path + "\u0000" + blockId : targetKey;
              let count;
              if (counts.has(ownerKey)) {
                count = counts.get(ownerKey);
              } else {
                count = keepMovingMarkCount(linked, { path }, ctx);
                counts.set(ownerKey, count || null);
              }
              if (count && count.state === "positive" && count.count >= 1) {
                model = {
                  ...count,
                  blockId: context.blockId,
                  ownerPath: path,
                  ownerBlockId: blockId,
                  ownerKey,
                  target: context.target,
                  linktext:
                    (String(context.target || "") ? String(context.target) : "") +
                    "#^" +
                    String(context.blockId || ""),
                  dailyPath,
                };
              }
            }
          }
          if (!model) {
            for (const host of existing) {
              this.removeKeepMovingMarkHost(host);
            }
            continue;
          }
          let host = existing[0] || null;
          if (!host) {
            host = buildKeepMovingMarkElement(doc, model);
          } else {
            this.paintKeepMovingMarkHost(host, doc, model);
          }
          if (!host) {
            continue;
          }
          const after = this.keepMovingMarkReadingInsertAfter(context.anchor);
          const parent = after && after.parentNode;
          if (parent && typeof parent.insertBefore === "function") {
            if (host.parentNode !== parent || host.previousSibling !== after) {
              parent.insertBefore(host, after.nextSibling || null);
            }
          }
          seenHosts.add(host);
          for (const duplicate of existing.slice(1)) {
            this.removeKeepMovingMarkHost(duplicate);
          }
        } catch (error) {
          continue;
        }
      }
      // Remove orphaned hosts whose row is no longer inside a list item.
      for (const host of allHosts) {
        try {
          if (seenHosts.has(host)) {
            continue;
          }
          let node = host.parentNode || null;
          let inList = false;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            if (String(node.tagName || node.nodeName || "").toUpperCase() === "LI") {
              inList = true;
              break;
            }
            node = node.parentNode || null;
          }
          if (!inList) {
            this.removeKeepMovingMarkHost(host);
          }
        } catch (error) {
          continue;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
