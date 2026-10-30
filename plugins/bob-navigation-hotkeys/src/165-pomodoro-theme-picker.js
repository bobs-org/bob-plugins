// Recent task type rows shared by nav's Pomodoro move and rename pickers.
// Ledger Tools api.themes owns catalog scanning, ranking, hue, and writes.
const NAV_POMODORO_THEME_HUES = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];

const POMODORO_BULLET_MOVE_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["^D"], label: "Hide / undo" },
  { keys: ["↵"], label: "Move" },
  { keys: ["⌥↵"], label: "Keep types" },
  { keys: ["⇥"], label: "Cycle type" },
  { keys: ["esc"], label: "Dismiss" },
];

function preserveNavigationPomodoroThemeName(raw) {
  const validated = normalizePomodoroName(raw);
  if (!validated.valid) {
    return validated;
  }
  return {
    valid: true,
    name: String(raw || "").replace(/\s+/g, " ").trim(),
    error: null,
  };
}

function getNavigationPomodoroThemesApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api = plugins && plugins["bob-ledger-tools"] && plugins["bob-ledger-tools"].api;
    const themes = api && api.themes;
    return themes && themes.version >= 1 ? themes : null;
  } catch (_error) {
    return null;
  }
}

function navigationPomodoroThemeAvailable(api) {
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

function navigationPomodoroThemeComponents(api, name) {
  try {
    if (api && typeof api.typeComponentsOf === "function") {
      const rows = api.typeComponentsOf(name);
      if (Array.isArray(rows)) {
        const mapped = [];
        for (const row of rows) {
          if (row && typeof row.name === "string" && typeof row.key === "string") {
            mapped.push({ raw: row.name, key: row.key });
          }
        }
        return mapped;
      }
    }
  } catch (_error) {
    // Theme display remains optional.
  }
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
    // Theme display remains optional.
  }
  return String(name || "")
    .split("+")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      key: raw.toLowerCase().replace(/\s+/g, " "),
    }));
}

function navigationPomodoroThemeKeysInToday(api, entries) {
  const keys = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const component of navigationPomodoroThemeComponents(api, entry && entry.name)) {
      if (component.key) {
        keys.add(component.key);
      }
    }
  }
  return keys;
}

function navigationPomodoroThemeConfiguredRows(api) {
  try {
    const report = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    return Array.isArray(report && report.configured_themes)
      ? report.configured_themes
      : null;
  } catch (_error) {
    return null;
  }
}

function navigationPomodoroThemeInVocabulary(api, key) {
  const rows = navigationPomodoroThemeConfiguredRows(api);
  return rows ? rows.some((theme) => theme && theme.key === key) : null;
}

function navigationPomodoroThemeUnconfiguredNames(api, name) {
  try {
    const seen = new Set();
    return navigationPomodoroThemeComponents(api, name).filter((component) => {
      if (seen.has(component.key)) {
        return false;
      }
      seen.add(component.key);
      if (api && typeof api.isConfigured === "function") {
        return api.isConfigured(component.key) === false;
      }
      return navigationPomodoroThemeInVocabulary(api, component.key) === false;
    }).map((component) => component.raw);
  } catch (_error) {
    return [];
  }
}

function navigationPomodoroThemeUnconfigured(api, name) {
  return navigationPomodoroThemeUnconfiguredNames(api, name).length > 0;
}

function navigationPomodoroThemeSlug(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function navigationPomodoroThemeTier(theme, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return 0;
  }
  const queryKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  const querySlug = navigationPomodoroThemeSlug(trimmed);
  const key = String(theme && theme.key || "");
  const slug = navigationPomodoroThemeSlug(theme && theme.name);
  if (key === queryKey || slug === querySlug) {
    return 0;
  }
  if ((queryKey && key.startsWith(queryKey)) || (querySlug && slug.startsWith(querySlug))) {
    return 1;
  }
  return 2;
}

function navigationPomodoroThemeMatchesQuery(theme, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return true;
  }
  const queryKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  const querySlug = navigationPomodoroThemeSlug(trimmed);
  return String(theme && theme.key || "").includes(queryKey) ||
    navigationPomodoroThemeSlug(theme && theme.name).includes(querySlug);
}

