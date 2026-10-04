
// --- Plan lane counter ----------------------------------------------------
// A lane task is a `#task` line the native Tasks engine matches with the
// NEXT or PENDING query in docs/plan.md. This mirrors that predicate over
// Tasks-plugin task objects (tolerant of the shapes Tasks and dataview
// expose).

function planTaskDescription(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["description", "text"]) {
    if (typeof task[key] === "string") {
      return task[key];
    }
  }
  return null;
}

function planTaskIsDone(task) {
  if (!task || typeof task !== "object") {
    return true;
  }
  if (task.done === true) {
    return true;
  }
  const type = task.status && task.status.type;
  if (type === "DONE" || type === "CANCELLED" || type === "NON_TASK") {
    return true;
  }
  const name = task.status && task.status.name;
  if (typeof name === "string" && /^(done|cancelled?)\s*$/i.test(name.trim())) {
    return true;
  }
  return false;
}

function planTaskIsBlocked(task, all) {
  if (!task || typeof task !== "object") {
    return false;
  }
  if (typeof task.isBlocked === "function") {
    try {
      return Boolean(task.isBlocked(all));
    } catch (error) {
      return false;
    }
  }
  return task.isBlocked === true || task.blocked === true;
}

function planTaskPath(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  if (typeof task.path === "string") {
    return task.path;
  }
  if (task.file && typeof task.file.path === "string") {
    return task.file.path;
  }
  return "";
}

function planDayNumber(value) {
  const date = planCoerceDate(value);
  if (!date) {
    return null;
  }
  return (
    date.getFullYear() * 10000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  );
}

function planCoerceDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    if (typeof value.isSameOrBefore === "function") {
      // A moment-like object.
      if (typeof value.year === "function") {
        const date = new Date(
          value.year(),
          (typeof value.month === "function" ? value.month() : 0) || 0,
          (typeof value.date === "function" ? value.date() : 1) || 1,
        );
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (typeof value.toDate === "function") {
        try {
          return planCoerceDate(value.toDate());
        } catch (error) {
          return null;
        }
      }
      if (typeof value.format === "function") {
        try {
          return planCoerceDate(value.format("YYYY-MM-DD"));
        } catch (error) {
          return null;
        }
      }
      return null;
    }
    if ("moment" in value) {
      return planCoerceDate(value.moment);
    }
    if (value instanceof Date) {
      return planCoerceDate(value);
    }
  }
  return null;
}

function planTaskScheduledDay(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["scheduledDate", "scheduled", "scheduledDay"]) {
    if (task[key] !== undefined && task[key] !== null) {
      const day = planDayNumber(task[key]);
      if (day !== null) {
        return day;
      }
    }
  }
  return null;
}

function planTaskTags(task) {
  if (!task || typeof task !== "object" || !Array.isArray(task.tags)) {
    return [];
  }
  return task.tags.filter((tag) => typeof tag === "string");
}

// --- Plan config ----------------------------------------------------------

function planRequireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }
    return require(name);
  } catch (error) {
    return null;
  }
}

function planJoinPathSegments(firstSegment, ...restSegments) {
  const trim = (text, side) => {
    const value = String(text || "");
    if (side === "left") {
      return value.replace(/^\/+/, "");
    }
    if (side === "right") {
      return value.replace(/\/+$/, "");
    }
    return value.replace(/^\/+|\/+$/g, "");
  };
  const first = trim(firstSegment, "right");
  const rest = restSegments
    .map((segment) => trim(segment, "both"))
    .filter((segment) => segment.length > 0);
  return [first, ...rest].filter((segment) => segment.length > 0).join("/");
}

function planConfigHomeDir(osModule, env) {
  if (osModule && typeof osModule.homedir === "function") {
    try {
      const home = osModule.homedir();
      if (typeof home === "string" && home.trim()) {
        return home;
      }
    } catch (error) {
      // Fall through to $HOME below.
    }
  }
  if (env && typeof env.HOME === "string" && env.HOME.trim()) {
    return env.HOME;
  }
  return "~";
}

