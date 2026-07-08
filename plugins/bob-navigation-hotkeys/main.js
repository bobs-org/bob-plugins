const obsidian = require("obsidian");
const { MarkdownView, Modal, Notice, Plugin, parseYaml } = obsidian;
const { EditorView } = require("@codemirror/view");

const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const SECTION_HEADER_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const OPEN_OBSIDIAN_TASK_STATUSES = new Set([" ", "/", "B"]);
const OBSIDIAN_TASK_LINE_RE =
  /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
// Pomodoro ledger navigation targets. Mirrors the minimal subset of
// `bob-ledger-tools` conventions needed to recognize open or done Pomodoro lines
// inside a `## Pomodoros` section. Duplicated here on purpose so this plugin does
// not reach into another plugin's non-public module internals.
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
// Pomodoro statuses that qualify as navigation targets: open (`[ ]`, `[/]`) and
// completed (`[x]`, `[X]`). Cancelled (`[-]`) Pomodoros stay excluded, matching
// the `bob-ledger-tools` distinction between completed and cancelled entries.
const POMODORO_NAVIGATION_STATUSES = new Set([" ", "/", "x", "X"]);
// Top-level (unindented) ledger checkbox line. The list marker must sit at
// column 0 so indented carried-forward child bullets under a Pomodoro are never
// treated as navigation targets.
const POMODORO_TOP_LEVEL_TASK_LINE_RE =
  /^(?:[-*+]|\d+[.)])\s+\[([ /xX-])\](?:\s+(.*))?$/;
const POMODORO_PLACEHOLDER_RE = /\(\s*\)/;
const POMODORO_COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const POMODORO_COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const NOTE_TEMPLATE_PATHS = Object.freeze({
  daily: "_templates/daily.md",
  monthly: "_templates/monthly.md",
  yearly: "_templates/yearly.md",
  default: "_templates/new_note.md",
});
const NOTE_TEMPLATE_MISSING_NOTICES = Object.freeze({
  daily: "Daily note template not found",
  monthly: "Monthly note template not found",
  yearly: "Yearly note template not found",
  default: "New note template not found",
});
const PROJECT_TYPE_WIKILINK = "[[project]]";
const AREA_TYPE_WIKILINK = "[[area]]";
const PROJECT_TEMPLATE_PATH = "_templates/new_project.md";
const PROJECT_COMPLETION_PLACEHOLDER =
  "(REPLACE WITH PROJECT COMPLETION CRITERIA)";
const PROJECT_PARENT_TYPE_BASENAMES = new Set(["area", "project"]);
const PROJECT_OPEN_TASK_STATUSES = new Set([" ", "/", "B"]);
const PROJECT_LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const PROJECT_SOURCE_TASK_LINE_RE =
  /^(\s*)(?:[-*+]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
const PROJECT_TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/;
const PROJECT_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/g;
const PROJECT_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PROJECT_TASKS_HEADER = "## Tasks";
const PROJECT_TASKS_PLACEHOLDER = "(REPLACE WITH TASK DESCRIPTION)";
const PROJECT_CHILD_LIST_ITEM_RE =
  /^(\s*)(?:[-*+]|\d+[.)])[ \t]+(?:\[([^\]\n])\][ \t]+)?(.*)$/;
const PROJECT_DEFAULT_BASENAME_SUFFIX_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyz";
const NOTE_TEMPLATE_SELECTIONS = Object.freeze(
  Object.fromEntries(
    Object.keys(NOTE_TEMPLATE_PATHS).map((kind) => [
      kind,
      Object.freeze({
        kind,
        templatePath: NOTE_TEMPLATE_PATHS[kind],
        missingTemplateNotice: NOTE_TEMPLATE_MISSING_NOTICES[kind],
      }),
    ]),
  ),
);
const DAILY_NOTE_CREATION_PATH_RE =
  /^(\d{4})\/(\d{4})(\d{2})(\d{2})(?:_day)?\.md$/;
const MONTHLY_NOTE_CREATION_PATH_RE = /^(\d{4})\/(\d{4})(\d{2})\.md$/;
const YEARLY_NOTE_CREATION_PATH_RE = /^(\d{4})\.md$/;
const URL_OR_URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const MARKDOWN_EXTENSION_RE = /\.md$/i;
const FINAL_EXTENSION_RE = /\.[^./]+$/;
const DASH_FILE_PATH = "dash.md";
const DASH_TASKS_HEADER = "## Tasks";
const DASH_TASKS_JUMP_RETRIES = 8;
const DASH_TASKS_SCROLL_ASSERT_FRAMES = 8;
const PROJECT_STATUS_CANCELED_ALIASES = new Set(["canceled", "cancelled"]);
const PROJECT_STATUS_PRESENTATIONS = Object.freeze({
  wip: Object.freeze({
    icon: "hammer",
    emoji: "🚧",
    label: "WIP",
    variant: "wip",
  }),
  done: Object.freeze({
    icon: "circle-check",
    emoji: "✅",
    label: "Done",
    variant: "done",
  }),
  canceled: Object.freeze({
    icon: "circle-slash",
    emoji: "🚫",
    label: "Canceled",
    variant: "canceled",
  }),
});
const PROJECT_STATUS_FALLBACK = Object.freeze({
  icon: "square-kanban",
  emoji: "",
  variant: "muted",
});
const AREA_PRESENTATION = Object.freeze({
  icon: "compass",
  emoji: "🧭",
  label: "Area",
  variant: "area",
});

const YANK_PATH_COMMANDS = [
  {
    id: "yank-absolute-path-tilde",
    name: "Yank absolute path with tilde",
    kind: "absolute-tilde",
  },
  {
    id: "yank-absolute-path",
    name: "Yank absolute path",
    kind: "absolute",
  },
  {
    id: "yank-basename",
    name: "Yank basename",
    kind: "basename",
  },
  {
    id: "yank-basename-without-extension",
    name: "Yank basename without extension",
    kind: "basename-no-extension",
  },
  {
    id: "yank-parent-directory",
    name: "Yank parent directory",
    kind: "parent-directory",
  },
  {
    id: "yank-relative-path",
    name: "Yank relative path",
    kind: "relative",
  },
];

const YANK_PATH_NOTICE_LABELS = {
  "absolute-tilde": "absolute path",
  absolute: "absolute path",
  basename: "basename",
  "basename-no-extension": "basename without extension",
  "parent-directory": "parent directory",
  relative: "relative path",
};

const YANK_PATH_PICKER_TITLES = {
  "absolute-tilde": "Absolute path with tilde",
  absolute: "Absolute path",
  basename: "Basename",
  "basename-no-extension": "Basename without extension",
  "parent-directory": "Parent directory",
  relative: "Relative path",
};

const BULLET_PROPERTY_CONFIG_RELATIVE_PATH = "bob/config.yml";
const BULLET_PROPERTY_CONFIG_MOBILE_NOTICE =
  "Bullet properties are only available on desktop";
const BULLET_PROPERTY_LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
// Visible label written into new managed dependency navigation child bullets.
const DEPENDENCY_NAVIGATION_LABEL = "DEPENDS ON";
const DEPENDENCY_NAVIGATION_EMOJI = "🔗";
const DEPENDENCY_NAVIGATION_SEPARATOR = " • ";
// Legacy labels the picker still recognizes (and normalizes in place) so bullets
// written before the rename keep working for dedupe, removal, and grouping.
const LEGACY_DEPENDENCY_NAVIGATION_LABELS = Object.freeze(
  new Set(["DEPENDENCIES"]),
);
// Managed "dependency navigation" child bullet shape, e.g.
// `  - 🔗 **DEPENDS ON:** [[#^a]] • [[#^b]]`. Recognizes the current label,
// legacy labels, and legacy emoji-less bullets. Named groups: `indent` (leading
// indentation), `marker` (the list bullet), `emoji`, `label`, and `linkSpan`
// (the raw text containing one or more block links).
const DEPENDENCY_NAVIGATION_BULLET_RE = new RegExp(
  `^(?<indent>\\s*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?<emoji>${DEPENDENCY_NAVIGATION_EMOJI}[ \\t]+)?\\*\\*(?<label>${[
    DEPENDENCY_NAVIGATION_LABEL,
    ...LEGACY_DEPENDENCY_NAVIGATION_LABELS,
  ]
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")}):\\*\\*[ \\t]+(?<linkSpan>.*\\[\\[#\\^[A-Za-z0-9-]+\\]\\].*)[ \\t]*$`,
);
const DEPENDENCY_NAVIGATION_LINK_RE = /\[\[#\^([A-Za-z0-9-]+)\]\]/g;
const BULLET_PROPERTY_FIELD_RE = /\[([^\[\]\n]+?)::([^\]\n]*)\]/g;
const BULLET_PROPERTY_TRAILING_BLOCK_ID_RE =
  /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const BULLET_PROPERTY_BLOCK_ID_ONLY_RE = /^\^[A-Za-z0-9-]+[ \t]*$/;
const BULLET_PROPERTY_INVALID_NAME_CHARS_RE = /[\s[\]]|::/;
const BULLET_PROPERTY_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const BULLET_PROPERTY_TASKS_INLINE_FIELD_RE =
  /[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g;
const BULLET_PROPERTY_TASKS_EMOJI_DATE_RE =
  /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g;

function numericOrDefault(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function showBulletPropertyNotice(message, options) {
  const showNotice = options && options.showNotice;
  if (typeof showNotice === "function") {
    showNotice(message);
    return;
  }

  new Notice(message);
}

function requireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }

    return require(name);
  } catch (error) {
    return null;
  }
}

function trimPathSlashes(path, side) {
  const text = String(path || "");
  if (side === "left") {
    return text.replace(/^\/+/, "");
  }

  if (side === "right") {
    return text.replace(/\/+$/, "");
  }

  return text.replace(/^\/+|\/+$/g, "");
}

function joinPathSegments(firstSegment, ...restSegments) {
  const first = trimPathSlashes(firstSegment, "right");
  const rest = restSegments
    .map((segment) => trimPathSlashes(segment, "both"))
    .filter((segment) => segment.length > 0);

  return [first, ...rest].filter((segment) => segment.length > 0).join("/");
}

function getBulletPropertyHomeDir(osModule, env) {
  if (osModule && typeof osModule.homedir === "function") {
    const home = osModule.homedir();
    if (typeof home === "string" && home.trim()) {
      return home;
    }
  }

  if (env && typeof env.HOME === "string" && env.HOME.trim()) {
    return env.HOME;
  }

  return "~";
}

function getBulletPropertyConfigPath(options = {}) {
  const env =
    options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule =
    options.osModule === undefined
      ? requireOptionalNodeModule("os")
      : options.osModule;
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : null;
  const configHome =
    xdgConfigHome ||
    joinPathSegments(getBulletPropertyHomeDir(osModule, env), ".config");

  return joinPathSegments(configHome, BULLET_PROPERTY_CONFIG_RELATIVE_PATH);
}

function isBulletPropertyScalar(value) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isValidBulletPropertyName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !BULLET_PROPERTY_INVALID_NAME_CHARS_RE.test(name)
  );
}

function normalizeBulletPropertyValues(name, values, options) {
  if (values === "date") {
    return "date";
  }

  if (values === "local_task_id") {
    return "local_task_id";
  }

  if (Array.isArray(values) && values.length > 0) {
    const normalizedValues = [];
    for (const value of values) {
      if (!isBulletPropertyScalar(value)) {
        showBulletPropertyNotice(
          `Bullet property "${name}" values must be "date", "local_task_id", or a non-empty scalar list`,
          options,
        );
        return null;
      }

      normalizedValues.push(String(value));
    }

    return Object.freeze(normalizedValues);
  }

  showBulletPropertyNotice(
    `Bullet property "${name}" values must be "date", "local_task_id", or a non-empty scalar list`,
    options,
  );
  return null;
}

function validateBulletPropertyConfig(config, options = {}) {
  const entries = config && config.properties;
  if (!Array.isArray(entries) || entries.length === 0) {
    showBulletPropertyNotice(
      "Bullet property config must define a non-empty properties list",
      options,
    );
    return null;
  }

  const seenNames = new Set();
  const properties = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || typeof entry.name !== "string") {
      showBulletPropertyNotice(
        `Bullet property entry #${index + 1} must define a string name`,
        options,
      );
      return null;
    }

    const name = entry.name.trim();
    if (!isValidBulletPropertyName(name)) {
      showBulletPropertyNotice(
        `Invalid bullet property name "${name}": names cannot contain whitespace, "::", "[", or "]"`,
        options,
      );
      return null;
    }

    if (seenNames.has(name)) {
      showBulletPropertyNotice(
        `Duplicate bullet property name "${name}" in config`,
        options,
      );
      return null;
    }

    const values = normalizeBulletPropertyValues(name, entry.values, options);
    if (values === null) {
      return null;
    }

    seenNames.add(name);
    properties.push(Object.freeze({ name, values }));
  }

  return Object.freeze({
    path: options.configPath || null,
    properties: Object.freeze(properties),
  });
}

function loadBulletPropertyConfig(options = {}) {
  const fsModule =
    options.fsModule === undefined
      ? requireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    showBulletPropertyNotice(BULLET_PROPERTY_CONFIG_MOBILE_NOTICE, options);
    return null;
  }

  const configPath =
    options.configPath ||
    getBulletPropertyConfigPath({
      env: options.env,
      osModule: options.osModule,
    });
  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      showBulletPropertyNotice(
        `Bullet property config not found: ${configPath}. Run chezmoi apply ~/.config/bob/config.yml.`,
        options,
      );
    } else {
      showBulletPropertyNotice(
        `Could not read bullet property config: ${
          error && error.message ? error.message : String(error)
        }`,
        options,
      );
    }
    return null;
  }

  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    showBulletPropertyNotice(
      "Bullet property config parser is unavailable",
      options,
    );
    return null;
  }

  let parsedConfig;
  try {
    parsedConfig = yamlParser(rawConfig);
  } catch (error) {
    showBulletPropertyNotice(
      `Could not parse bullet property config: ${
        error && error.message ? error.message : String(error)
      }`,
      options,
    );
    return null;
  }

  return validateBulletPropertyConfig(parsedConfig, {
    ...options,
    configPath,
  });
}

function isBulletLine(line) {
  return BULLET_PROPERTY_LIST_ITEM_RE.test(String(line || ""));
}

function normalizeBulletPropertyName(name) {
  return String(name || "").trim();
}

function normalizeBulletPropertyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function formatBulletPropertyField(name, value) {
  return `[${normalizeBulletPropertyName(name)}:: ${normalizeBulletPropertyValue(
    value,
  )}]`;
}

function parseBulletPropertyFields(line) {
  const text = String(line || "");
  const fields = [];
  BULLET_PROPERTY_FIELD_RE.lastIndex = 0;

  let match = BULLET_PROPERTY_FIELD_RE.exec(text);
  while (match) {
    const key = String(match[1] || "").trim();
    if (key) {
      fields.push(
        Object.freeze({
          key,
          value: String(match[2] || "").trim(),
          raw: match[0],
          span: Object.freeze({
            start: match.index,
            end: match.index + match[0].length,
          }),
        }),
      );
    }

    match = BULLET_PROPERTY_FIELD_RE.exec(text);
  }

  return fields;
}

function findBulletPropertyField(line, name) {
  const targetName = normalizeBulletPropertyName(name);
  return (
    parseBulletPropertyFields(line).find((field) => field.key === targetName) ||
    null
  );
}

function getTrailingBlockIdSpan(line) {
  const match = BULLET_PROPERTY_TRAILING_BLOCK_ID_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  return Object.freeze({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  });
}

function getBulletPropertyAppendIndex(line) {
  const blockIdSpan = getTrailingBlockIdSpan(line);
  return blockIdSpan ? blockIdSpan.start : String(line || "").length;
}

function upsertBulletProperty(line, name, value) {
  const text = String(line || "");
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      field: null,
    });
  }

  const fieldText = formatBulletPropertyField(name, value);
  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    const nextLine =
      text.slice(0, existingField.span.start) +
      fieldText +
      text.slice(existingField.span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      field: existingField,
    });
  }

  const appendIndex = getBulletPropertyAppendIndex(text);
  const before = text.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = text.slice(appendIndex).replace(/^[ \t]+/, " ");
  const nextLine = `${before} ${fieldText}${after}`;

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "insert",
    reason: null,
    field: null,
  });
}

function insertMissingBulletProperty(line, name, value) {
  const text = String(line || "");
  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "already-present",
      field: existingField,
    });
  }

  const fieldText = formatBulletPropertyField(name, value);
  const appendIndex = getBulletPropertyAppendIndex(text);
  const before = text.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = text.slice(appendIndex).replace(/^[ \t]+/, " ");
  const nextLine = `${before} ${fieldText}${after}`;

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "insert",
    reason: null,
    field: null,
  });
}

function stripTaskTag(text) {
  return String(text || "").replace(
    PROJECT_TASK_TAG_GLOBAL_RE,
    (match, prefix) => {
      if (!prefix) {
        return "";
      }

      return /\s/.test(prefix) ? " " : prefix;
    },
  );
}

function cleanTaskDisplayText(line) {
  const text = String(line || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  let body = match ? match[2] || "" : text;

  body = body
    .replace(BULLET_PROPERTY_TRAILING_BLOCK_ID_RE, "")
    .replace(BULLET_PROPERTY_TASKS_INLINE_FIELD_RE, "")
    .replace(BULLET_PROPERTY_TASKS_EMOJI_DATE_RE, "");
  body = stripTaskTag(body)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return body || "(untitled task)";
}

function getTrailingBlockId(line) {
  const span = getTrailingBlockIdSpan(line);
  if (!span) {
    return null;
  }

  const match = /\^([A-Za-z0-9-]+)/.exec(span.text);
  return match ? match[1] : null;
}

function getOpenLocalTasks(content, options = {}) {
  const lines = String(content || "").split(/\r?\n/);
  const excludeLine = Number.isInteger(options.excludeLine)
    ? options.excludeLine
    : null;

  return getOpenObsidianTaskLines(lines)
    .filter((line) => line !== excludeLine)
    .map((line) => {
      const rawLine = String(lines[line] || "");
      const match = OBSIDIAN_TASK_LINE_RE.exec(rawLine);
      const idField = findBulletPropertyField(rawLine, "id");
      const existingIdField = idField
        ? normalizeBulletPropertyValue(idField.value)
        : null;
      const existingBlockId = getTrailingBlockId(rawLine);

      return Object.freeze({
        line,
        status: match ? match[1] : " ",
        existingBlockId,
        existingIdField: existingIdField || null,
        displayText: cleanTaskDisplayText(rawLine),
        rawLine,
      });
    });
}

function blockIdExistsInContent(content, id) {
  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(String(id || ""))) {
    return false;
  }

  const re = new RegExp(
    `(^|[ \\t])\\^${escapeRegExp(id)}(?=$|[ \\t\\r\\n])`,
    "gm",
  );
  return re.test(String(content || ""));
}

function truncateBlockIdSlug(slug, maxLength) {
  return String(slug || "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

function suggestBlockIdFromTask(displayText, content, options = {}) {
  const reservedIds =
    options.reservedIds instanceof Set
      ? options.reservedIds
      : new Set(options.reservedIds || []);
  const isTaken = (candidate) =>
    blockIdExistsInContent(content, candidate) || reservedIds.has(candidate);
  const maxLength = 32;
  let slug = String(displayText || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  slug = truncateBlockIdSlug(slug, maxLength) || "task";

  let candidate = slug;
  let suffix = 2;
  while (isTaken(candidate)) {
    const suffixText = `-${suffix}`;
    const base =
      truncateBlockIdSlug(slug, Math.max(1, maxLength - suffixText.length)) ||
      "task";
    candidate = `${base}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}

function appendBlockIdToLine(line, id) {
  const text = String(line || "");
  const trailingWhitespace = /[ \t]*$/.exec(text)[0] || "";
  const body = text
    .slice(0, text.length - trailingWhitespace.length)
    .replace(/[ \t]+$/g, "");
  return `${body} ^${normalizeBulletPropertyValue(id)}${trailingWhitespace}`;
}

function getTargetEdit(kind, oldLine, newLine) {
  if (oldLine === newLine) {
    return [];
  }

  return [Object.freeze({ kind, line: newLine })];
}

// True when an open task being added as a dependency has no trailing `^block-id`
// and therefore needs the user to be prompted for one before the navigation
// bullet can link to it. An existing `[id:: value]` does NOT remove this need:
// it is a valid Tasks dependency value but not yet a navigation block target.
function taskNeedsPromptedBlockId(task) {
  if (!task) {
    return false;
  }

  const blockId = Object.prototype.hasOwnProperty.call(task, "existingBlockId")
    ? task.existingBlockId
    : getTrailingBlockId(task.rawLine);
  return !normalizeBulletPropertyValue(blockId);
}

// Apply a confirmed/prompted block ID to a task line: always append the trailing
// `^id` navigation target, and add `[id:: id]` only when the task lacks an
// existing `[id::]` value (an existing one stays the canonical dependency value).
function applyPromptedBlockIdToTaskLine(line, id) {
  const withBlockId = appendBlockIdToLine(line, id);
  return insertMissingBulletProperty(withBlockId, "id", id).line;
}

function resolveTargetTaskIdentity(line, options = {}) {
  const promptWhenBlockIdMissing = options.promptWhenBlockIdMissing === true;
  const text = String(line || "");
  const idField = findBulletPropertyField(text, "id");
  const idFieldValue = idField
    ? normalizeBulletPropertyValue(idField.value)
    : "";
  const blockId = getTrailingBlockId(text);

  // Stricter rule for the prompted flows: a missing trailing block ID always
  // means "ask the user", even when an `[id:: value]` is already present. The
  // caller will run the prompt, then keep the existing `[id::]` as the
  // dependency value while linking navigation to the confirmed block ID.
  if (promptWhenBlockIdMissing && !blockId) {
    return Object.freeze({
      value: idFieldValue || null,
      linkBlockId: null,
      needsBlockIdPrompt: true,
      targetEdits: Object.freeze([]),
    });
  }

  if (idField && idFieldValue) {
    // `[dependsOn:: ...]` keeps the [id::] value for Tasks compatibility, but the
    // visible link must point at the real block: an existing trailing block ID
    // wins, otherwise we are about to append `^idFieldValue` so the link uses it.
    const nextLine = blockId ? text : appendBlockIdToLine(text, idFieldValue);
    return Object.freeze({
      value: idFieldValue,
      linkBlockId: blockId || idFieldValue,
      needsBlockIdPrompt: false,
      targetEdits: Object.freeze(
        getTargetEdit("append-block-id", text, nextLine),
      ),
    });
  }

  if (blockId) {
    const idResult = insertMissingBulletProperty(text, "id", blockId);
    return Object.freeze({
      value: blockId,
      linkBlockId: blockId,
      needsBlockIdPrompt: false,
      targetEdits: Object.freeze(
        getTargetEdit("add-id-field", text, idResult.line),
      ),
    });
  }

  return Object.freeze({
    value: null,
    linkBlockId: null,
    needsBlockIdPrompt: true,
    targetEdits: Object.freeze([]),
  });
}

// Leading whitespace of a line (the list-item indentation for bullets).
function getBulletIndent(line) {
  const match = /^(\s*)/.exec(String(line || ""));
  return match ? match[1] : "";
}

function normalizeDependencyNavigationBlockIds(blockIds) {
  const rawIds = Array.isArray(blockIds) ? blockIds : [blockIds];
  return getUniqueLocalTaskIdValues(rawIds);
}

function formatDependencyNavigationBulletWithMarker(blockIds, indent, marker) {
  const indentText = typeof indent === "string" ? indent : "";
  const markerText = typeof marker === "string" && marker ? marker : "-";
  const ids = normalizeDependencyNavigationBlockIds(blockIds);
  if (ids.length === 0) {
    return "";
  }

  const links = ids
    .map((blockId) => `[[#^${blockId}]]`)
    .join(DEPENDENCY_NAVIGATION_SEPARATOR);
  return `${indentText}${markerText} ${DEPENDENCY_NAVIGATION_EMOJI} **${DEPENDENCY_NAVIGATION_LABEL}:** ${links}`;
}

// Render the managed human-navigation child bullet for dependency block links.
// Accepts either one block ID or an ordered list of block IDs.
function formatDependencyNavigationBullet(blockIds, indent) {
  return formatDependencyNavigationBulletWithMarker(blockIds, indent, "-");
}

function extractDependencyNavigationBlockIds(linkSpan) {
  const ids = [];
  const text = String(linkSpan || "");
  let match = null;
  DEPENDENCY_NAVIGATION_LINK_RE.lastIndex = 0;
  while ((match = DEPENDENCY_NAVIGATION_LINK_RE.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function getDependencyNavigationBlockIds(line) {
  const details = parseDependencyNavigationBulletDetails(line);
  return details ? details.blockIds.slice() : [];
}

// Return the linked block ID when a line is a managed dependency navigation
// bullet (current or legacy label), otherwise null. Kept for narrow legacy
// callers; new code should use getDependencyNavigationBlockIds.
function parseDependencyNavigationBullet(line) {
  const details = parseDependencyNavigationBulletDetails(line);
  return details && details.blockIds.length > 0 ? details.blockIds[0] : null;
}

// Parse a managed dependency navigation bullet into its parts, or null when the
// line is not one. `isLegacy` is true when the visible label is a legacy label
// (e.g. DEPENDENCIES) rather than DEPENDENCY_NAVIGATION_LABEL; `hasEmoji`
// tracks legacy emoji-less bullets independently.
function parseDependencyNavigationBulletDetails(line) {
  const match = DEPENDENCY_NAVIGATION_BULLET_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  const { indent, marker, emoji, label, linkSpan } = match.groups;
  const blockIds = extractDependencyNavigationBlockIds(linkSpan);
  if (blockIds.length === 0) {
    return null;
  }

  return Object.freeze({
    indent,
    marker,
    label,
    blockId: blockIds[0],
    blockIds: Object.freeze(blockIds),
    isLegacy: LEGACY_DEPENDENCY_NAVIGATION_LABELS.has(label),
    hasEmoji: Boolean(emoji),
  });
}

// Rewrite a managed dependency navigation bullet to the current label while
// preserving its existing indentation and list marker, so a legacy bullet can be
// normalized in place without disturbing tab-indented or non-dash markers.
function formatDependencyNavigationBulletFromDetails(details) {
  const blockIds = Array.isArray(details && details.blockIds)
    ? details.blockIds
    : [details && details.blockId];
  return formatDependencyNavigationBulletWithMarker(
    blockIds,
    details && details.indent,
    details && details.marker,
  );
}

// Capture the index range of the current bullet's child block: every later line
// that is blank or indented deeper than the parent, stopping at the first
// nonblank line indented at or shallower than the parent (or EOF). Trailing
// blank lines past the last deeper-indented child are excluded. Mirrors
// getProjectSourceTaskBlock but operates on a plain line array and returns only
// the bounds. `parentLine` is a 0-based index into `lines`.
function findCurrentBulletChildBlock(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return Object.freeze({ startLine: 0, endLineExclusive: 0 });
  }

  const startLine = parentIndex + 1;
  const parentIndentLength = getBulletIndent(
    String(sourceLines[parentIndex] || ""),
  ).length;
  let endLineExclusive = startLine;

  for (let index = startLine; index < sourceLines.length; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (getBulletIndent(lineText).length > parentIndentLength) {
      endLineExclusive = index + 1;
      continue;
    }

    break;
  }

  return Object.freeze({ startLine, endLineExclusive });
}

// Pick the indentation for a new dependency child bullet: reuse the first
// existing direct-child list item's indentation (so tab-indented blocks stay
// consistent), otherwise indent the parent by two spaces to match the requested
// `  - ...` shape for a top-level bullet.
function getDependencyChildIndent(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const parentIndent = Number.isFinite(parentIndex)
    ? getBulletIndent(String(sourceLines[parentIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (BULLET_PROPERTY_LIST_ITEM_RE.test(lineText)) {
      return getBulletIndent(lineText);
    }
  }

  return `${parentIndent}  `;
}

function getDependencyDirectChildIndentLength(lines, parentLine, block) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const childBlock =
    block || findCurrentBulletChildBlock(sourceLines, parentIndex);
  const parentIndentLength = Number.isFinite(parentIndex)
    ? getBulletIndent(String(sourceLines[parentIndex] || "")).length
    : 0;
  let childIndentLength = null;

  for (
    let index = childBlock.startLine;
    index < childBlock.endLineExclusive;
    index += 1
  ) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "" || !BULLET_PROPERTY_LIST_ITEM_RE.test(lineText)) {
      continue;
    }

    const indentLength = getBulletIndent(lineText).length;
    if (indentLength <= parentIndentLength) {
      continue;
    }

    if (childIndentLength === null || indentLength < childIndentLength) {
      childIndentLength = indentLength;
    }
  }

  return childIndentLength;
}

function createDependencyNavigationCollection(fields) {
  return Object.freeze({
    lineIndices: Object.freeze((fields.lineIndices || []).slice()),
    blockIds: Object.freeze((fields.blockIds || []).slice()),
    indent: fields.indent === undefined ? null : fields.indent,
    marker: fields.marker === undefined ? null : fields.marker,
    anyLegacy: Boolean(fields.anyLegacy),
    startLine: fields.startLine === undefined ? 0 : fields.startLine,
    endLineExclusive:
      fields.endLineExclusive === undefined ? 0 : fields.endLineExclusive,
    reason: fields.reason === undefined ? null : fields.reason,
  });
}

function collectDependencyNavigationBullets(content, parentLine) {
  const lines = String(content || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));

  const emptyCollection = (reason) =>
    createDependencyNavigationCollection({
      lineIndices: [],
      blockIds: [],
      startLine:
        Number.isFinite(parentIndex) && parentIndex >= 0 ? parentIndex + 1 : 0,
      endLineExclusive:
        Number.isFinite(parentIndex) && parentIndex >= 0 ? parentIndex + 1 : 0,
      reason,
    });

  if (
    !Number.isFinite(parentIndex) ||
    parentIndex < 0 ||
    parentIndex >= lines.length
  ) {
    return emptyCollection("parent-out-of-range");
  }

  if (!isBulletLine(lines[parentIndex])) {
    return emptyCollection("not-bullet");
  }

  const block = findCurrentBulletChildBlock(lines, parentIndex);
  const directChildIndentLength = getDependencyDirectChildIndentLength(
    lines,
    parentIndex,
    block,
  );
  const lineIndices = [];
  const blockIds = [];
  const seenBlockIds = new Set();
  let indent = null;
  let marker = null;
  let anyLegacy = false;

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(lines[index] || "");
    if (
      directChildIndentLength !== null &&
      getBulletIndent(lineText).length !== directChildIndentLength
    ) {
      continue;
    }

    const details = parseDependencyNavigationBulletDetails(lineText);
    if (details === null) {
      continue;
    }

    if (lineIndices.length === 0) {
      indent = details.indent;
      marker = details.marker;
    }

    lineIndices.push(index);
    if (
      details.isLegacy ||
      !details.hasEmoji ||
      lineText !== formatDependencyNavigationBulletFromDetails(details)
    ) {
      anyLegacy = true;
    }

    details.blockIds.forEach((blockId) => {
      const normalized = normalizeBulletPropertyValue(blockId);
      if (!normalized || seenBlockIds.has(normalized)) {
        return;
      }

      seenBlockIds.add(normalized);
      blockIds.push(normalized);
    });
  }

  return createDependencyNavigationCollection({
    lineIndices,
    blockIds,
    indent,
    marker,
    anyLegacy,
    startLine: block.startLine,
    endLineExclusive: block.endLineExclusive,
    reason: null,
  });
}

function computeFinalDependencyLinkOrder(existingIds, addIds, removeIds) {
  const removeSet = new Set(normalizeDependencyNavigationBlockIds(removeIds));
  const finalIds = [];
  const seenIds = new Set();

  normalizeDependencyNavigationBlockIds(existingIds).forEach((blockId) => {
    if (removeSet.has(blockId) || seenIds.has(blockId)) {
      return;
    }

    seenIds.add(blockId);
    finalIds.push(blockId);
  });

  normalizeDependencyNavigationBlockIds(addIds).forEach((blockId) => {
    if (seenIds.has(blockId)) {
      return;
    }

    seenIds.add(blockId);
    finalIds.push(blockId);
  });

  return finalIds;
}

function createDependencyNavigationSyncPlan(fields) {
  return Object.freeze({
    operation: fields.operation,
    changed: Boolean(fields.changed),
    reason: fields.reason === undefined ? null : fields.reason,
    insertLine: fields.insertLine === undefined ? null : fields.insertLine,
    replaceLine: fields.replaceLine === undefined ? null : fields.replaceLine,
    lineText: fields.lineText === undefined ? null : fields.lineText,
    deleteLines: Object.freeze((fields.deleteLines || []).slice()),
    blockIds: Object.freeze((fields.blockIds || []).slice()),
    existingBlockIds: Object.freeze((fields.existingBlockIds || []).slice()),
    lineIndices: Object.freeze((fields.lineIndices || []).slice()),
    consolidated: Boolean(fields.consolidated),
  });
}

function planDependencyNavigationBulletSync(content, parentLine, finalBlockIds) {
  const lines = String(content || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const finalIds = normalizeDependencyNavigationBlockIds(finalBlockIds);
  const guard = (reason) =>
    createDependencyNavigationSyncPlan({
      operation: "guard",
      changed: false,
      reason,
      blockIds: finalIds,
    });

  if (
    !Number.isFinite(parentIndex) ||
    parentIndex < 0 ||
    parentIndex >= lines.length
  ) {
    return guard("parent-out-of-range");
  }

  if (!isBulletLine(lines[parentIndex])) {
    return guard("not-bullet");
  }

  const collection = collectDependencyNavigationBullets(content, parentIndex);
  if (collection.reason) {
    return guard(collection.reason);
  }

  if (collection.lineIndices.length === 0) {
    if (finalIds.length === 0) {
      return createDependencyNavigationSyncPlan({
        operation: "noop",
        changed: false,
        blockIds: finalIds,
        existingBlockIds: collection.blockIds,
        lineIndices: collection.lineIndices,
      });
    }

    const indent = getDependencyChildIndent(lines, parentIndex);
    return createDependencyNavigationSyncPlan({
      operation: "insert",
      changed: true,
      insertLine: collection.startLine,
      lineText: formatDependencyNavigationBullet(finalIds, indent),
      blockIds: finalIds,
      existingBlockIds: collection.blockIds,
      lineIndices: collection.lineIndices,
    });
  }

  if (finalIds.length === 0) {
    return createDependencyNavigationSyncPlan({
      operation: "delete",
      changed: true,
      deleteLines: collection.lineIndices,
      blockIds: finalIds,
      existingBlockIds: collection.blockIds,
      lineIndices: collection.lineIndices,
      consolidated: collection.lineIndices.length > 1 || collection.anyLegacy,
    });
  }

  const replaceLine = collection.lineIndices[0];
  const lineText = formatDependencyNavigationBulletWithMarker(
    finalIds,
    collection.indent,
    collection.marker,
  );
  if (
    collection.lineIndices.length === 1 &&
    lines[replaceLine] === lineText
  ) {
    return createDependencyNavigationSyncPlan({
      operation: "noop",
      changed: false,
      blockIds: finalIds,
      existingBlockIds: collection.blockIds,
      lineIndices: collection.lineIndices,
    });
  }

  return createDependencyNavigationSyncPlan({
    operation: "rewrite",
    changed: true,
    replaceLine,
    lineText,
    deleteLines: collection.lineIndices.slice(1),
    blockIds: finalIds,
    existingBlockIds: collection.blockIds,
    lineIndices: collection.lineIndices,
    consolidated: collection.lineIndices.length > 1 || collection.anyLegacy,
  });
}

function planDependencyNavigationBulletInsertion(content, parentLine, blockId) {
  const collection = collectDependencyNavigationBullets(content, parentLine);
  return planDependencyNavigationBulletSync(
    content,
    parentLine,
    computeFinalDependencyLinkOrder(collection.blockIds, [blockId], []),
  );
}

function planDependencyNavigationBulletRemoval(content, parentLine, blockId) {
  const collection = collectDependencyNavigationBullets(content, parentLine);
  return planDependencyNavigationBulletSync(
    content,
    parentLine,
    computeFinalDependencyLinkOrder(collection.blockIds, [], [blockId]),
  );
}

function planDependencyNavigationLabelNormalizations(content, parentLine) {
  const lines = String(content || "").split(/\r?\n/);
  const collection = collectDependencyNavigationBullets(content, parentLine);
  if (collection.lineIndices.length === 0) {
    return Object.freeze([]);
  }

  const plan = planDependencyNavigationBulletSync(
    content,
    parentLine,
    collection.blockIds,
  );
  if (plan.operation !== "rewrite") {
    return Object.freeze([]);
  }

  return Object.freeze([
    Object.freeze({
      line: plan.replaceLine,
      oldLineText: lines[plan.replaceLine],
      lineText: plan.lineText,
      deleteLines: plan.deleteLines,
    }),
  ]);
}

function applyDependencyNavigationBulletSyncPlan(cm, plan) {
  const result = {
    changed: false,
    inserted: 0,
    deleted: 0,
    replaced: 0,
    consolidated: false,
  };

  if (!plan || !plan.changed) {
    return Object.freeze(result);
  }

  (plan.deleteLines || [])
    .slice()
    .sort((a, b) => b - a)
    .forEach((line) => {
      if (deleteEditorLine(cm, line)) {
        result.deleted += 1;
        result.changed = true;
      }
    });

  if (plan.operation === "rewrite" && plan.replaceLine !== null) {
    const oldLineText = getEditorLine(cm, plan.replaceLine);
    if (oldLineText !== null && oldLineText !== plan.lineText) {
      if (
        replaceEditorLine(cm, plan.replaceLine, oldLineText, plan.lineText)
      ) {
        result.replaced += 1;
        result.changed = true;
      }
    }
  } else if (plan.operation === "insert") {
    if (insertEditorLine(cm, plan.insertLine, plan.lineText)) {
      result.inserted += 1;
      result.changed = true;
    }
  }

  result.consolidated = Boolean(plan.consolidated && result.changed);
  return Object.freeze(result);
}

// Re-read editor content and rewrite managed dependency navigation bullets in
// the current child block to the canonical single-line format. Returns the
// number of concrete line edits applied.
function normalizeDependencyNavigationLabels(cm, parentLine) {
  const content =
    cm && typeof cm.getValue === "function"
      ? String(cm.getValue() || "")
      : null;
  if (content === null) {
    return 0;
  }

  const collection = collectDependencyNavigationBullets(content, parentLine);
  const plan = planDependencyNavigationBulletSync(
    content,
    parentLine,
    collection.blockIds,
  );
  const applied = applyDependencyNavigationBulletSyncPlan(cm, plan);
  return applied.inserted + applied.deleted + applied.replaced;
}

// Build the notice for a local-task dependency write, distinguishing whether the
// `[dependsOn:: ...]` field was newly added vs already present and summarizing
// how the single managed navigation bullet changed.
function buildLocalTaskDependencyNotice(details = {}) {
  const id = normalizeBulletPropertyValue(details.id);
  const name = String(details.name || "");
  const dependencyText = details.dependencyAlreadyPresent
    ? `Already depends on ${id}`
    : `${name} → ${id}`;
  const navigationParts = [];

  switch (details.navigationResult) {
    case "added":
      navigationParts.push("added navigation link");
      break;
    case "updated":
      navigationParts.push("updated navigation bullet");
      break;
    case "already-present":
      navigationParts.push("navigation link already present");
      break;
    case "failed":
    case "guard-failed":
      return `${dependencyText} (could not add navigation link)`;
    default:
      break;
  }

  if (details.navigationConsolidated) {
    navigationParts.push("consolidated navigation bullet");
  }

  return navigationParts.length > 0
    ? `${dependencyText}; ${navigationParts.join("; ")}`
    : dependencyText;
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildMultiDependencyNotice(details = {}) {
  const added = Math.max(0, Math.floor(numericOrDefault(details.added, 0)));
  const removed = Math.max(0, Math.floor(numericOrDefault(details.removed, 0)));
  const navigationAdded = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationAdded, 0)),
  );
  const navigationRemoved = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationRemoved, 0)),
  );
  const navigationUpdated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationUpdated, 0)),
  );
  const navigationConsolidated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationConsolidated, 0)),
  );
  const skippedStale = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedStale, 0)),
  );
  const skippedOther = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedOther, 0)),
  );
  const parts = [];

  if (added > 0) {
    parts.push(
      `Linked ${formatCountLabel(added, "dependency", "dependencies")}`,
    );
  }
  if (removed > 0) {
    parts.push(
      `Unlinked ${formatCountLabel(removed, "dependency", "dependencies")}`,
    );
  }

  const navigationParts = [];
  if (navigationAdded > 0) {
    navigationParts.push(`added ${formatCountLabel(navigationAdded, "link")}`);
  }
  if (navigationRemoved > 0) {
    navigationParts.push(
      `removed ${formatCountLabel(navigationRemoved, "link")}`,
    );
  }
  if (navigationUpdated > 0) {
    navigationParts.push(
      `updated ${formatCountLabel(navigationUpdated, "bullet")}`,
    );
  }
  if (navigationConsolidated > 0) {
    navigationParts.push(
      `consolidated ${formatCountLabel(navigationConsolidated, "task")}`,
    );
  }
  if (navigationParts.length > 0) {
    parts.push(`Navigation ${navigationParts.join(", ")}`);
  }

  if (skippedStale > 0) {
    parts.push(
      `Skipped ${formatCountLabel(
        skippedStale,
        "changed task",
        "changed tasks",
      )}`,
    );
  }
  if (skippedOther > 0) {
    parts.push(
      `Skipped ${formatCountLabel(skippedOther, "task", "tasks")}`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : "No dependency changes";
}

function parseLocalTaskIdList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function getUniqueLocalTaskIdValues(values) {
  const uniqueValues = [];
  const seenValues = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeBulletPropertyValue(value);
    if (!normalized || seenValues.has(normalized)) {
      return;
    }

    seenValues.add(normalized);
    uniqueValues.push(normalized);
  });

  return uniqueValues;
}

