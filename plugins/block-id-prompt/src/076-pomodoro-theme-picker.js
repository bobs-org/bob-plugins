// Pomodoro theme suggestions for the Link to today picker. The catalog,
// history ranking, swatches, and writes all come from Ledger Tools api.themes.
const BLOCK_POMODORO_THEME_HUES = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];

function preserveBlockPomodoroThemeName(raw) {
  const validated = canonicalizePomodoroLinkName(raw);
  if (!validated.valid) {
    return validated;
  }
  return {
    valid: true,
    name: collapsePomodoroWhitespace(raw),
    error: null,
  };
}

function getBlockPomodoroThemesApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api = plugins && plugins["bob-ledger-tools"] && plugins["bob-ledger-tools"].api;
    const themes = api && api.themes;
    return themes && themes.version >= 1 ? themes : null;
  } catch (_error) {
    return null;
  }
}

function blockPomodoroThemeAvailable(api) {
  try {
    if (!api || typeof api.available !== "function") {
      return false;
    }
    const state = api.available();
    return Boolean(state && state.available === true);
  } catch (_error) {
    return false;
  }
}

function blockPomodoroThemeComponents(api, name) {
  try {
    if (api && typeof api.componentsOf === "function") {
      const rows = api.componentsOf(name);
      if (Array.isArray(rows)) {
        return rows.filter(
          (row) => row && typeof row.raw === "string" && typeof row.key === "string",
        );
      }
    }
  } catch (_error) {
    // The picker stays usable if a newer themes namespace misbehaves.
  }
  return String(name || "")
    .split("+")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      key: asciiLowercasePomodoroText(raw.replace(/\s+/g, " ")),
    }));
}

function blockPomodoroThemeKeysInToday(api, entries) {
  const keys = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const component of blockPomodoroThemeComponents(api, entry && entry.name)) {
      if (component.key) {
        keys.add(component.key);
      }
    }
  }
  return keys;
}

function blockPomodoroThemeConfiguredRows(api) {
  try {
    const report = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    return Array.isArray(report && report.configured_themes)
      ? report.configured_themes
      : null;
  } catch (_error) {
    return null;
  }
}

function blockPomodoroThemeInVocabulary(api, key) {
  const rows = blockPomodoroThemeConfiguredRows(api);
  return rows ? rows.some((theme) => theme && theme.key === key) : null;
}

function blockPomodoroThemeUnconfiguredNames(api, name) {
  try {
    const seen = new Set();
    return blockPomodoroThemeComponents(api, name).filter((component) => {
      if (seen.has(component.key)) {
        return false;
      }
      seen.add(component.key);
      if (api && typeof api.isConfigured === "function") {
        return api.isConfigured(component.key) === false;
      }
      return blockPomodoroThemeInVocabulary(api, component.key) === false;
    }).map((component) => component.raw);
  } catch (_error) {
    return [];
  }
}

function blockPomodoroThemeUnconfigured(api, name) {
  return blockPomodoroThemeUnconfiguredNames(api, name).length > 0;
}

function blockPomodoroThemeCompareRecent(left, right) {
  const leftDate = String(left && left.last_used || "");
  const rightDate = String(right && right.last_used || "");
  if (leftDate !== rightDate) {
    return rightDate < leftDate ? -1 : 1;
  }
  const days = Number(right && right.days_used || 0) - Number(left && left.days_used || 0);
  if (days !== 0) {
    return days;
  }
  const leftName = String(left && left.name || "");
  const rightName = String(right && right.name || "");
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

function blockPomodoroThemeHistoryTier(theme, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return 0;
  }
  const querySlug = pomodoroLinkSelectorSlug(trimmed);
  const queryKey = asciiLowercasePomodoroText(trimmed.replace(/\s+/g, " "));
  const key = String(theme && theme.key || "");
  const slug = pomodoroLinkSelectorSlug(theme && theme.name);
  if (key === queryKey || slug === querySlug) {
    return 0;
  }
  if ((queryKey && key.startsWith(queryKey)) || (querySlug && slug.startsWith(querySlug))) {
    return 1;
  }
  return 2;
}

function blockPomodoroThemeMatchesQuery(theme, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return true;
  }
  const querySlug = pomodoroLinkSelectorSlug(trimmed);
  const queryKey = asciiLowercasePomodoroText(trimmed.replace(/\s+/g, " "));
  return pomodoroLinkSelectorSlug(theme && theme.name).includes(querySlug) ||
    String(theme && theme.key || "").includes(queryKey);
}