function planConfigPath(options = {}) {
  const env =
    options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule =
    options.osModule === undefined
      ? planRequireOptionalNodeModule("os")
      : options.osModule;
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : null;
  const configHome =
    xdgConfigHome ||
    planJoinPathSegments(planConfigHomeDir(osModule, env), ".config");
  return planJoinPathSegments(configHome, PLAN_CONFIG_RELATIVE_PATH);
}

// Stat cache for `loadPlanCaps`: `{ key, result }`, where the key is the
// config path plus the file's mtime/size (or `"missing"` when the file
// does not exist). The file is reparsed only when the key changes, so the
// 13+ callers never re-read it per call. Creation, deletion, invalid
// edits and recovery, and env path overrides all change the key, so the
// next call re-reads. Callers without a `statSync` (including the unit
// test stubs) read through uncached, exactly as before.
let planCapsStatCache = { key: null, result: null };

function resetPlanCapsCache() {
  planCapsStatCache = { key: null, result: null };
}

function planCapsStatKey(fsModule, configPath) {
  try {
    if (!fsModule || typeof fsModule.statSync !== "function") {
      return null;
    }
    const stat = fsModule.statSync(configPath);
    const mtime =
      stat && stat.mtimeMs !== undefined && stat.mtimeMs !== null
        ? stat.mtimeMs
        : stat && stat.mtime
          ? Number(stat.mtime)
          : "?";
    const size =
      stat && stat.size !== undefined && stat.size !== null ? stat.size : "?";
    return `${mtime}:${size}`;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "missing";
    }
    return null;
  }
}

// Where the default per-note cap came from: an explicit
// `plan.max_ready_per_note` (`config`) or the built-in default
// (`default`). Presence only — an invalid value still reads `config`
// (with `invalid: true` beside it), matching the Rust contract.
function planDefaultCapSource(block) {
  const raw =
    block && typeof block === "object" && !Array.isArray(block) ? block : {};
  for (const key of ["max_ready_per_note", "maxReadyPerNote"]) {
    if (raw[key] !== undefined && raw[key] !== null) {
      return "config";
    }
  }
  return "default";
}

// Read `plan:` from `~/.config/bob/config.yml` (honoring XDG_CONFIG_HOME).
// Mobile (no desktop `fs`) and read errors fall back to the defaults.
// Returns `{ caps, invalid, defaultSource, configPath }`; `invalid` is
// true only when the file was read but held a present-but-bad value.
function loadPlanCaps(options = {}) {
  const defaults = defaultPlanCaps();
  const configPath = options.configPath || planConfigPath(options);
  const platform = options.Platform === undefined ? Platform : options.Platform;
  if (platform && platform.isDesktopApp === false) {
    return {
      caps: defaults,
      invalid: false,
      defaultSource: "default",
      configPath,
    };
  }
  const fsModule =
    options.fsModule === undefined
      ? planRequireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return {
      caps: defaults,
      invalid: false,
      defaultSource: "default",
      configPath,
    };
  }
  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    return {
      caps: defaults,
      invalid: false,
      defaultSource: "default",
      configPath,
    };
  }
  const statKey = planCapsStatKey(fsModule, configPath);
  const cacheKey =
    statKey === null ? null : `${configPath}\n${statKey}`;
  if (
    cacheKey !== null &&
    planCapsStatCache.key === cacheKey &&
    planCapsStatCache.result
  ) {
    return planCapsStatCache.result;
  }
  const readUncached = () => {
    let rawConfig;
    try {
      rawConfig = fsModule.readFileSync(configPath, "utf8");
    } catch (error) {
      return {
        caps: defaults,
        invalid: Boolean(error && error.code && error.code !== "ENOENT"),
        defaultSource: "default",
        configPath,
      };
    }
    let parsed;
    try {
      parsed = yamlParser(rawConfig);
    } catch (error) {
      return {
        caps: defaults,
        invalid: true,
        defaultSource: "default",
        configPath,
      };
    }
    const block = planCapsBlock(parsed);
    const coerced = coercePlanCaps(block);
    return {
      caps: coerced.caps,
      invalid: coerced.invalid,
      defaultSource: planDefaultCapSource(block),
      configPath,
    };
  };
  const result = readUncached();
  if (cacheKey !== null) {
    planCapsStatCache = { key: cacheKey, result };
  }
  return result;
}

