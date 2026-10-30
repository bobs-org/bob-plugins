// Task Wikilink `((` trigger grammar (epic: `((` task wikilink picker).
//
// Pure token detection for the `((` picker trigger, the note-only
// exclusions, and the written-second-paren auto-open rule. This fragment
// wires nothing: the picker phase consumes these helpers from
// `scheduleScan` / `inspectActiveEditor`.
//
// The shared core mirrors bob's `capture_task_wikilinks` opener, closer,
// stop-byte, mid-word, and query-clamping rules so both sides accept the
// same tokens. The exclusions in `taskWikilinkContextAt` are Obsidian-note
// additions bob's capture grammar never sees (frontmatter, fences, math,
// comments, inline spans, Pomodoro entries, reading-view style guards).
// Offsets are UTF-16 code units (`ch`), matching Obsidian editor
// coordinates; bob's byte offsets differ on multi-byte lines by
// construction.

// Query stop bytes, mirroring bob's `QUERY_STOP` (`()[]`, backtick, CR,
// LF). A space never stops the scan: the unclosed replacement extends over
// the whitespace run instead.
const TASK_WIKILINK_QUERY_STOP = new Set(["(", ")", "[", "]", "`", "\n", "\r"]);
const TASK_WIKILINK_WHITESPACE_RE = /[ \t\n\r\f\v]/;
const TASK_WIKILINK_BRACKET_RE = /\[[^\[\]\n]*\]/g;
const TASK_WIKILINK_AUTOLINK_RE = /<(?:(?:https?|ftp):\/\/[^<>\s]*|mailto:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/g;
const TASK_WIKILINK_BARE_URL_RE = /(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>"`\]]+/g;
const TASK_WIKILINK_HTML_MARKER_RE = /<!--|-->/g;

function taskWikilinkIsWhitespace(value) {
  return TASK_WIKILINK_WHITESPACE_RE.test(value || "");
}

// An opener is valid exactly like bob's `is_valid_opener`: line start or
// after a space/tab, and not followed by a third `(`. The capture-side
// protected-markup check (inside `[[...]]`) lives in
// `taskWikilinkContextAt` here, which classifies every inline exclusion.
function taskWikilinkIsValidOpener(line, opener) {
  if (opener !== 0) {
    const before = line[opener - 1];
    if (before !== " " && before !== "\t") {
      return false;
    }
  }
  return line[opener + 2] !== "(";
}

// Scan one token from a valid opener, mirroring bob's `token_from_opener`.
// From `opener + 2` a `))` closes the token; the first single `)`, stop
// byte, or line end leaves it unclosed.
function taskWikilinkTokenFromOpener(line, opener) {
  const innerStart = opener + 2;
  let index = innerStart;
  while (index < line.length) {
    const char = line[index];
    if (char === ")") {
      if (line[index + 1] === ")") {
        return { opener, queryEnd: index, closer: index };
      }
      return { opener, queryEnd: index, runEnd: index, closer: null };
    }
    if (TASK_WIKILINK_QUERY_STOP.has(char)) {
      return { opener, queryEnd: index, runEnd: index, closer: null };
    }
    index += 1;
  }
  return { opener, queryEnd: index, runEnd: index, closer: null };
}

// Resolve the query and replacement for `caret`, mirroring bob's
// `field_at_token`. A closed token covers `((q))` with the caret anywhere
// inside it (the query clamps to the closer); an unclosed token runs from
// the opener to the end of the non-whitespace run at the caret.
function taskWikilinkFieldAtToken(line, token, caret) {
  if (caret < token.opener) {
    return null;
  }
  const innerStart = token.opener + 2;
  if (token.closer !== null && token.closer !== undefined) {
    const closerEnd = token.closer + 2;
    if (caret > closerEnd) {
      return null;
    }
    const queryEnd = Math.min(Math.max(caret, innerStart), token.closer);
    return taskWikilinkTokenResult(line, token, queryEnd, token.opener, closerEnd, token.closer);
  }
  if (caret > token.runEnd) {
    return null;
  }
  const queryEnd = Math.max(caret, innerStart);
  let end = Math.min(caret, token.runEnd);
  while (end < token.runEnd && !taskWikilinkIsWhitespace(line[end])) {
    end += 1;
  }
  return taskWikilinkTokenResult(line, token, queryEnd, token.opener, end, null);
}

function taskWikilinkTokenResult(line, token, queryEnd, replaceStart, replaceEnd, closer) {
  const innerStart = token.opener + 2;
  const closed = closer !== null && closer !== undefined;
  return {
    opener: token.opener,
    closer: closed ? closer : null,
    queryStart: innerStart,
    queryEnd,
    replaceStart,
    replaceEnd,
    query: line.slice(innerStart, queryEnd),
    // Backspace on an empty filter undoes the trigger the way the editor
    // would: closed `((q))` becomes `()` with the caret inside, unclosed
    // `((q` becomes `(` with the caret after it. The query fragment goes
    // too, and this stays a pure description for the picker phase.
    removal: {
      start: token.opener + 1,
      end: closed ? replaceEnd - 1 : replaceEnd,
      insert: "",
      caretCh: token.opener + 1,
    },
  };
}

// Locate the `((query` token at `ch` on one line, or null. The last match
// wins, like bob's `.last()`, so a later token shadows an earlier one.
function findTaskWikilinkToken(lineText, ch) {
  const line = String(lineText === null || lineText === undefined ? "" : lineText);
  const caret = Number.isInteger(ch) ? ch : -1;
  if (caret < 0 || caret > line.length) {
    return null;
  }
  let found = null;
  let index = 0;
  while (index + 1 < line.length) {
    if (line[index] === "(" && line[index + 1] === "(") {
      if (taskWikilinkIsValidOpener(line, index)) {
        const field = taskWikilinkFieldAtToken(
          line,
          taskWikilinkTokenFromOpener(line, index),
          caret,
        );
        if (field) {
          found = field;
        }
      }
      index += 1;
    } else {
      index += 1;
    }
  }
  return found;
}

// True when `position` (a UTF-16 offset on `lineText`) sits inside one of
// `spans` (half-open `[start, end)`).
function taskWikilinkSpanCovers(spans, position) {
  return (spans || []).some(
    (span) =>
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      position >= span.start &&
      position < span.end,
  );
}

// Backtick runs pair into code spans by equal length, so "`a` and `b`"
// yields two spans. An unmatched run is literal text, never a span.
function taskWikilinkInlineCodeSpans(lineText) {
  const runs = [];
  let index = 0;
  while (index < lineText.length) {
    if (lineText[index] !== "`") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < lineText.length && lineText[end] === "`") {
      end += 1;
    }
    runs.push({ start: index, end });
    index = end;
  }
  const spans = [];
  for (let run = 0; run + 1 < runs.length; run += 2) {
    if (runs[run].end - runs[run].start === runs[run + 1].end - runs[run + 1].start) {
      spans.push({ start: runs[run].start, end: runs[run + 1].end });
    }
  }
  return spans;
}

// Remove code spans so a `$$` or `%%` inside backticks never toggles a
// block state below.
function taskWikilinkStripCodeSpans(lineText) {
  let stripped = String(lineText || "");
  for (const span of taskWikilinkInlineCodeSpans(stripped).sort((a, b) => b.start - a.start)) {
    stripped = `${stripped.slice(0, span.start)}${" ".repeat(span.end - span.start)}${stripped.slice(span.end)}`;
  }
  return stripped;
}

function taskWikilinkCountOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  while (true) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) {
      return count;
    }
    count += 1;
    from = found + needle.length;
  }
}