function blockPomodoroThemeHistory(api, query, exclusions, hiddenRows) {
  if (!blockPomodoroThemeAvailable(api) || typeof api.historyRows !== "function") {
    return [];
  }
  const trimmed = String(query || "").trim();
  const configuredRows = blockPomodoroThemeConfiguredRows(api);
  const configuredOrder = configuredRows
    ? new Map(configuredRows.map((theme, index) => [theme.key, index]))
    : null;
  const configuredKeys = configuredRows
    ? new Set(configuredRows.map((theme) => theme.key))
    : null;
  const limit = trimmed || configuredRows ? 12 : 5;
  let visible = [];
  try {
    visible = api.historyRows({
      query: trimmed,
      limit: 100,
      exclusions,
    });
  } catch (_error) {
    visible = [];
  }
  const byKey = new Map();
  for (const theme of Array.isArray(visible) ? visible : []) {
    if (
      theme && theme.key && theme.name && !exclusions.has(theme.key) &&
      (!configuredKeys || configuredKeys.has(theme.key)) &&
      (!configuredRows || blockPomodoroThemeMatchesQuery(theme, trimmed))
    ) {
      byKey.set(theme.key, {
        ...theme,
        ...(configuredOrder && configuredOrder.has(theme.key)
          ? { configured_order: configuredOrder.get(theme.key) }
          : {}),
      });
    }
  }
  if (hiddenRows instanceof Map) {
    for (const [key, theme] of hiddenRows) {
      if (
        theme && theme.name && !exclusions.has(key) &&
        (!configuredKeys || configuredKeys.has(key)) &&
        blockPomodoroThemeMatchesQuery(theme, trimmed)
      ) {
        byKey.set(key, { ...theme, hidden: true });
      }
    }
  }
  return [...byKey.values()]
    .sort((left, right) => {
      const tier = blockPomodoroThemeHistoryTier(left, trimmed) - blockPomodoroThemeHistoryTier(right, trimmed);
      if (tier) {
        return tier;
      }
      if (
        !left.last_used && !right.last_used &&
        Number.isInteger(left.configured_order) &&
        Number.isInteger(right.configured_order)
      ) {
        return left.configured_order - right.configured_order;
      }
      return blockPomodoroThemeCompareRecent(left, right);
    })
    .slice(0, limit);
}

function blockPomodoroThemeKnown(api, key) {
  try {
    const report = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    const themes = report && Array.isArray(report.themes) ? report.themes : [];
    return themes.find((theme) => theme && theme.key === key) || null;
  } catch (_error) {
    return null;
  }
}

function blockPomodoroThemeSimilar(api, name) {
  if (!api || typeof api.similarTo !== "function") {
    return [];
  }
  const names = new Set();
  const configuredRows = blockPomodoroThemeConfiguredRows(api);
  const configuredNames = configuredRows
    ? new Set(configuredRows.map((theme) => theme && theme.key).filter(Boolean))
    : null;
  for (const component of blockPomodoroThemeComponents(api, name)) {
    try {
      for (const similar of api.similarTo(component.raw) || []) {
        if (typeof similar === "string" && similar) {
          const key = asciiLowercasePomodoroText(
            similar.replace(/\s+/g, " ").trim(),
          );
          if (!configuredNames || configuredNames.has(key)) {
            names.add(similar);
          }
        }
      }
    } catch (_error) {
      // Near-duplicate hints are advisory only.
    }
  }
  return [...names].slice(0, 2);
}

function normalizeBlockPomodoroThemeKey(value) {
  return asciiLowercasePomodoroText(String(value || "").trim().replace(/\s+/g, " "));
}

function blockPomodoroEntryThemeKeys(entry) {
  if (Array.isArray(entry && entry.componentKeys)) {
    return [...new Set(entry.componentKeys.map(normalizeBlockPomodoroThemeKey).filter(Boolean))];
  }
  return [...new Set(
    blockPomodoroThemeComponents(null, entry && entry.name)
      .map((component) => normalizeBlockPomodoroThemeKey(component.key))
      .filter(Boolean),
  )];
}

