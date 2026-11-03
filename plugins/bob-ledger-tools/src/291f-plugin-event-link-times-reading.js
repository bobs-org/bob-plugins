// --- Ledger Event link times: Reading view --------------------------------
// `BobLedgerToolsEventLinkTimesReadingMixin`, installed in
// `310-install-methods.js` after the Live Preview mixin and set up from
// `setupEventLinkTimes()`. A markdown post-processor records each rendered
// root and sweeps it; the sweep also visits every rendered daily note in
// every window (main and popouts). The host carries no listeners: the
// adjacent link stays the click target. Every method is synchronous and
// never throws.
class BobLedgerToolsEventLinkTimesReadingMixin {
  setupEventLinkTimesReading() {
    try {
      if (!(this.eventLinkTimeReadingViews instanceof Map)) {
        try {
          this.eventLinkTimeReadingViews = new Map();
        } catch (error) {
          this.eventLinkTimeReadingViews = null;
        }
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderEventLinkTimesIn(el, ctx),
          56,
        );
      }
    } catch (error) {
      // Reading-view wiring never blocks plugin startup.
    }
  }

  eventLinkTimeReadingTag(node) {
    try {
      return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
    } catch (error) {
      return "";
    }
  }

  eventLinkTimeReadingHasClass(node, name) {
    try {
      if (!node || !name) return false;
      if (node.classList && typeof node.classList.contains === "function") {
        return node.classList.contains(name);
      }
      const raw = typeof node.getAttribute === "function"
        ? node.getAttribute("class") || ""
        : typeof node.className === "string" ? node.className : "";
      return String(raw).split(/\s+/).includes(name);
    } catch (error) {
      return false;
    }
  }

  renderEventLinkTimesIn(el, ctx) {
    try {
      if (!el || !ctx) return;
      if (!(this.eventLinkTimeReadingViews instanceof Map)) {
        try {
          this.eventLinkTimeReadingViews = new Map();
        } catch (error) {
          return;
        }
      }
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const record = { el, ctx, sourcePath };
      this.eventLinkTimeReadingViews.set(el, record);
      this.sweepEventLinkTimesReadingView(record);
      try {
        if (typeof this.scheduleEventLinkTimesRefresh === "function") {
          this.scheduleEventLinkTimesRefresh();
        }
      } catch (error) {
        // A follow-up sweep covers a section that was still detaching.
      }
      if (typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            const views = this.eventLinkTimeReadingViews;
            child.onunload = () => {
              if (views) views.delete(el);
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          const views = this.eventLinkTimeReadingViews;
          child = {
            unload: () => {
              if (views) views.delete(el);
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

  // Every rendered Reading root with a daily-note path: the processor
  // records plus each Markdown leaf's preview container (popouts render
  // into their own document, mirroring `freesMarkPreviewRecords`).
  eventLinkTimePreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") return records;
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const sourcePath =
            view && view.file && typeof view.file.path === "string"
              ? view.file.path
              : "";
          if (!sourcePath) continue;
          const container =
            (view.previewMode && view.previewMode.containerEl) ||
            view.contentEl ||
            view.containerEl ||
            null;
          if (!container || typeof container.querySelector !== "function") continue;
          const root =
            container.querySelector(
              ".markdown-preview-view, .markdown-reading-view",
            ) || container;
          if (root) records.push({ el: root, ctx: { sourcePath }, sourcePath });
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return records;
    }
    return records;
  }

  refreshEventLinkTimesReadingViews() {
    try {
      let refreshed = false;
      if (this.eventLinkTimeReadingViews instanceof Map) {
        for (const [el, record] of Array.from(this.eventLinkTimeReadingViews.entries())) {
          try {
            if (!el) {
              this.eventLinkTimeReadingViews.delete(el);
              continue;
            }
            this.sweepEventLinkTimesReadingView(record);
            refreshed = true;
          } catch (error) {
            continue;
          }
        }
      }
      for (const record of this.eventLinkTimePreviewRecords()) {
        try {
          this.sweepEventLinkTimesReadingView(record);
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

  // The note lines behind one Reading sweep, in the contract's
  // Resolution order: the rendered section's source text, then the live
  // editor document, then the task theme source-text cache. When the last
  // one is empty, request a fill (the fill refreshes once it lands) and
  // report no lines, so no pill shows meanwhile. Never reads from disk
  // during render. Never throws.
  eventLinkTimeReadingLines(record) {
    try {
      const sourcePath = String((record && record.sourcePath) || "");
      if (sourcePath === "") return null;
      const ctx = (record && record.ctx) || null;
      try {
        if (ctx && typeof ctx.getSectionInfo === "function" && record.el) {
          const info = ctx.getSectionInfo(record.el);
          if (info && typeof info.text === "string" && info.text !== "") {
            const lines = String(info.text).replace(/\r\n/g, "\n").split("\n");
            if (typeof gcalEventsFindSection === "function" && gcalEventsFindSection(lines, "Events")) {
              return lines;
            }
          }
        }
      } catch (error) {
        // Section text is best-effort.
      }
      try {
        if (ctx && typeof this.calendarEventSourceLines === "function") {
          const live = this.calendarEventSourceLines(ctx);
          if (Array.isArray(live) && live.length > 0) return live;
        }
      } catch (error) {
        // Live editor lines are best-effort.
      }
      try {
        if (typeof this.taskThemeSourceTextFor === "function") {
          const cached = this.taskThemeSourceTextFor(sourcePath);
          if (typeof cached === "string" && cached !== "") {
            return String(cached).replace(/\r\n/g, "\n").split("\n");
          }
        }
      } catch (error) {
        // The source cache is best-effort.
      }
      try {
        if (typeof this.taskThemeRequestSourceText === "function") {
          this.taskThemeRequestSourceText(sourcePath);
        }
      } catch (error) {
        // A fill request is best-effort.
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  eventLinkTimeReadingOwnedHosts(li, root) {
    try {
      const found =
        li && typeof li.querySelectorAll === "function"
          ? li.querySelectorAll(".bob-event-link-time")
          : [];
      const hosts = [];
      for (const host of found || []) {
        try {
          let node = host.parentNode || null;
          let owner = null;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            if (this.eventLinkTimeReadingTag(node) === "LI") {
              owner = node;
              break;
            }
            node = node.parentNode || null;
          }
          if (owner === li) hosts.push(host);
        } catch (error) {
          continue;
        }
      }
      return hosts;
    } catch (error) {
      return [];
    }
  }

  eventLinkTimeRemoveHost(host) {
    try {
      if (host && host.parentNode && typeof host.parentNode.removeChild === "function") {
        host.parentNode.removeChild(host);
      }
    } catch (error) {
      // A stale Reading-view host is harmless.
    }
  }

  // Refresh one host in place from a fresh model: copy the attributes
  // and move the rebuilt children over, so the host keeps its position.
  // Never throws.
  eventLinkTimeRefreshHost(host, doc, model) {
    try {
      if (!host || !doc || !model) return false;
      const fresh = buildEventLinkTimeElement(doc, model);
      if (!fresh) return false;
      const names = ["class", "role", "aria-label", "data-tooltip-position", "data-block-id"];
      for (const name of names) {
        try {
          const value = typeof fresh.getAttribute === "function" ? fresh.getAttribute(name) : null;
          if (value == null) {
            if (typeof host.removeAttribute === "function") host.removeAttribute(name);
          } else if (typeof host.setAttribute === "function") {
            host.setAttribute(name, value);
          }
        } catch (error) {
          continue;
        }
      }
      try {
        if (typeof host.removeAttribute === "function") host.removeAttribute("title");
      } catch (error) {
        // A host without a title paints the same.
      }
      try {
        while (host.firstChild) host.removeChild(host.firstChild);
      } catch (error) {
        // Clearing is best-effort.
      }
      try {
        const children = fresh.childNodes ? Array.from(fresh.childNodes) : [];
        for (const child of children) host.appendChild(child);
      } catch (error) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // The link container: the anchor, or its `del`/`s` wrapper when the
  // anchor is that wrapper's only child. Never throws.
  eventLinkTimeReadingContainer(anchor) {
    try {
      if (!anchor) return null;
      const parent = anchor.parentNode || null;
      const tag = this.eventLinkTimeReadingTag(parent);
      if (["DEL", "S", "STRIKE"].includes(tag) && parent.childNodes) {
        const children = parent.childNodes;
        if (children.length === 1 && children[0] === anchor) return parent;
      }
      return anchor;
    } catch (error) {
      return anchor || null;
    }
  }

  // Insert the host before the link container, then bubble it left past
  // any contiguous run of ledger type / progress marks, so the row reads
  // `pill #TYPE ◐ link` no matter which processor ran first. Never
  // throws.
  eventLinkTimeReadingPlace(container, host) {
    try {
      if (!container || !host) return;
      const parent = container.parentNode || null;
      if (!parent || typeof parent.insertBefore !== "function") return;
      if (host.parentNode !== parent || host.nextSibling !== container) {
        parent.insertBefore(host, container);
      }
      let node = host.previousSibling || null;
      let guard = 0;
      while (node && guard < 100) {
        guard += 1;
        if (
          !this.eventLinkTimeReadingHasClass(node, "bob-ledger-type-mark") &&
          !this.eventLinkTimeReadingHasClass(node, "bob-progress-mark")
        ) {
          break;
        }
        const target = node;
        node = node.previousSibling || null;
        try {
          parent.insertBefore(host, target);
        } catch (error) {
          break;
        }
      }
    } catch (error) {
      // Placement never breaks the rendered view.
    }
  }

  sweepEventLinkTimesReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String((record && record.sourcePath) || "");
      if (!root || !sourcePath) return false;
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return false;
      const allHosts =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll(".bob-event-link-time"))
          : [];
      let daily = false;
      try {
        daily = typeof PLAN_DAILY_PATH_RE !== "undefined" && PLAN_DAILY_PATH_RE
          ? PLAN_DAILY_PATH_RE.test(sourcePath)
          : false;
      } catch (error) {
        daily = false;
      }
      if (!this.eventLinkTimesEnabled || !this.calendarEventsPaintEnabled || !daily) {
        for (const host of allHosts) this.eventLinkTimeRemoveHost(host);
        return true;
      }
      const lines = this.eventLinkTimeReadingLines(record);
      if (!lines) {
        for (const host of allHosts) this.eventLinkTimeRemoveHost(host);
        return true;
      }
      let rows = [];
      try {
        rows = eventRunEventRows(lines);
      } catch (error) {
        rows = [];
      }
      const byId = new Map();
      for (const row of rows || []) {
        try {
          if (!row || typeof row.blockId !== "string" || row.blockId === "") continue;
          if (byId.has(row.blockId)) byId.set(row.blockId, null);
          else byId.set(row.blockId, row);
        } catch (error) {
          continue;
        }
      }
      let isToday = false;
      try {
        isToday = isTodayDailyFile(this.app, { path: sourcePath });
      } catch (error) {
        isToday = false;
      }
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      let hue = null;
      try {
        hue = typeof this.calendarEventMeetHue === "function" ? this.calendarEventMeetHue() : null;
      } catch (error) {
        hue = null;
      }
      const resolved = new Map();
      const sameNote = (target) => {
        const key = String(target || "");
        if (resolved.has(key)) return resolved.get(key);
        let verdict = false;
        try {
          verdict = typeof this.eventLinkTimeIsSameNote === "function"
            ? this.eventLinkTimeIsSameNote(key, sourcePath) === true
            : key === "";
        } catch (error) {
          verdict = false;
        }
        resolved.set(key, verdict);
        return verdict;
      };
      const items =
        typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll("li"))
          : [];
      for (const li of items) {
        try {
          const existing = this.eventLinkTimeReadingOwnedHosts(li, root);
          let context = null;
          try {
            context = typeof this.progressMarkReadingContext === "function"
              ? this.progressMarkReadingContext(li, root, {
                includeStruck: true,
                includeClosedEntry: true,
                allowLedgerMarks: true,
              })
              : null;
          } catch (error) {
            context = null;
          }
          let model = null;
          if (context && sameNote(context.target)) {
            try {
              const eventRow = byId.get(context.blockId) || null;
              if (eventRow) {
                model = eventLinkTimeModel(eventRow, {
                  isToday,
                  nowMinutes,
                  hue,
                  line: lines[eventRow.lineIndex],
                  path: sourcePath,
                  metadataCache: this.app && this.app.metadataCache,
                  vault: this.app && this.app.vault,
                });
              }
            } catch (error) {
              model = null;
            }
          }
          if (!model) {
            for (const host of existing) this.eventLinkTimeRemoveHost(host);
            continue;
          }
          let host = existing[0] || null;
          if (host) {
            this.eventLinkTimeRefreshHost(host, doc, model);
          } else {
            try {
              host = buildEventLinkTimeElement(doc, model);
            } catch (error) {
              host = null;
            }
          }
          if (!host) continue;
          const container = this.eventLinkTimeReadingContainer(context.anchor);
          if (!container) {
            for (const stale of existing) this.eventLinkTimeRemoveHost(stale);
            continue;
          }
          this.eventLinkTimeReadingPlace(container, host);
          for (const duplicate of existing.slice(1)) this.eventLinkTimeRemoveHost(duplicate);
        } catch (error) {
          continue;
        }
      }
      // Remove orphaned hosts whose row is no longer inside a list item.
      for (const host of allHosts) {
        try {
          let node = host.parentNode || null;
          let inList = false;
          let guard = 0;
          while (node && node !== root && guard < 100) {
            guard += 1;
            if (this.eventLinkTimeReadingTag(node) === "LI") {
              inList = true;
              break;
            }
            node = node.parentNode || null;
          }
          if (!inList) this.eventLinkTimeRemoveHost(host);
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
