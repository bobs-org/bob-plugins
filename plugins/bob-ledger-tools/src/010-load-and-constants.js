const {
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  normalizePath,
  parseYaml,
} = require("obsidian");
const { Prec } = require("@codemirror/state");
const { EditorView, keymap } = require("@codemirror/view");

// Freshness-mark surfaces (mark-surfaces): defensive CodeMirror/Obsidian
// imports. Every piece must exist before the Live Preview extension is
// registered, so the existing ledger-tools tests and their stubs keep
// passing unchanged. Never throws.
let ViewPlugin = null;
let Decoration = null;
let WidgetType = null;
try {
  const viewMod = require("@codemirror/view");
  ViewPlugin = viewMod.ViewPlugin || null;
  Decoration = viewMod.Decoration || null;
  WidgetType = viewMod.WidgetType || null;
} catch (error) {
  ViewPlugin = null;
  Decoration = null;
  WidgetType = null;
}
let StateEffect = null;
let RangeSetBuilder = null;
try {
  const stateMod = require("@codemirror/state");
  StateEffect = stateMod.StateEffect || null;
  RangeSetBuilder = stateMod.RangeSetBuilder || null;
} catch (error) {
  StateEffect = null;
  RangeSetBuilder = null;
}
let editorInfoField = null;
let editorLivePreviewField = null;
try {
  const obsidianMod = require("obsidian");
  editorInfoField = obsidianMod.editorInfoField || null;
  editorLivePreviewField = obsidianMod.editorLivePreviewField || null;
} catch (error) {
  editorInfoField = null;
  editorLivePreviewField = null;
}
let syntaxTree = null;
try {
  const languageMod = require("@codemirror/language");
  syntaxTree = (languageMod && languageMod.syntaxTree) || null;
} catch (error) {
  syntaxTree = null;
}
let freshnessMarksRefresh = null;
try {
  if (StateEffect && typeof StateEffect.define === "function") {
    freshnessMarksRefresh = StateEffect.define();
  }
} catch (error) {
  freshnessMarksRefresh = null;
}
// Per-note Ready cap heading chips (ledger-views): a StateEffect the
// consolidated live-refresh fan-out dispatches to markdown leaves so
// Live Preview heading widgets rebuild without a doc change. Defined
// lazily on first dispatch so requiring the module never adds a
// second top-level `StateEffect.define()` call (the freshness-mark
// surfaces suite asserts the single eager effect).
let noteReadyRefresh = null;
function ensureNoteReadyRefresh() {
  if (noteReadyRefresh) {
    return noteReadyRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      noteReadyRefresh = StateEffect.define();
    }
  } catch (error) {
    noteReadyRefresh = null;
  }
  return noteReadyRefresh;
}
// Dependency chips (bob-cli-3n chips): a StateEffect the consolidated
// live-refresh fan-out dispatches so Live Preview chip widgets rebuild
// without a doc change. Defined lazily on first dispatch so requiring
// the module never adds an eager `StateEffect.define()` call (the
// freshness-mark surfaces suite asserts exactly one eager effect).
let dependencyChipsRefresh = null;
function ensureDependencyChipsRefresh() {
  if (dependencyChipsRefresh) {
    return dependencyChipsRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      dependencyChipsRefresh = StateEffect.define();
    }
  } catch (error) {
    dependencyChipsRefresh = null;
  }
  return dependencyChipsRefresh;
}
// Priority marks (bob-cli-4p ledger-marks): a StateEffect the
// consolidated live-refresh fan-out dispatches so Live Preview
// priority widgets rebuild without a doc change. Defined lazily on
// first dispatch so requiring the module never adds a second eager
// `StateEffect.define()` call (the freshness-mark surfaces suite
// shares one stub effect type across every eager define).
let priorityMarksRefresh = null;
function ensurePriorityMarksRefresh() {
  if (priorityMarksRefresh) {
    return priorityMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      priorityMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    priorityMarksRefresh = null;
  }
  return priorityMarksRefresh;
}
// Task date marks (bob-cli-53 date-marks): a StateEffect the
// consolidated live-refresh fan-out dispatches so Live Preview date
// widgets rebuild without a doc change. Defined lazily on first
// dispatch so requiring the module never adds a second eager
// `StateEffect.define()` call (the freshness-mark surfaces suite
// shares one stub effect type across every eager define).
let dateMarksRefresh = null;
function ensureDateMarksRefresh() {
  if (dateMarksRefresh) {
    return dateMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      dateMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    dateMarksRefresh = null;
  }
  return dateMarksRefresh;
}
// Task Link In Progress marks (bob-cli-56 progress-marks): a
// StateEffect the consolidated live-refresh fan-out dispatches so
// Live Preview progress widgets rebuild without a doc change.
// Defined lazily on first dispatch so requiring the module never
// adds a second eager `StateEffect.define()` call (the
// freshness-mark surfaces suite shares one stub effect type across
// every eager define).
let progressMarksRefresh = null;
function ensureProgressMarksRefresh() {
  if (progressMarksRefresh) {
    return progressMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      progressMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    progressMarksRefresh = null;
  }
  return progressMarksRefresh;
}
// Unblocked hand-off glyph (bob-cli-5w ledger_glyph): a StateEffect
// the consolidated live-refresh fan-out dispatches so Live Preview
// glyph widgets rebuild without a doc change. Defined lazily on first
// dispatch so requiring the module never adds a second eager
// `StateEffect.define()` call (the freshness-mark surfaces suite
// shares one stub effect type across every eager define).
let unblockedGlyphRefresh = null;
function ensureUnblockedGlyphRefresh() {
  if (unblockedGlyphRefresh) {
    return unblockedGlyphRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      unblockedGlyphRefresh = StateEffect.define();
    }
  } catch (error) {
    unblockedGlyphRefresh = null;
  }
  return unblockedGlyphRefresh;
}
// Task tag marks (task-tag-marks): a StateEffect the consolidated
// live-refresh fan-out dispatches so Live Preview task-tag widgets
// rebuild without a doc change. Defined lazily on first dispatch so
// requiring the module never adds a second eager
// `StateEffect.define()` call (the freshness-mark surfaces suite
// shares one stub effect type across every eager define).
let taskTagMarksRefresh = null;
function ensureTaskTagMarksRefresh() {
  if (taskTagMarksRefresh) {
    return taskTagMarksRefresh;
  }
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      taskTagMarksRefresh = StateEffect.define();
    }
  } catch (error) {
    taskTagMarksRefresh = null;
  }
  return taskTagMarksRefresh;
}

