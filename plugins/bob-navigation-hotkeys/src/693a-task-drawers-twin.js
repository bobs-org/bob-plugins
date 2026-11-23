// Shared task-drawer reader twin. The bob-cli fixtures are authoritative;
// copy this fragment byte for byte to every plugin that reads task blocks.
// Marker searched by the reader-rollout phase: bob-task-drawer-dual-read-v1

const DRAWER_RESERVED_KEYS = new Set([
  "SCHEDULE LOG", "WORK LOG", "ROTTEN LOG", "CANCEL LOG",
  "DEPENDS ON", "BLOCKS", "LINKS", "LINKS TO", "LINKED FROM", "BACKLINKS",
  "TASKS", "NEXT & IN PROGRESS", "BLOCKED", "DONE & CANCELED",
  "POMODOROS", "EVENTS", "HIGHLIGHTS", "AREAS", "NOTEBOOKS", "ALBUMS", "PROJECTS",
]);
const DRAWER_LEGACY_LOG_KEYS = new Set(["SCHEDULE LOG", "WORK LOG", "ROTTEN LOG"]);
const DRAWER_STRUCTURAL_H2_KEYS = new Set([
  "TASKS", "NEXT & IN PROGRESS", "BLOCKED", "DONE & CANCELED", "POMODOROS",
  "EVENTS", "HIGHLIGHTS", "AREAS", "NOTEBOOKS", "ALBUMS", "PROJECTS",
]);

function is_legacy_drawer_title(title) {
  const chars = Array.from(String(title == null ? "" : title));
  if (!chars.length || !((chars[0] >= "A" && chars[0] <= "Z") || (chars[0] >= "0" && chars[0] <= "9"))) return false;
  let hasLetter = chars[0] >= "A" && chars[0] <= "Z";
  for (let index = 1; index < chars.length; index += 1) {
    const character = chars[index];
    const isLast = index === chars.length - 1;
    const asciiLead = (character >= "A" && character <= "Z") || (character >= "0" && character <= "9");
    if (!asciiLead && !" \t&'(),./-?!;".includes(character) && !(character === ":" && isLast)) return false;
    if (character >= "A" && character <= "Z") hasLetter = true;
  }
  return hasLetter;
}

function drawer_key(title) {
  return String(title == null ? "" : title).trim().replace(/\s+/gu, " ").toUpperCase();
}

function drawer_body_title(body) {
  const value = String(body == null ? "" : body);
  if (/^\[[^\]\r\n]\][ \t]+/u.test(value)) return null;
  const trimmed = value.trim();
  if (is_legacy_drawer_title(trimmed)) return { title: trimmed, marker: "legacy_caps" };
  if (!trimmed.startsWith("**") || !trimmed.endsWith("**")) return null;
  const title = trimmed.slice(2, -2);
  if (!title || /[\r\n*]/u.test(title) || title.trim() !== title || title.endsWith(":")) return null;
  if (!Array.from(title).some((character) => /[\p{L}\p{N}]/u.test(character))) return null;
  return { title, marker: "bold" };
}

function drawer_is_reserved_key(key) {
  return DRAWER_RESERVED_KEYS.has(String(key || ""));
}

function drawer_is_structural_h2_key(key) {
  return DRAWER_STRUCTURAL_H2_KEYS.has(String(key || ""));
}

function drawer_title_refusal(title) {
  if (!title) return "not_a_drawer_title";
  if (title.trim() !== title || /[\r\n*]/u.test(title) || title.endsWith(":")) return "not_a_drawer_title";
  if (!Array.from(title).some((character) => /[\p{L}\p{N}]/u.test(character))) return "not_a_drawer_title";
  return drawer_is_reserved_key(drawer_key(title)) ? "reserved" : null;
}

function can_create_drawer(title, hasContent) {
  const value = String(title == null ? "" : title);
  const refusal = drawer_title_refusal(value);
  if (refusal) return { ok: false, refusal };
  if (!hasContent) return { ok: false, refusal: "empty_drawer" };
  return { ok: true };
}

