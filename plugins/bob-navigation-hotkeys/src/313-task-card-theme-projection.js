// Pure Task Card theme projection. It consumes the Ledger Tools task-theme
// API and exact note snapshots supplied by the modal adapter; it never writes.
const TASK_CARD_THEME_HUES = Object.freeze([
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
]);

function copyTaskCardThemeData(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) => copyTaskCardThemeData(entry, depth + 1)),
    );
  }
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "function") {
      copy[key] = copyTaskCardThemeData(entry, depth + 1);
    }
  }
  return Object.freeze(copy);
}

function taskCardThemeSnapshotForTarget(target, context = {}) {
  const path = normalizeVaultRelativePath(
    (target && (target.path || target.filePath)) || context.filePath || "",
  );
  const snapshots = context.noteContents;
  if (snapshots instanceof Map) {
    if (snapshots.has(path) && typeof snapshots.get(path) === "string") {
      return snapshots.get(path);
    }
    for (const [candidate, content] of snapshots) {
      if (
        typeof content === "string" &&
        normalizeVaultRelativePath(candidate) === path
      ) {
        return content;
      }
    }
  } else if (snapshots && typeof snapshots === "object") {
    const content = snapshots[path];
    if (typeof content === "string") {
      return content;
    }
  }
  if (target && typeof target.content === "string") {
    return target.content;
  }
  if (target && typeof target.noteText === "string") {
    return target.noteText;
  }
  if (
    path &&
    path === normalizeVaultRelativePath(context.filePath || "") &&
    typeof context.content === "string"
  ) {
    return context.content;
  }
  return null;
}

function taskCardThemeApiReady(api) {
  return Boolean(
    api &&
      Number(api.version) >= 1 &&
      typeof api.suggestFor === "function" &&
      typeof api.taskThemeOf === "function",
  );
}

function taskCardThemeKnown(api, theme) {
  if (!theme || !theme.key) {
    return null;
  }
  if (theme.known === false) {
    return false;
  }
  try {
    if (api && typeof api.isKnownTheme === "function") {
      return api.isKnownTheme(theme.key) === true;
    }
  } catch (_error) {
    // Catalog knowledge is optional display metadata.
  }
  return theme.known === true ? true : null;
}

function taskCardThemeNoteSource(suggestion) {
  if (!suggestion || suggestion.source !== "note") {
    return null;
  }
  const from = suggestion.from && typeof suggestion.from === "object"
    ? suggestion.from
    : {};
  const stem = normalizeBulletPropertyValue(
    from.stem ||
      getVaultPathBasenameWithoutExtension(from.path || ""),
  );
  if (!stem) {
    return null;
  }
  const hue = TASK_CARD_THEME_HUES.includes(from.hue) ? from.hue : null;
  return Object.freeze({
    path: normalizeVaultRelativePath(from.path || ""),
    stem,
    hue,
  });
}

function taskCardThemeSourceLabel(suggestion) {
  if (!suggestion) {
    return "no default";
  }
  switch (suggestion.source) {
    case "note":
      return taskCardThemeNoteSource(suggestion)?.stem || "note default";
    case "reading":
      return suggestion.label || "reading task";
    case "review":
      return suggestion.label || "daily review";
    case "task":
      return suggestion.label || "this task";
    default:
      return suggestion.label || "inherited theme";
  }
}

function taskCardThemeTextFromParts(parts) {
  return parts
    .map((part) => {
      if (!part) return "";
      return part.type === "note" ? `● ${part.text}` : String(part.text || "");
    })
    .join("");
}

function taskCardThemeSourceParts(suggestion) {
  if (!suggestion) {
    return [Object.freeze({ type: "text", text: "no default" })];
  }
  const note = taskCardThemeNoteSource(suggestion);
  if (note) {
    return [
      Object.freeze({ type: "note", text: note.stem, hue: note.hue }),
    ];
  }
  return [
    Object.freeze({
      type: "text",
      text: taskCardThemeSourceLabel(suggestion),
    }),
  ];
}

