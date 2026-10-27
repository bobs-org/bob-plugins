// --- Pomodoro home chips: Live Preview and lifecycle ---------------------
// The pure resolver is in 142-pomodoro-home-chips.js; this mixin renders its
// read-time result and never edits the daily note.

let pomodoroHomeChipsRefreshEffect = null;
function ensurePomodoroHomeChipsRefresh() {
  if (pomodoroHomeChipsRefreshEffect) {
    return pomodoroHomeChipsRefreshEffect;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      pomodoroHomeChipsRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    pomodoroHomeChipsRefreshEffect = null;
  }
  return pomodoroHomeChipsRefreshEffect;
}

let PomodoroHomeChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  PomodoroHomeChipWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model || {};
      this.key = `${this.model.chip || ""}|${this.model.state || ""}|${this.model.hue || ""}|${this.model.tooltip || ""}`;
    }

    eq(other) {
      return Boolean(
        other &&
          other instanceof PomodoroHomeChipWidget &&
          other.key === this.key,
      );
    }

    toDOM() {
      return buildPomodoroHomeChipElement(
        typeof document !== "undefined" ? document : null,
        this.model,
      );
    }
  };
}

class BobLedgerToolsPomodoroHomeChipsMixin {
  setupPomodoroHomeChips() {
    try {
      if (typeof this.pomodoroHomeChipsEnabled !== "boolean") {
        this.pomodoroHomeChipsEnabled = true;
      }
      if (!(this.pomodoroHomeChipWarnings instanceof Set)) {
        this.pomodoroHomeChipWarnings = new Set();
      }
      if (!(this.pomodoroHomeChipReadingWidgets instanceof Set)) {
        this.pomodoroHomeChipReadingWidgets = new Set();
      }
      this.setPomodoroHomeChipBodyClass();
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-pomodoro-home-chips",
            name: "Toggle Pomodoro home chips",
            callback: () => this.togglePomodoroHomeChips(),
          });
        }
      } catch (error) {
        // The command is best-effort on older hosts.
      }
      try {
        const extension = this.createPomodoroHomeChipExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderPomodoroHomeChipsIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Reading view is best-effort.
      }
      try {
        const cache = this.app && this.app.metadataCache;
        if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function") {
          this.registerEvent(
            cache.on("changed", () => this.schedulePomodoroHomeChipRefresh()),
          );
        }
      } catch (error) {
        // Cache invalidation is best-effort.
      }
    } catch (error) {
      // Home-chip setup never throws.
    }
  }

  setPomodoroHomeChipBodyClass() {
    try {
      const body = typeof document !== "undefined" && document ? document.body : null;
      const classes = body && body.classList;
      if (!classes) {
        return false;
      }
      if (this.pomodoroHomeChipsEnabled) {
        classes.add("bob-pomodoro-home-chips");
      } else {
        classes.remove("bob-pomodoro-home-chips");
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  togglePomodoroHomeChips() {
    try {
      this.pomodoroHomeChipsEnabled = !this.pomodoroHomeChipsEnabled;
      this.setPomodoroHomeChipBodyClass();
      this.refreshPomodoroHomeChips();
      try {
        new Notice(
          this.pomodoroHomeChipsEnabled
            ? "Pomodoro home chips on"
            : "Pomodoro home chips off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return this.pomodoroHomeChipsEnabled;
    } catch (error) {
      return Boolean(this.pomodoroHomeChipsEnabled);
    }
  }

  pomodoroHomeChipExemptNames() {
    try {
      const loaded = loadPlanCaps();
      const caps = loaded && loaded.caps ? loaded.caps : null;
      return caps && Array.isArray(caps.exempt) ? caps.exempt : ["PLAN"];
    } catch (error) {
      return ["PLAN"];
    }
  }

  pomodoroHomeChipModels(content, dailyPath) {
    try {
      const app = this.app || {};
      const model = pomodoroHomeModels(
        content,
        dailyPath,
        app.metadataCache,
        app.vault,
        this.pomodoroHomeChipExemptNames(),
      );
      this.logPomodoroHomeChipWarnings(model && model.warnings);
      return model;
    } catch (error) {
      return { entries: [], warnings: [], health: {} };
    }
  }

  pomodoroHomeChipModelForEntry(entry, dailyPath) {
    try {
      const warnings = [];
      const model = pomodoroHomeSessionModel(
        entry,
        dailyPath,
        this.app && this.app.metadataCache,
        this.app && this.app.vault,
        this.pomodoroHomeChipExemptNames(),
        warnings,
        new Set(),
        {
          unfiled_links: 0,
          ambiguous_links: 0,
          unresolved_links: 0,
          area_color_invalid: 0,
        },
      );
      this.logPomodoroHomeChipWarnings(warnings);
      return model;
    } catch (error) {
      return null;
    }
  }

  logPomodoroHomeChipWarnings(warnings) {
    try {
      const known = this.pomodoroHomeChipWarnings;
      for (const warning of Array.isArray(warnings) ? warnings : []) {
        if (!warning || warning.code !== "area_color_invalid") {
          continue;
        }
        const key = `${warning.code}:${warning.path || ""}`;
        if (known && known.has(key)) {
          continue;
        }
        if (known) {
          known.add(key);
        }
        try {
          console.warn(`[bob-ledger-tools] ${warning.code}: ${warning.message}`);
        } catch (error) {
          // Console output is best-effort.
        }
      }
    } catch (error) {
      // Lint reporting never interrupts rendering.
    }
  }

  pomodoroHomeChipDailyPath(path) {
    try {
      return typeof path === "string" && PLAN_DAILY_PATH_RE.test(path);
    } catch (error) {
      return false;
    }
  }

  pomodoroHomeChipAvailable() {
    try {
      return Boolean(
        this.pomodoroHomeChipsEnabled &&
          ViewPlugin &&
          Decoration &&
          WidgetType &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          PomodoroHomeChipWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createPomodoroHomeChipExtension() {
    try {
      if (!this.pomodoroHomeChipAvailable()) {
        return null;
      }
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const HomeChipView = class {
        constructor(view) {
          this.decorations = plugin.buildPomodoroHomeChipDecorations(view);
        }

        update(update) {
          if (plugin.pomodoroHomeChipShouldRebuild(update)) {
            this.decorations = plugin.buildPomodoroHomeChipDecorations(update.view);
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(HomeChipView, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  pomodoroHomeChipShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      const refresh = ensurePomodoroHomeChipsRefresh();
      for (const transaction of update.transactions || []) {
        const effects = transaction && transaction.effects;
        for (const effect of Array.isArray(effects) ? effects : effects ? [effects] : []) {
          if (
            effect === refresh ||
            (refresh && effect && typeof effect.is === "function" && effect.is(refresh))
          ) {
            return true;
          }
        }
      }
      try {
        if (editorLivePreviewField && update.startState && update.state) {
          if (
            update.startState.field(editorLivePreviewField) !==
            update.state.field(editorLivePreviewField)
          ) {
            return true;
          }
        }
      } catch (error) {
        // A missing field does not force a rebuild.
      }
      try {
        if (editorInfoField && update.startState && update.state) {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          const beforePath = before && before.file ? before.file.path : null;
          const afterPath = after && after.file ? after.file.path : null;
          if (beforePath !== afterPath) {
            return true;
          }
        }
      } catch (error) {
        // A missing editor-info field does not force a rebuild.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildPomodoroHomeChipDecorations(view) {
    try {
      if (!this.pomodoroHomeChipAvailable() || !Decoration || !RangeSetBuilder) {
        return Decoration ? Decoration.none : null;
      }
      try {
        if (editorLivePreviewField && view && view.state) {
          if (!view.state.field(editorLivePreviewField)) {
            return Decoration.none;
          }
        }
      } catch (error) {
        return Decoration.none;
      }
      const info = view && view.state ? view.state.field(editorInfoField) : null;
      const dailyPath = info && info.file && info.file.path;
      if (!this.pomodoroHomeChipDailyPath(dailyPath)) {
        return Decoration.none;
      }
      const source = view.state.doc.toString();
      const model = this.pomodoroHomeChipModels(source, dailyPath);
      const builder = new RangeSetBuilder();
      for (const entry of model.entries) {
        if (!entry.chip) {
          continue;
        }
        const line = view.state.doc.line(entry.line + 1);
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new PomodoroHomeChipWidget(entry),
            side: 1,
          }),
        );
      }
      return builder.finish();
    } catch (error) {
      return Decoration ? Decoration.none : null;
    }
  }

  refreshPomodoroHomeChipEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return false;
      }
      const refresh = ensurePomodoroHomeChipsRefresh();
      if (!refresh) {
        return false;
      }
      let refreshed = false;
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        try {
          const view = leaf && leaf.view;
          const path = view && view.file && view.file.path;
          if (!this.pomodoroHomeChipDailyPath(path)) {
            continue;
          }
          const cm = view && view.editor && view.editor.cm;
          if (cm && typeof cm.dispatch === "function") {
            cm.dispatch({ effects: refresh.of(null) });
            refreshed = true;
          }
        } catch (error) {
          continue;
        }
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }

  refreshPomodoroHomeChips() {
    try {
      this.refreshPomodoroHomeReadingChips();
      this.refreshPomodoroHomeChipEditors();
      return true;
    } catch (error) {
      return false;
    }
  }

  schedulePomodoroHomeChipRefresh() {
    try {
      if (this.pomodoroHomeChipRefreshTimer !== null && this.pomodoroHomeChipRefreshTimer !== undefined) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.pomodoroHomeChipRefreshTimer = schedule(() => {
        this.pomodoroHomeChipRefreshTimer = null;
        this.refreshPomodoroHomeChips();
      }, 120);
    } catch (error) {
      // A missing timer host simply leaves the current rendering in place.
    }
  }
}
