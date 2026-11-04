// Task-split planner. JS twin of bob-cli `src/native/task_split/plan.rs`,
// pinned byte-for-byte by `scripts/fixtures/task_split/vectors.json`
// (SP1–SP30). Pure: no Obsidian imports, so the node vectors script and the
// gesture share it. `planSplitBullets(files, request)` mirrors
// `plan_task_split`; `listTaskSplitCandidates(files, request)` mirrors
// `list_task_split_candidates`.
//
// Request shape (all lines 1-based):
//   { ownerPath, ownerLine, selection, today, settings }
// where selection is one of:
//   { kind: "cursor", line } | { kind: "count", line, count } |
//   { kind: "lines", from, to } | { kind: "nth", picks } |
//   { kind: "match", texts } | { kind: "section", title } |
//   { kind: "bulletref", ref }
// and settings is { linked_from_mentions, linked_from_lines, inbox_route }.
// `options.lineDigest` is an optional sync digest for the CLI-only bulletref
// selector (SHA-256 of the Rust-trimmed line, first 8 hex chars).
//
// Success: { ok: true, files, tasks, stubs, placement, notice, cursor,
//   clamped, owner_minted_id, owner_path, owner_line }.
// Failure: { ok: false, code, message } with the §5.1 codes verbatim.

// Drawer titles are the note-drawer grammar from
// `capture_drawers::is_drawer_title`: an uppercase/digit lead, the drawer
// rest alphabet, and at least one letter. `buildProjectSeedFromChildBullets`
// gates its section titles on this same predicate.
function isTaskSplitDrawerTitle(title) {
  const text = String(title || "");
  if (text.length === 0) {
    return false;
  }
  const first = text.charAt(0);
  if (!isTaskSplitDrawerTitleFirst(first)) {
    return false;
  }
  let hasLetter = first >= "A" && first <= "Z";
  for (let index = 1; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (!isTaskSplitDrawerTitleRest(character)) {
      return false;
    }
    if (character >= "A" && character <= "Z") {
      hasLetter = true;
    }
  }
  return hasLetter;
}

function isTaskSplitDrawerTitleFirst(character) {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9")
  );
}

function isTaskSplitDrawerTitleRest(character) {
  return (
    isTaskSplitDrawerTitleFirst(character) ||
    character === " " ||
    character === "\t" ||
    character === "&" ||
    character === "'" ||
    character === "(" ||
    character === ")" ||
    character === "," ||
    character === "." ||
    character === "/" ||
    character === "-"
  );
}

// --- Block-ID mint pipeline (mirrors `capture_block_ids`) ---

const TASK_SPLIT_STOPWORDS = new Set(
  "a|an|and|as|at|be|by|for|from|in|into|is|it|its|my|of|on|or|our|so|that|the|their|this|to|via|with|your".split(
    "|",
  ),
);
const TASK_SPLIT_FILLER_WORDS = new Set(
  "ability|add|all|get|make|new|should|start|support|use".split("|"),
);
const TASK_SPLIT_FILLER_LEADINS = [
  ["make", "it", "possible", "to"],
  ["figure", "out", "how", "to"],
  ["add", "support", "for"],
  ["add", "ability", "to"],
  ["make", "sure", "that"],
  ["figure", "out", "how"],
  ["make", "sure"],
  ["figure", "out"],
];
const TASK_SPLIT_SKIP_LEADING_VERBS = new Set(
  "allow|ask|build|check|clean|create|document|enable|ensure|finish|implement|improve|investigate|let|migrate|move|need|plan|please|refactor|remove|rename|review|run|stop|try|update|want|write".split(
    "|",
  ),
);
const TASK_SPLIT_WEAK_TRAILING = new Set(
  "bug|code|docs|documentation|file|issue|item|items|note|notes|stuff|support|task|tasks|test|tests|testing|thing|things|today|tonight|work".split(
    "|",
  ),
);
const TASK_SPLIT_FIRST_SUGGESTION_MAX_BYTES = 20;

