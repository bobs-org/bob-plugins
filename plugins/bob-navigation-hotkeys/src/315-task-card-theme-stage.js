// Pure Task Card type stage model and direct-edit planner. It never writes.
// The modal supplies the live projection, theme API, and snapshots; this
// layer plans per-target set/clear/no-op edits and stage rows. Selecting Use
// default always clears; selecting the inherited type also clears. Other
// choices are any single type component (including PLAN and other exempt
// types) with catalog spelling, without requiring a shown suggestion.
function taskCardThemeNormalizeKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function taskCardThemeCanonicalName(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const name = String(raw == null ? "" : raw)
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ")
    .replace(/[a-z]/g, (letter) => letter.toUpperCase());
  if (!/^[A-Z0-9]/.test(name) || !/[A-Z]/.test(name)) {
    return null;
  }
  return /^[A-Z0-9 &'(),.\/-]*$/.test(name) ? name : null;
}

function taskCardThemeSplitComponents(name) {
  return String(name == null ? "" : name)
    .split("+")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function taskCardThemeCatalogSpelling(api, key, fallback) {
  const normalized = taskCardThemeNormalizeKey(key);
  const fallbackName =
    typeof fallback === "string" && fallback ? fallback : null;
  if (!normalized) {
    return fallbackName;
  }
  try {
    if (!api || typeof api.snapshot !== "function") {
      return fallbackName;
    }
    const snapshot = api.snapshot();
    const lists = [];
    if (snapshot && Array.isArray(snapshot.themes)) {
      lists.push(snapshot.themes);
    }
    if (snapshot && Array.isArray(snapshot.configured_themes)) {
      lists.push(snapshot.configured_themes);
    }
    for (const list of lists) {
      for (const entry of list) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        if (taskCardThemeNormalizeKey(entry.key) !== normalized) {
          continue;
        }
        if (typeof entry.name === "string" && entry.name) {
          return entry.name;
        }
      }
    }
  } catch (_error) {
    return fallbackName;
  }
  return fallbackName;
}

function taskCardThemeExemptKeys(api, ledgerApi) {
  const source = ledgerApi || api;
  try {
    if (!source || typeof source.caps !== "function") {
      return { available: false, keys: [] };
    }
    const caps = source.caps();
    if (
      !caps || typeof caps !== "object" || Array.isArray(caps) ||
      typeof caps.then === "function" || !Array.isArray(caps.exempt)
    ) {
      return { available: false, keys: [] };
    }
    const keys = [];
    for (const value of caps.exempt) {
      if (typeof value !== "string" || !value.trim() || /[\r\n+]/.test(value)) {
        return { available: false, keys: [] };
      }
      const canonical = taskCardThemeCanonicalName(value);
      if (!canonical) {
        return { available: false, keys: [] };
      }
      keys.push(value.trim());
    }
    return { available: true, keys };
  } catch (_error) {
    return { available: false, keys: [] };
  }
}

function taskCardThemeSingleComponent(name) {
  const text = String(name == null ? "" : name).trim();
  if (!text || text === "(unnamed)") {
    return null;
  }
  const choices = taskCardThemeSplitComponents(text);
  if (choices.length !== 1) {
    return null;
  }
  const canonical = taskCardThemeCanonicalName(choices[0]);
  if (!canonical) {
    return null;
  }
  return { name: canonical, key: taskCardThemeNormalizeKey(canonical) };
}

function taskCardThemeValidateNewName(raw, api) {
  const canonical = taskCardThemeCanonicalName(raw);
  if (!canonical) {
    return Object.freeze({
      valid: false,
      name: null,
      key: null,
      error: "Type name is invalid",
    });
  }
  const single = taskCardThemeSingleComponent(canonical);
  if (!single) {
    return Object.freeze({
      valid: false,
      name: null,
      key: null,
      error: "Composite types cannot be set on a task",
    });
  }
  const spelling =
    taskCardThemeCatalogSpelling(api, single.key, single.name) || single.name;
  return Object.freeze({ valid: true, name: spelling, key: single.key, error: null });
}

function taskCardThemeStageInheritedReason(inherited) {
  if (!inherited || !inherited.theme) {
    return "no default";
  }
  const name = inherited.theme.name || inherited.theme.key || "default";
  if (inherited.source === "default") {
    return `${name} default type`;
  }
  const sourceLabel = taskCardThemeSourceLabel(inherited);
  return `${name} from ${sourceLabel}`;
}

function taskCardTypeInheritedReason(inherited) {
  return taskCardThemeStageInheritedReason(inherited);
}

function taskCardThemeInheritedSourceText(inherited) {
  try {
    const note = taskCardThemeNoteSource(inherited);
    if (!note) return null;
    const kind = inherited.from && inherited.from.kind;
    const label = kind === "area" ? "area note" : kind === "project" ? "project note" : "note";
    return `${label} ${note.stem}`;
  } catch (_error) {
    return null;
  }
}

function taskCardThemeNoticeContext(edit) {
  const inherited = edit && edit.target && edit.target.inherited;
  const theme = inherited && inherited.theme;
  const name = theme && (theme.name || theme.key);
  return {
    name: typeof name === "string" ? name : null,
    source: taskCardThemeInheritedSourceText(inherited),
    reading: inherited && inherited.source === "reading",
  };
}

function taskCardTypeUnchangedNotice(edits) {
  return taskCardThemeUnchangedNotice(edits);
}

function taskCardThemeUnchangedNotice(edits) {
  const fallback = "Types are already set; nothing was written";
  try {
    if (!Array.isArray(edits) || edits.length === 0) return fallback;
    const entries = edits.map((edit) => {
      const context = taskCardThemeNoticeContext(edit);
      const kind = edit.action === "none" || edit.action === "set" ? "same"
        : edit.action === "clear" && edit.reason === "select-inherited-clears" ? "inherited"
          : edit.action === "clear" && edit.reason === "use-default" ? "default" : null;
      return { ...context, kind, name: kind === "same" ? edit.name : context.name };
    });
    let text;
    const first = entries[0];
    if (entries.length === 1) {
      const { kind, name, source, reading } = first;
      if (kind === "default") {
        const reason = source ? `${name} from ${source}` : reading ? `${name} for reading tasks` : name;
        text = name ? `Already using the default (${reason})` : "No type override to clear";
      } else if (typeof name !== "string" || !name) {
        return fallback;
      } else if (kind === "same") {
        text = `${name} is already set on this task`;
      } else if (kind === "inherited") {
        text = source ? `${name} is already inherited from ${source}`
          : reading ? `${name} is already the default for reading tasks`
            : `${name} is already this task's default`;
      }
    } else {
      const count = formatCountLabel(entries.length, "task");
      if (entries.every((entry) => entry.kind === "default")) {
        text = `All ${count} already use their defaults`;
      } else if (typeof first.name === "string" && first.name && entries.every((entry) =>
        typeof entry.name === "string" && taskCardThemeNormalizeKey(entry.name) === taskCardThemeNormalizeKey(first.name))) {
        if (entries.every((entry) => entry.kind === "inherited")) {
          const source = first.source && entries.every((entry) => entry.source === first.source)
            ? ` from ${first.source}` : "";
          text = `${first.name} is already inherited${source} by all ${count}`;
        } else if (entries.every((entry) => entry.kind === "same")) {
          text = `${first.name} is already set on all ${count}`;
        } else if (entries.every((entry) => entry.kind === "same" || entry.kind === "inherited")) {
          text = `${first.name} already applies to all ${count}`;
        }
      }
    }
    return text ? `${text}; nothing was written` : fallback;
  } catch (_error) {
    return fallback;
  }
}

function taskCardTypeSavedNotice(edit, relocation) {
  return taskCardThemeSavedNotice(edit, relocation);
}

function taskCardTypeNoticeInheritedReason(edit) {
  const { name, source, reading } = taskCardThemeNoticeContext(edit);
  if (!name) return null;
  if (source) return `${name} from ${source}`;
  if (reading) return `${name} for reading tasks`;
  return name;
}

function taskCardThemeSavedNotice(edit, relocation) {
  try {
    const moved = relocation && relocation.moved === true
      ? relocation.destinationName || relocation.newTypeName || null
      : null;
    const partial = relocation && relocation.partial === true;
    if (edit && edit.action === "set" && typeof edit.name === "string" && edit.name) {
      if (partial) {
        return `Type ${edit.name} set · link not moved — Ctrl+Shift+M to move it`;
      }
      if (moved) {
        return `Type ${edit.name} · link moved to ${moved}`;
      }
      return `Type ${edit.name}`;
    }
    if (!edit || edit.action !== "clear") return "Type saved";
    const { name, source, reading } = taskCardThemeNoticeContext(edit);
    const inheritedLong = name
      ? (source ? `${name} from ${source}`
        : reading ? `${name} for reading tasks` : name)
      : null;
    const inheritedShort = (() => {
      try {
        const reason = taskCardThemeStageInheritedReason(edit.target && edit.target.inherited);
        return reason && reason !== "no default" ? reason : inheritedLong;
      } catch (_error) {
        return inheritedLong;
      }
    })();
    if (!name) {
      if (partial) {
        return "Type cleared · link not moved — Ctrl+Shift+M to move it";
      }
      return moved ? `Type cleared · link moved to ${moved}` : "Type cleared to default";
    }
    if (partial) {
      return inheritedShort
        ? `Type cleared · ${inheritedShort} · link not moved — Ctrl+Shift+M to move it`
        : "Type cleared · link not moved — Ctrl+Shift+M to move it";
    }
    if (moved) {
      return inheritedShort
        ? `Type cleared · ${inheritedShort} · link moved to ${moved}`
        : `Type cleared · link moved to ${moved}`;
    }
    const prefix = edit.reason === "select-inherited-clears"
      ? edit.target.field && edit.target.field.state === "repair" ? "Type fields repaired" : "Override removed"
      : "Type cleared";
    const reason = source ? `${name} is inherited from ${source}`
      : reading ? `${name} is the default for reading tasks` : `${name} is this task's default`;
    return `${prefix}; ${reason}`;
  } catch (_error) {
    return "Type saved";
  }
}

function taskCardThemeStageItem(row) {
  return Object.freeze({
    key: row.kind === "default" ? "__default" : `theme-${row.key}`,
    themeKind: row.kind,
    themeKey: row.key,
    themeName: row.name,
    title: row.kind === "default" ? "Use default" : row.title,
    detail: row.detail,
    searchText: row.kind === "default" ? `use default ${row.detail}` : `${row.title || ""} ${row.detail || ""} ${row.key || ""}`,
    inheritedDefault: row.inheritedDefault === true,
    inheritedFrom: row.inheritedFrom || null,
  });
}

function taskCardThemeStageTodayNames(api) {
  const names = new Map();
  try {
    if (!api || typeof api.snapshot !== "function") {
      return names;
    }
    const snapshot = api.snapshot();
    const lists = [];
    if (snapshot && Array.isArray(snapshot.themes)) {
      lists.push(snapshot.themes);
    }
    if (snapshot && Array.isArray(snapshot.configured_themes)) {
      lists.push(snapshot.configured_themes);
    }
    for (const list of lists) {
      for (const entry of list) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        // Today membership is advisory: entries stamped for today surface
        // first. Entries without today metadata still reach Recent below.
        if (!entry.today) {
          continue;
        }
        const rawName = typeof entry.name === "string" ? entry.name : "";
        if (!rawName) {
          continue;
        }
        for (const part of taskCardThemeSplitComponents(rawName)) {
          const canonical = taskCardThemeCanonicalName(part);
          if (!canonical) {
            continue;
          }
          const key = taskCardThemeNormalizeKey(canonical);
          if (!key || names.has(key)) {
            continue;
          }
          const spelling =
            taskCardThemeCatalogSpelling(api, key, canonical) || canonical;
          names.set(key, spelling);
        }
      }
    }
  } catch (_error) {
    // Today names are best-effort; Recent still covers the catalog.
  }
  return names;
}

