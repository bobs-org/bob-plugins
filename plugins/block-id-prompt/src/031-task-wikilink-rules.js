// Pure vault-wide task model for the `((` Task Wikilink Picker.
//
// This mirrors bob-cli's `capture_task_wikilinks` pool: `discover` over
// every task-bearing note (`capture_dependency_tasks`), the canonical
// order and link targets (`capture_link_tasks`, `task_dependencies`),
// and the guard rules. Parity is pinned by
// `scripts/fixtures/task_wikilinks/vectors.json`, a verbatim copy of
// bob-cli's `tests/fixtures/task_wikilinks/vectors.json`.
//
// Everything here is pure: no Obsidian imports, no vault reads. Callers
// feed note paths and texts; tests drive every function directly.

// Bob's task line grammar (`note_tasks::parse_task_line`): leading
// whitespace, a literal `- [`, exactly one status character, `] `, and a
// body carrying the global filter token. Blockquotes, `*`/`+` bullets,
// and numbered lists never match, exactly like bob.
const TASK_WIKILINK_LINE_RE = /^(\s*)- \[(.)\] ([\s\S]*)$/u;

// Bob's inline-field grammar (`note_tasks::INLINE_FIELD_RE`), which the
// search text drops. This is narrower than the picker's display regex on
// purpose: parity follows bob, not the card.
const TASK_WIKILINK_INLINE_FIELD_RE = /\[[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]*\]/g;

// Bob's always-excluded note directory names (`native.rs`), plus the dot
// directories `collect_note_paths` skips. Matched case-sensitively.
const TASK_WIKILINK_EXCLUDED_DIRS = new Set([
  ".bob",
  ".git",
  ".obsidian",
  "_conflicts",
  "_generated",
  "_templates",
]);

// Bob's default status types (`task_status_hooks::settings`), keyed by
// status symbol. Unknown symbols read as TODO, exactly like bob.
const TASK_WIKILINK_DEFAULT_STATUS_TYPES = {
  " ": "TODO",
  x: "DONE",
  X: "DONE",
  "/": "IN_PROGRESS",
  "*": "ON_HOLD",
  "-": "CANCELLED",
};

const TASK_WIKILINK_OPEN_TYPES = new Set([
  "TODO",
  "IN_PROGRESS",
  "ON_HOLD",
]);

function defaultTaskWikilinkSettings() {
  return {
    globalFilter: "#task",
    statusTypes: { ...TASK_WIKILINK_DEFAULT_STATUS_TYPES },
  };
}

// Mirror of `parse_tasks_settings` for the fields the picker needs: the
// global filter plus the symbol-to-type overlay from the Tasks
// `data.json` core and custom statuses.
function taskWikilinkSettingsFromTasksJson(data) {
  const settings = defaultTaskWikilinkSettings();
  if (!data || typeof data !== "object") {
    return settings;
  }
  if (typeof data.globalFilter === "string" && data.globalFilter !== "") {
    settings.globalFilter = data.globalFilter;
  }
  const statusSettings =
    data.statusSettings && typeof data.statusSettings === "object"
      ? data.statusSettings
      : {};
  for (const collection of ["coreStatuses", "customStatuses"]) {
    const statuses = statusSettings[collection];
    if (!Array.isArray(statuses)) {
      continue;
    }
    for (const status of statuses) {
      if (!status || typeof status.symbol !== "string") {
        continue;
      }
      const chars = Array.from(status.symbol);
      if (chars.length !== 1) {
        continue;
      }
      settings.statusTypes[chars[0]] = taskWikilinkTypeName(status.type);
    }
  }
  return settings;
}

function taskWikilinkTypeName(value) {
  switch (value) {
    case "DONE":
      return "DONE";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "ON_HOLD":
      return "ON_HOLD";
    case "CANCELLED":
      return "CANCELLED";
    case "NON_TASK":
      return "NON_TASK";
    case "EMPTY":
      return "EMPTY";
    default:
      return "TODO";
  }
}

