// --- Task freshness: config -------------------------------------------------
// Beside `planCapsBlock` / `coercePlanCaps`: the `freshness:` block in
// `~/.config/bob/config.yml` (`interval`, `pending_interval`,
// `next_interval`, `rotten_daily_budget`, `decay`).
// The removed `stale_daily_budget` key still supplies the budget for
// one release with a deprecation lint.
// Mirrors `docs/freshness.md` §§2-2a in bob-cli (freshness namespace v7).

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

function defaultFreshnessConfig() {
  return {
    interval: 7,
    pendingInterval: 1,
    nextInterval: 1,
    projectInterval: null,
    referenceInterval: null,
    rottenDailyBudget: null,
    decay: { enabled: true, keeps: 3, enter: null },
  };
}

// Normalize the `freshness.decay` value: absent, null, `true`, or an
// empty mapping means enabled with 3 keeps; `false` disables asking
// while keeping counting and display; a mapping may set `keeps`
// (integer 0-999) and `enter` (a nonempty priority label). Anything
// else is invalid under the freshness failure contract. Mirrors
// `parse_decay_config` in `src/native/config/freshness.rs`.
function coerceFreshnessDecay(raw) {
  const defaults = () => ({ enabled: true, keeps: 3, enter: null });
  if (raw === undefined || raw === null || raw === true) {
    return { decay: defaults(), invalid: false };
  }
  if (raw === false) {
    return { decay: { enabled: false, keeps: 3, enter: null }, invalid: false };
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
  let enter = null;
  const enterRaw = raw.enter;
  if (enterRaw !== undefined && enterRaw !== null) {
    if (typeof enterRaw !== "string" || enterRaw.trim() === "") {
      return { decay: defaults(), invalid: true };
    }
    enter = enterRaw.trim();
  }
  return { decay: { enabled: true, keeps, enter }, invalid: false };
}

// Whether a choice is due for a Ready-lane row in `tier` with `keeps`
// counted keeps under `config`: enabled decay, Ready lane,
// rotten/returned tier, keeps at or over the limit. The annotation
// means a choice is due, not permission to execute an action. Mirrors
// `decide_for` in `src/native/freshness/state.rs`.
function freshnessDecideFor(lane, tier, keeps, config) {
  try {
    const dueTier = tier === "rotten" || tier === "returned";
    if (!dueTier || lane !== "ready") {
      return false;
    }
    const decay =
      config && config.decay && typeof config.decay === "object"
        ? config.decay
        : { enabled: true, keeps: 3 };
    if (!decay.enabled) {
      return false;
    }
    const limit =
      Number.isInteger(decay.keeps) && decay.keeps >= 0 ? decay.keeps : 3;
    const count = Number.isInteger(keeps) && keeps >= 0 ? keeps : 0;
    return count >= limit;
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
  // Tracker intervals: absent or null inherits (`null`); an integer
  // 1-365 sets the explicit type cadence. Booleans (including
  // `false`), zero, negatives, >365, fractional numbers, strings,
  // and containers are config errors. Mirrors
  // `parse_tracker_interval` in `src/native/config/freshness.rs`.
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
  const rawReference = pick("reference_interval", "referenceInterval");
  const referenceCoerced = coerceTrackerInterval(rawReference);
  if (referenceCoerced.invalid) {
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
      referenceInterval: referenceCoerced.days,
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