const DAY_MINUTES = 24 * 60;
const STEP_MINUTES = 5;
const DAILY_NOTES_COMMAND_ID = "daily-notes";
const DEFAULT_DAILY_NOTES_FORMAT = "YYYY/YYYYMMDD";
const DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];
const DAILY_OPEN_ATTEMPTS = 10;
const DAILY_OPEN_RETRY_DELAY_MS = 50;
const CENTER_ON_LINE_ATTEMPTS = 5;
const DAILY_LOCATION_RESTORE_RETRIES = 5;
const DAILY_LOCATION_RESTORE_ASSERT_FRAMES = 2;
const TRIGGER_RE = /(^|[^A-Za-z0-9_])((?:dt|[dtD])-?\d+|se\d*(?:-\d*)?|ta)$/;
const LEDGER_TRIGGER_RE = /^se(\d*)(?:-(\d*))?$/;
const DATE_TIME_TRIGGER_RE = /^(dt|[dtD])(-?\d+)$/;
const INCOMPLETE_NEGATIVE_OFFSET_TRIGGER_RE = /(^|[^A-Za-z0-9_])(?:dt|[dtD])-$/;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;
const EM_DASH_REPLACEMENT = "— ";
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const LEDGER_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[([ /xX-])\]\s+)/;
const PLACEHOLDER_RE = /\(\s*\)/;
const COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const DURATION_FIELD_RE = /\[t::\s*([^\]]*?)\s*\]/i;
const DURATION_FIELD_GLOBAL_RE = /\[t::\s*[^\]]*?\s*\]/gi;
const LEGACY_STOPWATCH_DURATION_RE =
  /\u23f1\ufe0f?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/i;
const LEGACY_STOPWATCH_DURATION_GLOBAL_RE =
  /\u23f1\ufe0f?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/gi;
