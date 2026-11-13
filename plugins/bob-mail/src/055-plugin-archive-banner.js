// Bob Mail archived-banner wiring: Reading-view enhancement, Live Preview
// decoration, shared receipt snapshot cache, and the explicit-undo action.
//
// Display-only until the banner button is pressed: neither host writes the
// vault or spawns a process while rendering. One coalesced offline
// `bob gmail list -a -f json` snapshot feeds tooltips; the button runs one
// `bob gmail unarchive -- <note> -f json` call and reloads the authoritative
// state afterward, even when Bob reports the local repair is still pending.

let MailArchiveViewPlugin = null;
let MailArchiveDecoration = null;
let MailArchiveWidgetType = null;
try {
  const archiveViewMod = require("@codemirror/view");
  MailArchiveViewPlugin = archiveViewMod.ViewPlugin || null;
  MailArchiveDecoration = archiveViewMod.Decoration || null;
  MailArchiveWidgetType = archiveViewMod.WidgetType || null;
} catch (error) {
  MailArchiveViewPlugin = null;
  MailArchiveDecoration = null;
  MailArchiveWidgetType = null;
}
let MailArchiveStateEffect = null;
let MailArchiveRangeSetBuilder = null;
let MailArchivePrec = null;
try {
  const archiveStateMod = require("@codemirror/state");
  MailArchiveStateEffect = archiveStateMod.StateEffect || null;
  MailArchiveRangeSetBuilder = archiveStateMod.RangeSetBuilder || null;
  MailArchivePrec = archiveStateMod.Prec || null;
} catch (error) {
  MailArchiveStateEffect = null;
  MailArchiveRangeSetBuilder = null;
  MailArchivePrec = null;
}
let mailArchiveEditorInfoField = null;
let mailArchiveEditorLivePreviewField = null;
try {
  const archiveObsidianMod = require("obsidian");
  mailArchiveEditorInfoField = archiveObsidianMod.editorInfoField || null;
  mailArchiveEditorLivePreviewField = archiveObsidianMod.editorLivePreviewField || null;
} catch (error) {
  mailArchiveEditorInfoField = null;
  mailArchiveEditorLivePreviewField = null;
}

let mailArchiveRefreshEffect = null;
function ensureMailArchiveRefreshEffect() {
  if (mailArchiveRefreshEffect) return mailArchiveRefreshEffect;
  try {
    if (MailArchiveStateEffect && typeof MailArchiveStateEffect.define === "function") {
      mailArchiveRefreshEffect = MailArchiveStateEffect.define();
    }
  } catch (error) {
    mailArchiveRefreshEffect = null;
  }
  return mailArchiveRefreshEffect;
}

function mailArchiveRequireObsidian() {
  try {
    if (typeof require === "function") return require("obsidian");
    return null;
  } catch (error) {
    return null;
  }
}

function mailArchiveRemoveNode(node) {
  try {
    if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
      node.parentNode.removeChild(node);
    }
  } catch (error) {
    // A stale host is harmless.
  }
}

function mailArchiveSetButtonState(button, pending) {
  try {
    if (!button) return;
    if (pending === true) {
      if (typeof button.setAttribute === "function") {
        button.setAttribute("disabled", "true");
        button.setAttribute("aria-disabled", "true");
      }
      try {
        button.disabled = true;
      } catch (error) {
        // Attribute state already carries the pending bit.
      }
    } else {
      if (typeof button.removeAttribute === "function") {
        button.removeAttribute("disabled");
        button.removeAttribute("aria-disabled");
      }
      try {
        button.disabled = false;
      } catch (error) {
        // Attribute state already carries the pending bit.
      }
    }
  } catch (error) {
    // Button state is best effort.
  }
}