function taskSplitRawWords(text) {
  const words = [];
  let current = "";
  const flush = () => {
    if (current) {
      words.push(current);
      current = "";
    }
  };
  for (const character of String(text || "")) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      current += character.toLowerCase();
    } else {
      flush();
    }
  }
  flush();
  return words;
}

function taskSplitWordsIn(text) {
  return taskSplitRawWords(text).filter(
    (word) => !TASK_SPLIT_STOPWORDS.has(word),
  );
}

function taskSplitContentWords(text) {
  let words = taskSplitRawWords(text);
  for (const leadin of TASK_SPLIT_FILLER_LEADINS) {
    if (
      words.length >= leadin.length &&
      leadin.every((lead, index) => words[index] === lead)
    ) {
      words = words.slice(leadin.length);
      break;
    }
  }
  words = words.filter(
    (word) =>
      !TASK_SPLIT_STOPWORDS.has(word) && !TASK_SPLIT_FILLER_WORDS.has(word),
  );
  while (
    words.length >= 4 &&
    TASK_SPLIT_SKIP_LEADING_VERBS.has(words[0])
  ) {
    words.shift();
  }
  while (words.length >= 2 && TASK_SPLIT_WEAK_TRAILING.has(words[words.length - 1])) {
    words.pop();
  }
  return words;
}

function taskSplitSchemeUriPrefix(rest) {
  const text = String(rest || "");
  if (text.length < 4 || !/^[A-Za-z]/.test(text.charAt(0))) {
    return 0;
  }
  let index = 1;
  while (
    index < text.length &&
    /^[A-Za-z0-9+.-]$/.test(text.charAt(index))
  ) {
    index += 1;
  }
  return text.slice(index, index + 3) === "://" ? index + 3 : 0;
}

function taskSplitUrlRunEnd(body, index) {
  const rest = String(body || "").slice(index);
  let prefix = 0;
  if (rest.length >= 4 && rest.slice(0, 4).toLowerCase() === "www.") {
    prefix = 4;
  } else {
    prefix = taskSplitSchemeUriPrefix(rest);
  }
  if (!prefix) {
    return -1;
  }
  let end = index + prefix;
  while (end < body.length && !/\s/.test(body.charAt(end))) {
    end += 1;
  }
  return end;
}

function taskSplitClosingParenEnd(body, open) {
  const close = String(body || "").indexOf(")", open + 1);
  return close === -1 ? -1 : close + 1;
}

function taskSplitMarkdownLinkAt(body, index) {
  const text = String(body || "");
  if (!text.startsWith("[", index) || text.startsWith("[[", index)) {
    return null;
  }
  const close = text.indexOf("]", index + 1);
  if (close === -1) {
    return null;
  }
  if (!text.startsWith("(", close + 1)) {
    return null;
  }
  const end = taskSplitClosingParenEnd(text, close + 1);
  if (end === -1) {
    return null;
  }
  return { label: text.slice(index + 1, close), end };
}

