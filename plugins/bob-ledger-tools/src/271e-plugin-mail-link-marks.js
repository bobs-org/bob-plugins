// --- Mail link marks: Live Preview, toggle, and mail-note lookup -----------
// Display-only reply badge after a task's mail wikilink. Owned by
// bob-cli `docs/mail-link-marks.md`.

let mailLinkMarksRefreshEffect = null;
function ensureMailLinkMarksRefresh() {
  if (mailLinkMarksRefreshEffect) return mailLinkMarksRefreshEffect;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      mailLinkMarksRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    mailLinkMarksRefreshEffect = null;
  }
  return mailLinkMarksRefreshEffect;
}

class BobLedgerToolsMailLinkMarksMixin {
  setupMailLinkMarks() {
    try {
      if (typeof this.mailLinkMarksEnabled !== "boolean") this.mailLinkMarksEnabled = true;
      if (!(this.mailLinkMarksReadingViews instanceof Map)) this.mailLinkMarksReadingViews = new Map();
      this.applyMarkGateClass("bob-mail-link-marks", this.mailLinkMarksEnabled);
      this.registerMarkGatePopoutSync("bob-mail-link-marks", () => this.mailLinkMarksEnabled);
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-mail-link-marks",
            name: "Toggle mail reply badges",
            callback: () => this.toggleMailLinkMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createMailLinkMarksExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.setupMailLinkMarksReading === "function") this.setupMailLinkMarksReading();
      } catch (error) {
        // Reading view is best-effort.
      }
      this.setupMailLinkMarkListeners();
      if (typeof this.register === "function") this.register(() => this.teardownMailLinkMarks());
    } catch (error) {
      // Display-only setup never blocks plugin startup.
    }
  }

  mailNoteFacts(lineText, sourcePath) {
    try {
      const empty = Object.freeze({ who: "", turn: "", turnSince: "" });
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function" ||
        typeof metadataCache.getFileCache !== "function"
      ) {
        return empty;
      }
      const tokens = mailLinkMarkTokens(lineText);
      for (const token of tokens) {
        try {
          const file = token && token.pathPart
            ? metadataCache.getFirstLinkpathDest(token.pathPart, String(sourcePath || ""))
            : null;
          const cache = file ? metadataCache.getFileCache(file) : null;
          const facts = mailNoteFactsFromFrontmatter(cache && cache.frontmatter);
          if (facts) return facts;
        } catch (error) {
          continue;
        }
      }
      return empty;
    } catch (error) {
      return Object.freeze({ who: "", turn: "", turnSince: "" });
    }
  }

  setupMailLinkMarkListeners() {
    try {
      if (typeof this.registerEvent !== "function") return;
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", () => this.scheduleMailLinkMarksRefresh()));
        this.registerEvent(metadataCache.on("resolved", () => this.scheduleMailLinkMarksRefresh()));
      }
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(workspace.on("layout-change", () => this.scheduleMailLinkMarksRefresh()));
      }
    } catch (error) {
      // Liveness listeners are best-effort.
    }
  }

  mailLinkMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin && Decoration && WidgetType && StateEffect &&
        typeof StateEffect.define === "function" && RangeSetBuilder &&
        editorInfoField && editorLivePreviewField && MailReplyBadgeWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createMailLinkMarksExtension() {
    try {
      if (!this.mailLinkMarksAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const BadgePluginClass = class {
        constructor(view) {
          try { this.decorations = plugin.buildMailLinkMarkDecorations(view); }
          catch (error) { this.decorations = Decoration.none; }
        }
        update(update) {
          try {
            if (plugin.mailLinkMarksShouldRebuild(update)) {
              this.decorations = plugin.buildMailLinkMarkDecorations(update.view);
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(BadgePluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  mailLinkMarksShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged) return true;
      const refresh = ensureMailLinkMarksRefresh();
      for (const transaction of update.transactions || []) {
        for (const effect of (transaction && transaction.effects)
          ? (Array.isArray(transaction.effects) ? transaction.effects : [transaction.effects]) : []) {
          if (effect === refresh || (refresh && effect && typeof effect.is === "function" && effect.is(refresh))) return true;
        }
      }
      if (editorLivePreviewField && update.startState && update.state &&
        update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return true;
      if (editorInfoField && update.startState && update.state) {
        const before = update.startState.field(editorInfoField);
        const after = update.state.field(editorInfoField);
        if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildMailLinkMarkDecorations(view) {
    try {
      if (!this.mailLinkMarksEnabled || !Decoration || !RangeSetBuilder || !MailReplyBadgeWidget) {
        return Decoration.none;
      }
      if (!editorInfoField || !editorLivePreviewField) return Decoration.none;
      if (!view || !view.state || !view.state.field(editorLivePreviewField)) return Decoration.none;
      const info = view.state.field(editorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      let today = null;
      try { today = this.dateMarksToday(); } catch (error) { today = null; }
      const now = new Date();
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) tree = syntaxTree(view.state);
      } catch (error) {
        tree = null;
      }
      const ranges = view.visibleRanges || [];
      const builder = new RangeSetBuilder();
      const docLength = typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      for (const range of ranges) {
        try {
          if (!range || typeof range.from !== "number") continue;
          let pos = Math.max(0, range.from);
          const end = Math.min(typeof range.to === "number" ? range.to : docLength, docLength);
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            let line = null;
            try { line = doc.lineAt(pos); } catch (error) { break; }
            if (!line || typeof line.text !== "string") break;
            try {
              if (line.text.indexOf("[[") !== -1 && line.text.indexOf("#task") !== -1) {
                const tokens = mailLinkMarkTokens(line.text);
                const facts = tokens.length ? this.mailNoteFacts(line.text, sourcePath) : null;
                const model = facts ? mailReplyBadgeModel(line.text, facts, today, now) : null;
                if (model) {
                  for (const token of tokens) {
                    try {
                      const abs = line.from + token.end;
                      let inCode = false;
                      try {
                        if (tree && typeof freshnessMarkPosInCode === "function") {
                          inCode = freshnessMarkPosInCode(tree, line.from + token.start + 1);
                        }
                      } catch (error) {
                        inCode = false;
                      }
                      if (inCode) continue;
                      builder.add(abs, abs, Decoration.widget({
                        widget: new MailReplyBadgeWidget(model),
                        side: MAIL_REPLY_BADGE_SIDE,
                      }));
                      break;
                    } catch (error) {
                      continue;
                    }
                  }
                }
              }
            } catch (error) {
              // One bad line never breaks the build.
            }
            if (typeof line.to !== "number" || line.to >= end) break;
            if (line.to < pos) break;
            pos = line.to + 1;
          }
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  toggleMailLinkMarks() {
    try {
      this.mailLinkMarksEnabled = !this.mailLinkMarksEnabled;
      this.applyMarkGateClass("bob-mail-link-marks", this.mailLinkMarksEnabled);
      this.refreshMailLinkMarksEditors();
      if (typeof this.refreshMailLinkMarksReadingViews === "function") {
        this.refreshMailLinkMarksReadingViews();
      }
      try {
        new Notice(this.mailLinkMarksEnabled ? "Mail reply badges on" : "Mail reply badges off");
      } catch (error) {}
      return this.mailLinkMarksEnabled;
    } catch (error) {
      return Boolean(this.mailLinkMarksEnabled);
    }
  }

  refreshMailLinkMarksEditors() {
    try {
      const refresh = ensureMailLinkMarksRefresh();
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
      // Editor refresh is best-effort.
    }
  }

  scheduleMailLinkMarksRefresh() {
    try {
      if (this.mailLinkMarksTimer !== null && this.mailLinkMarksTimer !== undefined) return;
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : setTimeout;
      this.mailLinkMarksTimer = schedule(() => {
        this.mailLinkMarksTimer = null;
        this.refreshMailLinkMarksEditors();
        if (typeof this.refreshMailLinkMarksReadingViews === "function") {
          this.refreshMailLinkMarksReadingViews();
        }
        if (typeof this.scheduleBlockMarksRefresh === "function") {
          this.scheduleBlockMarksRefresh();
        }
        if (typeof this.refreshNoReplyPillsEditors === "function") {
          this.refreshNoReplyPillsEditors();
        }
      }, 120);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  teardownMailLinkMarks() {
    try {
      if (this.mailLinkMarksTimer !== null && this.mailLinkMarksTimer !== undefined) {
        clearTimeout(this.mailLinkMarksTimer);
      }
      this.mailLinkMarksTimer = null;
      if (this.mailLinkMarksReadingViews instanceof Map) this.mailLinkMarksReadingViews.clear();
      this.applyMarkGateClass("bob-mail-link-marks", false);
    } catch (error) {
      // Cleanup is best-effort.
    }
  }
}
