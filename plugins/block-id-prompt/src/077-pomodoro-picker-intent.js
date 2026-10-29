// Stable selection, suggestion reasons, and link-once intent for the Link to
// today picker (plan:202610/task_theme_link_picker.md picker-intent). Pure
// helpers over the task-aware theme snapshot; the modal in 085 owns the DOM.
function pomodoroPickerRowKey(row) {
  return row && typeof row.key === "string" ? row.key : null;
}

function firstSelectablePomodoroPickerIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] && list[index].selectable === true) {
      return index;
    }
  }
  return -1;
}

function selectedPomodoroPickerKey(rows, selectedIndex) {
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
    return null;
  }
  const list = Array.isArray(rows) ? rows : [];
  if (selectedIndex >= list.length) {
    return null;
  }
  return pomodoroPickerRowKey(list[selectedIndex]);
}

// A plain commit is deliberate when the row differs from the settled
// initial key or a query is typed. Returning to the initial key with an
// empty query (or an untouched double tap) is not deliberate.
function pomodoroPickerRowDeliberate(initialKey, query, row) {
  try {
    return pomodoroPickerRowKey(row) !== initialKey || String(query || "").trim() !== "";
  } catch (_error) {
    return true;
  }
}

function clonePomodoroThemeSuggestion(suggestion) {
  try {
    if (!suggestion || typeof suggestion !== "object") {
      return null;
    }
    return JSON.parse(JSON.stringify(suggestion));
  } catch (_error) {
    return null;
  }
}

