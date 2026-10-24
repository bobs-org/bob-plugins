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
  const limit = trimmed ? 12 : 5;
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
    if (theme && theme.key && theme.name && !exclusions.has(theme.key)) {
      byKey.set(theme.key, theme);
    }
  }
  if (hiddenRows instanceof Map) {
    for (const [key, theme] of hiddenRows) {
      if (theme && theme.name && !exclusions.has(key) && blockPomodoroThemeMatchesQuery(theme, trimmed)) {
        byKey.set(key, { ...theme, hidden: true });
      }
    }
  }
  return [...byKey.values()]
    .sort((left, right) => {
      const tier = blockPomodoroThemeHistoryTier(left, trimmed) - blockPomodoroThemeHistoryTier(right, trimmed);
      return tier || blockPomodoroThemeCompareRecent(left, right);
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
  for (const component of blockPomodoroThemeComponents(api, name)) {
    try {
      for (const similar of api.similarTo(component.raw) || []) {
        if (typeof similar === "string" && similar) {
          names.add(similar);
        }
      }
    } catch (_error) {
      // Near-duplicate hints are advisory only.
    }
  }
  return [...names].slice(0, 2);
}

function withPomodoroThemeHistoryRows(model, query, baseRows, selectedIndex, options = {}) {
  const api = options && options.themesApi;
  if (!model || !model.creation || model.creation.allowed !== true) {
    return { rows: baseRows, selectedIndex };
  }
  const allToday = Array.isArray(model.allEntries) ? model.allEntries : model.entries;
  const exclusions = blockPomodoroThemeKeysInToday(api, allToday);
  const history = blockPomodoroThemeHistory(
    api,
    query,
    exclusions,
    options && options.hiddenRows,
  );
  const todayRows = baseRows.filter((row) => row.kind === "existing");
  const otherRows = baseRows.filter((row) => row.kind !== "existing" && row.kind !== "new");
  const candidate = baseRows.find((row) => row.kind === "new") || null;
  const candidateKey = candidate
    ? asciiLowercasePomodoroText(candidate.name.replace(/\s+/g, " "))
    : "";
  const exactRecent = history.find((theme) => theme.key === candidateKey) || null;
  if (candidate) {
    const similarTo = blockPomodoroThemeSimilar(api, candidate.name);
    if (similarTo.length > 0) {
      candidate.similarTo = similarTo;
    }
    const hiddenThemes = blockPomodoroThemeComponents(api, candidate.name)
      .map((component) => blockPomodoroThemeKnown(api, component.key))
      .filter((theme) => theme && theme.hidden === true);
    if (hiddenThemes.length > 0) {
      candidate.hiddenThemes = hiddenThemes;
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
    ...todayRows,
    ...prefixRows,
    ...appendCandidate,
    ...substringRows,
    ...otherRows,
  ];
  const selectedRow = selectedIndex >= 0 ? baseRows[selectedIndex] : null;
  const nextIndex = selectedRow && selectedRow.kind === "existing"
    ? ordered.findIndex((row) => row.key === baseRows[selectedIndex]?.key)
    : -1;
  return {
    rows: ordered,
    selectedIndex:
      nextIndex >= 0
        ? nextIndex
        : ordered.findIndex((row) => row.selectable) >= 0
          ? ordered.findIndex((row) => row.selectable)
          : -1,
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
          modal.updateQuery(modal.query);
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
          modal.updateQuery(modal.query);
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
    modal.updateQuery(modal.query);
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