function taskCardThemeStageRecentRows(api, query, exclusions) {
  try {
    if (!api || typeof api.historyRows !== "function") {
      return [];
    }
    const rows = api.historyRows({
      query: typeof query === "string" ? query : "",
      limit: 100,
      exclusions,
    });
    return Array.isArray(rows) ? rows : [];
  } catch (_error) {
    return [];
  }
}

function buildTaskCardThemeStageModel(projection, api, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const query = typeof opts.query === "string" ? opts.query : "";
  const trimmedQuery = query.trim();
  const targets = projection && Array.isArray(projection.targets)
    ? projection.targets.filter((target) => target && target.available)
    : [];
  const mixed = projection ? projection.mixed === true : targets.length > 1;
  const inheritedKeys = new Map();
  for (const target of targets) {
    const inherited = target.inherited;
    const theme = inherited && inherited.theme;
    const key = theme && theme.key ? taskCardThemeNormalizeKey(theme.key) : "";
    if (key && !inheritedKeys.has(key)) {
      inheritedKeys.set(key, theme.name || key);
    }
  }
  const firstInherited = targets.length === 1 ? targets[0].inherited : null;
  const defaultDetail = mixed
    ? `clear each task to its own default (${targets.length} tasks)`
    : `Use default · ${taskCardThemeStageInheritedReason(firstInherited)}`;
  const rows = [];
  rows.push(
    Object.freeze({
      kind: "default",
      key: "__default",
      name: null,
      title: "Use default",
      detail: mixed ? defaultDetail : taskCardThemeStageInheritedReason(firstInherited),
    }),
  );
  const seen = new Set(["__default"]);
  const remember = (key) => {
    const normalized = taskCardThemeNormalizeKey(key);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  };
  // Unknown inherited names stay selectable without preselection.
  for (const [key, name] of inheritedKeys) {
    let known = null;
    try {
      if (api && typeof api.isKnownTheme === "function") {
        known = api.isKnownTheme(key) === true;
      }
    } catch (_error) {
      known = null;
    }
    if (known === false) {
      if (!remember(key)) {
        continue;
      }
      rows.push(
        Object.freeze({
          kind: "inherited-unknown",
          key,
          name: taskCardThemeCatalogSpelling(api, key, name) || name,
          title: name,
          detail: "current default · not in catalog",
        }),
      );
    }
  }
  const todayNames = taskCardThemeStageTodayNames(api);
  for (const [key, name] of todayNames) {
    if (!remember(key)) {
      continue;
    }
    rows.push(
      Object.freeze({
        kind: "today",
        key,
        name,
        title: name,
        detail: "Today",
      }),
    );
  }
  const exclusions = new Set();
  const recent = taskCardThemeStageRecentRows(api, trimmedQuery, exclusions);
  for (const entry of recent) {
    if (!entry || typeof entry.key !== "string" || !entry.key) {
      continue;
    }
    const key = taskCardThemeNormalizeKey(entry.key);
    if (!remember(key)) {
      continue;
    }
    const spelling =
      taskCardThemeCatalogSpelling(api, key, entry.name) || entry.name || key;
    rows.push(
      Object.freeze({
        kind: "recent",
        key,
        name: spelling,
        title: spelling,
        detail: "Recent",
      }),
    );
  }
  if (trimmedQuery) {
    const validated = taskCardThemeValidateNewName(trimmedQuery, api);
    if (validated.valid && remember(validated.key)) {
      rows.push(
        Object.freeze({
          kind: "new",
          key: validated.key,
          name: validated.name,
          title: validated.name,
          detail: "New type",
        }),
      );
    }
  }
  return Object.freeze({
    query,
    mixed,
    targetCount: targets.length,
    defaultDetail,
    rows: Object.freeze(rows.map((row) => {
      const inheritedKey = firstInherited && firstInherited.theme && firstInherited.theme.key;
      if (mixed || !inheritedKey || !["today", "recent", "new"].includes(row.kind) ||
          row.key !== taskCardThemeNormalizeKey(inheritedKey)) return row;
      return Object.freeze({
        ...row,
        inheritedDefault: true,
        inheritedFrom: taskCardThemeInheritedSourceText(firstInherited) ||
          (firstInherited.source === "reading" ? "reading tasks" : null),
      });
    })),
  });
}