// The destination Pomodoro name behind a committed row: existing entries use
// their entry name, Recent rows keep catalog spelling, typed rows use the
// canonical name. Anything else (notice rows, unnamed entries) has none.
function destinationPomodoroRowName(row) {
  try {
    if (!row || typeof row !== "object") {
      return null;
    }
    if (row.kind === "existing") {
      const name = row.entry && row.entry.name;
      return typeof name === "string" && name ? name : null;
    }
    if (row.kind === "recent") {
      const theme = row.theme && typeof row.theme === "object" ? row.theme : null;
      const name = theme && typeof theme.name === "string" && theme.name
        ? theme.name
        : row.name;
      return typeof name === "string" && name ? name : null;
    }
    if (row.kind === "new") {
      return typeof row.name === "string" && row.name ? row.name : null;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function pomodoroThemeSuggestionHue(value) {
  return typeof value === "string" && BLOCK_POMODORO_THEME_HUES.includes(value)
    ? value
    : null;
}

// Machine-readable reason behind a suggested row: the tail text plus the
// place hue (from.hue) and the suggested theme name/hue for rendering.
function pomodoroThemeSuggestionReason(suggestion) {
  try {
    if (!suggestion || typeof suggestion !== "object") {
      return null;
    }
    const theme = suggestion.theme && typeof suggestion.theme === "object"
      ? suggestion.theme
      : null;
    const themeName = theme && typeof theme.name === "string" && theme.name
      ? theme.name
      : null;
    const themeHue = theme ? pomodoroThemeSuggestionHue(theme.hue) : null;
    if (suggestion.source === "task") {
      return { kind: "task", text: "this task", themeName, themeHue };
    }
    if (suggestion.source === "reading") {
      return { kind: "reading", text: "reading task", themeName, themeHue };
    }
    if (suggestion.source === "note") {
      const from = suggestion.from && typeof suggestion.from === "object"
        ? suggestion.from
        : null;
      const stem = from && typeof from.stem === "string" && from.stem
        ? from.stem
        : null;
      if (!stem) {
        return null;
      }
      return {
        kind: "note",
        stem,
        placeHue: from ? pomodoroThemeSuggestionHue(from.hue) : null,
        themeName,
        themeHue,
      };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

// Accessible suffix for a suggested row label, e.g.
// `Pomodoro WRITE, suggested, from sase_blog`. Color is never the only cue.
function pomodoroThemeSuggestedLabelSuffix(suggestion) {
  const reason = pomodoroThemeSuggestionReason(suggestion);
  if (!reason) {
    return "";
  }
  if (reason.kind === "note") {
    return `, suggested, from ${reason.stem}`;
  }
  return `, suggested, ${reason.text}`;
}

// Middle segment of the field-change footer: whose default the pending edit
// is measured against. A task-field suggestion defers to its inherited
// default; a missing inherited default reports `no default here`.
function describePomodoroThemeSuggestionSource(target) {
  try {
    if (!target || typeof target !== "object") {
      return "no default here";
    }
    const theme = target.theme && typeof target.theme === "object" ? target.theme : null;
    const name = theme && typeof theme.name === "string" && theme.name ? theme.name : null;
    if (!name) {
      return "no default here";
    }
    if (target.source === "note") {
      const from = target.from && typeof target.from === "object" ? target.from : null;
      const stem = from && typeof from.stem === "string" && from.stem ? from.stem : null;
      return stem ? `${stem} suggests ${name}` : `note suggests ${name}`;
    }
    if (target.source === "reading") {
      return `reading tasks suggest ${name}`;
    }
    if (target.source === "task") {
      return `this task suggests ${name}`;
    }
    return `suggests ${name}`;
  } catch (_error) {
    return "no default here";
  }
}

// Preview of the pending theme-field edit for the footer, e.g.
// `this task becomes FIX · sase_blog suggests WRITE · ⌥↵ link once` or
// `task theme cleared · sase_blog suggests WRITE · ⌥↵ link once`.
// Returns null when no effective edit is pending, so the caller hides the
// second footer line. taskThemeOf/planThemeChange come from the Ledger Tools
// themes API; every failure degrades to no preview.
function describePomodoroThemeFooterPreview(input = {}) {
  try {
    const opts = input && typeof input === "object" ? input : {};
    const rowName = typeof opts.rowName === "string" ? opts.rowName : "";
    const shown = opts.shown && typeof opts.shown === "object" ? opts.shown : null;
    if (!rowName || !shown) {
      return null;
    }
    if (typeof opts.taskThemeOf !== "function" || typeof opts.planThemeChange !== "function") {
      return null;
    }
    const lineText = typeof opts.lineText === "string" ? opts.lineText : "";
    let field = null;
    try {
      field = opts.taskThemeOf(lineText);
    } catch (_error) {
      return null;
    }
    if (!field || typeof field !== "object") {
      return null;
    }
    const inherited = shown.source === "task"
      ? (shown.inherited && typeof shown.inherited === "object" ? shown.inherited : null)
      : shown;
    const exemptKeys = Array.isArray(opts.exemptKeys) ? opts.exemptKeys : [];
    let plan = null;
    try {
      plan = opts.planThemeChange({
        field,
        suggestion: shown,
        inherited,
        destinationName: rowName,
        exemptKeys,
        deliberate: opts.deliberate === true,
      });
    } catch (_error) {
      return null;
    }
    if (!plan || (plan.action !== "set" && plan.action !== "clear")) {
      return null;
    }
    let first = null;
    if (plan.action === "set") {
      first = typeof plan.name === "string" && plan.name ? `this task becomes ${plan.name}` : null;
    } else {
      first = "task theme cleared";
    }
    if (!first) {
      return null;
    }
    const middle = describePomodoroThemeSuggestionSource(
      shown.source === "task" ? inherited : shown,
    );
    return `${first} · ${middle} · ⌥↵ link once`;
  } catch (_error) {
    return null;
  }
}

// Strict validation for the additive themeIntent on a committed choice.
// Anything malformed is dropped so a bad intent can never enable a write;
// absent intent keeps the legacy return shape.
function normalizePomodoroLinkPickerThemeIntent(intent) {
  try {
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      return null;
    }
    if (typeof intent.deliberate !== "boolean") {
      return null;
    }
    if (typeof intent.linkOnce !== "boolean") {
      return null;
    }
    if (intent.shown === undefined || intent.shown === null) {
      return { deliberate: intent.deliberate, linkOnce: intent.linkOnce, shown: null };
    }
    if (typeof intent.shown !== "object") {
      return null;
    }
    const theme = intent.shown.theme;
    if (!theme || typeof theme !== "object") {
      return null;
    }
    if (typeof theme.key !== "string" || !theme.key) {
      return null;
    }
    return { deliberate: intent.deliberate, linkOnce: intent.linkOnce, shown: intent.shown };
  } catch (_error) {
    return null;
  }
}
