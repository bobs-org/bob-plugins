// --- Task requirements twin (RQ), part 1: lines, managed lines, task scan --
// Twin of the bob-cli helpers `src/native/task_reqs.rs` reads
// (`capture::{line_spans, list_item_body, nearest_shallower_list_item_parent}`,
// `markdown::{fenced_lines, strictly_closed_frontmatter_end}`, the
// `note_tasks` scan, `collect_done::trailing_block_id_in_line`, and the
// managed-line and drawer-title predicates). Rust is the authority: the
// shared RQ vectors in `scripts/fixtures/task_reqs/` are copied byte for byte
// from bob-cli, and a behavior difference is a twin bug.
//
// The RQ twin is two fragments (this one and `task-reqs-twin.js`). Both are
// plugin-agnostic and copied byte for byte into every plugin that
// recognizes requirement lines: pure functions and constants only (no
// `this`, no Obsidian or CodeMirror, no clock, no plugin helpers).
// Update bob-cli first, then this file, then its copies.
//
// Text offsets are UTF-16 code units (the editor's unit); indentation
// comparisons that Rust makes in UTF-8 bytes use `taskReqUtf8Length` so
// they agree.

const TASK_REQ_MAX_DEPTH = 16;
const TASK_REQ_GLOBAL_FILTER = "#task";
// Rust `char::is_whitespace` (Unicode White_Space); JS `\s` differs on
// U+0085 and U+FEFF, so the twin never uses `\s` or `String#trim`.
const TASK_REQ_WHITESPACE_CLASS =
  "\\t\\n\\u000b\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TASK_REQ_WHITESPACE_RE = new RegExp(`^[${TASK_REQ_WHITESPACE_CLASS}]$`);
const TASK_REQ_LEADING_WHITESPACE_RE = new RegExp(`^[${TASK_REQ_WHITESPACE_CLASS}]+`);
const TASK_REQ_TRAILING_WHITESPACE_RE = new RegExp(`[${TASK_REQ_WHITESPACE_CLASS}]+$`);
const TASK_REQ_WHITESPACE_RUN_RE = new RegExp(`[${TASK_REQ_WHITESPACE_CLASS}]+`);
const TASK_REQ_NONBLANK_RE = new RegExp(`[^${TASK_REQ_WHITESPACE_CLASS}]`);
const TASK_REQ_INLINE_FIELD_RE = new RegExp(
  `\\[[A-Za-z][A-Za-z0-9_-]*::[${TASK_REQ_WHITESPACE_CLASS}]*[^\\]]*\\]`,
  "g",
);
// `task_status_hooks::parse_tasks_settings` defaults; configured statuses
// are layered on top, unknown symbols read as TODO.
const TASK_REQ_DEFAULT_STATUS_TYPES = Object.freeze({
  " ": "TODO",
  x: "DONE",
  X: "DONE",
  "/": "IN_PROGRESS",
  "*": "ON_HOLD",
  "-": "CANCELLED",
});
const TASK_REQ_DEPENDS_ON_EMOJI = ["⛓️", "⛓", "\u{1f517}"];
const TASK_REQ_DEPENDS_ON_LABELS = ["DEPENDS ON", "DEPENDENCIES"];
const TASK_REQ_BLOCKS_EMOJI = ["\u{1f9f1}", "\u{1f6a7}", "⛓️", "⛓"];
const TASK_REQ_BLOCKS_LABELS = ["BLOCKS", "BLOCKING"];
const TASK_REQ_RELATION_EMOJI = ["\u{1faa2}", "\u{1f517}"];
const TASK_REQ_LINKS_LABELS = ["LINKS", "LINKS TO"];
const TASK_REQ_LINKED_FROM_LABELS = ["LINKED FROM", "BACKLINKS"];
const TASK_REQ_SCHEDULE_LOG_EMOJI = "\u{1f5d3}️";
const TASK_REQ_WORK_LOG_EMOJI = "\u{1f6e0}️";
const TASK_REQ_ROTTEN_LOG_EMOJI = "\u{1f940}";
const TASK_REQ_MANAGED_LOG_LABELS = [
  ["SCHEDULE LOG", "schedule"],
  ["Schedule log", "schedule"],
  ["WORK LOG", "work"],
  ["Work log", "work"],
  ["ROTTEN LOG", "rotten"],
  ["Rotten log", "rotten"],
];

// --- Text primitives ------------------------------------------------------

function taskReqIsWhitespaceChar(character) {
  return typeof character === "string" && TASK_REQ_WHITESPACE_RE.test(character);
}

function taskReqIsBlank(text) {
  return !TASK_REQ_NONBLANK_RE.test(String(text));
}