// Mirror of `markdown::fence_marker`: at most three leading spaces, then
// three or more backticks or tildes.
function taskWikilinkFenceMarker(line) {
  const spaces = line.match(/^ */)[0].length;
  if (spaces > 3) {
    return null;
  }
  const rest = line.slice(spaces);
  const character = rest[0];
  if (character !== "`" && character !== "~") {
    return null;
  }
  let length = 0;
  while (rest[length] === character) {
    length += 1;
  }
  return length >= 3 ? { character, length } : null;
}

// Mirror of `markdown::closes_fence`: the same fence character, at least
// as long, with nothing but whitespace after it.
function taskWikilinkClosesFence(line, open) {
  const marker = taskWikilinkFenceMarker(line);
  if (!marker) {
    return false;
  }
  return (
    marker.character === open.character &&
    marker.length >= open.length &&
    line.trimStart().slice(marker.length).trim() === ""
  );
}

// Mirror of `markdown::atx_heading` plus `strip_closing_atx_hashes`:
// up to three leading spaces, 1-6 hashes, whitespace or end after them,
// and closing hashes that only count after a whitespace run.
function taskWikilinkAtxHeading(line) {
  const spaces = line.match(/^ */)[0].length;
  if (spaces > 3) {
    return null;
  }
  const rest = line.slice(spaces);
  const hashes = rest.match(/^#+/);
  if (!hashes || hashes[0].length > 6) {
    return null;
  }
  const after = rest.slice(hashes[0].length);
  if (after !== "" && !/^\s/.test(after)) {
    return null;
  }
  return taskWikilinkStripClosingHashes(after.trim());
}

function taskWikilinkStripClosingHashes(title) {
  const trimmed = title.trimEnd();
  const withoutHashes = trimmed.replace(/#+$/, "");
  if (withoutHashes.length === trimmed.length) {
    return trimmed;
  }
  if (withoutHashes === "" || /\s$/.test(withoutHashes)) {
    return withoutHashes.trimEnd();
  }
  return trimmed;
}

// Mirror of `collect_done::trailing_block_id_in_line`: the last `^` on
// the trimmed line opens the ID when every byte after it is ASCII
// alphanumeric or `-` and the byte before it is whitespace (or absent).
function taskWikilinkTrailingBlockId(lineText) {
  const trimmed = String(lineText).trimEnd();
  const caret = trimmed.lastIndexOf("^");
  if (caret === -1) {
    return null;
  }
  const id = trimmed.slice(caret + 1);
  if (id === "" || !/^[A-Za-z0-9-]+$/.test(id)) {
    return null;
  }
  if (caret > 0 && !/\s/.test(trimmed[caret - 1])) {
    return null;
  }
  return id;
}

function taskWikilinkHasExactTag(lineText, tag) {
  return String(lineText).split(/\s+/).includes(tag);
}

// Mirror of `capture_tasks::indentation_depth`: spaces accumulate in
// fours; any other whitespace consumes the run plus one level.
function taskWikilinkIndentationDepth(indentation) {
  let depth = 0;
  let spaces = 0;
  for (const character of String(indentation)) {
    if (character === " ") {
      spaces += 1;
    } else {
      depth += Math.ceil(spaces / 4) + 1;
      spaces = 0;
    }
  }
  return depth + Math.ceil(spaces / 4);
}

// Mirror of `note_tasks::clean_description`: strip the trailing block
// ID, blank inline fields, then drop the global filter token plus an
// ASCII case-insensitive `#ref` directly after it.
function taskWikilinkSearchText(body, globalFilter, blockId) {
  let text = String(body);
  if (blockId) {
    const suffix = `^${blockId}`;
    const trimmed = text.trimEnd();
    if (trimmed.endsWith(suffix)) {
      text = trimmed.slice(0, -suffix.length);
    }
  }
  text = text.replace(TASK_WIKILINK_INLINE_FIELD_RE, " ");
  const out = [];
  let prevDroppedFilter = false;
  for (const token of text.split(/\s+/).filter((part) => part !== "")) {
    if (globalFilter !== "" && token === globalFilter) {
      prevDroppedFilter = true;
      continue;
    }
    if (prevDroppedFilter && token.toLowerCase() === "#ref") {
      prevDroppedFilter = false;
      continue;
    }
    prevDroppedFilter = false;
    out.push(token);
  }
  return out.join(" ");
}

// Every `#task` checkbox line in a note, mirroring `note_tasks::scan`
// through `capture_dependency_tasks::discover`: lines of every status
// outside strictly-closed frontmatter and fenced code, with the section
// (nearest ATX heading), depth, hidden and project-blocked flags, the
// search text bob ranks, the display text the card renders, and the
// within-note duplicate-ID flag (which counts trailing IDs on every
// surviving line, task or not, exactly like bob's block-ID map).
//
// `line` is 0-based internally and 1-based on the wire, like bob.
function parseNoteTaskRows(notePath, content, settings) {
  const active = settings || defaultTaskWikilinkSettings();
  const lines = String(content)
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  let start = 0;
  if (lines.length > 0 && lines[0].trimEnd() === "---") {
    const close = lines.findIndex(
      (line, index) => index > 0 && line.trimEnd() === "---",
    );
    if (close !== -1) {
      start = close + 1;
    }
  }
  const fenced = new Set();
  let open = null;
  for (let index = start; index < lines.length; index += 1) {
    if (open) {
      fenced.add(index);
      if (taskWikilinkClosesFence(lines[index], open)) {
        open = null;
      }
    } else {
      const marker = taskWikilinkFenceMarker(lines[index]);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  const idCounts = new Map();
  for (let index = start; index < lines.length; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const id = taskWikilinkTrailingBlockId(lines[index]);
    if (id) {
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
  }
  const rows = [];
  let section;
  for (let index = start; index < lines.length; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const heading = taskWikilinkAtxHeading(lines[index]);
    if (heading !== null) {
      section = heading;
    }
    const match = TASK_WIKILINK_LINE_RE.exec(lines[index]);
    if (!match) {
      continue;
    }
    const body = match[3];
    if (
      active.globalFilter !== "" &&
      !body.split(/\s+/).includes(active.globalFilter)
    ) {
      continue;
    }
    const blockId = taskWikilinkTrailingBlockId(lines[index]);
    const statusType = active.statusTypes[match[2]] || "TODO";
    rows.push({
      notePath,
      line: index,
      rawLine: lines[index],
      status: match[2],
      blockId: blockId || null,
      hidden: taskWikilinkHasExactTag(lines[index], "#hide"),
      prjBlocked: taskWikilinkHasExactTag(lines[index], "#prj_is_blocked"),
      scheduleLogPresent: Boolean(
        findScheduledFieldMatches(lines[index]).length &&
        findScheduleLogMarker(lines, index),
      ),
      section,
      depth: taskWikilinkIndentationDepth(match[1]),
      searchText: taskWikilinkSearchText(body, active.globalFilter, blockId),
      displayText: cleanTaskDisplayText(lines[index]),
      duplicateId: blockId ? (idCounts.get(blockId) || 0) > 1 : false,
      open: TASK_WIKILINK_OPEN_TYPES.has(statusType),
    });
  }
  return rows;
}

// Mirror of `collect_note_paths` plus
// `is_always_excluded_note_directory_name`: dotted and always-excluded
// directory components never contribute notes; a file only needs a
// case-insensitive `.md` extension (so a dotted root file still counts,
// exactly like bob).
function isTaskWikilinkNotePath(path) {
  const parts = String(path).split("/");
  const file = parts.pop();
  if (!/\.[mM][dD]$/.test(file || "")) {
    return false;
  }
  return parts.every(
    (dir) => !dir.startsWith(".") && !TASK_WIKILINK_EXCLUDED_DIRS.has(dir),
  );
}

function taskWikilinkPathWithoutExtension(path) {
  const without = String(path).replace(/\.[mM][dD]$/, "");
  return without.split("/").join("/");
}

function taskWikilinkIsArchivePath(path) {
  return String(path).split("/")[0] === "done";
}

// Mirror of `locator_for` plus `cross_note_link_target` over a basename
// index: archive paths always keep the vault-relative path without
// `.md`; otherwise the file stem when it resolves to exactly this path
// (an exact `stem.md` hit first, else a unique case-insensitive
// basename), else the full path without `.md`.
function buildBasenameIndex(paths) {
  const exact = new Set(paths);
  const byStem = new Map();
  for (const path of paths) {
    const file = String(path).split("/").pop();
    const stem = file.replace(/\.[mM][dD]$/, "");
    const key = stem.toLowerCase();
    if (!byStem.has(key)) {
      byStem.set(key, []);
    }
    byStem.get(key).push(path);
  }
  function resolveStem(stem) {
    const candidate = `${stem}.md`;
    if (exact.has(candidate)) {
      return candidate;
    }
    const group = byStem.get(stem.toLowerCase()) || [];
    return group.length === 1 ? group[0] : null;
  }
  function stemOf(path) {
    return String(path)
      .split("/")
      .pop()
      .replace(/\.[mM][dD]$/, "");
  }
  function locatorFor(path) {
    const stem = stemOf(path);
    if (resolveStem(stem) === path) {
      return stem;
    }
    return taskWikilinkPathWithoutExtension(path);
  }
  function linkTargetFor(path) {
    if (taskWikilinkIsArchivePath(path)) {
      return taskWikilinkPathWithoutExtension(path);
    }
    return locatorFor(path);
  }
  // Both link strings in one stem resolution: the archive check is
  // cheaper than a second `locatorFor` pass, and the snapshot
  // decorates thousands of rows per open.
  function locatorAndTargetFor(path) {
    const locator = locatorFor(path);
    if (taskWikilinkIsArchivePath(path)) {
      return [locator, taskWikilinkPathWithoutExtension(path)];
    }
    return [locator, locator];
  }
  return { locatorFor, linkTargetFor, locatorAndTargetFor };
}

// Mirror of `previous_daily_note` with the anchor passed as a Date:
// the latest canonical `YYYY/YYYYMMDD.md` daily before the anchor day.
function previousDailyNotePath(paths, now) {
  const anchor = now instanceof Date ? now : new Date(now);
  const anchorDay =
    anchor.getFullYear() * 10000 +
    (anchor.getMonth() + 1) * 100 +
    anchor.getDate();
  let best = null;
  for (const path of paths) {
    const match = /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/.exec(String(path));
    if (!match) {
      continue;
    }
    if (match[1] !== match[2]) {
      continue;
    }
    const year = Number(match[2]);
    const month = Number(match[3]);
    const day = Number(match[4]);
    const check = new Date(year, month - 1, day);
    if (
      check.getFullYear() !== year ||
      check.getMonth() !== month - 1 ||
      check.getDate() !== day
    ) {
      continue;
    }
    const stamp = year * 10000 + month * 100 + day;
    if (stamp < anchorDay && (!best || stamp > best.stamp)) {
      best = { path, stamp };
    }
  }
  return best ? best.path : null;
}

// Mirror of `capture_task_wikilinks::disabled_reason`, minus the
// read-only check: in Obsidian a failed write reports instead.
function disabledReasonFor(row, options) {
  const previousDailyPath = options ? options.previousDailyPath : null;
  if (row.duplicateId) {
    return `duplicate block ID ^${row.blockId} in ${row.notePath}`;
  }
  if (row.blockId) {
    return null;
  }
  if (taskWikilinkIsArchivePath(row.notePath)) {
    return "archived tasks can't get an id";
  }
  if (previousDailyPath && previousDailyPath === row.notePath) {
    return "the previous daily note is read-only";
  }
  return null;
}

// Mirror of `capture_dependency_tasks::group_for`.
function groupForWikilinkTask(row, ownerPath) {
  if (!row.open) {
    return "completed";
  }
  if (ownerPath && ownerPath === row.notePath) {
    return "in_this_note";
  }
  if (row.status === "/") {
    return "in_progress";
  }
  if (row.status === "*") {
    return "next";
  }
  return "open";
}
