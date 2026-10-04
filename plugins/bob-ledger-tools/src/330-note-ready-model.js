// One shared frontmatter reader for every per-note frontmatter lookup.
// `pathOrFile` is a vault-relative path string or a TFile. It resolves a
// TFile through `vault.getAbstractFileByPath` and reads
// `metadataCache.getFileCache(file)` — the only call that returns a cache
// entry in Obsidian. (Fixes bob-cli-3e: the old `getCache({path})` /
// `getCache(file)` calls always returned null, so per-note overrides
// never applied.) Returns the frontmatter object or null. Never throws.
function noteFrontmatterFor(app, pathOrFile) {
  try {
    const vault = app && app.vault;
    const metadataCache = app && app.metadataCache;
    if (
      !vault ||
      !metadataCache ||
      typeof metadataCache.getFileCache !== "function"
    ) {
      return null;
    }
    let file = null;
    if (typeof pathOrFile === "string") {
      if (typeof vault.getAbstractFileByPath !== "function") {
        return null;
      }
      file = vault.getAbstractFileByPath(pathOrFile);
    } else if (
      pathOrFile &&
      typeof pathOrFile === "object" &&
      typeof pathOrFile.path === "string"
    ) {
      file = pathOrFile;
    }
    if (!file) {
      return null;
    }
    const cache = metadataCache.getFileCache(file);
    const frontmatter =
      cache && typeof cache === "object" ? cache.frontmatter : null;
    return frontmatter &&
      typeof frontmatter === "object" &&
      !Array.isArray(frontmatter)
      ? frontmatter
      : null;
  } catch (error) {
    return null;
  }
}

// --- Per-note Ready cap (api.noteReady v1) --------------------------------
// Shared read-time contract (`docs/plan.md`, "Ready cap per note" in
// bob-cli): one implementation here serves the dash chip, crowded.md,
// and the `## Tasks` heading chips. Field names match the CLI JSON.
// Pure unless noted; the plugin snapshot builder below is the only
// impure part.

const NOTE_READY_DEFAULT_CAP = 5;
const NOTE_READY_CAP_MAX = 999;
const NOTE_READY_DASH_PATH = "dash.md";
const LINT_NOTE_READY_CAP_INVALID = "note_ready_cap_invalid";
const LINT_NOTE_READY_IN_TERMINAL_PROJECT =
  "note_ready_in_terminal_project";

// Directory names whose subtrees never hold per-note entries. Mirrors
// the Rust walk (`is_excluded_directory` plus the `done/` rule); the
// check applies to directory segments only, so `x/done.md` is fine.
const NOTE_READY_EXCLUDED_DIRS = [
  ".git",
  ".obsidian",
  "_templates",
  "_conflicts",
  "_generated",
  "done",
];

function noteReadyPathExcluded(path) {
  const text = String(path || "");
  if (!text) {
    return true;
  }
  if (text === NOTE_READY_DASH_PATH) {
    return true;
  }
  const segments = text.split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (NOTE_READY_EXCLUDED_DIRS.includes(segments[index])) {
      return true;
    }
  }
  return false;
}

function noteReadyStemForPath(path) {
  const text = String(path || "");
  const slash = text.lastIndexOf("/");
  const base = slash === -1 ? text : text.slice(slash + 1);
  return base.toLowerCase().endsWith(".md")
    ? base.slice(0, -3)
    : base;
}

function noteReadyStripQuotes(text) {
  const value = String(text || "").trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'")
    ) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