function drawer_title_case_legacy(title) {
  return String(title || "").trim().replace(/\s+/g, " ").toLowerCase()
    .replace(/[a-z0-9]+/g, (run) => run.charAt(0).toUpperCase() + run.slice(1));
}

function heading_for_drawer(title, marker) {
  return marker === "legacy_caps" ? drawer_title_case_legacy(title) : String(title || "");
}

function drawer_for_heading(title) {
  const value = String(title == null ? "" : title);
  if (value === "") return { ok: true, title: "" };
  const refusal = drawer_title_refusal(value);
  return refusal ? { ok: false, refusal } : { ok: true, title: value };
}

function drawer_utf8_length(text) {
  let bytes = 0;
  for (const character of String(text)) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function drawer_line_spans(contents) {
  const text = String(contents == null ? "" : contents);
  const spans = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    let bodyEnd = end;
    if (bodyEnd > start && text[bodyEnd - 1] === "\r") bodyEnd -= 1;
    spans.push({ start, end: bodyEnd, text: text.slice(start, bodyEnd) });
    start = newline < 0 ? text.length : newline + 1;
  }
  if (text === "" || text.endsWith("\n")) spans.push({ start: text.length, end: text.length, text: "" });
  return spans;
}

function drawer_list_item(line) {
  const text = String(line || "");
  const indent = (text.match(/^[ \t]*/) || [""])[0];
  const rest = text.slice(indent.length);
  let markerLength = 0;
  if (/^[-*+]/u.test(rest)) markerLength = 1;
  else {
    const ordered = /^\d+[.)]/u.exec(rest);
    if (ordered) markerLength = ordered[0].length;
  }
  if (!markerLength) return null;
  const after = indent.length + markerLength;
  const gap = (text.slice(after).match(/^[ \t]+/u) || [""])[0].length;
  if (!gap) return null;
  const bodyFrom = after + gap;
  return {
    indent: indent.length,
    indentColumns: drawer_indent_columns(text),
    body: text.slice(bodyFrom),
    bodyFrom,
  };
}

function drawer_indent_columns(line) {
  let columns = 0;
  for (const character of String(line || "")) {
    if (character === " ") columns += 1;
    else if (character === "\t") columns += 2;
    else break;
  }
  return columns;
}

function drawer_direct_child_indexes(contents, task) {
  const text = String(contents == null ? "" : contents);
  const spans = drawer_line_spans(text);
  const taskIndex = task && Number.isInteger(task.lineIndex) ? task.lineIndex
    : task && Number.isInteger(task.line_index) ? task.line_index : -1;
  if (taskIndex < 0 || taskIndex >= spans.length) return [];
  const parentIndent = drawer_indent_columns(spans[taskIndex].text);
  const children = [];
  for (let lineIndex = taskIndex + 1; lineIndex < spans.length; lineIndex += 1) {
    if (Number.isFinite(task.blockEnd) && spans[lineIndex].start >= task.blockEnd) break;
    const item = drawer_list_item(spans[lineIndex].text);
    if (!item || item.indentColumns <= parentIndent) continue;
    let parent = null;
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
      const previous = drawer_list_item(spans[index].text);
      if (previous && previous.indentColumns < item.indentColumns) { parent = index; break; }
    }
    if (parent === taskIndex) children.push(lineIndex);
  }
  return children;
}

function drawer_fence_marker(line) {
  const text = String(line || "");
  const indent = (text.match(/^ */u) || [""])[0].length;
  if (indent > 3) return null;
  const rest = text.slice(indent);
  const character = rest[0];
  if (character !== "`" && character !== "~") return null;
  let length = 0;
  while (rest[length] === character) length += 1;
  return length >= 3 ? { character, length } : null;
}

function drawer_fenced_lines(spans) {
  const fenced = new Set();
  let open = null;
  for (let index = 0; index < spans.length; index += 1) {
    const item = drawer_list_item(spans[index].text);
    const logical = item ? item.body : spans[index].text;
    const marker = drawer_fence_marker(logical);
    if (open) {
      fenced.add(index);
      if (marker && marker.character === open.character && marker.length >= open.length
        && !logical.trim().slice(marker.length)) open = null;
    } else if (marker) {
      fenced.add(index);
      open = marker;
    }
  }
  return fenced;
}

