// Stable selection, suggestion reasons, and keep-type intent for the Link to
// today picker (plan:202610/task_types.md link-picker-retype). Pure helpers
// over the task-aware type snapshot; the modal in 085 owns the DOM.
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

function pomodoroTypeThemeName(target) {
  const theme = target && target.theme && typeof target.theme === "object"
    ? target.theme
    : null;
  return theme && typeof theme.name === "string" && theme.name ? theme.name : null;
}

function pomodoroTypeInheritedSuggestion(shown) {
  if (!shown || typeof shown !== "object") {
    return null;
  }
  return shown.source === "task"
    ? (shown.inherited && typeof shown.inherited === "object" ? shown.inherited : null)
    : shown;
}

function pomodoroTypeComponentCandidates(themesApi, destinationName) {
  try {
    if (themesApi && typeof themesApi.typeComponentsOf === "function") {
      const rows = themesApi.typeComponentsOf(destinationName);
      if (Array.isArray(rows)) {
        return rows.filter((row) =>
          row && row.isType === true
          && typeof row.name === "string" && row.name
          && typeof row.key === "string" && row.key
        );
      }
    }
  } catch (_error) {
    // Fall through to a name split so the footer still works.
  }
  return String(destinationName || "")
    .split("+")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      key: asciiLowercasePomodoroText(name.replace(/\s+/g, " ")),
      isType: true,
    }));
}

function defaultPomodoroTypeTabPick(candidates, exemptKeys) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return null;
  }
  const exempt = new Set(
    (Array.isArray(exemptKeys) ? exemptKeys : [])
      .map((key) => asciiLowercasePomodoroText(String(key || "").trim()))
      .filter(Boolean),
  );
  const chosen = list.find((row) => !exempt.has(row.key)) || list[0];
  return chosen ? chosen.key : null;
}

function pomodoroTypeCandidateByKey(candidates, key) {
  const want = asciiLowercasePomodoroText(String(key || "").trim());
  if (!want) {
    return null;
  }
  return (Array.isArray(candidates) ? candidates : []).find((row) => row.key === want) || null;
}

// Cycle the Tab pick among a composite destination's type components.
// Returns null when there are fewer than two candidates.
function nextPomodoroTypeTabPick(input = {}) {
  try {
    const opts = input && typeof input === "object" ? input : {};
    const candidates = pomodoroTypeComponentCandidates(opts.themesApi, opts.rowName);
    if (candidates.length < 2) {
      return null;
    }
    const current = opts.current || defaultPomodoroTypeTabPick(candidates, opts.exemptKeys);
    const index = candidates.findIndex((row) => row.key === current);
    const start = index >= 0 ? index : 0;
    const delta = opts.backwards === true ? -1 : 1;
    const next = candidates[(start + delta + candidates.length) % candidates.length];
    return next ? next.key : null;
  } catch (_error) {
    return null;
  }
}

function describePomodoroTypeFooterSource(target, short) {
  try {
    if (!target || typeof target !== "object") {
      return "";
    }
    const name = pomodoroTypeThemeName(target);
    if (target.source === "note") {
      const from = target.from && typeof target.from === "object" ? target.from : null;
      const stem = from && typeof from.stem === "string" && from.stem ? from.stem : null;
      if (short === true) {
        return stem ? `from ${stem}` : "";
      }
      return stem && name ? `${stem} suggests ${name}` : "";
    }
    if (target.source === "reading") {
      return short === true ? "from reading task" : (name ? `reading tasks suggest ${name}` : "");
    }
    if (target.source === "default") {
      return short === true ? "default type" : (name ? `default type ${name}` : "default type");
    }
    if (target.source === "task") {
      return name ? `this task suggests ${name}` : "";
    }
    return name ? `suggests ${name}` : "";
  } catch (_error) {
    return "";
  }
}

function callPomodoroPlanRetype(planRetype, shown, inherited, destination, keepType, tabPick) {
  if (typeof planRetype !== "function") {
    return null;
  }
  try {
    return planRetype({
      effective: shown,
      inherited,
      destination,
      keepType: keepType === true,
      tabPick: tabPick || undefined,
    });
  } catch (_error) {
    return null;
  }
}