// Pair single-`$` delimiters on one line (`$$` pairs are block math,
// handled by the block toggle). An escaped `\$` never opens math.
function taskWikilinkInlineMathSpans(lineText) {
  const masked = String(lineText || "").replace(/\$\$/g, "  ");
  const positions = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === "$" && masked[index - 1] !== "\\") {
      positions.push(index);
    }
  }
  const spans = [];
  for (let pair = 0; pair + 1 < positions.length; pair += 2) {
    spans.push({ start: positions[pair], end: positions[pair + 1] + 1 });
  }
  return spans;
}

// Pair `%%` delimiters on one line; a lone `%%` opens a comment block,
// handled by the block toggle.
function taskWikilinkInlineCommentSpans(lineText) {
  const positions = [];
  let index = 0;
  while (index + 1 < lineText.length) {
    if (lineText[index] === "%" && lineText[index + 1] === "%") {
      positions.push(index);
      index += 2;
    } else {
      index += 1;
    }
  }
  const spans = [];
  for (let pair = 0; pair + 1 < positions.length; pair += 2) {
    spans.push({ start: positions[pair], end: positions[pair + 1] + 2 });
  }
  return spans;
}

// Every `[[...]]` span on the line, alias included. An unclosed `[[`
// covers the rest of the line, matching bob's protected-markup verdict
// for `See [[note ((x`.
function taskWikilinkWikiLinkSpans(lineText) {
  const spans = [];
  let searchFrom = 0;
  while (searchFrom <= lineText.length) {
    const open = lineText.indexOf("[[", searchFrom);
    if (open === -1) {
      return spans;
    }
    const close = lineText.indexOf("]]", open + 2);
    if (close === -1) {
      // An unclosed `[[` covers the rest of the line including the
      // end-of-line caret, matching bob's protected-markup verdict.
      spans.push({ start: open, end: lineText.length + 1 });
      return spans;
    }
    spans.push({ start: open, end: close + 2 });
    searchFrom = close + 2;
  }
  return spans;
}