// One scalar `type` value to a kind. Accepts `[[project]]` /
// `[[area]]` exactly, plus the inner word that bare YAML wikilinks
// parse to (`[["project"]]` arrives as a nested array; `"project"`
// survives inside flow lists).
function noteReadyScalarKind(value) {
  const text = noteReadyStripQuotes(value);
  if (!text) {
    return null;
  }
  if (text === "[[project]]") {
    return "project";
  }
  if (text === "[[area]]") {
    return "area";
  }
  const inner = text
    .replace(/^[[ '"\]]+|[[ '"\]]+$/g, "")
    .trim();
  if (inner === "project") {
    return "project";
  }
  if (inner === "area") {
    return "area";
  }
  return null;
}

// A parsed `type` frontmatter value (string, array, or the nested
// `[["project"]]` array bare YAML wikilinks parse to) to
// `area`|`project`|null. Area wins ties, as in Rust.
function noteReadyKindFromType(value) {
  const fromScalarList = (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith("[")) {
      const inner = trimmed.endsWith("]")
        ? trimmed.slice(1, -1)
        : trimmed.slice(1);
      let project = null;
      for (const item of inner.split(",")) {
        const kind = noteReadyScalarKind(item);
        if (kind === "area") {
          return "area";
        }
        if (kind === "project") {
          project = "project";
        }
      }
      return project;
    }
    return noteReadyScalarKind(trimmed);
  };
  if (typeof value === "string") {
    return fromScalarList(value);
  }
  if (Array.isArray(value)) {
    let project = null;
    for (const item of value) {
      if (typeof item === "string") {
        const kind = fromScalarList(item);
        if (kind === "area") {
          return "area";
        }
        if (kind === "project") {
          project = "project";
        }
      } else if (Array.isArray(item)) {
        for (const nested of item) {
          if (typeof nested !== "string") {
            continue;
          }
          const kind = noteReadyScalarKind(nested);
          if (kind === "area") {
            return "area";
          }
          if (kind === "project") {
            project = "project";
          }
        }
      }
    }
    return project;
  }
  return null;
}

// Parsed `status` frontmatter to a label: `wip`, `waiting`, `done`,
// `canceled`, or the lowercased value. Mirrors `ProjectStatus::parse`.
function noteReadyStatusLabel(value) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (value !== undefined && value !== null) {
    text = String(value);
  }
  const normalized = noteReadyStripQuotes(text).toLowerCase();
  if (normalized === "" || normalized === "wip") {
    return "wip";
  }
  if (normalized === "waiting") {
    return "waiting";
  }
  if (normalized === "done") {
    return "done";
  }
  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }
  return normalized;
}

function noteReadyStatusIsTerminal(statusLabel) {
  return statusLabel === "done" || statusLabel === "canceled";
}

// Parsed `parent` frontmatter to a stem. Mirrors the Rust
// `wikilink_target` (alias/heading stripped, last path segment, and
// lowercased, since Rust stores the link name).
function noteReadyParentStem(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = noteReadyStripQuotes(value);
  if (!text.startsWith("[[") || !text.endsWith("]]")) {
    return null;
  }
  let inner = text.slice(2, -2).trim();
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    inner = inner.slice(0, pipe);
  }
  const hash = inner.indexOf("#");
  if (hash !== -1) {
    inner = inner.slice(0, hash);
  }
  const slash = inner.lastIndexOf("/");
  if (slash !== -1) {
    inner = inner.slice(slash + 1);
  }
  inner = inner.trim();
  if (!inner) {
    return null;
  }
  return inner.toLowerCase();
}

// Parse a raw `ready_cap` frontmatter value (number, digit string,
// `off` in any case, or boolean `false` for exempt). Returns
// `{ cap, source, exempt, invalid }`: `cap` is null for exempt notes;
// `invalid` means present-but-bad, and the caller falls back to the
// default and emits `note_ready_cap_invalid`. Mirrors the Rust
// `parse_ready_cap`.
function parseNoteReadyCap(raw, defaultCap, defaultSource) {
  const fallback = {
    cap: defaultCap,
    source: defaultSource,
    exempt: false,
    invalid: false,
  };
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw === "boolean") {
    if (raw === false) {
      return { cap: null, source: "note", exempt: true, invalid: false };
    }
    return { ...fallback, invalid: true };
  }
  if (typeof raw === "number") {
    if (
      Number.isInteger(raw) &&
      raw >= 1 &&
      raw <= NOTE_READY_CAP_MAX
    ) {
      return { cap: raw, source: "note", exempt: false, invalid: false };
    }
    return { ...fallback, invalid: true };
  }
  if (typeof raw === "string") {
    const text = noteReadyStripQuotes(raw);
    if (!text) {
      return fallback;
    }
    const lowered = text.toLowerCase();
    if (lowered === "off" || lowered === "false") {
      return { cap: null, source: "note", exempt: true, invalid: false };
    }
    if (/^[+-]?\d+$/.test(text)) {
      const number = Number(text);
      if (
        Number.isSafeInteger(number) &&
        number >= 1 &&
        number <= NOTE_READY_CAP_MAX
      ) {
        return {
          cap: number,
          source: "note",
          exempt: false,
          invalid: false,
        };
      }
    }
    return { ...fallback, invalid: true };
  }
  return { ...fallback, invalid: true };
}

