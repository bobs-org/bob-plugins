// Pure task-settle model twin (bob-cli-q4.8.1.1 pure-twin).
//
// Ports bob-cli's Rust settle helpers into ledger-tools: status
// classification (`task_status_groups::TaskClassification::from_status_types`),
// conservative Markdown helpers (`src/native/markdown.rs`), area/project
// frontmatter eligibility, inline-field scanning (`task_fields.rs`), task-line
// parsing (`task_status_hooks::parse`), and stale `[unblocked::]` pruning
// (`freshness::placement::prune_unblocked`).
//
// The canonical contract is `tests/fixtures/task_settle/vectors.json` in
// bob-cli. Byte-identical fixture copies live under
// `scripts/fixtures/task_settle/`.

const TS_BADGE_CHIPS = [
  ["\u26AA", "open"],
  ["\uD83D\uDD35", "next/wip"],
  ["\uD83D\uDD34", "blocked"],
  ["\uD83D\uDFE2", "done/canceled"],
];

const TS_TITLE_ACTIVE = "Next & In Progress";
const TS_TITLE_BLOCKED = "Blocked";
const TS_TITLE_CLOSED = "Done & Canceled";

const TS_LEGACY_GROUP_MARKER_PREFIX = "bob:task-status-group:v1:";

const TS_TASKS_KEYS = new Set([
  "priority",
  "start",
  "created",
  "scheduled",
  "due",
  "completion",
  "cancelled",
  "repeat",
  "onCompletion",
  "id",
  "dependsOn",
]);

// --- Status buckets ---------------------------------------------------------

function tsBucketDestination(bucket) {
  if (bucket === "active") return "active";
  if (bucket === "blocked") return "blocked";
  if (bucket === "closed") return "closed";
  return "intake";
}

function tsBucketIsGroupable(bucket) {
  return bucket !== "ready" && bucket !== "other_open" && bucket !== "unknown";
}

function tsDestinationGroup(destination) {
  if (destination === "active") return "active";
  if (destination === "blocked") return "blocked";
  if (destination === "closed") return "closed";
  return null;
}

function tsDestinationLabel(destination) {
  if (destination === "active") return "next_and_in_progress";
  if (destination === "blocked") return "blocked";
  if (destination === "closed") return "done_and_canceled";
  return "intake";
}

function tsGroupKindTitle(kind) {
  if (kind === "active") return TS_TITLE_ACTIVE;
  if (kind === "blocked") return TS_TITLE_BLOCKED;
  return TS_TITLE_CLOSED;
}

function tsGroupKindFromTitle(title) {
  if (title === TS_TITLE_ACTIVE) return "active";
  if (title === TS_TITLE_BLOCKED) return "blocked";
  if (title === TS_TITLE_CLOSED) return "closed";
  return null;
}

function tsGroupKindFromMarkerId(id) {
  if (id === "active") return "active";
  if (id === "blocked") return "blocked";
  if (id === "closed") return "closed";
  return null;
}

const TS_SKIP_CODES = [
  "h6_container",
  "ambiguous_boundary",
  "ownership_collision",
  "malformed_ownership",
  "duplicate_group_heading",
  "renamed_marked_heading",
  "authored_heading_in_group",
  "misplaced_badge_row",
  "nested_under_ordinary_item",
  "unsupported_ordered_list",
];

function tsSkipMessage(code, title, line) {
  if (code === "h6_container") {
    return `H6 heading ${JSON.stringify(title)} at line ${line} cannot have child status groups`;
  }
  if (code === "ambiguous_boundary") {
    return `ambiguous Markdown boundary in ${JSON.stringify(title)} at line ${line}; skipped grouping`;
  }
  if (code === "ownership_collision") {
    return `status-group heading in ${JSON.stringify(title)} at line ${line} contains non-task content`;
  }
  if (code === "malformed_ownership") {
    return `malformed task-status-group marker in ${JSON.stringify(title)} at line ${line}`;
  }
  if (code === "duplicate_group_heading") {
    return `duplicate status-group heading in ${JSON.stringify(title)} at line ${line}`;
  }
  if (code === "renamed_marked_heading") {
    return `renamed marked status-group heading in ${JSON.stringify(title)} at line ${line}`;
  }
  if (code === "authored_heading_in_group") {
    return `authored child heading inside a managed status group in ${JSON.stringify(title)} at line ${line}`;
  }
  if (code === "misplaced_badge_row") {
    return `status badge row inside a managed status group in ${JSON.stringify(title)} at line ${line}`;
  }
  if (code === "nested_under_ordinary_item") {
    return `task nested under an ordinary list item in ${JSON.stringify(title)} at line ${line} is structurally ineligible`;
  }
  return `ordered-list task root in ${JSON.stringify(title)} at line ${line} is unsupported in v1`;
}

