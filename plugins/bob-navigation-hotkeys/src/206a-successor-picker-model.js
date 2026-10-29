// Pure successor-picker model helpers: destination/intent normalizers,
// optional per-row task context, and a preimage-checked note refresh used
// before the nested destination picker. Shared scope with
// 206-successor-picker-modal.js.

// Strict validation for additive themeIntent on a destination override.
// Malformed intent is dropped so it can never enable a write; absent
// intent keeps the legacy destination shape. linkOnce always wins over
// deliberate, matching the picker (Alt+Enter is never a theme write).
function normalizeSuccessorThemeIntent(intent) {
  try {
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      return null;
    }
    if (typeof intent.deliberate !== "boolean") {
      return null;
    }
    if (typeof intent.linkOnce !== "boolean") {
      return null;
    }
    let shown = null;
    if (intent.shown === undefined || intent.shown === null) {
      shown = null;
    } else if (typeof intent.shown !== "object") {
      return null;
    } else {
      const theme = intent.shown.theme;
      if (!theme || typeof theme !== "object") {
        return null;
      }
      if (typeof theme.key !== "string" || !theme.key) {
        return null;
      }
      shown = intent.shown;
    }
    const linkOnce = intent.linkOnce === true;
    return Object.freeze({
      deliberate: linkOnce ? false : intent.deliberate,
      linkOnce,
      shown,
    });
  } catch (_error) {
    return null;
  }
}