function navigationPomodoroThemeCompareRecent(left, right) {
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

function navigationPomodoroThemeHistory(api, query, exclusions, hiddenRows) {
  if (!navigationPomodoroThemeAvailable(api) || typeof api.historyRows !== "function") {
    return [];
  }
  const trimmed = String(query || "").trim();
  const configuredRows = navigationPomodoroThemeConfiguredRows(api);
  const configuredOrder = configuredRows
    ? new Map(configuredRows.map((theme, index) => [theme.key, index]))
    : null;
  const configuredKeys = configuredRows
    ? new Set(configuredRows.map((theme) => theme.key))
    : null;
  const limit = trimmed || configuredRows ? 12 : 5;
  let visible = [];
  try {
    visible = api.historyRows({ query: trimmed, limit: 100, exclusions });
  } catch (_error) {
    visible = [];
  }
  const byKey = new Map();
  for (const theme of Array.isArray(visible) ? visible : []) {
    if (
      theme && theme.key && theme.name && !exclusions.has(theme.key) &&
      (!configuredKeys || configuredKeys.has(theme.key)) &&
      (!configuredRows || navigationPomodoroThemeMatchesQuery(theme, trimmed))
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
        navigationPomodoroThemeMatchesQuery(theme, trimmed)
      ) {
        byKey.set(key, { ...theme, hidden: true });
      }
    }
  }
  return [...byKey.values()]
    .sort((left, right) => {
      const tier = navigationPomodoroThemeTier(left, trimmed) - navigationPomodoroThemeTier(right, trimmed);
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
      return navigationPomodoroThemeCompareRecent(left, right);
    })
    .slice(0, limit);
}

function navigationPomodoroThemeKnown(api, key) {
  try {
    const report = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    const themes = report && Array.isArray(report.themes) ? report.themes : [];
    return themes.find((theme) => theme && theme.key === key) || null;
  } catch (_error) {
    return null;
  }
}