// Mirrors src/native/pomodoro_themes/preselect.rs. Inputs are detached,
// synchronous snapshots so opening/refreshing a menu never reruns suggestion
// resolution or reads configuration directly.
function chooseBlockPomodoroThemePreselection(input = {}) {
  const suggestion = input.suggestion && input.suggestion.theme
    ? input.suggestion.theme
    : input.suggestion;
  const key = normalizeBlockPomodoroThemeKey(suggestion && suggestion.key);
  if (!key) {
    return null;
  }
  if (input.alreadyQueued === true) {
    return { kind: "fallback", code: "already_queued" };
  }

  const exempt = new Set(
    (Array.isArray(input.exemptKeys) ? input.exemptKeys : input.exempt || [])
      .map(normalizeBlockPomodoroThemeKey)
      .filter(Boolean),
  );
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const exact = [];
  entries.forEach((entry, index) => {
    if (!entry || entry.open !== true) {
      return;
    }
    const components = new Set(
      blockPomodoroEntryThemeKeys(entry).filter((component) => component === key || !exempt.has(component)),
    );
    if (components.size === 1 && components.has(key)) {
      exact.push({ index, running: entry.running === true });
    }
  });

  if (suggestion.known === true) {
    const running = exact.find((candidate) => candidate.running);
    if (running) {
      return { kind: "entry", index: running.index };
    }
    if (exact.length > 0) {
      return { kind: "entry", index: exact[0].index };
    }
    const containing = entries.findIndex((entry) =>
      entry && entry.open === true && blockPomodoroEntryThemeKeys(entry).includes(key),
    );
    if (containing >= 0) {
      return { kind: "entry", index: containing };
    }
  }

  if (suggestion.known !== true) {
    return { kind: "fallback", code: "unknown_theme" };
  }
  if (input.creationAllowed !== true) {
    return { kind: "fallback", code: "creation_blocked" };
  }

  const ledgerKeys = new Set(
    (Array.isArray(input.ledgerKeys) ? input.ledgerKeys : [])
      .map(normalizeBlockPomodoroThemeKey)
      .filter(Boolean),
  );
  const addsTheme = !exempt.has(key) && !ledgerKeys.has(key);
  const strict = input.strict === true;
  const themesBefore = Number.isInteger(input.themesBefore) ? input.themesBefore : 0;
  const cap = Number.isInteger(input.maxThemes)
    ? input.maxThemes
    : Number.isInteger(input.cap)
      ? input.cap
      : Number.MAX_SAFE_INTEGER;
  if (strict && addsTheme && themesBefore + 1 > cap) {
    return { kind: "fallback", code: "strict_cap" };
  }
  return { kind: "create" };
}

function blockPomodoroThemeCatalogRow(api, key) {
  try {
    const normalized = normalizeBlockPomodoroThemeKey(key);
    const report = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    if (!normalized || !report || typeof report !== "object") {
      return null;
    }
    for (const rows of [report.themes, report.configured_themes]) {
      if (!Array.isArray(rows)) {
        continue;
      }
      const match = rows.find((row) =>
        row && normalizeBlockPomodoroThemeKey(row.key) === normalized,
      );
      if (match) {
        return match;
      }
    }
  } catch (_error) {
    // Catalog decoration is optional; keep the resolver's spelling.
  }
  return null;
}

function blockPomodoroThemeSuggestionForCatalog(api, semanticSuggestion, knownOverride) {
  try {
    if (!semanticSuggestion || typeof semanticSuggestion !== "object") {
      return null;
    }
    const suggestion = JSON.parse(JSON.stringify(semanticSuggestion));
    const refreshTheme = (theme) => {
      if (!theme || typeof theme !== "object") {
        return;
      }
      const catalog = blockPomodoroThemeCatalogRow(api, theme.key);
      if (catalog && typeof catalog.name === "string" && catalog.name) {
        theme.name = catalog.name;
      }
      if (catalog && typeof catalog.hue === "string") {
        theme.hue = catalog.hue;
      }
      if (catalog && typeof catalog.hue_source === "string") {
        theme.hue_source = catalog.hue_source;
      }

      let known = typeof knownOverride === "boolean" ? knownOverride : null;
      if (known === null && api && typeof api.isKnownTheme === "function") {
        try {
          const reported = api.isKnownTheme(theme.key);
          if (typeof reported === "boolean") {
            known = reported;
          }
        } catch (_error) {
          // Preserve the last safe knowledge snapshot below.
        }
      }
      if (known === null && catalog) {
        known = true;
      }
      if (known === null && typeof theme.known === "boolean") {
        known = theme.known;
      }
      if (typeof known === "boolean") {
        theme.known = known;
      }
    };
    refreshTheme(suggestion.theme);
    if (suggestion.source === "task" && suggestion.inherited && typeof suggestion.inherited === "object") {
      const inherited = blockPomodoroThemeSuggestionForCatalog(api, suggestion.inherited);
      if (inherited) {
        suggestion.inherited = inherited;
      }
    }
    return suggestion;
  } catch (_error) {
    return null;
  }
}