function taskCardThemeTargetDisplay(state) {
  const theme = state.theme;
  const inherited = state.inherited;
  const inheritedTheme = inherited && inherited.theme;
  const valueText = theme && theme.name ? `[${theme.name}]` : "";
  const parts = [];
  if (state.needsRepair) {
    parts.push(Object.freeze({ type: "value", text: "Needs repair" }));
    if (inheritedTheme && inheritedTheme.name) {
      parts.push(Object.freeze({ type: "text", text: " · " }));
      parts.push(...taskCardThemeSourceParts(inherited));
      parts.push(
        Object.freeze({
          type: "text",
          text: ` suggests ${inheritedTheme.name}`,
        }),
      );
    } else {
      parts.push(Object.freeze({ type: "text", text: " · no default" }));
    }
  } else if (state.explicit) {
    parts.push(
      Object.freeze({
        type: "value",
        text: `${valueText} this task`,
      }),
    );
    if (inheritedTheme && inheritedTheme.name) {
      parts.push(Object.freeze({ type: "text", text: " · " }));
      parts.push(...taskCardThemeSourceParts(inherited));
      parts.push(
        Object.freeze({
          type: "text",
          text: ` suggests ${inheritedTheme.name}`,
        }),
      );
    } else {
      parts.push(Object.freeze({ type: "text", text: " · no default" }));
    }
  } else if (theme && theme.name) {
    parts.push(Object.freeze({ type: "value", text: valueText }));
    if (inherited && inherited.source === "note") {
      parts.push(Object.freeze({ type: "text", text: " from " }));
      parts.push(...taskCardThemeSourceParts(inherited));
    } else {
      parts.push(
        Object.freeze({
          type: "text",
          text: ` · ${taskCardThemeSourceLabel(inherited)}`,
        }),
      );
    }
  } else {
    parts.push(Object.freeze({ type: "value", text: "none" }));
    parts.push(Object.freeze({ type: "text", text: " · t to set" }));
  }
  const frozenParts = Object.freeze(parts);
  const unknown = Boolean(theme && state.known === false);
  const tooltip = state.needsRepair
    ? "This task has a duplicate or invalid theme field and needs repair."
    : unknown
      ? "This theme is not in the catalog; its task field remains unchanged."
      : null;
  return Object.freeze({
    parts: frozenParts,
    text: taskCardThemeTextFromParts(frozenParts),
    valueText: valueText || (state.needsRepair ? "Needs repair" : "none"),
    state: state.needsRepair
      ? "repair"
      : state.explicit
        ? "explicit"
        : theme
          ? "inherited"
          : "none",
    unknown,
    needsRepair: state.needsRepair,
    tooltip,
  });
}

function taskCardThemeTargetProjection(target, id, context, apiReady) {
  const path = normalizeVaultRelativePath(
    (target && (target.path || target.filePath)) || context.filePath || "",
  );
  const line = Number.isInteger(target && target.line) ? target.line : null;
  const rawLine = String((target && target.rawLine) || "");
  const identity = Object.freeze({
    id,
    path,
    line,
    rawLine,
    blockId: normalizeBulletPropertyValue(
      target && (target.blockId || target.id || getTrailingBlockId(rawLine)),
    ),
  });
  const unavailable = (reason) =>
    Object.freeze({
      identity,
      available: false,
      unavailableReason: reason,
      field: Object.freeze({ state: "unavailable", repair: null, count: 0 }),
      suggestion: null,
      inherited: null,
      theme: null,
      explicit: false,
      needsRepair: false,
      known: null,
      display: Object.freeze({
        parts: Object.freeze([
          Object.freeze({ type: "value", text: "unavailable" }),
        ]),
        text: "unavailable",
        valueText: "unavailable",
        state: "unavailable",
        unknown: false,
        needsRepair: false,
        tooltip: reason,
      }),
      signature: `unavailable:${reason}`,
    });
  if (!apiReady) {
    return unavailable("Ledger Tools task-theme API is unavailable");
  }
  if (!path || line === null || !rawLine) {
    return unavailable("Task identity is unavailable");
  }
  const content = taskCardThemeSnapshotForTarget(target, context);
  if (typeof content !== "string") {
    return unavailable("Matching note snapshot is unavailable");
  }
  const lines = content.split(/\r?\n/);
  if (lines[line] !== rawLine) {
    return unavailable("Task does not match its note snapshot");
  }
  const api = context.themeApi;
  let rawField;
  let rawSuggestion;
  try {
    rawField = api.taskThemeOf(rawLine);
    rawSuggestion = api.suggestFor({ path, line: line + 1, text: content });
  } catch (_error) {
    return unavailable("Task-theme information could not be read");
  }
  const field = rawField && ["none", "set", "repair"].includes(rawField.state)
    ? copyTaskCardThemeData(rawField)
    : Object.freeze({ state: "none" });
  const suggestion = rawSuggestion
    ? copyTaskCardThemeData(rawSuggestion)
    : null;
  const inherited = suggestion && suggestion.source === "task"
    ? suggestion.inherited || null
    : suggestion;
  const explicit = field.state === "set";
  const needsRepair = field.state === "repair";
  const suggestedTheme = suggestion && suggestion.theme;
  let theme = explicit
    ? suggestedTheme && suggestion.source === "task"
      ? suggestedTheme
      : Object.freeze({
          key:
            field.key ||
            String(field.value || "").trim().toLowerCase().replace(/\s+/g, " "),
          name: field.value,
          known:
            suggestedTheme && suggestedTheme.key === field.key
              ? suggestedTheme.known
              : undefined,
        })
    : needsRepair
      ? inherited && inherited.theme
      : suggestedTheme;
  const known = taskCardThemeKnown(api, theme);
  if (theme && known !== null && theme.known !== known) {
    theme = Object.freeze({ ...theme, known });
  }
  const fieldProjection = Object.freeze({
    state: field.state,
    key: typeof field.key === "string" ? field.key : null,
    value: typeof field.value === "string" ? field.value : null,
    repair: typeof field.repair === "string" ? field.repair : null,
    fields: Array.isArray(field.fields)
      ? copyTaskCardThemeData(field.fields)
      : Object.freeze([]),
    count: Array.isArray(field.fields) ? field.fields.length : explicit ? 1 : 0,
  });
  const state = {
    theme,
    inherited,
    explicit,
    needsRepair,
    known,
  };
  const display = taskCardThemeTargetDisplay(state);
  const signature = JSON.stringify({
    state: field.state,
    themeKey: theme && theme.key,
    inheritedKey: inherited && inherited.theme && inherited.theme.key,
    source: inherited && inherited.source,
    declaringPath: inherited && inherited.from && inherited.from.path,
    repair: field.repair,
    known,
  });
  return Object.freeze({
    identity,
    available: true,
    unavailableReason: null,
    field: fieldProjection,
    suggestion,
    inherited,
    theme: theme ? copyTaskCardThemeData(theme) : null,
    explicit,
    needsRepair,
    known,
    display,
    signature,
  });
}