function navigationPomodoroThemeSimilar(api, name) {
  if (!api || typeof api.similarTo !== "function") {
    return [];
  }
  const names = new Set();
  const configuredRows = navigationPomodoroThemeConfiguredRows(api);
  const configuredNames = configuredRows
    ? new Set(configuredRows.map((theme) => theme && theme.key).filter(Boolean))
    : null;
  for (const component of navigationPomodoroThemeComponents(api, name)) {
    try {
      for (const similar of api.similarTo(component.raw) || []) {
        if (typeof similar === "string" && similar) {
          const key = similar.trim().replace(/\s+/g, " ").toLowerCase();
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

function withNavigationPomodoroThemeRows(entries, query, baseRows, options = {}) {
  if (String(query || "").startsWith("=")) {
    return baseRows;
  }
  const api = options && options.themesApi;
  const exclusions = navigationPomodoroThemeKeysInToday(api, entries);
  const history = navigationPomodoroThemeHistory(
    api,
    query,
    exclusions,
    options && options.hiddenRows,
  );
  const todayRows = baseRows.filter((row) => row.kind === "existing");
  const candidateSource = baseRows.find((row) => row.kind === "new" || row.kind === "rename") || null;
  const candidate = candidateSource ? { ...candidateSource } : null;
  const otherRows = baseRows.filter((row) => row.kind !== "existing" && row !== candidateSource);
  const candidateKey = candidate
    ? candidate.name.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
  const exactRecent = history.find((theme) => theme.key === candidateKey) || null;
  if (candidate) {
    if (navigationPomodoroThemeUnconfigured(api, candidate.name)) {
      candidate.unconfigured = true;
    }
    const similarTo = navigationPomodoroThemeSimilar(api, candidate.name);
    if (similarTo.length > 0) {
      candidate.similarTo = similarTo;
    }
    const hiddenThemes = navigationPomodoroThemeComponents(api, candidate.name)
      .map((component) => navigationPomodoroThemeKnown(api, component.key))
      .filter((theme) => theme && theme.hidden === true);
    if (hiddenThemes.length > 0) {
      candidate.hiddenThemes = hiddenThemes;
    }
  }
  const operation = options && options.mode === "entry" ? "rename" : "new";
  const recentRows = history.map((theme) => ({
    kind: "recent",
    key: `recent-${theme.key}`,
    name: theme.name,
    theme,
    operation,
    hidden: theme.hidden === true,
    title: operation === "rename" ? `Rename to ${theme.name}` : `New Pomodoro ${theme.name}`,
    meta: formatNavigationPomodoroThemeRecentMeta(theme),
    badge: "Recent",
  }));
  const prefixRows = recentRows.filter((row) => navigationPomodoroThemeTier(row.theme, query) < 2);
  const substringRows = recentRows.filter((row) => navigationPomodoroThemeTier(row.theme, query) === 2);
  const ordered = [
    ...todayRows,
    ...prefixRows,
    ...(candidate && !exactRecent ? [candidate] : []),
    ...substringRows,
    ...otherRows,
  ];
  return ordered;
}

function formatNavigationPomodoroThemeRecentMeta(theme) {
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

function navigationPomodoroThemeHue(api, key, name) {
  try {
    const result = api && typeof api.hueFor === "function" ? api.hueFor(key, name) : null;
    return result && NAV_POMODORO_THEME_HUES.includes(result.hue) ? result.hue : null;
  } catch (_error) {
    return null;
  }
}

function renderNavigationPomodoroThemeSwatches(host, api, name) {
  const components = navigationPomodoroThemeComponents(api, name);
  if (!api || typeof api.hueFor !== "function" || components.length === 0) {
    return;
  }
  const group = host.createSpan({
    cls: "bob-cnp-theme-swatches",
    attr: { "aria-hidden": "true" },
  });
  for (const component of components) {
    const hue = navigationPomodoroThemeHue(api, component.key, component.raw);
    group.createSpan({
      cls: `bob-cnp-theme-swatch${hue ? ` is-${hue}` : " is-muted"}`,
      attr: { title: component.raw },
    });
  }
}

function startNavigationPomodoroThemePicker(modal) {
  const api = getNavigationPomodoroThemesApi(modal && modal.app);
  if (!modal || !api) {
    return;
  }
  modal.themesApi = api;
  try {
    if (typeof api.onChange === "function") {
      modal.themesUnsubscribe = api.onChange(() => {
        if (modal.pickerOpen) {
          modal.renderResults();
        }
      });
    }
  } catch (_error) {
    modal.themesUnsubscribe = null;
  }
  if (navigationPomodoroThemeAvailable(api) && typeof api.fetch === "function") {
    Promise.resolve(api.fetch())
      .then(() => {
        if (modal.pickerOpen) {
          modal.renderResults();
        }
      })
      .catch(() => {});
  }
}

function stopNavigationPomodoroThemePicker(modal) {
  if (modal && typeof modal.themesUnsubscribe === "function") {
    try {
      modal.themesUnsubscribe();
    } catch (_error) {
      // Unsubscription is best effort during close.
    }
    modal.themesUnsubscribe = null;
  }
}

async function toggleNavigationPomodoroThemeVisibility(modal) {
  const row = modal && modal.visibleItems && modal.visibleItems[modal.selectedIndex];
  const api = modal && modal.themesApi;
  if (!row) {
    return;
  }
  if (row.kind === "existing") {
    new Notice("Today's Pomodoros stay visible; Ctrl+D hides Recent types");
    return;
  }
  const hiddenNames = row.kind === "recent" && row.hidden
    ? [row.name]
    : row.kind === "new" || row.kind === "rename"
      ? (row.hiddenThemes || []).map((theme) => theme.name).filter(Boolean)
      : [];
  const hideName = row.kind === "recent" && !row.hidden ? row.name : null;
  const method = hideName ? "hide" : hiddenNames.length ? "unhide" : null;
  if (!method || !api || typeof api[method] !== "function") {
    new Notice("Ctrl+D hides Recent types; this row has nothing to change");
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
      new Notice(failure.message || "Could not update the type suggestion");
      return;
    }
    if (method === "hide") {
      const theme = row.theme || {};
      modal.hiddenThemeRows.set(theme.key || row.name, {
        ...theme,
        key: theme.key,
        name: row.name,
        hidden: true,
      });
    } else {
      for (const [key, hidden] of modal.hiddenThemeRows) {
        if (hiddenNames.includes(hidden.name)) {
          modal.hiddenThemeRows.delete(key);
        }
      }
    }
    modal.renderResults();
    const selectedIndex = modal.visibleItems.findIndex((candidate) => candidate.key === row.key);
    if (selectedIndex >= 0) {
      modal.selectedIndex = selectedIndex;
      modal.renderResults();
    }
  } catch (_error) {
    new Notice("Could not update the type suggestion");
  } finally {
    modal.themeWriteInFlight = false;
  }
}

function handleNavigationPomodoroThemeKeydown(modal, event) {
  if (!isCtrlKey(event, "d")) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  void toggleNavigationPomodoroThemeVisibility(modal);
  return true;
}