function taskReqTrimStart(text) {
  return String(text).replace(TASK_REQ_LEADING_WHITESPACE_RE, "");
}

function taskReqTrimEnd(text) {
  return String(text).replace(TASK_REQ_TRAILING_WHITESPACE_RE, "");
}

function taskReqTrim(text) {
  return taskReqTrimEnd(taskReqTrimStart(text));
}

function taskReqSplitWhitespace(text) {
  const trimmed = taskReqTrim(text);
  return trimmed === "" ? [] : trimmed.split(TASK_REQ_WHITESPACE_RUN_RE);
}

// The leading Unicode whitespace of a line (`capture::leading_whitespace`).
function taskReqLeadingWhitespace(text) {
  const match = TASK_REQ_LEADING_WHITESPACE_RE.exec(String(text));
  return match ? match[0] : "";
}

// UTF-8 byte length, for the indentation comparisons Rust makes in bytes.
function taskReqUtf8Length(text) {
  let length = 0;
  for (const character of String(text)) {
    const point = character.codePointAt(0);
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}

// `capture::leading_spaces_or_tabs_len`.
function taskReqIndentLength(text) {
  const value = String(text);
  let index = 0;
  while (index < value.length && (value[index] === " " || value[index] === "\t")) index += 1;
  return index;
}

function taskReqIsAsciiDigit(character) {
  return typeof character === "string" && character.length === 1 && character >= "0" && character <= "9";
}

function taskReqIsAsciiWhitespace(character) {
  return character === " " || character === "\t" || character === "\n" || character === "\f" || character === "\r";
}

// `capture::line_spans`: physical lines without their `\n` / `\r\n`, each
// with the offset just past its ending.
function taskReqLineSpans(contents) {
  const text = String(contents == null ? "" : contents);
  const spans = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    let line = text.slice(start, newline === -1 ? end : newline);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    spans.push({ start, end, text: line });
    start = end;
  }
  return spans;
}

// `capture::list_marker_len`.
function taskReqListMarkerLength(afterIndent) {
  const first = afterIndent[0];
  if (first === "-" || first === "*" || first === "+") return 1;
  if (!taskReqIsAsciiDigit(first)) return null;
  let digits = 0;
  while (taskReqIsAsciiDigit(afterIndent[digits])) digits += 1;
  const next = afterIndent[digits];
  return next === "." || next === ")" ? digits + 1 : null;
}

// `capture::list_item_body` with its position: only list markers followed by
// spaces or tabs count.
function taskReqListItem(line) {
  const text = String(line == null ? "" : line);
  const indent = taskReqIndentLength(text);
  const afterIndent = text.slice(indent);
  const markerLength = taskReqListMarkerLength(afterIndent);
  if (markerLength === null) return null;
  const afterMarker = afterIndent.slice(markerLength);
  const gap = taskReqIndentLength(afterMarker);
  if (gap === 0) return null;
  const bodyFrom = indent + markerLength + gap;
  return { body: text.slice(bodyFrom), bodyFrom, indent };
}

function taskReqListItemBody(line) {
  const item = taskReqListItem(line);
  return item ? item.body : null;
}

// `task_status_hooks::after_list_marker`: the index just past the marker
// when an ASCII whitespace byte follows it.
function taskReqAfterListMarker(line, index) {
  const character = line[index];
  if (character === "-" || character === "*" || character === "+") {
    return taskReqIsAsciiWhitespace(line[index + 1]) ? index + 1 : null;
  }
  let digits = 0;
  while (taskReqIsAsciiDigit(line[index + digits])) digits += 1;
  if (digits === 0) return null;
  const after = line[index + digits];
  if (after !== "." && after !== ")") return null;
  return taskReqIsAsciiWhitespace(line[index + digits + 1]) ? index + digits + 1 : null;
}

// `markdown::fence_marker` / `closes_fence` / `fenced_lines`.
function taskReqFenceMarker(line) {
  const text = String(line);
  let indentation = 0;
  while (text[indentation] === " ") indentation += 1;
  if (indentation > 3) return null;
  const rest = text.slice(indentation);
  const character = rest[0];
  if (character !== "`" && character !== "~") return null;
  let length = 0;
  while (rest[length] === character) length += 1;
  return length >= 3 ? { character, length } : null;
}

function taskReqClosesFence(line, open) {
  const marker = taskReqFenceMarker(line);
  if (!marker) return false;
  const trimmed = taskReqTrimStart(line);
  return marker.character === open.character
    && marker.length >= open.length
    && taskReqIsBlank(trimmed.slice(marker.length));
}