function upsertLocalTaskIdValue(line, name, id) {
  const text = String(line || "");
  const value = normalizeBulletPropertyValue(id);
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      alreadyPresent: false,
      field: null,
    });
  }

  if (!value) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "empty-id",
      alreadyPresent: false,
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    const values = parseLocalTaskIdList(existingField.value);
    if (values.includes(value)) {
      return Object.freeze({
        line: text,
        changed: false,
        action: "none",
        reason: null,
        alreadyPresent: true,
        field: existingField,
      });
    }

    const uniqueValues = [];
    const seenValues = new Set();
    values.forEach((existingValue) => {
      if (seenValues.has(existingValue)) {
        return;
      }

      seenValues.add(existingValue);
      uniqueValues.push(existingValue);
    });

    const nextFieldText = formatBulletPropertyField(
      name,
      [...uniqueValues, value].join(", "),
    );
    const nextLine =
      text.slice(0, existingField.span.start) +
      nextFieldText +
      text.slice(existingField.span.end);

    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      alreadyPresent: false,
      field: existingField,
    });
  }

  const insertResult = insertMissingBulletProperty(text, name, value);
  return Object.freeze({
    line: insertResult.line,
    changed: insertResult.changed,
    action: "insert",
    reason: insertResult.reason,
    alreadyPresent: false,
    field: null,
  });
}

function removeBulletPropertyFieldSpan(line, span) {
  const before = line.slice(0, span.start);
  const after = line.slice(span.end);
  const nextWhitespace = /^[ \t]+/.exec(after);
  const previousWhitespace = /[ \t]+$/.exec(before);
  const afterWithoutSpaces = nextWhitespace
    ? after.slice(nextWhitespace[0].length)
    : after;
  const nextIsTrailingBlockId =
    nextWhitespace &&
    BULLET_PROPERTY_BLOCK_ID_ONLY_RE.test(afterWithoutSpaces);

  if (nextWhitespace && !nextIsTrailingBlockId) {
    return before + after.slice(1);
  }

  if (previousWhitespace) {
    return before.slice(0, -1) + after;
  }

  if (nextWhitespace) {
    return before + after.slice(1);
  }

  return before + after;
}

function deleteBulletProperty(line, name) {
  const text = String(line || "");
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  if (!existingField) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-found",
      field: null,
    });
  }

  const nextLine = removeBulletPropertyFieldSpan(text, existingField.span);
  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "delete",
    reason: null,
    field: existingField,
  });
}

function applyLocalTaskDependencyListEdits(line, name, edits = {}) {
  const text = String(line || "");
  const addValues = getUniqueLocalTaskIdValues(edits.add || []);
  const removeValues = getUniqueLocalTaskIdValues(edits.remove || []);

  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      added: Object.freeze([]),
      removed: Object.freeze([]),
      finalValues: Object.freeze([]),
      fieldDropped: false,
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  const existingValues = existingField
    ? getUniqueLocalTaskIdValues(parseLocalTaskIdList(existingField.value))
    : [];
  const existingSet = new Set(existingValues);
  const removeSet = new Set(removeValues);
  const finalValues = [];
  const finalSet = new Set();

  existingValues.forEach((value) => {
    if (removeSet.has(value) || finalSet.has(value)) {
      return;
    }

    finalSet.add(value);
    finalValues.push(value);
  });

  addValues.forEach((value) => {
    if (finalSet.has(value)) {
      return;
    }

    finalSet.add(value);
    finalValues.push(value);
  });

  const added = addValues.filter(
    (value) => !existingSet.has(value) && finalSet.has(value),
  );
  const removed = removeValues.filter(
    (value) => existingSet.has(value) && !finalSet.has(value),
  );

  if (!existingField && finalValues.length === 0) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-found",
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: false,
      field: null,
    });
  }

  if (finalValues.length === 0) {
    const deleteResult = deleteBulletProperty(text, name);
    return Object.freeze({
      line: deleteResult.line,
      changed: deleteResult.changed,
      action: deleteResult.changed ? "delete" : "none",
      reason: deleteResult.reason,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: deleteResult.changed,
      field: existingField,
    });
  }

  const nextFieldText = formatBulletPropertyField(name, finalValues.join(", "));
  if (existingField) {
    const nextLine =
      text.slice(0, existingField.span.start) +
      nextFieldText +
      text.slice(existingField.span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: false,
      field: existingField,
    });
  }

  const insertResult = insertMissingBulletProperty(
    text,
    name,
    finalValues.join(", "),
  );
  return Object.freeze({
    line: insertResult.line,
    changed: insertResult.changed,
    action: insertResult.changed ? "insert" : "none",
    reason: insertResult.reason,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    finalValues: Object.freeze(finalValues),
    fieldDropped: false,
    field: null,
  });
}

function normalizeVimRepeat(value) {
  const repeat = Math.floor(numericOrDefault(value, 1));
  return Number.isFinite(repeat) && repeat > 0 ? repeat : 1;
}

function getVimRepeat(actionArgs) {
  return normalizeVimRepeat(actionArgs && actionArgs.repeat);
}

function hasVimRepeat(actionArgs) {
  if (!actionArgs) {
    return false;
  }
  // CodeMirror's Vim always sets actionArgs.repeat (defaulting to 1 when no
  // count is typed) and signals an explicitly-typed count via repeatIsExplicit.
  // Trust that flag when present; bare <Enter> arrives as
  // { repeat: 1, repeatIsExplicit: false } and must be treated as "no count".
  if (typeof actionArgs.repeatIsExplicit === "boolean") {
    return actionArgs.repeatIsExplicit;
  }
  // Fallback for callers/tests that omit repeatIsExplicit.
  return actionArgs.repeat !== undefined && actionArgs.repeat !== null;
}

function getPendingVimRepeat(cm) {
  const inputState = cm && cm.state && cm.state.vim && cm.state.vim.inputState;
  const rawKeyBuffer = inputState && inputState.keyBuffer;
  const keyBufferText = Array.isArray(rawKeyBuffer)
    ? rawKeyBuffer.join("")
    : typeof rawKeyBuffer === "string"
      ? rawKeyBuffer
      : "";
  const keyBufferMatch = keyBufferText.match(/^([1-9]\d*)/);
  if (keyBufferMatch) {
    const repeat = Math.floor(
      numericOrDefault(keyBufferMatch[1], Number.NaN),
    );
    if (Number.isFinite(repeat) && repeat > 0) {
      return { repeat, explicit: true };
    }
  }

  const rawRepeat =
    inputState && typeof inputState.getRepeat === "function"
      ? inputState.getRepeat()
      : null;
  const repeat = Math.floor(numericOrDefault(rawRepeat, Number.NaN));

  return Number.isFinite(repeat) && repeat > 0
    ? { repeat, explicit: true }
    : { repeat: 1, explicit: false };
}

function resetPendingVimInputState(cm, reason = "") {
  const vimState = cm && cm.state && cm.state.vim;
  const inputState = vimState && vimState.inputState;
  if (!vimState || !inputState) {
    return false;
  }

  const clearedArrayFields = [
    "prefixRepeat",
    "motionRepeat",
    "keyBuffer",
  ];
  const clearedNullFields = [
    "operator",
    "operatorArgs",
    "motion",
    "motionArgs",
    "registerName",
    "selectedCharacter",
  ];
  const clearedFalseFields = ["operatorShortcut", "visualLine", "visualBlock"];

  try {
    for (const field of clearedArrayFields) {
      inputState[field] = [];
    }
    for (const field of clearedNullFields) {
      if (Object.prototype.hasOwnProperty.call(inputState, field)) {
        inputState[field] = null;
      }
    }
    for (const field of clearedFalseFields) {
      if (Object.prototype.hasOwnProperty.call(inputState, field)) {
        inputState[field] = false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(inputState, "repeat")) {
      inputState.repeat = null;
    }
    if (reason && Object.prototype.hasOwnProperty.call(inputState, "reason")) {
      inputState.reason = reason;
    }
    return true;
  } catch (error) {
    // Fall through to replacing the inputState as a last resort.
  }

  try {
    if (typeof inputState.constructor === "function") {
      vimState.inputState = new inputState.constructor();
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
}

function getVimTargetOffset(actionArgs, direction, defaultOffset) {
  if (!hasVimRepeat(actionArgs)) {
    return defaultOffset;
  }

  const offsetDirection = direction < 0 ? -1 : 1;
  return offsetDirection * getVimRepeat(actionArgs);
}

function getVimOffsetTargetLine(cm, actionArgs, direction, defaultOffset) {
  const cursor = getEditorCursor(cm);
  if (!cursor) {
    return null;
  }

  const firstLine = getEditorFirstLine(cm);
  const lastLine = getEditorLastLine(cm);
  const targetOffset = getVimTargetOffset(
    actionArgs,
    direction,
    defaultOffset === undefined ? (direction < 0 ? -1 : 1) : defaultOffset,
  );
  let targetLine = cursor.line + targetOffset;

  targetLine = Math.max(
    targetLine,
    firstLine === null ? 0 : firstLine,
  );

  return lastLine === null ? targetLine : Math.min(targetLine, lastLine);
}

function getVimEnterTargetLine(cm, actionArgs) {
  return getVimOffsetTargetLine(cm, actionArgs, 1, 0);
}

function getVimBackspaceTargetLine(cm, actionArgs) {
  return getVimOffsetTargetLine(cm, actionArgs, -1, -1);
}

function isExternalLinkTarget(target) {
  const text = String(target || "").trim();
  return URL_OR_URI_SCHEME_RE.test(text) || text.startsWith("//");
}

function normalizeVaultRelativePath(path) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");
}

function isUnsafeVaultPath(path) {
  const text = String(path || "");
  if (
    !text ||
    text.startsWith("/") ||
    text.includes("\0") ||
    WINDOWS_ABSOLUTE_PATH_RE.test(text)
  ) {
    return true;
  }

  return text
    .split("/")
    .some((part) => part === "" || part === "." || part === "..");
}

function hasNonMarkdownExtension(path) {
  const lastPart = String(path || "").split("/").pop() || "";
  const extensionMatch = lastPart.match(/\.([A-Za-z0-9]+)$/);
  return !!extensionMatch && extensionMatch[1].toLowerCase() !== "md";
}

function splitVaultPath(path) {
  const normalized = normalizeVaultRelativePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return {
      folderPath: "",
      basename: normalized.replace(MARKDOWN_EXTENSION_RE, ""),
      fileName: normalized,
    };
  }

  const folderPath = normalized.slice(0, slashIndex);
  const fileName = normalized.slice(slashIndex + 1);
  return {
    folderPath,
    basename: fileName.replace(MARKDOWN_EXTENSION_RE, ""),
    fileName,
  };
}

function stripFinalExtension(fileName) {
  const text = String(fileName || "");
  const dotIndex = text.lastIndexOf(".");
  if (dotIndex <= 0) {
    return text;
  }

  return text.replace(FINAL_EXTENSION_RE, "");
}

function getVaultRelativeFilePath(file) {
  return file && file.path ? normalizeVaultRelativePath(file.path) : "";
}

function getVaultRelativeParentDirectory(path) {
  return splitVaultPath(path).folderPath;
}

function getVaultPathBasename(path) {
  return splitVaultPath(path).fileName;
}

function getVaultPathBasenameWithoutExtension(path) {
  return stripFinalExtension(getVaultPathBasename(path));
}

function normalizeFilesystemPath(path) {
  const text = String(path || "").trim().replace(/\\/g, "/");
  if (!text) {
    return "";
  }

  const leadingDoubleSlash = text.startsWith("//");
  const body = leadingDoubleSlash ? text.slice(2) : text;
  return `${leadingDoubleSlash ? "//" : ""}${body.replace(/\/+/g, "/")}`;
}

function joinFilesystemPath(basePath, relativePath) {
  const base = normalizeFilesystemPath(basePath).replace(/\/+$/, "");
  const relative = normalizeVaultRelativePath(relativePath).replace(/^\/+/, "");
  if (!base) {
    return "";
  }

  return relative ? `${base}/${relative}` : base;
}

function compactHomePath(path, homePath) {
  const normalizedPath = normalizeFilesystemPath(path);
  const normalizedHome = normalizeFilesystemPath(homePath).replace(/\/+$/, "");
  if (!normalizedPath || !normalizedHome) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedHome) {
    return "~";
  }

  return normalizedPath.startsWith(`${normalizedHome}/`)
    ? `~${normalizedPath.slice(normalizedHome.length)}`
    : normalizedPath;
}

function getHomeDirectoryPath() {
  if (typeof process === "undefined" || !process.env) {
    return "";
  }

  return process.env.HOME || process.env.USERPROFILE || "";
}

function getYankPathText(kind, relativePath, basePath, homePath) {
  const vaultRelativePath = normalizeVaultRelativePath(relativePath);

  switch (kind) {
    case "absolute": {
      return joinFilesystemPath(basePath, vaultRelativePath);
    }
    case "absolute-tilde": {
      const absolutePath = joinFilesystemPath(basePath, vaultRelativePath);
      return absolutePath ? compactHomePath(absolutePath, homePath) : "";
    }
    case "basename":
      return getVaultPathBasename(vaultRelativePath);
    case "basename-no-extension":
      return getVaultPathBasenameWithoutExtension(vaultRelativePath);
    case "parent-directory":
      return getVaultRelativeParentDirectory(vaultRelativePath);
    case "relative":
      return vaultRelativePath;
    default:
      return null;
  }
}

function getYankPathPreviewText(result) {
  if (!result || !result.ok) {
    return result && result.message ? result.message : "Unavailable";
  }

  return result.text === "" ? "(empty string)" : result.text;
}

function createYankPathPickerItem(plugin, command, file) {
  const result = plugin.getActiveFileYankPath(command.kind, file);
  const available = !!(result && result.ok);

  return {
    kind: command.kind,
    title: YANK_PATH_PICKER_TITLES[command.kind] || command.name,
    preview: getYankPathPreviewText(result),
    actionLabel: available ? "Copy" : "Unavailable",
    available,
  };
}

function getCreatedNoteNoticeText(file, fallbackPath) {
  const path = file && file.path ? file.path : fallbackPath;
  const displayPath = String(path || "").trim();
  return displayPath ? `Created note: ${displayPath}` : "Created note";
}

function getDeletedFileNoticeText(path) {
  const displayPath = String(path || "").trim();
  return displayPath ? `Deleted "${displayPath}"` : "Deleted file";
}

function getFinalFileExtension(fileName) {
  const text = String(fileName || "");
  const basename = stripFinalExtension(text);
  return basename.length === text.length ? "" : text.slice(basename.length);
}

function getFileRenameParts(filePath) {
  const currentPath = normalizeVaultRelativePath(filePath);
  const { folderPath, fileName } = splitVaultPath(currentPath);
  const basename = stripFinalExtension(fileName);
  const extension = getFinalFileExtension(fileName);

  return {
    basename,
    currentPath,
    extension,
    fileName,
    folderPath,
  };
}

function normalizeRenameInput(input, extension) {
  let basename = String(input || "").trim();
  const preservedExtension = String(extension || "");

  if (
    preservedExtension &&
    basename.toLowerCase().endsWith(preservedExtension.toLowerCase())
  ) {
    basename = basename.slice(0, -preservedExtension.length).trim();
  }

  return basename;
}

function getRenameTargetPath(filePath, input) {
  const parts = getFileRenameParts(filePath);
  const basename = normalizeRenameInput(input, parts.extension);

  if (!basename) {
    return { ok: false, message: "File name is empty" };
  }

  if (basename.includes("/") || basename.includes("\\")) {
    return { ok: false, message: "File name cannot include folders" };
  }

  const fileName = `${basename}${parts.extension}`;
  const path = parts.folderPath
    ? joinPathSegments(parts.folderPath, fileName)
    : fileName;

  if (isUnsafeVaultPath(path)) {
    return { ok: false, message: "File name cannot include folders" };
  }

  if (path === parts.currentPath) {
    return { ok: false, message: "Choose a different name" };
  }

  return { ok: true, basename, path };
}

function createRenameLinkAudit(unavailable = false) {
  return {
    bodyLinks: 0,
    embeds: 0,
    frontmatterLinks: 0,
    referenceLinks: 0,
    sourceFilePaths: unavailable ? [] : new Set(),
    totalLinks: 0,
    unavailable,
  };
}

function getCachedReferenceItems(cache, key) {
  const value = cache && cache[key];
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value instanceof Map) {
    return Array.from(value.values()).flat();
  }

  if (typeof value === "object") {
    return Object.values(value).flat();
  }

  return [];
}

function getCachedReferenceLinkText(reference) {
  if (typeof reference === "string") {
    return reference;
  }

  if (!reference || typeof reference !== "object") {
    return "";
  }

  return typeof reference.link === "string" ? reference.link : "";
}

function getRenameAuditCount(value) {
  return Math.max(0, Math.floor(numericOrDefault(value, 0)));
}

