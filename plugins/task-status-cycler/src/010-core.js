const { MarkdownView, Modal, Notice, Plugin, setIcon } = require("obsidian");
const { EditorView } = require("@codemirror/view");

const TASKS_COMMAND_PREFIX = "obsidian-tasks-plugin:set-status-symbol-to-";
const TASKS_GLOBAL_FILTER = "#task";
const FIXED_SYMBOLS = [" ", "/", "*", "x", "-"];
const QUERY_CODE_BLOCK_LANGS = new Set(["tasks", "dataview", "dataviewjs"]);
const DEFAULT_HALF_PAGE_LINES = 20;
const TASKS_QUERY_RESULT_SELECTOR = "ul.plugin-tasks-query-result";
const TASKS_BLOCK_SELECTOR = ".block-language-tasks";
const RENDERED_TASKS_SCROLL_PADDING_PX = 8;
const RENDERED_TASKS_SCROLL_EDGE_EPSILON_PX = 2;
const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([^\]\n])(\])/;
const CONTINUATION_TASK_LINE_RE =
  /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\](?:[ \t]+|$)/;
const CONTINUATION_BULLET_LINE_RE = /^([ \t]*)[-+*](?:[ \t]+|$)/;
const LEADING_INDENT_RE = /^([ \t]*)/;
const COMPLETION_FIELD_RE = /[ \t]*\[completion::\s*[^\]\n]*\]/g;
const TRAILING_BLOCK_ID_RE = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;
const EMBEDDED_WIKILINK_RE = /!\[\[([^\]\n]+)\]\]/g;
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const TASKS_DEPENDENCY_ID_RE = /^[A-Za-z0-9_-]+$/;
const DEPENDENCY_OPEN_TASK_SYMBOLS = new Set([" ", "*", "/", "?"]);
const TASK_DEPENDENCY_FIELD_RE =
  /\[([A-Za-z][A-Za-z0-9]*)::([^\]\n]*)\]|\(([A-Za-z][A-Za-z0-9]*)::([^\)\n]*)\)/g;
// Ctrl+Enter closes open embedded Pomodoro source-task trees recursively, but
// reopens Done task-link targets and completed Pomodoros root-only. Conservative
// guards apply only to the recursive close side: the seen-set keyed by
// `path#^block-id` already stops cycles (A -> B -> A) and re-processing of
// shared targets; these caps keep a pathologically deep chain or a huge
// accidental graph from running unbounded.
const MAX_TRANSCLUDED_RECURSION_DEPTH = 25;
const MAX_TRANSCLUDED_RECURSION_TARGETS = 250;
// Dependency-ID normalization: rewrite Tasks-generated `[id::]`/`[dependsOn::]`
// values to the target task's existing Obsidian block ID. See the SDD tale
// task_dependency_block_ids.md. The generated-ID heuristic matches Tasks
// 8.0.0's six-character base-36 helper; if Tasks changes it upstream we stop
// rewriting rather than risk touching intentional IDs.
const TRAILING_BLOCK_ID_CAPTURE_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const TASKS_GENERATED_ID_RE = /^[0-9a-z]{6}$/;
const INLINE_ID_FIELD_RE = /\[id::([ \t]*)([^\]\n]*?)([ \t]*)\]/;
const INLINE_DEPENDS_ON_FIELD_RE = /\[dependsOn::([ \t]*)([^\]\n]*?)([ \t]*)\]/g;
const DEPENDS_ON_ID_SEGMENT_RE = /^([ \t]*)([^ \t,]*)([ \t]*)$/;
const DEPENDENCY_NORMALIZE_DEBOUNCE_MS = 400;
const STANDALONE_BLOCK_ID_PREFIX_RE = "(^|[ \\t])";
const STANDALONE_BLOCK_ID_SUFFIX_RE = "(?=$|[ \\t])";
const MARKDOWN_EXTENSION_RE = /\.md$/i;
const OPEN_DONE_TASK_SYMBOLS = new Set([" ", "*", "/", "x"]);
const CLOSABLE_TASK_SYMBOLS = new Set([" ", "*", "/"]);
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const TASK_CHECKBOX_MARKER_RE =
  /^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[[^\]\n]\]([ \t]*)(.*)$/;