function refreshBlockPomodoroThemePickerSnapshot(model, api) {
  try {
    const snapshot = model && model.themeSnapshot;
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }
    const semanticSuggestion = snapshot.semanticSuggestion || snapshot.suggestion;
    if (!semanticSuggestion || typeof semanticSuggestion !== "object") {
      return false;
    }
    const suggestion = blockPomodoroThemeSuggestionForCatalog(api, semanticSuggestion);
    if (!suggestion || !suggestion.theme || typeof suggestion.theme.known !== "boolean") {
      return false;
    }
    const meter = snapshot.planMeter && snapshot.planMeter.themes;
    const choice = chooseBlockPomodoroThemePreselection({
      suggestion,
      entries: snapshot.entries,
      exemptKeys: snapshot.exemptKeys,
      ledgerKeys: snapshot.ledgerKeys,
      creationAllowed: Boolean(model.creation && model.creation.allowed),
      strict: snapshot.strict,
      themesBefore: meter && meter.count,
      maxThemes: snapshot.maxThemes,
      alreadyQueued: false,
    });
    if (!choice) {
      return false;
    }
    snapshot.suggestion = suggestion;
    snapshot.choice = choice;
    model.themeSuggestion = suggestion;
    model.themePreselection = choice;
    return true;
  } catch (_error) {
    return false;
  }
}

function getBlockPomodoroLedgerApi(app) {
  try {
    const plugins = app && app.plugins;
    const holder = plugins && plugins.plugins && plugins.plugins["bob-ledger-tools"]
      ? plugins.plugins["bob-ledger-tools"]
      : plugins && typeof plugins.getPlugin === "function"
        ? plugins.getPlugin("bob-ledger-tools")
        : null;
    return holder && holder.api ? holder.api : null;
  } catch (_error) {
    return null;
  }
}

function safeBlockPomodoroThemePickerSnapshot(app, model, task, meterSnapshot) {
  try {
    if (
      !task || typeof task.path !== "string" || !task.path ||
      !Number.isInteger(task.line) || task.line < 1 ||
      typeof task.text !== "string"
    ) {
      return null;
    }
    const themesApi = getBlockPomodoroThemesApi(app);
    const ledgerApi = getBlockPomodoroLedgerApi(app);
    if (
      !themesApi || typeof themesApi.suggestFor !== "function" ||
      !ledgerApi || typeof ledgerApi.caps !== "function" ||
      typeof ledgerApi.planBudget !== "function"
    ) {
      return null;
    }

    const rawSuggestion = themesApi.suggestFor({
      path: task.path,
      line: task.line,
      text: task.text,
    });
    if (!rawSuggestion || typeof rawSuggestion !== "object") {
      return null;
    }
    const semanticSuggestion = JSON.parse(JSON.stringify(rawSuggestion));
    if (
      !semanticSuggestion.theme || typeof semanticSuggestion.theme.key !== "string" ||
      !semanticSuggestion.theme.key || typeof semanticSuggestion.theme.name !== "string" ||
      !semanticSuggestion.theme.name
    ) {
      return null;
    }

    const rawCaps = ledgerApi.caps();
    const meter = meterSnapshot;
    if (
      !rawCaps || typeof rawCaps !== "object" || typeof rawCaps.then === "function" ||
      typeof rawCaps.strict !== "boolean" || !Array.isArray(rawCaps.exempt) ||
      !Number.isInteger(rawCaps.maxThemes) || rawCaps.maxThemes < 1 ||
      !meter || typeof meter !== "object" || typeof meter.then === "function" ||
      !meter.themes || !Number.isInteger(meter.themes.count) ||
      !Number.isInteger(meter.themes.cap)
    ) {
      return null;
    }
    const caps = {
      exemptKeys: rawCaps.exempt
        .map(normalizeBlockPomodoroThemeKey)
        .filter(Boolean),
      strict: rawCaps.strict,
      maxThemes: rawCaps.maxThemes,
    };
    let known = semanticSuggestion.theme.known === true;
    if (typeof themesApi.isKnownTheme === "function") {
      const reported = themesApi.isKnownTheme(semanticSuggestion.theme.key);
      if (typeof reported !== "boolean") {
        return null;
      }
      known = reported;
    } else if (semanticSuggestion.theme.known !== false) {
      return null;
    }
    const suggestion = blockPomodoroThemeSuggestionForCatalog(
      themesApi,
      semanticSuggestion,
      known,
    );
    if (!suggestion) {
      return null;
    }

    const entries = (Array.isArray(model && model.entries) ? model.entries : []).map((entry) => ({
      name: entry.name || null,
      open: true,
      running: entry.running === true,
      entryLine: entry.entryLine,
      componentKeys: blockPomodoroThemeComponents(themesApi, entry.name)
        .map((component) => normalizeBlockPomodoroThemeKey(component.key))
        .filter(Boolean),
    }));
    const ledgerKeys = [...new Set(entries.flatMap((entry) => entry.componentKeys))];
    const choice = chooseBlockPomodoroThemePreselection({
      suggestion,
      entries,
      exemptKeys: caps.exemptKeys,
      ledgerKeys,
      creationAllowed: Boolean(model && model.creation && model.creation.allowed),
      strict: caps.strict,
      themesBefore: meter.themes.count,
      maxThemes: caps.maxThemes,
      alreadyQueued: false,
    });
    if (!choice) {
      return null;
    }
    return {
      semanticSuggestion,
      suggestion,
      choice,
      entries,
      exemptKeys: caps.exemptKeys,
      strict: caps.strict,
      maxThemes: caps.maxThemes,
      planMeter: {
        themes: { count: meter.themes.count, cap: meter.themes.cap, over: meter.themes.over === true },
      },
      ledgerKeys,
    };
  } catch (_error) {
    // Optional theme APIs never make the base picker unavailable.
    return null;
  }
}