function getRenameSourceFileCount(audit) {
  if (!audit) {
    return 0;
  }

  if (Number.isFinite(audit.sourceFileCount)) {
    return getRenameAuditCount(audit.sourceFileCount);
  }

  if (audit.sourceFilePaths instanceof Set) {
    return audit.sourceFilePaths.size;
  }

  if (Array.isArray(audit.sourceFilePaths)) {
    return new Set(audit.sourceFilePaths.filter(Boolean)).size;
  }

  return 0;
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getRenameCategoryNoticeParts(audit) {
  return [
    [audit && audit.bodyLinks, "body", "body"],
    [audit && audit.embeds, "embed", "embeds"],
    [audit && audit.frontmatterLinks, "property", "properties"],
    [audit && audit.referenceLinks, "reference", "references"],
  ]
    .map(([count, singular, plural]) => [
      getRenameAuditCount(count),
      singular,
      plural,
    ])
    .filter(([count]) => count > 0)
    .map(([count, singular, plural]) => pluralize(count, singular, plural));
}

function getRenamedFileNoticeText(oldPath, newPath, audit) {
  const prefix = `Renamed "${oldPath}" to "${newPath}"`;

  if (!audit || audit.unavailable) {
    return `${prefix} (link summary unavailable)`;
  }

  const totalLinks = getRenameAuditCount(audit.totalLinks);
  if (totalLinks === 0) {
    return `${prefix} (no links found)`;
  }

  const sourceFileCount = getRenameSourceFileCount(audit);
  const sourceText =
    sourceFileCount > 0
      ? ` in ${pluralize(sourceFileCount, "file", "files")}`
      : "";
  const categoryParts = getRenameCategoryNoticeParts(audit);
  const categoryText =
    categoryParts.length > 0 ? `: ${categoryParts.join(", ")}` : "";

  return `${prefix} (updated ${pluralize(
    totalLinks,
    "link",
    "links",
  )}${sourceText}${categoryText})`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseProjectTaskDescription(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getProjectPriorityField(description) {
  return (
    parseBulletPropertyFields(description).find(
      (field) => field.key === "p" && /^\d+$/.test(field.value),
    ) || null
  );
}

function parseProjectSourceTaskLine(lineText) {
  const text = String(lineText || "");
  const match = PROJECT_SOURCE_TASK_LINE_RE.exec(text);
  if (!match) {
    return null;
  }

  const status = match[2];
  const body = match[3] || "";
  if (
    !PROJECT_OPEN_TASK_STATUSES.has(status) ||
    !PROJECT_TASK_TAG_RE.test(body)
  ) {
    return null;
  }

  let description = body;
  let blockId = null;
  const blockIdSpan = getTrailingBlockIdSpan(description);
  if (blockIdSpan) {
    blockId = blockIdSpan.text.trim().slice(1);
    description =
      description.slice(0, blockIdSpan.start) +
      description.slice(blockIdSpan.end);
  }

  let priority = null;
  const priorityField = getProjectPriorityField(description);
  if (priorityField) {
    priority = priorityField.value;
    description =
      description.slice(0, priorityField.span.start) +
      description.slice(priorityField.span.end);
  }

  description = collapseProjectTaskDescription(
    description.replace(PROJECT_TASK_TAG_GLOBAL_RE, "$1"),
  );
  if (!description) {
    return null;
  }

  return Object.freeze({
    description,
    priority,
    blockId,
    status,
  });
}

function getProjectSourceTaskLineNoticeText(lineText) {
  const text = String(lineText || "");
  const match = PROJECT_SOURCE_TASK_LINE_RE.exec(text);
  if (!match) {
    return "Place the cursor on an open #task checkbox";
  }

  const status = match[2];
  const body = match[3] || "";
  if (status === "x" || status === "-") {
    return "Done or cancelled tasks cannot create project notes";
  }

  if (!PROJECT_OPEN_TASK_STATUSES.has(status)) {
    return "Only open tasks can create project notes";
  }

  if (!PROJECT_TASK_TAG_RE.test(body)) {
    return "Project source task must include #task";
  }

  return "Task description is empty";
}

// Capture the selected source task plus its contiguous child block. The block
// is the parent line followed by every later line that is blank or indented
// deeper than the parent, stopping at the first nonblank line indented at or
// shallower than the parent (or EOF). Trailing blank lines past the last
// deeper-indented child are excluded so the surrounding blank separators are
// preserved. Returns { startLine, endLineExclusive, lines, childLines } or
// null when the line is not a list item.
function getProjectSourceTaskBlock(editor, lineNumber, parentLineText) {
  const parentMatch = PROJECT_LIST_ITEM_RE.exec(String(parentLineText || ""));
  if (!parentMatch) {
    return null;
  }

  const startLine = Math.floor(numericOrDefault(lineNumber, Number.NaN));
  if (!Number.isFinite(startLine) || startLine < 0) {
    return null;
  }

  const parentIndentLength = parentMatch[1].length;
  const lastLine = getEditorLastLine(editor);
  const lines = [String(parentLineText)];
  // Offset within `lines` of the last nonblank, deeper-indented child line.
  // Stays 0 (the parent) while no child content has been seen.
  let lastContentOffset = 0;

  if (lastLine !== null) {
    for (let line = startLine + 1; line <= lastLine; line += 1) {
      const lineText = getEditorLineText(editor, line);
      if (lineText === null) {
        break;
      }

      if (lineText.trim() === "") {
        lines.push(lineText);
        continue;
      }

      const indentMatch = /^(\s*)/.exec(lineText);
      const indentLength = indentMatch ? indentMatch[1].length : 0;
      if (indentLength > parentIndentLength) {
        lines.push(lineText);
        lastContentOffset = lines.length - 1;
        continue;
      }

      break;
    }
  }

  const blockLines = lines.slice(0, lastContentOffset + 1);
  return Object.freeze({
    startLine,
    endLineExclusive: startLine + blockLines.length,
    lines: Object.freeze(blockLines),
    childLines: Object.freeze(blockLines.slice(1)),
  });
}

// Parse a single child list item that is indented deeper than
// `parentIndentLength`. Returns marker/checkbox/body metadata or null when the
// line is not a list item or is not deeper than the parent.
function parseProjectChildListItem(lineText, parentIndentLength) {
  const text = String(lineText || "");
  const match = PROJECT_CHILD_LIST_ITEM_RE.exec(text);
  if (!match) {
    return null;
  }

  const indentLength = match[1].length;
  const minIndent = Math.floor(numericOrDefault(parentIndentLength, -1));
  if (Number.isFinite(minIndent) && indentLength <= minIndent) {
    return null;
  }

  const status = match[2] === undefined ? null : match[2];
  const body = String(match[3] || "");
  return Object.freeze({
    indent: match[1],
    indentLength,
    status,
    body,
    hasTask: PROJECT_TASK_TAG_RE.test(body),
    hasCreated: !!findBulletPropertyField(body, "created"),
  });
}

// Render a parsed direct-child list item as a top-level project task: preserve
// any existing checkbox status (defaulting to open), add a standalone #task
// token unless one is present, and append [created::DATE] unless the child
// already carries a created field. A trailing block ID is preserved.
function buildProjectTaskLineFromChildBullet(parsedChild, createdDateString) {
  if (!parsedChild) {
    return null;
  }

  const status =
    parsedChild.status === null || parsedChild.status === undefined
      ? " "
      : parsedChild.status;
  const trimmedBody = String(parsedChild.body || "").trim();
  let taskBody;
  if (parsedChild.hasTask) {
    taskBody = trimmedBody;
  } else {
    taskBody = trimmedBody ? `#task ${trimmedBody}` : "#task";
  }

  if (!parsedChild.hasCreated && createdDateString) {
    const createdField = `[created::${createdDateString}]`;
    const appendIndex = getBulletPropertyAppendIndex(taskBody);
    const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
    const after = taskBody.slice(appendIndex).replace(/^[ \t]+/, " ");
    taskBody = `${before} ${createdField}${after}`;
  }

  return `- [${status}] ${taskBody}`;
}

// Re-indent a line nested below a direct child so it sits one level deeper than
// the converted top-level task: the extra indentation beyond the direct child
// becomes the indentation under the new task. Blank lines collapse to "".
function normalizeNestedChildLine(lineText, directChildIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const baseIndent = String(directChildIndent || "");
  let relativeIndent;
  if (baseIndent && leading.startsWith(baseIndent)) {
    relativeIndent = leading.slice(baseIndent.length);
  } else {
    relativeIndent = "\t";
  }
  if (relativeIndent === "") {
    relativeIndent = "\t";
  }

  return `${relativeIndent}${content}`;
}

// Convert the captured child block into rendered Markdown lines for the new
// project's `## Tasks` section. Direct child list items (those at the shallowest
// child indentation) become top-level tasks; deeper lines stay nested below the
// task they belong to. Returns { taskLines, lossless } where `lossless` is false
// when any nonblank child line could not be represented (so the caller can keep
// the source block instead of losing content).
function buildProjectTasksFromChildBullets(childLines, createdDateString) {
  const lines = Array.isArray(childLines)
    ? childLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];

  let directChildIndentLength = null;
  for (const line of lines) {
    const match = PROJECT_LIST_ITEM_RE.exec(line);
    if (match) {
      const length = match[1].length;
      if (
        directChildIndentLength === null ||
        length < directChildIndentLength
      ) {
        directChildIndentLength = length;
      }
    }
  }

  if (directChildIndentLength === null) {
    const hasContent = lines.some((line) => line.trim() !== "");
    return Object.freeze({
      taskLines: Object.freeze([]),
      lossless: !hasContent,
    });
  }

  const taskLines = [];
  let current = null;
  let lossless = true;

  const flush = () => {
    if (!current) {
      return;
    }

    taskLines.push(current.taskLine);
    const nested = current.nested.slice();
    while (nested.length && nested[0].trim() === "") {
      nested.shift();
    }
    while (nested.length && nested[nested.length - 1].trim() === "") {
      nested.pop();
    }
    for (const nestedLine of nested) {
      taskLines.push(nestedLine);
    }
    current = null;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      if (current) {
        current.nested.push("");
      }
      continue;
    }

    const leadingMatch = /^(\s*)/.exec(line);
    const leading = leadingMatch ? leadingMatch[1] : "";
    const listMatch = PROJECT_LIST_ITEM_RE.exec(line);

    if (listMatch && listMatch[1].length === directChildIndentLength) {
      flush();
      const parsedChild = parseProjectChildListItem(
        line,
        directChildIndentLength - 1,
      );
      const taskLine = buildProjectTaskLineFromChildBullet(
        parsedChild,
        createdDateString,
      );
      if (
        !parsedChild ||
        !taskLine ||
        String(parsedChild.body || "").trim() === ""
      ) {
        lossless = false;
        current = null;
        continue;
      }

      current = { taskLine, nested: [], directChildIndent: leading };
    } else if (leading.length > directChildIndentLength && current) {
      current.nested.push(normalizeNestedChildLine(line, current.directChildIndent));
    } else {
      lossless = false;
    }
  }

  flush();

  return Object.freeze({
    taskLines: Object.freeze(taskLines),
    lossless,
  });
}

// Compact local YYYY-MM-DD, matching the [created::YYYY-MM-DD] convention used
// for project tasks elsewhere in the vault.
function formatProjectTaskCreatedDate(date) {
  const value = date instanceof Date ? date : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Locate the `## Tasks` header line, ignoring frontmatter and fenced code, or
// -1 when there is no such header.
function findProjectTasksHeaderIndex(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (line.trim() === PROJECT_TASKS_HEADER) {
      return lineIndex;
    }
  }

  return -1;
}

// Insert the rendered child tasks into the `## Tasks` section, replacing the
// default placeholder task when present. Returns { content, replaced }; replaced
// is false (and content unchanged) when there is nothing to insert or no
// `## Tasks` section exists.
function replaceProjectTasksPlaceholder(content, renderedTaskLines) {
  const text = String(content || "");
  const taskLines = Array.isArray(renderedTaskLines)
    ? renderedTaskLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];
  if (taskLines.length === 0) {
    return Object.freeze({ content: text, replaced: false });
  }

  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const headerIndex = findProjectTasksHeaderIndex(lines);
  if (headerIndex === -1) {
    return Object.freeze({ content: text, replaced: false });
  }

  let sectionEnd = lines.length;
  let inFence = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (SECTION_HEADER_RE.test(line)) {
      sectionEnd = index;
      break;
    }
  }

  let placeholderIndex = -1;
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    const line = String(lines[index] || "");
    if (
      PROJECT_SOURCE_TASK_LINE_RE.test(line) &&
      line.includes(PROJECT_TASKS_PLACEHOLDER)
    ) {
      placeholderIndex = index;
      break;
    }
  }

  let nextLines;
  if (placeholderIndex !== -1) {
    nextLines = lines
      .slice(0, placeholderIndex)
      .concat(taskLines, lines.slice(placeholderIndex + 1));
  } else {
    let insertAt = headerIndex + 1;
    if (insertAt < sectionEnd && String(lines[insertAt] || "").trim() === "") {
      insertAt += 1;
    }
    nextLines = lines
      .slice(0, insertAt)
      .concat(taskLines, lines.slice(insertAt));
  }

  return Object.freeze({
    content: nextLines.join(lineEnding),
    replaced: true,
  });
}

// Seed the new project note from the parsed source task: fill the `^prj`
// completion criteria, apply the source task's priority, and optionally insert
// converted child tasks into the `## Tasks` section. Returns a result object:
//   seeded              - the `^prj` completion placeholder was found & filled
//   tasksInserted       - child tasks were inserted into `## Tasks`
//   tasksSectionMissing - child tasks were requested but `## Tasks` was absent
//   content             - the rewritten content (unchanged when not seeded)
function buildProjectContentFromTask(content, parsedTask, options = {}) {
  const text = String(content || "");
  if (!text.includes(PROJECT_COMPLETION_PLACEHOLDER)) {
    return Object.freeze({
      content: text,
      seeded: false,
      tasksInserted: false,
      tasksSectionMissing: false,
    });
  }

  let nextContent = text.replace(
    PROJECT_COMPLETION_PLACEHOLDER,
    parsedTask.description,
  );
  if (parsedTask.priority !== null && parsedTask.priority !== undefined) {
    nextContent = nextContent.replace(
      /\[p::\s*2\s*\]/,
      `[p::${parsedTask.priority}]`,
    );
  }

  const childTaskLines = Array.isArray(options.childTaskLines)
    ? options.childTaskLines
    : [];
  let tasksInserted = false;
  let tasksSectionMissing = false;
  if (childTaskLines.length > 0) {
    const tasksResult = replaceProjectTasksPlaceholder(
      nextContent,
      childTaskLines,
    );
    if (tasksResult.replaced) {
      nextContent = tasksResult.content;
      tasksInserted = true;
    } else {
      tasksSectionMissing = true;
    }
  }

  return Object.freeze({
    content: nextContent,
    seeded: true,
    tasksInserted,
    tasksSectionMissing,
  });
}

// Remove a previously captured source task block (parent line plus any child
// lines). The block is removed at its original location when it still matches
// exactly there; otherwise it is removed only when it matches exactly at a
// single unique location. When no safe match exists the content is returned
// unchanged with removed=false so the caller can keep the source block.
function removeTaskBlockFromContent(content, block) {
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const blockLines =
    block && Array.isArray(block.lines) ? block.lines.map(String) : [];
  if (blockLines.length === 0) {
    return Object.freeze({ content: text, removed: false });
  }

  const matchesAt = (index) => {
    if (index < 0 || index + blockLines.length > lines.length) {
      return false;
    }
    for (let offset = 0; offset < blockLines.length; offset += 1) {
      if (lines[index + offset] !== blockLines[offset]) {
        return false;
      }
    }
    return true;
  };

  const startLine = Math.floor(
    numericOrDefault(block && block.startLine, Number.NaN),
  );
  let removeIndex = -1;
  if (Number.isFinite(startLine) && matchesAt(startLine)) {
    removeIndex = startLine;
  } else {
    const matchingIndexes = [];
    for (let index = 0; index + blockLines.length <= lines.length; index += 1) {
      if (matchesAt(index)) {
        matchingIndexes.push(index);
      }
    }
    if (matchingIndexes.length === 1) {
      removeIndex = matchingIndexes[0];
    }
  }

  if (removeIndex === -1) {
    return Object.freeze({
      content: text,
      removed: false,
    });
  }

  lines.splice(removeIndex, blockLines.length);
  return Object.freeze({
    content: lines.join(lineEnding),
    removed: true,
  });
}

function truncateProjectTaskDescription(description) {
  const text = String(description || "").trim();
  if (text.length <= 80) {
    return text;
  }

  return `${text.slice(0, 77)}...`;
}

function getProjectFromTaskNoticeText(
  description,
  sourceBasename,
  createdBasename,
  updatedLinkCount,
) {
  const taskText = truncateProjectTaskDescription(description);
  const sourceText = String(sourceBasename || "").trim();
  const sourceSuffix = sourceText ? ` from ${sourceText}` : "";
  const createdText = String(createdBasename || "").trim();
  const projectSuffix = createdText ? ` ${createdText}` : "";
  const details = [`task removed${sourceSuffix}`];
  const numericLinkCount = numericOrDefault(updatedLinkCount, 0);
  if (numericLinkCount > 0) {
    details.push(
      `${numericLinkCount} ${numericLinkCount === 1 ? "link" : "links"} updated`,
    );
  }

  return `Created project${projectSuffix} from task "${taskText}" (${details.join("; ")})`;
}

function backlinkTextReferencesBlockId(text, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return false;
  }

  const re = new RegExp(`#\\^${escapeRegExp(id)}(?:$|[^A-Za-z0-9-])`);
  return re.test(String(text || ""));
}

function getProjectBasenameFromTaskBlockId(sourceBasename, blockId) {
  const sourceText = String(sourceBasename || "").trim();
  const id = String(blockId || "").trim();
  if (!sourceText || !PROJECT_BLOCK_ID_RE.test(id)) {
    return null;
  }

  return `${sourceText}_${id.replace(/-/g, "_")}`;
}

function getProjectBasenameSuffixForIndex(index, length) {
  const suffixIndex = Math.floor(numericOrDefault(index, Number.NaN));
  const suffixLength = Math.floor(numericOrDefault(length, Number.NaN));
  const alphabet = PROJECT_DEFAULT_BASENAME_SUFFIX_ALPHABET;
  const base = alphabet.length;

  if (
    !Number.isFinite(suffixIndex) ||
    !Number.isFinite(suffixLength) ||
    suffixIndex < 0 ||
    suffixLength < 1
  ) {
    return null;
  }

  const candidateCount = Math.pow(base, suffixLength);
  if (suffixIndex >= candidateCount) {
    return null;
  }

  let remaining = suffixIndex;
  const characters = new Array(suffixLength);
  for (let position = suffixLength - 1; position >= 0; position -= 1) {
    characters[position] = alphabet[remaining % base];
    remaining = Math.floor(remaining / base);
  }

  return characters.join("");
}

function getNextDefaultProjectBasename(sourceBasename, existingBasenames) {
  const sourceText =
    typeof sourceBasename === "string"
      ? sourceBasename
      : String(sourceBasename || "");
  if (!sourceText.trim()) {
    return null;
  }

  const existing = new Set();
  if (
    existingBasenames &&
    typeof existingBasenames[Symbol.iterator] === "function"
  ) {
    for (const basename of existingBasenames) {
      if (typeof basename === "string" && basename) {
        existing.add(basename);
      }
    }
  }

  let checkedCount = 0;
  for (
    let suffixLength = 1;
    checkedCount <= existing.size;
    suffixLength += 1
  ) {
    const suffixCount = Math.pow(
      PROJECT_DEFAULT_BASENAME_SUFFIX_ALPHABET.length,
      suffixLength,
    );
    for (
      let suffixIndex = 0;
      suffixIndex < suffixCount && checkedCount <= existing.size;
      suffixIndex += 1
    ) {
      const suffix = getProjectBasenameSuffixForIndex(
        suffixIndex,
        suffixLength,
      );
      const candidate = `${sourceText}_${suffix}`;
      if (!existing.has(candidate)) {
        return candidate;
      }

      checkedCount += 1;
    }
  }

  return null;
}

function backlinkLinkTargetsBlockId(linkText, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return false;
  }

  return getLinkSubpath(linkText) === `#^${id}`;
}

function backlinkCacheTargetsBlockId(value, blockId) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof value.link === "string" && value.link) {
    return backlinkLinkTargetsBlockId(value.link, blockId);
  }

  return (
    typeof value.original === "string" &&
    backlinkTextReferencesBlockId(value.original, blockId)
  );
}

function collectBlockIdBacklinkOriginals(value, blockId, originals, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (backlinkCacheTargetsBlockId(value, blockId)) {
    const original = String(value.original || "");
    if (original) {
      originals.add(original);
    }
    return;
  }

  if (value instanceof Map) {
    for (const entryValue of value.values()) {
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entryValue) =>
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1),
    );
    return;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entryValue) =>
      collectBlockIdBacklinkOriginals(entryValue, blockId, originals, depth + 1),
    );
  }
}

function collectBlockIdBacklinkRewrites(backlinksData, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return [];
  }

  const entries =
    backlinksData instanceof Map
      ? Array.from(backlinksData.entries())
      : backlinksData && typeof backlinksData === "object"
        ? Object.entries(backlinksData)
        : [];

  return entries
    .map(([path, value]) => {
      const originals = new Set();
      collectBlockIdBacklinkOriginals(value, id, originals);
      return {
        path: String(path || ""),
        originals: Object.freeze(Array.from(originals)),
      };
    })
    .filter((rewrite) => rewrite.path && rewrite.originals.length > 0)
    .map((rewrite) => Object.freeze(rewrite));
}

function rewriteBlockIdLinkOriginal(original, newBasename) {
  const text = String(original || "");
  const targetBasename = String(newBasename || "").trim();
  if (!text || !targetBasename) {
    return null;
  }

  const wikiMatch = /^(!?)\[\[([^\]\n|]*?)#\^[A-Za-z0-9-]+(\|[^\]\n]*)?\]\]$/.exec(
    text,
  );
  if (wikiMatch) {
    return `${wikiMatch[1]}[[${targetBasename}#^prj${wikiMatch[3] || ""}]]`;
  }

  const markdownMatch =
    /^(!?\[[^\]\n]*(?:\\.[^\]\n]*)*\])\(([^)\s]*)#\^[A-Za-z0-9-]+(?:\s+[^)]*)?\)$/.exec(
      text,
    );
  if (markdownMatch) {
    return `${markdownMatch[1]}(${targetBasename}.md#^prj)`;
  }

  return null;
}

function replaceLinkOriginalsInContent(content, replacements) {
  let nextContent = String(content || "");
  const missing = [];

  (Array.isArray(replacements) ? replacements : []).forEach((replacement) => {
    const original = String((replacement && replacement.original) || "");
    const next = String((replacement && replacement.replacement) || "");
    if (!original) {
      return;
    }

    if (!nextContent.includes(original)) {
      missing.push(original);
      return;
    }

    nextContent = nextContent.split(original).join(next);
  });

  return Object.freeze({
    content: nextContent,
    missing,
  });
}

function parseIntegerText(text) {
  return Number.parseInt(String(text || ""), 10);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year, month) {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function isValidMonthText(monthText) {
  const month = parseIntegerText(monthText);
  return month >= 1 && month <= 12;
}

function isValidDateParts(yearText, monthText, dayText) {
  const year = parseIntegerText(yearText);
  const month = parseIntegerText(monthText);
  const day = parseIntegerText(dayText);

  return (
    Number.isInteger(year) &&
    isValidMonthText(monthText) &&
    day >= 1 &&
    day <= getDaysInMonth(year, month)
  );
}

function getNoteTemplateSelection(kind) {
  return NOTE_TEMPLATE_SELECTIONS[kind] || NOTE_TEMPLATE_SELECTIONS.default;
}

function getNoteTemplateForCreationPath(path) {
  const normalizedPath = normalizeVaultRelativePath(path);
  const dailyMatch = normalizedPath.match(DAILY_NOTE_CREATION_PATH_RE);
  if (
    dailyMatch &&
    dailyMatch[1] === dailyMatch[2] &&
    isValidDateParts(dailyMatch[2], dailyMatch[3], dailyMatch[4])
  ) {
    return getNoteTemplateSelection("daily");
  }

  const monthlyMatch = normalizedPath.match(MONTHLY_NOTE_CREATION_PATH_RE);
  if (
    monthlyMatch &&
    monthlyMatch[1] === monthlyMatch[2] &&
    isValidMonthText(monthlyMatch[3])
  ) {
    return getNoteTemplateSelection("monthly");
  }

  if (YEARLY_NOTE_CREATION_PATH_RE.test(normalizedPath)) {
    return getNoteTemplateSelection("yearly");
  }

  return getNoteTemplateSelection("default");
}

// Index of the first subpath marker (`#` heading or `^` block) in a link text,
// or -1 when the link carries no subpath. `note#^abc` -> index of `#`.
function findLinkSubpathIndex(linkText) {
  const text = String(linkText || "");
  const headingIndex = text.indexOf("#");
  const blockIndex = text.indexOf("^");
  if (headingIndex === -1) {
    return blockIndex;
  }
  if (blockIndex === -1) {
    return headingIndex;
  }
  return Math.min(headingIndex, blockIndex);
}

// The `#…` subpath portion (heading and/or `^blockid`) of a link text, or ""
// when there is none. `note.md#^abc` -> `#^abc`; `note` -> "".
function getLinkSubpath(linkText) {
  const subpathIndex = findLinkSubpathIndex(linkText);
  return subpathIndex === -1 ? "" : String(linkText || "").slice(subpathIndex);
}

// True when a link is a *pure* subpath reference into the current note: its
// path part is empty and it carries a non-empty heading/block subpath. Rejects
// the degenerate `#`, `#^`, and the empty string so they never resolve.
function isSubpathOnlyLink(linkText) {
  if (findLinkSubpathIndex(linkText) !== 0) {
    return false;
  }

  const subpath = String(linkText || "");
  return subpath.replace(/[#^]/g, "").trim().length > 0;
}

function startsWithFrontmatter(lines) {
  return lines.length > 0 && /^\s*---\s*$/.test(lines[0]);
}

function getFenceOpening(line) {
  const match = String(line).match(OPENING_FENCE_RE);
  if (!match) {
    return null;
  }

  return {
    markerChar: match[2][0],
    markerLength: match[2].length,
  };
}

function isClosingFence(line, openingFence) {
  const match = String(line).match(CLOSING_FENCE_RE);
  if (!match) {
    return false;
  }

  return (
    match[2][0] === openingFence.markerChar &&
    match[2].length >= openingFence.markerLength
  );
}

function getSectionHeaderLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const headerLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (SECTION_HEADER_RE.test(line)) {
      headerLines.push(lineIndex);
    }
  }

  return headerLines;
}

function getSectionHeaderJumpLine(lines, cursorLine, direction) {
  const currentLine = Math.floor(numericOrDefault(cursorLine, Number.NaN));
  if (!Number.isFinite(currentLine)) {
    return null;
  }

  const headerLines = getSectionHeaderLines(lines);
  if (direction < 0) {
    for (let index = headerLines.length - 1; index >= 0; index -= 1) {
      if (headerLines[index] < currentLine) {
        return headerLines[index];
      }
    }
    return null;
  }

  for (const headerLine of headerLines) {
    if (headerLine > currentLine) {
      return headerLine;
    }
  }

  return null;
}

// True for a Markdown checkbox list item that carries a standalone `#task`
// token (the Tasks plugin global filter) and an open status symbol (space, `/`,
// or `B`). Supports indentation, blockquote prefixes, and ordered or unordered
// markers. Plain checklists without `#task`, and done/cancelled tasks, return
// false.
function isOpenObsidianTaskLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  if (!match) {
    return false;
  }

  const status = match[1];
  const body = match[2] || "";
  return (
    OPEN_OBSIDIAN_TASK_STATUSES.has(status) && PROJECT_TASK_TAG_RE.test(body)
  );
}

// True for an unfenced `## Pomodoros` heading line (allowing a trailing dataview
// summary suffix such as the daily template's duration expression).
function isPomodorosHeading(lineText) {
  return POMODOROS_HEADING_RE.test(String(lineText || ""));
}

// True for any level-two (`## `) Markdown heading. Used to detect when a
// `## Pomodoros` section has ended.
function isLevelTwoHeading(lineText) {
  return LEVEL_TWO_HEADING_RE.test(String(lineText || ""));
}

// True when the text carries a compact (`2050-2125`) or colon (`20:50-21:25`)
// Pomodoro time range in parentheses, optionally bolded with `**` and followed
// by trailing metadata such as `[t:: 35m]`.
function hasPomodoroTimeRange(text) {
  const value = String(text || "");
  return (
    POMODORO_COLON_TIME_RANGE_RE.test(value) ||
    POMODORO_COMPACT_TIME_RANGE_RE.test(value)
  );
}

// True for a top-level (unindented) Pomodoro ledger navigation target: an open
// or completed checkbox status (`[ ]`, `[/]`, `[x]`, or `[X]`) whose body carries
// a time range or an empty `()` placeholder. Indented carried-forward child
// bullets, cancelled Pomodoros (`[-]`), and top-level checkboxes lacking a ledger
// shape return false. The caller is responsible for confirming `## Pomodoros`
// section context before treating a match as a navigation target.
function isPomodoroNavigationTaskLine(lineText) {
  const match = POMODORO_TOP_LEVEL_TASK_LINE_RE.exec(String(lineText || ""));
  if (!match) {
    return false;
  }

  const status = match[1];
  const body = match[2] || "";
  if (!POMODORO_NAVIGATION_STATUSES.has(status)) {
    return false;
  }

  return POMODORO_PLACEHOLDER_RE.test(body) || hasPomodoroTimeRange(body);
}

// Zero-based line indices of every open `#task` line, skipping leading
// frontmatter and fenced code blocks with the same state machine used for
// section headers so task-shaped lines inside YAML, examples, and `tasks`
// query blocks are ignored.
function getOpenObsidianTaskLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (isOpenObsidianTaskLine(line)) {
      taskLines.push(lineIndex);
    }
  }

  return taskLines;
}

// Zero-based line indices of every open-task navigation target: open `#task`
// lines anywhere in the note plus open or done top-level Pomodoro ledger lines
// inside a `## Pomodoros` section. Leading frontmatter and fenced code blocks are
// skipped with the same state machine used for the proper-task scanner, so
// task-shaped lines inside YAML, examples, and `tasks` query blocks are ignored.
// A line that qualifies as both a `#task` and a Pomodoro is added once, and
// indices are returned in ascending file order.
function getOpenTaskNavigationLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;
  let inPomodorosSection = false;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    // Any unfenced level-two heading ends a prior `## Pomodoros` section; a
    // `## Pomodoros` heading (re)opens one. The heading line itself is never a
    // task or top-level checkbox, so it is not added below.
    if (isLevelTwoHeading(line)) {
      inPomodorosSection = isPomodorosHeading(line);
    }

    if (isOpenObsidianTaskLine(line)) {
      taskLines.push(lineIndex);
    } else if (inPomodorosSection && isPomodoroNavigationTaskLine(line)) {
      taskLines.push(lineIndex);
    }
  }

  return taskLines;
}

// Circular open-task navigation: jump to the nearest navigation target
// (open `#task` line or open/done Pomodoro ledger line) in the given direction,
// wrapping across the file boundary when there is no strict neighbour. Returns
// null only when there are no matching targets, or when the sole matching target
// is already on the cursor line (so the caller can show its no-target notice and
// leave the editor untouched).
function getOpenObsidianTaskJumpLine(lines, cursorLine, direction) {
  const currentLine = Math.floor(numericOrDefault(cursorLine, Number.NaN));
  if (!Number.isFinite(currentLine)) {
    return null;
  }

  const taskLines = getOpenTaskNavigationLines(lines);
  if (taskLines.length === 0) {
    return null;
  }

  let targetLine = null;
  if (direction < 0) {
    for (let index = taskLines.length - 1; index >= 0; index -= 1) {
      if (taskLines[index] < currentLine) {
        targetLine = taskLines[index];
        break;
      }
    }
    if (targetLine === null) {
      // No higher open task: wrap to the last open task in the file.
      targetLine = taskLines[taskLines.length - 1];
    }
  } else {
    for (const taskLine of taskLines) {
      if (taskLine > currentLine) {
        targetLine = taskLine;
        break;
      }
    }
    if (targetLine === null) {
      // No lower open task: wrap to the first open task in the file.
      targetLine = taskLines[0];
    }
  }

  // The only matching open task is already on the cursor line; with multiple
  // tasks the resolved target is always a different line, so this leaves the
  // single-task/current-line case as the lone no-target outcome.
  if (targetLine === currentLine) {
    return null;
  }

  return targetLine;
}

function getDashTasksHeaderLine(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  let inFence = null;

  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    if (line.trim() === DASH_TASKS_HEADER) {
      return lineIndex;
    }
  }

  return null;
}

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  const line = Math.floor(numericOrDefault(position.line, Number.NaN));
  const ch = Math.floor(numericOrDefault(position.ch, 0));
  if (!Number.isFinite(line) || line < 0) {
    return null;
  }

  return {
    line,
    ch: Math.max(ch, 0),
  };
}