// --- TaskClassification -----------------------------------------------------

function taskSettleFromStatusTypes(globalFilter, statusTypes, symbols) {
  const next = (symbols && symbols.next) || "*";
  const wip = (symbols && symbols.wip) || "/";
  const blocked = (symbols && symbols.blocked) || "?";
  const ready = (symbols && symbols.ready) || " ";
  const buckets = new Map();
  const open = new Set();
  for (const entry of statusTypes || []) {
    const symbol = entry.symbol;
    const type = entry.type;
    if (type !== "DONE" && type !== "CANCELLED" && type !== "NON_TASK" && type !== "EMPTY") {
      open.add(symbol);
    }
    let bucket;
    if (symbol === next || symbol === wip) {
      bucket = "active";
    } else if (symbol === blocked) {
      bucket = "blocked";
    } else if (symbol === ready) {
      bucket = "ready";
    } else if (type === "DONE" || type === "CANCELLED") {
      bucket = "closed";
    } else if (type === "NON_TASK" || type === "EMPTY") {
      bucket = "unknown";
    } else {
      bucket = "other_open";
    }
    buckets.set(symbol, bucket);
  }
  if (!buckets.has("x")) buckets.set("x", "closed");
  if (!buckets.has("X")) buckets.set("X", "closed");
  for (const [symbol, bucket] of [
    [next, "active"],
    [wip, "active"],
    [blocked, "blocked"],
    [ready, "ready"],
  ]) {
    if (!buckets.has(symbol)) {
      buckets.set(symbol, bucket);
      open.add(symbol);
    }
  }
  return { globalFilter: String(globalFilter == null ? "" : globalFilter), buckets, open };
}

function tsMatchesFilter(classification, body) {
  return (
    classification.globalFilter === "" || String(body).includes(classification.globalFilter)
  );
}

function tsIsOpenStatus(classification, symbol) {
  return classification.open.has(symbol);
}

function tsMatchesTaskFilter(classification, body) {
  if (classification.globalFilter === "") return true;
  return String(body)
    .split(/\s+/)
    .some((token) => token === classification.globalFilter);
}

function tsBucketOf(classification, symbol) {
  return classification.buckets.get(symbol) || "unknown";
}

// --- Conservative Markdown helpers (src/native/markdown.rs) ----------------

function tsFenceMarker(line) {
  const indentation = (line.match(/^ */) || [""])[0].length;
  if (indentation > 3) return null;
  const rest = line.slice(indentation);
  const character = rest[0];
  if (character !== "`" && character !== "~") return null;
  let length = 0;
  while (rest[length] === character) length += 1;
  if (length < 3) return null;
  return { character, length };
}

function tsClosesFence(line, open) {
  const marker = tsFenceMarker(line);
  if (!marker) return false;
  if (marker.character !== open.character || marker.length < open.length) return false;
  return line.trimStart().slice(marker.length).trim() === "";
}

function tsFencedLines(lines, start, end) {
  const masked = new Set();
  let open = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (open) {
      masked.add(index);
      if (tsClosesFence(line, open)) open = null;
    } else {
      const marker = tsFenceMarker(line);
      if (marker) {
        masked.add(index);
        open = marker;
      }
    }
  }
  return masked;
}

function tsStrictlyClosedFrontmatterEnd(lines) {
  if ((lines[0] == null ? "" : lines[0].replace(/\r$/, "")) !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\r$/, "") === "---") return index;
  }
  return null;
}

function tsMarkdownIndentedLine(line) {
  const spaces = (line.match(/^ */) || [""])[0].length;
  if (spaces > 3) return null;
  return line.slice(spaces);
}