const LIST_ITEM_MARKER_RE =
  /^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)(.*)$/;
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const TOP_LEVEL_TASK_LINE_RE = /^(?:[-+*]|\d+[.)])\s+\[[^\]\n]\]/;
const INDENTED_LIST_LINE_RE = /^[ \t]+(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const TOP_LEVEL_DASH_LIST_TOGGLE_LINE_RE = /^-[ \t]+/;
// Any top-level (unindented, non-blockquoted) list item: dash/plus/star bullets,
// checklist items (which begin with one of those markers), and ordered items.
// Used to locate the last existing bullet block in a demotion target section.
const TOP_LEVEL_LIST_ITEM_LINE_RE = /^(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const POMODORO_PLACEHOLDER_RE = /\(\s*\)/;
const POMODORO_PLACEHOLDER_LINE = "- [ ] ()";
// Duplicated from bob-navigation-hotkeys intentionally: deployed plugins must
// not import one another.
const POMODORO_NAME_SEPARATOR = "—";
const POMODORO_NAME_TAIL_RE = /^[ \t]*—[ \t]*(.*)$/;
const POMODORO_COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const POMODORO_COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const EMPTY_POMODORO_SUB_BULLET_LINE = "\t- ";
const EMPTY_TASK_CHECKBOX_MARKER = "[ ] ";
const POMODORO_MARKER = "🍅";
// One Obsidian Tab-indent level for generated child bullets. A literal tab
// matches how Obsidian indents list items via Tab and the vault's dominant
// nested-list source style, unlike the prior two-space indent.
const CHILD_BULLET_INDENT_UNIT = "\t";
// Promotion uses CREATED_FIELD_RE to avoid adding a duplicate created field.
const CREATED_FIELD_RE = /\[created::\s*[^\]\n]*\]/;
const TASK_TAG_TEXT_RE = /#task/g;
const TASK_TAG_BOUNDARY_BEFORE_RE = /[A-Za-z0-9_/#-]/;
const TASK_TAG_BOUNDARY_AFTER_RE = /[A-Za-z0-9_/-]/;

function getLineIndentation(lineText) {
  const match = String(lineText || "").match(LEADING_INDENT_RE);
  return match ? match[1] : "";
}

function getOpenLineBelowPrefix(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(CONTINUATION_TASK_LINE_RE);
  if (taskMatch) {
    return `${taskMatch[1]}- [ ] `;
  }

  const bulletMatch = line.match(CONTINUATION_BULLET_LINE_RE);
  if (bulletMatch) {
    return `${bulletMatch[1]}- `;
  }

  return getLineIndentation(line);
}

// Prefix for the Ctrl+Shift+o child-bullet open-line mapping. Unlike
// getOpenLineBelowPrefix(), this always emits a plain `- ` bullet one
// Obsidian Tab-indent level (CHILD_BULLET_INDENT_UNIT) deeper than the current
// line, never continuing a task or rewriting the current line's leading
// whitespace.
function getChildBulletOpenLinePrefix(lineText) {
  return `${getLineIndentation(lineText)}${CHILD_BULLET_INDENT_UNIT}- `;
}

function formatLocalDate(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Task freshness: placement lives in bob-ledger-tools
// (`api.freshness.stampLine`, api `version >= 3`). This plugin never places
// `[fresh::]` itself: a missing stamp only means Bryan sees the task once
// more, while a misplaced stamp would hide Tasks fields. When ledger-tools is
// absent or old, gestures simply don't stamp.
function identityFreshStampLine(line) {
  return String(line || "");
}

function applyFreshStampLine(line, stamper, dateText) {
  const fn = typeof stamper === "function" ? stamper : identityFreshStampLine;
  try {
    const stamped = fn(String(line || ""), dateText);
    return typeof stamped === "string" ? stamped : String(line || "");
  } catch (error) {
    return String(line || "");
  }
}

function resolveFreshStamper(options) {
  if (options && typeof options.stampLine === "function") {
    return options.stampLine;
  }
  return null;
}

function getDailyNoteDateFromPath(path) {
  const match = String(path || "").match(
    /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/,
  );
  if (!match || match[1] !== match[2]) {
    return null;
  }

  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const isLeapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > daysInMonth.length ||
    day < 1 ||
    day > daysInMonth[month - 1]
  ) {
    return null;
  }

  return `${match[2]}-${match[3]}-${match[4]}`;
}

function isDailyNotePath(path) {
  return getDailyNoteDateFromPath(path) !== null;
}

function normalizeVimRepeat(value) {
  const repeat = Math.floor(Number(value === undefined ? 1 : value));
  return Number.isFinite(repeat) && repeat > 0 ? repeat : 1;
}

function getVimRepeat(actionArgs) {
  return normalizeVimRepeat(actionArgs && actionArgs.repeat);
}

function getPomodoroMoveOnlyAdditionalLines(actionArgs) {
  if (!actionArgs) {
    return 0;
  }

  // CodeMirror Vim supplies repeat=1 even when no count was typed. Its
  // repeatIsExplicit flag is what distinguishes bare `#` (the cursor line
  // only) from `1#` (the cursor line and one additional physical line).
  const repeatIsExplicit =
    typeof actionArgs.repeatIsExplicit === "boolean"
      ? actionArgs.repeatIsExplicit
      : actionArgs.repeat !== undefined && actionArgs.repeat !== null;
  return repeatIsExplicit ? getVimRepeat(actionArgs) : 0;
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
    const repeat = Math.floor(Number(keyBufferMatch[1]));
    if (Number.isFinite(repeat) && repeat > 0) {
      return { repeat, explicit: true };
    }
  }

  const rawRepeat =
    inputState && typeof inputState.getRepeat === "function"
      ? inputState.getRepeat()
      : null;
  const repeat = Math.floor(Number(rawRepeat));

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

function getOptionBracketTaskCycleDirection(event) {
  if (
    !event ||
    event.ctrlKey ||
    !event.altKey ||
    event.shiftKey ||
    event.metaKey
  ) {
    return null;
  }

  if (event.code === "BracketRight") {
    return 1;
  }

  if (event.code === "BracketLeft") {
    return -1;
  }

  return null;
}

function getPomodoroBulletToggleKeydown(event) {
  return !!(
    event &&
    event.ctrlKey &&
    event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.code === "BracketRight"
  );
}

function replaceTaskStatusSymbol(lineText, nextSymbol) {
  const line = String(lineText || "");
  const match = line.match(TASK_LINE_RE);
  if (!match) {
    return line;
  }

  return `${match[1]}${nextSymbol}${match[3]}${line.slice(match[0].length)}`;
}

function normalizeTaskStatusSymbol(symbol) {
  return symbol === "X" ? "x" : symbol;
}

function getTaskStatusForLine(lineText, lineNumber = 0) {
  const line = String(lineText || "");
  const match = line.match(TASK_LINE_RE);

  if (!match) {
    return null;
  }

  const rawSymbol = match[2];
  const statusStart = match[1].length;
  return {
    symbol: normalizeTaskStatusSymbol(rawSymbol),
    rawSymbol,
    line: lineNumber,
    lineText: line,
    statusStart,
    statusEnd: statusStart + rawSymbol.length,
  };
}