function getEditorLastLine(editor) {
  if (!editor) {
    return null;
  }

  if (typeof editor.lastLine === "function") {
    const line = Math.floor(numericOrDefault(editor.lastLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  if (typeof editor.lineCount === "function") {
    const count = Math.floor(numericOrDefault(editor.lineCount(), Number.NaN));
    if (Number.isFinite(count)) {
      return Math.max(count - 1, 0);
    }
  }

  if (typeof editor.getValue === "function") {
    return Math.max(String(editor.getValue()).split(/\r?\n/).length - 1, 0);
  }

  return null;
}

function getEditorFirstLine(editor) {
  if (!editor) {
    return null;
  }

  if (typeof editor.firstLine === "function") {
    const line = Math.floor(numericOrDefault(editor.firstLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  return 0;
}

function getEditorLineText(editor, line) {
  if (!editor) {
    return null;
  }

  if (typeof editor.getLine === "function") {
    const text = editor.getLine(line);
    return text === null || text === undefined ? "" : String(text);
  }

  if (typeof editor.getValue === "function") {
    const lines = String(editor.getValue()).split(/\r?\n/);
    return lines[line] === undefined ? "" : lines[line];
  }

  return null;
}

function clampPositionToEditor(editor, position) {
  const normalized = normalizePosition(position);
  if (!normalized) {
    return null;
  }

  const lastLine = getEditorLastLine(editor);
  const line =
    lastLine === null ? normalized.line : Math.min(normalized.line, lastLine);
  const lineText = getEditorLineText(editor, line);
  const ch =
    lineText === null ? normalized.ch : Math.min(normalized.ch, lineText.length);

  return { line, ch };
}

function positionFromTextOffset(text, offset) {
  const value = String(text);
  const targetOffset = Math.min(
    Math.max(Math.floor(numericOrDefault(offset, 0)), 0),
    value.length,
  );
  const beforeCursor = value.slice(0, targetOffset);
  const lines = beforeCursor.split("\n");
  const line = lines.length - 1;
  const lastLine = lines[line] || "";

  return {
    line,
    ch: lastLine.endsWith("\r") ? lastLine.length - 1 : lastLine.length,
  };
}

function positionFromCodeMirrorUpdate(update) {
  const state = update && (update.state || (update.view && update.view.state));
  const selection = state && state.selection;
  const mainSelection = selection && selection.main;
  const rawHead = mainSelection && mainSelection.head;
  const head = Math.floor(numericOrDefault(rawHead, Number.NaN));
  const doc = state && state.doc;

  if (!Number.isFinite(head) || !doc) {
    return null;
  }

  if (typeof doc.lineAt === "function") {
    try {
      const line = doc.lineAt(head);
      if (
        line &&
        Number.isFinite(line.number) &&
        Number.isFinite(line.from)
      ) {
        return normalizePosition({
          line: line.number - 1,
          ch: head - line.from,
        });
      }
    } catch (error) {
      return null;
    }
  }

  if (typeof doc.toString === "function") {
    return positionFromTextOffset(doc.toString(), head);
  }

  return null;
}

function setEditorCursor(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  try {
    editor.setCursor(position.line, position.ch);
  } catch (error) {
    editor.setCursor(position);
  }

  if (typeof editor.scrollIntoView === "function") {
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
    } catch (error) {
      try {
        editor.scrollIntoView(position);
      } catch (ignoredError) {
        // Cursor restore should still succeed if a scroll helper is unavailable.
      }
    }
  }

  return true;
}

function scrollEditorLineToTop(editor, line) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(targetLine)) {
    return false;
  }

  try {
    const docLine = cm.state.doc.line(targetLine + 1);
    if (!docLine || !Number.isFinite(docLine.from)) {
      return false;
    }

    cm.dispatch({
      effects: EditorView.scrollIntoView(docLine.from, { y: "start" }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Vim `zz`-style centered scroll: dispatch a CM6 scrollIntoView centered on the
// target line/column. Mirrors scrollEditorLineToTop's feature detection and
// never throws, returning false on unsupported editor shapes so callers can
// fall back to Obsidian's editor-level scroll.
function scrollEditorLineToCenter(editor, line, ch = 0) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(targetLine)) {
    return false;
  }

  const targetCh = Math.floor(numericOrDefault(ch, 0));

  try {
    const docLine = cm.state.doc.line(targetLine + 1);
    if (!docLine || !Number.isFinite(docLine.from)) {
      return false;
    }

    const lineLength = Number.isFinite(docLine.to)
      ? Math.max(0, docLine.to - docLine.from)
      : 0;
    const clampedCh = Math.min(
      Math.max(Number.isFinite(targetCh) ? targetCh : 0, 0),
      lineLength,
    );

    cm.dispatch({
      effects: EditorView.scrollIntoView(docLine.from + clampedCh, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Defer a Vim `zz`-style center for a successful open-task jump by one frame so
// it runs after the current keydown/editor command turn (Vim normal mode can
// otherwise issue a trailing cursor-visibility scroll that overrides a
// synchronous center). Tracks a single pending center on the plugin so rapid
// repeated presses never leave a stale frame queued. Centering is best-effort:
// a failure must not turn a successful jump into a command failure.
function scheduleOpenTaskJumpCenter(plugin, editor, line, ch = 0) {
  if (!plugin) {
    return false;
  }

  cancelDeferred(plugin.pendingOpenTaskJumpCenterDeferred);
  plugin.pendingOpenTaskJumpCenterDeferred = deferToNextFrame(() => {
    plugin.pendingOpenTaskJumpCenterDeferred = null;

    if (scrollEditorLineToCenter(editor, line, ch)) {
      return;
    }

    // CM6 centering is unavailable (older Obsidian or an unexpected editor
    // shape); fall back to Obsidian's editor-level centered scroll.
    if (!editor || typeof editor.scrollIntoView !== "function") {
      return;
    }

    const position = { line, ch };
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
    } catch (error) {
      try {
        editor.scrollIntoView(position);
      } catch (ignoredError) {
        // Best-effort centering only; ignore unsupported scroll shapes.
      }
    }
  });

  return true;
}

function getEditorCursor(cm) {
  if (!cm || typeof cm.getCursor !== "function") {
    return null;
  }

  return normalizePosition(cm.getCursor());
}

function getEditorLine(cm, line) {
  if (!cm || typeof cm.getLine !== "function") {
    return null;
  }

  const lineText = cm.getLine(line);
  return lineText === null || lineText === undefined ? "" : String(lineText);
}

function replaceEditorLine(cm, line, oldLineText, newLineText) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  cm.replaceRange(
    newLineText,
    { line, ch: 0 },
    { line, ch: oldLineText.length },
  );
  return true;
}

// Insert a full new line at the `line` boundary, pushing the existing line at
// that index (and everything below) down by one. When `line` is past the final
// line, the new line is appended after the last line instead. Kept separate from
// replaceEditorLine so a single-line replace is never overloaded with a
// multi-line insert.
function insertEditorLine(cm, line, lineText) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  const text = String(lineText === null || lineText === undefined ? "" : lineText);
  const lastLine = getEditorLastLine(cm);

  if (lastLine !== null && line > lastLine) {
    const lastLineText = getEditorLineText(cm, lastLine);
    const lastLineLength = lastLineText === null ? 0 : lastLineText.length;
    cm.replaceRange(`\n${text}`, { line: lastLine, ch: lastLineLength });
    return true;
  }

  cm.replaceRange(`${text}\n`, { line, ch: 0 });
  return true;
}

function deleteEditorLine(cm, line) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  const lastLine = getEditorLastLine(cm);
  if (
    !Number.isFinite(targetLine) ||
    targetLine < 0 ||
    lastLine === null ||
    targetLine > lastLine
  ) {
    return false;
  }

  const lineText = getEditorLineText(cm, targetLine);
  const lineLength = lineText === null ? 0 : lineText.length;
  if (targetLine < lastLine) {
    cm.replaceRange(
      "",
      { line: targetLine, ch: 0 },
      { line: targetLine + 1, ch: 0 },
    );
    return true;
  }

  if (targetLine > 0) {
    const previousLineText = getEditorLineText(cm, targetLine - 1);
    const previousLineLength =
      previousLineText === null ? 0 : previousLineText.length;
    cm.replaceRange(
      "",
      { line: targetLine - 1, ch: previousLineLength },
      { line: targetLine, ch: lineLength },
    );
    return true;
  }

  cm.replaceRange(
    "",
    { line: targetLine, ch: 0 },
    { line: targetLine, ch: lineLength },
  );
  return true;
}

function setEditorCursorSafely(cm, line, ch) {
  if (!cm || typeof cm.setCursor !== "function") {
    return false;
  }

  try {
    cm.setCursor(line, ch);
  } catch (error) {
    cm.setCursor({ line, ch });
  }

  return true;
}

function deferToNextFrame(callback) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return { type: "raf", handle: window.requestAnimationFrame(callback) };
  }

  return { type: "timeout", handle: setTimeout(callback, 0) };
}

function cancelDeferred(deferred) {
  if (!deferred) {
    return;
  }

  if (
    deferred.type === "raf" &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(deferred.handle);
    return;
  }

  if (deferred.type === "timeout") {
    clearTimeout(deferred.handle);
  }
}

function scheduleDashTasksScrollAssert(plugin, targetLine, options = {}) {
  if (!plugin || typeof plugin.getActiveMarkdownView !== "function") {
    return false;
  }

  const line = Math.floor(numericOrDefault(targetLine, Number.NaN));
  if (!Number.isFinite(line) || line < 0) {
    return false;
  }

  cancelDeferred(plugin.pendingDashTasksScrollDeferred);
  plugin.pendingDashTasksScrollDeferred = null;

  const frames = Math.max(
    1,
    Math.floor(
      numericOrDefault(options.frames, DASH_TASKS_SCROLL_ASSERT_FRAMES),
    ),
  );

  const runFrame = (frame) => {
    plugin.pendingDashTasksScrollDeferred = null;

    const view = plugin.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      return;
    }

    const cursor = getEditorCursor(view.editor);
    if (!cursor || cursor.line !== line) {
      setEditorCursor(view.editor, { line, ch: 0 });
    }

    scrollEditorLineToTop(view.editor, line);

    if (frame + 1 >= frames) {
      return;
    }

    plugin.pendingDashTasksScrollDeferred = deferToNextFrame(() =>
      runFrame(frame + 1),
    );
  };

  plugin.pendingDashTasksScrollDeferred = deferToNextFrame(() => runFrame(0));
  return true;
}

function findTransclusionToggleTargets(line) {
  const text = String(line || "");
  const targets = [];
  let index = 0;

  while (index < text.length) {
    const target = parseTransclusionToggleTargetAt(text, index);
    if (target) {
      targets.push(target);
      index = target.endIndex;
      continue;
    }

    const bracketEndIndex = findNonWikiBracketGroupEnd(text, index);
    if (bracketEndIndex !== -1) {
      index = bracketEndIndex + 1;
      continue;
    }

    index += 1;
  }

  return targets;
}

function parseTransclusionToggleTargetAt(line, index) {
  if (line.startsWith("![[", index)) {
    const wikiLink = parseTransclusionWikiLinkAt(line, index + 1);
    return wikiLink
      ? {
          kind: "wiki",
          transcluded: true,
          markerIndex: index,
          startIndex: index + 1,
          endIndex: wikiLink.endIndex,
        }
      : null;
  }

  if (line.startsWith("[[", index) && line[index - 1] !== "!") {
    const wikiLink = parseTransclusionWikiLinkAt(line, index);
    return wikiLink
      ? {
          kind: "wiki",
          transcluded: false,
          markerIndex: index,
          startIndex: index,
          endIndex: wikiLink.endIndex,
        }
      : null;
  }

  if (
    line.startsWith("![", index) &&
    line[index + 2] !== "[" &&
    line[index - 1] !== "["
  ) {
    const markdownLink = parseTransclusionMarkdownLinkAt(line, index + 1);
    return markdownLink
      ? {
          kind: "markdown",
          transcluded: true,
          markerIndex: index,
          startIndex: index + 1,
          endIndex: markdownLink.endIndex,
        }
      : null;
  }

  if (
    line[index] === "[" &&
    line[index + 1] !== "[" &&
    line[index - 1] !== "!" &&
    line[index - 1] !== "["
  ) {
    const markdownLink = parseTransclusionMarkdownLinkAt(line, index);
    return markdownLink
      ? {
          kind: "markdown",
          transcluded: false,
          markerIndex: index,
          startIndex: index,
          endIndex: markdownLink.endIndex,
        }
      : null;
  }

  return null;
}

function parseTransclusionWikiLinkAt(line, startIndex) {
  if (!line.startsWith("[[", startIndex)) {
    return null;
  }

  const endIndex = line.indexOf("]]", startIndex + 2);
  if (endIndex === -1) {
    return null;
  }

  const content = line.slice(startIndex + 2, endIndex);
  const aliasIndex = content.indexOf("|");
  const target =
    aliasIndex === -1 ? content.trim() : content.slice(0, aliasIndex).trim();

  return target ? { endIndex: endIndex + 2 } : null;
}

function parseTransclusionMarkdownLinkAt(line, startIndex) {
  if (line[startIndex] !== "[" || line[startIndex + 1] === "[") {
    return null;
  }

  const textEndIndex = findClosingMarkdownLabelBracket(line, startIndex);
  if (textEndIndex === -1 || line[textEndIndex + 1] !== "(") {
    return null;
  }

  const destinationStartIndex = textEndIndex + 2;
  const destinationEndIndex = findClosingMarkdownDestinationParen(
    line,
    destinationStartIndex,
  );
  if (destinationEndIndex === -1) {
    return null;
  }

  const destination = line.slice(destinationStartIndex, destinationEndIndex);
  if (!hasMarkdownDestination(destination)) {
    return null;
  }

  return { endIndex: destinationEndIndex + 1 };
}

function findNonWikiBracketGroupEnd(line, index) {
  if (
    line[index] !== "[" ||
    line[index + 1] === "[" ||
    line[index - 1] === "!" ||
    line[index - 1] === "["
  ) {
    return -1;
  }

  return findClosingMarkdownLabelBracket(line, index);
}

function findClosingMarkdownLabelBracket(line, startIndex) {
  let depth = 1;

  for (let index = startIndex + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }

    if (line[index] === "[") {
      depth += 1;
      continue;
    }

    if (line[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findClosingMarkdownDestinationParen(line, startIndex) {
  let depth = 1;
  let inAngleDestination = false;

  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }

    if (inAngleDestination) {
      if (line[index] === ">") {
        inAngleDestination = false;
      }
      continue;
    }

    if (line[index] === "<") {
      inAngleDestination = true;
      continue;
    }

    if (line[index] === "(") {
      depth += 1;
      continue;
    }

    if (line[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function hasMarkdownDestination(destination) {
  const text = String(destination || "").trim();
  if (!text) {
    return false;
  }

  if (text.startsWith("<")) {
    const endIndex = text.indexOf(">");
    return endIndex > 1;
  }

  return true;
}

function toggleLineTransclusions(line) {
  const text = String(line || "");
  const targets = findTransclusionToggleTargets(text);
  if (targets.length === 0) {
    return {
      line: text,
      targets,
      changes: [],
      found: false,
      changed: false,
    };
  }

  const removeMarkers = targets.every((target) => target.transcluded);
  const changes = targets
    .filter((target) => removeMarkers || !target.transcluded)
    .map((target) => ({
      index: target.markerIndex,
      deleteCount: removeMarkers ? 1 : 0,
      insertText: removeMarkers ? "" : "!",
      delta: removeMarkers ? -1 : 1,
    }));

  return {
    line: applyTransclusionChanges(text, changes),
    targets,
    changes,
    found: true,
    changed: changes.length > 0,
  };
}

function getTransclusionToggleChanges(targets, removeMarkers) {
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => removeMarkers || !target.transcluded)
    .map((target) => ({
      index: target.markerIndex,
      deleteCount: removeMarkers ? 1 : 0,
      insertText: removeMarkers ? "" : "!",
      delta: removeMarkers ? -1 : 1,
    }));
}

function toggleLineRangeTransclusions(lines, startLine, endLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const firstLine = Math.max(
    0,
    Math.floor(numericOrDefault(startLine, 0)),
  );
  const lastLine = Math.min(
    Math.max(firstLine, Math.floor(numericOrDefault(endLine, firstLine))),
    Math.max(sourceLines.length - 1, 0),
  );
  const lineTargets = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    const lineText = String(sourceLines[line] || "");
    const targets = findTransclusionToggleTargets(lineText);
    if (targets.length > 0) {
      lineTargets.push({ line, lineText, targets });
    }
  }

  if (lineTargets.length === 0) {
    return {
      found: false,
      changed: false,
      removeMarkers: false,
      lineTargets,
      changesByLine: [],
    };
  }

  const removeMarkers = lineTargets.every((entry) =>
    entry.targets.every((target) => target.transcluded),
  );
  const changesByLine = lineTargets
    .map((entry) => {
      const changes = getTransclusionToggleChanges(entry.targets, removeMarkers);
      return {
        ...entry,
        changes,
        nextLineText:
          changes.length > 0
            ? applyTransclusionChanges(entry.lineText, changes)
            : entry.lineText,
      };
    })
    .filter((entry) => entry.changes.length > 0);

  return {
    found: true,
    changed: changesByLine.length > 0,
    removeMarkers,
    lineTargets,
    changesByLine,
  };
}

function applyTransclusionChanges(line, changes) {
  return changes
    .slice()
    .sort((first, second) => second.index - first.index)
    .reduce(
      (nextLine, change) =>
        nextLine.slice(0, change.index) +
        change.insertText +
        nextLine.slice(change.index + change.deleteCount),
      line,
    );
}

function adjustCursorChForTransclusionChanges(cursorCh, changes, newLineLength) {
  const originalCh = Math.max(
    Math.floor(numericOrDefault(cursorCh, 0)),
    0,
  );
  const adjustedCh = changes.reduce((ch, change) => {
    if (change.delta > 0 && change.index <= originalCh) {
      return ch + change.delta;
    }

    if (change.delta < 0 && change.index < originalCh) {
      return ch + change.delta;
    }

    return ch;
  }, originalCh);

  return Math.min(Math.max(adjustedCh, 0), Math.max(newLineLength, 0));
}

// Footer keyboard hints. Each entry pairs styled keycaps with a short label.
const KEYBOARD_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Open" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_STAGE_ONE_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Choose" },
  { keys: ["^D"], label: "Delete" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_STAGE_TWO_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Set" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_LOCAL_TASK_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["⇥"], label: "Mark" },
  { keys: ["↵"], label: "Link" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_WEEKDAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

function getBulletPropertyLocalTaskHints(hasMarks) {
  return BULLET_PROPERTY_LOCAL_TASK_HINTS.map((hint) => {
    if (!hint.keys.includes("↵")) {
      return hint;
    }

    return { ...hint, label: hasMarks ? "Apply" : "Link" };
  });
}

// Footer hints for the block-ID prompt. In batch mode the Enter action advances
// to the next pending prompt ("Next") until the final one, which applies the
// whole batch ("Apply all"). The single-task prompt keeps "Create & link".
function getBulletPropertyBlockIdHints(options = {}) {
  let label = "Create & link";
  if (options.batch) {
    label = options.last ? "Apply all" : "Next";
  }

  return [
    { keys: ["↵"], label },
    { keys: ["esc"], label: "Cancel" },
  ];
}

// Render a Lucide icon into `el` via Obsidian's setIcon, guarding against
// environments (e.g. the test harness) where setIcon is unavailable so the UI
// degrades to text-only instead of throwing.
function applyIcon(el, iconName) {
  if (!el) {
    return;
  }

  const setIcon = obsidian && obsidian.setIcon;
  if (typeof setIcon !== "function") {
    return;
  }

  try {
    setIcon(el, iconName);
  } catch (error) {
    // A missing/failed icon must never break rendering.
  }
}

// Append `text` to `el`, wrapping each case-insensitive occurrence of `query`
// in a `bob-cnp-hl` span. Uses text nodes / element helpers only (never
// innerHTML) so arbitrary note titles and paths cannot inject markup.
function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!query) {
    el.appendText(source);
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let matchIndex = lowerSource.indexOf(lowerQuery);

  if (matchIndex === -1) {
    el.appendText(source);
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > index) {
      el.appendText(source.slice(index, matchIndex));
    }
    el.createSpan({
      cls: "bob-cnp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function isProjectType(value) {
  if (typeof value === "string") {
    return value.trim() === PROJECT_TYPE_WIKILINK;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isProjectType(item));
  }

  return false;
}

function isAreaType(value) {
  if (typeof value === "string") {
    return value.trim() === AREA_TYPE_WIKILINK;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isAreaType(item));
  }

  return false;
}

function stripSurroundingQuotes(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (text.length < 2) {
    return text;
  }

  const first = text.charAt(0);
  const last = text.charAt(text.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function stripSurroundingWikiLink(value) {
  const text = stripSurroundingQuotes(value);
  const match = /^\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]$/.exec(text);
  return match ? match[1].trim() : text;
}

function normalizeStatus(value) {
  const scalar = Array.isArray(value) ? value[0] : value;
  const text = stripSurroundingWikiLink(scalar);
  return text.trim().toLowerCase();
}

function formatProjectStatusLabel(statusKey) {
  const label = String(statusKey || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) {
    return "No status";
  }

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getProjectNoteInfo(frontmatter) {
  const isProject = Boolean(frontmatter) && isProjectType(frontmatter.type);
  if (!isProject) {
    return {
      isProject: false,
      statusKey: "",
      label: "",
      emoji: "",
      icon: "file-text",
      variant: "",
    };
  }

  const normalizedStatus = normalizeStatus(frontmatter.status);
  const statusKey = PROJECT_STATUS_CANCELED_ALIASES.has(normalizedStatus)
    ? "canceled"
    : normalizedStatus;
  const presentation = PROJECT_STATUS_PRESENTATIONS[statusKey];
  if (presentation) {
    return {
      isProject: true,
      statusKey,
      label: presentation.label,
      emoji: presentation.emoji,
      icon: presentation.icon,
      variant: presentation.variant,
    };
  }

  return {
    isProject: true,
    statusKey,
    label: formatProjectStatusLabel(statusKey),
    emoji: PROJECT_STATUS_FALLBACK.emoji,
    icon: PROJECT_STATUS_FALLBACK.icon,
    variant: PROJECT_STATUS_FALLBACK.variant,
  };
}

function getChildNoteInfo(frontmatter) {
  const projectInfo = getProjectNoteInfo(frontmatter);
  if (projectInfo.isProject) {
    return {
      kind: "project",
      decorated: true,
      statusKey: projectInfo.statusKey,
      label: projectInfo.label,
      emoji: projectInfo.emoji,
      icon: projectInfo.icon,
      variant: projectInfo.variant,
    };
  }

  if (Boolean(frontmatter) && isAreaType(frontmatter.type)) {
    return {
      kind: "area",
      decorated: true,
      statusKey: "",
      label: AREA_PRESENTATION.label,
      emoji: AREA_PRESENTATION.emoji,
      icon: AREA_PRESENTATION.icon,
      variant: AREA_PRESENTATION.variant,
    };
  }

  return {
    kind: "plain",
    decorated: false,
    statusKey: "",
    label: "",
    emoji: "",
    icon: "file-text",
    variant: "",
  };
}

function getFileChildNoteInfo(app, file) {
  const frontmatter =
    app &&
    app.metadataCache &&
    typeof app.metadataCache.getFileCache === "function"
      ? app.metadataCache.getFileCache(file)?.frontmatter
      : null;
  return getChildNoteInfo(frontmatter);
}

function getChildNoteSummary(childFiles, noteInfoByPath) {
  let projectCount = 0;
  let areaCount = 0;
  const statusCounts = new Map();

  childFiles.forEach((file) => {
    const info = noteInfoByPath.get(file.path);
    if (!info) {
      return;
    }

    if (info.kind === "area") {
      areaCount += 1;
      return;
    }

    if (info.kind !== "project") {
      return;
    }

    projectCount += 1;
    const label = info.statusKey
      ? info.statusKey === "wip" ||
        info.statusKey === "done" ||
        info.statusKey === "canceled"
        ? info.statusKey
        : info.label.toLowerCase()
      : "no status";
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  });

  const parts = [];
  if (projectCount > 0) {
    parts.push(`${projectCount} project${projectCount === 1 ? "" : "s"}`);

    const orderedLabels = ["wip", "done", "canceled", "no status"];
    orderedLabels.forEach((label) => {
      const count = statusCounts.get(label);
      if (count) {
        parts.push(`${count} ${label}`);
        statusCounts.delete(label);
      }
    });

    Array.from(statusCounts.keys())
      .sort()
      .forEach((label) => {
        parts.push(`${statusCounts.get(label)} ${label}`);
      });
  }

  if (areaCount > 0) {
    parts.push(`${areaCount} area${areaCount === 1 ? "" : "s"}`);
  }

  return parts;
}

function getChildNoteSearchText(file, noteInfo) {
  const parts = [file.path, file.basename];
  if (noteInfo && noteInfo.kind === "project") {
    parts.push("project", noteInfo.statusKey, noteInfo.label);
    if (noteInfo.statusKey === "canceled") {
      parts.push("cancelled");
    }
  } else if (noteInfo && noteInfo.kind === "area") {
    parts.push("area", noteInfo.label);
  }

  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

function childNoteMatchesQuery(file, noteInfo, query) {
  return getChildNoteSearchText(file, noteInfo).includes(query);
}

class FilteredPickerModal extends Modal {
  constructor(app, options) {
    super(app);
    this.selectedIndex = 0;
    this.opening = false;
    this.footerHints = KEYBOARD_HINTS;
    this.items = [];
    this.visibleItems = [];
    this.applyOptions(options);
  }

  applyOptions(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "items")) {
      this.items = options.items || [];
      this.visibleItems = this.items;
    }
    if (Object.prototype.hasOwnProperty.call(options, "title")) {
      this.title = options.title;
    }
    if (Object.prototype.hasOwnProperty.call(options, "headerIcon")) {
      this.headerIcon = options.headerIcon;
    }
    if (Object.prototype.hasOwnProperty.call(options, "inputLabel")) {
      this.inputLabel = options.inputLabel;
    }
    if (Object.prototype.hasOwnProperty.call(options, "placeholder")) {
      this.placeholder = options.placeholder;
    }
    if (Object.prototype.hasOwnProperty.call(options, "resultsLabel")) {
      this.resultsLabel = options.resultsLabel;
    }
    if (Object.prototype.hasOwnProperty.call(options, "emptyText")) {
      this.emptyText = options.emptyText;
    }
    if (Object.prototype.hasOwnProperty.call(options, "getSubtitle")) {
      this.getSubtitle = options.getSubtitle;
    }
    if (Object.prototype.hasOwnProperty.call(options, "filterItem")) {
      this.filterItem = options.filterItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "renderItem")) {
      this.renderItem = options.renderItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "openItem")) {
      this.openItem = options.openItem;
    }
    if (Object.prototype.hasOwnProperty.call(options, "footerHints")) {
      this.footerHints = options.footerHints || [];
    }

    return this;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-cnp-modal");
    contentEl.addClass("bob-cnp");

    const header = contentEl.createDiv({ cls: "bob-cnp-header" });
    this.headerIconEl = header.createDiv({ cls: "bob-cnp-header-icon" });
    const headerText = header.createDiv({ cls: "bob-cnp-header-text" });
    this.titleEl = headerText.createDiv({ cls: "bob-cnp-title" });
    this.subtitleEl = headerText.createDiv({ cls: "bob-cnp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bob-cnp-search" });
    const searchIcon = searchEl.createDiv({ cls: "bob-cnp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bob-cnp-input",
      attr: {
        "aria-label": this.inputLabel,
        placeholder: this.placeholder,
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    this.inputEl.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );

    this.resultsEl = contentEl.createDiv({ cls: "bob-cnp-results" });
    this.footerEl = contentEl.createDiv({ cls: "bob-cnp-footer" });

    this.renderAll();

    window.setTimeout(() => this.inputEl.focus(), 0);
  }

  renderAll(options = {}) {
    if (this.headerIconEl) {
      this.headerIconEl.empty();
      applyIcon(this.headerIconEl, this.headerIcon);
    }

    if (this.titleEl) {
      this.titleEl.textContent = this.title || "";
    }

    if (this.inputEl) {
      this.inputEl.setAttribute("aria-label", this.inputLabel || "");
      this.inputEl.setAttribute("placeholder", this.placeholder || "");
      if (options.clearQuery) {
        this.inputEl.value = "";
      }
    }

    if (this.resultsEl) {
      this.resultsEl.setAttribute("role", "listbox");
      this.resultsEl.setAttribute("aria-label", this.resultsLabel || "");
    }

    this.renderFooter();
    this.renderResults();
  }

  renderFooter() {
    if (!this.footerEl) {
      return;
    }

    this.footerEl.empty();
    (this.footerHints || KEYBOARD_HINTS).forEach((hint) => {
      const group = this.footerEl.createDiv({ cls: "bob-cnp-hint" });
      hint.keys.forEach((key) =>
        group.createEl("kbd", { cls: "bob-cnp-kbd", text: key }),
      );
      group.createEl("span", { cls: "bob-cnp-hint-label", text: hint.label });
    });
  }

  onClose() {
    this.modalEl.removeClass("bob-cnp-modal");
    this.contentEl.empty();
  }

  handleKeydown(event) {
    if (event.key === "ArrowDown" || isCtrlKey(event, "n")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || isCtrlKey(event, "p")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.openSelectedItem();
    }
  }

  moveSelection(delta) {
    if (this.visibleItems.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.visibleItems.length) %
      this.visibleItems.length;
    this.renderResults();
  }

  getQuery() {
    return this.inputEl ? this.inputEl.value.trim().toLowerCase() : "";
  }

  getRawQuery() {
    return this.inputEl ? this.inputEl.value.trim() : "";
  }

  getFilteredItems() {
    const query = this.getQuery();
    if (!query) {
      return this.items;
    }

    return this.items.filter((item) => this.filterItem(item, query));
  }

  updateSubtitle() {
    if (!this.subtitleEl || typeof this.getSubtitle !== "function") {
      return;
    }

    this.subtitleEl.textContent = this.getSubtitle(
      this.visibleItems,
      this.items,
    );
  }

  renderResults() {
    this.visibleItems = this.getFilteredItems();
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleItems.length,
    );

    this.updateSubtitle();
    this.resultsEl.empty();

    if (this.visibleItems.length === 0) {
      const emptyEl = this.resultsEl.createDiv({ cls: "bob-cnp-empty" });
      const emptyIcon = emptyEl.createDiv({ cls: "bob-cnp-empty-icon" });
      applyIcon(emptyIcon, "file-question");
      emptyEl.createDiv({
        cls: "bob-cnp-empty-text",
        text: this.emptyText,
      });
      return;
    }

    const query = this.getQuery();

    this.visibleItems.forEach((item, index) => {
      const isSelected = index === this.selectedIndex;
      const classes = ["bob-cnp-row"];
      if (isSelected) {
        classes.push("is-selected");
      }

      const rowEl = this.resultsEl.createDiv({
        cls: classes.join(" "),
        attr: {
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      this.renderItem(item, rowEl, query);

      const enterEl = rowEl.createDiv({ cls: "bob-cnp-row-enter" });
      applyIcon(enterEl, "corner-down-left");

      rowEl.addEventListener("mousedown", (event) => event.preventDefault());
      rowEl.addEventListener("click", () => this.openItemAtIndex(index));

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
    });
  }

  scrollRowIntoView(rowEl) {
    if (!rowEl || typeof rowEl.scrollIntoView !== "function") {
      return;
    }

    try {
      rowEl.scrollIntoView({ block: "nearest" });
    } catch (error) {
      try {
        rowEl.scrollIntoView(false);
      } catch (ignoredError) {
        // Scrolling is a nicety; never let it break rendering.
      }
    }
  }

  clampSelectedIndex(index, length) {
    if (length === 0) {
      return 0;
    }

    return Math.min(Math.max(index, 0), length - 1);
  }

  openSelectedItem() {
    this.openItemAtIndex(this.selectedIndex);
  }

  async openItemAtIndex(index) {
    if (this.opening) {
      return;
    }

    const item = this.visibleItems[index];
    if (!item) {
      return;
    }

    this.opening = true;
    try {
      if (await this.openItem(item)) {
        this.close();
      }
    } finally {
      this.opening = false;
    }
  }
}

class ChildNotePickerModal extends FilteredPickerModal {
  constructor(app, plugin, childFiles, parentFile) {
    const noteInfoByPath = new Map(
      childFiles.map((file) => [file.path, getFileChildNoteInfo(app, file)]),
    );
    const summaryParts = getChildNoteSummary(childFiles, noteInfoByPath);

    super(app, {
      items: childFiles,
      title: "Open child note",
      headerIcon: "folder-tree",
      inputLabel: "Filter child notes",
      placeholder: "Filter child notes",
      resultsLabel: "Child notes",
      emptyText: "No matching child notes",
      getSubtitle: (visibleFiles, allFiles) => {
        const total = allFiles.length;
        const shown = visibleFiles.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        let text = `${total} note${total === 1 ? "" : "s"}`;
        const parentName = parentFile && parentFile.basename;
        if (parentName) {
          text += ` under ${parentName}`;
        }
        if (summaryParts.length > 0) {
          text += ` · ${summaryParts.join(" · ")}`;
        }
        return text;
      },
      filterItem: (file, query) =>
        childNoteMatchesQuery(file, noteInfoByPath.get(file.path), query),
      renderItem: (file, rowEl, query) => {
        const noteInfo = noteInfoByPath.get(file.path);
        const rowIcon = rowEl.createDiv({
          cls:
            noteInfo && noteInfo.decorated
              ? `bob-cnp-row-icon is-status-${noteInfo.variant}`
              : "bob-cnp-row-icon",
        });
        applyIcon(rowIcon, noteInfo ? noteInfo.icon : "file-text");

        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, file.basename, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        appendHighlighted(pathEl, file.path, query);

        if (noteInfo && noteInfo.decorated) {
          const statusText = [noteInfo.emoji, noteInfo.label]
            .filter(Boolean)
            .join(" ");
          const ariaLabel =
            noteInfo.kind === "area"
              ? "Area note"
              : `Project status: ${noteInfo.label}`;
          const statusEl = rowEl.createDiv({
            cls: `bob-cnp-row-status is-status-${noteInfo.variant}`,
            attr: {
              "aria-label": ariaLabel,
              title: ariaLabel,
            },
          });
          appendHighlighted(statusEl, statusText, query);
        }
      },
      openItem: (file) => plugin.openChildNote(file),
    });
  }
}

class LinkCandidatePickerModal extends FilteredPickerModal {
  constructor(app, plugin, candidates, targetLine) {
    super(app, {
      items: candidates,
      title: "Open link target",
      headerIcon: "link",
      inputLabel: "Filter link targets",
      placeholder: "Filter link targets",
      resultsLabel: "Link targets",
      emptyText: "No matching links",
      getSubtitle: (visibleCandidates, allCandidates) => {
        const total = allCandidates.length;
        const shown = visibleCandidates.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        const lineText =
          Number.isFinite(targetLine) ? ` on line ${targetLine + 1}` : "";
        return `${total} link target${total === 1 ? "" : "s"}${lineText}`;
      },
      filterItem: (candidate, query) =>
        candidate.label.toLowerCase().includes(query) ||
        candidate.path.toLowerCase().includes(query) ||
        (!!candidate.subpath &&
          candidate.subpath.toLowerCase().includes(query)) ||
        candidate.actionLabel.toLowerCase().includes(query),
      renderItem: (candidate, rowEl, query) => {
        const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(
          rowIcon,
          candidate.actionKind === "create" ? "file-plus" : "file-text",
        );

        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, candidate.label, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        appendHighlighted(pathEl, candidate.path, query);
        if (candidate.subpath) {
          appendHighlighted(pathEl, candidate.subpath, query);
        }

        const statusEl = rowEl.createDiv({
          cls: `bob-cnp-row-status is-${candidate.actionKind}`,
        });
        appendHighlighted(statusEl, candidate.actionLabel, query);
      },
      openItem: (candidate) => plugin.openOrCreateLinkCandidate(candidate),
    });
  }
}

class YankPathPickerModal extends FilteredPickerModal {
  constructor(app, plugin, file) {
    super(app, {
      items: YANK_PATH_COMMANDS.map((command) =>
        createYankPathPickerItem(plugin, command, file),
      ),
      title: "Copy active file path",
      headerIcon: "copy",
      inputLabel: "Filter path formats",
      placeholder: "Filter path formats",
      resultsLabel: "Path formats",
      emptyText: "No matching path formats",
      getSubtitle: (visibleItems, allItems) => {
        const total = allItems.length;
        const shown = visibleItems.length;
        if (shown !== total) {
          return `Showing ${shown} of ${total}`;
        }

        const filePath = getVaultRelativeFilePath(file);
        return filePath
          ? `${total} path format${total === 1 ? "" : "s"} for ${filePath}`
          : `${total} path format${total === 1 ? "" : "s"}`;
      },
      filterItem: (item, query) =>
        item.title.toLowerCase().includes(query) ||
        item.kind.toLowerCase().includes(query) ||
        item.preview.toLowerCase().includes(query),
      renderItem: (item, rowEl, query) => {
        const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
        applyIcon(rowIcon, item.available ? "copy" : "circle-alert");

        const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
        const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
        appendHighlighted(titleEl, item.title, query);
        const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
        pathEl.setAttribute("title", item.preview);
        appendHighlighted(pathEl, item.preview, query);

        const statusEl = rowEl.createDiv({
          cls: `bob-cnp-row-status ${
            item.available ? "is-open" : "is-unavailable"
          }`,
        });
        appendHighlighted(statusEl, item.actionLabel, query);
      },
      openItem: (item) => plugin.yankActiveFilePath(item.kind),
    });
  }
}

class RenameCurrentFileModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.parts = getFileRenameParts(file && file.path);
    this.submitting = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-rename-file-modal");
    contentEl.addClass("bob-rename-file");

    const header = contentEl.createDiv({ cls: "bob-rename-file-header" });
    const icon = header.createDiv({ cls: "bob-rename-file-header-icon" });
    applyIcon(icon, "file-pen-line");

    const headerText = header.createDiv({ cls: "bob-rename-file-header-text" });
    headerText.createDiv({
      cls: "bob-rename-file-title",
      text: "Rename current file",
    });
    headerText.createDiv({
      cls: "bob-rename-file-subtitle",
      text: this.parts.currentPath,
    });

    const field = contentEl.createDiv({ cls: "bob-rename-file-field" });
    field.createEl("label", {
      cls: "bob-rename-file-label",
      text: "File name",
    });
    this.inputEl = field.createEl("input", {
      cls: "bob-rename-file-input",
      attr: {
        "aria-label": "File name",
        type: "text",
      },
    });
    this.inputEl.value = this.parts.basename;
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.submit();
    });

    const actions = contentEl.createDiv({ cls: "bob-rename-file-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
    this.renameButtonEl = actions.createEl("button", {
      cls: "mod-cta",
      text: "Rename",
    });
    this.renameButtonEl.addEventListener("click", () => this.submit());

    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 0);
  }

  onClose() {
    this.modalEl.removeClass("bob-rename-file-modal");
    this.contentEl.empty();
  }

  setSubmitting(submitting) {
    this.submitting = submitting;
    if (this.renameButtonEl) {
      this.renameButtonEl.disabled = submitting;
    }
    if (this.inputEl) {
      this.inputEl.disabled = submitting;
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    this.setSubmitting(true);
    try {
      const renamed = await this.plugin.renameCurrentFileToName(
        this.inputEl ? this.inputEl.value : "",
      );
      if (renamed) {
        this.close();
      }
    } finally {
      this.setSubmitting(false);
    }
  }
}

function addElementClasses(el, ...classes) {
  if (!el || !el.classList) {
    return;
  }

  classes.filter(Boolean).forEach((className) => el.classList.add(className));
}

function fuzzyMatchesText(source, query) {
  const haystack = String(source || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if (!needle) {
    return true;
  }

  let haystackIndex = 0;
  for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
    haystackIndex = haystack.indexOf(needle[needleIndex], haystackIndex);
    if (haystackIndex === -1) {
      return false;
    }
    haystackIndex += 1;
  }

  return true;
}

function truncateBulletPropertySubtitle(line) {
  const text = String(line || "").trim();
  if (text.length <= 140) {
    return text;
  }

  return `${text.slice(0, 137)}...`;
}

function getBulletPropertyFieldMap(line) {
  const fields = new Map();
  parseBulletPropertyFields(line).forEach((field) => {
    if (!fields.has(field.key)) {
      fields.set(field.key, field);
    }
  });
  return fields;
}

function createBulletPropertyItems(config, line) {
  const fields = getBulletPropertyFieldMap(line);
  return config.properties
    .map((property, order) => {
      const field = fields.get(property.name) || null;
      return {
        kind: "property",
        property,
        order,
        defined: !!field,
        currentValue: field ? field.value : "",
      };
    })
    .sort((first, second) => {
      if (first.defined !== second.defined) {
        return first.defined ? -1 : 1;
      }

      return first.order - second.order;
    });
}

function getLocalDateStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function compareLocalDates(firstDate, secondDate) {
  const firstTime = getLocalDateStart(firstDate).getTime();
  const secondTime = getLocalDateStart(secondDate).getTime();
  if (firstTime === secondTime) {
    return 0;
  }

  return firstTime < secondTime ? -1 : 1;
}

function addLocalDateDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addLocalDateMonths(date, months) {
  const targetMonthIndex = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const targetDay = Math.min(
    date.getDate(),
    getDaysInMonth(targetYear, targetMonth),
  );

  return new Date(targetYear, normalizedMonthIndex, targetDay);
}

function getDaysUntilWeekday(date, weekday, allowToday) {
  const delta = (weekday - date.getDay() + 7) % 7;
  return delta === 0 && !allowToday ? 7 : delta;
}

function formatBulletPropertyDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBulletPropertyDateWeekday(date) {
  return BULLET_PROPERTY_WEEKDAY_NAMES[date.getDay()] || "";
}

function createBulletPropertyDateValueItem(
  label,
  date,
  currentValue,
  options = {},
) {
  const value = formatBulletPropertyDate(date);
  const weekday = getBulletPropertyDateWeekday(date);
  return {
    kind: "value",
    value,
    label,
    detail: `${value} · ${weekday}`,
    current: value === currentValue,
    dynamic: !!options.dynamic,
    searchText: `${label} ${value} ${weekday}`,
  };
}

function createBulletPropertyDateItems(baseDate, currentValue) {
  const today = getLocalDateStart(baseDate);
  const saturday = addLocalDateDays(
    today,
    getDaysUntilWeekday(today, 6, true),
  );
  const sunday = addLocalDateDays(today, getDaysUntilWeekday(today, 0, true));
  const nextMonday = addLocalDateDays(
    today,
    getDaysUntilWeekday(today, 1, false),
  );

  return [
    ["Today", today],
    ["Tomorrow", addLocalDateDays(today, 1)],
    ["In 2 days", addLocalDateDays(today, 2)],
    ["In 3 days", addLocalDateDays(today, 3)],
    ["This Saturday", saturday],
    ["This Sunday", sunday],
    ["Next Monday", nextMonday],
    ["In 1 week", addLocalDateDays(today, 7)],
    ["In 2 weeks", addLocalDateDays(today, 14)],
    ["In 1 month", addLocalDateMonths(today, 1)],
  ].map(([label, date]) =>
    createBulletPropertyDateValueItem(label, date, currentValue),
  );
}

function parseBulletPropertyTypedDate(query, baseDate) {
  const text = String(query || "").trim();
  if (!text) {
    return null;
  }

  const ymdMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (
    ymdMatch &&
    isValidDateParts(ymdMatch[1], ymdMatch[2], ymdMatch[3])
  ) {
    return new Date(
      parseIntegerText(ymdMatch[1]),
      parseIntegerText(ymdMatch[2]) - 1,
      parseIntegerText(ymdMatch[3]),
    );
  }

  const monthDayMatch = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (monthDayMatch) {
    const monthText = monthDayMatch[1];
    const dayText = monthDayMatch[2];
    let year = baseDate.getFullYear();
    if (!isValidDateParts(String(year), monthText, dayText)) {
      return null;
    }

    let date = new Date(
      year,
      parseIntegerText(monthText) - 1,
      parseIntegerText(dayText),
    );
    if (compareLocalDates(date, baseDate) <= 0) {
      year += 1;
      if (!isValidDateParts(String(year), monthText, dayText)) {
        return null;
      }
      date = new Date(
        year,
        parseIntegerText(monthText) - 1,
        parseIntegerText(dayText),
      );
    }
    return date;
  }

  const offsetMatch = text.match(/^\+(\d+)([dwm])$/i);
  if (offsetMatch) {
    const count = parseIntegerText(offsetMatch[1]);
    const unit = offsetMatch[2].toLowerCase();
    if (!Number.isInteger(count) || count < 0) {
      return null;
    }

    if (unit === "d") {
      return addLocalDateDays(baseDate, count);
    }
    if (unit === "w") {
      return addLocalDateDays(baseDate, count * 7);
    }
    return addLocalDateMonths(baseDate, count);
  }

  return null;
}

function createBulletPropertyTypedDateItem(query, baseDate, currentValue) {
  const date = parseBulletPropertyTypedDate(query, baseDate);
  if (!date) {
    return null;
  }

  const value = formatBulletPropertyDate(date);
  return createBulletPropertyDateValueItem(`Use ${value}`, date, currentValue, {
    dynamic: true,
  });
}

function getLocalTaskDependencyIdentifier(task) {
  if (!task) {
    return "";
  }

  return task.existingIdField || task.existingBlockId || "";
}

function createBulletPropertyLocalTaskItems(content, options = {}) {
  const dependencyValues =
    options.dependencyValues instanceof Set
      ? options.dependencyValues
      : new Set(options.dependencyValues || []);

  return getOpenLocalTasks(content, { excludeLine: options.excludeLine }).map(
    (task) => {
      // The dependency value stored in `[dependsOn:: ...]` (prefers an existing
      // `[id::]`, then the trailing block ID). The link block ID is the trailing
      // `^block-id` the navigation bullet points at, which may be absent even
      // when a dependency value exists.
      const dependencyValue = getLocalTaskDependencyIdentifier(task);
      const linkBlockId = task.existingBlockId || "";
      const alreadyLinked = dependencyValue
        ? dependencyValues.has(dependencyValue)
        : false;
      const needsBlockIdPrompt = !linkBlockId;
      const needsDependencyValue = !dependencyValue;
      const needsPromptForAdd = !alreadyLinked && needsBlockIdPrompt;

      return Object.freeze({
        kind: "local-task",
        ...task,
        value: dependencyValue,
        dependencyValue,
        linkBlockId,
        alreadyLinked,
        needsBlockIdPrompt,
        needsDependencyValue,
        needsPromptForAdd,
        searchText: [
          task.displayText,
          `line ${task.line + 1}`,
          task.status,
          dependencyValue,
          alreadyLinked ? "depends linked" : "",
          needsPromptForAdd
            ? "needs id block create"
            : dependencyValue
              ? "block id"
              : "create id",
        ]
          .filter(Boolean)
          .join(" "),
      });
    },
  );
}

function taskStatusLabel(status) {
  return `[${status || " "}]`;
}

function taskStatusClass(status) {
  if (status === "/") {
    return "active";
  }

  if (status === "B") {
    return "blocked";
  }

  return "todo";
}

function validateBlockIdCandidate(id, content, options = {}) {
  const reservedIds =
    options.reservedIds instanceof Set
      ? options.reservedIds
      : new Set(options.reservedIds || []);
  const value = normalizeBulletPropertyValue(id);
  if (!value) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "invalid",
      message: "Enter a block ID",
    });
  }

  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "invalid",
      message: "Use only letters, numbers, and hyphens",
    });
  }

  if (blockIdExistsInContent(content, value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "duplicate",
      message: "Already exists in this file",
    });
  }

  if (reservedIds.has(value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "duplicate",
      message: "Already chosen in this batch",
    });
  }

  return Object.freeze({
    id: value,
    valid: true,
    state: "valid",
    message: "Ready to create",
  });
}