function noteReadyStateRank(state) {
  if (state === "crowded") {
    return 0;
  }
  if (state === "full") {
    return 1;
  }
  if (state === "room") {
    return 2;
  }
  if (state === "empty") {
    return 3;
  }
  return 4;
}

function noteReadyEmptyTotals() {
  return {
    notes: 0,
    areas: 0,
    projects: 0,
    crowded: 0,
    full: 0,
    room: 0,
    empty: 0,
    exempt: 0,
    counted: 0,
    excess: 0,
    recurring: 0,
  };
}

function noteReadyRawLabel(raw) {
  if (typeof raw === "string") {
    return raw.trim();
  }
  try {
    const encoded = JSON.stringify(raw);
    return encoded === undefined ? String(raw) : encoded;
  } catch (error) {
    return String(raw);
  }
}

// Pure per-note Ready evaluation: no I/O, unit-testable. `notes` holds
// typed-note entries
// `{ path, name, kind, status, isArea, isTerminal, parent, ready_cap_raw }`;
// `rows` holds in-lane, non-`prj` rows
// `{ path, recurring, blockId, bucket }` where `bucket` is a freshness
// `"new"`/`"rotten"`/null. Rows whose path matches no note are ignored.
// Terminal projects are never capped: they contribute no entry, and a
// `note_ready_in_terminal_project` lint is emitted once when they still
// hold counted rows. Mirrors the Rust `evaluate`.
function noteReadyEvaluate({
  notes,
  rows,
  defaultCap,
  defaultSource,
  freshnessAvailable,
}) {
  const cap = Number.isInteger(defaultCap) ? defaultCap : NOTE_READY_DEFAULT_CAP;
  const source =
    defaultSource === "config" || defaultSource === "preview"
      ? defaultSource
      : "default";
  const noteList = Array.isArray(notes) ? notes : [];
  const rowList = Array.isArray(rows) ? rows : [];
  const byPath = new Map();
  for (const row of rowList) {
    if (!row || typeof row.path !== "string" || !row.path) {
      continue;
    }
    if (!byPath.has(row.path)) {
      byPath.set(row.path, []);
    }
    byPath.get(row.path).push(row);
  }
  const entries = [];
  const lints = [];
  for (const note of noteList) {
    if (!note || typeof note.path !== "string") {
      continue;
    }
    const noteRows = byPath.get(note.path) || [];
    const countedRows = noteRows.filter((row) => !row.recurring);
    const count = countedRows.length;
    const recurring = noteRows.filter((row) => row.recurring).length;
    if (!note.isArea && note.isTerminal) {
      if (count > 0) {
        lints.push({
          code: LINT_NOTE_READY_IN_TERMINAL_PROJECT,
          path: note.path,
          message:
            `project ${note.name} is ${note.status} but still holds ` +
            `${count} ready ${count === 1 ? "task" : "tasks"}`,
        });
      }
      continue;
    }
    const parsed = parseNoteReadyCap(note.ready_cap_raw, cap, source);
    if (parsed.invalid) {
      lints.push({
        code: LINT_NOTE_READY_CAP_INVALID,
        path: note.path,
        message:
          `ready_cap ${JSON.stringify(noteReadyRawLabel(note.ready_cap_raw))} ` +
          `in ${note.name} is not 1–999 or off; using ${cap}`,
      });
    }
    let state = "empty";
    let overBy = 0;
    let capValue = parsed.cap;
    if (parsed.exempt) {
      state = "exempt";
      capValue = null;
    } else {
      const limit =
        Number.isInteger(capValue) && capValue !== null ? capValue : cap;
      if (count > limit) {
        state = "crowded";
        overBy = count - limit;
      } else if (count === limit) {
        state = "full";
      } else if (count > 0) {
        state = "room";
      } else {
        state = "empty";
      }
    }
    let makeUp = null;
    if (freshnessAvailable) {
      let fresh = 0;
      let rotten = 0;
      for (const row of countedRows) {
        if (row.bucket === "new") {
          fresh += 1;
        } else if (row.bucket === "rotten") {
          rotten += 1;
        }
      }
      makeUp = {
        ready: Math.max(0, count - fresh - rotten),
        new: fresh,
        rotten,
      };
    }
    entries.push({
      path: note.path,
      name: note.name,
      kind: note.kind,
      status: note.status,
      parent: note.parent === undefined ? null : note.parent,
      count,
      cap: capValue,
      cap_source: parsed.source,
      state,
      over_by: overBy,
      make_up: makeUp,
      recurring,
    });
  }
  entries.sort((a, b) => {
    const rank = noteReadyStateRank(a.state) - noteReadyStateRank(b.state);
    if (rank !== 0) {
      return rank;
    }
    if (a.over_by !== b.over_by) {
      return b.over_by - a.over_by;
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    const nameA = String(a.name || "").toLowerCase();
    const nameB = String(b.name || "").toLowerCase();
    if (nameA !== nameB) {
      return nameA < nameB ? -1 : 1;
    }
    return String(a.path) < String(b.path)
      ? -1
      : String(a.path) > String(b.path)
        ? 1
        : 0;
  });
  const totals = noteReadyEmptyTotals();
  for (const entry of entries) {
    totals.recurring += entry.recurring;
    if (entry.state === "exempt") {
      totals.exempt += 1;
      continue;
    }
    totals.notes += 1;
    if (entry.kind === "area") {
      totals.areas += 1;
    } else {
      totals.projects += 1;
    }
    totals.counted += entry.count;
    totals.excess += entry.over_by;
    if (entry.state === "crowded") {
      totals.crowded += 1;
    } else if (entry.state === "full") {
      totals.full += 1;
    } else if (entry.state === "room") {
      totals.room += 1;
    } else if (entry.state === "empty") {
      totals.empty += 1;
    }
  }
  lints.sort((a, b) => {
    if (a.path !== b.path) {
      return String(a.path) < String(b.path) ? -1 : 1;
    }
    return String(a.code) < String(b.code)
      ? -1
      : String(a.code) > String(b.code)
        ? 1
        : 0;
  });
  return { notes: entries, totals, lints };
}

// Recurrence under the `freshnessRowFromTask` rule: a Tasks recurrence,
// flag, or `[repeat:: …]` inline field.
function noteReadyRecurringFor(task) {
  try {
    if (!task || typeof task !== "object") {
      return false;
    }
    if (Boolean(task.recurrence)) {
      return true;
    }
    if (task.isRecurring === true || task.recurring === true) {
      return true;
    }
    const description = planTaskDescription(task);
    const rawLine =
      typeof task.originalMarkdown === "string"
        ? task.originalMarkdown
        : typeof description === "string"
          ? description
          : "";
    return freshnessHasRepeatField(rawLine);
  } catch (error) {
    return false;
  }
}

// Stable key for the crowded set plus caps: the query-refresh trigger
// compares it to detect crowded/cap/label changes that no Tasks cache
// change carries.
function noteReadyCrowdedKey(notes, capsKey) {
  try {
    const crowded = [];
    for (const entry of Array.isArray(notes) ? notes : []) {
      if (entry && entry.state === "crowded") {
        crowded.push([entry.path, entry.count, entry.cap]);
      }
    }
    return JSON.stringify([crowded, capsKey || null]);
  } catch (error) {
    return JSON.stringify(["error", capsKey || null]);
  }
}

