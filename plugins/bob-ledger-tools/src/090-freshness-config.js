// --- Task freshness: config -------------------------------------------------
// Beside `planCapsBlock` / `coercePlanCaps`: the `freshness:` block in
// `~/.config/bob/config.yml` (`interval`, `pending_interval`,
// `next_interval`, `rotten_daily_budget`, `decay`).
// The removed `stale_daily_budget` key still supplies the budget for
// one release with a deprecation lint.
// Mirrors `docs/freshness.md` §§2-2a in bob-cli (freshness namespace v13).

// Whether the compatible review-walk decision card is present: nav exposes
// `api.freshnessDecayCard.version >= 2` (ungated handler contract). Version
// 1 still gated by date and cannot fulfill an immediate-availability
// promise. The leaf, the `Alt+F to decide` key hint, and the "asks"
// promise stay gated behind it so a mixed-version session degrades to
// counting pips with truthful counting-only wording — never a promise
// the installed nav cannot keep. Never throws.
function freshnessDecayCardCapable(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins ? plugins["bob-navigation-hotkeys"] : null;
    const api = holder ? holder.api : null;
    const card = api ? api.freshnessDecayCard : null;
    return Boolean(card) && Number(card.version) >= 2;
  } catch (error) {
    return false;
  }
}

// Whether nav's rung-aware decay card is present: nav exposes
// `api.freshnessDecayCard.version >= 3` once the card supports lane
// rungs (WIP, Next). Lane rows show their decay mark only behind this
// probe; below 3 they keep counting pips with truthful counting-only
// wording. Ready rows keep the `freshnessDecayCardCapable` (>= 2)
// probe. Never throws.
function freshnessDecayLaneCardCapable(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins ? plugins["bob-navigation-hotkeys"] : null;
    const api = holder ? holder.api : null;
    const card = api ? api.freshnessDecayCard : null;
    return Boolean(card) && Number(card.version) >= 3;
  } catch (error) {
    return false;
  }
}

function defaultFreshnessConfig() {
  return {
    interval: 7,
    pendingInterval: 1,
    nextInterval: 1,
    projectInterval: null,
    rottenDailyBudget: null,
    decay: {
      enabled: true,
      keeps: 3,
      pending: 3,
      next: 3,
      ready: 3,
      enter: null,
    },
  };
}

// One rung override out of a `freshness.decay` mapping: absent or null
// uses `fallback`; `false` means count and display but never ask; an
// integer 0-999 is "ask at N". `true` and every other shape are
// invalid under the freshness failure contract. Mirrors
// `parse_rung_keeps` in `src/native/config/freshness.rs`.
function coerceDecayRungLimit(raw, snake, camel, fallback) {
  const value = raw[snake] !== undefined ? raw[snake] : raw[camel];
  if (value === undefined || value === null) {
    return { limit: fallback, invalid: false };
  }
  if (value === false) {
    return { limit: false, invalid: false };
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 999
  ) {
    return { limit: fallback, invalid: true };
  }
  return { limit: value, invalid: false };
}

