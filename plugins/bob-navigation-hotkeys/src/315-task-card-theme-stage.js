// Pure Task Card theme stage model and direct-edit planner. It never writes.
// The modal supplies the live projection, theme API, and snapshots; this
// layer plans per-target set/clear/no-op edits and stage rows. Selecting Use
// default always clears; selecting the inherited theme also clears. Other
// choices follow the shared link write rule shape (single non-exempt
// component, catalog spelling) without requiring a shown suggestion.
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
  const fallback = ["PLAN"];
  const source = ledgerApi || api;
  try {
    const capsSource =
      source && typeof source.caps === "function" ? source.caps() : null;
    const caps = capsSource && typeof capsSource.then === "function" ? null : capsSource;
    if (caps && Array.isArray(caps.exempt)) {
      const keys = [];
      for (const value of caps.exempt) {
        if (typeof value !== "string" || !value.trim() || value.includes("+")) {
          return { available: false, keys: [] };
        }
        const canonical = taskCardThemeCanonicalName(value);
        if (!canonical) {
          return { available: false, keys: [] };
        }
        keys.push(value.trim());
      }
      return { available: true, keys };
    }
  } catch (_error) {
    // Fall through to the default exempt set.
  }
  return { available: true, keys: fallback.slice() };
}

function taskCardThemeSingleComponent(name, exemptKeys) {
  const text = String(name == null ? "" : name).trim();
  if (!text || text === "(unnamed)") {
    return null;
  }
  const exempt = new Set(
    (Array.isArray(exemptKeys) ? exemptKeys : [])
      .map((value) => taskCardThemeNormalizeKey(value))
      .filter(Boolean),
  );
  const choices = taskCardThemeSplitComponents(text).filter(
    (component) =>
      !exempt.has(taskCardThemeNormalizeKey(component)),
  );
  if (choices.length !== 1) {
    return null;
  }
  const canonical = taskCardThemeCanonicalName(choices[0]);
  if (!canonical) {
    return null;
  }
  return { name: canonical, key: taskCardThemeNormalizeKey(canonical) };
}

function taskCardThemeValidateNewName(raw, api, exemptKeys) {
  const canonical = taskCardThemeCanonicalName(raw);
  if (!canonical) {
    return Object.freeze({
      valid: false,
      name: null,
      key: null,
      error: "Theme name is invalid",
    });
  }
  const single = taskCardThemeSingleComponent(canonical, exemptKeys);
  if (!single) {
    const parts = taskCardThemeSplitComponents(canonical);
    if (parts.length !== 1) {
      return Object.freeze({
        valid: false,
        name: null,
        key: null,
        error: "Composite themes cannot be set on a task",
      });
    }
    return Object.freeze({
      valid: false,
      name: null,
      key: null,
      error: "Exempt themes cannot be set on a task",
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
  const sourceLabel = taskCardThemeSourceLabel(inherited);
  return `${name} from ${sourceLabel}`;
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
      detail: defaultDetail,
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
    if (!remember(key)) {
      continue;
    }
    let known = null;
    try {
      if (api && typeof api.isKnownTheme === "function") {
        known = api.isKnownTheme(key) === true;
      }
    } catch (_error) {
      known = null;
    }
    if (known === false) {
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
    const exempt = taskCardThemeExemptKeys(api, opts.ledgerApi);
    const validated = taskCardThemeValidateNewName(
      trimmedQuery,
      api,
      exempt.available ? exempt.keys : [],
    );
    if (validated.valid && remember(validated.key)) {
      rows.push(
        Object.freeze({
          kind: "new",
          key: validated.key,
          name: validated.name,
          title: validated.name,
          detail: "New theme",
        }),
      );
    }
  }
  return Object.freeze({
    query,
    mixed,
    targetCount: targets.length,
    defaultDetail,
    rows: Object.freeze(rows),
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
    return Object.freeze({ valid: false, error: "No theme choice", edits: Object.freeze([]) });
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
    return Object.freeze({ valid: false, error: "Theme name is invalid", edits: Object.freeze([]) });
  }
  const exempt = taskCardThemeExemptKeys(api, opts.ledgerApi);
  const exemptKeys = exempt.available ? exempt.keys : [];
  const validated = taskCardThemeValidateNewName(rawName, api, exemptKeys);
  if (!validated.valid) {
    return Object.freeze({ valid: false, error: validated.error, edits: Object.freeze([]) });
  }
  const spelling =
    taskCardThemeCatalogSpelling(api, validated.key, validated.name) || validated.name;
  const edits = targets.map((target) => {
    const inherited = target.inherited;
    const inheritedKey = inherited && inherited.theme && inherited.theme.key
      ? taskCardThemeNormalizeKey(inherited.theme.key)
      : null;
    if (inheritedKey && inheritedKey === validated.key) {
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
      if (fieldKey && fieldKey === validated.key) {
        return Object.freeze({
          target,
          action: "none",
          name: spelling,
          key: validated.key,
          reason: "same-key-noop",
        });
      }
    }
    return Object.freeze({
      target,
      action: "set",
      name: spelling,
      key: validated.key,
      reason: "set-theme",
    });
  });
  return Object.freeze({ valid: true, error: null, edits: Object.freeze(edits) });
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
      target.identity.path === identity.path &&
      target.identity.line === identity.line &&
      target.identity.rawLine === identity.rawLine
    );
  });
  if (!fresh || !fresh.available) {
    return { ok: false, reason: "Task changed; reopen the card" };
  }
  const beforeInherited = edit.target.inherited;
  const beforeKey = beforeInherited && beforeInherited.theme && beforeInherited.theme.key
    ? taskCardThemeNormalizeKey(beforeInherited.theme.key)
    : null;
  const afterInherited = fresh.inherited;
  const afterKey = afterInherited && afterInherited.theme && afterInherited.theme.key
    ? taskCardThemeNormalizeKey(afterInherited.theme.key)
    : null;
  if ((beforeKey || "") !== (afterKey || "")) {
    return { ok: false, reason: "Default changed; reopen the card" };
  }
  if (fresh.identity.rawLine !== identity.rawLine) {
    return { ok: false, reason: "Task changed; reopen the card" };
  }
  return { ok: true, fresh, reason: null };
}
