// --- api.themes v1 additive task-theme surface -------------------------
// Synchronous wrappers over the pure PT13 helpers. They never spawn bob and
// never write a vault file; consumers own their existing guarded writes.

class BobLedgerToolsTaskThemeApiMixin {
  pomodoroThemesApi() {
    return Object.freeze({
      version: 1,
      available: () => this.apiThemesAvailable(),
      fetch: () => this.apiThemesFetch(),
      snapshot: () => this.apiThemesSnapshot(),
      isConfigured: (key) => this.pomodoroThemeIsConfigured(key),
      hueFor: (key, name) => this.pomodoroThemeHueFor(key, name),
      componentsOf: (name) => pomodoroThemeComponentsOf(name),
      historyRows: (options) => this.pomodoroThemeHistoryRows(options),
      similarTo: (name) => this.pomodoroThemeSimilarTo(name),
      hide: (name) => this.apiThemesHide(name),
      unhide: (name) => this.apiThemesUnhide(name),
      color: (name, hue) => this.apiThemesColor(name, hue),
      rename: (from, to, options) => this.apiThemesRename(from, to, options),
      onChange: (callback) => this.onThemesChange(callback),
      suggestFor: (request) => this.pomodoroThemeSuggestFor(request),
      taskThemeOf: (text) => pomodoroThemeTaskFieldState(text),
      setTaskTheme: (text, name) => pomodoroThemeSetTaskTheme(text, name),
      clearTaskTheme: (text) => pomodoroThemeClearTaskTheme(text),
      planThemeChange: (options) => pomodoroThemePlanChange(options),
      isKnownTheme: (key) => this.pomodoroThemeIsKnown(key),
    });
  }

  pomodoroThemeTodayPath() {
    try {
      if (typeof this.currentTodayDailyPath === "function") {
        return this.currentTodayDailyPath() || "";
      }
      return todayDailyPath(new Date(), getDailyNotesOptions(this.app));
    } catch (error) {
      return "";
    }
  }

  pomodoroThemeCacheTodayLedger(content, dailyPath) {
    try {
      const names = pomodoroThemeLedgerNames(content);
      const prior = this.pomodoroTaskThemeTodayLedger;
      const signature = JSON.stringify([...names.entries()]);
      this.pomodoroTaskThemeTodayLedger = {
        path: dailyPath,
        content: String(content == null ? "" : content),
        names,
        signature,
      };
      if (
        prior &&
        (prior.signature !== signature || !sameVaultPath(prior.path || "", dailyPath)) &&
        typeof this.themesNotifyChanged === "function"
      ) {
        this.themesNotifyChanged("today");
      }
    } catch (error) {
      // The Today membership cache remains authoritative for its own APIs.
    }
  }