function createBulletPropertyValueItems(propertyItem, baseDate) {
  const property = propertyItem.property;
  const currentValue = propertyItem.currentValue || "";
  if (property.values === "date") {
    return createBulletPropertyDateItems(baseDate, currentValue);
  }

  if (property.values === "local_task_id") {
    return [];
  }

  return property.values.map((value) => ({
    kind: "value",
    value,
    label: value,
    detail: value === currentValue ? "Current value" : "",
    current: value === currentValue,
    dynamic: false,
    searchText: value,
  }));
}

class BulletPropertyPickerModal extends FilteredPickerModal {
  constructor(app, plugin, editor, cursor, lineText, config) {
    super(app, {
      items: [],
      title: "Set bullet property",
      headerIcon: "tags",
      inputLabel: "Filter bullet properties",
      placeholder: "Filter properties",
      resultsLabel: "Bullet properties",
      emptyText: "No matching properties",
      footerHints: BULLET_PROPERTY_STAGE_ONE_HINTS,
      getSubtitle: () => "",
      filterItem: () => true,
      renderItem: () => {},
      openItem: () => false,
    });

    this.plugin = plugin;
    this.editor = editor;
    this.cursor = cursor;
    this.lineText = lineText;
    this.config = config;
    this.bulletSubtitle = truncateBulletPropertySubtitle(lineText);
    this.stage = "properties";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    this.markedLines = new Set();
    this.taskItemsByLine = new Map();
    // Batch block-ID prompting state; populated only while the modal is
    // collecting block IDs for a pending multi-task apply (see commit flow).
    this.pendingBatch = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
    this.valueBaseDate = getLocalDateStart(new Date());
    this.showPropertyStage({ clearQuery: false });
  }