function tsStripClosingAtxHashes(title) {
  const trimmed = title.trimEnd();
  const withoutHashes = trimmed.replace(/#+$/, "");
  if (withoutHashes.length === trimmed.length) return trimmed;
  if (withoutHashes === "" || /\s$/.test(withoutHashes)) return withoutHashes.trimEnd();
  return trimmed;
}

function tsAtxHeading(line) {
  const rest0 = tsMarkdownIndentedLine(line);
  if (rest0 == null) return null;
  let hashes = 0;
  while (rest0[hashes] === "#") hashes += 1;
  if (hashes < 1 || hashes > 6) return null;
  const after = rest0[hashes];
  if (after !== undefined && !/\s/.test(after)) return null;
  return { level: hashes, title: tsStripClosingAtxHashes(rest0.slice(hashes).trim()) };
}

function tsSplitLineEnding(line) {
  if (line.endsWith("\r\n")) return [line.slice(0, -2), "\r\n"];
  if (line.endsWith("\n")) return [line.slice(0, -1), "\n"];
  return [line, ""];
}

function tsSetextUnderline(line) {
  const rest = tsMarkdownIndentedLine(line);
  if (rest == null) return null;
  const trimmed = rest.trimEnd();
  if (trimmed === "") return null;
  const marker = trimmed[0];
  if (marker !== "=" && marker !== "-") return null;
  for (const character of trimmed) {
    if (character !== marker) return null;
  }
  return marker === "=" ? 1 : 2;
}

function tsStandaloneHtmlComment(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("<!--") || !trimmed.endsWith("-->")) return null;
  return trimmed.slice(4, -3).trim();
}

function tsHtmlCommentOpens(line) {
  return line.trimStart().startsWith("<!--");
}

function tsHtmlCommentCloses(line) {
  return line.includes("-->");
}

function tsIsBlockquoteLine(line) {
  const rest = tsMarkdownIndentedLine(line);
  return rest != null && rest.startsWith(">");
}

function tsIsIndentedCodeLine(line) {
  if (line.trim() === "") return false;
  return (line.match(/^ */) || [""])[0].length >= 4;
}

// --- Badge rows -------------------------------------------------------------

function tsIsBadgeSpan(span, emoji, label) {
  if (!span.startsWith(emoji)) return false;
  const afterEmoji = span.slice(emoji.length);
  if (!afterEmoji.startsWith(" ")) return false;
  const rest = afterEmoji.slice(1);
  let digits = 0;
  while (digits < rest.length && rest[digits] >= "0" && rest[digits] <= "9") digits += 1;
  if (digits === 0) return false;
  const afterDigits = rest.slice(digits);
  if (!afterDigits.startsWith(" ")) return false;
  return afterDigits.slice(1) === label;
}

function tsIsBadgeAnchor(anchor) {
  if (anchor === "" || !anchor.startsWith("#")) return false;
  return !/[\s)]/.test(anchor);
}

function tsIsBadgeChip(chip, emoji, label) {
  if (chip.startsWith("[")) {
    const rest = chip.slice(1);
    if (!rest.startsWith("`")) return false;
    const end = rest.indexOf("`", 1);
    if (end === -1) return false;
    const span = rest.slice(1, end);
    if (!tsIsBadgeSpan(span, emoji, label)) return false;
    const after = rest.slice(end + 1);
    if (!after.startsWith("](") || !after.endsWith(")")) return false;
    return tsIsBadgeAnchor(after.slice(2, -1));
  }
  if (!chip.startsWith("`") || !chip.endsWith("`")) return false;
  return tsIsBadgeSpan(chip.slice(1, -1), emoji, label);
}

function taskSettleIsBadgeRow(line) {
  const trimmed = String(line).replace(/[\s\uFEFF\xA0]+$/, "");
  const chips = trimmed.split(" \u00B7 ");
  if (chips.length !== 4) return false;
  for (let index = 0; index < 4; index += 1) {
    if (!tsIsBadgeChip(chips[index], TS_BADGE_CHIPS[index][0], TS_BADGE_CHIPS[index][1])) {
      return false;
    }
  }
  return true;
}

function taskSettleIsLegacyBadgeMarker(line) {
  const inner = tsStandaloneHtmlComment(String(line));
  return inner != null && inner.startsWith("bob:task-status-badges:");
}

// --- Inline fields (src/native/task_fields.rs) ------------------------------

const TS_INLINE_FIELD_RE = /\[([A-Za-z][A-Za-z0-9_-]*)\s*::\s*([^\]\n]*)\]|\(([A-Za-z][A-Za-z0-9_-]*)\s*::\s*([^)\n]*)\)/gd;