function taskReqFencedLines(lines, start, end) {
  const fenced = new Set();
  let open = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (open) {
      fenced.add(index);
      if (taskReqClosesFence(line, open)) open = null;
    } else {
      const marker = taskReqFenceMarker(line);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  return fenced;
}

function taskReqFrontmatterEnd(lines) {
  if (!lines.length || taskReqTrimEnd(lines[0]) !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (taskReqTrimEnd(lines[index]) === "---") return index;
  }
  return null;
}

// `collect_done::trailing_block_id_in_line`.
function taskReqTrailingBlockId(text) {
  const trimmed = taskReqTrimEnd(text);
  const start = trimmed.lastIndexOf("^");
  if (start === -1) return null;
  const id = trimmed.slice(start + 1);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) return null;
  if (start > 0 && !taskReqIsWhitespaceChar(trimmed[start - 1])) return null;
  return id;
}

// --- Managed lines and drawer titles ---------------------------------------

// The shared head of the Depends-On, Blocks, and relation parsers: list
// marker, optional tolerated emoji, `**LABEL**` with an optional colon.
// Every recognized label is a managed line, malformed or not.
function taskReqManagedHeader(line, emojis, labels) {
  const text = String(line);
  const markerEnd = taskReqAfterListMarker(text, taskReqIndentLength(text));
  if (markerEnd === null) return null;
  let rest = taskReqTrimStart(text.slice(markerEnd));
  for (const emoji of emojis) {
    if (rest.startsWith(emoji)) {
      rest = taskReqTrimStart(rest.slice(emoji.length));
      break;
    }
  }
  if (!rest.startsWith("**")) return null;
  const body = rest.slice(2);
  const close = body.indexOf("**");
  if (close === -1) return null;
  const raw = body.slice(0, close);
  const label = raw.endsWith(":") ? raw.slice(0, -1) : raw;
  if (!labels.includes(label)) return null;
  let after = body.slice(close + 2);
  if (after.startsWith(":")) after = after.slice(1);
  return { label, malformed: after !== "" && after[0] !== " " && after[0] !== "\t" };
}

function taskReqIsDependencyLine(line) {
  return taskReqManagedHeader(line, TASK_REQ_DEPENDS_ON_EMOJI, TASK_REQ_DEPENDS_ON_LABELS) !== null;
}

function taskReqIsBlocksLine(line) {
  return taskReqManagedHeader(line, TASK_REQ_BLOCKS_EMOJI, TASK_REQ_BLOCKS_LABELS) !== null;
}

// A malformed relation header reads as both a LINKS and a LINKED FROM line,
// as `task_relations::parse_header` returns `Err` before the kind check.
function taskReqRelationHeader(line) {
  return taskReqManagedHeader(
    line,
    TASK_REQ_RELATION_EMOJI,
    TASK_REQ_LINKS_LABELS.concat(TASK_REQ_LINKED_FROM_LABELS),
  );
}

function taskReqIsLinksLine(line) {
  const header = taskReqRelationHeader(line);
  return header !== null && (header.malformed || TASK_REQ_LINKS_LABELS.includes(header.label));
}

function taskReqIsLinkedFromLine(line) {
  const header = taskReqRelationHeader(line);
  return header !== null && (header.malformed || TASK_REQ_LINKED_FROM_LABELS.includes(header.label));
}

// `task_dependencies::is_managed_link_line`.
function taskReqIsManagedLinkLine(line) {
  return taskReqIsDependencyLine(line) || taskReqIsBlocksLine(line) || taskReqRelationHeader(line) !== null;
}

function taskReqIsSubprojectsLine(line) {
  const text = String(line);
  const markerEnd = taskReqAfterListMarker(text, taskReqIndentLength(text));
  if (markerEnd === null) return false;
  let body = taskReqTrimStart(text.slice(markerEnd));
  if (body.startsWith("\u{1f9e9}")) body = taskReqTrimStart(body.slice("\u{1f9e9}".length));
  return body.includes("**Sub-projects:**") || body.includes("**Sub-projects**");
}

function taskReqIsCancelLog(line) {
  const text = String(line);
  const markerEnd = taskReqAfterListMarker(text, taskReqIndentLength(text));
  if (markerEnd === null) return false;
  const body = taskReqTrimStart(text.slice(markerEnd));
  return body.startsWith("❌") && body.includes("CANCEL LOG");
}