  pomodoroThemeOpenEditorContent(path) {
    try {
      const workspace = this.app && this.app.workspace;
      const leaves =
        workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown")
          : [];
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        const view = leaf && leaf.view;
        const filePath = view && view.file && view.file.path;
        const editor = view && view.editor;
        if (
          typeof filePath !== "string" ||
          !sameVaultPath(filePath, path) ||
          !editor ||
          typeof editor.getValue !== "function"
        ) {
          continue;
        }
        return editor.getValue();
      }
    } catch (error) {
      // An unavailable editor leaves the last loaded daily snapshot usable.
    }
    return null;
  }

  pomodoroThemeTodayNames(dailyPath, requestPath, requestText) {
    try {
      const sameRequest =
        typeof requestPath === "string" &&
        sameVaultPath(requestPath, dailyPath) &&
        typeof requestText === "string";
      let content = sameRequest ? requestText : null;
      if (content === null) {
        content = this.pomodoroThemeOpenEditorContent(dailyPath);
      }
      if (typeof content === "string") {
        const cached = this.pomodoroTaskThemeLiveDailyCache;
        if (
          cached &&
          cached.path === dailyPath &&
          cached.content === content &&
          cached.names instanceof Map
        ) {
          return cached.names;
        }
        const names = pomodoroThemeLedgerNames(content);
        this.pomodoroTaskThemeLiveDailyCache = {
          path: dailyPath,
          content,
          names,
        };
        return names;
      }
      const saved = this.pomodoroTaskThemeTodayLedger;
      if (saved && sameVaultPath(saved.path || "", dailyPath) && saved.names instanceof Map) {
        return saved.names;
      }
      return new Map();
    } catch (error) {
      return new Map();
    }
  }

  pomodoroThemeSuggestCatalog(dailyPath, requestPath, requestText) {
    const names = new Map();
    const known = new Set();
    try {
      const report = this.apiThemesSnapshot();
      for (const theme of Array.isArray(report.themes) ? report.themes : []) {
        if (!theme || typeof theme.key !== "string" || !theme.key) {
          continue;
        }
        const key = pomodoroThemeNormalizeKey(theme.key);
        if (!key) {
          continue;
        }
        known.add(key);
        if (typeof theme.name === "string" && theme.name) {
          names.set(key, theme.name);
        }
      }
      for (const theme of Array.isArray(report.configured_themes)
        ? report.configured_themes
        : []) {
        if (!theme || typeof theme.key !== "string" || !theme.key) {
          continue;
        }
        const key = pomodoroThemeNormalizeKey(theme.key);
        if (!key) {
          continue;
        }
        known.add(key);
        if (!names.has(key) && typeof theme.name === "string" && theme.name) {
          names.set(key, theme.name);
        }
      }
    } catch (error) {
      // The current daily ledger remains a valid known-name source.
    }
    for (const [key, name] of this.pomodoroThemeTodayNames(
      dailyPath,
      requestPath,
      requestText,
    )) {
      known.add(key);
      if (!names.has(key)) {
        names.set(key, name);
      }
    }
    return { names, known };
  }

  pomodoroThemeRef(key, name, known) {
    let hue = { hue: null, hue_source: "hash", configured: null };
    try {
      hue = this.pomodoroThemeHueFor(key, name) || hue;
    } catch (error) {
      // Hue is decorative; the semantic suggestion still resolves.
    }
    const theme = {
      key,
      name,
      hue: typeof hue.hue === "string" ? hue.hue : null,
      hue_source: typeof hue.hue_source === "string" ? hue.hue_source : "hash",
    };
    // Match bob-cli ThemeRef's serde shape: known=true and an unavailable
    // configured flag are omitted; known=false and configured booleans remain.
    if (!known) {
      theme.known = false;
    }
    const configured =
      hue.configured !== undefined
        ? hue.configured
        : this.pomodoroThemeIsConfigured(key);
    if (typeof configured === "boolean") {
      theme.configured = configured;
    }
    return theme;
  }

  pomodoroThemeIsKnown(key) {
    try {
      const normalized = pomodoroThemeNormalizeKey(key);
      if (!normalized) {
        return false;
      }
      const dailyPath = this.pomodoroThemeTodayPath();
      const catalog = this.pomodoroThemeSuggestCatalog(dailyPath, "", undefined);
      return catalog.known.has(normalized);
    } catch (error) {
      return false;
    }
  }

  pomodoroThemeReadTaskLine(request) {
    try {
      const opts = request && typeof request === "object" ? request : {};
      const path = typeof opts.path === "string" ? normalizeVaultPath(opts.path) : "";
      const line = Number(opts.line);
      if (!path || !Number.isInteger(line) || line < 1) {
        return null;
      }
      if (typeof opts.text === "string") {
        const lines = opts.text.split("\n");
        if (line > lines.length) {
          return null;
        }
        return {
          path,
          lineText: lines[line - 1],
          noteText: opts.text,
        };
      }
      const workspace = this.app && this.app.workspace;
      const leaves =
        workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown")
          : [];
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        const view = leaf && leaf.view;
        const editor = view && view.editor;
        const filePath = view && view.file && view.file.path;
        if (
          !editor ||
          typeof filePath !== "string" ||
          !sameVaultPath(filePath, path) ||
          typeof editor.getValue !== "function"
        ) {
          continue;
        }
        const noteText = editor.getValue();
        const lines = String(noteText).split("\n");
        if (line > lines.length) {
          return null;
        }
        return { path, lineText: lines[line - 1], noteText: String(noteText) };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  pomodoroThemeSuggestFor(request) {
    try {
      const input = this.pomodoroThemeReadTaskLine(request);
      if (!input) {
        return null;
      }
      const dailyPath = this.pomodoroThemeTodayPath();
      const caps = loadPlanCaps().caps;
      const catalog = this.pomodoroThemeSuggestCatalog(
        dailyPath,
        input.path,
        input.noteText,
      );
      const metadataCache = this.app && this.app.metadataCache;
      const vault = this.app && this.app.vault;
      const result = pomodoroThemeSuggestWithDiagnostics({
        path: input.path,
        line: input.lineText,
        dailyPath,
        metadataCache,
        vault,
        catalog,
        config: {
          readingTheme:
            caps && Object.prototype.hasOwnProperty.call(caps, "readingTheme")
              ? caps.readingTheme
              : "READ",
          exempt: caps && Array.isArray(caps.exempt) ? caps.exempt : ["PLAN"],
        },
        themeRef: (key, name, known) => this.pomodoroThemeRef(key, name, known),
      });
      return result && result.suggestion ? result.suggestion : null;
    } catch (error) {
      return null;
    }
  }
}
