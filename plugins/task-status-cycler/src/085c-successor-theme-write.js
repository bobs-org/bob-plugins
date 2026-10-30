// Guarded successor theme writes (plan:202610/task_card_successor_themes.md
// successor-theme-write). Pure planner + runtime adapters. Shared scope with
// 085-successor-plan.js / 089b-successor-verdicts.js. The wiring in
// 137-plugin-successor-project.js supplies ledger-tools APIs.
function successorThemeNormalizeKey(value) {
  return String(value || "")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

function emptySuccessorThemeWrite() {
  return { themeEdit: null, suggestionChanged: false, destinationThemeName: null };
}

// Pick each successor's default entry by its effective task type (D7).
// Explicit picker destinations remain authoritative. The returned override
// is an insertion-plan input derived from the same staged daily lines.
function successorOfferTypedDestination(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const destination = successorOfferDestination(
    opts.anchor,
    opts.implicit,
    opts.dailyLines,
    opts.dailyPath,
  );
  const result = { destination, placementOverride: null, refusal: null };
  const themesApi = opts.themesApi;
  const task = opts.task && typeof opts.task === "object" ? opts.task : null;
  const taskPath = task && typeof task.path === "string" ? task.path : "";
  const taskLine = Number.isInteger(task && task.line) ? task.line : null;
  const noteText = typeof opts.noteText === "string" ? opts.noteText : null;
  if (!themesApi || !taskPath || taskLine == null || taskLine < 0 || noteText == null) {
    return result;
  }
  const dailyLines = Array.isArray(opts.dailyLines)
    ? opts.dailyLines.map((line) => String(line ?? ""))
    : String(opts.dailyLines ?? "").split(/\r?\n/);
  const explicit = normalizeSuccessorPickDestination(opts.explicitOverride);
  if (explicit) {
    if (explicit.kind === "new") {
      result.destination = {
        day_file: String(opts.dailyPath || ""),
        entry_name: explicit.name,
        entry_role: "created",
        fallback: false,
      };
      return result;
    }
    const entry = parseSuccessorLedgerEntries(dailyLines).find(
      (item) => item.entryLine === explicit.entryLine && item.open &&
        String(dailyLines[item.entryLine] || "").replace(/\r$/, "") === explicit.entryText,
    );
    if (entry) {
      result.destination = {
        day_file: String(opts.dailyPath || ""),
        entry_name: String(entry.name || ""),
        entry_role: "typed",
        fallback: false,
      };
      return result;
    }
  }
  let suggestion = null;
  try {
    suggestion = typeof themesApi.effectiveTypeFor === "function"
      ? themesApi.effectiveTypeFor({ path: taskPath, line: taskLine + 1, text: noteText })
      : null;
  } catch (_error) {
    suggestion = null;
  }
  const theme = suggestion && suggestion.theme && typeof suggestion.theme === "object"
    ? suggestion.theme
    : null;
  const typeKey = theme && typeof theme.key === "string" ? theme.key : "";
  if (!typeKey) {
    return result;
  }
  try {
    if (typeof themesApi.typeAgrees === "function" &&
        themesApi.typeAgrees(typeKey, destination.entry_name)) {
      return result;
    }
  } catch (_error) {
    return result;
  }
  let entries = [];
  try {
    entries = parseSuccessorLedgerEntries(dailyLines).map((entry) => {
      const parts = parsePomodoroEntryLineParts(String(dailyLines[entry.entryLine] || ""));
      return {
        name: entry.name,
        open: entry.open === true,
        running: entry.open === true && !!parts && parts.placeholder !== true,
      };
    });
  } catch (_error) {
    return result;
  }
  let placed = null;
  try {
    placed = typeof themesApi.planPlacement === "function"
      ? themesApi.planPlacement({
        type: typeKey,
        typeName: typeof theme.name === "string" ? theme.name : typeKey,
        entries,
        alreadyQueued: false,
        path: taskPath,
        text: noteText,
      })
      : null;
  } catch (_error) {
    placed = null;
  }
  if (!placed || typeof placed !== "object") {
    return result;
  }
  if (placed.kind === "entry" && Number.isInteger(placed.index) && entries[placed.index]) {
    const target = parseSuccessorLedgerEntries(dailyLines)[placed.index];
    if (!target || !target.open) {
      return result;
    }
    const anchorLine = opts.anchor && Number.isInteger(opts.anchor.entryLine)
      ? opts.anchor.entryLine
      : opts.implicit && Number.isInteger(opts.implicit.entryLine)
        ? opts.implicit.entryLine
        : null;
    if (anchorLine === target.entryLine) {
      return result;
    }
    result.destination = {
      day_file: String(opts.dailyPath || ""),
      entry_name: String(target.name || ""),
      entry_role: "typed",
      fallback: false,
    };
    result.placementOverride = {
      kind: "existing",
      entryLine: target.entryLine,
      entryText: String(dailyLines[target.entryLine] || "").replace(/\r$/, ""),
    };
    return result;
  }
  if (placed.kind === "create") {
    const name = typeof placed.name === "string" && placed.name
      ? placed.name
      : (typeof theme.name === "string" ? theme.name : typeKey);
    result.destination = {
      day_file: String(opts.dailyPath || ""),
      entry_name: name,
      entry_role: "created",
      fallback: false,
    };
    result.placementOverride = { kind: "new", name };
    return result;
  }
  if (placed.kind === "refused") {
    result.destination = {
      day_file: String(opts.dailyPath || ""),
      entry_name: typeof theme.name === "string" ? theme.name : typeKey,
      entry_role: "created",
      fallback: false,
    };
    result.refusal = "strict_cap";
  }
  return result;
}

function successorThemeSuggestionIdentity(suggestion) {
  try {
    if (!suggestion || typeof suggestion !== "object") {
      return null;
    }
    const theme = suggestion.theme && typeof suggestion.theme === "object"
      ? suggestion.theme
      : null;
    const key = theme && typeof theme.key === "string" && theme.key
      ? successorThemeNormalizeKey(theme.key)
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
        : successorThemeSuggestionIdentity(suggestion.inherited))
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

function successorThemeSuggestionsMatch(left, right) {
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
  return successorThemeSuggestionsMatch(left.inherited, right.inherited);
}

function successorThemeCatalogSpelling(themesApi, key, fallback) {
  const normalized = successorThemeNormalizeKey(key);
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
        if (successorThemeNormalizeKey(theme.key) !== normalized) {
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

function successorThemeWriteInherited(shown) {
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

function successorThemeWriteExemptKeys(ledgerApi) {
  try {
    if (!ledgerApi || typeof ledgerApi.caps !== "function") {
      return { available: false, keys: [] };
    }
    const caps = ledgerApi.caps();
    if (
      !caps || typeof caps !== "object" || Array.isArray(caps) ||
      typeof caps.then === "function" || !Array.isArray(caps.exempt)
    ) {
      return { available: false, keys: [] };
    }
    const keys = [];
    for (const value of caps.exempt) {
      if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) {
        return { available: false, keys: [] };
      }
      if (String(value).includes("+")) {
        return { available: false, keys: [] };
      }
      keys.push(String(value).trim());
    }
    return { available: true, keys };
  } catch (_error) {
    return { available: false, keys: [] };
  }
}

function successorThemeWriteLineText(noteText, zeroBasedLine) {
  if (typeof noteText !== "string" || !Number.isInteger(zeroBasedLine) || zeroBasedLine < 0) {
    return null;
  }
  const lines = String(noteText).split(/\r?\n/);
  return zeroBasedLine < lines.length ? lines[zeroBasedLine] : null;
}

// Resolve the successor destination's actual open entry name from the same
// staged daily lines the insertion planner uses (087). An `existing` pick
// names its entry outright only when the line preimage still holds and the
// entry is still open; a moved or closed entry returns null so no theme
// persists for it. A `new` pick returns its validated name. Unnamed entries
// return null so the shared write rule refuses them.
function successorThemeDestinationName(override, dailyLines) {
  try {
    if (!override || typeof override !== "object") {
      return null;
    }
    const lines = Array.isArray(dailyLines)
      ? dailyLines.map((line) => String(line ?? ""))
      : String(dailyLines ?? "").split(/\r?\n/);
    if (override.kind === "existing") {
      if (!Number.isInteger(override.entryLine) || override.entryLine < 0) {
        return null;
      }
      if (override.entryLine >= lines.length) {
        return null;
      }
      if (typeof override.entryText !== "string" || !override.entryText) {
        return null;
      }
      if (String(lines[override.entryLine]).replace(/\r$/, "") !== override.entryText) {
        return null;
      }
      let entries = [];
      try {
        entries = parseSuccessorLedgerEntries(lines);
      } catch (_error) {
        return null;
      }
      const target = entries.find((entry) => entry && entry.entryLine === override.entryLine);
      if (!target || !target.open) {
        return null;
      }
      let name = "";
      try {
        const parts = parsePomodoroEntryLineParts(String(lines[override.entryLine] || ""));
        name = parts && typeof parts.name === "string" ? parts.name : "";
      } catch (_error) {
        return null;
      }
      const trimmed = String(name || "").trim();
      return trimmed ? trimmed : null;
    }
    if (override.kind === "new") {
      const name = typeof override.name === "string" ? override.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return name;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function getSuccessorTaskThemesApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api = plugins && plugins["bob-ledger-tools"] && plugins["bob-ledger-tools"].api;
    const themes = api && api.themes;
    return themes && themes.version >= 1 ? themes : null;
  } catch (_error) {
    return null;
  }
}

function getSuccessorTaskLedgerApi(app) {
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

// Pure guarded decision for one explicitly picked successor with a retarget
// override. Only a deliberate non-linkOnce intent with a shown suggestion can
// write; default anchor/implicit placements (no override), unpicked offers,
// missing APIs, unnamed/all-exempt/composite destinations, stale tasks, and
// changed suggestions never write. The caller owns the guarded vault write.
function resolveSuccessorThemeWrite(options = {}) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const override = opts.override && typeof opts.override === "object" ? opts.override : null;
    const rawIntent = override && override.themeIntent !== undefined ? override.themeIntent : opts.intent;
    const intent = normalizeSuccessorThemeIntent(rawIntent);
    if (!override || !intent || intent.linkOnce === true || intent.deliberate !== true || !intent.shown) {
      return emptySuccessorThemeWrite();
    }
    const task = opts.task && typeof opts.task === "object" ? opts.task : null;
    const taskPath = task && typeof task.path === "string" ? task.path : "";
    const zeroBased = task && Number.isInteger(task.line) ? task.line : null;
    if (!taskPath || zeroBased == null || zeroBased < 0) {
      return emptySuccessorThemeWrite();
    }
    const dailyPath = typeof opts.dailyPath === "string" ? opts.dailyPath : "";
    let dailyLines = null;
    if (Array.isArray(opts.dailyLines)) {
      dailyLines = opts.dailyLines.map((line) => String(line ?? ""));
    } else if (typeof opts.dailyText === "string") {
      dailyLines = String(opts.dailyText).split(/\r?\n/);
    }
    const destinationName = successorThemeDestinationName(override, dailyLines || []);
    if (!destinationName) {
      return emptySuccessorThemeWrite();
    }
    const themesApi = opts.themesApi || null;
    if (
      !themesApi ||
      typeof themesApi.effectiveTypeFor !== "function" ||
      typeof themesApi.planRetype !== "function" ||
      typeof themesApi.setTaskTheme !== "function" ||
      typeof themesApi.clearTaskTheme !== "function"
    ) {
      return emptySuccessorThemeWrite();
    }
    let noteText = null;
    try {
      if (dailyPath && taskPath === dailyPath && Array.isArray(dailyLines)) {
        noteText = dailyLines.join("\n");
      } else {
        const texts = opts.noteTexts;
        if (texts instanceof Map) {
          const value = texts.get(taskPath);
          noteText = typeof value === "string" ? value : null;
        } else if (texts && typeof texts === "object") {
          const value = texts[taskPath];
          noteText = typeof value === "string" ? value : null;
        }
      }
    } catch (_error) {
      noteText = null;
    }
    if (typeof noteText !== "string") {
      return emptySuccessorThemeWrite();
    }
    const oneBased = zeroBased + 1;
    const lines = noteText.split(/\r?\n/);
    if (oneBased < 1 || oneBased > lines.length) {
      return emptySuccessorThemeWrite();
    }
    const lineText = lines[zeroBased];
    // Stale-task guard: the refreshed note line must still equal the
    // planned preimage when one is known.
    const preimage = typeof task.rawLine === "string"
      ? task.rawLine
      : (typeof opts.preimage === "string" ? opts.preimage : null);
    if (typeof preimage === "string" && lineText !== preimage) {
      return emptySuccessorThemeWrite();
    }
    let current = null;
    try {
      current = themesApi.effectiveTypeFor({ path: taskPath, line: oneBased, text: noteText });
    } catch (_error) {
      return { themeEdit: null, suggestionChanged: true, destinationThemeName: null };
    }
    const shownIdentity = successorThemeSuggestionIdentity(intent.shown);
    const currentIdentity = successorThemeSuggestionIdentity(current);
    if (!successorThemeSuggestionsMatch(shownIdentity, currentIdentity)) {
      return { themeEdit: null, suggestionChanged: true, destinationThemeName: null };
    }
    const inherited = successorThemeWriteInherited(intent.shown);
    let change = null;
    try {
      change = themesApi.planRetype({
        effective: current,
        inherited,
        destination: destinationName,
      });
    } catch (_error) {
      return emptySuccessorThemeWrite();
    }
    if (!change || (change.kind !== "set" && change.kind !== "clear")) {
      return emptySuccessorThemeWrite();
    }
    if (change.kind === "set") {
      const name = successorThemeCatalogSpelling(themesApi, change.key, change.name);
      if (!name) {
        return emptySuccessorThemeWrite();
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
    const destinationThemeName = successorThemeCatalogSpelling(
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
    return emptySuccessorThemeWrite();
  }
}

function formatSuccessorThemeRowChip(row) {
  try {
    if (!row || typeof row !== "object") {
      return "";
    }
    if (row.theme_changed === true && row.theme_action === "clear") {
      return " · task type cleared";
    }
    if (row.theme_changed === true && row.theme_action === "set" && row.theme_name) {
      return ` · task type ${row.theme_name}`;
    }
    if (row.theme_suggestion_changed === true) {
      return " · task type unchanged (suggestion changed)";
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function successorThemePartialFailureClause(row) {
  try {
    if (!row || row.theme_changed !== true) {
      return null;
    }
    if (row.theme_action === "clear") {
      return "task type cleared";
    }
    if (typeof row.theme_name === "string" && row.theme_name) {
      return `task type ${row.theme_name} saved`;
    }
    return "task type saved";
  } catch (_error) {
    return null;
  }
}
