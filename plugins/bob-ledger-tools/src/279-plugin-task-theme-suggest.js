// --- Task theme suggestion resolver: PT13 mirror of bob-cli -------------
// Pure resolution and diagnostics. The API adapter supplies catalog names,
// today's live ledger names, parsed Obsidian metadata, and the existing hue
// lookup; this layer never spawns bob or mutates note text.

function pomodoroThemeCanonicalDailyPath(path) {
  const match = /^(\d{4})\/(\d{8})\.md$/.exec(String(path || ""));
  if (!match) {
    return false;
  }
  const dirYear = Number(match[1]);
  const stamp = match[2];
  const fileYear = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  if (dirYear !== fileYear) {
    return false;
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(fileYear, month - 1, day);
  return (
    date.getUTCFullYear() === fileYear &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pomodoroThemeTaskMark(line) {
  const stripped = pomodoroThemeStripBlockquotePrefix(String(line || ""));
  const text = stripped.replace(/^[ \t]*/, "");
  const marker = /^(?:[-*+] )\[([^\]\n])\](?=$|\s)/.exec(text);
  return marker ? marker[1] : null;
}

function pomodoroThemeTrailingBlockId(line) {
  const text = String(line || "").trimEnd();
  const caret = text.lastIndexOf("^");
  if (caret < 0) {
    return null;
  }
  const id = text.slice(caret + 1);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) {
    return null;
  }
  if (caret > 0 && !/\s/u.test(text[caret - 1])) {
    return null;
  }
  return id;
}

function pomodoroThemeIsReadingTask(line) {
  const tokens = String(line || "").split(/\s+/u).filter(Boolean);
  if (tokens.some((token) => token.toLowerCase() === "#ref")) {
    return true;
  }
  const id = pomodoroThemeTrailingBlockId(line);
  if (!id) {
    return false;
  }
  const lower = id.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return lower === "ref" || lower.startsWith("ref-");
}

function pomodoroThemeCatalogTheme(key, canonical, options) {
  const catalog = options.catalog || {};
  const names = catalog.names instanceof Map ? catalog.names : new Map();
  const known =
    catalog.known instanceof Set ? catalog.known.has(key) : names.has(key);
  const name = names.get(key) || canonical;
  if (typeof options.themeRef === "function") {
    try {
      return options.themeRef(key, name, known);
    } catch (error) {
      // Suggestions remain useful without optional hue/catalog metadata.
    }
  }
  return { key, name, known };
}

function pomodoroThemeMakeSuggestion(key, canonical, source, label, options, extra = {}) {
  return {
    theme: pomodoroThemeCatalogTheme(key, canonical, options),
    source,
    label,
    ...extra,
  };
}

function pomodoroThemeResolveNoteDefault(path, line, options) {
  const result = { suggestion: null, warnings: [] };
  const opts = options && typeof options === "object" ? options : {};
  const metadataCache = opts.metadataCache || null;
  const vault = opts.vault || null;
  let startPath = path;
  if (typeof line === "string" && line) {
    const root = rootMarkModel(line, {
      sourcePath: path,
      metadataCache,
      vault,
    });
    if (root && root.state !== "repair" && root.targetPath) {
      startPath = root.targetPath;
    }
  }
  if (pomodoroThemeCanonicalDailyPath(startPath)) {
    return result;
  }
  const facts = pomodoroHomeResolveTaskThemeFacts(
    startPath,
    opts.dailyPath,
    metadataCache,
    vault,
  );
  if (!facts) {
    return result;
  }
  const residencePaths = facts.chain.map((item) => item.path);
  for (let index = 0; index < facts.chain.length; index += 1) {
    const item = facts.chain[index];
    if (item.type !== "area" && item.type !== "project") {
      continue;
    }
    const theme = pomodoroThemeNoteDefault(item.frontmatter);
    if (theme.kind === "absent") {
      continue;
    }
    if (theme.kind === "off") {
      return result;
    }
    if (theme.kind === "invalid") {
      result.warnings.push({ code: "theme_default_invalid", path: item.path });
      continue;
    }
    const key = pomodoroThemeNormalizeKey(theme.name);
    const stem = pomodoroHomeStem(item.path).toLowerCase();
    const declaring = pomodoroHomeResolveTaskThemeFacts(
      item.path,
      opts.dailyPath,
      metadataCache,
      vault,
    );
    const origin = {
      path: item.path,
      stem,
      kind: item.type,
      chain: residencePaths.slice(0, index + 1),
    };
    const hue = declaring && declaring.home ? declaring.home.hue : null;
    if (typeof hue === "string" && hue) {
      origin.hue = hue;
    }
    result.suggestion = pomodoroThemeMakeSuggestion(
      key,
      theme.name,
      "note",
      `from ${stem}`,
      options,
      { from: origin },
    );
    return result;
  }
  return result;
}

function pomodoroThemeResolveWithoutTaskField(path, line, options) {
  const config = options.config && typeof options.config === "object" ? options.config : {};
  const configuredReading =
    config.readingTheme !== undefined
      ? config.readingTheme
      : config.reading_theme !== undefined
        ? config.reading_theme
        : "READ";
  const readingName =
    configuredReading === null ||
    (typeof configuredReading === "string" && configuredReading.trim().toLowerCase() === "off")
      ? null
      : pomodoroThemeCanonicalName(configuredReading);
  if (pomodoroThemeIsReadingTask(line) && readingName) {
    const key = pomodoroThemeNormalizeKey(readingName);
    return {
      suggestion: pomodoroThemeMakeSuggestion(
        key,
        readingName,
        "reading",
        "reading task",
        options,
      ),
      warnings: [],
    };
  }
  return pomodoroThemeResolveNoteDefault(path, line, options);
}

function pomodoroThemeSuggestWithDiagnostics(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const path = typeof opts.path === "string" ? opts.path : "";
  if (opts.newTask === true) {
    return pomodoroThemeResolveNoteDefault(path, null, opts);
  }
  const line = String(opts.line == null ? "" : opts.line);
  const mark = pomodoroThemeTaskMark(line);
  if (mark === "x" || mark === "X" || mark === "-") {
    return {
      suggestion: null,
      warnings: [{ code: "closed_task" }],
    };
  }
  const inherited = pomodoroThemeResolveWithoutTaskField(path, line, opts);
  const field = pomodoroThemeTaskFieldState(line);
  if (field.state === "set") {
    return {
      suggestion: pomodoroThemeMakeSuggestion(
        field.key,
        field.value,
        "task",
        "this task",
        opts,
        {
          inherited: inherited.suggestion
            ? { ...inherited.suggestion }
            : null,
        },
      ),
      warnings: inherited.warnings,
    };
  }
  if (field.state === "repair" && inherited.suggestion) {
    return {
      suggestion: { ...inherited.suggestion, repair: field.repair },
      warnings: inherited.warnings,
    };
  }
  return inherited;
}