// Per-row destination override (docs/task-dependencies.md §12.13,
// obsidian_destination): `{kind: "existing", entryLine, entryText, title?} |
// {kind: "new", name, preserveSpelling?}`. Optional `themeIntent` rides
// along when valid. Null unless the destination shape is exact.
function normalizeSuccessorDestinationOverride(choice) {
  try {
    if (!choice || typeof choice !== "object") {
      return null;
    }
    const themeIntent = normalizeSuccessorThemeIntent(choice.themeIntent);
    if (choice.kind === "existing") {
      if (!Number.isInteger(choice.entryLine) || choice.entryLine < 0) {
        return null;
      }
      if (typeof choice.entryText !== "string" || !choice.entryText) {
        return null;
      }
      const title = typeof choice.title === "string" ? choice.title.trim() : "";
      return Object.freeze({
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        ...(title ? { title } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      });
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return Object.freeze({
        kind: "new",
        name,
        ...(choice.preserveSpelling === true ? { preserveSpelling: true } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      });
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function successorDestinationOverrideLabel(destination) {
  try {
    if (!destination || typeof destination !== "object") {
      return "";
    }
    if (destination.kind === "new") {
      return typeof destination.name === "string" ? destination.name.trim() : "";
    }
    if (destination.kind === "existing") {
      if (typeof destination.title === "string" && destination.title.trim()) {
        return destination.title.trim();
      }
      if (typeof destination.name === "string" && destination.name.trim()) {
        return destination.name.trim();
      }
      if (Number.isInteger(destination.entryLine)) {
        return `line ${destination.entryLine + 1}`;
      }
    }
    return "";
  } catch (_error) {
    return "";
  }
}

// Defensive feature detection for block-id-prompt
// `api.pomodoroLinkPicker` v1 (§12.13). Null when the plugin is missing,
// older, or torn down.
function getSuccessorDestinationPickerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const prompt = plugins["block-id-prompt"];
    const api = prompt && prompt.api;
    const picker = api && api.pomodoroLinkPicker;
    if (!picker || !(Number(picker.version) >= 1)) {
      return null;
    }
    if (typeof picker.pick !== "function") {
      return null;
    }
    return picker;
  } catch (_error) {
    return null;
  }
}

function successorPickerText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function successorPickerCount(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value))
    : 0;
}

function successorPickerNoteName(path) {
  const value = successorPickerText(path);
  const leaf = value.split("/").pop() || value;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

// Optional validated task context for `api.pick({task})`. `line` is
// one-based and `text` is the full note. `preimage` is the original task
// line used to refuse a changed/missing source before the nested picker.
// Malformed context is dropped so older row shapes stay selectable.
function normalizeSuccessorPickerTaskContext(task) {
  try {
    if (!task || typeof task !== "object") {
      return null;
    }
    const path = typeof task.path === "string" ? task.path : "";
    if (!path) {
      return null;
    }
    if (!Number.isInteger(task.line) || task.line < 1) {
      return null;
    }
    if (typeof task.text !== "string") {
      return null;
    }
    if (typeof task.preimage !== "string") {
      return null;
    }
    const displayText = typeof task.displayText === "string" ? task.displayText : "";
    const status = typeof task.status === "string" ? task.status : "";
    return Object.freeze({
      path,
      line: task.line,
      text: task.text,
      displayText,
      status,
      preimage: task.preimage,
    });
  } catch (_error) {
    return null;
  }
}

function normalizeSuccessorPickerModel(model) {
  try {
    if (!model || typeof model !== "object" || !Array.isArray(model.groups)) {
      return null;
    }
    const allowedGroups = new Set(["hand_off", "project", "project_finished"]);
    const seenKeys = new Set();
    const groups = [];
    let selectableCount = 0;
    let taskRowCount = 0;
    for (const source of model.groups) {
      if (!source || typeof source !== "object" || !allowedGroups.has(source.group)) {
        continue;
      }
      const rows = [];
      for (const row of Array.isArray(source.rows) ? source.rows : []) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const key = typeof row.key === "string" ? row.key : "";
        const text = successorPickerText(row.text);
        if (!key || !text || seenKeys.has(key)) {
          if (key && seenKeys.has(key)) {
            return null;
          }
          continue;
        }
        if (typeof row.notePath !== "string" || typeof row.selectable !== "boolean") {
          continue;
        }
        const task = normalizeSuccessorPickerTaskContext(row.task);
        const normalized = Object.freeze({
          key,
          text,
          notePath: row.notePath,
          status: successorPickerText(row.status),
          destinationLabel: successorPickerText(row.destinationLabel),
          needsBlockId: row.needsBlockId === true,
          selectable: row.selectable,
          mutedReason: successorPickerText(row.mutedReason),
          destination: row.destination,
          ...(task ? { task } : {}),
        });
        seenKeys.add(key);
        rows.push(normalized);
        taskRowCount += 1;
        if (normalized.selectable) {
          selectableCount += 1;
        }
      }
      const folded = source.folded && typeof source.folded === "object"
        ? Object.freeze({
            hidden: successorPickerCount(source.folded.hidden),
            alreadyPlanned: successorPickerCount(source.folded.alreadyPlanned),
            subProjects: successorPickerCount(source.folded.subProjects),
          })
        : Object.freeze({ hidden: 0, alreadyPlanned: 0, subProjects: 0 });
      groups.push(Object.freeze({
        group: source.group,
        header: successorPickerText(source.header),
        project: successorPickerText(source.project),
        rows: Object.freeze(rows),
        folded,
      }));
    }
    if (selectableCount === 0 || groups.length === 0) {
      return null;
    }
    const budget = model.budget && typeof model.budget === "object"
      ? Object.freeze({
          links: successorPickerCount(model.budget.links),
          max: successorPickerCount(model.budget.max),
        })
      : null;
    const predecessors = Array.isArray(model.predecessors)
      ? model.predecessors.filter((row) => row && typeof row === "object").map((row) => Object.freeze({
          notePath: successorPickerText(row.notePath),
          blockId: successorPickerText(row.blockId),
          text: successorPickerText(row.text),
        }))
      : [];
    return Object.freeze({
      title: successorPickerText(model.title) || "Choose successor tasks",
      predecessors: Object.freeze(predecessors),
      groups: Object.freeze(groups),
      budget,
      selectableCount,
      taskRowCount,
    });
  } catch (_error) {
    return null;
  }
}

// Live note text for a vault-relative path: open editor buffers first,
// then the vault. Null when the note cannot be read, including
// ambiguous open buffers.
async function readSuccessorPickerNoteText(app, path) {
  try {
    const normalized = normalizeVaultRelativePath(path);
    if (!normalized) {
      return null;
    }
    const buffers = getOpenMarkdownBufferContents(app);
    if (buffers.ambiguous) {
      return null;
    }
    if (buffers.has(normalized)) {
      return String(buffers.get(normalized) || "");
    }
    const vault = app && app.vault;
    const file = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(normalized)
      : null;
    if (!vault || !file) {
      return null;
    }
    if (typeof vault.cachedRead === "function") {
      return String((await vault.cachedRead(file)) || "");
    }
    if (typeof vault.read === "function") {
      return String((await vault.read(file)) || "");
    }
    return null;
  } catch (_error) {
    return null;
  }
}

async function refreshSuccessorPickerTaskContext(app, task) {
  try {
    const normalized = normalizeSuccessorPickerTaskContext(task);
    if (!normalized) {
      return null;
    }
    const liveText = await readSuccessorPickerNoteText(app, normalized.path);
    if (typeof liveText !== "string") {
      return null;
    }
    const lines = liveText.split(/\r?\n/);
    const index = normalized.line - 1;
    if (index < 0 || index >= lines.length) {
      return null;
    }
    if (lines[index] !== normalized.preimage) {
      return null;
    }
    return Object.freeze({
      path: normalized.path,
      line: normalized.line,
      text: liveText,
      displayText: normalized.displayText,
      status: normalized.status,
      preimage: normalized.preimage,
    });
  } catch (_error) {
    return null;
  }
}

function successorPickerTaskPickRequest(task) {
  if (!task) {
    return {};
  }
  return {
    task: {
      path: task.path,
      line: task.line,
      text: task.text,
      displayText: task.displayText,
      status: task.status,
    },
  };
}

// Marked selectable rows in displayed (model) order, else the highlighted
// row. Never reconstructs identity from display text or the opaque key.
function successorPickerRetargetRows(modal) {
  const rows = [];
  try {
    if (!modal || !modal.model) {
      return rows;
    }
    if (modal.markedKeys && modal.markedKeys.size > 0) {
      for (const group of modal.model.groups) {
        for (const row of group.rows) {
          if (row.selectable && modal.markedKeys.has(row.key)) {
            rows.push(row);
          }
        }
      }
      return rows;
    }
    const active = modal.visibleItems && modal.visibleItems[modal.selectedIndex];
    if (active && active.kind === "offer" && active.row && active.row.selectable) {
      rows.push(active.row);
    }
  } catch (_error) {
    return [];
  }
  return rows;
}
