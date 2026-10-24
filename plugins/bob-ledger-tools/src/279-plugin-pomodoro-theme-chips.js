// --- Pomodoro theme pills: Live Preview --------------------------------
// Decoration.mark per theme component of the name tail on column-0
// `## Pomodoros` entries of canonical daily notes. The pure hue lookup
// is in 279-plugin-pomodoro-theme-mirrors.js; this mixin renders the
// read-time result and never edits the daily note. PT6 typing rule: a
// name the catalog does not know stays neutral on the cursor line.

let pomodoroThemeChipsRefreshEffect = null;
function ensurePomodoroThemeChipsRefresh() {
  if (pomodoroThemeChipsRefreshEffect) {
    return pomodoroThemeChipsRefreshEffect;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      pomodoroThemeChipsRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    pomodoroThemeChipsRefreshEffect = null;
  }
  return pomodoroThemeChipsRefreshEffect;
}

// Absolute offsets of the name tail within one ledger line: entry
// match, leading whitespace, the `(time)` or `(…)` placeholder range,
// then the whitespace before `—`.
function pomodoroThemeNameOffsetInLine(line) {
  try {
    const text = String(line || "");
    const match = PLAN_ENTRY_RE.exec(text);
    if (!match) {
      return null;
    }
    const afterBracket = text.slice(match[0].length);
    if (!/^\s/.test(afterBracket)) {
      return null;
    }
    const bodyStart = match[0].length + (afterBracket.length - afterBracket.trimStart().length);
    const body = text.slice(bodyStart);
    const leading = planLeadingRange(body);
    if (!leading || leading.length === null) {
      return null;
    }
    const remaining = body.slice(leading.length);
    const gap = remaining.match(/^[ \t]*/)[0].length;
    const dashAt = bodyStart + leading.length + gap;
    if (text.slice(dashAt, dashAt + 1) !== "—") {
      return null;
    }
    const nameStart = dashAt + 1 + text.slice(dashAt + 1).match(/^[ \t]*/)[0].length;
    return { nameStart, nameEnd: text.length };
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsPomodoroThemeChipsMixin {
  setupPomodoroThemeChips() {
    try {
      if (typeof this.pomodoroThemeColorsEnabled !== "boolean") {
        this.pomodoroThemeColorsEnabled = true;
      }
      this.setPomodoroThemeChipBodyClass();
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-pomodoro-theme-colors",
            name: "Toggle Pomodoro theme colors",
            callback: () => this.togglePomodoroThemeColors(),
          });
        }
      } catch (error) {
        // The command is best-effort on older hosts.
      }
      try {
        const extension = this.createPomodoroThemeChipExtension();
        if (extension && typeof this.registerEditorExtension === "function") {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview is best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderPomodoroThemePillsIn(el, ctx),
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
            cache.on("changed", () => this.schedulePomodoroThemeChipRefresh()),
          );
        }
      } catch (error) {
        // Cache invalidation is best-effort.
      }
    } catch (error) {
      // Theme setup never throws.
    }
  }

  setPomodoroThemeChipBodyClass() {
    try {
      const body = typeof document !== "undefined" && document ? document.body : null;
      const classes = body && body.classList;
      if (!classes) {
        return false;
      }
      if (this.pomodoroThemeColorsEnabled) {
        classes.add("bob-pomo-theme-colors");
      } else {
        classes.remove("bob-pomo-theme-colors");
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  togglePomodoroThemeColors() {
    try {
      this.pomodoroThemeColorsEnabled = !this.pomodoroThemeColorsEnabled;
      this.setPomodoroThemeChipBodyClass();
      this.refreshPomodoroThemeChips();
      try {
        new Notice(
          this.pomodoroThemeColorsEnabled
            ? "Pomodoro theme colors on"
            : "Pomodoro theme colors off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return this.pomodoroThemeColorsEnabled;
    } catch (error) {
      return Boolean(this.pomodoroThemeColorsEnabled);
    }
  }

  pomodoroThemeChipDailyPath(path) {
    try {
      return typeof path === "string" && PLAN_DAILY_PATH_RE.test(path);
    } catch (error) {
      return false;
    }
  }

  pomodoroThemeChipAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField,
      );
    } catch (error) {
      return false;
    }
  }

  // Keys the fetched catalog knows. When no report is cached (mobile
  // before any fetch), every key counts as known so pills still tint.
  pomodoroThemeKnownKeys() {
    try {
      const report = this.apiThemesSnapshot();
      const themes = (report && report.themes) || [];
      if (themes.length === 0) {
        return null;
      }
      return new Set(
        themes.filter((theme) => theme && theme.key).map((theme) => theme.key),
      );
    } catch (error) {
      return null;
    }
  }

  pomodoroThemeTooltip(key, name) {
    try {
      const resolved = this.pomodoroThemeHueFor(key, name);
      const hue = resolved && resolved.hue ? resolved.hue : "muted";
      const report = this.apiThemesSnapshot();
      const entry = ((report && report.themes) || []).find(
        (theme) => theme && theme.key === key,
      );
      const days =
        entry && Number.isFinite(Number(entry.days_used))
          ? ` · ${entry.days_used} days`
          : "";
      return `${name} · ${hue}${days}`;
    } catch (error) {
      return String(name || key || "");
    }
  }

  createPomodoroThemeChipExtension() {
    try {
      if (!this.pomodoroThemeChipAvailable()) {
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
      const ThemeChipView = class {
        constructor(view) {
          this.decorations = plugin.buildPomodoroThemeDecorations(view);
        }

        update(update) {
          if (plugin.pomodoroThemeShouldRebuild(update)) {
            this.decorations = plugin.buildPomodoroThemeDecorations(update.view);
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(ThemeChipView, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  pomodoroThemeShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      const refresh = ensurePomodoroThemeChipsRefresh();
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
      return update.selectionSet === true;
    } catch (error) {
      return false;
    }
  }

  buildPomodoroThemeDecorations(view) {
    try {
      if (!this.pomodoroThemeChipAvailable() || !Decoration || !RangeSetBuilder) {
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
      if (!this.pomodoroThemeChipDailyPath(dailyPath)) {
        return Decoration.none;
      }
      const source = view.state.doc.toString();
      const lines = source.split("\n");
      const section = planSectionRange(lines);
      if (!section) {
        return Decoration.none;
      }
      const fenced = planFencedLines(lines, section.start, section.end);
      let cursorLine = -1;
      try {
        const head = view.state.selection && view.state.selection.main
          ? view.state.selection.main.head
          : 0;
        cursorLine = view.state.doc.lineAt(head).number - 1;
      } catch (error) {
        cursorLine = -1;
      }
      const known = this.pomodoroThemeKnownKeys();
      // Absolute document offsets per line for decoration ranges.
      const lineStart = [];
      let offset = 0;
      for (const line of lines) {
        lineStart.push(offset);
        offset += line.length + 1;
      }
      const builder = new RangeSetBuilder();
      for (let index = section.start; index <= section.end; index += 1) {
        try {
          if (fenced.has(index) || /^[ \t]/.test(String(lines[index] || ""))) {
            continue;
          }
          const parsed = planParseEntry(lines[index]);
          if (!parsed || parsed.state === "cancelled") {
            continue;
          }
          const slot = pomodoroThemeNameOffsetInLine(lines[index]);
          if (!slot) {
            continue;
          }
          const tail = String(lines[index]).slice(slot.nameStart, slot.nameEnd);
          if (!tail.trim()) {
            continue;
          }
          const base = lineStart[index] + slot.nameStart;
          for (const component of pomodoroThemeComponentsWithOffsets(tail)) {
            const resolved = this.pomodoroThemeHueFor(component.key, component.raw);
            const onCursor = index === cursorLine;
            const unknown =
              known && !known.has(component.key) ? true : false;
            const neutral = onCursor && unknown;
            const hue = neutral
              ? null
              : resolved && resolved.hue
                ? resolved.hue
                : null;
            const muted =
              !neutral && resolved && resolved.hue_source === "exempt";
            const attributes = {
              "data-theme-key": component.key,
              title: this.pomodoroThemeTooltip(component.key, component.raw),
            };
            if (hue) {
              attributes["data-theme-hue"] = hue;
            }
            builder.add(
              base + component.start,
              base + component.end,
              Decoration.mark({
                class: `bob-pomo-theme${muted ? " bob-pomo-theme-muted" : ""}${neutral ? " bob-pomo-theme-unknown" : ""}`,
                attributes,
              }),
            );
          }
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      return Decoration ? Decoration.none : null;
    }
  }

  refreshPomodoroThemeChipEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return false;
      }
      const refresh = ensurePomodoroThemeChipsRefresh();
      if (!refresh) {
        return false;
      }
      let refreshed = false;
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        try {
          const view = leaf && leaf.view;
          const path = view && view.file && view.file.path;
          if (!this.pomodoroThemeChipDailyPath(path)) {
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

  refreshPomodoroThemeChips() {
    try {
      if (typeof this.refreshPomodoroThemeReadingPills === "function") {
        this.refreshPomodoroThemeReadingPills();
      }
      this.refreshPomodoroThemeChipEditors();
      return true;
    } catch (error) {
      return false;
    }
  }

  schedulePomodoroThemeChipRefresh() {
    try {
      if (this.pomodoroThemeChipRefreshTimer !== null && this.pomodoroThemeChipRefreshTimer !== undefined) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.pomodoroThemeChipRefreshTimer = schedule(() => {
        this.pomodoroThemeChipRefreshTimer = null;
        this.refreshPomodoroThemeChips();
      }, 120);
    } catch (error) {
      // A missing timer host simply leaves the current rendering in place.
    }
  }
}