let MailArchiveBannerWidget = null;
if (typeof MailArchiveWidgetType === "function") {
  MailArchiveBannerWidget = class extends MailArchiveWidgetType {
    constructor(model) {
      super();
      const safe = model && typeof model === "object" ? model : {};
      this.model = { ...safe };
      this.key = [
        String(safe.notePath || ""),
        String(safe.date || ""),
        String(safe.tooltip || ""),
        safe.pending === true ? "pending" : "idle",
      ].join("");
    }

    eq(other) {
      return Boolean(other && other instanceof MailArchiveBannerWidget && other.key === this.key);
    }

    toDOM() {
      const doc = typeof document !== "undefined" ? document : null;
      try {
        const dom = buildMailArchiveBannerElement(doc, this.model);
        if (dom) return dom;
        return doc && typeof doc.createElement === "function" ? doc.createElement("span") : null;
      } catch (error) {
        return null;
      }
    }
  };
}

// Shared cache API for Ledger Tools and tests: coalesced offline snapshot,
// plain-JSON per-note state, and the same explicit undo the banner runs.
function mailArchiveApiFor(plugin) {
  try {
    return Object.freeze({
      version: MAIL_ARCHIVE_API_VERSION,
      refresh: () => plugin.mailArchiveRefreshReceipts("api"),
      onChange: (listener) => {
        try {
          if (typeof listener !== "function") return () => false;
          if (!(plugin.mailArchiveChangeListeners instanceof Set)) plugin.mailArchiveChangeListeners = new Set();
          plugin.mailArchiveChangeListeners.add(listener);
          return () => plugin.mailArchiveChangeListeners.delete(listener);
        } catch (error) {
          return () => false;
        }
      },
      stateForNote: (notePath) => {
        try {
          const state = mailArchiveStateForNote(plugin.mailArchiveCache, notePath);
          return {
            kind: state.kind,
            status: state.status,
            receipts: Array.isArray(state.receipts)
              ? state.receipts.map((entry) => ({
                archive_event_id: entry.archive_event_id,
                archived_at: entry.archived_at,
                message_count: entry.message_count,
                label: { name: entry.label.name, id: entry.label.id },
              }))
              : undefined,
          };
        } catch (error) {
          return { kind: "unavailable", status: "unavailable", receipts: undefined };
        }
      },
      unarchiveNote: (notePath) => plugin.mailArchiveUnarchiveFromBanner(notePath),
    });
  } catch (error) {
    return null;
  }
}

