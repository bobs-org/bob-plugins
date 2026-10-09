const {
  MarkdownView,
  Modal,
  Notice,
  normalizePath,
  Plugin,
  Setting,
  setIcon,
  TFile,
} = require("obsidian");
const { EditorView } = require("@codemirror/view");

const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK_RE = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const BLOCKED_OBSIDIAN_TASK_STATUS = "?";
const OPEN_OBSIDIAN_TASK_STATUSES = new Set([
  " ",
  "/",
  "*",
  BLOCKED_OBSIDIAN_TASK_STATUS,
]);
const DONE_OBSIDIAN_TASK_STATUSES = new Set(["x", "X", "-"]);
const OBSIDIAN_TASK_LINE_RE =
  /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
const TASK_CHECKBOX_STATUS_RE =
  /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)[^\]\n](\])/;
const PROJECT_TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/;
const PROJECT_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/g;
// A `#ref` tag (any case) directly after an exact `#task` tag with one
// whitespace run between: the reading-task pair (`docs/task-tag-marks.md`
// "Reference reading tasks" in bob-cli). `#task #references` never
// matches (the lookahead rejects the longer tag).
const REF_AFTER_TASK_RE = /(^|[\s([{])#task(\s+)#[Rr][Ee][Ff](?=$|[\s)\]},.;:!?])/;
const REF_AFTER_TASK_GLOBAL_RE =
  /(^|[\s([{])#task(\s+)#[Rr][Ee][Ff](?=$|[\s)\]},.;:!?])/g;
// Picker display prefix for reading tasks (mirrors the CLI `📖`).
const REF_TASK_DISPLAY_PREFIX = "📖 ";
const HIDE_TASK_TAG_RE = /(^|[\s([{])#hide(?=$|[\s)\]},.;:!?])/;
const HIDE_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#hide(?=$|[\s)\]},.;:!?])/g;
const TRAILING_BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const INLINE_ID_FIELD_RE = /\[id::([ \t]*)([^\]\n]*?)([ \t]*)\]/;
const INLINE_DEPENDS_ON_FIELD_RE = /\[dependsOn::([ \t]*)([^\]\n]*?)([ \t]*)\]/g;
const TASKS_INLINE_FIELD_RE = /[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g;
const TASKS_EMOJI_DATE_RE =
  /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g;
// Keep these Pomodoro ledger recognizers in sync with plugins/bob-ledger-tools/src/010-load-and-constants.js.
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const LEDGER_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[([ /xX-])\]\s+)/;
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d+[.)])\s+/;
const LIST_ITEM_PREFIX_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;
// A bullet is a dedicated Task Link bullet when, around the link token, the
// body holds only an optional checkbox, a run of `🍅 ` markers, an optional
// `~~` strike opener, and an optional `!` before it (with a matching `~~`
// closer and an optional trailing `#` move-only directive after it).
const DEDICATED_TASK_LINK_PREFIX_RE = /^(?:\[[^\]\n]\][ \t]+)?(?:🍅[ \t]+)*(~~)?!?$/u;
const DEDICATED_TASK_LINK_SUFFIX_RE = /^(~~)?(?:[ \t]*#)?$/;
const POMODORO_MARKER_PREFIX_RE = /(?:🍅[ \t]+)+$/u;
const NO_OPEN_TASK_NOTICE = "No open task under cursor";
const TASK_LINK_AMBIGUOUS_NOTICE =
  "Multiple task links on this line; place the cursor on one";
const TASK_LINK_DEPENDENCY_NOTICE =
  "Task link is a sub-task dependency; edit dependencies instead";
const TASK_DEPENDENCY_LINE_NOTICE =
  "⛓ Dependency link — edit it with Ctrl+Shift+P";
const TASK_LINK_CLOSED_NOTICE =
  "Task link target is closed; use Ctrl+Enter to reopen it";
const TASK_LINK_NOT_A_TASK_NOTICE = "Task link does not point to a task";
const TASK_LINK_NOT_FOUND_NOTICE = "Task link target could not be found";
const TASK_LINK_OPEN_SOURCE_KIND = "task-link-open";
const PLACEHOLDER_RE = /\(\s*\)/;
const COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const CANONICAL_BLOCK_LINK_PREFIX = "#^";
const SCAN_DEBOUNCE_MS = 75;
const EDIT_SUPPRESS_MS = 250;
// Recognizes the same task-level `scheduled` forms as `bob task reconcile`:
// `[scheduled:: YYYY-MM-DD]` and `(scheduled:: YYYY-MM-DD)`, anywhere on the
// line and in any field order. The captured value is validated separately so
// a malformed date still counts toward "more than one recognized field".
const SCHEDULED_FIELD_RE = /\[scheduled::([^\]\n]*)\]|\(scheduled::([^)\n]*)\)/g;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
// Managed "schedule log" child bullet, mirroring
// plugins/bob-navigation-hotkeys/src/010-requires-and-config.js's SCHEDULE_LOG_PARENT_RE: `🗓️ **SCHEDULE LOG**`,
// the emoji-less `**SCHEDULE LOG**`, and the legacy `**Schedule log:**` spelling.
// Kept as an independent copy here since plugins are deployed separately and
// must not import each other's main.js.
const SCHEDULE_LOG_EMOJI = "🗓️";
const SCHEDULE_LOG_LABEL = "SCHEDULE LOG";
const LEGACY_SCHEDULE_LOG_LABEL = "Schedule log";
const SCHEDULE_LOG_PARENT_RE = new RegExp(
  `^([ \\t]*)([-*+]|\\d+[.)])[ \\t]+(?:${SCHEDULE_LOG_EMOJI}[ \\t]+)?\\*\\*(?:${SCHEDULE_LOG_LABEL}|${LEGACY_SCHEDULE_LOG_LABEL}):?\\*\\*[ \\t]*$`,
);
const SCHEDULE_LOG_ENTRY_EMPHASIS = "_";
const SCHEDULE_LOG_TRANSITION = " → ";
const SCHEDULE_LOG_SEPARATOR = " — ";
const SCHEDULE_LOG_POMODORO_REASON = "🍅 pulled into today's Pomodoro";
const WORK_LOG_EMOJI = "🛠️";
const WORK_LOG_LABEL = "WORK LOG";
const LEGACY_WORK_LOG_LABEL = "Work log";
const WORK_LOG_PARENT_RE = new RegExp(
  `^([ \\t]*)([-*+]|\\d+[.)])[ \\t]+(?:${WORK_LOG_EMOJI}[ \\t]+)?\\*\\*(?:${WORK_LOG_LABEL}|${LEGACY_WORK_LOG_LABEL}):?\\*\\*[ \\t]*$`,
);
const WORK_LOG_ENTRY_EMPHASIS = "*";
const WORK_LOG_ENTRY_SEPARATOR = " — ";
// Daily Notes core-plugin lookup and filename-format parsing, mirroring
// plugins/bob-ledger-tools/src/010-load-and-constants.js. Kept as an independent copy for the same reason
// as the Schedule Log constants above: plugins are deployed separately and
// must not import each other's main.js.
const DAILY_NOTES_COMMAND_ID = "daily-notes";
const DEFAULT_DAILY_NOTES_FORMAT = "YYYY/YYYYMMDD";
const DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];
// One Obsidian Tab-indent level below a parent. A literal tab matches how
// Obsidian indents list items via Tab and the vault's dominant nested-list
// source style. Legacy space-only parents keep using that space prefix as the
// next-level unit so new output does not create tab/space sibling mixes.
const CANONICAL_CHILD_INDENT_UNIT = "\t";

function childIndentUnitForIndent(parentIndent) {
  const indent = String(parentIndent || "");
  return indent && !indent.includes("\t") ? indent : CANONICAL_CHILD_INDENT_UNIT;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (error) {
    return value;
  }
}

function stripWrappingQuotes(value) {
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

function normalizeLinkTarget(value) {
  let target = normalizeText(value);
  if (!target) {
    return "";
  }

  target = stripWrappingQuotes(target);
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  return safeDecodeUri(target);
}

function minPositiveIndex(first, second) {
  if (first === -1) {
    return second;
  }

  if (second === -1) {
    return first;
  }

  return Math.min(first, second);
}

function findSubpathIndex(linkText) {
  const headingIndex = linkText.indexOf("#");
  const blockIndex = linkText.indexOf("^");

  return minPositiveIndex(headingIndex, blockIndex);
}

function stripLinkSubpath(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  return subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
}

function stripMarkdownExtension(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  const pathPart = subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
  const subpathPart = subpathIndex === -1 ? "" : linkText.slice(subpathIndex);

  return pathPart.replace(/\.md$/i, "") + subpathPart;
}

function sourceKey(source) {
  return [
    source.kind || "marker-link",
    source.sourcePath,
    source.line,
    source.startCh,
    source.endCh,
    source.oldId,
  ].join(":");
}

function splitWikiLinkBody(body) {
  const pipeIndex = body.indexOf("|");
  return {
    destination: pipeIndex === -1 ? body : body.slice(0, pipeIndex),
    aliasSuffix: pipeIndex === -1 ? "" : body.slice(pipeIndex),
  };
}