// D10 consequence line for the highlighted Link to today row. Always stated
// before Enter; silence is a bug. `⇥ …` appears only for a composite with
// two or more type components. planRetype comes from Ledger Tools; every
// failure degrades to no preview.
function describePomodoroThemeFooterPreview(input = {}) {
  try {
    const opts = input && typeof input === "object" ? input : {};
    const rowName = typeof opts.rowName === "string" ? opts.rowName : "";
    const shown = opts.shown && typeof opts.shown === "object" ? opts.shown : null;
    if (!rowName || !shown) {
      return null;
    }
    const inherited = pomodoroTypeInheritedSuggestion(shown);
    const effectiveName = pomodoroTypeThemeName(shown);
    if (!effectiveName) {
      return null;
    }
    const enterPlan = callPomodoroPlanRetype(
      opts.planRetype,
      shown,
      inherited,
      rowName,
      false,
      opts.tabPick,
    );
    if (!enterPlan || typeof enterPlan !== "object" || !enterPlan.kind) {
      return null;
    }
    let arrow = rowName;
    let consequence = `keeps ${effectiveName}`;
    let source = "";
    if (enterPlan.kind === "set" && typeof enterPlan.name === "string" && enterPlan.name) {
      arrow = enterPlan.name;
      consequence = `task becomes ${enterPlan.name}`;
      source = describePomodoroTypeFooterSource(inherited || shown, false);
    } else if (enterPlan.kind === "clear") {
      const candidates = pomodoroTypeComponentCandidates(opts.themesApi, rowName);
      const chosen = pomodoroTypeCandidateByKey(candidates, opts.tabPick)
        || pomodoroTypeCandidateByKey(
          candidates,
          defaultPomodoroTypeTabPick(candidates, opts.exemptKeys),
        );
      arrow = (chosen && chosen.name)
        || pomodoroTypeThemeName(inherited)
        || rowName;
      consequence = "type cleared";
      source = describePomodoroTypeFooterSource(inherited || shown, true);
    } else if (enterPlan.kind === "container" || enterPlan.kind === "consistent") {
      arrow = rowName;
      consequence = `keeps ${effectiveName}`;
    } else if (enterPlan.kind === "merge" && typeof enterPlan.name === "string" && enterPlan.name) {
      arrow = enterPlan.name;
      consequence = `keeps ${effectiveName}`;
    } else {
      return null;
    }
    const keepPlan = callPomodoroPlanRetype(
      opts.planRetype,
      shown,
      inherited,
      rowName,
      true,
      opts.tabPick,
    );
    const keep = keepPlan && keepPlan.kind === "merge" && typeof keepPlan.name === "string" && keepPlan.name
      ? `⌥↵ keep ${effectiveName} (${keepPlan.name})`
      : "";
    const candidates = pomodoroTypeComponentCandidates(opts.themesApi, rowName);
    let tab = "";
    if (candidates.length >= 2) {
      const current = opts.tabPick || defaultPomodoroTypeTabPick(candidates, opts.exemptKeys);
      const nextKey = nextPomodoroTypeTabPick({
        themesApi: opts.themesApi,
        rowName,
        current,
        exemptKeys: opts.exemptKeys,
      });
      const next = pomodoroTypeCandidateByKey(candidates, nextKey);
      if (next && next.name) {
        tab = `⇥ ${next.name}`;
      }
    }
    return [`→ ${arrow}`, consequence, source, keep, tab].filter(Boolean).join(" · ");
  } catch (_error) {
    return null;
  }
}

// Strict validation for the additive themeIntent on a committed choice.
// Anything malformed is dropped so a bad intent can never enable a write;
// absent intent keeps the legacy return shape. `tabPick` is optional.
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
    const tabPick = typeof intent.tabPick === "string" && intent.tabPick
      ? intent.tabPick
      : null;
    const withTab = (base) => (tabPick ? { ...base, tabPick } : base);
    if (intent.shown === undefined || intent.shown === null) {
      return withTab({ deliberate: intent.deliberate, linkOnce: intent.linkOnce, shown: null });
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
    return withTab({
      deliberate: intent.deliberate,
      linkOnce: intent.linkOnce,
      shown: intent.shown,
    });
  } catch (_error) {
    return null;
  }
}