Object.assign(BobMailPlugin.prototype, {
  setupMailArchiveBanner() {
    try {
      if (!this.mailArchiveCache || typeof this.mailArchiveCache !== "object") {
        this.mailArchiveCache = mailArchiveCreateCache();
      }
      if (!(this.mailArchivePending instanceof Set)) this.mailArchivePending = new Set();
      if (!(this.mailArchiveReadingViews instanceof Map)) this.mailArchiveReadingViews = new Map();
      if (!(this.mailArchiveChangeListeners instanceof Set)) this.mailArchiveChangeListeners = new Set();
      this.mailArchiveSnapshotTimer = null;
      this.mailArchiveSnapshotExplicit = false;
      this.mailArchiveDisplayTimer = null;
      try {
        const exposed = mailArchiveApiFor(this);
        if (exposed) this.api = Object.freeze({ ...(this.api || {}), mailArchive: exposed });
      } catch (error) {
        // The shared cache API is best effort next to mailOpen.
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderMailArchiveBannerIn(el, ctx),
          MAIL_ARCHIVE_POSTPROCESSOR_ORDER,
        );
      }
      if (typeof this.registerEditorExtension === "function") {
        try {
          const extension = this.createMailArchiveLiveExtension();
          if (extension) this.registerEditorExtension(extension);
        } catch (error) {
          // Live Preview is best effort.
        }
      }
      const canRegister = typeof this.registerEvent === "function";
      try {
        const metadataCache = this.app && this.app.metadataCache;
        if (canRegister && metadataCache && typeof metadataCache.on === "function") {
          this.registerEvent(metadataCache.on("changed", () => this.mailArchiveScheduleSnapshotRefresh("metadata")));
          this.registerEvent(metadataCache.on("resolved", () => this.mailArchiveScheduleSnapshotRefresh("metadata")));
        }
      } catch (error) {
        // Liveness listeners are best effort.
      }
      try {
        const vault = this.app && this.app.vault;
        if (canRegister && vault && typeof vault.on === "function") {
          const journalish = (file) => {
            try {
              const path = typeof file === "string" ? file : (file && file.path) || "";
              return path.startsWith("mail/") || path.indexOf(".bob/gmail") !== -1;
            } catch (error) {
              return false;
            }
          };
          this.registerEvent(vault.on("modify", (file) => {
            if (journalish(file)) this.mailArchiveScheduleSnapshotRefresh("journal");
          }));
          this.registerEvent(vault.on("delete", (file) => {
            if (journalish(file)) this.mailArchiveScheduleSnapshotRefresh("journal");
          }));
        }
      } catch (error) {
        // Journal listeners are best effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (canRegister && workspace && typeof workspace.on === "function") {
          this.registerEvent(workspace.on("active-leaf-change", () => {
            try {
              const view = mailActiveMarkdownView(this.app);
              const context = view ? mailCurrentNote(this.app, view) : null;
              if (context) this.mailArchiveScheduleSnapshotRefresh("activation");
              else this.mailArchiveScheduleDisplayRefresh();
            } catch (error) {
              // Activation refresh is best effort.
            }
          }));
          this.registerEvent(workspace.on("layout-change", () => this.mailArchiveScheduleDisplayRefresh()));
        }
      } catch (error) {
        // Workspace listeners are best effort.
      }
      if (typeof this.register === "function") {
        try {
          this.register(() => this.teardownMailArchiveBanner());
        } catch (error) {
          // Cleanup registration is best effort.
        }
      }
    } catch (error) {
      // Display-only setup never blocks plugin startup.
    }
  },

  teardownMailArchiveBanner() {
    try {
      if (this.mailArchiveSnapshotTimer !== null && this.mailArchiveSnapshotTimer !== undefined) {
        try {
          clearTimeout(this.mailArchiveSnapshotTimer);
        } catch (error) {
          // The timer already settled.
        }
      }
      this.mailArchiveSnapshotTimer = null;
    } catch (error) {
      // Cleanup is best effort.
    }
    try {
      if (this.mailArchiveDisplayTimer !== null && this.mailArchiveDisplayTimer !== undefined) {
        try {
          clearTimeout(this.mailArchiveDisplayTimer);
        } catch (error) {
          // The timer already settled.
        }
      }
      this.mailArchiveDisplayTimer = null;
    } catch (error) {
      // Cleanup is best effort.
    }
    try {
      if (this.mailArchiveReadingViews instanceof Map) {
        for (const record of this.mailArchiveReadingViews.values()) {
          try {
            if (record && record.el) this.mailArchiveRemoveBannerHosts(record.el);
          } catch (error) {
            continue;
          }
        }
        this.mailArchiveReadingViews.clear();
      }
    } catch (error) {
      // Cleanup is best effort.
    }
    try {
      if (this.mailArchivePending instanceof Set) this.mailArchivePending.clear();
    } catch (error) {
      // Cleanup is best effort.
    }
    try {
      if (this.mailArchiveChangeListeners instanceof Set) this.mailArchiveChangeListeners.clear();
    } catch (error) {
      // Cleanup is best effort.
    }
  },

  mailArchiveFileForPath(sourcePath) {
    try {
      const path = String(sourcePath || "");
      if (!path) return null;
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
      return vault.getAbstractFileByPath(path);
    } catch (error) {
      return null;
    }
  },

  mailArchiveRefreshReceipts(reason) {
    try {
      if (!this.mailArchiveCache || typeof this.mailArchiveCache !== "object") {
        this.mailArchiveCache = mailArchiveCreateCache();
      }
      const plugin = this;
      return mailArchiveRefreshCache(this.mailArchiveCache, () => plugin.mailCall([...MAIL_ARCHIVE_LIST_ARGS]))
        .then((cache) => {
          plugin.mailArchiveNotifyChanged();
          try {
            plugin.mailArchiveRefreshLiveEditors();
          } catch (error) {
            // Display refresh is best effort.
          }
          return plugin.mailArchiveRefreshReadingViews().then(() => cache).catch(() => cache);
        })
        .catch(() => this.mailArchiveCache);
    } catch (error) {
      return Promise.resolve(this.mailArchiveCache || null);
    }
  },

  mailArchiveNotifyChanged() {
    try {
      if (!(this.mailArchiveChangeListeners instanceof Set)) return false;
      for (const listener of Array.from(this.mailArchiveChangeListeners)) {
        try { listener(); } catch (error) { continue; }
      }
      return true;
    } catch (error) {
      return false;
    }
  },

  mailArchiveScheduleSnapshotRefresh(reason) {
    try {
      const explicit = reason === "undo" || reason === "activation" || reason === "api";
      if (!explicit) {
        const cache = this.mailArchiveCache;
        if (cache && cache.status === "ready" && Date.now() - (cache.updatedAt || 0) < 60000) {
          this.mailArchiveScheduleDisplayRefresh();
          return;
        }
      }
      if (this.mailArchiveSnapshotTimer !== null && this.mailArchiveSnapshotTimer !== undefined) {
        if (explicit) this.mailArchiveSnapshotExplicit = true;
        return;
      }
      if (explicit) this.mailArchiveSnapshotExplicit = true;
      const delay = this.mailArchiveSnapshotExplicit ? 0 : 800;
      const schedule = typeof window !== "undefined" && window.setTimeout
        ? window.setTimeout.bind(window)
        : setTimeout;
      this.mailArchiveSnapshotTimer = schedule(() => {
        this.mailArchiveSnapshotTimer = null;
        this.mailArchiveSnapshotExplicit = false;
        void this.mailArchiveRefreshReceipts(reason);
      }, delay);
    } catch (error) {
      // Scheduling is best effort.
    }
  },

  mailArchiveScheduleDisplayRefresh() {
    try {
      if (this.mailArchiveDisplayTimer !== null && this.mailArchiveDisplayTimer !== undefined) return;
      const schedule = typeof window !== "undefined" && window.setTimeout
        ? window.setTimeout.bind(window)
        : setTimeout;
      this.mailArchiveDisplayTimer = schedule(() => {
        this.mailArchiveDisplayTimer = null;
        try {
          this.mailArchiveRefreshLiveEditors();
        } catch (error) {
          // Display refresh is best effort.
        }
        void this.mailArchiveRefreshReadingViews();
      }, 120);
    } catch (error) {
      // Scheduling is best effort.
    }
  },

  mailArchiveRefreshLiveEditors() {
    try {
      const refresh = ensureMailArchiveRefreshEffect();
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (cm && typeof cm.dispatch === "function" && refresh) cm.dispatch({ effects: refresh.of(null) });
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best effort.
    }
  },

  mailArchiveRefreshReadingViews() {
    try {
      const views = this.mailArchiveReadingViews;
      if (!(views instanceof Map)) return Promise.resolve(false);
      const jobs = [];
      for (const record of views.values()) {
        try {
          jobs.push(this.sweepMailArchiveReadingView(record));
        } catch (error) {
          continue;
        }
      }
      return Promise.all(jobs).then(() => true).catch(() => false);
    } catch (error) {
      return Promise.resolve(false);
    }
  },

  renderMailArchiveBannerIn(el, ctx) {
    try {
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!el || !sourcePath) return;
      if (!(this.mailArchiveReadingViews instanceof Map)) this.mailArchiveReadingViews = new Map();
      const record = { el, sourcePath, ctx, sweepId: 0 };
      this.mailArchiveReadingViews.set(el, record);
      void this.sweepMailArchiveReadingView(record);
      if (ctx && typeof ctx.addChild === "function") {
        let child = null;
        try {
          const obsidian = mailArchiveRequireObsidian();
          if (obsidian && typeof obsidian.MarkdownRenderChild === "function") {
            const plugin = this;
            child = new obsidian.MarkdownRenderChild(el);
            child.onunload = () => {
              if (plugin.mailArchiveReadingViews) plugin.mailArchiveReadingViews.delete(el);
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          const plugin = this;
          child = {
            unload: () => {
              if (plugin.mailArchiveReadingViews) plugin.mailArchiveReadingViews.delete(el);
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Optional cleanup hook.
        }
      }
    } catch (error) {
      // A Reading-view failure never affects Markdown rendering.
    }
  },

  mailArchiveRemoveBannerHosts(root) {
    try {
      if (!root || typeof root.querySelectorAll !== "function") return;
      const hosts = Array.from(root.querySelectorAll(`.${MAIL_ARCHIVE_HOST_CLASS}`));
      for (const host of hosts) mailArchiveRemoveNode(host);
    } catch (error) {
      // Cleanup is best effort.
    }
  },

  mailArchiveRemoveNode(node) {
    mailArchiveRemoveNode(node);
  },

  async sweepMailArchiveReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String((record && record.sourcePath) || "");
      if (!root || !sourcePath) return false;
      record.sweepId = (record.sweepId || 0) + 1;
      const token = record.sweepId;
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      let isMail = false;
      let trusted = [];
      try {
        const file = this.mailArchiveFileForPath(sourcePath);
        const frontmatter = file ? mailFrontmatter(this.app, file) : null;
        isMail = mailIsMailNote(frontmatter);
        const vault = this.app && this.app.vault;
        if (isMail && file && vault && typeof vault.cachedRead === "function") {
          const markdown = await vault.cachedRead(file);
          if (!record || record.sweepId !== token) return false;
          if (typeof markdown === "string") trusted = mailArchiveTrustedBannerDates(markdown.split("\n"));
        }
      } catch (error) {
        isMail = false;
        trusted = [];
      }
      if (!record || record.sweepId !== token) return false;
      if (!doc || !isMail) {
        this.mailArchiveRemoveBannerHosts(root);
        return true;
      }
      if (this.mailArchiveCache && this.mailArchiveCache.status === "unloaded") {
        void this.mailArchiveRefreshReceipts("reading-view").catch(() => null);
      }
      const remaining = new Map();
      for (const span of trusted) remaining.set(span.date, (remaining.get(span.date) || 0) + 1);
      let banners = [];
      try {
        banners = typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll("blockquote"))
          : [];
      } catch (error) {
        banners = [];
      }
      const pending = this.mailArchivePending instanceof Set ? this.mailArchivePending : new Set();
      const seen = new Set();
      for (const banner of banners) {
        try {
          if (!record || record.sweepId !== token) return false;
          const text = typeof banner.textContent === "string" ? banner.textContent : "";
          const date = mailArchiveBannerDate(text);
          let owned = [];
          try {
            owned = typeof banner.querySelectorAll === "function"
              ? Array.from(banner.querySelectorAll(`.${MAIL_ARCHIVE_HOST_CLASS}`))
              : [];
          } catch (error) {
            owned = [];
          }
          const host = owned[0] || null;
          for (let index = 1; index < owned.length; index += 1) mailArchiveRemoveNode(owned[index]);
          if (!date || (remaining.get(date) || 0) <= 0) {
            if (host) mailArchiveRemoveNode(host);
            continue;
          }
          remaining.set(date, remaining.get(date) - 1);
          const state = mailArchiveStateForNote(this.mailArchiveCache, sourcePath);
          const tooltip = mailArchiveTooltipFor(date, state);
          const isPending = pending.has(sourcePath);
          if (!host) {
            const plugin = this;
            const element = buildMailArchiveBannerElement(doc, {
              label: MAIL_ARCHIVE_UNDO_LABEL,
              tooltip,
              pending: isPending,
              onClick: () => {
                void plugin.mailArchiveUnarchiveFromBanner(sourcePath);
              },
            });
            if (element && typeof banner.appendChild === "function") banner.appendChild(element);
            if (element) seen.add(element);
          } else {
            try {
              const button = typeof host.querySelector === "function"
                ? host.querySelector("button")
                : (host.firstChild || null);
              if (button) {
                if (typeof button.setAttribute === "function") button.setAttribute("aria-label", tooltip);
                mailArchiveSetButtonState(button, isPending);
              }
            } catch (error) {
              // Host refresh is best effort.
            }
            seen.add(host);
          }
        } catch (error) {
          continue;
        }
      }
      try {
        const all = typeof root.querySelectorAll === "function"
          ? Array.from(root.querySelectorAll(`.${MAIL_ARCHIVE_HOST_CLASS}`))
          : [];
        for (const host of all) {
          if (!seen.has(host)) mailArchiveRemoveNode(host);
        }
      } catch (error) {
        // Stale cleanup is best effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  },

  mailArchiveLiveAvailable() {
    try {
      return Boolean(
        MailArchiveViewPlugin && MailArchiveDecoration && MailArchiveWidgetType &&
        MailArchiveStateEffect && typeof MailArchiveStateEffect.define === "function" &&
        MailArchiveRangeSetBuilder && mailArchiveEditorInfoField &&
        mailArchiveEditorLivePreviewField && MailArchiveBannerWidget && MailArchivePrec,
      );
    } catch (error) {
      return false;
    }
  },

  createMailArchiveLiveExtension() {
    try {
      if (!this.mailArchiveLiveAvailable() ||
        !MailArchiveViewPlugin ||
        typeof MailArchiveViewPlugin.fromClass !== "function" ||
        !MailArchivePrec ||
        typeof MailArchivePrec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const BannerPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildMailArchiveLiveDecorations(view);
          } catch (error) {
            this.decorations = MailArchiveDecoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.mailArchiveLiveShouldRebuild(update)) {
              this.decorations = plugin.buildMailArchiveLiveDecorations(update.view);
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return MailArchivePrec.highest(
        MailArchiveViewPlugin.fromClass(BannerPluginClass, { decorations: (value) => value.decorations }),
      );
    } catch (error) {
      return null;
    }
  },

  mailArchiveLiveShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged) return true;
      const refresh = ensureMailArchiveRefreshEffect();
      for (const transaction of update.transactions || []) {
        for (const effect of (transaction && transaction.effects)
          ? (Array.isArray(transaction.effects) ? transaction.effects : [transaction.effects])
          : []) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) {
            return true;
          }
        }
      }
      if (mailArchiveEditorLivePreviewField && update.startState && update.state &&
        update.startState.field(mailArchiveEditorLivePreviewField) !==
        update.state.field(mailArchiveEditorLivePreviewField)) {
        return true;
      }
      if (mailArchiveEditorInfoField && update.startState && update.state) {
        const before = update.startState.field(mailArchiveEditorInfoField);
        const after = update.state.field(mailArchiveEditorInfoField);
        if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  },

  mailArchiveLiveDocLines(doc) {
    try {
      if (doc && typeof doc.toString === "function") return String(doc.toString()).split("\n");
      if (doc && typeof doc.lineAt === "function" && Number.isInteger(doc.lines)) {
        const lines = [];
        for (let number = 1; number <= doc.lines; number += 1) {
          try {
            lines.push(String(doc.line(number).text));
          } catch (error) {
            lines.push("");
          }
        }
        return lines;
      }
      return null;
    } catch (error) {
      return null;
    }
  },

  buildMailArchiveLiveDecorations(view) {
    try {
      if (!this.mailArchiveLiveAvailable() || !MailArchiveDecoration || !MailArchiveRangeSetBuilder) {
        return MailArchiveDecoration ? MailArchiveDecoration.none : null;
      }
      if (!mailArchiveEditorInfoField || !mailArchiveEditorLivePreviewField) {
        return MailArchiveDecoration.none;
      }
      if (!view || !view.state || !view.state.field(mailArchiveEditorLivePreviewField)) {
        return MailArchiveDecoration.none;
      }
      const info = view.state.field(mailArchiveEditorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath) return MailArchiveDecoration.none;
      const file = this.mailArchiveFileForPath(sourcePath);
      const frontmatter = file ? mailFrontmatter(this.app, file) : null;
      if (!mailIsMailNote(frontmatter)) return MailArchiveDecoration.none;
      const doc = view.state.doc;
      if (!doc) return MailArchiveDecoration.none;
      const lines = this.mailArchiveLiveDocLines(doc);
      if (!lines) return MailArchiveDecoration.none;
      const trusted = mailArchiveTrustedBannerDates(lines);
      if (trusted.length === 0) return MailArchiveDecoration.none;
      if (this.mailArchiveCache && this.mailArchiveCache.status === "unloaded") {
        void this.mailArchiveRefreshReceipts("live-view").catch(() => null);
      }
      const state = mailArchiveStateForNote(this.mailArchiveCache, sourcePath);
      const pending = this.mailArchivePending instanceof Set && this.mailArchivePending.has(sourcePath);
      const ranges = view.visibleRanges || [];
      const inView = (from, to) => {
        try {
          for (const range of ranges) {
            if (typeof range.from !== "number" || typeof range.to !== "number") continue;
            if (from <= range.to && to >= range.from) return true;
          }
          return ranges.length === 0;
        } catch (error) {
          return true;
        }
      };
      const plugin = this;
      const builder = new MailArchiveRangeSetBuilder();
      for (const span of trusted) {
        try {
          if (typeof doc.line !== "function") continue;
          const line = doc.line(span.line + 1);
          if (!line || typeof line.text !== "string") continue;
          if (!inView(line.from, line.to)) continue;
          const tooltip = mailArchiveTooltipFor(span.date, state);
          builder.add(line.to, line.to, MailArchiveDecoration.widget({
            widget: new MailArchiveBannerWidget({
              notePath: sourcePath,
              date: span.date,
              label: MAIL_ARCHIVE_UNDO_LABEL,
              tooltip,
              pending,
              onClick: () => {
                void plugin.mailArchiveUnarchiveFromBanner(sourcePath);
              },
            }),
            side: 1,
          }));
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return MailArchiveDecoration.none;
      } catch (inner) {
        return null;
      }
    }
  },

  async mailArchiveUnarchiveFromBanner(notePath) {
    try {
      const target = String(notePath || "");
      if (!target) return false;
      if (!(this.mailArchivePending instanceof Set)) this.mailArchivePending = new Set();
      if (this.mailArchivePending.has(target)) return false;
      this.mailArchivePending.add(target);
      this.mailArchiveScheduleDisplayRefresh();
      let result = null;
      try {
        result = await this.mailCall(mailArchiveUnarchiveArgs(target));
      } catch (error) {
        result = { ok: false, oldBob: false, error: "Bob Mail command failed" };
      }
      let outcome = { kind: "unknown", note: target };
      try {
        if (result && result.document) outcome = mailArchiveUndoOutcome(result.document, target);
      } catch (error) {
        outcome = { kind: "unknown", note: target };
      }
      if (result && result.oldBob) {
        this.mailReportError(result);
      } else if (outcome.kind === "restored") {
        try {
          new Notice(mailArchiveUndoNotice(outcome));
        } catch (error) {
          // The report already carries the outcome.
        }
      } else if (outcome.kind === "would_restore" || outcome.kind === "unchanged") {
        try {
          new Notice(mailArchiveUndoNotice(outcome));
        } catch (error) {
          // The report already carries the outcome.
        }
      } else if (outcome.kind === "failed") {
        const hint = outcome.hint ? `\n${outcome.hint}` : "";
        this.mailReportError({ ok: false, oldBob: false, error: `${outcome.message || "unarchive failed"}${hint}` });
      } else if (!result || !result.ok) {
        this.mailReportError(result || { ok: false, oldBob: false, error: "Bob Mail command failed" });
      } else {
        try {
          new Notice(mailArchiveUndoNotice(outcome));
        } catch (error) {
          // The report already carries the outcome.
        }
      }
      try {
        await this.mailArchiveRefreshReceipts("undo");
      } catch (error) {
        // The snapshot refresh is best effort after an explicit undo.
      }
      this.mailArchivePending.delete(target);
      this.mailArchiveScheduleDisplayRefresh();
      return outcome.kind === "restored";
    } catch (error) {
      try {
        if (this.mailArchivePending instanceof Set) this.mailArchivePending.delete(String(notePath || ""));
      } catch (cleanupError) {
        // Pending bookkeeping is best effort.
      }
      return false;
    }
  },
});