function tsAllInlineFields(line) {
  const fields = [];
  TS_INLINE_FIELD_RE.lastIndex = 0;
  for (const match of String(line).matchAll(TS_INLINE_FIELD_RE)) {
    const whole = match[0];
    const start = match.index;
    const end = start + whole.length;
    let key;
    let raw;
    let rawStart;
    if (match[1] !== undefined) {
      key = match[1];
      raw = match[2] || "";
      rawStart = match.indices[2][0];
    } else {
      key = match[3];
      raw = match[4] || "";
      rawStart = match.indices[4][0];
    }
    let leading = 0;
    while (raw[leading] === " " || raw[leading] === "\t") leading += 1;
    let trailing = 0;
    while (
      trailing < raw.length - leading &&
      (raw[raw.length - 1 - trailing] === " " || raw[raw.length - 1 - trailing] === "\t")
    ) {
      trailing += 1;
    }
    fields.push({
      start,
      end,
      valueStart: rawStart + leading,
      valueEnd: rawStart + raw.length - trailing,
      key,
      value: raw.slice(leading, raw.length - trailing),
    });
  }
  return fields;
}

function tsInlineFields(line, key) {
  return tsAllInlineFields(line).filter((field) => field.key === key);
}

function tsIsStrictCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// --- Task-line parsing (task_status_hooks::parse) ---------------------------

function tsIsBlockIdByte(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45
  );
}

function tsAfterListMarker(line, index) {
  const first = line[index];
  if (first === "-" || first === "*" || first === "+") {
    const next = line[index + 1];
    if (next !== undefined && /\s/.test(next)) return index + 1;
    return null;
  }
  let digits = 0;
  while (line[index + digits] >= "0" && line[index + digits] <= "9") digits += 1;
  if (digits === 0) return null;
  const punct = line[index + digits];
  if (punct !== "." && punct !== ")") return null;
  const next = line[index + digits + 1];
  if (next === undefined || !/\s/.test(next)) return null;
  return index + digits + 1;
}

function tsTrailingBlockId(body) {
  const tokens = String(body).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const token = tokens[tokens.length - 1];
  if (!token.startsWith("^")) return null;
  const id = token.slice(1);
  if (id === "") return null;
  for (let index = 0; index < id.length; index += 1) {
    if (!tsIsBlockIdByte(id.charCodeAt(index))) return null;
  }
  return id;
}