function taskCardThemeFieldKey(field) {
  if (!field || typeof field !== "object") {
    return null;
  }
  if (typeof field.key === "string" && field.key) {
    return taskCardThemeNormalizeKey(field.key);
  }
  if (typeof field.value === "string" && field.value) {
    const canonical = taskCardThemeCanonicalName(field.value);
    return canonical ? taskCardThemeNormalizeKey(canonical) : null;
  }
  return null;
}

function planTaskCardThemeEdits(projection, selection, api, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const targets = projection && Array.isArray(projection.targets)
    ? projection.targets.filter((target) => target && target.available)
    : [];
  if (targets.length === 0) {
    return Object.freeze({ valid: false, error: "No editable tasks", edits: Object.freeze([]) });
  }
  if (!selection || typeof selection !== "object") {
    return Object.freeze({ valid: false, error: "No type choice", edits: Object.freeze([]) });
  }
  if (selection.kind === "default") {
    const edits = targets.map((target) =>
      Object.freeze({
        target,
        action: "clear",
        name: null,
        key: null,
        reason: "use-default",
      }),
    );
    return Object.freeze({ valid: true, error: null, edits: Object.freeze(edits) });
  }
  const key = taskCardThemeNormalizeKey(selection.key || selection.name);
  const rawName = typeof selection.name === "string" && selection.name
    ? selection.name
    : typeof selection.key === "string"
      ? selection.key
      : "";
  if (!key) {
    return Object.freeze({ valid: false, error: "Type name is invalid", edits: Object.freeze([]) });
  }
  const candidate = taskCardThemeSingleComponent(rawName);
  if (!candidate) {
    const error = taskCardThemeSplitComponents(rawName).length !== 1
      ? "Composite types cannot be set on a task"
      : "Type name is invalid";
    return Object.freeze({ valid: false, error, edits: Object.freeze([]) });
  }
  const spelling = taskCardThemeCatalogSpelling(api, candidate.key, candidate.name) || candidate.name;
  const planned = targets.map((target) => {
    const inherited = target.inherited;
    const inheritedKey = inherited && inherited.theme && inherited.theme.key
      ? taskCardThemeNormalizeKey(inherited.theme.key)
      : null;
    if (inheritedKey && inheritedKey === candidate.key) {
      return Object.freeze({
        target,
        action: "clear",
        name: null,
        key: null,
        reason: "select-inherited-clears",
      });
    }
    if (target.field && target.field.state === "set") {
      const fieldKey = taskCardThemeFieldKey(target.field);
      if (fieldKey && fieldKey === candidate.key) {
        return Object.freeze({
          target,
          action: "none",
          name: spelling,
          key: candidate.key,
          reason: "same-key-noop",
        });
      }
    }
    return Object.freeze({
      target,
      action: "set",
      name: spelling,
      key: candidate.key,
      reason: "set-theme",
    });
  });
  const edits = planned;
  return Object.freeze({ valid: true, error: null, edits: Object.freeze(edits) });
}