// Body with Markdown link destinations and bare URLs removed, labels kept.
function taskSplitProseText(body) {
  const text = String(body || "");
  let out = "";
  let index = 0;
  while (index < text.length) {
    const urlEnd = taskSplitUrlRunEnd(text, index);
    if (urlEnd !== -1) {
      out += " ";
      index = urlEnd;
      continue;
    }
    const link = taskSplitMarkdownLinkAt(text, index);
    if (link) {
      out += link.label;
      index = link.end;
      continue;
    }
    if (
      text.charAt(index) === "(" &&
      index > 0 &&
      text.charAt(index - 1) === "]"
    ) {
      const end = taskSplitClosingParenEnd(text, index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    out += text.charAt(index);
    index += 1;
  }
  return out;
}

function taskSplitWikilinkPhrase(inner) {
  const text = String(inner || "");
  const pipe = text.indexOf("|");
  if (pipe !== -1) {
    return text.slice(pipe + 1);
  }
  const hash = text.indexOf("#");
  const target = hash === -1 ? text : text.slice(0, hash);
  const slash = target.lastIndexOf("/");
  return slash === -1 ? target : target.slice(slash + 1);
}

function taskSplitPhraseSpans(body) {
  const text = String(body || "");
  const phrases = [];
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "`") {
      const close = text.indexOf("`", index + 1);
      if (close !== -1) {
        phrases.push(text.slice(index + 1, close));
        index = close + 1;
        continue;
      }
      index += 1;
    } else if (character === '"' || text.startsWith("\u201C", index)) {
      const openLength = 1;
      const rest = text.slice(index + openLength);
      let offset = -1;
      for (let scan = 0; scan < rest.length; scan += 1) {
        if (rest[scan] === '"' || rest[scan] === "\u201D") {
          offset = scan;
          break;
        }
      }
      if (offset !== -1) {
        phrases.push(rest.slice(0, offset));
        index = index + openLength + offset + 1;
        continue;
      }
      index += openLength;
    } else if (character === "(") {
      if (index > 0 && text.charAt(index - 1) === "]") {
        const end = taskSplitClosingParenEnd(text, index);
        if (end !== -1) {
          index = end;
          continue;
        }
        index += 1;
        continue;
      }
      const close = text.indexOf(")", index + 1);
      if (close !== -1) {
        phrases.push(text.slice(index + 1, close));
        index = close + 1;
        continue;
      }
      index += 1;
    } else if (text.startsWith("[[", index)) {
      const close = text.indexOf("]]", index + 2);
      if (close !== -1) {
        phrases.push(taskSplitWikilinkPhrase(text.slice(index + 2, close)));
        index = close + 2;
        continue;
      }
      index += 2;
    } else {
      const link = taskSplitMarkdownLinkAt(text, index);
      if (link) {
        if (taskSplitWordsIn(link.label).length > 0) {
          phrases.push(link.label);
        }
        index = link.end;
      } else {
        index += 1;
      }
    }
  }
  return phrases;
}

function taskSplitReduceWikilinks(text) {
  const source = String(text || "");
  let out = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("[[", index)) {
      const close = source.indexOf("]]", index + 2);
      if (close !== -1) {
        out += taskSplitWikilinkPhrase(source.slice(index + 2, close));
        index = close + 2;
        continue;
      }
    }
    out += source.charAt(index);
    index += 1;
  }
  return out;
}

// Display text for minting and aliases: wikilinks flatten to their display
// text (alias, or the pre-`#` target without basename reduction) and Markdown
// links flatten to their label. Mirrors `flatten_links`, not the basename
// `wikilink_phrase` used for suggestions.
function taskSplitFlattenLinks(text) {
  const reduced = String(text || "").replace(
    /\[\[([^\]]+)\]\]/g,
    (match, inner) => {
      const pipe = String(inner).indexOf("|");
      if (pipe !== -1) {
        return String(inner).slice(pipe + 1);
      }
      const hash = String(inner).indexOf("#");
      return hash === -1 ? String(inner) : String(inner).slice(0, hash);
    },
  );
  return reduced.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function taskSplitIsValidBlockId(id) {
  const text = String(id || "");
  return text.length > 0 && /^[A-Za-z0-9-]+$/.test(text);
}

function taskSplitJoinTruncated(words) {
  if (!words.length) {
    return null;
  }
  const joined = words.join("-");
  let truncated = joined;
  if (joined.length > 32) {
    const cut = joined.slice(0, 32).lastIndexOf("-");
    if (cut <= 0) {
      return null;
    }
    truncated = joined.slice(0, cut);
  }
  if (!truncated || !taskSplitIsValidBlockId(truncated)) {
    return null;
  }
  return truncated;
}