function tsValidTaskIdentity(value) {
  if (value === "") return false;
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function tsParseTaskDependencies(value) {
  if (value === "" || value.includes("\t")) return null;
  const out = [];
  for (const part of value.split(",")) {
    const trimmed = part.replace(/^ +| +$/g, "");
    if (!tsValidTaskIdentity(trimmed)) return null;
    out.push(trimmed);
  }
  return out;
}

function tsValidTaskDate(value) {
  if (value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  for (let index = 0; index < 10; index += 1) {
    if (index === 4 || index === 7) continue;
    const character = value[index];
    if (character < "0" || character > "9") return false;
  }
  return true;
}

function tsParseTaskDate(value) {
  if (!tsValidTaskDate(value)) return null;
  if (!tsIsStrictCalendarDate(value)) return null;
  return value;
}

function tsTrailingDataviewField(state) {
  let end = state.replace(/[\s\uFEFF\xA0]+$/, "").length;
  let trimmedEnd = state.slice(0, end);
  if (trimmedEnd.endsWith(",")) {
    end -= 1;
    end = state.slice(0, end).replace(/[\s\uFEFF\xA0]+$/, "").length;
    trimmedEnd = state.slice(0, end);
  }
  if (end === 0) return null;
  const close = trimmedEnd[trimmedEnd.length - 1];
  let open = null;
  if (close === "]") open = "[";
  else if (close === ")") open = "(";
  else return null;
  const withoutClose = trimmedEnd.slice(0, -1);
  const start = withoutClose.lastIndexOf(open);
  if (start === -1) return null;
  const inner = withoutClose.slice(start + 1).trim();
  const split = inner.indexOf("::");
  if (split === -1) return null;
  const key = inner.slice(0, split);
  const value = inner.slice(split + 2);
  if (key !== key.trim()) return null;
  return { start, key: key.trim(), value: value.trim() };
}

function tsTrailingTaskTagStart(state) {
  const trimmed = state.replace(/[\s\uFEFF\xA0]+$/, "");
  let start = 0;
  const match = /\s[^\s]*$/.exec(trimmed);
  if (match) start = match.index + 1;
  const tag = trimmed.slice(start);
  if (!tag.startsWith("#")) return null;
  const value = tag.slice(1);
  if (value === "") return null;
  if (/[\s!@#$%^&*(),.?":{}|<>]/.test(value)) return null;
  return start;
}

function tsTaskMetadata(body, blockId) {
  const metadata = { taskId: null, dependsOn: [], scheduled: null };
  let state = body;
  if (blockId != null) {
    const suffix = `^${blockId}`;
    const trimmed = state.replace(/[\s\uFEFF\xA0]+$/, "");
    if (trimmed.endsWith(suffix)) {
      state = trimmed.slice(0, -suffix.length).replace(/[\s\uFEFF\xA0]+$/, "");
    }
  }
  for (let round = 0; round < 20; round += 1) {
    const field = tsTrailingDataviewField(state);
    if (field) {
      let recognized = false;
      if (field.key === "id" && tsValidTaskIdentity(field.value)) {
        metadata.taskId = field.value;
        recognized = true;
      } else if (field.key === "dependsOn") {
        const dependencies = tsParseTaskDependencies(field.value);
        if (dependencies) {
          metadata.dependsOn = dependencies;
          recognized = true;
        }
      } else if (field.key === "priority") {
        recognized = ["highest", "high", "medium", "low", "lowest"].includes(field.value);
      } else if (field.key === "scheduled") {
        const scheduled = tsParseTaskDate(field.value);
        if (scheduled) {
          metadata.scheduled = scheduled;
          recognized = true;
        }
      } else if (
        ["start", "created", "due", "completion", "cancelled"].includes(field.key)
      ) {
        recognized = tsValidTaskDate(field.value);
      } else if (field.key === "repeat") {
        recognized =
          field.value !== "" && /^[A-Za-z0-9, !]+$/.test(field.value);
      } else if (field.key === "onCompletion") {
        recognized = field.value !== "" && /^[A-Za-z]+$/.test(field.value);
      }
      if (!recognized) break;
      state = state.slice(0, field.start).replace(/[\s\uFEFF\xA0]+$/, "");
      continue;
    }
    const tagStart = tsTrailingTaskTagStart(state);
    if (tagStart != null) {
      state = state.slice(0, tagStart).replace(/[\s\uFEFF\xA0]+$/, "");
      continue;
    }
    break;
  }
  return metadata;
}

// --- Freshness pruning ------------------------------------------------------

function tsReadFreshness(line, today) {
  let fresh = null;
  for (const field of tsInlineFields(line, "fresh")) {
    if (!tsIsStrictCalendarDate(field.value)) continue;
    if (field.value > today) continue;
    if (fresh == null || field.value > fresh) fresh = field.value;
  }
  let unblocked = null;
  for (const field of tsInlineFields(line, "unblocked")) {
    if (!tsIsStrictCalendarDate(field.value)) continue;
    if (unblocked == null || field.value > unblocked) unblocked = field.value;
  }
  return { fresh, unblocked };
}

function tsRemoveNamedField(text, key) {
  const ranges = tsInlineFields(text, key)
    .map((field) => [field.start, field.end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ranges.length === 0) return text;
  let output = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    const before = text.slice(cursor, start);
    output += before.replace(/[ \t]+$/, "");
    let next = end;
    while (text[next] === " " || text[next] === "\t") next += 1;
    if (output !== "" && next < text.length) output += " ";
    cursor = next;
  }
  output += text.slice(cursor);
  if (/^[ \t]*$/.test(text.slice(cursor))) output = output.replace(/[ \t]+$/, "");
  return output;
}

function tsPruneUnblocked(line, today) {
  const read = tsReadFreshness(line, today);
  if (read.fresh != null && read.unblocked != null && read.fresh > read.unblocked) {
    return tsRemoveNamedField(line, "unblocked");
  }
  return null;
}

// --- Frontmatter + eligibility ----------------------------------------------

function tsTrimCr(value) {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function tsParseFrontmatter(contents) {
  const rawLines = String(contents).split("\n");
  if (rawLines.length === 0) return null;
  let first = tsTrimCr(rawLines[0]);
  if (first.charCodeAt(0) === 0xfeff) first = first.slice(1);
  if (first !== "---") return null;
  const lines = [];
  for (let index = 1; index < rawLines.length; index += 1) {
    const line = tsTrimCr(rawLines[index]);
    if (line === "---") return { lines, bodyStartLine: index + 1 };
    lines.push(line);
  }
  return null;
}

function tsTrimYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function tsWikilinkTypeName(value) {
  if (value.startsWith("[[") && value.endsWith("]]")) return value.slice(2, -2);
  return null;
}

function tsYamlTypeName(item) {
  const unquoted = tsTrimYamlScalar(String(item).trim()).trim();
  if (unquoted === "") return null;
  const linked = tsWikilinkTypeName(unquoted);
  if (linked != null) return linked;
  const inner = unquoted.replace(/^[\[\]"']+|[\[\]"']+$/g, "").trim();
  if (inner === "") return null;
  return inner;
}

function tsFlowListTypeNames(raw) {
  let inner = String(raw).trim();
  if (inner.startsWith("[")) inner = inner.slice(1);
  if (inner.endsWith("]")) inner = inner.slice(0, -1);
  const names = [];
  for (const part of inner.split(",")) {
    const name = tsYamlTypeName(part);
    if (name != null) names.push(name);
  }
  return names;
}

function tsBlockListTypeNames(frontmatter) {
  const names = [];
  let inList = false;
  for (const line of frontmatter.lines) {
    if (!inList) {
      if (!line.startsWith("type")) continue;
      const rest = line.slice(4);
      if (!rest.startsWith(":")) continue;
      if (rest.slice(1).trim() !== "") return names;
      inList = true;
      continue;
    }
    const trimmed = line.replace(/^[ \t]+/, "");
    if (trimmed === "") continue;
    let item = null;
    if (trimmed.startsWith("- ")) item = trimmed.slice(2);
    else if (trimmed.startsWith("-")) item = trimmed.slice(1);
    else break;
    const name = tsYamlTypeName(item);
    if (name != null) names.push(name);
  }
  return names;
}

function tsFrontmatterTopLevelValue(frontmatter, key) {
  for (const line of frontmatter.lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) continue;
    if (!line.startsWith(key)) continue;
    const rest = line.slice(key.length);
    if (!rest.startsWith(":")) continue;
    return rest.slice(1).trim();
  }
  return null;
}

function tsFrontmatterTypeNames(frontmatter) {
  const raw = tsFrontmatterTopLevelValue(frontmatter, "type");
  if (raw != null) {
    const trimmed = raw.trim();
    if (trimmed !== "") {
      if (trimmed.startsWith("[")) return tsFlowListTypeNames(trimmed);
      const single = tsYamlTypeName(trimmed);
      return single == null ? [] : [single];
    }
  }
  return tsBlockListTypeNames(frontmatter);
}

function tsFrontmatterHasType(frontmatter, expected) {
  const linked = tsWikilinkTypeName(expected);
  const expectedName = linked == null ? expected : linked;
  return tsFrontmatterTypeNames(frontmatter).some((name) => name === expectedName);
}

function tsNoteKind(contents) {
  const frontmatter = tsParseFrontmatter(contents);
  if (!frontmatter) return "other";
  if (!tsFrontmatterHasType(frontmatter, "[[album]]")) {
    if (tsFrontmatterHasType(frontmatter, "[[area]]")) return "area";
    if (tsFrontmatterHasType(frontmatter, "[[project]]")) return "project";
  }
  return "other";
}

function taskSettleParseDayFileDate(fileName) {
  let base = String(fileName);
  if (base.endsWith(".md")) base = base.slice(0, -3);
  if (base.endsWith("_day")) base = base.slice(0, -4);
  if (base.length !== 8 || !/^\d{8}$/.test(base)) return null;
  const text = `${base.slice(0, 4)}-${base.slice(4, 6)}-${base.slice(6, 8)}`;
  if (!tsIsStrictCalendarDate(text)) return null;
  return text;
}

function taskSettleCanonicalDailyDate(relativePath) {
  const parts = String(relativePath).split("/");
  if (parts.length !== 2) return null;
  const [yearText, fileName] = parts;
  if (yearText.length !== 4 || !/^\d{4}$/.test(yearText)) return null;
  if (fileName.length !== 11 || !fileName.endsWith(".md")) return null;
  const date = taskSettleParseDayFileDate(fileName);
  if (!date) return null;
  if (!date.startsWith(yearText)) return null;
  return date;
}

function taskSettleGroupingEligible(relativePath, contents, dailyRelativePath) {
  const kind = tsNoteKind(contents);
  if (kind !== "area" && kind !== "project") return false;
  if (taskSettleCanonicalDailyDate(relativePath) != null) return false;
  return String(relativePath) !== String(dailyRelativePath);
}

// --- Logical lines ----------------------------------------------------------

function taskSettleLogicalLines(contents) {
  const text = String(contents);
  if (text === "") return [""];
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.map((part) => (part.endsWith("\r") ? part.slice(0, -1) : part));
}

function tsSplitSegments(contents) {
  const text = String(contents);
  if (text === "") return [""];
  const out = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      out.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}
