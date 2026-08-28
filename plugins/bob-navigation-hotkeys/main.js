const obsidian = require("obsidian");
const { MarkdownView, Modal, Notice, Plugin, parseYaml } = obsidian;
const { EditorView } = require("@codemirror/view");

const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const SECTION_HEADER_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
// Broadly open `#task` statuses, including Blocked (`?`) for dependency,
// scheduling, task-moving, and related non-navigation workflows.
const OPEN_OBSIDIAN_TASK_STATUSES = new Set([" ", "/", "*", "?"]);
// Ctrl+Shift+J/K proper-task jump targets: Ready (`[ ]`), In Progress (`[/]`),
// and Next (`[*]`). Blocked (`[?]`) stays open for the workflows above but is
// never a navigation target.
const ACTIVE_OBSIDIAN_TASK_NAVIGATION_STATUSES = new Set([" ", "/", "*"]);
const OBSIDIAN_TASK_STATUS_RANKS = Object.freeze({
  " ": 0,
  "*": 1,
  "/": 2,
});
const TASKS_SETTINGS_PATH =
  ".obsidian/plugins/obsidian-tasks-plugin/data.json";
const TASK_STATUS_OPEN_TYPES = new Set(["TODO", "IN_PROGRESS", "ON_HOLD"]);
const TASK_STATUS_CLOSED_TYPES = new Set([
  "DONE",
  "CANCELLED",
  "NON_TASK",
  "EMPTY",
]);
const CONVENTIONAL_TASK_STATUS_TYPES = Object.freeze({
  " ": "TODO",
  x: "DONE",
  X: "DONE",
  "/": "IN_PROGRESS",
  "*": "ON_HOLD",
  "-": "CANCELLED",
});
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
// Named Pomodoros: a ledger entry's parenthetical body may be followed by an
// em dash and an ALL-CAPS name (e.g. `() — BODY`). The tail is matched only
// against the text after the parenthetical's closing `)`, so an em dash
// embedded in `[t:: ]` metadata is never mistaken for the name separator.
const POMODORO_NAME_SEPARATOR = "—";
const POMODORO_NAME_MAX_LENGTH = 48;
const POMODORO_NAME_TAIL_RE = /^[ \t]*—[ \t]*(.*)$/;
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
const PROJECT_OPEN_TASK_STATUSES = new Set([" ", "/", "*"]);
const PROJECT_LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const PROJECT_SOURCE_TASK_LINE_RE =
  /^(\s*)(?:[-*+]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
const PROJECT_TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/;
const PROJECT_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/g;
const PROJECT_LIFECYCLE_TAG_GLOBAL_RE =
  /(^|[\s([{])#(?:prj|hide)(?=$|[\s)\]},.;:!?])/g;
const PROJECT_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PROJECT_TASKS_HEADER = "## Tasks";
const PROJECT_TASKS_PLACEHOLDER = "(REPLACE WITH TASK DESCRIPTION)";
// Whitelist for an ALL-CAPS project-note section title: uppercase letters,
// digits, spaces/tabs, and a small set of punctuation. Deliberately narrow so
// Markdown constructs (wikilinks, tags, block IDs, inline code, snake_case)
// are never mistaken for a section title.
const PROJECT_SECTION_TITLE_RE = /^[A-Z0-9][A-Z0-9 \t&'(),./-]*$/;
// Any unfenced level-two (`##`) heading, capturing its title text.
const PROJECT_SECTION_HEADER_RE = /^ {0,3}##(?:[ \t]+(.*))?$/;
// A level-one or level-two heading, used to bound a project section's body.
const PROJECT_SECTION_BOUNDARY_HEADER_RE = /^ {0,3}#{1,2}(?:[ \t]|$)/;
const TASK_MOVE_OPEN_PROJECT_STATUSES = new Set(["wip", "waiting"]);
const TASK_MOVE_TEMPLATE_PATHS = new Set([
  ...Object.values(NOTE_TEMPLATE_PATHS),
  PROJECT_TEMPLATE_PATH,
]);
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
const TASK_MOVE_DESTINATION_JUMP_RETRIES = 8;
const DASH_TASKS_SCROLL_ASSERT_FRAMES = 8;
const DASH_LOCATION_RESTORE_RETRIES = 24;
const DASH_LOCATION_RESTORE_ASSERT_FRAMES = 8;
const DASH_RENDERED_TASKS_QUERY_RESULT_SELECTOR =
  "ul.plugin-tasks-query-result";
const DASH_RENDERED_TASKS_BLOCK_SELECTOR = ".block-language-tasks";
const DASH_RENDERED_TASKS_SCROLL_PADDING_PX = 8;
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
const BULLET_PROPERTY_LIST_ITEM_RE =
  /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/;
const PROJECT_NOTE_PROPERTY_TARGETS = Object.freeze({
  scheduled: Object.freeze({
    kind: "project-frontmatter",
    frontmatterKey: "scheduled",
  }),
});
const PROJECT_HIDE_TAG = "#hide";
// Legacy dependency-navigation bullets are still recognized so they can be
// migrated to one transcluded block link per dependency. New bullets use the
// canonical shape `\t- ![[#^block-id]]` (or a cross-note target before `#`).
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
  `^(?<indent>\\s*(?:>\\s*)*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?<emoji>${DEPENDENCY_NAVIGATION_EMOJI}[ \\t]+)?\\*\\*(?<label>${[
    DEPENDENCY_NAVIGATION_LABEL,
    ...LEGACY_DEPENDENCY_NAVIGATION_LABELS,
  ]
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")}):\\*\\*[ \\t]+(?<linkSpan>.*\\[\\[#\\^[A-Za-z0-9-]+\\]\\].*)[ \\t]*$`,
);
const DEPENDENCY_NAVIGATION_LINK_RE = /\[\[#\^([A-Za-z0-9-]+)\]\]/g;
const DEPENDENCY_TRANSCLUSION_BULLET_RE =
  /^(?<indent>\s*(?:>\s*)*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+(?<strike>~~)?(?<embed>!)?\[\[(?<note>[^\]|#]*?)#\^(?<blockId>[A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]\k<strike>[ \t]*$/;
// Managed "schedule log" child bullet, e.g. `  - 🗓️ **SCHEDULE LOG**`, with a
// newest-first list of `*<from> → <to>* — <reason>` entries nested one level
// under it. The emoji is `U+1F5D3 U+FE0F` (keep the variation selector). A
// marker written by hand without the emoji, and the legacy `**Schedule log:**`
// spelling, are both still recognized so an existing log is never orphaned or
// silently rewritten.
const SCHEDULE_LOG_EMOJI = "🗓️";
const SCHEDULE_LOG_LABEL = "SCHEDULE LOG";
const LEGACY_SCHEDULE_LOG_LABELS = Object.freeze(new Set(["Schedule log"]));
const SCHEDULE_LOG_MARKER_TEXT = `${SCHEDULE_LOG_EMOJI} **${SCHEDULE_LOG_LABEL}**`;
const SCHEDULE_LOG_ENTRY_EMPHASIS = "*";
const SCHEDULE_LOG_INDENT_UNIT = "\t";
const SCHEDULE_LOG_SEPARATOR = " — ";
const SCHEDULE_LOG_TRANSITION = " → ";
// A machine-rolled date logs its own reason instead of prompting for one. The
// die matches the `dices` icon the picker already uses for the pinned
// priority-roll row, and marks the entry as written by the plugin rather than
// typed by a human.
const SCHEDULE_LOG_AUTO_REASON_EMOJI = "🎲";
const SCHEDULE_LOG_AUTO_REASON_SEPARATOR = " · ";
// A task with no priority field is the implicit highest level, P0. The picker
// has no P0 row (Ctrl+D clears the field instead), so this label exists only to
// render the previous side of a priority transition in a log entry.
const IMPLICIT_PRIORITY_LEVEL_LABEL = "P0";
// A skipped reason prompt still records the change on a task that already keeps
// a log: a gap in a history the task maintains is worse than an unexplained
// entry. The shrug marks the text as plugin-written, matching the die that
// marks a machine-rolled date. `🤷` is U+1F937 — one code point, no variation
// selector and no gendered ZWJ sequence.
const SCHEDULE_LOG_SKIPPED_REASON_EMOJI = "🤷";
const SCHEDULE_LOG_SKIPPED_REASON_TEXT = `${SCHEDULE_LOG_SKIPPED_REASON_EMOJI} no reason given`;
// Reason codes planScheduleLogEntry guards out with that are ordinary outcomes
// rather than failures: nothing was asked for, the task keeps no log, or the
// date did not move. They produce no notice text; anything else does.
const SCHEDULE_LOG_SILENT_GUARD_REASONS = Object.freeze(new Set(["empty-reason", "no-schedule-log", "unchanged-date"]));
const SCHEDULE_LOG_PARENT_RE = new RegExp(
  `^(?<indent>\\s*(?:>\\s*)*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?<emoji>${SCHEDULE_LOG_EMOJI}[ \\t]+)?\\*\\*(?<label>${[
    SCHEDULE_LOG_LABEL,
    ...LEGACY_SCHEDULE_LOG_LABELS,
  ]
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")}):?\\*\\*[ \\t]*$`,
);
const SCHEDULE_LOG_ENTRY_RE = new RegExp(
  `^(?<indent>\\s*(?:>\\s*)*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?<emphasis>\\*\\*?)(?:(?<from>.+?)${SCHEDULE_LOG_TRANSITION})?(?<to>.+?)\\k<emphasis>${SCHEDULE_LOG_SEPARATOR}(?<reason>.+)$`,
);
const BULLET_PROPERTY_FIELD_RE = /\[([^\[\]\n]+?)::([^\]\n]*)\]/g;
const BULLET_PROPERTY_TRAILING_BLOCK_ID_RE =
  /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const BULLET_PROPERTY_BLOCK_ID_ONLY_RE = /^\^[A-Za-z0-9-]+[ \t]*$/;
const BULLET_PROPERTY_INVALID_NAME_CHARS_RE = /[\s[\]]|::/;
const BULLET_PROPERTY_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const TASKS_DEPENDENCY_ID_RE = /^[A-Za-z0-9_-]+$/;
const BULLET_PROPERTY_TASKS_INLINE_FIELD_RE =
  /[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g;
const BULLET_PROPERTY_TASKS_EMOJI_DATE_RE =
  /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g;

function numericOrDefault(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max) {
  const safeMin = finiteNumberOrNull(min);
  const safeMax = finiteNumberOrNull(max);
  const lower = safeMin === null ? 0 : safeMin;
  const upper =
    safeMax === null ? Number.POSITIVE_INFINITY : Math.max(lower, safeMax);
  return Math.min(Math.max(Number(value) || 0, lower), upper);
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

  if (values === "priority") {
    return "priority";
  }

  if (Array.isArray(values) && values.length > 0) {
    const normalizedValues = [];
    for (const value of values) {
      if (!isBulletPropertyScalar(value)) {
        showBulletPropertyNotice(
          `Bullet property "${name}" values must be "date", "local_task_id", "priority", or a non-empty scalar list`,
          options,
        );
        return null;
      }

      normalizedValues.push(String(value));
    }

    return Object.freeze(normalizedValues);
  }

  showBulletPropertyNotice(
    `Bullet property "${name}" values must be "date", "local_task_id", "priority", or a non-empty scalar list`,
    options,
  );
  return null;
}

function normalizeBulletPriorityLevel(name, level, index, options) {
  const levelPrefix = `Bullet property "${name}" level #${index + 1}`;
  if (!level || typeof level !== "object" || Array.isArray(level)) {
    showBulletPropertyNotice(`${levelPrefix} must be an object`, options);
    return null;
  }

  if (typeof level.label !== "string" || !level.label.trim()) {
    showBulletPropertyNotice(
      `${levelPrefix} must define a non-empty string label`,
      options,
    );
    return null;
  }

  if (!isBulletPropertyScalar(level.value)) {
    showBulletPropertyNotice(
      `${levelPrefix} must define a non-empty scalar value`,
      options,
    );
    return null;
  }

  const label = level.label.trim();
  const rawValue = String(level.value);
  const value = rawValue.trim();
  if (!value) {
    showBulletPropertyNotice(
      `${levelPrefix} must define a non-empty scalar value`,
      options,
    );
    return null;
  }
  if (/[\[\]\n]|::/.test(rawValue)) {
    showBulletPropertyNotice(
      `${levelPrefix} value cannot contain "[", "]", "::", or a newline`,
      options,
    );
    return null;
  }

  if (!Number.isInteger(level.min_days) || level.min_days < 0) {
    showBulletPropertyNotice(
      `${levelPrefix} min_days must be a non-negative integer`,
      options,
    );
    return null;
  }
  if (!Number.isInteger(level.max_days) || level.max_days < 0) {
    showBulletPropertyNotice(
      `${levelPrefix} max_days must be a non-negative integer`,
      options,
    );
    return null;
  }
  if (level.min_days > level.max_days) {
    showBulletPropertyNotice(
      `${levelPrefix} min_days cannot exceed max_days`,
      options,
    );
    return null;
  }

  return Object.freeze({
    label,
    value,
    minDays: level.min_days,
    maxDays: level.max_days,
  });
}

function normalizeBulletPriorityProperty(name, entry, options) {
  if (!Array.isArray(entry.levels) || entry.levels.length === 0) {
    showBulletPropertyNotice(
      `Bullet property "${name}" levels must be a non-empty list`,
      options,
    );
    return null;
  }

  const levels = [];
  const seenLabels = new Set();
  const seenValues = new Set();
  for (let index = 0; index < entry.levels.length; index += 1) {
    const level = normalizeBulletPriorityLevel(
      name,
      entry.levels[index],
      index,
      options,
    );
    if (level === null) {
      return null;
    }
    if (seenLabels.has(level.label)) {
      showBulletPropertyNotice(
        `Bullet property "${name}" level #${index + 1} label "${level.label}" is duplicated`,
        options,
      );
      return null;
    }
    if (seenValues.has(level.value)) {
      showBulletPropertyNotice(
        `Bullet property "${name}" level #${index + 1} value "${level.value}" is duplicated`,
        options,
      );
      return null;
    }

    seenLabels.add(level.label);
    seenValues.add(level.value);
    levels.push(level);
  }

  const schedules = entry.schedules === undefined ? "scheduled" : entry.schedules;
  if (typeof schedules !== "string" || !schedules.trim()) {
    showBulletPropertyNotice(
      `Bullet property "${name}" schedules must name another date property`,
      options,
    );
    return null;
  }

  const frozenLevels = Object.freeze(levels);
  return Object.freeze({
    name,
    values: "priority",
    schedules: schedules.trim(),
    levels: frozenLevels,
    levelsByValue: Object.freeze(
      new Map(frozenLevels.map((level) => [level.value, level])),
    ),
  });
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

    if (
      values !== "priority" &&
      Object.prototype.hasOwnProperty.call(entry, "levels")
    ) {
      showBulletPropertyNotice(
        `Bullet property "${name}" levels are only valid when values is "priority"`,
        options,
      );
      return null;
    }

    seenNames.add(name);
    if (values === "priority") {
      const property = normalizeBulletPriorityProperty(name, entry, options);
      if (property === null) {
        return null;
      }
      properties.push(property);
    } else {
      properties.push(Object.freeze({ name, values }));
    }
  }

  for (const property of properties) {
    if (property.values !== "priority") {
      continue;
    }
    const scheduledProperty = properties.find(
      (candidate) =>
        candidate.name === property.schedules &&
        candidate.name !== property.name &&
        candidate.values === "date",
    );
    if (!scheduledProperty) {
      showBulletPropertyNotice(
        `Bullet property "${property.name}" schedules must name another date property in the same config`,
        options,
      );
      return null;
    }
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

function applyBulletPropertyEdits(line, edits) {
  const originalLine = String(line || "");
  let nextLine = originalLine;
  for (const edit of Array.isArray(edits) ? edits : []) {
    const result = upsertBulletProperty(nextLine, edit.name, edit.value);
    if (result.reason) {
      return Object.freeze({
        line: originalLine,
        changed: false,
        reason: result.reason,
      });
    }
    nextLine = result.line;
  }

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== originalLine,
    reason: null,
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
  const excludeLines =
    options.excludeLines instanceof Set
      ? options.excludeLines
      : new Set(options.excludeLines || []);

  return getOpenObsidianTaskLines(lines)
    .filter((line) => line !== excludeLine && !excludeLines.has(line))
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

// Apply a confirmed/prompted block ID to a task line: append the trailing `^id`
// navigation target and replace any existing `[id::]` value with the canonical
// path-qualified dependency ID. Returns null when the note path is unqualifiable.
function applyPromptedBlockIdToTaskLine(line, id, filePath = "") {
  const withBlockId = appendBlockIdToLine(line, id);
  const canonicalId = filePath ? tryDependencyId(filePath, id) : id;
  if (!canonicalId) {
    return null;
  }
  return upsertBulletProperty(withBlockId, "id", canonicalId).line;
}

function resolveTargetTaskIdentity(line, options = {}) {
  const promptWhenBlockIdMissing = options.promptWhenBlockIdMissing === true;
  const text = String(line || "");
  const idField = findBulletPropertyField(text, "id");
  const idFieldValue = idField
    ? normalizeBulletPropertyValue(idField.value)
    : "";
  const blockId = getTrailingBlockId(text);
  const filePath = normalizeVaultRelativePath(options.filePath || "");

  // Stricter rule for the prompted flows: a missing trailing block ID always
  // means "ask the user", even when an `[id:: value]` is already present. The
  // caller will run the prompt, then replace the existing `[id::]` with the
  // canonical dependency value while linking to the confirmed block ID.
  if (promptWhenBlockIdMissing && !blockId) {
    return Object.freeze({
      value: null,
      linkBlockId: null,
      legacyValue: idFieldValue || null,
      needsBlockIdPrompt: true,
      targetEdits: Object.freeze([]),
    });
  }

  if (blockId) {
    const canonicalId = filePath ? tryDependencyId(filePath, blockId) : blockId;
    if (!canonicalId) {
      return Object.freeze({
        value: null,
        linkBlockId: blockId,
        legacyValue: idFieldValue || null,
        needsBlockIdPrompt: false,
        reason: "unqualifiable-note-path",
        targetEdits: Object.freeze([]),
      });
    }
    const idResult = upsertBulletProperty(text, "id", canonicalId);
    return Object.freeze({
      value: canonicalId,
      linkBlockId: blockId,
      legacyValue: idFieldValue && idFieldValue !== canonicalId ? idFieldValue : null,
      needsBlockIdPrompt: false,
      reason: null,
      targetEdits: Object.freeze(
        getTargetEdit(idField ? "normalize-id-field" : "add-id-field", text, idResult.line),
      ),
    });
  }

  return Object.freeze({
    value: null,
    linkBlockId: null,
    legacyValue: idFieldValue || null,
    needsBlockIdPrompt: true,
    reason: null,
    targetEdits: Object.freeze([]),
  });
}

// Leading list container prefix, including any Markdown blockquote markers.
function getBulletIndent(line) {
  const match = /^(\s*(?:>\s*)*)/.exec(String(line || ""));
  return match ? match[1] : "";
}

function getBulletIndentWidth(line) {
  let width = 0;
  for (const character of getBulletIndent(line)) {
    if (character === "\t") {
      width += 4 - (width % 4);
    } else if (character === ">") {
      // Treat each quote level as one logical indentation stop so quoted
      // navigation children remain inside the source task's quote context.
      width += 4;
    } else {
      width += 1;
    }
  }
  return width;
}

function findNearestParentListItem(lines, childLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const childIndex = Math.floor(numericOrDefault(childLine, Number.NaN));
  if (!Number.isFinite(childIndex) || childIndex <= 0) {
    return null;
  }
  const childIndentWidth = getBulletIndentWidth(sourceLines[childIndex] || "");
  for (let line = childIndex - 1; line >= 0; line -= 1) {
    const text = String(sourceLines[line] || "");
    if (!text.trim() || getBulletIndentWidth(text) >= childIndentWidth) {
      continue;
    }
    if (BULLET_PROPERTY_LIST_ITEM_RE.test(text)) {
      return line;
    }
  }
  return null;
}

function normalizeDependencyNavigationBlockIds(blockIds) {
  return normalizeDependencyNavigationTargets(blockIds).map(
    (target) => target.blockId,
  );
}

function dependencyNavigationTargetKey(target) {
  const blockId = normalizeBulletPropertyValue(
    target && typeof target === "object" ? target.blockId : target,
  );
  const note =
    target && typeof target === "object"
      ? String(target.note || target.target || "").trim()
      : "";
  return blockId ? `${note}#^${blockId}` : "";
}

function compactDependencyNavigationTarget(target) {
  return target.note || target.terminal
    ? Object.freeze({ ...target })
    : target.blockId;
}

function normalizeDependencyNavigationTargets(targets) {
  const rawTargets = Array.isArray(targets) ? targets : [targets];
  const normalized = [];
  const seen = new Set();
  rawTargets.forEach((target) => {
    const blockId = normalizeBulletPropertyValue(
      target && typeof target === "object" ? target.blockId : target,
    );
    const note =
      target && typeof target === "object"
        ? String(target.note || target.target || "").trim()
        : "";
    const key = dependencyNavigationTargetKey({ blockId, note });
    if (!blockId || seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(
      Object.freeze({
        blockId,
        note,
        terminal: Boolean(
          target && typeof target === "object" && target.terminal,
        ),
      }),
    );
  });
  return normalized;
}

function formatDependencyNavigationBulletWithMarker(target, indent, marker) {
  const indentText = typeof indent === "string" ? indent : "";
  const markerText = typeof marker === "string" && marker ? marker : "-";
  const targets = normalizeDependencyNavigationTargets(target);
  if (targets.length === 0) {
    return "";
  }
  return targets
    .map(
      ({ blockId, note, terminal }) => {
        const link = `[[${note ? `${note}` : ""}#^${blockId}]]`;
        return `${indentText}${markerText} ${terminal ? `~~${link}~~` : `!${link}`}`;
      },
    )
    .join("\n");
}

function formatDependencyNavigationBullet(target, indent) {
  return formatDependencyNavigationBulletWithMarker(target, indent, "-");
}

function parseDependencyTransclusionBulletDetails(line) {
  const match = DEPENDENCY_TRANSCLUSION_BULLET_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }
  const { indent, marker, strike, embed, note, blockId } = match.groups;
  if (strike && embed) {
    return null;
  }
  return Object.freeze({
    indent,
    marker,
    note: String(note || "").trim(),
    blockId,
    blockIds: Object.freeze([blockId]),
    transcluded: Boolean(embed),
    terminal: Boolean(strike),
  });
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
  const details =
    parseDependencyNavigationBulletDetails(line) ||
    parseDependencyTransclusionBulletDetails(line);
  return details ? details.blockIds.slice() : [];
}

// Return the linked block ID when a line is a managed dependency navigation
// bullet (current or legacy label), otherwise null. Kept for narrow legacy
// callers; new code should use getDependencyNavigationBlockIds.
function parseDependencyNavigationBullet(line) {
  const details =
    parseDependencyNavigationBulletDetails(line) ||
    parseDependencyTransclusionBulletDetails(line);
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
  const targets = details && details.terminal
    ? blockIds.map((blockId) => ({
        blockId,
        note: details.note || "",
        terminal: true,
      }))
    : blockIds;
  return formatDependencyNavigationBulletWithMarker(
    targets,
    details && details.indent,
    details && details.marker,
  );
}

function getTaskIdentityByBlockId(content) {
  const identities = new Map();
  const text = String(content || "");
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    if (!isObsidianTaskAtLine(text, lineIndex)) {
      return;
    }
    const blockId = getTrailingBlockId(line);
    if (!blockId) {
      return;
    }
    const idField = findBulletPropertyField(line, "id");
    identities.set(
      blockId,
      idField
        ? normalizeBulletPropertyValue(idField.value) || blockId
        : blockId,
    );
  });
  return identities;
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
  const parentIndentLength = getBulletIndentWidth(
    String(sourceLines[parentIndex] || ""),
  );
  let endLineExclusive = startLine;

  for (let index = startLine; index < sourceLines.length; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (getBulletIndentWidth(lineText) > parentIndentLength) {
      endLineExclusive = index + 1;
      continue;
    }

    break;
  }

  return Object.freeze({ startLine, endLineExclusive });
}

// Pick the indentation for a new dependency child bullet: reuse an existing
// child indentation, otherwise use Obsidian's default TAB indentation.
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

    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === parentIndex
    ) {
      return getBulletIndent(lineText);
    }
  }

  return `${parentIndent}\t`;
}

function getDependencyDirectChildIndentLength(lines, parentLine, block) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const childBlock =
    block || findCurrentBulletChildBlock(sourceLines, parentIndex);
  const parentIndentLength = Number.isFinite(parentIndex)
    ? getBulletIndentWidth(String(sourceLines[parentIndex] || ""))
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

    const indentLength = getBulletIndentWidth(lineText);
    if (indentLength <= parentIndentLength) {
      continue;
    }

    if (childIndentLength === null || indentLength < childIndentLength) {
      childIndentLength = indentLength;
    }
  }

  return childIndentLength;
}

// Render the managed schedule-log marker bullet, e.g. `  - 🗓️ **SCHEDULE LOG**`,
// reusing an existing marker's own indent/marker character.
function formatScheduleLogParentBullet(indent, marker) {
  return `${indent}${marker} ${SCHEDULE_LOG_MARKER_TEXT}`;
}

// The text of one schedule-log entry without its indentation or list marker:
// `*<from> → <to>* — <reason>`, or `*<to>* — <reason>` when there was no
// previous value. Split out from formatScheduleLogEntryBullet so the modal
// preview renders the exact text the writers insert instead of duplicating the
// format inline.
function formatScheduleLogEntryText({ from, to, reason }) {
  const emphasis = SCHEDULE_LOG_ENTRY_EMPHASIS;
  const fromText = from ? `${from}${SCHEDULE_LOG_TRANSITION}` : "";
  return `${emphasis}${fromText}${to}${emphasis}${SCHEDULE_LOG_SEPARATOR}${reason}`;
}

function formatScheduleLogEntryBullet(indent, marker, fields) {
  return `${indent}${marker} ${formatScheduleLogEntryText(fields)}`;
}

function parseScheduleLogParentBullet(line) {
  const match = SCHEDULE_LOG_PARENT_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  const { indent, marker, emoji } = match.groups;
  return Object.freeze({ indent, marker, hasEmoji: Boolean(emoji) });
}

function parseScheduleLogEntryBullet(line) {
  const match = SCHEDULE_LOG_ENTRY_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  const { indent, marker, from, to, reason } = match.groups;
  return Object.freeze({ indent, marker, from: from || "", to, reason });
}

// Trim and collapse a raw reason input to a single normalized string, without
// otherwise mutating it: wikilinks, backticks, and markdown are preserved
// verbatim. `hasInlineField` flags a Dataview-style `key:: value` span so the
// caller can warn (not block) before it lands inside a plain-markdown bullet.
function normalizeScheduleReasonText(raw) {
  const reason = String(raw === null || raw === undefined ? "" : raw)
    .replace(/\s+/g, " ")
    .trim();
  return Object.freeze({
    reason,
    empty: reason === "",
    hasInlineField: /::/.test(reason),
  });
}

// Find the managed `🗓️ **Schedule log:**` marker among `taskLine`'s direct
// children, ignoring a marker that belongs to a nested grandchild bullet.
// Returns the first match (a second marker under the same task is left alone).
function findScheduleLogParent(lines, taskLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  if (!Number.isFinite(taskIndex) || taskIndex < 0) {
    return null;
  }

  const block = findCurrentBulletChildBlock(sourceLines, taskIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    const parsed = parseScheduleLogParentBullet(lineText);
    if (parsed && findNearestParentListItem(sourceLines, index) === taskIndex) {
      return Object.freeze({
        line: index,
        indent: parsed.indent,
        marker: parsed.marker,
      });
    }
  }

  return null;
}

// Pick the indentation for a new schedule-log entry: reuse an existing
// entry's indentation when the marker already has entries, otherwise the
// marker's own indent plus one tab (mirrors getDependencyChildIndent).
function getScheduleLogEntryIndent(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const markerIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const markerIndent = Number.isFinite(markerIndex)
    ? getBulletIndent(String(sourceLines[markerIndex] || ""))
    : "";
  const block = findCurrentBulletChildBlock(sourceLines, markerIndex);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      continue;
    }

    if (
      BULLET_PROPERTY_LIST_ITEM_RE.test(lineText) &&
      findNearestParentListItem(sourceLines, index) === markerIndex
    ) {
      return getBulletIndent(lineText);
    }
  }

  return `${markerIndent}${SCHEDULE_LOG_INDENT_UNIT}`;
}

// Plan the schedule-log write for one task: either prepend a new entry above
// an existing marker's entries, or append a fresh marker + entry as the last
// direct child. Guards (never throws) on an out-of-range line, a non-list-item
// line, or an empty/whitespace-only reason.
function planScheduleLogEntry(content, taskLine, details = {}) {
  const lines = String(content || "").split(/\r?\n/);
  const taskIndex = Math.floor(numericOrDefault(taskLine, Number.NaN));
  const guard = (reason) =>
    Object.freeze({
      valid: false,
      reason,
      changed: false,
      createdParent: false,
      usedFallback: false,
      insertLine: null,
      lineTexts: Object.freeze([]),
      lineText: null,
    });

  if (!Number.isFinite(taskIndex) || taskIndex < 0 || taskIndex >= lines.length) {
    return guard("task-out-of-range");
  }

  if (!isBulletLine(String(lines[taskIndex] || ""))) {
    return guard("not-list-item");
  }

  const normalized = normalizeScheduleReasonText(details.reason);
  const fallback = normalizeScheduleReasonText(details.fallbackReason);
  // An empty reason falls back only on a task that already keeps a log; a task
  // with no marker is still left completely untouched, which is the documented
  // escape hatch for "I do not want a log on this one".
  const usedFallback = normalized.empty && !fallback.empty;
  const reasonText = usedFallback ? fallback.reason : normalized.reason;
  if (!reasonText) {
    return guard("empty-reason");
  }

  const entryFields = {
    from: normalizeBulletPropertyValue(details.from),
    to: normalizeBulletPropertyValue(details.to),
    reason: reasonText,
  };

  const existingParent = findScheduleLogParent(lines, taskIndex);
  if (usedFallback) {
    if (!existingParent) {
      return guard("no-schedule-log");
    }
    // Generated text never claims a change that did not happen — the same rule
    // shouldWriteAutomaticScheduleLog applies to a rolled date's reason. A typed
    // reason on an unchanged date is a human decision and is still written.
    if (!shouldWriteAutomaticScheduleLog(entryFields.from, entryFields.to)) {
      return guard("unchanged-date");
    }
  }
  if (existingParent) {
    const entryIndent = getScheduleLogEntryIndent(lines, existingParent.line);
    const lineText = formatScheduleLogEntryBullet(
      entryIndent,
      existingParent.marker,
      entryFields,
    );
    return Object.freeze({
      valid: true,
      reason: null,
      changed: true,
      createdParent: false,
      usedFallback,
      insertLine: existingParent.line + 1,
      lineTexts: Object.freeze([lineText]),
      lineText,
    });
  }

  const block = findCurrentBulletChildBlock(lines, taskIndex);
  const markerIndent = getDependencyChildIndent(lines, taskIndex);
  // The entry is a grandchild of the task: one Obsidian Tab level deeper than
  // the marker it belongs to, matching getScheduleLogEntryIndent's fallback for
  // a marker that exists but has no entries yet.
  const entryIndent = `${markerIndent}${SCHEDULE_LOG_INDENT_UNIT}`;
  const lineTexts = Object.freeze([
    formatScheduleLogParentBullet(markerIndent, "-"),
    formatScheduleLogEntryBullet(entryIndent, "-", entryFields),
  ]);
  return Object.freeze({
    valid: true,
    reason: null,
    changed: true,
    createdParent: true,
    insertLine: block.endLineExclusive,
    lineTexts,
    lineText: lineTexts.join("\n"),
  });
}

// Shared primitive for the two content-level schedule-log writers (project
// frontmatter and counted batch): splice a plan's lines into a mutable line
// array. Editor-level writers use insertEditorLine directly instead.
function applyScheduleLogEntryToLines(lines, plan) {
  if (!plan || !plan.changed || !Array.isArray(lines)) {
    return 0;
  }

  const insertLine = Math.floor(numericOrDefault(plan.insertLine, Number.NaN));
  if (!Number.isFinite(insertLine) || insertLine < 0) {
    return 0;
  }

  const lineTexts = Array.isArray(plan.lineTexts) ? plan.lineTexts : [];
  lines.splice(insertLine, 0, ...lineTexts);
  return lineTexts.length;
}

// True when a scheduleLog payload carries anything a writer could log: a typed
// reason, or a fallback that a task with an existing log would use. The writers
// call this before planning so an absent payload costs nothing.
function hasScheduleLogReasonInput(scheduleLog) {
  if (!scheduleLog) {
    return false;
  }

  return (
    !normalizeScheduleReasonText(scheduleLog.reason).empty ||
    !normalizeScheduleReasonText(scheduleLog.fallbackReason).empty
  );
}

// Map a planned (and attempted) schedule-log write to the outcome the writers
// report. Null means "say nothing": the task keeps no log, or the date did not
// move, and neither is a failure worth a notice.
function getScheduleLogWriteOutcome(plan, applied) {
  if (!plan) {
    return null;
  }

  if (plan.valid && applied) {
    return plan.createdParent ? "created" : plan.usedFallback ? "added-fallback" : "added";
  }

  return !plan.valid && SCHEDULE_LOG_SILENT_GUARD_REASONS.has(plan.reason) ? null : "guard-failed";
}

// The roll window as the picker states it, e.g. `random in 8–30 days`.
// Durable schedule-log reasons lean on the die emoji instead and say
// `in **8** (8–30) days`. Note the en dash.
function formatPriorityRollWindowText(level) {
  return `random in ${level.minDays}–${level.maxDays} days`;
}

function getPriorityRollBounds(level) {
  const minDays = Number(level && level.minDays);
  const maxDays = Number(level && level.maxDays);
  if (
    !Number.isInteger(minDays) ||
    !Number.isInteger(maxDays) ||
    minDays > maxDays
  ) {
    return null;
  }

  return Object.freeze({ minDays, maxDays });
}

function formatPriorityRollChosenWindowText(level, rolledDays) {
  const bounds = getPriorityRollBounds(level);
  const days = Number(rolledDays);
  if (
    !bounds ||
    !Number.isInteger(days) ||
    days < bounds.minDays ||
    days > bounds.maxDays
  ) {
    return "";
  }

  return `in **${days}** (${bounds.minDays}–${bounds.maxDays}) days`;
}

// The previous priority as a picker label for the left side of a transition.
// An absent field is the implicit P0; a value outside the configured levels
// falls through as itself rather than being dropped.
function getPriorityRollFromLevelLabel(property, value) {
  return getBulletPropertyCurrentLabel(property, value) || IMPLICIT_PRIORITY_LEVEL_LABEL;
}

// Deterministic reason text for a machine-rolled scheduled date. Priority
// choices use the level or transition as the head; pinned scheduled-stage
// choices keep a `roll` suffix so they stay distinguishable from unchanged
// priority picks.
function formatPriorityRollScheduleReason(details = {}) {
  const level = details.level;
  if (!level || !level.label) {
    return "";
  }

  const windowText = formatPriorityRollChosenWindowText(
    level,
    details.rolledDays,
  );
  if (!windowText) {
    return "";
  }

  const head =
    details.source === "priority"
      ? details.fromLevelLabel && details.fromLevelLabel !== level.label
        ? `${details.fromLevelLabel}${SCHEDULE_LOG_TRANSITION}${level.label}`
        : level.label
      : `${level.label} roll`;
  return `${SCHEDULE_LOG_AUTO_REASON_EMOJI} ${head}${SCHEDULE_LOG_AUTO_REASON_SEPARATOR}${windowText}`;
}

// An automatic entry records a scheduling change, so a roll that landed on the
// date the task already had writes nothing. A typed reason is a human decision
// and is never suppressed this way.
function shouldWriteAutomaticScheduleLog(from, to) {
  const fromValue = normalizeBulletPropertyValue(from);
  const toValue = normalizeBulletPropertyValue(to);
  return Boolean(toValue) && fromValue !== toValue;
}

// Build the `options.scheduleLog` payload for a machine-rolled date, or null
// when nothing should be logged. Returning null (rather than a flag the callers
// must check) lets every writer keep its existing "falsy scheduleLog means no
// log" guard unchanged.
function buildPriorityRollScheduleLog(details = {}) {
  if (!shouldWriteAutomaticScheduleLog(details.from, details.to)) {
    return null;
  }

  const reason = formatPriorityRollScheduleReason(details);
  if (!reason) {
    return null;
  }

  return Object.freeze({
    from: normalizeBulletPropertyValue(details.from),
    to: normalizeBulletPropertyValue(details.to),
    reason,
    automatic: true,
  });
}

function createDependencyNavigationCollection(fields) {
  return Object.freeze({
    lineIndices: Object.freeze((fields.lineIndices || []).slice()),
    blockIds: Object.freeze((fields.blockIds || []).slice()),
    targets: Object.freeze((fields.targets || []).slice()),
    indent: fields.indent === undefined ? null : fields.indent,
    marker: fields.marker === undefined ? null : fields.marker,
    anyLegacy: Boolean(fields.anyLegacy),
    startLine: fields.startLine === undefined ? 0 : fields.startLine,
    endLineExclusive:
      fields.endLineExclusive === undefined ? 0 : fields.endLineExclusive,
    reason: fields.reason === undefined ? null : fields.reason,
  });
}

function collectDependencyNavigationBullets(
  content,
  parentLine,
  additionalManagedIds = [],
) {
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

  if (!isObsidianTaskAtLine(content, parentIndex)) {
    return emptyCollection("not-task");
  }

  const block = findCurrentBulletChildBlock(lines, parentIndex);
  const lineIndices = [];
  const blockIds = [];
  const targets = [];
  const seenTargetKeys = new Set();
  let indent = null;
  let marker = null;
  let anyLegacy = false;
  const dependencyField = findBulletPropertyField(lines[parentIndex], "dependsOn");
  const managedIds = new Set(
    dependencyField ? parseLocalTaskIdList(dependencyField.value) : [],
  );
  const managedTargetKeys = new Set(
    normalizeDependencyNavigationTargets(additionalManagedIds).map(
      dependencyNavigationTargetKey,
    ),
  );
  const taskIdentities = getTaskIdentityByBlockId(content);

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(lines[index] || "");
    const legacyDetails = parseDependencyNavigationBulletDetails(lineText);
    if (
      !legacyDetails &&
      findNearestParentListItem(lines, index) !== parentIndex
    ) {
      continue;
    }

    const transclusionDetails = parseDependencyTransclusionBulletDetails(lineText);
    let transclusionManaged = false;
    if (
      transclusionDetails &&
      (transclusionDetails.transcluded || transclusionDetails.terminal)
    ) {
      const targetKey = dependencyNavigationTargetKey(transclusionDetails);
      let qualifiedId = null;
      if (transclusionDetails.note) {
        qualifiedId = tryDependencyId(
          `${transclusionDetails.note}.md`,
          transclusionDetails.blockId,
        );
      }
      transclusionManaged =
        managedTargetKeys.has(targetKey) ||
        (transclusionDetails.note
          ? Boolean(qualifiedId && managedIds.has(qualifiedId))
          : managedIds.has(transclusionDetails.blockId) ||
            managedIds.has(taskIdentities.get(transclusionDetails.blockId)));
    }
    const details = legacyDetails || (transclusionManaged ? transclusionDetails : null);
    if (details === null) {
      continue;
    }

    if (lineIndices.length === 0) {
      indent = details.indent;
      marker = details.marker;
    }

    lineIndices.push(index);
    if (legacyDetails) {
      anyLegacy = true;
    }

    details.blockIds.forEach((blockId) => {
      const normalized = normalizeBulletPropertyValue(blockId);
      const target = Object.freeze({
        blockId: normalized,
        note: transclusionDetails ? transclusionDetails.note : "",
        terminal: Boolean(
          transclusionDetails && transclusionDetails.terminal,
        ),
      });
      const targetKey = dependencyNavigationTargetKey(target);
      if (!normalized || seenTargetKeys.has(targetKey)) {
        return;
      }

      seenTargetKeys.add(targetKey);
      blockIds.push(normalized);
      targets.push(target);
    });
  }

  return createDependencyNavigationCollection({
    lineIndices,
    blockIds,
    targets,
    indent,
    marker,
    anyLegacy,
    startLine: block.startLine,
    endLineExclusive: block.endLineExclusive,
    reason: null,
  });
}

function computeFinalDependencyLinkOrder(existingIds, addIds, removeIds) {
  const removeSet = new Set(
    normalizeDependencyNavigationTargets(removeIds).map(
      dependencyNavigationTargetKey,
    ),
  );
  const finalTargets = [];
  const seenTargets = new Set();

  normalizeDependencyNavigationTargets(existingIds).forEach((target) => {
    const key = dependencyNavigationTargetKey(target);
    if (removeSet.has(key) || seenTargets.has(key)) {
      return;
    }

    seenTargets.add(key);
    finalTargets.push(compactDependencyNavigationTarget(target));
  });

  normalizeDependencyNavigationTargets(addIds).forEach((target) => {
    const key = dependencyNavigationTargetKey(target);
    if (seenTargets.has(key)) {
      return;
    }

    seenTargets.add(key);
    finalTargets.push(compactDependencyNavigationTarget(target));
  });

  return finalTargets;
}

function createDependencyNavigationSyncPlan(fields) {
  return Object.freeze({
    operation: fields.operation,
    changed: Boolean(fields.changed),
    reason: fields.reason === undefined ? null : fields.reason,
    insertLine: fields.insertLine === undefined ? null : fields.insertLine,
    replaceLine: fields.replaceLine === undefined ? null : fields.replaceLine,
    lineText: fields.lineText === undefined ? null : fields.lineText,
    lineTexts: Object.freeze((fields.lineTexts || []).slice()),
    deleteLines: Object.freeze((fields.deleteLines || []).slice()),
    blockIds: Object.freeze((fields.blockIds || []).slice()),
    existingBlockIds: Object.freeze((fields.existingBlockIds || []).slice()),
    lineIndices: Object.freeze((fields.lineIndices || []).slice()),
    consolidated: Boolean(fields.consolidated),
  });
}

function planDependencyNavigationBulletSync(
  content,
  parentLine,
  finalBlockIds,
  options = {},
) {
  const lines = String(content || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  const finalTargets = normalizeDependencyNavigationTargets(finalBlockIds);
  const finalIds = finalTargets.map((target) => target.blockId);
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

  if (!isObsidianTaskAtLine(content, parentIndex)) {
    return guard("not-task");
  }

  const collection = collectDependencyNavigationBullets(content, parentIndex, [
    ...finalTargets,
    ...(options.managedBlockIds || []),
  ]);
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
    const lineTexts = finalTargets.map((target) =>
      formatDependencyNavigationBullet(target, indent),
    );
    return createDependencyNavigationSyncPlan({
      operation: "insert",
      changed: true,
      insertLine: collection.startLine,
      lineText: lineTexts.join("\n"),
      lineTexts,
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
  const existingTargets = new Map(
    (collection.targets || []).map((target) => [
      dependencyNavigationTargetKey(target),
      target,
    ]),
  );
  const lineTexts = finalTargets.map((target) => {
    const existing = existingTargets.get(dependencyNavigationTargetKey(target));
    const formattedTarget = existing
      ? {
          ...target,
          note: target.note || existing.note,
          terminal: existing.terminal,
        }
      : target;
    return formatDependencyNavigationBulletWithMarker(
      formattedTarget,
      collection.indent,
      collection.marker,
    );
  });
  const lineText = lineTexts.join("\n");
  if (
    collection.lineIndices.length === lineTexts.length &&
    collection.lineIndices.every(
      (lineIndex, index) => lines[lineIndex] === lineTexts[index],
    )
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
    lineTexts,
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
    computeFinalDependencyLinkOrder(collection.targets, [blockId], []),
  );
}

function planDependencyNavigationBulletRemoval(content, parentLine, blockId) {
  const collection = collectDependencyNavigationBullets(content, parentLine);
  return planDependencyNavigationBulletSync(
    content,
    parentLine,
    computeFinalDependencyLinkOrder(collection.targets, [], [blockId]),
    { managedBlockIds: [blockId] },
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
    collection.targets,
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
      result.inserted += Math.max((plan.lineTexts || []).length, 1);
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
    collection.targets,
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

function rewriteDependsOnIdsInLine(line, replacements) {
  const mapping = replacements instanceof Map
    ? replacements
    : new Map(Object.entries(replacements || {}));
  if (mapping.size === 0) {
    return String(line || "");
  }
  return String(line || "").replace(
    /\[(\s*dependsOn\s*::)([^\]\n]*)\]/g,
    (field, prefix, value) => {
      let changed = false;
      const nextValue = value
        .split(",")
        .map((segment) => {
          const leading = /^\s*/.exec(segment)[0];
          const trailing = /\s*$/.exec(segment)[0];
          const token = segment.slice(leading.length, segment.length - trailing.length);
          const replacement = mapping.get(token);
          if (!replacement || replacement === token) {
            return segment;
          }
          changed = true;
          return `${leading}${replacement}${trailing}`;
        })
        .join(",");
      return changed ? `[${prefix}${nextValue}]` : field;
    },
  );
}

function rewriteDependsOnIdsInContent(content, replacements) {
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lineContexts = getMarkdownLineContexts(text);
  const sourceLines = text.split(/\r?\n/);
  const next = sourceLines
    .map((line, lineIndex) =>
      isObsidianTaskAtLine(text, lineIndex, lineContexts, sourceLines)
        ? rewriteDependsOnIdsInLine(line, replacements)
        : line,
    )
    .join(newline);
  return Object.freeze({ content: next, changed: next !== text });
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

  // Between keyBuffer digits and getRepeat(), join prefixRepeat and
  // motionRepeat (each an array of digit strings in CodeMirror Vim) and
  // multiply them, matching Vim's own getRepeat() semantics. This covers
  // adapters that expose the arrays but not the method. task-status-cycler's
  // copy of this helper is intentionally left without this fallback — its
  // own chords work today.
  const digits = (value) =>
    Array.isArray(value)
      ? value.join("")
      : typeof value === "string"
        ? value
        : "";
  const prefixText = digits(inputState && inputState.prefixRepeat);
  const motionText = digits(inputState && inputState.motionRepeat);
  const prefixOk = /^[1-9]\d*$/.test(prefixText);
  const motionOk = /^[1-9]\d*$/.test(motionText);
  if (prefixOk || motionOk) {
    const prefix = prefixOk
      ? Math.floor(numericOrDefault(prefixText, 1))
      : 1;
    const motion = motionOk
      ? Math.floor(numericOrDefault(motionText, 1))
      : 1;
    const product = prefix * motion;
    if (Number.isFinite(product) && product > 0) {
      return { repeat: product, explicit: true };
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

function validateDependencyId(value) {
  const id = String(value || "");
  if (!id) {
    return Object.freeze({ valid: false, id, error: "dependency ID is empty" });
  }
  if (!TASKS_DEPENDENCY_ID_RE.test(id)) {
    return Object.freeze({
      valid: false,
      id,
      error: `dependency ID contains unsupported characters: ${id}`,
    });
  }
  return Object.freeze({ valid: true, id, error: null });
}

function dependencyId(vaultRelativeMarkdownPath, blockId) {
  const path = normalizeVaultRelativePath(vaultRelativeMarkdownPath);
  const block = normalizeBulletPropertyValue(blockId).replace(/^\^/, "");
  if (!path || !MARKDOWN_EXTENSION_RE.test(path)) {
    throw new Error(`dependency note path must end in .md: ${path || "(empty)"}`);
  }
  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(block)) {
    throw new Error(`invalid dependency block ID: ${block || "(empty)"}`);
  }
  const id = `${path.replace(MARKDOWN_EXTENSION_RE, "").replaceAll("/", "__")}__${block}`;
  const validation = validateDependencyId(id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return id;
}

function tryDependencyId(vaultRelativeMarkdownPath, blockId) {
  try {
    return dependencyId(vaultRelativeMarkdownPath, blockId);
  } catch (_error) {
    return null;
  }
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

function validateProjectScheduledDate(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return Object.freeze({
      valid: false,
      value: text,
      message: "Scheduled date must use YYYY-MM-DD",
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year < 100) {
    date.setUTCFullYear(year);
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return Object.freeze({
      valid: false,
      value: text,
      message: `Scheduled date is not a valid calendar date: ${text}`,
    });
  }

  return Object.freeze({ valid: true, value: text, year, month, day });
}

function extractProjectSourceSchedule(description) {
  const text = String(description || "");
  const fields = parseBulletPropertyFields(text).filter(
    (field) => field.key === "scheduled",
  );
  if (fields.length === 0) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: null,
    });
  }
  if (fields.length > 1) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: "Source task has multiple [scheduled:: ...] fields; keep exactly one",
    });
  }

  const validation = validateProjectScheduledDate(fields[0].value);
  if (!validation.valid) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: validation.message,
    });
  }

  const field = fields[0];
  return Object.freeze({
    description:
      text.slice(0, field.span.start) + text.slice(field.span.end),
    scheduled: validation.value,
    error: null,
  });
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

  const schedule = extractProjectSourceSchedule(description);
  description = schedule.description;

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
    scheduled: schedule.scheduled,
    scheduleError: schedule.error,
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

// Re-indent a line nested below a project-note section bullet. Identical to
// normalizeNestedChildLine() except an empty relative indent stays empty: a
// section's direct children become top-level notes at column 0 rather than
// nesting under a converted task.
function normalizeProjectSectionNoteLine(lineText, baseIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(baseIndent || "");
  let relativeIndent;
  if (base && leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else {
    relativeIndent = "\t";
  }

  return `${relativeIndent}${content}`;
}

// Re-indent a line from the source task's schedule-log subtree so the marker
// bullet sits one Obsidian Tab level under the new note's `^prj` task and every
// descendant keeps its depth relative to that marker. Blank lines collapse to
// "". A descendant whose indentation does not extend the marker's falls back to
// one level deeper, like normalizeNestedChildLine().
function normalizeProjectScheduleLogLine(lineText, markerIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(markerIndent || "");
  let relativeIndent;
  if (base && leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else if (!base && leading === "") {
    relativeIndent = "";
  } else {
    relativeIndent = SCHEDULE_LOG_INDENT_UNIT;
  }

  return `${SCHEDULE_LOG_INDENT_UNIT}${relativeIndent}${content}`;
}

// Re-indent a line for the restored parent-task subtree. Blank lines collapse
// to "". Each nonblank line keeps the indent it had relative to `baseIndent`
// (the shallowest indent in its block) and is then prefixed with `depth` tabs.
// An indent that does not extend `baseIndent` falls back to one tab, matching
// normalizeProjectScheduleLogLine().
function indentProjectReversalLine(lineText, baseIndent, depth) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(baseIndent || "");
  let relativeIndent;
  if (leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else {
    relativeIndent = "\t";
  }

  const numericDepth = Math.max(0, Math.floor(numericOrDefault(depth, 0)));
  return `${"\t".repeat(numericDepth)}${relativeIndent}${content}`;
}

function getProjectReversalShallowestIndent(lines) {
  let base = null;
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line === null || line === undefined ? "" : line);
    if (text.trim() === "") {
      continue;
    }
    const leadingMatch = /^(\s*)/.exec(text);
    const indent = leadingMatch ? leadingMatch[1] : "";
    if (base === null || indent.length < base.length) {
      base = indent;
    }
  }
  return base === null ? "" : base;
}

function indentProjectReversalLines(lines, depth) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const baseIndent = getProjectReversalShallowestIndent(sourceLines);
  const indented = [];
  for (const line of sourceLines) {
    const next = indentProjectReversalLine(line, baseIndent, depth);
    if (next) {
      indented.push(next);
    }
  }
  return indented;
}

// Inverse of getProjectBasenameFromTaskBlockId(): strip a leading
// `<parentBasename>_` when present, then turn `_` back into `-`. Block IDs
// cannot contain `_` or spaces, so a renamed note yields null.
function getProjectReversalBlockId(noteBasename, parentBasename) {
  const note = String(noteBasename || "").trim();
  if (!note) {
    return null;
  }

  const parent = String(parentBasename || "").trim();
  const prefix = parent ? `${parent}_` : "";
  const suffix =
    prefix && note.startsWith(prefix) ? note.slice(prefix.length) : note;
  if (!suffix) {
    return null;
  }

  const blockId = suffix.replace(/_/g, "-");
  return PROJECT_BLOCK_ID_RE.test(blockId) ? blockId : null;
}

function formatProjectReversalSectionTitle(headerText) {
  const title = String(headerText || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!PROJECT_SECTION_TITLE_RE.test(title) || !/[A-Z]/.test(title)) {
    return null;
  }

  return title;
}

function parseProjectLifecycleTaskBody(lineText) {
  const text = String(lineText || "");
  if (!isProjectLifecycleTaskLine(text)) {
    return null;
  }

  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  const status = match[1];
  let description = match[2] || "";
  const blockIdSpan = getTrailingBlockIdSpan(description);
  if (blockIdSpan) {
    description =
      description.slice(0, blockIdSpan.start) +
      description.slice(blockIdSpan.end);
  }

  description = collapseProjectTaskDescription(
    description
      .replace(PROJECT_TASK_TAG_GLOBAL_RE, "$1")
      .replace(PROJECT_LIFECYCLE_TAG_GLOBAL_RE, "$1"),
  );

  return Object.freeze({ status, description });
}

function getProjectFrontmatterCreatedDate(lines, closingLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const end = Math.floor(numericOrDefault(closingLine, Number.NaN));
  if (!Number.isFinite(end)) {
    return "";
  }

  for (
    let lineIndex = 1;
    lineIndex < end && lineIndex < sourceLines.length;
    lineIndex += 1
  ) {
    const match = /^created[ \t]*:(.*)$/.exec(
      String(sourceLines[lineIndex] || ""),
    );
    if (match) {
      const raw = getYamlScalarText(match[1]);
      const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
      return dateMatch ? dateMatch[1] : "";
    }
  }

  return "";
}

function appendProjectReversalTaskField(taskBody, fieldText) {
  const appendIndex = getBulletPropertyAppendIndex(taskBody);
  const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = taskBody.slice(appendIndex).replace(/^[ \t]+/, " ");
  return `${before} ${fieldText}${after}`;
}

function buildTaskLineFromProjectNote(fields) {
  const input = fields && typeof fields === "object" ? fields : {};
  const status =
    input.status === null || input.status === undefined ? " " : input.status;
  const description = collapseProjectTaskDescription(input.description);
  let taskBody = description ? `#task ${description}` : "#task";

  const scheduled = String(input.scheduled || "").trim();
  if (scheduled && !findBulletPropertyField(taskBody, "scheduled")) {
    taskBody = appendProjectReversalTaskField(
      taskBody,
      `[scheduled::${scheduled}]`,
    );
  }

  const created = String(input.created || "").trim();
  if (created && !findBulletPropertyField(taskBody, "created")) {
    taskBody = appendProjectReversalTaskField(taskBody, `[created::${created}]`);
  }

  const blockId = String(input.blockId || "").trim();
  if (blockId) {
    const appendIndex = getBulletPropertyAppendIndex(taskBody);
    const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
    taskBody = `${before} ^${blockId}`;
  }

  return `- [${status}] ${taskBody}`;
}

function getProjectParentBasenameFromLink(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) {
    return "";
  }

  const wikiMatch = /\[\[([^\]|#\n]+)(?:[#|][^\]]*)?\]\]/.exec(text);
  if (wikiMatch) {
    const target = wikiMatch[1].trim().replace(/\\/g, "/");
    const base = target.split("/").pop() || "";
    return base.replace(MARKDOWN_EXTENSION_RE, "");
  }

  const markdownMatch = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/.exec(text);
  if (markdownMatch) {
    const target = String(markdownMatch[1] || "")
      .split("#")[0]
      .replace(/\\/g, "/");
    const base = target.split("/").pop() || "";
    return base.replace(MARKDOWN_EXTENSION_RE, "");
  }

  return "";
}

function isProjectFrontmatterParentLink(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const text = String(value).trim();
  if (!text) {
    return false;
  }

  if (text.includes("[[") && text.includes("]]")) {
    return true;
  }

  return /\[[^\]]*\]\([^)\s]+\)/.test(text);
}

// Lowercase the whole body, uppercase the first character of every maximal
// run of letters/digits, and collapse internal whitespace runs to a single
// space. Acronyms are not special-cased: "API DESIGN" becomes "Api Design".
function formatProjectSectionTitle(body) {
  const collapsed = String(body || "")
    .trim()
    .replace(/\s+/g, " ");
  return collapsed
    .toLowerCase()
    .replace(/[a-z0-9]+/g, (run) => run.charAt(0).toUpperCase() + run.slice(1));
}

// The title-cased section title for a direct-child bullet body, or null when
// the trimmed body does not match the ALL-CAPS title shape (PROJECT_SECTION_TITLE_RE
// plus at least one letter, so an all-digit or empty body is rejected too).
function parseProjectSectionBulletTitle(body) {
  const trimmed = String(body || "").trim();
  if (!PROJECT_SECTION_TITLE_RE.test(trimmed) || !/[A-Z]/.test(trimmed)) {
    return null;
  }

  return formatProjectSectionTitle(trimmed);
}

// Casefolded, whitespace-collapsed comparison key for matching a section
// bullet's title against an existing note header regardless of casing.
function normalizeProjectSectionTitle(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Convert the captured child block into rendered Markdown lines for the new
// project's `## Tasks` section, note sections destined for other headers, and
// managed schedule-log child lines for the `^prj` task. Direct child list items
// (those at the shallowest child indentation) become top-level tasks unless they
// qualify as a managed schedule-log marker or as a section bullet: no checkbox,
// an ALL-CAPS title (see PROJECT_SECTION_TITLE_RE), and at least one nonblank
// list item nested deeper than it. A qualifying section bullet's descendants
// are copied in verbatim as that section's notes instead; a non-qualifying
// bullet keeps today's task-conversion behavior. Two section bullets whose
// titles normalize equally merge into one section, in source order. Returns
// { taskLines, sections, scheduleLogLines, lossless }, where `sections` is
// [{ title, noteLines }] in source order, `scheduleLogLines` is already
// re-indented for insertion under `^prj`, and `lossless` is false when any
// nonblank child line could not be represented (so the caller can keep the
// source block instead of losing content).
function buildProjectSeedFromChildBullets(childLines, createdDateString) {
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
      sections: Object.freeze([]),
      scheduleLogLines: Object.freeze([]),
      lossless: !hasContent,
    });
  }

  // Pre-pass: for each direct-child line, record whether a nonblank list item
  // is nested deeper than it before the next direct child (section-bullet
  // eligibility needs this lookahead), and the indent of the shallowest such
  // nested list item (the base for re-indenting that section's notes).
  const directChildIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
    if (listMatch && listMatch[1].length === directChildIndentLength) {
      directChildIndexes.push(index);
    }
  }

  const sectionSpanInfo = new Map();
  for (let i = 0; i < directChildIndexes.length; i += 1) {
    const start = directChildIndexes[i];
    const end =
      i + 1 < directChildIndexes.length
        ? directChildIndexes[i + 1]
        : lines.length;
    let nestedIndentLength = null;
    let nestedIndent = "";
    for (let index = start + 1; index < end; index += 1) {
      const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
      if (listMatch && listMatch[1].length > directChildIndentLength) {
        if (
          nestedIndentLength === null ||
          listMatch[1].length < nestedIndentLength
        ) {
          nestedIndentLength = listMatch[1].length;
          nestedIndent = listMatch[1];
        }
      }
    }
    sectionSpanInfo.set(start, {
      hasNestedListItem: nestedIndentLength !== null,
      baseIndent: nestedIndent,
    });
  }

  const taskLines = [];
  const sectionEntries = [];
  const sectionEntryByTitle = new Map();
  const scheduleLogLines = [];
  let current = null;
  let currentSection = null;
  let currentScheduleLog = null;
  let lossless = true;

  const flushTask = () => {
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

  const flushSection = () => {
    if (!currentSection) {
      return;
    }

    const noteLines = currentSection.noteLines.slice();
    while (noteLines.length && noteLines[0].trim() === "") {
      noteLines.shift();
    }
    while (noteLines.length && noteLines[noteLines.length - 1].trim() === "") {
      noteLines.pop();
    }

    let entry = sectionEntryByTitle.get(currentSection.normalizedTitle);
    if (!entry) {
      entry = { title: currentSection.title, noteLines: [] };
      sectionEntryByTitle.set(currentSection.normalizedTitle, entry);
      sectionEntries.push(entry);
    }
    entry.noteLines.push(...noteLines);
    currentSection = null;
  };

  const flushScheduleLog = () => {
    if (!currentScheduleLog) {
      return;
    }

    const logLines = currentScheduleLog.lines.slice();
    while (logLines.length && logLines[0].trim() === "") {
      logLines.shift();
    }
    while (logLines.length && logLines[logLines.length - 1].trim() === "") {
      logLines.pop();
    }
    scheduleLogLines.push(...logLines);
    currentScheduleLog = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      if (current) {
        current.nested.push("");
      }
      if (currentSection) {
        currentSection.noteLines.push("");
      }
      if (currentScheduleLog) {
        currentScheduleLog.lines.push("");
      }
      continue;
    }

    const leadingMatch = /^(\s*)/.exec(line);
    const leading = leadingMatch ? leadingMatch[1] : "";
    const listMatch = PROJECT_LIST_ITEM_RE.exec(line);

    if (listMatch && listMatch[1].length === directChildIndentLength) {
      flushTask();
      flushSection();
      flushScheduleLog();

      const parsedScheduleLog = parseScheduleLogParentBullet(line);
      if (parsedScheduleLog) {
        currentScheduleLog = {
          markerIndent: parsedScheduleLog.indent,
          lines: [
            normalizeProjectScheduleLogLine(line, parsedScheduleLog.indent),
          ],
        };
        continue;
      }

      const parsedChild = parseProjectChildListItem(
        line,
        directChildIndentLength - 1,
      );
      const sectionTitle =
        parsedChild && parsedChild.status === null
          ? parseProjectSectionBulletTitle(parsedChild.body)
          : null;
      const spanInfo = sectionSpanInfo.get(index);

      if (sectionTitle && spanInfo && spanInfo.hasNestedListItem) {
        currentSection = {
          title: sectionTitle,
          normalizedTitle: normalizeProjectSectionTitle(sectionTitle),
          noteLines: [],
          baseIndent: spanInfo.baseIndent,
        };
        continue;
      }

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
    } else if (leading.length > directChildIndentLength && currentSection) {
      currentSection.noteLines.push(
        normalizeProjectSectionNoteLine(line, currentSection.baseIndent),
      );
    } else if (leading.length > directChildIndentLength && currentScheduleLog) {
      currentScheduleLog.lines.push(
        normalizeProjectScheduleLogLine(line, currentScheduleLog.markerIndent),
      );
    } else {
      lossless = false;
    }
  }

  flushTask();
  flushSection();
  flushScheduleLog();

  return Object.freeze({
    taskLines: Object.freeze(taskLines),
    sections: Object.freeze(
      sectionEntries.map((entry) =>
        Object.freeze({
          title: entry.title,
          noteLines: Object.freeze(entry.noteLines),
        }),
      ),
    ),
    scheduleLogLines: Object.freeze(scheduleLogLines),
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

// Locate the project lifecycle `^prj` task line, ignoring frontmatter and fenced
// code, or -1 when there is no such task.
function findProjectLifecycleTaskIndex(lines) {
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

    if (isProjectLifecycleTaskLine(line)) {
      return lineIndex;
    }
  }

  return -1;
}

// Insert already-rendered schedule-log lines directly under the new note's
// lifecycle task. Returns { content, inserted }; inserted is false when there is
// nothing to insert or no `^prj` task exists.
function insertProjectScheduleLogLines(content, scheduleLogLines) {
  const text = String(content || "");
  const logLines = Array.isArray(scheduleLogLines)
    ? scheduleLogLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];
  if (logLines.length === 0) {
    return Object.freeze({ content: text, inserted: false });
  }

  const { lines, lineEnding } = splitMarkdownContent(text);
  const lifecycleIndex = findProjectLifecycleTaskIndex(lines);
  if (lifecycleIndex === -1) {
    return Object.freeze({ content: text, inserted: false });
  }

  return Object.freeze({
    content: lines
      .slice(0, lifecycleIndex + 1)
      .concat(logLines, lines.slice(lifecycleIndex + 1))
      .join(lineEnding),
    inserted: true,
  });
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

// Locate an existing unfenced `##` header matching `title` (case-insensitive,
// whitespace-collapsed), skipping frontmatter. Returns
// { headerIndex, bodyEndExclusive } or null when no such header exists.
// bodyEndExclusive is one past the section's last nonblank line, bounded by
// the next level-one-or-two header (fence-aware) or EOF; it equals
// headerIndex + 1 for an empty body.
function findProjectSectionRange(lines, title) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const normalizedTarget = normalizeProjectSectionTitle(title);
  if (!normalizedTarget) {
    return null;
  }

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

    const headerMatch = PROJECT_SECTION_HEADER_RE.exec(line);
    if (
      !headerMatch ||
      normalizeProjectSectionTitle(headerMatch[1] || "") !== normalizedTarget
    ) {
      continue;
    }

    const headerIndex = lineIndex;
    let bodyEndExclusive = headerIndex + 1;
    let bodyInFence = null;
    for (let index = headerIndex + 1; index < sourceLines.length; index += 1) {
      const bodyLine = String(sourceLines[index] || "");

      if (bodyInFence) {
        if (isClosingFence(bodyLine, bodyInFence)) {
          bodyInFence = null;
        }
        bodyEndExclusive = index + 1;
        continue;
      }

      const bodyOpeningFence = getFenceOpening(bodyLine);
      if (bodyOpeningFence) {
        bodyInFence = bodyOpeningFence;
        bodyEndExclusive = index + 1;
        continue;
      }

      if (PROJECT_SECTION_BOUNDARY_HEADER_RE.test(bodyLine)) {
        break;
      }

      if (bodyLine.trim() !== "") {
        bodyEndExclusive = index + 1;
      }
    }

    return Object.freeze({ headerIndex, bodyEndExclusive });
  }

  return null;
}

// Insert each section's notes into `content`: reuse a matching existing `##`
// header (leaving the header line byte-identical) when one exists, otherwise
// append a new `## Title` section at EOF, in source order. Existing-header
// insertions are applied highest line index first so earlier insert points
// stay valid. Returns { content, insertedCount, createdCount }.
function insertProjectSectionNotes(content, sections) {
  const text = String(content || "");
  const sectionList = Array.isArray(sections) ? sections : [];
  const validSections = sectionList
    .map((section) => ({
      title: String(section && section.title ? section.title : "").trim(),
      noteLines: Array.isArray(section && section.noteLines)
        ? section.noteLines.map((line) =>
            String(line === null || line === undefined ? "" : line),
          )
        : [],
    }))
    .filter((section) => section.title && section.noteLines.length > 0);

  if (validSections.length === 0) {
    return Object.freeze({ content: text, insertedCount: 0, createdCount: 0 });
  }

  const { lineEnding } = splitMarkdownContent(text);
  let lines = text.split(/\r?\n/);

  const matches = [];
  const newSections = [];
  for (const section of validSections) {
    const range = findProjectSectionRange(lines, section.title);
    if (range) {
      matches.push({
        headerIndex: range.headerIndex,
        bodyEndExclusive: range.bodyEndExclusive,
        noteLines: section.noteLines,
      });
    } else {
      newSections.push(section);
    }
  }

  matches.sort((left, right) => right.headerIndex - left.headerIndex);

  for (const match of matches) {
    const bodyEmpty = match.bodyEndExclusive === match.headerIndex + 1;
    const insertion = bodyEmpty
      ? ["", ...match.noteLines]
      : match.noteLines.slice();
    lines = lines
      .slice(0, match.bodyEndExclusive)
      .concat(insertion, lines.slice(match.bodyEndExclusive));
  }

  let nextContent = lines.join(lineEnding);

  if (newSections.length > 0) {
    const hadTerminalNewline = /\r?\n$/.test(nextContent);
    for (const section of newSections) {
      if (nextContent && !nextContent.endsWith(lineEnding)) {
        nextContent += lineEnding;
      }
      if (nextContent && !nextContent.endsWith(lineEnding + lineEnding)) {
        nextContent += lineEnding;
      }
      nextContent += `## ${section.title}${lineEnding}${lineEnding}`;
      nextContent += section.noteLines.join(lineEnding);
    }
    if (hadTerminalNewline) {
      nextContent += lineEnding;
    }
  }

  return Object.freeze({
    content: nextContent,
    insertedCount: matches.length,
    createdCount: newSections.length,
  });
}

// Seed the new project note from the parsed source task: fill the `^prj`
// completion criteria, apply the source task's priority, optionally move the
// source task's schedule log under `^prj`, and optionally insert converted child
// tasks into the `## Tasks` section. Returns a result object:
//   seeded               - the `^prj` completion placeholder was found & filled
//   scheduleLogInserted  - schedule-log lines were inserted under `^prj`
//   tasksInserted        - child tasks were inserted into `## Tasks`
//   tasksSectionMissing  - child tasks were requested but `## Tasks` was absent
//   content              - the rewritten content (unchanged when not seeded)
function buildProjectContentFromTask(content, parsedTask, options = {}) {
  const text = String(content || "");
  if (!text.includes(PROJECT_COMPLETION_PLACEHOLDER)) {
    return Object.freeze({
      content: text,
      seeded: false,
      scheduleLogInserted: false,
      tasksInserted: false,
      tasksSectionMissing: false,
      sectionsInserted: 0,
      sectionsCreated: 0,
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

  const scheduleLogLines = Array.isArray(options.scheduleLogLines)
    ? options.scheduleLogLines
    : [];
  let scheduleLogInserted = false;
  if (scheduleLogLines.length > 0) {
    const scheduleLogResult = insertProjectScheduleLogLines(
      nextContent,
      scheduleLogLines,
    );
    if (scheduleLogResult.inserted) {
      nextContent = scheduleLogResult.content;
      scheduleLogInserted = true;
    }
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

  const sections = Array.isArray(options.sections) ? options.sections : [];
  let sectionsInserted = 0;
  let sectionsCreated = 0;
  if (sections.length > 0) {
    const sectionsResult = insertProjectSectionNotes(nextContent, sections);
    nextContent = sectionsResult.content;
    sectionsInserted = sectionsResult.insertedCount;
    sectionsCreated = sectionsResult.createdCount;
  }

  return Object.freeze({
    content: nextContent,
    seeded: true,
    scheduleLogInserted,
    tasksInserted,
    tasksSectionMissing,
    sectionsInserted,
    sectionsCreated,
  });
}

function applyProjectCreationFrontmatter(
  frontmatter,
  parentLink,
  scheduled = null,
) {
  frontmatter.parent = parentLink;
  frontmatter.type = "[[project]]";
  frontmatter.status = "wip";
  if (scheduled !== null && scheduled !== undefined && scheduled !== "") {
    frontmatter.scheduled = scheduled;
  }
  return frontmatter;
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
  sectionCount,
  scheduleLogMoved = false,
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
  const numericSectionCount = numericOrDefault(sectionCount, 0);
  if (numericSectionCount > 0) {
    details.push(
      `${numericSectionCount} ${numericSectionCount === 1 ? "section" : "sections"} seeded`,
    );
  }
  if (scheduleLogMoved) {
    details.push("schedule log moved");
  }

  return `Created project${projectSuffix} from task "${taskText}" (${details.join("; ")})`;
}

function getProjectNoteToTaskNoticeText(
  noteBasename,
  parentBasename,
  taskCount,
  sectionCount,
  updatedLinkCount,
) {
  const note = String(noteBasename || "").trim() || "note";
  const parent = String(parentBasename || "").trim() || "parent";
  const details = [];
  const numericTaskCount = numericOrDefault(taskCount, 0);
  if (numericTaskCount > 0) {
    details.push(
      `${numericTaskCount} ${numericTaskCount === 1 ? "task" : "tasks"}`,
    );
  }
  const numericSectionCount = numericOrDefault(sectionCount, 0);
  if (numericSectionCount > 0) {
    details.push(
      `${numericSectionCount} ${
        numericSectionCount === 1 ? "section" : "sections"
      }`,
    );
  }
  const numericLinkCount = numericOrDefault(updatedLinkCount, 0);
  if (numericLinkCount > 0) {
    details.push(
      `${numericLinkCount} ${numericLinkCount === 1 ? "link" : "links"} updated`,
    );
  }

  const detailText =
    details.length > 0 ? details.join("; ") : "no child content";
  return `Converted ${note} into a task in ${parent} (${detailText})`;
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

function collectBacklinkOriginalStrings(value, originals, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (
    typeof value === "object" &&
    !(value instanceof Map) &&
    !Array.isArray(value) &&
    typeof value.original === "string" &&
    value.original
  ) {
    originals.add(value.original);
  }

  if (value instanceof Map) {
    for (const entryValue of value.values()) {
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entryValue) =>
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1),
    );
    return;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entryValue) =>
      collectBacklinkOriginalStrings(entryValue, originals, depth + 1),
    );
  }
}

function collectProjectNoteBacklinkClassification(backlinksData, excludePath) {
  const blockRewrites = collectBlockIdBacklinkRewrites(backlinksData, "prj");
  const prjOriginalsByPath = new Map();
  for (const rewrite of blockRewrites) {
    prjOriginalsByPath.set(rewrite.path, new Set(rewrite.originals));
  }

  const excluded = new Set();
  const excludeText = String(excludePath || "").trim();
  if (excludeText) {
    excluded.add(excludeText);
    excluded.add(normalizeVaultRelativePath(excludeText));
  }

  const entries =
    backlinksData instanceof Map
      ? Array.from(backlinksData.entries())
      : backlinksData && typeof backlinksData === "object"
        ? Object.entries(backlinksData)
        : [];

  const otherPaths = [];
  for (const [path, value] of entries) {
    const entryPath = String(path || "");
    if (
      !entryPath ||
      excluded.has(entryPath) ||
      excluded.has(normalizeVaultRelativePath(entryPath))
    ) {
      continue;
    }

    const allOriginals = new Set();
    collectBacklinkOriginalStrings(value, allOriginals);
    const prjOriginals = prjOriginalsByPath.get(entryPath) || new Set();
    const hasOther = Array.from(allOriginals).some(
      (original) => !prjOriginals.has(original),
    );
    if (hasOther) {
      otherPaths.push(entryPath);
    }
  }

  return Object.freeze({
    blockRewrites: Object.freeze(blockRewrites),
    otherPaths: Object.freeze(otherPaths),
  });
}

function rewriteBlockIdLinkOriginal(original, newBasename, blockId = "prj") {
  const text = String(original || "");
  const targetBasename = String(newBasename || "").trim();
  const id = String(blockId || "").trim() || "prj";
  if (!text || !targetBasename) {
    return null;
  }

  const wikiMatch = /^(!?)\[\[([^\]\n|]*?)#\^[A-Za-z0-9-]+(\|[^\]\n]*)?\]\]$/.exec(
    text,
  );
  if (wikiMatch) {
    return `${wikiMatch[1]}[[${targetBasename}#^${id}${wikiMatch[3] || ""}]]`;
  }

  const markdownMatch =
    /^(!?\[[^\]\n]*(?:\\.[^\]\n]*)*\])\(([^)\s]*)#\^[A-Za-z0-9-]+(?:\s+[^)]*)?\)$/.exec(
      text,
    );
  if (markdownMatch) {
    return `${markdownMatch[1]}(${targetBasename}.md#^${id})`;
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
    return headerLines.length > 0 ? headerLines[headerLines.length - 1] : null;
  }

  for (const headerLine of headerLines) {
    if (headerLine > currentLine) {
      return headerLine;
    }
  }

  return headerLines.length > 0 ? headerLines[0] : null;
}

// True for a genuine Markdown checkbox list item that carries the Tasks
// plugin's standalone `#task` global-filter token. Status is deliberately not
// considered here: done and custom-status tasks remain valid task records.
function isObsidianTaskLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  if (!match) {
    return false;
  }

  const body = match[2] || "";
  return PROJECT_TASK_TAG_RE.test(body);
}

function getObsidianTaskCheckboxStatus(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return match && isObsidianTaskLine(lineText) ? match[1] : null;
}

function getObsidianTaskStatusRank(status) {
  const checkbox = String(status ?? "");
  return Object.prototype.hasOwnProperty.call(
    OBSIDIAN_TASK_STATUS_RANKS,
    checkbox,
  )
    ? OBSIDIAN_TASK_STATUS_RANKS[checkbox]
    : null;
}

function strongerObsidianTaskStatus(first, second) {
  const firstRank = getObsidianTaskStatusRank(first);
  const secondRank = getObsidianTaskStatusRank(second);
  if (firstRank === null) return secondRank === null ? null : second;
  if (secondRank === null) return first;
  return secondRank > firstRank ? second : first;
}

// Blocked is open for dependency semantics but intentionally has no active
// promotion rank. A blocked parent therefore contributes the minimum Ready
// request while Next and In Progress retain their existing ordering.
function getDependencyPromotionStatus(status) {
  return status === "?" ? " " : status;
}

function promoteObsidianTaskCheckboxStatus(lineText, desiredStatus) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  const currentRank = getObsidianTaskStatusRank(currentStatus);
  const desiredRank = getObsidianTaskStatusRank(desiredStatus);
  if (
    currentRank === null ||
    desiredRank === null ||
    currentRank >= desiredRank
  ) {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return (
    line.slice(0, checkboxOffset) +
    String(desiredStatus) +
    line.slice(checkboxOffset + 1)
  );
}

function blockObsidianTaskCheckboxStatus(lineText) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(currentStatus) || currentStatus === "?") {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return line.slice(0, checkboxOffset) + "?" + line.slice(checkboxOffset + 1);
}

function replaceObsidianTaskCheckboxStatus(
  lineText,
  replacement,
  expectedStatus = null,
) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  if (
    currentStatus === null ||
    (expectedStatus !== null && currentStatus !== expectedStatus) ||
    String(replacement || "").length !== 1
  ) {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return (
    line.slice(0, checkboxOffset) +
    replacement +
    line.slice(checkboxOffset + 1)
  );
}

function unavailableTasksStatusRegistry(error) {
  return Object.freeze({
    safe: false,
    error: String(error || "Tasks status registry is unavailable"),
    globalFilter: "#task",
    statusTypes: CONVENTIONAL_TASK_STATUS_TYPES,
  });
}

function parseTasksStatusRegistry(settings) {
  let value = settings;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_error) {
      return unavailableTasksStatusRegistry(
        "Tasks settings are not valid JSON",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailableTasksStatusRegistry("Tasks settings are unreadable");
  }

  const globalFilter =
    typeof value.globalFilter === "string"
      ? value.globalFilter
      : "#task";
  const statusTypes = { ...CONVENTIONAL_TASK_STATUS_TYPES };
  const configuredSymbols = new Set();
  const definitions = [];
  let ambiguous = false;
  for (const collection of ["coreStatuses", "customStatuses"]) {
    const statuses =
      value.statusSettings &&
      Array.isArray(value.statusSettings[collection])
        ? value.statusSettings[collection]
        : [];
    for (const status of statuses) {
      if (!status || typeof status !== "object") {
        ambiguous = true;
        continue;
      }
      const symbol =
        typeof status.symbol === "string" ? status.symbol : "";
      const characters = Array.from(symbol);
      if (characters.length !== 1) {
        ambiguous = true;
        continue;
      }
      if (configuredSymbols.has(symbol)) {
        ambiguous = true;
        continue;
      }
      configuredSymbols.add(symbol);
      const type =
        typeof status.type === "string" ? status.type : "TODO";
      statusTypes[symbol] = type;
      definitions.push({
        symbol,
        name: typeof status.name === "string" ? status.name : "",
        nextStatusSymbol:
          typeof status.nextStatusSymbol === "string"
            ? status.nextStatusSymbol
            : "",
        availableAsCommand: status.availableAsCommand === true,
        type,
      });
    }
  }

  const blocked = definitions.filter(
    (definition) =>
      definition.symbol === "?" ||
      definition.name.toLowerCase() === "blocked",
  );
  const compatibleBlocked =
    blocked.length === 1 &&
    blocked[0].symbol === "?" &&
    blocked[0].name === "Blocked" &&
    blocked[0].type === "ON_HOLD" &&
    blocked[0].nextStatusSymbol === " " &&
    blocked[0].availableAsCommand;
  const safe = !ambiguous && compatibleBlocked;
  return Object.freeze({
    safe,
    error: safe
      ? null
      : ambiguous
        ? "Tasks status registry is ambiguous"
        : "Tasks Blocked status is missing or incompatible",
    globalFilter,
    statusTypes: Object.freeze(statusTypes),
  });
}

function recoveryTaskStatusType(registry, status) {
  if (
    !registry ||
    !registry.statusTypes ||
    !Object.prototype.hasOwnProperty.call(registry.statusTypes, status)
  ) {
    return null;
  }
  return registry.statusTypes[status];
}

function parseRecoveryTaskDependencies(value) {
  const text = String(value || "");
  if (!text || text.includes("\t")) {
    return null;
  }
  const dependencies = text.split(",").map((part) => part.trim());
  return dependencies.every((dependency) =>
    TASKS_DEPENDENCY_ID_RE.test(dependency),
  )
    ? dependencies
    : null;
}

function validRecoveryTaskDateShape(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseTrailingRecoveryTaskMetadata(body) {
  let state = String(body || "").trimEnd();
  const trailingBlock = /\s+\^[A-Za-z0-9-]+\s*$/.exec(state);
  if (trailingBlock) {
    state = state.slice(0, trailingBlock.index).trimEnd();
  }
  const metadata = { taskId: null, dependsOn: [] };

  for (let iteration = 0; iteration < 20; iteration += 1) {
    state = state.trimEnd().replace(/,\s*$/, "").trimEnd();
    const close = state.at(-1);
    const open = close === "]" ? "[" : close === ")" ? "(" : null;
    if (!open) {
      const tag = /(?:^|\s)#[^\s#]+$/.exec(state);
      if (tag) {
        state = state.slice(0, tag.index).trimEnd();
        continue;
      }
      break;
    }
    const start = state.lastIndexOf(open);
    if (start === -1) {
      break;
    }
    const inner = state.slice(start + 1, -1).trim();
    const delimiter = inner.indexOf("::");
    if (delimiter === -1) {
      break;
    }
    const key = inner.slice(0, delimiter);
    const value = inner.slice(delimiter + 2).trim();
    let recognized = false;
    if (key === "id" && TASKS_DEPENDENCY_ID_RE.test(value)) {
      metadata.taskId = value;
      recognized = true;
    } else if (key === "dependsOn") {
      const dependencies = parseRecoveryTaskDependencies(value);
      if (dependencies) {
        metadata.dependsOn = dependencies;
        recognized = true;
      }
    } else if (key === "priority") {
      recognized = [
        "highest",
        "high",
        "medium",
        "low",
        "lowest",
      ].includes(value);
    } else if (key === "scheduled") {
      recognized = validateProjectScheduledDate(value).valid;
    } else if (
      ["start", "created", "due", "completion", "cancelled"].includes(key)
    ) {
      recognized = validRecoveryTaskDateShape(value);
    } else if (key === "repeat") {
      recognized = /^[A-Za-z0-9, !]*$/.test(value);
    } else if (key === "onCompletion") {
      recognized = /^[A-Za-z]+$/.test(value);
    }
    if (!recognized) {
      break;
    }
    state = state.slice(0, start).trimEnd();
  }
  return metadata;
}

function parseScheduledRecoveryTaskLine(
  lineText,
  registry,
  line = -1,
) {
  const text = String(lineText || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[2] || "";
  const globalFilter =
    registry && typeof registry.globalFilter === "string"
      ? registry.globalFilter
      : "#task";
  if (!body.includes(globalFilter)) {
    return null;
  }
  const status = match[1];
  const statusType = recoveryTaskStatusType(registry, status);
  const metadata = parseTrailingRecoveryTaskMetadata(body);
  return Object.freeze({
    line,
    text,
    status,
    statusType,
    statusRecognized: statusType !== null,
    blockId: getTrailingBlockId(text),
    taskId: metadata.taskId,
    dependsOn: Object.freeze(metadata.dependsOn.slice()),
  });
}

function recoveryIdentity(path, blockId) {
  return `${normalizeVaultRelativePath(path)}\u0000${String(blockId || "")}`;
}

function isScheduledRecoveryMarkdownPath(path) {
  const normalized = normalizeVaultRelativePath(path);
  if (!MARKDOWN_EXTENSION_RE.test(normalized)) {
    return false;
  }
  const directories = normalized.split("/").slice(0, -1);
  return !directories.some(
    (directory) =>
      directory === "done" ||
      directory === "_generated" ||
      directory === "_templates" ||
      directory.startsWith("."),
  );
}

function canonicalRecoveryMarkdownPath(target) {
  const text = normalizeVaultRelativePath(target);
  if (
    !text ||
    text.startsWith("/") ||
    text.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return MARKDOWN_EXTENSION_RE.test(text) ? text : `${text}.md`;
}

function recoveryMarkdownBasename(path) {
  const parts = normalizeVaultRelativePath(path).split("/");
  return String(parts.at(-1) || "").replace(MARKDOWN_EXTENSION_RE, "");
}

function createScheduledRecoveryNoteIndex(files) {
  const paths = new Set();
  const basenames = new Map();
  let duplicatePath = false;
  for (const file of files) {
    const path = normalizeVaultRelativePath(file.path);
    if (paths.has(path)) {
      duplicatePath = true;
      continue;
    }
    paths.add(path);
    const basename = recoveryMarkdownBasename(path).toLowerCase();
    if (!basenames.has(basename)) {
      basenames.set(basename, path);
    } else if (basenames.get(basename) !== path) {
      basenames.set(basename, null);
    }
  }
  return { paths, basenames, duplicatePath };
}

function resolveScheduledRecoveryNote(index, sourcePath, target) {
  const rawTarget = String(target || "").trim();
  if (!rawTarget) {
    return normalizeVaultRelativePath(sourcePath);
  }
  const exact = canonicalRecoveryMarkdownPath(rawTarget);
  if (!exact) {
    return null;
  }
  if (index.paths.has(exact)) {
    return exact;
  }
  return index.basenames.get(recoveryMarkdownBasename(exact).toLowerCase()) || null;
}

function parseRecoveryTransclusion(lineText) {
  const match =
    /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+!\[\[([^#|\]\n]*)#\^([A-Za-z0-9-]+)\]\]\s*$/.exec(
      String(lineText || ""),
    );
  return match
    ? Object.freeze({ target: match[1].trim(), blockId: match[2] })
    : null;
}

function recoveryStrikethroughSpans(lineText) {
  const text = String(lineText || "");
  const delimiters = [];
  let offset = 0;
  while ((offset = text.indexOf("~~", offset)) !== -1) {
    delimiters.push(offset);
    offset += 2;
  }
  const spans = [];
  for (let index = 0; index + 1 < delimiters.length; index += 2) {
    spans.push({ start: delimiters[index], end: delimiters[index + 1] + 2 });
  }
  return spans;
}

function recoveryBlockReferences(lineText) {
  const text = String(lineText || "");
  const spans = recoveryStrikethroughSpans(text);
  const references = [];
  const pattern = /!?\[\[([^|\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;
  let match = null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const retired = spans.some(
      (span) => start >= span.start + 2 && end <= span.end - 2,
    );
    if (!retired) {
      references.push(
        Object.freeze({ target: match[1].trim(), blockId: match[2] }),
      );
    }
  }
  return references;
}

function recentPomodoroReferences(content) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const heading = lines.findIndex(
    (line, index) =>
      !contexts[index].inFrontmatter &&
      !contexts[index].inFence &&
      isPomodorosHeading(line),
  );
  if (heading === -1) {
    return Object.freeze([]);
  }
  const references = [];
  let eligibleEntry = false;
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (!contexts[index].inFence && isLevelTwoHeading(line)) {
      break;
    }
    if (contexts[index].inFence) {
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const entry = /^-\s+\[([^\]\n])\](?:\s+(.*))?$/.exec(line);
      eligibleEntry = Boolean(
        entry && POMODORO_NAVIGATION_STATUSES.has(entry[1]),
      );
      continue;
    }
    if (line.trim() && !/^[ \t]/.test(line)) {
      eligibleEntry = false;
      continue;
    }
    if (!eligibleEntry || !/^\s+(?:[-*+]|\d+[.)])\s+/.test(line)) {
      continue;
    }
    references.push(...recoveryBlockReferences(line));
  }
  return Object.freeze(references);
}

function canonicalRecoveryDailyDate(path) {
  const match = /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/.exec(
    normalizeVaultRelativePath(path),
  );
  if (!match || match[1] !== match[2]) {
    return null;
  }
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (!isValidDateParts(match[2], match[3], match[4])) {
    return null;
  }
  return Object.freeze({
    value: year * 10000 + month * 100 + day,
    path: normalizeVaultRelativePath(path),
  });
}

function scheduledRecoveryDailyPaths(files, today = new Date()) {
  const localToday = getLocalDateStart(today);
  const todayValue =
    localToday.getFullYear() * 10000 +
    (localToday.getMonth() + 1) * 100 +
    localToday.getDate();
  const dates = files
    .map((file) => canonicalRecoveryDailyDate(file.path))
    .filter(Boolean);
  const current = dates.find((entry) => entry.value === todayValue) || null;
  const previous =
    dates
      .filter((entry) => entry.value < todayValue)
      .sort((left, right) => right.value - left.value)[0] || null;
  return Object.freeze({
    current: current ? current.path : null,
    previous: previous ? previous.path : null,
  });
}

function strongestScheduledRecoveryRank(tasks) {
  let rank = null;
  for (const task of tasks || []) {
    const current = getObsidianTaskStatusRank(task.status);
    if (current !== null && (rank === null || current > rank)) {
      rank = current;
    }
  }
  return rank;
}

function computeScheduledRecoveryRanks(roots, edges, blocks) {
  const ranks = new Map();
  const queue = [];
  for (const root of roots) {
    const rank = Math.max(1, strongestScheduledRecoveryRank(blocks.get(root)) ?? 1);
    if (!ranks.has(root) || ranks.get(root) < rank) {
      ranks.set(root, rank);
      queue.push(root);
    }
  }
  while (queue.length > 0) {
    const source = queue.shift();
    const sourceRank = ranks.get(source);
    for (const target of edges.get(source) || []) {
      const targetRank = Math.max(
        sourceRank,
        strongestScheduledRecoveryRank(blocks.get(target)) ?? sourceRank,
      );
      if (!ranks.has(target) || ranks.get(target) < targetRank) {
        ranks.set(target, targetRank);
        queue.push(target);
      }
    }
  }
  return ranks;
}

function deferredScheduledRecovery(reason) {
  return Object.freeze({
    state: "deferred",
    rank: null,
    reason: String(reason || "status reconciliation is unsafe"),
  });
}

function buildScheduledRecoveryIndex(files, registry, today = new Date()) {
  const markdownFiles = (Array.isArray(files) ? files : [])
    .filter((file) => isScheduledRecoveryMarkdownPath(file.path))
    .map((file) => ({
      path: normalizeVaultRelativePath(file.path),
      content: String(file.content || ""),
    }));
  const noteIndex = createScheduledRecoveryNoteIndex(markdownFiles);
  const tasksByTarget = new Map();
  const blocks = new Map();
  const dependencyIds = new Map();
  const fileModels = new Map();
  let rankSafe = !noteIndex.duplicatePath;

  for (const file of markdownFiles) {
    const { lines } = splitMarkdownContent(file.content);
    const contexts = getMarkdownLineContexts(file.content);
    const tasks = [];
    for (let line = 0; line < lines.length; line += 1) {
      if (contexts[line].inFrontmatter || contexts[line].inFence) {
        continue;
      }
      const task = parseScheduledRecoveryTaskLine(
        lines[line],
        registry,
        line,
      );
      if (!task) {
        continue;
      }
      tasks.push(task);
      tasksByTarget.set(recoveryIdentity(file.path, String(line)), task);
      if (task.blockId) {
        const identity = recoveryIdentity(file.path, task.blockId);
        if (!blocks.has(identity)) {
          blocks.set(identity, []);
        }
        blocks.get(identity).push(task);
      }
      if (task.taskId) {
        if (!dependencyIds.has(task.taskId)) {
          dependencyIds.set(task.taskId, []);
        }
        dependencyIds.get(task.taskId).push(task);
      }
    }
    fileModels.set(file.path, { file, lines, contexts, tasks });
  }

  const edges = new Map();
  for (const [path, model] of fileModels) {
    for (const task of model.tasks) {
      if (!task.blockId) {
        continue;
      }
      const source = recoveryIdentity(path, task.blockId);
      const sourceIndent = getBulletIndentWidth(model.lines[task.line]);
      for (let line = task.line + 1; line < model.lines.length; line += 1) {
        const lineText = String(model.lines[line] || "");
        if (!lineText.trim() || model.contexts[line].inFence) {
          continue;
        }
        if (getBulletIndentWidth(lineText) <= sourceIndent) {
          break;
        }
        if (findNearestParentListItem(model.lines, line) !== task.line) {
          continue;
        }
        const reference = parseRecoveryTransclusion(lineText);
        if (!reference) {
          continue;
        }
        const targetPath = resolveScheduledRecoveryNote(
          noteIndex,
          path,
          reference.target,
        );
        const target = targetPath
          ? recoveryIdentity(targetPath, reference.blockId)
          : null;
        if (!target || !blocks.has(target)) {
          rankSafe = false;
          continue;
        }
        if (!edges.has(source)) {
          edges.set(source, new Set());
        }
        edges.get(source).add(target);
      }
    }
  }

  const dailyPaths = scheduledRecoveryDailyPaths(markdownFiles, today);
  const roots = new Set();
  for (const dailyPath of [dailyPaths.current, dailyPaths.previous]) {
    if (!dailyPath) {
      continue;
    }
    const daily = fileModels.get(dailyPath);
    for (const reference of recentPomodoroReferences(daily.file.content)) {
      const targetPath = resolveScheduledRecoveryNote(
        noteIndex,
        dailyPath,
        reference.target,
      );
      const target = targetPath
        ? recoveryIdentity(targetPath, reference.blockId)
        : null;
      if (!target || !blocks.has(target)) {
        rankSafe = false;
        continue;
      }
      roots.add(target);
    }
  }
  const ranks = computeScheduledRecoveryRanks(roots, edges, blocks);

  return Object.freeze({
    safe: Boolean(registry && registry.safe),
    error:
      registry && registry.safe
        ? null
        : registry && registry.error
          ? registry.error
          : "Tasks status registry is unavailable",
    rankSafe,
    registry,
    tasksByTarget,
    blocks,
    dependencyIds,
    ranks,
    dailyPaths,
  });
}

function getScheduledRecoveryMetadata(index, filePath, line) {
  if (!index || !index.registry || !index.registry.safe) {
    return deferredScheduledRecovery(
      index && index.error
        ? index.error
        : "Tasks status registry is unavailable",
    );
  }
  const path = normalizeVaultRelativePath(filePath);
  const task = index.tasksByTarget.get(
    recoveryIdentity(path, String(line)),
  );
  if (!task || task.status !== "?" || !task.statusRecognized) {
    return deferredScheduledRecovery(
      "selected Blocked task could not be identified safely",
    );
  }

  let dependencyAmbiguous = false;
  for (const dependency of task.dependsOn) {
    const matches = index.dependencyIds.get(dependency);
    if (!matches) {
      continue;
    }
    let open = false;
    let unknown = false;
    for (const target of matches) {
      const type = target.statusType;
      if (
        target.statusRecognized &&
        TASK_STATUS_OPEN_TYPES.has(type)
      ) {
        open = true;
      } else if (
        !target.statusRecognized ||
        !TASK_STATUS_CLOSED_TYPES.has(type)
      ) {
        unknown = true;
      }
    }
    if (open) {
      return Object.freeze({
        state: "blocked",
        rank: null,
        reason: `open dependency: ${dependency}`,
      });
    }
    dependencyAmbiguous ||= unknown;
  }
  if (dependencyAmbiguous) {
    return deferredScheduledRecovery(
      "dependency status could not be resolved safely",
    );
  }
  if (!task.blockId) {
    return Object.freeze({ state: "ready", rank: " ", reason: null });
  }
  const identity = recoveryIdentity(path, task.blockId);
  if ((index.blocks.get(identity) || []).length !== 1) {
    return deferredScheduledRecovery("task block identity is ambiguous");
  }
  if (!index.rankSafe) {
    return deferredScheduledRecovery(
      "recent activity could not be resolved safely",
    );
  }
  const rank = index.ranks.get(identity);
  if (rank === 2) {
    return Object.freeze({
      state: "in-progress",
      rank: "/",
      reason: null,
    });
  }
  if (rank === 1) {
    return Object.freeze({ state: "next", rank: "*", reason: null });
  }
  return Object.freeze({ state: "ready", rank: " ", reason: null });
}

async function readTasksStatusRegistry(app) {
  const vault = app && app.vault;
  if (!vault) {
    return unavailableTasksStatusRegistry("Vault is unavailable");
  }
  try {
    const settingsFile =
      typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(TASKS_SETTINGS_PATH)
        : null;
    let contents = null;
    if (settingsFile && typeof vault.read === "function") {
      contents = await vault.read(settingsFile);
    } else if (
      vault.adapter &&
      typeof vault.adapter.read === "function"
    ) {
      contents = await vault.adapter.read(TASKS_SETTINGS_PATH);
    } else if (settingsFile && typeof vault.cachedRead === "function") {
      contents = await vault.cachedRead(settingsFile);
    }
    if (contents === null) {
      return unavailableTasksStatusRegistry("Tasks settings are unavailable");
    }
    return parseTasksStatusRegistry(contents);
  } catch (_error) {
    return unavailableTasksStatusRegistry("Tasks settings could not be read");
  }
}

function getOpenMarkdownBufferContents(app) {
  const buffers = new Map();
  buffers.ambiguous = false;
  const workspace = app && app.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") {
    return buffers;
  }
  for (const leaf of workspace.getLeavesOfType("markdown") || []) {
    const view = leaf && leaf.view;
    if (
      view &&
      view.file &&
      view.file.path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      const path = normalizeVaultRelativePath(view.file.path);
      const content = String(view.editor.getValue() || "");
      if (buffers.has(path) && buffers.get(path) !== content) {
        buffers.ambiguous = true;
      }
      buffers.set(path, content);
    }
  }
  return buffers;
}

async function buildInteractiveScheduledRecoverySnapshot(
  app,
  options = {},
) {
  const vault = app && app.vault;
  if (!vault || typeof vault.getMarkdownFiles !== "function") {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry("Vault Markdown files are unavailable"),
      options.today || new Date(),
    );
  }
  const registryPromise = readTasksStatusRegistry(app);
  const buffers = getOpenMarkdownBufferContents(app);
  if (buffers.ambiguous) {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry(
        "Open Markdown buffers are ambiguous",
      ),
      options.today || new Date(),
    );
  }
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  if (sourcePath) {
    buffers.set(sourcePath, String(options.sourceContent || ""));
  }
  const vaultFiles = vault.getMarkdownFiles() || [];
  const files = [];
  try {
    for (const file of vaultFiles) {
      const path = normalizeVaultRelativePath(file.path);
      const content = buffers.has(path)
        ? buffers.get(path)
        : typeof vault.cachedRead === "function"
          ? await vault.cachedRead(file)
          : null;
      if (content === null) {
        throw new Error("Markdown file could not be read");
      }
      files.push({ path, content: String(content || "") });
    }
    if (sourcePath && !files.some((file) => file.path === sourcePath)) {
      files.push({
        path: sourcePath,
        content: String(options.sourceContent || ""),
      });
    }
  } catch (_error) {
    return buildScheduledRecoveryIndex(
      [],
      unavailableTasksStatusRegistry("Vault Markdown files could not be read"),
      options.today || new Date(),
    );
  }
  return buildScheduledRecoveryIndex(
    files,
    await registryPromise,
    options.today || new Date(),
  );
}

async function buildTargetScheduledRecoveryByLine(
  app,
  sourcePath,
  sourceContent,
  targetLines,
  today = new Date(),
) {
  const snapshot = await buildInteractiveScheduledRecoverySnapshot(app, {
    sourcePath,
    sourceContent,
    today,
  });
  return new Map(
    (Array.isArray(targetLines) ? targetLines : [targetLines]).map((line) => [
      line,
      getScheduledRecoveryMetadata(snapshot, sourcePath, line),
    ]),
  );
}

// The dependency picker intentionally offers only open tasks. Keep that
// lifecycle filter separate from the general valid-task predicate above.
function isOpenObsidianTaskLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return Boolean(
    match &&
      isObsidianTaskLine(lineText) &&
      OPEN_OBSIDIAN_TASK_STATUSES.has(match[1]),
  );
}

// True for a proper `#task` line whose checkbox is an active navigation
// target (Ready, In Progress, or Next). Blocked tasks remain open via
// `isOpenObsidianTaskLine` but are omitted from Ctrl+Shift+J/K jumps.
function isActiveObsidianTaskNavigationLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return Boolean(
    match &&
      isObsidianTaskLine(lineText) &&
      ACTIVE_OBSIDIAN_TASK_NAVIGATION_STATUSES.has(match[1]),
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

// Checkbox statuses that make a top-level Pomodoro ledger entry closed.
// Mirrors `pomodoro::open_ledger_task` in bob-cli (src/native/pomodoro.rs):
// any single-character checkbox other than `x`/`X`/`-` counts as open.
const POMODORO_LEDGER_CLOSED_STATUSES = new Set(["x", "X", "-"]);
// Column-0 (`- [c] ...`) ledger line only — the same shape
// `pomodoro::open_ledger_task` requires before it inspects the checkbox.
const POMODORO_LEDGER_TOP_LEVEL_LINE_RE = /^-[ \t]+\[([^\]])\](?:[ \t]+(.*))?$/;

// True for a top-level open Pomodoro ledger entry: a column-0 `- [c] ...` line
// whose checkbox is not closed (`x`, `X`, or `-`). This is deliberately
// broader than `isPomodoroNavigationTaskLine` above — it has no placeholder/
// time-range requirement and it recognizes `[*]`/`[?]` as open — because it
// mirrors `pomodoro::open_ledger_task`, the exact rule `bob task-status-hooks`
// uses to decide which Pomodoro entries seed its promotion graph.
function isOpenPomodoroLedgerEntryLine(lineText) {
  const match = POMODORO_LEDGER_TOP_LEVEL_LINE_RE.exec(String(lineText || ""));
  return Boolean(match && !POMODORO_LEDGER_CLOSED_STATUSES.has(match[1]));
}

// The line range of the first unfenced `## Pomodoros` heading and its section
// body (up to but excluding the next unfenced level-two heading, or EOF).
// Returns null when the note has no such section. Frontmatter and fenced code
// are excluded via `getMarkdownLineContexts` so a heading-shaped line inside
// either is never mistaken for the section boundary.
function findPomodorosSectionRange(content) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const startLine = lines.findIndex(
    (line, index) =>
      !contexts[index].inFrontmatter &&
      !contexts[index].inFence &&
      isPomodorosHeading(line),
  );
  if (startLine === -1) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (!contexts[index].inFence && isLevelTwoHeading(lines[index])) {
      endLine = index - 1;
      break;
    }
  }

  return Object.freeze({ startLine, endLine });
}

// Every open Pomodoro entry inside `section`, each with the line range of its
// sub-bullets (`startLine`..`endLine`, inclusive, possibly empty). A closed
// entry's block is skipped entirely: its child lines never satisfy the
// column-0 entry regex, so they cannot be mistaken for entries themselves.
function collectOpenPomodoroRanges(lines, contexts, section) {
  if (!section) {
    return [];
  }

  const ranges = [];
  for (let line = section.startLine + 1; line <= section.endLine; line += 1) {
    if (contexts[line] && contexts[line].inFence) {
      continue;
    }
    if (!isOpenPomodoroLedgerEntryLine(lines[line])) {
      continue;
    }
    const block = findCurrentBulletChildBlock(lines, line);
    const endLine = Math.min(block.endLineExclusive - 1, section.endLine);
    ranges.push(Object.freeze({ entryLine: line, startLine: line + 1, endLine }));
  }
  return ranges;
}

// Every `[[target#^id]]` / `![[target#^id]]` occurrence on one line, including
// an optional leading run of `🍅 ` markers in its span so a stray marker is
// never left orphaned when the link is removed. `struck` is true when the
// link itself (not the marker) sits inside a `~~...~~` span, using the same
// containment rule as `recoveryBlockReferences`.
const POMODORO_BLOCK_LINK_RE =
  /((?:🍅[ \t]+)*)(!)?\[\[([^|\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;

function collectPomodoroBlockLinkOccurrences(lineText) {
  const line = String(lineText || "");
  const strikeSpans = recoveryStrikethroughSpans(line);
  const occurrences = [];
  POMODORO_BLOCK_LINK_RE.lastIndex = 0;
  let match = null;
  while ((match = POMODORO_BLOCK_LINK_RE.exec(line)) !== null) {
    const markerRun = match[1] || "";
    const start = match.index;
    const end = match.index + match[0].length;
    const linkStart = start + markerRun.length;
    const struck = strikeSpans.some(
      (span) => linkStart >= span.start + 2 && end <= span.end - 2,
    );
    occurrences.push(
      Object.freeze({
        start,
        end,
        markerStart: markerRun ? start : null,
        target: match[3].trim(),
        blockId: match[4],
        embedded: Boolean(match[2]),
        struck,
      }),
    );
  }
  return occurrences;
}

// The trimmed body span of a list-item line (indent + marker + trailing
// whitespace excluded on both ends), or null when the line is not a list item
// or its body is empty.
function pomodoroBulletBodyBounds(lineText) {
  const line = String(lineText || "");
  const match = PROJECT_LIST_ITEM_RE.exec(line);
  if (!match) {
    return null;
  }
  const start = match[0].length;
  let end = line.length;
  while (end > start && /[ \t]/.test(line[end - 1])) {
    end -= 1;
  }
  return start < end ? Object.freeze({ start, end }) : null;
}

// True when one or more matched link occurrences make up a bullet's entire
// body (only whitespace, if anything, between adjacent occurrences). Two
// matched links on one otherwise-empty bullet still count as dedicated.
function isDedicatedPomodoroLinkLine(lineText, occurrences) {
  const bounds = pomodoroBulletBodyBounds(lineText);
  const list = Array.isArray(occurrences) ? occurrences : [];
  if (!bounds || list.length === 0) {
    return false;
  }
  const sorted = list.slice().sort((left, right) => left.start - right.start);
  if (
    sorted[0].start !== bounds.start ||
    sorted[sorted.length - 1].end !== bounds.end
  ) {
    return false;
  }
  const line = String(lineText || "");
  for (let index = 1; index < sorted.length; index += 1) {
    if (line.slice(sorted[index - 1].end, sorted[index].start).trim() !== "") {
      return false;
    }
  }
  return true;
}

// Parse a column-0 Pomodoro ledger entry line into its grammar parts, or null
// when the line is not a well-formed entry (wrong shape, indented, or a body
// that is not an empty `()` placeholder / time range). The name suffix, when
// present, is parsed only from the text after the parenthetical's closing
// `)`, so metadata such as `[t:: 30m]` can never be mistaken for it.
function parsePomodoroEntryLine(lineText) {
  const line = String(lineText || "");
  const match = POMODORO_LEDGER_TOP_LEVEL_LINE_RE.exec(line);
  if (!match) {
    return null;
  }
  const status = match[1];
  const body = match[2] || "";
  const bodyStart = line.length - body.length;

  let rangeMatch = POMODORO_PLACEHOLDER_RE.exec(body);
  let placeholder = Boolean(rangeMatch && rangeMatch.index === 0);
  if (!placeholder) {
    rangeMatch = POMODORO_COLON_TIME_RANGE_RE.exec(body);
    if (!rangeMatch || rangeMatch.index !== 0) {
      rangeMatch = POMODORO_COMPACT_TIME_RANGE_RE.exec(body);
    }
  }
  if (!rangeMatch || rangeMatch.index !== 0) {
    return null;
  }

  const rangeStart = bodyStart;
  const rangeEnd = bodyStart + rangeMatch[0].length;
  const rangeText = line.slice(rangeStart, rangeEnd);

  let name = null;
  let nameStart = null;
  let nameEnd = null;
  const tail = body.slice(rangeMatch[0].length);
  const tailMatch = POMODORO_NAME_TAIL_RE.exec(tail);
  if (tailMatch) {
    const rawName = tailMatch[1];
    const trimmedName = rawName.trim();
    const leadingTrimLength = rawName.length - rawName.replace(/^\s+/, "").length;
    const groupOffsetInTail = tailMatch[0].length - rawName.length;
    name = trimmedName;
    nameStart = rangeEnd + groupOffsetInTail + leadingTrimLength;
    nameEnd = nameStart + trimmedName.length;
  }

  return Object.freeze({
    indent: "",
    status,
    open: !POMODORO_LEDGER_CLOSED_STATUSES.has(status),
    bodyStart,
    rangeText,
    rangeStart,
    rangeEnd,
    placeholder,
    name,
    nameStart,
    nameEnd,
  });
}

// Normalize a raw typed or parsed Pomodoro name: strip every em dash,
// collapse whitespace runs to one space, trim, then uppercase. Invalid when
// the result is empty or longer than POMODORO_NAME_MAX_LENGTH.
function normalizePomodoroName(raw) {
  const stripped = String(raw || "").split(POMODORO_NAME_SEPARATOR).join("");
  const name = stripped.replace(/\s+/g, " ").trim().toUpperCase();
  if (!name) {
    return Object.freeze({
      valid: false,
      name: "",
      error: "Pomodoro name cannot be empty",
    });
  }
  if (name.length > POMODORO_NAME_MAX_LENGTH) {
    return Object.freeze({
      valid: false,
      name: "",
      error: `Pomodoro name cannot exceed ${POMODORO_NAME_MAX_LENGTH} characters`,
    });
  }
  return Object.freeze({ valid: true, name, error: null });
}

// Format a brand-new Pomodoro ledger entry line. `name` is expected to
// already be normalized (see normalizePomodoroName); an empty name yields an
// unnamed placeholder entry.
function formatPomodoroEntryLine(name) {
  const trimmed = String(name || "").trim();
  return trimmed
    ? `- [ ] () ${POMODORO_NAME_SEPARATOR} ${trimmed}`
    : "- [ ] ()";
}

// Every Pomodoro ledger entry inside the note's `## Pomodoros` section (open
// and closed), each with its child sub-bullet range and picker-facing
// preview fields. Returns `{ section: null, entries: [] }` when the note has
// no such section.
function collectPomodoroEntries(content) {
  const text = String(content || "");
  const section = findPomodorosSectionRange(text);
  if (!section) {
    return Object.freeze({ section: null, entries: Object.freeze([]) });
  }

  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const entries = [];
  let position = 0;

  for (let line = section.startLine + 1; line <= section.endLine; line += 1) {
    if (contexts[line] && contexts[line].inFence) {
      continue;
    }
    const parsed = parsePomodoroEntryLine(lines[line]);
    if (!parsed) {
      continue;
    }
    position += 1;

    const block = findCurrentBulletChildBlock(lines, line);
    const childStartLine = block.startLine;
    const childEndLineExclusive = Math.min(
      block.endLineExclusive,
      section.endLine + 1,
    );

    const childListIndexes = [];
    for (
      let childLine = childStartLine;
      childLine < childEndLineExclusive;
      childLine += 1
    ) {
      if (PROJECT_LIST_ITEM_RE.test(String(lines[childLine] || ""))) {
        childListIndexes.push(childLine);
      }
    }
    const childIndent =
      childListIndexes.length > 0
        ? getBulletIndent(String(lines[childListIndexes[0]] || ""))
        : "\t";
    const childIndentWidth = getBulletIndentWidth(childIndent);
    const bulletLines = Object.freeze(
      childListIndexes
        .filter(
          (childLine) =>
            getBulletIndentWidth(String(lines[childLine] || "")) ===
            childIndentWidth,
        )
        .map((childLine) => String(lines[childLine] || "")),
    );
    const firstBounds =
      bulletLines.length > 0 ? pomodoroBulletBodyBounds(bulletLines[0]) : null;
    const previewText = firstBounds
      ? bulletLines[0].slice(firstBounds.start, firstBounds.end)
      : "";
    const moreCount = bulletLines.length > 0 ? bulletLines.length - 1 : 0;

    entries.push(
      Object.freeze({
        index: entries.length,
        position,
        entryLine: line,
        status: parsed.status,
        open: parsed.open,
        name: parsed.name,
        rangeText: parsed.rangeText,
        placeholder: parsed.placeholder,
        childStartLine,
        childEndLineExclusive,
        childIndent,
        bulletLines,
        previewText,
        moreCount,
      }),
    );
  }

  return Object.freeze({ section, entries: Object.freeze(entries) });
}

// The Pomodoro ledger entry that owns the sub-bullet at `line`, or null when
// `line` is not a list item inside any entry's child block.
function findPomodoroBulletContext(content, line) {
  const text = String(content || "");
  const { entries, section } = collectPomodoroEntries(text);
  const lineIndex = Math.floor(numericOrDefault(line, Number.NaN));
  if (!section || !Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }
  const { lines } = splitMarkdownContent(text);
  const lineText = String(lines[lineIndex] || "");
  if (!PROJECT_LIST_ITEM_RE.test(lineText)) {
    return null;
  }
  const entryIndex = entries.findIndex(
    (entry) =>
      lineIndex >= entry.childStartLine &&
      lineIndex < entry.childEndLineExclusive,
  );
  if (entryIndex === -1) {
    return null;
  }
  return Object.freeze({
    entries,
    section,
    entry: entries[entryIndex],
    entryIndex,
    line: lineIndex,
    depth: getBulletIndentWidth(lineText),
  });
}

// The Pomodoro ledger entry whose own entry line is exactly `line`, or null
// otherwise. Disjoint from findPomodoroBulletContext: an entry's child block
// starts at entryLine + 1, so an entry line never resolves as a sub-bullet.
function findPomodoroEntryContext(content, line) {
  const text = String(content || "");
  const { entries, section } = collectPomodoroEntries(text);
  const lineIndex = Math.floor(numericOrDefault(line, Number.NaN));
  if (!section || !Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }
  const entryIndex = entries.findIndex(
    (entry) => entry.entryLine === lineIndex,
  );
  if (entryIndex === -1) {
    return null;
  }
  return Object.freeze({
    entries,
    section,
    entry: entries[entryIndex],
    entryIndex,
    entryLine: lineIndex,
  });
}

// Every top-level child bullet a Pomodoro entry owns, classified as movable
// or droppable ahead of a whole-entry move-and-delete. A bullet is droppable
// when it is an empty placeholder line (no body, no descendants); everything
// else is movable. Zero movable targets is valid: it is the "delete this
// empty Pomodoro" case. Mirrors the frozen shape of
// discoverMovablePomodoroBulletTargets.
function discoverPomodoroEntryMoveTargets(content, line) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const context = findPomodoroEntryContext(text, line);

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      entryLine: null,
      rawEntryLine: null,
      targets: Object.freeze([]),
      droppedLines: Object.freeze([]),
      bulletCount: 0,
      entry: null,
      entries: Object.freeze([]),
      context: null,
    });

  if (!context) {
    return invalid("Place the cursor on a Pomodoro entry");
  }

  const { entry } = context;
  const childIndentWidth = getBulletIndentWidth(entry.childIndent);
  const targets = [];
  const droppedLines = [];
  for (
    let lineIndex = entry.childStartLine;
    lineIndex < entry.childEndLineExclusive;
    lineIndex += 1
  ) {
    const lineText = String(lines[lineIndex] || "");
    if (
      !PROJECT_LIST_ITEM_RE.test(lineText) ||
      getBulletIndentWidth(lineText) !== childIndentWidth
    ) {
      continue;
    }
    const subtree = capturePomodoroBulletSubtree(
      lines,
      lineIndex,
      entry.childEndLineExclusive,
    );
    const isDroppable =
      pomodoroBulletBodyBounds(lineText) === null &&
      subtree.endLineExclusive - subtree.startLine === 1;
    const record = Object.freeze({ line: lineIndex, rawLine: lineText });
    if (isDroppable) {
      droppedLines.push(record);
    } else {
      targets.push(record);
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    entryLine: entry.entryLine,
    rawEntryLine: String(lines[entry.entryLine] || ""),
    targets: Object.freeze(targets),
    droppedLines: Object.freeze(droppedLines),
    bulletCount: targets.length,
    entry,
    entries: context.entries,
    context,
  });
}

// Sibling targets for a Pomodoro bullet move: the bullet at `startLine` plus
// the next `additionalBulletCount` siblings at its own indent depth, inside
// the same Pomodoro entry's child block. Mirrors the frozen shape of
// discoverMovableObsidianTaskTargets.
function discoverMovablePomodoroBulletTargets(
  content,
  startLine,
  additionalBulletCount,
) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalBulletCount, 0)),
  );
  const requestedCount = additional + 1;
  const context = findPomodoroBulletContext(text, line);

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      explicit: additional > 0,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
      entryLine: null,
      context: null,
    });

  if (!context) {
    return invalid("Place the cursor on a Pomodoro sub-bullet");
  }

  const { entry, depth } = context;
  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < entry.childEndLineExclusive && targets.length < requestedCount;
    lineIndex += 1
  ) {
    const lineText = String(lines[lineIndex] || "");
    if (
      PROJECT_LIST_ITEM_RE.test(lineText) &&
      getBulletIndentWidth(lineText) === depth
    ) {
      targets.push(Object.freeze({ line: lineIndex, rawLine: lineText }));
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: additional > 0,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
    entryLine: entry.entryLine,
    context,
  });
}

// Capture one Pomodoro bullet's subtree: the target line plus every
// following line whose indent display width exceeds the target's, bounded by
// `boundExclusive`. Blank lines are retained only when deeper content
// follows, mirroring captureTaskMoveSubtree's pendingBlankEnd rule. `root` is
// shaped for rebaseTaskMoveBlock.
function capturePomodoroBulletSubtree(lines, targetLine, boundExclusive) {
  const rootWidth = getBulletIndentWidth(String(lines[targetLine] || ""));
  let endLineExclusive = targetLine + 1;
  let pendingBlankEnd = endLineExclusive;
  for (let index = targetLine + 1; index < boundExclusive; index += 1) {
    const candidate = String(lines[index] || "");
    if (candidate.trim() === "") {
      pendingBlankEnd = index + 1;
      continue;
    }
    if (getBulletIndentWidth(candidate) <= rootWidth) {
      break;
    }
    endLineExclusive = index + 1;
    pendingBlankEnd = endLineExclusive;
  }
  return Object.freeze({
    startLine: targetLine,
    endLineExclusive,
    lines: Object.freeze(lines.slice(targetLine, endLineExclusive)),
    root: parseTaskMoveListItem(String(lines[targetLine] || "")),
  });
}

// Remove a set of non-overlapping captured Pomodoro bullet ranges from
// `lines`, collapsing a doubled blank seam exactly as removeTaskMoveRanges
// does. Returns a new line array.
function removePomodoroBulletRanges(lines, ranges) {
  const nextLines = lines.slice();
  const ordered = (Array.isArray(ranges) ? ranges : [])
    .slice()
    .sort((left, right) => right.startLine - left.startLine);
  for (const range of ordered) {
    let deleteCount = range.endLineExclusive - range.startLine;
    const before = nextLines[range.startLine - 1];
    const after = nextLines[range.endLineExclusive];
    if (
      before !== undefined &&
      after !== undefined &&
      String(before).trim() === "" &&
      String(after).trim() === ""
    ) {
      deleteCount += 1;
    }
    nextLines.splice(range.startLine, deleteCount);
  }
  return nextLines;
}

// Rebase a captured Pomodoro bullet block onto a destination child indent:
// reuse rebaseTaskMoveBlock's column-0 stripping, then re-prefix every
// non-blank line with the destination's child indent instead of column 0.
function rebasePomodoroBulletBlock(block, destinationChildIndent) {
  const indent =
    typeof destinationChildIndent === "string" ? destinationChildIndent : "";
  return Object.freeze(
    rebaseTaskMoveBlock(block).map((line) => (line === "" ? "" : `${indent}${line}`)),
  );
}

// Plan a pure, same-file move of one or more Pomodoro sub-bullets (plus their
// descendants) from `options.sourceEntryLine`'s child block into another
// entry, or into a brand-new named entry. The new entry lands just below the
// source when the source survives, or at the source's former position when
// moving out its last owned content deletes the source entry. See the epic
// plan's "Insertion", "Source deletion", and "Duplicate merging" design
// decisions for the algorithm this mirrors.
function planPomodoroBulletMove(content, options = {}) {
  const text = String(content || "");
  const { lines: originalLines, lineEnding } = splitMarkdownContent(text);
  const scope = options.scope === "entry" ? "entry" : "bullets";
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;
  const destination =
    options.destination && typeof options.destination === "object"
      ? options.destination
      : {};

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      destinationEntryLine: null,
      firstMovedLine: null,
      movedCount: 0,
      skippedDuplicateCount: 0,
      createdPomodoro: false,
      createdPomodoroName: null,
      sourcePomodoroDeleted: false,
    });

  if (targets.length === 0 && scope !== "entry") {
    return invalid("No Pomodoro bullets were selected");
  }
  for (const target of targets) {
    if (String(originalLines[target.line] || "") !== target.rawLine) {
      return invalid("A selected bullet changed before it could be moved");
    }
  }
  if (
    scope === "entry" &&
    typeof options.sourceRawLine === "string" &&
    String(originalLines[sourceEntryLine] || "") !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  const { entries } = collectPomodoroEntries(text);
  const sourceEntry = entries.find(
    (entry) => entry.entryLine === sourceEntryLine,
  );
  if (!sourceEntry) {
    return invalid("Source Pomodoro entry could not be found");
  }

  let createdPomodoroName = null;
  if (destination.kind === "existing") {
    if (destination.entryLine === sourceEntryLine) {
      return invalid("Choose a different Pomodoro to move into");
    }
    const destinationExists = entries.some(
      (entry) => entry.entryLine === destination.entryLine,
    );
    if (!destinationExists) {
      return invalid("Destination Pomodoro entry could not be found");
    }
  } else if (destination.kind === "new" && scope !== "entry") {
    const nameResult = normalizePomodoroName(destination.name);
    if (!nameResult.valid) {
      return invalid(nameResult.error);
    }
    createdPomodoroName = nameResult.name;
  } else {
    return invalid("Choose a Pomodoro destination");
  }

  // Capture each target's subtree against the source entry's original child
  // bounds, then remove the captured ranges from the document.
  const orderedTargets = targets.slice().sort((left, right) => left.line - right.line);
  const capturedBlocks = orderedTargets.map((target) =>
    capturePomodoroBulletSubtree(
      originalLines,
      target.line,
      sourceEntry.childEndLineExclusive,
    ),
  );
  const afterRemovalLines = removePomodoroBulletRanges(
    originalLines,
    capturedBlocks,
  );

  // Delete the source entry entirely when nothing it owns survives the
  // removal; otherwise leave it untouched.
  const sourceBlockAfterRemoval = findCurrentBulletChildBlock(
    afterRemovalLines,
    sourceEntry.entryLine,
  );
  let sourceChildIsBlank = true;
  for (
    let index = sourceBlockAfterRemoval.startLine;
    index < sourceBlockAfterRemoval.endLineExclusive;
    index += 1
  ) {
    if (String(afterRemovalLines[index] || "").trim() !== "") {
      sourceChildIsBlank = false;
      break;
    }
  }
  if (scope === "entry") {
    // No-silent-loss guard: every non-blank line in the source entry's
    // original child block must be covered by a captured target subtree or
    // be one of the discovery's dropped placeholder lines. Anything else
    // (an indented continuation, a stray note, a nested list under no
    // bullet) blocks the force-delete rather than destroying unmoved
    // content.
    const coveredLines = new Set();
    for (const block of capturedBlocks) {
      for (
        let index = block.startLine;
        index < block.endLineExclusive;
        index += 1
      ) {
        coveredLines.add(index);
      }
    }
    const entryDiscovery = discoverPomodoroEntryMoveTargets(
      text,
      sourceEntry.entryLine,
    );
    if (entryDiscovery.valid) {
      for (const dropped of entryDiscovery.droppedLines) {
        coveredLines.add(dropped.line);
      }
    }
    for (
      let index = sourceEntry.childStartLine;
      index < sourceEntry.childEndLineExclusive;
      index += 1
    ) {
      if (coveredLines.has(index)) {
        continue;
      }
      if (String(originalLines[index] || "").trim() !== "") {
        return invalid(
          "Pomodoro has content that cannot be moved; nothing was moved",
        );
      }
    }
  }

  let workingLines = afterRemovalLines;
  let sourcePomodoroDeleted = false;
  let sourceAnchorLine = null;
  if (scope === "entry" || sourceChildIsBlank) {
    workingLines = removePomodoroBulletRanges(afterRemovalLines, [
      {
        startLine: sourceEntry.entryLine,
        endLineExclusive: sourceBlockAfterRemoval.endLineExclusive,
      },
    ]);
    sourcePomodoroDeleted = true;
    sourceAnchorLine = sourceEntry.entryLine;
  }

  // Re-locate the destination (and, for an existing destination, the source)
  // against the repaired content: mutations so far are confined to the
  // source entry's own child block, so any entry at or before the source
  // entry's line is unaffected, and any entry after it shifts by the net
  // line-count delta.
  const repairedContent = workingLines.join(lineEnding);
  const { entries: repairedEntries } = collectPomodoroEntries(repairedContent);
  const lineDelta = workingLines.length - originalLines.length;
  const shiftLine = (originalLine) =>
    originalLine > sourceEntry.entryLine ? originalLine + lineDelta : originalLine;

  let destEntry = null;
  if (destination.kind === "existing") {
    const shiftedDestinationEntryLine = shiftLine(destination.entryLine);
    destEntry = repairedEntries.find(
      (entry) => entry.entryLine === shiftedDestinationEntryLine,
    );
    if (!destEntry) {
      return invalid("Destination Pomodoro entry could not be found");
    }
  }
  const destinationChildIndent = destEntry ? destEntry.childIndent : "\t";

  // Rebase every captured block onto the destination child indent.
  const rebasedBlocks = capturedBlocks.map((block) => ({
    block,
    rebasedLines: rebasePomodoroBulletBlock(block, destinationChildIndent),
  }));

  // Drop exact-duplicate single-line blocks against the destination's
  // existing (pre-insertion) child lines.
  const existingChildTrimmed = new Set();
  if (destEntry) {
    for (
      let index = destEntry.childStartLine;
      index < destEntry.childEndLineExclusive;
      index += 1
    ) {
      const trimmed = String(workingLines[index] || "").trim();
      if (trimmed !== "") {
        existingChildTrimmed.add(trimmed);
      }
    }
  }

  let skippedDuplicateCount = 0;
  const insertedBlocks = [];
  for (const { block, rebasedLines } of rebasedBlocks) {
    const isSingleLine = block.endLineExclusive - block.startLine === 1;
    const trimmed = rebasedLines.length > 0 ? rebasedLines[0].trim() : "";
    if (isSingleLine && existingChildTrimmed.has(trimmed)) {
      skippedDuplicateCount += 1;
      continue;
    }
    insertedBlocks.push(rebasedLines);
  }
  const flatInserted = insertedBlocks.flat();

  // Insert the surviving blocks: into the existing destination's child
  // block, or below a brand-new entry created after the source's block.
  let finalLines;
  let destinationEntryLineFinal;
  let firstMovedLine = null;
  let createdPomodoro = false;

  if (destEntry) {
    const isLonePlaceholder =
      destEntry.childEndLineExclusive - destEntry.childStartLine === 1 &&
      PROJECT_LIST_ITEM_RE.test(
        String(workingLines[destEntry.childStartLine] || ""),
      ) &&
      !pomodoroBulletBodyBounds(
        String(workingLines[destEntry.childStartLine] || ""),
      );

    if (isLonePlaceholder && flatInserted.length > 0) {
      finalLines = workingLines
        .slice(0, destEntry.childStartLine)
        .concat(flatInserted, workingLines.slice(destEntry.childStartLine + 1));
      firstMovedLine = destEntry.childStartLine;
    } else if (isLonePlaceholder) {
      // Every moved block merged away as an exact duplicate of the
      // placeholder itself; leave the destination's placeholder in place
      // rather than deleting its only child line.
      finalLines = workingLines;
    } else {
      let insertAt = destEntry.childStartLine;
      for (
        let index = destEntry.childEndLineExclusive - 1;
        index >= destEntry.childStartLine;
        index -= 1
      ) {
        if (String(workingLines[index] || "").trim() !== "") {
          insertAt = index + 1;
          break;
        }
      }
      finalLines = workingLines
        .slice(0, insertAt)
        .concat(flatInserted, workingLines.slice(insertAt));
      if (flatInserted.length > 0) {
        firstMovedLine = insertAt;
      }
    }
    destinationEntryLineFinal = destEntry.entryLine;
  } else {
    // A deleted source has no surviving entry to anchor against: insert the
    // new entry at the deleted source's former position instead of below it.
    let insertAt;
    if (sourcePomodoroDeleted) {
      insertAt = sourceAnchorLine;
    } else {
      const repairedSourceEntry = repairedEntries.find(
        (entry) => entry.entryLine === sourceEntry.entryLine,
      );
      insertAt = repairedSourceEntry.childEndLineExclusive;
    }
    const insertion = [formatPomodoroEntryLine(createdPomodoroName), ...flatInserted];
    finalLines = workingLines
      .slice(0, insertAt)
      .concat(insertion, workingLines.slice(insertAt));
    destinationEntryLineFinal = insertAt;
    firstMovedLine = insertAt + 1;
    createdPomodoro = true;
  }

  if (firstMovedLine === null) {
    firstMovedLine = destinationEntryLineFinal;
  }

  return Object.freeze({
    valid: true,
    error: null,
    after: finalLines.join(lineEnding),
    destinationEntryLine: destinationEntryLineFinal,
    firstMovedLine,
    movedCount: insertedBlocks.length,
    skippedDuplicateCount,
    createdPomodoro,
    createdPomodoroName,
    sourcePomodoroDeleted,
  });
}

// Plan a pure rename of a Pomodoro entry's name suffix in place. Never
// touches the checkbox status or the parenthetical body; only the text after
// the parenthetical changes. Returns a frozen
// `{ valid, error, after, entryLine, name, previousName, unchanged }`.
function planPomodoroEntryRename(content, options = {}) {
  const text = String(content || "");
  const { lines: originalLines, lineEnding } = splitMarkdownContent(text);
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      entryLine: sourceEntryLine,
      name: null,
      previousName: null,
      unchanged: false,
    });

  const nameResult = normalizePomodoroName(options.name);
  if (!nameResult.valid) {
    return invalid(nameResult.error);
  }

  const rawLine = String(originalLines[sourceEntryLine] || "");
  if (
    typeof options.sourceRawLine === "string" &&
    rawLine !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  const parsed = parsePomodoroEntryLine(rawLine);
  if (!parsed) {
    return invalid("Source Pomodoro entry could not be found");
  }

  if (parsed.name === null && rawLine.slice(parsed.rangeEnd).trim() !== "") {
    return invalid(
      "Pomodoro entry has unsupported trailing content; rename it by hand",
    );
  }

  const previousName = getNormalizedPomodoroEntryName(parsed);
  if (nameResult.name === previousName) {
    return Object.freeze({
      valid: true,
      error: null,
      after: text,
      entryLine: sourceEntryLine,
      name: nameResult.name,
      previousName,
      unchanged: true,
    });
  }

  const renamedLine =
    rawLine.slice(0, parsed.rangeEnd) +
    ` ${POMODORO_NAME_SEPARATOR} ` +
    nameResult.name;
  const nextLines = originalLines.slice();
  nextLines[sourceEntryLine] = renamedLine;

  return Object.freeze({
    valid: true,
    error: null,
    after: nextLines.join(lineEnding),
    entryLine: sourceEntryLine,
    name: nameResult.name,
    previousName,
    unchanged: false,
  });
}

// True when a findPomodoroEntryContext() context sits on a movable Pomodoro
// entry: open, with no time range yet. Ctrl+Shift+J/K route to a reorder
// only for this shape; every other context keeps its jump behavior.
function isMovablePomodoroEntryContext(context) {
  return Boolean(context && context.entry && context.entry.open && context.entry.placeholder);
}

// Plan reordering a movable (open, placeholder) Pomodoro entry among its
// planned siblings. `options.repeat` (Vim count, default 1) is an exact
// distance: the source block moves N positions in `direction` only when every
// crossed sibling, including the destination, is itself an open placeholder.
// A current, closed, cancelled, or missing neighbor refuses the whole request
// with no partial rewrite, so planned Pomodoros never cross non-planned
// entries. `neighborEntry` is the entry originally occupying the destination
// slot (the adjacent sibling when repeat is 1). Returns a frozen
// `{ valid, error, after, entryLine, movedEntryLine, entry, neighborEntry, direction, repeat }`.
function planPomodoroEntryReorder(content, options = {}) {
  const text = String(content || "");
  const direction = numericOrDefault(options.direction, 1) < 0 ? -1 : 1;
  const repeat = normalizeVimRepeat(options.repeat);
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      entryLine: sourceEntryLine,
      movedEntryLine: null,
      entry: null,
      neighborEntry: null,
      direction,
      repeat,
    });

  const context = findPomodoroEntryContext(text, sourceEntryLine);
  if (!context) {
    return invalid("Place the cursor on a Pomodoro entry");
  }

  const { entries, entry, entryIndex } = context;
  const { lines, lineEnding } = splitMarkdownContent(text);
  const rawLine = String(lines[sourceEntryLine] || "");
  if (
    typeof options.sourceRawLine === "string" &&
    rawLine !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  if (!entry.open || !entry.placeholder) {
    return invalid("Only an open Pomodoro without a time range can be moved");
  }

  const label = getPomodoroBulletMoveDestinationLabel(entry);
  const boundaryError =
    repeat > 1
      ? `${label} cannot move ${
          direction < 0 ? "up" : "down"
        } ${repeat} positions without crossing the ${
          direction < 0 ? "first" : "last"
        } planned Pomodoro`
      : `${label} is already the ${
          direction < 0 ? "first" : "last"
        } planned Pomodoro`;
  const targetEntryIndex = entryIndex + direction * repeat;
  if (targetEntryIndex < 0 || targetEntryIndex >= entries.length) {
    return invalid(boundaryError);
  }

  const step = direction;
  for (
    let index = entryIndex + step;
    index !== targetEntryIndex + step;
    index += step
  ) {
    if (!isMovablePomodoroEntryContext({ entry: entries[index] })) {
      return invalid(boundaryError);
    }
  }

  const neighborEntry = entries[targetEntryIndex];
  const startIndex = Math.min(entryIndex, targetEntryIndex);
  const endIndex = Math.max(entryIndex, targetEntryIndex);
  const spanEntries = entries.slice(startIndex, endIndex + 1);
  const blocks = spanEntries.map((spanEntry) =>
    Object.freeze({
      lines: lines.slice(spanEntry.entryLine, spanEntry.childEndLineExclusive),
      isSource: spanEntry.entryLine === entry.entryLine,
    }),
  );
  const gaps = [];
  for (let index = 0; index < spanEntries.length - 1; index += 1) {
    gaps.push(
      lines.slice(
        spanEntries[index].childEndLineExclusive,
        spanEntries[index + 1].entryLine,
      ),
    );
  }

  // Down rotates [source, next1, ..., nextN] left; up rotates
  // [prevN, ..., prev1, source] right. Gaps stay in their physical slots.
  const rotated =
    direction > 0
      ? blocks.slice(1).concat(blocks[0])
      : [blocks[blocks.length - 1], ...blocks.slice(0, -1)];

  const spanStartLine = spanEntries[0].entryLine;
  const spanEndLineExclusive =
    spanEntries[spanEntries.length - 1].childEndLineExclusive;
  const rendered = [];
  let movedEntryLine = null;
  let currentLine = spanStartLine;
  for (let index = 0; index < rotated.length; index += 1) {
    if (rotated[index].isSource) {
      movedEntryLine = currentLine;
    }
    rendered.push(...rotated[index].lines);
    currentLine += rotated[index].lines.length;
    if (index < gaps.length) {
      rendered.push(...gaps[index]);
      currentLine += gaps[index].length;
    }
  }

  const nextLines = [
    ...lines.slice(0, spanStartLine),
    ...rendered,
    ...lines.slice(spanEndLineExclusive),
  ];

  return Object.freeze({
    valid: true,
    error: null,
    after: nextLines.join(lineEnding),
    entryLine: sourceEntryLine,
    movedEntryLine,
    entry,
    neighborEntry,
    direction,
    repeat,
  });
}

function getPomodoroEntryRangeLabel(entry) {
  const rangeText = String((entry && entry.rangeText) || "");
  if (!rangeText || POMODORO_PLACEHOLDER_RE.test(rangeText)) {
    return "Unscheduled";
  }

  let match = POMODORO_COLON_TIME_RANGE_RE.exec(rangeText);
  if (match && match.index === 0) {
    return `${match[2]}:${match[3]}-${match[4]}:${match[5]}`;
  }
  match = POMODORO_COMPACT_TIME_RANGE_RE.exec(rangeText);
  if (match && match.index === 0) {
    return `${match[2]}${match[3]}-${match[4]}${match[5]}`;
  }
  return rangeText;
}

function getNormalizedPomodoroEntryName(entry) {
  if (!entry || !entry.name) {
    return "";
  }
  const normalized = normalizePomodoroName(entry.name);
  return normalized.valid ? normalized.name : String(entry.name).trim();
}

function getPomodoroBulletMoveDestinationLabel(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  return name || `Pomodoro #${entry && entry.position}`;
}

function getPomodoroBulletMovePickerTitle(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  if (name) {
    return name;
  }
  const rangeLabel = getPomodoroEntryRangeLabel(entry);
  return rangeLabel === "Unscheduled"
    ? `Pomodoro #${entry && entry.position}`
    : rangeLabel;
}

function getPomodoroBulletMovePickerStatusLabel(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  const rangeLabel = getPomodoroEntryRangeLabel(entry);
  if (name) {
    return rangeLabel;
  }
  return rangeLabel === "Unscheduled" ? "Unscheduled" : "";
}

function getPomodoroBulletMovePickerMeta(entry) {
  const previewText = String((entry && entry.previewText) || "").trim();
  if (!previewText) {
    return "No sub-bullets yet";
  }
  const moreCount = Math.max(
    0,
    Math.floor(numericOrDefault(entry && entry.moreCount, 0)),
  );
  return moreCount > 0 ? `${previewText} +${moreCount} more` : previewText;
}

function pomodoroBulletMoveEntryMatchesQuery(entry, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const parts = [
    getNormalizedPomodoroEntryName(entry),
    entry && entry.name,
    entry && entry.rangeText,
    getPomodoroEntryRangeLabel(entry),
    entry && entry.position ? `#${entry.position}` : "",
    entry && entry.position ? String(entry.position) : "",
    entry && entry.previewText,
  ];
  return parts.some((part) =>
    String(part || "").toLowerCase().includes(normalizedQuery),
  );
}

function createPomodoroBulletMovePickerRows(
  entries,
  sourceEntryLine,
  rawQuery,
  options = {},
) {
  const mode = options && options.mode === "entry" ? "entry" : "bullets";
  const openEntries = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && entry.open,
  );
  const queryText = String(rawQuery || "").trim();
  const query = queryText.toLowerCase();
  const existingNameEntries =
    mode === "entry"
      ? openEntries.filter((entry) => entry.entryLine !== sourceEntryLine)
      : openEntries;
  const existingNames = new Set(
    existingNameEntries
      .map((entry) => getNormalizedPomodoroEntryName(entry))
      .filter(Boolean),
  );
  const rows = [];

  if (queryText) {
    const normalized = normalizePomodoroName(queryText);
    if (!normalized.valid) {
      rows.push(
        Object.freeze({
          kind: "invalid",
          statusText: normalized.error,
        }),
      );
    } else if (!existingNames.has(normalized.name) && mode === "entry") {
      rows.push(
        Object.freeze({
          kind: "rename",
          name: normalized.name,
          title: `Rename to ${normalized.name}`,
          meta: "Renames the current Pomodoro",
          badge: "Rename",
        }),
      );
    } else if (!existingNames.has(normalized.name)) {
      rows.push(
        Object.freeze({
          kind: "new",
          name: normalized.name,
          title: `New Pomodoro ${normalized.name}`,
          meta: "Created below the current Pomodoro",
        }),
      );
    }
  }

  for (const entry of openEntries) {
    if (entry.entryLine === sourceEntryLine) {
      continue;
    }
    if (!pomodoroBulletMoveEntryMatchesQuery(entry, query)) {
      continue;
    }
    rows.push(
      Object.freeze({
        kind: "existing",
        entry,
        title: getPomodoroBulletMovePickerTitle(entry),
        meta: getPomodoroBulletMovePickerMeta(entry),
        statusEmoji: "",
        statusLabel: getPomodoroBulletMovePickerStatusLabel(entry),
      }),
    );
  }

  return Object.freeze(rows);
}

function buildPomodoroBulletMoveNotice(plan = {}, discovery = {}, destinationLabel) {
  const fallbackCount =
    Math.max(0, Math.floor(numericOrDefault(plan.movedCount, 0))) +
    Math.max(0, Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)));
  const count = Math.max(
    0,
    Math.floor(numericOrDefault(discovery.actualCount, fallbackCount)),
  );
  const bulletText = count === 1 ? "bullet" : "bullets";
  let label = String(destinationLabel || "").trim();
  if (plan.createdPomodoro) {
    const name = String(plan.createdPomodoroName || label).trim();
    label = name ? `new Pomodoro ${name}` : "new Pomodoro";
  }
  if (!label) {
    label = "Pomodoro destination";
  }

  let text = `Moved ${count} ${bulletText} to ${label}`;
  const duplicateCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)),
  );
  if (duplicateCount > 0) {
    text += ` (merged ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"})`;
  }
  if (discovery && discovery.clamped) {
    text += ` (requested ${discovery.requestedCount}; reached end of Pomodoro)`;
  }
  return text;
}

// Notice text for a whole-entry Pomodoro move-and-delete: "Moved N bullets
// from Pomodoro #P to LABEL", with a merged-duplicate suffix, or "Deleted
// empty Pomodoro #P" when nothing moved and nothing merged.
function buildPomodoroEntryMoveNotice(plan = {}, discovery = {}, destinationLabel) {
  const movedCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.movedCount, 0)),
  );
  const duplicateCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)),
  );
  const sourcePosition =
    discovery && discovery.entry && discovery.entry.position
      ? discovery.entry.position
      : "?";

  if (movedCount === 0 && duplicateCount === 0) {
    return `Deleted empty Pomodoro #${sourcePosition}`;
  }

  const bulletText = movedCount === 1 ? "bullet" : "bullets";
  const label = String(destinationLabel || "").trim() || "Pomodoro destination";
  let text = `Moved ${movedCount} ${bulletText} from Pomodoro #${sourcePosition} to ${label}`;
  if (duplicateCount > 0) {
    text += ` (merged ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"})`;
  }
  return text;
}

// Resolve `{ path, blockId }` deferred-pomodoro targets from a set of task
// line numbers (as produced by the writers below). A line with no trailing
// `^block-id` cannot be linked from a Pomodoro sub-bullet, so it contributes
// nothing.
function deferredPomodoroTargetsFromLines(sourcePath, lines, lineNumbers) {
  const path = normalizeVaultRelativePath(sourcePath);
  const sourceLines = Array.isArray(lines) ? lines : [];
  const targets = [];
  for (const lineNumber of Array.isArray(lineNumbers) ? lineNumbers : []) {
    const blockId = getTrailingBlockId(String(sourceLines[lineNumber] || ""));
    if (blockId) {
      targets.push(Object.freeze({ path, blockId }));
    }
  }
  return Object.freeze(targets);
}

function emptyDeferredPomodoroLinkCleanup(content, unresolvedCount = 0) {
  return Object.freeze({
    content,
    changed: false,
    removedBulletCount: 0,
    removedLinkCount: 0,
    removedTargets: Object.freeze([]),
    removedLineRanges: Object.freeze([]),
    unresolvedCount,
  });
}

// Plan the removal of every live link (in today's daily note, under an open
// Pomodoro entry) to one of `targets`. `options` carries `dailyPath` (the
// daily note's own vault-relative path, used to resolve a same-note
// `[[#^id]]` link) and `noteIndex` (from `createScheduledRecoveryNoteIndex`,
// used to resolve `[[target#^id]]` links to a vault path). Struck links and
// links under a closed/cancelled entry are never candidates. A dedicated link
// bullet (the link, its marker, and nothing else) is removed subtree and all;
// otherwise only the matched token is removed from its bullet.
function planDeferredPomodoroLinkCleanup(dailyContent, targets, options = {}) {
  const snapshot = String(dailyContent || "");
  const targetList = Array.from(targets || []).filter(
    (target) => target && target.path && target.blockId,
  );
  if (targetList.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }

  const { lines, lineEnding } = splitMarkdownContent(snapshot);
  const contexts = getMarkdownLineContexts(snapshot);
  const section = findPomodorosSectionRange(snapshot);
  if (!section) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }
  const openRanges = collectOpenPomodoroRanges(lines, contexts, section);
  if (openRanges.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }

  const dailyPath = normalizeVaultRelativePath(options.dailyPath);
  const noteIndex = options.noteIndex || null;
  const targetKeys = new Set(
    targetList.map(
      (target) =>
        `${normalizeVaultRelativePath(target.path)} ${target.blockId}`,
    ),
  );

  const lineStarts = [];
  let runningOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineStarts.push(runningOffset);
    runningOffset += lines[index].length + lineEnding.length;
  }

  const matches = [];
  const removedTargetKeys = new Set();
  let unresolvedCount = 0;

  for (const range of openRanges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      if (contexts[line] && contexts[line].inFence) {
        continue;
      }
      const lineText = String(lines[line] || "");
      const occurrences = collectPomodoroBlockLinkOccurrences(lineText);
      for (const occurrence of occurrences) {
        if (occurrence.struck) {
          continue;
        }
        const resolved = noteIndex
          ? resolveScheduledRecoveryNote(noteIndex, dailyPath, occurrence.target)
          : null;
        if (!resolved) {
          unresolvedCount += 1;
          continue;
        }
        const key = `${resolved} ${occurrence.blockId}`;
        if (!targetKeys.has(key)) {
          continue;
        }
        matches.push({
          line,
          lineText,
          occurrence,
          start: lineStarts[line] + occurrence.start,
          end: lineStarts[line] + occurrence.end,
        });
        removedTargetKeys.add(key);
      }
    }
  }

  if (matches.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot, unresolvedCount);
  }

  const matchesByLine = new Map();
  for (const match of matches) {
    if (!matchesByLine.has(match.line)) {
      matchesByLine.set(match.line, []);
    }
    matchesByLine.get(match.line).push(match);
  }

  const subtreeCandidates = [];
  for (const [line, lineMatches] of matchesByLine) {
    if (
      !isDedicatedPomodoroLinkLine(
        lineMatches[0].lineText,
        lineMatches.map((entry) => entry.occurrence),
      )
    ) {
      continue;
    }
    const block = findCurrentBulletChildBlock(lines, line);
    const end =
      block.endLineExclusive < lines.length
        ? lineStarts[block.endLineExclusive]
        : snapshot.length;
    subtreeCandidates.push({
      start: lineStarts[line],
      end,
      replacement: "",
      startLine: line,
      endLineExclusive: block.endLineExclusive,
    });
  }
  subtreeCandidates.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );

  // Merge overlapping or contained candidates into one edit (adjacent
  // dedicated bullets can overlap once the EOF adjustment below is applied).
  const subtreeEdits = [];
  for (const candidate of subtreeCandidates) {
    const last = subtreeEdits[subtreeEdits.length - 1];
    if (last && candidate.start <= last.end) {
      last.end = Math.max(last.end, candidate.end);
      last.endLineExclusive = Math.max(
        last.endLineExclusive,
        candidate.endLineExclusive,
      );
      continue;
    }
    subtreeEdits.push({ ...candidate });
  }

  // A merged edit reaching EOF removes each deleted line's own trailing
  // separator except the very last one, which has none — so its *leading*
  // separator (the newline ending the line before the run) is removed
  // instead, to avoid leaving a dangling trailing blank line.
  for (const edit of subtreeEdits) {
    if (edit.endLineExclusive >= lines.length && edit.startLine > 0) {
      edit.start -= lineEnding.length;
    }
  }

  const tokenMatches = matches.filter(
    (match) =>
      !subtreeEdits.some(
        (edit) => edit.start <= match.start && edit.end >= match.end,
      ),
  );
  const tokenMatchesByLine = new Map();
  for (const match of tokenMatches) {
    if (!tokenMatchesByLine.has(match.line)) {
      tokenMatchesByLine.set(match.line, []);
    }
    tokenMatchesByLine.get(match.line).push(match);
  }

  const lineEdits = [];
  for (const [line, lineMatches] of tokenMatchesByLine) {
    const lineStart = lineStarts[line];
    const lineText = String(lines[line] || "");
    let nextLine = lineText;
    const sorted = lineMatches
      .slice()
      .sort((left, right) => right.occurrence.start - left.occurrence.start);
    for (const match of sorted) {
      nextLine =
        nextLine.slice(0, match.occurrence.start) +
        nextLine.slice(match.occurrence.end);
    }
    // Collapse and trim only the bullet's body — the leading indent and list
    // marker must survive untouched even when they happen to contain runs of
    // spaces (e.g. a wide indent).
    const prefixLength = (PROJECT_LIST_ITEM_RE.exec(nextLine) || [""])[0].length;
    nextLine =
      nextLine.slice(0, prefixLength) +
      nextLine
        .slice(prefixLength)
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+$/, "");
    lineEdits.push({
      start: lineStart,
      end: lineStart + lineText.length,
      replacement: nextLine,
    });
  }

  const edits = [...subtreeEdits, ...lineEdits].sort(
    (left, right) => right.start - left.start,
  );
  let nextContent = snapshot;
  for (const edit of edits) {
    nextContent =
      nextContent.slice(0, edit.start) +
      edit.replacement +
      nextContent.slice(edit.end);
  }

  return Object.freeze({
    content: nextContent,
    changed: nextContent !== snapshot,
    // Counts dedicated bullets found, not text-splice operations — adjacent
    // dedicated bullets can merge into one contiguous edit above.
    removedBulletCount: subtreeCandidates.length,
    removedLinkCount: matches.length,
    removedTargets: Object.freeze(
      targetList.filter((target) =>
        removedTargetKeys.has(
          `${normalizeVaultRelativePath(target.path)} ${target.blockId}`,
        ),
      ),
    ),
    removedLineRanges: Object.freeze(
      subtreeEdits.map((edit) =>
        Object.freeze({
          startLine: edit.startLine,
          endLineExclusive: edit.endLineExclusive,
        }),
      ),
    ),
    unresolvedCount,
  });
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

// Zero-based line indices of every open-task navigation target: Ready, In
// Progress, and Next `#task` lines anywhere in the note (Blocked `[?]` stays
// open for dependency/scheduling workflows but is not a jump target) plus
// open or done top-level Pomodoro ledger lines inside a `## Pomodoros`
// section. Leading frontmatter and fenced code blocks are skipped with the
// same state machine used for the proper-task scanner, so task-shaped lines
// inside YAML, examples, and `tasks` query blocks are ignored. A line that
// qualifies as both a `#task` and a Pomodoro is added once, and indices are
// returned in ascending file order.
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

    if (isActiveObsidianTaskNavigationLine(line)) {
      taskLines.push(lineIndex);
    } else if (inPomodorosSection && isPomodoroNavigationTaskLine(line)) {
      taskLines.push(lineIndex);
    }
  }

  return taskLines;
}

// Circular open-task navigation: jump to the nearest navigation target
// (Ready/In Progress/Next `#task` line or open/done Pomodoro ledger line) in
// the given direction, wrapping across the file boundary when there is no
// strict neighbour. An optional `repeat` (Vim count, default 1) then advances
// another `repeat - 1` eligible targets in the same direction, modulo the
// target list, so a count can wrap once or many times without rescanning.
// Returns null only when there are no matching targets, or when the sole
// matching target is already on the cursor line (so the caller can show its
// no-target notice and leave the editor untouched).
function getOpenObsidianTaskJumpLine(
  lines,
  cursorLine,
  direction,
  repeat = 1,
) {
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
  // single-task/current-line case as the lone no-target outcome. Counted
  // repeats keep that same refusal rather than spinning in place.
  if (targetLine === currentLine) {
    return null;
  }

  const firstIndex = taskLines.indexOf(targetLine);
  if (firstIndex < 0) {
    return targetLine;
  }

  const step =
    (normalizeVimRepeat(repeat) - 1) % taskLines.length;
  const signedStep = direction < 0 ? -step : step;
  const finalIndex =
    (firstIndex + signedStep + taskLines.length) % taskLines.length;
  return taskLines[finalIndex];
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

function getEditorViewFromEditor(editorOrCm) {
  const editorView =
    editorOrCm && (editorOrCm.cm6 || editorOrCm.cm || editorOrCm);
  if (
    !editorView ||
    !editorView.state ||
    !editorView.state.doc ||
    typeof editorView.dispatch !== "function"
  ) {
    return null;
  }

  return editorView;
}

function getElementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  try {
    const rect = element.getBoundingClientRect();
    if (
      !rect ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.bottom) ||
      rect.bottom <= rect.top
    ) {
      return null;
    }

    return rect;
  } catch (error) {
    return null;
  }
}

function getVerticalIntersectionHeight(rect, viewportRect) {
  if (!rect || !viewportRect) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(rect.bottom, viewportRect.bottom) -
      Math.max(rect.top, viewportRect.top),
  );
}

function getScrollDOMMaxScrollTop(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollHeight = finiteNumberOrNull(scrollDOM.scrollHeight);
  const clientHeight = finiteNumberOrNull(scrollDOM.clientHeight);
  if (scrollHeight === null || clientHeight === null || clientHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, scrollHeight - clientHeight);
}

function getScrollDOMMaxScrollLeft(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollWidth = finiteNumberOrNull(scrollDOM.scrollWidth);
  const clientWidth = finiteNumberOrNull(scrollDOM.clientWidth);
  if (scrollWidth === null || clientWidth === null || clientWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, scrollWidth - clientWidth);
}

function setScrollDOMPosition(scrollDOM, scrollTop, scrollLeft = null) {
  if (!scrollDOM) {
    return false;
  }

  const targetScrollTop = clampNumber(
    scrollTop,
    0,
    getScrollDOMMaxScrollTop(scrollDOM),
  );
  const rawScrollLeft =
    finiteNumberOrNull(scrollLeft) ?? finiteNumberOrNull(scrollDOM.scrollLeft) ?? 0;
  const targetScrollLeft = clampNumber(
    rawScrollLeft,
    0,
    getScrollDOMMaxScrollLeft(scrollDOM),
  );

  if (typeof scrollDOM.scrollTo === "function") {
    try {
      scrollDOM.scrollTo({ top: targetScrollTop, left: targetScrollLeft });
      return true;
    } catch (error) {
      // Fall through to direct assignment.
    }
  }

  try {
    scrollDOM.scrollTop = targetScrollTop;
    scrollDOM.scrollLeft = targetScrollLeft;
    return true;
  } catch (error) {
    return false;
  }
}

function getRenderedTasksQueryContexts(editorView, viewportRect) {
  const root = editorView && editorView.dom;
  if (!root || typeof root.querySelectorAll !== "function") {
    return [];
  }

  let resultLists;
  try {
    resultLists = Array.from(
      root.querySelectorAll(DASH_RENDERED_TASKS_QUERY_RESULT_SELECTOR),
    );
  } catch (error) {
    return [];
  }

  const seenContainers = new Set();
  const contexts = [];
  for (const resultList of resultLists) {
    let container = resultList;
    try {
      if (resultList && typeof resultList.closest === "function") {
        container =
          resultList.closest(DASH_RENDERED_TASKS_BLOCK_SELECTOR) || resultList;
      }
    } catch (error) {
      container = resultList;
    }

    if (!container || seenContainers.has(container)) {
      continue;
    }
    seenContainers.add(container);

    const rect = getElementRect(container);
    if (!rect) {
      continue;
    }

    let sourceLine = null;
    const doc = editorView && editorView.state && editorView.state.doc;
    if (
      editorView &&
      typeof editorView.posAtDOM === "function" &&
      doc &&
      typeof doc.lineAt === "function"
    ) {
      try {
        const position = editorView.posAtDOM(container);
        const line = Number.isFinite(position) ? doc.lineAt(position) : null;
        if (line && Number.isFinite(line.number) && line.number >= 1) {
          sourceLine = Math.floor(line.number) - 1;
        }
      } catch (error) {
        sourceLine = null;
      }
    }

    contexts.push({
      index: contexts.length,
      sourceLine,
      element: container,
      resultList,
      rect,
      viewportRect,
    });
  }

  return contexts;
}

function findDashboardRenderedTasksQueryContext(editorView, scrollDOM) {
  const viewportRect = getElementRect(scrollDOM);
  if (!viewportRect) {
    return null;
  }

  const contexts = getRenderedTasksQueryContexts(editorView, viewportRect);
  if (contexts.length === 0) {
    return null;
  }

  const visible = [];
  let nearest = null;
  for (const context of contexts) {
    const intersectionHeight = getVerticalIntersectionHeight(
      context.rect,
      viewportRect,
    );
    if (intersectionHeight > 0) {
      visible.push({ ...context, intersectionHeight, distance: 0 });
      continue;
    }

    const distance =
      context.rect.bottom <= viewportRect.top
        ? viewportRect.top - context.rect.bottom
        : context.rect.top >= viewportRect.bottom
          ? context.rect.top - viewportRect.bottom
          : 0;
    const candidate = { ...context, intersectionHeight: 0, distance };
    if (!nearest || candidate.distance < nearest.distance) {
      nearest = candidate;
    }
  }

  if (visible.length > 0) {
    visible.sort((left, right) => {
      const intersectionDelta =
        right.intersectionHeight - left.intersectionHeight;
      if (intersectionDelta !== 0) {
        return intersectionDelta;
      }

      return left.rect.top - right.rect.top;
    });
    return visible[0];
  }

  return nearest;
}

function getDashboardRenderedTasksQuerySnapshot(editorView, scrollDOM) {
  const viewportRect = getElementRect(scrollDOM);
  const currentScrollTop = finiteNumberOrNull(scrollDOM && scrollDOM.scrollTop);
  if (!viewportRect || currentScrollTop === null) {
    return null;
  }

  const context = findDashboardRenderedTasksQueryContext(editorView, scrollDOM);
  if (!context) {
    return null;
  }

  const queryDocumentTop =
    currentScrollTop + context.rect.top - viewportRect.top;
  const queryHeight = context.rect.bottom - context.rect.top;
  if (!Number.isFinite(queryDocumentTop) || !Number.isFinite(queryHeight)) {
    return null;
  }

  return {
    index: context.index,
    sourceLine: context.sourceLine,
    offsetTop: currentScrollTop - queryDocumentTop,
    height: Math.max(0, queryHeight),
  };
}

function normalizeDashboardRenderedTasksQuerySnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  const index = Math.floor(numericOrDefault(snapshot.index, Number.NaN));
  const rawSourceLine =
    snapshot.sourceLine === null || snapshot.sourceLine === undefined
      ? null
      : Math.floor(numericOrDefault(snapshot.sourceLine, Number.NaN));
  const sourceLine =
    rawSourceLine !== null &&
    Number.isFinite(rawSourceLine) &&
    rawSourceLine >= 0
      ? rawSourceLine
      : null;
  const offsetTop = finiteNumberOrNull(snapshot.offsetTop);
  const height = finiteNumberOrNull(snapshot.height);
  if (!Number.isFinite(index) || index < 0 || offsetTop === null) {
    return null;
  }

  return {
    index,
    sourceLine,
    offsetTop,
    height: height === null ? null : Math.max(0, height),
  };
}

function normalizeDashLocation(location) {
  if (!location) {
    return null;
  }

  const sourcePosition = normalizePosition(
    location.sourcePosition || location.cursor || location.position,
  );
  const scrollTop = finiteNumberOrNull(location.scrollTop);
  const scrollLeft = finiteNumberOrNull(location.scrollLeft);
  const renderedTasksQuery = normalizeDashboardRenderedTasksQuerySnapshot(
    location.renderedTasksQuery,
  );

  if (
    !sourcePosition &&
    scrollTop === null &&
    scrollLeft === null &&
    !renderedTasksQuery
  ) {
    return null;
  }

  const normalized = {};
  if (sourcePosition) {
    normalized.sourcePosition = sourcePosition;
  }
  if (scrollTop !== null) {
    normalized.scrollTop = Math.max(0, scrollTop);
  }
  if (scrollLeft !== null) {
    normalized.scrollLeft = Math.max(0, scrollLeft);
  }
  if (renderedTasksQuery) {
    normalized.renderedTasksQuery = renderedTasksQuery;
  }

  return normalized;
}

function getDashboardQueryRestoreScrollTop(snapshot, editorView, scrollDOM) {
  const normalized = normalizeDashboardRenderedTasksQuerySnapshot(snapshot);
  const viewportRect = getElementRect(scrollDOM);
  const currentScrollTop = finiteNumberOrNull(scrollDOM && scrollDOM.scrollTop);
  if (!normalized || !viewportRect || currentScrollTop === null) {
    return null;
  }

  const contexts = getRenderedTasksQueryContexts(editorView, viewportRect);
  let context = null;
  if (normalized.sourceLine !== null) {
    context =
      contexts.find(
        (candidate) => candidate.sourceLine === normalized.sourceLine,
      ) || null;

    const fallbackContext = contexts[normalized.index];
    if (!context && fallbackContext && fallbackContext.sourceLine === null) {
      context = fallbackContext;
    }
  } else {
    context = contexts[normalized.index];
  }
  if (!context) {
    return null;
  }

  const queryDocumentTop =
    currentScrollTop + context.rect.top - viewportRect.top;
  const queryHeight = context.rect.bottom - context.rect.top;
  const viewportHeight =
    finiteNumberOrNull(scrollDOM && scrollDOM.clientHeight) ||
    finiteNumberOrNull(viewportRect.height) ||
    viewportRect.bottom - viewportRect.top;
  if (
    !Number.isFinite(queryDocumentTop) ||
    !Number.isFinite(queryHeight) ||
    !Number.isFinite(viewportHeight) ||
    queryHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  const minRelativeOffset = -Math.max(
    0,
    viewportHeight - DASH_RENDERED_TASKS_SCROLL_PADDING_PX,
  );
  const maxRelativeOffset = Math.max(
    0,
    queryHeight - DASH_RENDERED_TASKS_SCROLL_PADDING_PX,
  );
  const savedMaxRelativeOffset =
    normalized.height === null
      ? null
      : Math.max(0, normalized.height - DASH_RENDERED_TASKS_SCROLL_PADDING_PX);
  const saneRelativeOffset =
    savedMaxRelativeOffset === null
      ? normalized.offsetTop
      : clampNumber(
          normalized.offsetTop,
          minRelativeOffset,
          savedMaxRelativeOffset,
        );
  const targetRelativeOffset = clampNumber(
    saneRelativeOffset,
    minRelativeOffset,
    maxRelativeOffset,
  );

  return clampNumber(
    queryDocumentTop + targetRelativeOffset,
    0,
    getScrollDOMMaxScrollTop(scrollDOM),
  );
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

function setEditorCursorWithoutScroll(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  try {
    editor.setCursor(position.line, position.ch);
  } catch (error) {
    editor.setCursor(position);
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

function positionsEqual(left, right) {
  const normalizedLeft = normalizePosition(left);
  const normalizedRight = normalizePosition(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.line === normalizedRight.line &&
      normalizedLeft.ch === normalizedRight.ch,
  );
}

function normalizeTransclusionCommitCursorOptions(options) {
  const directCursor = normalizePosition(options);
  if (directCursor) {
    return {
      invocationCursor: null,
      finalCursor: directCursor,
    };
  }

  if (!options || typeof options !== "object") {
    return {
      invocationCursor: null,
      finalCursor: null,
    };
  }

  return {
    invocationCursor: normalizePosition(options.invocationCursor),
    finalCursor: normalizePosition(options.finalCursor),
  };
}

function getTransclusionCommitFinalCursor(cm, options) {
  if (!options || !options.finalCursor) {
    return null;
  }

  if (!options.invocationCursor) {
    return options.finalCursor;
  }

  return positionsEqual(getEditorCursor(cm), options.invocationCursor)
    ? options.finalCursor
    : null;
}

function applyEditorLineChanges(cm, originalLines, nextLines, finalCursor = null) {
  if (
    !cm ||
    !Array.isArray(originalLines) ||
    !Array.isArray(nextLines) ||
    originalLines.length !== nextLines.length ||
    nextLines.some((line) => /[\r\n]/.test(String(line)))
  ) {
    return false;
  }

  const changes = [];
  for (let line = 0; line < originalLines.length; line += 1) {
    const originalLine = String(originalLines[line] || "");
    const nextLine = String(nextLines[line] || "");
    if (originalLine === nextLine) {
      continue;
    }
    changes.push({
      from: { line, ch: 0 },
      to: { line, ch: originalLine.length },
      text: nextLine,
    });
  }

  if (changes.length === 0) {
    return true;
  }

  const cursor = normalizePosition(finalCursor);
  if (typeof cm.transaction === "function") {
    const transaction = { changes };
    if (cursor) {
      transaction.selection = { from: cursor, to: cursor };
    }
    cm.transaction(transaction);
    return true;
  }

  if (typeof cm.replaceRange !== "function") {
    return false;
  }
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    cm.replaceRange(change.text, change.from, change.to);
  }
  if (cursor) {
    setEditorCursorSafely(cm, cursor.line, cursor.ch);
  }
  return true;
}

function applyEditorContentTransaction(
  cm,
  originalContent,
  nextContent,
  finalCursor = null,
) {
  if (!cm) {
    return false;
  }
  const originalText = String(originalContent || "");
  const nextText = String(nextContent || "");
  const original = splitMarkdownContent(originalText);
  const next = splitMarkdownContent(nextText);
  const cursor = normalizePosition(finalCursor);

  if (original.lines.length === next.lines.length) {
    return applyEditorLineChanges(cm, original.lines, next.lines, cursor);
  }
  if (originalText === nextText) {
    return true;
  }

  const lastLine = Math.max(original.lines.length - 1, 0);
  const change = {
    from: { line: 0, ch: 0 },
    to: {
      line: lastLine,
      ch: String(original.lines[lastLine] || "").length,
    },
    text: nextText,
  };
  if (typeof cm.transaction === "function") {
    const transaction = { changes: [change] };
    if (cursor) {
      transaction.selection = { from: cursor, to: cursor };
    }
    cm.transaction(transaction);
    return true;
  }
  if (typeof cm.replaceRange !== "function") {
    return false;
  }

  const scroll =
    typeof cm.getScrollInfo === "function" ? cm.getScrollInfo() : null;
  cm.replaceRange(change.text, change.from, change.to);
  if (cursor) {
    setEditorCursorSafely(cm, cursor.line, cursor.ch);
  }
  if (scroll && typeof cm.scrollTo === "function") {
    try {
      cm.scrollTo(scroll.left, scroll.top);
    } catch (error) {
      // Viewport restoration is best-effort on older editor adapters.
    }
  }
  return true;
}

function replaceEditorContent(cm, oldContent, newContent) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }
  const oldText = String(oldContent || "");
  const nextText = String(newContent || "");
  if (oldText === nextText) {
    return true;
  }
  const oldLines = oldText.split(/\r?\n/);
  const lastLine = Math.max(oldLines.length - 1, 0);
  cm.replaceRange(
    nextText,
    { line: 0, ch: 0 },
    { line: lastLine, ch: String(oldLines[lastLine] || "").length },
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
  const dependencyBullet = parseDependencyTransclusionBulletDetails(text);
  if (dependencyBullet && dependencyBullet.terminal) {
    return [];
  }
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

  const changesByLine = lineTargets
    .map((entry) => {
      const removeMarkers = entry.targets.every((target) => target.transcluded);
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
    removeMarkers: null,
    lineTargets,
    changesByLine,
  };
}

function findDependencyToggleParent(lines, childLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const parentLine = findNearestParentListItem(sourceLines, childLine);
  if (parentLine === null) {
    return null;
  }
  return isObsidianTaskAtLine(sourceLines.join("\n"), parentLine)
    ? parentLine
    : null;
}

function findTaskLineByBlockId(lines, blockId) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const content = sourceLines.join("\n");
  const id = normalizeBulletPropertyValue(blockId);
  if (!id) {
    return null;
  }
  for (let line = 0; line < sourceLines.length; line += 1) {
    const text = String(sourceLines[line] || "");
    if (
      isObsidianTaskAtLine(content, line) &&
      getTrailingBlockId(text) === id
    ) {
      return line;
    }
  }
  return null;
}

function planSameFileDependencyToggle(
  content,
  lineIndex,
  nextLineText,
  filePath = "Note.md",
) {
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const line = Math.floor(numericOrDefault(lineIndex, Number.NaN));
  const original = Number.isFinite(line)
    ? parseDependencyTransclusionBulletDetails(lines[line])
    : null;
  const next = parseDependencyTransclusionBulletDetails(nextLineText);
  const toggledLines = lines.slice();
  if (Number.isFinite(line) && line >= 0 && line < toggledLines.length) {
    toggledLines[line] = String(nextLineText);
  }
  const unqualified = (reason) =>
    Object.freeze({
      qualified: false,
      reason,
      content: toggledLines.join(newline),
      parentLine: null,
      targetLine: null,
      dependencyId: null,
      transcluded: next ? next.transcluded : null,
    });
  if (
    !original ||
    !next ||
    original.blockId !== next.blockId ||
    original.transcluded === next.transcluded ||
    original.note ||
    next.note
  ) {
    return unqualified("not-sole-same-file-block-link");
  }
  const parentLine = findDependencyToggleParent(lines, line);
  if (parentLine === null) {
    return unqualified("no-parent-task");
  }
  const targetLine = findTaskLineByBlockId(lines, original.blockId);
  if (targetLine === null) {
    return unqualified("target-not-task");
  }
  if (
    next.transcluded &&
    hasWholeTaskTag(lines[targetLine], PROJECT_HIDE_TAG)
  ) {
    return unqualified("target-hidden");
  }
  const targetIsOpen = isOpenObsidianTaskLine(lines[targetLine]);
  const idField = findBulletPropertyField(lines[targetLine], "id");
  const legacyId = idField && normalizeBulletPropertyValue(idField.value);
  const canonicalId = tryDependencyId(filePath, original.blockId);
  if (!canonicalId) {
    return unqualified("unqualifiable-note-path");
  }
  if (legacyId && legacyId !== canonicalId) {
    const lineContexts = getMarkdownLineContexts(lines.join(newline));
    for (let index = 0; index < lines.length; index += 1) {
      if (
        isObsidianTaskAtLine(
          lines.join(newline),
          index,
          lineContexts,
          lines,
        )
      ) {
        lines[index] = rewriteDependsOnIdsInLine(
          lines[index],
          new Map([[legacyId, canonicalId]]),
        );
      }
    }
  }
  const dependencyEdit = applyLocalTaskDependencyListEdits(
    lines[parentLine],
    "dependsOn",
    next.transcluded
      ? { add: [canonicalId] }
      : { remove: [canonicalId, legacyId, original.blockId].filter(Boolean) },
  );
  lines[line] = String(nextLineText);
  lines[parentLine] = dependencyEdit.line;
  if (next.transcluded) {
    lines[targetLine] = upsertBulletProperty(
      lines[targetLine],
      "id",
      canonicalId,
    ).line;
    lines[targetLine] = promoteObsidianTaskCheckboxStatus(
      lines[targetLine],
      getDependencyPromotionStatus(
        getObsidianTaskCheckboxStatus(toggledLines[parentLine]),
      ),
    );
    if (targetIsOpen) {
      lines[parentLine] = blockObsidianTaskCheckboxStatus(lines[parentLine]);
    }
  }
  return Object.freeze({
    qualified: true,
    reason: null,
    content: lines.join(newline),
    parentLine,
    targetLine,
    dependencyId: canonicalId,
    transcluded: next.transcluded,
  });
}

function applyDependencyNavigationPlanToLines(lines, plan) {
  const nextLines = lines.slice();
  if (!plan || !plan.changed) {
    return nextLines;
  }
  (plan.deleteLines || [])
    .slice()
    .sort((a, b) => b - a)
    .forEach((line) => nextLines.splice(line, 1));
  const replacement = String(plan.lineText || "").split("\n");
  if (plan.operation === "rewrite" && plan.replaceLine !== null) {
    nextLines.splice(plan.replaceLine, 1, ...replacement);
  } else if (plan.operation === "insert") {
    nextLines.splice(plan.insertLine, 0, ...replacement);
  }
  return nextLines;
}

function transformDependencyBulletsInContent(
  content,
  filePath,
  dependencyResolutions,
  options = {},
) {
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);
  const resolutions =
    dependencyResolutions instanceof Map
      ? dependencyResolutions
      : new Map(Object.entries(dependencyResolutions || {}));
  const ambiguousIds =
    options.ambiguousIds instanceof Set
      ? options.ambiguousIds
      : new Set(options.ambiguousIds || []);
  const unresolved = [];
  const skippedNonTasks = [];
  let changedTasks = 0;
  let dependencyItems = 0;
  let currentContent = lines.join(newline);
  let lineContexts = getMarkdownLineContexts(currentContent);

  for (let parentLine = lines.length - 1; parentLine >= 0; parentLine -= 1) {
    const field = findBulletPropertyField(lines[parentLine], "dependsOn");
    if (!field) {
      continue;
    }
    if (
      !isObsidianTaskAtLine(
        currentContent,
        parentLine,
        lineContexts,
        lines,
      )
    ) {
      skippedNonTasks.push(
        Object.freeze({ filePath, line: parentLine + 1 }),
      );
      continue;
    }
    const desired = [];
    const dependencyIds = parseLocalTaskIdList(field.value);
    if (dependencyIds.some((id) => ambiguousIds.has(id))) {
      dependencyIds
        .filter((id) => ambiguousIds.has(id))
        .forEach((id) =>
          unresolved.push(
            Object.freeze({ filePath, line: parentLine + 1, id, ambiguous: true }),
          ),
        );
      continue;
    }
    dependencyIds.forEach((id) => {
      const resolution = resolutions.get(id);
      if (!resolution || !normalizeBulletPropertyValue(resolution.blockId)) {
        unresolved.push(Object.freeze({ filePath, line: parentLine + 1, id }));
        return;
      }
      const targetPath = String(resolution.filePath || "");
      const basename = targetPath
        .split("/")
        .pop()
        .replace(/\.md$/i, "");
      desired.push({
        blockId: resolution.blockId,
        note:
          targetPath && targetPath !== filePath
            ? String(resolution.note || basename)
            : "",
      });
    });
    dependencyItems += desired.length;
    const plan = planDependencyNavigationBulletSync(
      currentContent,
      parentLine,
      desired,
      { managedBlockIds: desired },
    );
    if (plan.changed) {
      lines = applyDependencyNavigationPlanToLines(lines, plan);
      currentContent = lines.join(newline);
      lineContexts = getMarkdownLineContexts(currentContent);
      changedTasks += 1;
    }
  }

  const nextContent = currentContent;
  return Object.freeze({
    content: nextContent,
    changed: nextContent !== text,
    changedTasks,
    dependencyItems,
    unresolved: Object.freeze(unresolved),
    skippedNonTaskCount: skippedNonTasks.length,
    skippedNonTasks: Object.freeze(skippedNonTasks.reverse()),
  });
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

function getBulletPropertyStageTwoHints(hasPriorityRoll) {
  if (!hasPriorityRoll) {
    return BULLET_PROPERTY_STAGE_TWO_HINTS;
  }

  return [
    ...BULLET_PROPERTY_STAGE_TWO_HINTS.slice(0, -1),
    { keys: ["^R"], label: "Re-roll" },
    BULLET_PROPERTY_STAGE_TWO_HINTS[BULLET_PROPERTY_STAGE_TWO_HINTS.length - 1],
  ];
}

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
  } else if (options.counted) {
    label = "Create & apply";
  }

  return [
    { keys: ["↵"], label },
    { keys: ["esc"], label: "Cancel" },
  ];
}

// Footer hints for the schedule-log reason prompt: Enter always confirms the
// stage (writing the date, plus a log entry when a reason was typed), while
// Esc cancels the date write too.
function getBulletPropertyScheduleReasonHints(options = {}) {
  return [
    {
      keys: ["↵"],
      label: options.empty ? (options.fallback ? "Log without a reason" : "Skip reason") : "Log reason",
    },
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

const PROJECT_SCHEDULE_MONTHS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

function projectScheduleLocalDate(validation) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(validation.year, validation.month - 1, validation.day);
  return date;
}

function isFutureInlineScheduledValue(value, today = new Date()) {
  const validation = validateProjectScheduledDate(value);
  if (!validation.valid) {
    return false;
  }
  return (
    compareLocalDates(
      projectScheduleLocalDate(validation),
      getLocalDateStart(today),
    ) > 0
  );
}

function getFutureProjectSchedule(value, now = new Date()) {
  const validation = validateProjectScheduledDate(value);
  if (!validation.valid) {
    return Object.freeze({
      scheduled: false,
      date: "",
      label: "",
    });
  }

  const scheduledDate = projectScheduleLocalDate(validation);
  const localToday = getLocalDateStart(now);
  if (compareLocalDates(scheduledDate, localToday) <= 0) {
    return Object.freeze({
      scheduled: false,
      date: "",
      label: "",
    });
  }

  const tomorrow = addLocalDateDays(localToday, 1);
  let label;
  if (compareLocalDates(scheduledDate, tomorrow) === 0) {
    label = "Tomorrow";
  } else {
    label = `${PROJECT_SCHEDULE_MONTHS[validation.month - 1]} ${validation.day}`;
    if (validation.year !== localToday.getFullYear()) {
      label += `, ${validation.year}`;
    }
  }

  return Object.freeze({
    scheduled: true,
    date: validation.value,
    label,
  });
}

function getProjectNoteInfo(frontmatter, now = new Date()) {
  const isProject = Boolean(frontmatter) && isProjectType(frontmatter.type);
  if (!isProject) {
    return {
      isProject: false,
      statusKey: "",
      label: "",
      emoji: "",
      icon: "file-text",
      variant: "",
      scheduled: false,
      scheduledDate: "",
      scheduledLabel: "",
    };
  }

  const schedule = getFutureProjectSchedule(frontmatter.scheduled, now);
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
      scheduled: schedule.scheduled,
      scheduledDate: schedule.date,
      scheduledLabel: schedule.label,
    };
  }

  return {
    isProject: true,
    statusKey,
    label: formatProjectStatusLabel(statusKey),
    emoji: PROJECT_STATUS_FALLBACK.emoji,
    icon: PROJECT_STATUS_FALLBACK.icon,
    variant: PROJECT_STATUS_FALLBACK.variant,
    scheduled: schedule.scheduled,
    scheduledDate: schedule.date,
    scheduledLabel: schedule.label,
  };
}

function getChildNoteInfo(frontmatter, now = new Date()) {
  const projectInfo = getProjectNoteInfo(frontmatter, now);
  if (projectInfo.isProject) {
    return {
      kind: "project",
      decorated: true,
      statusKey: projectInfo.statusKey,
      label: projectInfo.label,
      emoji: projectInfo.emoji,
      icon: projectInfo.icon,
      variant: projectInfo.variant,
      scheduled: projectInfo.scheduled,
      scheduledDate: projectInfo.scheduledDate,
      scheduledLabel: projectInfo.scheduledLabel,
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
      scheduled: false,
      scheduledDate: "",
      scheduledLabel: "",
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
    scheduled: false,
    scheduledDate: "",
    scheduledLabel: "",
  };
}

function getFileChildNoteInfo(app, file, now = new Date()) {
  const frontmatter =
    app &&
    app.metadataCache &&
    typeof app.metadataCache.getFileCache === "function"
      ? app.metadataCache.getFileCache(file)?.frontmatter
      : null;
  return getChildNoteInfo(frontmatter, now);
}

function getChildNoteSummary(childFiles, noteInfoByPath) {
  let projectCount = 0;
  let areaCount = 0;
  let futureScheduledCount = 0;
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
    if (info.scheduled) {
      futureScheduledCount += 1;
    }
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

    if (futureScheduledCount > 0) {
      parts.push(
        `${futureScheduledCount} future-scheduled`,
      );
    }
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
    if (noteInfo.scheduled) {
      parts.push(
        "scheduled",
        noteInfo.scheduledDate,
        noteInfo.scheduledLabel,
      );
    }
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
    this.closeBeforeOpenItem = false;
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
    if (Object.prototype.hasOwnProperty.call(options, "closeBeforeOpenItem")) {
      this.closeBeforeOpenItem = Boolean(options.closeBeforeOpenItem);
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
    const closeBeforeOpenItem = this.closeBeforeOpenItem;
    if (closeBeforeOpenItem) {
      this.close();
    }
    try {
      if ((await this.openItem(item)) && !closeBeforeOpenItem) {
        this.close();
      }
    } finally {
      this.opening = false;
    }
  }
}

function renderTypedNotePickerRow(file, noteInfo, rowEl, query) {
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

  if (!noteInfo || !noteInfo.decorated) {
    return;
  }
  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  if (noteInfo.kind === "project" && noteInfo.scheduled) {
    const scheduleAriaLabel = `Project scheduled for ${noteInfo.scheduledDate}`;
    const scheduleEl = badgesEl.createDiv({
      cls: "bob-cnp-row-schedule",
      attr: {
        "aria-label": scheduleAriaLabel,
        title: scheduleAriaLabel,
      },
    });
    const scheduleIcon = scheduleEl.createSpan({
      cls: "bob-cnp-row-schedule-icon",
    });
    applyIcon(scheduleIcon, "calendar-clock");
    const scheduleLabel = scheduleEl.createSpan({
      cls: "bob-cnp-row-schedule-label",
    });
    appendHighlighted(scheduleLabel, noteInfo.scheduledLabel, query);
  }

  const statusText = [noteInfo.emoji, noteInfo.label]
    .filter(Boolean)
    .join(" ");
  const ariaLabel =
    noteInfo.kind === "area"
      ? "Area note"
      : `Project status: ${noteInfo.label}`;
  const statusEl = badgesEl.createDiv({
    cls: `bob-cnp-row-status is-status-${noteInfo.variant}`,
    attr: {
      "aria-label": ariaLabel,
      title: ariaLabel,
    },
  });
  appendHighlighted(statusEl, statusText, query);
}

function addPickerRowClasses(rowEl, classes) {
  const list = Array.isArray(classes) ? classes : [classes];
  if (rowEl && rowEl.classList && typeof rowEl.classList.add === "function") {
    rowEl.classList.add(...list.filter(Boolean));
    return;
  }
  if (rowEl && typeof rowEl.addClass === "function") {
    list.filter(Boolean).forEach((cls) => rowEl.addClass(cls));
  }
}

function renderPomodoroBulletMovePickerRow(row, rowEl, query) {
  const kind = row && row.kind ? row.kind : "invalid";
  addPickerRowClasses(rowEl, ["bob-cnp-pomodoro-row", `is-${kind}`]);

  const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
  applyIcon(
    rowIcon,
    kind === "new"
      ? "plus"
      : kind === "rename"
        ? "pencil"
        : kind === "invalid"
          ? "circle-alert"
          : "timer",
  );

  const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
  const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
  appendHighlighted(
    titleEl,
    kind === "invalid" ? row.statusText : row.title,
    query,
  );
  const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
  appendHighlighted(
    pathEl,
    kind === "invalid" ? "Type a valid Pomodoro name" : row.meta,
    query,
  );

  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  if (kind === "new" || kind === "rename") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-create",
    });
    appendHighlighted(statusEl, row.badge || "New", query);
    return;
  }
  if (kind === "invalid") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-unavailable",
    });
    appendHighlighted(statusEl, "Not selectable", query);
    return;
  }
  if (!row.statusLabel) {
    return;
  }

  const statusClass =
    row.statusLabel === "Unscheduled" ? " is-status-unscheduled" : "";
  const statusEl = badgesEl.createDiv({
    cls: `bob-cnp-row-status${statusClass}`,
    attr: {
      "aria-label": row.statusLabel,
      title: row.statusLabel,
    },
  });
  appendHighlighted(
    statusEl,
    [row.statusEmoji, row.statusLabel].filter(Boolean).join(" "),
    query,
  );
}

class ChildNotePickerModal extends FilteredPickerModal {
  constructor(app, plugin, childFiles, parentFile) {
    const now = new Date();
    const noteInfoByPath = new Map(
      childFiles.map((file) => [
        file.path,
        getFileChildNoteInfo(app, file, now),
      ]),
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
      renderItem: (file, rowEl, query) =>
        renderTypedNotePickerRow(
          file,
          noteInfoByPath.get(file.path),
          rowEl,
          query,
        ),
      openItem: (file) => plugin.openChildNote(file),
    });
  }
}

class TaskMoveDestinationPickerModal extends FilteredPickerModal {
  constructor(app, plugin, destinations, session) {
    const selectedCount = session.discovery.actualCount;
    const requestedCount = session.discovery.requestedCount;
    const clampedText = session.discovery.clamped
      ? ` · requested ${requestedCount}; reached end of note`
      : "";
    super(app, {
      items: destinations,
      title: "Move tasks to note",
      headerIcon: "move-right",
      inputLabel: "Filter task destinations",
      placeholder: "Filter areas and open projects",
      resultsLabel: "Task move destinations",
      emptyText: "No matching areas or open projects",
      getSubtitle: (visible, all) => {
        const shown =
          visible.length === all.length
            ? `${all.length} destination${all.length === 1 ? "" : "s"}`
            : `showing ${visible.length} of ${all.length} destinations`;
        return `${selectedCount} selected task${selectedCount === 1 ? "" : "s"} · ${shown}${clampedText}`;
      },
      filterItem: (entry, query) =>
        childNoteMatchesQuery(entry.file, entry.noteInfo, query),
      renderItem: (entry, rowEl, query) =>
        renderTypedNotePickerRow(entry.file, entry.noteInfo, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (entry) => plugin.commitTaskMoveSession(session, entry),
    });
    this.plugin = plugin;
    this.session = session;
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
  }
}

class PomodoroBulletMovePickerModal extends FilteredPickerModal {
  constructor(app, plugin, session) {
    const discovery = session && session.discovery ? session.discovery : {};
    const sourceEntry = session && session.sourceEntry ? session.sourceEntry : null;
    const destinationCount = (session && Array.isArray(session.entries)
      ? session.entries
      : []
    ).filter(
      (entry) =>
        entry &&
        entry.open &&
        (!sourceEntry || entry.entryLine !== sourceEntry.entryLine),
    ).length;
    const selectedCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.actualCount, 0)),
    );
    const requestedCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.requestedCount, selectedCount)),
    );
    const sourcePosition =
      sourceEntry && sourceEntry.position ? sourceEntry.position : "?";
    const clampedText = discovery.clamped
      ? ` · requested ${requestedCount}; reached end of Pomodoro`
      : "";

    super(app, {
      items: [],
      title: "Move Pomodoro bullets",
      headerIcon: "timer",
      inputLabel: "Filter Pomodoro destinations",
      placeholder: "Filter open Pomodoros or type a new name",
      resultsLabel: "Pomodoro destinations",
      emptyText: "Type a name to create a new Pomodoro",
      getSubtitle: () =>
        `${selectedCount} bullet${selectedCount === 1 ? "" : "s"} from Pomodoro #${sourcePosition} · ${destinationCount} destination${destinationCount === 1 ? "" : "s"}${clampedText}`,
      renderItem: (row, rowEl, query) =>
        renderPomodoroBulletMovePickerRow(row, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (row) => {
        if (!row || row.kind === "invalid") {
          return false;
        }
        return plugin.commitPomodoroBulletMoveSession(session, row);
      },
    });
    this.plugin = plugin;
    this.session = session;
  }

  getFilteredItems() {
    return createPomodoroBulletMovePickerRows(
      this.session && this.session.entries,
      this.session && this.session.sourceEntry
        ? this.session.sourceEntry.entryLine
        : null,
      this.getRawQuery(),
    );
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
  }
}

class PomodoroEntryMovePickerModal extends FilteredPickerModal {
  constructor(app, plugin, session) {
    const discovery = session && session.discovery ? session.discovery : {};
    const sourceEntry = session && session.sourceEntry ? session.sourceEntry : null;
    const destinationCount = (session && Array.isArray(session.entries)
      ? session.entries
      : []
    ).filter(
      (entry) =>
        entry &&
        entry.open &&
        (!sourceEntry || entry.entryLine !== sourceEntry.entryLine),
    ).length;
    const bulletCount = Math.max(
      0,
      Math.floor(numericOrDefault(discovery.bulletCount, 0)),
    );
    const sourcePosition =
      sourceEntry && sourceEntry.position ? sourceEntry.position : "?";
    const ignoredCountText =
      session && session.countExplicit && session.ignoredCount > 0
        ? " · count ignored on a Pomodoro entry"
        : "";

    super(app, {
      items: [],
      title: "Move or rename Pomodoro",
      headerIcon: "timer",
      inputLabel: "Filter Pomodoro destinations",
      placeholder: "Filter open Pomodoros or type a new name",
      resultsLabel: "Pomodoro destinations",
      emptyText: "Type a name to rename this Pomodoro",
      getSubtitle: () =>
        `Pomodoro #${sourcePosition} (${bulletCount} bullet${bulletCount === 1 ? "" : "s"}) · ${destinationCount} destination${destinationCount === 1 ? "" : "s"}${ignoredCountText}`,
      renderItem: (row, rowEl, query) =>
        renderPomodoroBulletMovePickerRow(row, rowEl, query),
      closeBeforeOpenItem: true,
      openItem: (row) => {
        if (!row || row.kind === "invalid") {
          return false;
        }
        return plugin.commitPomodoroEntryMoveSession(session, row);
      },
    });
    this.plugin = plugin;
    this.session = session;
  }

  getFilteredItems() {
    return createPomodoroBulletMovePickerRows(
      this.session && this.session.entries,
      this.session && this.session.sourceEntry
        ? this.session.sourceEntry.entryLine
        : null,
      this.getRawQuery(),
      { mode: "entry" },
    );
  }

  onClose() {
    if (
      this.plugin &&
      this.plugin.activeTaskMoveDestinationPicker === this
    ) {
      this.plugin.activeTaskMoveDestinationPicker = null;
    }
    super.onClose();
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

function splitMarkdownContent(content) {
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    lines: text.split(/\r?\n/),
    lineEnding,
  };
}

function isProjectLifecycleTaskLine(lineText) {
  const text = String(lineText || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  if (!match || getTrailingBlockId(text) !== "prj") {
    return false;
  }

  return PROJECT_TASK_TAG_RE.test(match[2] || "");
}

function getMarkdownLineContext(content, targetLine) {
  const { lines } = splitMarkdownContent(content);
  if (
    !Number.isInteger(targetLine) ||
    targetLine < 0 ||
    targetLine >= lines.length
  ) {
    return Object.freeze({ valid: false, inFrontmatter: false, inFence: false });
  }

  let inFrontmatter = startsWithFrontmatter(lines);
  let inFence = null;
  for (let lineIndex = 0; lineIndex <= targetLine; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    if (inFrontmatter) {
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      if (lineIndex === targetLine) {
        return Object.freeze({
          valid: true,
          inFrontmatter: true,
          inFence: false,
        });
      }
      continue;
    }

    if (inFence) {
      const targetIsInFence = lineIndex === targetLine;
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      if (targetIsInFence) {
        return Object.freeze({
          valid: true,
          inFrontmatter: false,
          inFence: true,
        });
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      if (lineIndex === targetLine) {
        return Object.freeze({
          valid: true,
          inFrontmatter: false,
          inFence: true,
        });
      }
      continue;
    }

    if (lineIndex === targetLine) {
      return Object.freeze({
        valid: true,
        inFrontmatter: false,
        inFence: false,
      });
    }
  }

  return Object.freeze({ valid: false, inFrontmatter: false, inFence: false });
}

function getMarkdownLineContexts(content) {
  const { lines } = splitMarkdownContent(content);
  const contexts = [];
  let inFrontmatter = startsWithFrontmatter(lines);
  let inFence = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    if (inFrontmatter) {
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: true, inFence: false }),
      );
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }
    if (inFence) {
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: false, inFence: true }),
      );
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }
    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: false, inFence: true }),
      );
      continue;
    }
    contexts.push(
      Object.freeze({ valid: true, inFrontmatter: false, inFence: false }),
    );
  }
  return Object.freeze(contexts);
}

// Whole-note dependency operations must reject task-shaped examples in YAML
// frontmatter and fenced code, even when the individual line looks valid.
function isObsidianTaskAtLine(
  content,
  lineIndex,
  lineContexts = null,
  sourceLines = null,
) {
  const lines = sourceLines || splitMarkdownContent(content).lines;
  const context = lineContexts
    ? lineContexts[lineIndex] || {
        valid: false,
        inFrontmatter: false,
        inFence: false,
      }
    : getMarkdownLineContext(content, lineIndex);
  return (
    context.valid &&
    !context.inFrontmatter &&
    !context.inFence &&
    isObsidianTaskLine(lines[lineIndex])
  );
}

function isProjectLifecycleTaskAtLine(content, lineIndex) {
  const { lines } = splitMarkdownContent(content);
  const context = getMarkdownLineContext(content, lineIndex);
  return (
    context.valid &&
    !context.inFrontmatter &&
    !context.inFence &&
    isProjectLifecycleTaskLine(lines[lineIndex])
  );
}

function getYamlScalarText(rawValue) {
  const text = String(rawValue || "").trim();
  const quoted = /^(["'])(.*)\1(?:[ \t]+#.*)?$/.exec(text);
  if (quoted) {
    return quoted[2].trim();
  }

  return text.replace(/[ \t]+#.*$/, "").trim();
}

function parseProjectNoteFrontmatter(content, options = {}) {
  const { lines, lineEnding } = splitMarkdownContent(content);
  if (!startsWithFrontmatter(lines)) {
    return Object.freeze({
      valid: false,
      error: "Project note has no YAML frontmatter",
    });
  }

  let closingLine = -1;
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[lineIndex])) {
      closingLine = lineIndex;
      break;
    }
  }
  if (closingLine === -1) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter is not closed",
    });
  }

  const yamlText = lines.slice(1, closingLine).join("\n");
  let data;
  try {
    const yamlParser = options.parseYaml || parseYaml;
    data = yamlParser(yamlText);
  } catch (error) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter is malformed",
    });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter must be a YAML mapping",
    });
  }
  const typeLine = lines
    .slice(1, closingLine)
    .map((line, index) => ({
      line: index + 1,
      match: /^type[ \t]*:(.*)$/.exec(line),
    }))
    .find((entry) => entry.match);
  const rawType = typeLine ? getYamlScalarText(typeLine.match[1]) : "";
  if (!isProjectType(data.type) && rawType !== PROJECT_TYPE_WIKILINK) {
    return Object.freeze({
      valid: false,
      error: "The ^prj task is not in a project note",
    });
  }

  const scheduledLines = [];
  for (let lineIndex = 1; lineIndex < closingLine; lineIndex += 1) {
    const match = /^scheduled[ \t]*:(.*)$/.exec(lines[lineIndex]);
    if (match) {
      scheduledLines.push({ line: lineIndex, rawValue: match[1] });
    }
  }
  if (scheduledLines.length > 1) {
    return Object.freeze({
      valid: false,
      error: "Project note has multiple scheduled properties",
    });
  }

  const scheduledDefined = Object.prototype.hasOwnProperty.call(
    data,
    "scheduled",
  );
  if (scheduledDefined !== (scheduledLines.length === 1)) {
    return Object.freeze({
      valid: false,
      error: "Project scheduled must be a top-level YAML property",
    });
  }

  let scheduledValue = "";
  if (scheduledDefined) {
    const parsedValue = data.scheduled;
    if (
      parsedValue !== null &&
      parsedValue !== undefined &&
      typeof parsedValue !== "string" &&
      !(parsedValue instanceof Date)
    ) {
      return Object.freeze({
        valid: false,
        error: "Project scheduled must be a YYYY-MM-DD date",
      });
    }
    scheduledValue = getYamlScalarText(scheduledLines[0].rawValue);
    const validation = validateProjectScheduledDate(scheduledValue);
    if (!validation.valid) {
      return Object.freeze({ valid: false, error: validation.message });
    }
    scheduledValue = validation.value;
  }

  return Object.freeze({
    valid: true,
    error: null,
    data,
    lines,
    lineEnding,
    closingLine,
    scheduledDefined,
    scheduledValue,
    scheduledLine: scheduledDefined ? scheduledLines[0].line : null,
  });
}

function emptyProjectNoteReversalSplit(error, extra = {}) {
  return Object.freeze({
    valid: false,
    error,
    status: extra.status === undefined ? null : extra.status,
    description:
      extra.description === undefined ? null : extra.description,
    lifecycleChildLines: Object.freeze(
      Array.isArray(extra.lifecycleChildLines)
        ? extra.lifecycleChildLines.slice()
        : [],
    ),
    taskLines: Object.freeze([]),
    sections: Object.freeze([]),
  });
}

function getProjectReversalChildLines(lines, startIndex) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const parentLine = String(sourceLines[startIndex] || "");
  const parentMatch = PROJECT_LIST_ITEM_RE.exec(parentLine);
  if (!parentMatch) {
    return [];
  }

  const parentIndentLength = parentMatch[1].length;
  const collected = [];
  let lastContentOffset = -1;
  for (let index = startIndex + 1; index < sourceLines.length; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      collected.push(lineText);
      continue;
    }

    const indentMatch = /^(\s*)/.exec(lineText);
    const indentLength = indentMatch ? indentMatch[1].length : 0;
    if (indentLength > parentIndentLength) {
      collected.push(lineText);
      lastContentOffset = collected.length - 1;
      continue;
    }

    break;
  }

  return lastContentOffset === -1
    ? []
    : collected.slice(0, lastContentOffset + 1);
}

function formatProjectReversalSnippet(lineText) {
  return truncateProjectTaskDescription(String(lineText || "").trim());
}

function formatProjectReversalSectionLabel(headerText) {
  return String(headerText || "")
    .trim()
    .replace(/\s+/g, " ");
}

function splitProjectNoteForReversal(content) {
  const { lines } = splitMarkdownContent(content);
  const contexts = getMarkdownLineContexts(content);
  const prjIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const context = contexts[index];
    if (!context || context.inFrontmatter || context.inFence) {
      continue;
    }
    if (isProjectLifecycleTaskLine(lines[index])) {
      prjIndexes.push(index);
    }
  }

  if (prjIndexes.length === 0) {
    return emptyProjectNoteReversalSplit("Project note has no ^prj task");
  }
  if (prjIndexes.length > 1) {
    return emptyProjectNoteReversalSplit(
      "Project note has multiple ^prj tasks",
    );
  }

  const prjIndex = prjIndexes[0];
  const parsed = parseProjectLifecycleTaskBody(lines[prjIndex]);
  const status = parsed ? parsed.status : null;
  const description = parsed ? parsed.description : "";
  const lifecycleChildLines = getProjectReversalChildLines(lines, prjIndex);
  const prjBlockEnd = prjIndex + lifecycleChildLines.length;
  const splitExtra = { status, description, lifecycleChildLines };

  const taskLines = [];
  const sections = [];
  let index = 0;
  while (index < lines.length) {
    const context = contexts[index];
    if (!context || context.inFrontmatter) {
      index += 1;
      continue;
    }

    if (index === prjIndex) {
      index = prjBlockEnd + 1;
      continue;
    }

    const line = String(lines[index] || "");
    if (
      context.valid &&
      !context.inFence &&
      PROJECT_SECTION_HEADER_RE.test(line)
    ) {
      const headerMatch = PROJECT_SECTION_HEADER_RE.exec(line);
      const headerText = headerMatch && headerMatch[1] ? headerMatch[1] : "";
      const sectionLabel = formatProjectReversalSectionLabel(headerText);
      const bodyLines = [];
      let bodyIndex = index + 1;
      for (; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyContext = contexts[bodyIndex];
        const bodyLine = String(lines[bodyIndex] || "");
        if (
          bodyContext &&
          bodyContext.valid &&
          !bodyContext.inFrontmatter &&
          !bodyContext.inFence &&
          PROJECT_SECTION_BOUNDARY_HEADER_RE.test(bodyLine)
        ) {
          break;
        }
        if (bodyLine.trim() === "") {
          continue;
        }
        if (
          bodyContext &&
          bodyContext.valid &&
          !bodyContext.inFence &&
          PROJECT_LIST_ITEM_RE.test(bodyLine)
        ) {
          bodyLines.push(bodyLine);
          continue;
        }

        return emptyProjectNoteReversalSplit(
          `Section "${sectionLabel}" has content that is not a list item: "${formatProjectReversalSnippet(bodyLine)}"`,
          splitExtra,
        );
      }

      if (normalizeProjectSectionTitle(headerText) === "tasks") {
        for (const item of bodyLines) {
          if (!item.includes(PROJECT_TASKS_PLACEHOLDER)) {
            taskLines.push(item);
          }
        }
      } else if (bodyLines.length > 0) {
        const title = formatProjectReversalSectionTitle(headerText);
        if (!title) {
          return emptyProjectNoteReversalSplit(
            `Section "${sectionLabel}" cannot be converted into a task bullet`,
            splitExtra,
          );
        }
        sections.push(
          Object.freeze({
            title,
            noteLines: Object.freeze(bodyLines.slice()),
          }),
        );
      }

      index = bodyIndex;
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    return emptyProjectNoteReversalSplit(
      `Project note has content outside the ^prj task and its sections: "${formatProjectReversalSnippet(line)}"`,
      splitExtra,
    );
  }

  return Object.freeze({
    valid: true,
    error: null,
    status,
    description,
    lifecycleChildLines: Object.freeze(lifecycleChildLines.slice()),
    taskLines: Object.freeze(taskLines),
    sections: Object.freeze(sections),
  });
}

function emptyProjectNoteReversalBlock(error, extra = {}) {
  return Object.freeze({
    valid: false,
    error,
    lines: Object.freeze([]),
    taskCount: 0,
    sectionCount: 0,
    blockId: extra.blockId === undefined ? null : extra.blockId,
    scheduled: extra.scheduled || "",
    created: extra.created || "",
    parentLink: extra.parentLink === undefined ? null : extra.parentLink,
  });
}

function buildTaskBlockFromProjectNote(content, options = {}) {
  const frontmatter = parseProjectNoteFrontmatter(content, options);
  if (!frontmatter.valid) {
    return emptyProjectNoteReversalBlock(frontmatter.error);
  }

  const split = splitProjectNoteForReversal(content);
  if (
    split.error === "Project note has multiple ^prj tasks" ||
    split.error === "Project note has no ^prj task"
  ) {
    return emptyProjectNoteReversalBlock(split.error, {
      parentLink: frontmatter.data && frontmatter.data.parent,
    });
  }

  if (split.status === null || split.status === undefined) {
    return emptyProjectNoteReversalBlock(
      split.error || "Project note has no ^prj task",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }

  if (!PROJECT_OPEN_TASK_STATUSES.has(split.status)) {
    return emptyProjectNoteReversalBlock(
      "Only open projects can be converted back to a task",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (
    String(split.description || "").includes(PROJECT_COMPLETION_PLACEHOLDER)
  ) {
    return emptyProjectNoteReversalBlock(
      "Project completion criteria is still the template placeholder",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (!split.description) {
    return emptyProjectNoteReversalBlock(
      "Project completion criteria is empty",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (!split.valid) {
    return emptyProjectNoteReversalBlock(split.error, {
      parentLink: frontmatter.data && frontmatter.data.parent,
    });
  }

  const noteBasename = String(options.noteBasename || "").trim();
  const parentBasename =
    options.parentBasename === undefined
      ? getProjectParentBasenameFromLink(
          frontmatter.data && frontmatter.data.parent,
        )
      : String(options.parentBasename || "").trim();
  const blockId = getProjectReversalBlockId(noteBasename, parentBasename);
  const scheduled = frontmatter.scheduledValue || "";
  const createdRaw = getProjectFrontmatterCreatedDate(
    frontmatter.lines,
    frontmatter.closingLine,
  );
  const now = options.now instanceof Date ? options.now : new Date();
  const created = createdRaw || formatProjectTaskCreatedDate(now);
  const taskLine = buildTaskLineFromProjectNote({
    status: split.status,
    description: split.description,
    scheduled,
    created,
    blockId,
  });

  const indentedTasks = indentProjectReversalLines(split.taskLines, 1);
  const lines = [taskLine, ...indentedTasks];
  let sectionCount = 0;
  for (const section of split.sections) {
    lines.push(`\t- ${section.title}`);
    lines.push(...indentProjectReversalLines(section.noteLines, 2));
    sectionCount += 1;
  }
  lines.push(...indentProjectReversalLines(split.lifecycleChildLines, 1));

  let taskCount = 0;
  for (const line of indentedTasks) {
    const parsedChild = parseProjectChildListItem(line, 0);
    if (parsedChild && parsedChild.indent === "\t") {
      taskCount += 1;
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    lines: Object.freeze(lines),
    taskCount,
    sectionCount,
    blockId,
    scheduled,
    created,
    parentLink: frontmatter.data && frontmatter.data.parent,
  });
}

function getProjectNotePropertyContext(content, lineIndex, options = {}) {
  if (!isProjectLifecycleTaskAtLine(content, lineIndex)) {
    return Object.freeze({
      valid: true,
      isProjectTask: false,
      frontmatter: null,
    });
  }

  const frontmatter = parseProjectNoteFrontmatter(content, options);
  if (!frontmatter.valid) {
    return Object.freeze({
      valid: false,
      isProjectTask: true,
      error: frontmatter.error,
      frontmatter,
    });
  }

  return Object.freeze({
    valid: true,
    isProjectTask: true,
    error: null,
    frontmatter,
  });
}

function resolveBulletPropertyTarget(name, context = {}) {
  const descriptor = Object.prototype.hasOwnProperty.call(
    PROJECT_NOTE_PROPERTY_TARGETS,
    name,
  )
    ? PROJECT_NOTE_PROPERTY_TARGETS[name]
    : null;
  if (descriptor && context.isProjectTask && context.valid) {
    return descriptor;
  }

  return Object.freeze({ kind: "inline", fieldName: name });
}

function getBulletPropertyCurrentLabel(property, value) {
  const currentValue = normalizeBulletPropertyValue(value);
  if (
    property &&
    property.values === "priority" &&
    property.levelsByValue instanceof Map
  ) {
    const level = property.levelsByValue.get(currentValue);
    if (level) {
      return level.label;
    }
  }

  return currentValue;
}

function createBulletPropertyItems(config, line, context = {}) {
  const fields = getBulletPropertyFieldMap(line);
  const dependencyEligible =
    context.isObsidianTask === undefined
      ? isObsidianTaskLine(line)
      : Boolean(context.isObsidianTask);
  return config.properties
    .map((property, order) => {
      const target = resolveBulletPropertyTarget(property.name, context);
      const field =
        target.kind === "inline" ? fields.get(property.name) || null : null;
      const frontmatterDefined =
        target.kind === "project-frontmatter" &&
        context.frontmatter &&
        context.frontmatter.scheduledDefined;
      const currentValue = frontmatterDefined
        ? context.frontmatter.scheduledValue
        : field
          ? field.value
          : "";
      return {
        kind: "property",
        property,
        target,
        order,
        defined: frontmatterDefined || !!field,
        currentValue,
        currentLabel: getBulletPropertyCurrentLabel(property, currentValue),
        dependencyEligible,
      };
    })
    .filter(
      (item) =>
        item.property.values !== "local_task_id" ||
        item.dependencyEligible ||
        item.defined,
    )
    .sort((first, second) => {
      if (first.defined !== second.defined) {
        return first.defined ? -1 : 1;
      }

      return first.order - second.order;
    });
}

// An explicit Vim count for the property picker means "additional tasks": a
// repeat of 2 snapshots the current real task plus the next two real tasks in
// document order. Physical line distance is deliberately irrelevant.
function discoverCountedObsidianTaskTargets(
  content,
  startLine,
  additionalTaskCount,
) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalTaskCount, 0)),
  );
  const requestedCount = additional + 1;
  const contexts = getMarkdownLineContexts(text);

  if (
    !Number.isFinite(line) ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines)
  ) {
    return Object.freeze({
      valid: false,
      error: "Counted property editing must start on a #task checkbox",
      explicit: true,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
    });
  }

  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < source.lines.length && targets.length < requestedCount;
    lineIndex += 1
  ) {
    if (
      isObsidianTaskAtLine(text, lineIndex, contexts, source.lines)
    ) {
      targets.push(
        Object.freeze({
          line: lineIndex,
          rawLine: String(source.lines[lineIndex] || ""),
        }),
      );
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: true,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
  });
}

function validateCountedTaskSession(content, session) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const targets = session && Array.isArray(session.targets)
    ? session.targets
    : [];
  if (!session || session.valid === false || targets.length === 0) {
    return Object.freeze({
      valid: false,
      error: "Counted task session is unavailable",
      staleTarget: null,
    });
  }

  for (const target of targets) {
    const liveLine = Number.isInteger(target.line)
      ? source.lines[target.line]
      : undefined;
    if (
      liveLine !== target.rawLine ||
      !isObsidianTaskAtLine(text, target.line, contexts, source.lines)
    ) {
      return Object.freeze({
        valid: false,
        error: "A counted task changed while the picker was open",
        staleTarget: target,
      });
    }
  }

  return Object.freeze({ valid: true, error: null, staleTarget: null });
}

// A task move uses the same count convention as counted property editing, but
// project lifecycle tasks are structural controls and therefore never become
// move targets. The first line must itself be movable; later ^prj tasks are
// skipped without consuming the requested count.
function discoverMovableObsidianTaskTargets(
  content,
  startLine,
  additionalTaskCount,
) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalTaskCount, 0)),
  );
  const requestedCount = additional + 1;
  const contexts = getMarkdownLineContexts(text);
  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      explicit: additional > 0,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
    });

  if (
    !Number.isFinite(line) ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines)
  ) {
    return invalid("Move tasks must start on a real #task checkbox");
  }
  if (isProjectLifecycleTaskLine(source.lines[line])) {
    return invalid("Project lifecycle tasks cannot be moved");
  }

  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < source.lines.length && targets.length < requestedCount;
    lineIndex += 1
  ) {
    if (
      isObsidianTaskAtLine(text, lineIndex, contexts, source.lines) &&
      !isProjectLifecycleTaskLine(source.lines[lineIndex])
    ) {
      targets.push(
        Object.freeze({
          line: lineIndex,
          rawLine: String(source.lines[lineIndex] || ""),
        }),
      );
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: additional > 0,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
  });
}

function getTaskMoveColumn(text) {
  let column = 0;
  for (const character of String(text || "")) {
    column += character === "\t" ? 4 : 1;
  }
  return column;
}

// Return the Markdown container prefix before a line's content. The prefix may
// contain indentation and one or more blockquote markers. Keeping both its raw
// text and display column lets subtree detection handle nested/quoted tasks
// while still rebasing the captured block losslessly in the common case.
function parseTaskMoveContainerPrefix(lineText) {
  const text = String(lineText || "");
  let index = 0;
  let quoteDepth = 0;
  let initialIndentEnd = 0;
  let sawQuote = false;

  while (index < text.length) {
    const whitespaceStart = index;
    while (index < text.length && (text[index] === " " || text[index] === "\t")) {
      index += 1;
    }
    if (!sawQuote) {
      initialIndentEnd = index;
    }
    if (text[index] !== ">") {
      break;
    }
    sawQuote = true;
    quoteDepth += 1;
    index += 1;
    if (text[index] === " " || text[index] === "\t") {
      index += 1;
    }
    if (index === whitespaceStart) {
      break;
    }
  }

  const prefix = text.slice(0, index);
  const initialIndent = text.slice(0, initialIndentEnd);
  return Object.freeze({
    prefix,
    length: prefix.length,
    column: getTaskMoveColumn(prefix),
    quoteDepth,
    initialIndentColumn: getTaskMoveColumn(initialIndent),
  });
}

function parseTaskMoveListItem(lineText) {
  const text = String(lineText || "");
  const container = parseTaskMoveContainerPrefix(text);
  const remainder = text.slice(container.length);
  const markerMatch = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(remainder);
  if (!markerMatch) {
    return null;
  }
  return Object.freeze({
    ...container,
    markerIndex: container.length,
    markerText: markerMatch[0],
    contentColumn: container.column + getTaskMoveColumn(markerMatch[0]),
  });
}

function isTaskMoveBlankLine(lineText) {
  return /^[\s>]*$/.test(String(lineText || ""));
}

function taskMoveLineIsDescendant(root, lineText) {
  const text = String(lineText || "");
  if (!root || isTaskMoveBlankLine(text)) {
    return false;
  }
  const candidate = parseTaskMoveContainerPrefix(text);
  if (candidate.quoteDepth < root.quoteDepth) {
    return false;
  }
  // A top-level blockquote immediately following an unquoted task is a sibling
  // block, not task content. An indented blockquote can still be a child.
  if (
    root.quoteDepth === 0 &&
    candidate.quoteDepth > 0 &&
    candidate.initialIndentColumn <= root.initialIndentColumn
  ) {
    return false;
  }
  return candidate.column >= root.contentColumn;
}

function captureTaskMoveSubtree(content, target) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = target && Number.isInteger(target.line) ? target.line : -1;
  const contexts = getMarkdownLineContexts(text);
  if (
    line < 0 ||
    line >= source.lines.length ||
    source.lines[line] !== target.rawLine ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines) ||
    isProjectLifecycleTaskLine(source.lines[line])
  ) {
    return Object.freeze({
      valid: false,
      error: "A selected task changed before it could be moved",
    });
  }

  const root = parseTaskMoveListItem(source.lines[line]);
  if (!root) {
    return Object.freeze({ valid: false, error: "Selected task is not a list item" });
  }

  let endLineExclusive = line + 1;
  let pendingBlankEnd = endLineExclusive;
  for (let index = line + 1; index < source.lines.length; index += 1) {
    const candidate = String(source.lines[index] || "");
    if (isTaskMoveBlankLine(candidate)) {
      pendingBlankEnd = index + 1;
      continue;
    }
    if (!taskMoveLineIsDescendant(root, candidate)) {
      break;
    }
    endLineExclusive = index + 1;
    pendingBlankEnd = endLineExclusive;
  }

  // Blank lines are retained only when followed by deeper content. Trailing
  // separators stay with the source/destination section rather than the task.
  const blockLines = source.lines.slice(line, endLineExclusive);
  return Object.freeze({
    valid: true,
    error: null,
    startLine: line,
    endLineExclusive,
    lines: Object.freeze(blockLines),
    root,
    pendingBlankEnd,
    selectedTargetLines: Object.freeze([line]),
  });
}

function buildTaskMoveRanges(content, targets) {
  const captured = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const block = captureTaskMoveSubtree(content, target);
    if (!block.valid) {
      return Object.freeze({ valid: false, error: block.error, ranges: [] });
    }
    captured.push(block);
  }
  captured.sort((left, right) => left.startLine - right.startLine);

  const ranges = [];
  for (const block of captured) {
    const previous = ranges[ranges.length - 1];
    if (previous && block.startLine < previous.endLineExclusive) {
      previous.selectedTargetLines.push(block.startLine);
      continue;
    }
    ranges.push({
      startLine: block.startLine,
      endLineExclusive: block.endLineExclusive,
      lines: [...block.lines],
      root: block.root,
      selectedTargetLines: [...block.selectedTargetLines],
    });
  }

  return Object.freeze({
    valid: ranges.length > 0,
    error: ranges.length > 0 ? null : "No movable tasks were selected",
    ranges: Object.freeze(
      ranges.map((range) =>
        Object.freeze({
          ...range,
          lines: Object.freeze(range.lines),
          selectedTargetLines: Object.freeze(range.selectedTargetLines),
        }),
      ),
    ),
  });
}

function removeTaskMoveRanges(content, ranges) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const nextLines = source.lines.slice();
  const ordered = (Array.isArray(ranges) ? ranges : [])
    .slice()
    .sort((left, right) => right.startLine - left.startLine);
  if (ordered.length === 0) {
    return Object.freeze({
      valid: false,
      error: "No task ranges are available",
      content: text,
      nextLine: 0,
    });
  }

  for (const range of ordered) {
    const expected = Array.isArray(range.lines) ? range.lines : [];
    const live = nextLines.slice(range.startLine, range.endLineExclusive);
    if (
      live.length !== expected.length ||
      live.some((line, index) => line !== expected[index])
    ) {
      return Object.freeze({
        valid: false,
        error: "A selected task subtree changed before it could be moved",
        content: text,
        nextLine: range.startLine,
      });
    }

    let deleteCount = range.endLineExclusive - range.startLine;
    const before = nextLines[range.startLine - 1];
    const after = nextLines[range.endLineExclusive];
    if (
      before !== undefined &&
      after !== undefined &&
      String(before).trim() === "" &&
      String(after).trim() === ""
    ) {
      // Avoid leaving a doubled seam while preserving one existing separator.
      deleteCount += 1;
    }
    nextLines.splice(range.startLine, deleteCount);
  }

  const firstStart = Math.min(...ordered.map((range) => range.startLine));
  return Object.freeze({
    valid: true,
    error: null,
    content: nextLines.join(source.lineEnding),
    nextLine: Math.min(firstStart, Math.max(nextLines.length - 1, 0)),
  });
}

function rebaseTaskMoveBlock(range) {
  const lines = range && Array.isArray(range.lines) ? range.lines : [];
  const root = range && range.root;
  if (!root || lines.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    lines.map((line, index) => {
      const text = String(line || "");
      if (isTaskMoveBlankLine(text)) {
        return "";
      }
      if (index === 0) {
        return text.slice(root.markerIndex);
      }
      if (root.prefix && text.startsWith(root.prefix)) {
        return text.slice(root.prefix.length);
      }
      // Mixed tabs/spaces or quote spacing can make the raw prefix differ.
      // Remove no more than the root's structural display width.
      let column = 0;
      let offset = 0;
      while (offset < text.length && column < root.column) {
        column += text[offset] === "\t" ? 4 : 1;
        offset += 1;
      }
      return text.slice(offset);
    }),
  );
}

function flattenTaskMoveBlocks(blocks) {
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const blockLines = Array.isArray(block) ? block.map(String) : [];
    if (blockLines.length === 0) {
      continue;
    }
    lines.push(...blockLines);
  }
  return lines;
}

function parseTaskMoveDestinationFrontmatter(content, options = {}) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  if (!startsWithFrontmatter(source.lines)) {
    return Object.freeze({ valid: false, error: "Destination has no YAML frontmatter" });
  }
  let closingLine = -1;
  for (let index = 1; index < source.lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(source.lines[index])) {
      closingLine = index;
      break;
    }
  }
  if (closingLine === -1) {
    return Object.freeze({ valid: false, error: "Destination frontmatter is not closed" });
  }

  let data;
  try {
    const yamlParser = options.parseYaml || parseYaml;
    data = yamlParser(source.lines.slice(1, closingLine).join("\n"));
  } catch (error) {
    return Object.freeze({ valid: false, error: "Destination frontmatter is malformed" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Object.freeze({ valid: false, error: "Destination frontmatter must be a mapping" });
  }

  const noteInfo = getChildNoteInfo(data, options.now || new Date());
  if (noteInfo.kind === "area") {
    return Object.freeze({
      valid: true,
      error: null,
      kind: "area",
      statusKey: "",
      data,
      noteInfo,
    });
  }
  if (
    noteInfo.kind === "project" &&
    TASK_MOVE_OPEN_PROJECT_STATUSES.has(noteInfo.statusKey)
  ) {
    return Object.freeze({
      valid: true,
      error: null,
      kind: "project",
      statusKey: noteInfo.statusKey,
      data,
      noteInfo,
    });
  }

  const error =
    noteInfo.kind === "project"
      ? "Destination project is no longer open"
      : "Destination is no longer an area or open project";
  return Object.freeze({ valid: false, error, kind: noteInfo.kind, data, noteInfo });
}

function collectTaskMoveDestinations(files, sourcePath, getNoteInfo) {
  const source = normalizeVaultRelativePath(sourcePath);
  const infoFor =
    typeof getNoteInfo === "function"
      ? getNoteInfo
      : () => getChildNoteInfo(null);
  return (Array.isArray(files) ? files : [])
    .filter((file) => {
      const path = normalizeVaultRelativePath(file && file.path);
      return (
        path &&
        MARKDOWN_EXTENSION_RE.test(path) &&
        path !== source &&
        !TASK_MOVE_TEMPLATE_PATHS.has(path)
      );
    })
    .map((file) => ({ file, noteInfo: infoFor(file) }))
    .filter(
      ({ noteInfo }) =>
        noteInfo &&
        (noteInfo.kind === "area" ||
          (noteInfo.kind === "project" &&
            TASK_MOVE_OPEN_PROJECT_STATUSES.has(noteInfo.statusKey))),
    )
    .sort((left, right) => {
      const leftPath = String(left.file.path || "");
      const rightPath = String(right.file.path || "");
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    })
    .map((entry) => Object.freeze(entry));
}

function getTaskMoveSectionEnd(lines, headerIndex) {
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
      return index;
    }
  }
  return lines.length;
}

function insertTaskMoveBlocks(content, blocks, destinationKind) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const movedLines = flattenTaskMoveBlocks(blocks);
  if (movedLines.length === 0) {
    return Object.freeze({ valid: false, error: "No task content is available", content: text });
  }

  let headerIndex = findProjectTasksHeaderIndex(source.lines);
  if (headerIndex === -1) {
    if (destinationKind !== "area") {
      return Object.freeze({
        valid: false,
        error: "Open project destination has no valid ## Tasks section",
        content: text,
      });
    }
    const hadTerminalNewline = /\r?\n$/.test(text);
    let next = text;
    if (next && !next.endsWith(source.lineEnding)) {
      next += source.lineEnding;
    }
    if (next && !next.endsWith(source.lineEnding + source.lineEnding)) {
      next += source.lineEnding;
    }
    next += `${PROJECT_TASKS_HEADER}${source.lineEnding}${source.lineEnding}`;
    const insertedLine = next.split(source.lineEnding).length - 1;
    next += movedLines.join(source.lineEnding);
    if (hadTerminalNewline) {
      next += source.lineEnding;
    }
    return Object.freeze({ valid: true, error: null, content: next, createdSection: true, insertedLine });
  }

  const sectionEnd = getTaskMoveSectionEnd(source.lines, headerIndex);
  const nonblankBody = [];
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    if (String(source.lines[index] || "").trim() !== "") {
      nonblankBody.push(index);
    }
  }
  const placeholderIndex =
    nonblankBody.length === 1 &&
    PROJECT_SOURCE_TASK_LINE_RE.test(source.lines[nonblankBody[0]]) &&
    source.lines[nonblankBody[0]].includes(PROJECT_TASKS_PLACEHOLDER)
      ? nonblankBody[0]
      : -1;

  let nextLines;
  let insertedLine;
  if (placeholderIndex !== -1) {
    nextLines = source.lines
      .slice(0, placeholderIndex)
      .concat(movedLines, source.lines.slice(placeholderIndex + 1));
    insertedLine = placeholderIndex;
  } else {
    let insertAt = sectionEnd;
    while (
      insertAt > headerIndex + 1 &&
      String(source.lines[insertAt - 1] || "").trim() === ""
    ) {
      insertAt -= 1;
    }
    const insertion = [];
    if (insertAt === headerIndex + 1) {
      insertion.push("");
    }
    insertion.push(...movedLines);
    nextLines = source.lines
      .slice(0, insertAt)
      .concat(insertion, source.lines.slice(insertAt));
    insertedLine = insertAt + (insertion.length - movedLines.length);
  }

  return Object.freeze({
    valid: true,
    error: null,
    content: nextLines.join(source.lineEnding),
    createdSection: false,
    insertedLine,
  });
}

function collectTaskMoveBlockIds(content) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const ids = new Set();
  for (let index = 0; index < source.lines.length; index += 1) {
    const context = contexts[index];
    if (!context || context.inFrontmatter || context.inFence) {
      continue;
    }
    const id = getTrailingBlockId(source.lines[index]);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function prepareTaskMoveBlockIdentities(blocks, sourcePath, destinationPath) {
  const nextBlocks = (Array.isArray(blocks) ? blocks : []).map((block) =>
    Array.isArray(block) ? block.map(String) : [],
  );
  const movedBlockIds = new Set();
  const idReplacements = new Map();

  for (const block of nextBlocks) {
    for (let index = 0; index < block.length; index += 1) {
      const line = block[index];
      const blockId = getTrailingBlockId(line);
      if (!blockId) {
        continue;
      }
      if (movedBlockIds.has(blockId)) {
        return Object.freeze({ valid: false, error: `Moved task block ID is duplicated: ${blockId}` });
      }
      movedBlockIds.add(blockId);

      if (!isObsidianTaskLine(line)) {
        continue;
      }
      const oldCanonicalId = tryDependencyId(sourcePath, blockId);
      const newCanonicalId = tryDependencyId(destinationPath, blockId);
      if (!oldCanonicalId || !newCanonicalId) {
        return Object.freeze({
          valid: false,
          error: `Task block ID cannot be encoded for the move: ${blockId}`,
        });
      }
      const idFields = parseBulletPropertyFields(line).filter(
        (field) => field.key === "id",
      );
      if (idFields.length > 1) {
        return Object.freeze({
          valid: false,
          error: `Task has multiple [id::] fields: ${blockId}`,
        });
      }
      if (idFields.length === 1) {
        const existingId = normalizeBulletPropertyValue(idFields[0].value);
        if (existingId !== oldCanonicalId && existingId !== blockId) {
          return Object.freeze({
            valid: false,
            error: `Task has an ambiguous [id::] value: ${blockId}`,
          });
        }
        if (existingId) {
          idReplacements.set(existingId, newCanonicalId);
        }
      }
      idReplacements.set(oldCanonicalId, newCanonicalId);
      block[index] = upsertBulletProperty(line, "id", newCanonicalId).line;
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    blocks: Object.freeze(nextBlocks.map((block) => Object.freeze(block))),
    movedBlockIds,
    idReplacements,
  });
}

function taskMoveLinkNoteMatchesPath(note, filePath) {
  const target = normalizeVaultRelativePath(note).replace(MARKDOWN_EXTENSION_RE, "");
  const path = normalizeVaultRelativePath(filePath).replace(MARKDOWN_EXTENSION_RE, "");
  if (!target || !path) {
    return false;
  }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return target === path || target === basename;
}

function rewriteTaskMoveBlockLinks(content, options = {}) {
  const text = String(content || "");
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  const destinationPath = normalizeVaultRelativePath(options.destinationPath);
  const currentPath = normalizeVaultRelativePath(options.currentPath);
  const role = String(options.role || "external");
  const movedBlockIds =
    options.movedBlockIds instanceof Set
      ? options.movedBlockIds
      : new Set(options.movedBlockIds || []);
  const sourceBlockIds =
    options.sourceBlockIds instanceof Set
      ? options.sourceBlockIds
      : new Set(options.sourceBlockIds || []);
  const sourceNote = sourcePath.replace(MARKDOWN_EXTENSION_RE, "");
  const destinationNote = destinationPath.replace(MARKDOWN_EXTENSION_RE, "");

  const nextNote = (note, blockId, markdown) => {
    const pathless = !String(note || "").trim();
    if (role === "moved" && pathless) {
      if (movedBlockIds.has(blockId)) {
        return note;
      }
      if (sourceBlockIds.has(blockId)) {
        return markdown ? sourcePath : sourceNote;
      }
      return note;
    }

    const targetsSource = pathless
      ? currentPath === sourcePath
      : taskMoveLinkNoteMatchesPath(note, sourcePath);
    if (targetsSource && movedBlockIds.has(blockId)) {
      return markdown ? destinationPath : destinationNote;
    }
    return note;
  };

  const rewriteLine = (line) => {
    let nextLine = String(line || "").replace(
      /(!?)\[\[([^\]\n|#]*?)#\^([A-Za-z0-9-]+)(\|[^\]\n]*)?\]\]/g,
      (match, embed, note, blockId, alias = "") => {
        const replacementNote = nextNote(note, blockId, false);
        return replacementNote === note
          ? match
          : `${embed}[[${replacementNote}#^${blockId}${alias || ""}]]`;
      },
    );
    nextLine = nextLine.replace(
      /(!?\[[^\]\n]*(?:\\.[^\]\n]*)*\]\()([^\s)#]*?)#\^([A-Za-z0-9-]+)([^)]*)\)/g,
      (match, prefix, note, blockId, suffix = "") => {
        const replacementNote = nextNote(note, blockId, true);
        return replacementNote === note
          ? match
          : `${prefix}${replacementNote}#^${blockId}${suffix || ""})`;
      },
    );
    return nextLine;
  };
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const next = source.lines
    .map((line, index) =>
      contexts[index] && contexts[index].inFence ? line : rewriteLine(line),
    )
    .join(source.lineEnding);
  return Object.freeze({ content: next, changed: next !== text });
}

function rewriteTaskMoveReferences(content, options = {}) {
  const text = String(content || "");
  const dependencyRewrite = rewriteDependsOnIdsInContent(
    text,
    options.idReplacements || new Map(),
  );
  return rewriteTaskMoveBlockLinks(dependencyRewrite.content, options);
}

function planTaskMoveAcrossFiles(options = {}) {
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  const destinationPath = normalizeVaultRelativePath(options.destinationPath);
  const sourceContent = String(options.sourceContent || "");
  const destinationContent = String(options.destinationContent || "");
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) {
    return Object.freeze({ valid: false, error: "Task move source and destination are invalid" });
  }

  const destination = parseTaskMoveDestinationFrontmatter(
    destinationContent,
    options,
  );
  if (!destination.valid) {
    return Object.freeze({ valid: false, error: destination.error });
  }
  const rangeResult = buildTaskMoveRanges(sourceContent, options.targets);
  if (!rangeResult.valid) {
    return Object.freeze({ valid: false, error: rangeResult.error });
  }
  const removal = removeTaskMoveRanges(sourceContent, rangeResult.ranges);
  if (!removal.valid) {
    return Object.freeze({ valid: false, error: removal.error });
  }

  const rebasedBlocks = rangeResult.ranges.map(rebaseTaskMoveBlock);
  const identities = prepareTaskMoveBlockIdentities(
    rebasedBlocks,
    sourcePath,
    destinationPath,
  );
  if (!identities.valid) {
    return Object.freeze({ valid: false, error: identities.error });
  }
  const destinationBlockIds = collectTaskMoveBlockIds(destinationContent);
  for (const blockId of identities.movedBlockIds) {
    if (destinationBlockIds.has(blockId)) {
      return Object.freeze({
        valid: false,
        error: `Destination already contains block ID: ${blockId}`,
      });
    }
  }

  const sourceBlockIds = collectTaskMoveBlockIds(sourceContent);
  const referenceOptions = {
    sourcePath,
    destinationPath,
    movedBlockIds: identities.movedBlockIds,
    sourceBlockIds,
    idReplacements: identities.idReplacements,
  };
  const movedBlocks = identities.blocks.map((block) => {
    const rewritten = rewriteTaskMoveReferences(block.join("\n"), {
      ...referenceOptions,
      currentPath: sourcePath,
      role: "moved",
    });
    return Object.freeze(rewritten.content.split("\n"));
  });
  const rewrittenSource = rewriteTaskMoveReferences(removal.content, {
    ...referenceOptions,
    currentPath: sourcePath,
    role: "source",
  }).content;
  const rewrittenDestination = rewriteTaskMoveReferences(destinationContent, {
    ...referenceOptions,
    currentPath: destinationPath,
    role: "destination",
  }).content;
  const insertion = insertTaskMoveBlocks(
    rewrittenDestination,
    movedBlocks,
    destination.kind,
  );
  if (!insertion.valid) {
    return Object.freeze({ valid: false, error: insertion.error });
  }

  const changes = new Map([
    [sourcePath, Object.freeze({ before: sourceContent, after: rewrittenSource })],
    [
      destinationPath,
      Object.freeze({ before: destinationContent, after: insertion.content }),
    ],
  ]);
  const otherContents =
    options.otherContents instanceof Map
      ? options.otherContents
      : new Map(Object.entries(options.otherContents || {}));
  for (const [path, content] of otherContents.entries()) {
    const normalizedPath = normalizeVaultRelativePath(path);
    if (!normalizedPath || normalizedPath === sourcePath || normalizedPath === destinationPath) {
      continue;
    }
    const before = String(content || "");
    const after = rewriteTaskMoveReferences(before, {
      ...referenceOptions,
      currentPath: normalizedPath,
      role: "external",
    }).content;
    if (after !== before) {
      changes.set(normalizedPath, Object.freeze({ before, after }));
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    changes,
    ranges: rangeResult.ranges,
    movedBlocks: Object.freeze(movedBlocks),
    movedBlockIds: identities.movedBlockIds,
    idReplacements: identities.idReplacements,
    nextSourceLine: removal.nextLine,
    destinationKind: destination.kind,
    destinationLine: insertion.insertedLine,
    destinationAnchorText: movedBlocks[0][0],
    destinationBlockId: getTrailingBlockId(movedBlocks[0][0]) || null,
  });
}

function resolveTaskMoveDestinationLine(content, anchor) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const anchorInfo = anchor && typeof anchor === "object" ? anchor : {};
  const anchorLine = anchorInfo.line;
  const anchorText = anchorInfo.text;
  const anchorBlockId = anchorInfo.blockId;

  if (
    Number.isInteger(anchorLine) &&
    anchorLine >= 0 &&
    anchorLine < lines.length &&
    lines[anchorLine] === anchorText
  ) {
    return Object.freeze({ line: anchorLine, source: "planned" });
  }

  if (anchorBlockId) {
    const blockIdLine = findTaskLineByBlockId(lines, anchorBlockId);
    if (blockIdLine !== null) {
      return Object.freeze({ line: blockIdLine, source: "block-id" });
    }
  }

  if (anchorText) {
    const contexts = getMarkdownLineContexts(text);
    for (let index = 0; index < lines.length; index += 1) {
      const context = contexts[index];
      if (context && (context.inFrontmatter || context.inFence)) {
        continue;
      }
      if (lines[index] === anchorText) {
        return Object.freeze({ line: index, source: "text" });
      }
    }
  }

  if (lines.length === 0) {
    return Object.freeze({ line: 0, source: "clamped" });
  }
  const clampedLine = Math.min(
    Math.max(numericOrDefault(anchorLine, 0), 0),
    lines.length - 1,
  );
  return Object.freeze({ line: clampedLine, source: "clamped" });
}

function getCountedPropertyTargetState(
  content,
  target,
  property,
  options = {},
) {
  const context = getProjectNotePropertyContext(
    content,
    target.line,
    options,
  );
  if (!context.valid) {
    return Object.freeze({ valid: false, error: context.error });
  }

  const descriptor = resolveBulletPropertyTarget(property.name, context);
  if (descriptor.kind === "project-frontmatter") {
    const defined = Boolean(
      context.frontmatter && context.frontmatter.scheduledDefined,
    );
    return Object.freeze({
      valid: true,
      error: null,
      target: descriptor,
      context,
      defined,
      value: defined ? context.frontmatter.scheduledValue : "",
    });
  }

  const field = findBulletPropertyField(target.rawLine, property.name);
  return Object.freeze({
    valid: true,
    error: null,
    target: descriptor,
    context,
    defined: Boolean(field),
    value: field ? field.value : "",
  });
}

// Aggregate a property row across counted source tasks. A value is "common"
// only when every source defines the same value; partial presence is mixed.
function createCountedBulletPropertyItems(
  config,
  content,
  session,
  options = {},
) {
  const validation = validateCountedTaskSession(content, session);
  if (!validation.valid) {
    return Object.freeze({ valid: false, error: validation.error, items: [] });
  }

  const items = [];
  for (let order = 0; order < config.properties.length; order += 1) {
    const property = config.properties[order];
    const states = [];
    for (const target of session.targets) {
      const state = getCountedPropertyTargetState(
        content,
        target,
        property,
        options,
      );
      if (!state.valid) {
        return Object.freeze({ valid: false, error: state.error, items: [] });
      }
      states.push(state);
    }

    const definedStates = states.filter((state) => state.defined);
    const values = Array.from(
      new Set(definedStates.map((state) => state.value)),
    );
    const allDefined = definedStates.length === states.length;
    const valueState =
      definedStates.length === 0
        ? "absent"
        : allDefined && values.length === 1
          ? "common"
          : "mixed";
    const currentLabels = Object.freeze(
      values.map((value) => getBulletPropertyCurrentLabel(property, value)),
    );
    items.push({
      kind: "property",
      property,
      target: Object.freeze({ kind: "counted-task-batch" }),
      order,
      defined: definedStates.length > 0,
      definedCount: definedStates.length,
      targetCount: states.length,
      currentValue: valueState === "common" ? values[0] : "",
      currentLabel: valueState === "common" ? currentLabels[0] : "",
      currentValues: Object.freeze(values),
      currentLabels,
      valueState,
      mixed: valueState === "mixed",
      dependencyEligible: true,
      sourceStates: Object.freeze(states),
    });
  }

  items.sort((first, second) => {
    if (first.defined !== second.defined) {
      return first.defined ? -1 : 1;
    }
    return first.order - second.order;
  });
  return Object.freeze({
    valid: true,
    error: null,
    items: Object.freeze(items),
  });
}

function validateDependencyParentForEditor(editor, cursor, expectedLine = null) {
  if (!editor || typeof editor.getValue !== "function" || !cursor) {
    return Object.freeze({
      valid: false,
      line: null,
      message: "No active markdown editor",
    });
  }
  const line = getEditorLine(editor, cursor.line);
  if (line === null) {
    return Object.freeze({
      valid: false,
      line: null,
      message: "No active markdown editor",
    });
  }
  const content = String(editor.getValue() || "");
  if (!isObsidianTaskAtLine(content, cursor.line)) {
    return Object.freeze({
      valid: false,
      line,
      message: "Dependencies can only be set on #task checkboxes.",
    });
  }
  if (expectedLine !== null && line !== expectedLine) {
    return Object.freeze({
      valid: false,
      line,
      message: "Current task changed; dependencies not updated",
    });
  }
  return Object.freeze({ valid: true, line, message: null });
}

function isTaskTagLeftBoundary(character) {
  return (
    character === undefined || /\s/.test(character) || "([{".includes(character)
  );
}

function isTaskTagRightBoundary(character) {
  return (
    character === undefined ||
    /\s/.test(character) ||
    "])}:.,;!?".includes(character)
  );
}

function getWholeTaskTagSpans(text, tag) {
  const source = String(text || "");
  const spans = [];
  let offset = 0;
  while (offset < source.length) {
    const relativeIndex = source.indexOf(tag, offset);
    if (relativeIndex === -1) {
      break;
    }
    const end = relativeIndex + tag.length;
    if (
      isTaskTagLeftBoundary(source[relativeIndex - 1]) &&
      isTaskTagRightBoundary(source[end])
    ) {
      spans.push(Object.freeze({ start: relativeIndex, end }));
      offset = end;
    } else {
      offset = relativeIndex + 1;
    }
  }
  return spans;
}

function hasWholeTaskTag(text, tag) {
  return getWholeTaskTagSpans(text, tag).length > 0;
}

function removeTextSpans(line, spans) {
  return (Array.isArray(spans) ? spans : [])
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, span) => removeBulletPropertyFieldSpan(text, span),
      String(line || ""),
    );
}

function normalizeProjectLifecycleHideTag(lineText, hide, includeProjectTask) {
  const text = String(lineText || "");
  if (!includeProjectTask) {
    return text;
  }
  const spans = getWholeTaskTagSpans(text, PROJECT_HIDE_TAG);
  if (!hide) {
    return removeTextSpans(text, spans);
  }
  if (spans.length > 0) {
    return removeTextSpans(text, spans.slice(1));
  }

  const trailingBlockId = getTrailingBlockIdSpan(text);
  const insertionIndex = trailingBlockId
    ? trailingBlockId.start
    : text.trimEnd().length;
  const before = text.slice(0, insertionIndex).replace(/[ \t]+$/, "");
  const after = text.slice(insertionIndex);
  return `${before} ${PROJECT_HIDE_TAG}${after}`;
}

function parseProjectTaskScheduledFields(lineText) {
  const text = String(lineText || "");
  const fields = [];
  const pattern =
    /(?:\[([^\[\]\n]+?)::([^\]\n]*)\]|\(([^()\n]+?)::([^)\n]*)\))/g;
  let match = pattern.exec(text);
  while (match) {
    const key = String(match[1] ?? match[3] ?? "").trim();
    if (key === "scheduled") {
      fields.push(
        Object.freeze({
          key,
          value: String(match[2] ?? match[4] ?? "").trim(),
          raw: match[0],
          span: Object.freeze({
            start: match.index,
            end: match.index + match[0].length,
          }),
        }),
      );
    }
    match = pattern.exec(text);
  }
  return fields;
}

function upsertProjectTaskScheduledField(lineText, scheduled) {
  const text = String(lineText || "");
  const fields = parseProjectTaskScheduledFields(text);
  if (fields.length > 1) {
    return Object.freeze({ line: text, changed: false, ambiguous: true });
  }
  if (fields.length === 1) {
    const validation = validateProjectScheduledDate(fields[0].value);
    if (validation.valid && validation.value >= scheduled) {
      return Object.freeze({
        line: text,
        changed: false,
        ambiguous: false,
      });
    }
    const nextLine =
      text.slice(0, fields[0].span.start) +
      formatBulletPropertyField("scheduled", scheduled) +
      text.slice(fields[0].span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      ambiguous: false,
    });
  }
  const inserted = upsertBulletProperty(text, "scheduled", scheduled);
  return Object.freeze({
    line: inserted.line,
    changed: inserted.changed,
    ambiguous: false,
  });
}

function removeProjectTaskScheduledFields(lineText, predicate = () => true) {
  const text = String(lineText || "");
  const spans = parseProjectTaskScheduledFields(text)
    .filter((field) => predicate(field))
    .map((field) => field.span);
  return Object.freeze({
    line: removeTextSpans(text, spans),
    removedCount: spans.length,
  });
}

function getRealMarkdownTaskLines(content) {
  const { lines } = splitMarkdownContent(content);
  const tasks = [];
  let inFrontmatter = startsWithFrontmatter(lines);
  let inFence = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    if (inFrontmatter) {
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
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
    if (!OBSIDIAN_TASK_LINE_RE.test(line)) {
      continue;
    }

    tasks.push(
      Object.freeze({
        line: lineIndex,
        text: line,
        isProjectTask: isProjectLifecycleTaskLine(line),
      }),
    );
  }

  return tasks;
}

function getProjectScheduleRecoveryTargetLines(content) {
  return getRealMarkdownTaskLines(content)
    .filter((task) => {
      if (task.isProjectTask) {
        return false;
      }
      const match = OBSIDIAN_TASK_LINE_RE.exec(task.text);
      return Boolean(match && OPEN_OBSIDIAN_TASK_STATUSES.has(match[1]));
    })
    .map((task) => task.line);
}

function planProjectTaskSchedules(
  content,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  if (!validation.valid) {
    return Object.freeze({
      valid: false,
      error: validation.message,
      content: String(content || ""),
      changed: false,
      changedTaskCount: 0,
      scheduledTaskCount: 0,
      removedHideTaskCount: 0,
      blockedTaskCount: 0,
      recoveredReadyTaskCount: 0,
      recoveredNextTaskCount: 0,
      recoveredInProgressTaskCount: 0,
      stillBlockedTaskCount: 0,
      deferredRecoveryTaskCount: 0,
      ambiguousTaskLines: Object.freeze([]),
      taskCount: 0,
      futureScheduledTaskLines: Object.freeze([]),
    });
  }

  const scheduledDate = new Date(
    validation.year,
    validation.month - 1,
    validation.day,
  );
  const localToday = getLocalDateStart(today);
  const future = compareLocalDates(scheduledDate, localToday) > 0;
  const source = splitMarkdownContent(content);
  const tasks = getRealMarkdownTaskLines(content);
  let changedTaskCount = 0;
  let scheduledTaskCount = 0;
  let removedHideTaskCount = 0;
  let blockedTaskCount = 0;
  let projectHideChanged = false;
  const ambiguousTaskLines = [];
  const futureScheduledTaskLines = [];
  const recoveryCounts = emptyScheduledRecoveryCounts();
  tasks.forEach((task) => {
    if (task.isProjectTask) {
      let nextLine = normalizeProjectLifecycleHideTag(
        task.text,
        future,
        future || tasks.length === 1,
      );
      nextLine = removeProjectTaskScheduledFields(nextLine).line;
      if (nextLine !== task.text) {
        source.lines[task.line] = nextLine;
        changedTaskCount += 1;
        projectHideChanged =
          getWholeTaskTagSpans(nextLine, PROJECT_HIDE_TAG).length !==
          getWholeTaskTagSpans(task.text, PROJECT_HIDE_TAG).length;
      }
      // `^prj` never receives an inline `scheduled` field — its schedule lives
      // in frontmatter only — so it is never blocked by the branch below. It
      // still needs pruning from today's open Pomodoros when the project
      // itself moves to a future date.
      if (future) {
        futureScheduledTaskLines.push(task.line);
      }
      return;
    }

    const scheduledFields = parseProjectTaskScheduledFields(task.text);
    if (scheduledFields.length > 1) {
      ambiguousTaskLines.push(task.line);
      return;
    }

    let nextLine = removeTextSpans(
      task.text,
      getWholeTaskTagSpans(task.text, PROJECT_HIDE_TAG),
    );
    if (nextLine !== task.text) {
      removedHideTaskCount += 1;
    }
    const match = OBSIDIAN_TASK_LINE_RE.exec(nextLine);
    const status = match ? match[1] : null;
    if (OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      const scheduleResult = upsertProjectTaskScheduledField(
        nextLine,
        validation.value,
      );
      nextLine = scheduleResult.line;
      if (scheduleResult.changed) {
        scheduledTaskCount += 1;
      }

      const finalFields = parseProjectTaskScheduledFields(nextLine);
      const futureTaskSchedule =
        finalFields.length === 1 &&
        isFutureInlineScheduledValue(finalFields[0].value, today);
      if (futureTaskSchedule) {
        futureScheduledTaskLines.push(task.line);
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) {
          nextLine = blockedLine;
          blockedTaskCount += 1;
        }
      } else if (finalFields.length === 1) {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, task.line),
        );
        nextLine = recovery.line;
        recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
      }
    }
    if (nextLine !== task.text) {
      source.lines[task.line] = nextLine;
      changedTaskCount += 1;
    }
  });

  const nextContent = source.lines.join(source.lineEnding);
  return Object.freeze({
    valid: true,
    error: null,
    content: nextContent,
    changed: nextContent !== String(content || ""),
    changedTaskCount,
    scheduledTaskCount,
    removedHideTaskCount,
    blockedTaskCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
    ambiguousTaskLines: Object.freeze(ambiguousTaskLines),
    taskCount: tasks.length,
    future,
    projectHideChanged,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
  });
}

function removeAllBulletProperties(line, name) {
  let text = String(line || "");
  let field = findBulletPropertyField(text, name);
  while (field) {
    text = removeBulletPropertyFieldSpan(text, field.span);
    field = findBulletPropertyField(text, name);
  }
  return text;
}

function replaceMarkdownLine(content, lineIndex, nextLine) {
  const source = splitMarkdownContent(content);
  if (lineIndex < 0 || lineIndex >= source.lines.length) {
    return String(content || "");
  }
  source.lines[lineIndex] = nextLine;
  return source.lines.join(source.lineEnding);
}

function updateProjectScheduledFrontmatter(content, frontmatter, value) {
  const source = splitMarkdownContent(content);
  let cursorLineDelta = 0;
  if (value === null) {
    if (frontmatter.scheduledDefined) {
      source.lines.splice(frontmatter.scheduledLine, 1);
      cursorLineDelta = -1;
    }
  } else if (frontmatter.scheduledDefined) {
    source.lines[frontmatter.scheduledLine] = `scheduled: ${value}`;
  } else {
    source.lines.splice(frontmatter.closingLine, 0, `scheduled: ${value}`);
    cursorLineDelta = 1;
  }

  return Object.freeze({
    content: source.lines.join(source.lineEnding),
    cursorLineDelta,
  });
}

function planProjectScheduledUpdate(
  content,
  cursorLine,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  if (!validation.valid) {
    return Object.freeze({ valid: false, error: validation.message });
  }
  const context = getProjectNotePropertyContext(content, cursorLine, options);
  if (!context.valid || !context.isProjectTask) {
    return Object.freeze({
      valid: false,
      error: context.error || "Cursor is not on a valid ^prj task",
    });
  }

  const propagation = planProjectTaskSchedules(
    content,
    validation.value,
    today,
    options,
  );
  if (!propagation.valid) {
    return Object.freeze({ valid: false, error: propagation.error });
  }
  const frontmatterUpdate = updateProjectScheduledFrontmatter(
    propagation.content,
    context.frontmatter,
    validation.value,
  );

  return Object.freeze({
    valid: true,
    error: null,
    content: frontmatterUpdate.content,
    changed: frontmatterUpdate.content !== String(content || ""),
    cursorLine: cursorLine + frontmatterUpdate.cursorLineDelta,
    scheduled: validation.value,
    future: propagation.future,
    changedTaskCount: propagation.changedTaskCount,
    scheduledTaskCount: propagation.scheduledTaskCount,
    removedHideTaskCount: propagation.removedHideTaskCount,
    futureScheduledTaskLines: propagation.futureScheduledTaskLines,
    blockedTaskCount: propagation.blockedTaskCount,
    recoveredReadyTaskCount: propagation.recoveredReadyTaskCount,
    recoveredNextTaskCount: propagation.recoveredNextTaskCount,
    recoveredInProgressTaskCount:
      propagation.recoveredInProgressTaskCount,
    stillBlockedTaskCount: propagation.stillBlockedTaskCount,
    deferredRecoveryTaskCount: propagation.deferredRecoveryTaskCount,
    ambiguousTaskLines: propagation.ambiguousTaskLines,
  });
}

function planProjectScheduledDelete(content, cursorLine, options = {}) {
  const context = getProjectNotePropertyContext(content, cursorLine, options);
  if (!context.valid || !context.isProjectTask) {
    return Object.freeze({
      valid: false,
      error: context.error || "Cursor is not on a valid ^prj task",
    });
  }
  if (!context.frontmatter.scheduledDefined) {
    return Object.freeze({
      valid: false,
      error: "scheduled is not set on this project",
    });
  }

  const scheduled = context.frontmatter.scheduledValue;
  const source = splitMarkdownContent(content);
  const tasks = getRealMarkdownTaskLines(content);
  let changedTaskCount = 0;
  let removedScheduledTaskCount = 0;
  const recoveryCounts = emptyScheduledRecoveryCounts();
  tasks.forEach((task) => {
    let nextLine = task.text;
    if (task.isProjectTask) {
      nextLine = removeProjectTaskScheduledFields(nextLine).line;
    } else {
      const match = OBSIDIAN_TASK_LINE_RE.exec(nextLine);
      const status = match ? match[1] : null;
      if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
        return;
      }
      const removed = removeProjectTaskScheduledFields(
        nextLine,
        (field) => field.value === scheduled,
      );
      nextLine = removed.line;
      if (removed.removedCount > 0) {
        removedScheduledTaskCount += 1;
      }
      const remaining = parseProjectTaskScheduledFields(nextLine);
      if (
        remaining.length === 1 &&
        isFutureInlineScheduledValue(remaining[0].value, options.today || new Date())
      ) {
        nextLine = blockObsidianTaskCheckboxStatus(nextLine);
      } else if (remaining.length < 2) {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, task.line),
        );
        nextLine = recovery.line;
        recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
      }
    }
    if (nextLine !== task.text) {
      source.lines[task.line] = nextLine;
      changedTaskCount += 1;
    }
  });
  const cleanedContent = source.lines.join(source.lineEnding);
  const frontmatterUpdate = updateProjectScheduledFrontmatter(
    cleanedContent,
    context.frontmatter,
    null,
  );
  return Object.freeze({
    valid: true,
    error: null,
    content: frontmatterUpdate.content,
    changed: frontmatterUpdate.content !== String(content || ""),
    cursorLine: cursorLine + frontmatterUpdate.cursorLineDelta,
    scheduled,
    changedTaskCount,
    removedScheduledTaskCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
  });
}

function isDueInlineScheduledValue(value, today = new Date()) {
  const validation = validateProjectScheduledDate(value);
  return (
    validation.valid &&
    !isFutureInlineScheduledValue(validation.value, today)
  );
}

function getTargetScheduledRecovery(options, line) {
  const recoveryByLine = options && options.recoveryByLine;
  if (recoveryByLine instanceof Map) {
    return recoveryByLine.get(line) || null;
  }
  if (recoveryByLine && typeof recoveryByLine === "object") {
    return recoveryByLine[line] || null;
  }
  return null;
}

function reconcileBlockedScheduledTaskLine(lineText, recovery) {
  const line = String(lineText || "");
  const taskMatch = OBSIDIAN_TASK_LINE_RE.exec(line);
  if (!taskMatch || taskMatch[1] !== "?") {
    return Object.freeze({
      line,
      changed: false,
      outcome: null,
    });
  }
  const decision =
    recovery || deferredScheduledRecovery("recovery snapshot is unavailable");
  if (
    !["ready", "next", "in-progress"].includes(decision.state) ||
    ![" ", "*", "/"].includes(decision.rank)
  ) {
    return Object.freeze({
      line,
      changed: false,
      outcome:
        decision.state === "blocked" ? "still-blocked" : "deferred",
    });
  }
  const checkboxOffset = taskMatch[0].indexOf("[?]") + 1;
  const nextLine =
    line.slice(0, checkboxOffset) +
    decision.rank +
    line.slice(checkboxOffset + 1);
  return Object.freeze({
    line: nextLine,
    changed: nextLine !== line,
    outcome: decision.state,
  });
}

function emptyScheduledRecoveryCounts() {
  return {
    ready: 0,
    next: 0,
    inProgress: 0,
    stillBlocked: 0,
    deferred: 0,
  };
}

function recordScheduledRecoveryOutcome(counts, outcome) {
  if (outcome === "ready") counts.ready += 1;
  if (outcome === "next") counts.next += 1;
  if (outcome === "in-progress") counts.inProgress += 1;
  if (outcome === "still-blocked") counts.stillBlocked += 1;
  if (outcome === "deferred") counts.deferred += 1;
}

function scheduledRecoveryNoticeParts(counts = {}) {
  const parts = [];
  if (counts.ready > 0) {
    parts.push(`recovered ${formatCountLabel(counts.ready, "task")} Ready`);
  }
  if (counts.next > 0) {
    parts.push(`recovered ${formatCountLabel(counts.next, "task")} Next`);
  }
  if (counts.inProgress > 0) {
    parts.push(
      `recovered ${formatCountLabel(counts.inProgress, "task")} In Progress`,
    );
  }
  if (counts.stillBlocked > 0) {
    parts.push(
      `${formatCountLabel(counts.stillBlocked, "task")} still Blocked`,
    );
  }
  if (counts.deferred > 0) {
    parts.push(
      `${formatCountLabel(
        counts.deferred,
        "task",
      )} deferred to bob task-status-hooks`,
    );
  }
  return Object.freeze(parts);
}

function scheduledRecoveryNoticeSuffix(counts = {}) {
  const parts = scheduledRecoveryNoticeParts(counts);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

function getCountedTaskNoticeParts(session, unchangedTaskCount = 0) {
  const parts = [];
  if (unchangedTaskCount > 0) {
    parts.push(`${formatCountLabel(unchangedTaskCount, "task")} unchanged`);
  }
  if (session && session.clamped) {
    parts.push(
      `requested ${session.requestedCount}, found ${session.actualCount} at end of note`,
    );
  }
  return Object.freeze(parts);
}

function getCountedTaskNoticeSuffix(session, unchangedTaskCount = 0) {
  const parts = getCountedTaskNoticeParts(session, unchangedTaskCount);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

// Plan one counted set/delete without mutating the editor. Scheduled values on
// ^prj sources are composed through project frontmatter and task schedules first;
// every other source remains an inline Dataview edit. The caller can therefore
// commit the complete result as one guarded transaction.
function planCountedBulletPropertyBatch(
  content,
  session,
  name,
  value,
  options = {},
) {
  const text = String(content || "");
  const propertyName = normalizeBulletPropertyName(name);
  const operation =
    options.operation === "delete"
      ? "delete"
      : options.operation === "set-priority"
        ? "set-priority"
        : "set";
  const isPriorityOperation = operation === "set-priority";
  const normalizedValue = normalizeBulletPropertyValue(
    isPriorityOperation ? options.priorityValue : value,
  );
  const scheduledPropertyName = isPriorityOperation
    ? normalizeBulletPropertyName(options.scheduledPropertyName)
    : "";
  const scheduledValueByLine =
    isPriorityOperation && options.scheduledValueByLine instanceof Map
      ? options.scheduledValueByLine
      : null;
  const shouldBlockInlineTasks =
    operation === "set" &&
    propertyName === "scheduled" &&
    isFutureInlineScheduledValue(
      normalizedValue,
      options.today || new Date(),
    );
  const shouldRecoverInlineTasks =
    propertyName === "scheduled" &&
    (operation === "delete" ||
      (operation === "set" &&
        isDueInlineScheduledValue(
          normalizedValue,
          options.today || new Date(),
        )));
  const sessionValidation = validateCountedTaskSession(text, session);
  if (!sessionValidation.valid) {
    return Object.freeze({
      valid: false,
      stale: true,
      error: sessionValidation.error,
      content: text,
      changed: false,
    });
  }
  if (!propertyName) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Bullet property name is empty",
      content: text,
      changed: false,
    });
  }
  if (
    isPriorityOperation &&
    (!normalizedValue || !scheduledPropertyName || !scheduledValueByLine)
  ) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Counted priority update is missing configured values",
      content: text,
      changed: false,
    });
  }

  const targetStates = [];
  const property = { name: propertyName };
  const scheduledProperty = { name: scheduledPropertyName };
  for (const target of session.targets) {
    const state = getCountedPropertyTargetState(
      text,
      target,
      property,
      options,
    );
    if (!state.valid) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: state.error,
        content: text,
        changed: false,
      });
    }
    let scheduledState = null;
    if (isPriorityOperation) {
      const scheduledValue = normalizeBulletPropertyValue(
        scheduledValueByLine.get(target.line),
      );
      if (
        !scheduledValue ||
        !validateProjectScheduledDate(scheduledValue).valid
      ) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: `Counted priority update has no valid scheduled date for line ${
            target.line + 1
          }`,
          content: text,
          changed: false,
        });
      }
      scheduledState = getCountedPropertyTargetState(
        text,
        target,
        scheduledProperty,
        options,
      );
      if (!scheduledState.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: scheduledState.error,
          content: text,
          changed: false,
        });
      }
    }
    targetStates.push({ target, state, scheduledState });
  }

  const projectTargets =
    propertyName === "scheduled" || isPriorityOperation
      ? targetStates.filter(
          (entry) =>
            (isPriorityOperation ? entry.scheduledState : entry.state).target
              .kind === "project-frontmatter",
        )
      : [];
  let nextContent = text;
  let taskLineDelta = 0;
  let propagatedScheduleTaskCount = 0;
  let removedProjectScheduleTaskCount = 0;
  let removedHideTaskCount = 0;
  let blockedTaskCount = 0;
  let ambiguousProjectTaskCount = 0;
  const recoveryCounts = emptyScheduledRecoveryCounts();
  let projectPropertyChanged = false;
  let projectScheduledValue = "";
  // Original (pre-batch) line numbers, matching the convention `target.line`
  // and `recoveryByLine` already use throughout this function.
  const futureScheduledTaskLines = [];

  if (projectTargets.length > 0) {
    const firstProject = projectTargets[0];
    const projectState = isPriorityOperation
      ? firstProject.scheduledState
      : firstProject.state;
    const frontmatter = projectState.context.frontmatter;
    projectScheduledValue = isPriorityOperation
      ? normalizeBulletPropertyValue(
          scheduledValueByLine.get(firstProject.target.line),
        )
      : normalizedValue;
    if (operation === "set" || isPriorityOperation) {
      const projectPlan = planProjectScheduledUpdate(
        text,
        firstProject.target.line,
        projectScheduledValue,
        options.today || new Date(),
        options,
      );
      if (!projectPlan.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: projectPlan.error,
          content: text,
          changed: false,
        });
      }
      nextContent = projectPlan.content;
      taskLineDelta = projectPlan.cursorLine - firstProject.target.line;
      propagatedScheduleTaskCount = projectPlan.scheduledTaskCount;
      removedHideTaskCount = projectPlan.removedHideTaskCount;
      blockedTaskCount = projectPlan.blockedTaskCount;
      ambiguousProjectTaskCount = projectPlan.ambiguousTaskLines.length;
      recoveryCounts.ready += projectPlan.recoveredReadyTaskCount;
      recoveryCounts.next += projectPlan.recoveredNextTaskCount;
      recoveryCounts.inProgress +=
        projectPlan.recoveredInProgressTaskCount;
      recoveryCounts.stillBlocked += projectPlan.stillBlockedTaskCount;
      recoveryCounts.deferred += projectPlan.deferredRecoveryTaskCount;
      projectPropertyChanged =
        !frontmatter.scheduledDefined ||
        frontmatter.scheduledValue !== projectScheduledValue;
      futureScheduledTaskLines.push(...projectPlan.futureScheduledTaskLines);
    } else if (frontmatter.scheduledDefined) {
      const projectPlan = planProjectScheduledDelete(
        text,
        firstProject.target.line,
        options,
      );
      if (!projectPlan.valid) {
        return Object.freeze({
          valid: false,
          stale: false,
          error: projectPlan.error,
          content: text,
          changed: false,
        });
      }
      nextContent = projectPlan.content;
      taskLineDelta = projectPlan.cursorLine - firstProject.target.line;
      removedProjectScheduleTaskCount =
        projectPlan.removedScheduledTaskCount;
      recoveryCounts.ready += projectPlan.recoveredReadyTaskCount;
      recoveryCounts.next += projectPlan.recoveredNextTaskCount;
      recoveryCounts.inProgress +=
        projectPlan.recoveredInProgressTaskCount;
      recoveryCounts.stillBlocked += projectPlan.stillBlockedTaskCount;
      recoveryCounts.deferred += projectPlan.deferredRecoveryTaskCount;
      projectPropertyChanged = true;
    }
  }

  const source = splitMarkdownContent(nextContent);
  const changedTargets = [];
  const unchangedTargets = [];
  for (const { target, state, scheduledState } of targetStates) {
    const mappedLine = target.line + taskLineDelta;
    const liveLine = String(source.lines[mappedLine] || "");
    let nextLine = liveLine;
    let targetChanged = false;

    if (isPriorityOperation) {
      const priorityBaseLine = removeAllBulletProperties(
        liveLine,
        scheduledPropertyName,
      );
      const priorityResult = upsertBulletProperty(
        priorityBaseLine,
        propertyName,
        normalizedValue,
      );
      nextLine = priorityResult.line;
      targetChanged =
        priorityBaseLine !== liveLine || priorityResult.changed;
      const scheduledValue = normalizeBulletPropertyValue(
        scheduledValueByLine.get(target.line),
      );
      if (scheduledState.target.kind === "project-frontmatter") {
        nextLine = removeAllBulletProperties(
          nextLine,
          scheduledPropertyName,
        );
        targetChanged ||=
          projectPropertyChanged ||
          Boolean(
            findBulletPropertyField(target.rawLine, scheduledPropertyName),
          ) ||
          nextLine !== priorityResult.line;
      } else {
        const scheduledResult = upsertBulletProperty(
          nextLine,
          scheduledPropertyName,
          scheduledValue,
        );
        nextLine = scheduledResult.line;
        targetChanged ||= scheduledResult.changed;
        if (
          isFutureInlineScheduledValue(
            scheduledValue,
            options.today || new Date(),
          )
        ) {
          futureScheduledTaskLines.push(target.line);
          const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
          if (blockedLine !== nextLine) {
            nextLine = blockedLine;
            targetChanged = true;
            blockedTaskCount += 1;
          }
        } else if (
          isDueInlineScheduledValue(
            scheduledValue,
            options.today || new Date(),
          )
        ) {
          const recovery = reconcileBlockedScheduledTaskLine(
            nextLine,
            getTargetScheduledRecovery(options, target.line),
          );
          nextLine = recovery.line;
          targetChanged ||= recovery.changed;
          recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
        }
      }
    } else if (
      propertyName === "scheduled" &&
      state.target.kind === "project-frontmatter"
    ) {
      // Keep the existing ^prj rule strict even if several lifecycle task
      // sources were counted: scheduled is represented only in frontmatter.
      if (operation === "set" || state.defined) {
        nextLine = removeAllBulletProperties(liveLine, propertyName);
      }
      targetChanged =
        projectPropertyChanged ||
        Boolean(findBulletPropertyField(target.rawLine, propertyName)) ||
        nextLine !== liveLine;
    } else {
      const result =
        operation === "set" &&
        propertyName === "scheduled" &&
        projectTargets.length > 0
          ? upsertProjectTaskScheduledField(liveLine, normalizedValue)
          : operation === "delete"
            ? deleteBulletProperty(liveLine, propertyName)
            : upsertBulletProperty(liveLine, propertyName, normalizedValue);
      nextLine = result.line;
      targetChanged = result.changed;
      if (shouldBlockInlineTasks) {
        futureScheduledTaskLines.push(target.line);
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) {
          nextLine = blockedLine;
          targetChanged = true;
          blockedTaskCount += 1;
        }
      } else if (shouldRecoverInlineTasks) {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, target.line),
        );
        nextLine = recovery.line;
        targetChanged ||= recovery.changed;
        recordScheduledRecoveryOutcome(
          recoveryCounts,
          recovery.outcome,
        );
      }
    }

    source.lines[mappedLine] = nextLine;
    const detail = Object.freeze({
      line: mappedLine,
      originalLine: target.line,
      rawLine: target.rawLine,
      lineText: nextLine,
    });
    (targetChanged ? changedTargets : unchangedTargets).push(detail);
  }

  // One entry per changed target, using that target's own previous value
  // (captured above via getCountedPropertyTargetState) and its own rolled date.
  // A priority batch supplies reasonByLine because each task may have had a
  // different previous level; a scheduled batch supplies one shared reason.
  // Insertions apply in descending insertLine order so an earlier (smaller-index)
  // insert position is never invalidated by a later one.
  let scheduleLoggedTaskCount = 0;
  let scheduleLogCreatedParentCount = 0;
  let scheduleLogFallbackTaskCount = 0;
  const scheduleLogOptions =
    options.scheduleLog && (isPriorityOperation || (operation === "set" && propertyName === "scheduled"))
      ? options.scheduleLog
      : null;
  if (scheduleLogOptions) {
    const entryByOriginalLine = new Map(targetStates.map((entry) => [entry.target.line, entry]));
    const scheduleLogPlans = changedTargets
      .map((detail) => {
        const entry = entryByOriginalLine.get(detail.originalLine);
        const scheduledState = isPriorityOperation ? entry && entry.scheduledState : entry && entry.state;
        // Only the first ^prj target's roll reaches frontmatter, so every
        // project-frontmatter target logs the value that was actually written.
        const to = !isPriorityOperation
          ? normalizedValue
          : scheduledState && scheduledState.target.kind === "project-frontmatter"
            ? projectScheduledValue
            : normalizeBulletPropertyValue(scheduledValueByLine.get(detail.originalLine));
        const from = scheduledState ? scheduledState.value : "";
        const rawReason =
          scheduleLogOptions.reasonByLine instanceof Map && scheduleLogOptions.reasonByLine.has(detail.originalLine)
            ? scheduleLogOptions.reasonByLine.get(detail.originalLine)
            : scheduleLogOptions.reason;
        const normalizedReason = normalizeScheduleReasonText(rawReason);
        // planScheduleLogEntry decides per target whether an empty reason falls
        // back, since only it knows whether that task already keeps a log.
        if (normalizedReason.empty && normalizeScheduleReasonText(scheduleLogOptions.fallbackReason).empty) {
          return null;
        }
        if (scheduleLogOptions.automatic && !shouldWriteAutomaticScheduleLog(from, to)) {
          return null;
        }
        return planScheduleLogEntry(source.lines.join(source.lineEnding), detail.line, {
          from,
          to,
          reason: normalizedReason.reason,
          fallbackReason: scheduleLogOptions.fallbackReason,
        });
      })
      .filter((scheduleLogPlan) => scheduleLogPlan && scheduleLogPlan.valid)
      .sort((first, second) => second.insertLine - first.insertLine);
    for (const scheduleLogPlan of scheduleLogPlans) {
      if (applyScheduleLogEntryToLines(source.lines, scheduleLogPlan) > 0) {
        scheduleLoggedTaskCount += 1;
        if (scheduleLogPlan.createdParent) {
          scheduleLogCreatedParentCount += 1;
        }
        if (scheduleLogPlan.usedFallback) {
          scheduleLogFallbackTaskCount += 1;
        }
      }
    }
  }

  nextContent = source.lines.join(source.lineEnding);
  const cursorLine = session.targets[0].line + taskLineDelta;
  return Object.freeze({
    valid: true,
    stale: false,
    error: null,
    operation,
    propertyName,
    value: normalizedValue,
    scheduledPropertyName,
    content: nextContent,
    changed: nextContent !== text,
    changedTaskCount: changedTargets.length,
    unchangedTaskCount: unchangedTargets.length,
    targetCount: session.targets.length,
    changedTargets: Object.freeze(changedTargets),
    unchangedTargets: Object.freeze(unchangedTargets),
    cursorLine,
    cursorLineDelta: taskLineDelta,
    propagatedScheduleTaskCount,
    removedProjectScheduleTaskCount,
    removedHideTaskCount,
    ambiguousProjectTaskCount,
    blockedTaskCount,
    scheduleLoggedTaskCount,
    scheduleLogCreatedParentCount,
    scheduleLogFallbackTaskCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
  });
}

// Converge one selected dependency across every counted source task. All
// source fields, target identity normalization, and per-parent navigation
// bullets are built in memory so the runtime path can apply exactly one write.
function planCountedLocalTaskDependency(
  content,
  session,
  dependencyTask,
  filePath,
  options = {},
) {
  const text = String(content || "");
  const sessionValidation = validateCountedTaskSession(text, session);
  if (!sessionValidation.valid) {
    return Object.freeze({
      valid: false,
      stale: true,
      error: sessionValidation.error,
      content: text,
      changed: false,
    });
  }

  const dependencyLine = dependencyTask && dependencyTask.line;
  const sourceLines = new Set(session.targets.map((target) => target.line));
  const currentDependencyLine = Number.isInteger(dependencyLine)
    ? splitMarkdownContent(text).lines[dependencyLine]
    : undefined;
  if (
    !dependencyTask ||
    sourceLines.has(dependencyLine) ||
    currentDependencyLine !== dependencyTask.rawLine ||
    !isObsidianTaskAtLine(text, dependencyLine)
  ) {
    return Object.freeze({
      valid: false,
      stale: true,
      error: "The selected dependency changed while the picker was open",
      content: text,
      changed: false,
    });
  }

  const confirmedBlockId = normalizeBulletPropertyValue(
    options.confirmedBlockId,
  );
  let dependencyLineText = currentDependencyLine;
  let resolved = resolveTargetTaskIdentity(dependencyLineText, {
    promptWhenBlockIdMissing: true,
    filePath,
  });
  if (resolved.needsBlockIdPrompt) {
    if (!confirmedBlockId) {
      return Object.freeze({
        valid: false,
        stale: false,
        needsBlockIdPrompt: true,
        error: "The selected dependency needs a block ID",
        content: text,
        changed: false,
      });
    }
    const blockIdValidation = validateBlockIdCandidate(
      confirmedBlockId,
      text,
    );
    if (!blockIdValidation.valid) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: blockIdValidation.message,
        content: text,
        changed: false,
      });
    }
    dependencyLineText = applyPromptedBlockIdToTaskLine(
      dependencyLineText,
      confirmedBlockId,
      filePath,
    );
    if (dependencyLineText === null) {
      return Object.freeze({
        valid: false,
        stale: false,
        error: "This note path cannot be encoded as a dependency ID",
        content: text,
        changed: false,
      });
    }
    resolved = Object.freeze({
      value: tryDependencyId(filePath, confirmedBlockId),
      linkBlockId: confirmedBlockId,
      legacyValue:
        normalizeBulletPropertyValue(dependencyTask.existingIdField) || null,
      needsBlockIdPrompt: false,
      targetEdits: Object.freeze([]),
    });
  } else if (resolved.targetEdits.length > 0) {
    dependencyLineText =
      resolved.targetEdits[resolved.targetEdits.length - 1].line;
  }

  if (!resolved.value || !resolved.linkBlockId) {
    return Object.freeze({
      valid: false,
      stale: false,
      error: "Could not identify the selected dependency",
      content: text,
      changed: false,
    });
  }

  const dependencyAliases = new Set(
    [
      resolved.value,
      resolved.legacyValue,
      dependencyTask.existingIdField,
      dependencyTask.existingBlockId,
    ]
      .map(normalizeBulletPropertyValue)
      .filter(Boolean),
  );
  const linkedBefore = session.targets.map((target) => {
    const field = findBulletPropertyField(target.rawLine, "dependsOn");
    const values = new Set(
      field ? parseLocalTaskIdList(field.value) : [],
    );
    return Array.from(dependencyAliases).some((alias) => values.has(alias));
  });
  const remove = linkedBefore.every(Boolean);

  let nextSource = splitMarkdownContent(text);
  nextSource.lines[dependencyLine] = dependencyLineText;
  let nextContent = nextSource.lines.join(nextSource.lineEnding);
  if (resolved.legacyValue && resolved.legacyValue !== resolved.value) {
    nextContent = rewriteDependsOnIdsInContent(
      nextContent,
      new Map([[resolved.legacyValue, resolved.value]]),
    ).content;
  }

  nextSource = splitMarkdownContent(nextContent);
  const sourceResults = [];
  session.targets.forEach((target) => {
    const currentLine = String(nextSource.lines[target.line] || "");
    const result = applyLocalTaskDependencyListEdits(
      currentLine,
      "dependsOn",
      remove
        ? { remove: Array.from(dependencyAliases) }
        : {
            add: [resolved.value],
            remove: Array.from(dependencyAliases).filter(
              (alias) => alias !== resolved.value,
            ),
          },
    );
    nextSource.lines[target.line] = result.line;
    sourceResults.push({
      target,
      dependencyChanged: result.changed || currentLine !== target.rawLine,
    });
  });
  nextContent = nextSource.lines.join(nextSource.lineEnding);

  // Process parents bottom-to-top. Navigation edits only shift lines below the
  // current parent, so every still-pending source retains its snapshot index.
  const navigationTarget = Object.freeze({
    blockId: resolved.linkBlockId,
    note: "",
  });
  let navigationChangedCount = 0;
  const orderedSourceResults = sourceResults
    .slice()
    .sort((first, second) => second.target.line - first.target.line);
  for (const entry of orderedSourceResults) {
    const collection = collectDependencyNavigationBullets(
      nextContent,
      entry.target.line,
      [navigationTarget],
    );
    const finalTargets = computeFinalDependencyLinkOrder(
      collection.targets,
      remove ? [] : [navigationTarget],
      remove ? [navigationTarget] : [],
    );
    const navigationPlan = planDependencyNavigationBulletSync(
      nextContent,
      entry.target.line,
      finalTargets,
      { managedBlockIds: [navigationTarget] },
    );
    if (navigationPlan.operation === "guard") {
      return Object.freeze({
        valid: false,
        stale: false,
        error: "Could not plan dependency navigation for every source task",
        content: text,
        changed: false,
      });
    }
    if (navigationPlan.changed) {
      const current = splitMarkdownContent(nextContent);
      current.lines = applyDependencyNavigationPlanToLines(
        current.lines,
        navigationPlan,
      );
      nextContent = current.lines.join(current.lineEnding);
      entry.navigationChanged = true;
      navigationChangedCount += 1;
    }
  }

  const changedTaskCount = sourceResults.filter(
    (entry) => entry.dependencyChanged || entry.navigationChanged,
  ).length;
  return Object.freeze({
    valid: true,
    stale: false,
    needsBlockIdPrompt: false,
    error: null,
    content: nextContent,
    changed: nextContent !== text,
    operation: remove ? "remove" : "add",
    dependencyValue: resolved.value,
    linkBlockId: resolved.linkBlockId,
    targetIdentityChanged: dependencyLineText !== currentDependencyLine,
    changedTaskCount,
    unchangedTaskCount: session.targets.length - changedTaskCount,
    targetCount: session.targets.length,
    navigationChangedCount,
    cursorLine: session.targets[0].line,
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

function getLocalDayOffset(baseDate, targetDate) {
  const baseTime = getLocalDateStart(baseDate).getTime();
  const targetTime = getLocalDateStart(targetDate).getTime();
  return Math.round((targetTime - baseTime) / 86_400_000);
}

function formatRelativeDayOffset(offset) {
  const days = Number(offset);
  if (!Number.isFinite(days)) {
    return "";
  }
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days === -1) {
    return "yesterday";
  }
  if (days > 1) {
    return `in ${days} days`;
  }
  return `${Math.abs(days)} days ago`;
}

function formatRelativeDayRange(minOffset, maxOffset) {
  const min = Number(minOffset);
  const max = Number(maxOffset);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "";
  }
  if (min === max) {
    return formatRelativeDayOffset(min);
  }
  if (min >= 1) {
    return `in ${min}–${max} days`;
  }
  return `${formatRelativeDayOffset(min)} to ${formatRelativeDayOffset(max)}`;
}

function rollPriorityScheduledDateWithOffset(
  level,
  baseDate,
  random = Math.random,
) {
  const span = level.maxDays - level.minDays + 1;
  const rolledOffset = Math.floor(random() * span);
  const offset =
    level.minDays + clampNumber(rolledOffset, 0, Math.max(0, span - 1));
  return Object.freeze({
    date: addLocalDateDays(getLocalDateStart(baseDate), offset),
    offset,
  });
}

function rollPriorityScheduledDate(level, baseDate, random = Math.random) {
  return rollPriorityScheduledDateWithOffset(level, baseDate, random).date;
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

function createPriorityRollDateItem(
  level,
  baseDate,
  currentValue,
  random = Math.random,
) {
  const roll = rollPriorityScheduledDateWithOffset(level, baseDate, random);
  const date = roll.date;
  const value = formatBulletPropertyDate(date);
  const weekday = getBulletPropertyDateWeekday(date);
  return {
    kind: "value",
    value,
    label: `${level.label} roll`,
    detail: `${value} · ${weekday} · ${formatPriorityRollWindowText(level)}`,
    current: value === currentValue,
    dynamic: false,
    priorityRoll: true,
    level,
    rolledDays: roll.offset,
    searchText: `${level.label} roll ${value} ${weekday} random priority`,
  };
}

function getPriorityLevelIconName(levelIndex) {
  if (levelIndex === 0) {
    return "signal-high";
  }
  if (levelIndex === 1) {
    return "signal-medium";
  }
  if (levelIndex === 2) {
    return "signal-low";
  }
  return "signal-zero";
}

function normalizePriorityLevelIndex(property, level, levelIndex) {
  if (Number.isInteger(levelIndex) && levelIndex >= 0) {
    return levelIndex;
  }
  const levels = property && Array.isArray(property.levels)
    ? property.levels
    : [];
  const directIndex = levels.indexOf(level);
  if (directIndex >= 0) {
    return directIndex;
  }
  const levelLabel = level && normalizeBulletPropertyValue(level.label);
  const levelValue = level && normalizeBulletPropertyValue(level.value);
  const matchingIndex = levels.findIndex(
    (candidate) =>
      normalizeBulletPropertyValue(candidate && candidate.label) === levelLabel &&
      normalizeBulletPropertyValue(candidate && candidate.value) === levelValue,
  );
  return matchingIndex >= 0 ? matchingIndex : 0;
}

function parsePriorityNoticeScheduledValue(value) {
  const text = normalizeBulletPropertyValue(value);
  const validation = validateProjectScheduledDate(text);
  if (!validation.valid) {
    return Object.freeze({
      text: text || validation.value,
      valid: false,
      date: null,
      time: null,
      weekday: "",
    });
  }
  const date = projectScheduleLocalDate(validation);
  return Object.freeze({
    text: validation.value,
    valid: true,
    date,
    time: getLocalDateStart(date).getTime(),
    weekday: getBulletPropertyDateWeekday(date),
  });
}

function getPriorityNoticeScheduleSummary(values, baseDate) {
  const entries = (Array.isArray(values) ? values : [values])
    .map(parsePriorityNoticeScheduledValue)
    .filter((entry) => entry.text);
  if (entries.length === 0) {
    return Object.freeze({
      exactDateText: "",
      dateStartText: "",
      dateEndText: "",
      weekdayText: "",
      relativeText: "",
      textDateText: "",
      dateText: "",
    });
  }
  const validEntries = entries.filter((entry) => entry.valid);
  if (validEntries.length !== entries.length) {
    if (entries.length === 1) {
      return Object.freeze({
        exactDateText: entries[0].text,
        dateStartText: entries[0].text,
        dateEndText: "",
        weekdayText: "",
        relativeText: "",
        textDateText: entries[0].text,
        dateText: entries[0].text,
      });
    }
    const firstText = entries[0].text;
    const lastText = entries[entries.length - 1].text;
    const textDateText = `${firstText} to ${lastText}`;
    return Object.freeze({
      exactDateText: `${firstText} → ${lastText}`,
      dateStartText: firstText,
      dateEndText: lastText,
      weekdayText: "",
      relativeText: "",
      textDateText,
      dateText: textDateText,
    });
  }

  const sortedEntries = validEntries
    .slice()
    .sort((first, second) => first.time - second.time);
  const first = sortedEntries[0];
  const last = sortedEntries[sortedEntries.length - 1];
  if (first.time === last.time) {
    const textDateText = `${first.text} · ${first.weekday}`;
    return Object.freeze({
      exactDateText: first.text,
      dateStartText: first.text,
      dateEndText: "",
      weekdayText: first.weekday,
      relativeText: formatRelativeDayOffset(
        getLocalDayOffset(baseDate, first.date),
      ),
      textDateText,
      dateText: textDateText,
    });
  }

  const minOffset = getLocalDayOffset(baseDate, first.date);
  const maxOffset = getLocalDayOffset(baseDate, last.date);
  const textDateText = `${first.text} to ${last.text}`;
  return Object.freeze({
    exactDateText: `${first.text} → ${last.text}`,
    dateStartText: first.text,
    dateEndText: last.text,
    weekdayText: "",
    relativeText: formatRelativeDayRange(minOffset, maxOffset),
    textDateText,
    dateText: textDateText,
  });
}

function normalizePriorityNoticeCount(value) {
  return Math.max(0, Math.floor(numericOrDefault(value, 0)));
}

function getPriorityNoticeRecoveryCounts(outcome = {}) {
  const recoveryCounts = outcome.recoveryCounts || {};
  return Object.freeze({
    ready: normalizePriorityNoticeCount(
      recoveryCounts.ready ?? outcome.recoveredReadyTaskCount,
    ),
    next: normalizePriorityNoticeCount(
      recoveryCounts.next ?? outcome.recoveredNextTaskCount,
    ),
    inProgress: normalizePriorityNoticeCount(
      recoveryCounts.inProgress ?? outcome.recoveredInProgressTaskCount,
    ),
    stillBlocked: normalizePriorityNoticeCount(
      recoveryCounts.stillBlocked ?? outcome.stillBlockedTaskCount,
    ),
    deferred: normalizePriorityNoticeCount(
      recoveryCounts.deferred ?? outcome.deferredRecoveryTaskCount,
    ),
  });
}

function getPriorityNoticeBlockedText(count, scope) {
  if (count <= 0) {
    return "";
  }
  if (scope === "task") {
    return "marked task Blocked";
  }
  return `marked ${formatCountLabel(count, "task")} Blocked`;
}

function getPriorityNoticeOutcomeParts(outcome = {}, scope = "task") {
  const parts = [];
  if (scope === "counted") {
    parts.push(
      ...getCountedTaskNoticeParts(
        outcome.session,
        normalizePriorityNoticeCount(outcome.unchangedTaskCount),
      ),
    );
  }
  const propagatedScheduleTaskCount = normalizePriorityNoticeCount(
    outcome.propagatedScheduleTaskCount ?? outcome.scheduledTaskCount,
  );
  if (propagatedScheduleTaskCount > 0) {
    parts.push(
      `scheduled ${formatCountLabel(propagatedScheduleTaskCount, "task")}`,
    );
  }
  const removedHideTaskCount = normalizePriorityNoticeCount(
    outcome.removedHideTaskCount,
  );
  if (removedHideTaskCount > 0) {
    parts.push(
      `removed #hide from ${formatCountLabel(removedHideTaskCount, "task")}`,
    );
  }
  const scheduleLoggedTaskCount = normalizePriorityNoticeCount(outcome.scheduleLoggedTaskCount);
  if (scheduleLoggedTaskCount > 0) {
    parts.push(
      scope === "counted" ? `logged reason on ${formatCountLabel(scheduleLoggedTaskCount, "task")}` : "logged reason",
    );
  }
  const blockedText = getPriorityNoticeBlockedText(
    normalizePriorityNoticeCount(outcome.blockedTaskCount),
    scope,
  );
  if (blockedText) {
    parts.push(blockedText);
  }
  const ambiguousTaskCount = normalizePriorityNoticeCount(
    outcome.ambiguousTaskCount ?? outcome.ambiguousProjectTaskCount,
  );
  if (ambiguousTaskCount > 0) {
    parts.push(
      `${formatCountLabel(ambiguousTaskCount, "task")} with multiple scheduled fields unchanged`,
    );
  }
  parts.push(...scheduledRecoveryNoticeParts(getPriorityNoticeRecoveryCounts(outcome)));
  const removedPomodoroLinkCount = normalizePriorityNoticeCount(
    outcome.removedPomodoroLinkCount,
  );
  if (removedPomodoroLinkCount > 0) {
    parts.push(
      `removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`,
    );
  } else if (outcome.pomodoroPruneFailed) {
    parts.push("Pomodoro links not removed");
  }
  return Object.freeze(parts);
}

function getPriorityNoticeChipTone(text) {
  if (/^recovered /.test(text)) {
    return "ok";
  }
  if (/Blocked$/.test(text)) {
    return "warn";
  }
  if (text === "Pomodoro links not removed") {
    return "warn";
  }
  if (/^(scheduled|removed #hide|removed \d+ Pomodoro links?)/.test(text)) {
    return "info";
  }
  if (/^logged reason/.test(text)) {
    return "info";
  }
  return "muted";
}

function getPriorityNoticeChipText(text) {
  const markedMatch = /^marked (?:(\d+) tasks?|task) Blocked$/.exec(text);
  if (markedMatch) {
    return markedMatch[1] ? `${markedMatch[1]} Blocked` : "Blocked";
  }
  const loggedMatch = /^logged reason(?: on (\d+) tasks?)?$/.exec(text);
  if (loggedMatch) {
    return loggedMatch[1] ? `${loggedMatch[1]} logged` : "logged";
  }
  const pomodoroRemovedMatch = /^removed (\d+) Pomodoro links?$/.exec(text);
  if (pomodoroRemovedMatch) {
    return `${pomodoroRemovedMatch[1]} removed`;
  }
  if (text === "Pomodoro links not removed") {
    return "not removed";
  }
  return text;
}

function formatPriorityNoticeText(model) {
  const parts = [];
  if (model.textHeader) {
    parts.push(model.textHeader);
  }
  const dateText = model.textDateText || model.dateText || model.exactDateText;
  if (dateText) {
    const dateLabel = model.textDateLabel || model.dateLabel || "scheduled";
    const relativeText = model.relativeText ? ` · ${model.relativeText}` : "";
    parts.push(`${dateLabel} → ${dateText}${relativeText}`);
  }
  if (Array.isArray(model.outcomeTextParts)) {
    parts.push(...model.outcomeTextParts);
  }
  return parts.join("; ");
}

function buildPriorityNoticeModel(options = {}) {
  const property = options.property || {};
  const level = options.level || {};
  const scope = ["task", "counted", "project"].includes(options.scope)
    ? options.scope
    : "task";
  const propertyName = normalizeBulletPropertyName(property.name) || "priority";
  const scheduledName =
    normalizeBulletPropertyName(property.schedules) || "scheduled";
  const levelIndex = normalizePriorityLevelIndex(
    property,
    level,
    options.levelIndex,
  );
  const pill = normalizeBulletPropertyValue(level.label);
  const levelValue = normalizeBulletPropertyValue(level.value);
  const taskCount = Math.max(
    1,
    normalizePriorityNoticeCount(options.taskCount || 1),
  );
  const scheduleSummary = getPriorityNoticeScheduleSummary(
    options.scheduledValues || [],
    options.baseDate instanceof Date
      ? getLocalDateStart(options.baseDate)
      : getLocalDateStart(new Date()),
  );
  const outcomeTextParts = getPriorityNoticeOutcomeParts(
    options.outcome || {},
    scope,
  );
  const textHeader =
    scope === "counted"
      ? `${propertyName} → ${pill} (${levelValue}) on ${formatCountLabel(
          taskCount,
          "task",
        )}`
      : `${propertyName} → ${pill} (${levelValue})`;
  const model = {
    iconName: getPriorityLevelIconName(levelIndex),
    levelIndex,
    pill,
    countPill: scope === "counted" ? formatCountLabel(taskCount, "task") : "",
    receipt: `[${propertyName}:: ${levelValue}]`,
    dateLabel: scope === "project" ? `${scheduledName} (project)` : scheduledName,
    textDateLabel: scheduledName,
    exactDateText: scheduleSummary.exactDateText,
    dateStartText: scheduleSummary.dateStartText,
    dateEndText: scheduleSummary.dateEndText,
    weekdayText: scheduleSummary.weekdayText,
    textDateText: scheduleSummary.textDateText,
    dateText: scheduleSummary.dateText,
    relativeText: scheduleSummary.relativeText,
    chips: Object.freeze(
      outcomeTextParts.map((part) =>
        Object.freeze({
          text: getPriorityNoticeChipText(part),
          tone: getPriorityNoticeChipTone(part),
        }),
      ),
    ),
    outcomeTextParts,
    textHeader,
  };
  model.text = formatPriorityNoticeText(model);
  return Object.freeze(model);
}

function renderPriorityNoticeFragment(model, root) {
  const levelClass =
    Number.isInteger(model.levelIndex) &&
    model.levelIndex >= 0 &&
    model.levelIndex <= 3
      ? ` is-level-${model.levelIndex}`
      : "";
  const card = root.createDiv({
    cls: `bob-nh-notice${levelClass}`,
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  applyIcon(iconEl, model.iconName);
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: model.pill });
  if (model.countPill) {
    headerEl.createSpan({ cls: "bob-nh-notice-count", text: model.countPill });
  }
  headerEl.createSpan({ cls: "bob-nh-notice-receipt", text: model.receipt });

  const dateEl = card.createDiv({ cls: "bob-nh-notice-date" });
  const dateHeadingEl = dateEl.createDiv({
    cls: "bob-nh-notice-date-heading",
  });
  const dateIconEl = dateHeadingEl.createSpan({ cls: "bob-nh-notice-date-icon" });
  applyIcon(dateIconEl, "dices");
  dateHeadingEl.createSpan({
    cls: "bob-nh-notice-date-label",
    text: model.dateLabel,
  });
  if (model.relativeText) {
    dateHeadingEl.createSpan({
      cls: "bob-nh-notice-relative",
      text: model.relativeText,
    });
  }
  const receiptEl = dateEl.createDiv({
    cls: "bob-nh-notice-date-receipt",
  });
  receiptEl.createSpan({
    cls: "bob-nh-notice-date-iso",
    text: model.dateStartText || model.exactDateText || "",
  });
  if (model.dateEndText) {
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-arrow",
      text: "→",
      attr: { "aria-hidden": "true" },
    });
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-iso",
      text: model.dateEndText,
    });
  } else if (model.weekdayText) {
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-separator",
      text: "·",
      attr: { "aria-hidden": "true" },
    });
    receiptEl.createSpan({
      cls: "bob-nh-notice-date-weekday",
      text: model.weekdayText,
    });
  }

  if (model.chips.length > 0) {
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    model.chips.forEach((chip) => {
      chipsEl.createSpan({
        cls: `bob-nh-notice-chip is-${chip.tone}`,
        text: chip.text,
      });
    });
  }

  return card;
}

function showPriorityNotice(model, options = {}) {
  const fallbackText =
    model && typeof model.text === "string" ? model.text : String(model || "");
  try {
    if (typeof document === "undefined") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showBulletPropertyNotice(fallbackText, options);
      return;
    }
    renderPriorityNoticeFragment(model, fragment);
    showBulletPropertyNotice(fragment, options);
  } catch (error) {
    showBulletPropertyNotice(fallbackText, options);
  }
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

function getLocalTaskDependencyIdentifier(task, filePath = "") {
  if (!task) {
    return "";
  }
  if (task.existingBlockId && filePath) {
    return tryDependencyId(filePath, task.existingBlockId) || "";
  }
  return task.existingIdField || task.existingBlockId || "";
}

function createBulletPropertyLocalTaskItems(content, options = {}) {
  const dependencyValues =
    options.dependencyValues instanceof Set
      ? options.dependencyValues
      : new Set(options.dependencyValues || []);
  const dependencyValueSets = Array.isArray(options.dependencyValueSets)
    ? options.dependencyValueSets.map((values) =>
        values instanceof Set ? values : new Set(values || []),
      )
    : [dependencyValues];

  return getOpenLocalTasks(content, {
    excludeLine: options.excludeLine,
    excludeLines: options.excludeLines,
  }).map(
    (task) => {
      // The dependency value stored in `[dependsOn:: ...]` (prefers an existing
      // `[id::]`, then the trailing block ID). The link block ID is the trailing
      // `^block-id` the navigation bullet points at, which may be absent even
      // when a dependency value exists.
      const dependencyValue = getLocalTaskDependencyIdentifier(
        task,
        options.filePath || "",
      );
      const legacyDependencyValue = task.existingIdField || task.existingBlockId || "";
      const linkBlockId = task.existingBlockId || "";
      const linkedSourceCount = dependencyValue
        ? dependencyValueSets.filter(
            (values) =>
              values.has(dependencyValue) ||
              (legacyDependencyValue !== dependencyValue &&
                values.has(legacyDependencyValue)),
          ).length
        : 0;
      const linkState =
        linkedSourceCount === 0
          ? "none"
          : linkedSourceCount === dependencyValueSets.length
            ? "all"
            : "mixed";
      const alreadyLinked = linkState === "all";
      const needsBlockIdPrompt = !linkBlockId;
      const needsDependencyValue = !dependencyValue;
      const needsPromptForAdd = !alreadyLinked && needsBlockIdPrompt;

      return Object.freeze({
        kind: "local-task",
        ...task,
        value: dependencyValue,
        dependencyValue,
        legacyDependencyValue,
        linkBlockId,
        alreadyLinked,
        linkedSourceCount,
        sourceCount: dependencyValueSets.length,
        linkState,
        needsBlockIdPrompt,
        needsDependencyValue,
        needsPromptForAdd,
        searchText: [
          task.displayText,
          `line ${task.line + 1}`,
          task.status,
          dependencyValue,
          alreadyLinked ? "depends linked" : "",
          linkState === "mixed" ? "mixed partially linked" : "",
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

  if (status === "*") {
    return "next";
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

  if (property.values === "priority") {
    return property.levels.map((level) => ({
      kind: "value",
      value: level.value,
      label: level.label,
      detail: `${level.value} · in ${level.minDays}–${level.maxDays} days`,
      current: level.value === currentValue,
      dynamic: false,
      priorityLevel: level,
      searchText: `${level.label} ${level.value} ${level.minDays}–${level.maxDays} days`,
    }));
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
  constructor(app, plugin, editor, cursor, lineText, config, context = {}) {
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
    this.propertyContext = context.propertyContext || {};
    this.filePath = context.filePath || "";
    this.taskSession = context.taskSession || null;
    this.bulletSubtitle = truncateBulletPropertySubtitle(lineText);
    this.stage = "properties";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    this.markedLines = new Set();
    this.taskItemsByLine = new Map();
    this.priorityRandom =
      typeof context.random === "function" ? context.random : Math.random;
    this.fixedValueBaseDate =
      context.baseDate instanceof Date
        ? getLocalDateStart(context.baseDate)
        : null;
    // Batch block-ID prompting state; populated only while the modal is
    // collecting block IDs for a pending multi-task apply (see commit flow).
    this.pendingBatch = null;
    this.pendingCountedDependency = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
    this.pendingScheduleReason = null;
    this.valueBaseDate = this.fixedValueBaseDate || getLocalDateStart(new Date());
    this.showPropertyStage({ clearQuery: false });
  }

  isCountedSession() {
    return Boolean(
      this.taskSession &&
      this.taskSession.explicit &&
      Array.isArray(this.taskSession.targets) &&
      this.taskSession.targets.length > 0,
    );
  }

  getTaskSessionSubtitle() {
    if (!this.isCountedSession()) {
      return this.bulletSubtitle;
    }
    if (this.taskSession.clamped) {
      return `${formatCountLabel(
        this.taskSession.actualCount,
        "task",
      )} of ${this.taskSession.requestedCount} requested · end of note`;
    }
    return formatCountLabel(this.taskSession.actualCount, "task");
  }

  showPropertyStage(options = {}) {
    this.stage = "properties";
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    this.clearPendingBatch();
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    let items;
    if (this.isCountedSession()) {
      const aggregate = createCountedBulletPropertyItems(
        this.config,
        this.getEditorContent(),
        this.taskSession,
      );
      if (!aggregate.valid) {
        new Notice(aggregate.error);
        items = [];
      } else {
        items = aggregate.items;
      }
    } else {
      items = createBulletPropertyItems(
        this.config,
        this.lineText,
        this.propertyContext,
      );
    }
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
        return `${countText}${this.getTaskSessionSubtitle()}`;
      },
      filterItem: (item, query) =>
        fuzzyMatchesText(
          `${item.property.name} ${item.currentLabel || ""} ${
            item.currentValue || ""
          } ${
            item.currentLabels ? item.currentLabels.join(" ") : ""
          } ${
            item.currentValues ? item.currentValues.join(" ") : ""
          } ${item.valueState || ""}`,
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
    this.valueBaseDate =
      this.fixedValueBaseDate || getLocalDateStart(new Date());
    this.selectedIndex = 0;
    const property = propertyItem.property;
    if (property.values === "local_task_id") {
      const validation = this.isCountedSession()
        ? validateCountedTaskSession(
            this.getEditorContent(),
            this.taskSession,
          )
        : validateDependencyParentForEditor(
            this.editor,
            this.cursor,
            this.lineText,
          );
      if (!validation.valid) {
        new Notice(validation.message || validation.error);
        this.showPropertyStage({ clearQuery: false });
        return;
      }
      if (!tryDependencyId(this.filePath, "task")) {
        new Notice(
          "Dependencies are unavailable: this note path cannot be encoded as a dependency ID",
        );
        this.showPropertyStage({ clearQuery: false });
        return;
      }
      this.showLocalTaskValueStage(propertyItem);
      return;
    }
    this.clearLocalTaskMarks();

    const isDateProperty = property.values === "date";
    const isPriorityProperty = property.values === "priority";
    const items = createBulletPropertyValueItems(
      propertyItem,
      this.valueBaseDate,
    );
    const priorityRollLevel = this.getPriorityRollLevel(property);
    if (priorityRollLevel) {
      items.unshift(
        createPriorityRollDateItem(
          priorityRollLevel,
          this.valueBaseDate,
          propertyItem.currentValue || "",
          this.priorityRandom,
        ),
      );
    }
    this.applyOptions({
      items,
      title: property.name,
      headerIcon: isDateProperty
        ? "calendar-days"
        : isPriorityProperty
          ? "signal-high"
          : "list-checks",
      inputLabel: `Filter ${property.name} values`,
      placeholder: isDateProperty
        ? "Type date, +3d, or 6/24"
        : isPriorityProperty
          ? "Filter priorities"
          : "Filter values",
      resultsLabel: isPriorityProperty
        ? "priority levels"
        : `${property.name} values`,
      emptyText: "No matching values",
      footerHints: getBulletPropertyStageTwoHints(Boolean(priorityRollLevel)),
      getSubtitle: () => {
        const scope = this.isCountedSession()
          ? `${this.getTaskSessionSubtitle()} · `
          : "";
        if (propertyItem.valueState === "mixed") {
          return isPriorityProperty
            ? `${scope}Choose a level · rolls a scheduled date · current values mixed`
            : `${scope}Choose a value · current values mixed`;
        }
        const currentLabel = propertyItem.currentLabel || "";
        if (isPriorityProperty) {
          return currentLabel
            ? `${scope}Choose a level · rolls a scheduled date · current: ${currentLabel}`
            : `${scope}Choose a level · rolls a scheduled date`;
        }
        return currentLabel
          ? `${scope}Choose a value · current: ${currentLabel}`
          : `${scope}Choose a value`;
      },
      filterItem: (item, query) => fuzzyMatchesText(item.searchText, query),
      renderItem: (item, rowEl, query) =>
        this.renderValueItem(item, rowEl, query),
      openItem:
        normalizeBulletPropertyName(property.name) === "scheduled"
          ? (item) => {
              if (item.priorityRoll) {
                return this.applySelectedValue(item, {
                  scheduleLog: this.buildPriorityRollScheduleLogForItem(item),
                });
              }
              this.showScheduleReasonStage(item);
              return false;
            }
          : (item) => this.applySelectedValue(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  // The scheduled value a picked date replaces: frontmatter for a ^prj task,
  // the inline field otherwise. Empty in a counted session, where each target's
  // own previous value is resolved by the counted planner instead.
  getPendingScheduleFrom() {
    const propertyItem = this.selectedPropertyItem;
    if (!propertyItem || this.isCountedSession()) {
      return "";
    }

    return normalizeBulletPropertyValue(
      propertyItem.target && propertyItem.target.kind === "project-frontmatter"
        ? propertyItem.currentValue
        : this.getCurrentPropertyValue(propertyItem.property.name),
    );
  }

  // Whether pressing ↵ on an empty input still logs an entry: only when the
  // date actually moves and the task already keeps a log. A counted session
  // answers yes on behalf of the batch — each target is decided at write time.
  willLogWithoutReason() {
    const pending = this.pendingScheduleReason;
    if (!pending || !pending.to || pending.from === pending.to) {
      return false;
    }

    return (
      this.isCountedSession() ||
      Boolean(findScheduleLogParent(this.getEditorContent(), this.cursor.line))
    );
  }

  // The pinned priority-roll row is a date the plugin chose, so it never prompts:
  // it writes straight through with a deterministic reason. Null when the roll
  // landed on the date the task already has.
  buildPriorityRollScheduleLogForItem(item) {
    if (!item || !item.priorityRoll || !item.level) {
      return null;
    }

    return buildPriorityRollScheduleLog({
      source: "scheduled",
      level: item.level,
      rolledDays: item.rolledDays,
      from: this.getPendingScheduleFrom(),
      to: item.value,
    });
  }

  // Free-text prompt shown after a `scheduled` date is chosen, mirroring the
  // block-ID stage: nothing is written until this prompt is confirmed (Enter,
  // empty or not) or the modal is dismissed (Esc, a clean cancel of the date
  // too — see onClose's contract).
  showScheduleReasonStage(dateItem) {
    this.stage = "reason";
    this.pendingScheduleReason = Object.freeze({
      dateItem,
      from: this.getPendingScheduleFrom(),
      to: dateItem.value,
    });
    this.clearLocalTaskMarks();
    this.selectedIndex = 0;
    this.applyOptions({
      items: [],
      title: "Reason",
      headerIcon: "message-square-quote",
      inputLabel: "Schedule reason",
      placeholder: "Why this date? (↵ to skip)",
      resultsLabel: "Schedule reason preview",
      emptyText: "Type a reason",
      footerHints: getBulletPropertyScheduleReasonHints({
        empty: true,
        fallback: this.willLogWithoutReason(),
      }),
      getSubtitle: () => this.getScheduleReasonSubtitle(),
      filterItem: () => true,
      renderItem: (item, rowEl, query) =>
        this.renderScheduleReasonPreviewItem(item, rowEl, query),
      openItem: (item) => this.confirmScheduleReason(item),
    });

    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
  }

  getScheduleReasonSubtitle() {
    const pending = this.pendingScheduleReason;
    if (!pending) {
      return "";
    }

    const transitionText = pending.from
      ? `${pending.from}${SCHEDULE_LOG_TRANSITION}${pending.to}`
      : pending.to;
    const parts = [transitionText];
    const validation = validateProjectScheduledDate(pending.to);
    if (validation.valid) {
      const date = projectScheduleLocalDate(validation);
      parts.push(getBulletPropertyDateWeekday(date));
      parts.push(
        formatRelativeDayOffset(getLocalDayOffset(this.valueBaseDate, date)),
      );
    }
    parts.push("nothing written yet");
    return parts.filter(Boolean).join(" · ");
  }

  renderScheduleReasonPreviewItem(item, rowEl, query) {
    const state = item.empty ? (item.fallback ? "fallback" : "empty") : item.hasInlineField ? "warning" : "valid";
    addElementClasses(rowEl, "bob-cnp-schedule-reason-row", `is-${state}`);

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(
      rowIcon,
      item.empty
        ? "minus-circle"
        : item.hasInlineField
          ? "alert-triangle"
          : "check-circle-2",
    );

    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    const pending = this.pendingScheduleReason;

    if (item.empty && !item.fallback) {
      appendHighlighted(titleEl, "No reason", query);
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: `scheduled → ${
          pending ? pending.to : ""
        } only; no schedule log entry`,
      });
      return;
    }

    appendHighlighted(
      titleEl,
      formatScheduleLogEntryText({
        from: pending ? pending.from : "",
        to: pending ? pending.to : "",
        reason: item.empty ? SCHEDULE_LOG_SKIPPED_REASON_TEXT : item.reason,
      }),
      query,
    );

    if (item.hasInlineField) {
      textEl.createDiv({
        cls: "bob-cnp-row-meta",
        text: '"::" creates a Dataview inline field on this bullet',
      });
    }

    textEl.createDiv({
      cls: "bob-cnp-schedule-reason-preview",
      text: item.counted
        ? item.empty
          ? `Appends to every counted task that already has a ${SCHEDULE_LOG_MARKER_TEXT}`
          : `Appends to every counted task, adding a ${SCHEDULE_LOG_MARKER_TEXT} where missing`
        : item.parentExists
          ? `Appends to the existing ${SCHEDULE_LOG_MARKER_TEXT} on this task`
          : `Adds a ${SCHEDULE_LOG_MARKER_TEXT} child bullet to this task`,
    });
  }

  confirmScheduleReason(item) {
    const pending = this.pendingScheduleReason;
    if (!pending || !item) {
      return false;
    }

    // The payload is supplied even for an empty input: a task that already keeps
    // a log records the change anyway, and planScheduleLogEntry is what decides
    // that per task (per target, in a counted session).
    return this.applySelectedValue(pending.dateItem, {
      scheduleLog: {
        from: pending.from,
        to: pending.to,
        reason: item.empty ? "" : item.reason,
        fallbackReason: SCHEDULE_LOG_SKIPPED_REASON_TEXT,
      },
    });
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

  getPriorityRollLevel(dateProperty) {
    if (!dateProperty || dateProperty.values !== "date") {
      return null;
    }

    const priorityProperty = this.config.properties.find(
      (property) =>
        property.values === "priority" &&
        property.schedules === dateProperty.name,
    );
    if (!priorityProperty) {
      return null;
    }

    let currentValue;
    if (this.isCountedSession()) {
      const aggregate = createCountedBulletPropertyItems(
        this.config,
        this.getEditorContent(),
        this.taskSession,
      );
      if (!aggregate.valid) {
        return null;
      }
      const priorityItem = aggregate.items.find(
        (item) => item.property === priorityProperty,
      );
      if (!priorityItem || priorityItem.valueState !== "common") {
        return null;
      }
      currentValue = priorityItem.currentValue;
    } else {
      currentValue = this.getCurrentPropertyValue(priorityProperty.name);
    }

    return priorityProperty.levelsByValue.get(currentValue) || null;
  }

  rerollPriorityDateSuggestion() {
    const rollIndex = this.items.findIndex((item) => item.priorityRoll);
    if (rollIndex === -1) {
      return false;
    }

    const previous = this.items[rollIndex];
    const nextItems = [...this.items];
    nextItems[rollIndex] = createPriorityRollDateItem(
      previous.level,
      this.valueBaseDate,
      this.selectedPropertyItem.currentValue || "",
      this.priorityRandom,
    );
    this.applyOptions({ items: nextItems });
    this.selectedIndex = rollIndex;
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    return true;
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
    this.pendingCountedDependency = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
    this.pendingScheduleReason = null;
  }

  // Dismissing the modal mid-prompt is a clean cancel: no writes happen until
  // the final block ID is confirmed, so just drop the pending batch state.
  onClose() {
    if (this.plugin && this.plugin.activeBulletPropertyPicker === this) {
      this.plugin.activeBulletPropertyPicker = null;
    }
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
    if (this.isCountedSession()) {
      return BULLET_PROPERTY_LOCAL_TASK_HINTS.filter(
        (hint) => !hint.keys.includes("⇥"),
      );
    }
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
      return this.isCountedSession()
        ? `${countText}${this.getTaskSessionSubtitle()} · choose a dependency`
        : `${countText}Choose a task dependency · ⇥ to mark several`;
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
    const dependencyValueSets = this.isCountedSession()
      ? propertyItem.sourceStates.map(
          (state) => new Set(parseLocalTaskIdList(state.value)),
        )
      : [
          new Set(
            parseLocalTaskIdList(this.getCurrentPropertyValue(property.name)),
          ),
        ];
    const items = createBulletPropertyLocalTaskItems(this.getEditorContent(), {
      excludeLine: this.isCountedSession() ? null : this.cursor.line,
      excludeLines: this.isCountedSession()
        ? new Set(this.taskSession.targets.map((target) => target.line))
        : new Set(),
      dependencyValues: dependencyValueSets[0],
      dependencyValueSets,
      filePath: this.filePath,
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
    this.blockIdMode = ["batch", "counted-source"].includes(options.mode)
      ? options.mode
      : "single";
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
    // Prefill with the existing `[id::]` value when present (confirmation
    // replaces it with the canonical path-qualified ID); otherwise suggest a slug that avoids existing and
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
        counted: this.blockIdMode === "counted-source",
      }),
      getSubtitle: () =>
        this.blockIdMode === "batch"
          ? `Block ID ${this.blockIdContext.position} of ${this.blockIdContext.total} · line ${task.line + 1}`
          : this.blockIdMode === "counted-source"
            ? `${this.getTaskSessionSubtitle()} · create an ID for dependency on line ${task.line + 1}`
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
    if (this.stage === "reason") {
      const normalized = normalizeScheduleReasonText(this.getRawQuery());
      const parentExists = Boolean(
        findScheduleLogParent(this.getEditorContent(), this.cursor.line),
      );
      return [
        Object.freeze({
          kind: "schedule-reason-preview",
          ...normalized,
          parentExists,
          counted: this.isCountedSession(),
          fallback: normalized.empty && this.willLogWithoutReason(),
          searchText: normalized.reason,
        }),
      ];
    }

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

  // The base class's input listener only calls renderResults(), so this is
  // what flips the reason-stage footer hint (Skip reason ⇄ Log reason) live
  // as the user types, mirroring refreshLocalTaskFooter.
  renderResults() {
    super.renderResults();
    if (this.stage === "reason") {
      const item = (this.visibleItems || [])[0];
      this.footerHints = getBulletPropertyScheduleReasonHints({
        empty: Boolean(item && item.empty),
        fallback: Boolean(item && item.fallback),
      });
      this.renderFooter();
    }
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
    const propertyStateText = item.mixed
      ? `Mixed across ${item.definedCount} of ${item.targetCount} tasks`
      : item.defined
        ? `Current value: ${item.currentLabel}`
        : "Not set";
    pathEl.setText(propertyStateText);

    if (item.mixed) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: "mixed",
      });
    } else if (item.defined) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: `${item.property.name} · ${item.currentLabel}`,
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
      item.priorityLevel ? "bob-cnp-priority-value-row" : "",
      item.priorityRoll ? "is-priority-roll" : "",
      item.current ? "is-current" : "",
      item.dynamic ? "is-dynamic" : "",
    );

    const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(
      rowIcon,
      item.priorityRoll
        ? "dices"
        : item.current
          ? "check-circle-2"
          : item.dynamic
            ? "calendar-plus"
            : "circle",
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
    if (item.priorityLevel) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: `${item.priorityLevel.minDays}–${item.priorityLevel.maxDays}d`,
      });
    }
    if (item.priorityRoll) {
      rowEl.createDiv({
        cls: "bob-cnp-pill bob-cnp-property-pill",
        text: item.level.label,
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
      item.linkState === "mixed" ? "is-mixed" : "",
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
    } else if (item.linkState === "mixed") {
      badgeEl.createSpan({
        cls: "bob-cnp-task-badge-action",
        text: `${item.linkedSourceCount}/${item.sourceCount} depend`,
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
    // Confirmation appends the trailing `^id` block target and replaces an
    // existing dependency value with the canonical path-qualified ID.
    const previewText = existingIdField
      ? `Appends ^${idDisplay}; replaces [id:: ${existingIdField}] with the canonical ID on: ${taskTitle}`
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

    if (this.isCountedSession()) {
      return this.chooseCountedTaskDependency(item);
    }

    if (this.getMarkedCount() > 0) {
      return this.commitMarkedDependencies();
    }

    if (!item) {
      return false;
    }

    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }

    // Single-select path. Re-read the target so a stale row never writes.
    const targetLine = getEditorLine(this.editor, item.line);
    if (targetLine !== item.rawLine) {
      new Notice("Task changed; dependency not added");
      return false;
    }
    if (!isObsidianTaskAtLine(this.getEditorContent(), item.line)) {
      new Notice("Selected dependency is no longer a #task checkbox");
      return false;
    }

    // A missing trailing block ID always prompts, even when an `[id:: value]`
    // is already present; confirmation replaces it with the canonical ID.
    const resolved = resolveTargetTaskIdentity(targetLine, {
      promptWhenBlockIdMissing: true,
      filePath: this.filePath,
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

    if (resolved.legacyValue && resolved.legacyValue !== resolved.value) {
      const currentContent = this.getEditorContent();
      const rewrite = rewriteDependsOnIdsInContent(
        currentContent,
        new Map([[resolved.legacyValue, resolved.value]]),
      );
      if (rewrite.changed && !replaceEditorContent(this.editor, currentContent, rewrite.content)) {
        new Notice("Could not normalize existing dependency references");
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

  chooseCountedTaskDependency(item) {
    if (!item) {
      return false;
    }
    const sessionValidation = validateCountedTaskSession(
      this.getEditorContent(),
      this.taskSession,
    );
    if (!sessionValidation.valid) {
      new Notice(`${sessionValidation.error}; no tasks were updated`);
      return false;
    }
    const targetLine = getEditorLine(this.editor, item.line);
    if (
      targetLine !== item.rawLine ||
      !isObsidianTaskAtLine(this.getEditorContent(), item.line)
    ) {
      new Notice("Selected dependency changed; no tasks were updated");
      return false;
    }

    const resolved = resolveTargetTaskIdentity(targetLine, {
      promptWhenBlockIdMissing: true,
      filePath: this.filePath,
    });
    if (resolved.needsBlockIdPrompt) {
      this.pendingCountedDependency = item;
      this.showBlockIdStage(item, { mode: "counted-source" });
      return false;
    }

    return this.plugin.applyCountedLocalTaskDependency(
      this.editor,
      this.cursor,
      this.filePath,
      this.taskSession,
      item,
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
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const cursorLineText = parentValidation.line;

    const removals = [];
    const readyAdditions = [];
    const promptQueue = [];

    this.getMarkedTaskItems().forEach((item) => {
      if (item.alreadyLinked) {
        // alreadyLinked implies a non-empty dependency value.
        removals.push({
          depValue: item.value,
          legacyDepValue: item.legacyDependencyValue || null,
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

    if (
      this.blockIdMode === "counted-source" &&
      this.pendingCountedDependency
    ) {
      return this.confirmCountedDependencyBlockId(item);
    }

    return this.confirmSingleBlockId(item);
  }

  confirmCountedDependencyBlockId(item) {
    const dependencyTask = this.pendingCountedDependency;
    if (!dependencyTask || !item.valid) {
      return false;
    }
    const applied = this.plugin.applyCountedLocalTaskDependency(
      this.editor,
      this.cursor,
      this.filePath,
      this.taskSession,
      dependencyTask,
      { confirmedBlockId: item.id },
    );
    if (applied) {
      this.clearPendingBatch();
    }
    return applied;
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
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const task = this.pendingTask;
    const targetLine = getEditorLine(this.editor, task.line);
    if (targetLine !== task.rawLine) {
      new Notice("Task changed; dependency not added");
      return false;
    }
    if (!isObsidianTaskAtLine(this.getEditorContent(), task.line)) {
      new Notice("Selected dependency is no longer a #task checkbox");
      return false;
    }

    const depValue = tryDependencyId(this.filePath, item.id);
    if (!depValue) {
      new Notice(
        "Dependency not added: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }

    const updatedLine = applyPromptedBlockIdToTaskLine(
      targetLine,
      item.id,
      this.filePath,
    );
    if (updatedLine === null) {
      return false;
    }
    if (!replaceEditorLine(this.editor, task.line, targetLine, updatedLine)) {
      new Notice("Could not update target task");
      return false;
    }

    // Replace an existing `[id:: value]` with the canonical dependency value.
    const existingId = findBulletPropertyField(targetLine, "id");
    const legacyId = existingId && normalizeBulletPropertyValue(existingId.value);
    if (legacyId && legacyId !== depValue) {
      const currentContent = this.getEditorContent();
      const rewrite = rewriteDependsOnIdsInContent(
        currentContent,
        new Map([[legacyId, depValue]]),
      );
      if (rewrite.changed && !replaceEditorContent(this.editor, currentContent, rewrite.content)) {
        new Notice("Could not normalize existing dependency references");
        return false;
      }
    }

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
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      batch.cursorLineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    let cursorLineText = parentValidation.line;

    const additions = [];
    const removals = batch.removals.slice();
    const legacyReplacements = new Map();
    let skippedStale = 0;
    let skippedOther = 0;

    batch.readyAdditions.forEach((snapshot) => {
      const targetLine = getEditorLine(this.editor, snapshot.line);
      if (targetLine !== snapshot.rawLine) {
        skippedStale += 1;
        return;
      }
      if (!isObsidianTaskAtLine(this.getEditorContent(), snapshot.line)) {
        skippedOther += 1;
        return;
      }

      const resolved = resolveTargetTaskIdentity(targetLine, {
        promptWhenBlockIdMissing: true,
        filePath: this.filePath,
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
      if (resolved.legacyValue && resolved.legacyValue !== resolved.value) {
        legacyReplacements.set(resolved.legacyValue, resolved.value);
      }
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
      if (!isObsidianTaskAtLine(this.getEditorContent(), snapshot.line)) {
        skippedOther += 1;
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
        this.filePath,
      );
      if (updatedLine === null) {
        skippedOther += 1;
        return;
      }
      if (
        !replaceEditorLine(this.editor, snapshot.line, targetLine, updatedLine)
      ) {
        skippedOther += 1;
        return;
      }

      const depValue = tryDependencyId(this.filePath, confirmedId);
      if (!depValue) {
        skippedOther += 1;
        return;
      }
      additions.push({ depValue, linkBlockId: confirmedId });
      const existingId = findBulletPropertyField(targetLine, "id");
      const legacyId = existingId && normalizeBulletPropertyValue(existingId.value);
      if (legacyId && legacyId !== depValue) {
        legacyReplacements.set(legacyId, depValue);
      }
    });

    if (legacyReplacements.size > 0) {
      const currentContent = this.getEditorContent();
      const rewrite = rewriteDependsOnIdsInContent(currentContent, legacyReplacements);
      if (rewrite.changed && !replaceEditorContent(this.editor, currentContent, rewrite.content)) {
        new Notice("Could not normalize existing dependency references");
        return false;
      }
      cursorLineText = getEditorLine(this.editor, this.cursor.line);
      if (cursorLineText === null) {
        return false;
      }
    }

    const dependencyResult = applyLocalTaskDependencyListEdits(
      cursorLineText,
      batch.propertyName,
      {
        add: additions.map((addition) => addition.depValue),
        remove: removals.flatMap((removal) =>
          [removal.depValue, removal.legacyDepValue].filter(Boolean),
        ),
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
      removals.map((removal) => removal.linkBlockId),
    );
    const finalBlockIds = computeFinalDependencyLinkOrder(
      collection.targets,
      additions.map((addition) => addition.linkBlockId),
      removals.map((removal) => removal.linkBlockId),
    );
    const existingSet = new Set(
      collection.targets.map(dependencyNavigationTargetKey),
    );
    const finalSet = new Set(
      normalizeDependencyNavigationTargets(finalBlockIds).map(
        dependencyNavigationTargetKey,
      ),
    );
    const plan = planDependencyNavigationBulletSync(
      content,
      this.cursor.line,
      finalBlockIds,
      { managedBlockIds: removals.map((removal) => removal.linkBlockId) },
    );
    const applied = applyDependencyNavigationBulletSyncPlan(this.editor, plan);
    if (plan.changed && !applied.changed) {
      return { added: 0, removed: 0, updated: 0, consolidated: 0 };
    }

    return {
      added: normalizeDependencyNavigationTargets(finalBlockIds).filter(
        (target) => !existingSet.has(dependencyNavigationTargetKey(target)),
      ).length,
      removed: collection.targets.filter(
        (target) => !finalSet.has(dependencyNavigationTargetKey(target)),
      ).length,
      updated:
        applied.replaced > 0 && !applied.consolidated ? applied.replaced : 0,
      consolidated: applied.consolidated ? 1 : 0,
    };
  }

  handleKeydown(event) {
    if (
      this.isLocalTaskStage() &&
      !this.isCountedSession() &&
      event.key === "Tab"
    ) {
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
      if (this.opening) {
        return;
      }
      this.opening = true;
      Promise.resolve()
        .then(() => this.deleteSelectedProperty())
        .then((deleted) => {
          if (deleted) {
            this.close();
          }
        })
        .catch(() => {
          new Notice("Could not delete bullet property");
        })
        .finally(() => {
          this.opening = false;
        });
      return;
    }

    if (this.stage === "value" && isCtrlKey(event, "r")) {
      if (this.rerollPriorityDateSuggestion()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    super.handleKeydown(event);
  }

  async deleteSelectedProperty() {
    const item = this.visibleItems[this.selectedIndex];
    if (!item || item.kind !== "property") {
      return false;
    }

    const propertyName = item.property.name;
    if (!item.defined) {
      new Notice(
        item.target.kind === "project-frontmatter"
          ? `${propertyName} is not set on this project`
          : `${propertyName} is not set on this bullet`,
      );
      return false;
    }

    const result = await (this.isCountedSession()
      ? this.plugin.deleteCountedBulletPropertyValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.taskSession,
          propertyName,
        )
      : item.target.kind === "project-frontmatter"
        ? await this.plugin.deleteProjectNoteScheduledValue(
            this.editor,
            this.cursor,
            this.filePath,
            this.lineText,
            item.currentValue,
          )
        : this.plugin.deleteBulletPropertyValue(
            this.editor,
            this.cursor,
            propertyName,
            {
              filePath: this.filePath,
              expectedLine: this.lineText,
            },
          ));
    if (!result || result.deleted !== true) {
      if (result && result.line) {
        this.lineText = result.line;
        this.bulletSubtitle = truncateBulletPropertySubtitle(result.line);
        this.showPropertyStage({
          clearQuery: false,
          selectPropertyName: propertyName,
        });
      }
      return false;
    }

    return true;
  }

  async applySelectedValue(item, options = {}) {
    if (!this.selectedPropertyItem || !item) {
      return false;
    }

    if (this.isCountedSession()) {
      if (this.selectedPropertyItem.property.values === "priority") {
        return await this.plugin.setCountedBulletPriorityValue(
          this.editor,
          this.cursor,
          this.filePath,
          this.taskSession,
          this.selectedPropertyItem.property,
          item.priorityLevel,
          {
            baseDate: this.valueBaseDate,
            random: this.priorityRandom,
          },
        );
      }
      return await this.plugin.setCountedBulletPropertyValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.taskSession,
        this.selectedPropertyItem.property.name,
        item.value,
        { scheduleLog: options.scheduleLog },
      );
    }

    if (this.selectedPropertyItem.property.values === "priority") {
      return await this.plugin.setBulletPriorityValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        this.selectedPropertyItem.property,
        item.priorityLevel,
        {
          propertyContext: this.propertyContext,
          baseDate: this.valueBaseDate,
          random: this.priorityRandom,
        },
      );
    }

    if (this.selectedPropertyItem.target.kind === "project-frontmatter") {
      return await this.plugin.setProjectNoteScheduledValue(
        this.editor,
        this.cursor,
        this.filePath,
        this.lineText,
        this.selectedPropertyItem.currentValue,
        item.value,
        { scheduleLog: options.scheduleLog },
      );
    }

    return await this.plugin.setBulletPropertyValue(
      this.editor,
      this.cursor,
      this.selectedPropertyItem.property.name,
      item.value,
      {
        filePath: this.filePath,
        expectedLine: this.lineText,
        scheduleLog: options.scheduleLog,
      },
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
    this.dashLocation = null;
    this.pendingRestoreDeferred = null;
    this.pendingDashTasksDeferred = null;
    this.pendingDashTasksScrollDeferred = null;
    this.pendingDashLocationRestoreDeferred = null;
    this.pendingDashLocationCaptureDeferred = null;
    this.activeDashScrollDOM = null;
    this.activeDashScrollHandler = null;
    this.isRestoringDashLocation = false;
    this.pendingOpenTaskJumpCenterDeferred = null;
    this.vimMappingsRegistered = false;
    // Shared guard for Ctrl+Shift+M task-note and Pomodoro-bullet pickers.
    this.activeTaskMoveDestinationPicker = null;
    this.activeBulletPropertyPicker = null;
    this.pendingTaskMoveJumpDeferred = null;

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
      id: "move-tasks-to-note",
      name: "Move tasks to note",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "M" }],
      editorCallback: (editor, view) =>
        this.openTaskMoveOrPomodoroBulletPicker(editor, view),
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
      name: "Rewrite dependency navigation links (current note)",
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
      name: "Jump to next open task or move a planned Pomodoro down",
      // Omitting repeat means "resolve the pending Vim count" in the shared
      // route; an explicit 1 would drop a typed count when this command wins
      // the dual-dispatch race.
      editorCallback: (editor) => this.jumpToOpenObsidianTask(editor, 1),
    });

    this.addCommand({
      id: "jump-to-prev-open-task",
      name: "Jump to previous open task or move a planned Pomodoro up",
      // Omitting repeat means "resolve the pending Vim count" in the shared
      // route; an explicit 1 would drop a typed count when this command wins
      // the dual-dispatch race.
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
      id: "toggle-current-tab-pin",
      name: "Toggle current tab pin",
      callback: () => this.toggleCurrentTabPin(),
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
      this.refreshDashScrollCaptureTarget();
    });

    this.registerVimMappingsWhenReady();

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.trackOpenedFile(file)),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.refreshDashScrollCaptureTarget(),
      ),
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
    this.registerCountedBulletPropertyInputListeners();
    this.registerCountedTaskMoveInputListeners();
    this.registerClearSearchHighlightInputListeners();

    this.register(() => {
      this.cancelPendingRestore();
      this.cancelPendingDashTasksJump();
      this.cancelPendingDashLocationRestore();
      this.cancelPendingDashLocationCapture();
      this.clearDashScrollCaptureTarget();
      cancelDeferred(this.pendingOpenTaskJumpCenterDeferred);
      this.pendingOpenTaskJumpCenterDeferred = null;
      this.cancelPendingTaskMoveJump();
    });
  }

  async applyDependencyAwareTransclusionChanges(
    cm,
    changesByLine,
    cursorOptions = null,
  ) {
    if (!cm || typeof cm.getValue !== "function") {
      return false;
    }
    const commitCursorOptions =
      normalizeTransclusionCommitCursorOptions(cursorOptions);
    const originalContent = String(cm.getValue() || "");
    const newline = originalContent.includes("\r\n") ? "\r\n" : "\n";
    const originalLines = originalContent.split(/\r?\n/);
    const nextLines = originalLines.slice();
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile && activeFile.path;
    const actions = [];
    const sameFileTargetEdits = new Map();
    const externalFiles = new Map();
    let showedUnqualifiablePathNotice = false;

    for (const change of changesByLine) {
      nextLines[change.line] = change.nextLineText;
    }
    for (const change of changesByLine) {
      const original = parseDependencyTransclusionBulletDetails(
        originalLines[change.line],
      );
      const next = parseDependencyTransclusionBulletDetails(change.nextLineText);
      if (
        !original ||
        !next ||
        original.blockId !== next.blockId ||
        original.note !== next.note ||
        original.transcluded === next.transcluded
      ) {
        continue;
      }
      const parentLine = findDependencyToggleParent(originalLines, change.line);
      if (parentLine === null || !activeFile) {
        continue;
      }
      if (nextLines[parentLine] !== originalLines[parentLine]) {
        continue;
      }
      const targetFile = original.note
        ? this.resolveLinkTargetFile(`${original.note}#^${original.blockId}`, sourcePath)
        : activeFile;
      if (!targetFile || !targetFile.path) {
        continue;
      }

      let targetLines;
      let targetLine;
      if (targetFile.path === sourcePath) {
        targetLines = originalLines;
        targetLine = findTaskLineByBlockId(targetLines, original.blockId);
        if (
          targetLine !== null &&
          nextLines[targetLine] !== originalLines[targetLine]
        ) {
          targetLine = null;
        }
      } else {
        let external = externalFiles.get(targetFile.path);
        if (!external) {
          try {
            const content = await this.app.vault.cachedRead(targetFile);
            external = {
              file: targetFile,
              originalContent: String(content || ""),
              lines: String(content || "").split(/\r?\n/),
              targetEdits: new Map(),
            };
            externalFiles.set(targetFile.path, external);
          } catch (error) {
            continue;
          }
        }
        targetLines = external.lines;
        targetLine = findTaskLineByBlockId(targetLines, original.blockId);
      }
      if (targetLine === null) {
        continue;
      }
      const targetSnapshot = String(targetLines[targetLine] || "");
      if (
        next.transcluded &&
        hasWholeTaskTag(targetSnapshot, PROJECT_HIDE_TAG)
      ) {
        continue;
      }
      const targetIsOpen = isOpenObsidianTaskLine(targetSnapshot);
      const idField = findBulletPropertyField(targetLines[targetLine], "id");
      const legacyId = idField && normalizeBulletPropertyValue(idField.value);
      const canonicalId = tryDependencyId(targetFile.path, original.blockId);
      if (!canonicalId) {
        if (!showedUnqualifiablePathNotice) {
          new Notice(
            "Dependency toggle skipped: a target note path cannot be encoded as a dependency ID",
          );
          showedUnqualifiablePathNotice = true;
        }
        continue;
      }
      if (next.transcluded) {
        const desiredStatus = getDependencyPromotionStatus(
          getObsidianTaskCheckboxStatus(originalLines[parentLine]),
        );
        if (targetFile.path === sourcePath) {
          const existing = sameFileTargetEdits.get(targetLine);
          if (existing) {
            existing.desiredStatus = strongerObsidianTaskStatus(
              existing.desiredStatus,
              desiredStatus,
            );
          } else {
            sameFileTargetEdits.set(targetLine, {
              canonicalId,
              desiredStatus,
              targetSnapshot,
            });
          }
        } else {
          const external = externalFiles.get(targetFile.path);
          const existing = external.targetEdits.get(original.blockId);
          if (existing) {
            existing.desiredStatus = strongerObsidianTaskStatus(
              existing.desiredStatus,
              desiredStatus,
            );
          } else {
            external.targetEdits.set(original.blockId, {
              canonicalId,
              desiredStatus,
              targetSnapshot,
            });
          }
        }
      }
      actions.push({
        parentLine,
        blockId: original.blockId,
        dependencyId: canonicalId,
        legacyId: legacyId && legacyId !== canonicalId ? legacyId : null,
        transcluded: next.transcluded,
        blockParent: next.transcluded && targetIsOpen,
        targetPath: targetFile.path,
      });
    }

    sameFileTargetEdits.forEach((edit, targetLine) => {
      if (nextLines[targetLine] !== edit.targetSnapshot) {
        return;
      }
      const withId = upsertBulletProperty(
        nextLines[targetLine],
        "id",
        edit.canonicalId,
      ).line;
      nextLines[targetLine] = promoteObsidianTaskCheckboxStatus(
        withId,
        edit.desiredStatus,
      );
    });

    const failedExternalPaths = new Set();
    // Re-verify the source snapshot immediately before the first external
    // write. Link resolution and cached reads above can yield to user edits.
    if (
      externalFiles.size > 0 &&
      String(cm.getValue() || "") !== originalContent
    ) {
      return false;
    }
    for (const [path, external] of externalFiles) {
      if (external.targetEdits.size === 0) {
        continue;
      }
      if (String(cm.getValue() || "") !== originalContent) {
        return false;
      }
      try {
        await this.app.vault.process(external.file, (content) => {
          if (
            String(cm.getValue() || "") !== originalContent ||
            String(content || "") !== external.originalContent
          ) {
            failedExternalPaths.add(path);
            return content;
          }
          const targetNewline = String(content || "").includes("\r\n")
            ? "\r\n"
            : "\n";
          const lines = String(content || "").split(/\r?\n/);
          const targetsAreCurrent = Array.from(
            external.targetEdits.entries(),
          ).every(([blockId, edit]) => {
            const targetLine = findTaskLineByBlockId(lines, blockId);
            return (
              targetLine !== null &&
              lines[targetLine] === edit.targetSnapshot
            );
          });
          if (!targetsAreCurrent) {
            failedExternalPaths.add(path);
            return content;
          }
          external.targetEdits.forEach((edit, blockId) => {
            const targetLine = findTaskLineByBlockId(lines, blockId);
            const withId = upsertBulletProperty(
              lines[targetLine],
              "id",
              edit.canonicalId,
            ).line;
            lines[targetLine] = promoteObsidianTaskCheckboxStatus(
              withId,
              edit.desiredStatus,
            );
          });
          return lines.join(targetNewline);
        });
      } catch (error) {
        failedExternalPaths.add(path);
      }
    }

    const legacyReplacements = new Map();
    const parentsToBlock = new Set();
    actions.forEach((action) => {
      if (action.transcluded && failedExternalPaths.has(action.targetPath)) {
        return;
      }
      if (action.transcluded && action.legacyId) {
        legacyReplacements.set(action.legacyId, action.dependencyId);
      }
    });
    if (legacyReplacements.size > 0) {
      const nextContentSnapshot = nextLines.join(newline);
      const lineContexts = getMarkdownLineContexts(nextContentSnapshot);
      for (let index = 0; index < nextLines.length; index += 1) {
        if (
          isObsidianTaskAtLine(
            nextContentSnapshot,
            index,
            lineContexts,
            nextLines,
          )
        ) {
          nextLines[index] = rewriteDependsOnIdsInLine(
            nextLines[index],
            legacyReplacements,
          );
        }
      }
      const propagated = await this.propagateDependencyIdReplacements(
        legacyReplacements,
        new Set([sourcePath, ...externalFiles.keys()]),
      );
      if (!propagated) {
        new Notice("Dependency references could not all be normalized");
      }
    }

    actions.forEach((action) => {
      if (action.transcluded && failedExternalPaths.has(action.targetPath)) {
        return;
      }
      const edit = applyLocalTaskDependencyListEdits(
        nextLines[action.parentLine],
        "dependsOn",
        action.transcluded
          ? { add: [action.dependencyId] }
          : {
              remove: [
                action.dependencyId,
                action.legacyId,
                action.blockId,
              ].filter(Boolean),
            },
      );
      nextLines[action.parentLine] = edit.line;
      if (action.blockParent) {
        parentsToBlock.add(action.parentLine);
      }
    });
    parentsToBlock.forEach((parentLine) => {
      nextLines[parentLine] = blockObsidianTaskCheckboxStatus(
        nextLines[parentLine],
      );
    });

    if (String(cm.getValue() || "") !== originalContent) {
      return false;
    }
    return applyEditorLineChanges(
      cm,
      originalLines,
      nextLines,
      getTransclusionCommitFinalCursor(cm, commitCursorOptions),
    );
  }

  async propagateDependencyIdReplacements(replacements, excludedPaths = new Set()) {
    if (
      !(replacements instanceof Map) ||
      replacements.size === 0 ||
      !this.app.vault ||
      typeof this.app.vault.getMarkdownFiles !== "function"
    ) {
      return true;
    }
    const legacyIds = Array.from(replacements.keys()).filter(Boolean);
    let succeeded = true;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file || excludedPaths.has(file.path)) {
        continue;
      }
      try {
        const openEditor = this.getOpenMarkdownEditorForPath(file.path);
        if (openEditor && typeof openEditor.getValue === "function") {
          const content = String(openEditor.getValue() || "");
          if (!legacyIds.some((legacyId) => content.includes(legacyId))) {
            continue;
          }
          const rewrite = rewriteDependsOnIdsInContent(content, replacements);
          if (
            rewrite.changed &&
            !replaceEditorContent(openEditor, content, rewrite.content)
          ) {
            succeeded = false;
          }
          continue;
        }
        const cachedContent = String(await this.app.vault.cachedRead(file) || "");
        if (!legacyIds.some((legacyId) => cachedContent.includes(legacyId))) {
          continue;
        }
        await this.app.vault.process(file, (content) => {
          const rewrite = rewriteDependsOnIdsInContent(content, replacements);
          return rewrite.changed ? rewrite.content : content;
        });
      } catch (error) {
        console.error("Could not normalize dependency references", file.path, error);
        succeeded = false;
      }
    }
    return succeeded;
  }

  getOpenMarkdownEditorForPath(filePath) {
    if (!this.app.workspace) return null;
    const active = this.getActiveMarkdownView();
    if (active && active.file && active.file.path === filePath) {
      return active.editor || null;
    }
    if (typeof this.app.workspace.getLeavesOfType !== "function") return null;
    const leaf = this.app.workspace.getLeavesOfType("markdown").find(
      (candidate) =>
        candidate &&
        candidate.view &&
        candidate.view.file &&
        candidate.view.file.path === filePath,
    );
    return leaf && leaf.view ? leaf.view.editor || null : null;
  }

  // Snapshot today's daily note ahead of a scheduling write that will defer a
  // task to the future. Returns null (clean no-op for the caller) when the
  // vault API is unavailable, open Markdown buffers are ambiguous, there is no
  // daily note for `today`, or the read throws. When the edited note (
  // `options.sourcePath`) *is* today's daily note, `sameFile` is true and
  // `file`/`editor`/`content` are left unused — the caller already holds the
  // note's content and folds the prune into its own single write instead of
  // reading or writing the daily note separately here.
  async readDeferredPomodoroSnapshot(app, options = {}) {
    const vault = app && app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return null;
    }
    const sourcePath = normalizeVaultRelativePath(options.sourcePath);
    const today = options.today instanceof Date ? options.today : new Date();
    const buffers = getOpenMarkdownBufferContents(app);
    if (buffers.ambiguous) {
      return null;
    }
    if (sourcePath) {
      buffers.set(sourcePath, String(options.sourceContent || ""));
    }
    let vaultFiles;
    try {
      vaultFiles = vault.getMarkdownFiles() || [];
    } catch (error) {
      return null;
    }
    const dailyPath = scheduledRecoveryDailyPaths(vaultFiles, today).current;
    if (!dailyPath) {
      return null;
    }
    const noteIndex = createScheduledRecoveryNoteIndex(
      vaultFiles.map((file) => ({
        path: normalizeVaultRelativePath(file.path),
      })),
    );
    if (dailyPath === sourcePath) {
      return Object.freeze({
        dailyPath,
        file: null,
        editor: null,
        content: null,
        noteIndex,
        sameFile: true,
      });
    }

    const dailyFile = vaultFiles.find(
      (file) => normalizeVaultRelativePath(file.path) === dailyPath,
    );
    if (!dailyFile) {
      return null;
    }
    const editor = this.getOpenMarkdownEditorForPath(dailyPath);
    let content = null;
    if (buffers.has(dailyPath)) {
      content = buffers.get(dailyPath);
    } else if (editor && typeof editor.getValue === "function") {
      content = String(editor.getValue() || "");
    } else if (typeof vault.cachedRead === "function") {
      try {
        content = String((await vault.cachedRead(dailyFile)) || "");
      } catch (error) {
        return null;
      }
    }
    if (content === null) {
      return null;
    }
    return Object.freeze({
      dailyPath,
      file: dailyFile,
      editor,
      content,
      noteIndex,
      sameFile: false,
    });
  }

  // Apply a `planDeferredPomodoroLinkCleanup` plan to the (separate-file)
  // daily note captured by `snapshot`, guarded by the same preimage-check
  // pattern as `writeTaskMoveChange`. Never throws: the schedule write this
  // follows is already durable, so a prune failure is reported and dropped,
  // never retried and never allowed to roll the schedule back. Returns true
  // for a same-file snapshot or an unchanged plan, since the caller is
  // responsible for folding those into its own primary write instead.
  async writeDeferredPomodoroCleanup(snapshot, plan) {
    if (!snapshot || snapshot.sameFile || !plan || !plan.changed) {
      return true;
    }
    const { dailyPath, file } = snapshot;
    try {
      const editor =
        snapshot.editor && typeof snapshot.editor.getValue === "function"
          ? snapshot.editor
          : this.getOpenMarkdownEditorForPath(dailyPath);
      if (editor && typeof editor.getValue === "function") {
        if (String(editor.getValue() || "") !== snapshot.content) {
          return false;
        }
        const applied = applyEditorContentTransaction(
          editor,
          snapshot.content,
          plan.content,
        );
        return applied && String(editor.getValue() || "") === plan.content;
      }
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.process !== "function" || !file) {
        return false;
      }
      let transformed = false;
      await vault.process(file, (content) => {
        if (String(content || "") !== snapshot.content) {
          throw new Error("Daily note preimage changed");
        }
        transformed = true;
        return plan.content;
      });
      return transformed;
    } catch (error) {
      return false;
    }
  }

  async toggleCurrentLineTransclusions(cm) {
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

    if (!result.changed) {
      return false;
    }
    const nextCh = adjustCursorChForTransclusionChanges(
      cursor.ch,
      result.changes,
      result.line.length,
    );
    const applied = await this.applyDependencyAwareTransclusionChanges(
      cm,
      [{ line: cursor.line, nextLineText: result.line }],
      {
        invocationCursor: cursor,
        finalCursor: { line: cursor.line, ch: nextCh },
      },
    );
    if (!applied) {
      return false;
    }

    return true;
  }

  async toggleCountedLineTransclusions(editor, cursor, repeat) {
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

    if (
      !(await this.applyDependencyAwareTransclusionChanges(
        editor,
        result.changesByLine,
        {
          invocationCursor: normalizedCursor,
          finalCursor: { line: startLine, ch: nextCh },
        },
      ))
    ) {
      return false;
    }

    return true;
  }

  consolidateDependencyNavigationLinks(cm) {
    if (!cm || typeof cm.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const content = String(cm.getValue() || "");
    const activeFile = this.app.workspace.getActiveFile();
    const filePath = activeFile ? activeFile.path : "";
    const resolutions = new Map();
    const lineContexts = getMarkdownLineContexts(content);
    const sourceLines = content.split(/\r?\n/);
    sourceLines.forEach((lineText, lineIndex) => {
      if (
        !isObsidianTaskAtLine(
          content,
          lineIndex,
          lineContexts,
          sourceLines,
        )
      ) {
        return;
      }
      const blockId = getTrailingBlockId(lineText);
      if (!blockId) {
        return;
      }
      const idField = findBulletPropertyField(lineText, "id");
      const id =
        (idField && normalizeBulletPropertyValue(idField.value)) || blockId;
      if (!resolutions.has(id)) {
        resolutions.set(id, { filePath, blockId });
      }
    });
    const transformed = transformDependencyBulletsInContent(
      content,
      filePath,
      resolutions,
    );
    const consolidatedTasks = transformed.changedTasks;
    if (transformed.changed) {
      replaceEditorContent(cm, content, transformed.content);
    }

    new Notice(
      consolidatedTasks > 0
        ? `Rewrote ${formatCountLabel(consolidatedTasks, "task")}`
        : "Nothing to rewrite",
    );
    return consolidatedTasks > 0;
  }

  openBulletPropertyPicker(cm, options = {}) {
    const activePicker = this.activeBulletPropertyPicker;
    if (activePicker) {
      const incomingCountExplicit = Boolean(
        options.countExplicit === true ||
          (options.taskSession && options.taskSession.explicit),
      );
      const activeCountExplicit = Boolean(
        activePicker.taskSession && activePicker.taskSession.explicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

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

    const content =
      cm && typeof cm.getValue === "function"
        ? String(cm.getValue() || "")
        : "";
    let taskSession = options.taskSession || null;
    if (options.countExplicit && !taskSession) {
      taskSession = discoverCountedObsidianTaskTargets(
        content,
        cursor.line,
        options.additionalTaskCount,
      );
    }
    if (taskSession && taskSession.explicit) {
      if (!taskSession.valid) {
        new Notice(taskSession.error);
        return false;
      }
    } else if (!isBulletLine(lineText)) {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    const config = options.config || loadBulletPropertyConfig();
    if (!config) {
      return false;
    }
    if (taskSession && taskSession.explicit) {
      const aggregate = createCountedBulletPropertyItems(
        config,
        content,
        taskSession,
      );
      if (!aggregate.valid) {
        new Notice(aggregate.error);
        return false;
      }
    }

    const basePropertyContext = getProjectNotePropertyContext(
      content,
      cursor.line,
    );
    if (!basePropertyContext.valid) {
      new Notice(basePropertyContext.error);
      return false;
    }
    const propertyContext = {
      ...basePropertyContext,
      isObsidianTask: isObsidianTaskAtLine(content, cursor.line),
    };

    const activeView = this.getActiveMarkdownView();
    if (!activeView || activeView.editor !== cm || !activeView.file) {
      new Notice("No active markdown note");
      return false;
    }
    const filePath = activeView.file.path;

    const picker = new BulletPropertyPickerModal(
      this.app,
      this,
      cm,
      cursor,
      lineText,
      config,
      {
        filePath,
        propertyContext,
        taskSession,
        random: options.random,
        baseDate: options.baseDate,
      },
    );
    this.activeBulletPropertyPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeBulletPropertyPicker === picker) {
        this.activeBulletPropertyPicker = null;
      }
      throw error;
    }
    return true;
  }

  getCountedTaskWriteContext(cm, filePath, session) {
    const activeView = this.getActiveMarkdownView();
    if (
      !activeView ||
      activeView.editor !== cm ||
      !activeView.file ||
      activeView.file.path !== filePath
    ) {
      return Object.freeze({
        valid: false,
        error: "Active note changed; no tasks were updated",
      });
    }
    if (!cm || typeof cm.getValue !== "function") {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    const content = String(cm.getValue() || "");
    const validation = validateCountedTaskSession(content, session);
    if (!validation.valid) {
      return Object.freeze({
        valid: false,
        error: `${validation.error}; no tasks were updated`,
      });
    }
    return Object.freeze({ valid: true, error: null, content });
  }

  getInlinePropertyWriteContext(cm, cursor, options = {}) {
    if (
      !cm ||
      typeof cm.getValue !== "function" ||
      !cursor ||
      !Number.isInteger(cursor.line)
    ) {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    const filePath = normalizeVaultRelativePath(options.filePath);
    if (filePath) {
      const activeView = this.getActiveMarkdownView();
      if (
        !activeView ||
        activeView.editor !== cm ||
        !activeView.file ||
        normalizeVaultRelativePath(activeView.file.path) !== filePath
      ) {
        return Object.freeze({
          valid: false,
          error: "Active note changed; bullet property was not updated",
        });
      }
    }
    const content = String(cm.getValue() || "");
    const line = getEditorLine(cm, cursor.line);
    if (line === null) {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }
    if (
      options.expectedLine !== undefined &&
      options.expectedLine !== null &&
      line !== options.expectedLine
    ) {
      return Object.freeze({
        valid: false,
        error: "Current task changed; bullet property was not updated",
      });
    }
    return Object.freeze({
      valid: true,
      error: null,
      filePath,
      content,
      line,
    });
  }

  getCountedTaskNoticeSuffix(session, unchangedTaskCount = 0) {
    return getCountedTaskNoticeSuffix(session, unchangedTaskCount);
  }

  async setCountedBulletPropertyValue(
    cm,
    cursor,
    filePath,
    session,
    name,
    value,
    options = {},
  ) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const today = new Date();
    let recoveryByLine = null;
    if (
      normalizeBulletPropertyName(name) === "scheduled" &&
      isDueInlineScheduledValue(value, today)
    ) {
      const includesProjectSchedule = session.targets.some((target) =>
        isProjectLifecycleTaskAtLine(writeContext.content, target.line),
      );
      const recoveryLines = includesProjectSchedule
        ? getProjectScheduleRecoveryTargetLines(writeContext.content)
        : session.targets.map((target) => target.line);
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        recoveryLines,
        today,
      );
      const guarded = this.getCountedTaskWriteContext(
        cm,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
    }
    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      name,
      value,
      {
        operation: "set",
        today,
        recoveryByLine,
        scheduleLog: options.scheduleLog,
      },
    );
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return false;
    }

    let finalContent = plan.content;
    let finalCursorLine = plan.cursorLine;
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.futureScheduledTaskLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today,
      });
      const guarded = this.getCountedTaskWriteContext(cm, filePath, session);
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        const targets = deferredPomodoroTargetsFromLines(
          filePath,
          splitMarkdownContent(writeContext.content).lines,
          plan.futureScheduledTaskLines,
        );
        if (targets.length > 0) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (dailyCleanupPlan.changed) {
              const linesRemovedBeforeCursor =
                dailyCleanupPlan.removedLineRanges.reduce(
                  (total, range) =>
                    range.endLineExclusive <= plan.cursorLine
                      ? total + (range.endLineExclusive - range.startLine)
                      : total,
                  0,
                );
              finalContent = dailyCleanupPlan.content;
              finalCursorLine = plan.cursorLine - linesRemovedBeforeCursor;
            }
          } else {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              pomodoroSnapshot.content,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
        }
      }
    }

    const finalLine = splitMarkdownContent(finalContent).lines[finalCursorLine] || "";
    try {
      if (
        finalContent !== writeContext.content &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          finalContent,
          {
            line: finalCursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted property transaction");
      }
    } catch (error) {
      new Notice("Could not update counted task properties; no tasks were updated");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot) {
      if (pomodoroSnapshot.sameFile) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        const written = await this.writeDeferredPomodoroCleanup(
          pomodoroSnapshot,
          dailyCleanupPlan,
        );
        if (written) {
          removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
        } else {
          pomodoroPruneFailed = true;
        }
      }
    }

    const propagationSuffix =
      plan.propagatedScheduleTaskCount > 0
        ? `; scheduled ${formatCountLabel(
            plan.propagatedScheduleTaskCount,
            "task",
          )}`
        : "";
    const hideSuffix =
      plan.removedHideTaskCount > 0
        ? `; removed #hide from ${formatCountLabel(
            plan.removedHideTaskCount,
            "task",
          )}`
        : "";
    const ambiguitySuffix =
      plan.ambiguousProjectTaskCount > 0
        ? `; ${formatCountLabel(
            plan.ambiguousProjectTaskCount,
            "task",
          )} with multiple scheduled fields unchanged`
        : "";
    const blockedSuffix =
      plan.blockedTaskCount > 0
        ? `; marked ${formatCountLabel(
            plan.blockedTaskCount,
            "task",
          )} Blocked`
        : "";
    const recoverySuffix = scheduledRecoveryNoticeSuffix({
      ready: plan.recoveredReadyTaskCount,
      next: plan.recoveredNextTaskCount,
      inProgress: plan.recoveredInProgressTaskCount,
      stillBlocked: plan.stillBlockedTaskCount,
      deferred: plan.deferredRecoveryTaskCount,
    });
    const scheduleLogSuffix =
      plan.scheduleLoggedTaskCount > 0
        ? `; ${
            plan.scheduleLogFallbackTaskCount === plan.scheduleLoggedTaskCount
              ? "logged without a reason on"
              : "logged reason on"
          } ${formatCountLabel(plan.scheduleLoggedTaskCount, "task")}`
        : "";
    const pomodoroPruneSuffix =
      removedPomodoroLinkCount > 0
        ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
        : pomodoroPruneFailed
          ? "; Pomodoro links not removed"
          : "";
    new Notice(
      `${name} → ${normalizeBulletPropertyValue(value)} on ${formatCountLabel(
        plan.changedTaskCount,
        "task",
      )}${this.getCountedTaskNoticeSuffix(
        session,
        plan.unchangedTaskCount,
      )}${propagationSuffix}${hideSuffix}${blockedSuffix}${ambiguitySuffix}${recoverySuffix}${scheduleLogSuffix}${pomodoroPruneSuffix}`,
    );
    return true;
  }

  async setCountedBulletPriorityValue(
    cm,
    cursor,
    filePath,
    session,
    property,
    level,
    options = {},
  ) {
    if (!property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }

    const baseDate =
      options.baseDate instanceof Date
        ? getLocalDateStart(options.baseDate)
        : getLocalDateStart(new Date());
    const random =
      typeof options.random === "function" ? options.random : Math.random;
    const rollByLine = new Map(
      session.targets.map((target) => [
        target.line,
        rollPriorityScheduledDateWithOffset(level, baseDate, random),
      ]),
    );
    const scheduledValueByLine = new Map(
      Array.from(rollByLine, ([line, roll]) => [
        line,
        formatBulletPropertyDate(roll.date),
      ]),
    );
    const includesDueDate = Array.from(scheduledValueByLine.values()).some(
      (scheduledValue) =>
        isDueInlineScheduledValue(scheduledValue, baseDate),
    );
    let recoveryByLine = null;
    if (includesDueDate) {
      const includesProjectSchedule = session.targets.some((target) =>
        isProjectLifecycleTaskAtLine(writeContext.content, target.line),
      );
      const recoveryLines = includesProjectSchedule
        ? getProjectScheduleRecoveryTargetLines(writeContext.content)
        : session.targets.map((target) => target.line);
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        recoveryLines,
        baseDate,
      );
      const guarded = this.getCountedTaskWriteContext(
        cm,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
    }

    // `target.rawLine` is guaranteed to equal the live line here —
    // getCountedTaskWriteContext ran validateCountedTaskSession above — so the
    // previous priority can be read straight off it.
    const scheduleLogReasonByLine = new Map(
      session.targets.map((target) => [
        target.line,
        formatPriorityRollScheduleReason({
          source: "priority",
          level,
          rolledDays: (rollByLine.get(target.line) || {}).offset,
          fromLevelLabel: getPriorityRollFromLevelLabel(
            property,
            (findBulletPropertyField(target.rawLine, property.name) || {}).value || "",
          ),
        }),
      ]),
    );

    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      property.name,
      null,
      {
        operation: "set-priority",
        priorityValue: level.value,
        scheduledPropertyName: property.schedules,
        scheduledValueByLine,
        today: baseDate,
        recoveryByLine,
        scheduleLog: { automatic: true, reasonByLine: scheduleLogReasonByLine },
      },
    );
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return false;
    }

    let finalContent = plan.content;
    let finalCursorLine = plan.cursorLine;
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.futureScheduledTaskLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today: baseDate,
      });
      const guarded = this.getCountedTaskWriteContext(cm, filePath, session);
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        const targets = deferredPomodoroTargetsFromLines(
          filePath,
          splitMarkdownContent(writeContext.content).lines,
          plan.futureScheduledTaskLines,
        );
        if (targets.length > 0) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (dailyCleanupPlan.changed) {
              const linesRemovedBeforeCursor =
                dailyCleanupPlan.removedLineRanges.reduce(
                  (total, range) =>
                    range.endLineExclusive <= plan.cursorLine
                      ? total + (range.endLineExclusive - range.startLine)
                      : total,
                  0,
                );
              finalContent = dailyCleanupPlan.content;
              finalCursorLine = plan.cursorLine - linesRemovedBeforeCursor;
            }
          } else {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              pomodoroSnapshot.content,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
        }
      }
    }

    const finalLine =
      splitMarkdownContent(finalContent).lines[finalCursorLine] || "";
    try {
      if (
        finalContent !== writeContext.content &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          finalContent,
          {
            line: finalCursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted priority transaction");
      }
    } catch (error) {
      new Notice("Could not update counted task priorities; no tasks were updated");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot) {
      if (pomodoroSnapshot.sameFile) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        const written = await this.writeDeferredPomodoroCleanup(
          pomodoroSnapshot,
          dailyCleanupPlan,
        );
        if (written) {
          removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
        } else {
          pomodoroPruneFailed = true;
        }
      }
    }

    showPriorityNotice(
      buildPriorityNoticeModel({
        property,
        level,
        levelIndex: normalizePriorityLevelIndex(property, level),
        baseDate,
        scheduledValues: Array.from(scheduledValueByLine.values()),
        taskCount: plan.changedTaskCount,
        scope: "counted",
        outcome: {
          blockedTaskCount: plan.blockedTaskCount,
          propagatedScheduleTaskCount: plan.propagatedScheduleTaskCount,
          removedHideTaskCount: plan.removedHideTaskCount,
          ambiguousTaskCount: plan.ambiguousProjectTaskCount,
          unchangedTaskCount: plan.unchangedTaskCount,
          session,
          recoveredReadyTaskCount: plan.recoveredReadyTaskCount,
          recoveredNextTaskCount: plan.recoveredNextTaskCount,
          recoveredInProgressTaskCount: plan.recoveredInProgressTaskCount,
          stillBlockedTaskCount: plan.stillBlockedTaskCount,
          deferredRecoveryTaskCount: plan.deferredRecoveryTaskCount,
          scheduleLoggedTaskCount: plan.scheduleLoggedTaskCount,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        },
      }),
      options,
    );
    return true;
  }

  async deleteCountedBulletPropertyValue(
    cm,
    cursor,
    filePath,
    session,
    name,
  ) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    let recoveryByLine = null;
    if (normalizeBulletPropertyName(name) === "scheduled") {
      const includesProjectSchedule = session.targets.some((target) =>
        isProjectLifecycleTaskAtLine(writeContext.content, target.line),
      );
      const recoveryLines = includesProjectSchedule
        ? getProjectScheduleRecoveryTargetLines(writeContext.content)
        : session.targets.map((target) => target.line);
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        recoveryLines,
        new Date(),
      );
      const guarded = this.getCountedTaskWriteContext(
        cm,
        filePath,
        session,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active note changed; no tasks were updated"
            : guarded.error,
        );
        return null;
      }
    }
    const plan = planCountedBulletPropertyBatch(
      writeContext.content,
      session,
      name,
      null,
      { operation: "delete", recoveryByLine },
    );
    if (!plan.valid) {
      new Notice(
        plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
      );
      return null;
    }
    const finalLine = splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
    try {
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          plan.content,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted property transaction");
      }
    } catch (error) {
      new Notice("Could not delete counted task properties; no tasks were updated");
      return null;
    }
    new Notice(
      `${name} ✗ removed from ${formatCountLabel(
        plan.changedTaskCount,
        "task",
      )}${this.getCountedTaskNoticeSuffix(
        session,
        plan.unchangedTaskCount,
      )}${
        plan.removedProjectScheduleTaskCount > 0
          ? `; removed propagated schedule from ${formatCountLabel(
              plan.removedProjectScheduleTaskCount,
              "task",
            )}`
          : ""
      }${scheduledRecoveryNoticeSuffix({
        ready: plan.recoveredReadyTaskCount,
        next: plan.recoveredNextTaskCount,
        inProgress: plan.recoveredInProgressTaskCount,
        stillBlocked: plan.stillBlockedTaskCount,
        deferred: plan.deferredRecoveryTaskCount,
      })}`,
    );
    return { deleted: true, line: finalLine };
  }

  applyCountedLocalTaskDependency(
    cm,
    cursor,
    filePath,
    session,
    dependencyTask,
    options = {},
  ) {
    const writeContext = this.getCountedTaskWriteContext(
      cm,
      filePath,
      session,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const plan = planCountedLocalTaskDependency(
      writeContext.content,
      session,
      dependencyTask,
      filePath,
      options,
    );
    if (!plan.valid) {
      const suffix = plan.stale ? "; no tasks were updated" : "";
      new Notice(`${plan.error}${suffix}`);
      return false;
    }
    const finalLine = splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
    try {
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          plan.content,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot apply a counted dependency transaction");
      }
    } catch (error) {
      new Notice("Could not update counted dependencies; no tasks were updated");
      return false;
    }
    const verb = plan.operation === "remove" ? "Removed" : "Added";
    const identity = plan.targetIdentityChanged
      ? `; prepared ^${plan.linkBlockId}`
      : "";
    new Notice(
      `${verb} ${plan.dependencyValue} ${
        plan.operation === "remove" ? "from" : "to"
      } ${formatCountLabel(plan.targetCount, "task")}${identity}${
        this.getCountedTaskNoticeSuffix(session, plan.unchangedTaskCount)
      }`,
    );
    return true;
  }

  getProjectScheduledWriteContext(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
    operation = "updated",
  ) {
    const activeView = this.getActiveMarkdownView();
    if (
      !activeView ||
      activeView.editor !== cm ||
      !activeView.file ||
      activeView.file.path !== filePath
    ) {
      return Object.freeze({
        valid: false,
        error: `Active project note changed; scheduled was not ${operation}`,
      });
    }
    if (!cm || typeof cm.getValue !== "function") {
      return Object.freeze({
        valid: false,
        error: "No active markdown editor",
      });
    }

    const content = String(cm.getValue() || "");
    const liveCursor = getEditorCursor(cm);
    if (!liveCursor || liveCursor.line !== cursor.line) {
      return Object.freeze({
        valid: false,
        error: `Cursor moved from the ^prj task; scheduled was not ${operation}`,
      });
    }
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText !== expectedLine) {
      return Object.freeze({
        valid: false,
        error: `The ^prj task changed; scheduled was not ${operation}`,
      });
    }

    const propertyContext = getProjectNotePropertyContext(content, cursor.line);
    if (!propertyContext.valid || !propertyContext.isProjectTask) {
      return Object.freeze({
        valid: false,
        error:
          propertyContext.error ||
          "Cursor is no longer on a valid ^prj task",
      });
    }
    const currentValue = propertyContext.frontmatter.scheduledDefined
      ? propertyContext.frontmatter.scheduledValue
      : "";
    if (currentValue !== normalizeBulletPropertyValue(expectedValue)) {
      return Object.freeze({
        valid: false,
        error: `Project scheduled changed while the picker was open; it was not ${operation}`,
      });
    }

    return Object.freeze({
      valid: true,
      content,
      propertyContext,
    });
  }

  async setProjectNoteScheduledValue(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
    value,
    options = {},
  ) {
    const writeContext = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }

    const today =
      options.today instanceof Date ? getLocalDateStart(options.today) : new Date();
    let recoveryByLine = null;
    if (isDueInlineScheduledValue(value, today)) {
      recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        filePath,
        writeContext.content,
        getProjectScheduleRecoveryTargetLines(writeContext.content),
        today,
      );
      const guarded = this.getProjectScheduledWriteContext(
        cm,
        cursor,
        filePath,
        expectedLine,
        expectedValue,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active project note changed; scheduled was not updated"
            : guarded.error,
        );
        return false;
      }
    }
    const plan = planProjectScheduledUpdate(
      writeContext.content,
      cursor.line,
      value,
      today,
      { recoveryByLine },
    );
    if (!plan.valid) {
      new Notice(plan.error);
      return false;
    }

    const plannedSource = splitMarkdownContent(plan.content);
    let finalLine = plannedSource.lines[plan.cursorLine] || "";
    const inlineResult = applyBulletPropertyEdits(
      finalLine,
      options.inlineEdits,
    );
    if (inlineResult.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }
    finalLine = inlineResult.line;
    plannedSource.lines[plan.cursorLine] = finalLine;

    let scheduleLogOutcome = null;
    if (hasScheduleLogReasonInput(options.scheduleLog)) {
      const scheduleLogPlan = planScheduleLogEntry(
        plannedSource.lines.join(plannedSource.lineEnding),
        plan.cursorLine,
        options.scheduleLog,
      );
      scheduleLogOutcome = getScheduleLogWriteOutcome(
        scheduleLogPlan,
        scheduleLogPlan.valid && applyScheduleLogEntryToLines(plannedSource.lines, scheduleLogPlan) > 0,
      );
    }

    let finalContent = plannedSource.lines.join(plannedSource.lineEnding);
    let finalCursorLine = plan.cursorLine;

    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    if (plan.futureScheduledTaskLines.length > 0) {
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: filePath,
        sourceContent: writeContext.content,
        today,
      });
      const guarded = this.getProjectScheduledWriteContext(
        cm,
        cursor,
        filePath,
        expectedLine,
        expectedValue,
      );
      if (!guarded.valid || guarded.content !== writeContext.content) {
        new Notice(
          guarded.valid
            ? "Active project note changed; scheduled was not updated"
            : guarded.error,
        );
        return false;
      }
      if (pomodoroSnapshot) {
        const targets = deferredPomodoroTargetsFromLines(
          filePath,
          splitMarkdownContent(writeContext.content).lines,
          plan.futureScheduledTaskLines,
        );
        if (targets.length > 0) {
          if (pomodoroSnapshot.sameFile) {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              finalContent,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
            if (dailyCleanupPlan.changed) {
              const linesRemovedBeforeCursor =
                dailyCleanupPlan.removedLineRanges.reduce(
                  (total, range) =>
                    range.endLineExclusive <= plan.cursorLine
                      ? total + (range.endLineExclusive - range.startLine)
                      : total,
                  0,
                );
              finalContent = dailyCleanupPlan.content;
              finalCursorLine = plan.cursorLine - linesRemovedBeforeCursor;
            }
          } else {
            dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
              pomodoroSnapshot.content,
              targets,
              {
                dailyPath: pomodoroSnapshot.dailyPath,
                noteIndex: pomodoroSnapshot.noteIndex,
              },
            );
          }
        }
      }
    }

    try {
      if (
        finalContent !== writeContext.content &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          finalContent,
          {
            line: finalCursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot replace note content");
      }
    } catch (error) {
      new Notice("Could not update project scheduled");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (
      dailyCleanupPlan &&
      dailyCleanupPlan.changed &&
      pomodoroSnapshot &&
      !pomodoroSnapshot.sameFile
    ) {
      const written = await this.writeDeferredPomodoroCleanup(
        pomodoroSnapshot,
        dailyCleanupPlan,
      );
      if (written) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        pomodoroPruneFailed = true;
      }
    } else if (
      dailyCleanupPlan &&
      dailyCleanupPlan.changed &&
      pomodoroSnapshot &&
      pomodoroSnapshot.sameFile
    ) {
      removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
    }

    const parts = [`scheduled → ${plan.scheduled}`];
    if (plan.scheduledTaskCount > 0) {
      parts.push(
        `scheduled ${formatCountLabel(plan.scheduledTaskCount, "task")}`,
      );
    }
    if (plan.removedHideTaskCount > 0) {
      parts.push(
        `removed #hide from ${formatCountLabel(
          plan.removedHideTaskCount,
          "task",
        )}`,
      );
    }
    if (plan.blockedTaskCount > 0) {
      parts.push(
        `marked ${formatCountLabel(plan.blockedTaskCount, "task")} Blocked`,
      );
    }
    if (plan.ambiguousTaskLines.length > 0) {
      parts.push(
        `${formatCountLabel(
          plan.ambiguousTaskLines.length,
          "task",
        )} with multiple scheduled fields unchanged`,
      );
    }
    if (scheduleLogOutcome === "created" || scheduleLogOutcome === "added") {
      parts.push("logged reason");
    } else if (scheduleLogOutcome === "added-fallback") {
      parts.push("logged without a reason");
    } else if (scheduleLogOutcome === "guard-failed") {
      parts.push("schedule log not written");
    }
    const recoveryCounts = {
      ready: plan.recoveredReadyTaskCount,
      next: plan.recoveredNextTaskCount,
      inProgress: plan.recoveredInProgressTaskCount,
      stillBlocked: plan.stillBlockedTaskCount,
      deferred: plan.deferredRecoveryTaskCount,
    };
    if (typeof options.buildNotice === "function") {
      showPriorityNotice(
        options.buildNotice({
          scheduled: plan.scheduled,
          scheduledTaskCount: plan.scheduledTaskCount,
          removedHideTaskCount: plan.removedHideTaskCount,
          blockedTaskCount: plan.blockedTaskCount,
          ambiguousTaskCount: plan.ambiguousTaskLines.length,
          recoveryCounts,
          scheduleLogOutcome,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        }),
        options,
      );
    } else {
      const pomodoroPruneSuffix =
        removedPomodoroLinkCount > 0
          ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
          : pomodoroPruneFailed
            ? "; Pomodoro links not removed"
            : "";
      new Notice(
        `${parts.join("; ")}${scheduledRecoveryNoticeSuffix(recoveryCounts)}${pomodoroPruneSuffix}`,
      );
    }
    return true;
  }

  async deleteProjectNoteScheduledValue(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
  ) {
    const writeContext = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
      "deleted",
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }

    const today = new Date();
    const recoveryByLine = await buildTargetScheduledRecoveryByLine(
      this.app,
      filePath,
      writeContext.content,
      getProjectScheduleRecoveryTargetLines(writeContext.content),
      today,
    );
    const guarded = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
      "deleted",
    );
    if (!guarded.valid || guarded.content !== writeContext.content) {
      new Notice(
        guarded.valid
          ? "Active project note changed; scheduled was not deleted"
          : guarded.error,
      );
      return null;
    }
    const plan = planProjectScheduledDelete(
      writeContext.content,
      cursor.line,
      { today, recoveryByLine },
    );
    if (!plan.valid) {
      new Notice(plan.error);
      return null;
    }

    let finalLine = "";
    try {
      finalLine =
        splitMarkdownContent(plan.content).lines[plan.cursorLine] || "";
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          plan.content,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot replace note content");
      }
    } catch (error) {
      new Notice("Could not delete project scheduled");
      return null;
    }

    new Notice(
      `scheduled ✗ removed${
        plan.removedScheduledTaskCount > 0
          ? `; removed propagated schedule from ${formatCountLabel(
              plan.removedScheduledTaskCount,
              "task",
            )}`
          : ""
      }${scheduledRecoveryNoticeSuffix({
        ready: plan.recoveredReadyTaskCount,
        next: plan.recoveredNextTaskCount,
        inProgress: plan.recoveredInProgressTaskCount,
        stillBlocked: plan.stillBlockedTaskCount,
        deferred: plan.deferredRecoveryTaskCount,
      })}`,
    );
    return { deleted: true, line: finalLine };
  }

  async setInlineBulletPropertyValues(
    cm,
    cursor,
    edits,
    scheduledValue,
    options = {},
  ) {
    const writeContext = this.getInlinePropertyWriteContext(
      cm,
      cursor,
      options,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return false;
    }
    const lineText = writeContext.line;
    const today =
      options.today instanceof Date ? getLocalDateStart(options.today) : new Date();
    const hasScheduledValue =
      scheduledValue !== null && scheduledValue !== undefined;
    const normalizedScheduledValue = hasScheduledValue
      ? normalizeBulletPropertyValue(scheduledValue)
      : "";
    const shouldRecover =
      hasScheduledValue &&
      isDueInlineScheduledValue(normalizedScheduledValue, today) &&
      !isProjectLifecycleTaskLine(lineText);
    const shouldPrune =
      hasScheduledValue &&
      isFutureInlineScheduledValue(normalizedScheduledValue, today) &&
      !isProjectLifecycleTaskLine(lineText);
    let recovery = null;
    let pomodoroSnapshot = null;
    if (shouldRecover || shouldPrune) {
      if (shouldRecover) {
        const recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          writeContext.filePath,
          writeContext.content,
          [cursor.line],
          today,
        );
        recovery = recoveryByLine.get(cursor.line);
      }
      if (shouldPrune) {
        pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
          sourcePath: writeContext.filePath,
          sourceContent: writeContext.content,
          today,
        });
      }
      const guarded = this.getInlinePropertyWriteContext(cm, cursor, options);
      if (
        !guarded.valid ||
        guarded.content !== writeContext.content ||
        guarded.line !== lineText
      ) {
        new Notice(
          guarded.valid
            ? "Current task changed; bullet property was not updated"
            : guarded.error,
        );
        return false;
      }
    }

    // Dropping a field before re-adding it moves it to the end of the line, so
    // callers that care about trailing-field order (priority must never sit to
    // the right of the date metadata, since Tasks-format parsers read trailing
    // fields right to left) can rebuild the order they need.
    const editBaseLine = (
      Array.isArray(options.reorderPropertyNames)
        ? options.reorderPropertyNames
        : []
    ).reduce((line, name) => removeAllBulletProperties(line, name), lineText);
    const result = applyBulletPropertyEdits(editBaseLine, edits);
    if (result.reason === "not-bullet") {
      new Notice("Cursor is not on a bullet");
      return false;
    }

    let nextLine = result.line;
    let blocked = false;
    let recoveryOutcome = null;
    if (shouldPrune) {
      const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
      blocked = blockedLine !== nextLine;
      nextLine = blockedLine;
    } else if (shouldRecover) {
      const reconciliation = reconcileBlockedScheduledTaskLine(
        nextLine,
        recovery,
      );
      nextLine = reconciliation.line;
      recoveryOutcome = reconciliation.outcome;
    }

    // When the deferred task's live Pomodoro links sit in this same note, the
    // property edit and the prune are folded into one editor transaction below
    // instead of two, so they land in a single undo group (edge case: the
    // source note is today's daily note).
    let dailyCleanupPlan = null;
    let foldedDailyContent = null;
    let effectiveCursorLine = cursor.line;
    if (shouldPrune && pomodoroSnapshot) {
      const blockId = getTrailingBlockId(nextLine);
      const targets = blockId
        ? [
            Object.freeze({
              path: normalizeVaultRelativePath(writeContext.filePath),
              blockId,
            }),
          ]
        : [];
      if (targets.length > 0) {
        if (pomodoroSnapshot.sameFile) {
          const merged = splitMarkdownContent(writeContext.content);
          merged.lines[cursor.line] = nextLine;
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            merged.lines.join(merged.lineEnding),
            targets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
          if (dailyCleanupPlan.changed) {
            foldedDailyContent = dailyCleanupPlan.content;
          }
        } else {
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            pomodoroSnapshot.content,
            targets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
        }
      }
    }

    if (foldedDailyContent !== null) {
      const linesRemovedBeforeCursor = dailyCleanupPlan.removedLineRanges.reduce(
        (total, range) =>
          range.endLineExclusive <= cursor.line
            ? total + (range.endLineExclusive - range.startLine)
            : total,
        0,
      );
      effectiveCursorLine = cursor.line - linesRemovedBeforeCursor;
      if (
        !applyEditorContentTransaction(cm, writeContext.content, foldedDailyContent, {
          line: effectiveCursorLine,
          ch: Math.min(Math.max(cursor.ch, 0), nextLine.length),
        })
      ) {
        new Notice("Could not update bullet property");
        return false;
      }
    } else if (
      nextLine !== lineText &&
      !replaceEditorLine(cm, cursor.line, lineText, nextLine)
    ) {
      new Notice("Could not update bullet property");
      return false;
    }

    let removedPomodoroLinkCount = 0;
    let pomodoroPruneFailed = false;
    if (dailyCleanupPlan && dailyCleanupPlan.changed && pomodoroSnapshot && !pomodoroSnapshot.sameFile) {
      const written = await this.writeDeferredPomodoroCleanup(
        pomodoroSnapshot,
        dailyCleanupPlan,
      );
      if (written) {
        removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
      } else {
        pomodoroPruneFailed = true;
      }
    } else if (foldedDailyContent !== null) {
      removedPomodoroLinkCount = dailyCleanupPlan.removedLinkCount;
    }

    let scheduleLogOutcome = null;
    if (hasScheduleLogReasonInput(options.scheduleLog)) {
      const scheduleLogPlan = planScheduleLogEntry(
        String(cm.getValue() || ""),
        effectiveCursorLine,
        options.scheduleLog,
      );
      scheduleLogOutcome = getScheduleLogWriteOutcome(
        scheduleLogPlan,
        scheduleLogPlan.valid && insertEditorLine(cm, scheduleLogPlan.insertLine, scheduleLogPlan.lineText),
      );
    }

    setEditorCursorSafely(
      cm,
      effectiveCursorLine,
      Math.min(Math.max(cursor.ch, 0), nextLine.length),
    );
    const firstEdit = Array.isArray(edits) ? edits[0] : null;
    const noticeText =
      options.noticeText ||
      `${firstEdit ? firstEdit.name : "property"} → ${
        firstEdit ? normalizeBulletPropertyValue(firstEdit.value) : ""
      }`;
    const recoveryCounts = {
      ready: recoveryOutcome === "ready" ? 1 : 0,
      next: recoveryOutcome === "next" ? 1 : 0,
      inProgress: recoveryOutcome === "in-progress" ? 1 : 0,
      stillBlocked: recoveryOutcome === "still-blocked" ? 1 : 0,
      deferred: recoveryOutcome === "deferred" ? 1 : 0,
    };
    if (typeof options.buildNotice === "function") {
      showPriorityNotice(
        options.buildNotice({
          blocked,
          recoveryOutcome,
          recoveryCounts,
          scheduleLogOutcome,
          removedPomodoroLinkCount,
          pomodoroPruneFailed,
        }),
        options,
      );
    } else {
      const scheduleLogSuffix =
        scheduleLogOutcome === "added"
          ? "; logged reason"
          : scheduleLogOutcome === "added-fallback"
            ? "; logged without a reason"
            : scheduleLogOutcome === "created"
              ? "; created schedule log"
              : scheduleLogOutcome === "guard-failed"
                ? "; schedule log not written"
                : "";
      const pomodoroPruneSuffix =
        removedPomodoroLinkCount > 0
          ? `; removed ${formatCountLabel(removedPomodoroLinkCount, "Pomodoro link")}`
          : pomodoroPruneFailed
            ? "; Pomodoro links not removed"
            : "";
      new Notice(
        `${noticeText}${
          blocked ? "; marked task Blocked" : ""
        }${scheduledRecoveryNoticeSuffix(recoveryCounts)}${scheduleLogSuffix}${pomodoroPruneSuffix}`,
      );
    }
    return true;
  }

  async setBulletPropertyValue(cm, cursor, name, value, options = {}) {
    const propertyName = normalizeBulletPropertyName(name);
    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [{ name, value }],
      propertyName === "scheduled" ? value : null,
      options,
    );
  }

  async setBulletPriorityValue(
    cm,
    cursor,
    filePath,
    lineText,
    property,
    level,
    context = {},
  ) {
    if (!property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }

    const baseDate =
      context.baseDate instanceof Date
        ? getLocalDateStart(context.baseDate)
        : getLocalDateStart(new Date());
    const roll = rollPriorityScheduledDateWithOffset(
      level,
      baseDate,
      typeof context.random === "function" ? context.random : Math.random,
    );
    const rolledDate = roll.date;
    const rolledValue = formatBulletPropertyDate(rolledDate);
    const levelIndex = normalizePriorityLevelIndex(property, level);
    // Read the live line rather than the captured one so the transition is correct
    // even if `lineText` was not supplied; the writers' own expectedLine guard is
    // what aborts the whole write if the note moved underneath us.
    const currentLine = getEditorLine(cm, cursor.line) ?? lineText ?? "";
    const priorityField = findBulletPropertyField(currentLine, property.name);
    const fromLevelLabel = getPriorityRollFromLevelLabel(property, priorityField ? priorityField.value : "");
    const propertyContext =
      context.propertyContext ||
      getProjectNotePropertyContext(
        cm && typeof cm.getValue === "function" ? cm.getValue() : "",
        cursor.line,
      );
    const scheduledTarget = resolveBulletPropertyTarget(
      property.schedules,
      propertyContext,
    );
    if (scheduledTarget.kind === "project-frontmatter") {
      const expectedScheduledValue =
        propertyContext.frontmatter &&
        propertyContext.frontmatter.scheduledDefined
          ? propertyContext.frontmatter.scheduledValue
          : "";
      return await this.setProjectNoteScheduledValue(
        cm,
        cursor,
        filePath,
        lineText,
        expectedScheduledValue,
        rolledValue,
        {
          inlineEdits: [{ name: property.name, value: level.value }],
          today: baseDate,
          scheduleLog: buildPriorityRollScheduleLog({
            source: "priority",
            level,
            rolledDays: roll.offset,
            fromLevelLabel,
            from: expectedScheduledValue,
            to: rolledValue,
          }),
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level,
              levelIndex,
              baseDate,
              scheduledValues: [outcome.scheduled || rolledValue],
              taskCount: 1,
              scope: "project",
              outcome: {
                ...outcome,
                scheduleLoggedTaskCount:
                  outcome.scheduleLogOutcome === "added" ||
                  outcome.scheduleLogOutcome === "created"
                    ? 1
                    : 0,
              },
            }),
        },
      );
    }

    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [
        { name: property.name, value: level.value },
        { name: property.schedules, value: rolledValue },
      ],
      rolledValue,
      {
        filePath,
        expectedLine: lineText,
        today: baseDate,
        scheduleLog: buildPriorityRollScheduleLog({
          source: "priority",
          level,
          rolledDays: roll.offset,
          fromLevelLabel,
          from: (findBulletPropertyField(currentLine, property.schedules) || {}).value || "",
          to: rolledValue,
        }),
        buildNotice: (outcome) =>
          buildPriorityNoticeModel({
            property,
            level,
            levelIndex,
            baseDate,
            scheduledValues: [rolledValue],
            taskCount: 1,
            scope: "task",
            outcome: {
              blockedTaskCount: outcome.blocked ? 1 : 0,
              recoveryCounts: outcome.recoveryCounts,
              scheduleLoggedTaskCount:
                outcome.scheduleLogOutcome === "added" ||
                outcome.scheduleLogOutcome === "created"
                  ? 1
                  : 0,
              removedPomodoroLinkCount: outcome.removedPomodoroLinkCount,
              pomodoroPruneFailed: outcome.pomodoroPruneFailed,
            },
          }),
        // Rebuild an existing schedules field after the priority, matching the
        // counted writer, so a level value outside Tasks' priority names can
        // never hide the rolled date from a right-to-left trailing-field parse.
        reorderPropertyNames: [property.schedules],
      },
    );
  }

  setLocalTaskDependency(cm, cursor, name, id, options = {}) {
    const parentValidation = validateDependencyParentForEditor(
      cm,
      cursor,
      options.expectedParentLine === undefined
        ? null
        : options.expectedParentLine,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const lineText = parentValidation.line;

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
        const localTargetKey = dependencyNavigationTargetKey(linkBlockId);
        const hadNavigationLink = collection.targets.some(
          (target) => dependencyNavigationTargetKey(target) === localTargetKey,
        );
        const finalBlockIds = computeFinalDependencyLinkOrder(
          collection.targets,
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
          } else if (
            !hadNavigationLink &&
            normalizeDependencyNavigationTargets(finalBlockIds).some(
              (target) => dependencyNavigationTargetKey(target) === localTargetKey,
            )
          ) {
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

  async deleteBulletPropertyValue(cm, cursor, name, options = {}) {
    const writeContext = this.getInlinePropertyWriteContext(
      cm,
      cursor,
      options,
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }
    const lineText = writeContext.line;
    const propertyName = normalizeBulletPropertyName(name);
    const shouldRecover =
      propertyName === "scheduled" &&
      !isProjectLifecycleTaskLine(lineText);
    let recovery = null;
    if (shouldRecover) {
      const recoveryByLine = await buildTargetScheduledRecoveryByLine(
        this.app,
        writeContext.filePath,
        writeContext.content,
        [cursor.line],
        new Date(),
      );
      recovery = recoveryByLine.get(cursor.line);
      const guarded = this.getInlinePropertyWriteContext(cm, cursor, options);
      if (
        !guarded.valid ||
        guarded.content !== writeContext.content ||
        guarded.line !== lineText
      ) {
        new Notice(
          guarded.valid
            ? "Current task changed; bullet property was not deleted"
            : guarded.error.replace("updated", "deleted"),
        );
        return null;
      }
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

    let nextLine = result.line;
    let recoveryOutcome = null;
    if (shouldRecover) {
      const reconciliation = reconcileBlockedScheduledTaskLine(
        nextLine,
        recovery,
      );
      nextLine = reconciliation.line;
      recoveryOutcome = reconciliation.outcome;
    }

    if (
      nextLine !== lineText &&
      !replaceEditorLine(cm, cursor.line, lineText, nextLine)
    ) {
      new Notice("Could not delete bullet property");
      return null;
    }

    setEditorCursorSafely(
      cm,
      cursor.line,
      Math.min(Math.max(cursor.ch, 0), nextLine.length),
    );
    new Notice(
      `${name} ✗ removed${scheduledRecoveryNoticeSuffix({
        ready: recoveryOutcome === "ready" ? 1 : 0,
        next: recoveryOutcome === "next" ? 1 : 0,
        inProgress: recoveryOutcome === "in-progress" ? 1 : 0,
        stillBlocked: recoveryOutcome === "still-blocked" ? 1 : 0,
        deferred: recoveryOutcome === "deferred" ? 1 : 0,
      })}`,
    );
    return { deleted: true, line: nextLine };
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

  // Reorder a movable (open, placeholder) Pomodoro entry under the cursor
  // among its planned siblings, in place of a jump. `repeat` is an exact
  // Vim count (default 1): N positions in one transaction, or a refusal with
  // no mutation. Returns `false` when the cursor is not on a movable entry,
  // so the caller falls through to the jump; returns `true` when handled
  // (moved, or refused with a notice) so the caller must not jump.
  movePlannedPomodoroEntry(editor, direction, repeat = 1) {
    if (!editor || typeof editor.getValue !== "function") {
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      return false;
    }

    const sourceContent = String(editor.getValue() || "");
    const context = findPomodoroEntryContext(sourceContent, cursor.line);
    if (!isMovablePomodoroEntryContext(context)) {
      return false;
    }

    const sourceRawLine = splitMarkdownContent(sourceContent).lines[cursor.line];
    const plan = planPomodoroEntryReorder(sourceContent, {
      sourceEntryLine: cursor.line,
      sourceRawLine,
      direction,
      repeat: normalizeVimRepeat(repeat),
    });

    if (!plan.valid) {
      new Notice(plan.error);
      return true;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const finalCursor = {
      line: plan.movedEntryLine,
      ch: Math.min(cursor.ch, String(afterLines[plan.movedEntryLine] || "").length),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        editor,
        sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(editor.getValue() || "") === plan.after;
    }
    if (!applied || String(editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro move failed; nothing was moved");
      return true;
    }

    const label = getPomodoroBulletMoveDestinationLabel(plan.entry);
    const directionWord = direction < 0 ? "up" : "down";
    new Notice(
      plan.repeat > 1
        ? `Moved ${label} ${directionWord} ${plan.repeat} positions`
        : `Moved ${label} ${directionWord}`,
    );
    return true;
  }

  jumpToOpenObsidianTask(editor, direction, repeat) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    // A single physical Ctrl+Shift+J/K can reach this method twice in the same
    // dispatch turn: once via the Obsidian hotkeys.json command and once via the
    // Vim-normal capture fallback. Suppress the duplicate so a no-target press
    // shows only one notice or move (a successful jump never moves twice, and a
    // planned-Pomodoro reorder never reorders twice). Count resolution happens
    // after this mark so a suppressed duplicate never consumes Vim input state.
    // The mark is keyed by editor and direction, not repeat, and clears on the
    // next macrotask so deliberate repeats and key repeat still work.
    if (this.isOpenTaskJumpDispatchPending(editor, direction)) {
      return false;
    }
    this.markOpenTaskJumpDispatch(editor, direction);

    const normalizedRepeat =
      repeat === undefined || repeat === null
        ? this.consumePendingOpenTaskJumpRepeat(editor)
        : normalizeVimRepeat(repeat);

    if (this.movePlannedPomodoroEntry(editor, direction, normalizedRepeat)) {
      return true;
    }

    const targetLine = getOpenObsidianTaskJumpLine(
      String(editor.getValue()).split(/\r?\n/),
      cursor.line,
      direction,
      normalizedRepeat,
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

  // The Obsidian hotkeys.json command route reaches jumpToOpenObsidianTask
  // without a repeat and, in the live app, wins the race against the
  // capture-phase fallback, so reading the count only in the fallback loses
  // it. Resolve and consume it here so whichever route arrives first sees the
  // still-pending count.
  consumePendingOpenTaskJumpRepeat(editor) {
    const activeView =
      this.app &&
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.getActiveMarkdownView()
        : null;
    const view = activeView && activeView.editor === editor ? activeView : null;

    if (!this.isVimNormalModeEditor(editor, view)) {
      return 1;
    }

    const cm = this.resolveVimCodeMirror(editor, view);
    const pending = getPendingVimRepeat(cm);
    if (!pending.explicit) {
      return 1;
    }
    resetPendingVimInputState(cm, "counted-open-task-jump");
    return normalizeVimRepeat(pending.repeat);
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
    const timeoutId = setTimeout(() => {
      const current = guard.get(editor);
      if (!current) {
        return;
      }
      current.delete(direction);
      if (current.size === 0) {
        guard.delete(editor);
      }
    }, 0);
    this.register(() => clearTimeout(timeoutId));
  }

  // Capture-phase fallback so Ctrl+Shift+J/K reach the counted open-task jump
  // / planned-Pomodoro move route while Vim normal mode is active. CodeMirror
  // Vim swallows these chords before Obsidian's hotkey dispatcher runs, so the
  // hotkeys.json bindings only cover insert mode and non-Vim editing. A pending
  // numeric Vim prefix is an ordinary repeat (N positions / Nth target), not
  // "N additional items". The shared jump route also resolves a count when the
  // Obsidian command path arrives with no repeat (and in the live app wins this
  // race), so this fallback's reset is sometimes redundant and still correct
  // when it wins or when Obsidian's binding is absent. This mirrors
  // task-status-cycler's Ctrl+Shift+O handling and intentionally avoids a
  // `<C-S-j>`/`<C-S-k>` vim nmap, which could collapse onto and overwrite the
  // existing `<C-j>`/`<C-k>` section-header maps.
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

  registerCountedBulletPropertyInputListeners() {
    this.handledCountedBulletPropertyEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleCountedBulletPropertyPhysicalKeydown(event);
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

  registerCountedTaskMoveInputListeners() {
    this.handledCountedTaskMoveEvents = new WeakSet();
    const keydownHandler = (event) =>
      this.handleCountedTaskMovePhysicalKeydown(event);
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

  handleCountedTaskMovePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedTaskMoveKeydown(event)) {
      return false;
    }
    if (
      this.handledCountedTaskMoveEvents &&
      this.handledCountedTaskMoveEvents.has(event)
    ) {
      return false;
    }
    const view = this.getFocusedMarkdownEditorView(event);
    if (!view || !this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }
    const cm = this.resolveVimCodeMirror(view.editor, view);
    const pendingRepeat = getPendingVimRepeat(cm);
    if (this.handledCountedTaskMoveEvents) {
      this.handledCountedTaskMoveEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-task-move");
    this.openTaskMoveOrPomodoroBulletPicker(view.editor, view, {
      countExplicit: pendingRepeat.explicit,
      additionalTaskCount: pendingRepeat.explicit ? pendingRepeat.repeat : 0,
    });
    return true;
  }

  isCountedTaskMoveKeydown(event) {
    return Boolean(
      event &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "KeyM" || event.key === "m" || event.key === "M"),
    );
  }

  handleCountedBulletPropertyPhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
    if (!this.isCountedBulletPropertyKeydown(event)) {
      return false;
    }
    if (
      this.handledCountedBulletPropertyEvents &&
      this.handledCountedBulletPropertyEvents.has(event)
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

    if (this.handledCountedBulletPropertyEvents) {
      this.handledCountedBulletPropertyEvents.add(event);
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    resetPendingVimInputState(cm, "counted-bullet-property");
    return this.openBulletPropertyPicker(view.editor, {
      countExplicit: true,
      additionalTaskCount: pendingRepeat.repeat,
    });
  }

  isCountedBulletPropertyKeydown(event) {
    return Boolean(
      event &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "KeyP" || event.key === "p" || event.key === "P"),
    );
  }

  handleCountedTransclusionTogglePhysicalKeydown(event) {
    if (event && event.repeat) {
      return false;
    }
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

    resetPendingVimInputState(
      cm,
      pendingRepeat.explicit
        ? "counted-transclusion-toggle"
        : "transclusion-toggle",
    );
    return pendingRepeat.explicit
      ? this.toggleCountedLineTransclusions(
          view.editor,
          cursor,
          pendingRepeat.repeat,
        )
      : this.toggleCurrentLineTransclusions(view.editor);
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
    // handle the chord instead, without consuming a pending Vim count.
    if (!this.isVimNormalModeEditor(view.editor, view)) {
      return false;
    }

    const cm = this.resolveVimCodeMirror(view.editor, view);
    // Still read, reset, and pass an explicit repeat. The shared route also
    // resolves a count for the command path; this reset is then a no-op on
    // already-cleared state, and is still required when this fallback wins.
    const pendingRepeat = getPendingVimRepeat(cm);

    if (this.handledOpenTaskJumpEvents) {
      this.handledOpenTaskJumpEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    resetPendingVimInputState(
      cm,
      pendingRepeat.explicit ? "counted-open-task-jump" : "open-task-jump",
    );
    this.jumpToOpenObsidianTask(
      view.editor,
      direction,
      pendingRepeat.repeat,
    );
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
    if (!(cm.state && cm.state.vim) && mode === null) {
      return false;
    }
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
      // dash.md already focused: keep it fresh for capture, do not disturb scroll.
      this.cancelPendingDashTasksJump();
      this.cancelPendingDashLocationRestore();
      this.refreshDashScrollCaptureTarget(activeView);
      this.captureDashLocationFromView(activeView);
      return true;
    }

    this.captureActiveFilePosition();
    // Read the remembered location BEFORE opening: openFile makes dash active and
    // may overwrite this.dashLocation (via capture) with the fresh top-of-file state.
    const rememberedDashLocation = this.getRememberedDashLocation();

    try {
      const existingLeaf = this.findMarkdownLeafByPath(file.path);
      if (existingLeaf && (await this.activateWorkspaceLeaf(existingLeaf))) {
        // dash.md is already open in a tab; leave its live scroll untouched.
        this.cancelPendingDashTasksJump();
        this.cancelPendingDashLocationRestore();
        this.refreshDashScrollCaptureTarget();
        return true;
      }

      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      new Notice(`Could not open ${DASH_FILE_PATH}`);
      return false;
    }

    // Fresh open (dash.md was not already open in a tab): restore the remembered
    // scroll/cursor if we have one, otherwise jump to the Tasks section.
    this.refreshDashScrollCaptureTarget();

    if (rememberedDashLocation) {
      this.restoreOrDeferDashLocation(rememberedDashLocation);
    } else {
      this.jumpOrDeferDashTasks();
    }
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

  toggleCurrentTabPin() {
    const workspace = this.app && this.app.workspace;
    const activeLeaf = workspace && workspace.activeLeaf;
    if (!activeLeaf || typeof activeLeaf.togglePinned !== "function") {
      return false;
    }

    try {
      activeLeaf.togglePinned();
      return true;
    } catch (error) {
      return false;
    }
  }

  isWorkspaceLeafPinned(leaf) {
    if (!leaf || (typeof leaf !== "object" && typeof leaf !== "function")) {
      return false;
    }

    try {
      if (leaf.pinned) {
        return true;
      }
    } catch (error) {
      // Fall through to the view-state representations.
    }

    let viewState = null;
    try {
      viewState = this.getLeafViewState(leaf);
    } catch (error) {
      return false;
    }
    if (!viewState || typeof viewState !== "object") {
      return false;
    }

    try {
      if (viewState.pinned) {
        return true;
      }

      const state = viewState.state;
      return Boolean(state && typeof state === "object" && state.pinned);
    } catch (error) {
      return false;
    }
  }

  registerVimMappingsWhenReady() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.onLayoutReady !== "function") {
      return false;
    }

    workspace.onLayoutReady(() => {
      if (this.registerVimMappings()) {
        return;
      }

      if (typeof workspace.on !== "function") {
        return;
      }

      const ref = workspace.on("active-leaf-change", () => {
        if (
          this.registerVimMappings() &&
          typeof workspace.offref === "function"
        ) {
          workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });

    return true;
  }

  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    const vim = codeMirrorAdapter && codeMirrorAdapter.Vim;
    if (
      !vim ||
      typeof vim.defineAction !== "function" ||
      typeof vim.mapCommand !== "function"
    ) {
      return false;
    }

    vim.defineAction("bobNavigationToggleCurrentTabPin", () =>
      this.toggleCurrentTabPin(),
    );
    vim.mapCommand(
      "\\s",
      "action",
      "bobNavigationToggleCurrentTabPin",
      {},
      { context: "normal" },
    );

    this.vimMappingsRegistered = true;
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

    leavesToClose = leavesToClose.filter(
      (leaf) => !this.isWorkspaceLeafPinned(leaf),
    );
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
    this.cancelPendingDashLocationRestore();
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

  getRememberedDashLocation() {
    const remembered = normalizeDashLocation(this.dashLocation);
    if (remembered) {
      return remembered;
    }

    const sourcePosition = normalizePosition(
      this.filePositions.get(DASH_FILE_PATH),
    );
    return sourcePosition ? { sourcePosition } : null;
  }

  refreshDashScrollCaptureTarget(view = this.getActiveMarkdownView()) {
    const isDashView =
      view &&
      view.file &&
      view.file.path === DASH_FILE_PATH &&
      view.editor;
    const editorView = isDashView ? getEditorViewFromEditor(view.editor) : null;
    const scrollDOM = editorView && editorView.scrollDOM;

    if (scrollDOM && scrollDOM === this.activeDashScrollDOM) {
      return true;
    }

    this.clearDashScrollCaptureTarget();
    if (!scrollDOM || typeof scrollDOM.addEventListener !== "function") {
      return false;
    }

    const handler = () => this.scheduleDashLocationCapture();
    try {
      scrollDOM.addEventListener("scroll", handler, { passive: true });
    } catch (error) {
      scrollDOM.addEventListener("scroll", handler);
    }

    this.activeDashScrollDOM = scrollDOM;
    this.activeDashScrollHandler = handler;
    return true;
  }

  clearDashScrollCaptureTarget() {
    if (
      this.activeDashScrollDOM &&
      this.activeDashScrollHandler &&
      typeof this.activeDashScrollDOM.removeEventListener === "function"
    ) {
      try {
        this.activeDashScrollDOM.removeEventListener(
          "scroll",
          this.activeDashScrollHandler,
        );
      } catch (error) {
        // Best-effort cleanup only.
      }
    }

    this.activeDashScrollDOM = null;
    this.activeDashScrollHandler = null;
  }

  scheduleDashLocationCapture() {
    if (this.isRestoringDashLocation) {
      return false;
    }

    this.cancelPendingDashLocationCapture();
    this.pendingDashLocationCaptureDeferred = deferToNextFrame(() => {
      this.pendingDashLocationCaptureDeferred = null;
      if (!this.isRestoringDashLocation) {
        this.captureActiveDashLocation();
      }
    });

    return true;
  }

  cancelPendingDashLocationCapture() {
    cancelDeferred(this.pendingDashLocationCaptureDeferred);
    this.pendingDashLocationCaptureDeferred = null;
  }

  captureActiveDashLocation() {
    const view = this.getActiveMarkdownView();
    return this.captureDashLocationFromView(view);
  }

  captureDashLocationFromView(view, options = {}) {
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      return false;
    }

    if (this.isRestoringDashLocation && !options.force) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const sourcePosition =
      normalizePosition(options.position) ||
      (typeof view.editor.getCursor === "function"
        ? normalizePosition(view.editor.getCursor())
        : null) ||
      normalizePosition(this.filePositions.get(DASH_FILE_PATH));
    const location = {};

    if (sourcePosition) {
      location.sourcePosition = sourcePosition;
      this.filePositions.set(DASH_FILE_PATH, sourcePosition);
    }

    if (scrollDOM) {
      const scrollTop = finiteNumberOrNull(scrollDOM.scrollTop);
      const scrollLeft = finiteNumberOrNull(scrollDOM.scrollLeft);
      if (scrollTop !== null) {
        location.scrollTop = Math.max(0, scrollTop);
      }
      if (scrollLeft !== null) {
        location.scrollLeft = Math.max(0, scrollLeft);
      }

      const renderedTasksQuery = getDashboardRenderedTasksQuerySnapshot(
        editorView,
        scrollDOM,
      );
      if (renderedTasksQuery) {
        location.renderedTasksQuery = renderedTasksQuery;
      }
    }

    const normalized = normalizeDashLocation(location);
    if (!normalized) {
      return false;
    }

    this.dashLocation = normalized;
    return true;
  }

  restoreOrDeferDashLocation(
    location,
    retriesRemaining = DASH_LOCATION_RESTORE_RETRIES,
  ) {
    const normalized = normalizeDashLocation(location);
    if (!normalized) {
      return false;
    }

    this.cancelPendingDashTasksJump();
    this.cancelPendingDashLocationRestore();
    this.isRestoringDashLocation = true;
    const restoreState = {
      cursorApplied: false,
      rawScrollApplied: false,
      anchoredWriteSucceeded: false,
      assertFramesRemaining: 0,
      initialActivePath:
        this.app.workspace &&
        typeof this.app.workspace.getActiveFile === "function"
          ? this.app.workspace.getActiveFile()?.path || null
          : null,
      activeFileChanged: false,
    };
    return this.restoreOrDeferDashLocationInternal(
      normalized,
      retriesRemaining,
      restoreState,
    );
  }

  restoreOrDeferDashLocationInternal(
    location,
    retriesRemaining,
    restoreState,
  ) {
    const currentActivePath =
      this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()?.path || null
        : null;
    if (currentActivePath !== restoreState.initialActivePath) {
      restoreState.activeFileChanged = true;
    }
    const isAssertFrame =
      restoreState.anchoredWriteSucceeded &&
      restoreState.assertFramesRemaining > 0;
    if (isAssertFrame) {
      restoreState.assertFramesRemaining -= 1;
    }

    const result = this.restoreActiveDashLocation(location, restoreState);
    const needsInitialRetry =
      !restoreState.anchoredWriteSucceeded &&
      (!result.active || result.needsQueryRetry);
    const shouldRetry = needsInitialRetry && retriesRemaining > 0;
    const shouldAssert =
      restoreState.anchoredWriteSucceeded &&
      restoreState.assertFramesRemaining > 0;

    if (!shouldRetry && !shouldAssert) {
      this.isRestoringDashLocation = false;
      if (
        !result.active &&
        !restoreState.anchoredWriteSucceeded &&
        retriesRemaining <= 0 &&
        !restoreState.activeFileChanged
      ) {
        new Notice("No active markdown editor");
      }
      return result.applied;
    }

    this.pendingDashLocationRestoreDeferred = deferToNextFrame(() => {
      this.pendingDashLocationRestoreDeferred = null;
      this.restoreOrDeferDashLocationInternal(
        location,
        shouldRetry ? retriesRemaining - 1 : retriesRemaining,
        restoreState,
      );
    });

    return result.applied;
  }

  restoreActiveDashLocation(location, restoreState) {
    const normalized = normalizeDashLocation(location);
    const state = restoreState || {
      cursorApplied: false,
      rawScrollApplied: false,
      anchoredWriteSucceeded: false,
      assertFramesRemaining: 0,
    };
    const result = {
      active: false,
      applied: false,
      needsQueryRetry: false,
    };
    if (!normalized) {
      return result;
    }

    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      result.needsQueryRetry = !!normalized.renderedTasksQuery;
      return result;
    }

    result.active = true;
    this.refreshDashScrollCaptureTarget(view);

    if (normalized.sourcePosition && !state.cursorApplied) {
      const target = clampPositionToEditor(view.editor, normalized.sourcePosition);
      if (target && setEditorCursorWithoutScroll(view.editor, target)) {
        state.cursorApplied = true;
        this.filePositions.set(DASH_FILE_PATH, target);
        result.applied = true;
      }
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    if (!scrollDOM) {
      result.needsQueryRetry =
        !!normalized.renderedTasksQuery ||
        (!state.rawScrollApplied &&
          (normalized.scrollTop !== undefined ||
            normalized.scrollLeft !== undefined));
      return result;
    }

    if (
      !state.rawScrollApplied &&
      !state.anchoredWriteSucceeded &&
      (normalized.scrollTop !== undefined ||
        normalized.scrollLeft !== undefined)
    ) {
      const targetScrollTop =
        normalized.scrollTop !== undefined
          ? normalized.scrollTop
          : finiteNumberOrNull(scrollDOM.scrollTop) || 0;
      const targetScrollLeft =
        normalized.scrollLeft !== undefined
          ? normalized.scrollLeft
          : finiteNumberOrNull(scrollDOM.scrollLeft) || 0;
      if (setScrollDOMPosition(scrollDOM, targetScrollTop, targetScrollLeft)) {
        state.rawScrollApplied = true;
        result.applied = true;
      }
    }

    if (normalized.renderedTasksQuery) {
      const queryScrollTop = getDashboardQueryRestoreScrollTop(
        normalized.renderedTasksQuery,
        editorView,
        scrollDOM,
      );
      if (queryScrollTop === null) {
        result.needsQueryRetry = true;
        if (normalized.renderedTasksQuery.sourceLine !== null) {
          scrollEditorLineToTop(
            view.editor,
            normalized.renderedTasksQuery.sourceLine,
          );
        }
      } else if (
        setScrollDOMPosition(
          scrollDOM,
          queryScrollTop,
          normalized.scrollLeft !== undefined
            ? normalized.scrollLeft
            : finiteNumberOrNull(scrollDOM.scrollLeft) || 0,
        )
      ) {
        if (!state.anchoredWriteSucceeded) {
          state.anchoredWriteSucceeded = true;
          state.assertFramesRemaining = DASH_LOCATION_RESTORE_ASSERT_FRAMES;
        }
        result.applied = true;
        result.needsQueryRetry = false;
      }
    }

    this.dashLocation = normalized;
    return result;
  }

  cancelPendingDashLocationRestore() {
    cancelDeferred(this.pendingDashLocationRestoreDeferred);
    this.pendingDashLocationRestoreDeferred = null;
    this.isRestoringDashLocation = false;
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

  openTaskMoveOrPomodoroBulletPicker(editor, view, options = {}) {
    const cursor = getEditorCursor(editor);
    if (editor && typeof editor.getValue === "function" && cursor) {
      const sourceContent = String(editor.getValue() || "");
      if (findPomodoroBulletContext(sourceContent, cursor.line)) {
        return this.openPomodoroBulletMovePicker(editor, view, options);
      }
      if (findPomodoroEntryContext(sourceContent, cursor.line)) {
        return this.openPomodoroEntryMovePicker(editor, view, options);
      }
    }

    return this.openTaskMoveDestinationPicker(editor, view, options);
  }

  openPomodoroBulletMovePicker(editor, view, options = {}) {
    const activePicker = this.activeTaskMoveDestinationPicker;
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown Pomodoro note before moving bullets");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a Pomodoro sub-bullet");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverMovablePomodoroBulletTargets(
      sourceContent,
      cursor.line,
      options.additionalTaskCount || 0,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }

    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      discovery,
      entries: discovery.context.entries,
      sourceEntry: discovery.context.entry,
    });
    const picker = new PomodoroBulletMovePickerModal(
      this.app,
      this,
      session,
    );
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  openPomodoroEntryMovePicker(editor, view, options = {}) {
    const activePicker = this.activeTaskMoveDestinationPicker;
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown Pomodoro note before moving bullets");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a Pomodoro entry");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverPomodoroEntryMoveTargets(
      sourceContent,
      cursor.line,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }

    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      ignoredCount: Math.max(
        0,
        Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
      ),
      discovery,
      entries: discovery.context.entries,
      sourceEntry: discovery.context.entry,
    });
    const picker = new PomodoroEntryMovePickerModal(this.app, this, session);
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  openTaskMoveDestinationPicker(editor, view, options = {}) {
    const activePicker = this.activeTaskMoveDestinationPicker;
    if (activePicker) {
      const incomingCountExplicit = options.countExplicit === true;
      const activeCountExplicit = Boolean(
        activePicker.session && activePicker.session.countExplicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      new Notice("Open a Markdown task before moving tasks");
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      new Notice("Place the cursor on a real #task checkbox");
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const discovery = discoverMovableObsidianTaskTargets(
      sourceContent,
      cursor.line,
      options.additionalTaskCount || 0,
    );
    if (!discovery.valid) {
      new Notice(discovery.error);
      return false;
    }
    const ranges = buildTaskMoveRanges(sourceContent, discovery.targets);
    if (!ranges.valid) {
      new Notice(ranges.error);
      return false;
    }

    const vault = this.app && this.app.vault;
    const markdownFiles =
      vault && typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles()
        : [];
    const destinations = collectTaskMoveDestinations(
      markdownFiles,
      sourceFile.path,
      (file) => getFileChildNoteInfo(this.app, file, new Date()),
    );
    const scroll =
      typeof editor.getScrollInfo === "function"
        ? editor.getScrollInfo()
        : null;
    const session = Object.freeze({
      sourceFile,
      sourcePath: sourceFile.path,
      sourceView,
      editor,
      sourceContent,
      cursor: Object.freeze({ ...cursor }),
      scroll:
        scroll && typeof scroll === "object"
          ? Object.freeze({ left: scroll.left, top: scroll.top })
          : null,
      countExplicit: options.countExplicit === true,
      discovery,
      ranges: ranges.ranges,
    });
    const picker = new TaskMoveDestinationPickerModal(
      this.app,
      this,
      destinations,
      session,
    );
    this.activeTaskMoveDestinationPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeTaskMoveDestinationPicker === picker) {
        this.activeTaskMoveDestinationPicker = null;
      }
      throw error;
    }
    return true;
  }

  async getTaskMoveFileSnapshot(file) {
    if (!this.isMarkdownFile(file)) {
      throw new Error("Task move file is not Markdown");
    }
    const openEditor = this.getOpenMarkdownEditorForPath(file.path);
    if (openEditor && typeof openEditor.getValue === "function") {
      return Object.freeze({
        file,
        editor: openEditor,
        content: String(openEditor.getValue() || ""),
      });
    }
    if (!this.app.vault || typeof this.app.vault.cachedRead !== "function") {
      throw new Error("Vault content reads are unavailable");
    }
    return Object.freeze({
      file,
      editor: null,
      content: String((await this.app.vault.cachedRead(file)) || ""),
    });
  }

  async writeTaskMoveChange(path, change, file, session, finalCursor = null) {
    const sourceEditor =
      path === session.sourcePath ? session.editor : null;
    const editor = sourceEditor || this.getOpenMarkdownEditorForPath(path);
    if (editor && typeof editor.getValue === "function") {
      if (String(editor.getValue() || "") !== change.before) {
        throw new Error(`Task move preimage changed: ${path}`);
      }
      let applied = false;
      try {
        applied = applyEditorContentTransaction(
          editor,
          change.before,
          change.after,
          finalCursor,
        );
      } catch (error) {
        if (String(editor.getValue() || "") === change.after) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor,
            change,
          });
        }
        throw error;
      }
      if (!applied || String(editor.getValue() || "") !== change.after) {
        const error = new Error(`Task move editor transaction failed: ${path}`);
        if (String(editor.getValue() || "") === change.after) {
          error.taskMoveAppliedEntry = Object.freeze({ path, file, editor, change });
        }
        throw error;
      }
      return Object.freeze({ path, file, editor, change });
    }

    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      throw new Error("Vault content updates are unavailable");
    }
    let transformed = false;
    try {
      await vault.process(file, (content) => {
        if (String(content || "") !== change.before) {
          throw new Error(`Task move preimage changed: ${path}`);
        }
        transformed = true;
        return change.after;
      });
    } catch (error) {
      try {
        if (
          typeof vault.cachedRead === "function" &&
          String((await vault.cachedRead(file)) || "") === change.after
        ) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor: null,
            change,
          });
        }
      } catch (ignoredError) {
        // The original process error remains authoritative.
      }
      throw error;
    }
    if (!transformed) {
      throw new Error(`Task move file transaction failed: ${path}`);
    }
    return Object.freeze({ path, file, editor: null, change });
  }

  async rollbackTaskMoveChanges(written) {
    const failedPaths = [];
    for (const entry of (Array.isArray(written) ? written : []).slice().reverse()) {
      const editor =
        (entry.editor && typeof entry.editor.getValue === "function"
          ? entry.editor
          : this.getOpenMarkdownEditorForPath(entry.path));
      try {
        if (editor) {
          if (String(editor.getValue() || "") !== entry.change.after) {
            throw new Error("postimage changed");
          }
          if (
            !applyEditorContentTransaction(
              editor,
              entry.change.after,
              entry.change.before,
            ) ||
            String(editor.getValue() || "") !== entry.change.before
          ) {
            throw new Error("editor rollback failed");
          }
          continue;
        }
        let restored = false;
        await this.app.vault.process(entry.file, (content) => {
          if (String(content || "") !== entry.change.after) {
            throw new Error("postimage changed");
          }
          restored = true;
          return entry.change.before;
        });
        if (!restored) {
          throw new Error("file rollback failed");
        }
      } catch (error) {
        failedPaths.push(entry.path);
      }
    }
    return failedPaths;
  }

  restoreTaskMoveSourceContext(session) {
    const editor = session && session.editor;
    if (!editor) {
      return;
    }
    if (session.scroll && typeof editor.scrollTo === "function") {
      try {
        editor.scrollTo(session.scroll.left, session.scroll.top);
      } catch (error) {
        // Viewport restoration is best-effort after the guarded transaction.
      }
    }
    if (typeof editor.focus === "function") {
      try {
        editor.focus();
      } catch (error) {
        // The source leaf is already active; focus is a final nicety.
      }
    }
  }

  async commitPomodoroBulletMoveSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was moved");
      return false;
    }

    let destination;
    let destinationLabel;
    if (row && row.kind === "existing") {
      destination = {
        kind: "existing",
        entryLine: row.entry && row.entry.entryLine,
      };
      destinationLabel = getPomodoroBulletMoveDestinationLabel(row.entry);
    } else if (row && row.kind === "new") {
      destination = { kind: "new", name: row.name };
      destinationLabel = row.name;
    } else {
      return false;
    }

    const plan = planPomodoroBulletMove(session.sourceContent, {
      targets: session.discovery.targets,
      sourceEntryLine: session.discovery.entryLine,
      destination,
    });
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    const firstMovedLine = Math.min(
      Math.max(
        Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0,
        0,
      ),
      Math.max(afterLines.length - 1, 0),
    );
    const sourceCursor = normalizePosition(session.cursor) || {
      line: firstMovedLine,
      ch: 0,
    };
    const finalCursor = {
      line: firstMovedLine,
      ch: Math.min(
        sourceCursor.ch,
        String(afterLines[firstMovedLine] || "").length,
      ),
    };

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice("Pomodoro bullet move failed; nothing was moved");
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(
      buildPomodoroBulletMoveNotice(
        plan,
        session.discovery,
        destinationLabel,
      ),
    );
    return true;
  }

  async commitPomodoroEntryMoveSession(session, row) {
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !session.editor ||
      typeof session.editor.getValue !== "function" ||
      !activeView ||
      !activeView.file ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      String(session.editor.getValue() || "") !== session.sourceContent
    ) {
      new Notice("Source note is no longer active; nothing was moved");
      return false;
    }

    const isRename = Boolean(row && row.kind === "rename");
    const isMove = Boolean(row && row.kind === "existing");
    if (!isRename && !isMove) {
      return false;
    }

    const sourceEntryLine = session.discovery.entryLine;
    const sourceRawLine = session.discovery.rawEntryLine;
    const destinationLabel = isMove
      ? getPomodoroBulletMoveDestinationLabel(row.entry)
      : null;
    const plan = isMove
      ? planPomodoroBulletMove(session.sourceContent, {
          scope: "entry",
          targets: session.discovery.targets,
          sourceEntryLine,
          sourceRawLine,
          destination: {
            kind: "existing",
            entryLine: row.entry && row.entry.entryLine,
          },
        })
      : planPomodoroEntryRename(session.sourceContent, {
          sourceEntryLine,
          sourceRawLine,
          name: row.name,
        });

    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }
    if (isRename && plan.unchanged) {
      new Notice(
        `Pomodoro #${session.sourceEntry.position} is already named ${plan.name}`,
      );
      return false;
    }

    const afterLines = splitMarkdownContent(plan.after).lines;
    let finalCursor;
    if (isMove) {
      const firstMovedLine = Math.min(
        Math.max(
          Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0,
          0,
        ),
        Math.max(afterLines.length - 1, 0),
      );
      const sourceCursor = normalizePosition(session.cursor) || {
        line: firstMovedLine,
        ch: 0,
      };
      finalCursor = {
        line: firstMovedLine,
        ch: Math.min(
          sourceCursor.ch,
          String(afterLines[firstMovedLine] || "").length,
        ),
      };
    } else {
      const sourceCursor = normalizePosition(session.cursor) || {
        line: sourceEntryLine,
        ch: 0,
      };
      finalCursor = {
        line: sourceEntryLine,
        ch: Math.min(
          sourceCursor.ch,
          String(afterLines[sourceEntryLine] || "").length,
        ),
      };
    }

    let applied = false;
    try {
      applied = applyEditorContentTransaction(
        session.editor,
        session.sourceContent,
        plan.after,
        finalCursor,
      );
    } catch (error) {
      applied = String(session.editor.getValue() || "") === plan.after;
    }
    if (!applied || String(session.editor.getValue() || "") !== plan.after) {
      new Notice(
        isRename
          ? "Pomodoro rename failed; nothing was changed"
          : "Pomodoro entry move failed; nothing was moved",
      );
      return false;
    }

    this.restoreTaskMoveSourceContext(session);
    new Notice(
      isRename
        ? `Renamed Pomodoro #${session.sourceEntry.position} to ${plan.name}`
        : buildPomodoroEntryMoveNotice(plan, session.discovery, destinationLabel),
    );
    return true;
  }

  async commitTaskMoveSession(session, destinationEntry) {
    const destinationFile = destinationEntry && destinationEntry.file;
    const activeView = this.getActiveMarkdownView();
    if (
      !session ||
      !activeView ||
      activeView.file.path !== session.sourcePath ||
      activeView.editor !== session.editor ||
      !this.isMarkdownFile(destinationFile)
    ) {
      new Notice("Source task note is no longer active; nothing was moved");
      return false;
    }
    if (
      destinationFile.path === session.sourcePath ||
      TASK_MOVE_TEMPLATE_PATHS.has(destinationFile.path)
    ) {
      new Notice("Selected task destination is not eligible");
      return false;
    }
    if (String(session.editor.getValue() || "") !== session.sourceContent) {
      new Notice("A selected task changed while the destination picker was open");
      return false;
    }

    const vault = this.app && this.app.vault;
    if (
      !vault ||
      typeof vault.getMarkdownFiles !== "function" ||
      typeof vault.process !== "function"
    ) {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    const snapshots = new Map();
    const filesByPath = new Map();
    try {
      for (const file of vault.getMarkdownFiles()) {
        if (!this.isMarkdownFile(file)) {
          continue;
        }
        const snapshot = await this.getTaskMoveFileSnapshot(file);
        snapshots.set(file.path, snapshot.content);
        filesByPath.set(file.path, file);
      }
    } catch (error) {
      new Notice("Could not read every affected note; nothing was moved");
      return false;
    }
    if (
      snapshots.get(session.sourcePath) !== session.sourceContent ||
      !snapshots.has(destinationFile.path)
    ) {
      new Notice("Task move source or destination changed; nothing was moved");
      return false;
    }

    const destinationContent = snapshots.get(destinationFile.path);
    const otherContents = new Map(snapshots);
    otherContents.delete(session.sourcePath);
    otherContents.delete(destinationFile.path);
    const plan = planTaskMoveAcrossFiles({
      sourcePath: session.sourcePath,
      destinationPath: destinationFile.path,
      sourceContent: session.sourceContent,
      destinationContent,
      otherContents,
      targets: session.discovery.targets,
    });
    if (!plan.valid) {
      new Notice(`${plan.error}; nothing was moved`);
      return false;
    }

    const sourceChange = plan.changes.get(session.sourcePath);
    const sourceLines = splitMarkdownContent(sourceChange.after).lines;
    const sourceLine = Math.min(
      plan.nextSourceLine,
      Math.max(sourceLines.length - 1, 0),
    );
    const finalCursor = {
      line: sourceLine,
      ch: Math.min(
        session.cursor.ch,
        String(sourceLines[sourceLine] || "").length,
      ),
    };
    const auxiliaryPaths = Array.from(plan.changes.keys())
      .filter(
        (path) =>
          path !== destinationFile.path && path !== session.sourcePath,
      )
      .sort();
    const writeOrder = [
      destinationFile.path,
      ...auxiliaryPaths,
      session.sourcePath,
    ];
    const written = [];
    try {
      for (const path of writeOrder) {
        const change = plan.changes.get(path);
        if (!change || change.before === change.after) {
          continue;
        }
        if (
          path === session.sourcePath &&
          (this.getActiveMarkdownView()?.editor !== session.editor ||
            String(session.editor.getValue() || "") !== change.before)
        ) {
          throw new Error("Source editor changed before final removal");
        }
        const file = filesByPath.get(path);
        if (!this.isMarkdownFile(file)) {
          throw new Error(`Affected Markdown file disappeared: ${path}`);
        }
        written.push(
          await this.writeTaskMoveChange(
            path,
            change,
            file,
            session,
            path === session.sourcePath ? finalCursor : null,
          ),
        );
      }
    } catch (error) {
      if (
        error &&
        error.taskMoveAppliedEntry &&
        !written.some((entry) => entry.path === error.taskMoveAppliedEntry.path)
      ) {
        written.push(error.taskMoveAppliedEntry);
      }
      const failedRollbacks = await this.rollbackTaskMoveChanges(written);
      this.restoreTaskMoveSourceContext(session);
      if (failedRollbacks.length > 0) {
        new Notice(
          `Task move could not finish; recoverable duplicates may need repair in ${failedRollbacks.join(", ")}`,
        );
      } else {
        new Notice("Task move failed; completed writes were rolled back and source tasks were retained");
      }
      return false;
    }

    await this.focusTaskMoveDestination(destinationFile, {
      line: plan.destinationLine,
      text: plan.destinationAnchorText,
      blockId: plan.destinationBlockId,
    });
    const count = session.discovery.actualCount;
    const destinationName =
      destinationFile.basename ||
      getVaultPathBasenameWithoutExtension(destinationFile.path);
    const clamped = session.discovery.clamped
      ? ` (requested ${session.discovery.requestedCount}; reached end of note)`
      : "";
    new Notice(
      `Moved ${count} task${count === 1 ? "" : "s"} to ${destinationName}${clamped}`,
    );
    return true;
  }

  async focusTaskMoveDestination(file, anchor) {
    this.captureActiveFilePosition();

    const destinationName =
      file.basename || getVaultPathBasenameWithoutExtension(file.path);
    const opened = await this.openMarkdownFileWithLeafReuse(
      file,
      `Moved tasks, but could not open ${destinationName}`,
    );
    if (!opened) {
      return false;
    }

    return this.jumpOrDeferTaskMoveDestination(file.path, anchor);
  }

  jumpOrDeferTaskMoveDestination(
    path,
    anchor,
    retriesRemaining = TASK_MOVE_DESTINATION_JUMP_RETRIES,
  ) {
    this.cancelPendingTaskMoveJump();

    if (this.jumpToActiveTaskMoveDestination(path, anchor)) {
      return true;
    }

    if (retriesRemaining <= 0) {
      return false;
    }

    this.pendingTaskMoveJumpDeferred = deferToNextFrame(() => {
      this.pendingTaskMoveJumpDeferred = null;
      this.jumpOrDeferTaskMoveDestination(path, anchor, retriesRemaining - 1);
    });

    return false;
  }

  jumpToActiveTaskMoveDestination(path, anchor) {
    const view = this.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== path ||
      !view.editor ||
      typeof view.editor.getValue !== "function"
    ) {
      return false;
    }

    const resolved = resolveTaskMoveDestinationLine(
      view.editor.getValue(),
      anchor,
    );
    if (!setEditorCursor(view.editor, { line: resolved.line, ch: 0 })) {
      return false;
    }

    scheduleOpenTaskJumpCenter(this, view.editor, resolved.line, 0);
    return true;
  }

  cancelPendingTaskMoveJump() {
    cancelDeferred(this.pendingTaskMoveJumpDeferred);
    this.pendingTaskMoveJumpDeferred = null;
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

    if (
      isProjectLifecycleTaskLine(lineText) &&
      isProjectLifecycleTaskAtLine(editor.getValue(), cursor.line)
    ) {
      return this.convertProjectNoteToTask(editor, view, cursor, lineText);
    }

    const parsedTask = parseProjectSourceTaskLine(lineText);
    if (!parsedTask) {
      new Notice(getProjectSourceTaskLineNoticeText(lineText));
      return false;
    }
    if (parsedTask.scheduleError) {
      new Notice(parsedTask.scheduleError);
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
    let convertedChildSections = [];
    let convertedScheduleLogLines = [];
    let childConversionLossy = false;
    const hasChildContent = sourceBlock.childLines.some(
      (line) => String(line || "").trim() !== "",
    );
    if (hasChildContent) {
      const conversion = buildProjectSeedFromChildBullets(
        sourceBlock.childLines,
        createdDate,
      );
      if (
        conversion.lossless &&
        (conversion.taskLines.length > 0 ||
          conversion.sections.length > 0 ||
          conversion.scheduleLogLines.length > 0)
      ) {
        convertedChildTaskLines = conversion.taskLines;
        convertedChildSections = conversion.sections;
        convertedScheduleLogLines = conversion.scheduleLogLines;
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
      parsedTask.scheduled,
    );
    if (!createdFile) {
      return false;
    }

    let seedResult = null;
    try {
      await this.app.vault.process(createdFile, (content) => {
        seedResult = buildProjectContentFromTask(content, parsedTask, {
          childTaskLines: convertedChildTaskLines,
          sections: convertedChildSections,
          scheduleLogLines: convertedScheduleLogLines,
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

    if (
      convertedScheduleLogLines.length > 0 &&
      !seedResult.scheduleLogInserted
    ) {
      new Notice(
        "Created project, but the schedule log could not be added; source task was kept",
      );
      return true;
    }

    const sectionsHandled =
      (seedResult.sectionsInserted || 0) + (seedResult.sectionsCreated || 0);
    if (
      convertedChildSections.length > 0 &&
      sectionsHandled < convertedChildSections.length
    ) {
      new Notice(
        "Created project, but a section could not be added; source task was kept",
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
        sectionsHandled,
        convertedScheduleLogLines.length > 0,
      ),
    );
    return true;
  }

  async convertProjectNoteToTask(editor, view, cursor, lineText) {
    const vault = this.app && this.app.vault;
    if (
      !vault ||
      typeof vault.process !== "function" ||
      typeof vault.read !== "function"
    ) {
      new Notice("Vault content updates are unavailable");
      return false;
    }

    if (!view || typeof view.save !== "function") {
      new Notice("Could not save project note");
      return false;
    }

    try {
      await view.save();
    } catch (error) {
      new Notice("Could not save project note");
      return false;
    }

    const sourceFile = view.file;
    const content = editor.getValue();
    const noteBasename =
      (sourceFile && sourceFile.basename) ||
      getVaultPathBasenameWithoutExtension(sourceFile && sourceFile.path);
    const built = buildTaskBlockFromProjectNote(content, { noteBasename });
    if (!built.valid) {
      new Notice(built.error);
      return false;
    }

    if (!isProjectFrontmatterParentLink(built.parentLink)) {
      new Notice("Project note has no parent link");
      return false;
    }

    const parentTarget = this.extractLinkTarget(built.parentLink);
    if (!parentTarget) {
      new Notice("Project note has no parent link");
      return false;
    }

    const parentFile = this.resolveLinkTargetFile(
      parentTarget,
      sourceFile && sourceFile.path,
    );
    const parentDisplay = this.basenameForRenderedWikiLink(parentTarget);
    if (!this.isMarkdownFile(parentFile)) {
      new Notice(`Parent note "${parentDisplay}" not found`);
      return false;
    }

    if (parentFile.path === sourceFile.path) {
      new Notice("Project note parent points at itself");
      return false;
    }

    const children = this.collectChildNotes(sourceFile);
    if (children.length > 0) {
      new Notice(
        `Project has ${children.length} child notes; move them before converting`,
      );
      return false;
    }

    const parentBasename =
      parentFile.basename ||
      getVaultPathBasenameWithoutExtension(parentFile.path);
    const restored = buildTaskBlockFromProjectNote(content, {
      noteBasename,
      parentBasename,
    });
    if (!restored.valid) {
      new Notice(restored.error);
      return false;
    }

    let parentContent;
    try {
      parentContent = await vault.read(parentFile);
    } catch (error) {
      new Notice(`Parent note "${parentBasename}" not found`);
      return false;
    }

    const destination = parseTaskMoveDestinationFrontmatter(parentContent);
    if (!destination.valid) {
      new Notice(
        `Parent note "${parentBasename}" must be an area or open project`,
      );
      return false;
    }

    if (restored.blockId) {
      const existingIds = collectTaskMoveBlockIds(parentContent);
      if (existingIds.has(restored.blockId)) {
        new Notice(
          `Parent note already contains block ID: ${restored.blockId}`,
        );
        return false;
      }
    }

    const insertion = insertTaskMoveBlocks(
      parentContent,
      [restored.lines],
      destination.kind,
    );
    if (!insertion.valid) {
      new Notice(
        `Parent note "${parentBasename}" has no ## Tasks section`,
      );
      return false;
    }

    const classification = this.getProjectNoteBacklinkClassification(
      sourceFile,
      parentFile.path,
    );
    if (classification.otherPaths.length > 0) {
      new Notice(
        `${classification.otherPaths.length} notes link to "${noteBasename}"; update them before converting (first: ${classification.otherPaths[0]})`,
      );
      return false;
    }
    if (classification.blockRewrites.length > 0 && !restored.blockId) {
      new Notice(
        "Could not derive a task block ID for the links that point at ^prj",
      );
      return false;
    }

    let wroteParent = false;
    try {
      await vault.process(parentFile, (current) => {
        if (current !== parentContent) {
          return current;
        }
        wroteParent = true;
        return insertion.content;
      });
    } catch (error) {
      new Notice("Could not update the parent note");
      return false;
    }

    if (!wroteParent) {
      new Notice("Parent note changed; nothing was converted");
      return false;
    }

    let updatedLinkCount = 0;
    if (classification.blockRewrites.length > 0) {
      const rewriteResult = await this.applyBlockIdLinkRewrites(
        classification.blockRewrites,
        parentBasename,
        restored.blockId,
      );
      updatedLinkCount = rewriteResult.updatedLinkCount;
      if (rewriteResult.failed) {
        const failed = rewriteResult.failedLinkCount;
        new Notice(
          `Restored the task in ${parentBasename}, but ${failed} links could not be updated; "${noteBasename}" was kept`,
        );
        return true;
      }
    }

    await this.focusTaskMoveDestination(parentFile, {
      line: insertion.insertedLine,
      text: restored.lines[0],
      blockId: restored.blockId,
    });

    try {
      if (
        !this.app.fileManager ||
        typeof this.app.fileManager.trashFile !== "function"
      ) {
        throw new Error("trash unavailable");
      }
      await this.app.fileManager.trashFile(sourceFile);
    } catch (error) {
      new Notice(
        `Restored the task in ${parentBasename}, but could not delete "${noteBasename}"`,
      );
      return true;
    }

    new Notice(
      getProjectNoteToTaskNoticeText(
        noteBasename,
        parentBasename,
        restored.taskCount,
        restored.sectionCount,
        updatedLinkCount,
      ),
    );
    return true;
  }

  async createProjectNoteFile(creatingFile, basename, scheduled = null) {
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
          applyProjectCreationFrontmatter(
            frontmatter,
            parentLink,
            scheduled,
          );
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

  getProjectNoteBacklinkClassification(file, parentPath) {
    const empty = Object.freeze({
      blockRewrites: Object.freeze([]),
      otherPaths: Object.freeze([]),
    });
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return empty;
    }

    try {
      const backlinks = metadataCache.getBacklinksForFile(file);
      const classified = collectProjectNoteBacklinkClassification(
        backlinks && backlinks.data,
        parentPath,
      );
      const filePath = normalizeVaultRelativePath(file && file.path);
      return Object.freeze({
        blockRewrites: classified.blockRewrites,
        otherPaths: Object.freeze(
          classified.otherPaths.filter((path) => path !== filePath),
        ),
      });
    } catch (error) {
      return empty;
    }
  }

  async applyBlockIdLinkRewrites(rewrites, newBasename, blockId = "prj") {
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
        const replacement = rewriteBlockIdLinkOriginal(
          original,
          newBasename,
          blockId,
        );
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
      this.clearDashScrollCaptureTarget();
      return;
    }

    if (file.path === this.currentFilePath) {
      this.refreshDashScrollCaptureTarget();
      return;
    }

    if (this.currentFilePath) {
      this.alternateFilePath = this.currentFilePath;
    }
    this.currentFilePath = file.path;
    this.refreshDashScrollCaptureTarget();
  }

  trackSelectionUpdate(update) {
    if (
      !update ||
      (!update.selectionSet && !update.docChanged && !update.viewportChanged)
    ) {
      return;
    }

    const view = this.getActiveMarkdownView();
    if (!view || !view.file || !view.editor) {
      return;
    }

    if (update.view && view.editor.cm && view.editor.cm !== update.view) {
      return;
    }

    const position =
      update.selectionSet || update.docChanged
        ? positionFromCodeMirrorUpdate(update)
        : null;
    if (position) {
      this.saveFilePosition(view.file.path, position);
    }

    if (view.file.path === DASH_FILE_PATH) {
      this.refreshDashScrollCaptureTarget(view);
      this.captureDashLocationFromView(view, { position });
    }
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
  FilteredPickerModal,
  TaskMoveDestinationPickerModal,
  PomodoroBulletMovePickerModal,
  PomodoroEntryMovePickerModal,
  BulletPropertyPickerModal,
  finiteNumberOrNull,
  clampNumber,
  normalizePosition,
  clampPositionToEditor,
  getEditorViewFromEditor,
  getElementRect,
  getVerticalIntersectionHeight,
  getScrollDOMMaxScrollTop,
  getScrollDOMMaxScrollLeft,
  setScrollDOMPosition,
  getRenderedTasksQueryContexts,
  findDashboardRenderedTasksQueryContext,
  getDashboardRenderedTasksQuerySnapshot,
  normalizeDashboardRenderedTasksQuerySnapshot,
  normalizeDashLocation,
  getDashboardQueryRestoreScrollTop,
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
  dependencyId,
  validateDependencyId,
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
  validateProjectScheduledDate,
  extractProjectSourceSchedule,
  parseProjectSourceTaskLine,
  getProjectSourceTaskBlock,
  parseProjectChildListItem,
  buildProjectTaskLineFromChildBullet,
  normalizeProjectSectionNoteLine,
  normalizeProjectScheduleLogLine,
  indentProjectReversalLine,
  getProjectReversalBlockId,
  formatProjectReversalSectionTitle,
  parseProjectLifecycleTaskBody,
  getProjectFrontmatterCreatedDate,
  buildTaskLineFromProjectNote,
  splitProjectNoteForReversal,
  buildTaskBlockFromProjectNote,
  getProjectNoteToTaskNoticeText,
  formatProjectSectionTitle,
  parseProjectSectionBulletTitle,
  normalizeProjectSectionTitle,
  buildProjectSeedFromChildBullets,
  formatProjectTaskCreatedDate,
  findProjectLifecycleTaskIndex,
  insertProjectScheduleLogLines,
  replaceProjectTasksPlaceholder,
  findProjectSectionRange,
  insertProjectSectionNotes,
  buildProjectContentFromTask,
  applyProjectCreationFrontmatter,
  removeTaskBlockFromContent,
  getProjectBasenameFromTaskBlockId,
  getProjectBasenameSuffixForIndex,
  getNextDefaultProjectBasename,
  collectBlockIdBacklinkRewrites,
  collectProjectNoteBacklinkClassification,
  rewriteBlockIdLinkOriginal,
  replaceLinkOriginalsInContent,
  getProjectFromTaskNoticeText,
  getFutureProjectSchedule,
  isFutureInlineScheduledValue,
  getProjectNoteInfo,
  getChildNoteInfo,
  getChildNoteSummary,
  getChildNoteSearchText,
  getNoteTemplateForCreationPath,
  findLinkSubpathIndex,
  getLinkSubpath,
  isSubpathOnlyLink,
  getSectionHeaderLines,
  getSectionHeaderJumpLine,
  isObsidianTaskLine,
  isObsidianTaskAtLine,
  getObsidianTaskCheckboxStatus,
  getObsidianTaskStatusRank,
  getDependencyPromotionStatus,
  promoteObsidianTaskCheckboxStatus,
  blockObsidianTaskCheckboxStatus,
  replaceObsidianTaskCheckboxStatus,
  parseTasksStatusRegistry,
  parseTrailingRecoveryTaskMetadata,
  parseScheduledRecoveryTaskLine,
  parseRecoveryTransclusion,
  recoveryBlockReferences,
  recentPomodoroReferences,
  canonicalRecoveryDailyDate,
  scheduledRecoveryDailyPaths,
  createScheduledRecoveryNoteIndex,
  resolveScheduledRecoveryNote,
  computeScheduledRecoveryRanks,
  buildScheduledRecoveryIndex,
  getScheduledRecoveryMetadata,
  buildInteractiveScheduledRecoverySnapshot,
  reconcileBlockedScheduledTaskLine,
  scheduledRecoveryNoticeParts,
  scheduledRecoveryNoticeSuffix,
  getCountedTaskNoticeParts,
  getCountedTaskNoticeSuffix,
  getMarkdownLineContexts,
  isOpenObsidianTaskLine,
  isActiveObsidianTaskNavigationLine,
  isPomodorosHeading,
  isLevelTwoHeading,
  hasPomodoroTimeRange,
  isPomodoroNavigationTaskLine,
  POMODORO_LEDGER_CLOSED_STATUSES,
  isOpenPomodoroLedgerEntryLine,
  findPomodorosSectionRange,
  collectOpenPomodoroRanges,
  collectPomodoroBlockLinkOccurrences,
  pomodoroBulletBodyBounds,
  isDedicatedPomodoroLinkLine,
  POMODORO_NAME_MAX_LENGTH,
  parsePomodoroEntryLine,
  normalizePomodoroName,
  formatPomodoroEntryLine,
  collectPomodoroEntries,
  findPomodoroBulletContext,
  findPomodoroEntryContext,
  discoverMovablePomodoroBulletTargets,
  discoverPomodoroEntryMoveTargets,
  capturePomodoroBulletSubtree,
  removePomodoroBulletRanges,
  rebasePomodoroBulletBlock,
  planPomodoroBulletMove,
  planPomodoroEntryRename,
  isMovablePomodoroEntryContext,
  planPomodoroEntryReorder,
  getPomodoroBulletMoveDestinationLabel,
  createPomodoroBulletMovePickerRows,
  buildPomodoroBulletMoveNotice,
  buildPomodoroEntryMoveNotice,
  deferredPomodoroTargetsFromLines,
  planDeferredPomodoroLinkCleanup,
  getOpenObsidianTaskLines,
  getOpenTaskNavigationLines,
  getOpenObsidianTaskJumpLine,
  getDashTasksHeaderLine,
  openMarkdownFileWithLeafReuse,
  getEditorCursor,
  getEditorLine,
  setEditorCursorWithoutScroll,
  scrollEditorLineToTop,
  scrollEditorLineToCenter,
  scheduleOpenTaskJumpCenter,
  scheduleDashTasksScrollAssert,
  replaceEditorLine,
  replaceEditorContent,
  setEditorCursorSafely,
  findTransclusionToggleTargets,
  toggleLineTransclusions,
  toggleLineRangeTransclusions,
  findDependencyToggleParent,
  findTaskLineByBlockId,
  planSameFileDependencyToggle,
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
  isProjectLifecycleTaskLine,
  isProjectLifecycleTaskAtLine,
  parseProjectNoteFrontmatter,
  getProjectNotePropertyContext,
  resolveBulletPropertyTarget,
  getBulletPropertyCurrentLabel,
  createBulletPropertyItems,
  discoverCountedObsidianTaskTargets,
  discoverMovableObsidianTaskTargets,
  validateCountedTaskSession,
  parseTaskMoveContainerPrefix,
  parseTaskMoveListItem,
  taskMoveLineIsDescendant,
  captureTaskMoveSubtree,
  buildTaskMoveRanges,
  removeTaskMoveRanges,
  rebaseTaskMoveBlock,
  flattenTaskMoveBlocks,
  parseTaskMoveDestinationFrontmatter,
  collectTaskMoveDestinations,
  insertTaskMoveBlocks,
  collectTaskMoveBlockIds,
  prepareTaskMoveBlockIdentities,
  rewriteTaskMoveBlockLinks,
  rewriteTaskMoveReferences,
  planTaskMoveAcrossFiles,
  resolveTaskMoveDestinationLine,
  createCountedBulletPropertyItems,
  validateDependencyParentForEditor,
  getWholeTaskTagSpans,
  hasWholeTaskTag,
  normalizeProjectLifecycleHideTag,
  parseProjectTaskScheduledFields,
  getRealMarkdownTaskLines,
  getProjectScheduleRecoveryTargetLines,
  planProjectTaskSchedules,
  removeAllBulletProperties,
  planProjectScheduledUpdate,
  planProjectScheduledDelete,
  isDueInlineScheduledValue,
  planCountedBulletPropertyBatch,
  planCountedLocalTaskDependency,
  getLocalDayOffset,
  formatRelativeDayOffset,
  formatRelativeDayRange,
  getPriorityLevelIconName,
  rollPriorityScheduledDateWithOffset,
  rollPriorityScheduledDate,
  getPriorityNoticeOutcomeParts,
  getPriorityNoticeChipTone,
  getPriorityNoticeChipText,
  buildPriorityNoticeModel,
  formatPriorityNoticeText,
  renderPriorityNoticeFragment,
  showPriorityNotice,
  createBulletPropertyDateItems,
  createPriorityRollDateItem,
  createBulletPropertyValueItems,
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
  rewriteDependsOnIdsInLine,
  rewriteDependsOnIdsInContent,
  tryDependencyId,
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
  parseDependencyTransclusionBulletDetails,
  getDependencyNavigationBlockIds,
  parseDependencyNavigationBullet,
  parseDependencyNavigationBulletDetails,
  findCurrentBulletChildBlock,
  getDependencyChildIndent,
  SCHEDULE_LOG_EMOJI,
  SCHEDULE_LOG_LABEL,
  formatScheduleLogParentBullet,
  formatScheduleLogEntryText,
  formatScheduleLogEntryBullet,
  parseScheduleLogParentBullet,
  parseScheduleLogEntryBullet,
  normalizeScheduleReasonText,
  findScheduleLogParent,
  getScheduleLogEntryIndent,
  planScheduleLogEntry,
  applyScheduleLogEntryToLines,
  hasScheduleLogReasonInput,
  getScheduleLogWriteOutcome,
  formatPriorityRollWindowText,
  getPriorityRollFromLevelLabel,
  formatPriorityRollScheduleReason,
  shouldWriteAutomaticScheduleLog,
  buildPriorityRollScheduleLog,
  getBulletPropertyScheduleReasonHints,
  collectDependencyNavigationBullets,
  computeFinalDependencyLinkOrder,
  planDependencyNavigationBulletSync,
  planDependencyNavigationBulletInsertion,
  planDependencyNavigationBulletRemoval,
  planDependencyNavigationLabelNormalizations,
  normalizeDependencyNavigationLabels,
  transformDependencyBulletsInContent,
  buildLocalTaskDependencyNotice,
  buildMultiDependencyNotice,
  applyEditorContentTransaction,
  insertEditorLine,
  deleteEditorLine,
};
