// Task-type write for Link to today. Pure helpers: revalidate the shown
// suggestion, apply the R2 landing plan, merge destination names, and attach
// notice metadata.
// The 120 mixin stays a thin call site.
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
  return {
    themeEdit: null,
    suggestionChanged: false,
    destinationThemeName: null,
    mergeName: null,
    keepsName: null,
    retypeKind: null,
  };
}

function pomodoroTargetDestinationName(target) {
  try {
    if (!target || typeof target !== "object") {
      return null;
    }
    if (target.kind === "new") {
      const name = target.name;
      return typeof name === "string" && name.trim() ? name : null;
    }
    if (target.kind === "existing") {
      const parts = parsePomodoroEntryParts(target.entryText || "");
      if (parts && typeof parts.name === "string" && parts.name) {
        return parts.name;
      }
      const title = target.title;
      return typeof title === "string" && title.trim() ? title : null;
    }
    return null;
  } catch (_error) {
    return null;
  }
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
      if (typeof value !== "string" || !value.trim() || value.includes("+")) {
        return { available: false, keys: [] };
      }
      const valid = canonicalizePomodoroLinkName(value);
      if (!valid || valid.valid !== true) {
        return { available: false, keys: [] };
      }
      keys.push(value.trim());
    }
    return { available: true, keys };
  } catch (_error) {
    return { available: false, keys: [] };
  }
}

function pomodoroThemeWriteLineText(taskContent, line) {
  if (typeof taskContent !== "string" || !Number.isInteger(line) || line < 0) {
    return "";
  }
  const lines = taskContent.split("\n");
  return line < lines.length ? lines[line] : "";
}

// Shared suggestion context for the Ctrl+Shift+Enter link direction. The
// Ledger Tools cascade reads only path (residence chain), line, and the
// task's own line text, so a routed task suggests from a one-line virtual
// note at the destination.
function pomodoroLinkThemeTaskContext(source, liveText) {
  try {
    const gate = source && source.inboxRouteGate;
    if (
      gate && gate.kind === "move" &&
      typeof gate.path === "string" && gate.path
    ) {
      const lineText = pomodoroThemeWriteLineText(
        typeof liveText === "string" ? liveText : "",
        source && source.line,
      );
      return { path: gate.path, line: 1, text: lineText };
    }
  } catch (_error) {
    // Fall through to the inbox context below.
  }
  const path = source && typeof source.sourcePath === "string" ? source.sourcePath : "";
  const line = Number.isInteger(source && source.line) ? source.line + 1 : 0;
  const text = typeof liveText === "string" ? liveText : "";
  return { path, line, text };
}

function resolvePomodoroLinkThemeWrite(plugin, source, target, taskContent) {
  try {
    const intent = normalizePomodoroLinkPickerThemeIntent(
      source && source.pomodoroTarget && source.pomodoroTarget.themeIntent,
    );
    if (!intent) {
      return emptyPomodoroThemeWrite();
    }
    const destinationName = pomodoroTargetDestinationName(
      target || (source && source.pomodoroTarget),
    ) || pomodoroPlanDestinationName(target);
    if (!destinationName) {
      return emptyPomodoroThemeWrite();
    }
    const themesApi = getBlockPomodoroThemesApi(plugin && plugin.app);
    if (
      !themesApi ||
      typeof themesApi.suggestFor !== "function" ||
      typeof themesApi.planLanding !== "function" ||
      typeof themesApi.setTaskTheme !== "function" ||
      typeof themesApi.clearTaskTheme !== "function"
    ) {
      return emptyPomodoroThemeWrite();
    }
    const context = pomodoroLinkThemeTaskContext(
      source,
      typeof taskContent === "string" ? taskContent : "",
    );
    if (!context.path || context.line < 1) {
      return emptyPomodoroThemeWrite();
    }
    let current = null;
    try {
      current = themesApi.suggestFor({ path: context.path, line: context.line, text: context.text });
    } catch (_error) {
      return { ...emptyPomodoroThemeWrite(), suggestionChanged: true };
    }
    if (intent.shown) {
      const shownIdentity = pomodoroThemeSuggestionIdentity(intent.shown);
      const currentIdentity = pomodoroThemeSuggestionIdentity(current);
      if (!pomodoroThemeSuggestionsMatch(shownIdentity, currentIdentity)) {
        return { ...emptyPomodoroThemeWrite(), suggestionChanged: true };
      }
    }
    const effective = current && current.theme ? current : intent.shown;
    if (!effective || typeof effective !== "object" || !effective.theme) {
      return emptyPomodoroThemeWrite();
    }
    const inherited = pomodoroThemeWriteInherited(effective);
    let outcome = null;
    try {
      outcome = themesApi.planLanding({
        effective,
        inherited,
        destination: destinationName,
        retype: intent.retype === true || Boolean(target && target.kind === "new"),
        tabPick: intent.tabPick,
      });
    } catch (_error) {
      return emptyPomodoroThemeWrite();
    }
    if (!outcome || typeof outcome !== "object") {
      return emptyPomodoroThemeWrite();
    }
    const keepsName = pomodoroTypeThemeName(effective);
    if (outcome.kind === "merge" && typeof outcome.name === "string" && outcome.name) {
      return {
        themeEdit: null,
        suggestionChanged: false,
        destinationThemeName: outcome.name,
        mergeName: outcome.name,
        keepsName,
        retypeKind: "merge",
      };
    }
    if (outcome.kind === "container" || outcome.kind === "consistent") {
      return {
        themeEdit: null,
        suggestionChanged: false,
        destinationThemeName: destinationName,
        mergeName: null,
        keepsName,
        retypeKind: outcome.kind,
      };
    }
    if (outcome.kind === "set") {
      const name = pomodoroThemeCatalogSpelling(themesApi, outcome.key, outcome.name);
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
        mergeName: null,
        keepsName: null,
        retypeKind: "set",
      };
    }
    if (outcome.kind === "clear") {
      const inheritedTheme = inherited && inherited.theme && typeof inherited.theme === "object"
        ? inherited.theme
        : effective.theme;
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
        mergeName: null,
        keepsName: null,
        retypeKind: "clear",
      };
    }
    return emptyPomodoroThemeWrite();
  } catch (_error) {
    return emptyPomodoroThemeWrite();
  }
}

