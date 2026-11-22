// Tasks-mode pure model for nav's proseField v2 (phase bob-cli-oz.3).
//
// Pure helpers for the LINK band's tasks mode: the ID-line model, row to
// view mapping, group runs, crumbs, detail strings, and leftover-(( hint
// messages. Never throws, never touches the DOM or the vault. Offsets stay
// UTF-16.

const PROSE_TASK_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PROSE_TASK_ID_MAX_LENGTH = 64;
const PROSE_TASK_NAME_TIMEOUT_MS = 3000;
const PROSE_TASK_WRITE_FLASH_MS = 150;

function proseTaskSanitizeId(raw) {
  try {
    const value = String(raw == null ? "" : raw);
    let out = "";
    for (const char of value) {
      if (/[A-Za-z0-9-]/u.test(char)) out += char;
      else if (char === " " || char === "_") out += "-";
    }
    return out.slice(0, PROSE_TASK_ID_MAX_LENGTH);
  } catch (_error) {
    return "";
  }
}

function proseTaskValidateId(id, reserved) {
  try {
    const value = String(id == null ? "" : id);
    if (!value) return { ok: false, short: "letters, digits, - only", message: "Type a block ID: letters, numbers, and dashes" };
    if (!PROSE_TASK_BLOCK_ID_RE.test(value)) {
      return { ok: false, short: "letters, digits, - only", message: "Use letters, numbers, and dashes" };
    }
    if (reserved && typeof reserved.has === "function" && reserved.has(value)) {
      return { ok: false, short: "already in note", message: `^${value} already exists in this note` };
    }
    return { ok: true };
  } catch (_error) {
    return { ok: false, short: "letters, digits, - only", message: "Use letters, numbers, and dashes" };
  }
}

function createProseTaskIdLine(suggestion) {
  const seed = proseTaskSanitizeId(suggestion);
  return {
    value: seed,
    caret: seed.length,
    selected: seed.length > 0,
    suggestions: seed ? [seed] : [],
    suggestionIndex: 0,
    error: null,
  };
}

function proseTaskIdLineInsert(line, text) {
  const next = line && typeof line === "object"
    ? { value: String(line.value || ""), caret: Number.isInteger(line.caret) ? line.caret : 0, selected: Boolean(line.selected), suggestions: Array.isArray(line.suggestions) ? line.suggestions.slice() : [], suggestionIndex: Number.isInteger(line.suggestionIndex) ? line.suggestionIndex : 0, error: null }
    : createProseTaskIdLine("");
  try {
    const insert = proseTaskSanitizeId(text);
    if (!insert) {
      next.error = "letters, digits, - only";
      return { line: next, refused: true };
    }
    if (next.selected) {
      next.value = insert;
      next.caret = insert.length;
      next.selected = false;
    } else {
      const before = next.value.slice(0, Math.max(0, Math.min(next.value.length, next.caret)));
      const after = next.value.slice(Math.max(0, Math.min(next.value.length, next.caret)));
      next.value = (before + insert + after).slice(0, PROSE_TASK_ID_MAX_LENGTH);
      next.caret = before.length + insert.length;
    }
    next.error = null;
    return { line: next, refused: false };
  } catch (_error) {
    return { line: next, refused: true };
  }
}

function proseTaskIdLineBackspace(line) {
  const next = line && typeof line === "object"
    ? { ...line, value: String(line.value || ""), suggestions: Array.isArray(line.suggestions) ? line.suggestions.slice() : [] }
    : createProseTaskIdLine("");
  try {
    if (next.selected) {
      next.value = "";
      next.caret = 0;
      next.selected = false;
      next.error = null;
      return next;
    }
    if (next.caret <= 0) return next;
    const before = next.value.slice(0, next.caret - 1);
    const after = next.value.slice(next.caret);
    next.value = before + after;
    next.caret = before.length;
    next.error = null;
    return next;
  } catch (_error) {
    return next;
  }
}

function proseTaskIdLineDeleteWord(line) {
  if (line && line.selected) return proseTaskIdLineBackspace(line);
  const next = proseTaskIdLineBackspace({ ...line, selected: false });
  try {
    const value = String(next.value || "");
    let start = Math.max(0, Math.min(value.length, Number.isInteger(next.caret) ? next.caret : value.length));
    let end = start;
    while (end < value.length && value[end] !== "-") end += 1;
    if (end === start && start > 0) {
      let cut = start - 1;
      while (cut > 0 && value[cut - 1] !== "-") cut -= 1;
      next.value = value.slice(0, cut) + value.slice(start);
      next.caret = cut;
      return next;
    }
    return next;
  } catch (_error) {
    return next;
  }
}

function proseTaskIdLineSetSuggestion(line, suggestion) {
  const next = line && typeof line === "object" ? { ...line } : createProseTaskIdLine("");
  try {
    const clean = proseTaskSanitizeId(suggestion);
    next.value = clean;
    next.caret = clean.length;
    next.selected = clean.length > 0;
    next.error = null;
    return next;
  } catch (_error) {
    return next;
  }
}