function blockPomodoroThemeRowKeys(row, snapshot) {
  if (row && row.kind === "existing" && snapshot && Array.isArray(snapshot.entries)) {
    const entry = snapshot.entries.find((candidate) => candidate.entryLine === row.entry.entryLine);
    if (entry) {
      return entry.componentKeys;
    }
  }
  if (row && row.kind === "recent" && row.theme && row.theme.key) {
    return [normalizeBlockPomodoroThemeKey(row.theme.key)];
  }
  return blockPomodoroThemeComponents(null, row && row.name)
    .map((component) => normalizeBlockPomodoroThemeKey(component.key))
    .filter(Boolean);
}

function markBlockPomodoroThemeSuggestion(row, suggestion) {
  if (!row || !suggestion) {
    return;
  }
  row.suggested = true;
  row.suggestionLabel = suggestion.label || "";
  row.themeSuggestion = suggestion;
}

function withPomodoroThemeHistoryRows(model, query, baseRows, selectedIndex, options = {}) {
  const api = options && options.themesApi;
  const snapshot = (model && model.themeSnapshot) || (options && options.themeSnapshot) || null;
  let rows = baseRows.slice();
  let nextSelectedIndex = selectedIndex;
  const trimmedQuery = String(query || "").trim();
  const suggestion = snapshot && snapshot.suggestion;
  const suggestionKey = normalizeBlockPomodoroThemeKey(suggestion && suggestion.theme && suggestion.theme.key);
  let preferredSuggestionKey = null;

  if (suggestion && suggestionKey) {
    if (!trimmedQuery && snapshot.choice && snapshot.choice.kind === "entry") {
      const selectedEntry = Array.isArray(snapshot.entries)
        ? snapshot.entries[snapshot.choice.index]
        : null;
      const matchingIndex = selectedEntry
        ? rows.findIndex((row) => row.kind === "existing" && row.entry.entryLine === selectedEntry.entryLine)
        : -1;
      if (matchingIndex >= 0) {
        nextSelectedIndex = matchingIndex;
        preferredSuggestionKey = rows[matchingIndex].key;
      }
    }

    if (!trimmedQuery && snapshot.choice && snapshot.choice.kind === "create") {
      const name = suggestion.theme.name;
      const createRow = {
        kind: "new",
        key: `new-${pomodoroLinkSelectorSlug(name)}`,
        selectable: true,
        name,
        againOf: null,
        anchorTitle: model.creation && model.creation.anchor ? model.creation.anchor.title : null,
        becomesNextUp: Boolean(model.creation && model.creation.becomesNextUp),
        preserveSpelling: true,
        suggestedCreate: true,
      };
      rows = [createRow, ...rows];
      nextSelectedIndex = 0;
      preferredSuggestionKey = createRow.key;
    }
  }

  const annotateSuggestion = (visibleRows) => {
    if (!suggestion || !suggestionKey) {
      return;
    }
    const matchableRows = visibleRows.filter((row) =>
      row.kind !== "new" || row.suggestedCreate || suggestion.theme.known === true,
    );
    const preferred = preferredSuggestionKey
      ? matchableRows.find((row) => row.key === preferredSuggestionKey)
      : null;
    const bestMatch = preferred || matchableRows.find((row) =>
        blockPomodoroThemeRowKeys(row, snapshot).includes(suggestionKey),
      );
    if (bestMatch) {
      markBlockPomodoroThemeSuggestion(bestMatch, suggestion);
    }
  };

  if (!model || !model.creation || model.creation.allowed !== true || !api) {
    annotateSuggestion(rows);
    return { rows, selectedIndex: nextSelectedIndex };
  }

  // Only themes the menu already shows as a Today row leave Recent; a done
  // Pomodoro is not a Today row here, so model.entries (open only) excludes
  // done and cancelled entries that model.allEntries still carries.
  const openToday = Array.isArray(model.entries) ? model.entries : [];
  const exclusions = blockPomodoroThemeKeysInToday(api, openToday);
  const suggestedCreate = rows.find((row) => row.suggestedCreate) || null;
  if (suggestedCreate && suggestionKey) {
    exclusions.add(suggestionKey);
  }
  const history = blockPomodoroThemeHistory(
    api,
    query,
    exclusions,
    options && options.hiddenRows,
  );
  const todayRows = rows.filter((row) => row.kind === "existing");
  const otherRows = rows.filter((row) => row.kind !== "existing" && row.kind !== "new");
  const candidate = rows.find((row) => row.kind === "new" && !row.suggestedCreate) || null;
  const candidateKey = candidate
    ? normalizeBlockPomodoroThemeKey(candidate.name)
    : "";
  const exactRecent = history.find((theme) => theme.key === candidateKey) || null;
  for (const row of [candidate, suggestedCreate].filter(Boolean)) {
    if (blockPomodoroThemeUnconfigured(api, row.name)) {
      row.unconfigured = true;
    }
    const similarTo = blockPomodoroThemeSimilar(api, row.name);
    if (similarTo.length > 0) {
      row.similarTo = similarTo;
    }
    const hiddenThemes = blockPomodoroThemeComponents(api, row.name)
      .map((component) => blockPomodoroThemeKnown(api, component.key))
      .filter((theme) => theme && theme.hidden === true);
    if (hiddenThemes.length > 0) {
      row.hiddenThemes = hiddenThemes;
    }
  }

  const recentRows = history.map((theme) => ({
    kind: "recent",
    key: `recent-${theme.key}`,
    selectable: true,
    name: theme.name,
    theme,
    hidden: theme.hidden === true,
  }));
  const prefixRows = recentRows.filter((row) => blockPomodoroThemeHistoryTier(row.theme, query) < 2);
  const substringRows = recentRows.filter((row) => blockPomodoroThemeHistoryTier(row.theme, query) === 2);
  const appendCandidate = candidate && !exactRecent ? [candidate] : [];
  const ordered = [
    ...(suggestedCreate ? [suggestedCreate] : []),
    ...todayRows,
    ...prefixRows,
    ...appendCandidate,
    ...substringRows,
    ...otherRows,
  ];
  const selectedKey = nextSelectedIndex >= 0 ? rows[nextSelectedIndex] && rows[nextSelectedIndex].key : null;
  const preservedIndex = selectedKey ? ordered.findIndex((row) => row.key === selectedKey) : -1;
  const firstSelectable = ordered.findIndex((row) => row.selectable);
  annotateSuggestion(ordered);
  return {
    rows: ordered,
    selectedIndex: preservedIndex >= 0 ? preservedIndex : firstSelectable,
  };
}