function taskReqManagedLogLabel(rest) {
  if (!rest.startsWith("**")) return null;
  const afterOpen = rest.slice(2);
  for (const [label, kind] of TASK_REQ_MANAGED_LOG_LABELS) {
    if (!afterOpen.startsWith(label)) continue;
    let afterLabel = afterOpen.slice(label.length);
    if (afterLabel.startsWith(":")) afterLabel = afterLabel.slice(1);
    if (!afterLabel.startsWith("**")) continue;
    if (/^[ \t]*$/.test(afterLabel.slice(2))) return kind;
  }
  return null;
}

function taskReqStripLogEmoji(rest, emoji, optionalVariation) {
  if (!rest.startsWith(emoji)) return null;
  let after = rest.slice(emoji.length);
  if (optionalVariation && after.startsWith("️")) after = after.slice(1);
  const gap = taskReqIndentLength(after);
  return gap > 0 ? after.slice(gap) : null;
}

// `capture::parse_managed_task_log_marker`: `schedule`, `work`, `rotten`, or
// null. A present emoji must agree with the label. Cancel Log is separate.
function taskReqManagedLogKind(line) {
  const rest = taskReqListItemBody(line);
  if (rest === null) return null;
  const pairs = [
    [TASK_REQ_SCHEDULE_LOG_EMOJI, "schedule", false],
    [TASK_REQ_WORK_LOG_EMOJI, "work", false],
    [TASK_REQ_ROTTEN_LOG_EMOJI, "rotten", true],
  ];
  for (const [emoji, expected, optionalVariation] of pairs) {
    const after = taskReqStripLogEmoji(rest, emoji, optionalVariation);
    if (after !== null) {
      const kind = taskReqManagedLogLabel(after);
      return kind === expected ? kind : null;
    }
  }
  return taskReqManagedLogLabel(rest);
}

// Body-shape compatibility name; context-aware readers call the shared
// `recognize_drawer_header` adapter before treating this as a drawer.
function taskReqIsDrawerTitle(title) {
  return drawer_body_title(title) !== null;
}

// `capture_drawers::drawer_key`: whitespace collapsed, Unicode uppercase.
function taskReqDrawerKey(title) {
  return drawer_key(title);
}

// Lines that can never be a req or a req parent by shape: drawer titles and
// managed link/log lines.
function taskReqIsStructuralContainer(line) {
  const body = taskReqListItemBody(line);
  if (body !== null && taskReqIsDrawerTitle(taskReqTrim(body))) return true;
  return taskReqIsSubprojectsLine(line)
    || taskReqIsManagedLinkLine(line)
    || taskReqIsCancelLog(line)
    || taskReqManagedLogKind(line) !== null;
}

// --- Note document and task scan --------------------------------------------

function taskReqOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  const globalFilter = typeof source.globalFilter === "string" ? source.globalFilter : TASK_REQ_GLOBAL_FILTER;
  const statusTypes = Object.assign({}, TASK_REQ_DEFAULT_STATUS_TYPES, source.statusTypes || {});
  return { globalFilter, statusTypes };
}

function taskReqStatusType(statusSymbol, options) {
  const type = options.statusTypes[statusSymbol];
  return typeof type === "string" ? type : "TODO";
}

function taskReqStatusIsOpen(statusType) {
  return statusType === "TODO" || statusType === "IN_PROGRESS" || statusType === "ON_HOLD";
}

// One parsed note: spans plus per-line facts the readers share.
function taskReqDocument(contents) {
  const text = String(contents == null ? "" : contents);
  const spans = taskReqLineSpans(text);
  const texts = spans.map((span) => span.text);
  const bodies = texts.map((line) => taskReqListItemBody(line));
  return {
    contents: text,
    spans,
    texts,
    bodies,
    indents: texts.map((line) => taskReqIndentLength(line)),
    blank: texts.map((line) => taskReqIsBlank(line)),
    parents: new Array(texts.length),
    memo: new Map(),
  };
}

function taskReqDocMemo(doc, key, build) {
  if (!doc.memo.has(key)) doc.memo.set(key, build());
  return doc.memo.get(key);
}

// `capture::nearest_shallower_list_item_parent`, memoized per document.
function taskReqDocParent(doc, childIndex) {
  if (doc.parents[childIndex] !== undefined) return doc.parents[childIndex];
  let result = null;
  const childIndent = doc.indents[childIndex];
  if (childIndex > 0 && childIndent > 0) {
    for (let index = childIndex - 1; index >= 0; index -= 1) {
      if (doc.blank[index] || doc.indents[index] >= childIndent) continue;
      if (doc.bodies[index] !== null) {
        result = index;
        break;
      }
    }
  }
  doc.parents[childIndex] = result;
  return result;
}

