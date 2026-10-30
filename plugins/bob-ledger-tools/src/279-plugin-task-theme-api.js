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
      planThemeChange: (options) => this.pomodoroThemePlanThemeChange(options),
      effectiveTypeFor: (request) => this.taskTypeEffectiveTypeFor(request),
      typeComponentsOf: (name) => this.taskTypeComponentsOf(name),
      typeAgrees: (taskKey, entryName) => this.taskTypeAgrees(taskKey, entryName),
      planRetype: (options) => this.taskTypePlanRetype(options),
      planPlacement: (options) => this.taskTypePlanPlacement(options),
      planRelocation: (options) => this.taskTypePlanRelocation(options),
      isKnownTheme: (key) => this.pomodoroThemeIsKnown(key),
    });
  }

  // Routing sources for the task-type planners: the vocabulary comes from
  // the configured-rows snapshot, exempt and inventory labels from plan
  // caps. Never throws; unknown caps degrade to the plan defaults.
  taskTypeSources() {
    try {
      const rows = this.pomodoroThemesConfiguredRows();
      const vocab = Array.isArray(rows) && rows.length > 0
        ? rows.map((row) => row && row.key).filter(Boolean)
        : null;
      let exempt = ["PLAN"];
      let inventory = [];
      try {
        const caps = loadPlanCaps().caps;
        if (caps && Array.isArray(caps.exempt)) {
          exempt = caps.exempt;
        }
        if (caps && Array.isArray(caps.inventoryLabels)) {
          inventory = caps.inventoryLabels;
        }
      } catch (error) {
        // Plan caps stay at their documented defaults.
      }
      return { vocab, exempt, inventory };
    } catch (error) {
      return { vocab: null, exempt: ["PLAN"], inventory: [] };
    }
  }

  taskTypeComponentsOf(name) {
    try {
      return typeComponents(name, this.taskTypeSources());
    } catch (error) {
      return [];
    }
  }

  taskTypeAgrees(taskKey, entryName) {
    try {
      const key = taskKey && typeof taskKey === "object"
        ? pomodoroThemeKeyOf(taskKey.theme || taskKey)
        : taskKey;
      return typeAgrees(key, entryName, this.taskTypeSources());
    } catch (error) {
      return true;
    }
  }

  taskTypePlanRetype(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const effective = opts.effective !== undefined ? opts.effective : opts.suggestion;
      const inherited = opts.inheritedKey !== undefined ? opts.inheritedKey : opts.inherited;
      return planRetype(
        {
          field: opts.field,
          effectiveKey: effective && typeof effective === "object"
            ? pomodoroThemeKeyOf(effective.theme || effective)
            : effective,
          effectiveName: taskTypeThemeNameOf(effective),
          inheritedKey: inherited && typeof inherited === "object"
            ? pomodoroThemeKeyOf(inherited.theme || inherited)
            : inherited,
          destination: opts.destination !== undefined ? opts.destination : opts.destinationName,
          selector: opts.selector,
          keepType: opts.keepType,
          tabPick: opts.tabPick,
        },
        opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
      );
    } catch (error) {
      return null;
    }
  }

  taskTypeLedgerKeysAndCount(overrides) {
    const opts = overrides && typeof overrides === "object" ? overrides : {};
    if (Array.isArray(opts.ledgerKeys)) {
      return {
        ledgerKeys: opts.ledgerKeys,
        themesBefore: Number.isInteger(opts.themesBefore)
          ? opts.themesBefore
          : opts.ledgerKeys.length,
      };
    }
    try {
      const dailyPath = this.pomodoroThemeTodayPath();
      const names = this.pomodoroThemeTodayNames(
        dailyPath,
        typeof opts.path === "string" ? opts.path : "",
        typeof opts.text === "string" ? opts.text : undefined,
      );
      const keys = names instanceof Map ? [...names.keys()] : [];
      return {
        ledgerKeys: keys,
        themesBefore: Number.isInteger(opts.themesBefore)
          ? opts.themesBefore
          : keys.length,
      };
    } catch (error) {
      return { ledgerKeys: [], themesBefore: 0 };
    }
  }

  taskTypePlanPlacement(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      let exempt;
      let cap;
      let strict;
      try {
        const caps = loadPlanCaps().caps;
        exempt = caps.exempt;
        cap = caps.maxThemes;
        strict = caps.strict;
      } catch (error) {
        exempt = ["PLAN"];
        cap = 3;
        strict = false;
      }
      const ledger = this.taskTypeLedgerKeysAndCount(opts);
      return planPlacement({
        typeKey: opts.typeKey !== undefined ? opts.typeKey : opts.type,
        typeName: opts.typeName,
        entries: opts.entries,
        exempt: opts.exempt !== undefined ? opts.exempt : exempt,
        ledgerKeys: ledger.ledgerKeys,
        themesBefore: ledger.themesBefore,
        cap: opts.cap !== undefined ? opts.cap : cap,
        strict: opts.strict !== undefined ? opts.strict : strict,
        alreadyQueued: opts.alreadyQueued,
      });
    } catch (error) {
      return null;
    }
  }

  taskTypePlanRelocation(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      let cap;
      let strict;
      try {
        const caps = loadPlanCaps().caps;
        cap = caps.maxThemes;
        strict = caps.strict;
      } catch (error) {
        cap = 3;
        strict = false;
      }
      const ledger = this.taskTypeLedgerKeysAndCount(opts);
      return planRelocation({
        entries: opts.entries,
        liveLink: opts.liveLink,
        typeKey: opts.typeKey !== undefined ? opts.typeKey : opts.type,
        typeName: opts.typeName,
        sources: opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
        ledgerKeys: ledger.ledgerKeys,
        themesBefore: ledger.themesBefore,
        cap: opts.cap !== undefined ? opts.cap : cap,
        strict: opts.strict !== undefined ? opts.strict : strict,
      });
    } catch (error) {
      return null;
    }
  }

  // Deprecated: the link-picker and Task Card phases replace this with
  // `planRetype`. The default path keeps the legacy write rule byte for
  // byte; only the keep-type path (`linkOnce`) delegates to `planRetype`.
  pomodoroThemePlanThemeChange(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      if (opts.linkOnce === true) {
        const outcome = this.taskTypePlanRetype({ ...opts, keepType: true });
        if (!outcome) {
          return { action: "none" };
        }
        if (outcome.kind === "merge") {
          return { action: "merge", name: outcome.name };
        }
        if (outcome.kind === "set") {
          return { action: "set", name: outcome.name, key: outcome.key };
        }
        if (outcome.kind === "clear") {
          return { action: "clear" };
        }
        return { action: "none" };
      }
      return pomodoroThemePlanChange(opts);
    } catch (error) {
      return { action: "none" };
    }
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

  pomodoroThemeCatalogSpelling(key) {
    try {
      const normalized = pomodoroThemeNormalizeKey(key);
      if (!normalized) {
        return null;
      }
      const dailyPath = this.pomodoroThemeTodayPath();
      const catalog = this.pomodoroThemeSuggestCatalog(dailyPath, "", undefined);
      const name = catalog && catalog.names ? catalog.names.get(normalized) : null;
      return typeof name === "string" && name ? name : null;
    } catch (error) {
      return null;
    }
  }

  taskThemeSourceCacheStore() {
    if (!(this.taskThemeSourceCache instanceof Map)) {
      this.taskThemeSourceCache = new Map();
    }
    return this.taskThemeSourceCache;
  }

  taskThemeRememberSourceText(path, text) {
    try {
      const normalized = normalizeVaultPath(path);
      if (!normalized || typeof text !== "string") {
        return false;
      }
      const cache = this.taskThemeSourceCacheStore();
      if (cache.has(normalized)) {
        cache.delete(normalized);
      }
      cache.set(normalized, text);
      while (cache.size > 32) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeSourceTextFor(path) {
    try {
      const normalized = normalizeVaultPath(path);
      if (!normalized) {
        return null;
      }
      const live = this.pomodoroThemeOpenEditorContent(normalized);
      if (typeof live === "string") {
        this.taskThemeRememberSourceText(normalized, live);
        return live;
      }
      const cache = this.taskThemeSourceCacheStore();
      if (cache.has(normalized)) {
        return cache.get(normalized);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  taskThemeRequestSourceText(path) {
    try {
      const normalized = normalizeVaultPath(path);
      if (!normalized) {
        return false;
      }
      if (this.taskThemeSourceTextFor(normalized) !== null) {
        return true;
      }
      if (this.taskThemeSourceReadsInFlight instanceof Set && this.taskThemeSourceReadsInFlight.has(normalized)) {
        return false;
      }
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.cachedRead !== "function") {
        return false;
      }
      let file = null;
      try {
        file =
          typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(normalized)
            : null;
      } catch (error) {
        file = null;
      }
      if (!file) {
        return false;
      }
      if (!(this.taskThemeSourceReadsInFlight instanceof Set)) {
        this.taskThemeSourceReadsInFlight = new Set();
      }
      this.taskThemeSourceReadsInFlight.add(normalized);
      const self = this;
      Promise.resolve(vault.cachedRead(file))
        .then((text) => {
          try {
            self.taskThemeSourceReadsInFlight.delete(normalized);
          } catch (error) {
            // In-flight tracking is best-effort.
          }
          if (typeof text !== "string") {
            return;
          }
          self.taskThemeRememberSourceText(normalized, text);
          try {
            self.scheduleTaskThemeMarksRefresh();
          } catch (error) {
            // Refresh after cache fill is best-effort.
          }
          try {
            if (typeof self.schedulePomodoroHomeChipRefresh === "function") {
              self.schedulePomodoroHomeChipRefresh();
            }
          } catch (error) {
            // Home chips may be disabled or unavailable.
          }
        })
        .catch(() => {
          try {
            self.taskThemeSourceReadsInFlight.delete(normalized);
          } catch (error) {
            // In-flight tracking is best-effort.
          }
        });
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeLineTextFor(path, line, fallback) {
    try {
      const text = this.taskThemeSourceTextFor(path);
      if (typeof text === "string" && Number.isInteger(line) && line >= 1) {
        const lines = text.split("\n");
        if (line <= lines.length) {
          return lines[line - 1];
        }
      }
      return typeof fallback === "string" ? fallback : null;
    } catch (error) {
      return typeof fallback === "string" ? fallback : null;
    }
  }

  taskThemePaddedNoteText(line, lineText) {
    try {
      const number = Number(line);
      const body = String(lineText == null ? "" : lineText);
      if (!Number.isInteger(number) || number < 1) {
        return body;
      }
      const lines = [];
      for (let index = 1; index < number; index += 1) {
        lines.push("");
      }
      lines.push(body);
      return lines.join("\n");
    } catch (error) {
      return String(lineText == null ? "" : lineText);
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
    const suggestion = this.taskTypeEffectiveTypeFor(request);
    return suggestion;
  }

  taskTypeEffectiveTypeFor(request) {
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
          defaultType:
            caps && Object.prototype.hasOwnProperty.call(caps, "defaultType")
              ? caps.defaultType
              : null,
        },
        themeRef: (key, name, known) => this.pomodoroThemeRef(key, name, known),
      });
      return result && result.suggestion ? result.suggestion : null;
    } catch (error) {
      return null;
    }
  }
}

function taskTypeThemeNameOf(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const theme = value.theme && typeof value.theme === "object" ? value.theme : null;
  if (theme && typeof theme.name === "string" && theme.name) {
    return theme.name;
  }
  if (typeof value.name === "string" && value.name) {
    return value.name;
  }
  if (theme && typeof theme.key === "string" && theme.key) {
    return theme.key;
  }
  return null;
}
