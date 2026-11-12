// --- Gmail open hint: Live Preview chip ----------------------------------
// Owned by bob-cli `docs/mail-link-marks.md`. Display-only `⌘↵ Gmail` chip at
// the end of the cursor's line when the bob-mail Cmd+Enter keymap will open
// an email. Gated by the existing mail-link-marks toggle; the keymap
// capability flag keeps the chip truthful. Live Preview only: the keymap is
// editor-only, so reading view shows nothing.

let gmailOpenHintRefreshEffect = null;
function ensureGmailOpenHintRefresh() {
  if (gmailOpenHintRefreshEffect) return gmailOpenHintRefreshEffect;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      gmailOpenHintRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    gmailOpenHintRefreshEffect = null;
  }
  return gmailOpenHintRefreshEffect;
}

class BobLedgerToolsGmailOpenHintMixin {
  setupGmailOpenHint() {
    try {
      if (typeof this.registerEditorExtension !== "function") return;
      try {
        const extension = this.createGmailOpenHintExtension();
        if (extension) this.registerEditorExtension(extension);
      } catch (error) {
        // Live Preview chip is best-effort.
      }
      try {
        this.setupGmailOpenHintListeners();
      } catch (error) {
        // Liveness listeners are best-effort.
      }
      try {
        if (!this.gmailOpenHintWrappedToggle && typeof this.toggleMailLinkMarks === "function") {
          const original = this.toggleMailLinkMarks.bind(this);
          const plugin = this;
          this.toggleMailLinkMarks = function wrappedToggleMailLinkMarks() {
            const result = original();
            try {
              plugin.refreshGmailOpenHintEditors();
            } catch (error) {
              // Hint refresh is best-effort.
            }
            return result;
          };
          this.gmailOpenHintWrappedToggle = true;
        }
      } catch (error) {
        // Toggle wrap is best-effort.
      }
      if (typeof this.register === "function") {
        try {
          this.register(() => this.teardownGmailOpenHint());
        } catch (error) {
          // Cleanup is best-effort.
        }
      }
    } catch (error) {
      // Display-only setup never blocks plugin startup.
    }
  }

  gmailOpenHintGateOn() {
    try {
      return this.mailLinkMarksEnabled !== false;
    } catch (error) {
      return true;
    }
  }