function proseTaskIdLineCycle(line, direction) {
  const next = line && typeof line === "object"
    ? { ...line, suggestions: Array.isArray(line.suggestions) ? line.suggestions.slice() : [] }
    : createProseTaskIdLine("");
  try {
    const list = next.suggestions.filter(Boolean);
    if (!list.length) return next;
    const step = direction < 0 ? -1 : 1;
    next.suggestionIndex = ((Number.isInteger(next.suggestionIndex) ? next.suggestionIndex : 0) + step + list.length) % list.length;
    return proseTaskIdLineSetSuggestion({ ...next, selected: false }, list[next.suggestionIndex]);
  } catch (_error) {
    return next;
  }
}

const PROSE_TASK_STATUS_PILL = {
  todo: "[ ]",
  active: "[/]",
  next: "[*]",
  blocked: "[?]",
  done: "✓",
  cancelled: "✕",
};

function proseTaskPillFor(row) {
  try {
    const status = String((row && row.status) || "todo").toLowerCase();
    if (status === "active" || status === "in-progress" || status === "inprogress") return PROSE_TASK_STATUS_PILL.active;
    if (status === "next") return PROSE_TASK_STATUS_PILL.next;
    if (status === "blocked") return PROSE_TASK_STATUS_PILL.blocked;
    if (status === "done" || status === "completed") return PROSE_TASK_STATUS_PILL.done;
    if (status === "cancelled" || status === "canceled") return PROSE_TASK_STATUS_PILL.cancelled;
    return PROSE_TASK_STATUS_PILL.todo;
  } catch (_error) {
    return PROSE_TASK_STATUS_PILL.todo;
  }
}

function proseTaskGroupCapsule(group) {
  const value = String(group || "");
  if (value === "this-note") return "this note";
  if (value === "in-progress") return "in progress";
  if (value === "next") return "next";
  if (value === "open") return "open";
  if (value === "history") return "history";
  return "";
}

function proseTaskLocatorFor(row) {
  try {
    if (!row) return "";
    if (!row.blockId) return `⊕ ${row.suggestedId ? `^${row.suggestedId}` : "needs ID"}`;
    const target = row.linkTarget || row.notePath || "";
    return `${target}#^${row.blockId}`;
  } catch (_error) {
    return "";
  }
}

function proseTaskDetailFor(row) {
  try {
    if (!row) return { left: "↵ closes this list · nothing is inserted", right: "esc close" };
    if (row.disabled) {
      return { left: `⊘ ${row.disabled.full || row.disabled.short || "unavailable"}`, right: "esc close" };
    }
    if (!row.blockId) {
      const note = row.notePath || "note";
      const suggestion = row.suggestedId ? `^${row.suggestedId}` : "^id";
      return { left: `↵ names it ${suggestion} in ${note}, then links it`, right: "⇥ insert" };
    }
    const link = row.link || (row.linkTarget ? `[[${row.linkTarget}#^${row.blockId}]]` : `[[#^${row.blockId}]]`);
    return { left: `↵ ${link}`, right: "⇥ insert" };
  } catch (_error) {
    return { left: "↵ closes this list · nothing is inserted", right: "esc close" };
  }
}

function proseTaskNameDetailFor(id, notePath) {
  try {
    const clean = proseTaskSanitizeId(id) || "id";
    return { left: `↵ adds ^${clean}, then links [[${notePath || "note"}#^${clean}]]`, right: "esc back" };
  } catch (_error) {
    return { left: "↵ adds the ID, then links it", right: "esc back" };
  }
}

function proseTaskCrumb(query, stage, group) {
  try {
    if (stage === "name") return "🔗 LINK · tasks › name it";
    if (!query) return `🔗 LINK · tasks › ${proseTaskGroupCapsule(group) || "tasks"}`;
    return "🔗 LINK · tasks";
  } catch (_error) {
    return "🔗 LINK · tasks";
  }
}

function proseTaskLeftoverMessage(token) {
  try {
    const query = String(token == null ? "" : token).slice(0, 80);
    if (!query) return null;
    return `⚠ ((${query})) isn't a link yet — type in it to pick a task`;
  } catch (_error) {
    return null;
  }
}

function proseTaskTokenAt(text, caret, fieldAt) {
  try {
    if (typeof fieldAt !== "function") return null;
    const value = String(text == null ? "" : text);
    const cursor = Number(caret);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > value.length) return null;
    return fieldAt(value, cursor);
  } catch (_error) {
    return null;
  }
}

function proseTaskGroupRuns(rows, limit) {
  try {
    const list = Array.isArray(rows) ? rows : [];
    const cap = Math.max(1, Number(limit) || list.length || 1);
    const runs = new Map();
    let lastGroup = null;
    for (const row of list.slice(0, cap)) {
      if (!row) continue;
      const group = String(row.group || "");
      if (group && group !== lastGroup) {
        if (!runs.has(row.key)) runs.set(row.key, proseTaskGroupCapsule(group));
        lastGroup = group;
      }
    }
    return runs;
  } catch (_error) {
    return new Map();
  }
}