function buildTaskCardThemeProjection(context = {}) {
  const unique = deduplicateTaskCardTargets(context.targets);
  const apiReady = taskCardThemeApiReady(context.themeApi);
  const targets = unique.map(({ id, target }) =>
    taskCardThemeTargetProjection(target, id, context, apiReady),
  );
  const available = targets.length > 0 && targets.every((target) => target.available);
  const signatures = Array.from(
    new Set(targets.filter((target) => target.available).map((target) => target.signature)),
  );
  const mixed = targets.length > 1 && (signatures.length > 1 || !available);
  const first = targets[0] || null;
  let parts = [];
  let text = "unavailable";
  if (targets.length === 0) {
    text = "unavailable · no task targets";
    parts = [Object.freeze({ type: "value", text })];
  } else if (!available) {
    const unavailableCount = targets.filter((target) => !target.available).length;
    text = `unavailable for ${unavailableCount} of ${targets.length} tasks`;
    parts = [Object.freeze({ type: "value", text })];
  } else if (mixed) {
    text = `mixed across ${targets.length} tasks`;
    parts = [Object.freeze({ type: "value", text })];
  } else if (targets.length > 1) {
    parts = [
      Object.freeze({ type: "text", text: `all ${targets.length} tasks · ` }),
      ...first.display.parts,
    ];
    text = taskCardThemeTextFromParts(parts);
  } else {
    parts = [...first.display.parts];
    text = first.display.text;
  }
  const unavailableReason = !apiReady
    ? "Ledger Tools task-theme API is unavailable"
    : targets.find((target) => !target.available)?.unavailableReason ||
      (targets.length === 0 ? "No task targets are available" : null);
  const display = Object.freeze({
    parts: Object.freeze(parts),
    text,
    state: mixed ? "mixed" : first && first.display.state,
    unknown: !mixed && Boolean(first && first.display.unknown),
    needsRepair: !mixed && Boolean(first && first.display.needsRepair),
    tooltip: !mixed && first ? first.display.tooltip : unavailableReason,
  });
  return Object.freeze({
    available,
    unavailableReason,
    targetCount: targets.length,
    mixed,
    targets: Object.freeze(targets),
    display,
  });
}

function buildTaskCardThemeHeader(projection) {
  if (!projection || !projection.display) {
    return null;
  }
  const display = projection.display;
  const parts = Object.freeze([
    Object.freeze({ type: "label", text: "Theme " }),
    ...display.parts,
  ]);
  return Object.freeze({
    text: `Theme ${display.text}`,
    parts,
    state: display.state || "unavailable",
    unknown: display.unknown === true,
    needsRepair: display.needsRepair === true,
    mixed: projection.mixed === true,
    targetCount: projection.targetCount || 0,
    tooltip: display.tooltip || projection.unavailableReason || null,
  });
}
