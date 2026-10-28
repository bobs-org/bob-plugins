// --- Pomodoro themes: pure JS mirror of bob-cli POM1 ------------------
// Pure mirror of bob-cli `src/native/pomodoro_themes/` (journal fold
// PT4, hue rule PT5, rank PT7 groups B/D) plus the PT7 near-duplicate
// rule and pill models. The desktop data path lives in
// 279-plugin-pomodoro-themes.js; this file never spawns bob and never
// touches the vault, so it also runs on mobile. Vectors in
// `scripts/fixtures/pomodoro_themes/vectors.json` are copied byte-for-byte
// from bob-cli; the Rust suite there is the source of truth.

const POMODORO_THEMES_SCHEMA_VERSION = 1;
const POMODORO_THEMES_FETCH_DEBOUNCE_MS = 3000;
const POMODORO_THEMES_JOURNAL_DIR = ".bob/themes";
const POMODORO_THEMES_HUE_SLOTS = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];
const POMODORO_THEMES_VIA = "bob-ledger-tools";

// ASCII-only lowercase, mirroring Rust's `to_ascii_lowercase` in
// `selector_slug`. Unicode case folding would rank non-ASCII names
// differently from bob.
function pomodoroThemeAsciiLower(value) {
  return String(value || "").replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase(),
  );
}

// Mirror of `plan_budget::normalize_component`: whitespace collapsed,
// lowercased. The theme key.
function pomodoroThemeNormalizeKey(value) {
  return normalizePlanComponent(value);
}

// Mirror of `plan_budget::split_components`: one `+`-separated component
// per theme; empty parts are dropped.
function pomodoroThemeSplitComponents(name) {
  return splitPlanComponents(name);
}