// Normalize the `freshness.decay` value: absent, null, `true`, or an
// empty mapping means enabled with 3 keeps on every rung; `false`
// disables asking while keeping counting and display; a mapping may
// set `keeps` (integer 0-999, the fallback allowance), per-rung
// `pending_keeps` / `next_keeps` / `ready_keeps` (integer 0-999 or
// `false`), and `enter` (a nonempty priority label). Anything else is
// invalid under the freshness failure contract. Mirrors
// `parse_decay_config` in `src/native/config/freshness.rs`.
function coerceFreshnessDecay(raw) {
  const defaults = () => ({
    enabled: true,
    keeps: 3,
    pending: 3,
    next: 3,
    ready: 3,
    enter: null,
  });
  if (raw === undefined || raw === null || raw === true) {
    return { decay: defaults(), invalid: false };
  }
  if (raw === false) {
    return {
      decay: { ...defaults(), enabled: false },
      invalid: false,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { decay: defaults(), invalid: true };
  }
  let keeps = 3;
  const keepsRaw = raw.keeps;
  if (keepsRaw !== undefined && keepsRaw !== null) {
    if (
      typeof keepsRaw !== "number" ||
      !Number.isInteger(keepsRaw) ||
      keepsRaw < 0 ||
      keepsRaw > 999
    ) {
      return { decay: defaults(), invalid: true };
    }
    keeps = keepsRaw;
  }
  const pending = coerceDecayRungLimit(raw, "pending_keeps", "pendingKeeps", keeps);
  const next = coerceDecayRungLimit(raw, "next_keeps", "nextKeeps", keeps);
  const ready = coerceDecayRungLimit(raw, "ready_keeps", "readyKeeps", keeps);
  if (pending.invalid || next.invalid || ready.invalid) {
    return { decay: defaults(), invalid: true };
  }
  let enter = null;
  const enterRaw = raw.enter;
  if (enterRaw !== undefined && enterRaw !== null) {
    if (typeof enterRaw !== "string" || enterRaw.trim() === "") {
      return { decay: defaults(), invalid: true };
    }
    enter = enterRaw.trim();
  }
  return {
    decay: {
      enabled: true,
      keeps,
      pending: pending.limit,
      next: next.limit,
      ready: ready.limit,
      enter,
    },
    invalid: false,
  };
}

// One rung's effective keep allowance out of a normalized `decay`
// object: an integer 0-999 ("ask at N"), or `false` (count and
// display but never ask). A missing or misshaped rung falls back to
// the `keeps` allowance, then 3, so older shapes keep working.
// Mirrors the `DecayLimit` resolution in
// `src/native/config/freshness.rs`.
function freshnessDecayLimitFor(decay, lane) {
  try {
    const safe =
      decay && typeof decay === "object" && !Array.isArray(decay)
        ? decay
        : {};
    const fallback =
      Number.isInteger(safe.keeps) && safe.keeps >= 0 && safe.keeps <= 999
        ? safe.keeps
        : 3;
    const key =
      lane === "pending" ? "pending" : lane === "next" ? "next" : lane === "ready" ? "ready" : null;
    if (key === null) {
      return fallback;
    }
    const value = safe[key];
    if (value === undefined || value === null) {
      return fallback;
    }
    if (value === false) {
      return false;
    }
    if (Number.isInteger(value) && value >= 0 && value <= 999) {
      return value;
    }
    return fallback;
  } catch (error) {
    return 3;
  }
}

// Whether a choice is due for a row in `lane`/`tier` with `keeps`
// counted keeps under `config`: enabled decay, a rung limit of
// "ask at L", keeps at or over L, and the due tier for that lane
// (PENDING for pending, NEXT for next, ROTTEN/TICKLER for ready).
// Unblock ticklers, PROJECTS, recurring, checklist, and Today-linked
// rows never decide. The annotation means a choice is due, not
// permission to execute an action. Mirrors `decide_for` in
// `src/native/freshness/state.rs`.
function freshnessDecideFor(lane, tier, keeps, config, returnedBy, isToday) {
  try {
    if (returnedBy === "unblocked") {
      return false;
    }
    if (isToday === true) {
      return false;
    }
    if (
      tier === "projects" ||
      tier === "pre" ||
      tier === "post" ||
      tier === "recurring" ||
      tier === "new"
    ) {
      return false;
    }
    const decay =
      config && config.decay && typeof config.decay === "object"
        ? config.decay
        : { enabled: true, keeps: 3 };
    if (!decay.enabled) {
      return false;
    }
    let limit = null;
    if (lane === "pending" && tier === "pending") {
      limit = freshnessDecayLimitFor(decay, "pending");
    } else if (lane === "next" && tier === "next") {
      limit = freshnessDecayLimitFor(decay, "next");
    } else if (
      lane === "ready" &&
      (tier === "rotten" || tier === "tickler")
    ) {
      limit = freshnessDecayLimitFor(decay, "ready");
    } else {
      return false;
    }
    if (limit === false) {
      return false;
    }
    const threshold =
      Number.isInteger(limit) && limit >= 0 ? limit : 3;
    const count = Number.isInteger(keeps) && keeps >= 0 ? keeps : 0;
    return count >= threshold;
  } catch (error) {
    return false;
  }
}

// The raw `freshness:` block out of a parsed config file, or undefined
// when the file holds no such block. A present-but-bad block (null is
// fine, anything else that is not a mapping is not) is returned as-is
// so `coerceFreshnessConfig` can flag it; unknown keys stay ignored.
function freshnessBlock(yamlObject) {
  if (
    !yamlObject ||
    typeof yamlObject !== "object" ||
    Array.isArray(yamlObject)
  ) {
    return undefined;
  }
  const block = yamlObject.freshness;
  return block === undefined ? undefined : block;
}

function coerceFreshnessConfig(block) {
  const defaults = defaultFreshnessConfig();
  const fallback = () => ({
    config: { ...defaults, intervalFromConfig: false },
    invalid: false,
  });
  if (block === undefined || block === null) {
    return fallback();
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    return {
      config: { ...defaults, intervalFromConfig: false },
      invalid: true,
    };
  }
  // Snake_case keys, with camelCase tolerated like the plan caps.
  const pick = (snake, camel) =>
    block[snake] !== undefined ? block[snake] : block[camel];
  let invalid = false;
  let interval = defaults.interval;
  let intervalFromConfig = false;
  const rawInterval = pick("interval", "interval");
  if (rawInterval !== undefined && rawInterval !== null) {
    if (
      typeof rawInterval === "number" &&
      Number.isInteger(rawInterval) &&
      rawInterval >= 1 &&
      rawInterval <= 365
    ) {
      interval = rawInterval;
      intervalFromConfig = true;
    } else {
      invalid = true;
    }
  }
  // The canonical `rotten_daily_budget` wins by presence, including
  // an explicit null (budget off). The removed `stale_daily_budget`
  // still supplies the budget for one release; when both occur the
  // legacy value is warned about and ignored.
  const rawCanonical =
    block.rotten_daily_budget !== undefined
      ? block.rotten_daily_budget
      : block.rottenDailyBudget;
  const rawLegacy =
    block.stale_daily_budget !== undefined
      ? block.stale_daily_budget
      : block.staleDailyBudget;
  const legacyPresent = rawLegacy !== undefined && rawLegacy !== null;
  let budget = defaults.rottenDailyBudget;
  let deprecatedStaleBudget = false;
  const coerceBudget = (raw) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= 1
      ? raw
      : null;
  if (rawCanonical !== undefined) {
    if (rawCanonical !== null) {
      const coerced = coerceBudget(rawCanonical);
      if (coerced === null) {
        invalid = true;
      } else {
        budget = coerced;
      }
    }
    deprecatedStaleBudget = legacyPresent;
  } else if (rawLegacy !== undefined) {
    if (rawLegacy !== null) {
      const coerced = coerceBudget(rawLegacy);
      if (coerced === null) {
        invalid = true;
      } else {
        budget = coerced;
        deprecatedStaleBudget = true;
      }
    }
  }
  // Lane intervals: absent or null means the default 1, `false`
  // turns that lane's walk off, an integer 1-365 sets it. Anything
  // else (including `true`, 0, 366, strings, floats) is a config
  // error shaped like `interval`'s. Mirrors `parse_lane_interval`
  // in `src/native/config/freshness.rs`.
  const coerceLaneInterval = (raw) => {
    if (raw === undefined || raw === null) {
      return { days: 1, invalid: false };
    }
    if (raw === false) {
      return { days: null, invalid: false };
    }
    if (
      typeof raw === "number" &&
      Number.isInteger(raw) &&
      raw >= 1 &&
      raw <= 365
    ) {
      return { days: raw, invalid: false };
    }
    return { days: 1, invalid: true };
  };
  const rawPending = pick("pending_interval", "pendingInterval");
  const pendingCoerced = coerceLaneInterval(rawPending);
  if (pendingCoerced.invalid) {
    invalid = true;
  }
  const rawNext = pick("next_interval", "nextInterval");
  const nextCoerced = coerceLaneInterval(rawNext);
  if (nextCoerced.invalid) {
    invalid = true;
  }
  // Project interval: absent or null inherits; an integer 1-365 sets
  // the explicit cadence. Mirrors `parse_tracker_interval` in Rust.
  const coerceTrackerInterval = (raw) => {
    if (raw === undefined || raw === null) {
      return { days: null, invalid: false };
    }
    if (typeof raw === "boolean") {
      return { days: null, invalid: true };
    }
    if (
      typeof raw === "number" &&
      Number.isInteger(raw) &&
      raw >= 1 &&
      raw <= 365
    ) {
      return { days: raw, invalid: false };
    }
    return { days: null, invalid: true };
  };
  const rawProject = pick("project_interval", "projectInterval");
  const projectCoerced = coerceTrackerInterval(rawProject);
  if (projectCoerced.invalid) {
    invalid = true;
  }
  // Keep-streak policy: absent, null, `true`, or `{}` means enabled
  // with 3 keeps; `false` keeps counting/display but never asks;
  // `keeps` 0-999 and a nonempty `enter` label otherwise. Mirrors
  // `parse_decay_config` in `src/native/config/freshness.rs`.
  const decayCoerced = coerceFreshnessDecay(block.decay);
  if (decayCoerced.invalid) {
    invalid = true;
  }
  // Like Rust, any invalid value falls back to the full default block.
  if (invalid) {
    return {
      config: { ...defaults, intervalFromConfig: false },
      invalid: true,
    };
  }
  return {
    config: {
      interval,
      pendingInterval: pendingCoerced.days,
      nextInterval: nextCoerced.days,
      projectInterval: projectCoerced.days,
      rottenDailyBudget: budget,
      intervalFromConfig,
      deprecatedStaleBudget,
      decay: decayCoerced.decay,
    },
    invalid: false,
  };
}

// Read `freshness:` from `~/.config/bob/config.yml` (honoring
// XDG_CONFIG_HOME), with the same injectable options as `loadPlanCaps`.
// Mobile (no desktop `fs`) and a missing file fall back to the defaults.
// Returns `{ config, invalid, configPath }`; `invalid` is true only when
// the file was read but held a present-but-bad value.
function loadFreshnessConfig(options = {}) {
  const defaults = defaultFreshnessConfig();
  const freshDefaults = () => ({ ...defaults, intervalFromConfig: false });
  const configPath = options.configPath || planConfigPath(options);
  const platform = options.Platform === undefined ? Platform : options.Platform;
  if (platform && platform.isDesktopApp === false) {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  const fsModule =
    options.fsModule === undefined
      ? planRequireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      config: freshDefaults(),
      invalid: Boolean(error && error.code && error.code !== "ENOENT"),
      configPath,
    };
  }
  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  let parsed;
  try {
    parsed = yamlParser(rawConfig);
  } catch (error) {
    return { config: freshDefaults(), invalid: true, configPath };
  }
  const coerced = coerceFreshnessConfig(freshnessBlock(parsed));
  return { config: coerced.config, invalid: coerced.invalid, configPath };
}