  showPropertyStage(options = {}) {
    this.stage = "properties";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    this.clearPendingBatch();
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    const items = createBulletPropertyItems(this.config, this.lineText);
    this.applyOptions({
      items,
      title: "Set bullet property",
      headerIcon: "tags",
      inputLabel: "Filter bullet properties",
      placeholder: "Filter properties",
      resultsLabel: "Bullet properties",
      emptyText: "No matching properties",
      footerHints: BULLET_PROPERTY_STAGE_ONE_HINTS,
      getSubtitle: (visibleItems, allItems) => {
        const countText =
          visibleItems.length === allItems.length
            ? ""
            : `Showing ${visibleItems.length} of ${allItems.length} · `;
        return `${countText}${this.bulletSubtitle}`;
      },
      filterItem: (item, query) =>
        fuzzyMatchesText(
          `${item.property.name} ${item.currentValue || ""}`,
          query,
        ),
      renderItem: (item, rowEl, query) =>
        this.renderPropertyItem(item, rowEl, query),
      openItem: (item) => {
        this.showValueStage(item);
        return false;
      },
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: options.clearQuery !== false });
      if (options.selectPropertyName) {
        const selectedIndex = this.visibleItems.findIndex(
          (item) => item.property.name === options.selectPropertyName,
        );
        if (selectedIndex !== -1 && selectedIndex !== this.selectedIndex) {
          this.selectedIndex = selectedIndex;
          this.renderResults();
        }
      }
    }
  }

  showValueStage(propertyItem) {
    this.stage = "value";
    this.selectedPropertyItem = propertyItem;
    this.pendingTask = null;
    this.valueBaseDate = getLocalDateStart(new Date());
    this.selectedIndex = 0;
    const property = propertyItem.property;
    if (property.values === "local_task_id") {
      this.showLocalTaskValueStage(propertyItem);
      return;
    }
    this.clearLocalTaskMarks();

    const isDateProperty = property.values === "date";
    this.applyOptions({
      items: createBulletPropertyValueItems(propertyItem, this.valueBaseDate),
      title: property.name,
      headerIcon: isDateProperty ? "calendar-days" : "list-checks",
      inputLabel: `Filter ${property.name} values`,
      placeholder: isDateProperty ? "Type date, +3d, or 6/24" : "Filter values",
      resultsLabel: `${property.name} values`,
      emptyText: "No matching values",
      footerHints: BULLET_PROPERTY_STAGE_TWO_HINTS,
      getSubtitle: () =>
        propertyItem.currentValue
          ? `Choose a value · current: ${propertyItem.currentValue}`
          : "Choose a value",
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderValueItem(item, rowEl, query),
      openItem: (item) => this.applySelectedValue(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  getEditorContent() {
    if (this.editor && typeof this.editor.getValue === "function") {
      return String(this.editor.getValue() || "");
    }

    return this.lineText || "";
  }

  getCurrentPropertyValue(name) {
    const lineText = getEditorLine(this.editor, this.cursor.line);
    const field = findBulletPropertyField(
      lineText === null ? this.lineText : lineText,
      name,
    );
    return field ? field.value : "";
  }

  clearLocalTaskMarks() {
    if (!this.markedLines) {
      this.markedLines = new Set();
    } else {
      this.markedLines.clear();
    }

    if (!this.taskItemsByLine) {
      this.taskItemsByLine = new Map();
    } else {
      this.taskItemsByLine.clear();
    }
  }

  resetLocalTaskMarks(items) {
    this.markedLines = new Set();
    this.taskItemsByLine = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item && Number.isInteger(item.line)) {
        this.taskItemsByLine.set(item.line, item);
      }
    });
  }

  clearPendingBatch() {
    this.pendingBatch = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
  }

  // Dismissing the modal mid-prompt is a clean cancel: no writes happen until
  // the final block ID is confirmed, so just drop the pending batch state.
  onClose() {
    this.clearPendingBatch();
    super.onClose();
  }

  isLocalTaskStage() {
    return (
      this.stage === "value" &&
      this.selectedPropertyItem &&
      this.selectedPropertyItem.property &&
      this.selectedPropertyItem.property.values === "local_task_id"
    );
  }

  getMarkedCount() {
    return this.markedLines ? this.markedLines.size : 0;
  }

  getMarkedTaskItems() {
    if (!this.markedLines || !this.taskItemsByLine) {
      return [];
    }

    return Array.from(this.markedLines)
      .map((line) => this.taskItemsByLine.get(line))
      .filter(Boolean);
  }

  getMarkedTaskDiff() {
    return this.getMarkedTaskItems().reduce(
      (counts, item) => {
        if (item.alreadyLinked) {
          counts.remove += 1;
        } else if (item.needsPromptForAdd) {
          counts.needId += 1;
        } else {
          counts.add += 1;
        }
        return counts;
      },
      { add: 0, needId: 0, remove: 0 },
    );
  }

  getLocalTaskFooterHints() {
    return getBulletPropertyLocalTaskHints(this.getMarkedCount() > 0);
  }

  refreshLocalTaskFooter() {
    if (!this.isLocalTaskStage()) {
      return;
    }

    this.footerHints = this.getLocalTaskFooterHints();
    this.renderFooter();
  }

  getLocalTaskSubtitle(visibleItems, allItems) {
    const countText =
      visibleItems.length === allItems.length
        ? ""
        : `Showing ${visibleItems.length} of ${allItems.length} · `;
    if (this.getMarkedCount() === 0) {
      return `${countText}Choose a task dependency · ⇥ to mark several`;
    }

    const diff = this.getMarkedTaskDiff();
    const parts = [];
    if (diff.add > 0) {
      parts.push(`${diff.add} to add`);
    }
    if (diff.needId > 0) {
      parts.push(`${diff.needId} ${diff.needId === 1 ? "needs ID" : "need IDs"}`);
    }
    if (diff.remove > 0) {
      parts.push(`${diff.remove} to remove`);
    }
    parts.push("↵ to apply");
    return `${countText}${parts.join(" · ")}`;
  }

  toggleHighlightedLocalTaskMark() {
    const item = this.visibleItems[this.selectedIndex];
    if (!item || item.kind !== "local-task") {
      return;
    }

    // Block-ID-less tasks can now be marked; their block IDs are collected via
    // sequential prompts when the batch is applied.
    if (this.markedLines.has(item.line)) {
      this.markedLines.delete(item.line);
    } else {
      this.markedLines.add(item.line);
    }

    this.refreshLocalTaskFooter();
    this.moveSelection(1);
  }

  showLocalTaskValueStage(propertyItem) {
    this.stage = "value";
    this.selectedPropertyItem = propertyItem;
    this.pendingTask = null;
    this.clearPendingBatch();
    this.selectedIndex = 0;
    const property = propertyItem.property;
    const dependencyValues = new Set(
      parseLocalTaskIdList(this.getCurrentPropertyValue(property.name)),
    );
    const items = createBulletPropertyLocalTaskItems(this.getEditorContent(), {
      excludeLine: this.cursor.line,
      dependencyValues,
    });
    this.resetLocalTaskMarks(items);

    this.applyOptions({
      items,
      title: property.name,
      headerIcon: "link",
      inputLabel: "Filter open tasks",
      placeholder: "Filter open tasks",
      resultsLabel: "Open tasks",
      emptyText: "No open tasks in this file",
      footerHints: this.getLocalTaskFooterHints(),
      getSubtitle: (visibleItems, allItems) =>
        this.getLocalTaskSubtitle(visibleItems, allItems),
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderTaskValueItem(item, rowEl, query),
      openItem: (item) => this.chooseTaskDependency(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  // Reserved block IDs chosen earlier in the current batch prompt sequence, so
  // suggestions and validation avoid colliding with them before any write.
  getBlockIdReservedIds() {
    return this.blockIdMode === "batch" && this.pendingBatch
      ? this.pendingBatch.reservedIds
      : new Set();
  }

  // Render the block-ID prompt for one task. Serves both the single-task flow
  // (mode "single") and each step of a batch (mode "batch"), which only differ
  // in the subtitle/footer wording and the reserved-ID set.
  showBlockIdStage(task, options = {}) {
    this.stage = "blockid";
    this.pendingTask = task;
    this.blockIdMode = options.mode === "batch" ? "batch" : "single";
    this.blockIdContext =
      this.blockIdMode === "batch"
        ? {
            position: Math.max(1, Math.floor(options.position || 1)),
            total: Math.max(1, Math.floor(options.total || 1)),
          }
        : null;
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    const reservedIds = this.getBlockIdReservedIds();
    // Prefill with the existing `[id::]` value when present (it stays the
    // dependency value); otherwise suggest a slug that avoids existing and
    // reserved block IDs.
    const suggestedId = task.existingIdField
      ? normalizeBulletPropertyValue(task.existingIdField)
      : suggestBlockIdFromTask(task.displayText, this.getEditorContent(), {
          reservedIds,
        });
    const isLast =
      this.blockIdMode !== "batch" ||
      this.blockIdContext.position >= this.blockIdContext.total;

    this.applyOptions({
      items: [],
      title: "New block ID",
      headerIcon: "hash",
      inputLabel: "Block ID",
      placeholder: "Block ID - letters, numbers, hyphens",
      resultsLabel: "Block ID preview",
      emptyText: "Type a block ID",
      footerHints: getBulletPropertyBlockIdHints({
        batch: this.blockIdMode === "batch",
        last: isLast,
      }),
      getSubtitle: () =>
        this.blockIdMode === "batch"
          ? `Block ID ${this.blockIdContext.position} of ${this.blockIdContext.total} · line ${task.line + 1}`
          : `Create an ID for line ${task.line + 1}`,
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderBlockIdPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmBlockId(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
      if (this.inputEl) {
        this.inputEl.value = suggestedId;
        this.inputEl.select();
      }
      this.renderResults();
    }
  }

  getFilteredItems() {
    if (this.stage === "blockid") {
      const validation = validateBlockIdCandidate(
        this.getRawQuery(),
        this.getEditorContent(),
        { reservedIds: this.getBlockIdReservedIds() },
      );
      return [
        Object.freeze({
          kind: "blockid-preview",
          ...validation,
          task: this.pendingTask,
          searchText: validation.id,
        }),
      ];
    }

    const items = super.getFilteredItems();
    if (
      this.stage !== "value" ||
      !this.selectedPropertyItem ||
      this.selectedPropertyItem.property.values !== "date"
    ) {
      return items;
    }

    const typedItem = createBulletPropertyTypedDateItem(
      this.getRawQuery(),
      this.valueBaseDate,
      this.selectedPropertyItem.currentValue || "",
    );
    if (!typedItem) {
      return items;
    }

    return [
      typedItem,
      ...items.filter((item) => item.value !== typedItem.value),
    ];
  }

  renderPropertyItem(item, rowEl, query) {
    addElementClasses(
      rowEl,
      "bob-cnp-property-row",
      item.defined ? "is-defined" : "is-undefined",
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, item.defined ? "check-circle-2" : "plus-circle");

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.property.name, query);

    const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
    pathEl.setText(
      item.defined ? `Current value: ${item.currentValue}` : "Not set",
    );

    if (item.defined) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: `${item.property.name} · ${item.currentValue}`,
      });
    } else {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill is-muted",
        text: "not set",
      });
    }
  }

  renderValueItem(item, rowEl, query) {
    addElementClasses(
      rowEl,
      "bob-cnp-property-value-row",
      item.current ? "is-current" : "",
      item.dynamic ? "is-dynamic" : "",
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(
      rowIcon,
      item.current ? "check-circle-2" : item.dynamic ? "calendar-plus" : "circle",
    );

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.label, query);

    if (item.detail) {
      const detailEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
      appendHighlighted(detailEl, item.detail, query);
    }

    if (item.current) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: "current",
      });
    }
  }

  renderTaskValueItem(item, rowEl, query) {
    const marked =
      this.markedLines instanceof Set && this.markedLines.has(item.line);
    const markedRemove = marked && item.alreadyLinked;
    const markedNeedsId = marked && !item.alreadyLinked && item.needsPromptForAdd;
    const markedAdd = marked && !item.alreadyLinked && !item.needsPromptForAdd;
    addElementClasses(
      rowEl,
      "bob-cnp-task-value-row",
      item.alreadyLinked ? "is-linked" : "",
      item.needsBlockIdPrompt ? "is-create" : "is-existing",
      marked ? "is-marked" : "",
      markedRemove ? "is-marked-remove" : "",
      markedAdd ? "is-marked-add" : "",
      markedNeedsId ? "is-marked-id-needed" : "",
    );

    const markEl = rowEl.createDiv({
      cls: marked ? "bob-cnp-mark is-marked" : "bob-cnp-mark",
      attr: {
        "aria-hidden": "true",
      },
    });
    if (marked) {
      markEl.setText("✓");
    }

    rowEl.createDiv({
      cls: `bob-cnp-status-pill is-${taskStatusClass(item.status)}`,
      text: taskStatusLabel(item.status),
    });

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.displayText, query);

    const metaEl = textEl.createDiv({ cls: "bob-cnp-row-meta" });
    metaEl.createSpan({ text: `Line ${item.line + 1}` });

    const badgeClasses = [
      "bob-cnp-task-badge",
      markedRemove
        ? "is-marked-remove"
        : markedNeedsId
          ? "is-marked-id-needed"
          : markedAdd
            ? "is-marked-add"
            : item.alreadyLinked
              ? "is-linked"
              : item.needsBlockIdPrompt
                ? "is-create"
                : "is-existing",
    ];
    const badgeEl = rowEl.createDiv({ cls: badgeClasses.join(" ") });
    if (markedRemove) {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: "− remove",
      });
    } else if (markedNeedsId) {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋ id" });
    } else if (markedAdd) {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "＋ add" });
    } else if (item.alreadyLinked) {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: "✓ depends",
      });
    } else if (item.needsBlockIdPrompt) {
      // Unmarked, not yet linked, and missing a trailing block ID: pressing
      // Enter prompts for one before linking.
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "+ id" });
    } else {
      badgeEl.createSpan({ cls: "bob-cnp-task-badge-action", text: "↵" });
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-id",
        text: `^${item.value}`,
      });
    }
  }

  renderBlockIdPreviewItem(item, rowEl, query) {
    addElementClasses(
      rowEl,
      "bob-cnp-blockid-preview-row",
      `is-${item.state}`,
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(rowIcon, item.valid ? "check-circle-2" : "alert-triangle");

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    appendHighlighted(titleEl, item.id || "(type an id)", query);

    textEl.createDiv({
      cls: "bob-cnp-row-meta",
      text: item.message,
    });

    const taskTitle =
      item.task && item.task.displayText
        ? item.task.displayText
        : "(untitled task)";
    const existingIdField =
      item.task && item.task.existingIdField
        ? normalizeBulletPropertyValue(item.task.existingIdField)
        : "";
    const idDisplay = item.id || "id";
    // When the task already has an `[id:: value]`, confirmation only appends the
    // trailing `^id` block target and keeps the existing dependency value;
    // otherwise it creates both `[id:: id]` and `^id`.
    const previewText = existingIdField
      ? `Appends ^${idDisplay}; keeps [id:: ${existingIdField}] on: ${taskTitle}`
      : `Adds [id:: ${idDisplay}] ^${idDisplay} to: ${taskTitle}`;
    textEl.createDiv({
      cls: "bob-cnp-blockid-preview",
      text: previewText,
    });
  }

  chooseTaskDependency(item) {
    if (!this.selectedPropertyItem) {
      return false;
    }

    if (this.getMarkedCount() > 0) {
      return this.commitMarkedDependencies();
    }

    if (!item) {
      return false;
    }

    // Single-select path. Re-read the target so a stale row never writes.
    const targetLine = getEditorLine(this.editor, item.line);
    if (targetLine !== item.rawLine) {
      new Notice("Task changed; dependency not added");
      return false;
    }

    // Stricter rule: a missing trailing block ID always prompts, even when an
    // `[id:: value]` is already present (it stays the dependency value while the
    // prompted ID becomes the navigation block target).
    const resolved = resolveTargetTaskIdentity(targetLine, {
      promptWhenBlockIdMissing: true,
    });
    if (resolved.needsBlockIdPrompt) {
      this.showBlockIdStage(item, { mode: "single" });
      return false;
    }

    if (!resolved.value) {
      new Notice("Could not identify task");
      return false;
    }

    if (resolved.targetEdits.length > 0) {
      const finalLine =
        resolved.targetEdits[resolved.targetEdits.length - 1].line;
      if (!replaceEditorLine(this.editor, item.line, targetLine, finalLine)) {
        new Notice("Could not update target task");
        return false;
      }
    }

    return this.plugin.setLocalTaskDependency(
      this.editor,
      this.cursor,
      this.selectedPropertyItem.property.name,
      resolved.value,
      { linkBlockId: resolved.linkBlockId },
    );
  }

  // Preparation phase for a marked batch apply. Guards the cursor bullet, then
  // partitions the marked rows into removals, ready additions (already have a
  // trailing block ID), and additions that still need a prompted block ID. When
  // prompts are needed it stashes a pending batch and opens the first prompt
  // (returning false so the modal stays open); otherwise it executes the batch
  // immediately. No editor writes happen in this phase.
  commitMarkedDependencies() {
    if (!this.selectedPropertyItem || this.getMarkedCount() === 0) {
      return false;
    }

    const propertyName = this.selectedPropertyItem.property.name;
    const cursorLineText = getEditorLine(this.editor, this.cursor.line);
    if (cursorLineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    if (!isBulletLine(cursorLineText)) {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (cursorLineText !== this.lineText) {
      new Notice("Current task changed; dependencies not updated");
      return false;
    }

    const removals = [];
    const readyAdditions = [];
    const promptQueue = [];

    this.getMarkedTaskItems().forEach((item) => {
      if (item.alreadyLinked) {
        // alreadyLinked implies a non-empty dependency value.
        removals.push({
          depValue: item.value,
          linkBlockId:
            item.existingBlockId || item.existingIdField || item.value,
        });
        return;
      }

      const snapshot = {
        line: item.line,
        rawLine: item.rawLine,
        displayText: item.displayText,
        existingIdField: item.existingIdField || null,
      };

      if (item.needsPromptForAdd) {
        promptQueue.push(snapshot);
      } else {
        readyAdditions.push(snapshot);
      }
    });

    const batch = {
      propertyName,
      cursorLineText,
      removals,
      readyAdditions,
      promptQueue,
      promptIndex: 0,
      confirmedById: new Map(),
      reservedIds: new Set(),
    };

    if (promptQueue.length === 0) {
      this.clearPendingBatch();
      return this.executeDependencyBatch(batch);
    }

    this.pendingBatch = batch;
    return this.promptNextBatchBlockId();
  }

  // Open the block-ID prompt for the task at the current queue position. Returns
  // false so the modal stays open while prompts are collected.
  promptNextBatchBlockId() {
    const batch = this.pendingBatch;
    if (!batch) {
      return false;
    }

    const snapshot = batch.promptQueue[batch.promptIndex];
    if (!snapshot) {
      return false;
    }

    this.showBlockIdStage(snapshot, {
      mode: "batch",
      position: batch.promptIndex + 1,
      total: batch.promptQueue.length,
    });
    return false;
  }

  confirmBlockId(item) {
    if (!this.selectedPropertyItem || !this.pendingTask || !item) {
      return false;
    }

    if (!item.valid) {
      return false;
    }

    if (this.blockIdMode === "batch" && this.pendingBatch) {
      return this.confirmBatchBlockId(item);
    }

    return this.confirmSingleBlockId(item);
  }

  // Record one confirmed block ID and either advance to the next prompt (modal
  // stays open) or, on the final prompt, run the batch executor and close only
  // when it succeeds.
  confirmBatchBlockId(item) {
    const batch = this.pendingBatch;
    const snapshot = batch.promptQueue[batch.promptIndex];
    if (!snapshot) {
      return false;
    }

    batch.confirmedById.set(snapshot.line, item.id);
    batch.reservedIds.add(item.id);
    batch.promptIndex += 1;

    if (batch.promptIndex < batch.promptQueue.length) {
      return this.promptNextBatchBlockId();
    }

    if (this.executeDependencyBatch(batch)) {
      this.clearPendingBatch();
      return true;
    }

    // Executor aborted (e.g. cursor bullet changed). Leave the modal open with
    // the failure notice already shown; Esc cancels with nothing written.
    return false;
  }

  confirmSingleBlockId(item) {
    const task = this.pendingTask;
    const targetLine = getEditorLine(this.editor, task.line);
    if (targetLine !== task.rawLine) {
      new Notice("Task changed; dependency not added");
      return false;
    }

    const updatedLine = applyPromptedBlockIdToTaskLine(targetLine, item.id);
    if (!replaceEditorLine(this.editor, task.line, targetLine, updatedLine)) {
      new Notice("Could not update target task");
      return false;
    }

    // Keep an existing `[id:: value]` as the dependency value; otherwise the
    // confirmed block ID becomes both the id and the navigation target.
    const existingId = findBulletPropertyField(targetLine, "id");
    const depValue =
      (existingId && normalizeBulletPropertyValue(existingId.value)) || item.id;

    const linked = this.plugin.setLocalTaskDependency(
      this.editor,
      this.cursor,
      this.selectedPropertyItem.property.name,
      depValue,
      { showNotice: false, linkBlockId: item.id },
    );
    if (!linked) {
      return false;
    }

    new Notice(`Added ^${item.id} + linked dependency + navigation link`);
    return true;
  }

  // Execution phase: re-guard the cursor bullet, apply each target's edits,
  // rewrite the `[dependsOn:: ...]` list once, then reconcile navigation
  // bullets. Target-line edits are single-line replaces, so target indices stay
  // stable; only the nav reconciliation shifts lines and re-reads as it goes.
  executeDependencyBatch(batch) {
    const cursorLineText = getEditorLine(this.editor, this.cursor.line);
    if (cursorLineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    if (!isBulletLine(cursorLineText)) {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (cursorLineText !== batch.cursorLineText) {
      new Notice("Current task changed; dependencies not updated");
      return false;
    }

    const additions = [];
    const removals = batch.removals.slice();
    let skippedStale = 0;
    let skippedOther = 0;

    batch.readyAdditions.forEach((snapshot) => {
      const targetLine = getEditorLine(this.editor, snapshot.line);
      if (targetLine !== snapshot.rawLine) {
        skippedStale += 1;
        return;
      }

      const resolved = resolveTargetTaskIdentity(targetLine, {
        promptWhenBlockIdMissing: true,
      });
      if (resolved.needsBlockIdPrompt || !resolved.value) {
        skippedOther += 1;
        return;
      }

      if (resolved.targetEdits.length > 0) {
        const finalLine =
          resolved.targetEdits[resolved.targetEdits.length - 1].line;
        if (
          !replaceEditorLine(this.editor, snapshot.line, targetLine, finalLine)
        ) {
          skippedOther += 1;
          return;
        }
      }

      additions.push({
        depValue: resolved.value,
        linkBlockId: resolved.linkBlockId,
      });
    });

    batch.promptQueue.forEach((snapshot) => {
      const confirmedId = batch.confirmedById.get(snapshot.line);
      if (!confirmedId) {
        skippedOther += 1;
        return;
      }

      const targetLine = getEditorLine(this.editor, snapshot.line);
      if (targetLine !== snapshot.rawLine) {
        skippedStale += 1;
        return;
      }

      // Re-validate against fresh content (which already includes block IDs
      // applied earlier in this loop) in case the note changed while prompting.
      const validation = validateBlockIdCandidate(
        confirmedId,
        this.getEditorContent(),
      );
      if (!validation.valid) {
        skippedOther += 1;
        return;
      }

      const updatedLine = applyPromptedBlockIdToTaskLine(
        targetLine,
        confirmedId,
      );
      if (
        !replaceEditorLine(this.editor, snapshot.line, targetLine, updatedLine)
      ) {
        skippedOther += 1;
        return;
      }

      const existingId = findBulletPropertyField(targetLine, "id");
      const depValue =
        (existingId && normalizeBulletPropertyValue(existingId.value)) ||
        confirmedId;
      additions.push({ depValue, linkBlockId: confirmedId });
    });

    const dependencyResult = applyLocalTaskDependencyListEdits(
      cursorLineText,
      batch.propertyName,
      {
        add: additions.map((addition) => addition.depValue),
        remove: removals.map((removal) => removal.depValue),
      },
    );
    if (dependencyResult.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (
      dependencyResult.changed &&
      !replaceEditorLine(
        this.editor,
        this.cursor.line,
        cursorLineText,
        dependencyResult.line,
      )
    ) {
      new Notice("Could not update bullet property");
      return false;
    }

    const navigation = this.reconcileDependencyNavigationBullets(
      removals,
      additions,
    );

    const finalCursorLine =
      getEditorLine(this.editor, this.cursor.line) || dependencyResult.line;
    setEditorCursorSafely(
      this.editor,
      this.cursor.line,
      Math.min(Math.max(this.cursor.ch, 0), finalCursorLine.length),
    );

    new Notice(
      buildMultiDependencyNotice({
        added: dependencyResult.added.length,
        removed: dependencyResult.removed.length,
        navigationAdded: navigation.added,
        navigationRemoved: navigation.removed,
        navigationUpdated: navigation.updated,
        navigationConsolidated: navigation.consolidated,
        skippedStale,
        skippedOther,
      }),
    );
    return true;
  }

  // Reconcile managed navigation child bullets for a finished batch as one
  // consolidated bullet. The dependency field is canonical; this layer preserves
  // existing on-screen link order, drops removed link targets, and appends new
  // link targets.
  reconcileDependencyNavigationBullets(removals, additions) {
    const content =
      this.editor && typeof this.editor.getValue === "function"
        ? String(this.editor.getValue() || "")
        : null;
    if (content === null) {
      return { added: 0, removed: 0, updated: 0, consolidated: 0 };
    }

    const collection = collectDependencyNavigationBullets(
      content,
      this.cursor.line,
    );
    const finalBlockIds = computeFinalDependencyLinkOrder(
      collection.blockIds,
      additions.map((addition) => addition.linkBlockId),
      removals.map((removal) => removal.linkBlockId),
    );
    const existingSet = new Set(collection.blockIds);
    const finalSet = new Set(finalBlockIds);
    const plan = planDependencyNavigationBulletSync(
      content,
      this.cursor.line,
      finalBlockIds,
    );
    const applied = applyDependencyNavigationBulletSyncPlan(this.editor, plan);
    if (plan.changed && !applied.changed) {
      return { added: 0, removed: 0, updated: 0, consolidated: 0 };
    }

    return {
      added: finalBlockIds.filter((blockId) => !existingSet.has(blockId))
        .length,
      removed: collection.blockIds.filter((blockId) => !finalSet.has(blockId))
        .length,
      updated:
        applied.replaced > 0 && !applied.consolidated ? applied.replaced : 0,
      consolidated: applied.consolidated ? 1 : 0,
    };
  }

  handleKeydown(event) {
    if (this.isLocalTaskStage() && event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      this.toggleHighlightedLocalTaskMark();
      return;
    }

    if (
      this.isLocalTaskStage() &&
      event.key === "Enter" &&
      this.getMarkedCount() > 0
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.opening) {
        return;
      }

      this.opening = true;
      try {
        if (this.commitMarkedDependencies()) {
          this.close();
        }
      } finally {
        this.opening = false;
      }
      return;
    }

    if (this.stage === "properties" && isCtrlKey(event, "d")) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteSelectedProperty();
      return;
    }

    super.handleKeydown(event);
  }

  deleteSelectedProperty() {
    const item = this.visibleItems[this.selectedIndex];
    if (!item || item.kind !== "property") {
      return;
    }

    const propertyName = item.property.name;
    if (!item.defined) {
      new Notice(`${propertyName} is not set on this bullet`);
      return;
    }

    const result = this.plugin.deleteBulletPropertyValue(
      this.editor,
      this.cursor,
      propertyName,
    );
    if (!result || !result.deleted) {
      if (result && result.line) {
        this.lineText = result.line;
        this.bulletSubtitle = truncateBulletPropertySubtitle(result.line);
        this.showPropertyStage({
          clearQuery: false,
          selectPropertyName: propertyName,
        });
      }
      return;
    }

    this.lineText = result.line;
    this.bulletSubtitle = truncateBulletPropertySubtitle(result.line);
    this.showPropertyStage({
      clearQuery: false,
      selectPropertyName: propertyName,
    });
  }

  applySelectedValue(item) {
    if (!this.selectedPropertyItem || !item) {
      return false;
    }

    return this.plugin.setBulletPropertyValue(
      this.editor,
      this.cursor,
      this.selectedPropertyItem.property.name,
      item.value,
    );
  }
}

function isCtrlKey(event, key) {
  return (
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === key
  );
}

async function openMarkdownFileWithLeafReuse(plugin, file, failureNotice) {
  if (!plugin || !plugin.isMarkdownFile(file)) {
    if (failureNotice) {
      new Notice(failureNotice);
    }
    return false;
  }

  const activeView = plugin.getActiveMarkdownView();
  if (activeView && activeView.file && activeView.file.path === file.path) {
    return true;
  }

  try {
    const existingLeaf = plugin.findMarkdownLeafByPath(file.path);
    if (existingLeaf && (await plugin.activateWorkspaceLeaf(existingLeaf))) {
      return true;
    }

    await plugin.app.workspace.getLeaf(false).openFile(file);
    return true;
  } catch (error) {
    if (failureNotice) {
      new Notice(failureNotice);
    }
    return false;
  }
}

module.exports = class BobNavigationHotkeysPlugin extends Plugin {
  onload() {
    this.currentFilePath = null;
    this.alternateFilePath = null;
    this.filePositions = new Map();
    this.pendingRestoreDeferred = null;
    this.pendingDashTasksDeferred = null;
    this.pendingDashTasksScrollDeferred = null;
    this.pendingOpenTaskJumpCenterDeferred = null;

    this.addCommand({
      id: "open-parent-note",
      name: "Open parent note",
      callback: () => this.openParentNote(),
    });

    this.addCommand({
      id: "open-child-note",
      name: "Open child note",
      callback: () => this.openChildNotePicker(),
    });

    this.addCommand({
      id: "open-template-note",
      name: "Open template note",
      callback: () => this.openTemplateNote(),
    });

    this.addCommand({
      id: "open-alt-file-note",
      name: "Open alt file note",
      callback: () => this.openAltFileNote(),
    });

    this.addCommand({
      id: "open-dash-tasks",
      name: "Open dash Tasks section",
      hotkeys: [{ modifiers: ["Ctrl"], key: "0" }],
      callback: () => this.openDashTasks(),
    });

    this.addCommand({
      id: "create-project-note",
      name: "Create project note",
      callback: () => this.createProjectNote(),
    });

    this.addCommand({
      id: "create-project-note-from-task",
      name: "Create project note from task",
      editorCallback: (editor, view) =>
        this.createProjectNoteFromTask(editor, view),
    });

    this.addCommand({
      id: "open-next-link",
      name: "Open next link",
      callback: () => this.openLabeledBodyLink("next"),
    });

    this.addCommand({
      id: "open-prev-link",
      name: "Open previous link",
      callback: () => this.openLabeledBodyLink("prev"),
    });

    this.addCommand({
      id: "toggle-line-transclusions",
      name: "Toggle line transclusions",
      editorCallback: (editor) => this.toggleCurrentLineTransclusions(editor),
    });

    this.addCommand({
      id: "set-bullet-property",
      name: "Set bullet property",
      editorCallback: (editor) => this.openBulletPropertyPicker(editor),
    });

    this.addCommand({
      id: "consolidate-dependency-navigation-links",
      name: "Consolidate DEPENDS ON navigation links (current note)",
      editorCallback: (editor) =>
        this.consolidateDependencyNavigationLinks(editor),
    });

    this.addCommand({
      id: "insert-blank-line-above",
      name: "Insert blank line above",
      editorCallback: (editor) => this.insertBlankLine(editor, "above"),
    });

    this.addCommand({
      id: "insert-blank-line-below",
      name: "Insert blank line below",
      editorCallback: (editor) => this.insertBlankLine(editor, "below"),
    });

    this.addCommand({
      id: "jump-to-next-section-header",
      name: "Jump to next section header",
      editorCallback: (editor) => this.jumpToSectionHeader(editor, 1),
    });

    this.addCommand({
      id: "jump-to-prev-section-header",
      name: "Jump to previous section header",
      editorCallback: (editor) => this.jumpToSectionHeader(editor, -1),
    });

    this.addCommand({
      id: "jump-to-next-open-task",
      name: "Jump to next open task",
      editorCallback: (editor) => this.jumpToOpenObsidianTask(editor, 1),
    });

    this.addCommand({
      id: "jump-to-prev-open-task",
      name: "Jump to previous open task",
      editorCallback: (editor) => this.jumpToOpenObsidianTask(editor, -1),
    });

    this.addCommand({
      id: "open-alternate-file",
      name: "Open alternate file",
      callback: () => this.openAlternateFile(),
    });

    this.addCommand({
      id: "delete-current-file",
      name: "Delete current file",
      callback: () => this.deleteCurrentFile(),
    });

    this.addCommand({
      id: "rename-current-file",
      name: "Rename current file",
      callback: () => this.openRenameCurrentFileModal(),
    });

    this.addCommand({
      id: "move-tab-left",
      name: "Move tab left",
      callback: () => this.moveActiveTab(-1),
    });

    this.addCommand({
      id: "move-tab-right",
      name: "Move tab right",
      callback: () => this.moveActiveTab(1),
    });

    this.addCommand({
      id: "duplicate-current-tab",
      name: "Duplicate current tab",
      callback: () => this.duplicateCurrentTab(),
    });

    this.addCommand({
      id: "close-tabs-left",
      name: "Close tabs to the left",
      callback: () => this.closeSiblingTabs("left"),
    });

    this.addCommand({
      id: "close-tabs-right",
      name: "Close tabs to the right",
      callback: () => this.closeSiblingTabs("right"),
    });

    this.addCommand({
      id: "close-other-tabs",
      name: "Close other tabs",
      callback: () => this.closeSiblingTabs("others"),
    });

    this.addCommand({
      id: "copy-active-file-path",
      name: "Copy active file path",
      hotkeys: [{ modifiers: ["Mod"], key: "Y" }],
      callback: () => this.openYankPathPicker(),
    });

    YANK_PATH_COMMANDS.forEach((command) => {
      this.addCommand({
        id: command.id,
        name: command.name,
        callback: () => this.yankActiveFilePath(command.kind),
      });
    });

    this.app.workspace.onLayoutReady(() => {
      const activeFile = this.app.workspace.getActiveFile();
      if (this.isMarkdownFile(activeFile)) {
        this.currentFilePath = activeFile.path;
        this.captureActiveFilePosition();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.trackOpenedFile(file)),
    );

    if (
      EditorView &&
      EditorView.updateListener &&
      typeof EditorView.updateListener.of === "function"
    ) {
      this.registerEditorExtension(
        EditorView.updateListener.of((update) =>
          this.trackSelectionUpdate(update),
        ),
      );
    }

    this.registerOpenTaskJumpInputListeners();
    this.registerCountedTransclusionToggleInputListeners();
    this.registerClearSearchHighlightInputListeners();

    this.register(() => {
      this.cancelPendingRestore();
      this.cancelPendingDashTasksJump();
      cancelDeferred(this.pendingOpenTaskJumpCenterDeferred);
      this.pendingOpenTaskJumpCenterDeferred = null;
    });
  }

  toggleCurrentLineTransclusions(cm) {
    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }

    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const result = toggleLineTransclusions(lineText);
    if (!result.found) {
      new Notice("No links found on current line");
      return false;
    }

    if (
      !result.changed ||
      !replaceEditorLine(cm, cursor.line, lineText, result.line)
    ) {
      return false;
    }

    const nextCh = adjustCursorChForTransclusionChanges(
      cursor.ch,
      result.changes,
      result.line.length,
    );
    setEditorCursorSafely(cm, cursor.line, nextCh);

    return true;
  }

  toggleCountedLineTransclusions(editor, cursor, repeat) {
    const normalizedCursor = normalizePosition(cursor);
    if (!normalizedCursor || !editor) {
      return false;
    }

    const firstLine = getEditorFirstLine(editor);
    const lastLine = getEditorLastLine(editor);
    if (lastLine === null) {
      return false;
    }

    const startLine = Math.max(
      firstLine === null ? 0 : firstLine,
      Math.min(normalizedCursor.line, lastLine),
    );
    const endLine = Math.min(startLine + Math.max(0, repeat), lastLine);
    const lines = [];

    for (let line = startLine; line <= endLine; line += 1) {
      const lineText = getEditorLine(editor, line);
      lines[line] = lineText === null ? "" : lineText;
    }

    const result = toggleLineRangeTransclusions(lines, startLine, endLine);
    if (!result.found || !result.changed) {
      return false;
    }

    for (const change of result.changesByLine) {
      if (
        !replaceEditorLine(
          editor,
          change.line,
          change.lineText,
          change.nextLineText,
        )
      ) {
        return false;
      }
    }

    const activeChange = result.changesByLine.find(
      (change) => change.line === startLine,
    );
    const nextActiveLine =
      activeChange && typeof activeChange.nextLineText === "string"
        ? activeChange.nextLineText
        : getEditorLine(editor, startLine) || "";
    const nextCh = activeChange
      ? adjustCursorChForTransclusionChanges(
          normalizedCursor.ch,
          activeChange.changes,
          nextActiveLine.length,
        )
      : Math.min(Math.max(normalizedCursor.ch, 0), nextActiveLine.length);

    setEditorCursorSafely(editor, startLine, nextCh);
    return true;
  }

  consolidateDependencyNavigationLinks(cm) {
    if (!cm || typeof cm.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const taskLines = [];
    String(cm.getValue() || "")
      .split(/\r?\n/)
      .forEach((lineText, index) => {
        if (OBSIDIAN_TASK_LINE_RE.test(lineText)) {
          taskLines.push(index);
        }
      });

    let consolidatedTasks = 0;
    taskLines
      .slice()
      .reverse()
      .forEach((line) => {
        const content = String(cm.getValue() || "");
        const lines = content.split(/\r?\n/);
        if (line >= lines.length || !OBSIDIAN_TASK_LINE_RE.test(lines[line])) {
          return;
        }

        const collection = collectDependencyNavigationBullets(content, line);
        if (collection.lineIndices.length === 0) {
          return;
        }

        const plan = planDependencyNavigationBulletSync(
          content,
          line,
          collection.blockIds,
        );
        const applied = applyDependencyNavigationBulletSyncPlan(cm, plan);
        if (applied.changed) {
          consolidatedTasks += 1;
        }
      });

    new Notice(
      consolidatedTasks > 0
        ? `Consolidated ${formatCountLabel(consolidatedTasks, "task")}`
        : "Nothing to consolidate",
    );
    return consolidatedTasks > 0;
  }

  openBulletPropertyPicker(cm) {
    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }

    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    if (!isBulletLine(lineText)) {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    const config = loadBulletPropertyConfig();
    if (!config) {
      return false;
    }

    new BulletPropertyPickerModal(
      this.app,
      this,
      cm,
      cursor,
      lineText,
      config,
    ).open();
    return true;
  }

  setBulletPropertyValue(cm, cursor, name, value) {
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const result = upsertBulletProperty(lineText, name, value);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (
      result.changed &&
      !replaceEditorLine(cm, cursor.line, lineText, result.line)
    ) {
      new Notice("Could not update bullet property");
      return false;
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), result.line.length),
    );
    new Notice(`${name} → ${normalizeBulletPropertyValue(value)}`);
    return true;
  }

  setLocalTaskDependency(cm, cursor, name, id, options = {}) {
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const result = upsertLocalTaskIdValue(lineText, name, id);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    if (result.reason === "empty-id") {
      new Notice("Task has no dependency ID");
      return false;
    }

    if (
      result.changed &&
      !replaceEditorLine(cm, cursor.line, lineText, result.line)
    ) {
      new Notice("Could not update bullet property");
      return false;
    }

    // Add the human-navigation child bullet last: it shifts line numbers below
    // the cursor, and by now the `[dependsOn:: ...]` merge (and any target-task
    // edit done by the caller) is already complete.
    let navigationResult = null;
    let navigationConsolidated = false;
    const linkBlockId = normalizeBulletPropertyValue(options.linkBlockId);
    if (linkBlockId) {
      const content =
        cm && typeof cm.getValue === "function"
          ? String(cm.getValue() || "")
          : null;
      if (content === null) {
        navigationResult = "guard-failed";
      } else {
        const collection = collectDependencyNavigationBullets(
          content,
          cursor.line,
        );
        const hadNavigationLink = collection.blockIds.includes(linkBlockId);
        const finalBlockIds = computeFinalDependencyLinkOrder(
          collection.blockIds,
          [linkBlockId],
          [],
        );
        const plan = planDependencyNavigationBulletSync(
          content,
          cursor.line,
          finalBlockIds,
        );
        if (plan.operation === "guard") {
          navigationResult = "guard-failed";
        } else {
          const applied = applyDependencyNavigationBulletSyncPlan(cm, plan);
          navigationConsolidated = applied.consolidated;
          if (plan.changed && !applied.changed) {
            navigationResult = "failed";
          } else if (!hadNavigationLink && finalBlockIds.includes(linkBlockId)) {
            navigationResult = applied.changed ? "added" : "failed";
          } else if (applied.changed) {
            navigationResult = "updated";
          } else if (hadNavigationLink) {
            navigationResult = "already-present";
          } else {
            navigationResult = "failed";
          }
        }
      }
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), result.line.length),
    );

    if (options.showNotice !== false) {
      new Notice(
        buildLocalTaskDependencyNotice({
          name,
          id,
          dependencyAlreadyPresent: result.alreadyPresent,
          navigationResult,
          navigationConsolidated,
        }),
      );
    }
    return true;
  }

  deleteBulletPropertyValue(cm, cursor, name) {
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return null;
    }

    const result = deleteBulletProperty(lineText, name);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return null;
    }

    if (result.reason === "not-found") {
      new Notice(`${name} is not set on this bullet`);
      setEditorCursorSafely(
        cm,
        cursor.line,
        Math.min(Math.max(cursor.ch, 0), lineText.length),
      );
      return { deleted: false, line: lineText };
    }

    if (
      result.changed &&
      !replaceEditorLine(cm, cursor.line, lineText, result.line)
    ) {
      new Notice("Could not delete bullet property");
      return null;
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), result.line.length),
    );
    new Notice(`${name} ✗ removed`);
    return { deleted: true, line: result.line };
  }

  insertBlankLine(cm, direction) {
    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }

    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const insertAbove = direction === "above";
    const replacementText = insertAbove ? `\n${lineText}` : `${lineText}\n`;
    if (!replaceEditorLine(cm, cursor.line, lineText, replacementText)) {
      return false;
    }

    setEditorCursorSafely(
      cm,
      insertAbove ? cursor.line + 1 : cursor.line,
      cursor.ch,
    );

    return true;
  }

  jumpToSectionHeader(editor, direction) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const targetLine = getSectionHeaderJumpLine(
      String(editor.getValue()).split(/\r?\n/),
      cursor.line,
      direction,
    );

    if (targetLine === null) {
      new Notice(
        direction < 0 ? "No previous section header" : "No next section header",
      );
      return false;
    }

    if (!setEditorCursor(editor, { line: targetLine, ch: 0 })) {
      new Notice("No active markdown editor");
      return false;
    }

    scrollEditorLineToTop(editor, targetLine);
    return true;
  }

  jumpToOpenObsidianTask(editor, direction) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    // A single physical Ctrl+Shift+J/K can reach this method twice in the same
    // dispatch turn: once via the Obsidian hotkeys.json command and once via the
    // Vim-normal capture fallback. Suppress the duplicate so a no-target press
    // shows only one notice (and a successful jump never moves twice). The mark
    // clears on the next macrotask so deliberate repeats and key repeat still
    // work.
    if (this.isOpenTaskJumpDispatchPending(editor, direction)) {
      return false;
    }
    this.markOpenTaskJumpDispatch(editor, direction);

    const targetLine = getOpenObsidianTaskJumpLine(
      String(editor.getValue()).split(/\r?\n/),
      cursor.line,
      direction,
    );

    if (targetLine === null) {
      new Notice(direction < 0 ? "No previous open task" : "No next open task");
      return false;
    }

    if (!setEditorCursor(editor, { line: targetLine, ch: 0 })) {
      new Notice("No active markdown editor");
      return false;
    }

    // Vim `zz`-style: center the jumped-to task line instead of top-aligning it.
    // Deferred one frame so it survives any trailing Vim cursor-visibility
    // scroll in the same keydown turn.
    scheduleOpenTaskJumpCenter(this, editor, targetLine, 0);
    return true;
  }

  // Lazily-created WeakMap from editor object to the set of jump directions
  // already dispatched in the current macrotask. Keyed by editor so distinct
  // panes never deduplicate against each other, and weak so closed editors are
  // collected without manual cleanup.
  getOpenTaskJumpDispatchGuard() {
    if (!this.openTaskJumpDispatchGuard) {
      this.openTaskJumpDispatchGuard = new WeakMap();
    }
    return this.openTaskJumpDispatchGuard;
  }

  isOpenTaskJumpDispatchPending(editor, direction) {
    if (!editor || typeof editor !== "object") {
      return false;
    }
    const directions = this.getOpenTaskJumpDispatchGuard().get(editor);
    return !!directions && directions.has(direction);
  }

  markOpenTaskJumpDispatch(editor, direction) {
    if (!editor || typeof editor !== "object") {
      return;
    }
    const guard = this.getOpenTaskJumpDispatchGuard();
    let directions = guard.get(editor);
    if (!directions) {
      directions = new Set();
      guard.set(editor, directions);
    }
    directions.add(direction);
    setTimeout(() => {
      const current = guard.get(editor);
      if (!current) {
        return;
      }
      current.delete(direction);
      if (current.size === 0) {
        guard.delete(editor);
      }
    }, 0);
  }

  // Capture-phase fallback so Ctrl+Shift+J/K reach the open-task jump commands
  // while Vim normal mode is active. CodeMirror Vim swallows these chords before
  // Obsidian's hotkey dispatcher runs, so the hotkeys.json bindings only cover
  // insert mode and non-Vim editing. This mirrors task-status-cycler's
  // Ctrl+Shift+O handling and intentionally avoids a `<C-S-j>`/`<C-S-k>` vim
  // nmap, which could collapse onto and overwrite the existing `<C-j>`/`<C-k>`
  // section-header maps.
  registerOpenTaskJumpInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-fire when both run for the same keydown.
    this.handledOpenTaskJumpEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleOpenTaskJumpPhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerClearSearchHighlightInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-run nohlsearch for the same keydown.
    this.handledClearSearchHighlightEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleClearSearchHighlightKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  registerCountedTransclusionToggleInputListeners() {
    this.handledCountedTransclusionToggleEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleCountedTransclusionTogglePhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleCountedTransclusionTogglePhysicalKeydown(event) {
    if (!this.isCountedTransclusionToggleKeydown(event)) {
      return false;
    }

    if (
      this.handledCountedTransclusionToggleEvents &&
      this.handledCountedTransclusionToggleEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (!pendingRepeat.explicit) {
      return false;
    }

    const cursor = getEditorCursor(view.editor);
    if (!cursor) {
      return false;
    }

    const activeLineText = getEditorLine(view.editor, cursor.line);
    if (
      activeLineText === null ||
      findTransclusionToggleTargets(activeLineText).length === 0
    ) {
      return false;
    }

    if (this.handledCountedTransclusionToggleEvents) {
      this.handledCountedTransclusionToggleEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    resetPendingVimInputState(cm, "counted-transclusion-toggle");
    return this.toggleCountedLineTransclusions(
      view.editor,
      cursor,
      pendingRepeat.repeat,
    );
  }

  isCountedTransclusionToggleKeydown(event) {
    return (
      !!event &&
      event.key === "!" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    );
  }

  handleClearSearchHighlightKeydown(event) {
    if (!this.isClearSearchHighlightEscapeKeydown(event)) {
      return false;
    }

    if (
      this.handledClearSearchHighlightEvents &&
      this.handledClearSearchHighlightEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    const vim =
      typeof window !== "undefined" &&
      window.CodeMirrorAdapter &&
      window.CodeMirrorAdapter.Vim;
    if (!cm || !vim || typeof vim.handleEx !== "function") {
      return false;
    }

    if (this.handledClearSearchHighlightEvents) {
      this.handledClearSearchHighlightEvents.add(event);
    }

    vim.handleEx(cm, "nohlsearch");
    return false;
  }

  handleOpenTaskJumpPhysicalKeydown(event) {
    const direction = this.getOpenTaskJumpKeydownDirection(event);
    if (!direction) {
      return false;
    }

    if (
      this.handledOpenTaskJumpEvents &&
      this.handledOpenTaskJumpEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    // Only intercept in Vim normal mode. Insert/visual/replace mode and a
    // disabled Vim setting fall through so Obsidian's hotkeys.json bindings
    // handle the chord instead.
    if (!this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    if (this.handledOpenTaskJumpEvents) {
      this.handledOpenTaskJumpEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    this.jumpToOpenObsidianTask(view.editor, direction);
    return true;
  }

  isClearSearchHighlightEscapeKeydown(event) {
    if (!event) {
      return false;
    }

    if (event.key === "Escape" || event.key === "Esc") {
      return true;
    }

    // CodeMirror Vim treats Ctrl+[ as <Esc>, but Chromium reports the raw
    // bracket chord to this capture-phase listener before Vim translates it.
    return (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "BracketLeft" || event.key === "[")
    );
  }

  getOpenTaskJumpKeydownDirection(event) {
    // Narrow capture-phase fallback matching the hotkeys.json bindings: exactly
    // Ctrl+Shift+J/K. Alt/Option and Meta combinations are never ours.
    if (
      !event ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return null;
    }

    if (event.code === "KeyJ" || ["j", "J"].includes(event.key)) {
      return 1;
    }

    if (event.code === "KeyK" || ["k", "K"].includes(event.key)) {
      return -1;
    }

    return null;
  }

  getFocusedMarkdownEditorView(event) {
    const view = this.getActiveMarkdownView();
    if (!(view instanceof MarkdownView) || !this.isEditorEventTarget(event, view)) {
      return null;
    }

    return view;
  }

  isEditorEventTarget(event, view) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    const editorEl = target.closest(".cm-editor");
    if (!editorEl) {
      return false;
    }

    const containerEl = view && view.containerEl;
    return (
      !containerEl ||
      typeof containerEl.contains !== "function" ||
      containerEl.contains(editorEl)
    );
  }

  isVimNormalModeEditor(editor, view) {
    const cm = this.resolveVimCodeMirror(editor, view);
    if (!cm || typeof cm.getCursor !== "function") {
      return false;
    }

    const mode = this.getCurrentVimMode(cm);
    return !["insert", "visual", "visual-block", "visual-line", "replace"].includes(
      mode,
    );
  }

  resolveVimCodeMirror(editor, view) {
    const cm =
      (editor && editor.cm && editor.cm.cm) ||
      (view &&
        view.editMode &&
        view.editMode.editor &&
        view.editMode.editor.cm &&
        view.editMode.editor.cm.cm);
    return cm && typeof cm.getCursor === "function" ? cm : null;
  }

  getCurrentVimMode(cm) {
    const vimState = cm && cm.state && cm.state.vim;
    if (vimState) {
      if (vimState.insertMode === true) {
        return "insert";
      }
      if (vimState.visualMode === true) {
        return "visual";
      }
      if (vimState.replaceMode === true) {
        return "replace";
      }
      if (typeof vimState.mode === "string") {
        return vimState.mode;
      }
    }

    const vimrcSupport =
      this.app &&
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["obsidian-vimrc-support"];
    return vimrcSupport && typeof vimrcSupport.currentVimStatus === "string"
      ? vimrcSupport.currentVimStatus
      : null;
  }

  async openDashTasks() {
    const file = this.app.vault.getAbstractFileByPath(DASH_FILE_PATH);
    if (!this.isMarkdownFile(file)) {
      new Notice(`${DASH_FILE_PATH} not found`);
      return false;
    }

    const activeView = this.getActiveMarkdownView();
    if (activeView && activeView.file.path === file.path) {
      return this.jumpOrDeferDashTasks();
    }

    this.captureActiveFilePosition();

    try {
      const existingLeaf = this.findMarkdownLeafByPath(file.path);
      if (existingLeaf) {
        const activated = await this.activateWorkspaceLeaf(existingLeaf);
        if (!activated) {
          await this.app.workspace.getLeaf(false).openFile(file);
        }
      } else {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
    } catch (error) {
      new Notice(`Could not open ${DASH_FILE_PATH}`);
      return false;
    }

    this.jumpOrDeferDashTasks();
    return true;
  }

  findMarkdownLeafByPath(filePath) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.iterateAllLeaves !== "function") {
      return null;
    }

    let matchedLeaf = null;
    workspace.iterateAllLeaves((leaf) => {
      if (matchedLeaf || !leaf || !leaf.view) {
        return;
      }

      const viewFile = leaf.view.file;
      if (this.isMarkdownFile(viewFile) && viewFile.path === filePath) {
        matchedLeaf = leaf;
      }
    });

    return matchedLeaf;
  }

  async activateWorkspaceLeaf(leaf) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || !leaf) {
      return false;
    }

    const setActiveLeaf = () => {
      if (typeof workspace.setActiveLeaf !== "function") {
        return false;
      }

      try {
        workspace.setActiveLeaf(leaf, { focus: true });
        return true;
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
          return true;
        } catch (ignoredError) {
          return false;
        }
      }
    };

    if (typeof workspace.revealLeaf === "function") {
      try {
        await workspace.revealLeaf(leaf);
        return setActiveLeaf();
      } catch (error) {
        // Fall through to the older activation API.
      }
    }

    return setActiveLeaf();
  }

  async openMarkdownFileWithLeafReuse(file, failureNotice) {
    return openMarkdownFileWithLeafReuse(this, file, failureNotice);
  }

  async duplicateCurrentTab() {
    const workspace = this.app && this.app.workspace;
    const sourceLeaf = workspace && workspace.activeLeaf;
    if (!workspace || !sourceLeaf) {
      return false;
    }

    const sourceFile =
      sourceLeaf.view && this.isMarkdownFile(sourceLeaf.view.file)
        ? sourceLeaf.view.file
        : null;
    const viewState = this.getLeafViewState(sourceLeaf);
    let targetLeaf = null;

    const duplicateMarkdownFile = async () => {
      targetLeaf = targetLeaf || this.createNewTabLeaf(workspace, sourceLeaf);
      if (
        !targetLeaf ||
        !sourceFile ||
        !(await this.openMarkdownFileInLeaf(targetLeaf, sourceFile))
      ) {
        return false;
      }

      this.placeDuplicateTabAfterSource(sourceLeaf, targetLeaf);
      await this.focusWorkspaceLeaf(targetLeaf);
      return true;
    };

    if (!viewState) {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      new Notice("Could not duplicate current tab");
      return false;
    }

    targetLeaf = this.createNewTabLeaf(workspace, sourceLeaf);
    if (!targetLeaf) {
      new Notice("Could not duplicate current tab");
      return false;
    }

    const duplicatedState = this.cloneViewState(viewState);
    if (!duplicatedState || typeof targetLeaf.setViewState !== "function") {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      await this.cleanupFailedDuplicateTab(sourceLeaf, targetLeaf);
      new Notice("Could not duplicate current tab");
      return false;
    }

    duplicatedState.active = true;

    try {
      await targetLeaf.setViewState(duplicatedState);
    } catch (error) {
      if (await duplicateMarkdownFile()) {
        return true;
      }

      await this.cleanupFailedDuplicateTab(sourceLeaf, targetLeaf);
      new Notice("Could not duplicate current tab");
      return false;
    }

    this.placeDuplicateTabAfterSource(sourceLeaf, targetLeaf);
    await this.focusWorkspaceLeaf(targetLeaf);
    return true;
  }

  getLeafViewState(leaf) {
    if (!leaf || typeof leaf.getViewState !== "function") {
      return null;
    }

    try {
      return leaf.getViewState();
    } catch (error) {
      return null;
    }
  }

  cloneViewState(viewState) {
    if (!viewState || typeof viewState !== "object") {
      return null;
    }

    if (typeof structuredClone === "function") {
      try {
        return structuredClone(viewState);
      } catch (error) {
        // Fall through to the JSON or shallow clone.
      }
    }

    try {
      return JSON.parse(JSON.stringify(viewState));
    } catch (error) {
      return {
        ...viewState,
        state:
          viewState.state && typeof viewState.state === "object"
            ? Array.isArray(viewState.state)
              ? [...viewState.state]
              : { ...viewState.state }
            : viewState.state,
      };
    }
  }

  createNewTabLeaf(workspace, sourceLeaf) {
    if (!workspace || typeof workspace.getLeaf !== "function") {
      return null;
    }

    try {
      const tabLeaf = workspace.getLeaf("tab");
      if (tabLeaf && tabLeaf !== sourceLeaf) {
        return tabLeaf;
      }
    } catch (error) {
      // Fall through to the older new-leaf API.
    }

    try {
      const fallbackLeaf = workspace.getLeaf(true);
      return fallbackLeaf && fallbackLeaf !== sourceLeaf ? fallbackLeaf : null;
    } catch (error) {
      return null;
    }
  }

  async openMarkdownFileInLeaf(leaf, file) {
    if (
      !leaf ||
      !this.isMarkdownFile(file) ||
      typeof leaf.openFile !== "function"
    ) {
      return false;
    }

    try {
      await leaf.openFile(file);
      return true;
    } catch (error) {
      return false;
    }
  }

  async focusWorkspaceLeaf(leaf) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || !leaf) {
      return false;
    }

    if (typeof workspace.revealLeaf === "function") {
      try {
        await workspace.revealLeaf(leaf);
      } catch (error) {
        // Fall through to direct activation.
      }
    }

    let focused = false;
    if (typeof workspace.setActiveLeaf === "function") {
      try {
        workspace.setActiveLeaf(leaf, { focus: true });
        focused = true;
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
          focused = true;
        } catch (ignoredError) {
          // Try the leaf-level focus API below.
        }
      }
    }

    if (typeof leaf.focus === "function") {
      try {
        leaf.focus();
        focused = true;
      } catch (error) {
        return focused;
      }
    }

    return focused;
  }

  placeDuplicateTabAfterSource(sourceLeaf, targetLeaf) {
    if (!sourceLeaf || !targetLeaf || sourceLeaf === targetLeaf) {
      return false;
    }

    const workspace = this.app && this.app.workspace;
    const parent = sourceLeaf.parent || sourceLeaf.parentSplit;
    const targetParent = targetLeaf.parent || targetLeaf.parentSplit;
    const children = parent && parent.children;
    if (
      !workspace ||
      !parent ||
      parent !== targetParent ||
      !Array.isArray(children)
    ) {
      return false;
    }

    const sourcePos = children.indexOf(sourceLeaf);
    const targetPos = children.indexOf(targetLeaf);
    if (sourcePos === -1 || targetPos === -1) {
      return false;
    }

    try {
      children.splice(targetPos, 1);
      const newSourcePos = children.indexOf(sourceLeaf);
      if (newSourcePos === -1) {
        children.splice(targetPos, 0, targetLeaf);
        return false;
      }
      children.splice(newSourcePos + 1, 0, targetLeaf);
    } catch (error) {
      return false;
    }

    if (typeof parent.selectTab === "function") {
      try {
        parent.selectTab(targetLeaf);
        return true;
      } catch (error) {
        // Fall through to the generic workspace-split update path.
      }
    }

    const sourceEl = sourceLeaf.containerEl;
    const targetEl = targetLeaf.containerEl;
    if (
      sourceEl &&
      targetEl &&
      sourceEl.parentElement &&
      sourceEl.parentElement === targetEl.parentElement &&
      sourceEl.nextSibling !== targetEl
    ) {
      sourceEl.parentElement.insertBefore(targetEl, sourceEl.nextSibling);
    }

    if (typeof parent.recomputeChildrenDimensions === "function") {
      parent.recomputeChildrenDimensions();
    }
    if (typeof targetLeaf.onResize === "function") {
      targetLeaf.onResize();
    }
    if (typeof workspace.onLayoutChange === "function") {
      workspace.onLayoutChange();
    }

    return true;
  }

  async cleanupFailedDuplicateTab(sourceLeaf, targetLeaf) {
    if (targetLeaf && targetLeaf !== sourceLeaf) {
      await this.detachWorkspaceLeaf(targetLeaf);
    }

    await this.focusWorkspaceLeaf(sourceLeaf);
  }

  async detachWorkspaceLeaf(leaf) {
    if (!leaf || typeof leaf.detach !== "function") {
      return false;
    }

    try {
      const result = leaf.detach();
      if (result && typeof result.then === "function") {
        await result;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  moveActiveTab(offset) {
    const workspace = this.app && this.app.workspace;
    const leaf = workspace && workspace.activeLeaf;
    if (!workspace || !leaf) {
      return false;
    }

    const parent = leaf.parent || leaf.parentSplit;
    const children = parent && parent.children;
    if (!Array.isArray(children) || children.length < 2) {
      return false;
    }

    const fromPos = children.indexOf(leaf);
    if (fromPos === -1) {
      return false;
    }

    const toPos = fromPos + offset;
    if (toPos < 0 || toPos >= children.length) {
      return false;
    }

    const displacedLeaf = children[toPos];
    children.splice(fromPos, 1);
    children.splice(toPos, 0, leaf);

    if (typeof parent.selectTab === "function") {
      try {
        parent.selectTab(leaf);
        return true;
      } catch (error) {
        // Fall through to the generic workspace-split update path.
      }
    }

    const leafEl = leaf.containerEl;
    const displacedEl = displacedLeaf && displacedLeaf.containerEl;
    if (
      leafEl &&
      displacedEl &&
      leafEl.parentElement &&
      leafEl.parentElement === displacedEl.parentElement
    ) {
      const containerEl = leafEl.parentElement;
      if (offset > 0) {
        containerEl.insertBefore(leafEl, displacedEl.nextSibling);
      } else {
        containerEl.insertBefore(leafEl, displacedEl);
      }
    }

    if (typeof parent.recomputeChildrenDimensions === "function") {
      parent.recomputeChildrenDimensions();
    }
    if (typeof leaf.onResize === "function") {
      leaf.onResize();
    }
    if (typeof workspace.onLayoutChange === "function") {
      workspace.onLayoutChange();
    }

    if (typeof workspace.setActiveLeaf === "function") {
      try {
        workspace.setActiveLeaf(leaf, { focus: true });
      } catch (error) {
        try {
          workspace.setActiveLeaf(leaf);
        } catch (ignoredError) {
          return false;
        }
      }
    }

    return true;
  }

  async closeSiblingTabs(scope) {
    const workspace = this.app && this.app.workspace;
    const activeLeaf = workspace && workspace.activeLeaf;
    if (!workspace || !activeLeaf) {
      return false;
    }

    const parent = activeLeaf.parent || activeLeaf.parentSplit;
    const children = parent && parent.children;
    if (!Array.isArray(children) || children.length < 2) {
      return false;
    }

    // Snapshot the sibling list before detaching anything: detaching a leaf
    // mutates parent.children, so iterating the live array would skip leaves.
    const snapshot = children.slice();
    const activeIndex = snapshot.indexOf(activeLeaf);
    if (activeIndex === -1) {
      return false;
    }

    let leavesToClose;
    if (scope === "left") {
      leavesToClose = snapshot.slice(0, activeIndex);
    } else if (scope === "right") {
      leavesToClose = snapshot.slice(activeIndex + 1);
    } else if (scope === "others") {
      leavesToClose = snapshot.filter((leaf) => leaf !== activeLeaf);
    } else {
      return false;
    }

    if (leavesToClose.length === 0) {
      return false;
    }

    // Detach sequentially: each detach mutates the workspace layout, so closing
    // siblings one at a time keeps the operation predictable.
    for (const leaf of leavesToClose) {
      await this.detachWorkspaceLeaf(leaf);
    }

    await this.focusWorkspaceLeaf(activeLeaf);
    return true;
  }

  jumpOrDeferDashTasks(retriesRemaining = DASH_TASKS_JUMP_RETRIES) {
    this.cancelPendingDashTasksJump();

    if (this.jumpToActiveDashTasks()) {
      return true;
    }

    if (retriesRemaining <= 0) {
      new Notice("No active markdown editor");
      return false;
    }

    this.pendingDashTasksDeferred = deferToNextFrame(() => {
      this.pendingDashTasksDeferred = null;
      this.jumpOrDeferDashTasks(retriesRemaining - 1);
    });

    return false;
  }

  jumpToActiveDashTasks() {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor ||
      typeof view.editor.getValue !== "function"
    ) {
      return false;
    }

    const targetLine = getDashTasksHeaderLine(
      String(view.editor.getValue()).split(/\r?\n/),
    );
    if (targetLine === null) {
      new Notice(`No "${DASH_TASKS_HEADER}" header in ${DASH_FILE_PATH}`);
      return true;
    }

    if (!setEditorCursor(view.editor, { line: targetLine, ch: 0 })) {
      return false;
    }

    if (scrollEditorLineToTop(view.editor, targetLine)) {
      this.scheduleDashTasksScrollAssert(targetLine);
    }
    return true;
  }

  scheduleDashTasksScrollAssert(targetLine, options = {}) {
    return scheduleDashTasksScrollAssert(this, targetLine, options);
  }

  cancelPendingDashTasksJump() {
    cancelDeferred(this.pendingDashTasksDeferred);
    this.pendingDashTasksDeferred = null;
    cancelDeferred(this.pendingDashTasksScrollDeferred);
    this.pendingDashTasksScrollDeferred = null;
  }

  async openParentNote() {
    await this.openFrontmatterLink(
      "parent",
      "No parent link found",
      "Parent note not found",
    );
  }

  async openTemplateNote() {
    await this.openFrontmatterLink(
      "template",
      "No template link found",
      "Template note not found",
    );
  }

  async openAltFileNote() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const fieldName = this.getFrontmatterLink(frontmatter, "alt_file")
      ? "alt_file"
      : "type";
    const notFoundMessage =
      fieldName === "alt_file"
        ? "Alt file note not found"
        : "Type note not found";

    await this.openFrontmatterLink(
      fieldName,
      "No alt_file or type link found",
      notFoundMessage,
    );
  }

  async openChildNotePicker() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const children = this.collectChildNotes(file);
    if (children.length === 0) {
      new Notice("No child notes found");
      return;
    }

    if (children.length === 1) {
      await this.openChildNote(children[0]);
      return;
    }

    new ChildNotePickerModal(this.app, this, children, file).open();
  }

  openYankPathPicker() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    new YankPathPickerModal(this.app, this, file).open();
  }

  collectChildNotes(parentFile) {
    if (!this.isMarkdownFile(parentFile)) {
      return [];
    }

    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          file.path !== parentFile.path &&
          this.frontmatterFieldPointsToFile(
            this.app.metadataCache.getFileCache(file)?.frontmatter,
            "parent",
            parentFile,
            file.path,
          ),
      )
      .sort((first, second) => first.path.localeCompare(second.path));
  }

  async openChildNote(file) {
    if (!this.isMarkdownFile(file)) {
      new Notice("Child note not found");
      return false;
    }

    this.captureActiveFilePosition();

    return this.openMarkdownFileWithLeafReuse(
      file,
      "Could not open child note",
    );
  }

  async yankActiveFilePath(kind) {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return false;
    }

    const label = YANK_PATH_NOTICE_LABELS[kind] || "path";
    const result = this.getActiveFileYankPath(kind, file);
    if (!result.ok) {
      new Notice(result.message);
      return false;
    }

    return this.writeTextToClipboard(result.text, label);
  }

  getActiveFileYankPath(kind, file) {
    const relativePath = getVaultRelativeFilePath(file);
    if (!relativePath) {
      return {
        ok: false,
        message: "No active markdown file",
      };
    }

    const needsBasePath = kind === "absolute" || kind === "absolute-tilde";
    const basePath = needsBasePath ? this.getVaultBasePath() : "";
    if (needsBasePath && !basePath) {
      return {
        ok: false,
        message: "Absolute paths are unavailable in this Obsidian runtime",
      };
    }

    const text = getYankPathText(
      kind,
      relativePath,
      basePath,
      getHomeDirectoryPath(),
    );
    if (text === null) {
      return {
        ok: false,
        message: "Unknown path yank command",
      };
    }

    return {
      ok: true,
      text,
    };
  }

  getVaultBasePath() {
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (!adapter || typeof adapter.getBasePath !== "function") {
      return "";
    }

    try {
      return normalizeFilesystemPath(adapter.getBasePath());
    } catch (error) {
      return "";
    }
  }

  async writeTextToClipboard(text, label) {
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      new Notice("Clipboard is unavailable");
      return false;
    }

    try {
      await clipboard.writeText(text);
      new Notice(`Copied ${label}`);
      return true;
    } catch (error) {
      new Notice(`Could not copy ${label}`);
      return false;
    }
  }

  handleVimLineLinkAction(cm, actionArgs, direction, defaultOffset) {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file) {
      return false;
    }

    const targetLine = getVimOffsetTargetLine(
      cm,
      actionArgs,
      direction,
      defaultOffset,
    );
    if (targetLine === null) {
      return false;
    }

    const lineText = getEditorLineText(cm, targetLine);
    if (lineText === null) {
      return false;
    }

    const candidates = this.collectLineLinkCandidates(lineText, view.file.path);
    if (candidates.length === 0) {
      return false;
    }

    if (candidates.length === 1) {
      this.openOrCreateLinkCandidate(candidates[0]).catch(() => {
        new Notice("Could not open link target");
      });
      return true;
    }

    new LinkCandidatePickerModal(this.app, this, candidates, targetLine).open();
    return true;
  }

  handleVimEnterLinkAction(cm, actionArgs) {
    return this.handleVimLineLinkAction(cm, actionArgs, 1, 0);
  }

  handleVimBackspaceLinkAction(cm, actionArgs) {
    return this.handleVimLineLinkAction(cm, actionArgs, -1, -1);
  }

  collectLineLinkCandidates(lineText, sourcePath) {
    const candidates = this.extractLineLinks(lineText)
      .map((link, index) => this.toLineLinkCandidate(link, sourcePath, index))
      .filter(Boolean);

    return this.dedupeLineLinkCandidates(candidates);
  }

  extractLineLinks(lineText) {
    const line = String(lineText || "");
    const links = [];
    let index = 0;

    while (index < line.length) {
      const wikiIndex = line.indexOf("[[", index);
      const markdownIndex = this.findNextMarkdownLinkStart(line, index);
      const nextIndex = this.minPositiveIndex(wikiIndex, markdownIndex);

      if (nextIndex === -1) {
        break;
      }

      const link =
        nextIndex === wikiIndex
          ? this.parseWikiLinkAt(line, nextIndex, { allowTransclusion: true })
          : this.parseMarkdownLinkAt(line, nextIndex);

      if (!link) {
        index = nextIndex + 1;
        continue;
      }

      links.push(link);
      index = link.endIndex;
    }

    return links;
  }

  toLineLinkCandidate(link, sourcePath, index) {
    const target = this.normalizeLinkTarget(link && link.target);
    if (!target || isExternalLinkTarget(target)) {
      return null;
    }

    const resolvedFile = this.resolveLinkTargetFile(target, sourcePath);
    if (resolvedFile) {
      if (!this.isMarkdownFile(resolvedFile)) {
        return null;
      }

      return {
        actionKind: "open",
        actionLabel: "Open",
        index,
        label: this.getCandidateLabel(link, target, resolvedFile, null),
        path: resolvedFile.path,
        resolvedFile,
        sourcePath,
        subpath: getLinkSubpath(target),
        target,
      };
    }

    const creation = this.getCreationTargetForLinkTarget(target);
    if (!creation) {
      return null;
    }

    return {
      actionKind: "create",
      actionLabel: "Create",
      creation,
      index,
      label: this.getCandidateLabel(link, target, null, creation),
      path: creation.path,
      resolvedFile: null,
      sourcePath,
      subpath: getLinkSubpath(target),
      target,
    };
  }

  getCandidateLabel(link, target, resolvedFile, creation) {
    const renderedText = this.normalizeText(link && link.renderedText);
    if (renderedText) {
      return renderedText;
    }

    if (resolvedFile && resolvedFile.basename) {
      return resolvedFile.basename;
    }

    if (creation && creation.basename) {
      return creation.basename;
    }

    return this.basenameForRenderedWikiLink(target);
  }

  dedupeLineLinkCandidates(candidates) {
    const seenKeys = new Set();
    const uniqueCandidates = [];

    for (const candidate of candidates) {
      const key = this.getCandidateDedupeKey(candidate);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      uniqueCandidates.push(candidate);
    }

    return uniqueCandidates;
  }

  getCandidateDedupeKey(candidate) {
    if (candidate.actionKind === "open" && candidate.resolvedFile) {
      const linkText = this.stripMarkdownExtension(
        this.normalizeLinkTarget(candidate.target),
      );
      return `open:${candidate.resolvedFile.path}:${linkText}`;
    }

    if (candidate.actionKind === "create" && candidate.creation) {
      return `create:${candidate.creation.path}`;
    }

    return `${candidate.actionKind}:${candidate.target}`;
  }

  async openOrCreateLinkCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    this.captureActiveFilePosition();

    if (candidate.resolvedFile) {
      return this.openResolvedLink(
        candidate.target,
        candidate.sourcePath,
        "Link target not found",
      );
    }

    return this.createNoteFromLinkCandidate(candidate);
  }

  async createNoteFromLinkCandidate(candidate) {
    const creation =
      candidate.creation ||
      this.getCreationTargetForLinkTarget(candidate.target);
    if (!creation) {
      new Notice("Unsafe note target");
      return false;
    }

    const existingFile = this.app.vault.getAbstractFileByPath(creation.path);
    if (this.isMarkdownFile(existingFile)) {
      return this.openMarkdownFileWithLeafReuse(
        existingFile,
        "Could not open note",
      );
    }

    const templaterPlugin = this.getTemplaterPlugin();
    if (!templaterPlugin) {
      new Notice("Templater is not available");
      return false;
    }

    const templateSelection = getNoteTemplateForCreationPath(creation.path);
    const templateFile = this.getNoteTemplateFile(
      templateSelection.templatePath,
    );
    if (!templateFile) {
      new Notice(templateSelection.missingTemplateNotice);
      return false;
    }

    const folder = await this.ensureVaultFolder(creation.folderPath);
    if (folder === null) {
      return false;
    }

    try {
      const createdFile =
        await templaterPlugin.templater.create_new_note_from_template(
          templateFile,
          folder,
          creation.basename,
          true,
        );
      const createdIsMarkdown = this.isMarkdownFile(createdFile);
      if (createdIsMarkdown) {
        this.showCreatedNoteNotice(createdFile, creation.path);
      }
      return createdIsMarkdown;
    } catch (error) {
      new Notice("Could not create note from template");
      return false;
    }
  }

  async createProjectNote() {
    const creatingFile = this.app.workspace.getActiveFile();
    if (!this.isMarkdownFile(creatingFile)) {
      new Notice("Open an area or project note before creating a project");
      return false;
    }

    if (!this.isAreaOrProjectNote(creatingFile)) {
      new Notice(
        "Project notes can only be created from an area or project note",
      );
      return false;
    }

    const createdFile = await this.createProjectNoteFile(creatingFile);
    if (!createdFile) {
      return false;
    }

    this.showCreatedNoteNotice(createdFile, createdFile.path);
    return true;
  }

  async createProjectNoteFromTask(editor, view) {
    const sourceFile = view && view.file;
    if (!editor || !this.isMarkdownFile(sourceFile)) {
      new Notice(
        "Open an area or project note before creating a project from a task",
      );
      return false;
    }

    if (!this.isAreaOrProjectNote(sourceFile)) {
      new Notice(
        "Project notes can only be created from an area or project note",
      );
      return false;
    }

    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on an open #task checkbox");
      return false;
    }

    const lineText = getEditorLineText(editor, cursor.line);
    if (lineText === null) {
      new Notice("Place the cursor on an open #task checkbox");
      return false;
    }

    const parsedTask = parseProjectSourceTaskLine(lineText);
    if (!parsedTask) {
      new Notice(getProjectSourceTaskLineNoticeText(lineText));
      return false;
    }

    if (!this.app.vault || typeof this.app.vault.process !== "function") {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    const sourceBlock = getProjectSourceTaskBlock(
      editor,
      cursor.line,
      lineText,
    ) || {
      startLine: cursor.line,
      endLineExclusive: cursor.line + 1,
      lines: [lineText],
      childLines: [],
    };

    const createdDate = formatProjectTaskCreatedDate(new Date());
    let convertedChildTaskLines = [];
    let childConversionLossy = false;
    const hasChildContent = sourceBlock.childLines.some(
      (line) => String(line || "").trim() !== "",
    );
    if (hasChildContent) {
      const conversion = buildProjectTasksFromChildBullets(
        sourceBlock.childLines,
        createdDate,
      );
      if (conversion.lossless && conversion.taskLines.length > 0) {
        convertedChildTaskLines = conversion.taskLines;
      } else {
        childConversionLossy = true;
      }
    }

    const sourceBasename =
      sourceFile.basename ||
      getVaultPathBasenameWithoutExtension(sourceFile.path);
    let projectBasename = null;
    let blockIdBacklinkRewrites = [];
    if (parsedTask.blockId) {
      projectBasename = getProjectBasenameFromTaskBlockId(
        sourceBasename,
        parsedTask.blockId,
      );
      if (!projectBasename) {
        new Notice("Could not derive project note name from task block ID");
        return false;
      }

      if (this.projectNoteBasenameExists(projectBasename, sourceFile)) {
        new Notice(`Note "${projectBasename}" already exists; rename it first`);
        return false;
      }

      blockIdBacklinkRewrites = this.getProjectTaskBlockIdBacklinkRewrites(
        sourceFile,
        parsedTask.blockId,
      );
    }

    if (!view || typeof view.save !== "function") {
      new Notice("Could not save source note");
      return false;
    }

    try {
      await view.save();
    } catch (error) {
      new Notice("Could not save source note");
      return false;
    }

    const createdFile = await this.createProjectNoteFile(
      sourceFile,
      projectBasename || undefined,
    );
    if (!createdFile) {
      return false;
    }

    let seedResult = null;
    try {
      await this.app.vault.process(createdFile, (content) => {
        seedResult = buildProjectContentFromTask(content, parsedTask, {
          childTaskLines: convertedChildTaskLines,
        });
        return seedResult.content;
      });
    } catch (error) {
      new Notice("Could not seed project task");
      return false;
    }

    if (!seedResult || !seedResult.seeded) {
      new Notice("Project task placeholder not found; source task was kept");
      return true;
    }

    if (convertedChildTaskLines.length > 0 && !seedResult.tasksInserted) {
      new Notice(
        "Created project, but the Tasks section was missing; source task was kept",
      );
      return true;
    }

    if (childConversionLossy) {
      new Notice(
        "Created project, but child bullets could not be converted; source task was kept",
      );
      return true;
    }

    let updatedLinkCount = 0;
    if (parsedTask.blockId && blockIdBacklinkRewrites.length > 0) {
      const rewriteResult = await this.applyBlockIdLinkRewrites(
        blockIdBacklinkRewrites,
        createdFile.basename,
      );
      updatedLinkCount = rewriteResult.updatedLinkCount;
      if (rewriteResult.failed) {
        const linkText =
          rewriteResult.failedLinkCount === 1 ? "link" : "links";
        new Notice(
          `Created project, but ${rewriteResult.failedLinkCount} block ${linkText} could not be updated; source task was kept`,
        );
        return true;
      }
    }

    let removedSourceTask = false;
    try {
      await this.app.vault.process(sourceFile, (content) => {
        const result = removeTaskBlockFromContent(content, sourceBlock);
        removedSourceTask = result.removed;
        return result.content;
      });
    } catch (error) {
      new Notice("Created project, but could not remove the source task");
      return true;
    }

    if (!removedSourceTask) {
      new Notice(
        "Created project, but the source task changed and was not removed",
      );
      return true;
    }

    new Notice(
      getProjectFromTaskNoticeText(
        parsedTask.description,
        sourceBasename,
        projectBasename ? createdFile.basename : undefined,
        updatedLinkCount,
      ),
    );
    return true;
  }

  async createProjectNoteFile(creatingFile, basename) {
    const templaterPlugin = this.getTemplaterPlugin();
    if (!templaterPlugin) {
      new Notice("Templater is not available");
      return null;
    }

    const templateFile = this.getNoteTemplateFile(PROJECT_TEMPLATE_PATH);
    if (!templateFile) {
      new Notice("Project note template not found");
      return null;
    }

    const resolvedBasename =
      basename === undefined ||
      basename === null ||
      String(basename).trim() === ""
        ? this.getDefaultProjectNoteBasename(creatingFile)
        : basename;
    if (!resolvedBasename) {
      new Notice("Could not derive project note name");
      return null;
    }

    const folder =
      typeof this.app.vault.getRoot === "function"
        ? this.app.vault.getRoot()
        : "";

    let createdFile = null;
    try {
      createdFile =
        await templaterPlugin.templater.create_new_note_from_template(
          templateFile,
          folder,
          resolvedBasename,
          true,
        );
    } catch (error) {
      new Notice("Could not create project note");
      return null;
    }

    if (!this.isMarkdownFile(createdFile)) {
      new Notice("Could not create project note");
      return null;
    }

    const parentLink = this.getFrontmatterWikiLinkToFile(creatingFile);
    try {
      await this.app.fileManager.processFrontMatter(
        createdFile,
        (frontmatter) => {
          frontmatter.parent = parentLink;
          frontmatter.type = "[[project]]";
          frontmatter.status = "wip";
        },
      );
    } catch (error) {
      new Notice("Could not set project parent");
      return null;
    }

    return createdFile;
  }

  getRootMarkdownBasenames() {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return null;
    }

    let markdownFiles;
    try {
      markdownFiles = vault.getMarkdownFiles();
    } catch (error) {
      return null;
    }

    if (!Array.isArray(markdownFiles)) {
      return null;
    }

    const basenames = new Set();
    for (const file of markdownFiles) {
      const path = getVaultRelativeFilePath(file);
      if (!path || path.includes("/") || !this.isMarkdownFile(file)) {
        continue;
      }

      const basename =
        typeof file.basename === "string" && file.basename
          ? file.basename
          : getVaultPathBasenameWithoutExtension(path);
      if (basename) {
        basenames.add(basename);
      }
    }

    return basenames;
  }

  getDefaultProjectNoteBasename(creatingFile) {
    const sourceBasename =
      creatingFile &&
      typeof creatingFile.basename === "string" &&
      creatingFile.basename
        ? creatingFile.basename
        : getVaultPathBasenameWithoutExtension(
            creatingFile && creatingFile.path,
          );
    const rootBasenames = this.getRootMarkdownBasenames();
    if (!rootBasenames) {
      return null;
    }

    return getNextDefaultProjectBasename(sourceBasename, rootBasenames);
  }

  projectNoteBasenameExists(basename, sourceFile) {
    const targetBasename = String(basename || "").trim();
    if (!targetBasename) {
      return false;
    }

    const metadataCache = this.app.metadataCache;
    if (
      metadataCache &&
      typeof metadataCache.getFirstLinkpathDest === "function"
    ) {
      try {
        const existingFile = metadataCache.getFirstLinkpathDest(
          targetBasename,
          (sourceFile && sourceFile.path) || "",
        );
        if (this.isMarkdownFile(existingFile)) {
          return true;
        }
      } catch (error) {
        // Fall back to a direct root-path check below.
      }
    }

    if (
      !this.app.vault ||
      typeof this.app.vault.getAbstractFileByPath !== "function"
    ) {
      return false;
    }

    return this.isMarkdownFile(
      this.app.vault.getAbstractFileByPath(`${targetBasename}.md`),
    );
  }

  getProjectTaskBlockIdBacklinkRewrites(file, blockId) {
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return [];
    }

    try {
      const backlinks = metadataCache.getBacklinksForFile(file);
      return collectBlockIdBacklinkRewrites(
        backlinks && backlinks.data,
        blockId,
      );
    } catch (error) {
      return [];
    }
  }

  async applyBlockIdLinkRewrites(rewrites, newBasename) {
    let updatedLinkCount = 0;
    let failedLinkCount = 0;
    const vault = this.app.vault;

    for (const rewrite of Array.isArray(rewrites) ? rewrites : []) {
      const originals = Array.isArray(rewrite && rewrite.originals)
        ? rewrite.originals
        : [];
      const file =
        vault &&
        typeof vault.getAbstractFileByPath === "function" &&
        rewrite &&
        rewrite.path
          ? vault.getAbstractFileByPath(rewrite.path)
          : null;
      if (!this.isMarkdownFile(file)) {
        failedLinkCount += originals.length || 1;
        continue;
      }

      const replacements = [];
      originals.forEach((original) => {
        const replacement = rewriteBlockIdLinkOriginal(original, newBasename);
        if (!replacement) {
          failedLinkCount += 1;
          return;
        }

        replacements.push({
          original,
          replacement,
        });
      });

      if (replacements.length === 0) {
        continue;
      }

      let missing = [];
      try {
        await vault.process(file, (content) => {
          const result = replaceLinkOriginalsInContent(content, replacements);
          missing = result.missing;
          return result.content;
        });
      } catch (error) {
        failedLinkCount += replacements.length;
        continue;
      }

      updatedLinkCount += replacements.length - missing.length;
      failedLinkCount += missing.length;
    }

    return Object.freeze({
      updatedLinkCount,
      failedLinkCount,
      failed: failedLinkCount > 0,
    });
  }

  showCreatedNoteNotice(file, fallbackPath) {
    new Notice(getCreatedNoteNoticeText(file, fallbackPath));
  }

  getTemplaterPlugin() {
    const plugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["templater-obsidian"];
    return plugin &&
      plugin.templater &&
      typeof plugin.templater.create_new_note_from_template === "function"
      ? plugin
      : null;
  }

  getNoteTemplateFile(templatePath) {
    const file = this.app.vault.getAbstractFileByPath(templatePath);
    return this.isMarkdownFile(file) ? file : null;
  }

  getCreationTargetForLinkTarget(linkTarget) {
    const linkText = this.normalizeLinkTarget(linkTarget);
    if (!linkText || isExternalLinkTarget(linkText)) {
      return null;
    }

    const pathPart = normalizeVaultRelativePath(
      this.stripLinkSubpath(linkText),
    );
    if (
      isUnsafeVaultPath(pathPart) ||
      isExternalLinkTarget(pathPart) ||
      hasNonMarkdownExtension(pathPart)
    ) {
      return null;
    }

    const path = MARKDOWN_EXTENSION_RE.test(pathPart)
      ? pathPart
      : `${pathPart}.md`;
    if (isUnsafeVaultPath(path)) {
      return null;
    }

    const { folderPath, basename } = splitVaultPath(path);
    if (!basename) {
      return null;
    }

    return { basename, folderPath, path };
  }

  async ensureVaultFolder(folderPath) {
    if (!folderPath) {
      return typeof this.app.vault.getRoot === "function"
        ? this.app.vault.getRoot()
        : "";
    }

    if (isUnsafeVaultPath(folderPath)) {
      new Notice("Unsafe note folder");
      return null;
    }

    const segments = folderPath.split("/");
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (existing) {
        if (!this.isVaultFolder(existing)) {
          new Notice("Cannot create note folder");
          return null;
        }
        continue;
      }

      if (typeof this.app.vault.createFolder !== "function") {
        new Notice("Cannot create note folder");
        return null;
      }

      try {
        await this.app.vault.createFolder(currentPath);
      } catch (error) {
        const created = this.app.vault.getAbstractFileByPath(currentPath);
        if (!this.isVaultFolder(created)) {
          new Notice("Cannot create note folder");
          return null;
        }
      }
    }

    return this.app.vault.getAbstractFileByPath(folderPath) || folderPath;
  }

  async openFrontmatterLink(fieldName, missingMessage, notFoundMessage) {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const link = this.getFrontmatterLink(frontmatter, fieldName);
    if (!link) {
      new Notice(missingMessage);
      return;
    }

    await this.openOrCreateLinkTarget(link, file.path, notFoundMessage, link);
  }

  async openLabeledBodyLink(label) {
    const context = await this.getActiveMarkdownContext();
    if (!context) {
      return;
    }

    const link = this.findFirstRenderedLink(context.content, label);
    if (!link) {
      new Notice(`No ${label} link found`);
      return;
    }

    await this.openOrCreateLinkTarget(
      link.target,
      context.file.path,
      `${this.capitalize(label)} note not found`,
      link.renderedText,
    );
  }

  async openOrCreateLinkTarget(
    linkTarget,
    sourcePath,
    notFoundMessage,
    renderedText,
  ) {
    const candidate = this.toLineLinkCandidate(
      { target: linkTarget, renderedText },
      sourcePath,
      0,
    );

    if (!candidate) {
      new Notice(notFoundMessage);
      return false;
    }

    return this.openOrCreateLinkCandidate(candidate);
  }

  async openAlternateFile() {
    if (!this.alternateFilePath) {
      new Notice("No alternate file");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.alternateFilePath);
    if (!this.isMarkdownFile(file)) {
      new Notice("Alternate file not found");
      return;
    }

    this.captureActiveFilePosition();
    const restorePosition = normalizePosition(this.filePositions.get(file.path));
    const opened = await this.openMarkdownFileWithLeafReuse(
      file,
      "Could not open alternate file",
    );
    if (opened) {
      this.restoreFilePosition(file.path, restorePosition);
    }
    return opened;
  }

  async deleteCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const path = file.path;
    try {
      await this.app.fileManager.trashFile(file);
      new Notice(getDeletedFileNoticeText(path));
    } catch (error) {
      new Notice(path ? `Could not delete "${path}"` : "Could not delete file");
    }
  }

  openRenameCurrentFileModal() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    new RenameCurrentFileModal(this.app, this, file).open();
  }

  async renameCurrentFileToName(input) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return false;
    }

    const oldPath = normalizeVaultRelativePath(file.path);
    const target = getRenameTargetPath(oldPath, input);
    if (!target.ok) {
      new Notice(target.message);
      return false;
    }

    const existingFile = this.app.vault.getAbstractFileByPath(target.path);
    if (existingFile) {
      new Notice(`File already exists: ${target.path}`);
      return false;
    }

    const fileManager = this.app.fileManager;
    if (!fileManager || typeof fileManager.renameFile !== "function") {
      new Notice(`Could not rename "${oldPath}"`);
      return false;
    }

    const audit = this.collectInboundLinkRenameSummary(file);

    try {
      await fileManager.renameFile(file, target.path);
      new Notice(getRenamedFileNoticeText(oldPath, target.path, audit), 8000);
      return true;
    } catch (error) {
      new Notice(`Could not rename "${oldPath}"`);
      return false;
    }
  }

  collectInboundLinkRenameSummary(file) {
    const metadataCache = this.app && this.app.metadataCache;
    const vault = this.app && this.app.vault;
    if (
      !file ||
      !file.path ||
      !metadataCache ||
      typeof metadataCache.getFileCache !== "function" ||
      typeof metadataCache.getFirstLinkpathDest !== "function" ||
      !vault ||
      typeof vault.getMarkdownFiles !== "function"
    ) {
      return createRenameLinkAudit(true);
    }

    const targetPath = normalizeVaultRelativePath(file.path);
    const summary = createRenameLinkAudit();

    try {
      vault.getMarkdownFiles().forEach((sourceFile) => {
        if (!sourceFile || !sourceFile.path) {
          return;
        }

        const sourcePath = normalizeVaultRelativePath(sourceFile.path);
        const cache = metadataCache.getFileCache(sourceFile);
        this.countCachedRenameReferences(
          cache,
          "links",
          "bodyLinks",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "embeds",
          "embeds",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "frontmatterLinks",
          "frontmatterLinks",
          sourcePath,
          targetPath,
          summary,
        );
        this.countCachedRenameReferences(
          cache,
          "referenceLinks",
          "referenceLinks",
          sourcePath,
          targetPath,
          summary,
        );
      });
    } catch (error) {
      return createRenameLinkAudit(true);
    }

    summary.sourceFileCount = summary.sourceFilePaths.size;
    return summary;
  }

  countCachedRenameReferences(
    cache,
    cacheKey,
    summaryKey,
    sourcePath,
    targetPath,
    summary,
  ) {
    getCachedReferenceItems(cache, cacheKey).forEach((reference) => {
      if (
        !this.cachedRenameReferencePointsToFile(
          reference,
          sourcePath,
          targetPath,
        )
      ) {
        return;
      }

      summary[summaryKey] += 1;
      summary.totalLinks += 1;
      summary.sourceFilePaths.add(sourcePath);
    });
  }

  cachedRenameReferencePointsToFile(reference, sourcePath, targetPath) {
    const link = this.normalizeLinkTarget(getCachedReferenceLinkText(reference));
    if (!link || isExternalLinkTarget(link)) {
      return false;
    }

    const linkText = this.stripMarkdownExtension(link);
    const lookupText = this.stripLinkSubpath(linkText);
    if (!lookupText) {
      return false;
    }

    const resolvedFile = this.resolveLinkTargetFile(linkText, sourcePath);
    return (
      resolvedFile &&
      normalizeVaultRelativePath(resolvedFile.path) === targetPath
    );
  }

  trackOpenedFile(file) {
    if (!this.isMarkdownFile(file)) {
      return;
    }

    if (file.path === this.currentFilePath) {
      return;
    }

    if (this.currentFilePath) {
      this.alternateFilePath = this.currentFilePath;
    }
    this.currentFilePath = file.path;
  }

  trackSelectionUpdate(update) {
    if (!update || (!update.selectionSet && !update.docChanged)) {
      return;
    }

    const view = this.getActiveMarkdownView();
    if (!view || !view.file || !view.editor) {
      return;
    }

    if (update.view && view.editor.cm && view.editor.cm !== update.view) {
      return;
    }

    this.saveFilePosition(view.file.path, positionFromCodeMirrorUpdate(update));
  }

  getActiveMarkdownFile() {
    const file = this.app.workspace.getActiveFile();
    if (!this.isMarkdownFile(file)) {
      new Notice("No active markdown file");
      return null;
    }

    return file;
  }

  getActiveMarkdownView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || !this.isMarkdownFile(view.file) || !view.editor) {
      return null;
    }

    return view;
  }

  captureActiveFilePosition() {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      !view.editor ||
      typeof view.editor.getCursor !== "function"
    ) {
      return false;
    }

    return this.saveFilePosition(view.file.path, view.editor.getCursor());
  }

  saveFilePosition(filePath, position) {
    if (!filePath) {
      return false;
    }

    const normalized = normalizePosition(position);
    if (!normalized) {
      return false;
    }

    this.filePositions.set(filePath, normalized);
    return true;
  }

  restoreFilePosition(filePath, position) {
    const normalized = normalizePosition(position);
    if (!normalized) {
      return false;
    }

    if (this.restoreActiveFilePosition(filePath, normalized)) {
      return true;
    }

    this.deferRestoreFilePosition(filePath, normalized);
    return false;
  }

  restoreActiveFilePosition(filePath, position) {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file || view.file.path !== filePath || !view.editor) {
      return false;
    }

    const target = clampPositionToEditor(view.editor, position);
    if (!target || !setEditorCursor(view.editor, target)) {
      return false;
    }

    this.saveFilePosition(filePath, target);
    return true;
  }

  deferRestoreFilePosition(filePath, position) {
    this.cancelPendingRestore();

    this.pendingRestoreDeferred = deferToNextFrame(() => {
      this.pendingRestoreDeferred = null;
      this.restoreActiveFilePosition(filePath, position);
    });
  }

  cancelPendingRestore() {
    cancelDeferred(this.pendingRestoreDeferred);
    this.pendingRestoreDeferred = null;
  }

  async getActiveMarkdownContext() {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      return null;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      view &&
      view.file &&
      view.file.path === file.path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      return { file, content: view.editor.getValue() };
    }

    return { file, content: await this.app.vault.cachedRead(file) };
  }

  isMarkdownFile(file) {
    return !!file && file.extension === "md";
  }

  isVaultFolder(file) {
    const TFolder = obsidian && obsidian.TFolder;
    return !!(
      file &&
      ((typeof TFolder === "function" && file instanceof TFolder) ||
        (file.children && !file.extension))
    );
  }

  getFrontmatterLink(frontmatter, fieldName) {
    const links = this.getFrontmatterLinks(frontmatter, fieldName);
    return links.length === 0 ? null : links[0];
  }

  getFrontmatterLinks(frontmatter, fieldName) {
    if (
      !frontmatter ||
      !Object.prototype.hasOwnProperty.call(frontmatter, fieldName)
    ) {
      return [];
    }

    const fieldValue = frontmatter[fieldName];
    const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    const links = [];

    for (const value of values) {
      const link = this.extractLinkTarget(value);
      if (link) {
        links.push(link);
      }
    }

    return links;
  }

  isAreaOrProjectNote(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.getFrontmatterLinks(frontmatter, "type").some((link) =>
      this.isAreaOrProjectTypeLink(link, file.path),
    );
  }

  isAreaOrProjectTypeLink(link, sourcePath) {
    const resolvedFile = this.resolveLinkTargetFile(link, sourcePath);
    const basename =
      resolvedFile && resolvedFile.basename
        ? resolvedFile.basename
        : this.basenameForRenderedWikiLink(link);

    return PROJECT_PARENT_TYPE_BASENAMES.has(basename);
  }

  getFrontmatterWikiLinkToFile(file) {
    const target = this.stripMarkdownExtension(
      normalizeVaultRelativePath(file.path),
    );
    const basename = file.basename || this.basenameForRenderedWikiLink(target);
    return target === basename ? `[[${basename}]]` : `[[${target}|${basename}]]`;
  }

  frontmatterFieldPointsToFile(frontmatter, fieldName, targetFile, sourcePath) {
    if (!this.isMarkdownFile(targetFile)) {
      return false;
    }

    return this.getFrontmatterLinks(frontmatter, fieldName).some((link) => {
      const resolvedFile = this.resolveLinkTargetFile(link, sourcePath);
      return resolvedFile && resolvedFile.path === targetFile.path;
    });
  }

  extractLinkTarget(value) {
    const text = this.normalizeText(value);
    if (!text) {
      return null;
    }

    const wikiIndex = text.indexOf("[[");
    if (wikiIndex !== -1) {
      const wikiLink = this.parseWikiLinkAt(text, wikiIndex);
      if (wikiLink) {
        return wikiLink.target;
      }
    }

    const markdownIndex = this.findNextMarkdownLinkStart(text, 0);
    if (markdownIndex !== -1) {
      const markdownLink = this.parseMarkdownLinkAt(text, markdownIndex);
      if (markdownLink) {
        return markdownLink.target;
      }
    }

    return this.normalizeLinkTarget(text);
  }

  findFirstRenderedLink(content, expectedLabel) {
    const label = expectedLabel.trim();
    const lines = String(content).split(/\r?\n/);
    let lineIndex = 0;
    let inFrontmatter = false;
    let inFence = null;

    if (this.startsWithFrontmatter(lines)) {
      inFrontmatter = true;
      lineIndex = 1;
    }

    for (; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];

      if (inFrontmatter) {
        if (FRONTMATTER_DELIMITER_RE.test(line)) {
          inFrontmatter = false;
        }
        continue;
      }

      if (inFence) {
        if (this.isClosingFence(line, inFence)) {
          inFence = null;
        }
        continue;
      }

      const openingFence = this.getFenceOpening(line);
      if (openingFence) {
        inFence = openingFence;
        continue;
      }

      const link = this.findFirstRenderedLinkInLine(line, label);
      if (link) {
        return link;
      }
    }

    return null;
  }

  startsWithFrontmatter(lines) {
    return startsWithFrontmatter(lines);
  }

  findFirstRenderedLinkInLine(line, label) {
    let index = 0;

    while (index < line.length) {
      const wikiIndex = line.indexOf("[[", index);
      const markdownIndex = this.findNextMarkdownLinkStart(line, index);
      const nextIndex = this.minPositiveIndex(wikiIndex, markdownIndex);

      if (nextIndex === -1) {
        return null;
      }

      const link =
        nextIndex === wikiIndex
          ? this.parseWikiLinkAt(line, nextIndex)
          : this.parseMarkdownLinkAt(line, nextIndex);

      if (!link) {
        index = nextIndex + 1;
        continue;
      }

      if (link.renderedText.trim() === label) {
        return link;
      }

      index = link.endIndex;
    }

    return null;
  }

  minPositiveIndex(first, second) {
    if (first === -1) {
      return second;
    }
    if (second === -1) {
      return first;
    }
    return Math.min(first, second);
  }

  parseWikiLinkAt(line, startIndex, options = {}) {
    if (
      (line[startIndex - 1] === "!" && !options.allowTransclusion) ||
      !line.startsWith("[[", startIndex)
    ) {
      return null;
    }

    const endIndex = line.indexOf("]]", startIndex + 2);
    if (endIndex === -1) {
      return null;
    }

    const content = line.slice(startIndex + 2, endIndex);
    const aliasIndex = content.indexOf("|");
    const target = this.normalizeLinkTarget(
      aliasIndex === -1 ? content : content.slice(0, aliasIndex),
    );
    if (!target) {
      return null;
    }

    const renderedText =
      aliasIndex === -1
        ? this.basenameForRenderedWikiLink(target)
        : content.slice(aliasIndex + 1).trim();

    return {
      target,
      renderedText,
      endIndex: endIndex + 2,
    };
  }

  findNextMarkdownLinkStart(line, startIndex) {
    let index = startIndex;

    while (index < line.length) {
      index = line.indexOf("[", index);
      if (index === -1) {
        return -1;
      }

      if (
        line[index - 1] !== "!" &&
        line[index + 1] !== "[" &&
        line[index - 1] !== "["
      ) {
        return index;
      }

      index += 1;
    }

    return -1;
  }

  parseMarkdownLinkAt(line, startIndex) {
    if (line[startIndex - 1] === "!" || line[startIndex + 1] === "[") {
      return null;
    }

    const textEndIndex = this.findClosingBracket(line, startIndex);
    if (textEndIndex === -1 || line[textEndIndex + 1] !== "(") {
      return null;
    }

    const destinationStartIndex = textEndIndex + 2;
    const destinationEndIndex = this.findClosingParen(line, destinationStartIndex);
    if (destinationEndIndex === -1) {
      return null;
    }

    const target = this.extractMarkdownDestination(
      line.slice(destinationStartIndex, destinationEndIndex),
    );
    if (!target) {
      return null;
    }

    return {
      target,
      renderedText: line.slice(startIndex + 1, textEndIndex).trim(),
      endIndex: destinationEndIndex + 1,
    };
  }

  findClosingBracket(line, startIndex) {
    for (let index = startIndex + 1; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        continue;
      }

      if (line[index] === "]") {
        return index;
      }
    }

    return -1;
  }

  findClosingParen(line, startIndex) {
    let depth = 1;

    for (let index = startIndex; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        continue;
      }

      if (line[index] === "(") {
        depth += 1;
        continue;
      }

      if (line[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  extractMarkdownDestination(destination) {
    const text = destination.trim();
    if (!text) {
      return null;
    }

    if (text.startsWith("<")) {
      const endIndex = text.indexOf(">");
      return endIndex === -1
        ? null
        : this.normalizeLinkTarget(text.slice(1, endIndex));
    }

    const titleMatch = text.match(/^(\S+)\s+["'(].*["')]$/);
    return this.normalizeLinkTarget(titleMatch ? titleMatch[1] : text);
  }

  async openResolvedLink(linkTarget, sourcePath, notFoundMessage) {
    const linkText = this.stripMarkdownExtension(this.normalizeLinkTarget(linkTarget));
    const resolvedFile = this.resolveLinkTargetFile(linkTarget, sourcePath);

    if (!resolvedFile) {
      new Notice(notFoundMessage);
      return false;
    }

    try {
      const activeView = this.getActiveMarkdownView();
      const isActiveFile =
        activeView &&
        activeView.file &&
        activeView.file.path === resolvedFile.path;

      if (typeof this.app.workspace.openLinkText === "function") {
        if (!isActiveFile) {
          const existingLeaf = this.findMarkdownLeafByPath(resolvedFile.path);
          if (
            existingLeaf &&
            (await this.activateWorkspaceLeaf(existingLeaf))
          ) {
            if (this.stripLinkSubpath(linkText) !== linkText) {
              await this.app.workspace.openLinkText(
                linkText,
                sourcePath,
                false,
              );
            }
            return true;
          }
        }

        await this.app.workspace.openLinkText(linkText, sourcePath, false);
      } else {
        return this.openMarkdownFileWithLeafReuse(
          resolvedFile,
          "Could not open note",
        );
      }
      return true;
    } catch (error) {
      new Notice("Could not open note");
      return false;
    }
  }

  resolveLinkTargetFile(linkTarget, sourcePath) {
    const linkText = this.stripMarkdownExtension(this.normalizeLinkTarget(linkTarget));
    const lookupText = this.stripLinkSubpath(linkText);
    if (!lookupText) {
      // A pure `#heading`/`#^blockid` link points at the current note. Resolve
      // it to the source file so Enter jumps in-file (Obsidian's own click
      // behavior). Degenerate `#`/`#^` are rejected by isSubpathOnlyLink.
      if (sourcePath && isSubpathOnlyLink(linkText)) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        return this.isMarkdownFile(sourceFile) ? sourceFile : null;
      }

      return null;
    }

    return (
      this.app.metadataCache.getFirstLinkpathDest(lookupText, sourcePath) ||
      null
    );
  }

  normalizeText(value) {
    if (typeof value === "string") {
      return value.trim();
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim();
  }

  normalizeLinkTarget(value) {
    let target = this.normalizeText(value);
    if (!target) {
      return "";
    }

    target = this.stripWrappingQuotes(target);
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1).trim();
    }

    return this.safeDecodeUri(target);
  }

  stripWrappingQuotes(value) {
    if (value.length < 2) {
      return value;
    }

    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }

    return value;
  }

  safeDecodeUri(value) {
    try {
      return decodeURI(value);
    } catch (error) {
      return value;
    }
  }

  stripMarkdownExtension(linkText) {
    const subpathIndex = this.findSubpathIndex(linkText);
    const pathPart = subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
    const subpathPart = subpathIndex === -1 ? "" : linkText.slice(subpathIndex);

    return pathPart.replace(/\.md$/i, "") + subpathPart;
  }

  stripLinkSubpath(linkText) {
    const subpathIndex = this.findSubpathIndex(linkText);
    return subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
  }

  findSubpathIndex(linkText) {
    return findLinkSubpathIndex(linkText);
  }

  basenameForRenderedWikiLink(target) {
    const withoutSubpath = this.stripLinkSubpath(this.stripMarkdownExtension(target));
    const pathParts = withoutSubpath.split("/");
    return pathParts[pathParts.length - 1].trim();
  }

  getFenceOpening(line) {
    return getFenceOpening(line);
  }

  isClosingFence(line, openingFence) {
    return isClosingFence(line, openingFence);
  }

  capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
};

module.exports.helpers = {
  normalizePosition,
  clampPositionToEditor,
  positionFromCodeMirrorUpdate,
  positionFromTextOffset,
  normalizeVimRepeat,
  getVimRepeat,
  hasVimRepeat,
  getPendingVimRepeat,
  resetPendingVimInputState,
  getVimTargetOffset,
  getVimOffsetTargetLine,
  getVimEnterTargetLine,
  getVimBackspaceTargetLine,
  getEditorFirstLine,
  getEditorLastLine,
  getEditorLineText,
  isExternalLinkTarget,
  normalizeVaultRelativePath,
  isUnsafeVaultPath,
  hasNonMarkdownExtension,
  splitVaultPath,
  stripFinalExtension,
  getVaultRelativeFilePath,
  getVaultRelativeParentDirectory,
  getVaultPathBasename,
  getVaultPathBasenameWithoutExtension,
  normalizeFilesystemPath,
  joinFilesystemPath,
  compactHomePath,
  getYankPathText,
  getCreatedNoteNoticeText,
  getDeletedFileNoticeText,
  getFileRenameParts,
  normalizeRenameInput,
  getRenameTargetPath,
  getRenamedFileNoticeText,
  parseProjectSourceTaskLine,
  getProjectSourceTaskBlock,
  parseProjectChildListItem,
  buildProjectTaskLineFromChildBullet,
  buildProjectTasksFromChildBullets,
  formatProjectTaskCreatedDate,
  replaceProjectTasksPlaceholder,
  buildProjectContentFromTask,
  removeTaskBlockFromContent,
  getProjectBasenameFromTaskBlockId,
  getProjectBasenameSuffixForIndex,
  getNextDefaultProjectBasename,
  collectBlockIdBacklinkRewrites,
  rewriteBlockIdLinkOriginal,
  replaceLinkOriginalsInContent,
  getProjectFromTaskNoticeText,
  getNoteTemplateForCreationPath,
  findLinkSubpathIndex,
  getLinkSubpath,
  isSubpathOnlyLink,
  getSectionHeaderLines,
  getSectionHeaderJumpLine,
  isOpenObsidianTaskLine,
  isPomodorosHeading,
  isLevelTwoHeading,
  hasPomodoroTimeRange,
  isPomodoroNavigationTaskLine,
  getOpenObsidianTaskLines,
  getOpenTaskNavigationLines,
  getOpenObsidianTaskJumpLine,
  getDashTasksHeaderLine,
  openMarkdownFileWithLeafReuse,
  getEditorCursor,
  getEditorLine,
  scrollEditorLineToTop,
  scrollEditorLineToCenter,
  scheduleOpenTaskJumpCenter,
  scheduleDashTasksScrollAssert,
  replaceEditorLine,
  setEditorCursorSafely,
  findTransclusionToggleTargets,
  toggleLineTransclusions,
  toggleLineRangeTransclusions,
  adjustCursorChForTransclusionChanges,
  deferToNextFrame,
  cancelDeferred,
  getBulletPropertyConfigPath,
  loadBulletPropertyConfig,
  validateBulletPropertyConfig,
  isValidBulletPropertyName,
  isBulletLine,
  formatBulletPropertyField,
  parseBulletPropertyFields,
  findBulletPropertyField,
  getTrailingBlockIdSpan,
  getTrailingBlockId,
  createBulletPropertyItems,
  createBulletPropertyDateItems,
  parseBulletPropertyTypedDate,
  formatBulletPropertyDate,
  cleanTaskDisplayText,
  getOpenLocalTasks,
  getLocalTaskDependencyIdentifier,
  createBulletPropertyLocalTaskItems,
  blockIdExistsInContent,
  suggestBlockIdFromTask,
  validateBlockIdCandidate,
  appendBlockIdToLine,
  taskNeedsPromptedBlockId,
  applyPromptedBlockIdToTaskLine,
  resolveTargetTaskIdentity,
  parseLocalTaskIdList,
  getUniqueLocalTaskIdValues,
  upsertLocalTaskIdValue,
  applyLocalTaskDependencyListEdits,
  upsertBulletProperty,
  deleteBulletProperty,
  getBulletIndent,
  DEPENDENCY_NAVIGATION_LABEL,
  DEPENDENCY_NAVIGATION_EMOJI,
  DEPENDENCY_NAVIGATION_SEPARATOR,
  LEGACY_DEPENDENCY_NAVIGATION_LABELS,
  formatDependencyNavigationBullet,
  formatDependencyNavigationBulletFromDetails,
  getDependencyNavigationBlockIds,
  parseDependencyNavigationBullet,
  parseDependencyNavigationBulletDetails,
  findCurrentBulletChildBlock,
  getDependencyChildIndent,
  collectDependencyNavigationBullets,
  computeFinalDependencyLinkOrder,
  planDependencyNavigationBulletSync,
  planDependencyNavigationBulletInsertion,
  planDependencyNavigationBulletRemoval,
  planDependencyNavigationLabelNormalizations,
  normalizeDependencyNavigationLabels,
  buildLocalTaskDependencyNotice,
  buildMultiDependencyNotice,
  insertEditorLine,
  deleteEditorLine,
};