function taskSplitSuggestIds(body, used) {
  const usedSet = used instanceof Set ? used : new Set(used || []);
  const prose = taskSplitContentWords(
    taskSplitProseText(taskSplitReduceWikilinks(body)),
  );
  const three =
    prose.length > 0
      ? taskSplitJoinTruncated(prose.slice(0, Math.min(3, prose.length)))
      : null;
  const two =
    prose.length >= 2 ? taskSplitJoinTruncated(prose.slice(0, 2)) : null;
  const candidates = [];
  if (three && three.length <= TASK_SPLIT_FIRST_SUGGESTION_MAX_BYTES) {
    if (three) {
      candidates.push(three);
    }
    if (two) {
      candidates.push(two);
    }
  } else {
    if (two) {
      candidates.push(two);
    }
    if (three) {
      candidates.push(three);
    }
  }
  for (const phrase of taskSplitPhraseSpans(body)) {
    const words = taskSplitWordsIn(phrase);
    if (words.length === 0) {
      continue;
    }
    const joined = taskSplitJoinTruncated(
      words.slice(0, Math.min(4, words.length)),
    );
    if (joined) {
      candidates.push(joined);
    }
    break;
  }
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      deduped.push(candidate);
    }
  }
  const out = [];
  for (const candidate of deduped) {
    if (!usedSet.has(candidate)) {
      out.push(candidate);
    } else {
      let placed = null;
      for (let suffix = 2; suffix <= 9; suffix += 1) {
        const suffixed = `${candidate}-${suffix}`;
        if (suffixed.length > 64) {
          continue;
        }
        if (
          !taskSplitIsValidBlockId(suffixed) ||
          usedSet.has(suffixed) ||
          seen.has(suffixed)
        ) {
          continue;
        }
        placed = suffixed;
        break;
      }
      if (placed) {
        seen.add(placed);
        out.push(placed);
      }
    }
    if (out.length >= 3) {
      break;
    }
  }
  return out;
}

