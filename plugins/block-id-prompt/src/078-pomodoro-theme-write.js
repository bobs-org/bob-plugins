// Guarded task-theme write for Link to today (plan:202610/task_theme_link_picker.md
// guarded-theme-write). Pure helpers: revalidate the shown suggestion, apply
// the Ledger Tools write rule and setters, and attach notice metadata. The
// 120 mixin stays a thin call site.
function pomodoroPlanDestinationName(pomodoroPlan) {
  try {
    const destination = pomodoroPlan && pomodoroPlan.destination;
    if (!destination || typeof destination !== "object") {
      return null;
    }
    const name = destination.name;
    return typeof name === "string" && name.trim() ? name : null;
  } catch (_error) {
    return null;
  }
}

function emptyPomodoroThemeWrite() {
  return { themeEdit: null, suggestionChanged: false, destinationThemeName: null };
}

function pomodoroThemeSuggestionIdentity(suggestion) {
  try {
    if (!suggestion || typeof suggestion !== "object") {
      return null;
    }
    const theme = suggestion.theme && typeof suggestion.theme === "object"
      ? suggestion.theme
      : null;
    const key = theme && typeof theme.key === "string" && theme.key
      ? normalizeBlockPomodoroThemeKey(theme.key)
      : null;
    if (!key) {
      return null;
    }
    const source = typeof suggestion.source === "string" ? suggestion.source : "";
    const repair = suggestion.repair === "duplicate" || suggestion.repair === "invalid"
      ? suggestion.repair
      : null;
    const from = suggestion.from && typeof suggestion.from === "object"
      ? suggestion.from
      : null;
    const fromPath = from && typeof from.path === "string" ? from.path : null;
    const fromStem = from && typeof from.stem === "string" ? from.stem : null;
    const fromKind = from && typeof from.kind === "string" ? from.kind : null;
    const fromChain = from && Array.isArray(from.chain)
      ? from.chain.map((item) => String(item))
      : null;
    const inherited = source === "task"
      ? (suggestion.inherited == null
        ? null
        : pomodoroThemeSuggestionIdentity(suggestion.inherited))
      : null;
    return {
      key,
      source,
      repair,
      fromPath,
      fromStem,
      fromKind,
      fromChain,
      inherited,
    };
  } catch (_error) {
    return null;
  }
}

function pomodoroThemeSuggestionsMatch(left, right) {
  if (left == null && right == null) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (
    left.key !== right.key ||
    left.source !== right.source ||
    left.repair !== right.repair ||
    left.fromPath !== right.fromPath ||
    left.fromStem !== right.fromStem ||
    left.fromKind !== right.fromKind
  ) {
    return false;
  }
  const leftChain = left.fromChain;
  const rightChain = right.fromChain;
  if (Array.isArray(leftChain) !== Array.isArray(rightChain)) {
    return false;
  }
  if (Array.isArray(leftChain)) {
    if (leftChain.length !== rightChain.length) {
      return false;
    }
    for (let index = 0; index < leftChain.length; index += 1) {
      if (leftChain[index] !== rightChain[index]) {
        return false;
      }
    }
  }
  return pomodoroThemeSuggestionsMatch(left.inherited, right.inherited);
}

function pomodoroThemeCatalogSpelling(themesApi, key, fallback) {
  const normalized = normalizeBlockPomodoroThemeKey(key);
  const fallbackName = typeof fallback === "string" && fallback ? fallback : null;
  if (!normalized) {
    return fallbackName;
  }
  try {
    if (!themesApi || typeof themesApi.snapshot !== "function") {
      return fallbackName;
    }
    const snapshot = themesApi.snapshot();
    const lists = [];
    if (snapshot && Array.isArray(snapshot.themes)) {
      lists.push(snapshot.themes);
    }
    if (snapshot && Array.isArray(snapshot.configured_themes)) {
      lists.push(snapshot.configured_themes);
    }
    for (const list of lists) {
      for (const theme of list) {
        if (!theme || typeof theme !== "object") {
          continue;
        }
        if (normalizeBlockPomodoroThemeKey(theme.key) !== normalized) {
          continue;
        }
        if (typeof theme.name === "string" && theme.name) {
          return theme.name;
        }
      }
    }
  } catch (_error) {
    return fallbackName;
  }
  return fallbackName;
}

function pomodoroThemeWriteInherited(shown) {
  if (!shown || typeof shown !== "object") {
    return null;
  }
  if (shown.source === "task") {
    return shown.inherited && typeof shown.inherited === "object"
      ? shown.inherited
      : null;
  }
  return shown;
}

function pomodoroThemeWriteExemptKeys(ledgerApi) {
  try {
    if (!ledgerApi || typeof ledgerApi.caps !== "function") {
      return [];
    }
    const caps = ledgerApi.caps();
    return caps && Array.isArray(caps.exempt) ? caps.exempt : [];
  } catch (_error) {
    return [];
  }
}

function pomodoroThemeWriteLineText(taskContent, line) {
  if (typeof taskContent !== "string" || !Number.isInteger(line) || line < 0) {
    return "";
  }
  const lines = taskContent.split("\n");
  return line < lines.length ? lines[line] : "";
}