// Markdown link labels (`[...]`) and their destinations (`](...)`).
function taskWikilinkMarkdownLinkSpans(lineText) {
  TASK_WIKILINK_BRACKET_RE.lastIndex = 0;
  const spans = [];
  let match;
  while ((match = TASK_WIKILINK_BRACKET_RE.exec(lineText)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    const rest = lineText.slice(match.index + match[0].length);
    if (rest[0] === "(") {
      const close = rest.indexOf(")");
      if (close !== -1) {
        const destStart = match.index + match[0].length;
        spans.push({ start: destStart, end: destStart + close + 1 });
      }
    }
  }
  TASK_WIKILINK_BRACKET_RE.lastIndex = 0;
  return spans;
}

function taskWikilinkAutolinkSpans(lineText) {
  return [...lineText.matchAll(TASK_WIKILINK_AUTOLINK_RE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

// Bare URLs (`https://…`, `www.…`, `mailto:…`). One trailing run of
// sentence punctuation is not part of the link, and a trailing `)` only
// counts when the URL itself holds no `(` (Wikipedia-style links keep
// theirs).
function taskWikilinkBareUrlSpans(lineText) {
  return [...lineText.matchAll(TASK_WIKILINK_BARE_URL_RE)].map((match) => {
    let end = match.index + match[0].length;
    while (end > match.index && /[.,;:!?]/.test(lineText[end - 1])) {
      end -= 1;
    }
    if (
      end > match.index &&
      lineText[end - 1] === ")" &&
      !lineText.slice(match.index, end).includes("(")
    ) {
      end -= 1;
    }
    return { start: match.index, end };
  });
}

// Mirror `lineIsInsideCodeFence` over a line array so the context check
// stays pure. Like that helper, an opening fence line already counts as
// inside once the fence is open above it, and a closing fence line
// counts as inside too.
function taskWikilinkLineInFence(docLines, line) {
  let activeFence = null;
  for (let current = 0; current <= line; current += 1) {
    const lineText = String((docLines || [])[current] || "");
    if (!activeFence) {
      const openingFence = getFenceOpening(lineText);
      if (openingFence) {
        activeFence = openingFence;
      }
      continue;
    }
    if (isClosingFence(lineText, activeFence)) {
      if (current === line) {
        return true;
      }
      activeFence = null;
    }
  }
  return Boolean(activeFence);
}

// A `$$` line toggles math-block state; an even count (an inline `$$x$$`)
// leaves it unchanged. Only text before the caret counts on the cursor
// line, so a closed `$$x$$` excludes just its inside.
function taskWikilinkDollarBlockInside(docLines, line, ch) {
  let inside = false;
  for (let current = 0; current < line; current += 1) {
    if (taskWikilinkCountOccurrences(taskWikilinkStripCodeSpans((docLines || [])[current] || ""), "$$") % 2 === 1) {
      inside = !inside;
    }
  }
  const prefix = taskWikilinkStripCodeSpans(String((docLines || [])[line] || "").slice(0, ch));
  if (taskWikilinkCountOccurrences(prefix, "$$") % 2 === 1) {
    inside = !inside;
  }
  return inside;
}

// Same toggle shape for `%%` comment blocks and inline `%%…%%`.
function taskWikilinkPercentBlockInside(docLines, line, ch) {
  let inside = false;
  for (let current = 0; current < line; current += 1) {
    if (taskWikilinkCountOccurrences(taskWikilinkStripCodeSpans((docLines || [])[current] || ""), "%%") % 2 === 1) {
      inside = !inside;
    }
  }
  const prefix = taskWikilinkStripCodeSpans(String((docLines || [])[line] || "").slice(0, ch));
  if (taskWikilinkCountOccurrences(prefix, "%%") % 2 === 1) {
    inside = !inside;
  }
  return inside;
}

// `<!--` / `-->` markers in document order; the last marker before the
// caret decides. Whole earlier lines count fully, the cursor line only to
// the caret.
function taskWikilinkHtmlCommentInside(docLines, line, ch) {
  let inside = false;
  const applyMarkers = (text) => {
    TASK_WIKILINK_HTML_MARKER_RE.lastIndex = 0;
    let match;
    while ((match = TASK_WIKILINK_HTML_MARKER_RE.exec(text)) !== null) {
      inside = match[0] === "<!--";
    }
    TASK_WIKILINK_HTML_MARKER_RE.lastIndex = 0;
  };
  for (let current = 0; current < line; current += 1) {
    applyMarkers(String((docLines || [])[current] || ""));
  }
  applyMarkers(String((docLines || [])[line] || "").slice(0, ch));
  return inside;
}

function taskWikilinkFrontmatterEnd(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  if (!startsWithFrontmatter(lines)) {
    return -1;
  }
  for (let current = 1; current < lines.length; current += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(String(lines[current] || ""))) {
      return current;
    }
  }
  return lines.length;
}

// Classify the caret for the `((` trigger: `{ allowed, notice }`.
// Managed and relation lines are never tokens and carry their existing
// guard notice; every other exclusion carries no notice. Reading view,
// multiple cursors, and IME composition are enforced by the wiring, not
// here: they are editor states, not document positions.
function taskWikilinkContextAt(docLines, line, ch) {
  const lines = Array.isArray(docLines) ? docLines : [];
  const caret = Number.isInteger(ch) ? ch : -1;
  if (!Number.isInteger(line) || line < 0 || line >= lines.length || caret < 0) {
    return { allowed: false, notice: null };
  }
  const lineText = String(lines[line] || "");
  if (caret > lineText.length) {
    return { allowed: false, notice: null };
  }

  const frontmatterEnd = taskWikilinkFrontmatterEnd(lines);
  if (frontmatterEnd !== -1 && line <= frontmatterEnd) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkLineInFence(lines, line)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkDollarBlockInside(lines, line, caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkPercentBlockInside(lines, line, caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkHtmlCommentInside(lines, line, caret)) {
    return { allowed: false, notice: null };
  }

  if (isManagedDependencyLine(lineText)) {
    if (isTaskDependencyLine(lineText) || isMalformedTaskDependencyLine(lineText)) {
      return { allowed: false, notice: TASK_DEPENDENCY_LINE_NOTICE };
    }
    return { allowed: false, notice: TASK_BLOCKS_LINE_NOTICE };
  }
  if (isTaskRelationLine(lineText)) {
    return { allowed: false, notice: taskRelationLineNotice(lineText) };
  }
  if (isPomodoroEntryLine(lineText)) {
    return { allowed: false, notice: null };
  }

  if (taskWikilinkSpanCovers(taskWikilinkInlineCodeSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkInlineMathSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkInlineCommentSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkWikiLinkSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkMarkdownLinkSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkAutolinkSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  if (taskWikilinkSpanCovers(taskWikilinkBareUrlSpans(lineText), caret)) {
    return { allowed: false, notice: null };
  }
  return { allowed: true, notice: null };
}

// The picker opens only when the edit just made wrote the token's second
// `(` (`opener + 1`, a global offset via `lineStartOffset`). `writtenRanges`
// holds inserted ranges as `[start, end)` pairs or `{ start, end }`
// objects; deletions and caret moves record nothing, so they never match.
function taskWikilinkWrittenSecondParen(token, writtenRanges, lineStartOffset) {
  if (!token || !Number.isInteger(token.opener)) {
    return false;
  }
  const base = Number.isInteger(lineStartOffset) ? lineStartOffset : 0;
  const secondParen = base + token.opener + 1;
  const ranges = Array.isArray(writtenRanges) ? writtenRanges : [];
  return ranges.some((range) => {
    if (!range) {
      return false;
    }
    const start = Array.isArray(range) ? range[0] : range.start;
    const end = Array.isArray(range) ? range[1] : range.end;
    return Number.isInteger(start) && Number.isInteger(end) && start <= secondParen && secondParen < end;
  });
}

// Normalize one caller-supplied change set to sorted original-coordinate
// changes (`{ from, to, text }`; `to` defaults to `from` for pure
// insertions, `text` accepts the CodeMirror `insert` spelling).
function normalizeTaskWikilinkChanges(changeSet) {
  const list = Array.isArray(changeSet) ? changeSet : (changeSet && changeSet.changes) || [];
  return list
    .map((change) => ({
      from: change ? change.from : undefined,
      to: change && change.to !== undefined ? change.to : change ? change.from : undefined,
      text: change && change.text !== undefined ? change.text : change ? change.insert : undefined,
    }))
    .filter((change) => Number.isInteger(change.from) && Number.isInteger(change.to) && change.from <= change.to)
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

// Map one position through a single adjusted change (insert-leaning:
// positions inside a replaced range land at the end of the insertion).
function taskWikilinkMapChangePosition(position, from, to, insertLength) {
  if (position <= from) {
    return position;
  }
  if (position >= to) {
    return position + insertLength - (to - from);
  }
  return from + insertLength;
}

function taskWikilinkRangeStart(range) {
  return Array.isArray(range) ? range[0] : range.start;
}

function taskWikilinkRangeEnd(range) {
  return Array.isArray(range) ? range[1] : range.end;
}

function taskWikilinkSetRange(range, start, end) {
  if (Array.isArray(range)) {
    range[0] = start;
    range[1] = end;
  } else {
    range.start = start;
    range.end = end;
  }
}

// Map recorded written ranges forward through later changes. Later
// changes map them forward, and each scan clears them; an emptied range
// simply never contains a second paren again.
function mapTaskWikilinkRanges(ranges, changeSet) {
  const out = Array.isArray(ranges) ? ranges : [];
  const changes = normalizeTaskWikilinkChanges(changeSet);
  let shift = 0;
  const adjusted = changes.map((change) => {
    const insertLength = String(change.text === undefined || change.text === null ? "" : change.text).length;
    const mapped = { from: change.from + shift, to: change.to + shift, insertLength };
    shift += insertLength - (change.to - change.from);
    return mapped;
  });
  for (const range of out) {
    if (!range) {
      continue;
    }
    let start = taskWikilinkRangeStart(range);
    let end = taskWikilinkRangeEnd(range);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      continue;
    }
    for (const change of adjusted) {
      start = taskWikilinkMapChangePosition(start, change.from, change.to, change.insertLength);
      end = taskWikilinkMapChangePosition(end, change.from, change.to, change.insertLength);
    }
    taskWikilinkSetRange(range, start, end);
  }
  return out;
}

// Record one change set's insertions as written ranges (the plan's
// `addChanges` accumulator), mapping earlier ranges forward first. Only
// user-input transactions reach this helper; undo, redo, programmatic
// `replaceRange`, and vault-sync reloads never call it, so their edits
// can only shrink ranges via `mapTaskWikilinkRanges`, never open the
// picker.
function addTaskWikilinkChanges(ranges, changeSet) {
  const out = Array.isArray(ranges) ? ranges : [];
  const changes = normalizeTaskWikilinkChanges(changeSet);
  mapTaskWikilinkRanges(out, changes);
  let shift = 0;
  for (const change of changes) {
    const insertLength = String(change.text === undefined || change.text === null ? "" : change.text).length;
    if (insertLength > 0) {
      const start = change.from + shift;
      out.push({ start, end: start + insertLength });
    }
    shift += insertLength - (change.to - change.from);
  }
  return out;
}
