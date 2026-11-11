// --- api.themes v1 additive task-theme surface -------------------------
// Wrappers over the pure PT13 helpers. They never spawn bob or write a vault
// file; consumers own their existing guarded writes.

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
      effectiveTypeFor: (request) => this.taskTypeEffectiveTypeFor(request),
      typeComponentsOf: (name) => this.taskTypeComponentsOf(name),
      typeAgrees: (taskKey, entryName) => this.taskTypeAgrees(taskKey, entryName),
      agreeEntry: (input) => this.taskTypeAgreeEntry(input),
      settleClosed: (name, worked) => this.taskTypeSettleClosed(name, worked),
      agreeLedgerEntries: (request) => this.taskTypeAgreeLedgerEntries(request),
      planRetype: (options) => this.taskTypePlanRetype(options),
      planLanding: (options) => this.taskTypePlanLanding(options),
      planSplit: (options) => this.taskTypePlanSplit(options),
      mergeNames: (base, others) => mergeNames(base, others),
      narrowClosed: (name, worked) => this.taskTypeNarrowClosed(name, worked),
      shed: (name, before, after) => this.taskTypeShed(name, before, after),
      isMeetName: (name) => taskTypeIsMeetName(name),
      planPlacement: (options) => this.taskTypePlanPlacement(options),
      planRelocation: (options) => this.taskTypePlanRelocation(options),
      isKnownTheme: (key) => this.pomodoroThemeIsKnown(key),
    });
  }

  // Routing sources for the task-type planners: the vocabulary comes from
  // the configured-rows snapshot, exempt and inventory labels from plan
  // config. Never throws; unavailable settings degrade to the plan defaults.
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

  taskTypeAgreeEntry(input) {
    try {
      const opts = input && typeof input === "object" ? input : {};
      return agreeEntry(
        opts,
        opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
      );
    } catch (error) {
      const name = input && input.name != null ? String(input.name) : "";
      return { name, added: [], removed: [], unrepaired: [] };
    }
  }

  taskTypeSettleClosed(name, worked) {
    try {
      return settleClosed(name, worked, this.taskTypeSources());
    } catch (error) {
      return typeof name === "string" ? name : "";
    }
  }

  taskTypeAgreeCachedBlockLine(path, blockId) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (!metadataCache || typeof metadataCache.getCache !== "function") {
        return null;
      }
      const cache = metadataCache.getCache(path);
      const blocks = cache && cache.blocks;
      if (!blocks || typeof blocks !== "object") return null;
      const id = String(blockId || "");
      let block = null;
      for (const key of [id, `^${id}`, id.toLowerCase()]) {
        if (Object.prototype.hasOwnProperty.call(blocks, key)) {
          block = blocks[key];
          break;
        }
      }
      if (!block) {
        block = Object.values(blocks).find(
          (item) => item && String(item.id || "").replace(/^\^/u, "") === id,
        );
      }
      const line = block && block.position && block.position.start
        ? block.position.start.line
        : null;
      if (!Number.isInteger(line) || line < 0) return null;
      const item = (Array.isArray(cache.listItems) ? cache.listItems : [])
        .find((row) => row && row.position && row.position.start &&
          row.position.start.line === line);
      return item && typeof item.task === "string" && item.task ? line : null;
    } catch (error) {
      return null;
    }
  }

  async taskTypeAgreeReadTaskText(path, sourcePath, sourceContent) {
    try {
      const samePath = typeof sameVaultPath === "function"
        ? sameVaultPath(path, sourcePath)
        : String(path) === String(sourcePath);
      if (samePath) return sourceContent;
      const editorText = this.pomodoroThemeOpenEditorContent(path);
      if (typeof editorText === "string") return editorText;
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.cachedRead !== "function" ||
          typeof vault.getAbstractFileByPath !== "function") {
        return null;
      }
      const file = vault.getAbstractFileByPath(path);
      if (!file) return null;
      const text = await vault.cachedRead(file);
      return typeof text === "string" ? text : null;
    } catch (error) {
      return null;
    }
  }

  async taskTypeAgreeResolveLink(target, blockId, sourcePath, sourceContent) {
    try {
      const writtenTarget = String(target || "");
      let path = null;
      if (!writtenTarget) {
        path = sourcePath;
      } else if (typeof this.progressMarkResolveTarget === "function") {
        path = this.progressMarkResolveTarget(writtenTarget, sourcePath);
      } else {
        const metadataCache = this.app && this.app.metadataCache;
        const dest = metadataCache &&
          typeof metadataCache.getFirstLinkpathDest === "function"
          ? metadataCache.getFirstLinkpathDest(writtenTarget, sourcePath)
          : null;
        path = dest && typeof dest.path === "string" ? dest.path : null;
        if (path && !/\.md$/i.test(path)) path += ".md";
      }
      if (!path) return null;
      const normalizedPath = typeof normalizePath === "function"
        ? normalizePath(path)
        : String(path);
      const text = await this.taskTypeAgreeReadTaskText(
        normalizedPath,
        sourcePath,
        sourceContent,
      );
      if (typeof text !== "string") return null;
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      const id = String(blockId || "");
      if (!id) return null;
      const matches = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (pomodoroThemeTrailingBlockId(lines[index]) === id) {
          matches.push(index);
        }
      }
      if (matches.length !== 1) return null;
      const cachedLine = this.taskTypeAgreeCachedBlockLine(normalizedPath, id);
      const lineIndex = cachedLine === matches[0] ? cachedLine : matches[0];
      const lineText = lines[lineIndex];
      if (!pomodoroThemeTaskMark(lineText)) return null;
      return {
        path: normalizedPath,
        line: lineIndex + 1,
        lineText,
        text: lines.join("\n"),
      };
    } catch (error) {
      return null;
    }
  }

  async taskTypeAgreeClassifyChild(line, sourcePath, sourceContent) {
    const bullet = todayBulletBody(line);
    if (!bullet) return { kind: "prose" };
    const body = bullet.body;
    const tomato = body.includes("🍅");
    const stripped = body.replace(/🍅/gu, "").trim();
    if (!stripped || stripped.startsWith("~")) return { kind: "prose" };
    const clean = stripped.replace(/~~/gu, "").trim();
    const token = todayBareLink(clean);
    if (!token) return { kind: "prose" };
    const originalTokens = todayWikilinkTokens(stripped);
    const sourceToken = originalTokens.length === 1 ? originalTokens[0] : null;
    const struck = Boolean(sourceToken && planStruckInnerSpans(stripped).some(
      ([start, end]) => sourceToken.start >= start && sourceToken.end <= end,
    ));
    const resolved = await this.taskTypeAgreeResolveLink(
      token.pathPart,
      token.blockId,
      sourcePath,
      sourceContent,
    );
    if (!resolved) return { kind: "unknown" };
    const mark = pomodoroThemeTaskMark(resolved.lineText);
    const isOpen = mark !== null && !/^(?:x|-)$/.test(mark.toLowerCase());
    const suggestion = this.taskTypeEffectiveTypeFor({
      path: resolved.path,
      line: resolved.line,
      text: resolved.text,
      asIfOpen: true,
    });
    if (!suggestion || suggestion.repair || !suggestion.theme) {
      return { kind: "unknown" };
    }
    const key = pomodoroThemeKeyOf(suggestion.theme);
    const name = taskTypeThemeNameOf(suggestion.theme);
    if (!key || !name) return { kind: "unknown" };
    if (struck || token.embedded || tomato) {
      return { kind: "worked", key, name };
    }
    return isOpen
      ? { kind: "live", key, name }
      : { kind: "unknown" };
  }

  async taskTypeAgreeLedgerEntries(request) {
    const opts = request && typeof request === "object" ? request : {};
    const originalContent = typeof opts.content === "string" ? opts.content : "";
    try {
      const path = typeof opts.path === "string" ? normalizePath(opts.path) : "";
      const sources = this.taskTypeSources();
      const selected = Array.isArray(opts.entryLines)
        ? new Set(opts.entryLines.filter((line) => Number.isInteger(line) && line > 0))
        : null;
      const normalized = originalContent.replace(/\r\n?/g, "\n");
      const scannedLines = normalized.split("\n");
      const originalLines = originalContent.split(/\r\n|\n|\r/);
      const lineStarts = [];
      let cursor = 0;
      for (let index = 0; index < originalLines.length; index += 1) {
        lineStarts.push(cursor);
        cursor += originalLines[index].length;
        const ending = /^(?:\r\n|\n|\r)/.exec(originalContent.slice(cursor));
        if (ending) cursor += ending[0].length;
      }
      const entries = [];
      const unrepaired = [];
      const replacements = [];
      const openEntries = [];
      todayEachOpenEntry(normalized, (entry) => openEntries.push(entry));
      for (const entry of openEntries) {
        const line = entry.index + 1;
        if (selected && !selected.has(line)) continue;
        const children = [];
        const childIndent = entry.range.length
          ? todayIndentLen(scannedLines[entry.range[0]])
          : null;
        for (const childIndex of entry.range) {
          if (childIndent === null || todayIndentLen(scannedLines[childIndex]) !== childIndent) {
            continue;
          }
          children.push(await this.taskTypeAgreeClassifyChild(
            scannedLines[childIndex],
            path,
            normalized,
          ));
        }
        const outcome = agreeEntry({
          name: entry.entryName,
          open: true,
          children,
        }, sources);
        for (const item of outcome.unrepaired) {
          const entryName = entry.entryName || "";
          let message = "unresolved link";
          if (item.code === "meet_mismatch") {
            message = `${item.key || "task"} task under MEET — ${entryName}`;
          } else if (item.code === "unconfigured_type") {
            message = `${item.key || "type"} isn't one of your types`;
          }
          unrepaired.push({
            line,
            entry: entryName,
            code: item.code,
            key: item.key,
            message,
          });
        }
        const before = entry.entryName || "";
        if (outcome.name === before || entry.entryName === null) continue;
        const rawLine = originalLines[entry.index];
        const range = pomodoroThemeNameOffsetInLine(rawLine);
        if (!range) continue;
        const dash = rawLine.lastIndexOf("—", range.nameStart);
        if (dash < 0) continue;
        replacements.push({
          start: lineStarts[entry.index],
          end: lineStarts[entry.index] + rawLine.length,
          text: `${rawLine.slice(0, dash).replace(/[ \t]+$/u, "")} — ${outcome.name}`,
        });
        entries.push({
          line,
          before,
          after: outcome.name,
          added: outcome.added,
          removed: outcome.removed,
        });
      }
      let content = originalContent;
      for (const item of replacements.sort((left, right) => right.start - left.start)) {
        content = content.slice(0, item.start) + item.text + content.slice(item.end);
      }
      return { content, changed: content !== originalContent, entries, unrepaired };
    } catch (error) {
      return { content: originalContent, changed: false, entries: [], unrepaired: [] };
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

  taskTypePlanLanding(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const effective = opts.effective !== undefined ? opts.effective : opts.suggestion;
      const inherited = opts.inheritedKey !== undefined ? opts.inheritedKey : opts.inherited;
      return planLanding(
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
          retype: opts.retype,
          tabPick: opts.tabPick,
        },
        opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
      );
    } catch (error) {
      return null;
    }
  }

  taskTypeShed(name, before, after) {
    try {
      return shed(name, before, after, this.taskTypeSources());
    } catch (error) {
      return typeof name === "string" ? name : "";
    }
  }

  taskTypeNarrowClosed(name, worked) {
    try {
      return narrowClosed(name, worked, this.taskTypeSources());
    } catch (error) {
      return typeof name === "string" ? name : "";
    }
  }

  taskTypePlanPlacement(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const sources = this.taskTypeSources();
      return planPlacement({
        typeKey: opts.typeKey !== undefined ? opts.typeKey : opts.type,
        typeName: opts.typeName,
        entries: opts.entries,
        exempt: opts.exempt !== undefined ? opts.exempt : sources.exempt,
        alreadyQueued: opts.alreadyQueued,
      });
    } catch (error) {
      return null;
    }
  }

  taskTypePlanRelocation(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      return planRelocation({
        entries: opts.entries,
        liveLink: opts.liveLink,
        typeKey: opts.typeKey !== undefined ? opts.typeKey : opts.type,
        typeName: opts.typeName,
        sources: opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
      });
    } catch (error) {
      return null;
    }
  }

  taskTypePlanSplit(options) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const rawSplit =
        opts.splitSelectors !== undefined ? opts.splitSelectors : opts.split;
      return planSplit(
        {
          name: opts.name !== undefined ? opts.name : opts.entry,
          open: opts.open,
          linkKeys: opts.linkKeys !== undefined ? opts.linkKeys : opts.link_keys,
          splitSelectors: rawSplit,
        },
        opts.sources !== undefined ? opts.sources : this.taskTypeSources(),
      );
    } catch (error) {
      return null;
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
      while (cache.size > 64) {
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
            if (typeof self.scheduleEventLinkTimesRefresh === "function") {
              self.scheduleEventLinkTimesRefresh();
            }
          } catch (error) {
            // Link pill refresh after cache fill is best-effort.
          }
          try {
            if (typeof self.schedulePomodoroHomeChipRefresh === "function") {
              self.schedulePomodoroHomeChipRefresh();
            }
          } catch (error) {
            // Home chips may be disabled or unavailable.
          }
          try {
            if (typeof self.scheduleOffClockLinkChipsRefresh === "function") {
              self.scheduleOffClockLinkChipsRefresh();
            }
          } catch (error) {
            // Off-clock link chips may be disabled or unavailable.
          }
          try {
            if (typeof self.scheduleKeepMovingMarksRefresh === "function") {
              self.scheduleKeepMovingMarksRefresh();
            }
          } catch (error) {
            // Keep-moving marks may be disabled or unavailable.
          }
          try {
            if (typeof self.schedulePlanBlockRerender === "function") {
              self.schedulePlanBlockRerender();
            }
          } catch (error) {
            // Plan block rerender after cache fill is best-effort.
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
        asIfOpen: request && request.asIfOpen === true,
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