function resolvePomodoroLinkThemeWrite(plugin, source, pomodoroPlan, taskContent) {
  try {
    const intent = normalizePomodoroLinkPickerThemeIntent(
      source && source.pomodoroTarget && source.pomodoroTarget.themeIntent,
    );
    if (!intent || intent.linkOnce === true || intent.deliberate !== true || !intent.shown) {
      return emptyPomodoroThemeWrite();
    }
    const destinationName = pomodoroPlanDestinationName(pomodoroPlan);
    if (!destinationName) {
      return emptyPomodoroThemeWrite();
    }
    const themesApi = getBlockPomodoroThemesApi(plugin && plugin.app);
    const ledgerApi = getBlockPomodoroLedgerApi(plugin && plugin.app);
    if (
      !themesApi ||
      typeof themesApi.suggestFor !== "function" ||
      typeof themesApi.taskThemeOf !== "function" ||
      typeof themesApi.planThemeChange !== "function" ||
      typeof themesApi.setTaskTheme !== "function" ||
      typeof themesApi.clearTaskTheme !== "function"
    ) {
      return emptyPomodoroThemeWrite();
    }
    const path = source && typeof source.sourcePath === "string" ? source.sourcePath : "";
    const oneBasedLine = Number.isInteger(source && source.line) ? source.line + 1 : 0;
    const text = typeof taskContent === "string" ? taskContent : "";
    if (!path || oneBasedLine < 1) {
      return emptyPomodoroThemeWrite();
    }
    let current = null;
    try {
      current = themesApi.suggestFor({ path, line: oneBasedLine, text });
    } catch (_error) {
      return { themeEdit: null, suggestionChanged: true, destinationThemeName: null };
    }
    const shownIdentity = pomodoroThemeSuggestionIdentity(intent.shown);
    const currentIdentity = pomodoroThemeSuggestionIdentity(current);
    if (!pomodoroThemeSuggestionsMatch(shownIdentity, currentIdentity)) {
      return { themeEdit: null, suggestionChanged: true, destinationThemeName: null };
    }
    const lineText = pomodoroThemeWriteLineText(text, source.line);
    let field = null;
    try {
      field = themesApi.taskThemeOf(lineText);
    } catch (_error) {
      return emptyPomodoroThemeWrite();
    }
    if (!field || typeof field !== "object") {
      return emptyPomodoroThemeWrite();
    }
    const inherited = pomodoroThemeWriteInherited(intent.shown);
    let change = null;
    try {
      change = themesApi.planThemeChange({
        field,
        suggestion: intent.shown,
        inherited,
        destinationName,
        exemptKeys: pomodoroThemeWriteExemptKeys(ledgerApi),
        deliberate: true,
      });
    } catch (_error) {
      return emptyPomodoroThemeWrite();
    }
    if (!change || (change.action !== "set" && change.action !== "clear")) {
      return emptyPomodoroThemeWrite();
    }
    if (change.action === "set") {
      const name = pomodoroThemeCatalogSpelling(themesApi, change.key, change.name);
      if (!name) {
        return emptyPomodoroThemeWrite();
      }
      return {
        themeEdit: {
          action: "set",
          name,
          apply: (line) => themesApi.setTaskTheme(line, name),
        },
        suggestionChanged: false,
        destinationThemeName: name,
      };
    }
    const inheritedTheme = inherited && inherited.theme && typeof inherited.theme === "object"
      ? inherited.theme
      : intent.shown.theme;
    const destinationThemeName = pomodoroThemeCatalogSpelling(
      themesApi,
      inheritedTheme && inheritedTheme.key,
      inheritedTheme && inheritedTheme.name,
    );
    return {
      themeEdit: {
        action: "clear",
        name: null,
        apply: (line) => themesApi.clearTaskTheme(line),
      },
      suggestionChanged: false,
      destinationThemeName,
    };
  } catch (_error) {
    return emptyPomodoroThemeWrite();
  }
}

function attachPomodoroLinkThemeOutcome(plan, themeWrite) {
  if (!plan) {
    return plan;
  }
  const write = themeWrite && typeof themeWrite === "object"
    ? themeWrite
    : emptyPomodoroThemeWrite();
  plan.themeSuggestionChanged = write.suggestionChanged === true;
  plan.themeDestinationName = typeof write.destinationThemeName === "string"
    && write.destinationThemeName
    ? write.destinationThemeName
    : null;
  return plan;
}

function formatPomodoroThemeLinkChip(plan) {
  try {
    if (!plan || typeof plan !== "object") {
      return "";
    }
    if (plan.themeChanged === true && plan.themeAction === "clear") {
      return " · task theme cleared";
    }
    if (plan.themeChanged === true && plan.themeAction === "set" && plan.themeName) {
      return ` · task theme ${plan.themeName}`;
    }
    if (plan.themeSuggestionChanged === true) {
      return " · task theme unchanged (suggestion changed)";
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function pomodoroThemePartialFailureClause(plan) {
  try {
    if (!plan || plan.themeChanged !== true) {
      return null;
    }
    if (plan.themeAction === "clear") {
      return "task theme cleared";
    }
    if (typeof plan.themeName === "string" && plan.themeName) {
      return `task theme ${plan.themeName} saved`;
    }
    return "task theme saved";
  } catch (_error) {
    return null;
  }
}