  gmailOpenHintKeymapLive() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const mail = plugins && plugins["bob-mail"];
      return Boolean(mail && mail.mailGmailOpenKeymap === 1);
    } catch (error) {
      return false;
    }
  }

  setupGmailOpenHintListeners() {
    try {
      if (typeof this.registerEvent !== "function") return;
      const metadataCache = this.app && this.app.metadataCache;
      if (metadataCache && typeof metadataCache.on === "function") {
        this.registerEvent(metadataCache.on("changed", () => this.scheduleGmailOpenHintRefresh()));
        this.registerEvent(metadataCache.on("resolved", () => this.scheduleGmailOpenHintRefresh()));
      }
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function") {
        this.registerEvent(workspace.on("layout-change", () => this.scheduleGmailOpenHintRefresh()));
      }
    } catch (error) {
      // Liveness listeners are best-effort.
    }
  }

  gmailOpenHintAvailable() {
    try {
      return Boolean(
        ViewPlugin && Decoration && WidgetType && StateEffect &&
        typeof StateEffect.define === "function" && RangeSetBuilder &&
        editorInfoField && editorLivePreviewField && GmailOpenHintWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createGmailOpenHintExtension() {
    try {
      if (!this.gmailOpenHintAvailable() || !ViewPlugin || typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      const HintPluginClass = class {
        constructor(view) {
          try { this.decorations = plugin.buildGmailOpenHintDecorations(view); }
          catch (error) { this.decorations = Decoration.none; }
        }
        update(update) {
          try {
            if (plugin.gmailOpenHintShouldRebuild(update)) {
              this.decorations = plugin.buildGmailOpenHintDecorations(update.view);
            }
          } catch (error) {
            // Keep the last good decoration set.
          }
        }
      };
      return Prec.highest(ViewPlugin.fromClass(HintPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  gmailOpenHintShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const refresh = ensureGmailOpenHintRefresh();
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

  gmailOpenHintDocLines(doc) {
    try {
      if (doc && typeof doc.toString === "function") {
        return String(doc.toString()).split("\n");
      }
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
  }

  buildGmailOpenHintDecorations(view) {
    try {
      if (!this.gmailOpenHintGateOn() || !Decoration || !RangeSetBuilder || !GmailOpenHintWidget) {
        return Decoration.none;
      }
      if (!editorInfoField || !editorLivePreviewField) return Decoration.none;
      if (!view || !view.state || !view.state.field(editorLivePreviewField)) return Decoration.none;
      const info = view.state.field(editorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath) return Decoration.none;
      if (!this.gmailOpenHintKeymapLive()) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") return Decoration.none;
      let head = null;
      try {
        head = view.state.selection && view.state.selection.main && view.state.selection.main.head;
      } catch (error) {
        head = null;
      }
      if (!Number.isInteger(head)) return Decoration.none;
      let cursorLine = null;
      try { cursorLine = doc.lineAt(head); } catch (error) { cursorLine = null; }
      if (!cursorLine || typeof cursorLine.text !== "string") return Decoration.none;
      if (typeof cursorLine.number !== "number" || typeof cursorLine.from !== "number") return Decoration.none;
      const lineIndex = cursorLine.number - 1;
      const lineText = cursorLine.text;
      const lines = this.gmailOpenHintDocLines(doc);
      const resolvers = {
        getDest: (target, source) => {
          const cache = this.app && this.app.metadataCache;
          if (!cache || typeof cache.getFirstLinkpathDest !== "function") return null;
          return cache.getFirstLinkpathDest(target, source);
        },
        getFrontmatter: (file) => {
          try {
            const cache = this.app && this.app.metadataCache;
            if (!cache || typeof cache.getFileCache !== "function") return null;
            return (cache.getFileCache(file) || {}).frontmatter || null;
          } catch (error) {
            return null;
          }
        },
      };
      let canOpen = false;
      try {
        canOpen = gmailOpenHintCanOpen(lineText, lines, lineIndex, sourcePath, resolvers);
      } catch (error) {
        canOpen = false;
      }
      if (!canOpen) return Decoration.none;
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) tree = syntaxTree(view.state);
      } catch (error) {
        tree = null;
      }
      try {
        if (tree && typeof freshnessMarkPosInCode === "function") {
          if (freshnessMarkPosInCode(tree, cursorLine.from + 1)) return Decoration.none;
        }
      } catch (error) {
        // Code guard is best-effort.
      }
      const builder = new RangeSetBuilder();
      let label = "⌘↵ Gmail";
      try {
        label = gmailOpenHintLabel(gmailOpenHintIsMac());
      } catch (error) {
        label = "⌘↵ Gmail";
      }
      builder.add(cursorLine.to, cursorLine.to, Decoration.widget({
        widget: new GmailOpenHintWidget(label),
        side: GMAIL_OPEN_HINT_SIDE,
      }));
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  refreshGmailOpenHintEditors() {
    try {
      const refresh = ensureGmailOpenHintRefresh();
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

  scheduleGmailOpenHintRefresh() {
    try {
      if (this.gmailOpenHintTimer !== null && this.gmailOpenHintTimer !== undefined) return;
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : setTimeout;
      this.gmailOpenHintTimer = schedule(() => {
        this.gmailOpenHintTimer = null;
        this.refreshGmailOpenHintEditors();
      }, 120);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  teardownGmailOpenHint() {
    try {
      if (this.gmailOpenHintTimer !== null && this.gmailOpenHintTimer !== undefined) {
        clearTimeout(this.gmailOpenHintTimer);
      }
      this.gmailOpenHintTimer = null;
    } catch (error) {
      // Cleanup is best-effort.
    }
  }
}