function drawer_is_managed_line(line, body) {
  const text = String(body || "").trim();
  if (/^(?:🧩\s*)?\*\*SUB-PROJECTS(?::)?\*\*/iu.test(text)) return true;
  if (/^(?:⛓️|🧱|🔗|🪢)\s*\*\*(?:DEPENDS ON|BLOCKS|LINKS|LINKS TO|LINKED FROM|BACKLINKS)(?::)?\*\*/iu.test(text)
    || /^\*\*(?:DEPENDS ON|BLOCKS|LINKS|LINKS TO|LINKED FROM|BACKLINKS)(?::)?\*\*/iu.test(text)) return true;
  if (text.startsWith("❌") && text.includes("CANCEL LOG")) return true;
  if (/^(?:🗓️?\s*|🛠️\s*|🥀\uFE0F?\s*)?\*\*(?:SCHEDULE|WORK|ROTTEN) LOG(?::)?\*\*/u.test(text)) return true;
  return /\*\*(?:SCHEDULE|WORK|ROTTEN) LOG(?::)?\*\*$/u.test(text);
}

function drawer_is_task_line(line) {
  const item = drawer_list_item(line);
  return Boolean(item && /^\[[^\]\r\n]\][ \t]+/u.test(item.body)
    && /(?:^|\s)#task(?:\s|$)/u.test(item.body));
}

// Contextual counterpart to drawer_body_title. `task` is a task-reader
// adapter with zero-based lineIndex and a UTF-16 blockEnd; ranges returned
// here are half-open UTF-8 byte offsets like bob-cli's DrawerHeader.
function recognize_drawer_header(contents, task, line_index) {
  const text = String(contents == null ? "" : contents);
  const spans = drawer_line_spans(text);
  const taskIndex = task && Number.isInteger(task.lineIndex) ? task.lineIndex
    : task && Number.isInteger(task.line_index) ? task.line_index : -1;
  const lineIndex = Number(line_index);
  if (taskIndex < 0 || lineIndex <= taskIndex || lineIndex >= spans.length) return null;
  const ownerLine = spans[taskIndex] && spans[taskIndex].text;
  const candidate = spans[lineIndex];
  if (!ownerLine || !drawer_is_task_line(ownerLine) || !candidate) return null;
  if (Number.isFinite(task.blockEnd) && candidate.start >= task.blockEnd) return null;
  const item = drawer_list_item(candidate.text);
  if (!item) return null;
  let parent = null;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const previous = drawer_list_item(spans[index].text);
    if (previous && previous.indentColumns < item.indentColumns) { parent = index; break; }
  }
  if (parent !== taskIndex) return null;
  if (drawer_fenced_lines(spans).has(lineIndex)) return null;
  if (/^\s*>/u.test(item.body) || drawer_is_managed_line(candidate.text, item.body)) return null;
  const parsed = drawer_body_title(item.body);
  if (!parsed) return null;
  const key = drawer_key(parsed.title);
  const legacyLog = parsed.marker === "legacy_caps" && DRAWER_LEGACY_LOG_KEYS.has(key);
  if ((drawer_is_reserved_key(key) && !legacyLog) || drawer_is_structural_h2_key(key)) return null;
  const titleWithinBody = item.body.indexOf(parsed.title) + item.bodyFrom;
  const linePrefix = text.slice(0, candidate.start);
  const titlePrefix = text.slice(0, candidate.start + titleWithinBody);
  const header = candidate.text;
  return {
    title: parsed.title,
    key,
    marker: parsed.marker,
    line: lineIndex + 1,
    header_range: [drawer_utf8_length(linePrefix), drawer_utf8_length(linePrefix) + drawer_utf8_length(header)],
    title_range: [drawer_utf8_length(titlePrefix), drawer_utf8_length(titlePrefix) + drawer_utf8_length(parsed.title)],
  };
}