function pomodoroTargetWithKeepTypeMerge(target, themeWrite) {
  const mergeName = themeWrite && themeWrite.mergeName;
  if (!target || !mergeName || target.kind !== "new") {
    return target || null;
  }
  return { ...target, name: mergeName, preserveSpelling: true };
}

function rewritePomodoroEntryNameLine(lineText, newName) {
  const raw = String(lineText || "");
  const hasCR = raw.endsWith("\r");
  const line = hasCR ? raw.slice(0, -1) : raw;
  const dash = " — ";
  const index = line.indexOf(dash);
  let next;
  if (index >= 0) {
    next = `${line.slice(0, index + dash.length)}${newName}`;
  } else {
    const taskPrefix = /^([ \t]*[-*][ \t]+\[[^\]\r\n]\][ \t]*)/.exec(line);
    const bodyStart = taskPrefix ? taskPrefix[0].length : 0;
    const body = line.slice(bodyStart);
    const paren = /\([^)]*\)/.exec(body);
    const label = paren ? body.slice(0, paren.index).replace(/[ \t]+$/, "") : "";
    if (paren && label) {
      next = `${line.slice(0, bodyStart)}${newName} ${body.slice(paren.index)}`;
    } else {
      next = `${line.replace(/[ \t]+$/, "")}${dash}${newName}`;
    }
  }
  return hasCR ? `${next}\r` : next;
}

function pomodoroOffsetAfterEdits(offset, edits) {
  if (!Number.isInteger(offset) || offset < 0 || !Array.isArray(edits)) {
    return null;
  }
  let delta = 0;
  for (const edit of edits.slice().sort((left, right) => left.start - right.start)) {
    if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      return null;
    }
    const replacement = String(edit.replacement || "");
    if (edit.start === edit.end) {
      if (edit.start <= offset) {
        delta += replacement.length;
      }
      continue;
    }
    if (edit.start < offset && offset < edit.end) {
      return null;
    }
    if (edit.start === offset) {
      return null;
    }
    if (edit.end <= offset) {
      delta += replacement.length - (edit.end - edit.start);
    } else if (edit.start > offset) {
      break;
    }
  }
  return offset + delta;
}