function blockPomodoroThemeHue(api, key, name) {
  try {
    const result = api && typeof api.hueFor === "function" ? api.hueFor(key, name) : null;
    return result && BLOCK_POMODORO_THEME_HUES.includes(result.hue) ? result.hue : null;
  } catch (_error) {
    return null;
  }
}

function renderBlockPomodoroThemeSwatches(host, api, name) {
  const components = blockPomodoroThemeComponents(api, name);
  if (!api || typeof api.hueFor !== "function" || components.length === 0) {
    return;
  }
  const group = host.createSpan({
    cls: "bid-ppk-theme-swatches",
    attr: { "aria-hidden": "true" },
  });
  for (const component of components) {
    const hue = blockPomodoroThemeHue(api, component.key, component.raw);
    group.createSpan({
      cls: `bid-ppk-theme-swatch${hue ? ` is-${hue}` : " is-muted"}`,
      attr: { title: component.raw },
    });
  }
}

function formatBlockPomodoroThemeRecentMeta(theme) {
  const date = String(theme && theme.last_used || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  let shortDate = "Recent";
  if (match) {
    shortDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const days = Math.max(0, Number(theme && theme.days_used) || 0);
  return `${shortDate} · ${days} ${days === 1 ? "day" : "days"}`;
}

function startBlockPomodoroThemePicker(modal) {
  const api = getBlockPomodoroThemesApi(modal && modal.app);
  if (!modal || !api) {
    return;
  }
  modal.themesApi = api;
  try {
    if (typeof api.onChange === "function") {
      modal.themesUnsubscribe = api.onChange(() => {
        if (!modal.settled) {
          modal.updateQuery(modal.query, "refresh");
        }
      });
    }
  } catch (_error) {
    modal.themesUnsubscribe = null;
  }
  if (blockPomodoroThemeAvailable(api) && typeof api.fetch === "function") {
    Promise.resolve(api.fetch())
      .then(() => {
        if (!modal.settled) {
          modal.updateQuery(modal.query, "refresh");
        }
      })
      .catch(() => {});
  }
}

function stopBlockPomodoroThemePicker(modal) {
  if (modal && typeof modal.themesUnsubscribe === "function") {
    try {
      modal.themesUnsubscribe();
    } catch (_error) {
      // Unsubscription is best effort during close.
    }
    modal.themesUnsubscribe = null;
  }
}

async function toggleBlockPomodoroThemeVisibility(modal) {
  const row = modal && modal.rows && modal.rows[modal.selectedIndex];
  const api = modal && modal.themesApi;
  if (!row) {
    return;
  }
  if (row.kind === "existing") {
    new Notice("Today's Pomodoros stay visible; Ctrl+D hides Recent themes");
    return;
  }
  // The suggested create row is the picker's current recommendation: Ctrl+D
  // is consumed without hide/unhide calls, including a hidden suggestion.
  if (row.suggestedCreate === true) {
    new Notice("Suggested Pomodoros stay put; Ctrl+D hides Recent themes only");
    return;
  }
  const hiddenNames = row.kind === "recent" && row.hidden
    ? [row.name]
    : row.kind === "new"
      ? (row.hiddenThemes || []).map((theme) => theme.name).filter(Boolean)
      : [];
  const hideName = row.kind === "recent" && !row.hidden ? row.name : null;
  const method = hideName ? "hide" : hiddenNames.length ? "unhide" : null;
  if (!method || !api || typeof api[method] !== "function") {
    new Notice("Ctrl+D hides Recent themes; this row has nothing to change");
    return;
  }
  if (modal.themeWriteInFlight) {
    return;
  }
  modal.themeWriteInFlight = true;
  try {
    const names = hideName ? [hideName] : hiddenNames;
    const results = await Promise.all(names.map((name) => api[method](name)));
    const failure = results.find((result) => !result || result.ok !== true);
    if (failure) {
      new Notice(failure.message || "Could not update the theme suggestion");
      return;
    }
    if (method === "hide") {
      const theme = row.theme || {};
      modal.hiddenThemeRows.set(theme.key || row.name, { ...theme, key: theme.key, name: row.name, hidden: true });
    } else {
      for (const [key, hidden] of modal.hiddenThemeRows) {
        if (hiddenNames.includes(hidden.name)) {
          modal.hiddenThemeRows.delete(key);
        }
      }
    }
    modal.updateQuery(modal.query, "refresh");
    const selectedIndex = modal.rows.findIndex((candidate) => candidate.key === row.key);
    if (selectedIndex >= 0) {
      modal.selectedIndex = selectedIndex;
      modal.renderRows();
    }
  } catch (_error) {
    new Notice("Could not update the theme suggestion");
  } finally {
    modal.themeWriteInFlight = false;
  }
}