// Mint a block ID for a split task: the first suggestion, else the first
// free `task`, `task-2`, … ID. Mirrors `capture_block_ids::mint_block_id`.
function taskSplitMintBlockId(description, used) {
  const usedSet = used instanceof Set ? used : new Set(used || []);
  const first = taskSplitSuggestIds(description, usedSet)[0];
  if (first) {
    return first;
  }
  if (!usedSet.has("task")) {
    return "task";
  }
  let suffix = 2;
  for (;;) {
    const candidate = `task-${suffix}`;
    if (!usedSet.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

// --- Line helpers (mirror the private helpers in `plan.rs`) ---

function taskSplitLines(contents) {
  const text = String(contents || "");
  if (text === "") {
    return [];
  }
  const parts = text.split("\n");
  const lines = [];
  for (let index = 0; index < parts.length; index += 1) {
    const last = index === parts.length - 1;
    lines.push(last ? parts[index] : `${parts[index]}\n`);
  }
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function taskSplitStripEnding(line) {
  const text = String(line || "");
  if (text.endsWith("\r\n")) {
    return text.slice(0, -2);
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return text.slice(0, -1);
  }
  return text;
}

function taskSplitSplitEnding(line) {
  const text = String(line || "");
  if (text.endsWith("\r\n")) {
    return [text.slice(0, -2), "\r\n"];
  }
  if (text.endsWith("\n")) {
    return [text.slice(0, -1), "\n"];
  }
  return [text, ""];
}

function taskSplitIndentOf(line) {
  const text = taskSplitStripEnding(line);
  const match = /^[ \t]*/.exec(text);
  return match ? match[0] : "";
}

function taskSplitIndentLen(line) {
  const text = String(line == null ? "" : line);
  let length = 0;
  while (
    length < text.length &&
    (text.charAt(length) === " " || text.charAt(length) === "\t")
  ) {
    length += 1;
  }
  return length;
}

function taskSplitListBody(line) {
  const text = taskSplitStripEnding(line).trimStart();
  return text.startsWith("- ") ? text.slice(2) : null;
}

function taskSplitParentListLine(lines, index, floor) {
  const currentLen = taskSplitIndentLen(taskSplitStripEnding(lines[index]));
  for (let prior = index - 1; prior >= floor; prior -= 1) {
    if (
      taskSplitListBody(lines[prior]) !== null &&
      taskSplitIndentLen(taskSplitStripEnding(lines[prior])) < currentLen
    ) {
      return prior;
    }
  }
  return null;
}

function taskSplitListSubtreeEnd(lines, start, limit) {
  const stripped = lines.map((line) => taskSplitStripEnding(line));
  const base = taskSplitIndentLen(stripped[start]);
  let end = start;
  for (let index = start + 1; index <= Math.min(limit, stripped.length - 1); index += 1) {
    const line = stripped[index];
    if (line.trim() === "") {
      continue;
    }
    if (taskSplitIndentLen(line) <= base) {
      return end;
    }
    end = index;
  }
  return end;
}

function taskSplitHeading(line) {
  const text = taskSplitStripEnding(line).trimStart();
  if (!text.startsWith("## ")) {
    return null;
  }
  return text.slice(3).trim().replace(/#+$/, "").trim();
}

function taskSplitIsBlockIdByte(character) {
  return /^[A-Za-z0-9-]$/.test(character);
}

function taskSplitTrailingBlockId(text) {
  const trimmed = String(text || "").replace(/[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/, "");
  const caret = trimmed.lastIndexOf("^");
  if (caret === -1) {
    return null;
  }
  const id = trimmed.slice(caret + 1);
  if (id.length === 0) {
    return null;
  }
  for (const character of id) {
    if (!taskSplitIsBlockIdByte(character)) {
      return null;
    }
  }
  if (caret > 0 && !/\s/.test(trimmed.charAt(caret - 1))) {
    return null;
  }
  return id;
}

function taskSplitBlockIdsInMarkdown(contents) {
  const ids = [];
  for (const line of taskSplitLines(contents)) {
    const [content] = taskSplitSplitEnding(line);
    const id = taskSplitTrailingBlockId(content);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

function taskSplitSetTrailingBlockId(line, id) {
  if (taskSplitTrailingBlockId(taskSplitStripEnding(line)) !== null) {
    return String(line || "");
  }
  const [content, ending] = taskSplitSplitEnding(line);
  return `${content.trimEnd()} ^${id}${ending}`;
}

function taskSplitWithoutTrailingId(title) {
  const text = String(title || "").trimEnd();
  const id = taskSplitTrailingBlockId(text);
  if (id === null) {
    return text;
  }
  return text.slice(0, text.length - id.length - 1).trimEnd();
}

function taskSplitParseBullet(body) {
  const trimmed = String(body || "").trim();
  if (trimmed.startsWith("[ ] ")) {
    return { title: trimmed.slice(4), checked: false };
  }
  if (trimmed.startsWith("[x] ") || trimmed.startsWith("[X] ")) {
    return { title: trimmed.slice(4), checked: true };
  }
  return { title: trimmed, checked: false };
}

function taskSplitIsStub(title) {
  const text = String(title || "").trim();
  return (
    (text.startsWith("[[") &&
      text.endsWith("]]") &&
      !text.slice(2, Math.max(0, text.length - 2)).includes(" ")) ||
    (text.startsWith("[[") && !text.includes("]] ") && text.endsWith("]]"))
  );
}

function taskSplitBlockIdBeforeInlineFields(line) {
  const match = /\s+\^([A-Za-z0-9-]+)(?:\s+\[[A-Za-z][A-Za-z0-9_-]*::[^\]]*\])+\s*$/.exec(
    String(line || ""),
  );
  return match ? match[1] : null;
}

function taskSplitAliasFor(title) {
  const text = taskSplitFlattenLinks(title)
    .split("**").join("")
    .split("__").join("")
    .split("==").join("")
    .split("~~").join("")
    .split("`").join("")
    .split("|").join("/")
    .split("[").join("")
    .split("]").join("");
  const collapsed = text.split(/\s+/).filter(Boolean).join(" ");
  if ([...collapsed].length <= 80) {
    return collapsed;
  }
  let out = "";
  for (const word of collapsed.split(/\s+/).filter(Boolean)) {
    const nextLength =
      [...out].length + [...word].length + (out ? 1 : 0) + 1;
    if (nextLength > 80) {
      break;
    }
    out += (out ? " " : "") + word;
  }
  return `${out}\u2026`;
}

function taskSplitShortNoticeTitle(title) {
  const collapsed = String(title || "").split(/\s+/).filter(Boolean).join(" ");
  if ([...collapsed].length <= 80) {
    return collapsed;
  }
  let out = "";
  for (const word of collapsed.split(/\s+/).filter(Boolean)) {
    const nextLength =
      [...out].length + [...word].length + (out ? 1 : 0) + 1;
    if (nextLength > 80) {
      break;
    }
    out += (out ? " " : "") + word;
  }
  return `${out}\u2026`;
}

function taskSplitInlineField(line, name) {
  const pattern = new RegExp(
    `\\[${name}::\\s*([^\\]]+)\\]`,
  );
  const match = pattern.exec(String(line || ""));
  return match ? match[1].trim() : null;
}

function taskSplitPathWithMd(route) {
  const text = String(route || "");
  if (/\.[A-Za-z0-9]+$/.test(text)) {
    return text;
  }
  return `${text}.md`;
}

function taskSplitNoteTarget(path) {
  return String(path || "").replace(/\.md$/, "").replace(/\\/g, "/");
}

function taskSplitOwnerIndent(line) {
  return taskSplitIndentOf(line);
}

// --- Owner scan (mirrors `note_tasks::scan` for task owners) ---

function taskSplitFrontmatterEnd(stripped) {
  if (stripped.length === 0 || stripped[0].trimEnd() !== "---") {
    return -1;
  }
  for (let index = 1; index < stripped.length; index += 1) {
    if (stripped[index].trimEnd() === "---") {
      return index;
    }
  }
  return -1;
}

function taskSplitFenceMarker(line) {
  const text = String(line || "");
  let indentation = 0;
  while (indentation < text.length && text.charAt(indentation) === " ") {
    indentation += 1;
  }
  if (indentation > 3) {
    return null;
  }
  const rest = text.slice(indentation);
  const character = rest.charAt(0);
  if (character !== "`" && character !== "~") {
    return null;
  }
  let length = 0;
  while (rest.charAt(length) === character) {
    length += 1;
  }
  return length >= 3 ? { character, length } : null;
}

function taskSplitFencedLines(stripped, start) {
  const fenced = new Set();
  let open = null;
  for (let index = start; index < stripped.length; index += 1) {
    const line = stripped[index];
    if (open) {
      fenced.add(index);
      const marker = taskSplitFenceMarker(line);
      if (
        marker &&
        marker.character === open.character &&
        marker.length >= open.length &&
        line.trimStart().slice(marker.length).trim() === ""
      ) {
        open = null;
      }
    } else {
      const marker = taskSplitFenceMarker(line);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  return fenced;
}

// A task line is an indented `- [x] body` whose body carries the `#task`
// token. Mirrors `note_tasks::parse_task_line` with the default filter.
function taskSplitParseTaskLine(line) {
  const text = taskSplitStripEnding(line);
  let end = 0;
  while (end < text.length && /\s/.test(text.charAt(end))) {
    end += 1;
  }
  const indentation = text.slice(0, end);
  const after = text.slice(end);
  if (!after.startsWith("- [")) {
    return null;
  }
  const symbol = after.charAt(3);
  if (symbol === "") {
    return null;
  }
  if (!after.startsWith("] ", 3 + symbol.length)) {
    return null;
  }
  const body = after.slice(3 + symbol.length + 1);
  if (!body.split(/\s+/).some((token) => token === "#task")) {
    return null;
  }
  return { indentation, statusSymbol: symbol, body };
}

function taskSplitCleanDescription(body, blockId) {
  let withoutBlock = String(body || "");
  if (blockId) {
    const suffix = `^${blockId}`;
    const trimmed = withoutBlock.trimEnd();
    if (trimmed.endsWith(suffix)) {
      withoutBlock = trimmed.slice(0, trimmed.length - suffix.length);
    }
  }
  const withoutFields = withoutBlock.replace(
    /\[[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]*\]/g,
    " ",
  );
  const out = [];
  let prevDroppedFilter = false;
  for (const token of withoutFields.split(/\s+/)) {
    if (token === "#task") {
      prevDroppedFilter = true;
      continue;
    }
    if (prevDroppedFilter && token.toLowerCase() === "#ref") {
      prevDroppedFilter = false;
      continue;
    }
    prevDroppedFilter = false;
    if (token) {
      out.push(token);
    }
  }
  return out.join(" ");
}

function taskSplitBlockEnd(stripped, taskIndex, taskIndent) {
  let index = taskIndex + 1;
  let lastConsumed = taskIndex;
  while (index < stripped.length) {
    if (stripped[index].trim() === "") {
      let next = -1;
      for (let scan = index + 1; scan < stripped.length; scan += 1) {
        if (stripped[scan].trim() !== "") {
          next = scan;
          break;
        }
      }
      if (next !== -1 && taskSplitIndentLen(stripped[next]) > taskIndent) {
        lastConsumed = index;
        index += 1;
        continue;
      }
      break;
    }
    if (taskSplitIndentLen(stripped[index]) <= taskIndent) {
      break;
    }
    lastConsumed = index;
    index += 1;
  }
  return lastConsumed;
}

function taskSplitCancelLogLine(line) {
  const text = String(line || "");
  let indent = 0;
  while (
    indent < text.length &&
    (text.charAt(indent) === " " || text.charAt(indent) === "\t")
  ) {
    indent += 1;
  }
  const rest = text.slice(indent);
  let markerEnd = -1;
  if (
    (rest.charAt(0) === "-" ||
      rest.charAt(0) === "*" ||
      rest.charAt(0) === "+") &&
    (rest.charAt(1) === " " || rest.charAt(1) === "\t")
  ) {
    markerEnd = indent + 1;
  } else {
    let digits = 0;
    while (/^[0-9]$/.test(rest.charAt(digits))) {
      digits += 1;
    }
    if (
      digits > 0 &&
      (rest.charAt(digits) === "." || rest.charAt(digits) === ")") &&
      (rest.charAt(digits + 1) === " " || rest.charAt(digits + 1) === "\t")
    ) {
      markerEnd = indent + digits + 1;
    }
  }
  if (markerEnd === -1) {
    return false;
  }
  const body = text.slice(markerEnd).trimStart();
  return body.startsWith("❌") && body.includes("CANCEL LOG");
}

// Classify one direct-child list line. Managed lines are never splittable;
// drawer titles scope the picker; nested tasks read as authored here because
// the planner validates `#task` lines with a teaching error instead.
function taskSplitClassifyChild(line) {
  const text = String(line || "");
  if (isProjectSubprojectsLine(text)) {
    return { kind: "managed" };
  }
  if (
    isManagedDependencyLine(text) ||
    parseLinksLine(text, {}).verdict !== "not-a-line" ||
    parseLinkedFromLine(text, {}).verdict !== "not-a-line"
  ) {
    return { kind: "managed" };
  }
  if (
    taskSplitCancelLogLine(text) ||
    parseManagedTaskLogParentBullet(text) !== null
  ) {
    return { kind: "managed" };
  }
  const body = taskSplitListBody(text);
  if (body !== null && isTaskSplitDrawerTitle(body.trim())) {
    return { kind: "drawer", title: body.trim() };
  }
  return { kind: "authored" };
}