async function agreePomodoroLedgerPlan(
  plugin,
  path,
  originalContent,
  plan,
  touchedEntryOffsets,
) {
  try {
    const original = String(originalContent || "");
    if (!plan || !Array.isArray(plan.edits)) return plan;
    const offsets = Array.isArray(touchedEntryOffsets)
      ? touchedEntryOffsets
      : Array.isArray(plan.touchedEntryOffsets)
        ? plan.touchedEntryOffsets
        : [];
    if (!path || offsets.length === 0) return plan;

    const themesApi = getBlockPomodoroThemesApi(plugin && plugin.app);
    if (!themesApi || typeof themesApi.agreeLedgerEntries !== "function") {
      return plan;
    }
    const plannedContent = applyTextEdits(original, plan.edits);
    const originalLines = original.split("\n");
    const plannedLines = plannedContent.split("\n");
    const lineToOriginalOffset = new Map();
    for (const offset of [...new Set(offsets)]) {
      const mapped = pomodoroOffsetAfterEdits(offset, plan.edits);
      if (mapped === null || mapped > plannedContent.length) continue;
      const line = plannedContent.slice(0, mapped).split("\n").length - 1;
      const lineText = plannedLines[line] || "";
      if (
        isPomodoroEntryLine(lineText) &&
        isOpenPomodoroStatus(pomodoroEntryStatus(lineText))
      ) {
        lineToOriginalOffset.set(line, offset);
      }
    }
    if (lineToOriginalOffset.size === 0) return plan;

    const agreed = await themesApi.agreeLedgerEntries({
      path,
      content: plannedContent,
      entryLines: [...lineToOriginalOffset.keys()].map((line) => line + 1),
    });
    if (!agreed || typeof agreed.content !== "string" || !Array.isArray(agreed.entries)) {
      return plan;
    }

    const nameEdits = [];
    for (const entry of agreed.entries) {
      const line = Number.isInteger(entry && entry.line) ? entry.line - 1 : -1;
      const originalOffset = lineToOriginalOffset.get(line);
      const oldLineIndex = originalOffset === undefined
        ? -1
        : original.slice(0, originalOffset).split("\n").length - 1;
      if (
        oldLineIndex < 0 || oldLineIndex >= originalLines.length ||
        typeof entry.after !== "string"
      ) {
        continue;
      }
      const oldLine = originalLines[oldLineIndex];
      const nextLine = rewritePomodoroEntryNameLine(oldLine, entry.after);
      if (nextLine === oldLine) continue;
      const start = lineStartIndexFromLines(originalLines, oldLineIndex);
      nameEdits.push({ start, end: start + oldLine.length, replacement: nextLine });
    }
    if (nameEdits.length === 0 || !validateNonOverlappingEdits([...plan.edits, ...nameEdits])) {
      return plan;
    }
    const edits = [...plan.edits, ...nameEdits];
    const content = applyTextEdits(original, edits);
    if (content !== agreed.content) return plan;
    return {
      ...plan,
      edits,
      content,
      hasChanges: content !== original,
      agreement: agreed,
    };
  } catch (_error) {
    return plan;
  }
}

function applyPomodoroKeepTypeMerge(plan, snapshot, themeWrite) {
  try {
    const mergeName = themeWrite && themeWrite.mergeName;
    if (!plan || plan.error || !mergeName) {
      return plan;
    }
    if (!plan.destination || plan.destination.kind !== "existing") {
      if (plan.destination) {
        plan.destination.name = mergeName;
        plan.destination.title = mergeName;
      }
      return plan;
    }
    const content = String(snapshot || "");
    const lines = content.split("\n");
    const entryLine = plan.destination.entryLine;
    if (!Number.isInteger(entryLine) || entryLine < 0 || entryLine >= lines.length) {
      return plan;
    }
    const original = lines[entryLine];
    const next = rewritePomodoroEntryNameLine(original, mergeName);
    if (next === original) {
      plan.destination.name = mergeName;
      plan.destination.title = mergeName;
      return plan;
    }
    const start = lineStartIndexFromLines(lines, entryLine);
    const edit = { start, end: start + original.length, replacement: next };
    const edits = [...(plan.edits || []), edit];
    if (!validateNonOverlappingEdits(edits)) {
      return plan;
    }
    plan.edits = edits;
    plan.content = applyTextEdits(content, edits);
    plan.hasChanges = true;
    plan.destination = { ...plan.destination, name: mergeName, title: mergeName };
    return plan;
  } catch (_error) {
    return plan;
  }
}

function planPomodoroLinkWithTypeMerge(dailyContent, insertOptions, themeWrite) {
  const options = insertOptions && typeof insertOptions === "object" ? insertOptions : {};
  const target = pomodoroTargetWithKeepTypeMerge(options.target, themeWrite);
  const plan = planPomodoroLinkInsertion(dailyContent, { ...options, target });
  return applyPomodoroKeepTypeMerge(plan, dailyContent, themeWrite);
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
  plan.themeKeepsName = typeof write.keepsName === "string" && write.keepsName
    ? write.keepsName
    : null;
  plan.themeMergeName = typeof write.mergeName === "string" && write.mergeName
    ? write.mergeName
    : null;
  plan.themeRetypeKind = typeof write.retypeKind === "string" ? write.retypeKind : null;
  return plan;
}

function formatPomodoroThemeLinkChip(plan) {
  try {
    if (!plan || typeof plan !== "object") {
      return "";
    }
    if (plan.themeChanged === true && plan.themeAction === "clear") {
      return " · type cleared";
    }
    if (plan.themeChanged === true && plan.themeAction === "set" && plan.themeName) {
      return ` · type ${plan.themeName}`;
    }
    if (plan.themeMergeName && plan.themeKeepsName) {
      return ` · merged ${plan.themeKeepsName}`;
    }
    if (plan.themeKeepsName) {
      return ` · keeps ${plan.themeKeepsName}`;
    }
    if (plan.themeSuggestionChanged === true) {
      return " · type unchanged (suggestion changed)";
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
      return "type cleared";
    }
    if (typeof plan.themeName === "string" && plan.themeName) {
      return `type ${plan.themeName} set`;
    }
    return "type saved";
  } catch (_error) {
    return null;
  }
}