function taskCardThemeDecisionIdentity(suggestion) {
  if (!suggestion || typeof suggestion !== "object") {
    return null;
  }
  const theme = suggestion.theme && typeof suggestion.theme === "object"
    ? suggestion.theme
    : {};
  const from = suggestion.from && typeof suggestion.from === "object"
    ? suggestion.from
    : {};
  const inherited = suggestion.inherited && typeof suggestion.inherited === "object"
    ? taskCardThemeDecisionIdentity(suggestion.inherited)
    : null;
  return JSON.stringify({
    source: suggestion.source || null,
    label: suggestion.label || null,
    themeKey: theme.key ? taskCardThemeNormalizeKey(theme.key) : null,
    fromPath: normalizeVaultRelativePath(from.path || "") || null,
    fromStem: normalizeBulletPropertyValue(from.stem || "") || null,
    inherited,
  });
}

function taskCardThemeRevalidateEdit(edit, freshProjection) {
  if (!edit || !freshProjection || !Array.isArray(freshProjection.targets)) {
    return { ok: false, reason: "Task context is unavailable" };
  }
  const identity = edit.target && edit.target.identity;
  const fresh = freshProjection.targets.find((target) => {
    if (!target || !target.identity || !identity) {
      return false;
    }
    return (
      target.identity.id === identity.id &&
      target.identity.path === identity.path &&
      target.identity.line === identity.line &&
      target.identity.blockId === identity.blockId &&
      target.identity.rawLine === identity.rawLine
    );
  });
  if (!fresh || !fresh.available) {
    return { ok: false, reason: "Task changed; reopen the card" };
  }
  if (
    taskCardThemeDecisionIdentity(edit.target.inherited) !==
    taskCardThemeDecisionIdentity(fresh.inherited)
  ) {
    return { ok: false, reason: "Default changed; reopen the card" };
  }
  if (fresh.identity.rawLine !== identity.rawLine) {
    return { ok: false, reason: "Task changed; reopen the card" };
  }
  return { ok: true, fresh, reason: null };
}