// Fences over list-item bodies, so a fence nested in a list item counts.
function taskReqDocListFenced(doc) {
  return taskReqDocMemo(doc, "list-fenced", () => {
    const logical = doc.texts.map((line, index) => (doc.bodies[index] !== null ? doc.bodies[index] : line));
    return taskReqFencedLines(logical, 0, logical.length);
  });
}

function taskReqParseTaskLine(line, globalFilter) {
  const indentation = taskReqLeadingWhitespace(line);
  const afterIndent = line.slice(indentation.length);
  if (!afterIndent.startsWith("- [")) return null;
  const afterOpen = afterIndent.slice(3);
  const point = afterOpen.codePointAt(0);
  if (point === undefined) return null;
  const statusSymbol = String.fromCodePoint(point);
  const afterStatus = afterOpen.slice(statusSymbol.length);
  if (!afterStatus.startsWith("] ")) return null;
  const body = afterStatus.slice(2);
  if (globalFilter !== "" && !taskReqSplitWhitespace(body).includes(globalFilter)) return null;
  return { indentation, statusSymbol, body };
}

// `note_tasks::clean_description`.
function taskReqCleanDescription(body, globalFilter, blockId) {
  let withoutBlock = String(body);
  if (blockId != null) {
    const trimmed = taskReqTrimEnd(withoutBlock);
    const suffix = `^${blockId}`;
    if (trimmed.endsWith(suffix)) withoutBlock = trimmed.slice(0, trimmed.length - suffix.length);
  }
  const tokens = taskReqSplitWhitespace(withoutBlock.replace(TASK_REQ_INLINE_FIELD_RE, " "));
  const out = [];
  let previousDroppedFilter = false;
  for (const token of tokens) {
    if (globalFilter !== "" && token === globalFilter) {
      previousDroppedFilter = true;
      continue;
    }
    if (previousDroppedFilter && token.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) === "#ref") {
      previousDroppedFilter = false;
      continue;
    }
    previousDroppedFilter = false;
    out.push(token);
  }
  return out.join(" ");
}

// `note_tasks::task_block_extent`: indentation compares in UTF-8 bytes.
function taskReqTaskBlockExtent(doc, taskIndex, taskIndentation) {
  const indentBytes = (index) => taskReqUtf8Length(taskReqLeadingWhitespace(doc.texts[index]));
  let index = taskIndex + 1;
  let lastConsumed = taskIndex;
  let childCount = 0;
  while (index < doc.texts.length) {
    if (doc.blank[index]) {
      let next = index + 1;
      while (next < doc.texts.length && doc.blank[next]) next += 1;
      if (next < doc.texts.length && indentBytes(next) > taskIndentation) {
        lastConsumed = index;
        index += 1;
        continue;
      }
      break;
    }
    if (indentBytes(index) <= taskIndentation) break;
    lastConsumed = index;
    childCount += 1;
    index += 1;
  }
  return { childCount, blockEnd: doc.spans[lastConsumed].end };
}

// `note_tasks::scan`, reduced to what the requirement and layout readers
// use. Tasks come back in document order.
function taskReqScanIn(doc, options) {
  return taskReqDocMemo(doc, `scan:${options.globalFilter}:${JSON.stringify(options.statusTypes)}`, () => {
    const frontmatterEnd = taskReqFrontmatterEnd(doc.texts);
    const scanStart = frontmatterEnd === null ? 0 : frontmatterEnd + 1;
    const fenced = taskReqFencedLines(doc.texts, scanStart, doc.texts.length);
    const tasks = [];
    for (let lineIndex = 0; lineIndex < doc.texts.length; lineIndex += 1) {
      if ((frontmatterEnd !== null && lineIndex <= frontmatterEnd) || fenced.has(lineIndex)) continue;
      const line = doc.texts[lineIndex];
      const parsed = taskReqParseTaskLine(line, options.globalFilter);
      if (!parsed) continue;
      const blockId = taskReqTrailingBlockId(line);
      const extent = taskReqTaskBlockExtent(doc, lineIndex, taskReqUtf8Length(parsed.indentation));
      const statusType = taskReqStatusType(parsed.statusSymbol, options);
      tasks.push({
        lineIndex,
        indentation: parsed.indentation,
        statusSymbol: parsed.statusSymbol,
        statusType,
        open: taskReqStatusIsOpen(statusType),
        description: taskReqCleanDescription(parsed.body, options.globalFilter, blockId),
        blockId,
        childCount: extent.childCount,
        blockEnd: extent.blockEnd,
      });
    }
    return tasks;
  });
}

function taskReqNoteTasks(contents, options) {
  return taskReqScanIn(taskReqDocument(contents), taskReqOptions(options));
}
