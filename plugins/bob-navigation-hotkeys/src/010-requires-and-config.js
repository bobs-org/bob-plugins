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
// `plugins/bob-ledger-tools/src/010-load-and-constants.js` conventions needed to recognize open or done Pomodoro lines
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
// File-aware Vim jump history for Enter link jumps (see plan
// 202610/obsidian_enter_vim_jump_history.md). Kept distinct from
// `filePositions`, alternate-file navigation, and Obsidian workspace history.
// Bounded to 100 locations, matching upstream CodeMirror Vim's jump-list size.
const VIM_JUMP_HISTORY_LIMIT = 100;
const VIM_JUMP_HISTORY_DESTINATION_RETRIES = 24;
const VIM_JUMP_HISTORY_COMPATIBILITY_NOTICE =
  "Vim jump history unavailable: Obsidian Vim adapter has no jump list; link jumps still open but Ctrl+O/Ctrl+I use Vim defaults";
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
// Depends-On line grammar. `docs/task-dependencies.md` §2 in bob-cli is
// authoritative; this block is its navigation-hotkeys mirror. The writer form
// is `⛓️ **DEPENDS ON:** [[...]] • [[...]]`: plain, never transcluded links
// in addition order on one first-child line. Readers tolerate the legacy `🔗`
// emoji, a missing emoji, the `DEPENDENCIES` label, `·` / `,` / whitespace
// separators, and aliased / struck / `!`-embedded links; writers canonicalise
// all of them. Sole block-link children (plain, `![[…]]`, `~~[[…]]~~`) are
// the R8 legacy form and are read, never written.
const DEPENDENCY_NAVIGATION_LABEL = "DEPENDS ON";
const DEPENDENCY_NAVIGATION_EMOJI = "⛓️";
const DEPENDENCY_NAVIGATION_SEPARATOR = " • ";
// Trailing debounce before the hand-edit mirror runs after an edit
// (`docs/task-dependencies.md` §8: once the cursor leaves the edited line).
const DEPENDENCY_MIRROR_DEBOUNCE_MS = 400;
// Legacy labels the picker still recognizes (and normalizes in place) so lines
// written before the rename keep working for dedupe, removal, and grouping.
const LEGACY_DEPENDENCY_NAVIGATION_LABELS = Object.freeze(
  new Set(["DEPENDENCIES"]),
);
// Emoji the reader accepts before the label: the writer form (with VS16), the
// VS16-less variant hand edits produce, and the legacy link emoji. A missing
// emoji is also accepted.
const DEPENDENCY_LINE_EMOJIS = Object.freeze(["⛓️", "⛓", "🔗"]);
// Managed Depends-On line shape, e.g.
// `  - ⛓️ **DEPENDS ON:** [[#^a]] • [[cash#^b]]`. Recognizes the current
// label, legacy labels, and legacy emoji-less lines. Named groups: `indent`
// (leading indentation), `marker` (the list bullet), `emoji`, `label`, and
// `linkSpan` (everything after the label; the link scan decides). Never split
// `linkSpan` on separators: an alias can contain one.
const DEPENDENCY_NAVIGATION_BULLET_RE = new RegExp(
  `^(?<indent>\\s*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?:(?<emoji>⛓️|⛓|🔗)[ \\t]+)?\\*\\*(?<label>${[
    DEPENDENCY_NAVIGATION_LABEL,
    ...LEGACY_DEPENDENCY_NAVIGATION_LABELS,
  ]
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")}):\\*\\*[ \\t]*(?<linkSpan>.*)$`,
);
// Every `[[note#^block-id]]` occurrence: same-note, unique-basename, and
// full-path forms, with an optional alias. Capture group 1 is the note part
// (empty for same-note links) and group 2 is the block id.
const DEPENDENCY_NAVIGATION_LINK_RE =
  /\[\[([^\]|#\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;
// One link token with its optional `!` embed marker (strikes sit outside the
// token and are stripped separately by the remainder check).
const DEPENDENCY_LINE_LINK_TOKEN_RE =
  /!?\[\[[^\]|#\n]*?#\^[A-Za-z0-9-]+(?:\|[^\]\n]*)?\]\]/g;
const DEPENDENCY_TRANSCLUSION_BULLET_RE =
  /^(?<indent>\s*(?:>\s*)*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+(?<strike>~~)?(?<embed>!)?\[\[(?<note>[^\]|#]*?)#\^(?<blockId>[A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]\k<strike>[ \t]*$/;
// Managed Schedule Log / Work Log parent-marker grammar. Mirrors bob-cli's
// parse_managed_task_log_marker() in src/native/capture.rs and must stay
// byte-compatible with it; kept as an independent copy since plugins are
// deployed separately and must not import each other's main.js. A present
// emoji must agree with the label, so `🗓️ **WORK LOG**` is not a marker. A
// marker written by hand without the emoji, and the legacy spellings, are
// still recognized so an existing log is never orphaned or silently rewritten.
// The Cancel Log below is plugin-only: bob-cli deliberately has no
// `❌ **CANCEL LOG**` anchor so new captured notes land below a first-child
// Cancel Log, and emoji-led bullets are never task sections.
function buildManagedTaskLogParentRe(emoji, labels) {
  return new RegExp(
    `^(?<indent>\\s*(?:>\\s*)*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?<emoji>${emoji}[ \\t]+)?\\*\\*(?<label>${labels
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")}):?\\*\\*[ \\t]*$`,
  );
}

const MANAGED_TASK_LOG_INDENT_UNIT = "\t";
const MANAGED_TASK_LOG_KIND_SCHEDULE = "schedule";
const MANAGED_TASK_LOG_KIND_WORK = "work";
const MANAGED_TASK_LOG_KIND_CANCEL = "cancel";

// Managed "schedule log" child bullet, e.g. `  - 🗓️ **SCHEDULE LOG**`, with a
// newest-first list of `*<from> → <to>* — <reason>` entries nested one level
// under it. The emoji is `U+1F5D3 U+FE0F` (keep the variation selector).
const SCHEDULE_LOG_EMOJI = "🗓️";
const SCHEDULE_LOG_LABEL = "SCHEDULE LOG";
const LEGACY_SCHEDULE_LOG_LABELS = Object.freeze(new Set(["Schedule log"]));
const SCHEDULE_LOG_MARKER_TEXT = `${SCHEDULE_LOG_EMOJI} **${SCHEDULE_LOG_LABEL}**`;
const SCHEDULE_LOG_ENTRY_EMPHASIS = "*";
const SCHEDULE_LOG_INDENT_UNIT = MANAGED_TASK_LOG_INDENT_UNIT;
const SCHEDULE_LOG_SEPARATOR = " — ";
const SCHEDULE_LOG_TRANSITION = " → ";

// Managed "work log" child bullet grammar: `- 🛠️ **WORK LOG**` and the legacy
// `- **Work log:**` spelling. The emoji is `U+1F6E0 U+FE0F` (keep the
// variation selector). Copied byte-for-byte from task-status-cycler.
const WORK_LOG_EMOJI = "🛠️";
const WORK_LOG_LABEL = "WORK LOG";
const LEGACY_WORK_LOG_LABELS = Object.freeze(new Set(["Work log"]));
// A machine-rolled date logs its own reason instead of prompting for one. The
// die matches the `dices` icon the picker already uses for the pinned
// priority-roll row, and marks the entry as written by the plugin rather than
// typed by a human.
const SCHEDULE_LOG_AUTO_REASON_EMOJI = "🎲";
const SCHEDULE_LOG_AUTO_REASON_SEPARATOR = " · ";
// Default same-level rolls per level before Ctrl+Enter recommends a decay.
// `🍂` (U+1F342, one code point) marks a decay-past-the-last-level cancel.
const DEFAULT_PRIORITY_DECAY_ROLLS = 1;
const PRIORITY_DECAY_CANCEL_EMOJI = "🍂";
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
const SCHEDULE_LOG_PARENT_RE = buildManagedTaskLogParentRe(SCHEDULE_LOG_EMOJI, [
  SCHEDULE_LOG_LABEL,
  ...LEGACY_SCHEDULE_LOG_LABELS,
]);
const WORK_LOG_PARENT_RE = buildManagedTaskLogParentRe(WORK_LOG_EMOJI, [
  WORK_LOG_LABEL,
  ...LEGACY_WORK_LOG_LABELS,
]);
// Managed "cancel log" child bullet, e.g. `  - ❌ **CANCEL LOG**`, with a
// newest-first list of `*YYYY-MM-DD* — <reason>` entries nested one level
// under it. The emoji is U+274C, written without a variation selector; the
// parser also accepts an optional U+FE0F after it. There are no legacy
// labels. The verdict reads first, so a new log is inserted as the task's
// first direct child (unlike Schedule/Work Logs, which append last).
const CANCEL_LOG_EMOJI = "❌";
const CANCEL_LOG_LABEL = "CANCEL LOG";
const CANCEL_LOG_MARKER_TEXT = `${CANCEL_LOG_EMOJI} **${CANCEL_LOG_LABEL}**`;
const CANCEL_LOG_PARENT_RE = buildManagedTaskLogParentRe(
  `${CANCEL_LOG_EMOJI}\uFE0F?`,
  [CANCEL_LOG_LABEL],
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

  let levelRolls = null;
  if (
    level.rolls !== undefined &&
    level.rolls !== null
  ) {
    if (!Number.isInteger(level.rolls) || level.rolls < 0) {
      showBulletPropertyNotice(
        `${levelPrefix} rolls must be a non-negative integer`,
        options,
      );
      return null;
    }
    levelRolls = level.rolls;
  }

  return Object.freeze({
    label,
    value,
    minDays: level.min_days,
    maxDays: level.max_days,
    rolls: levelRolls,
  });
}

// Normalize the `decay` block on a priority property. Absent, `true` or `{}` mean
// decay is enabled with the default roll limit; `false` disables decay; otherwise
// `decay.rolls` must be a non-negative integer. Any other key under `decay` is an
// error so a typo such as `roll: 3` is never silently ignored.
function normalizePriorityDecayConfig(name, rawDecay, options) {
  if (rawDecay === undefined || rawDecay === null) {
    return Object.freeze({
      enabled: true,
      rolls: DEFAULT_PRIORITY_DECAY_ROLLS,
    });
  }
  if (rawDecay === true) {
    return Object.freeze({
      enabled: true,
      rolls: DEFAULT_PRIORITY_DECAY_ROLLS,
    });
  }
  if (rawDecay === false) {
    return Object.freeze({ enabled: false, rolls: null });
  }
  if (typeof rawDecay !== "object" || Array.isArray(rawDecay)) {
    showBulletPropertyNotice(
      `Bullet property "${name}" decay must be true, false, or an object with rolls`,
      options,
    );
    return null;
  }
  const knownKeys = new Set(["rolls"]);
  for (const key of Object.keys(rawDecay)) {
    if (!knownKeys.has(key)) {
      showBulletPropertyNotice(
        `Bullet property "${name}" decay has an unknown key "${key}"`,
        options,
      );
      return null;
    }
  }
  if (rawDecay.rolls === undefined || rawDecay.rolls === null) {
    return Object.freeze({
      enabled: true,
      rolls: DEFAULT_PRIORITY_DECAY_ROLLS,
    });
  }
  if (!Number.isInteger(rawDecay.rolls) || rawDecay.rolls < 0) {
    showBulletPropertyNotice(
      `Bullet property "${name}" decay rolls must be a non-negative integer`,
      options,
    );
    return null;
  }
  return Object.freeze({ enabled: true, rolls: rawDecay.rolls });
}

// A level's own `rolls` overrides `decay.rolls` for that level. Null when decay
// is disabled (accepted on levels but ignored).
function getPriorityLevelRollLimit(property, level) {
  const decay = property && property.decay;
  if (!decay || decay.enabled !== true) {
    return null;
  }
  if (level && level.rolls !== undefined && level.rolls !== null) {
    return level.rolls;
  }
  return decay.rolls;
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

  const decay = normalizePriorityDecayConfig(name, entry.decay, options);
  if (decay === null) {
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
    decay,
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

    if (
      values !== "priority" &&
      Object.prototype.hasOwnProperty.call(entry, "decay")
    ) {
      showBulletPropertyNotice(
        `Bullet property "${name}" decay is only valid when values is "priority"`,
        options,
      );
      return null;
    }

    if (
      values !== "priority" &&
      Object.prototype.hasOwnProperty.call(entry, "rolls")
    ) {
      showBulletPropertyNotice(
        `Bullet property "${name}" rolls is only valid when values is "priority"`,
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