// Mirror of `capture_language::selector_slug`: whitespace runs become one
// `-`, ASCII-lowercased.
function pomodoroThemeSelectorSlug(text) {
  const words = String(text || "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return pomodoroThemeAsciiLower(words.join("-"));
}

// Every `+`-separated component with its display spelling, key, and byte
// offsets into the name. Quotes and `+` separators are excluded, matching
// the `capture-parse` ThemeRef contract.
function pomodoroThemeComponentsWithOffsets(name) {
  const text = String(name || "");
  const out = [];
  let index = 0;
  for (const part of text.split("+")) {
    const leading = part.match(/^[ \t]*/)[0].length;
    const trailing = part.match(/[ \t]*$/)[0].length;
    const start = index + leading;
    const end = index + part.length - trailing;
    if (end > start) {
      const raw = text.slice(start, end);
      out.push({ raw, key: pomodoroThemeNormalizeKey(raw), start, end });
    }
    index += part.length + 1;
  }
  return out;
}

// Display spelling plus key per component, without offsets.
function pomodoroThemeComponentsOf(name) {
  return pomodoroThemeComponentsWithOffsets(name).map((component) => ({
    raw: component.raw,
    key: component.key,
  }));
}

// Mirror of `pomodoro_homes::fallback_hue`: FNV-1a over the lowercased
// key bytes, mod 8. Reuses the home-chip hash so both mirrors agree.
function pomodoroThemeFallbackHue(key) {
  return POMODORO_HOME_SLOT_ORDER[
    pomodoroHomeFnv1a(key) % POMODORO_HOME_SLOT_ORDER.length
  ];
}

// Mirror of `pomodoro_themes::resolve_hue` (PT5, area_hues = area): a
// journal pin wins, then a normalized `plan.exempt` entry is muted, then
// a top-level area stem wears that area's resolved hue, else the name
// hash. `options` takes `{ pin, exempt, areas }` where `exempt` is an
// array of keys and `areas` maps key to hue slot.
function pomodoroThemeResolveHue(key, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const pin =
    typeof opts.pin === "string" && POMODORO_THEMES_HUE_SLOTS.includes(opts.pin)
      ? opts.pin
      : null;
  if (pin) {
    return { hue: pin, hue_source: "pin" };
  }
  const exempt = Array.isArray(opts.exempt) ? opts.exempt : [];
  if (exempt.includes(key)) {
    return { hue: null, hue_source: "exempt" };
  }
  const areas =
    opts.areas && typeof opts.areas === "object" && !Array.isArray(opts.areas)
      ? opts.areas
      : {};
  const areaHue = areas[key];
  if (
    typeof areaHue === "string" &&
    POMODORO_THEMES_HUE_SLOTS.includes(areaHue)
  ) {
    return { hue: areaHue, hue_source: "area" };
  }
  return { hue: pomodoroThemeFallbackHue(key), hue_source: "hash" };
}

// Mirror of Rust's journal `parse_event`: one `.bob/themes/*.jsonl`
// line. Returns null for malformed lines (the caller counts a bounded
// warning). `path`/`line` ride along for the fold sort.
function pomodoroThemeParseJournalLine(text, path, lineNumber) {
  try {
    const value = JSON.parse(String(text || ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    if (value.v !== 1) {
      return null;
    }
    const tsRaw = typeof value.ts === "string" ? value.ts : "";
    const tsMs = Date.parse(tsRaw);
    if (!tsRaw || !Number.isFinite(tsMs)) {
      return null;
    }
    const host =
      typeof value.host === "string" && value.host ? value.host : "";
    if (!host) {
      return null;
    }
    const kind = value.kind;
    const keyOf = (field) => {
      const raw = value[field];
      if (typeof raw !== "string" || !raw.trim()) {
        return null;
      }
      return pomodoroThemeNormalizeKey(raw);
    };
    const nameOf = (field) =>
      typeof value[field] === "string" ? value[field] : "";
    let payload = null;
    if (kind === "theme.hide") {
      const key = keyOf("key");
      if (!key) {
        return null;
      }
      payload = { kind, key, name: nameOf("name") };
    } else if (kind === "theme.unhide") {
      const key = keyOf("key");
      if (!key) {
        return null;
      }
      payload = { kind, key, name: nameOf("name") };
    } else if (kind === "theme.color") {
      const key = keyOf("key");
      if (!key || !Object.prototype.hasOwnProperty.call(value, "hue")) {
        return null;
      }
      const hue =
        value.hue === null
          ? null
          : typeof value.hue === "string" &&
              POMODORO_THEMES_HUE_SLOTS.includes(
                value.hue.trim().toLowerCase(),
              )
            ? value.hue.trim().toLowerCase()
            : undefined;
      if (hue === undefined) {
        return null;
      }
      payload = { kind, key, name: nameOf("name"), hue };
    } else if (kind === "theme.rename") {
      const from = keyOf("from");
      const to = keyOf("to");
      if (!from || !to) {
        return null;
      }
      payload = {
        kind,
        from,
        to,
        from_name: nameOf("from_name"),
        to_name: nameOf("to_name"),
      };
    } else {
      return null;
    }
    return {
      tsMs,
      tsRaw,
      host,
      path: typeof path === "string" ? path : "",
      line: Number.isInteger(lineNumber) ? lineNumber : 0,
      ...payload,
    };
  } catch (error) {
    return null;
  }
}

// Mirror of Rust's journal `fold_events`: sort by (ts instant, host,
// path, line), last writer wins per key for hidden and pin. A rename
// moves the source key's explicit state to the target unless the target
// already has explicit state of its own; later events on the old key
// apply to the old key.
function pomodoroThemeFoldEvents(events) {
  const ordered = (Array.isArray(events) ? events : []).slice();
  ordered.sort((left, right) => {
    if (left.tsMs !== right.tsMs) {
      return left.tsMs - right.tsMs;
    }
    if (left.host !== right.host) {
      return left.host < right.host ? -1 : 1;
    }
    if (left.path !== right.path) {
      return left.path < right.path ? -1 : 1;
    }
    return (left.line || 0) - (right.line || 0);
  });
  const byKey = {};
  for (const event of ordered) {
    if (!event || typeof event.kind !== "string") {
      continue;
    }
    if (event.kind === "theme.hide") {
      const pref = byKey[event.key] || { hidden: false, pin: null };
      pref.hidden = true;
      byKey[event.key] = pref;
    } else if (event.kind === "theme.unhide") {
      const pref = byKey[event.key] || { hidden: false, pin: null };
      pref.hidden = false;
      byKey[event.key] = pref;
    } else if (event.kind === "theme.color") {
      const pref = byKey[event.key] || { hidden: false, pin: null };
      pref.pin = event.hue;
      byKey[event.key] = pref;
    } else if (event.kind === "theme.rename") {
      if (event.from === event.to) {
        continue;
      }
      const source = byKey[event.from];
      const targetHasState = Object.prototype.hasOwnProperty.call(
        byKey,
        event.to,
      );
      if (source && !targetHasState) {
        byKey[event.to] = source;
        delete byKey[event.from];
      }
    }
  }
  return { byKey };
}

// Levenshtein distance capped at 2: anything above 1 is just "far".
function pomodoroThemeLevenshteinCapped(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return 2;
  }
  let prev = [];
  for (let j = 0; j <= b.length; j += 1) {
    prev.push(j);
  }
  for (let i = 1; i <= a.length; i += 1) {
    let curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(value);
      if (value < rowMin) {
        rowMin = value;
      }
    }
    if (rowMin > 1) {
      return 2;
    }
    prev = curr;
  }
  return prev[b.length] > 1 ? 2 : prev[b.length];
}

function pomodoroThemeStripPunctuation(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// PT7 near-duplicate heads-up (ADJ-8): at most 2 visible known names,
// most recent first. A name qualifies when its key equals the query
// modulo space, hyphen, and punctuation, is its plural or singular
// (`s`, `es`), or is within Levenshtein distance 1 when both keys have
// at least 5 characters. Needs a query key of at least 3 characters.
function pomodoroThemeSimilarKeys(queryKey, themes) {
  const query = String(queryKey || "");
  if (query.length < 3) {
    return [];
  }
  const strippedQuery = pomodoroThemeStripPunctuation(query);
  const matches = [];
  for (const theme of Array.isArray(themes) ? themes : []) {
    if (!theme || typeof theme.key !== "string") {
      continue;
    }
    const key = theme.key;
    if (!key || key === query) {
      continue;
    }
    let qualifies = false;
    if (
      strippedQuery &&
      pomodoroThemeStripPunctuation(key) === strippedQuery
    ) {
      qualifies = true;
    }
    if (
      !qualifies &&
      (key === `${query}s` ||
        key === `${query}es` ||
        query === `${key}s` ||
        query === `${key}es`)
    ) {
      qualifies = true;
    }
    if (
      !qualifies &&
      query.length >= 5 &&
      key.length >= 5 &&
      pomodoroThemeLevenshteinCapped(query, key) <= 1
    ) {
      qualifies = true;
    }
    if (qualifies) {
      matches.push(theme);
    }
  }
  matches.sort((left, right) => {
    const leftDate = typeof left.last_used === "string" ? left.last_used : "";
    const rightDate = typeof right.last_used === "string" ? right.last_used : "";
    if (rightDate !== leftDate) {
      return rightDate < leftDate ? -1 : 1;
    }
    return String(left.key || "") < String(right.key || "") ? -1 : 1;
  });
  return matches.slice(0, 2).map((theme) => theme.key);
}

// Mirror of `pomodoro_themes::rank_history` (PT7 groups B exact/prefix
// then D substring). Hidden filtering and components of the caller's
// displayed Today rows excluded by the caller. `themes` entries carry
// `{ key, name, last_used,
// days_used }`; `exclusions` is an array or Set of keys.
function pomodoroThemeRankHistory(themes, query, exclusions) {
  const list = Array.isArray(themes) ? themes : [];
  const excluded = new Set(
    exclusions instanceof Set
      ? [...exclusions]
      : Array.isArray(exclusions)
        ? exclusions
        : [],
  );
  const compareRecent = (left, right) => {
    const leftDate = typeof left.last_used === "string" ? left.last_used : "";
    const rightDate =
      typeof right.last_used === "string" ? right.last_used : "";
    if (rightDate !== leftDate) {
      return rightDate < leftDate ? -1 : 1;
    }
    const days = (Number(right.days_used) || 0) - (Number(left.days_used) || 0);
    if (days !== 0) {
      return days;
    }
    const leftName = String(left.name || "");
    const rightName = String(right.name || "");
    if (leftName !== rightName) {
      return leftName < rightName ? -1 : 1;
    }
    const leftKey = String(left.key || "");
    const rightKey = String(right.key || "");
    if (leftKey !== rightKey) {
      return leftKey < rightKey ? -1 : 1;
    }
    return 0;
  };
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return list
      .filter((theme) => theme && !excluded.has(theme.key))
      .sort(compareRecent);
  }
  const querySlug = pomodoroThemeSelectorSlug(trimmed);
  const queryKey = pomodoroThemeNormalizeKey(trimmed);
  const groupB = [];
  const groupD = [];
  for (const theme of list) {
    if (!theme || excluded.has(theme.key)) {
      continue;
    }
    const slug = pomodoroThemeSelectorSlug(theme.name);
    const key = String(theme.key || "");
    const exact = slug === querySlug || key === queryKey;
    const prefix =
      !exact &&
      ((querySlug && slug.startsWith(querySlug)) ||
        (queryKey && key.startsWith(queryKey)));
    if (exact || prefix) {
      groupB.push({ exact, theme });
      continue;
    }
    const substring =
      (querySlug && slug.includes(querySlug)) ||
      (queryKey && key.includes(queryKey));
    if (substring) {
      groupD.push(theme);
    }
  }
  groupB.sort((left, right) => {
    if (right.exact !== left.exact) {
      return right.exact ? 1 : -1;
    }
    return compareRecent(left.theme, right.theme);
  });
  groupD.sort(compareRecent);
  return [...groupB.map((entry) => entry.theme), ...groupD];
}

// Display pill models for one Pomodoro name: each component gets its
// own pill and the `+` stays neutral. `hueFor` maps a key to
// `{ hue, hue_source }` (or null); without it every pill is neutral.
function pomodoroThemePillModels(name, hueFor) {
  const resolve = typeof hueFor === "function" ? hueFor : () => null;
  const pills = [];
  for (const component of pomodoroThemeComponentsWithOffsets(name)) {
    let hue = null;
    let hueSource = null;
    try {
      const resolved = resolve(component.key, component.raw);
      if (resolved && typeof resolved === "object") {
        hue = resolved.hue || null;
        hueSource = resolved.hue_source || null;
      }
    } catch (error) {
      hue = null;
      hueSource = null;
    }
    pills.push({
      text: component.raw,
      key: component.key,
      start: component.start,
      end: component.end,
      hue:
        typeof hue === "string" &&
        POMODORO_THEMES_HUE_SLOTS.includes(hue)
          ? hue
          : null,
      hueSource,
      muted: hueSource === "exempt",
    });
  }
  return pills;
}

// Defensive decode of `bob themes list -a -f json`: accept schema 1
// reports, reject everything else with a named error. Never throws.
function pomodoroThemesDecodeReport(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "bad-json",
      message: "bob themes returned output that is not JSON.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob themes returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== POMODORO_THEMES_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema-mismatch",
      message: `bob themes returned schema ${String(body.schema_version)}, this block reads schema ${POMODORO_THEMES_SCHEMA_VERSION}.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (!Array.isArray(body.themes)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob themes returned a report without themes.",
      detail: statsFirstLine(stderr),
    };
  }
  const sanitizeTheme = (entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const key =
      typeof entry.key === "string" && entry.key ? entry.key : null;
    const name =
      typeof entry.name === "string" && entry.name ? entry.name : null;
    if (!key || !name) {
      return null;
    }
    const hue =
      typeof entry.hue === "string" &&
      POMODORO_THEMES_HUE_SLOTS.includes(entry.hue)
        ? entry.hue
        : null;
    const hueSource =
      typeof entry.hue_source === "string" && entry.hue_source
        ? entry.hue_source
        : "hash";
    return {
      key,
      name,
      hue,
      hue_source: hueSource,
      pinned: entry.pinned === true,
      hidden: entry.hidden === true,
      exempt: entry.exempt === true,
      first_used: typeof entry.first_used === "string" ? entry.first_used : "",
      last_used: typeof entry.last_used === "string" ? entry.last_used : "",
      days_used: Number.isFinite(Number(entry.days_used))
        ? Number(entry.days_used)
        : 0,
      entries: Number.isFinite(Number(entry.entries))
        ? Number(entry.entries)
        : 0,
      today:
        entry.today === "open" || entry.today === "closed"
          ? entry.today
          : null,
    };
  };
  return {
    ok: true,
    report: {
      schema_version: POMODORO_THEMES_SCHEMA_VERSION,
      today: typeof body.today === "string" ? body.today : "",
      window_days: Number.isFinite(Number(body.window_days))
        ? Number(body.window_days)
        : 90,
      counts:
        body.counts && typeof body.counts === "object" ? body.counts : {},
      themes: body.themes.map(sanitizeTheme).filter(Boolean),
      hints: Array.isArray(body.hints) ? body.hints : [],
      renamed_reappeared: Array.isArray(body.renamed_reappeared)
        ? body.renamed_reappeared
        : [],
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    },
  };
}

function pomodoroThemesEmptyReport() {
  return {
    schema_version: POMODORO_THEMES_SCHEMA_VERSION,
    today: "",
    window_days: 90,
    counts: {},
    themes: [],
    hints: [],
    renamed_reappeared: [],
    warnings: [],
  };
}

// Decode one writer call (`hide`, `unhide`, `color`, `rename`): the
// `{ ok, ... }` shape, with `{ ok: false, code }` on refusal even at a
// nonzero exit. A non-JSON reply means the installed bob predates the
// writers; callers report "Update bob to hide themes".
function pomodoroThemesDecodeWrite(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to hide themes.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: "bob themes returned an unexpected JSON shape.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === true) {
    return { ok: true, report: body };
  }
  return {
    ok: false,
    code:
      typeof body.code === "string" && body.code ? body.code : "bob-error",
    message:
      typeof body.message === "string" && body.message
        ? body.message
        : "bob themes reported an error.",
    detail: statsFirstLine(stderr),
  };
}

